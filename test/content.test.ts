/**
 * Content validator + per-card assertion runner (the "encoded diagnostic
 * criteria" stage). Dev mode: forward-reference links and unsigned reviews
 * warn. Release mode (RELEASE=1): every rule is blocking.
 * Run: npm run check:content
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CARDS, CARD_BY_ID, PACKS } from '../src/content/index'
import { GUIDELINE_BY_KEY, GUIDELINES } from '../src/content/guidelines'
import { Card, CardAssertion } from '../src/content/schema'
import { buildMechanismStrip } from '../src/content/mechanisms'
import { buildSignals, SignalSet } from '../src/engine/synthesize'
import { measure } from '../src/engine/measure'
import {
  assetRrCv, assetSignals, assetWindows, AssetJson, initialQrsMean, measureAsset,
  netQrs, preQrsConsistency, rrCv, stShift, tPolarity, terminalQrsMean, tPeak,
  rsRatio, windowsOf, Windows,
} from './helpers'

const RELEASE = process.env.RELEASE === '1'
let failures = 0
let warnings = 0
const fail = (msg: string) => { console.log(`  ✗ ${msg}`); failures++ }
const warn = (msg: string) => {
  if (RELEASE) fail(msg)
  else { console.log(`  ⚠ ${msg}`); warnings++ }
}
const ok = (msg: string) => console.log(`  ✓ ${msg}`)

const REC_DIR = resolve(import.meta.dirname, '../public/recordings')
const assets = new Map<string, AssetJson>()
for (const f of readdirSync(REC_DIR).filter((f) => f.endsWith('.json'))) {
  const a = JSON.parse(readFileSync(resolve(REC_DIR, f), 'utf8'))
  assets.set(a.id, a)
}

// ---------------------------------------------------------------------------
console.log('=== Schema & copy rules ===')
{
  const ids = new Set<string>()
  for (const c of CARDS) {
    const at = (m: string) => `${c.id}: ${m}`
    if (ids.has(c.id)) fail(at('duplicate id'))
    ids.add(c.id)

    const opts = c.seeIt.commit.options
    if (opts.length < 3 || opts.length > 5) fail(at(`commit needs 3–5 options (${opts.length})`))
    if (opts.filter((o) => o.correct).length !== 1) fail(at('commit needs exactly one correct option'))
    if (opts.some((o) => !o.tempts)) fail(at('every option needs a tempts line'))

    if (c.why.length < 1 || c.why.length > 3) fail(at(`why needs 1–3 lines (${c.why.length})`))
    for (const w of c.why) if (w.length > 110) fail(at(`why line >110 chars: "${w.slice(0, 40)}…"`))

    if (c.pills.length < 2 || c.pills.length > 4) fail(at(`pills need 2–4 (${c.pills.length})`))
    for (const p of c.pills) {
      if (p.linkCardId && !CARD_BY_ID[p.linkCardId]) warn(at(`pill links unknown card '${p.linkCardId}' (forward ref?)`))
    }

    if (c.suspectConfirm.length < 1 || c.suspectConfirm.length > 4) fail(at('suspectConfirm needs 1–4 lines'))
    if (c.guidelineMoves.length < 1 || c.guidelineMoves.length > 3) fail(at('guidelineMoves needs 1–3 lines'))
    for (const line of [...c.suspectConfirm, ...c.guidelineMoves]) {
      if (!line.cites.length) fail(at(`uncited line: "${line.text.slice(0, 40)}…"`))
      for (const k of line.cites) if (!GUIDELINE_BY_KEY[k]) fail(at(`unknown citeKey ${k}`))
    }

    if (c.mechanism.kind === 'authored' && !c.mechanism.authoredReason) fail(at('authored mechanism needs authoredReason'))
    if (c.mechanism.mustShow.length < 1 || c.mechanism.mustShow.length > 5) fail(at('mustShow needs 1–5 bullets'))
    if (!c.assertions.length) fail(at('no assertions'))

    if (!assets.has(c.seeIt.traceId)) fail(at(`primary trace '${c.seeIt.traceId}' missing from public/recordings`))
    for (const e of c.seeIt.extraTraceIds ?? []) if (!assets.has(e)) fail(at(`extra trace '${e}' missing`))

    if (c.review.status === 'signed') {
      if (!c.review.reviewer || !c.review.signedAt) fail(at('signed review needs reviewer + signedAt'))
      if (!c.review.auditPassedAt) fail(at('signed review requires auditPassedAt (the 99% audit)'))
    } else if (RELEASE) {
      fail(at('unsigned card at release gate'))
    } else warn(at('review pending (draft)'))
  }
  for (const p of PACKS) {
    if (p.items.length < 4 || p.items.length > 6) fail(`${p.id}: packs need 4–6 items`)
    for (const it of p.items) {
      if ('cardId' in it && !CARD_BY_ID[it.cardId]) fail(`${p.id}: unknown card ${it.cardId}`)
    }
  }
  ok(`${CARDS.length} cards, ${PACKS.length} packs structurally valid`)
}

// ---------------------------------------------------------------------------
console.log('=== Provenance (assets) ===')
for (const a of assets.values()) {
  const p = (a as unknown as { provenance: Record<string, string> }).provenance
  if (!p) { fail(`${a.id}: no provenance`); continue }
  if (p.tier === 'recorded' || p.tier === 'derived') {
    if (!p.sourceRecord || !p.license) fail(`${a.id}: ${p.tier} requires sourceRecord + license`)
  } else if (p.tier === 'reconstructed') {
    if (!p.reconstructionOf) fail(`${a.id}: reconstructed requires reconstructionOf citeKey`)
  } else if (p.tier === 'modeled') {
    if (!p.modelNote) fail(`${a.id}: modeled requires modelNote`)
  } else fail(`${a.id}: unknown tier '${p.tier}'`)
}
ok(`${assets.size} assets carry valid provenance`)

// ---------------------------------------------------------------------------
console.log('=== Guideline currency ===')
{
  const now = new Date()
  for (const g of GUIDELINES) {
    const [y, m] = g.verifiedAt.split('-').map(Number)
    const months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)
    if (months > 24) fail(`${g.citeKey}: verifiedAt ${g.verifiedAt} is ${months} months old (>24)`)
    else if (months > 18) warn(`${g.citeKey}: verifiedAt ${g.verifiedAt} is ${months} months old (>18)`)
  }
  ok('registry currency checked')
}

// ---------------------------------------------------------------------------
console.log('=== TODO(REVIEW) scan ===')
{
  const scan = (dir: string): number => {
    let count = 0
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, f.name)
      if (f.isDirectory()) count += scan(p)
      else if (f.name.endsWith('.ts') && readFileSync(p, 'utf8').includes('TODO(REVIEW)')) {
        warn(`TODO(REVIEW) in ${p}`)
        count++
      }
    }
    return count
  }
  const n = scan(resolve(import.meta.dirname, '../src/content'))
  ok(`${n} TODO(REVIEW) markers in content`)
}

// ---------------------------------------------------------------------------
console.log('=== Card assertions (encoded diagnostic criteria) ===')

const CUSTOMS: Record<
  string,
  (ctx: { sig: SignalSet; w: Windows; asset?: AssetJson; strip?: ReturnType<typeof buildMechanismStrip> }) => boolean
> = {
  // "No septal q" clinically = no PATHOLOGICAL q (≥0.5 mm counts as one here).
  noSeptalQ: ({ sig, w }) => initialQrsMean(sig, 'V6', w) >= -0.05,
  noConsistentP: ({ asset }) => (asset ? preQrsConsistency(asset) < 0.5 : false),
  noOrganizedP: ({ strip }) =>
    !!strip &&
    strip.beats.every((b) => b.sources.every((s) => s.segment !== 'P' || Math.abs(s.mag) <= 0.05)),
}

const runAssertion = (
  c: Card,
  a: CardAssertion,
  model: { sig: SignalSet; w: Windows; m: ReturnType<typeof measure>; strip: ReturnType<typeof buildMechanismStrip> },
  trace: { sig: SignalSet; w: Windows; asset: AssetJson } | null,
): { ok: boolean; detail: string } => {
  const inRange = (v: number | null, min?: number, max?: number) =>
    v != null && (min == null || v >= min) && (max == null || v <= max)
  const side = a.on === 'model' ? model : trace
  if (!side) return { ok: false, detail: 'no trace side' }
  const { sig, w } = side

  switch (a.check) {
    case 'rateBpm': {
      const v = a.on === 'model' ? model.m.rateBpm : measureAsset(trace!.asset).rateBpm
      return { ok: inRange(v, a.min, a.max), detail: `${v} bpm` }
    }
    case 'qrsMs': {
      const v = a.on === 'model' ? model.m.qrsMs : measureAsset(trace!.asset).qrsMs
      return { ok: inRange(v, a.min, a.max), detail: `${v} ms` }
    }
    case 'prMs': {
      const v = a.on === 'model' ? model.m.prMs : measureAsset(trace!.asset).prMs
      if (a.absent) return { ok: v == null, detail: v == null ? 'absent' : `${v} ms present` }
      return { ok: inRange(v, a.min, a.max), detail: `${v} ms` }
    }
    case 'qtcMs': {
      const v = a.on === 'model' ? model.m.qtcMs : measureAsset(trace!.asset).qtcMs
      return { ok: inRange(v, a.min, a.max), detail: `${v} ms` }
    }
    case 'axisDeg':
      return { ok: inRange(model.m.axisDeg, a.min, a.max), detail: `${model.m.axisDeg}°` }
    case 'netQrs': {
      const v = netQrs(sig, a.lead, w)
      return { ok: a.sign === '+' ? v > 0 : v < 0, detail: `${a.lead} ${v.toFixed(1)}` }
    }
    case 'stShift': {
      const v = stShift(sig, a.lead, w)
      const okSign = a.sign === '+' ? v > 0 : v < 0
      const okMag = a.minMv == null || Math.abs(v) >= a.minMv
      return { ok: okSign && okMag, detail: `${a.lead} ${v.toFixed(2)} mV` }
    }
    case 'tPolarity': {
      const v = tPolarity(sig, a.lead, w)
      return { ok: a.sign === '+' ? v > 0 : v < 0, detail: `${a.lead} ${v > 0 ? '+' : v < 0 ? '−' : '0'}` }
    }
    case 'rsRatio': {
      const v = rsRatio(sig, a.lead, w)
      return { ok: inRange(v, a.min, a.max), detail: `${a.lead} ${v.toFixed(2)}` }
    }
    case 'irregularRR': {
      const cv = a.on === 'model'
        ? rrCv(model.strip.beats.map((b) => b.onset))
        : assetRrCv(trace!.asset)
      return { ok: cv >= a.cvMin, detail: `cv ${cv.toFixed(3)}` }
    }
    case 'custom': {
      const fn = CUSTOMS[a.name]
      if (!fn) return { ok: false, detail: `custom '${a.name}' not implemented` }
      return { ok: fn({ sig, w, asset: trace?.asset, strip: model.strip }), detail: a.name }
    }
  }
}

for (const c of CARDS) {
  const strip = buildMechanismStrip(c.mechanism)
  const modelSig = buildSignals(strip)
  const model = { sig: modelSig, w: windowsOf(strip), m: measure(strip), strip }
  const asset = assets.get(c.seeIt.traceId) ?? null
  const trace = asset ? { sig: assetSignals(asset), w: assetWindows(asset), asset } : null

  console.log(`\n${c.id}:`)
  for (const a of c.assertions) {
    const r = runAssertion(c, a, model, trace)
    if (r.ok) ok(`${a.on}/${a.check} ${r.detail}`)
    else fail(`${c.id}: ${a.on}/${a.check} — ${r.detail}`)
  }
}

// keep the imports honest even before any card uses them
void terminalQrsMean
void tPeak

console.log(
  failures
    ? `\n${failures} CONTENT CHECK(S) FAILED${warnings ? ` (+${warnings} warnings)` : ''}`
    : `\nALL CONTENT CHECKS PASSED ✓${warnings ? ` (${warnings} warnings)` : ''}`,
)
process.exit(failures ? 1 : 0)
