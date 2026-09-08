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
  var LS_SITES = 'imieiturni.sedi';
  var LS_SIMPL = 'imieiturni.semplifica';
  var LS_INTRO = 'imieiturni.intro';
  var LS_DEV = 'imieiturni.dev';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  var WEEKDAYS_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì',
    'giovedì', 'venerdì', 'sabato'];
  var WEEKDAYS_SHORT_IT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

  var SLOT_RANK = { M: 0, P: 1, N: 2 };          // ordine delle righe e delle colonne: il resto in coda
  var CHIP_RANK = { G: 0, M: 0, A: 0, P: 1, N: 2 };   // fra le pastiglie l'ambulatorio sta con la mattina
  var SLOT_WORD = { G: 'giornata', M: 'mattina', P: 'pomeriggio', N: 'notte', A: 'ambulatorio' };

  var VIEWS = ['tabella', 'calendario', 'ore'];
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
  function hospKey(h) { return hospClass(h).slice(2); }

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

  function readSites() {
    try {
      var raw = window.localStorage.getItem(LS_SITES);
      var parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.filter(function (x) { return typeof x === 'string'; }) : null;
    } catch (e) { return null; }
  }

  function writeSites(list) {
    try { window.localStorage.setItem(LS_SITES, JSON.stringify(list)); } catch (e) { /* pazienza */ }
  }

  function isOn(hospital) { return !sites || sites.indexOf(hospital) !== -1; }

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
    view: 'tabella',
    selected: '',
    query: '',
    armedIndex: 0,
    pinned: null,
    popOpen: false,
    simplify: readStore(LS_SIMPL) === '1',
  };

  var local = readLocal();
  var sites = readSites();    // sedi accese: almeno una, sempre
  var shared = null;          // data/turni.json pubblicato nell'artifact
  var pendingShared = null;   // arrivato mentre un foglio era aperto
  var pub = null;             // spazio dei nomi "artifact" della piattaforma
  var runtime = !!(window.claude && typeof window.claude.use === 'function');
  // Se la pagina passa da un server con le due password, il ruolo lo decide lui.
  var role = (window.TURNI_ROLE === 'gestore' || window.TURNI_ROLE === 'medico') ? window.TURNI_ROLE : null;
  var gestore = role ? role === 'gestore' : (!runtime || readStore(LS_GESTORE) === '1');
  var soloVista = role === 'medico';
  // Se la pagina arriva dal Worker c'è un ruolo scritto dentro: solo lì esiste
  // la rotta cal-link, quindi solo lì il calendario si può abbonare.
  var onWorker = typeof window.TURNI_ROLE === 'string' && !!window.TURNI_ROLE;
  var calLink = null;
  var installEvent = null;      // beforeinstallprompt messo da parte (Android)
  var sheetMode = 'review';     // lo stesso foglio serve revisione, presentazione e uso
  var ricerche = [];            // i nomi fissati in questa sessione
  var usoSent = false;

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
    emptyEl = $('empty'), totaleEl = $('totale'), calEl = $('calendario'), legendEl = $('callegend'),
    detailEl = $('detail'), findEl = $('segnalazioni'), bottomEl = $('bottom'),
    sitesEl = $('sites'), updatedEl = $('updated'),
    filtersRow = $('filtersrow'), sitesLabel = $('sitesLabel'), simplBtn = $('simplBtn'),
    fileInput = $('fileInput'), toasts = $('toasts'), srStatus = $('srStatus'),
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

  // Con Semplifica mattina e pomeriggio diventano una colonna sola, «Giorno»:
  // ogni persona si scrive una volta, con accanto la parte di giornata che copre.
  // Le altre fasce restano dov'erano. Spento, le colonne sono quelle del foglio.
  function columns() {
    var rows = D.slotRows, out = [];
    for (var i = 0; i < rows.length; i++) {
      if (state.simplify && rows[i].key === 'M' && rows[i + 1] && rows[i + 1].key === 'P') {
        out.push({ key: 'MP', day: true, mi: i, pi: i + 1, slot: daySlot(rows[i].slot, rows[i + 1].slot) });
        i++;
      } else {
        out.push({ key: rows[i].key, idx: i, row: rows[i], slot: rows[i].slot });
      }
    }
    return out;
  }

  // La fascia finta della colonna unita: serve al titolo e al riquadro che spiega.
  function daySlot(m, p) {
    return { label: 'GIORNO', start: m.start, end: p.end, sub: m.sub || p.sub || '', roles: m.roles || [] };
  }

  // Le righe di una cella «Giorno»: una per persona, in ordine di ruolo, e
  // dentro lo stesso ruolo prima chi fa solo la mattina, poi solo il pomeriggio.
  function dayLines(r, day) {
    var ms = r.slotsByKey.M, ps = r.slotsByKey.P;
    var m = ms && day ? cellNames(day, r.hospital, ms) : [];
    var p = ps && day ? cellNames(day, r.hospital, ps) : [];
    var out = [];
    for (var i = 0; i < Math.max(m.length, p.length); i++) {
      var a = m[i], b = p[i];
      if (a && b && a.name === b.name) { out.push({ n: a, span: 'MP' }); continue; }
      if (a) out.push({ n: a, span: 'M' });
      if (b) out.push({ n: b, span: 'P' });
    }
    return out;
  }

  // "08–14" + "14–20" → "8–20"; una fascia sola → "8–14". Sempre presente:
  // una riga senza etichetta vorrebbe dire qualcosa che nessuno può indovinare.
  function spanChip(r, span) {
    var ms = r.slotsByKey.M, ps = r.slotsByKey.P;
    var from = span === 'P' ? ps : ms, to = span === 'M' ? ms : ps;
    var a = String(R.timeRange(from)).split('–'), b = String(R.timeRange(to)).split('–');
    return noZero(a[0]) + '–' + noZero(b[1] || b[0]);
  }
  function noZero(t) { return String(t).replace(/^0/, ''); }

  var SPAN_WORD = { MP: 'mattina e pomeriggio', M: 'mattina', P: 'pomeriggio' };

  // Nella cella unita il nome sta in due fasce: vale la segnalazione più grave.
  function sevPair(hospital, date, person) {
    var a = sevOf(hospital, date, 'M', person), b = sevOf(hospital, date, 'P', person);
    if (!a) return b;
    if (!b) return a;
    return b.sev > a.sev ? b : a;
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

    var m = state.month;
    var monthAll = rosters.filter(function (r) { return r.month === m; }).sort(hospitalOrder);
    D.allHospitals = monthAll.map(function (r) { return r.hospital; });
    pruneSites();

    // Le sedi spente escono dai dati qui: i renderer non sanno del filtro.
    var visible = rosters.filter(function (r) { return isOn(r.hospital); });
    D.assignments = R.buildAssignments(visible);
    D.namesAll = R.analyzeNames(D.assignments);
    // Le segnalazioni si calcolano su tutto: una coppia fra due sedi resta vera
    // anche se una delle due è spenta.
    D.findings = R.computeFindings(R.buildAssignments(rosters));

    D.monthRosters = monthAll.filter(function (r) { return isOn(r.hospital); });
    D.hospitals = D.monthRosters.map(function (r) { return r.hospital; });
    D.monthAssignments = D.assignments.filter(function (a) { return a.date.slice(0, 7) === m; });
    D.names = namesOfMonth(D.namesAll, D.monthAssignments);
    D.nameMap = new Map(D.names.map(function (n) { return [n.name, n]; }));
    D.findingsOfMonth = D.findings.filter(function (f) {
      var inMonth = f.a.date.slice(0, 7) === m || f.b.date.slice(0, 7) === m;
      return inMonth && (isOn(f.a.hospital) || isOn(f.b.hospital));
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

    // Larghezze della tabella: per ogni colonna i nomi più lunghi, che renderTable
    // misura poi col font vero (i caratteri non bastano: ORLANDITOSKIC ha 13 lettere
    // ma è più stretto di SANTAMBROGIO, che ne ha 12).
    D.tableNames = D.slotRows.map(function (row) {
      var seen = Object.create(null);
      D.days.forEach(function (d) {
        D.monthRosters.forEach(function (r) {
          var slot = r.slotsByKey[row.key];
          if (!slot) return;
          cellNames(d, r.hospital, slot).forEach(function (n) { seen[n.name] = true; });
        });
      });
      return Object.keys(seen).sort(function (a, b) { return b.length - a.length; }).slice(0, 6);
    });

    if (state.pinned && !D.nameMap.has(state.pinned)) state.pinned = null;
    if (!validDay(state.selected)) state.selected = defaultDay();
    if (state.view === 'ore' && !canSeeOre()) state.view = 'tabella';
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

  // Tiene solo le sedi che esistono in questo mese; se resta vuoto, tutte accese.
  function pruneSites() {
    if (!sites) return;
    var kept = sites.filter(function (h) { return D.allHospitals.indexOf(h) !== -1; });
    sites = kept.length ? kept : null;
  }

  function toggleSite(hospital) {
    var on = D.allHospitals.filter(isOn);
    if (isOn(hospital)) {
      if (on.length <= 1) return;                    // l'ultima accesa non si spegne
      sites = on.filter(function (h) { return h !== hospital; });
    } else {
      sites = D.allHospitals.filter(function (h) { return isOn(h) || h === hospital; });
    }
    writeSites(sites);
    renderAll();
  }

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
        // L'ambulatorio è una mattina: nel calendario si scrive M, e se uno fa
        // ambulatorio e mattina resta una M sola.
        var seen = Object.create(null);
        list.forEach(function (a) {
          var letter = (a.slotKey === 'A') ? 'M' : a.slotKey.charAt(0);
          if (seen[letter]) return;
          seen[letter] = true;
          chips.push({
            letter: letter,
            word: letter === 'M' ? 'mattina' : (SLOT_WORD[a.slotKey] || R.slotName(a.slotLabel).toLowerCase()),
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
      else if (k === 'vista') state.view = VIEWS.indexOf(v) !== -1 ? v : 'tabella';
    });
  }

  function syncHash() {
    var parts = [];
    if (state.month) parts.push('mese=' + state.month);
    if (state.pinned) parts.push('nome=' + encodeURIComponent(state.pinned));
    if (state.selected) parts.push('giorno=' + state.selected);
    if (state.view !== 'tabella') parts.push('vista=' + state.view);
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
    renderSites();
    renderUpdated();
    renderPinToken();
  }

  function renderSites() {
    clear(sitesEl);
    var many = D.allHospitals.length > 1;
    sitesEl.hidden = !many;
    sitesLabel.hidden = !many;
    if (many) {
      D.allHospitals.forEach(function (h) {
        var on = isOn(h);
        sitesEl.appendChild(el('button', {
          class: 'site ' + hospClass(h), type: 'button',
          'aria-pressed': on ? 'true' : 'false',
          title: (on ? 'Nascondi' : 'Mostra') + ' i turni di ' + h,
          on: { click: function () { toggleSite(h); } },
        }, [on ? icon('i-check') : null, el('span', { text: h })]));
      });
    }
    renderSimpl();
    filtersRow.hidden = !many && simplBtn.hidden;
  }

  // Semplifica: si mostra solo dove serve davvero (tabella e calendario).
  function renderSimpl() {
    clear(simplBtn);
    var useful = state.view !== 'ore';
    simplBtn.hidden = !useful;
    if (!useful) return;
    simplBtn.setAttribute('aria-pressed', state.simplify ? 'true' : 'false');
    simplBtn.title = state.simplify
      ? 'Torna a mostrare mattina e pomeriggio separati'
      : 'Unisci mattina e pomeriggio quando sono gli stessi nomi';
    if (state.simplify) simplBtn.appendChild(icon('i-check'));
    simplBtn.appendChild(el('span', { text: 'Semplifica' }));
  }

  function toggleSimpl() {
    state.simplify = !state.simplify;
    writeStore(LS_SIMPL, state.simplify ? '1' : null);
    renderAll();
    srSay(state.simplify ? 'Mattina e pomeriggio uniti quando coincidono' : 'Fasce separate');
  }

  function renderUpdated() {
    var stamp = (shared && shared.generatedAt) || GENERATED_AT;
    var short = stamp ? shortDate(stamp) : '';
    updatedEl.hidden = !short;
    updatedEl.textContent = short ? 'aggiornati il ' + short : '';
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

  // Il totale sta in fondo: una riga per sede, l'addizione in chiaro.
  function renderTotale() {
    clear(totaleEl);
    if (!state.pinned) { totaleEl.hidden = true; return; }
    totaleEl.hidden = false;

    var name = state.pinned;
    var rows = D.hospitals.map(function (h) {
      return { hospital: h, st: R.personStats(D.assignments, name, state.month, h) };
    }).filter(function (r) { return r.st.turni > 0; });
    var all = R.personStats(D.assignments, name, state.month);

    var allSpan = rows.length > 1 ? el('span', { class: 'totale__all' }, sumNodes(all)) : null;
    var head = el('div', { class: 'totale__head' }, [
      el('h2', { class: 'stitle', text: 'Totale' }),
      ' ',
      allSpan,
    ]);
    totaleEl.appendChild(head);

    rows.forEach(function (r) {
      totaleEl.appendChild(el('div', { class: 'totale__row' }, [
        el('span', { class: 'totale__site ' + hospClass(r.hospital), text: r.hospital }),
        ' ',
        el('span', {}, sumNodes(r.st)),
      ]));
    });

    // Il titolo porta la somma scomposta solo se ci sta su una riga: altrimenti
    // torna alla forma breve, che è quella che deve restare leggibile.
    if (allSpan && wraps(allSpan)) {
      clear(allSpan);
      append(allSpan, R.formatHours(all.ore));
    }

    totaleEl.appendChild(el('button', {
      class: 'btn btn--solid btn--wide', type: 'button', id: 'icsBtn',
      text: 'Mostra i miei turni nel mio calendario',
      'aria-label': 'Mostra i turni di ' + name + ' nel calendario',
      on: { click: exportICS },
    }));
    if (calLink && calLink.person === name) totaleEl.appendChild(calLinkRow(calLink));
  }

  function renderMain() {
    closeSlotPop();
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

    // Sabato e domenica sono due bande verticali, intestazione compresa: la
    // forma della settimana si vede prima di leggere un numero.
    calEl.appendChild(el('div', { class: 'cal__row cal__wd' },
      WEEKDAYS_SHORT_IT.map(function (w, i) {
        return el('span', { class: i >= 5 ? 'is-weekend' : null, text: w });
      })));

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
      cells.slice(w, w + 7).forEach(function (c, i) { row.appendChild(calCell(c, chips, i)); });
      calEl.appendChild(row);
    }
    renderLegend(chips);
  }

  function prevMonthDay(firstDate, back) {
    return new Date(Date.UTC(Number(firstDate.slice(0, 4)), Number(firstDate.slice(5, 7)) - 1, 1 - back)).getUTCDate();
  }

  function calCell(c, chips, col) {
    var band = col >= 5 ? ' is-weekend' : '';
    if (c.out) {
      return el('span', { class: 'cal__d is-out' + band }, el('span', { class: 'cal__n', text: String(c.n) }));
    }

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

    // Quando la persona lavora, la casella prende una velatura della sede
    // (due sedi: mezza e mezza, in diagonale). Le lettere restano il segnale vero.
    var sites = [];
    mine.forEach(function (ch) { if (sites.indexOf(ch.hospital) === -1) sites.push(ch.hospital); });
    var tint = sites.length
      ? '--c1: var(--cal-' + hospKey(sites[0]) + '); --c2: var(--cal-' + hospKey(sites[sites.length > 1 ? 1 : 0]) + ');'
      : null;

    return el('button', {
      class: 'cal__d' + band + (sel ? ' is-sel' : '') + (sites.length ? ' is-mine' : ''),
      type: 'button', 'aria-current': sel ? 'date' : null, style: tint,
      'aria-label': label, data: { day: date },
    }, [
      el('span', { class: 'cal__n' + (isToday ? ' is-today' : ''), text: String(c.n) }),
      mine.length ? el('span', { class: 'cal__big' }, mine.map(slotLetter)) : null,
      (!calName && find) ? el('span', { class: 'cal__dot sev-' + find.sev, title: find.title }) : null,
    ]);
  }

  function slotLetter(ch) {
    var f = sevOf(ch.hospital, ch.a.date, ch.a.slotKey, ch.a.person);
    return el('b', {
      class: 'cal__k ' + hospClass(ch.hospital) + (f ? ' is-find sev-' + f.sev : ''),
      title: capitalize(ch.word) + ' ' + ch.hospital + (f ? ' · ' + f.title : ''),
      text: ch.letter,
    });
  }

  // La legenda spiega solo le lettere disegnate per quella persona: chi non fa
  // ambulatorio non deve leggere che cos'è.
  var LEGEND_ORDER = ['M', 'P', 'N'];

  function renderLegend(chipsByDay) {
    clear(legendEl);
    var words = new Map();
    if (chipsByDay) {
      chipsByDay.forEach(function (chips) {
        chips.forEach(function (c) {
          if (!words.has(c.letter)) words.set(c.letter, c.word);
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
      class: 'pill' + (opts.cls ? ' ' + opts.cls : '') + (sev ? ' sev-' + sev.sev : '') +
        (opts.in ? ' is-in' : ''),
      type: 'button', data: { name: name, slots: opts.slots || '' },
      title: (opts.title || name) + (sev ? ' · ' + sev.title : ''),
      'aria-label': opts.label + (sev ? ' — ' + sev.title : ''),
    }, [
      el('span', { text: name }),
      opts.chip ? el('span', { class: 'tchip', text: opts.chip }) : null,
    ]);
  }

  function renderDetail() {
    clear(detailEl);
    var date = state.selected;
    if (!date) return;
    var day = D.dayByDate.get(date);
    detailEl.classList.toggle('is-weekend', isWeekend(date));
    detailEl.classList.toggle('is-multi', D.monthRosters.length > 1);
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

    // Colonne = fasce (con Semplifica, mattina e pomeriggio in una sola),
    // righe = sedi: lo stesso schema della tabella.
    var slots = columns().filter(function (c) {
      return D.monthRosters.some(function (r) {
        if (c.day) return dayLines(r, day).length;
        var slot = r.slotsByKey[c.key];
        return slot && cellNames(day, r.hospital, slot).length;
      });
    });
    var shown = slots.length;

    if (shown) {
      var grid = el('div', {
        class: 'detail__grid',
        // 72px è la larghezza sotto la quale un cognome comincia a spezzarsi:
        // finché ci stanno, le colonne si dividono lo spazio; sotto, è il solo
        // dettaglio a scorrere di lato (mai la pagina), come da regola.
        // Le colonne non scendono sotto il loro contenuto: se non ci stanno,
        // è il dettaglio a scorrere di lato, mai un nome a spezzarsi.
        style: '--dtpl: 42px ' + slots.map(function (c) {
          return c.day ? 'minmax(min-content, 1.8fr)' : 'minmax(min-content, 1fr)';
        }).join(' '),
      });
      grid.appendChild(el('div', { class: 'detail__gh' }));
      slots.forEach(function (c) {
        grid.appendChild(el('div', { class: 'detail__gh' }, slotButton(c, [
          el('b', { text: shortSlotName(c.slot.label) }),
          ' ',
          el('time', { text: R.timeRange(c.slot) }),
        ])));
      });
      D.monthRosters.forEach(function (r) {
        grid.appendChild(el('div', {
          class: 'detail__site ' + hospClass(r.hospital), title: r.title || r.hospital, text: r.hospital,
        }));
        slots.forEach(function (c) { grid.appendChild(cellFor(r, day, c, 'div')); });
      });
      detailEl.appendChild(grid);
    }

    if (!shown) detailEl.appendChild(el('p', { class: 'detail__none', text: 'Nessun turno assegnato in questo giorno.' }));
  }

  // ---------------------------------------------------------------------------
  // Render — tabella del mese
  // ---------------------------------------------------------------------------

  function renderTable() {
    clear(tableWrap);
    if (!D.days.length || !D.slotRows.length) return;
    var table = el('table', { class: 'tab', 'aria-labelledby': 'tabTitle' });
    var tableStyle = function (w) { table.style.setProperty('--tabw', w + 'px'); };

    // Percentuali (non calc(): Chrome le ignora sui <col>), rifatte a ogni cambio
    // di larghezza. 27px al giorno, 28px alla sigla della sede; il resto va alle
    // colonne dei nomi in proporzione a quanto misura davvero il loro nome più
    // lungo, più 2px di pastiglia: nessun nome si tronca finché ci stanno tutti.
    tableWidth = tableWrap.clientWidth || 366;
    var free = Math.max(140, tableWidth - 55);
    var cols = columns();
    var m = measureCols(D.tableNames);
    // La colonna «Giorno» ospita i nomi delle due fasce più la pastiglia dell'orario.
    var need = cols.map(function (c) {
      return c.day ? Math.max(m.cols[c.mi], m.cols[c.pi]) + m.chip + 4 : m.cols[c.idx] + 2;
    });
    var sum = need.reduce(function (x, y) { return x + y; }, 0) || 1;
    // L'avanzo si divide in parti uguali, non in proporzione: così anche la
    // colonna col nome più lungo tiene lo stesso spazio bianco prima della
    // successiva, ed è quello che separa due nomi lunghi affiancati.
    var extra = Math.max(0, free - sum) / need.length;
    var pct = function (px) { return (px / tableWidth * 100).toFixed(3) + '%'; };
    table.appendChild(el('colgroup', {}, [
      el('col', { style: 'width:' + pct(27) }),
      el('col', { style: 'width:' + pct(28) }),
    ].concat(need.map(function (n) {
      return el('col', { style: 'width:' + pct(extra ? n + extra : free * n / sum) });
    }))));

    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { class: 'tab__corner', scope: 'col' }, el('span', { class: 'sr-only', text: 'Giorno' })),
      el('th', { class: 'tab__hh', scope: 'col' }, el('span', { class: 'sr-only', text: 'Ospedale' })),
    ].concat(cols.map(function (c) {
      return el('th', { class: 'tab__hs', scope: 'col' }, slotButton(c, [
        el('b', { text: c.day ? 'Giorno' : c.key }), el('time', { text: R.timeRange(c.slot) }),
      ]));
    })))));

    D.days.forEach(function (d) {
      var weekend = isWeekend(d.date);
      // Un gruppo di righe per giorno: così «oggi» si può incorniciare tutto
      // insieme, senza toccare le righe delle sedi.
      var body = el('tbody', {
        class: 'tab__g' + (d.date === today ? ' is-today' : ''), data: { date: d.date },
      });
      D.monthRosters.forEach(function (r, i) {
        var tr = el('tr', {
          class: 'tab__r ' + (i === 0 ? 'tab__r--first' : 'tab__r--second') +
            (weekend ? ' is-weekend' : '') + ' ' + hospClass(r.hospital),
          data: { date: d.date },
        });
        if (i === 0) tr.appendChild(tableDayCell(d));
        tr.appendChild(el('td', { class: 'tab__h' },
          el('span', { class: 'tab__site ' + hospClass(r.hospital), text: r.hospital })));
        cols.forEach(function (c) { tr.appendChild(cellFor(r, d, c, 'td')); });
        body.appendChild(tr);
      });
      table.appendChild(body);
    });
    tableStyle(tableWidth);
    table.classList.toggle('is-pinned', !!state.pinned && !state.query.trim());
    table.classList.toggle('is-multi', D.monthRosters.length > 1);
    tableWrap.appendChild(table);
  }

  // Misura, col font vero della tabella, il nome più largo di ogni colonna.
  // Tutti i righelli entrano insieme: una sola lettura del layout.
  function measureCols(groups) {
    var ruler = el('div', { class: 'tab__ruler', 'aria-hidden': 'true' });
    var spans = groups.map(function (names) {
      return names.map(function (n) {
        var s = el('span', { text: n });
        ruler.appendChild(s);
        ruler.appendChild(el('br'));
        return s;
      });
    });
    var chip = el('span', { class: 'tchip', text: '14–20' });
    ruler.appendChild(chip);
    tableWrap.appendChild(ruler);
    var out = spans.map(function (ss, i) {
      var m = 0;
      ss.forEach(function (s) { m = Math.max(m, s.getBoundingClientRect().width); });
      // Se il layout non è disponibile (vista nascosta, stampa) si stima dai caratteri.
      if (m < 8) groups[i].forEach(function (n) { m = Math.max(m, n.length * 6.3); });
      return Math.max(24, m);
    });
    var chipW = Math.max(24, chip.getBoundingClientRect().width);
    tableWrap.removeChild(ruler);
    return { cols: out, chip: chipW };
  }

  // Sul telefono non c'è il passaggio del mouse: l'intestazione della fascia è
  // un bottone che apre due righe (nome per esteso e orario a parole), più il
  // ruolo scritto nel foglio quando c'è. Il riquadro sta sul corpo della pagina,
  // in posizione fissa: non sposta niente e la testata appiccicata non lo taglia.
  var popEl = null, popBtn = null;

  function slotButton(col, kids) {
    return el('button', {
      class: 'slotbtn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'slotpop',
      on: {
        click: function (e) {
          e.stopPropagation();
          toggleSlotPop(this, col.slot);
        },
      },
    }, kids);
  }

  function toggleSlotPop(btn, slot) {
    var same = popBtn === btn;
    closeSlotPop();
    if (same) return;
    popEl = el('div', {
      class: 'slotpop', id: 'slotpop', role: 'dialog', 'aria-label': R.slotFullName(slot),
    }, [
      el('p', { class: 'slotpop__t', text: R.slotFullName(slot) }),
      el('p', { class: 'slotpop__h', text: R.slotHoursPhrase(slot) }),
      slot.sub ? el('p', { class: 'slotpop__s', text: slot.sub }) : null,
    ]);
    document.body.appendChild(popEl);
    popBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    placeSlotPop();
  }

  function placeSlotPop() {
    if (!popEl || !popBtn) return;
    var r = popBtn.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { closeSlotPop(); return; }
    var w = popEl.offsetWidth;
    popEl.style.left = Math.round(Math.min(Math.max(8, r.left - 6), Math.max(8, window.innerWidth - w - 8))) + 'px';
    popEl.style.top = Math.round(r.bottom + 6) + 'px';
  }

  function closeSlotPop() {
    if (popBtn) popBtn.setAttribute('aria-expanded', 'false');
    if (popEl && popEl.parentNode) popEl.parentNode.removeChild(popEl);
    popEl = null;
    popBtn = null;
  }

  // Una cella: gli stessi nomi in tabella (td) e nel dettaglio (div). La colonna
  // «Giorno» porta anche la pastiglia dell'orario; le altre no.
  function cellFor(r, day, col, tag) {
    var box = tag === 'td'
      ? el('td', { class: 'tab__c' + (col.day ? ' tab__c--day' : ''), data: { slot: col.day ? 'M P' : col.key } })
      : el('div', {
        class: 'detail__cell ' + hospClass(r.hospital) + (col.day ? ' detail__cell--day' : ''),
        data: { slot: col.day ? 'M P' : col.key },
      });
    var cls = tag === 'td' ? 'pill--t' : '';
    if (col.day) {
      dayLines(r, day).forEach(function (line) {
        var n = line.n;
        box.appendChild(namePill(n.name, line.span === 'MP'
          ? sevPair(r.hospital, day.date, n.name)
          : sevOf(r.hospital, day.date, line.span, n.name), {
          cls: cls, in: n.pos > 0, slots: line.span, chip: spanChip(r, line.span),
          title: n.name + ' · ' + SPAN_WORD[line.span] + (n.role ? ' · ' + (n.pos + 1) + 'º ' + n.role : ''),
          label: n.name + ' — ' + SPAN_WORD[line.span] + ' ' + r.hospital + (n.role ? ', ' + n.role : ''),
        }));
      });
      return box;
    }
    var slot = r.slotsByKey[col.key];
    if (!slot) return box;
    cellNames(day, r.hospital, slot).forEach(function (n) {
      box.appendChild(namePill(n.name, sevOf(r.hospital, day.date, col.key, n.name), {
        cls: cls, in: n.pos > 0, slots: col.key,
        title: n.name + (n.role ? ' · ' + (n.pos + 1) + 'º ' + n.role : ''),
        label: n.name + ' — ' + R.slotName(slot.label) + ' ' + r.hospital + (n.role ? ', ' + n.role : ''),
      }));
    });
    return box;
  }

  function tableDayCell(d) {
    return el('th', { class: 'tab__day', scope: 'row', rowspan: String(Math.max(1, D.monthRosters.length)) },
      el('button', {
        class: 'tab__daybtn', type: 'button', data: { goday: d.date },
        'aria-label': d.day + ' ' + weekdayLong(d.date) + ': apri nel calendario',
      }, [
        el('span', { class: 'n', text: String(d.day) }),
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
        el('span', { class: 'ore__v', text: R.formatHours(st.ore).replace(/\s*h$/, '') }),
      ]));
    });
  }

  // «G2,5 (M2 + P3) + N4 = 6,5 turni · 78h»: la lettera prima del numero, in
  // grassetto; la scomposizione fra parentesi è una nota, non una seconda somma.
  // G = (M + P) / 2, con dentro anche le mattine e i pomeriggi delle giornate.
  function sumNodes(st) {
    var out = [];
    var k = function (letter) { return el('b', { class: 'totale__k', text: letter }); };
    if (st.giornateEq) {
      out.push(k('G'), R.formatNumber(st.giornateEq));
      if (st.mattineTot || st.pomeriggiTot) {
        out.push(el('span', { class: 'totale__dec' }, [
          ' (', k('M'), String(st.mattineTot || 0), ' + ', k('P'), String(st.pomeriggiTot || 0), ')',
        ]));
      }
      if (st.notti) out.push(' + ');
    }
    if (st.notti) out.push(k('N'), String(st.notti));
    out.push(' = ' + R.formatHours(st.ore));
    return out;
  }

  // Vero se il testo occupa più di una riga (misura reale, non stima).
  function wraps(node) {
    var line = parseFloat(getComputedStyle(node).lineHeight) || 16;
    return node.getBoundingClientRect().height > line * 1.6;
  }

  // ---------------------------------------------------------------------------
  // Render — segnalazioni
  // ---------------------------------------------------------------------------

  function renderFindings() {
    clear(findEl);
    findEl.hidden = !canSeeOre();          // l'elenco è roba di chi fa i turni
    if (findEl.hidden) return;
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
  // Render — riga in fondo (solo per chi aggiorna o ha un ruolo dal server)
  // ---------------------------------------------------------------------------

  function shortDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONTHS_IT[d.getMonth()].slice(0, 3);
  }

  function renderBottom() {
    clear(bottomEl);
    var canUpload = gestore && !soloVista;
    var canRestore = canUpload && local.length > 0;
    if (!canUpload && !role && !installEvent && !onWorker) { bottomEl.hidden = true; return; }
    bottomEl.hidden = false;

    // Chi ha chiuso la presentazione può installare da qui, finché si può.
    if (installEvent) {
      bottomEl.appendChild(el('button', {
        class: 'minibtn', type: 'button', text: 'Installa',
        on: { click: installNow },
      }));
    }

    if (canUpload) {
      bottomEl.appendChild(el('button', {
        class: 'minibtn', type: 'button', text: 'Carica xlsx',
        on: { click: function () { fileInput.click(); } },
      }));
    }
    if (canRestore) {
      bottomEl.appendChild(el('button', {
        class: 'minibtn', type: 'button', text: 'Ripristina i dati pubblicati',
        on: { click: restorePublished },
      }));
    }
    if (onWorker && gestore && !soloVista) {
      bottomEl.appendChild(el('button', {
        class: 'minibtn', type: 'button', text: 'Uso',
        title: 'Quante persone usano la pagina e che cosa cercano',
        on: { click: showUso },
      }));
    }
    if (role) {
      bottomEl.appendChild(el('button', {
        class: 'minibtn', type: 'button', text: 'Esci',
        on: { click: function () {
          var reload = function () { window.location.reload(); };
          try { window.fetch('logout', { method: 'POST' }).then(reload, reload); }
          catch (e) { reload(); }
        } },
      }));
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
    // Si conta il nome quando qualcuno lo sceglie davvero, non a ogni lettera.
    if (name && ricerche[ricerche.length - 1] !== name) ricerche.push(name);
    state.query = '';
    input.value = '';
    clearBtn.hidden = true;
    closePop();
    if (document.activeElement === input) input.blur();

    keepAnchor(function () {
      renderPinToken();
      renderTotale();
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

  // Sul Worker il calendario si abbona (webcal:), altrove si scarica.
  function exportICS() {
    var name = state.pinned;
    if (!name) return;
    if (onWorker) {
      fetchJSON('cal-link?nome=' + encodeURIComponent(name)).then(function (j) {
        if (!j || !j.webcal || !j.url) throw new Error('senza indirizzo');
        calLink = { person: name, url: j.url, webcal: j.webcal };
        renderTotale();
        window.location.href = j.webcal;
      }).catch(function () { downloadICS(name); });
      return;
    }
    downloadICS(name);
  }

  function fetchJSON(url) {
    return fetch(url, { headers: { accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    });
  }

  // L'indirizzo da incollare a mano (Android, computer): mono, con «Copia».
  function calLinkRow(link) {
    return el('div', { class: 'callink' }, [
      el('div', { class: 'callink__row' }, [
        el('code', { class: 'callink__url', text: link.url }),
        el('button', {
          class: 'minibtn', type: 'button', text: 'Copia',
          'aria-label': 'Copia l’indirizzo del calendario',
          on: { click: function () { copyText(link.url); } },
        }),
      ]),
      el('p', {
        class: 'callink__note',
        text: 'Si aggiorna da solo. Su Android: aggiungi il calendario da questo indirizzo in Google Calendar.',
      }),
    ]);
  }

  function copyText(text) {
    var done = function () { toast('Indirizzo copiato.'); };
    var fail = function () { toast('Copia non riuscita: tieni premuto sull’indirizzo.', true); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
      return;
    }
    fail();
  }

  function downloadICS(name) {
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

  // ---------------------------------------------------------------------------
  // Uso: quanti dispositivi, quante aperture, quali nomi si cercano.
  // Un identificativo casuale del dispositivo, niente che dica chi è: serve a
  // decidere come far crescere la pagina, non a sapere chi ha guardato cosa.
  // ---------------------------------------------------------------------------

  function deviceId() {
    var v = readStore(LS_DEV);
    if (v) return v;
    var bytes = new Uint8Array(16), s = '';
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    v = window.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    writeStore(LS_DEV, v);
    return v;
  }

  // Una volta sola per sessione, quando la pagina se ne va, e senza far
  // aspettare nessuno: se non parte, pazienza.
  function sendUso() {
    if (usoSent || !onWorker) return;
    usoSent = true;
    var body;
    try {
      body = JSON.stringify({ dev: deviceId(), installata: installed(), ricerche: ricerche });
    } catch (e) { return; }
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('uso', new Blob([body], { type: 'application/json' }))) return;
      window.fetch('uso', {
        method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'application/json' },
      }).catch(function () { /* niente rumore */ });
    } catch (e) { /* niente rumore */ }
  }

  function showUso() {
    fetchJSON('uso').then(renderUso, function () { toast('Non riesco a leggere l’uso.', true); });
  }

  function renderUso(d) {
    d = d || {};
    sheetMode = 'uso';
    reviewTitle.textContent = 'Uso della pagina';
    reviewCap.textContent = [
      plural(num(d.dispositivi), 'dispositivo', 'dispositivi'),
      num(d.installate) + ' con l’app installata',
      plural(num(d.aperture), 'apertura', 'aperture'),
      plural(num(d.ricerche), 'ricerca', 'ricerche'),
    ].join(' · ');
    reviewCancel.hidden = true;
    reviewSave.disabled = false;
    reviewSave.textContent = 'Chiudi';
    clear(reviewBody);
    var list = topNames(d.nomi);
    if (!list.length) {
      reviewBody.appendChild(el('p', { class: 'cap', text: 'Ancora nessuna ricerca.' }));
    } else {
      list.forEach(function (row) {
        reviewBody.appendChild(el('div', { class: 'usorow' }, [
          el('span', { class: 'usorow__n', text: row.nome }),
          el('span', { class: 'usorow__c', text: String(row.n) }),
        ]));
      });
    }
    openReview();
  }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  // I nomi possono arrivare come elenco, come coppie o come mappa: si accettano
  // tutti e tre, e si tengono i venti più cercati.
  function topNames(raw) {
    var out = [];
    if (Array.isArray(raw)) {
      raw.forEach(function (x) {
        if (Array.isArray(x)) out.push({ nome: String(x[0]), n: num(x[1]) });
        else if (x && x.nome !== undefined) out.push({ nome: String(x.nome), n: num(x.n !== undefined ? x.n : x.conteggio) });
      });
    } else if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) { out.push({ nome: k, n: num(raw[k]) }); });
    }
    return out.sort(function (a, b) { return b.n - a.n; }).slice(0, 20);
  }

  // ---------------------------------------------------------------------------
  // Presentazione: come tenersi la pagina a portata di mano (una volta sola)
  // ---------------------------------------------------------------------------

  function platform() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }

  function installed() {
    try {
      return !!(navigator.standalone ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
    } catch (e) { return false; }
  }

  // Si mostra al primo avvio, dopo che la pagina è disegnata, e mai più.
  // Sul computer no (sarebbe rumore) e sulla copia locale nemmeno.
  function maybeIntro() {
    if (location.protocol === 'file:') return;
    if (readStore(LS_INTRO) === '1' || installed()) return;
    if (platform() === 'desktop') return;
    if (!reviewEl.hidden) return;
    openIntro();
  }

  function openIntro() {
    sheetMode = 'intro';
    reviewTitle.textContent = 'Tienila a portata di mano';
    reviewCap.textContent = 'Aggiungila alla schermata Home: si apre come un’app, a schermo intero.';
    reviewCancel.hidden = true;
    reviewSave.disabled = false;
    reviewSave.textContent = 'Ho capito';
    renderIntroBody();
    openReview();
  }

  function renderIntroBody() {
    if (sheetMode !== 'intro') return;
    clear(reviewBody);
    if (platform() === 'ios') {
      reviewBody.appendChild(el('p', { class: 'intro__step' }, [
        'Tocca ', icon('i-share'), ' Condividi, poi Aggiungi alla schermata Home.',
      ]));
      return;
    }
    if (installEvent) {
      reviewBody.appendChild(el('p', { class: 'intro__step' }, [
        el('button', {
          class: 'btn btn--solid', type: 'button', text: 'Installa',
          on: { click: installNow },
        }),
      ]));
      return;
    }
    reviewBody.appendChild(el('p', { class: 'intro__step', text: 'Apri il menu ⋮ e scegli Installa app.' }));
  }

  function closeUso() {
    sheetMode = 'review';
    reviewCancel.hidden = false;
    closeReview();
  }

  function closeIntro() {
    writeStore(LS_INTRO, '1');
    sheetMode = 'review';
    reviewCancel.hidden = false;
    closeReview();
  }

  function installNow() {
    var e = installEvent;
    if (!e) return;
    installEvent = null;
    renderBottom();
    renderIntroBody();
    try { Promise.resolve(e.prompt()).catch(function () {}); } catch (err) { /* niente */ }
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
    viewCal.hidden = true;
    viewTab.hidden = !hasData;
    viewOre.hidden = true;
    findEl.hidden = !hasData || !canSeeOre();

    renderHeader();
    if (hasData) {
      renderTotale();
      renderMain();
      renderFindings();
    } else {
      totaleEl.hidden = true;
      legendEl.hidden = true;
      clear(calEl); clear(detailEl); clear(tableWrap); clear(oreCard);
    }
    renderBottom();
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

  // All'apertura il giorno di oggi si porta al centro dello schermo (solo allora).
  function centerToday() {
    if (!D.todayInMonth) return;
    var node = state.view === 'tabella'
      ? tableWrap.querySelector('tr[data-date="' + today + '"]')
      : calEl.querySelector('[data-day="' + today + '"]');
    if (node) node.scrollIntoView({ block: 'center', behavior: 'instant' });
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
    simplBtn.addEventListener('click', toggleSimpl);
    document.addEventListener('click', function (e) {
      if (popEl && !popEl.contains(e.target)) closeSlotPop();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && popEl) { var b = popBtn; closeSlotPop(); if (b) b.focus(); }
    });
    window.addEventListener('scroll', function () {
      if (popEl) placeSlotPop();
    }, true);
    window.addEventListener('resize', function () { if (popEl) placeSlotPop(); });
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

    var sheetClose = function () {
      if (sheetMode === 'intro') closeIntro();
      else if (sheetMode === 'uso') closeUso();
      else nextReview();
    };
    reviewSave.addEventListener('click', function () {
      if (sheetMode === 'intro') closeIntro();
      else if (sheetMode === 'uso') closeUso();
      else saveReview();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') sendUso();
    });
    window.addEventListener('pagehide', sendUso);
    reviewCancel.addEventListener('click', sheetClose);
    $('reviewScrim').addEventListener('click', sheetClose);
    window.addEventListener('beforeinstallprompt', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      installEvent = e;
      renderBottom();
      renderIntroBody();
    });
    document.addEventListener('keydown', function (e) {
      if (reviewEl.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); sheetClose(); return; }
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
    var hadDay = /(^|&|#)giorno=/.test(String(window.location.hash || ''));
    readHash();
    if (!state.pinned) state.pinned = readStore(LS_ME);
    wire();
    renderAll();
    if (state.pinned) srSay(state.pinned + ' evidenziato');
    if (!hadDay) window.requestAnimationFrame(centerToday);
    boot();
    // La presentazione arriva dopo il disegno e non blocca niente.
    window.setTimeout(maybeIntro, 400);
  }

  init();
})();
