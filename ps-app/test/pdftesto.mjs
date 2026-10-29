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
import { pdfCifrato, pdfOggettiCompressi, pdfKerning, RIGHE_ESEMPIO, pdfSemplice, RIGHE_ECG, RIGHE_ALTRO } from "./pdf-difficili.mjs";

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
// il lettore vero (pdf.js) e la strada che li mette in fila, come nell'estensione:
// pdf.js prima, il lettore di casa se pdf.js non ne cava niente
const srcTutto = [
  "const hasExt = () => false; const ask = async () => ({ ok: false }); let pdfjsInArrivo = null;",
  src, grab("pdfjsPronto"), grab("righeDaPezzi"), grab("righeDritte"), "async " + grab("testoPdfjs"), "async " + grab("testoPdf"), grab("pdfDiag"),
  // di chi è un referto, il referto scritto di un ECG, quale PDF tenere, la fila degli scaricamenti
  grab("impronta"), grab("identitaReferto"), grab("refertoScrittoEcg"), grab("scegliPdfReferto"), grab("codaLimitata"),
].join("\n");

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

// ---- pdf.js: i PDF che il lettore di casa non sa leggere --------------------
// Caricato come lo carica l'estensione: i due file, nello stesso mondo.
console.log("\nreferto PDF -> testo, con pdf.js");
await page.addScriptTag({ path: join(root, "extension/pdfjs/pdf.min.js") });
await page.addScriptTag({ path: join(root, "extension/pdfjs/pdf.worker.min.js") });
const leggi = (buf) => page.evaluate(async (arg) => {
  // eslint-disable-next-line no-eval
  eval(arg.src);
  const bytes = Uint8Array.from(arg.bytes);
  const r = await testoPdf(bytes);
  return { ...r, casa: await estraiTestoPdf(bytes), diag: pdfDiag(bytes), intatto: bytes.byteLength === arg.bytes.length };
}, { src: srcTutto, bytes: [...buf] });
const norm = (x) => String(x).replace(/\s+/g, " ").trim();
for (const [nome, fare] of [["cifrato (RC4, font /C2_0)", pdfCifrato], ["oggetti compressi, /Contents a due, T*", pdfOggettiCompressi], ["TJ con crenatura e un modulo", pdfKerning]]) {
  const r = await leggi(fare(RIGHE_ESEMPIO));
  const mancano = RIGHE_ESEMPIO.filter((l) => !r.righe.map(norm).includes(norm(l)));
  check(r.lettore === "pdf.js" && !mancano.length,
    `${nome}: pdf.js le legge tutte (${r.lettore}, ${r.righe.length} righe${mancano.length ? `; mancano: ${mancano.join(" | ").slice(0, 120)}` : ""}; il lettore di casa ne prendeva ${RIGHE_ESEMPIO.filter((l) => r.casa.map(norm).includes(norm(l))).length}/${RIGHE_ESEMPIO.length})`);
  check(r.intatto, `${nome}: il PDF resta intero dopo la lettura (si tiene così com'è)`);
  check(!RIGHE_ESEMPIO.some((l) => r.diag.includes(l.slice(0, 12))), `${nome}: la diagnosi non contiene il testo (${r.diag.slice(0, 110)})`);
}
check(/cifrato V2\/R3/.test((await leggi(pdfCifrato(RIGHE_ESEMPIO))).diag), "la diagnosi dice che è cifrato, e come");
check(/ObjStm [1-9]/.test((await leggi(pdfOggettiCompressi(RIGHE_ESEMPIO))).diag), "la diagnosi vede gli oggetti compressi");
// un PDF che pdf.js non legge (qui un font Type0 incompleto) torna al lettore di casa
const ripiego = await leggi(pdfCid(RIGHE));
check(ripiego.lettore === "lettore di casa" && ripiego.righe.length === RIGHE.length,
  `se pdf.js non ne cava niente, resta il lettore di casa (${ripiego.lettore}, ${ripiego.righe.length} righe${ripiego.motivo ? `; ${ripiego.motivo}` : ""})`);

// ---- un ECG in orizzontale: il testo è scritto ruotato di 90° -------------------
console.log("\nECG in orizzontale (testo ruotato)");
const uguali = (a, b) => a.length === b.length && a.every((x, i) => norm(x) === norm(b[i]));
const dritto = await leggi(pdfSemplice(RIGHE_ECG));
check(uguali(dritto.righe, RIGHE_ECG), `dritto: righe in ordine (${dritto.lettore}, ${dritto.righe.length}/${RIGHE_ECG.length}; got: ${dritto.righe.join(" | ").slice(0, 400)})`);
const ruotato = await leggi(pdfSemplice(RIGHE_ECG, { ruotato: true }));
check(ruotato.lettore === "pdf.js" && uguali(ruotato.righe, RIGHE_ECG),
  `ruotato, con pdf.js: le righe si leggono in ordine, parola per parola (got: ${ruotato.righe.slice(0, 3).join(" | ").slice(0, 140)})`);
check(uguali(ruotato.casa, RIGHE_ECG), `ruotato, col lettore di casa: anche (got: ${ruotato.casa.slice(0, 3).join(" | ").slice(0, 140)})`);

// tutto il resto è logica pura: gira nella stessa pagina, sugli stessi pezzi
const prova = (fn, arg) => page.evaluate(async ({ src, fn, arg }) => {
  // eslint-disable-next-line no-eval
  eval(src);
  // eslint-disable-next-line no-eval
  return await eval(`(${fn})`)(arg);
}, { src: srcTutto, fn: fn.toString(), arg });

