# 03 — Content System: Schemas, Provenance, Recordings Pipeline, Validation

This document makes truth *mechanical*: schemas that force citations and
provenance, a pipeline that turns PhysioNet recordings into app assets with an
audit trail, and a validation battery that blocks release on violations.

---

## 1. Content principles (from the strategy, operationalized)

- The model generates **mechanism, never ground truth**. Ground truth = real
  recordings with source labels, or published cases with citations.
- AI (including the executing agent) is **curator and validator, never author** of
  outcome or therapy claims. All clinical text is transcribed from `04-CARDS.md`
  and gated by human sign-off fields.
- Every therapy/workup claim is **general education about current guidelines** —
  dated, sourced, versioned — never patient-specific advice.

---

## 2. Schemas (`src/content/schema.ts`) — implement verbatim

```ts
import type { LeadId } from '../engine/leads'
import type { TissueState } from '../engine/propagate'
import type { Source } from '../engine/sources'

/** Provenance tiers — the TRUTH LAW's data shape. */
export type ProvenanceTier = 'recorded' | 'derived' | 'reconstructed' | 'modeled'

export interface Provenance {
  tier: ProvenanceTier
  /** recorded/derived: dataset + record id, e.g. 'PTB-XL ecg_id 14493' */
  sourceRecord?: string
  /** recorded/derived: license short name, e.g. 'CC BY 4.0' */
  license?: string
  /** reconstructed: citeKey of the published case it reconstructs */
  reconstructionOf?: string
  /** derived: what transform was applied, e.g. 'limb-cable swap RA<->LA (exact)' */
  derivation?: string
  /** modeled: one-line honest label, e.g. 'Synthesized by the conduction model' */
  modelNote?: string
}
// Validator: recorded/derived REQUIRE sourceRecord+license; reconstructed REQUIRES
// reconstructionOf; modeled REQUIRES modelNote. Extra/missing fields fail the build.

export interface CommitOption {
  label: string           // ≤ 32 chars
  correct?: true
  /** one line: why this option tempts (shown after commit) */
  tempts: string
}
export interface CommitQuestion {
  prompt: string          // usually "Your read?"
  options: CommitOption[] // 3–5, exactly one correct
}

export interface CitedLine {
  text: string            // the schematic line, ≤ 140 chars
  cites: string[]         // ≥1 citeKey into the guideline registry
}

export interface MechanismSpec {
  kind: 'solver' | 'authored'
  /** kind solver: the tissue state to simulate */
  state?: TissueState & { rrMs?: number; beats?: number }
  /** kind authored: explicit sources per beat + why the solver can't express this */
  beats?: { onsetMs: number; sources: Source[] }[]
  authoredReason?: string          // REQUIRED when kind==='authored'
  /** ≤5 bullets: what the animation must visibly show (checked by the shot audit) */
  mustShow: string[]
  /** default lead for SEE IT + the lead-perspective view */
  primaryLead: LeadId
  /** morphs (e.g. hyperK trajectory) must carry the honesty label */
  morphLabel?: 'one possible trajectory'
}

export interface Card {
  id: string                       // stable slug, e.g. 'lbbb'
  name: string
  aliases: string[]                // search terms ('wide QRS', 'left bundle', …)
  category: 'Reference' | 'Rate & rhythm' | 'Conduction' | 'Occlusion & ischemia'
          | 'Systemic window' | 'High-risk patterns'
  lethal: boolean                  // the lethal set → named-reviewer required
  tagline: string                  // one line, library row
  seeIt: {
    traceId: string                // primary TraceAsset (any tier; badge shows)
    commit: CommitQuestion
    extraTraceIds?: string[]       // variance exemplars, browsable after commit
  }
  why: [string] | [string, string] | [string, string, string]   // ≤3 lines, each ≤110 chars
  whyDrawer: { cause: string; effect: string }[]                // the full chain
  pills: { kind: 'pearl'|'trap'|'lookalike'|'night-eye'; text: string; linkCardId?: string }[] // 2–4
  suspectConfirm: CitedLine[]      // 1–4 lines
  guidelineMoves: CitedLine[]      // 1–3 lines; UI appends the local-protocol close
  mechanism: MechanismSpec
  /** numeric truth: encoded diagnostic criteria, run by test/engine.test.ts */
  assertions: CardAssertion[]
  guidelineVerifiedAt: string      // 'YYYY-MM' — when citations were last verified
  review: {
    status: 'draft' | 'signed'
    reviewer?: string              // 'Name, role' — REQUIRED when signed
    signedAt?: string              // 'YYYY-MM-DD'
    /** hash of the clinical text at signing; any later edit → status reverts to draft */
    signedHash?: string
  }
}

/** Machine-checkable assertions against the card's traces/mechanism. */
export type CardAssertion =
  | { on: 'model'|'trace'; check: 'qrsMs';  min?: number; max?: number }
  | { on: 'model'|'trace'; check: 'prMs';   min?: number; max?: number; absent?: true }
  | { on: 'model'|'trace'; check: 'qtcMs';  min?: number; max?: number; formula?: 'bazett'|'fridericia' }
  | { on: 'model'|'trace'; check: 'rateBpm'; min?: number; max?: number }
  | { on: 'model'|'trace'; check: 'axisDeg'; min?: number; max?: number }
  | { on: 'model'|'trace'; check: 'netQrs'; lead: LeadId; sign: '+'|'-' }
  | { on: 'model'|'trace'; check: 'stShift'; lead: LeadId; sign: '+'|'-'; minMv?: number }
  | { on: 'model'|'trace'; check: 'tPolarity'; lead: LeadId; sign: '+'|'-' }
  | { on: 'model'|'trace'; check: 'rsRatio'; lead: LeadId; min?: number; max?: number }
  | { on: 'trace'; check: 'irregularRR'; cvMin: number }         // e.g. AF: RR coefficient of variation
  | { on: 'trace'; check: 'custom'; name: string; note: string } // implemented in test file, named
// 'trace' assertions run on the shipped TraceAsset samples (real data honesty check:
// does the recording actually show what the card teaches?).
// 'model' assertions run on the mechanism strip via engine measure/net helpers (v1 port).

export interface GuidelineEntry {
  citeKey: string      // 'AHA-ACS-2025'
  title: string        // rendered in the citation sheet
  org: string
  year: number
  /** what claims this entry is allowed to back (audit aid) */
  scope: string
  url?: string
  verifiedAt: string   // 'YYYY-MM' — bumped when a human re-checks currency
}

export interface Pack {
  id: string; title: string; blurb: string
  /** 4–6 items ≈ 60 seconds; a lab item renders as a full-screen link tile */
  items: ({ cardId: string; pillIndex?: number } | { labHref: string; title: string })[]
}
```

