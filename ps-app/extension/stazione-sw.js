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
/* global PonteCripto, ponteIndirizzo, corto, stampaPdf, ruotaDi, STAMPA_PDF_MAX, ospite, Presa, fuoriRipiego, psaGestionale, cassaLeggi, cassaScrivi, cassaTogli */

// (3.87) Le chiavi — K della coppia, sui due PC, e la chiave privata dell'offerta — stanno nella cassa
// (cassa.js: l'IndexedDB del service worker, CryptoKey non estraibili), mai in chrome.storage: in
// storage.local resta solo quello che non è segreto, con l'`id` della chiave.
const STA = {
  // sul PC del medico
  coppia: "stazione.coppia",     // storage.local: { id, nome, dal, via, codice, revoca?, staProva? } (la chiave: nella cassa)
  pubblico: "stazione",          // storage.session: quello che le pagine del PC mostrano (niente chiavi)
  // sulla stazione
  qui: "stazione.qui",           // storage.local: { id, dal, codice, conferma, revoca? }: questo PC è una stazione (la chiave: nella cassa)
  nome: "stazione.nome",         // storage.local: il nome che il medico vede («Infermeria»)
  offerta: "stazione.offerta",   // la cassa: l'offerta del QR, finché vale (fino alla 3.86 in storage.session: da lì si toglie)
  ultimo: "stazione.ultimo",     // storage.session: il numero dell'ultimo saluto del PC del medico (lega un «riparti» a quella sessione)
  stato: "stazione.stato",       // storage.session: quello che la pagina della stazione mostra
  lavori: "stazione.lavori",     // storage.local: gli ultimi fogli: ora, tipo, pagine, copie, esito — niente pazienti
  rq: "stazione.rq",             // storage.local: i fogli già ricevuti, per numero (stampati una volta sola)
  visto: "stazione.visto",       // storage.local: quando si è aperta l'ultima volta la pagina (o il popup): il puntino si spegne
  aiutante: "stazione.aiutante", // storage.session: l'ultima prova dell'aiutante di stampa: { ko, ts }
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
// L'indirizzo della presa, con le chiavi d'entrata nel frammento (presa.js: alla rete va senza). Il PC del
// medico tiene la sua (`c`: la stanza la registra la prima volta) e, quando sa che la stazione sa provare,
// dà alla stanza anche quella della stazione (`a`); la stazione prova con la sua (`p`).
const staUrl = (host, stanza, ruolo, entra = null, altro = false) => {
  const u = new URL(host);
  const base = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}/ponte/ws?r=${stanza}&ruolo=${ruolo}`;
  if (!entra) return base;
  return ruolo === "medico" ? `${base}#c=${entra.medico}${altro ? "&a=" + entra.stazione : ""}` : `${base}#p=${entra.stazione}`;
};
// la cassa: la chiave di una coppia (`id`), come CryptoKey; una coppia della 3.86 (con `k` su disco) ci si sposta
const staId = () => PonteCripto.b64u(PonteCripto.casuale(9));
async function staMigra(nome, c) {
  if (!c || typeof c.k !== "string") return c;
  const { k, ...resto } = c, id = staId();
  await cassaScrivi(nome, { id, k: await PonteCripto.chiaveDa(PonteCripto.daB64u(k)) });
  const nuova = { ...resto, id };
  await chrome.storage.local.set({ [nome]: nuova });
  return nuova;
}
async function staChiave(nome, c) {
  const x = c ? await cassaLeggi(nome) : null;
  return x && x.id === c.id && x.k ? x.k : null;
}
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
// La presa verso il ripetitore è quella del ponte (Presa, fuori-sw.js): nel
// documento fuori schermo, che sopravvive ai riavvii del service worker, col
// battito ogni 30 secondi e i tentativi da 1 secondo a 5 minuti (presa.js).
// `pari`: dall'altra parte della stanza c'è qualcuno (lo dice il ripetitore).
// Una sola per ruolo: la vecchia si chiude prima di aprire la nuova. Si apre
// quando serve (stmAssicura, stzAssicura: lo guarda un cambiamento — una
// pagina, una scheda, un foglio —, mai un risveglio o una sveglia) e si chiude
// da sola due minuti dopo che non serve più.
const STA_LAVORO_MAX = 5 * 60e3;   // un foglio in viaggio tiene la presa al più tanto (poi decide il resto)

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
stm.presa = new Presa("medico", {
  dati: (b) => { stm.fila = stm.fila.then(() => staCaricato).then(() => stmRicevi(b)).catch(() => {}); },
  pari: (si) => { stmScriviStato(); if (si && stm.coppia && stm.coppia.revoca) stmDiRevoca().catch(() => {}); if (!si) stmFineSessione(); },
  stato: () => stmScriviStato(),
});
// Quando la presa del medico serve: un foglio in viaggio (o un saluto, una
// domanda), o una scheda del gestionale aperta su questo PC (non sulla pagina
// d'accesso: psaGestionale, ponte-sw.js). Se no, due minuti dopo niente presa:
// il PC che deve stampare la apre lui, e la stazione che non c'è «non risponde».
let stmLavori = 0;
const stmOccupato = () => stmLavori > 0 || !!stmSalutoInCorso || stm.attese.size > 0;
const staGestionale = async () => (typeof psaGestionale === "function" ? psaGestionale().catch(() => true) : true);
// (le chiavi d'entrata cambiano l'indirizzo, e un indirizzo nuovo rifà la presa: mai con un foglio in viaggio)
const stmUrl = () => {
  const u = staUrl(stm.host, stm.chiavi.stanza, "medico", stm.entra, !!(stm.coppia && stm.coppia.staProva));
  if (stm.urlUsato && stmOccupato() && stm.urlUsato.split("#")[0] === u.split("#")[0]) return stm.urlUsato;
  return (stm.urlUsato = u);
};
// (una alla volta: una decisione vecchia non arriva dopo una nuova)
const staInFila = (fila, fn) => { const p = fila.p.then(fn); fila.p = p.catch(() => {}); return p; };
const stmFilaServe = { p: Promise.resolve() };
const stmAssicura = (subito = false) => staInFila(stmFilaServe, async () => {
  if (!stm.coppia || !stm.host || !stm.chiavi) return stm.presa.ferma();
  const fine = await staGestionale() ? Infinity : stmOccupato() ? staOra() + STA_LAVORO_MAX : 0;
  await stm.presa.servi(stmUrl(), fine, subito);
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
// `serve`: è cambiato qualcosa, e la presa si apre se serve; senza (il service worker che
// riparte) si rilegge la coppia e basta — nel ripiego no: lì la presa è morta con lui.
let stmFilaAvvio = Promise.resolve();
const stmAvvia = (serve = true) => (stmFilaAvvio = stmFilaAvvio.then(() => stmAvviaOra(serve), () => stmAvviaOra(serve)));
async function stmAvviaOra(serve = true) {
  stm.host = await ponteIndirizzo().catch(() => "");
  let c = (await chrome.storage.local.get(STA.coppia))[STA.coppia] || null;
  if (c && c.revoca && staOra() - c.revoca > STA_REVOCA_MAX) { await chrome.storage.local.remove(STA.coppia); await cassaTogli(STA.coppia).catch(() => {}); c = null; }
  if (c && (stm.chiaviDi !== c.id || typeof c.k === "string")) {
    try {
      c = await staMigra(STA.coppia, c);
      const k = await staChiave(STA.coppia, c);
      if (!k) throw new Error("coppia senza chiave");
      stm.k = k;
      stm.chiavi = await PonteCripto.chiaviCoppia(k);
      stm.entra = await PonteCripto.chiaviEntra(k);
      stm.chiaviDi = c.id;
      stmFineSessione();
    } catch { await chrome.storage.local.remove(STA.coppia); await cassaTogli(STA.coppia).catch(() => {}); c = null; }
  }
  stm.coppia = c;
  if (!c) { stm.k = null; stm.chiavi = null; stm.chiaviDi = ""; stm.entra = null; stmFineSessione(); }
  if (!c || !stm.host) await stm.presa.ferma();
  else if (serve || fuoriRipiego()) await stmAssicura();
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
    if (m.revocaVista) { if (stm.coppia && stm.coppia.revoca) { await chrome.storage.local.remove(STA.coppia); await cassaTogli(STA.coppia).catch(() => {}); await stmAvvia(); } return; }
    // (la stazione non ha più la sessione: le domande in volo non avranno risposta, se ne apre un'altra)
    // Solo se parla di QUESTA sessione (3.87: `eco`, il numero del nostro saluto): un «riparti» vecchio,
    // rimandato da chi sta nella stanza, non ferma un foglio che sta stampando. (Una stazione della 3.86 lo
    // manda senza: allora si aspetta la risposta che non arriva, e si chiede com'è andata su una sessione nuova.)
    if (m.riparti) { if (stm.sessione && typeof m.eco === "string" && m.eco === stm.sessione.n) stmFineSessione(); return; }
    const sa = stm.saluto;
    if (!sa || m.eco !== sa.n || !stmAttiva()) return;
    stm.saluto = null;
    stm.sentito = staOra();
    if (m.no) return sa.risolvi(null);
    // la stazione sa provare l'entrata (3.87): da adesso la stanza ha anche la sua chiave
    if (m.entra === 1 && !stm.coppia.staProva) {
      stm.coppia = { ...stm.coppia, staProva: true };
      await chrome.storage.local.set({ [STA.coppia]: stm.coppia });   // (la presa la usa quando si rifà senza fogli in viaggio: stmUrl)
    }
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
    if (!stmAttiva() || !stm.host) return null;
    // (chiusa perché non serviva: adesso serve, senza aspettare un tentativo in programma)
    await stm.presa.servi(stmUrl(), staOra() + STA_LAVORO_MAX, true);
    if (!(await stm.presa.pronta(ms))) return null;
    const n = PonteCripto.b64u(PonteCripto.casuale(16));
    const r = new Promise((risolvi) => { stm.saluto = { n, risolvi }; });
    if (!(await stm.presa.manda(await PonteCripto.sigilla(stm.chiavi.salutoTel, PonteCripto.TIPO.SALUTO_TEL, 0, { v: 1, n, dev: "medico" })))) { stm.saluto = null; return null; }
    const s = await Promise.race([r, staAttendi(ms).then(() => null)]);
    if (stm.saluto && stm.saluto.n === n) stm.saluto = null;
    return s;
  })().finally(() => {
    stmSalutoInCorso = null;
    // (un saluto senza un foglio dietro — la prova «ci sei?», l'abbinamento —: i due minuti cominciano da qui)
    if (!stmOccupato()) stmAssicura().catch(() => {});
  });
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
    stm.presa.manda(f).then((ok) => { if (!ok && stm.attese.get(id)?.t === t) { clearTimeout(t); stm.attese.delete(id); risolvi(null); } });
  });
}
// Un foglio alla stazione (dal motore della stampa, bg.js, al posto
// dell'aiutante): lo stesso esito che darebbe l'aiutante — stampato, mandato,
// fallito, sconosciuto — più `nonRisponde` quando non è arrivato niente.
// `rq`: il numero del foglio, lo stesso se lo si rimanda (la stazione lo
// stampa una volta sola).
async function stazioneStampa(tipo, pdf, copie, rq) {
  stmLavori++;
  try { return await stazioneStampaOra(tipo, pdf, copie, rq); }
  finally { if (--stmLavori === 0) stmAssicura().catch(() => {}); }   // (finito l'ultimo: i due minuti cominciano da qui)
}
async function stazioneStampaOra(tipo, pdf, copie, rq) {
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
// (3.87) Una stazione già collegata non si sostituisce dal telefono, in silenzio: il telefono chiede, e il
// medico conferma sul PC (la pagina iPhone), finché l'offerta vale. Solo in memoria: l'offerta apre la stanza
// dell'abbinamento, e non va dove gli script delle pagine leggono.
let staChiesta = null;           // { sta, nome, prima, codice, scade }
function stazioneCollega(d) {
  const testo = typeof d.sta === "string" ? d.sta : "";
  const nome = corto(String(d.nome || "").trim(), 40);
  if (stmAttiva()) return stazioneDaConfermare(testo, nome);
  if (!STA_COLLEGA.has(testo)) STA_COLLEGA.set(testo, stazioneCollegaOra(testo, nome).finally(() => setTimeout(() => STA_COLLEGA.delete(testo), 60e3)));
  return STA_COLLEGA.get(testo);
}
async function stazioneDaConfermare(testo, nome) {
  const o = staOffertaDa(testo);
  if (!o) return { ok: false, errore: "Questo QR non è di una stazione di stampa" };
  if (o.scade < staOra()) return { ok: false, errore: "QR scaduto: sulla stazione ne compare uno nuovo, inquadra quello" };
  if (o.scade > staOra() + STA_OFFERTA_MAX + 60e3) return { ok: false, errore: "Questo QR non è di una stazione di stampa" };
  const prima = (stm.coppia && stm.coppia.nome) || STA_NOME;
  staChiesta = { sta: testo, nome: nome || STA_NOME, prima, codice: await staCodiceOfferta(o.s, o.pub), scade: o.scade };
  stmNota(`L'iPhone chiede di collegare «${staChiesta.nome}» al posto di «${prima}»: si conferma sul PC`);
  await stmScriviStato();
  return { ok: false, errore: `Sul PC è collegata «${prima}»: per sostituirla, conferma sul PC (⋯ → iPhone) entro 5 minuti`, conferma: { nome: staChiesta.nome, prima } };
}
// per la pagina iPhone: niente dell'offerta, solo i nomi e il codice da confrontare con quello della stazione
function stazioneChiesta() {
  const c = staChiesta;
  if (!c) return null;
  if (c.scade < staOra()) { staChiesta = null; return null; }
  return { nome: c.nome, prima: c.prima, codice: c.codice, scade: c.scade };
}
// il medico, sul PC: «Sostituisci» (si) o «No»
async function stazioneConferma(si) {
  const c = staChiesta;
  staChiesta = null;
  if (!c || c.scade < staOra()) return { ok: false, errore: "La richiesta è scaduta: inquadra di nuovo il QR della stazione" };
  if (!si) return { ok: true, dati: { nome: c.prima, tenuta: true } };
  return stazioneCollegaOra(c.sta, c.nome);
}
// la stazione collegata dal telefono (per «Revoca l'iPhone»: la pagina chiede se scollegare anche lei)
const stazioneDelTelefono = () => (stmAttiva() && stm.coppia.via === "telefono" ? stm.coppia.nome || STA_NOME : "");
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
  // (una presa per l'abbinamento, nella stanza dell'offerta: per il tempo del saluto)
  const p = new Presa("collega", { dati: async (b) => {
    try {
      const m = (await PonteCripto.apri(ab.stazione, b, PonteCripto.TIPO.SALUTO_PC)).dati;
      if (m && m.v === 1 && m.eco === pubTxt.slice(0, 22)) risolvi(m);
    } catch { /* non è per noi */ }
  } });
  await p.tieni(staUrl(host, ab.stanza, "medico", await PonteCripto.chiaviEntra(o.s)), staOra() + STA_ATTESA.abbina + 10e3, true);
  // il saluto, ogni secondo e mezzo finché la stazione non risponde (il ripetitore non tiene niente)
  const fine = staOra() + STA_ATTESA.abbina;
  let m = null;
  while (!m && staOra() < fine) {
    if (p.su && p.pari) await p.manda(await PonteCripto.sigilla(ab.medico, PonteCripto.TIPO.SALUTO_TEL, 0, { v: 1, pub: pubTxt }));
    m = await Promise.race([risposta, staAttendi(1500).then(() => null)]);
  }
  await p.ferma();
  if (!m) return { ok: false, errore: "La stazione non risponde: tieni aperta la sua pagina, col QR, e riprova" };
  if (m.no) return { ok: false, errore: "Questo QR è già stato usato: sulla stazione ne compare uno nuovo" };
  const k = await PonteCripto.chiaveDa(await staChiaveK(e.privateKey, o.pub, o.s, pubM, o.pub));
  const nome = corto(String(m.nome || nomeQr || STA_NOME).replace(/\s+/g, " ").trim(), 40) || STA_NOME;
  const codice = await PonteCripto.codice(k), id = staId();
  await cassaScrivi(STA.coppia, { id, k });
  await chrome.storage.local.set({ [STA.coppia]: { id, nome, dal: staOra(), via: "telefono", codice } });
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
  await cassaTogli(STA.coppia).catch(() => {});
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
stz.presa = new Presa("stazione", {
  dati: (b) => { stz.fila = stz.fila.then(() => staCaricato).then(() => stzRicevi(b)).catch(() => {}); },
  pari: (si) => { stzScriviStato(); if (si && stz.qui && stz.qui.revoca) stzDiRevoca().catch(() => {}); },
  stato: () => stzScriviStato(),
});
stz.abbina = new Presa("abbina", { dati: (b) => { stz.fila = stz.fila.then(() => staCaricato).then(() => stzAbbina(b)).catch(() => {}); } });
// Quando la stazione sta sul ponte: con una scheda del gestionale aperta su
// questo PC (non sulla pagina d'accesso), con la sua pagina aperta, o con un
// foglio in arrivo; e due minuti dopo. Fuori turno, a gestionale chiuso, niente
// presa: il PC del medico dice «Infermeria non risponde» e stampa da sé, o lo propone.
const stzUso = { pagina: 0 };
async function stzPagina() {
  const url = chrome.runtime.getURL("stazione.html");
  try {
    const c = await chrome.runtime.getContexts?.({ contextTypes: ["TAB"] });
    if (Array.isArray(c)) return c.some((x) => String(x.documentUrl || "").startsWith(url));
  } catch { /* Chrome vecchio */ }
  // (prima di Chrome 116: le pagine dell'estensione sono client del service worker)
  try {
    const l = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (Array.isArray(l)) return l.some((x) => String(x.url || "").startsWith(url));
  } catch { /* nemmeno questo */ }
  // (se no: la pagina che ha chiesto lo stato da meno di 10 minuti)
  return staOra() - stzUso.pagina < 10 * 60e3;
}
const stzLavora = () => stz.inCorso.size > 0 || stz.stampa.size > 0;
const stzFilaServe = { p: Promise.resolve() };
const stzAssicura = (subito = false) => staInFila(stzFilaServe, async () => {
  if (!stz.qui || !stz.host || !stz.chiavi) return stz.presa.ferma();
  const fine = await stzPagina() || await staGestionale() ? Infinity : stzLavora() ? staOra() + STA_LAVORO_MAX : 0;
  await stz.presa.servi(staUrl(stz.host, stz.chiavi.stanza, "stazione", stz.entra), fine, subito);
});
// l'offerta del QR, via dalla cassa (e da storage.session, dove la teneva la 3.86 con la chiave privata in JWK)
const staOffertaVia = () => Promise.all([cassaTogli(STA.offerta).catch(() => {}), chrome.storage.session.remove(STA.offerta).catch(() => {})]);
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
// `serve`: come stmAvvia (senza, il service worker che riparte: la presa resta com'è)
let stzFilaAvvio = Promise.resolve();
const stzAvvia = (serve = true) => (stzFilaAvvio = stzFilaAvvio.then(() => stzAvviaOra(serve), () => stzAvviaOra(serve)));
async function stzAvviaOra(serve = true) {
  stz.host = await ponteIndirizzo().catch(() => "");
  let q = (await chrome.storage.local.get(STA.qui))[STA.qui] || null;
  const via = async () => { await chrome.storage.local.remove(STA.qui); await cassaTogli(STA.qui).catch(() => {}); };
  if (q && q.revoca && staOra() - q.revoca > STA_REVOCA_MAX) { await via(); q = null; }
  // collegata ma mai confermata (il PC non ha salutato), e l'offerta è finita: non vale
  if (q && !q.conferma && !q.revoca && !(stz.offerta && stz.offerta.scade + 60e3 > staOra())) { await via(); q = null; }
  if (q && (stz.chiaviDi !== q.id || typeof q.k === "string")) {
    try {
      q = await staMigra(STA.qui, q);
      const k = await staChiave(STA.qui, q);
      if (!k) throw new Error("stazione senza chiave");
      stz.k = k;
      stz.chiavi = await PonteCripto.chiaviCoppia(k);
      stz.entra = await PonteCripto.chiaviEntra(k);
      stz.chiaviDi = q.id;
      stz.sessione = null; stz.attesa = null;
    } catch { await via(); q = null; }
  }
  stz.qui = q;
  if (!q) { stz.k = null; stz.chiavi = null; stz.chiaviDi = ""; stz.entra = null; stz.sessione = null; stz.attesa = null; }
  const vale = serve || fuoriRipiego();
  if (!q || !stz.host) await stz.presa.ferma();
  else if (vale) await stzAssicura();
  // l'offerta: finché vale e nessun PC l'ha presa, la sua stanza resta aperta (fino alla sua scadenza: la chiude la presa)
  const o = stz.offerta;
  if (o && o.scade <= staOra()) { stz.offerta = null; await staOffertaVia(); }
  if (!stz.offerta || !stz.host || (q && q.conferma)) await stz.abbina.ferma();
  else if (vale) await stz.abbina.tieni(staUrl(stz.host, stz.offerta.ab.stanza, "stazione", stz.offerta.entra), stz.offerta.scade);
  staSveglia();
  await stzScriviStato();
}
// Un QR nuovo (la pagina della stazione lo chiede): una chiave ECDH nuova e un
// numero casuale, per cinque minuti e per un PC solo. La chiave privata sta
// nella cassa (cassa.js), non estraibile, finché vale — mai in storage.session,
// che gli script delle pagine leggono.
async function stzOfferta() {
  if (stzAttiva()) return stzScriviStato();
  const o = stz.offerta;
  if (o && !o.usata && o.scade - staOra() > 60e3) return stzScriviStato();
  const e = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", e.publicKey)), s = PonteCripto.casuale(16);
  const nuova = { pub, s, scade: staOra() + STA_OFFERTA_MAX, priv: e.privateKey, ab: await staChiaviAbbina(s), codice: await staCodiceOfferta(s, pub), entra: await PonteCripto.chiaviEntra(s) };
  stz.offerta = nuova;
  await cassaScrivi(STA.offerta, { pub, s, scade: nuova.scade, priv: e.privateKey });
  await chrome.storage.session.remove(STA.offerta).catch(() => {});
  await stzAvvia();
  return stzScriviStato();
}
// (il service worker si è riavviato mentre il QR era sullo schermo)
async function stzRiprendiOfferta() {
  await chrome.storage.session.remove(STA.offerta).catch(() => {});   // (la 3.86 la teneva lì, con la chiave privata: via)
  const x = await cassaLeggi(STA.offerta).catch(() => null);
  if (!x || x.scade <= staOra() || stz.offerta) return;
  try {
    const pub = new Uint8Array(x.pub), s = new Uint8Array(x.s);
    stz.offerta = { pub, s, scade: x.scade, priv: x.priv, ab: await staChiaviAbbina(s), codice: await staCodiceOfferta(s, pub), entra: await PonteCripto.chiaviEntra(s) };
  } catch { await staOffertaVia(); }
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
  try { k = await PonteCripto.chiaveDa(await staChiaveK(o.priv, pubM, o.s, pubM, o.pub)); } catch { return; }
  o.usata = m.pub;
  const id = staId();
  await cassaScrivi(STA.qui, { id, k });
  await chrome.storage.local.set({ [STA.qui]: { id, dal: staOra(), codice: await PonteCripto.codice(k), conferma: false } });
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
    await cassaTogli(STA.qui).catch(() => {});
    await stzAvvia();
    return;
  }
  if (m.revocaVista) { if (stz.qui && stz.qui.revoca) { await chrome.storage.local.remove(STA.qui); await cassaTogli(STA.qui).catch(() => {}); await stzAvvia(); } return; }
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
    await staOffertaVia();
    stz.abbina.ferma();
  }
  const nPc = PonteCripto.casuale(16);
  stz.attesa = { canale: PonteCripto.canalePc(await PonteCripto.chiaviSessione(stz.k, nTel, nPc)), n: m.n };
  // (il numero del saluto: se il service worker riparte, il «riparti» porta questo — vale solo per questa sessione)
  stz.ultimoN = m.n;
  await chrome.storage.session.set({ [STA.ultimo]: m.n }).catch(() => {});
  // `entra`: questa stazione sa provare l'entrata nella stanza (3.87): il PC del medico le dà la sua chiave
  await stzSalutoPc({ n: PonteCripto.b64u(nPc), eco: m.n, nome: await stzNome(), entra: 1 });
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
  // (con il numero dell'ultimo saluto: il PC lo accetta solo per quella sessione — un «riparti» ripetuto più tardi non ferma niente)
  if (!stz.sessione && !stz.attesa && staOra() - stz.ripartito > 2000) {
    stz.ripartito = staOra();
    const eco = stz.ultimoN || (await chrome.storage.session.get(STA.ultimo).catch(() => ({})))[STA.ultimo] || "";
    stzSalutoPc({ riparti: true, ...(eco ? { eco } : {}) });
  }
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
  try { return { ok: true, dati: await p }; }
  finally { stz.stampa.delete(rq); if (!stzLavora()) stzAssicura().catch(() => {}); }   // (stampato: i due minuti cominciano da qui)
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
  if (!stz.qui) { stz.offerta = null; await staOffertaVia(); return stzAvvia(); }
  if (!stz.qui.conferma) { await chrome.storage.local.remove(STA.qui); return stzAvvia(); }
  if (stz.qui.revoca) return;
  stz.qui = { ...stz.qui, revoca: staOra() };
  await chrome.storage.local.set({ [STA.qui]: stz.qui });
  stz.sessione = null; stz.attesa = null;
  await stzDiRevoca();
  await stzAvvia();
}

