#!/usr/bin/env node
/*
 * Build PS Assist: injects the verified catalog into src/core.js and emits
 *   extension/content.js               (MV3 content script)
 *   bookmarklet/…bookmarklet.txt       (same core as a javascript: URL)
 * The userscript vehicle was retired in 3.2: extension (primary) plus
 * bookmarklet (locked-down PCs) cover every machine with one build less
 * to test, document and support.
 * Run:  node tools/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = readFileSync(join(root, "src/core.js"), "utf8");
const catalog = JSON.parse(readFileSync(join(root, "src/catalog.json"), "utf8"));
const dimissioni = JSON.parse(readFileSync(join(root, "src/dimissioni.json"), "utf8"));

const PLACEHOLDER = "/*__CATALOG__*/ {}";
const PLACEHOLDER_DIM = "/*__DIMISSIONI__*/ {}";
for (const [ph, cosa] of [[PLACEHOLDER, "catalog"], [PLACEHOLDER_DIM, "dimissioni"]]) {
  if (!core.includes(ph)) {
    console.error(`${cosa} placeholder not found in src/core.js`);
    process.exit(1);
  }
}
const version = /const VERSION = "([^"]+)"/.exec(core)?.[1] ?? "0.0.0";
const built = core
  .replace(PLACEHOLDER, () => JSON.stringify(catalog))       // fn form: no $-pattern pitfalls
  .replace(PLACEHOLDER_DIM, () => JSON.stringify(dimissioni));

writeFileSync(join(root, "extension/content.js"), built);

// Bookmarklet: the same core as a javascript: URL, for locked-down PCs where
// neither Developer Mode nor a userscript manager is available. One click on
// each SA4PSO page injects the panel (handoff flags live in sessionStorage,
// so auto-confirm and printing keep working after a click on the new page).
mkdirSync(join(root, "bookmarklet"), { recursive: true });
const bookmarklet = "javascript:" + encodeURIComponent("void " + built);
writeFileSync(join(root, "bookmarklet/ps-assist.bookmarklet.txt"), bookmarklet);

console.log(`built v${version}: extension/content.js (${built.length} bytes), bookmarklet (${Math.round(bookmarklet.length / 1024)} KB)`);
