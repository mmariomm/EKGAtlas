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
  tagline: 'LBBB rewrites the ST rules — ischemia hides until the ST breaks the rule of appropriate discordance.',
  criteria: [
    'Concordant ST elevation ≥1 mm (in a QRS-positive lead) — 5 pts',
    'Concordant ST depression ≥1 mm in V1–V3 — 3 pts',
    'Excessively discordant STE ≥5 mm (in a QRS-negative lead) — 2 pts',
    '≥3 points = specific for STEMI',
    'Modified (Smith): discordant STE/S ratio ≤ −0.25',
  ],
  story: 'LBBB makes ST/T discordant by default — a STEMI shows when the ST disobeys that rule',
  description:
    'LBBB depolarizes the LV abnormally, so repolarization is abnormal too: the ST and T point ' +
    'OPPOSITE the main QRS deflection, in proportion to it ("appropriate discordance"). That expected ' +
    'discordance is exactly what hides ischemia. Sgarbossa criteria find the STEMI buried inside by ' +
    'catching ST shifts the LBBB cannot explain: ST that goes the SAME way as the QRS (concordant), or ' +
    'discordance so large it breaks the proportion. New LBBB by itself is NOT a STEMI — you read it ' +
    'against the rule of appropriate discordance.',
  segmentNotes: [
    { segment: 'QRS', title: 'LBBB chassis', detail: 'Broad QRS with dominant leftward forces (deep S in V1–V3, tall R in I/V5–6). This is the baseline you measure the ST against.' },
    { segment: 'ST', title: 'Expected (appropriate) discordance', detail: 'Normally in LBBB the ST deviates OPPOSITE the QRS by <~25% of its amplitude. Anything inside that is just the LBBB, not ischemia.' },
    { segment: 'ST', title: 'Concordant STE = the flag', detail: 'ST elevated in a lead whose QRS is already positive (here, with the lateral R). LBBB cannot do that — it means a transmural injury current.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'LBBB pattern, but the ST in the lateral leads is CONCORDANT with (same direction as) the QRS',
    ischemia: 'Concordant ST elevation = acute STEMI within LBBB (Sgarbossa-positive)',
  },
  mechanism: [
    { cause: 'The left bundle is blocked; the LV is activated late and cell-to-cell from the right', effect: 'A wide QRS with dominant leftward forces — the LBBB template' },
    { cause: 'Abnormal depolarization forces abnormal repolarization', effect: 'ST/T point OPPOSITE the QRS, proportionally — "appropriate discordance" that masks ischemia' },
    { cause: 'A transmural STEMI adds its own injury-current ST vector on top of that', effect: 'When the injury vector is large, or points the wrong way, it overrides the expected discordance' },
    { cause: 'The injury vector now points the SAME way as the QRS', effect: 'Concordant ST elevation (or concordant ST↓ in V1–V3) — the Sgarbossa-positive STEMI' },
  ],
  clinical: 'LBBB + concordant ST elevation (or concordant ST↓ V1–V3, or excessively discordant STE) = Sgarbossa-positive → treat as STEMI: activate the cath lab.',
  pearls: [
    'LBBB doesn’t excuse you from reading the ST segments — it changes the rules. In every lead, compare ST direction and size to the QRS.',
    'Most specific sign: CONCORDANT ST elevation — the QRS points up and the ST points up in the same lead.',
    'Smith-modified criterion beats the old 5 mm rule for sensitivity: discordant STE ≥25% of the depth of the preceding S wave (ST/S ≤ −0.25).',
    '“New LBBB = cath lab” is retired. Use Sgarbossa plus the clinical picture; an unstable patient with a convincing story still gets the lab.',
    'The same logic applies to ventricular-paced rhythms — modified Sgarbossa is validated there too.',
  ],
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
  tagline: 'Upsloping ST depression rising into tall T waves in the precordials — an LAD occlusion that forgot to elevate.',
  criteria: [
    'Upsloping ST depression ≥1 mm at the J point in V1–V6',
    'Tall, symmetric (“hyperacute”) precordial T waves',
    'Often ~0.5–1 mm ST elevation in aVR',
    'No classic ST elevation in the precordials',
    'Usually a narrow QRS, with ongoing chest pain',
  ],
  story: 'Proximal LAD occluded NOW — but the precordials show depression-into-tall-T instead of STE',
  description:
    'A STEMI-equivalent of acute proximal LAD occlusion that never gives you the ST elevation you are ' +
    'waiting for. Instead the precordial leads show upsloping ST depression at the J point that climbs ' +
    'into tall, broad, symmetric T waves, usually with a little ST elevation in aVR. It is thought to be ' +
    'a “stuck” hyperacute phase. The artery is occluded right now — treat it as a STEMI rather than ' +
    'waiting for the elevation to appear.',
  segmentNotes: [
    { segment: 'ST', title: 'Upsloping ST↓ at the J point', detail: 'Subendocardial injury from the occlusion depresses the J point 1–3 mm across V1–V6 — but it slopes UP into the T.' },
    { segment: 'T', title: 'Tall, symmetric (hyperacute) T', detail: 'Acute transmural ischemia towers the T waves up out of the depressed J point — this is the real tell.' },
    { segment: 'ST', title: 'aVR ST elevation', detail: 'Slight reciprocal ST elevation in aVR points to the proximal/basal LAD territory.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'Upsloping J-point ST depression rising into tall, symmetric T waves in V1–V6 (± slight STE in aVR)',
    ischemia: 'LAD-occlusion equivalent — treat as STEMI',
  },
  mechanism: [
    { cause: 'Acute proximal LAD occlusion jeopardizes the whole anterior wall', effect: 'A large anterior territory becomes acutely ischemic all at once' },
    { cause: 'Subendocardial injury current predominates (rather than subepicardial)', effect: 'J-point ST DEPRESSION across the precordial leads' },
    { cause: 'Acute transmural ischemia distorts repolarization', effect: 'Tall, broad, symmetric “hyperacute” T waves rising straight out of the depressed ST' },
    { cause: 'Basal / reciprocal forces from the proximal LAD', effect: 'Slight ST elevation in aVR' },
  ],
  clinical: 'de Winter = acute proximal LAD occlusion equivalent → cath lab, even without classic ST elevation. Easy to miss, high stakes.',
  pearls: [
    'The trap: precordial ST depression gets called “subendocardial ischemia / NSTEMI, treat medically.” de Winter means the artery is occluded NOW — activate the cath lab.',
    'Recognition = ST depression that SLOPES UP into giant, symmetric T waves, in a patient with ongoing chest pain.',
    'It is usually static — it does not have to “evolve” into ST elevation before you act.',
    'Tell it from hyperkalemia: de Winter T’s are broad and sit on upsloping ST depression with an LAD story; hyperK T’s are narrow/peaked with flat P waves in a renal context.',
    'Think of it as “the anterior STEMI that forgot to elevate.”',
  ],
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
  tagline: 'Deep symmetric (or biphasic) T inversions in V2–V3 in a pain-FREE patient — a critical LAD waiting to close.',
  criteria: [
    'Deep symmetric T inversion (type B) OR biphasic T (type A) in V2–V3',
    'Preserved R waves, no precordial Q waves',
    'Little or no ST elevation (<1 mm)',
    'Recent angina, now resolved (recorded pain-free)',
    'Normal or only mildly raised troponin',
  ],
  story: 'A reperfused critical proximal LAD — the warning before the anterior MI',
  description:
    'Wellens is a REPERFUSION pattern: a critical proximal LAD lesion transiently occluded and then ' +
    'opened, so the patient is now pain-free with a near-normal-looking ECG — except for deep, ' +
    'symmetric T-wave inversions (type B) or biphasic T waves (type A) in V2–V3. The R waves are ' +
    'preserved, meaning the muscle is still salvageable. The danger is being reassured by the calm ' +
    'tracing and stress-testing the patient straight into an anterior MI.',
  segmentNotes: [
    { segment: 'T', title: 'Wellens T waves (V2–V3)', detail: 'Deep, symmetric inversions (type B) or biphasic up-then-down T (type A) — repolarization change of the recently-reperfused anterior wall.' },
    { segment: 'QRS', title: 'Preserved R waves', detail: 'No Q waves, normal R-wave progression — depolarization is intact, so the muscle has not infarcted yet. That is the window.' },
    { segment: 'ST', title: 'Near-isoelectric ST', detail: 'Minimal ST shift is what makes the tracing look falsely reassuring between episodes.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'Deep symmetric T inversions (type B) or biphasic T (type A) in V2–V3; preserved R waves; isoelectric ST',
    ischemia: 'Critical proximal LAD stenosis — impending anterior MI',
  },
  mechanism: [
    { cause: 'A critical proximal LAD lesion transiently occludes', effect: 'Anterior-wall ischemia — usually the episode of chest pain' },
    { cause: 'The lesion spontaneously reperfuses and the pain resolves', effect: 'Depolarization recovers (R waves preserved) but repolarization stays disturbed' },
    { cause: 'Post-ischemic repolarization delay in the reperfused anterior wall', effect: 'Deep, symmetric (or biphasic) T inversions in V2–V3 — recorded while pain-free' },
    { cause: 'The lesion re-occludes', effect: 'The T waves “pseudonormalize” (go upright) and pain returns — that is deterioration, an emergency' },
  ],
  clinical: 'Wellens (deep/biphasic T in V2–V3 when pain-free, troponin near-normal) = critical LAD stenosis. Admit; do NOT stress-test; angiography. A near-normal ECG is not reassurance.',
  pearls: [
    'The trap: a comfortable patient with an almost-normal ECG → discharge or stress test → massive anterior MI. Wellens = admit, anticoagulate, angiography. Do NOT stress test.',
    'Pseudonormalization — the inverted T’s become upright DURING chest pain — is re-occlusion, not improvement.',
    'Preserved R waves are the point: if Q waves have formed or R waves are lost, the infarct already happened and you are late.',
    'Biphasic (type A) often precedes the deep symmetric inversions (type B).',
    'A near-normal ECG in a recent-chest-pain patient is not reassurance — look hard at V2–V3.',
  ],
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
  tagline: 'Tall R + ST depression in V1–V3 — read the back of the heart in a mirror.',
  criteria: [
    'Horizontal ST depression maximal in V1–V3 (not V4–V6)',
    'Tall, broad R in V1–V2 with R/S > 1',
    'Upright T waves in V1–V2',
    'Confirm with posterior leads V7–V9 (true STE ≥0.5 mm)',
    'Often accompanies an inferior or lateral MI',
  ],
  story: 'A posterior-wall STEMI shows up as its mirror image on the anterior leads',
  description:
    'There is no electrode over the posterior wall, so an inferobasal (posterior) STEMI is seen as its ' +
    'MIRROR IMAGE in V1–V3: ST depression where there should be elevation, a tall broad R where there ' +
    'should be a Q, and an upright T. Flip the tracing upside down and it reads like a textbook STEMI. ' +
    'It usually rides along with an inferior or lateral MI (LCx or RCA territory).',
  segmentNotes: [
    { segment: 'ST', title: 'Horizontal ST depression V1–V3', detail: 'The mirror of posterior ST ELEVATION. Maximal in V1–V3 (not the lateral leads) is the clue it is posterior, not anterior subendocardial.' },
    { segment: 'QRS', title: 'Tall, broad R in V1–V2', detail: 'The mirror of the posterior Q wave. R/S > 1 in V1 with a NORMAL-width QRS points to posterior infarct.' },
    { segment: 'T', title: 'Upright T in V1–V2', detail: 'The mirror of posterior T-wave inversion — completes the “flip it over” picture.' },
  ],
  read: {
    rhythm: 'Sinus',
    morphology: 'Tall, broad R in V1–V2 (R/S > 1) + horizontal ST depression + upright T (mirror of posterior STE)',
    ischemia: 'Posterior STEMI — confirm with posterior leads V7–V9',
  },
  mechanism: [
    { cause: 'Occlusion (usually LCx, sometimes RCA/PDA) infarcts the posterior (inferobasal) LV wall', effect: 'A transmural injury current that points POSTERIORLY, away from the chest wall' },
    { cause: 'V1–V3 sit on the front of the chest, directly opposite that wall', effect: 'They record the posterior injury upside-down — ST DEPRESSION instead of elevation' },
    { cause: 'The developing posterior Q wave is also seen from the opposite side', effect: 'It appears as a tall, broad R wave in V1–V2 (R/S > 1)' },
    { cause: 'Posterior T-wave inversion viewed from the front', effect: 'Shows as an upright T in V1–V2 — flip the ECG and it is a classic STEMI' },
  ],
  clinical: 'ST depression + tall R in V1–V3 = posterior MI (a STEMI-equivalent), often with an inferior MI. Get posterior leads (V7–V9) to confirm; activate the cath lab.',
  pearls: [
    'The trap: anterior ST depression read as “anterior ischemia / NSTEMI.” ST depression MAXIMAL in V1–V3 plus a tall R in V1 = posterior STEMI = cath lab.',
    'Get posterior leads (V7–V9): even 0.5 mm of ST elevation there confirms it.',
    'Tall R in V1 differential: posterior MI (ST↓, normal-width QRS, inferior/lateral changes), RBBB (rSR′, wide QRS), RVH (right-axis), WPW (delta / short PR).',
    'Rarely isolated — always scan the inferior and lateral leads, and check V4R for RV involvement if the inferior wall is involved.',
    'Mantra: “ST depression in V1–V3 is a posterior STEMI until proven otherwise.”',
  ],
  buildStrip: () => repeatBeat(posteriorBeat),
}