console.log("\nECG: solo il referto scritto");
const ecg = await prova((r) => refertoScrittoEcg(r), ruotato.righe);
check(!ecg.soloMacchina && ecg.righe.length === 1 && /^Ritmo sinusale a 72\/min\. Non alterazioni/.test(ecg.righe[0]),
  `del PDF ruotato resta solo il referto del cardiologo (got: ${JSON.stringify(ecg.righe).slice(0, 120)})`);
const soloTracciato = await prova((r) => refertoScrittoEcg(r), RIGHE_ECG.slice(0, 5));
check(soloTracciato.soloMacchina && !soloTracciato.righe.length, "un tracciato senza referto scritto: niente testo (misure e frasi della macchina no)");
const scritto = await prova((r) => refertoScrittoEcg(r), ["Visita cardiologica", "Ritmo sinusale, non alterazioni acute."]);
check(!scritto.soloMacchina && scritto.righe.length === 2, "un documento scritto senza misure resta com'è");
const conclusioni = await prova((r) => refertoScrittoEcg(r), ["PR 160 ms", "Conclusioni: fibrillazione atriale a 110 bpm", "Dott. Esempio"]);
check(conclusioni.righe.length === 1 && /fibrillazione atriale a 110 bpm/.test(conclusioni.righe[0]),
  `«Conclusioni:» sulla stessa riga, fino alla firma (got: ${JSON.stringify(conclusioni.righe)})`);

console.log("\nil referto è di questo paziente?");
const ROSSI = { cf: "SMPRSS80A01F205X", nome: "ROSSI MARIO", nascita: "01/01/1980" };
const id = (righe, paz) => prova(({ righe, paz }) => identitaReferto(righe, paz), { righe, paz });
check((await id(RIGHE_ECG, ROSSI)).esito === "ok", "stesso codice fiscale: ok");
check((await id(RIGHE_ECG, { cfImp: await prova(() => impronta("SMPRSS80A01F205X")), nome: "ROSSI MARIO" })).esito === "ok",
  "stesso codice fiscale anche quando del paziente si conosce solo l'impronta");
check((await id(RIGHE_ALTRO, ROSSI)).esito === "altro", "un altro codice fiscale: è di un altro paziente");
check((await id(RIGHE_ESEMPIO, ROSSI)).esito === "ignota", "nessuna intestazione: «non verificata»");
check((await id(["Paziente: ROSSI MARIO", "Nato il 01/01/1980", "Esame"], ROSSI)).esito === "ok", "nome e data di nascita: ok");
check((await id(["Paziente: ROSSI MARIO", "Nato il 03/03/1970"], ROSSI)).esito === "altro", "stesso nome, un'altra data di nascita: un altro paziente");
check((await id(["Paziente: BIANCHI ANNA", "Esame"], { nome: "ROSSI MARIO" })).esito === "altro", "un altro nome scritto come paziente: un altro paziente");
check((await id(["Paziente collaborante.", "Esame nei limiti."], { nome: "ROSSI MARIO" })).esito === "ignota", "«Paziente collaborante» nel testo non è un nome");
check((await id(["ROSSI MARIO"], { nome: "ROSSI MARIO" })).esito === "ignota", "il nome da solo non basta");
check((await id(["BNCNNA50B42F205Z"], { nome: "ROSSI MARIO", nascita: "01/01/1980" })).esito === "altro",
  "il codice fiscale del paziente non si sa ancora, ma la data di nascita dentro quello del referto è un'altra");
// fino in fondo: dal PDF al verdetto
const pdfAltro = await leggi(pdfSemplice(RIGHE_ALTRO));
check((await id(pdfAltro.righe, ROSSI)).esito === "altro", "un PDF intestato a un altro paziente: riconosciuto dal suo testo");

console.log("\nquale PDF tenere fra quelli che il portale mostra");
const scegli = (cand, chi) => prova(({ cand, chi }) => scegliPdfReferto(cand, chi), { cand, chi });
const giusto = { righe: RIGHE_ECG }, sbagliato = { righe: RIGHE_ALTRO }, anonimo = { righe: RIGHE_ESEMPIO };
check((await scegli([sbagliato, giusto], ROSSI)).i === 1, "prima uno di un altro paziente, poi il suo: si tiene il suo");
check((await scegli([giusto, anonimo], ROSSI)).i === 0, "quello col suo codice fiscale batte quello senza intestazione");
const solo = await scegli([sbagliato], ROSSI);
check(solo.i === -1 && solo.altri === 1, "solo PDF di altri: nessuno");
check((await scegli([anonimo, { righe: ["TC ENCEFALO", "Non lesioni."] }], { ...ROSSI, titolo: "TC ENCEFALO (A69846)" })).i === 1,
  "a parità d'identità, quello che nomina l'esame chiesto");

console.log("\nal massimo due scaricamenti insieme");
const fila = await prova(async () => {
  const metti = codaLimitata(2);
  let ora = 0, max = 0;
  const partiti = [];
  const lavori = [1, 2, 3, 4, 5].map((n) => metti(async () => {
    partiti.push(n); ora++; max = Math.max(max, ora);
    await new Promise((r) => setTimeout(r, 40));
    ora--;
    if (n === 3) throw new Error("rotto");
    return n;
  }).catch((e) => e.message));
  const esiti = await Promise.all(lavori);
  return { max, partiti, esiti, stato: metti.stato() };
});
check(fila.max === 2, `mai più di due insieme (got ${fila.max})`);
check(fila.partiti.join() === "1,2,3,4,5" && fila.esiti.join() === "1,2,rotto,4,5" && fila.stato.attivi === 0 && fila.stato.inCoda === 0,
  `tutti in ordine, anche dopo uno che si rompe (got ${JSON.stringify(fila)})`);

await browser.close();
console.log(fail ? `\nPDF-TESTO: ${fail} CHECK FALLITI\n` : "\nPDF-TESTO: TUTTO OK\n");
process.exit(fail ? 1 : 0);
