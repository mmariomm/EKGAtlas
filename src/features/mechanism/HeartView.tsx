/**
 * The schematic heart (v1 port). Depolarization renders as a real wavefront in
 * sequence: wires (amber) → Purkinje seed flashes → each wall sweeps outward,
 * while the cardiac vector arrow points where the net dipole points, trailing
 * a fading vectorcardiogram loop. All animation is imperative via the shared
 * clock. `warp` maps the clock's (real-trace) time into model time, so the
 * mechanism bends to a real recording — never the reverse. Horizontal drag on
 * the figure scrubs the same clock (bidirectional scrub).
 */
import { useEffect, useRef } from 'react'
import { PhaseTone, Strip, StructureId } from '../../engine/sources'
import { beatAt, sampleActivation, samplePhase, sampleVector } from '../../engine/synthesize'
import { clamp, frontalAngleDeg, frontalMagnitude, smoothstep } from '../../engine/vec'
import { CardiacClock } from '../../lib/clock'
import { PHASE_COLORS, STRUCTURE } from '../../theme'
import './HeartView.css'

const W = 340
const H = 384
const OX = 170
const OY = 206
const ARROW_SCALE = 58
const ARROW_MAX = 122
const TRAIL_N = 64
const BAND_BEHIND = 0.18

const LINE_IDS: StructureId[] = ['SA', 'AV', 'HIS', 'RBB', 'LBB', 'LAF', 'LPF']
const GOLD = PHASE_COLORS.ventricle.core

type ShapeDef =
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number; rx: number }

interface ChamberDef {
  id: StructureId
  clip: string
  axis: [number, number, number, number]
  shape: ShapeDef
}

const CHAMBERS: ChamberDef[] = [
  { id: 'RA', clip: 'hd-clip-atria', axis: [82, 58, 158, 116], shape: { type: 'ellipse', cx: 98, cy: 84, rx: 60, ry: 40 } },
  { id: 'LA', clip: 'hd-clip-atria', axis: [180, 80, 300, 88], shape: { type: 'ellipse', cx: 242, cy: 84, rx: 60, ry: 40 } },
  { id: 'SEPTUM', clip: 'hd-clip-vent', axis: [170, 150, 170, 336], shape: { type: 'rect', x: 160, y: 152, w: 20, h: 186, rx: 9 } },
  { id: 'RV', clip: 'hd-clip-vent', axis: [168, 238, 56, 252], shape: { type: 'ellipse', cx: 112, cy: 246, rx: 58, ry: 84 } },
  { id: 'LV', clip: 'hd-clip-vent', axis: [172, 238, 292, 252], shape: { type: 'ellipse', cx: 228, cy: 246, rx: 60, ry: 86 } },
]

const SEEDS: { x: number; y: number; vent: StructureId }[] = [
  { x: 122, y: 272, vent: 'RV' },
  { x: 150, y: 316, vent: 'RV' },
  { x: 192, y: 224, vent: 'LV' },
  { x: 248, y: 240, vent: 'LV' },
  { x: 214, y: 298, vent: 'LV' },
  { x: 190, y: 316, vent: 'LV' },
]

const ATRIA = { x: 30, y: 28, w: 280, h: 100, rx: 28 }
const VENT_PATH =
  'M 52 150 L 288 150 Q 298 150 295 172 L 210 316 Q 190 344 170 342 Q 150 344 130 316 L 45 172 Q 42 150 52 150 Z'

interface Props {
  strip: Strip
  clock: CardiacClock
  /** clock (real) time → model time; identity when the strip runs on its own. */
  warp?: (tMs: number) => number
  blockedBranches?: StructureId[]
}

