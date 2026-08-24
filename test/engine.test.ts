/**
 * Engine v2 assertion harness (M1): lead-derivation identities, calibration,
 * solver morphology regressions (ported from v1), the montage-algebra truth
 * table on both the model and the recorded-algebra path, mirror (dextro),
 * and the sync warp. Run: npm run check:engine
 */
import { buildSignals, meanQrsAxisDeg, R_MIN } from '../src/engine/synthesize'
import { tileState } from '../src/engine/propagate'
import { measure } from '../src/engine/measure'
import { ALL_LEADS, applyMontageToRecorded, LeadId } from '../src/engine/leads'
import { PRESETS, standardMontage, moveCable, V4R, STANDARD_SITES } from '../src/engine/electrodes'
import { onTorsoSurface } from '../src/engine/torso'
import { mirrorStrip } from '../src/engine/sources'
import { buildWarp, modelFiducials } from '../src/engine/sync'
import {
  correlation, netQrs, peakAmplitude, rms, stShift, tPolarity, windowsOf,
} from './helpers'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗ FAIL —'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
const f1 = (n: number) => n.toFixed(2)

// --- reference strips (solver states; card mechanisms arrive at M3) ---------
const nsr = tileState({ pace: 'SA' })
const rbbb = tileState({ pace: 'SA', blockedEdges: ['HIS>RBB'] })
const lbbb = tileState({ pace: 'SA', blockedEdges: ['HIS>LBB'] })
const stemiAnt = tileState({
  pace: 'SA', ischemic: ['LV_ant', 'LV_apex'], injuryDir: [0.3, -0.25, 0.95], injuryMag: 0.72,
})

const std = standardMontage()
const sigNsr = buildSignals(nsr, std)
const wNsr = windowsOf(nsr)

// ---------------------------------------------------------------------------
console.log('=== Electrode + torso geometry ===')
for (const v of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const) {
  check(`${v} on torso surface`, onTorsoSurface(STANDARD_SITES[v]))
}

// ---------------------------------------------------------------------------
console.log('=== Lead-derivation identities (exact) ===')
{
  let einthoven = 0
  let goldberger = 0
  for (let i = 0; i < sigNsr.n; i++) {
    einthoven = Math.max(einthoven, Math.abs(sigNsr.leads.I[i] + sigNsr.leads.III[i] - sigNsr.leads.II[i]))
    goldberger = Math.max(goldberger, Math.abs(sigNsr.leads.aVR[i] + sigNsr.leads.aVL[i] + sigNsr.leads.aVF[i]))
  }
  check('Einthoven: I + III − II ≈ 0', einthoven < 1e-6, `max ${einthoven.toExponential(1)}`)
  check('Goldberger: aVR + aVL + aVF ≈ 0', goldberger < 1e-6, `max ${goldberger.toExponential(1)}`)
}

// ---------------------------------------------------------------------------
console.log('=== Calibration + NSR morphology (solver, electrode-derived) ===')
{
  const rII = peakAmplitude(sigNsr, 'II')
  check('R(II) in textbook range 0.8–1.6 mV', rII >= 0.8 && rII <= 1.6, `${f1(rII)} mV`)
  const m = measure(nsr)
  check('NSR narrow QRS (<120 ms)', m.qrsMs < 120, `${m.qrsMs} ms`)
  check('NSR PR 120–200 ms', (m.prMs ?? 0) >= 120 && (m.prMs ?? 0) <= 200, `${m.prMs} ms`)
  check('NSR QTc 350–460 ms', m.qtcMs >= 350 && m.qtcMs <= 460, `${m.qtcMs} ms`)
  check('NSR axis −30…+90°', m.axisDeg >= -30 && m.axisDeg <= 90, `${m.axisDeg}°`)
  check('NSR rS in V1 (net −)', netQrs(sigNsr, 'V1', wNsr) < 0, f1(netQrs(sigNsr, 'V1', wNsr)))
  check('NSR dominant R in V6 (net +)', netQrs(sigNsr, 'V6', wNsr) > 0, f1(netQrs(sigNsr, 'V6', wNsr)))
  check('NSR aVR net negative', netQrs(sigNsr, 'aVR', wNsr) < 0)
  check('NSR upright T in II', tPolarity(sigNsr, 'II', wNsr) > 0)
  check('NSR ST near-isoelectric everywhere', ALL_LEADS.every((l) => Math.abs(stShift(sigNsr, l, wNsr)) < 0.05))
  const pV = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((l) => peakAmplitude(sigNsr, l as LeadId))
  console.log(`  precordial peaks: ${pV.map(f1).join(' ')} mV  (R_MIN=${R_MIN})`)
  check('precordial amplitudes sane (<3.0 mV)', pV.every((p) => p < 3.0))
}

