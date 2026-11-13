#!/usr/bin/env node
/*
 * Refresh dist/ps-assist-latest.zip (the fixed public download) + VERSION.txt
 * from the current build. Run via `npm run dist` (which builds first).
 * The stable link served once the repo is public:
 *   https://github.com/mmariomm/EKGAtlas/raw/main/ps-app/dist/ps-assist-latest.zip
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preparaLettura } from "./lettura.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = /"version":\s*"([^"]+)"/.exec(readFileSync(join(root, "extension/manifest.json"), "utf8"))?.[1] ?? "0.0.0";

mkdirSync(join(root, "dist"), { recursive: true });
const zip = join(root, "dist/ps-assist-latest.zip");
rmSync(zip, { force: true });
// stampa/ è l'aiutante della stampa automatica, così com'è, con SumatraPDF.exe
// (ufficiale 3.6.1, GPLv3: col suo LEGGIMI e la licenza; installa.ps1 ne
// controlla l'impronta). Le impostazioni di SumatraPDF e il manifest li crea installa.cmd sul PC.
// (E installata.json, nella copia dell'estensione: mai nello zip.)
execFileSync("zip", ["-q", "-r", "dist/ps-assist-latest.zip",
  "extension", "bookmarklet", "stampa", "README.md", "dist/dimissioni.html",
  "-x", "stampa/.*", "stampa/SumatraPDF-settings.txt", "stampa/it.psassist.stampa.json", "extension/installata.json"], { cwd: root });
writeFileSync(join(root, "dist/VERSION.txt"), version + "\n");

// --- la build «PS Assist · Stampa Infermeria» (fino alla 3.87 la mini «Lettura e stampa») ---
// Stesse sorgenti, un manifest e una bandiera a parte (tools/lettura.mjs). Lo zip ha lo
// stesso nome di prima (le mini installate scaricano quello). In cima, per chi lo apre:
// «Installa Stampa Infermeria.cmd», «Disinstalla Stampa Infermeria.cmd» e LEGGIMI.txt
// (infermeria/); poi l'estensione preparata, e l'aiutante di stampa dalla radice.
const stage = join(root, "dist/.lettura");
rmSync(stage, { recursive: true, force: true });
cpSync(join(root, "extension"), join(stage, "extension"), { recursive: true });
preparaLettura(join(stage, "extension"), fs, join);
for (const f of ["Installa Stampa Infermeria.cmd", "Disinstalla Stampa Infermeria.cmd", "LEGGIMI.txt"]) cpSync(join(root, "infermeria", f), join(stage, f));
const zipL = join(root, "dist/ps-assist-lettura.zip");
rmSync(zipL, { force: true });
execFileSync("zip", ["-q", "-r", zipL, "LEGGIMI.txt", "Installa Stampa Infermeria.cmd", "Disinstalla Stampa Infermeria.cmd", "extension"], { cwd: stage });
// (niente bookmarklet né dimissioni.html: sono per gli ordini)
execFileSync("zip", ["-q", "-r", zipL, "stampa", "README.md",
  "-x", "stampa/.*", "stampa/SumatraPDF-settings.txt", "stampa/it.psassist.stampa.json"], { cwd: root });
rmSync(stage, { recursive: true, force: true });
console.log(`dist refreshed: ps-assist-latest.zip + ps-assist-lettura.zip @ v${version} — dopo il commit: npm run verifica-build`);
