#!/usr/bin/env node
/*
 * leggiStorico — the reader for the "Storico dati clinici" table, the one
 * page that shows every draw side by side.
 *
 * It asks the server NOTHING: it reads the table the doctor already has open.
 * Here it runs in a real browser against a rebuilt copy of that markup
 * (test/fixtures/storico.mjs) — invented patient, invented exams.
 *   node test/storico.mjs
 */
import { chromium } from "playwright";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paginaStorico, PAZIENTE, DATE } from "./fixtures/storico.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = readFileSync(join(root, "src/core.js"), "utf8");
// take the reader exactly as it ships, with the helpers it leans on
const da = core.indexOf("  const STORICO_SX =");
const a = core.indexOf("  // ------------------------------------------------------- RISULTATI MODEL");
if (da < 0 || a < 0 || a < da) throw new Error("blocco STORICO non trovato in src/core.js");
// il lettore usa impronta() (definita altrove nel file): la portiamo con noi
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
// il lettore usa impronta() e valKey(), definite altrove: le portiamo con noi
const linea = (frammento) => {
  const i = core.indexOf(frammento);
  if (i < 0) throw new Error("non trovato: " + frammento);
  return core.slice(i, core.indexOf("\n", i));
};
// le sigle, le sezioni e la provenienza: un blocco solo, com'è nel sorgente
const sigleDa = core.indexOf("  const SIGLE = [");
const sigleA = core.indexOf("  // ---- comparing draws");
if (sigleDa < 0 || sigleA < sigleDa) throw new Error("blocco SIGLE non trovato in src/core.js");
const src = grab("impronta") + "\n" + linea("const valKey =") + "\n"
  + core.slice(sigleDa, sigleA) + "\n" + core.slice(da, a);

function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const page = await browser.newPage();
const leggi = (html) => page.evaluate(([s, h]) => {
  const doc = new DOMParser().parseFromString(h, "text/html");
  // eslint-disable-next-line no-new-func
  return new Function("doc", s + "\nreturn { haStorico: haStorico(doc), dati: leggiStorico(doc) };")(doc);
}, [src, html]);

console.log("\nstorico dati clinici → tabella nel pannello");
const { haStorico, dati } = await leggi(paginaStorico());
check(haStorico, "riconosce la pagina dalla sua tabella, non dall'indirizzo");
check(!!dati, "legge la tabella");
check(dati.date.length === 3 && dati.date[2].label === DATE[2], `tre prelievi con data e ora (got ${dati.date.map((d) => d.label).join(" · ")})`);
check(dati.righe.length === 10, `dieci analiti (got ${dati.righe.length})`);

// the left column is the ORDERED EXAM, the one next to it is the analyte: a
// panel repeats the exam on every row, so reading the left one would give
// three rows all called "ESAME URINE COMPLETO"
const urine = dati.righe.filter((r) => r.esame === "ESAME URINE COMPLETO");
check(urine.length === 3 && new Set(urine.map((r) => r.nome)).size === 3,
  `un pannello dà un analita per riga, non tre volte lo stesso nome (got ${urine.map((r) => r.nome).join(", ")})`);
check(urine.some((r) => r.nome === "U-Emoglobina"),
  "e il prefisso del campione resta: U-Emoglobina non è l'emoglobina del sangue");

const hb = dati.righe.find((r) => r.nome === "Emoglobina");
check(!!hb && hb.codice === "1201" && hb.mnem === "HB", `codice e mnemonico dal tooltip (got ${hb?.codice} / ${hb?.mnem})`);
check(hb.esame === "EMOCROMO", `e la prestazione che l'ha prodotto (got ${hb.esame})`);
check(hb.valori.map((v) => v.v).join("|") === "13.2|11.8|10.4", `i valori in ordine di prelievo (got ${hb.valori.map((v) => v.v).join("|")})`);
check(hb.valori[0].stato === 0 && hb.valori[1].stato === -1, "la pagina dice già cosa è fuori range: sotto");

const gb = dati.righe.find((r) => r.nome === "Leucociti");
check(gb.valori[1].v === "" && gb.valori[2].stato === 1, "buco in mezzo e valore alto in fondo, senza scivolare di colonna");
const pcr = dati.righe.find((r) => r.nome === "S-PCR");
check(pcr.valori[2].v === ">90.0" && pcr.valori[2].stato === 1, "tiene i valori non numerici così come sono (>90.0)");
const emoc = dati.righe.find((r) => r.nome === "Emocoltura aerobi");
check(emoc.valori[1].v === "NEGATIVO", "e le risposte a parole");

