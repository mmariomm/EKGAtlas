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
import { linkClick } from '../../router'
import TraceView from '../trace/TraceView'
import ProvenanceBadge from '../card/ProvenanceBadge'
import './DrillScreen.css'

/** 3 distractor card names: same-category first, then lethal confusables. */
const pickOptions = (correctId: string): string[] => {
  const correct = CARD_BY_ID[correctId]
  const rest = CARDS.filter((c) => c.id !== correctId)
  const same = rest.filter((c) => c.category === correct.category)
  const other = rest.filter((c) => c.category !== correct.category)
  const shuffled = [...same.sort(() => Math.random() - 0.5), ...other.sort(() => Math.random() - 0.5)]
  const options = [correctId, ...shuffled.slice(0, 3).map((c) => c.id)]
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

  const card = CARD_BY_ID[current.cardId]
  const answered = picked != null
  const right = picked === current.cardId

  const answer = (id: string) => {
    if (answered) return
    metric('commit', `drill:${current.cardId}`)
    setPicked(id)
    const isRight = id === current.cardId
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
        <a href="/" onClick={linkClick('/')} className="drill-back" aria-label="Back to library">‹</a>
        <h1>Drill</h1>
        <span className="drill-progress num">
          {sessionTotal > 0 ? `${sessionRight}/${sessionTotal} · ` : ''}{progress.solid}/{progress.total} solid
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
        <div className="drill-loading">loading strip…</div>
      )}

      {!answered ? (
        <>
          <p className="drill-prompt">Your read?</p>
          <div className="drill-options">
            {current.options.map((id) => (
              <button key={id} className="drill-option" onClick={() => answer(id)}>
                {CARD_BY_ID[id].name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="drill-result">
          {right ? (
            <p className="drill-verdict drill-right">✓ {card.name}</p>
          ) : (
            <>
              <p className="drill-verdict drill-wrong">✕ You read: {CARD_BY_ID[picked!].name}</p>
              <p className="drill-verdict drill-right">✓ {card.name}</p>
            </>
          )}
          {correctOption && <p className="drill-tempts">{correctOption.tempts}</p>}
          {!right && <p className="drill-requeue">Missed — it comes back until it’s yours.</p>}
          <div className="drill-actions">
            <a href={`/c/${card.id}`} onClick={linkClick(`/c/${card.id}`)} className="drill-open">
              open the card →
            </a>
            <button className="drill-next" onClick={next}>Next strip</button>
          </div>
        </div>
      )}
    </div>
  )
}
