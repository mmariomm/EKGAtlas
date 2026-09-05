// test/rules.test.js — test del motore delle regole (src/rules.js).
// Esecuzione: `node test/rules.test.js` dalla cartella del progetto (percorsi relativi a __dirname).
// Zero dipendenze: solo node:assert/strict e node:fs/path.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TurniRules = require(path.join(__dirname, '..', 'src', 'rules.js'));

// --------------------------------------------------------------------
// Piccolo contatore di asserzioni sopra node:assert/strict, per il
// riepilogo finale ("ok — N assertions"). Il processo esce con codice
// diverso da zero se una qualunque asserzione fallisce (l'eccezione
// risale fino al try/catch in fondo al file).
// --------------------------------------------------------------------
let checks = 0;
function eq(actual, expected, msg) { assert.strictEqual(actual, expected, msg); checks++; }
function deepEq(actual, expected, msg) { assert.deepStrictEqual(actual, expected, msg); checks++; }
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

// ======================================================================
// Fixtures reali (oracolo prodotto indipendentemente in Python dalla stessa spec)
// ======================================================================

const FIXTURES = path.join(__dirname, 'fixtures');
const DEA = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'DEA.json'), 'utf8'));
const OSG = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'OSG.json'), 'utf8'));
const FINDINGS_EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'findings.expected.json'), 'utf8'));
const NAMES_EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'names.expected.json'), 'utf8'));

// ======================================================================
// 1. buildAssignments sui dati reali
// ======================================================================

const realAssignments = TurniRules.buildAssignments([DEA, OSG]);

eq(realAssignments.length, 358, 'buildAssignments: 358 assegnazioni sui dati reali');

{
  const ids = new Set(realAssignments.map((a) => a.id));
  eq(ids.size, realAssignments.length, 'buildAssignments: id tutti univoci');
}

const realById = new Map(realAssignments.map((a) => [a.id, a]));

{
  const a = realById.get('DEA|2026-09-01|P|1');
  ok(a, 'DEA|2026-09-01|P|1 esiste');
  eq(a.person, 'LOFFREDO', 'DEA|2026-09-01|P|1 è LOFFREDO');
  eq(a.role, 'Codici Minori', 'DEA|2026-09-01|P|1 ha ruolo "Codici Minori"');
}
{
  const a = realById.get('OSG|2026-09-01|P|1');
  ok(a, 'OSG|2026-09-01|P|1 esiste');
  eq(a.person, 'DI VITA F.', 'OSG|2026-09-01|P|1 è "DI VITA F."');
  eq(a.role, 'Bassa intensità', 'OSG|2026-09-01|P|1 ha ruolo "Bassa intensità"');
}
{
  const a = realById.get('DEA|2026-09-01|A|0');
  ok(a, 'DEA|2026-09-01|A|0 esiste');
  eq(a.person, 'LOFFREDO', 'DEA|2026-09-01|A|0 è LOFFREDO');
  eq(a.role, '', 'DEA|2026-09-01|A|0 ha ruolo "" (lo slot A non ha ruoli)');
}

{
  const nights = realAssignments.filter((a) => a.isNight);
  ok(nights.length > 0, 'ci sono turni di notte nei dati reali');
  ok(nights.every((a) => a.endAbs - a.startAbs === 720), 'ogni notte dura esattamente 720 minuti (12 h) ed è isNight');
}

{
  const a = realById.get('DEA|2026-09-01|M|0');
  ok(a, 'DEA|2026-09-01|M|0 esiste');
  eq(a.startAbs, TurniRules.dayIndex('2026-09-01') * 1440 + 480, 'startAbs di DEA|2026-09-01|M|0 = dayIndex*1440+480');
}

// ======================================================================
// 2. computeFindings sui dati reali, confrontato con l'oracolo
// ======================================================================

const realFindings = TurniRules.computeFindings(realAssignments);

function normalizeFinding(f) {
  const out = { kind: f.kind, severity: f.severity, person: f.person, a: f.a.id, b: f.b.id };
  if (f.overlapMin !== undefined) out.overlapMin = f.overlapMin;
  if (f.restMin !== undefined) out.restMin = f.restMin;
  return out;
}
function normalizeOracle(e) {
  const out = { kind: e.kind, severity: e.severity, person: e.person, a: e.a, b: e.b };
  if (e.overlapMin !== undefined) out.overlapMin = e.overlapMin;
  if (e.restMin !== undefined) out.restMin = e.restMin;
  return out;
}

eq(realFindings.length, 2, 'computeFindings: esattamente 2 reperti sui dati reali');
deepEq(
  realFindings.map(normalizeFinding),
  FINDINGS_EXPECTED.map(normalizeOracle),
  'computeFindings: kind/severity/person/a.id/b.id/overlapMin/restMin e ordine combaciano con l\'oracolo'
);

{
  const [braham, boules] = realFindings;
  eq(braham.person, 'BRAHAM', 'primo reperto: BRAHAM');
  eq(braham.a.id, 'OSG|2026-09-17|N|0', 'BRAHAM: a = OSG|2026-09-17|N|0');
  eq(braham.b.id, 'OSG|2026-09-18|M|0', 'BRAHAM: b = OSG|2026-09-18|M|0');
  eq(braham.restMin, 0, 'BRAHAM: riposo 0');
  eq(braham.title, 'Notte attaccata a un turno diurno', 'titolo BRAHAM');
  ok(braham.detail.includes('riposo 0 h'), 'dettaglio BRAHAM contiene "riposo 0 h"');
  ok(braham.detail.includes('gio 17 set'), 'dettaglio BRAHAM contiene "gio 17 set"');

  eq(boules.person, 'BOULES', 'secondo reperto: BOULES');
  eq(boules.a.id, 'OSG|2026-09-21|M|1', 'BOULES: a = OSG|2026-09-21|M|1');
  eq(boules.b.id, 'OSG|2026-09-21|N|1', 'BOULES: b = OSG|2026-09-21|N|1');
  eq(boules.restMin, 360, 'BOULES: riposo 360');
  eq(boules.title, 'Riposo breve intorno alla notte', 'titolo BOULES');
}

