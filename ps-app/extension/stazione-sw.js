/*
 * PS Assist — la STAZIONE DI STAMPA, nel service worker (importato da bg.js).
 *
 * Le stampanti dell'infermiera (l'etichettatrice e l'A4) sono attaccate al suo
 * PC, con un cavo: dal PC del medico non si vedono. Su quel PC c'è la stessa
 * estensione con lo stesso aiutante di stampa, e la sua pagina «Stazione di
 * stampa» (stazione.html) la fa diventare una STAZIONE: riceve i fogli di un
 * ordine dal PC del medico, li stampa sulle sue stampanti e dice com'è andata.
 * Non fa nient'altro: non può mandare un comando al PC del medico, né leggere
 * niente; il PC accetta da lei solo le risposte alle sue domande (`re`), e i
 * saluti della sessione. Dopo la stampa non tiene niente del foglio: solo il
 * suo numero, com'è andata, il tipo e quante pagine (per «Ultimi fogli»).
 *
 * Collegarle (una volta, finché uno dei due non scollega): sulla stazione
 * compare un QR — un'offerta che vale 5 minuti, per un PC solo: la chiave
 * pubblica ECDH (P-256) della stazione e un numero casuale `s` —; l'app
 * dell'iPhone, già associata al PC del medico, lo inquadra e passa l'offerta
 * al PC, dentro il ponte cifrato. Il PC entra nella stanza dell'abbinamento
 * (da `s`), manda la sua chiave pubblica cifrata con una chiave da `s`, e la
 * stazione risponde. La chiave della coppia K nasce da ECDH, dalle due parti:
 * il telefono e il ripetitore vedono l'offerta (o i byte), non K. Il primo
 * saluto con K la conferma, dalle due parti; poi ognuno mostra lo stesso codice
 * di sei cifre (da K).
 *
 * Da lì è la crittografia del ponte (ponte-cripto.js), con i ruoli del ponte: il
 * PC del medico fa il telefono (saluta, chiede), la stazione fa il PC
 * (risponde). Una stanza del ripetitore con i ruoli `medico` e `stazione`. Un
 * foglio passa a pezzi (~390 KB), uno per risposta; la stazione lo stampa solo
 * quando ha l'ultimo, una volta sola per numero (`rq`): rimandato, risponde
 * com'è andata. Se la risposta all'ultimo pezzo si perde, il PC chiede
 * («esito») su una sessione nuova. Quello che il PC non sa, lo dice:
 * «Infermeria non risponde» se nessun foglio è arrivato (non stampato), «forse
 * stampato» se è arrivato e la risposta no. Mai stampato altrove da solo, mai
 * due volte.
 */
/* global PonteCripto, ponteIndirizzo, corto, stampaPdf, ruotaDi, STAMPA_PDF_MAX */

const STA = {
  // sul PC del medico
  coppia: "stazione.coppia",     // storage.local: { k, nome, dal, via, codice, revoca? }
  pubblico: "stazione",          // storage.session: quello che le pagine del PC mostrano (niente chiavi)
  // sulla stazione
  qui: "stazione.qui",           // storage.local: { k, dal, codice, conferma, revoca? }: questo PC è una stazione
  nome: "stazione.nome",         // storage.local: il nome che il medico vede («Infermeria»)
  offerta: "stazione.offerta",   // storage.session: l'offerta del QR, finché vale
  stato: "stazione.stato",       // storage.session: quello che la pagina della stazione mostra
  lavori: "stazione.lavori",     // storage.local: gli ultimi fogli: ora, tipo, pagine, copie, esito — niente pazienti
  rq: "stazione.rq",             // storage.local: i fogli già ricevuti, per numero (stampati una volta sola)
};
const STA_NOME = "Infermeria";
const STA_OFFERTA_MAX = 5 * 60e3;            // il QR vale cinque minuti, per un PC solo
const STA_REVOCA_MAX = 7 * 24 * 3600e3;      // «scollegata» detto all'altro, appena c'è: al più per una settimana
const STA_PEZZO = 4 * 130000;                // caratteri base64 per pezzo (≈ 390 KB), come i PDF del ponte
const STA_BATTITO = 20e3;
// quanto si aspetta (i test li accorciano): il saluto, un pezzo, l'ultimo (l'aiutante ha 90 s), l'esito, l'abbinamento;
// `fresco`: da quanto la stazione non si è fatta sentire perché una sessione vecchia vada prima messa alla prova (con un
// «esito», in lettura, dentro `vivo`) — la presa può dire «c'è» mentre dall'altra parte non arriva più niente
const STA_ATTESA = { saluto: 8e3, pari: 1500, pezzo: 20e3, ultimo: 120e3, esito: 15e3, abbina: 20e3, pong: 10e3, fresco: 20e3, vivo: 5e3 };
const STA_SALE = new TextEncoder().encode("ps-ponte/1");
const staOra = () => Date.now();
const staHhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const staAttendi = (ms) => new Promise((r) => setTimeout(r, ms));
const staUnisci = (...parti) => {
  const out = new Uint8Array(parti.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parti) { out.set(p, i); i += p.length; }
  return out;
};
const staEsa = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const staMisura = (b) => Math.floor(b.length * 3 / 4) - (b.endsWith("==") ? 2 : b.endsWith("=") ? 1 : 0);
async function staHkdf(k, sale, info, n) {
  const base = await crypto.subtle.importKey("raw", k, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sale, info: new TextEncoder().encode(info) }, base, n * 8));
}
const staAes = (raw) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
// la stanza e le due chiavi dell'abbinamento, dal numero casuale dell'offerta
async function staChiaviAbbina(s) {
  return { stanza: staEsa(await staHkdf(s, STA_SALE, "abbina stazione", 16)),
    medico: await staAes(await staHkdf(s, STA_SALE, "abbina medico>stazione", 32)),
    stazione: await staAes(await staHkdf(s, STA_SALE, "abbina stazione>medico", 32)) };
}
// K, dalle due parti: ECDH con la chiave pubblica dell'altro, e l'offerta intera nel sale
async function staChiaveK(priv, pubAltro, s, pubMedico, pubStazione) {
  const altro = await crypto.subtle.importKey("raw", pubAltro, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const z = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: altro }, priv, 256));
  return staHkdf(z, staUnisci(STA_SALE, s, pubMedico, pubStazione), "stazione", 32);
}
const staCodiceOfferta = (s, pub) => PonteCripto.codice(staUnisci(s, pub));
const staUrl = (host, stanza, ruolo) => { const u = new URL(host); return `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}/ponte/ws?r=${stanza}&ruolo=${ruolo}`; };
// L'offerta, come la porta il QR: «<chiave pubblica>.<s>.<scadenza>» (e il nome a parte)
function staOffertaDa(testo) {
  const m = /^([A-Za-z0-9_-]{87})\.([A-Za-z0-9_-]{22})\.(\d{10,15})$/.exec(String(testo || ""));
  if (!m) return null;
  try {
    const pub = PonteCripto.daB64u(m[1]), s = PonteCripto.daB64u(m[2]), scade = Number(m[3]);
    return pub.length === 65 && pub[0] === 4 && s.length === 16 && Number.isSafeInteger(scade) ? { pub, s, scade } : null;
  } catch { return null; }
}

