/**
 * The waveform surface. Monitor-style: the strip scrolls under a fixed
 * playhead; drag scrubs (through the shared clock), pinch zooms 25↔50 mm/s,
 * tap toggles play. Calibration is honest BY GRID BOX — one minor box is
 * always 1 mm = 0.04 s × 0.1 mV at 25 mm/s — which holds at any size or
 * pixel density. The full strip is prerendered once per (data, zoom, lanes,
 * theme) to an offscreen canvas within an area budget; each frame only blits
 * a slice and paints the playhead + phase comet.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { LeadId } from '../../engine/leads'
import { PhaseTone } from '../../engine/sources'
import { CardiacClock } from '../../lib/clock'
import { TraceData } from '../../lib/assets'
import { metric } from '../../lib/metrics'
import './TraceView.css'

export interface TraceHighlight {
  t0: number
  t1: number
  tone: PhaseTone
}

interface Props {
  data: TraceData
  leads: LeadId[]
  clock: CardiacClock
  /** Phase tone at a strip time (drives the comet color); null = plain ink. */
  toneAt?: (tMs: number) => PhaseTone | null
  highlight?: TraceHighlight | null
  /** Rendered top-right over the trace (the provenance badge slot). */
  badge?: React.ReactNode
  onTap?: () => void
  /** Lane height in CSS px (default derives from lane count). */
  laneHeight?: number
}

const MM_PER_SEC = 25
const MM_PER_MV = 10
const WINDOW_SEC = 4 // visible seconds at zoom 1
const PLAYHEAD_X = 0.38
const TRAIL_MS = 130
const AREA_BUDGET = 12_000_000 // device px² for the static canvas

const laneHeightFor = (count: number) => (count <= 1 ? 190 : count <= 3 ? 120 : 76)

interface Theme {
  bg: string
  ink: string
  gridMinor: string
  gridMajor: string
  label: string
  phase: Record<PhaseTone, string>
}

const readTheme = (el: HTMLElement, paper: boolean): Theme => {
  const s = getComputedStyle(el)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return paper
    ? {
        bg: v('--paper-bg'), ink: v('--paper-ink'),
        gridMinor: v('--paper-grid-minor'), gridMajor: v('--paper-grid-major'),
        label: '#8a6a5b',
        phase: phasePalette(v),
      }
    : {
        bg: v('--surface'), ink: v('--trace-ink'),
        gridMinor: v('--grid-minor'), gridMajor: v('--grid-major'),
        label: v('--ink-3'),
        phase: phasePalette(v),
      }
}

const phasePalette = (v: (n: string) => string): Record<PhaseTone, string> => ({
  sa: v('--ph-sa'), atria: v('--ph-atria'), av: v('--ph-av'),
  ventricle: v('--ph-vent'), repol: v('--ph-repol'), injury: v('--ph-injury'),
  rest: v('--ink-2'),
})

