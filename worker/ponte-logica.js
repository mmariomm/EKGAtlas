/**
 * PS Assist · Ponte — la logica del ripetitore, senza Cloudflare intorno.
 *
 * La usano il Durable Object (worker/ponte.js) e il ripetitore Node dei test
 * (ps-app/ponte/relay-node.mjs): i test provano lo stesso codice che gira in
 * produzione.
 *
 * Che cosa fa: in una «stanza» (un numero di 32 cifre esadecimali, ricavato
 * dalla chiave dell'associazione: chi non ha la chiave non lo conosce) stanno
 * al massimo due prese, una del PC e una del telefono. Quello che arriva da
 * una, in binario, va all'altra così com'è: sono messaggi cifrati da un capo
 * all'altro, e qui non si leggono, non si tengono e non si scrivono nei log.
 * Una presa nuova dello stesso ruolo sostituisce quella vecchia. In testo il
 * ripetitore dice solo una cosa: se dall'altra parte c'è qualcuno.
 */

export const PONTE = {
  frameMax: 1 << 20,          // un messaggio non supera 1 MB
  alMinuto: 1200,             // messaggi per minuto per presa, oltre si chiude
  inattivoMs: 15 * 60e3,      // una presa che tace da tanto (nemmeno il battito) si chiude
};
export const PING = "ping";
export const PONG = "pong";
const RUOLI = new Set(["pc", "tel"]);
export const altroRuolo = (r) => (r === "pc" ? "tel" : "pc");

// I file dell'app del telefono, e solo questi: un altro indirizzo sotto
// /ponte/ è un 404, mai la pagina del sito. (Gli stessi del suo sw.js.)
export const FILE_APP = new Set(["", "app.js", "app.css", "cripto.js", "sw.js", "manifest.webmanifest",
  "icona.svg", "icona-180.png", "icona-192.png", "icona-512.png"].map((f) => "/ponte/" + f));

// /ponte/ws?r=<stanza>&ruolo=pc|tel
export function leggiStanza(url) {
  const u = url instanceof URL ? url : new URL(url);
  const stanza = u.searchParams.get("r") || "";
  const ruolo = u.searchParams.get("ruolo") || "";
  if (!/^[0-9a-f]{32}$/.test(stanza)) return { ok: false, stato: 400, perche: "stanza non valida" };
  if (!RUOLI.has(ruolo)) return { ok: false, stato: 400, perche: "ruolo non valido" };
  return { ok: true, stanza, ruolo };
}

export const nuovoConto = (ora) => ({ inizio: ora, n: 0, ultimo: ora });
// Un messaggio in più per questa presa: troppo grande, o troppi in un minuto?
export function contaFrame(conto, byte, ora) {
  if (byte > PONTE.frameMax) return { ok: false, codice: 1009, perche: "messaggio troppo grande" };
  const nuovo = ora - conto.inizio >= 60e3 ? { inizio: ora, n: 1, ultimo: ora } : { inizio: conto.inizio, n: conto.n + 1, ultimo: ora };
  if (nuovo.n > PONTE.alMinuto) return { ok: false, codice: 1008, perche: "troppi messaggi" };
  return { ok: true, conto: nuovo };
}
export const presenza = (c) => JSON.stringify({ pari: !!c });
const byteDi = (dati) => (typeof dati === "string" ? dati.length * 3 : dati.byteLength ?? dati.length ?? 0);

/*
 * La stanza, sopra un adattatore che sa parlare con le prese vere:
 *   io.socket(ruolo, escluso)   la presa aperta di quel ruolo (non `escluso`)
 *   io.invia(presa, dati)       manda così com'è
 *   io.chiudi(presa, codice, perché)
 *   io.leggi(presa) / io.scrivi(presa, stato)   lo stato attaccato alla presa
 *   io.ultimo(presa)            l'ultima volta che si è fatta sentire (battito compreso)
 *   io.osserva?(dati)           solo nei test: che cosa è passato
 */
export class Stanza {
  constructor(io) { this.io = io; }
  entra(presa, ruolo, ora) {
    const vecchia = this.io.socket(ruolo, presa);
    if (vecchia) this.io.chiudi(vecchia, 4001, "sostituita");
    this.io.scrivi(presa, { ruolo, ...nuovoConto(ora) });
    const altra = this.io.socket(altroRuolo(ruolo), presa);
    this.io.invia(presa, presenza(!!altra));
    if (altra) this.io.invia(altra, presenza(true));
  }
  messaggio(presa, dati, ora) {
    const st = this.io.leggi(presa);
    if (!st) return;
    const c = contaFrame(st, byteDi(dati), ora);
    if (!c.ok) { this.io.chiudi(presa, c.codice, c.perche); return; }
    this.io.scrivi(presa, { ...st, ...c.conto });
    // il testo è solo il battito (a cui risponde chi sta sotto): non si inoltra
    if (typeof dati === "string") return;
    const altra = this.io.socket(altroRuolo(st.ruolo), presa);
    if (!altra) return;
    this.io.osserva?.(dati);
    this.io.invia(altra, dati);
  }
  esce(presa) {
    const st = this.io.leggi(presa);
    if (!st) return;
    if (this.io.socket(st.ruolo, presa)) return;   // sostituita: dall'altra parte non cambia niente
    const altra = this.io.socket(altroRuolo(st.ruolo), presa);
    if (altra) this.io.invia(altra, presenza(false));
  }
  // le prese mute da troppo si chiudono; dice se ne resta qualcuna
  pulisci(prese, ora) {
    let vive = 0;
    for (const p of prese) {
      if (ora - this.io.ultimo(p) > PONTE.inattivoMs) this.io.chiudi(p, 4002, "inattiva");
      else vive++;
    }
    return vive;
  }
}

// Le intestazioni dell'app del telefono: solo il suo codice, e la rete solo
// verso questo stesso sito (la presa del ponte compresa).
export function intestazioniApp(url) {
  const u = url instanceof URL ? url : new URL(url);
  const presa = (u.protocol === "https:" ? "wss://" : "ws://") + u.host;
  return {
    "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${presa}; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}
