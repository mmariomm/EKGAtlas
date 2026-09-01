/**
 * The whole backend: a beacon sink in front of the static assets.
 *
 * POST /api/metrics accepts a small JSON event (or array of them) from
 * src/lib/metrics.ts and writes each to Workers Analytics Engine. Everything
 * else falls through to the built SPA. The endpoint always answers 204 —
 * telemetry must never surface an error into the app — and stores nothing
 * that identifies a person: no IPs, no cookies, no user agents.
 *
 * Data point shape (keep in sync with src/lib/metrics.ts):
 *   index1  install id (random, client-generated)
 *   blob1   event name        blob2  context (card id, 'pwa'/'web', …)
 *   blob3   language          blob4  session nonce
 *   double1 value (1/0 correct, ms, …)   double2 days since install
 *
 * SINK: Analytics Engine when the METRICS binding is present, otherwise a
 * structured log line (observability is enabled, so these are queryable in
 * Workers Logs). The binding is deliberately NOT in wrangler.jsonc: it is an
 * account-gated feature, and a missing entitlement fails the whole deploy
 * (workers.api.error.no_access_to_analytics_engine, code 10089). Enable
 * Analytics Engine in the dashboard, then add this back to wrangler.jsonc —
 * no code change needed:
 *   "analytics_engine_datasets": [
 *     { "binding": "METRICS", "dataset": "ekg_atlas_events" }
 *   ]
 * Shipping must never depend on an optional analytics sink.
 */
const num = (x, fallback) => (Number.isFinite(Number(x)) ? Number(x) : fallback)
const str = (x, max) => String(x ?? '').slice(0, max)

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/metrics' && request.method === 'POST') {
      try {
        const text = await request.text()
        if (text.length <= 4096) {
          const parsed = JSON.parse(text)
          for (const ev of (Array.isArray(parsed) ? parsed : [parsed]).slice(0, 25)) {
            if (typeof ev?.e !== 'string' || !ev.e) continue
            const point = {
              indexes: [str(ev.i, 32)],
              blobs: [str(ev.e, 24), str(ev.c, 48), str(ev.l, 8), str(ev.s, 16)],
              doubles: [num(ev.v, 0), num(ev.d, -1)],
            }
            if (env.METRICS) env.METRICS.writeDataPoint(point)
            else console.log(JSON.stringify({ m: 'ekg', ...point }))
          }
        }
      } catch { /* malformed input is dropped, never reported */ }
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    }
    return env.ASSETS.fetch(request)
  },
}
