/**
 * The reading method — the portable system behind the catalog. Every card is
 * an exemplar of ONE step; the strip on each card shows where that pattern
 * lives in the sequence, so 21 exemplars teach one transferable procedure
 * instead of 21 memorized shapes.
 */
export interface MethodStep {
  id: string
  short: string
  ask: string
  how: string
}

export const METHOD: MethodStep[] = [
  { id: 'rate', short: 'Rate', ask: 'Too fast, too slow, or fine?', how: 'Grid ruler: 300-150-100-75-60 per large box. <60 or >100 needs an explanation.' },
  { id: 'rhythm', short: 'Rhythm', ask: 'Regular? Is there a P for every QRS?', how: 'March the R waves. Then march the Ps. Irregularly irregular with no P = AF.' },
  { id: 'axis', short: 'Axis', ask: 'Where is the vector pointing?', how: 'Leads I and aVF: both up = normal. Extreme deviation is a finding, not trivia.' },
  { id: 'intervals', short: 'Intervals', ask: 'PR, QRS, QT — in range?', how: 'PR 120–200 · QRS <120 · QTc <460. Three numbers rule out half the catalog.' },
  { id: 'morphology', short: 'Morphology', ask: 'Is the QRS shaped wrong?', how: 'Wide? Decide bundle vs ventricular vs metabolic. Q waves, delta, pre-excitation, voltage.' },
  { id: 'st-t', short: 'ST / T', ask: 'Injury, ischemia, or expected discordance?', how: 'Judge every ST against the QRS beneath it, by territory, and hunt reciprocal change.' },
  { id: 'context', short: 'In context', ask: 'Does this fit the patient in front of me?', how: 'Compare with a prior ECG, repeat it serially, and let the story break the tie.' },
]

export const METHOD_BY_ID: Record<string, MethodStep> = Object.fromEntries(METHOD.map((s) => [s.id, s]))
export type MethodStepId = (typeof METHOD)[number]['id']
