/*
 * PS Assist sull'iPhone.
 *
 * Il pannello del pronto soccorso dal telefono, per quando il medico è
 * lontano dal PC. Questa pagina non parla col gestionale: parla col PC — con
 * l'estensione aperta lì — attraverso il ponte del sito, che passa i messaggi
 * senza poterli leggere (cripto.js). Il PC esegue ogni comando con il codice
 * di sempre e risponde.
 *
 * Cosa resta sul telefono: solo la chiave dell'associazione (dal QR, una
 * volta per turno) e la sua scadenza. I dati dei pazienti stanno nella
 * memoria di questa pagina, mai in localStorage, IndexedDB o nelle cache, e
 * si cancellano quando la sessione finisce.
 */
(function () {
  "use strict";
  const P = globalThis.PonteCripto;
  const $app = document.getElementById("app");
  const CHIAVE = "psassist.ponte.v1";
  const TEMPO = 30e3;
  const INATTIVO = 20 * 60e3;   // come sul PC: 20 minuti senza comandi e la sessione è finita
  const TRIAGE = { ROSSO: "rosso", ARANCIONE: "arancione", AZZURRO: "azzurro", VERDE: "verde", BIANCO: "bianco" };
  const PERCHE = {
    inattivo: "20 minuti senza comandi", "scollegata dal PC": "chiusa dal PC («Scollega»)", revocata: "il PC ha revocato l'associazione",
    scaduta: "associazione scaduta", "nuova associazione": "sul PC c'è un QR nuovo: inquadralo", "chiusa dall'iPhone": "l'hai chiusa tu",
    "messaggi non validi": "messaggi non validi, scartati", riavvio: "l'estensione sul PC si è riavviata", "indirizzo cambiato": "il PC ha cambiato ponte",
  };
  // dopo queste la chiave di questo telefono non apre più niente
  const FINITE = new Set(["nuova associazione", "indirizzo cambiato"]);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const minuti = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}` : `${min}m`);
  const quanto = (t) => { const ora = Date.now(); if (t > ora) return minuti(Math.ceil((t - ora) / 60e3)); const r = Math.floor((ora - t) / 60e3); return r < 1 ? "ora" : "−" + minuti(r); };
  const banda = (t) => { const m = Math.ceil((t - Date.now()) / 60e3); return m > 30 ? "" : m > 10 ? "amb" : "ros"; };
  const ICO = {
    indietro: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    altro: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    vai: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    logo: '<svg width="28" height="28" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#0B5CAD"/><path d="M32 17v30M17 32h30" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>',
    croce: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    pc: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    lucchetto: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };

  // --------------------------------------------------------------- lo stato
  // Tutto qui è in memoria. La sola cosa scritta sul telefono è la chiave.
  const S = {
    coppia: null, chiavi: null, ws: null, pari: null, tentativi: 0, tRiprova: 0,
    saluto: null, canale: null, attese: new Map(), id: 0, errori: 0, ultimo: 0,
    fase: "avvio", perche: "", scaduta: 0,
    pazienti: null, catalogo: null, esiti: new Map(), ordini: new Map(), nascosti: new Set(),
    vista: { nome: "lista", ep: "", scheda: "esiti" }, sel: new Map(), aperti: new Set(),
    occupato: new Set(), bozze: new Map(), promTesto: "", menu: false, arma: null, avviso: null,
  };
  function svuota() {
    S.pazienti = null; S.catalogo = null; S.esiti.clear(); S.ordini.clear(); S.nascosti.clear();
    S.sel.clear(); S.aperti.clear(); S.occupato.clear(); S.bozze.clear(); S.promTesto = ""; S.arma = null;
    S.vista = { nome: "lista", ep: "", scheda: "esiti" };
  }

  // ---------------------------------------------------- la chiave del QR
  function caricaCoppia() {
    const dalQr = location.hash ? P.leggiFrammento(location.hash) : null;
    // il frammento non resta nella barra degli indirizzi né nella cronologia
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    if (dalQr) {
      if (dalQr.scade <= Date.now()) { S.scaduta = dalQr.scade; return null; }
      try { localStorage.setItem(CHIAVE, JSON.stringify({ k: P.b64u(dalQr.k), scade: dalQr.scade })); } catch { /* solo in memoria */ }
      return dalQr;
    }
    try {
      const o = JSON.parse(localStorage.getItem(CHIAVE) || "null");
      if (!o) return null;
      if (!(o.scade > Date.now())) { S.scaduta = o.scade || 0; localStorage.removeItem(CHIAVE); return null; }
      const k = P.daB64u(o.k);
      return k.length === 32 ? { k, scade: o.scade } : null;
    } catch { return null; }
  }
  function dimentica(fase) {
    try { localStorage.removeItem(CHIAVE); } catch { /* niente */ }
    S.coppia = null; S.chiavi = null; S.canale = null; S.saluto = null;
    svuota();
    const ws = S.ws; S.ws = null;
    if (ws) try { ws.close(); } catch { /* già chiusa */ }
    S.fase = fase; render();
  }

  // ---------------------------------------------------------------- la presa
  function collega() {
    if (!S.chiavi || (S.ws && S.ws.readyState <= 1)) return;
    clearTimeout(S.tRiprova);
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ponte/ws?r=${S.chiavi.stanza}&ruolo=tel`);
    ws.binaryType = "arraybuffer";
    S.ws = ws;
    let fila = Promise.resolve();
    ws.onmessage = (e) => { if (S.ws === ws) fila = fila.then(() => ricevi(e.data)).catch(() => {}); };
    ws.onclose = () => {
      if (S.ws !== ws) return;
      S.ws = null; S.pari = null; S.saluto = null;
      if (!S.chiavi) return;
      if (S.fase === "collego" && S.tentativi >= 1) S.fase = "pc";   // il ponte stesso non risponde
      if (document.visibilityState === "visible") {
        const ms = [800, 2000, 4000, 8000, 15000][Math.min(S.tentativi++, 4)];
        S.tRiprova = setTimeout(collega, ms);
      }
      render();
    };
    ws.onopen = () => { S.tentativi = 0; };
  }
  // Il ponte dice solo se dall'altra parte c'è il PC.
  function presenza(pari) {
    S.pari = pari;
    if (pari && !S.canale && !S.saluto && (S.fase === "collego" || S.fase === "pc")) saluta();
    else if (pari && S.canale) aggiornaOrdini();   // tornati in linea: a che punto sono gli ordini
    if (!pari && !S.canale && S.fase === "collego") S.fase = "pc";
    render();
  }
  async function saluta() {
    const n = P.casuale(16);
    const mio = { n: P.b64u(n), byte: n };
    S.saluto = mio;
    manda(await P.sigilla(S.chiavi.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: mio.n }));
    setTimeout(() => {
      if (S.saluto !== mio) return;
      S.saluto = null;
      if (S.fase === "collego") { S.fase = "pc"; render(); }
      if (S.pari && S.fase === "pc") saluta();
    }, 8000);
  }
  const manda = (f) => { if (S.ws && S.ws.readyState === 1) { S.ws.send(f); return true; } return false; };
  async function ricevi(dati) {
    if (typeof dati === "string") {
      try { const m = JSON.parse(dati); if (typeof m.pari === "boolean") presenza(m.pari); } catch { /* niente */ }
      return;
    }
    const b = new Uint8Array(dati);
    const h = P.leggiTestata(b);
    if (!h) return scarto();
    if (h.tipo === P.TIPO.SALUTO_PC) {
      let m;
      try { m = (await P.apri(S.chiavi.salutoPc, b, P.TIPO.SALUTO_PC)).dati; } catch { return scarto(); }
      // il PC non conosce la nostra sessione (si è riavviato, o l'ha chiusa)
      if (m.riparti) { if (S.canale) chiusa(m.perche || "riavvio"); return; }
      if (!S.saluto || m.eco !== S.saluto.n) return;   // un saluto vecchio, o non nostro
      const nTel = S.saluto.byte;
      S.saluto = null;
      S.canale = P.canaleTel(await P.chiaviSessione(S.coppia.k, nTel, P.daB64u(m.n)));
      S.errori = 0;
      // (senza aspettare qui: la risposta passa da questa stessa fila)
      chiedi("ciao").then(() => { S.fase = "pronta"; render(); carica(); }, (e) => avviso(e.message, "err"));
      return;
    }
    if (h.tipo !== P.TIPO.DATI_PC || !S.canale) return;
    let d;
    try { d = await S.canale.decifra(b); } catch { return scarto(); }
    S.errori = 0;
    if (d.re != null) {
      const a = S.attese.get(d.re);
      if (!a) return;
      S.attese.delete(d.re);
      clearTimeout(a.t);
      if (d.ok) a.si(d.dati); else a.no(Object.assign(new Error(d.errore || "Non riuscito sul PC"), { dati: d.dati }));
      return;
    }
    if (d.evento === "fine") return chiusa(d.perche);
    if (d.evento === "ordine" && d.ordine) { S.ordini.set(d.ordine.id, d.ordine); render(); return; }
    if (d.evento === "avviso") avviso(d.testo);
  }
  function scarto() {
    if (++S.errori < 5) return;
    S.errori = 0;
    if (S.canale) chiusa("messaggi non validi");
  }
  function chiedi(cmd, args = {}, tempo = TEMPO) {
    return new Promise((si, no) => {
      if (!S.canale) { no(new Error("Sessione chiusa")); return; }
      S.ultimo = Date.now();
      const id = ++S.id;
      const t = setTimeout(() => { S.attese.delete(id); no(new Error(S.pari === false ? "Il PC non è raggiungibile" : "Il PC non ha risposto in tempo")); }, tempo);
      S.attese.set(id, { si, no, t });
      S.canale.cifra({ id, cmd, ...args }).then((f) => {
        if (!manda(f)) { clearTimeout(t); S.attese.delete(id); no(new Error("Non collegato al ponte: riprovo a collegarmi")); collega(); }
      }, (e) => { clearTimeout(t); S.attese.delete(id); no(e); });
    });
  }
  // La sessione è finita: niente dati dei pazienti restano qui.
  function chiusa(perche) {
    S.canale = null; S.saluto = null;
    for (const a of S.attese.values()) { clearTimeout(a.t); a.no(new Error("Sessione chiusa")); }
    S.attese.clear();
    svuota();
    S.perche = perche || "";
    // la chiave non vale più: si dimentica, e si dice perché
    if (perche === "scaduta" || perche === "revocata") { dimentica(perche); return; }
    if (FINITE.has(perche)) { dimentica("senza"); return; }
    S.fase = "chiusa";
    S.menu = false;
    render();
  }
  function riapri() {
    if (!S.coppia) return;
    S.fase = "collego";
    render();
    if (S.ws && S.ws.readyState === 1 && S.pari) saluta(); else collega();
  }

  // ------------------------------------------------------------- i comandi
  async function carica() {
    S.occupato.add("lista"); render();
    try {
      const [pazienti, catalogo, ordini] = await Promise.all([chiedi("pazienti"), chiedi("richieste"), chiedi("ordini")]);
      S.pazienti = pazienti; S.catalogo = catalogo;
      for (const o of ordini || []) if (!S.ordini.has(o.id) || !S.ordini.get(o.id).fine) S.ordini.set(o.id, o);
    } catch (e) { avviso(e.message, "err"); }
    S.occupato.delete("lista"); render();
  }
  async function aggiornaLista() {
    S.occupato.add("lista"); render();
    try { S.pazienti = await chiedi("pazienti"); } catch (e) { avviso(e.message, "err"); }
    S.occupato.delete("lista"); render();
  }
  async function aggiornaOrdini() {
    try { for (const o of await chiedi("ordini")) S.ordini.set(o.id, o); render(); } catch { /* lo dirà il prossimo comando */ }
  }
  const paziente = (ep) => (S.pazienti || []).find((p) => p.ep === ep) || null;
  function aggiornaRiga(riga) {
    if (!riga || !S.pazienti) return;
    const i = S.pazienti.findIndex((p) => p.ep === riga.ep);
    if (i >= 0) S.pazienti[i] = riga;
  }
  function apriPaziente(ep) {
    S.vista = { nome: "paziente", ep, scheda: S.vista.ep === ep ? S.vista.scheda : "esiti" };
    S.menu = false; S.arma = null; S.promTesto = "";
    window.scrollTo(0, 0);
    render();
    caricaEsiti(ep);
  }
  async function caricaEsiti(ep) {
    if (S.occupato.has("esiti" + ep)) return;
    S.occupato.add("esiti" + ep); render();
    try { S.esiti.set(ep, await chiedi("esiti", { ep }, 40e3)); } catch (e) { avviso(e.message, "err"); }
    S.occupato.delete("esiti" + ep); render();
  }
  async function aggiornaValori(ep) {
    S.occupato.add("valori" + ep); render();
    try {
      const d = await chiedi("aggiornaValori", { ep }, 170e3);
      S.esiti.set(ep, d);
      avviso("Valori aggiornati dal PC");
    } catch (e) { avviso(e.message, "err"); }
    S.occupato.delete("valori" + ep); render();
  }
  async function salvaNota(ep) {
    const testo = S.bozze.get(ep);
    const p = paziente(ep);
    if (testo == null || !p || testo === p.nota) { S.bozze.delete(ep); return; }
    S.occupato.add("nota" + ep); render();
    try { aggiornaRiga(await chiedi("nota", { ep, testo })); S.bozze.delete(ep); avviso("Nota salvata sul PC"); }
    catch (e) { avviso(e.message, "err"); }
    S.occupato.delete("nota" + ep); render();
  }
  async function aggiungiProm(ep) {
    const testo = S.promTesto.trim();
    if (!testo) return;
    S.occupato.add("prom" + ep); render();
    try { aggiornaRiga(await chiedi("promemoria", { ep, testo })); S.promTesto = ""; }
    catch (e) { avviso(e.message, "err"); }
    S.occupato.delete("prom" + ep); render();
  }
  async function fattoProm(ep, pid) {
    S.occupato.add("fatto" + pid); render();
    try { aggiornaRiga(await chiedi("fatto", { ep, pid })); }
    catch (e) { if (e.dati) aggiornaRiga(e.dati); avviso(e.message, "err"); }
    S.occupato.delete("fatto" + pid); render();
  }

  // ------------------------------------------------- la scelta degli esami
  // Come nel pannello: un chip-pacchetto scrive il quesito e spunta i suoi
  // esami; un altro pacchetto toglie solo quelli che aveva messo il primo;
  // di nuovo lo stesso chip toglie quesito e pacchetto. Scritto a mano, il
  // quesito è del medico (vince su quello del triage).
  function selDi(ep) {
    if (!S.sel.has(ep)) S.sel.set(ep, { q: "", mio: false, esami: new Set(), pacchetto: "", pkgDa: new Set() });
    return S.sel.get(ep);
  }
  function scegliQuesito(ep, q) {
    const s = selDi(ep);
    const pk = (S.catalogo?.pacchetti || []).find((p) => p.q.toLowerCase() === q.toLowerCase());
    s.mio = false;
    if (!pk) { s.q = q; s.pacchetto = ""; s.pkgDa = new Set(); return; }
    if (s.pacchetto === pk.q) {
      for (const k of s.pkgDa) s.esami.delete(k);
      s.q = ""; s.pacchetto = ""; s.pkgDa = new Set();
      return;
    }
    const nuovo = new Set();
    for (const k of pk.esami) {
      if (!s.esami.has(k)) { s.esami.add(k); nuovo.add(k); } else if (s.pkgDa.has(k)) nuovo.add(k);
    }
    for (const k of s.pkgDa) if (!nuovo.has(k)) s.esami.delete(k);
    s.q = pk.q; s.pacchetto = pk.q; s.pkgDa = nuovo;
  }
  function togglaEsame(ep, k) {
    const s = selDi(ep);
    s.pkgDa.delete(k);
    if (s.esami.has(k)) s.esami.delete(k); else s.esami.add(k);
  }
  function togglaProfilo(ep, esami) {
    const s = selDi(ep);
    const tutti = esami.every((k) => s.esami.has(k));
    for (const k of esami) { s.pkgDa.delete(k); if (tutti) s.esami.delete(k); else s.esami.add(k); }
  }
  // Il bottone chiede conferma col nome del paziente: dal telefono, un
  // tocco sulla riga sbagliata non deve diventare un ordine.
  async function ordina(ep) {
    const s = selDi(ep), p = paziente(ep);
    if (!p || !s.esami.size || !s.q.trim()) return;
    if (!S.arma || S.arma.ep !== ep || Date.now() - S.arma.ts > 6000) {
      S.arma = { ep, ts: Date.now() };
      render();
      setTimeout(() => { if (S.arma && S.arma.ep === ep && Date.now() - S.arma.ts >= 6000) { S.arma = null; render(); } }, 6100);
      return;
    }
    S.arma = null;
    S.occupato.add("ordina" + ep); render();
    try {
      const d = await chiedi("ordina", { ep, esami: [...s.esami], quesito: s.q.trim(), mio: s.mio }, 60e3);
      for (const o of d.ordini || []) {
        if (!S.ordini.has(o.id)) S.ordini.set(o.id, { ...o, stato: "avvio", tono: "run", titolo: "Parte", testo: "Apro la scheda dell'ordine sul PC…", fine: false, ts: Date.now() });
      }
      S.sel.delete(ep);
      if (d.avviso) avviso(d.avviso, "err");
      window.scrollTo(0, 0);
    } catch (e) { avviso(e.message, "err"); }
    S.occupato.delete("ordina" + ep); render();
  }

  // --------------------------------------------------------------- disegno
  let tAvviso = 0;
  function avviso(testo, tono = "") {
    S.avviso = { testo, tono };
    clearTimeout(tAvviso);
    tAvviso = setTimeout(() => { S.avviso = null; render(); }, tono === "err" ? 6500 : 3500);
    render();
  }
  const statoPc = () => (!S.ws || S.ws.readyState !== 1 ? `<span class="statopc amb"><i></i>Ricollego…</span>`
    : S.pari === false ? `<span class="statopc amb"><i></i>PC assente</span>` : `<span class="statopc"><i></i>PC</span>`);
  function testata() {
    if (S.fase !== "pronta") return "";
    const p = S.vista.nome === "paziente" ? paziente(S.vista.ep) : null;
    const sx = p ? `<button class="ico" data-a="indietro" aria-label="Tutti i pazienti">${ICO.indietro}</button>` : `<span class="logo">${ICO.logo}</span>`;
    const tit = p ? `<b>${esc(p.nome)}</b><small>ep. ${esc(p.ep)}${p.posto ? " · " + esc(p.posto) : ""}${p.triage ? " · " + esc(p.triage.toLowerCase()) : ""}</small>`
      : `<b>Pazienti</b><small>dal PC del pronto soccorso</small>`;
    return `<header class="top">${sx}<div class="tit">${tit}</div>${statoPc()}<button class="ico" data-a="menu" aria-label="Altro" aria-expanded="${S.menu}">${ICO.altro}</button>
      ${S.menu ? `<div class="menu" role="menu">
        ${p ? "" : `<button data-a="aggiornaLista">Aggiorna l'elenco</button>`}
        <button data-a="esci">Chiudi la sessione</button>
        <button class="via" data-a="dimentica">Dimentica questo PC</button>
        <div class="info">Associato fino alle ${hhmm(S.coppia.scade)}. La sessione si chiude da sola dopo 20 minuti senza comandi.</div>
      </div>` : ""}</header>`;
  }
  function piena(icona, titolo, testo, extra = "", amb = false) {
    return `<main><div class="piena"><div class="tondo${amb ? " amb" : ""}">${icona}</div><h1>${esc(titolo)}</h1>${testo}${extra}</div></main>`;
  }
  function schermata() {
    const scade = S.coppia ? `<div class="piccolo">Associato fino alle ${hhmm(S.coppia.scade)}</div>` : "";
    switch (S.fase) {
      case "senza":
        return piena(ICO.croce, "PS Assist sull'iPhone", `${FINITE.has(S.perche) ? `<p><b>${esc(PERCHE[S.perche])}.</b></p>` : ""}<p>Il pannello del pronto soccorso, dal telefono. Si associa una volta per turno, dal PC.</p>
          <ol class="passi"><li>Sul PC, nel pannello: <b>⋯ → iPhone</b>.</li><li><b>Associa l'iPhone</b>: compare un QR.</li><li>Inquadralo con la <b>fotocamera</b> e tocca il link.</li></ol>`);
      case "scaduta":
      case "revocata":
        return piena(ICO.lucchetto, S.fase === "scaduta" ? "Associazione scaduta" : "Associazione revocata",
          `<p>${S.fase === "scaduta" ? `L'associazione con il PC è finita${S.scaduta ? ` alle ${hhmm(S.scaduta)}` : ""}.` : "Il PC ha revocato l'associazione con questo telefono."}</p>
           <p>Sul PC: <b>⋯ → iPhone → Associa l'iPhone</b>, e inquadra il QR nuovo.</p>`, "", true);
      case "avvio":
      case "collego":
        return `<main><div class="piena"><div class="giro"></div><h1>Mi collego al PC…</h1><p>Attraverso il ponte, cifrato da un capo all'altro.</p>${scade}</div></main>`;
      case "pc":
        if (S.pari === null && !(S.ws && S.ws.readyState === 1)) {
          return piena(ICO.pc, "Non raggiungo il ponte", "<p>Controlla la connessione del telefono: riprovo da solo.</p>",
            `<button class="grande" data-a="riapri">Riprova</button>${scade}`, true);
        }
        return piena(ICO.pc, "Il PC non risponde", `<p>${S.pari ? "Il PC è sul ponte ma non risponde: riprovo da solo." : "Sul PC dell'ospedale deve essere aperto Chrome col pannello: lo aspetto, e riprovo da solo."}</p>`,
          `<button class="grande" data-a="riapri">Riprova</button>${scade}`, true);
      case "chiusa":
        return piena(ICO.lucchetto, "Sessione chiusa", `<p>${esc(PERCHE[S.perche] || "La sessione è finita")}.</p><p>I dati dei pazienti non sono più su questo telefono.</p>`,
          `<button class="grande" data-a="riapri">Riapri</button>${scade}`);
      default: return "";
    }
  }
  function promPill(p) {
    const l = [...(p.prom || [])].sort((a, b) => a.t - b.t);
    if (!l.length) return "";
    return `<span class="prom ${banda(l[0].t)}">${esc(quanto(l[0].t))} ${esc(l[0].testo)}${l.length > 1 ? ` +${l.length - 1}` : ""}</span>`;
  }
  function rigaPaz(p) {
    return `<button class="paz t-${TRIAGE[p.triage] || "nessuno"}${p.spento ? " spento" : ""}" data-a="paz" data-ep="${esc(p.ep)}">
      <span class="tr"></span><span class="cor"><span class="r1"><span class="nome">${p.omonimo ? '<span class="om">⚠ </span>' : ""}${esc(p.breve || p.nome)}</span>${
        p.posto ? `<span class="posto">${esc(p.posto)}</span>` : ""}${promPill(p)}</span>${p.nota ? `<span class="nota">${esc(p.nota)}</span>` : ""}</span>
      <span class="vai">${ICO.vai}</span></button>`;
  }
  function ordineHtml(o, barra = false) {
    const segno = o.tono === "err" || o.tono === "warn" ? "!" : o.stato === "stampate" || o.stato === "stampa" || (o.fine && o.tono === "ok") ? "✓" : "";
    return `<div class="ord ${esc(o.tono || "run")}${barra ? " ordbar" : ""}" role="status"${barra ? ` data-a="paz" data-ep="${esc(o.ep)}"` : ""}>
      <span class="seg-o">${segno}</span>
      <span class="c"><b>${esc(o.titolo || "")}${barra ? ` · ${esc(o.paziente || "")}` : ""}</b><span>${esc(o.testo || "")}</span>${
        o.dettaglio ? `<small>${esc(o.dettaglio)}</small>` : ""}${!barra ? `<small>${esc(o.n === 1 ? "1 esame" : `${o.n} esami`)}${o.rx ? " · radiologia" : ""} · ${hhmm(o.ts || Date.now())}</small>` : ""}</span>
      ${o.fine && !barra ? `<button class="x" data-a="nascondi" data-id="${esc(o.id)}" aria-label="Chiudi">✕</button>` : ""}</div>`;
  }
  const ordiniDi = (ep) => [...S.ordini.values()].filter((o) => o.ep === ep && !S.nascosti.has(o.id)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  function vistaLista() {
    if (!S.pazienti) return `<main><div class="carica"><div class="giro"></div></div></main>`;
    const vivi = S.pazienti.filter((p) => !p.prec);
    const inLista = vivi.filter((p) => !p.posto), inStanza = vivi.filter((p) => p.posto).sort((a, b) => a.posto.localeCompare(b.posto, "it", { numeric: true }));
    const prec = S.pazienti.filter((p) => p.prec);
    const blocco = (titolo, l) => (l.length ? `<div class="lbl">${esc(titolo)} <span class="n">${l.length}</span></div><div class="carta">${l.map(rigaPaz).join("")}</div>` : "");
    const inCorso = [...S.ordini.values()].filter((o) => !o.fine && !S.nascosti.has(o.id)).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    return `<main>${S.pazienti.length ? blocco("In lista", inLista) + blocco("Nella stanza", inStanza) + blocco("Episodi precedenti", prec)
      : `<div class="vuoto">Nessun paziente nell'elenco del PC.<br>Si riempie aprendo i pazienti nel gestionale.</div>`}
      <p class="piede">Dal PC del pronto soccorso · la sessione si chiude dopo 20 minuti senza comandi.</p>
      ${inCorso ? ordineHtml(inCorso, true) : ""}</main>`;
  }
  function tabellaHtml(t) {
    const col = t.colonne;
    const testa = `<tr><th class="nm">Esame</th>${col.map((c, i) => `<th class="${i === 0 && c.cima !== "?" ? "ult" : ""}">${esc(c.cima)}${c.sotto ? `<small>${esc(c.sotto)}</small>` : ""}</th>`).join("")}</tr>`;
    const corpo = t.gruppi.map((g) => `<tr class="sez"><th class="nm" colspan="1">${esc(g.nome)}</th><td colspan="${col.length}"></td></tr>${g.righe.map((r) =>
      `<tr><th class="nm">${esc(r.nome)}${r.um ? ` <small>(${esc(r.um)})</small>` : ""}</th>${r.valori.map((v) => (!v ? `<td class="vuota">·</td>`
        : `<td class="${v[1] ? "fuori" : ""}${v[2] ? " parz" : ""}">${esc(v[0])}${v[1] ? (v[1] < 0 ? "↓" : "↑") : ""}${v[3] ? `<span class="pct"> (${esc(v[3])}%)</span>` : ""}</td>`)).join("")}</tr>`).join("")}`).join("");
    const parz = t.gruppi.some((g) => g.righe.some((r) => r.valori.some((v) => v && v[2])));
    return `<div class="tabw"><table class="val"><thead>${testa}</thead><tbody>${corpo}</tbody></table></div>${parz ? `<div class="leg"><i>In corsivo</i>: parziale, il laboratorio non ha finito.</div>` : ""}`;
  }
  function vistaEsiti(p) {
    const e = S.esiti.get(p.ep);
    const carica = S.occupato.has("esiti" + p.ep), legge = S.occupato.has("valori" + p.ep);
    if (!e) return carica ? `<div class="carica"><div class="giro"></div></div>` : `<div class="vuoto">Esiti non caricati.</div>`;
    const nCol = e.tabella ? e.tabella.colonne.length : 0;
    const valori = `<div class="carta"><div class="sezt"><b>Valori</b>${nCol ? `<small>${nCol} ${nCol === 1 ? "prelievo" : "prelievi"}</small>` : ""}
        <button class="agg" data-a="valori" ${legge ? "disabled" : ""}>${legge ? "Leggo sul PC…" : "↻ Aggiorna i valori"}</button></div>
      ${e.tabella ? tabellaHtml(e.tabella) : `<div class="vuoto stretto">${legge ? "Il PC sta leggendo i valori: un minuto al massimo." : "Il PC non ha ancora letto valori per questo paziente. «Aggiorna i valori» li legge adesso, sul PC."}</div>`}</div>`;
    const referti = e.referti.length ? `<div class="lbl">Referti <span class="n">${e.referti.length}</span></div><div class="carta">${e.referti.map((r) => {
      const aperto = S.aperti.has(r.id);
      return `<button class="ref" data-a="referto" data-id="${esc(r.id)}" aria-expanded="${aperto}"><span class="r1"><span class="q">${esc(r.quando)}</span><span class="t">${esc(r.titolo)}</span><span class="s">${esc(r.sistema || "")}</span></span>${
        aperto ? (r.testo ? `<div class="testo">${esc(r.testo)}</div>` : `<div class="manca">${r.lungo ? "Testo troppo lungo per il telefono: leggilo sul PC." : "Testo non ancora letto sul PC: aprilo una volta dal pannello (Esiti), poi è qui."}</div>`) : ""}</button>`;
    }).join("")}</div>` : "";
    return `${valori}${referti}${e.nota ? `<p class="piede">${esc(e.nota)}</p>` : ""}`;
  }
  function vistaRichieste(p) {
    const c = S.catalogo;
    if (!c) return `<div class="carica"><div class="giro"></div></div>`;
    if (!p.ordina) return `<div class="vuoto">Per ordinare, il PC deve aver aperto almeno una volta la pagina di questo paziente.</div>`;
    const s = selDi(p.ep);
    const quesiti = c.quesiti.map((q) => {
      const pk = c.pacchetti.find((x) => x.q === q);
      const on = pk && s.pacchetto === pk.q;
      return `<button class="chip${on ? " on" : ""}" data-a="quesito" data-q="${esc(q)}" aria-pressed="${!!on}">${esc(q)}${pk ? `<span class="n"> · ${pk.esami.length}</span>` : ""}</button>`;
    }).join("");
    const gruppi = c.gruppi.map((g) => `<div class="gruppo"><h3>${esc(g.nome)}</h3>${g.profili.length ? `<div class="chips">${g.profili.map((pr, i) => {
      const on = pr.esami.every((k) => s.esami.has(k));
      return `<button class="chip${on ? " on" : ""}" data-a="profilo" data-g="${esc(g.nome)}" data-i="${i}">${esc(pr.nome)}</button>`;
    }).join("")}</div>` : ""}<div class="griglia">${g.esami.map((k) => `<button class="esame${s.esami.has(k) ? " on" : ""}" data-a="esame" data-k="${esc(k)}"><span class="box">✓</span>${esc(c.nomi[k] || k)}</button>`).join("")}</div>${
      g.rx ? `<p class="rxnota">La radiologia arriva nel carrello: la conferma resta del PC.</p>` : ""}</div>`).join("");
    return `<div class="carta q-w"><input id="quesito" type="text" enterkeyhint="done" autocomplete="off" placeholder="Quesito diagnostico" value="${esc(s.q)}"><div class="chips">${quesiti}</div></div>
      <div class="lbl">Esami</div><div class="carta">${gruppi}</div>`;
  }
  function ctaHtml(p) {
    if (S.vista.scheda !== "richieste" || !S.catalogo || !p.ordina) return "";
    const s = selDi(p.ep), n = s.esami.size, c = S.catalogo;
    const rx = [...s.esami].some((k) => c.rx.includes(k)), lab = [...s.esami].some((k) => !c.rx.includes(k));
    const nTxt = n === 1 ? "1 esame" : `${n} esami`;
    const occupato = S.occupato.has("ordina" + p.ep);
    const armato = S.arma && S.arma.ep === p.ep;
    const etichetta = occupato ? "Mando l'ordine al PC…" : armato ? `Ordino ${nTxt} per ${p.breve || p.nome}? Tocca di nuovo`
      : !n ? "Scegli gli esami" : lab ? `Conferma e stampa · ${nTxt}` : `Metti in carrello · ${nTxt}`;
    const perche = n && !s.q.trim() ? "Scrivi il quesito diagnostico" : rx && lab ? "Due richieste: il laboratorio si conferma da solo, la radiologia resta nel carrello del PC" : "";
    const nomi = [...s.esami].map((k) => c.nomi[k] || k).join(", ");
    return `<div class="cta">${n ? `<div class="sel">${esc(nomi)}</div>` : ""}<button id="ordina" data-a="ordina" class="${armato ? "arma" : ""}" ${!n || !s.q.trim() || occupato ? "disabled" : ""}>${esc(etichetta)}</button>${
      perche ? `<div class="perche">${esc(perche)}</div>` : ""}</div>`;
  }
  function vistaPaziente() {
    const p = paziente(S.vista.ep);
    if (!p) return `<main><div class="vuoto">Questo paziente non è più nell'elenco del PC.</div></main>`;
    const bozza = S.bozze.has(p.ep) ? S.bozze.get(p.ep) : p.nota || "";
    const proms = [...(p.prom || [])].sort((a, b) => a.t - b.t);
    const ordini = ordiniDi(p.ep).map((o) => ordineHtml(o)).join("");
    const salvaNota = S.occupato.has("nota" + p.ep) ? "salvo…" : S.bozze.has(p.ep) && bozza !== (p.nota || "") ? "si salva quando esci dal campo" : "";
    return `<main>${ordini}
      <div class="carta"><div class="nota-w"><textarea id="nota" rows="2" placeholder="Nota su questo paziente" aria-label="Nota">${esc(bozza)}</textarea>
        <div class="salva"><span>${esc(salvaNota)}</span></div></div>
        <div class="proms">${proms.map((x) => `<div class="promr"><span class="quando ${banda(x.t)}">${hhmm(x.t)}</span><span class="cosa">${esc(x.testo)}<small>${esc(quanto(x.t))}</small></span>
          <button class="btnmini" data-a="fatto" data-pid="${esc(x.id)}" ${S.occupato.has("fatto" + x.id) ? "disabled" : ""}>✓ Fatto</button></div>`).join("")}
          <div class="addprom"><input id="promin" type="text" enterkeyhint="done" autocomplete="off" placeholder="Promemoria: «11:30 tropo», «tra 2h ECG»" value="${esc(S.promTesto)}">
            <button data-a="prom" ${S.occupato.has("prom" + p.ep) ? "disabled" : ""}>Aggiungi</button></div></div></div>
      <div class="seg" role="tablist"><button class="${S.vista.scheda === "esiti" ? "on" : ""}" data-a="scheda" data-s="esiti" role="tab">Esiti</button><button class="${S.vista.scheda === "richieste" ? "on" : ""}" data-a="scheda" data-s="richieste" role="tab">Richieste</button></div>
      ${S.vista.scheda === "esiti" ? vistaEsiti(p) : vistaRichieste(p)}</main>${ctaHtml(p)}`;
  }

  function render() {
    // il cursore resta dov'era: un ridisegno non deve rubare il campo a chi scrive
    const att = document.activeElement && document.activeElement.id ? document.activeElement : null;
    const fuoco = att ? { id: att.id, a: att.selectionStart, b: att.selectionEnd } : null;
    const corpo = S.fase === "pronta" ? (S.vista.nome === "paziente" ? vistaPaziente() : vistaLista()) : schermata();
    $app.innerHTML = testata() + corpo + (S.avviso ? `<div class="avviso ${esc(S.avviso.tono)}" role="alert">${esc(S.avviso.testo)}</div>` : "");
    if (fuoco) {
      const el = document.getElementById(fuoco.id);
      if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(fuoco.a, fuoco.b); } catch { /* non un campo di testo */ } }
    }
  }
  // senza ridisegnare: il bottone d'ordine mentre si scrive il quesito
  function ritoccaCta() {
    const p = paziente(S.vista.ep);
    const vecchio = document.querySelector(".cta");
    if (!p || !vecchio) return;
    const t = document.createElement("div");
    t.innerHTML = ctaHtml(p);
    if (t.firstElementChild) vecchio.replaceWith(t.firstElementChild);
  }

  // --------------------------------------------------------------- i gesti
  $app.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    if (!b || b.disabled) return;
    const a = b.dataset.a, ep = S.vista.ep;
    if (a !== "menu" && S.menu) S.menu = false;
    if (a === "menu") { S.menu = !S.menu; render(); }
    else if (a === "riapri") riapri();
    else if (a === "paz") apriPaziente(b.dataset.ep);
    else if (a === "indietro") { salvaNota(ep); S.vista = { nome: "lista", ep: "", scheda: "esiti" }; S.arma = null; render(); aggiornaLista(); }
    else if (a === "aggiornaLista") aggiornaLista();
    else if (a === "esci") { chiedi("esci").catch(() => {}); chiusa("chiusa dall'iPhone"); }
    else if (a === "dimentica") {
      if (b.dataset.sicuro !== "1") { b.dataset.sicuro = "1"; b.textContent = "Dimentico? Servirà un QR nuovo"; return; }
      if (S.canale) chiedi("esci").catch(() => {});
      dimentica("senza");
    }
    else if (a === "scheda") { S.vista.scheda = b.dataset.s; S.arma = null; render(); }
    else if (a === "valori") aggiornaValori(ep);
    else if (a === "referto") { if (S.aperti.has(b.dataset.id)) S.aperti.delete(b.dataset.id); else S.aperti.add(b.dataset.id); render(); }
    else if (a === "quesito") { scegliQuesito(ep, b.dataset.q); S.arma = null; render(); }
    else if (a === "esame") { togglaEsame(ep, b.dataset.k); S.arma = null; render(); }
    else if (a === "profilo") {
      const g = (S.catalogo?.gruppi || []).find((x) => x.nome === b.dataset.g);
      const pr = g && g.profili[Number(b.dataset.i)];
      if (pr) { togglaProfilo(ep, pr.esami); S.arma = null; render(); }
    }
    else if (a === "ordina") ordina(ep);
    else if (a === "prom") aggiungiProm(ep);
    else if (a === "fatto") fattoProm(ep, b.dataset.pid);
    else if (a === "nascondi") { S.nascosti.add(b.dataset.id); render(); }
    else render();
  });
  $app.addEventListener("input", (e) => {
    const t = e.target, ep = S.vista.ep;
    if (t.id === "quesito") {
      const s = selDi(ep);
      s.q = t.value; s.mio = true;   // scritto a mano: è il quesito del medico
      if (s.pacchetto && t.value.trim().toLowerCase() !== s.pacchetto.toLowerCase()) { s.pacchetto = ""; s.pkgDa = new Set(); }
      S.arma = null;
      ritoccaCta();
    } else if (t.id === "nota") {
      S.bozze.set(ep, t.value);
      t.style.height = "auto"; t.style.height = t.scrollHeight + "px";
    } else if (t.id === "promin") S.promTesto = t.value;
  });
  $app.addEventListener("focusout", (e) => { if (e.target.id === "nota") salvaNota(S.vista.ep); });
  $app.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.id === "promin") { e.preventDefault(); aggiungiProm(S.vista.ep); }
    else if (e.target.id === "quesito") { e.preventDefault(); e.target.blur(); }
  });
  // tornati sull'app (iOS chiude le prese delle pagine in sottofondo): ci si ricollega
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !S.chiavi || scadenze()) return;
    collega();
    render();
  });
  // L'associazione ha un'ora: passata, la chiave se ne va da sola. E la
  // regola dei 20 minuti vale anche qui: un'app lasciata in sottofondo non
  // tiene in memoria i pazienti finché il PC non glielo dice.
  function scadenze() {
    if (S.coppia && S.coppia.scade <= Date.now()) { S.scaduta = S.coppia.scade; if (S.canale) chiusa("scaduta"); else dimentica("scaduta"); return true; }
    if (S.canale && Date.now() - S.ultimo >= INATTIVO) { chiedi("esci").catch(() => {}); chiusa("inattivo"); return true; }
    return false;
  }
  setInterval(() => {
    if (!scadenze() && S.fase === "pronta" && !document.activeElement?.id) render();   // i tempi dei promemoria
  }, 30e3);

  // un QR nuovo inquadrato con l'app già aperta cambia solo il frammento: si
  // tiene la chiave nuova e si riparte da capo (la memoria di prima se ne va)
  window.addEventListener("hashchange", () => {
    const c = P.leggiFrammento(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    if (!c) return;
    try { localStorage.setItem(CHIAVE, JSON.stringify({ k: P.b64u(c.k), scade: c.scade })); } catch { /* niente */ }
    location.reload();
  });
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});

  (async function avvia() {
    S.coppia = caricaCoppia();
    if (!S.coppia) { S.fase = S.scaduta ? "scaduta" : "senza"; render(); return; }
    S.chiavi = await P.chiaviCoppia(S.coppia.k);
    S.fase = "collego";
    render();
    collega();
  })();
})();