// ======================================================================
// 3. Fixtures sintetiche — una coppia di turni per ogni ramo delle regole
// ======================================================================

// Gli stessi slot descritti nella spec: M 08-14, P 14-20, N 20-08 (endMin 1920), A 09:30-15:00 (570-900).
const SYN_SLOTS = {
  M: { key: 'M', label: 'MATTINA', header: 'MATTINA 8-14', sub: '', roles: [], start: '08:00', end: '14:00', startMin: 480, endMin: 840, col: 'C' },
  P: { key: 'P', label: 'POMERIGGIO', header: 'POMERIGGIO 14-20', sub: '', roles: [], start: '14:00', end: '20:00', startMin: 840, endMin: 1200, col: 'D' },
  N: { key: 'N', label: 'NOTTE', header: 'NOTTE 20-08', sub: '', roles: [], start: '20:00', end: '08:00', startMin: 1200, endMin: 1920, col: 'E' },
  A: { key: 'A', label: 'AMBULATORIO', header: 'AMBULATORIO 9.30-15', sub: '', roles: [], start: '09:30', end: '15:00', startMin: 570, endMin: 900, col: 'F' },
};
function cloneSlot(key) { return Object.assign({}, SYN_SLOTS[key]); }
function dayOf(dateStr) { return Number(dateStr.slice(8, 10)); }

// Costruisce un Roster minimo per un ospedale a partire da un elenco di collocazioni
// { date, slotKey, names }. Più collocazioni sulla stessa data/slot si accumulano nella
// stessa cella (serve a testare la deduplica quando il nome è ripetuto).
function buildRoster(hospital, placements) {
  const slotKeys = Array.from(new Set(placements.map((p) => p.slotKey)));
  const slots = slotKeys.map(cloneSlot);
  const byDate = new Map();
  for (const p of placements) {
    if (!byDate.has(p.date)) byDate.set(p.date, {});
    const cellsIn = byDate.get(p.date);
    cellsIn[p.slotKey] = (cellsIn[p.slotKey] || []).concat(p.names);
  }
  const days = Array.from(byDate.keys()).sort().map((date) => {
    const cellsIn = byDate.get(date);
    const cells = {};
    for (const s of slots) {
      const names = cellsIn[s.key] || [];
      cells[s.key] = { raw: names.join('/'), names: names.slice() };
    }
    return { day: dayOf(date), date, weekdayLabel: '', weekdayOk: true, cells };
  });
  return {
    file: 'synthetic', sheet: 'synthetic', hospital, title: '', periodLabel: '',
    month: days.length ? days[0].date.slice(0, 7) : '', slots, days, warnings: [],
  };
}

// Costruisce i due turni di UNA persona (a e b, possibilmente in ospedali diversi) e
// calcola assegnazioni + reperti per quella sola coppia.
function scenario(person, a, b) {
  const hospitals = Array.from(new Set([a.hospital, b.hospital]));
  const rosters = hospitals.map((h) =>
    buildRoster(h, [a, b].filter((p) => p.hospital === h).map((p) => ({ hospital: h, date: p.date, slotKey: p.slotKey, names: [person] })))
  );
  const assignments = TurniRules.buildAssignments(rosters);
  const findings = TurniRules.computeFindings(assignments);
  return { assignments, findings };
}

// --- conflitto -------------------------------------------------------

{
  // Stesso slot, stesso giorno, ospedali diversi: sovrapposizione totale (360 min).
  const { findings } = scenario('S01', { hospital: 'DEA', date: '2026-09-01', slotKey: 'M' }, { hospital: 'OSG', date: '2026-09-01', slotKey: 'M' });
  eq(findings.length, 1, 'S01: conflitto tra ospedali diversi sullo stesso slot');
  eq(findings[0].kind, 'conflitto', 'S01: kind conflitto');
  eq(findings[0].overlapMin, 360, 'S01: overlapMin 360');
  eq(findings[0].title, 'Stesso orario in due ospedali', 'S01: titolo');
  eq(findings[0].detail, 'Mattina DEA 08–14 e Mattina OSG 08–14 · mar 1 set', 'S01: dettaglio identico all\'esempio della spec');
}
{
  // Ambulatorio 09:30-15:00 seguito da Pomeriggio 14-20 nello STESSO ospedale: 60 min di
  // sovrapposizione, ma è un passaggio di consegne, non un conflitto.
  const { findings } = scenario('S02', { hospital: 'DEA', date: '2026-09-01', slotKey: 'A' }, { hospital: 'DEA', date: '2026-09-01', slotKey: 'P' });
  eq(findings.length, 0, 'S02: Ambulatorio+Pomeriggio stesso ospedale, sovrapposizione <= 60 min → nessun reperto');
}
{
  // Due turni diurni diversi nello stesso ospedale, sovrapposizione > 60 min.
  const { findings } = scenario('S03', { hospital: 'DEA', date: '2026-09-01', slotKey: 'M' }, { hospital: 'DEA', date: '2026-09-01', slotKey: 'A' });
  eq(findings.length, 1, 'S03: doppio incarico stesso ospedale');
  eq(findings[0].overlapMin, 270, 'S03: overlapMin 270');
  eq(findings[0].title, 'Doppio incarico nello stesso ospedale', 'S03: titolo');
}
{
  // Ospedali diversi: anche una sovrapposizione di soli 60 minuti conta.
  const { findings } = scenario('S04', { hospital: 'DEA', date: '2026-09-01', slotKey: 'A' }, { hospital: 'OSG', date: '2026-09-01', slotKey: 'P' });
  eq(findings.length, 1, 'S04: ospedali diversi, 60 min di sovrapposizione → conflitto comunque');
  eq(findings[0].overlapMin, 60, 'S04: overlapMin 60');
  eq(findings[0].title, 'Stesso orario in due ospedali', 'S04: titolo');
}

