/**
 * 3D Leads view. The whole point of the ECG made spatial: the heart + its live
 * vector sit in the centre, and the 12 leads float at their true viewing
 * directions around it — limb leads in the frontal ring, precordials in the
 * transverse ring. Each lead is a little EKG panel showing its own complex; as
 * the cardiac vector sweeps, each lead GLOWS by how strongly the vector projects
 * onto it (gold toward the lead = positive deflection, blue away = negative) —
 * which is literally that lead's waveform value at that instant.
 *
 * Hand-rolled 3D (no dependency): rotate world points by yaw/pitch, weak
 * perspective, depth-sort + depth-fade. Drag to rotate. Reuses the engine.
 */
import { useEffect, useRef } from 'react'
import { CardiacClock } from '../hooks/useCardiacClock'
import { ALL_LEADS, LEAD_AXES, LEAD_REGION, LeadId, LIMB_LEADS } from '../engine/leads'
import { Strip } from '../engine/types'
import { SignalSet, sampleVector, samplePhase } from '../engine/synthesize'
import { clamp, Vec3 } from '../engine/vectorMath'
import { PHASE_COLORS } from '../theme'
import './LeadSpace3D.css'

const CAM_D = 4.6
const R_LEAD = 1.4
const VEC_SCALE = 0.92
const POS = '#ffc24b' // vector toward a lead → positive deflection
const NEG = '#5ab0ff' // vector away → negative deflection

interface Projected {
  sx: number
  sy: number
  depth: number
  persp: number
}

const project = (
  p: Vec3, yaw: number, pitch: number, cx: number, cy: number, scale: number,
): Projected => {
  const cyaw = Math.cos(yaw)
  const syaw = Math.sin(yaw)
  const x = p[0] * cyaw + p[2] * syaw
  const z = -p[0] * syaw + p[2] * cyaw
  const y = p[1]
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const y2 = y * cp - z * sp
  const z2 = y * sp + z * cp
  const persp = CAM_D / (CAM_D - z2)
  return { sx: cx + x * scale * persp, sy: cy + y2 * scale * persp, depth: z2, persp }
}

interface Props {
  signals: SignalSet
  strip: Strip
  clock: CardiacClock
}

