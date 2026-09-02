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
const src = core.slice(da, a);

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

// a page that is not that page
const altra = await leggi("<html><body><table><tr><td>ciao</td></tr></table></body></html>");
check(altra.haStorico === false && altra.dati === null, "su una pagina qualsiasi non inventa una tabella");

// no draw at all in the period
const vuota = await leggi(paginaStorico({ esami: [["EMOCROMO", "Emoglobina", "1201", "HB", ["", "", ""], [0, 0, 0]]] }));
check(vuota.dati === null, "un periodo senza risultati non produce una tabella vuota");

await browser.close();
console.log(fail ? `\nSTORICO: ${fail} CHECK FALLITI\n` : "\nSTORICO: TUTTO OK\n");
process.exit(fail ? 1 : 0);
