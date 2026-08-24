/**
 * Trace assets: the one shape TraceView consumes, whether the strip is a real
 * recording (public/recordings/*.json) or a modeled synthesis. Real samples
 * are converted to mV once and cached; the JSON is never mutated.
 */
import { LeadId, ALL_LEADS } from '../engine/leads'
import { SignalSet } from '../engine/synthesize'
import { TraceAnnotation } from '../engine/sync'
import { Provenance } from '../content/schema'

export interface TraceData {
  id: string
  durationMs: number
  /** samples per second of the arrays below */
  fs: number
  /** per-lead samples in mV */
  leads: Partial<Record<LeadId, Float32Array>>
  annotation: TraceAnnotation
  provenance: Provenance
}

export interface TraceAssetJson {
  id: string
  provenance: Provenance
  fs: number
  unitsPerMv: number
  durationMs: number
  leads: Record<string, number[]>
  annotation: TraceAnnotation
}

const cache = new Map<string, Promise<TraceData>>()

export const loadTrace = (id: string): Promise<TraceData> => {
  let p = cache.get(id)
  if (!p) {
    p = fetch(`/recordings/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`trace ${id}: HTTP ${r.status}`)
        return r.json() as Promise<TraceAssetJson>
      })
      .then(assetToTraceData)
    cache.set(id, p)
  }
  return p
}

export const assetToTraceData = (a: TraceAssetJson): TraceData => {
  const leads: Partial<Record<LeadId, Float32Array>> = {}
  for (const [name, arr] of Object.entries(a.leads)) {
    const f = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i++) f[i] = arr[i] / a.unitsPerMv
    leads[name as LeadId] = f
  }
  return {
    id: a.id,
    durationMs: a.durationMs,
    fs: a.fs,
    leads,
    annotation: a.annotation,
    provenance: a.provenance,
  }
}

/** Wrap a modeled SignalSet as TraceData (provenance supplied by the caller). */
export const signalsToTraceData = (
  id: string,
  sig: SignalSet,
  provenance: Provenance,
  annotation: TraceAnnotation = { beats: [] },
): TraceData => {
  const leads: Partial<Record<LeadId, Float32Array>> = {}
  for (const l of ALL_LEADS) leads[l] = sig.leads[l]
  return { id, durationMs: sig.durationMs, fs: 1000 / sig.dt, leads, annotation, provenance }
}
