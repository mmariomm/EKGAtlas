# 01 — Architecture

Every decision here is made. Implement as written; deviations only per the contract
in `00-MASTER.md` §5.6.

---

## 1. Stack (unchanged where proven, minimal where new)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript 5 (strict) | proven in v1 |
| UI | React 18, no UI framework, hand-written CSS with design tokens | tiny bundle, premium control |
| Build | Vite 6 | proven |
| Hosting | Cloudflare (existing `wrangler.jsonc`, SPA fallback already configured) | proven |
| PWA | `vite-plugin-pwa` (Workbox, `registerType: 'autoUpdate'`) | installable + offline, standard |
| State | React state + the imperative clock; no state library | v1 proved it |
| Routing | Hand-rolled History-API router (~60 lines, spec §8) | 2 route shapes; no dep |
| Trace rendering | Canvas 2D (port of v1 `TraceCanvas` approach) | proven 60 fps on phones |
| Heart/torso rendering | SVG animated imperatively via the clock (port of v1 approach) | proven |
| Tests | `tsx`-run assertion harness (port + extend v1 `test/engine.test.ts`) + content validator (Node) + Playwright screenshots | matches validation pipeline |
| Author tooling (`tools/`) | Node scripts; Python 3 (`wfdb`, `numpy`, `matplotlib`, pinned in `requirements.txt`) only inside `tools/recordings/` | wfdb is the standard PTB-XL reader |
| Analytics | First-party beacon → Cloudflare Worker (counts only; no cookies, no IDs) | Stage-0 gate metrics, privacy-clean |

New runtime dependencies allowed: `vite-plugin-pwa` (dev), `@playwright/test` (dev).
**No other runtime dependency without human approval.** (React + ReactDOM remain the
only ones.)

---

## 2. Repository layout (target state)

```
/                         # repo root = the app (unchanged role)
  docs/rebuild/           # this plan
  docs/audit/             # per-card audit dossiers (03-CONTENT-SYSTEM.md §6b)
  legacy-v1/              # M0 moves current src/ + test/ here; deleted at M7
  ps-app/                 # OFF-LIMITS (other workstream)
  public/
    icons/                # PWA icons (192/512 + maskable)
    recordings/           # built trace assets (JSON; output of tools, committed)
  src/
    main.tsx  App.tsx  router.ts
    styles/               # tokens.css, base.css (design system, see 02-DESIGN.md)
    engine/               # v2 physics core (ported + upgraded, §4)
      vec.ts torso.ts electrodes.ts leads.ts sources.ts synthesize.ts
      heartModel.ts propagate.ts measure.ts phases.ts sync.ts
    content/              # DATA ONLY — no logic
      schema.ts           # all content types (from 03-CONTENT-SYSTEM.md §2)
      guidelines.ts       # the guideline registry
      cards/<cardId>.ts   # one file per card (transcribed from 04-CARDS.md)
      packs.ts            # rounds packs
      index.ts            # catalog + category ordering
    features/
      library/            # home: search, categories, packs shelf
      card/               # the 5-section card player + commit flow
      trace/              # TraceView (real + modeled), scrub, pinch-zoom
      mechanism/          # HeartView, vector arrow, lead-perspective view
      electrode-lab/      # the hero: torso, drag, swap presets, mimics
      hyperk/             # variance gallery + estimate-K game
      pack/               # pack player (incl. presenter mode)
      about/              # fidelity contract page ("How we validate")
    lib/                  # clock, url, storage, metrics beacon, format helpers
  test/
    engine.test.ts        # physics + identities + per-card numeric assertions
    content.test.ts       # schema/citation/provenance/stale-guideline validation
    shots.spec.ts         # Playwright screenshot walk (390×844)
  tools/
    recordings/           # fetch/convert/verify pipeline (03-CONTENT-SYSTEM.md §5)
    annotator/            # local fiducial annotation page (vite root, not shipped)
    audit/                # claims ledger + dossier generator (03-CONTENT-SYSTEM.md §6b)
  worker/metrics.ts       # CF Worker beacon endpoint (counts only)
```

Path alias: none (relative imports, matching v1). File naming: `camelCase.ts`,
components `PascalCase.tsx`.

---

## 3. Data flow (one page)

