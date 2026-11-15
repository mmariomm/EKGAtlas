/*
 * PS Assist — gli APPUNTI del medico («Da rivedere»), nel service worker (importato da bg.js dopo ponte-sw.js).
 *
 * Un pin è un paziente da rivedere fra qualche giorno, con una nota: cognome e nome, codice fiscale (quando il PC
 * lo sa), data di nascita (quando si legge), l'indirizzo della sua pagina come il gestionale l'ha dato, la nota e
 * quando. Stanno sul ripetitore del ponte (/ponte/appunti, worker/ponte-logica.js) cifrati con la chiave degli
 * appunti A, che il telefono crea e dà a ogni PC associato dentro la sessione cifrata (`appuntiChiave`): il
 * ripetitore vede solo byte. Qui A sta nella cassa (cassa.js): una CryptoKey non estraibile per ricavare, e i suoi
 * byte avvolti da una chiave non estraibile, solo per ridarla a un telefono nuovo (perso il telefono, i pin no).
 *
 * Nessuna scadenza: un pin lo toglie solo il medico. Si legge quando il pannello lo chiede (all'avvio, e quando si
 * apre «Da rivedere»), mai a intervalli. Si scrive a ogni cambio, con il compare-and-set (cripto.js, appuntiFai).
 * Una copia in chiaro resta in storage.local (`appunti.copia`) per vederli senza rete; «Dimentica i dati…» non la
 * tocca (i pin non sono del turno). Tutte e due se ne vanno solo con «Elimina tutti…» di Da rivedere.
 * Nel registro: «pin aggiunto/tolto», mai il nome, la nota o il codice fiscale.
 */
/* global pt, ponteStanza, PonteCripto, cassaLeggi, cassaScrivi, cassaTogli, ponteIndirizzo, ponteSuScheda, ponteNota, ponteScriviStato, sulGestionale, corto */

const APP_CASSA = "appunti";            // la cassa: { hk, kw, iv, ct } (appuntiAvvolgi)
const APP_COPIA = "appunti.copia";      // storage.local: { pin: { k → pin }, ts } — la copia per vederli senza rete
const APP_NOTA_MAX = 500;
const APP_ATTESA = 10e3;
let appTenuta = null;
const appChiave = async () => appTenuta || (appTenuta = await cassaLeggi(APP_CASSA).catch(() => null));
async function appChiavi() {
  const x = await appChiave();
  return x && x.hk ? PonteCripto.appuntiChiavi(x.hk) : null;
}
async function appPosta(corpo) {
  const host = await ponteIndirizzo();
  if (!host) throw new Error("ponte da configurare");
  // (10 secondi al più: un proxy che tiene la connessione non lascia il medico ad aspettare — «Ponte non raggiungibile»)
  const r = await fetch(`${host}/ponte/appunti`, { method: "POST", body: corpo, headers: { "content-type": "text/plain" },
    credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(APP_ATTESA) });
  return { stato: r.status, json: await r.json().catch(() => ({})) };
}
const appCopia = async () => ((await chrome.storage.local.get(APP_COPIA))[APP_COPIA] || { pin: {} });
const appSalvaCopia = (pin) => chrome.storage.local.set({ [APP_COPIA]: { pin, ts: Date.now() } });
// un pin pulito: solo i suoi campi, nella loro forma
function appPin(x, ora = Date.now()) {
  const s = (v, n) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const p = { cognome: s(x.cognome, 60), nome: s(x.nome, 60), paziente: s(x.paziente, 80), cf: /^[A-Z0-9]{16}$/.test(x.cf || "") ? x.cf : "",
    nascita: /^\d{2}\/\d{2}\/\d{4}$/.test(x.nascita || "") ? x.nascita : "", nato: /^[0-9a-z]{1,10}$/.test(x.nato || "") ? x.nato : "",
    ep: /^[\w.-]{1,40}$/.test(x.ep || "") ? x.ep : "", url: typeof x.url === "string" && /^https?:\/\//.test(x.url) && x.url.length < 600 ? x.url : "",
    nota: typeof x.nota === "string" ? x.nota.slice(0, APP_NOTA_MAX) : "", quando: Number.isSafeInteger(x.quando) ? x.quando : ora, mod: ora };
  return p.paziente || p.cognome ? p : null;
}
// Le letture: ogni pannello che si apre ne chiede una (ogni pagina del gestionale): quelle entro APP_FRESCA dall'ultima,
// o mentre una è per strada, hanno la stessa risposta — una sola richiesta al ponte. «Da rivedere» aperto: `forza`.
const APP_FRESCA = 30e3;
let appLettura = null;
function appLeggi(forza = false) {
  if (appLettura && (!appLettura.fine || (!forza && Date.now() - appLettura.fine < APP_FRESCA))) return appLettura.p;
  const x = { p: null, fine: 0 };
  x.p = appFai().then((r) => { x.fine = Date.now(); if (!r.ok || r.offline || r.senza) x.fine = 1; return r; });
  appLettura = x;
  return x.p;
}
// leggi (cambia assente) o cambia: { ok, pin, senza? (nessuna chiave: il telefono non l'ha ancora data), offline? }
async function appFai(cambia = null) {
  if (cambia) appLettura = null;
  const c = await appChiavi();
  if (!c) return { ok: !cambia, senza: true, pin: (await appCopia()).pin, ...(cambia ? { errore: "Prima collega l'iPhone una volta: la chiave di Da rivedere la dà lui" } : {}) };
  try {
    const r = await PonteCripto.appuntiFai(c, appPosta, cambia, appStanza());
    await appSalvaCopia(r.doc.pin);
    return { ok: true, pin: r.doc.pin };
  } catch (e) {
    return { ok: !cambia, offline: true, stato: (e && e.stato) || 0, pin: (await appCopia()).pin, ...(cambia ? { errore: "Ponte non raggiungibile: non salvato" } : {}) };
  }
}
// la stanza del ponte di questo PC e le sue chiavi d'entrata: la prima scrittura crea gli appunti lassù solo con la
// prova di una stanza (worker/ponte-logica.js, Stanza.provaAppunti)
const appStanza = () => (pt.coppia && pt.entra ? { r: ponteStanza(),
  entra: [pt.entra.pc, pt.entra.tel, pt.qr && pt.qr.entra.pc, pt.prossima && pt.prossima.entra.pc].filter(Boolean) } : null);
