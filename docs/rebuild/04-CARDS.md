# 04 — The Cards: Authored Content (MVP)

This file IS the medical content. Transcribe into `src/content/cards/*.ts`
verbatim — ids, numbers, thresholds, citations. Never paraphrase a number. If
something here is missing or looks wrong, `TODO(REVIEW)` and move on (law 3).
Human sign-off (`review.status: 'signed'`) is required before any GUIDELINE MOVES
section renders — every card below starts life as `draft`.

**Conventions:** ✅ marks the option transcribed with `correct: true`. Every other
option's line after "tempts:" is its `tempts` string, verbatim.

**Measurement definitions used by assertions** (implement once in `test/` helpers):
- `J` (the J point) = the beat's annotated `qrsOff` (real traces) or the computed
  QRS end (model strips).
- `stShift(lead)` = mean amplitude over J+20…J+80 ms minus the PR-segment baseline
  (TP baseline if no P), in mV. 1 mm = 0.1 mV.
- `netQrs(lead)` = signed area over the QRS window (v1 helper).
- `tPolarity(lead)` = sign of the largest-|amplitude| deflection in the T window.
- `rsRatio(lead)` = R amplitude / S depth within QRS.
- `irregularRR.cv` = stdev(RR)/mean(RR) over the strip.
- `terminalRaVR` = max amplitude of the last 40 ms of the QRS in aVR, mV.
- Assertions run on the PRIMARY trace (`on:'trace'`) and/or the mechanism strip
  (`on:'model'`). Both must pass. Tolerances are stated per card.

**Priorities.** P0 = ship-blocking 16. P1 = completes the 20. S = stretch (build
only after M7 gate is otherwise green).

Category order in the library: Reference → Rate & rhythm → Conduction →
Occlusion & ischemia → Systemic window → High-risk patterns.

---

## Index

| # | id | Name | Pri | Lethal | Trace tier target → fallback |
|---|---|---|---|---|---|
| 1 | `nsr` | Normal sinus rhythm | P0 | – | recorded |
| 2 | `afib` | Atrial fibrillation | P0 | – | recorded |
| 3 | `aflutter` | Atrial flutter (2:1) | P0 | – | recorded |
| 4 | `vt-mono` | Monomorphic VT | P0 | ● | reconstructed → modeled |
| 5 | `paced-v` | Ventricular paced rhythm | P1 | – | recorded |
| 6 | `avb-3` | Complete heart block | P0 | ● | recorded → reconstructed |
| 7 | `avb-2` | Second-degree AV block (I vs II) | P1 | ● | recorded → modeled |
| 8 | `rbbb` | Right bundle branch block | P0 | – | recorded |
| 9 | `lbbb` | Left bundle branch block | P0 | – | recorded |
| 10 | `omi-anterior` | Anterior occlusion MI | P0 | ● | recorded → reconstructed |
| 11 | `omi-inferior` | Inferior occlusion MI (+RV) | P0 | ● | recorded → reconstructed |
| 12 | `omi-posterior` | Posterior occlusion MI | P0 | ● | recorded → reconstructed |
| 13 | `sgarbossa` | Occlusion MI in LBBB | P0 | ● | reconstructed → modeled |
| 14 | `wellens` | Wellens syndrome | P0 | ● | recorded → reconstructed |
| 15 | `dewinter` | de Winter pattern | P0 | ● | reconstructed → modeled |
| 16 | `hyperk` | Hyperkalemia | P0 | ● | reconstructed gallery + modeled morph |
| 17 | `tca` | Na-channel blocker toxicity (TCA) | P0 | ● | reconstructed → modeled |
| 18 | `longqt` | Drug-induced long QT & torsades | P0 | ● | recorded (QT) + reconstructed (TdP) |
| 19 | `lvh-strain` | LVH with strain (the mimic) | P1 | – | recorded |
| 20 | `brugada` | Brugada pattern (type 1) | P1 | ● | reconstructed → modeled |
| 21 | `wpw` | WPW / pre-excitation | S | ● | recorded |
| 22 | `svt-avnrt` | SVT (AVNRT) | S | – | recorded |

Lethal set (●) = named-reviewer sign-off before ANY public deploy that includes the
card (law 4 applies to all `guidelineMoves` regardless).

---

## 1. `nsr` — Normal sinus rhythm  [P0 · Reference]

**Tagline:** One vector, twelve shadows — the baseline every other card is measured against.

**SEE IT / commit** — prompt "Your read?"
- ✅ Normal sinus rhythm — *(correct)*
- Sinus tachycardia — tempts: "Eyeball rates deceive — count the boxes: 300/150/100/75/60."
- First-degree AV block — tempts: "The PR is generous but ≤200 ms. Measure, don't vibe."
- Atrial fibrillation — tempts: "A wandering baseline isn't fibrillation — the P waves march."

**Recording spec:** PTB-XL; include `scpAny: ["NORM"]`, `rhythmAny: ["SR"]`,
`validated_by_human`; rate 60–90; pristine baseline. Extras: 2 (different
patients — variance from beat one).

**Mechanism spec:** `kind: 'solver'`, `state: { pace: 'SA' }`, rr 800, 3 beats.
mustShow: SA fires → atria sweep (P) → AV pause (flat PR) → His/bundles race →
both ventricles depolarize endo→epi (narrow QRS) → repolarization wash (T).
primaryLead: `II`.

**WHY**
1. "Every deflection is the heart's electrical vector, projected onto that lead's line of sight."
2. "Narrow QRS = both ventricles fired together, via healthy bundles."
3. "The PR pause is the AV node holding the door — the only normal route in."

**PILLS**
- pearl: "Rates by grid: 300–150–100–75–60 per large box. Faster than counting, harder to fool."
- night-eye: "Normal intervals: PR 120–200 ms, QRS <120 ms, QTc <460 ms. Three numbers rule out half the catalog."
- lookalike → `afib`: "Irregular with P waves = sinus arrhythmia (breathes with the patient), not AF."

