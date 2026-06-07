import { Beat, Condition } from '../engine/types'
import { atrialSources, RR_DEFAULT } from './helpers'

/**
 * Left bundle branch block. The septum depolarizes right-to-left (reversed, no
 * septal q); the RV fires early via the intact right bundle; the LV is reached
 * late and slowly, throwing a broad sustained leftward vector → monophasic R in
 * I/V6, deep QS in V1, with discordant ST (elevation V1–V3, depression I/V5–V6)
 * and T. The LV glow fires late — concordant with that late waveform.
 */
const lbbbBeat = (onset: number): Beat => ({
  onset,
  sources: [
    ...atrialSources(),
    { dir: [0.5, 0.25, 0.1], mag: 0.2, center: 172, width: 12, segment: 'QRS', glow: { structures: ['SEPTUM'], kind: 'ventricle', start: 168, end: 206, note: 'septum reversed: right → left' } },
    { dir: [0.2, 0.2, 0.5], mag: 0, center: 185, width: 1, segment: 'QRS', glow: { structures: ['RV'], kind: 'ventricle', start: 168, end: 206 } }, // RV early (intact RBB) — glow only
    { dir: [0.92, 0.4, -0.35], mag: 1.15, center: 205, width: 18, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 200, end: 272, note: 'LV depolarizes late — muscle to muscle' } },
    { dir: [0.96, 0.32, -0.5], mag: 1.05, center: 242, width: 20, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 240, end: 292 } },
    // discordant ST (elevation V1–V3, depression I/V5–V6) — basis of Sgarbossa
    { dir: [-0.5, -0.3, 0.32], mag: 0.2, center: 305, width: 30, segment: 'ST' },
    { dir: [-0.55, -0.35, 0.35], mag: 0.5, center: 378, width: 60, segment: 'T', glow: { structures: ['RV', 'LV'], kind: 'repol', start: 320, end: 470 } },
  ],
  wires: [
    { structure: 'SA', start: 0, end: 14, kind: 'sa' },
    { structure: 'AV', start: 92, end: 156, kind: 'av', note: 'AV node delay' },
    { structure: 'HIS', start: 150, end: 166, kind: 'av' },
    { structure: 'RBB', start: 158, end: 178, kind: 'av' },
  ],
})

export const lbbb: Condition = {
  id: 'lbbb',
  name: 'Left bundle branch block',
  shortName: 'LBBB',
  category: 'Conduction blocks',
  tagline: 'The septum fires backwards and the LV lags — a broad, all-leftward QRS.',
  criteria: ['QRS ≥ 120 ms', 'Broad/notched monophasic R in I, V5–V6', 'Deep QS in V1', 'Absent septal q laterally', 'Discordant ST/T'],
  story: 'Reversed septal activation → RV first → LV reached late and slowly',
  description:
    'With the left bundle blocked, the impulse crosses to the left through the septum the ' +
    'wrong way (right-to-left), so the normal septal q disappears. The left ventricle — the ' +
    'dominant muscle — is then activated late and slowly, throwing a sustained leftward vector ' +
    'for the whole second half of the QRS: the broad, often-notched R in the lateral leads and ' +
    'the deep QS in V1. Because depolarization is so abnormal, repolarization is dragged the ' +
    'opposite way — the discordant ST/T. (That discordance is exactly why a STEMI hiding inside ' +
    'LBBB is so hard to spot — the Sgarbossa case.)',
  segmentNotes: [
    { segment: 'QRS', title: 'Absent septal q', detail: 'Reversed (right→left) septal activation removes the normal small q in I, V5, V6.' },
    { segment: 'QRS', title: 'Broad monophasic R', detail: 'Slow, late LV depolarization holds a leftward vector → a wide, notched R in I/V6.' },
    { segment: 'QRS', title: 'Deep QS in V1', detail: 'That whole leftward-posterior vector points away from V1 → a deep negative complex.' },
    { segment: 'ST', title: 'Discordant ST/T', detail: 'Abnormal depolarization forces repolarization opposite the QRS — the rule LBBB usually obeys.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'Wide QRS; broad/notched R in I & V6; deep QS in V1; absent septal q',
    ischemia: 'Discordant ST/T is the rule here — use Sgarbossa to unmask a true STEMI',
  },
  clinical: 'New LBBB + ischemic symptoms → treat as a STEMI-equivalent: activate the cath lab. Use Sgarbossa criteria to read a STEMI hiding inside LBBB.',
  blockedBranches: ['LBB', 'LAF', 'LPF'],
  buildStrip: () => ({
    beats: [lbbbBeat(0), lbbbBeat(RR_DEFAULT), lbbbBeat(RR_DEFAULT * 2)],
    durationMs: RR_DEFAULT * 3,
  }),
}
