# EKG Atlas v2 — Build & Audit Report

Build executed against `docs/rebuild/00–05` (M0–M7 in sequence). This report is
the evidence trail: what shipped, at which provenance tier, what the audits
found, and exactly what still needs the human.

## What shipped

- **20 cards** (all P0 + all P1), each with commit-before-reveal, ≤3-line WHY +
  drawer, color-coded pills, cited SUSPECT & CONFIRM and GUIDELINE MOVES
  (rendered only after sign-off — currently all show "pending expert sign-off"),
  phase chips driven by the recording's own fiducials, lead switching incl.
  full 12-lead, recordings-variance chips, share links.
- **Electrode Lab** (the hero): drag pucks on a torso, seven misplacement
  presets with "the tell", Modeled ↔ Real-recording modes (limb swaps recomputed
  exactly from recorded leads I+II; chest pucks lock with the honest reason),
  dextrocardia compare, the serial-comparison trap.
- **HyperK Module**: five-keyframe morph behind the enforced "one possible
  trajectory — NOT a K→ECG dial" label, five-patient variance gallery +
  estimate-the-K commit game, the calcium-first close.
- **3 rounds packs** with presenter mode; **About** page (fidelity contract,
  tiers, model honesty, registry, error channel); installable **offline PWA**
  (verified airplane-mode walkthrough of cards, labs, packs, about);
  anonymous activation beacon (DNT-respecting, no-op without endpoint).

## CI state

`npm run check`: **60 engine checks + 195 content checks green** (schema, copy
rules, provenance completeness, citation resolution, guideline currency,
per-card numeric assertions on BOTH the mechanism model and the shipped
recording, warp-build for every asset). `RELEASE=1` gate: exactly 20 failures,
all `unsigned card at release gate` — the one intentionally-human blocker.
Initial JS 68 KB gz (budget 180). Precache 4.5 MB / 57 entries.

## Provenance tier table (the truth inventory)

| Card | Primary | Tier |
|---|---|---|
| nsr | PTB-XL ecg 3 (+24 variance) | recorded |
| afib | ecg 330 | recorded |
| aflutter | ecg 23 | recorded |
| vt-mono | vt-model | **modeled** (no sustained VT exists in PTB-XL) |
| paced-v | ecg 1674 | recorded |
| avb-2 | mobitz2-model (+wenckebach) | **modeled** (all 14 PTB-XL 2AVB records are atrial-tach-with-block — probed) |
| avb-3 | ecg 959 | recorded |
| rbbb | ecg 1024 (+621) | recorded |
| lbbb | ecg 338 (+711) | recorded |
| omi-anterior | ecg 414 (+1199) | recorded (genuine acute STE, measured) |
| omi-inferior | omi-inferior-model | **modeled** (all reachable INJIN/INJIL records measure SUBACUTE change — 4 probed, values logged) |
| omi-posterior | ecg 1544 | recorded (mirror in V2, R/S 14) |
| sgarbossa | sgarbossa-model (+real LBBB compare) | **modeled** |
| wellens | ecg 11682 (+18810) | recorded (type-B-like; shallower than classic — reviewer flag) |
| dewinter | dewinter-model | **modeled** (not a PTB-XL label) |
| hyperk | morph + 5-slot gallery | **modeled** (gallery slots pending published-case reconstruction) |
| tca | tca-model | **modeled** |
| longqt | ecg 320 (QTc 533) + TdP model | recorded + modeled companion |
| lvh-strain | ecg 767 (Sokolow 54 mm, strain) (+273) | recorded |
| brugada | brugada-model | **modeled** (not in the PTB-XL label set) |

**13/20 cards carry a recorded/derived primary** (target ≥12 ✓). Every modeled
asset wears its badge; zero misrepresentation. The Electrode Lab's Real mode
adds the `derived` tier live.

## Adversarial audits (requested: usefulness · practical accuracy · value)

### Usefulness ("would a night-shift intern actually reach for this?")
- ✓ Cold visit → real trace playing + scrubbable in two taps; no login, no
  paywall, works offline after first visit.
- ✓ Every card closes into action; packs make it presentable at rounds.
- **U1 (fixed):** lead chips capped at 3 — no 12-lead gestalt view. → Added a
  12-lead toggle on every card.
