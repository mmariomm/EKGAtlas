#!/usr/bin/env node
/*
 * Build the banco di prova: dist/demo.html, one self-contained page.
 *
 * It embeds, verbatim and base64-encoded so nothing has to be escaped:
 *   - extension/content.js   the REAL built panel (catalog included)
 *   - test/sa4pso-mock.mjs   the REAL simulator the e2e suite runs against
 * plus demo/shell.css + demo/shell.js, which are only the missing browser.
 * Nothing is reimplemented, so the demo cannot drift from what ships.
 *
 * Run:  node tools/demo.mjs      (npm run demo)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// The panel in the banco IS the shipped panel: this is the same file the
// extension loads, taken as it is at build time. Nothing here reimplements it,
// so `npm run demo` (and every `npm run dist`) refreshes the banco to the
// latest build automatically.
const core = read("extension/content.js");
const version = /const VERSION = "([^"]+)"/.exec(core)?.[1] ?? "0.0.0";
const built = new Date().toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Node-isms the simulator uses, in ~15 lines of browser equivalent.
const BUFFER_SHIM = `
class Buf extends Uint8Array {
  toString(enc) {
    let s = "";
    for (let i = 0; i < this.length; i++) s += String.fromCharCode(this[i]);
    return (enc === "latin1" || enc === "binary") ? s : new TextDecoder().decode(this);
  }
}
const Buffer = {
  from(x) {
    if (typeof x === "string") { const b = new Buf(x.length); for (let i = 0; i < x.length; i++) b[i] = x.charCodeAt(i) & 0xff; return b; }
    return Buf.from(x);
  },
  alloc(n) { return new Buf(n); },
};
`;
const mock = BUFFER_SHIM + read("test/sa4pso-mock.mjs").replace(/^export /gm, "");

// The page itself, without a document shell: hosts that wrap the file in
// their own <html>/<head>/<body> get exactly this.
const body = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Banco di prova PS Assist</title>
<style>${read("demo/shell.css")}</style>
<div id="sa4">
  <div id="sa4-head"></div>
  <div class="sa4-sheet"><div id="sa4-page"></div></div>
</div>
<noscript><p style="padding:20px">Serve JavaScript: la pagina è un simulatore, non un sito.</p></noscript>
<script>window.__PSA_BUILD__ = ${JSON.stringify({ version, built })};</script>
<script type="text/plain" id="psa-mock">${b64(mock)}</script>
<script type="text/plain" id="psa-core">${b64(core)}</script>
<script>${read("demo/shell.js")}</script>
`;

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/demo.artifact.html"), body);
const html = `<!doctype html>\n<html lang="it">\n<head>\n${body}\n</html>\n`;
writeFileSync(join(root, "dist/demo.html"), html);
console.log(`banco di prova: dist/demo.html + dist/demo.artifact.html (${Math.round(html.length / 1024)} KB) con il pannello v${version}`);
