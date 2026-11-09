/*
 * PS Assist — il registratore (⋯ → Registrazioni), la parte nel service worker.
 *
 * Il medico registra UNA sessione vera di lavoro, per ricostruire le pagine di
 * esempio, imparare il flusso vero (ordini → carrello → conferma → etichette;
 * referti che passano da due rinvii a un PDF in un'altra finestra; la lista del
 * PS per area) e i tempi veri. Mentre registra, e solo sul gestionale e sul
 * portale:
 *   - le pagine che apre, in ogni scheda e finestra: il DOM com'è dopo il
 *     caricamento (lo manda registra-pagina.js, il content script accanto al
 *     pannello) — nessuna richiesta in più al server;
 *   - il flusso delle richieste, solo OSSERVATO con chrome.webRequest: metodo,
 *     indirizzo, stato, rinvii, tempi, tipo, scheda, e quali ha fatto
 *     l'estensione;
 *   - i PDF (referti, etichette): i byte che l'estensione ha già in mano, o UNA
 *     rilettura dalla cache del browser (cache: "force-cache") dello stesso
 *     indirizzo appena aperto. Dei PDF nello zip va solo il testo anonimizzato.
 * Tutto resta nella memoria dell'estensione, su questo PC, finché il medico non
 * preme «Ferma e salva»: allora un documento fuori schermo (registra-esporta.html,
 * chrome.offscreen — nessuna scheda, nessuno scarico) anonimizza
 * (registra-anonimo.js), controlla e salva lo zip nel database dell'estensione
 * (registra-db.js), e il grezzo se ne va nella stessa transazione. Gli zip li
 * guarda, scarica e cancella il pannello (⋯ → Registrazioni) e l'iPhone
 * (ponte-sw.js); non parte niente verso nessuno. Dopo 60 minuti la
 * registrazione si ferma e si salva da sola; un grezzo mai salvato si cancella
 * da solo dopo 12 ore. Al più 30 zip e 300 MB: oltre, vanno via i più vecchi,
 * prima quelli automatici.
 * Anche il SISS (il menu operatore e il Prescrittivo Regionale, REG_SISS): lì
 * il pannello non c'è — solo registra-pagina.js — e il flusso è lo stesso,
 * osservato: XHR e fetch delle sue API, rinvii, tempi, il PDF di «Stampa RE».
 * Mai un corpo di risposta; dei moduli inviati mai un campo di credenziali
 * (password, PIN, OTP).
 * Anche il visualizzatore di immagini del PACS (eViewer: un host, ogni porta,
 * http o https), per vedere com'è fatto prima di decidere come mostrare le
 * radiografie sul telefono: le sue istantanee (senza immagini), la sua forma
 * tecnica (registra-sonda.js e registra-pagina.js), i clic, e delle sue
 * richieste in più la misura, le intestazioni della cache e chi le ha
 * chieste. Mai un pixel, mai un byte d'immagine.
 *
 * LA REGISTRAZIONE AUTOMATICA (accesa di norma, ⋯ → Registrazioni la spegne):
 * quando il medico non registra, lo stesso registratore tiene gli ultimi
 * 3 minuti (REG_FINESTRA) — stesse pagine, stesse esclusioni, nessuna
 * rilettura dalla cache, nessuna pill — in una tabella sua («scorre»), potata
 * di continuo (a ogni scrittura e ogni 30 secondi, con chrome.alarms, finché
 * c'è qualcosa) e svuotata all'avvio del browser: chiuso il browser, sparisce.
 * Quando un ordine finisce male (arancione o rosso: un errore, esami che
 * mancano, un ORA-, etichette non stampate — lo dice bg.js, regDopoOrdini e
 * regDopoErrore), aspetta un minuto per vedere com'è andata a finire (intanto
 * i 3 minuti prima dell'incidente non si potano) e salva da lì a adesso come
 * zip «auto», anonimizzato e controllato come gli altri; un incidente, uno
 * zip. Mentre il medico registra a mano, vince la sua.
 * Vede le costanti di bg.js (SA4, ALLOWED_ORIGINS, FINALI, corto, b64, segnaErrore): è caricato da lì.
 */
importScripts("registra-db.js");
const REG = "registra";                 // lo stato, in storage.local: lo legge anche il pannello (● REC)
const REG_AUTO = "registra.auto";       // storage.local: false = registrazione automatica spenta (di norma accesa)
const REG_ELENCO = "registra.elenco";   // storage.local: { n, byte, ts } — cambia quando cambiano gli zip (il pannello si ridisegna)
const REG_INC = "registra.incidente";   // storage.session: { ts, motivi } — l'incidente che aspetta il suo minuto
const REG_VIVO = "registra.vivo";       // storage.session: il browser è aperto da allora (gli ultimi minuti sono di questa sessione)
const REG_DURATA = 60 * 60e3;
const REG_TTL = 12 * 3600e3;
const REG_FINESTRA = 3 * 60e3;          // la registrazione automatica: gli ultimi 3 minuti, mai di più
let REG_DOPO = 60e3;                    // dopo l'incidente si aspetta un minuto, poi si salva (i test lo accorciano)
const REG_ZIP_N = 30, REG_ZIP_MAX = 300 * 1024 * 1024;
const REG_PAGINA_MAX = 8e6;             // un DOM più grande di così non è una pagina del gestionale
const REG_PDF_MAX = 15 * 1024 * 1024;
const REG_PDF_N = 200;
const REG_PAGINE_N = 1500;
const REG_AL_POTA = "registra-pota", REG_AL_INC = "registra-incidente";
const REG_ST = "grezzi", REG_SC = "scorre";

