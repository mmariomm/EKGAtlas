/**
 * PS Assist · Ponte — il ripetitore, su Cloudflare (stesso Worker del sito).
 *
 *   /ponte/ws?r=<stanza>&ruolo=pc|tel|medico|stazione   la presa: un Durable Object per stanza
 *   /ponte/…                            l'app del telefono, i suoi file da dist/ponte/
 *                                       (solo quelli: un altro indirizzo è un 404)
 *
 * Il Durable Object usa l'ibernazione delle WebSocket: fra un messaggio e
 * l'altro non resta niente in memoria, e il battito («ping» → «pong») lo
 * risponde Cloudflare senza svegliarlo. Non c'è niente su disco e niente nei
 * log: i messaggi sono cifrati da un capo all'altro e qui passano come byte.
 *
 * Quello che costa è il Durable Object sveglio: lo svegliano solo una presa
 * che entra, una che esce e un messaggio cifrato — nessuna sveglia sua, e
 * nessuna chiusura mandata a chi non può rispondere (ponte-logica.js), che lo
 * terrebbe sveglio fino a 15 minuti.
 */
import { DurableObject } from "cloudflare:workers";
import { Stanza, Registro, PING, PONG, FILE_APP, leggiStanza, intestazioniApp, leggiProvaRegistro, INTESTAZIONI_ANNUNCIO } from "./ponte-logica.js";

const APERTA = 1;   // WebSocket.OPEN

export class PonteStanza extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    // Le chiavi d'entrata della stanza (ponte-logica.js): nel suo SQLite, con l'API sincrona (una lettura a
    // ogni entrata, una scrittura quando una chiave si registra o cambia). I conti al minuto in memoria: chi
    // li fa salire tiene sveglio il Durable Object, e uno che si riaddormenta riparte da zero.
    // Senza SQLite (una classe non migrata a new_sqlite_classes, un runtime vecchio): MAI una memoria al suo
    // posto — al risveglio sarebbe vuota, e la prima presa si registrerebbe la stanza. La stanza è `guasto`:
    // chi entra esce con 1011, e i log lo gridano (P2-9).
    const kv = ctx.storage && ctx.storage.kv && typeof ctx.storage.kv.get === "function" ? ctx.storage.kv : null;
    if (!kv) console.error(JSON.stringify({ ponte: "ARCHIVIO NON DISPONIBILE (ctx.storage.kv): la stanza rifiuta tutti" }));
    this.conti = new Map();
    this.stanza = new Stanza({
      archivio: {
        guasto: !kv,
        leggi: (k) => (kv ? kv.get(k) ?? null : null),
        scrivi: (k, v) => { if (!kv) throw new Error("archivio"); kv.put(k, v); },
      },
      conti: this.conti,
      // (le entrate senza prova del passaggio: quante e di che ruolo, mai la stanza — Workers Logs)
      nota: (x) => { try { console.log(JSON.stringify(x)); } catch { /* niente */ } },
      tutte: () => ctx.getWebSockets(),
      aperta: (w) => w.readyState === APERTA,
      invia: (w, d) => { try { w.send(d); } catch { /* chiusa intanto */ } },
      chiudi: (w, codice, perche) => { try { w.close(codice, perche); } catch { /* già chiusa */ } },
      leggi: (w) => { try { return w.deserializeAttachment(); } catch { return null; } },
      scrivi: (w, s) => w.serializeAttachment(s),
      battito: (w) => ctx.getWebSocketAutoResponseTimestamp(w)?.getTime() || 0,
    });
  }

  async fetch(request) {
    // (il registro dei PC: la prova di lettura del telefono, controllata con le chiavi d'entrata di questa stanza)
    if (new URL(request.url).pathname === "/ponte/registro/prova") {
      const r = this.stanza.provaRegistro(leggiProvaRegistro(await request.text()), Date.now());
      return new Response(r.ok ? "ok" : "no", { status: r.ok ? 200 : r.stato });
    }
    const r = leggiStanza(new URL(request.url));
    if (!r.ok) return new Response(r.perche, { status: r.stato });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [r.ruolo]);
    this.stanza.entra(server, r.ruolo, Date.now());
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, dati) { this.stanza.messaggio(ws, dati, Date.now()); }
  // La risposta alla chiusura la dà Cloudflare (web_socket_auto_reply_to_close: compatibility_date dal
  // 2026-04-07, qui 2026-06-07). Qui niente ws.close(): chi chiude è quasi sempre un service worker che
  // Chrome ha appena fermato (1001) o una presa caduta (1006) — dall'altra parte non c'è più nessuno, e
  // una chiusura mandata lì può restare in sospeso e tenere sveglio il Durable Object.
  webSocketClose(ws) { this.stanza.esce(ws, Date.now()); }
  webSocketError(ws) { this.stanza.esce(ws, Date.now()); }

  // Una sveglia rimasta dalla versione di prima: suona una volta, non tocca niente e non si
  // rimette. (Ritirare lì le prese mute toglierebbe di mezzo anche un PC solo addormentato.)
  alarm() {}
}

