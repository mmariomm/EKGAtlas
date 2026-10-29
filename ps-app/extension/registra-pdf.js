// Generato da tools/build.mjs da src/core.js: non si modifica a mano.
// Il testo di un PDF per il registratore, come lo legge il pannello.
(function () {
  const hasExt = () => false; const ask = async () => ({ ok: false }); let pdfjsInArrivo = null;
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
function pdfjsPronto() {
    if (globalThis.pdfjsLib?.getDocument && globalThis.pdfjsWorker?.WorkerMessageHandler) return Promise.resolve(globalThis.pdfjsLib);
    if (!hasExt()) return Promise.resolve(null);
    return pdfjsInArrivo = pdfjsInArrivo || ask({ t: "pdfjs" }).then((r) => {
      const lib = r && r.ok && globalThis.pdfjsLib?.getDocument ? globalThis.pdfjsLib : null;
      if (!lib) pdfjsInArrivo = null;   // si riprova al prossimo referto
      return lib;
    });
  }
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
  globalThis.RegistraPdf = { testoPdf };
})();
