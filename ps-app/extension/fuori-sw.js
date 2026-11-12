/*
 * PS Assist — nel service worker (importato da bg.js): il documento fuori
 * schermo (fuori.html, chrome.offscreen) e le prese verso il ripetitore che ci
 * vivono.
 *
 * Perché: su Chrome 109 (i PC di reparto con Windows 7/8) Chrome ferma il
 * service worker una trentina di secondi dopo ogni risveglio, e niente lo
 * tiene sveglio (le chiamate all'estensione contano solo dalla 110, il
 * traffico di una WebSocket solo dalla 116). Una presa nel service worker
 * muore con lui, e a ogni risveglio se ne apriva una nuova: per il ripetitore
 * (un Durable Object che si sveglia a ogni presa che entra) un costo, per l'IT
 * dell'ospedale un segnale ogni minuto. Il documento fuori schermo c'è da
 * Chrome 109 e sopravvive ai riavvii del service worker: la presa si apre una
 * volta, quando serve, e resta finché serve. Solo il traffico vero (un
 * messaggio che arriva) sveglia il service worker.
 *
 * Uno solo per l'estensione (una regola di Chrome): lo stesso documento fa
 * anche lo zip del registratore (registra.js), che non lo chiude mai sotto le
 * prese — lo chiude chi lo lascia per ultimo (fuoriForseChiudi).
 *
 * Qui, per ogni presa, un `Presa`: quello che le pagine del service worker
 * (ponte-sw.js, stazione-sw.js) usano — `servi` (fin quando serve), `tieni`,
 * `ferma`, `manda`, `su`, `pari`, `pronta`. Le sessioni e le chiavi restano nel
 * service worker: al documento va solo quello che è già cifrato.
 *
 * Il ripiego: senza chrome.offscreen, o se il documento non si apre, la presa
 * sta nel service worker come fino alla 3.86 (presa.js, la stessa presa), con
 * i risvegli di allora — e ancora solo quando serve.
 */
/* global PresaWs */

const FUORI_URL = "fuori.html";
const FUORI_RIPIEGO = "fuori.ripiego";      // storage.session: il documento non si è aperto (in questa sessione del browser non si riprova)
const FUORI = {
  dopo: 2 * 60e3,          // quanto resta una presa dopo che non serve più (i test lo accorciano)
  ripiego: !(chrome.offscreen && chrome.offscreen.createDocument),
  aperto: false,           // l'ultima volta che si è guardato, c'era (e rispondeva)
  motivi: new Set(),       // chi tiene il documento oltre le prese: «registra» (uno zip in corso)
  prese: new Map(),        // nome → Presa
  fila: Promise.resolve(), // il documento (aprirlo, chiuderlo) e le richieste alle prese: una cosa alla volta
  tChiudi: 0,
};
const fuoriOra = () => Date.now();
const fuoriAttendi = (ms) => new Promise((r) => setTimeout(r, ms));
const fuoriB64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fuoriDaB64 = (t) => {
  const s = atob(String(t || ""));
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
};
const fuoriRipiego = () => FUORI.ripiego;

