/*
 * PS Assist — service worker.
 *
 * Two jobs:
 *  1. reload the extension on request (the panel's "⟳ ricarica estensione");
 *  2. fetch and cache referto PDFs.
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
      if (s) return reply({ ok: true, ep: s.ep, nome: s.nome, ts: s.ts, sotto: true, cosa: s.cosa || "storico" });
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
        nome: "", ts: Date.now(), esito: "attesa" });
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
      await sottoFine(tid, "nonTrovato");
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
const ORD = "ordini";
const ORD_PIANO = (id) => "ordine:" + id;
const ORD_VISTI = "ordiniVisti";   // gli ordini già accettati: uno chiesto due volte parte una volta
const SA4 = "https://smarthealth.multimedica.it";
const ATTIVI = new Set(["avvio", "corre"]);          // occupano la coda: un motore alla volta
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
const ordScrivi = (l) => chrome.storage.session.set({ [ORD]: l });
const corto = (s, n = 160) => String(s == null ? "" : s).slice(0, n);
const nomi = (a) => (Array.isArray(a) ? a.slice(0, 30).map((x) => corto(x, 60)) : []);
const togli = async (l, rec) => { l.splice(l.indexOf(rec), 1); await chrome.storage.session.remove(ORD_PIANO(rec.id)); };
// Un messaggio a una scheda, con una risposta entro pochi secondi o niente: una
// scheda bloccata non deve fermare la fila degli ordini (null = non ha risposto).
const allaScheda = (id, m) => Promise.race([chrome.tabs.sendMessage(id, m).catch(() => null), new Promise((r) => setTimeout(() => r(null), 5000))]);

// la scheda nasce vuota, si annota per quale ordine è, POI va sulla pagina:
// così la risposta a «chi sono?» c'è sempre prima del content script
async function ordApri(rec, l) {
  const op = rec.opener != null ? await chrome.tabs.get(rec.opener).catch(() => null) : null;
  const dove = op && sulGestionale(op.url) ? { openerTabId: op.id, index: op.index + 1, windowId: op.windowId } : {};
  const vuota = { url: "about:blank", active: false };
  const t = await chrome.tabs.create({ ...vuota, ...dove }).catch(() => chrome.tabs.create(vuota));
  rec.worker = t.id; rec.stato = "avvio"; rec.agg = Date.now();
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
// segnano quelli già stampati.
async function ordDai(l, rec, tabId, forza) {
  const r = await allaScheda(tabId, { t: "psassistStampa", id: rec.id, ep: rec.ep, paziente: rec.paziente, stampa: rec.stampa, forza: !!forza });
  if (!(r && r.ok)) return false;
  await togli(l, rec);
  await ordScrivi(l);
  return true;
}
async function ordConsegnaStampa(l) {
  const pronte = l.filter((x) => x.stato === "stampa" && x.stampa);
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
    } else if (rec.stato === "stampa" && ora - rec.agg > STAMPA_MAX) {
      rec.stato = "avviso"; rec.agg = ora; rec.stampa = null;
      rec.vista = { tag: "Confermata", testo: "Le etichette si stampano dalla sua pagina, sezione Stampa", tono: "ok" };
    }
  }
  if (JSON.stringify(l) !== prima) await ordScrivi(l);
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
    await ordScrivi(l);
    await ordAvanti(l);
  }).catch(() => {});
});
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
    const mio = l.find((x) => x.worker === tab.id && ATTIVI.has(x.stato));
    if (!mio) return reply({ ok: true, ordini: l });
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
    rec.agg = Date.now(); delete rec.muto;
    if (!ATTIVI.has(rec.stato)) await ordSlega(rec);
    await ordScrivi(l);
    reply({ ok: true, ferma: !!rec.ferma && ATTIVI.has(rec.stato) });
    await ordAvanti(l);
  });
  // I fogli della richiesta confermata, solo da un ordine che gira. Quelli che
  // la stampa automatica ha già fatto uscire dalla scheda dell'ordine (`fatto`)
  // non si stampano più: se sono tutti, l'ordine finisce con «Stampato» e
  // tiene i fogli solo per «Ristampa», un tocco del medico. Gli altri — tutti,
  // senza stampa automatica — li stampa la scheda dove sta il medico, col
  // motivo se la stampa automatica non ci è riuscita.
  if (msg.t === "ordineStampa") return fai(async () => {
    const l = await ordLeggi();
    const rec = suo(l);
    if (!rec || rec.stato !== "corre") return reply({ ok: false });
    const jobs = (Array.isArray(msg.jobs) ? msg.jobs : []).slice(0, 12)
      .filter((j) => j && sulGestionale(j.url) && typeof j.name === "string")
      .map((j) => ({ name: corto(j.name, 60), printer: corto(j.printer, 30), url: String(j.url),
        ...(j.fatto ? { fatto: true } : j.motivo ? { motivo: corto(j.motivo, 160) } : {}) }));
    if (!jobs.length) return reply({ ok: false });
    const f = msg.fine || {};
    const fine = { n: Number(f.n) || 0, ts: Number(f.ts) || Date.now(), quesito: f.quesito || null };
    const restano = jobs.filter((j) => !j.fatto);
    rec.agg = Date.now();
    if (restano.length) {
      rec.stampa = { jobs: restano, fine };
      rec.stato = "stampa";
      rec.vista = { tag: "Confermata", testo: "Etichette pronte", tono: "run" };
    } else {
      const v = msg.vista || {};
      rec.stampa = { jobs: jobs.map(({ fatto, ...j }) => j), fine };
      rec.stato = "avviso";
      rec.vista = { tag: "Stampato", testo: corto(v.testo), tono: "ok", quesito: corto(v.quesito, 90) };
    }
    await ordSlega(rec);
    await ordScrivi(l);
    reply({ ok: true });
    await ordAvanti(l);
    await ordConsegnaStampa(l);
  });
  // «Stampa» sulla striscia: le etichette in attesa, qui e adesso (un tocco del
  // medico); o «Ristampa» di un ordine già stampato dalla stampa automatica
  if (msg.t === "ordineStampaQui") return fai(async () => {
    const l = await ordLeggi();
    const rec = l.find((x) => x.id === msg.id && (x.stato === "stampa" || x.stato === "avviso") && x.stampa);
    reply({ ok: !!rec && await ordDai(l, rec, tab.id, true) });
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
    if (!rec || ATTIVI.has(rec.stato)) return reply({ ok: false });
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
// che lo stampa con SumatraPDF sulla stampante di quel foglio e dice se l'ha
// mandato. Chrome avvia l'aiutante per ogni domanda e lo chiude appena ha
// risposto: in Windows non resta acceso niente. Spenta con l'interruttore, non
// installata o con un errore, il foglio passa dal dialogo di sempre.
// Le scelte del medico stanno in storage.local: `stampa` = { attiva, etichette,
// a4 } (i nomi delle stampanti); `stampaEsito` = com'è andata l'ultima.
const OSPITE = "it.psassist.stampa";
const STAMPA_PDF_MAX = 25 * 1024 * 1024;   // come l'aiutante
// le parole di Chrome, dette per il medico
function ospiteErrore(e) {
  const m = String(e && e.message || e);
  if (/not found/i.test(m)) return "l'aiutante di stampa non è installato su questo PC";
  if (/forbidden/i.test(m)) return "Chrome non permette di usare l'aiutante di stampa (un altro ID dell'estensione, o una regola dell'IT): rilancia installa.cmd";
  if (/exited|communicating/i.test(m)) return "l'aiutante di stampa si è chiuso senza rispondere";
  return m.slice(0, 120);
}
async function ospite(msg, ms) {
  let tid;
  try {
    const r = await Promise.race([chrome.runtime.sendNativeMessage(OSPITE, msg),
      new Promise((_, no) => { tid = setTimeout(() => no(new Error("l'aiutante di stampa non ha risposto in tempo")), ms); })]);
    return r && typeof r === "object" ? r : { ok: false, why: "l'aiutante di stampa non ha risposto" };
  } catch (e) { return { ok: false, why: ospiteErrore(e) }; }
  finally { clearTimeout(tid); }
}
// Un foglio all'aiutante (che aspetta SumatraPDF al massimo un minuto), e
// l'esito annotato: l'indicatore del pannello diventa rosso se non è uscito.
async function stampaPdf(tipo, pdf, stampante) {
  const r = await ospite({ t: "stampa", tipo, stampante, pdf }, 75e3);
  const esito = r.ok ? { ok: true, stampante: corto(r.stampante || stampante, 80), ts: Date.now() }
    : { ok: false, why: corto(r.why || "non riuscita", 160), stampante: corto(stampante, 80), ts: Date.now() };
  await chrome.storage.local.set({ stampaEsito: esito }).catch(() => {});
  return esito;
}
// La pagina di prova, fatta qui: un PDF minimo con tre righe, nella misura del
// foglio (un'etichetta di 50×25 mm, o un A4).
function paginaDiProva(tipo, stampante) {
  const etichetta = tipo === "etichette";
  const [w, h] = etichetta ? [142, 71] : [595, 842];
  // (Helvetica, solo ASCII; su un'etichetta ci stanno una trentina di lettere)
  const ascii = (s) => String(s).normalize("NFD").replace(/[^\x20-\x7E]/g, "").slice(0, etichetta ? 34 : 60).replace(/[()\\]/g, "\\$&");
  const righe = [`PS Assist: prova ${etichetta ? "etichette" : "A4"}`, ascii(stampante), ascii(new Date().toLocaleString("it-IT"))];
  const [x, y, passo, corpo] = etichetta ? [8, 50, 14, 9] : [56, 770, 22, 16];
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
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || !["stampaPdf", "stampaStato", "stampaProva"].includes(msg.t)) return;
  const tipo = msg.tipo === "etichette" ? "etichette" : "a4";
  // un foglio da una pagina del gestionale: sulla stampante che il medico ha scelto per quel tipo
  if (msg.t === "stampaPdf") {
    if (!sulGestionale(sender && sender.url)) return reply({ ok: false, why: "non dal gestionale" }), true;
    (async () => {
      const s = (await chrome.storage.local.get("stampa")).stampa || {};
      if (s.attiva === false || !s.etichette || !s.a4) return reply({ ok: false, why: "la stampa automatica è spenta" });
      if (typeof msg.pdf !== "string" || msg.pdf.length > STAMPA_PDF_MAX / 3 * 4 + 4) return reply({ ok: false, why: "PDF troppo grande" });
      reply(await stampaPdf(tipo, msg.pdf, s[tipo]));
    })().catch((e) => reply({ ok: false, why: corto(e && e.message || e, 120) }));
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
  stampaPdf(tipo, paginaDiProva(tipo, stampante), stampante).then(reply);
  return true;
});

// Lo script sul portale scelto dal medico va rimesso a ogni avvio: le
// registrazioni dinamiche sopravvivono, ma se il permesso è stato revocato
// vanno tolte, e un doppione fa fallire register().
async function registraPortale(pattern) {
  try { await chrome.scripting.unregisterContentScripts({ ids: ["portale"] }); } catch { /* non c'era */ }
  try { await chrome.scripting.unregisterContentScripts({ ids: ["portale-pdf"] }); } catch { /* non c'era */ }
  if (!pattern) return;
  await chrome.scripting.registerContentScripts([{
    id: "portale", matches: [pattern], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true,
  }]);
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
