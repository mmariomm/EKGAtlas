/**
 * The single master clock. One requestAnimationFrame loop advances a looping
 * time cursor; every animated surface subscribes and updates imperatively, so
 * cause and effect stay frame-perfectly in sync and React never re-renders
 * 60×/second. Time lives in a ref; play/pause/speed mirror to React state
 * only so controls can render their value.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clamp } from '../engine/vec'

export type FrameListener = (timeMs: number) => void

export interface CardiacClock {
  isPlaying: boolean
  speed: number
  durationMs: number
  play: () => void
  pause: () => void
  toggle: () => void
  setSpeed: (s: number) => void
  /** Seek to a fraction 0..1 of the loop. */
  seekFraction: (f: number) => void
  /** Nudge the playhead by a signed fraction of the loop (touch scrubbing).
   *  Pauses playback; resuming is an explicit play. */
  scrubBy: (dFraction: number) => void
  getTime: () => number
  getFraction: () => number
  /** Register a per-frame callback; returns an unsubscribe. Fires once immediately. */
  subscribe: (fn: FrameListener) => () => void
}

const DEFAULT_SPEED = 0.4 // slowed for teaching; 1.0 = real time

export interface ClockOptions {
  startFraction?: number
  autoplay?: boolean
}

export function useCardiacClock(durationMs: number, opts?: ClockOptions): CardiacClock {
  const [isPlaying, setIsPlaying] = useState(opts?.autoplay ?? true)
  const [speed, setSpeedState] = useState(DEFAULT_SPEED)

  const startFractionRef = useRef(opts?.startFraction ?? 0)
  const lastDurationRef = useRef<number | null>(null)
  const timeRef = useRef(startFractionRef.current * durationMs)
  const playingRef = useRef(isPlaying)
  const speedRef = useRef(speed)
  const durationRef = useRef(durationMs)
  const lastTsRef = useRef<number | null>(null)
  const listenersRef = useRef(new Set<FrameListener>())

  const notify = useCallback(() => {
    const t = timeRef.current
    listenersRef.current.forEach((fn) => fn(t))
  }, [])

  useEffect(() => { playingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { speedRef.current = speed }, [speed])

  // New strip → new loop length. Honor the start fraction on first mount;
  // reset to the top only when the duration actually changes (keyed on the
  // value so StrictMode's double-invoke can't clobber a deep-linked start).
  useEffect(() => {
    durationRef.current = durationMs
    if (lastDurationRef.current === null) {
      timeRef.current = startFractionRef.current * durationMs
    } else if (lastDurationRef.current !== durationMs) {
      timeRef.current = 0
    }
    lastDurationRef.current = durationMs
    notify()
  }, [durationMs, notify])

  // The one and only animation loop.
  useEffect(() => {
    let raf = 0
    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts
      const dt = ts - lastTsRef.current
      lastTsRef.current = ts
      if (playingRef.current && durationRef.current > 0) {
        let next = timeRef.current + dt * speedRef.current
        next %= durationRef.current
        if (next < 0) next += durationRef.current
        timeRef.current = next
        notify()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      lastTsRef.current = null
    }
  }, [notify])

  const subscribe = useCallback((fn: FrameListener) => {
    listenersRef.current.add(fn)
    fn(timeRef.current)
    return () => { listenersRef.current.delete(fn) }
  }, [])

  const seekFraction = useCallback(
    (f: number) => {
      timeRef.current = clamp(f, 0, 1) * durationRef.current
      notify()
    },
    [notify],
  )

  const scrubBy = useCallback(
    (dFraction: number) => {
      setIsPlaying(false)
      const dur = durationRef.current
      let next = (timeRef.current + dFraction * dur) % dur
      if (next < 0) next += dur
      timeRef.current = next
      notify()
    },
    [notify],
  )

  const play = useCallback(() => setIsPlaying(true), [])
  const pause = useCallback(() => setIsPlaying(false), [])
  const toggle = useCallback(() => setIsPlaying((p) => !p), [])
  const setSpeed = useCallback((s: number) => setSpeedState(s), [])
  const getTime = useCallback(() => timeRef.current, [])
  const getFraction = useCallback(
    () => (durationRef.current > 0 ? timeRef.current / durationRef.current : 0),
    [],
  )

  return useMemo(
    () => ({
      isPlaying, speed, durationMs,
      play, pause, toggle, setSpeed,
      seekFraction, scrubBy, getTime, getFraction, subscribe,
    }),
    [isPlaying, speed, durationMs, play, pause, toggle, setSpeed, seekFraction, scrubBy, getTime, getFraction, subscribe],
  )
}
