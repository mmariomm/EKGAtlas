/*
 * PS Assist — service worker.
 *
 * Two jobs:
 *  1. reload the extension on request (the panel's "⟳ ricarica estensione");
 *  2. fetch and cache referto PDFs.
 * (plus the background tabs of orders and values, and — in ponte-sw.js — the
 * end-to-end-encrypted bridge to the doctor's iPhone)
 *
 * Why the PDFs are fetched HERE and not in the panel: a referto opens a viewer
 * that lives on ANOTHER internal host and shows the file as a blob: of that
 * origin, so a page script on SA4PSO can neither read it nor fetch it (CORS).
 * The service worker can — for the origins declared in host_permissions — so
 * it follows the chain (redirect → viewer page → its pdf endpoint) and stores
 * the bytes. Everything stays on this machine, in the extension's own storage.
 */

// La bandiera della build (self.PSA_SOLA_LETTURA): per prima, così la vedono
// bg.js e tutto quello che importa dopo (ponte-sw.js, aggiorna.js). La build
// mini (sola lettura) la mette a `true`; la normale a `false`.
try { importScripts("sola-lettura.js"); } catch (e) { self.PSA_SOLA_LETTURA = false; }

const PDF_SMELL = /uploaddownloadservlet|mimetype=application\/pdf|get_pdf|jasperservlet|refertostream|report|\.pdf(?:[?&"']|$)/i;

// The chain may only walk hosts this extension is FOR (host_permissions):
// viewer HTML can quote any address, and a harvested vendor link must never
// be fetched with hospital credentials.
const ALLOWED_ORIGINS = new Set([
  "https://smarthealth.multimedica.it",
  "http://10.11.0.151:9080",
]);

function candidates(text, baseUrl, fuori = new Set()) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const u = String(raw || "").trim().replace(/&amp;/gi, "&");
    if (!u || u.length < 8 || seen.has(u)) return;
    if (/^(javascript:|#|data:|blob:|mailto:)/i.test(u)) return;
    if (!/^(https?:)?\/|^[\w.-]+\.(?:do|rra2|pdf|jsp|html?)\b/i.test(u)) return;
    if (/[([+=&%]$|%27$/.test(u)) return;
    if (!PDF_SMELL.test(u)) return;
    if (/logout|logoff|signout|esci\b/i.test(u)) return;   // un GET qui chiuderebbe la sessione
    seen.add(u);
    try {
      const abs = new URL(u, baseUrl);
      if (!ALLOWED_ORIGINS.has(abs.origin)) { if (/^https?:$/.test(abs.protocol)) fuori.add(abs.origin); return; }
      out.push(abs.href);
    } catch { /* skip */ }
  };
  // frames, embeds, iframes, forms, links, meta refresh, window.open, plain strings
  for (const re of [
    /<(?:i?frame|embed)[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<object[^>]+data\s*=\s*["']([^"']+)["']/gi,
    /<form[^>]+action\s*=\s*["']([^"']+)["']/gi,
    /<a[^>]+href\s*=\s*["']([^"']+)["']/gi,
    /content\s*=\s*["'][^"']*url\s*=\s*([^"'\s>]+)/gi,
    /window\.open\(\s*["']([^"']+)["']/gi,
    /location\s*(?:\.\s*(?:href|replace|assign))?\s*[=(]\s*["']([^"']+)["']/gi,
    /"([^"<>\n\r]{8,1200})"/g,
    /'([^'<>\n\r]{8,1200})'/g,
  ]) for (const m of text.matchAll(re)) push(m[1]);
  return out.slice(0, 6);
}

async function grabPdf(url, hop = 0, budget) {
  budget = budget || { n: 0 };
  if (!ALLOWED_ORIGINS.has(new URL(url).origin)) return { ok: false, why: `fuori dall'ospedale (${new URL(url).origin})` };
  // a hung hospital endpoint must fail a row, never hang the whole save
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { credentials: "include", redirect: "follow", cache: "no-store", signal: ctl.signal });
  } catch (e) {
    clearTimeout(tid);
    // «Failed to fetch» da solo non dice niente: quasi sempre è un rinvio
    // verso un server che l'estensione non ha il permesso di leggere
    return { ok: false, why: e && e.name === "AbortError" ? "timeout" : `${String(e && e.message || e).slice(0, 40)} (rete, o rinvio a un server non permesso)` };
  }
  clearTimeout(tid);
  if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
  // dove è finito davvero, se un rinvio l'ha portato altrove
  const finale = (() => { try { return new URL(res.url || url).origin; } catch { return ""; } })();
  if (finale && !ALLOWED_ORIGINS.has(finale)) return { ok: false, why: `fuori dall'ospedale (${finale})` };
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  const buf = await res.arrayBuffer();
  // come in core.js: il tipo dichiarato è un'etichetta, i primi byte sono il
  // documento — un PDF chiamato «text/html» resta un PDF
  const magico = buf.byteLength > 4 && String.fromCharCode(...new Uint8Array(buf, 0, 5)) === "%PDF-";
  if (magico || ctype.includes("pdf") || ctype.includes("octet-stream")) {
    return { ok: true, buf, type: "application/pdf" };
  }
  if (hop >= 2 || !ctype.includes("html")) return { ok: false, why: `tipo ${ctype.split(";")[0] || "?"}` };
  const text = new TextDecoder("windows-1252").decode(buf);
  if (/name=["']?password/i.test(text)) return { ok: false, why: "sessione scaduta" };
  const fuori = new Set();
  const cands = candidates(text, res.url || url, fuori);
  for (const c of cands) {
    try {
      if (++budget.n > 6) break;   // un tetto solo per tutta la caccia, come in core.js
      const r = await grabPdf(c, hop + 1, budget);
      if (r.ok) return r;
    } catch { /* next candidate */ }
  }
  return { ok: false, why: `visualizzatore (${cands.length} link tentati${fuori.size ? `; rimanda a ${[...fuori].slice(0, 3).join(", ")}` : ""})` };
}

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// ---------------------------------------------------------------------------
// IL REGISTRO DEGLI ERRORI. Uno solo, per il pannello (content.js lo manda qui:
// «errore») e per il service worker, in storage.local «errori.v1»: al massimo
// 500 voci, le più vecchie se ne vanno. Ogni voce {ts, tipo, versione, pagina,
// dati}: pagina è solo l'MVPG; dati solo numeri, codici, impronte, messaggi
// del nostro codice — mai nomi, codici fiscali, date di nascita, testo libero
// (chi chiama passa solo quelli, e qui si ripulisce lo stesso). «Registra» lo
// mette nello zip (errori.json); «Dimentica i dati…» non lo tocca.
const ERRORI = "errori.v1", ERRORI_MAX = 500;
let codaErrori = Promise.resolve();
const pulito = (v, d = 0) => {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.replace(/\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi, "«CF»")
    .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, "«data»").slice(0, 300);
  if (d > 5) return null;
  if (Array.isArray(v)) return v.slice(0, 120).map((x) => pulito(x, d + 1));   // (la traccia di un ordine: fino a 120 passi)
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [String(k).slice(0, 40), pulito(x, d + 1)]));
  return null;
};
function segnaErrore(tipo, dati = {}, pagina = "") {
  const voce = { ts: Date.now(), tipo: String(tipo || "?").slice(0, 40), versione: chrome.runtime.getManifest().version,
    pagina: String(pagina || "").replace(/[^\w-]/g, "").slice(0, 60), dati: pulito(dati) };
  if (typeof regDopoErrore === "function") regDopoErrore(voce);   // un ordine fallito: la registrazione automatica (registra.js)
  codaErrori = codaErrori.then(async () => {
    const l = (await chrome.storage.local.get(ERRORI))[ERRORI] || [];
    await chrome.storage.local.set({ [ERRORI]: [...(Array.isArray(l) ? l : []), voce].slice(-ERRORI_MAX) });
  }).catch(() => {});
  return codaErrori;
}
// (un'eccezione non presa nel service worker: messaggio e prime righe della pila)
self.addEventListener("error", (ev) => segnaErrore("eccezione", { dove: "bg", messaggio: String(ev.message || ev.error || "").slice(0, 200), pila: String(ev.error?.stack || "").split("\n").slice(0, 4).join(" | ") }));
self.addEventListener("unhandledrejection", (ev) => segnaErrore("eccezione", { dove: "bg", messaggio: String(ev.reason?.message || ev.reason || "").slice(0, 200), pila: String(ev.reason?.stack || "").split("\n").slice(0, 4).join(" | ") }));

const KEY = (id) => "ref:" + id;
const REF_TTL = 8 * 3600e3;   // a shift: cached documents die with it
// I dati clinici letti restano un giorno e SOPRAVVIVONO alla chiusura del
// browser e al logout: un turno è di dodici ore e i pazienti sono più di
// dodici, quindi una memoria che muore col browser sarebbe inutile. Ventiquattro
// ore dopo l'ultima lettura la scheda scade e viene cancellata da sola.
let codaArch = Promise.resolve();   // le modifiche dell'archivio, una alla volta
const STORICO_TTL = 24 * 3600e3;
const STORICO_MAX = 200;         // di fatto nessun limite per un turno
// Un turno intero di referti (la memoria è senza limite: unlimitedStorage).
// Chi c'è lo dice un piccolo indice {id: ts}: potare non legge più ogni PDF
// tenuto, e lo si fa al più una volta al minuto.
const REF_MAX = 200;
const REF_INDICE = "refIndice";
let codaRef = Promise.resolve();
const inFilaRef = (fn) => (codaRef = codaRef.then(fn, fn));
async function refIndice() {
  const i = (await chrome.storage.local.get(REF_INDICE))[REF_INDICE];
  if (i && typeof i === "object") return i;
  // (la prima volta, o dopo un azzeramento: si ricostruisce, una volta)
  const all = await chrome.storage.local.get(null);
  return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("ref:")).map(([k, v]) => [k.slice(4), (v && v.ts) || 0]));
}
let potatoAlle = 0;
async function prune() {
  if (Date.now() - potatoAlle < 60e3) return;
  potatoAlle = Date.now();
  await inFilaRef(async () => {
    const i = await refIndice();
    const vivi = Object.entries(i).filter(([, ts]) => Date.now() - ts <= REF_TTL).sort((a, b) => b[1] - a[1]);
    const via = [...Object.entries(i).filter(([, ts]) => Date.now() - ts > REF_TTL), ...vivi.slice(REF_MAX)].map(([id]) => id);
    for (const id of via) delete i[id];
    if (via.length) await chrome.storage.local.remove(via.map(KEY));
    await chrome.storage.local.set({ [REF_INDICE]: i });
  });
}
// un referto preso: la copia, la sua riga nell'indice, e (ogni tanto) la potatura
async function tieniRef(id, rec) {
  await chrome.storage.local.set({ [KEY(id)]: rec });
  await inFilaRef(async () => {
    const i = await refIndice();
    i[id] = rec.ts;
    await chrome.storage.local.set({ [REF_INDICE]: i });
  });
  await prune();
}
chrome.runtime.onStartup?.addListener(() => chrome.storage.local.get(null).then((all) =>
  chrome.storage.local.remove([...Object.keys(all).filter((k) => k.startsWith("ref:")), REF_INDICE])));

// ---------------------------------------------------------------------------
// «⭳ Carica i valori» apre anche lo storico del portale, in una scheda di
// sottofondo: la stessa pagina che il medico apre col link «Storico Dati
// Clinici», dallo stesso link della pagina — mai un indirizzo costruito, mai
// una richiesta diretta al portale. Lì il content script legge la tabella come
// fa sempre; qui si segue la scheda e la si chiude appena ha consegnato.
// Lo stato sta in storage.session: se il service worker si ferma a metà, non
// si perde niente.
let SOTTO_MAX = 30000;                 // oltre, la tabella non arriverà
const SOTTO_QUIETE = 2500;             // dopo l'ultima consegna, si chiude
const LETTURA_MAX = 60e3;              // una tabella che arriva a pezzi: al più un minuto
const TARDI_MS = 10e3;                 // un PDF che arriva appena dopo il «tempo» si tiene lo stesso
const quiete = new Map();
const sottoK = (id) => "sotto:" + id;
const inCorso = (s) => !!s && (s.esito === "attesa" || s.esito === "lettura");
// Le schede del gestionale a cui il tabellone può chiedere: non quelle di un
// ordine, della lista smart o dei valori letti in sottofondo; prima quella
// davanti al medico, poi l'ultima usata.
async function tabelloneSchede() {
  const no = new Set((await ordLeggi().catch(() => [])).map((x) => x && x.worker).filter((x) => x != null));
  const sess = await chrome.storage.session.get(null).catch(() => ({}));
  for (const [k, s] of Object.entries(sess)) if (k.startsWith("sotto:") && inCorso(s)) no.add(Number(k.slice(6)));
  for (const id of Object.keys(sess["ponte.valori"] || {})) no.add(Number(id));
  const tutte = (await chrome.tabs.query({ url: "https://smarthealth.multimedica.it/sa4pso/*" }).catch(() => []))
    .filter((t) => !no.has(t.id) && !t.discarded && !/MVPG=PsoPazientiSmart/.test(t.url || ""));
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const peso = (t) => (t.active ? 2 : 0) + (win && t.windowId === win.id ? 1 : 0);
  return tutte.sort((a, b) => peso(b) - peso(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
}
async function sottoGet(id) { if (id == null) return null; return (await chrome.storage.session.get(sottoK(id)))[sottoK(id)] || null; }
const sottoSet = (id, v) => chrome.storage.session.set({ [sottoK(id)]: v });
async function sottoFine(id, esito) {
  const s = await sottoGet(id);
  if (!inCorso(s)) return;
  const t = await chrome.tabs.get(id).catch(() => null);
  if (esito === "tempo" && t && !t.url) esito = "altrove";   // l'url si vede solo sui nostri indirizzi
  // (un referto scaduto: la scheda resta ancora un momento, il PDF può essere sul punto di arrivare)
  const tardi = esito === "tempo" && s.cosa === "referto" && !!t;
  await sottoSet(id, { ...s, esito, fine: Date.now(), ...(tardi ? { tardi: true } : {}) });
  clearTimeout(quiete.get(id)); quiete.delete(id);
  if (tardi) { setTimeout(() => sottoControlla().catch(() => {}), TARDI_MS + 500); return; }
  // se il medico ci è andato sopra, la scheda è sua: non si chiude
  if (t && !t.active) await chrome.tabs.remove(id).catch(() => {});
}
// Il portale, avuto il PDF, a volte lo apre da sé in una scheda (o finestra)
// nuova, che Chrome porta davanti al medico. Nelle nostre schede dietro non
// succede più: portale-pdf.js sa da subito che è una di loro (qui sotto) e
// quel window.open non parte. Resta questo, stretto, per quello che
// sfuggisse: una scheda nuova SUL PORTALE, nata da una nostra scheda dietro —
// o dalla scheda del medico che ha un nostro referto in lettura proprio
// adesso. Si rimette davanti la scheda di prima, la finestra solo se la nuova
// le ha preso il fuoco, e la nuova si chiude da sola. Una scheda che il
// medico apre a mano (scritta, un segnalibro: senza madre) non si tocca.
const ATTIVE = new Map();               // finestra → [la scheda attiva prima, quella di adesso]
const NATE_DIETRO = new Set();
try { Promise.resolve(chrome.tabs.query({ active: true })).then((l) => { for (const t of l || []) if (!ATTIVE.has(t.windowId)) ATTIVE.set(t.windowId, [null, t.id]); }).catch(() => {}); } catch { /* niente */ }
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (NATE_DIETRO.has(tabId)) return;   // (quella nata dietro non conta come «di prima»)
  const a = ATTIVE.get(windowId) || [];
  if (a[1] !== tabId) ATTIVE.set(windowId, [a[1], tabId]);
});
const nostraDietro = async (id) => {
  if (id == null) return false;
  const s = await sottoGet(id).catch(() => null);
  if (s && (inCorso(s) || Date.now() - (s.fine || 0) < 30e3)) return true;
  const v = (await chrome.storage.session.get("ponte.valori").catch(() => ({})))["ponte.valori"] || {};
  return String(id) in v;
};
const sulPortale = (u) => /^(blob:)?https?:\/\/10\.11\.0\.151(:\d+)?\/clin-port\//i.test(u || "");
const delPortale = (s) => !!s && ((s.cosa || "storico") === "storico" || s.cosa === "referto");
// una nostra scheda dietro sul portale (una lettura, un referto), viva o appena finita
const dietroSulPortale = async (id) => {
  const s = id == null ? null : await sottoGet(id).catch(() => null);
  return delPortale(s) && (inCorso(s) || Date.now() - (s.fine || 0) < 30e3) ? s : null;
};
// (Chrome a volte dà per madre la scheda del medico, da cui è nata quella dietro:
// vale solo se da quella scheda un nostro referto si sta leggendo adesso)
const refertoInLettura = async (medico) => medico != null && Object.entries(await chrome.storage.session.get(null).catch(() => ({})))
  .some(([k, s]) => k.startsWith("sotto:") && s && s.cosa === "referto" && s.opener === medico && inCorso(s));
