/**
 * Measurement helpers shared by the engine tests and the per-card assertion
 * runner. Definitions match docs/rebuild/04-CARDS.md ("Measurement
 * definitions"): J = QRS end; stShift = mean over J+20..J+80 minus the PR/TP
 * baseline; tPolarity = sign of the largest-|amplitude| T deflection; etc.
 */
import { LeadId } from '../src/engine/leads'
import { SignalSet } from '../src/engine/synthesize'
import { Strip } from '../src/engine/sources'
import { phaseRegions, representativeOnset } from '../src/engine/phases'

export interface Windows {
  /** absolute ms of the representative beat's landmarks */
  pStart: number | null
  qrsStart: number
  qrsEnd: number
  tStart: number | null
  tEnd: number | null
}

export const windowsOf = (strip: Strip): Windows => {
  const base = representativeOnset(strip)
  const regions = phaseRegions(strip)
  const g = (id: string) => regions.find((r) => r.id === id) ?? null
  const P = g('P')
  const QRS = g('QRS')
  const T = g('T')
  if (!QRS) throw new Error('no QRS region')
  return {
    pStart: P ? base + P.relStart : null,
    qrsStart: base + QRS.relStart,
    qrsEnd: base + QRS.relEnd,
    // A very wide QRS can overlap the earliest T-source tail; the T window
    // must never reach back into the QRS (it would read the S wave as a "T").
    tStart: T ? Math.max(base + T.relStart, base + QRS.relEnd + 20) : null,
    tEnd: T ? base + T.relEnd : null,
  }
}

const meanIn = (sig: SignalSet, lead: LeadId, t0: number, t1: number): number => {
  let s = 0
  let n = 0
  for (let i = 0; i < sig.n; i++) {
    const t = i * sig.dt
    if (t >= t0 && t <= t1) { s += sig.leads[lead][i]; n++ }
  }
  return n ? s / n : 0
}

const extremeIn = (sig: SignalSet, lead: LeadId, t0: number, t1: number, sign: 1 | -1): number => {
  let m = -Infinity
  for (let i = 0; i < sig.n; i++) {
    const t = i * sig.dt
    if (t >= t0 && t <= t1) m = Math.max(m, sign * sig.leads[lead][i])
  }
  return m === -Infinity ? 0 : sign * m
}

/** Baseline: mean over the 40 ms before QRS onset (PR segment / TP if no P). */
export const baselineOf = (sig: SignalSet, lead: LeadId, w: Windows): number =>
  meanIn(sig, lead, w.qrsStart - 44, w.qrsStart - 4)

/** ST shift in mV over J..J+40 relative to the baseline (clinical convention
 *  measures ST deviation AT the J point; the short window averages noise). */
export const stShift = (sig: SignalSet, lead: LeadId, w: Windows): number =>
  meanIn(sig, lead, w.qrsEnd, w.qrsEnd + 40) - baselineOf(sig, lead, w)

/** Net signed area over the QRS window (R minus S dominance). */
export const netQrs = (sig: SignalSet, lead: LeadId, w: Windows): number => {
  let s = 0
  for (let i = 0; i < sig.n; i++) {
    const t = i * sig.dt
    if (t >= w.qrsStart && t <= w.qrsEnd) s += sig.leads[lead][i]
  }
  return s * sig.dt
}

/** Sign of the largest-|amplitude| deflection in the T window (+1 / -1 / 0). */
export const tPolarity = (sig: SignalSet, lead: LeadId, w: Windows): number => {
  if (w.tStart == null || w.tEnd == null) return 0
  const base = baselineOf(sig, lead, w)
  const up = extremeIn(sig, lead, w.tStart, w.tEnd, 1) - base
  const dn = extremeIn(sig, lead, w.tStart, w.tEnd, -1) - base
  return Math.abs(up) >= Math.abs(dn) ? Math.sign(up) : Math.sign(dn)
}

/** Peak positive T amplitude above baseline, mV. */
export const tPeak = (sig: SignalSet, lead: LeadId, w: Windows): number =>
  extremeIn(sig, lead, w.tStart ?? w.qrsEnd, w.tEnd ?? w.qrsEnd + 300, 1) - baselineOf(sig, lead, w)

/** R amplitude / S depth within the QRS window. */
export const rsRatio = (sig: SignalSet, lead: LeadId, w: Windows): number => {
  const base = baselineOf(sig, lead, w)
  const r = Math.max(0, extremeIn(sig, lead, w.qrsStart, w.qrsEnd, 1) - base)
  const s = Math.max(1e-6, base - extremeIn(sig, lead, w.qrsStart, w.qrsEnd, -1))
  return r / s
}

/** Mean amplitude of the terminal 40 ms of the QRS (for terminal-R checks). */
export const terminalQrsMean = (sig: SignalSet, lead: LeadId, w: Windows): number =>
  meanIn(sig, lead, w.qrsEnd - 40, w.qrsEnd) - baselineOf(sig, lead, w)

/** Peak amplitude of a lead over the whole strip (calibration checks). */
export const peakAmplitude = (sig: SignalSet, lead: LeadId): number => {
  let m = 0
  for (let i = 0; i < sig.n; i++) m = Math.max(m, Math.abs(sig.leads[lead][i]))
  return m
}

