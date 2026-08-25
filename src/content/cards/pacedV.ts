/** Transcribed from docs/rebuild/04-CARDS.md §5 — do not edit wording here. */
import { Card } from '../schema'

export const pacedV: Card = {
  id: 'paced-v',
  name: 'Ventricular paced rhythm',
  aliases: ['paced', 'pacemaker', 'spikes', 'capture'],
  category: 'Conduction',
  lethal: false,
  tagline: 'The rhythm the machine misreads most — learn what the pacer’s shadow should look like.',
  seeIt: {
    traceId: 'ptbxl-1674-paced-v',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Ventricular paced rhythm', correct: true, tempts: 'Yes — a stimulus before every wide, LBBB-like complex. The pacer is doing its job.' },
        { label: 'LBBB', tempts: 'Paced QRS mimics LBBB (RV origin) — but hunt the pacing spikes before the QRS.' },
        { label: 'VT', tempts: 'Wide, yes — but rate ~60–70 and a spike before every beat is a pacer doing its job.' },
        { label: 'Hyperkalemia', tempts: 'Wide and odd, but here every complex is *identically* preceded by a stimulus artifact.' },
      ],
    },
  },
  why: [
    'The lead paces the RV apex — depolarization crawls muscle-to-muscle, right to left.',
    'So the paced QRS is wide and LBBB-like, with discordant ST/T — by design, not disease.',
    'Every paced beat should follow its spike; every spike should capture.',
  ],
  whyDrawer: [
    { cause: 'The pacing lead sits in the RV apex', effect: 'Each stimulus starts depolarization at one ventricular point' },
    { cause: 'Spread is muscle-to-muscle, right-to-left and upward', effect: 'A wide, LBBB-like QRS with a superior axis' },
    { cause: 'Abnormal depolarization forces abnormal repolarization', effect: 'Discordant ST/T — expected, not ischemia by itself' },
    { cause: 'The device marks each stimulus', effect: 'The spike: a narrow artifact immediately before every captured QRS' },
  ],
  pills: [
    { kind: 'pearl', text: 'Automated reads misread paced rhythms often — machine text on a paced ECG is a hypothesis, not a report.' },
    { kind: 'trap', text: 'Ischemia does NOT become invisible: modified Sgarbossa rules work in paced rhythms — concordant ST shifts stay guilty.', linkCardId: 'sgarbossa' },
    { kind: 'night-eye', text: 'Spikes with no QRS after them = failure to capture. Count spike→QRS pairs before admiring the morphology.' },
  ],
  suspectConfirm: [
    { text: 'Chest pain in a paced rhythm → apply modified Sgarbossa (validated in paced rhythms); don’t write “uninterpretable”.', cites: ['SMITH-MSC-2012', 'DODD-VPR-2021'] },
    { text: 'Suspected device problem → magnet response and device interrogation.', cites: ['AHA-BRADY-2018'] },
  ],
  guidelineMoves: [
    { text: 'Symptomatic non-capture or bradycardia → transcutaneous pacing bridge while the device is interrogated.', cites: ['AHA-BRADY-2018', 'AHA-ACLS-2020'] },
  ],
  rnMoves: [
    { text: 'March spike→QRS pairs: a spike with nothing after it = failure to capture (in a dependent, slow patient that is a stay-in-the-room emergency); spikes landing inside beats or near Ts = undersensing (R-on-T risk). Report both — never chart as artifact.', cites: ['AHA-BRADY-2018'] },
    { text: 'Chest pain in a paced rhythm is never ’uninterpretable’ — concordant ST changes matter; push for a real read (modified Sgarbossa).', cites: ['SMITH-MSC-2012', 'DODD-VPR-2021'] },
    { text: 'Anticipate: pads on and the pacing pathway if capture fails in a slow or symptomatic patient; magnet per protocol — it forces asynchronous pacing (fixes OVERsensing/inhibition), it never fixes lost capture.', cites: ['AHA-BRADY-2018'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'paced-v',
    authoredReason: 'Solver paces the RV apex; the stimulus artifact is an authored spike source.',
    mustShow: [
      'the stimulus firing at the RV apex',
      'slow right-to-left spread (wide, LBBB-like)',
      'discordant repolarization',
    ],
    primaryLead: 'V1',
  },
  assertions: [
    { on: 'model', check: 'qrsMs', min: 120, max: 200 },
    { on: 'model', check: 'netQrs', lead: 'V1', sign: '-' },
    // The region graph is too coarse to reproduce the superior paced axis
    // (documented model-resolution limit; V1 negativity carries the teaching).
    { on: 'model', check: 'rateBpm', min: 55, max: 90 },
    { on: 'trace', check: 'qrsMs', min: 120, max: 220 },
    { on: 'trace', check: 'rateBpm', min: 50, max: 110 },
  ],
  methodStep: 'morphology',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