// il SISS: due origini esatte, solo https (anche in manifest.json)
const REG_SISS = new Set(["https://dcss.cgi.crs.lombardia.it", "https://operatorisiss.servizirl.it"]);
const regSiss = (url) => { try { return REG_SISS.has(new URL(url).origin); } catch { return false; } };
// il visualizzatore del PACS: un host, ogni porta, http o https (anche in manifest.json)
const REG_VIEWER = "mmeviewer.multimedica.root.lan";
const regViewer = (url) => { try { const u = new URL(url); return u.hostname === REG_VIEWER && /^https?:$/.test(u.protocol); } catch { return false; } };
// i campi che non si registrano mai, neanche nel grezzo
const REG_CRED = /(?:^|[^a-z])(?:pin|otp|password|passwd|pwd|passcode|puk|sblocco)(?:[^a-z]|$)|one[\s_-]?time|j_password/i;
const REG_MOTIVI = new Set(["caricata", "uscita", "rotta", "overlay", "quiete"]);

let regStato = null;
let regCaricato = false;
let regPortale = "";
let regAuto = true;
const regAttiva = (s = regStato) => !!s && s.stato === "rec" && Date.now() < s.scade;
// si tiene qualcosa: la registrazione a mano, o (se no) gli ultimi minuti
const regCattura = () => regAttiva() || (regCaricato && regAuto);
const regNostra = (url) => {
  try { const o = new URL(url).origin; return o === SA4 || ALLOWED_ORIGINS.has(o) || REG_SISS.has(o) || (!!regPortale && o === regPortale) || regViewer(url); }
  catch { return false; }
};
const regOrigini = () => ({ gestionale: SA4, portale: regPortale, altri: [...ALLOWED_ORIGINS].filter((x) => x !== SA4), siss: [...REG_SISS], viewer: [REG_VIEWER] });

let regScadenza = null;
async function regLeggi() {
  // Il browser si è appena aperto (storage.session muore con lui: il segno non
  // c'è) — o l'estensione è stata ricaricata: gli ultimi minuti di prima via,
  // prima di tenere qualunque cosa. (Anche runtime.onStartup, qui sotto: questo
  // vale pure dove quello non arriva.)
  if (!(await chrome.storage.session.get(REG_VIVO).catch(() => ({})))[REG_VIVO]) {
    await regScorreVia();
    await chrome.storage.session.set({ [REG_VIVO]: Date.now() }).catch(() => {});
  }
  const o = await chrome.storage.local.get([REG, "portale", REG_AUTO]);
  regStato = o[REG] || null;
  regPortale = o.portale || "";
  regAuto = o[REG_AUTO] !== false;
  regCaricato = true;
  clearTimeout(regScadenza);
  if (regStato && regStato.stato === "rec") {
    if (Date.now() >= regStato.scade) regFermaESalva("dopo 60 minuti").catch(() => {});
    else regScadenza = setTimeout(() => regFermaESalva("dopo 60 minuti").catch(() => {}), regStato.scade - Date.now() + 500);
  }
  // un grezzo mai salvato non resta sul PC
  if (regStato && regStato.stato !== "rec" && Date.now() - (regStato.fine || regStato.inizio || 0) > REG_TTL) await regCancella();
  // fermata ma non salvata (il service worker si è fermato a metà): si riprova, al più due volte
  else if (regStato && regStato.stato === "fermo" && !regStato.errore && !regSalvando(regStato) && (regStato.prove || 0) < 2) regSalvaManuale().catch(() => {});
  regPota().catch(() => {});
  return regStato;
}
let regPronto = regLeggi().catch(() => null);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch[REG]) regStato = ch[REG].newValue || null;
  if (ch.portale) regPortale = ch.portale.newValue || "";
  if (ch[REG_AUTO]) {
    regAuto = ch[REG_AUTO].newValue !== false;
    if (!regAuto) regScorreVia().catch(() => {});   // spenta: quello che aveva in memoria se ne va subito
  }
});
const regSalvando = (s) => !!s && !!s.salvo && Date.now() - s.salvo < 5 * 60e3;

// Il grezzo (pagine, flusso, PDF) sta in IndexedDB (registra-db.js), non in
// storage.local: là lo leggerebbe per intero ogni get(null) del resto
// dell'estensione, e un'ora di pagine pesa decine di MB. Ogni voce:
// { tipo: "pagina" | "flusso" | "pdf", ts, ... }; nella registrazione a mano
// in «grezzi», negli ultimi minuti in «scorre».
const regTx = (st, modo, fn) => RegistraDb.tx(st, modo, fn);
const regMetti = (voce) => {
  const st = regAttiva() ? REG_ST : REG_SC;
  if (st === REG_SC) regPotaPoi();
  return regTx(st, "readwrite", (s) => { s.add({ ts: Date.now(), ...voce }); });
};
// (anche per i test: quanto c'è, e tutto)
const regContaDi = (st) => regTx(st, "readonly", (s) => s.getAll()).then((l) => ({
  pagine: l.filter((x) => x.tipo === "pagina").length, flusso: l.filter((x) => x.tipo === "flusso").reduce((n, x) => n + x.flusso.length, 0),
  pdf: l.filter((x) => x.tipo === "pdf").map((x) => x.url), piuVecchia: l.reduce((m, x) => Math.min(m, x.ts || 0), Infinity),
}));
const regConta = () => regContaDi(REG_ST);
const regContaScorre = () => regContaDi(REG_SC);
const regTutto = () => regTx(REG_ST, "readonly", (s) => s.getAll());

