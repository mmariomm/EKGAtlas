#!/usr/bin/env node
/*
 * PS Assist · Ponte — il ripetitore in Node, per i test e per provare in casa.
 *
 * Fa quello che fa il Worker del sito (worker/ponte.js) con la STESSA logica
 * (worker/ponte-logica.js): serve l'app del telefono da public/ponte/ sotto
 * /ponte/ (solo i suoi file) e inoltra i messaggi cifrati fra le due prese di
 * una stanza su /ponte/ws. In più, solo per i test, `osserva` vede ogni
 * messaggio inoltrato: è così che la suite prova che il ripetitore non vede
 * mai niente in chiaro; `entrate` conta le prese aperte, per ruolo; `eventi`
 * dice chi è entrato, chi è uscito e chi il ripetitore ha ritirato o chiuso:
 * ogni entrata e ogni uscita sveglierebbe il Durable Object.
 *
 *   node ponte/relay-node.mjs 8787      → http://localhost:8787/ponte/
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { Stanza, Registro, PONTE, PING, PONG, FILE_APP, leggiStanza, intestazioniApp, leggiProvaRegistro, INTESTAZIONI_ANNUNCIO } from "../../worker/ponte-logica.js";

const APP = join(dirname(fileURLToPath(import.meta.url)), "../../public/ponte");
const TIPI = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json",
};

// `ipProva`: solo nei test — l'IP di chi annuncia lo dice l'intestazione x-prova-ip (i conti per IP del registro)
export async function avviaRelay({ porta = 0, osserva = null, ipProva = false } = {}) {
  const stanze = new Map();          // stanza → Set di prese
  const stati = new WeakMap();       // presa → stato (come serializeAttachment)
  const battiti = new WeakMap();     // presa → ultimo «ping»
  const mute = new WeakSet();        // prese morte senza dirlo (solo nei test: `muta`)
  const entrate = { pc: 0, tel: 0, medico: 0, stazione: 0 };
  // Il registro per i test: ogni presa che entra o esce, e quelle che il
  // ripetitore ritira o chiude, con il codice — per stanza (le prime 6 cifre) e ruolo.
  const eventi = [];
  const nota = (nome, ruolo, tipo, codice) => { eventi.push({ ts: Date.now(), stanza: nome.slice(0, 6), ruolo, tipo, codice }); if (eventi.length > 5000) eventi.splice(0, 1000); };
  const vive = (nome) => [...(stanze.get(nome) || [])].filter((w) => w.readyState === w.OPEN && !stati.get(w)?.via && !stati.get(w)?.attende);
  // quello che ogni stanza tiene (le chiavi d'entrata, come lo SQLite del Durable Object) e i suoi conti al
  // minuto (come la sua memoria): per stanza, finché il ripetitore gira
  const archivi = new Map(), conti = new Map();
  const di = (m, nome) => { if (!m.has(nome)) m.set(nome, new Map()); return m.get(nome); };
  const logica = (nome) => new Stanza({
    archivio: { leggi: (k) => di(archivi, nome).get(k) ?? null, scrivi: (k, v) => di(archivi, nome).set(k, structuredClone(v)) },
    conti: di(conti, nome),
    nota: (x) => nota(nome, x.ruolo, x.ponte),
    tutte: () => [...(stanze.get(nome) || [])],
    aperta: (w) => w.readyState === w.OPEN,
    invia: (w, d) => { if (mute.has(w)) return; try { w.send(d, { binary: typeof d !== "string" }); } catch { /* chiusa intanto */ } },
    chiudi: (w, codice, perche) => {
      nota(nome, stati.get(w)?.ruolo, "chiusa dal ripetitore", codice);
      try { w.close(codice, perche); } catch { /* già chiusa */ }
    },
    leggi: (w) => stati.get(w) || null,
    scrivi: (w, s) => {
      if (s.via && !stati.get(w)?.via) nota(nome, s.ruolo, "ritirata", s.via);
      stati.set(w, s);
    },
    battito: (w) => battiti.get(w) || 0,
    osserva: osserva ? (d) => osserva(Buffer.from(d)) : null,
  });

  // Il registro dei PC (come il Durable Object «registro», worker/ponte.js): l'elenco in memoria, e per i test
  // ogni annuncio e ogni lettura (con chi, e com'è andata)
  let salvato = null;
  const registro = new Registro({ leggi: () => structuredClone(salvato), scrivi: (v) => { salvato = structuredClone(v); }, ip: new Map() });
  const regLog = [];
  const corpo = (req, max) => new Promise((ok) => {
    let t = "", troppo = false;
    req.setEncoding("utf8");
    req.on("data", (d) => { if (troppo) return; t += d; if (t.length > max) troppo = true; });
    req.on("end", () => ok(troppo ? null : t));
    req.on("error", () => ok(null));
  });
  async function registroHttp(req, res, p) {
    const ip = (ipProva && req.headers["x-prova-ip"]) || req.socket.remoteAddress || "";
    const fine = (stato, testo, h = INTESTAZIONI_ANNUNCIO) => { regLog.push({ ts: Date.now(), p, stato, ip, ua: String(req.headers["user-agent"] || "").slice(0, 80) }); res.writeHead(stato, h).end(testo); };
    if (req.method !== "POST") { fine(405, "solo POST"); return; }
    if (p === "/ponte/registro") {
      const t = await corpo(req, 2000);
      if (t == null) { fine(413, "troppo grande"); return; }
      const r = registro.annuncia(t, ip, Date.now());
      fine(r.stato, r.corpo);
      return;
    }
    const t = await corpo(req, 1000);
    const m = t == null ? null : leggiProvaRegistro(t);
    if (!m) { fine(400, "prova non valida", {}); return; }
    const pr = logica(m.r).provaRegistro(m, Date.now());
    if (!pr.ok) { fine(pr.stato === 429 || pr.stato === 503 ? pr.stato : 403, "no", {}); return; }
    const r = registro.elencoPer(ip, Date.now());
    fine(r.stato, r.corpo, { "content-type": "application/json", "cache-control": "no-store" });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/ponte/registro" || url.pathname === "/ponte/registro/elenco") { await registroHttp(req, res, url.pathname); return; }
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
      nota(r.stanza, r.ruolo, "entra");
      const st = logica(r.stanza);
      st.entra(w, r.ruolo, Date.now());
      w.on("message", (d, bin) => {
        if (mute.has(w)) return;
        const dati = bin ? d : d.toString();
        // il battito: lo risponde chi sta sotto, come l'auto-risposta di Cloudflare
        if (dati === PING) { battiti.set(w, Date.now()); w.send(PONG); return; }
        st.messaggio(w, dati, Date.now());
      });
      w.on("close", (codice) => {
        nota(r.stanza, r.ruolo, "esce", codice);
        st.esce(w, Date.now());
        stanze.get(r.stanza)?.delete(w);
        if (!stanze.get(r.stanza)?.size) stanze.delete(r.stanza);
      });
    });
  });

  await new Promise((ok) => server.listen(porta, ok));
  const p = server.address().port;
  return {
    url: `http://localhost:${p}`,
    porta: p,
    // quante prese aperte e non ritirate, per ruolo (i test guardano chi è collegato)
    prese: () => {
      const conto = { pc: 0, tel: 0 };
      for (const nome of stanze.keys()) for (const w of vive(nome)) conto[stati.get(w)?.ruolo] = (conto[stati.get(w)?.ruolo] || 0) + 1;
      return conto;
    },
    // quante prese si sono aperte in tutto, per ruolo (un telefono che si ricollega)
    entrate: () => ({ ...entrate }),
    // chiude le prese di un ruolo (una rete che cade)
    taglia: (ruolo) => { for (const nome of stanze.keys()) for (const w of vive(nome)) if (stati.get(w)?.ruolo === ruolo) w.terminate(); },
    // le prese di un ruolo muoiono senza dirlo (un PC spento di colpo, una rete che perde tutto):
    // il ripetitore non ne sente più niente, nemmeno il battito o la chiusura, e non manda più niente
    muta: (ruolo) => { for (const nome of stanze.keys()) for (const w of vive(nome)) if (stati.get(w)?.ruolo === ruolo) { mute.add(w); w._socket?.pause(); } },
    // il registro: [{ ts, stanza, ruolo, tipo: entra|esce|ritirata|chiusa dal ripetitore, codice }]
    eventi: () => eventi.map((e) => ({ ...e })),
    // il registro dei PC: l'elenco salvato ({ id → riga }), e ogni richiesta ({ ts, p, stato, ip, ua })
    elencoPc: () => structuredClone(salvato || {}),
    richiesteRegistro: () => regLog.map((x) => ({ ...x })),
    // tutte le prese ancora nell'elenco (anche le ritirate), per ruolo
    tutte: () => {
      const conto = {};
      for (const set of stanze.values()) for (const w of set) conto[stati.get(w)?.ruolo] = (conto[stati.get(w)?.ruolo] || 0) + 1;
      return conto;
    },
    chiudi: () => new Promise((ok) => {
      for (const w of wss.clients) w.terminate();
      server.close(() => ok());
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await avviaRelay({ porta: Number(process.argv[2] || 8787) });
  console.log(`ponte di prova: ${r.url}/ponte/  (Ctrl+C per chiudere)`);
}
