# 02 — Design System & Screens

Design law: **phone portrait first (390×844 reference), one thumb, one clean depth,
premium clinical calm.** Every UI task's screenshots are reviewed at 390×844 before
it is done. Desktop = the phone layout centered at max-width 480px with breathing
room (a deliberate adaptation; never a redesign).

---

## 1. Feel

Calm, precise, instrument-like — a beautiful piece of medical equipment, not a
gamified quiz app. Dark by default (night-shift and bedside glare); nothing blinks
or bounces; motion always *means* something (the impulse moving, a reveal earned).
Two honest inks everywhere: the trace and the words.

**Brand line** (landing/About, exact copy):
"The ECG is a shadow; everyone is taught to memorize shadows. This app makes the
object casting them visible — and manipulable."

---

## 2. Tokens (`src/styles/tokens.css`)

```css
:root {
  /* surfaces */
  --bg: #070a0f;          /* app background */
  --surface: #0d1219;     /* cards/panels */
  --surface-2: #131a24;   /* raised (sheets, chips) */
  --line: #1f2937;        /* hairlines */
  /* ink */
  --ink: #e8edf4;         /* primary text */
  --ink-2: #9aa7b8;       /* secondary */
  --ink-3: #5c6a7d;       /* tertiary/disabled */
  /* brand + semantics */
  --accent: #35d0a5;      /* brand teal — actions, links, active states */
  --danger: #ef5d6f;      /* lethal/error accents (used sparingly) */
  --warn:   #e8b34b;      /* caution */
  /* cross-modal phase palette (heart glow ↔ trace comet ↔ chips) — from v1 */
  --ph-atria: #4dc3e6;  --ph-av: #e8b34b;  --ph-vent: #ffd166;
  --ph-repol: #a78bfa;  --ph-injury: #ef5d6f;
  /* trace */
  --trace-ink: #dfe7f0;  --grid-minor: #131c28;  --grid-major: #1c2837;
  /* paper theme (toggle in TraceView only): */
  --paper-bg: #fdf6f0;  --paper-grid-minor: #f3d9cf;  --paper-grid-major: #e8b3a4;
  --paper-ink: #1a1d24;
  /* geometry */
  --r-s: 8px; --r-m: 14px; --r-l: 20px;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  --tap-min: 44px;
}
```

Type: `system-ui` stack (`-apple-system, system-ui, "Segoe UI", Roboto, sans-serif`),
`font-variant-numeric: tabular-nums` on all measurements. Scale: 13 (meta), 15
(body), 17 (section body-lede), 20 (card section titles), 24 (card name), 28 (home
greeting). Line-height 1.45 body, 1.2 headings. Weight: 400/600 only.

Contrast: every ink-on-surface pair ≥ 4.5:1 (verify in M7; `--ink-3` is for
disabled states only, never body copy).

**Paper mode:** TraceView-local toggle rendering the classic pink-grid paper look
(tokens above) for print-familiarity; the rest of the UI stays dark. Persisted in
`localStorage`.

---

## 3. Layout rules (one-thumb law)

- Single column, portrait. Content max-width 480px, centered.
- Primary actions (commit buttons, section advance, play/pause) live in the bottom
  40% of the viewport; destructive/never actions don't exist.
- Sticky zones: the **trace stays pinned** while card sections change beneath it
  (the learner never loses the tracing); playback control is a floating bottom bar.
- All tap targets ≥ 44×44 px, ≥ 8 px apart. No hover-only affordances; every
  gesture has a visible alternative (scrub ↔ timeline bar; pinch ↔ zoom chip).
- Safe areas respected (`viewport-fit=cover`, `env(safe-area-inset-*)`).

---

## 4. Screens

### 4.1 Library (home, `/`)

Top → bottom:
1. Brand row: waveform glyph + "EKG Atlas" + About link (small).
2. Search field (filters as you type; matches name, aliases, category).
3. **Packs shelf**: horizontally scrollable cards for the 3 starter packs
   ("Night-shift can't-miss", "Fool-the-machine mimics", "The systemic window") +
   the two labs (Electrode Lab, HyperK) styled as hero tiles — the labs ARE the
   demo, keep them above the fold.
4. Card list grouped by category (order in `content/index.ts`): each row = name,
   one-line tagline, danger dot (● red = lethal set), provenance micro-badge,
   right-chevron. Row height ≥ 56px.

