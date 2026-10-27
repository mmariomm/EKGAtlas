#!/usr/bin/env node
/*
 * Al rilascio: la build committata è quella di adesso? Rifà la build (al suo
 * posto: extension/content.js, extension/ponte-cripto.js, il bookmarklet) e la
 * confronta con l'ultimo commit; poi guarda dentro dist/ps-assist-latest.zip:
 * ogni file dell'estensione e della cartella stampa/ dev'essere quello di
 * adesso, SumatraPDF e il manifest dell'aiutante no, e le versioni devono
 * tornare. Non sta in `npm test`: fra un rilascio e l'altro la build
 * committata è vecchia per scelta (si rifà solo al rilascio).
 *   npm run verifica-build     (dopo `npm run dist` e il commit)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const guai = [];
execFileSync("node", ["tools/build.mjs"], { cwd: root, stdio: "ignore" });
const BUILD = ["extension/content.js", "extension/ponte-cripto.js", "bookmarklet"];
try { execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...BUILD], { cwd: root }); }
catch { guai.push(`la build committata è vecchia (${BUILD.join(", ")}): npm run dist, e committa anche quelli`); }

const zip = join(root, "dist/ps-assist-latest.zip");
let elenco = [];
try { elenco = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean); }
catch { guai.push("dist/ps-assist-latest.zip non si legge (manca? npm run dist)"); }
if (elenco.length) {
  const tutti = (dir) => readdirSync(join(root, dir)).flatMap((n) => {
    const p = join(dir, n);
    return statSync(join(root, p)).isDirectory() ? tutti(p) : [p];
  });
  const devono = [...tutti("extension"), ...tutti("stampa").filter((f) => !/\/(\.|SumatraPDF|it\.psassist\.stampa\.json)/.test(f))];
  for (const f of devono) {
    if (!elenco.includes(f)) { guai.push(`nello zip manca ${f}`); continue; }
    const dentro = execFileSync("unzip", ["-p", zip, f], { maxBuffer: 64 << 20 });
    if (Buffer.compare(dentro, readFileSync(join(root, f))) !== 0) guai.push(`nello zip ${f} non è quello di adesso`);
  }
  for (const f of elenco.filter((x) => /^stampa\/(SumatraPDF|it\.psassist\.stampa\.json)/.test(x))) guai.push(`nello zip non deve esserci ${f}`);
}
const manifest = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));
const core = /const VERSION = "([^"]+)"/.exec(readFileSync(join(root, "src/core.js"), "utf8"))?.[1];
const dist = readFileSync(join(root, "dist/VERSION.txt"), "utf8").trim();
if (core !== manifest.version || dist !== manifest.version) guai.push(`versioni diverse: core.js ${core}, manifest ${manifest.version}, dist/VERSION.txt ${dist}`);
if (!manifest.key) guai.push("il manifest non ha la «key»: l'ID dell'estensione cambierebbe con la cartella");

if (guai.length) {
  console.error(`VERIFICA-BUILD: ${guai.length} da sistemare\n${guai.map((g) => "  ✗ " + g).join("\n")}`);
  process.exit(1);
}
console.log(`VERIFICA-BUILD: OK — la build, lo zip e la versione ${manifest.version} sono quelli di adesso (${relative(root, zip)})`);
