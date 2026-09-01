/**
 * Anonymous usage metrics — the minimum evidence a product needs about itself:
 * do people come back (retention), and where do they go wrong (correctness).
 *
 * Policy, stated in the About screen: a random install id and first-open day
 * in localStorage, nothing else. No cookies, no personal data, no IP storage
 * server-side; Do Not Track and Global Privacy Control are honored. Sends
 * only in production builds, to the same-origin worker at /api/metrics, and
 * silently never breaks the app.
 */
import { getLang } from './lang'

type MetricEvent = 'visit' | 'manipulate' | 'commit' | 'drill' | 'share' | 'install'

const ENDPOINT =
  (import.meta.env.VITE_METRICS_URL as string | undefined) ??
  (import.meta.env.PROD ? '/api/metrics' : undefined)

const optedOut = (): boolean => {
  try {
    const n = navigator as Navigator & { globalPrivacyControl?: boolean }
    return n.doNotTrack === '1' || n.globalPrivacyControl === true
  } catch {
    return false
  }
}

/** Session nonce: groups one sitting's events, never persisted past the tab. */
const nonce = (() => {
  try {
    let n = sessionStorage.getItem('mx')
    if (!n) {
      n = Math.random().toString(36).slice(2, 10)
      sessionStorage.setItem('mx', n)
    }
    return n
  } catch {
    return 'na'
  }
})()

/** Install identity: random id + first-open time, for D1/D7/D30 curves. */
const ident = (() => {
  try {
    let id = localStorage.getItem('mid')
    if (!id) {
      id = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
      localStorage.setItem('mid', id)
    }
    let first = Number(localStorage.getItem('mday'))
    if (!Number.isFinite(first) || first <= 0) {
      first = Date.now()
      localStorage.setItem('mday', String(first))
    }
    return { id, first }
  } catch {
    return { id: 'na', first: 0 }
  }
})()

const daysSinceInstall = (): number =>
  ident.first > 0 ? Math.max(0, Math.floor((Date.now() - ident.first) / 86_400_000)) : -1

const last: Partial<Record<MetricEvent, number>> = {}

/**
 * Record one event. `c` is context (a card id, a mode); `v` is a value —
 * 1/0 for a correct/wrong commit or drill answer.
 */
export const metric = (e: MetricEvent, c?: string, v?: number): void => {
  if (!ENDPOINT || optedOut()) return
  const now = Date.now()
  if (e === 'manipulate' && now - (last[e] ?? 0) < 10_000) return
  last[e] = now
  if (e === 'visit' && c === undefined) {
    try {
      c = matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'web'
    } catch { /* fine without */ }
  }
  const body = JSON.stringify({
    e, c, v,
    i: ident.id,
    s: nonce,
    d: daysSinceInstall(),
    l: getLang(),
  })
  try {
    if (!navigator.sendBeacon?.(ENDPOINT, body)) {
      fetch(ENDPOINT, { method: 'POST', body, keepalive: true }).catch(() => {})
    }
  } catch {
    /* never let telemetry break the app */
  }
}
