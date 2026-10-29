/*
 * PS Assist — il registratore, la parte nella pagina (gestionale e portale,
 * ogni riquadro). Non fa niente finché il medico non preme ⋯ → Registra; poi:
 *   - manda al service worker il DOM della pagina com'è dopo il caricamento (e
 *     com'è quando la si lascia, se nel frattempo è cambiato), senza il pannello;
 *   - segna le richieste che fa il PANNELLO (content.js vive in questo stesso
 *     mondo isolato: il suo fetch e il suo XMLHttpRequest sono questi), così il
 *     flusso dice quali sono dell'estensione; e se una di quelle risposte è un
 *     PDF, ne passa i byte, così non serve rileggerlo.
 * Niente esce dal PC: tutto va al service worker, che lo tiene finché il
 * medico non scarica (o cancella) la registrazione.
 */
(() => {
  if (globalThis.__psaRegistra) return;
  globalThis.__psaRegistra = true;
  let rec = false;
  const leggi = () => chrome.storage.local.get("registra").then((o) => {
    const r = o && o.registra;
    const prima = rec;
    rec = !!(r && r.stato === "rec" && Date.now() < r.scade);
    if (rec && !prima && document.readyState === "complete") setTimeout(() => scatta("caricata"), 300);
  }).catch(() => {});
  try {
    leggi();
    chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.registra) leggi(); });
  } catch { return; }
  const manda = (m) => { try { chrome.runtime.sendMessage(m, () => void chrome.runtime.lastError); } catch { /* estensione ricaricata */ } };
  const assoluto = (u) => { try { return new URL(String(u), location.href).href; } catch { return String(u || ""); } };

  // ------------------------------------------ le richieste del pannello
  const b64 = (buf) => {
    const u8 = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const forsePdf = (url, buf) => {
    if (!rec || !buf || buf.byteLength < 5 || buf.byteLength > 15 * 1024 * 1024) return;
    if (String.fromCharCode(...new Uint8Array(buf, 0, 5)) !== "%PDF-") return;
    manda({ t: "regPdf", url, b64: b64(buf) });
  };
  const f0 = globalThis.fetch;
  if (typeof f0 === "function") {
    globalThis.fetch = function (input, init) {
      const p = f0.apply(this, arguments);
      if (rec) {
        try {
          const url = assoluto(typeof input === "string" || input instanceof URL ? input : input && input.url);
          manda({ t: "regRichiesta", metodo: (init && init.method) || (input && input.method) || "GET", url, ts: Date.now() });
          p.then((res) => {
            if (/pdf|octet-stream/i.test(res.headers.get("content-type") || "")) res.clone().arrayBuffer().then((b) => forsePdf(res.url || url, b)).catch(() => {});
          }).catch(() => {});
        } catch { /* la richiesta parte comunque */ }
      }
      return p;
    };
  }
  const X = globalThis.XMLHttpRequest && globalThis.XMLHttpRequest.prototype;
  if (X) {
    const open0 = X.open, send0 = X.send;
    X.open = function (metodo, url) {
      try { this.__psaReg = { metodo: String(metodo || "GET").toUpperCase(), url: assoluto(url) }; } catch { /* niente */ }
      return open0.apply(this, arguments);
    };
    X.send = function () {
      const r = this.__psaReg;
      if (rec && r) {
        manda({ t: "regRichiesta", metodo: r.metodo, url: r.url, ts: Date.now() });
        this.addEventListener("load", () => {
          try { if (this.response instanceof ArrayBuffer) forsePdf(this.responseURL || r.url, this.response); } catch { /* niente */ }
        });
      }
      return send0.apply(this, arguments);
    };
  }

  // ---------------------------------------------------- la pagina vista
  let ultima = "";
  function scatta(motivo) {
    if (!rec || !document.documentElement) return;
    let html;
    try {
      const c = document.documentElement.cloneNode(true);
      c.querySelectorAll("#psassist-host").forEach((n) => n.remove());   // il pannello non è la pagina
      const dt = document.doctype;
      html = (dt ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ""}${dt.systemId ? ` "${dt.systemId}"` : ""}>\n` : "") + c.outerHTML;
    } catch { return; }
    if (html === ultima) return;
    ultima = html;
    manda({ t: "regPagina", url: location.href, titolo: document.title, html, motivo, ts: Date.now() });
  }
  const dopoIlCaricamento = () => setTimeout(() => scatta("caricata"), 800);
  if (document.readyState === "complete") dopoIlCaricamento();
  else addEventListener("load", dopoIlCaricamento, { once: true });
  addEventListener("pagehide", () => scatta("uscita"));
})();
