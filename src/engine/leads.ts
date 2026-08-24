/**
 * The 12 leads, always DERIVED from electrode potentials — never a lead-axis
 * table. `leadsFromPhi` turns per-electrode potentials into the 12 signals;
 * `applyMontageToRecorded` applies a limb-cable montage to a REAL recording
 * using only algebra on the recorded leads (the Derived provenance tier).
 */
import { LimbCable, Montage, STANDARD_SITES } from './electrodes'

export type LeadId =
  | 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF'
  | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6'

export const LIMB_LEADS: LeadId[] = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF']
export const PRECORDIAL_LEADS: LeadId[] = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']
export const ALL_LEADS: LeadId[] = [...LIMB_LEADS, ...PRECORDIAL_LEADS]

/** Potentials at the ten electrode CABLES (whatever site each is clipped to). */
export interface Phi {
  RA: number; LA: number; LL: number; RL: number
  V1: number; V2: number; V3: number; V4: number; V5: number; V6: number
}

/** Standard lead derivations (Einthoven, Goldberger, Wilson). */
export const leadsFromPhi = (p: Phi): Record<LeadId, number> => {
  const wct = (p.RA + p.LA + p.LL) / 3
  return {
    I: p.LA - p.RA,
    II: p.LL - p.RA,
    III: p.LL - p.LA,
    aVR: p.RA - (p.LA + p.LL) / 2,
    aVL: p.LA - (p.RA + p.LL) / 2,
    aVF: p.LL - (p.RA + p.LA) / 2,
    V1: p.V1 - wct, V2: p.V2 - wct, V3: p.V3 - wct,
    V4: p.V4 - wct, V5: p.V5 - wct, V6: p.V6 - wct,
  }
}

/**
 * Apply a limb-cable montage to a REAL recording — exact algebra, no model.
 *
 * With φ(site RA) taken as reference 0, the recorded leads give the site
 * potentials directly: φ(site LA) = I, φ(site LL) = II. The right leg is
 * near-equipotential with the left (both far inferior): φ(site RL) ≈ II —
 * the stated approximation behind the classic RA/RL "flat lead II".
 *
 * Chest CABLE moves cannot be derived from a recording (the information was
 * never recorded); this function only re-derives from limb-cable changes.
 * The Wilson terminal moves with the limb cables, so precordials shift too:
 * Vi' = Vi + (WCT − WCT').
 */
export const applyMontageToRecorded = (
  recorded: Record<LeadId, Float32Array>,
  montage: Montage,
): Record<LeadId, Float32Array> => {
  const n = recorded.I.length
  const out = {} as Record<LeadId, Float32Array>
  for (const id of ALL_LEADS) out[id] = new Float32Array(n)

  // Which standard site each limb cable now occupies (montage sites for limb
  // cables are always one of the four standard limb sites).
  const siteOf = (cable: LimbCable): LimbCable => {
    const pos = montage.site[cable]
    for (const s of ['RA', 'LA', 'LL', 'RL'] as LimbCable[]) {
      const std = STANDARD_SITES[s]
      if (pos[0] === std[0] && pos[1] === std[1] && pos[2] === std[2]) return s
    }
    throw new Error(`limb cable ${cable} is not on a standard limb site`)
  }
  const map: Record<LimbCable, LimbCable> = {
    RA: siteOf('RA'), LA: siteOf('LA'), LL: siteOf('LL'), RL: siteOf('RL'),
  }

  for (let i = 0; i < n; i++) {
    const a = recorded.I[i] // φ(LA site), with φ(RA site) = 0
    const b = recorded.II[i] // φ(LL site)
    const sitePhi: Record<LimbCable, number> = { RA: 0, LA: a, LL: b, RL: b }
    const p = {
      RA: sitePhi[map.RA], LA: sitePhi[map.LA], LL: sitePhi[map.LL], RL: sitePhi[map.RL],
    }
    out.I[i] = p.LA - p.RA
    out.II[i] = p.LL - p.RA
    out.III[i] = p.LL - p.LA
    out.aVR[i] = p.RA - (p.LA + p.LL) / 2
    out.aVL[i] = p.LA - (p.RA + p.LL) / 2
    out.aVF[i] = p.LL - (p.RA + p.LA) / 2
    const dWct = (0 + a + b) / 3 - (p.RA + p.LA + p.LL) / 3
    for (const v of PRECORDIAL_LEADS) out[v][i] = recorded[v][i] + dWct
  }
  return out
}

/** Anatomical wall each lead faces — the basis for territory teaching. */
export type Territory = 'septal' | 'anterior' | 'lateral' | 'inferior' | 'cavity'

export const LEAD_TERRITORY: Record<LeadId, Territory> = {
  I: 'lateral', II: 'inferior', III: 'inferior',
  aVR: 'cavity', aVL: 'lateral', aVF: 'inferior',
  V1: 'septal', V2: 'septal', V3: 'anterior',
  V4: 'anterior', V5: 'lateral', V6: 'lateral',
}

export const TERRITORY_LABEL: Record<Territory, string> = {
  septal: 'Septal', anterior: 'Anterior', lateral: 'Lateral',
  inferior: 'Inferior', cavity: 'Cavity (aVR)',
}
