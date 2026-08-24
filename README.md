# EKG Atlas

> The ECG is a shadow; everyone is taught to memorize shadows. This app makes
> the object casting them visible — and manipulable.

An interactive, mobile-first ECG atlas for clinicians and learners: **real
recordings** scrub-synced to a **manipulable conduction model**, taught through
commit-before-reveal cards that close into guideline-cited action. Installable
PWA, fully offline after first visit, free.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + engine physics tests + content validation
npm run build      # production build (PWA)
npm run shots      # 390×844 screenshot walk (visual audit)
npm run deploy     # Cloudflare (wrangler)
```

## What's inside

- **20 pattern cards** — see it (commit your read first) · why (≤3 lines +
  drawer) · pills · suspect & confirm · guideline moves (rendered only after a
  named clinician signs the card). Real PTB-XL recordings wherever the data
  supports the teaching; honest "Modeled" badges where it doesn't.
- **The Electrode Lab** — drag electrodes on a torso and watch every lead
  re-derive. Limb-cable swaps run as *exact algebra on real recordings*; chest
  moves run on the physics engine. Seven misplacement mimics, each with its tell.
- **The HyperK Module** — a morph labeled "one possible trajectory — NOT a
  K→ECG dial", a five-patient variance gallery, and the estimate-the-K game.
  The lesson is variance: the ECG can never rule hyperkalemia out.
- **Rounds packs** — 60-second card runs with a presenter mode.

## The truth architecture

Every trace declares its provenance (Recorded / Derived / Reconstructed /
Modeled) in an always-visible badge. Every clinical line carries a citation
into a versioned guideline registry. Every card carries machine-checked
numeric assertions that run in CI against **both** the mechanism model and the
shipped recording — a card that fails does not ship. Therapy content renders
only after named-reviewer sign-off. See `/about` in the app and
`docs/rebuild/` for the full contract, plan, and build/audit report.

## The engine (one idea)

A lead's deflection is the projection of the heart's dipole sources onto that
electrode's viewpoint — so leads are *derived* from electrode positions
(Einthoven/Goldberger/Wilson), the electrode drag is lawful physics, and the
trace and the heart animation can never disagree. A small propagation solver
makes bundle-branch blocks *emerge* from a blocked conduction graph rather
than being drawn. The whole engine is ~1,400 lines with zero runtime
dependencies, calibrated and regression-tested in `test/engine.test.ts`.

Recordings come from **PTB-XL** (PhysioNet), used under CC BY 4.0 — Wagner et
al., *Scientific Data* 2020. The reproducible curation pipeline lives in
`tools/recordings/` (every asset traceable to its source record, parser proven
against per-signal checksums, fiducials auto-delineated, independently
re-detected, and visually audited).

> Educational — never a diagnostic device, never a substitute for clinical
> judgment or local protocol.
