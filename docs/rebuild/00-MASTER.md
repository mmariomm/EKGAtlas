# EKG Atlas v2 — Master Rebuild Plan

> **"The ECG is a shadow; everyone is taught to memorize shadows. This product makes
> the object casting them visible and manipulable."**

This directory is the complete, self-contained plan to rebuild the EKG Atlas from
scratch as specified in the product strategy (v9). It is written so that an agent
(or developer) can execute it **without inventing anything** — every architectural
decision is made, every schema is given, every card's medical content is authored,
and every milestone has verifiable acceptance criteria.

**Read this file first, fully. Then execute `05-MILESTONES.md` in order.**

---

## 0. The documents

| Doc | What it contains | When to read |
|---|---|---|
| `00-MASTER.md` | This file. Goal, laws, lessons, workflow, definition of done | First, fully |
| `01-ARCHITECTURE.md` | Stack, repo layout, engine v2 spec (with the math), sync spec, routing, PWA, performance budgets | Before M0 |
| `02-DESIGN.md` | Design system, every screen and component, one-thumb rules, motion, accessibility | Before M0, again before M3 |
| `03-CONTENT-SYSTEM.md` | Card/trace/pack schemas, provenance tiers, recordings pipeline, guideline registry, validation battery | Before M2 |
| `04-CARDS.md` | The full authored content of every MVP card + numeric assertions + recording specs | During M3–M6, per card |
| `05-MILESTONES.md` | The ordered build: M0…M7, task by task, with acceptance criteria | Always open |

---

## 1. What we are building (one sentence)

**An installable, offline-capable, mobile-first PWA: an interactive library of ~20
ward-critical ECG patterns anchored to real recordings — scrub the real trace and
the mechanism model together, switch the lead's viewpoint, drag the electrodes
(the hero demo), work the variance-honest hyperkalemia module — every pattern
shipped as a 5-section practical card with commit-before-reveal, plus shareable
60-second rounds packs. Free, fast, beautiful, on your phone.**

The card skeleton (every pattern, every time):
1. **SEE IT** — real trace + the manipulable model, scrub-synced. Commit your read before anything is revealed.
2. **WHY** — the mechanism in ≤3 short lines.
3. **PILLS** — 2–4 real-world tips: the bedside pearl, the trap, the lookalike.
4. **SUSPECT & CONFIRM** — what to suspect clinically + the tests guidelines want.
5. **GUIDELINE MOVES** — first-line therapy in 2–3 schematic lines, cited and versioned, closing with "verify against local protocol."

---

## 2. The laws (non-negotiable, enforced by CI where possible)

These are derived from the strategy's must-haves and death modes. Violating one is
a bug, even if the feature "works."

1. **TRUTH LAW.** Every trace displays its provenance tier (§3 of `03-CONTENT-SYSTEM.md`):
   **Recorded** (real human ECG, source shown) / **Derived** (exact algebra on a real
   recording, e.g. cable swaps) / **Reconstructed** (modeled after a cited published
   case) / **Modeled** (our engine, validated against published criteria). A Modeled
   or Reconstructed trace must NEVER be presented as real. The badge is always visible.
2. **NO DETERMINISTIC LIES.** Mechanism morphs (e.g. rising K⁺) are labeled
   "one possible trajectory," never a level→shape mapping. The hyperK module's whole
   point is variance: the ECG can never rule out hyperkalemia.
3. **NEVER AUTHOR MEDICINE.** The executing agent implements the content in
   `04-CARDS.md` verbatim. If content is missing, ambiguous, or seems wrong: STOP,
   insert `TODO(REVIEW): <question>` in the card file, and continue with other work.
   The release gate fails on any `TODO(REVIEW)`. Do not fill gaps from memory.
4. **GUIDELINE STAMPS + THE 99% AUDIT.** Every SUSPECT & CONFIRM and GUIDELINE
   MOVES line carries a citation key from the guideline registry (name + year,
   rendered in the UI), and every card carries `guidelineVerifiedAt`. Before a
   human ever sees a card, the pre-sign-off audit (`03-CONTENT-SYSTEM.md` §6b)
   must pass: every claim citation-resolved, every threshold assertion-covered,
   dual-source verified, four adversarial roles cleared in fresh contexts.
   Therapy content ships only with `reviewStatus: 'signed'` (a named human
   reviewer confirming an already-eligible dossier — minutes per card, owning
   the last 1%). Unsigned cards render the section as "Pending expert sign-off"
   — they never silently show draft therapy.
