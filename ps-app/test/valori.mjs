#!/usr/bin/env node
/*
 * The two pure functions behind the Esiti screen, pinned case by case:
 *   outOfRange — is this value outside its range? (never a red mark we
 *                cannot justify: when in doubt it must answer 0)
 *   sigla      — the short name a doctor reads
 * They are taken from src/core.js as they ship, not re-typed here.
 *   node test/valori.mjs
 */
import { readFileSync } from "node:fs";
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
const { outOfRange, sigla, confrontaPrelievi, ordinaRighe } = new Function(
  grab("outOfRange") + "\n" + core.slice(core.indexOf("const SIGLE = ["), core.indexOf("// First ~160 chars"))
  + "\nreturn { outOfRange, sigla, confrontaPrelievi, ordinaRighe };",
)();

let fail = 0;
const check = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } };
const eq = (got, want, m) => check(got === want, `${m} (atteso ${want}, ottenuto ${got})`);

console.log("\nvalori e range");
// --- fuori range, in tutti i modi in cui i laboratori li scrivono
eq(outOfRange("80", "135 - 180"), -1, "sotto un range semplice");
eq(outOfRange("450", "150 - 400"), 1, "sopra un range semplice");
eq(outOfRange("36,3", "36,0 - 37,5"), 0, "decimali con la virgola, dentro");
eq(outOfRange("35,2", "36,0 - 37,5"), -1, "decimali con la virgola, sotto");
eq(outOfRange("12", "4 - 10 x10^3"), 1, "unità appiccicata al range");
eq(outOfRange("7.9", "7.35 – 7.45"), 1, "trattino lungo");
eq(outOfRange("-4", "-2 - +2"), -1, "range che attraversa lo zero");
eq(outOfRange("1", "-2 - +2"), 0, "dentro un range negativo");
eq(outOfRange("0.8", "< 0.5"), 1, "solo limite superiore (<)");
eq(outOfRange("0.3", "< 0.5"), 0, "sotto il limite superiore");
eq(outOfRange("0.9", "fino a 0.5"), 1, "«fino a»");
eq(outOfRange("0.2", "inf. a 0.5"), 0, "«inf. a», dentro");
eq(outOfRange("40", "> 60"), -1, "solo limite inferiore (>)");
eq(outOfRange("90", "> 60"), 0, "sopra il limite inferiore");
eq(outOfRange("55", "sup. a 60"), -1, "«sup. a»");
eq(outOfRange("<0.01", "0.1 - 1.5"), -1, "valore «minore di» sotto il range");
eq(outOfRange("<5", "5 - 10"), -1, "«<5» col limite esattamente a 5");
eq(outOfRange(">1000", "0 - 100"), 1, "valore «maggiore di» sopra il range");
// --- casi in cui deve tacere, non sbagliare
eq(outOfRange("NEGATIVO", "0 - 10"), 0, "risultato a parole");
eq(outOfRange("Assente", ""), 0, "nessun range");
eq(outOfRange("13.5", "M: 13-17 F: 12-16"), 0, "range che dipende dal sesso");
eq(outOfRange("5", "vedi referto"), 0, "range non numerico");
eq(outOfRange("5", "1 - 2 - 3"), 0, "range malformato");
eq(outOfRange("5", "10 - 1"), 0, "estremi invertiti");
eq(outOfRange("", "1 - 10"), 0, "valore vuoto");
eq(outOfRange("tracce", "neg"), 0, "tutto qualitativo");

console.log("confronto tra prelievi");
{
  const R = (nome, valore, um = "") => ({ nome, valore, um, range: "", stato: "parziale" });
  const draws = [
    { id: "nuovo", rows: [R("Leucociti", "6.4", "x10"), R("Emoglobina", "80", "g/L"), R("Ematocrito", "44", "%")] },
    { id: "vecchio", rows: [R("Emoglobina", "95", "g/L"), R("Leucociti", "6.1", "x10"), R("Ematocrito", "44", "%")] },
  ];
  const { order, delta } = confrontaPrelievi(draws);
  const dNew = delta.get("nuovo");
  check(dNew.has("emoglobina") && dNew.get("emoglobina").dir === "▼", "Hb −16% è marcata in discesa");
  eq(dNew.has("leucociti"), false, "GB +5% resta sotto la soglia dell'emocromo");
  eq(dNew.has("ematocrito"), false, "un valore identico non è una variazione");
  eq(delta.get("vecchio").size, 0, "il prelievo più vecchio non ha un precedente");
  const ord = ordinaRighe(draws[1].rows, order).map((r) => r.nome);
  eq(ord.join(","), "Leucociti,Emoglobina,Ematocrito", "l'ordine del più recente comanda anche sul vecchio");

  const mod = confrontaPrelievi([
    { id: "a", rows: [R("Troponina", "<0.01", "ng/L")] },
    { id: "b", rows: [R("Troponina", "0.05", "ng/L")] },
  ]).delta.get("a");
  eq(mod.size, 0, "un valore con modificatore (<0.01) non genera mai una variazione");

  const umm = confrontaPrelievi([
    { id: "a", rows: [R("Emoglobina", "8.0", "g/dL")] },
    { id: "b", rows: [R("Emoglobina", "80", "g/L")] },
  ]).delta.get("a");
  eq(umm.size, 0, "unità diverse (g/dL vs g/L) non vengono mai confrontate");

  const ph = confrontaPrelievi([
    { id: "a", rows: [R("pH", "7.30", "")] },
    { id: "b", rows: [R("pH", "7.42", "")] },
  ]).delta.get("a");
  check(ph.has("ph") && ph.get("ph").dir === "▼", "il pH usa la variazione assoluta (0.12 ≥ 0.05)");
  const ph2 = confrontaPrelievi([
    { id: "a", rows: [R("pH", "7.40", "")] },
    { id: "b", rows: [R("pH", "7.42", "")] },
  ]).delta.get("a");
  eq(ph2.size, 0, "0.02 di pH non è una variazione");
}

