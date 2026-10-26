/**
 * PS Assist · Ponte — il ripetitore, su Cloudflare (stesso Worker del sito).
 *
 *   /ponte/ws?r=<stanza>&ruolo=pc|tel   la presa: un Durable Object per stanza
 *   /ponte/eco                          la prova della rete (rimanda quello che riceve)
 *   /ponte/salute                       «ok», per la prova della rete
 *   /ponte/…                            l'app del telefono, file statici da dist/ponte/
 *
 * Il Durable Object usa l'ibernazione delle WebSocket: fra un messaggio e
 * l'altro non resta niente in memoria, e il battito («ping» → «pong») lo
 * risponde Cloudflare senza svegliarlo. Non c'è niente su disco (solo la
 * sveglia che chiude le prese mute) e niente nei log: i messaggi sono cifrati
 * da un capo all'altro e qui passano come byte.
 */
import { DurableObject } from "cloudflare:workers";
import { Stanza, PONTE, PING, PONG, leggiStanza, eco, intestazioniApp, intestazioniSalute } from "./ponte-logica.js";

const APERTA = 1;   // WebSocket.OPEN

export class PonteStanza extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    this.stanza = new Stanza({
      socket: (ruolo, escluso) => ctx.getWebSockets(ruolo).find((w) => w !== escluso && w.readyState === APERTA) || null,
      invia: (w, d) => { try { w.send(d); } catch { /* chiusa intanto */ } },
      chiudi: (w, codice, perche) => { try { w.close(codice, perche); } catch { /* già chiusa */ } },
      leggi: (w) => w.deserializeAttachment(),
      scrivi: (w, s) => w.serializeAttachment(s),
      ultimo: (w) => Math.max(w.deserializeAttachment()?.ultimo || 0, ctx.getWebSocketAutoResponseTimestamp(w)?.getTime() || 0),
    });
  }

  async fetch(request) {
    const r = leggiStanza(new URL(request.url));
    if (!r.ok) return new Response(r.perche, { status: r.stato });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [r.ruolo]);
    this.stanza.entra(server, r.ruolo, Date.now());
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + PONTE.inattivoMs / 3);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, dati) { this.stanza.messaggio(ws, dati, Date.now()); }
  webSocketClose(ws, codice) {
    this.stanza.esce(ws);
    try { ws.close(codice === 1005 || codice === 1006 ? 1000 : codice, "chiusa"); } catch { /* già chiusa */ }
  }
  webSocketError(ws) { this.stanza.esce(ws); }

  async alarm() {
    const vive = this.stanza.pulisci(this.ctx.getWebSockets(), Date.now());
    if (vive) await this.ctx.storage.setAlarm(Date.now() + PONTE.inattivoMs / 3);
  }
}

// La prova della rete: una presa che rimanda indietro, piccola e per due minuti.
function presaEco() {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  const fine = setTimeout(() => { try { server.close(1000, "fine prova"); } catch { /* già chiusa */ } }, PONTE.ecoDurataMs);
  server.addEventListener("message", (e) => {
    if (e.data === PING) { server.send(PONG); return; }
    const r = eco(e.data);
    if (r == null) server.close(1009, "troppo grande");
    else server.send(r);
  });
  server.addEventListener("close", () => clearTimeout(fine));
  return new Response(null, { status: 101, webSocket: client });
}

export async function ponteFetch(request, env) {
  const url = new URL(request.url);
  const p = url.pathname;
  if (p === "/ponte/ws" || p === "/ponte/eco") {
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return new Response("serve una WebSocket", { status: 426 });
    if (p === "/ponte/eco") return presaEco();
    const r = leggiStanza(url);
    if (!r.ok) return new Response(r.perche, { status: r.stato });
    return env.PONTE.get(env.PONTE.idFromName(r.stanza)).fetch(request);
  }
  if (p === "/ponte/salute") return new Response("ok", { headers: intestazioniSalute });
  // l'app del telefono: i file di dist/ponte/, con le sue intestazioni
  const risposta = await env.ASSETS.fetch(request);
  const h = new Headers(risposta.headers);
  for (const [k, v] of Object.entries(intestazioniApp(url))) h.set(k, v);
  return new Response(risposta.body, { status: risposta.status, statusText: risposta.statusText, headers: h });
}
