/**
 * Fast internal test harness (run with `npm test`, via tsx — no browser).
 * Prints a measurements table for every condition and asserts the clinically
 * important properties. This is how morphology/intervals are validated now;
 * Chrome is only for a final visual confirmation.
 */
import { CONDITIONS } from '../src/conditions/index'
import { buildSignals, SignalSet } from '../src/engine/synthesize'
import { phaseRegions, representativeOnset } from '../src/engine/phases'
import { measure } from '../src/engine/measure'
import { LeadId } from '../src/engine/leads'
import { Strip } from '../src/engine/types'

let failures = 0
const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? '✓' : '✗ FAIL —'} ${name}`)
  if (!ok) failures++
}

/** Net signed area of a lead over the QRS window (≈ net deflection: R minus S). */
const netQRS = (strip: Strip, sig: SignalSet, id: LeadId): number => {
  const qrs = phaseRegions(strip).find((r) => r.id === 'QRS')
  if (!qrs) return 0
  const base = representativeOnset(strip)
  let s = 0
  for (let i = 0; i < sig.n; i++) {
    const t = i * sig.dt - base
    if (t >= qrs.relStart && t <= qrs.relEnd) s += sig.leads[id][i]
  }
  return s * sig.dt
}

/** Net signed area over the ST window (for ischemia checks). */
const netST = (strip: Strip, sig: SignalSet, id: LeadId): number => {
  const regions = phaseRegions(strip)
  const qrs = regions.find((r) => r.id === 'QRS')
  const t = regions.find((r) => r.id === 'T')
  if (!qrs || !t) return 0
  const base = representativeOnset(strip)
  let s = 0
  for (let i = 0; i < sig.n; i++) {
    const tt = i * sig.dt - base
    if (tt > qrs.relEnd && tt < t.relStart) s += sig.leads[id][i]
  }
  return s * sig.dt
}

/** Net signed area of a lead over the T window. */
const netT = (strip: Strip, sig: SignalSet, id: LeadId): number => {
  const t = phaseRegions(strip).find((r) => r.id === 'T')
  if (!t) return 0
  const base = representativeOnset(strip)
  let s = 0
  for (let i = 0; i < sig.n; i++) {
    const tt = i * sig.dt - base
    if (tt >= t.relStart && tt <= t.relEnd) s += sig.leads[id][i]
  }
  return s * sig.dt
}

/** Peak (most positive) amplitude of a lead over the T window — captures "peaked" T. */
const peakT = (strip: Strip, sig: SignalSet, id: LeadId): number => {
  const t = phaseRegions(strip).find((r) => r.id === 'T')
  if (!t) return 0
  const base = representativeOnset(strip)
  let m = -Infinity
  for (let i = 0; i < sig.n; i++) {
    const tt = i * sig.dt - base
    if (tt >= t.relStart && tt <= t.relEnd) m = Math.max(m, sig.leads[id][i])
  }
  return m === -Infinity ? 0 : m
}

const byId: Record<string, () => Strip> = {}
for (const c of CONDITIONS) byId[c.id] = c.buildStrip
const stripOf = (id: string) => byId[id]()

console.log('=== Measurements ===')
for (const c of CONDITIONS) {
  const strip = c.buildStrip()
  const sig = buildSignals(strip)
  const m = measure(strip)
  const f = (n: number) => n.toFixed(1)
  console.log(
    `\n${c.shortName.padEnd(20)} HR ${m.rateBpm}  PR ${m.prMs ?? '—'}  QRS ${m.qrsMs}  QT ${m.qtMs}  QTc ${m.qtcMs}  axis ${m.axisDeg}°`,
  )
  console.log(
    `  nets: V1 ${f(netQRS(strip, sig, 'V1'))}  V3 ${f(netQRS(strip, sig, 'V3'))}  V6 ${f(netQRS(strip, sig, 'V6'))}  I ${f(netQRS(strip, sig, 'I'))}  aVR ${f(netQRS(strip, sig, 'aVR'))}`,
  )
}

console.log('\n=== Assertions ===')
for (const c of CONDITIONS) {
  const m = measure(c.buildStrip())
  check(`${c.id}: rate sane`, m.rateBpm >= 30 && m.rateBpm <= 220)
  check(`${c.id}: QRS dur sane`, m.qrsMs > 40 && m.qrsMs < 240)
  check(`${c.id}: QTc sane`, m.qtcMs > 250 && m.qtcMs < 700)
}

const M = (id: string) => measure(stripOf(id))
const net = (id: string, lead: LeadId) => {
  const s = stripOf(id)
  return netQRS(s, buildSignals(s), lead)
}

// NSR baseline
check('NSR: narrow QRS (<120)', M('nsr').qrsMs < 120)
check('NSR: PR normal (120–200)', (M('nsr').prMs ?? 0) >= 120 && (M('nsr').prMs ?? 0) <= 200)
check('NSR: axis normal (−30..+90)', M('nsr').axisDeg >= -30 && M('nsr').axisDeg <= 90)
check('NSR: QTc normal (350–460)', M('nsr').qtcMs >= 350 && M('nsr').qtcMs <= 460)
check('NSR: rS in V1 (net −)', net('nsr', 'V1') < 0)
check('NSR: dominant R in V6 (net +)', net('nsr', 'V6') > 0)
check('NSR: aVR net negative', net('nsr', 'aVR') < 0)

// BBBs wide
check('RBBB: wide QRS (≥120)', M('rbbb').qrsMs >= 120)
check('LBBB: wide QRS (≥120)', M('lbbb').qrsMs >= 120)
check('LBBB: deep QS in V1 (net −)', net('lbbb', 'V1') < 0)

// Solver presets
check('sim-NSR: narrow QRS', M('sim-nsr').qrsMs < 120)
check('sim-NSR: axis normal', M('sim-nsr').axisDeg >= -30 && M('sim-nsr').axisDeg <= 90)
check('sim-NSR: rS in V1', net('sim-nsr', 'V1') < 0)
check('sim-NSR: R in V6', net('sim-nsr', 'V6') > 0)
check('sim-RBBB: wide QRS', M('sim-rbbb').qrsMs >= 120)
check('sim-LBBB: wide QRS', M('sim-lbbb').qrsMs >= 120)
check('sim-LBBB: V1 net negative', net('sim-lbbb', 'V1') < 0)

// Anterior STEMI: ST elevation in anterior leads
{
  const s = stripOf('sim-stemi-ant')
  const sig = buildSignals(s)
  console.log(`\nSTEMI ST: V2 ${netST(s, sig, 'V2').toFixed(1)}  V3 ${netST(s, sig, 'V3').toFixed(1)}  II ${netST(s, sig, 'II').toFixed(1)}  III ${netST(s, sig, 'III').toFixed(1)}  aVF ${netST(s, sig, 'aVF').toFixed(1)}`)
  check('sim-STEMI: ST↑ in V2', netST(s, sig, 'V2') > 0.5)
  check('sim-STEMI: ST↑ in V3', netST(s, sig, 'V3') > 0.5)
  check('sim-STEMI: reciprocal ST↓ inferiorly (III)', netST(s, sig, 'III') < 0)
}

// --- hard catalog ---
const sigOf = (id: string) => { const s = stripOf(id); return { s, g: buildSignals(s) } }

console.log('\n=== Hard catalog key features ===')
{
  const { s, g } = sigOf('hyperkalemia')
  const nsrStrip = stripOf('nsr')
  const peakHyperK = peakT(s, g, 'II')
  const peakNsr = peakT(nsrStrip, buildSignals(nsrStrip), 'II')
  console.log(`hyperK   peakT(II) ${peakHyperK.toFixed(2)} vs NSR ${peakNsr.toFixed(2)}  QTc ${M('hyperkalemia').qtcMs}`)
  check('hyperK: peaked (tall) T in II', peakHyperK > peakNsr * 1.5)
}
{
  const { s, g } = sigOf('sgarbossa')
  console.log(`sgarb    QRS(V6) ${net('sgarbossa', 'V6').toFixed(1)}  ST(V6) ${netST(s, g, 'V6').toFixed(1)}  QRS ${M('sgarbossa').qrsMs}ms`)
  check('Sgarbossa: wide QRS (LBBB)', M('sgarbossa').qrsMs >= 120)
  check('Sgarbossa: concordant STE in V6 (QRS+ & ST+)', net('sgarbossa', 'V6') > 0 && netST(s, g, 'V6') > 0)
}
{
  const { s, g } = sigOf('de-winter')
  console.log(`deWinter ST(V2) ${netST(s, g, 'V2').toFixed(1)}  T(V2) ${netT(s, g, 'V2').toFixed(1)}`)
  check('de Winter: ST↓ in V2', netST(s, g, 'V2') < 0)
  check('de Winter: tall upright T in V2', netT(s, g, 'V2') > 0)
}
{
  const { s, g } = sigOf('wellens')
  console.log(`wellens  T(V2) ${netT(s, g, 'V2').toFixed(1)}  T(V3) ${netT(s, g, 'V3').toFixed(1)}  T(V6) ${netT(s, g, 'V6').toFixed(1)}`)
  check('Wellens: T inversion in V2', netT(s, g, 'V2') < 0)
  check('Wellens: T upright in V6 (localized)', netT(s, g, 'V6') > 0)
}
{
  const { s, g } = sigOf('posterior-mi')
  console.log(`postMI   QRS(V1) ${net('posterior-mi', 'V1').toFixed(1)}  ST(V1) ${netST(s, g, 'V1').toFixed(1)}`)
  check('Posterior MI: tall R in V1 (net +)', net('posterior-mi', 'V1') > 0)
  check('Posterior MI: ST↓ in V1', netST(s, g, 'V1') < 0)
}
{
  const { s, g } = sigOf('brugada')
  console.log(`brugada  ST(V1) ${netST(s, g, 'V1').toFixed(1)}  T(V1) ${netT(s, g, 'V1').toFixed(1)}`)
  check('Brugada: STE in V1', netST(s, g, 'V1') > 0)
  check('Brugada: T inversion in V1', netT(s, g, 'V1') < 0)
}
{
  const mw = M('wpw')
  console.log(`wpw      PR ${mw.prMs}  QRS ${mw.qrsMs}`)
  check('WPW: short PR (<120)', (mw.prMs ?? 999) < 120)
  check('WPW: wide QRS (≥110)', mw.qrsMs >= 110)
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED ✓')
process.exit(failures ? 1 : 0)