---

## 3. Provenance tiers (the TRUTH LAW, operational)

| Tier | Meaning | Requirements (validator-enforced) | Badge copy |
|---|---|---|---|
| `recorded` | Real human 12-lead, untouched (resampling/scaling only) | dataset + record id + license; annotation fiducials | "Recorded ECG · PTB-XL" |
| `derived` | Exact algebra applied to a recorded trace (cable swaps, lead recombination) | all of the above + `derivation` string | "Recorded ECG · swap applied" |
| `reconstructed` | Our engine rendering of a *cited published case's* documented findings | `reconstructionOf` citeKey; the cited case's measurements drive assertions | "Reconstruction of a published case" |
| `modeled` | Our engine, validated against published criteria only | `modelNote`; card assertions must cover the claimed criteria | "Modeled — teaching synthesis" |

Escalation rule: prefer the highest achievable tier per card (targets are set per
card in `04-CARDS.md`); never claim a higher tier than the data supports; when a
better source lands later, swapping the asset must not change the card id or URL.

---

## 4. Guideline registry seed (`src/content/guidelines.ts`)

Transcribe these entries (they back the citations used in `04-CARDS.md`). A human
verifies each once during M3 (flip `verifiedAt` to the verification month).
`check:content` fails if any card cites a key missing here, and warns when
`verifiedAt` is older than 18 months (release-blocking at 24).

