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
  check('sim-STEMI: ST↑ in V2', netST(s, sig, 'V2') > 0.5)
  check('sim-STEMI: ST↑ in V3', netST(s, sig, 'V3') > 0.5)
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED ✓')
process.exit(failures ? 1 : 0)