// --- notte-attaccata ---------------------------------------------------

{
  // Pomeriggio poi Notte, stesso giorno, stesso ospedale: riposo 0.
  const { findings } = scenario('S05', { hospital: 'DEA', date: '2026-09-01', slotKey: 'P' }, { hospital: 'DEA', date: '2026-09-01', slotKey: 'N' });
  eq(findings.length, 1, 'S05: Pomeriggio → Notte');
  eq(findings[0].kind, 'notte-attaccata', 'S05: kind');
  eq(findings[0].restMin, 0, 'S05: riposo 0');
  eq(findings[0].title, 'Notte attaccata a un turno diurno', 'S05: titolo (riposo 0)');
}
{
  // Notte (giorno d) poi Mattina il giorno dopo, ospedali diversi: riposo 0.
  const { findings } = scenario('S06', { hospital: 'DEA', date: '2026-09-01', slotKey: 'N' }, { hospital: 'OSG', date: '2026-09-02', slotKey: 'M' });
  eq(findings.length, 1, 'S06: Notte → Mattina (giorno dopo, altro ospedale)');
  eq(findings[0].restMin, 0, 'S06: riposo 0');
  eq(findings[0].title, 'Notte attaccata a un turno diurno', 'S06: titolo');
}
{
  // Mattina poi Notte, stesso giorno: riposo 360.
  const { findings } = scenario('S07', { hospital: 'DEA', date: '2026-09-01', slotKey: 'M' }, { hospital: 'DEA', date: '2026-09-01', slotKey: 'N' });
  eq(findings.length, 1, 'S07: Mattina → Notte');
  eq(findings[0].restMin, 360, 'S07: riposo 360');
  eq(findings[0].title, 'Riposo breve intorno alla notte', 'S07: titolo (riposo > 0)');
}
{
  // Notte poi Ambulatorio il giorno dopo: riposo 90 (1 h 30).
  const { findings } = scenario('S08', { hospital: 'DEA', date: '2026-09-01', slotKey: 'N' }, { hospital: 'DEA', date: '2026-09-02', slotKey: 'A' });
  eq(findings.length, 1, 'S08: Notte → Ambulatorio (giorno dopo)');
  eq(findings[0].restMin, 90, 'S08: riposo 90');
  ok(findings[0].detail.includes('1 h 30'), 'S08: dettaglio contiene "1 h 30"');
}
{
  // Notte poi Pomeriggio il giorno dopo: riposo 360.
  const { findings } = scenario('S09', { hospital: 'DEA', date: '2026-09-01', slotKey: 'N' }, { hospital: 'DEA', date: '2026-09-02', slotKey: 'P' });
  eq(findings.length, 1, 'S09: Notte → Pomeriggio (giorno dopo)');
  eq(findings[0].restMin, 360, 'S09: riposo 360');
}
{
  // Due notti consecutive: 12 h di riposo, nessun reperto.
  const { findings } = scenario('S10', { hospital: 'DEA', date: '2026-09-01', slotKey: 'N' }, { hospital: 'DEA', date: '2026-09-02', slotKey: 'N' });
  eq(findings.length, 0, 'S10: due notti consecutive → nessun reperto');
}

// --- cambio-sede -------------------------------------------------------

{
  // Mattina DEA poi Pomeriggio OSG, stesso giorno: cambio sede senza pausa.
  const { findings } = scenario('S11', { hospital: 'DEA', date: '2026-09-01', slotKey: 'M' }, { hospital: 'OSG', date: '2026-09-01', slotKey: 'P' });
  eq(findings.length, 1, 'S11: cambio di sede senza pausa');
  eq(findings[0].kind, 'cambio-sede', 'S11: kind');
  eq(findings[0].restMin, 0, 'S11: riposo 0');
  eq(findings[0].title, 'Cambio di sede senza pausa', 'S11: titolo');
}
{
  // Mattina poi Pomeriggio nello STESSO ospedale: è un turno continuo, non un cambio sede.
  const { findings } = scenario('S12', { hospital: 'DEA', date: '2026-09-01', slotKey: 'M' }, { hospital: 'DEA', date: '2026-09-01', slotKey: 'P' });
  eq(findings.length, 0, 'S12: Mattina → Pomeriggio stesso ospedale → nessun reperto');
}
{
  // Pomeriggio DEA poi Notte OSG, stesso giorno: la notte prevale sul cambio sede.
  const { findings } = scenario('S13', { hospital: 'DEA', date: '2026-09-01', slotKey: 'P' }, { hospital: 'OSG', date: '2026-09-01', slotKey: 'N' });
  eq(findings.length, 1, 'S13: Pomeriggio DEA → Notte OSG');
  eq(findings[0].kind, 'notte-attaccata', 'S13: la notte vince sul cambio-sede');
  eq(findings[0].restMin, 0, 'S13: riposo 0');
}

// --- dedupe / confini / limiti -----------------------------------------

{
  // Lo stesso nome due volte nella stessa cella: una sola assegnazione, nessun autoreperto.
  const { assignments, findings } = scenario('S14', { hospital: 'DEA', date: '2026-09-01', slotKey: 'M' }, { hospital: 'DEA', date: '2026-09-01', slotKey: 'M' });
  eq(assignments.length, 1, 'S14: nome ripetuto nella stessa cella → un\'unica assegnazione');
  eq(findings.length, 0, 'S14: nessun reperto con se stessi');
}