async function regCancella() {
  await regTx([REG_ST, REG_SC], "readwrite", (a, b) => { a.clear(); b.clear(); }).catch(() => {});
  await chrome.storage.local.remove(REG);
  regStato = null;
}

// ------------------------------------------------- gli ultimi 3 minuti
// Potati a ogni scrittura (al più ogni 20 secondi) e, finché la tabella non è
// vuota, ogni 30 secondi con un allarme (che sveglia il service worker anche
// se il gestionale tace): niente resta più di REG_FINESTRA, salvo quei secondi
// — e il minuto in cui un incidente aspetta: lì si tengono i suoi 3 minuti prima.
let regPotaT = 0, regPotaArmata = false;
function regPotaPoi() {
  if (Date.now() - regPotaT > 20e3) { regPotaT = Date.now(); regPota().catch(() => {}); }
  if (regPotaArmata || !chrome.alarms) return;
  regPotaArmata = true;
  chrome.alarms.get(REG_AL_POTA).then((a) => a || chrome.alarms.create(REG_AL_POTA, { periodInMinutes: 0.5 })).catch(() => { regPotaArmata = false; });
}
async function regPota() {
  // (con un incidente che aspetta il suo minuto, si tengono i 3 minuti prima dell'incidente)
  const inc = (await chrome.storage.session.get(REG_INC).catch(() => ({})))[REG_INC];
  const limite = Math.min(Date.now() - REG_FINESTRA, inc && inc.ts ? inc.ts - REG_FINESTRA : Infinity);
  const resta = await regTx(REG_SC, "readwrite", (s) => {
    const ix = s.index("ts");
    const c = ix.openKeyCursor(IDBKeyRange.upperBound(limite, true));
    c.onsuccess = () => { const k = c.result; if (k) { s.delete(k.primaryKey); k.continue(); } };
    return ix.count(IDBKeyRange.lowerBound(limite));
  });
  if (!regAttiva()) regPdfVisti.clear();
  if (!resta && chrome.alarms) { regPotaArmata = false; await chrome.alarms.clear(REG_AL_POTA).catch(() => {}); }
  return resta;
}
async function regScorreVia() {
  await regTx(REG_SC, "readwrite", (s) => { s.clear(); }).catch(() => {});
  await chrome.storage.session.remove(REG_INC).catch(() => {});
  if (chrome.alarms) { regPotaArmata = false; await chrome.alarms.clear(REG_AL_POTA).catch(() => {}); await chrome.alarms.clear(REG_AL_INC).catch(() => {}); }
}
// all'avvio del browser gli ultimi minuti di ieri non ci sono più (e regLeggi, col segno in storage.session)
chrome.runtime.onStartup?.addListener(() => { regScorreVia().catch(() => {}); });
chrome.alarms?.onAlarm.addListener((a) => {
  if (a.name === REG_AL_POTA) regPota().catch(() => {});
  if (a.name === REG_AL_INC) regIncidenteSalva().catch(() => {});
});

