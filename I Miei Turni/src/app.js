/* =============================================================================
   I Miei Turni — interfaccia (vanilla JS, nessun modulo, nessuna dipendenza).
   Gira dopo TurniParser, TurniRules e window.TURNI_DATA.
   Ordine del file: costanti → aiutanti → stato → derivazione → render → eventi.
   ============================================================================= */
(function () {
  'use strict';

  var R = window.TurniRules;
  if (!R) return;

  // ---------------------------------------------------------------------------
  // Costanti
  // ---------------------------------------------------------------------------

  var LS_KEY = 'imieiturni.rosters.v1';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  var WEEKDAYS_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì',
    'giovedì', 'venerdì', 'sabato'];

  // Ordine delle colonne dei turni nelle schede: mattina, pomeriggio, notte, poi il resto.
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

  function weekdayOf(dateStr) {
    var p = String(dateStr).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  }
  function isWeekend(dateStr) { var d = weekdayOf(dateStr); return d === 0 || d === 6; }
  function weekdayLong(dateStr) { return WEEKDAYS_IT[weekdayOf(dateStr)]; }

  function todayISO() {
    var d = new Date();
    var mm = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    return d.getFullYear() + '-' + (mm.length < 2 ? '0' + mm : mm) + '-' + (dd.length < 2 ? '0' + dd : dd);
  }

  // "AMBULATORIO CM" → "Amb. CM" (una riga sola nella colonna di sinistra).
  function shortSlotName(label) {
    var name = R.slotName(label);
    return name.replace(/^Ambulatorio\b/, 'Amb.');
  }

  function hospClass(h) { return h === 'DEA' ? 'h-dea' : (h === 'OSG' ? 'h-osg' : 'h-alt'); }

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
    var from = idx[at], to = idx[at + q.length - 1] + 1;
    return [name.slice(0, from), name.slice(from, to), name.slice(to)];
  }

  // ---------------------------------------------------------------------------
  // Memoria del browser (sempre in try/catch: la pagina funziona anche senza)
  // ---------------------------------------------------------------------------

  function readLocal() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function writeLocal(list) {
    try {
      if (!list.length) window.localStorage.removeItem(LS_KEY);
      else window.localStorage.setItem(LS_KEY, JSON.stringify(list));
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------------------
  // Stato
  // ---------------------------------------------------------------------------

  var BAKED = (window.TURNI_DATA && window.TURNI_DATA.rosters) || [];
  var GENERATED_AT = (window.TURNI_DATA && window.TURNI_DATA.generatedAt) || '';

  var state = {
    month: '',
    query: '',
    armedIndex: 0,
    pinned: null,
    onlyTheirDays: false,
    stripOpen: false,
    findingsAll: false,
    popOpen: false,
  };

  var local = readLocal();
  var D = {};          // vista derivata (ricalcolata a ogni cambio di dati o di mese)
  var nameEls = new Map();   // nome → elementi evidenziabili
  var painted = [];          // elementi attualmente evidenziati
  var options = [];          // righe dell'elenco candidati

  // ---------------------------------------------------------------------------
  // Riferimenti al DOM
  // ---------------------------------------------------------------------------

  var topbar = $('topbar'), monthCtl = $('monthCtl'), findingsBtn = $('findingsBtn'),
    todayBtn = $('todayBtn'),
    searchBox = $('search'), input = $('q'), pintoken = $('pintoken'), clearBtn = $('clearBtn'),
    pop = $('pop'), emptyEl = $('empty'), stripEl = $('strip'), cardsEl = $('turni'),
    findEl = $('segnalazioni'), datiEl = $('dati'), datiBody = $('datiBody'),
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

  // Giorni del mese: unione dei giorni presenti nei roster dei due ospedali.
  function buildDays(rosters) {
    var map = new Map();
    rosters.forEach(function (r) {
      (r.days || []).forEach(function (d) {
        var rec = map.get(d.day);
        if (!rec) { rec = { day: d.day, date: d.date, cells: {} }; map.set(d.day, rec); }
        rec.cells[r.hospital] = d.cells || {};
      });
    });
    return Array.from(map.values()).sort(function (a, b) { return a.day - b.day; });
  }

  // Righe delle schede: unione delle fasce dei due ospedali, in ordine M, P, N, resto.
  function buildSlotRows(rosters) {
    var seen = new Map();
    rosters.forEach(function (r) {
      (r.slots || []).forEach(function (s) {
        if (!seen.has(s.key)) seen.set(s.key, { key: s.key, slot: s, order: seen.size });
      });
    });
    return Array.from(seen.values()).sort(function (a, b) {
      var ra = SLOT_RANK[a.key] !== undefined ? SLOT_RANK[a.key] : 10 + a.order;
      var rb = SLOT_RANK[b.key] !== undefined ? SLOT_RANK[b.key] : 10 + b.order;
      return ra - rb;
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
    D.slotRows = buildSlotRows(D.monthRosters);
    D.today = todayISO();
    D.todayInMonth = D.days.some(function (d) { return d.date === D.today; });

    // Celle e nomi coinvolti in una segnalazione (per il bordo e il puntino).
    D.cellFind = new Map();
    D.pillFind = new Map();
    D.findByPerson = new Map();
    D.findingsOfMonth.forEach(function (f) {
      [f.a, f.b].forEach(function (a) {
        var ck = a.hospital + '|' + a.date + '|' + a.slotKey;
        var prev = D.cellFind.get(ck);
        if (!prev || f.severity > prev.severity) D.cellFind.set(ck, { severity: f.severity, title: f.title });
        var pk = ck + '|' + a.person;
        var arr = D.pillFind.get(pk) || [];
        arr.push(f);
        D.pillFind.set(pk, arr);
      });
      var list = D.findByPerson.get(f.person) || [];
      list.push(f);
      D.findByPerson.set(f.person, list);
    });

    if (state.pinned && !D.nameMap.has(state.pinned)) state.pinned = null;
    if (!state.pinned) { state.onlyTheirDays = false; state.findingsAll = false; }
    D.personDays = state.pinned ? personDays(state.pinned) : null;
  }

  function defaultMonth() {
    if (!D.months.length) return '';
    var t = todayISO().slice(0, 7);
    if (D.months.indexOf(t) !== -1) return t;
    return D.months[D.months.length - 1];
  }

  // Mappa data → { ospedali, notte } per il mini-mese e per il filtro dei giorni.
  function personDays(name) {
    var map = new Map();
    D.monthAssignments.forEach(function (a) {
      if (a.person !== name) return;
      var rec = map.get(a.date);
      if (!rec) { rec = { hospitals: {}, night: false }; map.set(a.date, rec); }
      rec.hospitals[a.hospital] = true;
      if (a.isNight) rec.night = true;
    });
    return map;
  }

  // ---------------------------------------------------------------------------
  // Indirizzo (hash) — mese, nome fissato, filtro
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
      else if (k === 'solo') state.onlyTheirDays = v === '1';
    });
  }

  function syncHash() {
    var parts = [];
    if (state.month) parts.push('mese=' + state.month);
    if (state.pinned) parts.push('nome=' + encodeURIComponent(state.pinned));
    if (state.pinned && state.onlyTheirDays) parts.push('solo=1');
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
    todayBtn.setAttribute('aria-label', 'Vai a oggi, ' + (D.todayInMonth ? R.formatDate(D.today) : ''));
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
  // Render — striscia dei nomi / scheda della persona
  // ---------------------------------------------------------------------------

  function hospitalDots(byHospital) {
    return el('span', { class: 'chip__dots' }, D.hospitals.filter(function (h) {
      return byHospital[h];
    }).map(function (h) {
      return el('span', { class: 'dot ' + hospClass(h), title: h + ': ' + plural(byHospital[h], 'turno', 'turni') });
    }));
  }

  function suspicionText(s) {
    if (!s) return '';
    return s.kind === 'concat' ? 'forse ' + s.suggestion + '?' : 'simile a ' + s.to;
  }

  function renderStrip() {
    clear(stripEl);
    stripEl.classList.toggle('is-scheda', !!state.pinned);
    if (!D.names.length) { stripEl.hidden = true; return; }
    stripEl.hidden = false;
    if (state.pinned) renderScheda();
    else renderNames();
  }

  function renderNames() {
    var both = D.names.filter(function (n) { return Object.keys(n.byHospital).length > 1; }).length;
    var warn = D.names.filter(function (n) { return n.suspicion; }).length;
    var caption = [plural(D.names.length, 'nome', 'nomi')];
    if (both) caption.push(both + ' in entrambi gli ospedali');
    if (warn) caption.push(plural(warn, 'da controllare', 'da controllare'));

    stripEl.appendChild(el('div', { class: 'strip__head' }, [
      el('h2', { class: 'stitle', id: 'stripTitle', text: 'Chi c’è a ' + monthName(state.month) }),
    ]));
    stripEl.appendChild(el('p', { class: 'cap strip__cap', text: caption.join(' · ') }));

    var names = el('div', { class: 'strip__names' + (state.stripOpen ? '' : ' is-clamped') },
      D.names.map(function (n) { return nameChip(n); }));
    stripEl.appendChild(names);

    var more = el('button', {
      class: 'strip__more', type: 'button',
      text: state.stripOpen ? 'Riduci' : 'Mostra tutti i ' + D.names.length + ' nomi',
      'aria-expanded': state.stripOpen ? 'true' : 'false',
      on: { click: function () { state.stripOpen = !state.stripOpen; renderStrip(); indexNames(); applyHighlight(); } },
    });
    stripEl.appendChild(more);
    // Il taglio cade tra due righe di chip, mai a metà; se stanno tutte, niente pulsante.
    if (!state.stripOpen) {
      requestAnimationFrame(function () {
        var tops = [];
        Array.prototype.forEach.call(names.children, function (chip) {
          if (tops.indexOf(chip.offsetTop) === -1) tops.push(chip.offsetTop);
        });
        if (tops.length <= 3) {
          names.classList.remove('is-clamped');
          more.hidden = true;
        } else {
          names.style.maxHeight = Math.max(40, tops[3] - names.offsetTop - 6) + 'px';
        }
      });
    }
  }

  function nameChip(n) {
    var why = suspicionText(n.suspicion);
    return el('button', {
      class: 'chip' + (n.suspicion ? ' is-warn' : ''), type: 'button',
      data: { name: n.name },
      'aria-label': n.name + ', ' + plural(n.count, 'turno', 'turni') + (why ? ', ' + why : ''),
    }, [
      el('span', { class: 'chip__name', text: n.name }),
      el('span', { class: 'chip__n', text: String(n.count) }),
      hospitalDots(n.byHospital),
      why ? el('span', { class: 'chip__why' }, [icon('i-warn'), why]) : null,
    ]);
  }

  function renderScheda() {
    var name = state.pinned;
    var info = D.nameMap.get(name) || { count: 0, byHospital: {}, nights: 0, amb: 0 };
    var box = el('div', { class: 'scheda' });

    box.appendChild(el('div', { class: 'scheda__top' }, [
      el('div', {}, [
        el('h2', { class: 'scheda__label', id: 'stripTitle', text: 'Scheda' }),
        el('div', {}, el('span', { class: 'scheda__name', text: name })),
      ]),
    ]));

    var stats = [plural(info.count, 'turno', 'turni') + ' a ' + monthName(state.month)];
    D.hospitals.forEach(function (h) { if (info.byHospital[h]) stats.push(h + ' ' + info.byHospital[h]); });
    if (info.nights) stats.push(plural(info.nights, 'notte', 'notti'));
    if (info.amb) stats.push(plural(info.amb, 'ambulatorio', 'ambulatori'));
    box.appendChild(el('p', { class: 'scheda__stats', text: stats.join(' · ') }));

    box.appendChild(renderMiniMonth(name));
    box.appendChild(el('p', { class: 'mm__legend' }, [
      el('span', {}, [el('span', { class: 'dot h-dea' }), 'DEA']),
      el('span', {}, [el('span', { class: 'dot h-osg' }), 'OSG']),
      el('span', {}, [icon('i-moon'), 'notte']),
    ]));

    var check = el('input', { type: 'checkbox', role: 'switch', checked: state.onlyTheirDays });
    check.addEventListener('change', function () {
      state.onlyTheirDays = check.checked;
      keepAnchor(function () { renderCards(); indexNames(); applyHighlight(); });
      syncHash();
    });
    box.appendChild(el('div', { class: 'scheda__actions' }, [
      el('label', { class: 'switch' }, [check, el('span', { class: 'switch__track' }), 'Solo i suoi giorni']),
      el('button', {
        class: 'scheda__unpin', type: 'button',
        on: { click: function () { setPinned(null); } },
      }, [icon('i-back'), 'Tutti i nomi']),
    ]));

    var mine = (D.findByPerson.get(name) || []);
    if (mine.length) {
      box.appendChild(el('div', { class: 'scheda__findings' }, [
        el('p', { class: 'fgroup__t', text: plural(mine.length, 'segnalazione', 'segnalazioni') }),
        el('div', {}, mine.map(function (f) { return findingItem(f, true); })),
      ]));
    }

    stripEl.appendChild(box);
  }

  function renderMiniMonth(name) {
    var grid = el('div', { class: 'mm' });
    D.days.forEach(function (d) {
      var rec = D.personDays ? D.personDays.get(d.date) : null;
      var cls = ['mm__d'];
      if (isWeekend(d.date)) cls.push('is-weekend');
      if (d.date === D.today) cls.push('is-today');
      var hosps = rec ? D.hospitals.filter(function (h) { return rec.hospitals[h]; }) : [];
      hosps.forEach(function (h) { cls.push(h === 'DEA' ? 'on-dea' : (h === 'OSG' ? 'on-osg' : 'on-alt')); });

      var marks = el('span', { class: 'mm__marks' }, [
        rec && rec.night ? icon('i-moon') : null,
        hosps.length > 1 ? hosps.map(function (h) { return el('span', { class: 'dot ' + hospClass(h) }); }) : null,
      ]);
      var body = [el('span', { text: String(d.day) }), marks];

      if (rec) {
        grid.appendChild(el('button', {
          class: cls.join(' '), type: 'button', data: { goto: d.date },
          'aria-label': R.formatDate(d.date) + ': ' + hosps.join(' e ') + (rec.night ? ', notte' : ''),
        }, body));
      } else {
        grid.appendChild(el('span', { class: cls.join(' '), 'aria-hidden': 'true' }, body));
      }
    });
    return grid;
  }

  // ---------------------------------------------------------------------------
  // Render — schede dei giorni
  // ---------------------------------------------------------------------------

  function renderCards() {
    clear(cardsEl);
    cardsEl.style.setProperty('--tpl', 'var(--labelw) repeat(' + Math.max(1, D.hospitals.length) + ', minmax(0, 1fr))');
    cardsEl.classList.toggle('is-pinned', !!state.pinned && !state.query.trim());

    // Gli ospedali si nominano una volta sola, in una riga che resta in vista.
    var colbar = el('div', { class: 'colbar' }, [el('span', {})].concat(
      D.monthRosters.map(function (r) {
        return el('span', { class: 'colbar__h ' + hospClass(r.hospital), title: r.title || r.hospital }, [
          el('span', { class: 'dot ' + hospClass(r.hospital) }), r.hospital,
        ]);
      })
    ));
    cardsEl.appendChild(colbar);

    var days = D.days;
    if (state.pinned && state.onlyTheirDays && D.personDays) {
      days = days.filter(function (d) { return D.personDays.has(d.date); });
    }
    if (!days.length) {
      cardsEl.appendChild(el('p', { class: 'cap', style: 'padding:14px', text: 'Nessun giorno da mostrare.' }));
      return;
    }
    days.forEach(function (d) { cardsEl.appendChild(dayCard(d)); });
    requestAnimationFrame(function () {
      document.documentElement.style.setProperty('--h-cols', colbar.offsetHeight + 'px');
    });
  }

  function dayCard(d) {
    var weekend = isWeekend(d.date), today = d.date === D.today;
    var card = el('article', {
      class: 'day' + (weekend ? ' is-weekend' : '') + (today ? ' is-today' : ''),
      id: 'd-' + d.date, data: { date: d.date },
      'aria-label': weekdayLong(d.date) + ' ' + d.day + ' ' + monthName(state.month),
    });

    card.appendChild(el('div', { class: 'day__hd' }, [
      el('span', { class: 'day__num' + (today ? ' is-today' : ''), text: String(d.day) }),
      el('span', { class: 'day__wd', text: weekdayLong(d.date) }),
      today ? el('span', { class: 'day__oggi', text: 'oggi' }) : null,
    ]));

    D.slotRows.forEach(function (row) {
      var slots = D.monthRosters.map(function (r) {
        return (r.slots || []).filter(function (s) { return s.key === row.key; })[0] || null;
      });
      // Una fascia vuota in tutti gli ospedali non si mostra affatto.
      var used = slots.some(function (slot, i) {
        if (!slot) return false;
        var cell = (d.cells[D.monthRosters[i].hospital] || {})[slot.key];
        return !!(cell && cell.names && cell.names.length);
      });
      if (!used) return;

      var night = row.key === 'N';
      var cells = slots.map(function (slot, i) {
        if (!slot) return el('div', { class: 'day__blank' });
        return dayCell(D.monthRosters[i], slot, d);
      });
      card.appendChild(el('div', { class: 'day__row' + (night ? ' is-night' : '') }, [
        el('div', { class: 'day__lab' }, [
          el('b', {}, [shortSlotName(row.slot.label), night ? icon('i-moon') : null]),
          el('time', { text: R.timeRange(row.slot) }),
        ]),
      ].concat(cells)));
    });

    return card;
  }

  function dayCell(roster, slot, day) {
    var cell = (day.cells[roster.hospital] || {})[slot.key];
    var box = el('div', { class: 'day__cell' });
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
        'Solo ' + state.pinned,
        el('span', { text: '·' }),
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
      var kinds = KIND_ORDER.filter(function (k) {
        return list.some(function (f) { return f.kind === k; });
      });
      kinds.forEach(function (kind) {
        var group = list.filter(function (f) { return f.kind === kind; });
        findEl.appendChild(el('div', { class: 'fgroup' }, [
          kinds.length > 1 ? el('p', { class: 'fgroup__t', text: plural(group.length, KIND_PLURAL[kind][0], KIND_PLURAL[kind][1]) }) : null,
          el('div', {}, group.map(function (f) { return findingItem(f, false); })),
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
  function findingItem(f, compact) {
    var dates = f.a.date === f.b.date ? R.formatDate(f.a.date)
      : R.formatDate(f.a.date) + ' → ' + R.formatDate(f.b.date);
    return el('div', { class: 'fitem sev-' + f.severity, data: { goto: f.a.date } }, [
      el('div', { class: 'fitem__body' }, [
        compact ? null : el('button', {
          class: 'fitem__who', type: 'button', data: { name: f.person },
          'aria-label': 'Evidenzia ' + f.person, text: f.person,
        }),
        el('p', { class: 'fitem__t', text: f.title }),
        el('p', { class: 'fitem__d', text: f.detail }),
        compact ? el('p', { class: 'fitem__d', text: dates }) : null,
      ]),
      el('button', {
        class: 'fitem__go', type: 'button',
        'aria-label': 'Vai a ' + R.formatDate(f.a.date) + ': ' + f.title,
      }, icon('i-chevron')),
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
      var row = el('div', { class: 'src' }, [
        el('span', { class: 'src__file', text: r.file }),
        el('span', { class: 'badge' + (r.source === 'browser' ? ' is-browser' : ''), text: r.source === 'browser' ? 'dal browser' : 'pubblicato' }),
        r.source === 'browser' ? el('button', {
          class: 'minibtn', type: 'button', text: 'Rimuovi',
          'aria-label': 'Rimuovi ' + r.file + ' dal browser',
          on: { click: function () { removeLocal(r); } },
        }) : null,
        el('span', { class: 'src__meta', text: meta.join(' · ') }),
      ]);
      sources.appendChild(row);
    });
    datiBody.appendChild(sources);

    var warnings = [];
    D.rosters.forEach(function (r) {
      (r.warnings || []).forEach(function (w) {
        warnings.push(r.hospital + ' · ' + (w.message || w.type));
      });
    });
    if (warnings.length) {
      datiBody.appendChild(el('div', { class: 'dati__block' }, [
        el('p', { class: 'dati__t', text: plural(warnings.length, 'avviso di lettura', 'avvisi di lettura') }),
      ].concat(warnings.map(function (w) {
        return el('p', { class: 'warnrow' }, [icon('i-warn'), w]);
      }))));
    }

    var suspicious = D.namesAll.filter(function (n) { return n.suspicion; });
    if (suspicious.length) {
      datiBody.appendChild(el('div', { class: 'dati__block' }, [
        el('p', { class: 'dati__t', text: 'Nomi da controllare' }),
      ].concat(suspicious.map(function (n) {
        return el('p', { class: 'warnrow' }, [icon('i-warn'), n.name + ' — ' + suspicionText(n.suspicion)]);
      }))));
    }

    var actions = el('div', { class: 'dati__block' }, [
      el('p', { class: 'dati__t', text: 'Aggiornare i turni' }),
      el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap' }, [
        el('button', {
          class: 'btn', type: 'button',
          on: { click: function () { fileInput.click(); } },
        }, [icon('i-upload'), 'Carica xlsx']),
        local.length ? el('button', {
          class: 'btn', type: 'button', text: 'Ripristina i dati pubblicati',
          on: { click: restorePublished },
        }) : null,
      ]),
      el('p', { class: 'dati__note', text: 'Sul telefono: «Carica xlsx» e scegli il file ricevuto (per esempio da WhatsApp o dalla mail).' }),
      el('p', { class: 'dati__note', text: 'Per aggiornare: trascina qui i nuovi file xlsx, oppure mettili in data/ e lancia npm run build.' }),
      GENERATED_AT ? el('p', { class: 'dati__note', text: 'Dati pubblicati il ' + formatGenerated(GENERATED_AT) + '.' }) : null,
    ]);
    datiBody.appendChild(actions);
  }

  function formatGenerated(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var day = d.getDate();
    var month = MONTHS_IT[d.getMonth()].slice(0, 3);
    var hh = String(d.getHours()); if (hh.length < 2) hh = '0' + hh;
    var mm = String(d.getMinutes()); if (mm.length < 2) mm = '0' + mm;
    return day + ' ' + month + ' ' + d.getFullYear() + ', ' + hh + ':' + mm;
  }

  // ---------------------------------------------------------------------------
  // Evidenziazione
  // ---------------------------------------------------------------------------

  function indexNames() {
    nameEls = new Map();
    painted = [];
    var nodes = cardsEl.querySelectorAll('[data-name]');
    var chips = stripEl.querySelectorAll('[data-name]');
    var add = function (node) {
      var name = node.dataset.name;
      var arr = nameEls.get(name);
      if (!arr) { arr = []; nameEls.set(name, arr); }
      arr.push(node);
    };
    Array.prototype.forEach.call(nodes, add);
    Array.prototype.forEach.call(chips, add);
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

    var q = state.query.trim();
    if (q) {
      cardsEl.classList.remove('is-pinned');
      var list = R.searchNames(q, D.names);
      list.forEach(function (n) { paint(n.name, 'is-soft'); });
      var armed = list[state.armedIndex];
      if (armed) paint(armed.name, 'is-strong');
    } else if (state.pinned) {
      cardsEl.classList.add('is-pinned');
      paint(state.pinned, 'is-strong');
    } else {
      cardsEl.classList.remove('is-pinned');
    }
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
        hospitalDots(n.byHospital),
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

  function openPop() {
    pop.hidden = false;
    state.popOpen = true;
    input.setAttribute('aria-expanded', 'true');
  }

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
    state.pinned = null;
    state.onlyTheirDays = false;
    renderAll();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function setPinned(name) {
    var wasPinned = state.pinned;
    state.pinned = name;
    state.findingsAll = false;
    if (!name) state.onlyTheirDays = false;
    state.query = '';
    input.value = '';
    clearBtn.hidden = true;
    closePop();
    if (document.activeElement === input) input.blur();

    keepAnchor(function () {
      D.personDays = name ? personDays(name) : null;
      renderHeader();
      renderStrip();
      renderCards();
      renderFindings();
      indexNames();
      applyHighlight();
    });
    syncHash();
    srSay(name ? name + ' evidenziato: ' + plural((D.nameMap.get(name) || { count: 0 }).count, 'turno', 'turni') + ' nel mese'
      : (wasPinned ? 'Evidenziazione tolta' : ''));
  }

  function togglePin(name) { setPinned(state.pinned === name ? null : name); }

  // Mantiene il punto di lettura: se una scheda è in vista, resta dov'è.
  function keepAnchor(fn) {
    var anchor = null, before = 0;
    var cards = cardsEl.querySelectorAll('.day');
    var top = topbar.offsetHeight;
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      if (rect.bottom > top + 4) { anchor = cards[i].dataset.date; before = rect.top; break; }
    }
    fn();
    if (!anchor) return;
    var after = document.getElementById('d-' + anchor);
    if (!after) return;
    var delta = after.getBoundingClientRect().top - before;
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' });
  }

  function scrollToEl(node, instant) {
    if (!node) return;
    var behavior = (instant || reduceMotion.matches) ? 'instant' : 'smooth';
    node.scrollIntoView({ block: 'start', behavior: behavior });
  }

  function goToDay(date, instant) {
    var node = document.getElementById('d-' + date);
    if (!node && state.onlyTheirDays) {
      state.onlyTheirDays = false;
      renderStrip(); renderCards(); indexNames(); applyHighlight(); syncHash();
      node = document.getElementById('d-' + date);
    }
    if (!node) return;
    scrollToEl(node, instant);
    flash(node);
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
    files.forEach(function (file) {
      chain = chain.then(function () { return loadOne(file, loaded); });
    });
    chain.then(function () {
      if (!loaded.length) return;
      if (!writeLocal(local)) toast('I turni sono caricati ma non restano in memoria (spazio del browser non disponibile)', true);
      var last = loaded[loaded.length - 1];
      state.month = last.month;
      state.pinned = null;
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
        toast('Caricato ' + roster.hospital + ' · ' + monthLabel(roster.month) + ' · ' + plural((roster.days || []).length, 'giorno', 'giorni'));
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
    stripEl.hidden = !hasData;
    cardsEl.hidden = !hasData;
    findEl.hidden = !hasData;
    datiEl.hidden = !hasData && !local.length;
    searchBox.hidden = !hasData;

    renderHeader();
    if (hasData) {
      renderStrip();
      renderCards();
      renderFindings();
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
        if (armed) setPinned(armed.dataset.name);
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

    // Il puntatore giù sull'elenco non deve togliere il fuoco al campo.
    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pop.addEventListener('click', function (e) {
      var row = e.target.closest('.opt');
      if (row && row.dataset.name) setPinned(row.dataset.name);
    });

    document.addEventListener('pointerdown', function (e) {
      if (!state.popOpen) return;
      if (!searchBox.contains(e.target)) closePop();
    });

    // Un solo ascoltatore per pillole, chip, quadretti del mini-mese e segnalazioni.
    document.addEventListener('click', function (e) {
      var goto = e.target.closest('[data-goto]');
      var named = e.target.closest('[data-name]');
      if (named && !named.closest('.opt')) { togglePin(named.dataset.name); return; }
      if (goto) { goToDay(goto.dataset.goto); }
    });

    findingsBtn.addEventListener('click', function () {
      scrollToEl(findEl);
      findEl.focus({ preventScroll: true });
    });

    todayBtn.addEventListener('click', function () { goToDay(D.today); });

    $('emptyUpload').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      loadFiles(fileInput.files);
      fileInput.value = '';
    });

    var dragDepth = 0;
    window.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
      dragDepth++;
      dropzone.hidden = false;
    });
    window.addEventListener('dragover', function (e) { if (!dropzone.hidden) e.preventDefault(); });
    window.addEventListener('dragleave', function (e) {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth || !e.relatedTarget) { dragDepth = 0; dropzone.hidden = true; }
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

    function endDrag() { dragDepth = 0; dropzone.hidden = true; }

    window.addEventListener('resize', measureHeader);
    window.addEventListener('hashchange', function () {
      var before = state.month + '|' + state.pinned;
      readHash();
      if (before !== state.month + '|' + state.pinned) renderAll();
    });
  }

  // ---------------------------------------------------------------------------
  // Avvio
  // ---------------------------------------------------------------------------

  function init() {
    readHash();
    wire();
    renderAll();
    if (state.pinned) {
      srSay(state.pinned + ' evidenziato');
    } else if (D.todayInMonth) {
      // Sul telefono si apre già sul giorno di oggi.
      window.requestAnimationFrame(function () {
        var node = document.getElementById('d-' + D.today);
        if (node) scrollToEl(node, true);
      });
    }
  }

  init();
})();