// Al documento: la sua risposta, o null se non c'è (nessuno ascolta).
async function fuoriChiedi(m) {
  try { return (await chrome.runtime.sendMessage(m)) || null; }
  catch { return null; }
}
// C'è, e risponde? (Chrome 109 non ha runtime.getContexts: si chiede a lui.)
async function fuoriPing() {
  const r = await fuoriChiedi({ t: "fuoriPing" });
  return r && r.ok && r.fuori ? r : null;
}
async function fuoriRipiega(e) {
  if (FUORI.ripiego) return;
  FUORI.ripiego = true;
  console.warn("PS Assist: il documento fuori schermo non si apre, le prese restano nel service worker", e);
  await chrome.storage.session.set({ [FUORI_RIPIEGO]: { ts: fuoriOra(), why: String(e && e.message || e).slice(0, 120) } }).catch(() => {});
}
// Il documento, aperto se manca. true: c'è e risponde. `forza`: anche in ripiego (lo zip del
// registratore non ha un'altra strada: ci prova lo stesso, come prima).
async function fuoriApriOra(forza = false) {
  if (!(chrome.offscreen && chrome.offscreen.createDocument)) return false;
  if (FUORI.ripiego && !forza) return false;
  clearTimeout(FUORI.tChiudi); FUORI.tChiudi = 0;
  if (await fuoriPing()) return (FUORI.aperto = true);
  try {
    await chrome.offscreen.createDocument({ url: FUORI_URL, reasons: ["DOM_PARSER", "BLOBS"],
      justification: "Tiene la connessione cifrata verso il ponte dell'iPhone e della stazione di stampa, e salva lo zip delle registrazioni, senza aprire schede" });
  } catch (e) {
    // (c'è già, e non ha ancora risposto: lo si aspetta qui sotto)
    if (!/single|only one|already/i.test(String(e && e.message || e))) { if (!forza) await fuoriRipiega(e); return false; }
  }
  for (let k = 0; k < 50; k++) {
    if (await fuoriPing()) return (FUORI.aperto = true);
    await fuoriAttendi(100);
  }
  if (!forza) await fuoriRipiega(new Error("il documento fuori schermo non risponde"));
  return false;
}
const fuoriInFila = (fn) => { const p = FUORI.fila.then(fn, fn); FUORI.fila = p.catch(() => {}); return p; };
const fuoriApri = (forza = false) => fuoriInFila(() => fuoriApriOra(forza));
// Chiuso quando nessuno lo usa più: nessuna presa tenuta, nessuno zip. (Un po' dopo: una presa
// che si richiude e si riapre subito non lo fa nascere due volte.)
function fuoriForseChiudi(ms = 10e3) {
  clearTimeout(FUORI.tChiudi);
  FUORI.tChiudi = setTimeout(() => {
    FUORI.tChiudi = 0;
    fuoriInFila(async () => {
      if (FUORI.motivi.size || [...FUORI.prese.values()].some((p) => p.tenuta && !p.locale)) return;
      const r = await fuoriPing();
      if (!r) { FUORI.aperto = false; return; }
      // (uno zip in corso là, anche se questo service worker non lo sa: è ripartito a metà)
      if (r.occupato) return;
      // (lo stato vero è il suo: una presa tenuta là non si chiude da qui)
      if (Object.values(r.prese || {}).some((s) => s && s.url)) return;
      await chrome.offscreen.closeDocument().catch(() => {});
      FUORI.aperto = false;
    });
  }, ms);
}
// Il registratore (registra.js): il documento per uno zip, e poi lo lascia.
// (Lo sa anche il documento: un service worker che riparte a metà zip non lo chiude sotto.)
const fuoriPrendi = async (motivo) => {
  FUORI.motivi.add(motivo);
  const ok = await fuoriApri(true);
  if (ok) await fuoriChiedi({ t: "fuoriPrendi", motivo });
  return ok;
};
const fuoriLascia = (motivo) => {
  FUORI.motivi.delete(motivo);
  if (!FUORI.motivi.size) fuoriChiedi({ t: "fuoriLascia" });
  fuoriForseChiudi(1000);
};