// ------------------------------------------------------------ il flusso
const regInVolo = new Map();           // requestId → la richiesta, finché non finisce
const regRilettura = new Set();        // indirizzi che il registratore sta rileggendo
const regPdfVisti = new Set();         // indirizzi di cui ha già i byte
let regPdfN = 0, regPagineN = 0;
let regBuf = { flusso: [], note: [], schede: [], clic: [] };
let regBufT = null;
function regAccoda(tipo, x) {
  regBuf[tipo].push(x);
  if (!regBufT) regBufT = setTimeout(() => { regScarica().catch(() => {}); }, 1500);
}
async function regScarica() {
  clearTimeout(regBufT); regBufT = null;
  const b = regBuf;
  if (!b.flusso.length && !b.note.length && !b.schede.length && !b.clic.length) return;
  regBuf = { flusso: [], note: [], schede: [], clic: [] };
  await regMetti({ tipo: "flusso", ...b });
}
const REG_FILTRO = { urls: ["http://*/*", "https://*/*"] };
const regQuando = (fn) => (d) => {
  // il service worker può essersi appena svegliato: lo stato arriva un attimo dopo
  if (!regCaricato) { regPronto.then(() => { if (regCattura()) fn(d); }); return; }
  if (regStato && regStato.stato === "rec" && !regAttiva()) regFermaESalva("dopo 60 minuti").catch(() => {});
  if (regCattura()) fn(d);
};
chrome.webRequest.onBeforeRequest.addListener(regQuando((d) => {
  if (!regNostra(d.url) || regInVolo.has(d.requestId) || /\/favicon\.ico(?:$|\?)/i.test(d.url)) return;
  const iniziatore = String(d.initiator || "");
  const r = {
    metodo: d.method, url: d.url, tipo: d.type, scheda: d.tabId, frame: d.frameId, inizio: d.timeStamp, rinvii: [],
    estensione: iniziatore.startsWith("chrome-extension://") || undefined,
    registratore: regRilettura.has(d.url) || undefined,
  };
  const fd = d.requestBody && d.requestBody.formData;
  if (fd) {
    r.corpo = {};
    for (const [k, v] of Object.entries(fd).slice(0, 200)) r.corpo[k] = REG_CRED.test(k.replace(/([a-z0-9])([A-Z])/g, "$1 $2")) ? ["(credenziale: non registrata)"] : (Array.isArray(v) ? v : [v]).slice(0, 20).map((x) => String(x).slice(0, 2000));
  }
  if (regSiss(d.url)) r.siss = true;
  if (regViewer(d.url)) { r.viewer = true; if (iniziatore) r.iniziatore = iniziatore.slice(0, 200); }
  regInVolo.set(d.requestId, r);
}), REG_FILTRO, ["requestBody"]);
chrome.webRequest.onBeforeRedirect.addListener(regQuando((d) => {
  const r = regInVolo.get(d.requestId);
  if (r) r.rinvii.push({ stato: d.statusCode, a: d.redirectUrl, t: d.timeStamp });
}), REG_FILTRO);
chrome.webRequest.onHeadersReceived.addListener(regQuando((d) => {
  const r = regInVolo.get(d.requestId);
  if (!r) return;
  const ct = ((d.responseHeaders || []).find((h) => /^content-type$/i.test(h.name)) || {}).value || "";
  r.stato = d.statusCode;
  if (ct) r.contenuto = ct.split(";")[0].trim().toLowerCase().slice(0, 60);
  if (/pdf/i.test(ct)) r.pdf = true;
  // un PDF del SISS che il browser non tiene in cache: rileggerlo vorrebbe
  // dire chiederlo di nuovo al server regionale (una stampa in più) — no
  const cc = ((d.responseHeaders || []).find((h) => /^cache-control$/i.test(h.name)) || {}).value || "";
  if (r.siss && /no-store/i.test(cc)) r.nonInCache = true;
  // il visualizzatore: quanto pesa e come si tiene in cache (per sapere se le immagini si possono rileggere)
  if (r.viewer) {
    const h = (n) => String(((d.responseHeaders || []).find((x) => x.name.toLowerCase() === n) || {}).value || "");
    const lung = Number(h("content-length"));
    r.intestazioni = {
      ...(ct ? { tipo: ct.replace(/;\s*boundary=(?:"[^"]*"|[^;]*)/i, "").trim().toLowerCase().slice(0, 120) } : {}),
      ...(Number.isFinite(lung) && h("content-length") ? { lunghezza: lung } : {}),
      ...(cc ? { cache: cc.slice(0, 120) } : {}),
      ...(h("etag") ? { etag: true } : {}), ...(h("last-modified") ? { ultimaModifica: true } : {}), ...(h("expires") ? { scade: true } : {}),
      ...(h("content-encoding") ? { codifica: h("content-encoding").slice(0, 30) } : {}), ...(h("accept-ranges") ? { intervalli: h("accept-ranges").slice(0, 20) } : {}),
      ...(h("vary") ? { vary: h("vary").slice(0, 80) } : {}), ...(h("pragma") ? { pragma: h("pragma").slice(0, 30) } : {}),
    };
  }
}), REG_FILTRO, ["responseHeaders"]);
chrome.webRequest.onCompleted.addListener(regQuando((d) => {
  const r = regInVolo.get(d.requestId);
  if (!r) return;
  regInVolo.delete(d.requestId);
  r.fine = d.timeStamp; r.stato = d.statusCode; if (d.fromCache) r.daCache = true;
  if (r.url !== d.url) r.finale = d.url;
  regAccoda("flusso", r);
  // un PDF aperto: se nessuno ne ha già i byte, una rilettura dalla cache
  // (solo nella registrazione a mano: quella automatica non chiede niente)
  if (r.pdf && r.nonInCache) r.nonRiletto = "non in cache";
  else if (r.pdf && !r.registratore && d.statusCode >= 200 && d.statusCode < 300 && regAttiva()) {
    const u = d.url;
    setTimeout(() => regRileggi(u, r).catch(() => {}), 2500);
  }
}), REG_FILTRO);
chrome.webRequest.onErrorOccurred.addListener(regQuando((d) => {
  const r = regInVolo.get(d.requestId);
  if (!r) return;
  regInVolo.delete(d.requestId);
  r.fine = d.timeStamp; r.errore = String(d.error || "errore").slice(0, 80);
  regAccoda("flusso", r);
}), REG_FILTRO);

// le schede e le finestre nuove: chi ha aperto chi
chrome.tabs.onCreated.addListener((tab) => {
  if (!regCattura()) return;
  const s = { id: tab.id, apertaDa: tab.openerTabId ?? null, finestra: tab.windowId, ts: Date.now() };
  chrome.windows.get(tab.windowId).then((w) => { if (w && w.type === "popup") s.popup = true; }).catch(() => {})
    .finally(() => regAccoda("schede", s));
});

// ------------------------------------------------------------- i PDF
const regEPdf = (buf) => buf && buf.byteLength > 4 && String.fromCharCode(...new Uint8Array(buf, 0, 5)) === "%PDF-";
async function regTieniPdf(url, buf, origine, scheda) {
  const aMano = regAttiva();
  if (!regCattura() || !regEPdf(buf) || buf.byteLength > REG_PDF_MAX || (aMano && regPdfN >= REG_PDF_N)) return false;
  if (regPdfVisti.has(url)) return true;
  regPdfVisti.add(url); if (aMano) regPdfN++;
  await regMetti({ tipo: "pdf", url, ts: Date.now(), scheda: scheda ?? null, origine, byte: new Uint8Array(buf.slice(0)) });
  return true;
}
const REG_SCRIVE = /[?&](ccsForm|Insert|Delete|Update|Update1|Conferma)=/i;
async function regRileggi(url, r) {
  if (!regAttiva() || regPdfVisti.has(url) || regRilettura.has(url) || regPdfN >= REG_PDF_N) return;
  // solo la lettura di un documento: mai un modulo inviato, mai un indirizzo che scrive
  if (r.metodo !== "GET" || REG_SCRIVE.test(url) || !/^https?:/.test(url)) return;
  regRilettura.add(url);
  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), 20000);
    const res = await regFetch0(url, { credentials: "include", cache: "force-cache", redirect: "follow", signal: ctl.signal });
    const buf = await res.arrayBuffer();
    clearTimeout(tid);
    await regTieniPdf(url, buf, "rilettura", r.scheda);
  } catch { /* il testo di questo PDF non ci sarà: il flusso lo dice comunque */ }
  finally { setTimeout(() => regRilettura.delete(url), 60e3); }
}
// I PDF che il service worker scarica per conto suo (i referti salvati, le
// etichette della stampa automatica): i byte ci sono già, si tengono quelli.
const regFetch0 = self.fetch.bind(self);
self.fetch = function (input, init) {
  const p = regFetch0(input, init);
  if (regCattura()) {
    p.then((res) => {
      const u = res.url || (typeof input === "string" ? input : input && input.url) || "";
      if (!regNostra(u) || regRilettura.has(u)) return;
      if (!/pdf|octet-stream/i.test(res.headers.get("content-type") || "")) return;
      res.clone().arrayBuffer().then((b) => regTieniPdf(u, b, "estensione", null)).catch(() => {});
    }).catch(() => {});
  }
  return p;
};

