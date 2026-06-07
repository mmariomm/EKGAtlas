/**
 * Phase regions — the bridge for click-to-explain. Each waveform segment
 * (P, PR, QRS, ST, T) is mapped to a time window within the representative beat,
 * the heart structures active during it, and its phase tone. Selecting a phase
 * seeks the shared clock into that window, so the heart and trace both reflect it.
 *
 * Time bounds are derived from the first beat's authored conduction events, so a
 * wide LBBB QRS or a different PR all come out correct without hand-tuning.
 */
import { PhaseTone, StructureId, Strip } from './types'

export type SegmentId = 'P' | 'PR' | 'QRS' | 'ST' | 'T'

interface PhaseMeta {
  label: string
  tone: PhaseTone
  structures: StructureId[]
}

const PHASE_META: Record<SegmentId, PhaseMeta> = {
  P: { label: 'P', tone: 'atria', structures: ['SA', 'RA', 'LA'] },
  PR: { label: 'PR', tone: 'av', structures: ['AV', 'HIS', 'RBB', 'LBB', 'LAF', 'LPF'] },
  QRS: { label: 'QRS', tone: 'ventricle', structures: ['SEPTUM', 'RV', 'LV'] },
  ST: { label: 'ST', tone: 'rest', structures: [] },
  T: { label: 'T', tone: 'repol', structures: ['RV', 'LV'] },
}

export interface PhaseRegion {
  id: SegmentId
  label: string
  tone: PhaseTone
  structures: StructureId[]
  /** ms relative to the representative beat's onset. */
  relStart: number
  relEnd: number
  mid: number
}

export const isSegmentId = (s: string | null | undefined): s is SegmentId =>
  s === 'P' || s === 'PR' || s === 'QRS' || s === 'ST' || s === 'T'

/** The representative beat: the first one carrying a full P-QRS-T (else beat 0). */
const representativeBeat = (strip: Strip) =>
  strip.beats.find(
    (b) =>
      b.events.some((e) => e.kind === 'atria') &&
      b.events.some((e) => e.kind === 'ventricle'),
  ) ?? strip.beats[0]

export const phaseRegions = (strip: Strip): PhaseRegion[] => {
  const beat = representativeBeat(strip)
  const ev = beat.events
  const span = (pred: (k: PhaseTone, s: StructureId) => boolean) => {
    const es = ev.filter((e) => pred(e.kind, e.structure))
    if (!es.length) return null
    return { s: Math.min(...es.map((e) => e.start)), e: Math.max(...es.map((e) => e.end)) }
  }
  const atria = span((k, s) => k === 'atria' || s === 'SA')
  const vent = span((k) => k === 'ventricle' || k === 'injury')
  const repol = span((k) => k === 'repol')

  const out: PhaseRegion[] = []
  const push = (id: SegmentId, s: number | null, e: number | null) => {
    if (s == null || e == null || e <= s) return
    const m = PHASE_META[id]
    out.push({ id, label: m.label, tone: m.tone, structures: m.structures, relStart: s, relEnd: e, mid: (s + e) / 2 })
  }

  if (atria) push('P', atria.s, atria.e)
  if (atria && vent) push('PR', atria.e, vent.s) // the isoelectric AV-delay segment
  if (vent) push('QRS', vent.s, vent.e)
  if (vent && repol) push('ST', vent.e, repol.s)
  if (repol) push('T', repol.s, repol.e)
  return out
}

/** Which region (if any) a relative time falls inside. */
export const regionAtRelTime = (regions: PhaseRegion[], relMs: number): PhaseRegion | null =>
  regions.find((r) => relMs >= r.relStart && relMs < r.relEnd) ?? null

/** Absolute onset (ms) of the beat the regions are measured against. */
export const representativeOnset = (strip: Strip): number => representativeBeat(strip).onset