async function nataDietro(t) {
  if (NATE_DIETRO.has(t.id) || NATE.get(t.id)?.gestionale || await nostraDietro(t.id)) return;
  if (t.openerTabId == null || !sulPortale(t.pendingUrl || t.url)) return;
  let madre = null, medico = null;   // la scheda dietro, e quella del medico che l'ha chiesta
  const s = await dietroSulPortale(t.openerTabId);
  if (s) {
    madre = await chrome.tabs.get(t.openerTabId).catch(() => null);
    medico = s.opener ?? null;
  } else {
    if (!(await refertoInLettura(t.openerTabId))) return;
    medico = t.openerTabId;
    madre = await chrome.tabs.get(medico).catch(() => null);
  }
  if (NATE_DIETRO.has(t.id)) return;
  NATE_DIETRO.add(t.id);
  const finestra = madre ? madre.windowId : t.windowId;
  // nella stessa finestra la nuova ha preso il posto della scheda di prima;
  // in un'altra, la finestra torna davanti solo se la nuova le ha preso il fuoco
  if (t.windowId === finestra) {
    const a = ATTIVE.get(finestra) || [];
    const prima = [a[1], a[0]].find((x) => x != null && x !== t.id && !NATE_DIETRO.has(x) && (x !== t.openerTabId || x === medico)) ?? medico;
    if (prima != null) await chrome.tabs.update(prima, { active: true }).catch(() => {});
  } else if ((await chrome.windows.get(t.windowId).catch(() => null))?.focused) {
    await chrome.windows.update(finestra, { focused: true }).catch(() => {});
  }
  setTimeout(() => { NATE_DIETRO.delete(t.id); chrome.tabs.remove(t.id).catch(() => {}); }, 20e3);
}
// Le schede appena nate: il loro indirizzo arriva a volte dopo. Una che passa
// dal gestionale (il clic del medico su un referto: il link del gestionale,
// poi il portale) è sua: mai toccata.
const NATE = new Map();
const delGestionale = (u) => /^https:\/\/smarthealth\.multimedica\.it\//.test(u || "");
chrome.tabs.onCreated.addListener((t) => {
  NATE.set(t.id, { gestionale: delGestionale(t.pendingUrl || t.url) });
  setTimeout(() => NATE.delete(t.id), 3000);
  nataDietro(t).catch(() => {});
});
chrome.tabs.onUpdated.addListener((id, info, t) => {
  const n = NATE.get(id);
  if (!n || !info.url) return;
  if (delGestionale(info.url)) n.gestionale = true;
  else nataDietro(t).catch(() => {});
});
// Una nostra scheda dietro arriva sul portale: lo si dice SUBITO alla pagina,
// nel suo mondo (portale-pdf.js lo guarda quando la pagina vuole aprire il PDF
// altrove, secondi dopo). Ogni pagina nuova della scheda lo riceve di nuovo;
// content.js lo ridice a pagina pronta.
chrome.tabs.onUpdated.addListener((id, info, t) => {
  if (!(info.url || info.status) || !sulPortale(t && t.url)) return;
  sottoGet(id).then((s) => {
    if (!delPortale(s) || !inCorso(s)) return;
    return chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, world: "MAIN", injectImmediately: true,
      func: () => { try { Object.defineProperty(window, "__psassistSotto", { value: true }); } catch { /* già detto */ } } });
  }).catch(() => {});
});
async function sottoControlla() {
  for (const [k, s] of Object.entries(await chrome.storage.session.get(null))) {
    if (!k.startsWith("sotto:")) continue;
    const id = Number(k.slice(6));
    if (s.esito === "attesa" && Date.now() - s.ts > SOTTO_MAX) await sottoFine(id, "tempo");
    else if (s.esito === "lettura" && (Date.now() - s.ultima > SOTTO_QUIETE || Date.now() - (s.letta || s.ultima) > LETTURA_MAX)) await sottoFine(id, s.suo ? "letto" : "altro");
    else if (s.tardi && Date.now() - (s.fine || 0) > TARDI_MS) {
      // il PDF non è arrivato neanche in ritardo: la scheda si chiude (se non è del medico)
      await sottoSet(id, { ...s, tardi: false });
      const t = await chrome.tabs.get(id).catch(() => null);
      if (t && !t.active) await chrome.tabs.remove(id).catch(() => {});
    } else if (s.fine && Date.now() - s.fine > 10 * 60e3) await chrome.storage.session.remove(k);
  }
}
// UNA CORSIA PER IL PORTALE, per tutto il browser. Ogni scheda del portale è
// un accesso nuovo (un token nuovo, la sua app da caricare): due insieme si
// rubano il tempo e a volte la sessione. Quindi una scheda dello storico o di
// un referto nasce solo quando nessun'altra sta ancora caricando («attesa»):
// chi arriva aspetta il suo turno, in ordine — non viene rifiutato. La
// corsia si libera appena i dati sono arrivati (la prima tabella, il PDF) o
// la scheda ha finito comunque (tempo, login, chiusa).
let corsia = Promise.resolve();
const inCorsia = (fn) => { const p = corsia.then(fn); corsia = p.catch(() => {}); return p; };
async function corsiaLibera() {
  for (;;) {
    await sottoControlla();
    const sess = await chrome.storage.session.get(null);
    if (!Object.entries(sess).some(([k, s]) => k.startsWith("sotto:") && delPortale(s) && s.esito === "attesa")) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}
const sottoVive = async () => Object.entries(await chrome.storage.session.get(null)).filter(([k, s]) => k.startsWith("sotto:") && inCorso(s));
// Un carrello aperto (per la lista smart, che cambia la richiesta «corrente»
// della sessione): una scheda del gestionale sulla creazione di una richiesta o
// su una sua pagina — il carrello, gli inserimenti.
const carrelloAperto = async () => (await chrome.tabs.query({ url: "https://smarthealth.multimedica.it/sa4pso/*" }).catch(() => []))
  .some((t) => { try { return /^(Rcs|PsoRichiesta)/.test(new URL(t.url || t.pendingUrl || "").searchParams.get("MVPG") || ""); } catch { return false; } });
// La lista smart che legge dietro, fra una sua scheda e l'altra: un motore che parte la aspetta, al
// più SOTTO_MAX dalla sua partenza (la sua vita vera: oltre, sottoControlla la chiude) (quanto manca, 0 se non c'è) — partito a metà del suo giro, la
// pagina dopo della smart cambierebbe la richiesta «corrente» sotto il primo inserimento (regola 19).
// Lei, prima di ogni salto, chiede «smartAvanti»: con un motore chiesto o in coda si ferma lì.
let smartCeduta = 0;   // quando un motore ha aspettato la smart l'ultima volta (in memoria: dura secondi)
const smartVivaFinoA = async () => {
  const ora = Date.now();
  return Math.max(0, ...(await sottoVive().catch(() => [])).filter(([, s]) => s.cosa === "smart").map(([, s]) => (s.ts || 0) + SOTTO_MAX - ora));
};
// La scheda ha finito di caricare ma è RIMASTA sul gestionale: il link non ha
// portato al portale (sessione scaduta, pagina d'errore). Inutile aspettare 30
// secondi. Ma il rinvio al portale passa spesso da una pagina del gestionale
// che salta da sé (meta refresh, script): quella finisce di caricare PRIMA del
// salto. Quindi si guarda di nuovo dopo qualche secondo, e si conclude solo se
// la scheda è ancora lì.
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  const sulGestionale = (u) => /^https:\/\/smarthealth\.multimedica\.it\//.test(u || "");
  if (info.status !== "complete" || !tab || !sulGestionale(tab.url)) return;
  setTimeout(() => {
    Promise.all([sottoGet(id), chrome.tabs.get(id).catch(() => null)]).then(([s, t]) => {
      if (s && s.esito === "attesa" && s.cosa !== "smart" && t && t.status === "complete" && sulGestionale(t.url)) return sottoFine(id, "nonportale");
    }).catch(() => {});
  }, 4000);
});
chrome.tabs.onRemoved.addListener((id) => {
  sottoGet(id).then(async (s) => {
    if (!inCorso(s)) return;
    await sottoSet(id, { ...s, fine: Date.now(), esito: s.esito === "lettura" ? (s.suo ? "letto" : "altro") : "chiusa" });
    if (s.cosa === "smart") ordSpingi();   // (la lista smart chiusa: un ordine che la aspettava parte adesso, non al timer)
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || typeof msg !== "object") return;
  // un errore dal pannello: nel registro degli errori
  if (msg.t === "errore") { segnaErrore(msg.tipo, msg.dati, msg.pagina).then(() => reply({ ok: true })); return true; }

  // pdf.js, il lettore PDF di Mozilla, sta dentro l'estensione (pdfjs/) e
  // si carica nella scheda solo quando si apre un referto: nel mondo isolato
  // del pannello, accanto a content.js, mai nella pagina del gestionale.
  if (msg.t === "pdfjs") {
    const tabId = _sender && _sender.tab && _sender.tab.id;
    if (tabId == null) return reply({ ok: false, why: "nessuna scheda" }), true;
    chrome.scripting.executeScript({
      target: { tabId, frameIds: [_sender.frameId || 0] },
      files: ["pdfjs/pdf.min.js", "pdfjs/pdf.worker.min.js"],
    }).then(() => reply({ ok: true }))
      .catch((e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 80) }));
    return true;
  }

  if (msg.t === "cacheRef") {
    const salva = async (data, size) => {
      await tieniRef(msg.id, { data, ts: Date.now(), size, ep: msg.ep || "", pk: msg.pk || "" });
      reply({ ok: true, size });
    };
    // Il pannello può aver già letto il PDF col suo lettore (che sa replicare
    // un visualizzatore): allora arriva già in base64, e qui si mette solo via.
    if (typeof msg.data === "string" && msg.data) {
      if (!/^JVBERi/.test(msg.data)) return reply({ ok: false, why: "non è un PDF" }), true;
      salva(msg.data, msg.size || 1).catch((e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 60) }));
      return true;
    }
    // (una pagina del gestionale, con la sessione del medico: mai mentre un motore inserisce)
    dopoIlMotore().then(() => grabPdf(msg.url))
      .then(async (r) => {
        if (!r.ok) return reply(r);
        await salva(b64(r.buf), r.buf.byteLength);
      })
      .catch((e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 60) }));
    return true; // async reply
  }

  if (msg.t === "getRef") {
    chrome.storage.local.get(KEY(msg.id)).then(async (o) => {
      const hit = o[KEY(msg.id)];
      // Un documento torna solo per l'episodio sotto cui è stato salvato: se
      // uno dei due episodi non si sa, non si può dimostrare che è lo stesso,
      // e allora non si consegna.
      if (!hit || String(msg.ep || "") !== String(hit.ep || "")) return reply({ ok: false });
      if (Date.now() - (hit.ts || 0) > REF_TTL) { await chrome.storage.local.remove(KEY(msg.id)); return reply({ ok: false }); }
      reply({ ok: true, data: hit.data });
    }).catch(() => reply({ ok: false }));   // senza questo il pannello resta appeso
    return true;
  }

  // un referto la cui copia si è rivelata di un altro paziente: via, solo quello
  if (msg.t === "delRef") {
    chrome.storage.local.get(KEY(msg.id)).then(async (o) => {
      const hit = o[KEY(msg.id)];
      if (hit && String(msg.ep || "") === String(hit.ep || "")) await chrome.storage.local.remove(KEY(msg.id));
      reply({ ok: true });
    }).catch(() => reply({ ok: false }));
    return true;
  }

  // Di chi è la copia salvata: la pagina l'ha guardato (identitaReferto) e non è di un altro paziente
  // («ok», o «nv»: senza un'intestazione da confrontare). Sta con la copia: una copia salvata di nuovo
  // nasce senza, e al telefono non va finché qualcuno non l'ha guardata (ponteCopia). (`size`: i byte
  // della copia che è stata letta — un'altra salvata intanto resta da guardare.)
  if (msg.t === "chiRef") {
    inFilaRef(async () => {
      const hit = (await chrome.storage.local.get(KEY(msg.id)))[KEY(msg.id)];
      const d = hit && typeof hit.data === "string" ? hit.data : "", byte = Math.floor(d.length * 3 / 4) - (d.endsWith("==") ? 2 : d.endsWith("=") ? 1 : 0);
      if (!d || String(msg.ep || "") !== String(hit.ep || "") || !["ok", "nv", "vuoto"].includes(msg.chi) || byte !== msg.size) return reply({ ok: false });
      // («vuoto»: il PDF non ha testo, di chi è non si sa — il telefono dice «aprilo sul PC»; ponteCopia lo rifiuta lo stesso. Non toglie un «ok»/«nv» già dato.)
      if (msg.chi === "vuoto" && hit.chi) return reply({ ok: true });
      if (hit.chi !== msg.chi) await chrome.storage.local.set({ [KEY(msg.id)]: { ...hit, chi: msg.chi } });
      reply({ ok: true });
    }).catch(() => reply({ ok: false }));
    return true;
  }

  if (msg.t === "listRef") {
    (async () => {
      await prune();
      // si leggono solo quelli chiesti (senza elenco: quelli dell'indice)
      const ids = Array.isArray(msg.ids) ? msg.ids.map(String).slice(0, 500) : Object.keys(await refIndice());
      const o = ids.length ? await chrome.storage.local.get(ids.map(KEY)) : {};
      const out = {}, chi = {};
      for (const id of ids) {
        const rec = o[KEY(id)];
        if (!rec || Date.now() - (rec.ts || 0) > REF_TTL) continue;
        if (String(msg.ep || "") !== String(rec.ep || "")) continue;   // e solo questo episodio
        out[id] = rec.size || 1;
        if (rec.chi) chi[id] = rec.chi;
      }
      reply({ ok: true, cached: out, chi });
    })().catch(() => reply({ ok: false }));
    return true;
  }

  // Le tabelle cliniche lette, UNA SCHEDA PER PAZIENTE. Stanno nella memoria
  // dell'estensione (su disco, non nella RAM della sessione): un turno dura
  // dodici ore e non si può perdere tutto chiudendo il browser. Scadono da
  // sole 24 ore dopo l'ultima lettura. Il pannello chiede prima l'indice e
  // decide LUI quale scheda è di questo paziente: la regola d'identità sta
  // in un posto solo, non anche qui dentro.
  const ARCH = "storicoArch";
  // Leggere-modificare-riscrivere un unico blob da più schede insieme fa
  // perdere schede: la seconda scrittura parte dalla copia che aveva letto
  // prima ed è come se la prima non fosse mai avvenuta. Quindi le modifiche
  // dell'archivio passano una alla volta, in fila.
  const inFila = (fn) => (codaArch = codaArch.then(fn, fn));
  const vivo = (r) => r && Date.now() - (r.letto || 0) <= STORICO_TTL;
  const potaArchivio = (a) => {
    const vive = Object.entries(a).filter(([, r]) => vivo(r))
      .sort((x, y) => (y[1].letto || 0) - (x[1].letto || 0)).slice(0, STORICO_MAX);
    return Object.fromEntries(vive);
  };

  // Il medico apre «Storico dati clinici» DALLA pagina di un paziente: quel
  // passaggio è l'identità, ed è più sicuro di qualunque confronto di nomi.
  // Si annota chi era, e la pagina del portale userà quello.
  if (msg.t === "apreStorico") {
    chrome.storage.session.set({ apertura: { ep: String(msg.ep || ""), nome: String(msg.nome || "").slice(0, 60), ts: Date.now() } })
      .then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  if (msg.t === "chiAprivo") {
    // Prima la scheda aperta da noi in sottofondo: sa per chi è, e lo spazio
    // condiviso «apertura» non si tocca — è quello del clic del medico, e una
    // scheda del portale aperta a mano deve continuare a trovarci il suo.
    sottoGet(_sender.tab && _sender.tab.id).then(async (s) => {
      // (per un referto, anche con chi confrontarlo e cosa si è chiesto: la
      // scheda del portale tiene il PDF di QUESTO paziente, non il primo che vede)
      if (s) return reply({ ok: true, ep: s.ep, nome: s.nome, ts: s.ts, sotto: true, cosa: s.cosa || "storico",
        ...(s.cosa === "referto" ? { cfImp: s.cfImp || "", nascita: s.nascita || "", titolo: s.titolo || "" } : {}) });
      const a = (await chrome.storage.session.get("apertura")).apertura;
      reply(a && Date.now() - (a.ts || 0) < 20 * 60e3 ? { ok: true, ...a } : { ok: false });
    }).catch(() => reply({ ok: false }));
    return true;
  }
  // «Questa scheda è una di quelle che apro io in sottofondo?» — un ordine o i
  // suoi fogli, una lettura (storico, referto, lista smart), il ponte. Una
  // pagina «altra» del gestionale mostra la pill solo se la risposta è no.
  // Solo una lettura: a differenza di «ordineChi» non annota niente.
  if (msg.t === "schedaNostra") {
    const id = _sender.tab && _sender.tab.id;
    (async () => {
      if (id == null) return reply({ ok: false });
      if (await sottoGet(id)) return reply({ ok: true, nostra: true });
      if ((await ordLeggi()).some((x) => x.worker === id)) return reply({ ok: true, nostra: true });
      const p = typeof ponteLavoroDi === "function" ? await ponteLavoroDi(id) : {};
      reply({ ok: true, nostra: !!(p && (p.ponteValori || p.ponteCartella || p.ponteTerapia || p.ponteAccetta || p.ponteLista)) });
    })().catch(() => reply({ ok: false }));
    return true;
  }

  // Un clic su una riga della lista smart (una finestra sua): la cartella, o la
  // pagina dell'area, si apre nella scheda del gestionale da cui la finestra è
  // nata — o nell'ultima usata — e la si porta davanti. Solo pagine da aprire
  // del menu o la cartella: mai un modulo.
  if (msg.t === "apriNelGestionale") {
    (async () => {
      const da = _sender.tab;
      let u;
      try { u = new URL(String(msg.url || "")); } catch { return reply({ ok: false, why: "link non valido" }); }
      const mvpg = u.searchParams.get("MVPG") || "";
      if (!da || u.origin !== "https://smarthealth.multimedica.it" || !/^\/sa4pso\/restrict\/menuPso(Episodio)?\.do$/.test(u.pathname)
          || /[?&](ccsForm|Insert|Delete|Update)=/i.test(u.search) || !["PsoEpisodioClinicoAmbulatorio", "PsoPazientiAmbulatorio", "PsoPsoImposta"].includes(mvpg)) {
        return reply({ ok: false, why: "link inatteso" });
      }
      const ordini = await ordLeggi().catch(() => []);
      const lavoro = new Set((ordini || []).map((x) => x && x.worker).filter((x) => x != null));
      const buona = (t) => !!t && t.id !== da.id && !lavoro.has(t.id) && /^https:\/\/smarthealth\.multimedica\.it\/sa4pso\//.test(t.url || "")
        && !/MVPG=PsoPazientiSmart/.test(t.url || "");
      let t = msg.tabId != null ? await chrome.tabs.get(msg.tabId).catch(() => null) : null;
      if (!buona(t)) t = da.openerTabId != null ? await chrome.tabs.get(da.openerTabId).catch(() => null) : null;
      if (!buona(t)) {
        const tutte = await chrome.tabs.query({ url: "https://smarthealth.multimedica.it/sa4pso/*" }).catch(() => []);
        t = tutte.filter(buona).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
      }
      if (!t) return reply({ ok: false, why: "nessuna scheda del gestionale" });
      // Prima davanti (soloFuoco), POI la pagina, con una seconda domanda. Le
      // pagine del gestionale si ricaricano da sole quando prendono il fuoco
      // (<body onfocus="refreshOnFocus()">): portata davanti insieme alla
      // navigazione, la scheda ricaricava la lista di prima sopra PsoPsoImposta,
      // e il passaggio d'area spariva. Fra le due, la smart guarda se la pagina
      // ricaricata ha già ripreso il passaggio da sé (vedi apriNelGestionale).
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
      if (msg.soloFuoco) {
        await chrome.tabs.update(t.id, { active: true });
        return reply({ ok: true, tabId: t.id });
      }
      await chrome.tabs.update(t.id, { url: u.href, active: true });
      reply({ ok: true, tabId: t.id });
    })().catch((e) => reply({ ok: false, why: String((e && e.message) || e).slice(0, 80) }));
    return true;
  }

  // Il tabellone in una scheda sua (⋯ → Tabellone, o il ↗ sulla lista): se
  // c'è già la si porta davanti, se no se ne apre una. Nessun «opener».
  if (msg.t === "tabelloneApriPagina") {
    (async () => {
      const url = chrome.runtime.getURL("tabellone.html");
      // (senza il permesso «tabs» l'indirizzo di una scheda non si vede: le pagine nostre aperte, sì)
      const [c] = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ["TAB"], documentUrls: [url] }).catch(() => []) : [];
      const t = c && c.tabId >= 0 ? await chrome.tabs.get(c.tabId).catch(() => null) : null;
      if (t) {
        await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
        await chrome.tabs.update(t.id, { active: true });
      } else {
        const da = _sender.tab;
        await chrome.tabs.create(da ? { url, windowId: da.windowId, index: da.index + 1 } : { url });
      }
      reply({ ok: true });
    })().catch((e) => reply({ ok: false, why: String((e && e.message) || e).slice(0, 80) }));
    return true;
  }
  // Le domande della pagina del tabellone, girate a una scheda del gestionale
  // (l'ultima usata; mai quella di un ordine o di una lettura in sottofondo):
  // «stato» (quante ce ne sono), «scrivi» (un letto, un archiviato: lo scrive
  // la scheda, nella memoria del gestionale), «sync» (il ⟳), «apri» (un
  // paziente: la scheda va davanti e carica il SUO indirizzo, quello che il
  // gestionale le ha dato) e «area» (il titolo di un'area). Mai un ordine.
  if (msg.t === "tabellone") {
    if (!_sender || _sender.id !== chrome.runtime.id || !String(_sender.url || "").startsWith(chrome.runtime.getURL("tabellone.html"))) {
      reply({ ok: false, why: "solo dal tabellone" });
      return;
    }
    (async () => {
      const schede = await tabelloneSchede();
      if (msg.cosa === "stato") return reply({ ok: true, schede: schede.length });
      if (!["scrivi", "sync", "apri", "area"].includes(msg.cosa)) return reply({ ok: false, why: "domanda sconosciuta" });
      const nessuna = { ok: false, why: "nessuna scheda del gestionale aperta — il tabellone qui si guarda soltanto" };
      const chiedi = (t, m) => Promise.race([chrome.tabs.sendMessage(t.id, { ...m, t: "tabelloneEsegui" }).catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 4000))]);
      const apre = msg.cosa === "apri" || msg.cosa === "area";
      const m = apre ? { cosa: msg.cosa, ep: String(msg.ep || ""), go: msg.go, k: String(msg.k || ""), prova: true }
        : msg.cosa === "scrivi" ? { cosa: "scrivi", kv: msg.kv } : { cosa: "sync" };
      let r = null, t = null;
      for (const x of schede) {
        r = await chiedi(x, m);
        if (r && !r.no) { t = x; break; }
      }
      if (!t) return reply(nessuna);
      if (!apre || !r.ok) return reply(r);
      // Prima davanti, POI la pagina: le pagine del gestionale si ricaricano da
      // sole prendendo il fuoco, e la ricarica cancellerebbe la navigazione.
      let url = "";
      if (r.url) {
        try {
          const u = new URL(String(r.url));
          const ep = u.searchParams.get("EPISODIO_ID");
          if (u.origin === "https://smarthealth.multimedica.it" && /^\/sa4pso\/restrict\/menuPso(Episodio)?\.do$/.test(u.pathname)
              && u.searchParams.get("MVPG") === "PsoEpisodioClinicoAmbulatorio" && (!ep || ep === m.ep)
              && !/[?&](ccsForm|Insert|Delete|Update)=/i.test(u.search)) url = u.href;
        } catch { /* niente */ }
        if (!url) return reply({ ok: false, why: "l'indirizzo di quel paziente non è una sua pagina del gestionale" });
      }
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
      await chrome.tabs.update(t.id, { active: true }).catch(() => {});
      await new Promise((ok) => setTimeout(ok, 300));
      if (url) {
        await chrome.tabs.update(t.id, { url });
        return reply({ ok: true });
      }
      // già sulla sua pagina, o noto solo dalla lista smart: lo fa la scheda
      // (che intanto può essersi ricaricata: si richiede finché risponde)
      let fatto = null;
      for (let i = 0; i < 6 && !(fatto && !fatto.no); i++) {
        fatto = await chiedi(t, { ...m, prova: false });
        if (!fatto) await new Promise((ok) => setTimeout(ok, 500));
      }
      reply(fatto && !fatto.no ? fatto : { ok: false, why: "la scheda del gestionale non ha risposto" });
    })().catch((e) => reply({ ok: false, why: String((e && e.message) || e).slice(0, 80) }));
    return true;
  }

  // «Segue il gestionale»: la lista smart, col link che la pagina stessa
  // porta (l'icona elenco_smart), in una scheda dietro — una sola alla volta.
  // Là il content script la legge (anche le altre sue schede, coi loro link)
  // e dice «fatto»; la scheda si chiude. Nessuna richiesta nostra.
  if (msg.t === "smartSotto") {
    (async () => {
      const da = _sender.tab;
      let u;
      try { u = new URL(String(msg.url || "")); } catch { return reply({ ok: false, why: "link non valido" }); }
      let origineMia = "";
      try { origineMia = new URL(_sender.url).origin; } catch { /* niente */ }
      if (!da || u.origin !== origineMia || u.origin !== "https://smarthealth.multimedica.it" || u.pathname !== "/sa4pso/restrict/menuPsoSmart.do"
          || u.searchParams.get("MVPG") !== "PsoPazientiSmart" || [...u.searchParams.keys()].some((k) => !["MVPG", "PAZIENTI_FILTRO"].includes(k))) {
        return reply({ ok: false, why: "link inatteso" });
      }
      // (la smart è una pagina della stessa sessione, e cambia la sua richiesta «corrente»: mai
      // mentre un motore inserisce, né con un carrello aperto in una scheda — il medico che ordina a mano)
      // Controllo e annotazione in un passo solo, nella fila degli ordini: due schede del gestionale che
      // si caricano insieme non aprono due smart, e un motore non parte fra il controllo e la scheda.
      const r = await inFilaOrd(async () => {
        await motorePronto;
        if (motoreAlLavoro(await ordLeggi())) return { ok: false, why: "ordine in corso" };
        if (await carrelloAperto()) return { ok: false, why: "carrello aperto" };
        await sottoControlla();
        const vive = Object.entries(await chrome.storage.session.get(null)).filter(([k, s]) => k.startsWith("sotto:") && inCorso(s));
        if (vive.some(([, s]) => s.cosa === "smart")) return { ok: false, why: "già in corso" };
        if (vive.length >= 3) return { ok: false, why: "troppe letture in corso" };
        const vuota = { url: "about:blank", active: false };
        const t = await chrome.tabs.create({ ...vuota, openerTabId: da.id, index: da.index + 1, windowId: da.windowId })
          .catch(() => chrome.tabs.create(vuota));
        await sottoSet(t.id, { opener: da.id, cosa: "smart", ts: Date.now(), esito: "attesa" });
        return { ok: true, t };
      });
      if (!r.ok) return reply(r);
      const t = r.t;
      await chrome.tabs.update(t.id, { url: u.href });
      setTimeout(() => sottoControlla().catch(() => {}), SOTTO_MAX + 500);
      reply({ ok: true, tabId: t.id });
    })().catch((e) => reply({ ok: false, why: String((e && e.message) || e).slice(0, 80) }));
    return true;
  }
  if (msg.t === "smartChi") {
    sottoGet(_sender.tab && _sender.tab.id).then((s) => reply(inCorso(s) && s.cosa === "smart" ? { ok: true } : { ok: false }))
      .catch(() => reply({ ok: false }));
    return true;
  }
  // Prima di ogni salto da una scheda della smart alla prossima, gli stessi controlli della partenza:
  // un ordine al lavoro, uno che aspetta solo lei (in coda, o il motore chiesto da una scheda), un
  // carrello aperto a mano intanto. Se no, si ferma lì con quello che ha letto (mai «intera»).
  if (msg.t === "smartAvanti") {
    (async () => {
      const s = await sottoGet(_sender.tab && _sender.tab.id);
      if (!inCorso(s) || s.cosa !== "smart") return reply({ ok: false, why: "pagina" });
      await motorePronto;
      const l = await ordLeggi();
      if (motoreAlLavoro(l) || (!occupato(l) && l.some((x) => x.stato === "coda")) || Date.now() - smartCeduta < 5e3) return reply({ ok: false, why: "ordine in corso" });
      if (await carrelloAperto()) return reply({ ok: false, why: "carrello aperto" });
      reply({ ok: true });
    })().catch(() => reply({ ok: false, why: "estensione" }));
    return true;
  }
  if (msg.t === "smartFine") {
    const tid = _sender.tab && _sender.tab.id;
    sottoGet(tid).then(async (s) => {
      if (!inCorso(s) || s.cosa !== "smart") return reply({ ok: false });
      await sottoFine(tid, msg.esito === "ok" ? "letto" : "altro");
      reply({ ok: true });
      ordSpingi();   // (un ordine che la aspettava: adesso)
    }).catch(() => reply({ ok: false }));
    return true;
  }

  if (msg.t === "apriStoricoSotto") {
    (async () => {
      const da = _sender.tab;
      let u;
      try { u = new URL(String(msg.url || "")); } catch { return reply({ ok: false, why: "link non valido" }); }
      // solo il link vero della pagina del paziente, e solo quello
      let origineMia = "";
      try { origineMia = new URL(_sender.url).origin; } catch { /* niente */ }
      if (!da || u.origin !== origineMia || u.origin !== "https://smarthealth.multimedica.it"
          || !/\/Sa4ViewerExtRedirect\.do$/i.test(u.pathname) || u.searchParams.get("MODALITA") !== "CLINICA") {
        return reply({ ok: false, why: "link inatteso" });
      }
      // lo storico di questo paziente già in lettura (un doppio clic, un'altra
      // scheda, il telefono): ci si aggancia a quello
      const ep = String(msg.ep || "");
      const gia = async () => (await sottoVive()).find(([, s]) => (s.cosa || "storico") === "storico" && (s.opener === da.id || (!!ep && s.ep === ep)));
      await sottoControlla();
      const g0 = await gia();
      if (g0) return reply({ ok: true, tabId: Number(g0[0].slice(6)), gia: true });
      await inCorsia(async () => {
        await corsiaLibera();
        const g = await gia();
        if (g) return reply({ ok: true, tabId: Number(g[0].slice(6)), gia: true });
        await dopoIlMotore();   // (mai una pagina del gestionale mentre un motore inserisce)
        // nasce vuota, si annota per chi è, POI parte: così l'annotazione arriva
        // sempre prima dello script del portale
        const vuota = { url: "about:blank", active: false };
        const t = await chrome.tabs.create({ ...vuota, openerTabId: da.id, index: da.index + 1, windowId: da.windowId })
          .catch(() => chrome.tabs.create(vuota));
        await sottoSet(t.id, { opener: da.id, cosa: "storico", ep, nome: String(msg.nome || "").slice(0, 60), ts: Date.now(), esito: "attesa" });
        await chrome.tabs.update(t.id, { url: u.href });
        setTimeout(() => sottoControlla().catch(() => {}), SOTTO_MAX + 500);
        reply({ ok: true, tabId: t.id });
      });
    })().catch((e) => reply({ ok: false, why: String((e && e.message) || e).slice(0, 80) }));
    return true;
  }
  // Un referto che il gestionale manda al portale (ECG, radiologia): lo
  // stesso link che il medico clicca, aperto in una scheda dietro. Là la
  // pagina lo scarica e lo mostra da sé; lo script del portale ne passa una
  // copia (refertoSotto) e la scheda si chiude.
  if (msg.t === "apriRefertoSotto") {
    (async () => {
      const da = _sender.tab;
      let u;
      try { u = new URL(String(msg.url || "")); } catch { return reply({ ok: false, why: "link non valido" }); }
      let origineMia = "";
      try { origineMia = new URL(_sender.url).origin; } catch { /* niente */ }
      if (!da || u.origin !== origineMia || u.origin !== "https://smarthealth.multimedica.it"
          || !/\/Sa4ViewerExtRedirect\.do$/i.test(u.pathname) || !u.searchParams.get("REFERTO_ID")) {
        return reply({ ok: false, why: "link inatteso" });
      }
      const id = String(msg.id || "").slice(0, 80);
      if (!id) return reply({ ok: false, why: "referto senza id" });
      // Lo stesso referto, chiunque l'abbia chiesto (un tocco, il caricamento
      // da solo, un'altra scheda, il telefono): ci si aggancia alla scheda che
      // lo sta già leggendo, o — se nel frattempo è arrivato — è già salvato.
      const ep = String(msg.ep || "");
      const gia = async () => (await sottoVive()).find(([, s]) => s.cosa === "referto" && s.id === id && s.ep === ep);
      const salvato = async () => {
        const h = (await chrome.storage.local.get(KEY(id)))[KEY(id)];
        return !!h && String(h.ep || "") === ep && Date.now() - (h.ts || 0) <= REF_TTL;
      };
      await sottoControlla();
      const g0 = await gia();
      if (g0) return reply({ ok: true, tabId: Number(g0[0].slice(6)), gia: true });
      await inCorsia(async () => {
        await corsiaLibera();
        const g = await gia();
        if (g) return reply({ ok: true, tabId: Number(g[0].slice(6)), gia: true });
        if (await salvato()) return reply({ ok: true, salvato: true });
        await dopoIlMotore();   // (mai una pagina del gestionale mentre un motore inserisce)
        const vuota = { url: "about:blank", active: false };
        const t = await chrome.tabs.create({ ...vuota, openerTabId: da.id, index: da.index + 1, windowId: da.windowId })
          .catch(() => chrome.tabs.create(vuota));
        await sottoSet(t.id, { opener: da.id, cosa: "referto", id, ep, pk: String(msg.pk || ""),
          nome: String(msg.nome || "").slice(0, 60), cfImp: String(msg.cfImp || "").slice(0, 16),
          nascita: String(msg.nascita || "").slice(0, 10), titolo: String(msg.titolo || "").slice(0, 80),
          ts: Date.now(), esito: "attesa" });
        await chrome.tabs.update(t.id, { url: u.href });
        setTimeout(() => sottoControlla().catch(() => {}), SOTTO_MAX + 500);
        reply({ ok: true, tabId: t.id });
      });
    })().catch((e) => reply({ ok: false, why: String((e && e.message) || e).slice(0, 80) }));
    return true;
  }
  // la scheda del portale ha il PDF: si tiene come ogni referto salvato
  // (stesso posto, stessa scadenza, stesso episodio) e la scheda si chiude
  if (msg.t === "refertoSotto") {
    const tid = _sender.tab && _sender.tab.id;
    sottoGet(tid).then(async (s) => {
      // (anche appena dopo il «tempo»: la scheda è rimasta apposta)
      const tardi = !!s && s.tardi && s.esito === "tempo" && Date.now() - (s.fine || 0) <= TARDI_MS;
      if (!(inCorso(s) || tardi) || s.cosa !== "referto") return reply({ ok: false, why: "scheda non nostra" });
      if (typeof msg.data !== "string" || !/^JVBERi/.test(msg.data)) return reply({ ok: false, why: "non è un PDF" });
      await tieniRef(s.id, { data: msg.data, ts: Date.now(), size: msg.size || 1, ep: s.ep, pk: s.pk });
      const via = String(msg.via || "").slice(0, 20);
      if (tardi) {
        await sottoSet(tid, { ...s, via, esito: "letto", tardi: false, fine: Date.now() });
        const t = await chrome.tabs.get(tid).catch(() => null);
        if (t && !t.active) await chrome.tabs.remove(tid).catch(() => {});
      } else {
        await sottoSet(tid, { ...s, via });
        await sottoFine(tid, "letto");
      }
      reply({ ok: true });
    }).catch((e) => reply({ ok: false, why: String((e && e.message) || e).slice(0, 60) }));
    return true;
  }
  // …o non ce l'ha: com'è fatta la pagina (mai il contenuto), per capire perché
  if (msg.t === "refertoSottoDiag") {
    const tid = _sender.tab && _sender.tab.id;
    sottoGet(tid).then(async (s) => {
      if (!inCorso(s) || s.cosa !== "referto") return reply({ ok: false });
      await sottoSet(tid, { ...s, diag: String(msg.diag || "").slice(0, 700) });
      // «altro»: il portale ha mostrato solo PDF di un altro paziente, e nessuno si tiene
      await sottoFine(tid, msg.esito === "altro" ? "altro" : "nonTrovato");
      reply({ ok: true });
    }).catch(() => reply({ ok: false }));
    return true;
  }
  if (msg.t === "esitoSotto") {
    sottoControlla().then(() => sottoGet(Number(msg.tabId)))
      .then((s) => reply(s ? { ok: true, esito: s.esito, tardi: !!s.tardi, esami: s.esami || 0, prelievi: s.prelievi || 0, diag: s.diag || "" } : { ok: false }))
      .catch(() => reply({ ok: false }));
    return true;
  }
  // il portale ha chiesto di entrare: vale solo per le schede aperte da noi
  if (msg.t === "sottoLogin") {
    const id = _sender.tab && _sender.tab.id;
    sottoGet(id).then((s) => s && s.esito === "attesa" && sottoFine(id, "login"))
      .catch(() => {}).then(() => reply({ ok: true }));
    return true;
  }

  if (msg.t === "putStorico") {
    const chiave = String(msg.chiave || "").slice(0, 80);
    if (!chiave || !msg.dati) return reply({ ok: false });
    inFila(async () => {
      const o = await chrome.storage.local.get(ARCH);
      const a = potaArchivio(o[ARCH] || {});
      // Chi scrive dice da quale revisione della scheda è partito: se nel
      // frattempo qualcun altro l'ha cambiata (il portale mentre si leggono i
      // Risultati, o due schede insieme), non la si copre — si risponde
      // «conflitto», e chi scrive rilegge, rifonde e riprova.
      if ("base" in msg && ((a[chiave] && a[chiave].rev) || 0) !== (msg.base || 0)) {
        return reply({ ok: false, conflitto: true });
      }
      const nuovo = !a[chiave];
      a[chiave] = { ...msg.dati, rev: ((a[chiave] && a[chiave].rev) || 0) + 1 };
      await chrome.storage.local.set({ [ARCH]: potaArchivio(a) });
      reply({ ok: true, nuovo, pazienti: Object.keys(a).length });
      // se l'ha mandata una scheda aperta da noi in sottofondo: ha letto.
      // Si chiude dopo un momento di calma (la tabella può arrivare a pezzi).
      const id = _sender.tab && _sender.tab.id;
      const st = id != null ? await sottoGet(id) : null;
      if (inCorso(st) && st.cosa !== "referto") {   // una scheda aperta per un referto aspetta il PDF, non la tabella
        await sottoSet(id, { ...st, esito: "lettura", ultima: Date.now(), letta: st.letta || Date.now(), suo: String(msg.dati.ep || "") === st.ep,
          esami: (msg.dati.righe || []).length, prelievi: (msg.dati.date || []).length });
        clearTimeout(quiete.get(id));
        quiete.set(id, setTimeout(() => sottoControlla().catch(() => {}), SOTTO_QUIETE + 100));
      }
    }).catch(() => reply({ ok: false }));
    return true;
  }
  // senza chiave: l'indice (chi c'è, non i valori). Con chiave: quel record.
  if (msg.t === "getStorico") {
    chrome.storage.local.get(ARCH)
      .then(async (o) => {
        const a = potaArchivio(o[ARCH] || {});
        if (Object.keys(a).length !== Object.keys(o[ARCH] || {}).length) {
          await chrome.storage.local.set({ [ARCH]: a });   // scaduti: via
        }
        if (msg.chiave) {
          const r = a[msg.chiave];
          return reply(r ? { ok: true, dati: r } : { ok: false });
        }
        reply({
          ok: true,
          indice: Object.entries(a).map(([chiave, r]) => ({
            chiave, cf: r.cf || "", ep: r.ep || "", paziente: r.paziente || {}, letto: r.letto || 0,
            esami: (r.righe || []).length, prelievi: (r.date || []).length,
          })),
        });
      })
      .catch(() => reply({ ok: false }));
    return true;
  }

  // ---- l'indirizzo del portale clinico, deciso dal medico ----------------
  // L'indirizzo stava scritto dentro il manifest: un numero IP e una porta. Se
  // l'ospedale li cambia — o se sono diversi da un presidio all'altro — il
  // programma semplicemente non parte su quella pagina, e non c'è modo di
  // accorgersene da dentro. Ora l'indirizzo lo aggiunge il medico: Chrome
  // chiede il permesso per QUEL sito e basta, e lo script si registra lì.
  if (msg.t === "portale") {
    chrome.storage.local.get("portale")
      .then((o) => reply({ ok: true, origine: o.portale || "" }))
      .catch(() => reply({ ok: false, origine: "" }));
    return true;
  }
  if (msg.t === "apriImpostazioni") {
    chrome.runtime.openOptionsPage().then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  if (msg.t === "togliPortale") {
    registraPortale(null)
      .then(() => chrome.storage.local.remove("portale"))
      .then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  if (msg.t === "aggiungiPortale") {
    (async () => {
      let origine;
      try { origine = new URL(String(msg.url || "").trim()).origin; }
      catch { return reply({ ok: false, why: "Non è un indirizzo: incolla quello che vedi nella barra del browser." }); }
      if (!/^https?:$/.test(new URL(origine).protocol)) return reply({ ok: false, why: "Serve un indirizzo http o https." });
      const pattern = origine + "/*";
      // Il permesso si chiede dalla PAGINA delle impostazioni, non da qui:
      // chrome.permissions.request vuole un gesto dell'utente, e un gesto non
      // sopravvive al salto di messaggio dal pannello al service worker.
      // Qui si registra soltanto, e SOLO se il permesso c'è davvero.
      const ha = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
      if (!ha) return reply({ ok: false, why: "Chrome non ha dato il permesso per questo sito." });
      try { await registraPortale(pattern); }
      catch (e) { return reply({ ok: false, why: "Chrome non ha registrato lo script: " + String(e && e.message || e).slice(0, 80) }); }
      await chrome.storage.local.set({ portale: origine });
      reply({ ok: true, origine });
    })().catch((e) => reply({ ok: false, why: String(e && e.message || e) }));
    return true;
  }

  if (msg.t === "clearRef") {
    chrome.storage.local.get(null).then(async (all) => {
      await chrome.storage.local.remove([...Object.keys(all).filter((k) => k.startsWith("ref:")), REF_INDICE]);
      // le schede cliniche NON si cancellano al logout: hanno la loro
      // scadenza a 24 ore, ed è quella a decidere

      reply({ ok: true });
    }).catch(() => reply({ ok: false }));
    return true;
  }

  // «Dimentica i dati…» (⋯): schede cliniche, referti salvati, schede dietro
  // finite, chi aprì lo storico, ordini finiti e quello che il ponte ne
  // ricorda, le letture di cartella e terapie per il telefono. Restano
  // stampanti, portale, associazione col telefono, e un ordine che non ha finito.
  if (msg.t === "resetPazienti") {
    (async () => {
      await inFila(async () => {
        const all = await chrome.storage.local.get(null);
        await chrome.storage.local.remove(Object.keys(all).filter((k) => k === ARCH || k === REF_INDICE || k.startsWith("ref:")));
      });
      const s = await chrome.storage.session.get(null);
      await chrome.storage.session.remove(Object.keys(s).filter((k) => k === "apertura" || (k.startsWith("sotto:") && !inCorso(s[k]))));
      const p = s["ponte.ordini"];
      if (Array.isArray(p)) await chrome.storage.session.set({ "ponte.ordini": p.filter((m) => m && !m.fine) });
      await inFilaOrd(async () => {
        const l = await ordLeggi();
        const aperto = new Set(["coda", "avvio", "corre", "stampo", "stampa"]);
        for (const rec of l.filter((x) => !aperto.has(x.stato))) await togli(l, rec);
        await ordScrivi(l);
      });
      // e la registrazione, che ha le pagine vere dei pazienti, e quello che il
      // ponte tiene in memoria per il telefono (cartella, terapie, le sue note)
      if (typeof regCancella === "function") await regCancella().catch(() => {});
      if (typeof ponteDimentica === "function") await ponteDimentica().catch(() => {});
      reply({ ok: true });
    })().catch(() => reply({ ok: false }));
    return true;
  }
});

