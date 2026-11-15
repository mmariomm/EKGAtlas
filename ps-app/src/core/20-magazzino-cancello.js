//@frammento 20-magazzino-cancello.js — Il magazzino (store/tabStore su localStorage/sessionStorage), lo specchio del tabellone, il presidio;
//@ IL CANCELLO DEL MOTORE (un motore alla volta: prendiMotore/mollaMotore). Il titolo «CATALOG» in cima è storico.
  // =============================================================== CATALOG
  // Merged view of the embedded (audited) catalog and everything learned
  // from live pages. Learning happens on every parsed list, so radiology
  // becomes one-click after it has been seen once.
  // Un solo magazzino, due depositi. `set` torna false quando la scrittura NON
  // è avvenuta (memoria piena o bloccata): chi promette al medico «salvato»
  // deve poterlo verificare — e ora vale anche per le consegne fra pagina e
  // pagina, che prima fallivano in silenzio.
  // (`scritto`: chi deve sapere che una chiave è cambiata — lo specchio del tabellone)
  const magazzino = (dep, scritto = null) => ({
    get(key, fallback) {
      try { const v = JSON.parse(dep.getItem(NS + key)); return v ?? fallback; }
      catch { return fallback; }
    },
    set(key, value) { try { dep.setItem(NS + key, JSON.stringify(value)); scritto?.(key); return true; } catch { return false; } },
    del(key) { try { dep.removeItem(NS + key); scritto?.(key); return true; } catch { return false; } },
    keys(prefix) {
      try { return (dep.chiavi ? dep.chiavi() : Object.keys(dep)).filter((k) => k.startsWith(NS + prefix)).map((k) => k.slice(NS.length)); }
      catch { return []; }
    },
  });
  // ------------------------------------------------ IL TABELLONE IN UNA SCHEDA
  // extension/tabellone.html carica questo stesso file: il tabellone dei
  // Pazienti, lo stesso codice, a tutta pagina. Non legge il gestionale e non
  // ordina niente: disegna da uno SPECCHIO delle chiavi che il tabellone usa,
  // che ogni scheda del gestionale tiene in chrome.storage.local a ogni
  // scrittura (e all'avvio). Là, la memoria è tutta in RAM (niente resta
  // nell'origine dell'estensione); quello che il medico ci cambia (un letto,
  // un archiviato, Alta | Bassa) va a una scheda del gestionale, che lo
  // scrive come sempre: la verità resta nella memoria del gestionale.
  const TABELLONE = (() => { try { return location.protocol === "chrome-extension:" && /\/tabellone\.html$/.test(location.pathname); } catch { return false; } })();
  const SPECCHIO = "tabellone.specchio";   // in chrome.storage.local: { kv: { chiave: valore come in localStorage } }
  const SPECCHIATE = new Set(["patients.v1", "aree.v1", "area.corrente.v1", "smart.sync.v1", "dimessi.v1", "stato.v1", "note.v1", "segni.v1", "dafare.v1", "dafare.generale.v1",
    "triage.lista.v1"]);   // (chi aspetta al Triage: la mappa del tabellone, e i nomi che il registratore sostituisce)
  const specchiata = (k) => SPECCHIATE.has(k) || /^(stanza|tabellone)\./.test(k);
  const conEstensione = () => { try { return typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.storage?.local; } catch { return false; } };
  let specchioAtteso = false;
  // nel gestionale: dopo le scritture di questo giro, una sola copia (uguale a
  // quella che c'è già, Chrome non la annuncia: il tabellone non ridisegna per niente)
  function specchia(k) {
    if (TABELLONE || (k != null && !specchiata(k)) || specchioAtteso) return;
    specchioAtteso = true;
    Promise.resolve().then(() => {
      specchioAtteso = false;
      if (!conEstensione()) return;
      const kv = {};
      try { for (const c of Object.keys(localStorage)) if (c.startsWith(NS) && specchiata(c.slice(NS.length))) kv[c.slice(NS.length)] = localStorage.getItem(c); } catch { return; }
      try { chrome.storage.local.set({ [SPECCHIO]: { kv } }).catch(() => {}); } catch { /* estensione ricaricata */ }
    });
  }
  // nel tabellone: la memoria in RAM, e quello che vi si scrive va al gestionale
  const MEM = (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, chiavi: () => [...m.keys()] };
  })();
  let specchioKv = {};          // l'ultimo specchio arrivato: quello che il gestionale ha già
  let inoltroAtteso = null;     // le chiavi scritte qui in questo giro, da mandare
  function inoltra(k) {
    if (!specchiata(k)) return;
    const v = MEM.getItem(NS + k);
    if (v === (specchioKv[k] ?? null)) return;   // lo stesso che c'è già di là: niente da mandare
    if (!inoltroAtteso) {
      inoltroAtteso = new Set();
      Promise.resolve().then(() => {
        const chiavi = [...inoltroAtteso];
        inoltroAtteso = null;
        // (3.90) il cambio, non il valore intero: fra lo specchio (quello che il gestionale aveva) e la memoria di qui
        const cambi = chiavi.map((c) => [c, cambioDi(jsonDi(specchioKv[c]), jsonDi(MEM.getItem(NS + c)))]).filter(([, x]) => x);
        if (cambi.length) tabelloneScrive(cambi);
      });
    }
    inoltroAtteso.add(k);
  }
  // (3.90) Dal tabellone al gestionale non va più il valore intero di una chiave — quello della sua copia, che può
  // essere indietro: riscriverlo cancellava quello che il gestionale aveva cambiato intanto —, ma il CAMBIO che il
  // medico ha fatto qui (fra lo specchio e la memoria del tabellone), e la scheda del gestionale lo applica al
  // valore che ha adesso (cambioApplica). Riga per riga: una riga con un `id` o un `ep` si riconosce, e di lei
  // cambia solo il campo cambiato; una riga che di là non c'è più non torna (chi l'ha tolta vince).
  //   { v: valore }  questo, al posto di quello che c'è      { x: 1 }  via
  //   { o: { chiave: cambio } }  un oggetto, chiave per chiave   { r: { id: cambio }, per: "id"|"ep" }  righe
  const jsonDi = (t) => { if (t == null) return undefined; try { return JSON.parse(t); } catch { return undefined; } };
  const oggetto = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  const righeCon = (l, c) => l.every((x) => oggetto(x) && (typeof x[c] === "string" || typeof x[c] === "number")) && new Set(l.map((x) => String(x[c]))).size === l.length;
  function cambioDi(b, m) {
    if (JSON.stringify(b) === JSON.stringify(m)) return null;
    if (m === undefined) return { x: 1 };
    if (oggetto(b) && oggetto(m)) {
      const o = {};
      for (const k of new Set([...Object.keys(b), ...Object.keys(m)])) { const c = cambioDi(b[k], m[k]); if (c) o[k] = c; }
      return { o };
    }
    const per = Array.isArray(b) && Array.isArray(m) ? ["id", "ep"].find((c) => righeCon(b, c) && righeCon(m, c)) : "";
    if (!per) return { v: m };
    const di = (l) => new Map(l.map((x) => [String(x[per]), x])), B = di(b), M = di(m), r = {};
    for (const [k, x] of M) { const c = B.has(k) ? cambioDi(B.get(k), x) : { v: x }; if (c) r[k] = c; }
    for (const k of B.keys()) if (!M.has(k)) r[k] = { x: 1 };
    return { r, per };
  }
  // il cambio sul valore di adesso (`t`): il valore nuovo, undefined (via), o `t` stesso se non c'è niente da fare
  function cambioApplica(t, c, prof = 0) {
    if (!oggetto(c) || prof > 16) return t;
    if (c.x) return undefined;
    if ("v" in c) return c.v;
    if (oggetto(c.o)) {
      if (!oggetto(t)) return t;   // (di là non c'è più: niente pezzi di qualcosa che non c'è)
      const out = { ...t };
      for (const [k, s] of Object.entries(c.o)) { const v = cambioApplica(out[k], s, prof + 1); if (v === undefined) delete out[k]; else out[k] = v; }
      return out;
    }
    if (oggetto(c.r) && (c.per === "id" || c.per === "ep")) {
      if (!Array.isArray(t)) return t;
      const out = t.slice();
      for (const [k, s] of Object.entries(c.r)) {
        const i = out.findIndex((x) => oggetto(x) && String(x[c.per]) === k);
        if (oggetto(s) && s.x) { if (i >= 0) out.splice(i, 1); }
        else if (oggetto(s) && "v" in s) { if (i >= 0) out[i] = s.v; else out.push(s.v); }
        else if (i >= 0) out[i] = cambioApplica(out[i], s, prof + 1);
      }
      return out;
    }
    return t;
  }
  const store = TABELLONE ? magazzino(MEM, inoltra) : magazzino(localStorage, specchia);
  // il presidio del giro: chi lo tiene, su quale richiesta, e da quando
  const presidioLibero = (rid, token) => {
    const p = store.get(PRESIDIO, null);
    if (!p || !p.rid || !rid || p.rid !== String(rid)) return true;
    if (p.token === token) return true;
    return Date.now() - (p.ts || 0) > PRESIDIO_MS;
  };
  const segnaPresidio = (rid, token) => { if (rid) store.set(PRESIDIO, { rid: String(rid), token, ts: Date.now() }); };
  const liberaPresidio = (token) => { const p = store.get(PRESIDIO, null); if (p && p.token === token) store.set(PRESIDIO, null); };
  // Tab-scoped storage for the run→landing handoffs (receipt + auto-confirm
  // flag): sessionStorage survives the same-tab navigation but is invisible
  // to other tabs, so two patients in two tabs can never clobber or clear
  // each other's pending confirm.
  const tabStore = magazzino(sessionStorage);

  // ------------------------------------------------- IL CANCELLO DEL MOTORE
  // Mentre un motore manda gli esami di un ordine, nient'altro chiede pagine
  // al gestionale: è una sessione sola, e una pagina qualunque del modulo
  // richieste aperta in mezzo (la stampa delle etichette di un altro ordine,
  // la lista smart, un referto, una lettura) cambia sotto di lui la richiesta
  // «corrente» della sessione — il server risponde all'inserimento dopo con
  // «ORA-20965: AMB_RICHIESTA: Progressivo richiesta …-1 già utilizzato», e
  // il carrello riletto è vuoto (3.70.0, ordini di 11 esami su due erogatori).
  // Quindi ogni lettura dell'estensione (fetchDoc, fetchPdf) aspetta qui,
  // finché c'è un motore che lavora in un'ALTRA pagina: un ordine in
  // sottofondo che il service worker dice partito o in corsa, o il motore di
  // una scheda (un giro, la sua conferma), che lo tiene dal service worker
  // (`motore` in storage.session: { tab, id, scade } — vedi bg.js, MOTORE_K).
  // Le richieste della pagina dove gira il motore sono le sue: passano. (Senza
  // estensione, col bookmarklet, il motore di una scheda lo dice il suo
  // battito, MOTORE, in localStorage.)
  const MOTORE = "motore.v1";
  const MOTORE_MS = 15e3;          // un battito più vecchio è di una pagina morta
  const CANCELLO_MAX = 240e3;      // più di così non si aspetta (un ordine dura meno di un minuto)
  const PAGINA_ID = Math.random().toString(36).slice(2);
  let MOTORE_MIO = null;           // il motore che gira in QUESTA pagina
  let ORDINI_VIVI = [];            // gli ordini del service worker (storage.session)
  let MOTORE_SW = null;            // il motore che il service worker dice preso, da chi
  let MIA_SCHEDA = null;           // il numero di questa scheda, detto dal service worker
  const motoreAttivo = (x) => !!x && (x.stato === "avvio" || x.stato === "corre");
  try {
    chrome.storage.session.get(["ordini", "motore"]).then((o) => {
      if (Array.isArray(o && o.ordini)) ORDINI_VIVI = o.ordini;
      MOTORE_SW = (o && o.motore) || null;
    }).catch(() => {});
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "session") return;
      if (ch.ordini) ORDINI_VIVI = ch.ordini.newValue || [];
      if (ch.motore) MOTORE_SW = ch.motore.newValue || null;
      // (una lettura che lo aspettava lo dice sul suo bottone: torna com'era)
      if (ch.ordini || ch.motore) { try { PANNELLO?.aggiornaDopo(); } catch { /* pannello non ancora nato */ } }
    });
  } catch { /* senza estensione: solo il battito */ }
  // il motore è qui: il giro di questa pagina, la sua conferma, o la scheda
  // dell'ordine in sottofondo che sta lavorando (fra una pagina e l'altra)
  const motoreQui = () => !!MOTORE_MIO || !!(LAVORO && ORDINI_VIVI.some((x) => x.id === LAVORO.id && motoreAttivo(x)));
  const battitoAltrui = () => { const m = store.get(MOTORE, null); return !!(m && m.id !== PAGINA_ID && Date.now() - (m.ts || 0) < MOTORE_MS); };
  // (un ordine «muto» — la sua scheda non risponde più: «⏹ la chiude» — non ferma le letture)
  const motoreFuori = () => ORDINI_VIVI.some((x) => motoreAttivo(x) && !x.muto)
    || (hasExt() ? !!(MOTORE_SW && MOTORE_SW.scade > Date.now() && MOTORE_SW.tab !== MIA_SCHEDA) : battitoAltrui());
  const motoreAltrove = () => !motoreQui() && motoreFuori();
  const motoreOvunque = () => motoreQui() || motoreFuori();
  // di chi è il motore che una lettura sta aspettando: «l'ordine di ROSSI M.»
  const chiTieneMotore = () => {
    const o = ORDINI_VIVI.find((x) => motoreAttivo(x) && !x.muto);
    return o && o.paziente ? `l'ordine di ${nomeCorto(o.paziente)}` : "l'ordine di un'altra scheda";
  };
  async function cancelloMotore(signal) {
    if (!motoreAltrove()) return;
    const fine = Date.now() + CANCELLO_MAX;
    while (Date.now() < fine && motoreAltrove()) await sleep(500, signal);
  }
  const segnaScheda = (r) => { if (r && r.scheda != null) MIA_SCHEDA = r.scheda; return r; };
  function battitoMotore() {
    try {
      // con l'estensione: il motore di questa pagina si rinnova dal service worker
      if (hasExt()) { if (MOTORE_MIO) ask({ t: "ordineMotore", id: MOTORE_MIO }).then(segnaScheda); return; }
      // (il battito è solo del motore di questa pagina: la scheda di un ordine
      // in sottofondo la dice già il service worker, e finito il giro tace subito)
      if (MOTORE_MIO) store.set(MOTORE, { id: PAGINA_ID, ts: Date.now() });
      else { const m = store.get(MOTORE, null); if (m && m.id === PAGINA_ID) store.set(MOTORE, null); }
    } catch { /* memoria piena: resta il service worker */ }
  }
  // Chi parte (un giro, una conferma) chiede il motore e aspetta il suo turno
  // PRIMA di mandare qualunque cosa — mai a metà: un ordine in sottofondo che
  // gira, o il motore di un'altra scheda. Intanto la striscia dice «In coda».
  // Si aspetta solo un «occupato» detto: un service worker che non risponde, o
  // non sa del motore, non sa di nessun altro — si parte, come prima. Dopo
  // cinque minuti si rinuncia (false: non parte niente).
  const ATTESA_MOTORE_MAX = 5 * 60e3;
  async function prendiMotore(id, ui) {
    if (!hasExt()) return !extPersa();   // (il pannello di prima di un aggiornamento: mai un motore senza il service worker)
    const fine = Date.now() + ATTESA_MOTORE_MAX;
    let persi = 0, detto = false;
    try {
      for (;;) {
        const r = segnaScheda(await ask({ t: "ordineMotore", id }));
        if (r.ok || (!r.occupato && (!r.perso || ++persi >= 3))) return true;
        if (r.occupato && Date.now() > fine) return false;
        if (r.occupato && !detto && ui && ui.inCodaMotore) { detto = true; ui.inCodaMotore(true, !!r.smart); }
        await sleep(1000);
      }
    } finally { if (detto) ui.inCodaMotore(false); }
  }
  const mollaMotore = (id) => { if (hasExt()) ask({ t: "ordineMotore", id, molla: true }); };
  if (!TABELLONE) {
    setInterval(battitoMotore, 4000);
    window.addEventListener("pagehide", () => {
      // (con un giro da riprendere il motore resta di questa scheda: lo
      // riprende la pagina dopo, o scade da solo)
      if (MOTORE_MIO && !tabStore.get(CORSA, null)) mollaMotore(MOTORE_MIO);
      MOTORE_MIO = null; battitoMotore();
    });
  }

