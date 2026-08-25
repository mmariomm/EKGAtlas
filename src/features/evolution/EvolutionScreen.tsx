/**
 * Occlusion over TIME — the axis the single-strip cards can't show. Two arcs
 * of one story: the artery CLOSING (hyperacute T → STE → Q → T inversion) and
 * the artery REOPENING (Wellens: pain gone, T waves telling on the stunned
 * wall — and pseudonormalization when it re-closes). Honesty-labeled as ONE
 * possible trajectory: real infarcts move at their own pace, and reperfusion
 * can stop or reverse the first arc at any point.
 */
import { useMemo, useState } from 'react'
import { omiEvolutionStrip, omiFrame, wellensEvolutionStrip, wellensFrame } from '../../content/mechanisms'
import { buildSignals, samplePhase } from '../../engine/synthesize'
import { useCardiacClock } from '../../lib/clock'
import { signalsToTraceData } from '../../lib/assets'
import { linkClick } from '../../router'
import { metric } from '../../lib/metrics'
import TraceView from '../trace/TraceView'
import ProvenanceBadge from '../card/ProvenanceBadge'
import './EvolutionScreen.css'

type Arc = 'occlusion' | 'reperfusion'

const STAGES: Record<Arc, { x: number; label: string }[]> = {
  occlusion: [
    { x: 0, label: 'Baseline' },
    { x: 0.25, label: 'Hyperacute T' },
    { x: 0.5, label: 'ST elevation' },
    { x: 0.75, label: 'Peak + Q' },
    { x: 1, label: 'Q + T inversion' },
  ],
  reperfusion: [
    { x: 0, label: 'Occluded' },
    { x: 0.25, label: 'Reopened' },
    { x: 0.5, label: 'Biphasic (A)' },
    { x: 0.75, label: 'Deep inversion (B)' },
    { x: 1, label: 'Pseudonormal ⚠' },
  ],
}

const TAKEAWAYS: Record<Arc, { title: string; lines: [string, string][]; closing: string }> = {
  occlusion: {
    title: 'What to take from it',
    lines: [
      ['The hyperacute T is the earliest catch', '— bulky and out of proportion to its QRS, before any elevation exists.'],
      ['Waiting for the millimeters is waiting for necrosis.', 'The Q wave in frame four is muscle that is already gone.'],
      ['One ECG is one frame of a film.', 'If the story is right and the first trace is not, repeat it in 10–15 minutes and compare.'],
      ['Reperfusion rewrites the ending', '— open the artery early and the trace never reaches frames four and five.'],
    ],
    closing: 'One possible trajectory. Real infarcts vary in speed, shape and order; this is a teaching model, not a clock you can read a patient against.',
  },
  reperfusion: {
    title: 'What to take from it',
    lines: [
      ['The pain is gone but the T waves are talking', '— the stunned wall repolarizes backwards while the patient feels fine.'],
      ['Biphasic (type A) often deepens into type B.', 'Both mean the same artery: a critical LAD that opened on its own.'],
      ['This ECG forbids a stress test.', 'The lesion is still there — provoking demand can close it again.'],
      ['Pseudonormalization is the alarm, not recovery', '— inverted Ts turning upright during recurrent pain mean the artery is re-closing.'],
    ],
    closing: 'One possible trajectory — the classic arc after spontaneous reperfusion of a critical LAD lesion (Wellens). Timing varies by patient.',
  },
}

export default function EvolutionScreen() {
  const [arc, setArc] = useState<Arc>('occlusion')
  const [x, setX] = useState(0.25)
  const strip = useMemo(
    () => (arc === 'occlusion' ? omiEvolutionStrip(x) : wellensEvolutionStrip(x)),
    [arc, x],
  )
  const label = arc === 'occlusion' ? omiFrame(x).label : wellensFrame(x).label
  const data = useMemo(
    () =>
      signalsToTraceData(`evo-${arc}`, buildSignals(strip), {
        tier: 'modeled',
        modelNote: 'Synthesized evolution — one possible trajectory, not a clock',
      }),
    [strip, arc],
  )
  const clock = useCardiacClock(data.durationMs, { autoplay: true })
  const take = TAKEAWAYS[arc]

  return (
    <div className="screen evo">
      <header className="evo-head">
        <a href="/" onClick={linkClick('/')} className="evo-back" aria-label="Back to library">‹</a>
        <h1>Occlusion over time</h1>
        <a
          href={arc === 'occlusion' ? '/c/omi-anterior' : '/c/wellens'}
          onClick={linkClick(arc === 'occlusion' ? '/c/omi-anterior' : '/c/wellens')}
          className="evo-cardlink"
        >
          the card →
        </a>
      </header>

      <div className="evo-arcs" role="group" aria-label="Trajectory">
        <button className={arc === 'occlusion' ? 'on' : ''} onClick={() => { setArc('occlusion'); setX(0.25) }}>
          Artery closing
        </button>
        <button className={arc === 'reperfusion' ? 'on' : ''} onClick={() => { setArc('reperfusion'); setX(0.5) }}>
          Artery reopening (Wellens)
        </button>
      </div>

      <p className="evo-lede">
        {arc === 'occlusion'
          ? 'The same anterior wall, minutes to hours apart. Most of what kills is missed in the first two frames.'
          : 'The artery opened on its own — the pain stopped. The T waves spend the next days confessing what happened.'}
      </p>

      <TraceView
        data={data}
        leads={['V2', 'V3', 'III']}
        clock={clock}
        toneAt={(t) => samplePhase(strip, t).tone}
        onTap={clock.toggle}
        badge={<ProvenanceBadge provenance={data.provenance} />}
        laneHeight={92}
      />

      <p className="evo-stage">{label}</p>

      <label className="evo-sliderrow">
        <span className="visually-hidden">Trajectory position</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={x}
          onChange={(e) => { metric('manipulate'); setX(Number(e.target.value)) }}
          className="evo-slider"
          aria-label="Scrub the trajectory"
        />
      </label>
      <div className="evo-stages">
        {STAGES[arc].map((s) => (
          <button key={s.label} className={`evo-stagechip ${Math.abs(x - s.x) < 0.13 ? 'on' : ''}`} onClick={() => setX(s.x)}>
            {s.label}
          </button>
        ))}
      </div>

      <section className="evo-sec">
        <h2>{take.title}</h2>
        <ul className="evo-lines">
          {take.lines.map(([b, rest], i) => (
            <li key={i}><b>{b}</b> {rest}</li>
          ))}
        </ul>
        <p className="evo-honesty">{take.closing}</p>
      </section>
    </div>
  )
}
