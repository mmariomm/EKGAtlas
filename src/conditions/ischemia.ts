import { Beat, Condition } from '../engine/types'
import { atrialSources, conductionWires, normalQrsSources, repeatBeat } from './helpers'

// ===========================================================================
// STEMI inside LBBB — Sgarbossa
// ===========================================================================
const sgarbossaBeat = (onset: number): Beat => ({
  onset,
  sources: [
    ...atrialSources(),
    { dir: [0.5, 0.25, 0.1], mag: 0.2, center: 172, width: 12, segment: 'QRS', glow: { structures: ['SEPTUM'], kind: 'ventricle', start: 168, end: 206, note: 'septum reversed (LBBB)' } },
    { dir: [0.2, 0.2, 0.5], mag: 0, center: 185, width: 1, segment: 'QRS', glow: { structures: ['RV'], kind: 'ventricle', start: 168, end: 206 } },
    { dir: [0.92, 0.4, -0.35], mag: 1.15, center: 205, width: 18, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 200, end: 272, note: 'LV depolarizes late' } },
    { dir: [0.96, 0.32, -0.5], mag: 1.05, center: 242, width: 20, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 240, end: 292 } },
    // CONCORDANT ST elevation (same direction as the dominant R) = Sgarbossa-positive
    { dir: [0.9, 0.3, -0.25], mag: 0.42, center: 305, width: 34, segment: 'ST', glow: { structures: ['LV'], kind: 'injury', start: 285, end: 350, note: 'concordant ST elevation' } },
    { dir: [0.55, 0.35, -0.2], mag: 0.35, center: 382, width: 60, segment: 'T' },
  ],
  wires: [
    { structure: 'SA', start: 0, end: 14, kind: 'sa' },
    { structure: 'AV', start: 92, end: 156, kind: 'av', note: 'AV node delay' },
    { structure: 'HIS', start: 150, end: 166, kind: 'av' },
    { structure: 'RBB', start: 158, end: 178, kind: 'av' },
  ],
})