// ---------------------------------------------------------------------------
console.log('=== Solver regressions (emergent morphology) ===')
{
  const mR = measure(rbbb)
  const mL = measure(lbbb)
  const sigL = buildSignals(lbbb, std)
  const wL = windowsOf(lbbb)
  check('RBBB wide QRS (≥120 ms)', mR.qrsMs >= 120, `${mR.qrsMs} ms`)
  check('LBBB wide QRS (≥120 ms)', mL.qrsMs >= 120, `${mL.qrsMs} ms`)
  check('LBBB deep negative V1', netQrs(sigL, 'V1', wL) < 0)
  check('LBBB dominant positive V6', netQrs(sigL, 'V6', wL) > 0)

  const sigS = buildSignals(stemiAnt, std)
  const wS = windowsOf(stemiAnt)
  console.log(`  STEMI ST: V2 ${f1(stShift(sigS, 'V2', wS))}  V3 ${f1(stShift(sigS, 'V3', wS))}  III ${f1(stShift(sigS, 'III', wS))}`)
  check('anterior STEMI: ST↑ V2 ≥ 0.1 mV', stShift(sigS, 'V2', wS) >= 0.1)
  check('anterior STEMI: ST↑ V3 ≥ 0.1 mV', stShift(sigS, 'V3', wS) >= 0.1)
  check('anterior STEMI: reciprocal ST↓ III', stShift(sigS, 'III', wS) < 0)
}

// ---------------------------------------------------------------------------
console.log('=== Montage truth table (model swap vs recorded algebra) ===')
{
  // The recorded-algebra path re-derives swapped leads from I and II alone.
  const derived = (preset: keyof typeof PRESETS) =>
    applyMontageToRecorded(sigNsr.leads, PRESETS[preset]())
  const model = (preset: keyof typeof PRESETS) => buildSignals(nsr, PRESETS[preset](), 2).leads

  const closeTo = (a: Float32Array, b: Float32Array, tol: number) => {
    let m = 0
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
    return m <= tol
  }

  // RA↔LA: I' = −I exact; II'=III; aVR'↔aVL; aVF unchanged; precordials unchanged.
  {
    const d = derived('ra-la')
    const neg = new Float32Array(sigNsr.leads.I).map((v) => -v)
    check('RA↔LA: I′ = −I (sample-exact)', closeTo(d.I, neg as Float32Array, 1e-6))
    check('RA↔LA: II′ = III', closeTo(d.II, sigNsr.leads.III, 1e-6))
    check('RA↔LA: aVR′ = aVL', closeTo(d.aVR, sigNsr.leads.aVL, 1e-6))
    check('RA↔LA: aVF unchanged', closeTo(d.aVF, sigNsr.leads.aVF, 1e-6))
    check('RA↔LA: V4 unchanged (WCT invariant)', closeTo(d.V4, sigNsr.leads.V4, 1e-6))
    const mM = model('ra-la')
    check('RA↔LA: model swap matches algebra (I)', closeTo(mM.I, d.I, 1e-4))
    check('RA↔LA: model swap matches algebra (aVL)', closeTo(mM.aVL, d.aVL, 1e-4))
  }
  // LA↔LL: III inverted; I↔II; aVL↔aVF; aVR unchanged.
  {
    const d = derived('la-ll')
    const negIII = new Float32Array(sigNsr.leads.III).map((v) => -v)
    check('LA↔LL: III′ = −III', closeTo(d.III, negIII as Float32Array, 1e-6))
    check('LA↔LL: I′ = II', closeTo(d.I, sigNsr.leads.II, 1e-6))
    check('LA↔LL: aVL′ = aVF', closeTo(d.aVL, sigNsr.leads.aVF, 1e-6))
    check('LA↔LL: aVR unchanged', closeTo(d.aVR, sigNsr.leads.aVR, 1e-6))
  }
  // RA↔LL: II inverted; aVR↔aVF.
  {
    const d = derived('ra-ll')
    const negII = new Float32Array(sigNsr.leads.II).map((v) => -v)
    check('RA↔LL: II′ = −II', closeTo(d.II, negII as Float32Array, 1e-6))
    check('RA↔LL: aVR′ = aVF', closeTo(d.aVR, sigNsr.leads.aVF, 1e-6))
    check('RA↔LL: aVL unchanged', closeTo(d.aVL, sigNsr.leads.aVL, 1e-6))
  }
  // RA↔RL: lead II collapses (the legs share the inferior pole); I' = −III.
  {
    const d = derived('ra-rl')
    const base = rms(sigNsr.leads.II)
    check('RA↔RL: lead II ≈ flatline (algebra path)', rms(d.II) < 0.02 * base, `rms ${(rms(d.II) / base * 100).toFixed(2)}% of baseline`)
    const negIII = new Float32Array(sigNsr.leads.III).map((v) => -v)
    check('RA↔RL: I′ = −III (algebra path)', closeTo(d.I, negIII as Float32Array, 1e-6))
    const mM = model('ra-rl')
    check('RA↔RL: model lead II flatlines too', rms(mM.II) < 0.02 * base, `rms ${(rms(mM.II) / base * 100).toFixed(2)}% of baseline`)
    check('RA↔RL: model I′ = −III', correlation(mM.I, negIII as Float32Array) > 0.999)
  }
  // LA↔RL: lead III collapses; I' ≈ II.
  {
    const d = derived('la-rl')
    const base = rms(sigNsr.leads.III)
    check('LA↔RL: lead III ≈ flatline (algebra path)', rms(d.III) < 0.02 * base)
    check('LA↔RL: I′ = II (algebra path)', closeTo(d.I, sigNsr.leads.II, 1e-6))
  }
  // Limb rotation: derived and model paths agree on every limb lead.
  {
    const d = derived('rotate')
    const mM = model('rotate')
    for (const l of ['I', 'II', 'III', 'aVR', 'aVL', 'aVF'] as LeadId[]) {
      const flat = rms(d[l]) < 0.02 * rms(sigNsr.leads.II)
      check(
        `rotation: model≈algebra on ${l}`,
        flat ? rms(mM[l]) < 0.02 * rms(sigNsr.leads.II) : correlation(mM[l], d[l]) > 0.999,
        flat ? 'both flat' : '',
      )
    }
  }
}

