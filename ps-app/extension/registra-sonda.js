/*
 * PS Assist — il registratore, la sonda nel visualizzatore di immagini del
 * PACS (eViewer: http://mmeviewer.multimedica.root.lan:18188, la fotocamera
 * «IMMAGINE» del gestionale). Gira nel MONDO DELLA PAGINA (manifest.json:
 * "world": "MAIN"), solo su quell'host, dall'inizio — perché quello che serve
 * sapere per progettare come mostrare le immagini sta solo lì:
 *   - che contesto ha ogni <canvas> (2d, webgl, webgl2…) e se tiene il disegno
 *     (preserveDrawingBuffer): dal mondo isolato chiederlo lo CREEREBBE;
 *   - da dove si disegna (un'<img> della stessa origine o d'altra, un blob, un
 *     ImageBitmap, pixel calcolati con putImageData / texImage2D): solo il tipo;
 *   - i WebSocket (che chrome.webRequest non vede): il percorso senza query,
 *     quanti messaggi e quanti byte, mai il contenuto;
 *   - i blob trasformati in indirizzi (URL.createObjectURL): tipo e misura.
 * Solo CONTA e DESCRIVE: mai un pixel, mai un byte, mai una query. Non manda
 * niente a nessuno: risponde soltanto a registra-pagina.js (mondo isolato,
 * stesso documento), che chiede con l'evento «psa-sonda-chiedi» — e solo
 * mentre si registra — e riceve una stringa JSON nell'evento «psa-sonda».
 */
