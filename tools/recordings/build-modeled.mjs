/**
 * Build modeled/variance TraceAssets from the engine (run with tsx so the TS
 * engine imports work): node --import tsx/esm tools/recordings/build-modeled.mjs
 * Output uses the same TraceAsset shape as recorded assets — one input type
 * for TraceView — with honest `modeled` provenance.
 */
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { buildSignals } from '../../src/engine/synthesize.ts'
import { modelFiducials } from '../../src/engine/sync.ts'
import { ALL_LEADS } from '../../src/engine/leads.ts'
import { hyperkStrip, tcaStrip, tdpStrip } from '../../src/content/mechanisms.ts'
import { simulateBeat } from '../../src/engine/propagate.ts'

const OUT = resolve(import.meta.dirname, '../../public/recordings')
const UNITS = 200
const DT = 2

const toAsset = (id, strip, modelNote) => {
  const sig = buildSignals(strip, undefined, DT)
  const leads = {}
  for (const l of ALL_LEADS) {
    leads[l] = Array.from(sig.leads[l], (v) => Math.round(v * UNITS))
  }
  const beats = modelFiducials(strip).map((b) => ({
    ...(b.pOn != null ? { pOn: Math.round(b.pOn) } : {}),
    qrsOn: Math.round(b.qrsOn),
    qrsOff: Math.round(b.qrsOff),
    ...(b.tEnd != null ? { tEnd: Math.round(b.tEnd) } : {}),
  }))
  const asset = {
    id,
    provenance: { tier: 'modeled', modelNote },
    fs: 1000 / DT,
    unitsPerMv: UNITS,
    durationMs: strip.durationMs,
    leads,
    annotation: { beats },
  }
  writeFileSync(resolve(OUT, `${id}.json`), JSON.stringify(asset))
  console.log(`${id}: ${beats.length} beats, ${strip.durationMs} ms`)
}

// Brugada-phenocopy hyperK variant: mid-stage morph + an RVOT coved-STE source.
const brugadoid = () => {
  const s = hyperkStrip(0.55)
  for (const b of s.beats) {
    const lastQrs = Math.max(...b.sources.filter((x) => x.segment === 'QRS').map((x) => x.center))
    b.sources.push({
      dir: [-0.35, -0.3, 0.88], mag: 0.42, center: lastQrs + 55, width: 40, segment: 'ST',
      pos: [-0.18, -0.12, 0.22],
      glow: { structures: ['RV'], kind: 'injury', start: lastQrs + 20, end: lastQrs + 150 },
    })
  }
  return s
}

const NOTE = 'Synthesized by the conduction model — one possible hyperkalaemia course, not a K→ECG dial'
toAsset('hyperk-model-moderate', hyperkStrip(0.5), NOTE)
toAsset('hyperk-var-nearnormal', hyperkStrip(0.05), 'Variance synthesis: a near-normal trace at a dangerous K — pending published-case reconstruction')
toAsset('hyperk-var-tented', hyperkStrip(0.27), 'Variance synthesis: textbook tented T — pending published-case reconstruction')
toAsset('hyperk-var-bradywide', hyperkStrip(0.78), 'Variance synthesis: slow, wide, P-less — pending published-case reconstruction')
toAsset('hyperk-var-brugadoid', brugadoid(), 'Variance synthesis: Brugada-phenocopy ST coving — pending published-case reconstruction')
toAsset('hyperk-var-sine', hyperkStrip(1), 'Variance synthesis: the sine-wave merge — pending published-case reconstruction')
toAsset('tca-model', tcaStrip(), 'Synthesized: Na-channel blockade — whole-QRS slowing with the terminal aVR vector')
toAsset('longqt-tdp-model', tdpStrip(), 'Synthesized: short-long-short onset of torsades on a drug-stretched QT')

// A clean solver NSR for reference uses elsewhere (kept for completeness).
void simulateBeat
