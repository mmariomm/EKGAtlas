/** Transcribed from docs/rebuild/04-CARDS.md §7 — do not edit wording here. */
import { Card } from '../schema'

export const avb2: Card = {
  id: 'avb-2',
  name: 'Second-degree AV block (Mobitz I vs II)',
  aliases: ['Mobitz', 'Wenckebach', 'dropped beat', 'AV block', 'pacemaker'],
  category: 'Conduction',
  lethal: true,
  tagline: 'One drops beats politely with warning; the other drops them cold — and needs a pacemaker.',
  seeIt: {
    traceId: 'avb2-mobitz2-model',
    extraTraceIds: ['avb2-wenckebach-model'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Mobitz II', correct: true, tempts: 'Yes — fixed PR, then a P simply fails. Infranodal disease: pads on.' },
        { label: 'Mobitz I (Wenckebach)', tempts: 'Wenckebach stretches the PR before it drops. Here the PR never changes — then a P simply fails.' },
        { label: 'Blocked PACs', tempts: 'A non-conducted PAC comes *early* with a different P shape; these dropped Ps are on time.' },
        { label: 'Complete heart block', tempts: 'Most Ps here conduct with a fixed PR — in complete block none do.' },
      ],
    },
  },
  why: [
    'Mobitz I: the AV node fatigues — PR stretches beat by beat until one P is dropped, then resets.',
    'Mobitz II: the His–Purkinje system fails without warning — fixed PR, then a sudden orphan P.',
    'Below-the-node disease is unstable real estate — it can fall to complete block at any time.',
  ],
  whyDrawer: [
    { cause: 'Mobitz I: decremental conduction in the AV NODE tires with each pass', effect: 'PR 160 → 220 → 280 → dropped, then the cycle resets (grouped beating)' },
    { cause: 'Mobitz II: an all-or-nothing failure in the His–Purkinje system', effect: 'Fixed PR on conducted beats — then a P vanishes without warning' },
    { cause: 'Nodal disease is usually vagal- or drug-flavored and forgiving', effect: 'Wenckebach often needs observation, not hardware' },
    { cause: 'Infranodal disease has no safety margin', effect: 'Mobitz II can drop to complete block with a slow, unreliable escape — the pacemaker conversation' },
  ],
  pills: [
    { kind: 'pearl', text: 'Grouped beating + lengthening PR + shortening RR = Wenckebach. Usually nodal, often benign, frequently drug- or vagal-flavored.' },
    { kind: 'trap', text: '2:1 block can’t be called I or II from one strip — every other P drops in both. Judge by company: wide QRS and no PR variation lean Mobitz II. Get a long strip.' },
    { kind: 'night-eye', text: 'Mobitz II on the monitor overnight is a call-now finding, not a note-for-the-morning finding.' },
  ],
  suspectConfirm: [
    { text: 'Review AV-blocking drugs, K⁺, ischemia; get a long rhythm strip and old ECGs.', cites: ['AHA-BRADY-2018'] },
  ],
  guidelineMoves: [
    { text: 'Mobitz II (or any symptomatic block) → pads on, pacing pathway, cardiology now. Atropine 1 mg works on NODAL block — infranodal it can speed the Ps and worsen the ratio; never let repeat doses delay the pacer.', cites: ['AHA-BRADY-2018', 'AHA-ACLS-2020'] },
    { text: 'Asymptomatic Wenckebach → usually observation and cause-hunting, not hardware.', cites: ['AHA-BRADY-2018'] },
  ],
  avoid: { text: 'Don’t stack atropine doses while the pads wait — in infranodal block it can worsen the conducted ratio. Pacing is the plan.', cites: ['AHA-BRADY-2018', 'AHA-ACLS-2020'] },
  rnMoves: [
    { text: 'Lengthening PR with grouped beats (Wenckebach) is usually benign; fixed PR with sudden drops (Mobitz II) is not — treat every 2:1 as the dangerous kind until proven otherwise.', cites: ['AHA-BRADY-2018'] },
    { text: 'Mobitz II on the monitor = call now and pads on — it can fall to complete block without warning.', cites: ['AHA-BRADY-2018'] },
    { text: 'Anticipate: a long rhythm strip, holding AV-blocking meds, atropine drawn (expect little from it here — the block is below the node), the pacing pathway.', cites: ['AHA-BRADY-2018'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'avb-2',
    authoredReason: 'Decremental AV conduction is not in the solver graph; the two behaviors are authored strips.',
    mustShow: [
      'fixed PR on conducted beats',
      'a P finding the door shut without warning',
      'the Wenckebach companion: PR stretching until one drops',
    ],
    primaryLead: 'II',
  },
  assertions: [
    { on: 'model', check: 'custom', name: 'mobitz2Pattern', note: 'conducted PRs constant ±10 ms; a P-only beat exists (the dropped one)' },
    { on: 'model', check: 'qrsMs', min: 60, max: 120 },
    { on: 'trace', check: 'custom', name: 'droppedBeats', note: 'max RR ≥ 1.7× median RR (the pause of the dropped beat)' },
  ],
  methodStep: 'rhythm',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
