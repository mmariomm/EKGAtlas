# 05 — Milestones

Execute in order. Every task lists its **acceptance** — verify each literally
before moving on. Rules of work: `00-MASTER.md` §5. Screenshots always at 390×844.
∥ marks tasks that may be reordered inside their milestone.

Estimated shape: M0–M3 ≈ half the effort and all of the risk; do not rush them.

---

## M0 — Reset & walking skeleton

Goal: the old app preserved; a new, deployable, installable shell.

1. **Preserve v1.** `git mv src legacy-v1/src && git mv test legacy-v1/test`; add
   `legacy-v1/README.md` ("frozen reference for the v2 rebuild; deleted at M7").
   Exclude `legacy-v1` from `tsconfig.json` and from the Vite build.
   *Acceptance:* `git log --follow legacy-v1/src/engine/synthesize.ts` shows v1
   history; repo builds (empty app OK); `ps-app/` untouched (`git status` clean there).
2. **Scaffold v2 tree** per `01-ARCHITECTURE.md` §2: `src/main.tsx`, `App.tsx`,
   `router.ts` (routes from §8 incl. legacy `?c=` redirect), `styles/tokens.css` +
   `base.css` (tokens from `02-DESIGN.md` §2), empty feature dirs with placeholder
   screens (Library shows "EKG Atlas" + brand line; other routes render their names).
   *Acceptance:* `npm run dev` serves; navigating all routes works; back/forward OK;
   unknown route → `/`.
3. **Tooling.** `npm run check` = `check:types` + `check:engine` (empty passes) +
   `check:content` (empty passes); scripts stubbed in `package.json`; Playwright
   installed with `test/shots.spec.ts` walking `/` (uses the preinstalled Chromium —
   set `executablePath` if the runner lacks a download).
   *Acceptance:* `npm run check` green; `npm run shots` produces `shots/home.png`.
4. **PWA shell.** `vite-plugin-pwa` with manifest (name, portrait, standalone,
   theme `#070a0f`), icons (generate simple waveform-glyph 192/512 + maskable
   PNGs), offline precache of the app shell.
   *Acceptance:* `npm run build && npm run preview`; Lighthouse (mobile) reports
   installable; with DevTools offline, reload still renders the shell.
5. **Deploy check.** `npm run deploy` to the existing Cloudflare target still works
   (do not change `wrangler.jsonc` beyond asset paths if needed).
   *Acceptance:* deployed URL serves the shell (or, if credentials are absent in
   this environment, `wrangler deploy --dry-run` passes and note it in the report).

Commit cadence: one commit per task. Push at milestone end.

---

## M1 — Engine v2 (the physics core)

Goal: electrode-derived leads with v1 fidelity preserved. Pure TS; no UI.

1. **Port** `legacy-v1/src/engine/{vectorMath,types,heartModel,propagate,measure,phases}.ts`
   → `src/engine/` (rename `vectorMath`→`vec`, split `types` into `sources.ts` per
   `01-ARCHITECTURE.md` §4.2, add `pos?` to `Source`). Port `useCardiacClock` →
   `lib/clock.ts` + add `scrubBy`.
   *Acceptance:* `check:types` green.
2. **Electrodes + montage** (`torso.ts`, `electrodes.ts`): positions table,
   torso-surface constraint fn (applies to precordials; limb electrodes are fixed
   snap sites), `Montage`, standard montage, swap helper.
   *Acceptance:* unit checks — every standard precordial lies on the torso
   ellipse (|x²/ax² + z²/az² − 1| < 0.05); swaps produce valid montages.
3. **Forward model** (`synthesize.ts`): φ-per-electrode with `pos` + `R_MIN`,
   lead derivations, `buildSignals(strip, montage)`, `sampleVector`,
   `sampleActivation`, `samplePhase` (port glow logic unchanged).
   *Acceptance:* Einthoven `I+III−II` max abs error <1e−9; `aVR+aVL+aVF` <1e−9.
4. **Calibrate gain G** so solver-NSR R(II) ∈ [0.8, 1.6] mV; re-tune electrode
   positions within ±15% ONLY if needed to restore: rS in V1 · transition V3–V4 ·
   dominant R V6 · aVR negative · axis −30…+90°.
   *Acceptance:* ported v1 morphology assertions pass for solver NSR/RBBB/LBBB/
   anterior-STEMI (adapt v1 `test/engine.test.ts` — keep its netQRS/netST/netT
   helpers, now over montage-derived signals).
