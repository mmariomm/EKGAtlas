import { useMemo, useState } from 'react'
import { cardsByCategory, searchCards, PACKS } from '../../content'
import { SPARKLINES } from '../../content/sparklines.gen'
import { localizeCard } from '../../content/i18n'
import { loadDrill, masteryOf, progressSummary, Mastery } from '../../lib/progress'
import { setLang } from '../../lib/lang'
import { useLang } from '../../lib/useLang'
import { t } from '../../lib/ui'
import { linkClick } from '../../router'
import './LibraryScreen.css'

export default function LibraryScreen() {
  const lang = useLang()
  const [q, setQ] = useState('')
  const [lethalOnly, setLethalOnly] = useState(false)
  const loc = useMemo(() => <T extends { id: string }>(c: T) => localizeCard(c as never, lang) as unknown as T, [lang])
  const results = q.trim() ? searchCards(q).map(loc) : null
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
        <span className="lib-headright">
          <span className="seg seg-sm lib-lang" role="group" aria-label="Language">
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            <button className={lang === 'it' ? 'on' : ''} onClick={() => setLang('it')}>IT</button>
          </span>
          <a href="/about" onClick={linkClick('/about')} className="lib-about">{t('lib.about')}</a>
        </span>
      </header>

      <p className="lib-promise">{t('lib.promise')}</p>

      <input
        className="lib-search"
        type="search"
        placeholder={t('lib.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search patterns"
      />

      {!results && (
        <>
          <a href="/drill" onClick={linkClick('/drill')} className="lib-drill">
            <span className="lib-drill-name">{t('lib.drill')}</span>
            <span className="lib-drill-sub">
              {progress.due > 0
                ? t('lib.drill.due', { due: progress.due, solid: progress.solid, total: progress.total })
                : progress.seen === 0
                  ? t('lib.drill.fresh')
                  : t('lib.drill.solid', { solid: progress.solid, total: progress.total })}
            </span>
            <span className="lib-chev" aria-hidden>›</span>
          </a>

          <div className="lib-labs">
            <a href="/lab/electrodes" onClick={linkClick('/lab/electrodes')} className="lib-lab">
              <span className="lib-lab-name">{t('lab.electrodes')}</span>
              <span className="lib-lab-sub">{t('lab.electrodes.sub')}</span>
            </a>
            <a href="/lab/hyperk" onClick={linkClick('/lab/hyperk')} className="lib-lab">
              <span className="lib-lab-name">{t('lab.hyperk')}</span>
              <span className="lib-lab-sub">{t('lab.hyperk.sub')}</span>
            </a>
          </div>

          <div className="lib-setrow">
            <span className="lib-setlabel">{t('lib.sets')}</span>
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
              <span className="lib-dot" /> {lethalOnly ? t('lib.lethalOnly') : t('lib.lethal')}
            </button>
            <span className="lib-pipslegend" aria-hidden>
              <span className="lib-pip on" /> {t('lib.seen')}
              <span className="lib-pip on" style={{ marginLeft: 10 }} /><span className="lib-pip on" /> {t('lib.learning')}
              <span className="lib-pip on lib-pip-solid" style={{ marginLeft: 10 }} /><span className="lib-pip on lib-pip-solid" /><span className="lib-pip on lib-pip-solid" /> {t('lib.solid')}
            </span>
          </div>
        </>
      )}

      {results ? (
        <CardList items={results.map((c) => ({ ...c, mastery: masteryOf(c.id, drill), box: drill[c.id]?.box ?? 0 }))} empty={t('lib.empty', { q })} />
      ) : (
        cardsByCategory().map((g) => {
          const items = (lethalOnly ? g.items.filter((c) => c.lethal) : g.items)
            .map(loc)
            .map((c) => ({ ...c, mastery: masteryOf(c.id, drill), box: drill[c.id]?.box ?? 0 }))
          if (!items.length) return null
          return (
            <section key={g.category} className="lib-group">
              <h2 className="lib-cat">{g.category}</h2>
              <CardList items={items} empty="" />
            </section>
          )
        })
      )}
      <p className="lib-disclaimer">{t('lib.disclaimer')}</p>
    </div>
  )
}

interface Row {
  id: string
  name: string
  tagline: string
  lethal: boolean
  mastery: Mastery
  box: number
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

function Pips({ mastery, box }: { mastery: Mastery; box: number }) {
  const filled = mastery === 'solid' ? 3 : box >= 1 ? 2 : mastery !== 'unseen' ? 1 : 0
  return (
    <span className={`lib-pips ${mastery === 'solid' ? 'lib-pips-solid' : ''}`} aria-label={`progress: ${mastery}`} title={mastery}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`lib-pip ${i < filled ? 'on' : ''}`} />
      ))}
    </span>
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
            <Pips mastery={c.mastery} box={c.box} />
          </a>
        </li>
      ))}
    </ul>
  )
}
