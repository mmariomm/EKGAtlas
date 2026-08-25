/** Transcribed from docs/rebuild/04-CARDS.md §18 — do not edit wording here. */
import { Card } from '../schema'

export const longqt: Card = {
  id: 'longqt',
  name: 'Drug-induced long QT & torsades',
  aliases: ['QT', 'QTc', 'torsades', 'TdP', 'polymorphic VT', 'drugs', 'methadone'],
  category: 'Systemic window',
  lethal: true,
  tagline: 'Every med list writes on the T wave — and at QTc 500 the trace starts naming a number.',
  seeIt: {
    traceId: 'ptbxl-320-longqt',
    extraTraceIds: ['longqt-tdp-model'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Prolonged QT', correct: true, tempts: 'Yes — the T ends far past halfway through the RR. Measure it properly, then audit the med list.' },
        { label: 'Normal', tempts: 'Eyeballing misses it: if the T ends past the halfway point of the RR, measure properly.' },
        { label: 'Hypokalemia with U waves', tempts: 'A fused T-U masquerades as long QT — and ALSO promotes torsades. Either way: measure, replete.' },
        { label: 'Nonspecific T abnormality', tempts: 'The QT is a number, not a vibe — tangent method, then correct for rate.' },
      ],
    },
  },
  why: [
    'QT-blocking drugs narrow repolarization reserve — the plateau stretches.',
    'A long QT widens the vulnerable window; an early beat can land inside it.',
    'Short-long-short, then the axis twists around the baseline: torsades de pointes.',
  ],
  whyDrawer: [
    { cause: 'Many drugs block the delayed-rectifier potassium current (IKr)', effect: 'Repolarization loses its reserve; the action-potential plateau stretches — a long QT' },
    { cause: 'Prolonged, uneven repolarization widens the vulnerable window', effect: 'A premature beat can land inside it (R-on-T)' },
    { cause: 'A pause further stretches the next QT (short-long-short)', effect: 'The classic torsades trigger sequence' },
    { cause: 'Reentry spirals with a rotating axis take over', effect: 'Polymorphic VT “twisting around the points” — self-terminating, until it isn’t' },
  ],
  pills: [
    { kind: 'pearl', text: 'Measure, don’t glance: tangent method, longest of II/V5; Fridericia at fast or slow rates (Bazett over-corrects tachycardia). QTc ≥500 ms = high-risk — and so is a rise of >60 ms from the patient’s own baseline, whatever the absolute number.' },
    { kind: 'trap', text: 'The usual suspects stack: antiemetics, antipsychotics, methadone, macrolides/fluoroquinolones, azoles — plus low K⁺/Mg²⁺ multiplying them.' },
    { kind: 'night-eye', text: 'Runs of polymorphic VT after pauses on the overnight tele = torsades until proven otherwise — check the QT of the beats between runs.' },
    { kind: 'trap', text: 'Polymorphic VT on a long baseline QT is torsades, NOT generic VT — amiodarone and procainamide prolong QT and feed it. Magnesium, replete K⁺, pace or isoproterenol; defibrillate if sustained.' },
  ],
  suspectConfirm: [
    { text: 'Audit the med list + K⁺/Mg²⁺/Ca²⁺ in every unexplained long QT or syncope.', cites: ['AHA-QT-2020'] },
  ],
  guidelineMoves: [
    { text: 'Stop every QT-prolonging drug; magnesium 2 g IV for torsades — even with a normal level.', cites: ['AHA-QT-2020', 'AHA-ACLS-2020'] },
    { text: 'Replete K⁺ toward high-normal; recurrent pause-dependent runs → overdrive pacing, or isoproterenol ONLY when the QT is acquired/drug-induced — in congenital LQTS beta-agonists provoke it (beta-blockade treats it).', cites: ['AHA-QT-2020'] },
    { text: 'Sustained or degenerating → defibrillation.', cites: ['AHA-ACLS-2020'] },
  ],
  avoid: { text: 'No amiodarone or procainamide for the polymorphic runs — both stretch the QT that caused them. And no isoproterenol if the long QT could be congenital.', cites: ['AHA-QT-2020'] },
  rnMoves: [
    { text: 'Before hanging QT-prolonging drugs (antiemetics, antipsychotics, macrolides, methadone): check the latest QTc — ≥500 ms, confirm with the prescriber first.', cites: ['AHA-QT-2020'] },
    { text: 'Pause-then-run bursts of polymorphic VT on tele = torsades: magnesium is the ask, flag any amiodarone order — and if it sustains or the pulse is gone, defibrillate per ACLS.', cites: ['AHA-QT-2020', 'AHA-ACLS-2020'] },
    { text: 'Anticipate K⁺/Mg²⁺ repletion to target; recurrent runs → the pacing/isoproterenol conversation.', cites: ['AHA-QT-2020'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'longqt',
    authoredReason: 'Repolarization-reserve pharmacology modeled as its morphology; the TdP run is the authored companion strip.',
    mustShow: [
      'the stretched plateau (delayed repolarization)',
      'the widened vulnerable window',
      'short-long-short trigger on the companion strip',
      'the twisting polymorphic axis',
    ],
    primaryLead: 'II',
  },
  assertions: [
    { on: 'trace', check: 'qtcMs', min: 470, max: 600 },
    { on: 'trace', check: 'qrsMs', min: 60, max: 130 },
    { on: 'model', check: 'qtcMs', min: 490, max: 560 },
    { on: 'model', check: 'custom', name: 'tdpPolymorphic', note: 'companion TdP strip: QRS axis rotates ≥180° across the run; run rate 180–260' },
  ],
  methodStep: 'intervals',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
