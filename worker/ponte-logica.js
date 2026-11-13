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
 * ripetitore dice solo tre cose: se dall'altra parte c'è qualcuno, la sfida
 * dell'entrata, e se la prova è buona.
 * Due tipi di stanza, con la stessa logica: il PC e il suo telefono (`pc`,
 * `tel`), e il PC del medico e la sua stazione di stampa (`medico`,
 * `stazione`; anche la stanza dell'abbinamento, che dura pochi minuti).
 *
 * L'entrata (3.87): conoscere il numero della stanza non basta. Chi entra
 * riceve una sfida (`{"sfida": …}`) e risponde con la prova (`{"prova": [...]}`):
 * HMAC-SHA256 della sfida con la chiave d'entrata del suo ruolo, che il client
 * ricava dalla chiave dell'associazione (ponte-cripto.js, chiaviEntra) — mai
 * nell'indirizzo. La stanza tiene le chiavi d'entrata la prima volta che le
 * sente (trust on first use), per ruolo: il PC (o il PC del medico) registra
 * la sua e quella dell'altro ruolo quando associa, e le cambia (provando con
 * quella di prima) quando la chiave dell'associazione si rinnova. Un ruolo che
 * ha la sua chiave entra solo con la prova: senza, la presa resta fuori dai
 * conti (non sostituisce nessuno, non riceve e non manda niente) e, se parla o
 * tace troppo, si chiude con 4403.
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
  // Per stanza e per ruolo, non per presa (chi rifà la presa non riparte da zero): le entrate al minuto, e
  // i messaggi e i byte al minuto (il telefono manda al più un PDF di 15 MB alla volta; il PC uno zip fino a 100 MB)
  entrateAlMinuto: 60,
  stanzaAlMinuto: { n: 2400, byte: { pc: 256 << 20, tel: 64 << 20, medico: 64 << 20, stazione: 16 << 20 } },
  // Il passaggio: un ruolo che non ha ancora la sua chiave d'entrata in questa stanza entra anche senza
  // prova, come fino alla 3.86 (i client di prima non la sanno dare), e lo si scrive nel log (senza la
  // stanza). Il giorno del taglio diventa false: entra solo chi prova, o chi registra la sua chiave in una
  // stanza nuova.
  senzaProva: true,
  provaMs: 10e3,              // una presa che deve provare e non lo fa in tanto: fuori (4403)
  // Le prese che non hanno ancora provato, per ruolo, tutte insieme: oltre, la più vecchia esce. Non
  // consumano le entrate al minuto (quelle si contano solo a chi è entrato davvero): chi sa solo il numero
  // della stanza non chiude fuori chi ha la chiave.
  inAttesaMax: 4,
};
export const PING = "ping";
export const PONG = "pong";
const ALTRO = { pc: "tel", tel: "pc", medico: "stazione", stazione: "medico" };
const RUOLI = new Set(Object.keys(ALTRO));
export const altroRuolo = (r) => ALTRO[r];
const CAPO = new Set(["pc", "medico"]);   // chi può dire alla stanza anche la chiave dell'altro ruolo

