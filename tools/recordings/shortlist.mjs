/**
 * Shortlist PTB-XL candidates for a card from its spec (specs/<cardId>.json).
 * Scoring prefers human-validated, clean-signal, mid-life records. Prints the
 * top candidates; `--fetch N` downloads the top N records for conversion.
 * Usage: node shortlist.mjs <cardId> [--fetch 6]
 */
import { resolve } from 'node:path'
import { DIR, fetchRecord, loadDatabase, readJson } from './lib.mjs'

const cardId = process.argv[2]
if (!cardId) { console.error('usage: shortlist.mjs <cardId> [--fetch N]'); process.exit(1) }
const fetchN = process.argv.includes('--fetch')
  ? Number(process.argv[process.argv.indexOf('--fetch') + 1] || 6)
  : 0

const spec = readJson(resolve(DIR, 'specs', `${cardId}.json`))
const db = loadDatabase()

// PTB-XL stores rhythm statements with likelihood 0.0 by convention; diagnostic
// statements carry a percentage. "Present" = exists (rhythm) or ≥50 (diagnostic).
const RHYTHM = new Set(['SR', 'AFIB', 'AFLT', 'PACE', 'SVTAC', 'PSVT', 'STACH', 'SBRAD', 'SARRH', 'BIGU', 'TRIGU', 'SVARR'])
const has = (row, code) => {
  const v = row.scp[code]
  if (v == null) return false
  return RHYTHM.has(code) ? true : v >= 50
}

const candidates = db.filter((row) => {
  if (spec.include?.scpAny && !spec.include.scpAny.some((c) => has(row, c))) return false
  if (spec.include?.scpAll && !spec.include.scpAll.every((c) => has(row, c))) return false
  if (spec.exclude?.scpAny && spec.exclude.scpAny.some((c) => row.scp[c] != null)) return false
  const age = Number(row.age)
  if (spec.age && (age < spec.age[0] || age > spec.age[1])) return false
  return true
})

const score = (row) => {
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

candidates.sort((a, b) => score(b) - score(a))
const top = candidates.slice(0, spec.maxCandidates ?? 25)
console.log(`${cardId}: ${candidates.length} candidates, showing ${top.length}`)
for (const r of top.slice(0, 12)) {
  console.log(
    `  ecg ${r.ecg_id.padStart(5)}  score ${score(r).toFixed(1)}  age ${r.age} ${r.sex === '0' ? 'M' : 'F'}  ` +
    `scp ${Object.entries(r.scp).filter(([, v]) => v >= 0).map(([k, v]) => `${k}:${v}`).join(' ')}` +
    `${r.baseline_drift ? '  drift:' + r.baseline_drift : ''}${r.static_noise ? '  noise:' + r.static_noise : ''}`,
  )
}

if (fetchN) {
  for (const r of top.slice(0, fetchN)) {
    process.stdout.write(`fetching ecg ${r.ecg_id} … `)
    await fetchRecord(r.filename_hr)
    console.log('ok')
  }
}
