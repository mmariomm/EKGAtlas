import { Beat, Condition } from '../engine/types'
import { atrialSources, conductionWires, normalQrsSources, repeatBeat } from './helpers'

// ===========================================================================
// Brugada type 1 — coved ST elevation V1–V2
// ===========================================================================
const brugadaBeat = (onset: number): Beat => ({
  onset,
  sources: [
    ...atrialSources(),
    ...normalQrsSources(),
    // coved ("shark-fin") ST elevation pointing at V1–V2
    { dir: [-0.45, 0.0, 0.9], mag: 0.5, center: 285, width: 28, segment: 'ST', glow: { structures: ['RV'], kind: 'injury', start: 262, end: 322, note: 'coved ST elevation V1–V2' } },
    // T inversion in V1–V2 (vector away from the anterior-right)
    { dir: [0.4, 0.1, -0.7], mag: 0.42, center: 365, width: 50, segment: 'T', glow: { structures: ['RV', 'LV'], kind: 'repol', start: 325, end: 445 } },
  ],
  wires: conductionWires(),
})

export const brugada: Condition = {
  id: 'brugada',
  name: 'Brugada (type 1)',
  shortName: 'Brugada',
  category: 'High-risk syncope',
  tagline: 'Coved “shark-fin” ST elevation in V1–V2 — a channelopathy, not ischemia.',
  criteria: ['Coved ST elevation ≥2 mm in V1–V2', 'Followed by a negative (inverted) T', 'RBBB-like appearance', 'Often unmasked by fever / Na-channel blockers'],
  story: 'A sodium-channel disease that mimics a right-precordial injury pattern',
  description:
    'A sodium-channelopathy, not ischemia: V1–V2 show a coved (downsloping, "shark-fin") ST ' +
    'elevation that descends into an inverted T. The pattern can come and go and is classically ' +
    'unmasked by fever or sodium-channel-blocking drugs. It matters because it carries a real risk ' +
    'of polymorphic VT and sudden cardiac death.',
  segmentNotes: [
    { segment: 'ST', title: 'Coved STE V1–V2', detail: 'Downsloping ST elevation ≥2 mm — the type-1 (diagnostic) Brugada morphology.' },
    { segment: 'T', title: 'Inverted T', detail: 'The coved ST descends into a negative T in V1–V2.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'Coved ST elevation ≥2 mm with an inverted T in V1–V2 (type 1)',
    ischemia: 'Not ischemia — a Na-channel channelopathy',
  },
  clinical: 'Type 1 Brugada + syncope / VT / family history of sudden death → high SCD risk: cardiology/EP, consider ICD. Avoid fever and Na-channel blockers, which unmask/worsen it.',
  buildStrip: () => repeatBeat(brugadaBeat),
}

// ===========================================================================
// WPW — pre-excitation
// ===========================================================================
const wpwBeat = (onset: number): Beat => ({
  onset,
  sources: [
    ...atrialSources(),
    // delta wave: the accessory pathway pre-excites the ventricle (no AV delay)
    { dir: [0.6, 0.5, -0.05], mag: 0.5, center: 120, width: 22, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 96, end: 150, note: 'accessory pathway pre-excites → delta wave' } },
    // main QRS, fused with the delta
    { dir: [0.8, 0.45, -0.2], mag: 1.05, center: 178, width: 16, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 150, end: 216 } },
    { dir: [-0.4, -0.1, -0.3], mag: 0.18, center: 206, width: 12, segment: 'QRS' },
    // secondary ST/T changes
    { dir: [-0.3, -0.2, 0.3], mag: 0.4, center: 360, width: 55, segment: 'T', glow: { structures: ['RV', 'LV'], kind: 'repol', start: 320, end: 450 } },
  ],
  wires: [
    { structure: 'SA', start: 0, end: 14, kind: 'sa' },
    { structure: 'AV', start: 92, end: 150, kind: 'av', note: 'AV node — but the accessory pathway gets there first' },
  ],
})

export const wpw: Condition = {
  id: 'wpw',
  name: 'WPW (pre-excitation)',
  shortName: 'WPW',
  category: 'High-risk syncope',
  tagline: 'Short PR + delta wave — an accessory pathway that bypasses the AV node.',
  criteria: ['Short PR < 120 ms', 'Delta wave (slurred QRS upstroke)', 'Wide QRS', 'Secondary ST/T changes'],
  story: 'An accessory pathway pre-excites the ventricle before the AV-node impulse arrives',
  description:
    'An accessory pathway (bypass tract) connects atria to ventricles outside the AV node, so part ' +
    'of the ventricle is "pre-excited" before the normal, AV-delayed impulse arrives. That gives the ' +
    'short PR and the delta wave (a slurred QRS upstroke) fusing into a wide QRS. The danger is ' +
    'arrhythmia: re-entrant tachycardia, and — if atrial fibrillation occurs — very rapid conduction ' +
    'down the pathway that can degenerate into VF.',
  segmentNotes: [
    { segment: 'PR', title: 'Short PR', detail: 'The accessory pathway skips the AV delay, so the PR is < 120 ms.' },
    { segment: 'QRS', title: 'Delta wave', detail: 'Slow initial cell-to-cell spread from the pre-excited region slurs the QRS upstroke.' },
  ],
  read: {
    rhythm: 'Sinus with ventricular pre-excitation via an accessory pathway',
    morphology: 'Short PR (<120 ms), delta wave (slurred QRS upstroke), wide QRS',
    ischemia: 'Secondary ST/T changes (not ischemia)',
  },
  clinical: 'WPW (short PR + delta). Risk of AVRT and, in atrial fibrillation, dangerously rapid conduction down the accessory pathway. AVOID AV-nodal blockers (adenosine/verapamil/diltiazem/digoxin) in WPW + AF — use procainamide. Refer for EP study / ablation.',
  buildStrip: () => repeatBeat(wpwBeat),
}
