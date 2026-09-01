import { useSyncExternalStore } from 'react'
import { getLang, subscribeLang, Lang } from './lang'

/** Re-render on language change. */
export const useLang = (): Lang => useSyncExternalStore(subscribeLang, getLang, getLang)
