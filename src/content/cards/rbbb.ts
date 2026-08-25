/** Transcribed from docs/rebuild/04-CARDS.md §8 — do not edit wording here. */
import { Card } from '../schema'

export const rbbb: Card = {
  id: 'rbbb',
  name: 'Right bundle branch block',
  aliases: ['RBBB', 'rSR', 'wide QRS', 'right bundle'],
  category: 'Conduction',
  lethal: false,
  tagline: 'The right ventricle gets the news late — and tells V1 about it twice.',
  seeIt: {
    traceId: 'ptbxl-1024-rbbb',
    extraTraceIds: ['ptbxl-621-rbbb'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'RBBB', correct: true, tempts: 'Yes — the rSR′ in V1 with a broad terminal S in I and V6. Late news from the right.' },
        { label: 'LBBB', tempts: 'Both are wide. LBBB is *down* in V1; RBBB’s rSR′ is up. Terminal forces decide.' },
        { label: 'Brugada pattern', tempts: 'Coved STE in V1 vs an rSR′ with a wide S in I/V6 — Brugada has no broad terminal S.' },
        { label: 'Ventricular rhythm', tempts: 'A P before every QRS with fixed PR keeps this supraventricular.' },
      ],
    },
  },
  why: [
    'The right bundle is cut; the LV fires on time — the beat starts almost normally.',
    'The RV is reached late, muscle-to-muscle — a second, slow rightward push.',
    'That late push writes the R′ in V1 and the broad S in I and V6.',
  ],
  whyDrawer: [
    { cause: 'The right bundle fails; the left system delivers on schedule', effect: 'Septum and LV activate normally — the first ~60 ms look ordinary' },
    { cause: 'The RV waits for cell-to-cell spread across the septum', effect: 'A late, slow, rightward-anterior wavefront' },
    { cause: 'V1 faces that late wavefront head-on', effect: 'The second R (rSR′) — “M-shaped” V1' },
    { cause: 'I and V6 watch it leave', effect: 'The broad, slurred terminal S wave' },
  ],
  pills: [
    { kind: 'pearl', text: 'RBBB changes the END of the QRS, not the start — so ischemia rules are UNCHANGED. Read ST segments like normal.' },
    { kind: 'trap', text: 'New RBBB + left anterior fascicular block in anterior chest pain = proximal LAD territory dying — not “just a block”.', linkCardId: 'omi-anterior' },
    { kind: 'night-eye', text: 'Expected discordance here is small: T inversion in V1–V2 is the norm; STE in V1 is NOT — investigate it.' },
  ],
  suspectConfirm: [
    { text: 'New RBBB with dyspnea/hypotension: think RV strain — pulmonary embolism belongs on the list.', cites: ['AHA-PE-2026'] },
  ],
  guidelineMoves: [
    { text: 'Isolated asymptomatic RBBB needs no treatment — the work is in what caused it.', cites: ['AHA-BRADY-2018'] },
  ],
  rnMoves: [
    { text: 'Isolated, asymptomatic RBBB is a finding, not an emergency — NEW RBBB with chest pain, dyspnea, or hypotension is: report it.', cites: ['AHA-BRADY-2018'] },
    { text: 'RBBB does not hide ischemia — the ST segments still read normally; STE in V1 is never ’just the block’.', cites: ['AHA-BRADY-2018'] },
    { text: 'New RBBB + dyspnea/hypotension → think PE and escalate for risk stratification.', cites: ['AHA-PE-2026'] },
  ],
  mechanism: {
    kind: 'solver',
    state: { pace: 'SA', blockedEdges: ['HIS>RBB'] },
    mustShow: [
      'right bundle drawn blocked',
      'left side depolarizing on time',
      'RV reached late, cell-to-cell across the septum',
      'the late rightward wavefront writing the R′',
    ],
    primaryLead: 'V1',
  },
  assertions: [
    { on: 'model', check: 'qrsMs', min: 120, max: 165 },
    // The slope-refined annotation reads the slurred R' tail conservatively
    // (~5-10 ms tight); the R' itself is asserted separately below.
    { on: 'trace', check: 'qrsMs', min: 108, max: 175 },
    { on: 'model', check: 'custom', name: 'terminalRV1', note: 'terminal 40 ms of the QRS in V1 positive (the R′)' },
    { on: 'trace', check: 'custom', name: 'terminalRV1', note: 'terminal R′ present on the recording too' },
    { on: 'model', check: 'custom', name: 'terminalSI', note: 'terminal 40 ms in lead I negative (the broad S)' },
    { on: 'trace', check: 'tPolarity', lead: 'V1', sign: '-' },
  ],
  methodStep: 'morphology',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
