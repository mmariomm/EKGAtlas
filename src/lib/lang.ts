/**
 * Language state. Italian is a first-class layer, not a bolt-on: the market
 * wedge is a native-language ECG atlas written to the clinician's own idiom.
 *
 * Rule: a card renders in Italian ONLY when its translation is complete
 * (enforced by the content validator). A half-Italian clinical card is worse
 * than an English one — mixed-language safety copy is how meaning gets lost.
 */
export type Lang = 'en' | 'it'

const KEY = 'lang'

/** The module is imported by the Node-side content validator too. */
const isBrowser = typeof document !== 'undefined'

const detect = (): Lang => {
  if (!isBrowser) return 'en'
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'it' || saved === 'en') return saved
  } catch { /* private mode */ }
  try {
    return navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en'
  } catch {
    return 'en'
  }
}

let current: Lang = detect()
const listeners = new Set<() => void>()

export const getLang = (): Lang => current

export const setLang = (l: Lang): void => {
  if (l === current) return
  current = l
  try { localStorage.setItem(KEY, l) } catch { /* private mode */ }
  if (isBrowser) document.documentElement.lang = l
  listeners.forEach((fn) => fn())
}

export const subscribeLang = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

if (isBrowser) document.documentElement.lang = current
