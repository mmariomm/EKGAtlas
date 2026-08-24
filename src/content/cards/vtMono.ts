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
        { label: 'SVT with aberrancy', tempts: 'Possible — but betting on it kills. Age >35 or any infarct history: VT odds >90%.' },
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
    { text: 'Stable → IV procainamide or amiodarone — never verapamil/diltiazem for undifferentiated wide tachycardia.', cites: ['AHA-ACLS-2020', 'ESC-VA-2022'] },
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
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
