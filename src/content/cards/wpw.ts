/** Authored 2026-08 (post-audit addition: the afib card's lethal companion). */
import { Card } from '../schema'

export const wpw: Card = {
  id: 'wpw',
  name: 'Pre-excitation (WPW)',
  aliases: ['WPW', 'Wolff', 'delta', 'accessory pathway', 'short PR', 'pre-excited'],
  category: 'Conduction',
  lethal: true,
  tagline: 'A second wire into the ventricle — harmless-looking until AF finds it.',
  seeIt: {
    traceId: 'ptbxl-5303-wpw',
    extraTraceIds: ['ptbxl-2145-wpw'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Pre-excitation (WPW)', correct: true, tempts: 'Yes — short PR sliding into a slurred delta upstroke; the QRS is a fusion beat, every beat.' },
        { label: 'RBBB', tempts: 'The tall R in V1 fools you — but look at the START of the QRS: the slur is at the onset (delta), not the end (R′).' },
        { label: 'Old posterior MI', tempts: 'Tall R in V1 again — but posterior MI keeps a normal PR and a crisp QRS onset. Here the PR is short and the upstroke slurs.' },
        { label: 'LVH', tempts: 'Big voltages, yes — but LVH doesn’t shorten the PR or slur the QRS onset.' },
      ],
    },
  },
  why: [
    'An accessory pathway bypasses the AV node — the ventricle starts early: short PR.',
    'Pathway insertion spreads muscle-to-muscle: the slow slurred delta wave.',
    'Then the His wavefront catches up — every QRS is a fusion of the two routes.',
  ],
  whyDrawer: [
    { cause: 'A congenital muscle strand bridges atrium and ventricle', effect: 'Atrial impulses reach ventricle without the AV node’s delay — PR <120 ms' },
    { cause: 'The pathway inserts into plain myocardium, not the His–Purkinje tree', effect: 'Slow cell-to-cell start: the delta slur that widens the QRS' },
    { cause: 'Normal conduction arrives a beat-fraction later and finishes the job', effect: 'A fusion QRS — degree of pre-excitation varies with autonomic tone' },
    { cause: 'The pathway also conducts backwards — and fast', effect: 'A re-entry circuit (AVRT) waiting to fire; and in AF, an unguarded highway to the ventricle' },
  ],
  pills: [
    { kind: 'trap', text: 'AF in WPW: irregular, WIDE, absurdly fast, morphology changing beat to beat. AV-nodal blockers (adenosine, diltiazem, beta-blockers, digoxin) can funnel all of it down the pathway → VF. Procainamide or cardiovert.', linkCardId: 'afib' },
    { kind: 'pearl', text: 'Delta mimics everything: pseudo-Q inferiorly (fake old MI), tall R V1 (fake posterior MI/RBBB). Before you diagnose infarct on a weird QRS, check the PR.' },
    { kind: 'night-eye', text: 'Regular narrow SVT in known WPW (orthodromic AVRT) is safe for adenosine. The rule changes the moment it’s irregular or wide — then nothing that blocks the node.' },
  ],
  suspectConfirm: [
    { text: 'Short PR (<120 ms) + delta + QRS >110 ms on a resting ECG = pre-excitation; find prior ECGs and ask about palpitations and syncope.', cites: ['ESC-SVT-2019'] },
    { text: 'Syncope, or pre-excited AF, or a high-risk occupation → EP study for pathway risk-stratification.', cites: ['ESC-SVT-2019'] },
  ],
  guidelineMoves: [
    { text: 'Orthodromic (narrow) AVRT → vagal maneuvers, then adenosine — standard SVT care.', cites: ['ESC-SVT-2019', 'AHA-ACLS-2020'] },
    { text: 'Pre-excited AF (irregular + wide) → NO AV-nodal blockers: IV procainamide or ibutilide, or synchronized cardioversion.', cites: ['ESC-SVT-2019'] },
    { text: 'Symptomatic WPW → catheter ablation of the pathway (first-line, high cure rate).', cites: ['ESC-SVT-2019'] },
  ],
  rnMoves: [
    { text: 'Short PR + slurred delta on a routine ECG: flag it in the chart — it changes every future SVT/AF treatment this patient gets.', cites: ['ESC-SVT-2019'] },
    { text: 'Known WPW now irregular + wide + very fast = emergency: question ANY adenosine, diltiazem, beta-blocker, or digoxin order — procainamide or cardioversion instead.', cites: ['ESC-SVT-2019'] },
    { text: 'Anticipate: pads on, EP referral. A regular NARROW SVT in WPW may still get vagal/adenosine — the irregular wide one never does.', cites: ['ESC-SVT-2019', 'AHA-ACLS-2020'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'wpw',
    authoredReason: 'An accessory AV pathway is outside the solver’s conduction graph; the fusion beat is authored (delta source + normal solver beat).',
    mustShow: [
      'atria finish and the pathway fires the LV base immediately (no AV pause)',
      'slow cell-to-cell delta spread before the bundles land',
      'the His wavefront completing the QRS — fusion',
      'discordant repolarization after the abnormal QRS',
    ],
    primaryLead: 'V5',
  },
  assertions: [
    { on: 'model', check: 'prMs', max: 120 },
    { on: 'model', check: 'qrsMs', min: 110, max: 160 },
    { on: 'model', check: 'netQrs', lead: 'V1', sign: '+' },
    { on: 'model', check: 'netQrs', lead: 'V5', sign: '+' },
    // The recording (type A, left-sided pathway): tall R V1, positive V5.
    // Auto-delineation places qrsOn AFTER the low-slope delta, so trace PR/QRS
    // are not assertable (documented delineator limit); polarity + rate are.
    { on: 'trace', check: 'netQrs', lead: 'V1', sign: '+' },
    { on: 'trace', check: 'netQrs', lead: 'V5', sign: '+' },
    { on: 'trace', check: 'rateBpm', min: 55, max: 95 },
  ],
  methodStep: 'intervals',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
