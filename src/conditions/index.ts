import { Condition, ConditionCategory } from '../engine/types'
import { nsr } from './nsr'
import { rbbb } from './rbbb'
import { lbbb } from './lbbb'
import { vpcRv } from './vpcRv'
import { SIM_CONDITIONS } from './simulated'

/** The catalog, in display order. */
export const CONDITIONS: Condition[] = [nsr, rbbb, lbbb, vpcRv, ...SIM_CONDITIONS]

export const CONDITION_BY_ID: Record<string, Condition> = Object.fromEntries(
  CONDITIONS.map((c) => [c.id, c]),
)

/** Category order for the grouped picker. */
export const CATEGORY_ORDER: ConditionCategory[] = [
  'Reference',
  'Conduction blocks',
  'Ectopy & arrhythmia',
  'Ischemia & infarction',
  'Electrolyte & toxic',
  'High-risk syncope',
  'Simulated',
]

export const conditionsByCategory = (): { category: ConditionCategory; items: Condition[] }[] =>
  CATEGORY_ORDER.map((category) => ({
    category,
    items: CONDITIONS.filter((c) => c.category === category),
  })).filter((g) => g.items.length > 0)

export const DEFAULT_CONDITION_ID = nsr.id
