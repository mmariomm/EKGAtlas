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

// ---------------------------------------------------------------------------
// Hyperkalemia — ONE POSSIBLE TRAJECTORY (the morph is honesty-labeled; real
// hyperK is variable, which is the whole point of the variance gallery).
// Keyframes: tented T → P flattens/PR stretches → QRS widens → sine merge.
// ---------------------------------------------------------------------------

interface KFrame {
  tMag: number; tWidth: number; pMag: number; prExtra: number
  qrsWidth: number; qrsMag: number; rr: number
}
const K_FRAMES: KFrame[] = [
  { tMag: 1.15, tWidth: 0.92, pMag: 1, prExtra: 0, qrsWidth: 1, qrsMag: 1, rr: 800 },   // near-normal
  { tMag: 1.9, tWidth: 0.55, pMag: 0.9, prExtra: 10, qrsWidth: 1.05, qrsMag: 1, rr: 820 }, // tented T
  { tMag: 2.1, tWidth: 0.5, pMag: 0.15, prExtra: 45, qrsWidth: 1.2, qrsMag: 1, rr: 880 },  // P fades
  { tMag: 1.9, tWidth: 0.6, pMag: 0, prExtra: 70, qrsWidth: 2.6, qrsMag: 0.85, rr: 1020 }, // QRS widens
  { tMag: 1.5, tWidth: 1.35, pMag: 0, prExtra: 70, qrsWidth: 3.4, qrsMag: 0.7, rr: 1350 }, // sine merge
]
const lerp = (a: number, b: number, f: number) => a + (b - a) * f

export const hyperkFrame = (x: number): KFrame => {
  const t = Math.min(1, Math.max(0, x)) * (K_FRAMES.length - 1)
  const i = Math.min(K_FRAMES.length - 2, Math.floor(t))
  const f = t - i
  const a = K_FRAMES[i]
  const b = K_FRAMES[i + 1]
  const out = {} as KFrame
  for (const k of Object.keys(a) as (keyof KFrame)[]) out[k] = lerp(a[k], b[k], f)
  return out
}

/** The hyperK morph strip at trajectory position x ∈ [0,1]. */
export const hyperkStrip = (x: number): Strip => {
  const k = hyperkFrame(x)
  const beats: Beat[] = []
  for (let i = 0; i < 3; i++) {
    const b = simulateBeat({ pace: 'SA' }, i * k.rr)
    const sources = b.sources.map((s): Source => {
      if (s.segment === 'P') return { ...s, mag: s.mag * k.pMag }
      if (s.segment === 'QRS') {
        return { ...s, width: s.width * k.qrsWidth, mag: s.mag * k.qrsMag, center: s.center + k.prExtra }
      }
      if (s.segment === 'T') {
        return { ...s, mag: s.mag * k.tMag, width: s.width * k.tWidth, center: s.center + k.prExtra - (k.tWidth > 1 ? 40 : 0) }
      }
      return s
    })
    // When the atria fall silent the SA wire stops flashing too (sinoventricular
    // conduction: the sinus still drives, the atrial muscle no longer answers).
    beats.push({ ...b, sources, wires: k.pMag < 0.05 ? b.wires.filter((w) => w.structure !== 'SA') : b.wires })
  }
  return { beats, durationMs: 3 * k.rr }
}

// ---------------------------------------------------------------------------
// Na-channel blocker (TCA) toxicity: sinus tach, every phase-0 slowed (whole-
// QRS stretch), terminal rightward-superior lobe -> the R in aVR, long QT.
// ---------------------------------------------------------------------------
export const tcaStrip = (): Strip => {
  const RR = 520
  const beats: Beat[] = []
  for (let i = 0; i < 4; i++) {
    const b = simulateBeat({ pace: 'SA' }, i * RR)
    const qrsCenters = b.sources.filter((s) => s.segment === 'QRS').map((s) => s.center)
    const lastQrs = Math.max(...qrsCenters)
    const sources = b.sources.map((s): Source => {
      if (s.segment === 'QRS') return { ...s, width: s.width * 1.8 }
      if (s.segment === 'T') return { ...s, center: s.center + 10 }
      return s
    })
    // terminal vector swings right-superior-anterior: the R in aVR
    sources.push({
      dir: [-0.7, -0.6, 0.2], mag: 0.5, center: lastQrs + 42, width: 15, segment: 'QRS',
      pos: [-0.12, -0.16, 0.1],
      glow: { structures: ['RV', 'SEPTUM'], kind: 'ventricle', start: lastQrs + 26, end: lastQrs + 78, note: 'terminal vector swings toward aVR' },
    })
    beats.push({ ...b, sources })
  }
  return { beats, durationMs: 4 * RR }
}

// ---------------------------------------------------------------------------
// Drug-induced long QT (solver beats, delayed T) and a torsades run with a
// short-long-short trigger and a rotating polymorphic axis (fixed table).
// ---------------------------------------------------------------------------
export const longqtStrip = (): Strip => {
  const RR = 800
  const beats: Beat[] = []
  for (let i = 0; i < 3; i++) {
    const b = simulateBeat({ pace: 'SA' }, i * RR)
    beats.push({
      ...b,
      sources: b.sources.map((s): Source => (s.segment === 'T' ? { ...s, center: s.center + 120 } : s)),
    })
  }
  return { beats, durationMs: 3 * RR }
}

const TDP_ANGLES = [40, 95, 150, 205, 250, 300, 350, 35]

export const tdpStrip = (): Strip => {
  const beats: Beat[] = []
  let t = 0
  const sinus = (onset: number) => {
    const b = simulateBeat({ pace: 'SA' }, onset)
    return { ...b, sources: b.sources.map((s): Source => (s.segment === 'T' ? { ...s, center: s.center + 120 } : s)) }
  }
  beats.push(sinus(t)); t += 800
  beats.push(sinus(t)); t += 460 // premature beat lands here…
  const pvc = ventricularOnlyBeat(t)
  beats.push({ ...pvc, label: 'PVC', sources: pvc.sources.map((s) => ({ ...s, width: s.width * 1.6 })) })
  t += 1150 // …the compensatory pause (the LONG)
  beats.push(sinus(t)); t += 420 // the SHORT — a beat drops onto the long QT's T
  for (let i = 0; i < TDP_ANGLES.length; i++) {
    const a = (TDP_ANGLES[i] * Math.PI) / 180
    const dir: [number, number, number] = [Math.cos(a), Math.sin(a), 0.25 * Math.sin(a * 2)]
    beats.push({
      onset: t,
      sources: [
        { dir, mag: 1.15, center: 40, width: 26, segment: 'QRS', glow: { structures: ['LV', 'RV'], kind: 'ventricle', start: 20, end: 90, note: 'the axis twists around the baseline' } },
        { dir: [-dir[0], -dir[1], dir[2]], mag: 0.4, center: 130, width: 40, segment: 'T' },
      ],
      wires: [],
      label: i === 0 ? 'torsades' : undefined,
    })
    t += 260
  }
  t += 340
  beats.push(sinus(t))
  t += 900
  return { beats, durationMs: t }
}

/** Named authored builders (referenced by cards via mechanism.authoredId). */
export const AUTHORED: Record<string, () => Strip> = {
  afib: buildAfibStrip,
  hyperk: () => hyperkStrip(0.5),
  tca: tcaStrip,
  longqt: longqtStrip,
  tdp: tdpStrip,
}
