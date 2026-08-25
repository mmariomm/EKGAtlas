/** Electrode Lab teaching strips — transcribed from docs/rebuild/04-CARDS.md §Lab-E. */
import { PresetId } from '../engine/electrodes'

export interface LabPreset {
  id: PresetId | 'dextrocardia' | 'serial'
  label: string
  /** verbatim teaching line ending with the tell */
  text: string
  tell: string
  cites?: string[]
  /** works on a real recording via exact algebra (limb swaps) */
  realCapable: boolean
  /** RL-involving swaps carry the stated approximation note */
  approxNote?: string
}

export const LAB_PRESETS: LabPreset[] = [
  {
    id: 'high-v1v2',
    label: 'V1–V2 too high',
    text: 'High V1–V2 manufacture rSr′ patterns, T inversions — even coved pseudo-Brugada — and can erase septal R waves into a pseudo-septal-infarct.',
    tell: 'A fully negative P wave in V1 (correctly placed V1 sees a biphasic P); fix the electrodes, repeat.',
    cites: ['BATCHVAROV-2007'],
    realCapable: false,
  },
  {
    id: 'ra-la',
    label: 'RA ↔ LA',
    text: 'Lead I flips upside down, II↔III trade places, aVR and aVL swap — the limb leads scream dextrocardia.',
    tell: 'The precordial R-progression V1→V6 stays NORMAL. True dextrocardia reverses it (compare below).',
    cites: ['BATCHVAROV-2007'],
    realCapable: true,
  },
  {
    id: 'ra-rl',
    label: 'RA ↔ RL',
    text: 'Lead II records the voltage between two legs — a near-flatline. Any “lead falls silent” pattern is a cable problem before it is a heart problem.',
    tell: 'A tiny, noise-level lead II with everything else alive.',
    realCapable: true,
    approxNote: 'exact up to the two-legs-equipotential approximation',
  },
  {
    id: 'la-ll',
    label: 'LA ↔ LL',
    text: 'Lead III flips, I↔II trade, aVL↔aVF trade — inferior “changes” appear from nowhere.',
    tell: 'Compare with any prior ECG; the P-wave axis shifts without the patient changing.',
    cites: ['BATCHVAROV-2007'],
    realCapable: true,
  },
  {
    id: 'rotate',
    label: 'Limb rotation',
    text: 'All six limb leads permute — an instant “axis deviation + inferior ischemia” phantom.',
    tell: 'The precordials never got the memo (unchanged).',
    realCapable: true,
  },
  {
    id: 'dextrocardia',
    label: 'True dextrocardia',
    text: 'Global inversion in I + reversed precordial R-progression (R shrinks V1→V6).',
    tell: 'Versus RA↔LA: the chest leads agree with the limb leads only in real dextrocardia.',
    realCapable: false,
  },
  {
    id: 'serial',
    label: 'The serial trap',
    text: 'Yesterday’s ECG had swapped leads; today’s is correct — the “dynamic change” is fiction. Placement invalidates comparison.',
    tell: 'When today’s ECG surprises you, first ask how it was taken.',
    realCapable: true,
  },
]
