/** The catalog. Cards are added here as they land; order = library order. */
import { Card, CardCategory, Pack } from './schema'
import { nsr } from './cards/nsr'
import { afib } from './cards/afib'
import { lbbb } from './cards/lbbb'
import { hyperk } from './cards/hyperk'
import { tca } from './cards/tca'
import { longqt } from './cards/longqt'
import { aflutter } from './cards/aflutter'
import { vtMono } from './cards/vtMono'
import { avb3 } from './cards/avb3'
import { avb2 } from './cards/avb2'
import { rbbb } from './cards/rbbb'
import { omiAnterior } from './cards/omiAnterior'
import { omiInferior } from './cards/omiInferior'
import { omiPosterior } from './cards/omiPosterior'
import { sgarbossa } from './cards/sgarbossa'
import { wellens } from './cards/wellens'
import { dewinter } from './cards/dewinter'
import { pacedV } from './cards/pacedV'
import { lvhStrain } from './cards/lvhStrain'
import { brugada } from './cards/brugada'
import { wpw } from './cards/wpw'
import { leftmain } from './cards/leftmain'
import { svtAvnrt } from './cards/svtAvnrt'
import { hypok } from './cards/hypok'

export const CARDS: Card[] = [
  nsr,
  afib, aflutter, svtAvnrt, vtMono,
  pacedV, avb2, avb3, rbbb, lbbb, wpw,
  omiAnterior, omiInferior, omiPosterior, sgarbossa, wellens, dewinter, leftmain,
  hyperk, hypok, tca, longqt,
  lvhStrain, brugada,
]

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
  {
    id: 'night-shift',
    title: 'Night-shift can’t-miss',
    blurb: 'The reads that cannot wait for the morning.',
    items: [
      { cardId: 'vt-mono' }, { cardId: 'avb-3' }, { cardId: 'hyperk' },
      { cardId: 'omi-anterior' }, { cardId: 'omi-posterior' }, { cardId: 'leftmain' },
    ],
  },
  {
    id: 'fool-the-machine',
    title: 'Fool-the-machine mimics',
    blurb: 'Where the computer text and the truth part ways.',
    items: [
      { cardId: 'paced-v' }, { cardId: 'lvh-strain' }, { cardId: 'sgarbossa' },
      { cardId: 'wpw' }, { cardId: 'aflutter' },
      { labHref: '/lab/electrodes?swap=high-v1v2', title: 'V1–V2 too high — the pseudo-Brugada machine' },
    ],
  },
  {
    id: 'systemic-window',
    title: 'K⁺, pills & poisons',
    blurb: 'The trace reads the blood.',
    items: [
      { cardId: 'hyperk' }, { cardId: 'tca' }, { cardId: 'longqt' }, { cardId: 'dewinter' },
    ],
  },
]

export const PACK_BY_ID: Record<string, Pack> = Object.fromEntries(PACKS.map((p) => [p.id, p]))