// ---------------------------------------------------------------------------
// L'ORDINE IN UNA SCHEDA DI SOTTOFONDO. «Conferma e stampa» (e «solo
// carrello») non mandano gli esami dalla scheda del medico: li manda una
// seconda scheda, aperta qui accanto e dietro, sulla pagina vera del paziente
// (o sul carrello della richiesta) — lo stesso indirizzo da cui il motore
// partirebbe. Lì il content script chiede chi è (per numero di scheda, mai un
// segno nell'indirizzo che il gestionale vedrebbe), e fa girare il motore di
// sempre dall'inizio alla fine. È un esecutore e basta: non diventa mai la
// scheda del medico. Ogni esito — le etichette, il carrello da confermare, un
// errore — arriva a tutte le schede del gestionale attraverso `ordini`
// (storage.session), e le etichette si stampano dove sta il medico. Finito il
// suo lavoro la scheda si slega dall'ordine e si chiude; se il medico la sta
// guardando proprio in quel momento resta, come una scheda qualunque.
// Un secondo ordine mentre uno gira aspetta in coda, nell'ordine in cui arriva.
// Ogni ordine porta `pubblico` = { tono, titolo, testo, dettaglio, tel? }: com'è,
// detto per chi legge — la striscia del PC e il telefono dicono quello (il
// telefono, dove serve, `tel`), e lo scrive una funzione sola (ordPubblico) a
// ogni scrittura. `stato` resta il passo della macchina: coda → avvio → corre
// → (stampo) → stampa | avviso, o errore / chiusa / interrotto.
const ORD = "ordini";
const ORD_PIANO = (id) => "ordine:" + id;
const ORD_VISTI = "ordiniVisti";   // gli ordini già accettati: uno chiesto due volte parte una volta
const ORD_FOGLI = "ordiniFogli";   // gli ordini di cui il service worker ha già i fogli: consegnati due volte, si stampano una
const ORD_RICONF = "ordiniRiconfermate";   // le richieste la cui Conferma è già stata rifatta: una volta sola
// L'ultima Conferma premuta per ogni richiesta, da qualunque scheda (le schede
// la annotano prima del clic, conferme.v1 nel content, e la dicono qui:
// ordinePremuta), [{ rid, t }]: «Conferma di nuovo» non preme mai sopra una
// Conferma premuta dopo quella che il carrello aveva smentito (vista.premuta).
const ORD_PREMUTE = "ordiniPremute";
const premute = async () => (await chrome.storage.session.get(ORD_PREMUTE))[ORD_PREMUTE] || [];
const premutaDopo = (l, rid, t) => !!rid && l.some((x) => x.rid === String(rid) && x.t > (Number(t) || 0));
// la richiesta di un ordine: quella del carrello consegnato, o la sua
const ridDi = (rec) => { try { return new URL(rec.consegna.url).searchParams.get("RICHIESTA_ID") || String(rec.rid || ""); } catch { return String(rec.rid || ""); } };
// «Conferma di nuovo» che non vale più — un'altra Conferma è partita intanto —: da controllare, e il bottone se ne va
function premutaAltrove(rec) {
  delete rec.vista.riconferma;
  rec.vista = { ...rec.vista, tag: DA_CONTROLLARE, testo: GUARDA, tono: "warn", quesito: "premuta intanto un'altra Conferma, da un'altra scheda" };
  rec.agg = Date.now();
}
const SA4 = "https://smarthealth.multimedica.it";
const ATTIVI = new Set(["avvio", "corre"]);          // occupano la coda: un motore alla volta
// (e «stampo»: confermata, il service worker stampa i fogli senza dialogo; la
// scheda dell'ordine dà solo i PDF, e la coda intanto va avanti)
// Un motore alla volta, e intorno a lui NIENTE nella stessa sessione del
// gestionale: un'altra pagina del gestionale aperta mentre il motore
// inserisce (la stampa delle etichette di un ordine di prima, la lista smart,
// una scheda di sottofondo, un altro motore) cambia sotto di lui la richiesta
// «corrente» della sessione, e il server risponde all'inserimento con
// «ORA-20965: AMB_RICHIESTA: Progressivo richiesta …-1 già utilizzato» — e il
// carrello riletto è vuoto. Quindi: il prossimo motore aspetta che i PDF della
// stampa di prima siano presi (pochi secondi: la stampa vera va avanti da
// sola), e la stampa, come le schede di sottofondo, aspetta che il motore
// abbia finito (motoreAlLavoro).
const PRESA_MAX = 60e3;       // una presa di PDF ferma da così: non tiene più la coda
const daPrendere = (rec) => rec.stato === "stampo" && !rec.ferma && !rec.interrotta && Date.now() - (rec.agg || 0) < PRESA_MAX
  && Array.isArray(rec.fogli) && rec.fogli.some((f, i) => (f.stato === "attesa" || f.stato === "prendo") && !((rec.stampa && rec.stampa.jobs && rec.stampa.jobs[i]) || {}).diretto);
