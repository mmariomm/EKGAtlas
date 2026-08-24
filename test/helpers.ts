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
    tStart: T ? base + T.relStart : null,
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