(() => {
  const avvolgi = (oggetto, nome, fn) => {
    try {
      const d = oggetto && Object.getOwnPropertyDescriptor(oggetto, nome);
      if (!d || typeof d.value !== "function") return;
      const orig = d.value;
      Object.defineProperty(oggetto, nome, { ...d, value: function () { return fn.call(this, orig, arguments); } });
    } catch { /* la pagina resta com'è */ }
  };
  const senzaQuery = (u) => { try { const x = new URL(String(u), location.href); return (x.protocol + "//" + x.host + x.pathname).slice(0, 300); } catch { return ""; } };

  // ------------------------------------------------ i canvas e il loro contesto
  const contesti = new WeakMap();
  const perTipo = {};     // contesto → { n, pdb }: anche i canvas fuori dal documento
  function nota(el, tipo, attr, ctx) {
    if (!ctx || contesti.has(el)) return;
    let a = null;
    try { a = ctx.getContextAttributes ? ctx.getContextAttributes() : null; } catch { a = null; }
    const t = String(tipo || "").toLowerCase().replace(/[^\w-]/g, "").slice(0, 24) || "?";
    const x = { tipo: t, pdb: !!(a && a.preserveDrawingBuffer), wrf: !!((a && a.willReadFrequently) || (attr && attr.willReadFrequently)) };
    contesti.set(el, x);
    const p = perTipo[t] || (perTipo[t] = { n: 0, pdb: 0 });
    p.n++;
    if (x.pdb) p.pdb++;
  }
  const getContext = function (orig, a) { const c = orig.apply(this, a); try { nota(this, a[0], a[1], c); } catch { /* niente */ } return c; };
  if (typeof HTMLCanvasElement !== "undefined") avvolgi(HTMLCanvasElement.prototype, "getContext", getContext);
  if (typeof OffscreenCanvas !== "undefined") avvolgi(OffscreenCanvas.prototype, "getContext", getContext);

  // ----------------------------------------------- da dove si disegna (il tipo)
  const disegni = {};
  const conta = (k) => { if (disegni[k] || Object.keys(disegni).length < 60) disegni[k] = (disegni[k] || 0) + 1; };
  const fontiImg = new WeakMap();
  function fonte(s) {
    try {
      if (s == null) return "nessuna";
      if (typeof s === "number") return "buffer";
      if (typeof HTMLImageElement !== "undefined" && s instanceof HTMLImageElement) {
        const u = s.currentSrc || s.src || "";
        const g = fontiImg.get(s);
        if (g && g.u === u) return g.f;
        let f = "img";
        if (/^data:/i.test(u)) f = "img-data";
        else if (/^blob:/i.test(u)) f = "img-blob";
        else { try { f = new URL(u, location.href).origin === location.origin ? "img-stessa-origine" : s.crossOrigin != null ? "img-altra-origine-cors" : "img-altra-origine"; } catch { f = "img"; } }
        fontiImg.set(s, { u, f });
        return f;
      }
      if (typeof HTMLCanvasElement !== "undefined" && s instanceof HTMLCanvasElement) return "canvas";
      if (typeof OffscreenCanvas !== "undefined" && s instanceof OffscreenCanvas) return "offscreencanvas";
      if (typeof ImageBitmap !== "undefined" && s instanceof ImageBitmap) return "imagebitmap";
      if (typeof HTMLVideoElement !== "undefined" && s instanceof HTMLVideoElement) return "video";
      if (typeof ImageData !== "undefined" && s instanceof ImageData) return "imagedata";
      if (typeof VideoFrame !== "undefined" && s instanceof VideoFrame) return "videoframe";
      if (ArrayBuffer.isView(s)) return "pixel-" + String(s.constructor && s.constructor.name || "array").slice(0, 20);
      return "altro";
    } catch { return "?"; }
  }
  if (typeof CanvasRenderingContext2D !== "undefined") {
    avvolgi(CanvasRenderingContext2D.prototype, "drawImage", function (orig, a) { conta("2d drawImage " + fonte(a[0])); return orig.apply(this, a); });
    avvolgi(CanvasRenderingContext2D.prototype, "putImageData", function (orig, a) { conta("2d putImageData"); return orig.apply(this, a); });
  }
  // la sorgente di texImage2D: l'ultimo argomento (6 argomenti: un'immagine; 9 o più: pixel, null o un offset)
  const tex = (nome, i6, iN) => function (orig, a) { conta(`webgl ${nome} ${fonte(a.length === i6 ? a[i6 - 1] : a[iN])}`); return orig.apply(this, a); };
  for (const P of [typeof WebGLRenderingContext !== "undefined" && WebGLRenderingContext.prototype, typeof WebGL2RenderingContext !== "undefined" && WebGL2RenderingContext.prototype]) {
    if (!P) continue;
    avvolgi(P, "texImage2D", tex("texImage2D", 6, 8));
    avvolgi(P, "texSubImage2D", tex("texSubImage2D", 7, 8));
    avvolgi(P, "texImage3D", tex("texImage3D", 99, 9));
    avvolgi(P, "compressedTexImage2D", function (orig, a) { conta("webgl compressedTexImage2D"); return orig.apply(this, a); });
  }

  // ------------------------------------------- i WebSocket: quanto, mai cosa
  const prese = [], diPresa = new WeakMap();
  const misura = (d) => (typeof d === "string" ? d.length : d ? (d.byteLength ?? d.size ?? 0) : 0);
  const WS = typeof WebSocket === "function" ? WebSocket : null;
  if (WS) {
    try {
      const P = new Proxy(WS, {
        construct(t, a, nt) {
          const ws = Reflect.construct(t, a, nt);
          try {
            if (prese.length < 20) {
              let q = [];
              try { q = [...new Set(new URL(String(a[0]), location.href).searchParams.keys())].sort().slice(0, 20); } catch { /* niente */ }
              const p = { percorso: senzaQuery(a[0]), parametri: q, ricevuti: 0, binari: 0, byteRicevuti: 0, mandati: 0, byteMandati: 0, chiusa: false };
              prese.push(p);
              diPresa.set(ws, p);
              ws.addEventListener("message", (e) => { p.ricevuti++; if (typeof e.data !== "string") p.binari++; p.byteRicevuti += misura(e.data); });
              ws.addEventListener("close", () => { p.chiusa = true; });
            }
          } catch { /* il WebSocket resta quello della pagina */ }
          return ws;
        },
      });
      Object.defineProperty(window, "WebSocket", { ...Object.getOwnPropertyDescriptor(window, "WebSocket"), value: P });
      avvolgi(WS.prototype, "send", function (orig, a) { try { const p = diPresa.get(this); if (p) { p.mandati++; p.byteMandati += misura(a[0]); } } catch { /* niente */ } return orig.apply(this, a); });
    } catch { /* niente */ }
  }

  // --------------------------------------------- i blob diventati indirizzi
  const blob = {};
  avvolgi(URL, "createObjectURL", function (orig, a) {
    try {
      const o = a[0];
      const t = typeof Blob !== "undefined" && o instanceof Blob ? (String(o.type || "").toLowerCase().replace(/[^\w.+/-]/g, "").slice(0, 60) || "senza tipo")
        : typeof MediaSource !== "undefined" && o instanceof MediaSource ? "mediasource" : "altro";
      if (blob[t] || Object.keys(blob).length < 30) {
        const x = blob[t] || (blob[t] = { n: 0, byte: 0, max: 0 });
        const s = typeof Blob !== "undefined" && o instanceof Blob ? o.size : 0;
        x.n++; x.byte += s; x.max = Math.max(x.max, s);
      }
    } catch { /* niente */ }
    return orig.apply(this, a);
  });

  // --------------------------------------------------------- la risposta
  document.addEventListener("psa-sonda-chiedi", () => {
    try {
      const canvas = [...document.querySelectorAll("canvas")].slice(0, 60).map((c) => contesti.get(c) || null);
      document.dispatchEvent(new CustomEvent("psa-sonda", { detail: JSON.stringify({ canvas, perTipo, disegni, prese, blob }) }));
    } catch { /* niente */ }
  });
})();
