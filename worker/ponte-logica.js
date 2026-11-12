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
 * Una presa nuova dello stesso ruolo sostituisce quelle vecchie. In testo il
 * ripetitore dice solo una cosa: se dall'altra parte c'è qualcuno.
 * Due tipi di stanza, con la stessa logica: il PC e il suo telefono (`pc`,
 * `tel`), e il PC del medico e la sua stazione di stampa (`medico`,
 * `stazione`; anche la stanza dell'abbinamento, che dura pochi minuti).
 */

export const PONTE = {
  frameMax: 1 << 20,          // un messaggio non supera 1 MB
  alMinuto: 1200,             // messaggi per minuto per presa, oltre si chiude
  // Una presa che tace da 75 secondi (tre battiti persi: i client ne mandano
  // uno ogni 20, e senza «pong» in 10 si rifanno da soli) è morta: non conta
  // più per chi c'è (di chi entra si ritirano solo le vecchie del suo ruolo). Nessuna sveglia apposta.
  inattivoMs: 75e3,
  // un telefono che ha battuto da meno di 30 secondi (uno ogni 20) è davanti a qualcuno: se un'altra
  // scheda prende il suo posto, la chiusura gli arriva subito; se no è in sottofondo, o morto — si ritira
  vivoMs: 30e3,
  // le prese ritirate che Cloudflare non ha ancora buttato: oltre queste, le più
  // vecchie si chiudono davvero (solo un tetto: un client che si rifà ogni
  // minuto e mezzo ne lascia una ventina finché le connessioni cadono)
  ritirateMax: 1000,
};
export const PING = "ping";
export const PONG = "pong";
const ALTRO = { pc: "tel", tel: "pc", medico: "stazione", stazione: "medico" };
const RUOLI = new Set(Object.keys(ALTRO));
export const altroRuolo = (r) => ALTRO[r];

// I file dell'app del telefono, e solo questi: un altro indirizzo sotto
// /ponte/ è un 404, mai la pagina del sito. (Gli stessi del suo sw.js.)
export const FILE_APP = new Set(["", "app.js", "app.css", "cripto.js", "jsqr.min.js", "sw.js", "manifest.webmanifest",
  "icona.svg", "icona-180.png", "icona-192.png", "icona-512.png"].map((f) => "/ponte/" + f));

// /ponte/ws?r=<stanza>&ruolo=pc|tel|medico|stazione
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
 *   io.tutte()                  tutte le prese della stanza
 *   io.aperta(presa)            è aperta (readyState OPEN)
 *   io.invia(presa, dati)       manda così com'è
 *   io.chiudi(presa, codice, perché)
 *   io.leggi(presa) / io.scrivi(presa, stato)   lo stato attaccato alla presa
 *   io.battito(presa)           l'ora dell'ultimo «ping» (0: mai)
 *   io.osserva?(dati)           solo nei test: che cosa è passato
 *
 * Quello che costa, su Cloudflare, è il Durable Object sveglio e che non può
 * ibernarsi: ogni volta che si sveglia (una presa che entra o esce, un
 * messaggio, una sveglia), e ogni operazione che resta in sospeso — Cloudflare
 * ne tiene aperta una fino a 15 minuti. Una chiusura mandata a una presa il cui
 * capo è morto senza dirlo (un service worker fermato, un PC spento, una rete
 * caduta) non avrà mai risposta: con un client che si rifà ogni minuto e mezzo
 * e una chiusura a ogni entrata, la stanza non dorme mai. Per questo il
 * ripetitore NON manda chiusure a chi forse non può rispondere: una presa
 * sostituita, o muta da 75 secondi, si RITIRA — fuori dai conti (chi c'è, a chi
 * si inoltra) subito, senza scrivere niente sulla rete. Se poi parla (era viva:
 * un telefono rimasto in sottofondo), si chiude allora, col suo codice, e
 * risponde. Le prese morte le butta Cloudflare quando la connessione cade.
 * Nessuna sveglia: si guarda quando qualcuno entra.
 *
 * Lo stato di una presa: { ruolo, inizio, n, ultimo }, e `via` (4001
 * sostituita, 4002 muta, o il codice con cui il ripetitore l'ha chiusa)
 * quando è fuori dai conti; `chiusa` quando la chiusura è partita davvero.
 */
export class Stanza {
  constructor(io) { this.io = io; }
  // la presa di quel ruolo (non `escluso`): aperta e non ritirata
  presa(ruolo, escluso) {
    return this.io.tutte().find((p) => {
      const st = p !== escluso && this.io.aperta(p) && this.io.leggi(p);
      return st && st.ruolo === ruolo && !st.via;
    }) || null;
  }
  // tace da troppo (nemmeno il battito)
  muta(p, st, ora) { return ora - Math.max(st.ultimo || 0, this.io.battito(p) || 0) > PONTE.inattivoMs; }
  entra(presa, ruolo, ora) {
    const tutte = this.io.tutte().filter((p) => p !== presa);
    // (le prese dell'altra parte restano com'erano: una muta può essere solo addormentata —
    // un PC in sospensione, il telefono in tasca — e quando batte di nuovo deve trovarsi ancora
    // in stanza; ritirarla senza dirglielo la lascerebbe sorda per sempre, chiuderla costa)
    this.io.scrivi(presa, { ruolo, ...nuovoConto(ora) });
    // TUTTE le altre dello stesso ruolo, non solo la prima: chi si rifà non ne
    // lascia indietro. Quella che ha appena battuto (un'altra scheda, un altro
    // telefono — o chi conosce il numero della stanza ed entra al posto del PC o
    // della stazione) è viva: la chiusura le arriva subito, e un PC o una stazione
    // così riprova da sé e si riprende il posto (mai sorda per sempre: il suo
    // battito lo risponde il ripetitore, non passa di qui). Zitta da più di 30 s
    // è in sottofondo o morta: si ritira, e se torna e parla la chiusura le
    // arriva allora (a una presa morta non si manda niente: costa).
    for (const p of tutte) {
      const st = this.io.leggi(p);
      if (!st || st.via || st.ruolo !== ruolo) continue;
      if (ora - Math.max(st.ultimo || 0, this.io.battito(p) || 0) <= PONTE.vivoMs) this.chiudi(p, st, 4001, "sostituita", false, ora);
      else this.ritira(p, st, 4001, false, ora);   // (al posto suo c'è già quella nuova: nessun avviso)
    }
    const ritirate = tutte.filter((p) => this.io.leggi(p)?.via && !this.io.leggi(p).chiusa);
    if (ritirate.length > PONTE.ritirateMax) {
      ritirate.sort((x, y) => (this.io.leggi(x).ultimo || 0) - (this.io.leggi(y).ultimo || 0));
      for (const p of ritirate.slice(0, ritirate.length - PONTE.ritirateMax)) {
        const st = this.io.leggi(p);
        this.io.chiudi(p, st.via, "troppe");
        try { this.io.scrivi(p, { ...st, chiusa: true }); } catch { /* chiusa intanto */ }
      }
    }
    const altra = this.presa(altroRuolo(ruolo), presa);
    this.io.invia(presa, presenza(!!altra));
    if (altra) this.io.invia(altra, presenza(true));
  }
  messaggio(presa, dati, ora) {
    const st = this.io.leggi(presa);
    if (!st) return;
    // ritirata, e invece parla: è viva, e la chiusura le arriva
    if (st.via) {
      if (!st.chiusa) {
        this.io.chiudi(presa, st.via, st.via === 4001 ? "sostituita" : "inattiva");
        try { this.io.scrivi(presa, { ...st, chiusa: true }); } catch { /* chiusa intanto */ }
      }
      return;
    }
    const c = contaFrame(st, byteDi(dati), ora);
    if (!c.ok) { this.chiudi(presa, st, c.codice, c.perche, true, ora); return; }
    this.io.scrivi(presa, { ...st, ...c.conto });
    // il testo è solo il battito (a cui risponde chi sta sotto): non si inoltra
    if (typeof dati === "string") return;
    const altra = this.presa(altroRuolo(st.ruolo), presa);
    if (!altra) return;
    this.io.osserva?.(dati);
    this.io.invia(altra, dati);
  }
  // Esce una presa (chiusa dall'altro capo, o caduta)
  esce(presa, ora) {
    const st = this.io.leggi(presa);
    if (st && !st.via) this.avvisa(presa, st, ora);
  }
  // l'altra parte sa che questa presa non c'è più
  avvisa(presa, st, ora) {
    if (this.presa(st.ruolo, presa)) return;   // sostituita: dall'altra parte non cambia niente
    const altra = this.presa(altroRuolo(st.ruolo), presa);
    if (altra) this.io.invia(altra, presenza(false));
  }
  // Fuori dai conti, senza niente sulla rete. Una presa che non ha mai battuto
  // (morta prima del primo «ping», o chissà) si chiude davvero: così, se è viva, lo sa.
  ritira(p, st, codice, avvisa, ora) {
    if (codice === 4002 && !this.io.battito(p)) { this.chiudi(p, st, codice, "inattiva", avvisa, ora); return; }
    if (avvisa) this.avvisa(p, st, ora);
    try { this.io.scrivi(p, { ...st, via: codice }); } catch { /* chiusa intanto */ }
  }
  // La chiude il ripetitore (una presa viva: troppo grande, troppi messaggi)
  chiudi(p, st, codice, perche, avvisa, ora) {
    this.io.chiudi(p, codice, perche);
    if (avvisa) this.avvisa(p, st, ora);
    try { this.io.scrivi(p, { ...st, via: codice, chiusa: true }); } catch { /* chiusa intanto */ }
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
    "permissions-policy": "camera=(self), microphone=(), geolocation=()",   // la fotocamera: «Scansiona il QR»
  };
}
