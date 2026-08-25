/**
 * The conduction visual: mounts the HeartVis component and drives it every
 * frame from the shared clock through the sync warp. Horizontal drag scrubs
 * the clock.
 */
import { useEffect, useRef } from 'react'
import './heartvis.js'
import { Strip, StructureId } from '../../engine/sources'
import { CardiacClock } from '../../lib/clock'
import { buildHeartVisState, HeartVisHandle } from './heartVisState'
import './HeartView.css'

interface Props {
  strip: Strip
  clock: CardiacClock
  warp?: (tMs: number) => number
  blockedBranches?: StructureId[]
}

export default function HeartView({ strip, clock, warp, blockedBranches }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HeartVisHandle | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !window.HeartVis) return
    const handle = window.HeartVis.mount(host, {})
    handleRef.current = handle
    handle.setStatic({ blocked: blockedBranches ?? [] })
    const w = warp ?? ((t: number) => t)
    const unsub = clock.subscribe((t) => handle.update(buildHeartVisState(strip, w(t))))
    return () => {
      unsub()
      handle.destroy()
      handleRef.current = null
    }
  }, [strip, clock, warp, blockedBranches])

  // Drag on the figure scrubs the shared clock (trace ↔ heart, both ways).
  useEffect(() => {
    const el = hostRef.current
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

  return <div className="heart" ref={hostRef} role="img" aria-label="Anatomical heart showing the conduction wavefront and cardiac vector" />
}
