/**
 * The Drill: uncued, interleaved retrieval across the whole catalog. A strip
 * appears with NO name — options are card names drawn from the full library
 * (discrimination among all comers, not a card's curated near-neighbors).
 * Misses drop to Leitner box 0 and resurface; four spaced hits make a card
 * 'solid'. This is the retention loop the cards themselves don't provide.
 *
 * Escalating transfer: once a card climbs past Leitner box 1, its reps stop
 * showing the canonical strip and start drawing UNSEEN real recordings of
 * the same class (quizBank) — recognition of the class, not the exemplar.
 * Correct answers on ≥3 distinct real strips mark the card proven-on-real.
 * Sessions run in sets of 10 with a recap; a day with answers extends the
 * streak. All progression is earned retrieval — nothing is decorative.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CARDS, CARD_BY_ID } from '../../content'
import { QUIZ_BY_CARD, QuizFindings } from '../../content/quizBank.gen'
import { useCardiacClock } from '../../lib/clock'
import { loadTrace, TraceData } from '../../lib/assets'
import {
  bumpStreak, currentStreak, dueWithin24h, loadDrill, loadStrips,
  nextDrillCard, progressSummary, recordDrillAnswer, recordStripAnswer,
} from '../../lib/progress'
import { metric } from '../../lib/metrics'
import { emph } from '../../lib/emph'
import { localizeCard } from '../../content/i18n'
import { useLang } from '../../lib/useLang'
import { t } from '../../lib/ui'
import { linkClick } from '../../router'
import TraceView from '../trace/TraceView'
import ProvenanceBadge from '../card/ProvenanceBadge'
import './DrillScreen.css'

export const SESSION_GOAL = 10
const BEST_RUN_KEY = 'run:v1'

/** Does `label` (a commit-option label) refer to card `c`? Name/alias match. */
const labelMatchesCard = (label: string, c: (typeof CARDS)[number]): boolean => {
  const l = label.toLowerCase()
  const name = c.name.toLowerCase()
  if (l.includes(name) || name.includes(l)) return true
  return c.aliases.some((a) => a.length > 2 && (l.includes(a.toLowerCase()) || a.toLowerCase() === l))
}

/**
 * The correct card's own curated confusables: other CARDS that appear as
 * wrong options on its commit question. These carry authored "tempts"
 * reasoning — the drill reuses both the discrimination and the explanation.
 */
const confusablesOf = (correctId: string): string[] => {
  const correct = CARD_BY_ID[correctId]
  const wrongLabels = correct.seeIt.commit.options.filter((o) => !o.correct).map((o) => o.label)
  return CARDS.filter(
    (c) => c.id !== correctId && wrongLabels.some((l) => labelMatchesCard(l, c)),
  ).map((c) => c.id)
}

/**
 * Index of the correct card's option that refers to the picked card — matched
 * on the ENGLISH content so the lookup is stable in any language; the caller
 * renders the localized text at that index.
 */
export const temptIndexFor = (correctId: string, pickedId: string): number => {
  const correct = CARD_BY_ID[correctId]
  const picked = CARD_BY_ID[pickedId]
  return correct.seeIt.commit.options.findIndex((o) => !o.correct && labelMatchesCard(o.label, picked))
}

/** 3 distractors: the card's curated confusables first, then category, then catalog. */
const pickOptions = (correctId: string): string[] => {
  const correct = CARD_BY_ID[correctId]
  const confusables = confusablesOf(correctId).sort(() => Math.random() - 0.5).slice(0, 2)
  const used = new Set([correctId, ...confusables])
  const rest = CARDS.filter((c) => !used.has(c.id))
  const same = rest.filter((c) => c.category === correct.category)
  const other = rest.filter((c) => c.category !== correct.category)
  const fill = [...same.sort(() => Math.random() - 0.5), ...other.sort(() => Math.random() - 0.5)]
  const options = [correctId, ...confusables, ...fill.map((c) => c.id)].slice(0, 4)
  return options.sort(() => Math.random() - 0.5)
}

interface Draw {
  cardId: string
  traceId: string
  options: string[]
  /** Present when the strip is a real recording from the quiz bank. */
  findings?: QuizFindings
}

