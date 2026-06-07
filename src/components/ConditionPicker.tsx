/**
 * Searchable, grouped condition picker. Opens a panel with a filter box; typing
 * matches name, abbreviation, category, or any criterion so you can find "wellens"
 * or "rabbit ears" fast. Closes on selection, outside click, or Escape.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Condition } from '../engine/types'
import { CONDITIONS, conditionsByCategory } from '../conditions'
import './ConditionPicker.css'

interface Props {
  current: Condition
  onSelect: (id: string) => void
}

const matches = (c: Condition, q: string) => {
  const hay = [c.name, c.shortName, c.category, ...c.criteria].join(' ').toLowerCase()
  return hay.includes(q)
}

export default function ConditionPicker({ current, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    const id = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
    }
  }, [open])

  const groups = useMemo(() => conditionsByCategory(), [])
  const q = query.trim().toLowerCase()
  const filtered = q ? CONDITIONS.filter((c) => matches(c, q)) : null

  const choose = (id: string) => {
    onSelect(id)
    setOpen(false)
    setQuery('')
  }

  const Item = ({ c }: { c: Condition }) => (
    <button
      className={`cp-item${c.id === current.id ? ' cp-item-active' : ''}`}
      onClick={() => choose(c.id)}
      role="option"
      aria-selected={c.id === current.id}
    >
      <span className="cp-item-name">{c.shortName}</span>
      <span className="cp-item-cat">{c.category}</span>
    </button>
  )

  return (
    <div className="cp" ref={rootRef}>
      <button className="cp-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="cp-trigger-label">
          <span className="cp-eyebrow">Condition</span>
          <span className="cp-current">{current.shortName}</span>
        </span>
        <svg className={`cp-chev${open ? ' cp-chev-open' : ''}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="cp-panel" role="listbox">
          <div className="cp-search">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conditions, criteria…"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="cp-list">
            {filtered ? (
              filtered.length ? (
                filtered.map((c) => <Item key={c.id} c={c} />)
              ) : (
                <div className="cp-empty">No conditions match “{query}”.</div>
              )
            ) : (
              groups.map((g) => (
                <div key={g.category} className="cp-group">
                  <div className="cp-group-head">{g.category}</div>
                  {g.items.map((c) => <Item key={c.id} c={c} />)}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
