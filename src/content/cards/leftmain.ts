/** Authored 2026-08 (post-audit addition: the diffuse-subendocardial pattern). */
import { Card } from '../schema'

export const leftmain: Card = {
  id: 'leftmain',
  name: 'Diffuse ST depression + aVR ↑',
  aliases: ['left main', 'aVR', 'diffuse ST depression', 'subendocardial', 'three-vessel', 'LMCA'],
  category: 'Occlusion & ischemia',
  lethal: true,
  tagline: 'Every wall complains at once — the one pattern where aVR is the loudest lead.',
  seeIt: {
    traceId: 'ptbxl-4670-leftmain',
    extraTraceIds: ['ptbxl-2054-leftmain'],
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Diffuse subendocardial ischemia (LM/3-vessel pattern)', correct: true, tempts: 'Yes — ST depression across ≥6 leads with the only elevation in aVR: the whole subendocardium is starving.' },
        { label: 'Posterior occlusion MI', tempts: 'Posterior STD is MAXIMAL in V1–V3 with tall Rs; here the depression is everywhere and deepest laterally, with aVR up.' },
        { label: 'Rate-related ST depression (SVT)', tempts: 'Demand depression during tachycardia looks identical — but check the rate: this is not fast. At speed, reassess AFTER rate control.' },
        { label: 'Digoxin effect', tempts: 'Dig scoops the ST at therapeutic doses — a sagging curve, modest, with a short QT, and no aVR elevation.' },
      ],
    },
  },
  why: [
    'The whole LV inner layer runs short — supply (left main/3-vessel) or demand (bleed, hypoxia, tachycardia).',
    'Injury current points from inner wall outward, everywhere at once — the vectors cancel except one direction.',
    'The survivor points at the right shoulder: ST depression in ~everything, elevation only in aVR (±V1).',
  ],
  whyDrawer: [
    { cause: 'Global supply–demand mismatch starves the inner layer of the whole LV', effect: 'Circumferential subendocardial injury — no single culprit wall' },
    { cause: 'Injury vectors from opposite walls cancel each other', effect: 'What remains is the net vector aimed away from the LV cavity — toward aVR' },
    { cause: 'aVR (and often V1) alone face that survivor vector', effect: 'STE in aVR with widespread ST depression — the inverse of a territorial OMI' },
    { cause: 'The cause splits supply vs demand', effect: 'Left main/3-vessel disease — or anemia, GI bleed, hypoxia, sustained tachycardia. The treatment differs completely' },
  ],
  pills: [
    { kind: 'pearl', text: 'The shape: ST depression ≥1 mm in six or more leads (deepest I, II, V4–V6) + STE in aVR. The more leads and the deeper, the worse the anatomy.' },
    { kind: 'trap', text: 'This is NOT a "posterior-style" mirror to flip, and not a lead problem — and calling it "nonspecific ST changes" on a sick patient is the miss that fills the morgue quietly.' },
    { kind: 'night-eye', text: 'First question at the bedside: supply or demand? Check the hemoglobin, the sat, the rate, the pressure. Fix demand (bleeding, hypoxia, SVT) and re-record before labeling the coronaries.' },
    { kind: 'lookalike', text: 'During any fast SVT the same pattern appears from demand alone — reassess after rate control, not during.', linkCardId: 'svt-avnrt' },
  ],
  suspectConfirm: [
    { text: 'Ongoing ischemic symptoms + this pattern → treat as high-risk ACS: serial ECGs, troponin, and an early invasive conversation.', cites: ['AHA-ACS-2025'] },
    { text: 'Actively hunt the demand causes first: hemoglobin, oxygenation, rate, blood pressure — they change the destination entirely.', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Refractory ischemia with this pattern → urgent angiography; left main/3-vessel disease often means surgical-team involvement, not just a stent.', cites: ['AHA-ACS-2025'] },
    { text: 'Demand-driven (bleed, hypoxia, tachyarrhythmia) → treat the driver; the ECG follows it.', cites: ['AHA-ACS-2025'] },
  ],
  rnMoves: [
    { text: 'ST depression in "almost every lead" with aVR up = a sick-coronaries pattern: escalate now, even though no single lead screams STEMI.', cites: ['AHA-ACS-2025'] },
    { text: 'Bring the context to the call: latest hemoglobin, sats, rate, pressure — demand causes (bleeding, hypoxia, SVT) change everything.', cites: ['AHA-ACS-2025'] },
    { text: 'Anticipate: serial ECGs, troponin, possible urgent cath activation — keep the patient NPO and on the monitor.', cites: ['AHA-ACS-2025'] },
  ],
  mechanism: {
    kind: 'solver',
    state: {
      pace: 'SA',
      ischemic: ['LV_ant', 'LV_apex', 'LV_lat', 'LV_inf'],
      injuryDir: [-0.68, -0.6, 0.1],
      injuryMag: 0.42,
    },
    mustShow: [
      'the whole LV inner wall marked ischemic (no single territory)',
      'opposing injury vectors cancelling',
      'the net vector aimed at the right shoulder (aVR)',
      'depression everywhere, elevation only in aVR',
    ],
    primaryLead: 'V5',
  },
  assertions: [
    { on: 'model', check: 'stShift', lead: 'aVR', sign: '+', minMv: 0.05 },
    { on: 'model', check: 'stShift', lead: 'V5', sign: '-' },
    { on: 'model', check: 'stShift', lead: 'II', sign: '-' },
    { on: 'model', check: 'qrsMs', min: 60, max: 120 },
    { on: 'trace', check: 'stShift', lead: 'V5', sign: '-', minMv: 0.05 },
    { on: 'trace', check: 'stShift', lead: 'aVR', sign: '+' },
    { on: 'trace', check: 'rateBpm', min: 55, max: 110 },
  ],
  methodStep: 'st-t',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