**SUSPECT & CONFIRM**
- "A normal ECG is a snapshot, not an alibi — symptoms + one strip decide nothing." `[AHA-ACS-2025]`
- "Chest pain with a normal first ECG → serial ECGs and troponin." `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "No finding to treat — treat the patient in front of you." `[AHA-ACS-2025]`
(UI appends the local-protocol close on every card.)

**Assertions** (trace + model): rateBpm 55–95 · prMs 120–200 · qrsMs 60–119 ·
qtcMs 350–460 · netQrs V1 '−' · netQrs V6 '+' · netQrs aVR '−' · axisDeg −30…+90.

---

## 2. `afib` — Atrial fibrillation  [P0 · Rate & rhythm]

**Tagline:** No two RR intervals agree, and nobody is steering the atria.

**SEE IT / commit**
- ✅ Atrial fibrillation — *(correct)*
- Sinus with PACs — tempts: "Frequent PACs feel chaotic, but the underlying march survives between them."
- Atrial flutter, variable block — tempts: "Flutter's baseline is a sawtooth ruler; AF's is static fuzz."
- Multifocal atrial tachycardia — tempts: "MAT has real P waves — ≥3 shapes. AF has none at all."

**Recording spec:** PTB-XL; include `rhythmAny: ["AFIB"]`; ventricular rate 90–140;
exclude PACE, exclude bundle-branch block for the primary (keep one BBB+AF as
extra). Extras: 2.

**Mechanism spec:** `kind: 'authored'` — reason: "chaotic multi-wavelet atrial
activity is beyond the solver's region graph." Beats: irregular RR (e.g. 640, 890,
710, 1020, 760 ms); each beat = normal ventricular sources (solver-derived QRS
lobes) with NO atrial P sources; add low-amplitude irregular atrial noise lobes
(mag ≤0.04 mV, random-ish directions, authored explicitly — no runtime RNG).
mustShow: atria shimmer without organized sweep · AV node bombarded, letting beats
through irregularly · ventricles fire normally but off-beat. primaryLead: `II`.

**WHY**
1. "The atria no longer contract as one — hundreds of wavelets shimmer instead of a single sweep."
2. "No organized atrial vector → no P wave, only baseline fibrillation."
3. "The AV node passes wavefronts at random → irregularly irregular R waves."

**PILLS**
- trap: "A *regular* slow wide rhythm in known AF = the AV node has failed (complete block with escape) — or dig toxicity. Regularized AF is never boring."
- night-eye: "March the R waves with calipers or paper edge. If no two intervals match and there are no P waves — AF."
- pearl: "The machine over-calls AF (artifact, PACs) and those calls often go uncorrected. Never confirm AF without seeing the irregularity yourself."
- lookalike → `aflutter`: "Organized sawtooth at ~300/min = flutter. If the rate sits at exactly ~150, hunt for it."

**SUSPECT & CONFIRM**
- "New AF: electrolytes, TSH, and an echo belong in the workup." `[AHA-AF-2023]`
- "Estimate stroke risk (CHA₂DS₂-VASc) before the rhythm conversation." `[AHA-AF-2023]`

**GUIDELINE MOVES**
- "Unstable from the rhythm → synchronized cardioversion now." `[AHA-ACLS-2020]`
- "Stable → rate control (beta-blocker or diltiazem), then the anticoagulation decision." `[AHA-AF-2023]`
- "Onset unclear or >48 h → anticoagulation strategy before elective cardioversion." `[AHA-AF-2023]`

**Assertions:** trace: irregularRR cvMin 0.10 · custom `noConsistentP` (no
repeating P-wave correlate preceding QRS at fixed offset) · qrsMs <120. model:
prMs absent · irregularRR cvMin 0.10.

---

## 3. `aflutter` — Atrial flutter with 2:1 block  [P0 · Rate & rhythm]

**Tagline:** A regular tachycardia at exactly 150 is flutter until you prove otherwise.

**SEE IT / commit**
- ✅ Atrial flutter, 2:1 conduction — *(correct)*
- Sinus tachycardia — tempts: "At 150, every second flutter wave hides inside the T. Sinus tach rarely parks at a fixed 150."
- SVT (AVNRT) — tempts: "AVNRT is usually faster (170–220) and truly P-less; flutter's sawtooth peeks out in II/III/aVF."
- Atrial fibrillation — tempts: "AF is irregular; 2:1 flutter is metronome-regular."

**Recording spec:** PTB-XL; include `rhythmAny: ["AFLT"]`; prefer ventricular
140–160 (2:1); an extra with higher-grade block (sawtooth obvious) for the reveal.

**Mechanism spec:** `kind: 'authored'` — reason: "macro-reentrant circuit is not in
the solver graph (reentry animation itself is Stage 2 — do NOT build a circling
wavefront; show the atria re-firing rhythmically at 300/min instead)." Beats:
atrial lobes at 200 ms spacing (300/min), alternate ones followed by normal
ventricular sources (2:1). mustShow: atria fire 300/min, metronomic · AV node
passes every second impulse · flutter waves continue through the QRS/T.
primaryLead: `II`.

**WHY**
1. "One re-entrant loop laps the right atrium ~300 times a minute — a sawtooth, not a P."
2. "The AV node can't pass 300 — it halves it: ventricular rate ~150."
3. "Change the block (2:1 → 3:1 → 4:1) and the ventricular rate steps, not slides."

**PILLS**
- trap: "'SVT at 150' given AV-nodal blockers and unmasked as flutter — the classic. At 150, actively hunt sawtooth in II, III, aVF, V1."
- pearl: "Vagal maneuvers or adenosine won't convert flutter — but the transient block *unmasks* the sawtooth. Diagnostic, not therapeutic."
- night-eye: "Flip the strip upside down — sawtooth in the inferior leads often jumps out."
- lookalike → `svt-avnrt`: "Truly no atrial activity and 180+ → think AVNRT."

**SUSPECT & CONFIRM**
- "Same workup as AF: electrolytes, TSH, echo; same stroke-risk arithmetic." `[AHA-AF-2023]`

**GUIDELINE MOVES**
- "Unstable → synchronized cardioversion (flutter often converts at low energy)." `[AHA-ACLS-2020]`
- "Stable → rate control is harder than in AF; anticoagulation rules are the same." `[AHA-AF-2023]`
- "Recurrent typical flutter → ablation referral (high cure rate)." `[AHA-AF-2023]`

**Assertions:** trace: rateBpm 130–170 · custom `regularRR` (cv <0.05) · qrsMs
<120. model: atrial event spacing 190–210 ms · ventricular:atrial 1:2.

---

## 4. `vt-mono` — Monomorphic ventricular tachycardia  [P0 · Rate & rhythm · LETHAL]

**Tagline:** Wide and fast is VT until proven otherwise — and the proof is rarely worth the gamble.

**SEE IT / commit**
- ✅ Ventricular tachycardia — *(correct)*
- SVT with aberrancy — tempts: "Possible — but betting on it kills. Age >35 or any infarct history: VT odds >90%."
- Sinus tach with bundle branch block — tempts: "Look for the sinus P marching into each QRS — here there is none you can trust."
- Hyperkalemia — tempts: "Fair thought — sick, wide and weird belongs to K⁺ too. But look for the tachycardic, uniform, regular march of VT." *(links `hyperk`)*

**Recording spec:** target `reconstructed` — human picks a published monomorphic VT
12-lead (registry gets the citeKey at sign-off; `TODO(REVIEW): VT case selection`).
Fallback `modeled`. (PTB-XL has no sustained VT; do not fake one from PVC runs.)

**Mechanism spec:** `kind: 'authored'` — reason: "AV dissociation needs two
independent pacemakers; the solver paces one site." Beats: ventricular focus
(solver single-beat with `pace: 'LV_lat'`, harvested sources) at RR 340 ms
(~176/min); independent atrial P lobes at RR 800 ms continuing regardless
(dissociation); one fusion beat authored where P lands just before a V beat.
mustShow: ectopic ventricular focus fires · spread is slow, cell-to-cell (wide
QRS) · atria keep their own beat (dissociation) · one fusion beat. primaryLead: `V1`.

**WHY**
1. "A ventricular focus fires fast; each impulse crawls cell-to-cell — every QRS is wide."
2. "The sinus node never stopped — dissociated P waves march through, and sometimes capture or fuse."
3. "Muscle-to-muscle spread ignores the bundles, so the shape matches no clean BBB."

**PILLS**
- pearl: "Findings that clinch VT: AV dissociation, capture/fusion beats, concordance across V1–V6, QRS >160 ms, extreme ('northwest') axis."
- trap: "The fatal error is treating assumed 'SVT with aberrancy' with verapamil or diltiazem — in VT that's hypotension and arrest. Wide + fast gets VT treatment."
- night-eye: "Algorithms (Brugada etc.) look precise but their real-world specificity is modest — never let a flowchart overrule the pretest odds of an old infarct."
- lookalike → `hyperk`: "Slow-wide-weird without tachycardia — think K⁺ before antiarrhythmics."

**SUSPECT & CONFIRM**
- "Assume VT; check K⁺/Mg²⁺, troponin, and dig up an old ECG only AFTER the patient is safe." `[AHA-VA-2017]`
- "Post-conversion: 12-lead, electrolytes, ischemia workup — VT has a cause." `[AHA-VA-2017]`

**GUIDELINE MOVES**
- "Unstable → synchronized cardioversion. Pulseless → defibrillate." `[AHA-ACLS-2020]`
- "Stable → IV procainamide or amiodarone — never verapamil/diltiazem for undifferentiated wide tachycardia." `[AHA-ACLS-2020]` `[ESC-VA-2022]`

**Assertions:** trace(reconstructed/modeled) + model: rateBpm 140–220 · qrsMs
140–220 · custom `regularRR` cv <0.06 · custom `avDissociation` (model: atrial
event rate ≠ ventricular rate).

---

## 5. `paced-v` — Ventricular paced rhythm  [P1 · Conduction]

**Tagline:** The rhythm the machine misreads most — learn what the pacer's shadow should look like.

**SEE IT / commit**
- ✅ Ventricular paced rhythm — *(correct)*
- LBBB — tempts: "Paced QRS mimics LBBB (RV origin) — but hunt the pacing spikes before the QRS."
- VT — tempts: "Wide, yes — but rate ~60–70 and a spike before every beat is a pacer doing its job."
- Hyperkalemia — tempts: "Wide and odd, but here every complex is *identically* preceded by a stimulus artifact."

**Recording spec:** PTB-XL; include `scpAny: ["PACE"]`; visible spikes preferred
(500 Hz helps); extras: 1.

**Mechanism spec:** `kind: 'solver'` — `state: { pace: 'RV_inf' }` (RV apical
region), rr 850, 3 beats; render a stimulus artifact glyph at each onset (UI
concern, flagged in spec). mustShow: stimulus at RV apex · slow cell-to-cell
spread RV→LV (wide QRS, LBBB-like) · discordant repolarization. primaryLead: `V1`.

**WHY**
1. "The lead paces the RV apex — depolarization crawls muscle-to-muscle, right to left."
2. "So the paced QRS is wide and LBBB-like, with discordant ST/T — by design, not disease."
3. "Every paced beat should follow its spike; every spike should capture."

**PILLS**
- pearl: "Automated reads misread paced rhythms often — machine text on a paced ECG is a hypothesis, not a report."
- trap: "Ischemia does NOT become invisible: modified Sgarbossa rules work in paced rhythms — concordant ST shifts stay guilty." *(links `sgarbossa`)*
- night-eye: "Spikes with no QRS after them = failure to capture. Count spike→QRS pairs before admiring the morphology."

**SUSPECT & CONFIRM**
- "Chest pain in a paced rhythm → apply modified Sgarbossa; don't write 'uninterpretable'." `[SMITH-MSC-2012]`
- "Suspected device problem → magnet response and device interrogation." `[AHA-BRADY-2018]`

**GUIDELINE MOVES**
- "Symptomatic non-capture or bradycardia → transcutaneous pacing bridge while the device is interrogated." `[AHA-BRADY-2018]` `[AHA-ACLS-2020]`

**Assertions:** trace + model: qrsMs ≥120 · netQrs V1 '−' · netQrs aVF '−'
(apical pacing, superior axis) · rateBpm 55–90 · tPolarity V1 '+' (discordant).

---

## 6. `avb-3` — Complete (third-degree) AV block  [P0 · Conduction · LETHAL]

**Tagline:** Two rhythms sharing one heart — the Ps and the QRSs never speak.

**SEE IT / commit**
- ✅ Complete heart block — *(correct)*
- Sinus bradycardia — tempts: "Slow, yes — but march the Ps: more Ps than QRSs, and PR changes every beat."
- Second-degree AV block — tempts: "In 2° *some* Ps conduct (fixed or lengthening PR). Here no P owns any QRS."
- Junctional rhythm — tempts: "Junctional escape is part of the answer — but the dissociated marching Ps make it complete block."

**Recording spec:** PTB-XL; include `scpAny: ["3AVB"]` (few — preview all);
fallback `reconstructed` (published case; `TODO(REVIEW): AVB3 case selection` if
PTB-XL yields nothing usable).

**Mechanism spec:** `kind: 'authored'` — reason: "two independent pacemakers."
Atrial P lobes at RR 800 (75/min) throughout; ventricular escape beats
(solver junctional: normal-narrow QRS sources) at RR 1500 (40/min), no fixed PR
relation. Variant frame (extra): wide ventricular escape at RR 2000 (30/min).
mustShow: AV node/His region marked blocked (greyed) · Ps march alone ·
an independent slow escape below the block · the two never align. primaryLead: `II`.

**WHY**
1. "The AV junction no longer conducts — atria and ventricles run separate lives."
2. "A downstream escape pacemaker keeps the ventricles alive: junctional = narrow ~40–60, ventricular = wide ~20–40."
3. "PR intervals look random because they're meaningless — no P conducts."

**PILLS**
- pearl: "March the Ps with calipers. More Ps than QRSs + no fixed PR = complete block."
- trap: "In inferior OMI the block is nodal — often transient and atropine-responsive. In anterior OMI it's infranodal — ominous, pace early." *(links `omi-inferior`)*
- night-eye: "A 'regular bradycardia at 40' that ignores its own P waves is never sinus. Look twice."
- lookalike → `hyperk`: "Bradycardia + widening + weirdness = check the K⁺ before blaming the conduction system."

**SUSPECT & CONFIRM**
- "Hunt reversible causes: K⁺, AV-nodal drugs (beta-blocker, calcium-blocker, digoxin), ischemia, Lyme." `[AHA-BRADY-2018]`
- "Acute MI context changes everything — localize it (inferior vs anterior)." `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "Symptomatic → atropine trial while pads go on; expect it to fail if the escape is wide (infranodal)." `[AHA-ACLS-2020]`
- "Transcutaneous pacing bridge → transvenous pacing; treat the cause in parallel." `[AHA-BRADY-2018]`

