/**
 * The synthesizer. Turns a Strip (beats of dipole lobes + conduction events)
 * into everything the UI reads:
 *
 *   buildSignals    → calibrated per-lead waveforms (mV)         → TraceCanvas
 *   sampleVector    → the instantaneous heart vector at time t   → arrow + trace playhead
 *   sampleActivation→ which structures glow, and how brightly    → HeartDiagram
 *   samplePhase     → human-readable phase + cross-modal tone    → narration + color
 *   meanQrsAxisDeg  → frontal QRS axis                            → readout
 *
 * The strip is treated as a seamless loop: every time comparison uses the
 * shortest cyclic distance, so tails wrap around the boundary with no seam.
 */
import { LeadId, LEAD_AXES, ALL_LEADS } from './leads'
import { Strip, StructureId, PhaseTone } from './types'
import {
  Vec3, dot, normalize, scale, add, clamp, smoothstep, frontalAngleDeg,
} from './vectorMath'

const TWO = 2

/** Shortest signed distance from `center` to `t` on a loop of length `period`. */
const cyclicDelta = (t: number, center: number, period: number): number => {
  let d = t - center
  const half = period / TWO
  if (d > half) d -= period
  else if (d < -half) d += period
  return d
}

const bell = (t: number, center: number, width: number, period: number): number => {
  const d = cyclicDelta(t, center, period)
  return Math.exp(-0.5 * (d / width) ** 2)
}

// ---------------------------------------------------------------------------
// Per-lead waveform synthesis
// ---------------------------------------------------------------------------

export interface SignalSet {
  /** Sample interval in ms. */
  dt: number
  durationMs: number
  /** Number of samples. */
  n: number
  /** Calibrated voltage per lead, in mV. */
  leads: Record<LeadId, Float32Array>
}

interface PreparedLobe {
  center: number
  width: number
  /** Pre-projected coefficient (mag · dir̂ · axis) for each lead. */
  proj: Record<LeadId, number>
}

const prepareLobes = (strip: Strip, leadIds: LeadId[]): PreparedLobe[] => {
  const out: PreparedLobe[] = []
  for (const beat of strip.beats) {
    for (const lobe of beat.lobes) {
      const u = normalize(lobe.dir)
      const proj = {} as Record<LeadId, number>
      for (const id of leadIds) proj[id] = lobe.mag * dot(u, LEAD_AXES[id])
      out.push({ center: beat.onset + lobe.center, width: lobe.width, proj })
    }
  }
  return out
}

/**
 * Synthesize all (or a subset of) leads at `dt` ms resolution. Default 2 ms
 * (500 Hz) — far finer than the display needs, so morphology stays crisp.
 */
export const buildSignals = (
  strip: Strip,
  leadIds: LeadId[] = ALL_LEADS,
  dt = 2,
): SignalSet => {
  const n = Math.max(1, Math.round(strip.durationMs / dt))
  const leads = {} as Record<LeadId, Float32Array>
  for (const id of leadIds) leads[id] = new Float32Array(n)

  const lobes = prepareLobes(strip, leadIds)
  for (let i = 0; i < n; i++) {
    const t = i * dt
    for (const lobe of lobes) {
      const g = bell(t, lobe.center, lobe.width, strip.durationMs)
      if (g < 1e-4) continue
      for (const id of leadIds) leads[id][i] += lobe.proj[id] * g
    }
  }
  return { dt, durationMs: strip.durationMs, n, leads }
}

// ---------------------------------------------------------------------------
// Instantaneous heart vector (drives the arrow + the playhead phase color)
// ---------------------------------------------------------------------------

export const sampleVector = (strip: Strip, t: number): Vec3 => {
  let v: Vec3 = [0, 0, 0]
  for (const beat of strip.beats) {
    for (const lobe of beat.lobes) {
      const g = bell(t, beat.onset + lobe.center, lobe.width, strip.durationMs)
      if (g < 1e-4) continue
      v = add(v, scale(normalize(lobe.dir), lobe.mag * g))
    }
  }
  return v
}

// ---------------------------------------------------------------------------
// Conduction-system activation (drives the heart diagram glow)
// ---------------------------------------------------------------------------

