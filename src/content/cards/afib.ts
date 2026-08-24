/** Transcribed from docs/rebuild/04-CARDS.md §2 — do not edit wording here. */
import { Card } from '../schema'

export const afib: Card = {
  id: 'afib',
  name: 'Atrial fibrillation',
  aliases: ['AF', 'afib', 'irregular', 'fibrillation'],
  category: 'Rate & rhythm',
  lethal: false,
  tagline: 'No two RR intervals agree, and nobody is steering the atria.',
  seeIt: {
    traceId: 'ptbxl-330-afib',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Atrial fibrillation', correct: true, tempts: 'Yes — irregularly irregular, no organized P, fibrillatory baseline.' },
        { label: 'Sinus with PACs', tempts: 'Frequent PACs feel chaotic, but the underlying march survives between them.' },
        { label: 'Atrial flutter, variable block', tempts: 'Flutter’s baseline is a sawtooth ruler; AF’s is static fuzz.' },
        { label: 'Multifocal atrial tachycardia', tempts: 'MAT has real P waves — ≥3 shapes. AF has none at all.' },
      ],
    },
  },
  why: [
    'The atria no longer contract as one — hundreds of wavelets shimmer instead of a single sweep.',
    'No organized atrial vector → no P wave, only baseline fibrillation.',
    'The AV node passes wavefronts at random → irregularly irregular R waves.',
  ],
  whyDrawer: [
    { cause: 'Re-entrant wavelets (often from the pulmonary veins) fragment atrial activation', effect: 'The atria quiver at 400–600/min instead of contracting' },
    { cause: 'Hundreds of tiny wavefronts cancel each other electrically', effect: 'No P wave — a fibrillatory baseline, best seen in V1' },
    { cause: 'The AV node is bombarded and conducts unpredictably', effect: 'Irregularly irregular ventricular response' },
    { cause: 'The atria no longer empty by contraction', effect: 'Stasis — the stroke-risk conversation every AF deserves' },
  ],
  pills: [
    { kind: 'trap', text: 'A *regular* slow wide rhythm in known AF = the AV node has failed (complete block with escape) — or dig toxicity. Regularized AF is never boring.' },
    { kind: 'night-eye', text: 'March the R waves with calipers or paper edge. If no two intervals match and there are no P waves — AF.' },
    { kind: 'pearl', text: 'The machine over-calls AF (artifact, PACs) and those calls often go uncorrected. Never confirm AF without seeing the irregularity yourself.' },
    { kind: 'lookalike', text: 'Organized sawtooth at ~300/min = flutter. If the rate sits at exactly ~150, hunt for it.', linkCardId: 'aflutter' },
  ],
  suspectConfirm: [
    { text: 'New AF: electrolytes, TSH, and an echo belong in the workup.', cites: ['AHA-AF-2023'] },
    { text: 'Estimate stroke risk (CHA₂DS₂-VASc) before the rhythm conversation.', cites: ['AHA-AF-2023'] },
  ],
  guidelineMoves: [
    { text: 'Unstable from the rhythm → synchronized cardioversion now.', cites: ['AHA-ACLS-2020'] },
    { text: 'Stable → rate control (beta-blocker or diltiazem), then the anticoagulation decision.', cites: ['AHA-AF-2023'] },
    { text: 'Onset unclear or >48 h → anticoagulation strategy before elective cardioversion.', cites: ['AHA-AF-2023'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'afib',
    authoredReason: 'Chaotic multi-wavelet atrial activity is beyond the solver’s region graph.',
    mustShow: [
      'atria shimmer without an organized sweep',
      'no P — fibrillatory baseline',
      'AV node flickers under bombardment',
      'ventricles fire normally but off-beat (irregular RR)',
    ],
    primaryLead: 'II',
  },
  assertions: [
    { on: 'trace', check: 'irregularRR', cvMin: 0.1 },
    { on: 'model', check: 'irregularRR', cvMin: 0.1 },
    { on: 'trace', check: 'qrsMs', min: 60, max: 120 },
    { on: 'model', check: 'custom', name: 'noOrganizedP', note: 'no organized atrial wave: every P-segment source ≤0.05 mV (fibrillatory noise only)' },
    { on: 'trace', check: 'custom', name: 'noConsistentP', note: 'pre-QRS windows do not repeat a consistent P shape (mean pairwise correlation < 0.5)' },
  ],
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
