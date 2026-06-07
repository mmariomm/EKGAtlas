import { Beat, Condition } from '../engine/types'
import { atrialSources, RR_DEFAULT, sinusBeat } from './helpers'

/**
 * Ventricular premature complex, RV origin — the design-sketch sequence:
 * NSR → NSR → VPC → dissociated "P*" hidden in the T → full compensatory pause →
 * NSR. The SA node is never reset, so the P-P marches on regularly through the ectopic.
 */
const VPC_ONSET = 1450 // 650 ms after beat 2 (premature vs the 800 ms cycle)
const GHOST_P_ONSET = 1600 // on-time sinus P, lands refractory, hidden in the VPC's T
const RESUME_ONSET = 2400 // next conducted sinus beat → full compensatory pause
const STRIP_MS = 3200

/** The ectopic beat: born in the RV free wall, no preceding P, broad and bizarre. */
const vpcBeat = (onset: number): Beat => ({
  onset,
  label: 'VPC',
  focus: { x: 0.34, y: 0.6, label: 'RV focus' },
  sources: [
    { dir: [0.7, 0.7, -0.1], mag: 1.5, center: 40, width: 26, segment: 'QRS', glow: { structures: ['RV'], kind: 'ventricle', start: 0, end: 70 } },
    { dir: [0.82, 0.5, -0.35], mag: 1.0, center: 78, width: 24, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 50, end: 150, note: 'spreads to LV late — no His-Purkinje shortcut' } },
    { dir: [-0.6, -0.55, 0.2], mag: 0.6, center: 196, width: 72, segment: 'T', glow: { structures: ['RV', 'LV'], kind: 'repol', start: 210, end: 400 } },
  ],
  wires: [
    { structure: 'FOCUS', start: 0, end: 18, kind: 'ventricle', note: 'ectopic RV focus fires' },
  ],
})

/** The on-time sinus P that finds the ventricle refractory: a lone, non-conducted P. */
const ghostPBeat = (onset: number): Beat => ({
  onset,
  label: 'P*',
  sources: atrialSources(),
  wires: [
    { structure: 'SA', start: 0, end: 14, kind: 'sa' },
    { structure: 'AV', start: 92, end: 156, kind: 'av', note: 'P blocked — ventricle still refractory' },
  ],
})

export const vpcRv: Condition = {
  id: 'vpc-rv',
  name: 'Ventricular premature complex — RV origin',
  shortName: 'VPC (RV origin)',
  category: 'Ectopy & arrhythmia',
  tagline: 'A focus jumps the gun in the RV — no P, broad QRS, discordant T, full compensatory pause.',
  criteria: ['Early, broad QRS (≥ 120 ms)', 'No preceding P wave', 'LBBB morphology (RV origin)', 'Discordant T wave', 'Full compensatory pause'],
  story: 'NSR → NSR → VPC (broad, +ve) → P* hidden in T → compensatory pause → NSR',
  description:
    'An irritable focus in the right ventricle fires before the next sinus beat is due. ' +
    'Because it starts in muscle — not the His-Purkinje highway — the impulse spreads slowly, ' +
    'cell to cell, from RV to LV, so the QRS is broad and bizarre. RV origin means the LV is ' +
    'activated last (LBBB-like: broad and positive in lead II). Repolarization runs opposite, ' +
    'giving the discordant T. Meanwhile the SA node is untouched and keeps its rhythm — the next ' +
    'sinus P arrives on schedule but finds the ventricle refractory (the hidden "P*"), so the ' +
    'ventricle waits for the following sinus beat: a full compensatory pause.',
  segmentNotes: [
    { segment: 'QRS', title: 'Broad QRS, no P', detail: 'Born in ventricular muscle → no atrial kick first, and slow cell-to-cell spread widens the QRS.' },
    { segment: 'QRS', title: 'LBBB-like, +ve in II', detail: 'RV origin activates the LV last; the net vector points down-left → tall and broad in lead II.' },
    { segment: 'T', title: 'Discordant T', detail: 'Abnormal depolarization order reverses repolarization → the T points opposite the QRS.' },
    { segment: 'P', title: 'Hidden P* + pause', detail: 'The on-time sinus P lands in the VPC’s refractory period (buried in the T) → full compensatory pause.' },
  ],
  read: {
    rhythm: 'Sinus with a ventricular premature complex + full compensatory pause',
    morphology: 'Early broad QRS, no preceding P, T discordant to the QRS',
    ischemia: 'N/A for the ectopic beat — read the underlying sinus rhythm',
  },
  clinical: 'Isolated VPCs are usually benign. Worry if frequent, multifocal, or R-on-T — check electrolytes (K⁺/Mg²⁺) and ischemia, especially if new or symptomatic.',
  buildStrip: () => ({
    beats: [sinusBeat(0, 'Beat 1'), sinusBeat(RR_DEFAULT, 'Beat 2'), vpcBeat(VPC_ONSET), ghostPBeat(GHOST_P_ONSET), sinusBeat(RESUME_ONSET)],
    durationMs: STRIP_MS,
  }),
}