// ------------------------------------------------------- a mano: via e ferma
async function regAvvia() {
  await regCancella();
  regInVolo.clear(); regRilettura.clear(); regPdfVisti.clear(); regPdfN = 0; regPagineN = 0;
  regBuf = { flusso: [], note: [], schede: [], clic: [] };
  const o = await chrome.storage.local.get("portale");
  regPortale = o.portale || "";
  const ora = Date.now();
  regStato = { stato: "rec", inizio: ora, scade: ora + REG_DURATA, versione: chrome.runtime.getManifest().version, origini: regOrigini() };
  await chrome.storage.local.set({ [REG]: regStato });
  clearTimeout(regScadenza);
  regScadenza = setTimeout(() => regFermaESalva("dopo 60 minuti").catch(() => {}), REG_DURATA + 500);
  return regStato;
}
async function regFerma(come = "fermata a mano") {
  const s = regStato || (await chrome.storage.local.get(REG))[REG];
  if (!s || s.stato !== "rec") return s;
  clearTimeout(regScadenza);
  // quello che è ancora in volo finisce così com'è
  for (const r of regInVolo.values()) regBuf.flusso.push({ ...r, incompiuta: true });
  regInVolo.clear();
  await regScarica().catch(() => {});
  regStato = { ...s, stato: "fermo", fine: Math.min(Date.now(), s.scade), comeFinita: Date.now() >= s.scade ? "dopo 60 minuti" : come };
  await chrome.storage.local.set({ [REG]: regStato });
  return regStato;
}
// «Ferma e salva»: ferma, e salva lo zip (anche dopo 60 minuti, da sola)
let regFermando = null;
const regFermaESalva = (come) => regFermando || (regFermando = (async () => {
  try { await regFerma(come); return await regSalvaManuale(); } finally { regFermando = null; }
})());

// ------------------------------------------------------------- salvare
// Uno zip alla volta, in un documento fuori schermo (registra-esporta.html):
// aperto per lo zip, poi chiuso. Il service worker resta sveglio intanto.
let regFilaSalva = Promise.resolve();
const regInFila = (fn) => (regFilaSalva = regFilaSalva.then(fn, fn));
let REG_PROVA = null;   // (solo i test: opzioni dell'anonimizzazione, p.es. uno sfasamento fisso)
async function regFuori(m) {
  const c = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => []) : [];
  if (!c.length) {
    await chrome.offscreen.createDocument({ url: "registra-esporta.html?fuori=1", reasons: ["DOM_PARSER", "BLOBS"],
      justification: "Anonimizza la registrazione (il testo dei PDF con pdf.js) e salva lo zip nella memoria dell'estensione, senza aprire schede" });
  }
  const sveglio = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20e3);
  try {
    for (let k = 0; ; k++) {
      try { const r = await chrome.runtime.sendMessage(m); if (r) return r; }
      catch (e) { if (!/Receiving end/i.test(String(e && e.message || e))) throw e; }
      if (k >= 40) throw new Error("il documento che salva non risponde");
      await new Promise((ok) => setTimeout(ok, 250));
    }
  } finally {
    clearInterval(sveglio);
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}
const regNomeZip = (ts, auto) => {
  const d = new Date(ts), p2 = (n) => String(n).padStart(2, "0");
  return `psassist-registrazione-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${auto ? "-auto" : ""}.zip`;
};
async function regSalvaOra({ fonte, st, motivo, errore = "", quando, da = 0 }) {
  // il registro degli errori: dall'ultima registrazione a mano salvata (le voci restano: si sposta solo il segno);
  // in uno zip automatico, quelli dei suoi minuti
  const reg = await chrome.storage.local.get(["errori.v1", "errori.esportati"]);
  const tutti = (Array.isArray(reg["errori.v1"]) ? reg["errori.v1"] : []).filter(Boolean);
  const errori = fonte === REG_ST ? tutti.filter((x) => x.ts > (reg["errori.esportati"] || 0)) : tutti.filter((x) => x.ts >= da);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const r = await regFuori({ t: "regFuoriEsporta", fonte, st, errori, da, opz: REG_PROVA || {},
    meta: { id, base: regNomeZip(quando || st.inizio, motivo === "auto"), motivo, errore, quando: quando || st.inizio } });
  if (!r || !r.ok) throw new Error((r && r.why) || "lo zip non è stato salvato");
  if (fonte === REG_ST && errori.length) await chrome.storage.local.set({ "errori.esportati": Math.max(...errori.map((x) => x.ts)) });
  await regTetti().catch(() => {});
  await regAvvisaElenco();
  return r.meta;
}
function regSalvaManuale() {
  return regInFila(async () => {
    const s = (await chrome.storage.local.get(REG))[REG];
    if (!s || s.stato !== "fermo") return { ok: false, why: "nessuna registrazione da salvare" };
    regStato = { ...s, salvo: Date.now(), errore: "", prove: (s.prove || 0) + 1 };
    await chrome.storage.local.set({ [REG]: regStato });
    try {
      const meta = await regSalvaOra({ fonte: REG_ST, st: s, motivo: "manuale", quando: s.inizio });
      regStato = null;
      await chrome.storage.local.remove(REG);
      return { ok: true, zip: regMetaPubblica(meta) };
    } catch (e) {
      const why = corto(e && e.message || e, 140);
      regStato = { ...regStato, salvo: 0, errore: why };
      await chrome.storage.local.set({ [REG]: regStato });
      segnaErrore("registra", { motivo: why });
      return { ok: false, why };
    }
  });
}

