/**
 * Cloudflare Worker beacon endpoint (deployed separately when launch metrics
 * are switched on — see wrangler docs; not wired into the app deploy).
 * POST /e {e, c?, s} → increments counters in Workers Analytics Engine.
 * No cookies, no user identifiers, no IP storage.
 */
export interface Env {
  METRICS?: AnalyticsEngineDataset
}

interface AnalyticsEngineDataset {
  writeDataPoint(input: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void
}

const EVENTS = new Set(['visit', 'manipulate', 'commit', 'share', 'install'])

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/e') {
      return new Response('not found', { status: 404 })
    }
    try {
      const { e, c, s } = (await req.json()) as { e?: string; c?: string; s?: string }
      if (!e || !EVENTS.has(e)) return new Response('bad event', { status: 400 })
      env.METRICS?.writeDataPoint({
        blobs: [e, c ?? '', s ?? ''],
        doubles: [1],
        indexes: [e],
      })
      return new Response('ok', { headers: { 'access-control-allow-origin': '*' } })
    } catch {
      return new Response('bad request', { status: 400 })
    }
  },
}
