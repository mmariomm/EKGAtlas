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
    'The injury current points inward — toward the starved inner layer and the LV cavity — from every wall at once.',
    'The survivor points at the right shoulder: ST depression in ~everything, elevation only in aVR (±V1).',
  ],
  whyDrawer: [
    { cause: 'Global supply–demand mismatch starves the inner layer of the whole LV', effect: 'Circumferential subendocardial injury — no single culprit wall' },
    { cause: 'Injury vectors from opposite walls cancel each other', effect: 'The surviving net vector points into the LV cavity — and aVR is the one lead that looks into it' },
    { cause: 'aVR (and often V1) alone face that survivor vector', effect: 'STE in aVR with widespread ST depression — the inverse of a territorial OMI' },
    { cause: 'The cause splits supply vs demand', effect: 'Left main/3-vessel — or anemia, GI bleed, hypoxia, sepsis, tachycardia, aortic dissection. Before the antithrombotics go in, ask which of those you are about to make worse' },
  ],
  pills: [
    { kind: 'pearl', text: 'The shape: ST depression ≥1 mm in six or more leads (deepest I, II, V4–V6) with STE in aVR — ≥0.5 mm counts; ≥1 mm is the specific tier (spec ~93%, NPV ~98% for LM/3-vessel). Depth and lead count track the anatomy.' },
    { kind: 'trap', text: 'This is NOT a "posterior-style" mirror to flip, and not a lead problem — and calling it "nonspecific ST changes" on a sick patient is the miss that fills the morgue quietly.' },
    { kind: 'trap', text: 'The mirror error: this is NOT a STEMI equivalent and not a reflex cath activation — only ~10% have an acute thrombotic occlusion (~60% severe CAD). Urgent, not emergent, unless ischemia is refractory or the patient unstable.' },
    { kind: 'lookalike', text: 'If the depression is precordial-dominant, UPSLOPING at the J point, and climbs into tall symmetric Ts — that is de Winter, an occlusion NOW. Don’t route it through the supply-vs-demand detour.', linkCardId: 'dewinter' },
  ],
  suspectConfirm: [
    { text: 'Ongoing ischemic symptoms + this pattern → treat as high-risk ACS: serial ECGs, troponin, and an early invasive conversation.', cites: ['AHA-ACS-2025'] },
    { text: 'Hunt demand causes and mimics BEFORE antithrombotics: hemoglobin, oxygenation, rate, pressure — and a dissection thought in pain out of proportion or a pulse deficit. They change the destination and what is safe to give.', cites: ['AHA-ACS-2025'] },
  ],
  guidelineMoves: [
    { text: 'Refractory ischemia or hemodynamic/electrical instability → immediate invasive strategy (<2 h). Otherwise high-risk NSTE-ACS: angiography within ~24 h. LM/3-vessel disease often means the surgical team, not just a stent.', cites: ['AHA-ACS-2025'] },
    { text: 'Demand-driven (bleed, hypoxia, tachyarrhythmia) → treat the driver; the ECG follows it.', cites: ['AHA-ACS-2025'] },
  ],
  avoid: { text: 'No reflex STEMI activation on this pattern alone — and no antithrombotics before the dissection-and-bleeding thought: heparin into a dissection or an active GI bleed is the harm the mimics are hiding.', cites: ['AHA-ACS-2025'] },
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
