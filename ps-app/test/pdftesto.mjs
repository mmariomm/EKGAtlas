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
  grab("impronta"), grab("identitaReferto"), grab("refertoScrittoEcg"), grab("refertoScrittoRx"), grab("righeSenzaCornice"), grab("anteprimaReferto"), grab("scegliPdfReferto"), grab("codaLimitata"),
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

console.log("\nRX: la riga dell'esame e il referto, non l'anagrafica");
const SEP = "_____________________________________";
const TESTA = ["OSPEDALE DI PROVA", "Reparto di prova", "Paziente: ROSSI MARIO", "Nato il 01/01/1980", "Codice fiscale SMPRSS80A01F205X"];
const RX1 = [...TESTA, "69-35 RX TORACE (6979) 01/10/2026 10:51", "Modalità Paziente in barella", "OPERATORE 10", SEP,
  "Quadro polmonare nei limiti.", "Seni costofrenici liberi.", SEP, "Firma di prova"];
const rx1 = await prova((r) => refertoScrittoRx(r), RX1);
check(rx1.tagliato && rx1.righe.length === 3 && /^69-35 RX TORACE .* 01\/10\/2026 10:51$/.test(rx1.righe[0]) && rx1.righe[2] === "Seni costofrenici liberi.",
  `un esame: riga dell'esame + corpo, niente anagrafica, modalità, operatore, trattini, firma (got: ${JSON.stringify(rx1.righe)})`);
const RX2 = [...TESTA, "69-35 RX TORACE (6979) 01/10/2026 10:51", "69-40 RX BACINO (6990) 01/10/2026 10:52", "OPERATORE 10", SEP,
  "Torace: nulla di rilevante.", SEP, SEP, "Bacino: nessuna frattura.", SEP];
const rx2 = await prova((r) => refertoScrittoRx(r), RX2);
check(rx2.righe.length === 4 && /RX TORACE/.test(rx2.righe[0]) && /^Torace/.test(rx2.righe[1]) && /RX BACINO/.test(rx2.righe[2]) && /^Bacino/.test(rx2.righe[3]),
  `due esami nello stesso PDF: ognuno col suo corpo (got: ${JSON.stringify(rx2.righe)})`);
const RX2B = [...TESTA, "69-35 RX TORACE (6979) 01/10/2026 10:51", SEP, "Torace: nulla di rilevante.", SEP, "69-40 RX BACINO (6990) 01/10/2026 10:52", SEP, "Bacino: nessuna frattura.", SEP];
const rx2b = await prova((r) => refertoScrittoRx(r), RX2B);
check(rx2b.righe.length === 4 && /RX BACINO/.test(rx2b.righe[2]) && !rx2b.righe.some((r) => /OSPEDALE|ROSSI/.test(r)), "due esami, ognuno con i suoi trattini: lo stesso");
// struttura non riconosciuta: non si taglia a corpo, ma le righe che sono certamente cornice se ne vanno
const ESAME_LAB = "0-16 BILIRUBINA (450008) 28/09/26 10.06 28/09/26 10:06", ESAME_RX = "69-35 RX TORACE (6979) 01/10/2026 10:51", ESAME_BA = "69-40 RX BACINO (6990) 01/10/2026 10:52";
for (const [nome, r, atteso] of [["senza trattini (laboratorio)", [...TESTA, ESAME_LAB, "OPERATORE 10"], [ESAME_LAB]],
  ["senza riga d'esame", [...TESTA, SEP, "Testo", SEP], ["Testo"]], ["trattini dispari", [...TESTA, ESAME_RX, SEP, "Testo"], [ESAME_RX, "Testo"]],
  ["esami e corpi che non tornano", [...TESTA, ESAME_RX, ESAME_BA, SEP, "Testo", SEP], [ESAME_RX, ESAME_BA, "Testo"]]]) {
  const x = await prova((q) => refertoScrittoRx(q, { nome: "ROSSI MARIO" }), r);   // (il pannello passa sempre il nome del paziente)
  check(!x.tagliato && JSON.stringify(x.righe) === JSON.stringify(atteso), `struttura non riconosciuta (${nome}): via anagrafica e trattini, resta il resto (got: ${JSON.stringify(x.righe)})`);
}
// i referti così come arrivano dal PDF (RIGHE: intestazione, quesito, titolo, corpo, firma): il nome, l'ospedale e il medico non ci sono più
const SENZA = await prova((r) => refertoScrittoRx(r, { nome: "ROSSI MARIO" }).righe, RIGHE);
check(JSON.stringify(SENZA) === JSON.stringify(["Quesito Diagnostico: dispnea", "RADIOGRAFIA TORACE 2 PROIEZIONI", "Non focolai a carattere broncopneumonico.", "Ombra cardiaca nei limiti. Seni costofrenici liberi."]),
  `RX senza struttura: via l'intestazione e la firma, restano quesito, titolo e referto (got: ${JSON.stringify(SENZA)})`);