Cold start renders instantly from the bundled catalog (no network needed).

### 4.2 Card player (`/c/:cardId`) — the core surface

Structure (vertical): **pinned trace region** (top ~45% of viewport) + **section
area** (bottom ~55%, scrollable) + floating playback bar.

Trace region: TraceView (single lead default per card spec; lead chips to switch;
"12-lead" chip opens full grid as a sheet). Provenance badge always visible.
A small **mechanism toggle** (heart icon) swaps the trace region between
trace-only / split trace+heart / heart-only — split is default on SEE IT reveal.

Sections (advance by scrolling or the bottom-bar "Next"; progress dots 1–5):
1. **SEE IT** — the commit gate. The trace plays; a one-line prompt ("Your read?")
   with 3–5 option chips (single tap = commit). Until commit: no diagnosis name on
   screen (the card header shows the pack/category, not the answer), mechanism
   toggle locked. On commit: ✓/✗ with one-line "why this tempts" for the chosen
   option, the card name reveals, the mechanism unlocks and auto-plays one loop in
   split view. Re-visits show a compact "You read: X ✓" bar with "re-commit".
   Entering from the library the learner already saw the card's name — that is
   fine: the options are deliberately near-neighbor discriminations (written that
   way in `04-CARDS.md`), so the commit still tests recognition, not recall.
   Entering from a pack, the header stays generic and the commit is blind.
2. **WHY** — ≤3 short lines (verbatim from content), each line tappable →
   highlights the corresponding phase window on the trace + heart (the v1
   click-to-explain, folded into WHY). An "explain more" drawer holds the full
   mechanism chain (cause→effect steps) and the axis readout — one clean depth,
   drawer for the curious (must-have 5).
3. **PILLS** — 2–4 swipeable pill cards (trap / lookalike / night-shift eye).
   Lookalike pills deep-link to their partner card.
4. **SUSPECT & CONFIRM** — short checklist layout; citations rendered as small
   `[Name Year]` chips → tap = citation sheet (registry entry + "verified" date).
5. **GUIDELINE MOVES** — 2–3 schematic therapy lines, each with citation chip;
   closes with the fixed line "Verify against your local protocol." and the
   guideline-version stamp. If `reviewStatus !== 'signed'`: the section body is
   replaced by the "Pending expert sign-off" notice (law 4).

Bottom bar: play/pause · speed (0.25/0.5/1×) · loop scrubber (thin) · share (copies
deep link incl. `?t=`) · next-section.

### 4.3 Electrode Lab (`/lab/electrodes`) — the hero

Layout: torso (SVG, front view, subtle anatomical landmarks: clavicles, sternum,
ribs 4–5 intercostal hints) occupying top half; live TraceView (3 configurable
leads, default II, V1, V6) bottom half; the two never overlap.

- Ten electrode pucks (RA/LA/LL/RL + V1–V6), each labeled by its name — clear
  labels beat wire-color trivia; the active puck enlarges under the finger.
- **Drag** any precordial puck → torso constrains it; trace updates live (<50 ms)
  from engine v2 (Modeled mode, badge says so). Limb pucks snap between valid sites
  (shoulders/hips) — dragging RA onto LA's site executes the swap.
- **Preset chips** (the mimic set, each = one tap, works in BOTH modes):
  "V1–V2 too high" · "RA↔LA" · "LA↔LL" · "RA↔RL (flat II)" · "Limb rotation" ·
  "True dextrocardia" (model only) · "Reset".