// --------------------------------------------------------------- una presa
// Una WebSocket verso il ripetitore, che si rifà da sola (presto la prima
// volta, poi sempre più di rado fino a 15 secondi), col battito ogni 20
// secondi: se il «pong» non torna, se ne apre un'altra. `pari`: dall'altra
// parte della stanza c'è qualcuno (lo dice il ripetitore).
class StaPresa {
  constructor(ascolta) { Object.assign(this, { ws: null, url: "", su: false, pari: false, tentativi: 0, tRiprova: 0, tPong: 0, ascolta }); }
  apri(url) {
    if (this.ws && this.url === url && this.ws.readyState <= 1) return;
    this.stacca();
    this.url = url;
    clearTimeout(this.tRiprova);
    let ws;
    try { ws = new WebSocket(url); } catch { this.riprova(); return; }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => { if (this.ws !== ws) return; this.su = true; this.tentativi = 0; this.ascolta.stato?.(); };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (ev.data === "pong") { clearTimeout(this.tPong); this.tPong = 0; return; }
      if (typeof ev.data === "string") {
        let m = null;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m && typeof m.pari === "boolean") { this.pari = m.pari; this.ascolta.pari?.(m.pari); }
        return;
      }
      this.ascolta.dati(new Uint8Array(ev.data));
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null; this.su = false; this.pari = false;
      clearTimeout(this.tPong); this.tPong = 0;
      this.ascolta.stato?.(); this.ascolta.pari?.(false);
      this.riprova(ev && ev.code === 4001);
    };
  }
  stacca() {
    const ws = this.ws;
    this.ws = null; this.su = false; this.pari = false;
    clearTimeout(this.tPong); this.tPong = 0;
    if (ws) try { ws.close(1000, "fine"); } catch { /* già chiusa */ }
  }
  ferma() { this.url = ""; clearTimeout(this.tRiprova); this.stacca(); }
  riprova(altrove = false) {
    clearTimeout(this.tRiprova);
    const url = this.url;
    if (!url) return;
    const b = altrove ? 30e3 : Math.min(15e3, 1e3 * 2 ** Math.min(this.tentativi++, 4));
    this.tRiprova = setTimeout(() => { if (this.url === url && !this.ws) this.apri(url); }, Math.round(b / 2 + Math.random() * b / 2));
  }
  manda(f) { if (this.ws && this.ws.readyState === 1) { this.ws.send(f); return true; } return false; }
  battito() {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || this.tPong) return;
    ws.send("ping");
    this.tPong = setTimeout(() => { this.tPong = 0; if (this.ws !== ws) return; const u = this.url; this.stacca(); this.apri(u); }, STA_ATTESA.pong);
  }
  // aperta e con qualcuno dall'altra parte, entro `ms`
  async pronta(ms) {
    const fine = staOra() + ms;
    while (!this.su && staOra() < fine) await staAttendi(100);
    if (!this.su) return false;
    const pari = Math.min(fine, staOra() + STA_ATTESA.pari);
    while (!this.pari && staOra() < pari) await staAttendi(100);
    return this.pari;
  }
}

