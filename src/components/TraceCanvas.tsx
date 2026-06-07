/**
 * The waveform. All selected leads are stacked as synchronized lanes on one
 * canvas, sharing a single traveling playhead. The static picture (calibrated
 * grid + ink traces + labels) is rendered once to an offscreen canvas; each
 * frame only blits that image and paints the moving playhead + a phase-colored
 * comet — so animation stays cheap even with all 12 leads.
 *
 * Calibration is honest by GRID BOX, not by pixel: one major box = 0.20 s × 0.5 mV,
 * which holds at any screen size or pixel density.
 */
import { useEffect, useRef } from 'react'
import { CardiacClock } from '../hooks/useCardiacClock'
import { LeadId } from '../engine/leads'
import { Strip } from '../engine/types'
import { SignalSet, samplePhase } from '../engine/synthesize'
import { clamp } from '../engine/vectorMath'
import { GRID, PHASE_COLORS, TRACE_INK } from '../theme'
import './TraceCanvas.css'

const MV_HALF = 1.9 // mV mapped to half a lane height
const PAD_Y = 12
const TRAIL_MS = 110
const MAJOR_S = 0.2 // seconds per major grid box
const MAJOR_MV = 0.5

interface LaneLayout {
  laneH: number
  pxPerMV: number
}

const laneLayoutFor = (count: number): LaneLayout => {
  const laneH = count <= 1 ? 168 : count === 2 ? 132 : count <= 6 ? 110 : 92
  const pxPerMV = (laneH / 2 - PAD_Y) / MV_HALF
  return { laneH, pxPerMV }
}

interface Props {
  signals: SignalSet
  strip: Strip
  clock: CardiacClock
  leads: LeadId[]
}