// I tetti: al più 30 zip e 300 MB; oltre, vanno via i più vecchi — prima gli
// automatici, poi quelli a mano. L'ultimo salvato resta sempre.
async function regTetti() {
  const l = (await regTx("zip", "readonly", (s) => s.getAll())).sort((a, b) => a.ts - b.ts);
  let n = l.length, tot = l.reduce((x, z) => x + (z.byte || 0), 0);
  const via = [];
  for (const tipo of ["auto", "manuale"]) {
    for (const z of l.slice(0, -1)) {
      if (n <= REG_ZIP_N && tot <= REG_ZIP_MAX) break;
      if (z.motivo !== tipo) continue;
      via.push(z.id); n--; tot -= z.byte || 0;
    }
  }
  if (via.length) await regTx(["zip", "zipdati"], "readwrite", (a, b) => { for (const id of via) { a.delete(id); b.delete(id); } });
}
async function regAvvisaElenco() {
  const l = await regTx("zip", "readonly", (s) => s.getAll());
  await chrome.storage.local.set({ [REG_ELENCO]: { n: l.length, byte: l.reduce((x, z) => x + (z.byte || 0), 0), ts: Date.now() } });
}
// quello che si mostra di uno zip (pannello e telefono): niente pazienti, il nome dello zip e i suoi numeri
const regMetaPubblica = (z, riepilogo = true) => ({
  id: z.id, nome: z.nome, ts: z.ts, quando: z.quando, byte: z.byte, motivo: z.motivo, errore: z.errore || "",
  controllo: !!z.controllo, punti: z.punti || 0, pagine: z.pagine || 0, richieste: z.richieste || 0, pdf: z.pdf || 0,
  ...(riepilogo ? { riepilogo: z.riepilogo || "" } : {}),
});
const regElenco = async (riepilogo = true) => (await regTx("zip", "readonly", (s) => s.getAll()))
  .sort((a, b) => b.ts - a.ts).map((z) => regMetaPubblica(z, riepilogo));
async function regZipVia(id) {
  const z = await regTx("zip", "readonly", (s) => s.get(String(id)));
  if (!z) return null;
  await regTx(["zip", "zipdati"], "readwrite", (a, b) => { a.delete(z.id); b.delete(z.id); });
  if (regCopia && regCopia.id === z.id) regCopia = null;
  await regAvvisaElenco();
  return z;
}
// «Cancella tutto»: tutti gli zip salvati (il grezzo di una registrazione in corso non si tocca)
async function regZipTutti() {
  const l = await regTx("zip", "readonly", (s) => s.getAll());
  for (const z of l) await regZipVia(z.id);
  return l.length;
}
// Uno zip a pezzi (base64), per il pannello e per il telefono: i byte letti
// una volta e tenuti in memoria per un minuto, finché arrivano i pezzi.
let regCopia = null, regCopiaT = 0;
async function regPezzo(id, i, pezzo) {
  if (!regCopia || regCopia.id !== id) {
    const z = await regTx("zip", "readonly", (s) => s.get(String(id)));
    const byte = z && await regTx("zipdati", "readonly", (s) => s.get(z.id));
    if (!z || !byte) return null;
    regCopia = { id: z.id, nome: z.nome, byte: new Uint8Array(byte) };
  }
  clearTimeout(regCopiaT);
  regCopiaT = setTimeout(() => { regCopia = null; }, 60e3);
  const { byte, nome } = regCopia, n = Math.max(1, Math.ceil(byte.length / pezzo));
  if (!Number.isSafeInteger(i) || i < 0 || i >= n) return null;
  if (i === n - 1) { clearTimeout(regCopiaT); const c = regCopia; regCopiaT = setTimeout(() => { if (regCopia === c) regCopia = null; }, 5e3); }
  return { nome, size: byte.length, n, i, b: b64(byte.subarray(i * pezzo, (i + 1) * pezzo)) };
}

