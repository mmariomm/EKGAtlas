'use strict';

// test/parser.test.js -- Node, zero dependencies. Run with `node test/parser.test.js`
// from anywhere (all paths are __dirname-relative).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TurniParser = require(path.join(__dirname, '..', 'src', 'parser.js'));

let assertions = 0;
function eq(actual, expected, message) { assert.deepStrictEqual(actual, expected, message); assertions++; }
function is(actual, expected, message) { assert.strictEqual(actual, expected, message); assertions++; }
function truthy(value, message) { assert.ok(value, message); assertions++; }
async function rejects(promise, matcher, message) { await assert.rejects(promise, matcher, message); assertions++; }

// ============================================================
// Minimal in-test ZIP writer (stored entries only, real CRC-32)
// so the error-path / robustness tests exercise readZip too.
// ============================================================

const CRC_TABLE = (function () {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// files: [{name, data: Buffer}] -> a valid ZIP Buffer, method 0 (stored) only.
function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);   // version needed
    local.writeUInt16LE(0, 6);    // flags
    local.writeUInt16LE(0, 8);    // method: stored
    local.writeUInt16LE(0, 10);   // mod time
    local.writeUInt16LE(0x21, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);   // extra len
    nameBuf.copy(local, 30);
    const localEntry = Buffer.concat([local, data]);
    localParts.push(localEntry);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);  // version made by
    central.writeUInt16LE(20, 6);  // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);

    offset += localEntry.length;
  }
  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

// Small XML builders for synthetic worksheets (inlineStr cells -> no shared
// strings part needed).
function xmlRow(r, cellsXml) { return '<row r="' + r + '">' + cellsXml + '</row>'; }
function xmlTextCell(ref, text) { return '<c r="' + ref + '" t="inlineStr"><is><t>' + text + '</t></is></c>'; }
function xmlNumberCell(ref, n) { return '<c r="' + ref + '"><v>' + n + '</v></c>'; }
function xmlEmptyCell(ref) { return '<c r="' + ref + '"/>'; }

// Wraps one sheet's inner <row> XML into a full, minimal xlsx Buffer.
function buildXlsx(sheetInnerXml) {
  const workbookXml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Foglio1" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const relsXml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
    'Target="worksheets/sheet1.xml"/></Relationships>';
  const sheetXml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' + sheetInnerXml + '</sheetData></worksheet>';
  return makeZip([
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8') }
  ]);
}

// ============================================================
// 1. Real files vs. the oracle fixtures (produced independently with
//    Python/openpyxl from the same SPEC).
// ============================================================

async function testRealFiles() {
  const cases = [
    ['TURNI_PS_DEA_SETTEMBRE_2026.xlsx', 'DEA.json'],
    ['TURNI_PS_OSG_SETTEMBRE_2026.xlsx', 'OSG.json']
  ];
  for (const [xlsxName, fixtureName] of cases) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'data', xlsxName));
    const roster = await TurniParser.parseWorkbook(new Uint8Array(bytes), xlsxName);
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', fixtureName), 'utf8'));
    eq(roster, fixture, xlsxName + ' matches the oracle fixture exactly');
  }
}

// ============================================================
// 2. Unit tests for the small pure helpers (values from SPEC).
// ============================================================

function testUnitHelpers() {
  const ambulatorio = TurniParser.parseTimeRange('AMBULATORIO CM 09.30-15.00');
  eq(ambulatorio, { label: 'AMBULATORIO CM', start: '09:30', end: '15:00', startMin: 570, endMin: 900 },
    'parseTimeRange: AMBULATORIO CM 09.30-15.00');

  const notte = TurniParser.parseTimeRange('NOTTE 20-08');
  is(notte.endMin, 1920, 'parseTimeRange: NOTTE 20-08 crosses midnight -> endMin 1920');

  eq(TurniParser.splitNames('DE PASQUALE /TOSKIC'), ['DE PASQUALE', 'TOSKIC'], 'splitNames: slash with stray space');
  eq(TurniParser.splitNames('BRAHAM/ DI VITA F.'), ['BRAHAM', 'DI VITA F.'], 'splitNames: slash, leading space, dot kept');
  eq(TurniParser.splitNames('ORLANDITOSKIC'), ['ORLANDITOSKIC'], 'splitNames: concatenated name stays as one token');
  eq(TurniParser.splitNames('D’AMORE'), ['D\'AMORE'], 'splitNames: curly apostrophe normalized to straight');
  eq(TurniParser.splitNames('a, b; c + d & e\nf'), ['A', 'B', 'C', 'D', 'E', 'F'], 'splitNames: every separator, uppercased');

  is(TurniParser.normalizeWeekday('Lunedì'), 'LUNEDI', 'normalizeWeekday: accented form');
  is(TurniParser.normalizeWeekday('LUNEDI\''), 'LUNEDI', 'normalizeWeekday: apostrophe form');
  is(TurniParser.normalizeWeekday('Lunedì'), TurniParser.normalizeWeekday('LUNEDI\''),
    'normalizeWeekday: both forms agree');

  is(TurniParser.monthFromLabel('Settembre 2026'), '2026-09', 'monthFromLabel: full name');
  is(TurniParser.monthFromLabel('SET 2026'), '2026-09', 'monthFromLabel: 3-letter abbreviation');
  is(TurniParser.monthFromLabel('foo'), null, 'monthFromLabel: no match -> null');
}

