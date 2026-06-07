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

/** Activation result for a region: time + where the wavefront entered from. */
interface RegionHit {
  t: number
  /** Neighbour position the wave arrived from (cell-to-cell), or null if Purkinje-seeded. */
  viaPos: Vec3 | null
}

/** Activation times for the myocardial regions (fast seed OR slow cell-to-cell). */
const solveRegions = (state: TissueState, nodeT: Map<NodeId, number>): Map<string, RegionHit> => {
  const scar = new Set(state.scar ?? [])
  const dist = new Map<string, RegionHit>()
  const pace = state.pace ?? 'SA'

  for (const r of REGIONS) {
    if (scar.has(r.id)) continue
    if (!isNode(pace) && r.id === pace) {
      dist.set(r.id, { t: 0, viaPos: null }) // ectopic origin
    } else if (nodeT.has(r.seededBy)) {
      dist.set(r.id, { t: (nodeT.get(r.seededBy) as number) + r.coupling, viaPos: null })
    }
  }

  // Dijkstra over regions for the slow cell-to-cell paths. Track which neighbour
  // the wavefront came from, so the dipole can point along the propagation
  // direction — this is what makes the LBBB septal-q loss and the RBBB R' emerge.
  const settled = new Set<string>()
  for (;;) {
    let cur: string | null = null
    let best = Infinity
    for (const [id, h] of dist) if (!settled.has(id) && h.t < best) { best = h.t; cur = id }
    if (cur == null) break
    settled.add(cur)
    const curPos = REGION_BY_ID[cur].pos
    for (const nb of REGION_BY_ID[cur].neighbors) {
      if (scar.has(nb.id)) continue
      const cand = best + nb.delay
      const ex = dist.get(nb.id)
      if (!ex || cand < ex.t) dist.set(nb.id, { t: cand, viaPos: curPos })
    }
  }
  return dist
}

// Faithful-ish T wave: a PRIMARY (concordant) component plus a SECONDARY component
// that grows with how late a region activates relative to the ventricular mean.
// Synchronous activation → every region stays positive → concordant T. BBB/ectopy
// (dyssynchronous) → late regions flip negative → discordant T emerges on its own.
const T_PRIMARY = 0.34
const T_SECONDARY = 0.95
const T_DYSSYNC = 55 // ms scale over which "lateness" matters
const T_APD = 185 // ms from activation to the T peak (keeps QT in a realistic range)

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

  // Ventricular activation window + mass-weighted mean (drives ST placement + the
  // secondary T component).
  let ventMax = 0
  let aSum = 0
  let aMass = 0
  for (const r of REGIONS) {
    const h = regionT.get(r.id)
    if (h == null || r.structure === 'RA' || r.structure === 'LA') continue
    ventMax = Math.max(ventMax, h.t)
    aSum += h.t * r.mass
    aMass += r.mass
  }
  const meanA = aMass > 0 ? aSum / aMass : 0

  for (const r of REGIONS) {
    const hit = regionT.get(r.id)
    if (hit == null || scar.has(r.id)) continue
    const t = hit.t
    // Each wall's intrinsic (endo→epi) direction carries the bulk vector — correct
    // axis and BBB morphology (and the late intrinsic RV still gives the RBBB R').
    // The septum is the exception: activated retrograde from the RV side it
    // depolarizes right→left, flipping the septal q (the LBBB hallmark).
    let dir: Vec3 = r.dir
    if (r.id === 'SEPTUM' && hit.viaPos && hit.viaPos[0] < r.pos[0]) {
      dir = [-r.dir[0], r.dir[1], -r.dir[2]]
    }
    const isAtrial = r.structure === 'RA' || r.structure === 'LA'
    const segment = isAtrial ? 'P' : 'QRS'
    const kind = isAtrial ? 'atria' : 'ventricle'

    // depolarization
    sources.push({
      dir, mag: r.mass, center: t, width: 10, segment,
      glow: { structures: [r.structure], kind, start: t - 6, end: t + 52 },
    })

    // repolarization: primary (concordant) + secondary (discordant if late)
    if (!isAtrial) {
      const repolMag = r.mass * (T_PRIMARY - T_SECONDARY * ((t - meanA) / T_DYSSYNC))
      const rc = t + T_APD
      sources.push({
        dir, mag: repolMag, center: rc, width: 60, segment: 'T',
        glow: { structures: [r.structure], kind: 'repol', start: rc - 48, end: rc + 48 },
      })
    }

    // ischemic injury → sustained ST vector pointing toward the injured wall
    if (ischemic.has(r.id)) {
      const injuryDir: Vec3 = normalize(r.pos)
      sources.push({
        dir: injuryDir, mag: 0.5, center: ventMax + 70, width: 46, segment: 'ST',
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