5. **Misplacement algebra** (`leads.ts` §4.5): real-signal limb-swap transforms.
   *Acceptance:* the truth table of `01-ARCHITECTURE.md` §4.5 verified numerically
   BOTH on synthesized strips (montage swap vs algebra: identical within 1e−6) and
   symbolically-derived expectations (RA↔LA: `I' = −I` sample-exact, etc.).
6. **Sync** (`sync.ts`): fiducial warp builder + monotonicity guard.
   *Acceptance:* warp of a fabricated annotation is monotonic; out-of-order
   fiducials throw with a message naming the beat index.
7. **Measurement helpers for assertions** (`test/helpers.ts`): implement the
   definitions at the top of `04-CARDS.md` (stShift, tPolarity, rsRatio,
   irregularRR, terminalRaVR, custom check registry).
   *Acceptance:* helpers give sane values on solver NSR (stShift ≈0 ±0.05 mV in
   all leads; tPolarity II '+').

---

## M2 — Recordings pipeline + TraceView

Goal: real PTB-XL strips render beautifully on a phone, annotated and validated.

1. **Pipeline scripts** (`tools/recordings/`): `fetch.py`, `shortlist.py`,
   `preview.py`, `convert.py`, `verify.ts`, `build-modeled.ts`, `manifest.json`
   per `03-CONTENT-SYSTEM.md` §5. Write `specs/<cardId>.json` for all 22 cards
   from the Recording spec blocks in `04-CARDS.md`.
   *Acceptance:* `fetch` verifies checksum; `shortlist nsr` emits candidates;
   `convert` on one record round-trips (JSON → samples match wfdb within 1 LSB);
   `verify` rejects a deliberately-corrupted annotation.
   *Note:* if this environment has no network access to PhysioNet, implement +
   unit-test against 2–3 bundled sample records (wfdb-python can generate
   synthetic .dat/.hea for tests), mark the real fetch as a human/local step, and
   proceed — the pipeline must be ready to run, not necessarily run here.
2. **Annotator** (`tools/annotator/`): local page — load asset, click fiducials,
   keyboard nudge, save JSON, shows `verify` result inline.
   *Acceptance:* annotate a sample NSR asset end-to-end; `verify` passes it.
3. **First assets.** Run the pipeline for `nsr`, `afib`, `lbbb` (human picks per
   §5.2.3 — if no human is available this session, pick the top-scored candidate,
   mark `manifest.json` pick-reason `auto-top-score (pending human curation)`, and
   list it in the milestone report).
   *Acceptance:* 3 assets in `public/recordings/`, each passing `verify` + its
   card's trace assertions; sizes within budget.
4. **TraceView** (`features/trace/`): canvas renderer per `01-ARCHITECTURE.md` §7 —
   calibrated grid, calibration pulse, single/3/12-lead layouts, playhead + comet,
   scrub, pinch-zoom, paper-mode toggle, provenance badge slot.
   *Acceptance:* screenshots of all three layouts on the real `afib` asset at
   390×844; grid math spot-check (10 mm/mV: a 1 mV calibration pulse spans exactly
   2 major boxes; 25 mm/s: one 800 ms RR spans 4 major boxes); 60 fps scrub on
   desktop Chrome DevTools mobile emulation (no dropped-frame warnings in a 5 s
   performance trace).

---

## M3 — Card system (the product spine)

Goal: three pilot cards playable end-to-end: `nsr`, `lbbb`, `afib`.

1. **Schemas + registry** (`content/schema.ts`, `content/guidelines.ts`): transcribe
   from `03-CONTENT-SYSTEM.md` §2 + §4. `check:content` implements every rule in
   §6.3 (dev-mode warnings vs release-mode failures behind a flag).
   *Acceptance:* a deliberately-broken fixture card (missing cite, bad provenance,
   4-line why) produces 3 named errors.
2. **Pilot content**: transcribe `nsr`, `lbbb`, `afib` from `04-CARDS.md` into
   `content/cards/`; wire `content/index.ts` catalog + categories.
   *Acceptance:* `check:content` green; card assertions green against their assets
   (`lbbb` trace assertions run on the real CLBBB recording — if any fails, the
   pick is wrong: re-run shortlist/preview, do NOT loosen the assertion).
3. **Card player** (`features/card/`): pinned TraceView + 5 sections per
   `02-DESIGN.md` §4.2 — commit gate (lock mechanism + name until commit), reveal
   moment, WHY with tappable phase highlight, drawer, pills carousel, cited
   sections with citation sheet, guideline stamp, "pending sign-off" state,
   playback bar, section dots, share (URL with `?s&t`).
   *Acceptance:* Playwright walk: commit wrong → tempts line shows; commit right →
   reveal animates; every section screenshot at 390×844; deep link `/c/lbbb?s=5`
   lands on GUIDELINE MOVES showing the pending-sign-off notice; console clean.
