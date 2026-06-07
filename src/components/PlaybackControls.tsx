/**
 * Bottom transport, sized for thumbs. Play/pause, a teaching speed selector
 * (slow by default), and a scrubber that tracks the loop. The scrubber thumb is
 * advanced imperatively from the clock; dragging it seeks (and pauses, then
 * resumes if it was playing).
 */
import { useEffect, useRef } from 'react'
import { CardiacClock } from '../hooks/useCardiacClock'
import './PlaybackControls.css'

const SPEEDS = [0.1, 0.25, 0.5, 1]

interface Props {
  clock: CardiacClock
}

export default function PlaybackControls({ clock }: Props) {
  const sliderRef = useRef<HTMLInputElement | null>(null)
  const draggingRef = useRef(false)
  const resumeRef = useRef(false)

  useEffect(() => {
    const onFrame = () => {
      if (draggingRef.current) return
      const el = sliderRef.current
      if (el) el.value = String(Math.round(clock.getFraction() * 1000))
    }
    return clock.subscribe(onFrame)
  }, [clock])

  const onInput = (e: React.FormEvent<HTMLInputElement>) => {
    clock.seekFraction(Number(e.currentTarget.value) / 1000)
  }
  const onPointerDown = () => {
    draggingRef.current = true
    resumeRef.current = clock.isPlaying
    clock.pause()
  }
  const onPointerUp = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (resumeRef.current) clock.play()
  }

  return (
    <div className="transport">
      <button
        className="play-btn"
        onClick={clock.toggle}
        aria-label={clock.isPlaying ? 'Pause' : 'Play'}
      >
        {clock.isPlaying ? (
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1.3" fill="currentColor" />
            <rect x="14" y="5" width="4" height="14" rx="1.3" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
          </svg>
        )}
      </button>

      <input
        ref={sliderRef}
        className="scrubber"
        type="range"
        min={0}
        max={1000}
        defaultValue={0}
        onInput={onInput}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Scrub through the cardiac cycle"
      />

      <div className="speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`speed-chip${clock.speed === s ? ' speed-active' : ''}`}
            onClick={() => clock.setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  )
}
