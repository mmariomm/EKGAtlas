/**
 * Per-card translation. Arrays are POSITIONAL — they mirror the English
 * card's arrays index for index, and the content validator fails the build
 * if a length drifts. That keeps a translation from silently attaching a
 * clinical line to the wrong pill after an edit.
 *
 * Untranslated fields are impossible: the type requires all of them, and a
 * card is only offered in a language when its file exists and validates.
 */
export interface CardI18n {
  name: string
  tagline: string
  /** search terms in the target language (added to the English aliases) */
  aliases: string[]
  commitPrompt: string
  /** commit option labels, in card order */
  options: string[]
  /** commit option "tempts" lines, in card order */
  tempts: string[]
  why: string[]
  whyDrawer: { cause: string; effect: string }[]
  /** pill texts, in card order (kind/link stay structural) */
  pills: string[]
  suspectConfirm: string[]
  guidelineMoves: string[]
  rnMoves: string[]
  /** present iff the English card has an avoid line (lethal cards) */
  avoid?: string
  /** present iff the English card has a moduleHref */
  moduleLabel?: string
}