// ===================================================== il PC del medico
// Manda i fogli di un ordine alla stazione (stazioneStampa, da bg.js) e
// ascolta solo le risposte. Collegato col telefono (stazioneCollega, dal ponte).
const stm = {
  coppia: null, k: null, chiavi: null, chiaviDi: "", host: "",
  sessione: null,      // { canale, n }: la sessione con la stazione (chiavi solo in memoria)
  saluto: null,        // { n, risolvi }: il saluto che aspetta la risposta
  attese: new Map(),   // id → { risolvi, t }: le domande che aspettano la risposta
  id: 0, ignorati: 0, registro: [],
  sentito: 0,          // quando la stazione si è fatta sentire l'ultima volta (la risposta al saluto, o una risposta)
  fila: Promise.resolve(),
};
stm.presa = new StaPresa({
  dati: (b) => { stm.fila = stm.fila.then(() => stmRicevi(b)).catch(() => {}); },
  pari: (si) => { stmScriviStato(); if (si && stm.coppia && stm.coppia.revoca) stmDiRevoca().catch(() => {}); if (!si) stmFineSessione(); },
  stato: () => stmScriviStato(),
});
function stmNota(testo) {
  stm.registro.push({ ts: staOra(), testo: corto(testo, 160) });
  if (stm.registro.length > 30) stm.registro.splice(0, stm.registro.length - 30);
}
const stmAttiva = () => !!stm.coppia && !stm.coppia.revoca;
let stmScritto = "";
function stmScriviStato() {
  const c = stmAttiva() ? stm.coppia : null;
  const s = c ? { nome: c.nome || STA_NOME, dal: c.dal, via: c.via || "", codice: c.codice || "", presente: stm.presa.pari, registro: stm.registro.slice(-10) } : null;
  const firma = JSON.stringify(s);
  if (firma === stmScritto) return Promise.resolve();
  stmScritto = firma;
  return chrome.storage.session.set({ [STA.pubblico]: s }).catch(() => { stmScritto = ""; });
}
let stmFilaAvvio = Promise.resolve();
const stmAvvia = () => (stmFilaAvvio = stmFilaAvvio.then(stmAvviaOra, stmAvviaOra));
async function stmAvviaOra() {
  stm.host = await ponteIndirizzo().catch(() => "");
  let c = (await chrome.storage.local.get(STA.coppia))[STA.coppia] || null;
  if (c && c.revoca && staOra() - c.revoca > STA_REVOCA_MAX) { await chrome.storage.local.remove(STA.coppia); c = null; }
  if (c && stm.chiaviDi !== c.k) {
    try {
      stm.k = PonteCripto.daB64u(c.k);
      stm.chiavi = await PonteCripto.chiaviCoppia(stm.k);
      stm.chiaviDi = c.k;
      stmFineSessione();
    } catch { await chrome.storage.local.remove(STA.coppia); c = null; }
  }
  stm.coppia = c;
  if (!c) { stm.k = null; stm.chiavi = null; stm.chiaviDi = ""; stmFineSessione(); }
  if (c && stm.host) stm.presa.apri(staUrl(stm.host, stm.chiavi.stanza, "medico"));
  else stm.presa.ferma();
  staSveglia();
  await stmScriviStato();
}
function stmFineSessione() {
  stm.sessione = null;
  for (const [id, a] of stm.attese) { clearTimeout(a.t); a.risolvi(null); stm.attese.delete(id); }
}
// Dalla stazione si accetta solo: la risposta al nostro saluto, «riparti», la
// revoca; e le risposte alle nostre domande. Un comando, o qualunque altra
// cosa, si scarta (e si conta: i test lo guardano).
async function stmRicevi(b) {
  if (!stm.chiavi) return;
  const h = PonteCripto.leggiTestata(b);
  if (h && h.tipo === PonteCripto.TIPO.SALUTO_PC) {
    let m;
    try { m = (await PonteCripto.apri(stm.chiavi.salutoPc, b, PonteCripto.TIPO.SALUTO_PC)).dati; } catch { return; }
    if (!m || m.v !== 1) return;
    if (m.revoca) return stmRevocata();
    if (m.revocaVista) { if (stm.coppia && stm.coppia.revoca) { await chrome.storage.local.remove(STA.coppia); await stmAvvia(); } return; }
    // (la stazione non ha più la sessione: le domande in volo non avranno risposta, se ne apre un'altra)
    if (m.riparti) { stmFineSessione(); return; }
    const sa = stm.saluto;
    if (!sa || m.eco !== sa.n || !stmAttiva()) return;
    stm.saluto = null;
    stm.sentito = staOra();
    if (m.no) return sa.risolvi(null);
    try {
      const canale = PonteCripto.canaleTel(await PonteCripto.chiaviSessione(stm.k, PonteCripto.daB64u(sa.n), PonteCripto.daB64u(m.n)));
      stm.sessione = { canale, n: sa.n };
      // il nome lo sceglie la stazione: cambiato là, cambia qui
      const nome = corto(String(m.nome || "").replace(/\s+/g, " ").trim(), 40);
      if (nome && nome !== stm.coppia.nome) { stm.coppia = { ...stm.coppia, nome }; await chrome.storage.local.set({ [STA.coppia]: stm.coppia }); await stmScriviStato(); }
      sa.risolvi(stm.sessione);
    } catch { sa.risolvi(null); }
    return;
  }
  if (h && h.tipo === PonteCripto.TIPO.DATI_PC && stm.sessione) {
    let d;
    try { d = await stm.sessione.canale.decifra(b); } catch { return; }
    stm.sentito = staOra();
    const a = d && Number.isSafeInteger(d.re) ? stm.attese.get(d.re) : null;
    if (!a) { stm.ignorati++; stmNota("La stazione ha mandato qualcosa che non era una risposta: ignorato"); return; }
    stm.attese.delete(d.re);
    clearTimeout(a.t);
    a.risolvi(d);
    return;
  }
  stm.ignorati++;
}
// la sessione con la stazione: quella che c'è, o un saluto nuovo (null: non risponde)
let stmSalutoInCorso = null;
function stmSessione(ms = STA_ATTESA.saluto) {
  if (stm.sessione) return Promise.resolve(stm.sessione);
  if (stmSalutoInCorso) return stmSalutoInCorso;
  stmSalutoInCorso = (async () => {
    if (!stmAttiva() || !(await stm.presa.pronta(ms))) return null;
    const n = PonteCripto.b64u(PonteCripto.casuale(16));
    const r = new Promise((risolvi) => { stm.saluto = { n, risolvi }; });
    if (!stm.presa.manda(await PonteCripto.sigilla(stm.chiavi.salutoTel, PonteCripto.TIPO.SALUTO_TEL, 0, { v: 1, n, dev: "medico" }))) { stm.saluto = null; return null; }
    const s = await Promise.race([r, staAttendi(ms).then(() => null)]);
    if (stm.saluto && stm.saluto.n === n) stm.saluto = null;
    return s;
  })().finally(() => { stmSalutoInCorso = null; });
  return stmSalutoInCorso;
}
// una domanda alla stazione, e la sua risposta (null: nessuna risposta in tempo)
async function stmChiedi(s, obj, ms) {
  if (!s || stm.sessione !== s) return null;
  const id = ++stm.id;
  const f = await s.canale.cifra({ id, ...obj });
  return new Promise((risolvi) => {
    const t = setTimeout(() => { stm.attese.delete(id); risolvi(null); }, ms);
    stm.attese.set(id, { risolvi, t });
    if (!stm.presa.manda(f)) { clearTimeout(t); stm.attese.delete(id); risolvi(null); }
  });
}
// Un foglio alla stazione (dal motore della stampa, bg.js, al posto
// dell'aiutante): lo stesso esito che darebbe l'aiutante — stampato, mandato,
// fallito, sconosciuto — più `nonRisponde` quando non è arrivato niente.
// `rq`: il numero del foglio, lo stesso se lo si rimanda (la stazione lo
// stampa una volta sola).
async function stazioneStampa(tipo, pdf, copie, rq) {
  const c = stm.coppia, nome = (c && c.nome) || STA_NOME;
  const fine = (o) => ({ copie: 1, ...o, stampante: nome, stazione: true, ts: staOra() });
  const nonRisponde = (why = `${nome} non risponde`) => fine({ ok: false, esito: "fallito", why, nonRisponde: true });
  if (!stmAttiva()) return nonRisponde(`${nome} non è più collegata a questo PC`);
  const esitoDa = (d) => fine({ ok: d.esito === "stampato" || d.esito === "mandato", esito: ["stampato", "mandato", "fallito", "sconosciuto"].includes(d.esito) ? d.esito : "sconosciuto",
    why: d.why ? corto(d.why, 200) : "", copie: Number.isInteger(d.copie) ? d.copie : 1, dove: corto(d.stampante, 80) });
  const size = staMisura(pdf), n = Math.max(1, Math.ceil(pdf.length / STA_PEZZO));
  const pezzo = (i) => ({ cmd: "stampa", rq, tipo, copie, i, n, size, b: pdf.slice(i * STA_PEZZO, (i + 1) * STA_PEZZO) });
  // Una sessione che non si sente da un po' può essere un fantasma (il ripetitore ha la presa, la
  // stazione non riceve più): prima di mandare un foglio la si mette alla prova, in sola lettura.
  // Niente risposta: una sessione nuova; niente nemmeno da quella: non è partito niente, «non risponde» e basta.
  let s0 = await stmSessione();
  if (!s0) return nonRisponde();
  if (staOra() - stm.sentito > STA_ATTESA.fresco) {
    const e = await stmChiedi(s0, { cmd: "esito", rq }, STA_ATTESA.vivo);
    if (e && e.ok && e.dati && e.dati.esito) return esitoDa(e.dati);   // questo foglio è già andato: com'è andata, niente seconda stampa
    if (!e) {
      stmFineSessione();
      s0 = await stmSessione();
      if (!s0) return nonRisponde();
    }
  }
  // i pezzi prima dell'ultimo: finché non arriva l'ultimo la stazione non stampa
  // niente, e si può ripartire (una volta, su una sessione nuova)
  for (let giro = 0; ; giro++) {
    const s = await stmSessione();
    if (!s) return nonRisponde();
    let rotto = null;
    for (let i = 0; i < n - 1 && !rotto; i++) {
      const r = await stmChiedi(s, pezzo(i), STA_ATTESA.pezzo);
      if (r && r.ok && r.dati && r.dati.fatto) return esitoDa(r.dati);   // già stampato (rimandato): com'è andata
      if (!r || !r.ok) rotto = r || { tempo: true };
    }
    if (rotto) {
      if (!rotto.tempo) return fine({ ok: false, esito: "fallito", why: `${nome}: ${corto(rotto.errore || "il foglio non è arrivato bene", 160)}` });
      stmFineSessione();
      if (giro) return nonRisponde();
      continue;
    }
    // l'ultimo: da qui il foglio può uscire
    const r = await stmChiedi(s, pezzo(n - 1), STA_ATTESA.ultimo);
    if (r && r.ok && r.dati) return esitoDa(r.dati);
    if (r && !r.ok) return fine({ ok: false, esito: "fallito", why: `${nome}: ${corto(r.errore || "non stampato", 160)}` });
    // nessuna risposta: com'è andata, su una sessione nuova
    stmFineSessione();
    const s2 = await stmSessione();
    const e = s2 ? await stmChiedi(s2, { cmd: "esito", rq }, STA_ATTESA.esito) : null;
    if (e && e.ok && e.dati && e.dati.esito) return esitoDa(e.dati);
    if (e && e.ok && e.dati && e.dati.nessuno) return nonRisponde();   // l'ultimo pezzo non è arrivato: niente stampato
    return fine({ ok: false, esito: "sconosciuto", why: `${nome} non risponde: forse stampato` });
  }
}
// L'iPhone ha inquadrato il QR della stazione (ponte-sw.js, comando
// «stazioneCollega»): l'offerta va alla stazione, e K nasce qui e là.
const STA_COLLEGA = new Map();   // l'offerta → la risposta (una volta sola)
function stazioneCollega(d) {
  const testo = typeof d.sta === "string" ? d.sta : "";
  if (!STA_COLLEGA.has(testo)) STA_COLLEGA.set(testo, stazioneCollegaOra(testo, corto(String(d.nome || "").trim(), 40)).finally(() => setTimeout(() => STA_COLLEGA.delete(testo), 60e3)));
  return STA_COLLEGA.get(testo);
}
async function stazioneCollegaOra(testo, nomeQr) {
  const o = staOffertaDa(testo);
  if (!o) return { ok: false, errore: "Questo QR non è di una stazione di stampa" };
  if (o.scade < staOra()) return { ok: false, errore: "QR scaduto: sulla stazione ne compare uno nuovo, inquadra quello" };
  if (o.scade > staOra() + STA_OFFERTA_MAX + 60e3) return { ok: false, errore: "Questo QR non è di una stazione di stampa" };
  const host = await ponteIndirizzo().catch(() => "");
  if (!host) return { ok: false, errore: "Sul PC il ponte non è configurato" };
  const ab = await staChiaviAbbina(o.s);
  const e = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pubM = new Uint8Array(await crypto.subtle.exportKey("raw", e.publicKey)), pubTxt = PonteCripto.b64u(pubM);
  let risolvi;
  const risposta = new Promise((r) => { risolvi = r; });
  const p = new StaPresa({ dati: async (b) => {
    try {
      const m = (await PonteCripto.apri(ab.stazione, b, PonteCripto.TIPO.SALUTO_PC)).dati;
      if (m && m.v === 1 && m.eco === pubTxt.slice(0, 22)) risolvi(m);
    } catch { /* non è per noi */ }
  } });
  p.apri(staUrl(host, ab.stanza, "medico"));
  // il saluto, ogni secondo e mezzo finché la stazione non risponde (il ripetitore non tiene niente)
  const fine = staOra() + STA_ATTESA.abbina;
  let m = null;
  while (!m && staOra() < fine) {
    if (p.su && p.pari) p.manda(await PonteCripto.sigilla(ab.medico, PonteCripto.TIPO.SALUTO_TEL, 0, { v: 1, pub: pubTxt }));
    m = await Promise.race([risposta, staAttendi(1500).then(() => null)]);
  }
  p.ferma();
  if (!m) return { ok: false, errore: "La stazione non risponde: tieni aperta la sua pagina, col QR, e riprova" };
  if (m.no) return { ok: false, errore: "Questo QR è già stato usato: sulla stazione ne compare uno nuovo" };
  const k = await staChiaveK(e.privateKey, o.pub, o.s, pubM, o.pub);
  const nome = corto(String(m.nome || nomeQr || STA_NOME).replace(/\s+/g, " ").trim(), 40) || STA_NOME;
  const codice = await PonteCripto.codice(k);
  await chrome.storage.local.set({ [STA.coppia]: { k: PonteCripto.b64u(k), nome, dal: staOra(), via: "telefono", codice } });
  await stmAvvia();
  // il primo saluto con K: la stazione c'è, e ha la stessa chiave
  if (!(await stmSessione(10e3))) {
    // (la stazione può averla confermata lei: le si dice «scollegata» appena c'è)
    await chrome.storage.local.set({ [STA.coppia]: { ...(stm.coppia || {}), revoca: staOra() } });
    await stmAvvia();
    return { ok: false, errore: "La stazione non ha confermato: riprova con un QR nuovo" };
  }
  stmNota(`${nome} collegata dal telefono alle ${staHhmm(staOra())}`);
  await stmScriviStato();
  return { ok: true, dati: { nome, codice } };
}
// La stazione ha scollegato questo PC
async function stmRevocata() {
  if (!stm.coppia) return;
  const nome = stm.coppia.nome || STA_NOME;
  stm.presa.manda(await PonteCripto.sigilla(stm.chiavi.salutoTel, PonteCripto.TIPO.SALUTO_TEL, 0, { v: 1, revocaVista: true }));
  await chrome.storage.local.remove(STA.coppia);
  stmNota(`${nome} ha scollegato questo PC`);
  await stmAvvia();
}
// «Scollega» sul PC: la chiave non vale più da subito; la stazione lo sa
// adesso, o appena si collega (finché non lo sa resta solo per dirglielo).
async function stmDiRevoca() {
  if (stm.chiavi && stm.presa.pari) stm.presa.manda(await PonteCripto.sigilla(stm.chiavi.salutoTel, PonteCripto.TIPO.SALUTO_TEL, 0, { v: 1, revoca: true }));
}
async function stmScollega() {
  if (!stm.coppia || stm.coppia.revoca) return;
  const nome = stm.coppia.nome || STA_NOME;
  stm.coppia = { ...stm.coppia, revoca: staOra() };
  await chrome.storage.local.set({ [STA.coppia]: stm.coppia });
  stmFineSessione();
  stmNota(`${nome} scollegata da questo PC`);
  await stmDiRevoca();
  await stmScriviStato();
}

