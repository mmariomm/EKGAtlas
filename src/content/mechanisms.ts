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

// ---------------------------------------------------------------------------
// Atrial flutter, 2:1 — the macro-reentrant loop is Stage-2 animation; here
// the atria re-fire metronomically at 300/min (sawtooth: slow superior limb,
// quick inferior return) and the AV node passes every second impulse.
// ---------------------------------------------------------------------------
export const aflutterStrip = (): Strip => {
  const F = 200 // flutter cycle, ms (300/min)
  const beats: Beat[] = []
  const nFlutter = 12
  for (let i = 0; i < nFlutter; i++) {
    const onset = i * F
    const sources: Source[] = [
      { dir: [-0.25, -0.72, 0.05], mag: 0.055, center: 60, width: 46, segment: 'P', glow: i % 2 === 0 ? { structures: ['RA', 'LA'], kind: 'atria', start: 10, end: 120, note: 'the loop laps the atrium — 300/min' } : undefined },
      { dir: [0.3, 0.78, 0.1], mag: 0.05, center: 128, width: 20, segment: 'P' },
    ]
    const conducted = i % 2 === 0
    if (conducted) {
      const v = ventricularOnlyBeat(onset)
      beats.push({
        onset,
        sources: [...sources, ...v.sources.map((s) => ({ ...s, center: s.center + 10 }))],
        wires: v.wires,
      })
    } else {
      beats.push({ onset, sources, wires: [] })
    }
  }
  return { beats, durationMs: nFlutter * F }
}

// ---------------------------------------------------------------------------
// Monomorphic VT: an ectopic LV focus at ~176/min (solver region pacing →
// slow cell-to-cell spread, wide QRS), the sinus node marching on regardless
// (AV dissociation), and one fusion beat where the two meet.
// ---------------------------------------------------------------------------
export const vtStrip = (): Strip => {
  const RR = 340
  const N = 7
  const beats: Beat[] = []
  for (let i = 0; i < N; i++) {
    const onset = i * RR
    const e = simulateBeat({ pace: 'LV_lat' }, onset, i === 0 ? { focus: { x: 0.68, y: 0.62, label: 'focus' } } : undefined)
    let sources = e.sources
    // one fusion beat: the conducted wavefront meets the ectopic one
    if (i === 4) {
      const n = ventricularOnlyBeat(onset)
      sources = [
        ...sources.map((s) => (s.segment === 'QRS' ? { ...s, mag: s.mag * 0.55 } : s)),
        ...n.sources.filter((s) => s.segment === 'QRS').map((s) => ({ ...s, mag: s.mag * 0.45, center: s.center - 130 })),
      ]
      beats.push({ onset, sources, wires: [], label: 'fusion' })
      continue
    }
    beats.push({ onset, sources, wires: [], label: i === 0 ? 'VT' : undefined })
  }
  // the sinus marches on at its own 800 ms — dissociated Ps land where they land
  for (let pT = 180; pT < N * RR - 80; pT += 800) {
    const host = beats.reduce((best, b) => (b.onset <= pT && b.onset > best.onset ? b : best), beats[0])
    const c = pT - host.onset
    if (c < 30 || c > RR - 60) continue // buried inside a QRS edge — invisible anyway
    host.sources.push({
      dir: [0.35, 0.75, 0.5], mag: 0.09, center: c, width: 22, segment: 'P',
      glow: { structures: ['RA', 'LA'], kind: 'atria', start: c - 40, end: c + 50, note: 'the sinus marches on — dissociated' },
    })
  }
  return { beats, durationMs: N * RR }
}

// ---------------------------------------------------------------------------
// Complete (third-degree) AV block: Ps at 75/min, a junctional escape at
// 40/min, and no fixed relation between them. The AV junction is the wall.
// ---------------------------------------------------------------------------
export const avb3Strip = (): Strip => {
  const PP = 800
  const RRv = 1500
  const durationMs = 6000
  const beats: Beat[] = []
  // dissociated escape beats (junctional → narrow; His fires, node never conducts)
  for (let t = 260; t < durationMs - 400; t += RRv) {
    const v = ventricularOnlyBeat(t)
    beats.push({ ...v, wires: v.wires.filter((w) => w.structure !== 'AV') })
  }
  // the atrial march, folded into whichever beat window each P lands in
  const pSources: { onset: number; s: Source }[] = []
  for (let t = 40; t < durationMs - 80; t += PP) {
    pSources.push({
      onset: t,
      s: { dir: [0.35, 0.75, 0.5], mag: 0.09, center: 0, width: 22, segment: 'P', glow: { structures: ['RA', 'LA'], kind: 'atria', start: -30, end: 60, note: 'the Ps march alone' } },
    })
  }
  for (const p of pSources) {
    const host = beats.reduce((best, b) => (b.onset <= p.onset && b.onset > best.onset ? b : best), beats[0])
    host.sources.push({ ...p.s, center: p.onset - host.onset })
  }
  beats.sort((a, b) => a.onset - b.onset)
  return { beats, durationMs }
}

