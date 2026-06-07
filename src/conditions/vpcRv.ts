import { Beat, Condition } from '../engine/types'
import { atrialEvents, atrialLobes, RR_DEFAULT, sinusBeat } from './helpers'

/**
 * Ventricular premature complex, RV origin — the exact sequence from the design
 * sketch: NSR → NSR → VPC → dissociated "P*" hidden in the T → full
 * compensatory pause → NSR. The SA node never gets reset, so the P-P marches on
 * regularly (40, 840, 1640, 2440 ms) straight through the ectopic.
 */
const VPC_ONSET = 1450 // premature: 650 ms after beat 2 (vs the 800 ms sinus cycle)
const GHOST_P_ONSET = 1600 // the on-time sinus P that lands refractory, hidden in the VPC's T
const RESUME_ONSET = 2400 // next conducted sinus beat → full compensatory pause (2 × RR from beat 2)
const STRIP_MS = 3200

/** The ectopic beat: born in the RV free wall, no preceding P, broad and bizarre. */
const vpcBeat = (onset: number): Beat => ({
  onset,
  label: 'VPC',
  focus: { x: 0.34, y: 0.6, label: 'RV focus' },
  lobes: [
    // RV origin → LBBB-like, broad and POSITIVE in lead II (vector down-and-left).
    { dir: [0.7, 0.7, -0.1], mag: 1.5, center: 40, width: 26, segment: 'QRS' },
    { dir: [0.82, 0.5, -0.35], mag: 1.0, center: 78, width: 24, segment: 'QRS' },
    // Discordant T — opposite the tall QRS.
    { dir: [-0.6, -0.55, 0.2], mag: 0.6, center: 196, width: 72, segment: 'T' },
  ],
  events: [
    { structure: 'FOCUS', start: 0, end: 18, kind: 'ventricle', note: 'ectopic RV focus fires' },
    { structure: 'RV', start: 8, end: 62, kind: 'ventricle' },
    { structure: 'LV', start: 52, end: 150, kind: 'ventricle', note: 'spreads to LV late — no His-Purkinje shortcut' },
    { structure: 'RV', start: 210, end: 360, kind: 'repol' },
    { structure: 'LV', start: 240, end: 400, kind: 'repol' },
  ],
})

/** The on-time sinus P that finds the ventricle refractory: a lone, non-conducted P. */
const ghostPBeat = (onset: number): Beat => ({
  onset,
  label: 'P*',
  lobes: atrialLobes(),
  events: [
    ...atrialEvents().map((e) =>
      e.structure === 'AV'
        ? { ...e, note: 'P blocked — ventricle still refractory' }
        : e,
    ),
  ],
})

export const vpcRv: Condition = {
  id: 'vpc-rv',
  name: 'Ventricular premature complex — RV origin',
  shortName: 'VPC (RV origin)',
  category: 'Ectopy & arrhythmia',
  tagline: 'A focus jumps the gun in the RV — no P, broad QRS, discordant T, full compensatory pause.',
  criteria: [
    'Early, broad QRS (≥ 120 ms)',
    'No preceding P wave',
    'LBBB morphology (RV origin)',
    'Discordant T wave',
    'Full compensatory pause',
  ],
  story: 'NSR → NSR → VPC (broad, +ve) → P* hidden in T → compensatory pause → NSR',
  description:
    'An irritable focus in the right ventricle fires before the next sinus beat is due. ' +
    'Because it starts in muscle — not the His-Purkinje highway — the impulse spreads ' +
    'slowly, cell to cell, from RV to LV, so the QRS is broad and bizarre. RV origin means ' +
    'the LV is activated last (an LBBB-like shape: broad and positive in lead II). ' +
    'Repolarization runs opposite, giving the discordant T. Meanwhile the SA node is ' +
    "untouched and keeps its own rhythm — the next sinus P arrives right on schedule but " +
    'finds the ventricle refractory (the hidden "P*"), so it is not conducted. The ventricle ' +
    'then waits for the following sinus beat: a full compensatory pause.',
  segmentNotes: [
    { segment: 'QRS', title: 'Broad QRS, no P', detail: 'Born in ventricular muscle → no atrial kick first, and slow cell-to-cell spread widens the QRS.' },
    { segment: 'QRS', title: 'LBBB-like, +ve in II', detail: 'RV origin activates the LV last; the net vector points down-left → tall and broad in lead II.' },
    { segment: 'T', title: 'Discordant T', detail: 'Abnormal depolarization order reverses repolarization → the T points opposite the QRS.' },
    { segment: 'P', title: 'Hidden P* + pause', detail: 'The on-time sinus P lands in the VPC’s refractory period (buried in the T). Next conduction is the following sinus beat → full compensatory pause.' },
  ],
  buildStrip: () => ({
    beats: [
      sinusBeat(0, 'Beat 1'),
      sinusBeat(RR_DEFAULT, 'Beat 2'),
      vpcBeat(VPC_ONSET),
      ghostPBeat(GHOST_P_ONSET),
      sinusBeat(RESUME_ONSET),
    ],
    durationMs: STRIP_MS,
  }),
}