const IDENT = ["RADIOLOGIA", "Paziente: ROSSI MARIO Nato il 01/01/1980 SMPRSS80A01F205X", "Cod. Fisc. SMPRSS80A01F205X", "Sesso: M", "Età: 45 anni", "Episodio 999001", "Rossi Mario",
  "RADIOGRAFIA TORACE", "Opacità basale destra.", "Il Medico Dott. Mario Bianchi", "Pagina 1 di 1"];
const identOut = await prova((r) => refertoScrittoRx(r, { nome: "ROSSI MARIO" }).righe, IDENT);
check(JSON.stringify(identOut) === JSON.stringify(["RADIOGRAFIA TORACE", "Opacità basale destra."]), `nome, codice fiscale, sesso, età, episodio, firma e piè di pagina via (got: ${JSON.stringify(identOut)})`);
// mai una riga clinica: parole che somigliano alla cornice, ma sono referto
const CLINICA = ["RX TORACE", "Paziente collaborante.", "Paziente: non collaborante, in barella.", "Età non determinabile.", "Il medico curante è informato dei reperti.", "Si consiglia controllo.", "Sesso e età compatibili."];
const clin = await prova((r) => refertoScrittoRx(r, { nome: "ROSSI MARIO" }).righe, CLINICA);
check(JSON.stringify(clin) === JSON.stringify(CLINICA), `le righe cliniche che somigliano alla cornice restano tutte (got: ${JSON.stringify(clin)})`);
// …anche scritte tutte in maiuscolo, come molti referti: via la cornice, mai una riga del referto
const MAIUSCOLA = ["AZIENDA SOCIO SANITARIA TERRITORIALE", "U.O.C. RADIOLOGIA", "PAZIENTE: ROSSI MARIO", "NATO IL 01/01/1980", "SESSO: M", "ETÀ: 45 ANNI", "RX TORACE",
  "PAZIENTE: NON COLLABORANTE", "EPISODIO DI DOLORE TORACICO", "ETÀ OSSEA CORRISPONDENTE A 12 ANNI", "SESSO E ETÀ COMPATIBILI", "SENI COSTOFRENICI LIBERI.", "IL MEDICO RADIOLOGO", "DOTT. MARIO BIANCHI"];
const maiu = await prova((r) => refertoScrittoRx(r, { nome: "ROSSI MARIO" }).righe, MAIUSCOLA);
check(JSON.stringify(maiu) === JSON.stringify(MAIUSCOLA.slice(6, 12)), `in maiuscolo: via intestazione, identità e firma, il referto resta tutto (got: ${JSON.stringify(maiu)})`);
// dopo la firma: si toglie solo una riga che è firma anche lei, mai una che «sembra un nome»
for (const [nome, r, atteso] of [
  ["un'aggiunta in maiuscolo", ["RX BACINO", "Frattura della branca ileo-pubica destra.", "Dott. Bianchi", "FRATTURA COMPOMESSA", "CONTROLLO TC"], null],
  ["un addendum", ["RX TORACE", "Opacità basale destra.", "Il Medico Dott. Mario Bianchi", "ADDENDUM", "SI SEGNALA PNX APICALE DESTRO", "COMUNICATO AL MEDICO DI PS"], null],
  ["parole con le iniziali maiuscole", ["RX TORACE", "Opacità basale.", "Dott. Bianchi", "Nessuna Variazione"], null],
  ["una comunicazione col titolo", ["RX TORACE", "PNX APICALE DESTRO.", "DOTT. ROSSI INFORMATO TELEFONICAMENTE", "DOTT. BIANCHI"], ["RX TORACE", "PNX APICALE DESTRO.", "DOTT. ROSSI INFORMATO TELEFONICAMENTE"]],
  ["una frase in testa", ["Struttura ossea regolare.", "Nessuna frattura."], null]]) {
  const x = await prova((q) => refertoScrittoRx(q, { nome: "VERDI LUCA" }).righe, r);
  check(JSON.stringify(x) === JSON.stringify(atteso || r), `${nome}: resta (got: ${JSON.stringify(x)})`);
}
// …e dopo un titolo conta solo un nome: un participio, un verbo, una preposizione, GUARDIA o PS dicono
// che la riga è referto (resta lei, e con lei la firma sopra)
const COMUNICAZIONI = [
  ["RX TORACE", "NON FOCOLAI IN ATTO.", "MEDICO DI GUARDIA CONSULTATO"],
  ["RX TORACE", "SI SEGNALA PNX APICALE DESTRO.", "DOTT. BIANCHI VISIONATO"],
  ["RX TORACE", "SI SEGNALA PNX APICALE DESTRO.", "DR. ROSSI PRESENTE ALL'ESAME"],
  ["RX TORACE", "SI SEGNALA PNX.", "Dott. Bianchi", "MEDICO DI PS PRESENTE"],
  ["RX TORACE", "Frattura composta.", "Prof. Bianchi Riferisce Dolore"],
];
for (const r of COMUNICAZIONI) {
  const x = await prova((q) => refertoScrittoRx(q, { nome: "VERDI LUCA" }).righe, r);
  check(JSON.stringify(x) === JSON.stringify(r), `«${r[r.length - 1]}» dopo il referto: resta (got: ${JSON.stringify(x)})`);
}
const tutta =await prova((r) => refertoScrittoRx(r, { nome: "ROSSI MARIO" }).righe, ["Paziente: ROSSI MARIO", "Nato il 01/01/1980"]);
check(tutta.length === 2, "se tutto sembrasse cornice, non si mostra niente di meno: resta com'era");
// un secondo taglio non toglie più niente: lo stesso testo sul PC e, dalla scheda, sul telefono
const FIRMA_IN_MEZZO = ["RX TORACE", "Opacità basale destra.", "Il Medico", "SENI LIBERI", "OMBRA CARDIACA NEI LIMITI", "NON PNX", "NON VERSAMENTO", "CUORE NORMALE", "Dott. Rossi"];
const meta = await prova((r) => { const a = refertoScrittoRx(r, { nome: "VERDI LUCA" }).righe; return [a, refertoScrittoRx(a, { nome: "VERDI LUCA" }).righe]; }, FIRMA_IN_MEZZO);
check(JSON.stringify(meta[0]) === JSON.stringify(FIRMA_IN_MEZZO.slice(0, 8)) && JSON.stringify(meta[1]) === JSON.stringify(meta[0]),
  `una firma in mezzo: via solo quella in fondo, e tagliato di nuovo resta uguale (got: ${meta.map((x) => x.length).join(" → ")} righe)`);
