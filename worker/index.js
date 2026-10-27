/**
 * The Worker's front door. Two tenants, one deploy:
 *   the bridge   PS Assist's end-to-end-encrypted relay and its phone web app
 *                (worker/ponte.js; ps-app/ponte/README.md).
 *   the rest     exactly what it was: worker/metrics.js, which takes
 *                POST /api/metrics and hands everything else to the static
 *                site (with its single-page fallback).
 * Who answers is `instrada` (worker/ponte-logica.js). With the PONTE_HOSTNAME
 * var set (wrangler.jsonc), the bridge lives ONLY on that hostname and that
 * hostname serves nothing else: the phone app, which keeps the pairing key in
 * its origin's storage, shares that origin with no other page. Unset, it is
 * /ponte/ on the site, as before.
 * wrangler.jsonc → run_worker_first sends every path here except the static
 * files that can't run as a page (assets/, recordings/, icons/): so a page of
 * the site can never be served from the bridge's hostname, and the heavy
 * static traffic still never wakes the Worker.
 */
import metrics from './metrics.js'
import { ponteFetch } from './ponte.js'
import { instrada } from './ponte-logica.js'

export { PonteStanza } from './ponte.js'

export default {
  fetch(request, env, ctx) {
    const via = instrada(request.url, env.PONTE_HOSTNAME)
    if (via === 'ponte') return ponteFetch(request, env)
    if (via === 'niente') return new Response('not found', { status: 404 })
    return metrics.fetch(request, env, ctx)
  },
}
