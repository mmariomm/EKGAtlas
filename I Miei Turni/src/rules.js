// src/rules.js — "I Miei Turni": motore delle regole (nessuna dipendenza dal DOM).
//
// Prende in input i Roster prodotti da src/parser.js e calcola:
//   - buildAssignments: l'elenco piatto dei turni assegnati (una riga per persona/turno);
//   - computeFindings:  le anomalie tra turni della stessa persona (conflitti, notti
//                        attaccate, cambi di sede senza pausa);
//   - analyzeNames / searchNames: analisi e ricerca dei nomi (per intercettare refusi).
//
// Tutte le funzioni sono pure: nessun accesso al DOM, nessuna dipendenza esterna.

var TurniRules = (function () {
  'use strict';

  // ------------------------------------------------------------------
  // Costanti
  // ------------------------------------------------------------------

  var SEVERITY = { conflitto: 3, 'notte-attaccata': 2, 'cambio-sede': 1 };
  var KIND_LABEL = { conflitto: 'Conflitto', 'notte-attaccata': 'Notte attaccata', 'cambio-sede': 'Cambio sede' };

  var MINUTES_PER_DAY = 1440;
  var FORTYEIGHT_HOURS_MIN = 48 * 60;

  var WEEKDAY_SHORT_IT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']; // indicizzato su getUTCDay() (0 = domenica)
  var MONTH_SHORT_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

  // ------------------------------------------------------------------
  // Helper di base: date, testo
  // ------------------------------------------------------------------

  // Numero di giorni trascorsi dal 1970-01-01 (UTC) — calcolato sempre in UTC così
  // il risultato non dipende dal fuso orario della macchina che esegue il codice.
  function dayIndex(dateStr) {
    var parts = String(dateStr).split('-');
    var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  }

  // "2026-09-01" → "mar 1 set" (giorno della settimana e mese abbreviati in italiano, minuscoli, senza punto).
  function formatDate(dateStr) {
    var parts = String(dateStr).split('-');
    var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
    var dt = new Date(Date.UTC(y, m - 1, d));
    return WEEKDAY_SHORT_IT[dt.getUTCDay()] + ' ' + dt.getUTCDate() + ' ' + MONTH_SHORT_IT[dt.getUTCMonth()];
  }

  // 0 → "0 h"; 360 → "6 h"; 90 → "1 h 30" (ore intere + eventuali minuti).
  function formatRest(min) {
    var h = Math.floor(min / 60);
    var r = min % 60;
    return r === 0 ? (h + ' h') : (h + ' h ' + r);
  }

  // "MATTINA" → "Mattina"; "AMBULATORIO CM" → "Ambulatorio CM" (le sigle di due lettere
  // restano maiuscole, le altre parole diventano Title Case).
  function slotName(label) {
    var words = String(label).trim().split(/\s+/);
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length === 0) continue;
      out.push(w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    }
    return out.join(' ');
  }

  // "08:00" → "08"; "09:30" → "09:30" (i minuti a zero si tolgono, gli altri restano).
  function fmtClock(t) {
    return t.slice(-3) === ':00' ? t.slice(0, -3) : t;
  }

  // Accetta uno Slot ({start,end}) o un Assignment ({slotStart,slotEnd}):
  // "08–14", "20–08", "09:30–15" (trattino medio, ":00" tolto, ":30" mantenuto).
  function timeRange(x) {
    var start = x.start !== undefined ? x.start : x.slotStart;
    var end = x.end !== undefined ? x.end : x.slotEnd;
    return fmtClock(start) + '–' + fmtClock(end);
  }

  // NFD, via gli accenti, maiuscolo, via tutto ciò che non è A-Z: "D'AMORE" → "DAMORE",
  // "DI VITA F." → "DIVITAF". Usato per confrontare nomi ignorando accenti/apostrofi/spazi.
  function fold(s) {
    return String(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
  }

  // Distanza di Levenshtein (numero minimo di inserimenti/cancellazioni/sostituzioni).
  function levenshtein(a, b) {
    a = String(a);
    b = String(b);
    var m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    var prev = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      var cur = new Array(n + 1);
      cur[0] = i;
      var ca = a.charAt(i - 1);
      for (j = 1; j <= n; j++) {
        var cost = ca === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[n];
  }

  // ------------------------------------------------------------------
  // buildAssignments
  // ------------------------------------------------------------------

  // Trasforma i Roster in un elenco piatto di Assignment: un elemento per ogni
  // persona effettivamente presente in una cella (i nomi ripetuti nella stessa
  // cella contano una volta sola, alla loro prima posizione).
  function buildAssignments(rosters) {
    var out = [];
    for (var r = 0; r < rosters.length; r++) {
      var roster = rosters[r];
      var slots = roster.slots || [];
      var days = roster.days || [];
      for (var d = 0; d < days.length; d++) {
        var day = days[d];
        var cells = day.cells || {};
        for (var s = 0; s < slots.length; s++) {
          var slot = slots[s];
          var cell = cells[slot.key];
          if (!cell) continue;
          var names = cell.names || [];
          var seen = Object.create(null);
          var di = dayIndex(day.date);
          for (var pos = 0; pos < names.length; pos++) {
            var name = names[pos];
            if (seen[name]) continue;
            seen[name] = true;
            out.push({
              id: roster.hospital + '|' + day.date + '|' + slot.key + '|' + pos,
              person: name,
              hospital: roster.hospital,
              date: day.date,
              day: day.day,
              slotKey: slot.key,
              slotLabel: slot.label,
              slotStart: slot.start,
              slotEnd: slot.end,
              pos: pos,
              role: (slot.roles && slot.roles[pos]) || '',
              startAbs: di * MINUTES_PER_DAY + slot.startMin,
              endAbs: di * MINUTES_PER_DAY + slot.endMin,
              isNight: slot.key === 'N',
            });
          }
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // computeFindings — tre regole, una funzione ciascuna
  // ------------------------------------------------------------------

  function piece(a) {
    return slotName(a.slotLabel) + ' ' + a.hospital + ' ' + timeRange(a);
  }

  // Dettaglio di un conflitto: stessa data → un'unica data in fondo; date diverse →
  // ciascuna data accanto al proprio turno.
  function conflittoDetail(a, b) {
    if (a.date === b.date) {
      return piece(a) + ' e ' + piece(b) + ' · ' + formatDate(a.date);
    }
    return piece(a) + ' ' + formatDate(a.date) + ' e ' + piece(b) + ' ' + formatDate(b.date);
  }

  // Dettaglio di notte-attaccata / cambio-sede: sempre in sequenza (a → b), con il
  // riposo residuo in fondo.
  function sequenceDetail(a, b, restMin) {
    return piece(a) + ' ' + formatDate(a.date) + ' → ' + piece(b) + ' ' + formatDate(b.date) +
      ' · riposo ' + formatRest(restMin);
  }

  // Forma breve di un turno per le segnalazioni schematiche: "notte 17 OSG".
  // Il mese compare solo quando i due turni della coppia stanno in mesi diversi.
  function shortPiece(a, withMonth) {
    var parts = String(a.date).split('-');
    var day = Number(parts[2]);
    var label = slotName(a.slotLabel).toLowerCase().replace(/^ambulatorio\b.*/, 'ambulatorio');
    var when = withMonth ? day + ' ' + MONTH_SHORT_IT[Number(parts[1]) - 1] : String(day);
    return label + ' ' + when + ' ' + a.hospital;
  }

  // "mattina 5 DEA + mattina 5 OSG · stesso orario" / "notte 17 OSG → mattina 18 OSG · riposo 0 h"
  function shortText(a, b, joiner, tail) {
    var withMonth = a.date.slice(0, 7) !== b.date.slice(0, 7);
    return shortPiece(a, withMonth) + ' ' + joiner + ' ' + shortPiece(b, withMonth) + ' · ' + tail;
  }

  // Regola "conflitto": due turni della stessa persona si sovrappongono nel tempo.
  // In ospedali diversi qualunque sovrapposizione conta; nello stesso ospedale conta
  // solo se supera i 60 minuti (altrimenti è un normale passaggio di consegne).
  function checkConflitto(person, a, b, overlap) {
    if (a.hospital === b.hospital && a.date === b.date && a.slotKey === b.slotKey) return null; // stesso turno: non dovrebbe accadere dopo la deduplica
    var sameHospital = a.hospital === b.hospital;
    if (sameHospital && overlap <= 60) return null; // passaggio di consegne nello stesso PS
    return {
      kind: 'conflitto',
      severity: SEVERITY.conflitto,
      person: person,
      a: a,
      b: b,
      overlapMin: overlap,
      date: a.date,
      title: sameHospital ? 'Doppio incarico nello stesso ospedale' : 'Stesso orario in due ospedali',
      detail: conflittoDetail(a, b),
      short: shortText(a, b, '+', sameHospital ? 'doppio incarico' : 'stesso orario'),
    };
  }

  // Regola "notte-attaccata": una notte è troppo vicina (meno di 11 ore di riposo) a un
  // turno diurno, prima o dopo, in qualsiasi ospedale.
  function checkNotteAttaccata(person, a, b, rest) {
    if (a.isNight === b.isNight) return null; // servono una notte e un turno diurno
    if (!(rest >= 0 && rest < 660)) return null;
    return {
      kind: 'notte-attaccata',
      severity: SEVERITY['notte-attaccata'],
      person: person,
      a: a,
      b: b,
      restMin: rest,
      date: a.date,
      title: rest === 0 ? 'Notte attaccata a un turno diurno' : 'Riposo breve intorno alla notte',
      detail: sequenceDetail(a, b, rest),
      short: shortText(a, b, '→', 'riposo ' + formatRest(rest)),
    };
  }

  // Regola "cambio-sede": due turni diurni in ospedali diversi con meno di 60 minuti di
  // pausa tra loro (turni diurni consecutivi nello stesso ospedale sono un unico turno,
  // non un'anomalia).
  function checkCambioSede(person, a, b, rest) {
    if (a.isNight || b.isNight) return null;
    if (a.hospital === b.hospital) return null;
    if (!(rest >= 0 && rest < 60)) return null;
    return {
      kind: 'cambio-sede',
      severity: SEVERITY['cambio-sede'],
      person: person,
      a: a,
      b: b,
      restMin: rest,
      date: a.date,
      title: 'Cambio di sede senza pausa',
      detail: sequenceDetail(a, b, rest),
      short: shortText(a, b, '→', 'riposo ' + formatRest(rest)),
    };
  }

  function evaluatePair(person, a, b) {
    var overlap = Math.min(a.endAbs, b.endAbs) - Math.max(a.startAbs, b.startAbs);
    if (overlap > 0) return checkConflitto(person, a, b, overlap);
    var rest = b.startAbs - a.endAbs;
    return checkNotteAttaccata(person, a, b, rest) || checkCambioSede(person, a, b, rest);
  }

  function comparePersonAssignments(x, y) {
    if (x.startAbs !== y.startAbs) return x.startAbs - y.startAbs;
    if (x.date !== y.date) return x.date < y.date ? -1 : 1;
    if (x.hospital !== y.hospital) return x.hospital < y.hospital ? -1 : 1;
    return 0;
  }

  // Confronta ogni coppia di turni della stessa persona la cui distanza tra gli orari di
  // inizio è inferiore a 48 ore (n è piccolo: un confronto O(n²) per persona va benissimo).
  function computeFindings(assignments) {
    var byPerson = new Map();
    for (var i = 0; i < assignments.length; i++) {
      var a = assignments[i];
      var list = byPerson.get(a.person);
      if (!list) { list = []; byPerson.set(a.person, list); }
      list.push(a);
    }

    var findings = [];
    byPerson.forEach(function (listRaw, person) {
      var list = listRaw.slice().sort(comparePersonAssignments);
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var pa = list[i], pb = list[j];
          if (pb.startAbs - pa.startAbs >= FORTYEIGHT_HOURS_MIN) continue; // troppo lontani nel tempo: non si confrontano
          var finding = evaluatePair(person, pa, pb);
          if (finding) findings.push(finding);
        }
      }
    });

    findings.sort(function (f, g) {
      if (f.severity !== g.severity) return g.severity - f.severity;
      if (f.a.startAbs !== g.a.startAbs) return f.a.startAbs - g.a.startAbs;
      return f.person.localeCompare(g.person, 'it');
    });
    return findings;
  }

  // ------------------------------------------------------------------
  // personStats / hoursByName — conteggi e ore di una persona
  // ------------------------------------------------------------------

  // Somma le durate dell'unione degli intervalli [startAbs, endAbs): un turno
  // mattina + pomeriggio vale 12 h, ambulatorio + pomeriggio 10 h 30 (l'ora in
  // comune conta una volta sola), due turni sovrapposti in due ospedali contano
  // il tempo reale, non il doppio.
  function unionMinutes(list) {
    var sorted = list.slice().sort(function (x, y) { return x.startAbs - y.startAbs; });
    var total = 0, curStart = null, curEnd = null;
    for (var i = 0; i < sorted.length; i++) {
      var a = sorted[i];
      if (curEnd === null || a.startAbs > curEnd) {
        if (curEnd !== null) total += curEnd - curStart;
        curStart = a.startAbs; curEnd = a.endAbs;
      } else if (a.endAbs > curEnd) {
        curEnd = a.endAbs;
      }
    }
    if (curEnd !== null) total += curEnd - curStart;
    return total;
  }

  // 4.5 → "4,5"; 9 → "9" (virgola decimale italiana, mezzi turni compresi).
  function formatNumber(value) {
    var rounded = Math.round(value * 2) / 2;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  }

  // 114 → "114 h"; 10.5 → "10,5 h".
  function formatHours(hours) {
    return formatNumber(hours) + ' h';
  }

  // L'ambulatorio conta come una mattina a tutti gli effetti: nei conteggi è una
  // "M", con il pomeriggio fa una giornata, e vale le 6 ore di una mattina (08–14).
  var MORNING_START = 8 * 60, MORNING_END = 14 * 60;
  function asMorningIfAmbulatorio(a) {
    if (a.slotKey !== 'A') return a;
    var base = dayIndex(a.date) * MINUTES_PER_DAY;
    return { person: a.person, hospital: a.hospital, date: a.date, slotKey: 'M', isNight: false,
      startAbs: base + MORNING_START, endAbs: base + MORNING_END };
  }

  // Conteggi di una persona (nel mese "YYYY-MM" se indicato, altrimenti su tutto):
  // giornata = mattina + pomeriggio nello stesso giorno (anche in due ospedali);
  // mattine e pomeriggi da soli si contano a parte; "dodici" = giornate + notti;
  // le ore sono l'unione reale degli orari (l'ambulatorio come una mattina).
  function personStats(assignments, person, month) {
    var mine = [];
    var ambulatori = 0;
    for (var i = 0; i < assignments.length; i++) {
      var a = assignments[i];
      if (a.person !== person) continue;
      if (month && a.date.slice(0, 7) !== month) continue;
      if (a.slotKey === 'A') ambulatori++;
      mine.push(asMorningIfAmbulatorio(a));
    }
    var byDate = new Map();
    var counts = { M: 0, P: 0, N: 0, other: 0 };
    var byHospital = {};
    for (i = 0; i < mine.length; i++) {
      a = mine[i];
      var key = counts.hasOwnProperty(a.slotKey) && a.slotKey !== 'other' ? a.slotKey : 'other';
      counts[key]++;
      var d = byDate.get(a.date);
      if (!d) { d = { M: 0, P: 0 }; byDate.set(a.date, d); }
      if (a.slotKey === 'M') d.M++;
      if (a.slotKey === 'P') d.P++;
      if (!byHospital[a.hospital]) byHospital[a.hospital] = [];
      byHospital[a.hospital].push(a);
    }
    var giornate = 0, mattine = 0, pomeriggi = 0;
    byDate.forEach(function (d) {
      var g = d.M > 0 && d.P > 0 ? 1 : 0;
      giornate += g;
      mattine += d.M - g;
      pomeriggi += d.P - g;
    });
    var oreMin = unionMinutes(mine);
    var oreByHospital = {};
    Object.keys(byHospital).forEach(function (h) { oreByHospital[h] = unionMinutes(byHospital[h]) / 60; });
    return {
      person: person,
      turni: mine.length,
      giornate: giornate,
      mattine: mattine,
      pomeriggi: pomeriggi,
      notti: counts.N,
      ambulatori: ambulatori,        // già compresi nelle mattine: solo informativo
      altri: counts.other,
      dodici: giornate + counts.N,
      // Addizione che si legge da sola: una mattina o un pomeriggio da soli valgono
      // mezza giornata, così "4,5G + 5N = 9,5" e 9,5 × 12 = le 114 ore del mese.
      giornateEq: giornate + (mattine + pomeriggi) / 2,
      turniEq: giornate + (mattine + pomeriggi) / 2 + counts.N,
      oreMin: oreMin,
      ore: oreMin / 60,
      oreByHospital: oreByHospital,
    };
  }

  // Ore totali di tutti i nomi (nel mese se indicato), dal più carico al meno.
  function hoursByName(assignments, month) {
    var seen = new Map();
    for (var i = 0; i < assignments.length; i++) {
      var a = assignments[i];
      if (month && a.date.slice(0, 7) !== month) continue;
      if (!seen.has(a.person)) seen.set(a.person, true);
    }
    var out = [];
    seen.forEach(function (_, person) { out.push(personStats(assignments, person, month)); });
    out.sort(function (x, y) {
      if (x.ore !== y.ore) return y.ore - x.ore;
      return x.person.localeCompare(y.person, 'it');
    });
    return out;
  }

  // ------------------------------------------------------------------
  // buildICS — i turni di una persona come file di calendario
  // ------------------------------------------------------------------

  // Come si chiama la sede negli eventi del calendario. Il foglio dice DEA e OSG;
  // sul calendario si legge il luogo: Sesto San Giovanni e San Giuseppe.
  var SITE_LABEL = { DEA: 'SSG', OSG: 'OSG' };

  // Fuso di Roma senza tabelle: si chiede al motore Intl che ora locale corrisponde
  // a un certo istante e si corregge lo scarto (due passate coprono anche i cambi d'ora).
  function romeOffsetMinutes(utcMs) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Rome', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(utcMs));
    var p = {};
    parts.forEach(function (x) { p[x.type] = x.value; });
    var asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
    return (asUtc - utcMs) / 60000;
  }

  // Minuti dall'inizio del giorno "date" (ora di Roma) → istante UTC.
  function romeToUtc(date, minutes) {
    var parts = String(date).split('-');
    var guess = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) + minutes * 60000;
    var utc = guess - romeOffsetMinutes(guess) * 60000;
    return guess - romeOffsetMinutes(utc) * 60000;
  }

  function icsStamp(utcMs) {
    var d = new Date(utcMs);
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return String(d.getUTCFullYear()) + two(d.getUTCMonth() + 1) + two(d.getUTCDate()) + 'T' +
      two(d.getUTCHours()) + two(d.getUTCMinutes()) + '00Z';
  }

  function icsEscape(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  // Righe piegate a 75 ottetti, come vuole il formato iCalendar.
  function icsFold(line) {
    if (line.length <= 75) return line;
    var out = line.slice(0, 75);
    var rest = line.slice(75);
    while (rest.length > 74) { out += '\r\n ' + rest.slice(0, 74); rest = rest.slice(74); }
    return out + '\r\n ' + rest;
  }

  // Un giorno, un ospedale: i turni diurni attaccati diventano un evento solo
  // ("Giornata" quando c'è sia il mattino sia il pomeriggio), la notte resta a sé.
  function icsEventsOfDay(list) {
    var nights = list.filter(function (a) { return a.isNight; });
    var days = list.filter(function (a) { return !a.isNight; })
      .sort(function (x, y) { return x.startAbs - y.startAbs; });
    var events = [];
    nights.forEach(function (a) { events.push({ name: 'Notte', from: a, startAbs: a.startAbs, endAbs: a.endAbs }); });
    var group = null;
    days.forEach(function (a) {
      if (group && a.startAbs <= group.endAbs) {
        group.endAbs = Math.max(group.endAbs, a.endAbs);
        group.keys.push(a.slotKey);
        return;
      }
      group = { keys: [a.slotKey], from: a, startAbs: a.startAbs, endAbs: a.endAbs };
      events.push(group);
    });
    events.forEach(function (ev) {
      if (ev.name) return;
      var morning = ev.keys.indexOf('M') !== -1 || ev.keys.indexOf('A') !== -1;
      var afternoon = ev.keys.indexOf('P') !== -1;
      // L'ambulatorio è una mattina a tutti gli effetti, con i suoi orari veri.
      ev.name = morning && afternoon ? 'Giornata' : afternoon ? 'Pomeriggio' : 'Mattina';
    });
    return events;
  }

  // File .ics con i turni di una persona (di un mese, o di tutti se month è vuoto).
  // Gli eventi si chiamano "PS SSG Mattina", "PS OSG Notte", … con gli orari veri.
  function buildICS(assignments, person, month, options) {
    var opts = options || {};
    var stamp = icsStamp(opts.now === undefined ? Date.now() : opts.now);
    var byDayHospital = new Map();
    assignments.forEach(function (a) {
      if (a.person !== person) return;
      if (month && a.date.slice(0, 7) !== month) return;
      var key = a.date + '|' + a.hospital;
      if (!byDayHospital.has(key)) byDayHospital.set(key, []);
      byDayHospital.get(key).push(a);
    });

    var events = [];
    Array.from(byDayHospital.keys()).sort().forEach(function (key) {
      var list = byDayHospital.get(key);
      var hospital = list[0].hospital;
      var site = SITE_LABEL[hospital] || hospital;
      icsEventsOfDay(list).forEach(function (ev) {
        var base = dayIndex(ev.from.date) * MINUTES_PER_DAY;
        events.push({
          uid: ev.from.date + '-' + hospital + '-' + ev.name.toLowerCase() + '-' +
            fold(person).toLowerCase() + '@imieiturni',
          summary: 'PS ' + site + ' ' + ev.name,
          start: romeToUtc(ev.from.date, ev.startAbs - base),
          end: romeToUtc(ev.from.date, ev.endAbs - base),
        });
      });
    });
    events.sort(function (x, y) { return x.start - y.start; });

    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//I Miei Turni//IT', 'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH', 'X-WR-CALNAME:' + icsEscape('Turni ' + person),
    ];
    events.forEach(function (ev) {
      lines.push('BEGIN:VEVENT', 'UID:' + ev.uid, 'DTSTAMP:' + stamp,
        'DTSTART:' + icsStamp(ev.start), 'DTEND:' + icsStamp(ev.end),
        'SUMMARY:' + icsEscape(ev.summary), 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------
  // diffRosters — cosa cambia tra due versioni dello stesso mese
  // ------------------------------------------------------------------

  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function minus(a, b) {
    return a.filter(function (x) { return b.indexOf(x) === -1; });
  }

  // Confronta cella per cella (giorno × fascia) il roster vecchio con il nuovo.
  // Ogni differenza è una riga: nomi tolti, aggiunti, sostituiti (uno al posto di
  // un altro) o solo riordinati (la posizione nella cella è il ruolo). Le fasce
  // o i giorni presenti in una sola versione si confrontano con la cella vuota.
  function diffRosters(oldRoster, newRoster) {
    var slotKeys = [];
    var slotLabel = {};
    [oldRoster, newRoster].forEach(function (r) {
      (r.slots || []).forEach(function (s) {
        if (slotKeys.indexOf(s.key) === -1) slotKeys.push(s.key);
        slotLabel[s.key] = slotLabel[s.key] || s.label;
      });
    });
    var byDate = new Map();
    function index(r, which) {
      (r.days || []).forEach(function (d) {
        var entry = byDate.get(d.date);
        if (!entry) { entry = { day: d.day, date: d.date }; byDate.set(d.date, entry); }
        entry[which] = d.cells || {};
      });
    }
    index(oldRoster, 'before');
    index(newRoster, 'after');

    var changes = [];
    var counts = { added: 0, removed: 0, replaced: 0, reordered: 0 };
    Array.from(byDate.keys()).sort().forEach(function (date) {
      var entry = byDate.get(date);
      slotKeys.forEach(function (key) {
        var before = (entry.before && entry.before[key] && entry.before[key].names) || [];
        var after = (entry.after && entry.after[key] && entry.after[key].names) || [];
        if (sameList(before, after)) return;
        var removed = minus(before, after);
        var added = minus(after, before);
        var kind = removed.length && added.length ? 'replaced'
          : added.length ? 'added'
          : removed.length ? 'removed'
          : 'reordered';
        counts[kind]++;
        changes.push({
          date: date, day: entry.day, hospital: newRoster.hospital || oldRoster.hospital,
          slotKey: key, slotLabel: slotLabel[key] || key,
          before: before, after: after, removed: removed, added: added, kind: kind,
        });
      });
    });
    var days = new Set(changes.map(function (c) { return c.date; })).size;
    return { changes: changes, days: days, added: counts.added, removed: counts.removed,
      replaced: counts.replaced, reordered: counts.reordered };
  }

  // ------------------------------------------------------------------
  // analyzeNames
  // ------------------------------------------------------------------

  // Un nome raro (al più 2 turni) è probabilmente due nomi concatenati per errore se il
  // suo testo, ripulito, è esattamente l'unione di altri due nomi frequenti (>= 2 turni).
  function findConcat(n, list) {
    var foldedN = fold(n.name);
    for (var i = 0; i < list.length; i++) {
      var A = list[i];
      if (A.name === n.name || A.count < 2) continue;
      var foldedA = fold(A.name);
      for (var j = 0; j < list.length; j++) {
        var B = list[j];
        if (B.name === n.name || B.name === A.name || B.count < 2) continue;
        if (foldedA + fold(B.name) === foldedN) return { A: A, B: B };
      }
    }
    return null;
  }

  // Un nome raro (al più 2 turni) è probabilmente un refuso di un nome molto più
  // frequente (almeno 3 volte più turni) se le due forme ripulite sono quasi identiche
  // (distanza di Levenshtein <= 2, o <= 1 se il nome è molto corto).
  function findSimilar(n, list) {
    var foldedN = fold(n.name);
    var limit = foldedN.length <= 5 ? 1 : 2;
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.name === n.name || o.count < 3 * n.count) continue;
      var d = levenshtein(foldedN, fold(o.name));
      if (d > limit) continue;
      if (!best || d < best.d || (d === best.d && o.count > best.o.count)) best = { d: d, o: o };
    }
    return best ? { kind: 'similar', to: best.o.name, distance: best.d } : null;
  }

  // Aggrega gli Assignment per persona (conteggio, per ospedale, notti) e segnala i nomi
  // sospetti: probabile concatenazione di due nomi, oppure probabile refuso di un nome
  // frequente.
  function analyzeNames(assignments) {
    var map = new Map();
    for (var i = 0; i < assignments.length; i++) {
      var a = assignments[i];
      var info = map.get(a.person);
      if (!info) {
        info = { name: a.person, count: 0, byHospital: {}, nights: 0, suspicion: null };
        map.set(a.person, info);
      }
      info.count++;
      info.byHospital[a.hospital] = (info.byHospital[a.hospital] || 0) + 1;
      if (a.isNight) info.nights++;
    }

    var list = Array.from(map.values());
    for (i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.count > 2) continue; // il sospetto si valuta solo sui nomi rari
      var concat = findConcat(n, list);
      if (concat) {
        n.suspicion = { kind: 'concat', parts: [concat.A.name, concat.B.name], suggestion: concat.A.name + '/' + concat.B.name };
        continue;
      }
      var similar = findSimilar(n, list);
      if (similar) n.suspicion = similar;
    }

    list.sort(function (x, y) { return x.name.localeCompare(y.name, 'it'); });
    return list;
  }

  // ------------------------------------------------------------------
  // searchNames
  // ------------------------------------------------------------------

  function wordsOf(name) {
    return String(name).split(/[\s'.]+/).filter(function (w) { return w.length > 0; });
  }

  function isSubsequence(needle, hay) {
    var i = 0;
    for (var j = 0; j < hay.length && i < needle.length; j++) {
      if (hay.charAt(j) === needle.charAt(i)) i++;
    }
    return i === needle.length;
  }

  // Punteggio di un nome rispetto a una query già "foldata": corrispondenza esatta,
  // prefisso, prefisso di una delle parole del nome, sottostringa, sottosequenza, e
  // infine un confronto approssimato (Levenshtein) per intercettare i refusi di ricerca.
  function matchScore(q, originalName, foldedName) {
    if (foldedName === q) return 1000;
    if (foldedName.indexOf(q) === 0) return 800;
    var words = wordsOf(originalName);
    for (var i = 0; i < words.length; i++) {
      if (fold(words[i]).indexOf(q) === 0) return 700;
    }
    if (foldedName.indexOf(q) !== -1) return 600;
    if (isSubsequence(q, foldedName)) return 400;
    // Refusi di digitazione: query corte tollerano un solo errore, altrimenti "fla"
    // pescherebbe anche KASO o PASTORE.
    var fuzzyLimit = q.length <= 5 ? 1 : 2;
    if (q.length >= 3 && levenshtein(q, foldedName.slice(0, q.length)) <= fuzzyLimit) return 300;
    return 0;
  }

  // Cerca tra i NameInfo per query testuale (accenti/apostrofi/maiuscole ignorati).
  // Query vuota o di soli spazi → tutti i nomi in ordine alfabetico.
  function searchNames(query, names) {
    var trimmed = String(query == null ? '' : query).trim();
    if (trimmed === '') {
      return names.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'it'); });
    }
    var q = fold(trimmed);
    if (!q) return [];

    var scored = [];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var score = matchScore(q, n.name, fold(n.name));
      if (score > 0) scored.push({ n: n, score: score });
    }
    scored.sort(function (x, y) {
      if (x.score !== y.score) return y.score - x.score;
      if (x.n.count !== y.n.count) return y.n.count - x.n.count;
      return x.n.name.localeCompare(y.n.name, 'it');
    });
    return scored.map(function (s) { return s.n; });
  }

  // ------------------------------------------------------------------
  // Esportazione
  // ------------------------------------------------------------------

  return {
    buildAssignments: buildAssignments,
    computeFindings: computeFindings,
    analyzeNames: analyzeNames,
    searchNames: searchNames,
    levenshtein: levenshtein,
    fold: fold,
    dayIndex: dayIndex,
    slotName: slotName,
    timeRange: timeRange,
    formatDate: formatDate,
    formatRest: formatRest,
    formatHours: formatHours,
    formatNumber: formatNumber,
    personStats: personStats,
    hoursByName: hoursByName,
    diffRosters: diffRosters,
    buildICS: buildICS,
    SITE_LABEL: SITE_LABEL,
    SEVERITY: SEVERITY,
    KIND_LABEL: KIND_LABEL,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TurniRules; else window.TurniRules = TurniRules;
