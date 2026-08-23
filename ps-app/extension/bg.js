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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg === "psassist-reload") { chrome.runtime.reload(); return; }
  if (!msg || typeof msg !== "object") return;

  if (msg.t === "cacheRef") {
    grabPdf(msg.url)
      .then(async (r) => {
        if (!r.ok) return reply(r);
        const data = b64(r.buf);
        await chrome.storage.local.set({ [KEY(msg.id)]: { data, ts: Date.now(), size: r.buf.byteLength } });
        reply({ ok: true, size: r.buf.byteLength });
      })
      .catch((e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 60) }));
    return true; // async reply
  }

  if (msg.t === "getRef") {
    chrome.storage.local.get(KEY(msg.id)).then((o) => {
      const hit = o[KEY(msg.id)];
      reply(hit ? { ok: true, data: hit.data } : { ok: false });
    });
    return true;
  }

  if (msg.t === "listRef") {
    chrome.storage.local.get(null).then((all) => {
      const out = {};
      for (const k of Object.keys(all)) if (k.startsWith("ref:")) out[k.slice(4)] = all[k].size || 1;
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
