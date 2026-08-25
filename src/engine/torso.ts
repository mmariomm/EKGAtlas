/**
 * The torso: an upright elliptic cylinder used ONLY to constrain electrode
 * positions and to draw the torso figure. The volume conductor itself is
 * infinite and homogeneous (a teaching model — declared on the About page).
 */
import { Vec3 } from './vec'

export const TORSO_AX = 1.0 // semi-axis, patient left-right
export const TORSO_AZ = 0.7 // semi-axis, antero-posterior
export const TORSO_Y_MIN = -1.6 // shoulders
export const TORSO_Y_MAX = 1.6 // hips

/**
 * Project a dragged precordial electrode onto the front torso surface:
 * y clamps to the trunk range, (x, z) projects radially onto the ellipse,
 * and z is kept anterior (chest electrodes live on the front).
 */
export const constrainPrecordial = (p: Vec3): Vec3 => {
  const y = Math.min(TORSO_Y_MAX, Math.max(TORSO_Y_MIN, p[1]))
  let x = p[0]
  let z = Math.max(0.05, p[2])
  const k = Math.hypot(x / TORSO_AX, z / TORSO_AZ) || 1
  x /= k
  z /= k
  return [x, y, z]
}

/** True when a point sits on the torso ellipse (tolerance for tests). */
export const onTorsoSurface = (p: Vec3, tol = 0.05): boolean =>
  Math.abs((p[0] / TORSO_AX) ** 2 + (p[2] / TORSO_AZ) ** 2 - 1) < tol