// PRIMA LE ETICHETTE. Senza la stampa automatica le etichette di un ordine le
// stampa una scheda del medico, col dialogo: la si cerca SUBITO (daDare: il
// prossimo ordine aspetta che la consegna sia tentata, al più DARE_MAX), e la
// scheda che le prende scarica tutti i PDF per primi e lo dice
// (ordinePresi): finché non li ha — al più PRESA_PDF_MAX — il prossimo ordine
// non parte. Le pagine del gestionale sono di una sessione sola: un motore
// che manda esami intanto le avrebbe fatte aspettare dietro di sé.
// (In memoria: un service worker che riparte non aspetta niente.)
const PRESE = new Map();   // id dell'ordine → { t: quando una scheda ha preso le sue etichette, tab: quale }
// (PRESA_PDF_MAX: i 18 s in cui la scheda comincia a prendere i PDF — PRESA_SCHEDA_MAX, content — più
// i 20 s che l'ultimo può metterci — TIMEOUT_MS —: mai il prossimo ordine con una sua lettura in volo)
const PRESA_PDF_MAX = 40e3, DARE_MAX = 12e3;
const preseInCorso = () => { const ora = Date.now(); for (const [k, x] of PRESE) if (ora - x.t > PRESA_PDF_MAX) PRESE.delete(k); return PRESE.size > 0; };
// (la scheda che le ha prese se ne va — chiusa, o su un'altra pagina —: i suoi PDF non arrivano più, la coda non li aspetta)
const preseVia = (tab) => {
  let via = false;
  for (const [k, x] of PRESE) if (x.tab === tab) { PRESE.delete(k); via = true; }
  if (via) inFilaOrd(async () => { await ordAvanti(await ordLeggi()); }).catch(() => {});
};
chrome.tabs.onRemoved.addListener((tab) => preseVia(tab));
chrome.tabs.onUpdated.addListener((tab, info) => { if (info.status === "loading" && PRESE.size) preseVia(tab); });
const daDare = (rec) => rec.stato === "stampa" && !!rec.daDare && Date.now() - rec.daDare < DARE_MAX;
// IL MOTORE, UNO SOLO IN TUTTO IL BROWSER. Un ordine in sottofondo che gira
// (`ATTIVI`) è un motore; e lo è un giro nella scheda del medico (senza la
// scheda di sottofondo, la pagina «Nuova richiesta», una ripresa), la sua
// conferma nella cornice, e il giro della scheda dell'ordine: quelli lo
// chiedono qui (ordineMotore) e lo tengono — `motore` in storage.session,
// { tab, id, scade } —, lo rinnovano ogni 4 secondi finché lavorano e lo
// mollano alla fine. Non rinnovato, scade da solo in 15 secondi. Una pagina
// che se ne va con un giro da riprendere NON lo molla: lo riprende la stessa
// scheda (o scade). Chi lo chiede mentre lo tiene un altro aspetta, prima di
// partire — mai a metà —; un ordine nuovo, dal PC o dal telefono, va in coda.
const MOTORE_K = "motore";
const MOTORE_SCADE = 15e3;
let MOTORE_ORA = null;   // (lo scrive solo il service worker: qui la copia, ricaricata quando si sveglia)
let motorePronto = Promise.resolve();
try { motorePronto = Promise.resolve(chrome.storage.session.get(MOTORE_K)).then((o) => { MOTORE_ORA = (o && o[MOTORE_K]) || null; }).catch(() => {}); } catch { /* niente: nessun motore */ }
const motoreDiScheda = () => (MOTORE_ORA && MOTORE_ORA.scade > Date.now() ? MOTORE_ORA : null);
const motoreScrivi = (m) => { MOTORE_ORA = m; return m ? chrome.storage.session.set({ [MOTORE_K]: m }) : chrome.storage.session.remove(MOTORE_K); };
// (un ordine «muto» — «Ordine fermo · ⏹ la chiude» — tiene la coda, ma non le letture)
const occupato = (l) => l.some((x) => ATTIVI.has(x.stato) || daPrendere(x) || daDare(x)) || !!motoreDiScheda() || preseInCorso();
const motoreAlLavoro = (l, tranne = null) => l.some((x) => x !== tranne && ATTIVI.has(x.stato) && !x.muto) || !!motoreDiScheda();
// …e chi apre da solo una scheda del gestionale (un referto, lo storico, il
// telefono) aspetta qui la fine del motore, al più 4 minuti
const DOPO_MOTORE_MAX = 240e3;
async function dopoIlMotore() {
  await motorePronto;
  const fine = Date.now() + DOPO_MOTORE_MAX;
  while (Date.now() < fine && motoreAlLavoro(await ordLeggi().catch(() => []))) await new Promise((r) => setTimeout(r, 1000));
}
const AVVIO_MAX = 45e3;       // la scheda non ha detto «parto»: non partirà
const AVVIO_VUOTA = 6e3;      // la scheda è ancora vuota, mai arrivata sulla pagina: se ne apre un'altra
const MUTO_MAX = 180e3;       // tre minuti senza una parola: si chiede alla scheda se c'è
const STAMPA_MAX = 30 * 60e3; // etichette che nessuno è tornato a prendere
const ORD_TTL = 12 * 3600e3;  // un ordine aperto (etichette che aspettano) più vecchio di un turno
// Finito, un ordine resta quanto serve a chi lo guarda: andato bene, quanto
// la striscia lo mostra (due minuti); se no mezz'ora, per leggerlo.
const FINE_OK_TTL = 2 * 60e3;
const FINE_TTL = 30 * 60e3;
const FINALI = new Set(["avviso", "errore", "chiusa", "interrotto"]);
const ordTiene = (x, l, ora) => ATTIVI.has(x.stato) || x.stato === "coda"
  || ora - (x.agg || 0) <= (!FINALI.has(x.stato) ? ORD_TTL : ordPubblico(x, l).tono === "ok" ? FINE_OK_TTL : FINE_TTL);
