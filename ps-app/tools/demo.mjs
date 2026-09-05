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
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paginaStorico } from "../test/fixtures/storico.mjs";

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

// The saved gestionale, scoped so its 2003 stylesheet cannot reach the
// harness around it: every rule is prefixed with #sa4-page.
const scope = (css, sel) => css.replace(/(^|\})([^{}@]+)\{/g, (m, close, selectors) => {
  const list = selectors.split(",").map((x) => {
    const t = x.trim();
    if (!t) return t;
    return /^(html|body)$/i.test(t) ? sel : `${sel} ${t}`;
  }).filter(Boolean).join(", ");
  return `${close}${list}{`;
});

const esempiDir = join(root, "esempi-gestionale");
const pagine = {};
for (const f of readdirSync(esempiDir)) {
  if (!f.endsWith(".html")) continue;
  pagine[f.replace(/\.html$/, "")] = readFileSync(join(esempiDir, f), "utf8");
}
// The portal's multi-day table is NOT a saved page: it is rebuilt from its
// shape (test/fixtures/storico.mjs), with the banco's own patient on it, so
// the banco can show the reader at work without a real one ever existing here.
pagine.storico = paginaStorico({ paziente: { idMPI: "900000001", cognome: "ROSSI", nome: "MARIO" } });
const ESEMPI = {
  pagine,
  icone: JSON.parse(readFileSync(join(esempiDir, "_icone.json"), "utf8")),
  css: scope(readFileSync(join(esempiDir, "_stile.css"), "utf8"), "#sa4-page"),
};

// The page itself, without a document shell: hosts that wrap the file in
// their own <html>/<head>/<body> get exactly this.
const body = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Banco di prova PS Assist</title>
<style>${read("demo/shell.css")}</style>
<div id="sa4-page"></div>
<noscript><p style="padding:20px">Serve JavaScript: la pagina è un simulatore, non un sito.</p></noscript>
<script>window.__PSA_BUILD__ = ${JSON.stringify({ version, built })};</script>
<script type="text/plain" id="psa-esempi">${b64(JSON.stringify(ESEMPI))}</script>
<script type="text/plain" id="psa-core">${b64(core)}</script>
<script>${read("demo/pdf.js")}</script>
<script>${read("demo/shell.js")}</script>
`;

mkdirSync(join(root, "dist"), { recursive: true });
// Offline file: the browser enforces the promise, not just the code. No host
// is reachable at all — only blob:/data:, which is where the simulated PDFs
// live — forms cannot submit anywhere, and frames can only show blobs.
// (Not added to the artifact build: that page already runs under the host's
// own strict CSP, and a second policy could fight it.)
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "frame-src blob:",
  "connect-src blob: data:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");
const html = `<!doctype html>
<html lang="it">
<head>
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<link rel="icon" href="data:,">
${body}
</html>
`;
writeFileSync(join(root, "dist/demo.html"), html);
console.log(`banco di prova: dist/demo.html (${Math.round(html.length / 1024)} KB)`);
console.log(`  pannello v${version} · ${Object.keys(pagine).length} pagine del gestionale · ${Object.keys(ESEMPI.icone).length} icone`);
