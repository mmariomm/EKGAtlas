#!/usr/bin/env node
/*
 * estraiTestoPdf — the function that turns a radiology/ECG report into text —
 * run in a real browser (it needs DecompressionStream) against a compressed
 * PDF with a two-byte CID font and its ToUnicode map, which is how the
 * hospital's radiology reports are built.
 *
 * No real report is used or committed: the fixture is generated right here.
 *   node test/pdftesto.mjs
 */
import { chromium } from "playwright";
import { readFileSync, existsSync, statSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = readFileSync(join(root, "src/core.js"), "utf8");
const grab = (name) => {
  const i = core.indexOf(`function ${name}(`);
  if (i < 0) throw new Error("non trovata: " + name);
  let depth = 0, end = i;
  for (let k = core.indexOf("{", i); k < core.length; k++) {
    if (core[k] === "{") depth++;
    else if (core[k] === "}") { depth--; if (!depth) { end = k + 1; break; } }
  }
  return core.slice(i, end);
};
const src = "async " + grab("estraiTestoPdf");   // declared `async function` in core

function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

// ---- a compressed CID PDF, built the way the hospital's report is ---------
function pdfCid(righe) {
  const enc = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  let content = "BT /F1 10 Tf\n";
  let y = 700;
  for (const r of righe) { content += `1 0 0 1 60 ${y} Tm <${enc(r)}> Tj\n`; y -= 14; }
  content += "ET\n";
  const zipped = deflateSync(Buffer.from(content, "latin1"));
  const cmap = [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "1 begincodespacerange <0000> <FFFF> endcodespacerange",
    "1 beginbfrange <0020> <00ff> <0020> endbfrange",
    "endcmap end end",
  ].join("\n");
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
    { dict: `<</Length ${zipped.length}/Filter/FlateDecode>>`, raw: zipped },
    "<</Type/Font/Subtype/Type0/BaseFont/AAAAAA+ArialMT/ToUnicode 6 0 R>>",
    { dict: `<</Length ${cmap.length}>>`, raw: Buffer.from(cmap, "latin1") },
  ];
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offs = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offs.push(pos);
    const head = Buffer.from(`${i + 1} 0 obj\n${typeof o === "string" ? o : o.dict}\n`, "latin1");
    const body = typeof o === "string" ? Buffer.alloc(0)
      : Buffer.concat([Buffer.from("stream\n", "latin1"), o.raw, Buffer.from("\nendstream\n", "latin1")]);
    const end = Buffer.from("endobj\n", "latin1");
    parts.push(head, body, end);
    pos += head.length + body.length + end.length;
  });
  const xref = pos;
  const tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")
    + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(Buffer.from(tail, "latin1"));
  return Buffer.concat(parts);
}

const RIGHE = [
  "RADIOLOGIA - Ospedale di esempio",
  "Quesito Diagnostico: dispnea",
  "RADIOGRAFIA TORACE 2 PROIEZIONI",
  "Non focolai a carattere broncopneumonico.",
  "Ombra cardiaca nei limiti. Seni costofrenici liberi.",
  "Il Medico DOTTORE ESEMPIO",
];

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const page = await browser.newPage();
const estrai = (buf) => page.evaluate(async (arg) => {
  // eslint-disable-next-line no-eval
  eval(arg.src);
  return await estraiTestoPdf(Uint8Array.from(arg.bytes));
}, { src, bytes: [...buf] });

console.log("\nreferto PDF -> testo");
const cid = await estrai(pdfCid(RIGHE));
check(cid.length === RIGHE.length, `tutte le righe (got ${cid.length}/${RIGHE.length})`);
check(cid[2] === "RADIOGRAFIA TORACE 2 PROIEZIONI", `titolo esatto (got: ${cid[2]})`);
check(/Non focolai a carattere broncopneumonico\./.test(cid[3] || ""), `il corpo del referto (got: ${cid[3]})`);
check(/Quesito Diagnostico: dispnea/.test(cid[1] || ""), "il quesito");
check(cid.every((r) => !/\u0000/.test(r)), "nessun byte di codifica lasciato nel testo");

// a PDF with no text at all must come back empty, never with noise
const vuoto = await estrai(Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1"));
check(Array.isArray(vuoto) && vuoto.length === 0, `un PDF senza testo non inventa righe (got ${JSON.stringify(vuoto).slice(0, 40)})`);

await browser.close();
console.log(fail ? `\nPDF-TESTO: ${fail} CHECK FALLITI\n` : "\nPDF-TESTO: TUTTO OK\n");
process.exit(fail ? 1 : 0);