**Assertions:** model: atrial rate 70–80 · ventricular rate 35–45 · custom
`avDissociation` · qrsMs <120 (junctional variant). trace: rateBpm (ventricular)
25–50 · custom `morePsThanQrs` (detected P count > QRS count over the strip).

---

## 7. `avb-2` — Second-degree AV block: Mobitz I vs II  [P1 · Conduction · LETHAL]

**Tagline:** One drops beats politely with warning; the other drops them cold — and needs a pacemaker.

**SEE IT / commit** (primary trace = Mobitz II)
- ✅ Mobitz II — *(correct)*
- Mobitz I (Wenckebach) — tempts: "Wenckebach stretches the PR before it drops. Here the PR never changes — then a P simply fails."
- Blocked PACs — tempts: "A non-conducted PAC comes *early* with a different P shape; these dropped Ps are on time."
- Complete heart block — tempts: "Most Ps here conduct with a fixed PR — in complete block none do."

**Recording spec:** PTB-XL `scpAny: ["2AVB"]` — preview to classify I vs II; ship
one of each if found (primary II, extra I). Fallback `modeled` for whichever is
missing.

**Mechanism spec:** two strips. Mobitz I: `authored` PR ladder 160→220→280→dropped,
repeat (grouped beating); reason: "decremental AV conduction isn't in the solver."
Mobitz II: fixed PR 160, every 4th P non-conducted; His/bundle region flagged as
the failing site. mustShow: (I) the AV node fatiguing — each pass slower until one
fails · (II) the infranodal system failing without warning. primaryLead: `II`.

**WHY**
1. "Mobitz I: the AV node fatigues — PR stretches beat by beat until one P is dropped, then resets."
2. "Mobitz II: the His–Purkinje system fails without warning — fixed PR, then a sudden orphan P."
3. "Below-the-node disease is unstable real estate — it can fall to complete block at any time."

**PILLS**
- pearl: "Grouped beating + lengthening PR + shortening RR = Wenckebach. Usually nodal, often benign, frequently drug- or vagal-flavored."
- trap: "2:1 block can't be called I or II from one strip — every other P drops in both. Judge by company: wide QRS and no PR variation lean Mobitz II. Get a long strip."
- night-eye: "Mobitz II on the monitor overnight is a call-now finding, not a note-for-the-morning finding."

**SUSPECT & CONFIRM**
- "Review AV-blocking drugs, K⁺, ischemia; get a long rhythm strip and old ECGs." `[AHA-BRADY-2018]`

**GUIDELINE MOVES**
- "Mobitz II (or any symptomatic block) → pads on, pacing pathway, cardiology now." `[AHA-BRADY-2018]`
- "Asymptomatic Wenckebach → usually observation and cause-hunting, not hardware." `[AHA-BRADY-2018]`

**Assertions:** model(Mobitz I strip): PR sequence strictly increasing within each
group then a dropped QRS · model(Mobitz II strip): PR constant ±10 ms, dropped QRS
present · trace: custom `droppedBeats` (RR containing a P without QRS ≈ 2× base RR).

---

## 8. `rbbb` — Right bundle branch block  [P0 · Conduction]

**Tagline:** The right ventricle gets the news late — and tells V1 about it twice.

**SEE IT / commit**
- ✅ RBBB — *(correct)*
- LBBB — tempts: "Both are wide. LBBB is *down* in V1; RBBB's rSR′ is up. Terminal forces decide." *(links `lbbb`)*
- Brugada pattern — tempts: "Coved STE in V1 vs an rSR′ with a wide S in I/V6 — Brugada has no broad terminal S." *(links `brugada`)*
- Ventricular rhythm — tempts: "A P before every QRS with fixed PR keeps this supraventricular."

**Recording spec:** PTB-XL `scpAny: ["CRBBB"]`, rhythm SR; extras: 1.

**Mechanism spec:** `kind: 'solver'` — `state: { pace: 'SA', blockedEdges:
['HIS>RBB'] }` (v1-proven emergent RBBB). mustShow: left side depolarizes on time ·
RV reached late, cell-to-cell across the septum · the late rightward wavefront =
the R′ · discordant T in V1–V3. primaryLead: `V1`.

**WHY**
1. "The right bundle is cut; the LV fires on time — the beat starts almost normally."
2. "The RV is reached late, muscle-to-muscle — a second, slow rightward push."
3. "That late push writes the R′ in V1 and the broad S in I and V6."

**PILLS**
- pearl: "RBBB changes the END of the QRS, not the start — so ischemia rules are UNCHANGED. Read ST segments like normal."
- trap: "New RBBB + left anterior fascicular block in anterior chest pain = proximal LAD territory dying — not 'just a block'." *(links `omi-anterior`)*
- night-eye: "Expected discordance here is small: T inversion in V1–V2 is the norm; STE in V1 is NOT — investigate it."

**SUSPECT & CONFIRM**
- "New RBBB with dyspnea/hypotension: think RV strain — pulmonary embolism belongs on the list." `[ESC-VA-2022]`

**GUIDELINE MOVES**
- "Isolated asymptomatic RBBB needs no treatment — the work is in what caused it." `[AHA-BRADY-2018]`

**Assertions:** trace + model: qrsMs 120–160 · custom `terminalRV1` (last 40 ms of
QRS in V1 positive) · netQrs I: custom broad terminal S (last 40 ms negative in I)
· tPolarity V1 '−'.

---

## 9. `lbbb` — Left bundle branch block  [P0 · Conduction]

**Tagline:** The whole left ventricle fires late and backward — and rewrites the ST rules with it.

**SEE IT / commit**
- ✅ LBBB — *(correct)*
- Anterior STEMI — tempts: "The STE in V1–V3 is *expected* discordance over deep S waves — proportionate, not injury. Learn the rule before the exception." *(links `sgarbossa`)*
- RBBB — tempts: "Check V1's terminal direction: down = left bundle problem."
- Ventricular paced rhythm — tempts: "Same physics (RV-first), but there's no pacing spike here." *(links `paced-v`)*