{
  // Notte l'ultimo giorno di settembre, Mattina il 1 ottobre: due Roster di mesi diversi,
  // il confine di mese non deve rompere il calcolo del riposo.
  const sept = buildRoster('DEA', [{ hospital: 'DEA', date: '2026-09-30', slotKey: 'N', names: ['S15'] }]);
  const oct = buildRoster('DEA', [{ hospital: 'DEA', date: '2026-10-01', slotKey: 'M', names: ['S15'] }]);
  const assignments = TurniRules.buildAssignments([sept, oct]);
  const findings = TurniRules.computeFindings(assignments);
  eq(findings.length, 1, 'S15: notte-attaccata tra fine settembre e inizio ottobre');
  eq(findings[0].kind, 'notte-attaccata', 'S15: kind');
  eq(findings[0].restMin, 0, 'S15: riposo 0 attraverso il confine di mese');
}

{
  // Una coppia a più di 48 h di distanza non va mai valutata, anche se (con uno slot
  // fittizio dalla durata assurda) l'intersezione degli orari sarebbe positiva.
  const bogusSlot = { key: 'X', label: 'FITTIZIO', header: 'FITTIZIO', sub: '', roles: [], start: '00:00', end: '02:00', startMin: 0, endMin: 100000, col: 'Z' };
  const rosterA = {
    file: 'synthetic', sheet: 'synthetic', hospital: 'DEA', title: '', periodLabel: '', month: '2026-09',
    slots: [bogusSlot], days: [{ day: 1, date: '2026-09-01', weekdayLabel: '', weekdayOk: true, cells: { X: { raw: 'S16', names: ['S16'] } } }], warnings: [],
  };
  const rosterB = buildRoster('DEA', [{ hospital: 'DEA', date: '2026-09-04', slotKey: 'M', names: ['S16'] }]);
  const assignments = TurniRules.buildAssignments([rosterA, rosterB]);
  eq(assignments.length, 2, 'S16: due assegnazioni a 3 giorni di distanza');
  const diff = assignments[1].startAbs - assignments[0].startAbs;
  ok(diff >= 48 * 60, 'S16: le due assegnazioni distano almeno 48 h');
  const bogusOverlap = Math.min(assignments[0].endAbs, assignments[1].endAbs) - Math.max(assignments[0].startAbs, assignments[1].startAbs);
  ok(bogusOverlap > 0, 'S16: lo slot fittizio produce davvero una sovrapposizione (per verificare che il filtro delle 48h la scarti)');
  const findings = TurniRules.computeFindings(assignments);
  eq(findings.length, 0, 'S16: oltre le 48 h la coppia non viene mai valutata, nonostante la sovrapposizione fittizia');
}

{
  // Più persone insieme: nessuna coppia deve comparire due volte, e l'ordinamento
  // (severità desc, poi a.startAbs asc, poi persona asc) deve valere sull'intero elenco.
  const rDEA = buildRoster('DEA', [
    { hospital: 'DEA', date: '2026-09-01', slotKey: 'M', names: ['AAA', 'BBB'] },
    { hospital: 'DEA', date: '2026-09-01', slotKey: 'N', names: ['BBB'] },
    { hospital: 'DEA', date: '2026-09-01', slotKey: 'M', names: ['CCC'] },
    { hospital: 'DEA', date: '2026-09-01', slotKey: 'M', names: ['DDD'] },
    { hospital: 'DEA', date: '2026-09-01', slotKey: 'P', names: ['DDD'] },
    { hospital: 'DEA', date: '2026-09-01', slotKey: 'N', names: ['DDD'] },
  ]);
  const rOSG = buildRoster('OSG', [
    { hospital: 'OSG', date: '2026-09-01', slotKey: 'M', names: ['AAA'] },
    { hospital: 'OSG', date: '2026-09-01', slotKey: 'P', names: ['CCC'] },
  ]);
  const assignments = TurniRules.buildAssignments([rDEA, rOSG]);
  const findings = TurniRules.computeFindings(assignments);
  // AAA: conflitto DEA/OSG M (severità 3). BBB: Mattina→Notte (severità 2). DDD: Mattina→Notte
  // e Pomeriggio→Notte (severità 2, Mattina→Pomeriggio stesso ospedale non conta). CCC: cambio
  // sede Mattina DEA → Pomeriggio OSG (severità 1). Totale atteso: 5 reperti.
  eq(findings.length, 5, 'multi-persona: 5 reperti attesi');
  const pairKeys = findings.map((f) => f.a.id + '→' + f.b.id);
  eq(new Set(pairKeys).size, pairKeys.length, 'multi-persona: nessuna coppia ripetuta');
  for (let i = 1; i < findings.length; i++) {
    const prev = findings[i - 1], cur = findings[i];
    ok(prev.severity >= cur.severity, 'multi-persona: severità non crescente');
    if (prev.severity === cur.severity) {
      ok(prev.a.startAbs <= cur.a.startAbs, 'multi-persona: a parità di severità, a.startAbs non decrescente');
    }
  }
  eq(findings[0].person, 'AAA', 'multi-persona: il conflitto (severità 3) è primo');
  eq(findings[findings.length - 1].person, 'CCC', 'multi-persona: il cambio-sede (severità 1) è ultimo');
}

// ======================================================================
// 4. analyzeNames
// ======================================================================

const realNames = TurniRules.analyzeNames(realAssignments);
eq(realNames.length, 39, 'analyzeNames: 39 nomi nei dati reali');
deepEq(realNames, NAMES_EXPECTED, 'analyzeNames: combacia esattamente con l\'oracolo (name/count/byHospital/nights/suspicion)');

{
  const orlanditoskic = realNames.find((n) => n.name === 'ORLANDITOSKIC');
  ok(orlanditoskic, 'ORLANDITOSKIC presente');
  deepEq(orlanditoskic.suspicion, { kind: 'concat', parts: ['ORLANDI', 'TOSKIC'], suggestion: 'ORLANDI/TOSKIC' }, 'ORLANDITOSKIC: sospetto di concatenazione');
  const others = realNames.filter((n) => n.suspicion !== null);
  eq(others.length, 1, 'ORLANDITOSKIC è l\'unico nome sospetto nei dati reali');
}

