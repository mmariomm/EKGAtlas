/**
 * The rounds-pack player: 4–6 items in ~60 seconds. Each card item runs that
 * card's SEE IT commit plus its strongest pill; lab items are full-screen
 * links into the lab preset. Presenter mode (?mode=presenter) reveals first —
 * the rounds-demo surface — with a visible watermark keeping the commit norm
 * honest.
 */
import { useEffect, useMemo, useState } from 'react'
import { CARD_BY_ID, PACK_BY_ID } from '../../content'
import { buildMechanismStrip } from '../../content/mechanisms'
import { buildWarp, modelFiducials } from '../../engine/sync'
import { samplePhase } from '../../engine/synthesize'
import { useCardiacClock } from '../../lib/clock'
import { loadTrace, TraceData } from '../../lib/assets'
import { linkClick, navigate } from '../../router'
import TraceView from '../trace/TraceView'
import ProvenanceBadge from '../card/ProvenanceBadge'
import './PackScreen.css'

export default function PackScreen({ packId }: { packId: string }) {
  const pack = PACK_BY_ID[packId]
  const presenter = useMemo(
    () => new URLSearchParams(window.location.search).get('mode') === 'presenter',
    [],
  )
  const [index, setIndex] = useState(() => {
    const i = Number(new URLSearchParams(window.location.search).get('i'))
    return Number.isFinite(i) && i > 0 ? Math.min(i, (pack?.items.length ?? 1) - 1) : 0
  })

  useEffect(() => {
    const url = new URL(window.location.href)
    if (index > 0) url.searchParams.set('i', String(index))
    else url.searchParams.delete('i')
    window.history.replaceState(null, '', url)
  }, [index])

  if (!pack) {
    return (
      <div className="screen pack-missing">
        <p>No pack called “{packId}”.</p>
        <a href="/" onClick={linkClick('/')}>Back to the library</a>
      </div>
    )
  }

  const item = pack.items[index]
  const next = () => {
    if (index < pack.items.length - 1) setIndex(index + 1)
    else navigate('/')
  }

  return (
    <div className="screen pack">
      <header className="pack-head">
        <a href="/" onClick={linkClick('/')} className="pack-back" aria-label="Back to library">‹</a>
        <div className="pack-title">
          {pack.title}
          <span className="pack-progress num"> {index + 1}/{pack.items.length}</span>
        </div>
        {presenter && <span className="pack-watermark">presenting</span>}
      </header>

      {'cardId' in item ? (
        <PackCardItem
          key={item.cardId}
          cardId={item.cardId}
          pillIndex={item.pillIndex}
          presenter={presenter}
          onNext={next}
          last={index === pack.items.length - 1}
        />
      ) : (
        <div className="pack-lab">
          <p className="pack-labtitle">{item.title}</p>
          <a href={item.labHref} onClick={linkClick(item.labHref)} className="pack-labgo">
            Open the lab →
          </a>
          <button className="pack-next" onClick={next}>
            {index === pack.items.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      )}
    </div>
  )
}

function PackCardItem({
  cardId, pillIndex, presenter, onNext, last,
}: {
  cardId: string
  pillIndex?: number
  presenter: boolean
  onNext: () => void
  last: boolean
}) {
  const card = CARD_BY_ID[cardId]
  const [data, setData] = useState<TraceData | null>(null)
  const [committed, setCommitted] = useState<number | null>(presenter ? -1 : null)
  const revealed = committed != null

  useEffect(() => { loadTrace(card.seeIt.traceId).then(setData).catch(() => {}) }, [card])

  const strip = useMemo(() => buildMechanismStrip(card.mechanism), [card])
  const warp = useMemo(() => {
    if (!data) return (t: number) => t
    return buildWarp(data.annotation, modelFiducials(strip), data.durationMs, strip.durationMs)
  }, [data, strip])
  const clock = useCardiacClock(data?.durationMs ?? 1000, { autoplay: true })

  const correctIdx = card.seeIt.commit.options.findIndex((o) => o.correct)
  const pill = card.pills[pillIndex ?? 0] ?? card.pills[0]

  return (
    <div className="packitem">
      {data && (
        <TraceView
          data={data}
          leads={[card.mechanism.primaryLead]}
          clock={clock}
          toneAt={(t) => samplePhase(strip, warp(t)).tone}
          onTap={clock.toggle}
          badge={<ProvenanceBadge provenance={data.provenance} />}
          laneHeight={150}
        />
      )}

      {!revealed ? (
        <>
          <p className="packitem-prompt">{card.seeIt.commit.prompt}</p>
          <div className="packitem-options">
            {card.seeIt.commit.options.map((o, i) => (
              <button key={i} className="packitem-option" onClick={() => setCommitted(i)}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="packitem-reveal">
          <p className="packitem-name">
            {committed !== -1 && (
              <span className={committed === correctIdx ? 'pi-right' : 'pi-wrong'}>
                {committed === correctIdx ? '✓ ' : '✕ '}
              </span>
            )}
            {card.name}
          </p>
          <div className={`packitem-pill pill-${pill.kind}`}>
            <span className="pill-kind">{pill.kind === 'night-eye' ? 'night shift' : pill.kind}</span>
            <p>{pill.text}</p>
          </div>
          <a href={`/c/${card.id}`} onClick={linkClick(`/c/${card.id}`)} className="packitem-open">
            open the full card →
          </a>
          <button className="pack-next" onClick={onNext}>{last ? 'Finish' : 'Next'}</button>
        </div>
      )}
    </div>
  )
}