export default function TraceCanvas({ signals, strip, clock, leads }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const staticRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const layoutRef = useRef<LaneLayout>(laneLayoutFor(leads.length))

  // Redraw the static layer whenever inputs or size change.
  const drawStatic = () => {
    if (!staticRef.current) staticRef.current = document.createElement('canvas')
    const sc = staticRef.current
    const { w, h, dpr } = sizeRef.current
    if (w === 0) return
    sc.width = Math.round(w * dpr)
    sc.height = Math.round(h * dpr)
    const ctx = sc.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const { laneH, pxPerMV } = layoutRef.current
    const durSec = signals.durationMs / 1000
    const minorPxX = (0.04 / durSec) * w
    const majorPxX = (MAJOR_S / durSec) * w

    // ---- grid ----
    ctx.lineWidth = 1
    // vertical (time) lines, full height
    for (let x = 0, i = 0; x <= w + 0.5; x += minorPxX, i++) {
      ctx.strokeStyle = i % 5 === 0 ? GRID.major : GRID.minor
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, 0)
      ctx.lineTo(Math.round(x) + 0.5, h)
      ctx.stroke()
    }
    // horizontal (voltage) lines, per lane around its baseline
    const minorPxY = 0.1 * pxPerMV
    leads.forEach((_, li) => {
      const base = li * laneH + laneH / 2
      for (let k = -Math.floor(laneH / 2 / minorPxY); k <= Math.floor(laneH / 2 / minorPxY); k++) {
        const y = base + k * minorPxY
        if (y < li * laneH || y > (li + 1) * laneH) continue
        ctx.strokeStyle = k % 5 === 0 ? GRID.major : GRID.minor
        ctx.beginPath()
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(w, Math.round(y) + 0.5)
        ctx.stroke()
      }
    })

    // lane separators + baselines
    leads.forEach((_, li) => {
      const top = li * laneH
      const base = top + laneH / 2
      ctx.strokeStyle = GRID.baseline
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, Math.round(base) + 0.5)
      ctx.lineTo(w, Math.round(base) + 0.5)
      ctx.stroke()
      if (li > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        ctx.beginPath()
        ctx.moveTo(0, Math.round(top) + 0.5)
        ctx.lineTo(w, Math.round(top) + 0.5)
        ctx.stroke()
      }
    })

    // ---- traces ----
    const n = signals.n
    leads.forEach((id, li) => {
      const arr = signals.leads[id]
      if (!arr) return
      const base = li * laneH + laneH / 2
      const top = li * laneH
      const bottom = top + laneH
      ctx.strokeStyle = TRACE_INK
      ctx.lineWidth = 1.7
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w
        const y = clamp(base - arr[i] * pxPerMV, top + 1, bottom - 1)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      // lead label chip
      ctx.fillStyle = 'rgba(13,17,25,0.7)'
      ctx.fillRect(8, top + 8, 34, 18)
      ctx.fillStyle = '#cdd8ec'
      ctx.font = '600 12px -apple-system, system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(id, 14, top + 17)
    })

    // ---- beat labels on the top lane ----
    ctx.fillStyle = 'rgba(190,204,226,0.85)'
    ctx.font = '700 11px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const beat of strip.beats) {
      if (!beat.label) continue
      const x = (beat.onset / signals.durationMs) * w
      ctx.fillText(beat.label, clamp(x + 14, 18, w - 18), 6)
    }

    // calibration caption
    ctx.fillStyle = 'rgba(107,118,137,0.85)'
    ctx.font = '600 10px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText('1 box = 0.20 s · 0.5 mV', w - 8, h - 6)
  }

  const drawFrame = (t: number) => {
    const cv = canvasRef.current
    const sc = staticRef.current
    const { w, h, dpr } = sizeRef.current
    if (!cv || !sc || w === 0) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(sc, 0, 0, w, h)

    const { laneH, pxPerMV } = layoutRef.current
    const x = (t / signals.durationMs) * w
    const tone = PHASE_COLORS[samplePhase(strip, t).tone]
    const n = signals.n
    const dt = signals.dt

    // playhead
    ctx.strokeStyle = 'rgba(234,242,255,0.28)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()

    const sampleIdx = (tm: number) => clamp(Math.round(tm / dt), 0, n - 1)

    leads.forEach((id, li) => {
      const arr = signals.leads[id]
      if (!arr) return
      const top = li * laneH
      const bottom = top + laneH
      const base = top + laneH / 2
      const yAt = (tm: number) => clamp(base - arr[sampleIdx(tm)] * pxPerMV, top + 1, bottom - 1)

      // comet trail behind the playhead, in the phase color
      ctx.save()
      ctx.strokeStyle = tone.core
      ctx.shadowColor = tone.glow
      ctx.shadowBlur = 9
      ctx.lineWidth = 2.4
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      const startTm = Math.max(0, t - TRAIL_MS)
      let first = true
      for (let tm = startTm; tm <= t; tm += dt) {
        const px = (tm / signals.durationMs) * w
        const py = yAt(tm)
        if (first) { ctx.moveTo(px, py); first = false } else ctx.lineTo(px, py)
      }
      ctx.stroke()

      // bright head dot
      ctx.beginPath()
      ctx.fillStyle = tone.core
      ctx.arc(x, yAt(t), 2.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    })
  }

  // size tracking
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const { laneH } = layoutRef.current
      const h = laneH * leads.length
      sizeRef.current = { w: rect.width, h, dpr }
      const cv = canvasRef.current
      if (cv) {
        cv.width = Math.round(rect.width * dpr)
        cv.height = Math.round(h * dpr)
        cv.style.height = `${h}px`
      }
      drawStatic()
      drawFrame(clock.getTime())
    })
    ro.observe(wrap)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, signals])

  // rebuild static + lane layout when leads/signals change
  useEffect(() => {
    layoutRef.current = laneLayoutFor(leads.length)
    const { w, dpr } = sizeRef.current
    const h = layoutRef.current.laneH * leads.length
    sizeRef.current = { w, h, dpr }
    const cv = canvasRef.current
    if (cv && w > 0) {
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      cv.style.height = `${h}px`
    }
    drawStatic()
    drawFrame(clock.getTime())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, signals])

  // per-frame overlay
  useEffect(() => {
    return clock.subscribe(drawFrame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, signals, strip, leads])

  // drag-to-scrub
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    let dragging = false
    let resume = false
    const toFraction = (clientX: number) => {
      const rect = cv.getBoundingClientRect()
      return clamp((clientX - rect.left) / rect.width, 0, 1)
    }
    const down = (e: PointerEvent) => {
      dragging = true
      resume = clock.isPlaying
      clock.pause()
      cv.setPointerCapture(e.pointerId)
      clock.seekFraction(toFraction(e.clientX))
    }
    const move = (e: PointerEvent) => {
      if (dragging) clock.seekFraction(toFraction(e.clientX))
    }
    const up = () => {
      if (!dragging) return
      dragging = false
      if (resume) clock.play()
    }
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

  const tall = leads.length > 6
  return (
    <div className={`trace-wrap${tall ? ' trace-scroll' : ''}`} ref={wrapRef}>
      <canvas ref={canvasRef} className="trace-canvas" />
    </div>
  )
}
