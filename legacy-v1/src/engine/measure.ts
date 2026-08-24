/**
 * Clinical measurements, computed from the model the way a machine prints them
 * at the top of every ECG: heart rate, PR, QRS duration, QT/QTc, and axis.
 *
 * Wave boundaries are derived directly from the dipole sources of the
 * representative beat, with clinically tuned extents (a Gaussian wave is
 * "over" by ~2σ for the sharp P/QRS, ~2.4σ for the broad T), so the intervals
 * land in realistic ranges.
 */
import { SegmentTag, Strip } from './types'
import { meanQrsAxisDeg } from './synthesize'

export interface Measurements {
  rateBpm: number
  prMs: number | null
  qrsMs: number
  qtMs: number
  qtcMs: number
  axisDeg: number
}

const QRS_K = 2.0 // σ-multiples to the foot/end of the sharp P and QRS waves
const T_K = 2.4 //   the broad T returns to baseline a bit later

const repBeat = (strip: Strip) =>
  strip.beats.find(
    (b) => b.sources.some((s) => s.segment === 'P') && b.sources.some((s) => s.segment === 'QRS' && s.mag > 0),
  ) ?? strip.beats[0]

export const measure = (strip: Strip): Measurements => {
  const beat = repBeat(strip)
  const ext = (seg: SegmentTag, k: number) => {
    const ss = beat.sources.filter((s) => s.segment === seg && s.mag > 0)
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
  const qtcMs = qtMs > 0 ? Math.round(qtMs / Math.sqrt(rr / 1000)) : 0

  return { rateBpm, prMs, qrsMs, qtMs, qtcMs, axisDeg: meanQrsAxisDeg(strip) }
}