/** RMS of a signal array. */
export const rms = (a: Float32Array): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s / a.length)
}

/** Pearson correlation of two equal-length arrays. */
export const correlation = (a: Float32Array, b: Float32Array): number => {
  const n = Math.min(a.length, b.length)
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n
  mb /= n
  let sab = 0
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    sab += da * db
    sa += da * da
    sb += db * db
  }
  return sab / Math.sqrt(sa * sb || 1)
}

/** Coefficient of variation of RR intervals given beat onsets. */
export const rrCv = (onsets: number[]): number => {
  if (onsets.length < 3) return 0
  const rr = onsets.slice(1).map((t, i) => t - onsets[i])
  const mean = rr.reduce((a, b) => a + b, 0) / rr.length
  const sd = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length)
  return sd / mean
}

// ---------------------------------------------------------------------------
// Real-recording (TraceAsset) measurement — same helpers, annotation windows.
// ---------------------------------------------------------------------------

export interface AssetJson {
  id: string
  fs: number
  unitsPerMv: number
  durationMs: number
  leads: Record<string, number[]>
  annotation: { beats: { pOn?: number; qrsOn: number; qrsOff: number; tEnd?: number }[] }
}

/** Adapt an asset to the SignalSet shape so every measure above applies. */
export const assetSignals = (a: AssetJson): SignalSet => {
  const leads = {} as SignalSet['leads']
  for (const [name, arr] of Object.entries(a.leads)) {
    const f = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i++) f[i] = arr[i] / a.unitsPerMv
    leads[name as LeadId] = f
  }
  return { dt: 1000 / a.fs, durationMs: a.durationMs, n: a.leads.II?.length ?? 0, leads }
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/** Windows for the representative beat (median-QRS-width beat with a P if any). */
export const assetWindows = (a: AssetJson): Windows => {
  const beats = a.annotation.beats
  if (!beats.length) throw new Error(`${a.id}: no annotated beats`)
  const withP = beats.filter((b) => b.pOn != null && b.tEnd != null)
  const pool = withP.length ? withP : beats
  const widths = pool.map((b) => b.qrsOff - b.qrsOn)
  const med = median(widths)
  const rep = pool.reduce((best, b) =>
    Math.abs(b.qrsOff - b.qrsOn - med) < Math.abs(best.qrsOff - best.qrsOn - med) ? b : best,
  )
  return {
    pStart: rep.pOn ?? null,
    qrsStart: rep.qrsOn,
    qrsEnd: rep.qrsOff,
    tStart: rep.qrsOff + 80,
    tEnd: rep.tEnd ?? rep.qrsOff + 360,
  }
}

export interface TraceMeasurements {
  rateBpm: number
  qrsMs: number
  prMs: number | null
  qtcMs: number | null
}

export const measureAsset = (a: AssetJson): TraceMeasurements => {
  const beats = a.annotation.beats
  const rr = beats.slice(1).map((b, i) => b.qrsOn - beats[i].qrsOn)
  const rrMed = median(rr)
  const prVals = beats.filter((b) => b.pOn != null).map((b) => b.qrsOn - (b.pOn as number))
  const qtVals = beats.filter((b) => b.tEnd != null).map((b) => (b.tEnd as number) - b.qrsOn)
  const qtMed = qtVals.length ? median(qtVals) : null
  return {
    rateBpm: rrMed ? Math.round(60000 / rrMed) : 0,
    qrsMs: Math.round(median(beats.map((b) => b.qrsOff - b.qrsOn))),
    prMs: prVals.length >= Math.max(2, beats.length * 0.5) ? Math.round(median(prVals)) : null,
    qtcMs: qtMed && rrMed ? Math.round(qtMed / Math.sqrt(rrMed / 1000)) : null,
  }
}

export const assetRrCv = (a: AssetJson): number =>
  rrCv(a.annotation.beats.map((b) => b.qrsOn))

/** Mean amplitude of the first 30 ms of the QRS (septal q check). */
export const initialQrsMean = (sig: SignalSet, lead: LeadId, w: Windows): number => {
  let s = 0
  let n = 0
  for (let i = 0; i < sig.n; i++) {
    const t = i * sig.dt
    if (t >= w.qrsStart && t <= w.qrsStart + 30) { s += sig.leads[lead][i]; n++ }
  }
  return (n ? s / n : 0) - baselineOf(sig, lead, w)
}

/** Mean pairwise correlation of pre-QRS windows — high in sinus, low in AF. */
export const preQrsConsistency = (a: AssetJson, lead: LeadId = 'II'): number => {
  const sig = assetSignals(a)
  const samples = sig.leads[lead]
  if (!samples) return 0
  const win = Math.round(150 / sig.dt)
  const gap = Math.round(40 / sig.dt)
  const segs: Float32Array[] = []
  for (const b of a.annotation.beats) {
    const end = Math.round(b.qrsOn / sig.dt) - gap
    const start = end - win
    if (start < 0) continue
    segs.push(samples.slice(start, end))
  }
  if (segs.length < 4) return 0
  let sum = 0
  let n = 0
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) { sum += correlation(segs[i], segs[j]); n++ }
  }
  return n ? sum / n : 0
}
