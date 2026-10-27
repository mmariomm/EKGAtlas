#!/usr/bin/env node
/*
 * Refresh dist/ps-assist-latest.zip (the fixed public download) + VERSION.txt
 * from the current build. Run via `npm run dist` (which builds first).
 * The stable link served once the repo is public:
 *   https://github.com/mmariomm/EKGAtlas/raw/main/ps-app/dist/ps-assist-latest.zip
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = /"version":\s*"([^"]+)"/.exec(readFileSync(join(root, "extension/manifest.json"), "utf8"))?.[1] ?? "0.0.0";

mkdirSync(join(root, "dist"), { recursive: true });
const zip = join(root, "dist/ps-assist-latest.zip");
rmSync(zip, { force: true });
// the banco di prova travels with the download: one file, opens offline
execFileSync("node", ["tools/demo.mjs"], { cwd: root, stdio: "ignore" });
// stampa/ è l'aiutante della stampa automatica, così com'è: SumatraPDF e il
// manifest li crea installa.cmd sul PC, non viaggiano nello zip
execFileSync("zip", ["-q", "-r", "dist/ps-assist-latest.zip",
  "extension", "bookmarklet", "stampa", "README.md", "dist/demo.html", "dist/dimissioni.html",
  "-x", "stampa/.*", "stampa/SumatraPDF*", "stampa/it.psassist.stampa.json"], { cwd: root });
writeFileSync(join(root, "dist/VERSION.txt"), version + "\n");
console.log(`dist refreshed: ps-assist-latest.zip @ v${version} — dopo il commit: npm run verifica-build`);
