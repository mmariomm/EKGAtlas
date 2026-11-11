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
  const CHIAVE = "psassist.ponte.v1";       // (vecchia: un solo PC; si migra nella lista)
  const PCS = "psassist.ponte.pcs.v1";      // la lista delle associazioni: uno o più PC
  const TEMPO = 30e3;
  let pdfAperto = null;              // il PDF di un referto aperto sul telefono: { url (blob:), w, t }
  const INATTIVO = 3 * 60e3;        // come sul PC: 3 minuti senza comandi del medico e la sessione è finita
  const VERDE_MAX = 2 * 60e3;        // un ordine finito bene se ne va da solo, come sulla striscia del PC
  const BATTITO = 20e3, PONG = 10e3; // la presa parla ogni 20 secondi; senza «pong» in 10 è morta
  // La rete del telefono (ascensore, 5G, wifi↔5G): ogni attesa conta anche i
  // byte per strada, alla velocità più bassa per cui si aspetta (~50 kbit/s).
  const RETE_MIN = 6e3;              // byte al secondo
  const perRete = (byte) => Math.ceil(byte / RETE_MIN * 1e3);
  const RIPROVA_MAX = 15e3;          // fra un tentativo di presa e l'altro, al massimo
  const APRI_MAX = 12e3;             // una presa che non si apre in 12 secondi si rifà
  const TARDI_MAX = 10 * 60e3;       // una scrittura di cui non si sa: la si rimanda a ogni ritorno della rete, per 10 minuti
  const ATTESA_VALORI = 260e3;       // «Aggiorna i valori»: il PC, al peggio, ci mette 10 + 150 + 30 secondi (e 60 se aspetta una pagina del ⟳ del tabellone)
  const ATTESA_CARTELLA = 110e3;     // salvare la cartella: il PC, al peggio, 10 + 3 + 60 secondi (e la rete)
  const ATTESA_TERAPIE = 110e3;      // leggere la Terapia, o cercare nella sua tendina: una scheda del PC, al peggio 10 + 90 secondi
  const ATTESA_TERAPIA = 130e3;      // aggiungere un farmaco: 10 + 3 + 90 secondi (e la rete); oltre, «incerto» finché il PC non risponde
  const ATTESA_ACCETTA = 90e3;       // «Accetta in ambulatorio»: 10 + 60 secondi (e la rete); oltre, «incerto» finché il PC non risponde
  // la cartella del paziente, coi nomi del modulo del gestionale
  const CARTELLA = [["ANAMNESI", "Anamnesi"], ["MALATTIE_PREGRESSE", "Anamnesi remota"], ["FARMACI_ASSUNTI", "Farmaci"], ["ALLERGIE", "Allergie"], ["ESAME_OBIETTIVO", "Esame obiettivo"]];
  const uguale = (a, b) => String(a ?? "").replace(/\s+/g, " ").trim() === String(b ?? "").replace(/\s+/g, " ").trim();
  const TRIAGE = { ROSSO: "rosso", ARANCIONE: "arancione", AZZURRO: "azzurro", VERDE: "verde", BIANCO: "bianco" };
  // Le chiusure decise qui; quelle del PC portano la loro frase.
  const PERCHE = { inattivo: "3 minuti senza comandi", "chiusa dall'iPhone": "Chiusa da questo telefono", riavvio: "L'estensione sul PC si è riavviata" };
  // dopo queste la chiave di questo telefono non apre più niente
  const FINITE = new Set(["nuova associazione", "revocata", "scaduta"]);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  // I tempi si scrivono in un modo solo: una durata «50′», «1h40»; un'ora «11:30» (con «domani» o «ieri» se non è oggi)
  const durata = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}` : `${min}′`);
  const giorno = (t) => {
    const d = new Date(t), o = new Date(), g = (x) => Math.round(new Date(x.getFullYear(), x.getMonth(), x.getDate()) / 864e5);
    const n = g(d) - g(o);
    return n === 0 ? "" : n === 1 ? "domani " : n === -1 ? "ieri " : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} `;
  };
  const oraProm = (t) => giorno(t) + hhmm(t);
  const alle = (t) => `${giorno(t)}alle ${hhmm(t)}`;
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
  // Tutto qui è in memoria. Sul telefono si scrivono solo la chiave e la scelta «Lista · Mappa».
  const S = {
    pcs: [],             // le associazioni (uno o più PC): [{ k, dev, kind: "completo"|"lettura"|"", nome, id }]
    attivo: "",          // l'id dell'associazione attiva (si ricorda l'ultima)
    classifica: false,   // una scansione nuova in corso: il saluto deciderà dove va
    pcOperatore: "",     // chi è loggato nel gestionale del PC di sola lettura (testata, informativa)
    coppia: null, chiavi: null, codice: "", nuova: null, ws: null, pari: null, tentativi: 0, tRiprova: 0, tPong: 0,
    saluto: null, canale: null, nSessione: "", attese: new Map(), id: 0, ultimo: 0,
    scarto: 0,           // l'orologio del PC meno quello del telefono, misurato al saluto (in memoria)
    coda: new Map(),     // oid → un ordine toccato senza collegamento: { ep, oid, quando, paziente, n, sel, stato: "coda" | "scaduta" }
    fase: "avvio", perche: "", testoFine: "", scaduta: 0,
    pazienti: null, triage: null, aggiornato: 0, erroreLista: "", rinfresca: false, catalogo: null, esiti: new Map(), ristampe: new Map(), ristApri: null, ordini: new Map(), nascosti: new Set(),
    legge: new Map(),    // ep → { modo, dal }: una lettura dei valori sul PC che sta andando («↻ Rileggi», o da sé)
    nonLetti: new Map(), // ep → perché la lettura partita da sé non è riuscita (una riga piccola)
    daSolo: new Map(),   // ep → quando è partita da sé l'ultima volta (al più ogni 10 minuti)
    vista: { nome: "lista", ep: "" }, scheda: "esiti", dfFoglio: false, precAperti: false,
    sel: new Map(), bloccati: new Map(), aperti: new Set(),
    riprendi: null,      // dopo i 3 minuti: { ep, scheda } dell'ultimo paziente — solo in memoria, mai su disco, e solo finché il PC non risponde
    occupato: new Set(), vitAperti: "", promTesto: "", menu: false, arma: null, avviso: null,
    inviati: new Map(),  // ep → oid dell'ordine che sta andando al PC (il bottone aspetta)
    cartelle: new Map(), // ep → la cartella letta sul PC: { ep, letto, campi: [{ nome, v, ro }] }
    cbozze: new Map(),   // ep → Map(nome → { base, testo }): quello che il medico ha scritto, e su che cosa
    cstato: new Map(),   // ep → { testo, ricarica }: com'è andato «Salva», se è andato male
    cambio: null,        // «Cancella e riassocia», sulla schermata «associato a un altro telefono»
    camera: "",          // «Scansiona il QR»: perché la fotocamera non c'è
    stampa: null,        // «Stampa un PDF»: { tono, titolo, testo, fine, ts }
    stazione: null,      // il QR di una stazione di stampa, inquadrato: { sta, nome, codice, scade, fase, testo }
    zip: null, zipErr: "", // ⋯ → Registrazioni: l'elenco del PC (anonimizzate: niente pazienti)
    zipFile: new Map(),  // id → { url (blob:), file, nome, puo }: scaricata, in memoria
    zipStato: new Map(), // id → la percentuale, mentre arriva
    zipArma: null,       // «Cancella»: { id, ts } dopo il primo tocco
    mappa: null,         // la mappa del PC (sola lettura): { vista, mappe: [{ k, nome, letti, aree, posti }] }; null = un PC che non la dà
    modo: "lista",       // «Lista · Mappa · Da fare» (si ricorda sul telefono: nessun dato di pazienti)
    mappaSel: "",        // «Alta · Bassa»: la mappa che si guarda (vuoto: quella che il PC guarda)
    zoom: 1,             // il pizzico dentro la mappa
    eo: null, eoVecchio: false, // gli EO salvati sul PC: [{ k, nome, gruppo: "base" | "casi" | "frasi", testo }]; eoVecchio = un PC che non li dà
    eoSheet: false, eoQ: "", // «Altri…»: il foglio, e la ricerca (solo se la lista è lunga)
    eoAnnulla: null,     // l'ultimo EO inserito, per 5 secondi: { ep, nome, prima, ins, t }
    terapiaSi: null,     // il PC conosce la Terapia? (null: non si sa ancora; false: un PC più vecchio — niente scheda)
    terapie: new Map(),  // ep → le terapie lette sul PC: { ep, letto, righe: [{ prog, descr, qta, um, via, dil, … }], opz: { um, via, dil }, pref }
    tf: null,            // «＋ Farmaco», il foglio: { ep, passo: "scegli" | "dose", q, voci, qVoci, cerca, errVoci, v, altro, rq, stato, esito }
    acc: new Map(),      // «Accetta in ambulatorio»: chiave della riga del Triage (o episodio) → { rq, stato, esito }
    accArma: null,       // …dopo il primo tocco: { id, ts }
  };
  const MODO = "psassist.ponte.modo";
  try { const m = localStorage.getItem(MODO); if (m === "mappa" || m === "dafare") S.modo = m; } catch { /* solo in memoria */ }
  function svuota() {
    S.pazienti = null; S.triage = null; S.mappa = null; S.mappaSel = ""; S.zoom = 1; S.eo = null; S.eoVecchio = false; S.eoSheet = false; S.eoQ = ""; if (S.eoAnnulla) clearTimeout(S.eoAnnulla.t); S.eoAnnulla = null; S.aggiornato = 0; S.erroreLista = ""; S.catalogo = null; S.esiti.clear(); S.ristampe.clear(); S.ordini.clear(); S.nascosti.clear();
    S.legge.clear(); S.nonLetti.clear(); S.daSolo.clear();
    S.sel.clear(); S.bloccati.clear(); S.aperti.clear(); S.occupato.clear(); S.inviati.clear(); S.promTesto = ""; S.arma = null;
    S.dfFoglio = false; S.precAperti = false; S.riprendi = null;
    S.stampa = null; S.cartelle.clear(); S.cbozze.clear(); S.cstato.clear(); S.coda.clear();
    S.terapiaSi = null; S.terapie.clear(); S.tf = null; S.acc.clear(); S.accArma = null;
    S.zip = null; S.zipErr = ""; S.zipArma = null; S.zipStato.clear();
    for (const f of S.zipFile.values()) try { URL.revokeObjectURL(f.url); } catch { /* già via */ }
    S.zipFile.clear();
    chiudiPdf();
    S.vista = { nome: "lista", ep: "" };
  }

  // ---------------------------------------------------- la chiave del QR
  const stessa = (a, b) => P.b64u(a) === P.b64u(b);
  const nuovoDev = () => P.b64u(P.casuale(16));
  // Il PC attivo è di sola lettura? (la build mini: si vede ma non si scrive)
  const solaLettura = () => !!(S.coppia && S.coppia.kind === "lettura");
  // da un link: la chiave (l'associazione non scade: finisce con «Dimentica PC» o con la revoca sul PC),
  // fin quando il link vale per il primo scambio, e un numero nuovo per questo telefono
  function dalLink(hash) {
    const c = P.leggiFrammento(hash);
    return c ? { k: c.k, qrScade: c.scade, dev: nuovoDev() } : null;
  }
  const nuovoId = () => P.b64u(P.casuale(8));
  // La lista delle associazioni. In memoria `k` è Uint8Array; su disco è
  // base64url, con il tipo e il nome brevi che il PC ha detto al saluto, e l'id
  // dell'ultimo attivo. Ogni PC ha la SUA chiave: una non apre gli altri.
  function salvaPcs() {
    try {
      const v = S.pcs.map((p) => ({ k: P.b64u(p.k), dev: p.dev, kind: p.kind || "", nome: p.nome || "", id: p.id }));
      localStorage.setItem(PCS, JSON.stringify({ v, attivo: S.attivo }));
    } catch { /* solo in memoria */ }
  }
  function leggiPcs() {
    let out = { v: [], attivo: "" };
    try {
      const o = JSON.parse(localStorage.getItem(PCS) || "null");
      if (o && Array.isArray(o.v)) {
        out.v = o.v.map((x) => {
          try {
            const k = P.daB64u(x.k);
            if (k.length !== 32) return null;
            return { k, dev: /^[\w-]{16,32}$/.test(x.dev || "") ? x.dev : nuovoDev(),
              kind: x.kind === "lettura" || x.kind === "completo" ? x.kind : "",
              nome: typeof x.nome === "string" ? x.nome.slice(0, 40) : "",
              id: typeof x.id === "string" && x.id ? x.id : nuovoId() };
          } catch { return null; }
        }).filter(Boolean);
        out.attivo = typeof o.attivo === "string" ? o.attivo : "";
      }
    } catch { /* niente */ }
    // migrazione dalla vecchia chiave singola (un solo PC)
    if (!out.v.length) {
      const vecchia = salvataLegacy();
      if (vecchia) { const id = nuovoId(); out.v = [{ ...vecchia, kind: "", nome: "", id }]; out.attivo = id; }
    }
    return out;
  }
  function salvataLegacy() {
    try {
      const o = JSON.parse(localStorage.getItem(CHIAVE) || "null");
      if (!o) return null;
      const k = P.daB64u(o.k);
      if (k.length !== 32) return null;
      return { k, dev: /^[\w-]{16,32}$/.test(o.dev || "") ? o.dev : nuovoDev() };
    } catch { return null; }
  }
  // Dopo il saluto `ciao`: il PC ha detto chi è (tipo e nome breve). Si aggiorna
  // l'associazione attiva; se era una scansione nuova (S.classifica), si decide
  // dove metterla: un PC completo prende l'unico posto del «completo»; un PC di
  // sola lettura si aggiunge, o sostituisce quello con lo stesso nome o chiave.
  function classificaCiao(d) {
    S.pcOperatore = d && typeof d.operatore === "string" ? d.operatore.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (!S.coppia) return;
    const kind = d && (d.kind === "lettura" || d.kind === "completo") ? d.kind : (S.coppia.kind || "completo");
    const nome = d && typeof d.nome === "string" && d.nome.trim() ? d.nome.trim().slice(0, 40) : (S.coppia.nome || "");
    S.coppia.kind = kind; S.coppia.nome = nome;
    const altri = S.pcs.filter((p) => p.id !== S.coppia.id);
    if (S.classifica) {
      S.classifica = false;
      const tolti = kind === "completo"
        ? altri.filter((p) => p.kind !== "lettura")                                             // un solo PC completo: il nuovo prende il posto (anche una riga migrata o non ancora classificata)
        : altri.filter((p) => p.kind === "lettura" && (stessa(p.k, S.coppia.k) || (p.nome && p.nome === nome)));  // lo stesso PC di sola lettura
      S.pcs = [S.coppia, ...altri.filter((p) => !tolti.includes(p))];
    } else {
      S.pcs = S.pcs.map((p) => (p.id === S.coppia.id ? S.coppia : p));
    }
    S.attivo = S.coppia.id;
    salvaPcs();
  }
  // Passa a un altro PC della lista (dal menu): chiude la presa di adesso e si
  // collega a quello. Si ricorda l'ultimo attivo.
  async function attivaPc(id) {
    const p = S.pcs.find((x) => x.id === id);
    if (!p || p.id === (S.coppia && S.coppia.id)) { S.menu = false; return render(); }
    const ws = S.ws; S.ws = null; S.canale = null; S.saluto = null; S.nSessione = "";
    if (ws) try { ws.close(); } catch { /* già chiusa */ }
    svuota(); zitto();
    S.attivo = id; S.menu = false; S.classifica = false; salvaPcs();
    await parti(p);
  }
  // «Dimentica» un PC della lista. L'attivo: via quello e si passa a un altro
  // (o, se era l'ultimo, si resta senza associazione).
  function dimenticaPcId(id) {
    if (!S.coppia || id === S.coppia.id) return dimentica("senza");
    S.pcs = S.pcs.filter((p) => p.id !== id);
    salvaPcs(); render();
  }
  function dimentica(fase) {
    // via l'associazione ATTIVA; se ne restano altre, si passa alla prima
    if (S.coppia) {
      const resto = S.pcs.filter((p) => p.id !== S.coppia.id);
      if (resto.length) { S.pcs = resto; S.attivo = resto[0].id; salvaPcs(); return attivaPc(resto[0].id); }
    }
    S.pcs = []; S.attivo = "";
    try { localStorage.removeItem(PCS); localStorage.removeItem(CHIAVE); } catch { /* niente */ }
    S.coppia = null; S.chiavi = null; S.canale = null; S.saluto = null; S.nSessione = "";
    svuota();
    zitto();
    const ws = S.ws; S.ws = null;
    if (ws) try { ws.close(); } catch { /* già chiusa */ }
    S.fase = fase; S.menu = false; render();
  }
  async function parti(c) {
    S.coppia = c; S.nuova = null;
    if (c.id) S.attivo = c.id;
    if (c.id && !S.pcs.some((p) => p.id === c.id)) S.pcs = [c, ...S.pcs];
    S.chiavi = await P.chiaviCoppia(c.k);
    S.codice = await P.codice(c.k);
    S.fase = "collego";
    render();
    collega();
  }

  // ---------------------------------------------------------------- la presa
  // Una presa sola alla volta. Caduta, si riprova presto e poi sempre più di
  // rado (fino a 15 secondi, con un po' di caso: tanti telefoni non tornano
  // tutti insieme); subito quando la rete torna o l'app torna davanti.
  const inLinea = () => navigator.onLine !== false;
  const pronto = () => !!S.canale && !!S.ws && S.ws.readyState === 1 && S.pari === true && inLinea();
  function collega() {
    if (!S.chiavi || (S.ws && S.ws.readyState <= 1)) return;
    clearTimeout(S.tRiprova);
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ponte/ws?r=${S.chiavi.stanza}&ruolo=tel`);
    ws.binaryType = "arraybuffer";
    S.ws = ws;
    // (una rete lenta o sparita può lasciarla «in apertura» per minuti)
    const tApri = setTimeout(() => { if (S.ws === ws && ws.readyState === 0) try { ws.close(); } catch { /* già chiusa */ } }, APRI_MAX);
    let fila = Promise.resolve();
    ws.onmessage = (e) => {
      if (S.ws !== ws) return;
      clearTimeout(S.tPong); S.tPong = 0;   // qualunque cosa arrivi, la presa è viva
      if (e.data === "pong") return;
      fila = fila.then(() => ricevi(e.data)).catch(() => {});
    };
    ws.onclose = (e) => {
      clearTimeout(tApri);
      if (S.ws !== ws) return;
      S.ws = null; S.pari = null; S.saluto = null;
      clearTimeout(S.tPong); S.tPong = 0;
      if (!S.chiavi) return;
      // un altro telefono (o un'altra scheda) ha preso il posto di questo: niente tiro alla fune
      if (e && e.code === 4001) return altrove();
      if (S.fase === "collego" && S.tentativi >= 1) S.fase = "pc";   // il ponte stesso non risponde
      if (document.visibilityState === "visible") riprova();
      render();
    };
    ws.onopen = () => { clearTimeout(tApri); if (S.ws === ws) { S.tentativi = 0; batti(); } };
  }
  function riprova() {
    clearTimeout(S.tRiprova);
    const b = Math.min(RIPROVA_MAX, 600 * 2 ** Math.min(S.tentativi++, 6));
    S.tRiprova = setTimeout(collega, Math.round(b / 2 + Math.random() * b / 2));
  }
  // Il battito: se il «pong» non torna, la presa è morta anche se sembra
  // aperta (una rete che la lascia cadere senza dirlo): se ne apre un'altra.
  // Su una rete lenta il «pong» arriva dopo quello che è già per strada (un
  // pezzo di PDF): lo si aspetta anche per quello.
  function batti() {
    const ws = S.ws;
    if (!ws || ws.readyState !== 1 || S.tPong) return;
    ws.send("ping");
    let strada = ws.bufferedAmount;
    for (const a of S.attese.values()) if (!a.scaduta) strada += a.grosso || 0;
    S.tPong = setTimeout(() => { S.tPong = 0; if (S.ws === ws) rifai(); }, PONG + perRete(strada));
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
      rimanda();          // le domande rimaste senza risposta: di nuovo (il PC non rifà una scrittura)
      aggiornaOrdini();   // tornati in linea: a che punto sono gli ordini
      if (S.rinfresca) { S.rinfresca = false; rileggi(); }
    }
    if (!pari && !S.canale && S.fase === "collego") S.fase = "pc";
    render();
  }
  async function saluta() {
    const n = P.casuale(16);
    const mio = { n: P.b64u(n), byte: n, t0: Date.now() };
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
      if (m.no) return mio.cambio ? cambioNo(m) : rifiuta();   // il PC è di un altro telefono
      S.canale = P.canaleTel(await P.chiaviSessione(S.coppia.k, mio.byte, P.daB64u(m.n)));
      S.cambio = null;
      S.nSessione = mio.n;
      S.ultimo = Date.now();
      // l'ora del PC, a metà fra il saluto e la risposta: un orologio del telefono
      // avanti o indietro non cambia quando un ordine scade
      if (Number.isFinite(m.ora)) S.scarto = Math.round(m.ora - (mio.t0 + Date.now()) / 2);
      // (senza aspettare qui: la risposta passa da questa stessa fila)
      chiedi("ciao", {}, TEMPO, true).then((d) => {
        classificaCiao(d);   // il PC ha detto chi è: tipo, nome, operatore (per il menu e la testata)
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
      if (a.scaduta) a.tardi(d);   // la risposta di una scrittura di cui non si sapeva: adesso si sa
      else if (d.ok) a.si(d.dati);
      else a.no(errDa(d));
      return;
    }
    if (d.evento === "fine") return chiusa(d.perche, d.testo);
    if (d.evento === "ordine" && d.ordine) { ordineVisto(d.ordine); render(); return; }
    if (d.evento === "avviso") avviso(d.testo);
  }
  const errDa = (d) => Object.assign(new Error(d.errore || "Non riuscito sul PC"), { dati: d.dati, incerto: !!d.incerto, dimesso: !!d.dimesso, scaduta: !!d.scaduto,
    ricarica: Array.isArray(d.cambiati) || Array.isArray(d.chiusi) ? [...(d.cambiati || []), ...(d.chiusi || [])] : null });
  // Un comando al PC. `auto`: lo manda l'app da sé (non il medico), e non
  // tiene aperta la sessione — né qui né sul PC. `tempo`: quanto può volerci,
  // il PC e la rete (un pezzo grande ci mette di più). Una domanda rimasta
  // senza risposta quando la presa cade si rimanda da sola appena torna.
  //   o.rq     una scrittura: il suo numero, e il PC la fa una volta sola anche
  //            se arriva due volte. Senza rete aspetta lei (le letture no:
  //            si rileggono al ritorno).
  //   o.tardi  passato il tempo, la risposta che arriva dopo va qui (la
  //            scrittura si rimanda ancora, per 10 minuti)
  //   o.grosso quanti byte porta la risposta (per il battito, su una rete lenta)
  //   o.scade  (un ordine) l'ora oltre la quale, se non è ancora partita, non parte più
  //   o.partita quando parte davvero (la prima volta)
  // i comandi che SCRIVONO nel gestionale: su un PC di sola lettura non partono
  // nemmeno dal telefono (il PC li rifiuterebbe comunque: «Questo PC è in sola
  // lettura»). «stampa»/«ristampa» no: stampano, non scrivono.
  const SCRITTURE_TEL = new Set(["ordina", "cartellaSalva", "terapiaAggiungi", "accetta", "registrazioneVia", "dfAggiungi", "dfSpunta", "dfTogli", "posto", "stazioneCollega"]);
  function chiedi(cmd, args = {}, tempo = TEMPO, auto = false, o = {}) {
    return new Promise((si, no) => {
      if (solaLettura() && SCRITTURE_TEL.has(cmd)) { no(Object.assign(new Error("Sola lettura: su questo PC non si scrive"), { solaLettura: true })); return; }
      if (!S.canale) { no(new Error("Sessione chiusa")); return; }
      if (!o.rq && !pronto()) {
        S.rinfresca = true;
        no(Object.assign(new Error(inLinea() ? "Il PC non è raggiungibile" : "Senza rete"), { offline: true }));
        return;
      }
      if (!auto) S.ultimo = Date.now();
      const id = ++S.id;
      const a = { msg: { id, cmd, ...args, ...(auto ? { auto: true } : {}), ...(o.rq ? { rq: o.rq } : {}) }, si, no, tardi: o.tardi || null, grosso: o.grosso || 0,
        inviata: false, scaduta: false, scade: o.scade || 0, partita: o.partita || null };
      a.t = setTimeout(() => scaduta(id), tempo);
      if (a.scade) setTimeout(() => {
        if (a.inviata || S.attese.get(id) !== a) return;
        clearTimeout(a.t); S.attese.delete(id);
        no(Object.assign(new Error("Scaduta: non inviata"), { scaduta: true }));
      }, Math.max(0, a.scade - Date.now()));
      S.attese.set(id, a);
      if (pronto()) spedisci(a);
    });
  }
  function spedisci(a) {
    const c = S.canale;
    // (ancora in sospeso — o «esci», che parte anche se la sessione qui è già chiusa)
    if (a.scade && !a.inviata && Date.now() >= a.scade) return;   // scaduta prima di partire: non parte più
    c.cifra(a.msg).then((f) => {
      if (!(S.attese.get(a.msg.id) === a || a.msg.cmd === "esci") || (a.scade && !a.inviata && Date.now() >= a.scade) || !manda(f)) return;
      if (!a.inviata && a.partita) a.partita();
      a.inviata = true;
    },
      (e) => { if (S.attese.get(a.msg.id) === a) { clearTimeout(a.t); S.attese.delete(a.msg.id); if (!a.scaduta) a.no(e); } });
  }
  // la presa nuova (o il PC tornato): le domande in sospeso, di nuovo — cifrate
  // di nuovo, con lo stesso numero
  function rimanda() { for (const a of S.attese.values()) spedisci(a); }
  function scaduta(id) {
    const a = S.attese.get(id);
    if (!a || a.scaduta) { if (a) S.attese.delete(id); return; }
    const assente = S.pari === false || !inLinea();
    if (!a.inviata) {
      // mai partita: si sa che il PC non l'ha
      S.attese.delete(id);
      a.no(Object.assign(new Error(inLinea() ? "Il PC non è raggiungibile: niente mandato" : "Senza rete: niente mandato al PC"), { nonInviata: true }));
      return;
    }
    if (a.tardi) { a.scaduta = true; a.t = setTimeout(() => scaduta(id), TARDI_MAX); } else S.attese.delete(id);
    a.no(Object.assign(new Error(assente ? "Il PC non è raggiungibile" : "Il PC non ha risposto in tempo"), { tempo: true, inviata: true }));
    if (!assente) rifai();   // una risposta che non arriva: la presa può essere morta
  }
  // Una scrittura: un numero suo, e la risposta che arriva tardi la chiude
  // lo stesso — `si` con i dati del PC, o l'errore.
  const nuovoRq = () => P.b64u(P.casuale(12));
  function scrivi(cmd, args, tempo, si, frase) {
    return chiedi(cmd, args, tempo, false, { rq: nuovoRq(), tardi: (d) => {
      if (d.ok) { si(d.dati); if (frase) avviso(frase); } else errore(errDa(d));
      render();
    } });
  }
  // La sessione è finita: niente dati dei pazienti restano qui.
  function chiusa(perche, testo) {
    S.canale = null; S.saluto = null; S.nSessione = "";
    for (const a of S.attese.values()) { clearTimeout(a.t); a.no(new Error("Sessione chiusa")); }
    S.attese.clear();
    // i 3 minuti senza comandi: del paziente dov'eri resta solo quale era e su che scheda (in memoria); lo si riapre
    // quando il PC risponde, se è ancora nel suo elenco — dei suoi dati non resta niente
    const rip = perche === "inattivo" && S.vista.nome === "paziente" ? { ep: S.vista.ep, scheda: S.scheda } : null;
    svuota();
    S.riprendi = rip;
    S.perche = perche || "";
    S.testoFine = testo || PERCHE[perche] || "La sessione è finita";
    if (FINITE.has(perche)) return dimentica("finita");   // la chiave non vale più
    zitto();
    S.fase = "chiusa"; S.menu = false;
    render();
  }
  // Il PC è di un altro telefono. La chiave del QR resta (serve a «Cancella e
  // riassocia»); non si prova da sé, e dati non ce ne sono.
  function rifiuta() {
    S.canale = null; S.saluto = null; S.nSessione = "";
    S.cambio = { testo: "", errore: "", occupato: false };
    S.fase = "rifiutato"; S.menu = false;
    render();
  }
  // «Cancella e riassocia»: un saluto col codice che il medico ha scritto. Il
  // PC lo controlla (il codice non è qui) e, se è giusto, risponde come a
  // ogni saluto: da lì la sessione parte da sola, e arriva l'elenco.
  async function cambia() {
    const c = S.cambio;
    if (!c || c.occupato || !S.chiavi) return;
    if (!c.testo.trim()) { fuocoSu("cambio"); return; }
    if (!S.ws || S.ws.readyState !== 1) { c.errore = "Non collegato: riprova"; collega(); render(); return; }
    c.occupato = true; c.errore = ""; render();
    const n = P.casuale(16);
    const mio = { n: P.b64u(n), byte: n, cambio: true, t0: Date.now() };
    S.saluto = mio;
    manda(await P.sigilla(S.chiavi.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: mio.n, dev: S.coppia.dev, cambio: c.testo.trim().slice(0, 12) }));
    setTimeout(() => {
      if (S.cambio !== c || !c.occupato) return;
      if (S.saluto === mio) S.saluto = null;
      c.occupato = false; c.errore = "Il PC non risponde"; render();
    }, 8000);
  }
  function cambioNo(m) {
    const c = S.cambio;
    if (!c) return;
    c.occupato = false; c.testo = "";
    c.errore = m.no === "codice" ? "Codice sbagliato"
      : m.no === "bloccato" && Number.isFinite(m.fino) ? `Troppi tentativi: riprova alle ${hhmm(m.fino)}` : "Il PC è associato a un altro telefono";
    render();
    fuocoSu("cambio");
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
    if (e.offline) return;   // senza rete lo dice già la testata; si rilegge al ritorno
    avviso(e.message, "err");
    if (e.dimesso) aggiornaLista(true);   // dimesso sul PC: dall'elenco se ne va
  }
  // Chi aspetta al Triage: un PC più vecchio non conosce il comando, o non c'è
  // niente — allora la sezione manca, senza errori. Aprendo l'app (o tornandoci,
  // o con «aggiorna») il PC rilegge la lista smart dietro (`rileggi`): se è
  // partita, fra poco si richiede l'elenco, una volta.
  let tRilettura = 0;
  const chiediTriage = (auto = true, rileggi = false) => chiedi("triage", rileggi ? { rileggi: true } : {}, TEMPO, auto).then((t) => {
    if (t && t.rilegge && !tRilettura) tRilettura = setTimeout(() => { tRilettura = 0; if (document.visibilityState === "visible" && S.fase === "pronta") aggiornaLista(true); }, 25e3);
    return t;
  }, () => null);
  // La mappa: un PC più vecchio non conosce il comando — allora niente scelta «Lista · Mappa», senza errori.
  // Se la richiesta fallisce (rete), resta quella di prima.
  const chiediMappa = (auto = true) => chiedi("mappa", {}, TEMPO, auto).then((m) => { if (m && Array.isArray(m.mappe) && m.mappe.length) S.mappa = m; }, () => {});
  // La Terapia: un PC più vecchio non conosce il comando — allora niente scheda «Terapia», senza errori.
  // (senza paziente il PC non legge niente: dice solo che c'è)
  const chiediTerapia = () => (S.terapiaSi !== null ? Promise.resolve() : chiedi("terapie", {}, TEMPO, true).then(() => { S.terapiaSi = true; },
    (e) => { if (/sconosciuto/i.test(String(e && e.message))) S.terapiaSi = false; }));
  async function carica() {
    S.occupato.add("lista"); render();
    try {
      const [pazienti, catalogo, ordini, triage] = await Promise.all([chiedi("pazienti", {}, TEMPO, true), chiedi("richieste", {}, TEMPO, true), chiedi("ordini", {}, TEMPO, true), chiediTriage(true, true), chiediMappa(), chiediTerapia()]);
      S.pazienti = pazienti; S.triage = triage; S.catalogo = catalogo; S.aggiornato = Date.now(); S.erroreLista = "";
      for (const o of ordini || []) if (!S.ordini.has(o.id) || !S.ordini.get(o.id).fine) ordineVisto(o);
    } catch (e) { S.erroreLista = e.message; }
    S.occupato.delete("lista"); render();
    // (chiusa per i 3 minuti: il PC ha risposto — se il paziente c'è ancora e non si è già andati altrove, ci si riapre)
    if (S.riprendi && S.pazienti) {
      const r = S.riprendi; S.riprendi = null;
      if (S.vista.nome === "lista" && paziente(r.ep)) { S.scheda = r.scheda; apriPaziente(r.ep); }
    }
  }
  async function aggiornaLista(auto = false, rileggi = false) {
    if (!S.catalogo) return carica();
    S.occupato.add("lista"); render();
    try { [S.pazienti, S.triage] = await Promise.all([chiedi("pazienti", {}, TEMPO, auto), chiediTriage(auto, rileggi), chiediMappa(auto), chiediTerapia()]); S.aggiornato = Date.now(); S.erroreLista = ""; }
    catch (e) { if (S.pazienti) { if (!auto) errore(e); } else S.erroreLista = e.message; }
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
    // un ordine appena finito: la sua richiesta è nuova, fra le «Richieste fatte»
    if (o.fine && !(prima && prima.fine) && o.id.startsWith("tel") && S.vista.nome === "paziente" && S.vista.ep === o.ep && S.scheda === "richieste") caricaRistampe(o.ep);
  }
  const paziente = (ep) => (S.pazienti || []).find((p) => p.ep === ep) || null;
  function aggiornaRiga(riga) {
    if (!riga || !S.pazienti) return;
    const i = S.pazienti.findIndex((p) => p.ep === riga.ep);
    if (i >= 0) S.pazienti[i] = riga;
  }
  function apriPaziente(ep) {
    S.vista = { nome: "paziente", ep };
    S.menu = false; S.arma = null; S.promTesto = ""; S.vitAperti = ""; S.dfFoglio = false;
    window.scrollTo(0, 0);
    render();
    caricaEsiti(ep);
    if (S.scheda === "terapia" && !S.terapiaSi) S.scheda = "esiti";
    if (S.scheda === "cartella") caricaCartella(ep);
    if (S.scheda === "terapia") caricaTerapie(ep);
    if (S.scheda === "richieste") caricaRistampe(ep);
  }
  // La cartella: l'ultima lettura del PC (o, con «↻ Rileggi», la pagina riletta)
  async function caricaCartella(ep, auto = false, rileggi = false) {
    if (S.occupato.has("cartella" + ep)) return;
    caricaEo();
    S.occupato.add("cartella" + ep); render();
    try { cartellaDalPc(ep, await chiedi("cartella", rileggi ? { ep, rileggi: true } : { ep }, 40e3, auto)); } catch (e) { if (!auto) errore(e); }
    S.occupato.delete("cartella" + ep); render();
  }
  // Gli EO salvati sul PC, a ogni apertura della cartella (i suoi cambiano sul PC): un PC più vecchio non conosce il
  // comando — allora niente chip, senza errori, e non lo si richiede più.
  async function caricaEo() {
    if (S.eoVecchio) return;
    try {
      const l = await chiedi("eo", {}, TEMPO, true);
      const v = (Array.isArray(l) ? l : []).filter((x) => x && typeof x.k === "string" && typeof x.nome === "string" && typeof x.testo === "string" && x.testo.trim() && ["base", "casi", "frasi"].includes(x.gruppo));
      if (v.length) { S.eo = v; render(); }
    } catch (e) { if (/sconosciuto/i.test(String(e && e.message))) S.eoVecchio = true; }
  }
  const CAMPO_EO = "ESAME_OBIETTIVO";
  // Un EO salvato nel campo: vuoto, ci va il testo; con già del testo, in fondo a capo — mai al posto di quello che c'è.
  // È una modifica della bozza come un'altra (niente parte finché non si preme «Salva»); per 5 secondi «Annulla»
  // toglie esattamente quello che è stato messo. Il cursore sta dopo il testo.
  function inserisciEo(k) {
    const ep = S.vista.ep, v = (S.eo || []).find((x) => x.k === k), c = S.cartelle.get(ep), x = c && c.campi.find((y) => y.nome === CAMPO_EO), p = paziente(ep);
    if (!v || !x || x.ro || !p || p.prec || S.occupato.has("csalva" + ep)) return;
    let b = S.cbozze.get(ep);
    if (!b) S.cbozze.set(ep, b = new Map());
    const prima = b.has(CAMPO_EO) ? b.get(CAMPO_EO).testo : x.v;
    const ins = !prima.trim() ? v.testo : (prima.endsWith("\n") ? "" : "\n") + v.testo;
    b.set(CAMPO_EO, { base: b.has(CAMPO_EO) ? b.get(CAMPO_EO).base : x.v, testo: !prima.trim() ? v.testo : prima + ins });
    const st = S.cstato.get(ep);
    if (st && !st.ricarica) S.cstato.delete(ep);
    if (S.eoAnnulla) clearTimeout(S.eoAnnulla.t);
    const a = S.eoAnnulla = { ep, nome: v.nome, prima, ins, t: 0 };
    a.t = setTimeout(() => { if (S.eoAnnulla === a) { S.eoAnnulla = null; render(); } }, 5000);
    S.eoSheet = false;
    render();
    const t = document.getElementById("cc-" + CAMPO_EO);
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); t.scrollTop = t.scrollHeight; t.scrollIntoView({ block: "nearest" }); }
  }
  function annullaEo() {
    const a = S.eoAnnulla;
    if (!a) return;
    clearTimeout(a.t); S.eoAnnulla = null;
    const b = S.cbozze.get(a.ep), d = b && b.get(CAMPO_EO);
    if (d) {
      // com'è subito dopo l'inserimento: torna a com'era; se intanto è stato toccato, si toglie solo quello che si riconosce in fondo
      const ora = d.testo, nuovo = ora === (a.prima.trim() ? a.prima + a.ins : a.ins) ? a.prima : ora.endsWith(a.ins) ? ora.slice(0, ora.length - a.ins.length) : ora;
      b.set(CAMPO_EO, { base: d.base, testo: nuovo });
    }
    render();
  }
  // una lettura nuova: le bozze restano (con la loro base), tranne quelle che il PC ha già così
  function cartellaDalPc(ep, c) {
    if (!c || !Array.isArray(c.campi)) return;
    S.cartelle.set(ep, c);
    const b = S.cbozze.get(ep);
    if (b) for (const [n, x] of b) { const v = c.campi.find((y) => y.nome === n); if (v && uguale(v.v, x.testo)) b.delete(n); }
  }
  const cambiatiDi = (ep) => [...(S.cbozze.get(ep) || new Map())].filter(([, x]) => x.testo !== x.base);
  // «Salva»: tutti i campi cambiati insieme, ognuno con il testo da cui il medico è partito (`prima`)
  async function salvaCartella(ep) {
    const l = cambiatiDi(ep);
    if (!l.length || S.occupato.has("csalva" + ep)) return;
    S.cstato.delete(ep);
    S.occupato.add("csalva" + ep); render();
    // (com'è andata, subito o — persa la risposta — quando il PC risponde)
    const salvata = (c) => { cartellaDalPc(ep, c); for (const [n, x] of l) if (S.cbozze.get(ep)?.get(n)?.testo === x.testo) S.cbozze.get(ep).delete(n); S.cstato.delete(ep); };
    const no = (e) => {
      if (e.dati) cartellaDalPc(ep, e.dati);
      S.cstato.set(ep, { testo: e.message, ricarica: e.ricarica });
      if (e.dimesso) aggiornaLista(true);
    };
    try {
      salvata(await chiedi("cartellaSalva", { ep, campi: Object.fromEntries(l.map(([n, x]) => [n, { prima: x.base, dopo: x.testo }])) }, ATTESA_CARTELLA, false,
        { rq: nuovoRq(), tardi: (d) => { if (d.ok) { salvata(d.dati); avviso("Salvato"); } else no(errDa(d)); render(); } }));
      avviso("Salvato");
    } catch (e) {
      no(e.inviata ? Object.assign(new Error("Non so se è salvato: aspetto il PC"), { ricarica: null }) : e);
    }
    S.occupato.delete("csalva" + ep); render();
  }
  // «Ricarica» (cambiato sul PC): via le bozze di quei campi, e il testo del PC
  function ricaricaCartella(ep) {
    const st = S.cstato.get(ep);
    for (const n of (st && st.ricarica) || []) S.cbozze.get(ep)?.delete(n);
    S.cstato.delete(ep);
    caricaCartella(ep, false, true);
  }
  // La Terapia: la pagina Terapia del gestionale, come l'ha letta il PC (l'ultima lettura, o con «↻ Rileggi» la pagina riletta)
  async function caricaTerapie(ep, auto = false, rileggi = false) {
    if (S.occupato.has("terapie" + ep)) return;
    S.occupato.add("terapie" + ep); render();
    try { terapieDalPc(ep, await chiedi("terapie", rileggi ? { ep, rileggi: true } : { ep }, ATTESA_TERAPIE, auto)); } catch (e) { if (!auto) errore(e); }
    S.occupato.delete("terapie" + ep); render();
  }
  // (una lettura senza i preferiti — quella che torna da un'aggiunta — tiene quelli di prima)
  function terapieDalPc(ep, l) {
    if (!l || !Array.isArray(l.righe) || !l.opz) return;
    S.terapie.set(ep, { ...l, pref: Array.isArray(l.pref) ? l.pref : (S.terapie.get(ep) || {}).pref || [] });
  }
  // la dose in una riga, come sul PC: «1 cpr · os · al bisogno»
  const testoOpz = (x) => (x && typeof x === "object" ? x.t : x) || "";
  const doseTer = (v) => [v.qta && `${v.qta}${testoOpz(v.um) ? " " + testoOpz(v.um) : ""}`, !v.qta && testoOpz(v.um), testoOpz(v.via), testoOpz(v.dil),
    v.freq && `freq. ${v.freq}`, v.durata && `durata ${v.durata}`, v.continua && "continua", v.bisogno && "al bisogno"].filter(Boolean).join(" · ");
  // «＋ Farmaco»: il foglio, sul paziente aperto
  function apriFarmaco(ep) {
    const p = paziente(ep);
    if (!p || p.prec || !S.terapie.get(ep)) return;
    S.tf = { ep, passo: "scegli", q: "", voci: null, qVoci: "", cerca: "", errVoci: "", v: null, altro: false, rq: "", stato: "", esito: null };
    render();
  }
  // un preferito (com'è stato confermato) o una voce della tendina (solo la scritta): poi la dose
  function scegliFarmaco(v) {
    const f = S.tf;
    if (!f || !v) return;
    f.v = { descr: v.descr, codice: v.codice || "", qta: v.qta || "", um: v.um || null, via: v.via || null, dil: v.dil || null,
      continua: !!v.continua, bisogno: !!v.bisogno, freq: v.freq || "", durata: v.durata || "" };
    f.altro = !!(f.v.dil || f.v.freq || f.v.durata || f.v.continua || f.v.bisogno);
    f.passo = "dose"; f.rq = ""; f.esito = null;
    render();
  }
  // Cercare nella tendina della pagina Terapia: la cerca il PC (una scheda scrive nel campo, come una persona).
  // Da 3 lettere, quando il medico smette di scrivere; una alla volta, e alla fine l'ultima scritta.
  let tCerca = 0;
  const cercaPresto = () => { clearTimeout(tCerca); tCerca = setTimeout(cercaFarmaco, 700); };
  async function cercaFarmaco() {
    clearTimeout(tCerca);
    const f = S.tf, q = f ? f.q.replace(/\s+/g, " ").trim() : "";
    if (!f || f.passo !== "scegli" || q.length < 3 || q.toLowerCase() === f.qVoci.toLowerCase()) return;
    if (f.cerca) { f.ancora = true; return; }
    f.cerca = q; f.errVoci = ""; render();
    try { const d = await chiedi("terapiaCerca", { ep: f.ep, q }, ATTESA_TERAPIE); f.voci = Array.isArray(d && d.voci) ? d.voci : []; f.qVoci = q; }
    catch (e) { f.errVoci = e.offline ? "Senza collegamento col PC" : e.message; }
    f.cerca = "";
    if (S.tf !== f) return;
    render();
    if (f.ancora) { f.ancora = false; cercaFarmaco(); }
  }
  // «Conferma per ROSSI M.»: una terapia, una volta. Il numero (rq) resta finché non si sa com'è andata:
  // rimandato (la rete, un tocco di nuovo) il PC risponde com'è andata e non la rifà.
  async function confermaFarmaco(ep) {
    const f = S.tf, l = S.terapie.get(ep), p = paziente(ep);
    if (!f || f.ep !== ep || !f.v || !l || !p || p.prec || f.stato || (f.esito && f.esito.tono !== "err")) return;
    if (!f.rq) f.rq = nuovoRq();
    const v = f.v, voce = { descr: v.descr, codice: v.codice, qta: v.qta.trim(), um: v.um, via: v.via, dil: v.dil, continua: v.continua, bisogno: v.bisogno,
      ...(v.freq.trim() ? { freq: v.freq.trim() } : {}), ...(v.durata.trim() ? { durata: v.durata.trim() } : {}) };
    f.stato = "invio"; f.esito = null; render();
    const si = (d) => {
      terapieDalPc(ep, d);
      if (!d || !Array.isArray(d.righe)) caricaTerapie(ep, true);
      f.stato = ""; f.esito = { tono: "ok", testo: "Confermata" };
    };
    const no = (e) => {
      if (e.dati) terapieDalPc(ep, e.dati);
      f.stato = ""; f.esito = { tono: e.incerto ? "warn" : "err", testo: e.message };
      if (!e.incerto) f.rq = "";   // non è partita: un nuovo tocco è una richiesta nuova
    };
    // (il foglio chiuso intanto: com'è andata lo dice un avviso)
    const detto = (e) => { if (S.tf !== f) avviso(e ? e.message : `Confermata: ${v.descr}`, e && !e.incerto ? "err" : "", !!(e && e.incerto)); render(); };
    try {
      si(await chiedi("terapiaAggiungi", { ep, voce, visti: l.righe.map((r) => r.prog).filter(Boolean) }, ATTESA_TERAPIA, false,
        { rq: f.rq, scade: Date.now() + 30e3, tardi: (d) => { if (d.ok) { si(d.dati); detto(null); } else { const e = errDa(d); no(e); detto(e); } } }));
      detto(null);
    } catch (e) {
      const x = e.inviata ? Object.assign(new Error("Incerto: il PC non ha ancora risposto — controlla sul PC"), { incerto: true }) : e;
      no(x);
      detto(x);
    }
  }
  async function caricaEsiti(ep, auto = false) {
    if (S.occupato.has("esiti" + ep)) return;
    S.occupato.add("esiti" + ep); render();
    try { esitiArrivati(ep, await chiedi("esiti", { ep }, 40e3, auto)); } catch (e) { if (!auto) errore(e); }
    S.occupato.delete("esiti" + ep); render();
    leggiDaSolo(ep, auto);
  }
  // Gli esiti arrivati dal PC: con la riga del paziente (le allergie e lo stato, dopo una lettura sono nuovi)
  function esitiArrivati(ep, e) {
    S.esiti.set(ep, e);
    if (e && e.riga) aggiornaRiga(e.riga);
    guardaEsiti(ep);
  }
  // Quello che il PC legge da sé, perché il medico ha aperto il paziente qui (il suo tocco è il gesto):
  // gli esiti dicono `leggi` — «apri»: in questo turno il PC non l'ha ancora aperto, e apre la sua
  // pagina dietro, come un clic sulla lista; «nuovi»: il laboratorio della pagina è cambiato, o un
  // referto non è ancora salvato. È il «↻ Rileggi» senza il tocco: al più una volta ogni 10 minuti per
  // paziente (il PC, da parte sua, riprova più tardi quello che non è riuscito). ↻ lo rifà quando vuoi.
  // «apri» solo dopo un tocco: gli esiti richiesti da sé (tornando sull'app) non aprono una pagina nuova.
  // «nuovi» solo con gli Esiti davanti: per ordinare, o per la cartella, la sua pagina non si riapre.
  const DA_SOLO_OGNI = 10 * 60e3;
  function leggiDaSolo(ep, daSe = false) {
    const e = S.esiti.get(ep);
    if (!e || !e.leggi || (daSe && e.leggi === "apri") || S.occupato.has("valori" + ep) || Date.now() - (S.daSolo.get(ep) || 0) < DA_SOLO_OGNI) return;
    if (e.leggi !== "apri" && (S.scheda !== "esiti" || S.vista.nome !== "paziente" || S.vista.ep !== ep)) return;
    S.daSolo.set(ep, Date.now());
    aggiornaValori(ep, e.leggi === "apri" ? "apri" : "auto");
  }
  // Visto qui = visto sul PC: gli Esiti con qualcosa di nuovo (i valori, il pallino del tabellone),
  // davanti per qualche secondo, lo dicono al PC — come la sua finestra aperta sugli Esiti. Una volta
  // per risposta del PC. (Un referto aperto lo dice da sé: «referto».)
  const VISTO_DOPO = 3000;
  function guardaEsiti(ep) {
    const e = S.esiti.get(ep);
    if (!e || !(Number(e.valoriNuovi) > 0 || e.nuovo)) return;
    setTimeout(() => {
      if (S.esiti.get(ep) !== e || S.vista.nome !== "paziente" || S.vista.ep !== ep || S.scheda !== "esiti" || document.visibilityState !== "visible" || S.fase !== "pronta") return;
      chiedi("visto", { ep, valori: true, ...(e.tabella && e.letto ? { fino: e.letto } : {}) }, TEMPO, true).then(() => {   // (da sé: non tiene aperta la sessione)
        if (S.esiti.get(ep) !== e) return;
        e.valoriNuovi = 0; e.nuovo = false;
        render();
      }, () => {});
    }, VISTO_DOPO);
  }
  // Un referto aperto qui: non più «nuovo», qui e sul PC
  function refertoVisto(ep, id) {
    const e = S.esiti.get(ep), r = e && (e.referti || []).find((x) => x.id === id);
    if (!r || !r.nuovo) return;
    r.nuovo = false;
    chiedi("visto", { ep, ids: [id] }).catch(() => { r.nuovo = true; render(); });
  }
  // «Richieste fatte»: quelle che la pagina del paziente sul PC sa stampare (anche
  // non fatte dall'estensione), ognuna con «Ristampa». Un PC più vecchio non
  // conosce il comando: la sezione manca, senza errori.
  async function caricaRistampe(ep) {
    if (S.occupato.has("ristampe" + ep)) return;
    S.occupato.add("ristampe" + ep);
    const prima = JSON.stringify(S.ristampe.get(ep) || null);
    try { S.ristampe.set(ep, (await chiedi("ristampe", { ep }, 40e3, true)).richieste || []); } catch (e) { S.ristampe.set(ep, /sconosciuto/i.test(e.message) || e.offline ? null : e.message); }
    S.occupato.delete("ristampe" + ep);
    if (JSON.stringify(S.ristampe.get(ep) || null) !== prima) render();   // (uguale a prima: niente da ridisegnare)
  }
  // «Ristampa»: le etichette e il foglio di quella richiesta, sulle stampanti scelte
  // (PC o stazione, come per un ordine). Una alla volta: un doppio tocco è un tocco
  // solo; il numero (`oid`) è della ristampa, rimandata il PC la fa una volta sola.
  // Com'è andata la dice la carta che compare sopra, con le parole del PC.
  async function ristampa(ep, rid, quali = "tutto") {
    const k = "ris" + ep + "." + rid;
    if (S.occupato.has(k)) return;
    S.ristApri = null;
    S.occupato.add(k); render();
    const nuovi = (d) => {
      for (const o of (d && d.ordini) || []) {
        if (!S.ordini.has(o.id)) ordineVisto(o.titolo ? o : { ...o, stato: "stampo", tono: "run", titolo: "Ristampo", testo: quali === "etichette" ? "Mando le etichette al PC…" : quali === "foglio" ? "Mando il foglio al PC…" : "Mando le etichette e il foglio al PC…", fine: false, ts: Date.now() });
      }
    };
    try {
      const quando = Date.now();   // (come un ordine: oltre 30 secondi dal tocco non parte più)
      nuovi(await chiedi("ristampa", { ep, rid, oid: P.b64u(P.casuale(12)), nato: Math.round(quando + S.scarto), quali, ...(staDi() ? { dest: doveDi(ep) } : {}) }, 60e3, false, {
        rq: nuovoRq(), scade: quando + CODA_MAX,
        tardi: (r) => { if (r.ok) nuovi(r.dati); else avviso(r.errore || "Ristampa non partita", "err"); render(); } }));
      window.scrollTo(0, 0);
    } catch (e) {
      if (e.tempo || e.incerto) avviso("Non so se la ristampa è partita: guarda la stampante prima di rifarla", "err", true);
      else errore(e);
    }
    S.occupato.delete(k); render();
  }
  function ristampeHtml(p) {
    const l = S.ristampe.get(p.ep);
    if (typeof l === "string") return `<p class="piede">${esc(l)}</p>`;
    if (!Array.isArray(l) || !l.length) return "";
    // «Ristampa»: con etichette E foglio il tocco apre la scelta (🏷️ Etichette · 📄 Foglio · Entrambi),
    // il secondo tocco stampa; con un genere solo (o un PC che non dice quali) stampa subito
    const apri = S.ristApri && S.ristApri.ep === p.ep ? S.ristApri.id : "";
    const q = (r, k, t) => `<button class="btnmini" data-a="ristampaQ" data-id="${esc(r.id)}" data-q="${k}">${t}</button>`;
    return `<div class="lbl">Richieste fatte</div>${doveHtml(p)}<div class="carta ristampe">${l.map((r) => `<div class="rist${apri === r.id ? " apri" : ""}"><span class="c"><b>${esc(r.quando || "Richiesta")}</b>${
      r.esami ? `<span>${esc(r.esami)}</span>` : ""}<small>${esc(r.cosa || "")}</small></span><button class="btnmini pri" data-a="ristampa" data-id="${esc(r.id)}" aria-expanded="${apri === r.id}" ${
      S.occupato.has("ris" + p.ep + "." + r.id) ? "disabled" : ""}>Ristampa</button>${
      apri === r.id ? `<div class="quali" role="group" aria-label="Che cosa ristampare">${q(r, "etichette", "🏷️ Etichette")}${q(r, "foglio", "📄 Foglio")}${q(r, "tutto", "Entrambi")}</div>` : ""}</div>`).join("")}</div>`;
  }
  // Tornati sull'app: l'elenco e, sulla pagina di un paziente, i suoi esiti
  // (un referto arrivato intanto). Li chiede l'app da sé: non tengono aperta la sessione.
  function rileggi() {
    aggiornaLista(true, true);
    if (S.vista.nome === "paziente") caricaEsiti(S.vista.ep, true);
    if (S.vista.nome === "paziente" && S.scheda === "cartella" && !S.occupato.has("csalva" + S.vista.ep)) caricaCartella(S.vista.ep, true);
    if (S.vista.nome === "paziente" && S.scheda === "terapia" && !S.tf) caricaTerapie(S.vista.ep, true);
    if (S.vista.nome === "registrazioni") caricaZip(true);
  }
  // «↻ Rileggi» (modo ""), o la lettura partita da sé (leggiDaSolo: «auto», «apri»). Quella da sé non
  // tiene aperta la sessione e non grida: se non riesce, una riga piccola lo dice e ↻ resta lì.
  async function aggiornaValori(ep, modo = "") {
    if (S.occupato.has("valori" + ep)) return;
    S.occupato.add("valori" + ep); S.legge.set(ep, { modo, dal: Date.now() }); S.nonLetti.delete(ep); render();
    try {
      esitiArrivati(ep, await chiedi("aggiornaValori", modo ? { ep, modo } : { ep }, ATTESA_VALORI, !!modo));
    } catch (e) { if (!modo) errore(e); else if (!e.offline) S.nonLetti.set(ep, e.message); }
    S.occupato.delete("valori" + ep); S.legge.delete(ep); render();
  }
  // Un referto PDF salvato sul PC: arriva a pezzi dalla stessa sessione
  // cifrata, si ricompone e si controlla; poi il visore del telefono lo apre
  // da un blob: in memoria. Mai su disco, mai da un indirizzo di rete: il
  // blob si revoca quando la finestra si chiude, a ogni nuovo PDF, uscendo.
  const PDF_MAX = 15e6;
  const PEZZO_B64 = 4 * 130000;      // caratteri base64 in un pezzo, nei due versi (sotto il tetto del ripetitore)
  // Un pezzo di un PDF che viaggia: se la rete cade, si riprende da questo
  // pezzo (non da capo) appena torna; oltre `fine` si lascia perdere, e lo si dice.
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  async function pezzo(fai, fine, tardi) {
    for (;;) {
      try { return await fai(); } catch (e) {
        if (!(e.tempo || e.offline || e.nonInviata) || !S.canale) throw e;
        if (Date.now() >= fine) throw Object.assign(new Error(tardi), { tempo: !!e.tempo || !!e.inviata });
        while (!pronto() && S.canale && Date.now() < fine) await pausa(400);
      }
    }
  }
  function chiudiPdf() {
    if (!pdfAperto) return;
    clearInterval(pdfAperto.t);
    try { URL.revokeObjectURL(pdfAperto.url); } catch { /* già via */ }
    pdfAperto = null;
  }
  async function apriPdf(ep, id, misura) {
    if (misura > PDF_MAX) { avviso("PDF troppo grande: aprilo sul PC", "err"); return; }
    if (S.occupato.has("pdf" + id)) return;
    // la finestra si apre subito, dentro il tocco: dopo l'attesa iOS non la lascerebbe aprire
    const w = window.open("", "_blank");
    if (!w) { avviso("Consenti i popup per aprire il PDF", "err"); return; }
    S.occupato.add("pdf" + id); render();
    try {
      const parti = [];
      let n = 1, size = 0, tot = 0;
      const entro = Date.now() + 120e3 + perRete(misura * 4 / 3);
      for (let i = 0; i < n; i++) {
        const d = await pezzo(() => chiedi("pdf", { ep, ref: id, i }, 40e3 + perRete(PEZZO_B64), false, { grosso: PEZZO_B64 }), entro, "PDF non arrivato: la rete è troppo lenta, riprova");
        if (!d || d.i !== i || typeof d.b !== "string" || !Number.isSafeInteger(d.n) || d.n < 1 || d.n > 64 || !Number.isSafeInteger(d.size) || d.size < 1 || d.size > PDF_MAX
          || (i && (d.n !== n || d.size !== size))) throw new Error("PDF non arrivato bene: riprova");
        if (!i) { n = d.n; size = d.size; }
        const bin = atob(d.b), u = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
        tot += u.length; parti.push(u);
      }
      if (tot !== size || String.fromCharCode(...parti[0].subarray(0, 4)) !== "%PDF") throw new Error("PDF non arrivato bene: riprova");
      chiudiPdf();
      const url = URL.createObjectURL(new Blob(parti, { type: "application/pdf" }));
      pdfAperto = { url, w, t: setInterval(() => { if (w.closed) chiudiPdf(); }, 1500) };
      w.location.href = url;
    } catch (e) {
      try { w.close(); } catch { /* ignore */ }
      errore(e);
    }
    S.occupato.delete("pdf" + id); render();
  }
  window.addEventListener("pagehide", chiudiPdf);
  // «Stampa un PDF» (⋯): il file scelto va al PC a pezzi, dentro la stessa
  // sessione cifrata (come i referti, al contrario); il PC lo ricompone, lo
  // controlla e lo stampa sull'A4 senza dialogo, una volta sola per richiesta
  // (`rid`). Qui si dice com'è andata, con le parole del PC.
  const $pdf = document.getElementById("pdfin");
  const PEZZO = PEZZO_B64 / 4 * 3;   // byte per messaggio (≈ 520 KB in base64)
  const ATTESA_STAMPA = 130e3;       // il PC aspetta la stampante fino a 110 secondi
  const b64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  async function stampaPdf(file) {
    if (!file || (S.stampa && !S.stampa.fine) || !S.canale) return;
    // dove: la stampante predefinita del telefono (⋯ → «Stampa su»): il PC, o la stazione di stampa collegata
    const dove = doveTel(), sta = staDi() || "Infermeria";
    const fine = (tono, titolo, testo = "") => { S.stampa = { tono, titolo, testo, fine: true, ts: Date.now() }; render(); };
    if (file.size > PDF_MAX) return fine("err", "PDF troppo grande: oltre 15 MB");
    S.stampa = { tono: "run", titolo: "Invio…", testo: "", fine: false, ts: Date.now() };
    const u = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...u.subarray(0, 4)) !== "%PDF") return fine("err", "Non è un PDF");
    render();
    const rid = P.b64u(P.casuale(12)), n = Math.max(1, Math.ceil(u.length / PEZZO));
    // ogni pezzo col suo numero (rid-i): rimandato dopo una presa caduta, il PC non lo prende due volte
    const entro = Date.now() + ATTESA_STAMPA + 120e3 + perRete(u.length * 4 / 3);
    let ultimo = false;   // l'ultimo pezzo è partito: da lì il PC può stampare
    try {
      let d = null;
      for (let i = 0; i < n && !(d && d.fine); i++) {
        ultimo = i === n - 1;
        S.stampa.titolo = i === n - 1 ? (dove === "stazione" ? `Stampo in ${sta}…` : "Stampo sul PC…") : `Invio… ${Math.round(i / n * 100)}%`; render();
        const b = b64(u.subarray(i * PEZZO, (i + 1) * PEZZO));
        d = await pezzo(() => chiedi("stampa", { rid, i, n, size: u.length, b, ...(dove === "stazione" ? { dest: "stazione" } : {}) }, (i === n - 1 ? ATTESA_STAMPA : 40e3) + perRete(b.length), false, { rq: `${rid}-${i}` }),
          entro, "Il PC non ha risposto in tempo");
      }
      fine(d.tono || "warn", d.titolo || "Mandato al PC", d.testo);
    } catch (e) {
      if (!S.canale) { S.stampa = null; return; }
      if (e.tempo && ultimo) fine("warn", "Non so se è stampato", `guarda la stampante ${dove === "stazione" ? "in " + sta : "del PC"} prima di rifarlo`);
      else if (e.tempo || e.nonInviata) fine("err", "PDF NON stampato", "la rete non ha retto: riprova");
      else fine("err", e.message);
    }
  }
  $pdf.addEventListener("change", () => { const f = $pdf.files[0]; $pdf.value = ""; stampaPdf(f); });
  // «🖨️» accanto a un referto PDF (Esiti): lo stampa il PC, dalla SUA copia salvata
  // (niente passa dal telefono), sulla stampante predefinita del telefono. Una carta
  // sola con «Stampa PDF»: una stampa alla volta. Il numero (`rid`) è della stampa:
  // rimandato dopo una presa caduta, il PC la fa una volta sola.
  async function stampaReferto(ep, ref) {
    if (!ref || (S.stampa && !S.stampa.fine) || !S.canale) return;
    const dove = doveTel(), sta = staDi() || "Infermeria";
    const fine = (tono, titolo, testo = "") => { S.stampa = { tono, titolo, testo, fine: true, ts: Date.now() }; render(); };
    S.stampa = { tono: "run", titolo: "Stampo il referto…", testo: "", fine: false, ts: Date.now() };
    render();
    const rid = P.b64u(P.casuale(12));
    try {
      const d = await pezzo(() => chiedi("stampaReferto", { ep, ref, rid, dest: dove }, ATTESA_STAMPA, false, { rq: rid }),
        Date.now() + ATTESA_STAMPA + 120e3, "Il PC non ha risposto in tempo");
      fine(d.tono || "warn", d.titolo || "Mandato al PC", d.testo);
    } catch (e) {
      if (!S.canale) { S.stampa = null; return; }
      if (e.tempo) fine("warn", "Non so se è stampato", `guarda la stampante ${dove === "stazione" ? "in " + sta : "del PC"} prima di rifarlo`);
      else if (e.nonInviata) fine("err", "Referto NON stampato", "la rete non ha retto: riprova");
      else fine("err", e.message);
    }
  }

  // ------------------------------------------------------ le registrazioni
  // ⋯ → Registrazioni: gli zip che il PC ha salvato, già anonimizzati e
  // controllati (niente pazienti: quando, quanto, a mano o automatica e
  // perché, il controllo). «Scarica» lo porta qui a pezzi, come i PDF dei
  // referti, dentro la stessa sessione cifrata, e lo tiene in memoria — mai su
  // disco — finché la sessione è aperta; poi «Condividi…» lo passa a iOS
  // (all'app di Claude, a File…), o, dove non si può, «Salva» lo scarica come
  // un file. «Cancella» (due tocchi) lo toglie dal PC.
  const ZIP_MAX = 100 * 1024 * 1024;
  function apriRegistrazioni() {
    S.vista = { nome: "registrazioni", ep: "" };
    S.menu = false; S.zipArma = null;
    window.scrollTo(0, 0);
    render();
    caricaZip();
  }
  async function caricaZip(auto = false) {
    if (S.occupato.has("zip")) return;
    S.occupato.add("zip"); render();
    try { S.zip = await chiedi("registrazioni", {}, TEMPO, auto); S.zipErr = ""; }
    catch (e) { if (S.zip) { if (!auto) errore(e); } else S.zipErr = e.message; }
    S.occupato.delete("zip"); render();
  }
  async function scaricaZip(id) {
    const z = (S.zip || []).find((x) => x.id === id);
    if (!z || S.zipStato.has(id)) return;
    if (z.troppo || z.byte > ZIP_MAX) { avviso("Troppo grande per il telefono: scaricala sul PC", "err"); return; }
    S.zipStato.set(id, 0); render();
    try {
      const parti = [];
      let n = 1, size = 0, tot = 0;
      const entro = Date.now() + 120e3 + perRete(z.byte * 4 / 3);
      for (let i = 0; i < n; i++) {
        const d = await pezzo(() => chiedi("registrazione", { zip: id, i }, 40e3 + perRete(PEZZO_B64), false, { grosso: PEZZO_B64 }), entro, "Non arrivata: la rete è troppo lenta, riprova");
        if (!d || d.i !== i || typeof d.b !== "string" || !Number.isSafeInteger(d.n) || d.n < 1 || !Number.isSafeInteger(d.size) || d.size < 1 || d.size > ZIP_MAX
          || (i && (d.n !== n || d.size !== size))) throw new Error("Non arrivata bene: riprova");
        if (!i) { n = d.n; size = d.size; }
        const bin = atob(d.b), u = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
        tot += u.length; parti.push(u);
        S.zipStato.set(id, Math.round((i + 1) / n * 100)); render();
      }
      if (tot !== size || String.fromCharCode(...parti[0].subarray(0, 4)) !== "PK\x03\x04") throw new Error("Non arrivata bene: riprova");
      const blob = new Blob(parti, { type: "application/zip" });
      let file = null;
      try { file = new File([blob], z.nome, { type: "application/zip" }); } catch { /* un Safari vecchio: «Salva» */ }
      let puo = false;
      try { puo = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch { /* «Salva» */ }
      S.zipFile.set(id, { url: URL.createObjectURL(blob), file, nome: z.nome, puo });
    } catch (e) { errore(e); }
    S.zipStato.delete(id); render();
  }
  // (dentro il tocco: iOS apre il foglio di condivisione solo così)
  function condividiZip(id) {
    const f = S.zipFile.get(id);
    if (!f || !f.file) return;
    navigator.share({ files: [f.file] }).catch((e) => {
      if (e && e.name === "AbortError") return;   // chiuso dal medico
      f.puo = false;
      avviso("Condivisione non riuscita: usa «Salva»", "err");
    });
  }
  function cancellaZip(id) {
    const ora = Date.now();
    if (!S.zipArma || S.zipArma.id !== id || ora - S.zipArma.ts > 6000) {
      S.zipArma = { id, ts: ora };
      setTimeout(() => { if (S.zipArma && S.zipArma.id === id && Date.now() - S.zipArma.ts >= 6000) { S.zipArma = null; render(); } }, 6100);
      render();
      return;
    }
    if (ora - S.zipArma.ts < 800) return;   // un doppio tocco per sbaglio è un tocco solo
    S.zipArma = null;
    const via = () => {
      S.zip = (S.zip || []).filter((x) => x.id !== id);
      const f = S.zipFile.get(id);
      if (f) { try { URL.revokeObjectURL(f.url); } catch { /* già via */ } S.zipFile.delete(id); }
    };
    S.occupato.add("zipvia" + id); render();
    scrivi("registrazioneVia", { zip: id }, TEMPO, via, "Cancellata dal PC")
      .then(() => { via(); avviso("Cancellata dal PC"); }, (e) => { if (e.inviata) avviso("Non so se è cancellata: aspetto il PC", "err", true); else errore(e); })
      .finally(() => { S.occupato.delete("zipvia" + id); render(); });
  }

  // «Cancella tutto»: tutte le registrazioni dell'elenco, due tocchi come per una sola
  function cancellaTutte() {
    const ora = Date.now();
    if (!S.zipArma || S.zipArma.id !== "*" || ora - S.zipArma.ts > 6000) {
      S.zipArma = { id: "*", ts: ora };
      setTimeout(() => { if (S.zipArma && S.zipArma.id === "*" && Date.now() - S.zipArma.ts >= 6000) { S.zipArma = null; render(); } }, 6100);
      render();
      return;
    }
    if (ora - S.zipArma.ts < 800) return;
    S.zipArma = null;
    const via = () => {
      for (const f of S.zipFile.values()) try { URL.revokeObjectURL(f.url); } catch { /* già via */ }
      S.zipFile.clear(); S.zip = [];
    };
    S.occupato.add("zipvia*"); render();
    scrivi("registrazioneVia", { zip: "*" }, TEMPO, via, "Cancellate dal PC")
      .then(() => { via(); avviso("Cancellate dal PC"); }, (e) => { if (e.inviata) avviso("Non so se sono cancellate: aspetto il PC", "err", true); else errore(e); })
      .finally(() => { S.occupato.delete("zipvia*"); render(); });
  }

  // ------------------------------------------------- il QR, inquadrato qui
  // L'app della schermata Home dell'iPhone ha una memoria sua, separata da
  // Safari: il QR inquadrato con la Fotocamera si apre in Safari, e la chiave
  // qui non arriva. Così si inquadra anche da qui: la fotocamera nella pagina,
  // un decodificatore (jsqr.min.js, caricato solo adesso), e un link del ponte
  // di questo stesso sito fa la strada di un link aperto (la pagina riparte col
  // frammento: le regole di sempre, «Usa il codice …» compreso). La
  // fotocamera si spegne appena letto il codice o chiusa la vista.
  let scan = null;   // { el, video, stream, t }
  function linkDelPonte(testo) {
    try {
      const u = new URL(testo);
      return u.origin === location.origin && u.pathname === "/ponte/" && !u.search && P.leggiFrammento(u.hash) ? u : null;
    } catch { return null; }
  }
  // Il QR di una STAZIONE DI STAMPA (la pagina «Stazione di stampa» di PS
  // Assist sul PC dell'infermeria): un link di questo sito con «#sta=…», mai
  // una chiave del telefono. Non tocca l'associazione: mostra una carta
  // («Collegala al PC?»), e «Collega» passa l'offerta al PC, nel ponte
  // cifrato. Il PC e la stazione fanno la loro chiave fra loro: il telefono
  // non può stampare né leggere niente là.
  function linkStazione(testo) {
    try {
      const u = new URL(testo);
      const q = new URLSearchParams(u.hash.replace(/^#/, ""));
      const sta = q.get("sta") || "";
      const m = /^([A-Za-z0-9_-]{87})\.([A-Za-z0-9_-]{22})\.(\d{10,15})$/.exec(sta);
      if (u.origin !== location.origin || u.pathname !== "/ponte/" || u.search || !m) return null;
      return { sta, pub: P.daB64u(m[1]), s: P.daB64u(m[2]), scade: Number(m[3]), nome: String(q.get("nome") || "").replace(/\s+/g, " ").trim().slice(0, 40) || "Stazione di stampa" };
    } catch { return null; }
  }
  async function offertaStazione(st) {
    const k = new Uint8Array(st.s.length + st.pub.length);
    k.set(st.s); k.set(st.pub, st.s.length);
    // (l'orologio della stazione non è questo: un minuto di margine; lo decide il PC)
    const scaduta = st.scade + 60e3 < Date.now();
    S.stazione = { sta: st.sta, nome: st.nome, codice: await P.codice(k), fase: !S.coppia ? "senza" : scaduta ? "errore" : "chiedi",
      testo: scaduta ? "QR scaduto: sulla stazione ne compare uno nuovo, inquadra quello" : "" };
    S.menu = false;
    render();
  }
  async function collegaStazione() {
    const st = S.stazione;
    if (!st || st.fase !== "chiedi" || S.fase !== "pronta") return;
    st.fase = "invio"; render();
    const fatto = (d) => {
      if (S.stazione !== st) return;
      const prima = st.fase === "fatto";
      st.fase = "fatto"; st.nome = d.nome || st.nome; st.codiceK = d.codice || ""; render();
      // collegata: il catalogo del PC ora dice la stazione — «Stampa: PC · Infermeria»
      // compare subito (Richieste, Ristampa, Stampa PDF), senza riaprire
      if (!prima) chiedi("richieste", {}, TEMPO, true).then((c) => { if (c) { S.catalogo = c; render(); } }, () => {});
    };
    try { fatto(await scrivi("stazioneCollega", { sta: st.sta, nome: st.nome }, 60e3, fatto, "")); }
    catch (e) { if (S.stazione === st) { st.fase = "errore"; st.testo = e.inviata ? "Non so se è collegata: guarda sul PC, ⋯ → Stampanti" : e.message; render(); } }
  }
  function foglioStazione() {
    const st = S.stazione;
    if (!st) return "";
    const corpo = st.fase === "senza" ? `<p class="stdesc">Prima associa l'iPhone al PC: sul PC <b>⋯ → iPhone → Associa l'iPhone</b>, e inquadra quel QR.</p>`
      : st.fase === "fatto" ? `<div class="stok" role="status">Collegata al PC</div><p class="stdesc">Gli ordini con «${esc(st.nome)}» stampano lì: etichette e A4.${st.codiceK ? ` Codice ${esc(st.codiceK)}, lo stesso sulla stazione e sul PC.` : ""}</p>`
      : st.fase === "errore" ? `<p class="stdesc err" role="alert">${esc(st.testo)}</p>`
      : `<p class="stdesc">Collegala al PC: gli ordini che mandi lì escono dalle stampanti di ${esc(st.nome)}, etichette e A4.</p>
        <button type="button" class="grande" data-a="stacollega" ${st.fase === "invio" || S.fase !== "pronta" ? "disabled" : ""}>${st.fase === "invio" ? "Collego…" : S.fase !== "pronta" ? "Mi collego al PC…" : "Collega"}</button>`;
    return `<div class="foglio" role="dialog" aria-modal="true" aria-label="Stazione di stampa"><button type="button" class="velo" data-a="stachiudi" aria-label="Chiudi"></button>
      <div class="pannello"><div class="capo"><b>🖨️ Stazione di stampa</b><button type="button" class="chiudi" data-a="stachiudi">${st.fase === "fatto" ? "Fatto" : "Chiudi"}</button></div>
      <div class="carta stcarta"><div class="stnome">${esc(st.nome)}</div><div class="stcod">${esc(st.codice)}</div><div class="stpiano">lo stesso codice è sotto il QR della stazione</div>${corpo}</div></div></div>`;
  }
  const decodificatore = () => (window.jsQR ? Promise.resolve() : new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "jsqr.min.js"; s.onload = ok; s.onerror = no;
    document.head.append(s);
  }));
  const senzaCamera = () => { S.camera = "Fotocamera non disponibile: inquadra il QR con la Fotocamera dell'iPhone"; render(); };
  async function apriScan() {
    if (scan) return;
    S.camera = "";
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return senzaCamera();
    const el = document.createElement("div");
    el.className = "scan";
    el.innerHTML = `<video playsinline muted></video><div class="guida" aria-hidden="true"></div><button class="ico x" aria-label="Chiudi">✕</button>`;
    const s = { el, video: el.querySelector("video"), stream: null, t: 0 };
    scan = s;
    el.querySelector(".x").addEventListener("click", chiudiScan);
    document.body.append(el);
    try {
      const [stream] = await Promise.all([md.getUserMedia({ video: { facingMode: "environment" }, audio: false }), decodificatore()]);
      if (scan !== s) { for (const t of stream.getTracks()) t.stop(); return; }
      s.stream = stream;
      s.video.srcObject = stream;
      await s.video.play().catch(() => {});
      leggiFotogrammi(s);
    } catch { if (scan === s) { chiudiScan(); senzaCamera(); } }
  }
  function leggiFotogrammi(s) {
    const tela = document.createElement("canvas"), g = tela.getContext("2d", { willReadFrequently: true });
    const giro = () => {
      if (scan !== s) return;
      const v = s.video;
      if (v.readyState >= 2 && v.videoWidth) {
        const f = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        tela.width = Math.round(v.videoWidth * f); tela.height = Math.round(v.videoHeight * f);
        g.drawImage(v, 0, 0, tela.width, tela.height);
        const img = g.getImageData(0, 0, tela.width, tela.height);
        const c = window.jsQR(img.data, img.width, img.height);
        const u = c && linkDelPonte(c.data);   // (un QR di un altro sito, o non del ponte: si ignora)
        const st = c && !u && linkStazione(c.data);
        if (st) { chiudiScan(); offertaStazione(st); return; }
        if (u) {
          chiudiScan();
          history.replaceState(null, "", u.pathname + u.hash);
          location.reload();
          return;
        }
      }
      s.t = setTimeout(giro, 150);
    };
    giro();
  }
  function chiudiScan() {
    const s = scan;
    scan = null;
    if (!s) return;
    clearTimeout(s.t);
    if (s.stream) for (const t of s.stream.getTracks()) t.stop();
    s.video.srcObject = null;
    s.el.remove();
  }
  window.addEventListener("pagehide", chiudiScan);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") chiudiScan(); });
  // «+ nota»: con un'ora dentro («11:30 tropo», «tra 2h ECG») è un promemoria, se no una cosa da fare (lo decide il PC)
  async function aggiungiProm(ep) {
    const testo = S.promTesto.trim();
    if (!testo) return;
    S.occupato.add("prom" + ep); render();
    const salvato = (riga) => { aggiornaRiga(riga); if (S.promTesto.trim() === testo) S.promTesto = ""; };
    try { salvato(await scrivi("dfAggiungi", { ep, testo }, TEMPO, salvato, "Da fare salvato sul PC")); }
    catch (e) { if (e.inviata) avviso("Non so se il Da fare è salvato: aspetto il PC", "err", true); else errore(e); }
    S.occupato.delete("prom" + ep); render();
    fuocoSu("promin");
  }
  // la spunta (o, di nuovo, la riapre) e il cestino: sempre il PC, e la riga si rifà dalla sua risposta
  async function dfComando(ep, pid, cmd, args = {}) {
    const k = "df" + pid;
    if (S.occupato.has(k)) return;
    S.occupato.add(k); render();
    try { aggiornaRiga(await scrivi(cmd, { ep, pid, ...args }, TEMPO, aggiornaRiga)); }
    catch (e) { if (e.dati) aggiornaRiga(e.dati); if (e.inviata) avviso("Non so se è salvato: aspetto il PC", "err", true); else errore(e); }
    S.occupato.delete(k); render();
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
    const oid = s.oid, quando = Date.now();
    // Senza collegamento l'ordine aspetta in coda — «In coda · 0:24» — e parte
    // appena torna. Se non parte entro 30 secondi dal tocco scade: non si
    // rimanda più, e il PC non lo farebbe comunque (porta l'ora del tocco,
    // sull'orologio del PC). Toccata la carta, si riarma.
    const info = { ep, oid, quando, paziente: p.nome, n: s.esami.size, stato: "coda",
      sel: { q: s.q, mio: s.mio, esami: [...s.esami], pacchetto: s.pacchetto, pkgDa: [...s.pkgDa] } };
    if (!pronto()) { S.coda.set(oid, info); contaCoda(); }
    S.inviati.set(ep, oid); render();
    const scaduto = () => {
      S.coda.set(oid, { ...info, stato: "scaduta" });
      S.sel.delete(ep);
      if (S.bloccati.get(ep) === oid) S.bloccati.delete(ep);
    };
    const nuovi = (d) => {
      for (const o of (d && d.ordini) || []) {
        if (!S.ordini.has(o.id)) ordineVisto(o.titolo ? o : { ...o, stato: "avvio", tono: "run", titolo: "Parte", testo: "Apro la scheda dell'ordine sul PC…", fine: false, ts: Date.now() });
      }
    };
    try {
      // (persa la risposta, quella che arriva dopo dice com'è andata: il bottone smette di aspettare)
      const d = await chiedi("ordina", { ep, oid, esami: [...s.esami], quesito: s.q.trim(), mio: s.mio, nato: Math.round(quando + S.scarto), ...(staDi() ? { dest: doveDi(ep) } : {}) }, 60e3, false, {
        rq: nuovoRq(), scade: quando + CODA_MAX,
        partita: () => { if (S.coda.delete(oid)) render(); },
        tardi: (r) => {
          if (r.ok) nuovi(r.dati); else if (r.scaduto) scaduto(); else avviso(r.errore || "Ordine non partito", "err");
          if (S.bloccati.get(ep) === oid) S.bloccati.delete(ep);
          render();
        } });
      nuovi(d);
      S.sel.delete(ep);
      if (d.avviso) avviso(d.avviso, "err");
      window.scrollTo(0, 0);
    } catch (e) {
      if ([...S.ordini.values()].some((o) => nato(o, oid))) S.sel.delete(ep);   // è lì sopra: niente allarme
      else if (e.scaduta) scaduto();   // non partito in tempo, o arrivato al PC troppo tardi: non fatto
      else if (e.tempo || e.incerto) {
        // Non si sa se è partito: la selezione se ne va e il bottone aspetta
        // la lista degli ordini dal PC. Mai un secondo ordine alla cieca.
        S.sel.delete(ep);
        S.bloccati.set(ep, oid);
        avviso("Non so se l'ordine è partito: controlla qui sopra prima di rifarlo", "err", true);
        window.scrollTo(0, 0);
        aggiornaOrdini();
      } else errore(e);
    }
    S.coda.get(oid)?.stato === "coda" && S.coda.delete(oid);
    if (S.inviati.get(ep) === oid) S.inviati.delete(ep);
    render();
  }
  const CODA_MAX = 30e3;
  let tCoda = 0;   // il conto alla rovescia delle carte «In coda»
  function contaCoda() {
    if (tCoda) return;
    tCoda = setInterval(() => {
      if (![...S.coda.values()].some((c) => c.stato === "coda")) { clearInterval(tCoda); tCoda = 0; }
      render();
    }, 1000);
  }
  // «Scaduta: non inviata», toccata: la scelta di prima torna, e il bottone chiede di nuovo conferma (un ordine nuovo)
  function riarma(oid) {
    const c = S.coda.get(oid);
    if (!c || c.stato !== "scaduta") return;
    S.coda.delete(oid);
    S.sel.set(c.ep, { ...c.sel, esami: new Set(c.sel.esami), pkgDa: new Set(c.sel.pkgDa), oid: "" });
    S.scheda = "richieste";
    if (S.vista.nome !== "paziente" || S.vista.ep !== c.ep) apriPaziente(c.ep);
    ordina(c.ep);
  }
  function codaHtml(c, lista) {
    const chi = lista ? ` · ${c.paziente || ""}` : "", cosa = c.n === 1 ? "1 esame" : `${c.n} esami`;
    if (c.stato === "coda") {
      const r = Math.max(0, Math.ceil((c.quando + CODA_MAX - Date.now()) / 1000));
      return `<div class="ord run coda" role="status"><span class="seg-o"></span><span class="c"><b>In coda · 0:${String(r).padStart(2, "0")}${esc(chi)}</b><span>${cosa}: parte appena torna il collegamento</span></span></div>`;
    }
    return `<div class="ord warn coda" role="status" data-a="riarma" data-oid="${esc(c.oid)}"><span class="seg-o">!</span><span class="c"><b>Scaduta: non inviata${esc(chi)}</b><span>${cosa} · tocca per riarmarlo</span></span>
      <button class="x" data-a="codaVia" data-oid="${esc(c.oid)}" aria-label="Chiudi">✕</button></div>`;
  }
  const codaDi = (ep) => [...S.coda.values()].filter((c) => !ep || c.ep === ep).map((c) => codaHtml(c, !ep)).join("");

  // --------------------------------------------------------------- disegno
  let tAvviso = 0;
  // `alto`: «non so se…» — in cima, sotto la testata: in fondo coprirebbe gli esami che chiede di controllare
  // `azione` ({ testo, fai }): un bottone sull'avviso, per 5 secondi («Annulla»)
  function avviso(testo, tono = "", alto = false, azione = null) {
    S.avviso = { testo, tono, alto, azione };
    clearTimeout(tAvviso);
    tAvviso = setTimeout(() => { S.avviso = null; render(); }, azione ? 5000 : tono === "err" ? 6500 : 3500);
    render();
  }
  function zitto() { clearTimeout(tAvviso); S.avviso = null; }
  // il collegamento si dice solo quando manca
  const statoPc = () => {
    const t = !inLinea() ? "Senza rete" : !S.ws || S.ws.readyState !== 1 ? "Ricollego…" : S.pari === false ? "PC assente" : "";
    return t ? `<span class="statopc" role="status"><i></i>${t}</span>` : "";
  };
  // il menu ⋯: un'emoji e poche parole, che si leggono a colpo d'occhio
  const em = (e) => `<span class="em" aria-hidden="true">${e}</span> `;
  function testata() {
    if (S.fase !== "pronta") return "";
    const suPaz = S.vista.nome === "paziente", p = suPaz ? paziente(S.vista.ep) : null, suZip = S.vista.nome === "registrazioni";
    const sx = suPaz || suZip ? `<button class="ico" data-a="indietro" aria-label="Tutti i pazienti">${ICO.indietro}</button>` : "";
    const tit = p ? `<b>${p.omonimo ? '<span class="om">⚠ </span>' : ""}${esc(chi(p))}</b>${p.prec ? "<small>Episodio precedente</small>" : ""}`
      : suZip ? "<b>Registrazioni</b>" : suPaz ? "" : S.aggiornato ? `<small>Aggiornato alle ${hhmm(S.aggiornato)}</small>` : "";
    const nome = suPaz ? `<button type="button" class="tit" data-a="indietro" aria-label="Torna alla ${S.modo === "mappa" && S.mappa ? "mappa" : "lista"}">${tit}</button>` : `<div class="tit">${tit}</div>`;
    // più PC in lista (un completo + le porte di sola lettura): si scelgono dal
    // menu. Con un PC solo niente lista: meno è meglio. L'attivo in cima.
    const ordinati = S.pcs.slice().sort((a, b) => (a.id === S.attivo ? -1 : b.id === S.attivo ? 1 : 0));
    const listaPc = S.pcs.length >= 2 ? `${ordinati.map((p) => {
      const att = p.id === (S.coppia && S.coppia.id);
      const vivo = att && S.fase === "pronta" && !!S.canale;
      const etich = p.kind === "lettura" ? "sola lettura" : "completo";
      return `<div class="pcrow${att ? " qui" : ""}"><button class="pcbtn" data-a="pc" data-id="${esc(p.id)}">${p.kind === "lettura" ? em("👁️") : em("💻")}${esc(p.nome || (p.kind === "lettura" ? "Sola lettura" : "PC"))} <small>${etich}${vivo ? " · attivo adesso" : att ? " · attivo" : ""}</small></button><button class="pcvia" data-a="pcvia" data-id="${esc(p.id)}" aria-label="Dimentica questo PC">${em("🗑️")}</button></div>`;
    }).join("")}<div class="sep"></div>` : "";
    return `<header class="top">${sx}${nome}${statoPc()}<button class="ico" data-a="menu" aria-label="Altro" aria-expanded="${S.menu}">${ICO.altro}</button>
      ${S.menu ? `<div class="menu" role="menu">
        ${listaPc}
        ${suPaz || suZip ? "" : `<button data-a="aggiornaLista">${em("🔄")}Aggiorna elenco</button>`}
        ${staDi() ? `<div class="stdove" role="group" aria-label="Stampa su"><span>Stampa su</span>${[["qui", "💻 PC"], ["stazione", "🖨️ " + staDi()]].map(([k, t]) =>
          `<button type="button" data-a="doveTel" data-d="${k}" class="${doveTel() === k ? "on" : ""}" aria-pressed="${doveTel() === k}">${esc(t)}</button>`).join("")}</div>` : ""}
        <button data-a="stampaPdf">${em("📄")}Stampa PDF${staDi() ? ` · ${esc(doveTel() === "stazione" ? staDi() : "PC")}` : ""}</button>
        ${solaLettura() ? "" : `<button data-a="scansiona">${em("🖨️")}Collega stampante</button>`}
        ${solaLettura() ? "" : `<button data-a="registrazioni"><span class="em rec" aria-hidden="true">●</span> Registrazioni</button>`}
        <button data-a="esci">${em("🚪")}Chiudi sessione</button>
        <button class="via" data-a="dimentica">${em("🗑️")}Dimentica ${S.pcs.length >= 2 ? "questo PC" : "PC"}</button>
        <div class="info">${solaLettura() ? "Sola lettura · " : ""}Associato · finché non lo scolleghi · codice ${esc(S.codice)}</div>
      </div>` : ""}</header>${solaLettura() ? solaBar() : ""}`;
  }
  // La testata quieta di un PC di sola lettura: informazione, mai un blocco. Se
  // il gestionale mostra chi è loggato, lo dice; se no, solo «Sola lettura».
  function solaBar() {
    const op = S.pcOperatore ? ` · gestionale di <b>${esc(S.pcOperatore)}</b>` : "";
    return `<div class="solabar" role="status">👁️ <span>Sola lettura${op}</span></div>`;
  }
  function piena(icona, titolo, testo, extra = "", amb = false) {
    return `<main><div class="piena"><div class="tondo${amb ? " amb" : ""}">${icona}</div><h1>${esc(titolo)}</h1>${testo}${extra}</div></main>`;
  }
  // un profilo è un gruppo di esami: l'icona di una pila, perché non sembri un esame
  const ICO_PROFILO = `<svg class="pila" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.5 1.5 5 8 8.5 14.5 5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M1.5 8 8 11.5 14.5 8M1.5 11 8 14.5 14.5 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  const PASSI = `<ol class="passi"><li>Sul PC, nel pannello: <b>⋯ → iPhone</b>.</li><li><b>Associa l'iPhone</b>: compare un QR.</li><li>Inquadralo con <b>Scansiona il QR</b>.</li></ol>`;
  // senza un'associazione buona: il QR si inquadra da qui (e, se la fotocamera non c'è, perché)
  const scansiona = (quiet = false) => `<button class="grande${quiet ? " quiet" : ""}" data-a="scansiona">Scansiona il QR</button>${
    S.camera ? `<p class="errcod" role="alert">${esc(S.camera)}</p>` : ""}`;
  function schermata() {
    const scade = S.coppia ? `<div class="piccolo">Associato · finché non lo scolleghi · codice ${esc(S.codice)}</div>` : "";
    switch (S.fase) {
      case "senza":
        return piena(ICO.croce, "PS Assist sull'iPhone", PASSI, scansiona());
      case "finita": {
        const sc = S.perche === "scaduta";
        return piena(ICO.lucchetto, sc ? "QR scaduto" : "Associazione chiusa",
          `<p>${esc(sc ? "Questo QR non vale più: dura pochi minuti." : `${S.testoFine}.`)}</p>
           <p>Per rientrare serve un QR nuovo: sul PC <b>⋯ → iPhone → Associa l'iPhone</b>.</p>`, scansiona(), true);
      }
      case "rifiutato": {
        const c = S.cambio || { testo: "", errore: "", occupato: false };
        return piena(ICO.lucchetto, "Il PC è associato a un altro telefono", "",
          `<div class="cambio"><input id="cambio" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="off" enterkeyhint="go" placeholder="Codice" aria-label="Codice" value="${esc(c.testo)}">
           <button class="grande" data-a="cambia"${c.occupato ? " disabled" : ""}>Cancella e riassocia</button>
           ${c.errore ? `<p class="errcod" role="alert">${esc(c.errore)}</p>` : ""}</div>${scansiona(true)}`, true);
      }
      case "avvio":
      case "collego":
        return `<main><div class="piena"><div class="giro"></div><h1>Mi collego al PC…</h1>${S.coppia ? `<button class="grande quiet" data-a="scansiona">Annulla e scansiona il QR</button>` : ""}</div></main>`;
      case "pc":
        if (S.pari === null && !(S.ws && S.ws.readyState === 1)) {
          return piena(ICO.pc, "Non raggiungo il ponte", "<p>Controlla la connessione del telefono: riprovo da solo.</p>",
            `<button class="grande" data-a="riapri">Riprova</button>${scansiona()}${scade}`, true);
        }
        return piena(ICO.pc, "Il PC non risponde", `<p>${S.pari ? "Il PC è sul ponte ma non risponde: riprovo da solo." : "Sul PC dell'ospedale deve essere aperto Chrome col pannello: lo aspetto, e riprovo da solo."}</p>
          <p>Se sul PC c'è un QR nuovo, inquadra quello.</p>`,
          `<button class="grande" data-a="riapri">Riprova</button>${scansiona()}${scade}`, true);
      case "altrove":
        return piena(ICO.pc, "Aperto su un altro dispositivo", "<p>Il pannello è aperto su un altro telefono o in un'altra scheda: qui si è fermato.</p>",
          `<button class="grande" data-a="riapri">Riprendi qui</button>${scansiona(true)}${scade}`);
      case "chiusa":
        // (chiusa per i 3 minuti, con l'app in sottofondo: al ritorno si riapre da sola, e
        // questa schermata non si vede nemmeno per un attimo)
        if (S.perche === "inattivo" && document.visibilityState !== "visible") return `<main><div class="piena"><div class="giro"></div></div></main>`;
        return piena(ICO.lucchetto, "Sessione chiusa", `<p>${esc(S.testoFine)}.</p>`,
          `<button class="grande" data-a="riapri">Riapri</button>${scade}`);
      default: return "";
    }
  }
  function promPill(p) {
    const l = [...(p.prom || [])].sort((a, b) => a.t - b.t);
    if (!l.length) return "";
    return `<span class="prom ${banda(l[0].t)}">${esc(oraProm(l[0].t))} ${esc(l[0].testo)}${l.length > 1 ? ` +${l.length - 1}` : ""}</span>`;
  }
  // Lo stato, come sulla riga del tabellone del PC (che lo manda già fatto):
  // il cuore, per tipo quello che aspetta col suo tempo — o ✓ se è tornato
  // tutto — e il pallino del letto. Niente quando il PC non sa; quando l'ha
  // letto, nel titolo. Grigio se la lettura è vecchia.
  function statoPaz(x) {
    if (!x) return "";
    const ora = x.vit && Number.isFinite(x.vit.ts) ? hhmm(x.vit.ts) : "";
    const cuore = x.cuore ? `<span class="cuore ${esc(x.cuore.livello)}${x.cuore.vecchio ? " vecchio" : ""}">${x.cuore.vecchio ? "♡" : "♥"}${x.cuore.vecchio && ora ? ` <span class="cuorev">${ora}</span>`
      : typeof x.cuore.fuori === "string" && x.cuore.fuori ? ` <span class="cuorev">${esc(x.cuore.fuori)}</span>` : ""}</span>` : "";
    const KTIPO = { Lab: "k-lab", ECG: "k-ecg", RX: "k-img" };
    const esami = !Array.isArray(x.esami) ? "" : x.esami.length
      ? x.esami.map((e) => `<span class="esp ${KTIPO[e.nome] || ""}"><b>${esc(e.nome)}</b>${e.t ? ` <i class="${esc(e.banda)}">${esc(e.t)}</i>` : ""}</span>`).join("") : `<span class="esp">✓</span>`;
    const letto = x.vecchio ? (/letto alle (\d{1,2}:\d{2})/.exec(x.titolo || "") || [])[1] : "";
    const segno = x.segno ? `<i class="segno ${esc(x.segno)}"></i>` : "";
    return cuore || esami || segno ? `<span class="st${x.vecchio ? " vecchio" : ""}" title="${esc(x.titolo || "")}">${cuore}${esami}${letto ? `<span class="letto">letto ${letto}</span>` : ""}${segno}</span>` : "";
  }
  // I parametri vitali che il PC ha già letto: una riga sotto il nome, i valori
  // fuori norma coloriti; un tocco apre le righe di prima (la più recente in
  // alto), un altro le chiude. Vecchi di 4 ore: grigi, e l'ora lo dice. Un PC
  // che non li manda: niente.
  function vitaliHtml(p) {
    const v = p.stato && p.stato.vit;
    if (!v || !Number.isFinite(v.ts) || !Array.isArray(v.v) || !v.v.length) return "";
    const vals = (l) => (Array.isArray(l) ? l : []).map((x) => `<span class="${esc(x.f || "")}">${esc(x.t)}</span>`).join(" · ");
    const ore = Math.floor((Date.now() - v.ts) / 3600e3), vecchio = Date.now() - v.ts > 4 * 3600e3;
    const aperto = S.vitAperti === p.ep, prima = (Array.isArray(v.storia) ? v.storia : []).slice(1).filter((r) => r && Number.isFinite(r.ts));
    const storia = aperto && prima.length ? `<div class="vitst">${prima.map((r) => `<div><b>${hhmm(r.ts)}</b> ${vals(r.v)}</div>`).join("")}</div>` : "";
    const news = Number.isFinite(v.news) ? ` · <span>NEWS2 ${v.news}</span>` : "";
    return `<div class="vit${vecchio ? " vecchio" : ""}"><button data-a="vit" aria-expanded="${aperto}"><b>${vecchio ? `Parametri di ${ore} ore fa` : `Parametri ${hhmm(v.ts)}`}</b> ${vals(v.v)}${news}</button>${storia}</div>`;
  }
  function rigaPaz(p) {
    return `<button class="paz t-${TRIAGE[p.triage] || "nessuno"}${p.spento ? " spento" : ""}" data-a="paz" data-ep="${esc(p.ep)}">
      <span class="tr"></span><span class="cor"><span class="r1"><span class="nome">${p.omonimo ? '<span class="om">⚠ </span>' : ""}${esc(p.nome || p.breve)}</span>${Number.isInteger(p.eta) ? `<span class="eta">${p.eta} anni</span>` : ""}${
        p.posto ? `<span class="posto">${esc(p.posto)}</span>` : ""}${statoPaz(p.stato)}${promPill(p)}</span>${p.nota ? `<span class="nota">${esc(p.nota)}</span>` : ""}</span></button>`;
  }
  // Un ordine, con le parole del PC: il titolo è com'è andata, l'ora una volta.
  // In una barra: quello che corre, o uno finito male (finché non lo si chiude
  // con ✕); «Ordine non completo» se non è stato confermato tutto.
  function ordineHtml(o, barra = false, sopra = false) {
    const quieto = !!o.quieto;   // esito calmo (ordine confermato dal telefono, etichette al PC): niente allarme, ambra solo nel pallino
    const segno = quieto ? "" : o.tono === "err" || o.tono === "warn" ? "!" : o.tono === "ok" ? "✓" : "";
    const male = !quieto && o.fine && (o.tono === "err" || o.tono === "warn"), monco = male && (o.tono === "err" || o.stato !== "avviso");
    const titolo = barra ? `${monco ? "Ordine non completo" : o.titolo || ""} · ${o.paziente || ""}` : o.titolo || "";
    const testo = barra && monco ? [o.titolo, o.testo].filter(Boolean).join(" · ") : o.testo || "";
    const meta = barra || /\balle \d/.test(`${o.titolo} ${o.testo}`) ? "" : hhmm(o.ts || Date.now());
    return `<div class="ord ${esc(o.tono || "run")}${quieto ? " quieto" : ""}${barra ? " ordbar" : ""}${sopra ? " sopra" : ""}" role="status"${barra ? ` data-a="paz" data-ep="${esc(o.ep)}"` : ""}>
      <span class="seg-o">${segno}</span>
      <span class="c"><b><span>${esc(titolo)}</span>${meta ? `<time>${esc(meta)}</time>` : ""}</b>${testo ? `<span>${esc(testo)}</span>` : ""}${!barra && o.dettaglio && !`${titolo} ${testo}`.includes(o.dettaglio) ? `<small>${esc(o.dettaglio)}</small>` : ""}</span>
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
    return b ? ordineHtml(b, true, !!qui) : "";
  }
  // «Stampa un PDF»: a che punto è, poi com'è andata (finita bene, se ne va da sola come un ordine)
  function stampaHtml() {
    const x = S.stampa;
    if (!x || (x.fine && x.tono === "ok" && Date.now() - x.ts > VERDE_MAX)) return "";
    const segno = x.tono === "err" || x.tono === "warn" ? "!" : x.tono === "ok" ? "✓" : "";
    return `<div class="ord ${esc(x.tono)} stampa" role="status"><span class="seg-o">${segno}</span><span class="c"><b>${esc(x.titolo)}</b>${x.testo ? `<span>${esc(x.testo)}</span>` : ""}</span>${
      x.fine ? `<button class="x" data-a="stampaVia" aria-label="Chiudi">✕</button>` : ""}</div>`;
  }
  // Le registrazioni del PC: una carta, una riga per zip
  function vistaRegistrazioni() {
    if (!S.zip) {
      if (S.zipErr && !S.occupato.has("zip")) {
        return `<main><div class="piena corta"><div class="tondo amb">${ICO.pc}</div><h1>Elenco non letto</h1><p>${esc(S.zipErr)}.</p>
          <button class="grande" data-a="zipLista">Riprova</button></div></main>`;
      }
      return `<main><div class="carica"><div class="giro"></div></div></main>`;
    }
    if (!S.zip.length) return `<main>${stampaHtml()}<div class="vuoto">Nessuna registrazione sul PC.</div></main>`;
    const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
    const giorno = (ts) => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hhmm(ts)}`; };
    const righe = S.zip.map((z) => {
      const st = S.zipStato.get(z.id), f = S.zipFile.get(z.id), armata = S.zipArma && S.zipArma.id === z.id, id = esc(z.id);
      const prendi = f ? (f.puo ? `<button class="btnmini ok" data-a="zipManda" data-id="${id}">Condividi…</button>` : `<a class="btnmini pri" href="${esc(f.url)}" download="${esc(f.nome)}">Salva</a>`)
        : `<button class="btnmini pri" data-a="zipScarica" data-id="${id}" ${st != null ? "disabled" : ""}>${st != null ? `Scarico… ${st}%` : "Scarica"}</button>`;
      return `<div class="zip" data-zip="${id}"><div class="z1"><b>${esc(giorno(z.quando || z.ts))}</b><span class="ztag${z.motivo === "auto" ? " auto" : ""}">${z.motivo === "auto" ? "automatica" : "a mano"}</span><span class="zkb">${esc(kb(z.byte))}</span></div>
        ${z.motivo === "auto" && z.errore ? `<div class="z2">${esc(z.errore)}</div>` : ""}
        <div class="z3${z.controllo ? "" : " ko"}">${z.controllo ? "Controllo superato" : `Restano ${Number(z.punti) || 0} dati da controllare`}</div>
        <div class="zbtn">${prendi}<button class="btnmini via${armata ? " arma" : ""}" data-a="zipVia" data-id="${id}" ${S.occupato.has("zipvia" + z.id) ? "disabled" : ""}>${armata ? "Cancello dal PC? Tocca di nuovo" : "Cancella"}</button></div></div>`;
    }).join("");
    const tutte = S.zip.length > 1 ? `<button class="btnmini via tutte${S.zipArma && S.zipArma.id === "*" ? " arma" : ""}" data-a="zipTutte" ${S.occupato.has("zipvia*") ? "disabled" : ""}>${
      S.zipArma && S.zipArma.id === "*" ? `Cancello tutte le ${S.zip.length} dal PC? Tocca di nuovo` : "Cancella tutto"}</button>` : "";
    return `<main>${stampaHtml()}<div class="carta zips">${righe}</div>${tutte}</main>`;
  }
  // «Triage · alle 14:32»: chi aspetta (le due aree insieme), dal più urgente e,
  // a pari colore, da chi aspetta da più tempo. Non si tocca. Via se vuoto o
  // letto più di 30 minuti fa.
  const TRIAGE_ORDINE = ["ROSSO", "ARANCIONE", "AZZURRO", "VERDE", "BIANCO"];
  function triageHtml() {
    const t = S.triage, ora = Date.now() + (S.scarto || 0);
    if (!t || !Array.isArray(t.righe) || !t.righe.length || !(t.ts > 0) || ora - t.ts > 30 * 60e3) return "";
    const prio = (r) => { const i = TRIAGE_ORDINE.indexOf(r.triage); return i < 0 ? TRIAGE_ORDINE.length : i; };
    const att = (r) => (r.arrivo > 0 ? Math.max(0, Math.round((ora - r.arrivo) / 60e3)) : null);
    const testo = (m) => (m == null ? "" : durata(m));
    const righe = [...t.righe].sort((a, b) => prio(a) - prio(b) || (att(b) ?? -1) - (att(a) ?? -1)).map((r) =>
      `<div class="paz trg t-${TRIAGE[r.triage] || "nessuno"}${r.k && S.accArma && S.accArma.id === r.k ? " armata" : ""}"><span class="tr"></span><span class="cor"><span class="r1"><span class="nome">${esc(r.nome || r.breve)}</span>${
        Number.isInteger(r.eta) ? `<span class="eta">${r.eta} anni</span>` : ""}${att(r) != null ? `<span class="att">${testo(att(r))}</span>` : ""}${
        r.area ? `<span class="ar">${esc(r.area)}</span>` : ""}</span>${r.k ? accEsito(r.k) : ""}</span>${r.k ? accBtn(r.k, r.breve || r.nome, "Accetta") : ""}</div>`).join("");
    return `<div class="lbl">Triage <span class="ora">· alle ${hhmm(t.ts - (S.scarto || 0))}</span></div><div class="carta">${righe}</div>`;
  }
  // «Accetta in ambulatorio», su una riga del Triage (con la chiave del PC: un PC più vecchio non la dà, e
  // niente bottone) o su un paziente che il PC sa ancora al triage. Due tocchi col nome, come l'ordine;
  // poi il PC — una scheda di sottofondo, la lista del triage del gestionale, la freccia della sua riga,
  // una volta — e l'esito com'è: «In ambulatorio» (e il paziente si apre, sulla Cartella), «Non
  // accettato: …», o «Incerto: controlla sul PC» (allora niente bottone: non si ripreme).
  function accBtn(id, breve, etichetta) {
    if (solaLettura()) return "";   // sola lettura: non si accetta (cambia lo stato del paziente)
    const x = S.acc.get(id), armata = S.accArma && S.accArma.id === id;
    if (x && x.esito && x.esito.tono !== "err") return "";   // (accettato, o incerto: non si ripreme)
    const t = x && x.stato ? "Accetto…" : armata ? `Accetto ${breve} in ambulatorio? Tocca di nuovo` : etichetta;
    return `<button type="button" class="btnmini acc${armata ? " arma" : ""}" data-a="accetta" data-id="${esc(id)}" ${x && x.stato ? "disabled" : ""}>${esc(t)}</button>`;
  }
  const accEsito = (id) => { const x = S.acc.get(id); return x && x.esito && x.esito.tono !== "ok" ? `<span class="accesito ${x.esito.tono}">${esc(x.esito.testo)}</span>` : ""; };
  const accPazHtml = (p) => (p.accetta && !p.prec ? `<div class="accpaz"><span class="cor"><b>Al triage</b>${accEsito(p.ep)}</span>${accBtn(p.ep, p.breve || p.nome, "Accetta in ambulatorio")}</div>` : "");
  function accChi(id) {
    const r = ((S.triage && S.triage.righe) || []).find((x) => x.k === id);
    if (r) return { args: { k: id }, nome: r.nome || r.breve || "" };
    const p = paziente(id);
    return p && p.accetta ? { args: { ep: id }, nome: p.nome || p.breve || "" } : null;
  }
  function accetta(id) {
    const x = S.acc.get(id), c = accChi(id);
    if (!c || (x && (x.stato || (x.esito && x.esito.tono !== "err")))) return;
    const ora = Date.now();
    if (!S.accArma || S.accArma.id !== id || ora - S.accArma.ts > 6000) {
      S.accArma = { id, ts: ora };
      render();
      setTimeout(() => { if (S.accArma && S.accArma.id === id && Date.now() - S.accArma.ts >= 6000) { S.accArma = null; render(); } }, 6100);
      return;
    }
    if (ora - S.accArma.ts < 800) return;   // un doppio tocco per sbaglio è un tocco solo
    S.accArma = null;
    accettaOra(id, c);
  }
  // Il numero (rq) resta finché non si sa com'è andata: rimandato (la rete), il PC risponde com'è andata e non rifà.
  async function accettaOra(id, c) {
    const x = S.acc.get(id) || { rq: "" };
    if (!x.rq) x.rq = nuovoRq();
    x.stato = "invio"; x.esito = null; S.acc.set(id, x); render();
    const si = (d) => {
      x.stato = ""; x.rq = ""; x.esito = { tono: "ok", testo: "In ambulatorio" };
      avviso(`In ambulatorio: ${c.nome}${d && d.area ? ` · ${d.area}` : ""}`);
      // adesso è fra i pazienti, e si apre come gli altri (sulla Cartella), se il medico è ancora sull'elenco
      const ep = d && d.ep, sullElenco = S.vista.nome === "lista";
      aggiornaLista(true).then(() => { if (ep && sullElenco && S.vista.nome === "lista" && paziente(ep)) { S.scheda = "cartella"; apriPaziente(ep); } });
    };
    const no = (e) => {
      x.stato = ""; x.esito = { tono: e.incerto ? "warn" : "err", testo: e.message };
      if (!e.incerto) x.rq = "";   // il PC ha detto di no (niente cliccato): un tocco nuovo è una richiesta nuova
      avviso(e.message, e.incerto ? "" : "err", !!e.incerto);
    };
    try {
      si(await chiedi("accetta", c.args, ATTESA_ACCETTA, false, { rq: x.rq, scade: Date.now() + 30e3,
        tardi: (d) => { if (d.ok) si(d.dati); else no(errDa(d)); render(); } }));
    } catch (e) {
      no(e.inviata ? Object.assign(new Error("Incerto: il PC non ha ancora risposto — controlla sul PC"), { incerto: true }) : e);
    }
    render();
  }
  // ------------------------------------------------------------ la mappa
  // Sola lettura: la stanza com'è sul PC (letti, sedie, aree), con chi sta dove.
  // La griglia è in celle; ogni misura è un multiplo della cella --u, che sta
  // nella larghezza (o, in orizzontale, nell'altezza) e non scende sotto i 10 px:
  // il pizzico la ingrandisce. Le mappe le disegna il PC; qui niente si scrive.
  const intero = (v) => (Number.isInteger(v) ? v : 0);
  const postoSuMappa = (ep) => !!S.mappa && S.mappa.mappe.some((m) => (m.posti || []).some((x) => x.ep === ep));
  function mappaScelta() {
    const l = S.mappa.mappe, per = { alta: "alta", bassa: "ps" }[S.mappa.vista];
    const eps = new Set((S.pazienti || []).filter((p) => !p.prec).map((p) => p.ep));
    return l.find((m) => m.k === S.mappaSel) || l.find((m) => m.k === per) || l.find((m) => (m.posti || []).some((x) => eps.has(x.ep))) || l[0];
  }
  function commutatore() {
    if (!S.pazienti) return "";
    const b = (m, t) => `<button class="${S.modo === m ? "on" : ""}" data-a="modo" data-m="${m}" role="tab" aria-selected="${S.modo === m}">${t}</button>`;
    const cur = S.modo === "mappa" && S.mappa ? mappaScelta() : null;
    return `<div class="seg" role="tablist">${b("lista", "Lista")}${S.mappa ? b("mappa", "Mappa") : ""}${b("dafare", "Da fare")}</div>${cur && S.mappa.mappe.length > 1
      ? `<div class="seg pic" role="tablist" aria-label="Mappa">${S.mappa.mappe.map((m) => `<button class="${m === cur ? "on" : ""}" data-a="mappasel" data-k="${esc(m.k)}" role="tab" aria-selected="${m === cur}">${esc(m.nome)}</button>`).join("")}</div>` : ""}`;
  }
  // il cognome (il «breve» del PC: «ROSSI M.»): la parola più lunga decide la misura del carattere, a capo solo fra le parole
  // sulla mappa solo il cognome (senza l'iniziale: «ROSSI M.» → «ROSSI»); con un omonimo il PC dà il nome intero, e resta
  const cognome = (p) => String(p.breve || p.nome || "").replace(/\s[A-Z]\.$/, "");
  const parolaLunga = (t) => Math.max(3, ...String(t).split(/\s+/).map((w) => w.length));
  function mappaHtml(vivi) {
    const m = mappaScelta(), per = new Map(vivi.map((p) => [p.ep, p]));
    const letti = (m.letti || []).map((l) => ({ id: String(l.id), c: intero(l.c), r: intero(l.r), w: Math.max(1, intero(l.w)), h: Math.max(1, intero(l.h)), nome: String(l.nome || ""), forma: l.forma }));
    const aree = (m.aree || []).map((a) => ({ id: String(a.id), c: intero(a.c), r: intero(a.r), w: Math.max(1, intero(a.w)), h: Math.max(1, intero(a.h)), nome: String(a.nome || "") }));
    if (!letti.length && !aree.length) return `<div class="vuoto">Questa mappa è vuota sul PC.</div>`;
    const tutti = [...letti, ...aree];
    const c0 = Math.min(...tutti.map((x) => x.c)), r0 = Math.min(...tutti.map((x) => x.r));
    const cols = Math.max(...tutti.map((x) => x.c + x.w)) - c0, rows = Math.max(...tutti.map((x) => x.r + x.h)) - r0;
    const dove = new Map();   // "letto|id" → paziente; "area|id" → [pazienti]
    // chi è al Triage (non fra i pazienti): il PC dice dove sta per chiave — di partenza la Sala attesa —, il nome è nella riga di `triage`
    const tri = new Map(((S.triage && S.triage.righe) || []).filter((r) => r && r.k).map((r) => [r.k, { ep: r.k, nome: r.nome, breve: r.breve, triage: r.triage, eta: r.eta, ospite: true }]));
    for (const [l, da] of [[m.posti || [], per], [m.ospiti || [], tri]]) for (const x of l) {
      const p = da.get(x.ep);
      if (!p) continue;
      const k = x.tipo + "|" + x.id;
      if (x.tipo === "area") dove.set(k, [...(dove.get(k) || []), p]); else if (!dove.has(k)) dove.set(k, p);
    }
    const geo = (o, n) => `data-mg="${o.c - c0},${o.r - r0},${o.w},${o.h},${n}"`;
    // (un PC che la sa modificare: ogni letto e ogni area è un bersaglio per «tieni premuto e trascina»)
    const bers = (tipo, o) => (S.mappa.modifica ? ` data-lid="${tipo}:${esc(o.id)}@${esc(m.k)}"` : "");
    const segni = (p) => {
      const s = p.stato || {}, cuore = s.cuore ? `<span class="cuore ${esc(s.cuore.livello)}${s.cuore.vecchio ? " vecchio" : ""}">${s.cuore.vecchio ? "♡" : "♥"}</span>` : "";
      return cuore || s.segno ? `<span class="mk">${cuore}${s.segno ? `<i class="segno ${esc(s.segno)}"></i>` : ""}</span>` : "";
    };
    const html = [];
    for (const a of aree) {
      const l = dove.get("area|" + a.id) || [];
      html.push(`<div class="area" ${geo(a, Math.max(parolaLunga(a.nome), 8))}${bers("area", a)} aria-label="${esc(a.nome)}"><h4>${esc(a.nome)}${l.length ? ` · ${l.length}` : ""}</h4>${l.map((p) =>
        `<button class="pa t-${TRIAGE[p.triage] || "nessuno"}${p.spento ? " spento" : ""}" data-a="${p.ospite ? "ospite" : "paz"}" data-ep="${esc(p.ep)}" title="${esc(chi(p))}"><span class="ln">${esc(cognome(p))}</span>${segni(p)}</button>`).join("")}</div>`);
    }
    for (const l of letti) {
      const p = dove.get("letto|" + l.id);
      if (!p) { html.push(`<div class="letto vuoto" ${geo(l, parolaLunga(l.nome))}${bers("letto", l)}><span class="ln">${esc(l.nome)}</span></div>`); continue; }
      const nome = cognome(p);
      html.push(`<button class="letto occ${l.forma === "barella" ? " alto" : ""} t-${TRIAGE[p.triage] || "nessuno"}${p.spento ? " spento" : ""}" ${geo(l, parolaLunga(nome))}${bers("letto", l)} data-a="${p.ospite ? "ospite" : "paz"}" data-ep="${esc(p.ep)}" title="${esc(chi(p))}">${
        l.w >= 5 && l.h >= 4 ? `<span class="lb">${esc(l.nome)}</span>` : ""}<span class="ln">${p.omonimo ? "⚠ " : ""}${esc(nome)}</span><span class="r2">${
        Number.isInteger(p.eta) ? `<span class="le">${p.eta}</span>` : ""}${segni(p)}</span></button>`);
    }
    return `<div class="mappa" id="mappa"><div class="piano" data-mp="${cols},${rows}">${html.join("")}</div></div>`;
  }
  // (la pagina non ha stili in linea — style-src 'self': le misure della mappa si mettono da qui, dopo il disegno)
  function misureMappa() {
    for (const el of $app.querySelectorAll("[data-mg]")) {
      const [x, y, w, h, n] = el.dataset.mg.split(",");
      for (const [k, v] of Object.entries({ x, y, w, h, n })) el.style.setProperty("--" + k, v);
    }
    const p = $app.querySelector(".piano");
    if (!p) return;
    const [c, r] = p.dataset.mp.split(",").map(Number), mp = p.parentElement;
    // Intera (zoom 1) sta tutta nella sua cornice: larga quanto lo schermo, mai più alta della cornice
    // (in orizzontale decide l'altezza) — niente da scorrere, né di lato né dentro. Il tocco o le due
    // dita la ingrandiscono (--zoom): solo allora scorre.
    const h = (parseFloat(getComputedStyle(mp).maxHeight) || innerHeight * 0.56) - (mp.offsetHeight - mp.clientHeight);
    const u = Math.floor(Math.min(mp.clientWidth / c, h / r) * 100) / 100;
    for (const [k, v] of Object.entries({ cols: c, rows: r, zoom: S.zoom, u0: u + "px" })) p.style.setProperty("--" + k, v);
  }
  // (girato il telefono, o cambiata la finestra: la mappa intera di nuovo nella larghezza)
  addEventListener("resize", () => { if ($app.querySelector(".piano")) misureMappa(); });
  function vistaLista() {
    if (!S.pazienti) {
      if (S.erroreLista && !S.occupato.has("lista")) {
        return `<main><div class="piena corta"><div class="tondo amb">${ICO.pc}</div><h1>Elenco non letto</h1><p>${esc(S.erroreLista)}.</p>
          <button class="grande" data-a="aggiornaLista">Riprova</button></div></main>`;
      }
      return `<main><div class="carica"><div class="giro"></div></div></main>`;
    }
    // per area, nell'ordine del gestionale (il PC li manda già in fila, con
    // l'area); un PC che non dice l'area: chi è in lista, poi chi è nella
    // stanza. Gli episodi precedenti a parte.
    const vivi = S.pazienti.filter((p) => !p.prec);
    const prec = S.pazienti.filter((p) => p.prec);
    const carta = (l) => (l.length ? `<div class="carta">${l.map(rigaPaz).join("")}</div>` : "");
    let corpo;
    if (vivi.some((p) => p.area)) {
      const aree = new Map();
      for (const p of vivi) { const a = p.area || ""; if (!aree.has(a)) aree.set(a, []); aree.get(a).push(p); }
      corpo = [...aree].map(([a, l]) => `${a ? `<div class="lbl">${esc(a)}</div>` : aree.size > 1 ? `<div class="lbl">Senza area</div>` : ""}${carta(l)}`).join("");
    } else {
      const inStanza = vivi.filter((p) => p.posto).sort((a, b) => a.posto.localeCompare(b.posto, "it", { numeric: true }));
      corpo = carta([...vivi.filter((p) => !p.posto), ...inStanza]);
    }
    if (S.modo === "dafare") corpo = dafareHtml(vivi);
    else if (S.mappa && S.modo === "mappa" && S.pazienti.length) {
      const senza = vivi.filter((p) => !postoSuMappa(p.ep));
      corpo = mappaHtml(vivi) + (senza.length ? `<div class="lbl">Senza posto</div>${carta(senza)}` : "");
    }
    if (S.modo === "dafare") return `<main>${stampaHtml()}${codaDi("")}${commutatore()}${corpo}${S.avviso && !S.avviso.alto ? "" : barraOrdini()}</main>`;
    return `<main>${stampaHtml()}${codaDi("")}${commutatore()}${S.pazienti.length ? corpo + triageHtml() + (prec.length ? `<button class="prec" data-a="precapri" aria-expanded="${S.precAperti}">Episodi precedenti (${prec.length})</button>${S.precAperti ? carta(prec) : ""}` : "")
      : `<div class="vuoto">Nessun paziente nell'elenco del PC.<br>Si riempie da solo col gestionale aperto sul PC: la lista dell'area, e la lista smart con tutto il PS.</div>${triageHtml()}`}
      ${S.avviso && !S.avviso.alto ? "" : barraOrdini()}</main>`;
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
  // Il PC conosce il paziente solo dalla lista smart: della sua pagina non ha ancora l'indirizzo (lo dà la
  // riga della lista della sua area, mai costruito; e l'area la cambia il medico, sul PC). Una riga: cosa fare.
  const soloSmart = (p, per = "") => `Il PC lo conosce solo dalla lista smart: ${per}apri una volta la lista ${p.area ? `«${p.area}»` : "della sua area"} nel gestionale.`;
  function vistaEsiti(p) {
    const e = S.esiti.get(p.ep);
    const carica = S.occupato.has("esiti" + p.ep), legge = S.occupato.has("valori" + p.ep), lg = S.legge.get(p.ep);
    if (!e) return carica ? `<div class="carica"><div class="giro"></div></div>` : `<div class="vuoto">Esiti non caricati.</div>`;
    // senza la sua pagina sul PC: niente di salvato, e niente da leggere — una riga, che dice cosa fare
    if (e.mai && !e.tabella) return `<div class="vuoto stretto">${esc(soloSmart(p))}</div>`;
    // quando li ha letti il PC: dopo un'ora, in ambra
    const letti = e.tabella && e.letto ? `<small class="letti${Date.now() - e.letto > 60 * 60e3 ? " amb" : ""}">Letti sul PC ${alle(e.letto)}</small>` : "";
    // (come sul PC: quanti valori sono nuovi dall'ultima volta che il medico li ha guardati)
    const nuovi = e.tabella && Number(e.valoriNuovi) > 0 ? `<small class="nuovo">● ${e.valoriNuovi === 1 ? "1 nuovo" : `${Number(e.valoriNuovi)} nuovi`}</small>` : "";
    // una lettura sul PC che sta andando — col tocco, o da sé —: una riga con l'ora in cui è partita
    const leggo = legge ? `<small class="leggo" role="status">${lg && lg.modo === "apri" ? "Apro sul PC…" : lg && lg.modo === "auto" ? "Leggo i valori nuovi sul PC…" : "Leggo sul PC…"}${
      lg && lg.modo && e.dopoOrdine ? " dopo l'ordine" : ""} · ${hhmm(lg ? lg.dal : Date.now())}</small>` : "";
    const non = !legge && S.nonLetti.get(p.ep) ? `<small class="amb">Non letti da soli: ${esc(S.nonLetti.get(p.ep))}</small>` : "";
    const valori = `<div class="carta val-lab"><div class="sezt"><div class="tv">${letti}${nuovi}${leggo}${non}</div>
        <button class="agg lab" data-a="valori" ${legge ? "disabled" : ""}>↻ Rileggi</button></div>
      ${e.tabella ? tabellaHtml(e.tabella) : legge ? "" : `<div class="vuoto stretto">${e.lab === false ? "Nella sua pagina non ci sono prelievi." : "Valori non ancora letti sul PC: ↻ Rileggi li legge."}</div>`}</div>`;
    // i referti del laboratorio (emogas, emocromo…) non fra ECG, immagini e visite: a parte, in fondo
    // (con la tabella dei valori il PC non li manda: lì quello che dicono c'è già)
    const lab = e.referti.filter((r) => r.tipo === "lab"), altri = e.referti.filter((r) => r.tipo !== "lab");
    const carta = (l) => (l.length ? `<div class="carta">${l.map((r) => {
      const aperto = S.aperti.has(r.id);
      return `<div class="refw${["lab", "ecg", "img"].includes(r.tipo) ? " k-" + r.tipo : ""}"><button class="ref${r.pdf ? " conpdf" : ""}" data-a="referto" data-id="${esc(r.id)}" aria-expanded="${aperto}"><span class="r1"><span class="q">${esc(r.quando)}</span><span class="t">${esc(r.titolo)}</span>${r.nuovo ? `<span class="nuovo">nuovo</span>` : ""}</span>${
        aperto ? (r.testo ? `<div class="testo">${esc(r.testo)}</div>` : `<div class="manca">${r.lungo ? "Testo troppo lungo per il telefono: leggilo sul PC."
          : r.soloPdf ? (r.pdf ? "Di TC, ecografie e visite c'è il PDF, non il testo: tocca «PDF»." : "Di TC, ecografie e visite c'è il PDF, non il testo: sul PC non è ancora salvato.")
          : legge ? "Lo leggo sul PC…" : "Testo non ancora letto sul PC: ↻ Rileggi lo prende."}</div>`) : ""}</button>${
        r.pdf ? `<button class="prn" data-a="stampaRef" data-id="${esc(r.id)}" aria-label="Stampa il referto" ${S.stampa && !S.stampa.fine ? "disabled" : ""}>🖨️</button><button class="pdf" data-a="pdf" data-id="${esc(r.id)}" data-n="${Number(r.pdf) || 0}" ${S.occupato.has("pdf" + r.id) ? "disabled" : ""}>PDF</button>` : ""}</div>`;
    }).join("")}</div>` : "");
    return `${valori}${carta(altri)}${lab.length ? `<div class="lbl">Laboratorio</div>${carta(lab)}` : ""}${e.nota ? `<p class="piede">${esc(e.nota)}</p>` : ""}`;
  }
  function vistaRichieste(p) {
    const c = S.catalogo;
    if (!c) return `<div class="carica"><div class="giro"></div></div>`;
    if (p.prec) return `<div class="vuoto">Episodio precedente: per ordinare apri quello di oggi.</div>`;
    if (!p.ordina) return `<div class="vuoto">${esc(soloSmart(p, "per ordinare, "))}</div>`;
    const s = selDi(p.ep);
    // sul telefono solo i quesiti che sono un pacchetto di esami, coi nomi corti (in una riga)
    const BREVE = { "dolore toracico": "Dol th", "dolore addominale": "Dol add" };
    const quesiti = c.quesiti.filter((q) => c.pacchetti.some((x) => x.q === q && x.esami.length)).map((q) => {
      const on = s.pacchetto === q;
      return `<button class="chip${on ? " on" : ""}" data-a="quesito" data-q="${esc(q)}" aria-pressed="${!!on}" aria-label="${esc(q)}">${esc(BREVE[q.toLowerCase()] || q)}</button>`;
    }).join("");
    const gruppi = c.gruppi.map((g) => `<div class="gruppo"><h3>${esc(g.nome)}</h3>${g.profili.length ? `<div class="chips">${g.profili.map((pr, i) => {
      const on = pr.esami.every((k) => s.esami.has(k));
      return `<button class="chip prof${on ? " on" : ""}" data-a="profilo" data-g="${esc(g.nome)}" data-i="${i}">${ICO_PROFILO}${esc(pr.nome)}</button>`;
    }).join("")}</div>` : ""}<div class="griglia">${g.esami.map((k) => `<button class="esame${s.esami.has(k) ? " on" : ""}" data-a="esame" data-k="${esc(k)}">${esc(c.nomi[k] || k)}</button>`).join("")}</div></div>`).join("");
    return `<div class="carta q-w"><input id="quesito" type="text" enterkeyhint="done" autocomplete="off" placeholder="Quesito diagnostico" value="${esc(s.q)}"><div class="chips">${quesiti}</div></div>
      <div class="carta">${gruppi}</div>${ristampeHtml(p)}`;
  }
  // La stazione di stampa collegata al PC (il suo nome) e dove vanno i fogli:
  // la scelta del PC, o quella toccata qui per questo ordine.
  const staDi = () => (S.catalogo && S.catalogo.stampa && S.catalogo.stampa.stazione) || "";
  // La stampante predefinita DEL TELEFONO (⋯ → «Stampa su»), per PC associato: il PC o la
  // stazione. Non scelta: quella del PC (il catalogo). Senza stazione: sempre il PC.
  const DOVE = "psassist.ponte.dove.v1", doveMem = {};   // (doveMem: se la memoria del telefono non c'è, vale finché l'app è aperta)
  function doveTel() {
    if (!staDi()) return "qui";
    const id = S.coppia && S.coppia.id;
    let x = doveMem[id] || "";
    try { x = x || (JSON.parse(localStorage.getItem(DOVE) || "null") || {})[id] || ""; } catch { /* solo quella del PC */ }
    if (x === "qui" || x === "stazione") return x;
    return S.catalogo && S.catalogo.stampa && S.catalogo.stampa.dove === "stazione" ? "stazione" : "qui";
  }
  function scegliDoveTel(d) {
    const id = S.coppia && S.coppia.id, v = d === "stazione" ? "stazione" : "qui";
    doveMem[id] = v;
    try { const o = JSON.parse(localStorage.getItem(DOVE) || "null") || {}; o[id] = v; localStorage.setItem(DOVE, JSON.stringify(o)); } catch { /* solo in memoria */ }
    render();
  }
  const doveDi = (ep) => selDi(ep).dove || doveTel();
  function doveHtml(p) {
    const nome = staDi();
    if (!nome) return "";
    const d = doveDi(p.ep), b = (k, t) => `<button type="button" data-a="dove" data-d="${k}" class="${d === k ? "on" : ""}" aria-pressed="${d === k}">${esc(t)}</button>`;
    return `<div class="dove" role="group" aria-label="Dove stampano i fogli"><span>Stampa</span>${b("qui", "PC")}${b("stazione", nome)}</div>`;
  }
  function ctaHtml(p) {
    if (S.scheda === "cartella") return ctaCartella(p);
    if (S.scheda === "terapia") return S.terapiaSi ? ctaTerapia(p) : "";
    if (S.scheda !== "richieste" || !S.catalogo || !p.ordina || p.prec) return "";
    const s = selDi(p.ep), n = s.esami.size, c = S.catalogo;
    // sola lettura: il catalogo si guarda, ma da questo PC non si ordina
    if (solaLettura()) return n ? `<div class="cta"><div class="perche">${em("👁️")}Sola lettura · su questo PC non si ordina</div></div>` : "";
    const rx = [...s.esami].some((k) => c.rx.includes(k)), lab = [...s.esami].some((k) => !c.rx.includes(k));
    const nTxt = n === 1 ? "1 esame" : `${n} esami`;
    const occupato = S.inviati.has(p.ep), bloccato = S.bloccati.has(p.ep);
    const armato = S.arma && S.arma.ep === p.ep;
    if (!n && !occupato && !bloccato && !armato) return "";   // niente da confermare: niente barra (compare scegliendo un esame)
    // (due pazienti con lo stesso cognome: il ⚠ anche qui, e il nome col suo segno)
    // (armato: due righe — che cosa, e per chi: il nome intero, l'età e il posto, che guardano dal paziente sbagliato)
    const etichetta = armato ? `<span class="l1">Ordino ${nTxt} · tocca di nuovo</span><span class="l2">${p.omonimo ? "⚠ " : ""}${esc(chi(p))}</span>`
      : esc(occupato ? (S.coda.has(S.inviati.get(p.ep)) ? "In coda…" : "Mando l'ordine al PC…") : bloccato ? "Controllo gli ordini sul PC…"
        : `Conferma e stampa · ${nTxt}${staDi() && doveDi(p.ep) === "stazione" ? ` → ${staDi()}` : ""}`);
    const perche = bloccato ? "Prima di un altro ordine, il PC dice se quello di prima è partito"
      : n && !s.q.trim() ? "Scrivi il quesito diagnostico" : rx && lab ? "Laboratorio e radiologia in richieste separate: il PC le conferma e le stampa tutte" : "";
    const nomi = [...s.esami].map((k) => c.nomi[k] || k).join(", ");
    return `<div class="cta">${n ? `<div class="sel">${esc(nomi)}</div>${doveHtml(p)}` : ""}<button id="ordina" data-a="ordina" class="${armato ? "arma" : ""}" ${occupato || bloccato ? "disabled" : !n || !s.q.trim() ? "aria-disabled=\"true\"" : ""}>${etichetta}</button>${
      perche ? `<div class="perche">${esc(perche)}</div>` : ""}</div>`;
  }
  // «Da fare», come sul PC: una lista sola, ogni voce con la sua spunta tonda, l'ora (se c'è) davanti e il testo;
  // spuntata resta lì, barrata, finché il PC non la toglie (5 minuti) o non si preme il suo cestino. Un solo campo, «+ nota».
  const CESTINO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  const FATTO_MS = 5 * 60e3;   // come sul PC: una voce spuntata resta 5 minuti
  // (un PC che non manda `df`: la nota e i promemoria di prima, in lettura)
  function vociDf(p) {
    const l = Array.isArray(p.df) ? p.df : [...(p.nota ? [{ id: "nota", testo: p.nota, t: null, fatto: null }] : []), ...(p.prom || []).map((x) => ({ id: x.id, testo: x.testo, t: x.t, fatto: null }))];
    return l.filter((x) => !x.fatto || Date.now() + S.scarto - x.fatto <= FATTO_MS);
  }
  function rigaDf(x, ep) {
    const id = esc(x.id), e = esc(ep), occ = (S.occupato.has("df" + x.id) || solaLettura()) ? " disabled" : "";   // sola lettura: si vede, non si spunta né si cancella
    return `<div class="promr dfr${x.fatto ? " fatta" : ""}"><button type="button" class="dfck" role="checkbox" aria-checked="${x.fatto ? "true" : "false"}" data-a="dfck" data-ep="${e}" data-pid="${id}" aria-label="${esc(x.testo)}"${occ}></button>${
      x.t != null ? `<span class="quando ${x.fatto ? "" : banda(x.t)}">${esc(oraProm(x.t))}</span>` : ""}<span class="cosa">${esc(x.testo)}</span>${
      x.fatto ? `<button type="button" class="dfx" data-a="dftogli" data-ep="${e}" data-pid="${id}" aria-label="Cancella ${esc(x.testo)}"${occ}>${CESTINO}</button>` : ""}</div>`;
  }
  // La riga sotto il nome: la voce aperta più vicina (prima i promemoria, per ora) e quante altre — «○ 11:30 ecg di controllo · +2»;
  // senza voci, «○ + nota» (da un episodio precedente, niente). Un tocco apre la lista col campo «+ nota».
  function dfRiga(p) {
    const l = vociDf(p).filter((x) => !x.fatto).sort((a, b) => (a.t != null ? 0 : 1) - (b.t != null ? 0 : 1) || (a.t || 0) - (b.t || 0));
    if (!l.length && p.prec) return "";
    const x = l[0];
    return `<button type="button" class="dfriga${x ? "" : " vuota"}" data-a="dfapri" aria-label="Da fare"><span class="t">○ ${x ? `${x.t != null ? `<span class="q ${banda(x.t)}">${esc(oraProm(x.t))}</span> ` : ""}${esc(x.testo)}` : "+ nota"}</span>${
      l.length > 1 ? `<span class="pi">· +${l.length - 1}</span>` : ""}</button>`;
  }
  // il foglio: la lista del paziente con le sue spunte, e il campo «+ nota»
  function foglioDf(p) {
    const righe = vociDf(p).map((x) => rigaDf(x, p.ep)).join("");
    const add = p.prec ? "" : solaLettura() ? `<div class="sola-nota">${em("👁️")}Sola lettura · i Da fare di questo PC non si cambiano da qui.</div>`
      : `<div class="addprom"><input id="promin" type="text" enterkeyhint="done" autocomplete="off" placeholder="+ nota" value="${esc(S.promTesto)}" aria-label="Nuova nota: con un'ora («11:30 tropo», «tra 2h ECG») è un promemoria" ${S.occupato.has("prom" + p.ep) ? "disabled" : ""}></div>`;
    return `<div class="foglio" role="dialog" aria-modal="true" aria-label="Da fare"><button type="button" class="velo" data-a="dfchiudi" aria-label="Chiudi"></button>
      <div class="pannello" data-k="df"><div class="capo"><b>Da fare · ${esc(p.breve || p.nome)}</b><button type="button" class="chiudi" data-a="dfchiudi">Chiudi</button></div>
      <div class="carta note">${righe ? `<div class="proms">${righe}</div>` : ""}${add}</div></div></div>`;
  }
  // Le allergie, con le parole del PC («Allergie: nega», «non compilate», «non lette», o il testo): sotto il nome, in rosso se c'è un testo
  const allergieHtml = (p, cl = "alle") => (p && p.allergie && typeof p.allergie.t === "string" && p.allergie.t ? `<div class="${cl}${p.allergie.k === "ros" ? " ros" : ""}">${esc(p.allergie.t)}</div>` : "");
  // «Da fare» sulla schermata principale: le voci di tutti i pazienti, per paziente (cognome e posto: un tocco apre il
  // paziente), prima i promemoria per ora, poi le cose da fare, poi quelle appena spuntate. Niente pazienti vuoti.
  function dafareHtml(vivi) {
    const gruppi = vivi.map((p) => ({ p, l: vociDf(p).sort((a, b) => (a.fatto ? 1 : 0) - (b.fatto ? 1 : 0) || (a.t != null ? 0 : 1) - (b.t != null ? 0 : 1) || (a.t || 0) - (b.t || 0)) })).filter((g) => g.l.length);
    if (!gruppi.length) return `<div class="vuoto">Niente da fare.</div>`;
    return gruppi.map(({ p, l }) => `<div class="carta dfg"><button class="dfhd" data-a="paz" data-ep="${esc(p.ep)}"><b>${p.omonimo ? "⚠ " : ""}${esc(cognome(p))}</b>${p.posto ? `<span class="posto">${esc(p.posto)}</span>` : ""}</button><div class="proms">${l.map((x) => rigaDf(x, p.ep)).join("")}</div></div>`).join("");
  }
  function vistaPaziente() {
    const p = paziente(S.vista.ep);
    if (!p) return `<main><div class="vuoto">Questo paziente non è più nell'elenco del PC.</div></main>`;
    const ordini = codaDi(p.ep) + ordiniDi(p.ep).map((o) => ordineHtml(o)).join("");
    const tab = (s, t) => `<button class="${S.scheda === s ? "on" : ""}" data-a="scheda" data-s="${s}" role="tab" aria-selected="${S.scheda === s}">${t}</button>`;
    const ter = S.terapiaSi && S.scheda === "terapia";
    return `<main>${allergieHtml(p)}${dfRiga(p)}${vitaliHtml(p)}${accPazHtml(p)}${barraOrdini(p.ep)}${stampaHtml()}<div class="seg" role="tablist">${tab("richieste", "Richieste")}${tab("esiti", "Esiti")}${tab("cartella", "Cartella")}${S.terapiaSi ? tab("terapia", "Terapia") : ""}</div>
      ${ordini}${S.scheda === "esiti" ? vistaEsiti(p) : S.scheda === "cartella" ? vistaCartella(p) : ter ? vistaTerapia(p) : vistaRichieste(p)}</main>${ctaHtml(p)}${
      S.eoSheet && S.scheda === "cartella" && S.eo ? foglioEo() : ""}${ter ? foglioTerapia(p) : ""}${S.dfFoglio ? foglioDf(p) : ""}`;
  }
  // La cartella: i campi della pagina del paziente sul PC, ognuno com'è là.
  // Si scrive dove il gestionale lascia scrivere; il resto si legge e basta.
  // sopra l'esame obiettivo, e solo lì: i suoi EO di base per nome, poi «Altri…» (Casi e Frasi, in un foglio)
  function eoHtml(p) {
    if (!S.eo) return "";
    const basi = S.eo.filter((v) => v.gruppo === "base"), altri = S.eo.some((v) => v.gruppo !== "base");
    const a = S.eoAnnulla && S.eoAnnulla.ep === p.ep ? S.eoAnnulla : null;
    return `<div class="chips eoc" role="group" aria-label="Esami obiettivi salvati">${basi.map((v) => `<button type="button" class="chip" data-a="eo" data-k="${esc(v.k)}">${esc(v.nome)}</button>`).join("")}${
      altri ? `<button type="button" class="chip" data-a="eoaltri">Altri…</button>` : ""}</div>${
      a ? `<div class="eoann" role="status"><span>Inserito: ${esc(a.nome)}</span><button type="button" data-a="eoannulla">Annulla</button></div>` : ""}`;
  }
  // il foglio di «Altri…»: i Casi e le Frasi, ognuno col nome e la prima riga; la ricerca solo se sono tanti
  function foglioEo() {
    const altri = (S.eo || []).filter((v) => v.gruppo !== "base"), lungo = altri.length > 15, q = S.eoQ.trim().toLowerCase();
    const vis = lungo && q ? altri.filter((v) => (v.nome + " " + v.testo).toLowerCase().includes(q)) : altri;
    const gruppo = (g, titolo) => {
      const l = vis.filter((v) => v.gruppo === g);
      return l.length ? `<div class="lbl">${titolo}</div><div class="carta">${l.map((v) => `<button type="button" class="voce" data-a="eo" data-k="${esc(v.k)}"><b>${esc(v.nome)}</b><span>${esc(v.testo.replace(/\s+/g, " ").slice(0, 100))}</span></button>`).join("")}</div>` : "";
    };
    return `<div class="foglio" role="dialog" aria-modal="true" aria-label="Altri esami obiettivi"><button type="button" class="velo" data-a="eochiudi" aria-label="Chiudi"></button>
      <div class="pannello"><div class="capo"><b>Esame obiettivo</b><button type="button" class="chiudi" data-a="eochiudi">Chiudi</button></div>${
      lungo ? `<input id="eocerca" type="search" enterkeyhint="search" autocomplete="off" placeholder="Cerca" aria-label="Cerca fra i casi e le frasi" value="${esc(S.eoQ)}">` : ""}${
      gruppo("casi", "Casi")}${gruppo("frasi", "Frasi")}${vis.length ? "" : `<div class="vuoto">Niente trovato.</div>`}</div></div>`;
  }
  function vistaCartella(p) {
    const c = S.cartelle.get(p.ep);
    const legge = S.occupato.has("cartella" + p.ep), salva = S.occupato.has("csalva" + p.ep);
    if (!c) return legge ? `<div class="carica"><div class="giro"></div></div>` : `<div class="vuoto">Cartella non letta.</div>`;
    const b = S.cbozze.get(p.ep) || new Map();
    const letto = c.letto ? `<small class="letti${Date.now() - c.letto > 60 * 60e3 ? " amb" : ""}">Letto sul PC ${alle(c.letto)}</small>` : "";
    const campi = CARTELLA.map(([nome, etichetta]) => {
      const x = c.campi.find((y) => y.nome === nome);
      if (!x) return "";
      const chiuso = x.ro || p.prec || solaLettura();   // sola lettura: la cartella si legge, non si scrive
      return `<label class="cc${chiuso ? " ro" : ""}"><span>${esc(etichetta)}</span>${nome === CAMPO_EO && !chiuso && !salva ? eoHtml(p) : ""}<textarea id="cc-${nome}" rows="1" ${chiuso || salva ? "readonly" : ""} ${chiuso ? 'placeholder="—" tabindex="-1"' : ""} aria-label="${esc(etichetta)}">${
        esc(b.has(nome) ? b.get(nome).testo : x.v)}</textarea></label>`;
    }).join("");
    return `<div class="carta cartella"><div class="sezt"><div class="tv">${letto}</div>
      <button class="agg" data-a="crileggi" ${legge || salva ? "disabled" : ""}>${legge ? "Leggo sul PC…" : "↻ Rileggi"}</button></div>${campi}</div>`;
  }
  // il «Salva» della cartella, in fondo: c'è solo quando c'è qualcosa da salvare (o da dire)
  function ctaCartella(p) {
    if (solaLettura()) return "";   // sola lettura: la cartella si legge, non si salva (i campi sono di sola lettura)
    const st = S.cstato.get(p.ep), salva = S.occupato.has("csalva" + p.ep), n = cambiatiDi(p.ep).length;
    const perche = st ? `<div class="perche err" role="alert">${esc(st.testo)}</div>` : "";
    if (st && st.ricarica) return `<div class="cta"><button data-a="cricarica">Ricarica</button>${perche}</div>`;
    if (!n && !salva) return st ? `<div class="cta">${perche}</div>` : "";
    return `<div class="cta"><button data-a="csalva" ${salva ? "disabled" : ""}>${salva ? "Salvo sul PC…" : "Salva"}</button>${perche}</div>`;
  }
  // La Terapia: le terapie confermate nella pagina Terapia del gestionale, le più recenti in cima, una riga
  // ciascuna (il TERAPIA_PROG cresce; senza, l'ordine della pagina). Si legge e basta: si aggiunge con «＋ Farmaco».
  function vistaTerapia(p) {
    const l = S.terapie.get(p.ep), legge = S.occupato.has("terapie" + p.ep);
    if (!l) return legge ? `<div class="carica"><div class="giro"></div></div>` : `<div class="vuoto">Terapia non letta.</div>`;
    const letto = `<small class="letti${Date.now() - l.letto > 60 * 60e3 ? " amb" : ""}">Letto sul PC ${alle(l.letto)}</small>`;
    const righe = l.righe.map((r, i) => ({ r, i })).sort((a, b) => (Number(b.r.prog) || 0) - (Number(a.r.prog) || 0) || b.i - a.i).map(({ r }) =>
      `<div class="ter"><span class="tt"><b>${esc(r.descr)}</b>${doseTer(r) ? ` <span>${esc(doseTer(r))}</span>` : ""}</span>${r.ora ? `<span class="to">${esc(r.ora)}</span>` : ""}</div>`).join("");
    return `<div class="carta"><div class="sezt"><div class="tv">${letto}</div>
      <button class="agg" data-a="trileggi" ${legge ? "disabled" : ""}>${legge ? "Leggo sul PC…" : "↻ Rileggi"}</button></div>
      ${righe || `<div class="vuoto stretto">Nessuna terapia confermata.</div>`}</div>${p.prec ? `<p class="piede">Episodio precedente: per prescrivere apri quello di oggi.</p>` : ""}`;
  }
  function ctaTerapia(p) {
    if (solaLettura()) return "";   // sola lettura: la terapia si legge, non si prescrive
    return S.terapie.get(p.ep) && !p.prec && !S.tf ? `<div class="cta"><button data-a="tnuovo">＋ Farmaco</button></div>` : "";
  }
  // «＋ Farmaco»: prima il farmaco (i preferiti, poi la tendina del gestionale), poi la dose e il riepilogo
  function foglioTerapia(p) {
    const f = S.tf, l = S.terapie.get(p.ep);
    if (!f || f.ep !== p.ep || !l) return "";
    return `<div class="foglio" role="dialog" aria-modal="true" aria-label="Aggiungi un farmaco"><button type="button" class="velo" data-a="tchiudi" aria-label="Chiudi"></button>
      <div class="pannello" data-k="${f.passo}">${f.passo === "dose" && f.v ? doseHtml(p, f, l) : sceltaHtml(f, l)}</div></div>`;
  }
  function sceltaHtml(f, l) {
    const q = f.q.replace(/\s+/g, " ").trim().toLowerCase();
    const pref = l.pref.map((v, i) => ({ v, i })).filter(({ v }) => !q || v.descr.toLowerCase().includes(q)).slice(0, 30);
    const voce = (dati, b, s) => `<button type="button" class="voce" ${dati}><b>${esc(b)}</b>${s ? `<span>${esc(s)}</span>` : ""}</button>`;
    // due voci con la stessa scritta: dal telefono non si sceglie (sul PC sì)
    const conta = new Map();
    for (const t of f.voci || []) conta.set(t.toLowerCase(), (conta.get(t.toLowerCase()) || 0) + 1);
    const voci = [...new Set(f.voci || [])].map((t) => conta.get(t.toLowerCase()) > 1
      ? `<div class="voce no"><b>${esc(t)}</b><span>Più voci uguali nella tendina: si sceglie sul PC</span></div>`
      : voce(`data-a="tvoce" data-t="${esc(t)}"`, t, "")).join("");
    const tendina = f.cerca ? `<div class="carica"><div class="giro"></div></div>`
      : f.errVoci ? `<div class="vuoto stretto">${esc(f.errVoci)}</div>`
      : f.voci && f.qVoci ? (voci ? `<div class="carta">${voci}</div>` : `<div class="vuoto stretto">Niente nella tendina per «${esc(f.qVoci)}».</div>`)
      : `<div class="vuoto stretto">Da 3 lettere cerco nella tendina della pagina Terapia sul PC.</div>`;
    return `<div class="capo"><b>Farmaco</b><button type="button" class="chiudi" data-a="tchiudi">Chiudi</button></div>
      <input id="tq" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Cerca un farmaco" aria-label="Cerca un farmaco" value="${esc(f.q)}">
      ${pref.length ? `<div class="lbl">Preferiti</div><div class="carta">${pref.map(({ v, i }) => voce(`data-a="tpref" data-i="${i}"`, v.descr, doseTer(v) || "senza dose")).join("")}</div>` : ""}
      ${q.length >= 3 || f.voci || f.cerca ? `<div class="lbl">Tendina del gestionale</div>${tendina}` : !pref.length ? tendina : ""}`;
  }
  const opzioni = (l, x, vuota) => `<option value="">${vuota}</option>` + l.map((o, i) => `<option value="${i}"${x && x.v === o.v ? " selected" : ""}>${esc(o.t)}</option>`).join("");
  function doseHtml(p, f, l) {
    const v = f.v, chiuso = !!f.stato || (f.esito && f.esito.tono !== "err");
    const dis = chiuso ? " disabled" : "";
    const altro = f.altro ? `<label class="tc"><span>Diluizione</span><select id="tdil"${dis}>${opzioni(l.opz.dil, v.dil, "—")}</select></label>
      <label class="tc"><span>Frequenza</span><input id="tfreq" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(v.freq)}"${dis}></label>
      <label class="tc"><span>Durata</span><input id="tdur" inputmode="numeric" maxlength="1" autocomplete="off" value="${esc(v.durata)}"${dis}></label>
      <label class="tc sp"><span>Continua</span><input id="tcont" type="checkbox"${v.continua ? " checked" : ""}${dis}></label>
      <label class="tc sp"><span>Al bisogno</span><input id="tbis" type="checkbox"${v.bisogno ? " checked" : ""}${dis}></label>`
      : chiuso ? "" : `<button type="button" class="piu" data-a="taltro">Altro: diluizione, frequenza, durata…</button>`;
    // (mentre il PC lavora, e dopo, niente da cambiare: né «‹ Farmaco» né «Altro»)
    return `<div class="capo">${chiuso ? "<span></span>" : `<button type="button" class="chiudi" data-a="tscegli">‹ Farmaco</button>`}<button type="button" class="chiudi" data-a="tchiudi">Chiudi</button></div>
      <div class="tnome">${esc(v.descr)}</div>
      <div class="carta tdose"><label class="tc"><span>Dose</span><input id="tqta" inputmode="decimal" maxlength="10" autocomplete="off" value="${esc(v.qta)}"${dis}></label>
        <label class="tc"><span>Unità</span><select id="tum"${dis}>${opzioni(l.opz.um, v.um, "—")}</select></label>
        <label class="tc"><span>Via</span><select id="tvia"${dis}>${opzioni(l.opz.via, v.via, "—")}</select></label>${altro}</div>
      <div class="lbl">Riepilogo</div>${riepilogoHtml(p, f)}`;
  }
  // il riepilogo e il bottone (rifatti da soli mentre si scrive la dose: un ridisegno chiuderebbe la tastiera)
  function riepilogoHtml(p, f) {
    const v = f.v, e = f.esito;
    const stato = e ? `<div class="tesito ${e.tono}" role="${e.tono === "ok" ? "status" : "alert"}">${e.tono === "ok" ? "✓ " : ""}${esc(e.testo)}</div>` : "";
    const bottoni = f.stato ? `<button type="button" class="grande" disabled>Confermo sul PC…</button>`
      : e && e.tono === "ok" ? `<button type="button" class="grande" data-a="tchiudi">Fatto</button>`
      : e && e.tono === "warn" ? `<button type="button" class="grande quiet" data-a="trileggi">↻ Rileggi la Terapia</button>`
      : `<button type="button" class="grande" data-a="tconferma">Conferma per ${p.omonimo ? "⚠ " : ""}${esc(p.breve || p.nome)}</button>`;
    return `<div class="triep"><div class="carta"><div class="tchi">${p.omonimo ? '<span class="om">⚠ </span>' : ""}${esc(chi(p))}</div><b>${esc(v.descr)}</b><div>${esc(doseTer(v) || "senza dose")}</div>${allergieHtml(p, "tall")}</div>
      ${stato}${bottoni}${e && e.tono !== "err" ? "" : `<p class="piede">Il PC preme «Conferma» nella pagina Terapia del gestionale.</p>`}</div>`;
  }
  function ritoccaRiep() {
    const p = paziente(S.vista.ep), el = document.querySelector(".triep");
    if (!p || !el || !S.tf || !S.tf.v) return;
    const t = document.createElement("div");
    t.innerHTML = riepilogoHtml(p, S.tf);
    el.replaceWith(t.firstElementChild);
  }

  // Un ridisegno sotto il dito ruberebbe il tocco (il bottone sparisce fra
  // pressione e rilascio): mentre si preme, aspetta — e, sulla mappa, finché il dito porta un nome.
  let premuto = 0, rinviato = false, disegno = false, trascino = false;
  // le azioni che senza il PC non vanno
  // (l'ordine no: senza collegamento va in coda)
  const SERVE_PC = new Set(["valori", "pdf", "aggiornaLista", "stampaPdf", "stampaRef", "dfck", "dftogli", "csalva", "cricarica", "crileggi", "registrazioni", "zipLista", "zipScarica", "zipVia",
    "trileggi", "tconferma", "accetta"]);
  function render() {
    if (premuto || trascino) { rinviato = true; return; }
    // il cursore resta dov'era: un ridisegno non deve rubare il campo a chi scrive
    const att = document.activeElement && document.activeElement.id ? document.activeElement : null;
    const fuoco = att ? { id: att.id, a: att.selectionStart, b: att.selectionEnd } : null;
    const mp = $app.querySelector(".mappa"), scorri = mp ? { x: mp.scrollLeft, y: mp.scrollTop } : null;
    const fg = $app.querySelector(".foglio .pannello"), fgy = fg ? { k: fg.dataset.k, y: fg.scrollTop } : null;   // (un foglio aperto resta dov'era)
    const corpo = S.fase === "pronta" ? (S.vista.nome === "paziente" ? vistaPaziente() : S.vista.nome === "registrazioni" ? vistaRegistrazioni() : vistaLista()) : schermata();
    disegno = true;   // (un campo tolto dal ridisegno non è un campo lasciato)
    try { $app.innerHTML = testata() + corpo + foglioStazione() + (S.avviso ? `<div class="avviso ${esc(S.avviso.tono)}${S.avviso.alto ? " alto" : ""}" role="alert"><span>${esc(S.avviso.testo)}</span>${S.avviso.azione ? `<button type="button" data-a="avvisoAz">${esc(S.avviso.azione.testo)}</button>` : ""}</div>` : ""); }
    finally { disegno = false; }
    for (const t of $app.querySelectorAll(".cc textarea")) alza(t);
    misureMappa();
    const mp2 = scorri && $app.querySelector(".mappa");
    if (mp2) { mp2.scrollLeft = scorri.x; mp2.scrollTop = scorri.y; }
    const fg2 = fgy && $app.querySelector(".foglio .pannello");
    if (fg2 && fg2.dataset.k === fgy.k) fg2.scrollTop = fgy.y;
    // Senza rete, o senza PC: in grigio quello che va chiesto al PC, e i
    // pazienti che il telefono non ha in memoria; il resto si guarda come prima.
    // Tornato il collegamento, tornano da soli.
    if (S.fase === "pronta" && !pronto()) {
      for (const el of $app.querySelectorAll("button[data-a]")) {
        const a = el.dataset.a;
        const serve = SERVE_PC.has(a) && !(a === "aggiornaLista" && el.closest(".piena")) || (a === "paz" && !S.esiti.has(el.dataset.ep));
        if (serve) { el.setAttribute("aria-disabled", "true"); el.classList.add("nopc"); }
      }
    }
    if (fuoco) {
      const el = document.getElementById(fuoco.id);
      if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(fuoco.a, fuoco.b); } catch { /* non un campo di testo */ } }
    }
  }
  // Il pizzico dentro la mappa (non su tutta la pagina): due dita cambiano `zoom`
  // (da 1 a 3) e la mappa resta ferma sotto le dita.
  {
    let d0 = 0, z0 = 1;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    $app.addEventListener("touchstart", (e) => { if (e.touches.length === 2 && e.target.closest(".mappa")) { d0 = dist(e.touches); z0 = S.zoom; } }, { passive: true });
    $app.addEventListener("touchmove", (e) => {
      const mp = e.target.closest && e.target.closest(".mappa");
      if (!mp || e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      const piano = mp.firstElementChild, prima = S.zoom;
      S.zoom = Math.min(3, Math.max(1, z0 * dist(e.touches) / d0));
      piano.style.setProperty("--zoom", S.zoom);
      const r = mp.getBoundingClientRect(), cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      mp.scrollLeft = (mp.scrollLeft + cx) * S.zoom / prima - cx; mp.scrollTop = (mp.scrollTop + cy) * S.zoom / prima - cy;
    }, { passive: false });
    $app.addEventListener("touchend", (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
    // Un tocco su un posto vuoto della mappa (non su un paziente) la ingrandisce lì; un altro la riporta intera.
    $app.addEventListener("click", (e) => {
      const mp = e.target.closest && e.target.closest(".mappa");
      if (!mp || e.target.closest("[data-a]")) return;
      const piano = mp.firstElementChild, prima = S.zoom;
      S.zoom = prima > 1.05 ? 1 : 2.2;
      piano.style.setProperty("--zoom", S.zoom);
      const r = mp.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
      mp.scrollLeft = (mp.scrollLeft + cx) * S.zoom / prima - cx; mp.scrollTop = (mp.scrollTop + cy) * S.zoom / prima - cy;
    });
  }
  // Mappa modificabile: un nome tenuto premuto (mezzo secondo) si porta su un letto o un'area; lasciato fuori dalla
  // mappa torna fra «Senza posto». Lo fa il PC, con lo stesso gesto della sua mappa; il telefono ridisegna dalla sua risposta.
  {
    let g = null;   // { ep, nome, x, y, timer, attivo, fant, su }
    const puo = () => !solaLettura() && S.modo === "mappa" && S.mappa && S.mappa.modifica && !S.occupato.has("posto");
    const fine = () => { if (!g) return; clearTimeout(g.timer); if (g.fant) g.fant.remove(); if (g.su) g.su.classList.remove("bers"); g = null;
      trascino = false; if (rinviato && !premuto) { rinviato = false; render(); } };
    const sotto = (x, y) => { const el = document.elementFromPoint(x, y); return { b: el && el.closest("[data-lid]"), mappa: !!(el && el.closest(".mappa")) }; };
    // dov'è adesso: «letto:id@mappa», «area:id@mappa», o «tray» (senza posto) — è quello che «Annulla» rimette
    const postoDi = (ep) => {
      for (const m of (S.mappa && S.mappa.mappe) || []) for (const x of [...(m.posti || []), ...(m.ospiti || [])]) if (x.ep === ep) return `${x.tipo}:${x.id}@${m.k}`;
      return "tray";
    };
    const nomeDi = (ep) => { const p = paziente(ep) || ((S.triage && S.triage.righe) || []).find((r) => r && r.k === ep); return p ? cognome(p) : "Il paziente"; };
    const nomeDove = (dove) => {
      const [, tipo, id, k] = /^(letto|area):(.+?)(?:@(\w+))?$/.exec(dove) || [];
      const m = ((S.mappa && S.mappa.mappe) || []).find((x) => x.k === k), o = m && (tipo === "letto" ? m.letti || [] : m.aree || []).find((x) => String(x.id) === id);
      return o && o.nome ? o.nome : "";
    };
    async function metti(ep, dove, annulla = false) {
      const prima = annulla ? "" : postoDi(ep);
      let fatto = false;
      S.occupato.add("posto"); render();
      try { const d = await chiedi("posto", { ep, dove }, TEMPO); if (d && Array.isArray(d.mappe) && d.mappe.length) S.mappa = d; fatto = true; }
      catch (e) { errore(e); }
      S.occupato.delete("posto"); render(); aggiornaLista(true);
      // 5 secondi per tornare com'era: «ROSSI in OBI 2 · Annulla»
      if (fatto && !annulla && prima !== dove) avviso(`${nomeDi(ep)} ${dove === "tray" ? "tolto dalla mappa" : `in ${nomeDove(dove)}`}`.trim(), "", false, { testo: "Annulla", fai: () => metti(ep, prima, true) });
    }
    $app.addEventListener("touchstart", (e) => {
      if (!puo() || e.touches.length !== 1) return;
      const el = e.target.closest && e.target.closest(".letto.occ, .pa, .paz[data-ep]");
      if (!el || !el.dataset.ep) return;
      const t = e.touches[0];
      fine();
      trascino = true;   // (un ridisegno a metà gesto toglierebbe il nome di sotto al dito)
      g = { ep: el.dataset.ep, nome: (el.querySelector(".ln, .nome") || el).textContent.replace(/\s+/g, " ").trim(), x: t.clientX, y: t.clientY, attivo: false, fant: null, su: null };
      g.timer = setTimeout(() => {
        if (!g) return;
        g.attivo = true;
        g.fant = document.createElement("div");
        g.fant.className = "fantasma"; g.fant.textContent = g.nome;
        g.fant.style.left = g.x + "px"; g.fant.style.top = g.y + "px";
        document.body.appendChild(g.fant);
        try { navigator.vibrate && navigator.vibrate(15); } catch { /* niente */ }
      }, 450);
    }, { passive: true });
    $app.addEventListener("touchmove", (e) => {
      if (!g) return;
      const t = e.touches[0];
      if (!g.attivo) { if (Math.hypot(t.clientX - g.x, t.clientY - g.y) > 10) fine(); return; }
      e.preventDefault();   // dal «tenuto premuto» in poi il dito porta il nome, la pagina non scorre
      g.fant.style.left = t.clientX + "px"; g.fant.style.top = t.clientY + "px";
      const b = sotto(t.clientX, t.clientY).b;
      if (b !== g.su) { if (g.su) g.su.classList.remove("bers"); g.su = b; if (b) b.classList.add("bers"); }
    }, { passive: false });
    const lascia1 = (e) => {
      if (!g) return;
      const a = g, t = e.changedTouches && e.changedTouches[0];
      fine();
      if (!a.attivo) return;
      e.preventDefault();   // niente tocco finto: il paziente non si apre
      if (e.type === "touchcancel" || !t) return;
      const r = sotto(t.clientX, t.clientY);
      if (r.b) metti(a.ep, r.b.dataset.lid); else if (!r.mappa) metti(a.ep, "tray");
    };
    $app.addEventListener("touchend", lascia1);
    $app.addEventListener("touchcancel", lascia1);
  }
  const lascia = () => { clearTimeout(premuto); premuto = 0; if (rinviato) { rinviato = false; render(); } };
  $app.addEventListener("pointerdown", () => { clearTimeout(premuto); premuto = setTimeout(lascia, 700); }, true);
  document.addEventListener("pointercancel", lascia, true);
  // senza ridisegnare: il bottone d'ordine mentre si scrive il quesito
  function ritoccaCta() {
    const p = paziente(S.vista.ep);
    const vecchio = document.querySelector(".cta");
    if (!p || (!vecchio && S.scheda !== "cartella")) return;
    const t = document.createElement("div");
    t.innerHTML = ctaHtml(p);
    const nuovo = t.firstElementChild;
    if (vecchio && nuovo) vecchio.replaceWith(nuovo);
    else if (vecchio) vecchio.remove();     // (la cartella: niente più da salvare)
    else if (nuovo) $app.appendChild(nuovo);
  }
  // i campi della cartella crescono col testo
  // (una riga in più solo col cursore dentro, dove si scrive)
  const alza = (t) => { t.style.height = "auto"; t.style.height = t.scrollHeight + (!t.readOnly && document.activeElement === t ? Math.round(parseFloat(getComputedStyle(t).lineHeight) || 23) : 0) + "px"; };
  $app.addEventListener("focusin", (e) => { if (e.target.matches && e.target.matches(".cc textarea")) alza(e.target); });
  $app.addEventListener("focusout", (e) => { if (e.target.matches && e.target.matches(".cc textarea")) alza(e.target); });
  const fuocoSu = (id) => { const el = document.getElementById(id); if (el) el.focus(); };

  // --------------------------------------------------------------- i gesti
  $app.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    lascia();   // il tocco è arrivato: i ridisegni rimasti in attesa, poi il gesto
    if (!b) return;
    if (b.disabled) return;
    // il bottone d'ordine è spento perché manca il quesito: il cursore va lì
    // (aria-disabled e non disabled: un bottone disabled non riceve il tocco)
    if (b.getAttribute("aria-disabled") === "true") { if (b.id === "ordina" && selDi(S.vista.ep).esami.size && !selDi(S.vista.ep).q.trim()) fuocoSu("quesito"); return; }
    const a = b.dataset.a, ep = S.vista.ep;
    if (a !== "menu" && a !== "doveTel" && S.menu) S.menu = false;   // («Stampa su»: il menu resta aperto)
    if (a === "menu") { S.menu = !S.menu; render(); }
    else if (a === "riapri") riapri();
    else if (a === "pc") attivaPc(b.dataset.id);                 // passa a un altro PC della lista
    else if (a === "pcvia") dimenticaPcId(b.dataset.id);          // «Dimentica» un PC della lista
    else if (a === "cambia") cambia();
    else if (a === "scansiona") apriScan();
    else if (a === "stacollega") collegaStazione();
    else if (a === "stachiudi") { S.stazione = null; render(); }
    else if (a === "dove") { const x = selDi(ep); x.dove = b.dataset.d === "stazione" ? "stazione" : "qui"; x.oid = ""; S.arma = null; render(); }
    else if (a === "doveTel") scegliDoveTel(b.dataset.d);
    else if (a === "stampaPdf") { render(); $pdf.click(); }
    else if (a === "stampaRef") stampaReferto(ep, b.dataset.id);
    else if (a === "stampaVia") { S.stampa = null; render(); }
    else if (a === "registrazioni") apriRegistrazioni();
    else if (a === "zipLista") caricaZip();
    else if (a === "zipScarica") scaricaZip(b.dataset.id);
    else if (a === "zipManda") condividiZip(b.dataset.id);
    else if (a === "zipVia") cancellaZip(b.dataset.id);
    else if (a === "zipTutte") cancellaTutte();
    else if (a === "paz") apriPaziente(b.dataset.ep);
    else if (a === "dfapri") { S.dfFoglio = true; render(); }
    else if (a === "dfchiudi") { S.dfFoglio = false; render(); }
    else if (a === "precapri") { S.precAperti = !S.precAperti; render(); }
    else if (a === "avvisoAz") { const az = S.avviso && S.avviso.azione; zitto(); render(); if (az) az.fai(); }
    else if (a === "accetta") accetta(b.dataset.id);
    else if (a === "modo") { S.modo = b.dataset.m === "mappa" ? "mappa" : b.dataset.m === "dafare" ? "dafare" : "lista"; try { localStorage.setItem(MODO, S.modo); } catch { /* solo in memoria */ } render(); }
    else if (a === "mappasel") { S.mappaSel = b.dataset.k; render(); }
    else if (a === "indietro") { S.vista = { nome: "lista", ep: "" }; S.arma = null; render(); aggiornaLista(); }
    else if (a === "aggiornaLista") aggiornaLista(false, true);
    else if (a === "esci") { chiedi("esci").catch(() => {}); chiusa("chiusa dall'iPhone"); }
    else if (a === "dimentica") {
      if (b.dataset.sicuro !== "1") { b.dataset.sicuro = "1"; b.textContent = "Dimentico? Servirà un QR nuovo"; return; }
      if (S.canale) chiedi("esci").catch(() => {});
      dimentica("senza");
    }
    else if (a === "vit") { S.vitAperti = S.vitAperti === ep ? "" : ep; render(); }
    else if (a === "scheda") {
      S.scheda = b.dataset.s; S.arma = null; render();
      if (S.scheda === "esiti") leggiDaSolo(ep);
      if (S.scheda === "cartella") caricaCartella(ep, !!S.cartelle.get(ep));
      if (S.scheda === "terapia") caricaTerapie(ep, !!S.terapie.get(ep));
      if (S.scheda === "richieste") caricaRistampe(ep);
    }
    else if (a === "ristampa") {
      const l = S.ristampe.get(ep), r = Array.isArray(l) ? l.find((x) => x.id === b.dataset.id) : null;
      if (r && r.et > 0 && r.fo > 0) { S.ristApri = S.ristApri && S.ristApri.ep === ep && S.ristApri.id === r.id ? null : { ep, id: r.id }; render(); }
      else ristampa(ep, b.dataset.id);
    }
    else if (a === "ristampaQ") ristampa(ep, b.dataset.id, ["etichette", "foglio"].includes(b.dataset.q) ? b.dataset.q : "tutto");
    else if (a === "trileggi") { if (S.tf && !S.tf.stato) S.tf = null; caricaTerapie(ep, false, true); }
    else if (a === "tnuovo") apriFarmaco(ep);
    else if (a === "tchiudi") { S.tf = null; render(); }
    else if (a === "tpref") scegliFarmaco((S.terapie.get(ep)?.pref || [])[Number(b.dataset.i)]);
    else if (a === "tvoce") scegliFarmaco({ descr: b.dataset.t });
    else if (a === "tscegli") { if (S.tf && !S.tf.stato) { S.tf.passo = "scegli"; S.tf.esito = null; render(); } }
    else if (a === "taltro") { if (S.tf) { S.tf.altro = true; render(); } }
    else if (a === "tconferma") confermaFarmaco(ep);
    else if (a === "csalva") salvaCartella(ep);
    else if (a === "eo") inserisciEo(b.dataset.k);
    else if (a === "eoaltri") { S.eoSheet = true; S.eoQ = ""; render(); }
    else if (a === "eochiudi") { S.eoSheet = false; render(); }
    else if (a === "eoannulla") annullaEo();
    else if (a === "cricarica") ricaricaCartella(ep);
    else if (a === "crileggi") caricaCartella(ep, false, true);
    else if (a === "valori") aggiornaValori(ep);
    else if (a === "referto") { if (S.aperti.has(b.dataset.id)) S.aperti.delete(b.dataset.id); else { S.aperti.add(b.dataset.id); refertoVisto(ep, b.dataset.id); } render(); }
    else if (a === "pdf") apriPdf(ep, b.dataset.id, Number(b.dataset.n));
    else if (a === "quesito") { scegliQuesito(ep, b.dataset.q); S.arma = null; render(); }
    else if (a === "esame") { togglaEsame(ep, b.dataset.k); S.arma = null; render(); }
    else if (a === "profilo") {
      const g = (S.catalogo?.gruppi || []).find((x) => x.nome === b.dataset.g);
      const pr = g && g.profili[Number(b.dataset.i)];
      if (pr) { togglaProfilo(ep, pr.esami); S.arma = null; render(); }
    }
    else if (a === "ordina") ordina(ep);
    else if (a === "riarma") riarma(b.dataset.oid);
    else if (a === "codaVia") { S.coda.delete(b.dataset.oid); render(); }
    else if (a === "dfck") dfComando(b.dataset.ep || ep, b.dataset.pid, "dfSpunta", { si: b.getAttribute("aria-checked") !== "true" });
    else if (a === "dftogli") dfComando(b.dataset.ep || ep, b.dataset.pid, "dfTogli");
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
    } else if (t.id.startsWith("cc-") && !t.readOnly) {
      // una bozza ricorda da che testo è partita: è quello che il PC deve avere ancora, per salvarla
      const nome = t.id.slice(3), c = S.cartelle.get(ep), x = c && c.campi.find((y) => y.nome === nome);
      if (!x || x.ro) return;
      let b = S.cbozze.get(ep);
      if (!b) S.cbozze.set(ep, b = new Map());
      b.set(nome, { base: b.has(nome) ? b.get(nome).base : x.v, testo: t.value });
      const st = S.cstato.get(ep);
      if (st && !st.ricarica) S.cstato.delete(ep);
      alza(t);
      ritoccaCta();
    } else if (t.id === "eocerca") { S.eoQ = t.value; render(); }
    else if (t.id === "tq" && S.tf) {
      S.tf.q = t.value;
      if (t.value.trim().length < 3) Object.assign(S.tf, { voci: null, qVoci: "", errVoci: "" });   // (le voci di prima non sono di queste lettere)
      render(); cercaPresto();
    }
    else if (S.tf && S.tf.v && /^t(qta|freq|dur|um|via|dil|cont|bis)$/.test(t.id)) {
      // la dose: si scrive nel foglio, e si rifà solo il riepilogo (un ridisegno chiuderebbe la tastiera)
      const v = S.tf.v, l = S.terapie.get(ep), k = { tqta: "qta", tfreq: "freq", tdur: "durata", tum: "um", tvia: "via", tdil: "dil", tcont: "continua", tbis: "bisogno" }[t.id];
      if (t.type === "checkbox") v[k] = t.checked;
      else if (t.tagName === "SELECT") v[k] = (l && t.value !== "" && l.opz[k][Number(t.value)]) || null;
      else v[k] = t.value;
      if (S.tf.esito && S.tf.esito.tono === "err") S.tf.esito = null;
      ritoccaRiep();
    }
    else if (t.id === "promin") S.promTesto = t.value;
    else if (t.id === "cambio" && S.cambio) S.cambio.testo = t.value;
  });
  $app.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.id === "promin") { e.preventDefault(); aggiungiProm(S.vista.ep); }
    else if (e.target.id === "quesito") { e.preventDefault(); e.target.blur(); }
    else if (e.target.id === "cambio") { e.preventDefault(); cambia(); }
    else if (e.target.id === "tq") { e.preventDefault(); e.target.blur(); cercaFarmaco(); }
  });
  // Tornati sull'app (iOS chiude le prese delle pagine in sottofondo): ci si
  // ricollega subito, si prova la presa, e l'elenco si rilegge da solo.
  function davanti() {
    if (document.visibilityState !== "visible" || !S.chiavi || S.fase === "altrove") return;
    // chiusa per i 3 minuti senza comandi (adesso, o mentre l'app era in
    // sottofondo): si riapre da sola, senza passare da «Sessione chiusa»
    if (scadenze() && !(S.fase === "chiusa" && S.perche === "inattivo")) return;
    if (S.fase === "chiusa" && S.perche === "inattivo") { riapri(); return; }
    S.tentativi = 0;
    collega();
    batti();
    if (S.canale && S.fase === "pronta") {
      if (S.ws && S.ws.readyState === 1 && S.pari) { rileggi(); aggiornaOrdini(); } else S.rinfresca = true;
    }
    render();
  }
  document.addEventListener("visibilitychange", davanti);
  window.addEventListener("pageshow", (e) => { if (e.persisted) davanti(); });
  // La rete torna (fuori dall'ascensore, dal wifi al 5G): la presa di prima è
  // quasi sempre morta senza saperlo — se ne apre subito un'altra, e quello
  // che aspettava riparte. Senza rete: lo dice la testata, e si aspetta.
  window.addEventListener("online", () => {
    if (!S.chiavi || S.fase === "altrove" || ["senza", "finita", "rifiutato", "conferma"].includes(S.fase)) return;
    S.tentativi = 0;
    if (S.canale && S.fase === "pronta") S.rinfresca = true;
    rifai();
    render();
  });
  window.addEventListener("offline", () => { batti(); render(); });   // la presa di prima regge? il battito lo dice
  // L'associazione non scade. La regola dei 3 minuti vale anche qui: un'app lasciata in sottofondo non
  // tiene in memoria i pazienti finché il PC non glielo dice.
  function scadenze() {
    if (S.canale && Date.now() - S.ultimo >= INATTIVO) { chiedi("esci", {}, TEMPO, true).catch(() => {}); chiusa("inattivo"); return true; }
    return false;
  }
  setInterval(() => {
    if (!scadenze() && S.fase === "pronta" && !document.activeElement?.id) render();   // i tempi dei promemoria
  }, 30e3);

  // Un QR nuovo inquadrato con l'app già aperta cambia solo il frammento: si
  // riparte da capo, e la partenza decide (anche se chiedere prima).
  window.addEventListener("hashchange", () => {
    if (P.leggiFrammento(location.hash)) { location.reload(); return; }
    const st = linkStazione(location.href);
    history.replaceState(null, "", location.pathname + location.search);
    if (st) offertaStazione(st);
  });
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});

  (async function avvia() {
    const link = location.hash ? dalLink(location.hash) : null;
    const sta = location.hash ? linkStazione(location.href) : null;   // (il QR di una stazione: una carta, dopo)
    // il frammento non resta nella barra degli indirizzi né nella cronologia
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    if (sta) setTimeout(() => offertaStazione(sta), 0);
    const { v, attivo } = leggiPcs();
    S.pcs = v; S.attivo = attivo;
    if (link && link.qrScade <= Date.now()) { S.scaduta = link.qrScade; S.perche = "scaduta"; S.fase = "finita"; render(); return; }
    if (link) {
      // lo STESSO QR già in lista: lo stesso PC, ci si ricollega (stesso dev)
      const gia = S.pcs.find((p) => stessa(p.k, link.k));
      if (gia) { S.attivo = gia.id; salvaPcs(); await parti(gia); return; }
      // un PC nuovo: entry provvisoria, si collega e il saluto decide dove va
      // (aggiunge un PC di sola lettura, sostituisce il PC completo). Non tocca
      // le altre associazioni: ognuna ha la sua chiave.
      const nuova = { k: link.k, dev: link.dev, kind: "", nome: "", id: nuovoId() };
      S.pcs = [nuova, ...S.pcs]; S.attivo = nuova.id; S.classifica = true; salvaPcs();
      await parti(nuova);
      return;
    }
    // senza QR: l'ultimo attivo (o il primo della lista), o niente
    const c = S.pcs.find((p) => p.id === S.attivo) || S.pcs[0] || null;
    if (!c) { S.perche = S.scaduta ? "scaduta" : ""; S.fase = S.scaduta ? "finita" : "senza"; render(); return; }
    S.attivo = c.id;
    await parti(c);
  })();
})();
