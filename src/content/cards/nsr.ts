/** Transcribed from docs/rebuild/04-CARDS.md §1 — do not edit wording here. */
import { Card } from '../schema'

export const nsr: Card = {
  id: 'nsr',
  name: 'Normal sinus rhythm',
  aliases: ['normal', 'sinus', 'NSR', 'reference', 'baseline'],
  category: 'Reference',
  lethal: false,
  tagline: 'One vector, twelve shadows — the baseline every other card is measured against.',
  seeIt: {
    traceId: 'ptbxl-3-nsr',
    extraTraceIds: ['ptbxl-24-nsr'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Normal sinus rhythm', correct: true, tempts: 'Yes — P before every QRS, PR ≤200 ms, narrow QRS, steady rate.' },
        { label: 'Sinus tachycardia', tempts: 'Eyeball rates deceive — count the boxes: 300/150/100/75/60.' },
        { label: 'First-degree AV block', tempts: 'The PR is generous but ≤200 ms. Measure, don’t vibe.' },
        { label: 'Atrial fibrillation', tempts: 'A wandering baseline isn’t fibrillation — the P waves march.' },
      ],
    },
  },
  why: [
    'Every deflection is the heart’s electrical vector, projected onto that lead’s line of sight.',
    'Narrow QRS = both ventricles fired together, via healthy bundles.',
    'The PR pause is the AV node holding the door — the only normal route in.',
  ],
  whyDrawer: [
    { cause: 'The SA node fires first — it is the fastest natural pacemaker', effect: 'A small atrial sweep: the P wave, upright in II' },
    { cause: 'The AV node holds the impulse ~100 ms so the atria finish emptying', effect: 'The flat PR segment' },
    { cause: 'His → bundles → Purkinje deliver the impulse everywhere at once', effect: 'Both ventricles fire together: a narrow, tall QRS' },
    { cause: 'The ventricles repolarize outside-in', effect: 'A broad T wave, concordant with the QRS' },
  ],
  pills: [
    { kind: 'pearl', text: 'Rates by grid: 300–150–100–75–60 per large box. Faster than counting, harder to fool.' },
    { kind: 'night-eye', text: 'Normal intervals: PR 120–200 ms, QRS <120 ms, QTc <460 ms. Three numbers rule out half the catalog.' },
    { kind: 'lookalike', text: 'Irregular with P waves = sinus arrhythmia (breathes with the patient), not AF.', linkCardId: 'afib' },
  ],
  suspectConfirm: [
    { text: 'A normal ECG is a snapshot, not an alibi — symptoms + one strip decide nothing.', cites: ['AHA-ACS-2025'] },
    { text: 'Chest pain with a normal first ECG → serial ECGs and troponin.', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'No finding to treat — treat the patient in front of you.', cites: ['AHA-ACS-2025'] },
  ],
  rnMoves: [
    { text: 'Normal is a snapshot, not an alibi — chest pain with a clean first ECG stays on the monitor: repeat ECG in 10–15 min, troponin, escalate on any change.', cites: ['AHA-ACS-2025'] },
    { text: 'Know the three triage numbers cold: PR 120–200, QRS <120, QTc <460 — anything outside them earns a second look before filing.', cites: ['AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'solver',
    state: { pace: 'SA' },
    mustShow: [
      'SA fires, atria sweep (P)',
      'AV pause with the flat PR',
      'His and both bundles race',
      'both ventricles depolarize endo→epi together (narrow QRS)',
      'repolarization wash (T)',
    ],
    primaryLead: 'II',
  },
  assertions: [
    { on: 'model', check: 'rateBpm', min: 55, max: 95 },
    { on: 'trace', check: 'rateBpm', min: 55, max: 95 },
    { on: 'model', check: 'prMs', min: 120, max: 200 },
    { on: 'trace', check: 'prMs', min: 110, max: 210 },
    { on: 'model', check: 'qrsMs', min: 60, max: 119 },
    { on: 'trace', check: 'qrsMs', min: 60, max: 130 },
    { on: 'model', check: 'qtcMs', min: 350, max: 460 },
    { on: 'model', check: 'netQrs', lead: 'V1', sign: '-' },
    { on: 'trace', check: 'netQrs', lead: 'V1', sign: '-' },
    { on: 'model', check: 'netQrs', lead: 'V6', sign: '+' },
    { on: 'trace', check: 'netQrs', lead: 'V6', sign: '+' },
    { on: 'model', check: 'netQrs', lead: 'aVR', sign: '-' },
    { on: 'trace', check: 'netQrs', lead: 'aVR', sign: '-' },
    { on: 'model', check: 'axisDeg', min: -30, max: 90 },
  ],
  methodStep: 'rate',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
