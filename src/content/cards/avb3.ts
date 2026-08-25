/** Transcribed from docs/rebuild/04-CARDS.md §6 — do not edit wording here. */
import { Card } from '../schema'

export const avb3: Card = {
  id: 'avb-3',
  name: 'Complete heart block',
  aliases: ['third degree', 'AV block', 'CHB', 'bradycardia', 'escape'],
  category: 'Conduction',
  lethal: true,
  tagline: 'Two rhythms sharing one heart — the Ps and the QRSs never speak.',
  seeIt: {
    traceId: 'ptbxl-959-avb-3',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Complete heart block', correct: true, tempts: 'Yes — march the Ps: more Ps than QRSs, and no PR relationship survives.' },
        { label: 'Sinus bradycardia', tempts: 'Slow, yes — but march the Ps: more Ps than QRSs, and PR changes every beat.' },
        { label: 'Second-degree AV block', tempts: 'In 2° *some* Ps conduct (fixed or lengthening PR). Here no P owns any QRS.' },
        { label: 'Junctional rhythm', tempts: 'Junctional escape is part of the answer — but the dissociated marching Ps make it complete block.' },
      ],
    },
  },
  why: [
    'The AV junction no longer conducts — atria and ventricles run separate lives.',
    'A downstream escape keeps the ventricles alive: junctional = narrow, ~40–60; ventricular = wide, ~20–40.',
    'PR intervals look random because they’re meaningless — no P conducts.',
  ],
  whyDrawer: [
    { cause: 'The AV junction (node or His) fails completely', effect: 'No atrial impulse reaches the ventricles' },
    { cause: 'The sinus node keeps its own schedule', effect: 'Ps march on, typically 60–100/min, ignoring everything below' },
    { cause: 'A downstream pacemaker escapes', effect: 'Junctional escape: narrow, ~40–60/min. Ventricular escape: wide, ~20–40/min — the lower, the worse' },
    { cause: 'Two independent clocks overlay on the paper', effect: 'PR "intervals" that wander randomly — the tell that none of them are real' },
  ],
  pills: [
    { kind: 'pearl', text: 'March the Ps with calipers. More Ps than QRSs + no fixed PR = complete block.' },
    { kind: 'trap', text: 'In inferior OMI the block is nodal — often transient and atropine-responsive. In anterior OMI it’s infranodal — ominous, pace early.', linkCardId: 'omi-inferior' },
    { kind: 'night-eye', text: 'A “regular bradycardia at 40” that ignores its own P waves is never sinus. Look twice.' },
    { kind: 'lookalike', text: 'Bradycardia + widening + weirdness = check the K⁺ before blaming the conduction system.', linkCardId: 'hyperk' },
  ],
  suspectConfirm: [
    { text: 'Hunt reversible causes: K⁺, AV-nodal drugs (beta-blocker, calcium-blocker, digoxin), ischemia, Lyme.', cites: ['AHA-BRADY-2018'] },
    { text: 'Acute MI context changes everything — localize it (inferior vs anterior).', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Symptomatic → atropine 1 mg IV q3–5 min (max 3 mg) while pads go on; expect it to fail if the escape is wide (infranodal).', cites: ['AHA-ACLS-2020'] },
    { text: 'Transcutaneous pacing bridge → transvenous pacing; treat the cause in parallel.', cites: ['AHA-BRADY-2018'] },
  ],
  avoid: { text: 'Hold every AV-nodal blocker (beta-blocker, diltiazem/verapamil, digoxin) while the block stands — and don’t let atropine cycles delay pacing.', cites: ['AHA-BRADY-2018', 'AHA-ACLS-2020'] },
  rnMoves: [
    { text: 'More Ps than QRSs and no fixed PR = complete block. A ’regular bradycardia at 40’ that ignores its own Ps is never sinus — look twice.', cites: ['AHA-BRADY-2018'] },
    { text: 'Do not leave the bedside: pads on, atropine drawn (expect it to fail if the QRS is wide), pacing likely.', cites: ['AHA-ACLS-2020'] },
    { text: 'Anticipate the cause hunt: K⁺, AV-blocking drugs, ischemia — inferior-MI blocks often recover; anterior ones usually don’t.', cites: ['AHA-BRADY-2018', 'AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'avb-3',
    authoredReason: 'Two independent pacemakers cannot come from one solver run.',
    mustShow: [
      'the AV junction as a wall',
      'Ps marching alone at 75/min',
      'an independent slow escape below the block',
      'the two never aligning',
    ],
    primaryLead: 'II',
  },
  assertions: [
    { on: 'model', check: 'custom', name: 'avb3Dissociation', note: 'atrial rate 70–80, ventricular 35–45, no fixed PR' },
    { on: 'model', check: 'qrsMs', min: 60, max: 120 },
    { on: 'trace', check: 'rateBpm', min: 25, max: 55 },
  ],
  methodStep: 'rhythm',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
