/**
 * Reusable building blocks for authoring conditions, in the unified model.
 *
 * Each `Source` carries its dipole (waveform/vector) AND the glow it casts, so
 * the trace and the heart can't disagree. `wires` are glow-only conduction pulses.
 * All timings are ms relative to the beat onset (onset = start of the P).
 */
import { Beat, Source, WirePulse } from '../engine/types'

export const RR_DEFAULT = 800

// --- Atrial depolarization (P wave): RA then LA → biphasic P in V1 -----------
export const atrialSources = (): Source[] => [
  { dir: [0.35, 0.75, 0.5], mag: 0.09, center: 40, width: 22, segment: 'P', glow: { structures: ['RA'], kind: 'atria', start: 0, end: 70 } },
  { dir: [0.55, 0.62, -0.3], mag: 0.08, center: 66, width: 24, segment: 'P', glow: { structures: ['LA'], kind: 'atria', start: 28, end: 96 } },
]

// --- Normal ventricular depolarization (narrow QRS), septum → walls ----------
export const normalQrsSources = (): Source[] => [
  { dir: [-0.35, 0.1, 0.65], mag: 0.16, center: 166, width: 8, segment: 'QRS', glow: { structures: ['SEPTUM'], kind: 'ventricle', start: 158, end: 192 } }, // septal q (L→R)
  { dir: [0.8, 0.52, -0.22], mag: 1.5, center: 190, width: 13, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 176, end: 244 } }, // main R (LV) → axis ~+38°
  { dir: [-0.5, -0.2, -0.5], mag: 0.2, center: 216, width: 11, segment: 'QRS', glow: { structures: ['RV'], kind: 'ventricle', start: 170, end: 232 } }, // terminal / basal
]

// --- Repolarization (T wave): both ventricles recover -----------------------
export const normalTSource = (): Source => ({
  dir: [0.55, 0.5, 0.32], mag: 0.4, center: 362, width: 54, segment: 'T',
  glow: { structures: ['RV', 'LV'], kind: 'repol', start: 322, end: 470 },
})

// --- Conduction system racing toward the muscle (glow only) -----------------
export const conductionWires = (): WirePulse[] => [
  { structure: 'SA', start: 0, end: 14, kind: 'sa' },
  { structure: 'AV', start: 92, end: 156, kind: 'av', note: 'AV node delay' },
  { structure: 'HIS', start: 150, end: 166, kind: 'av' },
  { structure: 'RBB', start: 158, end: 178, kind: 'av' },
  { structure: 'LBB', start: 158, end: 174, kind: 'av' },
  { structure: 'LAF', start: 162, end: 182, kind: 'av' },
  { structure: 'LPF', start: 162, end: 180, kind: 'av' },
]

/** A complete normal sinus beat at the given absolute onset. */
export const sinusBeat = (onset: number, label?: string): Beat => ({
  onset,
  label,
  sources: [...atrialSources(), ...normalQrsSources(), normalTSource()],
  wires: conductionWires(),
})

/** Tile `count` identical sinus beats at interval `rr`; returns beats + duration. */
export const tileSinus = (count: number, rr = RR_DEFAULT) => {
  const beats: Beat[] = []
  for (let i = 0; i < count; i++) beats.push(sinusBeat(i * rr))
  return { beats, durationMs: count * rr }
}

/** Tile any beat-builder `count` times at interval `rr`. */
export const repeatBeat = (make: (onset: number) => Beat, count = 3, rr = RR_DEFAULT) => ({
  beats: Array.from({ length: count }, (_, i) => make(i * rr)),
  durationMs: count * rr,
})
