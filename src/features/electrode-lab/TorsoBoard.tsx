/**
 * The torso: ten electrode pucks over a front-view figure. Chest pucks drag
 * freely on the chest wall; limb pucks snap between the four labeled sockets —
 * dropping one on an occupied socket swaps the two cables.
 *
 * View convention: the chest is drawn "unrolled" — horizontal position is
 * azimuth-linear (asin of the 3D x), the standard medical-illustration trick
 * that keeps V4–V6 legible on a front view. 3D positions stay exact; only the
 * projection is unrolled, and dragging inverts the same mapping (so pucks
 * follow the finger and wrap around the chest wall, never snapping back).
 *
 * In real-recording mode chest pucks are locked (chest leads cannot be
 * re-derived from a recording) and say so when touched.
 */
import { useRef, useState } from 'react'
import {
  CableId, ChestCable, CHEST_CABLES, LimbCable, LIMB_CABLES,
} from '../../engine/electrodes'
import { TORSO_AZ } from '../../engine/torso'
import { Vec3 } from '../../engine/vec'
import { metric } from '../../lib/metrics'
import './TorsoBoard.css'

/** Board state: limb cable → limb slot; chest cable → 3D position. */
export interface BoardState {
  limbSlot: Record<LimbCable, LimbCable>
  chest: Record<ChestCable, Vec3>
}

const CX = 130
const CY = 158
const SCALE = 92
const HALF_PI = Math.PI / 2

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 3D x → unrolled view x in [-1, 1] (azimuth-linear). */
const viewX = (x3d: number) => Math.asin(clamp(x3d, -1, 1)) / HALF_PI
const SX = (x3d: number) => CX + viewX(x3d) * SCALE
const SY = (y: number) => CY + y * SCALE
const toBoard = (p: Vec3): [number, number] => [SX(p[0]), SY(p[1])]

/** Inverse: board point → 3D point ON the chest wall at that azimuth. */
const fromBoard = (sx: number, sy: number): Vec3 => {
  const az = clamp((sx - CX) / SCALE, -0.995, 0.995) * HALF_PI
  const y = clamp((sy - CY) / SCALE, -1.6, 1.6)
  return [Math.sin(az), y, Math.max(0.05, TORSO_AZ * Math.cos(az))]
}

/** Where each limb SOCKET is drawn (anatomical; physics uses STANDARD_SITES). */
const LIMB_SLOT_XY: Record<LimbCable, [number, number]> = {
  RA: [34, 40], LA: [226, 40], LL: [182, 306], RL: [78, 306],
}
const LIMB_LABEL_DY: Record<LimbCable, number> = { RA: -24, LA: -24, LL: 27, RL: 27 }

/** AHA/AAMI cable colors, desaturated for the dark surface — identity at a glance. */
const CABLE_HUE: Record<CableId, string> = {
  RA: '#dfe5f0', LA: '#828da3', RL: '#63b878', LL: '#d96a6a',
  V1: '#d96a6a', V2: '#d4ad52', V3: '#63b878', V4: '#6a8fd9', V5: '#d9905f', V6: '#a97fd9',
}

/** Anatomical guide lines (patient left), at the azimuth each line names. */
const GUIDES: { label: string; x3d: number }[] = [
  { label: 'MCL', x3d: 0.5 },
  { label: 'AAL', x3d: 0.78 },
  { label: 'MAL', x3d: 0.995 },
]

interface Props {
  state: BoardState
  onChange: (next: BoardState) => void
  /** chest drags disabled (real-recording mode) */
  chestLocked: boolean
  onChestLockedTouch?: () => void
  onChestDrag?: (cable: ChestCable) => void
  /** standard chest positions, for ghost rings when a puck is displaced */
  standardChest: Record<ChestCable, Vec3>
}

