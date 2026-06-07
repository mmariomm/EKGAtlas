/**
 * The live phase caption above the heart ("Ventricular depolarization · QRS"),
 * color-coded to the same tone as the heart glow and trace comet. Updated
 * imperatively from the clock so it never triggers a React re-render.
 */
import { useEffect, useRef } from 'react'
import { CardiacClock } from '../hooks/useCardiacClock'
import { Strip, PhaseTone } from '../engine/types'
import { samplePhase } from '../engine/synthesize'
import { PHASE_COLORS } from '../theme'
import './PhaseNarration.css'

interface Props {
  strip: Strip
  clock: CardiacClock
}

export default function PhaseNarration({ strip, clock }: Props) {
  const dotRef = useRef<HTMLSpanElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const subRef = useRef<HTMLDivElement | null>(null)
  const lastTone = useRef<PhaseTone | null>(null)

  useEffect(() => {
    lastTone.current = null
    const onFrame = (t: number) => {
      const ph = samplePhase(strip, t)
      if (textRef.current) textRef.current.textContent = ph.text
      if (subRef.current) subRef.current.textContent = ph.sub
      if (ph.tone !== lastTone.current) {
        lastTone.current = ph.tone
        const c = PHASE_COLORS[ph.tone]
        if (dotRef.current) {
          dotRef.current.style.background = c.core
          dotRef.current.style.boxShadow = `0 0 12px ${c.glow}`
        }
        if (textRef.current) textRef.current.style.color = ph.tone === 'rest' ? 'var(--text)' : c.core
      }
    }
    return clock.subscribe(onFrame)
  }, [clock, strip])

  return (
    <div className="phase" aria-live="polite">
      <span ref={dotRef} className="phase-dot" />
      <div className="phase-body">
        <div ref={textRef} className="phase-text">Diastole</div>
        <div ref={subRef} className="phase-sub">ventricular filling</div>
      </div>
    </div>
  )
}
