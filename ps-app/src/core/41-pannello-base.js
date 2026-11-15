//@frammento 41-pannello-base.js — Icone (LOGO, ICO), nomi di schede e fogli, quesiti e pacchetti imparati, hasExt/ask verso l'estensione,
//@ l'ordine in sottofondo (LAVORO), finestra e forma del pannello.
  const LOGO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
  </svg>`;

  // il logo sull'intestazione bianca: stessa croce, fondo blu
  const LOGO_BLU = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="#0B5CAD"/>
    <path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
  // Icone a tratto, 16px, colore del testo: le emoji cambiano faccia da un
  // computer all'altro (il ▶ diventava un quadratino nero).
  const ico = (d) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const CESTINO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  const ICO = {
    // le righe di stampa: l'etichetta (un cartellino) e il foglio A4
    etichetta: ico('<path d="M2.5 4.5h6.8l4.2 3.5-4.2 3.5H2.5z"/><circle cx="5.3" cy="8" r=".9"/>'),
    foglio: ico('<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9.2 1.8V5h3.3M6.2 8.3h4.1M6.2 10.8h4.1"/>'),
    indietro: ico('<path d="M10 3 5 8l5 5"/>'),
    riduci: ico('<path d="M3.5 8h9"/>'),
    altro: ico('<circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none"/>'),
    ferma: ico('<rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor" stroke="none"/>'),
    // la sveglia dei promemoria
    sveglia: ico('<circle cx="8" cy="9" r="5.2"/><path d="M8 6.6V9l1.7 1.1M2.6 4.3l1.9-1.7M13.4 4.3l-1.9-1.7"/>'),
    // «Da fare»: due spunte tonde e le loro righe
    dafare: ico('<circle cx="4" cy="4.5" r="2.2"/><circle cx="4" cy="11.5" r="2.2"/><path d="M8.5 4.5h5.5M8.5 11.5h5.5"/>'),
    stampante: ico('<path d="M4.5 6V2.5h7V6"/><rect x="2" y="6" width="12" height="5.5" rx="1.2"/><path d="M4.5 9.5h7v4h-7z"/>'),
    // l'etichetta anagrafica: un braccialetto con la sua targhetta
    bracciale: ico('<path d="M4.5 10.6C2.9 10.3 2 9.6 2 8.6 2 6.6 4.7 5 8 5s6 1.6 6 3.6c0 1-.9 1.7-2.5 2"/><rect x="4.5" y="8.4" width="7" height="4.6" rx="1.1"/><path d="M6.5 10.7h3"/>'),
    // le voci del menu ⋯ (una per voce, stesso tratto) e i comandi che prima
    // erano emoji o glifi Unicode (🗑 🖨 ⟳ ↻ ↗): un dialetto solo
    affianca: ico('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.5"/><path d="M9.5 2.8v10.4M11.2 6h1.3M11.2 8.4h1.3"/>'),
    ricetta: ico('<path d="M3.8 1.8h8.4v12.4H3.8z"/><path d="M6 5v5.2M6 5h1.8a1.5 1.5 0 0 1 0 3H6M7.6 8l2.6 3.2"/>'),
    terapia: ico('<g transform="rotate(-40 8 8)"><rect x="2" y="5.2" width="12" height="5.6" rx="2.8"/><path d="M8 5.2v5.6"/></g>'),
    esporta: ico('<path d="M8 10V2.5M5.2 5.3 8 2.5l2.8 2.8M2.5 10v3.5h11V10"/>'),
    importa: ico('<path d="M8 2.5V10M5.2 7.2 8 10l2.8-2.8M2.5 10v3.5h11V10"/>'),
    tabellone: ico('<rect x="1.8" y="2.3" width="5.4" height="4.9" rx="1.1"/><rect x="8.8" y="2.3" width="5.4" height="4.9" rx="1.1"/><rect x="1.8" y="8.8" width="5.4" height="4.9" rx="1.1"/><rect x="8.8" y="8.8" width="5.4" height="4.9" rx="1.1"/>'),
    tel: ico('<rect x="4.4" y="1.4" width="7.2" height="13.2" rx="1.7"/><path d="M7 12.1h2"/>'),
    rec: ico('<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>'),
    // Impostazioni: una voce sola, la sua icona (un ingranaggio, non la stampante: lì c'è anche il resto)
    impostazioni: ico('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.15 1.15M11.25 11.25l1.15 1.15M3.6 12.4l1.15-1.15M11.25 4.75l1.15-1.15"/><circle cx="8" cy="8" r="4.3"/>'),
    matita: ico('<path d="M10.5 2.7a1.6 1.6 0 0 1 2.3 0l.5.5a1.6 1.6 0 0 1 0 2.3L6 12.8l-3.3.6.6-3.3z"/><path d="M9.3 3.9l2.8 2.8"/>'),
    // le voci che si accendono e si spengono: il loro stato al posto dell'icona
    spento: ico('<circle cx="8" cy="8" r="5.6"/>'),
    acceso: ico('<circle cx="8" cy="8" r="5.6" fill="currentColor" stroke="none"/><path d="M5.4 8.2l1.8 1.8 3.5-3.6" stroke="#fff"/>'),
    link: ico('<path d="M6.9 9.1a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-.8.8"/><path d="M9.1 6.9a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/>'),
    cestino: ico('<path d="M2.8 4.4h10.4M6.2 4.4V2.8h3.6v1.6M4.2 4.4l.6 8.4c.1.8.6 1.3 1.4 1.3h3.6c.8 0 1.3-.5 1.4-1.3l.6-8.4M6.7 7.1v4.2M9.3 7.1v4.2"/>'),
    aggiorna: ico('<path d="M13.2 8A5.2 5.2 0 1 1 11.7 4.3"/><path d="M12.2 1.8v2.9H9.3"/>'),
    esterno: ico('<path d="M6.5 3.2H3.6a.8.8 0 0 0-.8.8v8.4c0 .4.4.8.8.8H12c.4 0 .8-.4.8-.8V9.5"/><path d="M9.5 2.8h3.7v3.7M13.2 2.8 7.8 8.2"/>'),
    cerca: ico('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  };
  // un'icona dentro una riga di testo («PDF», «Stampa»): più piccola, sulla linea del testo
  const icoIn = (k, px = 14) => ICO[k].replace('<svg width="16" height="16"', `<svg width="${px}" height="${px}" style="vertical-align:-.2em;margin-right:4px;flex:none"`);
  // …e nel menu ⋯, davanti a ogni voce
  const mico = (k) => `<span class="mico">${ICO[k]}</span>`;
  // le voci che esistono anche sul telefono hanno la sua stessa emoji (📱 iPhone, 🖨️ stampa, ● registrazioni in rosso)
  const memo = (e) => `<span class="mico mem" aria-hidden="true">${e}</span>`;
  // Le schermate che si aprono dal menu ⋯: il nome e l'icona della loro voce,
  // in testa al posto delle schede. E il nome delle schede, per il ‹ che ci torna.
  const VISTE_MENU = { registrazioni: ["Registrazioni", "rec"],
    iphone: ["iPhone", "tel"], ricetta: ["Ricetta SISS", "ricetta"], terapia: ["Terapia", "terapia"], consegne: ["Consegne", "dafare"],
    etichetta: ["Etichetta", "etichetta"] };
  const NOME_SCHEDA = { richieste: "Richieste", esiti: "Esiti", referto: "Esiti", eo: "EO", eotesto: "EO",
    dimissioni: "Dimissioni", dimtesto: "Dimissioni", dimimport: "Dimissioni", home: "Pazienti" };

  // Il nome di una riga sotto la striscia, da NOMI_RIGA: l'html (icona +
  // erogatore) e le parole intere (aria-label). `b`: «et:POC», «fg:RX», «anag».
  function nomeFoglio(b, copie = 0) {
    const [k, chi = ""] = String(b || "").split(":");
    const N = NOMI_RIGA[k === "fg" && chi === "RX" ? "fgRX" : k];
    if (!N) return { nome: String(b || ""), html: esc(b) };   // (un nome d'altri tempi: com'è)
    const dopo = k === "anag" ? (copie > 1 ? `×${copie}` : "") : (NOMI_RIGA.chi[chi] || chi);
    return { nome: `${N.parole}${dopo ? " " + dopo : ""}`, html: `${ICO[N.ico]}${dopo ? `<span>${esc(dopo)}</span>` : ""}` };
  }
  function nomeRichiesta(chi, k, n) {
    const c = NOMI_RIGA.chi[chi] || chi;
    return { nome: `${NOMI_RIGA.richiesta.parole}${c ? " " + c : ""} · ${k}/${n}`, html: esc(`${c ? c + " · " : ""}${k}/${n}`) };
  }
  // L'etichetta anagrafica aspetta le etichette di un ordine che stampa le sue
  // (come nel service worker): quale ordine, se c'è.
  const braccialeJob = (x) => /[?&]REPORT=PsoBraccialettoHMIMU(&|$)/.test(String((x && x.url) || ""));
  const braccialeAspetta = (l, rec) => (l || []).find((x) => x !== rec && x.stato === "stampo" && !x.interrotta && !x.ferma
    && !((x.stampa && x.stampa.jobs) || []).every(braccialeJob)
    && (x.fogli || []).some((f) => f.tipo === "etichette" && ["attesa", "prendo", "invio"].includes(f.stato))) || null;
  // Il «Stampa Bracciale» del gestionale (l'etichetta anagrafica): il link
  // della pagina, così com'è, e solo se è di QUESTO episodio — mai costruito.
  function linkBracciale(doc, ep, base) {
    if (!ep) return "";
    for (const a of doc.querySelectorAll('a[href*="PsoBraccialettoHMIMU"]')) {
      try {
        const u = new URL(a.getAttribute("href"), base);
        if (u.origin === new URL(base).origin && /\/jasperservlet$/i.test(u.pathname)
          && u.searchParams.get("REPORT") === "PsoBraccialettoHMIMU" && u.searchParams.get("EPISODIO_ID") === String(ep)) return u.href;
      } catch { /* un link rotto non è il nostro */ }
    }
    return "";
  }

  const RADIO_SET = [RES.RX, RES.ECO, RES.RMN, RES.TAC];
  function rememberQuesito(q) {
    store.set("lastQ", q);
    store.set("quesiti.ts", Date.now());
    const list = store.get("quesiti", QUESITI_DEFAULT);
    const next = [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    store.set("quesiti", next);
  }
  // Quesiti are clinical text: they live at most a shift, and the login page
  // (forgetAll) drops them like every other clinical trace.
  function scadenzaQuesiti() {
    const ts = store.get("quesiti.ts", 0);
    if (ts && Date.now() - ts > PATIENTS_TTL) forgetQuesiti();
  }
  function forgetQuesiti() {
    store.set("lastQ", "");
    store.set("quesiti", QUESITI_DEFAULT);
    store.set("quesiti.ts", 0);
    potaImparati();
  }
  // Un quesito normale impara il suo pacchetto. Confermato un ordine il cui
  // quesito l'ha messo un chip (non scritto a mano, e non uno dei tre
  // pacchetti), quel chip si ricorda gli esami — solo i codici, mai di chi —
  // e al tocco dopo li spunta come un pacchetto, col conto sul chip. Il
  // prossimo ordine confermato con lo stesso chip li sostituisce. Un quesito
  // scritto dal medico è testo clinico e dura un turno: il suo pacchetto se ne
  // va con lui; quelli dell'elenco di partenza (Febbre, Trauma…) restano.
  const IMPARATI = "pacchettiImparati.v1";
  const ePacchettoFisso = (q) => PACCHETTI.some((p) => p.q.toLowerCase() === String(q || "").trim().toLowerCase());
  function imparaPacchetto(q, items) {
    const t = String(q || "").trim().toLowerCase();
    const esami = (items || []).map((i) => [String(i.res), String(i.code)]);
    if (t && !ePacchettoFisso(t) && esami.length) potaImparati({ [t]: esami });
  }
  function pacchettoImparato(q) {
    const t = String(q || "").trim();
    const esami = t && !ePacchettoFisso(t) ? (store.get(IMPARATI, {}) || {})[t.toLowerCase()] : null;
    return Array.isArray(esami) && esami.length ? { q: t, items: esami, imparato: true } : null;
  }
  // restano solo i chip che ci sono ancora: l'elenco di partenza e i quesiti del turno
  function potaImparati(nuovi = {}) {
    const vivi = new Set([...QUESITI_DEFAULT, ...store.get("quesiti", QUESITI_DEFAULT)].map((x) => String(x).toLowerCase()));
    const tutti = { ...(store.get(IMPARATI, {}) || {}), ...nuovi };
    store.set(IMPARATI, Object.fromEntries(Object.entries(tutti).filter(([k]) => vivi.has(k) || k in nuovi)));
  }
  const hasExt = () => { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch { return false; } };
  // L'estensione c'era quando la pagina è nata e adesso non c'è più (aggiornata
  // da sé, o ricaricata, con la pagina aperta): questo pannello è quello di
  // prima. Non fa più niente — niente ordini, niente stampe, niente «Dimentica»
  // a metà: solo «Ricarica la pagina». (Il bookmarklet non l'ha mai avuta: lui
  // lavora come sempre.)
  const EXT_AVVIO = hasExt();
  const extPersa = () => EXT_AVVIO && !hasExt();
  // (nessuna risposta = `perso`: il service worker non l'ha detta, non ha detto di no)
  const ask = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || { ok: false, perso: true }); }); }
    catch { res({ ok: false, perso: true }); }
  });
  // Solo l'indirizzo di una pagina da LEGGERE di questo ospedale: mai quello di
  // un modulo inviato, di un inserimento o di una cancellazione.
  const leggibilePagina = (x) => {
    try { return !!x && new URL(x).origin === location.origin && !/[?&](ccsForm|Insert|Delete|Update)=/i.test(x); }
    catch { return false; }
  };

  // ------------------------------------------- l'ordine in sottofondo
  // Con l'estensione «Conferma e stampa» non manda gli esami da questa
  // scheda: li manda una seconda scheda, aperta dal service worker accanto e
  // dietro, sulla pagina vera del paziente. Quella scheda, quando nasce, chiede
  // al service worker chi è (per numero di scheda: nell'indirizzo non c'è
  // niente che il gestionale vedrebbe) e, se è lei, fa girare il motore di
  // sempre. LAVORO è quell'ordine, finché gira; null in ogni altra scheda.
  // La scheda dell'ordine esegue e basta: ogni esito — anche quello da finire
  // a mano — lo passa alle schede del medico, poi si slega.
  let LAVORO = null;
  // La pagina del paziente, da riaprire così com'è (la scheda di un ordine, o
  // quella che dà i PDF di una stampa): `prima` se si riapre (non arriva da un
  // modulo), il link della pagina a se stessa, o quello dei pazienti
  // conosciuti. Mai un indirizzo costruito.
  function urlPaziente(ep, prima = "") {
    const ok = (u) => (leggibilePagina(u) && param(u, "EPISODIO_ID") === String(ep) ? u : "");
    const se = [...document.querySelectorAll('a[href*="MVPG=PsoEpisodioClinicoAmbulatorio"]')].map((a) => {
      try { const u = new URL(a.getAttribute("href"), location.href); u.hash = ""; return u; } catch { return null; }
    }).find((u) => u && [...u.searchParams.keys()].every((k) => k === "MVPG" || k === "EPISODIO_ID")
      && u.searchParams.get("MVPG") === "PsoEpisodioClinicoAmbulatorio");
    return ok(prima) || ok(se ? se.href : "") || ok((tuttiPazienti().find((p) => p.ep === String(ep)) || {}).url);
  }
  // quelli che la scheda del medico tiene d'occhio (e per cui chiede al service worker)
  const ORDINE_APERTO = new Set(["coda", "avvio", "corre", "stampo", "stampa"]);

  function freshReceipt(richiestaId) {
    const r = tabStore.get("receipt.v1", null);
    if (!r || !r.items) return null;
    if (Date.now() - (r.ts || 0) > CONFIRM_FLAG_TTL) return null;
    if (richiestaId && r.richiestaId !== richiestaId) return null;
    return r;
  }

  // La finestra aperta: frazioni dello schermo, così segue il browser quando
  // cambia misura. Di partenza al centro, all'85%. Mai più piccola di così,
  // e un pezzo d'intestazione resta sempre a portata di mano.
  const FINESTRA = { x: 0.075, y: 0.075, w: 0.85, h: 0.85 };
  // Su uno schermo grande l'85% è una lenzuolata: di partenza la finestra non
  // supera questa larghezza (sempre al centro). Quella che hai spostato o
  // ridimensionato, e «Affianca», restano come le hai messe.
  const FINESTRA_MAX_PX = 1150;
  const AFFIANCA = { x: 0.63, y: 0.02, w: 0.36, h: 0.96 };   // una colonna a destra: il gestionale resta visibile
  const eAffiancata = (w) => !!w && ["x", "y", "w", "h"].every((k) => Math.abs(w[k] - AFFIANCA[k]) < 0.005);
  // La FORMA del pannello (Impostazioni → Il pannello): «Al passaggio», la
  // finestra che si apre al passaggio del mouse sulla pill e si richiude
  // uscendo — quella di partenza: il medico l'ha chiesta così; un clic la apre
  // già fissata —; o «Affianca»: la finestra in una colonna a destra, il
  // gestionale visibile a sinistra, che apre e chiude solo un tocco. Si
  // sceglie in Impostazioni (`forma` in chrome.storage.local, vedi
  // seguiForma) e si tiene qui, nella memoria del gestionale, che il disegno
  // legge. Un'impostazione: il reset la lascia. (Il tabellone è una pagina:
  // niente passaggio.)
  const FORMA = "forma.v1";
  const FORME_PANNELLO = ["passaggio", "affianca"];
  const formaOra = () => { if (TABELLONE) return "pagina"; const f = store.get(FORMA, null); return FORME_PANNELLO.includes(f) ? f : "passaggio"; };
  // (la «Finestra» di prima: Al passaggio la copre — una Finestra messa ad
  // Affianca resta Affianca —; la «Colonna», più vecchia ancora, è Affianca)
  try {
    const f = store.get(FORMA, null);
    if (f === "colonna") { store.set(FORMA, "affianca"); store.set("win.v1", { ...AFFIANCA }); }
    else if (f === "finestra") store.set(FORMA, eAffiancata(store.get("win.v1", null)) ? "affianca" : "passaggio");
  } catch { /* niente */ }
  const PASSAGGIO_APRE_MS = 250, PASSAGGIO_CHIUDE_MS = 500;
  const geometriaPropria = (win) => !!win && [win.x, win.y, win.w, win.h].every(Number.isFinite);
  function geometriaFinestra(win) {
    const vw = window.innerWidth || 1000, vh = window.innerHeight || 800;
    const mia = geometriaPropria(win);
    const wMax = Math.min(FINESTRA.w, FINESTRA_MAX_PX / vw);
    const g = mia ? win : { ...FINESTRA, w: wMax, x: (1 - wMax) / 2 };
    const w = Math.min(1, Math.max(380 / vw, g.w)), h = Math.min(1, Math.max(320 / vh, g.h));
    const x = Math.min(Math.max(g.x, 120 / vw - w), 1 - 120 / vw);
    const y = Math.min(Math.max(g.y, 0), 1 - 44 / vh);
    return { x, y, w, h };
  }

