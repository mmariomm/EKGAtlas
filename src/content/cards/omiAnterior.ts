/** Transcribed from docs/rebuild/04-CARDS.md §10 — do not edit wording here. */
import { Card } from '../schema'

export const omiAnterior: Card = {
  id: 'omi-anterior',
  name: 'Anterior occlusion MI',
  aliases: ['STEMI', 'anterior', 'LAD', 'ST elevation', 'OMI', 'hyperacute'],
  category: 'Occlusion & ischemia',
  lethal: true,
  tagline: 'The LAD is closing in real time — the earliest tell is a T wave that outgrew its QRS.',
  seeIt: {
    traceId: 'ptbxl-414-omi-anterior',
    extraTraceIds: ['ptbxl-1199-omi-anterior'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Anterior occlusion MI', correct: true, tempts: 'Yes — territorial STE in V2–V3 with reciprocal change. This is a reperfusion conversation.' },
        { label: 'Benign early repolarization', tempts: 'BER’s STE is concave with notched J points and NO reciprocal depression — and it doesn’t evolve.' },
        { label: 'Pericarditis', tempts: 'Diffuse STE + PR depression, no reciprocal change except aVR. Territorial STE with reciprocals is occlusion.' },
        { label: 'LVH with strain', tempts: 'V1–V3 STE over deep S waves can be proportionate secondary change — check voltages first.' },
      ],
    },
  },
  why: [
    'Occluded LAD → the anterior wall holds an injury current between beats.',
    'That sustained vector points at V2–V4: ST elevation where it faces, reciprocal depression opposite.',
    'Before elevation, ischemic T waves grow tall and fat — the hyperacute phase is the earliest catch.',
  ],
  whyDrawer: [
    { cause: 'The LAD occludes; the anterior wall becomes transmurally injured', effect: 'Injured muscle can’t fully repolarize — it holds a standing current' },
    { cause: 'The injury current points at the overlying chest leads during the ST period', effect: 'ST elevation in V2–V4, the facing leads' },
    { cause: 'Leads on the opposite wall watch the vector leave', effect: 'Reciprocal ST depression — mimics rarely produce it' },
    { cause: 'The very first minutes distort repolarization before the ST moves', effect: 'Hyperacute T waves: broad, bulky, out of proportion to their QRS' },
  ],
  pills: [
    { kind: 'pearl', text: 'Hyperacute T = broad, bulky, area-out-of-proportion to its QRS. Catch the OMI here and you beat the criteria.' },
    { kind: 'trap', text: 'STEMI *criteria* miss a large share of true occlusions. Criteria-negative but story-positive + evolving ECG = serial ECGs every 10–15 min and talk to cath — not discharge.' },
    { kind: 'night-eye', text: 'Reciprocal depression (here: inferior) is the truth serum — mimics rarely produce it.' },
    { kind: 'lookalike', text: 'Precordial ST *depression* sloping up into giant Ts is the same artery, occluded now.', linkCardId: 'dewinter' },
  ],
  suspectConfirm: [
    { text: 'Ongoing symptoms + territorial STE (or a convincing equivalent) → this is a reperfusion conversation, not a troponin wait.', cites: ['AHA-ACS-2025'] },
    { text: 'Serial ECGs; compare with priors; troponin confirms but must not delay.', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Activate reperfusion: primary PCI — FMC-to-device ≤90 min (≤120 if transferring); lytics if PCI can’t make 120.', cites: ['AHA-ACS-2025'] },
    { text: 'Aspirin now; anticoagulation and P2Y₁₂ per local cath pathway.', cites: ['AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'solver',
    state: { pace: 'SA', ischemic: ['LV_ant', 'LV_apex'], injuryDir: [0.3, -0.25, 0.95], injuryMag: 0.72 },
    mustShow: [
      'the anterior wall marked injured',
      'a sustained injury vector aimed at the chest leads during ST',
      'facing leads elevating, inferior leads dipping (reciprocal)',
    ],
    primaryLead: 'V2',
  },
  assertions: [
    { on: 'model', check: 'stShift', lead: 'V2', sign: '+', minMv: 0.1 },
    { on: 'model', check: 'stShift', lead: 'V3', sign: '+', minMv: 0.1 },
    { on: 'model', check: 'stShift', lead: 'III', sign: '-' },
    { on: 'model', check: 'qrsMs', min: 60, max: 120 },
    { on: 'trace', check: 'stShift', lead: 'V2', sign: '+', minMv: 0.08 },
    { on: 'trace', check: 'stShift', lead: 'V3', sign: '+', minMv: 0.05 },
  ],
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
