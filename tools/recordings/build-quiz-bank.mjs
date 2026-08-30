/**
 * Build the real-strip quiz bank: for each catalog class with a spec, take
 * cardiologist-validated PTB-XL candidates in quality order, fetch + read +
 * auto-annotate each, and admit it ONLY if the class's measurement gate
 * passes on the raw signal (labels propose, measurement disposes). Admitted
 * strips are written as neutral-named assets (qs-<ecgId> — no diagnosis in
 * the filename) plus a generated manifest the drill imports.
 *
 * Usage: node tools/recordings/build-quiz-bank.mjs [--dry] [cardId ...]
 */
import { resolve } from 'node:path'
import { statSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { DIR, OUT, fetchRecord, loadDatabase, loadManifest, readJson, readRecord, writeJson } from './lib.mjs'
import { annotate } from './annotate.mjs'
import { verifyAsset } from './verify.mjs'
import { measureAsset } from './measure.mjs'

const DRY = process.argv.includes('--dry')
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('--'))

/* ── candidate selection (same conventions as shortlist.mjs) ─────────── */
const RHYTHM = new Set(['SR', 'AFIB', 'AFLT', 'PACE', 'SVTAC', 'PSVT', 'STACH', 'SBRAD', 'SARRH', 'BIGU', 'TRIGU', 'SVARR'])
const has = (row, code) => {
  const v = row.scp[code]
  if (v == null) return false
  return RHYTHM.has(code) ? true : v >= 50
}
const matches = (row, spec) => {
  if (spec.include?.scpAny && !spec.include.scpAny.some((c) => has(row, c))) return false
  if (spec.include?.scpAll && !spec.include.scpAll.every((c) => has(row, c))) return false
  if (spec.exclude?.scpAny && spec.exclude.scpAny.some((c) => row.scp[c] != null)) return false
  const age = Number(row.age)
  if (spec.age && (age < spec.age[0] || age > spec.age[1])) return false
  return true
}
const score = (row, spec) => {
  let s = 0
  if (row.validated_by_human === 'True') s += 4
  if (!row.baseline_drift) s += 2
  if (!row.static_noise) s += 2
  if (!row.burst_noise) s += 1
  if (!row.electrodes_problems) s += 2
  const age = Number(row.age)
  if (age >= 30 && age <= 79) s += 1
  for (const c of spec.include?.scpAny ?? []) s += (row.scp[c] ?? 0) / 100
  return s
}

/* ── per-class measurement gates ─────────────────────────────────────── */
const count = (m, leads, pred) => leads.filter((l) => Number.isFinite(m.st[l]) && pred(m.st[l])).length
const ALL12 = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']

