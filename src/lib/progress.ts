/**
 * Learner state: card commits (COMMIT_KEY, owned by CardScreen) + the drill's
 * spaced-repetition ledger, both in localStorage. Mastery is deliberately
 * conservative: 'solid' is earned by spaced retrieval in the drill, never by
 * one lucky commit.
 */
import { CARDS, CARD_BY_ID } from '../content'

export interface DrillCardState {
  /** Leitner box 0–4: miss → 0, hit → +1. */
  box: number
  /** Epoch ms when this card is due again. */
  due: number
  seen: number
  right: number
  wrong: number
}
export type DrillState = Record<string, DrillCardState>

const DRILL_KEY = 'drill:v1'
/** Box → next-review interval. Box 0 re-queues within the session. */
export const BOX_INTERVALS_MS = [0, 1, 3, 7, 16].map((d) => d * 24 * 3600 * 1000)

export const loadDrill = (): DrillState => {
  try {
    return JSON.parse(localStorage.getItem(DRILL_KEY) ?? '{}') as DrillState
  } catch {
    return {}
  }
}

export const saveDrill = (s: DrillState): void => {
  try { localStorage.setItem(DRILL_KEY, JSON.stringify(s)) } catch { /* private mode */ }
}

export const recordDrillAnswer = (cardId: string, right: boolean): DrillState => {
  const s = loadDrill()
  const cur = s[cardId] ?? { box: 0, due: 0, seen: 0, right: 0, wrong: 0 }
  const box = right ? Math.min(4, cur.box + 1) : 0
  s[cardId] = {
    box,
    due: Date.now() + BOX_INTERVALS_MS[box],
    seen: cur.seen + 1,
    right: cur.right + (right ? 1 : 0),
    wrong: cur.wrong + (right ? 0 : 1),
  }
  saveDrill(s)
  return s
}

export type Mastery = 'unseen' | 'shaky' | 'solid'

const committedOn = (cardId: string): boolean => {
  try { return localStorage.getItem(`commit:${cardId}`) != null } catch { return false }
}

export const masteryOf = (cardId: string, drill: DrillState = loadDrill()): Mastery => {
  const d = drill[cardId]
  if (d && d.box >= 3) return 'solid'
  if (d?.seen || committedOn(cardId)) return 'shaky'
  return 'unseen'
}

export interface ProgressSummary {
  total: number
  solid: number
  seen: number
  due: number
}

export const progressSummary = (): ProgressSummary => {
  const drill = loadDrill()
  const now = Date.now()
  let solid = 0
  let seen = 0
  let due = 0
  for (const c of CARDS) {
    const m = masteryOf(c.id, drill)
    if (m === 'solid') solid++
    if (m !== 'unseen') seen++
    const d = drill[c.id]
    if (d && d.due <= now && d.box < 4) due++
  }
  return { total: CARDS.length, solid, seen, due }
}

/**
 * Cannot-miss cards are drawn this many times more often than the rest — the
 * drill's job is the lethal set first; the others keep circulating, just less.
 */
export const LETHAL_WEIGHT = 3

/** Weighted random pick: lethal cards get LETHAL_WEIGHT tickets, others one. */
const weightedPick = (ids: string[]): string => {
  const total = ids.reduce((s, id) => s + (CARD_BY_ID[id].lethal ? LETHAL_WEIGHT : 1), 0)
  let r = Math.random() * total
  for (const id of ids) {
    r -= CARD_BY_ID[id].lethal ? LETHAL_WEIGHT : 1
    if (r <= 0) return id
  }
  return ids[ids.length - 1]
}

/**
 * Pick the next drill card: overdue first (weakest box first, and a lethal
 * card wins any tie), then unseen (lethal-weighted), then the
 * least-recently-scheduled. Excludes `not` (the one just answered) so
 * consecutive draws differ.
 */
export const nextDrillCard = (not?: string): string => {
  const drill = loadDrill()
  const now = Date.now()
  const pool = CARDS.map((c) => c.id).filter((id) => id !== not && CARD_BY_ID[id])
  const lethalFirst = (a: string, b: string) =>
    Number(CARD_BY_ID[b].lethal) - Number(CARD_BY_ID[a].lethal)
  const overdue = pool.filter((id) => drill[id] && drill[id].due <= now).sort(
    (a, b) => (drill[a].box - drill[b].box) || lethalFirst(a, b) || (drill[a].due - drill[b].due),
  )
  if (overdue.length) return overdue[0]
  const unseen = pool.filter((id) => !drill[id])
  if (unseen.length) return weightedPick(unseen)
  // Everything is seen and nothing is due: keep circulating, lethal-weighted,
  // biased toward the cards whose review is closest.
  const soonest = [...pool].sort((a, b) => (drill[a]?.due ?? 0) - (drill[b]?.due ?? 0))
  return weightedPick(soonest.slice(0, Math.max(5, Math.ceil(soonest.length / 2))))
}