// ============================================================= il puntino
// Sull'icona nella barra, un puntino rosso (il badge più piccolo che Chrome
// disegna: un solo spazio) — e solo quando serve: un foglio non stampato
// (fallito, o esito sconosciuto) dopo l'ultima occhiata, anche se dopo ne sono
// usciti altri bene, o l'aiutante di stampa non risponde. I fogli arrivati e
// stampati bene non dicono niente: la carta si vede. Si spegne quando si apre
// la pagina della stazione o il popup (`visto`); un problema nuovo lo
// riaccende. Solo su una stazione collegata. Niente notifiche di Windows,
// nessun permesso in più.
const STA_AIUTANTE_OGNI = 30 * 60e3;
async function stzPuntino() {
  if (!chrome.action || !chrome.action.setBadgeText) return;
  const o = await chrome.storage.local.get([STA.qui, STA.lavori, STA.visto]);
  const a = (await chrome.storage.session.get(STA.aiutante))[STA.aiutante];
  const q = o[STA.qui];
  let ko = 0;
  if (q && q.conferma && !q.revoca) {
    for (const u of o[STA.lavori] || []) if (u.esito === "fallito" || u.esito === "sconosciuto") ko = Math.max(ko, u.ts || 0);
    if (a && a.ko) ko = Math.max(ko, a.ts || 0);
  }
  const rosso = ko > (o[STA.visto] || 0);
  await chrome.action.setBadgeBackgroundColor({ color: "#B3261E" });
  await chrome.action.setBadgeText({ text: rosso ? " " : "" });
}
let stzPuntinoFila = Promise.resolve();
const stzPuntinoOra = () => (stzPuntinoFila = stzPuntinoFila.then(stzPuntino, stzPuntino).catch(() => {}));
// L'aiutante di stampa c'è? Una prova ogni mezz'ora, solo su una stazione collegata e mai a un foglio in mezzo.
async function stzAiutante(forza) {
  if (!stzAttiva() || !stz.qui.conferma || stz.stampa.size || stz.inCorso.size) return;
  const a = (await chrome.storage.session.get(STA.aiutante))[STA.aiutante];
  if (!forza && a && staOra() - (a.ts || 0) < STA_AIUTANTE_OGNI) return;
  const p = await ospite({ t: "ping" }, 20e3);
  await chrome.storage.session.set({ [STA.aiutante]: { ko: !p.ok, ts: staOra() } });
}
chrome.storage.onChanged.addListener((ch, area) => {
  if ((area === "local" && (ch[STA.qui] || ch[STA.lavori] || ch[STA.visto])) || (area === "session" && ch[STA.aiutante])) stzPuntinoOra();
});
chrome.action?.onClicked?.addListener(() => { chrome.tabs.create({ url: chrome.runtime.getURL("stazione.html") }).catch(() => {}); });   // (senza popup: la build intera)

