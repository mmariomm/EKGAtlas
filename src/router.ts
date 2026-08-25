/**
 * Minimal History-API router. Pathname decides the screen; each screen owns its
 * own query params (read at mount, written back with replaceState).
 */
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'card'; cardId: string }
  | { name: 'lab-electrodes' }
  | { name: 'lab-hyperk' }
  | { name: 'pack'; packId: string }
  | { name: 'drill' }
  | { name: 'evolution' }
  | { name: 'about' }
  | { name: 'dev-trace' }

/** v1 deep links (?c=<id>) → v2 card routes. Unknown ids land on the library. */
const LEGACY_IDS: Record<string, string> = {
  nsr: 'nsr', rbbb: 'rbbb', lbbb: 'lbbb', hyperkalemia: 'hyperk',
  sgarbossa: 'sgarbossa', 'de-winter': 'dewinter', wellens: 'wellens',
  'posterior-mi': 'omi-posterior', 'sim-stemi-ant': 'omi-anterior',
  brugada: 'brugada', wpw: 'wpw',
}

export const parseRoute = (pathname: string, search: string): Route => {
  const seg = pathname.split('/').filter(Boolean)
  if (seg.length === 0) {
    const legacy = new URLSearchParams(search).get('c')
    if (legacy && LEGACY_IDS[legacy]) return { name: 'card', cardId: LEGACY_IDS[legacy] }
    return { name: 'library' }
  }
  if (seg[0] === 'c' && seg[1]) return { name: 'card', cardId: seg[1] }
  if (seg[0] === 'lab' && seg[1] === 'electrodes') return { name: 'lab-electrodes' }
  if (seg[0] === 'lab' && seg[1] === 'hyperk') return { name: 'lab-hyperk' }
  if (seg[0] === 'p' && seg[1]) return { name: 'pack', packId: seg[1] }
  if (seg[0] === 'drill') return { name: 'drill' }
  if (seg[0] === 'evolution') return { name: 'evolution' }
  if (seg[0] === 'about') return { name: 'about' }
  if (seg[0] === 'dev' && seg[1] === 'trace') return { name: 'dev-trace' }
  return { name: 'library' }
}

let current: Route = parseRoute(window.location.pathname, window.location.search)
const listeners = new Set<() => void>()

const sync = () => {
  current = parseRoute(window.location.pathname, window.location.search)
  listeners.forEach((fn) => fn())
}
window.addEventListener('popstate', sync)

/** Navigate to a new screen (adds a history entry). `search` starts with '?' or is ''. */
export const navigate = (path: string, search = '') => {
  window.history.pushState(null, '', path + search)
  window.scrollTo(0, 0)
  sync()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export const useRoute = (): Route => useSyncExternalStore(subscribe, () => current)

/** Intercept a plain left-click on an <a>; let modified clicks pass through. */
export const linkClick = (path: string, search = '') => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
  e.preventDefault()
  navigate(path, search)
}
