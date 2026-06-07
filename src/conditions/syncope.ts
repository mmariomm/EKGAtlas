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
  tagline: 'Coved “shark-fin” ST elevation into an inverted T in V1–V2 — a sodium channel, not a coronary.',
  criteria: [
    'Coved ST elevation ≥2 mm in ≥1 of V1–V2',
    'ST descends into a NEGATIVE (inverted) T',
    'Type 1 is diagnostic; type 2 (“saddleback”) only suggestive',
    'High right-precordial leads (2nd–3rd ICS) raise sensitivity',
    'Unmasked by fever / Na-channel blockers',
  ],
  story: 'A loss-of-function sodium channelopathy that mimics a right-precordial injury pattern',
  description:
    'Brugada is a sodium-channelopathy (often SCN5A), not ischemia. Reduced sodium current lets the ' +
    'right-ventricular epicardium lose its action-potential dome while the endocardium keeps it, ' +
    'creating a voltage gradient across the RV that projects onto V1–V2 as a coved (downsloping, ' +
    '“shark-fin”) ST elevation descending into an inverted T — the diagnostic type-1 pattern. The same ' +
    'dispersion of repolarization enables phase-2 reentry, which is why it carries a real risk of ' +
    'polymorphic VT and sudden death. It is classically unmasked by fever or sodium-channel-blocking drugs.',
  segmentNotes: [
    { segment: 'ST', title: 'Coved STE V1–V2', detail: 'Downsloping ST elevation ≥2 mm — the type-1 (diagnostic) morphology. A “saddleback” shape is type 2 and only suggestive.' },
    { segment: 'T', title: 'Inverted T', detail: 'The coved ST descends straight into a negative T in V1–V2 — one flowing “shark-fin,” not a separate STE then upright T.' },
    { segment: 'QRS', title: 'RBBB-like, but not true RBBB', detail: 'An rSr′-like terminal in V1 can mimic RBBB, but the lateral leads lack the wide slurred S of a real RBBB.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'Coved ST elevation ≥2 mm descending into an inverted T in V1–V2 (type 1)',
    ischemia: 'Not ischemia — a Na-channel channelopathy',
  },
  mechanism: [
    { cause: 'Reduced cardiac sodium current (e.g. SCN5A loss of function)', effect: 'A weakened phase-0 upstroke, worst where the transient-outward K⁺ current (Ito) is strong — the RV epicardium' },
    { cause: 'The RV epicardium loses its action-potential dome while the endocardium keeps it', effect: 'A transmural repolarization voltage gradient across the RV outflow tract' },
    { cause: 'That gradient projects onto the right precordial leads', effect: 'Coved ST elevation flowing into an inverted T in V1–V2 (type 1)' },
    { cause: 'The same repolarization heterogeneity permits phase-2 reentry', effect: 'Polymorphic VT / VF → syncope or sudden cardiac death' },
  ],
  clinical: 'Type 1 Brugada + syncope / VT / family history of sudden death → high SCD risk: cardiology/EP, consider ICD. Avoid fever and Na-channel blockers, which unmask/worsen it.',
  pearls: [
    'It is a channel, not a coronary: coved STE in V1–V2 in a young, structurally-normal heart, often with syncope or a family history of sudden death.',
    'Fever unmasks it — a type-1 pattern can appear during a febrile illness. Treat the fever aggressively and recheck when afebrile.',
    'Move V1–V2 UP to the 2nd–3rd intercostal space to increase sensitivity (the RV outflow tract sits high).',
    'Risk = pattern + symptoms: type-1 with prior arrest / syncope / VT / family Hx of SCD → EP referral, consider ICD.',
    'Avoid the triggers (brugadadrugs.org): class I antiarrhythmics, many psychotropics, cocaine. Exclude phenocopies — hyperkalemia, RV ischemia, PE — first.',
  ],
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
  tagline: 'Short PR + delta wave — an accessory pathway that skips the AV node and can kill in AF.',
  criteria: [
    'Short PR < 120 ms',
    'Delta wave (slurred QRS upstroke)',
    'Wide QRS (a fusion beat)',
    'Secondary ST/T changes',
    'WPW syndrome = this pattern PLUS arrhythmia',
  ],
  story: 'An accessory pathway pre-excites the ventricle before the AV-node impulse arrives',
  description:
    'An accessory pathway (bundle of Kent) connects atrium to ventricle outside the AV node. Because it ' +
    'has no decremental delay, the atrial impulse reaches the ventricle EARLY (short PR) and starts ' +
    'depolarizing working myocardium cell-to-cell — a slurred upstroke, the delta wave. The normal ' +
    'AV-node impulse then arrives and activates the rest of the ventricle through the His-Purkinje ' +
    'system, so the QRS is a FUSION of both. The real danger is rhythm: re-entrant tachycardia, and — in ' +
    'atrial fibrillation — unchecked rapid conduction down the pathway that can degenerate into VF.',
  segmentNotes: [
    { segment: 'PR', title: 'Short PR', detail: 'The pathway bypasses the AV node’s delay, so the ventricle is activated early → PR < 120 ms.' },
    { segment: 'QRS', title: 'Delta wave', detail: 'The pre-excited region starts in working muscle (not Purkinje), so the initial spread is slow → a slurred QRS upstroke.' },
    { segment: 'QRS', title: 'Fusion QRS', detail: 'Pathway-driven and AV-node-driven activation fuse; how wide the QRS is depends on how much of the ventricle is pre-excited.' },
    { segment: 'T', title: 'Secondary ST/T changes', detail: 'Abnormal depolarization order forces repolarization changes (not ischemia); negative delta waves can also mimic Q waves.' },
  ],
  read: {
    rhythm: 'Sinus with ventricular pre-excitation via an accessory pathway',
    morphology: 'Short PR (<120 ms), delta wave (slurred QRS upstroke), wide fusion QRS',
    ischemia: 'Secondary ST/T changes (and pseudo-infarct Q waves) — not ischemia',
  },
  mechanism: [
    { cause: 'An accessory pathway (bundle of Kent) bridges atrium to ventricle outside the AV node', effect: 'A second, faster route into the ventricle with no protective delay' },
    { cause: 'The atrial impulse races down the pathway with no AV-node delay', effect: 'The ventricle is pre-excited early → a short PR interval' },
    { cause: 'It enters working myocardium and spreads cell-to-cell at first', effect: 'A slurred initial QRS upstroke — the delta wave' },
    { cause: 'The AV-node impulse then activates the rest via His-Purkinje', effect: 'A fusion QRS (wide) with secondary ST/T changes' },
    { cause: 'Two routes form a circuit; in atrial fibrillation the pathway conducts unchecked', effect: 'Re-entrant AVRT, and pre-excited AF — fast, broad, irregular — that can degenerate to VF' },
  ],
  clinical: 'WPW (short PR + delta). Risk of AVRT and, in atrial fibrillation, dangerously rapid conduction down the accessory pathway. AVOID AV-nodal blockers (adenosine/verapamil/diltiazem/digoxin) in WPW + AF — use procainamide. Refer for EP study / ablation.',
  pearls: [
    'WPW = the pattern. WPW SYNDROME = pattern + arrhythmia. Resting triad: short PR, delta wave, wide QRS.',
    'The killer is AF with pre-excitation: irregular + broad + very fast (often >200). AV-nodal blockers are CONTRAINDICATED.',
    'Avoid “ABCD” in pre-excited AF — Adenosine, Beta-blockers, Calcium-channel blockers, Digoxin push more current down the pathway. Use procainamide (or ibutilide); cardiovert if unstable.',
    'The delta-wave / QRS axis can localize the pathway and can mimic infarction (pseudo-Q waves).',
    'Intermittent pre-excitation, or loss of the delta wave with exercise, suggests a lower-risk pathway. Definitive cure = EP study + catheter ablation.',
  ],
  buildStrip: () => repeatBeat(wpwBeat),
}
