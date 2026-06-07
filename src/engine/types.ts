/**
 * The data model. A Condition produces a Strip (a timeline of Beats). Each Beat
 * carries two synchronized descriptions of the same electrical event:
 *
 *   1. `lobes`  — Gaussian "pushes" of the dipole vector. Summed over time they
 *                 ARE the heart vector V(t); projected onto a lead they ARE that
 *                 lead's waveform. This is what the trace and the vector arrow read.
 *
 *   2. `events` — which conduction structures light up, and when. This is what
 *                 the heart diagram animates. Authored alongside the lobes so the
 *                 glow and the waveform always tell the same story.
 */
import { Vec3 } from './vectorMath'

/** Conduction-system structures + chambers the heart diagram can illuminate. */
export type StructureId =
  | 'SA' | 'RA' | 'LA' | 'AV' | 'HIS'
  | 'RBB' | 'LBB' | 'LAF' | 'LPF'
  | 'SEPTUM' | 'RV' | 'LV'
  | 'FOCUS' // a generic ectopic focus, positioned per-beat

/** Phase tone — drives the shared cross-modal color binding (heart ↔ trace). */
export type PhaseTone = 'sa' | 'atria' | 'av' | 'ventricle' | 'repol' | 'injury' | 'rest'

/** A single Gaussian contribution to the dipole vector over the cardiac cycle. */
export interface ActivationLobe {
  /** Direction the dipole points during this push (need not be unit length). */
  dir: Vec3
  /** Peak magnitude in mV-equivalent units. */
  mag: number
  /** Time of the peak, in ms relative to the beat's onset. */
  center: number
  /** Std-dev (ms). Small = sharp (QRS); large = broad (P, T, injury current). */
  width: number
  /** Tag for axis/segment math and click-to-explain (e.g. 'QRS', 'T', 'ST'). */
  segment?: 'P' | 'QRS' | 'ST' | 'T'
}

/** One structure lighting up over a time window, for the heart animation. */
export interface ConductionEvent {
  structure: StructureId
  /** ms relative to beat onset. */
  start: number
  /** ms relative to beat onset. */
  end: number
  kind: PhaseTone
  /** Optional narration shown while this event leads (overrides the default). */
  note?: string
}

/** A position for an ectopic focus marker, in heart-diagram normalized coords. */
export interface FocusSpec {
  /** 0..1 across the heart diagram width. */
  x: number
  /** 0..1 down the heart diagram height. */
  y: number
  label: string
}

export interface Beat {
  /** Absolute start time of this beat within the strip, in ms. */
  onset: number
  lobes: ActivationLobe[]
  events: ConductionEvent[]
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

/** A line in the explain panel that maps a waveform segment to its mechanism. */
export interface SegmentNote {
  segment: 'P' | 'PR' | 'QRS' | 'ST' | 'T'
  title: string
  detail: string
}

export interface Condition {
  id: string
  name: string
  /** Compact label for the picker list. */
  shortName: string
  category: ConditionCategory
  /** One-line hook shown under the title. */
  tagline: string
  /** Diagnostic criteria chips. */
  criteria: string[]
  /** The sequence caption, e.g. "NSR → NSR → VPC → pause → NSR". */
  story: string
  /** Longer "why it looks like this" prose for the explain panel. */
  description: string
  /** Mechanism notes keyed to waveform segments. */
  segmentNotes: SegmentNote[]
  /** Conduction branches drawn as blocked/greyed in the heart diagram. */
  blockedBranches?: StructureId[]
  /** Build the loopable strip. */
  buildStrip: () => Strip
}
