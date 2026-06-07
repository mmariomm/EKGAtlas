import { Beat, Condition } from '../engine/types'
import { atrialSources, RR_DEFAULT } from './helpers'

/**
 * Right bundle branch block. LV + septum depolarize normally and on time (intact
 * left bundle); the RV is reached LATE, muscle-to-muscle, so a large late terminal
 * vector swings rightward and anterior (toward V1) → rSR' in V1, slurred S in I/V6,
 * discordant T in V1–V3, QRS ≥ 120 ms. The RV glow fires late — concordant with
 * that late terminal waveform, by construction.
 */
const rbbbBeat = (onset: number): Beat => ({
  onset,
  sources: [
    ...atrialSources(),
    { dir: [-0.35, 0.1, 0.65], mag: 0.16, center: 166, width: 8, segment: 'QRS', glow: { structures: ['SEPTUM'], kind: 'ventricle', start: 158, end: 188 } },
    { dir: [0.8, 0.45, -0.2], mag: 1.35, center: 190, width: 13, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 174, end: 216 } },
    { dir: [-0.62, -0.05, 0.82], mag: 0.62, center: 246, width: 21, segment: 'QRS', glow: { structures: ['RV'], kind: 'ventricle', start: 212, end: 284, note: 'RV depolarizes late — muscle to muscle' } },
    { dir: [0.45, 0.45, -0.28], mag: 0.34, center: 360, width: 52, segment: 'T', glow: { structures: ['RV', 'LV'], kind: 'repol', start: 322, end: 452 } },
  ],
  wires: [
    { structure: 'SA', start: 0, end: 14, kind: 'sa' },
    { structure: 'AV', start: 92, end: 156, kind: 'av', note: 'AV node delay' },
    { structure: 'HIS', start: 150, end: 166, kind: 'av' },
    { structure: 'LBB', start: 158, end: 174, kind: 'av' },
    { structure: 'LAF', start: 162, end: 182, kind: 'av' },
    { structure: 'LPF', start: 162, end: 180, kind: 'av' },
  ],
})

export const rbbb: Condition = {
  id: 'rbbb',
  name: 'Right bundle branch block',
  shortName: 'RBBB',
  category: 'Conduction blocks',
  tagline: 'Watch the right ventricle light up LATE — the terminal vector swings toward V1.',
  criteria: ['QRS ≥ 120 ms', "rSR' (“rabbit ears”) in V1", 'Wide slurred S in I and V6', 'Discordant T in V1–V3'],
  story: 'Normal start → LV on time → RV reached late, muscle-to-muscle',
  description:
    'The right bundle is blocked, so the septum and left ventricle still fire on time ' +
    'through the intact left bundle — the first half of the QRS looks normal. The right ' +
    'ventricle then has to be depolarized slowly, cell to cell, from the left. That late, ' +
    'unopposed rightward-and-anterior wavefront is the terminal vector you see swing back ' +
    "toward V1, producing the R' in V1 and the wide slurred S in the lateral leads.",
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
