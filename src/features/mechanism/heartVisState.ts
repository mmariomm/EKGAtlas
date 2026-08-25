/**
 * Adapter: engine state → the HeartVis contract. The contract is deliberately
 * implementation-agnostic so the visual and the physics stay decoupled.
 */
import { Strip, StructureId } from '../../engine/sources'
import { beatAt, sampleActivation, samplePhase, sampleVector } from '../../engine/synthesize'
import { frontalAngleDeg, frontalMagnitude } from '../../engine/vec'

export interface HeartVisState {
  t: number
  activations: Record<string, { level: number; progress: number; kind: string }>
  vector: { angleDeg: number; magnitude: number }
  tone: string
  focus: { x: number; y: number; label: string } | null
}

export interface HeartVisHandle {
  update(state: HeartVisState): void
  setStatic(cfg: { blocked: string[] }): void
  destroy(): void
}

export interface HeartVisApi {
  mount(el: HTMLElement, opts?: unknown): HeartVisHandle
}

declare global {
  interface Window {
    HeartVis?: HeartVisApi
  }
}

/** Build the per-frame state object from the mechanism strip at model time t. */
export const buildHeartVisState = (strip: Strip, tModel: number): HeartVisState => {
  const act = sampleActivation(strip, tModel)
  const activations: HeartVisState['activations'] = {}
  for (const [id, a] of act) {
    activations[id as StructureId] = { level: a.level, progress: a.progress, kind: a.kind }
  }
  const v = sampleVector(strip, tModel)
  const beat = beatAt(strip, tModel)
  return {
    t: tModel,
    activations,
    vector: { angleDeg: frontalAngleDeg(v), magnitude: frontalMagnitude(v) },
    tone: samplePhase(strip, tModel).tone,
    focus: beat.focus ? { x: beat.focus.x, y: beat.focus.y, label: beat.focus.label } : null,
  }
}
