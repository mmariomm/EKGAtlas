'use strict';

// parser.js -- xlsx (zero dependencies) -> Roster
// Works both as a classic <script> in the browser (window.TurniParser) and
// as a CommonJS module in Node 22 (module.exports). See README.md / SPEC for
// the exact data model and parsing rules this file implements.

const TurniParser = (function () {

  // ============================================================
  // Phase 0: small generic helpers (strings, refs, dates)
  // ============================================================

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function collapseWs(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  function stripAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function basename(p) {
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1];
  }

  // "AB12" -> "AB"
  function colLetters(ref) {
    const m = /^[A-Za-z]+/.exec(ref);
    return m ? m[0].toUpperCase() : '';
  }

  // "AB12" -> 12
  function rowNum(ref) {
    const m = /\d+/.exec(ref);
    return m ? parseInt(m[0], 10) : NaN;
  }

  // "A" -> 1, "Z" -> 26, "AA" -> 27, "AB" -> 28
  function colIndex(letters) {
    const s = letters.toUpperCase();
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      n = n * 26 + (s.charCodeAt(i) - 64);
    }
    return n;
  }

  function toUint8Array(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    throw new Error('parseWorkbook: bytes must be a Uint8Array or ArrayBuffer');
  }

  function utf8Decode(u8) {
    return new TextDecoder('utf-8').decode(u8);
  }

  // ============================================================
  // Phase 1: XML entity / attribute helpers
  // ============================================================

  const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;

  function decodeEntities(s) {
    if (s.indexOf('&') === -1) return s;
    return s.replace(ENTITY_RE, function (whole, ent) {
      if (ent.charAt(0) === '#') {
        const isHex = ent.charAt(1) === 'x' || ent.charAt(1) === 'X';
        const code = isHex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return String.fromCodePoint(code);
      }
      switch (ent) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return '\'';
        default: return whole;
      }
    });
  }

  // Generic attribute-string ("a=\"1\" b='2'") -> {a:"1", b:"2"}. Order-independent.
  function parseAttrs(attrStr) {
    const attrs = {};
    if (!attrStr) return attrs;
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(attrStr))) {
      if (m[1] !== undefined) attrs[m[1]] = decodeEntities(m[2]);
      else attrs[m[3]] = decodeEntities(m[4]);
    }
    return attrs;
  }

  // First occurrence of <tag>content</tag> or <tag/> inside `content`.
  // Returns the inner text, or null if the tag is absent entirely.
  function firstTag(content, tag) {
    const re = new RegExp('<' + tag + '\\b[^>]*\\/>|<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>');
    const m = re.exec(content);
    if (!m) return null;
    return m[1] !== undefined ? m[1] : '';
  }

  // Concatenation of every <tag>...</tag> (or self-closing) occurrence inside `content`.
  function allTagText(content, tag) {
    const re = new RegExp('<' + tag + '\\b[^>]*\\/>|<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'g');
    let out = '';
    let m;
    while ((m = re.exec(content))) {
      out += m[1] !== undefined ? m[1] : '';
    }
    return out;
  }

  function extractIs(cellInner) {
    const m = /<is\b[^>]*\/>|<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cellInner);
    if (!m) return cellInner;
    return m[1] !== undefined ? m[1] : '';
  }

  // ============================================================
  // Phase 2: ZIP reading (no dependencies)
  // ============================================================

  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  const LOC_SIG = 0x04034b50;

  async function readZip(bytes) {
    const u8 = toUint8Array(bytes);
    if (u8.length < 22) throw new Error('File ZIP non valido: troppo piccolo');
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    // find End Of Central Directory scanning backwards (comment can be up to 65535 bytes)
    const maxBack = Math.min(u8.length, 22 + 65535);
    let eocd = -1;
    for (let i = u8.length - 22; i >= u8.length - maxBack; i--) {
      if (i < 0) break;
      if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('File ZIP non valido: End Of Central Directory non trovato');

    const totalEntries = view.getUint16(eocd + 10, true);
    let off = view.getUint32(eocd + 16, true);

    const entries = new Map();
    for (let i = 0; i < totalEntries; i++) {
      if (view.getUint32(off, true) !== CEN_SIG) {
        throw new Error('File ZIP non valido: central directory malformata');
      }
      const method = view.getUint16(off + 10, true);
      const compSize = view.getUint32(off + 20, true);
      const nameLen = view.getUint16(off + 28, true);
      const extraLen = view.getUint16(off + 30, true);
      const commentLen = view.getUint16(off + 32, true);
      const localOffset = view.getUint32(off + 42, true);
      const name = utf8Decode(u8.subarray(off + 46, off + 46 + nameLen));
      off += 46 + nameLen + extraLen + commentLen;

      if (name.charAt(name.length - 1) === '/') continue; // directory entry, no data

      if (view.getUint32(localOffset, true) !== LOC_SIG) {
        throw new Error('File ZIP non valido: local header malformato per ' + name);
      }
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compData = u8.subarray(dataStart, dataStart + compSize);

      let data;
      if (method === 0) {
        data = compData.slice();
      } else if (method === 8) {
        data = await inflateRaw(compData);
      } else {
        throw new Error('Metodo di compressione ZIP non supportato (' + method + ') per ' + name);
      }
      entries.set(name, data);
    }
    return entries;
  }

  // Raw DEFLATE inflate, kept isolated: Node uses zlib, the browser uses
  // DecompressionStream('deflate-raw') (both act on headerless deflate streams).
  async function inflateRaw(u8) {
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
    if (isNode) {
      const zlib = require('zlib');
      return new Uint8Array(zlib.inflateRawSync(u8));
    }
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  // ============================================================
  // Phase 3: shared strings + sheet cell extraction
  // ============================================================

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    const re = /<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml))) {
      const content = m[1] !== undefined ? m[1] : '';
      out.push(decodeEntities(allTagText(content, 't')));
    }
    return out;
  }

  function cellTextFromInner(type, inner, sharedStrings) {
    if (type === 's') {
      const v = firstTag(inner, 'v');
      if (v === null) return '';
      const idx = parseInt(v, 10);
      return sharedStrings[idx] !== undefined ? sharedStrings[idx] : '';
    }
    if (type === 'inlineStr') {
      return decodeEntities(allTagText(extractIs(inner), 't'));
    }
    if (type === 'str') {
      const v = firstTag(inner, 'v');
      return v === null ? '' : decodeEntities(v);
    }
    if (type === 'b') {
      const v = firstTag(inner, 'v');
      if (v === '1') return 'TRUE';
      if (v === '0') return 'FALSE';
      return '';
    }
    if (type === 'e') {
      return '';
    }
    // absent or "n": plain number, kept as its literal text
    const v = firstTag(inner, 'v');
    return v === null ? '' : decodeEntities(v);
  }

  // Iterates every <c ...>...</c> / <c .../> in a worksheet XML string.
  // Returns Map<ref, text> containing only non-empty cells.
  function parseSheetCells(sheetXml, sharedStrings) {
    const strings = sharedStrings || [];
    const cells = new Map();
    const re = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let m;
    while ((m = re.exec(sheetXml))) {
      const attrStr = m[1] !== undefined ? m[1] : m[2];
      const inner = m[3] || '';
      const attrs = parseAttrs(attrStr);
      if (!attrs.r) continue;
      const text = cellTextFromInner(attrs.t, inner, strings);
      if (text !== '') cells.set(attrs.r, text);
    }
    return cells;
  }

  // ============================================================
  // Phase 4: names (splitting / normalizing)
  // ============================================================

  function normalizeName(s) {
    return s
      .replace(/[’‘`]/g, '\'')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleUpperCase('it-IT');
  }

  function splitNames(raw) {
    if (!raw) return [];
    return raw
      .split(/[\/,;+&\n]/)
      .map(normalizeName)
      .filter(function (x) { return x.length > 0; });
  }

  // ============================================================
  // Phase 5: time ranges, months, weekdays
  // ============================================================

  const TIME_RANGE_RE = /(\d{1,2})(?:[.:,](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[.:,](\d{2}))?/;

  function parseTimeRange(headerText) {
    const m = TIME_RANGE_RE.exec(headerText);
    if (!m) return null;
    const sh = parseInt(m[1], 10);
    const sm = m[2] ? parseInt(m[2], 10) : 0;
    const eh = parseInt(m[3], 10);
    const em = m[4] ? parseInt(m[4], 10) : 0;
    const startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;
    if (endMin <= startMin) endMin += 1440;
    const label = collapseWs(headerText.slice(0, m.index) + headerText.slice(m.index + m[0].length));
    return {
      label: label,
      start: pad2(sh) + ':' + pad2(sm),
      end: pad2(eh) + ':' + pad2(em),
      startMin: startMin,
      endMin: endMin
    };
  }

  const MONTHS_IT = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO',
    'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];

  // Accepts "<mese> <anno>" with any separator (space, underscore, ...) between
  // the month word and the year, so it also works directly against filenames
  // like "TURNI_PS_DEA_SETTEMBRE_2026.xlsx".
  function monthFromLabel(label) {
    if (!label) return null;
    const re = /([A-Za-zÀ-ÿ]+)[^A-Za-zÀ-ÿ0-9]*(\d{4})/;
    const m = re.exec(label);
    if (!m) return null;
    const prefix = stripAccents(m[1]).toUpperCase().slice(0, 3);
    const idx = MONTHS_IT.findIndex(function (mo) { return mo.slice(0, 3) === prefix; });
    if (idx === -1) return null;
    return m[2] + '-' + pad2(idx + 1);
  }

  const WEEKDAYS_IT = ['LUNEDI', 'MARTEDI', 'MERCOLEDI', 'GIOVEDI', 'VENERDI', 'SABATO', 'DOMENICA'];
  // indexed by Date#getUTCDay() (0 = Sunday)
  const WEEKDAY_BY_JSDAY = ['DOMENICA', 'LUNEDI', 'MARTEDI', 'MERCOLEDI', 'GIOVEDI', 'VENERDI', 'SABATO'];

  function normalizeWeekday(s) {
    if (s == null) return '';
    return stripAccents(String(s))
      .replace(/['’`]/g, '')
      .toUpperCase()
      .trim();
  }

  function daysInMonth(year, month1based) {
    return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
  }

  // ============================================================
  // Phase 6: workbook.xml / rels (sheet list + sheet-id -> file resolution)
  // ============================================================

  function parseWorkbookSheets(xml) {
    const out = [];
    const re = /<sheet\b([^>]*)\/>|<sheet\b([^>]*)>[\s\S]*?<\/sheet>/g;
    let m;
    while ((m = re.exec(xml))) {
      const attrStr = m[1] !== undefined ? m[1] : m[2];
      const attrs = parseAttrs(attrStr);
      out.push({ name: attrs.name, rId: attrs['r:id'] });
    }
    return out;
  }

  function parseRels(xml) {
    const map = {};
    const re = /<Relationship\b([^>]*)\/>|<Relationship\b([^>]*)>[\s\S]*?<\/Relationship>/g;
    let m;
    while ((m = re.exec(xml))) {
      const attrStr = m[1] !== undefined ? m[1] : m[2];
      const attrs = parseAttrs(attrStr);
      if (attrs.Id) map[attrs.Id] = attrs.Target;
    }
    return map;
  }

  // "worksheets/sheet1.xml" -> "xl/worksheets/sheet1.xml"; "/xl/worksheets/sheet1.xml" -> "xl/worksheets/sheet1.xml"
  function resolveTarget(target) {
    if (target.charAt(0) === '/') return target.slice(1);
    return 'xl/' + target;
  }

  // ============================================================
  // Phase 7: generic cell-map lookups shared by title/period/day scanning
  // ============================================================

  // First cell (reading order: row asc, then column asc) matching `predicate(text, ref)`.
  function findFirstMatch(cellsMap, predicate) {
    let best = null;
    for (const entry of cellsMap) {
      const ref = entry[0];
      const text = entry[1];
      if (!predicate(text, ref)) continue;
      const r = rowNum(ref);
      const c = colIndex(colLetters(ref));
      if (!best || r < best.r || (r === best.r && c < best.c)) {
        best = { ref: ref, text: text, r: r, c: c };
      }
    }
    return best;
  }

  function startsWithCI(text, prefix) {
    return text.trim().toUpperCase().indexOf(prefix) === 0;
  }

  // ============================================================
  // Phase 8: main entry point -- xlsx bytes -> Roster
  // ============================================================

  async function parseWorkbook(bytes, filename) {
    const file = basename(filename);
    const warnings = [];

    // --- read the zip + the workbook-level XML parts ---
    const entries = await readZip(toUint8Array(bytes instanceof Uint8Array || bytes instanceof ArrayBuffer ? bytes : bytes));
    function readEntry(name) {
      const data = entries.get(name);
      return data ? utf8Decode(data) : null;
    }
    const workbookXml = readEntry('xl/workbook.xml');
    if (!workbookXml) throw new Error('xl/workbook.xml non trovato in ' + file);
    const sheetDefs = parseWorkbookSheets(workbookXml);
    const rels = parseRels(readEntry('xl/_rels/workbook.xml.rels') || '');
    const sharedStrings = parseSharedStrings(readEntry('xl/sharedStrings.xml') || '');

    // --- find the first sheet (in workbook order) with a "MATTINA..." header cell ---
    let sheetName = null;
    let cells = null;
    let headerRef = null;
    for (const sd of sheetDefs) {
      const target = sd.rId && rels[sd.rId];
      if (!target) continue;
      const sheetXml = readEntry(resolveTarget(target));
      if (sheetXml === null) continue;
      const sheetCells = parseSheetCells(sheetXml, sharedStrings);
      const hit = findFirstMatch(sheetCells, function (text) { return startsWithCI(text, 'MATTINA'); });
      if (hit) {
        sheetName = sd.name;
        cells = sheetCells;
        headerRef = hit.ref;
        break;
      }
    }
    if (!cells) throw new Error('Foglio con intestazione "MATTINA" non trovato in ' + file);
    const headerRow = rowNum(headerRef);

    // --- slot columns on the header row ---
    const slots = buildSlots(cells, headerRow, warnings, file);

    // sub-header row -> roles
    const subRow = headerRow + 1;
    for (const slot of slots) {
      const subText = (cells.get(slot.col + subRow) || '').trim();
      slot.sub = subText;
      slot.roles = subText
        ? subText.split('/').map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 0; })
        : [];
    }

    // --- title / hospital ---
    const title = findTitle(cells, headerRow);
    const hospital = deriveHospital(title, file);

    // --- period / month ---
    const period = findPeriod(cells, file, warnings);

    // --- day rows ---
    const days = buildDays(cells, headerRow, slots, period.month, warnings);

    return {
      file: file,
      sheet: sheetName,
      hospital: hospital,
      title: title,
      periodLabel: period.periodLabel,
      month: period.month,
      slots: slots,
      days: days,
      warnings: warnings
    };
  }

  // ---- helpers used by parseWorkbook (kept separate for readability) ----

  const SLOT_DEFAULTS = {
    M: { start: '08:00', end: '14:00', startMin: 480, endMin: 840 },
    P: { start: '14:00', end: '20:00', startMin: 840, endMin: 1200 },
    N: { start: '20:00', end: '08:00', startMin: 1200, endMin: 1920 },
    A: { start: '09:30', end: '15:00', startMin: 570, endMin: 900 }
  };

  function buildSlots(cells, headerRow, warnings, file) {
    const headerCells = [];
    for (const entry of cells) {
      const ref = entry[0];
      if (rowNum(ref) === headerRow) {
        headerCells.push({ ref: ref, text: entry[1], col: colLetters(ref), ci: colIndex(colLetters(ref)) });
      }
    }
    headerCells.sort(function (a, b) { return a.ci - b.ci; });

    const slots = [];
    let unknownCount = 0;
    for (const hc of headerCells) {
      const header = hc.text.trim();
      const up = header.toUpperCase();
      let key = null;
      if (up.indexOf('MATTINA') !== -1) key = 'M';
      else if (up.indexOf('POMERIGGIO') !== -1) key = 'P';
      else if (up.indexOf('NOTTE') !== -1) key = 'N';
      else if (up.indexOf('AMBULATORIO') !== -1) key = 'A';

      const range = parseTimeRange(header);
      if (key === null && !range) continue; // not a slot column at all

      if (key === null) {
        unknownCount++;
        key = 'X' + unknownCount;
      }

      let label, start, end, startMin, endMin;
      if (range) {
        label = range.label;
        start = range.start; end = range.end;
        startMin = range.startMin; endMin = range.endMin;
      } else if (SLOT_DEFAULTS[key]) {
        const d = SLOT_DEFAULTS[key];
        label = collapseWs(header);
        start = d.start; end = d.end; startMin = d.startMin; endMin = d.endMin;
        warnings.push({
          type: 'slot-default-time',
          message: 'Nessun orario nell\'intestazione "' + header + '", uso orario predefinito ' + start + '-' + end,
          row: headerRow
        });
      } else {
        throw new Error('Intestazione turno senza orario riconoscibile: "' + header + '" in ' + file);
      }

      slots.push({
        key: key, label: label, header: header, sub: '', roles: [],
        start: start, end: end, startMin: startMin, endMin: endMin, col: hc.col
      });
    }
    if (slots.length === 0) throw new Error('Nessuna colonna turno trovata in ' + file);
    return slots;
  }

  function findTitle(cells, headerRow) {
    const turniHit = findFirstMatch(cells, function (text, ref) {
      return rowNum(ref) < headerRow && startsWithCI(text, 'TURNI');
    });
    if (turniHit) return turniHit.text.trim();
    const anyHit = findFirstMatch(cells, function (text, ref) { return rowNum(ref) < headerRow; });
    return anyHit ? anyHit.text.trim() : '';
  }

  function deriveHospital(title, file) {
    const titleUp = title.toUpperCase();
    let hospital;
    if (titleUp.indexOf('OSG') !== -1) hospital = 'OSG';
    else if (titleUp.indexOf('DEA') !== -1) hospital = 'DEA';
    else hospital = collapseWs(title.replace(/TURNI/gi, '').replace(/PS/gi, ''));

    if (!hospital) {
      const fileUp = file.toUpperCase();
      if (fileUp.indexOf('OSG') !== -1) hospital = 'OSG';
      else if (fileUp.indexOf('DEA') !== -1) hospital = 'DEA';
      else hospital = '?';
    }
    return hospital;
  }

  function findPeriod(cells, file, warnings) {
    let periodLabel = '';
    const periodoHit = findFirstMatch(cells, function (text) { return startsWithCI(text, 'PERIODO'); });
    if (periodoHit) {
      const pr = periodoHit.r;
      const pc = periodoHit.c;
      const rightHit = findFirstMatch(cells, function (text, ref) {
        return rowNum(ref) === pr && colIndex(colLetters(ref)) > pc;
      });
      if (rightHit) periodLabel = rightHit.text.trim();
    }

    let month = periodLabel ? monthFromLabel(periodLabel) : null;
    if (!month) {
      const fromFile = monthFromLabel(file);
      if (fromFile) {
        month = fromFile;
        warnings.push({ type: 'period-from-filename', message: 'Periodo dedotto dal nome del file ' + file });
      }
    }
    if (!month) throw new Error('Periodo di riferimento non trovato in ' + file);

    return { periodLabel: periodLabel, month: month };
  }

  function buildDays(cells, headerRow, slots, month, warnings) {
    const year = parseInt(month.slice(0, 4), 10);
    const monthNum = parseInt(month.slice(5, 7), 10);
    const ndays = daysInMonth(year, monthNum);
    const subHeaderRow = headerRow + 1;

    const candidates = [];
    for (const entry of cells) {
      const ref = entry[0];
      if (colLetters(ref) !== 'A') continue;
      const r = rowNum(ref);
      if (r <= subHeaderRow) continue;
      const t = entry[1].trim();
      if (!/^\d{1,2}$/.test(t)) continue;
      const d = parseInt(t, 10);
      if (d < 1 || d > 31) continue;
      candidates.push({ row: r, day: d });
    }
    candidates.sort(function (a, b) { return a.row - b.row; });

    const days = [];
    const seen = new Set();
    for (const cand of candidates) {
      const d = cand.day;
      const r = cand.row;

      if (d > ndays) {
        warnings.push({ type: 'day-out-of-range', message: 'Giorno ' + d + ' oltre la fine del mese', row: r, day: d });
        continue;
      }
      if (seen.has(d)) {
        warnings.push({ type: 'day-duplicate', message: 'Giorno ' + d + ' duplicato', row: r, day: d });
        continue;
      }
      seen.add(d);

      const weekdayLabel = (cells.get('B' + r) || '').trim();
      const expected = WEEKDAY_BY_JSDAY[new Date(Date.UTC(year, monthNum - 1, d)).getUTCDay()];
      const weekdayOk = normalizeWeekday(weekdayLabel) === expected;
      if (!weekdayOk) {
        warnings.push({
          type: 'weekday-mismatch',
          message: 'Giorno ' + d + ': etichetta "' + (weekdayLabel || '(vuoto)') + '", atteso ' + expected,
          row: r,
          day: d
        });
      }

      const dayCells = {};
      for (const slot of slots) {
        const raw = (cells.get(slot.col + r) || '').trim();
        dayCells[slot.key] = { raw: raw, names: splitNames(raw) };
      }

      days.push({
        day: d,
        date: month + '-' + pad2(d),
        weekdayLabel: weekdayLabel,
        weekdayOk: weekdayOk,
        cells: dayCells
      });
    }
    days.sort(function (a, b) { return a.day - b.day; });
    return days;
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    parseWorkbook: parseWorkbook,
    readZip: readZip,
    parseSheetCells: parseSheetCells,
    parseSharedStrings: parseSharedStrings,
    decodeEntities: decodeEntities,
    normalizeName: normalizeName,
    splitNames: splitNames,
    parseTimeRange: parseTimeRange,
    monthFromLabel: monthFromLabel,
    normalizeWeekday: normalizeWeekday,
    colLetters: colLetters,
    rowNum: rowNum,
    colIndex: colIndex,
    inflateRaw: inflateRaw
  };

})();

if (typeof module !== 'undefined' && module.exports) module.exports = TurniParser; else window.TurniParser = TurniParser;
