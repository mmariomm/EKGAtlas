/** Transcribed from docs/rebuild/04-CARDS.md §16 — do not edit wording here. */
import { Card } from '../schema'

export const hyperk: Card = {
  id: 'hyperk',
  name: 'Hyperkalemia',
  aliases: ['potassium', 'K', 'hyperK', 'tented T', 'peaked T', 'renal', 'dialysis'],
  category: 'Systemic window',
  lethal: true,
  tagline: 'The trace is a window on the blood, not just the heart — and K⁺ is the fastest thing it shows.',
  moduleHref: { href: '/lab/hyperk', label: 'HyperK Lab: five patients, one K⁺ — estimate it' },
  seeIt: {
    traceId: 'hyperk-model-moderate',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Hyperkalemia', correct: true, tempts: 'Yes — tented narrow Ts, fading Ps, a QRS starting to stretch. Calcium first.' },
        { label: 'Acute occlusion (hyperacute T)', tempts: 'OMI Ts are broad-based and regional; hyperK Ts are narrow, pinched, and everywhere.' },
        { label: 'VT', tempts: 'Wide-and-weird reads as VT — sine-wave hyperkalemia has been shocked as VT more than once. Sick + renal + no clear Ps → K⁺ first.' },
        { label: 'LBBB', tempts: 'Wide QRS, but with flattening Ps and tented Ts — blocks don’t erase P waves.', },
      ],
    },
  },
  why: [
    'Rising K⁺ raises the resting potential — the whole myocardium sits half-depolarized.',
    'Repolarization speeds up first: tall, narrow, tented Ts.',
    'Then sodium channels inactivate: Ps flatten, PR stretches, QRS widens — toward a sine wave.',
  ],
  whyDrawer: [
    { cause: 'Serum K⁺ rises, raising (making less negative) the resting membrane potential', effect: 'Every myocyte sits closer to threshold, partially depolarized' },
    { cause: 'Higher K⁺ conductance speeds terminal (phase-3) repolarization', effect: 'Tall, narrow, symmetric tented T waves — the earliest change' },
    { cause: 'The depolarized rest inactivates sodium channels → slow phase-0 upstrokes', effect: 'Conduction slows everywhere: PR stretches, QRS widens, the atria fall silent while the sinus still drives (sinoventricular)' },
    { cause: 'At the extreme, conduction nearly fails altogether', effect: 'QRS and T merge into a sine wave → VF or asystole' },
  ],
  pills: [
    { kind: 'pearl', text: 'Tented T = you could prick a finger on it: tall, NARROW base, symmetric. HyperK’s opener — versus the broad hyperacute T.' },
    { kind: 'trap', text: 'Treat the ECG, not the number: any widening, bradycardia, or sine wave → calcium NOW. The lab value can lag the arrest.' },
    { kind: 'night-eye', text: 'Dialysis, renal failure, crush injury + wide bizarre slow rhythm with missing Ps = K⁺ until proven otherwise — treat empirically.' },
    { kind: 'pearl', text: '⚠ A normal ECG never rules hyperkalemia out — sensitivity is poor. It rules IN, never OUT.' },
  ],
  suspectConfirm: [
    { text: 'Suspect on pattern + context (renal failure, K-sparing drugs, ACE-i, crush, acidosis); confirm with a stat K⁺ and a VBG.', cites: ['UKKA-K-2023'] },
    { text: 'Rate of rise beats the absolute level — a fast climb is the dangerous climb.', cites: ['UKKA-K-2023'] },
  ],
  guidelineMoves: [
    { text: 'ECG changes → IV calcium first (stabilizes the membrane in minutes; lowers nothing).', cites: ['UKKA-K-2023'] },
    { text: 'Then shift: insulin 10 U + dextrose, plus nebulized salbutamol.', cites: ['UKKA-K-2023'] },
    { text: 'Then eliminate: dialysis / binders / diuresis — and stop the K⁺ sources.', cites: ['UKKA-K-2023'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'hyperk',
    authoredReason: 'Membrane-level channel effects are modeled as morphology stages, explicitly labeled one possible trajectory.',
    morphLabel: 'one possible trajectory',
    mustShow: [
      'repolarization speeding (tented T)',
      'atria falling silent while the sinus keeps driving',
      'conduction slowing everywhere (widening)',
      'the sine-wave merge at the far end of the morph',
    ],
    primaryLead: 'II',
  },
  assertions: [
    { on: 'model', check: 'custom', name: 'tentedT', note: 'T peak(II) ≥1.6× solver-NSR reference AND T width ≤65% of NSR T width (frame a)' },
    { on: 'model', check: 'custom', name: 'hyperkFrames', note: 'frame b: P ≤0.05 mV · frame c: QRS ≥140 ms · frame d: sine merge (no isoelectric ST)' },
    { on: 'trace', check: 'qrsMs', min: 80, max: 140 },
    { on: 'trace', check: 'rateBpm', min: 55, max: 90 },
  ],
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