```
content/cards/*.ts ──┐
                     ├─► catalog (content/index.ts)
content/packs.ts  ───┘         │
                               ▼
public/recordings/*.json ──► TraceAsset loader (lazy, cached by SW)
                               │
       Card player ◄───────────┤
        │   │                  │
        │   ├─ TraceView  ◄── real samples (never modified)
        │   ├─ HeartView  ◄── engine strip (modeled), warped by sync.ts
        │   └─ shared clock (lib/clock.ts) — ONE playhead
        │
Electrode Lab ─► engine v2 (electrodes → leads) for Modeled mode
             ─► lead algebra (leads.ts §5) applied to real samples for Derived mode
```

Rules: `content/` has no logic; `engine/` has no DOM; `features/` never computes
physics (calls `engine/`); recordings are immutable build artifacts (regenerate via
`tools/`, never hand-edit).

---

## 4. Engine v2 — the physics core

Port from `legacy-v1/src/engine/` and upgrade. The upgrade has one purpose: model
**electrodes** so leads are *derived*, which makes the Electrode Lab lawful physics
instead of a trick.

### 4.1 Frame and torso (`vec.ts`, `torso.ts`)

Anatomical frame (unchanged from v1): `x` = patient LEFT, `y` = INFERIOR,
`z` = ANTERIOR. Units: dimensionless torso units; heart center at the origin.

Torso: an upright elliptic cylinder for the trunk (semi-axes `ax = 1.0` left-right,
`az = 0.7` ant-post, vertical range `y ∈ [-1.6 shoulders … +1.6 hips]`), used ONLY to
constrain electrode positions to plausible sites and to draw the torso SVG. The
volume conductor is infinite and homogeneous (§4.3) — the cylinder is not a boundary
condition. This is a teaching model and says so (`about/` page).

Standard electrode positions (constants in `electrodes.ts`; tune only in M1 within
±15% to pass calibration tests). Precordials lie ON the torso ellipse
(`x²/ax² + z²/az² = 1` at their height); the drag constraint projects any dragged
precordial back onto it. Limb electrodes are four FIXED snap sites (shoulders/hips
stand in for arm/leg electrodes — electrically the limb is a wire to its root;
state this on the About page); they are not surface-constrained.

```
RA  [-0.95, -1.35, 0.05]   LA  [ 0.95, -1.35, 0.05]
LL = RL = the inferior pole [0.0, 1.65, 0.05]   (drawn at the hips in the UI)
V1  [-0.22, -0.10, 0.68]   V2  [ 0.22, -0.10, 0.68]
V3  [ 0.45,  0.12, 0.63]   V4  [ 0.65,  0.35, 0.53]
V5  [ 0.85,  0.38, 0.37]   V6  [ 0.98,  0.40, 0.14]
```

