/** Transcribed from docs/rebuild/04-CARDS.md §19 — do not edit wording here. */
import { Card } from '../schema'

export const lvhStrain: Card = {
  id: 'lvh-strain',
  name: 'LVH with strain',
  aliases: ['LVH', 'hypertrophy', 'strain', 'voltage', 'mimic', 'Sokolow'],
  category: 'High-risk patterns',
  lethal: false,
  tagline: 'Big voltages, dramatic ST-T — the pattern that sends clean coronaries to the cath lab.',
  seeIt: {
    traceId: 'ptbxl-767-lvh-strain',
    extraTraceIds: ['ptbxl-273-lvh-strain'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'LVH with secondary ST-T changes', correct: true, tempts: 'Yes — huge voltages with proportionate, asymmetric repolarization. Find the old ECG.' },
        { label: 'Anterior/lateral ischemia', tempts: 'The lateral T inversion is ASYMMETRIC (slow down, quick up) and married to huge voltages — proportionate, secondary.' },
        { label: 'Posterior occlusion MI', tempts: 'Deep S V1–V3 with STE over them is the discordance of hypertrophy, not mirror-image occlusion.' },
        { label: 'Old infarct', tempts: 'No Q waves; the R waves are enormous, not lost.' },
      ],
    },
  },
  why: [
    'More muscle, more vector: tall lateral Rs, deep right-precordial Ss.',
    'The thick wall repolarizes inside-out — asymmetric “strain” ST-T follows the voltage, opposite the QRS.',
    'It’s the same discordance logic as LBBB: proportionate secondary change, not injury.',
  ],
  whyDrawer: [
    { cause: 'Chronic pressure load thickens the LV wall', effect: 'A bigger depolarization vector: tall lateral Rs, deep V1–V3 Ss' },
    { cause: 'The thickened wall repolarizes abnormally, inside-out', effect: '“Strain”: down-sloping ST with asymmetric T inversion in the biggest-R leads' },
    { cause: 'Repolarization change is proportionate to the voltage under it', effect: 'STE over deep S waves in V1–V3 — expected discordance, not injury' },
    { cause: 'The pattern is chronic and stable', effect: 'An old ECG is the mimic’s alibi — find one' },
  ],
  pills: [
    { kind: 'pearl', text: 'Sokolow–Lyon: S(V1) + R(V5 or V6) ≥35 mm suggests LVH (age >35). Voltage criteria are specific-ish, never sensitive.' },
    { kind: 'trap', text: 'LVH is a leading driver of false cath-lab activations: STE in V1–V3 over deep S waves is expected discordance. Judge ST against the QRS beneath it.' },
    { kind: 'night-eye', text: 'Strain T inversion: asymmetric, down-sloping take-off, in the leads with the biggest Rs. Symmetric inversions in modest-voltage leads → think ischemia instead.', linkCardId: 'wellens' },
  ],
  suspectConfirm: [
    { text: 'New dramatic ST-T with hypertension history: find an old ECG — stability is the mimic’s alibi.', cites: ['AHA-ACS-2025'] },
    { text: 'Echo settles the hypertrophy; the story and serials settle the ischemia.', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'No acute ECG-directed therapy — manage the blood pressure and the actual complaint.', cites: ['AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'lvh-strain',
    authoredReason: 'Wall-thickness scaling is authored (LV sources ×1.6) with a strain repolarization source; solver masses are calibrated to normal.',
    mustShow: [
      'the thick LV wall glowing harder (voltage)',
      'repolarization reversing across the thickened wall (strain)',
      'the discordance logic shared with LBBB',
    ],
    primaryLead: 'V5',
  },
  assertions: [
    { on: 'model', check: 'custom', name: 'sokolow', note: 'S(V1) + R(V5) ≥ 3.5 mV' },
    { on: 'model', check: 'tPolarity', lead: 'V5', sign: '-' },
    { on: 'model', check: 'stShift', lead: 'V5', sign: '-' },
    { on: 'model', check: 'qrsMs', min: 60, max: 120 },
    { on: 'trace', check: 'custom', name: 'sokolow', note: 'voltage criterion on the recording' },
    { on: 'trace', check: 'tPolarity', lead: 'V5', sign: '-' },
    { on: 'trace', check: 'stShift', lead: 'V5', sign: '-' },
  ],
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