// ======================================================== la stazione
const stz = {
  qui: null, k: null, chiavi: null, chiaviDi: "", host: "",
  sessione: null, attesa: null,   // come il PC del ponte: la sessione, e quella nuova che aspetta il primo messaggio
  offerta: null,                  // { pub, s, scade, priv, ab, usata? }
  inCorso: new Map(),             // rq → i pezzi arrivati (in memoria, solo finché il foglio non parte)
  stampa: new Map(),              // rq → il foglio che sta stampando adesso
  ripartito: 0,
  fila: Promise.resolve(),
};
stz.presa = new StaPresa({
  dati: (b) => { stz.fila = stz.fila.then(() => stzRicevi(b)).catch(() => {}); },
  pari: (si) => { stzScriviStato(); if (si && stz.qui && stz.qui.revoca) stzDiRevoca().catch(() => {}); },
  stato: () => stzScriviStato(),
});
stz.abbina = new StaPresa({ dati: (b) => { stz.fila = stz.fila.then(() => stzAbbina(b)).catch(() => {}); } });
const stzAttiva = () => !!stz.qui && !stz.qui.revoca;
const stzNome = async () => corto(String((await chrome.storage.local.get(STA.nome))[STA.nome] || "").trim(), 40) || STA_NOME;
const stzStampanti = async () => (await chrome.storage.local.get("stampa")).stampa || {};
async function stzScriviStato() {
  const q = stzAttiva() ? stz.qui : null, o = stz.offerta;
  const offerta = !q && o && !o.usata && o.scade > staOra() && stz.host
    ? { qr: `${stz.host}/ponte/#sta=${PonteCripto.b64u(o.pub)}.${PonteCripto.b64u(o.s)}.${o.scade}&nome=${encodeURIComponent(await stzNome())}`, codice: o.codice, scade: o.scade } : null;
  const s = { qui: q ? { dal: q.dal, codice: q.codice, conferma: !!q.conferma, pc: stz.presa.pari } : null, offerta, host: !!stz.host, nome: await stzNome() };
  const firma = JSON.stringify(s);
  if (firma !== stzScritto) { stzScritto = firma; await chrome.storage.session.set({ [STA.stato]: s }).catch(() => { stzScritto = ""; }); }
  return s;
}
let stzScritto = "";
let stzFilaAvvio = Promise.resolve();
const stzAvvia = () => (stzFilaAvvio = stzFilaAvvio.then(stzAvviaOra, stzAvviaOra));
async function stzAvviaOra() {
  stz.host = await ponteIndirizzo().catch(() => "");
  let q = (await chrome.storage.local.get(STA.qui))[STA.qui] || null;
  if (q && q.revoca && staOra() - q.revoca > STA_REVOCA_MAX) { await chrome.storage.local.remove(STA.qui); q = null; }
  // collegata ma mai confermata (il PC non ha salutato), e l'offerta è finita: non vale
  if (q && !q.conferma && !q.revoca && !(stz.offerta && stz.offerta.scade + 60e3 > staOra())) { await chrome.storage.local.remove(STA.qui); q = null; }
  if (q && stz.chiaviDi !== q.k) {
    try {
      stz.k = PonteCripto.daB64u(q.k);
      stz.chiavi = await PonteCripto.chiaviCoppia(stz.k);
      stz.chiaviDi = q.k;
      stz.sessione = null; stz.attesa = null;
    } catch { await chrome.storage.local.remove(STA.qui); q = null; }
  }
  stz.qui = q;
  if (!q) { stz.k = null; stz.chiavi = null; stz.chiaviDi = ""; stz.sessione = null; stz.attesa = null; }
  if (q && stz.host) stz.presa.apri(staUrl(stz.host, stz.chiavi.stanza, "stazione"));
  else stz.presa.ferma();
  // l'offerta: finché vale e nessun PC l'ha presa, la sua stanza resta aperta
  const o = stz.offerta;
  if (o && o.scade <= staOra()) { stz.offerta = null; await chrome.storage.session.remove(STA.offerta).catch(() => {}); }
  if (stz.offerta && stz.host && !(q && q.conferma)) stz.abbina.apri(staUrl(stz.host, stz.offerta.ab.stanza, "stazione"));
  else stz.abbina.ferma();
  staSveglia();
  await stzScriviStato();
}
// Un QR nuovo (la pagina della stazione lo chiede): una chiave ECDH nuova e un
// numero casuale, per cinque minuti e per un PC solo. La chiave privata sta
// in storage.session (la memoria del browser: muore con lui) finché vale.
async function stzOfferta() {
  if (stzAttiva()) return stzScriviStato();
  const o = stz.offerta;
  if (o && !o.usata && o.scade - staOra() > 60e3) return stzScriviStato();
  const e = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", e.publicKey)), s = PonteCripto.casuale(16);
  const nuova = { pub, s, scade: staOra() + STA_OFFERTA_MAX, priv: e.privateKey, ab: await staChiaviAbbina(s), codice: await staCodiceOfferta(s, pub) };
  stz.offerta = nuova;
  await chrome.storage.session.set({ [STA.offerta]: { pub: PonteCripto.b64u(pub), s: PonteCripto.b64u(s), scade: nuova.scade, priv: await crypto.subtle.exportKey("jwk", e.privateKey) } });
  await stzAvvia();
  return stzScriviStato();
}
// (il service worker si è riavviato mentre il QR era sullo schermo)
async function stzRiprendiOfferta() {
  const x = (await chrome.storage.session.get(STA.offerta))[STA.offerta];
  if (!x || x.scade <= staOra() || stz.offerta) return;
  try {
    const pub = PonteCripto.daB64u(x.pub), s = PonteCripto.daB64u(x.s);
    const priv = await crypto.subtle.importKey("jwk", x.priv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    stz.offerta = { pub, s, scade: x.scade, priv, ab: await staChiaviAbbina(s), codice: await staCodiceOfferta(s, pub) };
  } catch { await chrome.storage.session.remove(STA.offerta).catch(() => {}); }
}
// Nella stanza dell'abbinamento: il PC del medico manda la sua chiave
// pubblica (cifrata con la chiave da `s`). Il primo vince; lo stesso PC che
// rimanda il saluto ha la stessa risposta; un altro, «già usata».
async function stzAbbina(b) {
  const o = stz.offerta;
  if (!o || o.scade <= staOra()) return;
  let m;
  try { m = (await PonteCripto.apri(o.ab.medico, b, PonteCripto.TIPO.SALUTO_TEL)).dati; } catch { return; }
  if (!m || m.v !== 1 || typeof m.pub !== "string") return;
  let pubM;
  try { pubM = PonteCripto.daB64u(m.pub); } catch { return; }
  if (pubM.length !== 65 || pubM[0] !== 4) return;
  const rispondi = async (x) => stz.abbina.manda(await PonteCripto.sigilla(o.ab.stazione, PonteCripto.TIPO.SALUTO_PC, 0, { v: 1, eco: m.pub.slice(0, 22), ...x }));
  if (o.usata) return rispondi(o.usata === m.pub ? { nome: await stzNome() } : { no: "usata" });
  if (stzAttiva() && stz.qui.conferma) return rispondi({ no: "usata" });
  let k;
  try { k = await staChiaveK(o.priv, pubM, o.s, pubM, o.pub); } catch { return; }
  o.usata = m.pub;
  await chrome.storage.local.set({ [STA.qui]: { k: PonteCripto.b64u(k), dal: staOra(), codice: await PonteCripto.codice(k), conferma: false } });
  await rispondi({ nome: await stzNome() });
  await stzAvvia();
}
async function stzRicevi(b) {
  if (!stz.chiavi) return;
  const h = PonteCripto.leggiTestata(b);
  if (h && h.tipo === PonteCripto.TIPO.SALUTO_TEL) return stzSaluto(b);
  if (h && h.tipo === PonteCripto.TIPO.DATI_TEL) return stzDati(b);
}
const stzSalutoPc = async (x) => stz.presa.manda(await PonteCripto.sigilla(stz.chiavi.salutoPc, PonteCripto.TIPO.SALUTO_PC, 0, { v: 1, ...x }));
async function stzSaluto(b) {
  let m;
  try { m = (await PonteCripto.apri(stz.chiavi.salutoTel, b, PonteCripto.TIPO.SALUTO_TEL)).dati; } catch { return; }
  if (!m || m.v !== 1) return;
  if (m.revoca) {   // il PC ha scollegato questa stazione
    await stzSalutoPc({ revocaVista: true });
    await chrome.storage.local.remove(STA.qui);
    await stzAvvia();
    return;
  }
  if (m.revocaVista) { if (stz.qui && stz.qui.revoca) { await chrome.storage.local.remove(STA.qui); await stzAvvia(); } return; }
  if (typeof m.n !== "string") return;
  if (stz.qui && stz.qui.revoca) return stzSalutoPc({ eco: m.n, revoca: true });
  let nTel;
  try { nTel = PonteCripto.daB64u(m.n); } catch { return; }
  if (nTel.length !== 16) return;
  // il primo saluto con K: il PC ha la stessa chiave, l'abbinamento è fatto
  if (!stz.qui.conferma) {
    stz.qui = { ...stz.qui, conferma: true };
    await chrome.storage.local.set({ [STA.qui]: stz.qui });
    stz.offerta = null;
    await chrome.storage.session.remove(STA.offerta).catch(() => {});
    stz.abbina.ferma();
  }
  const nPc = PonteCripto.casuale(16);
  stz.attesa = { canale: PonteCripto.canalePc(await PonteCripto.chiaviSessione(stz.k, nTel, nPc)), n: m.n };
  await stzSalutoPc({ n: PonteCripto.b64u(nPc), eco: m.n, nome: await stzNome() });
  await stzScriviStato();
}
async function stzDati(b) {
  if (stz.sessione) {
    try { stzComando(stz.sessione, await stz.sessione.canale.decifra(b)); return; }
    catch (e) { if (e.codice === "ripetuto") return; }
  }
  if (stz.attesa) {
    try {
      const d = await stz.attesa.canale.decifra(b);
      stz.sessione = stz.attesa; stz.attesa = null;
      stzComando(stz.sessione, d);
      return;
    } catch { /* né l'una né l'altra */ }
  }
  // una sessione che qui non c'è più (il service worker si è riavviato): il PC ne apre un'altra
  if (!stz.sessione && !stz.attesa && staOra() - stz.ripartito > 2000) { stz.ripartito = staOra(); stzSalutoPc({ riparti: true }); }
}
// Solo questi: un pezzo di un foglio, e com'è andato un foglio.
async function stzComando(s, d) {
  if (!d || typeof d !== "object" || !Number.isSafeInteger(d.id) || typeof d.cmd !== "string") return;
  let r;
  try { r = d.cmd === "stampa" ? await stzStampa(d) : d.cmd === "esito" ? await stzEsito(d) : { ok: false, errore: "Comando sconosciuto" }; }
  catch (e) { r = { ok: false, errore: corto(e && e.message || e, 120) }; }
  if (stz.sessione !== s) return;
  stz.presa.manda(await s.canale.cifra({ re: d.id, ...r }));
}
const stzRqValido = (rq) => (typeof rq === "string" && /^[\w-]{8,48}$/.test(rq) ? rq : "");
let stzFilaRq = Promise.resolve();
const stzRqTutti = async () => (await chrome.storage.local.get(STA.rq))[STA.rq] || {};
const stzRqScrivi = (rq, x) => (stzFilaRq = stzFilaRq.then(async () => {
  const t = await stzRqTutti();
  t[rq] = x;
  const tieni = Object.entries(t).filter(([, v]) => staOra() - (v.ts || 0) < 24 * 3600e3).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0)).slice(-200);
  await chrome.storage.local.set({ [STA.rq]: Object.fromEntries(tieni) });
}));
async function stzEsito(d) {
  const rq = stzRqValido(d.rq);
  if (!rq) return { ok: false, errore: "Foglio senza numero" };
  if (stz.stampa.has(rq)) return { ok: true, dati: await stz.stampa.get(rq) };
  const x = (await stzRqTutti())[rq];
  if (!x) return { ok: true, dati: { nessuno: true } };
  if (x.fase === "stampo") return { ok: true, dati: { esito: "sconosciuto", why: "la stazione si è riavviata mentre stampava", fatto: true } };
  return { ok: true, dati: { ...x, fatto: true } };
}
async function stzStampa(d) {
  const male = { ok: false, errore: "il foglio non è arrivato bene" };
  const rq = stzRqValido(d.rq), tipo = d.tipo === "etichette" ? "etichette" : "a4";
  const copie = Number.isInteger(d.copie) && d.copie >= 1 && d.copie <= 10 ? d.copie : 1;
  const { i, n, size, b } = d;
  if (!rq || ![i, n, size].every(Number.isSafeInteger) || i < 0 || n < 1 || n > 80 || i >= n || size < 1 || size > STAMPA_PDF_MAX || typeof b !== "string") return male;
  // già arrivato (la risposta si era persa): com'è andata, e niente seconda stampa
  const gia = stz.stampa.has(rq) || (await stzRqTutti())[rq];
  if (gia) return stzEsito(d);
  if (i === 0) {
    let testa = "";
    try { testa = atob(b.slice(0, 8)); } catch { /* sotto */ }
    if (!testa.startsWith("%PDF")) return { ok: false, errore: "non è un PDF: niente stampato" };
    const s = await stzStampanti();
    if (!s[tipo]) return { ok: false, errore: `qui manca la stampante ${tipo === "etichette" ? "delle etichette" : "A4"}: sceglila nella pagina della stazione` };
    stz.inCorso.set(rq, { n, size, tipo, copie, parti: [], lun: 0 });
    while (stz.inCorso.size > 4) stz.inCorso.delete(stz.inCorso.keys().next().value);
  }
  const c = stz.inCorso.get(rq);
  if (!c || c.n !== n || c.size !== size || c.parti.length !== i || b.length > STA_PEZZO || (i < n - 1 && b.length % 4)
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(b) || (c.lun += b.length) > Math.ceil(STAMPA_PDF_MAX / 3) * 4 + 4) { stz.inCorso.delete(rq); return male; }
  c.parti.push(b);
  if (i < n - 1) return { ok: true, dati: { i } };
  stz.inCorso.delete(rq);
  const pdf = c.parti.join("");
  c.parti = null;
  if (staMisura(pdf) !== size) return male;
  const p = stzStampaOra(rq, c, pdf);
  stz.stampa.set(rq, p);
  try { return { ok: true, dati: await p }; } finally { stz.stampa.delete(rq); }
}
// le pagine del PDF, a occhio (niente di più: per «Ultimi fogli»)
function stzPagine(pdf) {
  try { return (atob(pdf).match(/\/Type\s*\/Page(?![s\w])/g) || []).length; } catch { return 0; }
}
async function stzStampaOra(rq, c, pdf) {
  const s = await stzStampanti();
  await stzRqScrivi(rq, { fase: "stampo", ts: staOra() });   // PRIMA di darlo all'aiutante: dopo un riavvio, «sconosciuto»
  const r = await stampaPdf(c.tipo, pdf, s[c.tipo], ruotaDi(s), c.copie);
  const e = { fase: "fatto", esito: r.esito, stampante: corto(r.stampante, 80), why: corto(r.why || "", 200), copie: r.ok ? r.copie || 1 : c.copie, ts: staOra() };
  await stzRqScrivi(rq, e);
  const l = (await chrome.storage.local.get(STA.lavori))[STA.lavori] || [];
  l.push({ ts: e.ts, tipo: c.tipo, pagine: stzPagine(pdf), copie: c.copie, esito: e.esito, stampante: e.stampante });
  await chrome.storage.local.set({ [STA.lavori]: l.slice(-30) });
  return e;
}
// «Scollega» sulla stazione: da subito non riceve più niente; il PC lo sa adesso, o appena c'è
async function stzDiRevoca() {
  if (stz.chiavi && stz.presa.pari) await stzSalutoPc({ revoca: true });
}
async function stzScollega() {
  if (!stz.qui) { stz.offerta = null; await chrome.storage.session.remove(STA.offerta).catch(() => {}); return stzAvvia(); }
  if (!stz.qui.conferma) { await chrome.storage.local.remove(STA.qui); return stzAvvia(); }
  if (stz.qui.revoca) return;
  stz.qui = { ...stz.qui, revoca: staOra() };
  await chrome.storage.local.set({ [STA.qui]: stz.qui });
  stz.sessione = null; stz.attesa = null;
  await stzDiRevoca();
  await stzAvvia();
}