5. **EDUCATION, NOT DIAGNOSIS.** No feature accepts or interprets a user's own
   patient ECG. No patient-specific advice, ever (the SaMD line). The disclaimer is
   permanent, and cards close therapy lines with "verify against local protocol."
6. **MOBILE FIRST.** Every screen is designed, built, and tested at 390×844 (portrait)
   before any other size. One-thumb: primary actions in the bottom 40% of the screen.
   Desktop is an adaptation, never the design target.
7. **<10 SECONDS TO FIRST AHA.** Cold visit → manipulating a real trace in ≤2 taps,
   no login, no paywall, no cookie banner (no cookies). Performance budgets in
   `01-ARCHITECTURE.md` §9 are release-blocking.
8. **COMMIT BEFORE REVEAL.** Every card's SEE IT requires a one-tap commit before the
   answer/mechanism is revealed. (Pack "presenter mode" is the only reveal-first surface.)
9. **ONE SOURCE OF TRUTH FOR SYNC.** The heart animation and the trace playhead read
   the same clock. The real recording is never warped; the model warps to the
   recording's annotated fiducials.
10. **`ps-app/` IS OFF-LIMITS.** Never modify, move, rename, or delete anything under
    `ps-app/`. It belongs to another workstream.
11. **NEVER COMMIT RED.** `npm run check` (typecheck + engine tests + content
    validation) must pass before every commit.
12. **NO STAGE-3 INFRASTRUCTURE.** No accounts, no payments, no LMS/SSO, no backend
    beyond static hosting + the anonymous metrics beacon. The data model stays
    event-compatible (see `01-ARCHITECTURE.md` §11) so future institutional needs stay
    cheap — but none of it is built now.

---

## 3. What v1 taught us (the lessons this rebuild encodes)

The current app (preserved during the rebuild at `legacy-v1/`, deleted at M7) was a
successful engine prototype and a failed product shape. Specifics:

**Proven — port it (with the upgrades in `01-ARCHITECTURE.md`):**
- The vector-dipole engine: Gaussian dipole sources → summed V(t) → projected per
  lead. One moving vector drives all 12 leads and the heart glow, so they can never
  disagree. This is the moat; keep the architecture.
- The propagation solver (`engine/propagate.ts`): conduction graph + tissue state →
  emergent BBB/ectopy/ST morphology. Keep as the preferred mechanism generator.
- The imperative shared clock (`useCardiacClock`): 60 fps without React re-renders.
- Canvas trace rendering calibrated by grid box (0.20 s × 0.5 mV), not pixels.
- The machine-checkable assertion harness (`test/engine.test.ts`) — it is the seed of
  the strategy's "encoded diagnostic criteria" validation stage. Extend, never delete.
- The content voice: short lines, mechanism-first, "smart intern" register.

**Failed — do not repeat:**
- **Synthesized-only.** v1 has zero real recordings; the strategy is
  real-recordings-first. Worse, one exemplar per condition teaches each pattern as a
  single deterministic shape — the exact "false deterministic mapping" death mode.
- **Dashboard IA.** v1 is a scrolling stack of panels (readout, legend, systematic
  read, explain). No pedagogic sequence, no commit, no closure into action. The card
  skeleton replaces it.
- **No electrode level.** v1 hard-codes 12 lead axes, so electrode misplacement — the
  hero demo — is unexpressible. Engine v2 models electrodes and derives leads
  (the math is in `01-ARCHITECTURE.md` §4).
- **Truth infrastructure bolted on.** v1 has one disclaimer line and zero citations.
  v2 builds provenance, citations, and versioning into the schema from M2 — they
  cannot be retrofitted honestly.
- **Two mechanism paths half-reconciled.** v1 keeps hand-curated lobes AND solver
  presets for the same conditions. v2 rule: the solver generates mechanism wherever
  it can; hand-authored sources are the exception, tagged `mechanism.kind:
  'authored'` with a one-line reason (e.g. exact mimic morphology beyond solver
  resolution).
- **Desktop-shaped layout drift** (three-column tendencies, hover-dependent
  affordances). v2: portrait cards, touch-native drag, thumb-reach controls.

---

## 4. Scope

