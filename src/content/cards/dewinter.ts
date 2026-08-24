/** Transcribed from docs/rebuild/04-CARDS.md §15 — do not edit wording here. */
import { Card } from '../schema'

export const dewinter: Card = {
  id: 'dewinter',
  name: 'de Winter pattern',
  aliases: ['de Winter', 'upsloping', 'LAD equivalent', 'tall T'],
  category: 'Occlusion & ischemia',
  lethal: true,
  tagline: 'The anterior STEMI that forgot to elevate: upsloping depression climbing into giant Ts.',
  seeIt: {
    traceId: 'dewinter-model',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'de Winter — LAD occlusion equivalent', correct: true, tempts: 'Yes — J-points dipping, then towering symmetric Ts. The artery is closed NOW.' },
        { label: 'Subendocardial ischemia', tempts: '“Diffuse depression, manage medically” — but UPSLOPING depression rising into huge Ts is a closed LAD, now.' },
        { label: 'Hyperkalemia', tempts: 'Tall Ts, yes — but hyperK Ts are narrow-based and pinched; these are broad, on a depressed take-off, with an ACS story.' },
        { label: 'Early repolarization', tempts: 'BER’s J-point is elevated, not depressed. Opposite take-off.' },
      ],
    },
  },
  why: [
    'Proximal LAD occludes — the whole anterior wall is ischemic at once.',
    'The injury current runs subendocardial-dominant: J-points depress across the precordium.',
    'Acute transmural ischemia towers the Ts straight out of the depressed take-off.',
  ],
  whyDrawer: [
    { cause: 'The proximal LAD occludes acutely', effect: 'The entire anterior wall is jeopardized at once' },
    { cause: 'The injury current runs subendocardial-dominant instead of subepicardial', effect: 'Upsloping J-point depression across V1–V6, often with slight aVR elevation' },
    { cause: 'Acute transmural ischemia distorts repolarization', effect: 'Tall, broad, symmetric “hyperacute” Ts rising straight out of the depression' },
    { cause: 'The pattern tends to be static, not evolving', effect: 'Waiting for classic elevation is waiting for necrosis' },
  ],
  pills: [
    { kind: 'pearl', text: 'Recognition = upsloping STD ≥1 mm at the J point in the precordials + tall symmetric Ts + often slight aVR elevation.' },
    { kind: 'trap', text: 'It usually does NOT evolve into classic STE — waiting for elevation is waiting for necrosis.' },
    { kind: 'night-eye', text: 'Ongoing chest pain + this pattern = call the lab like it’s a STEMI, because it is one.' },
  ],
  suspectConfirm: [
    { text: 'Treat the pattern as an occlusion equivalent; serial ECGs don’t downgrade it.', cites: ['DEWINTER-2008', 'AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Immediate reperfusion pathway — as for STEMI.', cites: ['AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'dewinter',
    authoredReason: 'A “stuck hyperacute phase” is not a solver state; QRS is solver-generated, ST/T authored (v1-validated values).',
    mustShow: [
      'subendocardial injury shading',
      'the ST vector pointing away from the chest (J-point dip in V1–V6)',
      'giant symmetric Ts towering out of the dip',
    ],
    primaryLead: 'V3',
  },
  assertions: [
    { on: 'model', check: 'stShift', lead: 'V2', sign: '-', minMv: 0.1 },
    { on: 'model', check: 'custom', name: 'tallT', note: 'T peak in V2 ≥ 0.5 mV above baseline' },
    { on: 'model', check: 'qrsMs', min: 60, max: 120 },
    // The slight aVR elevation of the published pattern is a basal-injury
    // feature beyond this vector set (taught in the pill, not asserted).
  ],
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
