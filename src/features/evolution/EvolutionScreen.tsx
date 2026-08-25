/**
 * Occlusion over TIME — the axis the single-strip cards can't show. Scrub the
 * trajectory and watch one artery's story: hyperacute T → ST elevation →
 * Q waves → terminal T inversion. Honesty-labeled as ONE possible trajectory:
 * real infarcts move at their own pace, and reperfusion can stop or reverse
 * this at any point.
 */
import { useMemo, useState } from 'react'
import { omiEvolutionStrip, omiFrame } from '../../content/mechanisms'
import { buildSignals, samplePhase } from '../../engine/synthesize'
import { useCardiacClock } from '../../lib/clock'
import { signalsToTraceData } from '../../lib/assets'
import { linkClick } from '../../router'
import { metric } from '../../lib/metrics'
import TraceView from '../trace/TraceView'
import ProvenanceBadge from '../card/ProvenanceBadge'
import './EvolutionScreen.css'

const STAGES = [
  { x: 0, label: 'Baseline' },
  { x: 0.25, label: 'Hyperacute T' },
  { x: 0.5, label: 'ST elevation' },
  { x: 0.75, label: 'Peak + Q' },
  { x: 1, label: 'Q + T inversion' },
]

export default function EvolutionScreen() {
  const [x, setX] = useState(0.25)
  const strip = useMemo(() => omiEvolutionStrip(x), [x])
  const frame = omiFrame(x)
  const data = useMemo(
    () =>
      signalsToTraceData('omi-evolution', buildSignals(strip), {
        tier: 'modeled',
        modelNote: 'Synthesized evolution — one possible trajectory, not a clock',
      }),
    [strip],
  )
  const clock = useCardiacClock(data.durationMs, { autoplay: true })

  return (
    <div className="screen evo">
      <header className="evo-head">
        <a href="/" onClick={linkClick('/')} className="evo-back" aria-label="Back to library">‹</a>
        <h1>Occlusion over time</h1>
        <a href="/c/omi-anterior" onClick={linkClick('/c/omi-anterior')} className="evo-cardlink">the card →</a>
      </header>

      <p className="evo-lede">
        The same anterior wall, the same patient — minutes to hours apart. Most
        of what kills is missed in the first two frames.
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

      <p className="evo-stage">{frame.label}</p>

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
          aria-label="Scrub the infarct trajectory"
        />
      </label>
      <div className="evo-stages">
        {STAGES.map((s) => (
          <button key={s.label} className={`evo-stagechip ${Math.abs(x - s.x) < 0.13 ? 'on' : ''}`} onClick={() => setX(s.x)}>
            {s.label}
          </button>
        ))}
      </div>

      <section className="evo-sec">
        <h2>What to take from it</h2>
        <ul className="evo-lines">
          <li><b>The hyperacute T is the earliest catch</b> — bulky and out of proportion to its QRS, before any elevation exists.</li>
          <li><b>Waiting for the millimeters is waiting for necrosis.</b> The Q wave in frame four is muscle that is already gone.</li>
          <li><b>One ECG is one frame of a film.</b> If the story is right and the first trace is not, repeat it in 10–15 minutes and compare.</li>
          <li><b>Reperfusion rewrites the ending</b> — open the artery early and the trace never reaches frames four and five.</li>
        </ul>
        <p className="evo-honesty">
          One possible trajectory. Real infarcts vary in speed, shape and order;
          this is a teaching model, not a clock you can read a patient against.
        </p>
      </section>
    </div>
  )
}
