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
import './HyperKScreen.css'

export default function HyperKScreen() {
  const [x, setX] = useState(0.25)

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
        <h1>HyperK Module</h1>
        <a href="/c/hyperk" onClick={linkClick('/c/hyperk')} className="hk-cardlink">the card →</a>
      </header>

      {/* ---- 1 · the morph ---- */}
      <section className="hk-sec">
        <h2>One possible trajectory</h2>
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
            onChange={(e) => setX(Number(e.target.value))}
            className="hk-slider"
            aria-label="Morph the trajectory: tented T toward sine wave"
          />
        </label>
        <div className="hk-sliderlegend">
          <span>subtle</span><span>tented T</span><span>P fades</span><span>QRS widens</span><span>sine</span>
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
            <GalleryItem key={slot.traceId} index={i} slot={slot} />
          ))}
        </div>
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

function GalleryItem({ index, slot }: { index: number; slot: (typeof GALLERY)[number] }) {
  const [data, setData] = useState<TraceData | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
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
            <button key={b} className="hk-chip num" onClick={() => setPicked(b)}>{b}</button>
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
