/**
 * Lead selection. Presets cover the common cases (one lead, a two-lead pairing,
 * all twelve); an expandable grid lets you build any custom montage. At least
 * one lead is always selected.
 */
import { useState } from 'react'
import { ALL_LEADS, LeadId, LIMB_LEADS, PRECORDIAL_LEADS } from '../engine/leads'
import './LeadSelector.css'

interface Props {
  leads: LeadId[]
  onChange: (leads: LeadId[]) => void
}

const PRESETS: { label: string; leads: LeadId[] }[] = [
  { label: 'Lead II', leads: ['II'] },
  { label: 'II + V1', leads: ['II', 'V1'] },
  { label: 'Limb', leads: LIMB_LEADS },
  { label: '12-lead', leads: ALL_LEADS },
]

const sameSet = (a: LeadId[], b: LeadId[]) =>
  a.length === b.length && a.every((x) => b.includes(x))

export default function LeadSelector({ leads, onChange }: Props) {
  const [open, setOpen] = useState(false)

  const toggle = (id: LeadId) => {
    const has = leads.includes(id)
    if (has && leads.length === 1) return // keep at least one
    const next = ALL_LEADS.filter((l) => (l === id ? !has : leads.includes(l)))
    onChange(next)
  }

  return (
    <div className="leadsel">
      <div className="leadsel-row">
        <span className="leadsel-cap">Leads</span>
        <div className="leadsel-presets">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className={`chip${sameSet(leads, p.leads) ? ' chip-active' : ''}`}
              onClick={() => onChange(p.leads)}
            >
              {p.label}
            </button>
          ))}
          <button
            className={`chip chip-ghost${open ? ' chip-active' : ''}`}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            Custom
          </button>
        </div>
      </div>

      {open && (
        <div className="leadsel-grid">
          {[LIMB_LEADS, PRECORDIAL_LEADS].map((group, gi) => (
            <div key={gi} className="leadsel-group">
              {group.map((id) => (
                <button
                  key={id}
                  className={`chip chip-sm${leads.includes(id) ? ' chip-active' : ''}`}
                  onClick={() => toggle(id)}
                  aria-pressed={leads.includes(id)}
                >
                  {id}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
