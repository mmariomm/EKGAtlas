/**
 * The Drill: uncued, interleaved retrieval across the whole catalog. A strip
 * appears with NO name — options are card names drawn from the full library
 * (discrimination among all comers, not a card's curated near-neighbors).
 * Misses drop to Leitner box 0 and resurface; four spaced hits make a card
 * 'solid'. This is the retention loop the cards themselves don't provide.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CARDS, CARD_BY_ID } from '../../content'
import { useCardiacClock } from '../../lib/clock'
import { loadTrace, TraceData } from '../../lib/assets'
import { nextDrillCard, progressSummary, recordDrillAnswer } from '../../lib/progress'
import { metric } from '../../lib/metrics'
import { emph } from '../../lib/emph'
import { localizeCard } from '../../content/i18n'
import { useLang } from '../../lib/useLang'
import { t } from '../../lib/ui'
import { linkClick } from '../../router'
import TraceView from '../trace/TraceView'
import ProvenanceBadge from '../card/ProvenanceBadge'
import './DrillScreen.css'

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
}

const draw = (not?: string): Draw => {
  const cardId = nextDrillCard(not)
  const card = CARD_BY_ID[cardId]
  const traces = [card.seeIt.traceId, ...(card.seeIt.extraTraceIds ?? [])]
  return {
    cardId,
    traceId: traces[Math.floor(Math.random() * traces.length)],
    options: pickOptions(cardId),
  }
}

export default function DrillScreen() {
  const lang = useLang()
  const nameOf = (id: string) => localizeCard(CARD_BY_ID[id], lang).name
  const [current, setCurrent] = useState<Draw>(() => draw())
  const [data, setData] = useState<TraceData | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [sessionRight, setSessionRight] = useState(0)
  const [sessionTotal, setSessionTotal] = useState(0)
  const progress = useMemo(() => progressSummary(), [picked])

  useEffect(() => {
    let live = true
    setData(null)
    loadTrace(current.traceId).then((d) => { if (live) setData(d) }, () => {})
    return () => { live = false }
  }, [current.traceId])

  const clock = useCardiacClock(data?.durationMs ?? 1000, { autoplay: true })

  const card = useMemo(() => localizeCard(CARD_BY_ID[current.cardId], lang), [current.cardId, lang])
  const answered = picked != null
  const right = picked === current.cardId

  const answer = (id: string) => {
    if (answered) return
    setPicked(id)
    const isRight = id === current.cardId
    metric('drill', current.cardId, isRight ? 1 : 0)
    recordDrillAnswer(current.cardId, isRight)
    setSessionRight((r) => r + (isRight ? 1 : 0))
    setSessionTotal((t) => t + 1)
  }

  const next = useCallback(() => {
    setPicked(null)
    setCurrent(draw(current.cardId))
  }, [current.cardId])

  const correctOption = card.seeIt.commit.options.find((o) => o.correct)

  return (
    <div className="screen drill">
      <header className="drill-head">
        <a href="/" onClick={linkClick('/')} className="drill-back" aria-label={t('card.back')}>‹</a>
        <h1>{t('drill.title')}</h1>
        <span className="drill-progress num" key={sessionTotal}>
          {sessionTotal > 0 ? `${sessionRight}/${sessionTotal} · ` : ''}{t('drill.solid', { solid: progress.solid, total: progress.total })}
        </span>
      </header>

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
          {correctOption && <p className="drill-tempts">{emph(correctOption.tempts)}</p>}
          {!right && <p className="drill-requeue">{t('drill.missed')}</p>}
          <div className="drill-actions">
            <a href={`/c/${card.id}`} onClick={linkClick(`/c/${card.id}`)} className="drill-open">
              {t('drill.open')}
            </a>
            <button className="drill-next" onClick={next}>{t('drill.next')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
