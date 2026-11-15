//@frammento 65-pdf-testo.js — PDF → TESTO (estraiTestoPdf, pdf.js, visore: build.mjs ne prende le funzioni per registra-pdf.js)
//@ e DI CHI È QUESTO REFERTO.
  // ============================================================ PDF → TESTO
  // Radiology and ECG reports are PDFs whose text can be recovered: the fonts
  // carry their own ToUnicode map, so glyph codes can be translated exactly
  // instead of guessed. (Laboratory reports cannot: they are drawn one glyph
  // at a time with a subset font and no map — those stay documents to open.)
  async function estraiTestoPdf(bytes) {
    // NB: TextDecoder("latin1") is windows-1252 in the browser and rewrites
    // bytes 0x80-0x9F — which corrupts every compressed stream. One byte, one
    // code unit, by hand.
    const byteStr = (u8) => {
      let out = "";
      for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return out;
    };
    const lat = byteStr(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    const objs = new Map();
    for (const m of lat.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)) objs.set(Number(m[1]), m[2]);
    if (!objs.size) return [];

    // The browser only decompresses asynchronously, so the whole extraction is
    // async: zlib-wrapped first (what PDFs use), raw deflate as a fallback.
    const inflate = async (grezzo) => {
      const buf = new Uint8Array(grezzo.length);
      for (let i = 0; i < grezzo.length; i++) buf[i] = grezzo.charCodeAt(i) & 0xff;
      for (const modo of ["deflate", "deflate-raw"]) {
        try {
          const ds = new DecompressionStream(modo);
          const out = new Response(new Blob([buf]).stream().pipeThrough(ds));
          return new TextDecoder("latin1").decode(await out.arrayBuffer());
        } catch { /* try the next mode */ }
      }
      return null;
    };
    const streamOf = async (body) => {
      const i = body.indexOf("stream");
      if (i < 0) return null;
      let a = i + 6;
      if (body[a] === "\r") a++;
      if (body[a] === "\n") a++;
      const e = body.lastIndexOf("endstream");
      if (e < 0 || e <= a) return null;
      // exact length when the dictionary states it (a trailing newline would
      // make the decompressor reject the whole stream), else trim it by hand
      const len = /\/Length\s+(\d+)/.exec(body.slice(0, i));
      const grezzo = len && a + Number(len[1]) <= e
        ? body.slice(a, a + Number(len[1]))
        : body.slice(a, e).replace(/\r?\n$/, "");
      if (!/\/FlateDecode/.test(body.slice(0, i))) return grezzo;
      return await inflate(grezzo);
    };

    const hexToStr = (h) => {
      let out = "";
      for (let i = 0; i + 3 < h.length + 1; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
      return out;
    };
    const parseCMap = (txt) => {
      const map = new Map();
      const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(txt);
      const primo = cs && /<([0-9A-Fa-f]{2,})>/.exec(cs[1]);
      map.byteLen = primo ? Math.max(1, Math.floor(primo[1].length / 2)) : 1;
      for (const b of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const m of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
      }
      for (const b of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const m of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
          const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), dst = parseInt(m[3], 16);
          for (let c = lo; c <= hi && c - lo < 4096; c++) map.set(c, String.fromCharCode(dst + (c - lo)));
        }
      }
      return map;
    };
    const cmapDiOggetto = new Map();
    for (const [num, body] of objs) {
      const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(body);
      if (!tu) continue;
      const src = objs.get(Number(tu[1]));
      const txt = src && await streamOf(src);
      if (txt) cmapDiOggetto.set(num, parseCMap(txt));
    }
    const fonts = new Map();
    for (const [, body] of objs) {
      for (const m of body.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
        const cm = cmapDiOggetto.get(Number(m[2]));
        if (cm) fonts.set(m[1], cm);
      }
    }

    let content = "";
    for (const [, body] of objs) {
      if (!/\/Type\s*\/Page[^s]/.test(body)) continue;
      const c = /\/Contents\s+(\d+)\s+0\s+R/.exec(body);
      if (c && objs.has(Number(c[1]))) content += ((await streamOf(objs.get(Number(c[1])))) || "") + "\n";
    }
    if (!content.trim()) {
      let best = "";
      for (const [, body] of objs) {
        const t = (await streamOf(body)) || "";
        if ((t.match(/T[jJ]/g) || []).length > (best.match(/T[jJ]/g) || []).length) best = t;
      }
      content = best;
    }
    if (!content.trim()) return [];

    // la matrice del testo per intero: (a b c d) dice in che direzione si
    // scrive — un ECG in orizzontale è ruotato di 90° — e Td si muove in quella
    let cm = null, x = 0, y = 0, ma = 1, mb = 0, mc = 0, md = 1;
    const items = [];
    const unesc = (t) => t.replace(/\\([nrtbf()\\])/g, (m, c) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[c] || c))
      .replace(/\\([0-7]{1,3})/g, (m, o) => String.fromCharCode(parseInt(o, 8)));
    const decode = (t) => {
      if (!cm) return t;
      const n = cm.byteLen || 1;
      let out = "";
      for (let i = 0; i < t.length; i += n) {
        let code = 0;
        for (let k = 0; k < n && i + k < t.length; k++) code = (code << 8) | (t.charCodeAt(i + k) & 0xff);
        const u = cm.get(code);
        out += u !== undefined ? u : (n === 1 ? t[i] : "");
      }
      return out;
    };
    // strings come either literal — (testo) — or hexadecimal — <00520041>
    const daHex = (h) => {
      const pulito = h.replace(/[^0-9A-Fa-f]/g, "");
      let out = "";
      for (let i = 0; i + 1 < pulito.length; i += 2) out += String.fromCharCode(parseInt(pulito.slice(i, i + 2), 16));
      return out;
    };
    // BT resets the text matrix: without this the Td offsets of every block
    // pile up and the lines come out in the wrong order.
    const re = /\bBT\b|\/(F\d+)[^\S\n]+[\d.]+\s+Tf|([\d.-]+)\s+([\d.-]+)\s+T[dD]|([\d.-]+\s+){4}([\d.-]+)\s+([\d.-]+)\s+Tm|\((?:\\.|[^()\\])*\)\s*Tj|<[0-9A-Fa-f\s]*>\s*Tj|\[[\s\S]*?\]\s*TJ/g;
    for (const m of content.matchAll(re)) {
      const t = m[0];
      if (t === "BT") { x = 0; y = 0; ma = 1; mb = 0; mc = 0; md = 1; continue; }
      // cambiare font azzera la mappa: un font senza ToUnicode va letto
      // grezzo, non con la tabella di un altro font (i caratteri cambierebbero)
      if (t.startsWith("/F")) { const nf = t.slice(1).split(/\s/)[0]; cm = fonts.has(nf) ? fonts.get(nf) : null; continue; }
      if (/Tm$/.test(t)) { const n = t.trim().split(/\s+/).map(parseFloat); [ma, mb, mc, md, x, y] = n; continue; }
      if (/T[dD]$/.test(t)) { const n = t.trim().split(/\s+/).map(parseFloat); x += n[0] * ma + n[1] * mc; y += n[0] * mb + n[1] * md; continue; }
      if (/Tj$/.test(t)) {
        const grezzo = t.trim().startsWith("<")
          ? daHex(t.slice(t.indexOf("<") + 1, t.lastIndexOf(">")))
          : unesc(t.slice(t.indexOf("(") + 1, t.lastIndexOf(")")));
        items.push({ x, y, ma, mb, s: decode(grezzo) });
        continue;
      }
      let s2 = "";
      for (const p of t.matchAll(/\((?:\\.|[^()\\])*\)|<[0-9A-Fa-f\s]*>/g)) {
        s2 += decode(p[0][0] === "<" ? daHex(p[0].slice(1, -1)) : unesc(p[0].slice(1, -1)));
      }
      items.push({ x, y, ma, mb, s: s2 });
    }
    if (!items.length) return [];

    // rebuild lines from the coordinates: same y is the same line — y e x nel
    // sistema della scrittura (ruotato come il testo), una direzione alla volta
    const QUARTI = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const perVerso = new Map();
    for (const it of items) {
      const q = ((Math.round(Math.atan2(it.mb || 0, it.ma || 0) / (Math.PI / 2)) % 4) + 4) % 4;
      const [c, sn] = QUARTI[q];
      if (!perVerso.has(q)) perVerso.set(q, []);
      perVerso.get(q).push({ s: it.s, x: it.x * c + it.y * sn, y: -it.x * sn + it.y * c });
    }
    const righe = [];
    for (const gruppo of perVerso.values()) {
    gruppo.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
    let cur = null;
    for (const it of gruppo) {
      if (!it.s) continue;
      if (!cur || Math.abs(cur.y - it.y) > 2) { cur = { y: it.y, parts: [] }; righe.push(cur); }
      cur.parts.push(it);
    }
    }
    return righe.map((l) => {
      const passi = [];
      for (let i = 1; i < l.parts.length; i++) {
        const dx = l.parts[i].x - l.parts[i - 1].x, n = Math.max(1, l.parts[i - 1].s.length);
        if (dx > 0) passi.push(dx / n);
      }
      passi.sort((a, b) => a - b);
      const unita = passi.length ? passi[Math.floor(passi.length / 2)] : 6;
      let out = "", prev = null;
      for (const p of l.parts) {
        if (prev) {
          const dx = p.x - prev.x;
          if (dx > unita * Math.max(1, prev.s.length) * 0.7 && !/\s$/.test(out) && !/^\s/.test(p.s)) out += " ";
        }
        out += p.s; prev = p;
      }
      return out.replace(/\s+/g, " ").trim();
    }).filter(Boolean);
  }

  // pdf.js (Mozilla) è il lettore vero: cifratura, oggetti compressi, font
  // con nomi qualsiasi, testo dentro i moduli — tutto quello che il lettore
  // qui sopra non sa. Sta dentro l'estensione e si carica nella scheda solo
  // la prima volta che serve (il service worker lo mette nel mondo isolato
  // del pannello, mai nella pagina). Senza estensione resta il lettore di casa.
  let pdfjsInArrivo = null;
  function pdfjsPronto() {
    if (globalThis.pdfjsLib?.getDocument && globalThis.pdfjsWorker?.WorkerMessageHandler) return Promise.resolve(globalThis.pdfjsLib);
    if (!hasExt()) return Promise.resolve(null);
    return pdfjsInArrivo = pdfjsInArrivo || ask({ t: "pdfjs" }).then((r) => {
      const lib = r && r.ok && globalThis.pdfjsLib?.getDocument ? globalThis.pdfjsLib : null;
      if (!lib) pdfjsInArrivo = null;   // si riprova al prossimo referto
      return lib;
    });
  }

  // Il visore dei referti salvati: il PDF disegnato da pdf.js sopra la pagina,
  // chi · esame · quando in testa. ✕ (o Esc) e si torna agli Esiti.
  // Senza stampa automatica: il PDF in una cornice invisibile e il dialogo di
  // stampa del browser (la stampante la sceglie il medico).
  function stampaDialogoPdf(buf) {
    if (extPersa()) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(buf).slice()], { type: "application/pdf" }));
    const f = document.createElement("iframe");
    f.id = "psassist-stampa-referto";
    f.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;opacity:0;pointer-events:none";
    f.addEventListener("load", () => {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch { openTab(url, "_blank"); }
      setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120e3);
    }, { once: true });
    f.src = url;
    document.documentElement.appendChild(f);
  }
  function apriVisore(lib, buf, titolo, { stampa = null } = {}) {
    document.getElementById("psassist-visore")?.remove();
    const host = document.createElement("div");
    host.id = "psassist-visore";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
      .vfondo { position: fixed; inset: 0; z-index: 2147483647; background: rgba(9,42,74,.45); display: flex; padding: 2vh 2vw; }
      .vis { display: flex; flex-direction: column; width: min(980px, 100%); margin: 0 auto; background: #fff;
             border-radius: 12px; overflow: hidden; box-shadow: 0 12px 40px rgba(9,42,74,.35); }
      .vhd { display: flex; align-items: center; gap: 10px; padding: 9px 10px 9px 16px; border-bottom: 1px solid #D9E2EC; color: #16232E; }
      .vtit { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .vx { border: 0; background: #EEF3F8; color: #16232E; border-radius: 8px; width: 34px; height: 34px; font-size: 15px; cursor: pointer; }
      .vx:hover { background: #DCE6F0; }
      .vst { border: 0; background: #0B5CAD; color: #fff; border-radius: 8px; height: 34px; padding: 0 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
      .vst:hover { background: #094a8c; }
      .vst:disabled { background: #7FA6CB; cursor: default; }
      .vpag { flex: 1; overflow: auto; background: #E9EEF3; padding: 14px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
      canvas { display: block; max-width: 100%; background: #fff; box-shadow: 0 2px 8px rgba(9,42,74,.18); }
      .verr { color: #B3261E; font-size: 13px; }
    </style>
    <div class="vfondo"><div class="vis" role="dialog" aria-modal="true" aria-label="${esc(titolo)}">
      <div class="vhd"><b class="vtit" title="${esc(titolo)}">${esc(titolo)}</b>${
        stampa ? `<button class="vst" id="vstampa" title="Stampa questo PDF sulla stampante A4 (Invio, P o Ctrl+P)" aria-keyshortcuts="P Control+P">Stampa</button>` : ""}<button class="vx" id="vchiudi" title="Chiudi (Esc)" aria-label="Chiudi">✕</button></div>
      <div class="vpag"></div>
    </div></div>`;
    document.documentElement.appendChild(host);
    let doc = null;
    // Esc chiude; P (o Ctrl+P, che stamperebbe la pagina sotto) è «Stampa», quando c'è
    const tasto = (ev) => {
      if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); chiudi(); return; }
      const st = root.getElementById("vstampa");
      if (!st || ev.altKey || ev.shiftKey || String(ev.key).toLowerCase() !== "p") return;
      ev.stopPropagation(); ev.preventDefault();
      if (!st.disabled && !ev.repeat) st.click();
    };
    const chiudi = () => {
      window.removeEventListener("keydown", tasto, true);
      host.remove();
      if (doc) Promise.resolve(doc.destroy()).catch(() => {});
    };
    window.addEventListener("keydown", tasto, true);
    root.getElementById("vchiudi").addEventListener("click", chiudi);
    // «Stampa»: un tocco, una stampa (la stampa automatica sull'A4, se no il
    // dialogo, che ha la sua cornice), e il referto si chiude: com'è andata lo
    // dice la striscia. Se la stampa non parte, il visore resta.
    root.getElementById("vstampa")?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      const come = await Promise.resolve(stampa()).catch(() => "");
      if (come === "auto" || come === "dialogo") return chiudi();
      b.disabled = false;
    });
    root.querySelector(".vfondo").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) chiudi(); });
    // il fuoco su «Stampa» (Invio stampa), se c'è; se no sul ✕
    (root.getElementById("vstampa") || root.getElementById("vchiudi")).focus();
    const pag = root.querySelector(".vpag");
    (async () => {
      // (i font: quelli del PDF, o — se non ci sono — quelli di sistema, per disegnare)
      doc = await lib.getDocument({ data: new Uint8Array(buf).slice(), isEvalSupported: false, disableFontFace: false,
        useSystemFonts: true, useWorkerFetch: false, disableAutoFetch: true, disableStream: true, verbosity: 0 }).promise;
      const dpr = window.devicePixelRatio || 1;
      for (let n = 1; n <= doc.numPages && host.isConnected; n++) {
        const p = await doc.getPage(n);
        const largo = Math.max(320, pag.clientWidth - 28);
        const vp = p.getViewport({ scale: (largo / p.getViewport({ scale: 1 }).width) * dpr });
        const c = document.createElement("canvas");
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        c.style.width = `${Math.floor(vp.width / dpr)}px`;
        c.setAttribute("aria-label", `Pagina ${n}`);
        pag.appendChild(c);
        await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      }
    })().catch(() => { if (host.isConnected) pag.insertAdjacentHTML("beforeend", `<div class="verr">PDF non disegnato.</div>`); });
    return true;
  }

  // Pezzi di testo con la loro posizione → righe: stessa linea di base, stessa
  // riga; dentro la riga da sinistra a destra, con uno spazio dove c'è un buco.
  // La direzione la dice la matrice INTERA del pezzo (t = [a b c d e f]), non
  // solo il punto (e, f): un ECG in orizzontale su una pagina verticale scrive
  // ruotato di 90°, e leggendo solo (e, f) le righe uscivano a pezzi, mescolate.
  // Ogni pezzo si riporta nel sistema della sua scrittura (u lungo la riga, v
  // verso l'alto della riga); i pezzi con la stessa direzione stanno insieme.
  function righeDaPezzi(pezzi) {
    const QUARTI = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const gruppi = new Map();
    for (const q of pezzi) {
      if (!q.s) continue;
      const t = Array.isArray(q.t) && q.t.length >= 6 ? q.t : null;
      const quarto = t && (t[0] || t[1]) ? ((Math.round(Math.atan2(t[1], t[0]) / (Math.PI / 2)) % 4) + 4) % 4 : 0;
      const [c, sn] = QUARTI[quarto];
      const x = q.x ?? (t ? t[4] : 0), y = q.y ?? (t ? t[5] : 0);
      if (!gruppi.has(quarto)) gruppi.set(quarto, []);
      gruppi.get(quarto).push({ ...q, x: x * c + y * sn, y: -x * sn + y * c });
    }
    return [...gruppi.values()].flatMap(righeDritte);
  }
  function righeDritte(pezzi) {
    const righe = [];
    for (const p of pezzi.filter((q) => q.s).sort((a, b) => b.y - a.y)) {
      const r = righe[righe.length - 1];
      if (r && Math.abs(r.y - p.y) <= Math.max(2, Math.min(r.h, p.h) * 0.4)) r.parti.push(p);
      else righe.push({ y: p.y, h: p.h, parti: [p] });
    }
    return righe.map((r) => {
      let out = "", prev = null;
      for (const p of r.parti.sort((a, b) => a.x - b.x)) {
        if (prev && !/\s$/.test(out) && !/^\s/.test(p.s) && p.x - (prev.x + prev.w) > Math.max(prev.h, p.h) * 0.2) out += " ";
        out += p.s; prev = p;
      }
      return out.replace(/\s+/g, " ").trim();
    }).filter(Boolean);
  }

  async function testoPdfjs(lib, bytes) {
    // una COPIA: pdf.js si prende il buffer che gli si passa, e questo serve
    // ancora intero per tenere il PDF
    const doc = await lib.getDocument({
      data: new Uint8Array(bytes).slice(), isEvalSupported: false, disableFontFace: true,
      useSystemFonts: false, useWorkerFetch: false, disableAutoFetch: true, disableStream: true, verbosity: 0,
    }).promise;
    try {
      const righe = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const { items } = await (await doc.getPage(n)).getTextContent();
        righe.push(...righeDaPezzi(items.map((it) => {
          const t = it.transform || [1, 0, 0, 1, 0, 0];
          return { x: t[4], y: t[5], t, w: it.width || 0, h: Math.hypot(t[2], t[3]) || it.height || 10, s: it.str || "" };
        })));
      }
      return righe;
    } finally { Promise.resolve(doc.destroy()).catch(() => {}); }
  }

  // Il testo di un referto: pdf.js se c'è, il lettore di casa se no (o se
  // pdf.js non ne cava niente). Dice anche chi l'ha letto, o perché nessuno.
  async function testoPdf(bytes) {
    let motivo = "";
    const lib = await pdfjsPronto().catch(() => null);
    if (lib) {
      try {
        const righe = await testoPdfjs(lib, bytes);
        if (righe.length) return { righe, lettore: "pdf.js" };
        motivo = "pdf.js: nessun testo";
      } catch (e) { motivo = `pdf.js: ${(e && (e.name || "errore"))}${e && e.message ? ` ${String(e.message).slice(0, 80)}` : ""}`; }
    } else if (hasExt()) motivo = "pdf.js non caricato";
    const righe = await estraiTestoPdf(bytes).catch(() => []);
    return { righe, lettore: "lettore di casa", motivo };
  }

  // Com'è fatto un PDF, senza una parola di quello che c'è scritto: versione,
  // cifratura, oggetti compressi, font e codifiche, filtri, immagini, chi l'ha
  // prodotto. È quello che serve per capire perché il testo non esce.
  function pdfDiag(bytes) {
    try {
      const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
      let t = "";
      for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      const conta = (re) => (t.match(re) || []).length;
      const tipi = (re) => [...new Set([...t.matchAll(re)].map((m) => m[1]))].slice(0, 6).join(",") || "—";
      const enc = /\/Encrypt\s+(\d+)\s+\d+\s+R/.exec(t);
      const encObj = enc ? (new RegExp(`\\b${enc[1]}\\s+\\d+\\s+obj([\\s\\S]{0,400}?)endobj`).exec(t) || [])[1] || "" : "";
      const vr = encObj ? `V${(/\/V\s+(\d)/.exec(encObj) || [])[1] || "?"}/R${(/\/R\s+(\d)/.exec(encObj) || [])[1] || "?"}${/\/AESV[23]/.test(encObj) ? " AES" : ""}` : "";
      const leggibile = (re) => { const m = re.exec(t); return m && /^[\x20-\x7E]{2,60}$/.test(m[1]) ? m[1] : ""; };
      const prod = leggibile(/\/Producer\s*\(([^)]{2,60})\)/);   // il programma, non l'autore
      return [
        `PDF ${(/%PDF-(\d\.\d)/.exec(t) || [])[1] || "?"} ${Math.round(u8.length / 1024)}KB`,
        enc ? `cifrato ${vr}` : "non cifrato",
        `ObjStm ${conta(/\/Type\s*\/ObjStm/g)}`,
        `pagine ${conta(/\/Type\s*\/Page(?!s)/g) || "?"}`,
        `font ${tipi(/\/Subtype\s*\/(Type0|TrueType|Type1|Type3|MMType1)\b/g)}`,
        `encoding ${tipi(/\/Encoding\s*\/([A-Za-z0-9-]+)/g)}`,
        `ToUnicode ${conta(/\/ToUnicode\b/g)}`,
        `filtri ${tipi(/\/Filter\s*\[?\s*\/([A-Za-z0-9]+)/g)}`,
        `immagini ${conta(/\/Subtype\s*\/Image\b/g)}`,
        `moduli ${conta(/\/Subtype\s*\/Form\b/g)}`,
        prod ? `prodotto da «${prod}»` : "",
      ].filter(Boolean).join(" · ");
    } catch (e) { return `diagnosi PDF non riuscita (${e && e.message})`; }
  }

  // ------------------------------------------------ DI CHI È QUESTO REFERTO
  // Ogni testo di referto passa di qui prima di essere mostrato: il codice
  // fiscale scritto nel PDF (o nome + data di nascita) contro il paziente
  // della pagina. «altro» = il testo non si mostra; «ignota» = si mostra, con
  // «intestazione non verificata»; «ok» = si mostra.
  //   paz: { cf (in chiaro, dal riquadro), cfImp (impronta, dai prelievi), nome, nascita "gg/mm/aaaa" }
  function identitaReferto(righe, paz) {
    const p = paz || {};
    const testo = (righe || []).join("\n").toUpperCase();
    const norm = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z0-9 ]+/g, " ").trim().replace(/\s+/g, " ");
    const cfMio = String(p.cf || "").toUpperCase();
    const cfs = [...new Set(testo.match(/\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/g) || [])];
    const giorno = (g, m, a) => {
      const aa = Number(a) < 100 ? Number(a) : Number(a) % 100;
      return `${String(Number(g)).padStart(2, "0")}/${String(Number(m)).padStart(2, "0")}/${String(aa).padStart(2, "0")}`;
    };
    const nascitaMia = (/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(String(p.nascita || "").trim()) || []).slice(1);
    const mia = nascitaMia.length === 3 ? giorno(...nascitaMia) : "";
    // la data di nascita dentro un codice fiscale (il secolo non c'è)
    const nascitaCf = (cf) => {
      const n = (t) => Number(t.replace(/[LMNPQRSTUV]/g, (c) => "LMNPQRSTUV".indexOf(c)));
      const mese = "ABCDEHLMPRST".indexOf(cf[8]) + 1, g = n(cf.slice(9, 11)) % 40;
      return mese && g ? giorno(g, mese, n(cf.slice(6, 8))) : "";
    };
    if (cfs.length) {
      if (cfs.some((c) => (cfMio && c === cfMio) || (p.cfImp && impronta(c) === p.cfImp))) return { esito: "ok", via: "codice fiscale" };
      if (cfMio || p.cfImp) return { esito: "altro", via: "codice fiscale" };
      // il codice del paziente non lo sappiamo ancora: ma la data di nascita dentro il codice sì
      if (mia && cfs.every((c) => nascitaCf(c) && nascitaCf(c) !== mia)) return { esito: "altro", via: "data di nascita nel codice fiscale" };
    }
    const parole = norm(p.nome).split(" ").filter((x) => x.length >= 2);
    const tutto = " " + norm(testo) + " ";
    const nomeC = parole.length > 0 && parole.every((x) => tutto.includes(" " + x + " "));
    // un nome scritto con la sua etichetta («Paziente: BIANCHI ANNA») che non ha niente del nostro
    // (con i due punti: «Paziente collaborante» nel corpo del referto non è un nome)
    const etich = /\b(?:PAZIENTE|COGNOME E NOME|NOMINATIVO|ASSISTITO)\s*:\s*([A-ZÀ-Ü' ]{4,60})/.exec(testo);
    if (etich && parole.length) {
      const sue = norm(etich[1]).split(" ").filter((x) => x.length >= 3);
      if (sue.length && !sue.some((x) => parole.includes(x))) return { esito: "altro", via: "nome" };
    }
    const dn = /(?:NAT[OA]\b[^\n]{0,40}?\bIL|DATA\s+(?:DI\s+)?NASCITA|NASCITA|D\.\s?N\.)\s*[:.]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(testo);
    if (dn && mia) {
      const sua = giorno(dn[1], dn[2], dn[3]);
      if (sua !== mia) return { esito: "altro", via: "data di nascita" };
      if (nomeC) return { esito: "ok", via: "nome e data di nascita" };
    }
    return { esito: "ignota", via: "" };
  }

  // ECG: si mostra SOLO il referto scritto dal cardiologo, mai le frasi e le
  // misure della macchina (FC, PR, QRS, QTc, assi, «interpretazione
  // automatica»…). Il referto scritto sta sotto la sua intestazione («Referto»,
  // «Conclusioni», «Commento»…) fino alla firma. Senza intestazione: se ci sono
  // misure è il tracciato della macchina, e un referto scritto non c'è; se non
  // ce ne sono è un documento scritto, e lo si mostra.
  function refertoScrittoEcg(righe) {
    const tutte = (righe || []).map((r) => String(r || "").trim()).filter(Boolean);
    // ciò che scrive solo la macchina: derivazioni, misure in tabella, «automatica»
    const struttura = (r) => /^(?:I|II|III|aVR|aVL|aVF|V[1-6])(?:\s+(?:I|II|III|aVR|aVL|aVF|V[1-6]))*$/i.test(r)
      || /interpretazione automatica|analisi automatica|referto automatico|non confermat|unconfirmed|computerizzat|\bmisure\b|\bmeasurements?\b/i.test(r)
      || /^(?:FC|HR|PR|QRS|QTc?[BF]?|QT\/QTc|RR|P\/QRS\/T|Assi?|Axis|Frequenza(?:\s+ventricolare)?|Vent\.?\s*rate)\b\s*[:=]?\s*[-\d]/i.test(r)
      || /\d\s*(?:mm\/s|mm\/mv|hz)(?![a-z])/i.test(r);
    // …e una misura qualsiasi: dice che il PDF è il tracciato (non conta dentro il referto scritto)
    const macchina = (r) => struttura(r) || /\d\s*(?:ms|msec|bpm|b\/min|battiti\/min|\/min|°)(?![a-z])/i.test(r);
    const testa = /^(?:referto(?:\s+(?:medico|cardiologico))?|refertazione|conclusion[ei]|commento|giudizio|diagnosi|interpretazione\s+(?:medica|del\s+medico|cardiologica|clinica))\s*(?::\s*(.*))?$/i;   // da sola sulla riga, o con i due punti: «Referto elettrocardiografico» in testa al tracciato non lo è
    const firma = /^(?:firmato|firma\b|il\s+medico|medico\s+refertante|refertato\s+da|validato|dott\.?(?:ssa)?\s|dr\.?\s|data(?:\s+e\s+ora)?\s+(?:di\s+)?refert)/i;
    for (let i = 0; i < tutte.length; i++) {
      const m = testa.exec(tutte[i]);
      if (!m || /automatic/i.test(tutte[i])) continue;
      const out = [];
      if (m[1] && !struttura(m[1])) out.push(m[1]);
      for (let k = i + 1; k < tutte.length && !firma.test(tutte[k]); k++) if (!struttura(tutte[k])) out.push(tutte[k]);
      if (out.length) return { righe: out, soloMacchina: false };
    }
    if (tutte.some(macchina)) return { righe: [], soloMacchina: true };
    return { righe: tutte, soloMacchina: false };
  }

  // ---- la cornice di un referto: quello che non dice niente di clinico -------
  // Quando la struttura di una radiografia non si riconosce (refertoScrittoRx),
  // non si mostra più «tutto»: si tolgono SOLO le righe che sono certamente
  // cornice — mai una riga di cui non si è sicuri. L'identità del paziente
  // (nome, nascita, codice fiscale, sesso, età…) dove sta, l'intestazione
  // dell'ospedale e del reparto in testa, la firma in fondo, i piè di pagina.
  function righeSenzaCornice(tutte, paz) {
    const CF = /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/;
    const DATA = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/;
    // il nome dopo un titolo di firma («Dott.», «Il Medico»): al più quattro parole, ognuna con
    // l'iniziale maiuscola e nessuna che non sia un nome — mai le parole di una comunicazione
    // («DOTT. ROSSI INFORMATO TELEFONICAMENTE», «MEDICO DI GUARDIA CONSULTATO», «DR. ROSSI PRESENTE
    // ALL'ESAME» sono referto): un participio, un aggettivo o un verbo (…ato, …ente, …isce, …ano), un
    // infinito (…are, …ere, …ire: «MEDICO: ESEGUIRE TC»), i verbi dei referti («DOTT. ROSSI CONSIGLIA
    // TC», «DR. ROSSI TELEFONA»), una preposizione, GUARDIA, PS, REPARTO. Nel dubbio la riga resta: al
    // più si vede una firma.
    const nomeDi = (t) => {
      const w = String(t).replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
      return w.length >= 1 && w.length <= 4 && w.every((x) => /^[A-ZÀ-Ü][A-Za-zÀ-ÿ-]*$/.test(x))
        && !w.some((x) => /^(?:informat|avvisat|avvertit|contattat|comunicat|chiamat|allertat|sentit|curant)|mente$|(?:at|it|ut)[oaie]$|[ae]nte$|isce$|ano$|ono$|(?:are|ere|ire)$/i.test(x)
          || /^(?:di|del|dell[aoe]|dei|degli|da|dal|dall[aoe]|dai|dagli|al|all[aoe]|ai|agli|in|nel|nell[aoe]|nei|negli|per|con|su|sul|sull[aoe]|tra|fra|a|e|ed|guardia|ps|reparto)$/i.test(x)
          || /^(?:consiglia|richiede|rivede|attende|esegue|indica|segnala|telefona|valuta|propone)$/i.test(x));
    };
    const norm = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 ]+/g, " ").trim().replace(/\s+/g, " ");
    const mie = norm(paz && paz.nome).split(" ").filter((x) => x.length >= 2);
    // il suo nome da solo sulla riga (in qualunque ordine)
    const ilSuoNome = (r) => {
      const w = norm(r).split(" ").filter(Boolean);
      return mie.length >= 2 && w.length >= 2 && w.length <= mie.length + 1 && w.every((x) => mie.includes(x)) && mie.every((x) => w.includes(x));
    };
    // l'identità, dove sta scritta: «Paziente: ROSSI MARIO», «Nato il 01/01/1980», «Codice fiscale …», «Sesso: M».
    // Dopo l'etichetta conta solo un valore che è certamente un dato: un codice fiscale, una
    // data, un numero, M/F, o il SUO nome intero — mai parole maiuscole qualsiasi
    // («PAZIENTE: NON COLLABORANTE», «ETÀ OSSEA CORRISPONDENTE A 12 ANNI» sono referto)
    const dato = (v) => !v || CF.test(v.toUpperCase()) || DATA.test(v) || /^\d[\d/.-]*(?:\s*anni)?$/i.test(v)
      || /^(?:[MF]|maschi(?:o|le)|femmin(?:a|ile))$/i.test(v) || ilSuoNome(v);
    const identita = (r) => {
      if (CF.test(r.toUpperCase()) && !r.toUpperCase().replace(CF, "").replace(/\b(?:CODICE FISCALE|COD(?:\.|ICE)?\s*FISC(?:ALE|\.)?|C\.?\s?F\.?)\s*[:.]?/, "").replace(/[\s:.-]/g, "")) return true;
      if (ilSuoNome(r)) return true;
      const m = /^(?:paziente|cognome\s+e\s+nome|cognome|nominativo|assistito|sig\.?(?:ra)?)\s*:\s*(.+)$/i.exec(r)
        || /^(?:nat[oa](?:\s+(?:il|a))?|data\s+di\s+nascita|d\.?\s?n\.?|luogo\s+di\s+nascita|codice\s+fiscale|cod(?:\.|ice)?\s*fisc(?:ale|\.)?|c\.?\s?f\.?|sesso|et[àa]|residen\w+|tessera\s+sanitaria|n\.?\s*episodio|episodio|nosologico|id\s+paziente)(?![A-Za-zÀ-ÿ])\s*[:.]?\s*(.*)$/i.exec(r);
      return !!m && dato(m[1].trim());
    };
    const esame = (r) => /^\d+-\d+\s+\S.*\(\s*[A-Z0-9]+\s*\)\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}[:.]\d{2}/i.test(r);
    // l'intestazione di chi referta (solo in testa, prima di ogni riga clinica) — mai una
    // frase che finisce col punto: «Struttura ossea regolare.» è referto
    const intestazione = (r) => !/[a-zà-ù]{3}\.$/i.test(r) && (/^(?:ospedale|azienda|asst|ats|ausl|asl|presidio|p\.\s?o\.|struttura\s+(?:complessa|semplice|dipartimentale)|u\.\s?o\.\s?c?\.?|unit[àa]\s+operativa|reparto|servizio|dipartimento|istituto|policlinico|casa\s+di\s+cura)\b/i.test(r)
      || (/^(?:radiologia|radiodiagnostica|diagnostica\s+per\s+immagini|pronto\s+soccorso)\b\s*(?:[-–—:|]\s*(.*))?$/i.test(r)
        && (!/[-–—:|]/.test(r) || /ospedale|azienda|presidio|asst|ats|\bu\.\s?o\.|reparto|servizio|dipartimento|policlinico/i.test(r)))
      || /^(?:modalit[àa]|operatore|tecnico|esecutore|richiedente|medico\s+richiedente|reparto\s+richiedente|provenienza)(?![A-Za-zÀ-ÿ])/i.test(r)
      || /^referto(?:\s+(?:radiologico|di\s+radiologia|medico))?\s*:?$/i.test(r));
    // la firma: «Il Medico DOTTORE ESEMPIO», «Dott.ssa A. Bianchi», «Firmato digitalmente da …» — con dopo solo un nome
    const firma = (r) => {
      const m = /^(?:(?:il|la)\s+)?(?:medico(?:\s+(?:refertante|radiologo|specialista))?|radiologo|dirigente\s+medico|refertato\s+da|referto\s+(?:redatto|firmato)\s+da|firmato(?:\s+digitalmente)?(?:\s+da)?|firma|validato(?:\s+da)?|dott\.?(?:ssa)?|dr\.?(?:ssa)?|prof\.?(?:ssa)?)(?![A-Za-zÀ-ÿ])\.?\s*:?\s*(.*)$/i.exec(r);
      return !!m && (!m[1].trim() || nomeDi(m[1]));
    };
    const piede = (r) => /^(?:pagina|pag\.)\s*\d+(?:\s*(?:di|\/)\s*\d+)?$/i.test(r) || /^[_\-=–—]{5,}$/.test(r);   // (e le righe di trattini)
    const righe = tutte.filter((r) => !piede(r));
    // 1. la testa: l'identità (ovunque) e l'intestazione (finché siamo in testa)
    const out = [];
    let testa = true;
    for (const r of righe) {
      if (identita(r)) continue;
      if (testa && intestazione(r)) continue;
      if (!(testa && esame(r))) testa = false;
      out.push(r);
    }
    // 2. la coda: le righe di firma in fondo, e solo quelle. Una riga dopo la firma che non è
    // firma anche lei («ADDENDUM», «FRATTURA COMPOMESSA», «Nessuna variazione») è referto:
    // resta, e con lei la firma che la precede. (Così un secondo taglio non toglie più niente.)
    while (out.length && firma(out[out.length - 1])) out.length--;
    return out.length ? out : tutte;
  }

  // Radiologia (RX…): si mostra la riga dell'esame (titolo, data e ora) e il
  // referto che sta tra le due righe di trattini, MAI l'anagrafica in testa
  // (ospedale, reparto, dati del paziente, modalità, operatore), i trattini
  // né il piè di pagina. Ogni esame del PDF ha la sua riga e il suo corpo.
  // Prudente: se la struttura non è quella (righe d'esame e coppie di trattini
  // non tornano, o non ci sono) non si taglia a corpo: si tolgono solo le righe
  // che sono certamente cornice (righeSenzaCornice), mai una di cui non si è sicuri.
  function refertoScrittoRx(righe, paz) {
    const tutte = (righe || []).map((r) => String(r || "").trim()).filter(Boolean);
    const sep = (r) => /^[_\-=–—]{5,}$/.test(r);
    const esame = (r) => /^\d+-\d+\s+\S.*\(\s*[A-Z0-9]+\s*\)\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}[:.]\d{2}$/i.test(r);
    const idx = [], esami = [];
    tutte.forEach((r, i) => { if (sep(r)) idx.push(i); else if (esame(r)) esami.push(i); });
    const n = idx.length / 2;
    const cornice = () => ({ righe: righeSenzaCornice(tutte, paz), tagliato: false });
    if (!esami.length || !Number.isInteger(n) || n !== esami.length) return cornice();
    const out = [];
    for (let k = 0; k < n; k++) {
      if (esami[k] > idx[2 * k]) return cornice();   // l'esame viene prima del suo corpo
      out.push(tutte[esami[k]], ...tutte.slice(idx[2 * k] + 1, idx[2 * k + 1]));
    }
    return { righe: out, tagliato: true };
  }
  // Quello che di un referto letto si mostra, archivia e manda al telefono.
  function refertoMostrato(e, righe, paz) {
    return refertoTipo(e) === "ecg" ? refertoScrittoEcg(righe).righe : refertoScrittoRx(righe, paz).righe;
  }

  // Il portale può mostrare più di un PDF (quello rimasto aperto prima, poi il
  // nostro): non si tiene il primo che passa, ma quello che è di QUESTO
  // paziente e, a parità, quello che nomina l'esame chiesto; a parità ancora,
  // l'ultimo arrivato. Un PDF di un altro paziente non si sceglie mai.
  //   candidati: [{ righe }] · chi: { cf, cfImp, nome, nascita, titolo }
  function scegliPdfReferto(candidati, chi) {
    const parole = String((chi && chi.titolo) || "").toUpperCase().replace(/\([^)]*\)/g, " ")
      .split(/[^A-Z0-9À-Ü]+/).filter((x) => x.length >= 3 && !/^\d+$/.test(x));
    let meglio = -1, punti = -Infinity, altri = 0;
    (candidati || []).forEach((c, i) => {
      const id = identitaReferto(c.righe, chi);
      if (id.esito === "altro") { altri++; return; }
      const t = (c.righe || []).join(" ").toUpperCase();
      const p = (id.esito === "ok" ? 4 : 1) + Math.min(2, parole.filter((x) => t.includes(x)).length) + (c.righe && c.righe.length ? 0 : -1);
      if (p >= punti) { punti = p; meglio = i; }
    });
    return { i: meglio, altri };
  }

  // Al massimo N scaricamenti insieme: gli altri aspettano il loro turno, in
  // ordine. Un tocco su un referto e «Salva» passano dalla stessa fila.
  function codaLimitata(max) {
    let attivi = 0;
    const attesa = [];
    const avanti = () => {
      while (attivi < max && attesa.length) {
        const j = attesa.shift();
        attivi++;
        Promise.resolve().then(j.fn).then(j.ok, j.ko).finally(() => { attivi--; avanti(); });
      }
    };
    const metti = (fn) => new Promise((ok, ko) => { attesa.push({ fn, ok, ko }); avanti(); });
    metti.stato = () => ({ attivi, inCoda: attesa.length });
    return metti;
  }