// ------------------------------------------------------------------ una presa
class Presa {
  // ascolta: { dati(Uint8Array), pari(bool), stato() }
  constructor(nome, ascolta = {}) {
    Object.assign(this, { nome, ascolta, url: "", su: false, pari: false, fino: 0, fermo: 0, codice: 0, collego: false, prossimo: 0,
      vita: "", ver: 0, persi: 0, locale: null, filaM: Promise.resolve() });
    FUORI.prese.set(nome, this);
  }
  get tenuta() { return !!this.url; }
  // (aperta o in apertura: come la `ws` di prima)
  get ws() { return this.url && (this.su || this.collego) ? this : null; }
  stato() { return { url: this.url, su: this.su, pari: this.pari, fino: this.fino, fermo: this.fermo, codice: this.codice, collego: this.collego, prossimo: this.prossimo }; }
  // lo stato vero, dal documento (o dalla presa qui, nel ripiego)
  applica(s) {
    if (!s) return;
    // (uno stato più vecchio di quello che si sa, arrivato dopo per l'altra strada — la risposta a «tieni» e i
    // messaggi del documento non si aspettano —: si ignora; un documento nuovo ricomincia a contare)
    if (s.vita && Number.isSafeInteger(s.ver)) {
      if (s.vita === this.vita && s.ver <= this.ver) return;
      this.vita = s.vita; this.ver = s.ver;
    }
    const prima = this.stato();
    this.url = String(s.url || "");
    this.su = !!s.su; this.pari = !!s.pari; this.collego = !!s.collego;
    this.fino = s.fino === null ? null : Number(s.fino) || 0;
    this.fermo = Number(s.fermo) || 0; this.codice = Number(s.codice) || 0; this.prossimo = Number(s.prossimo) || 0;
    if (prima.pari !== this.pari) { try { this.ascolta.pari && this.ascolta.pari(this.pari); } catch { /* niente */ } }
    if (prima.su !== this.su || prima.url !== this.url || prima.collego !== this.collego || prima.fermo !== this.fermo) {
      try { this.ascolta.stato && this.ascolta.stato(); } catch { /* niente */ }
    }
  }
  arriva(b) { try { this.ascolta.dati && this.ascolta.dati(b); } catch { /* niente */ } }
  // Tenuta verso `url` fino a `fino` (null: senza scadenza; 0: chiusa). Vedi presa.js.
  tieni(url, fino, subito = false) {
    const chiudi = !url || fino === 0 || (fino != null && !(fino > fuoriOra()));
    return fuoriInFila(async () => {
      if (FUORI.ripiego || this.locale) return this.tieniQui(url, fino, subito);
      // (niente da chiudere: il documento non si apre per questo)
      if (chiudi && !this.tenuta && !FUORI.aperto) return;
      for (let k = 0; k < 2; k++) {
        if (!chiudi && !(await fuoriApriOra())) return this.tieniQui(url, fino, subito);
        const r = await fuoriChiedi({ t: "fuoriTieni", nome: this.nome, url: chiudi ? "" : url, fino: chiudi ? 0 : fino, subito: !!subito });
        if (r && r.ok) { this.applica(r.stato || { url: "" }); break; }
        // il documento non c'è più (Chrome l'ha chiuso, per la memoria): un altro, una volta
        FUORI.aperto = false;
        if (chiudi) { this.applica({ url: "" }); break; }
      }
      if (chiudi) fuoriForseChiudi();
    });
  }
  // il ripiego: la presa qui, nel service worker
  tieniQui(url, fino, subito) {
    if (!this.locale) this.locale = new PresaWs(this.nome, { dati: (b) => this.arriva(new Uint8Array(b)), stato: (s) => this.applica(s) });
    this.locale.tieni(url, fino, subito);
    this.applica(this.locale.stato());
  }
  // Fin quando serve: `fine` è l'ora fino a cui serve di sicuro — Infinity (una
  // scheda del gestionale aperta, una pagina, un lavoro), un'ora (un QR, un'offerta),
  // o 0 (niente serve: resta ancora FUORI.dopo da adesso, se c'era, e poi via).
  // Una presa chiusa non si apre per niente; una che serve sì.
  servi(url, fine, subito = false) {
    const ora = fuoriOra();
    let fino;
    if (!url) fino = 0;
    else if (fine === Infinity) fino = null;
    else if (fine > ora) fino = fine + FUORI.dopo;
    else fino = this.tenuta && this.url === url ? Math.min(this.fino == null ? Infinity : this.fino, ora + FUORI.dopo) : 0;
    if (fino != null && fino !== 0 && fino <= ora) fino = 0;
    // (com'era: niente da dire — una pagina del gestionale dopo l'altra non manda niente al documento)
    if (fino === 0 && !this.tenuta) return Promise.resolve();
    if (!subito && fino !== 0 && this.url === url && this.fino === fino && !this.fermo) return Promise.resolve();
    return this.tieni(url, fino, subito);
  }
  ferma() { return this.tieni("", 0); }
  battito() { /* il battito lo fa la presa (presa.js), dov'è */ }
  // Un messaggio cifrato verso l'altra parte: true se è partito. Uno alla volta, nell'ordine.
  manda(f) {
    const b = f instanceof Uint8Array ? f : new Uint8Array(f);
    if (this.locale) return Promise.resolve(this.locale.manda(b));
    // (se è aperta lo sa il documento: qui basta la stanza — uno stato in ritardo non fa perdere un messaggio)
    if (!this.url) { this.persi++; return Promise.resolve(false); }
    const url = this.url, nome = this.nome, testo = fuoriB64(b);
    const p = this.filaM.then(() => fuoriChiedi({ t: "fuoriManda", nome, url, b: testo })).then((r) => { if (!(r && r.ok)) this.persi++; return !!(r && r.ok); }, () => { this.persi++; return false; });
    this.filaM = p;
    return p;
  }
  // aperta e con qualcuno dall'altra parte, entro `ms`
  async pronta(ms) {
    const fine = fuoriOra() + ms;
    while (!this.su && fuoriOra() < fine) await fuoriAttendi(100);
    if (!this.su) return false;
    const pari = Math.min(fine, fuoriOra() + 1500);
    while (!this.pari && fuoriOra() < pari) await fuoriAttendi(100);
    return this.pari;
  }
}

// Riavviato, il service worker chiede al documento (se c'è: non lo apre) com'è ogni presa.
const fuoriCaricato = (async () => {
  if (!FUORI.ripiego && (await chrome.storage.session.get(FUORI_RIPIEGO).catch(() => ({})))[FUORI_RIPIEGO]) FUORI.ripiego = true;
  if (FUORI.ripiego) return;
  const r = await fuoriPing();
  FUORI.aperto = !!r;
  if (r) for (const [nome, s] of Object.entries(r.prese || {})) FUORI.prese.get(nome)?.applica(s);
})().catch(() => {});

// Dal documento: un messaggio che arriva su una presa, e com'è una presa (aperta, chiusa,
// qualcuno dall'altra parte). È la sola cosa che sveglia il service worker: il battito no.
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || typeof m !== "object" || (m.t !== "fuoriDati" && m.t !== "fuoriStato" && m.t !== "fuoriLibero")) return;
  if (!sender || sender.id !== chrome.runtime.id || sender.tab || !String(sender.url || "").startsWith(chrome.runtime.getURL(FUORI_URL))) return;
  reply({ ok: true });
  fuoriCaricato.then(() => {
    FUORI.aperto = true;
    // (lo zip là è finito, o il «preso» è scaduto: chiuso, se nessuno lo usa più)
    if (m.t === "fuoriLibero") { fuoriForseChiudi(1000); return; }
    const p = FUORI.prese.get(m.nome);
    if (m.t === "fuoriStato") {
      if (p && !p.locale) p.applica(m);
      if (!m.url) fuoriForseChiudi();
      return;
    }
    if (!p || p.locale) return;
    if (m.stato) p.applica(m.stato);
    if (p.url === m.url && typeof m.b === "string") p.arriva(fuoriDaB64(m.b));
  });
});