// ------------------------------------------------- la registrazione automatica
// bg.js, a ogni scrittura degli ordini (ordScrivi, dopo ordPubblico: la sola
// funzione che dice com'è finito un ordine): quelli finiti in arancione o in
// rosso — e un ordine fermo —, una volta sola ciascuno (il segno sta
// nell'ordine). Il motivo è il titolo della striscia e gli esami che mancano:
// mai il paziente.
function regDopoOrdini(l) {
  for (const r of l) {
    const p = r && r.pubblico;
    if (!p || r.regVisto || !["warn", "err"].includes(p.tono)) continue;
    if (!(FINALI.has(r.stato) || r.stato === "stampa" || (r.stato === "corre" && r.muto))) continue;
    r.regVisto = true;
    const mancano = (r.resto && Array.isArray(r.resto.mancano)) ? r.resto.mancano : [];
    regIncidente([p.titolo, mancano.length ? `mancano: ${mancano.join(", ")}` : ""].filter(Boolean).join(" · ")).catch(() => {});
  }
}
// …e il registro degli errori (segnaErrore): un giro del motore fuori dal
// giornale degli ordini (nella scheda del medico) che fallisce, o un «ORA-»
// del gestionale anche quando la richiesta rifatta è riuscita. I suoi dati
// non hanno mai nomi. Anche la ricetta SISS fermata o in errore (non quella
// pronta: «inserite» è la fine giusta delle visite) e l'errore grave della
// Terapia: il motivo è solo il passo, mai il testo della pagina.
function regDopoErrore(v) {
  if (!v) return;
  const d = v.dati || {};
  if (v.tipo === "ricetta" && ["errore", "fermo"].includes(d.esito)) {
    regIncidente(`SISS: ${d.esito}${d.passo ? ` (${String(d.passo).replace(/[^\w\s-]/g, "").slice(0, 30)})` : ""}`).catch(() => {});
    return;
  }
  if (v.tipo === "terapia") { regIncidente(`Terapia: ${d.perche === "nome diverso" || d.perche === "episodio diverso" ? d.perche : "errore"}`).catch(() => {}); return; }
  // (la Terapia dal telefono: ogni no, e ogni dubbio dopo «Conferma» — il motivo è un passo, mai un testo della pagina)
  if (v.tipo === "terapia telefono") { regIncidente(`Terapia telefono: ${String(d.perche || "errore").replace(/[^\p{L}\s'-]/gu, "").trim().slice(0, 40) || "errore"}`).catch(() => {}); return; }
  // (dopo la Conferma la pagina mostra meno esami di quelli confermati: il gestionale ne ha persi — solo i numeri)
  if (v.tipo === "parziale") { regIncidente(`Gestionale: ${Number(d.visti) || 0} esami su ${Number(d.confermati) || 0} dopo la Conferma`).catch(() => {}); return; }
  if (v.tipo !== "ordine") return;
  const m = String((v.dati && v.dati.motivo) || "");
  if (/riuscita/i.test(m) && !/ORA-/.test(m)) return;   // «Riprova i mancanti: riuscita»
  regIncidente(m.replace(/,?\s*riuscita$/i, "") || "errore dell'ordine").catch(() => {});
}
let regFilaInc = Promise.resolve();
const regInFilaInc = (fn) => (regFilaInc = regFilaInc.then(fn, fn));
async function regIncidente(motivo) {
  await regPronto;
  if (!regAuto || regAttiva()) return false;   // spenta, o registra il medico: vince la sua
  return regInFilaInc(async () => {
    // (niente numeri di richiesta o di episodio: nello zip sono rimappati, qui si tolgono)
    const m = corto(String(motivo || "ordine finito male").replace(/\d{6,}/g, "…").replace(/\s+/g, " ").trim(), 160);
    const inc = (await chrome.storage.session.get(REG_INC))[REG_INC];
    if (inc) {   // lo stesso incidente: un motivo in più, lo stesso zip
      if (!inc.motivi.includes(m) && inc.motivi.length < 5) { inc.motivi.push(m); await chrome.storage.session.set({ [REG_INC]: inc }); }
      return true;
    }
    const ts = Date.now();
    await chrome.storage.session.set({ [REG_INC]: { ts, motivi: [m] } });
    // il minuto si aspetta qui; se intanto il service worker si ferma, lo sveglia l'allarme
    setTimeout(() => { regIncidenteSalva().catch(() => {}); }, REG_DOPO);
    chrome.alarms?.create(REG_AL_INC, { when: ts + REG_DOPO + 1000 });
    return true;
  });
}
async function regIncidenteSalva() {
  const inc = await regInFilaInc(async () => {
    const o = (await chrome.storage.session.get(REG_INC))[REG_INC];
    if (!o || Date.now() - o.ts < REG_DOPO - 1000) return null;
    await chrome.storage.session.remove(REG_INC);
    return o;
  });
  if (!inc) return null;
  chrome.alarms?.clear(REG_AL_INC).catch(() => {});
  await regPronto;
  if (!regAuto || regAttiva()) return null;
  await regScarica().catch(() => {});
  // dai 3 minuti prima dell'incidente a adesso (il minuto dopo, per vedere com'è finita)
  const fine = Date.now(), da = inc.ts - REG_FINESTRA, motivi = inc.motivi.join(" · ");
  return regInFila(() => regSalvaOra({ fonte: REG_SC, da, motivo: "auto", errore: motivi, quando: inc.ts,
    st: { versione: chrome.runtime.getManifest().version, inizio: da, fine, comeFinita: `automatica: dai ${REG_FINESTRA / 60e3} minuti prima di «${motivi}» a ${Math.max(1, Math.round((fine - inc.ts) / 60e3))} dopo`, origini: regOrigini() } })
    .catch((e) => { segnaErrore("registra", { motivo: corto(e && e.message || e, 140), auto: true }); return null; }));
}

