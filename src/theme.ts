/**
 * The shared visual language. Phase tones are the linchpin: the SAME color
 * marks a phase on the heart and on the trace, so the eye binds cause
 * (impulse location) to effect (waveform) without reading.
 */
import { PhaseTone } from './engine/sources'

export interface ToneColor {
  core: string
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

/** Resting (unlit) conduction structures on the heart figure. */
export const STRUCTURE = {
  stroke: 'rgba(150, 170, 200, 0.38)',
  strokeStrong: 'rgba(180, 198, 224, 0.6)',
  chamberFill: 'rgba(120, 145, 185, 0.06)',
  blocked: 'rgba(120, 132, 150, 0.22)',
  label: 'rgba(190, 204, 226, 0.72)',
}
