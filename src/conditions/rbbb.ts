import { Beat, Condition } from '../engine/types'
import { atrialEvents, atrialLobes, RR_DEFAULT } from './helpers'

/**
 * Right bundle branch block. The LV and septum depolarize normally and on time;
 * the RV is reached late, muscle-to-muscle, so a large LATE terminal vector
 * swings rightward and anterior (toward V1) → rSR' in V1, slurred S in I/V6,
 * QRS ≥ 120 ms.
 */
const rbbbBeat = (onset: number): Beat => ({
  onset,
  lobes: [
    ...atrialLobes(),
    { dir: [-0.35, 0.1, 0.65], mag: 0.16, center: 166, width: 8, segment: 'QRS' }, // septal q (intact LBB)
    { dir: [0.8, 0.45, -0.2], mag: 1.35, center: 190, width: 13, segment: 'QRS' }, // main R (LV, on time)
    { dir: [-0.62, -0.05, 0.82], mag: 0.62, center: 246, width: 21, segment: 'QRS' }, // late RV → R' / terminal S
    // Discordant T: inverted in V1–V3 (secondary to the late rightward-anterior forces), upright laterally.
    { dir: [0.45, 0.45, -0.28], mag: 0.34, center: 360, width: 52, segment: 'T' },
  ],
  events: [
    ...atrialEvents(),
    { structure: 'HIS', start: 150, end: 164, kind: 'av' },
    { structure: 'LBB', start: 156, end: 172, kind: 'av' },
    { structure: 'LAF', start: 160, end: 178, kind: 'av' },
    { structure: 'LPF', start: 160, end: 176, kind: 'av' },
    { structure: 'SEPTUM', start: 160, end: 180, kind: 'ventricle' },
    { structure: 'LV', start: 174, end: 214, kind: 'ventricle' },
    { structure: 'RV', start: 214, end: 282, kind: 'ventricle', note: 'RV depolarizes late — muscle to muscle' },
    { structure: 'LV', start: 300, end: 430, kind: 'repol' },
    { structure: 'RV', start: 320, end: 448, kind: 'repol' },
  ],
})

export const rbbb: Condition = {
  id: 'rbbb',
  name: 'Right bundle branch block',
  shortName: 'RBBB',
  category: 'Conduction blocks',
  tagline: 'Watch the right ventricle light up LATE — the terminal vector swings toward V1.',
  criteria: [
    'QRS ≥ 120 ms',
    "rSR' (“rabbit ears”) in V1",
    'Wide slurred S in I and V6',
    'Discordant T in V1–V3',
  ],
  story: 'Normal start → LV on time → RV reached late, muscle-to-muscle',
  description:
    'The right bundle is blocked, so the septum and left ventricle still fire on time ' +
    'through the intact left bundle — the first half of the QRS looks normal. The right ' +
    'ventricle then has to be depolarized slowly, cell to cell, from the left. That late, ' +
    'unopposed rightward-and-anterior wavefront is the terminal vector you see swing back ' +
    "toward V1, producing the R' (“second rabbit ear”) in V1 and the wide slurred S in " +
    'the lateral leads. Total QRS widens past 120 ms.',
  segmentNotes: [
    { segment: 'QRS', title: 'Early QRS (normal)', detail: 'LBB intact → septum and LV depolarize on time. Initial forces look like baseline.' },
    { segment: 'QRS', title: "Terminal R' in V1", detail: 'Late RV activation throws a rightward-anterior vector at V1 → the second rabbit ear.' },
    { segment: 'QRS', title: 'Slurred S in I / V6', detail: 'That same late rightward vector points AWAY from the lateral leads → a wide terminal S.' },
    { segment: 'T', title: 'Discordant T (V1–V3)', detail: 'Abnormal depolarization order forces repolarization to run backwards → T opposite the R′.' },
  ],
  blockedBranches: ['RBB'],
  buildStrip: () => ({
    beats: [rbbbBeat(0), rbbbBeat(RR_DEFAULT), rbbbBeat(RR_DEFAULT * 2)],
    durationMs: RR_DEFAULT * 3,
  }),
}
