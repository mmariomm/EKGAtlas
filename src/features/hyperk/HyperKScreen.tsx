/**
 * The HyperK module: (1) the morph — honesty-labeled "one possible
 * trajectory"; (2) the variance gallery + estimate-the-K commit game — five
 * patients around the same potassium, five different shadows; (3) the
 * trigger-pattern close. The whole module exists to teach variance: the ECG
 * can never rule hyperkalemia out.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  CLOSING_LESSON, GALLERY, GALLERY_BANNER, K_BANDS, MORPH_LABEL, MORPH_SUB, TRIGGER_LINE,
} from '../../content/labHyperk'
import { hyperkStrip } from '../../content/mechanisms'
import { buildSignals, samplePhase } from '../../engine/synthesize'
import { useCardiacClock } from '../../lib/clock'
import { loadTrace, signalsToTraceData, TraceData } from '../../lib/assets'
import { linkClick } from '../../router'
import TraceView from '../trace/TraceView'
import ProvenanceBadge from '../card/ProvenanceBadge'
import { metric } from '../../lib/metrics'
import './HyperKScreen.css'

export default function HyperKScreen() {
  const [x, setX] = useState(0.25)
  // Calibration: the module's point is that all five are dangerous — the
  // learner's own under-call count is the lesson, not the per-tile verdict.
  const [picks, setPicks] = useState<Record<string, string>>({})

  const morphStrip = useMemo(() => hyperkStrip(x), [x])
  const morphData = useMemo(
    () =>
      signalsToTraceData('hyperk-morph', buildSignals(morphStrip), {
        tier: 'modeled',
        modelNote: 'Synthesized morph — one possible trajectory, not a K→ECG dial',
      }),
    [morphStrip],
  )
  const clock = useCardiacClock(morphData.durationMs, { autoplay: true })

  return (
    <div className="screen hyperk">
      <header className="hk-head">
        <a href="/" onClick={linkClick('/')} className="hk-back" aria-label="Back to library">‹</a>
        <h1>HyperK Lab</h1>
        <a href="/c/hyperk" onClick={linkClick('/c/hyperk')} className="hk-cardlink">the card →</a>
      </header>

      {/* ---- 1 · the morph ---- */}
      <section className="hk-sec">
        <h2>Watch it evolve</h2>
        <p className="hk-morphlabel">{MORPH_LABEL}</p>
        <TraceView
          data={morphData}
          leads={['II', 'V2']}
          clock={clock}
          toneAt={(t) => samplePhase(morphStrip, t).tone}
          onTap={clock.toggle}
          badge={<ProvenanceBadge provenance={morphData.provenance} />}
          laneHeight={92}
        />
        <label className="hk-sliderrow">
          <span className="visually-hidden">Trajectory position</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={x}
            onChange={(e) => { metric('manipulate'); setX(Number(e.target.value)) }}
            className="hk-slider"
            aria-label="Morph the trajectory: tented T toward sine wave"
          />
        </label>
        <div className="hk-sliderlegend">
          {['subtle', 'tented T', 'P fades', 'QRS widens', 'sine'].map((label, i) => (
            <span key={label} className={Math.round(x * 4) === i ? 'on' : ''}>{label}</span>
          ))}
        </div>
        <p className="hk-sub">{MORPH_SUB}</p>
      </section>

      {/* ---- 2 · the variance gallery / estimate-the-K game ---- */}
      <section className="hk-sec">
        <h2>Estimate the K</h2>
        <p className="hk-banner">{GALLERY_BANNER}</p>
        <p className="hk-sub">Five patients. Commit a potassium for each — then look at the numbers.</p>
        <div className="hk-gallery">
          {GALLERY.map((slot, i) => (
            <GalleryItem
              key={slot.traceId}
              index={i}
              slot={slot}
              picked={picks[slot.traceId] ?? null}
              onPick={(b) => setPicks((p) => ({ ...p, [slot.traceId]: b }))}
            />
          ))}
        </div>
        <Calibration picks={picks} />
      </section>

      {/* ---- 3 · the close ---- */}
      <section className="hk-sec hk-close">
        <p className="hk-trigger">{TRIGGER_LINE}</p>
        <p className="hk-sub">{CLOSING_LESSON}</p>
        <a href="/c/hyperk?s=5" onClick={linkClick('/c/hyperk')} className="hk-moves">
          The guideline moves live on the card →
        </a>
      </section>
    </div>
  )
}

function Calibration({ picks }: { picks: Record<string, string> }) {
  const done = GALLERY.filter((s) => picks[s.traceId])
  if (done.length < GALLERY.length) {
    return <p className="hk-tally hk-tally-wait">{done.length}/{GALLERY.length} committed — the tally lands when all five are in.</p>
  }
  // Every patient in this gallery is genuinely ≥6.5: any lower guess is an under-call.
  const under = done.filter((s) => picks[s.traceId] !== '≥6.5').length
  return (
    <p className="hk-tally">
      {under === 0
        ? 'All five called ≥6.5 — correct: every one of these patients is dangerously hyperkalemic, however ordinary the trace looks.'
        : `You under-called ${under} of ${GALLERY.length}. Every patient here is ≥6.5 — that gap is exactly why the ECG can never rule hyperkalemia out.`}
    </p>
  )
}

function GalleryItem({ index, slot, picked, onPick }: {
  index: number
  slot: (typeof GALLERY)[number]
  picked: string | null
  onPick: (band: string) => void
}) {
  const [data, setData] = useState<TraceData | null>(null)
  const clock = useCardiacClock(data?.durationMs ?? 1000, { autoplay: true })
  useEffect(() => { loadTrace(slot.traceId).then(setData).catch(() => {}) }, [slot.traceId])

  return (
    <div className="hk-item">
      <div className="hk-itemhead">Patient {index + 1}</div>
      {data && (
        <TraceView
          data={data}
          leads={['II']}
          clock={clock}
          onTap={clock.toggle}
          badge={<ProvenanceBadge provenance={data.provenance} />}
          laneHeight={84}
        />
      )}
      {!picked ? (
        <div className="hk-chips">
          <span className="hk-chiplabel">K⁺?</span>
          {K_BANDS.map((b) => (
            <button key={b} className="hk-chip num" onClick={() => onPick(b)}>{b}</button>
          ))}
        </div>
      ) : (
        <div className="hk-reveal">
          <span className={`hk-k num ${picked === slot.band ? 'hk-k-right' : 'hk-k-wrong'}`}>
            K {slot.k}
          </span>
          <p>{slot.reveal}</p>
        </div>
      )}
    </div>
  )
}