let codaOrd = Promise.resolve();
const inFilaOrd = (fn) => (codaOrd = codaOrd.then(fn, fn));
// Le schede del gestionale leggono lo stato dell'ordine da sole, e ascoltano
// quando cambia: storage.session, che muore col browser, non sta su disco.
try { chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })?.catch?.(() => {}); } catch { /* Chrome vecchio: niente ordini in sottofondo */ }
const sulGestionale = (u) => { try { return new URL(u).origin === SA4; } catch { return false; } };
// solo l'indirizzo di una pagina da LEGGERE: mai quello di un modulo inviato,
// di un inserimento o di una cancellazione
const leggibileOrd = (u) => {
  try {
    const x = new URL(u);
    return x.origin === SA4 && /\/menuPsoEpisodio\.do$/i.test(x.pathname) && !/[?&](ccsForm|Insert|Delete|Update)=/i.test(x.search);
  } catch { return false; }
};
// (un ordine finito da tempo non si legge più: chi scrive dopo lo toglie)
const ordLeggi = async () => {
  const l = (await chrome.storage.session.get(ORD))[ORD];
  const ora = Date.now(), tutti = Array.isArray(l) ? l : [];
  return tutti.filter((x) => ordTiene(x, tutti, ora));
};
// a ogni scrittura, per ogni ordine, che cosa dire a chi guarda; e il piano
// di un ordine che non gira più (lo serviva solo alla sua scheda) se ne va
const ordScrivi = async (l) => {
  const ora = Date.now();
  const via = l.filter((r) => !ATTIVI.has(r.stato) && r.stato !== "coda" && !r.senzaPiano);
  for (const r of via) r.senzaPiano = true;
  for (let i = l.length - 1; i >= 0; i--) if (!ordTiene(l[i], l, ora)) l.splice(i, 1);
  for (const r of l) r.pubblico = ordPubblico(r, l);
  // finito in arancione o in rosso: la registrazione automatica salva gli ultimi minuti (registra.js)
  if (typeof regDopoOrdini === "function") regDopoOrdini(l);
  if (via.length) chrome.storage.session.remove(via.map((r) => ORD_PIANO(r.id))).catch(() => {});
  return chrome.storage.session.set({ [ORD]: l });
};
const corto = (s, n = 160) => String(s == null ? "" : s).slice(0, n);
const nomi = (a) => (Array.isArray(a) ? a.slice(0, 30).map((x) => corto(x, 60)) : []);
const togli = async (l, rec) => { const i = l.indexOf(rec); if (i >= 0) l.splice(i, 1); await chrome.storage.session.remove(ORD_PIANO(rec.id)); };
// Il Registro della scheda dell'ordine, con la sua ultima parola: la scheda si
// chiude, le schede del medico lo aggiungono al loro (le righe di sempre, già
// dentro il gestionale: qui solo testo corto, e solo finché c'è l'ordine)
const registroDi = (rec, msg) => { if (Array.isArray(msg.registro)) rec.registro = msg.registro.slice(-40).map((s) => corto(s, 240)); };
// Un messaggio a una scheda, con una risposta entro pochi secondi o niente: una
// scheda bloccata non deve fermare la fila degli ordini (null = non ha risposto).
const allaScheda = (id, m, ms = 5000) => Promise.race([chrome.tabs.sendMessage(id, m).catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);

// la scheda nasce vuota, si annota per quale ordine è, POI va sulla pagina:
// così la risposta a «chi sono?» c'è sempre prima del content script
// (`stato`: «stampo» per la scheda che dà solo i PDF di una stampa, ordineFogli)
async function ordApri(rec, l, stato = "avvio") {
  const op = rec.opener != null ? await chrome.tabs.get(rec.opener).catch(() => null) : null;
  const dove = op && sulGestionale(op.url) ? { openerTabId: op.id, index: op.index + 1, windowId: op.windowId } : {};
  const vuota = { url: "about:blank", active: false };
  const t = await chrome.tabs.create({ ...vuota, ...dove }).catch(() => chrome.tabs.create(vuota));
  // (`partito`: quando ha lasciato la coda — la striscia toccata cede solo a un ordine partito dopo il tocco)
  rec.worker = t.id; rec.stato = stato; rec.agg = Date.now(); rec.partito = Date.now();
  await ordScrivi(l);
  try { await chrome.tabs.update(t.id, { url: rec.url }); }
  catch (e) { await chrome.tabs.remove(t.id).catch(() => {}); rec.worker = null; throw e; }
  // la memoria del browser non deve buttarla via a metà giro
  chrome.tabs.update(t.id, { autoDiscardable: false }).catch(() => {});
}
// Un ordine la cui scheda non è partita: niente inviato, si riprova. Ma per
// «Conferma di nuovo» la richiesta c'è già, coi suoi esami nel carrello:
// niente premuto, e la Conferma resta da premere — lì.
const nonPartito = (rec, perche) => (rec && rec.riconfermata
  ? { tag: NON_PARTITA, testo: "apri il carrello e premi Conferma", tono: "err", quesito: `${perche}: niente premuto` }
  : { tag: NON_PARTITA, testo: "niente inviato: riprova", tono: "err", quesito: perche });
// La prossima in coda, se nessun motore sta girando. Se la sua scheda non si
// apre, quell'ordine non parte e lo si dice: niente è stato mandato.
// (e la lista smart ancora al suo giro: si aspetta lei — la sua fine, o il tempo, rimette in moto la coda)
let smartSpinta = null;
const ordSpingi = () => inFilaOrd(async () => { await ordAvanti(await ordLeggi()); }).catch(() => {});
async function ordAspetta(l) {
  if (occupato(l)) return true;
  const smart = await smartVivaFinoA();
  if (smart) { clearTimeout(smartSpinta); smartSpinta = setTimeout(ordSpingi, smart + 250); }
  return !!smart;
}
async function ordAvanti(l) {
  for (;;) {
    if (!l.some((x) => x.stato === "coda") || await ordAspetta(l)) return;
    const next = l.find((x) => x.stato === "coda");
    try { await ordApri(next, l); return; }
    catch {
      next.stato = "errore"; next.agg = Date.now(); next.worker = null;
      next.vista = nonPartito(next, "la scheda per l'ordine non si è aperta");
      await ordScrivi(l);
    }
  }
}
// Finito il lavoro, la scheda dell'ordine si slega e si chiude — a meno che
// il medico non la stia guardando proprio adesso (è la scheda attiva della sua
// finestra): allora resta, una scheda qualunque. Mai un numero di scheda
// legato a un ordine finito.
async function ordSlega(rec) {
  const id = rec.worker;
  rec.worker = null;
  if (id == null) return;
  const t = await chrome.tabs.get(id).catch(() => null);
  if (t && !t.active) await chrome.tabs.remove(id).catch(() => {});
}
// Le etichette vanno dove sta il medico: la scheda del gestionale davanti
// agli occhi, nella finestra in primo piano prima. Nessuna scheda del
// gestionale davanti: si aspetta che ce ne sia una. La scheda decide se può
// (non mentre lui scrive, non da sola sulla pagina di un altro paziente):
// se dice di no si riprova dopo. Lo stesso ordine non si stampa mai due
// volte: va via da `ordini` appena una scheda l'ha preso, e le schede si
// segnano quelli già stampati. (`jobs`: solo quei fogli — «Ristampa» rifà
// quelli non usciti.) La domanda alla scheda (fino a 5 secondi) si fa FUORI
// dalla fila degli ordini: una scheda lenta non ferma gli altri. Un ordine si
// dà a una scheda alla volta (CONSEGNO): mai a due schede insieme.
const CONSEGNO = new Set();
// (`insieme`: gli altri ordini dello stesso tocco su Conferma, i cui fogli sono
// in `jobs`: dati alla scheda, se ne vanno anche loro — la Ristampa di un gesto)
async function ordDai(id, tabId, forza, jobs = null, dest = "", insieme = []) {
  if (CONSEGNO.has(id)) return false;
  CONSEGNO.add(id);
  try {
    const rec = (await ordLeggi()).find((x) => x.id === id && x.stampa && (x.stato === "stampa" || (forza && x.stato === "avviso")));
    if (!rec) return false;
    const stampa = jobs ? { ...rec.stampa, jobs } : rec.stampa;
    // (`dest`: «Ristampa» di un ordine della stazione torna alla stazione; «Stampa qui», qui)
    const r = await allaScheda(tabId, { t: "psassistStampa", id: rec.id, ep: rec.ep, paziente: rec.paziente, stampa, forza: !!forza, conferma: rec.ts || 0,
      dest: dest || (rec.dest === "stazione" && rec.stato !== "stampa" ? "stazione" : "qui"),
      ...(rec.gesto ? { gesto: rec.gesto } : {}), confermata: rec.confermata || 0 });
    if (!(r && r.ok)) return false;
    // (le etichette prese da una scheda col dialogo: la coda aspetta che lei abbia tutti i PDF — ordinePresi)
    if (rec.stato === "stampa" && !forza && !r.gia) PRESE.set(String(rec.id), { t: Date.now(), tab: tabId });
    await inFilaOrd(async () => {
      const l = await ordLeggi();
      for (const y of l.filter((y) => y.id === id || insieme.includes(y.id))) await togli(l, y);
      await ordScrivi(l);
    });
    return true;
  } finally { CONSEGNO.delete(id); }
}
// (un ordine dal telefono non apre mai da solo il dialogo di stampa: davanti
// al PC può non esserci nessuno. Aspetta un tocco su «Stampa», e lo dice.)
const dalTelefono = (rec) => String(rec.id).startsWith("tel");
async function ordConsegnaStampa() {
  const pronte = (await ordLeggi()).filter((x) => x.stato === "stampa" && x.stampa && !dalTelefono(x) && x.dest !== "stazione" && !CONSEGNO.has(x.id));
  if (!pronte.length) return;
  const cand = [];
  for (const q of [{ active: true, lastFocusedWindow: true }, { active: true }]) {
    for (const t of await chrome.tabs.query(q).catch(() => [])) if (sulGestionale(t.url) && !cand.includes(t.id)) cand.push(t.id);
  }
  for (const rec of pronte) {
    let data = false;
    for (const id of cand) if (await ordDai(rec.id, id, false)) { data = true; break; }
    // (nessuna scheda le prende adesso — un altro paziente davanti, chi scrive, nessuna scheda:
    // restano per il tocco su «Stampa», e la coda non le aspetta più)
    if (!data && rec.daDare) {
      await inFilaOrd(async () => {
        const l = await ordLeggi(), x = l.find((y) => y.id === rec.id);
        if (x && x.daDare) { delete x.daDare; await ordScrivi(l); await ordAvanti(l); }
      });
    }
  }
}
// Il giro di controllo: schede sparite, schede che non partono o non parlano
// più, etichette che nessuno ha preso. Lo chiedono le schede
// del gestionale ogni pochi secondi finché un ordine gira o aspetta la stampa:
// il service worker può addormentarsi, le schede no. Si riscrive solo se
// qualcosa è cambiato.
async function ordControlla(l) {
  const ora = Date.now();
  const prima = JSON.stringify(l);
  const sonda = [];   // le schede zitte a cui chiedere se ci sono
  for (const rec of [...l]) {
    const t = rec.worker != null ? await chrome.tabs.get(rec.worker).catch(() => null) : null;
    if (rec.worker != null && (!t || t.discarded)) {
      rec.worker = null;
      if (ATTIVI.has(rec.stato)) { rec.stato = "chiusa"; rec.agg = ora; rec.vista = { tag: "", testo: "", tono: "err" }; }
      if (rec.stato === "stampo") rec.interrotta = rec.interrotta || "la scheda dell'ordine si è chiusa";
    } else if (rec.stato === "avvio" && ora - rec.agg > AVVIO_MAX) {
      rec.stato = "errore"; rec.agg = ora;
      rec.vista = nonPartito(rec, "la scheda dell'ordine non ha risposto");
      await ordSlega(rec);
    } else if (rec.stato === "avvio" && t && !rec.riaperta && rec.consegnata == null && ora - rec.agg > AVVIO_VUOTA && !sulGestionale(t.url) && !sulGestionale(t.pendingUrl)) {
      // La scheda nuova non è mai arrivata sulla pagina (il suo processo è
      // morto appena nata): lì non c'è nessun pannello, niente può essere
      // partito. Al suo posto un'altra, una volta sola. Mai due motori: il
      // piano si dà a UNA scheda sola (`consegnata`, in ordineChi) e questa non
      // l'ha mai avuto; e la vecchia si chiude PRIMA che nasca la nuova.
      rec.riaperta = true;
      const vuota = rec.worker;
      rec.worker = null;
      await chrome.tabs.remove(vuota).catch(() => {});
      try { await ordApri(rec, l); }
      catch {
        rec.stato = "errore"; rec.agg = ora; rec.worker = null;
        rec.vista = nonPartito(rec, "la scheda per l'ordine non si è aperta");
      }
    } else if (rec.stato === "corre" && ora - rec.agg > MUTO_MAX) {
      // Zitta da troppo: le si chiede se c'è (ordSonda, fuori dalla fila).
      // Finché la scheda esiste non si dice «non mandati» (potrebbe mandare
      // ancora) e la coda aspetta: mai due motori insieme. Se risponde, era
      // solo lenta.
      if (rec.worker != null) sonda.push({ id: rec.id, worker: rec.worker });
    } else if (rec.stato === "stampo" && rec.pronta === false && ora - rec.agg > AVVIO_MAX) {
      // la scheda dei PDF non ha mai detto «ci sono»: i fogli non partono
      rec.interrotta = rec.interrotta || "la scheda dell'ordine non ha dato il foglio";
    } else if (rec.stato === "stampo" && rec.pronta === false && ora - rec.agg > 6000 && !rec.ricarico) {
      // …dopo qualche secondo zitta (la pagina non si è caricata): la si ricarica, una volta
      rec.ricarico = true;
      chrome.tabs.update(rec.worker, { url: rec.url }).catch(() => {});
    } else if (rec.stato === "stampa" && ora - rec.agg > STAMPA_MAX) nonStampate(rec, "si stampano dalla sua pagina, sezione Stampa");
  }
  if (JSON.stringify(l) !== prima) await ordScrivi(l);
  // una stampa che questo service worker non sta facendo (si è riavviato): la riprende
  for (const rec of l) if (rec.stato === "stampo" && !STAMPO_VIVI.has(rec.id)) ordStampaFogli(rec.id);
  await ordAvanti(l);
  ordStampaOra();
  return sonda;
}
// Etichette che aspettavano una scheda e non si stampano più — non le ha prese
// nessuno, o «Annulla» —: non stampate, e lo si dice in ambra, mai un verde.
function nonStampate(rec, testo) {
  // («Confermata» solo per un ordine confermato; una ristampa, un consenso, un'etichetta anagrafica dicono com'è andata e basta)
  const ordine = !!rec.confermata || !!(rec.stampa && rec.stampa.tag === "Confermata");
  // (e col nome di quello che non è uscito: «Etichette» solo se sono etichette — un consenso, un PDF, col suo)
  const jobs = (rec.stampa && Array.isArray(rec.stampa.jobs) ? rec.stampa.jobs : []).filter((j) => j && j.name);
  const cosa = jobs.length && jobs.every((j) => j.printer === "etichettatrice") ? "Etichette NON stampate"
    : jobs.length === 1 ? `NON stampato: ${corto(jobs[0].name, 60)}` : "Fogli NON stampati";
  rec.stato = "avviso"; rec.agg = Date.now(); rec.stampa = null; delete rec.fogli;
  rec.vista = ordine ? { tag: CONFERMATA, testo: "Etichette NON stampate", quesito: testo, tono: "warn" } : { tag: cosa, testo, tono: "warn" };
}
// «Ci sei?» alle schede zitte — fuori dalla fila: una scheda bloccata non deve
// fermare gli altri ordini, il ⏹ né le letture —; la risposta si scrive dopo,
// dentro, solo se l'ordine è ancora quello.
const SONDO = new Set();
async function ordSonda(sonda) {
  for (const { id, worker } of sonda || []) {
    if (SONDO.has(id)) continue;
    SONDO.add(id);
    try {
      const r = await allaScheda(worker, { t: "psassistVivo", id });
      await inFilaOrd(async () => {
        const l = await ordLeggi();
        const rec = l.find((x) => x.id === id && x.worker === worker && x.stato === "corre");
        if (!rec || (!(r && r.ok) && rec.muto)) return;
        if (r && r.ok) { rec.agg = Date.now(); delete rec.muto; } else rec.muto = true;
        await ordScrivi(l);
      });
    } finally { SONDO.delete(id); }
  }
}

chrome.tabs.onRemoved.addListener((id) => {
  inFilaOrd(async () => {
    if (MOTORE_ORA && MOTORE_ORA.tab === id) { await motoreScrivi(null); await ordAvanti(await ordLeggi()); }
    const l = await ordLeggi();
    const rec = l.find((x) => x.worker === id);
    if (!rec) return;
    rec.worker = null;
    // chiusa a metà giro: le schede del medico diranno cosa non è partito
    if (ATTIVI.has(rec.stato)) { rec.stato = "chiusa"; rec.agg = Date.now(); rec.vista = { tag: "", testo: "", tono: "err" }; }
    // chiusa mentre si stampa: la richiesta è confermata, i fogli rimasti non partono
    if (rec.stato === "stampo") rec.interrotta = rec.interrotta || "la scheda dell'ordine si è chiusa";
    await ordScrivi(l);
    await ordAvanti(l);
  }).catch(() => {});
});
// Com'è l'ordine, per chi legge: la striscia di ogni scheda del gestionale e
// il telefono dicono questo, con le stesse parole — salvo quello che il
// telefono dice a modo suo (`tel`: «aspettano qualcuno al PC», non «tocca
// Stampa»). Il titolo è com'è andata. Sui fogli si dice solo quello che si
// sa: «Stampato» se Windows l'ha fatto uscire dalla coda, «Mandato» (in
// ambra) se è nella coda, «NON stampate» se non è partito niente,
// «sconosciuto» se l'aiutante non ha detto com'è andata.
const ORA = (ts) => { const d = new Date(ts || Date.now()); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const usciti = (f) => f.stato === "stampato" || f.stato === "mandato";
// L'etichetta anagrafica (il «Stampa Bracciale» del gestionale, il suo link),
// all'etichettatrice: un ordine solo con N fogli dello stesso link (le copie
// che il medico ha chiesto a tocchi), il PDF preso una volta. Non si infila
// fra le etichette di un ordine che sta stampando le sue: aspetta che escano.
const braccialeUrl = (u) => { try { const x = new URL(u); return x.origin === SA4 && x.searchParams.get("REPORT") === "PsoBraccialettoHMIMU"; } catch { return false; } };
const soloBracciale = (rec) => !!rec.stampa && Array.isArray(rec.stampa.jobs) && rec.stampa.jobs.length > 0 && rec.stampa.jobs.every((j) => braccialeUrl(j.url));
const etichetteInCorso = (l, rec) => l.find((x) => x !== rec && x.stato === "stampo" && !x.interrotta && !x.ferma && !soloBracciale(x)
  && (x.fogli || []).some((f) => f.tipo === "etichette" && ["attesa", "prendo", "invio"].includes(f.stato)));
// Com'è finito un ordine, in tre parole sole — le stesse sulla striscia, sul
// telefono e nel Registro: «Confermata» (provata), «Da controllare» (la
// Conferma è partita, la prova no), «Non partita» (provata non presa, o
// fermata prima della Conferma). Sotto, l'azione; sotto ancora, il perché.
const CONFERMATA = "Confermata", DA_CONTROLLARE = "Da controllare", NON_PARTITA = "Non partita";
const GUARDA = "guarda le sue richieste: se c'è, Ristampa; se no, apri il carrello";
function ordPubblico(rec, l = []) {
  const v = rec.vista || {}, r = rec.resto || {}, f = Array.isArray(rec.fogli) ? rec.fogli : [];
  // (la scheda dell'ordine ha passato il gestionale all'area del paziente: l'esito lo dice, una volta)
  const gira = ["coda", "avvio", "corre"].includes(rec.stato);
  const area = rec.area && !gira ? `gestionale ora sull'area ${rec.area}` : "";
  // (la stazione non ha risposto quando l'ordine è nato: lo si chiede subito — «Stampa qui», un tocco)
  const muta = gira && rec.dest === "stazione" && rec.stazioneMuta ? `${rec.destNome || "Infermeria"} non risponde: stampo qui?` : "";
  // (il quesito si vede dove si sceglie, e nella ricevuta: non sulla striscia)
  const P = (tono, titolo, testo = "", ...dettaglio) => ({ tono, titolo: corto(titolo, 80), testo: corto(testo, 200), dettaglio: corto([muta, ...dettaglio, area].filter(Boolean).join(" · "), 240) });
  const alTel = (pc, telefono) => (dalTelefono(rec) ? { ...pc, tel: telefono } : pc);
  const tono = (t, d) => (["run", "ok", "warn", "err"].includes(t) ? t : d);
  const lista = (k) => (Array.isArray(r[k]) ? r[k] : []);
  const resto = [lista("mancano").length ? `Mancano: ${lista("mancano").join(", ")}` : "", lista("controllare").length ? `Da controllare: ${lista("controllare").join(", ")}` : ""].filter(Boolean).join(" · ");
  const st = rec.stampa || {};
  const tel = dalTelefono(rec) ? "avvisa chi preleva" : "";
  const dove = (xs) => [...new Set(xs.map((x) => x.stampante).filter(Boolean))].join(" e ") || "la stampante";
  // (i fogli della stazione di stampa: «in Infermeria», non «su Zebra ZD421»)
  const sta = (xs) => xs.length > 0 && xs.every((x) => x.stazione);
  const su = (xs) => `${sta(xs) ? "in" : "su"} ${dove(xs)}`, a = (xs) => `${sta(xs) ? "in" : "a"} ${dove(xs)}`;
  const etichette = (xs) => xs.some((x) => x.tipo === "etichette");
  const cosa = (xs) => (etichette(xs) ? "Etichette NON stampate" : "Fogli NON stampati");
  const alle = `${st.riassunto ? st.riassunto + " " : ""}alle ${ORA(rec.agg)}`;
  // Un ordine confermato dice «Confermata»: com'è andata la stampa è la frase
  // sotto (le parole di sempre), e quello che stava sotto scende alla riga
  // del perché. Una stampa che non è un ordine (l'etichetta anagrafica, un
  // consenso, un PDF) dice com'è andata, come sempre.
  const conf = !!rec.confermata || st.tag === "Confermata";
  const E = (tono, titolo, testo = "", ...det) => (conf ? P(tono, CONFERMATA, titolo, testo, ...det) : P(tono, titolo, testo, ...det));
  switch (rec.stato) {
    case "coda": {
      const prima = l.find((x) => x !== rec && ATTIVI.has(x.stato));
      return P("run", "In coda", prima ? `parte dopo l'ordine di ${prima.paziente || "un altro paziente"}` : motoreDiScheda() ? "parte dopo il giro di un'altra scheda" : "parte fra poco");
    }
    case "avvio": return P("run", "Parte", v.testo || "Apro la scheda dell'ordine…");   // («passo all'area …»)
    case "corre":
      if (rec.muto) return P("err", "Ordine fermo", "La scheda dell'ordine non risponde: ⏹ la chiude", [...lista("mancano"), ...lista("controllare")].length ? `Da controllare: ${[...lista("mancano"), ...lista("controllare")].join(", ")}` : "");
      if (rec.ferma) return P("warn", "Fermo chiesto", "la scheda dell'ordine si ferma appena risponde");
      return P(tono(v.tono, "run"), v.badge || v.tag || "In corso", [v.tag && v.badge ? v.tag : "", v.testo].filter(Boolean).join(" · ") || "…", v.quesito);
    case "stampo": {
      // i fogli che stanno andando alla stampante (le due stampanti lavorano
      // insieme), se no quelli che arrivano, se no il prossimo
      const con = f.map((x, i) => ({ x, i })), di = (s) => con.filter(({ x }) => x.stato === s);
      const ora = [di("invio"), di("prendo"), di("attesa").slice(0, 1)].find((xs) => xs.length) || [];
      const cosa = ({ x }) => `${/^etichett/i.test(x.name) ? "le etichette" : /^lista/i.test(x.name) ? "la lista esami" : `«${x.name}»`}${x.stampante ? ` ${su([x])}` : ""}`;
      // («Confermata»; una ristampa dalla scheda del medico, «Stampa»)
      const tag = st.tag || "Confermata";
      if (rec.ferma || rec.interrotta) return P("warn", tag, "Fermo la stampa: finisce il foglio in corso", st.riassunto);
      const bracc = soloBracciale(rec);
      const prima = bracc && !di("invio").length ? etichetteInCorso(l, rec) : null;
      if (prima) return P("run", tag, `L'etichetta anagrafica, dopo le etichette di ${prima.paziente || "un altro ordine"}…`, st.riassunto);
      // (le copie in un lavoro solo, con l'aiutante dalla 4: «3 copie»; con quello di prima, una a una)
      if (bracc && ora.length) return P("run", tag, `Stampo l'etichetta anagrafica${ora[0].x.stampante ? ` ${su([ora[0].x])}` : ""}…`,
        ora.length > 1 ? `${ora.length} copie` : f.length > 1 ? `copia ${ora[0].i + 1} di ${f.length}` : "", st.riassunto);
      return P("run", tag, ora.length ? `Stampo ${ora.map(cosa).join(" e ")}…` : "Stampo…",
        f.length > 1 && ora.length ? `${ora.length > 1 ? "fogli" : "foglio"} ${ora.map(({ i }) => i + 1).join(" e ")} di ${f.length}` : "", st.riassunto);
    }
    case "stampa": {
      // le etichette aspettano una scheda del gestionale (il dialogo di stampa);
      // per un ordine dal telefono, un tocco su «Stampa»
      const rotti = f.filter((x) => x.stato === "fallito");
      // (la stazione di stampa non ha stampato: mai da soli qui — «Stampa qui», un tocco)
      if (rotti.length && sta(rotti)) {
        const muta = rotti.find((x) => x.nonRisponde);
        const titolo = muta ? `${dove(rotti)} non risponde` : cosa(rotti);
        return alTel(E("warn", titolo, muta ? `${cosa(rotti)}: stampa qui?` : rotti[0].why, st.riassunto),
          E("warn", titolo, `${cosa(rotti)}: aspettano qualcuno al PC`, muta ? "" : rotti[0].why, st.riassunto));
      }
      if (rotti.length) {
        return alTel(E("warn", cosa(rotti), rotti[0].why || `${dove(rotti)} ha dato errore`, st.riassunto),
          E("warn", cosa(rotti), "aspettano qualcuno al PC", rotti[0].why, st.riassunto));
      }
      if (dalTelefono(rec)) return alTel(E("warn", "Etichette NON stampate", "tocca Stampa", st.riassunto), { ...P("ok", CONFERMATA, "etichette al PC", st.riassunto), quieto: true });
      return P("run", CONFERMATA, "Etichette pronte", st.riassunto);
    }
    case "errore": {
      // «Non partita». Sotto che cosa fare — «apri il carrello → Riprova i
      // mancanti» —, poi che cosa manca, o il perché di un ordine che non è
      // partito affatto. La causa di un errore — «il codice 324 oggi si
      // chiama…» — la dice il resoconto che il carrello apre.
      const m = lista("mancano"), c = lista("controllare");
      const riprova = !!(rec.consegna && rec.consegna.avviso && rec.consegna.avviso.riprova) && m.length;
      // (niente è partito — la scheda non si è aperta, o ha detto di no prima
      // del primo esame —: solo quando chi lo sa lo ha detto, mai dedotto da
      // un elenco che potrebbe essere vecchio)
      const detto = v.tag === NON_PARTITA ? String(v.testo || "") : "";
      const niente = !rec.consegna && /^niente inviato/.test(detto);
      const fare = v.sessione ? "rifai l'accesso, poi apri il carrello" : niente ? detto
        : rec.consegna ? (riprova ? "apri il carrello → Riprova i mancanti" : "apri il carrello") : detto || "completa a mano nel gestionale";
      const elenchi = [m.length ? `${m.join(", ")}: ${m.length === 1 ? "non mandato" : "non mandati"}` : "", c.length ? `Da controllare: ${c.join(", ")}` : ""].filter(Boolean);
      const pc = P("err", NON_PARTITA, fare, ...(elenchi.length && !niente ? elenchi : [v.quesito || resto]));
      return alTel(pc, niente || v.sessione ? pc : { ...pc, testo: "completa al PC" });
    }
    case "chiusa": {
      // La scheda chiusa a metà giro. Mancava ancora un esame: la Conferma non
      // c'è stata («Non partita»). Se no può esserci stata: da controllare.
      const m = lista("mancano"), c = lista("controllare"), nel = lista("nel");
      const det = ["la scheda dell'ordine si è chiusa", m.length ? `Mancano: ${m.join(", ")}` : "", c.length ? `Da controllare: ${c.join(", ")}` : ""];
      if (!m.length && (nel.length || c.length)) return P("warn", DA_CONTROLLARE, GUARDA, ...det);
      return P("err", NON_PARTITA, nel.length || c.length ? "apri il carrello" : "niente inviato: riprova", ...det);
    }
    case "interrotto": return P("err", NON_PARTITA, v.testo || "apri il carrello", v.quesito || resto);
    default: {
      if (!f.length) {
        const p = P(tono(v.tono, "ok"), v.tag || "Fatto", v.testo, v.quesito);
        // («Conferma di nuovo» è un bottone della striscia del PC)
        return v.riconferma ? alTel(p, { ...p, testo: "Conferma di nuovo: dal PC" }) : p;
      }
      // com'è finita la stampa senza dialogo, foglio per foglio
      // (il perché tecnico resta sul PC; il telefono dice che cosa guardare)
      // (un foglio tolto col suo ✕ l'ha voluto il medico: non è «non uscito»)
      const ignoti = f.filter((x) => x.stato === "sconosciuto"), non = f.filter((x) => !usciti(x) && x.stato !== "sconosciuto" && x.stato !== "tolto");
      // (la stazione: il foglio le è arrivato, la risposta no — o la sua stampante non ha detto com'è andata)
      if (ignoti.length && sta(ignoti)) {
        const e = etichette(ignoti) ? "e" : "i";
        return alTel(E("warn", /non risponde/.test(ignoti[0].why) ? `${dove(ignoti)} non risponde` : `Esito sconosciuto ${su(ignoti)}`,
          `forse stampat${e}: guarda lì prima di stamparl${e} qui`, st.riassunto),
        E("warn", etichette(ignoti) ? `Etichette forse stampate ${su(ignoti)}` : `Fogli forse stampati ${su(ignoti)}`, `guarda lì prima di ristamparl${e} dal PC`, st.riassunto));
      }
      if (ignoti.length) {
        return alTel(E("warn", "Esito della stampa sconosciuto", `controlla ${dove(ignoti)}: ${ignoti[0].why || "l'aiutante non ha detto com'è andata"}`, st.riassunto),
          E("warn", etichette(ignoti) ? "Etichette forse stampate" : "Fogli forse stampati",
            `guarda ${dove(ignoti)} prima di ristamparl${etichette(ignoti) ? "e" : "i"} dal PC`, st.riassunto));
      }
      if (non.length) return E("warn", "Stampa interrotta", `non usciti: ${non.map((x) => x.name).join(", ")}`, rec.interrotta, st.riassunto);
      // (tutto tolto col ✕: non è uscito niente, e lo ha voluto il medico)
      if (f.every((x) => x.stato === "tolto")) return E("ok", "Niente stampato", "tolto col ✕");
      const stampati = f.filter((x) => x.stato === "stampato"), mandati = f.filter((x) => x.stato === "mandato");
      if (soloBracciale(rec)) return mandati.length ? P("warn", `Mandata ${a(mandati)}`, alle, "è nella coda di Windows: controlla che sia uscita")
        : P("ok", `Etichetta stampata ${su(stampati)}`, alle);
      if (!mandati.length) return E("ok", `Stampato ${su(stampati)}`, alle, tel);
      return E("warn", `Mandato ${a(mandati)}`, alle, "è nella coda di Windows: controlla che sia uscito",
        stampati.length ? `stampato ${su(stampati)}` : "", tel);
    }
  }
}

// LA STAMPA SENZA DIALOGO: la fa il service worker, foglio per foglio, e ogni
// passo sta scritto nell'ordine (storage.session) PRIMA di farlo. Un foglio è
// «invio» (all'aiutante) prima che parta: se qui qualcosa muore, al riavvio
// quel foglio è «sconosciuto» — mai rimandato. Lo stesso motore per i fogli di
// un ordine in sottofondo e per quelli che chiede la scheda del medico
// (ordineFogli). La scheda dell'ordine dà solo i PDF (li prende lei, dalla
// pagina del gestionale, coi controlli di sempre); un consenso è un file
// nostro. Ricaricata, chiusa, o col ⏹: i fogli che restano non partono, e
// l'ordine finisce «Stampa interrotta → Ristampa».
const STAMPO_VIVI = new Set();   // gli ordini che QUESTO service worker sta stampando
const statoOrd = (l, id) => l.find((x) => x.id === id && x.stato === "stampo");
// i fogli di una stampa, ognuno con la stampante su cui andrà (se la stampa automatica è accesa)
const fogliNuovi = (jobs, s) => jobs.map((j) => {
  const tipo = j.printer === "etichettatrice" ? "etichette" : "a4";
  return { name: j.name, ...(j.breve ? { breve: j.breve } : {}), tipo, stato: "attesa", stampante: s ? corto(s[tipo], 80) : "", why: "", ...(s && s.stazione ? { stazione: true } : {}) };
});
// DOVE VANNO I FOGLI di un ordine: «qui» (questo PC: l'aiutante, o il dialogo)
// o «stazione» — la stazione di stampa collegata (stazione-sw.js): le
// stampanti dell'infermeria, attaccate a un altro PC. Si decide quando
// l'ordine nasce e non cambia più: un ordine per la stazione che non la trova
// dice «Infermeria non risponde», mai stampato qui da solo. `ricordata`: la
// scelta del medico («Stampa: PC · Infermeria», `stampa.dove`), che vale solo
// con una stazione collegata.
async function stampaDove(d) {
  const o = await chrome.storage.local.get(["stampa", "stazione.coppia"]);
  const c = o["stazione.coppia"], collegata = !!c && !c.revoca;
  const nome = corto((c && c.nome) || "Infermeria", 40);
  if (d === "stazione" || (d === "ricordata" && collegata && (o.stampa || {}).dove === "stazione")) return { dest: "stazione", destNome: nome };
  return { dest: "qui" };
}
// La stazione, chiesta QUANDO L'ORDINE NASCE: la stessa prova in sola lettura
// che stazioneStampa fa prima di mandare un foglio (una domanda «esito» su
// una sessione che non si sente da un po', poi una sessione nuova). Se tace,
// la striscia e il telefono lo dicono subito — «Infermeria non risponde:
// stampo qui?» — e decide il medico con un tocco (ordQui). Mai altrove da soli.
async function stazioneSonda() {
  if (typeof stmSessione !== "function" || typeof stmAttiva !== "function" || !stmAttiva()) return false;
  try {
    let s = await stmSessione();
    if (s && staOra() - stm.sentito <= STA_ATTESA.fresco) return true;
    if (s && await stmChiedi(s, { cmd: "esito", rq: "sondaviva" }, STA_ATTESA.vivo)) return true;
    if (s) stmFineSessione();
    s = await stmSessione();
    return !!s;
  } catch { return false; }
}
// «Stampa qui», per un ordine della stazione che non risponde: il tocco del
// medico, sul PC o sul telefono, è il consenso. Un ordine che non è ancora
// alle etichette cambia strada (da qui le stampa questo PC); uno le cui
// etichette la stazione non ha stampato le stampa qui, una volta, con lo
// stesso giro di «Stampa qui» sulla striscia del PC (ordDai: una scheda del
// gestionale le passa alla stampa automatica). Dal telefono solo con la stampa
// automatica: un dialogo su un PC che nessuno guarda non è una stampa.
async function ordQui(id, { daTel = false } = {}) {
  // (dal telefono prima di tutto la stampa automatica: anche un ordine che gira
  // cambierebbe strada verso un dialogo su un PC che nessuno guarda)
  if (daTel && !(await stampaScelte().catch(() => null))) return { ok: false, errore: "Sul PC la stampa automatica non è impostata" };
  const fatto = await inFilaOrd(async () => {
    const l = await ordLeggi();
    const rec = l.find((x) => x.id === id && x.dest === "stazione");
    if (!rec) return { ok: false, errore: "Ordine non trovato sul PC" };
    if (["coda", "avvio", "corre"].includes(rec.stato)) {
      rec.dest = "qui"; delete rec.destNome; delete rec.stazioneMuta; rec.agg = Date.now();
      await ordScrivi(l);
      return { ok: true, cambiata: true };
    }
    return { ok: false, rec };
  });
  if (fatto.ok || !fatto.rec) return fatto;
  const rec = fatto.rec;
  if (!rec.stampa || !["stampa", "avviso"].includes(rec.stato)) return { ok: false, errore: "Niente da stampare qui" };
  const f = Array.isArray(rec.fogli) ? rec.fogli : [];
  // (dal telefono mai un foglio «forse stampato»: chi tocca non vede il PC — lì si guarda, e si decide al PC)
  if (daTel && f.some((x) => x.stato === "sconosciuto")) return { ok: false, errore: "Forse già stampate: guarda lì, poi decidi dal PC" };
  if (daTel && !f.some((x) => x.stato === "fallito")) return { ok: false, errore: "Niente da stampare sul PC" };
  // In «stampa» (ordStampoFine) i fogli dell'ordine sono già solo quelli non
  // stampati: tutti, così come sono — `fogli` ha ancora l'elenco intero, e i
  // suoi indici non sono più quelli dei fogli. In «avviso» i fogli sono tutti:
  // quelli non usciti, come fa «Stampa qui» sulla striscia (ordineStampaQui).
  const non = rec.stato === "avviso" ? rec.stampa.jobs.filter((_, i) => f[i] && !usciti(f[i]) && f[i].stato !== "tolto") : [];
  const tutte = (await chrome.tabs.query({}).catch(() => [])).filter((t) => sulGestionale(t.url));
  for (const t of [...tutte.filter((x) => x.active), ...tutte.filter((x) => !x.active)]) {
    if (await ordDai(rec.id, t.id, true, non.length ? non : null, "qui")) return { ok: true };
  }
  return { ok: false, errore: tutte.length ? "Stampa non partita: riprova dal PC" : "Sul PC non c'è una pagina del gestionale aperta" };
}
// (l'ordine appena nato, diretto alla stazione: tace? lo si segna, e la striscia lo chiede)
async function sondaOrdine(id) {
  // (un altro ordine sta mandando fogli alla stazione: lei risponde a quello, e la sua sessione non si tocca)
  if ((await ordLeggi()).some((x) => x.stato === "stampo" && x.dest === "stazione")) return;
  if (await stazioneSonda()) return;
  await inFilaOrd(async () => {
    const l = await ordLeggi(), x = l.find((y) => y.id === id);
    if (!x || x.dest !== "stazione" || !["coda", "avvio", "corre"].includes(x.stato)) return;
    x.stazioneMuta = true; x.agg = Date.now();
    await ordScrivi(l);
  });
}
// le «scelte» della stampa per un ordine: quelle di questo PC, o la stazione
function stampaVerso(rec) {
  if (rec.dest !== "stazione") return stampaScelte();
  const nome = rec.destNome || "Infermeria";
  return Promise.resolve({ stazione: true, etichette: nome, a4: nome });
}
// il resoconto di una conferma (quanti esami, quando), per la scheda che stampa dal dialogo
const fineDi = (f) => ({ n: Number(f && f.n) || 0, ts: Number(f && f.ts) || Date.now(), quesito: (f && f.quesito) || null });
const pdfNostro = (u) => fetch(u).then((r) => r.arrayBuffer()).then((b) => ({ ok: true, pdf: b64(b) }))
  .catch((e) => ({ ok: false, why: corto(e && e.message || e, 80) }));
// Un referto salvato (la «Stampa» del visore): la copia su questo computer,
// solo per l'episodio sotto cui è stata salvata — come getRef.
const REF_STAMPA = /^psassist-ref:([\w-]{1,80})\?ep=(\d{0,20})$/;
const pdfSalvato = async (u) => {
  const m = REF_STAMPA.exec(String(u));
  if (!m) return { ok: false, why: "indirizzo non valido" };
  const hit = (await chrome.storage.local.get(KEY(m[1])))[KEY(m[1])];
  if (!hit || String(hit.ep || "") !== m[2] || Date.now() - (hit.ts || 0) > REF_TTL || typeof hit.data !== "string") return { ok: false, why: "la copia non è più su questo computer" };
  return { ok: true, pdf: hit.data };
};
// Un PDF dall'iPhone (ponte-sw.js, ⋯ → «Stampa PDF»): sull'A4, con questo
// motore e questo giornale — una richiesta, una stampa: rimandata, non si
// ristampa. Il PDF sta solo qui in memoria finché il foglio non è partito,
// poi via (dopo un riavvio del service worker non c'è più: il foglio non
// parte, mai due volte). Mai un dialogo: senza la stampa automatica, no.
const PDF_TEL = new Map();   // id → il PDF, in base64
const PDF_TEL_URL = /^psassist-tel:(pdftel[\w-]{8,24})$/;
const pdfTelId = (rid) => "pdftel" + rid;
const daTelPdf = (rec) => String(rec.id).startsWith("pdftel");
const pdfDalTel = (u) => { const b = PDF_TEL.get(PDF_TEL_URL.exec(u)[1]); return b ? { ok: true, pdf: b } : { ok: false, why: "non è più in memoria" }; };
const stampaTelVista = async (rid) => ((await chrome.storage.session.get(ORD_VISTI))[ORD_VISTI] || []).includes(pdfTelId(rid));
function stampaDalTel(rid, pdf, dest = "qui", nome = "PDF dall'iPhone") {
  return inFilaOrd(async () => {
    const id = pdfTelId(rid);
    const visti = (await chrome.storage.session.get(ORD_VISTI))[ORD_VISTI] || [];
    if (visti.includes(id)) return { ok: true, id, gia: true };
    // (PS Assist si sta aggiornando: la ricarica svuota la memoria — il foglio non parte, e lo si dice)
    if (typeof aggScambio !== "undefined" && aggScambio) return { ok: false, why: "PS Assist si sta aggiornando: riprova fra un minuto" };
    // dove: questo PC (la sua stampa automatica) o la stazione di stampa collegata
    // (Infermeria) — le stesse scelte di un ordine (stampaDove/stampaVerso)
    const verso = dest === "stazione" ? await stampaDove("stazione") : { dest: "qui" };
    const auto = await stampaVerso(verso);
    if (!auto) return { ok: false, why: "Sul PC la stampa automatica non è impostata" };
    // (vista PRIMA di esistere: se qui qualcosa muore, rimandata non stampa)
    await chrome.storage.session.set({ [ORD_VISTI]: [...visti, id].slice(-100) });
    const jobs = [{ name: nome, printer: "a4", url: "psassist-tel:" + id, diretto: true }];
    const l = await ordLeggi();
    l.push({ id, ep: "", paziente: nome, n: 0, url: null, opener: null, worker: null, stato: "stampo", pronta: true, ts: Date.now(), agg: Date.now(),
      ...(verso.dest === "stazione" ? { dest: "stazione", destNome: verso.destNome } : {}),
      vista: null, resto: { mancano: [], controllare: [], nel: [] }, stampa: { jobs, tag: "Stampa", fine: null, riassunto: "", quesito: "" }, fogli: fogliNuovi(jobs, auto) });
    PDF_TEL.set(id, pdf);
    await ordScrivi(l);
    ordStampaFogli(id);
    return { ok: true, id };
  });
}
// Due corsie, una per stampante: le etichette all'etichettatrice, tutto il
// resto (liste, prenotazioni RX) all'A4. I PDF delle due si prendono insieme,
// e ogni foglio parte appena c'è — le due stampanti lavorano insieme —;
// dentro una corsia, nell'ordine di sempre. Un PDF preso in parallelo che non
// arriva (un errore, la pagina d'accesso, niente) si riprende UNA volta, da
// solo, quando l'altra corsia ha finito — e si annota (segnaErrore): il
// gestionale vero dirà se due letture insieme gli vanno bene.
// Il giornale, foglio per foglio: «attesa» → «prendo» (il PDF) → «invio»
// (scritto PRIMA di darlo all'aiutante) → com'è andata; «tolto» col suo ✕.
async function ordStampaFogli(id) {
  if (STAMPO_VIVI.has(id)) return;
  STAMPO_VIVI.add(id);
  let copia = null;      // l'etichetta anagrafica: il PDF della prima copia, per le altre
  let attende = false;   // …che aspetta le etichette di un ordine che stampa: la riprende ordStampoFine
  let copie = false;     // …×N, e l'aiutante sa farle in un lavoro solo (dalla 4)
  try {
    // 0. com'è rimasto: quello che un service worker di prima stava mandando
    //    non si sa com'è andato (mai rimandato); quello che prendeva, si riprende
    const tipi = await inFilaOrd(async () => {
      const l = await ordLeggi();
      const rec = statoOrd(l, id);
      if (!rec) return null;
      // la scheda dei PDF non c'è ancora: si comincia quando dice «ci sono» (ordineChi)
      if (rec.pronta === false && !rec.ferma && !rec.interrotta) return null;
      let cambiato = false;
      // (il giornale di prima: un foglio solo «in volo», segnato «mandato»)
      if (rec.inVolo != null) {
        const f = rec.fogli[rec.inVolo];
        if (f && f.stato === "mandato") f.stato = "invio";
        delete rec.inVolo; cambiato = true;
      }
      for (const f of rec.fogli) {
        if (f.stato === "invio") { Object.assign(f, { stato: "sconosciuto", why: "la risposta dell'aiutante si è persa" }); cambiato = true; }
        else if (f.stato === "prendo") { f.stato = "attesa"; cambiato = true; }
      }
      if (cambiato) await ordScrivi(l);
      copie = soloBracciale(rec) && rec.fogli.filter((f) => f.stato === "attesa").length > 1;
      return [...new Set(rec.fogli.filter((f) => f.stato === "attesa").map((f) => f.tipo))];
    });
    if (!tipi) return;
    // (la stazione le copie le chiede al suo aiutante, e dice quante ne ha fatte)
    if (copie) copie = (await inFilaOrd(async () => (statoOrd(await ordLeggi(), id) || {}).dest)) === "stazione" || await aiutanteCopie();
    const corsie = new Map(tipi.map((t) => [t, { finita: false, aspetta: false, fatto: null }]));
    const prendi = (passo) => (passo.diretto ? (REF_STAMPA.test(passo.url) ? pdfSalvato(passo.url) : PDF_TEL_URL.test(passo.url) ? pdfDalTel(passo.url) : pdfNostro(passo.url))
      : allaScheda(passo.worker, { t: "psassistPdf", id, url: passo.url }, 30e3));
    const corsia = async (tipo) => {
      const io = corsie.get(tipo);
      const altra = ([...corsie].find(([t]) => t !== tipo) || [])[1] || null;
      let finoA = 0;   // l'attesa del motore, come dopoIlMotore: al più 4 minuti
      for (;;) {
        // 1. il prossimo foglio di questa corsia (o niente: la corsia ha finito)
        const passo = await inFilaOrd(async () => {
          const l = await ordLeggi();
          const rec = statoOrd(l, id);
          if (!rec || rec.ferma || rec.interrotta) return null;
          const i = rec.fogli.findIndex((f) => f.stato === "attesa" && f.tipo === tipo);
          if (i < 0) return null;
          if (soloBracciale(rec) && etichetteInCorso(l, rec)) { attende = true; return null; }
          const job = rec.stampa.jobs[i] || {};
          // un motore sta inserendo esami: il PDF (una pagina del gestionale) aspetta che finisca
          if (!job.diretto && motoreAlLavoro(l, rec) && !(finoA && Date.now() > finoA)) return { aspetta: true };
          const senza = !job.diretto && rec.worker == null;   // nessuno che dia il PDF
          const s = senza ? null : await stampaVerso(rec);
          if (!s) {
            rec.interrotta = senza ? "la scheda dell'ordine si è chiusa" : "stampa automatica spenta";
            await ordScrivi(l);
            return null;
          }
          // (l'etichetta anagrafica ×N con un aiutante che sa fare le copie: tutte
          // quelle che aspettano, un foglio all'aiutante con «copie: N»)
          const is = copie && soloBracciale(rec) ? rec.fogli.map((_, k) => k).filter((k) => rec.fogli[k].stato === "attesa" && (rec.stampa.jobs[k] || {}).url === job.url) : [i];
          for (const k of is) rec.fogli[k].stato = "prendo";
          rec.agg = Date.now();
          await ordScrivi(l);
          return { i, is, url: job.url, diretto: !!job.diretto, worker: rec.worker, tipo, stampante: s[tipo], ruota: ruotaDi(s), bracciale: soloBracciale(rec),
            stazione: !!s.stazione, rq: `${id}-${i}`.slice(-48) };
        });
        if (!passo) return;
        if (passo.aspetta) { finoA = finoA || Date.now() + DOPO_MOTORE_MAX; await new Promise((r) => setTimeout(r, 1000)); continue; }
        // 2. il PDF (dalla scheda dell'ordine; un consenso, dall'estensione)
        const insieme = !!altra && !altra.finita && !altra.aspetta;
        const pdf = passo.bracciale && copia && copia.url === passo.url ? copia.pdf : await prendi(passo);
        const manca = !pdf || !pdf.ok || typeof pdf.pdf !== "string";
        if (passo.bracciale && !manca) copia = { url: passo.url, pdf };
        if (manca && insieme) {
          // preso insieme all'altro e non arrivato: lo si riprende da solo, una volta
          segnaErrore("stampa-parallela", { ordine: id, foglio: passo.i, tipo, motivo: corto(pdf ? pdf.why : "nessuna risposta dalla scheda", 120) });
          await inFilaOrd(async () => {
            const l = await ordLeggi();
            const rec = statoOrd(l, id);
            const fs = rec ? passo.is.map((k) => rec.fogli[k]).filter((f) => f && f.stato === "prendo") : [];
            for (const f of fs) f.stato = "attesa";
            if (fs.length) await ordScrivi(l);
          });
          if (!altra.finita && !altra.aspetta) { io.aspetta = true; await altra.fatto; io.aspetta = false; }
          continue;
        }
        // 3. il foglio segnato «invio» prima di mandarlo (tolto col suo ✕ intanto: non parte;
        //    le copie in un lavoro solo, tutte insieme: quelle che restano)
        const va = await inFilaOrd(async () => {
          const l = await ordLeggi();
          const rec = statoOrd(l, id);
          const ks = rec ? passo.is.filter((k) => (rec.fogli[k] || {}).stato === "prendo") : [];
          if (!ks.length) return null;
          const fs = ks.map((k) => rec.fogli[k]), metti = (o) => { for (const f of fs) Object.assign(f, o); };
          // ⏹ o scheda persa mentre il PDF arrivava: finisce solo il foglio già alla stampante
          if (rec.ferma || rec.interrotta) { metti({ stato: "attesa" }); await ordScrivi(l); return null; }
          if (!pdf) { metti({ stato: "attesa" }); rec.interrotta = rec.interrotta || "la scheda dell'ordine non ha dato il foglio"; }
          else if (manca) {
            metti({ stato: "fallito", why: `il PDF non è arrivato (${corto(pdf.why, 80)})` });
            segnaErrore("stampa", { ordine: id, foglio: passo.i, esito: "fallito", motivo: fs[0].why });
          }
          else if (pdf.pdf.length > STAMPA_PDF_MAX / 3 * 4 + 4) metti({ stato: "fallito", why: "PDF troppo grande" });
          else metti({ stato: "invio", stampante: corto(passo.stampante, 80), ...(ks.length > 1 ? { copie: ks.length } : {}) });
          rec.agg = Date.now(); metti({ ts: Date.now() });
          await ordScrivi(l);
          await ordAvanti(l);   // i PDF presi: il prossimo motore può partire
          return fs[0].stato === "invio" ? ks : null;
        });
        if (!va) continue;
        // 4. all'aiutante (fino a 90 secondi: lui finisce in 40), poi com'è andata — un esito per tutte le copie
        // (o alla stazione di stampa, che lo stampa sulle sue e dice com'è andata: lo stesso esito)
        const r = passo.stazione ? (typeof stazioneStampa === "function" ? await stazioneStampa(passo.tipo, pdf.pdf, va.length, passo.rq)
          : { ok: false, esito: "fallito", stampante: passo.stampante, why: `${passo.stampante} non risponde`, nonRisponde: true, copie: 1 })
          : await stampaPdf(passo.tipo, pdf.pdf, passo.stampante, passo.ruota, va.length);
        if (r.esito !== "stampato" && r.esito !== "mandato") segnaErrore("stampa", { ordine: id, foglio: passo.i, tipo: passo.tipo, esito: r.esito, motivo: r.why || "",
          ...(passo.bracciale ? { bracciale: true } : {}), ...(va.length > 1 ? { copie: va.length } : {}) });
        await inFilaOrd(async () => {
          const l = await ordLeggi();
          const rec = statoOrd(l, id);
          let fs = rec ? va.map((k) => rec.fogli[k]).filter((f) => f && f.stato === "invio") : [];
          if (!fs.length) return;
          // (un aiutante di prima, che delle copie non sa niente: ne ha stampata una, e
          // lo dice non ridicendole. Le altre tornano ad aspettare, e partono una a una)
          if (fs.length > 1 && r.ok && r.copie !== fs.length) {
            copie = false;
            for (const f of fs) delete f.copie;
            for (const f of fs.slice(1)) f.stato = "attesa";
            fs = fs.slice(0, 1);
          }
          for (const f of fs) Object.assign(f, { stato: r.esito, stampante: corto(r.stampante, 80), why: r.why || "", ts: Date.now(), ...(r.nonRisponde ? { nonRisponde: true } : {}) });
          // (una copia dell'etichetta anagrafica non è partita: le altre non ci riprovano, vanno col dialogo)
          if (passo.bracciale && r.esito === "fallito") for (const x of rec.fogli) if (x.stato === "attesa") Object.assign(x, { stato: "fallito", why: r.why || "" });
          rec.agg = Date.now();
          await ordScrivi(l);
        });
      }
    };
    for (const [t, c] of corsie) c.fatto = corsia(t).finally(() => { c.finita = true; });
    await Promise.all([...corsie.values()].map((c) => c.fatto));
    if (attende) return;
    // 5. la fine, quando tutte e due hanno finito
    await inFilaOrd(async () => {
      const l = await ordLeggi();
      const rec = statoOrd(l, id);
      if (!rec) return;
      if (rec.ferma && !rec.interrotta && rec.fogli.some((f) => f.stato === "attesa")) rec.interrotta = "fermata col ⏹";
      await ordStampoFine(l, rec);
    });
  } finally { STAMPO_VIVI.delete(id); PDF_TEL.delete(id); }
}
// Finita la stampa. Un foglio che non è partito per un motivo detto
// (stampante spenta o sparita, PDF che non arriva) passa dal dialogo di
// sempre, lui solo: nella scheda dove sta il medico, o — un ordine dal
// telefono — quando qualcuno al PC tocca «Stampa». Tutto il resto finisce qui,
// con «Ristampa»: anche un esito sconosciuto, che non si ristampa da solo.
async function ordStampoFine(l, rec) {
  rec.agg = Date.now();
  delete rec.inVolo;
  let rotti = rec.stampa.jobs.map((j, i) => ({ ...j, motivo: rec.fogli[i].why })).filter((_, i) => rec.fogli[i].stato === "fallito");
  // (le copie dell'etichetta anagrafica: al dialogo una volta, con quante erano)
  if (soloBracciale(rec) && rotti.length > 1) rotti = [{ ...rotti[0], name: "Etichetta anagrafica", motivo: `${rotti[0].motivo}; ${rotti.length} copie` }];
  // (la stazione: qui si stampano con la stampa di questo PC — l'aiutante, o il dialogo —, mai da soli)
  if (rec.dest === "stazione") rotti = rotti.map(({ motivo, ...j }) => j);
  if (rotti.length && !rec.interrotta && !daTelPdf(rec)) { rec.stato = "stampa"; rec.stampa = { ...rec.stampa, jobs: rotti }; }
  else rec.stato = "avviso";
  // (il PDF dall'iPhone non c'è più: niente dialogo, niente «Ristampa»)
  if (daTelPdf(rec)) rec.stampa = null;
  delete rec.ferma;
  await ordSlega(rec);
  await ordScrivi(l);
  // un'etichetta anagrafica che aspettava queste etichette: ora tocca a lei
  for (const x of l) if (x !== rec && x.stato === "stampo" && soloBracciale(x) && !STAMPO_VIVI.has(x.id)) ordStampaFogli(x.id);
  await ordAvanti(l);
  ordStampaOra();
}

// il medico è su un'altra scheda, in un'altra finestra, o su una pagina appena
// caricata: le etichette in attesa vanno lì
const ordStampaOra = () => { ordConsegnaStampa().catch(() => {}); };
const CONTROLLO_OGNI = 3000;
const CONTROLLO = { ts: 0, inFila: false };
chrome.tabs.onActivated.addListener(ordStampaOra);
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (info.status === "complete" && tab && tab.active && sulGestionale(tab.url)) ordStampaOra();
});
chrome.windows?.onFocusChanged?.addListener(ordStampaOra);

