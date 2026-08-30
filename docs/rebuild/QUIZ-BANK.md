# Real-strip quiz bank — measured census (2026-08-30)

Idea: the drill draws **unseen real recordings** of each class instead of the
same canonical strip — recognition of the class, not the exemplar. Source:
PTB-XL (CC BY 4.0, commercial use with attribution), already integrated with
a checksum-verified WFDB reader. `node tools/recordings/census.mjs` reproduces
every number below.

## Census (21,799 records; 16,056 cardiologist-validated)

| Catalog class | Candidates | Validated, dominant ≥80% |
|---|---|---|
| NSR | 9,514 | 7,245 |
| AFib | 1,514 | 994 validated (1,466 carry likelihood 0 — see rule below) |
| MI anterior (old+acute) | 2,830 | 1,119 |
| MI inferior (old+acute) | 3,238 | 788 |
| Ischemic ST-T | 3,002 | 1,350 |
| LVH | 2,132 | 715 |
| RBBB / LBBB | 541 / 536 | 373 / 291 |
| Acute injury ant/inf | 299 / 33 | 190 / 25 |
| Paced | 294 | 94 |
| Long QT | 117 | 69 |
| AFlutter / WPW / SVT | 73 / 79 / 42 | 37 / 26 / 19 |
| AVB II / III | 14 / 16 | 11 / 13 |
| **Brugada, hyperK/hypoK stages, de Winter, Wellens, torsades, posterior OMI** | **no usable codes** | **stay modeled/hand-hunted (provenance tiers already say so)** |

≈ 12,000+ eligible strips (≈5,000 non-normal). At 31 KB gzipped per full
10 s 12-lead record, a 10-question session is ~310 KB.

## Eligibility rule (the truth law applied to labels)

`validated_by_human` AND a per-class **measurement gate** on the raw signal
(the engine's existing assertions: rigidRR, noConsistentP, QRS width, ST
levels, QTc…). Likelihood 0 = "confidence unstated", so the likelihood field
alone must never gate a rhythm class. Labels propose; measurement disposes —
same rule that rejected the false left-main anchors.

## Shipped (2026-08-30) — 94 strips, 15 classes

`node tools/recordings/build-quiz-bank.mjs` builds it: candidates in
signal-quality order → fetch → checksum-verified read → auto-annotate →
independent re-verify → **class measurement gate** → neutral-named asset
(`qs-<ecgId>` — no diagnosis in the filename) + generated manifest
(`src/content/quizBank.gen.ts`) carrying each strip's measured findings.

Final bank (with the imperfect layer, 2026-08-30): 117 strips — nsr 13 ·
afib 13 · lbbb 13 · rbbb 13 · omi-anterior 9 · lvh-strain 9 · aflutter 8 ·
paced-v 8 · longqt 8 · wpw 6 · svt-avnrt 5 · avb-3 5 · avb-2 3 · leftmain 2 ·
wellens 2.

**The imperfect layer**: ~1/3 of each class is deliberately drawn from
records carrying PTB-XL noise annotations (baseline drift, static/muscle
noise, burst artifact, electrode problems) — same diagnostic gates, dirty
signal. The reveal names the imperfection ("Imperfect strip — like real
life: static/muscle noise (I–aVL)"), so artifact becomes content. The
gates that stay strict are about ANSWER UNIQUENESS (regular rhythm for
morphology classes, measured STE for injury) — never about cosmetics.

What the gates caught (kept out of the bank):
- **omi-inferior: 0 shipped.** Every INJIN/INJIL-labeled candidate measured
  flat or negative inferior ST — PTB-XL's inferior-injury labels do not mean
  acute STE on that tracing. The card keeps its canonical strip.
- **AF under LBBB**: an admitted "lbbb" strip measured RR ±23.6% — an
  unlabeled AFib under the block, i.e. two defensible quiz answers. All
  morphology/injury gates now demand a regular rhythm (one strip, one answer).
- **Normal V2–V3 J-point elevation** initially rejected normal hearts;
  the NSR gate now allows the male norm (≤0.25 mV in V1–V3).
- QTc is displayed only where Bazett can be trusted (regular rhythm, narrow
  QRS, no injury current) — except clearly prolonged (≥470 ms) with only
  minor ST shift, where the QT *is* the finding.

Precache discipline: recordings are excluded from the PWA precache
(545 KB shell); each strip is cached the first time the learner meets it.

## Design (as built)

- Not a separate mode: the existing drill, with a real-strip source and
  **escalating transfer** — Leitner box <2 shows the canonical strip; box ≥2
  draws unseen real strips of the same class. A miss resets to the canonical.
- Progression that is earned, never decorative: 10-strip sessions drawn as a
  rhythm strip (upright beat = right, inverted = wrong), an end-of-session
  recap (score, best run, streak, due in 24 h), a daily streak, and a ring on
  the library pips once a card is solid AND right on ≥3 distinct real strips
  ("proven on real ECGs").
- "Why" at scale without fabrication: measured findings of THIS strip
  (from the assertion engine) + the card's hand-written class teaching one
  tap away. No generated per-record prose.
- Every answer already lands in analytics as `drill` with correctness — the
  error corpus (which pattern × which real strip × which wrong choice)
  accrues from the first user.
