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
import { aflutter } from './aflutter'
import { svtAvnrt } from './svtAvnrt'
import { pacedV } from './pacedV'
import { avb2 } from './avb2'
import { avb3 } from './avb3'
import { rbbb } from './rbbb'
import { wpw } from './wpw'
import { omiInferior } from './omiInferior'
import { omiPosterior } from './omiPosterior'
import { sgarbossa } from './sgarbossa'
import { wellens } from './wellens'
import { dewinter } from './dewinter'
import { leftmain } from './leftmain'
import { hypok } from './hypok'
import { tca } from './tca'
import { longqt } from './longqt'
import { lvhStrain } from './lvhStrain'
import { brugada } from './brugada'

export const IT_CARDS: Record<string, CardI18n> = {
  nsr,
  afib,
  'vt-mono': vtMono,
  lbbb,
  'omi-anterior': omiAnterior,
  hyperk,
  aflutter,
  'svt-avnrt': svtAvnrt,
  'paced-v': pacedV,
  'avb-2': avb2,
  'avb-3': avb3,
  rbbb,
  wpw,
  'omi-inferior': omiInferior,
  'omi-posterior': omiPosterior,
  sgarbossa,
  wellens,
  dewinter,
  leftmain,
  hypok,
  tca,
  longqt,
  'lvh-strain': lvhStrain,
  brugada,
}
