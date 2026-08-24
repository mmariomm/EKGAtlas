/**
 * The anatomical model the propagation solver runs on: a conduction graph
 * (SA → AV → His → bundles → fascicle exits) with per-edge delays, plus
 * myocardial regions (seeded fast by a conduction exit, linked to neighbours
 * for slow cell-to-cell spread) each carrying a dipole direction, mass, and
 * position. Region positions are heart-normalized; HEART_SCALE places them
 * inside the torso for the electrode forward model.
 */
import { Vec3 } from './vec'
import { StructureId } from './sources'

export type NodeId = 'SA' | 'AV' | 'HIS' | 'RBB' | 'LBB' | 'LAF' | 'LPF'

/** Heart radius as a fraction of the torso frame (dipole origin offsets). */
export const HEART_SCALE = 0.35

export interface ConductionEdge {
  from: NodeId
  to: NodeId
  delay: number
  /** Whether crossing this edge lights the `to` structure as a "wire". */
  wire: boolean
}

export interface Region {
  id: string
  structure: StructureId
  pos: Vec3
  /** Depolarization dipole direction (endocardium → epicardium). */
  dir: Vec3
  mass: number
  /** Conduction exit that ignites this region quickly (if reachable). */
  seededBy: NodeId
  /** ms from the seed exit to ignition. */
  coupling: number
  /** Cell-to-cell links (slow path used when the fast seed is unavailable). */
  neighbors: { id: string; delay: number }[]
}

export const CONDUCTION_EDGES: ConductionEdge[] = [
  { from: 'SA', to: 'AV', delay: 50, wire: false }, // internodal (atria fire off SA directly)
  { from: 'AV', to: 'HIS', delay: 90, wire: true }, // the AV nodal delay
  { from: 'HIS', to: 'RBB', delay: 18, wire: true },
  { from: 'HIS', to: 'LBB', delay: 8, wire: true },
  { from: 'LBB', to: 'LAF', delay: 8, wire: true },
  { from: 'LBB', to: 'LPF', delay: 8, wire: true },
]

/**
 * Ventricular dirs/masses are distributed so the normal sum reproduces the
 * validated v1 QRS (septal q + dominant LV + small RV).
 */
export const REGIONS: Region[] = [
  // --- atria (seeded straight off SA) ---
  { id: 'RA', structure: 'RA', pos: [-0.4, -0.3, 0.3], dir: [0.35, 0.75, 0.5], mass: 0.09, seededBy: 'SA', coupling: 12, neighbors: [{ id: 'LA', delay: 30 }] },
  { id: 'LA', structure: 'LA', pos: [0.4, -0.3, -0.2], dir: [0.55, 0.62, -0.3], mass: 0.08, seededBy: 'SA', coupling: 42, neighbors: [{ id: 'RA', delay: 30 }] },

  // --- septum (LV side first → L-to-R; gives the septal q) ---
  { id: 'SEPTUM', structure: 'SEPTUM', pos: [0.0, 0.15, 0.25], dir: [-0.35, 0.1, 0.65], mass: 0.16, seededBy: 'LAF', coupling: 2, neighbors: [{ id: 'LV_apex', delay: 42 }, { id: 'RV_inf', delay: 48 }] },

  // --- left ventricle walls (dominant; posterior-leftward → deep S in V1) ---
  { id: 'LV_apex', structure: 'LV', pos: [0.4, 0.65, 0.1], dir: [0.45, 0.6, 0.05], mass: 0.3, seededBy: 'LAF', coupling: 12, neighbors: [{ id: 'SEPTUM', delay: 46 }, { id: 'LV_ant', delay: 36 }, { id: 'LV_lat', delay: 38 }, { id: 'LV_inf', delay: 36 }] },
  { id: 'LV_ant', structure: 'LV', pos: [0.55, 0.1, 0.45], dir: [0.45, 0.1, 0.25], mass: 0.3, seededBy: 'LAF', coupling: 26, neighbors: [{ id: 'LV_apex', delay: 36 }, { id: 'LV_lat', delay: 34 }] },
  { id: 'LV_lat', structure: 'LV', pos: [0.95, 0.15, -0.15], dir: [0.85, 0.1, -0.42], mass: 0.5, seededBy: 'LAF', coupling: 42, neighbors: [{ id: 'LV_apex', delay: 38 }, { id: 'LV_ant', delay: 34 }, { id: 'LV_inf', delay: 38 }] },
  { id: 'LV_inf', structure: 'LV', pos: [0.45, 0.6, -0.4], dir: [0.4, 0.55, -0.5], mass: 0.35, seededBy: 'LPF', coupling: 34, neighbors: [{ id: 'LV_apex', delay: 36 }, { id: 'LV_lat', delay: 38 }] },

  // --- right ventricle (small; anterior-rightward, faces V1) ---
  // RV→septum spread is fast (26 ms): in LBBB the septal mass fires almost
  // with the RV free wall — the reason real LBBB has no lateral q. The
  // septum→RV direction stays slow (48 ms) so RBBB keeps its late R'.
  { id: 'RV_inf', structure: 'RV', pos: [-0.4, 0.6, 0.1], dir: [-0.25, 0.45, 0.15], mass: 0.14, seededBy: 'RBB', coupling: 12, neighbors: [{ id: 'SEPTUM', delay: 20 }, { id: 'RV_ant', delay: 44 }] },
  { id: 'RV_ant', structure: 'RV', pos: [-0.75, 0.2, 0.5], dir: [-0.42, -0.05, 0.56], mass: 0.16, seededBy: 'RBB', coupling: 40, neighbors: [{ id: 'RV_inf', delay: 46 }] },
]

export const REGION_BY_ID: Record<string, Region> = Object.fromEntries(REGIONS.map((r) => [r.id, r]))