export default function TorsoBoard({
  state, onChange, chestLocked, onChestLockedTouch, onChestDrag, standardChest,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ cable: CableId; x: number; y: number } | null>(null)

  const boardPoint = (e: React.PointerEvent): [number, number] => {
    const svg = svgRef.current!
    const r = svg.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 260, ((e.clientY - r.top) / r.height) * 340]
  }

  const startDrag = (cable: CableId) => (e: React.PointerEvent) => {
    if (chestLocked && (CHEST_CABLES as string[]).includes(cable)) {
      onChestLockedTouch?.()
      return
    }
    metric('manipulate')
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const [x, y] = boardPoint(e)
    setDrag({ cable, x, y })
    if ((CHEST_CABLES as string[]).includes(cable)) onChestDrag?.(cable as ChestCable)
  }

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return
    const [x, y] = boardPoint(e)
    setDrag({ ...drag, x, y })
    if ((CHEST_CABLES as string[]).includes(drag.cable)) {
      const pos = fromBoard(x, y)
      onChange({ ...state, chest: { ...state.chest, [drag.cable]: pos } })
    }
  }

  const endDrag = () => {
    if (!drag) return
    if ((LIMB_CABLES as string[]).includes(drag.cable)) {
      // snap to the nearest limb socket; swap with its occupant
      let best: LimbCable = 'RA'
      let bestD = Infinity
      for (const slot of LIMB_CABLES) {
        const [sx, sy] = LIMB_SLOT_XY[slot]
        const d = Math.hypot(sx - drag.x, sy - drag.y)
        if (d < bestD) { bestD = d; best = slot }
      }
      const me = drag.cable as LimbCable
      const mySlot = state.limbSlot[me]
      if (best !== mySlot) {
        const occupant = (Object.keys(state.limbSlot) as LimbCable[]).find((c) => state.limbSlot[c] === best)!
        onChange({
          ...state,
          limbSlot: { ...state.limbSlot, [me]: best, [occupant]: mySlot },
        })
      }
    }
    setDrag(null)
  }

  const puckXY = (cable: CableId): [number, number] => {
    if (drag?.cable === cable) return [drag.x, drag.y]
    if ((LIMB_CABLES as string[]).includes(cable)) return LIMB_SLOT_XY[state.limbSlot[cable as LimbCable]]
    return toBoard(state.chest[cable as ChestCable])
  }

  const displacedChest = CHEST_CABLES.filter((c) => {
    const p = state.chest[c]
    const s = standardChest[c]
    return Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) > 0.06
  })

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 260 340"
      className="torso"
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="application"
      aria-label="Torso with draggable electrodes"
    >
      {/* figure */}
      <g className="torso-fig">
        <path d="M97 20 Q97 34 88 40 L54 52 Q30 60 28 86 L24 128 Q22 150 30 178 L40 236 Q44 258 60 272 L74 312 Q76 322 86 324 L174 324 Q184 322 186 312 L200 272 Q216 258 220 236 L230 178 Q238 150 236 128 L232 86 Q230 60 206 52 L172 40 Q163 34 163 20" />
        <line x1="130" y1="52" x2="130" y2="200" className="torso-sternum" />
        <path d="M92 46 L128 58 M168 46 L132 58" className="torso-clav" />
        <path d="M76 120 Q130 140 184 120 M72 150 Q130 172 188 150 M74 180 Q130 202 186 180" className="torso-ribs" />
      </g>

      {/* anatomical guide lines (patient left) */}
      {GUIDES.map((g) => {
        const gx = SX(g.x3d)
        return (
          <g key={g.label} className="torso-guide">
            <line x1={gx} y1={78} x2={gx} y2={300} />
            <text x={gx} y={72} textAnchor="middle">{g.label}</text>
          </g>
        )
      })}

      {/* limb sockets, labeled — a swapped cable is a visible mismatch */}
      {LIMB_CABLES.map((slot) => {
        const [sx, sy] = LIMB_SLOT_XY[slot]
        return (
          <g key={slot}>
            <circle cx={sx} cy={sy} r={16} className="torso-slot" />
            <text x={sx} y={sy + LIMB_LABEL_DY[slot]} textAnchor="middle" className="torso-slotlabel">
              {slot}
            </text>
          </g>
        )
      })}

      {/* ghost rings: where a displaced electrode belongs */}
      {displacedChest.map((c) => {
        const [gx, gy] = toBoard(standardChest[c])
        const [px, py] = puckXY(c)
        return (
          <g key={`ghost-${c}`} className="torso-ghost" style={{ color: CABLE_HUE[c] }}>
            <line x1={gx} y1={gy} x2={px} y2={py} className="torso-ghost-leader" />
            <circle cx={gx} cy={gy} r={11} />
            <text x={gx} y={gy + 3} textAnchor="middle">{c}</text>
          </g>
        )
      })}

      {/* pucks */}
      {([...LIMB_CABLES, ...CHEST_CABLES] as CableId[]).map((cable) => {
        const [sx, sy] = puckXY(cable)
        const chest = (CHEST_CABLES as string[]).includes(cable)
        const locked = chest && chestLocked
        const active = drag?.cable === cable
        return (
          <g
            key={cable}
            transform={`translate(${sx} ${sy})`}
            className={`puck ${locked ? 'puck-locked' : ''} ${active ? 'puck-active' : ''}`}
            style={{ color: CABLE_HUE[cable] }}
            onPointerDown={startDrag(cable)}
          >
            <circle r={18} className="puck-hit" />
            <circle r={active ? (chest ? 14.5 : 16) : chest ? 11.5 : 13} className="puck-body" />
            <text y="3.5" textAnchor="middle" className="puck-label">{cable}</text>
          </g>
        )
      })}
    </svg>
  )
}

export const standardBoard = (): BoardState => ({
  limbSlot: { RA: 'RA', LA: 'LA', LL: 'LL', RL: 'RL' },
  chest: {
    V1: [-0.22, -0.1, 0.68], V2: [0.22, -0.1, 0.68], V3: [0.45, 0.12, 0.63],
    V4: [0.65, 0.35, 0.53], V5: [0.85, 0.38, 0.37], V6: [0.98, 0.4, 0.14],
  },
})
