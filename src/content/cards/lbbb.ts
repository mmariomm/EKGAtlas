/** Transcribed from docs/rebuild/04-CARDS.md §9 — do not edit wording here. */
import { Card } from '../schema'

export const lbbb: Card = {
  id: 'lbbb',
  name: 'Left bundle branch block',
  aliases: ['LBBB', 'wide QRS', 'left bundle', 'discordance', 'block'],
  category: 'Conduction',
  lethal: false,
  tagline: 'The whole left ventricle fires late and backward — and rewrites the ST rules with it.',
  seeIt: {
    traceId: 'ptbxl-338-lbbb',
    extraTraceIds: ['ptbxl-711-lbbb'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'LBBB', correct: true, tempts: 'Yes — wide QRS, dominant S in V1, broad notched lateral R, discordant ST/T.' },
        { label: 'Anterior STEMI', tempts: 'The STE in V1–V3 is *expected* discordance over deep S waves — proportionate, not injury. Learn the rule before the exception.', },
        { label: 'RBBB', tempts: 'Check V1’s terminal direction: down = left bundle problem.' },
        { label: 'Ventricular paced rhythm', tempts: 'Same physics (RV-first), but there’s no pacing spike here.' },
      ],
    },
  },
  why: [
    'The left bundle is cut — the septum now fires right-to-left (the septal q dies).',
    'The dominant LV depolarizes late and slowly — broad, notched leftward QRS.',
    'Abnormal depolarization forces abnormal repolarization: ST/T point OPPOSITE the QRS, in proportion.',
  ],
  whyDrawer: [
    { cause: 'The left bundle is blocked; only the right delivers on time', effect: 'The RV and right septum start the beat' },
    { cause: 'The septum is activated backwards, right-to-left', effect: 'The normal septal q in V5–V6 disappears' },
    { cause: 'The big LV waits for slow cell-to-cell spread', effect: 'A wide (≥120 ms), notched, leftward QRS' },
    { cause: 'Late depolarization forces late, reversed repolarization', effect: '“Appropriate discordance”: ST/T opposite the QRS, proportionally' },
  ],
  pills: [
    { kind: 'pearl', text: '“Appropriate discordance” is the baseline you’ll measure ischemia against — internalize it here, cash it in on the Sgarbossa card.', linkCardId: 'sgarbossa' },
    { kind: 'trap', text: '“New LBBB = automatic cath lab” is retired. New LBBB + a convincing story is still serious — but the criteria card decides.', linkCardId: 'sgarbossa' },
    { kind: 'night-eye', text: 'LBBB with *concordant* ST anywhere is never “just the block” — escalate.' },
  ],
  suspectConfirm: [
    { text: 'New LBBB deserves an echo and an ischemia conversation — it usually marks real structural disease.', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Chest pain + LBBB → apply Sgarbossa/Smith-modified criteria, not despair.', cites: ['SGARBOSSA-1996', 'SMITH-MSC-2012'] },
  ],
  rnMoves: [
    { text: 'New LBBB + chest pain = escalate now — criteria exist (Sgarbossa); never chart ’uninterpretable, LBBB’.', cites: ['AHA-ACS-2025'] },
    { text: 'ST pointing WITH the QRS anywhere in LBBB is never the block — call it in immediately.', cites: ['SGARBOSSA-1996'] },
    { text: 'Anticipate: echo and an ischemia workup — new LBBB usually marks real structural disease.', cites: ['AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'solver',
    state: { pace: 'SA', blockedEdges: ['HIS>LBB'] },
    mustShow: [
      'left bundle drawn blocked (greyed)',
      'septum depolarizes right→left (reversed)',
      'LV reached late, cell-to-cell',
      'broad leftward QRS while the LV sweep drags',
      'ST/T forced opposite the QRS',
    ],
    primaryLead: 'V1',
  },
  assertions: [
    { on: 'model', check: 'qrsMs', min: 120, max: 180 },
    { on: 'trace', check: 'qrsMs', min: 120, max: 190 },
    { on: 'model', check: 'netQrs', lead: 'V1', sign: '-' },
    { on: 'trace', check: 'netQrs', lead: 'V1', sign: '-' },
    { on: 'model', check: 'netQrs', lead: 'V6', sign: '+' },
    { on: 'trace', check: 'netQrs', lead: 'V6', sign: '+' },
    // V1 T discordance is asserted on the RECORDING; the solver's simplified
    // distributed-T model is knife-edge there (documented scope limit). The
    // lateral discordance — the Sgarbossa groundwork — is asserted on both.
    { on: 'trace', check: 'tPolarity', lead: 'V1', sign: '+' },
    { on: 'model', check: 'tPolarity', lead: 'V6', sign: '-' },
    { on: 'trace', check: 'tPolarity', lead: 'V6', sign: '-' },
    { on: 'model', check: 'custom', name: 'noSeptalQ', note: 'no initial q in V6: mean of first 30 ms of QRS in V6 ≥ −0.02 mV' },
    { on: 'trace', check: 'custom', name: 'noSeptalQ', note: 'no initial q in V6 on the recording' },
  ],
  methodStep: 'morphology',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
