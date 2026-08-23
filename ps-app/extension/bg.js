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
    try { out.push(new URL(u, baseUrl).href); } catch { /* skip */ }
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
  const res = await fetch(url, { credentials: "include", redirect: "follow", cache: "no-store" });
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
        await chrome.storage.local.set({ [KEY(msg.id)]: { data, ts: Date.now(), size: r.buf.byteLength, ep: msg.ep || "" } });
        await prune();
        reply({ ok: true, size: r.buf.byteLength });
      })
      .catch((e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 60) }));
    return true; // async reply
  }

  if (msg.t === "getRef") {
    chrome.storage.local.get(KEY(msg.id)).then(async (o) => {
      const hit = o[KEY(msg.id)];
      // a document is only handed back for the episode it was saved under
      if (!hit || (msg.ep && hit.ep && hit.ep !== msg.ep)) return reply({ ok: false });
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
        if (msg.ep && rec.ep && rec.ep !== msg.ep) continue;     // and only this episode
        out[id] = rec.size || 1;
      }
      reply({ ok: true, cached: out });
    });
    return true;
  }

  if (msg.t === "clearRef") {
    chrome.storage.local.get(null).then(async (all) => {
      await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("ref:")));
      reply({ ok: true });
    });
    return true;
  }
});
