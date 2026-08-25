/** Transcribed from docs/rebuild/04-CARDS.md §13 — do not edit wording here. */
import { Card } from '../schema'

export const sgarbossa: Card = {
  id: 'sgarbossa',
  name: 'Occlusion MI in LBBB',
  aliases: ['Sgarbossa', 'Smith', 'concordant', 'LBBB STEMI', 'discordance'],
  category: 'Occlusion & ischemia',
  lethal: true,
  tagline: 'LBBB hides ischemia behind expected discordance — catch the ST that breaks the rule.',
  seeIt: {
    traceId: 'sgarbossa-model',
    extraTraceIds: ['ptbxl-338-lbbb'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'LBBB with concordant STE — occlusion MI', correct: true, tempts: 'Yes — the lateral ST rises WITH a positive QRS. The block cannot do that on its own.' },
        { label: 'Plain LBBB', tempts: 'The lateral ST here rises WITH a positive QRS. LBBB never does that on its own — compare recording 2.' },
        { label: 'Ventricular paced rhythm', tempts: 'Same discordance logic, but no pacing spikes — and the criteria apply to both anyway.' },
        { label: 'Hyperkalemia', tempts: 'Wide-and-weird again — but the Ps are preserved and the story is chest pain, not renal failure.' },
      ],
    },
  },
  why: [
    'LBBB’s rule: ST/T point OPPOSITE the QRS, proportionally — “appropriate discordance.”',
    'A transmural injury current adds its own ST vector on top.',
    'ST going WITH the QRS — or opposite but out of proportion — is what the block can’t explain: the occlusion.',
  ],
  whyDrawer: [
    { cause: 'LBBB forces late, backward LV depolarization', effect: 'Repolarization reverses too: ST/T oppose the QRS, in proportion — the baseline rule' },
    { cause: 'An acute occlusion adds a genuine injury-current vector', effect: 'An ST shift the conduction abnormality cannot account for' },
    { cause: 'The injury vector points WITH the (positive) lateral QRS', effect: 'Concordant ST elevation — 5 points, nearly diagnostic' },
    { cause: 'Or the discordance overshoots all proportion', effect: 'STE ≥25% of the S depth (Smith ST/S ≤ −0.25) — the modern, sensitive criterion' },
  ],
  pills: [
    { kind: 'pearl', text: 'Sgarbossa: concordant STE ≥1 mm (5 pts) · concordant STD ≥1 mm in V1–V3 (3 pts) · discordant STE ≥5 mm (2 pts). ≥3 points = treat as occlusion.' },
    { kind: 'pearl', text: 'Smith modification: discordant STE ≥25% of the preceding S depth (ST/S ≤ −0.25) — replaces the blunt 5 mm rule, much better sensitivity.' },
    { kind: 'trap', text: '“It’s LBBB, can’t read ischemia” is a chart-review classic. You can. You just did.' },
    { kind: 'night-eye', text: 'Same rules for paced rhythms — concordance stays guilty.', linkCardId: 'paced-v' },
  ],
  suspectConfirm: [
    { text: 'Positive criteria + ACS story → treat as occlusion; serial ECGs if borderline.', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Sgarbossa-positive (classic ≥3 pts or Smith-modified) → activate reperfusion.', cites: ['AHA-ACS-2025', 'SMITH-MSC-2012'] },
  ],
  rnMoves: [
    { text: 'LBBB or paced rhythm + chest pain: scan for ST pointing WITH the QRS — concordance is never the block; escalate immediately.', cites: ['AHA-ACS-2025'] },
    { text: 'Anticipate serial ECGs and cath activation if criteria land; keep prior ECGs at hand — new vs old changes everything.', cites: ['AHA-ACS-2025', 'SMITH-MSC-2012'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'sgarbossa',
    authoredReason: 'Exact concordant-STE morphology on an LBBB chassis exceeds solver resolution; the LBBB base is solver-generated, the injury vector authored.',
    mustShow: [
      'the LBBB activation (late LV, blocked left bundle)',
      'the added injury vector pointing WITH the lateral QRS',
      'the concordance standing out against recording 2 (plain LBBB)',
    ],
    primaryLead: 'V5',
  },
  assertions: [
    { on: 'model', check: 'qrsMs', min: 120, max: 185 },
    { on: 'model', check: 'custom', name: 'concordantSTE', note: 'V5: net QRS positive AND stShift ≥ +0.1 mV — concordance, the point of the card' },
    { on: 'model', check: 'netQrs', lead: 'V1', sign: '-' },
  ],
  methodStep: 'st-t',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
