/**
 * Minimal 3D vector helpers for the cardiac dipole model.
 *
 * Anatomical frame (all electrodes + the heart vector live here):
 *   x = patient's LEFT      (+)
 *   y = INFERIOR / caudal   (+)   (downward, toward the feet)
 *   z = ANTERIOR / forward  (+)   (toward the chest wall)
 *
 * The frontal plane is (x, y) — what the six limb leads "see" and what the
 * clinical QRS *axis* describes. The transverse plane is (x, z).
 */

export type Vec3 = readonly [number, number, number]

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export const magnitude = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])

export const normalize = (a: Vec3): Vec3 => {
  const m = magnitude(a) || 1
  return [a[0] / m, a[1] / m, a[2] / m]
}

export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x

/** Hermite smoothstep from 0→1 across [a, b]. */
export const smoothstep = (a: number, b: number, x: number): number => {
  if (a === b) return x < a ? 0 : 1
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Frontal-plane angle of a vector, in degrees, in the clinical hexaxial
 * convention: 0° = lead I (patient's left), +90° = aVF (inferior),
 * ±180° = right, −90° = superior.
 */
export const frontalAngleDeg = (v: Vec3): number => (Math.atan2(v[1], v[0]) * 180) / Math.PI

/** Frontal-plane magnitude (length of the arrow drawn on the heart view). */
export const frontalMagnitude = (v: Vec3): number => Math.hypot(v[0], v[1])