export default function HeartView({ strip, clock, warp, blockedBranches }: Props) {
  const chamberG = useRef<Record<string, SVGGElement | null>>({})
  const chamberStops = useRef<Record<string, (SVGStopElement | null)[]>>({})
  const lineG = useRef<Partial<Record<StructureId, SVGGElement | null>>>({})
  const seedRefs = useRef<(SVGCircleElement | null)[]>([])
  const lastTone = useRef<Record<string, PhaseTone>>({})

  const arrowGroup = useRef<SVGGElement | null>(null)
  const arrowGlowGroup = useRef<SVGGElement | null>(null)
  const arrowShaft = useRef<SVGPathElement | null>(null)
  const arrowHead = useRef<SVGPolygonElement | null>(null)
  const arrowShaftGlow = useRef<SVGPathElement | null>(null)
  const arrowHeadGlow = useRef<SVGPolygonElement | null>(null)
  const trailRef = useRef<SVGPolylineElement | null>(null)
  const trailBuf = useRef<string[]>([])
  const axisText = useRef<SVGTextElement | null>(null)

  const focusGroup = useRef<SVGGElement | null>(null)
  const focusRing = useRef<SVGCircleElement | null>(null)
  const focusLabel = useRef<SVGTextElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const blocked = blockedBranches ?? []

  useEffect(() => {
    lastTone.current = {}
    const w = warp ?? ((t: number) => t)

    const tipAt = (tt: number) => {
      const vv = sampleVector(strip, tt)
      const a = Math.atan2(vv[1], vv[0])
      const l = Math.min(frontalMagnitude(vv) * ARROW_SCALE, ARROW_MAX)
      return `${(OX + Math.cos(a) * l).toFixed(1)},${(OY + Math.sin(a) * l).toFixed(1)}`
    }
    const STEP = 7
    const t0 = w(clock.getTime())
    const seed: string[] = []
    for (let k = TRAIL_N - 1; k >= 0; k--) {
      const tk = (((t0 - k * STEP) % strip.durationMs) + strip.durationMs) % strip.durationMs
      seed.push(tipAt(tk))
    }
    trailBuf.current = seed
    if (trailRef.current) trailRef.current.setAttribute('points', seed.join(' '))

    const onFrame = (realT: number) => {
      const t = w(realT)
      const act = sampleActivation(strip, t)

      for (const ch of CHAMBERS) {
        const g = chamberG.current[ch.id]
        const stops = chamberStops.current[ch.id]
        if (!g || !stops) continue
        const a = act.get(ch.id)
        g.style.opacity = (a ? a.level : 0).toFixed(3)
        const p = a ? a.progress : 0
        stops[1]?.setAttribute('offset', Math.max(0, p - BAND_BEHIND).toFixed(3))
        stops[2]?.setAttribute('offset', p.toFixed(3))
        stops[3]?.setAttribute('offset', Math.min(1, p + 0.05).toFixed(3))
        if (a && lastTone.current[ch.id] !== a.kind) {
          lastTone.current[ch.id] = a.kind
          const col = PHASE_COLORS[a.kind].core
          stops[0]?.setAttribute('stop-color', col)
          stops[1]?.setAttribute('stop-color', col)
          stops[2]?.setAttribute('stop-color', col)
        }
      }

      for (let i = 0; i < SEEDS.length; i++) {
        const el = seedRefs.current[i]
        if (!el) continue
        const a = act.get(SEEDS[i].vent)
        const op = a && a.kind === 'ventricle' ? a.level * (1 - smoothstep(0, 0.34, a.progress)) : 0
        el.style.opacity = op.toFixed(3)
      }

      for (const id of LINE_IDS) {
        const g = lineG.current[id]
        if (!g) continue
        const a = act.get(id)
        g.style.opacity = (a ? a.level : 0).toFixed(3)
        if (a && lastTone.current[id] !== a.kind) {
          lastTone.current[id] = a.kind
          g.style.color = PHASE_COLORS[a.kind].core
        }
      }

      const v = sampleVector(strip, t)
      const fm = frontalMagnitude(v)
      const ph = samplePhase(strip, t)
      const ang = Math.atan2(v[1], v[0])
      const len = Math.min(fm * ARROW_SCALE, ARROW_MAX)
      const ex = OX + Math.cos(ang) * len
      const ey = OY + Math.sin(ang) * len
      if (arrowGroup.current && arrowShaft.current && arrowHead.current) {
        const hs = 13
        const lx = ex - hs * Math.cos(ang - Math.PI / 7)
        const ly = ey - hs * Math.sin(ang - Math.PI / 7)
        const rx = ex - hs * Math.cos(ang + Math.PI / 7)
        const ry = ey - hs * Math.sin(ang + Math.PI / 7)
        const d = `M ${OX} ${OY} L ${ex.toFixed(1)} ${ey.toFixed(1)}`
        const pts = `${ex.toFixed(1)},${ey.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)} ${rx.toFixed(1)},${ry.toFixed(1)}`
        arrowShaft.current.setAttribute('d', d)
        arrowHead.current.setAttribute('points', pts)
        arrowShaftGlow.current?.setAttribute('d', d)
        arrowHeadGlow.current?.setAttribute('points', pts)
        if (arrowGlowGroup.current) arrowGlowGroup.current.style.color = PHASE_COLORS[ph.tone].core
        arrowGroup.current.style.opacity = smoothstep(0.03, 0.16, fm).toFixed(3)
      }
      const buf = trailBuf.current
      buf.push(`${ex.toFixed(1)},${ey.toFixed(1)}`)
      if (buf.length > TRAIL_N) buf.splice(0, buf.length - TRAIL_N)
      if (trailRef.current) trailRef.current.setAttribute('points', buf.join(' '))

      if (axisText.current) {
        axisText.current.textContent = fm > 0.08 ? `${Math.round(frontalAngleDeg(v))}°` : '—'
      }

      const beat = beatAt(strip, t)
      if (focusGroup.current && focusRing.current && focusLabel.current) {
        if (beat.focus) {
          const level = act.get('FOCUS')?.level ?? 0
          focusGroup.current.setAttribute('transform', `translate(${beat.focus.x * W} ${beat.focus.y * H})`)
          focusGroup.current.style.opacity = clamp(level * 1.2, 0, 1).toFixed(3)
          focusRing.current.setAttribute('r', String(8 + (1 - level) * 26))
          focusRing.current.style.opacity = (level * 0.7).toFixed(3)
          focusLabel.current.textContent = beat.focus.label
        } else {
          focusGroup.current.style.opacity = '0'
        }
      }
    }
    return clock.subscribe(onFrame)
  }, [clock, strip, warp])

  // Horizontal drag on the heart scrubs the shared clock (trace ↔ heart).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let lastX: number | null = null
    const down = (e: PointerEvent) => { lastX = e.clientX; el.setPointerCapture(e.pointerId) }
    const move = (e: PointerEvent) => {
      if (lastX == null) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      if (dx !== 0) clock.scrubBy(dx / (el.clientWidth * 1.6))
    }
    const up = () => { lastX = null }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [clock])

  const branchStyle = (id: StructureId) =>
    blocked.includes(id)
      ? { stroke: STRUCTURE.blocked, strokeDasharray: '3 5' }
      : { stroke: STRUCTURE.stroke }

  const regLine = (id: StructureId) => (el: SVGGElement | null) => { lineG.current[id] = el }
  const regStop = (id: string, i: number) => (el: SVGStopElement | null) => {
    ;(chamberStops.current[id] ??= [])[i] = el
  }

  return (
    <div className="heart" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Schematic heart showing the conduction wavefront and cardiac vector">
        <defs>
          {/* Explicit userSpaceOnUse region: with percentage units, a group whose
              children are all at opacity 0 degenerates the filter region and
              Chromium paints a black square artifact. */}
          <filter id="hd-glow" filterUnits="userSpaceOnUse" x={-30} y={-30} width={W + 60} height={H + 60}>
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="hd-clip-atria">
            <rect x={ATRIA.x} y={ATRIA.y} width={ATRIA.w} height={ATRIA.h} rx={ATRIA.rx} />
          </clipPath>
          <clipPath id="hd-clip-vent">
            <path d={VENT_PATH} />
          </clipPath>
          {CHAMBERS.map((ch) => (
            <linearGradient
              key={ch.id}
              id={`hd-wave-${ch.id}`}
              gradientUnits="userSpaceOnUse"
              x1={ch.axis[0]} y1={ch.axis[1]} x2={ch.axis[2]} y2={ch.axis[3]}
            >
              <stop ref={regStop(ch.id, 0)} offset="0" stopColor={GOLD} stopOpacity="0.32" />
              <stop ref={regStop(ch.id, 1)} offset="0" stopColor={GOLD} stopOpacity="0.4" />
              <stop ref={regStop(ch.id, 2)} offset="0" stopColor={GOLD} stopOpacity="0.82" />
              <stop ref={regStop(ch.id, 3)} offset="0.05" stopColor={GOLD} stopOpacity="0" />
              <stop ref={regStop(ch.id, 4)} offset="1" stopColor={GOLD} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        <g className="hd-chambers">
          {CHAMBERS.map((ch) => (
            <g key={ch.id} ref={(el) => { chamberG.current[ch.id] = el }} className="hd-chamber" clipPath={`url(#${ch.clip})`} style={{ opacity: 0 }}>
              {ch.shape.type === 'ellipse' ? (
                <ellipse cx={ch.shape.cx} cy={ch.shape.cy} rx={ch.shape.rx} ry={ch.shape.ry} fill={`url(#hd-wave-${ch.id})`} />
              ) : (
                <rect x={ch.shape.x} y={ch.shape.y} width={ch.shape.w} height={ch.shape.h} rx={ch.shape.rx} fill={`url(#hd-wave-${ch.id})`} />
              )}
            </g>
          ))}
        </g>

        <g className="hd-base">
          <rect x={ATRIA.x} y={ATRIA.y} width={ATRIA.w} height={ATRIA.h} rx={ATRIA.rx} fill={STRUCTURE.chamberFill} stroke={STRUCTURE.stroke} strokeWidth={1.4} />
          <line x1={170} y1={44} x2={170} y2={120} stroke={STRUCTURE.stroke} strokeWidth={1.2} />
          <path d={VENT_PATH} fill={STRUCTURE.chamberFill} stroke={STRUCTURE.stroke} strokeWidth={1.4} />
          <line x1={170} y1={150} x2={170} y2={338} stroke={STRUCTURE.stroke} strokeWidth={1.4} />

          <path d="M86 58 Q128 112 170 130" fill="none" stroke={STRUCTURE.stroke} strokeWidth={1.2} strokeDasharray="2 4" />
          <path d="M170 138 L170 182" fill="none" stroke={STRUCTURE.strokeStrong} strokeWidth={2.2} />
          <path d="M170 182 C 160 232 150 272 126 300" fill="none" strokeWidth={2.2} {...branchStyle('RBB')} />
          <path d="M170 182 L196 210" fill="none" strokeWidth={2.2} {...branchStyle('LBB')} />
          <path d="M196 210 L244 236" fill="none" strokeWidth={2} {...branchStyle('LAF')} />
          <path d="M196 210 L206 300" fill="none" strokeWidth={2} {...branchStyle('LPF')} />

          {[[126, 300, -20], [244, 236, 18], [206, 300, 6]].map(([x, y, rot], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`} stroke={STRUCTURE.stroke} strokeWidth={1.1}>
              <line x1={0} y1={0} x2={-10} y2={12} />
              <line x1={0} y1={0} x2={0} y2={15} />
              <line x1={0} y1={0} x2={10} y2={12} />
            </g>
          ))}

          <circle cx={86} cy={58} r={6} fill="#0b1018" stroke={STRUCTURE.strokeStrong} strokeWidth={1.6} />
          <circle cx={170} cy={134} r={7} fill="#0b1018" stroke={STRUCTURE.strokeStrong} strokeWidth={1.6} />

          <g className="hd-label" fill={STRUCTURE.label}>
            <text x={86} y={40} textAnchor="middle">SA</text>
            <text x={192} y={132} textAnchor="start">AV</text>
            <text x={96} y={92} textAnchor="middle">RA</text>
            <text x={244} y={92} textAnchor="middle">LA</text>
            <text x={104} y={250} textAnchor="middle">RV</text>
            <text x={236} y={250} textAnchor="middle">LV</text>
          </g>
        </g>

        <g className="hd-glowlayer" filter="url(#hd-glow)">
          <g ref={regLine('SA')} className="hd-glow"><circle cx={86} cy={58} r={9} fill="currentColor" /></g>
          <g ref={regLine('AV')} className="hd-glow"><circle cx={170} cy={134} r={10} fill="currentColor" /></g>
          <g ref={regLine('HIS')} className="hd-glow"><path d="M170 138 L170 182" stroke="currentColor" strokeWidth={6} strokeLinecap="round" fill="none" /></g>
          <g ref={regLine('RBB')} className="hd-glow"><path d="M170 182 C 160 232 150 272 126 300" stroke="currentColor" strokeWidth={5} strokeLinecap="round" fill="none" /></g>
          <g ref={regLine('LBB')} className="hd-glow"><path d="M170 182 L196 210" stroke="currentColor" strokeWidth={5} strokeLinecap="round" fill="none" /></g>
          <g ref={regLine('LAF')} className="hd-glow"><path d="M196 210 L244 236" stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" fill="none" /></g>
          <g ref={regLine('LPF')} className="hd-glow"><path d="M196 210 L206 300" stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" fill="none" /></g>
        </g>

        <g className="hd-seeds" filter="url(#hd-glow)">
          {SEEDS.map((s, i) => (
            <circle key={i} ref={(el) => { seedRefs.current[i] = el }} cx={s.x} cy={s.y} r={3.4} fill={GOLD} style={{ opacity: 0 }} />
          ))}
        </g>

        <g ref={focusGroup} className="hd-focus" style={{ opacity: 0 }}>
          <circle ref={focusRing} r={10} fill="none" stroke="#ff7a59" strokeWidth={2} />
          <circle r={6} fill="#ff7a59" />
          <text ref={focusLabel} x={0} y={-16} textAnchor="middle" className="hd-focus-label" />
        </g>

        <polyline ref={trailRef} className="hd-trail" filter="url(#hd-glow)" points="" />

        <g ref={arrowGroup} className="hd-arrow" style={{ opacity: 0 }}>
          <g ref={arrowGlowGroup} filter="url(#hd-glow)">
            <path ref={arrowShaftGlow} d={`M ${OX} ${OY} L ${OX} ${OY}`} stroke="currentColor" strokeWidth={6} strokeLinecap="round" fill="none" />
            <polygon ref={arrowHeadGlow} points="" fill="currentColor" />
          </g>
          <circle cx={OX} cy={OY} r={3.2} fill="#eef4ff" />
          <path ref={arrowShaft} d={`M ${OX} ${OY} L ${OX} ${OY}`} stroke="#eef4ff" strokeWidth={2.6} strokeLinecap="round" fill="none" />
          <polygon ref={arrowHead} points="" fill="#eef4ff" />
        </g>

        <text ref={axisText} x={W - 14} y={H - 14} textAnchor="end" className="hd-axis num">—</text>
        <text x={W - 14} y={H - 28} textAnchor="end" className="hd-axis-cap">VECTOR</text>
      </svg>
    </div>
  )
}
