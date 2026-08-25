/**
 * Anonymous activation beacon (Stage-0 gates: activation = ≥3 manipulations
 * per session). Counts only: no cookies, no user ids, no IP storage; respects
 * Do Not Track; silently no-ops when no endpoint is configured or reachable.
 * The session nonce lives in sessionStorage only (never persisted).
 */
type MetricEvent = 'visit' | 'manipulate' | 'commit' | 'share' | 'install'

const URL_BASE = import.meta.env.VITE_METRICS_URL as string | undefined

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

const last: Partial<Record<MetricEvent, number>> = {}

export const metric = (e: MetricEvent, c?: string): void => {
  if (!URL_BASE) return
  if (navigator.doNotTrack === '1') return
  const now = Date.now()
  if (e === 'manipulate' && now - (last[e] ?? 0) < 10_000) return
  last[e] = now
  const body = JSON.stringify({ e, c, s: nonce })
  try {
    if (!navigator.sendBeacon?.(`${URL_BASE}/e`, body)) {
      fetch(`${URL_BASE}/e`, { method: 'POST', body, keepalive: true }).catch(() => {})
    }
  } catch {
    /* never let telemetry break the app */
  }
}
