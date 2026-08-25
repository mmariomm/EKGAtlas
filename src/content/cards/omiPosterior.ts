/** Transcribed from docs/rebuild/04-CARDS.md §12 — do not edit wording here. */
import { Card } from '../schema'

export const omiPosterior: Card = {
  id: 'omi-posterior',
  name: 'Posterior occlusion MI',
  aliases: ['posterior', 'mirror', 'tall R V1', 'ST depression', 'circumflex'],
  category: 'Occlusion & ischemia',
  lethal: true,
  tagline: 'Read the back of the heart in a mirror: depression in V1–V3 that is elevation upside-down.',
  seeIt: {
    traceId: 'ptbxl-1544-omi-posterior',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Posterior occlusion MI', correct: true, tempts: 'Yes — depression maximal in V1–V3 over a growing R, upright T: the mirror. Get V7–V9.' },
        { label: 'Anterior subendocardial ischemia', tempts: '“Anterior ischemia” is the classic mislabel. Depression MAXIMAL in V1–V3 (not V4–V6) + tall R = posterior wall.' },
        { label: 'RBBB', tempts: 'Tall R in V1, but the QRS is narrow here and there’s no wide terminal S.' },
        { label: 'Normal variant tall R', tempts: 'A tall V1 R alone, maybe — with horizontal ST depression and upright T, no.' },
      ],
    },
  },
  why: [
    'No electrode faces the posterior wall — V1–V3 watch it from the wrong side.',
    'Posterior STE therefore records as ANTERIOR ST depression; the posterior Q as a tall R.',
    'Flip the strip and it reads as a textbook STEMI — that’s the whole trick.',
  ],
  whyDrawer: [
    { cause: 'Occlusion (usually circumflex) infarcts the posterior/inferobasal wall', effect: 'A transmural injury current pointing posteriorly, AWAY from the chest' },
    { cause: 'V1–V3 sit directly opposite on the chest wall', effect: 'They record the injury upside-down: ST DEPRESSION instead of elevation' },
    { cause: 'The developing posterior Q is also seen from behind', effect: 'A tall, broadening R wave in V1–V2 (R/S rising toward 1)' },
    { cause: 'Posterior T inversion viewed from the front', effect: 'An upright T in V1–V2 — the mirror is complete' },
  ],
  pills: [
    { kind: 'pearl', text: 'ST depression maximal in V1–V3 is posterior OMI until proven otherwise. Maximal in V4–V6 points elsewhere (subendocardial/demand).' },
    { kind: 'trap', text: 'Calling it “NSTEMI, medical management” while the circumflex is closed — the never-counted miss. Posterior leads or cath decide.' },
    { kind: 'night-eye', text: 'It rarely travels alone — scan inferior and lateral leads for company.', linkCardId: 'omi-inferior' },
  ],
  suspectConfirm: [
    { text: 'Entry: horizontal STD ≥0.5 mm maximal in V1–V3 with the R/S rising toward 1 → get V7–V9: STE ≥0.5 mm there confirms (≥1 mm in men <40).', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Confirmed posterior OMI = reperfusion, same urgency as any STEMI.', cites: ['AHA-ACS-2025'] },
  ],
  avoid: { text: 'Never file it as “NSTEMI, medical management” once the posterior leads confirm — a confirmed posterior OMI takes the reperfusion pathway at STEMI speed.', cites: ['AHA-ACS-2025'] },
  rnMoves: [
    { text: 'ST depression deepest in V1–V3 is posterior OMI until proven otherwise — get V7–V9 and RELABEL the tracing so the next reader isn’t fooled; three stickers change the disposition.', cites: ['AHA-ACS-2025'] },
    { text: 'Don’t let the ‘NSTEMI’ label slow the room — confirmed posterior OMI moves at STEMI speed.', cites: ['AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'omi-posterior',
    authoredReason: 'The solver’s region set has no discrete posterior-basal wall; the mirrored morphology is authored (v1-validated values).',
    mustShow: [
      'the injury on the posterior wall, pointing away from the chest',
      'V1–V3 recording the mirror (depression)',
      'the tall R as the mirrored Q',
    ],
    primaryLead: 'V2',
  },
  assertions: [
    { on: 'model', check: 'stShift', lead: 'V2', sign: '-', minMv: 0.1 },
    { on: 'model', check: 'rsRatio', lead: 'V1', min: 1 },
    { on: 'model', check: 'tPolarity', lead: 'V2', sign: '+' },
    { on: 'model', check: 'qrsMs', min: 60, max: 120 },
    // On this recording the mirror is fully formed in V2 (R/S ≈ 14); V1 is
    // still growing — the classic V1 criterion is asserted on the model.
    { on: 'trace', check: 'rsRatio', lead: 'V2', min: 2 },
    { on: 'trace', check: 'tPolarity', lead: 'V2', sign: '+' },
  ],
  methodStep: 'st-t',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