export interface Activation {
  level: number
  kind: PhaseTone
  /** 0→1 through the depolarization window — drives the spreading wavefront. */
  progress: number
}

const RISE_MS = 16
const FALL_MS = 70

const pulseAt = (t: number, start: number, end: number, period: number): number => {
  // Evaluate at t and its two cyclic neighbours so windows wrap the loop seam.
  let best = 0
  for (const shift of [-period, 0, period]) {
    const tt = t + shift
    const up = smoothstep(start - 6, start + RISE_MS, tt)
    const down = 1 - smoothstep(end, end + FALL_MS, tt)
    const lvl = clamp(up * down, 0, 1)
    if (lvl > best) best = lvl
  }
  return best
}

export const sampleActivation = (strip: Strip, t: number): Map<StructureId, Activation> => {
  const out = new Map<StructureId, Activation>()
  const period = strip.durationMs
  for (const beat of strip.beats) {
    for (const ev of beat.events) {
      const start = beat.onset + ev.start
      const end = beat.onset + ev.end
      const lvl = pulseAt(t, start, end, period)
      if (lvl < 0.02) continue
      const prev = out.get(ev.structure)
      if (!prev || lvl > prev.level) {
        const c = (start + end) / 2
        const tAligned = c + cyclicDelta(t, c, period)
        const progress = end > start ? clamp((tAligned - start) / (end - start), 0, 1) : 1
        out.set(ev.structure, { level: lvl, kind: ev.kind, progress })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Current beat context (label + ectopic focus) for whichever beat owns time t
// ---------------------------------------------------------------------------

export const beatAt = (strip: Strip, t: number) => {
  let current = strip.beats[0]
  for (const beat of strip.beats) {
    if (beat.onset <= t) current = beat
  }
  return current
}

// ---------------------------------------------------------------------------
// Phase narration + cross-modal tone
// ---------------------------------------------------------------------------

export interface PhaseInfo {
  text: string
  sub: string
  tone: PhaseTone
}

const TONE_RANK: Record<PhaseTone, number> = {
  ventricle: 6, injury: 5, repol: 4, av: 3, atria: 2, sa: 1, rest: 0,
}

const TONE_DEFAULT: Record<PhaseTone, { text: string; sub: string }> = {
  sa: { text: 'SA node fires', sub: 'the pacemaker' },
  atria: { text: 'Atrial depolarization', sub: 'P wave' },
  av: { text: 'AV node delay', sub: 'PR segment' },
  ventricle: { text: 'Ventricular depolarization', sub: 'QRS complex' },
  repol: { text: 'Ventricular repolarization', sub: 'T wave' },
  injury: { text: 'Injury current', sub: 'ST segment' },
  rest: { text: 'Diastole', sub: 'ventricular filling' },
}

export const samplePhase = (strip: Strip, t: number): PhaseInfo => {
  let bestRank = -1
  let best: { tone: PhaseTone; note?: string; level: number } | null = null
  for (const beat of strip.beats) {
    for (const ev of beat.events) {
      const lvl = pulseAt(t, beat.onset + ev.start, beat.onset + ev.end, strip.durationMs)
      if (lvl < 0.15) continue
      const rank = TONE_RANK[ev.kind]
      if (rank > bestRank || (rank === bestRank && best && lvl > best.level)) {
        bestRank = rank
        best = { tone: ev.kind, note: ev.note, level: lvl }
      }
    }
  }
  if (!best) return { ...TONE_DEFAULT.rest, tone: 'rest' }
  const def = TONE_DEFAULT[best.tone]
  return { text: best.note ?? def.text, sub: best.note ? def.text : def.sub, tone: best.tone }
}

// ---------------------------------------------------------------------------
// Mean frontal QRS axis (from the first beat's QRS lobes)
// ---------------------------------------------------------------------------

export const meanQrsAxisDeg = (strip: Strip): number => {
  let net: Vec3 = [0, 0, 0]
  const beat = strip.beats.find((b) => b.lobes.some((l) => l.segment === 'QRS')) ?? strip.beats[0]
  for (const lobe of beat.lobes) {
    if (lobe.segment !== 'QRS') continue
    net = add(net, scale(normalize(lobe.dir), lobe.mag))
  }
  return Math.round(frontalAngleDeg(net))
}