// --- analyzeNames sintetico ---------------------------------------------

function nightlessAssignment(person, hospital) {
  return {
    id: 'x', person, hospital, date: '2026-09-01', day: 1, slotKey: 'M', slotLabel: 'MATTINA',
    slotStart: '08:00', slotEnd: '14:00', pos: 0, role: '', startAbs: 0, endAbs: 360, isNight: false,
  };
}
function repeatAssignment(person, hospital, times) {
  const out = [];
  for (let i = 0; i < times; i++) out.push(nightlessAssignment(person, hospital));
  return out;
}

{
  // Refuso raro ("FRANCESCON", 1 turno) accanto a un nome molto frequente ("FRANCESCONI", 12 turni).
  const assignments = [].concat(repeatAssignment('FRANCESCON', 'DEA', 1), repeatAssignment('FRANCESCONI', 'DEA', 12));
  const names = TurniRules.analyzeNames(assignments);
  const n = names.find((x) => x.name === 'FRANCESCON');
  deepEq(n.suspicion, { kind: 'similar', to: 'FRANCESCONI', distance: 1 }, 'FRANCESCON: refuso simile a FRANCESCONI (distanza 1)');
}
{
  // Nome corto (fold di lunghezza <= 5) a distanza 2 da un nome frequente: NON segnalato
  // (per i nomi corti il limite di distanza è 1, non 2).
  const assignments = [].concat(repeatAssignment('ABCDE', 'DEA', 1), repeatAssignment('ABXDF', 'DEA', 10));
  const names = TurniRules.analyzeNames(assignments);
  eq(TurniRules.fold('ABCDE').length, 5, 'ABCDE: fold lungo 5 (nome "corto")');
  eq(TurniRules.levenshtein('ABCDE', 'ABXDF'), 2, 'distanza ABCDE/ABXDF = 2');
  eq(names.find((x) => x.name === 'ABCDE').suspicion, null, 'nome corto a distanza 2 non è segnalato come simile');
}
{
  // Un nome con 3 turni non è mai segnalato come "similar", indipendentemente dalla distanza.
  const assignments = [].concat(repeatAssignment('FRANCESCOM', 'DEA', 3), repeatAssignment('FRANCESCONI', 'DEA', 30));
  const names = TurniRules.analyzeNames(assignments);
  eq(names.find((x) => x.name === 'FRANCESCOM').suspicion, null, 'nome con count 3 non è mai "similar"');
}
{
  // La concatenazione ha la precedenza sulla similitudine quando entrambe si applicherebbero.
  const assignments = [].concat(
    repeatAssignment('ROSSI', 'DEA', 5),
    repeatAssignment('VERDI', 'OSG', 5),
    repeatAssignment('ROSSIVERDI', 'DEA', 1),
    repeatAssignment('ROSSIVERDA', 'DEA', 20) // nome frequente e vicinissimo, per tentare "similar"
  );
  const names = TurniRules.analyzeNames(assignments);
  deepEq(
    names.find((x) => x.name === 'ROSSIVERDI').suspicion,
    { kind: 'concat', parts: ['ROSSI', 'VERDI'], suggestion: 'ROSSI/VERDI' },
    'ROSSIVERDI: la concatenazione vince sulla similitudine'
  );
}

// ======================================================================
// 5. searchNames sui nomi reali
// ======================================================================

function topNames(query, n) {
  return TurniRules.searchNames(query, realNames).slice(0, n === undefined ? 3 : n).map((x) => x.name);
}

eq(topNames('fl', 1)[0], 'FLORENZAN', '"fl" → FLORENZAN in testa');
eq(topNames('damore', 1)[0], "D'AMORE", '"damore" → D\'AMORE in testa');
eq(topNames('divita', 1)[0], 'DI VITA F.', '"divita" → "DI VITA F." in testa');
eq(topNames('vita', 1)[0], 'DI VITA F.', '"vita" → "DI VITA F." in testa');
{
  const res = TurniRules.searchNames('toskic', realNames).map((x) => x.name);
  eq(res[0], 'TOSKIC', '"toskic" → TOSKIC in testa');
  ok(res.indexOf('ORLANDITOSKIC') > res.indexOf('TOSKIC'), '"toskic" → ORLANDITOSKIC presente dopo TOSKIC');
}
eq(topNames('franc', 1)[0], 'FRANCESCONI', '"franc" → FRANCESCONI in testa');
eq(topNames('frencesc', 1)[0], 'FRANCESCONI', '"frencesc" → FRANCESCONI (fuzzy)');
{
  // Query corte: un solo errore tollerato, così "fla" non pesca KASO/PASTORE/MASTROLILLI.
  const res = TurniRules.searchNames('fla', realNames).map((x) => x.name);
  eq(res[0], 'FLORENZAN', '"fla" → FLORENZAN in testa');
  ok(res.indexOf('FRANCESCONI') !== -1, '"fla" → FRANCESCONI ammesso (una sola lettera diversa)');
  ok(res.indexOf('KASO') === -1 && res.indexOf('PASTORE') === -1 && res.indexOf('MASTROLILLI') === -1, '"fla" → niente KASO/PASTORE/MASTROLILLI');
}

{
  const all = realNames.slice().sort((a, b) => a.name.localeCompare(b.name, 'it')).map((n) => n.name);
  deepEq(TurniRules.searchNames('', realNames).map((n) => n.name), all, '"" → tutti i nomi in ordine alfabetico');
  deepEq(TurniRules.searchNames('   ', realNames).map((n) => n.name), all, '"   " → tutti i nomi in ordine alfabetico');
}
deepEq(TurniRules.searchNames('zzzz', realNames), [], '"zzzz" → nessun risultato');
eq(topNames("D'amòre", 1)[0], "D'AMORE", 'la query viene "foldata" (accenti/apostrofi/maiuscole ignorati)');

