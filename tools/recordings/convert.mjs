/**
 * Convert a fetched PTB-XL record into a TraceAsset JSON (recorded tier),
 * then auto-annotate fiducials and verify. The asset id names the card it was
 * curated for. Usage: node convert.mjs <cardId> <ecgId>
 */
import { resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { DIR, OUT, loadDatabase, loadManifest, readJson, readRecord, saveManifest, writeJson } from './lib.mjs'
import { annotate } from './annotate.mjs'
import { verifyAsset } from './verify.mjs'

const [cardId, ecgId] = process.argv.slice(2)
if (!cardId || !ecgId) { console.error('usage: convert.mjs <cardId> <ecgId>'); process.exit(1) }

const row = loadDatabase().find((r) => r.ecg_id === String(ecgId))
if (!row) throw new Error(`ecg_id ${ecgId} not in metadata`)

const rec = readRecord(row.filename_hr)
const UNITS = 200 // int value 200 = 1 mV (5 µV resolution)

const leads = {}
for (const [name, mv] of Object.entries(rec.leads)) {
  leads[name] = Array.from(mv, (v) => Math.round(v * UNITS))
}

const asset = {
  id: `ptbxl-${ecgId}-${cardId}`,
  provenance: {
    tier: 'recorded',
    sourceRecord: `PTB-XL ecg_id ${ecgId}`,
    license: 'CC BY 4.0',
  },
  fs: rec.fs,
  unitsPerMv: UNITS,
  durationMs: Math.round((rec.n / rec.fs) * 1000),
  leads,
  annotation: { beats: [] },
}

asset.annotation = annotate(asset)

// Card spec may suppress P fiducials (AF/flutter: organized P onsets do not
// exist; the detector must not present fibrillatory bumps as P waves).
const specPath = resolve(DIR, 'specs', `${cardId}.json`)
const spec = existsSync(specPath) ? readJson(specPath) : {}
if (spec.annotate?.suppressP) for (const b of asset.annotation.beats) delete b.pOn

const path = resolve(OUT, `${asset.id}.json`)
writeJson(path, asset)

const report = verifyAsset(asset)
if (!report.ok) {
  console.error(`VERIFY FAILED for ${asset.id}:`)
  for (const p of report.problems) console.error('  - ' + p)
  process.exit(1)
}

const manifest = loadManifest()
manifest.assets[asset.id] = {
  cardId,
  ecgId: Number(ecgId),
  source: row.filename_hr,
  age: Number(row.age),
  sex: row.sex === '0' ? 'M' : 'F',
  scp: row.scp,
  beats: asset.annotation.beats.length,
  bytes: statSync(path).size,
  convertedAt: new Date().toISOString().slice(0, 10),
}
saveManifest(manifest)
console.log(`${asset.id}: ${asset.annotation.beats.length} beats, ${(statSync(path).size / 1024).toFixed(0)} KB — verified ✓`)