check(dati.paziente.cognome === PAZIENTE.cognome && dati.paziente.nome === PAZIENTE.nome && dati.paziente.idMPI === PAZIENTE.idMPI,
  `i valori viaggiano col nome di chi sono (got ${JSON.stringify(dati.paziente)})`);
check(/dal 01\/09\/2026 al 02\/09\/2026/.test(dati.periodo), `e col periodo mostrato (got ${dati.periodo})`);

// the two tables are one table cut in half: if they stop lining up, a value
// would land on the wrong exam — then we read nothing at all
const rotta = await leggi(paginaStorico({ disallinea: true }));
check(rotta.dati === null, "se le due metà non combaciano non legge NIENTE, invece di sbagliare esame");

// ---- due letture della stessa tabella si sommano, non si sostituiscono ----
// (la pagina disegna solo le colonne che stanno nello schermo: scorrendole il
// medico ne fa comparire altre, e quelle già lette non devono sparire)
const due = (a, b) => page.evaluate(([s, ha, hb]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  // eslint-disable-next-line no-new-func
  const u = new Function("A", "B", s + "\nreturn unisciStorico(leggiStorico(A), leggiStorico(B));")(P(ha), P(hb));
  const riga = (nome) => { const x = u.righe.find((y) => y.nome === nome); return x ? x.valori.map((v) => v.v || "-").join("|") : "(assente)"; };
  return { date: u.date.map((d) => d.label), hb: riga("Emoglobina"), na: riga("S-Sodio") };
}, [src, a, b]);

const primi = paginaStorico({ date: ["01/09/2026 08:12", "01/09/2026 14:40"],
  esami: [["EMOCROMO", "Emoglobina", "1201", "HB", ["13.2", "11.8"], [0, -1]],
          ["SODIO", "S-Sodio", "1570", "NA", ["141", "138"], [0, 0]]] });
const dopo = paginaStorico({ date: ["02/09/2026 07:05", "03/09/2026 06:30"],
  esami: [["EMOCROMO", "Emoglobina", "1201", "HB", ["10.4", "9.1"], [-1, -1]],
          ["SODIO", "S-Sodio", "1570", "NA", ["129", "133"], [-1, -1]]] });
const uniti = await due(primi, dopo);
check(uniti.date.length === 4, `scorrendo le colonne i prelievi si sommano (got ${uniti.date.length})`);
check(uniti.hb === "13.2|11.8|10.4|9.1", `in ordine di tempo, ognuno nella sua colonna (got ${uniti.hb})`);

// due prelievi nello STESSO minuto (POC e laboratorio centrale insieme): sono
// due colonne diverse, e un valore non deve mai finire nell'altra
const gemelli = paginaStorico({ date: ["01/09/2026 08:12", "01/09/2026 08:12"],
  esami: [["EMOCROMO", "Emoglobina", "1201", "HB", ["13.2", ""], [0, 0]],
          ["EGA", "S-Sodio", "1570", "NA", ["", "141"], [0, 0]]] });
const g = await due(gemelli, gemelli);
check(g.hb === "13.2|-" && g.na === "-|141",
  `due prelievi nello stesso minuto restano due colonne (got hb=${g.hb} na=${g.na})`);

// ---- una riga che non sta in colonna non viene letta a caso -------------
// se al corpo manca una cella i valori scivolerebbero sotto il prelievo
// sbagliato: quella riga resta fuori, e viene dichiarata
const storta = await leggi(paginaStorico({ bucaColonna: 0 }));
check((storta.dati.scartate || []).length === 1 && storta.dati.scartate[0].nome === "Emoglobina",
  `una riga con una cella in meno non viene letta, e lo dice (got ${JSON.stringify(storta.dati.scartate)})`);
check(!storta.dati.righe.some((r) => r.nome === "Emoglobina"),
  "e i suoi valori non finiscono sotto le date sbagliate");
check(storta.dati.righe.length === 9, `le altre righe restano tutte (got ${storta.dati.righe.length})`);

