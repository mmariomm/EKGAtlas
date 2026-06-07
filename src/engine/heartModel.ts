/**
 * The anatomical heart model the propagation solver runs on.
 *
 *   - a conduction graph (SA → AV → His → bundle branches → fascicle exits),
 *     each edge with a conduction delay;
 *   - a set of myocardial regions, each seeded by a conduction exit (fast) and
 *     linked to neighbours for slow cell-to-cell spread, with a dipole direction,
 *     mass, and action-potential duration.
 *
 * Given a tissue state (pacing site, blocked edges, scar, ischemia), the solver
 * computes when each region activates → emits the Phase-A Source/Wire model. So
 * blocks/ectopy/ischemia EMERGE from geometry rather than being hand-authored.
 *
 * Region directions/masses are distributed so the normal sum reproduces the
 * tuned curated QRS; positions are stored for a future torso lead-field upgrade.
 */
import { Vec3 } from './vectorMath'
import { StructureId } from './types'

export type NodeId = 'SA' | 'AV' | 'HIS' | 'RBB' | 'LBB' | 'LAF' | 'LPF'

export interface ConductionEdge {
  from: NodeId
  to: NodeId
  /** Conduction delay along this edge, ms. */
  delay: number
  /** Whether crossing this edge lights the `to` structure as a "wire". */
  wire: boolean
}

export interface Region {
  id: string
  structure: StructureId
  pos: Vec3
  /** Depolarization dipole direction (endocardium → epicardium / propagation). */
  dir: Vec3
  mass: number
  /** Action-potential duration, ms (governs when this region repolarizes). */
  apd: number
  /** Conduction exit that ignites this region quickly (if reachable). */
  seededBy: NodeId
  /** ms from the seed exit to ignition. */
  coupling: number
  /** Cell-to-cell links (slow path used when the fast seed is unavailable). */
  neighbors: { id: string; delay: number }[]
}

/** SA fires at the pacing time; other nodes are reached by traversing edges. */
export const CONDUCTION_EDGES: ConductionEdge[] = [
  { from: 'SA', to: 'AV', delay: 50, wire: false }, // internodal (atria depolarize off SA directly)
  { from: 'AV', to: 'HIS', delay: 90, wire: true }, // the AV nodal delay
  { from: 'HIS', to: 'RBB', delay: 18, wire: true },
  { from: 'HIS', to: 'LBB', delay: 8, wire: true },
  { from: 'LBB', to: 'LAF', delay: 8, wire: true },
  { from: 'LBB', to: 'LPF', delay: 8, wire: true },
]

/**
 * Myocardial regions. Ventricular dirs/masses are a distributed version of the
 * curated QRS lobes (septal q + dominant LV + small RV); APDs carry a gradient
 * (later-activated regions recover earlier) so the normal T comes out concordant
 * and BBB T-discordance can emerge from the abnormal activation order.
 */
export const REGIONS: Region[] = [
  // --- atria (seeded straight off SA) ---
  { id: 'RA', structure: 'RA', pos: [-0.4, -0.3, 0.3], dir: [0.35, 0.75, 0.5], mass: 0.09, apd: 160, seededBy: 'SA', coupling: 12, neighbors: [{ id: 'LA', delay: 30 }] },
  { id: 'LA', structure: 'LA', pos: [0.4, -0.3, -0.2], dir: [0.55, 0.62, -0.3], mass: 0.08, apd: 160, seededBy: 'SA', coupling: 42, neighbors: [{ id: 'RA', delay: 30 }] },

  // --- septum (LV side first → L-to-R; gives the septal q) ---
  { id: 'SEPTUM', structure: 'SEPTUM', pos: [0.0, 0.15, 0.25], dir: [-0.35, 0.1, 0.65], mass: 0.16, apd: 300, seededBy: 'LAF', coupling: 2, neighbors: [{ id: 'LV_apex', delay: 42 }, { id: 'RV_inf', delay: 48 }] },

  // --- left ventricle walls (dominant ~1.45, posterior-leftward → deep S in V1) ---
  { id: 'LV_apex', structure: 'LV', pos: [0.4, 0.65, 0.1], dir: [0.45, 0.6, 0.05], mass: 0.3, apd: 250, seededBy: 'LAF', coupling: 10, neighbors: [{ id: 'SEPTUM', delay: 46 }, { id: 'LV_ant', delay: 36 }, { id: 'LV_lat', delay: 38 }, { id: 'LV_inf', delay: 36 }] },
  { id: 'LV_ant', structure: 'LV', pos: [0.55, 0.1, 0.45], dir: [0.45, 0.1, 0.25], mass: 0.3, apd: 245, seededBy: 'LAF', coupling: 16, neighbors: [{ id: 'LV_apex', delay: 36 }, { id: 'LV_lat', delay: 34 }] },
  { id: 'LV_lat', structure: 'LV', pos: [0.95, 0.15, -0.15], dir: [0.85, 0.1, -0.42], mass: 0.5, apd: 240, seededBy: 'LAF', coupling: 20, neighbors: [{ id: 'LV_apex', delay: 38 }, { id: 'LV_ant', delay: 34 }, { id: 'LV_inf', delay: 38 }] },
  { id: 'LV_inf', structure: 'LV', pos: [0.45, 0.6, -0.4], dir: [0.4, 0.55, -0.5], mass: 0.35, apd: 248, seededBy: 'LPF', coupling: 16, neighbors: [{ id: 'LV_apex', delay: 36 }, { id: 'LV_lat', delay: 38 }] },

  // --- right ventricle (small; anterior-rightward, faces V1) ---
  { id: 'RV_inf', structure: 'RV', pos: [-0.4, 0.6, 0.1], dir: [-0.25, 0.45, 0.15], mass: 0.14, apd: 220, seededBy: 'RBB', coupling: 10, neighbors: [{ id: 'SEPTUM', delay: 48 }, { id: 'RV_ant', delay: 44 }] },
  { id: 'RV_ant', structure: 'RV', pos: [-0.75, 0.2, 0.5], dir: [-0.6, -0.05, 0.42], mass: 0.16, apd: 210, seededBy: 'RBB', coupling: 16, neighbors: [{ id: 'RV_inf', delay: 46 }] },
]

export const REGION_BY_ID: Record<string, Region> = Object.fromEntries(REGIONS.map((r) => [r.id, r]))