const GATES = {
  nsr: (m) => m.rate >= 50 && m.rate <= 100 && m.rrCv < 0.1 && m.qrsMs < 120 && m.pFrac >= 0.6 &&
    // limb + lateral flat; V1–V3 allow normal J-point elevation (male norm ≤0.25 mV)
    count(m, ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V4', 'V5', 'V6'], (v) => Math.abs(v) >= 0.12) === 0 &&
    count(m, ['V1', 'V2', 'V3'], (v) => v <= -0.08 || v >= 0.25) === 0 && !(m.qtcMs >= 470),
  afib: (m) => m.rrCv >= 0.15 && m.rate >= 50 && m.rate <= 180 && m.qrsMs < 130,
  aflutter: (m) => m.rate >= 70 && ((m.rrCv < 0.06 && m.rate >= 125 && m.rate <= 175) || m.rrCv >= 0.12),
  lbbb: (m) => m.rrCv < 0.1 && m.qrsMs >= 120 && (m.qrsMin.V1 ?? 0) < -0.3 && (m.v1TerminalMv ?? 0) <= 0.05 &&
    (m.qrsMax.V6 ?? 0) > 0.3,
  rbbb: (m) => m.rrCv < 0.1 && m.qrsMs >= 120 && (m.v1TerminalMv ?? 0) > 0.05,
  'lvh-strain': (m) => m.rrCv < 0.1 && m.sokolowMv >= 3.5 &&
    ((m.st.V5 ?? 0) <= -0.05 || (m.st.V6 ?? 0) <= -0.05 || (m.tMin.V5 ?? 0) <= -0.1 || (m.tMin.V6 ?? 0) <= -0.1),
  'paced-v': (m) => m.rrCv < 0.1 && m.qrsMs >= 140, // spikes are often filtered in PTB-XL: label PACE + very wide QRS
  longqt: (m) => m.qtcMs >= 470 && m.tFrac >= 0.6 && m.qrsMs < 120 && m.rrCv < 0.12,
  wpw: (m) => m.rrCv < 0.1 && ((m.pFrac >= 0.5 && m.prMs <= 145 && m.qrsMs >= 90) || m.qrsMs >= 160),
  'svt-avnrt': (m) => m.rate >= 150 && m.rrCv < 0.05 && m.qrsMs < 120,
  'avb-2': (m) => m.rate < 80 && m.maxRrRatio >= 1.6 && m.rrCv >= 0.08,
  'avb-3': (m) => m.rate >= 25 && m.rate <= 55 && m.rrCv < 0.12,
  'omi-anterior': (m) => m.rrCv < 0.12 && count(m, ['V1', 'V2', 'V3', 'V4'], (v) => v >= 0.12) >= 2,
  'omi-inferior': (m) => count(m, ['II', 'III', 'aVF'], (v) => v >= 0.08) >= 2 && (m.st.aVL ?? 0) <= -0.03,
  'omi-posterior': (m) => m.rrCv < 0.12 && count(m, ['V1', 'V2', 'V3'], (v) => v <= -0.08) >= 2 && (m.qrsMax.V2 ?? 0) > 0.5,
  leftmain: (m) => m.rrCv < 0.12 && (m.st.aVR ?? 0) >= 0.08 && count(m, ALL12, (v) => v <= -0.05) >= 6,
  wellens: (m) => m.qrsMs < 120 && m.rate >= 50 && m.rate <= 110 && m.pFrac >= 0.5 &&
    (m.tMin.V2 ?? 0) <= -0.1 && (m.tMin.V3 ?? 0) <= -0.1 &&
    Math.min(m.tMin.V2 ?? 0, m.tMin.V3 ?? 0) <= -0.2 &&
    Math.abs(m.st.V2 ?? 0) < 0.12 && Math.abs(m.st.V3 ?? 0) < 0.12,
}

const TARGETS = {
  nsr: 10, afib: 10, lbbb: 10, rbbb: 10,
  'omi-anterior': 8, 'lvh-strain': 8,
  aflutter: 6, 'paced-v': 6, longqt: 6, 'omi-inferior': 6,
  wpw: 5, 'svt-avnrt': 5,
  'avb-2': 4, 'avb-3': 4, leftmain: 4, wellens: 4,
  'omi-posterior': 3,
}
// Scarce classes first so nothing rich can shadow them.
const ORDER = Object.keys(TARGETS).sort((a, b) => TARGETS[a] - TARGETS[b])

/* ── shipping-findings subset (what the drill's reveal shows, measured) ── */
const round1 = (x) => Math.round(x * 10) / 10
const findingsOf = (m) => {
  const f = { rate: Math.round(m.rate), rrCv: round1(m.rrCv * 100), qrs: Math.round(m.qrsMs) }
  const maxSt = Math.max(...ALL12.map((l) => (Number.isFinite(m.st[l]) ? Math.abs(m.st[l]) : 0)))
  // QTc only where it can be trusted AND matters: never through an injury
  // current (ST ≥ 0.12), and below that only when clearly prolonged or clean.
  if (Number.isFinite(m.qtcMs) && m.tFrac >= 0.6 && m.rrCv < 0.12 && m.qrsMs < 120 &&
      (maxSt < 0.08 || (m.qtcMs >= 470 && maxSt < 0.12))) f.qtc = Math.round(m.qtcMs)
  if (Number.isFinite(m.prMs) && m.pFrac >= 0.6) f.pr = Math.round(m.prMs)
  let hi = null
  let lo = null
  for (const l of ALL12) {
    const v = m.st[l]
    if (!Number.isFinite(v)) continue
    if (!hi || v > hi[1]) hi = [l, v]
    if (!lo || v < lo[1]) lo = [l, v]
  }
  if (hi && hi[1] >= 0.08) f.stMax = [hi[0], Math.round(hi[1] * 100) / 100]
  if (lo && lo[1] <= -0.08) f.stMin = [lo[0], Math.round(lo[1] * 100) / 100]
  if (Number.isFinite(m.sokolowMv) && m.sokolowMv >= 3.5) f.sokolow = round1(m.sokolowMv)
  return f
}

/* ── build ───────────────────────────────────────────────────────────── */
const db = loadDatabase()
const shipped = loadManifest()
const usedEcg = new Set(Object.values(shipped.assets).map((a) => Number(a.ecgId)))
const bankPath = resolve(DIR, 'quiz-manifest.json')
const bank = existsSync(bankPath) ? readJson(bankPath) : { strips: {} }
for (const s of Object.values(bank.strips)) usedEcg.add(Number(s.ecgId))

const summary = []
for (const cardId of ORDER) {
  if (ONLY.length && !ONLY.includes(cardId)) continue
  const spec = readJson(resolve(DIR, 'specs', `${cardId}.json`))
  const gate = GATES[cardId]
  const target = TARGETS[cardId]
  const already = Object.values(bank.strips).filter((s) => s.cardId === cardId).length
  if (already >= target) { summary.push([cardId, already, 'kept']); continue }

  const candidates = db
    .filter((r) => r.validated_by_human === 'True' && matches(r, spec) && !usedEcg.has(Number(r.ecg_id)))
    .sort((a, b) => score(b, spec) - score(a, spec))

  const usedPatients = new Set()
  let admitted = already
  let tried = 0
  const rejects = {}
  for (const row of candidates) {
    if (admitted >= target || tried >= target * 5) break
    if (usedPatients.has(row.patient_id)) continue
    tried++
    try {
      await fetchRecord(row.filename_hr)
      const rec = readRecord(row.filename_hr)
      const UNITS = 200
      const leads = {}
      for (const [name, mv] of Object.entries(rec.leads)) leads[name] = Array.from(mv, (v) => Math.round(v * UNITS))
      const asset = {
        id: `qs-${row.ecg_id}`,
        provenance: { tier: 'recorded', sourceRecord: `PTB-XL ecg_id ${row.ecg_id}`, license: 'CC BY 4.0' },
        fs: rec.fs,
        unitsPerMv: UNITS,
        durationMs: Math.round((rec.n / rec.fs) * 1000),
        leads,
        annotation: { beats: [] },
      }
      asset.annotation = annotate(asset)
      const m = measureAsset(asset) // measure BEFORE suppressing P: gates need pFrac
      if (spec.annotate?.suppressP) for (const b of asset.annotation.beats) delete b.pOn
      const v = verifyAsset(asset)
      if (!v.ok) { rejects.verify = (rejects.verify ?? 0) + 1; continue }
      if (!gate(m)) { rejects.gate = (rejects.gate ?? 0) + 1; continue }

      if (!DRY) {
        const path = resolve(OUT, `${asset.id}.json`)
        writeJson(path, asset)
        bank.strips[asset.id] = {
          cardId,
          ecgId: Number(row.ecg_id),
          patient: Number(row.patient_id),
          scp: row.scp,
          findings: findingsOf(m),
          beats: asset.annotation.beats.length,
          bytes: statSync(path).size,
          builtAt: new Date().toISOString().slice(0, 10),
        }
      }
      usedEcg.add(Number(row.ecg_id))
      usedPatients.add(row.patient_id)
      admitted++
    } catch (err) {
      rejects.error = (rejects.error ?? 0) + 1
      if (process.env.DEBUG) console.error(`  ${cardId} ecg ${row.ecg_id}: ${err.message}`)
    }
  }
  summary.push([cardId, admitted, `tried ${tried}, rejected ${JSON.stringify(rejects)}`])
  console.log(`${cardId}: ${admitted}/${target} admitted (${summary[summary.length - 1][2]})`)
}

if (!DRY) {
  // Findings are derived, never authored: recompute for every stored strip so
  // a formatting-rule change here reaches the whole bank without refetching.
  for (const [id, s] of Object.entries(bank.strips)) {
    const asset = readJson(resolve(OUT, `${id}.json`))
    s.findings = findingsOf(measureAsset(asset))
  }
  writeFileSync(bankPath, JSON.stringify(bank, null, 2) + '\n')

  // Generated manifest the app imports. Neutral order (by ecg id), so the
  // file diff is stable across rebuilds.
  const entries = Object.entries(bank.strips).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
  const lines = entries.map(([id, s]) => `  { traceId: '${id}', cardId: '${s.cardId}', f: ${JSON.stringify(s.findings)} },`)
  const ts = `/**
 * AUTO-GENERATED by tools/recordings/build-quiz-bank.mjs — do not edit.
 * Every strip is a cardiologist-validated PTB-XL recording (CC BY 4.0) that
 * ALSO passed its class's measurement gate on the raw signal; \`f\` holds the
 * measured findings the drill shows on reveal.
 */
export interface QuizFindings {
  rate: number
  rrCv: number
  qrs: number
  qtc?: number
  pr?: number
  stMax?: [string, number]
  stMin?: [string, number]
  sokolow?: number
}
export interface QuizStrip { traceId: string; cardId: string; f: QuizFindings }

export const QUIZ_STRIPS: QuizStrip[] = [
${lines.join('\n')}
]

export const QUIZ_BY_CARD: Record<string, QuizStrip[]> = {}
for (const s of QUIZ_STRIPS) (QUIZ_BY_CARD[s.cardId] ??= []).push(s)
`
  writeFileSync(resolve(DIR, '../../src/content/quizBank.gen.ts'), ts)
}

console.log('\n══ bank ══')
const byCard = {}
for (const s of Object.values(bank.strips)) byCard[s.cardId] = (byCard[s.cardId] ?? 0) + 1
for (const [c, n] of Object.entries(byCard).sort()) console.log(`  ${c.padEnd(14)} ${n}`)
console.log(`  TOTAL ${Object.keys(bank.strips).length} strips`)