4. **Mechanism integration** (`features/mechanism/`): HeartView port (v1 visuals:
   chambers, wires, wavefront bands, vector arrow + loop trail, blocked-branch
   greying), driven through `sync.ts` warp against the real recording; split
   trace/heart view; `LeadPerspective` panel.
   *Acceptance:* on `lbbb`, pause at the real trace's QRS onset → HeartView shows
   septal activation starting (reversed septum per solver) — verify by eye on the
   screenshot; scrubbing the real trace scrubs the heart with zero drift at
   fiducials (assert `|w(fiducial) − modelFiducial| < 1 ms` in a unit test).
5. **Library screen** (`features/library/`): search, category groups, packs shelf
   (tiles may link to "coming in M6" stubs), lab hero tiles.
   *Acceptance:* screenshot; search "wide" surfaces `lbbb` via aliases; cold load
   → tapping `nsr` → trace visible, measured < 1 s on local preview.

**Gate M3 (the aha check):** hand the build to a human on a phone: from a cold
visit, can they reach a playing real trace and manipulate it (scrub/switch lead)
inside 10 seconds without instruction? If no — fix before M4. Record the result
in the milestone report.

---

## M4 — The hero: Electrode Lab

1. **TorsoBoard** (`features/electrode-lab/`): SVG torso + landmarks, 10 pucks,
   drag with surface constraint, limb-site snapping, preset chips, mode switch
   (Modeled ↔ Real recording), live 3-lead TraceView, <50 ms recompute (memoize
   prepared sources; recompute only moved-electrode projections).
   *Acceptance:* drag V2 up two interspaces on Modeled → visible morphology change
   in V2 trace; perf trace shows recompute <50 ms.
2. **Presets + teaching strips**: all seven from `04-CARDS.md` §Lab-E with verbatim
   copy, Derived badges in Real mode, the dextrocardia compare toggle, the
   serial-comparison trap view.
   *Acceptance:* Playwright asserts per preset in Real mode (on the `nsr` asset):
   RA↔LA → lead I inverted (correlation with −I > 0.99); RA↔RL → lead II RMS <
   15% of baseline lead II RMS; LA↔LL → III inverted; screenshots of each.
3. **Modeled-mode mimics tuning**: high-V1/V2 must show the documented direction
   of change (terminal positivity/rSr′ tendency and reduced initial R). If the
   multi-dipole model refuses after honest tuning of source `pos` (do NOT invent
   sources): stop, report to the human with plots — do not fake it with authored
   morphology overrides.
   *Acceptance:* assertion `highV1TerminalPositivity` (terminal 40 ms mean in
   high-V1 > standard-V1) green, or the documented stop-report exists.
4. **Deep links** (`/lab/electrodes?trace=&swap=`) + Lab tile on home + cross-links
   from `brugada`/`rbbb` cards (when those cards land, M6).
   *Acceptance:* shared link restores exact lab state.

**Gate M4:** the hero demo runs at 60 fps on a phone and every preset teaches its
"tell" in one screen. Human eyeball + screenshot review recorded.

---

## M5 — The systemic window: HyperK module + poisoned traces

1. **HyperK morph + card** (`hyperk`): 4-keyframe authored morph with
   `morphLabel` UI treatment, card content transcribed, assertions green.
2. **Variance gallery + estimate-K game** (`/lab/hyperk`): 5 slots per §Lab-K —
   ship `modeled` badges wherever `reconstructionOf` is still TODO; the game flow
   (commit chip → reveal → lesson) works regardless of tier.
   *Acceptance:* Playwright walk of all 3 chapters; banner always visible in
   gallery; each slot shows its provenance badge; `TODO(REVIEW)` count reported.
3. **`tca` + `longqt` cards**: transcribe content; authored mechanisms per specs
   (terminal-R aVR lobe; TdP rotating-axis run); pipeline `LNGQT` recording for
   the long-QT primary.
   *Acceptance:* card assertions green (incl. `terminalRaVR ≥0.3 mV`,
   TdP `polymorphic` custom); screenshots; `vt-mono` cross-link stubs OK.
4. **Wire the systemic-window pack** (may still stub missing cards).

---

## M6 — Fill to 20 + packs + share loop

1. **Remaining P0 cards** (order: `vt-mono`, `avb-3`, `omi-anterior`,
   `omi-inferior`, `omi-posterior`, `sgarbossa`, `wellens`, `dewinter`, `rbbb`,
   `aflutter`): transcribe content; run pipeline per card spec (human picks where
   possible; auto-top-score + report otherwise); mechanisms per spec (solver where
   specified, authored ports where specified).
   *Acceptance per card:* `check` green (content + assertions on BOTH model and
   shipped trace) + 5-section screenshot set reviewed.
