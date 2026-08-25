/** Transcribed from docs/rebuild/04-CARDS.md §14 — do not edit wording here. */
import { Card } from '../schema'

export const wellens: Card = {
  id: 'wellens',
  name: 'Wellens syndrome',
  aliases: ['Wellens', 'biphasic T', 'T inversion', 'LAD', 'warning'],
  category: 'Occlusion & ischemia',
  lethal: true,
  tagline: 'The pain is gone, the ECG looks calm — and the LAD is critically narrowed behind both.',
  moduleHref: { href: '/evolution', label: 'Watch the reperfusion arc: biphasic → deep inversion → pseudonormalization' },
  seeIt: {
    traceId: 'ptbxl-11682-wellens',
    extraTraceIds: ['ptbxl-18810-wellens'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Wellens pattern — critical LAD', correct: true, tempts: 'Yes — anterior T inversions with preserved R waves in a recent-pain patient. No stress test.' },
        { label: 'Nonspecific T changes', tempts: 'Deep SYMMETRIC V2–V3 inversions in a recent-chest-pain patient are never “nonspecific”.' },
        { label: 'Old anterior infarct', tempts: 'Old infarcts lose R waves and carry Qs — Wellens preserves the Rs. That’s the point.' },
        { label: 'Persistent juvenile T pattern', tempts: 'A young-pattern lookalike exists (V1–V3, asymmetric, asymptomatic) — the story separates them.' },
      ],
    },
  },
  why: [
    'A critical LAD lesion occluded, then spontaneously reopened — the pain resolved.',
    'Depolarization recovered (R waves intact); repolarization didn’t.',
    'The stunned anterior wall writes deep symmetric (or biphasic) Ts in V2–V3 — while the patient feels fine.',
  ],
  whyDrawer: [
    { cause: 'A critical proximal LAD lesion transiently occludes', effect: 'Anterior-wall ischemia — usually the episode of chest pain' },
    { cause: 'The lesion spontaneously reperfuses; the pain resolves', effect: 'Depolarization recovers (R waves preserved), repolarization stays disturbed' },
    { cause: 'Post-ischemic repolarization delay in the reperfused wall', effect: 'Deep, symmetric (type B) or biphasic (type A) T waves in V2–V3 — recorded pain-free' },
    { cause: 'The lesion re-occludes', effect: 'The Ts “pseudonormalize” (turn upright) as pain returns — that is deterioration, an emergency' },
  ],
  pills: [
    { kind: 'trap', text: 'The calm ECG invites a stress test — which can close the artery. Wellens = NO stress testing; angiography instead.' },
    { kind: 'pearl', text: 'Type A = biphasic (up-then-down); type B = deep symmetric inversion. A often evolves into B.' },
    { kind: 'night-eye', text: 'Inverted Ts turning UPRIGHT during recurrent pain = pseudo-normalization = the artery re-closing. That’s a deterioration.' },
  ],
  suspectConfirm: [
    { text: 'Recent angina + V2–V3 T pattern + preserved Rs + near-normal troponin = Wellens; admit and image the LAD.', cites: ['DEZWAAN-1982', 'AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Admit, antithrombotic therapy per ACS pathway, early angiography — no stress test.', cites: ['AHA-ACS-2025'] },
  ],
  rnMoves: [
    { text: 'Pain gone + deep or biphasic V2–V3 Ts = a warning shot, not reassurance: this patient is admitted, not discharged — and never sent to a treadmill. Speak up.', cites: ['AHA-ACS-2025', 'DEZWAAN-1982'] },
    { text: 'Watch: those Ts turning UPRIGHT during recurrent pain = the artery re-closing — new ECG and escalate now.', cites: ['AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'wellens',
    authoredReason: 'Post-reperfusion repolarization disturbance is not a solver state; QRS is solver-generated, the T authored (v1-validated values).',
    mustShow: [
      'normal depolarization — the R waves preserved',
      'the reperfused anterior wall repolarizing backwards',
      'the T vector swinging away from V2–V3',
    ],
    primaryLead: 'V3',
  },
  assertions: [
    { on: 'model', check: 'tPolarity', lead: 'V2', sign: '-' },
    { on: 'model', check: 'tPolarity', lead: 'V3', sign: '-' },
    { on: 'model', check: 'tPolarity', lead: 'V6', sign: '+' },
    { on: 'model', check: 'qrsMs', min: 60, max: 120 },
    { on: 'trace', check: 'tPolarity', lead: 'V2', sign: '-' },
    { on: 'trace', check: 'tPolarity', lead: 'V3', sign: '-' },
    { on: 'trace', check: 'qrsMs', min: 60, max: 120 },
    { on: 'trace', check: 'custom', name: 'preservedR', note: 'R amplitude in V3 ≥ 0.2 mV — the infarct has not happened yet' },
  ],
  methodStep: 'st-t',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
