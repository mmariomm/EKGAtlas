/** Transcribed from docs/rebuild/04-CARDS.md §11 — do not edit wording here. */
import { Card } from '../schema'

export const omiInferior: Card = {
  id: 'omi-inferior',
  name: 'Inferior occlusion MI',
  aliases: ['inferior', 'STEMI', 'RCA', 'RV infarct', 'V4R'],
  category: 'Occlusion & ischemia',
  lethal: true,
  tagline: 'Three small leads, one closing artery — and a right ventricle that punishes nitroglycerin.',
  seeIt: {
    // Curation finding (documented in the report): every reachable PTB-XL
    // INJIN/INJIL candidate measures SUBACUTE inferior change (STD + inverted
    // Ts), not acute STE — resting-clinic bias. The card therefore ships the
    // modeled strip with its honest badge until a real acute anchor lands.
    traceId: 'omi-inferior-model',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Inferior occlusion MI', correct: true, tempts: 'Yes — inferior injury with aVL dipping in reciprocal. Now ask about the right ventricle.' },
        { label: 'Pericarditis', tempts: 'Diffuse concave STE without reciprocal aVL depression. Inferior OMI almost always depresses aVL.' },
        { label: 'Benign early repolarization', tempts: 'BER doesn’t do reciprocal aVL depression either — that finding is the divider.' },
        { label: 'Normal variant', tempts: 'Subtle inferior STE is easy to wave off — aVL is your tiebreaker. Look there first.' },
      ],
    },
  },
  why: [
    'RCA (usually) closes → the inferior wall holds the injury current.',
    'The vector points at the feet: STE in II, III, aVF — and aVL, facing away, dips.',
    'A proximal RCA also starves the RV — a preload-dependent ventricle appears.',
  ],
  whyDrawer: [
    { cause: 'The RCA (or circumflex) occludes the inferior wall’s supply', effect: 'A transmural injury current pointing inferiorly' },
    { cause: 'II, III and aVF face the injured wall', effect: 'ST elevation — often subtle, a millimeter that matters' },
    { cause: 'aVL looks at the inferior wall from directly opposite', effect: 'Reciprocal ST depression — the earliest and most reliable clue' },
    { cause: 'A proximal RCA also supplies the RV free wall', effect: 'RV infarction: preload-dependent hypotension, unmasked by nitrates' },
  ],
  pills: [
    { kind: 'pearl', text: 'STE III > II leans RCA (vs circumflex) — and raises the RV-infarct question. Answer it with V4R.' },
    { kind: 'trap', text: 'RV infarct + nitroglycerin = crashing preload → hypotension. Fluids first, nitrates withheld.' },
    { kind: 'night-eye', text: 'Fresh inferior OMI + new AV block is nodal ischemia — often atropine-responsive, usually transient.', linkCardId: 'avb-3' },
    { kind: 'lookalike', text: 'Inferior STE with V1–V3 depression = the posterior wall is in too.', linkCardId: 'omi-posterior' },
  ],
  suspectConfirm: [
    { text: 'Record V4R (RV) and V7–V9 (posterior) — thirty seconds that change management.', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Reperfusion now — same clock as any OMI.', cites: ['AHA-ACS-2025'] },
    { text: 'Hypotension after nitrates or STE in V4R → RV infarct: volume first, avoid further preload reduction.', cites: ['AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'solver',
    state: { pace: 'SA', ischemic: ['LV_inf'], injuryDir: [0.15, 0.9, -0.3], injuryMag: 0.6 },
    mustShow: [
      'the inferior wall marked injured',
      'the injury vector pointing at the feet (II, III, aVF)',
      'aVL watching it leave — reciprocal depression',
    ],
    primaryLead: 'III',
  },
  assertions: [
    { on: 'model', check: 'stShift', lead: 'III', sign: '+', minMv: 0.1 },
    { on: 'model', check: 'stShift', lead: 'aVF', sign: '+', minMv: 0.05 },
    { on: 'model', check: 'stShift', lead: 'aVL', sign: '-' },
    { on: 'model', check: 'custom', name: 'st3gt2', note: 'stShift III > stShift II (RCA pattern)' },
    { on: 'trace', check: 'stShift', lead: 'III', sign: '+', minMv: 0.08 },
  ],
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
