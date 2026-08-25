# Real-recording anchors for the modeled lethal cards — status & path

_2026-08. The honest ledger of which lethal cards still ride on modeled strips,
what was actually tried, and the one legitimate path to real acute anchors._

## What was tried (and measured, not assumed)

| Card | PTB-XL result |
|---|---|
| `leftmain` | **SOLVED.** Swept 24 multi-`INJ*`/`ISC*` candidates and measured the actual signature (aVR ST + count of depressed leads) on raw signals. ecg 4670 (aVR +0.09 mV, STD in 8 leads) ships as primary; 2054 as extra. Candidates whose labels suggested the pattern but whose aVR measured flat were **rejected** — a mislabeled real strip is worse than an honest model. |
| `svt-avnrt` | **SOLVED.** Pure `PSVT:100` human-validated records exist; 2051 (156/min, P-less, rigidly regular) primary, 3134 extra. |
| `wpw` | **SOLVED** (previous pass): 5303 + 2145. |
| `sgarbossa` | **Not available.** All 14 `CLBBB` ∩ injury/ischemia records were fetched and measured for concordant ST (≥0.1 mV with the QRS) — none passes the criteria. The co-labels appear to describe the block's own discordant repolarization. Modeled strip stays, with its honest note. |
| `vt-mono`, `brugada`, `dewinter` | **Not in PTB-XL.** No sustained-VT, Brugada, or de Winter SCP codes exist in the dataset (10-second resting-clinic ECGs). Modeled strips stay, honestly labeled. |
| `omi-inferior` (acute STE) | Confirmed again: reachable `INJIN/INJIL` candidates measure subacute (STD + inverted T), not acute STE — resting-clinic bias. |

## MIMIC-IV-ECG: the real fix, and why it is not in this repo

MIMIC-IV-ECG (~800k diagnostic ECGs from an ED/inpatient population) is the
right source for acute STEMI evolution, VT, and peri-arrest strips — exactly
the acute bias PTB-XL lacks.

**But it is credentialed-access data**: PhysioNet Credentialed Health Data
License + Data Use Agreement + CITI training, with an explicit no-sharing
clause, and **derivatives inherit the license**. Shipping its waveforms in
this public repo/app would violate the DUA. PTB-XL (CC BY 4.0) remains the
only redistributable source, which is why the app uses it exclusively.

### If the owner personally credentials on PhysioNet

1. Complete CITI "Data or Specimens Only Research" + sign the DUA on
   physionet.org (mimic-iv-ecg project page).
2. Download candidate records locally (machine-readable statements exist via
   the linked `MIMIC-IV-ECG-Ext-ICD` label set — filter ICD I21.x acute MI,
   I47.2 VT).
3. Run them through the SAME pipeline (`tools/recordings/convert.mjs` accepts
   any WFDB record; add a spec with `targetTier: "recorded"` and a
   `sourceRecord` naming MIMIC).
4. **Keep the outputs out of git and out of any public deploy** — private,
   local use by the credentialed person only. The provenance badge must name
   MIMIC-IV and the app must not be redistributed with those assets included.

Until then: the modeled lethal strips stay, the badges stay honest, and the
teaching leans on the real recordings wherever one truthfully exists
(15 of 24 primaries recorded/derived). The 9 modeled primaries: `vt-mono`,
`sgarbossa`, `dewinter`, `brugada`, `omi-inferior` (acute-anchor gaps above),
plus `avb-2` (no sinus Mobitz II in PTB-XL), `hyperk`, `hypok`, and `tca`
(morphology-trajectory teaching the dataset cannot supply).