// (con un nome: i test lo chiamano due volte con la stessa domanda)
function ordMessaggio(msg, sender, reply) {
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string" || !msg.t.startsWith("ordin")) return;
  const tab = sender && sender.tab;
  const daGestionale = !!tab && sulGestionale(sender.url);
  if (!daGestionale) return reply({ ok: false, no: true, why: "non dal gestionale" }), true;
  const fai = (fn) => { inFilaOrd(fn).catch((e) => reply({ ok: false, why: corto(e && e.message || e, 80) })); return true; };
  const faiDopoIlMotore = (fn) => { dopoIlMotore().then(() => fai(fn)); return true; };
  // la scheda di un ordine che gira: solo lei parla per lui
  const suo = (l) => l.find((x) => x.id === msg.id && x.worker === tab.id && ATTIVI.has(x.stato));

  // Un ordine nuovo, dalla scheda del medico. La stessa domanda due volte (la
  // prima risposta si è persa e la scheda la rimanda) è lo stesso ordine:
  // parte una volta sola.
  if (msg.t === "ordineNuovo") return fai(async () => {
    const j = msg.job || {};
    const id = corto(j.id, 40);
    let ep = "";
    try { ep = new URL(j.url).searchParams.get("EPISODIO_ID") || ""; } catch { /* sotto */ }
    if (!id || !leggibileOrd(j.url) || !ep || ep !== String(j.ep || "") || !j.piano || typeof j.piano !== "object") {
      return reply({ ok: false, no: true, why: "pagina di partenza inattesa" });
    }
    const l = await ordLeggi();
    const visti = (await chrome.storage.session.get(ORD_VISTI))[ORD_VISTI] || [];
    if (visti.includes(id)) return reply({ ok: true, id, ordini: l });
    // PS Assist si sta aggiornando (lo scambio è deciso, la ricarica arriva: aggiorna.js): scritto
    // adesso in storage.session, l'ordine sparirebbe con la ricarica senza dirlo. Non parte, e lo si dice.
    if (typeof aggScambio !== "undefined" && aggScambio) return reply({ ok: false, no: true, aggiorna: true, why: "PS Assist si sta aggiornando: riprova fra un minuto" });
    const rec = {
      id, ep, paziente: corto(j.paziente, 60), n: Number(j.n) || 0, autoConfirm: !!j.autoConfirm, url: j.url,
      // laboratorio o radiologia: la riga «Rich Lab · 3/6», «Rich RX · 1/1» sotto la striscia
      kind: j.piano.kind === "radio" ? "radio" : j.piano.kind === "lab" ? "lab" : "",
      rid: j.rid ? corto(j.rid, 20) : null, opener: tab.id, worker: null,
      // (lo stesso tocco su Conferma: una richiesta per erogatore, un esito e una Ristampa — gestoDi, content)
      gesto: j.gesto ? corto(j.gesto, 40) : id,
      // (quali esami, in breve: la carta del telefono li nomina)
      nomi: nomi(j.nomi),
      // (il quesito scritto sul telefono: lo dice ordPubblico al posto di «il tuo»)
      quesito: id.startsWith("tel") ? corto(String(j.piano.quesito || "").replace(/\s+/g, " ").trim(), 90) : "",
      stato: "coda", ts: Date.now(), agg: Date.now(), vista: null,
      resto: { mancano: nomi(j.nomi), controllare: [], nel: [] },
      // (dove vanno i fogli: la scelta del medico, o quella del telefono per questo ordine)
      ...(await stampaDove(j.dest === "qui" || j.dest === "stazione" ? j.dest : "ricordata")),
    };
    await chrome.storage.session.set({ [ORD_PIANO(id)]: j.piano, [ORD_VISTI]: [...visti, id].slice(-100) });
    l.push(rec);
    // (per la stazione: le si chiede subito se c'è — fuori dalla fila, una domanda in sola lettura)
    if (rec.dest === "stazione") setTimeout(() => { sondaOrdine(id).catch(() => {}); }, 0);
    if (await ordAspetta(l)) {
      await ordScrivi(l);
      return reply({ ok: true, id, coda: true, ordini: l });
    }
    try { await ordApri(rec, l); }
    catch (e) {
      // la scheda non si apre: l'ordine lo manda la pagina del medico, come sempre
      await togli(l, rec);
      await ordScrivi(l);
      await chrome.storage.session.set({ [ORD_VISTI]: visti });
      return reply({ ok: false, no: true, why: "la scheda di sottofondo non si apre: " + corto(e && e.message || e, 60) });
    }
    reply({ ok: true, id, ordini: l });
  });
  // «chi sono?»: la scheda di sottofondo di un ordine che gira, o una scheda qualunque
  if (msg.t === "ordineChi") return fai(async () => {
    const l = await ordLeggi();
    // la scheda aperta per dare i PDF di una stampa (ordineFogli), appena
    // nata: niente pannello, e si comincia (la prossima volta è una ricarica)
    const nata = l.find((x) => x.worker === tab.id && x.stato === "stampo" && x.pronta === false);
    if (nata) {
      nata.pronta = true; nata.agg = Date.now();
      await ordScrivi(l);
      reply({ ok: true, ordini: l, fogli: true, scheda: tab.id });
      return void ordStampaFogli(nata.id);
    }
    // la scheda di un ordine che sta stampando è ripartita (ricaricata, un'altra
    // pagina): i fogli che restano non li dà più nessuno
    const ricarica = l.find((x) => x.worker === tab.id && x.stato === "stampo" && !x.interrotta);
    if (ricarica) { ricarica.interrotta = "la scheda dell'ordine si è ricaricata"; await ordScrivi(l); }
    const mio = l.find((x) => x.worker === tab.id && ATTIVI.has(x.stato) && (x.consegnata == null || x.consegnata === tab.id));
    // (o la scheda che il ponte ha aperto per i valori di un paziente: ponte-sw.js)
    if (!mio) return reply({ ok: true, ordini: l, scheda: tab.id, ...(typeof ponteLavoroDi === "function" ? await ponteLavoroDi(tab.id) : {}) });
    // il piano va a questa scheda e a nessun'altra, per tutta la vita
    // dell'ordine (le sue pagine dopo — la ripresa, il carrello della conferma — sì)
    if (mio.consegnata == null) { mio.consegnata = tab.id; await ordScrivi(l); }
    const piano = (await chrome.storage.session.get(ORD_PIANO(mio.id)))[ORD_PIANO(mio.id)] || null;
    reply({ ok: true, ordini: l, scheda: tab.id, lavoro: { ...mio, piano } });
  });
  // la scheda di sottofondo parte: una volta sola, anche se si ricarica
  if (msg.t === "ordineParto") return fai(async () => {
    const l = await ordLeggi();
    const rec = suo(l);
    if (!rec || rec.stato !== "avvio") return reply({ ok: false });
    rec.stato = "corre"; rec.agg = Date.now();
    await ordScrivi(l);
    reply({ ok: true });
  });
  // A che punto è (solo dalla sua scheda). L'ultima parola — un errore, un
  // fermo, un avviso col carrello da aprire — slega la scheda. La risposta
  // porta il ⏹ che la scheda non ha ricevuto direttamente.
  if (msg.t === "ordineAggiorna") return fai(async () => {
    const l = await ordLeggi();
    const rec = suo(l);
    if (!rec) return reply({ ok: false });
    if (["corre", "errore", "interrotto", "avviso"].includes(msg.stato)) rec.stato = msg.stato;
    if (msg.vista && typeof msg.vista === "object") {
      const v = msg.vista;
      rec.vista = { tag: corto(v.tag, 60), badge: corto(v.badge, 30), testo: corto(v.testo), tono: corto(v.tono, 6),
        // (`quesito`: la riga sotto — che cosa manca, il perché)
        quesito: corto(v.quesito, 200), ferma: !!v.ferma, sessione: !!v.sessione,
        // («Non partita»: il gestionale non ha preso la Conferma — si può rifarla, un tocco: ordineRiconferma;
        // `premuta`: quando era partita quella che il carrello ha smentito)
        ...(v.riconferma ? { riconferma: true, premuta: Number(v.premuta) || 0 } : {}),
        // (quanti esami sono passati, su quanti: la riga «Richiesta · 3/6» sotto la striscia)
        ...(Array.isArray(v.prog) && v.prog.length === 2 ? { prog: v.prog.map((x) => Math.max(0, Math.min(99, Number(x) || 0))) } : {}) };
    }
    if (msg.resto && typeof msg.resto === "object") {
      rec.resto = { mancano: nomi(msg.resto.mancano), controllare: nomi(msg.resto.controllare), nel: nomi(msg.resto.nel) };
    }
    if (msg.rid) rec.rid = corto(msg.rid, 20);
    // l'area su cui la scheda dell'ordine ha passato il gestionale prima di partire: la dice l'esito
    if (typeof msg.area === "string" && msg.area.trim()) rec.area = corto(msg.area.trim(), 40);
    if (msg.listUrl && leggibileOrd(msg.listUrl)) rec.listUrl = msg.listUrl;
    // il passaggio di consegne per le schede del medico: il carrello da aprire
    // (un indirizzo da leggere, mai un invio) e quello che la pagina deve dire
    if (msg.consegna && typeof msg.consegna === "object" && leggibileOrd(msg.consegna.url)) {
      const s = JSON.stringify(msg.consegna);
      if (s.length < 60000) rec.consegna = JSON.parse(s);
    }
    registroDi(rec, msg);
    // (un'altra Conferma per la sua richiesta è già arrivata qui, dopo quella smentita: niente «Conferma di nuovo»)
    if (rec.vista && rec.vista.riconferma && premutaDopo(await premute(), ridDi(rec), rec.vista.premuta)) premutaAltrove(rec);
    rec.agg = Date.now(); delete rec.muto;
    if (!ATTIVI.has(rec.stato)) await ordSlega(rec);
    await ordScrivi(l);
    reply({ ok: true, ferma: !!rec.ferma && ATTIVI.has(rec.stato) });
    await ordAvanti(l);
  });
  // Una Conferma premuta, da qualunque scheda del gestionale (annotata prima
  // del clic): si tiene l'ora, e un «Conferma di nuovo» della stessa richiesta
  // che aspettava un tocco non vale più — quella Conferma è la volta in più
  // (ORD_RICONF): da controllare, e il bottone se ne va, ovunque.
  if (msg.t === "ordinePremuta") return fai(async () => {
    const rid = corto(msg.rid, 20), t = Number(msg.ts) || Date.now();
    if (!rid) return reply({ ok: false });
    const prima = (await premute()).filter((x) => x.rid !== rid);
    await chrome.storage.session.set({ [ORD_PREMUTE]: [...prima, { rid, t }].slice(-50) });
    const l = await ordLeggi();
    const vecchie = l.filter((x) => x.vista && x.vista.riconferma && ridDi(x) === rid && t > (Number(x.vista.premuta) || 0));
    if (!vecchie.length) return reply({ ok: true });
    vecchie.forEach(premutaAltrove);
    const fatte = (await chrome.storage.session.get(ORD_RICONF))[ORD_RICONF] || [];
    if (!fatte.includes(rid)) await chrome.storage.session.set({ [ORD_RICONF]: [...fatte, rid].slice(-50) });
    await ordScrivi(l);
    reply({ ok: true, ordini: l });
  });
  // «Conferma di nuovo»: la Conferma che il gestionale non ha preso (il suo
  // carrello l'aveva ancora, col suo bottone), rifatta solo al tocco del
  // medico e UNA volta per richiesta — segnata prima di partire, così anche un
  // service worker che muore qui non la rifà. È un ordine come gli altri, in
  // coda e un motore alla volta: la sua scheda apre il carrello di quella
  // richiesta (l'indirizzo che la scheda dell'ordine ha consegnato, da
  // leggere) e lì preme la Conferma vera coi controlli di sempre
  // (riconfermaLavoro). Lo stesso tocco due volte: una.
  if (msg.t === "ordineRiconferma") return fai(async () => {
    const l = await ordLeggi();
    // (PS Assist si sta aggiornando: la ricarica svuota storage.session — non parte, e il bottone resta)
    if (typeof aggScambio !== "undefined" && aggScambio) return reply({ ok: false, aggiorna: true, why: "PS Assist si sta aggiornando: riprova fra un minuto", ordini: l });
    const rec = l.find((x) => x.id === msg.id && FINALI.has(x.stato) && x.vista && x.vista.riconferma);
    if (!rec) return reply({ ok: false, ordini: l });
    const fatte = (await chrome.storage.session.get(ORD_RICONF))[ORD_RICONF] || [];
    const c = rec.consegna || {}, rc = c.receipt || {};
    let rid = "";
    try { rid = new URL(c.url).searchParams.get("RICHIESTA_ID") || ""; } catch { rid = ""; }
    // (un'altra Conferma per questa richiesta, premuta dopo quella che il carrello ha smentito — forse in volo: niente)
    const premuta = Number(rec.vista.premuta) || 0;
    if (premutaDopo(await premute(), rid, premuta)) { premutaAltrove(rec); await ordScrivi(l); return reply({ ok: false, ordini: l }); }
    const ok = !!rid && leggibileOrd(c.url) && String(rc.richiestaId || "") === rid && Array.isArray(rc.items) && rc.items.length > 0
      && rc.items.length <= 60 && !fatte.includes(rid) && (!rec.rid || String(rec.rid) === rid);
    // (già rifatta, o senza il carrello da aprire: niente — e il bottone se ne va)
    delete rec.vista.riconferma;
    if (!ok) rec.vista.testo = "apri il carrello";
    rec.agg = Date.now();
    if (!ok) { await ordScrivi(l); return reply({ ok: false, ordini: l }); }
    await chrome.storage.session.set({ [ORD_RICONF]: [...fatte, rid].slice(-50) });
    const id = corto(rec.id, 36) + "c";
    let paz = "";
    try { paz = new URL(rec.url).searchParams.get("MVPG") === "PsoEpisodioClinicoAmbulatorio" && leggibileOrd(rec.url) ? rec.url : ""; } catch { paz = ""; }
    const piano = { startPage: "riconferma", richiestaId: rid, episodeId: rec.ep, patientName: rec.paziente || "", patientUrl: paz,
      listUrl: c.url, receipt: rc, items: rc.items, kind: rec.kind || "", premuta };
    const nuovo = { id, ep: rec.ep, paziente: rec.paziente, n: rc.items.length, autoConfirm: true, url: c.url, kind: rec.kind || "", rid, riconfermata: true,
      listUrl: c.url, opener: tab.id, worker: null, quesito: rec.quesito || "", stato: "coda", ts: Date.now(), agg: Date.now(), vista: null,
      resto: { mancano: [], controllare: [], nel: nomi(rc.items.map((i) => i.display || i.label)) }, dest: rec.dest || "qui",
      ...(rec.destNome ? { destNome: rec.destNome } : {}), ...(rec.gesto ? { gesto: rec.gesto } : {}) };
    await chrome.storage.session.set({ [ORD_PIANO(id)]: piano });
    // l'avviso di prima ha detto la sua: al suo posto, questa
    await togli(l, rec);
    l.push(nuovo);
    if (await ordAspetta(l)) { await ordScrivi(l); return reply({ ok: true, id, coda: true, ordini: l }); }
    try { await ordApri(nuovo, l); }
    catch {
      nuovo.stato = "errore"; nuovo.agg = Date.now(); nuovo.worker = null;
      nuovo.vista = { tag: "Non partita", testo: "apri il carrello", tono: "err", quesito: "la scheda per la Conferma non si è aperta: niente premuto" };
      nuovo.consegna = c;
      await ordScrivi(l);
    }
    reply({ ok: true, id, ordini: l });
  });
  // I fogli della richiesta confermata (la conferma è provata), solo da un
  // ordine che gira: i link letti dalla pagina, mai costruiti. Con la stampa
  // automatica li stampa il service worker (ordStampaFogli), senza dialogo e
  // senza nessuno davanti; se no — o per un foglio che non parte — li stampa
  // la scheda dove sta il medico. La scheda dell'ordine resta legata finché i
  // PDF servono (li prende lei); poi si slega e si chiude. La stessa consegna
  // due volte (la prima risposta si è persa, e la scheda la rimanda) è un sì:
  // un no, e la scheda dell'ordine li stamperebbe lei, una seconda volta.
  if (msg.t === "ordineStampa") return fai(async () => {
    const l = await ordLeggi();
    const presi = (await chrome.storage.session.get(ORD_FOGLI))[ORD_FOGLI] || [];
    if (presi.includes(msg.id)) return reply({ ok: true, gia: true });
    const rec = suo(l);
    if (!rec || rec.stato !== "corre") return reply({ ok: false });
    const jobs = (Array.isArray(msg.jobs) ? msg.jobs : []).slice(0, 12)
      .filter((j) => j && sulGestionale(j.url) && typeof j.name === "string")
      .map((j) => ({ name: corto(j.name, 60), printer: corto(j.printer, 30), url: String(j.url), ...(j.breve ? { breve: corto(j.breve, 12) } : {}) }));
    if (!jobs.length) return reply({ ok: false });
    const auto = await stampaVerso(rec);
    rec.stampa = { jobs, fine: fineDi(msg.fine), riassunto: corto(msg.riassunto, 80), quesito: corto(msg.quesito, 90) };
    registroDi(rec, msg);
    rec.fogli = fogliNuovi(jobs, auto);
    rec.agg = Date.now();
    rec.confermata = Date.now();   // (la conferma è provata: la riga della richiesta diventa verde)
    await chrome.storage.session.set({ [ORD_FOGLI]: [...presi, rec.id].slice(-100) });
    rec.stato = auto ? "stampo" : "stampa";
    if (!auto) await ordSlega(rec);
    // (col dialogo: prima che parta il prossimo ordine, le etichette a una scheda del medico — PRESE)
    if (!auto && !dalTelefono(rec) && rec.dest !== "stazione") rec.daDare = Date.now();
    await ordScrivi(l);
    reply({ ok: true, stampo: !!auto });
    if (auto) ordStampaFogli(rec.id);
    await ordAvanti(l);
    ordStampaOra();
  });
  // «Stampa qui» sulla striscia di un ordine che sta ancora andando, per la
  // stazione che non risponde: il tocco del medico (ordQui; fuori dalla fila,
  // che ordQui prende da sé)
  if (msg.t === "ordineQui") {
    ordQui(corto(msg.id, 60)).then((r) => reply(r), () => reply({ ok: false }));
    return true;
  }
  // La scheda col dialogo ha tutti i PDF delle etichette che ha preso (o ha
  // rinunciato): il prossimo ordine può partire.
  if (msg.t === "ordinePresi") return fai(async () => {
    PRESE.delete(corto(msg.id, 60));
    reply({ ok: true });
    await ordAvanti(await ordLeggi());
  });
  // Una stampa chiesta dalla scheda del medico — dopo una conferma,
  // «Ristampa», «Stampa l'ultima richiesta», un consenso —, con la stampa
  // automatica accesa: la fa lo stesso motore (ordStampaFogli), con le stesse
  // parole, e niente davanti al medico. I PDF li dà una scheda aperta qui
  // dietro sulla pagina del paziente (`url`, solo da leggere: niente
  // pannello, poi si chiude), così il medico può andare dove vuole subito.
  // Non coda: una stampa non aspetta un ordine che gira. La stessa domanda due
  // volte (la risposta persa) è una stampa sola. Spenta, o la scheda che non
  // si apre: no, e la pagina usa il dialogo di sempre.
  // (la scheda dei PDF è una pagina del gestionale: si apre dopo il motore,
  // aspettato FUORI dalla fila; i fogli nostri non aspettano niente)
  // un file nostro: un consenso, o la copia di un referto salvato
  const nostro = (u) => String(u).startsWith(chrome.runtime.getURL("consensi/")) || REF_STAMPA.test(String(u));
  if (msg.t === "ordineFogli") return ((msg.job && Array.isArray(msg.job.jobs) ? msg.job.jobs : []).every((x) => x && nostro(x.url)) ? fai : faiDopoIlMotore)(async () => {
    const j = msg.job || {};
    const id = corto(j.id, 40);
    const visti = (await chrome.storage.session.get(ORD_VISTI))[ORD_VISTI] || [];
    if (id && visti.includes(id)) return reply({ ok: true, id, ordini: await ordLeggi() });
    // (PS Assist si sta aggiornando: la ricarica svuota storage.session — i fogli non partono da qui, e lo si dice)
    if (typeof aggScambio !== "undefined" && aggScambio) return reply({ ok: false, no: true, aggiorna: true, why: "PS Assist si sta aggiornando: riprova fra un minuto" });
    const jobs = (Array.isArray(j.jobs) ? j.jobs : []).slice(0, 12)
      .filter((x) => x && typeof x.name === "string" && (sulGestionale(x.url) || nostro(x.url)))
      .map((x) => ({ name: corto(x.name, 60), printer: corto(x.printer, 30), url: String(x.url), ...(x.breve ? { breve: corto(x.breve, 12) } : {}), ...(nostro(x.url) ? { diretto: true } : {}) }));
    const diretti = jobs.every((x) => x.diretto);   // solo consensi: nessuna scheda da aprire
    // (alla stazione solo i fogli di un ordine e l'etichetta anagrafica: la scheda lo dice, `dest`)
    const dove = await stampaDove(j.dest === "stazione" || j.dest === "ricordata" ? j.dest : "qui");
    const auto = await stampaVerso(dove);
    if (!id || id.startsWith("tel") || !jobs.length || (!diretti && !leggibileOrd(j.url)) || !auto) return reply({ ok: false, no: true });
    const l = await ordLeggi();
    // gli stessi fogli che si stanno già stampando (un doppio clic): una stampa sola
    const firma = (xs) => xs.map((x) => x.url).join(" ");
    // (l'etichetta anagrafica di questo link che si sta già stampando, con qualunque numero di copie: anche)
    const stessi = l.find((x) => x.stato === "stampo" && x.stampa && (firma(x.stampa.jobs) === firma(jobs)
      || (soloBracciale(x) && jobs.every((y) => braccialeUrl(y.url)) && x.stampa.jobs[0].url === jobs[0].url)));
    if (stessi) return reply({ ok: true, id: stessi.id, ordini: l });
    const rec = { id, ep: corto(j.ep, 20), paziente: corto(j.paziente, 60), n: 0, url: diretti ? null : j.url, opener: tab.id, worker: null, ...dove,
      stato: "stampo", pronta: diretti, ts: Date.now(), agg: Date.now(), vista: null, resto: { mancano: [], controllare: [], nel: [] },
      stampa: { jobs, tag: j.tag === "Confermata" ? "Confermata" : "Stampa", fine: j.fine ? fineDi(j.fine) : null, riassunto: corto(j.riassunto, 80), quesito: corto(j.quesito, 90) },
      fogli: fogliNuovi(jobs, auto) };
    l.push(rec);
    if (!diretti) {
      try { await ordApri(rec, l, "stampo"); }
      catch { await togli(l, rec); await ordScrivi(l); return reply({ ok: false, no: true }); }
    } else await ordScrivi(l);
    await chrome.storage.session.set({ [ORD_VISTI]: [...visti, id].slice(-100) });
    reply({ ok: true, id, ordini: l });
    if (diretti) ordStampaFogli(id);
  });
  // «Stampa» sulla striscia: le etichette in attesa, qui e adesso (un tocco del
  // medico); o «Ristampa» di un ordine già stampato dalla stampa automatica
  // (fuori dalla fila, come ogni consegna a una scheda: ordDai)
  if (msg.t === "ordineStampaQui") {
    (async () => {
      const l = await ordLeggi();
      const rec = l.find((x) => x.id === msg.id && (x.stato === "stampa" || x.stato === "avviso") && x.stampa);
      // La Ristampa di un tocco su Conferma (`gruppo`: i suoi ordini, una
      // richiesta per erogatore): tutti i fogli di tutte le sue richieste, una
      // volta ciascuno, le etichette prima — e quegli ordini se ne vanno insieme.
      const gruppo = !msg.qui && rec && rec.gesto && Array.isArray(msg.gruppo)
        ? l.filter((x) => x.gesto === rec.gesto && msg.gruppo.includes(x.id) && x.stato === "avviso" && x.stampa) : [];
      if (gruppo.length > 1 && gruppo.includes(rec)) {
        const visti = new Set(), tutti = [];
        for (const j of gruppo.flatMap((x) => x.stampa.jobs || [])) if (j && !visti.has(j.url)) { visti.add(j.url); tutti.push(j); }
        const jobs = [...tutti.filter((j) => j.printer === "etichettatrice"), ...tutti.filter((j) => j.printer !== "etichettatrice")];
        return reply({ ok: await ordDai(rec.id, tab.id, true, jobs, "", gruppo.map((x) => x.id).filter((x) => x !== rec.id)) });
      }
      // «Ristampa» dopo la stampa senza dialogo: i fogli non usciti (o non si
      // sa); se sono usciti tutti, tutti — un'etichetta inceppata
      const f = rec && rec.stato === "avviso" && Array.isArray(rec.fogli) ? rec.fogli : [];
      const non = f.length ? rec.stampa.jobs.filter((_, i) => f[i] && !usciti(f[i]) && f[i].stato !== "tolto") : [];
      // («Stampa qui»: i fogli che la stazione non ha stampato, qui; «Ristampa», dove sono andati)
      reply({ ok: !!rec && await ordDai(rec.id, tab.id, true, non.length ? non : null, msg.qui ? "qui" : "") });
    })().catch(() => reply({ ok: false }));
    return true;
  }
  // ✕ sulla riga di un foglio: quello solo non si stampa, gli altri vanno
  // avanti. Solo finché aspetta o arriva: dato all'aiutante, dalla coda di
  // Windows non si richiama.
  if (msg.t === "ordineTogliFoglio") return fai(async () => {
    const l = await ordLeggi();
    const rec = statoOrd(l, msg.id);
    const f = rec && Array.isArray(rec.fogli) ? rec.fogli[Number(msg.i)] : null;
    if (!f || (f.stato !== "attesa" && f.stato !== "prendo")) return reply({ ok: false });
    Object.assign(f, { stato: "tolto", ts: Date.now() });
    rec.agg = Date.now();
    await ordScrivi(l);
    reply({ ok: true, ordini: l });
  });
  // ⏹: un ordine in coda si toglie; uno che parte non parte; uno che gira si
  // ferma, dalla sua scheda — e se adesso non risponde (fra una pagina e
  // l'altra) il fermo resta segnato: lo legge alla prossima parola, e non
  // riprende né conferma. Una scheda che non risponde più si chiude. (La
  // domanda alla scheda, fuori dalla fila: una scheda bloccata non la ferma.)
  if (msg.t === "ordineFerma") return fai(async () => {
    const l = await ordLeggi();
    const rec = l.find((x) => x.id === msg.id);
    if (!rec) return reply({ ok: false });
    if (rec.stato === "coda") {
      await togli(l, rec);
      await ordScrivi(l);
      return reply({ ok: true, tolto: true });
    }
    if (rec.stato === "avvio") {
      rec.stato = "interrotto"; rec.agg = Date.now();
      rec.vista = { tag: NON_PARTITA, testo: "niente inviato", tono: "err", quesito: "fermato col ⏹ prima di partire" };
      await ordSlega(rec);
      await ordScrivi(l);
      reply({ ok: true });
      return ordAvanti(l);
    }
    // la stampa dopo la conferma: il foglio in corso finisce, gli altri non partono
    if (rec.stato === "stampo") {
      rec.ferma = true;
      await ordScrivi(l);
      reply({ ok: true });
      if (!STAMPO_VIVI.has(rec.id)) ordStampaFogli(rec.id);
      return;
    }
    if (rec.stato !== "corre") return reply({ ok: false });
    const worker = rec.worker;
    (async () => {
      const r = await allaScheda(worker, { t: "psassistFerma", id: msg.id });
      if (r && r.ok) return reply({ ok: true });
      await inFilaOrd(async () => {
        const l = await ordLeggi();
        const rec = l.find((x) => x.id === msg.id && x.stato === "corre" && x.worker === worker);
        if (!rec) return reply({ ok: false });
        if (rec.muto) { await chrome.tabs.remove(worker).catch(() => {}); return reply({ ok: true }); }
        rec.ferma = true;
        await ordScrivi(l);
        reply({ ok: false, segnato: true });
      });
    })().catch(() => reply({ ok: false }));
  });
  // il medico ha letto (✕, o il carrello aperto): via. Le etichette che
  // aspettano una scheda («Annulla»): non si stampano, e restano nel giornale
  // per quello che sono — «NON stampate», anche per il telefono —, qui viste.
  // (Già date a una scheda in questo istante: è lei che le ha, col suo ✕.)
  if (msg.t === "ordineChiudi") return fai(async () => {
    const l = await ordLeggi();
    const rec = l.find((x) => x.id === msg.id);
    if (!rec || ATTIVI.has(rec.stato) || rec.stato === "stampo" || CONSEGNO.has(rec.id)) return reply({ ok: false });
    if (rec.stato === "stampa") {
      nonStampate(rec, "annullate sul PC: si stampano dalla sua pagina, sezione Stampa");
      rec.visto = true;
    } else await togli(l, rec);
    await ordScrivi(l);
    reply({ ok: true, ordini: l });
    await ordAvanti(l);
  });
  // ✕ «Visto» sulla riga di un foglio non uscito (o dall'esito sconosciuto), a
  // stampa finita: l'ordine non si mostra più qui — né le sue righe, né la
  // striscia —, ma resta nel giornale com'è (e il telefono lo vede com'è).
  if (msg.t === "ordineVisto") return fai(async () => {
    const l = await ordLeggi();
    const rec = l.find((x) => x.id === msg.id && FINALI.has(x.stato));
    if (!rec) return reply({ ok: false });
    rec.visto = true;
    await ordScrivi(l);
    reply({ ok: true, ordini: l });
  });
  // Ogni scheda lo chiede ogni 4 secondi: un giro alla volta, e non più di uno
  // ogni CONTROLLO_OGNI — le altre domande hanno gli ordini come sono.
  if (msg.t === "ordineControlla") {
    if (CONTROLLO.inFila || Date.now() - CONTROLLO.ts < CONTROLLO_OGNI) {
      ordLeggi().then((l) => reply({ ok: true, ordini: l }), () => reply({ ok: false }));
      return true;
    }
    CONTROLLO.inFila = true;
    return fai(async () => {
      let sonda = [];
      try {
        const l = await ordLeggi();
        sonda = await ordControlla(l);
        reply({ ok: true, ordini: l });
      } finally { CONTROLLO.inFila = false; CONTROLLO.ts = Date.now(); }
      ordSonda(sonda).catch(() => {});
    });
  }
  // Il motore (vedi MOTORE_K): lo chiede, lo rinnova e lo molla il motore di
  // una scheda. Lo ha chi lo tiene già (la stessa scheda: anche un giro
  // ripreso dopo il cambio pagina), o nessuno — e intanto nessun ordine in
  // sottofondo che gira in un'altra scheda, né i PDF di una stampa da prendere.
  if (msg.t === "ordineMotore") return fai(async () => {
    await motorePronto;
    const id = corto(msg.id, 40), m = motoreDiScheda(), mio = !!m && m.tab === tab.id;
    if (msg.molla) {
      if (!mio || m.id !== id) return reply({ ok: true, scheda: tab.id });
      await motoreScrivi(null);
      reply({ ok: true, scheda: tab.id });
      return ordAvanti(await ordLeggi());
    }
    // (PS Assist si sta aggiornando: un motore dato adesso lavorerebbe sotto la ricarica — la scheda aspetta)
    if (typeof aggScambio !== "undefined" && aggScambio) return reply({ ok: false, occupato: true, scheda: tab.id });
    const l = await ordLeggi();
    if ((m && !mio) || l.some((x) => x.worker !== tab.id && (ATTIVI.has(x.stato) || daPrendere(x)))) return reply({ ok: false, occupato: true, scheda: tab.id });
    // (chi parte aspetta la lista smart che legge dietro: lei, al prossimo salto, si ferma — smartAvanti)
    if (!mio && await smartVivaFinoA()) { smartCeduta = Date.now(); return reply({ ok: false, occupato: true, smart: true, scheda: tab.id }); }
    await motoreScrivi({ tab: tab.id, id, scade: Date.now() + MOTORE_SCADE });
    reply({ ok: true, scheda: tab.id });
  });
  reply({ ok: false });
}
chrome.runtime.onMessage.addListener(ordMessaggio);