console.log("sigle");
eq(sigla("Emoglobina "), "Hb", "Emoglobina");
eq(sigla("Leucociti"), "GB", "Leucociti");
eq(sigla("MCH Cont. Media Hgb"), "MCH", "MCH col nome lungo");
eq(sigla("MCHC Conc. Media Hgb"), "MCHC", "MCHC");
eq(sigla("Piastrine"), "PLT", "Piastrine");
eq(sigla("Creatininemia"), "Cr", "Creatinina");
eq(sigla("PROTEINA C REATTIVA"), "PCR", "PCR in maiuscolo");
eq(sigla("NT pro-BNP"), "NTproBNP", "NT-proBNP");
eq(sigla("Troponina I"), "Trop", "Troponina");
eq(sigla("pCO2"), "pCO2", "emogas");
eq(sigla("Lattati"), "Lac", "lattati");
eq(sigla("Esame mai visto prima"), "Esame", "esame sconosciuto: prima parola");
eq(sigla("Antitrombina III funzionale"), "Antitrom.", "nome lungo sconosciuto: accorciato");

// ---------------------------------------------------------------- il DOM
// parseRisultati reads the LIS table: these are the shapes that table takes,
// including the ones that used to fool it.
const { chromium } = await import("playwright");
const { existsSync, statSync } = await import("node:fs");
const chromiumPath = () => ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]
  .find((p) => existsSync(p) && statSync(p).isFile());
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const page = await browser.newPage();
const parse = (body) => page.evaluate(({ src, body }) => {
  eval(src);
  return parseRisultati(new DOMParser().parseFromString(`<table><tbody>${body}</tbody></table>`, "text/html"));
}, { src: grab("parseRisultati"), body });

const D = (...cells) => `<tr>${cells.map((c) => `<td class="AFCDataTD">${c}</td>`).join("")}</tr>`;
const riga = D("Emoglobina&nbsp;", "8.0", "g/dL", "13 - 17", "definitivo", "23/08/2026 07:47");

console.log("tabella dei risultati");
let r = await parse(riga);
eq(r.length, 1, "la riga completa viene letta");
eq(r[0].nome, "Emoglobina", "il nome perde gli spazi unificatori");
eq(r[0].um, "g/dL", "unità di misura");

r = await parse(riga + D("Sodio", "138", "mmol/L", "136 - 145", "definitivo", "23/08/2026 07:47"));
eq(r.length, 2, "due righe, due esami");

r = await parse(`<tr><td class="AFCColumnTD">Esame</td><td class="AFCColumnTD">Valore</td></tr>` + riga);
eq(r.length, 1, "l'intestazione di colonna non è un esame");

r = await parse(D("Assistito", "<table><tr><td class='AFCDataTD'>NOME COGNOME</td><td class='AFCDataTD'>eta 91</td><td class='AFCDataTD'>CF</td><td class='AFCDataTD'>x</td><td class='AFCDataTD'>y</td></tr></table>") + riga);
eq(r.length, 1, "l'intestazione del paziente, con tabelle annidate, non è un esame");

r = await parse(D("Quesito", "dolore addominale", "", "", "", "") + riga);
eq(r.length, 1, "il quesito non è un esame");

r = await parse(D("Emocromo", "", "", "4 - 10", "parziale", "23/08/2026") + riga);
eq(r.length, 1, "una riga senza valore viene saltata");

r = await parse(D("Troponina", "12", "ng/L", "", "definitivo", "23/08/2026 07:47"));
eq(r.length, 1, "un esame senza range resta un esame");

r = await parse(D("PCR", "48", "mg/L", "< 5", "definitivo", ""));
eq(r.length, 1, "senza data ma con range e stato viene letta");

r = await parse(D("Nota di reparto", "vedi diario", "", "", "", ""));
eq(r.length, 0, "una riga di servizio senza data, range e stato viene scartata");

const grosso = Array.from({ length: 60 }, (_, i) => D(`Esame ${i}`, String(i), "u", "0 - 100", "definitivo", "23/08/2026 07:47")).join("");
r = await parse(grosso);
eq(r.length, 60, "un pannello lungo viene letto per intero");

await browser.close();

console.log(fail ? `\nVALORI: ${fail} CASI FALLITI\n` : "\nVALORI: TUTTI I CASI OK\n");
process.exit(fail ? 1 : 0);