// ---------------------------------------------------------------------------
// Second-degree AV block. Mobitz II: fixed PR, then a P simply fails (the
// His–Purkinje system drops it without warning). Wenckebach companion: the
// PR stretches beat by beat until one drops.
// ---------------------------------------------------------------------------
export const avb2Mobitz2Strip = (): Strip => {
  const PP = 800
  const PR = 160
  const beats: Beat[] = []
  let t = 0
  for (let i = 0; i < 8; i++) {
    const dropped = i % 4 === 3
    const pSrc: Source = { dir: [0.35, 0.75, 0.5], mag: 0.09, center: 40, width: 22, segment: 'P', glow: { structures: ['RA', 'LA'], kind: 'atria', start: 0, end: 70, note: dropped ? 'this P finds the door shut — no warning' : undefined } }
    if (dropped) {
      beats.push({ onset: t, sources: [pSrc], wires: [] })
    } else {
      const v = ventricularOnlyBeat(t)
      beats.push({ ...v, sources: [pSrc, ...v.sources.map((s) => ({ ...s, center: s.center - 166 + 40 + PR }))] })
    }
    t += PP
  }
  return { beats, durationMs: t }
}

export const wenckebachStrip = (): Strip => {
  const PP = 780
  const LADDER = [160, 220, 280, null] // PR per beat; null = dropped
  const beats: Beat[] = []
  let t = 0
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const pr of LADDER) {
      const pSrc: Source = { dir: [0.35, 0.75, 0.5], mag: 0.09, center: 40, width: 22, segment: 'P', glow: { structures: ['RA', 'LA'], kind: 'atria', start: 0, end: 70 } }
      if (pr == null) {
        beats.push({ onset: t, sources: [pSrc], wires: [{ structure: 'AV', start: 60, end: 140, kind: 'av', note: 'the node fatigues — this one drops' }] })
      } else {
        const v = ventricularOnlyBeat(t)
        beats.push({ ...v, sources: [pSrc, ...v.sources.map((s) => ({ ...s, center: s.center - 166 + 40 + pr }))] })
      }
      t += PP
    }
  }
  return { beats, durationMs: t }
}

// ---------------------------------------------------------------------------
// Ventricular paced rhythm: solver paces the RV apex (wide, LBBB-like,
// superior axis) with a stimulus artifact before every capture.
// ---------------------------------------------------------------------------
export const pacedStrip = (): Strip => {
  const RR = 850
  const beats: Beat[] = []
  for (let i = 0; i < 3; i++) {
    const b = simulateBeat({ pace: 'RV_inf' }, i * RR)
    const firstQrs = Math.min(...b.sources.filter((s) => s.segment === 'QRS').map((s) => s.center))
    beats.push({
      ...b,
      sources: [
        // the pacing spike: a tiny, very sharp anterior deflection
        { dir: [0, 0.3, 1], mag: 0.5, center: firstQrs - 12, width: 1.6, segment: 'QRS', pos: [-0.14, 0.21, 0.03], glow: { structures: ['FOCUS'], kind: 'sa', start: firstQrs - 16, end: firstQrs - 2, note: 'the lead fires in the RV apex' } },
        ...b.sources,
      ],
      focus: i === 0 ? { x: 0.36, y: 0.72, label: 'lead tip' } : undefined,
    })
  }
  return { beats, durationMs: 3 * RR }
}

// ---------------------------------------------------------------------------
// Ports of the v1 authored ischemia morphologies (validated in v1's harness),
// now with source positions for the electrode-derived engine.
// ---------------------------------------------------------------------------
const solverNsrNoT = (onset: number): Beat => {
  const b = simulateBeat({ pace: 'SA' }, onset)
  return { ...b, sources: b.sources.filter((s) => s.segment !== 'T') }
}

export const posteriorStrip = (): Strip => {
  const RR = 800
  const beats: Beat[] = []
  for (let i = 0; i < 3; i++) {
    const b = solverNsrNoT(i * RR)
    beats.push({
      ...b,
      sources: [
        ...b.sources,
        { dir: [-0.3, 0.05, 0.85], mag: 1.1, center: 202, width: 15, segment: 'QRS', pos: [0.02, 0.07, -0.14], glow: { structures: ['LV'], kind: 'ventricle', start: 176, end: 244, note: 'posterior wall, seen in mirror — the tall R in V1' } },
        { dir: [0.1, 0, -0.92], mag: 0.46, center: 295, width: 30, segment: 'ST', pos: [0.02, 0.07, -0.14], glow: { structures: ['LV'], kind: 'injury', start: 275, end: 332, note: 'posterior injury → reciprocal ST↓ in V1–V3' } },
        // the mirrored posterior T — upright in V1–V2 (v1-validated values)
        { dir: [0.35, 0.2, 0.7], mag: 0.45, center: 372, width: 50, segment: 'T', pos: [0.02, 0.07, -0.14], glow: { structures: ['RV', 'LV'], kind: 'repol', start: 332, end: 452 } },
      ],
    })
  }
  return { beats, durationMs: 3 * RR }
}

