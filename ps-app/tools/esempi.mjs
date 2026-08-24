#!/usr/bin/env node
/*
 * Turn the REAL saved SA4PSO pages into esempi-gestionale/: same markup, same
 * stylesheet, same icons — zero real content.
 *
 * The originals are complete medical records (name, codice fiscale, anamnesi,
 * therapy, vitals, staff names). They are NEVER committed and never published.
 * This tool keeps the SHAPE and throws the CONTENT away:
 *
 *   default-deny — every text node and every attribute value is replaced by a
 *   shape-preserving synthetic value UNLESS it is part of the application's own
 *   vocabulary, which is computed, not guessed: a string is vocabulary only if
 *   it appears in pages belonging to at least TWO different patients. A denylist
 *   removes what is shared but still identifies (staff names and usernames,
 *   hospital and vendor branding).
 *
 * Run (originals are not in the repo — point it at your local copy):
 *   node tools/esempi.mjs [cartella-originali]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] || "/tmp/claude-0/-home-user-EKGAtlas/489213ea-3621-581d-ba5b-643886b3ad63/scratchpad";
const OUT = join(root, "esempi-gestionale");

// ---------------------------------------------------------------- sources
// pat = the real patient a page belongs to; only strings shared by two
// different pat values can be application vocabulary.
const PAGES = [
  { out: "paziente-1", pat: "A", file: "ps_app_old/PS App/saved source pages/ALBERTIN ASSUNTA.html",
    tipo: "paziente", nota: "scheda paziente completa (anamnesi, diario, parametri)" },
  { out: "crea-laboratorio", pat: "A", file: "ps_app_old/PS App/saved source pages/lab1.html",
    tipo: "crea", nota: "nuova richiesta di laboratorio" },
  { out: "crea-radiologia", pat: "A", file: "ps_app_old/PS App/saved source pages/radio1.html",
    tipo: "crea", nota: "nuova richiesta di radiologia" },
  { out: "esami-centrale", pat: "A", file: "ps_app_old/PS App/saved source pages/Tutto fantoli.html",
    tipo: "esami", nota: "carrello + catalogo LABORATORIO ANALISI (146 voci)" },
  { out: "esami-urgenze", pat: "A", file: "ps_app_old/PS App/saved source pages/emerg fant.html",
    tipo: "esami", nota: "catalogo LABORATORIO URGENZE" },
  { out: "esami-poc", pat: "C", file: "ps_app_old/PS App/saved source pages/KALEMCI ALI.html",
    tipo: "esami", nota: "catalogo LABORATORIO POC" },
  { out: "crea-laboratorio-2", pat: "C", file: "ps_app_old/PS App/saved source pages/KALEMCI ALI2.html",
    tipo: "crea", nota: "nuova richiesta, seconda variante" },
  { out: "paziente-2", pat: "B", file: "templab/templab1/templab1.html",
    tipo: "paziente", nota: "scheda paziente con risultati di laboratorio in corso" },
  { out: "risultati-1", pat: "B", file: "templab/templab1/RcsAccessiRisultatiElenco.htm",
    tipo: "risultati", nota: "valori di un prelievo (finestra Risultati)" },
  { out: "risultati-2", pat: "B", file: "templab/templab1/RcsAccessiRisultatiElenco2.htm",
    tipo: "risultati", nota: "valori di un secondo prelievo" },
  { out: "esami-rx", pat: "D", file: "rx/rx.html",
    tipo: "esami", nota: "catalogo RADIOLOGIA - RX" },
];

const read = (f) => readFileSync(join(SRC, f));
const decode = (buf) => new TextDecoder("windows-1252").decode(buf);

// ------------------------------------------------------------- denylist
// shared, therefore "vocabulary" by the rule above, but still identifying
const DENY = [
  /multimedica/i, /irccs/i, /finmatica/i, /dedalus/i, /smarthealth/i, /\bAFC\s?2003/i,
  /\bDEA\s+I\s+LIVELLO/i, /tutti i diritti riservati/i, /java\.net\.InetAddress/i,
  /\bMEGLIO\b/i, /\bMMEGLIO\b/i, /\bMEGMA\b/i, /\bMADAN\b/i, /\bBUICO\b/i, /\bFALNO\b/i, /\bSAPSA\b/i,
  /Sei connesso come/i, /\bPS Assist\b/i,
  /^[A-Z]{5,6}$/,                        // operator usernames: five/six caps, nothing else
  /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/, // codice fiscale
];
// A NAME-SHAPED string is denied even when it looks like vocabulary: the same
// nurse signs two patients' pages, which would otherwise make her name "shared"
// and therefore kept. Application phrases in capitals always carry one of these
// words (or a digit, a hyphen or a bracket, which the shape already excludes).
const PAROLE_APP = /\b(PRONTO|SOCCORSO|LABORATORIO|ANALISI|RADIOLOGIA|TRIAGE|SCHEDA|SCHEDE|CODICE|ESAME|ESAMI|VISITA|REPARTO|AREA|URGENZE|POC|SSG|RX|TAC|ECOGRAFIA|RISONANZA|MAGNETICA|NUCLEARE|OSPEDALE|ESEMPIO|ALLERGIE|ANAMNESI|IMMAGINE|SELEZIONA|MEDICO|UTENTE)\b/;
const nameShaped = (s) => /^[A-ZÀ-Ù'’]+(?:\s+[A-ZÀ-Ù'’]+){1,3}$/.test(s.trim()) && !PAROLE_APP.test(s);
const denied = (s) => nameShaped(s) || DENY.some((re) => re.test(s));

// --------------------------------------------------------- replacements
// deterministic: same input → same output, so rebuilds produce no diff noise
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
const pick = (arr, s) => arr[hash(s) % arr.length];

// one invented identity per real patient, so a page reads as one person
const NOMI = { A: "ROSSI MARIO", B: "BIANCHI ANNA", C: "COLOMBO LUIGI", D: "RICCI GIULIA" };
const MEDICI = ["DOTTORE ESEMPIO", "MEDICO DI TURNO", "SPECIALISTA ESEMPIO"];
const PAROLE = ["paziente", "esempio", "reparto", "controllo", "valore", "esame", "scheda", "nota", "dato", "campo", "voce", "prova"];
const FRASI = [
  "Paziente vigile e collaborante, parametri nella norma.",
  "Riferito benessere, nessun sintomo in atto al momento della visita.",
  "Dato di esempio: il contenuto reale è stato rimosso.",
  "Rilievo clinico di esempio, senza alcun valore diagnostico.",
  "Testo dimostrativo inserito al posto del contenuto originale.",
  "Nessuna terapia in corso segnalata in questa scheda di esempio.",
];
const CF_FINTO = "SMPRSS80A01F205X"; // "esempio rossi", not a valid person

function fakeDate(s) {                       // shift by a fixed amount, keep format
  return s.replace(/\b(\d{2})\/(\d{2})\/(\d{2,4})\b/g, (m, d, mo, y) => {
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const t = new Date(Date.UTC(year, Number(mo) - 1, Number(d)));
    if (isNaN(t)) return m;
    t.setUTCDate(t.getUTCDate() - 43);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${y.length === 2 ? p(t.getUTCFullYear() % 100) : t.getUTCFullYear()}`;
  });
}
function fakeNumber(s) {                     // jitter, keep digits and decimals
  return s.replace(/\d+([.,]\d+)?/g, (n) => {
    const dec = /[.,]/.test(n) ? n.replace(/^\d+[.,]/, "").length : 0;
    const base = Number(n.replace(",", ".")) || 0;
    const v = Math.max(0, base * (0.82 + (hash(n + s) % 18) / 100));   // 0.82–0.99: never inflates
    const out = dec ? v.toFixed(dec) : String(Math.round(v)).padStart(n.length, n.startsWith("0") ? "0" : "");
    return n.includes(",") ? out.replace(".", ",") : out;
  });
}
// what a denied string becomes: never a person's name, always a neutral label
function neutral(t) {
  if (/multimedica|irccs|finmatica|dedalus|smarthealth|DEA\s+I\s+LIVELLO/i.test(t)) return "OSPEDALE ESEMPIO";
  if (/Sei connesso come/i.test(t)) return "Salve! Sei connesso come Utente Medico: UTENTE1";
  if (/PS Assist/i.test(t)) return "";
  if (/tutti i diritti riservati|AFC\s?2003|java\.net/i.test(t)) return "software di esempio";
  return "UTENTE1";
}
function synth(s, nome = "ROSSI MARIO") {
  const t = s.trim();
  if (!t) return s;
  if (denied(t)) return s.replace(t, neutral(t));
  if (/^[\s|·•\-–—:/,.()\[\]]+$/.test(t)) return s;                        // punctuation only
  // Shape-preserving only for strings that are NOTHING BUT a value: a mixed
  // string ("APERTA - COGNOME NOME - 23/08/2026") is prose and is replaced
  // whole, or a partial edit would leave the name standing.
  if (/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(t)) return s.replace(t, CF_FINTO);
  if (/^\d{2}\/\d{2}\/\d{2,4}( \d{2}:\d{2}(:\d{2})?)?$/.test(t)) return fakeDate(s);
  if (/^[\d.,\s%]+$/.test(t)) return fakeNumber(s);
  if (/^[A-ZÀ-Ù'’\s]+$/.test(t) && t.split(/\s+/).length <= 4 && t.length > 3) {
    return s.replace(t, nome);                                              // NAME SURNAME shapes
  }
  if (t.length >= 24) return s.replace(t, pick(FRASI, t));                   // prose
  const w = pick(PAROLE, t);
  return s.replace(t, t.length > 12 ? `${w} di esempio` : w);
}

// ------------------------------------------------------- vocabulary pass
const texts = new Map();   // string -> Set(patient)
const attrs = new Map();
const collect = (map, s, pat) => { const k = s.trim(); if (!k) return; if (!map.has(k)) map.set(k, new Set()); map.get(k).add(pat); };

const stripNoise = (html) => html
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<script\b[\s\S]*?<\/script>/gi, "")
  .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
  .replace(/<div id="psassist-host"[\s\S]*?<\/div>/gi, "");   // our own panel, if it was on screen

for (const p of PAGES) {
  const html = stripNoise(decode(read(p.file)));
  for (const m of html.matchAll(/>([^<]+)</g)) collect(texts, m[1].replace(/&nbsp;/g, " "), p.pat);
  for (const m of html.matchAll(/\b(?:value|title|alt|placeholder)="([^"]*)"/g)) collect(attrs, m[1], p.pat);
}
const vocab = (map, s) => { const k = s.trim(); const hit = map.get(k); return !!hit && hit.size >= 2 && !denied(k); };

// The application's own labels. Curated by hand from every title/alt in the
// originals, because that same attribute also carries staff names, clinical
// notes and drug names — so nothing gets in here by heuristic.
const ETICHETTE_APP = new Set([
  "Accesso in Ambulatorio", "Accettazione Assistito", "Aggiorna", "Apri Annotazioni", "Apri Diario Clinico",
  "Apri Dimissione", "Apri Prestazioni", "Apri Stampe", "Apri Terapia", "Apri Terapie", "Attributi",
  "Certificato Autorità Giudiziaria", "Certificato Inail", "CertificatoMalattia", "Codice", "Codice Rosa",
  "Consensi/Rifiuti", "Consulenze", "Da Somministrare", "Diario", "Dossier", "Elettrocardiogramma", "Elimina",
  "Erogata", "Filtro attivo", "Indici", "Intossicazione", "Laboratorio", "Misurazione Parametri Vitali",
  "Misurazioni", "Presa in Carico", "Prestazioni", "Prestazioni in PS", "REFERTO", "Radiologia",
  "Ricerca Documenti FSE", "Richieste Consulenza", "Richieste Laboratorio", "Richieste Radiologia",
  "Scarica Informazioni", "Scegli data pianificazione..", "Scheda Tampone Molecolare COVID19",
  "Scheda Tampone Rapido COVID19", "Schede Stroke", "Schede Violenza", "Stampa Bracciale", "Stampa Etichette",
  "Stampa Prenotazione Esterna", "Stampa Richiesta", "Stato Barella", "Storico Dati Clinici",
  "Storico Documenti", "Storico Malattie Infettive", "Terapia", "Terapie", "Terapie da Somministrare",
  "Trend", "Triage Ostetrico", "Valutazioni", "Verbale Ambulatoriale", "Visualizza Risultati",
  "ALLERGIE", "ANAMNESI", "ARANCIONE", "AZZURRO", "ESAME_OBIETTIVO", "FARMACI_ASSUNTI", "MALATTIE_PREGRESSE",
  "IMMAGINE", "Accettazione", "Dimissione", "Ambulatorio",
  // labels of the results window: they are what tells a value row from the
  // patient header, both on screen and for the panel
  "Assistito", "Pronto Soccorso", "Quesito", "Risultati Laboratorio", "Chiudi lista",
  "Esame", "Valore", "Range", "Stato", "Data", "Unità di Misura",
]);

// exam rows are catalogue text, not patient data: "0-320 EMOCROMO… (POCT1502)"
const isExam = (s) => /^\d+-\d+\s+\S/.test(s.trim());

// --------------------------------------------------- url parameters kept
// Everything the application (and the panel) needs to work; any other
// parameter is a value about a person and gets blanked.
const KEEP_PARAMS = new Set([
  "MVPG", "CCSFORM", "EPISODIO_ID", "RICHIESTA_ID", "RICHIESTA_PROG", "PRESTAZIONE", "S_PRESTAZIONE",
  "RISORSA_ID", "RISORSE", "STRUTTURA", "REPARTO", "PADIGLIONE", "BRANCA", "TOPAGE", "TOPG", "RETURNPAGE",
  "INSERT", "DELETE", "UPDATE", "CANCEL", "REFERTO_ID", "REFERTO_SISTEMA", "RCS_ACCESSO_ID", "MODALITA",
  "REPORT", "PROJECT", "CONN", "STAMPA_ID", "MIMETYPE", "TABLE", "BLOBFIELD", "WHERECONDITION", "DATASOURCE",
  "TIPO", "CLASSE_RICHIESTA", "URGENZA", "SORT", "ORDER", "PAGE", "FILTRO",
]);

// ------------------------------------------------------------- id remap
const N = (d) => new RegExp(`(?<![0-9])${d}(?![0-9])`, "g");   // \b would miss PSO_120595
const IDS = [
  [N("120595"), "700001"], [N("113925"), "700002"], [N("130300"), "700003"], [N("130409"), "700003"],
  [N("889101"), "800101"], [N("858241"), "800102"], [N("858242"), "800103"], [N("934656"), "800104"],
  [/\b2026\/7492\b/g, "2026/1001"], [/PS-\d{4}\/\d{3,6}/g, "PS-2026/1002"],
  [/\b20260010040701\b/g, "20260010000001"], [/\b20260010035301\b/g, "20260010000002"],
  [/\*[A-Z0-9]{5,24}/g, "*ESEMPIO01"],             // ASSISTITO_ID, also as a window name

  [/\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "127.0.0.1"],   // internal addresses
];

// Real operational numbers (richieste, episodes, documents) that the table
// above does not name: each distinct value gets its own invented one, the same
// in every page, so links keep pointing where they pointed.
const mappa = new Map();
const nuovoId = (tipo, reale) => {
  const k = tipo + ":" + reale;
  if (!mappa.has(k)) {
    const n = [...mappa.keys()].filter((x) => x.startsWith(tipo + ":")).length + 1;
    mappa.set(k, tipo === "uuid"
      ? `aaaa${String(n).padStart(4, "0")}-0000-0000-0000-000000000001`
      : String({ RICHIESTA_ID: 880000, EPISODIO_ID: 700100, RCS_ACCESSO_ID: 20260010000100 }[tipo] + n));
  }
  return mappa.get(k);
};
// values the table above already invented must not be invented twice
const GIA_FINTI = new Set(["700001", "700002", "700003", "800101", "800102", "800103", "800104",
  "20260010000001", "20260010000002"]);
const RIMAPPA = [
  [/\bRICHIESTA_ID=(\d{4,})/g, "RICHIESTA_ID"],
  [/\bEPISODIO_ID=(\d{4,})/g, "EPISODIO_ID"],
  [/\bRCS_ACCESSO_ID=(\d{6,})/g, "RCS_ACCESSO_ID"],
];

// ------------------------------------------------------------- assets
const assetDirs = [];
(function findAssets(dir, depth = 0) {
  if (depth > 4 || !existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const full = join(dir, e.name);
    if (e.name.endsWith("_files")) assetDirs.push(full);
    else findAssets(full, depth + 1);
  }
})(SRC);
const assetFile = (name) => {
  for (const d of assetDirs) { const f = join(d, name); if (existsSync(f)) return f; }
  return null;
};
const MIME = { gif: "image/gif", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", ico: "image/x-icon" };
const LOGOS = /HMIMU_logo|Logo-GF|dds_logo|logo_/i;   // branding never travels

// ---------------------------------------------------------------- build
mkdirSync(OUT, { recursive: true });
const icons = {};
let kept = 0, replaced = 0;

for (const p of PAGES) {
  let html = stripNoise(decode(read(p.file)));
  const nome = NOMI[p.pat] || "ROSSI MARIO";

  // Structural keep-set: column headers everywhere, and — in the results
  // pages — the analyte, unit, range and status columns. Those are laboratory
  // vocabulary, not facts about a person; only the value and the date move.
  const keep = new Set();
  for (const m of html.matchAll(/class="AFCColumnTD"[^>]*>([^<]{1,60})</g)) keep.add(m[1].replace(/&nbsp;/g, " ").trim());
  if (p.tipo === "risultati") {
    for (const row of html.matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
      const cells = [...row[0].matchAll(/class="AFCDataTD"[^>]*>([^<]*)</g)].map((c) => c[1].replace(/&nbsp;/g, " ").trim());
      if (cells.length < 5) continue;
      for (const i of [0, 2, 3, 4]) if (cells[i]) keep.add(cells[i]);
    }
  }

  // 1. every address becomes same-origin and relative: nothing can point out
  html = html.replace(/https?:\/\/smarthealth\.multimedica\.it/gi, "")
             .replace(/https?:\/\/10\.11\.0\.151:9080/gi, "")
             .replace(/https?:\/\/[a-z0-9.\-]+\.multimedica\.it/gi, "");

  // 2. ids: the named ones, then everything else that is still a real number
  for (const [re, to] of IDS) html = html.replace(re, to);
  for (const [re, tipo] of RIMAPPA) html = html.replace(re, (m, val) => (GIA_FINTI.has(val) ? m : tipo + "=" + nuovoId(tipo, val)));
  html = html.replace(/\bREFERTO_ID=([0-9a-f-]{6,})/gi, (m, val) => "REFERTO_ID=" + nuovoId("uuid", val));
  html = html.replace(/(<input[^>]*name="RICHIESTA_ID"[^>]*)value="(\d{4,})"/gi, (m, a1, val) => a1 + `value="${nuovoId("RICHIESTA_ID", val)}"`)
             .replace(/value="(\d{4,})"([^>]*name="RICHIESTA_ID")/gi, (m, val, b1) => `value="${nuovoId("RICHIESTA_ID", val)}"` + b1);

  // 3. text nodes — default deny
  html = html.replace(/>([^<]+)</g, (m, txt) => {
    const t = txt.replace(/&nbsp;/g, " ");
    if (!t.trim()) return m;
    if (isExam(t) || ETICHETTE_APP.has(t.trim()) || keep.has(t.trim()) || vocab(texts, t)) { kept++; return m; }
    replaced++;
    return ">" + synth(txt, nome) + "<";
  });

  // 4. attribute values — same rule
  html = html.replace(/\b(value|title|alt|placeholder)="([^"]*)"/g, (m, k, v) => {
    if (!v.trim() || isExam(v) || ETICHETTE_APP.has(v.trim()) || keep.has(v.trim()) || vocab(attrs, v)) { kept++; return m; }
    replaced++;
    return `${k}="${synth(v, nome).replace(/"/g, "'")}"`;
  });

  // 4b. every address in the page: keep the machinery parameters, blank the
  //     rest (a CODICE_FISCALE= rides in a link, not in a text node), and drop
  //     links that pointed at another site entirely.
  html = html.replace(/\b(href|action|src|onclick)="([^"]*)"/gi, (m, k, v) => {
    if (/^(#|javascript:void|icona:)/i.test(v)) return m;
    // NB: separators arrive html-escaped (&amp;), so match those too
    let out = v.replace(/(\?|&amp;|&)([A-Za-z_0-9]+)=([^&"'\s)]*)/g, (mm, sep, key, val) => {
      if (KEEP_PARAMS.has(key.toUpperCase())) return mm;
      return `${sep}${key}=${val ? "ESEMPIO" : ""}`;
    });
    if (/^https?:\/\//i.test(out)) out = "#";                    // e.g. the vendor's own site
    return `${k}="${out}"`;
  });

  // 4c. fields that hold a person by definition, whatever their value looks like
  html = html.replace(/<input\b[^>]*>/gi, (tag) => {
    if (!/name="(NOMINATIVO|MEDICO|UTENTE|OPERATORE|FIRMA|RICHIEDENTE)"/i.test(tag)) return tag;
    return tag.replace(/value="[^"]*"/i, `value="${MEDICI[0]} 1"`);
  });

  // 5. the doctor picker is a staff list: replace it wholesale
  html = html.replace(/<select[^>]*name="MEDICO"[\s\S]*?<\/select>/gi, (sel) => {
    let i = 0;
    return sel.replace(/<option([^>]*)>([^<]*)<\/option>/gi, (o, at, txt) => {
      i++;
      if (/Seleziona/i.test(txt)) return o;
      const at2 = at.replace(/value="[^"]*"/i, `value="${100 + i}"`);
      return `<option${at2}>${MEDICI[i % MEDICI.length]} ${i}</option>`;
    });
  });

  // 6. assets: stylesheets are shared, icons are inlined by the simulator,
  //    logos are dropped
  html = html.replace(/<link[^>]+rel="?stylesheet"?[^>]*>/gi, "");
  html = html.replace(/<img([^>]*)\ssrc="\.?\/?[^"]*?([^"/]+\.(?:gif|png|jpe?g|svg))"([^>]*)>/gi, (m, a, name, b) => {
    if (LOGOS.test(name)) return "";
    const f = assetFile(decodeURIComponent(name));
    if (f) {
      const ext = name.split(".").pop().toLowerCase();
      icons[name] = `data:${MIME[ext] || "application/octet-stream"};base64,` + readFileSync(f).toString("base64");
    }
    return `<img${a} src="icona:${name}"${b}>`;
  });
  html = html.replace(/<img[^>]*\ssrc="(?!icona:)[^"]*"[^>]*>/gi, "");   // anything still pointing elsewhere
  html = html.replace(/\sbackground="[^"]*"/gi, "");                     // legacy <table background=…>: an image request

  // 7. one honest header, no hospital and no vendor
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>ESEMPIO GESTIONALE — ${p.out}</title>`);
  html = `<!-- Pagina di ESEMPIO generata da tools/esempi.mjs: struttura reale, contenuti inventati. -->\n`
       + `<meta charset="utf-8">\n` + html;

  writeFileSync(join(OUT, p.out + ".html"), html, "utf8");
}

// stylesheet: the app's own, with its url() images inlined
const CSS_FILES = ["pso.css", "Style.css", "Style(1).css", "buttons.css"];
let css = "";
for (const name of CSS_FILES) {
  const f = assetFile(name);
  if (!f) continue;
  css += `\n/* ${name} */\n` + readFileSync(f, "latin1");
}
css = css.replace(/\/\*[\s\S]*?\*\//g, "");   // comments carry stray addresses
css = css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (m, u) => {
  const name = u.split(/[/\\]/).pop();
  if (LOGOS.test(name)) return "none";
  const f = assetFile(decodeURIComponent(name));
  if (!f) return "none";
  const ext = name.split(".").pop().toLowerCase();
  return `url("data:${MIME[ext] || "image/png"};base64,${readFileSync(f).toString("base64")}")`;
});
writeFileSync(join(OUT, "_stile.css"), css, "utf8");
writeFileSync(join(OUT, "_icone.json"), JSON.stringify(icons, null, 0), "utf8");
writeFileSync(join(OUT, "_pagine.json"), JSON.stringify(PAGES.map(({ out, tipo, nota }) => ({ out, tipo, nota })), null, 2), "utf8");

console.log(`esempi-gestionale: ${PAGES.length} pagine, ${Object.keys(icons).length} icone, css ${Math.round(css.length / 1024)} KB`);
console.log(`testo: ${kept} stringhe tenute (vocabolario dell'app), ${replaced} sostituite`);