2. **P1 cards**: `paced-v`, `avb-2`, `lvh-strain`, `brugada`.
3. **Packs + pack player** (`features/pack/`): 3 starter packs, progress chrome,
   presenter mode with watermark, per-item commit.
   *Acceptance:* `/p/night-shift` walkable end-to-end; presenter mode reveals
   without commit; share links restore position.
4. **Share loop polish**: share sheet (Web Share API + clipboard fallback) on
   cards/labs/packs; frozen-moment links (`?t=`) verified.
5. **Metrics beacon** (`worker/metrics.ts` + `lib/metrics.ts`): events visit /
   manipulate / commit / share / install; DNT respected.
   *Acceptance:* local worker receives events; no cookies in DevTools; app works
   with the beacon endpoint unreachable.
6. **Offline completeness**: precache manifest includes all shipped assets;
   airplane-mode walkthrough of 3 cards + both labs passes.

---

## M7 — Validation, polish, launch gate

1. **Full battery** (`npm run check:release`): all five checks of
   `03-CONTENT-SYSTEM.md` §6 in release strictness; fix everything it finds.
2. **Rendered-output audit**: `npm run shots` over every card section, every lab
   preset, every pack; human reviews the folder; file issues per finding; fix.
3. **Adversarial content review** (per `03-CONTENT-SYSTEM.md` §6.6): run the four
   roles (criteria auditor · hostile attending · learner-comprehension ·
   consistency auditor) over every shipped card + both labs; log verdicts in
   `docs/rebuild/REPORT.md`; every FAIL fixed or human-overridden by name before
   the gate.
4. **Performance pass**: Lighthouse mobile ≥90 perf; budgets of
   `01-ARCHITECTURE.md` §9 measured and recorded in the report; fix regressions.
5. **A11y pass**: axe scan clean of criticals; keyboard walk of card + labs;
   reduced-motion verified.
6. **About page**: fidelity contract, model-honesty list, provenance explainer,
   licenses/attribution (PTB-XL CC BY 4.0 line + citation), error-channel link +
   SLA, version stamp. `.github/ISSUE_TEMPLATE/content-error.yml` added.
7. **Legacy removal**: delete `legacy-v1/` (after confirming every port task
   referenced it for the last time); final dead-code sweep (`npx knip` or manual).
8. **Launch gate checklist** — ALL must hold; report each with evidence:
   - [ ] Every shipped card: `review.status: 'signed'` (human clinician) — else the card is excluded and, if it was P0, the gate FAILS (escalate; do not ship around it)
   - [ ] Zero `TODO(REVIEW)` in shipped content
   - [ ] Provenance badge visible on every trace in every screenshot
   - [ ] Tier report: ≥12 of shipped cards with `recorded`/`derived` primary; every `modeled`/`reconstructed` correctly badged (list them)
   - [ ] Guideline registry: every entry human-verified during this rebuild (`verifiedAt` set at M3 or later; zero stale failures)
   - [ ] Adversarial content review logged, zero unresolved FAILs
   - [ ] License sign-off (human): PTB-XL usage + attribution page approved
   - [ ] Perf budgets met (numbers recorded) · offline walkthrough green · installable on iOS Safari + Android Chrome (tested)
   - [ ] Metrics events arriving; activation query (≥3 manipulations/session) demonstrably computable
   - [ ] The 10-second aha test passes with a fresh human on a phone
   - [ ] `legacy-v1/` gone; `ps-app/` untouched for the whole branch (`git log --stat -- ps-app/` empty)
9. **Ship**: rewrite the root `README.md` for v2 (what it is, how to run, the
   fidelity contract in brief, content pipeline pointer); deploy; tag `v2.0.0`;
   final push. Complete `docs/rebuild/REPORT.md` with the tier table, gate
   evidence, open P1/stretch items, and the Stage-1 candidates list (occlusion
   sequences, educator collections, case-of-the-week, app-store wrappers) —
   proposals only, nothing started.

---

## Standing orders during any milestone

- A failing card assertion on a REAL recording means the recording pick or the
  annotation is wrong, or the card's claim doesn't hold on that trace — never
  weaken the assertion to pass. Re-curate or escalate.
- Any medical wording not found in `04-CARDS.md` → `TODO(REVIEW)`, never invent.
- Any dependency beyond the approved list → ask the human first.
- Every milestone ends with: `npm run check` green · screenshots reviewed ·
  pushed · a short report appended to `docs/rebuild/REPORT.md` (created at M0).