export default function TraceView({
  data, leads, clock, toneAt, highlight, badge, onTap, laneHeight,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const staticRef = useRef<HTMLCanvasElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [paper, setPaper] = useState(() => {
    try { return localStorage.getItem('trace-paper') === '1' } catch { return false }
  })
  const [size, setSize] = useState({ w: 0, h: 0 })

  const laneH = laneHeight ?? laneHeightFor(leads.length)
  const height = laneH * leads.length

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [height])

  // Geometry (CSS px). pxPerMm derives from the visible window; everything
  // else derives from pxPerMm so the boxes are exact.
  const geo = useMemo(() => {
    const w = size.w || 360
    const pxPerMm = w / ((WINDOW_SEC / zoom) * MM_PER_SEC)
    const pxPerMs = (pxPerMm * MM_PER_SEC) / 1000
    const stripW = data.durationMs * pxPerMs
    return { w, pxPerMm, pxPerMs, stripW }
  }, [size.w, zoom, data.durationMs])

  // ---- static layer: full strip (grid + ink + labels + calibration pulse)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !size.w) return
    const theme = readTheme(wrap, paper)
    const { pxPerMm, pxPerMs, stripW } = geo

    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    while (stripW * dpr * height * dpr > AREA_BUDGET && dpr > 0.75) dpr *= 0.85

    const sc = (staticRef.current ??= document.createElement('canvas'))
    sc.width = Math.ceil(stripW * dpr)
    sc.height = Math.ceil(height * dpr)
    const ctx = sc.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, stripW, height)

    // grid: continuous minor/major boxes across the whole strip
    const minor = pxPerMm
    const major = pxPerMm * 5
    ctx.lineWidth = 1 / dpr < 0.5 ? 0.5 : 1
    for (const [step, color] of [[minor, theme.gridMinor], [major, theme.gridMajor]] as const) {
      ctx.strokeStyle = color
      ctx.beginPath()
      for (let x = 0; x <= stripW; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, height) }
      for (let y = 0; y <= height; y += step) { ctx.moveTo(0, y); ctx.lineTo(stripW, y) }
      ctx.stroke()
    }

    const mvPx = MM_PER_MV * pxPerMm
    ctx.strokeStyle = theme.ink
    leads.forEach((lead, li) => {
      const y0 = li * laneH + laneH / 2
      const samples = data.leads[lead]
      if (!samples) return
      ctx.lineWidth = 1.4
      ctx.beginPath()
      const n = samples.length
      const msPerSample = data.durationMs / n
      const stride = Math.max(1, Math.floor(1 / (msPerSample * pxPerMs * dpr) / 1.5))
      for (let i = 0; i < n; i += stride) {
        const x = i * msPerSample * pxPerMs
        const y = y0 - samples[i] * mvPx
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    })
  }, [data, leads, geo, height, laneH, paper, size.w])

  // ---- per-frame: blit slice + playhead + comet + highlight
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !size.w) return
    const theme = readTheme(wrap, paper)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.ceil(size.w * dpr)
    canvas.height = Math.ceil(height * dpr)
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')!

    const draw = (tMs: number) => {
      const sc = staticRef.current
      if (!sc) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = theme.bg
      ctx.fillRect(0, 0, size.w, height)

      const { pxPerMs, stripW } = geo
      const headX = size.w * PLAYHEAD_X
      const scScale = sc.width / stripW // static-canvas device px per CSS px
      let offset = tMs * pxPerMs - headX // CSS px of strip at canvas x=0
      offset = ((offset % stripW) + stripW) % stripW

      // draw up to two slices to cover the wrap-around seam
      let x = 0
      let src = offset
      while (x < size.w) {
        const avail = stripW - src
        const w = Math.min(size.w - x, avail)
        ctx.drawImage(sc, src * scScale, 0, w * scScale, sc.height, x, 0, w, height)
        x += w
        src = 0
      }

      // highlight band (WHY section)
      if (highlight) {
        const hx0 = ((highlight.t0 * pxPerMs - offset + stripW) % stripW)
        const hw = (highlight.t1 - highlight.t0) * pxPerMs
        ctx.fillStyle = theme.phase[highlight.tone] + '22'
        ctx.fillRect(hx0, 0, hw, height)
      }

      // comet: recent TRAIL_MS re-inked in the phase color
      const tone = toneAt?.(tMs) ?? null
      const color = tone ? theme.phase[tone] : theme.ink
      const mvPx = MM_PER_MV * geo.pxPerMm
      leads.forEach((lead, li) => {
        const samples = data.leads[lead]
        if (!samples) return
        const y0 = li * laneH + laneH / 2
        const n = samples.length
        const msPerSample = data.durationMs / n
        ctx.strokeStyle = color
        ctx.lineWidth = 2.2
        ctx.lineJoin = 'round'
        ctx.beginPath()
        let first = true
        for (let dt = -TRAIL_MS; dt <= 0; dt += msPerSample) {
          let tt = tMs + dt
          if (tt < 0) tt += data.durationMs
          const i = Math.min(n - 1, Math.max(0, Math.round(tt / msPerSample)))
          const px = headX + dt * geo.pxPerMs
          const py = y0 - samples[i] * mvPx
          if (first) { ctx.moveTo(px, py); first = false }
          else ctx.lineTo(px, py)
        }
        ctx.stroke()
        // playhead dot
        const iNow = Math.min(n - 1, Math.round(tMs / msPerSample))
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(headX, y0 - samples[iNow] * mvPx, 3.4, 0, Math.PI * 2)
        ctx.fill()
      })

      // playhead hairline
      ctx.strokeStyle = color + '55'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(headX, 0)
      ctx.lineTo(headX, height)
      ctx.stroke()

      // pinned per-lane chrome: separator, calibration pulse, lead label
      leads.forEach((lead, li) => {
        const y0 = li * laneH + laneH / 2
        if (li > 0) {
          ctx.strokeStyle = theme.gridMajor
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(0, li * laneH)
          ctx.lineTo(size.w, li * laneH)
          ctx.stroke()
        }
        const calH = MM_PER_MV * geo.pxPerMm
        const calW = 200 * geo.pxPerMs
        ctx.strokeStyle = theme.label
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(4, y0)
        ctx.lineTo(6, y0)
        ctx.lineTo(6, y0 - calH)
        ctx.lineTo(6 + calW, y0 - calH)
        ctx.lineTo(6 + calW, y0)
        ctx.stroke()
        ctx.fillStyle = theme.label
        ctx.font = '600 11px system-ui, sans-serif'
        ctx.fillText(lead, 8, li * laneH + laneH - 8)
      })
    }

    return clock.subscribe(draw)
  }, [clock, data, leads, geo, height, laneH, paper, size.w, toneAt, highlight])

  // ---- pointer input: drag scrub / tap toggle / pinch zoom
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pointers = new Map<number, { x: number; y: number }>()
    let moved = 0
    let downAt = 0
    let pinchStart = 0
    let pinchZoom = 1

    const onDown = (e: PointerEvent) => {
      metric('manipulate')
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 1) { moved = 0; downAt = performance.now() }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y)
        pinchZoom = zoom
      }
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const cur = { x: e.clientX, y: e.clientY }
      pointers.set(e.pointerId, cur)
      if (pointers.size === 1) {
        const dx = cur.x - prev.x
        moved += Math.abs(dx)
        if (Math.abs(dx) > 0) clock.scrubBy(-(dx / geo.pxPerMs) / data.durationMs)
      } else if (pointers.size === 2 && pinchStart > 0) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const target = pinchZoom * (d / pinchStart)
        setZoom(target > 1.45 ? 2 : 1)
      }
    }
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size === 0 && moved < 6 && performance.now() - downAt < 350) onTap?.()
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [clock, data.durationMs, geo.pxPerMs, onTap, zoom])

  const togglePaper = () => {
    const next = !paper
    setPaper(next)
    try { localStorage.setItem('trace-paper', next ? '1' : '0') } catch { /* private mode */ }
  }

  return (
    <div className={`traceview ${paper ? 'traceview-paper' : ''}`} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="traceview-canvas"
        aria-label={`ECG trace, leads ${leads.join(', ')}`}
      />
      <div className="traceview-overlay">
        <div className="traceview-badge">{badge}</div>
        <div className="traceview-tools">
          <button className="traceview-tool" onClick={() => setZoom(zoom === 1 ? 2 : 1)} aria-label="Toggle time zoom">
            {zoom === 1 ? '25' : '50'}<span className="traceview-tool-unit">mm/s</span>
          </button>
          <button className="traceview-tool" onClick={togglePaper} aria-label="Toggle paper look">
            {paper ? 'dark' : 'paper'}
          </button>
        </div>
      </div>
    </div>
  )
}
