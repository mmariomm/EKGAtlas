/** Transcribed from docs/rebuild/04-CARDS.md §20 — do not edit wording here. */
import { Card } from '../schema'

export const brugada: Card = {
  id: 'brugada',
  name: 'Brugada pattern (type 1)',
  aliases: ['Brugada', 'coved', 'shark fin', 'channelopathy', 'syncope'],
  category: 'High-risk patterns',
  lethal: true,
  tagline: 'A coved wave in V1–V2 that marks a sodium-channel disease — found at 3 a.m., often by accident.',
  moduleHref: { href: '/lab/electrodes?swap=high-v1v2', label: 'Try it: high V1–V2 placement manufactures pseudo-Brugada — the Electrode Lab shows how' },
  seeIt: {
    traceId: 'brugada-model',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Brugada type 1', correct: true, tempts: 'Yes — coved STE flowing into an inverted T, V1–V2 only. A channel, not a coronary.' },
        { label: 'RBBB', tempts: 'The pseudo-R′ fools everyone — but there’s no broad S in I/V6, and the STE coves downward into an inverted T.' },
        { label: 'Anteroseptal occlusion MI', tempts: 'Coved, down-sloping STE limited to V1–V2 without reciprocals — different beast; the story (syncope, fever, family history) decides.' },
        { label: 'High lead placement artifact', tempts: 'Legitimate suspicion! V1–V2 placed high can manufacture this shape in healthy chests — verify placement before labeling a life.' },
      ],
    },
  },
  why: [
    'A sodium-channel defect makes the RV outflow tract repolarize early and unevenly.',
    'V1–V2 sit right on top of it: coved STE ≥2 mm sliding into an inverted T.',
    'The rest of the ECG is normal — the danger hides in two leads.',
  ],
  whyDrawer: [
    { cause: 'Reduced sodium current (often SCN5A loss of function)', effect: 'A weakened upstroke, worst where Ito is strongest — the RV epicardium' },
    { cause: 'The RVOT epicardium loses its action-potential dome; the endocardium keeps it', effect: 'A transmural voltage gradient across the outflow tract' },
    { cause: 'V1–V2 sit directly over that gradient', effect: 'Coved (“shark-fin”) ST elevation flowing into an inverted T — type 1' },
    { cause: 'The same repolarization dispersion permits phase-2 reentry', effect: 'Polymorphic VT/VF — syncope or sudden death, often in sleep or fever' },
  ],
  pills: [
    { kind: 'pearl', text: 'Type 1 (coved ≥2 mm, V1–V2, standard or high leads) is the only diagnostic shape; saddleback (type 2) is only a reason to look harder.' },
    { kind: 'trap', text: 'Fever unmasks and worsens it — treat fever aggressively and re-record the ECG after.' },
    { kind: 'night-eye', text: 'Incidental type 1 + syncope or family sudden death = do not discharge from triage; EP consult.' },
    { kind: 'lookalike', text: 'High V1–V2 placement manufactures pseudo-Brugada in healthy patients — check electrode position before the label sticks. Try it in the Electrode Lab.', linkCardId: 'rbbb' },
  ],
  suspectConfirm: [
    { text: 'Ask three things: syncope, family sudden death <45, fever with the pattern.', cites: ['SHANGHAI-2016'] },
    { text: 'Confirm placement; repeat with correctly placed (and, in EP hands, high) leads.', cites: ['ESC-VA-2022'] },
  ],
  guidelineMoves: [
    { text: 'Symptomatic type 1 → EP referral (ICD discussion); asymptomatic → risk-stratify, avoid provoking drugs, treat fever.', cites: ['ESC-VA-2022'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'brugada',
    authoredReason: 'The RVOT ion-channel gradient is modeled as its surface morphology (v1-validated values).',
    mustShow: [
      'the RVOT region as the culprit',
      'the coved ST descending into a negative T',
      'nothing wrong in the rest of the heart',
    ],
    primaryLead: 'V1',
  },
  assertions: [
    { on: 'model', check: 'stShift', lead: 'V1', sign: '+', minMv: 0.2 },
    { on: 'model', check: 'tPolarity', lead: 'V1', sign: '-' },
    { on: 'model', check: 'qrsMs', min: 60, max: 120 },
    { on: 'model', check: 'custom', name: 'covedShape', note: 'V1 descends monotonically from J+40 toward the T nadir (the cove)' },
  ],
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
