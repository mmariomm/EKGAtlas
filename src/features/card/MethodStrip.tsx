/**
 * The reading-method strip: the same seven steps on every card, with this
 * card's step lit. It turns a catalog of exemplars into one procedure the
 * learner can run on an unknown strip. Tap to expand the full method.
 */
import { useEffect, useRef, useState } from 'react'
import { METHOD, METHOD_BY_ID } from '../../content/method'
import './MethodStrip.css'

export default function MethodStrip({ stepId }: { stepId: string }) {
  const [open, setOpen] = useState(false)
  const active = METHOD_BY_ID[stepId]
  const activeRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [stepId])

  return (
    <div className="method">
      <button className="method-bar" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {METHOD.map((s) => (
          <span key={s.id} ref={s.id === stepId ? activeRef : undefined} className={`method-step ${s.id === stepId ? 'on' : ''}`}>{s.short}</span>
        ))}
      </button>
      {active && !open && (
        <p className="method-ask">
          <span className="method-asklabel">{active.short}:</span> {active.ask}
        </p>
      )}
      {open && (
        <ol className="method-full">
          {METHOD.map((s) => (
            <li key={s.id} className={s.id === stepId ? 'on' : ''}>
              <span className="method-name">{s.short} — {s.ask}</span>
              <span className="method-how">{s.how}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
