/**
 * 3D Leads view — the ECG projection made spatial.
 *
 * A prominent heart with its live vector sits in the centre; the 12 leads float
 * at their true viewing directions, each a readable panel showing ONE beat. As
 * the vector sweeps, every lead glows by how strongly the vector projects onto it
 * — gold toward (positive deflection), blue away (negative) — i.e. that lead's
 * own waveform value. Hand-rolled 3D (no deps): rotate, weak perspective,
 * depth-sort + depth-fade. Drag to rotate.
 */
import { useEffect, useRef } from 'react'
import { CardiacClock } from '../hooks/useCardiacClock'
import { ALL_LEADS, LEAD_AXES, LeadId } from '../engine/leads'
import { Strip } from '../engine/types'
import { SignalSet, sampleVector, samplePhase } from '../engine/synthesize'
import { clamp, Vec3 } from '../engine/vectorMath'
import { PHASE_COLORS } from '../theme'
import './LeadSpace3D.css'

const CAM_D = 5.2
const R_LEAD = 1.06
const VEC_SCALE = 0.9
const POS = '#ffc24b' // vector toward a lead → positive deflection
const NEG = '#5ab0ff' // vector away → negative deflection
const PANEL_W = 104
const PANEL_H = 62

interface Projected { sx: number; sy: number; depth: number; persp: number }

