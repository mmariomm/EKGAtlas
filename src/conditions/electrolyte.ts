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
  tagline: 'Tall, peaked, narrow T waves — the first warning of a rising potassium.',
  criteria: ['Tall, peaked, symmetric T waves', 'Flattened / absent P waves', 'Widening QRS (advanced)', 'Sine wave → arrest (severe)'],
  story: 'Rising K⁺ → membrane changes → peaked T → flat P → wide QRS → sine wave',
  description:
    'Potassium controls the resting membrane potential, so a rising K⁺ rewrites repolarization ' +
    'first: the T wave becomes tall, narrow-based, and symmetric — "peaked". As K⁺ climbs further ' +
    'the atria fall silent (P flattens), then conduction slows and the QRS widens; at the extreme ' +
    'the QRS and T merge into a sine wave that precedes arrest. The peaked T is your early, ' +
    'easy-to-miss warning.',
  segmentNotes: [
    { segment: 'P', title: 'Flattening P', detail: 'Atrial myocytes are depolarized toward threshold and stop generating a normal P.' },
    { segment: 'QRS', title: 'Widening QRS', detail: 'Slowed conduction broadens the QRS as K⁺ rises — a danger sign.' },
    { segment: 'T', title: 'Peaked T wave', detail: 'Faster, more complete repolarization makes the T tall, narrow, and symmetric.' },
  ],
  read: {
    rhythm: 'Sinus, but P waves flatten as K⁺ rises',
    morphology: 'Tall, narrow-based, symmetric (“peaked/tented”) T waves; flat P; QRS widens with higher K⁺',
    ischemia: 'Metabolic, not ischemic — but immediately life-threatening',
  },
  clinical: 'Check K⁺ now. Peaked Ts → IV calcium to stabilize the membrane, then shift K⁺ (insulin+glucose, albuterol) and remove it. Untreated → QRS widens to a sine wave → arrest.',
  buildStrip: () => repeatBeat(hyperKBeat),
}
