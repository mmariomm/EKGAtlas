import { useMemo, useState } from 'react'
import { cardsByCategory, searchCards, PACKS } from '../../content'
import { SPARKLINES } from '../../content/sparklines.gen'
import { loadDrill, masteryOf, progressSummary, Mastery } from '../../lib/progress'
import { linkClick } from '../../router'
import './LibraryScreen.css'

export default function LibraryScreen() {
  const [q, setQ] = useState('')
  const [lethalOnly, setLethalOnly] = useState(false)
  const results = q.trim() ? searchCards(q) : null
  const drill = useMemo(() => loadDrill(), [])
  const progress = useMemo(() => progressSummary(), [])

  return (
    <div className="screen">
      <header className="lib-head">
        <div className="brand" aria-hidden>
          <svg viewBox="0 0 40 24" width="34" height="20">
            <path d="M1 12 H10 L13 5 L17 19 L21 9 L24 14 H39" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="brand-name">EKG&nbsp;Atlas</span>
        </div>
        <a href="/about" onClick={linkClick('/about')} className="lib-about">About</a>
      </header>

      <p className="lib-promise">Catch the cannot-miss ECGs — mechanism first, on real recordings.</p>

      <input
        className="lib-search"
        type="search"
        placeholder="Search patterns — “wide”, “AF”, “block”…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search patterns"
      />

      {!results && (
        <>
          <a href="/drill" onClick={linkClick('/drill')} className="lib-drill">
            <span className="lib-drill-name">Drill</span>
            <span className="lib-drill-sub">
              {progress.due > 0
                ? `${progress.due} due for review · ${progress.solid}/${progress.total} solid`
                : progress.seen === 0
                  ? 'unknown strips, no labels — cannot-miss first'
                  : `${progress.solid}/${progress.total} solid — cannot-miss first`}
            </span>
            <span className="lib-chev" aria-hidden>›</span>
          </a>

          <div className="lib-labs">
            <a href="/lab/electrodes" onClick={linkClick('/lab/electrodes')} className="lib-lab">
              <span className="lib-lab-name">Electrode Lab</span>
              <span className="lib-lab-sub">Drag the electrodes — the trace obeys.</span>
            </a>
            <a href="/lab/hyperk" onClick={linkClick('/lab/hyperk')} className="lib-lab">
              <span className="lib-lab-name">HyperK Lab</span>
              <span className="lib-lab-sub">Five patients, one K⁺ — estimate it.</span>
            </a>
          </div>

          <div className="lib-setrow">
            <span className="lib-setlabel">Curated sets</span>
            <div className="lib-packrow" role="group" aria-label="Curated sets">
              {PACKS.map((p) => (
                <a key={p.id} href={`/p/${p.id}`} onClick={linkClick(`/p/${p.id}`)} className="lib-packchip">
                  {p.title}
                </a>
              ))}
            </div>
          </div>

          <div className="lib-legend">
            <button
              className={`lib-lethalchip ${lethalOnly ? 'on' : ''}`}
              onClick={() => setLethalOnly((v) => !v)}
              aria-pressed={lethalOnly}
            >
              <span className="lib-dot" /> cannot-miss{lethalOnly ? ' only' : ''}
            </button>
          </div>
        </>
      )}

      {results ? (
        <CardList items={results.map((c) => ({ ...c, mastery: masteryOf(c.id, drill) }))} empty={`Nothing matches “${q}”.`} />
      ) : (
        cardsByCategory().map((g) => {
          const items = (lethalOnly ? g.items.filter((c) => c.lethal) : g.items)
            .map((c) => ({ ...c, mastery: masteryOf(c.id, drill) }))
          if (!items.length) return null
          return (
            <section key={g.category} className="lib-group">
              <h2 className="lib-cat">{g.category}</h2>
              <CardList items={items} empty="" />
            </section>
          )
        })
      )}
      <p className="lib-disclaimer">Educational — never a substitute for clinical judgment or local protocol.</p>
    </div>
  )
}

interface Row {
  id: string
  name: string
  tagline: string
  lethal: boolean
  mastery: Mastery
}

function Spark({ id }: { id: string }) {
  const pts = SPARKLINES[id]
  if (!pts) return <span className="lib-spark" aria-hidden />
  const W = 74
  const H = 34
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * W).toFixed(1)} ${((1 - v) * (H - 6) + 3).toFixed(1)}`).join('')
  return (
    <svg className="lib-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function CardList({ items, empty }: { items: Row[]; empty: string }) {
  if (!items.length) return empty ? <p className="lib-empty">{empty}</p> : null
  return (
    <ul className="lib-list">
      {items.map((c) => (
        <li key={c.id}>
          <a href={`/c/${c.id}`} onClick={linkClick(`/c/${c.id}`)} className="lib-row">
            <Spark id={c.id} />
            <span className="lib-row-main">
              <span className="lib-row-name">
                {c.lethal && <span className="lib-dot" title="cannot-miss" />}
                {c.name}
              </span>
              <span className="lib-row-tag">{c.tagline}</span>
            </span>
            <span className={`lib-mastery lib-mastery-${c.mastery}`} aria-label={`progress: ${c.mastery}`} title={c.mastery} />
          </a>
        </li>
      ))}
    </ul>
  )
}