// ======================================================================
// 5b. personStats / hoursByName / formatHours / short
// ======================================================================

{
  const fl = TurniRules.personStats(realAssignments, 'FLORENZAN', '2026-09');
  deepEq(
    [fl.turni, fl.giornate, fl.mattine, fl.pomeriggi, fl.notti, fl.ambulatori, fl.dodici, fl.ore],
    [14, 2, 2, 3, 5, 0, 7, 114],
    'FLORENZAN: 14 turni, 2 giornate, 2 mattine, 3 pomeriggi, 5 notti, 7 turni da 12 h, 114 h'
  );
  deepEq(fl.oreByHospital, { DEA: 78, OSG: 36 }, 'FLORENZAN: ore per ospedale');
  deepEq([fl.giornateEq, fl.turniEq], [4.5, 9.5], 'FLORENZAN: 4,5G + 5N = 9,5 turni');

  // L'addizione è coerente con le ore per tutti: (giornate equivalenti + notti) × 12 = ore.
  const tuttiCoerenti = TurniRules.hoursByName(realAssignments, '2026-09')
    .every((s) => s.turniEq * 12 === s.ore);
  ok(tuttiCoerenti, 'per ogni nome: turni da 12 h × 12 = ore del mese');

  const br = TurniRules.personStats(realAssignments, 'BRAHAM', '2026-09');
  deepEq([br.turni, br.giornate, br.mattine, br.pomeriggi, br.notti, br.dodici, br.ore], [20, 4, 2, 5, 5, 9, 150], 'BRAHAM: conteggi di settembre');

  const none = TurniRules.personStats(realAssignments, 'NESSUNO', '2026-09');
  deepEq([none.turni, none.ore, none.dodici, none.oreByHospital], [0, 0, 0, {}], 'nome assente: tutto a zero');

  const all = TurniRules.hoursByName(realAssignments, '2026-09');
  eq(all.length, 39, 'hoursByName: 39 nomi');
  eq(all[0].person, 'FRANCESCONI', 'hoursByName: FRANCESCONI in testa');
  eq(all[0].ore, 168, 'hoursByName: FRANCESCONI 168 h (3 ambulatori contati come mattine)');
  ok(all.every((x, i) => i === 0 || all[i - 1].ore >= x.ore), 'hoursByName: ordinato per ore decrescenti');
  // 21 ambulatori contati come mattine da 6 h: 10 con il pomeriggio (giornate da 12 h, +1,5 h
  // ciascuna rispetto a 09:30–20) e 11 da soli (+0,5 h ciascuno rispetto a 09:30–15).
  eq(all.reduce((s, x) => s + x.ore, 0), 2862, 'hoursByName: somma delle ore di settembre');

  // Roster sintetici minimi per i casi limite.
  const synSlots = [
    { key: 'M', label: 'MATTINA', header: 'MATTINA 8-14', sub: '', roles: [], start: '08:00', end: '14:00', startMin: 480, endMin: 840, col: 'C' },
    { key: 'P', label: 'POMERIGGIO', header: 'POMERIGGIO 14-20', sub: '', roles: [], start: '14:00', end: '20:00', startMin: 840, endMin: 1200, col: 'E' },
    { key: 'N', label: 'NOTTE', header: 'NOTTE 20-08', sub: '', roles: [], start: '20:00', end: '08:00', startMin: 1200, endMin: 1920, col: 'F' },
    { key: 'A', label: 'AMBULATORIO CM', header: 'AMBULATORIO CM 09.30-15.00', sub: '', roles: [], start: '09:30', end: '15:00', startMin: 570, endMin: 900, col: 'G' },
  ];
  function synRoster(hospital, cellsByDay) {
    const dates = Object.keys(cellsByDay);
    return {
      file: hospital, sheet: 's', hospital, title: hospital, periodLabel: '', month: dates[0].slice(0, 7), slots: synSlots,
      days: dates.map((date) => ({
        day: Number(date.slice(8)), date, weekdayLabel: '', weekdayOk: true,
        cells: Object.fromEntries(synSlots.map((s) => [s.key, { raw: (cellsByDay[date][s.key] || []).join('/'), names: cellsByDay[date][s.key] || [] }])),
      })),
      warnings: [],
    };
  }

  // L'ambulatorio è una mattina a tutti gli effetti: con il pomeriggio fa una giornata da 12 h.
  const sA = TurniRules.personStats(TurniRules.buildAssignments([synRoster('DEA', { '2026-09-01': { A: ['X'], P: ['X'] } })]), 'X', '2026-09');
  deepEq([sA.giornate, sA.mattine, sA.pomeriggi, sA.ambulatori, sA.dodici, sA.ore], [1, 0, 0, 1, 1, 12], 'ambulatorio + pomeriggio = una giornata da 12 h');
  const sA2 = TurniRules.personStats(TurniRules.buildAssignments([synRoster('DEA', { '2026-09-01': { A: ['X'] } })]), 'X', '2026-09');
  deepEq([sA2.giornate, sA2.mattine, sA2.ambulatori, sA2.ore], [0, 1, 1, 6], 'ambulatorio da solo = una mattina da 6 h');
  const sA3 = TurniRules.personStats(TurniRules.buildAssignments([synRoster('DEA', { '2026-09-01': { M: ['X'], A: ['X'] } })]), 'X', '2026-09');
  deepEq([sA3.mattine, sA3.ore], [2, 6], 'mattina + ambulatorio lo stesso giorno: 2 mattine, 6 h reali');

  const asB = TurniRules.buildAssignments([synRoster('DEA', { '2026-09-01': { M: ['X'] } }), synRoster('OSG', { '2026-09-01': { P: ['X'] } })]);
  const sB = TurniRules.personStats(asB, 'X', '2026-09');
  deepEq([sB.giornate, sB.mattine, sB.pomeriggi, sB.dodici, sB.ore, sB.oreByHospital], [1, 0, 0, 1, 12, { DEA: 6, OSG: 6 }], 'mattina DEA + pomeriggio OSG = una giornata da 12 h');
  eq(TurniRules.computeFindings(asB)[0].short, 'mattina 1 DEA → pomeriggio 1 OSG · riposo 0 h', 'short del cambio sede');

  const asC = TurniRules.buildAssignments([synRoster('DEA', { '2026-09-01': { M: ['X'] } }), synRoster('OSG', { '2026-09-01': { M: ['X'] } })]);
  const sC = TurniRules.personStats(asC, 'X', '2026-09');
  deepEq([sC.giornate, sC.mattine, sC.ore], [0, 2, 6], 'due mattine sovrapposte: 2 mattine, 6 h reali');
  eq(TurniRules.computeFindings(asC)[0].short, 'mattina 1 DEA + mattina 1 OSG · stesso orario', 'short del conflitto');

  const asD = TurniRules.buildAssignments([synRoster('DEA', { '2026-09-30': { N: ['X'] } }), synRoster('DEA', { '2026-10-01': { M: ['X'] } })]);
  deepEq([TurniRules.personStats(asD, 'X', '2026-09').ore, TurniRules.personStats(asD, 'X', '2026-10').ore, TurniRules.personStats(asD, 'X').ore, TurniRules.personStats(asD, 'X').dodici],
    [12, 6, 18, 1], 'ore per mese e totali a cavallo del mese');
  eq(TurniRules.computeFindings(asD)[0].short, 'notte 30 set DEA → mattina 1 ott DEA · riposo 0 h', 'short a cavallo del mese: con il mese');

  deepEq(realFindings.map((f) => f.short), [
    'notte 17 OSG → mattina 18 OSG · riposo 0 h',
    'mattina 21 OSG → notte 21 OSG · riposo 6 h',
  ], 'short delle segnalazioni reali');

  eq(TurniRules.formatHours(114), '114 h', 'formatHours 114');
  eq(TurniRules.formatHours(10.5), '10,5 h', 'formatHours 10,5');
  eq(TurniRules.formatHours(0), '0 h', 'formatHours 0');
  eq(TurniRules.formatNumber(4.5), '4,5', 'formatNumber 4,5');
  eq(TurniRules.formatNumber(9), '9', 'formatNumber 9');
}

