import { Beat, Condition } from '../engine/types'
import { atrialEvents, atrialLobes, RR_DEFAULT } from './helpers'

/**
 * Left bundle branch block. The septum now depolarizes right-to-left (reversed),
 * erasing the normal septal q, and the whole left ventricle is reached late and
 * slowly. The result is a broad, notched, all-left QRS: monophasic R in I/V6,
 * deep QS in V1, and a T wave forced discordant (opposite the main deflection).
 */
const lbbbBeat = (onset: number): Beat => ({
  onset,
  lobes: [
    ...atrialLobes(),
    { dir: [0.5, 0.25, 0.1], mag: 0.2, center: 172, width: 12, segment: 'QRS' }, // reversed septum (no q in V6/I)
    { dir: [0.92, 0.4, -0.35], mag: 1.15, center: 205, width: 18, segment: 'QRS' }, // broad LV body
    { dir: [0.96, 0.32, -0.5], mag: 1.05, center: 242, width: 20, segment: 'QRS' }, // late notch → deep S in V1
    { dir: [-0.55, -0.35, 0.35], mag: 0.5, center: 378, width: 60, segment: 'T' }, // discordant T
  ],
  events: [
    ...atrialEvents(),
    { structure: 'HIS', start: 150, end: 164, kind: 'av' },
    { structure: 'RBB', start: 156, end: 178, kind: 'av' },
    { structure: 'SEPTUM', start: 170, end: 210, kind: 'ventricle', note: 'septum reversed: right → left' },
    { structure: 'RV', start: 168, end: 206, kind: 'ventricle' },
    { structure: 'LV', start: 206, end: 292, kind: 'ventricle', note: 'LV depolarizes late — muscle to muscle' },
    { structure: 'RV', start: 300, end: 430, kind: 'repol' },
    { structure: 'LV', start: 330, end: 470, kind: 'repol' },
  ],
})

export const lbbb: Condition = {
  id: 'lbbb',
  name: 'Left bundle branch block',
  shortName: 'LBBB',
  category: 'Conduction blocks',
  tagline: 'The septum fires backwards and the LV lags — a broad, all-leftward QRS.',
  criteria: [
    'QRS ≥ 120 ms',
    'Broad/notched monophasic R in I, V5–V6',
    'Deep QS or rS in V1',
    'Absent septal q in lateral leads',
    'Discordant ST/T (opposite the QRS)',
  ],
  story: 'Reversed septal activation → RV first → LV reached late and slowly',
  description:
    'With the left bundle blocked, the impulse crosses to the left side through the ' +
    'septum the wrong way (right-to-left), so the normal septal q in I/V6 disappears. ' +
    'The left ventricle — the dominant muscle — is then activated late and slowly, ' +
    'cell to cell, throwing a sustained leftward vector for the whole second half of ' +
    'the QRS. That is the broad, often-notched monophasic R in the lateral leads and the ' +
    'deep QS in V1. Because depolarization is so abnormal, repolarization is dragged ' +
    'the opposite way: the ST/T is discordant. (This discordance is exactly why a STEMI ' +
    'hiding inside LBBB is so hard to spot — the Sgarbossa case.)',
  segmentNotes: [
    { segment: 'QRS', title: 'Absent septal q', detail: 'Reversed (right→left) septal activation removes the normal small q in I, V5, V6.' },
    { segment: 'QRS', title: 'Broad monophasic R', detail: 'Slow, late LV depolarization holds a leftward vector → a wide, notched R in I/V6.' },
    { segment: 'QRS', title: 'Deep QS in V1', detail: 'That whole leftward-posterior vector points away from V1 → a deep negative complex.' },
    { segment: 'ST', title: 'Discordant ST/T', detail: 'Abnormal depolarization forces repolarization opposite the QRS — the rule LBBB usually obeys.' },
  ],
  blockedBranches: ['LBB', 'LAF', 'LPF'],
  buildStrip: () => ({
    beats: [lbbbBeat(0), lbbbBeat(RR_DEFAULT), lbbbBeat(RR_DEFAULT * 2)],
    durationMs: RR_DEFAULT * 3,
  }),
}