// ============================================================
// 3. XML edge cases, exercised directly on parseSheetCells /
//    parseSharedStrings / decodeEntities with hand-written XML.
// ============================================================

function testXmlEdgeCases() {
  // rich-text runs inside a shared string
  eq(
    TurniParser.parseSharedStrings('<sst><si><r><t>AB</t></r><r><t>CD</t></r></si></sst>'),
    ['ABCD'],
    'parseSharedStrings: concatenates rich-text runs'
  );

  // inlineStr cell
  const inlineCells = TurniParser.parseSheetCells(
    '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Ciao</t></is></c></row></sheetData>', []);
  is(inlineCells.get('A1'), 'Ciao', 'parseSheetCells: inlineStr cell');

  // self-closing empty cell -> not present in the map
  const emptyCells = TurniParser.parseSheetCells(
    '<sheetData><row r="1"><c r="A1" s="3"/></row></sheetData>', []);
  is(emptyCells.has('A1'), false, 'parseSheetCells: self-closing empty cell is absent from the map');

  // attribute order: t before r
  const orderCells = TurniParser.parseSheetCells(
    '<sheetData><row r="2"><c t="s" r="B2"><v>0</v></c></row></sheetData>', ['HELLO']);
  is(orderCells.get('B2'), 'HELLO', 'parseSheetCells: attribute order (t before r) does not matter');

  // t="b" boolean cell
  const boolCells = TurniParser.parseSheetCells(
    '<sheetData><row r="1"><c r="C1" t="b"><v>1</v></c></row>' +
    '<row r="2"><c r="C2" t="b"><v>0</v></c></row></sheetData>', []);
  is(boolCells.get('C1'), 'TRUE', 'parseSheetCells: t="b" true');
  is(boolCells.get('C2'), 'FALSE', 'parseSheetCells: t="b" false');

  // entity decoding
  is(TurniParser.decodeEntities('A &amp; B &#39;x&#39; &#x27;y&#x27;'), 'A & B \'x\' \'y\'',
    'decodeEntities: named + decimal + hex entities');

  // a cell whose <v> contains a plain number
  const numCells = TurniParser.parseSheetCells(
    '<sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData>', []);
  is(numCells.get('A1'), '42', 'parseSheetCells: bare numeric cell stays a string');
}

// ============================================================
// 4. Error paths (full parseWorkbook through a synthetic zip).
// ============================================================

async function testErrorPaths() {
  // (a) no sheet has a MATTINA header at all
  const noHeaderXlsx = buildXlsx(xmlRow(1, xmlTextCell('A1', 'NIENTE DI RILEVANTE QUI')));
  await rejects(
    TurniParser.parseWorkbook(noHeaderXlsx, 'nessuna-mattina.xlsx'),
    Error,
    'parseWorkbook: no MATTINA header anywhere rejects with an Error'
  );

  // (b)/(c) share one sheet: a MATTINA header but no "Periodo di riferimento" row
  const noPeriodSheet = xmlRow(1,
    xmlTextCell('C1', 'MATTINA 8-14') +
    xmlTextCell('E1', 'POMERIGGIO 14-20') +
    xmlTextCell('F1', 'NOTTE 20-08'));
  const noPeriodXlsx = buildXlsx(noPeriodSheet);

  // (b) ...and a filename with no month either -> rejects, message mentions "Periodo"
  await rejects(
    TurniParser.parseWorkbook(noPeriodXlsx, 'senza_periodo.xlsx'),
    /Periodo/,
    'parseWorkbook: missing Periodo + no month in filename rejects mentioning "Periodo"'
  );

  // (c) ...but a filename containing OTTOBRE_2026 rescues the month
  const rescued = await TurniParser.parseWorkbook(noPeriodXlsx, 'qualcosa_OTTOBRE_2026.xlsx');
  is(rescued.month, '2026-10', 'parseWorkbook: month rescued from filename');
  truthy(
    rescued.warnings.some(function (w) { return w.type === 'period-from-filename'; }),
    'parseWorkbook: period-from-filename warning is present'
  );
}

