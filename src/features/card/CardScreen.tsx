/**
 * The card player: pinned real trace (scrub-synced to the mechanism model) +
 * the five-section skeleton — SEE IT (commit-before-reveal), WHY, PEARLS &
 * TRAPS, SUSPECT & CONFIRM, GUIDELINE MOVES. Until commit (or an explicit
 * skip), the diagnosis name and the mechanism stay locked. Guideline moves
 * always render, stamped with the process-verification date — this app is an
 * educational reference with no individual authorship, by design.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CARD_BY_ID } from '../../content'
import { ALL_LEADS, LeadId } from '../../engine/leads'
import { GUIDELINE_BY_KEY } from '../../content/guidelines'
import { buildMechanismStrip } from '../../content/mechanisms'
import { Card, CitedLine } from '../../content/schema'
import { StructureId } from '../../engine/sources'
import { modelFiducials, buildWarp } from '../../engine/sync'
import { samplePhase } from '../../engine/synthesize'
import { useCardiacClock } from '../../lib/clock'
import { loadTrace, TraceData } from '../../lib/assets'
import { linkClick, navigate } from '../../router'
import { metric } from '../../lib/metrics'
import { emph } from '../../lib/emph'
import { localizeCard, hasTranslation } from '../../content/i18n'
import { useLang } from '../../lib/useLang'
import { t } from '../../lib/ui'
import TraceView from '../trace/TraceView'
import HeartView from '../mechanism/HeartView'
import MethodStrip from './MethodStrip'
import ProvenanceBadge from './ProvenanceBadge'
import './CardScreen.css'

const COMMIT_KEY = (id: string) => `commit:${id}`
/** Sentinel: card opened as reference without committing (no verdict shown). */
const SKIPPED = -1

type PhaseId = 'P' | 'QRS' | 'ST' | 'T'
const PHASE_TONES: Record<PhaseId, 'atria' | 'ventricle' | 'injury' | 'repol'> = {
  P: 'atria', QRS: 'ventricle', ST: 'injury', T: 'repol',
}

export default function CardScreen({ cardId }: { cardId: string }) {
  const card = CARD_BY_ID[cardId]
  if (!card) {
    return (
      <div className="screen card-missing">
        <p>No card called “{cardId}” (yet).</p>
        <a href="/" onClick={linkClick('/')}>Back to the library</a>
      </div>
    )
  }
  return <CardInner cardId={cardId} />
}

