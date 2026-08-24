/*
 * A real PDF, written by hand, so the banco prints something you can read.
 *
 * The print flow fetches application/pdf and shows it in a frame: a blank page
 * there looks like a broken window. This builds a small, valid PDF (Helvetica
 * text plus rectangles) for the three documents the flow produces — etichette,
 * lista esami, referto — carrying the patient and the exams that are really in
 * the request.
 */
window.PSA_PDF = (function () {
  "use strict";
  const ACCENTI = { "à": "a", "è": "e", "é": "e", "ì": "i", "ò": "o", "ù": "u", "°": "o", "–": "-", "—": "-", "’": "'", "·": "-", "↓": "v", "↑": "^" };
  const esc = (s) => String(s ?? "")
    .replace(/[\\()]/g, (c) => "\\" + c)
    .replace(/[^\x20-\x7E]/g, (c) => ACCENTI[c] || "?");

  // page items: {t:"text"|"rect"|"line", …}
  function stream(items) {
    const out = [];
    for (const it of items) {
      if (it.t === "rect") out.push(`${(it.g ?? 0).toFixed(2)} g ${it.x} ${it.y} ${it.w} ${it.h} re f`);
      else if (it.t === "line") out.push(`${(it.g ?? 0).toFixed(2)} G ${it.w || 0.7} w ${it.x} ${it.y} m ${it.x2} ${it.y} l S`);
      else out.push(`BT /${it.bold ? "F2" : "F1"} ${it.size || 10} Tf ${(it.g ?? 0).toFixed(2)} g ${it.x} ${it.y} Td (${esc(it.s)}) Tj ET`);
    }
    return out.join("\n");
  }

  function build(items, { width = 595, height = 842 } = {}) {
    const content = stream(items);
    const objs = [
      "<</Type/Catalog/Pages 2 0 R>>",
      "<</Type/Pages/Kids[3 0 R]/Count 1>>",
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>`,
      `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
      "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
      "<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
      + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")
      + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return bytes;
  }

  // bars derived from the text itself: it only has to look like a barcode
  function barcode(x, y, w, h, seed) {
    const out = [];
    let n = 0;
    for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) >>> 0;
    let cx = x;
    while (cx < x + w - 1) {
      n = (n * 1103515245 + 12345) >>> 0;
      const bar = 1 + (n % 3);
      const gap = 1 + ((n >> 8) % 3);
      out.push({ t: "rect", x: cx, y, w: bar, h, g: 0 });
      cx += bar + gap;
    }
    return out;
  }

  const testata = (titolo, paziente, episodio) => [
    { t: "rect", x: 0, y: 782, w: 595, h: 60, g: 0.93 },
    { t: "text", x: 40, y: 812, size: 15, bold: true, s: "OSPEDALE ESEMPIO - Pronto Soccorso" },
    { t: "text", x: 40, y: 794, size: 10, g: 0.35, s: "Documento del banco di prova - dati inventati" },
    { t: "text", x: 40, y: 752, size: 13, bold: true, s: titolo },
    { t: "text", x: 40, y: 734, size: 10.5, s: `Assistito: ${paziente}    Episodio: ${episodio}` },
    { t: "line", x: 40, y: 726, x2: 555, g: 0.7 },
  ];

  return {
    // one label per exam, like the sheet the label printer spits out
    etichette({ paziente, episodio, richiesta, esami }) {
      const items = testata("Etichette provette", paziente, episodio);
      const lista = esami && esami.length ? esami : ["(nessun esame nel carrello)"];
      let y = 690;
      lista.slice(0, 8).forEach((e, i) => {
        items.push({ t: "rect", x: 40, y: y - 54, w: 260, h: 68, g: 0.96 });
        items.push({ t: "text", x: 48, y: y - 4, size: 10, bold: true, s: paziente });
        items.push({ t: "text", x: 48, y: y - 17, size: 8.5, g: 0.3, s: `episodio ${episodio} - richiesta ${richiesta}` });
        items.push({ t: "text", x: 48, y: y - 30, size: 8.5, s: String(e).slice(0, 44) });
        items.push(...barcode(48, y - 50, 200, 15, `${richiesta}-${i}-${e}`));
        items.push({ t: "text", x: 256, y: y - 48, size: 7, g: 0.4, s: `PROV.${i + 1}` });
        y -= 80;
      });
      return build(items);
    },
    // the sheet that travels with the tubes
    lista({ paziente, episodio, richiesta, quesito, esami, titolo = "Richiesta di laboratorio" }) {
      const items = testata(titolo, paziente, episodio);
      items.push({ t: "text", x: 40, y: 706, size: 10, s: `Richiesta n. ${richiesta}    Reparto: PRONTO SOCCORSO` });
      items.push({ t: "text", x: 40, y: 690, size: 10, s: `Quesito diagnostico: ${String(quesito || "-").slice(0, 68)}` });
      items.push({ t: "rect", x: 40, y: 656, w: 515, h: 18, g: 0.9 });
      items.push({ t: "text", x: 46, y: 662, size: 9.5, bold: true, s: "Prestazione" });
      items.push({ t: "text", x: 430, y: 662, size: 9.5, bold: true, s: "Stato" });
      let y = 638;
      (esami && esami.length ? esami : ["(nessun esame)"]).slice(0, 30).forEach((e) => {
        items.push({ t: "text", x: 46, y, size: 9.5, s: String(e).slice(0, 66) });
        items.push({ t: "text", x: 430, y, size: 9.5, g: 0.35, s: "da eseguire" });
        items.push({ t: "line", x: 40, y: y - 5, x2: 555, g: 0.85 });
        y -= 17;
      });
      items.push({ t: "text", x: 40, y: y - 22, size: 9, g: 0.4, s: "Firma del medico richiedente ______________________" });
      return build(items);
    },
    // what opens when a referto is clicked
    referto({ paziente, episodio, titolo, righe }) {
      const items = testata("Referto", paziente, episodio);
      items.push({ t: "text", x: 40, y: 706, size: 11, bold: true, s: titolo || "Esame" });
      let y = 682;
      (righe || []).forEach((r) => {
        items.push({ t: "text", x: 46, y, size: 10, s: String(r).slice(0, 76) });
        y -= 16;
      });
      items.push({ t: "text", x: 40, y: y - 24, size: 9, g: 0.4, s: "Refertato da DOTTORE ESEMPIO 1 - documento di prova, privo di valore clinico" });
      return build(items);
    },
  };
})();
