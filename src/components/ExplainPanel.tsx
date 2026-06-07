/**
 * The "why it looks like this" panel: diagnostic criteria chips, the mean QRS
 * axis readout, and a collapsible mechanism explainer with per-segment notes
 * (each tagged in the segment's phase color).
 */
import { useEffect, useState } from 'react'
import { Condition, SegmentNote } from '../engine/types'
import { SegmentId } from '../engine/phases'
import './ExplainPanel.css'

const SEG_TONE: Record<SegmentNote['segment'], string> = {
  P: 'var(--tone-atria)',
  PR: 'var(--tone-av)',
  QRS: 'var(--tone-ventricle)',
  ST: 'var(--tone-injury)',
  T: 'var(--tone-repol)',
}

const axisLabel = (deg: number) => {
  if (deg >= -30 && deg <= 90) return 'normal'
  if (deg > 90 && deg <= 180) return 'right axis'
  if (deg < -30 && deg >= -90) return 'left axis'
  return 'extreme'
}

interface Props {
  condition: Condition
  meanAxis: number
  selected?: SegmentId | null
  onSelect?: (id: SegmentId) => void
}

export default function ExplainPanel({ condition, meanAxis, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false)

  // Open the panel when a segment is selected, so its note is visible.
  useEffect(() => {
    if (selected) setOpen(true)
  }, [selected])

  return (
    <div className="explain">
      <div className="explain-criteria">
        {condition.criteria.map((c) => (
          <span key={c} className="crit-chip">{c}</span>
        ))}
      </div>

      <div className="explain-axis">
        <span className="axis-cap">Mean QRS axis</span>
        <span className="axis-val mono">{meanAxis > 0 ? `+${meanAxis}` : meanAxis}°</span>
        <span className="axis-tag">{axisLabel(meanAxis)}</span>
      </div>

      <button className="explain-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>Why it looks like this</span>
        <svg className={`explain-chev${open ? ' open' : ''}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="explain-body">
          <p className="explain-desc">{condition.description}</p>
          <ul className="explain-notes">
            {condition.segmentNotes.map((n, i) => {
              const active = selected === n.segment
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`note${active ? ' note-active' : ''}`}
                    onClick={() => onSelect?.(n.segment)}
                  >
                    <span className="note-tag" style={{ background: SEG_TONE[n.segment], color: '#06101e' }}>
                      {n.segment}
                    </span>
                    <div>
                      <div className="note-title">{n.title}</div>
                      <div className="note-detail">{n.detail}</div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
