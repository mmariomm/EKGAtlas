/**
 * The shared visual language. Phase tones are the linchpin of the "understanding"
 * goal: the SAME color marks a phase in the heart diagram and on the trace, so
 * the eye binds cause (impulse location) to effect (waveform) without reading.
 *
 * Kept as plain JS so both the canvas (TraceCanvas) and SVG (HeartDiagram) read
 * identical values; the CSS mirrors them as custom properties for the chrome.
 */
import { PhaseTone } from './engine/types'

export interface ToneColor {
  /** Saturated core color (strokes, fills, the vector arrow). */
  core: string
  /** Soft halo used for glows / shadows. */
  glow: string
}

export const PHASE_COLORS: Record<PhaseTone, ToneColor> = {
  sa: { core: '#67e8ff', glow: 'rgba(103,232,255,0.55)' },
  atria: { core: '#38bdf8', glow: 'rgba(56,189,248,0.5)' },
  av: { core: '#f5b942', glow: 'rgba(245,185,66,0.5)' },
  ventricle: { core: '#ffc24b', glow: 'rgba(255,194,75,0.55)' },
  repol: { core: '#b794ff', glow: 'rgba(183,148,255,0.5)' },
  injury: { core: '#ff5d6c', glow: 'rgba(255,93,108,0.55)' },
  rest: { core: '#46536b', glow: 'rgba(70,83,107,0.0)' },
}

/** The trace ink — luminous, faintly cool, like a high-end monitor. */
export const TRACE_INK = '#eaf2ff'

/** Clinical ECG paper, inverted onto a dark stage. */
export const GRID = {
  minor: 'rgba(255, 86, 102, 0.075)',
  major: 'rgba(255, 86, 102, 0.16)',
  baseline: 'rgba(255, 255, 255, 0.12)',
}

/** Resting (unlit) conduction structures. */
export const STRUCTURE = {
  stroke: 'rgba(150, 170, 200, 0.38)',
  strokeStrong: 'rgba(180, 198, 224, 0.6)',
  chamberFill: 'rgba(120, 145, 185, 0.06)',
  blocked: 'rgba(120, 132, 150, 0.22)',
  label: 'rgba(190, 204, 226, 0.72)',
}

export const phaseColor = (tone: PhaseTone): ToneColor => PHASE_COLORS[tone]