// ============================================================= in comune
// Svegli: il battito delle prese, le scadenze; e una sveglia di Chrome ogni
// minuto finché c'è qualcosa da tenere aperto (la stazione non ha schede del
// gestionale che svegliano il service worker).
function staSveglia() {
  if (!chrome.alarms) return;
  const serve = !!stm.coppia || !!stz.qui || !!stz.offerta;
  if (serve) chrome.alarms.get("stazione").then((a) => a || chrome.alarms.create("stazione", { periodInMinutes: 1 })).catch(() => {});
  else chrome.alarms.clear("stazione").catch(() => {});
}
chrome.alarms?.onAlarm.addListener((a) => { if (a && a.name === "stazione") { stmAvvia().catch(() => {}); stzAvvia().catch(() => {}); } });
setInterval(() => {
  stm.presa.battito(); stz.presa.battito(); stz.abbina.battito();
  if (stz.offerta && stz.offerta.scade <= staOra()) stzAvvia().catch(() => {});
  // una chiamata qualunque all'API dell'estensione azzera il riposo del service worker (da Chrome 110: il solo
  // ping della presa conta da Chrome 116): senza, una stazione dormiente ha la presa aperta e non riceve niente
  if (stm.coppia || stzAttiva()) try { chrome.runtime.getPlatformInfo().catch(() => {}); } catch { /* niente */ }
}, STA_BATTITO);