// -------------------------------------------------------------- comandi
const REG_PEZZO_PC = 3 * 1024 * 1024;   // byte per pezzo verso il pannello (≈ 4 MB in base64)
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string" || !/^reg(istra)?[A-Z]/.test(msg.t)) return;
  const daPagina = !!sender && !!sender.tab && regNostra(sender.url || "");
  const daEstensione = !!sender && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
  if (!daPagina && !daEstensione) return reply({ ok: false, why: "non dal gestionale" }), true;
  const fai = (fn) => { regPronto.then(fn).then((x) => reply(x || { ok: true }), (e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 120) })); return true; };

  // dal pannello (⋯ → Registrazioni) e dalla pill «● Registrando…»
  if (msg.t === "registraVia") return fai(async () => ({ ok: true, stato: await regAvvia() }));
  if (msg.t === "registraFerma") return fai(async () => ({ ...(await regFermaESalva("fermata a mano")), stato: regStato }));
  if (msg.t === "registraSalva") return fai(async () => ({ ...(await regSalvaManuale()), stato: regStato }));
  if (msg.t === "registraLista") return fai(async () => ({ ok: true, stato: regStato, auto: regAuto, finestra: REG_FINESTRA, lista: await regElenco() }));
  if (msg.t === "registraAuto") return fai(async () => {
    regAuto = msg.acceso !== false;
    await chrome.storage.local.set({ [REG_AUTO]: regAuto });
    if (!regAuto) await regScorreVia();
    return { ok: true, auto: regAuto };
  });
  // il grezzo di una registrazione ferma che non si è salvata: via, senza zip
  if (msg.t === "registraButta") return fai(async () => { if (regAttiva()) return { ok: false, why: "la registrazione è in corso" }; await regCancella(); return { ok: true }; });
  if (msg.t === "registraCancellaTutte") return fai(async () => ({ ok: true, n: await regZipTutti() }));
  if (msg.t === "registraCancella") return fai(async () => ({ ok: !!(await regZipVia(String(msg.id || ""))) }));
  if (msg.t === "registraPezzo") return fai(async () => {
    const p = await regPezzo(String(msg.id || ""), msg.i, REG_PEZZO_PC);
    return p ? { ok: true, ...p } : { ok: false, why: "lo zip non c'è più" };
  });

  // da registra-pagina.js, mentre si registra (a mano, o gli ultimi minuti)
  if (!daPagina) return reply({ ok: false }), true;
  if (msg.t === "regPagina") return fai(async () => {
    if (!regCattura()) return { ok: false };
    const aMano = regAttiva();
    const html = String(msg.html || "");
    if (html.length > REG_PAGINA_MAX || (aMano && regPagineN >= REG_PAGINE_N)) return { ok: false, why: "troppo" };
    if (aMano) regPagineN++;
    const t = sender.tab;
    // un'app a viste (il SISS) cambia indirizzo senza ricaricare: vale quello
    // che dice la pagina, se è della stessa origine
    let url = String(sender.url || msg.url || "");
    try { if (msg.url && new URL(String(msg.url)).origin === new URL(url).origin) url = String(msg.url); } catch { /* resta quello del mittente */ }
    const fuori = Array.isArray(msg.fuori) ? msg.fuori.map(String).filter((x) => /^https?:\/\/[\w.-]+(?::\d+)?$/.test(x)).slice(0, 20) : [];
    // il visualizzatore: la sua forma tecnica (numeri, tipi, percorsi senza query), se non è troppa
    const tecnica = regViewer(url) && msg.tecnica && typeof msg.tecnica === "object" && JSON.stringify(msg.tecnica).length <= 400e3 ? msg.tecnica : null;
    await regMetti({ tipo: "pagina",
      url, titolo: String(msg.titolo || "").slice(0, 300), html, ts: Number(msg.ts) || Date.now(),
      scheda: t.id, frame: sender.frameId || 0, alto: !sender.frameId, motivo: REG_MOTIVI.has(msg.motivo) ? msg.motivo : "caricata",
      finestra: t.windowId, apertaDa: t.openerTabId ?? null,
      ...(msg.forma ? { forma: true } : {}), ...(Number(msg.credenziali) > 0 ? { credenziali: Math.min(99, Number(msg.credenziali)) } : {}),
      ...(fuori.length ? { fuori } : {}), ...(tecnica ? { tecnica } : {}),
    });
    return { ok: true };
  });
  // un clic sul visualizzatore: dove, e quando (le richieste che seguono le dice il flusso)
  if (msg.t === "regClic") {
    const b = msg.bersaglio && typeof msg.bersaglio === "object" && JSON.stringify(msg.bersaglio).length <= 6000 ? msg.bersaglio : null;
    if (regCattura() && regViewer(sender.url || "")) {
      regAccoda("clic", { tipo: msg.tipo === "dblclick" ? "dblclick" : "click", ts: Number(msg.ts) || Date.now(), scheda: sender.tab.id, frame: sender.frameId || 0,
        url: String(sender.url || "").slice(0, 4000), bersaglio: b });
    }
    return reply({ ok: true }), true;
  }
  if (msg.t === "regRichiesta") {
    if (regCattura()) regAccoda("note", { metodo: String(msg.metodo || "GET").toUpperCase().slice(0, 10), url: String(msg.url || "").slice(0, 4000), ts: Number(msg.ts) || Date.now(), scheda: sender.tab.id });
    return reply({ ok: true }), true;
  }
  if (msg.t === "regPdf") return fai(async () => {
    const u = String(msg.url || "");
    if (!regNostra(u) || typeof msg.b64 !== "string") return { ok: false };
    const bin = atob(msg.b64);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return { ok: await regTieniPdf(u, b.buffer, "estensione", sender.tab.id) };
  });
  return reply({ ok: false }), true;
});
