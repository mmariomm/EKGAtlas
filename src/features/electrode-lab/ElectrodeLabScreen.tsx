/**
 * Drag electrodes on a torso and watch the trace obey — lawful
 * physics in both modes: the modeled heart (engine v2, any manipulation) or a
 * REAL recording (limb-cable swaps recomputed exactly from leads I and II;
 * chest leads can't be re-derived from a recording, so those pucks lock).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { LAB_PRESETS, LabPreset } from '../../content/labElectrodes'
import { GUIDELINE_BY_KEY } from '../../content/guidelines'
import {
  ChestCable, CHEST_CABLES, HIGH_V1, HIGH_V2, LimbCable, Montage, STANDARD_SITES,
} from '../../engine/electrodes'
import { ALL_LEADS, applyMontageToRecorded, LeadId } from '../../engine/leads'
import { mirrorStrip } from '../../engine/sources'
import { buildSignals, samplePhase } from '../../engine/synthesize'
import { tileState } from '../../engine/propagate'
import { useCardiacClock } from '../../lib/clock'
import { loadTrace, signalsToTraceData, TraceData } from '../../lib/assets'
import { linkClick } from '../../router'
import { metric } from '../../lib/metrics'
import TraceView from '../trace/TraceView'
import ProvenanceBadge from '../card/ProvenanceBadge'
import TorsoBoard, { BoardState, standardBoard } from './TorsoBoard'
import './ElectrodeLab.css'

const REAL_TRACE_ID = 'ptbxl-24-nsr'

type Mode = 'model' | 'real'

const LIMB_PRESETS: Record<string, Record<LimbCable, LimbCable>> = {
  'ra-la': { RA: 'LA', LA: 'RA', LL: 'LL', RL: 'RL' },
  'la-ll': { RA: 'RA', LA: 'LL', LL: 'LA', RL: 'RL' },
  'ra-rl': { RA: 'RL', LA: 'LA', LL: 'LL', RL: 'RA' },
  rotate: { LA: 'RA', LL: 'LA', RL: 'LL', RA: 'RL' },
}

const boardToMontage = (b: BoardState): Montage => {
  const site: Montage['site'] = { ...STANDARD_SITES }
  for (const cable of ['RA', 'LA', 'LL', 'RL'] as LimbCable[]) {
    site[cable] = STANDARD_SITES[b.limbSlot[cable]]
  }
  for (const cable of CHEST_CABLES) site[cable] = b.chest[cable]
  return { site }
}

const isStandard = (b: BoardState): boolean =>
  (['RA', 'LA', 'LL', 'RL'] as LimbCable[]).every((c) => b.limbSlot[c] === c) &&
  CHEST_CABLES.every((c) => {
    const std = standardBoard().chest[c]
    return b.chest[c].every((v, i) => Math.abs(v - std[i]) < 0.01)
  })

const swapSummary = (b: BoardState): string => {
  const moved = (['RA', 'LA', 'LL', 'RL'] as LimbCable[]).filter((c) => b.limbSlot[c] !== c)
  if (!moved.length) return 'standard placement'
  return 'limb-cable swap: ' + moved.map((c) => `${c}→${b.limbSlot[c]} position`).join(', ')
}

export default function ElectrodeLabScreen() {
  const initial = useMemo(() => {
    const p = new URLSearchParams(window.location.search)
    return { swap: p.get('swap') }
  }, [])

  const [mode, setMode] = useState<Mode>('model')
  const [board, setBoard] = useState<BoardState>(standardBoard)
  const [preset, setPreset] = useState<LabPreset | null>(null)
  const [dextro, setDextro] = useState(false)
  const [leads, setLeads] = useState<LeadId[]>(['I', 'II', 'V1'])
  const [real, setReal] = useState<TraceData | null>(null)
  const [hint, setHint] = useState('')
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { loadTrace(REAL_TRACE_ID).then(setReal).catch(() => {}) }, [])
  useEffect(() => {
    if (initial.swap) {
      const p = LAB_PRESETS.find((x) => x.id === initial.swap)
      if (p) applyPreset(p)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.swap])

  const flashHint = (msg: string) => {
    setHint(msg)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(''), 3200)
  }

  // Share the current preset as a link — the lab is the app's most shareable
  // artifact ("I made V2 lie — can you spot why?").
  const [shared, setShared] = useState('')
  const share = async () => {
    metric('share')
    const url = window.location.href
    const text = preset ? `${preset.label} — spot what it does to the trace` : 'EKG Atlas — Electrode Lab'
    try {
      if (navigator.share) await navigator.share({ title: 'Electrode Lab', text, url })
      else {
        await navigator.clipboard.writeText(url)
        setShared('link copied')
        setTimeout(() => setShared(''), 2200)
      }
    } catch { /* user dismissed */ }
  }

  const applyPreset = (p: LabPreset) => {
    setPreset(p)
    setDextro(false)
    const url = new URL(window.location.href)
    url.searchParams.set('swap', p.id)
    window.history.replaceState(null, '', url)
    if (p.id === 'high-v1v2') {
      setMode('model')
      setBoard((b) => ({ ...standardBoard(), limbSlot: b.limbSlot, chest: { ...standardBoard().chest, V1: HIGH_V1, V2: HIGH_V2 } }))
      setLeads(['V1', 'V2', 'II'])
    } else if (p.id === 'dextrocardia') {
      setMode('model')
      setBoard(standardBoard())
      setDextro(true)
      setLeads(['I', 'V1', 'V6'])
    } else if (p.id === 'serial') {
      setBoard({ ...standardBoard(), limbSlot: LIMB_PRESETS['la-ll'] })
      setLeads(['II', 'III', 'aVF'])
    } else {
      setBoard({ ...standardBoard(), limbSlot: LIMB_PRESETS[p.id] })
      setLeads(p.id === 'ra-la' ? ['I', 'II', 'V4'] : p.id === 'ra-rl' ? ['I', 'II', 'III'] : ['I', 'II', 'aVF'])
    }
  }

  const reset = () => {
    setPreset(null)
    setDextro(false)
    setBoard(standardBoard())
    setLeads(['I', 'II', 'V1'])
    const url = new URL(window.location.href)
    url.searchParams.delete('swap')
    window.history.replaceState(null, '', url)
  }

  const montage = useMemo(() => boardToMontage(board), [board])
  const modelStrip = useMemo(() => {
    const s = tileState({ pace: 'SA' })
    return dextro ? mirrorStrip(s) : s
  }, [dextro])

  // Model-mode signals recompute live as pucks move.
  const modelData = useMemo(() => {
    const sig = buildSignals(modelStrip, montage)
    return signalsToTraceData('lab-model', sig, {
      tier: 'modeled',
      modelNote: dextro ? 'Synthesized: mirrored (dextrocardia) heart' : 'Synthesized by the conduction model',
    })
  }, [modelStrip, montage, dextro])

  // Ghost reference: what the SAME heart writes with standard placement —
  // drawn softly under the displaced trace so the difference is the lesson.
  const nonStandard = !isStandard(board)
  const modelGhost = useMemo(() => {
    if (!nonStandard) return null
    const sig = buildSignals(modelStrip, boardToMontage(standardBoard()))
    return signalsToTraceData('lab-model-std', sig, { tier: 'modeled', modelNote: 'standard placement' })
  }, [nonStandard, modelStrip])

  // Real-mode signals: exact limb algebra on the recording.
  const realData = useMemo(() => {
    if (!real) return null
    const std = isStandard(board)
    const swapped = applyMontageToRecorded(real.leads as Record<LeadId, Float32Array>, montage)
    return {
      ...real,
      id: std ? real.id : `${real.id}-swapped`,
      leads: swapped,
      provenance: std
        ? real.provenance
        : { tier: 'derived' as const, sourceRecord: real.provenance.sourceRecord, license: real.provenance.license, derivation: `${swapSummary(board)} (exact algebra on recorded leads)` },
    }
  }, [real, board, montage])

  const data = mode === 'model' ? modelData : realData
  const clock = useCardiacClock(data?.durationMs ?? 1000, { autoplay: true })
  const toneAt = useMemo(() => {
    if (mode !== 'model') return undefined
    return (t: number) => samplePhase(modelStrip, t).tone
  }, [mode, modelStrip])

  const serialView = preset?.id === 'serial'
  const serialToday = useMemo(() => {
    if (!serialView || !real) return null
    return real
  }, [serialView, real])

  const onChestDrag = (cable: ChestCable) => {
    const i = CHEST_CABLES.indexOf(cable)
    const lo = Math.max(0, Math.min(i - 1, CHEST_CABLES.length - 3))
    setLeads([CHEST_CABLES[lo], CHEST_CABLES[lo + 1], CHEST_CABLES[lo + 2]])
  }

  const switchMode = (m: Mode) => {
    if (m === mode) return
    if (m === 'real' && (dextro || preset?.id === 'high-v1v2')) {
      // chest manipulations don't survive into real mode
      reset()
    }
    setMode(m)
  }

  return (
    <div className="screen lab">
      <header className="lab-head">
        <a href="/" onClick={linkClick('/')} className="lab-back" aria-label="Back to library">‹</a>
        <h1>Electrode Lab</h1>
        <div className="lab-mode" role="group" aria-label="Signal source">
          <button className={mode === 'model' ? 'on' : ''} onClick={() => switchMode('model')}>Modeled heart</button>
          <button className={mode === 'real' ? 'on' : ''} onClick={() => switchMode('real')}>Real recording</button>
        </div>
      </header>

      <p className="lab-lede">
        {mode === 'model'
          ? 'Drag any electrode — every lead re-derives from where it actually sits.'
          : 'Limb-cable swaps recomputed exactly from the recorded leads. Chest leads can’t be re-derived from a recording — switch to the modeled heart to move those.'}
      </p>

      <div className="lab-presets">
        {LAB_PRESETS.map((p) => (
          <button
            key={p.id}
            className={`lab-chip ${preset?.id === p.id ? 'lab-chip-on' : ''} ${mode === 'real' && !p.realCapable ? 'lab-chip-dim' : ''}`}
            onClick={() => {
              if (mode === 'real' && !p.realCapable) setMode('model')
              applyPreset(p)
            }}
          >
            {p.label}
          </button>
        ))}
        <button className="lab-chip lab-chip-reset" onClick={reset}>Reset</button>
        <button className="lab-chip lab-chip-share" onClick={share}>Share this setup</button>
      </div>
      {shared && <p className="lab-hint">{shared}</p>}

      {!serialView && (
        <div className="lab-board">
          <TorsoBoard
            state={board}
            onChange={(b) => { setBoard(b); if (preset && preset.id !== 'serial') setPreset(null) }}
            chestLocked={mode === 'real'}
            onChestLockedTouch={() => flashHint('Chest leads can’t be re-derived from a recording — switch to the modeled heart to move these.')}
            onChestDrag={onChestDrag}
            standardChest={standardBoard().chest}
          />
        </div>
      )}
      {hint && <p className="lab-hint">{hint}</p>}

      {preset && (
        <div className="lab-teach">
          <p>{preset.text}</p>
          <p><b>The tell:</b> {preset.tell}</p>
          {preset.approxNote && <p className="lab-approx">{preset.approxNote}</p>}
          {preset.cites?.map((k) => (
            <span key={k} className="lab-cite">{GUIDELINE_BY_KEY[k]?.org} {GUIDELINE_BY_KEY[k]?.year}</span>
          ))}
          {preset.id === 'ra-la' && (
            <button className="lab-compare" onClick={() => applyPreset(LAB_PRESETS.find((x) => x.id === 'dextrocardia')!)}>
              compare: true dextrocardia →
            </button>
          )}
          {preset.id === 'dextrocardia' && (
            <button className="lab-compare" onClick={() => applyPreset(LAB_PRESETS.find((x) => x.id === 'ra-la')!)}>
              compare: RA↔LA cable swap →
            </button>
          )}
        </div>
      )}

      {!serialView && data && (
        <div className="lab-trace">
          <TraceView
            data={data}
            leads={leads}
            clock={clock}
            toneAt={toneAt}
            onTap={clock.toggle}
            badge={<ProvenanceBadge provenance={data.provenance} />}
            laneHeight={64}
            ghost={nonStandard ? (mode === 'model' ? modelGhost : real) : null}
            ghostLabel="standard placement"
          />
          <div className="lab-leadpick">
            {ALL_LEADS.map((l) => (
              <button
                key={l}
                className={`lab-lead ${leads.includes(l) ? 'on' : ''}`}
                onClick={() => setLeads((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur.slice(-2), l]))}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {serialView && realData && serialToday && (
        <div className="lab-serial">
          <div className="lab-serial-label">“Yesterday” — cables swapped (LA↔LL), nobody noticed</div>
          <TraceView data={realData} leads={leads} clock={clock} onTap={clock.toggle}
            badge={<ProvenanceBadge provenance={realData.provenance} />} laneHeight={86} />
          <div className="lab-serial-label">“Today” — placed correctly: the “dynamic change” is fiction</div>
          <TraceView data={serialToday} leads={leads} clock={clock} onTap={clock.toggle}
            badge={<ProvenanceBadge provenance={serialToday.provenance} />} laneHeight={86} />
        </div>
      )}
    </div>
  )
}
