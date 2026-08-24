/**
 * Deterministic builders that turn a card's MechanismSpec into an engine Strip.
 * Solver specs run the propagation model; authored specs use fixed source
 * tables (no runtime randomness — everything is reproducible and testable).
 */
import { MechanismSpec } from './schema'
import { simulateBeat, tileState } from '../engine/propagate'
import { Beat, Source, Strip, WirePulse } from '../engine/sources'

/** Solver NSR beat with the atrial (P) sources and SA wire removed. */
export const ventricularOnlyBeat = (onsetMs: number): Beat => {
  const b = simulateBeat({ pace: 'SA' }, onsetMs)
  return {
    ...b,
    sources: b.sources.filter((s) => s.segment !== 'P'),
    wires: b.wires.filter((w) => w.structure !== 'SA'),
  }
}

/**
 * Fibrillatory atrial activity: many small, disorganized lobes. Directions and
 * timings come from a fixed table (seeded once, committed — not runtime RNG).
 */
export const fibrillationSources = (windowMs: number): Source[] => {
  // 16 pseudo-directions from a fixed linear-congruential sequence.
  const out: Source[] = []
  let s = 1234567
  const rnd = () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }
  const n = Math.floor(windowMs / 90)
  for (let i = 0; i < n; i++) {
    const t = i * 90 + rnd() * 40
    out.push({
      dir: [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1],
      mag: 0.018 + rnd() * 0.02,
      center: t,
      width: 16 + rnd() * 14,
      segment: 'P',
      glow: i % 3 === 0 ? { structures: ['RA', 'LA'], kind: 'atria', start: t - 20, end: t + 30 } : undefined,
    })
  }
  return out
}

/** Irregularly-irregular ventricular response (fixed RR table, cv ≈ 0.19). */
export const AFIB_RR_MS = [640, 890, 700, 1020, 760, 580, 940]

export const buildAfibStrip = (): Strip => {
  const beats: Beat[] = []
  let t = 0
  for (const rr of AFIB_RR_MS) {
    const b = ventricularOnlyBeat(t)
    // The AV node is bombarded continuously — flicker it before each conducted beat.
    const wires: WirePulse[] = [
      { structure: 'AV', start: -60, end: 20, kind: 'av', note: 'AV node bombarded — passes beats at random' },
      ...b.wires,
    ]
    beats.push({ ...b, wires })
    t += rr
  }
  const durationMs = t
  // Continuous fibrillatory shimmer across the whole loop.
  beats[0] = { ...beats[0], sources: [...fibrillationSources(durationMs), ...beats[0].sources] }
  return { beats, durationMs }
}

/** Build the Strip for any card mechanism. */
export const buildMechanismStrip = (m: MechanismSpec): Strip => {
  if (m.kind === 'solver') {
    const { rrMs, beats, ...state } = m.state ?? {}
    return tileState(state, beats ?? 3, rrMs ?? 800)
  }
  if (m.authoredId && AUTHORED[m.authoredId]) return AUTHORED[m.authoredId]()
  const beats = (m.authoredBeats ?? []).map((b) => ({
    onset: b.onsetMs,
    sources: b.sources,
    wires: b.wires ?? [],
  }))
  const last = beats[beats.length - 1]
  const durationMs = last ? Math.max(...beats.map((b) => b.onset)) + 900 : 1000
  return { beats, durationMs }
}

/** Named authored builders (referenced by cards via mechanism.authoredId). */
export const AUTHORED: Record<string, () => Strip> = {
  afib: buildAfibStrip,
}