const draw = (not?: string): Draw => {
  const cardId = nextDrillCard(not)
  const card = CARD_BY_ID[cardId]
  const options = pickOptions(cardId)

  // Escalating transfer: past box 1, prefer an unseen real recording.
  const box = loadDrill()[cardId]?.box ?? 0
  const real = QUIZ_BY_CARD[cardId] ?? []
  if (box >= 2 && real.length) {
    const strips = loadStrips()
    const unseen = real.filter((q) => !strips[q.traceId])
    const pool = unseen.length ? unseen : real
    const pick = pool[Math.floor(Math.random() * pool.length)]
    return { cardId, traceId: pick.traceId, options, findings: pick.f }
  }

  const traces = [card.seeIt.traceId, ...(card.seeIt.extraTraceIds ?? [])]
  return { cardId, traceId: traces[Math.floor(Math.random() * traces.length)], options }
}

/** Clinical shorthand is shared across EN/IT — only the label localizes. */
const findingsLine = (f: QuizFindings): string => {
  const parts = [`${f.rate}/min`, `RR ±${f.rrCv}%`, `QRS ${f.qrs} ms`]
  if (f.pr != null) parts.push(`PR ${f.pr} ms`)
  if (f.qtc != null) parts.push(`QTc ${f.qtc} ms`)
  if (f.stMax) parts.push(`ST ${f.stMax[0]} +${f.stMax[1]} mV`)
  if (f.stMin) parts.push(`ST ${f.stMin[0]} −${Math.abs(f.stMin[1])} mV`)
  if (f.sokolow != null) parts.push(`S·V1+R·V5/6 ${f.sokolow} mV`)
  return parts.join(' · ')
}

/** The session as a rhythm strip: one beat per answer, inverted when wrong. */
function SessionStrip({ log, goal, tall }: { log: boolean[]; goal: number; tall?: boolean }) {
  const w = 300
  const h = tall ? 44 : 26
  const mid = h / 2
  const step = w / goal
  const beats = log.map((right, i) => {
    const x = step * (i + 0.5)
    const amp = right ? -(mid - 4) : mid - 6
    return (
      <path
        key={i}
        d={`M ${x - 7} ${mid} L ${x - 2.5} ${mid} L ${x} ${mid + amp} L ${x + 2.5} ${mid} L ${x + 7} ${mid}`}
        fill="none"
        className={right ? 'sess-beat-right' : 'sess-beat-wrong'}
      />
    )
  })
  return (
    <svg
      className="sess-strip"
      viewBox={`0 0 ${w} ${h}`}
      style={{ height: h }}
      role="img"
      aria-label={`${log.filter(Boolean).length}/${log.length}`}
    >
      <line x1="0" y1={mid} x2={w} y2={mid} className="sess-base" />
      {beats}
    </svg>
  )
}

