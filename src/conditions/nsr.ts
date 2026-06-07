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
  read: {
    rhythm: 'Sinus — an upright P before every QRS, regular',
    morphology: 'Narrow QRS, normal R-wave progression, no pathologic Q waves',
    ischemia: 'None — ST isoelectric, T concordant with the QRS',
  },
  mechanism: [
    { cause: 'The SA node (high right atrium) fires and the wavefront sweeps down-and-left across both atria', effect: 'The P wave — vector ~+60°, upright in II/III/aVF, inverted in aVR' },
    { cause: 'The wavefront reaches the AV node, which deliberately conducts slowly', effect: 'The flat PR segment — the atrial kick finishes filling the ventricles' },
    { cause: 'The impulse bursts into the His-Purkinje network; the septum depolarizes first, left-to-right', effect: 'The small septal q in the lateral leads (and an initial r in V1)' },
    { cause: 'Both ventricles depolarize almost at once via Purkinje; the larger LV dominates', effect: 'A big down-left QRS vector (~+60°) — tall R in I/II/V5–6, deep S in V1' },
    { cause: 'The epicardium repolarizes before the endocardium — opposite the path depolarization took', effect: 'An upright T wave, concordant with the QRS' },
  ],
  clinical: 'Normal — no action. This is your reference: read every abnormal tracing as a deviation from it.',
  pearls: [
    'Quick axis check: if lead I and lead II are both upright, the axis sits in the normal quadrant.',
    'Small septal q waves (<40 ms, <25% of the R) in I/aVL/V5/V6 are NORMAL — the left-to-right septal vector, not infarct Q waves.',
    'R waves should grow across the precordium (R-wave progression), with the transition around V3–V4.',
    'A T wave inverted in aVR (and sometimes V1/III) is normal concordance, not ischemia.',
    'Burn this vector into memory — every abnormal ECG in the catalog reads as a deviation from it.',
  ],
  buildStrip: () => tileSinus(3),
}
