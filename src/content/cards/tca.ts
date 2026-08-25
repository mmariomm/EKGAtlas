/** Transcribed from docs/rebuild/04-CARDS.md §17 — do not edit wording here. */
import { Card } from '../schema'

export const tca: Card = {
  id: 'tca',
  name: 'Na-channel blocker toxicity (TCA)',
  aliases: ['TCA', 'tricyclic', 'overdose', 'poisoning', 'sodium channel', 'aVR', 'tox'],
  category: 'Systemic window',
  lethal: true,
  tagline: 'Treating the rhythm while the poison wins — aVR’s terminal R is the tell.',
  seeIt: {
    traceId: 'tca-model',
    commit: {
      prompt: 'Your read?',
      options: [
        { label: 'Na-channel blocker toxicity', correct: true, tempts: 'Yes — sinus tach, whole-QRS widening, and the terminal R climbing in aVR. Bicarb is the antiarrhythmic.' },
        { label: 'VT', tempts: 'Wide and fast — but this is sinus tach with giant terminal aVR forces. Class I antiarrhythmics here would be gasoline.' },
        { label: 'Hyperkalemia', tempts: 'Both widen the QRS. HyperK flattens Ps and tents Ts; TCA races (anticholinergic tach) and throws the terminal vector at aVR.' },
        { label: 'Plain sinus tachycardia', tempts: 'The rate is sinus-ish — the WIDTH and aVR’s terminal R are the poison’s signature.' },
      ],
    },
  },
  why: [
    'TCAs block fast sodium channels — every cell’s phase-0 upstroke slows, so the QRS stretches.',
    'The right side of the septum and base suffer most — the terminal vector swings toward aVR.',
    'Wide QRS + terminal R in aVR + tachycardia in an overdose = the poisoned trace, not a primary arrhythmia.',
  ],
  whyDrawer: [
    { cause: 'Tricyclics block fast Na⁺ channels use-dependently', effect: 'Phase-0 upstrokes slow in every myocyte — the whole QRS stretches' },
    { cause: 'The right septum and basal conduction suffer the slowing most', effect: 'The last forces of each beat swing right-superior-anterior: a terminal R grows in aVR' },
    { cause: 'Anticholinergic and sympathomimetic effects race the sinus node', effect: 'Sinus tachycardia under the widening — unlike hyperK’s bradycardic slide' },
    { cause: 'Potassium-channel blockade stretches repolarization too', effect: 'A long QT rides along — torsades is on the menu after the QRS is controlled' },
  ],
  pills: [
    { kind: 'pearl', text: 'Numbers with teeth: QRS >100 ms → seizure risk; >160 ms → ventricular arrhythmia risk. aVR terminal R ≥3 mm is the classic flag.' },
    { kind: 'trap', text: 'Giving a class IA/IC antiarrhythmic (more Na-blockade) for the “VT” — the exact wrong move. Bicarb IS the antiarrhythmic here.' },
    { kind: 'night-eye', text: 'Altered + tachy + wide QRS + big pupils/dry skin = think TCA before the tox screen returns.' },
  ],
  suspectConfirm: [
    { text: 'Suspect from context (ingestion, altered mental state, anticholinergic signs); confirm clinically — treat before levels.', cites: ['AHA-TOX-2023'] },
    { text: 'Track the QRS width serially — it is the drug level you can see.', cites: ['BOEHNERT-1985'] },
  ],
  guidelineMoves: [
    { text: 'Sodium bicarbonate 1–2 mEq/kg boluses, repeat to narrow the QRS — ceiling pH 7.50–7.55, and recheck K⁺ each round: alkalinization drops it, and the long QT that rides along turns hypoK into torsades fuel.', cites: ['AHA-TOX-2023'] },
    { text: 'Refractory arrhythmia after bicarb → lidocaine (IB) is the accepted second line; refractory arrest → lipid emulsion per protocol.', cites: ['AHA-TOX-2023'] },
  ],
  avoid: { text: 'No class IA/IC antiarrhythmics or amiodarone (more Na⁺/K⁺ blockade for a Na-blocked heart) — and no phenytoin for the seizures. Benzodiazepines and bicarbonate are the treatment.', cites: ['AHA-TOX-2023'] },
  rnMoves: [
    { text: 'Overdose + altered + tachycardic: get the 12-lead early — QRS >100 ms predicts seizures; a widening trend is deterioration, escalate.', cites: ['AHA-TOX-2023', 'BOEHNERT-1985'] },
    { text: 'Anticipate sodium-bicarbonate boluses with serial VBG/K⁺ alongside, benzos for seizures, airway readiness — and question any procainamide or flecainide order for the ’VT’ (more Na-blockade).', cites: ['AHA-TOX-2023'] },
    { text: 'Serial ECGs are the drug level you can see — put them on a schedule and chart the QRS width each time.', cites: ['BOEHNERT-1985'] },
  ],
  mechanism: {
    kind: 'authored',
    authoredId: 'tca',
    authoredReason: 'Drug-level channel kinetics are modeled as their morphological consequence.',
    mustShow: [
      'every myocyte’s upstroke slowed (whole-QRS stretch)',
      'the terminal vector swinging right-superior (aVR’s R)',
      'the tachycardic anticholinergic drive',
    ],
    primaryLead: 'aVR',
  },
  assertions: [
    { on: 'model', check: 'qrsMs', min: 120, max: 190 },
    { on: 'model', check: 'rateBpm', min: 100, max: 130 },
    { on: 'model', check: 'custom', name: 'terminalRaVR', note: 'peak of the last 40 ms of the QRS in aVR ≥ 0.3 mV (≥3 mm)' },
    { on: 'model', check: 'qtcMs', min: 460, max: 620 },
    { on: 'model', check: 'prMs', min: 100, max: 240 },
  ],
  methodStep: 'intervals',
  guidelineVerifiedAt: '2026-08',
  review: { status: 'draft' },
}
