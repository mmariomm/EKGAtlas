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

const KEY = (id) => "ref:" + id;
const REF_TTL = 8 * 3600e3;   // a shift: cached documents die with it
// I dati clinici letti restano un giorno e SOPRAVVIVONO alla chiusura del
// browser e al logout: un turno è di dodici ore e i pazienti sono più di
// dodici, quindi una memoria che muore col browser sarebbe inutile. Ventiquattro
// ore dopo l'ultima lettura la scheda scade e viene cancellata da sola.
let codaArch = Promise.resolve();   // le modifiche dell'archivio, una alla volta
const STORICO_TTL = 24 * 3600e3;
const STORICO_MAX = 200;         // di fatto nessun limite per un turno
const REF_MAX = 25;           // and never pile up

async function prune() {
  const all = await chrome.storage.local.get(null);
  const refs = Object.entries(all).filter(([k]) => k.startsWith("ref:"));
  const dead = refs.filter(([, v]) => Date.now() - (v.ts || 0) > REF_TTL).map(([k]) => k);
  const alive = refs.filter(([, v]) => Date.now() - (v.ts || 0) <= REF_TTL)
    .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  const extra = alive.slice(REF_MAX).map(([k]) => k);
  if (dead.length || extra.length) await chrome.storage.local.remove([...dead, ...extra]);
}
chrome.runtime.onStartup?.addListener(() => chrome.storage.local.get(null).then((all) =>
  chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("ref:")))));

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
const quiete = new Map();
const sottoK = (id) => "sotto:" + id;
const inCorso = (s) => !!s && (s.esito === "attesa" || s.esito === "lettura");
async function sottoGet(id) { if (id == null) return null; return (await chrome.storage.session.get(sottoK(id)))[sottoK(id)] || null; }
const sottoSet = (id, v) => chrome.storage.session.set({ [sottoK(id)]: v });
async function sottoFine(id, esito) {
  const s = await sottoGet(id);
  if (!inCorso(s)) return;
  const t = await chrome.tabs.get(id).catch(() => null);
  if (esito === "tempo" && t && !t.url) esito = "altrove";   // l'url si vede solo sui nostri indirizzi
  await sottoSet(id, { ...s, esito, fine: Date.now() });
  clearTimeout(quiete.get(id)); quiete.delete(id);
  // se il medico ci è andato sopra, la scheda è sua: non si chiude
  if (t && !t.active) await chrome.tabs.remove(id).catch(() => {});
}
async function sottoControlla() {
  for (const [k, s] of Object.entries(await chrome.storage.session.get(null))) {
    if (!k.startsWith("sotto:")) continue;
    const id = Number(k.slice(6));
    if (s.esito === "attesa" && Date.now() - s.ts > SOTTO_MAX) await sottoFine(id, "tempo");
    else if (s.esito === "lettura" && Date.now() - s.ultima > SOTTO_QUIETE) await sottoFine(id, s.suo ? "letto" : "altro");
    else if (s.fine && Date.now() - s.fine > 10 * 60e3) await chrome.storage.session.remove(k);
  }
}
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
      if (s && s.esito === "attesa" && t && t.status === "complete" && sulGestionale(t.url)) return sottoFine(id, "nonportale");
    }).catch(() => {});
  }, 4000);
});
chrome.tabs.onRemoved.addListener((id) => {
  sottoGet(id).then((s) => inCorso(s) && sottoSet(id, {
    ...s, fine: Date.now(), esito: s.esito === "lettura" ? (s.suo ? "letto" : "altro") : "chiusa",
  })).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg === "psassist-reload") { chrome.runtime.reload(); return; }
  if (!msg || typeof msg !== "object") return;

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
      await chrome.storage.local.set({ [KEY(msg.id)]: { data, ts: Date.now(), size, ep: msg.ep || "", pk: msg.pk || "" } });
      await prune();
      reply({ ok: true, size });
    };
    // Il pannello può aver già letto il PDF col suo lettore (che sa replicare
    // un visualizzatore): allora arriva già in base64, e qui si mette solo via.
    if (typeof msg.data === "string" && msg.data) {
      if (!/^JVBERi/.test(msg.data)) return reply({ ok: false, why: "non è un PDF" }), true;
      salva(msg.data, msg.size || 1).catch((e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 60) }));
      return true;
    }
    grabPdf(msg.url)
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

  if (msg.t === "listRef") {
    prune().then(() => chrome.storage.local.get(null)).then((all) => {
      const want = Array.isArray(msg.ids) ? new Set(msg.ids) : null;
      const out = {};
      for (const k of Object.keys(all)) {
        if (!k.startsWith("ref:")) continue;
        const id = k.slice(4), rec = all[k];
        if (want && !want.has(id)) continue;                    // only what was asked for
        if (String(msg.ep || "") !== String(rec.ep || "")) continue;   // e solo questo episodio
        out[id] = rec.size || 1;
      }
      reply({ ok: true, cached: out });
    }).catch(() => reply({ ok: false }));
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
      await sottoControlla();
      const vive = Object.entries(await chrome.storage.session.get(null)).filter(([k, s]) => k.startsWith("sotto:") && inCorso(s));
      const gia = vive.find(([, s]) => s.opener === da.id);
      if (gia) return reply({ ok: true, tabId: Number(gia[0].slice(6)), gia: true });   // doppio clic
      if (vive.length >= 3) return reply({ ok: false, why: "troppe letture in corso" });
      // nasce vuota, si annota per chi è, POI parte: così l'annotazione arriva
      // sempre prima dello script del portale
      const vuota = { url: "about:blank", active: false };
      const t = await chrome.tabs.create({ ...vuota, openerTabId: da.id, index: da.index + 1, windowId: da.windowId })
        .catch(() => chrome.tabs.create(vuota));
      await sottoSet(t.id, { opener: da.id, ep: String(msg.ep || ""), nome: String(msg.nome || "").slice(0, 60), ts: Date.now(), esito: "attesa" });
      await chrome.tabs.update(t.id, { url: u.href });
      setTimeout(() => sottoControlla().catch(() => {}), SOTTO_MAX + 500);
      reply({ ok: true, tabId: t.id });
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
      await sottoControlla();
      const vive = Object.entries(await chrome.storage.session.get(null)).filter(([k, s]) => k.startsWith("sotto:") && inCorso(s));
      const gia = vive.find(([, s]) => s.opener === da.id && s.cosa === "referto" && s.id === id);
      if (gia) return reply({ ok: true, tabId: Number(gia[0].slice(6)), gia: true });   // doppio clic
      if (vive.length >= 3) return reply({ ok: false, why: "troppe letture in corso" });
      const vuota = { url: "about:blank", active: false };
      const t = await chrome.tabs.create({ ...vuota, openerTabId: da.id, index: da.index + 1, windowId: da.windowId })
        .catch(() => chrome.tabs.create(vuota));
      await sottoSet(t.id, { opener: da.id, cosa: "referto", id, ep: String(msg.ep || ""), pk: String(msg.pk || ""),
        nome: String(msg.nome || "").slice(0, 60), cfImp: String(msg.cfImp || "").slice(0, 16),
        nascita: String(msg.nascita || "").slice(0, 10), titolo: String(msg.titolo || "").slice(0, 80),
        ts: Date.now(), esito: "attesa" });
      await chrome.tabs.update(t.id, { url: u.href });
      setTimeout(() => sottoControlla().catch(() => {}), SOTTO_MAX + 500);
      reply({ ok: true, tabId: t.id });
    })().catch((e) => reply({ ok: false, why: String((e && e.message) || e).slice(0, 80) }));
    return true;
  }
  // la scheda del portale ha il PDF: si tiene come ogni referto salvato
  // (stesso posto, stessa scadenza, stesso episodio) e la scheda si chiude
  if (msg.t === "refertoSotto") {
    const tid = _sender.tab && _sender.tab.id;
    sottoGet(tid).then(async (s) => {
      if (!inCorso(s) || s.cosa !== "referto") return reply({ ok: false, why: "scheda non nostra" });
      if (typeof msg.data !== "string" || !/^JVBERi/.test(msg.data)) return reply({ ok: false, why: "non è un PDF" });
      await chrome.storage.local.set({ [KEY(s.id)]: { data: msg.data, ts: Date.now(), size: msg.size || 1, ep: s.ep, pk: s.pk } });
      await prune();
      await sottoSet(tid, { ...s, via: String(msg.via || "").slice(0, 20) });
      await sottoFine(tid, "letto");
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
      .then((s) => reply(s ? { ok: true, esito: s.esito, esami: s.esami || 0, prelievi: s.prelievi || 0, diag: s.diag || "" } : { ok: false }))
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
        await sottoSet(id, { ...st, esito: "lettura", ultima: Date.now(), suo: String(msg.dati.ep || "") === st.ep,
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
  // Eliminare un paziente: la sua scheda clinica e i referti tenuti per lui.
  if (msg.t === "delStorico") {
    inFila(async () => {
      // Si cancella per IDENTITÀ, non per la chiave che ci ricordavamo: una
      // scheda arrivata dal portale o da un referto può non aver mai lasciato
      // una chiave nell'elenco, e «eliminato tutto» deve essere vero.
      // Le parole ORDINATE facevano combaciare persone diverse: «DE ROSSI
      // MARIA» e «DE MARIA ROSSI» diventavano la stessa stringa, e cancellare
      // l'una cancellava la scheda dell'altra. Si accettano solo i due ordini
      // veri, come combaciaNome nel pannello.
      const norm = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9 ]+/g, " ").trim().replace(/\s+/g, " ");
      const o = await chrome.storage.local.get(ARCH);
      const a = o[ARCH] || {};
      const suo = norm(msg.nome || "");
      // e il nome si guarda SOLO se la chiave non ha già trovato la scheda:
      // «elimina questo paziente» non deve mai toccarne un altro
      const perChiave = Object.keys(a).filter((k) => k === msg.chiave);
      const stessoNome = (cognome, nome) => {
        const c = norm(cognome), n = norm(nome);
        if (!suo || (!c && !n)) return false;
        return suo === norm(c + " " + n) || suo === norm(n + " " + c);
      };
      const via = perChiave.length ? perChiave
        : Object.keys(a).filter((k) => stessoNome(a[k]?.paziente?.cognome, a[k]?.paziente?.nome));
      if (via.length) { for (const k of via) delete a[k]; await chrome.storage.local.set({ [ARCH]: a }); }
      const all = await chrome.storage.local.get(null);
      const suoi = Object.keys(all).filter((k) => k.startsWith("ref:")
        && ((msg.chiave && all[k]?.pk === msg.chiave) || (msg.ep && String(all[k]?.ep || "") === String(msg.ep))));
      if (suoi.length) await chrome.storage.local.remove(suoi);
      reply({ ok: true, schede: via.length, referti: suoi.length });
    }).catch(() => reply({ ok: false }));
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
      await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("ref:")));
      // le schede cliniche NON si cancellano al logout: hanno la loro
      // scadenza a 24 ore, ed è quella a decidere

      reply({ ok: true });
    }).catch(() => reply({ ok: false }));
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
const SA4 = "https://smarthealth.multimedica.it";
const ATTIVI = new Set(["avvio", "corre"]);          // occupano la coda: un motore alla volta
// (e «stampo»: confermata, il service worker stampa i fogli senza dialogo; la
// scheda dell'ordine dà solo i PDF, e la coda intanto va avanti)
const AVVIO_MAX = 45e3;       // la scheda non ha detto «parto»: non partirà
const MUTO_MAX = 180e3;       // tre minuti senza una parola: si chiede alla scheda se c'è
const STAMPA_MAX = 30 * 60e3; // etichette che nessuno è tornato a prendere
const ORD_TTL = 12 * 3600e3;
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
// (un avviso più vecchio di un turno non si legge più: chi scrive dopo lo toglie)
const ordLeggi = async () => {
  const l = (await chrome.storage.session.get(ORD))[ORD];
  return (Array.isArray(l) ? l : []).filter((x) => ATTIVI.has(x.stato) || x.stato === "coda" || Date.now() - (x.agg || 0) <= ORD_TTL);
};
// a ogni scrittura, per ogni ordine, che cosa dire a chi guarda
const ordScrivi = (l) => { for (const r of l) r.pubblico = ordPubblico(r, l); return chrome.storage.session.set({ [ORD]: l }); };
const corto = (s, n = 160) => String(s == null ? "" : s).slice(0, n);
const nomi = (a) => (Array.isArray(a) ? a.slice(0, 30).map((x) => corto(x, 60)) : []);
const togli = async (l, rec) => { l.splice(l.indexOf(rec), 1); await chrome.storage.session.remove(ORD_PIANO(rec.id)); };
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
  rec.worker = t.id; rec.stato = stato; rec.agg = Date.now();
  await ordScrivi(l);
  try { await chrome.tabs.update(t.id, { url: rec.url }); }
  catch (e) { await chrome.tabs.remove(t.id).catch(() => {}); rec.worker = null; throw e; }
  // la memoria del browser non deve buttarla via a metà giro
  chrome.tabs.update(t.id, { autoDiscardable: false }).catch(() => {});
}
// La prossima in coda, se nessun motore sta girando. Se la sua scheda non si
// apre, quell'ordine non parte e lo si dice: niente è stato mandato.
async function ordAvanti(l) {
  for (;;) {
    if (l.some((x) => ATTIVI.has(x.stato))) return;
    const next = l.find((x) => x.stato === "coda");
    if (!next) return;
    try { await ordApri(next, l); return; }
    catch {
      next.stato = "errore"; next.agg = Date.now(); next.worker = null;
      next.vista = { tag: "Non partito", testo: "La scheda per l'ordine non si è aperta: niente inviato", tono: "err" };
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
// quelli non usciti.)
async function ordDai(l, rec, tabId, forza, jobs = null) {
  const stampa = jobs ? { ...rec.stampa, jobs } : rec.stampa;
  const r = await allaScheda(tabId, { t: "psassistStampa", id: rec.id, ep: rec.ep, paziente: rec.paziente, stampa, forza: !!forza });
  if (!(r && r.ok)) return false;
  await togli(l, rec);
  await ordScrivi(l);
  return true;
}
// (un ordine dal telefono non apre mai da solo il dialogo di stampa: davanti
// al PC può non esserci nessuno. Aspetta un tocco su «Stampa», e lo dice.)
const dalTelefono = (rec) => String(rec.id).startsWith("tel");
async function ordConsegnaStampa(l) {
  const pronte = l.filter((x) => x.stato === "stampa" && x.stampa && !dalTelefono(x));
  if (!pronte.length) return;
  const cand = [];
  for (const q of [{ active: true, lastFocusedWindow: true }, { active: true }]) {
    for (const t of await chrome.tabs.query(q).catch(() => [])) if (sulGestionale(t.url) && !cand.includes(t.id)) cand.push(t.id);
  }
  for (const rec of pronte) for (const id of cand) if (await ordDai(l, rec, id, false)) break;
}
// Il giro di controllo: schede sparite, schede che non partono o non parlano
// più, etichette che nessuno ha preso. Lo chiedono le schede
// del gestionale ogni pochi secondi finché un ordine gira o aspetta la stampa:
// il service worker può addormentarsi, le schede no. Si riscrive solo se
// qualcosa è cambiato.
async function ordControlla(l) {
  const ora = Date.now();
  const prima = JSON.stringify(l);
  for (const rec of [...l]) {
    const t = rec.worker != null ? await chrome.tabs.get(rec.worker).catch(() => null) : null;
    if (rec.worker != null && (!t || t.discarded)) {
      rec.worker = null;
      if (ATTIVI.has(rec.stato)) { rec.stato = "chiusa"; rec.agg = ora; rec.vista = { tag: "Scheda chiusa", testo: "", tono: "err" }; }
      if (rec.stato === "stampo") rec.interrotta = rec.interrotta || "la scheda dell'ordine si è chiusa";
    } else if (rec.stato === "avvio" && ora - rec.agg > AVVIO_MAX) {
      rec.stato = "errore"; rec.agg = ora;
      rec.vista = { tag: "Non partito", testo: "La scheda dell'ordine non ha risposto: niente inviato", tono: "err" };
      await ordSlega(rec);
    } else if (rec.stato === "corre" && ora - rec.agg > MUTO_MAX) {
      // Zitta da troppo: le si chiede se c'è. Finché la scheda esiste non si
      // dice «non mandati» (potrebbe mandare ancora) e la coda aspetta: mai
      // due motori insieme. Se risponde, era solo lenta.
      const r = await allaScheda(rec.worker, { t: "psassistVivo", id: rec.id });
      if (r && r.ok) { rec.agg = ora; delete rec.muto; } else rec.muto = true;
    } else if (rec.stato === "stampo" && rec.pronta === false && ora - rec.agg > AVVIO_MAX) {
      // la scheda dei PDF non ha mai detto «ci sono»: i fogli non partono
      rec.interrotta = rec.interrotta || "la scheda dell'ordine non ha dato il foglio";
    } else if (rec.stato === "stampo" && rec.pronta === false && ora - rec.agg > 6000 && !rec.ricarico) {
      // …dopo qualche secondo zitta (la pagina non si è caricata): la si ricarica, una volta
      rec.ricarico = true;
      chrome.tabs.update(rec.worker, { url: rec.url }).catch(() => {});
    } else if (rec.stato === "stampa" && ora - rec.agg > STAMPA_MAX) {
      rec.stato = "avviso"; rec.agg = ora; rec.stampa = null; delete rec.fogli;
      // (non le ha prese nessuno: non stampate, e lo si dice in ambra — mai un verde)
      rec.vista = { tag: "Etichette NON stampate", testo: "si stampano dalla sua pagina, sezione Stampa", tono: "warn" };
    }
  }
  if (JSON.stringify(l) !== prima) await ordScrivi(l);
  // una stampa che questo service worker non sta facendo (si è riavviato): la riprende
  for (const rec of l) if (rec.stato === "stampo" && !STAMPO_VIVI.has(rec.id)) ordStampaFogli(rec.id);
  await ordAvanti(l);
  await ordConsegnaStampa(l);
}

chrome.tabs.onRemoved.addListener((id) => {
  inFilaOrd(async () => {
    const l = await ordLeggi();
    const rec = l.find((x) => x.worker === id);
    if (!rec) return;
    rec.worker = null;
    // chiusa a metà giro: le schede del medico diranno cosa non è partito
    if (ATTIVI.has(rec.stato)) { rec.stato = "chiusa"; rec.agg = Date.now(); rec.vista = { tag: "Scheda chiusa", testo: "", tono: "err" }; }
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
function ordPubblico(rec, l = []) {
  const v = rec.vista || {}, r = rec.resto || {}, f = Array.isArray(rec.fogli) ? rec.fogli : [];
  // «Quesito: il tuo» è la frase della scheda dell'ordine: per un ordine dal telefono, si dice quale
  const vero = (s) => (rec.quesito ? s.replace(/Quesito: il tuo(, al posto del triage)?/g, () => `Quesito: «${rec.quesito}»`) : s);
  const P = (tono, titolo, testo = "", ...dettaglio) => ({ tono, titolo: corto(titolo, 80), testo: corto(testo, 200), dettaglio: corto(vero(dettaglio.filter(Boolean).join(" · ")), 240) });
  const alTel = (pc, telefono) => (dalTelefono(rec) ? { ...pc, tel: telefono } : pc);
  const tono = (t, d) => (["run", "ok", "warn", "err"].includes(t) ? t : d);
  const lista = (k) => (Array.isArray(r[k]) ? r[k] : []);
  const resto = [lista("mancano").length ? `Mancano: ${lista("mancano").join(", ")}` : "", lista("controllare").length ? `Da controllare: ${lista("controllare").join(", ")}` : ""].filter(Boolean).join(" · ");
  const st = rec.stampa || {};
  const tel = dalTelefono(rec) ? "avvisa chi preleva" : "";
  const dove = (xs) => [...new Set(xs.map((x) => x.stampante).filter(Boolean))].join(" e ") || "la stampante";
  const etichette = (xs) => xs.some((x) => x.tipo === "etichette");
  const cosa = (xs) => (etichette(xs) ? "Etichette NON stampate" : "Fogli NON stampati");
  const alle = `${st.riassunto ? st.riassunto + " " : ""}alle ${ORA(rec.agg)}`;
  switch (rec.stato) {
    case "coda": {
      const prima = l.find((x) => x !== rec && ATTIVI.has(x.stato));
      return P("run", "In coda", prima ? `parte dopo l'ordine di ${prima.paziente || "un altro paziente"}` : "parte fra poco");
    }
    case "avvio": return P("run", "Parte", "Apro la scheda dell'ordine…");
    case "corre":
      if (rec.muto) return P("err", "Ordine fermo", "La scheda dell'ordine non risponde: ⏹ la chiude", [...lista("mancano"), ...lista("controllare")].length ? `Da controllare: ${[...lista("mancano"), ...lista("controllare")].join(", ")}` : "");
      if (rec.ferma) return P("warn", "Fermo chiesto", "la scheda dell'ordine si ferma appena risponde");
      return P(tono(v.tono, "run"), v.badge || v.tag || "In corso", [v.tag && v.badge ? v.tag : "", v.testo].filter(Boolean).join(" · ") || "…", v.quesito);
    case "stampo": {
      const i = rec.inVolo != null ? rec.inVolo : f.findIndex((x) => x.stato === "attesa");
      const ora = f[i];
      // («Confermata»; una ristampa dalla scheda del medico, «Stampa»)
      const tag = st.tag || "Confermata";
      if (rec.ferma || rec.interrotta) return P("warn", tag, "Fermo la stampa: finisce il foglio in corso", st.riassunto);
      return P("run", tag, ora ? `Stampo ${/^etichett/i.test(ora.name) ? "le etichette" : /^lista/i.test(ora.name) ? "la lista esami" : `«${ora.name}»`}${ora.stampante ? ` su ${ora.stampante}` : ""}…` : "Stampo…",
        f.length > 1 ? `foglio ${i + 1} di ${f.length}` : "", st.riassunto);
    }
    case "stampa": {
      // le etichette aspettano una scheda del gestionale (il dialogo di stampa);
      // per un ordine dal telefono, un tocco su «Stampa»
      const rotti = f.filter((x) => x.stato === "fallito");
      if (rotti.length) {
        return alTel(P("warn", cosa(rotti), rotti[0].why || `${dove(rotti)} ha dato errore`, st.riassunto),
          P("warn", cosa(rotti), "aspettano qualcuno al PC", rotti[0].why, st.riassunto));
      }
      if (dalTelefono(rec)) return alTel(P("warn", "Etichette NON stampate", "tocca Stampa", st.riassunto), P("warn", "Etichette NON stampate", "aspettano qualcuno al PC", st.riassunto));
      return P("run", "Confermata", "Etichette pronte", st.riassunto, st.quesito);
    }
    case "errore": return P("err", v.tag || "Errore", v.testo || "completa a mano", v.quesito || resto);
    case "chiusa": {
      const k = lista("mancano").length;
      return P("err", v.tag || "Scheda chiusa", k ? `${k === 1 ? "1 esame non mandato" : `${k} esami non mandati`}: ${lista("mancano").join(", ")}` : v.testo || "controlla il carrello",
        lista("controllare").length ? `Da controllare: ${lista("controllare").join(", ")}` : "");
    }
    case "interrotto": return P("warn", "Interrotto", v.testo || "controlla il carrello", v.quesito || resto);
    default: {
      if (!f.length) return P(tono(v.tono, "ok"), v.tag || "Fatto", v.testo, v.quesito);
      // com'è finita la stampa senza dialogo, foglio per foglio
      // (il perché tecnico resta sul PC; il telefono dice che cosa guardare)
      const ignoti = f.filter((x) => x.stato === "sconosciuto"), non = f.filter((x) => !usciti(x) && x.stato !== "sconosciuto");
      if (ignoti.length) {
        return alTel(P("warn", "Esito della stampa sconosciuto", `controlla ${dove(ignoti)}: ${ignoti[0].why || "l'aiutante non ha detto com'è andata"}`, st.riassunto),
          P("warn", etichette(ignoti) ? "Etichette forse stampate" : "Fogli forse stampati",
            `guarda ${dove(ignoti)} prima di ristamparl${etichette(ignoti) ? "e" : "i"} dal PC`, st.riassunto));
      }
      if (non.length) return P("warn", "Stampa interrotta", `non usciti: ${non.map((x) => x.name).join(", ")}`, rec.interrotta, st.riassunto);
      const stampati = f.filter((x) => x.stato === "stampato"), mandati = f.filter((x) => x.stato === "mandato");
      if (!mandati.length) return P("ok", `Stampato su ${dove(stampati)}`, alle, st.quesito, tel);
      return P("warn", `Mandato a ${dove(mandati)}`, alle, "è nella coda di Windows: controlla che sia uscito",
        stampati.length ? `stampato su ${dove(stampati)}` : "", tel);
    }
  }
}

// LA STAMPA SENZA DIALOGO: la fa il service worker, foglio per foglio, e ogni
// passo sta scritto nell'ordine (storage.session) PRIMA di farlo. Un foglio è
// «mandato» all'aiutante prima che parta: se qui qualcosa muore, al riavvio
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
  return { name: j.name, tipo, stato: "attesa", stampante: s ? corto(s[tipo], 80) : "", why: "" };
});
// il resoconto di una conferma (quanti esami, quando), per la scheda che stampa dal dialogo
const fineDi = (f) => ({ n: Number(f && f.n) || 0, ts: Number(f && f.ts) || Date.now(), quesito: (f && f.quesito) || null });
const pdfNostro = (u) => fetch(u).then((r) => r.arrayBuffer()).then((b) => ({ ok: true, pdf: b64(b) }))
  .catch((e) => ({ ok: false, why: corto(e && e.message || e, 80) }));
async function ordStampaFogli(id) {
  if (STAMPO_VIVI.has(id)) return;
  STAMPO_VIVI.add(id);
  try {
    for (;;) {
      // 1. il prossimo foglio, o la fine
      const passo = await inFilaOrd(async () => {
        const l = await ordLeggi();
        const rec = statoOrd(l, id);
        if (!rec) return null;
        // la scheda dei PDF non c'è ancora: si comincia quando dice «ci sono» (ordineChi)
        if (rec.pronta === false && !rec.ferma && !rec.interrotta) return null;
        if (rec.inVolo != null) {   // mandato da un service worker che non c'è più: com'è andata non si sa
          const f = rec.fogli[rec.inVolo];
          if (f && f.stato === "mandato") Object.assign(f, { stato: "sconosciuto", why: "la risposta dell'aiutante si è persa" });
          rec.inVolo = null;
          await ordScrivi(l);
        }
        const i = rec.fogli.findIndex((f) => f.stato === "attesa");
        const job = rec.stampa.jobs[i] || {};
        const senza = i >= 0 && !job.diretto && rec.worker == null;   // nessuno che dia il PDF
        const s = i < 0 || rec.ferma || rec.interrotta || senza ? null : await stampaScelte();
        if (!s) {
          if (i >= 0 && !rec.interrotta) rec.interrotta = rec.ferma ? "fermata col ⏹" : senza ? "la scheda dell'ordine si è chiusa" : "stampa automatica spenta";
          await ordStampoFine(l, rec);
          return null;
        }
        const f = rec.fogli[i];
        return { i, url: job.url, diretto: !!job.diretto, worker: rec.worker, tipo: f.tipo, stampante: s[f.tipo], ruota: ruotaDi(s) };
      });
      if (!passo) return;
      // 2. il PDF, dalla scheda dell'ordine (un consenso, dall'estensione)
      const pdf = passo.diretto ? await pdfNostro(passo.url) : await allaScheda(passo.worker, { t: "psassistPdf", id, url: passo.url }, 30e3);
      // 3. il foglio segnato «mandato» prima di mandarlo
      const va = await inFilaOrd(async () => {
        const l = await ordLeggi();
        const rec = statoOrd(l, id);
        if (!rec) return false;
        const f = rec.fogli[passo.i];
        if (!pdf) rec.interrotta = rec.interrotta || "la scheda dell'ordine non ha dato il foglio";
        else if (!pdf.ok || typeof pdf.pdf !== "string") Object.assign(f, { stato: "fallito", why: `il PDF non è arrivato (${corto(pdf.why, 80)})` });
        else if (pdf.pdf.length > STAMPA_PDF_MAX / 3 * 4 + 4) Object.assign(f, { stato: "fallito", why: "PDF troppo grande" });
        else { Object.assign(f, { stato: "mandato", stampante: corto(passo.stampante, 80) }); rec.inVolo = passo.i; }
        rec.agg = Date.now();
        await ordScrivi(l);
        return rec.inVolo === passo.i;
      });
      if (!va) continue;
      // 4. all'aiutante (fino a 90 secondi: lui finisce in 40), poi com'è andata
      const r = await stampaPdf(passo.tipo, pdf.pdf, passo.stampante, passo.ruota);
      await inFilaOrd(async () => {
        const l = await ordLeggi();
        const rec = statoOrd(l, id);
        if (!rec || rec.inVolo !== passo.i) return;
        Object.assign(rec.fogli[passo.i], { stato: r.esito, stampante: corto(r.stampante, 80), why: r.why || "" });
        rec.inVolo = null; rec.agg = Date.now();
        await ordScrivi(l);
      });
    }
  } finally { STAMPO_VIVI.delete(id); }
}
// Finita la stampa. Un foglio che non è partito per un motivo detto
// (stampante spenta o sparita, PDF che non arriva) passa dal dialogo di
// sempre, lui solo: nella scheda dove sta il medico, o — un ordine dal
// telefono — quando qualcuno al PC tocca «Stampa». Tutto il resto finisce qui,
// con «Ristampa»: anche un esito sconosciuto, che non si ristampa da solo.
async function ordStampoFine(l, rec) {
  rec.agg = Date.now();
  rec.inVolo = null;
  const rotti = rec.stampa.jobs.map((j, i) => ({ ...j, motivo: rec.fogli[i].why })).filter((_, i) => rec.fogli[i].stato === "fallito");
  if (rotti.length && !rec.interrotta) { rec.stato = "stampa"; rec.stampa = { ...rec.stampa, jobs: rotti }; }
  else rec.stato = "avviso";
  delete rec.ferma;
  await ordSlega(rec);
  await ordScrivi(l);
  await ordAvanti(l);
  await ordConsegnaStampa(l);
}

// il medico è su un'altra scheda, in un'altra finestra, o su una pagina appena
// caricata: le etichette in attesa vanno lì
const ordStampaOra = () => inFilaOrd(async () => { await ordConsegnaStampa(await ordLeggi()); }).catch(() => {});
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
    const rec = {
      id, ep, paziente: corto(j.paziente, 60), n: Number(j.n) || 0, autoConfirm: !!j.autoConfirm, url: j.url,
      rid: j.rid ? corto(j.rid, 20) : null, opener: tab.id, worker: null,
      // (il quesito scritto sul telefono: lo dice ordPubblico al posto di «il tuo»)
      quesito: id.startsWith("tel") ? corto(String(j.piano.quesito || "").replace(/\s+/g, " ").trim(), 90) : "",
      stato: "coda", ts: Date.now(), agg: Date.now(), vista: null,
      resto: { mancano: nomi(j.nomi), controllare: [], nel: [] },
    };
    await chrome.storage.session.set({ [ORD_PIANO(id)]: j.piano, [ORD_VISTI]: [...visti, id].slice(-100) });
    l.push(rec);
    if (l.some((x) => ATTIVI.has(x.stato))) {
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
      reply({ ok: true, ordini: l, fogli: true });
      return void ordStampaFogli(nata.id);
    }
    // la scheda di un ordine che sta stampando è ripartita (ricaricata, un'altra
    // pagina): i fogli che restano non li dà più nessuno
    const ricarica = l.find((x) => x.worker === tab.id && x.stato === "stampo" && !x.interrotta);
    if (ricarica) { ricarica.interrotta = "la scheda dell'ordine si è ricaricata"; await ordScrivi(l); }
    const mio = l.find((x) => x.worker === tab.id && ATTIVI.has(x.stato));
    // (o la scheda che il ponte ha aperto per i valori di un paziente: ponte-sw.js)
    if (!mio) return reply({ ok: true, ordini: l, ...(typeof ponteLavoroDi === "function" ? await ponteLavoroDi(tab.id) : {}) });
    const piano = (await chrome.storage.session.get(ORD_PIANO(mio.id)))[ORD_PIANO(mio.id)] || null;
    reply({ ok: true, ordini: l, lavoro: { ...mio, piano } });
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
        quesito: corto(v.quesito, 90), ferma: !!v.ferma, sessione: !!v.sessione };
    }
    if (msg.resto && typeof msg.resto === "object") {
      rec.resto = { mancano: nomi(msg.resto.mancano), controllare: nomi(msg.resto.controllare), nel: nomi(msg.resto.nel) };
    }
    if (msg.rid) rec.rid = corto(msg.rid, 20);
    if (msg.listUrl && leggibileOrd(msg.listUrl)) rec.listUrl = msg.listUrl;
    // il passaggio di consegne per le schede del medico: il carrello da aprire
    // (un indirizzo da leggere, mai un invio) e quello che la pagina deve dire
    if (msg.consegna && typeof msg.consegna === "object" && leggibileOrd(msg.consegna.url)) {
      const s = JSON.stringify(msg.consegna);
      if (s.length < 60000) rec.consegna = JSON.parse(s);
    }
    registroDi(rec, msg);
    rec.agg = Date.now(); delete rec.muto;
    if (!ATTIVI.has(rec.stato)) await ordSlega(rec);
    await ordScrivi(l);
    reply({ ok: true, ferma: !!rec.ferma && ATTIVI.has(rec.stato) });
    await ordAvanti(l);
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
      .map((j) => ({ name: corto(j.name, 60), printer: corto(j.printer, 30), url: String(j.url) }));
    if (!jobs.length) return reply({ ok: false });
    const auto = await stampaScelte();
    rec.stampa = { jobs, fine: fineDi(msg.fine), riassunto: corto(msg.riassunto, 80), quesito: corto(msg.quesito, 90) };
    registroDi(rec, msg);
    rec.fogli = fogliNuovi(jobs, auto);
    rec.agg = Date.now();
    await chrome.storage.session.set({ [ORD_FOGLI]: [...presi, rec.id].slice(-100) });
    rec.stato = auto ? "stampo" : "stampa";
    if (!auto) await ordSlega(rec);
    await ordScrivi(l);
    reply({ ok: true, stampo: !!auto });
    if (auto) ordStampaFogli(rec.id);
    await ordAvanti(l);
    await ordConsegnaStampa(l);
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
  if (msg.t === "ordineFogli") return fai(async () => {
    const j = msg.job || {};
    const id = corto(j.id, 40);
    const visti = (await chrome.storage.session.get(ORD_VISTI))[ORD_VISTI] || [];
    if (id && visti.includes(id)) return reply({ ok: true, id, ordini: await ordLeggi() });
    const nostro = (u) => String(u).startsWith(chrome.runtime.getURL("consensi/"));
    const jobs = (Array.isArray(j.jobs) ? j.jobs : []).slice(0, 12)
      .filter((x) => x && typeof x.name === "string" && (sulGestionale(x.url) || nostro(x.url)))
      .map((x) => ({ name: corto(x.name, 60), printer: corto(x.printer, 30), url: String(x.url), ...(nostro(x.url) ? { diretto: true } : {}) }));
    const diretti = jobs.every((x) => x.diretto);   // solo consensi: nessuna scheda da aprire
    const auto = await stampaScelte();
    if (!id || id.startsWith("tel") || !jobs.length || (!diretti && !leggibileOrd(j.url)) || !auto) return reply({ ok: false, no: true });
    const l = await ordLeggi();
    // gli stessi fogli che si stanno già stampando (un doppio clic): una stampa sola
    const firma = (xs) => xs.map((x) => x.url).join(" ");
    const stessi = l.find((x) => x.stato === "stampo" && x.stampa && firma(x.stampa.jobs) === firma(jobs));
    if (stessi) return reply({ ok: true, id: stessi.id, ordini: l });
    const rec = { id, ep: corto(j.ep, 20), paziente: corto(j.paziente, 60), n: 0, url: diretti ? null : j.url, opener: tab.id, worker: null,
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
  if (msg.t === "ordineStampaQui") return fai(async () => {
    const l = await ordLeggi();
    const rec = l.find((x) => x.id === msg.id && (x.stato === "stampa" || x.stato === "avviso") && x.stampa);
    // «Ristampa» dopo la stampa senza dialogo: i fogli non usciti (o non si
    // sa); se sono usciti tutti, tutti — un'etichetta inceppata
    const f = rec && rec.stato === "avviso" && Array.isArray(rec.fogli) ? rec.fogli : [];
    const non = f.length ? rec.stampa.jobs.filter((_, i) => f[i] && !usciti(f[i])) : [];
    reply({ ok: !!rec && await ordDai(l, rec, tab.id, true, non.length ? non : null) });
  });
  // ⏹: un ordine in coda si toglie; uno che parte non parte; uno che gira si
  // ferma, dalla sua scheda — e se adesso non risponde (fra una pagina e
  // l'altra) il fermo resta segnato: lo legge alla prossima parola, e non
  // riprende né conferma. Una scheda che non risponde più si chiude.
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
      rec.vista = { tag: "Interrotto", testo: "Fermato prima di partire: niente inviato", tono: "warn" };
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
    const r = await allaScheda(rec.worker, { t: "psassistFerma", id: rec.id });
    if (r && r.ok) return reply({ ok: true });
    if (rec.muto) { await chrome.tabs.remove(rec.worker).catch(() => {}); return reply({ ok: true }); }
    rec.ferma = true;
    await ordScrivi(l);
    reply({ ok: false, segnato: true });
  });
  // il medico ha letto (✕, o il carrello aperto): via
  if (msg.t === "ordineChiudi") return fai(async () => {
    const l = await ordLeggi();
    const rec = l.find((x) => x.id === msg.id);
    if (!rec || ATTIVI.has(rec.stato) || rec.stato === "stampo") return reply({ ok: false });
    await togli(l, rec);
    await ordScrivi(l);
    reply({ ok: true, ordini: l });
    await ordAvanti(l);
  });
  if (msg.t === "ordineControlla") return fai(async () => {
    const l = await ordLeggi();
    await ordControlla(l);
    reply({ ok: true, ordini: l });
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
// Le scelte del medico stanno in storage.local: `stampa` = { attiva, etichette,
// a4, ruota } (i nomi delle stampanti); `stampaEsito` = com'è andata l'ultima.
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
async function ospite(msg, ms) {
  let tid;
  try {
    const r = await Promise.race([chrome.runtime.sendNativeMessage(OSPITE, msg),
      new Promise((_, no) => { tid = setTimeout(() => no(new Error("l'aiutante di stampa non ha risposto in tempo")), ms); })]);
    return r && typeof r === "object" ? r : { ok: false, why: "l'aiutante di stampa non ha risposto", ignoto: true };
  } catch (e) { return { ok: false, ...ospiteErrore(e) }; }
  finally { clearTimeout(tid); }
}
// le scelte del medico, se la stampa automatica è accesa
async function stampaScelte() {
  const s = (await chrome.storage.local.get("stampa")).stampa || {};
  return s.attiva !== false && s.etichette && s.a4 ? s : null;
}
// SumatraPDF gira ogni etichetta più larga che alta: coi driver delle
// etichettatrici (Zebra, ZDesigner, TSC, Citizen) uscirebbe di traverso, e per
// loro di partenza no. Si cambia nelle impostazioni.
const ruotaDi = (s, nome = s.etichette) => (s.ruota === "no" || s.ruota === "auto" ? s.ruota : /zebra|zdesigner|tsc|citizen/i.test(nome || "") ? "no" : "auto");
// Un foglio all'aiutante, e l'esito annotato: l'indicatore del pannello
// diventa rosso se non è uscito (o non si sa).
async function stampaPdf(tipo, pdf, stampante, ruota = "auto") {
  const r = await ospite({ t: "stampa", tipo, stampante, ruota, pdf }, STAMPA_ATTESA);
  const esito = r.ok ? (r.esito === "stampato" ? "stampato" : "mandato")
    : r.esito === "fallito" || r.esito === "sconosciuto" ? r.esito : r.ignoto ? "sconosciuto" : "fallito";
  const e = { ok: !!r.ok, esito, stampante: corto(r.stampante || stampante, 80), ts: Date.now(),
    ...(r.ok ? {} : { why: corto(r.why || "non riuscita", 200) }), ...(r.nonInstallata ? { nonInstallata: true } : {}) };
  const pagina = Array.isArray(r.pagina) && r.pagina.length === 2 && r.pagina.every((x) => Number(x) >= 40 && Number(x) <= 1200) ? r.pagina.map(Number) : null;
  await chrome.storage.local.set({ stampaEsito: e, ...(r.ok && tipo === "etichette" && pagina ? { stampaMisura: pagina } : {}) }).catch(() => {});
  return e;
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
    id: "portale-registra", matches: [pattern], js: ["registra-pagina.js"], runAt: "document_start", allFrames: true,
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

// Il registratore (⋯ → Registra, registra.js): osserva e basta, e solo mentre
// il medico registra. Sta in un file suo; un errore lì non tocca il resto.
try { importScripts("registra.js"); }
catch (e) { console.error("PS Assist: il registratore non parte", e); }

// Il ponte verso l'iPhone (ponte-sw.js): una presa cifrata da un capo
// all'altro verso il sito del ponte, e i comandi del telefono eseguiti dalle
// schede del gestionale. Sta in file suoi; vede le costanti qui sopra. Un
// errore lì dentro spegne il ponte, non il resto: ordini, referti, stampe.
try { importScripts("ponte-host.js", "ponte-cripto.js", "ponte-sw.js"); }
catch (e) { console.error("PS Assist: il ponte verso l'iPhone non parte", e); }
