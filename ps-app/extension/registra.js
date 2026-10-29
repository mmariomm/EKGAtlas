/*
 * PS Assist — il registratore (⋯ → Registra), la parte nel service worker.
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
 * preme «Ferma e scarica»: allora registra.html anonimizza (registra-anonimo.js),
 * controlla, e scarica lo zip. Non parte niente verso nessuno. Dopo 60 minuti
 * la registrazione si ferma da sola; una registrazione mai scaricata si
 * cancella da sola dopo 12 ore.
 * Vede le costanti di bg.js (SA4, ALLOWED_ORIGINS): è caricato da lì.
 */
const REG = "registra";                 // lo stato, in storage.local: lo legge anche il pannello (● REC)
const REG_DURATA = 60 * 60e3;
const REG_TTL = 12 * 3600e3;
const REG_PAGINA_MAX = 8e6;             // un DOM più grande di così non è una pagina del gestionale
const REG_PDF_MAX = 15 * 1024 * 1024;
const REG_PDF_N = 200;
const REG_PAGINE_N = 1500;

let regStato = null;
let regCaricato = false;
let regPortale = "";
const regAttiva = (s = regStato) => !!s && s.stato === "rec" && Date.now() < s.scade;
const regNostra = (url) => {
  try { const o = new URL(url).origin; return o === SA4 || ALLOWED_ORIGINS.has(o) || (!!regPortale && o === regPortale); }
  catch { return false; }
};

let regScadenza = null;
async function regLeggi() {
  const o = await chrome.storage.local.get([REG, "portale"]);
  regStato = o[REG] || null;
  regPortale = o.portale || "";
  regCaricato = true;
  clearTimeout(regScadenza);
  if (regStato && regStato.stato === "rec") {
    if (Date.now() >= regStato.scade) await regFerma("dopo 60 minuti");
    else regScadenza = setTimeout(() => regFerma("dopo 60 minuti").catch(() => {}), regStato.scade - Date.now() + 500);
  }
  // una registrazione mai scaricata non resta sul PC
  if (regStato && regStato.stato !== "rec" && Date.now() - (regStato.fine || regStato.inizio || 0) > REG_TTL) await regCancella();
  return regStato;
}
let regPronto = regLeggi().catch(() => null);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch[REG]) regStato = ch[REG].newValue || null;
  if (ch.portale) regPortale = ch.portale.newValue || "";
});

