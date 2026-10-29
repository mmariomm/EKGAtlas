#!/usr/bin/env node
/*
 * Build PS Assist: injects the verified catalog into src/core.js and emits
 *   extension/content.js               (MV3 content script)
 *   bookmarklet/…bookmarklet.txt       (same core as a javascript: URL)
 *   extension/ponte-cripto.js          (copy of ../public/ponte/cripto.js)
 *   extension/ponte-host.js            (the bridge's address, from ponte/host.txt)
 * The userscript vehicle was retired in 3.2: extension (primary) plus
 * bookmarklet (locked-down PCs) cover every machine with one build less
 * to test, document and support.
 * Run:  node tools/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { origineDelPonte } from "../ponte/host.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = readFileSync(join(root, "src/core.js"), "utf8");
const catalog = JSON.parse(readFileSync(join(root, "src/catalog.json"), "utf8"));
const dimissioni = JSON.parse(readFileSync(join(root, "src/dimissioni.json"), "utf8"));
const eo = JSON.parse(readFileSync(join(root, "src/eo.json"), "utf8"));

const PLACEHOLDER = "/*__CATALOG__*/ {}";
const PLACEHOLDER_DIM = "/*__DIMISSIONI__*/ {}";
const PLACEHOLDER_EO = "/*__EO__*/ {}";
for (const [ph, cosa] of [[PLACEHOLDER, "catalog"], [PLACEHOLDER_DIM, "dimissioni"], [PLACEHOLDER_EO, "eo"]]) {
  if (!core.includes(ph)) {
    console.error(`${cosa} placeholder not found in src/core.js`);
    process.exit(1);
  }
}
const version = /const VERSION = "([^"]+)"/.exec(core)?.[1] ?? "0.0.0";
const built = core
  .replace(PLACEHOLDER, () => JSON.stringify(catalog))       // fn form: no $-pattern pitfalls
  .replace(PLACEHOLDER_DIM, () => JSON.stringify(dimissioni))
  .replace(PLACEHOLDER_EO, () => JSON.stringify(eo));

writeFileSync(join(root, "extension/content.js"), built);

// Il ponte verso l'iPhone: la cifratura è UNA, servita al telefono dal sito
// (public/ponte/cripto.js) e copiata qui tale e quale per il service worker.
copyFileSync(join(root, "../public/ponte/cripto.js"), join(root, "extension/ponte-cripto.js"));
// …e il suo indirizzo, fissato qui una volta per tutte: nessuna pagina lo può
// cambiare. ponte/host.txt vuoto = ponte da configurare (lo dice la pagina iPhone).
let ponteHost;
try { ponteHost = origineDelPonte(readFileSync(join(root, "ponte/host.txt"), "utf8")); }
catch (e) { console.error(e.message); process.exit(1); }
writeFileSync(join(root, "extension/ponte-host.js"),
  `// Generato da tools/build.mjs da ponte/host.txt: non si modifica a mano.\nconst PONTE_HOST_FISSO = ${JSON.stringify(ponteHost)};\n`);