- **Mode switch**: `Modeled heart` (any manipulation; engine) / `Real recording`
  (limb-cable algebra on a real trace — Derived tier badge; precordial pucks lock
  with a one-line why: "can't re-derive chest leads from a recording — switch to
  the modeled heart to move these").
- Each preset opens a one-line teaching strip + "the tell" (e.g. RA↔LA: "looks like
  dextrocardia — but R-progression V1→V6 is normal; true dextrocardia reverses it",
  with a compare toggle) — content verbatim from `04-CARDS.md` §Lab-E.
- **Serial-comparison trap** button: splits the trace into "yesterday / today"
  (standard vs swapped) to show a pseudo-change. One tap back.

First-visit hint (one line, dismissed forever): "Drag an electrode."

### 4.4 HyperK module (`/lab/hyperk`)

Three chapters in one scrollable screen (chips jump between):
1. **One possible trajectory** — the mechanism morph: a slider labeled
   "one possible trajectory — NOT a K→ECG dial" (label enforced by schema) morphs
   the modeled trace (peaked T → flat P → wide QRS → sine). Badge: Modeled.
2. **The variance gallery** — 5 trace tiles at similar measured K (Reconstructed
   tier, each citing its published case). Banner, always visible:
   "⚠ The ECG can never rule out hyperkalemia."
3. **Estimate the K** — the commit game: for each gallery trace, commit a K range
   chip (<5.5 / 5.5–6.4 / ≥6.5) → reveal actual value + one-line lesson. Ends on
   the trigger card: "sick + brady + wide + weird → think K. Calcium first." →
   links to the hyperk card's GUIDELINE MOVES.

### 4.5 Pack player (`/p/:packId`)

A pack = ordered card refs with a 60-second intent. Player chrome: progress
"2/5", swipe/next between items; each card item = that card's SEE IT (commit
included) plus its single strongest pill, with an "open full card" link; a lab
item renders as a full-screen tile that deep-links into the lab preset. **Presenter mode**
(`?mode=presenter`): reveal-first, big type, tap-advance — for rounds demos; a
"presenting" watermark keeps the commit norm honest.

### 4.6 About / fidelity contract (`/about`)

Plain page: the brand line · how we validate (the pipeline, in learner-readable
lines) · provenance tiers explained · model honesty list (what the model does NOT
do, from `01-ARCHITECTURE.md` §4.8) · guideline registry table (name, year,
verified date) · data licenses + attributions (PTB-XL citation, CC BY 4.0) ·
the permanent education-not-diagnosis disclaimer · version + feedback link
(mailto or repo issues; the community error channel with a stated fix-SLA).

---

## 5. Component inventory (features → components, props sketched)

| Component | Props (core) | Notes |
|---|---|---|
| `TraceView` | `asset \| signals`, `leads`, `layout`, `clock`, `badge`, `onScrub` | canvas; §7 of 01-ARCHITECTURE |
| `HeartView` | `strip`, `clock`, `warp`, `highlight`, `blockedBranches` | port of v1 HeartDiagram visuals; horizontal drag on it scrubs the shared clock (scrub is bidirectional: trace ↔ heart) |
| `LeadPerspective` | `lead`, `strip`, `clock` | shows the lead's viewing axis + live projection (fold of v1 LeadSpace3D into a card-sized panel; opened from lead chips long-press or WHY drawer) |
| `CommitPrompt` | `question`, `options`, `committed`, `onCommit` | chips; disabled after commit |
| `PillCarousel` | `pills` | horizontal snap scroll |
| `CitationChip` / `CitationSheet` | `citeKey` | reads registry |
| `ProvenanceBadge` | `provenance` | never optional on a trace |
| `GuidelineStamp` | `card` | version + verified date + reviewer |
| `TorsoBoard` | `montage`, `onDrag`, `mode`, `presets` | SVG, electrode lab |
| `PlaybackBar` | `clock`, `onShare`, `onNext` | bottom floating |
| `SectionDots` | `current` | 1–5 |
| `PackTile`, `CardRow`, `SearchField`, `Sheet`, `Toast` | — | shell |

---

## 6. Motion

- The impulse/wavefront animation is THE motion identity; UI chrome barely moves.
- Section transitions: 180 ms fade/slide-up, `ease-out`; reveal moment (post-commit)
  gets 320 ms — the one earned flourish.
- `prefers-reduced-motion`: UI transitions off; the cardiac animation itself remains
  (it is content, not decoration) but autoplay pauses at section entry with a
  visible play button.
- Never two simultaneous attention-seekers.

---

## 7. Accessibility

- Semantic landmarks + heading order; every control labelled; chips are buttons.
- Canvas traces get `aria-label` (e.g. "12-lead ECG, atrial fibrillation, recorded")
  and the WHY text serves as the accessible description.
- Focus visible (2px accent ring); logical tab order; sheets trap focus, Esc/swipe-down close.
- Contrast per §2; hit targets per §3; no information by color alone (phase chips
  carry text labels; provenance badges carry words, not just color).

---

## 8. Copy rules

Short lines. Plain words. "Smart intern" register — precise, never chatty, never
scary. Numbers with units, always (mm, ms, mV, mg). No exclamation marks except the
single hyperK banner ⚠ line. UI copy that states clinical fact comes from
`04-CARDS.md`, not improvised (law 3).
