/**
 * Phase regions — the bridge for tap-to-explain. Each waveform segment
 * (P, PR, QRS, ST, T) maps to a time window within the representative beat,
 * the structures active during it, and its tone. Bounds derive from the
 * actual sources, so a wide LBBB QRS comes out wide automatically.
 */
import { PhaseTone, SegmentTag, StructureId, Strip } from './sources'

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

const representativeBeat = (strip: Strip) =>
  strip.beats.find(
    (b) => b.sources.some((s) => s.segment === 'P') && b.sources.some((s) => s.segment === 'QRS' && s.mag > 0),
  ) ?? strip.beats[0]

export const phaseRegions = (strip: Strip): PhaseRegion[] => {
  const beat = representativeBeat(strip)
  const ext = (seg: SegmentTag) => {
    const ss = beat.sources.filter((s) => s.segment === seg && Math.abs(s.mag) > 0)
    if (!ss.length) return null
    return {
      s: Math.min(...ss.map((s) => s.center - 1.7 * s.width)),
      e: Math.max(...ss.map((s) => s.center + 1.7 * s.width)),
    }
  }
  const P = ext('P')
  const QRS = ext('QRS')
  const T = ext('T')

  const out: PhaseRegion[] = []
  const push = (id: SegmentId, s: number | null | undefined, e: number | null | undefined) => {
    if (s == null || e == null || e <= s) return
    const m = PHASE_META[id]
    out.push({ id, label: m.label, tone: m.tone, structures: m.structures, relStart: s, relEnd: e, mid: (s + e) / 2 })
  }

  if (P) push('P', P.s, P.e)
  if (P && QRS) push('PR', P.e, QRS.s)
  if (QRS) push('QRS', QRS.s, QRS.e)
  if (QRS && T) push('ST', QRS.e, T.s)
  if (T) push('T', T.s, T.e)
  return out
}

export const regionAtRelTime = (regions: PhaseRegion[], relMs: number): PhaseRegion | null =>
  regions.find((r) => relMs >= r.relStart && relMs < r.relEnd) ?? null

export const representativeOnset = (strip: Strip): number => representativeBeat(strip).onset