**Recording spec:** PTB-XL `scpAny: ["CLBBB"]`, rhythm SR; extras: 1.

**Mechanism spec:** `kind: 'solver'` — `state: { pace: 'SA', blockedEdges:
['HIS>LBB'] }` (v1-proven; septal q vanishes, wide leftward forces emerge).
mustShow: septum depolarizes right→left (reversed) · LV reached late cell-to-cell ·
broad notched leftward QRS · ST/T forced opposite the QRS (appropriate
discordance). primaryLead: `V1`.

**WHY**
1. "The left bundle is cut — the septum now fires right-to-left (the septal q dies)."
2. "The dominant LV depolarizes late and slowly — broad, notched leftward QRS."
3. "Abnormal depolarization forces abnormal repolarization: ST/T point OPPOSITE the QRS, in proportion."

**PILLS**
- pearl: "'Appropriate discordance' is the baseline you'll measure ischemia against — internalize it here, cash it in on the Sgarbossa card." *(links `sgarbossa`)*
- trap: "'New LBBB = automatic cath lab' is retired. New LBBB + a convincing story is still serious — but the criteria card decides." *(links `sgarbossa`)*
- night-eye: "LBBB with *concordant* ST anywhere is never 'just the block' — escalate."

**SUSPECT & CONFIRM**
- "New LBBB deserves an echo and an ischemia conversation — it usually marks real structural disease." `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "Chest pain + LBBB → apply Sgarbossa/Smith-modified criteria, not despair." `[SGARBOSSA-1996]` `[SMITH-MSC-2012]`

**Assertions:** trace + model: qrsMs 120–180 · netQrs V1 '−' · netQrs V6 '+' ·
tPolarity V6 '−' (discordant) · tPolarity V1 '+' (discordant) · custom
`noSeptalQ` (no initial q in V5/V6).

---

## 10. `omi-anterior` — Anterior occlusion MI  [P0 · Occlusion & ischemia · LETHAL]

**Tagline:** The LAD is closing in real time — the earliest tell is a T wave that outgrew its QRS.

**SEE IT / commit**
- ✅ Anterior occlusion MI — *(correct)*
- Benign early repolarization — tempts: "BER's STE is concave with notched J points and NO reciprocal depression — and it doesn't evolve."
- Pericarditis — tempts: "Diffuse STE + PR depression, no reciprocal change except aVR. Territorial STE with reciprocals is occlusion."
- LVH with strain — tempts: "V1–V3 STE over deep S waves can be proportionate secondary change — check voltages first." *(links `lvh-strain`)*

**Recording spec:** PTB-XL; include `scpAny: ["INJAS","INJAL","STE_"]` with human
preview selecting a convincing acute anterior injury pattern (PTB-XL skews
non-hyperacute; if nothing convinces → `reconstructed`, `TODO(REVIEW): anterior
OMI case selection`). Extras: 1 (an evolved anterior MI for the timeline pill).

**Mechanism spec:** `kind: 'solver'` — `state: { pace: 'SA', ischemic: ['LV_ant',
'LV_apex'], injuryDir: [0.3, −0.25, 0.95], injuryMag: 0.72 }` (v1-proven).
mustShow: anterior wall marked injured · sustained injury vector pointing at the
chest leads during ST · facing leads elevate, inferior leads dip (reciprocal) ·
the hyperacute-T frame before frank STE. primaryLead: `V2`.

**WHY**
1. "Occluded LAD → the anterior wall holds an injury current between beats."
2. "That sustained vector points at V2–V4: ST elevation where it faces, reciprocal depression opposite."
3. "Before elevation, ischemic T waves grow tall and fat — the hyperacute phase is the earliest catch."

**PILLS**
- pearl: "Hyperacute T = broad, bulky, area-out-of-proportion to its QRS. Catch the OMI here and you beat the criteria." 
- trap: "STEMI *criteria* miss a large share of true occlusions. Criteria-negative but story-positive + evolving ECG = serial ECGs every 10–15 min and talk to cath — not discharge."
- night-eye: "Reciprocal depression (here: inferior) is the truth serum — mimics rarely produce it."
- lookalike → `dewinter`: "Precordial ST *depression* sloping up into giant Ts is the same artery, occluded now."

**SUSPECT & CONFIRM**
- "Ongoing symptoms + territorial STE (or a convincing equivalent) → this is a reperfusion conversation, not a troponin wait." `[AHA-ACS-2025]`
- "Serial ECGs; compare with priors; troponin confirms but must not delay." `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "Activate reperfusion: primary PCI (door-to-balloon ≤90 min; ≤120 if transferring)." `[AHA-ACS-2025]`
- "Aspirin now; anticoagulation and P2Y₁₂ per local cath pathway." `[AHA-ACS-2025]`

**Assertions:** model: stShift V2 '+' ≥0.1 · stShift V3 '+' ≥0.1 · stShift III '−'
· qrsMs <120. trace: stShift V2 '+' ≥0.1 (if `recorded` primary found; else on
reconstruction).

---

## 11. `omi-inferior` — Inferior occlusion MI (+ right ventricle)  [P0 · Occlusion & ischemia · LETHAL]

**Tagline:** Three small leads, one closing artery — and a right ventricle that punishes nitroglycerin.

**SEE IT / commit**
- ✅ Inferior occlusion MI — *(correct)*
- Pericarditis — tempts: "Diffuse concave STE without reciprocal aVL depression. Inferior OMI almost always depresses aVL."
- Benign early repolarization — tempts: "BER doesn't do reciprocal aVL depression either — that finding is the divider."
- Normal variant — tempts: "Subtle inferior STE is easy to wave off — aVL is your tiebreaker. Look there first."

**Recording spec:** PTB-XL `scpAny: ["INJIN","IMI","STE_"]`, preview for acute
inferior injury; extras: 1. Fallback `reconstructed`.

**Mechanism spec:** `kind: 'solver'` — `state: { pace: 'SA', ischemic: ['LV_inf'],
injuryDir: [0.15, 0.9, −0.3], injuryMag: 0.6 }`. mustShow: inferior wall injured ·
injury vector pointing down (at II/III/aVF) · aVL sees it leaving → reciprocal
depression · the RV-involvement variant marked on the septum/RV. primaryLead: `III`.

**WHY**
1. "RCA (usually) closes → the inferior wall holds the injury current."
2. "The vector points at the feet: STE in II, III, aVF — and aVL, facing away, dips."
3. "A proximal RCA also starves the RV — a preload-dependent ventricle appears."

**PILLS**
- pearl: "STE III > II leans RCA (vs circumflex) — and raises the RV-infarct question. Answer it with V4R."
- trap: "RV infarct + nitroglycerin = crashing preload → hypotension. Fluids first, nitrates withheld."
- night-eye: "Fresh inferior OMI + new AV block is nodal ischemia — often atropine-responsive, usually transient." *(links `avb-3`)*
- lookalike → `omi-posterior`: "Inferior STE with V1–V3 depression = the posterior wall is in too."

**SUSPECT & CONFIRM**
- "Record V4R (RV) and V7–V9 (posterior) — thirty seconds that change management." `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "Reperfusion now — same clock as any OMI." `[AHA-ACS-2025]`
- "Hypotension after nitrates or STE in V4R → RV infarct: volume first, avoid further preload reduction." `[AHA-ACS-2025]`

**Assertions:** model: stShift III '+' ≥0.1 · stShift aVF '+' ≥0.05 · stShift aVL
'−' · custom `st3gt2` (stShift III > stShift II). trace: stShift III '+' ≥0.05 ·
stShift aVL '−'.

---

## 12. `omi-posterior` — Posterior occlusion MI  [P0 · Occlusion & ischemia · LETHAL]

**Tagline:** Read the back of the heart in a mirror: depression in V1–V3 that is elevation upside-down.

**SEE IT / commit**
- ✅ Posterior occlusion MI — *(correct)*
- Anterior subendocardial ischemia — tempts: "'Anterior ischemia' is the classic mislabel. Depression MAXIMAL in V1–V3 (not V4–V6) + tall R = posterior wall."
- RBBB — tempts: "Tall R in V1, but the QRS is narrow here and there's no wide terminal S." *(links `rbbb`)*
- Normal variant tall R — tempts: "A tall V1 R alone, maybe — with horizontal ST depression and upright T, no."

**Recording spec:** PTB-XL `scpAny: ["PMI","STD_"]` preview for STD maximal V1–V3
with tall R; fallback `reconstructed` (`TODO(REVIEW): posterior OMI case
selection`).

**Mechanism spec:** `kind: 'authored'` — reason: "the solver's region set has no
discrete posterior-basal wall; mirrored morphology needs authored sources." Port
v1 `posterior-mi` beat (posterior depolarization source `pos` at the posterior
wall, mirrored tall R; posterior-pointing ST injury vector). mustShow: injury on
the posterior wall, pointing AWAY from the chest · V1–V3 record the mirror
(depression) · the tall R as the mirrored Q. primaryLead: `V2`.

**WHY**
1. "No electrode faces the posterior wall — V1–V3 watch it from the wrong side."
2. "Posterior STE therefore records as ANTERIOR ST depression; the posterior Q as a tall R."
3. "Flip the strip and it reads as a textbook STEMI — that's the whole trick."

**PILLS**
- pearl: "ST depression maximal in V1–V3 is posterior OMI until proven otherwise. Maximal in V4–V6 points elsewhere (subendocardial/demand)."
- trap: "Calling it 'NSTEMI, medical management' while the circumflex is closed — the never-counted miss. Posterior leads or cath decide."
- night-eye: "It rarely travels alone — scan inferior and lateral leads for company." *(links `omi-inferior`)*

**SUSPECT & CONFIRM**
- "Posterior leads V7–V9: ≥0.5 mm STE there confirms (1 mm in young men)." `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "Confirmed posterior OMI = reperfusion, same urgency as any STEMI." `[AHA-ACS-2025]`

