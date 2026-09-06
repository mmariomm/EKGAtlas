'use strict';

// build.js -- Node, zero dependencies.
// Parses data/*.xlsx with src/parser.js and bakes the result into index.html
// by inlining src/styles.css, src/parser.js, src/rules.js, src/app.js and the
// parsed data into the placeholders of src/shell.html. See SPEC.md / README.md
// for the full contract. Run as `node build.js` (or `npm run build`) from the
// project folder -- all paths below are resolved from `rootDir`, so it works
// from any current working directory.

const fs = require('fs');
const path = require('path');

// ============================================================
// Phase 0: small helpers
// ============================================================

function formatSize(bytes) {
  return bytes.toLocaleString('it-IT') + ' byte (' + (bytes / 1024).toFixed(1) + ' KB)';
}

// Embeds a JSON-serializable value into a `<script>` block safely: a literal
// "</script" inside a string value cannot terminate the block early, and
// U+2028/U+2029 (valid in JSON strings, illegal unescaped in old JS engines)
// are escaped too.
function jsonForScript(value) {
  const lineSep = String.fromCharCode(0x2028);
  const paraSep = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .replace(/<\/script/gi, '<\\/script')
    .split(lineSep).join('\\u2028')
    .split(paraSep).join('\\u2029');
}

function distinctNameCount(roster) {
  const names = new Set();
  for (const day of roster.days) {
    for (const slotKey of Object.keys(day.cells)) {
      for (const name of day.cells[slotKey].names) names.add(name);
    }
  }
  return names.size;
}

// ============================================================
// Phase 1: parse every data/*.xlsx into a deduplicated roster list
// ============================================================

async function loadRosters(rootDir, TurniParser) {
  const dataDir = path.join(rootDir, 'data');
  let xlsxNames;
  try {
    xlsxNames = fs.readdirSync(dataDir).filter(function (n) { return /\.xlsx$/i.test(n); }).sort();
  } catch (err) {
    console.error('Impossibile leggere la cartella data/: ' + err.message);
    process.exit(1);
  }
  if (xlsxNames.length === 0) {
    console.warn('Attenzione: nessun file .xlsx trovato in data/');
  }

  // Map preserves first-seen insertion order; re-setting an existing key
  // keeps that position but replaces its value -- so "later filename wins"
  // for a given hospital+month without reshuffling the output order.
  const byKey = new Map();
  for (const name of xlsxNames) {
    let roster;
    try {
      const bytes = fs.readFileSync(path.join(dataDir, name));
      roster = await TurniParser.parseWorkbook(new Uint8Array(bytes), name);
    } catch (err) {
      console.error('Errore nel parsing di ' + name + ': ' + (err && err.message ? err.message : err));
      process.exit(1);
      return;
    }
    const key = roster.hospital + '|' + roster.month;
    if (byKey.has(key)) {
      const prev = byKey.get(key);
      console.warn('Attenzione: ' + name + ' e ' + prev.file + ' coprono entrambi ' + key + ': vince ' + name);
    }
    byKey.set(key, { file: name, roster: roster });
  }
  return Array.from(byKey.values());
}

function printSummary(entries) {
  const rows = entries.map(function (e) {
    return {
      file: e.file,
      ospedale: e.roster.hospital,
      mese: e.roster.month,
      giorni: e.roster.days.length,
      nomi: distinctNameCount(e.roster),
      avvisi: e.roster.warnings.length
    };
  });
  console.table(rows);
}

// ============================================================
// Phase 2: assemble index.html from src/shell.html + inlined assets
// ============================================================

function readRequired(srcDir, filename) {
  return fs.readFileSync(path.join(srcDir, filename), 'utf8');
}

function assembleHtml(rootDir, rosters) {
  const srcDir = path.join(rootDir, 'src');
  const shellHtml = readRequired(srcDir, 'shell.html');
  const stylesPath = path.join(srcDir, 'styles.css');
  const stylesCss = fs.existsSync(stylesPath) ? fs.readFileSync(stylesPath, 'utf8') : '';
  const parserJs = readRequired(srcDir, 'parser.js');
  const rulesJs = readRequired(srcDir, 'rules.js');
  const appJs = readRequired(srcDir, 'app.js');

  const data = { generatedAt: new Date().toISOString(), rosters: rosters };
  const dataScript = 'window.TURNI_DATA = ' + jsonForScript(data) + ';';

  const replacements = [
    ['<!--STYLES-->', '<style>\n' + stylesCss + '\n</style>'],
    ['<!--PARSER-->', '<script>\n' + parserJs + '\n</script>'],
    ['<!--RULES-->', '<script>\n' + rulesJs + '\n</script>'],
    ['<!--DATA-->', '<script>\n' + dataScript + '\n</script>'],
    ['<!--APP-->', '<script>\n' + appJs + '\n</script>']
  ];

  let html = shellHtml;
  for (const [placeholder, replacement] of replacements) {
    if (html.indexOf(placeholder) === -1) {
      throw new Error('src/shell.html: placeholder ' + placeholder + ' non trovato');
    }
    html = html.replace(placeholder, replacement);
  }
  return html;
}

// ============================================================
// Phase 3: bake the page into worker-page.js for the Cloudflare Worker
// ============================================================

// The Worker serves the page out of its own bundle, so there is no route that
// could hand it out without a password. `jsonForScript` is reused on purpose:
// for a string it produces a double-quoted JavaScript string literal, so
// backticks and "${" are ordinary characters, while quotes, backslashes,
// newlines, "</script" and U+2028/U+2029 all come out escaped.
function writeWorkerPage(rootDir, html) {
  const outPath = path.join(rootDir, 'worker-page.js');
  const module_ =
    '// Generato da build.js: non modificarlo a mano (è in .gitignore).\n' +
    '// Contiene index.html come stringa, per il bundle del Worker.\n' +
    "'use strict';\n" +
    'module.exports = { PAGE: ' + jsonForScript(html) + ' };\n';
  fs.writeFileSync(outPath, module_, 'utf8');
  return { path: outPath, bytes: Buffer.byteLength(module_, 'utf8') };
}

// ============================================================
// Entry point
// ============================================================

async function build(rootDir) {
  const srcDir = path.join(rootDir, 'src');

  // Fail early with a clear message when a source file is missing.
  const required = ['shell.html', 'rules.js', 'app.js'];
  const missing = required.filter(function (f) { return !fs.existsSync(path.join(srcDir, f)); });
  if (missing.length > 0) {
    console.error('File mancanti, impossibile completare la build: ' +
      missing.map(function (f) { return 'src/' + f; }).join(', '));
    process.exit(1);
    return;
  }

  const TurniParser = require(path.join(srcDir, 'parser.js'));
  const entries = await loadRosters(rootDir, TurniParser);
  printSummary(entries);

  const rosters = entries.map(function (e) { return e.roster; });
  const html = assembleHtml(rootDir, rosters);

  const outPath = path.join(rootDir, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('Scritto ' + outPath + ' (' + formatSize(Buffer.byteLength(html, 'utf8')) + ')');

  const workerPage = writeWorkerPage(rootDir, html);
  console.log('Scritto ' + workerPage.path + ' (' + formatSize(workerPage.bytes) + ')');
}

module.exports = { build: build };

if (require.main === module) {
  build(__dirname).catch(function (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
