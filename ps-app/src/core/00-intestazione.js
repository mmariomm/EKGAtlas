//@frammento 00-intestazione.js — Intestazione (cosa fa, fatti verificati, regole di sicurezza), apertura dell'IIFE e CONFIG:
//@ VERSION, tempi, risorse (RES), pacchetti, quesiti; i segnaposto di catalogo, dimissioni ed EO (li riempie tools/build.mjs).
/*
 * PS Assist — Pronto Soccorso order helper for SA4PSO (Dedalus)
 * ============================================================
 *
 * Rebuilt from scratch (2026 re-audit of the saved SA4PSO pages).
 *
 * WHAT IT DOES
 * ------------
 * From the patient page (or the "Nuova Richiesta" / exam pages) it creates a
 * lab or radiology richiesta, fills the quesito diagnostico, adds the chosen
 * prestazioni and verifies each one landed in the cart — all driven with
 * same-origin fetch() calls that replay exactly the requests the browser
 * would send by clicking. The doctor then reviews the cart on the real page,
 * or — opt-in («+ Conferma») — the real cart page is loaded in a hidden,
 * script-less frame and its own "Conferma" button is clicked natively (the
 * confirm posts to MVPG=RcsStampaEtichetteLIS). "Confermata" is said only on
 * proof: a page of the same episode listing that richiesta's print links.
 *
 * WHY FETCH INSTEAD OF THE OLD "one exam per page reload" WALKER
 * --------------------------------------------------------------
 * The 0.x helper kept a queue in localStorage and re-entered itself after
 * every full-page reload. That design needed TTLs, in-flight markers and a
 * re-check dance to avoid double orders. Driving the server with fetch()
 * from a single page collapses all of that into one linear async function:
 * no cross-reload state, no reload of Insert URLs, and every step's response
 * is parsed and checked before the next request is sent.
 *
 * AUDITED FACTS THIS FILE RELIES ON (from the saved source pages)
 * ---------------------------------------------------------------
 * - Pages are windows-1252; POST bodies must be urlencoded in that charset.
 * - Patient page  : MVPG=PsoEpisodioClinicoAmbulatorio, has entry links
 *                   <a title="Richieste Laboratorio">, "Richieste Radiologia".
 * - Crea page     : form[name=RICHIESTACrea], method=post; fields include
 *                   QUESITO_DIAGNOSTICO (textarea), URGENZA/MODALITA/MEDICO
 *                   (server-prefilled; left untouched), hidden RICHIESTA_ID
 *                   (allocated when the page renders), submit Update="Crea".
 * - Exam page     : form[name=Prestazioni] (POST, submit Update="Conferma"),
 *                   filter select[name=RISORSA_ID] + input[name=s_PRESTAZIONE]
 *                   + submit DoSearch="Cerca". Each orderable exam is an
 *                   <a class="AFCDataLink"> whose href carries PRESTAZIONE=<code>
 *                   and either Insert=Inserisci (add) or Delete=Elimina (in
 *                   cart). A cart-wide "svuota" link also carries
 *                   Delete=Elimina but NO PRESTAZIONE param — so "in cart"
 *                   checks must require BOTH markers.
 * - The rendered list is a plain GET: swapping RISORSA_ID in the list URL
 *   switches resource; s_PRESTAZIONE filters. No pagination (146 rows max).
 * - Saved pages carry two `selected` options in some selects (server quirk);
 *   browsers keep the LAST one — serialization must do the same.
 *
 * SAFETY RULES (all enforced in code)
 * -----------------------------------
 * 1. An Insert URL is requested AT MOST ONCE. Verification re-reads the
 *    plain list URL (no Insert params); if the exam still isn't in the cart
 *    after the re-check budget, the run HARD-STOPS and says what to check.
 * 2. Every fetched page must belong to the same EPISODIO_ID the run started
 *    with; any mismatch aborts before anything else is sent.
 * 3. The final Conferma is opt-in and immediate (the doctor's click on
 *    «+ Conferma» is the decision): a native click on the EHR's own button,
 *    only when the cart equals the receipt of this run. Confirmed = proven
 *    by the EHR's page, never assumed.
 * 4. The quesito diagnostico pre-filled by triage is kept, unless the doctor
 *    typed his own in the panel (not a chip): then his text is written.
 * 5. Stop/Esc aborts in-flight work immediately (AbortController).
 * 6. No request ever leaves the hospital origin.
 */