const appNuovoK = () => PonteCripto.b64u(PonteCripto.casuale(9));
async function appAggiungi(x) {
  const p = appPin(x);
  if (!p) return { ok: false, errore: "Paziente senza nome" };
  // lo stesso paziente già col pin (lo stesso CF, o lo stesso indirizzo): si aggiorna la nota
  return appFai((d) => {
    const k = Object.keys(d.pin).find((q) => (p.cf && d.pin[q].cf === p.cf) || (p.url && d.pin[q].url === p.url)) || appNuovoK();
    return { ...d, pin: { ...d.pin, [k]: { ...p, quando: d.pin[k] ? d.pin[k].quando : p.quando } } };
  });
}
const appTogli = (k) => appFai((d) => { const pin = { ...d.pin }; delete pin[k]; return { ...d, pin, via: { ...d.via, [k]: Date.now() } }; });
async function appElimina() {
  const c = await appChiavi();
  if (!c) return { ok: false, errore: "Nessun pin" };
  const r = await PonteCripto.appuntiElimina(c, appPosta).catch(() => ({ stato: 0 }));
  if (r.stato !== 200) return { ok: false, errore: "Ponte non raggiungibile: niente eliminato" };
  await chrome.storage.local.remove(APP_COPIA);
  return { ok: true, pin: {} };
}

// Dal telefono, nella sessione cifrata (ponte-sw.js, ponteRisposta): la chiave degli appunti. Il telefono manda
// la sua (`k`), e da qui è lei; senza, il PC gli ridà la sua (un telefono nuovo, o reinstallato); nessuno dei due
// l'ha: «» — la crea il telefono, e la manda.
async function appuntiDalTel(d) {
  const mia = await appChiave();
  if (typeof d.k === "string" && d.k) {
    let raw;
    try { raw = PonteCripto.daB64u(d.k); } catch { return { ok: false, errore: "Chiave dei pin non valida" }; }
    if (raw.length !== 32) return { ok: false, errore: "Chiave dei pin non valida" };
    const uguale = mia && PonteCripto.b64u(await PonteCripto.appuntiSvolgi(mia).catch(() => new Uint8Array())) === d.k;
    if (!uguale) {
      const x = await PonteCripto.appuntiAvvolgi(raw);
      await cassaScrivi(APP_CASSA, x);
      appTenuta = x;
      await chrome.storage.local.remove(APP_COPIA);   // (la copia era di un'altra chiave)
      appFai().catch(() => {});   // (i pin di questa chiave, una volta: le schede del gestionale li vedono — appunti.copia)
    }
    return { ok: true, dati: { k: d.k } };
  }
  return { ok: true, dati: { k: mia ? PonteCripto.b64u(await PonteCripto.appuntiSvolgi(mia)) : "" } };
}
// Dal telefono: «📌» su un paziente — chi è lo dice la scheda del gestionale (cognome, nome, CF, nascita,
// l'indirizzo della sua pagina), poi il pin lassù.
async function appuntiPinDalTel(d) {
  const r = await ponteSuScheda("pinDati", { ep: typeof d.ep === "string" && /^[\w.-]{1,40}$/.test(d.ep) ? d.ep : "" });
  if (!r || !r.ok) return r || { ok: false, errore: "Il PC non risponde" };
  const x = await appAggiungi({ ...r.dati, nota: typeof d.nota === "string" ? d.nota : "", quando: Date.now() });
  if (x.ok) { ponteNota("iPhone · pin aggiunto"); await ponteScriviStato(); }
  return x.ok ? { ok: true } : x;
}

// Dalle pagine del gestionale (il pannello): { t: "appunti", azione: leggi|aggiungi|togli|elimina|copia }
// («Dimentica i dati…» non tocca i pin: non sono del turno — se ne vanno solo con «Elimina tutti…» di Da rivedere)
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.t !== "appunti" || !sender || !sender.tab || !sulGestionale(sender.url)) return;
  const fai = (p) => { p.then(reply, (e) => reply({ ok: false, errore: corto(e && e.message || e, 80) })); return true; };
  if (msg.azione === "leggi") return fai(appLeggi(msg.forza === true));
  if (msg.azione === "aggiungi" && msg.pin && typeof msg.pin === "object") return fai(appAggiungi(msg.pin));
  if (msg.azione === "togli" && typeof msg.k === "string" && /^[\w-]{1,20}$/.test(msg.k)) return fai(appTogli(msg.k));
  if (msg.azione === "elimina") return fai(appElimina());
  if (msg.azione === "copia") return fai(appCopia().then((c) => ({ ok: true, pin: c.pin || {} })));
});
/* exported appuntiDalTel, appuntiPinDalTel, cassaTogli */