export default function DrillScreen() {
  const lang = useLang()
  const nameOf = (id: string) => localizeCard(CARD_BY_ID[id], lang).name
  const [current, setCurrent] = useState<Draw>(() => draw())
  const [data, setData] = useState<TraceData | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [log, setLog] = useState<boolean[]>([])
  const [recap, setRecap] = useState(false)
  const [streak, setStreak] = useState(() => currentStreak())
  const progress = useMemo(() => progressSummary(), [picked])

  useEffect(() => {
    let live = true
    setData(null)
    loadTrace(current.traceId).then(
      (d) => { if (live) setData(d) },
      () => { if (live) setCurrent(draw(current.cardId)) }, // missing asset: skip it
    )
    return () => { live = false }
  }, [current])

  const clock = useCardiacClock(data?.durationMs ?? 1000, { autoplay: true })

  const card = useMemo(() => localizeCard(CARD_BY_ID[current.cardId], lang), [current.cardId, lang])
  const answered = picked != null
  const right = picked === current.cardId
  const isReal = current.findings != null

  const answer = (id: string) => {
    if (answered) return
    setPicked(id)
    const isRight = id === current.cardId
    metric('drill', isReal ? `${current.cardId}:${current.traceId}` : current.cardId, isRight ? 1 : 0)
    recordDrillAnswer(current.cardId, isRight)
    if (isReal) recordStripAnswer(current.traceId, isRight)
    setStreak(bumpStreak().days)
    setLog((l) => [...l, isRight])
  }

  const next = useCallback(() => {
    if (log.length >= SESSION_GOAL) { setRecap(true); return }
    setPicked(null)
    setCurrent(draw(current.cardId))
  }, [current.cardId, log.length])

  const again = () => {
    setLog([])
    setRecap(false)
    setPicked(null)
    setCurrent(draw(current.cardId))
  }

  const bestRun = useMemo(() => {
    let run = 0
    let best = 0
    for (const r of log) { run = r ? run + 1 : 0; best = Math.max(best, run) }
    return best
  }, [log])

  useEffect(() => {
    if (!recap) return
    try {
      const prev = Number(localStorage.getItem(BEST_RUN_KEY) ?? 0)
      if (bestRun > prev) localStorage.setItem(BEST_RUN_KEY, String(bestRun))
    } catch { /* private mode */ }
  }, [recap, bestRun])

  const correctOption = card.seeIt.commit.options.find((o) => o.correct)

  if (recap) {
    const score = log.filter(Boolean).length
    return (
      <div className="screen drill">
        <header className="drill-head">
          <a href="/" onClick={linkClick('/')} className="drill-back" aria-label={t('card.back')}>‹</a>
          <h1>{t('drill.title')}</h1>
          <span className="drill-progress num">{t('drill.solid', { solid: progress.solid, total: progress.total })}</span>
        </header>
        <div className="drill-recap">
          <p className="recap-title">{t('drill.sessionDone')}</p>
          <p className="recap-score num">{score}<span className="recap-of">/{SESSION_GOAL}</span></p>
          <SessionStrip log={log} goal={SESSION_GOAL} tall />
          <div className="recap-rows">
            <div className="recap-row"><span>{t('drill.bestRun')}</span><span className="num">{bestRun}</span></div>
            <div className="recap-row"><span>{t('drill.streak')}</span><span className="num">{streak}</span></div>
            <div className="recap-row"><span>{t('drill.due24')}</span><span className="num">{dueWithin24h()}</span></div>
          </div>
          <div className="drill-actions">
            <a href="/" onClick={linkClick('/')} className="drill-open">{t('drill.home')}</a>
            <button className="drill-next" onClick={again}>{t('drill.again')}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen drill">
      <header className="drill-head">
        <a href="/" onClick={linkClick('/')} className="drill-back" aria-label={t('card.back')}>‹</a>
        <h1>{t('drill.title')}</h1>
        <span className="drill-progress num">
          {streak >= 2 ? `${t('drill.streakChip', { n: streak })} · ` : ''}
          {t('drill.solid', { solid: progress.solid, total: progress.total })}
        </span>
      </header>

      {log.length > 0 && <SessionStrip log={log} goal={SESSION_GOAL} />}

      {data ? (
        <TraceView
          data={data}
          leads={[card.mechanism.primaryLead, card.mechanism.primaryLead === 'II' ? 'V1' : 'II']}
          clock={clock}
          onTap={clock.toggle}
          badge={<ProvenanceBadge provenance={data.provenance} />}
          laneHeight={104}
        />
      ) : (
        <div className="drill-loading">{t('drill.loading')}</div>
      )}

      {!answered ? (
        <>
          <p className="drill-prompt">{t('drill.prompt')}</p>
          <div className="drill-options">
            {current.options.map((id) => (
              <button key={id} className="drill-option" onClick={() => answer(id)}>
                {nameOf(id)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="drill-result">
          {right ? (
            <p className="drill-verdict drill-right">✓ {nameOf(card.id)}</p>
          ) : (
            <>
              <p className="drill-verdict drill-wrong">✕ {t('card.youRead')} {nameOf(picked!)}</p>
              {(() => {
                const i = temptIndexFor(current.cardId, picked!)
                return i >= 0
                  ? <p className="drill-contrast"><span className="drill-contrast-label">{t('drill.whyTempted')}</span> {emph(card.seeIt.commit.options[i].tempts)}</p>
                  : <p className="drill-contrast"><span className="drill-contrast-label">{nameOf(picked!)}:</span> {localizeCard(CARD_BY_ID[picked!], lang).tagline}</p>
              })()}
              <p className="drill-verdict drill-right">✓ {nameOf(card.id)}</p>
            </>
          )}
          {current.findings && (
            <p className="drill-measured">
              <span className="drill-measured-label">{t('drill.measured')}</span> {findingsLine(current.findings)}
            </p>
          )}
          {correctOption && <p className="drill-tempts">{emph(correctOption.tempts)}</p>}
          {!right && <p className="drill-requeue">{t('drill.missed')}</p>}
          <div className="drill-actions">
            <a href={`/c/${card.id}`} onClick={linkClick(`/c/${card.id}`)} className="drill-open">
              {t('drill.open')}
            </a>
            <button className="drill-next" onClick={next}>
              {log.length >= SESSION_GOAL ? t('drill.finish') : t('drill.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