- **U2 (open, minor):** library rows lack a provenance micro-badge (tier is
  visible on every trace, one tap deep). Next iteration.
- **U3 (open, by plan):** no caliper tool yet (P1 stretch in the plan).

### Practical accuracy ("what would a hostile attending attack?")
- Re-verified the load-bearing numbers a second time: Sgarbossa 5/3/2 + ≥3;
  Smith ST/S ≤ −0.25 (valid in paced); TCA QRS >100 seizures / >160 ms VT,
  terminal aVR R ≥3 mm; calcium-first → shift → eliminate; Mg 2 g for TdP,
  K to high-normal, overdrive/isoproterenol when pause-dependent;
  verapamil-in-VT kill vector; adenosine unmasks (never converts) flutter;
  V7–V9 ≥0.5 mm (1 mm young men); RV-infarct nitrate caution; Sokolow ≥35 mm,
  age >35 caveat; Brugada type 1 coved ≥2 mm ≥1 lead of V1–V2.
- **A4 (fixed):** the flutter card's AF-option feedback said "2:1 flutter is
  metronome-regular" while the anchored recording shows *variable* block —
  a content-vs-anchor contradiction. Reworded to the baseline criterion
  (sawtooth vs static fuzz), 04-CARDS synced.
- **A1 (reviewer flag):** "door-to-balloon ≤90/≤120" is shorthand for the 2025
  guideline's first-medical-contact-to-device framing — reviewer to confirm
  preferred phrasing.
- **A5 (reviewer flag):** lvh-strain record 767 carries a co-label ISC_:100 —
  database ambiguity between strain and ischemia; morphology measured as
  strain (asymmetric, voltage-married); reviewer to confirm the pick.
- Model-scope notes carried on cards and About: simplified distributed T
  (V1 discordance in LBBB asserted on the recording, not the model), paced
  superior axis beyond region-graph resolution, de Winter aVR elevation not
  modeled (taught in the pill), leg electrodes as one inferior pole.

### Value ("is this worth $119/yr against ECG Weekly / Medmastery?")
- The three differentiators all ship and are real, not demos: (1) real
  recordings scrub-synced to a manipulable mechanism, (2) the electrode lab
  with lawful physics in both modes, (3) provenance honesty as UI. None of the
  named competitors has an equivalent of any of the three.
- **V2 (fixed):** the Brugada card now deep-links into the high-V1–V2 lab
  preset (the pseudo-Brugada demonstration) — the cross-sell between library
  and hero was missing.
- **V3 (open):** free tier IS the product at Stage 0 per strategy; no payment
  surface exists (correct for now).

## What needs the human (the deliberate 1%)

1. **Sign the 20 cards** (the pipeline holds them at "pending expert sign-off";
   the dossier flow of 03 §6b is specified — `tools/audit/` extractor remains
   to be built, or sign against this report + the card files directly).
2. **Confirm the recording picks** (all reasons in `tools/recordings/picks.json`;
   the wellens depth and lvh co-label carry explicit flags).
3. **Source published cases** to upgrade the modeled tiers (hyperK gallery ×5,
   VT, TCA, de Winter, Sgarbossa, Brugada) — reconstruction slots are wired.
4. **License sign-off**: PTB-XL CC BY 4.0 usage + attribution page (counsel
   confirmation per strategy).
5. **Real-device pass**: the 10-second aha test + install on iOS Safari and
   Android Chrome (all in-sandbox proxies green).
6. **Deploy**: `npm run deploy` with Cloudflare credentials (dry-run verified).

## Deviations from the plan (all documented inline as they happened)

- Pipeline in pure Node with WFDB-checksum proof (stronger than the planned
  wfdb-python round-trip); auto-delineation + visual audit instead of a
  click-annotator; `@cloudflare/vite-plugin` dropped for plain assets deploy;
  leg electrodes as one electrical pole (01-ARCH §4.1 updated); ST measured at
  the J point (04 updated); `tools/audit/` dossier generator deferred — its
  gating fields (`auditPassedAt`) are enforced by the validator, and this
  report currently serves as the audit record for the human reviewer.

## Stage-1 candidates (proposals only, nothing started)

Occlusion time-evolution sequences · educator collections · case-of-the-week ·
caliper tool · app-store wrappers · reconstruction upgrades above · library
provenance micro-badges · commit-quiz loop instrumentation.
