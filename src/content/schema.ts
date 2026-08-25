/**
 * Content schemas — docs/rebuild/03-CONTENT-SYSTEM.md §2, implemented
 * verbatim. content/ holds DATA ONLY; the validator (test/content.test.ts)
 * enforces every structural rule so truth stays mechanical.
 */
import type { LeadId } from '../engine/leads'
import type { TissueState } from '../engine/propagate'
import type { Source, WirePulse } from '../engine/sources'

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
  /** derived: what transform was applied, e.g. 'limb-cable swap RA↔LA (exact)' */
  derivation?: string
  /** modeled: one-line honest label */
  modelNote?: string
}

export interface CommitOption {
  label: string
  correct?: true
  /** one line: why this option tempts (shown after commit) */
  tempts: string
}

export interface CommitQuestion {
  prompt: string
  options: CommitOption[] // 3–5, exactly one correct
}

export interface CitedLine {
  text: string
  cites: string[] // ≥1 citeKey into the guideline registry
}

export interface MechanismSpec {
  kind: 'solver' | 'authored'
  /** kind solver: the tissue state to simulate */
  state?: TissueState & { rrMs?: number; beats?: number }
  /** kind authored: explicit sources per beat… */
  authoredBeats?: { onsetMs: number; sources: Source[]; wires?: WirePulse[] }[]
  /** …or a named deterministic builder in content/mechanisms.ts */
  authoredId?: string
  /** REQUIRED when kind === 'authored' */
  authoredReason?: string
  /** ≤5 bullets: what the animation must visibly show (shot-audited) */
  mustShow: string[]
  /** default lead for SEE IT + the lead-perspective view */
  primaryLead: LeadId
  /** morphs must carry the honesty label */
  morphLabel?: 'one possible trajectory'
}

export type CardCategory =
  | 'Reference'
  | 'Rate & rhythm'
  | 'Conduction'
  | 'Occlusion & ischemia'
  | 'Systemic window'
  | 'High-risk patterns'

export type PillKind = 'pearl' | 'trap' | 'lookalike' | 'night-eye'

export interface Pill {
  kind: PillKind
  text: string
  linkCardId?: string
}

/** Machine-checkable assertions against the card's traces/mechanism. */
export type CardAssertion =
  | { on: 'model' | 'trace'; check: 'qrsMs'; min?: number; max?: number }
  | { on: 'model' | 'trace'; check: 'prMs'; min?: number; max?: number; absent?: true }
  | { on: 'model' | 'trace'; check: 'qtcMs'; min?: number; max?: number; formula?: 'bazett' | 'fridericia' }
  | { on: 'model' | 'trace'; check: 'rateBpm'; min?: number; max?: number }
  | { on: 'model'; check: 'axisDeg'; min?: number; max?: number }
  | { on: 'model' | 'trace'; check: 'netQrs'; lead: LeadId; sign: '+' | '-' }
  | { on: 'model' | 'trace'; check: 'stShift'; lead: LeadId; sign: '+' | '-'; minMv?: number }
  | { on: 'model' | 'trace'; check: 'tPolarity'; lead: LeadId; sign: '+' | '-' }
  | { on: 'model' | 'trace'; check: 'rsRatio'; lead: LeadId; min?: number; max?: number }
  | { on: 'model' | 'trace'; check: 'irregularRR'; cvMin: number }
  | { on: 'model' | 'trace'; check: 'custom'; name: string; note: string }

export interface Card {
  id: string
  name: string
  aliases: string[]
  category: CardCategory
  lethal: boolean
  tagline: string
  seeIt: {
    traceId: string
    commit: CommitQuestion
    extraTraceIds?: string[]
  }
  why: string[] // 1–3 lines, each ≤110 chars
  whyDrawer: { cause: string; effect: string }[]
  pills: Pill[] // 2–4
  suspectConfirm: CitedLine[] // 1–4
  guidelineMoves: CitedLine[] // 1–3; UI appends the local-protocol close
  /**
   * Nurse-facing action layer (RN mode swaps ONLY section 5): recognize /
   * escalate / anticipate / watch — never prescribing. Same citations,
   * same recognition core; the last mile forks by role. 1–4 lines.
   */
  rnMoves: CitedLine[]
  /** optional promoted link to a lab module (e.g. the HyperK module) */
  moduleHref?: { href: string; label: string }
  mechanism: MechanismSpec
  /** Which step of the reading method (content/method.ts) this card teaches. */
  methodStep: string
  assertions: CardAssertion[]
  guidelineVerifiedAt: string // 'YYYY-MM'
  review: {
    status: 'draft' | 'signed'
    reviewer?: string
    signedAt?: string
    signedHash?: string
    auditPassedAt?: string
  }
}

export interface GuidelineEntry {
  citeKey: string
  title: string
  org: string
  year: number
  scope: string
  url?: string
  verifiedAt: string // 'YYYY-MM'
}

export type PackItem = { cardId: string; pillIndex?: number } | { labHref: string; title: string }

export interface Pack {
  id: string
  title: string
  blurb: string
  items: PackItem[] // 4–6 ≈ 60 seconds
}