// ---- di chi è questa tabella --------------------------------------------
// L'unico controllo fra i valori di un paziente e lo schermo di un altro:
// deve accettare i due ordini con cui i due sistemi scrivono il nome, e
// nient'altro.
const nomi = await page.evaluate((s) => {
  // eslint-disable-next-line no-new-func
  const { combaciaNome } = new Function(s + "\nreturn { combaciaNome };")();
  const P = (c, n) => ({ cognome: c, nome: n });
  return {
    dritto: combaciaNome("ROSSI MARIO", P("ROSSI", "MARIO")),
    rovescio: combaciaNome("MARIO ROSSI", P("ROSSI", "MARIO")),
    accenti: combaciaNome("D'AMICO NICOLO'", P("D'Amico", "Nicolò")),
    composto: combaciaNome("DE LUCA MARIA GRAZIA", P("De Luca", "Maria Grazia")),
    rimescolato: combaciaNome("GRAZIA LUCA DE MARIA", P("De Luca", "Maria Grazia")),
    altro: combaciaNome("ROSSI MARIO", P("ROSSI", "MARIA")),
    senzaNome: combaciaNome("ROSSI MARIO", P("", "")),
    senzaTitolo: combaciaNome("", P("ROSSI", "MARIO")),
  };
}, src);
check(nomi.dritto && nomi.rovescio, "accetta i due ordini: «ROSSI MARIO» e «MARIO ROSSI»");
check(nomi.accenti && nomi.composto, "accenti, apostrofi e nomi composti combaciano");
check(!nomi.rimescolato, "ma le parole rimescolate no: non basta che siano le stesse");
check(!nomi.altro && !nomi.senzaNome && !nomi.senzaTitolo, "un altro nome, o un nome mancante, non combacia mai");

// il codice fiscale e il nome non devono potersi contraddire
const compat = await page.evaluate((s) => {
  // eslint-disable-next-line no-new-func
  const { nomiCompatibili } = new Function(s + "\nreturn { nomiCompatibili };")();
  const P = (c, n) => ({ cognome: c, nome: n });
  return {
    uguali: nomiCompatibili("ROSSI MARIO", P("ROSSI", "MARIO")),
    conCoda: nomiCompatibili("ROSSI MARIO - PRONTO SOCCORSO", P("ROSSI", "MARIO")),
    diversi: nomiCompatibili("ROSSI MARIO", P("VERDI", "GIULIA")),
    illeggibile: nomiCompatibili("ROSSI MARIO", P("", "")),
  };
}, src);
check(compat.uguali && compat.conCoda, "un titolo che porta anche altro resta compatibile");
check(!compat.diversi, "due nomi senza niente in comune si contraddicono");
check(compat.illeggibile, "se un lato non è leggibile non c'è contraddizione da rilevare");

// ---- quale scheda è la sua, fra quelle in archivio ----------------------
// Il codice fiscale, quando c'è, decide sempre: un omonimo SENZA codice non
// deve poter vincere solo perché sta prima nell'elenco.
const scelte = await page.evaluate((s) => {
  // eslint-disable-next-line no-new-func
  const { scegliScheda } = new Function(s + "\nreturn { scegliScheda };")();
  const P = (c, n) => ({ cognome: c, nome: n });
  const senzaCf = { chiave: "nome:MARIO ROSSI", cf: "", paziente: P("ROSSI", "MARIO") };
  const conCf = { chiave: "cf:abc", cf: "abc", paziente: P("ROSSI", "MARIO") };
  const altro = { chiave: "cf:zzz", cf: "zzz", paziente: P("VERDI", "GIULIA") };
  return {
    cfPrimaDelNome: scegliScheda([senzaCf, conCf], "abc", "ROSSI MARIO")?.chiave,
    cfSbagliatoNienteRipiego: scegliScheda([senzaCf, conCf], "xyz", "ROSSI MARIO")?.chiave ?? null,
    senzaCodiceSulNome: scegliScheda([senzaCf], "", "ROSSI MARIO")?.chiave,
    nessunaSuaScheda: scegliScheda([altro], "abc", "ROSSI MARIO")?.chiave ?? null,
    archivioVuoto: scegliScheda([], "abc", "ROSSI MARIO") ?? null,
    mioIgnotoSchedaConCodice: scegliScheda([conCf], "", "ROSSI MARIO")?.chiave ?? null,
    // la scheda che porta l'episodio da cui il medico ha aperto il portale:
    // è lui ad averla aperta da lì, e vale più di nome e codice fiscale
    epPrimaDiTutto: scegliScheda([senzaCf, conCf, { ...altro, ep: "700001" }], "abc", "ROSSI MARIO", "700001")?.chiave ?? null,
  };
}, src);
check(scelte.epPrimaDiTutto === "cf:zzz",
  `la scheda letta arrivando da QUESTO paziente vince su tutto (got ${scelte.epPrimaDiTutto})`);
