#!/usr/bin/env node
/*
 * PS Assist · Ponte — il ripetitore in Node, per i test e per provare in casa.
 *
 * Fa quello che fa il Worker del sito (worker/ponte.js) con la STESSA logica
 * (worker/ponte-logica.js): serve l'app del telefono da public/ponte/ sotto
 * /ponte/ (solo i suoi file) e inoltra i messaggi cifrati fra le due prese di
 * una stanza su /ponte/ws. In più, solo per i test, `osserva` vede ogni
 * messaggio inoltrato: è così che la suite prova che il ripetitore non vede
 * mai niente in chiaro; `entrate` conta le prese aperte, per ruolo.
 *
 *   node ponte/relay-node.mjs 8787      → http://localhost:8787/ponte/
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { Stanza, PONTE, PING, PONG, FILE_APP, leggiStanza, intestazioniApp } from "../../worker/ponte-logica.js";

const APP = join(dirname(fileURLToPath(import.meta.url)), "../../public/ponte");
const TIPI = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json",
};

export async function avviaRelay({ porta = 0, osserva = null } = {}) {
  const stanze = new Map();          // stanza → Set di prese
  const stati = new WeakMap();       // presa → stato (come serializeAttachment)
  const battiti = new WeakMap();     // presa → ultimo «ping»
  const entrate = { pc: 0, tel: 0 };
  const aperte = (nome) => [...(stanze.get(nome) || [])].filter((w) => w.readyState === w.OPEN);
  const logica = (nome) => new Stanza({
    socket: (ruolo, escluso) => aperte(nome).find((w) => w !== escluso && stati.get(w)?.ruolo === ruolo) || null,
    invia: (w, d) => { try { w.send(d, { binary: typeof d !== "string" }); } catch { /* chiusa intanto */ } },
    chiudi: (w, codice, perche) => { try { w.close(codice, perche); } catch { /* già chiusa */ } },
    leggi: (w) => stati.get(w) || null,
    scrivi: (w, s) => stati.set(w, s),
    ultimo: (w) => Math.max(stati.get(w)?.ultimo || 0, battiti.get(w) || 0),
    osserva: osserva ? (d) => osserva(Buffer.from(d)) : null,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/ponte") { res.writeHead(302, { location: "/ponte/" }).end(); return; }
    if (req.method !== "GET" || !FILE_APP.has(url.pathname)) { res.writeHead(404).end(); return; }
    const rel = normalize(url.pathname.slice("/ponte/".length) || "index.html");
    const file = join(APP, rel);
    if (!file.startsWith(APP + sep)) { res.writeHead(404).end(); return; }
    try {
      const corpo = await readFile(file);
      res.writeHead(200, { "content-type": TIPI[extname(file)] || "application/octet-stream", "cache-control": "no-cache",
        ...intestazioniApp(`http://${req.headers.host}${url.pathname}`) });
      res.end(corpo);
    } catch { res.writeHead(404).end(); }
  });

  // il tetto lo decide la logica (come sul Worker): qui solo un margine
  const wss = new WebSocketServer({ noServer: true, maxPayload: PONTE.frameMax * 2 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    const r = url.pathname === "/ponte/ws" ? leggiStanza(url) : { ok: false };
    if (!r.ok) { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    wss.handleUpgrade(req, socket, head, (w) => {
      if (!stanze.has(r.stanza)) stanze.set(r.stanza, new Set());
      stanze.get(r.stanza).add(w);
      entrate[r.ruolo]++;
      const st = logica(r.stanza);
      st.entra(w, r.ruolo, Date.now());
      w.on("message", (d, bin) => {
        const dati = bin ? d : d.toString();
        // il battito: lo risponde chi sta sotto, come l'auto-risposta di Cloudflare
        if (dati === PING) { battiti.set(w, Date.now()); w.send(PONG); return; }
        st.messaggio(w, dati, Date.now());
      });
      w.on("close", () => {
        st.esce(w);
        stanze.get(r.stanza)?.delete(w);
        if (!stanze.get(r.stanza)?.size) stanze.delete(r.stanza);
      });
    });
  });
  const pulizia = setInterval(() => {
    for (const nome of stanze.keys()) logica(nome).pulisci(aperte(nome), Date.now());
  }, 30e3);

  await new Promise((ok) => server.listen(porta, ok));
  const p = server.address().port;
  return {
    url: `http://localhost:${p}`,
    porta: p,
    // quante prese aperte, per ruolo (i test guardano chi è collegato)
    prese: () => {
      const conto = { pc: 0, tel: 0 };
      for (const nome of stanze.keys()) for (const w of aperte(nome)) conto[stati.get(w)?.ruolo] = (conto[stati.get(w)?.ruolo] || 0) + 1;
      return conto;
    },
    // quante prese si sono aperte in tutto, per ruolo (un telefono che si ricollega)
    entrate: () => ({ ...entrate }),
    // chiude le prese di un ruolo (una rete che cade)
    taglia: (ruolo) => { for (const nome of stanze.keys()) for (const w of aperte(nome)) if (stati.get(w)?.ruolo === ruolo) w.terminate(); },
    chiudi: () => new Promise((ok) => {
      clearInterval(pulizia);
      for (const w of wss.clients) w.terminate();
      server.close(() => ok());
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await avviaRelay({ porta: Number(process.argv[2] || 8787) });
  console.log(`ponte di prova: ${r.url}/ponte/  (Ctrl+C per chiudere)`);
}
