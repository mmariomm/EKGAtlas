/**
 * Reusable building blocks for authoring conditions.
 *
 * Every condition is assembled from the same vocabulary: atrial lobes, a set of
 * ventricular QRS lobes, a T-wave lobe, and the matching conduction events. NSR
 * uses the normal versions; the blocks and ectopics swap in altered ventricular
 * lobes/events so the trace and the heart animation change together.
 *
 * All timings are in ms relative to the beat's onset (onset = start of the P).
 */
import { ActivationLobe, Beat, ConductionEvent } from '../engine/types'

/** Default sinus cycle length (75 bpm). */
export const RR_DEFAULT = 800

// --- Atrial depolarization (P wave): two sub-lobes → biphasic P in V1 ---------
export const atrialLobes = (): ActivationLobe[] => [
  { dir: [0.35, 0.75, 0.5], mag: 0.09, center: 40, width: 22, segment: 'P' }, // RA, anterior
  { dir: [0.55, 0.62, -0.3], mag: 0.08, center: 66, width: 24, segment: 'P' }, // LA, posterior
]

export const atrialEvents = (): ConductionEvent[] => [
  { structure: 'SA', start: 0, end: 14, kind: 'sa' },
  { structure: 'RA', start: 4, end: 66, kind: 'atria' },
  { structure: 'LA', start: 28, end: 92, kind: 'atria' },
  { structure: 'AV', start: 92, end: 156, kind: 'av', note: 'AV node delay' },
]

// --- Normal His–Purkinje + ventricular depolarization (narrow QRS) ------------
export const normalQrsLobes = (): ActivationLobe[] => [
  { dir: [-0.35, 0.1, 0.65], mag: 0.16, center: 166, width: 8, segment: 'QRS' }, // septal q (L→R)
  { dir: [0.85, 0.45, -0.25], mag: 1.5, center: 190, width: 13, segment: 'QRS' }, // main R (LV)
  { dir: [-0.5, -0.2, -0.5], mag: 0.2, center: 216, width: 11, segment: 'QRS' }, // terminal S (basal)
]

export const normalVentricleEvents = (): ConductionEvent[] => [
  // The impulse races down the wires (amber)…
  { structure: 'HIS', start: 150, end: 166, kind: 'av' },
  { structure: 'RBB', start: 158, end: 178, kind: 'av' },
  { structure: 'LBB', start: 158, end: 174, kind: 'av' },
  { structure: 'LAF', start: 162, end: 182, kind: 'av' },
  { structure: 'LPF', start: 162, end: 180, kind: 'av' },
  // …then muscle depolarizes (gold), septum first, walls sweeping outward.
  { structure: 'SEPTUM', start: 158, end: 192, kind: 'ventricle' },
  { structure: 'RV', start: 170, end: 232, kind: 'ventricle' },
  { structure: 'LV', start: 176, end: 244, kind: 'ventricle' },
]

// --- Repolarization (T wave) --------------------------------------------------
export const normalTLobe = (): ActivationLobe => ({
  dir: [0.55, 0.5, 0.32], mag: 0.4, center: 362, width: 54, segment: 'T',
})

// Starts after depolarization has faded, so the wavefront hand-off is clean.
export const repolEvents = (): ConductionEvent[] => [
  { structure: 'LV', start: 330, end: 470, kind: 'repol' },
  { structure: 'RV', start: 322, end: 452, kind: 'repol' },
]

/** A complete normal sinus beat at the given absolute onset. */
export const sinusBeat = (onset: number, label?: string): Beat => ({
  onset,
  label,
  lobes: [...atrialLobes(), ...normalQrsLobes(), normalTLobe()],
  events: [...atrialEvents(), ...normalVentricleEvents(), ...repolEvents()],
})

/** Tile `count` identical sinus beats at interval `rr`; returns beats + duration. */
export const tileSinus = (count: number, rr = RR_DEFAULT) => {
  const beats: Beat[] = []
  for (let i = 0; i < count; i++) beats.push(sinusBeat(i * rr))
  return { beats, durationMs: count * rr }
}
