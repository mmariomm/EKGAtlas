/*
 * PS Assist — sul portale, nel mondo della pagina.
 *
 * Il portale non dà il referto come file: lo scarica da sé e lo mostra (un
 * indirizzo blob:, o disegnato da un suo lettore). Da fuori non si legge, e
 * rifare noi la richiesta vorrebbe dire saltare l'interfaccia. Qui si GUARDA
 * soltanto: quando la pagina ha in mano un PDF — un Blob che diventa
 * indirizzo, una risposta del suo server che è un PDF — se ne passa una copia
 * al pannello, nella stessa scheda (content.js, che decide se serve: solo
 * nelle schede che il pannello ha aperto per leggere un referto).
 * Niente di quello che la pagina fa viene cambiato; un errore qui non esce.
 */
(() => {
  if (window.__psassistPdf) return;
  try { Object.defineProperty(window, "__psassistPdf", { value: true }); } catch { return; }
  const ORIGINE = location.origin;
  const MAX = 40 * 1024 * 1024;
  const visti = [];                        // gli ultimi PDF visti, per chi arriva dopo
  const conta = { blob: 0, rete: 0, pdf: 0 };
  let sotto = false;                       // scheda aperta dal pannello: niente finestre nuove

  const al = (msg) => { try { window.top.postMessage(msg, ORIGINE); } catch { /* niente */ } };
  const preso = (buf, via) => {
    conta.pdf++;
    visti.push({ buf, via });
    if (visti.length > 4) visti.shift();
    al({ psassistPdf: 1, buf, via });
  };
  const ePdf = (buf) => buf && buf.byteLength > 8 && buf.byteLength < MAX && String.fromCharCode(...new Uint8Array(buf, 0, 5)) === "%PDF-";
  const guarda = (blob, via) => {
    try {
      if (!(blob instanceof Blob) || blob.size < 8 || blob.size > MAX) return;
      blob.slice(0, 5).arrayBuffer().then((t) => {
        if (String.fromCharCode(...new Uint8Array(t)) !== "%PDF-") return null;
        return blob.arrayBuffer().then((buf) => preso(buf, via));
      }).catch(() => {});
    } catch { /* niente */ }
  };

  // 1. un Blob che diventa indirizzo (il modo più comune di mostrare un PDF scaricato)
  const creaUrl = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const u = creaUrl.apply(this, arguments);
    try { if (obj instanceof Blob) { conta.blob++; guarda(obj, "blob"); } } catch { /* niente */ }
    return u;
  };
  // 2. una risposta del suo server che è un PDF (anche se poi lo disegna lei)
  const prendi = window.fetch;
  if (prendi) {
    window.fetch = function () {
      const p = prendi.apply(this, arguments);
      p.then((r) => {
        try {
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          if (/pdf|octet-stream/.test(ct)) { conta.rete++; r.clone().blob().then((b) => guarda(b, "fetch")).catch(() => {}); }
        } catch { /* niente */ }
      }).catch(() => {});
      return p;
    };
  }
  const manda = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    try {
      this.addEventListener("load", () => {
        try {
          const t = this.responseType;
          if (t === "blob" && this.response) { conta.rete++; guarda(this.response, "xhr"); }
          // i byte ci sono già: la copia parte SUBITO, prima che la pagina
          // salti altrove (il portale, avuto il PDF, porta la scheda sul blob:)
          else if (t === "arraybuffer" && this.response) { conta.rete++; if (ePdf(this.response)) preso(this.response.slice(0), "xhr"); }
        } catch { /* niente */ }
      });
    } catch { /* niente */ }
    return manda.apply(this, arguments);
  };
  // 3. in una scheda aperta dal pannello (dietro, non la guarda nessuno) il
  //    PDF non si apre altrove: né in una finestra nuova, né portando la
  //    scheda sul blob: — la pagina deve restare finché la copia è partita
  const apri = window.open;
  window.open = function (u) {
    try { if (sotto && /^blob:/i.test(String(u || ""))) return null; } catch { /* niente */ }
    return apri.apply(this, arguments);
  };
  try {
    window.navigation?.addEventListener("navigate", (e) => {
      try { if (sotto && e.cancelable && /^blob:/i.test(e.destination.url)) e.preventDefault(); } catch { /* niente */ }
    });
  } catch { /* browser senza Navigation API */ }

  // content.js parte a pagina pronta: chiede quelli già visti, e dice se la
  // scheda è una delle sue
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.origin !== ORIGINE || !d || typeof d !== "object") return;
    if (d.psassistSotto === 1) sotto = true;
    if (d.psassistPdfChiedi !== 1) return;
    al({ psassistPdfPronto: 1, ...conta, frame: window !== window.top });
    for (const v of visti) al({ psassistPdf: 1, buf: v.buf, via: v.via });
  });
})();
