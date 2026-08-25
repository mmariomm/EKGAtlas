/** Transcribed from docs/rebuild/04-CARDS.md §3 — do not edit wording here. */
import { Card } from '../schema'

export const aflutter: Card = {
  id: 'aflutter',
  name: 'Atrial flutter',
  aliases: ['flutter', 'sawtooth', '2:1', '150'],
  category: 'Rate & rhythm',
  lethal: false,
  tagline: 'A regular tachycardia at exactly 150 is flutter until you prove otherwise.',
  seeIt: {
    traceId: 'ptbxl-23-aflutter',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Atrial flutter', correct: true, tempts: 'Yes — the sawtooth ruler runs under everything. Count the flutter waves.' },
        { label: 'Sinus tachycardia', tempts: 'At 150, every second flutter wave hides inside the T. Sinus tach rarely parks at a fixed 150.' },
        { label: 'SVT (AVNRT)', tempts: 'AVNRT is usually faster (170–220) and truly P-less; flutter’s sawtooth peeks out in II/III/aVF.' },
        { label: 'Atrial fibrillation', tempts: 'AF’s baseline is static fuzz — flutter keeps the sawtooth ruler running, even when the block varies.' },
      ],
    },
  },
  why: [
    'One re-entrant loop laps the right atrium ~300 times a minute — a sawtooth, not a P.',
    'The AV node can’t pass 300 — it halves it: ventricular rate ~150.',
    'Change the block (2:1 → 3:1 → 4:1) and the ventricular rate steps, not slides.',
  ],
  whyDrawer: [
    { cause: 'A macro-reentrant circuit (usually around the tricuspid annulus) self-sustains', effect: 'The atria activate ~300/min, metronomically' },
    { cause: 'Each lap sweeps the atria the same way', effect: 'Identical flutter waves — the sawtooth, clearest in II, III, aVF, V1' },
    { cause: 'The AV node blocks every second (or third, or fourth) impulse', effect: 'Ventricular rates that step between ~150, ~100, ~75' },
    { cause: 'The circuit is anatomically fixed', effect: 'Ablation across its isthmus cures it — the referral conversation' },
  ],
  pills: [
    { kind: 'trap', text: '“SVT at 150” given AV-nodal blockers and unmasked as flutter — the classic. At 150, actively hunt sawtooth in II, III, aVF, V1.' },
    { kind: 'pearl', text: 'Vagal maneuvers and adenosine rarely convert flutter — but the transient block *unmasks* the sawtooth. Think of them as diagnostic, not therapeutic.' },
    { kind: 'night-eye', text: 'Flip the strip upside down — sawtooth in the inferior leads often jumps out.' },
    { kind: 'lookalike', text: 'Truly no atrial activity and 180+ → think AVNRT.', linkCardId: 'afib' },
  ],
  suspectConfirm: [
    { text: 'Same workup as AF: electrolytes, TSH, echo; same stroke-risk arithmetic.', cites: ['AHA-AF-2023'] },
  ],
  guidelineMoves: [
    { text: 'Unstable → synchronized cardioversion (flutter often converts at low energy).', cites: ['AHA-ACLS-2020'] },
    { text: 'Stable → rate control is harder than in AF; anticoagulation rules are the same.', cites: ['AHA-AF-2023'] },
    { text: 'Recurrent typical flutter → ablation referral (high cure rate).', cites: ['AHA-AF-2023'] },
  ],
  rnMoves: [
    { text: 'A regular rate parked at ~150 is flutter until proven otherwise — pull II, III, aVF and hunt the sawtooth before charting ’sinus tach’.', cites: ['AHA-AF-2023'] },
    { text: 'Unstable → escalate; pads on early — flutter converts at low energy.', cites: ['AHA-ACLS-2020'] },
    { text: 'Anticipate: rate control is harder than in AF; same stroke-risk rules — have onset time and prior episodes ready for the team.', cites: ['AHA-AF-2023'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'aflutter',
    authoredReason: 'The macro-reentrant circuit itself is Stage-2 animation; the atria re-fire metronomically at 300/min here.',
    mustShow: [
      'atria firing 300/min, metronomic',
      'the AV node passing every second impulse',
      'flutter waves continuing through QRS and T',
    ],
    primaryLead: 'II',
  },
  assertions: [
    { on: 'trace', check: 'rateBpm', min: 110, max: 170 },
    { on: 'model', check: 'custom', name: 'flutterWaves', note: 'atrial P-segment sources spaced 190–210 ms (≈300/min), 2:1 conduction' },
    { on: 'trace', check: 'qrsMs', min: 60, max: 120 },
  ],
  methodStep: 'rhythm',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
