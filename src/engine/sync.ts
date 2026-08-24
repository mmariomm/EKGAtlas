/**
 * Real-trace ↔ model synchronization. A recording's annotation names per-beat
 * fiducials; the model strip exposes the same fiducials (computed from its
 * sources). The warp maps REAL time → MODEL time piecewise-linearly between
 * matching fiducial knots. The recording is never resampled or warped — the
 * mechanism model bends to the recording, never the reverse.
 */
import { SegmentTag, Strip } from './sources'
import { QRS_K, T_K } from './measure'

export interface BeatFiducials {
  pOn?: number
  qrsOn: number
  qrsOff: number
  tEnd?: number
}

export interface TraceAnnotation {
  beats: BeatFiducials[]
  note?: string
}

/** Per-beat fiducials of a MODEL strip, absolute ms. Beats without QRS
 *  sources (a dropped P, a lone flutter wave) contribute no knots. */
export const modelFiducials = (strip: Strip): BeatFiducials[] => {
  const out = strip.beats.filter((b) => b.sources.some((s) => s.segment === 'QRS' && Math.abs(s.mag) > 0)).map((beat) => {
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
    return {
      // a P fiducial is only meaningful when it precedes its QRS (PR concept);
      // dissociated Ps riding inside a VT complex contribute no knot
      pOn: P && P.s < (QRS ? QRS.s : Infinity) && P.s > -Infinity ? beat.onset + P.s : undefined,
      qrsOn: beat.onset + (QRS ? QRS.s : 0),
      qrsOff: beat.onset + (QRS ? QRS.e : 0),
      tEnd: T ? beat.onset + T.e : undefined,
    }
  })
  // Reconcile neighbours (same rule as the recording annotator): at fast rates
  // a T legitimately runs into the next complex — clamp or drop the fiducials
  // that would break knot ordering, and never emit a negative time.
  for (let i = 0; i < out.length; i++) {
    const b = out[i]
    if (b.pOn != null && b.pOn < 0) delete b.pOn
    const next = out[i + 1]
    if (!next) continue
    const nextStart = next.pOn ?? next.qrsOn
    if (b.tEnd != null && b.tEnd >= nextStart - 8) {
      const clamped = nextStart - 8
      if (clamped > b.qrsOff + 30) b.tEnd = clamped
      else delete b.tEnd
    }
    const prevEnd = b.tEnd ?? b.qrsOff
    if (next.pOn != null && next.pOn <= prevEnd + 4) delete next.pOn
  }
  return out
}

export interface TimeWarp {
  /** Real-trace time (ms) → model time (ms). Monotonic. */
  (realMs: number): number
}

/**
 * Build the warp from matched fiducial knots. Beats are paired in order,
 * cycling over model beats when the recording has more beats than the model
 * loop (the model loop then repeats). Missing fiducials simply drop knots.
 * Throws when either side's fiducials are out of order — a bad annotation
 * must fail at build/test time, never in front of a learner.
 */
export const buildWarp = (
  real: TraceAnnotation,
  model: BeatFiducials[],
  realDurationMs: number,
  modelDurationMs: number,
): TimeWarp => {
  if (!real.beats.length || !model.length) return (t) => (t / realDurationMs) * modelDurationMs

  const knots: { r: number; m: number }[] = []
  for (let i = 0; i < real.beats.length; i++) {
    const rb = real.beats[i]
    const mb = model[i % model.length]
    const loop = Math.floor(i / model.length) * modelDurationMs
    const pairs: [number | undefined, number | undefined][] = [
      [rb.pOn, mb.pOn],
      [rb.qrsOn, mb.qrsOn],
      [rb.qrsOff, mb.qrsOff],
      [rb.tEnd, mb.tEnd],
    ]
    for (const [r, m] of pairs) {
      if (r == null || m == null) continue
      knots.push({ r, m: m + loop })
    }
  }
  for (let i = 1; i < knots.length; i++) {
    if (knots[i].r <= knots[i - 1].r || knots[i].m <= knots[i - 1].m) {
      throw new Error(`sync: fiducials out of order at knot ${i} (real ${knots[i].r}, model ${knots[i].m})`)
    }
  }
  if (knots.length < 2) return (t) => (t / realDurationMs) * modelDurationMs

  // Extend the ends proportionally so the whole strip maps.
  const first = knots[0]
  const last = knots[knots.length - 1]

  return (realMs: number) => {
    const t = ((realMs % realDurationMs) + realDurationMs) % realDurationMs
    if (t <= first.r) {
      // before the first knot: keep the first segment's local rate
      const rate = (knots[1].m - first.m) / (knots[1].r - first.r)
      return (first.m - (first.r - t) * rate + modelDurationMs * 4) % modelDurationMs
    }
    if (t >= last.r) {
      const prev = knots[knots.length - 2]
      const rate = (last.m - prev.m) / (last.r - prev.r)
      return (last.m + (t - last.r) * rate) % modelDurationMs
    }
    let lo = 0
    let hi = knots.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (knots[mid].r <= t) lo = mid
      else hi = mid
    }
    const a = knots[lo]
    const b = knots[hi]
    const f = (t - a.r) / (b.r - a.r)
    return (a.m + f * (b.m - a.m)) % modelDurationMs
  }
}
