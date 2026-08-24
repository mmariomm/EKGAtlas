/**
 * The propagation solver. Given a TissueState it computes when every
 * conduction node and myocardial region activates, then emits a Beat in the
 * Source/Wire model. Block an edge → that branch's territory is reached late
 * via slow cell-to-cell spread (a wide QRS emerges); pace from a region → an
 * ectopic beat; mark a region ischemic → a sustained ST injury vector.
 *
 * Honest scope: depolarization/QRS and conduction blocks emerge faithfully.
 * The T uses a simplified primary + dyssynchrony-secondary recovery model.
 */
import { CONDUCTION_EDGES, HEART_SCALE, NodeId, REGIONS, REGION_BY_ID } from './heartModel'
import { Beat, Source, WirePulse } from './sources'
import { normalize, scale, Vec3 } from './vec'

export interface TissueState {
  /** Pacing site: a conduction node (default 'SA') or a region id (ectopic). */
  pace?: NodeId | string
  /** Blocked conduction edges, as `${from}>${to}` keys. */
  blockedEdges?: string[]
  /** Ablated/scarred regions: electrically silent + conduction barriers. */
  scar?: string[]
  /** Ischemic/injured regions: produce an ST injury vector + glow red. */
  ischemic?: string[]
  /** Direction the ST injury vector points (toward the injured epicardium). */
  injuryDir?: Vec3
  /** Injury current magnitude (mV-equivalent). */
  injuryMag?: number
}

const NODES: NodeId[] = ['SA', 'AV', 'HIS', 'RBB', 'LBB', 'LAF', 'LPF']
const isNode = (s: string): s is NodeId => (NODES as string[]).includes(s)

/** Activation times for the conduction nodes from the pacing site. */
const solveNodes = (state: TissueState): Map<NodeId, number> => {
  const dist = new Map<NodeId, number>()
  const pace = state.pace ?? 'SA'
  if (!isNode(pace)) return dist // ectopic pacing: no antegrade conduction
  dist.set(pace, 0)
  const blocked = new Set(state.blockedEdges ?? [])
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

interface RegionHit {
  t: number
  /** Neighbour position the wave arrived from (cell-to-cell), else null. */
  viaPos: Vec3 | null
}

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

  // Dijkstra over regions for the slow cell-to-cell paths, tracking the
  // arriving direction so LBBB septal-q loss and the RBBB R' emerge.
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

// Primary (concordant) + secondary (dyssynchrony-driven) recovery components.
// T width/timing sharpened vs v1 so the ST segment stays honestly isoelectric
// (a Gaussian's foot must not masquerade as an ST shift).
const T_PRIMARY = 0.34
const T_SECONDARY = 0.95
const T_DYSSYNC = 55
const T_APD = 205
const T_WIDTH = 45

/** Run the simulation and emit one Beat (times relative to `onset`). */
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
    // The septum is activated retrograde (from the RV side) when the wave
    // arrives cell-to-cell from the right — flipping the septal q (LBBB).
    let dir: Vec3 = r.dir
    if (r.id === 'SEPTUM' && hit.viaPos && hit.viaPos[0] < r.pos[0]) {
      dir = [-r.dir[0], r.dir[1], -r.dir[2]]
    }
    const isAtrial = r.structure === 'RA' || r.structure === 'LA'
    const segment = isAtrial ? 'P' : 'QRS'
    const kind = isAtrial ? 'atria' : 'ventricle'
    const pos = scale(r.pos, HEART_SCALE)

    sources.push({
      dir, mag: r.mass, center: t, width: 10, segment, pos,
      glow: { structures: [r.structure], kind, start: t - 6, end: t + 52 },
    })

    if (!isAtrial) {
      const repolMag = r.mass * (T_PRIMARY - T_SECONDARY * ((t - meanA) / T_DYSSYNC))
      const rc = t + T_APD
      sources.push({
        dir, mag: repolMag, center: rc, width: T_WIDTH, segment: 'T', pos,
        glow: { structures: [r.structure], kind: 'repol', start: rc - 48, end: rc + 48 },
      })
    }
  }

  // Ischemic injury → ONE sustained ST vector toward the injured epicardium.
  if (ischemic.size > 0) {
    const ids = [...ischemic].filter((id) => REGION_BY_ID[id])
    const dir = state.injuryDir ?? normalize(
      ids.reduce<Vec3>((a, id) => [a[0] + REGION_BY_ID[id].pos[0], a[1] + REGION_BY_ID[id].pos[1], a[2] + REGION_BY_ID[id].pos[2]], [0, 0, 0]),
    )
    const centroid = ids.reduce<Vec3>((a, id) => [a[0] + REGION_BY_ID[id].pos[0] / ids.length, a[1] + REGION_BY_ID[id].pos[1] / ids.length, a[2] + REGION_BY_ID[id].pos[2] / ids.length], [0, 0, 0])
    const structures = [...new Set(ids.map((id) => REGION_BY_ID[id].structure))]
    sources.push({
      dir, mag: state.injuryMag ?? 0.6, center: ventMax + 72, width: 48, segment: 'ST',
      pos: scale(centroid, HEART_SCALE),
      glow: { structures, kind: 'injury', start: ventMax + 20, end: ventMax + 145, note: 'injury current' },
    })
  }

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

/** Tile a tissue state into a looping strip. */
export const tileState = (state: TissueState, count = 3, rr = 800) => ({
  beats: Array.from({ length: count }, (_, i) => simulateBeat(state, i * rr)),
  durationMs: count * rr,
})