export const sgarbossaStrip = (): Strip => {
  const RR = 800
  const beats: Beat[] = []
  for (let i = 0; i < 3; i++) {
    const b = simulateBeat({ pace: 'SA', blockedEdges: ['HIS>LBB'] }, i * RR)
    beats.push({
      ...b,
      sources: [
        ...b.sources,
        // the injury vector points WITH the lateral QRS: concordant STE
        { dir: [0.9, 0.3, -0.25], mag: 0.45, center: 330, width: 36, segment: 'ST', pos: [0.32, 0.05, -0.05], glow: { structures: ['LV'], kind: 'injury', start: 305, end: 380, note: 'concordant ST — the block cannot explain this' } },
      ],
    })
  }
  return { beats, durationMs: 3 * RR }
}

export const wellensStrip = (): Strip => {
  const RR = 800
  const beats: Beat[] = []
  for (let i = 0; i < 3; i++) {
    const b = solverNsrNoT(i * RR)
    beats.push({
      ...b,
      sources: [
        ...b.sources,
        { dir: [0.3, 0.2, -0.92], mag: 0.6, center: 372, width: 56, segment: 'T', pos: [0.19, 0.04, 0.16], glow: { structures: ['LV'], kind: 'repol', start: 320, end: 460, note: 'the reperfused anterior wall repolarizes backwards' } },
      ],
    })
  }
  return { beats, durationMs: 3 * RR }
}

export const dewinterStrip = (): Strip => {
  const RR = 800
  const beats: Beat[] = []
  for (let i = 0; i < 3; i++) {
    const b = solverNsrNoT(i * RR)
    beats.push({
      ...b,
      sources: [
        ...b.sources,
        { dir: [0.15, 0.15, -0.85], mag: 0.34, center: 292, width: 30, segment: 'ST', pos: [0.19, 0.04, 0.16], glow: { structures: ['LV'], kind: 'injury', start: 272, end: 330, note: 'subendocardial injury — the J point dips' } },
        { dir: [0.35, 0.25, 0.78], mag: 0.72, center: 372, width: 48, segment: 'T', pos: [0.19, 0.04, 0.16], glow: { structures: ['RV', 'LV'], kind: 'repol', start: 332, end: 452, note: 'giant symmetric Ts tower out of the dip' } },
      ],
    })
  }
  return { beats, durationMs: 3 * RR }
}

export const lvhStrip = (): Strip => {
  const RR = 800
  const beats: Beat[] = []
  for (let i = 0; i < 3; i++) {
    const b = solverNsrNoT(i * RR)
    beats.push({
      ...b,
      sources: [
        ...b.sources.map((s) =>
          s.segment === 'QRS' && s.glow?.structures.includes('LV')
            ? { ...s, mag: s.mag * 1.6 }
            : s,
        ),
        // strain: asymmetric lateral-negative repolarization (slow limb + faster return)
        { dir: [-0.85, -0.15, 0.35], mag: 0.5, center: 372, width: 52, segment: 'T', pos: [0.3, 0.05, -0.05], glow: { structures: ['LV'], kind: 'repol', start: 322, end: 452, note: 'the thick wall repolarizes inside-out — strain' } },
        { dir: [0.6, 0.2, -0.2], mag: 0.16, center: 452, width: 26, segment: 'T', pos: [0.3, 0.05, -0.05] },
      ],
    })
  }
  return { beats, durationMs: 3 * RR }
}

export const brugadaStrip = (): Strip => {
  const RR = 800
  const beats: Beat[] = []
  for (let i = 0; i < 3; i++) {
    const b = solverNsrNoT(i * RR)
    beats.push({
      ...b,
      sources: [
        ...b.sources,
        { dir: [-0.45, 0, 0.9], mag: 0.5, center: 285, width: 28, segment: 'ST', pos: [-0.16, -0.08, 0.18], glow: { structures: ['RV'], kind: 'injury', start: 262, end: 322, note: 'the RVOT loses its dome — coved ST' } },
        { dir: [0.4, 0.1, -0.7], mag: 0.42, center: 365, width: 50, segment: 'T', pos: [-0.16, -0.08, 0.18], glow: { structures: ['RV', 'LV'], kind: 'repol', start: 325, end: 445 } },
      ],
    })
  }
  return { beats, durationMs: 3 * RR }
}

/** Named authored builders (referenced by cards via mechanism.authoredId). */
export const AUTHORED: Record<string, () => Strip> = {
  afib: buildAfibStrip,
  hyperk: () => hyperkStrip(0.5),
  tca: tcaStrip,
  longqt: longqtStrip,
  tdp: tdpStrip,
  aflutter: aflutterStrip,
  'vt-mono': vtStrip,
  'avb-3': avb3Strip,
  'avb-2': avb2Mobitz2Strip,
  wenckebach: wenckebachStrip,
  'paced-v': pacedStrip,
  'omi-posterior': posteriorStrip,
  sgarbossa: sgarbossaStrip,
  wellens: wellensStrip,
  dewinter: dewinterStrip,
  'lvh-strain': lvhStrip,
  brugada: brugadaStrip,
}
