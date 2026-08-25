/**
 * Electrodes and montages. A montage maps recorder CABLES to BODY SITES —
 * misplacement is just a different mapping, so every swap is ordinary physics.
 * Precordials lie on the torso ellipse; limb electrodes are fixed snap sites
 * (the limb is electrically a wire to its root).
 */
import { Vec3 } from './vec'

export type LimbCable = 'RA' | 'LA' | 'LL' | 'RL'
export type ChestCable = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6'
export type CableId = LimbCable | ChestCable

export const LIMB_CABLES: LimbCable[] = ['RA', 'LA', 'LL', 'RL']
export const CHEST_CABLES: ChestCable[] = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']

/**
 * Standard body sites (torso units; heart center at the origin).
 *
 * The two leg electrodes share ONE effective electrical site — the torso's
 * inferior pole. In a real body the legs are near-equipotential (which is why
 * the right leg works as ground anywhere); an infinite-medium dipole model
 * cannot reproduce that boundary effect, so it is encoded as a shared site
 * and declared on the About page. The lab still DRAWS the pucks at their
 * anatomical hip positions (DISPLAY_SITES).
 */
const LEG_POLE: Vec3 = [0.0, 1.65, 0.05]

export const STANDARD_SITES: Record<CableId, Vec3> = {
  RA: [-0.95, -1.35, 0.05],
  LA: [0.95, -1.35, 0.05],
  LL: LEG_POLE,
  RL: LEG_POLE,
  V1: [-0.22, -0.1, 0.68],
  V2: [0.22, -0.1, 0.68],
  V3: [0.45, 0.12, 0.63],
  V4: [0.65, 0.35, 0.53],
  V5: [0.85, 0.38, 0.37],
  V6: [0.98, 0.4, 0.14],
}

/** V1–V2 one-to-two interspaces too high (the classic misplacement). */
export const HIGH_V1: Vec3 = [-0.22, -0.55, 0.66]
export const HIGH_V2: Vec3 = [0.22, -0.55, 0.66]

/** Mirror-image V4 on the right chest (RV leads / dextrocardia workup). */
export const V4R: Vec3 = [-0.65, 0.35, 0.53]

/** Where the lab DRAWS the limb pucks (anatomical; physics uses STANDARD_SITES). */
export const DISPLAY_SITES: Record<CableId, Vec3> = {
  ...STANDARD_SITES,
  LL: [0.55, 1.55, 0.05],
  RL: [-0.55, 1.55, 0.05],
}

export interface Montage {
  site: Record<CableId, Vec3>
}

export const standardMontage = (): Montage => ({ site: { ...STANDARD_SITES } })

/** Swap which body sites two limb CABLES are clipped to. */
export const swapCables = (m: Montage, a: CableId, b: CableId): Montage => {
  const site = { ...m.site }
  ;[site[a], site[b]] = [site[b], site[a]]
  return { site }
}

/** Clockwise rotation of the four limb cables (RA→LA→LL→RL→RA sites). */
export const rotateLimbs = (m: Montage): Montage => {
  const site = { ...m.site }
  const [ra, la, ll, rl] = [site.RA, site.LA, site.LL, site.RL]
  site.LA = ra
  site.LL = la
  site.RL = ll
  site.RA = rl
  return { site }
}

export const moveCable = (m: Montage, cable: ChestCable, pos: Vec3): Montage => ({
  site: { ...m.site, [cable]: pos },
})

/** Named montage presets used by the Electrode Lab and its tests. */
export const PRESETS = {
  standard: standardMontage,
  'ra-la': () => swapCables(standardMontage(), 'RA', 'LA'),
  'la-ll': () => swapCables(standardMontage(), 'LA', 'LL'),
  'ra-ll': () => swapCables(standardMontage(), 'RA', 'LL'),
  'ra-rl': () => swapCables(standardMontage(), 'RA', 'RL'),
  'la-rl': () => swapCables(standardMontage(), 'LA', 'RL'),
  rotate: () => rotateLimbs(standardMontage()),
  'high-v1v2': () => moveCable(moveCable(standardMontage(), 'V1', HIGH_V1), 'V2', HIGH_V2),
} as const

export type PresetId = keyof typeof PRESETS
