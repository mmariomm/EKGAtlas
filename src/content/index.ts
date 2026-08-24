/** The catalog. Cards are added here as they land; order = library order. */
import { Card, CardCategory, Pack } from './schema'
import { nsr } from './cards/nsr'
import { afib } from './cards/afib'
import { lbbb } from './cards/lbbb'
import { hyperk } from './cards/hyperk'
import { tca } from './cards/tca'
import { longqt } from './cards/longqt'

export const CARDS: Card[] = [nsr, afib, lbbb, hyperk, tca, longqt]

export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]))

export const CATEGORY_ORDER: CardCategory[] = [
  'Reference',
  'Rate & rhythm',
  'Conduction',
  'Occlusion & ischemia',
  'Systemic window',
  'High-risk patterns',
]

export const cardsByCategory = (): { category: CardCategory; items: Card[] }[] =>
  CATEGORY_ORDER.map((category) => ({
    category,
    items: CARDS.filter((c) => c.category === category),
  })).filter((g) => g.items.length > 0)

export const searchCards = (q: string): Card[] => {
  const s = q.trim().toLowerCase()
  if (!s) return CARDS
  return CARDS.filter(
    (c) =>
      c.name.toLowerCase().includes(s) ||
      c.tagline.toLowerCase().includes(s) ||
      c.aliases.some((a) => a.toLowerCase().includes(s)),
  )
}

export const PACKS: Pack[] = [
  // Starter packs land at M6 (night-shift, fool-the-machine, systemic-window).
]

export const PACK_BY_ID: Record<string, Pack> = Object.fromEntries(PACKS.map((p) => [p.id, p]))