(function () {
  "use strict";

  // ================================================================ CONFIG
  const APP = "PS Assist";
  const VERSION = "3.90.0";
  const NS = "psassist:"; // storage namespace
  // La build «mini» (PS Assist · Lettura e stampa): sola lettura. La bandiera
  // la mette sola-lettura.js, caricato prima di content.js (vedi manifest). Qui
  // niente pannello degli ordini — solo un distintivo e le letture per il
  // telefono — e ogni comando di SCRITTURA del ponte è rifiutato sul PC.
  const SOLA_LETTURA = (() => { try { return typeof self !== "undefined" && self.PSA_SOLA_LETTURA === true; } catch { return false; } })();
  // I comandi del ponte che una scheda in sola lettura esegue: letture e
  // ristampa (legge la pagina aperta e stampa, non scrive). Tutto il resto è
  // già fermato nel service worker; questo è il secondo muro, nella scheda.
  const PONTE_LETTURA_SCHEDA = new Set([
    "pazienti", "mappa", "eo", "triage", "esiti", "aggiornaValori",
    "richieste", "cartella", "terapie", "ristampe", "ristampa",
    "visto",   // (visto sul telefono: solo la memoria dell'estensione, niente nel gestionale)
    "listaChi",   // (chi il PC conosce solo dalla smart: chi è e il link della lista della sua area — una lettura, dietro)
    "pinDati", "pinApri",   // (i pin «Da rivedere»: chi è un paziente, e se il PC lo conosce — letture)
  ]);

  const TIMEOUT_MS = 20000;      // per-request timeout
  const PRESA_SCHEDA_MAX = 18e3;  // le etichette di un ordine prese col dialogo: oltre, i PDF si prendono quando servono (bg.js: PRESA_PDF_MAX = questo + TIMEOUT_MS)
  const PACE_MS = 250;           // gentle pause between consecutive requests
  // Le riletture dell'elenco prima di dire che un esame non è entrato, e la
  // pausa prima di ciascuna: un gestionale carico mette l'esame in carrello
  // anche dopo 5–10 secondi. Rileggere costa una lettura; non c'è mai un secondo invio.
  const VERIFY_WAITS = [1200, 2000, 3000, 5000, 8000];
  const VERIFY_RECHECKS = VERIFY_WAITS.length;
  // Un «ORA-» all'inserimento in una richiesta nata nel giro: un attimo, poi una richiesta nuova
  const RIFAI_MS = 2000;
  // Lo stesso, prima di arrendersi alla conferma: un carrello che arriva senza
  // una riga che deve avere si rilegge (mai un secondo clic), e la pagina del
  // paziente che non elenca ancora la richiesta confermata si rilegge prima
  // di dire «non confermata» (il LIS può metterci qualche secondo).
  const CONFIRM_WAITS = [2000, 4000, 8000];
  const CONFIRM_FLAG_TTL = 120e3;// ms an auto-confirm handoff stays valid
  // un messaggio che deve sopravvivere al cambio di pagina: quello che si è
  // deciso in sottofondo va detto sulla pagina dove il medico arriva
  const AVVISO = "avviso.v1";
  const PRINT_FLAG_TTL = 180e3;  // ms a post-confirm print handoff stays valid
  const RILEGGI_STAMPA = 4000;   // una richiesta nuova che la pagina non elenca ancora: una rilettura, dopo
  // Nella scheda di un ordine, una pagina che non è il paziente: dopo la
  // Conferma il gestionale ne attraversa (le etichette LIS, PsoEpisodio) e le
  // lascia da sé in un attimo. Se dopo questa sosta è ancora qui, è qui che la
  // scheda è rimasta: allora la stampa, o la prova della conferma.
  const SOSTA_LAVORO = 3000;
  const QUEUE_TTL = 30 * 60e3;   // ms a still-unconfirmed richiesta keeps reminding
  // Il giro in corso, annotato passo per passo. Il gestionale ricarica la
  // pagina a ogni click e il motore muore con lei: così invece riprende da
  // dov'era, e quello che era già partito non riparte MAI una seconda volta.
  const CORSA = "corsa.v1";
  const CORSA_TTL = 10 * 60e3;   // più vecchio di così non si riprende da solo
  const CORSA_MAX = 12;          // riprese massime: mai un ciclo senza fine
  // Due schede sulla stessa richiesta non devono mandare gli stessi esami.
  // L'appunto sta nella scheda (sessionStorage) e una scheda DUPLICATA se lo
  // porta dietro: il presidio invece sta in memoria condivisa, dove le schede
  // si vedono fra loro, e dice chi ci sta lavorando adesso.
  const PRESIDIO = "corsa.presidio.v1";
  const PRESIDIO_MS = 25e3;      // un segno più vecchio è di una scheda morta
  // Un giro lasciato a metà (scheda chiusa, sessione scaduta, browser caduto)
  // non deve sparire in silenzio: questo lo dice alla prima pagina utile.
  const APERTA = "corsa.aperta.v1";
  const APERTA_TTL = 30 * 60e3;
  const OK_STRISCIA = 2 * 60e3;  // un ordine finito bene resta sulla striscia due minuti
  const RIGA_FATTA = 4000;       // …la riga di un foglio stampato, pochi secondi
  // I nomi delle righe sotto la striscia, tutti qui: un'icona (ICO) e
  // l'erogatore — [etichetta] POC, [foglio] RX, [braccialetto] ×3, «Lab · 3/6»
  // —, con le parole intere per chi legge lo schermo («Etichette POC»).
  // (Cambiarli è cambiare questa tabella.)
  const NOMI_RIGA = {
    et: { ico: "etichetta", parole: "Etichette" },
    fg: { ico: "foglio", parole: "Lista esami" },
    fgRX: { ico: "foglio", parole: "Prenotazione" },
    anag: { ico: "bracciale", parole: "Etichetta anagrafica" },
    richiesta: { parole: "Richiesta" },
    chi: { POC: "POC", Lab: "Lab", RX: "RX" },   // (due laboratori: «Urg» e «Lab», dal nome della risorsa)
  };
  const COPIE_MAX = 10;          // le copie dell'etichetta anagrafica, a tocchi
  // Clic (e tocchi) di fila: uno a meno di tanto dal precedente è dello stesso
  // gruppo, e tanto dopo l'ultimo si fa — la stampa, le copie, o il PDF di un clic solo
  const CLIC_FINESTRA = 400;

  // Resources ("Risorsa" dropdown values) — verified in the saved pages.
  const RES = {
    POC:     "00660001P", // LABORATORIO ANALISI POC - SSG
    URGENZE: "00720001P", // LABORATORIO ANALISI URGENZE - SSG
    CENTRAL: "00130001P", // LABORATORIO ANALISI - SSG
    RX:      "00120001P", // RADIOLOGIA - RX - SSG
    ECO:     "00400001P", // RADIOLOGIA - ECOGRAFIA - SSG
    RMN:     "00360001P", // RADIOLOGIA - RISONANZA MAGNETICA NUCLEARE - SSG
    TAC:     "00380001P", // RADIOLOGIA - TAC - SSG
  };
  const RES_SHORT = {
    // Urgenze e laboratorio centrale, per chi ordina, sono lo stesso posto:
    // un nome solo, e nella griglia un gruppo solo
    [RES.POC]: "POC", [RES.URGENZE]: "Lab centrale", [RES.CENTRAL]: "Lab centrale",
    [RES.RX]: "RX", [RES.ECO]: "Eco", [RES.RMN]: "RMN", [RES.TAC]: "TAC",
  };

  // Quick presets shown as chips. Codes verified against the saved pages
  // (see ps-app/README.md). A preset is shown only when every code exists in
  // the catalog available on this machine (embedded + learned).
  const PRESETS = [
    { name: "Base PS",  items: [[RES.POC, "320"], [RES.POC, "325"], [RES.POC, "176"]] },          // emocromo, EGA venosa NEW, creatinina
    { name: "Epatico",  items: [[RES.URGENZE, "16"], [RES.URGENZE, "228"], [RES.URGENZE, "53"], [RES.URGENZE, "167"], [RES.URGENZE, "34"]] }, // bili reflex, GPT, GOT, GGT, lipasi
    { name: "Coag POC", items: [[RES.POC, "220"], [RES.POC, "134"], [RES.POC, "135"]] },          // PT, PTT, fibrinogeno POC
    { name: "Coag",     items: [[RES.URGENZE, "181"], [RES.URGENZE, "54"], [RES.URGENZE, "258"]] }, // PT, PTT, fibrinogeno urgenze
  ];
  // i profili che raccolgono esami che ci sono anche uno per uno: nelle
  // Richieste sono un «Epatico ▸» che li apre
  const ESPANSORI = new Set(["Epatico"]);
  const SINGLES = [ // one-tap single exams (compact grid, grouped by lab)
    [RES.POC, "320"], [RES.POC, "325"], [RES.POC, "326"], [RES.POC, "176"],
    [RES.POC, "101"], [RES.POC, "324"], [RES.POC, "30"],
    // la coagulazione POC, uno per uno: i pacchetti la mettono, e da qui si vede e si toglie
    [RES.POC, "220"], [RES.POC, "134"],
    [RES.URGENZE, "293"], [RES.URGENZE, "159"], [RES.URGENZE, "297"],
    [RES.URGENZE, "317"],
    // gli epatici: il profilo rapido li ordina insieme, ma quasi sempre se ne
    // vuole uno solo — la lipasi c'era già, gli altri quattro no
    [RES.URGENZE, "228"], [RES.URGENZE, "53"], [RES.URGENZE, "167"],
    [RES.URGENZE, "16"], [RES.URGENZE, "34"],
    [RES.CENTRAL, "212"],
    [RES.RX, "35"], [RES.RX, "36"], [RES.RX, "28"],
  ];
  // Short ward names for the UI only. The catalog label stays the source of
  // truth for the anti-wrong-exam check, so renaming here is always safe.
  const DISPLAY = {
    [`${RES.POC}:320`]: "EMOCROMO POC",
    // Il laboratorio ha rifatto gli emogas: sono i codici «- NEW». Chi ordina
    // deve vedere che è quella nuova, o non saprebbe distinguerla dalla
    // vecchia che resta in elenco.
    [`${RES.POC}:325`]: "EGA VENOSA NEW",
    [`${RES.POC}:326`]: "EGA ARTERIOSA NEW",
    [`${RES.POC}:176`]: "CREATININA POC",
    [`${RES.POC}:101`]: "D-DIMERO POC",
    [`${RES.POC}:324`]: "TROPONINA US",
    [`${RES.POC}:30`]:  "GLUCOSIO POC",
    [`${RES.POC}:220`]: "PT POC",
    [`${RES.POC}:134`]: "PTT POC",
    [`${RES.POC}:135`]: "FIBRINOGENO POC",
    [`${RES.CENTRAL}:212`]: "SARSCOV",
    [`${RES.URGENZE}:293`]: "PCR",
    [`${RES.URGENZE}:34`]:  "LIPASI",
    [`${RES.URGENZE}:228`]: "GPT",
    [`${RES.URGENZE}:53`]:  "GOT",
    [`${RES.URGENZE}:167`]: "GAMMA GT",
    [`${RES.URGENZE}:16`]:  "BILIRUBINA",
    [`${RES.URGENZE}:159`]: "PROCALCITONINA",
    [`${RES.URGENZE}:297`]: "NT PRO-BNP",
    [`${RES.URGENZE}:317`]: "ESAME URINE",
    [`${RES.RX}:35`]: "RX TORACE",
    [`${RES.RX}:36`]: "RX TORACE 1 PROIEZ.",
    [`${RES.RX}:28`]: "RX ADDOME",
  };
  // If EGA arteriosa is selected, the venosa is dropped automatically.
  const EXCLUDE = [
    { keep: [RES.POC, "326"], drop: [RES.POC, "325"], note: "EGA arteriosa sostituisce la venosa" },
    { keep: [RES.POC, "166"], drop: [RES.POC, "3"], note: "EGA arteriosa sostituisce la venosa" },
  ];

  // Common quesiti offered as one-tap chips (editable; last used are kept).
  const QUESITI_DEFAULT = [
    "Dolore toracico", "Dolore addominale", "Dispnea", "Febbre",
    "Trauma", "Sincope", "Vertigini", "Cefalea",
  ];
  // Quesito = pacchetto di esami: toccare il chip scrive il quesito E spunta
  // gli esami che per quel quesito servono quasi sempre. Stanno sempre in
  // testa ai chip, anche se l'elenco dei quesiti salvato non li ha. Un esame
  // che in questa macchina non esiste nel catalogo si salta e si dice.
  // «PT PTT Fantoli» = il laboratorio non-POC, cioè URGENZE (181 PT, 54 PTT).
  const PACCHETTI = [
    // base, coagulazione POC, troponina US, RX torace 1 proiezione (una
    // seconda richiesta, di radiologia, confermata come quella del laboratorio)
    { q: "Dolore toracico", items: [[RES.POC, "320"], [RES.POC, "325"], [RES.POC, "176"], [RES.POC, "220"], [RES.POC, "134"], [RES.POC, "324"], [RES.RX, "36"]] },
    // base ma con l'EGA ARTERIOSA (326, non la venosa 325), coag POC, D-dimero, troponina, proBNP
    { q: "Dispnea", items: [[RES.POC, "320"], [RES.POC, "326"], [RES.POC, "176"], [RES.POC, "220"], [RES.POC, "134"], [RES.POC, "101"], [RES.POC, "324"], [RES.URGENZE, "297"]] },
    // base, epatico e pancreatico (bili reflex, GPT, GOT, GGT, lipasi), PT PTT Fantoli
    { q: "Dolore addominale", items: [[RES.POC, "320"], [RES.POC, "325"], [RES.POC, "176"], [RES.URGENZE, "16"], [RES.URGENZE, "228"], [RES.URGENZE, "53"], [RES.URGENZE, "167"], [RES.URGENZE, "34"], [RES.URGENZE, "181"], [RES.URGENZE, "54"]] },
  ];

  // Embedded catalog: every exam extracted from the saved lab pages
  // (code → label per resource). Radiology lists aren't in the saved pages;
  // they are LEARNED automatically the first time the list is seen and kept
  // in localStorage, after which radiology works one-click too.
  const EMBEDDED_CATALOG = /*__CATALOG__*/ {};
  // Discharge instructions, reviewed before shipping and freely editable by
  // the doctor: what is kept here is a TEMPLATE, never a patient's text.
  const DIMISSIONI = /*__DIMISSIONI__*/ {};
  // Esame obiettivo: modelli PER IL MEDICO, da incollare nella cartella.
  // Non escono mai dal computer e non contengono dati di nessun paziente.
  const EO = /*__EO__*/ {};

