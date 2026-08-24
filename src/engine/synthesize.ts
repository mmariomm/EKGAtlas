/**
 * The forward model. Everything the UI reads derives from a beat's `sources`
 * (and glow-only `wires`), so the trace and the heart animation are guaranteed
 * concordant:
 *
 *   buildSignals    → per-lead waveforms (mV) via electrode potentials
 *   sampleVector    → the instantaneous heart vector at time t (the arrow)
 *   sampleActivation→ which structures glow (level + progress)
 *   samplePhase     → human-readable phase + cross-modal tone
 *
 * Physics: each source is a point dipole in an infinite homogeneous conductor.
 * Potential at electrode e:  φ = G · mag · g(t) · (d̂ · r̂) / max(|r|², R_MIN²),
 * r = electrodeSite − sourcePos. Leads are DERIVED from φ (leads.ts) — so
 * Einthoven/Goldberger identities hold exactly and electrode moves are lawful.
 *
 * The strip is a seamless loop: time comparisons use the shortest cyclic
 * distance, so tails wrap around the boundary with no seam.
 */
import { ALL_LEADS, LeadId, leadsFromPhi, Phi } from './leads'
import { CableId, Montage, standardMontage } from './electrodes'
import { PhaseTone, Strip, StructureId } from './sources'
import { add, clamp, dot, normalize, scale, smoothstep, sub, Vec3 } from './vec'

/** Distance clamp: keeps a dragged electrode from diving into the singularity
 *  and keeps the precordial/limb proximity ratio in a teaching-honest range. */
export const R_MIN = 1.0

/** Global gain, calibrated so the reference NSR strip puts R(II) in the
 *  textbook range (see test/engine.test.ts calibration check). */
export const ENGINE_GAIN = 2.9

const ORIGIN: Vec3 = [0, 0, 0]

const CABLES: CableId[] = ['RA', 'LA', 'LL', 'RL', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']

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
// Per-lead waveform synthesis
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
  /** Per-lead peak contribution in mV (montage folded in). */
  proj: Record<LeadId, number>
}

/** φ coefficient of a unit-gaussian source at one electrode site. */
const phiCoef = (site: Vec3, sPos: Vec3, dHat: Vec3): number => {
  const r = sub(site, sPos)
  const d2 = Math.max(r[0] * r[0] + r[1] * r[1] + r[2] * r[2], R_MIN * R_MIN)
  return dot(dHat, normalize(r)) / d2
}

const prepareSources = (strip: Strip, montage: Montage): PreparedSource[] => {
  const out: PreparedSource[] = []
  for (const beat of strip.beats) {
    for (const s of beat.sources) {
      if (s.mag === 0) continue
      const dHat = normalize(s.dir)
      const pos = s.pos ?? ORIGIN
      const phi = {} as Phi
      for (const c of CABLES) phi[c] = ENGINE_GAIN * s.mag * phiCoef(montage.site[c], pos, dHat)
      out.push({ center: beat.onset + s.center, width: s.width, proj: leadsFromPhi(phi) })
    }
  }
  return out
}

export const buildSignals = (
  strip: Strip,
  montage: Montage = standardMontage(),
  dt = 2,
): SignalSet => {
  const n = Math.max(1, Math.round(strip.durationMs / dt))
  const leads = {} as Record<LeadId, Float32Array>
  for (const id of ALL_LEADS) leads[id] = new Float32Array(n)

  const sources = prepareSources(strip, montage)
  for (let i = 0; i < n; i++) {
    const t = i * dt
    for (const s of sources) {
      const g = bell(t, s.center, s.width, strip.durationMs)
      if (g < 1e-4) continue
      for (const id of ALL_LEADS) leads[id][i] += s.proj[id] * g
    }
  }
  return { dt, durationMs: strip.durationMs, n, leads }
}

// ---------------------------------------------------------------------------
// Instantaneous heart vector (independent of electrodes)
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

/** Mean frontal QRS axis from the first beat carrying real QRS sources. */
export const meanQrsAxisDeg = (strip: Strip): number => {
  let net: Vec3 = [0, 0, 0]
  const beat =
    strip.beats.find((b) => b.sources.some((s) => s.segment === 'QRS' && s.mag > 0)) ??
    strip.beats[0]
  for (const s of beat.sources) {
    if (s.segment !== 'QRS' || s.mag === 0) continue
    net = add(net, scale(normalize(s.dir), s.mag))
  }
  return Math.round((Math.atan2(net[1], net[0]) * 180) / Math.PI)
}

// ---------------------------------------------------------------------------
// Structure glow (derived from the SAME sources + wires)
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

interface GlowSpan {
  structure: StructureId
  start: number
  end: number
  kind: PhaseTone
  note?: string
}

const glowSpans = (strip: Strip): GlowSpan[] => {
  const spans: GlowSpan[] = []
  for (const beat of strip.beats) {
    for (const s of beat.sources) {
      if (!s.glow) continue
      for (const st of s.glow.structures) {
        spans.push({
          structure: st,
          start: beat.onset + s.glow.start,
          end: beat.onset + s.glow.end,
          kind: s.glow.kind,
          note: s.glow.note,
        })
      }
    }
    for (const w of beat.wires) {
      spans.push({ structure: w.structure, start: beat.onset + w.start, end: beat.onset + w.end, kind: w.kind, note: w.note })
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

export const samplePhase = (strip: Strip, t: number): PhaseInfo => {
  const period = strip.durationMs
  let bestRank = -1
  let best: { tone: PhaseTone; note?: string; level: number } | null = null
  for (const c of glowSpans(strip)) {
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
