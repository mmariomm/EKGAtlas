/* =============================================================================
   I Miei Turni — interfaccia (vanilla JS, nessun modulo, nessuna dipendenza).
   Gira dopo TurniParser, TurniRules e window.TURNI_DATA.
   Tre viste: calendario + giorno scelto, tabella del mese, ore per nome.
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
  var LS_GESTORE = 'imieiturni.gestore';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  var WEEKDAYS_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì',
    'giovedì', 'venerdì', 'sabato'];
  var WEEKDAYS_SHORT_IT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

  var SLOT_RANK = { M: 0, P: 1, N: 2 };          // ordine delle righe e delle colonne: il resto in coda
  var CHIP_RANK = { G: 0, M: 0, A: 0, P: 1, N: 2 };   // fra le pastiglie l'ambulatorio sta con la mattina
  var SLOT_WORD = { G: 'giornata', M: 'mattina', P: 'pomeriggio', N: 'notte', A: 'ambulatorio' };

  var VIEWS = ['calendario', 'tabella', 'ore'];
  var KIND_ORDER = ['conflitto', 'notte-attaccata', 'cambio-sede'];
  var KIND_PLURAL = {
    conflitto: ['conflitto', 'conflitti'],
    'notte-attaccata': ['notte attaccata', 'notti attaccate'],
    'cambio-sede': ['cambio sede', 'cambi sede'],
  };
  var LEGEND = [
    [3, 'Conflitto', 'stesso orario in due ospedali, o doppio incarico oltre 1 h nello stesso PS.'],
    [2, 'Notte attaccata', 'turno diurno subito prima o dopo una notte, con meno di 11 h di riposo.'],
    [1, 'Cambio sede', 'due turni diurni in ospedali diversi senza pausa.'],
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

  function hospClass(h) { return h === 'DEA' ? 'h-dea' : (h === 'OSG' ? 'h-osg' : 'h-alt'); }
  function dot(h, title) { return el('span', { class: 'dot ' + hospClass(h), title: title }); }
  function warnRow(text) { return el('p', { class: 'warnrow' }, [icon('i-warn'), text]); }

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
    return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function shortSlotName(label) { return R.slotName(label).replace(/^Ambulatorio\b/, 'Amb.'); }

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
      var ch = name.charAt(i).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
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

  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStore(key, value) {
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch (e) { /* niente memoria: pazienza */ }
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
    popOpen: false,
  };

  var local = readLocal();
  var shared = null;          // data/turni.json pubblicato nell'artifact
  var pendingShared = null;   // arrivato mentre un foglio era aperto
  var pub = null;             // spazio dei nomi "artifact" della piattaforma
  var runtime = !!(window.claude && typeof window.claude.use === 'function');
  // Se la pagina passa da un server con le due password, il ruolo lo decide lui.
  var role = (window.TURNI_ROLE === 'gestore' || window.TURNI_ROLE === 'medico') ? window.TURNI_ROLE : null;
  var gestore = role ? role === 'gestore' : (!runtime || readStore(LS_GESTORE) === '1');
  var soloVista = role === 'medico';

  var D = {};
  var hits = [];              // ultimo risultato di searchNames (una volta per battuta)
  var nameEls = new Map();
  var painted = [];
  var options = [];
  var calName = null;
  var tableWidth = 0;
  var today = todayISO();
  var reviewQueue = [], reviewCurrent = null, reviewOpener = null, reviewTotal = 0, reviewDone = 0;

  // ---------------------------------------------------------------------------
  // Riferimenti al DOM
  // ---------------------------------------------------------------------------

  var searchbar = $('searchbar'), monthCtl = $('monthCtl'),
    segCal = $('segCal'), segTab = $('segTab'), segOre = $('segOre'),
    viewCal = $('viewCal'), viewTab = $('viewTab'), viewOre = $('viewOre'),
    tableWrap = $('tablewrap'), oreCard = $('orecard'),
    searchBox = $('search'), input = $('q'), pintoken = $('pintoken'), clearBtn = $('clearBtn'), pop = $('pop'),
    emptyEl = $('empty'), personLine = $('personline'), calEl = $('calendario'), legendEl = $('callegend'),
    detailEl = $('detail'), findEl = $('segnalazioni'), datiEl = $('dati'), datiSumText = $('datiSumText'),
    datiBody = $('datiBody'), fileInput = $('fileInput'), toasts = $('toasts'), srStatus = $('srStatus'),
    reviewEl = $('review'), reviewPanel = $('reviewPanel'), reviewTitle = $('reviewTitle'),
    reviewCap = $('reviewCap'), reviewBody = $('reviewBody'), reviewSave = $('reviewSave'), reviewCancel = $('reviewCancel');

  // ---------------------------------------------------------------------------
  // Derivazione della vista
  // ---------------------------------------------------------------------------

  function rosterKey(r) { return r.hospital + '|' + r.month; }

  function mergedRosters() {
    var map = new Map();
    var add = function (r, source, replaces) {
      var c = Object.assign({}, r);
      c.source = source;
      c.replaces = replaces;
      c.slotsByKey = {};
      (c.slots || []).forEach(function (s) { c.slotsByKey[s.key] = s; });
      map.set(rosterKey(c), c);
    };
    BAKED.forEach(function (r) { add(r, 'pubblicato', false); });
    ((shared && shared.rosters) || []).forEach(function (r) { add(r, 'pubblicato', false); });
    local.forEach(function (r) { add(r, 'browser', map.has(rosterKey(r))); });
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

  function namesOfMonth(namesAll, assignments) {
    var map = new Map();
    assignments.forEach(function (a) {
      var i = map.get(a.person);
      if (!i) { i = { name: a.person, count: 0, byHospital: {}, nights: 0, suspicion: null }; map.set(a.person, i); }
      i.count++;
      i.byHospital[a.hospital] = (i.byHospital[a.hospital] || 0) + 1;
      if (a.isNight) i.nights++;
    });
    namesAll.forEach(function (n) { var i = map.get(n.name); if (i) i.suspicion = n.suspicion; });
    return Array.from(map.values()).sort(function (a, b) { return a.name.localeCompare(b.name, 'it'); });
  }

  // I nomi di una cella, senza ripetizioni, con il ruolo che viene dalla posizione.
  function cellNames(day, hospital, slot) {
    var cell = (day.cells[hospital] || {})[slot.key];
    var names = (cell && cell.names) || [];
    var seen = Object.create(null), out = [];
    names.forEach(function (name, pos) {
      if (seen[name]) return;
      seen[name] = true;
      out.push({ name: name, pos: pos, role: (slot.roles && slot.roles[pos]) || '' });
    });
    return out;
  }

  function pillKey(hospital, date, slotKey, person) {
    return hospital + '|' + date + '|' + slotKey + '|' + person;
  }
  function sevOf(hospital, date, slotKey, person) {
    return D.sevByPill.get(pillKey(hospital, date, slotKey, person)) || null;
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
    D.todayInMonth = !!m && today.slice(0, 7) === m;

    // Una segnalazione si marca una volta sola: sul nome coinvolto e sul giorno.
    D.sevByPill = new Map();
    D.dayFind = new Map();
    D.findingsOfMonth.forEach(function (f) {
      [f.a, f.b].forEach(function (a) {
        var pk = pillKey(a.hospital, a.date, a.slotKey, a.person);
        var prev = D.sevByPill.get(pk);
        if (!prev || f.severity > prev.sev) D.sevByPill.set(pk, { sev: f.severity, title: f.title });
        var dprev = D.dayFind.get(a.date);
        if (!dprev || f.severity > dprev.sev) D.dayFind.set(a.date, { sev: f.severity, title: f.title });
      });
    });

    // Parte fissa delle larghezze della tabella: il nome più lungo per colonna.
    D.tableLens = D.slotRows.map(function (row) {
      var max = 4;
      D.days.forEach(function (d) {
        D.monthRosters.forEach(function (r) {
          var slot = r.slotsByKey[row.key];
          if (!slot) return;
          cellNames(d, r.hospital, slot).forEach(function (n) { if (n.name.length > max) max = n.name.length; });
        });
      });
      return max + 2;
    });

    if (state.pinned && !D.nameMap.has(state.pinned)) state.pinned = null;
    if (!validDay(state.selected)) state.selected = defaultDay();
    if (state.view === 'ore' && !canSeeOre()) state.view = 'calendario';
  }

  function defaultMonth() {
    if (!D.months.length) return '';
    var t = today.slice(0, 7);
    return D.months.indexOf(t) !== -1 ? t : D.months[D.months.length - 1];
  }

  function validDay(date) {
    if (!date || !state.month || date.slice(0, 7) !== state.month) return false;
    var n = dayNum(date);
    return n >= 1 && n <= D.monthLen;
  }

  function defaultDay() {
    if (!state.month) return '';
    return D.todayInMonth ? today : dateOf(state.month, 1);
  }

  function canSeeOre() { return gestore && !soloVista; }

  // Le pastiglie del calendario: mattina + pomeriggio nello stesso ospedale
  // diventano una giornata sola (G); la notte resta N, l'ambulatorio da solo A.
  function chipsByDate(name) {
    var byDate = new Map();
    if (!name) return byDate;
    D.monthAssignments.forEach(function (a) {
      if (a.person !== name) return;
      var perDay = byDate.get(a.date);
      if (!perDay) { perDay = new Map(); byDate.set(a.date, perDay); }
      var list = perDay.get(a.hospital);
      if (!list) { list = []; perDay.set(a.hospital, list); }
      list.push(a);
    });

    var out = new Map();
    byDate.forEach(function (perDay, date) {
      var chips = [];
      D.hospitals.forEach(function (h) {
        var list = perDay.get(h);
        if (!list) return;
        var morning = list.filter(function (a) { return a.slotKey === 'M' || a.slotKey === 'A'; });
        var afternoon = list.filter(function (a) { return a.slotKey === 'P'; });
        var rest = list.filter(function (a) { return a.slotKey !== 'M' && a.slotKey !== 'A' && a.slotKey !== 'P'; });
        if (morning.length && afternoon.length) {
          chips.push({ letter: 'G', word: 'giornata', hospital: h, night: false, a: morning[0] });
        } else {
          morning.concat(afternoon).forEach(function (a) {
            chips.push({ letter: a.slotKey, word: SLOT_WORD[a.slotKey] || R.slotName(a.slotLabel).toLowerCase(), hospital: h, night: false, a: a });
          });
        }
        rest.forEach(function (a) {
          chips.push({
            letter: a.slotKey.charAt(0), word: SLOT_WORD[a.slotKey] || R.slotName(a.slotLabel).toLowerCase(),
            hospital: h, night: a.isNight, a: a,
          });
        });
      });
      chips.sort(function (x, y) {
        var rx = CHIP_RANK[x.letter] !== undefined ? CHIP_RANK[x.letter] : 3;
        var ry = CHIP_RANK[y.letter] !== undefined ? CHIP_RANK[y.letter] : 3;
        if (rx !== ry) return rx - ry;
        return D.hospitals.indexOf(x.hospital) - D.hospitals.indexOf(y.hospital);
      });
      out.set(date, chips);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Indirizzo (hash) — mese, nome, giorno, vista
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
      else if (k === 'vista') state.view = VIEWS.indexOf(v) !== -1 ? v : 'calendario';
    });
  }

  function syncHash() {
    var parts = [];
    if (state.month) parts.push('mese=' + state.month);
    if (state.pinned) parts.push('nome=' + encodeURIComponent(state.pinned));
    if (state.selected) parts.push('giorno=' + state.selected);
    if (state.view !== 'calendario') parts.push('vista=' + state.view);
    var hash = parts.length ? '#' + parts.join('&') : '';
    if (hash !== window.location.hash) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search + hash); }
      catch (e) { /* file:// senza history: si ignora */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Render — titolo, viste, riga della persona
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
    renderPinToken();
  }

  function renderPinToken() {
    clear(pintoken);
    if (!state.pinned) { pintoken.hidden = true; return; }
    pintoken.hidden = false;
    pintoken.appendChild(el('span', { class: 'pintoken__n', text: state.pinned }));
    pintoken.appendChild(el('button', {
      type: 'button', 'aria-label': 'Togli l’evidenziazione di ' + state.pinned,
      on: { click: function (e) { e.preventDefault(); setPinned(null); } },
    }, icon('i-close')));
  }

  function renderPersonLine() {
    clear(personLine);
    if (!state.pinned) { personLine.hidden = true; return; }
    var st = R.personStats(D.assignments, state.pinned, state.month);
    var mine = D.findingsOfMonth.filter(function (f) { return f.person === state.pinned; });
    personLine.hidden = false;

    // La riga è la somma stessa: giornate + notti = turni, e i turni per 12 fanno le ore.
    var terms = [];
    if (st.giornateEq) terms.push(R.formatNumber(st.giornateEq) + 'G');
    if (st.notti) terms.push(st.notti + 'N');
    var parts = [];
    if (terms.length) parts.push(terms.join(' + ') + ' = ' + R.formatNumber(st.turniEq));
    if (st.altri) parts.push(plural(st.altri, 'altro', 'altri'));
    parts.push(R.formatHours(st.ore));
    personLine.title = 'G giornate (mattina + pomeriggio; una mattina o un pomeriggio da soli valgono mezza giornata) · N notti';

    append(personLine, parts.join(' · '));
    var hosps = D.hospitals.filter(function (h) { return st.oreByHospital[h]; });
    if (hosps.length > 1) {
      hosps.forEach(function (h) {
        append(personLine, ' · ');
        personLine.appendChild(dot(h));
        append(personLine, h + ' ' + R.formatHours(st.oreByHospital[h]).replace(' h', ''));
      });
    }
    if (mine.length) {
      append(personLine, ' · ');
      personLine.appendChild(el('button', {
        class: 'linkbtn', type: 'button',
        text: plural(mine.length, 'segnalazione', 'segnalazioni'),
        on: { click: function () { scrollToEl(findEl); findEl.focus({ preventScroll: true }); } },
      }));
    }
    append(personLine, ' · ');
    personLine.appendChild(el('button', {
      // "Esporta", non "Calendario": sullo schermo c'è già la vista con quel nome.
      class: 'linkbtn', type: 'button', id: 'icsBtn', text: 'Esporta',
      'aria-label': 'Scarica i turni di ' + state.pinned + ' nel calendario',
      on: { click: exportICS },
    }));
    personLine.setAttribute('aria-label', personLine.textContent + '. ' + personLine.title);
  }

  function renderMain() {
    var v = state.view;
    var segs = { calendario: segCal, tabella: segTab, ore: segOre };
    segOre.hidden = !canSeeOre();
    VIEWS.forEach(function (name) {
      var on = name === v;
      segs[name].setAttribute('aria-selected', on ? 'true' : 'false');
      segs[name].tabIndex = on ? 0 : -1;
    });
    viewCal.hidden = v !== 'calendario';
    viewTab.hidden = v !== 'tabella';
    viewOre.hidden = v !== 'ore';

    if (v !== 'calendario') { clear(calEl); clear(detailEl); legendEl.hidden = true; }
    if (v !== 'tabella') clear(tableWrap);
    if (v !== 'ore') clear(oreCard);

    if (v === 'calendario') { renderCalendar(); renderDetail(); }
    else if (v === 'tabella') renderTable();
    else renderOre();
  }

  function setView(v) {
    if (state.view === v) return;
    if (v === 'ore' && !canSeeOre()) return;
    state.view = v;
    writeStore(LS_VIEW, v);
    renderMain();
    indexNames();
    applyHighlight();
    syncHash();
  }

  // ---------------------------------------------------------------------------
  // Render — calendario del mese
  // ---------------------------------------------------------------------------

  function renderCalendar() {
    clear(calEl);
    calEl.setAttribute('aria-label', 'Calendario di ' + monthLabel(state.month));
    if (!state.month) return;

    calEl.appendChild(el('div', { class: 'cal__row cal__wd' },
      WEEKDAYS_SHORT_IT.map(function (w) { return el('span', { text: w }); })));

    calName = previewName();
    var chips = chipsByDate(calName);
    var first = dateOf(state.month, 1);
    var lead = (weekdayOf(first) + 6) % 7;
    var cells = [];
    for (var i = lead; i > 0; i--) cells.push({ out: true, n: prevMonthDay(first, i) });
    for (var d = 1; d <= D.monthLen; d++) cells.push({ out: false, n: d, date: dateOf(state.month, d) });
    var after = 1;
    while (cells.length % 7 !== 0) cells.push({ out: true, n: after++ });

    for (var w = 0; w < cells.length; w += 7) {
      var row = el('div', { class: 'cal__row' });
      cells.slice(w, w + 7).forEach(function (c) { row.appendChild(calCell(c, chips)); });
      calEl.appendChild(row);
    }
    renderLegend(chips);
  }

  function prevMonthDay(firstDate, back) {
    return new Date(Date.UTC(Number(firstDate.slice(0, 4)), Number(firstDate.slice(5, 7)) - 1, 1 - back)).getUTCDate();
  }

  function calCell(c, chips) {
    if (c.out) return el('span', { class: 'cal__d is-out' }, el('span', { class: 'cal__n', text: String(c.n) }));

    var date = c.date;
    var isToday = date === today;
    var sel = date === state.selected;
    var mine = chips.get(date) || [];
    var find = D.dayFind.get(date);

    var label = c.n + ' ' + weekdayLong(date);
    if (isToday) label += ', oggi';
    if (mine.length) {
      label += ', ' + mine.map(function (ch) { return ch.word + ' ' + ch.hospital; }).join(', ') + ' di ' + calName;
    } else if (find) label += ', ' + find.title;

    return el('button', {
      class: 'cal__d' + (isWeekend(date) ? ' is-weekend' : '') + (sel ? ' is-sel' : ''),
      type: 'button', 'aria-current': sel ? 'date' : null,
      'aria-label': label, data: { day: date },
    }, [
      el('span', { class: 'cal__n' + (isToday ? ' is-today' : ''), text: String(c.n) }),
      mine.length ? el('span', { class: 'cal__chips' }, mine.slice(0, 4).map(slotChip)) : null,
      (!calName && find) ? el('span', { class: 'cal__dot sev-' + find.sev, title: find.title }) : null,
    ]);
  }

  function slotChip(ch) {
    var f = sevOf(ch.hospital, ch.a.date, ch.a.slotKey, ch.a.person);
    return el('span', {
      class: 'chipslot ' + hospClass(ch.hospital) + (ch.night ? ' is-night' : '') + (f ? ' is-find sev-' + f.sev : ''),
      title: capitalize(ch.word) + ' ' + ch.hospital,
      text: ch.letter,
    });
  }

  // La legenda spiega solo le lettere disegnate per quella persona: chi non fa
  // ambulatorio non deve leggere che cos'è.
  var LEGEND_ORDER = ['G', 'M', 'P', 'N', 'A'];

  function renderLegend(chipsByDay) {
    clear(legendEl);
    var words = new Map();
    if (chipsByDay) {
      chipsByDay.forEach(function (chips) {
        chips.forEach(function (c) {
          if (!words.has(c.letter)) words.set(c.letter, c.letter === 'G' ? 'giornata (M+P)' : c.word);
        });
      });
    }
    if (!calName || !words.size) { legendEl.hidden = true; return; }
    legendEl.hidden = false;
    var letters = Array.from(words.keys()).sort(function (x, y) {
      var ix = LEGEND_ORDER.indexOf(x), iy = LEGEND_ORDER.indexOf(y);
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
    });
    append(legendEl, letters.map(function (k) {
      return el('span', {}, [el('b', { text: k }), words.get(k)]);
    }));
  }

  function previewName() {
    if (state.query.trim() && options.length && state.armedIndex >= 0) {
      var armed = options[state.armedIndex];
      if (armed) return armed.dataset.name;
    }
    return state.pinned;
  }

  function updateCalSelection(prev, next) {
    var before = calEl.querySelector('[data-day="' + prev + '"]');
    if (before) { before.classList.remove('is-sel'); before.removeAttribute('aria-current'); }
    var now = calEl.querySelector('[data-day="' + next + '"]');
    if (now) { now.classList.add('is-sel'); now.setAttribute('aria-current', 'date'); }
  }

  // ---------------------------------------------------------------------------
  // Render — giorno scelto
  // ---------------------------------------------------------------------------

  function namePill(name, sev, opts) {
    return el('button', {
      class: 'pill' + (opts.cls ? ' ' + opts.cls : '') + (sev ? ' sev-' + sev.sev : ''),
      type: 'button', data: { name: name }, title: opts.title, 'aria-label': opts.label,
    }, [
      el('span', { text: name }),
      sev ? el('span', { class: 'fdot', title: sev.title }) : null,
    ]);
  }

  function renderDetail() {
    clear(detailEl);
    detailEl.style.setProperty('--tpl', 'var(--dlabel) repeat(' + Math.max(1, D.hospitals.length) + ', minmax(0, 1fr))');
    var date = state.selected;
    if (!date) return;
    var day = D.dayByDate.get(date);
    detailEl.classList.toggle('is-weekend', isWeekend(date));
    detailEl.classList.toggle('is-pinned', !!state.pinned && !state.query.trim());

    detailEl.appendChild(el('div', { class: 'detail__hd' }, [
      el('button', {
        class: 'navday', type: 'button', 'aria-label': 'Giorno precedente',
        disabled: dayNum(date) <= 1, on: { click: function () { step(-1); } },
      }, icon('i-prev')),
      el('h2', { class: 'detail__t', id: 'detailTitle' }, [
        el('span', { class: 'detail__num', text: String(dayNum(date)) }),
        ' ',
        el('span', { class: 'detail__wd', text: weekdayLong(date) }),
        date === today ? el('span', { class: 'detail__oggi', text: 'oggi' }) : null,
      ]),
      el('button', {
        class: 'navday', type: 'button', 'aria-label': 'Giorno successivo',
        disabled: dayNum(date) >= D.monthLen, on: { click: function () { step(1); } },
      }, icon('i-next')),
    ]));

    if (!day) {
      detailEl.appendChild(el('p', { class: 'detail__none', text: 'Nessun turno per questo giorno.' }));
      return;
    }

    detailEl.appendChild(el('div', { class: 'detail__cols' }, [el('span', {})].concat(
      D.monthRosters.map(function (r) {
        return el('span', { class: 'detail__h', title: r.title || r.hospital }, [dot(r.hospital), r.hospital]);
      })
    )));

    var shown = 0;
    D.slotRows.forEach(function (row) {
      var cells = D.monthRosters.map(function (r) {
        var slot = r.slotsByKey[row.key];
        return slot ? cellNames(day, r.hospital, slot) : null;
      });
      if (!cells.some(function (list) { return list && list.length; })) return;
      shown++;

      detailEl.appendChild(el('div', { class: 'detail__row' + (row.key === 'N' ? ' is-night' : '') }, [
        el('div', { class: 'detail__lab' }, [
          shortSlotName(row.slot.label),
          el('time', { text: R.timeRange(row.slot) }),
        ]),
      ].concat(cells.map(function (list, i) {
        var box = el('div', { class: 'detail__cell' });
        if (!list) return box;
        if (!list.length) { box.appendChild(el('span', { class: 'dash', text: '—' })); return box; }
        var roster = D.monthRosters[i];
        list.forEach(function (n) {
          box.appendChild(namePill(n.name, sevOf(roster.hospital, date, row.key, n.name), {
            title: n.role ? (n.pos + 1) + 'º · ' + n.role : n.name,
            label: n.name + ' — ' + R.slotName(row.slot.label) + ' ' + roster.hospital + (n.role ? ', ' + n.role : ''),
          }));
        });
        return box;
      }))));
    });

    if (!shown) detailEl.appendChild(el('p', { class: 'detail__none', text: 'Nessun turno assegnato in questo giorno.' }));
  }

  // ---------------------------------------------------------------------------
  // Render — tabella del mese
  // ---------------------------------------------------------------------------

  function renderTable() {
    clear(tableWrap);
    if (!D.days.length || !D.slotRows.length) return;
    var table = el('table', { class: 'tab', 'aria-labelledby': 'tabTitle' });

    // Percentuali (non calc(): Chrome le ignora sui <col>), rifatte a ogni cambio
    // di larghezza. 38px vanno alla colonna del giorno e a quella del pallino.
    tableWidth = tableWrap.clientWidth || 366;
    var total = D.tableLens.reduce(function (x, y) { return x + y; }, 0);
    var free = Math.max(140, tableWidth - 38);
    var pct = function (px) { return (px / tableWidth * 100).toFixed(3) + '%'; };
    table.appendChild(el('colgroup', {}, [
      el('col', { style: 'width:' + pct(28) }),
      el('col', { style: 'width:' + pct(10) }),
    ].concat(D.tableLens.map(function (l) { return el('col', { style: 'width:' + pct(free * l / total) }); }))));

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
        tr.appendChild(el('td', { class: 'tab__h' }, [dot(r.hospital), el('span', { class: 'sr-only', text: r.hospital })]));
        D.slotRows.forEach(function (row) {
          var box = el('td', { class: 'tab__c' + (row.key === 'N' ? ' is-night' : '') });
          var slot = r.slotsByKey[row.key];
          if (slot) {
            cellNames(d, r.hospital, slot).forEach(function (n) {
              box.appendChild(namePill(n.name, sevOf(r.hospital, d.date, row.key, n.name), {
                cls: 'pill--t',
                title: n.name + (n.role ? ' · ' + (n.pos + 1) + 'º ' + n.role : ''),
                label: n.name + ' — ' + R.slotName(slot.label) + ' ' + r.hospital + (n.role ? ', ' + n.role : ''),
              }));
            });
          }
          tr.appendChild(box);
        });
        body.appendChild(tr);
      });
    });
    table.appendChild(body);
    table.classList.toggle('is-pinned', !!state.pinned && !state.query.trim());
    tableWrap.appendChild(table);
  }

  function tableDayCell(d) {
    return el('th', { class: 'tab__day', scope: 'row', rowspan: '2' },
      el('button', {
        class: 'tab__daybtn', type: 'button', data: { goday: d.date },
        'aria-label': d.day + ' ' + weekdayLong(d.date) + ': apri nel calendario',
      }, [
        el('span', { class: 'n' + (d.date === today ? ' is-today' : ''), text: String(d.day) }),
        el('span', { class: 'wd', text: R.formatDate(d.date).split(' ')[0] }),
      ]));
  }

  // ---------------------------------------------------------------------------
  // Render — ore per nome
  // ---------------------------------------------------------------------------

  function renderOre() {
    clear(oreCard);
    var rows = R.hoursByName(D.assignments, state.month);
    oreCard.appendChild(el('div', { class: 'ore__head' },
      el('h2', { class: 'stitle', text: 'Ore di ' + monthName(state.month) })));
    oreCard.appendChild(el('p', { class: 'ore__legend' }, D.hospitals.map(function (h) {
      return el('span', {}, [dot(h), h]);
    })));
    if (!rows.length) {
      oreCard.appendChild(el('p', { class: 'cap', text: 'Nessun turno in questo mese.' }));
      return;
    }

    var max = rows[0].ore || 1;
    rows.forEach(function (st) {
      var parts = [st.person, R.formatHours(st.ore)];
      D.hospitals.forEach(function (h) {
        if (st.oreByHospital[h]) parts.push(h + ' ' + R.formatHours(st.oreByHospital[h]));
      });
      if (st.notti) parts.push(plural(st.notti, 'notte', 'notti'));
      var label = parts.join(' · ');

      oreCard.appendChild(el('div', { class: 'ore__row', title: label }, [
        el('button', {
          class: 'pill ore__name', type: 'button', data: { name: st.person },
          'aria-label': label, text: st.person,
        }),
        el('div', { class: 'ore__bar' }, D.hospitals.filter(function (h) { return st.oreByHospital[h] > 0; })
          .map(function (h) {
            return el('span', {
              class: 'ore__seg ' + hospClass(h),
              style: 'width:' + (st.oreByHospital[h] / max * 100).toFixed(2) + '%',
            });
          })),
        el('span', { class: 'ore__v', text: R.formatHours(st.ore).replace(' h', '') }),
      ]));
    });
  }

  // ---------------------------------------------------------------------------
  // Render — segnalazioni
  // ---------------------------------------------------------------------------

  function renderFindings() {
    clear(findEl);
    var list = D.findingsOfMonth;

    var counts = {};
    list.forEach(function (f) { counts[f.kind] = (counts[f.kind] || 0) + 1; });
    var countText = KIND_ORDER.filter(function (k) { return counts[k]; })
      .map(function (k) { return plural(counts[k], KIND_PLURAL[k][0], KIND_PLURAL[k][1]); })
      .join(' · ');

    findEl.appendChild(el('div', { class: 'findings__head' }, [
      el('h2', { class: 'stitle', id: 'findingsTitle', text: 'Segnalazioni' }),
      countText ? el('span', { class: 'cap', text: countText }) : null,
    ]));

    if (!list.length) {
      findEl.appendChild(el('p', { class: 'fempty' }, [icon('i-check'), 'Nessuna segnalazione a ' + monthName(state.month)]));
    } else {
      var kinds = KIND_ORDER.filter(function (k) { return list.some(function (f) { return f.kind === k; }); });
      kinds.forEach(function (kind) {
        var group = list.filter(function (f) { return f.kind === kind; });
        findEl.appendChild(el('div', { class: 'fgroup' }, [
          kinds.length > 1 ? el('p', { class: 'fgroup__t', text: plural(group.length, KIND_PLURAL[kind][0], KIND_PLURAL[kind][1]) }) : null,
          el('div', {}, group.map(findingItem)),
        ]));
      });
    }

    findEl.appendChild(el('details', { class: 'legenda' }, [
      el('summary', { class: 'legenda__t' }, [icon('i-chevron'), 'Come si calcolano']),
    ].concat(LEGEND.map(function (row) {
      return el('div', { class: 'legenda__row' }, [
        el('span', { class: 'legenda__mark sev-' + row[0] }),
        el('span', {}, [el('b', { text: row[1] }), ' — ' + row[2]]),
      ]);
    }))));
  }

  function findingItem(f) {
    return el('div', { class: 'fitem sev-' + f.severity, data: { goto: f.a.date }, title: f.detail }, [
      el('button', {
        class: 'fitem__who', type: 'button', data: { name: f.person },
        'aria-label': 'Evidenzia ' + f.person, text: f.person,
      }),
      ' ',
      el('button', {
        class: 'fitem__short', type: 'button', text: f.short,
        'aria-label': f.title + ': ' + f.detail + '. Vai al giorno.',
      }),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Render — dati e sorgenti
  // ---------------------------------------------------------------------------

  function shortDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONTHS_IT[d.getMonth()].slice(0, 3);
  }

  function formatGenerated(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.getDate() + ' ' + MONTHS_IT[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear() +
      ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function renderDati() {
    var stamp = (shared && shared.generatedAt) || GENERATED_AT;
    datiSumText.textContent = stamp ? 'Dati · aggiornati il ' + shortDate(stamp) : 'Dati';
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
      ].concat(warnings.map(warnRow))));
    }

    var suspicious = D.namesAll.filter(function (n) { return n.suspicion; });
    if (suspicious.length) {
      datiBody.appendChild(el('div', { class: 'dati__block' }, [
        el('p', { class: 'dati__t', text: 'Nomi da controllare' }),
      ].concat(suspicious.map(function (n) { return warnRow(n.name + ' — ' + suspicionText(n.suspicion)); }))));
    }

    datiBody.appendChild(el('div', { class: 'dati__block' + (soloVista ? ' is-off' : '') }, [
      el('p', { class: 'dati__t', text: 'Aggiornare i turni' }),
      el('button', {
        class: 'btn', type: 'button', disabled: soloVista, 'aria-disabled': soloVista ? 'true' : null,
        on: { click: function () { if (!soloVista) fileInput.click(); } },
      }, [icon('i-upload'), 'Carica xlsx']),
      soloVista ? el('p', { class: 'dati__note', text: 'Solo chi gestisce la pagina può aggiornare i turni.' }) : null,
      stamp ? el('p', { class: 'dati__note', text: (shared ? 'Dati condivisi aggiornati il ' : 'Dati pubblicati il ') + formatGenerated(stamp) + '.' }) : null,
    ]));

    // Togliere le proprie copie resta possibile anche a chi può solo guardare.
    if (local.length) {
      datiBody.appendChild(el('div', { class: 'dati__block' },
        el('button', {
          class: 'btn', type: 'button', text: 'Ripristina i dati pubblicati', on: { click: restorePublished },
        })));
    }

    if (role) {
      datiBody.appendChild(el('div', { class: 'dati__block' },
        el('button', {
          class: 'minibtn', type: 'button', text: 'Esci',
          on: { click: function () {
            var reload = function () { window.location.reload(); };
            try { window.fetch('logout', { method: 'POST' }).then(reload, reload); }
            catch (e) { reload(); }
          } },
        })));
    }

    if (!role && !soloVista && !gestore) {
      var check = el('input', { type: 'checkbox', role: 'switch' });
      check.addEventListener('change', function () {
        gestore = check.checked;
        writeStore(LS_GESTORE, gestore ? '1' : null);
        renderMain();
        renderDati();
        indexNames();
        applyHighlight();
      });
      datiBody.appendChild(el('div', { class: 'dati__block' },
        el('label', { class: 'switch' }, [check, el('span', { class: 'switch__track' }), 'Mostra le ore di tutti'])));
    }
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
    [detailEl, tableWrap, oreCard, findEl].forEach(function (root) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-name]'), add);
    });
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

    if (state.query.trim()) {
      dim(false);
      hits.forEach(function (n) { paint(n.name, 'is-soft'); });
      var armed = hits[state.armedIndex];
      if (armed) paint(armed.name, 'is-strong');
    } else if (state.pinned) {
      dim(true);
      paint(state.pinned, 'is-strong');
    } else {
      dim(false);
    }

    if (state.view === 'calendario' && previewName() !== calName) renderCalendar();
  }

  // ---------------------------------------------------------------------------
  // Elenco dei nomi sotto il campo
  // ---------------------------------------------------------------------------

  function renderPop() {
    clear(pop);
    options = [];
    var q = state.query.trim();
    hits = R.searchNames(q, D.names);

    if (!hits.length) {
      pop.appendChild(el('p', { class: 'opt__empty', text: 'Nessun nome corrisponde a «' + q + '»' }));
      openPop();
      srSay('Nessun nome corrisponde');
      return;
    }
    if (!q) state.armedIndex = -1;
    else if (state.armedIndex >= hits.length || state.armedIndex < 0) state.armedIndex = 0;

    hits.forEach(function (n, i) {
      var parts = q ? matchParts(n.name, q) : null;
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
          .map(function (h) { return dot(h, h); })),
      ]);
      options.push(row);
      pop.appendChild(row);
    });

    openPop();
    if (q) srSay(plural(hits.length, 'nome trovato', 'nomi trovati'));
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
    applyPendingShared();
  }

  function moveArmed(delta) {
    if (!options.length) return;
    if (state.armedIndex < 0) state.armedIndex = delta > 0 ? 0 : options.length - 1;
    else state.armedIndex = (state.armedIndex + delta + options.length) % options.length;
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
    writeStore(LS_ME, name);
    state.query = '';
    input.value = '';
    clearBtn.hidden = true;
    closePop();
    if (document.activeElement === input) input.blur();

    keepAnchor(function () {
      renderPinToken();
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

  // La vista resta dov'è quando sopra compare o sparisce la riga della persona.
  function keepAnchor(fn, skip) {
    var anchor = state.view === 'calendario' ? detailEl : (state.view === 'tabella' ? viewTab : viewOre);
    if (skip) { fn(); return; }
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
    if (state.view !== 'calendario') { syncHash(); return; }
    updateCalSelection(prev, date);
    renderDetail();
    indexNames();
    applyHighlight();
    syncHash();
    if (opts.scroll) scrollToEl(detailEl);
    if (opts.flash) flash(detailEl);
  }

  function step(delta) {
    var n = dayNum(state.selected) + delta;
    if (n < 1 || n > D.monthLen) return;
    selectDay(dateOf(state.month, n));
  }

  // Dalla segnalazione al giorno: nel calendario lo sceglie, nella tabella porta
  // al gruppo di righe. In entrambi i casi lampeggia.
  function goToDay(date) {
    if (state.view === 'tabella') {
      if (validDay(date)) { state.selected = date; syncHash(); }
      var rows = tableWrap.querySelectorAll('tr[data-date="' + date + '"]');
      if (rows.length) { scrollToEl(rows[0]); flash(rows); }
      return;
    }
    selectDay(date, { scroll: true, flash: true });
  }

  function scrollToEl(node, instant) {
    if (!node) return;
    node.scrollIntoView({ block: 'start', behavior: (instant || reduceMotion.matches) ? 'instant' : 'smooth' });
  }

  function flash(nodes) {
    if (reduceMotion.matches) return;
    var list = nodes.length !== undefined ? Array.prototype.slice.call(nodes) : [nodes];
    list.forEach(function (node) {
      node.classList.remove('is-flash');
      void node.offsetWidth;
      node.classList.add('is-flash');
      window.setTimeout(function () { node.classList.remove('is-flash'); }, 1400);
    });
  }

  function srSay(text) { if (text) srStatus.textContent = text; }

  // ---------------------------------------------------------------------------
  // Esportazione nel calendario (.ics)
  // ---------------------------------------------------------------------------

  var ICS_NOT_HERE = 'Il calendario si esporta dalla copia della pagina, non da qui.';
  var ICS_NO_WAY = ['rejected_extension', 'extension_not_enabled', 'unavailable', 'not_granted', 'capability_disabled'];

  function slug(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function exportICS() {
    var name = state.pinned;
    if (!name) return;
    var data = R.buildICS(D.assignments, name, state.month, {});
    var filename = 'turni-' + slug(name) + '-' + slug(monthName(state.month)) + '-' + state.month.slice(0, 4) + '.ics';

    // Nella pagina pubblicata il salvataggio passa dalla piattaforma; altrove
    // (copia locale, sito normale) basta il vecchio link con download.
    if (!runtime) { saveAsFile(filename, data); return; }
    Promise.resolve(window.claude.use('downloads')).then(function (ns) {
      if (!ns || typeof ns.save !== 'function') { toast(ICS_NOT_HERE, true); return; }
      return Promise.resolve(ns.save({ filename: filename, data: data })).catch(function (err) {
        var code = (err && err.code) || 'errore';
        if (code === 'declined') return;
        toast(ICS_NO_WAY.indexOf(code) !== -1 ? ICS_NOT_HERE : 'Esportazione non riuscita (' + code + ').', true);
      });
    }).catch(function () { toast(ICS_NOT_HERE, true); });
  }

  function saveAsFile(filename, data) {
    try {
      var url = URL.createObjectURL(new Blob([data], { type: 'text/calendar;charset=utf-8' }));
      var link = el('a', { href: url, download: filename });
      document.body.appendChild(link);
      link.click();
      window.setTimeout(function () { link.remove(); URL.revokeObjectURL(url); }, 0);
    } catch (e) {
      toast('Esportazione non riuscita.', true);
    }
  }

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
  // Caricamento dei file e revisione delle modifiche
  // ---------------------------------------------------------------------------

  function loadFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var queue = [];
    var chain = Promise.resolve();
    files.forEach(function (file) { chain = chain.then(function () { return parseOne(file, queue); }); });
    chain.then(function () {
      reviewQueue = queue;
      reviewTotal = queue.length;
      reviewDone = 0;
      nextReview();
    });
  }

  function parseOne(file, queue) {
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
        var existing = null;
        D.rosters.forEach(function (r) { if (rosterKey(r) === rosterKey(roster)) existing = r; });
        if (!existing) { queue.push({ roster: roster, existing: null, diff: null }); return; }
        var diff = R.diffRosters(existing, roster);
        if (!diff.changes.length) {
          toast(roster.hospital + ' · ' + monthLabel(roster.month) + ': nessuna modifica rispetto alla versione caricata');
          return;
        }
        queue.push({ roster: roster, existing: existing, diff: diff });
      })
      .catch(function (err) {
        toast(file.name + ': ' + ((err && err.message) || 'file non leggibile'), true);
      });
  }

  function nextReview() {
    if (!reviewQueue.length) { closeReview(); return; }
    reviewCurrent = reviewQueue.shift();
    reviewDone++;
    renderReview(reviewCurrent);
    openReview();
  }

  function renderReview(item) {
    var roster = item.roster;
    var isNew = !item.existing;
    clear(reviewBody);

    reviewTitle.textContent = (isNew ? 'Nuovo mese: ' : 'Modifiche · ') + roster.hospital + ' · ' + monthLabel(roster.month);

    var caps = [];
    if (reviewTotal > 1) caps.push(reviewDone + ' di ' + reviewTotal);
    caps.push(roster.file);
    if (item.existing) {
      caps.push(item.existing.source === 'browser' ? 'sostituisce la versione dal browser' : 'sostituisce la versione pubblicata');
    }
    reviewCap.textContent = caps.join(' · ');

    if (isNew) {
      var names = allNames(roster);
      reviewBody.appendChild(el('p', { class: 'chg__sum', text: plural((roster.days || []).length, 'giorno', 'giorni') +
        ' · ' + plural(names.length, 'nome', 'nomi') + ' · ' + plural((roster.slots || []).length, 'fascia', 'fasce') }));
      if (names.length) {
        reviewBody.appendChild(el('p', { class: 'chg__sum', text: 'Tra i nomi: ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '') }));
      }
    } else {
      var lastDate = null;
      item.diff.changes.forEach(function (c) {
        if (c.date !== lastDate) {
          lastDate = c.date;
          var parts = R.formatDate(c.date).split(' ');
          reviewBody.appendChild(el('div', { class: 'chg__day' + (isWeekend(c.date) ? ' is-weekend' : '') },
            parts[0] + ' ' + parts[1]));
        }
        reviewBody.appendChild(changeRow(c));
      });
    }

    var warnings = roster.warnings || [];
    if (warnings.length) {
      reviewBody.appendChild(el('div', { class: 'chg__block' }, [
        el('p', { class: 'dati__t', text: 'Avvisi del file' }),
      ].concat(warnings.map(function (w) { return warnRow(w.message || w.type); }))));
    }

    reviewSave.disabled = false;
    reviewCancel.disabled = false;
    reviewSave.textContent = saveLabel();
  }

  function allNames(roster) {
    var seen = Object.create(null), out = [];
    (roster.days || []).forEach(function (d) {
      Object.keys(d.cells || {}).forEach(function (k) {
        ((d.cells[k] && d.cells[k].names) || []).forEach(function (n) {
          if (!seen[n]) { seen[n] = true; out.push(n); }
        });
      });
    });
    return out.sort(function (x, y) { return x.localeCompare(y, 'it'); });
  }

  function changeRow(c) {
    var val = el('span', { class: 'chg__val' });
    if (c.kind === 'replaced') {
      val.appendChild(el('span', { class: 'chg__old', text: c.removed.join(' · ') }));
      append(val, ' → ');
      val.appendChild(el('span', { class: 'chg__new', text: c.added.join(' · ') }));
    } else if (c.kind === 'added') {
      append(val, '+ ');
      val.appendChild(el('span', { class: 'chg__add', text: c.added.join(' · ') }));
    } else if (c.kind === 'removed') {
      append(val, '− ');
      val.appendChild(el('span', { class: 'chg__del', text: c.removed.join(' · ') }));
    } else {
      val.appendChild(el('span', { class: 'chg__new', text: c.after.join(' · ') }));
      val.appendChild(el('span', { class: 'chg__note', text: 'solo l’ordine è cambiato' }));
    }
    return el('div', { class: 'chg' + (c.slotKey === 'N' ? ' is-night' : '') }, [
      el('span', { class: 'chg__slot', text: shortSlotName(c.slotLabel) }),
      val,
    ]);
  }

  function openReview() {
    if (reviewEl.hidden) reviewOpener = document.activeElement;
    reviewEl.hidden = false;
    document.body.style.overflow = 'hidden';
    reviewPanel.focus();
  }

  function closeReview() {
    reviewEl.hidden = true;
    reviewCurrent = null;
    document.body.style.overflow = '';
    if (reviewOpener && reviewOpener.focus) reviewOpener.focus();
    reviewOpener = null;
    applyPendingShared();
  }

  function saveLabel() { return (role === 'gestore' || (pub && !soloVista)) ? 'Salva per tutti' : 'Salva'; }

  function whatChanged(item) {
    return item.roster.hospital + ' · ' + monthLabel(item.roster.month) + ' · ' +
      (item.diff ? plural(item.diff.changes.length, 'modifica', 'modifiche') : 'nuovo mese');
  }

  function markGestore() {
    if (role) return;          // decide il server: la memoria locale non c'entra
    if (soloVista) return;
    gestore = true;
    writeStore(LS_GESTORE, '1');
  }

  function saveHere(item) {
    var roster = item.roster;
    roster.source = 'browser';
    local = local.filter(function (r) { return rosterKey(r) !== rosterKey(roster); });
    local.push(roster);
    if (!writeLocal(local)) toast('I turni sono caricati ma non restano in memoria (spazio del browser non disponibile)', true);
    markGestore();
    state.month = roster.month;
    state.selected = '';
    renderAll();
  }

  function stripRuntime(roster) {
    var copy = Object.assign({}, roster);
    delete copy.source;
    delete copy.replaces;
    delete copy.slotsByKey;
    return copy;
  }

  function buildNext(roster) {
    var base = (shared && shared.rosters) ? shared.rosters : BAKED;
    var map = new Map();
    base.forEach(function (r) { map.set(rosterKey(r), stripRuntime(r)); });
    map.set(rosterKey(roster), stripRuntime(roster));
    return { generatedAt: new Date().toISOString(), rosters: Array.from(map.values()) };
  }

  function setReviewBusy(busy) {
    reviewSave.disabled = busy;
    reviewCancel.disabled = busy;
    reviewSave.textContent = busy ? 'Pubblico…' : saveLabel();
  }

  function saveReview() {
    var item = reviewCurrent;
    if (!item) return;
    if (role === 'gestore') { putReview(item); return; }
    if (!pub || soloVista) {
      saveHere(item);
      toast('Salvato: ' + whatChanged(item));
      nextReview();
      return;
    }
    publishReview(item);
  }

  // Con le password del server: il file dei dati si aggiorna con una PUT.
  function putReview(item) {
    var next = buildNext(item.roster);
    setReviewBusy(true);
    var done = function () { setReviewBusy(false); nextReview(); };
    var fallback = function () {
      saveHere(item);
      toast('Salvato solo su questo dispositivo (il server non risponde).', true);
      done();
    };
    window.fetch('data/turni.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).then(function (r) {
      if (r.status === 200) {
        shared = next;
        local = local.filter(function (x) { return rosterKey(x) !== rosterKey(item.roster); });
        writeLocal(local);
        state.month = item.roster.month;
        state.selected = '';
        renderAll();
        toast('Salvato per tutti: ' + whatChanged(item));
        done();
        return;
      }
      if (r.status === 401) toast('Sessione scaduta: ricarica la pagina ed entra di nuovo.', true);
      else if (r.status === 403) toast('Non hai i permessi per aggiornare i turni.', true);
      else if (r.status === 400 || r.status === 413) toast('Il file non è stato accettato dal server.', true);
      else { fallback(); return; }
      done();
    }).catch(fallback);
  }

  // Pubblica il file dei dati: la pagina resta quella, cambia solo data/turni.json.
  function publishReview(item) {
    var next = buildNext(item.roster);
    setReviewBusy(true);
    var done = function () { setReviewBusy(false); nextReview(); };
    Promise.resolve(pub.publish({
      'data/turni.json': { content: JSON.stringify(next), contentType: 'application/json' },
    })).then(function () {
      shared = next;
      local = local.filter(function (r) { return rosterKey(r) !== rosterKey(item.roster); });
      writeLocal(local);
      markGestore();
      state.month = item.roster.month;
      state.selected = '';
      renderAll();
      toast('Pubblicato per tutti: ' + whatChanged(item));
      done();
    }).catch(function (err) {
      var code = (err && err.code) || 'errore';
      if (code === 'conflict') {
        setReviewBusy(false);
        reviewQueue = [];
        closeReview();
        toast('Qualcun altro ha appena pubblicato: la pagina si aggiorna', true);
        return;
      }
      if (code === 'not_writer' || code === 'not_granted' || code === 'capability_disabled') {
        soloVista = true;
        gestore = false;
        writeStore(LS_GESTORE, null);
        saveHere(item);
        toast(code === 'capability_disabled'
          ? 'Salvataggio condiviso non disponibile qui: salvato solo su questo dispositivo'
          : 'Non puoi pubblicare questa pagina: salvato solo su questo dispositivo', true);
      } else {
        saveHere(item);
        toast('Pubblicazione non riuscita (' + code + '): salvato solo su questo dispositivo', true);
      }
      done();
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
    searchbar.hidden = !hasData;
    viewCal.hidden = !hasData;
    viewTab.hidden = true;
    viewOre.hidden = true;
    findEl.hidden = !hasData;
    datiEl.hidden = !hasData && !local.length;

    renderHeader();
    if (hasData) {
      renderPersonLine();
      renderMain();
      renderFindings();
    } else {
      personLine.hidden = true;
      legendEl.hidden = true;
      clear(calEl); clear(detailEl); clear(tableWrap); clear(oreCard);
    }
    renderDati();
    indexNames();
    applyHighlight();
    syncHash();
    measureHeader();
  }

  function measureHeader() {
    document.documentElement.style.setProperty('--h-header', searchbar.offsetHeight + 'px');
  }

  // ---------------------------------------------------------------------------
  // Dati condivisi e piattaforma
  // ---------------------------------------------------------------------------

  function validShared(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.rosters) || !data.rosters.length) return false;
    return data.rosters.every(function (r) {
      return r && typeof r.hospital === 'string' && typeof r.month === 'string' &&
        Array.isArray(r.days) && Array.isArray(r.slots);
    });
  }

  // Mai ridisegnare sotto le dita: se un foglio è aperto, i dati arrivati aspettano.
  function applyPendingShared() {
    if (!pendingShared || !reviewEl.hidden || state.popOpen) return;
    shared = pendingShared;
    pendingShared = null;
    renderAll();
    srSay('Dati condivisi aggiornati');
  }

  function boot() {
    if (/^https?:$/.test(window.location.protocol) && typeof window.fetch === 'function') {
      window.fetch('data/turni.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!validShared(data)) return;
          pendingShared = data;
          applyPendingShared();
        })
        .catch(function () { /* nessun file condiviso: restano i dati della pagina */ });
    }
    if (runtime) {
      try {
        Promise.resolve(window.claude.use('artifact')).then(function (ns) {
          pub = (ns && typeof ns.publish === 'function') ? ns : null;
          if (!reviewEl.hidden && reviewCurrent) reviewSave.textContent = saveLabel();
        }).catch(function () { pub = null; });
      } catch (e) { pub = null; }
    }
  }

  // Il giorno di oggi non deve invecchiare con la pagina aperta.
  function refreshToday() {
    var now = todayISO();
    if (now === today) return;
    today = now;
    renderAll();
  }

  // ---------------------------------------------------------------------------
  // Eventi
  // ---------------------------------------------------------------------------

  function wire() {
    input.addEventListener('input', function () {
      state.query = input.value;
      state.armedIndex = input.value.trim() ? 0 : -1;
      clearBtn.hidden = !input.value;
      renderPop();
      applyHighlight();
    });

    input.addEventListener('focus', function () { renderPop(); });

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
      input.value = ''; state.query = ''; state.armedIndex = -1;
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

    // Un solo ascoltatore per pastiglie, celle del calendario e segnalazioni.
    document.addEventListener('click', function (e) {
      var named = e.target.closest('[data-name]');
      if (named && !named.closest('.opt')) { togglePin(named.dataset.name); return; }
      var goday = e.target.closest('[data-goday]');
      if (goday) {
        selectDay(goday.dataset.goday);
        setView('calendario');
        window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
        return;
      }
      var cell = e.target.closest('[data-day]');
      if (cell) { selectDay(cell.dataset.day); return; }
      var goto = e.target.closest('[data-goto]');
      if (goto) goToDay(goto.dataset.goto);
    });

    segCal.addEventListener('click', function () { setView('calendario'); });
    segTab.addEventListener('click', function () { setView('tabella'); });
    segOre.addEventListener('click', function () { setView('ore'); });
    $('segbar').addEventListener('keydown', function (e) {
      var keys = { ArrowLeft: -1, ArrowRight: 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      var shown = VIEWS.filter(function (v) { return v !== 'ore' || canSeeOre(); });
      var i = shown.indexOf(state.view);
      var next = shown[(i + keys[e.key] + shown.length) % shown.length];
      setView(next);
      var btn = { calendario: segCal, tabella: segTab, ore: segOre }[next];
      if (btn) btn.focus();
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

    $('emptyUpload').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { loadFiles(fileInput.files); fileInput.value = ''; });

    reviewSave.addEventListener('click', saveReview);
    reviewCancel.addEventListener('click', nextReview);
    $('reviewScrim').addEventListener('click', nextReview);
    document.addEventListener('keydown', function (e) {
      if (reviewEl.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); nextReview(); return; }
      if (e.key !== 'Tab') return;
      var focusable = reviewPanel.querySelectorAll('button:not([disabled])');
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === reviewPanel)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });

    window.addEventListener('resize', function () {
      measureHeader();
      if (state.view === 'tabella' && Math.abs(tableWrap.clientWidth - tableWidth) > 2) {
        renderTable();
        indexNames();
        applyHighlight();
      }
    });

    window.addEventListener('hashchange', function () {
      var before = state.month + '|' + state.pinned + '|' + state.selected + '|' + state.view;
      readHash();
      if (before !== state.month + '|' + state.pinned + '|' + state.selected + '|' + state.view) renderAll();
    });

    window.addEventListener('focus', refreshToday);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshToday(); });
  }

  // ---------------------------------------------------------------------------
  // Avvio
  // ---------------------------------------------------------------------------

  function init() {
    var savedView = readStore(LS_VIEW);
    if (VIEWS.indexOf(savedView) !== -1) state.view = savedView;
    readHash();
    if (!state.pinned) state.pinned = readStore(LS_ME);
    wire();
    renderAll();
    if (state.pinned) srSay(state.pinned + ' evidenziato');
    boot();
  }

  init();
})();
