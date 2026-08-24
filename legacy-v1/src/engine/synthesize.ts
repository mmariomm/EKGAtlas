/**
 * The synthesizer. Everything the UI reads is derived from one place — a beat's
 * `sources` (and glow-only `wires`) — so the trace and the heart animation are
 * guaranteed concordant:
 *
 *   buildSignals    → calibrated per-lead waveforms (mV)        → TraceCanvas
 *   sampleVector    → the instantaneous heart vector at time t  → arrow + trace playhead
 *   sampleActivation→ which structures glow (level + progress)  → HeartDiagram
 *   samplePhase     → human-readable phase + cross-modal tone   → narration + color
 *   meanQrsAxisDeg  → frontal QRS axis                           → readout
 *
 * The strip is a seamless loop: every time comparison uses the shortest cyclic
 * distance, so tails wrap around the boundary with no seam.
 */
import { LeadId, LEAD_AXES, ALL_LEADS } from './leads'
import { Strip, StructureId, PhaseTone } from './types'
import { Vec3, dot, normalize, scale, add, clamp, smoothstep, frontalAngleDeg } from './vectorMath'

const cyclicDelta = (t: number, center: number, period: number): number => {
  let d = t - center
  const half = period / 2
  if (d > half) d -= period
  else if (d < -half) d += period
  return d
}

const bell = (t: number, center: number, width: number, period: number): number =>
  Math.exp(-0.5 * (cyclicDelta(t, center, period) / width) ** 2)

// ---------------------------------------------------------------------------
// Per-lead waveform synthesis (from the dipole sources)
// ---------------------------------------------------------------------------

export interface SignalSet {
  dt: number
  durationMs: number
  n: number
  leads: Record<LeadId, Float32Array>
}

interface PreparedSource {
  center: number
  width: number
  proj: Record<LeadId, number>
}

const prepareSources = (strip: Strip, leadIds: LeadId[]): PreparedSource[] => {
  const out: PreparedSource[] = []
  for (const beat of strip.beats) {
    for (const s of beat.sources) {
      if (s.mag === 0) continue
      const u = normalize(s.dir)
      const proj = {} as Record<LeadId, number>
      for (const id of leadIds) proj[id] = s.mag * dot(u, LEAD_AXES[id])
      out.push({ center: beat.onset + s.center, width: s.width, proj })
    }
  }
  return out
}

export const buildSignals = (strip: Strip, leadIds: LeadId[] = ALL_LEADS, dt = 2): SignalSet => {
  const n = Math.max(1, Math.round(strip.durationMs / dt))
  const leads = {} as Record<LeadId, Float32Array>
  for (const id of leadIds) leads[id] = new Float32Array(n)

  const sources = prepareSources(strip, leadIds)
  for (let i = 0; i < n; i++) {
    const t = i * dt
    for (const s of sources) {
      const g = bell(t, s.center, s.width, strip.durationMs)
      if (g < 1e-4) continue
      for (const id of leadIds) leads[id][i] += s.proj[id] * g
    }
  }
  return { dt, durationMs: strip.durationMs, n, leads }
}

// ---------------------------------------------------------------------------
// Instantaneous heart vector
// ---------------------------------------------------------------------------

export const sampleVector = (strip: Strip, t: number): Vec3 => {
  let v: Vec3 = [0, 0, 0]
  for (const beat of strip.beats) {
    for (const s of beat.sources) {
      if (s.mag === 0) continue
      const g = bell(t, beat.onset + s.center, s.width, strip.durationMs)
      if (g < 1e-4) continue
      v = add(v, scale(normalize(s.dir), s.mag * g))
    }
  }
  return v
}

// ---------------------------------------------------------------------------
// Conduction-system + chamber glow (derived from the SAME sources + wires)
// ---------------------------------------------------------------------------

export interface Activation {
  level: number
  kind: PhaseTone
  /** 0→1 through the glow window — drives the spreading wavefront. */
  progress: number
}

const RISE_MS = 16
const FALL_MS = 70

