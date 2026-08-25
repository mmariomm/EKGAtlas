/** Transcribed from docs/rebuild/04-CARDS.md §4 — do not edit wording here. */
import { Card } from '../schema'

export const vtMono: Card = {
  id: 'vt-mono',
  name: 'Monomorphic ventricular tachycardia',
  aliases: ['VT', 'wide complex', 'WCT', 'tachycardia', 'v tach'],
  category: 'Rate & rhythm',
  lethal: true,
  tagline: 'Wide and fast is VT until proven otherwise — and the proof is rarely worth the gamble.',
  seeIt: {
    traceId: 'vt-model',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Ventricular tachycardia', correct: true, tempts: 'Yes — wide, fast, dissociated Ps marching through, and a fusion beat clinches it.' },
        { label: 'SVT with aberrancy', tempts: 'Possible — but betting on it kills. Prior infarct or structural disease: VT odds >95%. Age >35 alone: ~85%.' },
        { label: 'Sinus tach with bundle branch block', tempts: 'Look for the sinus P marching into each QRS — here there is none you can trust.' },
        { label: 'Hyperkalemia', tempts: 'Fair thought — sick, wide and weird belongs to K⁺ too. But look for the tachycardic, uniform, regular march of VT.' },
      ],
    },
  },
  why: [
    'A ventricular focus fires fast; each impulse crawls cell-to-cell — every QRS is wide.',
    'The sinus node never stopped — dissociated P waves march through, and sometimes capture or fuse.',
    'Muscle-to-muscle spread ignores the bundles, so the shape matches no clean BBB.',
  ],
  whyDrawer: [
    { cause: 'A ventricular focus (often scar-related) outruns the sinus node', effect: 'The ventricles are driven at 140–220/min' },
    { cause: 'Each impulse spreads muscle-to-muscle, not down the bundles', effect: 'Wide (usually >140 ms), uniform QRS complexes' },
    { cause: 'The atria stay under sinus control', effect: 'AV dissociation — Ps march through unrelated to the QRS' },
    { cause: 'Occasionally a sinus impulse sneaks down as the focus fires', effect: 'A fusion (or capture) beat — VT’s fingerprint' },
  ],
  pills: [
    { kind: 'pearl', text: 'Findings that clinch VT: AV dissociation, capture/fusion beats, concordance across V1–V6, QRS >160 ms, extreme (“northwest”) axis.' },
    { kind: 'trap', text: 'The fatal error is treating assumed “SVT with aberrancy” with verapamil or diltiazem — in VT that’s hypotension and arrest. Wide + fast gets VT treatment.' },
    { kind: 'night-eye', text: 'Algorithms (Brugada etc.) look precise but their real-world specificity is modest — never let a flowchart overrule the pretest odds of an old infarct.' },
    { kind: 'lookalike', text: 'Slow-wide-weird without tachycardia — think K⁺ before antiarrhythmics.', linkCardId: 'hyperk' },
  ],
  suspectConfirm: [
    { text: 'Assume VT; check K⁺/Mg²⁺, troponin, and dig up an old ECG only AFTER the patient is safe.', cites: ['AHA-VA-2017'] },
    { text: 'Post-conversion: 12-lead, electrolytes, ischemia workup — VT has a cause.', cites: ['AHA-VA-2017'] },
  ],
  guidelineMoves: [
    { text: 'Unstable → synchronized cardioversion. Pulseless → defibrillate.', cites: ['AHA-ACLS-2020'] },
    { text: 'Stable, REGULAR, monomorphic → IV procainamide (fewer adverse events than amiodarone in PROCAMIO) or amiodarone. If it is IRREGULAR, treat as pre-excited AF — no amiodarone there either.', cites: ['AHA-ACLS-2020', 'ESC-VA-2022'] },
    { text: 'Procainamide guardrails: 20–50 mg/min — stop at hypotension, QRS widening +50%, conversion, or 17 mg/kg total; avoid it in long QT, low EF, or decompensated HF (amiodarone there).', cites: ['AHA-ACLS-2020'] },
  ],
  avoid: { text: 'Never verapamil or diltiazem for ANY wide tachycardia — in VT that is hypotension and arrest. Irregular + wide → treat as pre-excited AF: no amiodarone either.', cites: ['AHA-ACLS-2020', 'ESC-SVT-2019'] },
  rnMoves: [
    { text: 'Wide + fast = VT until proven otherwise. Stay at the bedside — check pulse and pressure now; this rhythm changes class in seconds.', cites: ['AHA-ACLS-2020'] },
    { text: 'Pulseless → code and defibrillate. Pulse but unstable → synchronized cardioversion: pads, suction, sedation drawn, team called.', cites: ['AHA-ACLS-2020'] },
    { text: 'Anticipate procainamide or amiodarone for stable VT — on procainamide watch the BP and QRS: hypotension or QRS widening +50% stops the infusion.', cites: ['AHA-ACLS-2020', 'ESC-VA-2022'] },
    { text: 'After conversion: 12-lead, K⁺/Mg²⁺, troponin — VT has a cause and the workup starts now.', cites: ['AHA-VA-2017'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'vt-mono',
    authoredReason: 'AV dissociation needs two independent pacemakers; the solver paces one site.',
    mustShow: [
      'the ectopic ventricular focus firing',
      'slow cell-to-cell spread (wide QRS)',
      'the atria keeping their own beat (dissociation)',
      'one fusion beat',
    ],
    primaryLead: 'V1',
  },
  assertions: [
    { on: 'model', check: 'rateBpm', min: 140, max: 220 },
    { on: 'model', check: 'qrsMs', min: 140, max: 220 },
    { on: 'model', check: 'custom', name: 'regularRun', note: 'VT run RR cv < 0.06' },
    { on: 'model', check: 'custom', name: 'avDissociation', note: 'atrial P sources march at a rate different from the ventricular rate' },
  ],
  methodStep: 'rhythm',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