// Il grezzo (pagine, flusso, PDF) sta in IndexedDB, non in storage.local: là
// lo leggerebbe per intero ogni get(null) del resto dell'estensione, e un'ora
// di pagine pesa decine di MB. Stessa origine dell'estensione: lo legge anche
// registra.html. Ogni voce: { tipo: "pagina" | "flusso" | "pdf", ... }.
const REG_DB = "psassist-registra", REG_ST = "grezzi";
let regDbP = null;
const regDb = () => (regDbP = regDbP || new Promise((ok, no) => {
  const r = indexedDB.open(REG_DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(REG_ST, { autoIncrement: true });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => { regDbP = null; no(r.error); };
}));
const regTx = async (modo, fn) => {
  const db = await regDb();
  return new Promise((ok, no) => {
    const tx = db.transaction(REG_ST, modo);
    const out = fn(tx.objectStore(REG_ST));
    tx.oncomplete = () => ok(out && "result" in out ? out.result : undefined);
    tx.onerror = tx.onabort = () => no(tx.error);
  });
};
const regMetti = (voce) => regTx("readwrite", (s) => { s.add(voce); });
// (anche per i test: quanto c'è, e tutto)
const regConta = () => regTx("readonly", (s) => s.getAll()).then((l) => ({
  pagine: l.filter((x) => x.tipo === "pagina").length, flusso: l.filter((x) => x.tipo === "flusso").reduce((n, x) => n + x.flusso.length, 0),
  pdf: l.filter((x) => x.tipo === "pdf").map((x) => x.url),
}));
const regTutto = () => regTx("readonly", (s) => s.getAll());

async function regCancella() {
  await regTx("readwrite", (s) => { s.clear(); }).catch(() => {});
  await chrome.storage.local.remove(REG);
  regStato = null;
}

// ------------------------------------------------------------ il flusso
const regInVolo = new Map();           // requestId → la richiesta, finché non finisce
const regRilettura = new Set();        // indirizzi che il registratore sta rileggendo
const regPdfVisti = new Set();         // indirizzi di cui ha già i byte
let regPdfN = 0, regPagineN = 0;
let regBuf = { flusso: [], note: [], schede: [] };
let regBufT = null;
function regAccoda(tipo, x) {
  regBuf[tipo].push(x);
  if (!regBufT) regBufT = setTimeout(() => { regScarica().catch(() => {}); }, 1500);
}
async function regScarica() {
  clearTimeout(regBufT); regBufT = null;
  const b = regBuf;
  if (!b.flusso.length && !b.note.length && !b.schede.length) return;
  regBuf = { flusso: [], note: [], schede: [] };
  await regMetti({ tipo: "flusso", ...b });
}
const REG_FILTRO = { urls: ["http://*/*", "https://*/*"] };
const regQuando = (fn) => (d) => {
  // il service worker può essersi appena svegliato: lo stato arriva un attimo dopo
  if (regStato && !regAttiva()) { if (regStato.stato === "rec") regFerma("dopo 60 minuti").catch(() => {}); return; }
  if (regStato) return fn(d);
  if (regCaricato) return;
  regPronto.then(() => { if (regAttiva()) fn(d); });
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
  if (fd) { r.corpo = {}; for (const [k, v] of Object.entries(fd).slice(0, 200)) r.corpo[k] = (Array.isArray(v) ? v : [v]).slice(0, 20).map((x) => String(x).slice(0, 2000)); }
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
}), REG_FILTRO, ["responseHeaders"]);
chrome.webRequest.onCompleted.addListener(regQuando((d) => {
  const r = regInVolo.get(d.requestId);
  if (!r) return;
  regInVolo.delete(d.requestId);
  r.fine = d.timeStamp; r.stato = d.statusCode; if (d.fromCache) r.daCache = true;
  if (r.url !== d.url) r.finale = d.url;
  regAccoda("flusso", r);
  // un PDF aperto: se nessuno ne ha già i byte, una rilettura dalla cache
  if (r.pdf && !r.registratore && d.statusCode >= 200 && d.statusCode < 300) {
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
  if (!regAttiva()) return;
  const s = { id: tab.id, apertaDa: tab.openerTabId ?? null, finestra: tab.windowId, ts: Date.now() };
  chrome.windows.get(tab.windowId).then((w) => { if (w && w.type === "popup") s.popup = true; }).catch(() => {})
    .finally(() => regAccoda("schede", s));
});

// ------------------------------------------------------------- i PDF
const regEPdf = (buf) => buf && buf.byteLength > 4 && String.fromCharCode(...new Uint8Array(buf, 0, 5)) === "%PDF-";
async function regTieniPdf(url, buf, origine, scheda) {
  if (!regAttiva() || !regEPdf(buf) || buf.byteLength > REG_PDF_MAX || regPdfN >= REG_PDF_N) return false;
  if (regPdfVisti.has(url)) return true;
  regPdfVisti.add(url); regPdfN++;
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
  if (regAttiva()) {
    p.then((res) => {
      const u = res.url || (typeof input === "string" ? input : input && input.url) || "";
      if (!regNostra(u) || regRilettura.has(u)) return;
      if (!/pdf|octet-stream/i.test(res.headers.get("content-type") || "")) return;
      res.clone().arrayBuffer().then((b) => regTieniPdf(u, b, "estensione", null)).catch(() => {});
    }).catch(() => {});
  }
  return p;
};

// -------------------------------------------------------------- comandi
async function regAvvia() {
  await regCancella();
  regInVolo.clear(); regRilettura.clear(); regPdfVisti.clear(); regPdfN = 0; regPagineN = 0;
  regBuf = { flusso: [], note: [], schede: [] };
  const o = await chrome.storage.local.get("portale");
  const ora = Date.now();
  regStato = {
    stato: "rec", inizio: ora, scade: ora + REG_DURATA, versione: chrome.runtime.getManifest().version,
    origini: { gestionale: SA4, portale: o.portale || "", altri: [...ALLOWED_ORIGINS].filter((x) => x !== SA4) },
  };
  await chrome.storage.local.set({ [REG]: regStato });
  clearTimeout(regScadenza);
  regScadenza = setTimeout(() => regFerma("dopo 60 minuti").catch(() => {}), REG_DURATA + 500);
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
const regApriPagina = () => chrome.tabs.create({ url: chrome.runtime.getURL("registra.html") });

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string" || !/^reg(istra)?[A-Z]/.test(msg.t)) return;
  const daPagina = !!sender && !!sender.tab && regNostra(sender.url || "");
  const daEstensione = !!sender && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
  if (!daPagina && !daEstensione) return reply({ ok: false, why: "non dal gestionale" }), true;
  const fai = (fn) => { regPronto.then(fn).then((x) => reply(x || { ok: true }), (e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 120) })); return true; };

  // dal menu ⋯ del pannello
  if (msg.t === "registraVia") return fai(async () => ({ ok: true, stato: await regAvvia() }));
  if (msg.t === "registraFerma") return fai(async () => { const s = await regFerma(); await regApriPagina(); return { ok: true, stato: s }; });
  if (msg.t === "registraScarica") return fai(async () => { await regApriPagina(); return { ok: true }; });

  // da registra-pagina.js, solo mentre si registra
  if (!daPagina) return reply({ ok: false }), true;
  if (msg.t === "regPagina") return fai(async () => {
    if (!regAttiva()) return { ok: false };
    const html = String(msg.html || "");
    if (html.length > REG_PAGINA_MAX || regPagineN >= REG_PAGINE_N) return { ok: false, why: "troppo" };
    regPagineN++;
    const t = sender.tab;
    await regMetti({ tipo: "pagina",
      url: String(sender.url || msg.url || ""), titolo: String(msg.titolo || "").slice(0, 300), html, ts: Number(msg.ts) || Date.now(),
      scheda: t.id, frame: sender.frameId || 0, alto: !sender.frameId, motivo: msg.motivo === "uscita" ? "uscita" : "caricata",
      finestra: t.windowId, apertaDa: t.openerTabId ?? null,
    });
    return { ok: true };
  });
  if (msg.t === "regRichiesta") {
    if (regAttiva()) regAccoda("note", { metodo: String(msg.metodo || "GET").toUpperCase().slice(0, 10), url: String(msg.url || "").slice(0, 4000), ts: Number(msg.ts) || Date.now(), scheda: sender.tab.id });
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
