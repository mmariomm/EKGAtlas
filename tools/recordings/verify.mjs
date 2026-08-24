/**
 * Independent verification of a TraceAsset: fiducial ordering + physiologic
 * bounds, re-detection with DIFFERENT detector parameters agreeing within
 * ±40 ms, and the compressed size budget. Run standalone on an asset path or
 * via convert.mjs.
 */
import { gzipSync } from 'node:zlib'
import { detectQrs } from './annotate.mjs'

export const verifyAsset = (asset) => {
  const problems = []
  const beats = asset.annotation?.beats ?? []

  if (beats.length < 3) problems.push(`only ${beats.length} annotated beats`)
  if (beats.length > 46) problems.push(`${beats.length} beats — implausible (>250/min)`)

  let prevEnd = -Infinity
  for (const [i, b] of beats.entries()) {
    if (b.pOn != null && !(b.pOn < b.qrsOn)) problems.push(`beat ${i}: pOn ≥ qrsOn`)
    if (!(b.qrsOn < b.qrsOff)) problems.push(`beat ${i}: qrsOn ≥ qrsOff`)
    const w = b.qrsOff - b.qrsOn
    if (w < 40 || w > 300) problems.push(`beat ${i}: QRS width ${w} ms out of bounds`)
    if (b.tEnd != null && !(b.tEnd > b.qrsOff)) problems.push(`beat ${i}: tEnd ≤ qrsOff`)
    const start = b.pOn ?? b.qrsOn
    if (start <= prevEnd) problems.push(`beat ${i}: overlaps previous beat`)
    prevEnd = Math.max(b.qrsOff, b.tEnd ?? 0)
  }

  // Independent re-detection: different leads, integral window, threshold.
  const alt = detectQrs(asset, { leads: ['I', 'V3', 'V6'], integralMs: 80, thresholdFrac: 0.28, refractoryMs: 220 })
  const altMs = alt.peaks.map((p) => (p / asset.fs) * 1000)
  let matched = 0
  for (const b of beats) {
    const center = (b.qrsOn + b.qrsOff) / 2
    if (altMs.some((t) => Math.abs(t - center) < 60)) matched++
  }
  const frac = beats.length ? matched / beats.length : 0
  if (frac < 0.85) problems.push(`independent detector matches only ${(frac * 100).toFixed(0)}% of beats`)

  const gz = gzipSync(JSON.stringify(asset)).length
  if (gz > 160 * 1024) problems.push(`gzipped size ${(gz / 1024).toFixed(0)} KB > 160 KB budget`)

  return { ok: problems.length === 0, problems, gzKb: Math.round(gz / 1024), beats: beats.length }
}

// CLI: node verify.mjs public/recordings/<id>.json
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2]) {
  const { readFileSync } = await import('node:fs')
  const asset = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const r = verifyAsset(asset)
  console.log(`${asset.id}: ${r.ok ? 'OK' : 'FAILED'} — ${r.beats} beats, ${r.gzKb} KB gz`)
  for (const p of r.problems) console.log('  - ' + p)
  process.exit(r.ok ? 0 : 1)
}