const project = (p: Vec3, yaw: number, pitch: number, cx: number, cy: number, scale: number): Projected => {
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
  const pitchRef = useRef(-0.3)

  // One representative beat per lead (x 0..1 across the beat, y in mV) + the beat length.
  const repRef = useRef<Record<LeadId, { x: number; y: number }[]>>({} as never)
  const beatMsRef = useRef(800)
  useEffect(() => {
    const beatMs = strip.beats.length >= 2 ? strip.beats[1].onset - strip.beats[0].onset : strip.durationMs
    beatMsRef.current = beatMs
    const n = Math.max(2, Math.round(beatMs / signals.dt))
    const step = Math.max(1, Math.floor(n / 160))
    const out = {} as Record<LeadId, { x: number; y: number }[]>
    for (const id of ALL_LEADS) {
      const arr = signals.leads[id]
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= n; i += step) pts.push({ x: i / n, y: arr[Math.min(arr.length - 1, i)] })
      out[id] = pts
    }
    repRef.current = out
  }, [signals, strip])

  const heartPath = (ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) => {
    ctx.beginPath()
    ctx.moveTo(cx, cy + 0.55 * s)
    ctx.bezierCurveTo(cx - 0.98 * s, cy - 0.05 * s, cx - 0.52 * s, cy - 0.78 * s, cx, cy - 0.22 * s)
    ctx.bezierCurveTo(cx + 0.52 * s, cy - 0.78 * s, cx + 0.98 * s, cy - 0.05 * s, cx, cy + 0.55 * s)
    ctx.closePath()
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
    const scale = Math.min(w, h) * 0.32
    const yaw = yawRef.current
    const pitch = pitchRef.current
    const P = (p: Vec3) => project(p, yaw, pitch, cx, cy, scale)

    // Everything keyed to the phase within one representative beat.
    const beatMs = beatMsRef.current
    const phase = (((t % beatMs) + beatMs) % beatMs) / beatMs
    const vt = phase * beatMs
    const v = sampleVector(strip, vt)
    const tone = PHASE_COLORS[samplePhase(strip, vt).tone]
    const valOf = (id: LeadId) => {
      const pts = repRef.current[id]
      if (!pts) return 0
      return pts[clamp(Math.round(phase * (pts.length - 1)), 0, pts.length - 1)].y
    }

    // --- guide rings ---
    const ring = (kind: 'frontal' | 'transverse') => {
      ctx.beginPath()
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2
        const p: Vec3 = kind === 'frontal'
          ? [Math.cos(a) * R_LEAD, Math.sin(a) * R_LEAD, 0]
          : [Math.cos(a) * R_LEAD, 0, Math.sin(a) * R_LEAD]
        const pr = P(p)
        if (i === 0) ctx.moveTo(pr.sx, pr.sy)
        else ctx.lineTo(pr.sx, pr.sy)
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ring('frontal')
    ring('transverse')

    const leads = ALL_LEADS.map((id) => {
      const axis = LEAD_AXES[id]
      const pr = P([axis[0] * R_LEAD, axis[1] * R_LEAD, axis[2] * R_LEAD])
      return { id, pr, val: valOf(id) }
    })
    leads.sort((a, b) => a.pr.depth - b.pr.depth)

    const drawHeart = () => {
      const o = P([0, 0, 0])
      const s = 64 * o.persp
      ctx.save()
      const grad = ctx.createRadialGradient(o.sx, o.sy - s * 0.1, s * 0.1, o.sx, o.sy, s * 0.9)
      grad.addColorStop(0, 'rgba(255,120,120,0.5)')
      grad.addColorStop(0.6, 'rgba(220,70,80,0.28)')
      grad.addColorStop(1, 'rgba(150,40,55,0.05)')
      ctx.shadowColor = 'rgba(255,90,100,0.5)'
      ctx.shadowBlur = 26
      heartPath(ctx, o.sx, o.sy, s)
      ctx.fillStyle = grad
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = 'rgba(255,150,160,0.55)'
      ctx.lineWidth = 1.5
      heartPath(ctx, o.sx, o.sy, s)
      ctx.stroke()
      ctx.restore()

      // vector arrow (3D), over the heart
      const tip = P([v[0] * VEC_SCALE, v[1] * VEC_SCALE, v[2] * VEC_SCALE])
      const ang = Math.atan2(tip.sy - o.sy, tip.sx - o.sx)
      const hs = 12
      ctx.save()
      ctx.strokeStyle = tone.core
      ctx.fillStyle = tone.core
      ctx.shadowColor = tone.glow
      ctx.shadowBlur = 14
      ctx.lineWidth = 3.4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(o.sx, o.sy)
      ctx.lineTo(tip.sx, tip.sy)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(tip.sx, tip.sy)
      ctx.lineTo(tip.sx - hs * Math.cos(ang - 0.42), tip.sy - hs * Math.sin(ang - 0.42))
      ctx.lineTo(tip.sx - hs * Math.cos(ang + 0.42), tip.sy - hs * Math.sin(ang + 0.42))
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    const drawLead = (L: { id: LeadId; pr: Projected; val: number }) => {
      const { pr, id, val } = L
      const fade = clamp((pr.depth + 1.5) / 3, 0.42, 1)
      const pw = PANEL_W * pr.persp
      const ph = PANEL_H * pr.persp
      const x0 = pr.sx - pw / 2
      const y0 = pr.sy - ph / 2
      const mag = clamp(Math.abs(val) / 1.4, 0, 1)
      const glowColor = val >= 0 ? POS : NEG
      const r = 9 * pr.persp

      // glow ring ∝ |projection|
      if (mag > 0.03) {
        ctx.save()
        ctx.shadowColor = glowColor
        ctx.shadowBlur = 22 * mag
        ctx.strokeStyle = glowColor
        ctx.globalAlpha = (0.4 + 0.6 * mag) * fade
        ctx.lineWidth = 2
        roundRect(ctx, x0, y0, pw, ph, r)
        ctx.stroke()
        ctx.restore()
      }

      // panel
      ctx.globalAlpha = fade
      ctx.fillStyle = 'rgba(11,15,23,0.9)'
      roundRect(ctx, x0, y0, pw, ph, r)
      ctx.fill()
      ctx.strokeStyle = `rgba(255,255,255,${0.14 * fade})`
      ctx.lineWidth = 1
      roundRect(ctx, x0, y0, pw, ph, r)
      ctx.stroke()

      // one-beat trace
      const pts = repRef.current[id]
      if (pts) {
        const padX = 7 * pr.persp
        const traceW = pw - padX * 2
        const baseY = y0 + ph * 0.64
        const mvScale = (ph * 0.4) / 1.5
        ctx.beginPath()
        for (let i = 0; i < pts.length; i++) {
          const px = x0 + padX + pts[i].x * traceW
          const py = clamp(baseY - pts[i].y * mvScale, y0 + 3, y0 + ph - 3)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.strokeStyle = `rgba(234,242,255,${0.92 * fade})`
        ctx.lineWidth = 1.5 * pr.persp
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()
        // playhead dot
        const fx = x0 + padX + phase * traceW
        const fy = clamp(baseY - val * mvScale, y0 + 3, y0 + ph - 3)
        ctx.beginPath()
        ctx.arc(fx, fy, 2.6 * pr.persp, 0, Math.PI * 2)
        ctx.fillStyle = glowColor
        ctx.fill()
      }

      // label
      ctx.globalAlpha = fade
      ctx.fillStyle = '#dbe7ff'
      ctx.font = `700 ${Math.round(13 * pr.persp)}px -apple-system, system-ui, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(id, x0 + 7 * pr.persp, y0 + 5 * pr.persp)
      ctx.globalAlpha = 1
    }

    let drewCenter = false
    for (const L of leads) {
      if (!drewCenter && L.pr.depth >= 0) { drawHeart(); drewCenter = true }
      drawLead(L)
    }
    if (!drewCenter) drawHeart()
  }

  // size
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

  useEffect(() => clock.subscribe(render), [clock, signals, strip]) // eslint-disable-line react-hooks/exhaustive-deps

  // drag to rotate
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    let dragging = false
    let lastX = 0
    let lastY = 0
    const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; cv.setPointerCapture(e.pointerId) }
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

  return (
    <div className="space3d" ref={wrapRef}>
      <canvas ref={canvasRef} className="space3d-canvas" />
      <div className="space3d-hint">drag to rotate · gold = vector toward lead (+) · blue = away (−)</div>
    </div>
  )
}
