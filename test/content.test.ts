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
import { METHOD_BY_ID } from '../src/content/method'
import { Card, CardAssertion } from '../src/content/schema'
import { buildMechanismStrip, hyperkStrip, tdpStrip } from '../src/content/mechanisms'
import { buildWarp, modelFiducials } from '../src/engine/sync'
import { buildSignals, SignalSet } from '../src/engine/synthesize'
import { tileState } from '../src/engine/propagate'
import { measure } from '../src/engine/measure'
import {
  assetRrCv, assetSignals, assetWindows, AssetJson, initialQrsMean, measureAsset,
  netQrs, pMean, preQrsConsistency, rrCv, stShift, tPolarity, terminalQrsMean,
  tPeak, rsRatio, windowsOf, Windows,
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
    if (c.guidelineMoves.length < 1 || c.guidelineMoves.length > 4) fail(at('guidelineMoves needs 1–4 lines'))
    if (c.rnMoves.length < 1 || c.rnMoves.length > 4) fail(at('rnMoves needs 1–4 lines'))
    // Lethal cards must carry the countermand (2026-08 expert audit).
    if (c.lethal && !c.avoid) fail(at('lethal card requires an avoid line (the countermand)'))
    for (const line of [...c.suspectConfirm, ...c.guidelineMoves, ...c.rnMoves, ...(c.avoid ? [c.avoid] : [])]) {
      if (!line.cites.length) fail(at(`uncited line: "${line.text.slice(0, 40)}…"`))
      for (const k of line.cites) if (!GUIDELINE_BY_KEY[k]) fail(at(`unknown citeKey ${k}`))
    }
    const RX_ONLY = /\b(prescribe|administer|give \d|push \d|bolus \d)/i
    for (const line of c.rnMoves) {
      if (RX_ONLY.test(line.text.split('—')[0])) warn(at(`rnMoves line opens with a prescribing verb: "${line.text.slice(0, 50)}…"`))
    }

    if (!METHOD_BY_ID[c.methodStep]) fail(at(`unknown methodStep '${c.methodStep}'`))
    if (c.mechanism.kind === 'authored' && !c.mechanism.authoredReason) fail(at('authored mechanism needs authoredReason'))
    if (c.mechanism.mustShow.length < 1 || c.mechanism.mustShow.length > 5) fail(at('mustShow needs 1–5 bullets'))
    if (!c.assertions.length) fail(at('no assertions'))

    if (!assets.has(c.seeIt.traceId)) fail(at(`primary trace '${c.seeIt.traceId}' missing from public/recordings`))
    for (const e of c.seeIt.extraTraceIds ?? []) if (!assets.has(e)) fail(at(`extra trace '${e}' missing`))

    // Verification is process-based (no individual authorship, by design):
    // the gate is a fresh guideline check, machine assertions, and citations.
    {
      const [yy, mm] = c.guidelineVerifiedAt.split('-').map(Number)
      if (!yy || !mm) fail(at(`bad guidelineVerifiedAt '${c.guidelineVerifiedAt}'`))
      else {
        const now = new Date()
        const ageMonths = (now.getFullYear() - yy) * 12 + (now.getMonth() + 1 - mm)
        if (ageMonths > 24) fail(at(`guideline check stale (${ageMonths} mo — re-verify)`))
        else if (ageMonths > 18) warn(at(`guideline check aging (${ageMonths} mo)`))
      }
    }
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

const nsrRef = (() => {
  const strip = tileState({ pace: 'SA' })
  const sig = buildSignals(strip)
  return { strip, sig, w: windowsOf(strip) }
})()

const CUSTOMS: Record<
  string,
  (ctx: { sig: SignalSet; w: Windows; asset?: AssetJson; strip?: ReturnType<typeof buildMechanismStrip> }) => boolean
> = {
  // "No septal q" clinically = no PATHOLOGICAL q (≥0.5 mm counts as one here).
  noSeptalQ: ({ sig, w }) => initialQrsMean(sig, 'V6', w) >= -0.05,
  noConsistentP: ({ asset }) => (asset ? preQrsConsistency(asset) < 0.5 : false),
  rigidRR: ({ asset }) => (asset ? assetRrCv(asset) < 0.04 : false),
  uWave: ({ strip }) => {
    // A second positive repolarization hump after the T in lead II: sample the
    // model signal between T end and the next beat; require a local max >=0.05 mV.
    if (!strip) return false
    const sig = buildSignals(strip)
    const w = windowsOf(strip)
    const t0 = w.tEnd ?? w.qrsEnd + 260
    const t1 = t0 + 240
    let peak = -Infinity
    for (let i = 0; i < sig.n; i++) {
      const t = i * sig.dt
      if (t >= t0 && t <= t1) peak = Math.max(peak, sig.leads['II'][i])
    }
    return peak >= 0.05
  },
  flatT: ({ strip }) => {
    if (!strip) return false
    const sig = buildSignals(strip)
    const w = windowsOf(strip)
    return tPeak(sig, 'II', w) <= 0.55 * tPeak(nsrRef.sig, 'II', nsrRef.w)
  },
  noOrganizedP: ({ strip }) =>
    !!strip &&
    strip.beats.every((b) => b.sources.every((s) => s.segment !== 'P' || Math.abs(s.mag) <= 0.05)),

  // HyperK frame (a): tented T — taller AND narrower than the NSR reference.
  tentedT: () => {
    const a = hyperkStrip(0.25)
    const sig = buildSignals(a)
    const w = windowsOf(a)
    const tall = tPeak(sig, 'II', w) >= 1.6 * tPeak(nsrRef.sig, 'II', nsrRef.w)
    const widths = (s: ReturnType<typeof hyperkStrip>) =>
      Math.max(...s.beats[0].sources.filter((x) => x.segment === 'T').map((x) => x.width))
    const narrow = widths(a) <= 0.65 * widths(nsrRef.strip)
    return tall && narrow
  },

  // HyperK frames (b)–(d): P silence → wide QRS → sine merge.
  hyperkFrames: () => {
    const b = buildSignals(hyperkStrip(0.55))
    const wb = windowsOf(hyperkStrip(0.55))
    const pGone = Math.abs(pMean(b, 'II', wb)) <= 0.05
    const c = measure(hyperkStrip(0.78))
    const wide = c.qrsMs >= 140
    const d = hyperkStrip(1)
    const sd = buildSignals(d)
    const wd = windowsOf(d)
    // sine merge: the ST region never settles at baseline
    let off = 0
    let n = 0
    const base = 0
    for (let i = 0; i < sd.n; i++) {
      const t = i * sd.dt
      if (wd.tStart != null && t >= wd.qrsEnd && t <= wd.tStart + 60) {
        n++
        if (Math.abs(sd.leads.II[i] - base) > 0.08) off++
      }
    }
    const sine = n > 0 && off / n >= 0.7
    return pGone && wide && sine
  },

  // TCA: peak of the terminal 40 ms of the QRS in aVR ≥ 0.3 mV (≥3 mm).
  terminalRaVR: ({ sig, w }) => {
    let m = -Infinity
    for (let i = 0; i < sig.n; i++) {
      const t = i * sig.dt
      if (t >= w.qrsEnd - 40 && t <= w.qrsEnd) m = Math.max(m, sig.leads.aVR[i])
    }
    return m >= 0.3
  },

  // Flutter model: atrial firing ≈300/min with 2:1 conduction.
  flutterWaves: ({ strip }) => {
    if (!strip) return false
    const atrial = strip.beats.filter((b) => b.sources.some((s) => s.segment === 'P' && Math.abs(s.mag) > 0.02))
    const vent = strip.beats.filter((b) => b.sources.some((s) => s.segment === 'QRS' && Math.abs(s.mag) > 0))
    if (atrial.length < 8) return false
    const gaps = atrial.slice(1).map((b, i) => b.onset - atrial[i].onset)
    const spacing = gaps.every((g) => g >= 190 && g <= 210)
    return spacing && Math.abs(atrial.length / Math.max(1, vent.length) - 2) < 0.35
  },

  // VT run: metronome-regular ventricular beats.
  regularRun: ({ strip }) => {
    if (!strip) return false
    const onsets = strip.beats
      .filter((b) => b.sources.some((s) => s.segment === 'QRS' && Math.abs(s.mag) > 0))
      .map((b) => b.onset)
    return rrCv(onsets) < 0.06
  },

  // Atria and ventricles keep different rates (VT with dissociated Ps).
  avDissociation: ({ strip }) => {
    if (!strip) return false
    const pCount = strip.beats.reduce(
      (n, b) => n + b.sources.filter((s) => s.segment === 'P' && Math.abs(s.mag) > 0.02).length, 0)
    const vCount = strip.beats.filter((b) => b.sources.some((s) => s.segment === 'QRS' && Math.abs(s.mag) > 0)).length
    if (!pCount || !vCount) return false
    const pRate = (pCount / strip.durationMs) * 60000
    const vRate = (vCount / strip.durationMs) * 60000
    return Math.abs(pRate - vRate) / vRate > 0.15
  },

  // Complete block: atrial 70–80, ventricular 35–45, PRs wander.
  avb3Dissociation: ({ strip }) => {
    if (!strip) return false
    const pCount = strip.beats.reduce(
      (n, b) => n + b.sources.filter((s) => s.segment === 'P' && Math.abs(s.mag) > 0.02).length, 0)
    const vBeats = strip.beats.filter((b) => b.sources.some((s) => s.segment === 'QRS' && Math.abs(s.mag) > 0))
    const pRate = (pCount / strip.durationMs) * 60000
    const vRate = (vBeats.length / strip.durationMs) * 60000
    return pRate >= 68 && pRate <= 82 && vRate >= 33 && vRate <= 47
  },

  // Mobitz II: conducted PRs constant; a P-only (dropped) beat exists.
  mobitz2Pattern: ({ strip }) => {
    if (!strip) return false
    const prs: number[] = []
    let droppedSeen = false
    for (const b of strip.beats) {
      const p = b.sources.find((s) => s.segment === 'P' && Math.abs(s.mag) > 0.02)
      const q = b.sources.filter((s) => s.segment === 'QRS' && Math.abs(s.mag) > 0)
      if (p && q.length) prs.push(Math.min(...q.map((s) => s.center)) - p.center)
      if (p && !q.length) droppedSeen = true
    }
    if (!droppedSeen || prs.length < 3) return false
    return Math.max(...prs) - Math.min(...prs) <= 20
  },

  // Trace-side dropped beat: the pause of a non-conducted P.
  droppedBeats: ({ asset }) => {
    if (!asset) return false
    const on = asset.annotation.beats.map((b) => b.qrsOn)
    const rr = on.slice(1).map((t, i) => t - on[i]).sort((a, b) => a - b)
    if (rr.length < 4) return false
    const med = rr[Math.floor(rr.length / 2)]
    return rr[rr.length - 1] >= 1.7 * med
  },

  terminalRV1: ({ sig, w }) => terminalQrsMean(sig, 'V1', w) > 0.03,
  terminalSI: ({ sig, w }) => terminalQrsMean(sig, 'I', w) < -0.03,
  st3gt2: ({ sig, w }) => stShift(sig, 'III', w) > stShift(sig, 'II', w),
  concordantSTE: ({ sig, w }) => netQrs(sig, 'V5', w) > 0 && stShift(sig, 'V5', w) >= 0.1,
  preservedR: ({ sig, w }) => {
    let m = -Infinity
    for (let i = 0; i < sig.n; i++) {
      const t = i * sig.dt
      if (t >= w.qrsStart && t <= w.qrsEnd) m = Math.max(m, sig.leads.V3[i])
    }
    return m >= 0.2
  },
  tallT: ({ sig, w }) => tPeak(sig, 'V2', w) >= 0.5,
  sokolow: ({ sig, w }) => {
    let sV1 = Infinity
    let rV5 = -Infinity
    for (let i = 0; i < sig.n; i++) {
      const t = i * sig.dt
      if (t >= w.qrsStart && t <= w.qrsEnd) {
        sV1 = Math.min(sV1, sig.leads.V1[i])
        rV5 = Math.max(rV5, sig.leads.V5[i])
      }
    }
    return Math.max(0, -sV1) + Math.max(0, rV5) >= 3.5
  },
  covedShape: ({ sig, w }) => {
    // V1 descends monotonically (within small ripple) from J+40 to the T nadir
    const i0 = Math.round((w.qrsEnd + 40) / sig.dt)
    let nadirI = i0
    const iEnd = Math.round((w.tEnd ?? w.qrsEnd + 320) / sig.dt)
    for (let i = i0; i < Math.min(iEnd, sig.n); i++) if (sig.leads.V1[i] < sig.leads.V1[nadirI]) nadirI = i
    let maxRise = 0
    for (let i = i0 + 1; i <= nadirI; i++) maxRise = Math.max(maxRise, sig.leads.V1[i] - sig.leads.V1[i - 1])
    return nadirI > i0 && sig.leads.V1[nadirI] < 0 && maxRise < 0.06
  },

  // TdP companion strip: rotating axis ≥180°, run rate 180–260.
  tdpPolymorphic: () => {
    const s = tdpStrip()
    const runStart = s.beats.findIndex((b) => b.label === 'torsades')
    if (runStart < 0) return false
    const run = s.beats.slice(runStart, runStart + 8)
    const angles = run.map((b) => {
      const q = b.sources.find((x) => x.segment === 'QRS')!
      return (Math.atan2(q.dir[1], q.dir[0]) * 180) / Math.PI
    })
    const span = Math.max(...angles) - Math.min(...angles)
    const rr = run.slice(1).map((b, i) => b.onset - run[i].onset)
    const rate = 60000 / (rr.reduce((a, x) => a + x, 0) / rr.length)
    return span >= 180 && rate >= 180 && rate <= 260
  },
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
  // The sync warp must build without throwing for every shipped asset — a bad
  // annotation must fail HERE, never in front of a learner.
  for (const tid of [c.seeIt.traceId, ...(c.seeIt.extraTraceIds ?? [])]) {
    const a = assets.get(tid)
    if (!a) continue
    try {
      buildWarp(a.annotation, modelFiducials(strip), a.durationMs, strip.durationMs)
    } catch (e) {
      fail(`${c.id}: warp build failed for ${tid} — ${String(e)}`)
    }
  }
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
