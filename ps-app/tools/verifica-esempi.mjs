#!/usr/bin/env node
/*
 * Gate for the files rebuilt from real hospital pages: nothing identifying,
 * nothing that can call out. It covers esempi-gestionale/ (the saved screens)
 * and test/fixtures/ (pages rebuilt from their shape) — anything written by
 * looking at a real page goes through here.
 * Run before every commit that touches those files (npm run esempi, npm test).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARTELLE = [
  { dir: join(root, "esempi-gestionale"), est: /\.(html|css|json)$/ },
  { dir: join(root, "test/fixtures"), est: /\.(mjs|html|json)$/ },
];

const FORBIDDEN = [
  // patients
  [/ALBERTIN|KALEMCI|MASERA|ONGARI/i, "cognome di un paziente"],
  // staff met in the originals (names and usernames): a rebuild must never
  // bring one back, whatever the rules do
  [/MEGLIO|BUIA|DEVERA|FALASCA|FRANCESCONI|MADDALONI|NOVOA|TERRONES|PASTORE|PIZZABALLA|PUSCEDDU|ROMANENGHI|SAPORITO|SCIREA|TOSKIC|VLAD/i, "nome di un operatore"],
  [/\bMMEGLIO\b|\bMADAN\b|\bMEGMA\b|\bBUICO\b|\bFALNO\b|\bSAPSA\b|\bTOSDE\b|\bDEVAR\b|\bNOVDI\b|\bROMIL\b/i, "utenza di un operatore"],
  [/Somministrato da|Eseguito da|\[EV\]|\[OS\]/i, "annotazione di terapia"],
  [/multimedica|irccs|finmatica|dedalus|smarthealth|10\.11\.0\.151/i, "ospedale o fornitore"],
  [/\b120595\b|\b113925\b|\b130300\b|\b130409\b|\b889101\b|\b858241\b|\b858242\b|\b934656\b/, "identificativo reale"],
  [/2026\/7492|PS-2026\/11607|20260010040701|20260010035301/, "numero di episodio o accesso reale"],
  [/https?:\/\//i, "indirizzo esterno"],
  [/<script\b/i, "script"],
  [/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i, "email"],
  [/\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/, "numero di telefono"],
  [/\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, "indirizzo interno"],
];
// any codice fiscale except the invented one
const CF = /\b(?!SMPRSS80A01F205X)[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/;

let bad = 0, files = 0;
for (const { dir, est } of CARTELLE) for (const f of readdirSync(dir).sort()) {
  if (!est.test(f)) continue;
  files++;
  const text = readFileSync(join(dir, f), "utf8");
  const hits = [];
  for (const [re, why] of FORBIDDEN) {
    const m = re.exec(text);
    if (m) hits.push(`${why}: «${m[0].slice(0, 40)}»`);
  }
  const cf = CF.exec(text);
  if (cf) hits.push(`codice fiscale: «${cf[0]}»`);
  const dove = dir.slice(root.length + 1) + "/" + f;
  if (hits.length) { bad++; console.log(`  ✗ ${dove}\n      ` + hits.join("\n      ")); }
  else console.log(`  ✓ ${dove}`);
}
console.log(bad ? `\nESEMPI: ${bad}/${files} file da ripulire\n` : `\nESEMPI PULITI (${files} file)\n`);
process.exit(bad ? 1 : 0);