| citeKey | Title (short) | Org | Year | Scope |
|---|---|---|---|---|
| `AHA-ACS-2025` | ACC/AHA Acute Coronary Syndromes Guideline | ACC/AHA | 2025 | STEMI/OMI reperfusion, ischemia workup |
| `AHA-AF-2023` | ACC/AHA/ACCP/HRS Atrial Fibrillation Guideline | ACC/AHA | 2023 | AF/flutter dx & rate/rhythm/anticoag principles |
| `AHA-BRADY-2018` | ACC/AHA/HRS Bradycardia & Conduction Delay Guideline | ACC/AHA | 2018 | AV blocks, pacing indications |
| `AHA-VA-2017` | AHA/ACC/HRS Ventricular Arrhythmias & SCD Guideline | AHA/ACC | 2017 | VT management, WCT principles |
| `ESC-VA-2022` | ESC Ventricular Arrhythmias & SCD Guideline | ESC | 2022 | VT/Brugada dx criteria & management |
| `ESC-SVT-2019` | ESC Supraventricular Tachycardia Guideline | ESC | 2019 | SVT/WPW management |
| `AHA-ACLS-2020` | AHA ACLS Guidelines (+2023 focused update) | AHA | 2020/23 | arrest & peri-arrest algorithms |
| `AHA-TOX-2023` | AHA Statement: Cardiac Arrest/Life-Threatening Toxicity from Poisoning | AHA | 2023 | TCA/Na-blocker & poisoning moves |
| `UKKA-K-2023` | UK Kidney Association Hyperkalaemia Guideline | UKKA | 2023 | hyperK treatment sequence |
| `AHA-QT-2020` | AHA Statement: Drug-Induced Arrhythmias | AHA | 2020 | QT drugs, TdP prevention/management |
| `SGARBOSSA-1996` | Sgarbossa criteria (GUSTO-1 substudy) | NEJM | 1996 | STEMI-in-LBBB criteria |
| `SMITH-MSC-2012` | Smith-modified Sgarbossa (ST/S ratio) | Ann Emerg Med | 2012 | modified criteria |
| `DEWINTER-2008` | de Winter pattern description | NEJM (letter) | 2008 | LAD-occlusion equivalent |
| `DEZWAAN-1982` | Wellens/de Zwaan pattern description | Am Heart J | 1982 | critical-LAD warning pattern |
| `BOEHNERT-1985` | TCA overdose: QRS duration & risk | NEJM | 1985 | QRS>100 ms seizure / >160 ms VT risk |
| `LIEBELT-1995` | Terminal R in aVR in TCA overdose | Ann Emerg Med | 1995 | aVR R ≥3 mm criterion |
| `MONTAGUE-2008` | ECG sensitivity in hyperkalemia | CJASN | 2008 | "ECG can't rule out" evidence |
| `BATCHVAROV-2007` | Lead misplacement: incidence & effects (review) | Europace | 2007 | misplacement facts/mimics |
| `SHANGHAI-2016` | Brugada diagnostic score (Shanghai) | J Arrhythm/HRS consensus | 2016 | Brugada type 1 dx context |
| `PTBXL-2020` | PTB-XL dataset (Wagner et al., Scientific Data) | PhysioNet | 2020 | recording source attribution |

(If verification finds a newer edition — e.g. a 2026 focused update — the human
updates the entry; the executing agent never bumps years on its own. `TODO(REVIEW)`
if a card seems to conflict with a registry entry.)

---

## 5. Recordings pipeline (`tools/recordings/`)

Goal: PhysioNet → curated, annotated, license-clean `public/recordings/*.json`,
reproducibly. All steps are scripts with a manifest; nothing is hand-edited.

### 5.1 Source

**PTB-XL v1.0.3** (PhysioNet). License: **CC BY 4.0** (attribution required —
rendered on `/about` and in each asset's provenance). ~22k clinical 12-lead ECGs,
10 s, 500 Hz, SCP-ECG statement labels. Confirm-with-counsel note stands in the
strategy: proceed now for build purposes; the M7 launch gate carries a "license
sign-off" checkbox for the human.

Do NOT use MIMIC-IV-ECG in the app (credentialed license — not shippable). It may
inform *reconstructions* authored by the human clinician only.

### 5.2 Steps (each a script, run in order; `manifest.json` records everything)

Python deps pinned in `tools/recordings/requirements.txt` (`wfdb`, `numpy`,
`matplotlib` for contact sheets — exact versions locked at M2).

1. `fetch.py` — download PTB-XL (records500 + `ptbxl_database.csv` + `scp_statements.csv`)
   into `tools/recordings/raw/` (gitignored). Verify checksum.
2. `shortlist.py <cardId>` — reads the card's **recording spec** (from
   `04-CARDS.md`, transcribed into `tools/recordings/specs/<cardId>.json`:
   SCP codes to include/exclude, metadata filters, signal-quality rules) → emits
   `shortlist/<cardId>.csv` (ecg_id, age band, sex, labels) capped at 25 candidates,
   pre-scored: prefer `validated_by_human=True`, no `baseline_drift`/`static_noise`
   flags, age 30–79. No diagnosis-free browsing; the spec drives it.
3. `preview.py <cardId>` — renders each candidate to a PNG contact sheet
   (12-lead, correct aspect) for the **human curator** to pick from. The pick (one
   primary + optional variance extras) is recorded in `picks.json` with a
   one-line reason. THE HUMAN PICKS; the agent only prepares. If no candidate fits,
   the card's fallback tier (per its spec) applies — never force a bad recording.
