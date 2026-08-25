/**
 * The guideline registry — every clinical citation the cards use, by citeKey.
 * Transcribed from docs/rebuild/03-CONTENT-SYSTEM.md §4. verifiedAt is bumped
 * ONLY by a human re-checking currency; the validator warns at 18 months and
 * fails the release gate at 24.
 */
import { GuidelineEntry } from './schema'

export const GUIDELINES: GuidelineEntry[] = [
  { citeKey: 'AHA-ACS-2025', title: 'ACC/AHA Acute Coronary Syndromes Guideline', org: 'ACC/AHA', year: 2025, scope: 'STEMI/OMI reperfusion, ischemia workup', verifiedAt: '2026-08' },
  { citeKey: 'AHA-AF-2023', title: 'ACC/AHA/ACCP/HRS Atrial Fibrillation Guideline', org: 'ACC/AHA', year: 2023, scope: 'AF/flutter dx & rate/rhythm/anticoagulation principles', verifiedAt: '2026-08' },
  { citeKey: 'AHA-BRADY-2018', title: 'ACC/AHA/HRS Bradycardia & Conduction Delay Guideline', org: 'ACC/AHA', year: 2018, scope: 'AV blocks, pacing indications', verifiedAt: '2026-08' },
  { citeKey: 'AHA-VA-2017', title: 'AHA/ACC/HRS Ventricular Arrhythmias & SCD Guideline', org: 'AHA/ACC', year: 2017, scope: 'VT management, WCT principles', verifiedAt: '2026-08' },
  { citeKey: 'ESC-VA-2022', title: 'ESC Ventricular Arrhythmias & SCD Guideline', org: 'ESC', year: 2022, scope: 'VT/Brugada diagnostic criteria & management', verifiedAt: '2026-08' },
  { citeKey: 'ESC-SVT-2019', title: 'ESC Supraventricular Tachycardia Guideline', org: 'ESC', year: 2019, scope: 'SVT/WPW management', verifiedAt: '2026-08' },
  { citeKey: 'AHA-PE-2026', title: 'AHA/ACC Acute Pulmonary Embolism Guideline', org: 'AHA/ACC', year: 2026, scope: 'PE suspicion & risk stratification (RV strain signs incl. new RBBB)', url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000001415', verifiedAt: '2026-08' },
  { citeKey: 'AHA-ACLS-2020', title: 'AHA ACLS Guidelines (with 2023 focused update)', org: 'AHA', year: 2020, scope: 'arrest & peri-arrest algorithms', verifiedAt: '2026-08' },
  { citeKey: 'AHA-TOX-2023', title: 'AHA Statement: Cardiac Arrest & Life-Threatening Toxicity from Poisoning', org: 'AHA', year: 2023, scope: 'Na-channel blocker (TCA) & poisoning moves', verifiedAt: '2026-08' },
  { citeKey: 'UKKA-K-2023', title: 'UK Kidney Association Hyperkalaemia Guideline', org: 'UKKA', year: 2023, scope: 'hyperkalaemia treatment sequence', verifiedAt: '2026-08' },
  { citeKey: 'AHA-QT-2020', title: 'AHA Statement: Drug-Induced Arrhythmias', org: 'AHA', year: 2020, scope: 'QT-prolonging drugs, torsades prevention/management', verifiedAt: '2026-08' },
  { citeKey: 'RAUTAHARJU-2009', title: 'AHA/ACCF/HRS ECG Standardization: Intervals (Part IV)', org: 'AHA/ACCF/HRS', year: 2009, scope: 'normal ECG interval ranges (PR, QRS, QTc)', verifiedAt: '2026-08' },
  { citeKey: 'DODD-VPR-2021', title: 'Modified Sgarbossa criteria in ventricular paced rhythm (Dodd et al.)', org: 'Ann Emerg Med', year: 2021, scope: 'OMI criteria validated in paced rhythms', verifiedAt: '2026-08' },
  { citeKey: 'LEVINE-DIG-2011', title: 'IV calcium in digoxin toxicity: no dysrhythmia/mortality signal (Levine et al.)', org: 'J Emerg Med', year: 2011, scope: 'calcium is not contraindicated in digoxin toxicity ("stone heart" myth)', verifiedAt: '2026-08' },
  { citeKey: 'SGARBOSSA-1996', title: 'Sgarbossa criteria (GUSTO-1 substudy)', org: 'NEJM', year: 1996, scope: 'STEMI-in-LBBB criteria', verifiedAt: '2026-08' },
  { citeKey: 'SMITH-MSC-2012', title: 'Smith-modified Sgarbossa (ST/S ratio)', org: 'Ann Emerg Med', year: 2012, scope: 'modified Sgarbossa criteria (ST/S ratio) in LBBB', verifiedAt: '2026-08' },
  { citeKey: 'DEWINTER-2008', title: 'de Winter pattern description', org: 'NEJM (letter)', year: 2008, scope: 'LAD-occlusion equivalent', verifiedAt: '2026-08' },
  { citeKey: 'DEZWAAN-1982', title: 'Wellens / de Zwaan pattern description', org: 'Am Heart J', year: 1982, scope: 'critical-LAD warning pattern', verifiedAt: '2026-08' },
  { citeKey: 'BOEHNERT-1985', title: 'TCA overdose: QRS duration & risk', org: 'NEJM', year: 1985, scope: 'QRS >100 ms seizure / >160 ms ventricular arrhythmia risk', verifiedAt: '2026-08' },
  { citeKey: 'LIEBELT-1995', title: 'Terminal R in aVR in TCA overdose', org: 'Ann Emerg Med', year: 1995, scope: 'aVR R ≥3 mm criterion', verifiedAt: '2026-08' },
  { citeKey: 'MONTAGUE-2008', title: 'ECG sensitivity in hyperkalemia', org: 'CJASN', year: 2008, scope: 'the ECG cannot rule out hyperkalemia', verifiedAt: '2026-08' },
  { citeKey: 'BATCHVAROV-2007', title: 'Electrode misplacement: incidence & effects (review)', org: 'Europace', year: 2007, scope: 'misplacement facts & mimics', verifiedAt: '2026-08' },
  { citeKey: 'SHANGHAI-2016', title: 'Brugada diagnostic score (Shanghai consensus)', org: 'J Arrhythm / HRS', year: 2016, scope: 'Brugada type 1 diagnostic context', verifiedAt: '2026-08' },
  { citeKey: 'PTBXL-2020', title: 'PTB-XL dataset (Wagner et al., Scientific Data)', org: 'PhysioNet', year: 2020, scope: 'recording source attribution', verifiedAt: '2026-08' },
]

export const GUIDELINE_BY_KEY: Record<string, GuidelineEntry> = Object.fromEntries(
  GUIDELINES.map((g) => [g.citeKey, g]),
)
