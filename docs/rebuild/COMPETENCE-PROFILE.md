# The competence profile — spec

_2026-08. The app's one defensible asset: a model of what THIS learner is bad
at, accumulated over months. A competitor can clone the app in a fortnight;
they cannot clone three months of your misses. This document specifies it._

## 0. Why this and not something else

The engine, the design and the card text are all copiable. What is not
copiable is the learner's own history inside the app. Two consequences shape
every decision below:

1. **The profile must be worth more the longer you use it.** Anything that
   resets (a cleared browser, a new phone) destroys the moat. Sync is
   therefore not a nice-to-have; it is the feature.
2. **It must say something a person could not say about themselves.** "You've
   done 40 cards" is a counter. "Your ST-segment discrimination is half as
   good as your rhythm discrimination, and posterior OMI is where you lose
   it" is a profile. Only the second earns the name.

## 1. What exists today (the substrate)

`src/lib/progress.ts` already records, per card, in `localStorage['drill:v1']`:

```ts
{ box: 0..4, due: epochMs, seen: n, right: n, wrong: n }
```

plus `localStorage['commit:<cardId>']` (the card's own commit index) and
`role`, `trace-paper`, `coach:*` preferences.

**Gaps that block the profile:** it is device-local (dies with the browser);
it records the *outcome* but not the *confusion* (which wrong answer was
picked), not *when* (no history, only a running total), and not *how long*
the learner took. Those three are exactly what makes a profile diagnostic
rather than a scoreboard.

## 2. Data model

### 2.1 The attempt (new — the atomic record)

Every drill answer and every card commit appends one immutable attempt:

```ts
interface Attempt {
  id: string            // uuid, client-generated (idempotent sync key)
  at: number            // epoch ms
  cardId: string        // the truth
  pickedId: string      // what they answered (=== cardId when right)
  right: boolean
  ms: number            // time from strip render to answer — hesitation is signal
  source: 'drill' | 'card' | 'pack'
  traceId: string       // WHICH exemplar — a card can be easy on one strip, hard on another
  optionIds: string[]   // what they had to choose between (difficulty context)
}
```

Attempts are append-only and never mutated. Everything else is derived. That
choice matters: derived state can be recomputed when the analysis improves,
whereas a running counter has thrown the evidence away.

Retention: cap at ~2000 attempts client-side (~1 year of heavy use), then
roll the oldest into a monthly summary. Never silently drop without summarising.

### 2.2 Derived — per card

```ts
interface CardCompetence {
  cardId: string
  box: number           // Leitner, as today
  due: number
  attempts: number
  accuracy: number      // right / attempts
  recentAccuracy: number// last 5 attempts — trend beats lifetime average
  medianMs: number      // speed at correct answers only
  lastSeen: number
  confusedWith: Record<string, number>  // pickedId → count. THE diagnostic field.
}
```

### 2.3 Derived — per method step (the transferable read)

Every card carries `methodStep` (rate / rhythm / axis / intervals /
morphology / st-t / context — `src/content/method.ts`). Aggregating accuracy
by step is what turns 24 card scores into a statement about *skill*:

```ts
interface StepCompetence {
  step: MethodStepId
  attempts: number
  accuracy: number
  weakestCards: string[]   // the 2–3 dragging this step down
}
```

This is the line no competitor's fresh install can produce: *"rhythm 92%,
ST/T 54% — your eye is fine, your ST discrimination is not."*

### 2.4 Derived — the confusion graph

`confusedWith` across all cards forms a directed graph: which pattern gets
mistaken for which, and how often. It drives three things: what the drill
serves next, what the profile screen names, and (later, at scale) the
aggregate error data we deferred.

## 3. What the profile screen shows

Order matters — it must open with a claim, not a number.

1. **The headline claim** — one sentence generated from the weakest step:
   _"Your rhythm reads are solid. ST/T is where you lose patients."_
   Never shown before ~20 attempts; before that, show honest progress instead
   ("12 more reads and this page can tell you something").
2. **Method-step bars** — the seven steps, accuracy each, weakest first.
   This is the transferable skill view.
3. **Your confusions** — the top 3–5 pairs as sentences:
   _"You called posterior OMI 'LVH with strain' 4 times."_ Each links to both
   cards and offers a drill filtered to that pair.
4. **The lethal set, separately** — cannot-miss accuracy is a different
   number from overall accuracy and must never be averaged into it.
5. **Cadence** — attempts/week, current streak, next review due.
6. **Export** — one tap to JSON. Costs nothing, buys enormous trust, and is
   the honest counterweight to asking someone to make an account.

## 4. Sync (the part that makes it a moat)

**Requirement:** the profile survives a cleared browser, a new phone, and a
change of platform. Anything less and the asset resets.

**Approach: local-first, sync as a mirror.** The app keeps working fully
offline against localStorage; sync pushes attempts and pulls the merged set.
Because attempts are immutable and carry a client-generated uuid, merge is a
union by `id` — no conflict resolution needed, no last-write-wins data loss,
and repeated pushes are idempotent.

**Identity:** email magic-link only. No password to store or leak, no OAuth
dependency, no social identity in a medical context.

**Storage shape (Cloudflare-native, matching the existing deploy):**
D1 for `users` and `attempts`; a Worker exposing `POST /sync` (push new
attempts, return any unseen) behind a signed session cookie.

**Privacy posture — this must be stated in-app, not just here:** attempts
contain card ids and timings only. No patient data ever enters this system,
because the app never touches a patient's ECG. Retention, export and deletion
are one tap each. This is a promise the About page should make explicitly,
in the same voice as the provenance contract.

## 5. Feedback into the drill

The profile is not a read-only trophy shelf. It closes the loop:

- **Weighting** — draw probability rises for cards in a weak method step,
  on top of the existing 3× lethal weight (`LETHAL_WEIGHT`).
- **Confusion pairs** — when a pair dominates, deliberately serve the two
  together as distractors until the learner separates them.
- **Exemplar rotation** — `traceId` on each attempt reveals when someone knows
  the *card's* strip but not the *pattern*; serve the other exemplar.

## 6. Build order

1. `Attempt` recording + local derivation + the profile screen (no accounts).
   Delivers user value immediately and starts accumulating the asset today.
2. Drill weighting from step competence + confusion pairs.
3. Accounts, magic link, D1, `/sync`, export/delete.

Step 1 is worth shipping alone: the profile is useful on one device, and
every day it runs is data that would otherwise be lost.