4. `convert.py` — wfdb → `TraceAsset` JSON: int samples (`unitsPerMv: 200`), all 12
   leads, full 10 s. Auto-fills `provenance` (tier `recorded`, `sourceRecord:
   'PTB-XL ecg_id N'`, `license: 'CC BY 4.0'`).
5. Annotate fiducials — open `tools/annotator/` (local vite page: renders the
   asset, click to place `pOn/qrsOn/qrsOff/tEnd` per beat, arrow keys nudge, saves
   into the asset's `annotation`). Built in M2; the human (or agent, for
   unambiguous strips) annotates; every annotation passes step 6.
6. `verify.ts` — automated cross-check: in-house QRS detector (150 ms
   moving-integral peak method) must agree with each annotated `qrsOn` within
   ±40 ms; RR from annotations vs detector within ±10%; monotonic fiducials; else
   the asset is rejected with a report. Also re-checks asset size budget and that
   every card's `trace` assertions pass on the converted samples.
7. `build-modeled.ts` — for `modeled`/`reconstructed` traces: runs the card's
   `MechanismSpec` through engine v2, emits the same `TraceAsset` shape with the
   right provenance block, and annotation fiducials computed from the model.

Output `public/recordings/` is committed (assets are small, and the app must build
without the 3 GB raw set). `manifest.json` maps every asset → its raw source +
pipeline versions, so any asset can be regenerated.

### 5.3 Recording spec format (`tools/recordings/specs/<cardId>.json`)

```json
{
  "cardId": "lbbb",
  "targetTier": "recorded",
  "include": { "scpAny": ["CLBBB"], "rhythmAny": ["SR"] },
  "exclude": { "scpAny": ["PACE", "AFIB"] },
  "signal": { "minQrsMs": 120 },
  "fallbackTier": "modeled",
  "extras": 2
}
```

The per-card values live in `04-CARDS.md` (Recording spec block) — transcribe them.

---

## 6. Validation battery (`npm run check` = all of these)

1. `check:types` — `tsc --noEmit`.
2. `check:engine` — `test/engine.test.ts`: physics identities (Einthoven, Goldberger
   sum, montage algebra truth table), calibration (NSR R(II) 0.8–1.6 mV), solver
   regressions (v1's NSR/RBBB/LBBB/STEMI checks, ported), **every card's
   `assertions`** (model and trace), sync monotonicity for every annotated asset.
3. `check:content` — schema validation of every card/pack/asset (the Provenance
   rules of §2/§3); every citeKey resolves; every `guidelineMoves`/`suspectConfirm`
   line has ≥1 cite; stale-guideline warnings (>18 mo) and failures (>24 mo);
   `morphLabel` present on any morphing mechanism; `lethal` cards + all cards with
   `guidelineMoves` have `review.status: 'signed'` **at release gate** (dev mode:
   warning); zero `TODO(REVIEW)` at release gate; copy rules (why ≤3×110 chars,
   pill counts, option counts).
4. `check:shots` (M3+) — Playwright walks every card + both labs at 390×844,
   screenshots to `shots/`; fails on console errors or missing provenance badge
   (DOM check); the human eyeballs the folder each milestone (rendered-output
   audit — the death-mode killer).
5. `check:size` (M6+) — build + assert bundle/asset budgets from `01-ARCHITECTURE.md` §9.
6. **Adversarial content review** (M7, procedural — the strategy's multi-role AI
   review): for every shipped card, run a structured review in four roles and
   record verdicts in `docs/rebuild/REPORT.md`; any FAIL blocks release until
   fixed or human-overridden by name:
   - **Criteria auditor** — does every SEE IT/WHY/PILL claim match the cited
     registry entries and the card's numeric assertions? Any number without a
     source or an assertion?
   - **Hostile attending** — what would a skeptical senior clinician attack?
     (edge cases, overclaims, missing dangers, wrong emphasis)
   - **Learner-comprehension check** — can a smart intern read each section once
     and act? Any jargon without definition, any line >2 clauses?
   - **Consistency auditor** — does this card contradict any other card, lab
     strip, or the About page? (e.g. two different thresholds for the same sign)

`npm run check` = 1+2+3 (fast, every commit). `npm run check:release` = 1–5 +
release-mode strictness; stage 6 is run and logged at M7. CI equivalent: run
`check` on every push (a plain npm script is fine; no external CI required for
this plan).

---

## 7. Community error channel (v1 of it)

`/about` links "Report an error" → prefilled GitHub issue template
(`.github/ISSUE_TEMPLATE/content-error.yml`: card id, what's wrong, source). The
page states the SLA: "confirmed clinical errors are corrected or the card is pulled
within 72 h; fixes credit the reporter." M7 adds the template; the SLA is the
human's commitment — do not soften or remove the line.