// ============================================================= in comune
// Svegli, finché il service worker è sveglio: le scadenze (un'offerta finita).
// Le prese le batte e le chiude il documento fuori schermo, anche mentre lui
// dorme; un cambiamento le apre (staCambio). Nel ripiego (le prese qui, come
// fino alla 3.86) anche una sveglia di Chrome ogni minuto finché c'è qualcosa
// da tenere aperto, e una chiamata all'API che lo tiene sveglio; se no la
// sveglia di prima (della 3.86, che resta dopo un aggiornamento) si toglie.
function staSveglia() {
  if (!chrome.alarms) return;
  const serve = fuoriRipiego() && (!!stm.coppia || !!stz.qui || !!stz.offerta);
  if (serve) chrome.alarms.get("stazione").then((a) => a || chrome.alarms.create("stazione", { periodInMinutes: 1 })).catch(() => {});
  else chrome.alarms.clear("stazione").catch(() => {});
}
chrome.alarms?.onAlarm.addListener((a) => {
  if (!a || a.name !== "stazione") return;
  if (fuoriRipiego()) { stmAvvia().catch(() => {}); stzAvvia().catch(() => {}); }
  else staSveglia();   // (la sveglia di prima: via)
  stzAiutante().catch(() => {});
});
setInterval(() => {
  if (stz.offerta && stz.offerta.scade <= staOra()) stzAvvia(false).catch(() => {});
  // (nel ripiego: una chiamata qualunque all'API dell'estensione azzera il riposo del service worker, da Chrome 110 —
  // il solo ping della presa conta da Chrome 116 —: senza, una stazione dormiente ha la presa aperta e non riceve niente)
  if (fuoriRipiego() && (stm.presa.ws || stz.presa.ws)) try { chrome.runtime.getPlatformInfo().catch(() => {}); } catch { /* niente */ }
}, STA_BATTITO);
// Qualcosa è cambiato nelle schede (psaCambio, ponte-sw.js: una scheda chiusa, un indirizzo nuovo, una pagina
// del gestionale aperta o alla pagina d'accesso): le prese servono ancora? (Un attimo dopo: una scheda che si
// chiude può essere ancora fra le pagine aperte.)
function staCambio() {
  setTimeout(() => {
    staCaricato.then(async () => {
      if (stm.coppia) await stmAssicura();
      if (stz.qui) await stzAssicura();
    }).catch(() => {});
  }, 300);
}

