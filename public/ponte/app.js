/*
 * PS Assist sull'iPhone.
 *
 * Il pannello del pronto soccorso dal telefono, per quando il medico è
 * lontano dal PC. Questa pagina non parla col gestionale: parla col PC — con
 * l'estensione aperta lì — attraverso il ponte, che passa i messaggi senza
 * poterli leggere (cripto.js). Il PC esegue ogni comando con il codice di
 * sempre e risponde.
 *
 * Cosa resta sul telefono: solo la chiave dell'associazione (dal QR, una
 * volta per turno), la sua scadenza e il numero di questo telefono (il PC
 * accetta solo il primo telefono che entra). I dati dei pazienti stanno nella
 * memoria di questa pagina, mai in localStorage, IndexedDB o nelle cache, e
 * si cancellano quando la sessione finisce.
 */
(function () {
  "use strict";
  const P = globalThis.PonteCripto;
  const $app = document.getElementById("app");
  const CHIAVE = "psassist.ponte.v1";
  const TEMPO = 30e3;
  const INATTIVO = 20 * 60e3;        // come sul PC: 20 minuti senza comandi del medico e la sessione è finita
  const DURATA_MAX = 14 * 3600e3;    // un link non vale più di un turno, qualunque ora porti
  const VERDE_MAX = 2 * 60e3;        // un ordine finito bene se ne va da solo, come sulla striscia del PC
  const BATTITO = 20e3, PONG = 10e3; // la presa parla ogni 20 secondi; senza «pong» in 10 è morta
  const ATTESA_VALORI = 200e3;       // «Aggiorna i valori»: il PC, al peggio, ci mette 10 + 150 + 30 secondi
  const TRIAGE = { ROSSO: "rosso", ARANCIONE: "arancione", AZZURRO: "azzurro", VERDE: "verde", BIANCO: "bianco" };
  // Le chiusure decise qui; quelle del PC portano la loro frase.
  const PERCHE = { inattivo: "20 minuti senza comandi", "chiusa dall'iPhone": "Chiusa da questo telefono", riavvio: "L'estensione sul PC si è riavviata" };
  // dopo queste la chiave di questo telefono non apre più niente
  const FINITE = new Set(["nuova associazione", "revocata", "scaduta"]);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const minuti = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}` : `${min}m`);
  const quanto = (t) => { const ora = Date.now(); if (t > ora) return minuti(Math.ceil((t - ora) / 60e3)); const r = Math.floor((ora - t) / 60e3); return r < 1 ? "ora" : "−" + minuti(r); };
  const fa = (t) => { const m = Math.floor((Date.now() - t) / 60e3); return m < 1 ? "adesso" : m < 60 ? `${m} min fa` : `${Math.floor(m / 60)} h fa`; };
  const banda = (t) => { const m = Math.ceil((t - Date.now()) / 60e3); return m > 30 ? "" : m > 10 ? "amb" : "ros"; };
  // chi è, senza troncare niente: nome, età, posto — «ROSSI MARIO · 77 anni · OBI 2»
  const chi = (p) => [p.nome, Number.isInteger(p.eta) ? (p.eta === 1 ? "1 anno" : `${p.eta} anni`) : "", p.posto].filter(Boolean).join(" · ");
  const ICO = {
    indietro: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    altro: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    croce: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    pc: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    lucchetto: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };

  // --------------------------------------------------------------- lo stato
  // Tutto qui è in memoria. La sola cosa scritta sul telefono è la chiave.
  const S = {
    coppia: null, chiavi: null, codice: "", nuova: null, ws: null, pari: null, tentativi: 0, tRiprova: 0, tPong: 0,
    saluto: null, canale: null, nSessione: "", attese: new Map(), id: 0, ultimo: 0,
    fase: "avvio", perche: "", testoFine: "", scaduta: 0,
    pazienti: null, aggiornato: 0, erroreLista: "", rinfresca: false, catalogo: null, esiti: new Map(), ordini: new Map(), nascosti: new Set(),
    vista: { nome: "lista", ep: "" }, scheda: "esiti", sel: new Map(), bloccati: new Map(), aperti: new Set(),
    occupato: new Set(), bozze: new Map(), notaAperta: "", promAperto: "", promTesto: "", fatti: new Map(), menu: false, arma: null, avviso: null,
    inviati: new Map(),  // ep → oid dell'ordine che sta andando al PC (il bottone aspetta)
  };
  function svuota() {
    S.pazienti = null; S.aggiornato = 0; S.erroreLista = ""; S.catalogo = null; S.esiti.clear(); S.ordini.clear(); S.nascosti.clear();
    S.sel.clear(); S.bloccati.clear(); S.aperti.clear(); S.occupato.clear(); S.inviati.clear(); S.bozze.clear(); S.promTesto = ""; S.arma = null;
    S.notaAperta = ""; S.promAperto = "";
    for (const t of S.fatti.values()) clearTimeout(t);
    S.fatti.clear();
    S.vista = { nome: "lista", ep: "" };
  }

  // ---------------------------------------------------- la chiave del QR
  const stessa = (a, b) => P.b64u(a) === P.b64u(b);
  const nuovoDev = () => P.b64u(P.casuale(16));
  // da un link: la scadenza non oltre un turno da adesso, e un numero nuovo per questo telefono
  function dalLink(hash) {
    const c = P.leggiFrammento(hash);
    return c ? { k: c.k, scade: Math.min(c.scade, Date.now() + DURATA_MAX), dev: nuovoDev() } : null;
  }
  function salva(c) {
    try { localStorage.setItem(CHIAVE, JSON.stringify({ k: P.b64u(c.k), scade: c.scade, dev: c.dev })); } catch { /* solo in memoria */ }
  }
  function salvata() {
    try {
      const o = JSON.parse(localStorage.getItem(CHIAVE) || "null");
      if (!o) return null;
      if (!(o.scade > Date.now())) { S.scaduta = o.scade || 0; localStorage.removeItem(CHIAVE); return null; }
      const k = P.daB64u(o.k);
      if (k.length !== 32) return null;
      const c = { k, scade: Math.min(o.scade, Date.now() + DURATA_MAX), dev: /^[\w-]{16,32}$/.test(o.dev || "") ? o.dev : nuovoDev() };
      if (c.dev !== o.dev) salva(c);
      return c;
    } catch { return null; }
  }
  function dimentica(fase) {
    try { localStorage.removeItem(CHIAVE); } catch { /* niente */ }
    S.coppia = null; S.chiavi = null; S.canale = null; S.saluto = null; S.nSessione = "";
    svuota();
    zitto();
    const ws = S.ws; S.ws = null;
    if (ws) try { ws.close(); } catch { /* già chiusa */ }
    S.fase = fase; S.menu = false; render();
  }
  async function parti(c) {
    S.coppia = c; S.nuova = null;
    S.chiavi = await P.chiaviCoppia(c.k);
    S.codice = await P.codice(c.k);
    S.fase = "collego";
    render();
    collega();
  }

  // ---------------------------------------------------------------- la presa
  function collega() {
    if (!S.chiavi || (S.ws && S.ws.readyState <= 1)) return;
    clearTimeout(S.tRiprova);
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ponte/ws?r=${S.chiavi.stanza}&ruolo=tel`);
    ws.binaryType = "arraybuffer";
    S.ws = ws;
    let fila = Promise.resolve();
    ws.onmessage = (e) => {
      if (S.ws !== ws) return;
      if (e.data === "pong") { clearTimeout(S.tPong); S.tPong = 0; return; }
      fila = fila.then(() => ricevi(e.data)).catch(() => {});
    };
    ws.onclose = (e) => {
      if (S.ws !== ws) return;
      S.ws = null; S.pari = null; S.saluto = null;
      clearTimeout(S.tPong); S.tPong = 0;
      if (!S.chiavi) return;
      // un altro telefono (o un'altra scheda) ha preso il posto di questo: niente tiro alla fune
      if (e && e.code === 4001) return altrove();
      if (S.fase === "collego" && S.tentativi >= 1) S.fase = "pc";   // il ponte stesso non risponde
      if (document.visibilityState === "visible") {
        const ms = [800, 2000, 4000, 8000, 15000][Math.min(S.tentativi++, 4)];
        S.tRiprova = setTimeout(collega, ms);
      }
      render();
    };
    ws.onopen = () => { if (S.ws === ws) { S.tentativi = 0; batti(); } };
  }
  // Il battito: se il «pong» non torna, la presa è morta anche se sembra
  // aperta (una rete che la lascia cadere senza dirlo): se ne apre un'altra.
  function batti() {
    const ws = S.ws;
    if (!ws || ws.readyState !== 1 || S.tPong) return;
    ws.send("ping");
    S.tPong = setTimeout(() => { S.tPong = 0; if (S.ws === ws) rifai(); }, PONG);
  }
  function rifai() {
    const ws = S.ws;
    S.ws = null; S.pari = null; S.saluto = null;
    clearTimeout(S.tPong); S.tPong = 0;
    if (ws) try { ws.close(); } catch { /* già chiusa */ }
    collega();
  }
  setInterval(() => { if (document.visibilityState === "visible") batti(); }, BATTITO);
  // Il ponte dice solo se dall'altra parte c'è il PC.
  function presenza(pari) {
    S.pari = pari;
    if (pari && !S.canale && !S.saluto && (S.fase === "collego" || S.fase === "pc")) saluta();
    else if (pari && S.canale) {
      aggiornaOrdini();   // tornati in linea: a che punto sono gli ordini
      if (S.rinfresca) { S.rinfresca = false; rileggi(); }
    }
    if (!pari && !S.canale && S.fase === "collego") S.fase = "pc";
    render();
  }
  async function saluta() {
    const n = P.casuale(16);
    const mio = { n: P.b64u(n), byte: n };
    S.saluto = mio;
    manda(await P.sigilla(S.chiavi.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: mio.n, dev: S.coppia.dev }));
    setTimeout(() => {
      if (S.saluto !== mio) return;
      S.saluto = null;
      if (S.fase === "collego") { S.fase = "pc"; render(); }
      if (S.pari && S.fase === "pc") saluta();
    }, 8000);
  }
  const manda = (f) => { if (S.ws && S.ws.readyState === 1) { S.ws.send(f); return true; } return false; };
  // Quello che non si apre con le nostre chiavi si ignora e basta.
  async function ricevi(dati) {
    if (typeof dati === "string") {
      try { const m = JSON.parse(dati); if (typeof m.pari === "boolean") presenza(m.pari); } catch { /* niente */ }
      return;
    }
    const b = new Uint8Array(dati);
    const h = P.leggiTestata(b);
    if (!h) return;
    if (h.tipo === P.TIPO.SALUTO_PC) {
      let m;
      try { m = (await P.apri(S.chiavi.salutoPc, b, P.TIPO.SALUTO_PC)).dati; } catch { return; }
      // il PC non conosce la nostra sessione (si è riavviato, o l'ha chiusa):
      // vale solo se parla di QUESTA sessione — ripetuto più tardi non chiude niente
      if (m.riparti) { if (S.canale && m.eco === S.nSessione) chiusa(m.perche || "riavvio", m.testo); return; }
      if (!S.saluto || m.eco !== S.saluto.n) return;   // un saluto vecchio, o non nostro
      const mio = S.saluto;
      S.saluto = null;
      if (m.no) return dimentica("rifiutato");          // il PC è di un altro telefono
      S.canale = P.canaleTel(await P.chiaviSessione(S.coppia.k, mio.byte, P.daB64u(m.n)));
      S.nSessione = mio.n;
      S.ultimo = Date.now();
      // (senza aspettare qui: la risposta passa da questa stessa fila)
      chiedi("ciao", {}, TEMPO, true).then((d) => {
        if (d && d.scade > 0 && d.scade < S.coppia.scade) { S.coppia.scade = d.scade; salva(S.coppia); }
        S.fase = "pronta"; render(); carica();
      }, (e) => avviso(e.message, "err"));
      return;
    }
    if (h.tipo !== P.TIPO.DATI_PC || !S.canale) return;
    let d;
    try { d = await S.canale.decifra(b); } catch { return; }
    if (d.re != null) {
      const a = S.attese.get(d.re);
      if (!a) return;
      S.attese.delete(d.re);
      clearTimeout(a.t);
      if (d.ok) a.si(d.dati);
      else a.no(Object.assign(new Error(d.errore || "Non riuscito sul PC"), { dati: d.dati, incerto: !!d.incerto, dimesso: !!d.dimesso }));
      return;
    }
    if (d.evento === "fine") return chiusa(d.perche, d.testo);
    if (d.evento === "ordine" && d.ordine) { ordineVisto(d.ordine); render(); return; }
    if (d.evento === "avviso") avviso(d.testo);
  }
  // Un comando al PC. `auto`: lo manda l'app da sé (non il medico), e non
  // tiene aperta la sessione — né qui né sul PC.
  function chiedi(cmd, args = {}, tempo = TEMPO, auto = false) {
    return new Promise((si, no) => {
      if (!S.canale) { no(new Error("Sessione chiusa")); return; }
      if (!auto) S.ultimo = Date.now();
      const id = ++S.id;
      const t = setTimeout(() => {
        S.attese.delete(id);
        const assente = S.pari === false;
        no(Object.assign(new Error(assente ? "Il PC non è raggiungibile" : "Il PC non ha risposto in tempo"), { tempo: true }));
        if (!assente) rifai();   // una risposta che non arriva: la presa può essere morta
      }, tempo);
      S.attese.set(id, { si, no, t });
      S.canale.cifra({ id, cmd, ...args, ...(auto ? { auto: true } : {}) }).then((f) => {
        if (!manda(f)) { clearTimeout(t); S.attese.delete(id); no(new Error("Non collegato al ponte: riprovo a collegarmi")); collega(); }
      }, (e) => { clearTimeout(t); S.attese.delete(id); no(e); });
    });
  }
  // La sessione è finita: niente dati dei pazienti restano qui.
  function chiusa(perche, testo) {
    S.canale = null; S.saluto = null; S.nSessione = "";
    for (const a of S.attese.values()) { clearTimeout(a.t); a.no(new Error("Sessione chiusa")); }
    S.attese.clear();
    svuota();
    S.perche = perche || "";
    S.testoFine = testo || PERCHE[perche] || "La sessione è finita";
    if (FINITE.has(perche)) return dimentica("finita");   // la chiave non vale più
    zitto();
    S.fase = "chiusa"; S.menu = false;
    render();
  }
  // Aperto su un altro telefono, o in un'altra scheda: questo si ferma, e
  // riprende solo se il medico lo chiede.
  function altrove() {
    for (const a of S.attese.values()) { clearTimeout(a.t); a.no(new Error("Sessione chiusa")); }
    S.attese.clear();
    S.canale = null; S.saluto = null; S.nSessione = "";
    clearTimeout(S.tRiprova);
    svuota(); zitto();
    S.fase = "altrove"; S.menu = false;
    render();
  }
  function riapri() {
    if (!S.coppia) return;
    S.fase = "collego";
    render();
    if (S.ws && S.ws.readyState === 1 && S.pari) saluta(); else collega();
  }

  // ------------------------------------------------------------- i comandi
  function errore(e) {
    avviso(e.message, "err");
    if (e.dimesso) aggiornaLista(true);   // dimesso sul PC: dall'elenco se ne va
  }
  async function carica() {
    S.occupato.add("lista"); render();
    try {
      const [pazienti, catalogo, ordini] = await Promise.all([chiedi("pazienti", {}, TEMPO, true), chiedi("richieste", {}, TEMPO, true), chiedi("ordini", {}, TEMPO, true)]);
      S.pazienti = pazienti; S.catalogo = catalogo; S.aggiornato = Date.now(); S.erroreLista = "";
      for (const o of ordini || []) if (!S.ordini.has(o.id) || !S.ordini.get(o.id).fine) ordineVisto(o);
    } catch (e) { S.erroreLista = e.message; }
    S.occupato.delete("lista"); render();
  }
  async function aggiornaLista(auto = false) {
    if (!S.catalogo) return carica();
    S.occupato.add("lista"); render();
    try { S.pazienti = await chiedi("pazienti", {}, TEMPO, auto); S.aggiornato = Date.now(); S.erroreLista = ""; }
    catch (e) { if (S.pazienti) { if (!auto) avviso(e.message, "err"); } else S.erroreLista = e.message; }
    S.occupato.delete("lista"); render();
  }
  async function aggiornaOrdini() {
    try {
      for (const o of await chiedi("ordini", {}, TEMPO, true)) ordineVisto(o);
      S.bloccati.clear();   // la lista degli ordini è fresca: adesso si sa
      render();
    } catch { /* lo dirà il prossimo comando */ }
  }
  // Un ordine visto (risposta, evento o lista): se è quello della selezione
  // in attesa, la selezione ha fatto il suo — via, e niente secondo ordine.
  // L'ordine nato davvero sul PC («tel»+oid, con la sua l o r) finisce anche
  // l'attesa del bottone: la risposta può essersi persa per strada.
  const nato = (o, oid) => o.id === `tel${oid}l` || o.id === `tel${oid}r`;
  function ordineVisto(o) {
    // l'ordine vero prende il posto della carta «in preparazione» che il PC aveva dato
    for (const [id, x] of S.ordini) if (x.segnaposto && id !== o.id && o.id.startsWith(id)) S.ordini.delete(id);
    const prima = S.ordini.get(o.id);
    o.finito = (prima && prima.finito) || (o.fine && o.tono === "ok" ? Date.now() : 0);   // (quando il telefono l'ha visto finire bene)
    S.ordini.set(o.id, o);
    for (const [ep, s] of S.sel) if (s.oid && o.id.startsWith("tel" + s.oid)) { S.sel.delete(ep); if (S.arma && S.arma.ep === ep) S.arma = null; }
    for (const [ep, oid] of S.bloccati) if (o.id.startsWith("tel" + oid)) S.bloccati.delete(ep);
    for (const [ep, oid] of S.inviati) if (nato(o, oid)) S.inviati.delete(ep);
  }
  const paziente = (ep) => (S.pazienti || []).find((p) => p.ep === ep) || null;
  function aggiornaRiga(riga) {
    if (!riga || !S.pazienti) return;
    const i = S.pazienti.findIndex((p) => p.ep === riga.ep);
    if (i >= 0) S.pazienti[i] = riga;
  }
  function apriPaziente(ep) {
    S.vista = { nome: "paziente", ep };
    S.menu = false; S.arma = null; S.promTesto = ""; S.notaAperta = ""; S.promAperto = "";
    window.scrollTo(0, 0);
    render();
    caricaEsiti(ep);
  }
  async function caricaEsiti(ep, auto = false) {
    if (S.occupato.has("esiti" + ep)) return;
    S.occupato.add("esiti" + ep); render();
    try { S.esiti.set(ep, await chiedi("esiti", { ep }, 40e3, auto)); } catch (e) { if (!auto) errore(e); }
    S.occupato.delete("esiti" + ep); render();
  }
  // Tornati sull'app: l'elenco e, sulla pagina di un paziente, i suoi esiti
  // (un referto arrivato intanto). Li chiede l'app da sé: non tengono aperta la sessione.
  function rileggi() {
    aggiornaLista(true);
    if (S.vista.nome === "paziente") caricaEsiti(S.vista.ep, true);
  }
  async function aggiornaValori(ep) {
    S.occupato.add("valori" + ep); render();
    try {
      S.esiti.set(ep, await chiedi("aggiornaValori", { ep }, ATTESA_VALORI));
    } catch (e) { errore(e); }
    S.occupato.delete("valori" + ep); render();
  }
  async function salvaNota(ep) {
    const testo = S.bozze.get(ep);
    const p = paziente(ep);
    if (S.notaAperta === ep) S.notaAperta = "";
    if (testo == null || !p || testo === p.nota) { S.bozze.delete(ep); render(); return; }
    S.occupato.add("nota" + ep); render();
    try { aggiornaRiga(await chiedi("nota", { ep, testo })); S.bozze.delete(ep); avviso("Nota salvata sul PC"); }
    catch (e) { errore(e); }
    S.occupato.delete("nota" + ep); render();
  }
  async function aggiungiProm(ep) {
    const testo = S.promTesto.trim();
    if (!testo) return;
    S.occupato.add("prom" + ep); render();
    try { aggiornaRiga(await chiedi("promemoria", { ep, testo })); S.promTesto = ""; S.promAperto = ""; }
    catch (e) { errore(e); }
    S.occupato.delete("prom" + ep); render();
  }
  // «✓ Fatto» aspetta 5 secondi, con «Annulla»: un tocco sbagliato non toglie
  // un promemoria dal PC.
  function fattoProm(ep, pid) {
    if (S.fatti.has(pid)) return;
    S.fatti.set(pid, setTimeout(async () => {
      S.occupato.add("fatto" + pid); render();
      try { aggiornaRiga(await chiedi("fatto", { ep, pid })); }
      catch (e) { if (e.dati) aggiornaRiga(e.dati); errore(e); }
      S.fatti.delete(pid);
      S.occupato.delete("fatto" + pid); render();
    }, 5000));
    render();
  }
  function annullaFatto(pid) {
    if (S.occupato.has("fatto" + pid)) return;
    clearTimeout(S.fatti.get(pid));
    S.fatti.delete(pid);
    render();
  }

  // ------------------------------------------------- la scelta degli esami
  // Come nel pannello: un chip-pacchetto scrive il quesito e spunta i suoi
  // esami; un altro pacchetto toglie solo quelli che aveva messo il primo;
  // di nuovo lo stesso chip toglie quesito e pacchetto. Scritto a mano, il
  // quesito è del medico (vince su quello del triage). Ogni cambio è un
  // ordine nuovo (`oid` da rifare).
  function selDi(ep) {
    if (!S.sel.has(ep)) S.sel.set(ep, { q: "", mio: false, esami: new Set(), pacchetto: "", pkgDa: new Set(), oid: "" });
    return S.sel.get(ep);
  }
  function scegliQuesito(ep, q) {
    const s = selDi(ep);
    const pk = (S.catalogo?.pacchetti || []).find((p) => p.q.toLowerCase() === q.toLowerCase());
    s.mio = false; s.oid = "";
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
    s.pkgDa.delete(k); s.oid = "";
    if (s.esami.has(k)) s.esami.delete(k); else s.esami.add(k);
  }
  function togglaProfilo(ep, esami) {
    const s = selDi(ep);
    const tutti = esami.every((k) => s.esami.has(k));
    s.oid = "";
    for (const k of esami) { s.pkgDa.delete(k); if (tutti) s.esami.delete(k); else s.esami.add(k); }
  }
  // Il bottone chiede conferma col nome del paziente: dal telefono, un tocco
  // sulla riga sbagliata non deve diventare un ordine. Il numero dell'ordine
  // (`oid`) nasce qui e resta finché la selezione è la stessa: la stessa
  // conferma rimandata è lo stesso ordine, e il PC lo manda una volta sola.
  async function ordina(ep) {
    const s = selDi(ep), p = paziente(ep);
    if (!p || !s.esami.size || !s.q.trim() || S.bloccati.has(ep)) return;
    const ora = Date.now();
    if (!S.arma || S.arma.ep !== ep || ora - S.arma.ts > 6000) {
      if (!s.oid) s.oid = P.b64u(P.casuale(12));
      S.arma = { ep, ts: ora };
      render();
      setTimeout(() => { if (S.arma && S.arma.ep === ep && Date.now() - S.arma.ts >= 6000) { S.arma = null; render(); } }, 6100);
      return;
    }
    if (ora - S.arma.ts < 800) return;   // un doppio tocco per sbaglio è un tocco solo
    S.arma = null;
    const oid = s.oid;
    S.inviati.set(ep, oid); render();
    try {
      const d = await chiedi("ordina", { ep, oid, esami: [...s.esami], quesito: s.q.trim(), mio: s.mio }, 60e3);
      for (const o of d.ordini || []) {
        if (!S.ordini.has(o.id)) ordineVisto(o.titolo ? o : { ...o, stato: "avvio", tono: "run", titolo: "Parte", testo: "Apro la scheda dell'ordine sul PC…", fine: false, ts: Date.now() });
      }
      S.sel.delete(ep);
      if (d.avviso) avviso(d.avviso, "err");
      window.scrollTo(0, 0);
    } catch (e) {
      if ([...S.ordini.values()].some((o) => nato(o, oid))) S.sel.delete(ep);   // è lì sopra: niente allarme
      else if (e.tempo || e.incerto) {
        // Non si sa se è partito: la selezione se ne va e il bottone aspetta
        // la lista degli ordini dal PC. Mai un secondo ordine alla cieca.
        S.sel.delete(ep);
        S.bloccati.set(ep, oid);
        avviso("Non so se l'ordine è partito: controlla qui sopra prima di rifarlo", "err");
        window.scrollTo(0, 0);
        aggiornaOrdini();
      } else errore(e);
    }
    if (S.inviati.get(ep) === oid) S.inviati.delete(ep);
    render();
  }

  // --------------------------------------------------------------- disegno
  let tAvviso = 0;
  function avviso(testo, tono = "") {
    S.avviso = { testo, tono };
    clearTimeout(tAvviso);
    tAvviso = setTimeout(() => { S.avviso = null; render(); }, tono === "err" ? 6500 : 3500);
    render();
  }
  function zitto() { clearTimeout(tAvviso); S.avviso = null; }
  // il collegamento si dice solo quando manca
  const statoPc = () => (!S.ws || S.ws.readyState !== 1 ? `<span class="statopc"><i></i>Ricollego…</span>`
    : S.pari === false ? `<span class="statopc"><i></i>PC assente</span>` : "");
  function testata() {
    if (S.fase !== "pronta") return "";
    const suPaz = S.vista.nome === "paziente", p = suPaz ? paziente(S.vista.ep) : null;
    const sx = suPaz ? `<button class="ico" data-a="indietro" aria-label="Tutti i pazienti">${ICO.indietro}</button>` : "";
    const tit = p ? `<b>${p.omonimo ? '<span class="om">⚠ </span>' : ""}${esc(chi(p))}</b>${p.prec ? "<small>Episodio precedente</small>" : ""}`
      : suPaz ? "" : S.aggiornato ? `<small>Aggiornato alle ${hhmm(S.aggiornato)}</small>` : "";
    return `<header class="top">${sx}<div class="tit">${tit}</div>${statoPc()}<button class="ico" data-a="menu" aria-label="Altro" aria-expanded="${S.menu}">${ICO.altro}</button>
      ${S.menu ? `<div class="menu" role="menu">
        ${suPaz ? "" : `<button data-a="aggiornaLista">Aggiorna l'elenco</button>`}
        <button data-a="esci">Chiudi la sessione</button>
        <button class="via" data-a="dimentica">Dimentica questo PC</button>
        <div class="info">Associato fino alle ${hhmm(S.coppia.scade)} · codice ${esc(S.codice)}</div>
      </div>` : ""}</header>`;
  }
  function piena(icona, titolo, testo, extra = "", amb = false) {
    return `<main><div class="piena"><div class="tondo${amb ? " amb" : ""}">${icona}</div><h1>${esc(titolo)}</h1>${testo}${extra}</div></main>`;
  }
  const PASSI = `<ol class="passi"><li>Sul PC, nel pannello: <b>⋯ → iPhone</b>.</li><li><b>Associa l'iPhone</b>: compare un QR.</li><li>Inquadralo con la <b>fotocamera</b> e tocca il link.</li></ol>`;
  function schermata() {
    const scade = S.coppia ? `<div class="piccolo">Associato fino alle ${hhmm(S.coppia.scade)} · codice ${esc(S.codice)}</div>` : "";
    switch (S.fase) {
      case "senza":
        return piena(ICO.croce, "PS Assist sull'iPhone", PASSI);
      case "finita": {
        const sc = S.perche === "scaduta";
        return piena(ICO.lucchetto, sc ? "Associazione scaduta" : "Associazione chiusa",
          `<p>${esc(sc ? `L'associazione con il PC è finita${S.scaduta ? ` alle ${hhmm(S.scaduta)}` : ""}.` : `${S.testoFine}.`)}</p>
           <p>Per rientrare serve un QR nuovo: sul PC <b>⋯ → iPhone → Associa l'iPhone</b>.</p>`, "", true);
      }
      case "rifiutato":
        return piena(ICO.lucchetto, "Il PC è associato a un altro telefono",
          `<p>Questo QR l'ha già usato un altro telefono, e il PC accetta solo quello.</p><p>Se non eri tu: sul PC <b>⋯ → iPhone → Revoca l'iPhone</b>, poi un QR nuovo.</p>`, "", true);
      case "conferma":
        return piena(ICO.lucchetto, "Un'altra associazione?",
          `<p>Questo link associa il telefono al PC con il codice <b class="codice">${esc(S.nuova.codice)}</b>.</p>
           <p>Adesso è associato al PC con il codice <b class="codice">${esc(S.codice)}</b>, fino alle ${hhmm(S.coppia.scade)}.</p>
           <p>Il codice giusto è quello accanto al QR, sul PC.</p>`,
          `<button class="grande" data-a="sostituisci">Usa il codice ${esc(S.nuova.codice)}</button><button class="grande quiet" data-a="tieni">Tieni quella di adesso</button>`, true);
      case "avvio":
      case "collego":
        return `<main><div class="piena"><div class="giro"></div><h1>Mi collego al PC…</h1></div></main>`;
      case "pc":
        if (S.pari === null && !(S.ws && S.ws.readyState === 1)) {
          return piena(ICO.pc, "Non raggiungo il ponte", "<p>Controlla la connessione del telefono: riprovo da solo.</p>",
            `<button class="grande" data-a="riapri">Riprova</button>${scade}`, true);
        }
        return piena(ICO.pc, "Il PC non risponde", `<p>${S.pari ? "Il PC è sul ponte ma non risponde: riprovo da solo." : "Sul PC dell'ospedale deve essere aperto Chrome col pannello: lo aspetto, e riprovo da solo."}</p>
          <p>Se sul PC c'è un QR nuovo, inquadra quello.</p>`,
          `<button class="grande" data-a="riapri">Riprova</button>${scade}`, true);
      case "altrove":
        return piena(ICO.pc, "Aperto su un altro dispositivo", "<p>Il pannello è aperto su un altro telefono o in un'altra scheda: qui si è fermato.</p>",
          `<button class="grande" data-a="riapri">Riprendi qui</button>${scade}`);
      case "chiusa":
        return piena(ICO.lucchetto, "Sessione chiusa", `<p>${esc(S.testoFine)}.</p>`,
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
        p.posto ? `<span class="posto">${esc(p.posto)}</span>` : ""}${promPill(p)}</span>${p.nota ? `<span class="nota">${esc(p.nota)}</span>` : ""}</span></button>`;
  }
  // Un ordine, con le parole del PC: il titolo è com'è andata, l'ora una volta.
  // In una barra: quello che corre, o uno finito male (finché non lo si chiude
  // con ✕); «Ordine non completo» se non è stato confermato tutto.
  function ordineHtml(o, barra = false) {
    const segno = o.tono === "err" || o.tono === "warn" ? "!" : o.tono === "ok" ? "✓" : "";
    const male = o.fine && (o.tono === "err" || o.tono === "warn"), monco = male && (o.tono === "err" || o.stato !== "avviso");
    const titolo = barra ? `${monco ? "Ordine non completo" : o.titolo || ""} · ${o.paziente || ""}` : o.titolo || "";
    const testo = barra && monco ? [o.titolo, o.testo].filter(Boolean).join(" · ") : o.testo || "";
    const meta = barra || /\balle \d/.test(`${o.titolo} ${o.testo}`) ? "" : hhmm(o.ts || Date.now());
    return `<div class="ord ${esc(o.tono || "run")}${barra ? " ordbar" : ""}" role="status"${barra ? ` data-a="paz" data-ep="${esc(o.ep)}"` : ""}>
      <span class="seg-o">${segno}</span>
      <span class="c"><b>${esc(titolo)}</b>${testo ? `<span>${esc(testo)}</span>` : ""}${!barra && o.dettaglio ? `<small>${esc(o.dettaglio)}</small>` : ""}${meta ? `<small>${esc(meta)}</small>` : ""}</span>
      ${o.fine ? `<button class="x" data-a="nascondi" data-id="${esc(o.id)}" aria-label="Chiudi">✕</button>` : ""}</div>`;
  }
  // (un ordine finito bene se ne va da solo dopo due minuti: le carte non si ammucchiano)
  const ordiniDi = (ep) => [...S.ordini.values()].filter((o) => o.ep === ep && !S.nascosti.has(o.id) && !(o.finito && Date.now() - o.finito > VERDE_MAX))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  // La barra degli ordini: sulla lista, in fondo, quello che corre o uno finito
  // male; sulla pagina di un paziente, in testa, uno finito male di un altro.
  function barraOrdini(qui = "") {
    const l = [...S.ordini.values()].filter((o) => !S.nascosti.has(o.id) && o.ep !== qui && (!o.fine || o.tono === "err" || o.tono === "warn"))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const b = l.find((o) => o.fine) || (qui ? null : l[0]);
    return b ? ordineHtml(b, true) : "";
  }
  function vistaLista() {
    if (!S.pazienti) {
      if (S.erroreLista && !S.occupato.has("lista")) {
        return `<main><div class="piena corta"><div class="tondo amb">${ICO.pc}</div><h1>Elenco non letto</h1><p>${esc(S.erroreLista)}.</p>
          <button class="grande" data-a="aggiornaLista">Riprova</button></div></main>`;
      }
      return `<main><div class="carica"><div class="giro"></div></div></main>`;
    }
    // chi è in lista, poi chi è nella stanza (il posto lo dice), e gli episodi precedenti a parte
    const vivi = S.pazienti.filter((p) => !p.prec);
    const inStanza = vivi.filter((p) => p.posto).sort((a, b) => a.posto.localeCompare(b.posto, "it", { numeric: true }));
    const prec = S.pazienti.filter((p) => p.prec);
    const carta = (l) => (l.length ? `<div class="carta">${l.map(rigaPaz).join("")}</div>` : "");
    return `<main>${S.pazienti.length ? carta([...vivi.filter((p) => !p.posto), ...inStanza]) + (prec.length ? `<div class="lbl">Episodi precedenti</div>${carta(prec)}` : "")
      : `<div class="vuoto">Nessun paziente nell'elenco del PC.<br>Si riempie aprendo i pazienti nel gestionale.</div>`}
      ${barraOrdini()}</main>`;
  }
  function tabellaHtml(t) {
    const col = t.colonne;
    const testa = `<tr><th class="nm"></th>${col.map((c, i) => `<th class="${i === 0 && c.cima !== "?" ? "ult" : ""}">${esc(c.cima)}${c.sotto ? `<small>${esc(c.sotto)}</small>` : ""}${
      c.parziale ? `<small class="parz">parziale</small>` : ""}</th>`).join("")}</tr>`;
    const corpo = t.gruppi.map((g) => `<tr class="sez"><th class="nm" colspan="1">${esc(g.nome)}</th><td colspan="${col.length}"></td></tr>${g.righe.map((r) =>
      `<tr><th class="nm">${esc(r.nome)}${r.um ? ` <small>(${esc(r.um)})</small>` : ""}</th>${r.valori.map((v) => (!v ? `<td class="vuota">·</td>`
        : `<td class="${v[1] ? "fuori" : ""}${v[2] ? " parz" : ""}">${esc(v[0])}${v[1] ? (v[1] < 0 ? "↓" : "↑") : ""}${v[3] ? `<span class="pct"> (${esc(v[3])}%)</span>` : ""}</td>`)).join("")}</tr>`).join("")}`).join("");
    return `<div class="tabw"><table class="val"><thead>${testa}</thead><tbody>${corpo}</tbody></table></div>`;
  }
  function vistaEsiti(p) {
    const e = S.esiti.get(p.ep);
    const carica = S.occupato.has("esiti" + p.ep), legge = S.occupato.has("valori" + p.ep);
    if (!e) return carica ? `<div class="carica"><div class="giro"></div></div>` : `<div class="vuoto">Esiti non caricati.</div>`;
    // quando li ha letti il PC: dopo un'ora, in ambra
    const letti = e.tabella && e.letto ? `<small class="letti${Date.now() - e.letto > 60 * 60e3 ? " amb" : ""}">Letti sul PC alle ${hhmm(e.letto)} · ${fa(e.letto)}</small>` : "";
    const valori = `<div class="carta"><div class="sezt"><div class="tv">${letti}</div>
        <button class="agg" data-a="valori" ${legge ? "disabled" : ""}>${legge ? "Leggo sul PC…" : "↻ Aggiorna i valori"}</button></div>
      ${e.tabella ? tabellaHtml(e.tabella) : legge ? "" : `<div class="vuoto stretto">Il PC non ha ancora letto valori per questo paziente.</div>`}</div>`;
    const referti = e.referti.length ? `<div class="carta">${e.referti.map((r) => {
      const aperto = S.aperti.has(r.id);
      return `<button class="ref" data-a="referto" data-id="${esc(r.id)}" aria-expanded="${aperto}"><span class="r1"><span class="q">${esc(r.quando)}</span><span class="t">${esc(r.titolo)}</span></span>${
        aperto ? (r.testo ? `<div class="testo">${esc(r.testo)}</div>` : `<div class="manca">${r.lungo ? "Testo troppo lungo per il telefono: leggilo sul PC." : "Testo non ancora letto sul PC: aprilo una volta dal pannello (Esiti), poi è qui."}</div>`) : ""}</button>`;
    }).join("")}</div>` : "";
    return `${valori}${referti}${e.nota ? `<p class="piede">${esc(e.nota)}</p>` : ""}`;
  }
  function vistaRichieste(p) {
    const c = S.catalogo;
    if (!c) return `<div class="carica"><div class="giro"></div></div>`;
    if (p.prec) return `<div class="vuoto">Episodio precedente: per ordinare apri quello di oggi.</div>`;
    if (!p.ordina) return `<div class="vuoto">Per ordinare, il PC deve aver aperto almeno una volta la pagina di questo paziente.</div>`;
    const s = selDi(p.ep);
    const quesiti = c.quesiti.map((q) => {
      const pk = c.pacchetti.find((x) => x.q === q);
      const on = pk && s.pacchetto === pk.q;
      return `<button class="chip${on ? " on" : ""}" data-a="quesito" data-q="${esc(q)}" aria-pressed="${!!on}">${esc(q)}</button>`;
    }).join("");
    const gruppi = c.gruppi.map((g) => `<div class="gruppo"><h3>${esc(g.nome)}</h3>${g.profili.length ? `<div class="chips">${g.profili.map((pr, i) => {
      const on = pr.esami.every((k) => s.esami.has(k));
      return `<button class="chip${on ? " on" : ""}" data-a="profilo" data-g="${esc(g.nome)}" data-i="${i}">${esc(pr.nome)}</button>`;
    }).join("")}</div>` : ""}<div class="griglia">${g.esami.map((k) => `<button class="esame${s.esami.has(k) ? " on" : ""}" data-a="esame" data-k="${esc(k)}"><span class="box">✓</span>${esc(c.nomi[k] || k)}</button>`).join("")}</div></div>`).join("");
    return `<div class="carta q-w"><input id="quesito" type="text" enterkeyhint="done" autocomplete="off" placeholder="Quesito diagnostico" value="${esc(s.q)}"><div class="chips">${quesiti}</div></div>
      <div class="carta">${gruppi}</div>`;
  }
  function ctaHtml(p) {
    if (S.scheda !== "richieste" || !S.catalogo || !p.ordina || p.prec) return "";
    const s = selDi(p.ep), n = s.esami.size, c = S.catalogo;
    const rx = [...s.esami].some((k) => c.rx.includes(k)), lab = [...s.esami].some((k) => !c.rx.includes(k));
    const nTxt = n === 1 ? "1 esame" : `${n} esami`;
    const occupato = S.inviati.has(p.ep), bloccato = S.bloccati.has(p.ep);
    const armato = S.arma && S.arma.ep === p.ep;
    // (due pazienti con lo stesso cognome: il ⚠ anche qui, e il nome col suo segno)
    const etichetta = occupato ? "Mando l'ordine al PC…" : bloccato ? "Controllo gli ordini sul PC…" : armato ? `${p.omonimo ? "⚠ " : ""}Ordino ${nTxt} per ${chi(p)}? Tocca di nuovo`
      : !n ? "Scegli gli esami" : lab ? `Conferma e stampa · ${nTxt}` : `Metti in carrello · ${nTxt}`;
    const perche = bloccato ? "Prima di un altro ordine, il PC dice se quello di prima è partito"
      : n && !s.q.trim() ? "Scrivi il quesito diagnostico" : rx && lab ? "Due richieste: il laboratorio si conferma da solo, la radiologia resta nel carrello del PC" : "";
    const nomi = [...s.esami].map((k) => c.nomi[k] || k).join(", ");
    return `<div class="cta">${n ? `<div class="sel">${esc(nomi)}</div>` : ""}<button id="ordina" data-a="ordina" class="${armato ? "arma" : ""}" ${!n || !s.q.trim() || occupato || bloccato ? "disabled" : ""}>${esc(etichetta)}</button>${
      perche ? `<div class="perche">${esc(perche)}</div>` : ""}</div>`;
  }
  // La nota e i promemoria: chiusi finché non servono («+ Nota»).
  function noteHtml(p) {
    const bozza = S.bozze.has(p.ep) ? S.bozze.get(p.ep) : p.nota || "";
    const aperta = S.notaAperta === p.ep, promAperto = S.promAperto === p.ep;
    const proms = [...(p.prom || [])].sort((a, b) => a.t - b.t);
    const nota = aperta ? `<div class="nota-w"><textarea id="nota" rows="3" placeholder="Nota su questo paziente" aria-label="Nota">${esc(bozza)}</textarea></div>`
      : bozza ? `<button class="notatxt" data-a="nota" aria-label="Modifica la nota">${esc(bozza)}</button>` : "";
    const righe = proms.map((x) => `<div class="promr"><span class="quando ${banda(x.t)}">${hhmm(x.t)}</span><span class="cosa">${esc(x.testo)}</span>${
      S.fatti.has(x.id) ? `<span class="fattoin">Fatto</span><button class="btnmini" data-a="annulla" data-pid="${esc(x.id)}" ${S.occupato.has("fatto" + x.id) ? "disabled" : ""}>Annulla</button>`
        : `<button class="btnmini ok" data-a="fatto" data-pid="${esc(x.id)}">✓ Fatto</button>`}</div>`).join("");
    const add = promAperto ? `<div class="addprom"><input id="promin" type="text" enterkeyhint="done" autocomplete="off" placeholder="«11:30 tropo», «tra 2h ECG»" value="${esc(S.promTesto)}">
      <button data-a="prom" ${S.occupato.has("prom" + p.ep) ? "disabled" : ""}>Aggiungi</button></div>` : "";
    const piu = (!aperta && !bozza ? `<button class="piu" data-a="nota">+ Nota</button>` : "") + (!promAperto && !p.prec ? `<button class="piu" data-a="promApri">+ Promemoria</button>` : "");
    return `<div class="carta note">${nota}${righe ? `<div class="proms">${righe}</div>` : ""}${add}${piu ? `<div class="piurow">${piu}</div>` : ""}</div>`;
  }
  function vistaPaziente() {
    const p = paziente(S.vista.ep);
    if (!p) return `<main><div class="vuoto">Questo paziente non è più nell'elenco del PC.</div></main>`;
    const ordini = ordiniDi(p.ep).map((o) => ordineHtml(o)).join("");
    const tab = (s, t) => `<button class="${S.scheda === s ? "on" : ""}" data-a="scheda" data-s="${s}" role="tab" aria-selected="${S.scheda === s}">${t}</button>`;
    return `<main>${barraOrdini(p.ep)}<div class="seg" role="tablist">${tab("esiti", "Esiti")}${tab("richieste", "Richieste")}</div>
      ${ordini}${noteHtml(p)}${S.scheda === "esiti" ? vistaEsiti(p) : vistaRichieste(p)}</main>${ctaHtml(p)}`;
  }

  // Un ridisegno sotto il dito ruberebbe il tocco (il bottone sparisce fra
  // pressione e rilascio): mentre si preme, aspetta.
  let premuto = 0, rinviato = false, disegno = false;
  function render() {
    if (premuto) { rinviato = true; return; }
    // il cursore resta dov'era: un ridisegno non deve rubare il campo a chi scrive
    const att = document.activeElement && document.activeElement.id ? document.activeElement : null;
    const fuoco = att ? { id: att.id, a: att.selectionStart, b: att.selectionEnd } : null;
    const corpo = S.fase === "pronta" ? (S.vista.nome === "paziente" ? vistaPaziente() : vistaLista()) : schermata();
    disegno = true;   // (un campo tolto dal ridisegno non è un campo lasciato)
    try { $app.innerHTML = testata() + corpo + (S.avviso ? `<div class="avviso ${esc(S.avviso.tono)}" role="alert">${esc(S.avviso.testo)}</div>` : ""); }
    finally { disegno = false; }
    if (fuoco) {
      const el = document.getElementById(fuoco.id);
      if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(fuoco.a, fuoco.b); } catch { /* non un campo di testo */ } }
    }
  }
  const lascia = () => { clearTimeout(premuto); premuto = 0; if (rinviato) { rinviato = false; render(); } };
  $app.addEventListener("pointerdown", () => { clearTimeout(premuto); premuto = setTimeout(lascia, 700); }, true);
  document.addEventListener("pointercancel", lascia, true);
  // senza ridisegnare: il bottone d'ordine mentre si scrive il quesito
  function ritoccaCta() {
    const p = paziente(S.vista.ep);
    const vecchio = document.querySelector(".cta");
    if (!p || !vecchio) return;
    const t = document.createElement("div");
    t.innerHTML = ctaHtml(p);
    if (t.firstElementChild) vecchio.replaceWith(t.firstElementChild);
  }
  const fuocoSu = (id) => { const el = document.getElementById(id); if (el) el.focus(); };

  // --------------------------------------------------------------- i gesti
  $app.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    lascia();   // il tocco è arrivato: i ridisegni rimasti in attesa, poi il gesto
    if (!b || b.disabled) return;
    const a = b.dataset.a, ep = S.vista.ep;
    if (a !== "menu" && S.menu) S.menu = false;
    if (a === "menu") { S.menu = !S.menu; render(); }
    else if (a === "riapri") riapri();
    else if (a === "sostituisci") { salva(S.nuova); parti(S.nuova); }
    else if (a === "tieni") parti(S.coppia);
    else if (a === "paz") apriPaziente(b.dataset.ep);
    else if (a === "indietro") { salvaNota(ep); S.vista = { nome: "lista", ep: "" }; S.arma = null; render(); aggiornaLista(); }
    else if (a === "aggiornaLista") aggiornaLista();
    else if (a === "esci") { chiedi("esci").catch(() => {}); chiusa("chiusa dall'iPhone"); }
    else if (a === "dimentica") {
      if (b.dataset.sicuro !== "1") { b.dataset.sicuro = "1"; b.textContent = "Dimentico? Servirà un QR nuovo"; return; }
      if (S.canale) chiedi("esci").catch(() => {});
      dimentica("senza");
    }
    else if (a === "scheda") { S.scheda = b.dataset.s; S.arma = null; render(); }
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
    else if (a === "nota") { S.notaAperta = ep; render(); fuocoSu("nota"); }
    else if (a === "promApri") { S.promAperto = ep; render(); fuocoSu("promin"); }
    else if (a === "prom") aggiungiProm(ep);
    else if (a === "fatto") fattoProm(ep, b.dataset.pid);
    else if (a === "annulla") annullaFatto(b.dataset.pid);
    else if (a === "nascondi") { S.nascosti.add(b.dataset.id); render(); }
    else render();
  });
  $app.addEventListener("input", (e) => {
    const t = e.target, ep = S.vista.ep;
    if (t.id === "quesito") {
      const s = selDi(ep);
      s.q = t.value; s.mio = true; s.oid = "";   // scritto a mano: è il quesito del medico
      if (s.pacchetto && t.value.trim().toLowerCase() !== s.pacchetto.toLowerCase()) { s.pacchetto = ""; s.pkgDa = new Set(); }
      S.arma = null;
      ritoccaCta();
    } else if (t.id === "nota") {
      S.bozze.set(ep, t.value);
      t.style.height = "auto"; t.style.height = t.scrollHeight + "px";
    } else if (t.id === "promin") S.promTesto = t.value;
  });
  $app.addEventListener("focusout", (e) => { if (e.target.id === "nota" && !disegno) salvaNota(S.vista.ep); });
  $app.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.id === "promin") { e.preventDefault(); aggiungiProm(S.vista.ep); }
    else if (e.target.id === "quesito") { e.preventDefault(); e.target.blur(); }
  });
  // Tornati sull'app (iOS chiude le prese delle pagine in sottofondo): ci si
  // ricollega, si prova subito la presa, e l'elenco si rilegge da solo.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !S.chiavi || scadenze() || S.fase === "altrove") return;
    collega();
    batti();
    if (S.canale && S.fase === "pronta") {
      if (S.ws && S.ws.readyState === 1 && S.pari) { rileggi(); aggiornaOrdini(); } else S.rinfresca = true;
    }
    render();
  });
  // L'associazione ha un'ora: passata, la chiave se ne va da sola. E la
  // regola dei 20 minuti vale anche qui: un'app lasciata in sottofondo non
  // tiene in memoria i pazienti finché il PC non glielo dice.
  function scadenze() {
    if (S.coppia && S.coppia.scade <= Date.now()) { S.scaduta = S.coppia.scade; if (S.canale) chiusa("scaduta"); else { S.perche = "scaduta"; dimentica("finita"); } return true; }
    if (S.canale && Date.now() - S.ultimo >= INATTIVO) { chiedi("esci", {}, TEMPO, true).catch(() => {}); chiusa("inattivo"); return true; }
    return false;
  }
  setInterval(() => {
    if (!scadenze() && S.fase === "pronta" && !document.activeElement?.id) render();   // i tempi dei promemoria
  }, 30e3);

  // Un QR nuovo inquadrato con l'app già aperta cambia solo il frammento: si
  // riparte da capo, e la partenza decide (anche se chiedere prima).
  window.addEventListener("hashchange", () => {
    if (P.leggiFrammento(location.hash)) location.reload();
    else history.replaceState(null, "", location.pathname + location.search);
  });
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});

  (async function avvia() {
    const link = location.hash ? dalLink(location.hash) : null;
    // il frammento non resta nella barra degli indirizzi né nella cronologia
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    const prima = salvata();
    if (link && link.scade <= Date.now()) { S.scaduta = link.scade; S.perche = "scaduta"; S.fase = "finita"; render(); return; }
    // Un link che toglierebbe un'associazione ancora buona chiede prima: un
    // link qualunque non porta il telefono su un altro «PC».
    if (link && prima && !stessa(link.k, prima.k)) {
      S.coppia = prima; S.codice = await P.codice(prima.k);
      S.nuova = { ...link, codice: await P.codice(link.k) };
      S.fase = "conferma"; render();
      return;
    }
    // lo stesso QR inquadrato di nuovo: lo stesso telefono, per il PC
    const c = link ? { ...link, dev: prima ? prima.dev : link.dev } : prima;
    if (link) salva(c);
    if (!c) { S.perche = S.scaduta ? "scaduta" : ""; S.fase = S.scaduta ? "finita" : "senza"; render(); return; }
    await parti(c);
  })();
})();
