/**
 * The mechanism data model — ONE source of truth per strip.
 *
 * A Strip is a timeline of Beats. Each Beat carries:
 *
 *   sources — pieces of myocardium that depolarize/repolarize. Each is one
 *             Gaussian "push" of the dipole: summed over time they ARE the
 *             heart vector V(t); passed through the electrode forward model
 *             they ARE the waveforms. Each also carries the glow it casts on
 *             the heart view, so trace and animation can never disagree.
 *
 *   wires   — the conduction system lighting up (glow only, no voltage).
 *
 * Sources may carry a `pos` (dipole origin offset, torso units) so nearby
 * chest electrodes weigh them differently; it defaults to the heart center.
 */
import { Vec3 } from './vec'

/** Conduction-system structures + chambers the heart view can illuminate. */
export type StructureId =
  | 'SA' | 'RA' | 'LA' | 'AV' | 'HIS'
  | 'RBB' | 'LBB' | 'LAF' | 'LPF'
  | 'SEPTUM' | 'RV' | 'LV'
  | 'FOCUS'

/** Phase tone — drives the shared cross-modal color binding (heart ↔ trace). */
export type PhaseTone = 'sa' | 'atria' | 'av' | 'ventricle' | 'repol' | 'injury' | 'rest'

export type SegmentTag = 'P' | 'QRS' | 'ST' | 'T'

/** How a source lights the heart view (a derived view of the same event). */
export interface SourceGlow {
  structures: StructureId[]
  kind: PhaseTone
  /** Glow/sweep window in ms relative to the beat onset. */
  start: number
  end: number
  /** Optional narration shown while this source leads the phase. */
  note?: string
}

export interface Source {
  /** Dipole direction (need not be unit length). */
  dir: Vec3
  /** Peak magnitude in mV-equivalent units. 0 = glow-only. */
  mag: number
  /** Time of the peak, ms relative to beat onset. */
  center: number
  /** Gaussian σ in ms: small = sharp (QRS), large = broad (P, T, injury). */
  width: number
  segment: SegmentTag
  /** Dipole origin in torso units (defaults to the heart center, [0,0,0]). */
  pos?: Vec3
  glow?: SourceGlow
}

/** A conduction-system element lighting up — glow only, no surface voltage. */
export interface WirePulse {
  structure: StructureId
  start: number
  end: number
  kind: PhaseTone
  note?: string
}

/** Position for an ectopic focus marker, in heart-view normalized coords. */
export interface FocusSpec {
  x: number
  y: number
  label: string
}

export interface Beat {
  /** Absolute start time of this beat within the strip, ms. */
  onset: number
  sources: Source[]
  wires: WirePulse[]
  /** Short label drawn above the beat on the trace (e.g. 'fusion'). */
  label?: string
  focus?: FocusSpec
}

export interface Strip {
  beats: Beat[]
  /** Total loop length in ms. */
  durationMs: number
}

/** Mirror a strip left↔right (true dextrocardia): flip x of dirs and positions. */
export const mirrorStrip = (strip: Strip): Strip => ({
  durationMs: strip.durationMs,
  beats: strip.beats.map((b) => ({
    ...b,
    sources: b.sources.map((s) => ({
      ...s,
      dir: [-s.dir[0], s.dir[1], s.dir[2]] as Vec3,
      pos: s.pos ? ([-s.pos[0], s.pos[1], s.pos[2]] as Vec3) : undefined,
    })),
  })),
})
