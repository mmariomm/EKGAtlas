/** Authored 2026-08 (post-audit addition: the regular-narrow bucket). */
import { Card } from '../schema'

export const svtAvnrt: Card = {
  id: 'svt-avnrt',
  name: 'SVT (AVNRT)',
  aliases: ['SVT', 'AVNRT', 'narrow tachycardia', 'palpitations', 'adenosine', 're-entry'],
  category: 'Rate & rhythm',
  lethal: false,
  tagline: 'A circuit the size of a fingernail runs the whole heart — until you break the loop.',
  seeIt: {
    traceId: 'ptbxl-2051-svt-avnrt',
    extraTraceIds: ['ptbxl-3134-svt-avnrt'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'SVT (AVNRT)', correct: true, tempts: 'Yes — narrow, rigidly regular (~155 here), and no P waves in front of anything: the atria are captured backwards.' },
        { label: 'Sinus tachycardia', tempts: 'Sinus climbs and settles with a cause and keeps its Ps. This started like a switch and shows none.' },
        { label: 'Atrial flutter 2:1', tempts: 'Parked near 150 — always hunt the sawtooth in II/III/aVF. No sawtooth here, and the rate isn’t locked to 150.' },
        { label: 'Ventricular tachycardia', tempts: 'VT is WIDE. Narrow at this rate is coming from above the bundles — the highways are intact.' },
      ],
    },
  },
  why: [
    'Two pathways inside the AV node form a loop — one beat closes it and the loop self-sustains.',
    'Each lap fires ventricles forward AND atria backwards, almost simultaneously.',
    'So: narrow QRS, metronome-regular, no P in front — typically 140–250/min (most 150–220), on/off like a switch.',
  ],
  whyDrawer: [
    { cause: 'The AV node has a slow and a fast pathway (dual physiology)', effect: 'A premature beat can go down one and return up the other — the loop closes' },
    { cause: 'The circuit re-enters itself every ~300–400 ms', effect: 'A rigidly regular tachycardia — RR variation near zero' },
    { cause: 'Each lap exits both ways: down the His, up into the atria', effect: 'Narrow QRS with retrograde atrial capture — the P hides in or just after the QRS' },
    { cause: 'The loop lives entirely in the node', effect: 'Anything that blocks the node (vagal tone, adenosine) can snap it — diagnostic AND therapeutic' },
  ],
  pills: [
    { kind: 'pearl', text: 'The tells: abrupt on/off, rigid regularity, no visible Ps (or a tiny pseudo-r′ in V1 / pseudo-S inferiorly — the retrograde P peeking out).' },
    { kind: 'trap', text: 'Three states: regular + narrow = treatable with node blockers (pads on). Regular + WIDE = VT until proven otherwise — not a node-blocker rhythm. Irregular + wide = pre-excited AF: nothing that blocks the node.', linkCardId: 'wpw' },
    { kind: 'night-eye', text: 'Run a continuous strip DURING adenosine — whatever the tachycardia was, the unmasking (flutter waves, sinus P return) is the diagnosis you keep.' },
    { kind: 'lookalike', text: 'Fixed ~150 that never budges = flutter 2:1 until you prove otherwise.', linkCardId: 'aflutter' },
  ],
  suspectConfirm: [
    { text: 'Regular, narrow, no clear Ps, abrupt onset → AVNRT/AVRT; get a 12-lead BEFORE terminating it if the patient tolerates the wait.', cites: ['ESC-SVT-2019'] },
    { text: 'After conversion: repeat the 12-lead in sinus — hunt for a delta wave (pre-excitation changes the future rules).', cites: ['ESC-SVT-2019'] },
  ],
  guidelineMoves: [
    { text: 'Stable → modified Valsalva first (43% vs 17% conversion — it does real work), then adenosine 6 mg rapid push + flush, then 12 mg. Start at 3 mg for transplanted heart, dipyridamole/carbamazepine, or central line; avoid in severe asthma.', cites: ['ESC-SVT-2019', 'AHA-ACLS-2020'] },
    { text: 'Unstable from the rhythm → synchronized cardioversion.', cites: ['AHA-ACLS-2020'] },
    { text: 'Adenosine fails or SVT recurs → IV diltiazem/verapamil or a beta-blocker (regular + narrow only).', cites: ['ESC-SVT-2019'] },
    { text: 'Recurrent episodes → EP referral: slow-pathway ablation is curative in most.', cites: ['ESC-SVT-2019'] },
  ],
  rnMoves: [
    { text: 'Coach the modified Valsalva: sit up, strain hard 15 s (10-ml syringe trick), then flat with legs raised 15 s — done right it converts a real share before any drug.', cites: ['ESC-SVT-2019'] },
    { text: 'Adenosine prep: most PROXIMAL good line (AC or above), rapid push + 20 ml flush, arm up, CONTINUOUS strip, defib at hand — and ask about asthma and dipyridamole first. Warn about the awful sinking pause; it passes in seconds.', cites: ['AHA-ACLS-2020'] },
    { text: 'The safety check before any node-blocker: is it regular and NARROW? Irregular or wide → stop and escalate.', cites: ['AHA-ACLS-2020'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'svt-avnrt',
    authoredReason: 'Nodal micro-re-entry is below the solver’s graph resolution; the loop and retrograde capture are authored.',
    mustShow: [
      'the circuit spinning inside the AV node',
      'ventricles fired forward — narrow and fast',
      'atria captured backwards (retrograde P at the QRS tail)',
      'rigid regularity, beat after beat',
    ],
    primaryLead: 'II',
  },
  assertions: [
    { on: 'model', check: 'rateBpm', min: 145, max: 170 },
    { on: 'model', check: 'qrsMs', min: 60, max: 110 },
    { on: 'trace', check: 'rateBpm', min: 140, max: 180 },
    { on: 'trace', check: 'qrsMs', min: 60, max: 112 },
    { on: 'trace', check: 'custom', name: 'rigidRR', note: 'RR coefficient of variation <4% — the metronome regularity of a re-entry circuit' },
  ],
  methodStep: 'rhythm',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