check(scelte.cfPrimaDelNome === "cf:abc",
  `fra un omonimo senza codice e la scheda col suo codice, vince il codice (got ${scelte.cfPrimaDelNome})`);
check(scelte.cfSbagliatoNienteRipiego === null,
  "e se il codice non combacia non si ripiega sul nome: non mostra niente");
check(scelte.senzaCodiceSulNome === "nome:MARIO ROSSI", "senza codici in archivio decide il nome");
// e se il MIO codice non si sa, una scheda che ne porta uno non è attribuibile
check(scelte.mioIgnotoSchedaConCodice === null,
  "se il codice del paziente davanti non si sa ancora, una scheda con un codice non gli si attribuisce");
check(scelte.nessunaSuaScheda === null && scelte.archivioVuoto === null, "e di un paziente senza scheda non sceglie nulla");

// ---- due omonimi senza codice fiscale NON sono la stessa persona ---------
// Sul portale si passa da un paziente all'altro senza ricaricare, e il codice
// fiscale non sempre si riesce a leggere. Prima "" === "" li faceva combaciare:
// i prelievi del secondo finivano nel grafico del primo.
const omonimi = await page.evaluate(([s, a, b]) => {
  const doc = (h) => new DOMParser().parseFromString(h, "text/html");
  // eslint-disable-next-line no-new-func
  return new Function("dA", "dB", s + `
    const x = leggiStorico(dA), y = leggiStorico(dB);
    const senzaCf = unisciStorico({ ...x, cf: "" }, { ...y, cf: "" });
    const stessoCf = unisciStorico({ ...x, cf: "abc" }, { ...y, cf: "abc" });
    return { senzaCf: senzaCf.date.length, stessoCf: stessoCf.date.length };
  `)(doc(a), doc(b));
}, [src, paginaStorico({ date: [DATE[0]] }), paginaStorico({ date: [DATE[1]] })]);
check(omonimi.senzaCf === 1,
  `due schede senza codice fiscale non si fondono (got ${omonimi.senzaCf} colonne, attese 1)`);
check(omonimi.stessoCf === 2,
  `ma con lo STESSO codice fiscale sì (got ${omonimi.stessoCf} colonne, attese 2)`);

// ---- sezioni: gli esami stanno dove un medico li cerca -------------------
const sez = await page.evaluate((s) => {
  // eslint-disable-next-line no-new-func
  return new Function(s + `
    const righe = [
      { nome: "Emoglobina", esame: "EMOCROMO", valori: [{ v: "12", stato: 0 }] },
      { nome: "Leucociti", esame: "EMOCROMO", valori: [{ v: "9", stato: 0 }] },
      { nome: "Piastrine", esame: "EMOCROMO", valori: [{ v: "200", stato: 0 }] },
      { nome: "Creatinina", esame: "CREATININA", valori: [{ v: "1.1", stato: 0 }] },
      { nome: "ALT", esame: "EPATICO", valori: [{ v: "30", stato: 0 }] },
      { nome: "PCR", esame: "PCR", valori: [{ v: "40", stato: 1 }] },
      { nome: "pH", esame: "EGA ARTERIOSA", valori: [{ v: "7.31", stato: -1 }] },
      { nome: "Lattati", esame: "EGA ARTERIOSA", valori: [{ v: "3.0", stato: 1 }] },
      { nome: "U-Emoglobina", esame: "ESAME URINE", valori: [{ v: "presente", stato: 0 }] },
      { nome: "Fantasilina", esame: "FANTASIA", valori: [{ v: "7", stato: 0 }] },
    ];
    const g = raggruppaStorico(righe);
    return {
      sezioni: g.map((x) => x.nome),
      emocromo: (g.find((x) => x.nome === "Emocromo") || { righe: [] }).righe.map((r) => r.sg),
      organi: (g.find((x) => x.nome === "Organi") || { righe: [] }).righe.map((r) => r.sg),
      urine: (g.find((x) => x.nome === "Urine e altri liquidi") || { righe: [] }).righe.map((r) => r.sg),
      altri: (g.find((x) => x.nome === "Altri") || { righe: [] }).righe.map((r) => r.nome),
    };
  `)();
}, src);
check(sez.sezioni.join(" | ") === "Emocromo | Biochim | Organi | Emogas | Urine e altri liquidi | Altri",
  `le sezioni escono nell'ordine in cui si leggono (got ${sez.sezioni.join(" | ")})`);