**Assertions:** model: stShift V2 '−' ≥0.1 · rsRatio V1 ≥1 · tPolarity V2 '+' ·
qrsMs <120. trace: stShift V2 '−' ≥0.05 · rsRatio V1 ≥0.8.

---

## 13. `sgarbossa` — Occlusion MI inside LBBB (Sgarbossa / Smith-modified)  [P0 · Occlusion & ischemia · LETHAL]

**Tagline:** LBBB hides ischemia behind expected discordance — catch the ST that breaks the rule.

**SEE IT / commit**
- ✅ LBBB with concordant STE — occlusion MI — *(correct)*
- Plain LBBB — tempts: "The lateral ST here rises WITH a positive QRS. LBBB never does that on its own." *(links `lbbb`)*
- Ventricular paced rhythm — tempts: "Same discordance logic, but no pacing spikes — and the criteria apply to both anyway." *(links `paced-v`)*
- Hyperkalemia — tempts: "Wide-and-weird again — but the Ps are preserved and the story is chest pain, not renal failure."

**Recording spec:** target `reconstructed` (published Sgarbossa-positive case;
`TODO(REVIEW): Sgarbossa case selection`); fallback `modeled` (v1's authored
morphology, ported). A plain-LBBB `recorded` extra for the compare toggle.

**Mechanism spec:** `kind: 'authored'` — reason: "exact concordant-STE morphology
on an LBBB chassis exceeds solver resolution." Port v1 `sgarbossa` beat (LBBB
chassis + concordant lateral ST injury vector), add `pos` to the lateral sources.
mustShow: LBBB activation (late LV) · the added injury vector pointing WITH the
lateral QRS · concordance flagged on the trace. primaryLead: `V5`.

**WHY**
1. "LBBB's rule: ST/T point OPPOSITE the QRS, proportionally — 'appropriate discordance.'"
2. "A transmural injury current adds its own ST vector on top."
3. "When ST goes WITH the QRS — or opposite but out of proportion — the block can't explain it. That's the occlusion."

**PILLS**
- pearl: "Sgarbossa: concordant STE ≥1 mm (5 pts) · concordant STD ≥1 mm in V1–V3 (3 pts) · discordant STE ≥5 mm (2 pts). ≥3 points = treat as occlusion." `[SGARBOSSA-1996]`
- pearl: "Smith modification: discordant STE ≥25% of the preceding S depth (ST/S ≤ −0.25) — replaces the blunt 5 mm rule, much better sensitivity." `[SMITH-MSC-2012]`
- trap: "'It's LBBB, can't read ischemia' is a chart-review classic. You can. You just did."
- night-eye: "Same rules for paced rhythms — concordance stays guilty." *(links `paced-v`)*

**SUSPECT & CONFIRM**
- "Positive criteria + ACS story → treat as occlusion; serial ECGs if borderline." `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "Sgarbossa-positive (classic ≥3 pts or Smith-modified) → activate reperfusion." `[AHA-ACS-2025]` `[SMITH-MSC-2012]`

**Assertions:** model: qrsMs ≥120 · netQrs V5 '+' AND stShift V5 '+' ≥0.1
(concordance, the point of the card) · netQrs V1 '−'.

---

## 14. `wellens` — Wellens syndrome  [P0 · Occlusion & ischemia · LETHAL]

**Tagline:** The pain is gone, the ECG looks calm — and the LAD is critically narrowed behind both.

**SEE IT / commit**
- ✅ Wellens pattern — critical LAD — *(correct)*
- Nonspecific T changes — tempts: "Deep SYMMETRIC V2–V3 inversions in a recent-chest-pain patient are never 'nonspecific'."
- Old anterior infarct — tempts: "Old infarcts lose R waves and carry Qs — Wellens preserves the Rs. That's the point."
- Persistent juvenile T pattern — tempts: "A young-pattern lookalike exists (V1–V3, asymmetric, asymptomatic) — the story separates them."

**Recording spec:** PTB-XL preview `scpAny: ["INVT","ISCAN","ISCAS"]` for deep
symmetric anterior T inversion with preserved R waves (type B); note on card: the
recording shows the pattern; the *syndrome* is pattern + story. Extras: 1
(biphasic type A if findable). Fallback `reconstructed`.

**Mechanism spec:** `kind: 'authored'` — reason: "post-reperfusion repolarization
disturbance is not a solver state." Port v1 `wellens` beat (normal QRS, deep
posterior-pointing anterior T source with `pos` anterior). mustShow: normal
depolarization (Rs preserved) · the anterior wall repolarizing abnormally after
reperfusion · T vector swinging away from V2–V3. primaryLead: `V3`.

**WHY**
1. "A critical LAD lesion occluded, then spontaneously reopened — the pain resolved."
2. "Depolarization recovered (R waves intact); repolarization didn't."
3. "The stunned anterior wall writes deep symmetric (or biphasic) Ts in V2–V3 — while the patient feels fine."

**PILLS**
- trap: "The calm ECG invites a stress test — which can close the artery. Wellens = NO stress testing; angiography instead." `[DEZWAAN-1982]`
- pearl: "Type A = biphasic (up-then-down); type B = deep symmetric inversion. A often evolves into B."
- night-eye: "Inverted Ts turning UPRIGHT during recurrent pain = pseudo-normalization = the artery re-closing. That's a deterioration."

**SUSPECT & CONFIRM**
- "Recent angina + V2–V3 T pattern + preserved Rs + near-normal troponin = Wellens; admit and image the LAD." `[DEZWAAN-1982]` `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "Admit, antithrombotic therapy per ACS pathway, early angiography — no stress test." `[AHA-ACS-2025]`

**Assertions:** trace + model: tPolarity V2 '−' · tPolarity V3 '−' · tPolarity V6
'+' · qrsMs <120 · custom `preservedR` (R amplitude V2–V3 ≥0.2 mV) · stShift V2
within ±0.1.

---

## 15. `dewinter` — de Winter pattern  [P0 · Occlusion & ischemia · LETHAL]

**Tagline:** The anterior STEMI that forgot to elevate: upsloping depression climbing into giant Ts.

**SEE IT / commit**
- ✅ de Winter — LAD occlusion equivalent — *(correct)*
- Subendocardial ischemia — tempts: "'Diffuse depression, manage medically' — but UPSLOPING depression rising into huge Ts is a closed LAD, now."
- Hyperkalemia — tempts: "Tall Ts, yes — but hyperK Ts are narrow-based and pinched; these are broad, on a depressed take-off, with an ACS story." *(links `hyperk`)*
- Early repolarization — tempts: "BER's J-point is elevated, not depressed. Opposite take-off."

**Recording spec:** target `reconstructed` (published de Winter case;
`TODO(REVIEW): de Winter case selection`); fallback `modeled` (port v1 authored
morphology).

**Mechanism spec:** `kind: 'authored'` — reason: "a 'stuck hyperacute phase' is
not a solver state." Port v1 `de-winter` beat (subendocardial-pattern ST vector
pointing away from the chest + tall broad anterior T source). mustShow:
subendocardial injury shading · ST vector pointing posterior (depression at the J
point in V1–V6) · giant symmetric Ts towering out of it. primaryLead: `V3`.

**WHY**
1. "Proximal LAD occludes — the whole anterior wall is ischemic at once."
2. "The injury current runs subendocardial-dominant: J-points depress across the precordium."
3. "Acute transmural ischemia towers the Ts straight out of the depressed take-off."

**PILLS**
- pearl: "Recognition = upsloping STD ≥1 mm at the J point in the precordials + tall symmetric Ts + often slight aVR elevation." `[DEWINTER-2008]`
- trap: "It usually does NOT evolve into classic STE — waiting for elevation is waiting for necrosis."
- night-eye: "Ongoing chest pain + this pattern = call the lab like it's a STEMI, because it is one."

