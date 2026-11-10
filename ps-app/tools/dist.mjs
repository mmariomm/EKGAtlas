#!/usr/bin/env node
/*
 * Refresh dist/ps-assist-latest.zip (the fixed public download) + VERSION.txt
 * from the current build. Run via `npm run dist` (which builds first).
 * The stable link served once the repo is public:
 *   https://github.com/mmariomm/EKGAtlas/raw/main/ps-app/dist/ps-assist-latest.zip
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestLettura, LETTURA_BANDIERA } from "./lettura.mjs";

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

// --- la build mini «PS Assist · Lettura e stampa» (sola lettura) ---------
// Stesse sorgenti, un manifest e una bandiera a parte (tools/lettura.mjs). Si
// prepara una copia dell'estensione con il manifest mini e sola-lettura.js a
// `true`, e si zippa come la normale (extension + stampa + README). La versione
// è la stessa (VERSION.txt è unico: le due build escono insieme).
const stage = join(root, "dist/.lettura");
rmSync(stage, { recursive: true, force: true });
cpSync(join(root, "extension"), join(stage, "extension"), { recursive: true });
rmSync(join(stage, "extension/installata.json"), { force: true });   // mai nello zip (come la normale)
const baseMan = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));
writeFileSync(join(stage, "extension/manifest.json"), JSON.stringify(manifestLettura(baseMan), null, 2) + "\n");
writeFileSync(join(stage, "extension/sola-lettura.js"), LETTURA_BANDIERA);
const zipL = join(root, "dist/ps-assist-lettura.zip");
rmSync(zipL, { force: true });
// l'estensione (mini) dalla copia preparata…
execFileSync("zip", ["-q", "-r", zipL, "extension"], { cwd: stage });
// …e l'aiutante di stampa e il README dalla radice, come la build normale
// (niente bookmarklet né dimissioni.html: sono per gli ordini, non per un PC di sola lettura)
execFileSync("zip", ["-q", "-r", zipL, "stampa", "README.md",
  "-x", "stampa/.*", "stampa/SumatraPDF-settings.txt", "stampa/it.psassist.stampa.json"], { cwd: root });
rmSync(stage, { recursive: true, force: true });
console.log(`dist refreshed: ps-assist-latest.zip + ps-assist-lettura.zip @ v${version} — dopo il commit: npm run verifica-build`);
