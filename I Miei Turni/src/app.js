/* =============================================================================
   I Miei Turni — interfaccia (vanilla JS, nessun modulo, nessuna dipendenza).
   Gira dopo TurniParser, TurniRules e window.TURNI_DATA.
   Schermata: calendario del mese + dettaglio del giorno scelto; sotto,
   segnalazioni, elenco dei nomi, dati.
   Ordine del file: costanti → aiutanti → stato → derivazione → render → eventi.
   ============================================================================= */
(function () {
  'use strict';

  var R = window.TurniRules;
  if (!R) return;

  // ---------------------------------------------------------------------------
  // Costanti
  // ---------------------------------------------------------------------------

  var LS_ROSTERS = 'imieiturni.rosters.v1';
  var LS_ME = 'imieiturni.me';
  var LS_VIEW = 'imieiturni.view';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  var WEEKDAYS_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì',
    'giovedì', 'venerdì', 'sabato'];
  var WEEKDAYS_SHORT_IT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

  // Ordine delle fasce: mattina, pomeriggio, notte, poi il resto.
  var SLOT_RANK = { M: 0, P: 1, N: 2 };

  var KIND_ORDER = ['conflitto', 'notte-attaccata', 'cambio-sede'];
  var KIND_PLURAL = {
    conflitto: ['conflitto', 'conflitti'],
    'notte-attaccata': ['notte attaccata', 'notti attaccate'],
    'cambio-sede': ['cambio sede', 'cambi sede'],
  };
  var LEGEND = [
    [3, 'Conflitto', 'stesso orario in due ospedali, oppure doppio incarico nello stesso ospedale (oltre 1 h di sovrapposizione: ambulatorio → pomeriggio è un passaggio di consegne, non un conflitto).'],
    [2, 'Notte attaccata', 'turno diurno subito prima o dopo una notte, con meno di 11 h di riposo.'],
    [1, 'Cambio sede', 'due turni diurni consecutivi in due ospedali diversi, senza pausa.'],
  ];

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------------------
  // Aiutanti DOM — tutto il testo passa da textContent, mai da innerHTML
  // ---------------------------------------------------------------------------

  function append(node, kids) {
    if (kids === null || kids === undefined || kids === false) return;
    if (Array.isArray(kids)) { kids.forEach(function (k) { append(node, k); }); return; }
    node.appendChild(kids.nodeType ? kids : document.createTextNode(String(kids)));
  }

  function el(tag, opts, kids) {
    var n = document.createElement(tag);
    if (opts) {
      Object.keys(opts).forEach(function (k) {
        var v = opts[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'on') Object.keys(v).forEach(function (e) { n.addEventListener(e, v[e]); });
        else if (k === 'data') Object.keys(v).forEach(function (d) { n.dataset[d] = v[d]; });
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, v);
      });
    }
    append(n, kids);
    return n;
  }

  function icon(id, cls) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------------------
  // Aiutanti di formato
  // ---------------------------------------------------------------------------

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function monthName(m) { return MONTHS_IT[Number(String(m).slice(5, 7)) - 1] || m; }
  function monthLabel(m) { return capitalize(monthName(m)) + ' ' + String(m).slice(0, 4); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function weekdayOf(dateStr) {
    var p = String(dateStr).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  }
  function isWeekend(dateStr) { var d = weekdayOf(dateStr); return d === 0 || d === 6; }
  function weekdayLong(dateStr) { return WEEKDAYS_IT[weekdayOf(dateStr)]; }
  function dayNum(dateStr) { return Number(String(dateStr).slice(8, 10)); }
  function dateOf(month, day) { return month + '-' + pad2(day); }
  function monthLength(month) {
    var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // "AMBULATORIO CM" → "Amb. CM" (una riga sola nella colonna di sinistra).
  function shortSlotName(label) {
    return R.slotName(label).replace(/^Ambulatorio\b/, 'Amb.');
  }

  function hospClass(h) { return h === 'DEA' ? 'h-dea' : (h === 'OSG' ? 'h-osg' : 'h-alt'); }

  function suspicionText(s) {
    if (!s) return '';
    return s.kind === 'concat' ? 'forse ' + s.suggestion + '?' : 'simile a ' + s.to;
  }

  // Divide un nome in tre parti attorno alla porzione che combacia con la query
  // (indici calcolati carattere per carattere, così accenti e apostrofi non sballano).
  function matchParts(name, query) {
    var q = R.fold(query);
    if (!q) return null;
    var folded = '', idx = [];
    for (var i = 0; i < name.length; i++) {
      var ch = name.charAt(i).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
      for (var k = 0; k < ch.length; k++) { folded += ch.charAt(k); idx.push(i); }
    }
    var at = folded.indexOf(q);
    if (at === -1) return null;
    return [name.slice(0, idx[at]), name.slice(idx[at], idx[at + q.length - 1] + 1), name.slice(idx[at + q.length - 1] + 1)];
  }

  // ---------------------------------------------------------------------------
  // Memoria del browser (sempre in try/catch: la pagina funziona anche senza)
  // ---------------------------------------------------------------------------

  function readLocal() {
    try {
      var raw = window.localStorage.getItem(LS_ROSTERS);
      var parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function writeLocal(list) {
    try {
      if (!list.length) window.localStorage.removeItem(LS_ROSTERS);
      else window.localStorage.setItem(LS_ROSTERS, JSON.stringify(list));
      return true;
    } catch (e) { return false; }
  }

  function readMe() {
    try { return window.localStorage.getItem(LS_ME) || null; } catch (e) { return null; }
  }

  function writeMe(name) {
    try {
      if (name) window.localStorage.setItem(LS_ME, name);
      else window.localStorage.removeItem(LS_ME);
    } catch (e) { /* niente memoria: pazienza */ }
  }

  function readView() {
    try { return window.localStorage.getItem(LS_VIEW) === 'tabella' ? 'tabella' : 'calendario'; }
    catch (e) { return 'calendario'; }
  }

  function writeView(v) {
    try { window.localStorage.setItem(LS_VIEW, v); } catch (e) { /* pazienza */ }
  }

  // ---------------------------------------------------------------------------
  // Stato
  // ---------------------------------------------------------------------------

  var BAKED = (window.TURNI_DATA && window.TURNI_DATA.rosters) || [];
  var GENERATED_AT = (window.TURNI_DATA && window.TURNI_DATA.generatedAt) || '';

  var state = {
    month: '',
    view: 'calendario',
    selected: '',
    query: '',
    armedIndex: 0,
    pinned: null,
    findingsAll: false,
    popOpen: false,
  };

  var local = readLocal();
  var D = {};                // vista derivata
  var nameEls = new Map();   // nome → elementi evidenziabili
  var painted = [];          // elementi attualmente evidenziati
  var options = [];          // righe dell'elenco candidati
  var calName = null;        // nome disegnato nel calendario (fissato o in anteprima)
  var tableWidth = 0;        // larghezza con cui sono state calcolate le colonne

  // ---------------------------------------------------------------------------
  // Riferimenti al DOM
  // ---------------------------------------------------------------------------

  var topbar = $('topbar'), monthCtl = $('monthCtl'), findingsBtn = $('findingsBtn'), todayBtn = $('todayBtn'),
    searchBox = $('search'), input = $('q'), pintoken = $('pintoken'), clearBtn = $('clearBtn'), pop = $('pop'),
    segCal = $('segCal'), segTab = $('segTab'), viewCal = $('viewCal'), viewTab = $('viewTab'), tableWrap = $('tablewrap'),
    emptyEl = $('empty'), personLine = $('personline'), calEl = $('calendario'), legendEl = $('callegend'),
    detailEl = $('detail'), findEl = $('segnalazioni'), stripEl = $('strip'), datiEl = $('dati'), datiBody = $('datiBody'),
    fileInput = $('fileInput'), dropzone = $('dropzone'), toasts = $('toasts'), srStatus = $('srStatus');

  // ---------------------------------------------------------------------------
  // Derivazione della vista
  // ---------------------------------------------------------------------------

  function rosterKey(r) { return r.hospital + '|' + r.month; }

  function mergedRosters() {
    var map = new Map();
    BAKED.forEach(function (r) {
      var c = Object.assign({}, r); c.source = 'pubblicato'; map.set(rosterKey(c), c);
    });
    local.forEach(function (r) {
      var c = Object.assign({}, r); c.source = 'browser';
      c.replaces = map.has(rosterKey(c));
      map.set(rosterKey(c), c);
    });
    return Array.from(map.values());
  }

  function hospitalOrder(a, b) {
    var rank = function (h) { return h === 'DEA' ? 0 : (h === 'OSG' ? 1 : 2); };
    if (rank(a.hospital) !== rank(b.hospital)) return rank(a.hospital) - rank(b.hospital);
    return a.hospital.localeCompare(b.hospital, 'it');
  }

  function slotRank(key, fallback) {
    return SLOT_RANK[key] !== undefined ? SLOT_RANK[key] : 10 + fallback;
  }

  // Giorni con dati: unione dei giorni presenti nei roster dei due ospedali.
  function buildDays(rosters) {
    var map = new Map();
    rosters.forEach(function (r) {
      (r.days || []).forEach(function (d) {
        var rec = map.get(d.date);
        if (!rec) { rec = { day: d.day, date: d.date, cells: {} }; map.set(d.date, rec); }
        rec.cells[r.hospital] = d.cells || {};
      });
    });
    return Array.from(map.values()).sort(function (a, b) { return a.day - b.day; });
  }

  // Righe del dettaglio: unione delle fasce dei due ospedali, in ordine M, P, N, resto.
  function buildSlotRows(rosters) {
    var seen = new Map();
    rosters.forEach(function (r) {
      (r.slots || []).forEach(function (s) {
        if (!seen.has(s.key)) seen.set(s.key, { key: s.key, slot: s, order: seen.size });
      });
    });
    return Array.from(seen.values()).sort(function (a, b) {
      return slotRank(a.key, a.order) - slotRank(b.key, b.order);
    });
  }

  // Conteggi del mese mostrato; il sospetto di refuso arriva dall'analisi completa.
  function namesOfMonth(namesAll, assignments) {
    var map = new Map();
    assignments.forEach(function (a) {
      var i = map.get(a.person);
      if (!i) { i = { name: a.person, count: 0, byHospital: {}, nights: 0, amb: 0, suspicion: null }; map.set(a.person, i); }
      i.count++;
      i.byHospital[a.hospital] = (i.byHospital[a.hospital] || 0) + 1;
      if (a.isNight) i.nights++;
      if (a.slotKey === 'A') i.amb++;
    });
    namesAll.forEach(function (n) { var i = map.get(n.name); if (i) i.suspicion = n.suspicion; });
    return Array.from(map.values()).sort(function (a, b) { return a.name.localeCompare(b.name, 'it'); });
  }

  function derive() {
    var rosters = mergedRosters();
    D.rosters = rosters;
    D.months = Array.from(new Set(rosters.map(function (r) { return r.month; }))).sort();
    if (D.months.indexOf(state.month) === -1) state.month = defaultMonth();

    D.assignments = R.buildAssignments(rosters);
    D.findings = R.computeFindings(D.assignments);
    D.namesAll = R.analyzeNames(D.assignments);

    var m = state.month;
    D.monthRosters = rosters.filter(function (r) { return r.month === m; }).sort(hospitalOrder);
    D.hospitals = D.monthRosters.map(function (r) { return r.hospital; });
    D.monthAssignments = D.assignments.filter(function (a) { return a.date.slice(0, 7) === m; });
    D.names = namesOfMonth(D.namesAll, D.monthAssignments);
    D.nameMap = new Map(D.names.map(function (n) { return [n.name, n]; }));
    D.findingsOfMonth = D.findings.filter(function (f) {
      return f.a.date.slice(0, 7) === m || f.b.date.slice(0, 7) === m;
    });
    D.days = buildDays(D.monthRosters);
    D.dayByDate = new Map(D.days.map(function (d) { return [d.date, d]; }));
    D.slotRows = buildSlotRows(D.monthRosters);
    D.monthLen = m ? monthLength(m) : 0;
    D.today = todayISO();
    D.todayInMonth = !!m && D.today.slice(0, 7) === m;

    // Celle, nomi e giorni coinvolti in una segnalazione.
    D.cellFind = new Map();
    D.pillFind = new Map();
    D.dayFind = new Map();
    D.findByPerson = new Map();
    D.findingsOfMonth.forEach(function (f) {
      [f.a, f.b].forEach(function (a) {
        var ck = a.hospital + '|' + a.date + '|' + a.slotKey;
        var prev = D.cellFind.get(ck);
        if (!prev || f.severity > prev.severity) D.cellFind.set(ck, { severity: f.severity, title: f.title });
        var pk = ck + '|' + a.person;
        var arr = D.pillFind.get(pk) || []; arr.push(f); D.pillFind.set(pk, arr);
        var dprev = D.dayFind.get(a.date);
        if (!dprev || f.severity > dprev.severity) D.dayFind.set(a.date, { severity: f.severity, title: f.title });
      });
      var list = D.findByPerson.get(f.person) || []; list.push(f); D.findByPerson.set(f.person, list);
    });

    if (state.pinned && !D.nameMap.has(state.pinned)) state.pinned = null;
    if (!state.pinned) state.findingsAll = false;
    if (!validDay(state.selected)) state.selected = defaultDay();
  }

  function defaultMonth() {
    if (!D.months.length) return '';
    var t = todayISO().slice(0, 7);
    return D.months.indexOf(t) !== -1 ? t : D.months[D.months.length - 1];
  }

  function validDay(date) {
    if (!date || !state.month || date.slice(0, 7) !== state.month) return false;
    var n = dayNum(date);
    return n >= 1 && n <= D.monthLen;
  }

  function defaultDay() {
    if (!state.month) return '';
    return D.todayInMonth ? D.today : dateOf(state.month, 1);
  }

  // Turni di una persona, giorno per giorno, in ordine di fascia: le pastiglie del calendario.
  function chipsByDate(name) {
    var map = new Map();
    if (!name) return map;
    D.monthAssignments.forEach(function (a) {
      if (a.person !== name) return;
      var arr = map.get(a.date) || []; arr.push(a); map.set(a.date, arr);
    });
    map.forEach(function (arr) {
      arr.sort(function (x, y) {
        var rx = slotRank(x.slotKey, 0), ry = slotRank(y.slotKey, 0);
        if (rx !== ry) return rx - ry;
        return D.hospitals.indexOf(x.hospital) - D.hospitals.indexOf(y.hospital);
      });
    });
    return map;
  }

  // ---------------------------------------------------------------------------
  // Indirizzo (hash) — mese, nome, giorno
  // ---------------------------------------------------------------------------

  function readHash() {
    var h = String(window.location.hash || '').replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (part) {
      var eq = part.indexOf('=');
      if (eq === -1) return;
      var k = part.slice(0, eq), v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
      if (k === 'mese') state.month = v;
      else if (k === 'nome') state.pinned = v.toLocaleUpperCase('it-IT');
      else if (k === 'giorno') state.selected = v;
      else if (k === 'vista') state.view = v === 'tabella' ? 'tabella' : 'calendario';
    });
  }

  function syncHash() {
    var parts = [];
    if (state.month) parts.push('mese=' + state.month);
    if (state.pinned) parts.push('nome=' + encodeURIComponent(state.pinned));
    if (state.selected) parts.push('giorno=' + state.selected);
    if (state.view === 'tabella') parts.push('vista=tabella');
    var hash = parts.length ? '#' + parts.join('&') : '';
    if (hash !== window.location.hash) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search + hash); }
      catch (e) { /* file:// senza history: si ignora */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Render — intestazione
  // ---------------------------------------------------------------------------

  function renderHeader() {
    clear(monthCtl);
    if (!D.months.length) {
      monthCtl.appendChild(el('span', { class: 'month__t', text: '—' }));
    } else if (D.months.length === 1) {
      monthCtl.appendChild(el('span', { class: 'month__t', text: monthLabel(state.month) }));
    } else {
      var select = el('select', { 'aria-label': 'Mese mostrato' },
        D.months.map(function (m) {
          return el('option', { value: m, selected: m === state.month, text: monthLabel(m) });
        }));
      select.addEventListener('change', function () { setMonth(select.value); });
      monthCtl.appendChild(el('span', { class: 'month__sel' }, [
        el('span', { class: 'month__t', text: monthLabel(state.month) }),
        icon('i-chevron'),
        select,
      ]));
    }

    var n = D.findingsOfMonth.length;
    clear(findingsBtn);
    if (n === 0) {
      findingsBtn.setAttribute('aria-label', 'Nessuna segnalazione');
      findingsBtn.title = 'Nessuna segnalazione';
      findingsBtn.appendChild(icon('i-check'));
    } else {
      var maxSev = Math.max.apply(null, D.findingsOfMonth.map(function (f) { return f.severity; }));
      findingsBtn.setAttribute('aria-label', plural(n, 'segnalazione', 'segnalazioni'));
      findingsBtn.title = plural(n, 'segnalazione', 'segnalazioni');
      findingsBtn.appendChild(el('span', { class: 'sevdot sev-' + maxSev }));
      findingsBtn.appendChild(el('span', { text: String(n) }));
    }

    todayBtn.hidden = !D.todayInMonth;
    renderPinToken();
  }

  function renderPinToken() {
    clear(pintoken);
    if (!state.pinned) { pintoken.hidden = true; input.placeholder = 'Cerca ed evidenzia un nome…'; return; }
    pintoken.hidden = false;
    input.placeholder = 'Cerca un altro nome…';
    pintoken.appendChild(el('span', { class: 'pintoken__n', text: state.pinned }));
    pintoken.appendChild(el('button', {
      type: 'button', 'aria-label': 'Togli l’evidenziazione di ' + state.pinned,
      on: { click: function (e) { e.preventDefault(); setPinned(null); } },
    }, icon('i-close')));
  }

  // ---------------------------------------------------------------------------
  // Render — riga della persona
  // ---------------------------------------------------------------------------

  function renderPersonLine() {
    clear(personLine);
    if (!state.pinned) { personLine.hidden = true; return; }
    var info = D.nameMap.get(state.pinned) || { count: 0, byHospital: {}, nights: 0, amb: 0 };
    var mine = D.findByPerson.get(state.pinned) || [];
    personLine.hidden = false;

    var parts = [plural(info.count, 'turno', 'turni')];
    D.hospitals.forEach(function (h) { if (info.byHospital[h]) parts.push(h + ' ' + info.byHospital[h]); });
    if (info.nights) parts.push(plural(info.nights, 'notte', 'notti'));
    if (info.amb) parts.push(plural(info.amb, 'ambulatorio', 'ambulatori'));
    personLine.appendChild(document.createTextNode(parts.join(' · ')));
    if (mine.length) {
      personLine.appendChild(document.createTextNode(' · '));
      personLine.appendChild(el('button', {
        class: 'linkbtn', type: 'button',
        text: plural(mine.length, 'segnalazione', 'segnalazioni'),
        on: { click: function () { scrollToEl(findEl); findEl.focus({ preventScroll: true }); } },
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Render — calendario del mese
  // ---------------------------------------------------------------------------

  function renderCalendar() {
    clear(calEl);
    calEl.setAttribute('aria-label', 'Calendario di ' + monthLabel(state.month));
    if (!state.month) return;

    calEl.appendChild(el('div', { class: 'cal__row cal__wd', role: 'row' },
      WEEKDAYS_SHORT_IT.map(function (w) { return el('span', { role: 'columnheader', text: w }); })));

    calName = previewName();
    var chips = chipsByDate(calName);
    var first = dateOf(state.month, 1);
    var lead = (weekdayOf(first) + 6) % 7;           // le settimane iniziano di lunedì
    var cells = [];

    for (var i = lead; i > 0; i--) cells.push({ out: true, n: prevMonthDay(first, i) });
    for (var d = 1; d <= D.monthLen; d++) cells.push({ out: false, n: d, date: dateOf(state.month, d) });
    var after = 1;
    while (cells.length % 7 !== 0) cells.push({ out: true, n: after++ });

    for (var w = 0; w < cells.length; w += 7) {
      var row = el('div', { class: 'cal__row', role: 'row' });
      cells.slice(w, w + 7).forEach(function (c) { row.appendChild(calCell(c, chips)); });
      calEl.appendChild(row);
    }

    renderLegend();
  }

  function prevMonthDay(firstDate, back) {
    var y = Number(firstDate.slice(0, 4)), m = Number(firstDate.slice(5, 7));
    return new Date(Date.UTC(y, m - 1, 1 - back)).getUTCDate();
  }

  function calCell(c, chips) {
    if (c.out) {
      return el('span', { class: 'cal__d is-out', role: 'gridcell' },
        el('span', { class: 'cal__n', text: String(c.n) }));
    }
    var date = c.date;
    var today = date === D.today;
    var sel = date === state.selected;
    var weekend = isWeekend(date);
    var mine = chips.get(date) || [];
    var find = D.dayFind.get(date);

    var label = c.n + ' ' + weekdayLong(date);
    if (today) label += ', oggi';
    if (mine.length) label += ', ' + plural(mine.length, 'turno', 'turni') + ' di ' + calName;
    else if (find) label += ', ' + find.title;

    var cell = el('button', {
      class: 'cal__d' + (weekend ? ' is-weekend' : '') + (sel ? ' is-sel' : ''),
      type: 'button', role: 'gridcell',
      'aria-selected': sel ? 'true' : 'false',
      tabindex: sel ? '0' : '-1',
      'aria-label': label,
      data: { day: date },
    }, [
      el('span', { class: 'cal__n' + (today ? ' is-today' : ''), text: String(c.n) }),
      mine.length ? el('span', { class: 'cal__chips' }, mine.slice(0, 4).map(function (a) { return slotChip(a); })) : null,
      (!calName && find) ? el('span', { class: 'cal__dot sev-' + find.severity, title: find.title }) : null,
    ]);
    return cell;
  }

  function slotChip(a) {
    var finds = D.pillFind.get(a.hospital + '|' + a.date + '|' + a.slotKey + '|' + a.person);
    var sev = finds ? Math.max.apply(null, finds.map(function (f) { return f.severity; })) : 0;
    return el('span', {
      class: 'chipslot ' + hospClass(a.hospital) + (a.isNight ? ' is-night' : '') + (sev ? ' is-find sev-' + sev : ''),
      title: R.slotName(a.slotLabel) + ' ' + a.hospital + ' ' + R.timeRange(a),
      text: a.slotKey.charAt(0),
    });
  }

  function renderLegend() {
    clear(legendEl);
    if (!calName) { legendEl.hidden = true; return; }
    legendEl.hidden = false;
    var slots = D.slotRows.map(function (row) {
      return el('span', {}, [el('b', { text: row.key }), R.slotName(row.slot.label).split(' ')[0].toLowerCase()]);
    });
    var hosps = D.hospitals.map(function (h) {
      return el('span', {}, [el('span', { class: 'dot ' + hospClass(h) }), h]);
    });
    append(legendEl, slots.concat(hosps));
  }

  // Nome disegnato nel calendario: quello in evidenza mentre si scrive, altrimenti il fissato.
  function previewName() {
    if (state.query.trim() && options.length) {
      var armed = options[state.armedIndex];
      if (armed) return armed.dataset.name;
    }
    return state.pinned;
  }

  function updateCalSelection(prev, next) {
    var before = calEl.querySelector('[data-day="' + prev + '"]');
    if (before) {
      before.classList.remove('is-sel');
      before.setAttribute('aria-selected', 'false');
      before.tabIndex = -1;
    }
    var now = calEl.querySelector('[data-day="' + next + '"]');
    if (now) {
      now.classList.add('is-sel');
      now.setAttribute('aria-selected', 'true');
      now.tabIndex = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Render — le due viste
  // ---------------------------------------------------------------------------

  function renderMain() {
    var isTable = state.view === 'tabella';
    segCal.setAttribute('aria-selected', isTable ? 'false' : 'true');
    segTab.setAttribute('aria-selected', isTable ? 'true' : 'false');
    segCal.tabIndex = isTable ? -1 : 0;
    segTab.tabIndex = isTable ? 0 : -1;
    viewCal.hidden = isTable;
    viewTab.hidden = !isTable;

    if (isTable) {
      clear(calEl); clear(detailEl); legendEl.hidden = true;
      renderTable();
    } else {
      clear(tableWrap);
      renderCalendar();
      renderDetail();
    }
  }

  function setView(v) {
    if (state.view === v) return;
    state.view = v;
    writeView(v);
    renderMain();
    indexNames();
    applyHighlight();
    syncHash();
    measureHeader();
  }

  // ---------------------------------------------------------------------------
  // Render — tabella del mese (tutti i nomi)
  // ---------------------------------------------------------------------------

  function renderTable() {
    clear(tableWrap);
    if (!D.days.length || !D.slotRows.length) return;
    var table = el('table', { class: 'tab', 'aria-labelledby': 'tabTitle' });

    // Larghezze proporzionali al nome più lungo di ogni colonna: a 390px
    // nessun nome resta tagliato.
    var lens = D.slotRows.map(function (row) {
      var max = 4;
      D.days.forEach(function (d) {
        D.monthRosters.forEach(function (r) {
          var cell = (d.cells[r.hospital] || {})[row.key];
          ((cell && cell.names) || []).forEach(function (n) { if (n.length > max) max = n.length; });
        });
      });
      return max + 2;
    });
    var total = lens.reduce(function (x, y) { return x + y; }, 0);
    // Percentuali (non calc(): Chrome le ignora sui <col>), ricalcolate a ogni
    // cambio di larghezza. 38px vanno alla colonna del giorno e a quella del pallino.
    tableWidth = tableWrap.clientWidth || 366;
    var free = Math.max(140, tableWidth - 38);
    var pct = function (px) { return (px / tableWidth * 100).toFixed(3) + '%'; };
    table.appendChild(el('colgroup', {}, [
      el('col', { style: 'width:' + pct(28) }),
      el('col', { style: 'width:' + pct(10) }),
    ].concat(lens.map(function (l) {
      return el('col', { style: 'width:' + pct(free * l / total) });
    }))));

    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { class: 'tab__corner', scope: 'col' }, el('span', { class: 'sr-only', text: 'Giorno' })),
      el('th', { class: 'tab__hh', scope: 'col' }, el('span', { class: 'sr-only', text: 'Ospedale' })),
    ].concat(D.slotRows.map(function (row) {
      return el('th', { class: 'tab__hs' + (row.key === 'N' ? ' is-night' : ''), scope: 'col' }, [
        el('b', { text: row.key }), el('time', { text: R.timeRange(row.slot) }),
      ]);
    })))));

    var body = el('tbody');
    D.days.forEach(function (d) {
      var weekend = isWeekend(d.date);
      D.monthRosters.forEach(function (r, i) {
        var tr = el('tr', {
          class: 'tab__r ' + (i === 0 ? 'tab__r--first' : 'tab__r--second') + (weekend ? ' is-weekend' : ''),
          data: { date: d.date },
        });
        if (i === 0) tr.appendChild(tableDayCell(d));
        tr.appendChild(el('td', { class: 'tab__h' }, [
          el('span', { class: 'dot ' + hospClass(r.hospital) }),
          el('span', { class: 'sr-only', text: r.hospital }),
        ]));
        D.slotRows.forEach(function (row) {
          var slot = (r.slots || []).filter(function (s) { return s.key === row.key; })[0] || null;
          tr.appendChild(tableCell(r, slot, d, row.key));
        });
        body.appendChild(tr);
      });
    });
    table.appendChild(body);
    table.classList.toggle('is-pinned', !!state.pinned && !state.query.trim());
    tableWrap.appendChild(table);
  }

  function tableDayCell(d) {
    var today = d.date === D.today;
    return el('th', { class: 'tab__day', scope: 'row', rowspan: '2' },
      el('button', {
        class: 'tab__daybtn', type: 'button', data: { goday: d.date },
        'aria-label': d.day + ' ' + weekdayLong(d.date) + ': apri nel calendario',
      }, [
        el('span', { class: 'n' + (today ? ' is-today' : ''), text: String(d.day) }),
        el('span', { class: 'wd', text: R.formatDate(d.date).split(' ')[0] }),
      ]));
  }

  function tableCell(roster, slot, day, key) {
    var box = el('td', { class: 'tab__c' + (key === 'N' ? ' is-night' : '') });
    if (!slot) return box;
    var mark = D.cellFind.get(roster.hospital + '|' + day.date + '|' + slot.key);
    if (mark) {
      box.classList.add('has-find', 'sev-' + mark.severity);
      box.title = mark.title;
    }
    var names = ((day.cells[roster.hospital] || {})[slot.key] || {}).names || [];
    var seen = Object.create(null);
    names.forEach(function (name, pos) {
      if (seen[name]) return;
      seen[name] = true;
      var role = (slot.roles && slot.roles[pos]) || '';
      var finds = D.pillFind.get(roster.hospital + '|' + day.date + '|' + slot.key + '|' + name);
      var sev = finds ? Math.max.apply(null, finds.map(function (f) { return f.severity; })) : 0;
      box.appendChild(el('button', {
        class: 'pill pill--t', type: 'button', data: { name: name },
        title: name + (role ? ' · ' + (pos + 1) + 'º ' + role : ''),
        'aria-label': name + ' — ' + R.slotName(slot.label) + ' ' + roster.hospital + (role ? ', ' + role : ''),
      }, [
        el('span', { text: name }),
        sev ? el('span', { class: 'fdot sev-' + sev, title: finds[0].title }) : null,
      ]));
    });
    return box;
  }

  function flashGroup(date) {
    if (reduceMotion.matches) return;
    var rows = tableWrap.querySelectorAll('tr[data-date="' + date + '"]');
    Array.prototype.forEach.call(rows, function (tr) {
      tr.classList.remove('is-flash');
      void tr.offsetWidth;
      tr.classList.add('is-flash');
      window.setTimeout(function () { tr.classList.remove('is-flash'); }, 1400);
    });
  }

  // ---------------------------------------------------------------------------
  // Render — dettaglio del giorno scelto
  // ---------------------------------------------------------------------------

  function renderDetail() {
    clear(detailEl);
    detailEl.style.setProperty('--tpl', 'var(--dlabel) repeat(' + Math.max(1, D.hospitals.length) + ', minmax(0, 1fr))');
    var date = state.selected;
    if (!date) return;
    var day = D.dayByDate.get(date);
    var today = date === D.today;
    detailEl.classList.toggle('is-weekend', isWeekend(date));
    detailEl.classList.toggle('is-pinned', !!state.pinned && !state.query.trim());

    var idx = D.days.map(function (d) { return d.date; }).indexOf(date);
    detailEl.appendChild(el('div', { class: 'detail__hd' }, [
      el('button', {
        class: 'navday', type: 'button', 'aria-label': 'Giorno precedente',
        disabled: dayNum(date) <= 1,
        on: { click: function () { step(-1); } },
      }, icon('i-prev')),
      el('h2', { class: 'detail__t', id: 'detailTitle' }, [
        el('span', { class: 'detail__num', text: String(dayNum(date)) }),
        ' ',
        el('span', { class: 'detail__wd', text: weekdayLong(date) }),
        today ? el('span', { class: 'detail__oggi', text: 'oggi' }) : null,
      ]),
      el('button', {
        class: 'navday', type: 'button', 'aria-label': 'Giorno successivo',
        disabled: dayNum(date) >= D.monthLen,
        on: { click: function () { step(1); } },
      }, icon('i-next')),
    ]));

    if (!day) {
      detailEl.appendChild(el('p', { class: 'detail__none', text: 'Nessun turno per questo giorno.' }));
      return;
    }

    detailEl.appendChild(el('div', { class: 'detail__cols' }, [el('span', {})].concat(
      D.monthRosters.map(function (r) {
        return el('span', { class: 'detail__h ' + hospClass(r.hospital), title: r.title || r.hospital }, [
          el('span', { class: 'dot ' + hospClass(r.hospital) }), r.hospital,
        ]);
      })
    )));

    var shown = 0;
    D.slotRows.forEach(function (row) {
      var slots = D.monthRosters.map(function (r) {
        return (r.slots || []).filter(function (s) { return s.key === row.key; })[0] || null;
      });
      var used = slots.some(function (slot, i) {
        if (!slot) return false;
        var cell = (day.cells[D.monthRosters[i].hospital] || {})[slot.key];
        return !!(cell && cell.names && cell.names.length);
      });
      if (!used) return;
      shown++;

      var night = row.key === 'N';
      var cells = slots.map(function (slot, i) {
        if (!slot) return el('div', {});
        return detailCell(D.monthRosters[i], slot, day);
      });
      detailEl.appendChild(el('div', { class: 'detail__row' + (night ? ' is-night' : '') }, [
        el('div', { class: 'detail__lab' }, [
          el('b', {}, [shortSlotName(row.slot.label), night ? icon('i-moon') : null]),
          el('time', { text: R.timeRange(row.slot) }),
        ]),
      ].concat(cells)));
    });

    if (!shown) detailEl.appendChild(el('p', { class: 'detail__none', text: 'Nessun turno assegnato in questo giorno.' }));
  }

  function detailCell(roster, slot, day) {
    var cell = (day.cells[roster.hospital] || {})[slot.key];
    var box = el('div', { class: 'detail__cell' });
    var mark = D.cellFind.get(roster.hospital + '|' + day.date + '|' + slot.key);
    if (mark) {
      box.classList.add('has-find', 'sev-' + mark.severity);
      box.title = mark.title;
    }
    var names = (cell && cell.names) || [];
    if (!names.length) { box.appendChild(el('span', { class: 'dash', text: '—' })); return box; }

    var seen = Object.create(null);
    names.forEach(function (name, pos) {
      if (seen[name]) return;
      seen[name] = true;
      var role = (slot.roles && slot.roles[pos]) || '';
      var finds = D.pillFind.get(roster.hospital + '|' + day.date + '|' + slot.key + '|' + name);
      var sev = finds ? Math.max.apply(null, finds.map(function (f) { return f.severity; })) : 0;
      box.appendChild(el('button', {
        class: 'pill', type: 'button', data: { name: name },
        title: role ? (pos + 1) + 'º · ' + role : name,
        'aria-label': name + ' — ' + R.slotName(slot.label) + ' ' + roster.hospital + (role ? ', ' + role : ''),
      }, [
        el('span', { text: name }),
        sev ? el('span', { class: 'fdot sev-' + sev, title: finds[0].title }) : null,
      ]));
    });
    return box;
  }

  // ---------------------------------------------------------------------------
  // Render — segnalazioni
  // ---------------------------------------------------------------------------

  function renderFindings() {
    clear(findEl);
    var all = D.findingsOfMonth;
    var list = all;
    var filtered = false;
    if (state.pinned && !state.findingsAll) {
      list = all.filter(function (f) { return f.person === state.pinned; });
      filtered = true;
    }

    var counts = {};
    all.forEach(function (f) { counts[f.kind] = (counts[f.kind] || 0) + 1; });
    var countText = KIND_ORDER.filter(function (k) { return counts[k]; })
      .map(function (k) { return plural(counts[k], KIND_PLURAL[k][0], KIND_PLURAL[k][1]); })
      .join(' · ');

    findEl.appendChild(el('div', { class: 'findings__head' }, [
      el('h2', { class: 'stitle', id: 'findingsTitle', text: 'Segnalazioni' }),
      countText ? el('span', { class: 'cap', text: countText }) : null,
    ]));

    if (filtered && all.length) {
      findEl.appendChild(el('p', { class: 'findings__filter' }, [
        'Solo ' + state.pinned, el('span', { text: '·' }),
        el('button', {
          class: 'linkbtn', type: 'button', text: 'mostra tutte',
          on: { click: function () { state.findingsAll = true; renderFindings(); } },
        }),
      ]));
    }

    if (!list.length) {
      findEl.appendChild(el('p', { class: 'fempty' }, [
        icon('i-check'),
        all.length ? 'Nessuna segnalazione per ' + state.pinned + ' a ' + monthName(state.month)
          : 'Nessuna segnalazione a ' + monthName(state.month),
      ]));
    } else {
      var kinds = KIND_ORDER.filter(function (k) { return list.some(function (f) { return f.kind === k; }); });
      kinds.forEach(function (kind) {
        var group = list.filter(function (f) { return f.kind === kind; });
        findEl.appendChild(el('div', { class: 'fgroup' }, [
          kinds.length > 1 ? el('p', { class: 'fgroup__t', text: plural(group.length, KIND_PLURAL[kind][0], KIND_PLURAL[kind][1]) }) : null,
          el('div', {}, group.map(function (f) { return findingItem(f); })),
        ]));
      });
    }

    findEl.appendChild(el('div', { class: 'legenda' }, [
      el('p', { class: 'legenda__t', text: 'Legenda' }),
    ].concat(LEGEND.map(function (row) {
      return el('div', { class: 'legenda__row' }, [
        el('span', { class: 'legenda__mark sev-' + row[0] }),
        el('span', {}, [el('b', { text: row[1] }), ' — ' + row[2]]),
      ]);
    }))));
  }

  // Una riga di segnalazione: la striscia dà la gravità, il corpo porta al giorno.
  function findingItem(f) {
    return el('div', { class: 'fitem sev-' + f.severity, data: { goto: f.a.date } }, [
      el('div', { class: 'fitem__body' }, [
        el('button', {
          class: 'fitem__who', type: 'button', data: { name: f.person },
          'aria-label': 'Evidenzia ' + f.person, text: f.person,
        }),
        el('p', { class: 'fitem__t', text: f.title }),
        el('p', { class: 'fitem__d', text: f.detail }),
      ]),
      el('button', {
        class: 'fitem__go', type: 'button',
        'aria-label': 'Vai a ' + R.formatDate(f.a.date) + ': ' + f.title,
      }, icon('i-chevron')),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Render — chi c'è questo mese
  // ---------------------------------------------------------------------------

  function renderStrip() {
    clear(stripEl);
    if (!D.names.length) { stripEl.hidden = true; return; }
    stripEl.hidden = false;

    var both = D.names.filter(function (n) { return Object.keys(n.byHospital).length > 1; }).length;
    var warn = D.names.filter(function (n) { return n.suspicion; }).length;
    var caption = [plural(D.names.length, 'nome', 'nomi')];
    if (both) caption.push(both + ' in entrambi gli ospedali');
    if (warn) caption.push(warn + ' da controllare');

    stripEl.appendChild(el('div', { class: 'strip__head' },
      el('h2', { class: 'stitle', id: 'stripTitle', text: 'Chi c’è a ' + monthName(state.month) })));
    stripEl.appendChild(el('p', { class: 'cap strip__cap', text: caption.join(' · ') }));
    stripEl.appendChild(el('div', { class: 'strip__names' }, D.names.map(nameChip)));
  }

  function nameChip(n) {
    var why = suspicionText(n.suspicion);
    return el('button', {
      class: 'chip' + (n.suspicion ? ' is-warn' : ''), type: 'button',
      data: { name: n.name, top: '1' },
      'aria-label': n.name + ', ' + plural(n.count, 'turno', 'turni') + (why ? ', ' + why : ''),
    }, [
      el('span', { class: 'chip__name', text: n.name }),
      el('span', { class: 'chip__n', text: String(n.count) }),
      el('span', { class: 'chip__dots' }, D.hospitals.filter(function (h) { return n.byHospital[h]; })
        .map(function (h) {
          return el('span', { class: 'dot ' + hospClass(h), title: h + ': ' + plural(n.byHospital[h], 'turno', 'turni') });
        })),
      why ? el('span', { class: 'chip__why' }, [icon('i-warn'), why]) : null,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Render — dati e sorgenti
  // ---------------------------------------------------------------------------

  function renderDati() {
    clear(datiBody);

    var sources = el('div', { class: 'dati__block' }, el('p', { class: 'dati__t', text: 'Sorgenti' }));
    D.rosters.slice().sort(function (a, b) {
      if (a.month !== b.month) return a.month < b.month ? 1 : -1;
      return hospitalOrder(a, b);
    }).forEach(function (r) {
      var meta = [r.hospital, monthLabel(r.month), plural((r.days || []).length, 'giorno', 'giorni')];
      if (r.source === 'browser' && r.replaces) meta.push('sostituisce la versione pubblicata');
      sources.appendChild(el('div', { class: 'src' }, [
        el('span', { class: 'src__file', text: r.file }),
        el('span', { class: 'badge' + (r.source === 'browser' ? ' is-browser' : ''), text: r.source === 'browser' ? 'dal browser' : 'pubblicato' }),
        r.source === 'browser' ? el('button', {
          class: 'minibtn', type: 'button', text: 'Rimuovi',
          'aria-label': 'Rimuovi ' + r.file + ' dal browser',
          on: { click: function () { removeLocal(r); } },
        }) : null,
        el('span', { class: 'src__meta', text: meta.join(' · ') }),
      ]));
    });
    datiBody.appendChild(sources);

    var warnings = [];
    D.rosters.forEach(function (r) {
      (r.warnings || []).forEach(function (w) { warnings.push(r.hospital + ' · ' + (w.message || w.type)); });
    });
    if (warnings.length) {
      datiBody.appendChild(el('div', { class: 'dati__block' }, [
        el('p', { class: 'dati__t', text: plural(warnings.length, 'avviso di lettura', 'avvisi di lettura') }),
      ].concat(warnings.map(function (w) { return el('p', { class: 'warnrow' }, [icon('i-warn'), w]); }))));
    }

    var suspicious = D.namesAll.filter(function (n) { return n.suspicion; });
    if (suspicious.length) {
      datiBody.appendChild(el('div', { class: 'dati__block' }, [
        el('p', { class: 'dati__t', text: 'Nomi da controllare' }),
      ].concat(suspicious.map(function (n) {
        return el('p', { class: 'warnrow' }, [icon('i-warn'), n.name + ' — ' + suspicionText(n.suspicion)]);
      }))));
    }

    datiBody.appendChild(el('div', { class: 'dati__block' }, [
      el('p', { class: 'dati__t', text: 'Aggiornare i turni' }),
      el('div', { class: 'dati__row' }, [
        el('button', { class: 'btn', type: 'button', on: { click: function () { fileInput.click(); } } },
          [icon('i-upload'), 'Carica xlsx']),
        local.length ? el('button', {
          class: 'btn', type: 'button', text: 'Ripristina i dati pubblicati', on: { click: restorePublished },
        }) : null,
      ]),
      el('p', { class: 'dati__note', text: 'Sul telefono: «Carica xlsx» e scegli il file ricevuto (per esempio da WhatsApp o dalla mail).' }),
      el('p', { class: 'dati__note', text: 'Per aggiornare: trascina qui i nuovi file xlsx, oppure mettili in data/ e lancia npm run build.' }),
      GENERATED_AT ? el('p', { class: 'dati__note', text: 'Dati pubblicati il ' + formatGenerated(GENERATED_AT) + '.' }) : null,
    ]));
  }

  function formatGenerated(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.getDate() + ' ' + MONTHS_IT[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear() +
      ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // ---------------------------------------------------------------------------
  // Evidenziazione
  // ---------------------------------------------------------------------------

  function indexNames() {
    nameEls = new Map();
    painted = [];
    var add = function (node) {
      var arr = nameEls.get(node.dataset.name);
      if (!arr) { arr = []; nameEls.set(node.dataset.name, arr); }
      arr.push(node);
    };
    Array.prototype.forEach.call(detailEl.querySelectorAll('[data-name]'), add);
    Array.prototype.forEach.call(tableWrap.querySelectorAll('[data-name]'), add);
    Array.prototype.forEach.call(stripEl.querySelectorAll('[data-name]'), add);
  }

  function paint(name, cls) {
    var arr = nameEls.get(name);
    if (!arr) return;
    arr.forEach(function (node) {
      node.classList.remove('is-soft', 'is-strong');
      node.classList.add(cls);
      painted.push(node);
    });
  }

  function applyHighlight() {
    painted.forEach(function (node) { node.classList.remove('is-soft', 'is-strong'); });
    painted = [];

    var table = tableWrap.firstChild;
    var dim = function (on) {
      detailEl.classList.toggle('is-pinned', on);
      if (table && table.classList) table.classList.toggle('is-pinned', on);
    };

    var q = state.query.trim();
    if (q) {
      dim(false);
      var list = R.searchNames(q, D.names);
      list.forEach(function (n) { paint(n.name, 'is-soft'); });
      var armed = list[state.armedIndex];
      if (armed) paint(armed.name, 'is-strong');
    } else if (state.pinned) {
      dim(true);
      paint(state.pinned, 'is-strong');
    } else {
      dim(false);
    }

    // Il calendario segue il nome in evidenza: si vede il mese della persona
    // già mentre si scrive.
    if (state.view === 'calendario' && previewName() !== calName) renderCalendar();
  }

  // ---------------------------------------------------------------------------
  // Elenco dei candidati
  // ---------------------------------------------------------------------------

  function renderPop() {
    clear(pop);
    options = [];
    var q = state.query.trim();
    if (!q) { closePop(); return; }

    var list = R.searchNames(q, D.names);
    if (!list.length) {
      pop.appendChild(el('p', { class: 'opt__empty', text: 'Nessun nome corrisponde a «' + q + '»' }));
      openPop();
      srSay('Nessun nome corrisponde');
      return;
    }
    if (state.armedIndex >= list.length) state.armedIndex = 0;

    list.forEach(function (n, i) {
      var parts = matchParts(n.name, q);
      var nameNode = el('span', { class: 'opt__name' });
      if (parts) {
        append(nameNode, parts[0]);
        nameNode.appendChild(el('b', { text: parts[1] }));
        append(nameNode, parts[2]);
      } else nameNode.textContent = n.name;

      var why = suspicionText(n.suspicion);
      var row = el('div', {
        class: 'opt' + (i === state.armedIndex ? ' is-armed' : ''),
        role: 'option', id: 'opt-' + i, 'aria-selected': i === state.armedIndex ? 'true' : 'false',
        data: { name: n.name },
      }, [
        el('span', { class: 'opt__main' }, [
          nameNode,
          why ? el('span', { class: 'opt__why' }, [icon('i-warn'), why]) : null,
        ]),
        el('span', { class: 'opt__n', text: String(n.count) }),
        el('span', { class: 'opt__dots' }, D.hospitals.filter(function (h) { return n.byHospital[h]; })
          .map(function (h) { return el('span', { class: 'dot ' + hospClass(h), title: h }); })),
      ]);
      options.push(row);
      pop.appendChild(row);
    });

    openPop();
    srSay(plural(list.length, 'nome trovato', 'nomi trovati'));
    armRow();
  }

  function armRow() {
    options.forEach(function (row, i) {
      var on = i === state.armedIndex;
      row.classList.toggle('is-armed', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        input.setAttribute('aria-activedescendant', row.id);
        if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
      }
    });
    if (!options.length) input.removeAttribute('aria-activedescendant');
  }

  function openPop() { pop.hidden = false; state.popOpen = true; input.setAttribute('aria-expanded', 'true'); }

  function closePop() {
    pop.hidden = true;
    state.popOpen = false;
    options = [];
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function moveArmed(delta) {
    if (!options.length) return;
    state.armedIndex = (state.armedIndex + delta + options.length) % options.length;
    armRow();
    applyHighlight();
  }

  // ---------------------------------------------------------------------------
  // Azioni
  // ---------------------------------------------------------------------------

  function setMonth(m) {
    state.month = m;
    state.selected = '';
    renderAll();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function setPinned(name, opts) {
    opts = opts || {};
    state.pinned = name;
    state.findingsAll = false;
    writeMe(name);
    state.query = '';
    input.value = '';
    clearBtn.hidden = true;
    closePop();
    if (document.activeElement === input) input.blur();

    keepAnchor(function () {
      renderHeader();
      renderPersonLine();
      renderMain();
      renderFindings();
      indexNames();
      applyHighlight();
    }, opts.toTop);
    syncHash();
    if (opts.toTop) window.scrollTo({ top: 0, behavior: 'instant' });
    srSay(name ? name + ': ' + plural((D.nameMap.get(name) || { count: 0 }).count, 'turno', 'turni') + ' nel mese'
      : 'Evidenziazione tolta');
  }

  function togglePin(name, opts) { setPinned(state.pinned === name ? null : name, opts); }

  // Il dettaglio resta dov'è quando sopra compare o sparisce la riga della persona.
  function keepAnchor(fn, skip) {
    if (skip) { fn(); return; }
    var anchor = state.view === 'tabella' ? viewTab : detailEl;
    var before = anchor.getBoundingClientRect().top;
    fn();
    var delta = anchor.getBoundingClientRect().top - before;
    if (Math.abs(delta) > 1 && window.scrollY > 0) window.scrollBy({ top: delta, behavior: 'instant' });
  }

  function selectDay(date, opts) {
    opts = opts || {};
    if (!validDay(date)) return;
    var prev = state.selected;
    state.selected = date;
    if (state.view === 'tabella') { syncHash(); return; }
    updateCalSelection(prev, date);
    renderDetail();
    indexNames();
    applyHighlight();
    syncHash();
    if (opts.scroll) scrollToEl(detailEl);
    if (opts.flash) flash(detailEl);
    if (opts.focusCell) {
      var b = calEl.querySelector('[data-day="' + date + '"]');
      if (b && b.focus) b.focus();
    }
  }

  // Dalla segnalazione al giorno: nel calendario lo seleziona, nella tabella
  // porta al gruppo di righe e lo fa lampeggiare.
  function goToDay(date) {
    if (state.view === 'tabella') {
      state.selected = validDay(date) ? date : state.selected;
      syncHash();
      var row = tableWrap.querySelector('tr[data-date="' + date + '"]');
      if (row) { scrollToEl(row); flashGroup(date); }
      return;
    }
    selectDay(date, { scroll: true, flash: true });
  }

  function step(delta) {
    var n = dayNum(state.selected) + delta;
    if (n < 1 || n > D.monthLen) return;
    selectDay(dateOf(state.month, n));
  }

  function scrollToEl(node, instant) {
    if (!node) return;
    node.scrollIntoView({ block: 'start', behavior: (instant || reduceMotion.matches) ? 'instant' : 'smooth' });
  }

  function flash(node) {
    if (reduceMotion.matches) return;
    node.classList.remove('is-flash');
    void node.offsetWidth;
    node.classList.add('is-flash');
    window.setTimeout(function () { node.classList.remove('is-flash'); }, 1400);
  }

  function srSay(text) { if (text) srStatus.textContent = text; }

  function toast(message, isError) {
    var node = el('div', { class: 'toast' + (isError ? ' is-error' : ''), role: 'status' }, [
      icon(isError ? 'i-warn' : 'i-check'),
      el('span', { text: message }),
    ]);
    toasts.appendChild(node);
    window.setTimeout(function () {
      node.style.opacity = '0';
      window.setTimeout(function () { if (node.parentNode) node.remove(); }, 250);
    }, 4000);
  }

  // ---------------------------------------------------------------------------
  // Caricamento dei file
  // ---------------------------------------------------------------------------

  function loadFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var loaded = [];
    var chain = Promise.resolve();
    files.forEach(function (file) { chain = chain.then(function () { return loadOne(file, loaded); }); });
    chain.then(function () {
      if (!loaded.length) return;
      if (!writeLocal(local)) toast('I turni sono caricati ma non restano in memoria (spazio del browser non disponibile)', true);
      state.month = loaded[loaded.length - 1].month;
      state.selected = '';
      renderAll();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }

  function loadOne(file, loaded) {
    if (!/\.xlsx$/i.test(file.name)) {
      toast('Formato non riconosciuto: usa i file .xlsx dei turni', true);
      return Promise.resolve();
    }
    var parser = window.TurniParser;
    if (!parser || typeof parser.parseWorkbook !== 'function') {
      toast('Lettore xlsx non disponibile in questa pagina', true);
      return Promise.resolve();
    }
    return file.arrayBuffer()
      .then(function (buf) { return parser.parseWorkbook(buf, file.name); })
      .then(function (roster) {
        roster.source = 'browser';
        local = local.filter(function (r) { return rosterKey(r) !== rosterKey(roster); });
        local.push(roster);
        loaded.push(roster);
        toast('Caricato ' + roster.hospital + ' · ' + monthLabel(roster.month) + ' · ' +
          plural((roster.days || []).length, 'giorno', 'giorni'));
      })
      .catch(function (err) {
        toast(file.name + ': ' + ((err && err.message) || 'file non leggibile'), true);
      });
  }

  function removeLocal(roster) {
    local = local.filter(function (r) { return rosterKey(r) !== rosterKey(roster); });
    writeLocal(local);
    renderAll();
    toast('Rimosso ' + roster.hospital + ' · ' + monthLabel(roster.month));
  }

  function restorePublished() {
    if (!window.confirm('Rimuovere i turni caricati nel browser e tornare ai dati pubblicati?')) return;
    local = [];
    writeLocal(local);
    renderAll();
    toast('Ripristinati i dati pubblicati');
  }

  // ---------------------------------------------------------------------------
  // Render completo
  // ---------------------------------------------------------------------------

  function renderAll() {
    derive();
    var hasData = D.rosters.length > 0;
    emptyEl.hidden = hasData;
    searchBox.hidden = !hasData;
    viewCal.hidden = !hasData;
    viewTab.hidden = true;
    findEl.hidden = !hasData;
    stripEl.hidden = !hasData;
    datiEl.hidden = !hasData && !local.length;

    renderHeader();
    if (hasData) {
      renderPersonLine();
      renderMain();
      renderFindings();
      renderStrip();
    } else {
      personLine.hidden = true;
      legendEl.hidden = true;
      clear(calEl); clear(detailEl); clear(tableWrap);
    }
    renderDati();
    indexNames();
    applyHighlight();
    syncHash();
    measureHeader();
  }

  function measureHeader() {
    document.documentElement.style.setProperty('--h-header', topbar.offsetHeight + 'px');
  }

  // ---------------------------------------------------------------------------
  // Eventi
  // ---------------------------------------------------------------------------

  function wire() {
    input.addEventListener('input', function () {
      state.query = input.value;
      state.armedIndex = 0;
      clearBtn.hidden = !input.value;
      renderPop();
      applyHighlight();
    });

    input.addEventListener('focus', function () { if (state.query.trim()) renderPop(); });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!state.popOpen) renderPop(); else moveArmed(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveArmed(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var armed = options[state.armedIndex];
        if (armed) setPinned(armed.dataset.name, { toTop: true });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (state.popOpen) closePop();
        else if (input.value) { input.value = ''; state.query = ''; clearBtn.hidden = true; applyHighlight(); }
        else if (state.pinned) setPinned(null);
      } else if (e.key === 'Tab') closePop();
    });

    clearBtn.addEventListener('click', function () {
      input.value = ''; state.query = ''; state.armedIndex = 0;
      clearBtn.hidden = true;
      closePop();
      applyHighlight();
      input.focus();
    });

    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pop.addEventListener('click', function (e) {
      var row = e.target.closest('.opt');
      if (row && row.dataset.name) setPinned(row.dataset.name, { toTop: true });
    });

    document.addEventListener('pointerdown', function (e) {
      if (state.popOpen && !searchBox.contains(e.target)) closePop();
    });

    // Un solo ascoltatore per pastiglie, chip, celle del calendario e segnalazioni.
    document.addEventListener('click', function (e) {
      var named = e.target.closest('[data-name]');
      if (named && !named.closest('.opt')) {
        togglePin(named.dataset.name, { toTop: named.dataset.top === '1' });
        return;
      }
      var cell = e.target.closest('[data-day]');
      if (cell) { selectDay(cell.dataset.day); return; }
      var goday = e.target.closest('[data-goday]');
      if (goday) {
        selectDay(goday.dataset.goday);
        setView('calendario');
        window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
        return;
      }
      var goto = e.target.closest('[data-goto]');
      if (goto) goToDay(goto.dataset.goto);
    });

    // Calendario: le frecce spostano il fuoco, Invio sceglie il giorno.
    calEl.addEventListener('keydown', function (e) {
      var deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      var d = deltas[e.key];
      if (!d) return;
      var cur = e.target.closest('[data-day]');
      if (!cur) return;
      e.preventDefault();
      var n = dayNum(cur.dataset.day) + d;
      if (n < 1 || n > D.monthLen) return;
      var next = calEl.querySelector('[data-day="' + dateOf(state.month, n) + '"]');
      if (next) { next.tabIndex = 0; next.focus(); }
    });

    // Scorrimento laterale sul dettaglio: giorno precedente / successivo.
    var tx = 0, ty = 0, tt = 0;
    detailEl.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tt = 0; return; }
      tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now();
    }, { passive: true });
    detailEl.addEventListener('touchend', function (e) {
      if (!tt || !e.changedTouches.length || Date.now() - tt > 900) return;
      var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      step(dx < 0 ? 1 : -1);
    }, { passive: true });

    segCal.addEventListener('click', function () { setView('calendario'); });
    segTab.addEventListener('click', function () { setView('tabella'); });
    $('segbar').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      var next = (e.key === 'ArrowLeft' || e.key === 'Home') ? 'calendario' : 'tabella';
      setView(next);
      (next === 'tabella' ? segTab : segCal).focus();
    });

    findingsBtn.addEventListener('click', function () {
      scrollToEl(findEl);
      findEl.focus({ preventScroll: true });
    });

    todayBtn.addEventListener('click', function () {
      selectDay(D.today);
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
    });

    $('emptyUpload').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { loadFiles(fileInput.files); fileInput.value = ''; });

    var dragDepth = 0;
    function endDrag() { dragDepth = 0; dropzone.hidden = true; }
    window.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
      dragDepth++;
      dropzone.hidden = false;
    });
    window.addEventListener('dragover', function (e) { if (!dropzone.hidden) e.preventDefault(); });
    window.addEventListener('dragleave', function (e) {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth || !e.relatedTarget) endDrag();
    });
    window.addEventListener('drop', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      endDrag();
      loadFiles(e.dataTransfer.files);
    });
    window.addEventListener('dragend', endDrag);
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', function () { if (document.hidden) endDrag(); });

    window.addEventListener('resize', function () {
      measureHeader();
      // Le colonne della tabella sono percentuali calcolate su una larghezza:
      // se cambia davvero, si rifanno.
      if (state.view === 'tabella' && Math.abs(tableWrap.clientWidth - tableWidth) > 2) {
        renderTable();
        indexNames();
        applyHighlight();
      }
    });
    window.addEventListener('hashchange', function () {
      var before = state.month + '|' + state.pinned + '|' + state.selected;
      readHash();
      if (before !== state.month + '|' + state.pinned + '|' + state.selected) renderAll();
    });
  }

  // ---------------------------------------------------------------------------
  // Avvio
  // ---------------------------------------------------------------------------

  function init() {
    state.view = readView();
    readHash();                                    // l'indirizzo vince sulla memoria
    if (!state.pinned) state.pinned = readMe();   // la pagina si riapre sul proprio mese
    wire();
    renderAll();
    if (state.pinned) srSay(state.pinned + ' evidenziato');
  }

  init();
})();
