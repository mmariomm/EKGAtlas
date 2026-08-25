/**
 * Clinical measurements, computed from the model the way a machine prints
 * them: rate, PR, QRS duration, QT/QTc, axis. Wave boundaries derive from the
 * dipole sources of the representative beat with clinically tuned extents
 * (a Gaussian is "over" by ~2σ for sharp waves, ~2.4σ for the broad T).
 */
import { SegmentTag, Strip } from './sources'
import { meanQrsAxisDeg } from './synthesize'

export interface Measurements {
  rateBpm: number
  prMs: number | null
  qrsMs: number
  qtMs: number
  qtcMs: number
  qtcFridericiaMs: number
  axisDeg: number
}

export const QRS_K = 2.0
export const T_K = 2.4

const repBeat = (strip: Strip) =>
  strip.beats.find(
    (b) => b.sources.some((s) => s.segment === 'P') && b.sources.some((s) => s.segment === 'QRS' && s.mag > 0),
  ) ?? strip.beats[0]

export const measure = (strip: Strip): Measurements => {
  const beat = repBeat(strip)
  const ext = (seg: SegmentTag, k: number) => {
    const ss = beat.sources.filter((s) => s.segment === seg && Math.abs(s.mag) > 0)
    if (!ss.length) return null
    return {
      s: Math.min(...ss.map((s) => s.center - k * s.width)),
      e: Math.max(...ss.map((s) => s.center + k * s.width)),
    }
  }
  const P = ext('P', QRS_K)
  const QRS = ext('QRS', QRS_K)
  const T = ext('T', T_K)

  const rr = strip.beats.length >= 2 ? strip.beats[1].onset - strip.beats[0].onset : strip.durationMs
  const rateBpm = Math.round(60000 / rr)
  const prMs = P && QRS ? Math.round(QRS.s - P.s) : null
  const qrsMs = QRS ? Math.round(QRS.e - QRS.s) : 0
  const qtMs = QRS && T ? Math.round(T.e - QRS.s) : 0
  const rrSec = rr / 1000
  const qtcMs = qtMs > 0 ? Math.round(qtMs / Math.sqrt(rrSec)) : 0
  const qtcFridericiaMs = qtMs > 0 ? Math.round(qtMs / Math.cbrt(rrSec)) : 0

  return { rateBpm, prMs, qrsMs, qtMs, qtcMs, qtcFridericiaMs, axisDeg: meanQrsAxisDeg(strip) }
}
