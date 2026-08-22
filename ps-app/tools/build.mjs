#!/usr/bin/env node
/*
 * Build PS Assist: injects the verified catalog into src/core.js and emits
 *   extension/content.js          (MV3 content script)
 *   userscript/ps-assist.user.js  (same core with a Tampermonkey header)
 * Run:  node tools/build.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = readFileSync(join(root, "src/core.js"), "utf8");
const catalog = JSON.parse(readFileSync(join(root, "src/catalog.json"), "utf8"));

const PLACEHOLDER = "/*__CATALOG__*/ {}";
if (!core.includes(PLACEHOLDER)) {
  console.error("catalog placeholder not found in src/core.js");
  process.exit(1);
}
const version = /const VERSION = "([^"]+)"/.exec(core)?.[1] ?? "0.0.0";
const built = core.replace(PLACEHOLDER, () => JSON.stringify(catalog)); // fn form: no $-pattern pitfalls

writeFileSync(join(root, "extension/content.js"), built);

const header = `// ==UserScript==
// @name         PS Assist — richieste Pronto Soccorso (SA4PSO)
// @namespace    psassist.multimedica
// @version      ${version}
// @description  Crea richieste lab/radiologia, aggiunge gli esami scelti verificando ogni inserimento nel carrello. Conferma sempre come click reale sulla pagina.
// @match        https://smarthealth.multimedica.it/sa4pso/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

`;
writeFileSync(join(root, "userscript/ps-assist.user.js"), header + built);

console.log(`built v${version}: extension/content.js (${built.length} bytes), userscript/ps-assist.user.js`);