export default function LeadSpace3D({ signals, strip, clock }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const yawRef = useRef(-0.5)
  const pitchRef = useRef(-0.32)

  // Precompute a downsampled mini-trace (x in 0..1, y in mV) per lead.
  const miniRef = useRef<Record<LeadId, { x: number; y: number }[]>>({} as never)
  useEffect(() => {
    const step = Math.max(1, Math.floor(signals.n / 240))
    const out = {} as Record<LeadId, { x: number; y: number }[]>
    for (const id of ALL_LEADS) {
      const arr = signals.leads[id]
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i < signals.n; i += step) pts.push({ x: i / (signals.n - 1), y: arr[i] })
      out[id] = pts
    }
    miniRef.current = out
  }, [signals])

  const render = (t: number) => {
    const cv = canvasRef.current
    const { w, h, dpr } = sizeRef.current
    if (!cv || w === 0) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const cx = w / 2
    const cy = h / 2
    const scale = Math.min(w, h) * 0.27
    const yaw = yawRef.current
    const pitch = pitchRef.current
    const P = (p: Vec3) => project(p, yaw, pitch, cx, cy, scale)

    const v = sampleVector(strip, t)
    const tone = PHASE_COLORS[samplePhase(strip, t).tone]
    const idx = clamp(Math.round(t / signals.dt), 0, signals.n - 1)

    // --- guide rings (frontal: z=0; transverse: y=0) ---
    const ring = (axis: 'frontal' | 'transverse') => {
      ctx.beginPath()
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2
        const p: Vec3 = axis === 'frontal'
          ? [Math.cos(a) * R_LEAD, Math.sin(a) * R_LEAD, 0]
          : [Math.cos(a) * R_LEAD, 0, Math.sin(a) * R_LEAD]
        const pr = P(p)
        if (i === 0) ctx.moveTo(pr.sx, pr.sy)
        else ctx.lineTo(pr.sx, pr.sy)
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ring('frontal')
    ring('transverse')

    // --- assemble drawables (leads) with depth ---
    const leads = ALL_LEADS.map((id) => {
      const axis = LEAD_AXES[id]
      const pos: Vec3 = [axis[0] * R_LEAD, axis[1] * R_LEAD, axis[2] * R_LEAD]
      const pr = P(pos)
      const val = signals.leads[id][idx]
      return { id, pr, val, isLimb: (LIMB_LEADS as string[]).includes(id) }
    })
    leads.sort((a, b) => a.pr.depth - b.pr.depth)

    const drawHeartAndVector = () => {
      const o = P([0, 0, 0])
      // heart glyph
      ctx.beginPath()
      ctx.arc(o.sx, o.sy, 13 * o.persp, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,120,120,0.12)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,150,150,0.5)'
      ctx.lineWidth = 1.4
      ctx.stroke()
      // vector arrow (3D)
      const tip = P([v[0] * VEC_SCALE, v[1] * VEC_SCALE, v[2] * VEC_SCALE])
      ctx.save()
      ctx.strokeStyle = tone.core
      ctx.fillStyle = tone.core
      ctx.shadowColor = tone.glow
      ctx.shadowBlur = 12
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(o.sx, o.sy)
      ctx.lineTo(tip.sx, tip.sy)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(tip.sx, tip.sy, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    const drawLead = (L: typeof leads[number]) => {
      const { pr, id, val } = L
      const fade = clamp((pr.depth + 1.6) / 3.2, 0.35, 1) // nearer = brighter
      const pw = 66 * pr.persp
      const ph = 40 * pr.persp
      const x0 = pr.sx - pw / 2
      const y0 = pr.sy - ph / 2

      // glow ring ∝ |projection| (= this lead's current deflection)
      const mag = clamp(Math.abs(val) / 1.4, 0, 1)
      const glowColor = val >= 0 ? POS : NEG
      if (mag > 0.04) {
        ctx.save()
        ctx.shadowColor = glowColor
        ctx.shadowBlur = 18 * mag
        ctx.strokeStyle = glowColor
        ctx.globalAlpha = (0.35 + 0.65 * mag) * fade
        ctx.lineWidth = 2
        roundRect(ctx, x0, y0, pw, ph, 7 * pr.persp)
        ctx.stroke()
        ctx.restore()
      }

      // panel
      ctx.globalAlpha = fade
      ctx.fillStyle = 'rgba(10,14,21,0.82)'
      roundRect(ctx, x0, y0, pw, ph, 7 * pr.persp)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1
      roundRect(ctx, x0, y0, pw, ph, 7 * pr.persp)
      ctx.stroke()

      // mini-trace
      const pts = miniRef.current[id]
      if (pts) {
        const padX = 5 * pr.persp
        const traceW = pw - padX * 2
        const midY = y0 + ph * 0.6
        const mvScale = (ph * 0.42) / 1.6
        ctx.beginPath()
        for (let i = 0; i < pts.length; i++) {
          const px = x0 + padX + pts[i].x * traceW
          const py = clamp(midY - pts[i].y * mvScale, y0 + 2, y0 + ph - 2)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.strokeStyle = `rgba(234,242,255,${0.9 * fade})`
        ctx.lineWidth = 1.1
        ctx.lineJoin = 'round'
        ctx.stroke()
        // playhead dot
        const fx = x0 + padX + (t / signals.durationMs) * traceW
        const fy = clamp(midY - val * mvScale, y0 + 2, y0 + ph - 2)
        ctx.beginPath()
        ctx.arc(fx, fy, 2.4 * pr.persp, 0, Math.PI * 2)
        ctx.fillStyle = glowColor
        ctx.fill()
      }

      // label
      ctx.globalAlpha = fade
      ctx.fillStyle = '#cdd8ec'
      ctx.font = `${Math.round(12 * pr.persp)}px -apple-system, system-ui, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(id, x0 + 5 * pr.persp, y0 + 12 * pr.persp)
      ctx.globalAlpha = 1
    }

    // draw back leads → heart/vector → front leads
    let drewCenter = false
    for (const L of leads) {
      if (!drewCenter && L.pr.depth >= 0) { drawHeartAndVector(); drewCenter = true }
      drawLead(L)
    }
    if (!drewCenter) drawHeartAndVector()
  }

  const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
  }

  // size tracking
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      sizeRef.current = { w: rect.width, h: rect.height, dpr }
      const cv = canvasRef.current
      if (cv) {
        cv.width = Math.round(rect.width * dpr)
        cv.height = Math.round(rect.height * dpr)
      }
      render(clock.getTime())
    })
    ro.observe(wrap)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // per-frame
  useEffect(() => clock.subscribe(render), [clock, signals, strip]) // eslint-disable-line react-hooks/exhaustive-deps

  // drag to rotate
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    let dragging = false
    let lastX = 0
    let lastY = 0
    const down = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      cv.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      yawRef.current += (e.clientX - lastX) * 0.01
      pitchRef.current = clamp(pitchRef.current + (e.clientY - lastY) * 0.01, -1.3, 0.5)
      lastX = e.clientX
      lastY = e.clientY
      render(clock.getTime())
    }
    const up = () => { dragging = false }
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    return () => {
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointercancel', up)
    }
  }, [clock])

  // unused import guard (LEAD_REGION reserved for future tooltips)
  void LEAD_REGION

  return (
    <div className="space3d" ref={wrapRef}>
      <canvas ref={canvasRef} className="space3d-canvas" />
      <div className="space3d-hint">drag to rotate · gold = vector toward lead (+), blue = away (−)</div>
    </div>
  )
}