// ============================================================
// 5. Robustness checks on one synthetic workbook (full parseWorkbook,
//    exercising readZip): header on a non-standard row, a hidden empty
//    column between slots, a duplicate day row, a day past the end of
//    the month, and a wrong weekday label.
// ============================================================

async function testRobustness() {
  // April 2026: 1 Apr = Mercoledi, 2 Apr = Giovedi, 3 Apr = Venerdi, 30 days total.
  const sheet =
    xmlRow(1, xmlTextCell('A1', 'TURNI PS/DEA SYNTH')) +
    xmlRow(4, xmlTextCell('A4', 'Periodo di riferimento:') + xmlTextCell('C4', 'APRILE 2026')) +
    xmlRow(7,
      xmlTextCell('C7', 'MATTINA 8-14') +
      xmlEmptyCell('D7') + // hidden, empty column between MATTINA and POMERIGGIO
      xmlTextCell('E7', 'POMERIGGIO 14-20') +
      xmlTextCell('F7', 'NOTTE 20-08')) +
    xmlRow(9, xmlNumberCell('A9', 1) + xmlTextCell('B9', 'MERCOLEDI') + xmlTextCell('C9', 'ROSSI')) +
    xmlRow(10, xmlNumberCell('A10', 2) + xmlTextCell('B10', 'GIOVEDI') + xmlTextCell('C10', 'PRIMO')) +
    xmlRow(11, xmlNumberCell('A11', 2) + xmlTextCell('B11', 'GIOVEDI') + xmlTextCell('C11', 'SECONDO')) + // duplicate day 2
    xmlRow(12, xmlNumberCell('A12', 31) + xmlTextCell('B12', 'VENERDI')) + // April has only 30 days
    xmlRow(13, xmlNumberCell('A13', 3) + xmlTextCell('B13', 'LUNEDI') + xmlTextCell('C13', 'TIZIO')); // wrong weekday

  const xlsx = buildXlsx(sheet);
  const roster = await TurniParser.parseWorkbook(xlsx, 'robustezza.xlsx');

  is(roster.month, '2026-04', 'robustness: month parsed from a header on a non-standard row (7)');
  eq(roster.slots.map(function (s) { return s.key; }), ['M', 'P', 'N'],
    'robustness: hidden empty column D produced no extra slot');

  eq(roster.days.map(function (d) { return d.day; }), [1, 2, 3],
    'robustness: day 31 dropped (out of range), duplicate day 2 collapsed to one');

  const day1 = roster.days.find(function (d) { return d.day === 1; });
  is(day1.weekdayOk, true, 'robustness: day 1 weekday matches the calendar');

  const day2 = roster.days.find(function (d) { return d.day === 2; });
  is(day2.cells.M.raw, 'PRIMO', 'robustness: duplicate day row -> first occurrence kept');

  const day3 = roster.days.find(function (d) { return d.day === 3; });
  is(day3.weekdayOk, false, 'robustness: wrong weekday label -> weekdayOk false');

  const byType = function (type) { return roster.warnings.filter(function (w) { return w.type === type; }); };
  is(byType('day-duplicate').length, 1, 'robustness: exactly one day-duplicate warning');
  is(byType('day-duplicate')[0].day, 2, 'robustness: day-duplicate warning names day 2');
  is(byType('day-out-of-range').length, 1, 'robustness: exactly one day-out-of-range warning');
  is(byType('day-out-of-range')[0].day, 31, 'robustness: day-out-of-range warning names day 31');
  is(byType('weekday-mismatch').length, 1, 'robustness: exactly one weekday-mismatch warning');
  is(byType('weekday-mismatch')[0].day, 3, 'robustness: weekday-mismatch warning names day 3');
}

// ============================================================
// Run everything.
// ============================================================

async function main() {
  await testRealFiles();
  testUnitHelpers();
  testXmlEdgeCases();
  await testErrorPaths();
  await testRobustness();
}

main().then(function () {
  console.log('ok — ' + assertions + ' assertions');
  process.exit(0);
}).catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
