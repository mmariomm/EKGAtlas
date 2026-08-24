/**
 * Shared pipeline helpers: PTB-XL metadata parsing, WFDB format-16 reading
 * (verified against the per-signal checksums in every .hea), and paths.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export const DIR = resolve(import.meta.dirname)
export const RAW = resolve(DIR, 'raw')
export const OUT = resolve(DIR, '../../public/recordings')
export const BASE_URL = 'https://physionet.org/files/ptb-xl/1.0.3'

mkdirSync(RAW, { recursive: true })
mkdirSync(OUT, { recursive: true })

/** Minimal CSV line parser (quoted fields, no embedded newlines in PTB-XL). */
const parseLine = (line) => {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

let dbCache = null
/** The PTB-XL metadata table as objects keyed by header names. */
export const loadDatabase = () => {
  if (dbCache) return dbCache
  const text = readFileSync(resolve(RAW, 'ptbxl_database.csv'), 'utf8')
  const lines = text.split('\n').filter((l) => l.length)
  const header = parseLine(lines[0])
  dbCache = lines.slice(1).map((l) => {
    const f = parseLine(l)
    const row = {}
    header.forEach((h, i) => { row[h] = f[i] })
    row.scp = {}
    for (const m of row.scp_codes.matchAll(/'([A-Z0-9_]+)':\s*([0-9.]+)/g)) {
      row.scp[m[1]] = Number(m[2])
    }
    return row
  })
  return dbCache
}

/** Fetch one record's .hea + .dat into raw/ (skips when present). */
export const fetchRecord = async (filenameHr) => {
  for (const ext of ['hea', 'dat']) {
    const rel = `${filenameHr}.${ext}`
    const local = resolve(RAW, rel.replaceAll('/', '_'))
    if (existsSync(local)) continue
    const res = await fetch(`${BASE_URL}/${rel}`)
    if (!res.ok) throw new Error(`fetch ${rel}: HTTP ${res.status}`)
    writeFileSync(local, Buffer.from(await res.arrayBuffer()))
  }
}

const LEAD_NAME = {
  I: 'I', II: 'II', III: 'III', AVR: 'aVR', AVL: 'aVL', AVF: 'aVF',
  V1: 'V1', V2: 'V2', V3: 'V3', V4: 'V4', V5: 'V5', V6: 'V6',
}

/**
 * Read a PTB-XL record (WFDB format 16, one interleaved .dat) → per-lead mV
 * Float64Arrays. Every signal is verified against its .hea checksum (16-bit
 * signed sum of samples) — the parser cannot silently misread.
 */
export const readRecord = (filenameHr) => {
  const heaPath = resolve(RAW, `${filenameHr}.hea`.replaceAll('/', '_'))
  const datPath = resolve(RAW, `${filenameHr}.dat`.replaceAll('/', '_'))
  const hea = readFileSync(heaPath, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  const [, nsigS, fsS, nS] = hea[0].trim().split(/\s+/)
  const nsig = Number(nsigS)
  const fs = Number(fsS)
  const n = Number(nS)
  const sigs = hea.slice(1, 1 + nsig).map((l) => {
    const f = l.trim().split(/\s+/)
    // file fmt gain(baseline)/units adcres adczero initval checksum blocksize desc
    const gm = f[2].match(/([0-9.]+)(?:\(([-0-9]+)\))?(?:\/(\S+))?/)
    return {
      fmt: f[1],
      gain: Number(gm[1]),
      baseline: gm[2] ? Number(gm[2]) : 0,
      checksum: Number(f[6]),
      name: LEAD_NAME[f[8]] ?? f[8],
    }
  })
  if (sigs.some((s) => s.fmt !== '16')) throw new Error('unexpected WFDB format (want 16)')

  const buf = readFileSync(datPath)
  if (buf.length < nsig * n * 2) throw new Error(`dat too short: ${buf.length}`)
  const leads = {}
  sigs.forEach((s, si) => {
    const mv = new Float64Array(n)
    let sum = 0
    for (let i = 0; i < n; i++) {
      const raw = buf.readInt16LE((i * nsig + si) * 2)
      sum = (sum + raw) & 0xffff
      mv[i] = (raw - s.baseline) / s.gain
    }
    // .hea may print the 16-bit checksum signed or unsigned — compare mod 2^16.
    const want = ((s.checksum % 0x10000) + 0x10000) % 0x10000
    if (sum !== want) throw new Error(`checksum mismatch on ${s.name}: got ${sum}, want ${want}`)
    leads[s.name] = mv
  })
  return { fs, n, leads }
}

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
export const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v))

export const loadManifest = () => {
  const p = resolve(DIR, 'manifest.json')
  return existsSync(p) ? readJson(p) : { assets: {} }
}
export const saveManifest = (m) =>
  writeFileSync(resolve(DIR, 'manifest.json'), JSON.stringify(m, null, 2) + '\n')