// Il registratore (⋯ → Registra): legge il testo dei PDF con la STESSA strada
// del pannello — pdf.js, e il lettore di casa se pdf.js non ne cava niente —
// presa da core.js così com'è; e conosce il vocabolario delle pagine di
// esempio già pubblicate e del catalogo, per tenere le parole del programma.
{
  const prendi = (name) => {
    const i = core.indexOf(`function ${name}(`);
    if (i < 0) { console.error("registra-pdf: non trovata in core.js: " + name); process.exit(1); }
    let depth = 0, end = i;
    for (let k = core.indexOf("{", i); k < core.length; k++) {
      if (core[k] === "{") depth++;
      else if (core[k] === "}") { depth--; if (!depth) { end = k + 1; break; } }
    }
    const pre = core.slice(Math.max(0, i - 6), i) === "async " ? "async " : "";
    return pre + core.slice(i, end);
  };
  writeFileSync(join(root, "extension/registra-pdf.js"), [
    "// Generato da tools/build.mjs da src/core.js: non si modifica a mano.",
    "// Il testo di un PDF per il registratore, come lo legge il pannello.",
    "(function () {",
    "  const hasExt = () => false; const ask = async () => ({ ok: false }); let pdfjsInArrivo = null;",
    ...["estraiTestoPdf", "pdfjsPronto", "righeDaPezzi", "righeDritte", "testoPdfjs", "testoPdf"].map(prendi),
    "  globalThis.RegistraPdf = { testoPdf };",
    "})();",
    "",
  ].join("\n"));

  const dir = join(root, "esempi-gestionale");
  const FINTI = /^(ROSSI MARIO|BIANCHI ANNA|COLOMBO LUIGI|RICCI GIULIA|UTENTE\d*|OSPEDALE ESEMPIO|software di esempio|SMPRSS80A01F205X|(DOTTORE ESEMPIO|MEDICO DI TURNO|SPECIALISTA ESEMPIO)( \d+)?|\w+ di esempio|paziente|esempio|reparto|controllo|valore|esame|scheda|nota|dato|campo|voce|prova)$/;
  const PAROLE_FINTE = new Set(["ROSSI", "MARIO", "BIANCHI", "ANNA", "COLOMBO", "LUIGI", "RICCI", "GIULIA", "DOTTORE", "SPECIALISTA"]);
  const dec = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const testi = new Set();
  const tieni = (s) => {
    const t = dec(s).replace(/\s+/g, " ").trim();
    if (!t || t.length > 120 || FINTI.test(t)) return;
    if (/^[\d\s.,:/%+-]*$/.test(t) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t) || /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/.test(t)) return;
    if (/^(Paziente vigile|Riferito benessere|Dato di esempio|Rilievo clinico|Testo dimostrativo|Nessuna terapia in corso)/.test(t)) return;
    testi.add(t);
  };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    const html = readFileSync(join(dir, f), "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
    for (const m of html.matchAll(/>([^<]+)</g)) tieni(m[1]);
    for (const m of html.matchAll(/\b(?:value|title|alt|placeholder)="([^"]*)"/g)) tieni(m[1]);
  }
  const codici = new Set();
  for (const [res, r] of Object.entries(catalog)) {
    codici.add(res); tieni(r.label || "");
    for (const [code, label] of Object.entries(r.items || {})) { codici.add(code); tieni(label); tieni(label.replace(/\s*\([^)]*\)\s*$/, "")); }
  }
  const parole = new Set();
  for (const t of testi) for (const w of t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z0-9']+/)) if (w.length >= 2 && !PAROLE_FINTE.has(w)) parole.add(w);
  const icone = Object.keys(JSON.parse(readFileSync(join(dir, "_icone.json"), "utf8")));
  writeFileSync(join(root, "extension/registra-vocabolario.json"), JSON.stringify({
    nota: "Generato da tools/build.mjs: le parole delle pagine di esempio (esempi-gestionale/) e del catalogo. Il registratore le tiene.",
    testi: [...testi].sort(), parole: [...parole].sort(), codici: [...codici].sort(), icone: icone.sort(),
  }) + "\n");
}

// Bookmarklet: the same core as a javascript: URL, for locked-down PCs where
// neither Developer Mode nor a userscript manager is available. One click on
// each SA4PSO page injects the panel (handoff flags live in sessionStorage,
// so auto-confirm and printing keep working after a click on the new page).
mkdirSync(join(root, "bookmarklet"), { recursive: true });
const bookmarklet = "javascript:" + encodeURIComponent("void " + built);
writeFileSync(join(root, "bookmarklet/ps-assist.bookmarklet.txt"), bookmarklet);

console.log(`built v${version}: extension/content.js (${built.length} bytes), bookmarklet (${Math.round(bookmarklet.length / 1024)} KB), ponte: ${ponteHost || "da configurare"}`);
