/**
 * The translation registry + the localizer.
 *
 * Completeness gate: `localizeCard` returns the English card untouched unless
 * a complete, shape-matching translation exists. Nothing here guesses, falls
 * back per-field, or machine-fills — a clinical line is either translated by
 * a clinician or shown in the original.
 */
import { Card } from '../schema'
import { Lang } from '../../lib/lang'
import { CardI18n } from './types'
import { IT_CARDS } from './it'

const REGISTRY: Record<Lang, Record<string, CardI18n>> = {
  en: {},
  it: IT_CARDS,
}

/** Does the translation exist AND match the English card's shape? */
export const hasTranslation = (card: Card, lang: Lang): boolean => {
  if (lang === 'en') return true
  const tr = REGISTRY[lang]?.[card.id]
  if (!tr) return false
  return (
    tr.options.length === card.seeIt.commit.options.length &&
    tr.tempts.length === card.seeIt.commit.options.length &&
    tr.why.length === card.why.length &&
    tr.whyDrawer.length === card.whyDrawer.length &&
    tr.pills.length === card.pills.length &&
    tr.suspectConfirm.length === card.suspectConfirm.length &&
    tr.guidelineMoves.length === card.guidelineMoves.length &&
    tr.rnMoves.length === card.rnMoves.length &&
    (!card.avoid || !!tr.avoid) &&
    (!card.moduleHref || !!tr.moduleLabel)
  )
}

/**
 * A localized view of the card. Structure, ids, citations and assertions are
 * untouched — only human-readable strings are swapped.
 */
export const localizeCard = (card: Card, lang: Lang): Card => {
  // English is the source: there is nothing to swap, and no registry entry.
  if (lang === 'en' || !hasTranslation(card, lang)) return card
  const tr = REGISTRY[lang][card.id]
  return {
    ...card,
    name: tr.name,
    tagline: tr.tagline,
    aliases: [...card.aliases, ...tr.aliases],
    seeIt: {
      ...card.seeIt,
      commit: {
        prompt: tr.commitPrompt,
        options: card.seeIt.commit.options.map((o, i) => ({
          ...o,
          label: tr.options[i],
          tempts: tr.tempts[i],
        })),
      },
    },
    why: tr.why,
    whyDrawer: tr.whyDrawer,
    pills: card.pills.map((p, i) => ({ ...p, text: tr.pills[i] })),
    suspectConfirm: card.suspectConfirm.map((l, i) => ({ ...l, text: tr.suspectConfirm[i] })),
    guidelineMoves: card.guidelineMoves.map((l, i) => ({ ...l, text: tr.guidelineMoves[i] })),
    rnMoves: card.rnMoves.map((l, i) => ({ ...l, text: tr.rnMoves[i] })),
    avoid: card.avoid && tr.avoid ? { ...card.avoid, text: tr.avoid } : card.avoid,
    moduleHref: card.moduleHref && tr.moduleLabel
      ? { ...card.moduleHref, label: tr.moduleLabel }
      : card.moduleHref,
  }
}

/** Coverage, for the validator and the docs. */
export const translationCoverage = (cards: Card[], lang: Lang) => {
  const done = cards.filter((c) => hasTranslation(c, lang)).map((c) => c.id)
  const missing = cards.filter((c) => !hasTranslation(c, lang)).map((c) => c.id)
  return { done, missing, pct: Math.round((done.length / cards.length) * 100) }
}

export type { CardI18n }
