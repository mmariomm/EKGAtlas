/*
 * PS Assist · l'etichetta libera — l'impaginazione, uguale sui due lati.
 *
 * Lo stesso file gira sull'iPhone (questa cartella, servita dal sito) e
 * nell'estensione (copiato in ps-app/extension/etichetta.js da `npm run build`,
 * e un test controlla che siano identici). Un testo di poche righe diventa una
 * impaginazione sola (`impagina`): la misura dell'etichetta, il corpo del
 * carattere e, per ogni riga, dove sta e quanto è lunga. Da lei, e solo da lei,
 * escono il PDF (`pdf`, Helvetica: un carattere di base di ogni lettore PDF,
 * niente incorporato, niente da fuori) e l'anteprima (`svg`, alla misura vera,
 * ogni riga stirata alla larghezza esatta che ha nel PDF): stesse misure, stesse
 * righe, stesso corpo. Il testo si adatta (il corpo scende finché tutto ci sta):
 * mai tagliato. Le righe sono quelle scritte: nessun a capo aggiunto.
 */
(function () {
  "use strict";
  const MAX_RIGHE = 4, MAX_CAR = 32;
  const MISURA = [142, 71];   // 50×25 mm in punti: quella delle etichette di prova, se l'aiutante non ne ha detta un'altra
  const CORPO = { max: 28, min: 4 };
  // le larghezze di Helvetica (AFM, millesimi del corpo), da 32 a 126, codifica WinAnsi
  const LARGHE = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  // le lettere accentate di Latin-1 (stesso codice in WinAnsi): la larghezza della lettera di base
  const ACCENTATE = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ";
  // e qualche segno di Latin-1 che in reparto si scrive: ° · ± µ ²
  const SIMBOLI = { "°": 400, "·": 278, "±": 584, "µ": 556, "²": 333 };
  const largo = (c) => {
    const n = c.charCodeAt(0);
    if (n >= 32 && n <= 126) return LARGHE[n - 32];
    if (SIMBOLI[c]) return SIMBOLI[c];
    const b = c.normalize("NFD")[0];
    return b === "Ç" ? 722 : b === "ç" ? 500 : LARGHE[b.charCodeAt(0) - 32];
  };
  // solo quello che Helvetica WinAnsi sa scrivere: il resto senza accento (se ne ha uno), o «?»
  function pulisci(s) {
    let o = "";
    for (const c of String(s)) {
      const n = c.charCodeAt(0);
      if ((n >= 32 && n <= 126) || SIMBOLI[c] || ACCENTATE.includes(c)) o += c;
      else if (c === "\t") o += " ";
      else {
        const b = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
        o += /^[\x20-\x7E]$/.test(b) ? b : "?";
      }
    }
    return o;
  }
  // il testo scritto → le righe (senza le vuote in cima e in fondo), o perché no
  function righe(testo) {
    const l = String(testo == null ? "" : testo).replace(/\r\n?/g, "\n").split("\n").map((r) => pulisci(r).replace(/\s+$/, ""));
    while (l.length && !l[0].trim()) l.shift();
    while (l.length && !l[l.length - 1].trim()) l.pop();
    if (!l.length) return { ok: false, errore: "Scrivi il testo dell'etichetta" };
    if (l.length > MAX_RIGHE) return { ok: false, errore: `Al massimo ${MAX_RIGHE} righe` };
    const lunga = l.findIndex((r) => r.length > MAX_CAR);
    if (lunga >= 0) return { ok: false, errore: `Al massimo ${MAX_CAR} caratteri per riga (riga ${lunga + 1})` };
    return { ok: true, righe: l };
  }
  const due = (x) => Math.round(x * 100) / 100;
  // la misura (in punti), se sensata; se no quella di partenza
  const misuraDi = (m) => (Array.isArray(m) && m.length === 2 && m.every((x) => Number.isFinite(Number(x)) && x >= 40 && x <= 1200) ? m.map((x) => due(Number(x))) : MISURA.slice());
  // L'impaginazione: centrata, il corpo più grande con cui tutte le righe stanno nei margini
  function impagina(testo, misura) {
    const r = righe(testo);
    if (!r.ok) return r;
    const [w, h] = misuraDi(misura);
    const m = due(Math.max(4, Math.min(w, h) * 0.08)), lead = 1.2;
    const em = r.righe.map((t) => [...t].reduce((a, c) => a + largo(c), 0) / 1000);
    const perAlto = (h - 2 * m) / (lead * r.righe.length);
    const perLargo = Math.min(...em.map((e) => (e > 0 ? (w - 2 * m) / e : Infinity)));
    const corpo = Math.floor(Math.min(CORPO.max, perAlto, perLargo) * 10) / 10;
    if (!(corpo >= CORPO.min)) return { ok: false, errore: "Troppo testo per questa etichetta: accorcia le righe" };
    const blocco = lead * corpo * r.righe.length, cima = (h + blocco) / 2;
    return { ok: true, w, h, corpo, margine: m,
      righe: r.righe.map((t, i) => {
        const l = due(em[i] * corpo);
        return { t, l, x: due((w - l) / 2), y: due(cima - i * lead * corpo - 0.93 * corpo) };   // y: la linea di base, dal basso (come nel PDF)
      }) };
  }
  const pdfStringa = (s) => s.replace(/[()\\]/g, "\\$&");
  // Il PDF dell'impaginazione, in base64: una pagina della misura dell'etichetta
  function pdf(imp) {
    if (!imp || !imp.ok) throw new Error("Etichetta non valida");
    const testo = imp.righe.filter((r) => r.t.trim()).map((r) => `BT /F1 ${imp.corpo} Tf ${r.x} ${r.y} Td (${pdfStringa(r.t)}) Tj ET`).join("\n");
    const oggetti = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${imp.w} ${imp.h}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      `<< /Length ${testo.length} >>\nstream\n${testo}\nendstream`,
    ];
    let s = "%PDF-1.4\n";
    const dove = oggetti.map((o, i) => { const at = s.length; s += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
    const xref = s.length;
    s += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n${dove.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
      + `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return btoa(s);   // (solo caratteri sotto 256: Latin-1)
  }
  const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const mm = (pt) => due(pt * 25.4 / 72);
  // L'anteprima: la stessa impaginazione, alla misura vera (mm), ogni riga alla sua larghezza esatta
  function svg(imp) {
    if (!imp || !imp.ok) return "";
    return `<svg xmlns="http://www.w3.org/2000/svg" class="etisvg" width="${mm(imp.w)}mm" height="${mm(imp.h)}mm" viewBox="0 0 ${imp.w} ${imp.h}" role="img" aria-label="Anteprima dell'etichetta, ${mm(imp.w)}×${mm(imp.h)} mm">`
      + `<rect x="0" y="0" width="${imp.w}" height="${imp.h}" fill="#fff"/>`
      + imp.righe.filter((r) => r.t.trim()).map((r) => `<text x="${r.x}" y="${due(imp.h - r.y)}" font-family="Helvetica, Arial, 'Liberation Sans', sans-serif" font-size="${imp.corpo}" fill="#000" textLength="${r.l}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${xml(r.t)}</text>`).join("")
      + `</svg>`;
  }
  const api = { MAX_RIGHE, MAX_CAR, MISURA, righe, impagina, pdf, svg, misuraDi, mm };
  globalThis.PSEtichetta = Object.freeze(api);
})();
