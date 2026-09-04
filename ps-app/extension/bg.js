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

function candidates(text, baseUrl) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const u = String(raw || "").trim().replace(/&amp;/gi, "&");
    if (!u || u.length < 8 || seen.has(u)) return;
    if (/^(javascript:|#|data:|blob:|mailto:)/i.test(u)) return;
    if (!/^(https?:)?\/|^[\w.-]+\.(?:do|rra2|pdf|jsp|html?)\b/i.test(u)) return;
    if (/[([+=&%]$|%27$/.test(u)) return;
    if (!PDF_SMELL.test(u)) return;
    seen.add(u);
    try {
      const abs = new URL(u, baseUrl);
      if (!ALLOWED_ORIGINS.has(abs.origin)) return;
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

async function grabPdf(url, hop = 0) {
  if (!ALLOWED_ORIGINS.has(new URL(url).origin)) return { ok: false, why: "fuori dall'ospedale" };
  // a hung hospital endpoint must fail a row, never hang the whole save
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { credentials: "include", redirect: "follow", cache: "no-store", signal: ctl.signal });
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, why: e && e.name === "AbortError" ? "timeout" : String(e && e.message || e).slice(0, 40) };
  }
  clearTimeout(tid);
  if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("pdf") || ctype.includes("octet-stream")) {
    return { ok: true, buf: await res.arrayBuffer(), type: "application/pdf" };
  }
  if (hop >= 2 || !ctype.includes("html")) return { ok: false, why: `tipo ${ctype.split(";")[0] || "?"}` };
  const text = await res.text();
  if (/name=["']?password/i.test(text)) return { ok: false, why: "sessione scaduta" };
  const cands = candidates(text, res.url || url);
  for (const c of cands) {
    try {
      const r = await grabPdf(c, hop + 1);
      if (r.ok) return r;
    } catch { /* next candidate */ }
  }
  return { ok: false, why: `visualizzatore (${cands.length} link tentati)` };
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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg === "psassist-reload") { chrome.runtime.reload(); return; }
  if (!msg || typeof msg !== "object") return;

  if (msg.t === "cacheRef") {
    grabPdf(msg.url)
      .then(async (r) => {
        if (!r.ok) return reply(r);
        const data = b64(r.buf);
        await chrome.storage.local.set({ [KEY(msg.id)]: { data, ts: Date.now(), size: r.buf.byteLength, ep: msg.ep || "", pk: msg.pk || "" } });
        await prune();
        reply({ ok: true, size: r.buf.byteLength });
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
    });
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
    });
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
    chrome.storage.session.get("apertura")
      .then((o) => {
        const a = o.apertura;
        reply(a && Date.now() - (a.ts || 0) < 20 * 60e3 ? { ok: true, ...a } : { ok: false });
      }).catch(() => reply({ ok: false }));
    return true;
  }

  if (msg.t === "putStorico") {
    const chiave = String(msg.chiave || "").slice(0, 80);
    if (!chiave || !msg.dati) return reply({ ok: false });
    inFila(async () => {
      const o = await chrome.storage.local.get(ARCH);
      const a = potaArchivio(o[ARCH] || {});
      const nuovo = !a[chiave];
      a[chiave] = msg.dati;
      await chrome.storage.local.set({ [ARCH]: potaArchivio(a) });
      reply({ ok: true, nuovo, pazienti: Object.keys(a).length });
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
    chrome.storage.local.get("portale").then((o) => reply({ ok: true, origine: o.portale || "" }));
    return true;
  }
  if (msg.t === "aggiungiPortale") {
    (async () => {
      let origine;
      try { origine = new URL(String(msg.url || "").trim()).origin; }
      catch { return reply({ ok: false, why: "Non è un indirizzo: incolla quello che vedi nella barra del browser." }); }
      if (!/^https?:$/.test(new URL(origine).protocol)) return reply({ ok: false, why: "Serve un indirizzo http o https." });
      const pattern = origine + "/*";
      const dato = await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
      if (!dato) return reply({ ok: false, why: "Permesso non concesso." });
      await registraPortale(pattern);
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
    });
    return true;
  }
});

// Lo script sul portale scelto dal medico va rimesso a ogni avvio: le
// registrazioni dinamiche sopravvivono, ma se il permesso è stato revocato
// vanno tolte, e un doppione fa fallire register().
async function registraPortale(pattern) {
  try { await chrome.scripting.unregisterContentScripts({ ids: ["portale"] }); } catch { /* non c'era */ }
  if (!pattern) return;
  try {
    await chrome.scripting.registerContentScripts([{
      id: "portale", matches: [pattern], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true,
    }]);
  } catch { /* Chrome lo dirà al medico col messaggio del pannello */ }
}
async function riallineaPortale() {
  const o = await chrome.storage.local.get("portale");
  if (!o.portale) return;
  const pattern = o.portale + "/*";
  const ok = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
  if (ok) await registraPortale(pattern);
  else { await registraPortale(null); await chrome.storage.local.remove("portale"); }
}
chrome.runtime.onStartup?.addListener(riallineaPortale);
chrome.runtime.onInstalled?.addListener(riallineaPortale);
