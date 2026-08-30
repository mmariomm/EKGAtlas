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

## Design intent (not yet built)

- Not a separate mode: the existing drill, with a real-strip source and
  **escalating transfer** — early Leitner levels show the canonical strip,
  higher levels draw unseen real strips of the same class.
- "Why" at scale without fabrication: measured findings of THIS strip
  (from the assertion engine) + the card's hand-written class teaching one
  tap away. No generated per-record prose.
- Every answer already lands in analytics as `drill` with correctness — the
  error corpus (which pattern × which real strip × which wrong choice)
  accrues from the first user.