// I file dell'app del telefono, e solo questi: un altro indirizzo sotto
// /ponte/ è un 404, mai la pagina del sito. (Gli stessi del suo sw.js.)
export const FILE_APP = new Set(["", "app.js", "app.css", "cripto.js", "etichetta.js", "jsqr.min.js", "sw.js", "manifest.webmanifest",
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

// ------------------------------------------------------ la prova della chiave
// SHA-256 e HMAC qui, senza dipendenze e sincroni: la stanza risponde a un messaggio alla volta, e lo
// stesso codice gira nel Durable Object e nel ripetitore Node dei test.
const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
  0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
  0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256(dati) {
  const l = dati.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
  m.set(dati); m[l] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(n - 8, Math.floor(l / 2 ** 29)); dv.setUint32(n - 4, (l << 3) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}
export function hmac(chiave, dati) {
  const k = chiave.length > 64 ? sha256(chiave) : chiave;
  const ip = new Uint8Array(64 + dati.length), op = new Uint8Array(96);
  for (let i = 0; i < 64; i++) { ip[i] = (k[i] || 0) ^ 0x36; op[i] = (k[i] || 0) ^ 0x5c; }
  ip.set(dati, 64);
  op.set(sha256(ip), 64);
  return sha256(op);
}
const b64u = (b) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const daB64u = (t) => {
  if (typeof t !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(t)) return null;
  try { return Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0)); } catch { return null; }
};
// La risposta giusta alla sfida, per una chiave d'entrata (32 byte, base64url): la stessa che calcola il
// client (ponte-cripto.js, provaEntra).
export const PROVA_ETICHETTA = "ps-ponte/entra|";
export function provaDi(chiave, sfida) {
  const k = daB64u(chiave);
  return k && k.length === 32 ? b64u(hmac(k, new TextEncoder().encode(PROVA_ETICHETTA + sfida))) : "";
}
const uguali = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const chiaveValida = (c) => { const k = daB64u(c); return !!k && k.length === 32; };
const chiaviValide = (l, max) => (Array.isArray(l) ? l : [l]).filter(chiaveValida).slice(0, max);
// Una chiave d'entrata con la sua scadenza (P2-8: quelle del QR valgono solo la sua finestra, e la stanza
// lo sa da sé, senza aspettare il PC): «chiave» o { c, fino }. Nella stanza si tengono così.
const conScadenza = (l, max) => (Array.isArray(l) ? l : [l]).map((x) => (typeof x === "string" ? { c: x }
  : x && typeof x === "object" ? { c: x.c, ...(Number.isSafeInteger(x.fino) && x.fino > 0 ? { fino: x.fino } : {}) } : null))
  .filter((x) => x && typeof x.c === "string" && chiaveValida(x.c)).slice(0, max);
// lo SQLite del Durable Object che non c'è o non risponde: la stanza si chiude (P2-9), mai una memoria al suo posto
class Guasto extends Error {}
const sfidaNuova = () => b64u(globalThis.crypto.getRandomValues(new Uint8Array(16)));

/*
 * La stanza, sopra un adattatore che sa parlare con le prese vere:
 *   io.tutte()                  tutte le prese della stanza
 *   io.aperta(presa)            è aperta (readyState OPEN)
 *   io.invia(presa, dati)       manda così com'è
 *   io.chiudi(presa, codice, perché)
 *   io.leggi(presa) / io.scrivi(presa, stato)   lo stato attaccato alla presa
 *   io.battito(presa)           l'ora dell'ultimo «ping» (0: mai)
 *   io.archivio?                quello che la stanza tiene (le chiavi d'entrata): { leggi(k), scrivi(k, v) };
 *                               senza, il ripetitore si comporta come fino alla 3.86 (nessuna prova)
 *   io.conti?                   i conti della stanza al minuto, in memoria: { get(k), set(k, v) }
 *   io.nota?(cosa)              una riga di log, senza la stanza (le entrate senza prova del passaggio)
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
 * Lo stato di una presa: { ruolo, inizio, n, ultimo, sfida }, `attende` finché
 * deve ancora provare la chiave, `provata` quando l'ha provata, e `via` (4001
 * sostituita, 4002 muta, o il codice con cui il ripetitore l'ha chiusa) quando
 * è fuori dai conti; `chiusa` quando la chiusura è partita davvero.
 */
export class Stanza {
  constructor(io) { this.io = io; }
  // la presa di quel ruolo (non `escluso`): aperta, non ritirata, entrata davvero
  presa(ruolo, escluso) {
    return this.io.tutte().find((p) => {
      const st = p !== escluso && this.io.aperta(p) && this.io.leggi(p);
      return st && st.ruolo === ruolo && !st.via && !st.attende;
    }) || null;
  }
  // tace da troppo (nemmeno il battito)
  muta(p, st, ora) { return ora - Math.max(st.ultimo || 0, this.io.battito(p) || 0) > PONTE.inattivoMs; }
  // le chiavi d'entrata di un ruolo, in questa stanza ([] = nessuna: entra chiunque, nel passaggio)
  // (scadute non contano: P2-8). L'archivio guasto o che non risponde: Guasto — chi entra esce (1011), mai
  // «nessuna chiave», che nel passaggio vorrebbe dire «entra chiunque, e il primo si registra».
  // (`scadute`: anche quelle — un ruolo che ha avuto una chiave deve provare, anche se è scaduta)
  chiavi(ruolo, ora = Date.now(), scadute = false) {
    const a = this.io.archivio;
    if (!a) return [];
    if (a.guasto) throw new Guasto("archivio");
    let v;
    try { v = a.leggi("entra:" + ruolo); } catch { throw new Guasto("archivio"); }
    return conScadenza(v || [], 4).filter((x) => scadute || !x.fino || x.fino > ora).map((x) => x.c);
  }
  // true se scritta (e riletta uguale)
  scriviChiavi(ruolo, l) {
    const a = this.io.archivio;
    if (!a || a.guasto) return false;
    try {
      const v = conScadenza(l, 4);
      a.scrivi("entra:" + ruolo, v);
      return JSON.stringify(conScadenza(a.leggi("entra:" + ruolo) || [], 4)) === JSON.stringify(v);
    } catch { return false; }
  }
  // l'archivio non c'è: la presa esce con 1011, e i log lo gridano
  guasto(presa, ruolo, ora) {
    this.io.nota?.({ ponte: "ARCHIVIO NON DISPONIBILE: la stanza non accetta nessuno", ruolo });
    try { this.io.scrivi(presa, { ruolo, ...nuovoConto(ora), via: 1011, chiusa: true }); } catch { /* chiusa */ }
    this.io.chiudi(presa, 1011, "archivio");
  }
  // un conto al minuto della stanza (non della presa): true se si è oltre
  oltre(nome, n, max, ora) {
    const c = this.io.conti;
    if (!c) return false;
    let x = c.get(nome);
    if (!x || ora - x.inizio >= 60e3) x = { inizio: ora, n: 0 };
    x = { inizio: x.inizio, n: x.n + n };
    c.set(nome, x);
    return x.n > max;
  }
  // Troppe entrate in un minuto, per questo ruolo: fuori subito (chi rifà la presa a raffica). Si contano solo
  // le entrate vere — dopo la prova, o senza prova nel passaggio — così chi sa solo il numero della stanza non
  // consuma il conto di chi ha la chiave (P2-2). true se fuori.
  troppe(presa, st, ora) {
    if (!this.oltre("entrate:" + st.ruolo, 1, PONTE.entrateAlMinuto, ora)) return false;
    this.chiudi(presa, st, 1013, "troppe entrate", false, ora);
    return true;
  }
  entra(presa, ruolo, ora) {
    this.pulisci(presa, ruolo, ora);
    const sfida = sfidaNuova();
    let note;
    try { note = this.chiavi(ruolo, ora, true); } catch { this.guasto(presa, ruolo, ora); return; }
    // Un ruolo con la sua chiave (o, dopo il taglio, qualunque ruolo): entra solo con la prova. Dopo il taglio la
    // sfida lo dice (`obbligo`): il PC (o il PC del medico) dà allora alla stanza anche le chiavi dell'altro ruolo.
    if (this.io.archivio && (note.length || !PONTE.senzaProva)) {
      this.io.scrivi(presa, { ruolo, ...nuovoConto(ora), sfida, attende: true });
      this.io.invia(presa, JSON.stringify({ sfida, ...(PONTE.senzaProva ? {} : { obbligo: 1 }) }));
      return;
    }
    const st = { ruolo, ...nuovoConto(ora), sfida };
    this.io.scrivi(presa, st);
    if (this.troppe(presa, st, ora)) return;
    this.ammetti(presa, ruolo, ora);
    if (this.io.archivio) this.io.invia(presa, JSON.stringify({ sfida }));
  }
  // Le prese che dovevano provare e non l'hanno fatto in tempo: fuori, con 4403 (non quelle che aspettano che il
  // PC dia la loro chiave: `aspetta`). E di `ruolo` al più PONTE.inAttesaMax ancora da provare, con quella che
  // entra: oltre, le più vecchie escono (4403).
  pulisci(escluso, ruolo, ora) {
    const attese = [];
    for (const p of this.io.tutte()) {
      const st = p !== escluso && this.io.leggi(p);
      if (!st || !st.attende || st.via) continue;
      if (!st.aspetta && ora - (st.inizio || 0) > PONTE.provaMs) { this.chiudi(p, st, 4403, "prova mancante", false, ora); continue; }
      if (st.ruolo === ruolo) attese.push([p, st]);
    }
    attese.sort((a, b) => (a[1].inizio || 0) - (b[1].inizio || 0));
    const via = attese.length - (PONTE.inAttesaMax - 1);
    for (const [p, st] of attese.slice(0, Math.max(0, via))) this.chiudi(p, st, 4403, "troppe in attesa", false, ora);
  }
  // Entrata davvero: prende il posto di quelle di prima del suo ruolo, e chi c'è lo sa.
  ammetti(presa, ruolo, ora) {
    const tutte = this.io.tutte().filter((p) => p !== presa);
    // (le prese dell'altra parte restano com'erano: una muta può essere solo addormentata —
    // un PC in sospensione, il telefono in tasca — e quando batte di nuovo deve trovarsi ancora
    // in stanza; ritirarla senza dirglielo la lascerebbe sorda per sempre, chiuderla costa)
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
      if (st.attende) { this.chiudi(p, st, 4001, "sostituita", false, ora); continue; }
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
  // La risposta alla sfida: `prova` (una o più HMAC, una per chiave che il client ha), e — dal PC —
  // `chiave` (la sua chiave d'entrata: la prima volta si registra, poi si cambia solo provando con
  // quella di prima) e `altro` (le chiavi d'entrata dell'altro ruolo, che il PC conosce).
  prova(presa, st, m, ora) {
    const prove = (Array.isArray(m.prova) ? m.prova : [m.prova]).filter((x) => typeof x === "string").slice(0, 4);
    let note;
    let mai;   // (il ruolo non ha mai avuto una chiave qui: nemmeno una scaduta)
    try { note = this.chiavi(st.ruolo, ora); mai = !this.chiavi(st.ruolo, ora, true).length; } catch { this.guasto(presa, st.ruolo, ora); return; }
    // (la propria chiave la registra solo il PC — o il PC del medico —: quella del telefono, o della
    // stazione, gliela dà lui, così chi sa solo il numero della stanza non può prenotarsi il posto)
    const nuova = CAPO.has(st.ruolo) && chiaveValida(m.chiave) ? m.chiave : "";
    // chi ha già la sua chiave qui si prova contro quella; la prima volta, contro quella che porta
    const contro = note.length ? note : nuova ? [nuova] : [];
    let i = -1;
    for (let j = 0; j < prove.length && i < 0; j++) if (contro.some((c) => uguali(prove[j], provaDi(c, st.sfida)))) i = j;
    if (i < 0) {
      // (P1) dopo il taglio, il telefono o la stazione di una stanza dove il PC non ha ancora dato la loro
      // chiave: non esce — aspetta (senza ricevere niente, senza scadenza) che il PC la dia, e allora ha
      // una sfida nuova (risfida). Quante ne aspettano: al più PONTE.inAttesaMax (pulisci).
      // Solo se il ruolo non ha MAI avuto una chiave qui: con chiavi soltanto scadute (quelle del QR, mai rinnovate) il
      // PC non ne darà altre — 4403, «Scollegato» (serve un QR nuovo), non un'attesa muta per sempre.
      if (st.attende && mai && !CAPO.has(st.ruolo)) { this.io.scrivi(presa, { ...st, sfida: "", aspetta: true }); return; }
      // (la prova della sfida di prima, arrivata dopo quella nuova: si aspetta quella giusta — una volta)
      if (st.attende && st.risfidata) { this.io.scrivi(presa, { ...st, risfidata: false }); return; }
      if (st.attende) this.chiudi(presa, st, 4403, "prova sbagliata", false, ora);
      // (entrata senza prova nel passaggio, e la prova non torna: resta com'era — nessuno le ha ancora dato la chiave)
      return;
    }
    // la sfida vale una volta sola
    const dopo = { ...st, sfida: "", provata: true, attende: false, aspetta: false };
    this.io.scrivi(presa, dopo);
    // (la prima chiave della stanza che non si riesce a scrivere: non si entra — 1011, il PC riprova)
    let registrata = null;
    if (nuova && !(note.length === 1 && note[0] === nuova)) {
      registrata = this.scriviChiavi(st.ruolo, [nuova]);
      if (!registrata && !note.length) { this.chiudi(presa, dopo, 1011, "archivio", false, ora); return; }
    }
    if (st.attende && this.troppe(presa, dopo, ora)) return;
    if (CAPO.has(st.ruolo) && m.altro != null) {
      const l = conScadenza(m.altro, 3);
      if (l.length && this.scriviChiavi(altroRuolo(st.ruolo), l)) this.risfida(altroRuolo(st.ruolo), ora);
    }
    // `registrata`: la chiave nuova che il PC ha portato è scritta (P3: solo allora butta quella di prima)
    this.io.invia(presa, JSON.stringify({ entrato: i, ...(registrata === null ? {} : { registrata }) }));
    if (st.attende) this.ammetti(presa, st.ruolo, ora);
  }
  // Il PC ha appena dato alla stanza le chiavi di quel ruolo: chi aspettava (o doveva ancora provare) ha una
  // sfida nuova, e il tempo per provare riparte.
  risfida(ruolo, ora) {
    for (const p of this.io.tutte()) {
      const st = this.io.leggi(p);
      if (!st || st.via || !st.attende || st.ruolo !== ruolo || !this.io.aperta(p)) continue;
      const sfida = sfidaNuova();
      this.io.scrivi(p, { ...st, sfida, aspetta: false, inizio: ora, risfidata: !st.aspetta });
      this.io.invia(p, JSON.stringify({ sfida }));
    }
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
    // la risposta alla sfida (testo, piccolo)
    if (typeof dati === "string" && st.sfida && dati.length < 2000 && dati.startsWith("{")) {
      let m = null;
      try { m = JSON.parse(dati); } catch { /* sotto */ }
      if (m && typeof m === "object" && "prova" in m) { this.prova(presa, st, m, ora); return; }
    }
    // deve ancora provare: qualunque altra cosa la chiude (un client che non sa provare: 4403, «scollegato»)
    if (st.attende) {
      if ((!st.aspetta && ora - (st.inizio || 0) > PONTE.provaMs) || typeof dati !== "string") this.chiudi(presa, st, 4403, "prova mancante", false, ora);
      return;
    }
    const c = contaFrame(st, byteDi(dati), ora);
    if (!c.ok) { this.chiudi(presa, st, c.codice, c.perche, true, ora); return; }
    // entrata senza prova (il passaggio: un client della 3.86): una riga di log, la prima volta che parla
    const nota = !st.provata && !st.notata && this.io.archivio && typeof dati !== "string";
    if (nota) this.io.nota?.({ ponte: "entrata senza prova", ruolo: st.ruolo });
    this.io.scrivi(presa, { ...st, ...c.conto, ...(nota ? { notata: true } : {}) });
    // il testo è solo il battito (a cui risponde chi sta sotto): non si inoltra
    if (typeof dati === "string") return;
    // i conti della stanza, per ruolo: rifare la presa non li azzera
    if (this.oltre("messaggi:" + st.ruolo, 1, PONTE.stanzaAlMinuto.n, ora)
      || this.oltre("byte:" + st.ruolo, byteDi(dati), PONTE.stanzaAlMinuto.byte[st.ruolo] || PONTE.stanzaAlMinuto.byte.tel, ora)) {
      this.chiudi(presa, st, 1008, "troppi messaggi nella stanza", true, ora);
      return;
    }
    const altra = this.presa(altroRuolo(st.ruolo), presa);
    if (!altra) return;
    this.io.osserva?.(dati);
    this.io.invia(altra, dati);
  }
  // Esce una presa (chiusa dall'altro capo, o caduta)
  esce(presa, ora) {
    const st = this.io.leggi(presa);
    if (st && !st.via && !st.attende) this.avvisa(presa, st, ora);
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
  // La chiude il ripetitore (una presa viva: troppo grande, troppi messaggi, la prova che manca)
  chiudi(p, st, codice, perche, avvisa, ora) {
    this.io.chiudi(p, codice, perche);
    if (avvisa && !st.attende) this.avvisa(p, st, ora);
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