// ======================================================================
// 5b-bis. buildICS
// ======================================================================

{
  const ics = TurniRules.buildICS(realAssignments, 'FLORENZAN', '2026-09', { now: Date.UTC(2026, 8, 5, 18, 0) });
  const lines = ics.split('\r\n');
  ok(lines[0] === 'BEGIN:VCALENDAR' && lines[lines.length - 2] === 'END:VCALENDAR', 'ics: apre e chiude come un calendario');
  ok(ics.endsWith('\r\n') && !ics.includes('\n\n'), 'ics: righe separate da CRLF');
  const summaries = lines.filter((l) => l.startsWith('SUMMARY:')).map((l) => l.slice(8));
  const events = lines.filter((l) => l === 'BEGIN:VEVENT').length;
  eq(events, summaries.length, 'ics: un titolo per evento');

  // 14 turni, ma il 5 e il 20 sono mattina + pomeriggio: due eventi "Giornata" al posto di quattro.
  eq(events, 12, 'ics: 12 eventi per i 14 turni di FLORENZAN');
  eq(summaries.filter((s) => s === 'PS DEA Giornata').length, 0, 'ics: la sede si chiama SSG, non DEA');
  eq(summaries.filter((s) => s === 'PS SSG Giornata').length, 2, 'ics: due giornate intere');
  eq(summaries.filter((s) => s === 'PS SSG Notte').length + summaries.filter((s) => s === 'PS OSG Notte').length, 5, 'ics: cinque notti');
  ok(summaries.every((s) => /^PS (SSG|OSG) (Mattina|Pomeriggio|Giornata|Notte|Ambulatorio)$/.test(s)), 'ics: titoli nella forma "PS <sede> <fascia>"');

  // Orari veri, in ora legale (Roma = UTC+2 a settembre): giornata 8–20, notte 20–8.
  const block = (summary) => {
    const i = summaries.indexOf(summary);
    const starts = lines.filter((l) => l.startsWith('DTSTART:')).map((l) => l.slice(8));
    const ends = lines.filter((l) => l.startsWith('DTEND:')).map((l) => l.slice(6));
    return [starts[i], ends[i]];
  };
  deepEq(block('PS SSG Giornata'), ['20260905T060000Z', '20260905T180000Z'], 'ics: giornata 8–20 di Roma = 06–18 UTC');
  const nightIdx = summaries.indexOf('PS OSG Notte');
  deepEq(
    [lines.filter((l) => l.startsWith('DTSTART:')).map((l) => l.slice(8))[nightIdx],
     lines.filter((l) => l.startsWith('DTEND:')).map((l) => l.slice(6))[nightIdx]],
    ['20260901T180000Z', '20260902T060000Z'], 'ics: la notte scavalca la mezzanotte'
  );

  // Ambulatorio: da solo ha i suoi orari, con il pomeriggio diventa una giornata.
  const lo = TurniRules.buildICS(realAssignments, 'LOFFREDO', '2026-09', { now: 0 });
  const loSum = lo.split('\r\n').filter((l) => l.startsWith('SUMMARY:')).map((l) => l.slice(8));
  eq(loSum.filter((s) => s === 'PS SSG Giornata').length, 4, 'ics: ambulatorio + pomeriggio = giornata');
  eq(loSum.filter((s) => s === 'PS SSG Ambulatorio').length, 1, 'ics: l\'ambulatorio senza pomeriggio resta un evento a sé');
  const first = lo.split('\r\n').filter((l) => l.startsWith('DTSTART:'))[0];
  eq(first, 'DTSTART:20260901T073000Z', 'ics: la giornata che parte dall\'ambulatorio comincia alle 9:30');

  // In inverno l'ora di Roma è UTC+1: stessa fascia, istante diverso.
  const winter = TurniRules.buildICS(
    [{ person: 'X', hospital: 'DEA', date: '2026-01-07', day: 7, slotKey: 'M', slotLabel: 'MATTINA',
       slotStart: '08:00', slotEnd: '14:00', pos: 0, role: '', isNight: false,
       startAbs: TurniRules.dayIndex('2026-01-07') * 1440 + 480, endAbs: TurniRules.dayIndex('2026-01-07') * 1440 + 840, id: 'x' }],
    'X', '2026-01', { now: 0 });
  ok(winter.indexOf('DTSTART:20260107T070000Z') !== -1, 'ics: in inverno le 8 di Roma sono le 07 UTC');

  eq(TurniRules.buildICS(realAssignments, 'NESSUNO', '2026-09', { now: 0 }).indexOf('BEGIN:VEVENT'), -1, 'ics: nome assente, calendario vuoto');
}