check(sez.emocromo.join(",") === "GB,Hb,PLT",
  `dentro una sezione l'ordine è fisso, non quello del laboratorio (got ${sez.emocromo.join(",")})`);
check(sez.organi.join(",") === "Cr,ALT", `l'esame va dove lo si cerca (got ${sez.organi.join(",")})`);
// l'emoglobina delle urine non è quella del sangue: il campione decide prima
check(sez.urine.join(",") === "U·Hb" && !sez.emocromo.includes("U·Hb"),
  `l'emoglobina delle urine non finisce nell'emocromo (got ${sez.urine.join(",")})`);
check(sez.altri.join(",") === "Fantasilina", "un nome che il programma non conosce non si perde: va in «Altri»");

// ---- provenienza: stessa riga, macchine diverse --------------------------
const prov = await page.evaluate((s) => {
  // eslint-disable-next-line no-new-func
  return new Function(s + `
    // tre prelievi: due col POC, l'ultimo col laboratorio
    const r = { nome: "Emoglobina", esame: "EMOCROMO POC", valori: [
      { v: "13.0", stato: 0, esame: "EMOCROMO POC" },
      { v: "12.0", stato: 0, esame: "EMOCROMO POC" },
      { v: "11.0", stato: 0, esame: "EMOCROMO FANTOLI" },
    ] };
    const p = provenienze(r);
    const sola = provenienze({ nome: "PCR", esame: "PCR", valori: [{ v: "9", stato: 0, esame: "PCR" }] });
    return {
      segni: r.valori.map((v) => p.segno(v)),
      solita: p.solita,
      legenda: p.legenda.map((l) => l.segno + " " + l.esame),
      quandoUnaSola: { segno: sola.segno({ esame: "PCR" }), legenda: sola.legenda.length },
    };
  `)();
}, src);
check(sez && prov.segni.join("|") === "||*",
  `la macchina di sempre non si segna, l'altra sì (got ${prov.segni.join("|")})`);
check(prov.solita === "EMOCROMO POC", `«di sempre» è quella che ha fatto più valori (got ${prov.solita})`);
check(prov.legenda.join(" ") === "* EMOCROMO FANTOLI", `e sotto la tabella si dice quale (got ${prov.legenda.join(" ")})`);
check(prov.quandoUnaSola.segno === "" && prov.quandoUnaSola.legenda === 0,
  "con una macchina sola non si segna niente: l'asterisco vuol dire qualcosa solo se è raro");

// ---- la provenienza sopravvive alla fusione ------------------------------
const provFusa = await page.evaluate(([s, a, b]) => {
  const doc = (h) => new DOMParser().parseFromString(h, "text/html");
  // eslint-disable-next-line no-new-func
  return new Function("dA", "dB", s + `
    const u = unisciStorico(leggiStorico(dA), leggiStorico(dB));
    const hb = u.righe.find((r) => /emoglobina/i.test(r.nome));
    return { esami: hb.valori.map((v) => v.esame || ""), n: u.date.length };
  `)(doc(a), doc(b));
}, [src, paginaStorico({ date: [DATE[0]], esami: [["EMOCROMO POC", "Emoglobina", "1201", "HB", ["13.0"], [0]]] }),
    paginaStorico({ date: [DATE[1]], esami: [["EMOCROMO FANTOLI", "Emoglobina", "1201", "HB", ["11.0"], [0]]] })]);
check(provFusa.n === 2 && provFusa.esami.filter(Boolean).length === 2
  && new Set(provFusa.esami.filter(Boolean)).size === 2,
  `fondendo due letture ogni valore si porta dietro chi l'ha fatto (got ${provFusa.esami.join(" / ")})`);

// a page that is not that page
const altra = await leggi("<html><body><table><tr><td>ciao</td></tr></table></body></html>");
check(altra.haStorico === false && altra.dati === null, "su una pagina qualsiasi non inventa una tabella");

// no draw at all in the period
const vuota = await leggi(paginaStorico({ esami: [["EMOCROMO", "Emoglobina", "1201", "HB", ["", "", ""], [0, 0, 0]]] }));
check(vuota.dati === null, "un periodo senza risultati non produce una tabella vuota");

await browser.close();
console.log(fail ? `\nSTORICO: ${fail} CHECK FALLITI\n` : "\nSTORICO: TUTTO OK\n");
process.exit(fail ? 1 : 0);