// Le pagine dell'estensione (la stazione, le impostazioni del PC). Le chiavi non escono mai di qui.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string" || !msg.t.startsWith("stazione")) return;
  if (!String(sender && sender.url || "").startsWith(chrome.runtime.getURL(""))) return reply({ ok: false, why: "non da qui" }), true;
  const fai = (fn) => { staCaricato.then(fn).then(reply, (e) => reply({ ok: false, why: corto(e && e.message || e, 80) })); return true; };
  // (la pagina della stazione aperta: la stazione sta sul ponte; e, ogni mezz'ora, la prova dell'aiutante)
  if (msg.t === "stazioneStato") {
    return fai(async () => {
      stzUso.pagina = staOra();
      if (stz.qui || stz.offerta) await stzAvvia();
      stzAiutante().catch(() => {});
      return { ok: true, stazione: await stzScriviStato(), lavori: (await chrome.storage.local.get(STA.lavori))[STA.lavori] || [] };
    });
  }
  if (msg.t === "stazioneVisto") return fai(async () => { await chrome.storage.local.set({ [STA.visto]: staOra() }); await stzPuntinoOra(); return { ok: true }; });
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
// Installata o aggiornata: una volta, le prese che servono (le pagine aperte hanno il codice di prima)
chrome.runtime.onInstalled?.addListener(() => { staCaricato.then(() => Promise.all([stmAvvia(), stzAvvia()])).catch(() => {}); });
// All'avvio del service worker: le coppie, l'offerta di un QR sullo schermo. Le prese, se ci sono, stanno
// nel documento fuori schermo e restano com'erano: non si aprono per un risveglio (nel ripiego sì, se servono).
const staCaricato = (async () => {
  await fuoriCaricato;
  await stzRiprendiOfferta();
  await stmAvvia(false);
  await stzAvvia(false);
  stzPuntinoOra();
  stzAiutante().catch(() => {});
})().catch(() => {});