export const sgarbossa: Condition = {
  id: 'sgarbossa',
  name: 'STEMI in LBBB (Sgarbossa)',
  shortName: 'STEMI in LBBB (Sgarbossa)',
  category: 'Ischemia & infarction',
  tagline: 'LBBB normally hides ischemia — concordant ST elevation unmasks a STEMI.',
  criteria: ['LBBB pattern', 'Concordant ST elevation ≥1 mm', 'or concordant ST depression V1–V3', 'or excessively discordant STE (≥5 mm / ratio)'],
  story: 'LBBB QRS, but the ST goes the SAME way as the QRS — that is never normal',
  description:
    'LBBB always has discordant ST/T (opposite the QRS), which masks ischemia. Sgarbossa criteria ' +
    'find the STEMI hiding inside: ST that is CONCORDANT with the QRS (elevation where the QRS is ' +
    'positive, or depression in V1–V3 where it is negative), or discordance so excessive it can’t be ' +
    'explained by the LBBB alone. Here the lateral leads show ST elevation in the SAME direction as ' +
    'their dominant R — pathological.',
  segmentNotes: [
    { segment: 'QRS', title: 'LBBB chassis', detail: 'Broad QRS, dominant leftward forces — the expected pattern to read against.' },
    { segment: 'ST', title: 'Concordant STE', detail: 'ST elevation in the same direction as the QRS (here, with the lateral R) — the Sgarbossa flag.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'LBBB pattern, but the ST is CONCORDANT with the QRS (same direction) — pathological',
    ischemia: 'Concordant ST elevation = acute STEMI within LBBB (Sgarbossa-positive)',
  },
  clinical: 'LBBB + concordant ST elevation (or concordant ST↓ V1–V3, or excessively discordant STE) = Sgarbossa-positive → treat as STEMI: activate the cath lab.',
  blockedBranches: ['LBB', 'LAF', 'LPF'],
  buildStrip: () => repeatBeat(sgarbossaBeat),
}

// ===========================================================================
// de Winter — LAD-occlusion equivalent
// ===========================================================================
const deWinterBeat = (onset: number): Beat => ({
  onset,
  sources: [
    ...atrialSources(),
    ...normalQrsSources(),
    // upsloping J-point ST depression in the precordials (ST vector posterior)
    { dir: [0.15, 0.15, -0.85], mag: 0.34, center: 292, width: 30, segment: 'ST', glow: { structures: ['LV'], kind: 'injury', start: 272, end: 330, note: 'upsloping ST depression' } },
    // tall, symmetric precordial T waves
    { dir: [0.35, 0.25, 0.78], mag: 0.72, center: 372, width: 48, segment: 'T', glow: { structures: ['RV', 'LV'], kind: 'repol', start: 332, end: 452 } },
  ],
  wires: conductionWires(),
})

export const deWinter: Condition = {
  id: 'de-winter',
  name: 'de Winter pattern',
  shortName: 'de Winter',
  category: 'Ischemia & infarction',
  tagline: 'Upsloping ST depression + tall T in the precordials = LAD occlusion equivalent.',
  criteria: ['Upsloping ST depression at the J point in V1–V6', 'Tall, symmetric precordial T waves', '± slight ST elevation in aVR', 'No (yet) classic ST elevation'],
  story: 'Proximal LAD occlusion presenting WITHOUT classic ST elevation',
  description:
    'A static, easily-missed sign of acute proximal LAD occlusion. Instead of ST elevation you see ' +
    'upsloping ST depression at the J point in the precordial leads that rises into tall, symmetric, ' +
    'prominent T waves, often with slight ST elevation in aVR. It is a STEMI-equivalent — the artery ' +
    'is occluded now.',
  segmentNotes: [
    { segment: 'ST', title: 'Upsloping ST↓', detail: 'J-point depression in V1–V6 that slopes up into the T — the de Winter signature.' },
    { segment: 'T', title: 'Tall symmetric T', detail: 'Prominent, symmetric precordial T waves — the “hyperacute” partner of the ST depression.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'Upsloping ST depression at the J point with tall, symmetric T in V1–V6 (± slight STE in aVR)',
    ischemia: 'LAD-occlusion equivalent — treat as STEMI',
  },
  clinical: 'de Winter = acute proximal LAD occlusion equivalent → cath lab, even without classic ST elevation. Easy to miss, high stakes.',
  buildStrip: () => repeatBeat(deWinterBeat),
}

// ===========================================================================
// Wellens — critical LAD stenosis (warning sign)
// ===========================================================================
const wellensBeat = (onset: number): Beat => ({
  onset,
  sources: [
    ...atrialSources(),
    ...normalQrsSources(),
    // deep, symmetric T inversion localized to V2–V3 (vector posterior)
    { dir: [0.3, 0.2, -0.92], mag: 0.6, center: 372, width: 56, segment: 'T', glow: { structures: ['RV', 'LV'], kind: 'repol', start: 332, end: 458 } },
  ],
  wires: conductionWires(),
})

export const wellens: Condition = {
  id: 'wellens',
  name: 'Wellens syndrome',
  shortName: 'Wellens',
  category: 'Ischemia & infarction',
  tagline: 'Deep, symmetric T inversions in V2–V3 while pain-free — critical LAD stenosis.',
  criteria: ['Deep symmetric T inversion (type B) or biphasic T (type A) in V2–V3', 'Preserved R waves, no Q waves', 'Little/no ST elevation', 'Often recorded pain-free'],
  story: 'Reperfused critical LAD lesion — a warning of impending anterior MI',
  description:
    'A pattern that warns of critical proximal LAD stenosis: deep, symmetric T-wave inversions (or ' +
    'biphasic T waves) in V2–V3, typically captured when the patient is pain-free and with normal or ' +
    'minimally raised troponin. The danger is being reassured by a near-normal-looking ECG and ' +
    'stress-testing the patient into an anterior MI.',
  segmentNotes: [
    { segment: 'T', title: 'Wellens T waves', detail: 'Deep, symmetric inversions (or biphasic) in V2–V3 — reperfusion change of a critical LAD lesion.' },
    { segment: 'QRS', title: 'Preserved R waves', detail: 'No Q waves / preserved R — the muscle is still salvageable, which is the point.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'Deep, symmetric T inversions in V2–V3 (type B) or biphasic T (type A); preserved R waves',
    ischemia: 'Critical proximal LAD stenosis — impending anterior MI',
  },
  clinical: 'Wellens (deep/biphasic T in V2–V3 when pain-free, troponin near-normal) = critical LAD stenosis. Admit; do NOT stress-test; angiography. A near-normal ECG is not reassurance.',
  buildStrip: () => repeatBeat(wellensBeat),
}

// ===========================================================================
// Posterior MI — the mirror image
// ===========================================================================
const posteriorBeat = (onset: number): Beat => ({
  onset,
  sources: [
    ...atrialSources(),
    ...normalQrsSources(),
    // posterior-wall depolarization, mirrored → tall R in V1–V2
    { dir: [-0.3, 0.05, 0.85], mag: 1.1, center: 202, width: 15, segment: 'QRS', glow: { structures: ['LV'], kind: 'ventricle', start: 176, end: 244, note: 'posterior wall (mirrored → tall R in V1)' } },
    // horizontal ST depression V1–V3 (mirror of posterior ST elevation)
    { dir: [0.1, 0.0, -0.92], mag: 0.46, center: 295, width: 30, segment: 'ST', glow: { structures: ['LV'], kind: 'injury', start: 275, end: 332, note: 'reciprocal ST↓ — posterior STEMI' } },
    { dir: [0.35, 0.2, 0.7], mag: 0.45, center: 372, width: 50, segment: 'T', glow: { structures: ['RV', 'LV'], kind: 'repol', start: 332, end: 452 } },
  ],
  wires: conductionWires(),
})

export const posteriorMI: Condition = {
  id: 'posterior-mi',
  name: 'Posterior STEMI',
  shortName: 'Posterior STEMI',
  category: 'Ischemia & infarction',
  tagline: 'Tall R + ST depression in V1–V3 — the mirror of a posterior ST elevation.',
  criteria: ['Horizontal ST depression V1–V3', 'Tall, broad R in V1–V2 (R/S > 1)', 'Upright T in V1–V2', 'Confirm with posterior leads V7–V9'],
  story: 'Posterior-wall STEMI seen as its mirror image on the anterior leads',
  description:
    'The standard leads have no electrode over the posterior wall, so a posterior STEMI shows up as ' +
    'its mirror image in V1–V3: ST depression instead of elevation, a tall broad R instead of a Q, and ' +
    'an upright T. Flip the ECG over and it reads like a STEMI. It often accompanies an inferior MI.',
  segmentNotes: [
    { segment: 'QRS', title: 'Tall R in V1–V2', detail: 'The mirror of the posterior Q wave — R/S > 1 in V1 is the clue.' },
    { segment: 'ST', title: 'ST depression V1–V3', detail: 'The mirror of posterior ST elevation. Posterior leads V7–V9 show the true STE.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'Tall, broad R in V1–V2 with horizontal ST depression and upright T (mirror of posterior STE)',
    ischemia: 'Posterior STEMI — confirm with posterior leads V7–V9',
  },
  clinical: 'ST depression + tall R in V1–V3 = posterior MI (a STEMI-equivalent), often with an inferior MI. Get posterior leads (V7–V9) to confirm; activate the cath lab.',
  buildStrip: () => repeatBeat(posteriorBeat),
}
