/**
 * Italian card translations. A card appears in Italian only when its file is
 * registered here AND passes the shape check in ../index.ts — never partially.
 */
import { CardI18n } from '../types'
import { nsr } from './nsr'
import { afib } from './afib'
import { vtMono } from './vtMono'
import { lbbb } from './lbbb'
import { omiAnterior } from './omiAnterior'
import { hyperk } from './hyperk'

export const IT_CARDS: Record<string, CardI18n> = {
  nsr,
  afib,
  'vt-mono': vtMono,
  lbbb,
  'omi-anterior': omiAnterior,
  hyperk,
}
