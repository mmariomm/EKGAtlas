import { useState } from 'react'
import { cardsByCategory, searchCards, PACKS } from '../../content'
import { linkClick } from '../../router'
import './LibraryScreen.css'

export default function LibraryScreen() {
  const [q, setQ] = useState('')
  const results = q.trim() ? searchCards(q) : null

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

      <p className="lib-thesis">
        The ECG is a shadow; everyone is taught to memorize shadows. This app makes
        the object casting them visible — and manipulable.
      </p>

      <input
        className="lib-search"
        type="search"
        placeholder="Search patterns — “wide”, “AF”, “block”…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search patterns"
      />

      {!results && (
        <div className="lib-shelf">
          <a href="/lab/electrodes" onClick={linkClick('/lab/electrodes')} className="lib-hero">
            <span className="lib-hero-kicker">The hero demo</span>
            <span className="lib-hero-name">Electrode Lab</span>
            <span className="lib-hero-sub">Drag the electrodes. Watch the trace obey.</span>
          </a>
          <a href="/lab/hyperk" onClick={linkClick('/lab/hyperk')} className="lib-hero lib-hero-k">
            <span className="lib-hero-kicker">The systemic window</span>
            <span className="lib-hero-name">HyperK Module</span>
            <span className="lib-hero-sub">Five patients, one potassium. Estimate the K.</span>
          </a>
          {PACKS.map((p) => (
            <a key={p.id} href={`/p/${p.id}`} onClick={linkClick(`/p/${p.id}`)} className="lib-pack">
              <span className="lib-hero-name">{p.title}</span>
              <span className="lib-hero-sub">{p.blurb}</span>
            </a>
          ))}
        </div>
      )}

      {results ? (
        <CardList items={results.map((c) => ({ ...c }))} empty={`Nothing matches “${q}”.`} />
      ) : (
        cardsByCategory().map((g) => (
          <section key={g.category} className="lib-group">
            <h2 className="lib-cat">{g.category}</h2>
            <CardList items={g.items} empty="" />
          </section>
        ))
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
}

function CardList({ items, empty }: { items: Row[]; empty: string }) {
  if (!items.length) return empty ? <p className="lib-empty">{empty}</p> : null
  return (
    <ul className="lib-list">
      {items.map((c) => (
        <li key={c.id}>
          <a href={`/c/${c.id}`} onClick={linkClick(`/c/${c.id}`)} className="lib-row">
            <span className="lib-row-main">
              <span className="lib-row-name">
                {c.lethal && <span className="lib-dot" title="Lethal set — cannot-miss" />}
                {c.name}
              </span>
              <span className="lib-row-tag">{c.tagline}</span>
            </span>
            <span className="lib-chev" aria-hidden>›</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
