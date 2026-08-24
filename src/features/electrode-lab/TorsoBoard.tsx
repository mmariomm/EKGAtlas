/**
 * The torso: ten electrode pucks over a front-view figure. Chest pucks drag
 * freely (constrained to the torso surface); limb pucks snap between the four
 * limb positions — dropping one on an occupied slot swaps the two cables.
 * In real-recording mode chest pucks are locked (chest leads cannot be
 * re-derived from a recording) and say so when touched.
 */
import { useRef, useState } from 'react'
import {
  CableId, ChestCable, CHEST_CABLES, LimbCable, LIMB_CABLES,
} from '../../engine/electrodes'
import { constrainPrecordial } from '../../engine/torso'
import { Vec3 } from '../../engine/vec'
import { metric } from '../../lib/metrics'
import './TorsoBoard.css'

/** Board state: limb cable → limb slot; chest cable → 3D position. */
export interface BoardState {
  limbSlot: Record<LimbCable, LimbCable>
  chest: Record<ChestCable, Vec3>
}

/** 3D torso frame → 2D board coords (front view). */
const SX = (x: number) => 130 + x * 92
const SY = (y: number) => 158 + y * 92
const toBoard = (p: Vec3): [number, number] => [SX(p[0]), SY(p[1])]
const fromBoard = (sx: number, sy: number): Vec3 =>
  constrainPrecordial([(sx - 130) / 92, (sy - 158) / 92, 0.7])

/** Where each limb SLOT is drawn (anatomical; physics uses STANDARD_SITES). */
const LIMB_SLOT_XY: Record<LimbCable, [number, number]> = {
  RA: [34, 40], LA: [226, 40], LL: [182, 306], RL: [78, 306],
}

interface Props {
  state: BoardState
  onChange: (next: BoardState) => void
  /** chest drags disabled (real-recording mode) */
  chestLocked: boolean
  onChestLockedTouch?: () => void
  onChestDrag?: (cable: ChestCable) => void
}

export default function TorsoBoard({ state, onChange, chestLocked, onChestLockedTouch, onChestDrag }: Props) {
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
      // snap to the nearest limb slot; swap with its occupant
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

      {/* limb slots (empty rings) */}
      {LIMB_CABLES.map((slot) => {
        const [sx, sy] = LIMB_SLOT_XY[slot]
        return <circle key={slot} cx={sx} cy={sy} r={15} className="torso-slot" />
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
            className={`puck ${chest ? 'puck-chest' : 'puck-limb'} ${locked ? 'puck-locked' : ''} ${active ? 'puck-active' : ''}`}
            onPointerDown={startDrag(cable)}
          >
            <circle r={active ? 15 : chest ? 10.5 : 12.5} className="puck-body" />
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
