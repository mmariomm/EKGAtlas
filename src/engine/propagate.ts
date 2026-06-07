/**
 * The propagation solver. Given a TissueState it computes when every conduction
 * node and myocardial region activates, then emits a Beat in the Phase-A model
 * (Sources + Wires). Block an edge → that branch's territory is reached late via
 * slow cell-to-cell spread (a wide QRS emerges); pace from a region → an ectopic
 * beat; mark a region ischemic → an ST injury vector.
 *
 * NOTE (honest scope): depolarization/QRS and conduction blocks emerge faithfully
 * here. The T wave uses a simplified concordant recovery model for now; faithful
 * BBB T-discordance + full ischemia tuning are the next refinement.
 */
import { CONDUCTION_EDGES, NodeId, REGIONS, REGION_BY_ID } from './heartModel'
import { Beat, Source, WirePulse } from './types'
import { normalize, Vec3 } from './vectorMath'

export interface TissueState {
  /** Pacing site: a conduction node (default 'SA') or a region id (ectopic). */
  pace?: NodeId | string
  /** Blocked conduction edges, as `${from}>${to}` keys. */
  blockedEdges?: string[]
  /** Ablated/scarred regions: electrically silent + conduction barriers. */
  scar?: string[]
  /** Ischemic/injured regions: produce an ST injury vector. */
  ischemic?: string[]
}

const NODES: NodeId[] = ['SA', 'AV', 'HIS', 'RBB', 'LBB', 'LAF', 'LPF']
const isNode = (s: string): s is NodeId => (NODES as string[]).includes(s)

/** Activation times for the conduction nodes from the pacing site (antegrade). */
const solveNodes = (state: TissueState): Map<NodeId, number> => {
  const dist = new Map<NodeId, number>()
  const pace = state.pace ?? 'SA'
  if (!isNode(pace)) return dist // ectopic ventricular pacing: no antegrade conduction
  dist.set(pace, 0)
  const blocked = new Set(state.blockedEdges ?? [])
  // Small DAG → relax to a fixed point.
  let changed = true
  while (changed) {
    changed = false
    for (const e of CONDUCTION_EDGES) {
      if (blocked.has(`${e.from}>${e.to}`)) continue
      const from = dist.get(e.from)
      if (from == null) continue
      const cand = from + e.delay
      if (dist.get(e.to) == null || cand < (dist.get(e.to) as number)) {
        dist.set(e.to, cand)
        changed = true
      }
    }
  }
  return dist
}

/** Activation times for the myocardial regions (fast seed OR slow cell-to-cell). */
const solveRegions = (state: TissueState, nodeT: Map<NodeId, number>): Map<string, number> => {
  const scar = new Set(state.scar ?? [])
  const dist = new Map<string, number>()
  const pace = state.pace ?? 'SA'

  for (const r of REGIONS) {
    if (scar.has(r.id)) continue
    if (!isNode(pace) && r.id === pace) {
      dist.set(r.id, 0) // ectopic origin
    } else if (nodeT.has(r.seededBy)) {
      dist.set(r.id, (nodeT.get(r.seededBy) as number) + r.coupling)
    }
  }

  // Dijkstra over regions for the slow cell-to-cell paths.
  const settled = new Set<string>()
  for (;;) {
    let cur: string | null = null
    let best = Infinity
    for (const [id, d] of dist) if (!settled.has(id) && d < best) { best = d; cur = id }
    if (cur == null) break
    settled.add(cur)
    for (const nb of REGION_BY_ID[cur].neighbors) {
      if (scar.has(nb.id)) continue
      const cand = best + nb.delay
      if (dist.get(nb.id) == null || cand < (dist.get(nb.id) as number)) dist.set(nb.id, cand)
    }
  }
  return dist
}

const REPOL_FRACTION = 0.3 // T-wave magnitude relative to depolarization (simplified, concordant)

/** Run the simulation and emit one Beat (relative to `onset`). */
export const simulateBeat = (
  state: TissueState,
  onset: number,
  opts?: { label?: string; focus?: Beat['focus'] },
): Beat => {
  const nodeT = solveNodes(state)
  const regionT = solveRegions(state, nodeT)
  const scar = new Set(state.scar ?? [])
  const ischemic = new Set(state.ischemic ?? [])
  const sources: Source[] = []

  // Window of ventricular activation, for placing the ST/injury phase.
  let ventMax = 0
  for (const r of REGIONS) {
    const t = regionT.get(r.id)
    if (t != null && r.structure !== 'RA' && r.structure !== 'LA') ventMax = Math.max(ventMax, t)
  }

  for (const r of REGIONS) {
    const t = regionT.get(r.id)
    if (t == null || scar.has(r.id)) continue
    const isAtrial = r.structure === 'RA' || r.structure === 'LA'
    const segment = isAtrial ? 'P' : 'QRS'
    const kind = isAtrial ? 'atria' : 'ventricle'

    // depolarization
    sources.push({
      dir: r.dir, mag: r.mass, center: t, width: 10, segment,
      glow: { structures: [r.structure], kind, start: t - 6, end: t + 52 },
    })

    // repolarization (simplified concordant T)
    if (!isAtrial) {
      sources.push({
        dir: r.dir, mag: r.mass * REPOL_FRACTION, center: t + r.apd, width: 58, segment: 'T',
        glow: { structures: [r.structure], kind: 'repol', start: t + r.apd - 45, end: t + r.apd + 45 },
      })
    }

    // ischemic injury → sustained ST vector pointing toward the injured wall
    if (ischemic.has(r.id)) {
      const dir: Vec3 = normalize(r.pos)
      sources.push({
        dir, mag: 0.5, center: ventMax + 70, width: 46, segment: 'ST',
        glow: { structures: [r.structure], kind: 'injury', start: ventMax + 20, end: ventMax + 130, note: 'injury current' },
      })
    }
  }

  // conduction-system glow (SA fires at pacing; nodes light as reached)
  const wires: WirePulse[] = []
  if (isNode(state.pace ?? 'SA')) {
    const paceT = nodeT.get((state.pace ?? 'SA') as NodeId) ?? 0
    wires.push({ structure: 'SA', start: paceT, end: paceT + 14, kind: 'sa' })
  }
  for (const e of CONDUCTION_EDGES) {
    if (!e.wire) continue
    const t = nodeT.get(e.to)
    if (t == null) continue
    wires.push({ structure: e.to, start: t - 2, end: t + 16, kind: 'av', note: e.to === 'AV' ? 'AV node delay' : undefined })
  }

  return { onset, sources, wires, label: opts?.label, focus: opts?.focus }
}