// Le pagine dell'estensione (la stazione, le impostazioni del PC). Le chiavi non escono mai di qui.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string" || !msg.t.startsWith("stazione")) return;
  if (!String(sender && sender.url || "").startsWith(chrome.runtime.getURL(""))) return reply({ ok: false, why: "non da qui" }), true;
  const fai = (fn) => { staCaricato.then(fn).then(reply, (e) => reply({ ok: false, why: corto(e && e.message || e, 80) })); return true; };
  if (msg.t === "stazioneStato") return fai(async () => ({ ok: true, stazione: await stzScriviStato(), lavori: (await chrome.storage.local.get(STA.lavori))[STA.lavori] || [] }));
  if (msg.t === "stazioneOfferta") return fai(async () => ({ ok: true, stazione: await stzOfferta() }));
  if (msg.t === "stazioneNome") {
    return fai(async () => {
      const nome = corto(String(msg.nome || "").replace(/\s+/g, " ").trim(), 40);
      await chrome.storage.local.set({ [STA.nome]: nome || STA_NOME });
      return { ok: true, stazione: await stzScriviStato() };
    });
  }
  if (msg.t === "stazioneScollega") return fai(async () => { if (msg.ruolo === "stazione") await stzScollega(); else await stmScollega(); return { ok: true }; });
  reply({ ok: false, why: "richiesta sconosciuta" });
});
chrome.runtime.onStartup?.addListener(() => { stmAvvia().catch(() => {}); stzAvvia().catch(() => {}); });
const staCaricato = (async () => {
  await stzRiprendiOfferta();
  await stmAvvia();
  await stzAvvia();
})().catch(() => {});