const CAMPIONI = [RIGHE, RIGHE_ESEMPIO, RIGHE_ALTRO, IDENT, CLINICA, MAIUSCOLA, RX1, RX2, RX2B, FIRMA_IN_MEZZO, ...COMUNICAZIONI,
  ["ECOGRAFIA ADDOME COMPLETO", "Fegato di dimensioni ed ecostruttura nei limiti.", "Conclusioni: ecografia addominale nei limiti."],
  [...TESTA, ESAME_LAB, "OPERATORE 10"], [...TESTA, SEP, "Testo", SEP], [...TESTA, ESAME_RX, SEP, "Testo"], [...TESTA, ESAME_RX, ESAME_BA, SEP, "Testo", SEP],
  ["RX BACINO", "Frattura della branca ileo-pubica destra.", "Dott. Bianchi", "FRATTURA COMPOMESSA", "CONTROLLO TC"],
  ["RX TORACE", "PNX APICALE DESTRO.", "DOTT. ROSSI INFORMATO TELEFONICAMENTE", "DOTT. BIANCHI"], ["Struttura ossea regolare.", "Nessuna frattura."],
  ["Paziente: ROSSI MARIO", "Nato il 01/01/1980"]];
const stabili = await prova((tutti) => tutti.map((r) => {
  const a = refertoScrittoRx(r, { nome: "ROSSI MARIO" }).righe;
  return JSON.stringify(refertoScrittoRx(a, { nome: "ROSSI MARIO" }).righe) === JSON.stringify(a);
}), CAMPIONI);
check(stabili.every(Boolean), `tagliare due volte è tagliare una volta, su tutti i campioni (${stabili.filter(Boolean).length}/${CAMPIONI.length})`);

console.log("\nla riga di anteprima di un referto");
const ante = (r) => prova((q) => anteprimaReferto(q), r);
check(await ante(["69-35 RX TORACE (6979) 01/10/2026 10:51", "Quadro polmonare nei limiti.", "Seni costofrenici liberi."]) === "Quadro polmonare nei limiti.", "mai la riga dell'esame: la prima frase del referto");
check(await ante(SENZA) === "Non focolai a carattere broncopneumonico.", "né il titolo, né il quesito");
check(await ante(["RX TORACE", "Torace: nulla di rilevante.", "Conclusioni: quadro nei limiti."]) === "quadro nei limiti.", "le conclusioni, se ci sono, su una riga");
check(await ante(["Conclusioni:", "Polmonite basale destra.", "Controllo in 7 giorni."]) === "Polmonite basale destra.", "«Conclusioni:» da sola: la riga dopo");
check(await ante(["RX BACINO", "Torace: nulla di rilevante."]) === "Torace: nulla di rilevante.", "«Torace: …» è un reperto, non un'etichetta");
check(await ante(["69-35 RX TORACE (6979) 01/10/2026 10:51", "NON FOCOLAI BRONCOPNEUMONICI IN ATTO.", "SENI COSTOFRENICI LIBERI."]) === "NON FOCOLAI BRONCOPNEUMONICI IN ATTO.",
  "un referto tutto maiuscolo: la sua prima frase, non la riga dell'esame");
check(await ante(["U.O.C. RADIOLOGIA DIAGNOSTICA", "RADIOGRAFIA TORACE 2 PROIEZIONI", "NON PNX.", "OMBRA CARDIACA NEI LIMITI."]) === "OMBRA CARDIACA NEI LIMITI.",
  "in maiuscolo, né l'intestazione del reparto né il titolo dell'esame");
check(await ante(["TORACE IN 2 PROIEZIONI", "69-35 RX TORACE", "Non focolai in atto."]) === "Non focolai in atto.",
  "un titolo maiuscolo sopra un referto con le minuscole: resta la frase del referto");

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
