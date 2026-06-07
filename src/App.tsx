import { useCallback, useEffect, useMemo, useState } from 'react'
import { CONDITION_BY_ID, DEFAULT_CONDITION_ID } from './conditions'
import { beatAt, buildSignals, meanQrsAxisDeg } from './engine/synthesize'
import { ALL_LEADS, LeadId, LIMB_LEADS } from './engine/leads'
import { clamp } from './engine/vectorMath'
import {
  isSegmentId, phaseRegions, regionAtRelTime, representativeOnset, SegmentId,
} from './engine/phases'
import { useCardiacClock } from './hooks/useCardiacClock'
import ConditionPicker from './components/ConditionPicker'
import HeartDiagram from './components/HeartDiagram'
import TraceCanvas from './components/TraceCanvas'
import PhaseNarration from './components/PhaseNarration'
import PhaseChips from './components/PhaseChips'
import LeadSelector from './components/LeadSelector'
import PlaybackControls from './components/PlaybackControls'
import ExplainPanel from './components/ExplainPanel'
import './App.css'

interface Selection {
  id: SegmentId
  /** Onset of the beat this selection is anchored to (for the trace band). */
  beatOnset: number
}

/** Read an initial condition, leads, frozen time, and selected segment from the URL. */
const parseInitial = () => {
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

  const tn = Number(p.get('t'))
  const hasT = p.get('t') != null && Number.isFinite(tn)
  const selParam = p.get('sel')
  return {
    conditionId,
    leads,
    tFraction: hasT ? clamp(tn, 0, 1) : null,
    sel: isSegmentId(selParam) ? selParam : null,
  }
}

export default function App() {
  const initial = useMemo(parseInitial, [])
  const [conditionId, setConditionId] = useState(initial.conditionId)
  const condition = CONDITION_BY_ID[conditionId]

  const strip = useMemo(() => condition.buildStrip(), [conditionId, condition])
  const signals = useMemo(() => buildSignals(strip), [strip])
  const meanAxis = useMemo(() => meanQrsAxisDeg(strip), [strip])
  const regions = useMemo(() => phaseRegions(strip), [strip])
  const repOnset = useMemo(() => representativeOnset(strip), [strip])

  // Resolve an initial selection (?sel=) → freeze the clock at that phase.
  const initialRegion = initial.sel ? regions.find((r) => r.id === initial.sel) ?? null : null
  const startFraction = initialRegion
    ? (repOnset + initialRegion.mid) / strip.durationMs
    : initial.tFraction ?? 0
  const autoplay = !initialRegion && initial.tFraction == null

  const [leads, setLeads] = useState<LeadId[]>(initial.leads)
  const [selection, setSelection] = useState<Selection | null>(
    initialRegion ? { id: initialRegion.id, beatOnset: repOnset } : null,
  )
  const clock = useCardiacClock(strip.durationMs, { startFraction, autoplay })

  // --- selection handlers ---------------------------------------------------
  const selectById = useCallback(
    (id: SegmentId) => {
      const r = regions.find((x) => x.id === id)
      if (!r) return
      clock.seekFraction((repOnset + r.mid) / strip.durationMs)
      clock.pause()
      setSelection({ id, beatOnset: repOnset })
    },
    [regions, repOnset, strip.durationMs, clock],
  )

  const selectAtTime = useCallback(
    (t: number) => {
      const beat = beatAt(strip, t)
      const r = regionAtRelTime(regions, t - beat.onset)
      clock.seekFraction(t / strip.durationMs)
      clock.pause()
      setSelection(r ? { id: r.id, beatOnset: beat.onset } : null)
    },
    [regions, strip, clock],
  )

  const clearSelection = useCallback(() => {
    setSelection(null)
    clock.play()
  }, [clock])

  // Resuming playback (by any route) clears the highlight.
  useEffect(() => {
    if (clock.isPlaying && selection) setSelection(null)
  }, [clock.isPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSelectCondition = useCallback((id: string) => {
    setConditionId(id)
    setSelection(null)
  }, [])

  // Keep the URL shareable.
  useEffect(() => {
    const p = new URLSearchParams()
    if (conditionId !== DEFAULT_CONDITION_ID) p.set('c', conditionId)
    if (!(leads.length === 1 && leads[0] === 'II')) {
      p.set('leads', leads.length === ALL_LEADS.length ? '12' : leads.join(','))
    }
    if (selection) p.set('sel', selection.id)
    const qs = p.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [conditionId, leads, selection])

  const selRegion = selection ? regions.find((r) => r.id === selection.id) ?? null : null
  const highlight = selection && selRegion
    ? { t0: selection.beatOnset + selRegion.relStart, t1: selection.beatOnset + selRegion.relEnd, tone: selRegion.tone }
    : null

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar-inner">
          <div className="brand" aria-hidden>
            <svg viewBox="0 0 40 24" width="34" height="20">
              <path d="M1 12 H10 L13 5 L17 19 L21 9 L24 14 H39" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="brand-name">EKG&nbsp;Atlas</span>
          </div>
          <ConditionPicker current={condition} onSelect={onSelectCondition} />
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
            <HeartDiagram strip={strip} condition={condition} clock={clock} onSelectZone={selectById} />
            <div className="story">{condition.story}</div>
          </section>

          <section className="card trace-card">
            <div className="trace-controls">
              <LeadSelector leads={leads} onChange={setLeads} />
              <PhaseChips regions={regions} selected={selection?.id ?? null} onSelect={selectById} onClear={clearSelection} />
            </div>
            <TraceCanvas signals={signals} strip={strip} clock={clock} leads={leads} highlight={highlight} onTapTime={selectAtTime} />
          </section>

          <section className="card">
            <ExplainPanel condition={condition} meanAxis={meanAxis} selected={selection?.id ?? null} onSelect={selectById} />
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