// ======================================================================
// 5c. diffRosters
// ======================================================================

{
  const clone = (r) => JSON.parse(JSON.stringify(r));
  const same = TurniRules.diffRosters(OSG, clone(OSG));
  deepEq([same.changes.length, same.days], [0, 0], 'diff di due copie identiche: nessuna modifica');

  const v2 = clone(OSG);
  const cell = (day, key) => v2.days.find((d) => d.day === day).cells[key];
  cell(12, 'N').names = ['BOTTA', 'PELLEGATTA'];           // CAPRINI → PELLEGATTA (sostituzione)
  cell(17, 'M').names = ['DI PIETRO', 'PETRELLA', 'NOFF'];  // + NOFF
  cell(21, 'N').names = ['RAMONDINO'];                      // − BOULES
  cell(1, 'M').names = ['DI PIETRO', 'BRAHAM'];             // solo riordinati
  v2.days = v2.days.filter((d) => d.day !== 30);            // giorno 30 sparito dal nuovo file
  const diff = TurniRules.diffRosters(OSG, v2);
  deepEq(diff.changes.map((c) => [c.day, c.slotKey, c.kind]), [
    [1, 'M', 'reordered'], [12, 'N', 'replaced'], [17, 'M', 'added'], [21, 'N', 'removed'],
    [30, 'M', 'removed'], [30, 'P', 'removed'], [30, 'N', 'removed'],
  ], 'diff: righe in ordine di data, con il tipo giusto');
  deepEq([diff.days, diff.added, diff.removed, diff.replaced, diff.reordered], [5, 1, 4, 1, 1], 'diff: conteggi');
  const rep = diff.changes.find((c) => c.day === 12);
  deepEq([rep.removed, rep.added, rep.hospital, rep.slotLabel], [['CAPRINI'], ['PELLEGATTA'], 'OSG', 'NOTTE'], 'diff: sostituzione con tolti/aggiunti');
  const gone = diff.changes.find((c) => c.day === 30 && c.slotKey === 'M');
  deepEq([gone.before, gone.after], [['DI PIETRO', 'PETRELLA'], []], 'diff: giorno mancante confrontato con la cella vuota');

  // Fascia presente solo nel nuovo file (es. ambulatorio aggiunto all'OSG).
  const v3 = clone(OSG);
  v3.slots.push({ key: 'A', label: 'AMBULATORIO', header: 'AMBULATORIO 9-15', sub: '', roles: [], start: '09:00', end: '15:00', startMin: 540, endMin: 900, col: 'G' });
  v3.days.forEach((d) => { d.cells.A = { raw: '', names: [] }; });
  v3.days[0].cells.A = { raw: 'NOFF', names: ['NOFF'] };
  const d3 = TurniRules.diffRosters(OSG, v3);
  deepEq(d3.changes.map((c) => [c.day, c.slotKey, c.kind, c.added]), [[1, 'A', 'added', ['NOFF']]], 'diff: fascia nuova confrontata con il vuoto');
}

// ======================================================================
// 6. Helper di formattazione
// ======================================================================

eq(TurniRules.formatDate('2026-09-01'), 'mar 1 set', 'formatDate 2026-09-01');
eq(TurniRules.formatDate('2026-10-01'), 'gio 1 ott', 'formatDate 2026-10-01');

eq(TurniRules.timeRange({ start: '08:00', end: '14:00' }), '08–14', 'timeRange Mattina');
eq(TurniRules.timeRange({ start: '20:00', end: '08:00' }), '20–08', 'timeRange Notte');
eq(TurniRules.timeRange({ start: '09:30', end: '15:00' }), '09:30–15', 'timeRange Ambulatorio');

eq(TurniRules.formatRest(0), '0 h', 'formatRest 0');
eq(TurniRules.formatRest(360), '6 h', 'formatRest 360');
eq(TurniRules.formatRest(90), '1 h 30', 'formatRest 90');

eq(TurniRules.slotName('AMBULATORIO CM'), 'Ambulatorio CM', 'slotName Ambulatorio CM');
eq(TurniRules.slotName('MATTINA'), 'Mattina', 'slotName Mattina');

eq(TurniRules.fold("D'AMORE"), 'DAMORE', "fold D'AMORE");
eq(TurniRules.fold('DI VITA F.'), 'DIVITAF', 'fold DI VITA F.');

eq(TurniRules.levenshtein('kitten', 'sitting'), 3, 'levenshtein kitten/sitting');

// ======================================================================
// Riepilogo
// ======================================================================

console.log('\nReperti sui dati reali (' + realFindings.length + '):');
for (const f of realFindings) {
  console.log('  ' + f.person + ' — ' + f.title);
  console.log('    ' + f.detail);
}

console.log('\nok — ' + checks + ' assertions');