**In (MVP):** the card library (P0 = 16 cards, P1 → 20, stretch 22 — see
`04-CARDS.md` §0); the Electrode Lab (drag + misplacement mimics, the hero); the
HyperK module (variance gallery + estimate-the-K commit game); the poisoned-trace
set (TCA, drug-induced long QT); rounds packs (3 starter packs + deep links);
lead-perspective view; installable offline PWA; provenance + guideline
infrastructure; the "How we validate" page; anonymous activation metrics.

**Out (do not build, even if easy):** accounts/login · payments/paywall · generative
simulation · reentry animation · occlusion time-evolution · adaptive engine ·
case bank · CME · exam content · multi-language · desktop-first anything ·
AI-supervision trainer (beyond the paced-misread pearls already in cards) ·
photo-your-ECG · anything institutional (LMS/SSO/SCORM runtime) · native app
wrappers (PWA only at this stage).

If a task seems to require something from the Out list, it's a misreading — re-read
the milestone. If genuinely blocked, stop and ask the human.

---

## 5. How to work (the executing agent's contract)

1. Work milestone by milestone (`05-MILESTONES.md`), task by task, in order. Do not
   parallelize across milestones. Tasks within a milestone marked ∥ may be reordered.
2. Before starting a task, re-read its acceptance criteria. Build to them, then
   verify each one literally (run the command, look at the screenshot).
3. `npm run check` green before every commit. Commit per task (or tighter), message
   format: `M<milestone>: <what changed, imperative>` (e.g. `M2: recordings pipeline
   — PTB-XL fetch + convert + fiducial validator`).
4. Push to `claude/ekg-atlas-rebuild-3evnyu` (`git push -u origin <branch>`) at least
   at every milestone boundary.
5. Visual verification is not optional: milestones with UI include a Playwright
   screenshot script (`npm run shots`); look at the images at 390×844 before calling
   a task done.
6. When the plan and reality conflict (an API changed, a dataset moved, a number
   can't be hit), do NOT improvise silently. Prefer: (a) the smallest change that
   preserves the law and the acceptance criterion, documented in the commit message;
   (b) if a law or medical content is involved — stop, `TODO(REVIEW)`, ask the human.
7. Never delete `legacy-v1/` before M7. Never touch `ps-app/`.
8. Medical content flows one way: `04-CARDS.md` → `content/` data files. Transcribe
   exactly (IDs, numbers, citations). The content validator diff-checks required
   fields; it cannot check medicine — that's why transcription must be verbatim.

**Definition of done (every milestone):** all acceptance criteria pass · `npm run
check` green · screenshots reviewed at 390×844 · no `TODO(REVIEW)` introduced
without a note in the milestone report · pushed.

**Definition of done (the rebuild):** the M7 launch-gate checklist in
`05-MILESTONES.md` passes end-to-end.

---

## 6. Death modes → countermeasures (quick map)

| Death mode (strategy §12) | Countermeasure here |
|---|---|
| Passive beauty without manipulation | Commit-before-reveal (law 8); scrub + drag on every card; activation metric counts manipulations |
| Research-grade model instead of teaching model | Engine v2 stays a point/multi-dipole teaching model; no FEM torso; solver resolution documented honestly |
| Authoring bottleneck unplanned | All MVP content pre-authored in `04-CARDS.md`; schema + validator make new cards mechanical |
| Validating storyboards but not rendered output | M7 rendered-output audit: Playwright screenshots of every card diffed + eyeballed |
| Stale guideline content unflagged | Guideline registry with `verifiedAt` + stale audit in `npm run check:content` |
| False deterministic mappings | Law 2; hyperK module is variance-first; morph labels enforced by schema (`morphLabel` required) |
| Desktop-first design | Law 6; screenshots at 390×844 gate every UI task |
| Enterprise before consumer PMF | §4 Out list |
| Stage-3 infrastructure at Stage 0 | Law 12 |
| Hidden physiology error amplified | Numeric assertions per card (in `04-CARDS.md`) run in CI; provenance badges; named-reviewer sign-off for therapy |
| Fabricated "real case" exposed | TRUTH LAW; Recorded tier requires source record ID + license in the asset file; validator enforces |
| Paywall before first aha / slow app | No paywall (law 7); perf budgets release-blocking |
| Drifting into patient-specific interpretation | Law 5 |

---

## 7. Current status

- [x] Strategy fixed (v9, summarized here; the source document is the product owner's)
- [x] v1 audited; lessons encoded (§3)
- [x] Plan authored (docs 00–05)
- [ ] M0 … M7 — see `05-MILESTONES.md`