**M1 deviation, adopted:** the two leg electrodes share ONE effective electrical
site (the torso's inferior pole). Real legs are near-equipotential because of the
torso boundary — a boundary an infinite-medium dipole model cannot produce — so
the equipotential is encoded as a shared site and declared on the About page.
This makes RL-involving cable swaps exact in the model (matching the recorded
algebra) instead of merely approximate.

### 4.2 Sources (`sources.ts`)

Port v1 `types.ts` (`Source`, `Beat`, `Strip`, glow model) with one addition:

```ts
interface Source {
  dir: Vec3
  mag: number
  center: number      // ms from beat onset
  width: number       // Gaussian σ, ms
  segment: 'P' | 'QRS' | 'ST' | 'T'
  pos?: Vec3          // NEW: dipole origin (defaults to [0,0,0])
  glow?: SourceGlow   // unchanged
}
```

The solver (`propagate.ts`) sets `pos` from its region positions (it already has
them). Hand-authored sources set `pos` when precordial nearness matters (each card's
mechanism spec in `04-CARDS.md` says so).

### 4.3 Forward model (`synthesize.ts`)

Potential at electrode `e` from source `s` at time `t` (point dipole in an infinite
homogeneous conductor, constants folded into one gain):

```
r(e,s)   = e.pos − s.pos                     (Vec3)
φ(e,s,t) = G · mag_s · g(t) · ( d̂_s · r̂ ) / max(|r|², R_MIN²)
```

- `g(t)` = the cyclic Gaussian bell from v1 (`bell(t, onset+center, width, period)`).
- `R_MIN = 0.9` (torso units) — clamps the singularity so a dragged electrode can't
  blow up; keeps precordial-vs-limb proximity ratio realistic.
- `G` — one global gain, calibrated once in M1 so the NSR reference card measures
  R(II) between 0.8 and 1.6 mV. Store as a named constant with the calibration test.

Leads derived from electrode potentials, **always** (never a lead axis table):

```
I = φLA − φRA          II = φLL − φRA         III = φLL − φLA
aVR = φRA − (φLA+φLL)/2    aVL = φLA − (φRA+φLL)/2    aVF = φLL − (φRA+φLA)/2
WCT = (φRA + φLA + φLL)/3
Vi  = φVi − WCT        (i = 1…6)
```

`buildSignals(strip, montage, dt=2ms)` returns per-lead `Float32Array`s, where
`montage` maps recorder inputs → body sites (§4.4). `sampleVector(strip, t)` (the
arrow) is unchanged: the summed dipole moment (positions don't affect the arrow).

**Identity tests (M1, exact to float tolerance):** `I + III === II` ·
`aVR + aVL + aVF === 0` · with all electrodes standard, NSR morphology assertions
from v1 still pass (rS in V1, R in V6, aVR negative, axis −30…+90°) · moving V4 to
V4R (mirror x) flips its QRS polarity for NSR.

### 4.4 Montage and misplacement (`electrodes.ts`)

```ts
type CableId = 'RA'|'LA'|'LL'|'RL'|'V1'|'V2'|'V3'|'V4'|'V5'|'V6'
interface Montage {
  /** body-site position each cable is clipped to */
  site: Record<CableId, Vec3>
}
```

- Standard montage = cable → its own standard site.
- **Limb swap** = permuting the limb entries (e.g. RA↔LA exchanges those two sites).
- **Precordial misplacement** = replacing a Vi site with a dragged position
  (constrained to the torso surface).
- `RL` is the reference/ground: it does not enter any lead formula, **but** a swap
  involving RL means some *other* cable now sits at the RL site — its potential is
  computed from that site like any other. (This is how the RA↔RL swap yields the
  near-flat lead II: II = φ(site of RA cable = right hip) subtracted from φLL — two
  hip sites, nearly equal far-field potentials.)

### 4.5 Lead algebra on REAL recordings (`leads.ts`) — the Derived tier

For a real 12-lead recording we have signals, not potentials. All limb-cable swaps
are still *exactly* computable, because every limb lead is a linear function of the
three limb-electrode potentials, and potential *differences* are fully determined by
leads I and II:

Let `a = φLA − φRA = I` and `b = φLL − φRA = II` (recorded). Then any swapped-lead
signal is a linear combination of `a` and `b`. Precordials shift too, because the
Wilson terminal moves: with a permutation π of {RA,LA,LL}, the new `Vi′ = Vi + (WCT
− WCT′)`, again expressible in `a`, `b`. Implement the general form:

```
φRA ≡ 0 (reference; only differences matter)   φLA = a   φLL = b
after swap π: φ′X = φ at the site cable X now occupies
I′ = φ′LA − φ′RA      II′ = φ′LL − φ′RA     III′ = II′ − I′
aVR′/aVL′/aVF′ per §4.3 formulas             Vi′ = Vi + (WCT − WCT′)
```

Swaps involving **RL** use the stated approximation `φRL ≈ φLL` (the legs are
near-equipotential — the physical reason lead II flattens). The UI labels RL-swaps
"exact to the two-legs-equipotential approximation"; all other swaps are exact.

**Truth table to test against (M4), for the classic swaps (derive, don't trust —
the tests recompute from the algebra and also check these expectations):**

| Swap | Expected signature |
|---|---|
| RA↔LA | I inverted; II↔III exchanged; aVR↔aVL exchanged; aVF unchanged; precordials EXACTLY unchanged (WCT is invariant under permutations of RA/LA/LL) |
| LA↔LL | III inverted; I↔II exchanged; aVL↔aVF exchanged; aVR unchanged; precordials unchanged |
| RA↔LL | II inverted; I↔−III, III↔−I; aVR↔aVF exchanged; aVL unchanged; precordials unchanged |
| RA↔RL | Lead II ≈ flatline (φLL−φRL ≈ 0); I′ ≈ −III; precordials shift by (φRA−φRL)/3 |
| LA↔RL | Lead III ≈ flatline (φLL−φLA′ ≈ 0); I′ ≈ II; precordials shift analogously |
| Clockwise limb rotation | all six limb leads permute/invert per algebra |

Where the table says "compute from the algebra": the test derives the expectation
symbolically from §4.5, then checks the implementation numerically on a real
recording. Do not hand-wave any row.

### 4.6 Solver (`propagate.ts`) and measurements (`measure.ts`)

Port from v1 unchanged in approach; adapt outputs to carry `pos` (region position →
`Source.pos`). Keep the honest scope note: QRS/conduction emerge faithfully; the
T model is simplified (primary + dyssynchrony-secondary). `measure.ts` ports as-is
(rate, PR, QRS, QT/QTc(Bazett), axis) and adds `qtcFridericia` (used by the long-QT
card; Bazett over-corrects at high rates — show both there).

### 4.7 Sync of real trace ↔ model (`sync.ts`) — NEW, the core of SEE IT

A recording's annotation gives per-beat fiducials (times in ms from strip start):

```ts
interface BeatFiducials { pOn?: number; qrsOn: number; qrsOff: number; tEnd?: number }
interface TraceAnnotation { beats: BeatFiducials[]; note?: string }
```

The model strip for the card exposes the same fiducials (computed from its sources
via `phases.ts`). `sync.ts` builds a **piecewise-linear time warp** `w: realMs →
modelMs` with knots at every shared fiducial of every beat (missing fiducials — e.g.
no P in AF — just drop that knot; segments between remaining knots stretch
linearly; between beats, map linearly across the RR).

- The clock runs in REAL-trace time (the recording is the ground truth timeline).
- `HeartView` renders at `w(t)`. The real samples are never resampled or warped.
- Requirement: `w` is monotonic; the builder throws if fiducials are out of order
  (this catches bad annotations at build time, not in front of a learner).
- Modeled-only cards (no recording) run directly on model time; `w = identity`.

### 4.8 What engine v2 explicitly does NOT do

No reentry circuits · no cell-level ionic models · no torso boundary effects ·
no drug-level PK · no beat-to-beat variability synthesis (variance comes from
multiple real/reconstructed exemplars, not noise). Say so on the About page.

**Size budget (hard):** the whole of `src/engine/` stays ≤ ~1,500 lines with
ZERO runtime dependencies. It is a teaching model — one formula, a small graph,
a warp — and its smallness is a feature. Any growth beyond the budget, any new
region, or any physics refinement not named in this document requires human
approval first. "The model could be more realistic" is never, by itself, a
reason to touch it.

---

## 5. The clock (`lib/clock.ts`)

Port v1 `useCardiacClock` unchanged (it is correct): rAF loop, time in a ref,
subscribe API, seek/pause/speed, default speed 0.4×. Add one method:
`scrubBy(dxFraction)` for touch-drag scrubbing (used by TraceView; pauses while
scrubbing, stays paused on release — resume is an explicit tap).

---

## 6. Trace assets (recordings) format

One JSON file per recording at `public/recordings/<traceId>.json`:

```ts
interface TraceAsset {
  id: string                    // 'ptbxl-14493-lbbb' — stable, lowercase
  provenance: Provenance        // 03-CONTENT-SYSTEM.md §3 (tier, source, license, citation)
  fs: number                    // Hz (500 for PTB-XL)
  unitsPerMv: number            // integer scaling, e.g. 200 → sample/200 = mV
  durationMs: number
  leads: Record<LeadId, number[]>  // int arrays, length = fs · duration
  annotation: TraceAnnotation   // §4.7 fiducials
  displayDefaults?: { lead: LeadId; windowMs?: [number, number] }
}
```

Budgets: ≤ 160 KB gzipped per asset (10 s × 500 Hz × 12 int leads fits); total
precache of all MVP assets ≤ 4 MB. Loader: `fetch` + in-memory cache; service
worker precaches the manifest of shipped assets.

Modeled/Reconstructed "assets" use the same shape but are generated at build time
from the card's mechanism spec (`tools/recordings/build-modeled.ts`) so TraceView
has ONE input type. Their `provenance.tier` says what they are (TRUTH LAW).

---

## 7. TraceView requirements (features/trace)

- Diagnostic-honest calibration: 25 mm/s, 10 mm/mV, minor 1 mm / major 5 mm grid
  boxes; calibration by grid box exactly as v1 did. A 1 mV / 200 ms calibration pulse
  glyph is drawn at strip start.
- Layouts: single-lead (card SEE IT default), 3-lead stack, 12-lead (3×4 grid + lead
  II rhythm strip when height allows; on phones 12-lead is a vertically scrollable
  4×(3-abreast) stack).
- Touch: horizontal drag = scrub (through the clock) · pinch = time-zoom (25→50
  mm/s) · tap = pause/play · long-press = caliper (P1 stretch; two draggable
  cursors, Δms + computed rate readout).
- Playhead + phase-colored comet (port v1); provenance badge pinned top-right of
  the trace, always (law 1).
- Performance: static layer offscreen-rendered once per (asset, layout, zoom);
  per-frame work = blit + playhead only (v1 pattern). 60 fps on a 2020 mid-range
  phone with 12 leads visible.

---

## 8. Router and URLs (`router.ts`)

History-API router, ~60 lines, no dependency. Routes:

```
/                     library (home)
/c/:cardId            card player          ?s=1..5 (section) &t=0..1 (frozen playhead)
/lab/electrodes       electrode lab        ?trace=<traceId> &swap=<preset> (deep-linkable state)
/lab/hyperk           hyperK module        ?item=<n>
/p/:packId            pack player          ?i=<index> &mode=presenter
/about                fidelity contract ("How we validate") + licenses/attribution
```

Legacy redirect: `/?c=<id>` → `/c/<mapped id>` (map in `router.ts`; v1 ids that
survive keep their slug). Unknown routes → `/`. Every meaningful UI state above is
URL-representable (the share loop depends on it); state→URL sync is debounced
`replaceState`, navigation is `pushState`.

---

## 9. PWA + performance budgets (release-blocking, verified in M7)

- Installable: manifest (name "EKG Atlas", display `standalone`, portrait,
  theme/background from tokens), icons 192/512 + maskable, iOS meta tags.
- Offline: after first visit, full app + all MVP trace assets + card content work
  with network off (Workbox precache; runtime cache falls back for anything missed).
- Update flow: autoUpdate + a quiet "Updated" toast on next launch (no blocking prompt).
- Budgets (mid-range Android, throttled 4G, Lighthouse mobile):
  - Initial JS ≤ 180 KB brotli; initial CSS ≤ 30 KB.
  - LCP ≤ 2.5 s cold; TTI ≤ 3 s cold; ≤ 1 s warm (SW).
  - Cold visit → first trace manipulation possible in ≤ 10 s including human taps
    (law 7): home renders card list ≤ 2.5 s; tapping a card starts its SEE IT with
    trace visible ≤ 1 s after tap (asset lazy-load overlaps the section intro).
  - 60 fps during playback and drag on the reference device; no long task > 120 ms
    during interaction.
- Code-splitting: routes are lazy; engine + trace renderer in the main chunk
  (needed for first aha); labs and pack player split.

---

## 10. Metrics beacon (Stage-0 gates only)

`worker/metrics.ts`: a Cloudflare Worker `POST /e` accepting
`{e: 'visit'|'manipulate'|'commit'|'share'|'install', c?: cardId}` — increments
counters in Workers Analytics Engine (or KV fallback). No cookies, no user IDs, no
IP storage; respects `navigator.doNotTrack`. Client helper `lib/metrics.ts` fires
and forgets (`sendBeacon` with fetch fallback), batched, silent on failure. The
activation metric = sessions with ≥3 `manipulate` events (computed offline from
counters; a session nonce lives only in `sessionStorage`, never persisted).

---

## 11. Architecture awareness for the future (build NONE of it)

To keep the future institutional option cheap (strategy must-have 9) the shapes
below are respected now — as shapes only:

- Every learner action is already an *event* (`lib/metrics.ts` event names +
  payload) — an xAPI-style mapping would be a translation layer, not a redesign.
- Cards, packs, and commits carry stable string IDs — assignable/reportable later.
- Content is data (`content/`), separable from the app shell — licensable later.

No SCORM, no xAPI endpoint, no SSO, no export UI now.