**SUSPECT & CONFIRM**
- "Treat the pattern as an occlusion equivalent; serial ECGs don't downgrade it." `[DEWINTER-2008]` `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "Immediate reperfusion pathway — as for STEMI." `[AHA-ACS-2025]`

**Assertions:** model: stShift V2 '−' ≥0.1 · tPolarity V2 '+' with custom
`tallT` (T peak V2 ≥0.5 mV) · qrsMs <120 · stShift aVR '+' (small, ≥0.03).

---

## 16. `hyperk` — Hyperkalemia  [P0 · Systemic window · LETHAL]

**Tagline:** The trace is a window on the blood, not just the heart — and K⁺ is the fastest thing it shows.

This card fronts the **HyperK module** (`/lab/hyperk`, content §Lab-K below); the
card itself teaches the pattern + moves.

**SEE IT / commit**
- ✅ Hyperkalemia — *(correct)*
- Acute occlusion (hyperacute T) — tempts: "OMI Ts are broad-based and regional; hyperK Ts are narrow, pinched, and everywhere." *(links `omi-anterior`)*
- VT — tempts: "Wide-and-weird reads as VT — sine-wave hyperkalemia has been shocked as VT more than once. Sick + renal + no clear Ps → K⁺ first." *(links `vt-mono`)*
- LBBB — tempts: "Wide QRS, but with flattening Ps and tented Ts — blocks don't erase P waves."

**Recording spec:** gallery = `reconstructed` (five published cases with measured
K — human sources them, `TODO(REVIEW): hyperK gallery case selection ×5`); morph =
`modeled` with `morphLabel: 'one possible trajectory'` (schema-enforced). Card
primary trace = the moderate-stage reconstruction (or modeled fallback). PTB-XL
`scpAny: ["EL"]` may surface real electrolyte-abnormal strips — preview; any find
becomes an extra with its badge.

**Mechanism spec:** `kind: 'authored'` morph in 4 keyframes — reason: "membrane-
level channel effects are modeled as morphology stages, explicitly labeled one
possible trajectory." Frames: (a) peaked T only (T mag 0.9, width 26 — narrow) ·
(b) + P flattening (P mag 0.02) + PR 220 · (c) + QRS 160 ms (widened lobes) ·
(d) sine-wave merge (QRS/T fused, rate 40). mustShow: repolarization speeding
(tented T) · atria falling silent while sinus keeps driving (sinoventricular) ·
conduction slowing everywhere (widening) · the sine-wave merge. primaryLead: `II`.

**WHY**
1. "Rising K⁺ raises the resting potential — the whole myocardium sits half-depolarized."
2. "Repolarization speeds up first: tall, narrow, tented Ts."
3. "Then sodium channels inactivate: Ps flatten, PR stretches, QRS widens — toward a sine wave."

**PILLS**
- pearl: "Tented T = you could prick a finger on it: tall, NARROW base, symmetric. HyperK's opener — versus the broad hyperacute T." 
- trap: "Treat the ECG, not the number: any widening, bradycardia, or sine wave → calcium NOW. The lab value can lag the arrest."
- night-eye: "Dialysis, renal failure, crush injury + wide bizarre slow rhythm with missing Ps = K⁺ until proven otherwise — treat empirically."
- pearl: "⚠ A normal ECG never rules hyperkalemia out — sensitivity is poor. It rules IN, never OUT." `[MONTAGUE-2008]`

**SUSPECT & CONFIRM**
- "Suspect on pattern + context (renal failure, K-sparing drugs, ACE-i, crush, acidosis); confirm with a stat K⁺ and a VBG." `[UKKA-K-2023]`
- "Rate of rise beats the absolute level — a fast climb is the dangerous climb." `[UKKA-K-2023]`

**GUIDELINE MOVES**
- "ECG changes → IV calcium first (stabilizes the membrane in minutes; lowers nothing)." `[UKKA-K-2023]`
- "Then shift: insulin 10 U + dextrose, plus nebulized salbutamol." `[UKKA-K-2023]`
- "Then eliminate: dialysis / binders / diuresis — and stop the K⁺ sources." `[UKKA-K-2023]`

**Assertions:** model frame (a): custom `tentedT` (T peak(II) ≥2× NSR reference AND
T width ≤60% of NSR T width) · frame (b): P amplitude ≤0.05 mV · frame (c): qrsMs
≥140 · frame (d): custom `sineMerge` (no isoelectric ST; QRS-T continuous).
Gallery reconstructions: each carries assertions matching its cited case's
documented QRS/T/P measurements (filled at case selection).

---

## 17. `tca` — Sodium-channel blocker toxicity (TCA)  [P0 · Systemic window · LETHAL]

**Tagline:** Treating the rhythm while the poison wins — aVR's terminal R is the tell.

**SEE IT / commit**
- ✅ Na-channel blocker toxicity — *(correct)*
- VT — tempts: "Wide and fast — but this is sinus tach with giant terminal aVR forces. Class I antiarrhythmics here would be gasoline." *(links `vt-mono`)*
- Hyperkalemia — tempts: "Both widen the QRS. HyperK flattens Ps and tents Ts; TCA races (anticholinergic tach) and throws the terminal vector at aVR." *(links `hyperk`)*
- Plain sinus tachycardia — tempts: "The rate is sinus-ish — the WIDTH and aVR's terminal R are the poison's signature."

**Recording spec:** target `reconstructed` (published TCA-overdose ECG with
documented QRS/aVR measurements; `TODO(REVIEW): TCA case selection`); fallback
`modeled`.

**Mechanism spec:** `kind: 'authored'` — reason: "drug-level channel kinetics are
modeled as their morphological consequence." Sinus beats RR 520 (115/min); QRS
lobes widened (phase-0 slowing: widths ×1.8) + an added LATE rightward-superior-
anterior lobe (`dir` toward aVR, i.e. [−0.7, −0.6, 0.2], mag 0.5, `pos` basal-right)
producing the terminal R in aVR ≥3 mm; QT prolonged (T center +60 ms). mustShow:
every myocyte's upstroke slowed (whole-QRS stretch) · the terminal vector swinging
right-superior (aVR's R) · the tachycardic anticholinergic drive. primaryLead: `aVR`.

**WHY**
1. "TCAs block fast sodium channels — every cell's phase-0 upstroke slows, so the QRS stretches."
2. "The right side of the septum/base suffers most — the terminal vector swings toward aVR."
3. "Wide QRS + terminal R in aVR + tachycardia in an overdose = the poisoned trace, not a primary arrhythmia."

**PILLS**
- pearl: "Numbers with teeth: QRS >100 ms → seizure risk; >160 ms → ventricular arrhythmia risk. aVR terminal R ≥3 mm is the classic flag." `[BOEHNERT-1985]` `[LIEBELT-1995]`
- trap: "Giving a class IA/IC antiarrhythmic (more Na-blockade) for the 'VT' — the exact wrong move. Bicarb IS the antiarrhythmic here."
- night-eye: "Altered + tachy + wide QRS + big pupils/dry skin = think TCA before the tox screen returns."

**SUSPECT & CONFIRM**
- "Suspect from context (ingestion, altered mental state, anticholinergic signs); confirm clinically — treat before levels." `[AHA-TOX-2023]`
- "Track the QRS width serially — it is the drug level you can see." `[BOEHNERT-1985]`

**GUIDELINE MOVES**
- "Sodium bicarbonate boluses (1–2 mEq/kg), repeat to narrow the QRS; benzodiazepines for seizures." `[AHA-TOX-2023]`
- "Avoid class IA/IC (and other Na-blocking) antiarrhythmics; refractory arrest → lipid emulsion per protocol." `[AHA-TOX-2023]`

**Assertions:** model: qrsMs 120–180 · rateBpm 100–130 · terminalRaVR ≥0.3 mV ·
qtcMs ≥460 · prMs present (sinus, unlike hyperK's fading Ps).

---

## 18. `longqt` — Drug-induced long QT & torsades  [P0 · Systemic window · LETHAL]

**Tagline:** Every med list writes on the T wave — and at QTc 500 the trace starts naming a number.

**SEE IT / commit** (primary trace = sinus with long QT)
- ✅ Prolonged QT — *(correct)*
- Normal — tempts: "Eyeballing misses it: if the T ends past the halfway point of the RR, measure properly."
- Hypokalemia with U waves — tempts: "A fused T-U masquerades as long QT — and ALSO promotes torsades. Either way: measure, replete." 
- T-wave abnormality, nonspecific — tempts: "The QT is a number, not a vibe — tangent method, then correct for rate."

**Recording spec:** primary: PTB-XL `scpAny: ["LNGQT"]` (recorded ✓). TdP strip:
`reconstructed` (published torsades run; `TODO(REVIEW): TdP case selection`);
fallback `modeled`.

**Mechanism spec:** `kind: 'authored'` — reason: "repolarization-reserve
pharmacology modeled as its morphology." Long-QT strip: normal beats, T center
+120 ms (QTc ≈ 510 Bazett at RR 800). TdP strip: short-long-short onset (PVC →
compensatory pause → PVC on the T) then 8 polymorphic wide beats with rotating
axis (authored lobes rotating direction ~45°/beat), self-terminating. mustShow:
delayed repolarization (long plateau) · the vulnerable window widening · the
short-long-short trigger · the twisting axis. primaryLead: `II`.

**WHY**
1. "QT-blocking drugs narrow repolarization reserve — the plateau stretches."
2. "A long QT widens the vulnerable window; an early beat can land inside it."
3. "Short-long-short, then the axis twists around the baseline: torsades de pointes."

**PILLS**
- pearl: "Measure, don't glance: tangent method, longest of II/V5; use Fridericia at fast or slow rates (Bazett over-corrects tachycardia). QTc ≥500 ms = high-risk territory." `[AHA-QT-2020]`
- trap: "The usual suspects stack: antiemetics, antipsychotics, methadone, macrolides/fluoroquinolones, azoles — plus low K⁺/Mg²⁺ multiplying them."
- night-eye: "Runs of polymorphic VT after pauses on the overnight tele = torsades until proven otherwise — check the QT of the beats between runs."

**SUSPECT & CONFIRM**
- "Audit the med list + K⁺/Mg²⁺/Ca²⁺ in every unexplained long QT or syncope." `[AHA-QT-2020]`

**GUIDELINE MOVES**
- "Stop every QT-prolonging drug; magnesium 2 g IV for torsades — even with a normal level." `[AHA-QT-2020]` `[AHA-ACLS-2020]`
- "Replete K⁺ toward high-normal; recurrent pause-dependent runs → overdrive pacing or isoproterenol." `[AHA-QT-2020]`
- "Sustained/degenerating → defibrillation." `[AHA-ACLS-2020]`

**Assertions:** trace(primary): qtcMs ≥480 (bazett) · qrsMs <120. model(longQT):
qtcMs 490–540 · model(TdP): custom `polymorphic` (QRS axis rotates ≥180° across
the run) · rateBpm(run) 180–260.

---

## 19. `lvh-strain` — LVH with strain (the great mimic)  [P1 · High-risk patterns]

**Tagline:** Big voltages, dramatic ST-T — the pattern that sends clean coronaries to the cath lab.

**SEE IT / commit**
- ✅ LVH with secondary ST-T changes — *(correct)*
- Anterior/lateral ischemia — tempts: "The lateral T inversion is ASYMMETRIC (slow down, quick up) and married to huge voltages — proportionate, secondary."
- Posterior OMI — tempts: "Deep S V1–V3 with STE over them is the discordance of hypertrophy, not mirror-image occlusion." *(links `omi-posterior`)*
- Old infarct — tempts: "No Q waves; the R waves are enormous, not lost."

**Recording spec:** PTB-XL `scpAny: ["LVH"]` + `["STD_","INVT"]` co-labeled,
preview for classic strain; extras: 1 (voltage-only LVH for contrast).

**Mechanism spec:** `kind: 'authored'` — reason: "wall-thickness scaling is
authored (mass ×1.6 on LV sources) with a strain repolarization source; solver
masses are calibrated to normal." Normal activation, LV source mags ×1.6; strain:
T source inverted-lateral (dir away from V5/V6) asymmetric (two lobes: slow
descent, fast return); slight discordant STE over V1–V3's deep S. mustShow: thick
LV wall glowing harder (voltage) · repolarization reversing across the thickened
wall (strain) · the discordance logic shared with LBBB. primaryLead: `V5`.

**WHY**
1. "More muscle, more vector: tall lateral Rs, deep right-precordial Ss."
2. "A thick wall repolarizes inside-out abnormally — the asymmetric 'strain' ST-T follows the voltage, opposite the QRS."
3. "It's the same discordance logic as LBBB: proportionate secondary change, not injury."

**PILLS**
- pearl: "Sokolow–Lyon: S(V1) + R(V5 or V6) ≥35 mm suggests LVH (age >35). Voltage criteria are specific-ish, never sensitive."
- trap: "LVH is a leading driver of false cath-lab activations: STE in V1–V3 over deep S waves is expected discordance. Judge ST against the QRS beneath it."
- night-eye: "Strain T inversion: asymmetric, down-sloping take-off, in the leads with the biggest Rs. Symmetric inversions in modest-voltage leads → think ischemia instead." *(links `wellens`)*

**SUSPECT & CONFIRM**
- "New dramatic ST-T with hypertension history: find an old ECG — stability is the mimic's alibi." `[AHA-ACS-2025]`
- "Echo settles the hypertrophy; the story and serials settle the ischemia." `[AHA-ACS-2025]`

**GUIDELINE MOVES**
- "No acute ECG-directed therapy — manage the blood pressure and the actual complaint." `[AHA-ACS-2025]`

**Assertions:** trace + model: custom `sokolow` (S(V1)+R(V5) ≥3.5 mV) · tPolarity
V5 '−' · stShift V5 '−' · stShift V2 '+' (discordant over deep S) · qrsMs <120.

---

## 20. `brugada` — Brugada pattern, type 1  [P1 · High-risk patterns · LETHAL]

**Tagline:** A coved wave in V1–V2 that marks a sodium-channel disease — found at 3 a.m., often by accident.

**SEE IT / commit**
- ✅ Brugada type 1 — *(correct)*
- RBBB — tempts: "The pseudo-R′ fools everyone — but there's no broad S in I/V6, and the STE coves downward into an inverted T." *(links `rbbb`)*
- Anteroseptal OMI — tempts: "Coved, down-sloping STE limited to V1–V2 without reciprocals — different beast; the story (syncope, fever, family history) decides."
- High lead placement artifact — tempts: "Legitimate suspicion! V1–V2 placed high can manufacture this shape in healthy chests — verify placement before labeling a life." *(links Lab-E)*

**Recording spec:** target `reconstructed` (published type-1 case; `TODO(REVIEW):
Brugada case selection`); fallback `modeled` (port v1 authored morphology).

**Mechanism spec:** `kind: 'authored'` — reason: "RVOT ion-channel gradient is
modeled as its surface morphology." Port v1 brugada beat: normal QRS + RVOT
early-repol source (`pos` high-anterior-right) creating coved STE ≥0.2 mV in
V1–V2 descending into inverted T. mustShow: the RVOT region as the culprit · the
coved ST descending into a negative T · nothing wrong in the rest of the heart.
primaryLead: `V1`.

**WHY**
1. "A sodium-channel defect makes the RV outflow tract repolarize early and unevenly."
2. "V1–V2 sit right on top of it: coved STE ≥2 mm sliding into an inverted T."
3. "The rest of the ECG is normal — the danger hides in two leads."

**PILLS**
- pearl: "Type 1 (coved ≥2 mm, V1–V2, standard or high leads) is the only diagnostic shape; saddleback (type 2) is only a reason to look harder." `[ESC-VA-2022]`
- trap: "Fever unmasks and worsens it — treat fever aggressively and re-record the ECG after."
- night-eye: "Incidental type 1 + syncope or family sudden death = do not discharge from triage; EP consult." `[SHANGHAI-2016]`
- lookalike → Lab-E: "High V1–V2 placement manufactures pseudo-Brugada in healthy patients — check electrode position before the label sticks."

**SUSPECT & CONFIRM**
- "Ask three things: syncope, family sudden death <45, fever with the pattern." `[SHANGHAI-2016]`
- "Confirm placement; repeat with correctly placed (and, in EP hands, high) leads." `[ESC-VA-2022]`

**GUIDELINE MOVES**
- "Symptomatic type 1 → EP referral (ICD discussion); asymptomatic → risk-stratify, avoid provoking drugs, treat fever." `[ESC-VA-2022]`

**Assertions:** model: stShift V1 '+' ≥0.2 · tPolarity V1 '−' · qrsMs <120 ·
custom `covedShape` (monotonic ST descent from J+40 to T nadir in V1).

---

## 21. `wpw` — WPW / pre-excitation  [S · High-risk patterns · LETHAL]

**Tagline:** A bypass wire around the AV node — harmless-looking until AF finds it.

**SEE IT / commit**
- ✅ WPW pattern — *(correct)*
- LBBB — tempts: "Wide-ish, but the PR is SHORT (<120 ms) and the QRS starts with a slur (delta), not a clean block."
- Old inferior MI — tempts: "Negative deltas in III/aVF fake Q waves — the pseudo-infarct trap."
- Normal — tempts: "Subtle pre-excitation hides at rest; the short PR is the tell that survives."

**Recording spec:** PTB-XL `scpAny: ["WPW"]`; extras: 1.

**Mechanism spec:** `kind: 'authored'` — reason: "an accessory pathway is not in
the solver graph." Port v1 wpw beat: short PR, delta lobe (slow early lobe from
the pathway insertion, `pos` lateral base) fusing into normal QRS. mustShow: the
accessory bundle conducting WITHOUT AV delay · ventricle pre-excited at the
pathway insertion (the slurred start) · fusion with the normal route.
primaryLead: `II`.

**WHY**
1. "An accessory pathway skips the AV node — the ventricle starts early (short PR)."
2. "That early start is muscle-to-muscle: slow — the slurred delta wave."
3. "Each QRS is a fusion of pathway and normal conduction — the ratio shifts beat to beat."

**PILLS**
- trap: "AF in WPW: irregular, WIDE, absurdly fast, beat-to-beat shape changes. AV-nodal blockers (adenosine, beta-blocker, calcium-blocker, digoxin) can funnel everything down the pathway → VF. Procainamide or cardiovert." `[ESC-SVT-2019]`
- pearl: "Delta polarity fakes infarcts: negative delta in III/aVF mimics old inferior MI."
- night-eye: "A 'regular SVT' in a known WPW patient may be orthodromic AVRT — narrow, and adenosine is fine THERE. The danger is the irregular wide one."

**SUSPECT & CONFIRM**
- "Short PR + delta on a routine ECG → document it, ask about palpitations/syncope, refer to EP." `[ESC-SVT-2019]`

**GUIDELINE MOVES**
- "Pre-excited AF: unstable → cardioversion; stable → IV procainamide. Avoid AV-nodal blockers." `[ESC-SVT-2019]`
- "Symptomatic WPW → EP study ± pathway ablation." `[ESC-SVT-2019]`

**Assertions:** trace + model: prMs <120 · qrsMs ≥110 · custom `deltaSlur`
(initial 40 ms of QRS slope < half of mid-QRS slope in II).

---

## 22. `svt-avnrt` — SVT (AVNRT)  [S · Rate & rhythm]

**Tagline:** The node chases its own tail — regular, narrow, and P-less at 180.

**SEE IT / commit**
- ✅ AVNRT — *(correct)*
- Sinus tachycardia — tempts: "Sinus accelerates and decelerates; AVNRT switches on and off like a light."
- Atrial flutter 2:1 — tempts: "At ~150 think flutter; at 180+ with zero atrial signs, AVNRT leads." *(links `aflutter`)*
- Atrial fibrillation — tempts: "Metronome-regular — AF never is."

**Recording spec:** PTB-XL `rhythmAny: ["SVTAC","PSVT"]`; preview for a clean
~180/min narrow tachycardia; pseudo-r′ in V1 a bonus.

**Mechanism spec:** `kind: 'authored'` — reason: "nodal micro-reentry is not in
the solver graph; modeled as simultaneous atrial+ventricular firing." Beats RR 330
(~182/min): normal QRS sources + retrograde P lobes placed INSIDE the QRS window
(simultaneous activation → hidden/pseudo-r′). mustShow: the node re-firing itself ·
atria and ventricles activated together (P buried) · the on/off nature.
primaryLead: `V1`.

**WHY**
1. "Two pathways inside the AV node form a tiny loop — it re-excites itself ~180×/min."
2. "Atria and ventricles fire simultaneously — the P hides inside the QRS (or peeks as a pseudo-r′ in V1)."
3. "Loops switch on and off abruptly — the history is as diagnostic as the strip."

**PILLS**
- pearl: "Vagal maneuvers first — a modified Valsalva converts a decent share before any drug." `[ESC-SVT-2019]`
- trap: "Adenosine is for REGULAR narrow (or known-orthodromic) tachycardia. Irregular + wide = never adenosine." *(links `wpw`)*
- night-eye: "Adenosine that 'fails' but briefly unmasks sawtooth just diagnosed flutter." *(links `aflutter`)*

**SUSPECT & CONFIRM**
- "Record the 12-lead DURING tachycardia and the conversion — the strips are the diagnosis." `[ESC-SVT-2019]`

**GUIDELINE MOVES**
- "Vagal maneuvers → adenosine 6 mg rapid push (then 12 mg) → rate-controlling agents; unstable → synchronized cardioversion." `[ESC-SVT-2019]` `[AHA-ACLS-2020]`
- "Recurrent → EP referral (slow-pathway ablation, high cure rate)." `[ESC-SVT-2019]`

**Assertions:** trace + model: rateBpm 160–220 · qrsMs <120 · custom `regularRR`
cv <0.04 · prMs absent.

---

## Lab-E — Electrode Lab teaching content (the hero)

Preset strips (copy verbatim; each ends with "the tell"):

- **V1–V2 too high** (2nd interspace): "High V1–V2 manufacture rSr′ patterns, T inversions — even coved pseudo-Brugada — and can erase septal R waves into a pseudo-septal-infarct. **The tell:** a fully negative P wave in V1 (correctly placed V1 sees a biphasic P); fix the electrodes, repeat." `[BATCHVAROV-2007]`
- **RA↔LA swap**: "Lead I flips upside down, II↔III trade places, aVR and aVL swap — the limb leads scream dextrocardia. **The tell:** the precordial R-progression V1→V6 stays NORMAL. True dextrocardia reverses it (toggle to compare)." `[BATCHVAROV-2007]`
- **RA↔RL swap**: "Lead II records the voltage between two legs — a near-flatline. Any 'lead falls silent' pattern is a cable problem before it is a heart problem. **The tell:** a tiny, noise-level lead II with everything else alive."
- **LA↔LL swap**: "Lead III flips, I↔II trade, aVL↔aVF trade — inferior 'changes' appear from nowhere. **The tell:** compare with any prior ECG; P-wave axis shifts without the patient changing." `[BATCHVAROV-2007]`
- **Limb rotation**: "All six limb leads permute — an instant 'axis deviation + inferior ischemia' phantom. **The tell:** the precordials never got the memo (unchanged)."
- **True dextrocardia** (model only): "Global inversion in I + reversed precordial R-progression (R shrinks V1→V6). **The tell vs RA↔LA:** the chest leads agree with the limb leads only in real dextrocardia."
- **The serial-comparison trap**: "Yesterday's ECG had swapped leads; today's is correct — the 'dynamic change' is fiction. Placement invalidates comparison: when today's ECG surprises you, first ask how it was taken."

Every preset in Real-recording mode carries the Derived badge + one-line
derivation. RL-involving swaps add: "exact up to the two-legs-equipotential
approximation."

---

## Lab-K — HyperK module content (beyond the `hyperk` card)

- Morph chapter label (schema-enforced): **"one possible trajectory — NOT a K→ECG dial."**
  Sub-line: "Another patient walks the same K climb with a different ECG story."
- Gallery banner: **"⚠ The ECG can never rule out hyperkalemia."** `[MONTAGUE-2008]`
- Gallery slots (5) — target morphologies + K bands (human fills
  `reconstructionOf` per slot; until then slots may ship as `modeled` with badge):
  1. K ~6.5 — near-normal trace (the humbling one)
  2. K ~6.8 — textbook tented Ts only
  3. K ~7.0 — bradycardic, wide, junctional, Ps gone ("BRASH-flavored")
  4. K ~7.5 — Brugada-phenocopy STE in V1–V2
  5. K ~8+ — sine wave (peri-arrest)
- Estimate-the-K commit chips: `<5.5` / `5.5–6.4` / `≥6.5` — reveal shows the
  case's measured K + one line: "Same number, different shadow — treat the ECG."
- Closing trigger card: "**Sick + brady + wide + weird → think K⁺. Calcium first.**
  Then shift, then eliminate." `[UKKA-K-2023]` → deep-links to `hyperk` GUIDELINE MOVES.

---

## Packs (`content/packs.ts`)

1. `night-shift` — **Night-shift can't-miss** — "Five reads that cannot wait for
   the morning." Items: `vt-mono`, `avb-3`, `hyperk`, `omi-anterior`, `omi-posterior`.
2. `fool-the-machine` — **Fool-the-machine mimics** — "Where the computer text and
   the truth part ways." Items: `paced-v`, `lvh-strain`, `sgarbossa`, `aflutter`,
   Lab-E (V1–V2-too-high preset deep link).
3. `systemic-window` — **The systemic window** — "The trace reads the blood: K⁺,
   pills, poisons." Items: `hyperk`, `tca`, `longqt`, `dewinter` (the hyperK-vs-
   hyperacute-T contrast closes it).

---

## Review protocol (applies to every card above)

1. Executing agent transcribes → `review.status: 'draft'`.
2. **Pre-sign-off audit** (`03-CONTENT-SYSTEM.md` §6b) runs per card: claims
   ledger extracted, every claim citation-resolved and assertion-covered,
   dual-source verified, four adversarial roles passed in fresh contexts,
   dossier written to `docs/audit/<cardId>.md`. MAJOR findings are fixed and
   re-verified; irreducible disagreements become FLAGs. Only when the dossier
   reaches eligibility (§6b.5) does the tool set `review.auditPassedAt`.
3. Human clinician receives the dossier — a one-page claims table with ≤5
   targeted FLAGs — resolves the flags, spot-checks at will (minutes per card,
   by design), fixes anything found, and sets
   `review: { status: 'signed', reviewer: 'Name, credentials', signedAt: date }`.
   Signing without `auditPassedAt` is rejected by the validator.
4. Any later edit to clinical text resets `status` to `draft` AND voids the
   audit (validator compares a content hash stored at signing — `signedHash` —
   and the dossier's hash).
5. Release gate (M7): every shipped card audited + signed; every `TODO(REVIEW)`
   resolved or the card is excluded from the build (excluding a P0 card fails
   the gate — escalate to the human instead).