// Il registro dei PC con PS Assist (ponte-logica.js, «il registro»): un Durable Object solo, «registro», con
// l'elenco in un valore del suo SQLite. Nessuna presa e nessuna sveglia: si sveglia a un annuncio (al più uno
// ogni 30 minuti per PC col gestionale aperto) o a una lettura (il medico che apre ⋯ → Dispositivi), risponde
// in qualche millisecondo e torna a dormire. Senza SQLite: 503, mai una memoria al suo posto.
export class PonteRegistro extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const kv = ctx.storage && ctx.storage.kv && typeof ctx.storage.kv.get === "function" ? ctx.storage.kv : null;
    this.registro = kv ? new Registro({ leggi: () => kv.get("elenco") ?? null, scrivi: (v) => kv.put("elenco", v), ip: new Map() }) : null;
  }
  async fetch(request) {
    if (!this.registro) return new Response("archivio", { status: 503 });
    const ip = request.headers.get("x-ip") || "";
    const r = new URL(request.url).pathname === "/elenco" ? this.registro.elencoPer(ip, Date.now()) : this.registro.annuncia(await request.text(), ip, Date.now());
    return new Response(r.corpo, { status: r.stato });
  }
}
// il corpo di un POST, al più `max` caratteri (null se di più)
async function corpoBreve(request, max) {
  if (Number(request.headers.get("content-length") || 0) > max) return null;
  const t = await request.text();
  return t.length > max ? null : t;
}
async function registroFetch(request, env, p) {
  const h = INTESTAZIONI_ANNUNCIO;
  if (request.method !== "POST") return new Response("solo POST", { status: 405, headers: h });
  if (!env.REGISTRO) return new Response("registro non configurato", { status: 503, headers: h });
  const ip = request.headers.get("cf-connecting-ip") || "";
  const reg = env.REGISTRO.get(env.REGISTRO.idFromName("registro"));
  const fuori = { method: "POST", headers: { "x-ip": ip } };
  if (p === "/ponte/registro") {
    const testo = await corpoBreve(request, 2000);
    if (testo == null) return new Response("troppo grande", { status: 413, headers: h });
    const r = await reg.fetch("https://registro/annuncia", { ...fuori, body: testo });
    return new Response(await r.text(), { status: r.status, headers: h });
  }
  // l'elenco: prima la stanza dice se la prova è buona, poi il registro (solo dallo stesso sito: niente CORS)
  const testo = await corpoBreve(request, 1000);
  const m = testo == null ? null : leggiProvaRegistro(testo);
  if (!m) return new Response("prova non valida", { status: 400 });
  const pr = await env.PONTE.get(env.PONTE.idFromName(m.r)).fetch("https://stanza/ponte/registro/prova", { method: "POST", body: testo });
  if (!pr.ok) return new Response("no", { status: pr.status === 429 || pr.status === 503 ? pr.status : 403 });
  const r = await reg.fetch("https://registro/elenco", fuori);
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function ponteFetch(request, env) {
  const url = new URL(request.url);
  const p = url.pathname;
  if (p === "/ponte/registro" || p === "/ponte/registro/elenco") return registroFetch(request, env, p);
  if (p === "/ponte/ws") {
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return new Response("serve una WebSocket", { status: 426 });
    // una stanza che non può esistere non sveglia nessun Durable Object
    const r = leggiStanza(url);
    if (!r.ok) return new Response(r.perche, { status: r.stato });
    return env.PONTE.get(env.PONTE.idFromName(r.stanza)).fetch(request);
  }
  const h = new Headers(intestazioniApp(url));
  if (!FILE_APP.has(p)) return new Response("non trovato", { status: 404, headers: h });
  // l'app del telefono: i file di dist/ponte/, con le sue intestazioni
  const risposta = await env.ASSETS.fetch(request);
  for (const [k, v] of risposta.headers) if (!h.has(k)) h.set(k, v);
  return new Response(risposta.body, { status: risposta.status, statusText: risposta.statusText, headers: h });
}