const pulseAt = (t: number, start: number, end: number, period: number): number => {
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

const progressAt = (t: number, start: number, end: number, period: number): number => {
  if (end <= start) return 1
  const c = (start + end) / 2
  const tA = c + cyclicDelta(t, c, period)
  return clamp((tA - start) / (end - start), 0, 1)
}

/** Every (structure, window, tone) glow contribution in the strip. */
interface GlowSpan {
  structure: StructureId
  start: number
  end: number
  kind: PhaseTone
}

const glowSpans = (strip: Strip): GlowSpan[] => {
  const spans: GlowSpan[] = []
  for (const beat of strip.beats) {
    for (const s of beat.sources) {
      if (!s.glow) continue
      for (const st of s.glow.structures) {
        spans.push({ structure: st, start: beat.onset + s.glow.start, end: beat.onset + s.glow.end, kind: s.glow.kind })
      }
    }
    for (const w of beat.wires) {
      spans.push({ structure: w.structure, start: beat.onset + w.start, end: beat.onset + w.end, kind: w.kind })
    }
  }
  return spans
}

export const sampleActivation = (strip: Strip, t: number): Map<StructureId, Activation> => {
  const out = new Map<StructureId, Activation>()
  const period = strip.durationMs
  for (const span of glowSpans(strip)) {
    const lvl = pulseAt(t, span.start, span.end, period)
    if (lvl < 0.02) continue
    const prev = out.get(span.structure)
    if (!prev || lvl > prev.level) {
      out.set(span.structure, { level: lvl, kind: span.kind, progress: progressAt(t, span.start, span.end, period) })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Current beat context (label + ectopic focus)
// ---------------------------------------------------------------------------

export const beatAt = (strip: Strip, t: number) => {
  let current = strip.beats[0]
  for (const beat of strip.beats) if (beat.onset <= t) current = beat
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

interface PhaseCandidate {
  start: number
  end: number
  kind: PhaseTone
  note?: string
}

const phaseCandidates = (strip: Strip): PhaseCandidate[] => {
  const out: PhaseCandidate[] = []
  for (const beat of strip.beats) {
    for (const s of beat.sources) {
      if (s.glow) out.push({ start: beat.onset + s.glow.start, end: beat.onset + s.glow.end, kind: s.glow.kind, note: s.glow.note })
    }
    for (const w of beat.wires) {
      out.push({ start: beat.onset + w.start, end: beat.onset + w.end, kind: w.kind, note: w.note })
    }
  }
  return out
}

export const samplePhase = (strip: Strip, t: number): PhaseInfo => {
  const period = strip.durationMs
  let bestRank = -1
  let best: { tone: PhaseTone; note?: string; level: number } | null = null
  for (const c of phaseCandidates(strip)) {
    const lvl = pulseAt(t, c.start, c.end, period)
    if (lvl < 0.15) continue
    const rank = TONE_RANK[c.kind]
    if (rank > bestRank || (rank === bestRank && best && lvl > best.level)) {
      bestRank = rank
      best = { tone: c.kind, note: c.note, level: lvl }
    }
  }
  if (!best) return { ...TONE_DEFAULT.rest, tone: 'rest' }
  const def = TONE_DEFAULT[best.tone]
  return { text: best.note ?? def.text, sub: best.note ? def.text : def.sub, tone: best.tone }
}

// ---------------------------------------------------------------------------
// Mean frontal QRS axis (from the first beat's QRS sources)
// ---------------------------------------------------------------------------

export const meanQrsAxisDeg = (strip: Strip): number => {
  let net: Vec3 = [0, 0, 0]
  const beat = strip.beats.find((b) => b.sources.some((s) => s.segment === 'QRS' && s.mag > 0)) ?? strip.beats[0]
  for (const s of beat.sources) {
    if (s.segment !== 'QRS' || s.mag === 0) continue
    net = add(net, scale(normalize(s.dir), s.mag))
  }
  return Math.round(frontalAngleDeg(net))
}
