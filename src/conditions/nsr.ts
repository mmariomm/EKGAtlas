import { Condition } from '../engine/types'
import { tileSinus } from './helpers'

export const nsr: Condition = {
  id: 'nsr',
  name: 'Normal sinus rhythm',
  shortName: 'Normal sinus rhythm',
  category: 'Reference',
  tagline: 'The baseline. Learn this vector, and every abnormality reads as a deviation from it.',
  criteria: [
    'Rate 60–100 bpm',
    'Upright P in II, before every QRS',
    'PR 120–200 ms',
    'Narrow QRS < 120 ms',
    'Mean axis −30° to +90°',
  ],
  story: 'SA → atria → AV delay → His-Purkinje → ventricles → repolarization',
  description:
    'One impulse from the SA node sweeps down-and-left across the atria (the P wave), ' +
    'pauses at the AV node (the flat PR segment), then races through the His-Purkinje ' +
    'system to depolarize both ventricles almost simultaneously. Because the left ' +
    'ventricle dominates, the net QRS vector points down-left toward about +60° — ' +
    'aligned with lead II, which is why lead II is reliably upright.',
  segmentNotes: [
    { segment: 'P', title: 'P wave', detail: 'Atrial depolarization. Vector points to ~+60°: upright in II/III/aVF, inverted in aVR.' },
    { segment: 'PR', title: 'PR segment', detail: 'The AV node holds the impulse ~100 ms so the atria finish emptying before the ventricles fire.' },
    { segment: 'QRS', title: 'QRS complex', detail: 'Simultaneous ventricular depolarization via both bundle branches → narrow (<120 ms). Septal q, tall LV-driven R.' },
    { segment: 'T', title: 'T wave', detail: 'Repolarization, concordant with the QRS — upright wherever the R is dominant.' },
  ],
  clinical: 'Normal — no action. This is your reference: read every abnormal tracing as a deviation from it.',
  buildStrip: () => tileSinus(3),
}
