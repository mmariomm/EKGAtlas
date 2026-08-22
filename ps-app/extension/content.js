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
 * would send by clicking. The doctor then reviews the cart on the real page;
 * "Conferma" is ALWAYS a native click in the visible tab (the confirm posts
 * to MVPG=RcsStampaEtichetteLIS, i.e. it triggers the tube-label print flow,
 * which must stay visible).
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
 * 3. The final Conferma is opt-in, done as a native click on the live page,
 *    behind a visible countdown that can be cancelled.
 * 4. The quesito diagnostico is only written when the server field is empty.
 * 5. Stop/Esc aborts in-flight work immediately (AbortController).
 * 6. No request ever leaves the hospital origin.
 */

(function () {
  "use strict";

  // ================================================================ CONFIG
  const APP = "PS Assist";
  const VERSION = "1.2.0";
  const NS = "psassist:"; // storage namespace

  const TIMEOUT_MS = 20000;      // per-request timeout
  const PACE_MS = 250;           // gentle pause between consecutive requests
  const VERIFY_RECHECKS = 3;     // list re-reads before declaring an add lost
  const VERIFY_WAIT_MS = 1200;   // pause before each verify re-read
  const CONFIRM_SECONDS = 5;     // countdown before the native Conferma click
  const CONFIRM_FLAG_TTL = 120e3;// ms an auto-confirm handoff stays valid
  const PRINT_FLAG_TTL = 180e3;  // ms a post-confirm print handoff stays valid

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
    [RES.POC]: "POC", [RES.URGENZE]: "Urgenze", [RES.CENTRAL]: "Lab centrale",
    [RES.RX]: "RX", [RES.ECO]: "Eco", [RES.RMN]: "RMN", [RES.TAC]: "TAC",
  };

  // Quick presets shown as chips. Codes verified against the saved pages
  // (see ps-app/README.md). A preset is shown only when every code exists in
  // the catalog available on this machine (embedded + learned).
  const PRESETS = [
    { name: "Base PS",       items: [[RES.POC, "320"], [RES.POC, "3"], [RES.POC, "176"]] },            // emocromo, EGA venosa, creatinina
    { name: "Epatico",       items: [[RES.URGENZE, "16"], [RES.URGENZE, "228"], [RES.URGENZE, "53"], [RES.URGENZE, "167"], [RES.URGENZE, "34"]] }, // bili reflex, GPT, GOT, GGT, lipasi
    { name: "Coagulazione",  items: [[RES.URGENZE, "181"], [RES.URGENZE, "54"], [RES.URGENZE, "258"]] }, // PT, PTT, fibrinogeno
  ];
  const SINGLES = [ // one-tap single exams (chips)
    [RES.POC, "320"], [RES.POC, "3"], [RES.POC, "166"], [RES.POC, "176"],
    [RES.POC, "266"], [RES.POC, "101"], [RES.POC, "222"], [RES.POC, "30"],
    [RES.URGENZE, "159"], [RES.URGENZE, "297"], [RES.URGENZE, "317"],
  ];
  // If EGA arteriosa is selected, the venosa is dropped automatically.
  const EXCLUDE = [{ keep: [RES.POC, "166"], drop: [RES.POC, "3"], note: "EGA arteriosa sostituisce la venosa" }];

  // Common quesiti offered as one-tap chips (editable; last used are kept).
  const QUESITI_DEFAULT = [
    "Dolore toracico", "Dolore addominale", "Dispnea", "Febbre",
    "Trauma", "Sincope", "Vertigini", "Cefalea",
  ];

  // Embedded catalog: every exam extracted from the saved lab pages
  // (code → label per resource). Radiology lists aren't in the saved pages;
  // they are LEARNED automatically the first time the list is seen and kept
  // in localStorage, after which radiology works one-click too.
  const EMBEDDED_CATALOG = {"00660001P":{"label":"LABORATORIO ANALISI POC - SSG (P)","items":{"3":"EMOGASANALISI VENOSA POC (POC2117)","30":"GLUCOSIO (POC1250)","31":"ACIDO LATTICO POC (POC1094)","63":"NA+ POC (POC1434)","64":"K+ POC (POC1435)","101":"D-DIMERO POC (POC1405)","102":"BICARBONATI EMATICI POC (POC1499)","134":"PTT POC (POC1402)","135":"FIBRINOGENO POC (POC1404)","138":"ACT POC (POCACT)","166":"EGA EMOGASANALISI ARTERIOSA (POC1006)","176":"CREATININEMIA (POC1206)","220":"PT (POC1401)","221":"CL- POC (POC1436)","222":"TROPONINA I POC (POC2102)","223":"ACT LR POC (POCACTLR)","224":"CALCIO IONIZZATO (POC1982)","225":"TEST GRAVIDANZA URINE (POC1612)","266":"PCR POC (POC1102)","303":"BILIRUBINA (NEONATALE) (POC1341NEO)","305":"PANNELLO 1 - ANEMIA, EMORRAGIA, ISCHEMIA ARTO","306":"PANNELLO 3 - CARDIOPALMO","307":"PANNELLO 4 - TRAUMA","308":"PANNELLO 5 - DISPNEA, STROKE","309":"PANNELLO 6 - PDC, TORACALGIA","310":"PANNELLO 2 - BASE","318":"PANNELLO 9 - ESAMI POC","320":"EMOCROMOCITOMETRICO URGENTE (POCT1502)","323":"EMOGASANALISI MISTA POC (POC2117)"}},"00720001P":{"label":"LABORATORIO ANALISI URGENZE - SSG (P)","items":{"1":"EMOCROMO (1501)","15":"PEPTIDE NATRIURETICO TIPO B BNP (450057)","16":"BILIRUBINA TOTALE REFLEX (450008)","23":"PSEUDOCOLINESTERASI (450007)","34":"LIPASI (1572)","35":"ANTIGENE URINARIO STRPTOCOCCUS PNEUMONIAE (2136)","53":"GOT (1582)","54":"PTT (1402)","59":"LIQUOR ESAME CHIMICO FISICO (2338)","62":"URINOCOLTURA DA MITTO INTERMEDIO (2015)","73":"EMOCOLTURA (2000)","92":"AZOTEMIA (1200)","93":"CPK (1560)","105":"POTASSIO NEL SIERO (1435)","141":"D-DIMERO (1405)","147":"LEGIONELLE: RICERCA ANTIGENE NELLE URINE (450124)","159":"PROCALCITONINA (1690)","167":"GAMMA GT (1596)","168":"GLUCOSIO (1250)","171":"TROPONINA I (450106)","175":"TIREOTROPINA RIFLESSA(TSH-R)TSH. INCL. EVENTUALE DOSAGGIO DI FT4 E FT3 (450064)","181":"PT (1401)","183":"AMMONIEMIA (1343)","211":"URINOCOLTURA DA SACCHETTO (2036)","215":"CLORO NEL SIERO (1436)","216":"CREATININEMIA (1206)","217":"SODIO NEL SIERO (1434)","228":"GPT (1583)","230":"BETA HCG PLASMATICO (1766)","258":"FIBRINOGENO (450102)","270":"CALCIO TOTALE (1437)","272":"ANTITROMBINA III (1530)","293":"PROTEINA C REATTIVA (1102)","297":"NT PRO-BNP (2040)","316":"RICERCA DIRETTA ANTIGENI MALARIA (21295)","317":"ESAME URINE URGENTI (21296)"}},"00130001P":{"label":"LABORATORIO ANALISI - SSG (P)","items":{"1":"EMOCROMO (1501)","2":"URICEMIA (1300)","6":"COPROCOLTURA (1205)","7":"PF4 (1209)","9":"COLTURALE SU RACCOLTA SIERO EMATICA (1275)","10":"COLTURALE SU LIQUIDO DA CISTI (1282)","15":"PEPTIDE NATRIURETICO TIPO B BNP (450057)","16":"BILIRUBINA TOTALE REFLEX (450008)","17":"QUANTIFERON SINGOLO MITOGENO (1358)","18":"PREALBUMINA (1397)","22":"DOSAGGIO AMIKACINA PICCO (450030)","23":"PSEUDOCOLINESTERASI (450007)","24":"FERRITINA (450042)","25":"DOSAGGIO GENTAMICINA VALLE (450032)","26":"HERPES VIRUS 2: RICERCA ANTICORPI IGM (450153)","27":"VIRUS PAROTITE ANTICORPI IGG E IGM PER SOSPETTA INFEZIONE ACUTA (450160)","28":"ACIDI BILIARI (1999)","29":"AB BORRELIA B. IGG (450109)","34":"LIPASI (1572)","35":"ANTIGENE URINARIO STRPTOCOCCUS PNEUMONIAE (2136)","37":"COLTURALE BRONCOLAVAGGIO BAL (1262)","39":"FT3 (1837)","41":"CRYPTOCOCCO ANTIGENE SU LIQUOR (450115)","42":"PLASMODI DELLA MALARIA: RIC. MICR. STRISCIO SOTTILE E GOCCIA SPESSA (450127)","47":"COLTURALE MICOLOGICO CUTE E ANNESSI UNGHIA (1619)","48":"COLTURALE MICOLOGICO CUTE E ANNESSI CUTE (1657)","49":"COLTURALE MICOLOGICO CUTE E ANNESSI CAPELLI (1658)","50":"FARMACI ANTIBIOTICI: VANCOMICINA (450034)","53":"GOT (1582)","54":"PTT (1402)","55":"VIRUS EPATITE B (HBSAG) ANT. AUSTRA (1119)","58":"LIQUIDO ASCITICO ESAME CHIMICO E FISICO (2335)","59":"LIQUOR ESAME CHIMICO FISICO (2338)","62":"URINOCOLTURA DA MITTO INTERMEDIO (2015)","69":"COLTURALE VALVOLA CARDIACA (2496)","70":"URICURIA (1301)","71":"LDH (LATTATODEIDROGENASI) (1569)","72":"ALCOOL ETILICO (ETANOLO) (2003)","73":"EMOCOLTURA (2000)","76":"COLTURALE SU TAMPONE CUTANEO (1274)","79":"COLTURALE BRONCOASPIRATO (1009)","84":"CONTEGGIO RETICOLOCITI (1511)","86":"IMMUNOGLOBULINE G (1539)","87":"PCR AD ALTA SENSIBILITA' (CRPH) (1556)","92":"AZOTEMIA (1200)","93":"CPK (1560)","94":"VIRUS IMMUNODEF. ACQUISITA [HIV 1-2] TEST COMB. ANTICORPI/ANTIGENE P24 (450158)","95":"VIRUS EPATITE B (HBSAG) ANTICORPI (1121)","98":"VIRUS MORBILLO IGG E IGM PER SOSPETTA INFEZIONE ACUTA (450159)","99":"DOSAGGIO GENTAMICINA PICCO (450033)","105":"POTASSIO NEL SIERO (1435)","106":"CLOSTRIDIOIDES DIFFICILE:RIC. DIRETTA DELLA TOSSINA NELLE FECI (450120)","109":"ESAME COLTURALE SU TAMPONE FARINGEO (12171)","110":"COLTURALE SU TAMPONE PIAGA DECUBITO (1270)","114":"COLTURALE BIOPSIA (1516)","116":"PARASSITI NEL SANGUE (450128)","117":"COLTURALE FERITA CHIRURGICA (1564)","120":"COLTURALE MAMMELLA SINISTRA (1603)","122":"URINOCOLTURA DA CATETERE A PERMANENZA (2035)","126":"FOSFATASI ALCALINA (1590)","127":"VIRUS EPATITE B (HBEAG) ANTIGENE (1116)","130":"COLTURALE FERITE SUPERFICIALI NON CHIRURGICHE (2494)","131":"COLTURALE FILI PACE-MAKER (2495)","133":"ALBUMINURIA (MICROALBUMINURIA) (1953)","141":"D-DIMERO (1405)","142":"VIRUS EPATITE DELTA [HDV]: RICERCA ANTICORPI (450149)","143":"ELETTROFORESI PROTEICA (2109)","147":"LEGIONELLE: RICERCA ANTIGENE NELLE URINE (450124)","149":"TEST DI COOMBS INDIRETTO (1171)","152":"FT4 (1839)","154":"EMOGLOBINE. DETERMINAZIONE FRAZIONI (HBA2, HBF, HB ANOMALE) (450104)","156":"COLTURALE PLACENTA (1575)","158":"COLTURALE MICOLOGICO CUTE E ANNESSI PELI (1654)","159":"PROCALCITONINA (1690)","160":"URINOCOLTURA DA CATETERISMO SINGOLO (2037)","161":"DOSAGGIO AMIKACINA VALLE (450031)","163":"AB BORRELIA B. IGM (450110)","164":"LIQUIDO SINOVIALE ESAME CHIMICO E FISICO (2337)","167":"GAMMA GT (1596)","168":"GLUCOSIO (1250)","169":"VIRUS EPATITE B [HBV] - REFLEX (450148)","170":"VIRUS EPATITE C (HCV) (1099)","171":"TROPONINA I (450106)","174":"HERPES VIRUS 2: RICERCA ANTICORPI IGG (450152)","175":"TIREOTROPINA RIFLESSA(TSH-R)TSH. INCL. EVENTUALE DOSAGGIO DI FT4 E FT3 (450064)","180":"ALBUMINA (2391)","181":"PT (1401)","183":"AMMONIEMIA (1343)","185":"FERRO (450043)","186":"APTOGLOBINA (1098)","187":"TITOLO ANTI-O-STREPTOLISINICO (1100)","195":"LIQUIDO PERICARDICO ESAME CHIIMICO FISICO E MICROSCOPICO (1884)","196":"TRANSFERRINA IND. SATURAZIONE (1351)","197":"COLTURALE PER YERSINIA NELLE FECI (1412)","198":"COLTURALE PER STREPTOCOCCUS AGALACTIAE (1414)","205":"IMMUNOGLOBULINE A (1538)","209":"COLTURALE MAMMELLA DESTRA (1589)","211":"URINOCOLTURA DA SACCHETTO (2036)","212":"TAMPONE ANTIGENICO SARS COV-2 (21225)","213":"BICARBONATI EMATICI (1499)","215":"CLORO NEL SIERO (1436)","216":"CREATININEMIA (1206)","217":"SODIO NEL SIERO (1434)","227":"PROTEINA S LIBERA (90724)","228":"GPT (1583)","229":"PROTEINE TOTALI (1346)","230":"BETA HCG PLASMATICO (1766)","231":"FOSFORO (SIERO) (1438)","232":"TRANSFERRINA TOTALE (1352)","233":"INSULINA (1139)","237":"TSH (1841)","239":"LIQUIDO PERITONEALE ESAME CHIMICO FISICO E MICROSCOPICO (1885)","240":"ALFA 1 GLICOPROTEINA (1348)","241":"QUANTIFERON ANTIGENI TB SPECIFICI (1357)","243":"LITIEMIA (1433)","250":"LIQUIDO DA VERSAMENTO ESAME CHIMICO FISICO (2217)","254":"LIQUIDO PLEURICO ESAME CHIMICO E FISICO (2336)","255":"TEMPO DI TROMBINA (2347)","256":"AMILASI PANCREATICA (1553)","257":"FARMACI: DIGOSSINA (450016)","258":"FIBRINOGENO (450102)","259":"VIRUS EPATITE A [HAV] ANTICORPI IGG E IGM PER SOSPETTA INFEZIONE ACUTA (450147)","260":"FARMACI ANTIEPILETTICI: CARBAMAZEPINA (450018)","261":"PROTEINA C ATTIVATA-RESISTENZA (2301)","263":"HERPES VIRUS 1: RICERCA ANTICORPI IGM (450151)","264":"HERPES VIRUS 1: RICERCA ANTICORPI IGG (450150)","265":"VIRUS VARICELLA ZOSTER ANTICORPI IGG E IGM PER SOSPETTA INF. ACUTA (450162)","267":"MAGNESIO NEL SIERO (1432)","268":"ALFA AMILASI NEL SIERO (1551)","270":"CALCIO TOTALE (1437)","271":"IG M (1540)","272":"ANTITROMBINA III (1530)","273":"VITAMINA B12 (1880)","274":"HBS AB DOSAGGIO QUANTITATIVO (1110)","275":"VELOCITA'ERITROSEDIMENTAZIONE (1095)","279":"COLTURALE MATERIALE VARIO (1212)","281":"COLTURALE SU MATERIALE DA TRACHEOSTOMA (1269)","282":"COLTURALE SU MATERIALE DA FISTOLA (1271)","293":"PROTEINA C REATTIVA (1102)","294":"MIOGLOBINA (1004)","295":"VIRUS EPATITE B (HBEAG) ANTICORPI (1120)","297":"NT PRO-BNP (2040)","299":"TREPONEMA PALLIDUM RICERCA ANTICORPI SCREENING (450137)","311":"PANNELLO 7 - ESAMI EMATICI DI CONTROLLO FANTOLI","312":"PANNELLO 8 - INFORTUNIO BIOLOGICO","316":"RICERCA DIRETTA ANTIGENI MALARIA (21295)"}}};

  // ================================================================ UTILS
  const sleep = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const now = () => new Date().toLocaleTimeString("it-IT");

  // Controlled hard-stop carrying a headline + body the UI can render loudly.
  class StopError extends Error {
    constructor(head, body = "") { super(body ? `${head} — ${body}` : head); this.head = head; this.body = body; }
  }

  function param(url, name) {
    try { return new URL(url, location.href).searchParams.get(name); } catch { return null; }
  }

  // --- windows-1252 form body encoder --------------------------------------
  // application/x-www-form-urlencoded in the page charset, like a real form
  // submit: space → "+", bytes outside the safe set → %XX of the win1252
  // byte, characters not representable in win1252 → HTML numeric reference.
  const W1252_EXTRA = { // unicode → win1252 byte for the 0x80–0x9F specials
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F,
  };
  function encodeW1252Component(str) {
    let out = "";
    for (const ch of String(str)) {
      const cp = ch.codePointAt(0);
      let byte = null;
      if (cp <= 0x7F) byte = cp;
      else if (cp >= 0xA0 && cp <= 0xFF) byte = cp;
      else if (W1252_EXTRA[cp] !== undefined) byte = W1252_EXTRA[cp];
      if (byte === null) { out += encodeW1252Component(`&#${cp};`); continue; }
      if (byte === 0x20) out += "+";
      else if ((byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) || byte === 0x2A || byte === 0x2D || byte === 0x2E || byte === 0x5F) {
        out += String.fromCharCode(byte);
      } else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
    return out;
  }
  const encodeFormBody = (pairs) => pairs.map(([k, v]) => encodeW1252Component(k) + "=" + encodeW1252Component(v)).join("&");

  // --- fetch + parse --------------------------------------------------------
  // Returns {doc, url} where url is the FINAL response URL — every href or
  // action extracted from doc must be resolved against it (DOMParser docs
  // inherit the creating page's URL, which is NOT the fetched page's URL).
  async function fetchDoc(url, { method = "GET", body = null, signal } = {}) {
    // Enforce, not just promise, that nothing ever leaves the hospital origin.
    const target = new URL(url, location.href);
    if (target.origin !== location.origin) {
      throw new StopError("Richiesta fuori dall'ospedale bloccata", `destinazione inattesa: ${target.origin}`);
    }
    // Own timeout composition (AbortSignal.any needs Chrome 116+; hospital
    // Chromes can be older and a hung request must never hang the run).
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(new DOMException("Timeout", "TimeoutError")), TIMEOUT_MS);
    const onAbort = () => ctl.abort(new DOMException("Aborted", "AbortError"));
    if (signal) {
      if (signal.aborted) { clearTimeout(tid); throw new DOMException("Aborted", "AbortError"); }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    let res;
    try {
      res = await fetch(target.href, {
        method, body, signal: ctl.signal,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "follow",
        headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      });
    } finally {
      clearTimeout(tid);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    if (new URL(res.url || target.href).origin !== location.origin) {
      throw new StopError("Risposta fuori dall'ospedale bloccata", `destinazione inattesa: ${res.url}`);
    }
    if (!res.ok) throw new StopError(`Il server ha risposto HTTP ${res.status}`, res.statusText || "");
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "";
    const m = /charset=([\w-]+)/i.exec(ct);
    let charset = (m ? m[1] : "windows-1252").toLowerCase();
    let text;
    try { text = new TextDecoder(charset).decode(buf); }
    catch { text = new TextDecoder("windows-1252").decode(buf); }
    const doc = new DOMParser().parseFromString(text, "text/html");
    return { doc, url: res.url || String(url) };
  }

  const absUrl = (el, attr, baseUrl) => {
    const raw = el.getAttribute(attr);
    return raw ? new URL(raw, baseUrl).href : baseUrl;
  };

  // --- form serialization (browser semantics) -------------------------------
  // Successful controls in tree order; only the activated submit button is
  // included. Select values honour "last selected wins" explicitly, because
  // the server emits duplicate `selected` attributes on some pages.
  // Both live documents and DOMParser documents resolve duplicate `selected`
  // attributes with "last one wins" during parsing, so the value/selectedOptions
  // IDL properties are already correct — use them, never the attributes.
  function selectValue(sel) {
    if (sel.multiple) return [...sel.selectedOptions].map((o) => o.value);
    return sel.value;
  }
  function serializeForm(form, submitEl) {
    const pairs = [];
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      const type = (el.type || "").toLowerCase();
      if (type === "submit" || type === "button" || type === "image" || type === "reset") {
        if (el === submitEl) pairs.push([el.name, el.value ?? ""]);
        continue;
      }
      if ((type === "checkbox" || type === "radio") && !el.checked) continue;
      if (el.tagName === "SELECT") {
        const v = selectValue(el);
        if (Array.isArray(v)) v.forEach((x) => pairs.push([el.name, x]));
        else pairs.push([el.name, v]);
        continue;
      }
      if (type === "file") continue;
      pairs.push([el.name, el.value ?? ""]);
    }
    return pairs;
  }

  // ============================================================ PAGE MODELS
  function classify(doc) {
    if (doc.querySelector('form[name="RICHIESTACrea"]')) return "crea";
    if (doc.querySelector('form[name="Prestazioni"]')) return "exam";
    if (doc.querySelector('form[name="AmbulatorioPSO"]') ||
        doc.querySelector('a[title="Richieste Laboratorio"], a[title="Richieste Radiologia"]')) return "patient";
    if (doc.querySelector('input[type="password"]')) return "login";
    return "other";
  }

  // Episode id as stated by the SERVER inside the page (links/forms).
  function findEpisodeIdInDoc(doc) {
    const el = doc.querySelector('a[href*="EPISODIO_ID="], form[action*="EPISODIO_ID="]');
    if (el) {
      const raw = el.getAttribute("href") || el.getAttribute("action") || "";
      const m = /[?&]EPISODIO_ID=([^&]+)/.exec(raw);
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
  }
  function findEpisodeId(doc, baseUrl) {
    return param(baseUrl, "EPISODIO_ID") || findEpisodeIdInDoc(doc);
  }

  // First ~160 chars of visible page text, for the log when a page is unexpected.
  function snippet(doc) {
    return (doc.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  // Fail-closed episode pinning: crea/exam pages ALWAYS carry EPISODIO_ID in
  // the audited system, so a page without one is itself an anomaly.
  // IMPORTANT: trust the DOCUMENT first — the response URL only echoes the id
  // WE requested, so it is not independent evidence of what the server served.
  function assertSameEpisode(doc, baseUrl, episodeId, what) {
    const found = findEpisodeIdInDoc(doc) || param(baseUrl, "EPISODIO_ID");
    if (!found) {
      throw new StopError(`Episodio non identificabile nella pagina "${what}"`, "Interrotto per sicurezza: completa a mano dalla pagina nativa.");
    }
    if (episodeId && found !== episodeId) {
      throw new StopError(`La pagina "${what}" appartiene a un altro episodio (${found} ≠ ${episodeId})`, "Interrotto per sicurezza.");
    }
  }

  // Patient page: entry links to open a new richiesta.
  function patientModel(doc, baseUrl) {
    const link = (title) => {
      const a = doc.querySelector(`a[title="${title}"]`);
      return a ? absUrl(a, "href", baseUrl) : null;
    };
    return {
      labUrl: link("Richieste Laboratorio"),
      radioUrl: link("Richieste Radiologia"),
    };
  }

  // ------------------------------------------------------------- PRINT MODEL
  // The patient page (and possibly the post-confirm page) lists, per
  // richiesta, the print links audited from the real pages:
  //   "Stampa Etichette"  → RcsStampaEtichetteLISHMIMU.do?RICHIESTA_ID=…  (barcode icon → label PDF)
  //   "Stampa Richiesta"  → /jasperserverSAN/jasperservlet?REPORT=RcsRichiesta&RICHIESTA_ID=…&BRANCA=…
  //   "Stampa Prenotazione Esterna" → jasperservlet, radiology bookings
  // BRANCA varies per richiesta, so these URLs are always READ from the DOM,
  // never constructed.
  // A richiesta whose exams span more than one laboratory is split by the
  // LIS into MULTIPLE rows — same RICHIESTA_ID, different RICHIESTA_PROG —
  // each with its own label PDF and its own exam-list PDF. ALL of them must
  // be printed, so rows are grouped per (RICHIESTA_ID, RICHIESTA_PROG) and
  // never collapsed.
  function printModel(doc, baseUrl) {
    const map = {}; // richiestaId -> { prog -> {prog, etichette, lista, prenotazione} }
    const sel = 'a[title="Stampa Etichette"], a[title="Stampa Richiesta"], a[title="Stampa Prenotazione Esterna"]';
    for (const a of doc.querySelectorAll(sel)) {
      const href = absUrl(a, "href", baseUrl);
      const rid = param(href, "RICHIESTA_ID");
      if (!rid) continue;
      const prog = param(href, "RICHIESTA_PROG") || "1";
      const rows = (map[rid] = map[rid] || {});
      const row = (rows[prog] = rows[prog] || { prog });
      const t = a.getAttribute("title");
      if (t === "Stampa Etichette") row.etichette = href;
      else if (t === "Stampa Richiesta") row.lista = href;
      else row.prenotazione = href;
    }
    return map;
  }
  function printRowsFor(map, rid) {
    return Object.values(map[rid] || {}).sort((a, b) => Number(a.prog) - Number(b.prog));
  }
  // Jobs grouped by printer to minimise switching: every label PDF first
  // (etichettatrice), then every exam-list sheet, then radiology bookings.
  function printJobsFor(map, rid) {
    const rows = printRowsFor(map, rid);
    const multi = rows.length > 1;
    const tag = (r) => (multi ? ` — riga ${r.prog}` : "");
    const jobs = [];
    for (const r of rows) if (r.etichette) jobs.push({ name: `Etichette provette${tag(r)}`, printer: "etichettatrice", url: r.etichette });
    for (const r of rows) if (r.lista) jobs.push({ name: `Lista esami${tag(r)}`, printer: "stampante normale", url: r.lista });
    for (const r of rows) if (r.prenotazione) jobs.push({ name: `Prenotazione esterna${tag(r)}`, printer: "stampante normale", url: r.prenotazione });
    const seen = new Set();
    return jobs.filter((j) => !seen.has(j.url) && seen.add(j.url));
  }
  // Compact description of what a richiesta will print, e.g. "2× etichette + 2× liste".
  function printLabelFor(map, rid) {
    const rows = printRowsFor(map, rid);
    const count = (k) => rows.filter((r) => r[k]).length;
    const parts = [];
    const put = (n, sing, plur) => { if (n === 1) parts.push(sing); else if (n > 1) parts.push(`${n}× ${plur}`); };
    put(count("etichette"), "etichette", "etichette");
    put(count("lista"), "lista esami", "liste esami");
    put(count("prenotazione"), "prenotazione", "prenotazioni");
    return parts.join(" + ");
  }

  // Fetch a PDF with the same origin/timeout guards as fetchDoc. If the URL
  // answers with an HTML wrapper instead (some .do print endpoints do), follow
  // the single PDF-looking reference inside it, once.
  async function fetchPdf(url, { signal, hop = 0 } = {}) {
    const target = new URL(url, location.href);
    if (target.origin !== location.origin) {
      throw new StopError("Richiesta fuori dall'ospedale bloccata", `destinazione inattesa: ${target.origin}`);
    }
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(new DOMException("Timeout", "TimeoutError")), TIMEOUT_MS);
    const onAbort = () => ctl.abort(new DOMException("Aborted", "AbortError"));
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    let res;
    try {
      res = await fetch(target.href, { signal: ctl.signal, credentials: "same-origin", cache: "no-store", redirect: "follow" });
    } finally {
      clearTimeout(tid);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    if (new URL(res.url || target.href).origin !== location.origin) {
      throw new StopError("Risposta fuori dall'ospedale bloccata", `destinazione inattesa: ${res.url}`);
    }
    if (!res.ok) throw new StopError(`Il server ha risposto HTTP ${res.status}`, res.statusText || "");
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (ctype.includes("pdf") || ctype.includes("octet-stream")) {
      return { blob: await res.blob(), url: res.url || target.href };
    }
    if (ctype.includes("html") && hop === 0) {
      const buf = await res.arrayBuffer();
      const text = new TextDecoder("windows-1252").decode(buf);
      const doc = new DOMParser().parseFromString(text, "text/html");
      if (classify(doc) === "login") throw new StopError("Sessione scaduta", "Fai l'accesso a SA4PSO e riprova la stampa.");
      const base = res.url || target.href;
      const cand =
        doc.querySelector('iframe[src], embed[src], object[data]')?.getAttribute("src") ||
        doc.querySelector('object[data]')?.getAttribute("data") ||
        doc.querySelector('a[href*="jasperservlet"], a[href$=".pdf" i]')?.getAttribute("href") ||
        (/url\s*=\s*([^"'>\s]+)/i.exec(doc.querySelector('meta[http-equiv="refresh" i]')?.getAttribute("content") || "") || [])[1] ||
        (/window\.open\(\s*['"]([^'"]+)['"]/.exec(text) || [])[1];
      if (cand) return fetchPdf(new URL(cand, base).href, { signal, hop: 1 });
    }
    throw new StopError("Il server non ha restituito un PDF", "Usa il bottone «Apri in una scheda» e stampa dalla pagina nativa.");
  }

  // Exam page: everything the engine needs from a rendered list.
  function examModel(doc, baseUrl) {
    const form = doc.querySelector('form[name="Prestazioni"]');
    let links = form ? [...form.querySelectorAll("a.AFCDataLink")] : [];
    if (!links.length) links = [...doc.querySelectorAll("a.AFCDataLink")];
    const exams = [];
    for (const a of links) {
      const href = absUrl(a, "href", baseUrl);
      const code = param(href, "PRESTAZIONE");
      if (!code) continue; // e.g. the cart-wide "svuota" link
      exams.push({
        code,
        label: a.textContent.replace(/\s+/g, " ").replace(/^\d+-\d+\s*/, "").trim(),
        isAdd: /[?&]Insert=Inserisci/.test(href),
        isDel: /[?&]Delete=Elimina/.test(href),
        href,
      });
    }
    const sel = doc.querySelector('select[name="RISORSA_ID"]');
    const res = sel ? selectValue(sel) : null;
    const resOptions = sel ? [...sel.options].filter((o) => o.value).map((o) => ({ value: o.value, label: o.textContent.replace(/\s+/g, " ").trim() })) : [];

    // Plain list URL template, derived from a data link's own params (they
    // carry the complete state). Fallback: the Prestazioni form action.
    const DROP = ["Insert", "Delete", "MVPG", "ccsForm", "PRESTAZIONE", "BRANCA", "toPG"];
    let template = null;
    const src = exams.find((e) => e.href);
    if (src) template = new URL(src.href);
    else if (form) { template = new URL(absUrl(form, "action", baseUrl)); }
    if (template) {
      DROP.forEach((k) => template.searchParams.delete(k));
      template.searchParams.set("MVPG", "RcsRichiestaPrestazioniRicercaErogatore");
      template.searchParams.set("toPage", "RcsRichiestaPrestazioniRicercaErogatore");
      template.searchParams.set("s_PRESTAZIONE", "");
    }
    const listUrl = (targetRes) => {
      if (!template) return null;
      const u = new URL(template);
      if (targetRes) u.searchParams.set("RISORSA_ID", targetRes);
      return u.href;
    };
    const richiestaId = template ? template.searchParams.get("RICHIESTA_ID") : null;

    return {
      form, exams, res, resOptions, listUrl, richiestaId,
      inCart: (code) => exams.some((e) => e.code === code && e.isDel),
      addLink: (code) => exams.find((e) => e.code === code && e.isAdd),
      confirmButton: form ? form.querySelector('input[type="submit"][name="Update"]') || form.querySelector('input[type="submit"][name="Update1"]') : null,
    };
  }

  // =============================================================== CATALOG
  // Merged view of the embedded (audited) catalog and everything learned
  // from live pages. Learning happens on every parsed list, so radiology
  // becomes one-click after it has been seen once.
  const store = {
    get(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(NS + key)); return v ?? fallback; }
      catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch { /* full/blocked: non-fatal */ } },
  };
  // Tab-scoped storage for the run→landing handoffs (receipt + auto-confirm
  // flag): sessionStorage survives the same-tab navigation but is invisible
  // to other tabs, so two patients in two tabs can never clobber or clear
  // each other's pending confirm.
  const tabStore = {
    get(key, fallback) {
      try { const v = JSON.parse(sessionStorage.getItem(NS + key)); return v ?? fallback; }
      catch { return fallback; }
    },
    set(key, value) { try { sessionStorage.setItem(NS + key, JSON.stringify(value)); } catch { /* non-fatal */ } },
  };

  function learnedCatalog() { return store.get("catalog.v1", {}); }
  function learnFrom(model) {
    if (!model.res || !model.exams.length) return;
    const cat = learnedCatalog();
    const entry = cat[model.res] || { label: "", items: {} };
    const opt = model.resOptions.find((o) => o.value === model.res);
    if (opt) entry.label = opt.label;
    for (const e of model.exams) entry.items[e.code] = e.label;
    entry.ts = Date.now();
    cat[model.res] = entry;
    store.set("catalog.v1", cat);
  }
  function fullCatalog() {
    const out = {};
    for (const [res, v] of Object.entries(EMBEDDED_CATALOG)) out[res] = { label: v.label, items: { ...v.items } };
    for (const [res, v] of Object.entries(learnedCatalog())) {
      out[res] = out[res] || { label: v.label || res, items: {} };
      if (v.label) out[res].label = v.label;
      Object.assign(out[res].items, v.items);
    }
    return out;
  }
  const examLabel = (res, code) => (fullCatalog()[res]?.items || {})[code] || `esame ${code}`;

  // ================================================================ ENGINE
  // A run is a linear list of steps executed by runPlan(). Each step updates
  // its own status so the UI can render live progress.
  //
  // plan = {
  //   startPage: 'patient' | 'crea' | 'exam',
  //   entryUrl:  (patient only) crea-page URL to open,
  //   creaForm:  (crea only) the LIVE form element to serialize,
  //   examDoc/examUrl: (exam only) the live document,
  //   quesito:   text used only if the server field is empty,
  //   items:     [{res, code, label}],
  //   autoConfirm: boolean,
  //   episodeId: pinned patient episode,
  // }

  function orderItems(items, currentRes) {
    const rank = (r) => (r === currentRes ? "0" : "1" + r);
    return [...items].sort((a, b) => rank(a.res).localeCompare(rank(b.res)) || a.code.localeCompare(b.code));
  }

  function applyExclusions(items, log) {
    let out = [...items];
    for (const rule of EXCLUDE) {
      const has = out.some((i) => i.res === rule.keep[0] && i.code === rule.keep[1]);
      if (!has) continue;
      const before = out.length;
      out = out.filter((i) => !(i.res === rule.drop[0] && i.code === rule.drop[1]));
      if (out.length !== before) log(`↺ ${rule.note}`);
    }
    const seen = new Set();
    return out.filter((i) => { const k = i.res + ":" + i.code; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async function runPlan(plan, ui) {
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    const state = {
      steps: [], added: [], stop: () => ctrl.abort(),
      finishedListUrl: null, lastListUrl: null, richiestaId: null,
    };
    ui.beginRun(state);
    const log = (msg) => ui.log(`${now()}  ${msg}`);
    // Any fetched page that is a login page means the session died mid-flow.
    const guardSession = (doc, whatMayHaveHappened) => {
      if (classify(doc) === "login") {
        throw new StopError("Sessione scaduta durante l'operazione",
          `${whatMayHaveHappened ? whatMayHaveHappened + ". " : ""}Fai l'accesso a SA4PSO e ricontrolla il carrello a video.`);
      }
    };
    const step = (label) => {
      const s = { label, status: "pending", note: "" };
      state.steps.push(s);
      return s;
    };
    const running = (s, note) => { s.status = "running"; if (note) s.note = note; ui.renderRun(state); };
    const done = (s, note) => { s.status = "ok"; if (note) s.note = note; ui.renderRun(state); };
    const pace = () => sleep(PACE_MS, signal);

    plan.items = applyExclusions(plan.items, log);

    // Pre-build the visible step list.
    const sOpen = plan.startPage === "patient" ? step("Apro la nuova richiesta") : null;
    const sCrea = plan.startPage !== "exam" ? step("Compilo quesito e creo la richiesta") : null;
    const itemSteps = new Map();
    for (const it of plan.items) itemSteps.set(it, step(`${it.label}`));
    const sEnd = step(plan.autoConfirm ? "Passo alla pagina esami per la conferma" : "Passo alla pagina esami per la revisione");
    ui.renderRun(state);

    try {
      // ---- 1. reach the exam page --------------------------------------
      let doc, url;
      if (plan.startPage === "patient") {
        running(sOpen);
        ({ doc, url } = await fetchDoc(plan.entryUrl, { signal }));
        guardSession(doc, "Nessuna richiesta creata");
        assertSameEpisode(doc, url, plan.episodeId, "nuova richiesta");
        if (classify(doc) !== "crea") throw new StopError("Pagina Nuova Richiesta inattesa", "Il server non ha aperto la pagina prevista. Nessuna richiesta creata.");
        done(sOpen);
      }

      if (plan.startPage !== "exam") {
        running(sCrea);
        if (plan.startPage === "patient") await pace();
        let form, base;
        if (plan.startPage === "crea") { form = plan.creaForm; base = plan.creaUrl; }
        else { form = doc.querySelector('form[name="RICHIESTACrea"]'); base = url; }
        if (!form) throw new StopError("form RICHIESTACrea non trovato");

        const quesitoEl = form.elements.namedItem("QUESITO_DIAGNOSTICO");
        if (quesitoEl) {
          const existing = (quesitoEl.value || "").trim();
          if (!existing) {
            const q = (plan.quesito || "").trim();
            if (!q) throw new StopError("Quesito diagnostico mancante", "Scrivilo nel pannello e riprova. Nessuna richiesta creata.");
            quesitoEl.value = q;
          } else {
            state.quesitoKept = existing;
            log(`quesito del triage mantenuto: "${existing.slice(0, 60)}"`);
          }
        }
        const submit = form.querySelector('input[type="submit"][name="Update"]');
        if (!submit) throw new StopError('bottone "Crea" non trovato');
        const body = encodeFormBody(serializeForm(form, submit));
        const action = absUrl(form, "action", base);
        ({ doc, url } = await fetchDoc(action, { method: "POST", body, signal }));
        guardSession(doc, "La richiesta potrebbe non essere stata creata");
        assertSameEpisode(doc, url, plan.episodeId, "esami della richiesta");
        if (classify(doc) !== "exam") {
          log(`pagina inattesa dopo Crea: "${snippet(doc)}"`);
          throw new StopError("Il server non ha aperto la pagina esami dopo la creazione", "Controlla la richiesta a mano (dettagli nel Registro).");
        }
        done(sCrea);
        await pace();
      } else {
        doc = plan.examDoc; url = plan.examUrl;
      }

      // ---- 2. add each exam, verifying every add ------------------------
      let model = examModel(doc, url);
      learnFrom(model);
      state.richiestaId = model.richiestaId;
      const noteList = () => { const u = model.listUrl(model.res); if (u) state.lastListUrl = u; };
      noteList();
      if (!state.lastListUrl) throw new StopError("Impossibile ricostruire l'indirizzo dell'elenco esami", "Nessun esame inviato.");
      const offered = new Set(model.resOptions.map((o) => o.value));
      if (offered.size) {
        const wrongRes = plan.items.filter((i) => i.res && !offered.has(i.res));
        if (wrongRes.length) {
          throw new StopError("Esami non ordinabili in questa richiesta", `${wrongRes.map((i) => `«${i.label}»`).join(", ")}. Nessun esame inviato.`);
        }
      }

      const items = orderItems(plan.items, model.res);
      for (const it of items) {
        const st = itemSteps.get(it);
        running(st);
        await pace(); // pace AFTER marking, so exactly one step is always live

        // Switch list when the exam lives on another resource.
        if (it.res && model.res !== it.res) {
          running(st, `passo a ${RES_SHORT[it.res] || it.res}`);
          ({ doc, url } = await fetchDoc(model.listUrl(it.res) || state.lastListUrl, { signal }));
          guardSession(doc);
          assertSameEpisode(doc, url, plan.episodeId, "elenco esami");
          model = examModel(doc, url);
          learnFrom(model);
          if (model.res !== it.res) throw new StopError(`Cambio risorsa fallito (${RES_SHORT[it.res] || it.res})`, "Nessun ordine inviato per questo esame.");
          noteList();
        }

        if (model.inCart(it.code)) {
          done(st, "già nel carrello");
          log(`già presente ✓ ${it.label}`);
          state.added.push(it);
          continue;
        }
        const link = model.addLink(it.code);
        if (!link) {
          throw new StopError(`«${it.label}» non è nell'elenco di ${RES_SHORT[it.res] || it.res}`, "Nessun ordine inviato per questo esame. Interrotto: verifica il carrello e completa a mano.");
        }
        // Anti wrong-exam guardrail: the LIVE row label must match what the
        // doctor picked. If the hospital ever renumbers a code, every other
        // check would stay green — this one goes red BEFORE anything is sent.
        // (skipped for items carrying only the "esame N" fallback label)
        const norm = (s) => s.replace(/\s+/g, " ").trim().toUpperCase();
        if (!/^esame \d+$/i.test(it.label) && norm(link.label) !== norm(it.label)) {
          throw new StopError(`Il codice ${it.code} oggi si chiama «${link.label}»`, `Era selezionato come «${it.label}». Nessun ordine inviato: il catalogo va aggiornato (basta riaprire l'elenco una volta).`);
        }

        // ---- the one and only send of this exam -----------------------
        running(st, "invio…");
        log(`aggiungo → ${it.label}`);
        ({ doc, url } = await fetchDoc(link.href, { signal }));
        guardSession(doc, `«${it.label}» potrebbe essere stato aggiunto o no`);
        assertSameEpisode(doc, url, plan.episodeId, "conferma inserimento");
        if (classify(doc) !== "exam") {
          log(`pagina inattesa dopo l'inserimento: "${snippet(doc)}"`);
          throw new StopError(`«${it.label}» potrebbe essere stato aggiunto o no`, "Il server ha risposto con una pagina inattesa (dettagli nel Registro). NON reinviato: apri il carrello e controlla.");
        }
        model = examModel(doc, url);
        learnFrom(model);
        noteList();

        // ---- verify (re-reading the clean list only — never re-insert) --
        let verified = model.inCart(it.code);
        for (let attempt = 1; !verified && attempt <= VERIFY_RECHECKS; attempt++) {
          running(st, `verifica ${attempt}/${VERIFY_RECHECKS}…`);
          await sleep(VERIFY_WAIT_MS, signal);
          ({ doc, url } = await fetchDoc(model.listUrl(it.res || model.res) || state.lastListUrl, { signal }));
          guardSession(doc, `«${it.label}» potrebbe essere stato aggiunto o no`);
          assertSameEpisode(doc, url, plan.episodeId, "verifica carrello");
          if (classify(doc) !== "exam") {
            log(`pagina inattesa in verifica: "${snippet(doc)}"`);
            continue; // count the attempt; the next re-read may recover
          }
          model = examModel(doc, url);
          verified = model.inCart(it.code);
          noteList();
        }
        if (!verified) {
          throw new StopError(`«${it.label}» non risulta nel carrello`, `Verificato ${VERIFY_RECHECKS} volte, NON reinviato: nessun rischio di doppio ordine. Apri il carrello e controlla prima di confermare.`);
        }
        done(st, "nel carrello ✓");
        log(`aggiunto ✓ ${it.label}`);
        state.added.push(it);
      }

      // ---- 3. hand the visible tab over for review / native confirm -----
      running(sEnd);
      const last = state.added[state.added.length - 1] || null;
      const landUrl = model.listUrl(last ? last.res : model.res);
      state.finishedListUrl = landUrl;
      // Receipt for the landing page: the panel there shows the full,
      // verified accounting (including exams on other resources).
      tabStore.set("receipt.v1", {
        richiestaId: model.richiestaId, episodeId: plan.episodeId, ts: Date.now(),
        quesitoKept: state.quesitoKept || null,
        items: state.added.map((i) => ({ res: i.res, code: i.code, label: i.label })),
      });
      if (plan.autoConfirm && state.added.length) {
        tabStore.set("confirm.v1", {
          richiestaId: model.richiestaId, episodeId: plan.episodeId,
          lastCode: last.code, lastLabel: last.label, count: state.added.length, ts: Date.now(),
        });
      }
      done(sEnd);
      log(plan.autoConfirm ? "tutti verificati — passo alla pagina esami per la conferma" : "tutti verificati — rivedi il carrello e premi Conferma");
      ui.finished(state, plan);
      return state;
    } catch (err) {
      // Make the failure legible in the step plan: the live step goes red,
      // everything not yet run is explicitly "skipped".
      for (const s of state.steps) {
        if (s.status === "running") { s.status = "fail"; s.note = "fermato qui"; }
        else if (s.status === "pending") { s.status = "skipped"; s.note = "non eseguito"; }
      }
      if (signal.aborted || err?.name === "AbortError") {
        log("■ interrotto dall'utente");
        ui.stopped(state, {
          head: "Interrotto — nessun nuovo invio",
          body: "L'ultimo esame inviato potrebbe comunque essere nel carrello: controllalo prima di confermare.",
        });
      } else if (err instanceof StopError) {
        log(`⚠ ${err.message}`);
        ui.failed(state, { head: err.head, body: err.body });
      } else {
        log(`⚠ errore imprevisto: ${err?.message || err}`);
        ui.failed(state, {
          head: "Errore imprevisto",
          body: `${err?.message || err}. Nessun reinvio automatico: apri il carrello e controlla prima di confermare.`,
        });
      }
      return state;
    }
  }

  // ============================================================== UI (panel)
  // Shadow-DOM panel, top right. Collapsible pill with live state; per-page
  // content; running/error states designed to be legible from a metre away;
  // countdown handoff for the native confirm. Design system: one brand blue,
  // green = verified in cart, amber = armed/attention, red = abort/error.

  const COLORS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .wrap { position: fixed; top: 10px; right: 10px; z-index: 2147483647; color: #16232E; }
    .pill { display: flex; align-items: center; gap: 8px; background: #0B5CAD; color: #fff; border: 0; border-radius: 999px;
            padding: 9px 15px 9px 11px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(9,42,74,.35); }
    .pill:hover { background: #094a8c; }
    .pill .badge { background: #fff; color: #0B5CAD; border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 800; }
    .pill .dot { width: 8px; height: 8px; border-radius: 50%; background: #7FD1A8; animation: psaPulse 1.2s ease-in-out infinite; }
    .card { width: 360px; max-height: min(88vh, 780px); overflow: auto; background: #fff; border: 1px solid #D9E2EC;
            border-radius: 14px; box-shadow: 0 10px 32px rgba(9,42,74,.22); font-size: 13px; line-height: 1.45; }
    .hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #0B5CAD; color: #fff;
          border-radius: 13px 13px 0 0; position: sticky; top: 0; z-index: 3; }
    .hd b { font-size: 13.5px; letter-spacing: .2px; }
    .hd .sub { margin-left: auto; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
    .iconbtn { background: transparent; border: 0; color: #fff; cursor: pointer; font-size: 15px; line-height: 1; padding: 4px 6px; border-radius: 6px; }
    .iconbtn:hover { background: rgba(255,255,255,.18); }
    .pbar { height: 3px; background: #E3E8EF; position: sticky; top: 42px; z-index: 3; }
    .pbar i { display: block; height: 100%; background: #0B5CAD; transition: width .25s ease; }
    .bd { padding: 12px; }
    .sec { margin-bottom: 14px; }
    .lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #5B6B7A; margin-bottom: 6px; }
    textarea, input[type="text"], input[type="search"] { width: 100%; border: 1px solid #C4D0DC; border-radius: 8px; padding: 8px 10px; font-size: 13px; color: #16232E; background: #fff; }
    textarea:focus-visible, input:focus-visible, .chip:focus-visible, .btn:focus-visible, select.res:focus-visible, summary:focus-visible { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; align-items: center; border: 1px solid #C4D0DC; background: #F4F8FB; color: #16232E; border-radius: 999px;
            padding: 6px 12px; font-size: 12.5px; min-height: 28px; cursor: pointer; }
    .chip:hover { border-color: #0B5CAD; }
    .chip.on { background: #0B5CAD; border-color: #0B5CAD; color: #fff; }
    .chip.on::before { content: "✓ "; font-weight: 800; white-space: pre; }
    .chip.q { background: transparent; border-style: dashed; color: #35506B; }
    .chip.q:hover { border-color: #0B5CAD; color: #0B5CAD; }
    .chip.preset { background: #EAF2FA; border-color: #9DBFDE; font-weight: 600; }
    .chip.preset.on { background: #0B5CAD; color: #fff; }
    .chip.cart { background: #EDF7F0; border-color: #BCE0C9; color: #124F31; cursor: default; }
    .chip.ghosted { background: #F4F8FB; border-color: #E3E8EF; color: #5B6B7A; cursor: default; }
    .tray { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; background: #F4F8FB; border: 1px dashed #C4D0DC; border-radius: 10px; min-height: 40px; }
    .trayhdr { width: 100%; font-size: 10.5px; font-weight: 800; letter-spacing: .4px; color: #5B6B7A; margin: 2px 0 0; }
    .tray .t { display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #C4D0DC; border-radius: 999px; padding: 4px 6px 4px 10px; font-size: 12px; }
    .tray .t small { color: #5B6B7A; }
    .tray .x { border: 0; background: #E8EEF4; border-radius: 999px; width: 22px; height: 22px; line-height: 1; cursor: pointer; color: #35506B; font-size: 12px; }
    .tray .x:hover { background: #B3261E; color: #fff; }
    .tray .empty { color: #8296A9; font-size: 12px; align-self: center; }
    .btn { display: block; width: 100%; border: 0; border-radius: 10px; padding: 12px; font-size: 14px; font-weight: 700; cursor: pointer; text-align: center; }
    .btn + .btn { margin-top: 7px; }
    .btn.primary { background: #0B5CAD; color: #fff; }
    .btn.primary:hover { background: #094a8c; }
    .btn.confirm { background: #FFF7E6; color: #8a4b03; border: 1px solid #E5C588; }
    .btn.confirm:hover { background: #ffefd0; }
    .btn.ghost { background: #F4F8FB; color: #16232E; border: 1px solid #C4D0DC; }
    .btn.ghost:hover { border-color: #0B5CAD; }
    .btn.stop { background: #B3261E; color: #fff; }
    .btn.stop:hover { background: #941e18; }
    .btn:disabled { background: #EDF1F5; color: #93A3B3; border: 1px solid #E3E8EF; cursor: default; opacity: 1; }
    .idline { font-size: 11.5px; color: #5B6B7A; margin: 0 0 7px; text-align: center; }
    .idline b { color: #16232E; }
    .problem { font-size: 11.5px; color: #7a4b03; background: #FFF7E6; border: 1px solid #E5C588; border-radius: 8px; padding: 7px 9px; margin-bottom: 7px; }
    .hint { font-size: 11.5px; color: #5B6B7A; margin-top: 7px; }
    .steps { display: flex; flex-direction: column; gap: 6px; }
    .step { display: flex; align-items: baseline; gap: 8px; padding: 8px 9px; border-radius: 8px; background: #F4F8FB; }
    .step .ic { flex: 0 0 16px; text-align: center; font-size: 12px; display: inline-block; }
    .step.ok { background: #EDF7F0; } .step.ok .ic { color: #177245; }
    .step.running { background: #EAF2FA; outline: 1px solid #9DBFDE; }
    .step.running .ic { animation: psaSpin 1.1s linear infinite; }
    .step.fail { background: #FBEBEA; } .step.fail .ic { color: #B3261E; font-weight: 800; }
    .step.skipped { opacity: .55; }
    .step small { color: #5B6B7A; margin-left: auto; text-align: right; }
    .banner { border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; font-size: 12.5px; }
    .banner b { display: block; font-size: 13px; margin-bottom: 3px; }
    .banner.err { background: #FBEBEA; color: #7c1a14; border: 1px solid #E9BAB6; }
    .banner.ok { background: #EDF7F0; color: #124F31; border: 1px solid #BCE0C9; }
    .banner.warn { background: #FFF7E6; color: #7a4b03; border: 1px solid #E5C588; }
    .list { border: 1px solid #D9E2EC; border-radius: 10px; max-height: 200px; overflow: auto; margin-top: 6px; }
    .list label { display: flex; gap: 8px; padding: 9px 10px; font-size: 12px; cursor: pointer; align-items: baseline; border-bottom: 1px solid #EEF2F6; }
    .list label:hover { background: #F4F8FB; }
    .list input[type="checkbox"] { accent-color: #0B5CAD; }
    .log { font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; color: #35506B; background: #F8FAFC;
           border: 1px solid #E3E8EF; border-radius: 8px; padding: 8px; max-height: 130px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    details.reg summary { cursor: pointer; font-size: 11.5px; color: #5B6B7A; margin: 8px 0 6px; }
    details.browse summary { list-style: none; }
    details.browse summary::-webkit-details-marker { display: none; }
    .browserow { display: flex; align-items: center; justify-content: space-between; border: 1px solid #C4D0DC; border-radius: 10px;
                 padding: 10px; background: #F4F8FB; cursor: pointer; font-size: 12.5px; font-weight: 600; color: #16232E; margin-top: 8px; }
    .browserow:hover { border-color: #0B5CAD; }
    .commit { position: sticky; bottom: -1px; margin: 0 -12px -12px; padding: 10px 12px 12px; background: #fff;
              border-top: 1px solid #EEF2F6; box-shadow: 0 -10px 14px -12px rgba(9,42,74,.25); }
    .foot { padding: 8px 12px 10px; border-top: 1px solid #EEF2F6; display: flex; justify-content: space-between; align-items: center; color: #5B6B7A; font-size: 11px; }
    select.res { width: 100%; border: 1px solid #C4D0DC; border-radius: 8px; padding: 7px 8px; font-size: 12.5px; background: #fff; }
    @keyframes psaSpin { to { transform: rotate(360deg); } }
    @keyframes psaPulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
    @keyframes psaDrain { from { width: 100%; } to { width: 0; } }
    @media (prefers-reduced-motion: reduce) { .step.running .ic, .pill .dot { animation: none; } }
  `;

  const LOGO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="#fff" fill-opacity=".18"/>
    <path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
  </svg>`;

  const shortLabel = (l) => l.replace(/\s*\([\w./-]*\)\s*$/, "");
  const RADIO_SET = [RES.RX, RES.ECO, RES.RMN, RES.TAC];
  function rememberQuesito(q) {
    const list = store.get("quesiti", QUESITI_DEFAULT);
    const next = [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    store.set("quesiti", next);
  }
  function freshReceipt(richiestaId) {
    const r = tabStore.get("receipt.v1", null);
    if (!r || !r.items) return null;
    if (Date.now() - (r.ts || 0) > CONFIRM_FLAG_TTL) return null;
    if (richiestaId && r.richiestaId !== richiestaId) return null;
    return r;
  }

  class Panel {
    constructor(pageType) {
      this.pageType = pageType;
      this.selected = new Map(); // "res:code" -> {res, code, label}
      this.logLines = [];
      this.runState = null; // null | 'running' | 'done' | 'fail' | 'stopped'
      this.runData = null;
      this.message = null;  // string (inline) or {head, body} (result banner)
      this.stopFn = null;
      this.host = document.createElement("div");
      this.host.id = "psassist-host";
      this.root = this.host.attachShadow({ mode: "open" });
      document.documentElement.appendChild(this.host);
      this.collapsed = store.get("collapsed", false);
      this.filter = "";
      this.pickRes = null;
      this._unload = (e) => { e.preventDefault(); e.returnValue = ""; };
      this._esc = (e) => { if (e.key === "Escape" && this.runState === "running") this.stop(); };
      window.addEventListener("keydown", this._esc, true);
      this.render();
    }

    // ---- selection ----
    key(res, code) { return `${res}:${code}`; }
    isSel(res, code) { return this.selected.has(this.key(res, code)); }
    toggle(res, code) {
      const k = this.key(res, code);
      if (this.selected.has(k)) this.selected.delete(k);
      else this.selected.set(k, { res, code, label: examLabel(res, code) });
      this.render();
    }
    togglePreset(p) {
      const allOn = p.items.every(([r, c]) => this.isSel(r, c));
      for (const [r, c] of p.items) {
        const k = this.key(r, c);
        if (allOn) this.selected.delete(k);
        else this.selected.set(k, { res: r, code: c, label: examLabel(r, c) });
      }
      this.render();
    }

    log(line) {
      this.logLines.push(line);
      if (this.logLines.length > 120) this.logLines.shift();
      const el = this.root.querySelector(".log");
      if (el) { el.textContent = this.logLines.join("\n"); el.scrollTop = el.scrollHeight; }
    }

    // ---- engine callbacks ----
    beginRun(state) {
      this.runState = "running"; this.runData = state; this.stopFn = state.stop;
      if (this.collapsed) { this.collapsed = false; store.set("collapsed", false); }
      window.addEventListener("beforeunload", this._unload); // a run must not die silently
      this.render();
    }
    renderRun(state) { this.runData = state; this.render(); }
    finished(state, plan) {
      window.removeEventListener("beforeunload", this._unload);
      this.runState = "done"; this.runData = state;
      const n = state.added.length;
      this.message = {
        head: `✓ ${n === 1 ? "1 esame verificato" : n + " esami verificati"} nel carrello`,
        body: (state.quesitoKept ? "Quesito del triage mantenuto. " : "") + (plan.autoConfirm
          ? "Apro la pagina esami: la conferma parte con un conto alla rovescia annullabile (Esc)."
          : "Apro la pagina esami: rivedi il carrello e premi Conferma per stampare le etichette."),
      };
      this.render();
      if (state.finishedListUrl) setTimeout(() => { location.href = state.finishedListUrl; }, 900);
    }
    failed(state, msg) {
      window.removeEventListener("beforeunload", this._unload);
      this.runState = "fail"; this.runData = state; this.message = msg;
      if (this.collapsed) { this.collapsed = false; store.set("collapsed", false); } // an error may never hide
      this.render();
    }
    stopped(state, msg) {
      window.removeEventListener("beforeunload", this._unload);
      this.runState = "stopped"; this.runData = state; this.message = msg;
      if (this.collapsed) { this.collapsed = false; store.set("collapsed", false); }
      this.render();
    }
    stop() { this.stopFn?.(); }

    // ---- run starters ----
    startPlan(base) {
      if (this.runState === "running") return;
      const items = [...this.selected.values()];
      if (!items.length) return;
      const episodeId = findEpisodeId(document, location.href);
      if (!episodeId) { // fail-closed: never order on an unidentifiable episode
        this.message = "Episodio non identificabile su questa pagina: usa la pagina nativa.";
        this.render();
        return;
      }
      this.logLines = [];
      this.message = null;
      tabStore.set("receipt.v1", null);
      cancelPendingConfirm?.("nuova operazione avviata"); // never run while a confirm is armed
      const plan = { quesito: (this._q || "").trim(), items, episodeId, ...base };
      if (plan.quesito) rememberQuesito(plan.quesito);
      runPlan(plan, this); // fire and forget; the engine drives the UI via callbacks
    }

    // ---- live validation (before anything is sent) ----
    computeProblems() {
      const items = [...this.selected.values()];
      const problems = { go: [], confirm: [] };
      const both = (m) => { problems.go.push(m); problems.confirm.push(m); };
      const wantsRadio = items.some((i) => RADIO_SET.includes(i.res));
      const wantsLab = items.some((i) => !RADIO_SET.includes(i.res));
      if (this.pageType === "patient") {
        if (wantsRadio && wantsLab) both("Laboratorio e radiologia vanno in due richieste separate: lancia prima una, poi l'altra.");
        if (items.length && !(this._q || "").trim()) both("Scrivi il quesito diagnostico prima di creare la richiesta.");
        if (wantsRadio && !wantsLab && !this.entry?.radioUrl) both("Link Richieste Radiologia non trovato su questa pagina.");
        if (wantsLab && !this.entry?.labUrl) both("Link Richieste Laboratorio non trovato su questa pagina.");
      } else if (this.pageType === "crea") {
        const allowed = new Set((param(location.href, "RISORSE") || "").split(",").filter(Boolean));
        if (allowed.size) {
          const wrong = items.filter((i) => i.res && !allowed.has(i.res));
          if (wrong.length) both(`Non ordinabili in questa richiesta: ${wrong.map((i) => shortLabel(i.label)).join(", ")}.`);
        }
        const form = document.forms.namedItem("RICHIESTACrea");
        const pageQ = (form?.elements?.namedItem("QUESITO_DIAGNOSTICO")?.value || "").trim();
        if (items.length && !pageQ && !(this._q || "").trim()) both("Scrivi il quesito diagnostico (nel pannello o nella pagina).");
      } else if (this.pageType === "exam") {
        const live = examModel(document, location.href);
        const offered = new Set(live.resOptions.map((o) => o.value));
        if (offered.size) {
          const wrong = items.filter((i) => i.res && !offered.has(i.res));
          if (wrong.length) both(`Non ordinabili in questa richiesta: ${wrong.map((i) => shortLabel(i.label)).join(", ")}.`);
        }
      }
      if (wantsRadio) problems.confirm.push("Radiologia: in questa prima versione usa la Conferma manuale sulla pagina.");
      return problems;
    }

    // =============================================================== VIEWS
    render() {
      const patientName = (document.title || "").trim();
      const ep = findEpisodeId(document, location.href);
      let body;
      if (this.runState === "running") body = this.viewRunning();
      else if (this.runState) body = this.viewResult();
      else body = this.viewIdle(patientName, ep);

      const running = this.runState === "running";
      const total = this.runData?.steps?.length || 0;
      const doneN = this.runData?.steps?.filter((s) => s.status === "ok").length || 0;
      const pillInner = running
        ? `<span class="dot"></span> ${esc(APP)} <span class="badge">${doneN}/${total}</span>`
        : this.selected.size
          ? `${LOGO} ${esc(APP)} <span class="badge">${this.selected.size}</span>`
          : `${LOGO} ${esc(APP)}`;

      this.root.innerHTML = `
        <style>${COLORS}</style>
        <div class="wrap">
          ${this.collapsed ? `
            <button class="pill" id="expand" title="${esc(APP)}">${pillInner}</button>
          ` : `
            <div class="card" role="dialog" aria-label="${esc(APP)}">
              <div class="hd">
                ${LOGO}<b>${esc(APP)}</b>
                <span class="sub" title="${esc(patientName)} — episodio ${esc(ep || "?")}">${esc(patientName)}${ep ? " · " + esc(ep) : ""}</span>
                <button class="iconbtn" id="collapse" title="Riduci">—</button>
              </div>
              ${running && total ? `<div class="pbar"><i style="width:${Math.round((doneN / Math.max(total, 1)) * 100)}%"></i></div>` : ""}
              <div class="bd">${body}</div>
              <div class="foot"><span>${esc(APP)} ${VERSION}</span><span>nessun dato lascia l'ospedale</span></div>
            </div>
          `}
        </div>`;
      this.bind();
    }

    viewIdle(patientName, ep) {
      const cat = fullCatalog();
      const quesiti = store.get("quesiti", QUESITI_DEFAULT).slice(0, 8);
      const canOneClick = this.pageType === "patient" || this.pageType === "crea";

      // Receipt banner: the moment of decision on the landing page must show
      // the full verified accounting, not just what this list happens to show.
      let receiptSec = "";
      let receipt = null;
      let live = null;
      if (this.pageType === "exam") {
        live = examModel(document, location.href);
        receipt = freshReceipt(live.richiestaId);
        if (receipt) {
          const n = receipt.items.length;
          const byRes = {};
          for (const i of receipt.items) (byRes[i.res] = byRes[i.res] || []).push(i);
          const parts = Object.entries(byRes)
            .sort(([a], [b]) => (a === live.res ? -1 : b === live.res ? 1 : 0))
            .map(([r, arr]) => `${arr.length} in ${RES_SHORT[r] || r}${r === live.res ? " (questa pagina)" : ""}`);
          receiptSec = `
            <div class="banner ok"><b>✓ ${n === 1 ? "1 esame" : n + " esami"} nel carrello, ${n === 1 ? "verificato" : "tutti verificati"}</b>
              ${esc(parts.join(" · "))}${receipt.quesitoKept ? "<br>Quesito del triage mantenuto." : ""}<br>
              Rivedi e premi <b style="display:inline">Conferma</b> per stampare le etichette.
            </div>`;
        }
      }

      const quesitoSec = canOneClick ? `
        <div class="sec">
          <div class="lbl">Quesito diagnostico</div>
          <textarea id="q" rows="2" placeholder="Es. dolore toracico in atto…">${esc(this._q || "")}</textarea>
          <div class="chips" style="margin-top:6px">${quesiti.map((q) => `<button class="chip q" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
        </div>` : "";

      // On the exam page show what is already in the cart on THIS resource,
      // plus (from the receipt) what was verified on other resources.
      let cartSec = "";
      if (this.pageType === "exam" && live) {
        const inCart = live.exams.filter((e) => e.isDel);
        const here = new Set(inCart.map((e) => e.code));
        const elsewhere = receipt ? receipt.items.filter((i) => i.res !== live.res && !here.has(i.code)) : [];
        cartSec = `
          <div class="sec">
            <div class="lbl">Già nel carrello — ${esc(RES_SHORT[live.res] || live.res || "?")} (${inCart.length})</div>
            <div class="chips">
              ${inCart.map((e) => `<span class="chip cart">${esc(shortLabel(e.label))}</span>`).join("") || `<span class="hint">Ancora nessun esame su questa risorsa.</span>`}
              ${elsewhere.map((i) => `<span class="chip ghosted" title="verificato su ${esc(RES_SHORT[i.res] || i.res)}">${esc(shortLabel(i.label))} · ${esc(RES_SHORT[i.res] || i.res)} ✓</span>`).join("")}
            </div>
          </div>`;
      }

      // Hospital's own POC panels lead — they are the ward's muscle memory.
      const pocPanels = Object.entries(cat[RES.POC]?.items || {})
        .filter(([, l]) => /^PANNELLO/i.test(l))
        .sort(([, a], [, b]) => a.localeCompare(b))
        .map(([c, l]) => {
          const on = this.isSel(RES.POC, c);
          const short = l.replace(/^PANNELLO\s*/i, "P").replace(/\s*\(.*\)$/, "");
          return `<button class="chip ${on ? "on" : ""}" data-res="${RES.POC}" data-code="${esc(c)}" title="${esc(l)}">${esc(short)}</button>`;
        }).join("");
      const presetHtml = PRESETS.map((p, i) => {
        const ok = p.items.every(([r, c]) => cat[r]?.items?.[c]);
        if (!ok) return "";
        const on = p.items.every(([r, c]) => this.isSel(r, c));
        return `<button class="chip preset ${on ? "on" : ""}" data-preset="${i}">${esc(p.name)}</button>`;
      }).join("");
      const singles = SINGLES.filter(([r, c]) => cat[r]?.items?.[c]).map(([r, c]) => {
        const on = this.isSel(r, c);
        const l = examLabel(r, c);
        return `<button class="chip ${on ? "on" : ""}" data-res="${r}" data-code="${esc(c)}" title="${esc(l)} — ${esc(RES_SHORT[r] || r)}">${esc(shortLabel(l))}</button>`;
      }).join("");

      // Selected tray, grouped by resource so a lab/radio split is visible
      // before it becomes an error.
      const byRes = {};
      for (const i of this.selected.values()) (byRes[i.res] = byRes[i.res] || []).push(i);
      const tray = Object.entries(byRes).map(([r, arr]) => `
        <div class="trayhdr">${esc((RES_SHORT[r] || r).toUpperCase())} · ${arr.length}</div>
        ${arr.map((i) => `<span class="t">${esc(shortLabel(i.label))}<button class="x" data-unsel="${esc(this.key(i.res, i.code))}" title="Rimuovi" aria-label="Rimuovi ${esc(shortLabel(i.label))}">✕</button></span>`).join("")}
      `).join("") || `<span class="empty">Nessun esame selezionato</span>`;

      const n = this.selected.size;
      const nTxt = n === 0 ? "esami" : n === 1 ? "1 esame" : `${n} esami`;
      const goLabel = this.pageType === "exam" ? `Aggiungi ${nTxt}` : `Crea richiesta e aggiungi ${nTxt}`;
      const confirmLabel = this.pageType === "exam" ? `Aggiungi ${n || ""} e conferma (etichette)`.replace("  ", " ") : `Crea, aggiungi e conferma (etichette)`;

      const problems = this.computeProblems();
      const radioKnown = RADIO_SET.some((r) => Object.keys(cat[r]?.items || {}).length);
      const radioHint = (this.pageType === "patient" && !radioKnown && this.entry?.radioUrl)
        ? `<div class="hint">Radiologia: apri una volta <a href="${esc(this.entry.radioUrl)}">Richieste Radiologia</a> e l'elenco viene imparato per i prossimi accessi.</div>` : "";

      return `
        ${receiptSec}
        ${quesitoSec}
        ${cartSec}
        <div class="sec">
          ${pocPanels ? `<div class="lbl">Pannelli POC</div><div class="chips">${pocPanels}</div>` : ""}
          ${presetHtml ? `<div class="lbl" style="margin-top:${pocPanels ? "10px" : "0"}">Profili rapidi</div><div class="chips">${presetHtml}</div>` : ""}
          <div class="lbl" style="margin-top:10px">Esami singoli</div>
          <div class="chips">${singles}</div>
          ${this.viewBrowse(cat)}
        </div>
        <div class="sec">
          <div class="lbl">Selezionati (${n})</div>
          <div class="tray">${tray}</div>
        </div>
        ${this.viewPrint()}
        <details class="reg"><summary>Registro</summary><div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div></details>
        <div class="commit">
          ${typeof this.message === "string" && this.message ? `<div class="banner warn">${esc(this.message)}</div>` : ""}
          <div class="idline">Richiesta per <b>${esc(patientName)}</b>${ep ? ` · episodio <b>${esc(ep)}</b>` : ""}</div>
          <div id="problems">${problems.go[0] ? `<div class="problem">${esc(problems.go[0])}</div>` : ""}</div>
          <button class="btn primary" id="go" ${n && !problems.go.length ? "" : "disabled"}>${esc(goLabel)}</button>
          <button class="btn confirm" id="goconfirm" ${n && !problems.confirm.length ? "" : "disabled"}>${esc(confirmLabel)}</button>
          <div class="hint">Ogni esame è verificato nel carrello prima del successivo: nessun doppio ordine. La conferma parte sulla pagina reale dopo ${CONFIRM_SECONDS} secondi — annullabile con Esc.</div>
          ${radioHint}
        </div>
      `;
    }

    // Patient page: reprint any richiesta's PDFs (labels → label printer,
    // exam list → normal printer) through the sequential wizard.
    viewPrint() {
      if (this.pageType !== "patient") return "";
      const map = printModel(document, location.href);
      const rids = Object.keys(map).sort((a, b) => Number(b) - Number(a));
      if (!rids.length) return "";
      const receipt = freshReceipt(null);
      const hot = receipt && map[receipt.richiestaId] ? receipt.richiestaId : null;
      const rowLabel = (rid) => printLabelFor(map, rid);
      const rows = rids.slice(0, 5).map((rid) => `
        <button class="btn ghost" data-print="${esc(rid)}" style="text-align:left;font-weight:500;padding:9px 12px">
          🖨 Richiesta ${esc(rid)} <small style="color:#5B6B7A">· ${esc(rowLabel(rid))}</small>
        </button>`).join("");
      return `
        <div class="sec">
          <div class="lbl">Stampa</div>
          ${hot ? `<button class="btn primary" data-print="${esc(hot)}">🖨 Stampa ${esc(rowLabel(hot))} — ultima richiesta</button>` : ""}
          ${rows}
          <div class="hint">Prima le etichette (etichettatrice), poi la lista (stampante normale), in sequenza.</div>
        </div>`;
    }

    viewBrowse(cat) {
      const resList = Object.entries(cat).filter(([, v]) => Object.keys(v.items).length);
      if (!resList.length) return "";
      if (!this.pickRes || !cat[this.pickRes]) this.pickRes = resList[0][0];
      const totalN = resList.reduce((s, [, v]) => s + Object.keys(v.items).length, 0);
      const items = Object.entries(cat[this.pickRes].items)
        .sort(([, a], [, b]) => a.localeCompare(b))
        .filter(([, l]) => !this.filter || l.toUpperCase().includes(this.filter.toUpperCase()));
      return `
        <details class="browse" ${this.filter || this.browseOpen ? "open" : ""} id="browse">
          <summary><div class="browserow"><span>Tutti gli esami (${totalN})</span><span>${this.filter || this.browseOpen ? "▾" : "▸"}</span></div></summary>
          <select class="res" id="pickres" style="margin-top:8px">${resList.map(([r, v]) => `<option value="${esc(r)}" ${r === this.pickRes ? "selected" : ""}>${esc(v.label || r)}</option>`).join("")}</select>
          <input type="search" id="filter" placeholder="Cerca esame…" value="${esc(this.filter)}" style="margin-top:6px">
          <div class="list">
            ${items.slice(0, 200).map(([c, l]) => `<label><input type="checkbox" data-res="${esc(this.pickRes)}" data-code="${esc(c)}" ${this.isSel(this.pickRes, c) ? "checked" : ""}> ${esc(l)}</label>`).join("") || `<label>Nessun risultato</label>`}
          </div>
        </details>`;
    }

    viewRunning() {
      const steps = this.runData?.steps || [];
      const total = steps.length;
      const doneN = steps.filter((s) => s.status === "ok").length;
      const stepHtml = steps.map((s) => `
        <div class="step ${esc(s.status === "pending" ? "" : s.status)}">
          <span class="ic">${s.status === "ok" ? "✓" : s.status === "running" ? "⟳" : s.status === "fail" ? "✕" : s.status === "skipped" ? "–" : "·"}</span>
          <span>${esc(s.label)}</span><small>${esc(s.note || "")}</small>
        </div>`).join("");
      return `
        <div class="sec"><div class="lbl">In corso — passo ${Math.min(doneN + 1, total)} di ${total}</div><div class="steps">${stepHtml}</div></div>
        <details class="reg" open><summary>Registro</summary><div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div></details>
        <div class="commit">
          <button class="btn stop" id="stopbtn">INTERROMPI (Esc)</button>
          <div class="hint">Dopo lo stop non parte nessun nuovo invio.</div>
        </div>
      `;
    }

    viewResult() {
      const ok = this.runState === "done";
      const cls = ok ? "ok" : this.runState === "stopped" ? "warn" : "err";
      const m = this.message || {};
      const head = typeof m === "string" ? "" : m.head;
      const bodyTxt = typeof m === "string" ? m : m.body;
      const steps = (this.runData?.steps || []).map((s) => `
        <div class="step ${esc(s.status === "pending" ? "" : s.status)}">
          <span class="ic">${s.status === "ok" ? "✓" : s.status === "fail" ? "✕" : s.status === "skipped" ? "–" : "·"}</span>
          <span>${esc(s.label)}</span><small>${esc(s.note || "")}</small>
        </div>`).join("");
      const listUrl = this.runData?.finishedListUrl || this.runData?.lastListUrl;
      return `
        <div class="banner ${cls}">${head ? `<b>${esc(head)}</b>` : ""}${esc(bodyTxt || "")}</div>
        <div class="sec"><div class="steps">${steps}</div></div>
        <details class="reg" open><summary>Registro</summary><div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div></details>
        <div class="commit">
          ${!ok && listUrl ? `<button class="btn primary" id="openlist">Apri il carrello e controlla</button>` : ""}
          <button class="btn ghost" id="reset">Torna al pannello</button>
        </div>
      `;
    }

    bind() {
      const $ = (s) => this.root.querySelector(s);
      $("#expand")?.addEventListener("click", () => { this.collapsed = false; store.set("collapsed", false); this.render(); });
      $("#collapse")?.addEventListener("click", () => { this.collapsed = true; store.set("collapsed", true); this.render(); });
      $("#stopbtn")?.addEventListener("click", () => this.stop());
      $("#reset")?.addEventListener("click", () => { this.runState = null; this.runData = null; this.message = null; this.render(); });
      $("#openlist")?.addEventListener("click", () => {
        const u = this.runData?.finishedListUrl || this.runData?.lastListUrl;
        if (u) location.href = u;
      });

      const qEl = $("#q");
      qEl?.addEventListener("input", () => { this._q = qEl.value; this.refreshCommit(); });
      this.root.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
        qEl.value = b.getAttribute("data-q"); this._q = qEl.value; this.refreshCommit(); qEl.focus();
      }));
      this.root.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => this.togglePreset(PRESETS[+b.getAttribute("data-preset")])));
      this.root.querySelectorAll(".chip[data-code]").forEach((b) => b.addEventListener("click", () => this.toggle(b.getAttribute("data-res"), b.getAttribute("data-code"))));
      this.root.querySelectorAll(".list input[data-code]").forEach((c) => c.addEventListener("change", () => { this.browseOpen = true; this.toggle(c.getAttribute("data-res"), c.getAttribute("data-code")); }));
      this.root.querySelectorAll("[data-unsel]").forEach((b) => b.addEventListener("click", () => { this.selected.delete(b.getAttribute("data-unsel")); this.render(); }));
      $("#pickres")?.addEventListener("change", (e) => { this.pickRes = e.target.value; this.browseOpen = true; this.render(); });
      const f = $("#filter");
      f?.addEventListener("input", () => { this.filter = f.value; this.browseOpen = true; this.render(); const nf = this.root.querySelector("#filter"); nf?.focus(); nf?.setSelectionRange(nf.value.length, nf.value.length); });
      $("#browse")?.addEventListener("toggle", (e) => { this.browseOpen = e.target.open; });

      $("#go")?.addEventListener("click", () => this.launch(false));
      $("#goconfirm")?.addEventListener("click", () => this.launch(true));
      this.root.querySelectorAll("[data-print]").forEach((b) => b.addEventListener("click", () => {
        const rid = b.getAttribute("data-print");
        const jobs = printJobsFor(printModel(document, location.href), rid);
        if (jobs.length) openPrintWizard(jobs, { title: `Richiesta ${rid}.` });
      }));
    }

    // Patch only the commit zone while the doctor types (a full re-render
    // would steal the textarea focus at every keystroke).
    refreshCommit() {
      const problems = this.computeProblems();
      const go = this.root.querySelector("#go");
      const goc = this.root.querySelector("#goconfirm");
      const n = this.selected.size;
      if (go) go.disabled = !n || !!problems.go.length;
      if (goc) goc.disabled = !n || !!problems.confirm.length;
      const box = this.root.querySelector("#problems");
      if (box) box.innerHTML = problems.go[0] ? `<div class="problem">${esc(problems.go[0])}</div>` : "";
    }

    launch(autoConfirm) {
      // Belt over the live validation braces: recompute and refuse loudly.
      const problems = this.computeProblems();
      const blocking = autoConfirm ? problems.confirm : problems.go;
      if (blocking.length) { this.message = blocking[0]; this.render(); return; }
      const items = [...this.selected.values()];
      if (!items.length) return;

      const base = { autoConfirm };
      if (this.pageType === "patient") {
        const wantsRadio = items.some((i) => RADIO_SET.includes(i.res));
        base.startPage = "patient";
        base.entryUrl = wantsRadio ? this.entry?.radioUrl : this.entry?.labUrl;
        if (!base.entryUrl) { this.message = "Link di apertura richiesta non trovato su questa pagina."; this.render(); return; }
      } else if (this.pageType === "crea") {
        const form = document.forms.namedItem("RICHIESTACrea");
        if (!form) { this.message = "Form della richiesta non trovato."; this.render(); return; }
        base.startPage = "crea";
        base.creaForm = form;
        base.creaUrl = location.href;
      } else {
        base.startPage = "exam";
        base.examDoc = document;
        base.examUrl = location.href;
      }
      this.startPlan(base);
    }
  }

  // ------------------------------------------------ native-confirm handoff
  // Written by the engine right before landing on the exam page; consumed
  // here, on the real page, with a countdown any human interaction cancels:
  // Esc, any click on the page, or the tab going hidden.
  let cancelPendingConfirm = null; // interlock: a new run must cancel an armed countdown

  function maybeAutoConfirm(panel) {
    const flag = tabStore.get("confirm.v1", null);
    if (!flag) return;
    const clear = () => tabStore.set("confirm.v1", null);
    if (Date.now() - (flag.ts || 0) > CONFIRM_FLAG_TTL) return clear();

    const model = examModel(document, location.href);
    const ep = findEpisodeId(document, location.href);
    if (!model.form || !model.richiestaId) return; // not an exam page
    // The flag is tab-scoped, so a mismatching richiesta here is stale: drop it.
    if (model.richiestaId !== flag.richiestaId || (flag.episodeId && ep && ep !== flag.episodeId)) return clear();
    if (!model.inCart(flag.lastCode)) return clear(); // right richiesta, wrong cart → abort the auto-confirm
    // Anti wrong-exam check also at the last gate before an irreversible act.
    if (flag.lastLabel) {
      const liveRow = model.exams.find((e) => e.code === flag.lastCode && e.isDel);
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toUpperCase();
      if (!liveRow || norm(liveRow.label) !== norm(flag.lastLabel)) return clear();
    }
    if (!model.confirmButton) return clear();
    clear(); // consume immediately: a reload must never re-trigger the countdown

    const patientName = (document.title || "").trim();
    const inCart = model.exams.filter((e) => e.isDel);
    const cartPreview = inCart.slice(0, 5).map((e) => shortLabel(e.label));
    if (inCart.length > 5) cartPreview.push(`+${inCart.length - 5} altri`);

    let n = CONFIRM_SECONDS;
    let finished = false;
    const wrap = document.createElement("div");
    const root = wrap.attachShadow({ mode: "open" });
    document.documentElement.appendChild(wrap);

    const CSS = `${COLORS}
      .cwrap { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 2147483647; }
      .cbox { background: #FFF7E6; border: 2px solid #E5C588; border-radius: 14px; padding: 12px 16px;
              box-shadow: 0 10px 32px rgba(9,42,74,.25); font-size: 13px; color: #16232E; min-width: 340px; }
      .crow { display: flex; align-items: center; gap: 14px; }
      .cd { font-size: 26px; font-weight: 800; color: #8a4b03; font-variant-numeric: tabular-nums; min-width: 30px; text-align: center; }
      .cbtn { border: 0; border-radius: 10px; padding: 12px 18px; font-weight: 800; cursor: pointer; background: #B3261E; color: #fff; font-size: 13.5px; margin-left: auto; }
      .cbtn:hover { background: #941e18; }
      .cbar { height: 4px; background: #F0DFBC; border-radius: 999px; margin-top: 10px; overflow: hidden; }
      .cbar i { display: block; height: 100%; background: #E5A83B; animation: psaDrain ${CONFIRM_SECONDS}s linear forwards; }
      .clist { color: #5B6B7A; font-size: 11.5px; margin-top: 4px; }
      .toast { background: #F4F8FB; border: 1px solid #C4D0DC; border-radius: 12px; padding: 10px 14px; font-size: 12.5px;
               color: #16232E; box-shadow: 0 10px 32px rgba(9,42,74,.2); }
    `;
    root.innerHTML = `<style>${CSS}</style>
      <div class="cwrap"><div class="cbox">
        <div class="crow">
          <span class="cd" id="cdn">${n}</span>
          <span><b>Conferma automatica — ${flag.count} ${flag.count === 1 ? "esame" : "esami"} · ${esc(patientName)}</b><br>
          <small>Stampa etichette tra <span id="cds">${n}</span> s — qualsiasi click o Esc annulla</small>
          <div class="clist">${esc(cartPreview.join(" · "))}</div></span>
          <button class="cbtn" id="cancel">Annulla (Esc)</button>
        </div>
        <div class="cbar"><i></i></div>
      </div></div>`;

    const cleanup = () => {
      clearInterval(iv);
      cancelPendingConfirm = null;
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("visibilitychange", onVis, true);
    };
    const cancel = (why) => {
      if (finished) return;
      finished = true;
      cleanup();
      panel?.log(`${now()}  conferma automatica annullata${why ? ` (${why})` : ""}`);
      root.innerHTML = `<style>${CSS}</style>
        <div class="cwrap"><div class="toast">Conferma automatica annullata. Rivedi il carrello e premi <b>Conferma</b> quando sei pronto.</div></div>`;
      setTimeout(() => wrap.remove(), 5000);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } };
    const onPointer = () => cancel();
    const onVis = () => { if (document.hidden) cancel("pagina non visibile"); };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("visibilitychange", onVis, true);
    root.querySelector("#cancel").onclick = () => cancel();
    cancelPendingConfirm = cancel;

    const iv = setInterval(() => {
      if (finished) return;
      if (panel && panel.runState === "running") return cancel("operazione in corso");
      n--;
      const d = root.querySelector("#cdn"), s = root.querySelector("#cds");
      if (d) d.textContent = Math.max(n, 0);
      if (s) s.textContent = Math.max(n, 0);
      if (n <= 0) {
        finished = true;
        cleanup();
        wrap.remove();
        model.confirmButton.click(); // native click → server confirm → label print flow
      }
    }, 1000);
  }

  // ============================================================ PRINT WIZARD
  // Sequential printing of the richiesta PDFs: labels first (label printer),
  // then the exam list (normal printer). True silent printing with per-job
  // printer selection is not possible from a web page on Windows, so this is
  // the most automatic legal flow: each PDF opens in an overlay with the
  // print dialog already triggered; "Stampata — avanti" moves to the next.
  // Chrome's dialog remembers recent destinations, so switching printer is
  // one click.
  let wizardOpen = false;

  function openPrintWizard(jobs, { title = "", onClose } = {}) {
    if (wizardOpen || !jobs.length) return;
    wizardOpen = true;

    const wrap = document.createElement("div");
    wrap.id = "psassist-print";
    const root = wrap.attachShadow({ mode: "open" });
    document.documentElement.appendChild(wrap);

    let i = 0;
    let attempts = 0;
    let blobUrl = null;
    let timer = null;

    const CSS = `${COLORS}
      .back { position: fixed; inset: 0; background: rgba(9,42,74,.45); z-index: 2147483646; }
      .pw { position: fixed; top: 4vh; left: 50%; transform: translateX(-50%); z-index: 2147483647;
            width: min(720px, 94vw); background: #fff; border-radius: 16px; overflow: hidden;
            box-shadow: 0 18px 48px rgba(9,42,74,.4); font-size: 13.5px; color: #16232E;
            display: flex; flex-direction: column; max-height: 92vh; }
      .pwhd { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #0B5CAD; color: #fff; }
      .pwhd b { font-size: 14.5px; }
      .pwhd .dest { margin-left: auto; background: #FFF7E6; color: #8a4b03; border-radius: 999px; padding: 4px 12px; font-weight: 700; font-size: 12.5px; }
      .pwbody { flex: 1; min-height: 320px; background: #E8EEF4; }
      .pwbody iframe { width: 100%; height: 56vh; border: 0; display: block; background: #fff; }
      .pwmsg { padding: 40px 20px; text-align: center; color: #5B6B7A; }
      .pwft { padding: 12px 16px; display: flex; gap: 8px; align-items: center; border-top: 1px solid #E3E8EF; flex-wrap: wrap; }
      .pwbtn { border: 0; border-radius: 10px; padding: 11px 16px; font-weight: 700; font-size: 13.5px; cursor: pointer; }
      .pwbtn.next { background: #177245; color: #fff; }
      .pwbtn.next:hover { background: #125c37; }
      .pwbtn.re { background: #0B5CAD; color: #fff; }
      .pwbtn.re:hover { background: #094a8c; }
      .pwbtn.ghost { background: #F4F8FB; color: #16232E; border: 1px solid #C4D0DC; }
      .pwbtn.exit { background: transparent; color: #B3261E; border: 1px solid #E9BAB6; margin-left: auto; }
      .pwhint { width: 100%; font-size: 11.5px; color: #5B6B7A; }
      .pwerr { margin: 12px 16px 0; background: #FBEBEA; border: 1px solid #E9BAB6; color: #7c1a14; border-radius: 10px; padding: 10px 12px; font-size: 12.5px; }
    `;

    const cleanup = () => {
      wizardOpen = false;
      clearTimeout(timer);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      window.removeEventListener("keydown", onKey, true);
      wrap.remove();
      onClose?.();
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); cleanup(); } };
    window.addEventListener("keydown", onKey, true);

    const tryPrint = () => {
      attempts++;
      wrap.dataset.printAttempts = String(attempts);
      const f = root.querySelector("iframe");
      try { f?.contentWindow?.print(); } catch { /* fallback: the re-open button */ }
    };

    const render = (err) => {
      const job = jobs[i];
      root.innerHTML = `<style>${CSS}</style>
        <div class="back"></div>
        <div class="pw" role="dialog" aria-label="Stampa documenti">
          <div class="pwhd">
            <b>Stampa ${i + 1} di ${jobs.length} — ${esc(job.name)}</b>
            <span class="dest">→ ${esc(job.printer)}</span>
          </div>
          ${err ? `<div class="pwerr">${esc(err)}</div>` : ""}
          <div class="pwbody"><div class="pwmsg">Carico il PDF…</div></div>
          <div class="pwft">
            <button class="pwbtn re" id="pwre">🖨 Riapri stampa</button>
            <button class="pwbtn next" id="pwnext">✓ Stampata — ${i + 1 < jobs.length ? "avanti" : "fatto"}</button>
            <button class="pwbtn ghost" id="pwskip">Salta</button>
            <button class="pwbtn ghost" id="pwtab">Apri in una scheda</button>
            <button class="pwbtn exit" id="pwexit">Annulla (Esc)</button>
            <div class="pwhint">${esc(title)} La finestra di stampa propone l'ultima stampante usata: scegli <b style="display:inline">${esc(job.printer)}</b> la prima volta, poi resta tra le recenti.</div>
          </div>
        </div>`;
      root.querySelector("#pwre").onclick = tryPrint;
      root.querySelector("#pwnext").onclick = advance;
      root.querySelector("#pwskip").onclick = advance;
      root.querySelector("#pwexit").onclick = cleanup;
      root.querySelector("#pwtab").onclick = () => window.open(job.url, "_blank");
    };

    const advance = () => {
      clearTimeout(timer);
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
      i++;
      if (i >= jobs.length) return cleanup();
      load();
    };

    const load = async () => {
      render();
      try {
        const { blob } = await fetchPdf(jobs[i].url, {});
        blobUrl = URL.createObjectURL(blob);
        const body = root.querySelector(".pwbody");
        body.innerHTML = `<iframe title="Anteprima PDF"></iframe>`;
        const f = body.querySelector("iframe");
        let printed = false;
        const once = () => { if (!printed) { printed = true; tryPrint(); } };
        f.addEventListener("load", () => setTimeout(once, 350));
        timer = setTimeout(once, 1500); // headless/viewer-less fallback
        f.src = blobUrl;
      } catch (e) {
        const msg = e instanceof StopError ? `${e.head}${e.body ? " — " + e.body : ""}` : `Errore: ${e?.message || e}`;
        render(msg);
        root.querySelector(".pwbody").innerHTML = `<div class="pwmsg">PDF non caricato. Usa «Apri in una scheda» per stampare dalla pagina nativa.</div>`;
      }
    };

    load();
  }

  // Post-confirm print handoff: armed when the native Conferma button is
  // clicked (both by the doctor and by the auto-confirm countdown), consumed
  // by the first subsequent page that lists this richiesta's print links —
  // the post-confirm page if it has them, otherwise the patient page.
  function armPrintOnConfirm(model, episodeId) {
    if (!model.form || !model.richiestaId) return;
    const arm = () => tabStore.set("print.v1", { richiestaId: model.richiestaId, episodeId, ts: Date.now() });
    for (const name of ["Update", "Update1"]) {
      const b = model.form.elements.namedItem(name);
      if (b && (b.type || "").toLowerCase() === "submit") b.addEventListener("click", arm, true);
    }
  }

  function maybeAutoPrint() {
    const flag = tabStore.get("print.v1", null);
    if (!flag) return false;
    if (Date.now() - (flag.ts || 0) > PRINT_FLAG_TTL) { tabStore.set("print.v1", null); return false; }
    const jobs = printJobsFor(printModel(document, location.href), flag.richiestaId);
    if (!jobs.length) return false; // this page doesn't list the richiesta yet — keep waiting
    tabStore.set("print.v1", null);
    openPrintWizard(jobs, { title: "Richiesta appena confermata." });
    return true;
  }

  // ==================================================================== BOOT
  function boot() {
    if (document.getElementById("psassist-host")) return;
    const pageType = classify(document);
    if (pageType === "login") return;
    if (pageType === "other") {
      // e.g. the post-confirm label page: no panel, but a pending print
      // handoff starts here when the page lists the richiesta's print links.
      maybeAutoPrint();
      return;
    }
    const panel = new Panel(pageType);
    if (pageType === "patient") {
      panel.entry = patientModel(document, location.href);
      panel.render();
      maybeAutoPrint();
    }
    if (pageType === "exam") {
      const model = examModel(document, location.href);
      learnFrom(model);
      panel.render(); // pick up anything just learned
      armPrintOnConfirm(model, findEpisodeId(document, location.href)); // native Conferma → print handoff
      maybeAutoConfirm(panel);
    }
    if (pageType === "crea") {
      // Mirror a quesito the server (triage) already filled in, so the panel
      // never suggests overwriting it.
      const pageQ = document.forms.namedItem("RICHIESTACrea")?.elements?.namedItem("QUESITO_DIAGNOSTICO");
      if (pageQ && pageQ.value.trim()) { panel._q = pageQ.value; panel.render(); }
    }
  }

  boot();
})();