function CardInner({ cardId }: { cardId: string }) {
  const lang = useLang()
  const en = CARD_BY_ID[cardId]
  const card = useMemo(() => localizeCard(en, lang), [en, lang])
  // Honest marker: this card's clinical text has no translation yet.
  const untranslated = lang !== 'en' && !hasTranslation(en, lang)
  const [traceId, setTraceId] = useState(card.seeIt.traceId)
  const [leads, setLeads] = useState<LeadId[]>([card.mechanism.primaryLead])
  const [data, setData] = useState<TraceData | null>(null)
  const [error, setError] = useState('')
  const [committed, setCommitted] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(COMMIT_KEY(card.id))
      return v == null ? null : Number(v)
    } catch { return null }
  })
  const [showHeart, setShowHeart] = useState(committed != null)
  const [phase, setPhase] = useState<PhaseId | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const revealed = committed != null

  // Role: MD sees guideline moves, RN sees recognize/escalate/anticipate/watch.
  // Only section 5 forks — the recognition core is the same skill for both.
  const [role, setRole] = useState<'md' | 'rn'>(() => {
    try { return localStorage.getItem('role') === 'rn' ? 'rn' : 'md' } catch { return 'md' }
  })
  const setRoleAndSave = (r: 'md' | 'rn') => {
    setRole(r)
    try { localStorage.setItem('role', r) } catch { /* private mode */ }
  }

  // One-time gesture hints (the scrub/pinch/drag gestures are otherwise invisible).
  const [coachTrace, setCoachTrace] = useState(() => {
    try { return !localStorage.getItem('coach:trace') } catch { return false }
  })
  const [coachHeart, setCoachHeart] = useState(() => {
    try { return !localStorage.getItem('coach:heart') } catch { return false }
  })
  useEffect(() => {
    if (!coachTrace) return
    const t = setTimeout(() => {
      setCoachTrace(false)
      try { localStorage.setItem('coach:trace', '1') } catch { /* private mode */ }
    }, 9000)
    return () => clearTimeout(t)
  }, [coachTrace])
  useEffect(() => {
    if (!coachHeart || !revealed) return
    const t = setTimeout(() => {
      setCoachHeart(false)
      try { localStorage.setItem('coach:heart', '1') } catch { /* private mode */ }
    }, 9000)
    return () => clearTimeout(t)
  }, [coachHeart, revealed])

  useEffect(() => {
    let live = true
    setData(null)
    loadTrace(traceId).then(
      (d) => { if (live) setData(d) },
      (e) => { if (live) setError(String(e)) },
    )
    return () => { live = false }
  }, [traceId])

  const strip = useMemo(() => buildMechanismStrip(card.mechanism), [card])
  const warp = useMemo(() => {
    if (!data) return (t: number) => t
    return buildWarp(data.annotation, modelFiducials(strip), data.durationMs, strip.durationMs)
  }, [data, strip])

  const clock = useCardiacClock(data?.durationMs ?? 1000, { autoplay: true })
  const toneAt = useCallback(
    (t: number) => samplePhase(strip, warp(t)).tone,
    [strip, warp],
  )

  const commit = (i: number) => {
    if (i !== SKIPPED) metric('commit', card.id)
    setCommitted(i)
    setShowHeart(true)
    try { localStorage.setItem(COMMIT_KEY(card.id), String(i)) } catch { /* private mode */ }
  }
  const recommit = () => {
    setCommitted(null)
    setShowHeart(false)
    setPhase(null)
    try { localStorage.removeItem(COMMIT_KEY(card.id)) } catch { /* private mode */ }
  }

  // Phase chip → seek + highlight, from the REAL annotation (representative beat).
  const highlight = useMemo(() => {
    if (!phase || !data) return null
    const b = data.annotation.beats.find((x) => x.pOn != null && x.tEnd != null) ?? data.annotation.beats[0]
    if (!b) return null
    const win: Record<PhaseId, [number, number] | null> = {
      P: b.pOn != null ? [b.pOn, b.qrsOn] : null,
      QRS: [b.qrsOn, b.qrsOff],
      ST: [b.qrsOff, Math.min(b.qrsOff + 80, b.tEnd ?? b.qrsOff + 80)],
      T: b.tEnd != null ? [b.qrsOff + 80, b.tEnd] : null,
    }
    const w = win[phase]
    return w ? { t0: w[0], t1: w[1], tone: PHASE_TONES[phase] } : null
  }, [phase, data])

  const tapPhase = (p: PhaseId) => {
    if (phase === p) { setPhase(null); clock.play(); return }
    setPhase(p)
    if (highlightForSeek(p)) {
      clock.pause()
      clock.seekFraction(highlightForSeek(p)! / (data?.durationMs ?? 1))
    }
  }
  const highlightForSeek = (p: PhaseId): number | null => {
    if (!data) return null
    const b = data.annotation.beats.find((x) => x.pOn != null && x.tEnd != null) ?? data.annotation.beats[0]
    if (!b) return null
    if (p === 'P') return b.pOn ?? null
    if (p === 'QRS') return (b.qrsOn + b.qrsOff) / 2
    if (p === 'ST') return b.qrsOff + 40
    return b.tEnd != null ? (b.qrsOff + 80 + b.tEnd) / 2 : null
  }

  const share = async () => {
    metric('share', card.id)
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: card.name, url })
      else {
        await navigator.clipboard.writeText(url)
        setToast('Link copied')
        setTimeout(() => setToast(''), 1800)
      }
    } catch { /* user cancelled */ }
  }
  const [toast, setToast] = useState('')

  const speeds = [0.25, 0.4, 0.7, 1]
  const cycleSpeed = () => {
    const cur = speeds.indexOf(clock.speed)
    clock.setSpeed(speeds[(cur + 1) % speeds.length] ?? 0.4)
  }

  const extras = card.seeIt.extraTraceIds ?? []
  const correctIdx = card.seeIt.commit.options.findIndex((o) => o.correct)

  return (
    <div className="screen cardscreen">
      <header className="card-top">
        <a href="/" onClick={linkClick('/')} className="card-back" aria-label={t('card.back')}>‹</a>
        <div className="card-topname">{revealed ? card.name : card.category}</div>
        <button className="card-share" onClick={share} aria-label={t('a11y.shareCard')}>{t('card.share')}</button>
      </header>

      <div className={`card-stage ${leads.length === 12 ? 'card-stage-tall' : ''}`}>
        {error && <div className="card-error">{error}</div>}
        {!error && !data && <div className="card-loading">loading recording…</div>}
        {data && (
          <TraceView
            data={data}
            leads={leads}
            clock={clock}
            toneAt={toneAt}
            highlight={highlight}
            onTap={clock.toggle}
            badge={<ProvenanceBadge provenance={data.provenance} />}
          />
        )}
      </div>
      {coachTrace && data && (
        <p className="card-coach">{t('card.coachTrace')}</p>
      )}

      <div className="card-leadrow" role="group" aria-label={t('a11y.chooseLeads')}>
        <button
          className={`leadchip ${leads.length === 12 ? 'leadchip-on' : ''}`}
          onClick={() => setLeads(leads.length === 12 ? [card.mechanism.primaryLead] : [...ALL_LEADS])}
        >
          {t('card.allLeads')}
        </button>
        {ALL_LEADS.map((l) => (
          <button
            key={l}
            className={`leadchip ${leads.includes(l) ? 'leadchip-on' : ''}`}
            onClick={() => setLeads((cur) => (cur.length === 12 ? [l] : cur.includes(l) ? (cur.length > 1 ? cur.filter((x) => x !== l) : cur) : [...cur.slice(-2), l]))}
          >
            {l}
          </button>
        ))}
      </div>

      {revealed && (
        <div className="card-phasechips" role="group" aria-label={t('a11y.highlightPhase')}>
          <span className="phase-label">{t('card.highlight')}</span>
          {(['P', 'QRS', 'ST', 'T'] as PhaseId[]).map((p) => (
            <button
              key={p}
              className={`phasechip phasechip-${p} ${phase === p ? 'phasechip-on' : ''}`}
              onClick={() => tapPhase(p)}
            >
              {p}
            </button>
          ))}
          {!showHeart && (
            <button className="phasechip phasechip-heart" onClick={() => setShowHeart(true)}>
              {t('card.showHeart')}
            </button>
          )}
        </div>
      )}

      <MethodStrip stepId={card.methodStep} />

      {revealed && extras.length > 0 && (
        <div className="card-extras">
          <span className="card-extras-label">{t('card.recordings')}</span>
          {[card.seeIt.traceId, ...extras].map((id, i) => (
            <button
              key={id}
              className={`extra-chip ${traceId === id ? 'extra-chip-on' : ''}`}
              onClick={() => setTraceId(id)}
            >
              {i + 1}
            </button>
          ))}
          <span className="card-extras-note">{t('card.sameDx')}</span>
        </div>
      )}

      {/* ---- 1 · SEE IT (the verdict lands first — the heart follows it) ---- */}
      <section className="card-section">
        <h2 className="sec-title"><span className="sec-num">1</span> {t('card.seeIt')}</h2>
        {untranslated && <p className="card-englishonly">{t('card.englishOnly')}</p>}
        {!revealed ? (
          <>
            <p className="commit-prompt">{card.seeIt.commit.prompt}</p>
            <div className="commit-options">
              {card.seeIt.commit.options.map((o, i) => (
                <button key={i} className="commit-option" onClick={() => commit(i)}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="commit-hint">
              {t('card.commitHint')}{' '}
              <button className="commit-skip" onClick={() => commit(SKIPPED)}>{t('card.skip')}</button>
            </p>
          </>
        ) : (
          <div className="commit-result">
            {committed === SKIPPED ? (
              <p className="commit-verdict">{card.seeIt.commit.options[correctIdx].label} <span className="commit-skipnote">{t('card.skipped')}</span></p>
            ) : committed === correctIdx ? (
              <p className="commit-verdict commit-right">✓ {card.seeIt.commit.options[correctIdx].label}</p>
            ) : (
              <>
                <p className="commit-verdict commit-wrong">
                  ✕ {t('card.youRead')} {card.seeIt.commit.options[committed!].label}
                </p>
                <p className="commit-tempts">{emph(card.seeIt.commit.options[committed!].tempts)}</p>
                <p className="commit-verdict commit-right">✓ {card.seeIt.commit.options[correctIdx].label}</p>
              </>
            )}
            <p className="commit-tempts">{emph(card.seeIt.commit.options[correctIdx].tempts)}</p>
            <button className="commit-again" onClick={recommit}>{t('card.recommit')}</button>
          </div>
        )}
      </section>

      {revealed && showHeart && (
        <div className="card-heart">
          <button className="heart-hide" onClick={() => setShowHeart(false)}>{t('card.hideHeart')}</button>
          <HeartView
            strip={strip}
            clock={clock}
            warp={warp}
            blockedBranches={card.mechanism.kind === 'solver' ? blockedFromState(card) : undefined}
          />
          {coachHeart && <p className="heart-coach">{t('card.coachHeart')}</p>}
        </div>
      )}

      {revealed && card.moduleHref && (
        <a href={card.moduleHref.href} onClick={linkClick(card.moduleHref.href)} className="card-module">
          {card.moduleHref.label} →
        </a>
      )}

      {revealed && (
        <>
          {/* ---- 2 · WHY ---- */}
          <section className="card-section">
            <h2 className="sec-title"><span className="sec-num">2</span> {t('card.why')}</h2>
            <ol className="why-lines">
              {card.why.map((w, i) => <li key={i}>{w}</li>)}
            </ol>
            <button className="drawer-toggle" onClick={() => setDrawerOpen((o) => !o)}>
              {drawerOpen ? t('card.close') : t('card.explain')}
            </button>
            {drawerOpen && (
              <div className="why-drawer">
                {card.whyDrawer.map((s, i) => (
                  <div key={i} className="why-step">
                    <div className="why-cause">{s.cause}</div>
                    <div className="why-effect">→ {s.effect}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---- 3 · PEARLS & TRAPS ---- */}
          <section className="card-section">
            <h2 className="sec-title"><span className="sec-num">3</span> {t('card.pills')}</h2>
            <div className="pills">
              {card.pills.map((p, i) => (
                <div key={i} className={`pill pill-${p.kind}`}>
                  <span className="pill-kind">{p.kind === 'night-eye' ? 'night shift' : p.kind}</span>
                  <p>{emph(p.text)}</p>
                  {p.linkCardId && CARD_BY_ID[p.linkCardId] && (
                    <a href={`/c/${p.linkCardId}`} onClick={linkClick(`/c/${p.linkCardId}`)} className="pill-link">
                      → {CARD_BY_ID[p.linkCardId].name}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ---- 4 · SUSPECT & CONFIRM ---- */}
          <section className="card-section">
            <h2 className="sec-title"><span className="sec-num">4</span> {t('card.suspect')}</h2>
            <CitedLines lines={card.suspectConfirm} />
          </section>

          {/* ---- 5 · THE ACTION LAYER (forks by role; everything above is shared) ---- */}
          <section className="card-section">
            <h2 className="sec-title">
              <span className="sec-num">5</span>
              {role === 'rn' ? t('card.movesRn') : t('card.moves')}
              <span className="seg seg-sm role-toggle" role="group" aria-label={t('a11y.audience')}>
                <button className={role === 'md' ? 'on' : ''} onClick={() => setRoleAndSave('md')}>MD</button>
                <button className={role === 'rn' ? 'on' : ''} onClick={() => setRoleAndSave('rn')}>RN</button>
              </span>
            </h2>
            <CitedLines lines={role === 'rn' ? card.rnMoves : card.guidelineMoves} />
            {card.avoid && (
              <div className="avoid-line">
                <span className="avoid-chip">{t('card.avoid')}</span>
                <CitedLines lines={[card.avoid]} />
              </div>
            )}
            <p className="local-protocol">{t('card.localProtocol')}</p>
            <p className="stamp">{t('card.stamp', { date: card.guidelineVerifiedAt })}</p>
          </section>

          <footer className="card-foot">
            <a href="/about" onClick={linkClick('/about')}>{t('card.validate')}</a>
            <span>·</span>
            <span>{t('card.notDiagnosis')}</span>
          </footer>
        </>
      )}

      <div className="playbar">
        <button className="playbar-btn" onClick={clock.toggle} aria-label={clock.isPlaying ? 'Pause' : 'Play'}>
          {clock.isPlaying ? '❚❚' : '▶'}
        </button>
        <button className="playbar-btn playbar-speed num" onClick={cycleSpeed} aria-label={t('a11y.speed')}>
          {clock.speed}×
        </button>
        <div className="playbar-spring" />
        {!revealed && <span className="playbar-hint">scrub the trace · commit below</span>}
        {revealed && (
          <button className="playbar-btn" onClick={() => navigate('/')} aria-label={t('card.library')}>{t('card.library')}</button>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function CitedLines({ lines }: { lines: CitedLine[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  return (
    <>
      <ul className="cited-lines">
        {lines.map((l, i) => (
          <li key={i}>
            {l.text}
            {l.cites.map((k) => (
              <button key={k} className="cite-chip" onClick={() => setOpenKey(openKey === k ? null : k)}>
                {GUIDELINE_BY_KEY[k] ? `${GUIDELINE_BY_KEY[k].org} ${GUIDELINE_BY_KEY[k].year}` : k}
              </button>
            ))}
          </li>
        ))}
      </ul>
      {openKey && GUIDELINE_BY_KEY[openKey] && (
        <div className="cite-sheet">
          <div className="cite-title">{GUIDELINE_BY_KEY[openKey].title}</div>
          <div className="cite-meta">
            {GUIDELINE_BY_KEY[openKey].org} {GUIDELINE_BY_KEY[openKey].year} · scope: {GUIDELINE_BY_KEY[openKey].scope} ·
            verified {GUIDELINE_BY_KEY[openKey].verifiedAt}
          </div>
        </div>
      )}
    </>
  )
}

function blockedFromState(card: Card): StructureId[] {
  const edges = card.mechanism.state?.blockedEdges ?? []
  const blocked: StructureId[] = []
  for (const e of edges) {
    if (e.endsWith('>RBB')) blocked.push('RBB')
    if (e.endsWith('>LBB')) blocked.push('LBB', 'LAF', 'LPF')
    if (e.endsWith('>LAF')) blocked.push('LAF')
    if (e.endsWith('>LPF')) blocked.push('LPF')
  }
  return blocked
}
