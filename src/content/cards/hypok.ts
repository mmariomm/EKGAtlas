/** Authored 2026-08 (post-audit addition: hyperK's mirror — the U-wave window). */
import { Card } from '../schema'

export const hypok: Card = {
  id: 'hypok',
  name: 'Hypokalemia',
  aliases: ['low potassium', 'hypoK', 'U wave', 'diuretics', 'vomiting', 'QU'],
  category: 'Systemic window',
  lethal: true,
  tagline: 'The T deflates and a second wave rises behind it — the med list usually wrote both.',
  seeIt: {
    traceId: 'hypok-model',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Hypokalemia', correct: true, tempts: 'Yes — flattened T with a U wave rising behind it, sagging ST, a stretched Q-to-end-of-wave. Check the K⁺ and the Mg²⁺.' },
        { label: 'Prolonged QT', tempts: 'Close cousin — a fused T-U reads as “long QT” and carries the same torsades risk. Either way: measure, replete.' },
        { label: 'Ischemic ST depression', tempts: 'The sag fools you — but ischemic STD is territorial with reciprocals; this is diffuse, gentle, and travels with a U wave.' },
        { label: 'Normal variant', tempts: 'Small Us can be normal at slow rates — but a U approaching its own T, with a flat T and ST sag, is chemistry.' },
      ],
    },
  },
  why: [
    'Low K⁺ steepens the resting gradient — repolarization slows and fragments.',
    'The T flattens; late repolarization surfaces as its own hump: the U wave.',
    'The vulnerable window stretches — hypoK is torsades fuel, and it multiplies digoxin.',
  ],
  whyDrawer: [
    { cause: 'Serum K⁺ falls (diuretics, GI losses, insulin/refeeding shifts)', effect: 'The paradox: less K⁺ outside means LESS IKr conductance — repolarizing current weakens as the gradient steepens' },
    { cause: 'Phase-3 repolarization slows and desynchronizes', effect: 'The T wave flattens and the ST sags' },
    { cause: 'Late repolarization (Purkinje or mid-myocardial — its origin is still argued) separates out', effect: 'A U wave after the T — prominent in V2–V3, growing as K⁺ falls' },
    { cause: 'Repolarization reserve collapses (worse with low Mg²⁺, QT drugs, digoxin)', effect: 'A long QU interval and a wide-open door to torsades' },
  ],
  pills: [
    { kind: 'pearl', text: 'The sequence as K⁺ falls: T flattens → ST sags → U grows (best in V2–V3) → T and U fuse into one long "QT" — what machines call long QT is often QU. Rough anchors: changes ≈ K⁺ 3.0; U taller than T ≈ <3.0; <2.5 is severe — and severe hypoK causes VT/VF, not just torsades.' },
    { kind: 'trap', text: 'HypoK + digoxin is a multiplication, not an addition — dig toxicity arrives at "therapeutic" levels. And repleting K⁺ without Mg²⁺ often fails: magnesium first or together.' },
    { kind: 'night-eye', text: 'Vomiting, diuretics, DKA on insulin — check the K⁺ before the ECG surprises you; the shift patient’s potassium is falling while you chart.' },
    { kind: 'lookalike', text: 'A fused T-U masquerades as drug-induced long QT — and both roads end at torsades.', linkCardId: 'longqt' },
  ],
  suspectConfirm: [
    { text: 'Flat T + U wave + ST sag → check K⁺ AND Mg²⁺ (they fall together, and Mg²⁺ gates the repletion).', cites: ['AHA-QT-2020'] },
    { text: 'Audit the same med list as long QT — diuretics plus QT-prolongers plus low K⁺ is the torsades recipe.', cites: ['AHA-QT-2020'] },
  ],
  guidelineMoves: [
    { text: 'Replete K⁺ and Mg²⁺ together, toward high-normal when the QT is long or ectopy is brewing: peripheral IV K⁺ ≤10 mmol/h (≤20 central, monitored) — check renal function first.', cites: ['AHA-QT-2020', 'AHA-ACLS-2020'] },
    { text: 'Torsades on a hypoK substrate → magnesium IV first, then aggressive K⁺ correction.', cites: ['AHA-ACLS-2020', 'AHA-QT-2020'] },
  ],
  avoid: { text: 'IV potassium is NEVER pushed. And go cautiously in redistributive hypoK (periodic paralysis, insulin/refeeding shifts) — total-body K⁺ is normal and aggressive repletion rebounds into hyperkalemia.', cites: ['AHA-ACLS-2020', 'AHA-QT-2020'] },
  rnMoves: [
    { text: 'Flat Ts and a second hump after them on tele: send K⁺ and Mg²⁺ together — and pull the med list (diuretics, insulin, QT drugs) for the call.', cites: ['AHA-QT-2020'] },
    { text: 'Repleting IV K⁺: NEVER push it — infusion only, know your line’s rate limit, monitor on. Expect Mg²⁺ to ride along; question a K-only order when the Mg is low.', cites: ['AHA-QT-2020'] },
    { text: 'Watch the tele for pause-then-run polymorphic beats — hypoK is torsades fuel; escalate ectopy early.', cites: ['AHA-QT-2020'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'hypok',
    authoredReason: 'Channel-level repolarization pharmacology modeled as morphology (flat T, U wave, ST sag), honesty-labeled.',
    mustShow: [
      'the T deflating',
      'the ST sagging gently',
      'the U wave rising behind the T (late repolarization surfacing)',
      'the long QU stretch — the torsades window',
    ],
    primaryLead: 'II',
  },
  assertions: [
    { on: 'model', check: 'custom', name: 'uWave', note: 'a second positive repolarization hump ≥0.05 mV after the T in lead II' },
    { on: 'model', check: 'custom', name: 'flatT', note: 'T peak ≤55% of the solver-NSR reference T' },
    { on: 'model', check: 'qrsMs', min: 60, max: 110 },
    { on: 'model', check: 'rateBpm', min: 60, max: 90 },
  ],
  methodStep: 'st-t',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
