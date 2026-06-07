import { useEffect, useMemo, useState } from 'react'
import { CONDITION_BY_ID, DEFAULT_CONDITION_ID } from './conditions'
import { buildSignals, meanQrsAxisDeg } from './engine/synthesize'
import { ALL_LEADS, LeadId, LIMB_LEADS } from './engine/leads'
import { clamp } from './engine/vectorMath'
import { useCardiacClock } from './hooks/useCardiacClock'
import ConditionPicker from './components/ConditionPicker'
import HeartDiagram from './components/HeartDiagram'
import TraceCanvas from './components/TraceCanvas'
import PhaseNarration from './components/PhaseNarration'
import LeadSelector from './components/LeadSelector'
import PlaybackControls from './components/PlaybackControls'
import ExplainPanel from './components/ExplainPanel'
import './App.css'

/** Read an initial condition, lead montage, and optional frozen time from the URL. */
const parseInitial = (): {
  conditionId: string
  leads: LeadId[]
  startFraction: number
  autoplay: boolean
} => {
  const p = new URLSearchParams(window.location.search)
  const c = p.get('c')
  const conditionId = c && CONDITION_BY_ID[c] ? c : DEFAULT_CONDITION_ID

  let leads: LeadId[] = ['II']
  const raw = p.get('leads')
  if (raw === '12' || raw === 'all') leads = ALL_LEADS
  else if (raw === 'limb') leads = LIMB_LEADS
  else if (raw) {
    const wanted = raw.split(',').map((s) => s.trim())
    const valid = ALL_LEADS.filter((l) => wanted.includes(l))
    if (valid.length) leads = valid
  }

  // ?t=0..1 freezes the view at that fraction of the loop (paused) — shareable moment.
  const tn = Number(p.get('t'))
  const hasT = p.get('t') != null && Number.isFinite(tn)
  return {
    conditionId,
    leads,
    startFraction: hasT ? clamp(tn, 0, 1) : 0,
    autoplay: !hasT,
  }
}

export default function App() {
  const initial = useMemo(parseInitial, [])
  const [conditionId, setConditionId] = useState(initial.conditionId)
  const condition = CONDITION_BY_ID[conditionId]

  const strip = useMemo(() => condition.buildStrip(), [conditionId, condition])
  const signals = useMemo(() => buildSignals(strip), [strip])
  const meanAxis = useMemo(() => meanQrsAxisDeg(strip), [strip])

  const [leads, setLeads] = useState<LeadId[]>(initial.leads)
  const clock = useCardiacClock(strip.durationMs, {
    startFraction: initial.startFraction,
    autoplay: initial.autoplay,
  })

  // Keep the URL in sync so the current view can be copied/shared.
  useEffect(() => {
    const p = new URLSearchParams()
    if (conditionId !== DEFAULT_CONDITION_ID) p.set('c', conditionId)
    if (!(leads.length === 1 && leads[0] === 'II')) {
      p.set('leads', leads.length === ALL_LEADS.length ? '12' : leads.join(','))
    }
    const qs = p.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [conditionId, leads])

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar-inner">
          <div className="brand" aria-hidden>
            <svg viewBox="0 0 40 24" width="34" height="20">
              <path
                d="M1 12 H10 L13 5 L17 19 L21 9 L24 14 H39"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="brand-name">EKG&nbsp;Atlas</span>
          </div>
          <ConditionPicker current={condition} onSelect={setConditionId} />
        </div>
      </header>

      <main className="stage">
        <div className="stage-inner">
          <div className="cond-head">
            <h1 className="cond-title">{condition.name}</h1>
            <p className="cond-tagline">{condition.tagline}</p>
          </div>

          <section className="card heart-card">
            <PhaseNarration strip={strip} clock={clock} />
            <HeartDiagram strip={strip} condition={condition} clock={clock} />
            <div className="story">{condition.story}</div>
          </section>

          <section className="card trace-card">
            <LeadSelector leads={leads} onChange={setLeads} />
            <TraceCanvas signals={signals} strip={strip} clock={clock} leads={leads} />
          </section>

          <section className="card">
            <ExplainPanel condition={condition} meanAxis={meanAxis} />
          </section>

          <div className="disclaimer">
            Educational model — waveforms are synthesized for teaching, not for clinical diagnosis.
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <PlaybackControls clock={clock} />
        </div>
      </footer>
    </div>
  )
}