// ---------------------------------------------------------------------------
// LA STAMPA AUTOMATICA. Con l'aiutante di Windows installato (la cartella
// `stampa/`: installa.cmd, niente amministratore) e le due stampanti scelte
// nelle impostazioni, i fogli non passano dal dialogo di stampa: il PDF che la
// pagina ha già preso arriva qui, e da qui all'aiutante (native messaging),
// che lo stampa con SumatraPDF sulla stampante di quel foglio e dice com'è
// andata: «stampato» (uscito dalla coda di Windows), «mandato» (è nella coda),
// «fallito» (non è partito niente), «sconosciuto» (può essere uscito). Chrome
// avvia l'aiutante per ogni domanda e lo chiude appena ha risposto: in Windows
// non resta acceso niente. Spenta con l'interruttore, non installata, o un
// foglio che non è partito per un motivo detto: quel foglio passa dal dialogo
// di sempre. Un esito sconosciuto no — il foglio può essere uscito —: si dice,
// con «Ristampa».
// Le scelte del medico stanno in storage.local: `stampa` = { etichette, a4,
// ruota, dove } (i nomi delle stampanti); `stampaEsito` = com'è andata l'ultima.
// Scelte le due stampanti, con l'aiutante, la stampa è automatica: non c'è un
// interruttore (il dialogo del browser è il ripiego, senza aiutante o senza le
// due stampanti). `attiva`, l'interruttore di prima, se ne va una volta (stampaMigra).
const OSPITE = "it.psassist.stampa";
const STAMPA_PDF_MAX = 25 * 1024 * 1024;   // come l'aiutante
const STAMPA_ATTESA = 90e3;   // l'aiutante finisce entro 40 secondi; oltre questi, l'esito è sconosciuto
// le parole di Chrome, dette per il medico; `ignoto`: l'aiutante può aver stampato
function ospiteErrore(e) {
  const m = String(e && e.message || e);
  if (/not found/i.test(m)) return { why: "l'aiutante di stampa non è installato su questo PC (appena installato? guarda chrome://policy: un criterio dell'IT può vietarlo)", nonInstallata: true };
  if (/forbidden/i.test(m)) return { why: "Chrome non permette di usare l'aiutante di stampa (una regola dell'IT, o un'installazione vecchia): rilancia installa.cmd" };
  if (/failed to start/i.test(m)) return { why: "l'aiutante di stampa non è partito (Windows l'ha bloccato): rilancia installa.cmd, che dice perché" };
  if (/exited|communicating/i.test(m)) return { why: "l'aiutante di stampa si è chiuso senza rispondere", ignoto: true };
  return { why: m.slice(0, 120), ignoto: true };
}
// (la versione dell'aiutante, da ogni risposta che la dice o la tace: ping,
// «chi», e una stampa riuscita — dalla 4 la dice, prima no)
async function ospite(msg, ms) {
  let tid;
  try {
    const r = await Promise.race([chrome.runtime.sendNativeMessage(OSPITE, msg),
      new Promise((_, no) => { tid = setTimeout(() => no(new Error("l'aiutante di stampa non ha risposto in tempo")), ms); })]);
    if (r && r.ok && ["ping", "chi", "stampa"].includes(msg.t)) chrome.storage.local.set({ stampaAiutante: corto(r.versione, 10) }).catch(() => {});
    return r && typeof r === "object" ? r : { ok: false, why: "l'aiutante di stampa non ha risposto", ignoto: true };
  } catch (e) { return { ok: false, ...ospiteErrore(e) }; }
  finally { clearTimeout(tid); }
}
// Le copie dell'etichetta anagrafica in un lavoro solo: dalla versione 4
// dell'aiutante. Quello che ha detto l'ultima volta; mai sentito, glielo si chiede.
async function aiutanteCopie() {
  let v = (await chrome.storage.local.get("stampaAiutante")).stampaAiutante;
  if (v == null) v = (await ospite({ t: "ping" }, 20e3)).versione;
  return Number(v) >= 4;
}
// le scelte del medico, se ci sono tutt'e due le stampanti
async function stampaScelte() {
  const s = (await chrome.storage.local.get("stampa")).stampa || {};
  return s.etichette && s.a4 ? s : null;
}
// L'interruttore di prima se ne va. Chi l'aveva spento stampava col dialogo del
// browser, e così resta finché non risceglie le due stampanti in Impostazioni:
// con lui se ne vanno i loro nomi (mai una stampa automatica che non ha
// chiesto). Una stazione dell'infermeria le usava comunque per gli altri: le tiene.
async function stampaMigra() {
  const o = await chrome.storage.local.get(["stampa", "stazione.qui"]);
  const s = o.stampa;
  if (!s || !("attiva" in s)) return;
  const { attiva, ...resto } = s;
  const q = o["stazione.qui"];   // (una stazione vera: associata e non revocata, come per il puntino, stzPuntino)
  if (attiva === false && !(q && q.conferma && !q.revoca)) { delete resto.etichette; delete resto.a4; }
  await chrome.storage.local.set({ stampa: resto });
}
stampaMigra().catch(() => {});
// SumatraPDF gira ogni etichetta più larga che alta: coi driver delle
// etichettatrici (Zebra, ZDesigner, TSC, Citizen) uscirebbe di traverso, e per
// loro di partenza no. Si cambia nelle impostazioni.
const ruotaDi = (s, nome = s.etichette) => (s.ruota === "no" || s.ruota === "auto" ? s.ruota : /zebra|zdesigner|tsc|citizen/i.test(nome || "") ? "no" : "auto");
// Un foglio all'aiutante, e l'esito annotato: l'indicatore del pannello
// diventa rosso se non è uscito (o non si sa).
async function stampaPdf(tipo, pdf, stampante, ruota = "auto", copie = 1) {
  const r = await ospite({ t: "stampa", tipo, stampante, ruota, ...(copie > 1 ? { copie } : {}), pdf }, STAMPA_ATTESA);
  const esito = r.ok ? (r.esito === "stampato" ? "stampato" : "mandato")
    : r.esito === "fallito" || r.esito === "sconosciuto" ? r.esito : r.ignoto ? "sconosciuto" : "fallito";
  const e = { ok: !!r.ok, esito, stampante: corto(r.stampante || stampante, 80), ts: Date.now(),
    ...(r.ok ? {} : { why: corto(r.why || "non riuscita", 200) }), ...(r.nonInstallata ? { nonInstallata: true } : {}) };
  const pagina = Array.isArray(r.pagina) && r.pagina.length === 2 && r.pagina.every((x) => Number(x) >= 40 && Number(x) <= 1200) ? r.pagina.map(Number) : null;
  await chrome.storage.local.set({ stampaEsito: e, ...(r.ok && tipo === "etichette" && pagina ? { stampaMisura: pagina } : {}) }).catch(() => {});
  // (e le copie che l'aiutante dice di aver mandato: una, se non lo dice)
  return { ...e, copie: Number.isInteger(r.copie) ? r.copie : 1 };
}
// La pagina di prova, fatta qui: un PDF minimo con tre righe, nella misura del
// foglio — per le etichette quella dell'ultima etichetta vera (l'aiutante la
// dice), se no 50×25 mm; o un A4.
function paginaDiProva(tipo, stampante, misura) {
  const etichetta = tipo === "etichette";
  const [w, h] = etichetta ? (Array.isArray(misura) ? misura : [142, 71]) : [595, 842];
  // (Helvetica, solo ASCII; su un'etichetta ci stanno una trentina di lettere)
  const ascii = (s) => String(s).normalize("NFD").replace(/[^\x20-\x7E]/g, "").slice(0, etichetta ? 34 : 60).replace(/[()\\]/g, "\\$&");
  const righe = [`PS Assist: prova ${etichetta ? "etichette" : "A4"}`, ascii(stampante), ascii(new Date().toLocaleString("it-IT"))];
  const [x, y, passo, corpo] = etichetta ? [8, h - 21, 14, 9] : [56, 770, 22, 16];
  const testo = righe.map((r, i) => `BT /F1 ${i ? corpo - 2 : corpo} Tf ${x} ${y - i * passo} Td (${r}) Tj ET`).join("\n");
  const oggetti = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${testo.length} >>\nstream\n${testo}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const dove = oggetti.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n${dove.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
    + `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return btoa(pdf);
}
// «C'è ancora?» L'aiutante tolto (disinstalla.cmd) non si vede finché un foglio
// non fallisce: una volta ogni mezz'ora, aprendo il pannello, glielo si chiede.
// Se non c'è Chrome lo dice subito, senza avviare niente.
const VERIFICA_OGNI = 30 * 60e3;
async function stampaVerifica() {
  if (!(await stampaScelte())) return;
  const k = "stampaVerificata";
  if (Date.now() - ((await chrome.storage.session.get(k))[k] || 0) < VERIFICA_OGNI) return;
  await chrome.storage.session.set({ [k]: Date.now() });
  const p = await ospite({ t: "ping" }, 20e3);
  const prima = (await chrome.storage.local.get("stampaEsito")).stampaEsito;
  if (!p.ok) await chrome.storage.local.set({ stampaEsito: { ok: false, esito: "fallito", why: corto(p.why, 200), ts: Date.now(), ...(p.nonInstallata ? { nonInstallata: true } : {}) } });
  else if (prima && prima.nonInstallata) await chrome.storage.local.remove("stampaEsito");
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || !["stampaStato", "stampaProva", "stampaVerifica"].includes(msg.t)) return;
  const tipo = msg.tipo === "etichette" ? "etichette" : "a4";
  // (i fogli dei pazienti non arrivano da qui: li stampa ordStampaFogli)
  if (msg.t === "stampaVerifica") {
    if (!sulGestionale(sender && sender.url)) return reply({ ok: false, why: "non dal gestionale" }), true;
    stampaVerifica().catch(() => {}).finally(() => reply({ ok: true }));
    return true;
  }
  // il resto, solo dalla pagina delle impostazioni
  if (!String(sender && sender.url || "").startsWith(chrome.runtime.getURL(""))) return reply({ ok: false }), true;
  if (msg.t === "stampaStato") {
    (async () => {
      const p = await ospite({ t: "ping" }, 20e3);
      if (!p.ok) return reply(p);
      const s = await ospite({ t: "stampanti" }, 30e3);
      reply(s.ok ? { ok: true, versione: corto(p.versione, 10), stampanti: (Array.isArray(s.stampanti) ? s.stampanti : []).map((x) => corto(x, 120)), predefinita: corto(s.predefinita, 120) }
        : s);
    })();
    return true;
  }
  const stampante = corto(msg.stampante, 120);
  (async () => {
    const o = await chrome.storage.local.get(["stampa", "stampaMisura"]);
    const ruota = ruotaDi({ ...(o.stampa || {}), ...(msg.ruota ? { ruota: msg.ruota } : {}) }, stampante);
    reply(await stampaPdf(tipo, paginaDiProva(tipo, stampante, o.stampaMisura), stampante, ruota));
  })().catch((e) => reply({ ok: false, why: corto(e && e.message || e, 120) }));
  return true;
});

// Lo script sul portale scelto dal medico va rimesso a ogni avvio: le
// registrazioni dinamiche sopravvivono, ma se il permesso è stato revocato
// vanno tolte, e un doppione fa fallire register().
async function registraPortale(pattern) {
  try { await chrome.scripting.unregisterContentScripts({ ids: ["portale"] }); } catch { /* non c'era */ }
  try { await chrome.scripting.unregisterContentScripts({ ids: ["portale-pdf"] }); } catch { /* non c'era */ }
  try { await chrome.scripting.unregisterContentScripts({ ids: ["portale-registra"] }); } catch { /* non c'era */ }
  if (!pattern) return;
  await chrome.scripting.registerContentScripts([{
    id: "portale", matches: [pattern], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true,
  }]);
  // il registratore (⋯ → Registra) guarda anche le pagine del portale
  await chrome.scripting.registerContentScripts([{
    id: "portale-registra", matches: [pattern], js: ["registra-pill.js", "registra-pagina.js"], runAt: "document_start", allFrames: true,
    persistAcrossSessions: true,
  }]).catch(() => {});
  // il PDF del referto lo vede solo chi sta nel mondo della pagina (vedi portale-pdf.js)
  await chrome.scripting.registerContentScripts([{
    id: "portale-pdf", matches: [pattern], js: ["portale-pdf.js"], runAt: "document_start", allFrames: true,
    world: "MAIN", persistAcrossSessions: true,
  }]).catch(() => {});
}
async function riallineaPortale() {
  const o = await chrome.storage.local.get("portale");
  if (!o.portale) return;
  const pattern = o.portale + "/*";
  const ok = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
  if (ok) await registraPortale(pattern);
  else { await registraPortale(null); await chrome.storage.local.remove("portale"); }
}
// un errore qui non deve diventare un rifiuto non gestito nel service worker
const riallinea = () => { riallineaPortale().catch(() => {}); };
chrome.runtime.onStartup?.addListener(riallinea);
chrome.runtime.onInstalled?.addListener(riallinea);

// Il registratore (⋯ → Registrazioni, registra.js): osserva e basta — mentre
// il medico registra, e gli ultimi 3 minuti per la registrazione automatica.
// Sta in un file suo; un errore lì non tocca il resto.
try { importScripts("registra.js"); }
catch (e) { console.error("PS Assist: il registratore non parte", e); }

// L'aggiornamento da solo (aggiorna.js): la versione nuova da GitHub, applicata
// quando è sicuro, attraverso l'aiutante di Windows. Un errore lì non tocca il resto.
try { importScripts("aggiorna.js"); }
catch (e) { console.error("PS Assist: l'aggiornamento non parte", e); }

// Il ponte verso l'iPhone (ponte-sw.js): una presa cifrata da un capo
// all'altro verso il sito del ponte, e i comandi del telefono eseguiti dalle
// schede del gestionale. Sta in file suoi; vede le costanti qui sopra. Un
// errore lì dentro spegne il ponte, non il resto: ordini, referti, stampe.
try { importScripts("ponte-host.js", "ponte-cripto.js", "ponte-sw.js"); }
catch (e) { console.error("PS Assist: il ponte verso l'iPhone non parte", e); }

// La stazione di stampa (stazione-sw.js): i fogli di un ordine sulle stampanti
// di un altro PC (l'infermeria), cifrati da un capo all'altro attraverso il
// ripetitore del ponte; e lo stesso file fa da stazione, su quel PC. Un errore
// lì spegne la stazione, non il resto.
try { importScripts("stazione-sw.js"); }
catch (e) { console.error("PS Assist: la stazione di stampa non parte", e); }

// «Ricetta SISS» (ricetta-sw.js): la ricetta del pannello consegnata a una
// scheda del Prescrittivo, che la compila e si ferma sull'Anteprima. È una
// SCRITTURA: nella build mini (sola lettura) non si carica nemmeno (niente
// pannello e niente content script sul Prescrittivo: non avrebbe come partire).
if (self.PSA_SOLA_LETTURA !== true) {
  try { importScripts("ricetta-sw.js"); }
  catch (e) { console.error("PS Assist: la ricetta SISS non parte", e); }
}
