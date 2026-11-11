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

  // La pill del registratore fuori dal gestionale (SISS, portale, pagine senza
  // il pannello): la STESSA pill del pannello ridotto — le stesse regole CSS,
  // prese da COLORS in core.js così come sono, non ricopiate a mano.
  {
    const a = core.indexOf("const COLORS = `"), b = core.indexOf("\n  `;", a);
    const css = core.slice(a, b);
    const regola = (sel) => {
      const i = css.indexOf(`\n    ${sel} {`);
      if (i < 0) { console.error("registra-pill: regola non trovata in COLORS: " + sel); process.exit(1); }
      let depth = 0, end = i;
      for (let k = css.indexOf("{", i); k < css.length; k++) {
        if (css[k] === "{") depth++;
        else if (css[k] === "}") { depth--; if (!depth) { end = k + 1; break; } }
      }
      return css.slice(i + 1, end).replace(/\s*\n\s*/g, " ").trim();
    };
    const SEL = [":host", "[hidden]", "*", ".wrap", ".pill", ".pill:active", ".pill:hover", ".pill .dot", ".recchip",
      ".menu", ".menu button", ".menu button:hover, .menu button:focus-visible", "@keyframes psaPulse"];
    writeFileSync(join(root, "extension/registra-pill.js"), [
      "// Generato da tools/build.mjs da src/core.js: non si modifica a mano.",
      "// Le regole della pill del pannello (COLORS), per la pill «● Registrando…» del registratore.",
      `globalThis.__psaPillCss = ${JSON.stringify(SEL.map(regola).join("\n"))};`,
      "",
    ].join("\n"));
  }

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
  // e i nomi corti degli esami che il pannello mostra (DISPLAY in core.js: «TROPONINA US», «EGA
  // VENOSA NEW»): stanno nel Registro di ogni zip, in maiuscolo in mezzo a una riga, e non sono persone
  {
    const a = core.indexOf("const DISPLAY = {"), b = core.indexOf("\n  };", a);
    if (a < 0 || b < 0) { console.error("registra-vocabolario: DISPLAY non trovato in core.js"); process.exit(1); }
    for (const m of core.slice(a, b).matchAll(/\]:\s*"([^"]+)"/g)) tieni(m[1]);
  }
  const parole = new Set();
  const metti = (t) => { for (const w of t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z0-9']+/)) if (w.length >= 2 && !PAROLE_FINTE.has(w)) parole.add(w); };
  for (const t of testi) metti(t);
  // Le parole che il programma conosce e che nel Registro stanno in maiuscolo in mezzo a una
  // riga («ERRORE GRAVE», «SCOMPENSO CARDIACO», «KETOROLAC TROMETAMINA»): non persone. Solo le
  // parole, non le frasi: i quesiti e i pacchetti, le aree, i consensi (core.js), i fogli di
  // dimissione e l'esame obiettivo (src/); e i reparti e le parole cliniche che lì non ci sono.
  {
    const stringhe = (o, out = []) => { if (typeof o === "string") out.push(o); else if (o && typeof o === "object") for (const x of Object.values(o)) stringhe(x, out); return out; };
    const blocco = (inizio, fine) => {
      const a = core.indexOf(inizio), b = a < 0 ? -1 : core.indexOf(fine, a);
      if (a < 0 || b < 0) { console.error("registra-vocabolario: non trovato in core.js: " + inizio); process.exit(1); }
      return core.slice(a, b);
    };
    const daCore = [
      ...blocco("const QUESITI_DEFAULT = [", "];").matchAll(/"([^"]+)"/g), ...blocco("const PACCHETTI = [", "\n  ];").matchAll(/\bq: "([^"]+)"/g),
      ...blocco("const AREE_TITOLO = {", "};").matchAll(/: "([^"]+)"/g), ...blocco("const CONSENSI = [", "\n  ];").matchAll(/\b(?:nome|esteso): "([^"]+)"/g),
    ].map((m) => m[1]);
    const REPARTI_E_CLINICA = "ERRORE GRAVE MEDICINA CHIRURGIA GENERALE CARDIOLOGIA COMPLETO GLICEMIA SCOMPENSO KETOROLAC PARACETAMOLO "
      + "ORTOPEDIA NEUROLOGIA PEDIATRIA GINECOLOGIA OSTETRICIA UROLOGIA GASTROENTEROLOGIA PNEUMOLOGIA NEFROLOGIA RIANIMAZIONE OCULISTICA "
      + "OTORINOLARINGOIATRIA PSICHIATRIA DERMATOLOGIA ONCOLOGIA EMATOLOGIA GERIATRIA NEUROCHIRURGIA CARDIOCHIRURGIA VASCOLARE INTENSIVA CORONARICA";
    for (const t of [...stringhe(dimissioni), ...stringhe(eo), ...daCore, REPARTI_E_CLINICA]) metti(t);
    // e i nomi degli analiti che il pannello conosce (SIGLE: «corpi chetonici», «anion gap», «peso
    // specifico»…, presi dalle sue regole così come sono) e le sezioni della tabella dei valori (SEZIONI):
    // nelle pagine dei risultati stanno in maiuscolo, e non sono persone
    const regole = blocco("const SIGLE = [", "\n  ];");
    for (const m of regole.matchAll(/\[\/((?:\\.|[^/\\\n])+)\/[a-z]*,\s*"/g)) {
      metti(m[1].replace(/\\[a-z]|\[[^\]]*\]|\(\?[!=<:]+/gi, " ").split(/[^A-Za-zÀ-ÿ0-9]+/).filter((w) => w.length >= 3).join(" "));   // (le sigle di due lettere no)
    }
    for (const m of blocco("const SEZIONI = [", "\n  ];").matchAll(/\["([^"]+)",/g)) metti(m[1]);
  }
  const icone = Object.keys(JSON.parse(readFileSync(join(dir, "_icone.json"), "utf8")));
  writeFileSync(join(root, "extension/registra-vocabolario.json"), JSON.stringify({
    nota: "Generato da tools/build.mjs: le parole delle pagine di esempio (esempi-gestionale/), del catalogo e del programma (src/: esami, quesiti, aree, consensi, fogli, esame obiettivo), più reparti e parole cliniche. Il registratore le tiene.",
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
