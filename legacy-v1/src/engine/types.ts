/**
 * The data model — ONE source of truth.
 *
 * A Condition produces a Strip (a timeline of Beats). Each Beat is described by:
 *
 *   sources — pieces of myocardium that depolarize. Each carries BOTH its dipole
 *             contribution (which sums into the heart vector V(t) and, projected
 *             onto a lead, into that lead's waveform) AND the diagram glow it
 *             produces. Because the trace and the heart animation are derived from
 *             the SAME sources, they can never be discordant.
 *
 *   wires   — the conduction system (SA, AV, His, bundle branches). These are
 *             glow-only timing markers; they carry negligible surface voltage but
 *             show the impulse racing toward the muscle.
 *
 * In Phase A these timings are authored per condition. In Phase B a propagation
 * solver will compute them from a conduction graph + tissue state (ablations,
 * blocks), at which point conditions become presets of the simulator.
 */
import { Vec3 } from './vectorMath'

/** Conduction-system structures + chambers the heart diagram can illuminate. */
export type StructureId =
  | 'SA' | 'RA' | 'LA' | 'AV' | 'HIS'
  | 'RBB' | 'LBB' | 'LAF' | 'LPF'
  | 'SEPTUM' | 'RV' | 'LV'
  | 'FOCUS'

/** Phase tone — drives the shared cross-modal color binding (heart ↔ trace). */
export type PhaseTone = 'sa' | 'atria' | 'av' | 'ventricle' | 'repol' | 'injury' | 'rest'

export type SegmentTag = 'P' | 'QRS' | 'ST' | 'T'

/** How a source lights the heart diagram (a derived view of the same event). */
export interface SourceGlow {
  /** Which structures this source illuminates (a wavefront may sweep several). */
  structures: StructureId[]
  kind: PhaseTone
  /** Glow/sweep window in ms relative to the beat onset. */
  start: number
  end: number
  /** Optional narration shown while this source leads the phase. */
  note?: string
}

/**
 * A depolarizing (or repolarizing/injury) piece of tissue: one Gaussian "push"
 * of the dipole, plus the glow it casts.
 */
export interface Source {
  /** Dipole direction (need not be unit length). */
  dir: Vec3
  /** Peak magnitude in mV-equivalent units. 0 = glow-only. */
  mag: number
  /** Time of the peak, ms relative to beat onset (the activation time). */
  center: number
  /** Std-dev (ms): small = sharp (QRS), large = broad (P, T, injury). */
  width: number
  segment: SegmentTag
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

/** Position for an ectopic focus marker, in heart-diagram normalized coords. */
export interface FocusSpec {
  x: number
  y: number
  label: string
}

export interface Beat {
  /** Absolute start time of this beat within the strip, in ms. */
  onset: number
  sources: Source[]
  wires: WirePulse[]
  /** Short label drawn above the beat on the trace (e.g. 'VPC', 'Beat 1'). */
  label?: string
  /** If this beat originates from an ectopic focus, where to draw it. */
  focus?: FocusSpec
}

export interface Strip {
  beats: Beat[]
  /** Total loop length in ms. */
  durationMs: number
}

export type ConditionCategory =
  | 'Reference'
  | 'Conduction blocks'
  | 'Ectopy & arrhythmia'
  | 'Ischemia & infarction'
  | 'Electrolyte & toxic'
  | 'High-risk syncope'
  | 'Simulated'

/** A line in the explain panel that maps a waveform segment to its mechanism. */
export interface SegmentNote {
  segment: 'P' | 'PR' | 'QRS' | 'ST' | 'T'
  title: string
  detail: string
}

/**
 * One link in the causal chain from pathophysiology to waveform — the
 * "whiteboard" an attending draws: this happens in the tissue (cause), so the
 * tracing does this (effect).
 */
export interface MechanismStep {
  /** What happens in the myocardium / conduction system. */
  cause: string
  /** The electrical / ECG consequence that follows from it. */
  effect: string
}

export interface Condition {
  id: string
  name: string
  shortName: string
  category: ConditionCategory
  tagline: string
  criteria: string[]
  story: string
  description: string
  segmentNotes: SegmentNote[]
  /** The ED bottom line — what it means and what to DO. */
  clinical: string
  /** Findings for the systematic read (the steps not derivable from measurements). */
  read?: { rhythm: string; morphology: string; ischemia: string }
  /** The whiteboard: an ordered cause→effect chain from mechanism to waveform. */
  mechanism?: MechanismStep[]
  /** Attending pearls — fast recognition cues, classic traps, and don't-miss points. */
  pearls?: string[]
  /** Hidden from the picker (e.g. solver-validation duplicates); still deep-linkable. */
  hidden?: boolean
  /** Conduction branches drawn as blocked/greyed in the heart diagram. */
  blockedBranches?: StructureId[]
  buildStrip: () => Strip
}
