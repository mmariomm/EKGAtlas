import { Beat, Condition } from '../engine/types'
import { conductionWires, normalQrsSources, repeatBeat } from './helpers'

/**
 * Hyperkalemia. The earliest and most teachable sign is the T wave: tall, narrow-
 * based, symmetric ("peaked / tented"). As K⁺ climbs the P flattens and the QRS
 * widens — toward a sine wave and arrest. Here we model the moderate stage.
 */
const hyperKBeat = (onset: number): Beat => ({
  onset,
  sources: [
    // flattened P (atrial membrane partially paralyzed)
    { dir: [0.35, 0.75, 0.5], mag: 0.03, center: 40, width: 24, segment: 'P', glow: { structures: ['RA'], kind: 'atria', start: 0, end: 70 } },
    { dir: [0.55, 0.62, -0.3], mag: 0.03, center: 66, width: 24, segment: 'P', glow: { structures: ['LA'], kind: 'atria', start: 28, end: 96 } },
    ...normalQrsSources(),
    // the hallmark: a tall, narrow, symmetric (peaked) T wave
    { dir: [0.5, 0.45, 0.35], mag: 0.95, center: 360, width: 26, segment: 'T', glow: { structures: ['RV', 'LV'], kind: 'repol', start: 322, end: 430 } },
  ],
  wires: conductionWires(),
})

export const hyperkalemia: Condition = {
  id: 'hyperkalemia',
  name: 'Hyperkalemia',
  shortName: 'Hyperkalemia',
  category: 'Electrolyte & toxic',
  tagline: 'Tall, peaked, narrow T waves — the ECG is your fastest bedside potassium meter.',
  criteria: [
    'Tall, narrow-based, symmetric (“tented”) T waves — earliest',
    'P-wave flattening → loss of P waves',
    'PR prolongation, then QRS widening',
    'Sine wave (QRS–T merge) → VF / asystole (severe)',
  ],
  story: 'Rising K⁺ → peaked T → flat P → wide QRS → sine wave → arrest',
  description:
    'Potassium sets the resting membrane potential, so a rising K⁺ rewrites the ECG in a predictable ' +
    'order. First repolarization speeds up — tall, narrow, symmetric “tented” T waves with a short QT. ' +
    'Then the depolarized resting state inactivates sodium channels: the atria fall silent (the P ' +
    'flattens and vanishes), and conduction slows so the PR lengthens and the QRS widens. At the extreme ' +
    'the QRS and T fuse into a sine wave that heralds VF or asystole. Severity is driven by the ECG, not ' +
    'the absolute number.',
  segmentNotes: [
    { segment: 'T', title: 'Peaked T wave', detail: 'Increased K⁺ conductance speeds phase-3 repolarization → a tall, NARROW-based, symmetric T and a short QT. The earliest sign.' },
    { segment: 'P', title: 'Flattening / loss of P', detail: 'Atrial muscle is depolarized toward threshold and stops generating a P — conduction can continue SA→AV silently (“sinoventricular”).' },
    { segment: 'QRS', title: 'Widening QRS', detail: 'The depolarized rest inactivates Na channels → a slow phase-0 upstroke → a broad QRS. A danger sign heading toward the sine wave.' },
  ],
  read: {
    rhythm: 'Sinus, but P waves flatten and disappear as K⁺ rises (sinoventricular conduction)',
    morphology: 'Tall, narrow-based, symmetric (“peaked/tented”) T waves; flat/absent P; QRS widens with higher K⁺',
    ischemia: 'Metabolic, not ischemic — but immediately life-threatening',
  },
  mechanism: [
    { cause: 'Serum K⁺ rises, raising (making less negative) the resting membrane potential', effect: 'The whole myocardium sits closer to threshold, partially depolarized' },
    { cause: 'Higher K⁺ conductance speeds terminal (phase-3) repolarization', effect: 'Tall, narrow, symmetric peaked T waves with a short QT — the earliest change' },
    { cause: 'The depolarized resting potential inactivates sodium channels → slow phase-0 upstroke', effect: 'Conduction slows: the PR prolongs, the QRS widens, and the atria stop generating a P' },
    { cause: 'At very high K⁺ conduction nearly fails altogether', effect: 'The QRS and T merge into a sine wave → VF / asystole' },
  ],
  clinical: 'Check K⁺ now. Peaked Ts → IV calcium to stabilize the membrane, then shift K⁺ (insulin+glucose, albuterol) and remove it. Untreated → QRS widens to a sine wave → arrest.',
  pearls: [
    'Peaked T’s you could “prick your finger on”: tall, NARROW base, symmetric — versus the broad-based hyperacute / de Winter T.',
    'Treat the ECG, not the number: any widening, bradycardia, or sine wave → IV CALCIUM now. It stabilizes the membrane in minutes (it does not lower K⁺).',
    'Then shift (insulin + glucose, albuterol) and remove (dialysis, K⁺ binders). Calcium only buys the time.',
    'A wide, bizarre, slow QRS with no clear P waves in a dialysis / renal / crush patient = hyperkalemia until proven otherwise — treat empirically.',
    'A normal ECG does NOT exclude dangerous hyperkalemia (poor sensitivity) — but an abnormal one is an emergency. HyperK can also mimic Brugada or a STEMI.',
  ],
  buildStrip: () => repeatBeat(hyperKBeat),
}
