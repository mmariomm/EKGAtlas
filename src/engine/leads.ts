/**
 * The 12 standard ECG leads, each expressed as a unit "viewing axis" in the
 * anatomical frame from vectorMath.ts. A lead's deflection at any instant is
 * simply the dot product of the heart's dipole vector with this axis — that is
 * the entire physical basis of the ECG, and the reason one moving vector can
 * drive all 12 traces consistently.
 */
import { Vec3, normalize } from './vectorMath'

export type LeadId =
  | 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF'
  | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6'

export const LIMB_LEADS: LeadId[] = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF']
export const PRECORDIAL_LEADS: LeadId[] = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']
export const ALL_LEADS: LeadId[] = [...LIMB_LEADS, ...PRECORDIAL_LEADS]

/** Frontal-plane (limb) lead from its hexaxial angle in degrees. */
const limb = (deg: number): Vec3 => {
  const r = (deg * Math.PI) / 180
  return normalize([Math.cos(r), Math.sin(r), 0])
}

/**
 * Lead viewing axes (unit vectors).
 *
 * Limb leads follow the textbook hexaxial reference (Einthoven + Goldberger).
 * Precordial axes are tuned in the transverse (x = left, z = anterior) plane to
 * reproduce normal R-wave progression: rS in V1 → transition near V3 → tall qR
 * in V6, given a normal QRS vector pointing left-inferior-posterior.
 */
export const LEAD_AXES: Record<LeadId, Vec3> = {
  I: limb(0),
  II: limb(60),
  III: limb(120),
  aVR: limb(-150),
  aVL: limb(-30),
  aVF: limb(90),
  V1: normalize([-0.46, 0.0, 0.89]),
  V2: normalize([0.0, 0.0, 1.0]),
  V3: normalize([0.35, 0.0, 0.94]),
  V4: normalize([0.65, 0.0, 0.76]),
  V5: normalize([0.87, 0.05, 0.5]),
  V6: normalize([1.0, 0.05, 0.0]),
}

/** Anatomical region each lead "looks at" — used for the explain panel. */
export const LEAD_REGION: Record<LeadId, string> = {
  I: 'Lateral', II: 'Inferior', III: 'Inferior',
  aVR: 'Right / cavity', aVL: 'Lateral', aVF: 'Inferior',
  V1: 'Septal', V2: 'Septal', V3: 'Anterior',
  V4: 'Anterior', V5: 'Lateral', V6: 'Lateral',
}
