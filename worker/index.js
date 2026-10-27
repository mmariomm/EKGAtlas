/**
 * The Worker's front door. Two tenants, one deploy:
 *   /ponte/*   PS Assist's end-to-end-encrypted relay and its phone web app
 *              (worker/ponte.js; ps-app/ponte/README.md).
 *   the rest   exactly what it was: worker/metrics.js, which takes
 *              POST /api/metrics and hands everything else to the static
 *              site (with its single-page fallback).
 * wrangler.jsonc → run_worker_first lists /ponte/* and /api/*: with a list,
 * every other path is served by the static assets first, as before; /api/*
 * is there so the metrics beacon keeps reaching the Worker (a POST that the
 * assets answered would get a 405).
 */
import metrics from './metrics.js'
import { ponteFetch } from './ponte.js'

export { PonteStanza } from './ponte.js'

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith('/ponte/')) return ponteFetch(request, env)
    return metrics.fetch(request, env, ctx)
  },
}