// ---------------------------------------------------------------------------
console.log('=== Chest-electrode physics ===')
{
  const v4r = buildSignals(nsr, moveCable(standardMontage(), 'V4', V4R))
  const stdNet = netQrs(sigNsr, 'V4', wNsr)
  const mirNet = netQrs(v4r, 'V4', wNsr)
  check('V4 → V4R flips net QRS polarity', stdNet > 0 && mirNet < 0, `${f1(stdNet)} → ${f1(mirNet)}`)

  const mir = buildSignals(mirrorStrip(nsr), std)
  check('dextrocardia (mirrored heart): I inverts', netQrs(mir, 'I', wNsr) < 0 && netQrs(sigNsr, 'I', wNsr) > 0)
  check('dextrocardia: R-progression reverses (V6 net ↓)', netQrs(mir, 'V6', wNsr) < netQrs(sigNsr, 'V6', wNsr))

  // informational only (tuned at M4): high V1–V2 terminal behavior
  const high = buildSignals(nsr, PRESETS['high-v1v2']())
  console.log(`  high V1 terminal-40ms mean: std ${f1((netQrs(sigNsr, 'V1', wNsr)))} → high net ${f1(netQrs(high, 'V1', wNsr))} (tuning lands at M4)`)
}

// ---------------------------------------------------------------------------
console.log('=== Sync warp ===')
{
  const model = modelFiducials(nsr)
  check('model fiducials exist per beat', model.length === nsr.beats.length && model.every((m) => m.qrsOn < m.qrsOff))

  // Fabricated "recording": same beats, uniformly 15% slower + offset.
  const realBeats = model.map((m) => ({
    pOn: m.pOn == null ? undefined : m.pOn * 1.15 + 40,
    qrsOn: m.qrsOn * 1.15 + 40,
    qrsOff: m.qrsOff * 1.15 + 40,
    tEnd: m.tEnd == null ? undefined : m.tEnd * 1.15 + 40,
  }))
  const warp = buildWarp({ beats: realBeats }, model, nsr.durationMs * 1.15 + 80, nsr.durationMs)
  let maxErr = 0
  for (let i = 0; i < realBeats.length; i++) {
    maxErr = Math.max(maxErr, Math.abs(warp(realBeats[i].qrsOn) - model[i].qrsOn))
    maxErr = Math.max(maxErr, Math.abs(warp(realBeats[i].qrsOff) - model[i].qrsOff))
  }
  check('warp hits fiducials (<1 ms)', maxErr < 1, `max ${maxErr.toFixed(3)} ms`)
  let monotonic = true
  let prev = -Infinity
  for (let t = realBeats[0].qrsOn; t < realBeats[realBeats.length - 1].qrsOff; t += 7) {
    const m = warp(t)
    if (m < prev) monotonic = false
    prev = m
  }
  check('warp monotonic across the annotated span', monotonic)

  let threw = false
  try {
    buildWarp({ beats: [{ qrsOn: 100, qrsOff: 50 }] }, model, 1000, nsr.durationMs)
  } catch { threw = true }
  check('out-of-order fiducials throw', threw)
}

// ---------------------------------------------------------------------------
const table = [
  ['NSR', nsr], ['RBBB', rbbb], ['LBBB', lbbb], ['STEMI-ant', stemiAnt],
] as const
console.log('\n=== Measurements ===')
for (const [name, s] of table) {
  const m = measure(s)
  console.log(`${name.padEnd(10)} HR ${m.rateBpm}  PR ${m.prMs ?? '—'}  QRS ${m.qrsMs}  QTc ${m.qtcMs}  axis ${m.axisDeg}°  (axisFn ${meanQrsAxisDeg(s)}°)`)
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL ENGINE CHECKS PASSED ✓')
process.exit(failures ? 1 : 0)
