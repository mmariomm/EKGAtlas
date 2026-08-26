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
  const VERSION = "3.5.0";
  const NS = "psassist:"; // storage namespace

  const TIMEOUT_MS = 20000;      // per-request timeout
  const PACE_MS = 250;           // gentle pause between consecutive requests
  const VERIFY_RECHECKS = 3;     // list re-reads before declaring an add lost
  const VERIFY_WAIT_MS = 1200;   // pause before each verify re-read
  const CONFIRM_FLAG_TTL = 120e3;// ms an auto-confirm handoff stays valid
  const PRINT_FLAG_TTL = 180e3;  // ms a post-confirm print handoff stays valid
  const QUEUE_TTL = 30 * 60e3;   // ms a still-unconfirmed richiesta keeps reminding

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
    { name: "Base PS",  items: [[RES.POC, "320"], [RES.POC, "3"], [RES.POC, "176"]] },            // emocromo, EGA venosa, creatinina
    { name: "Epatico",  items: [[RES.URGENZE, "16"], [RES.URGENZE, "228"], [RES.URGENZE, "53"], [RES.URGENZE, "167"], [RES.URGENZE, "34"]] }, // bili reflex, GPT, GOT, GGT, lipasi
    { name: "Coag POC", items: [[RES.POC, "220"], [RES.POC, "134"], [RES.POC, "135"]] },          // PT, PTT, fibrinogeno POC
    { name: "Coag",     items: [[RES.URGENZE, "181"], [RES.URGENZE, "54"], [RES.URGENZE, "258"]] }, // PT, PTT, fibrinogeno urgenze
  ];
  const SINGLES = [ // one-tap single exams (compact grid, grouped by lab)
    [RES.POC, "320"], [RES.POC, "3"], [RES.POC, "166"], [RES.POC, "176"],
    [RES.POC, "101"], [RES.POC, "324"], [RES.POC, "30"],
    [RES.URGENZE, "293"], [RES.URGENZE, "34"], [RES.URGENZE, "159"],
    [RES.URGENZE, "297"], [RES.URGENZE, "317"],
    [RES.CENTRAL, "212"],
    [RES.RX, "35"], [RES.RX, "36"], [RES.RX, "28"],
  ];
  // Short ward names for the UI only. The catalog label stays the source of
  // truth for the anti-wrong-exam check, so renaming here is always safe.
  const DISPLAY = {
    [`${RES.POC}:320`]: "EMOCROMO POC",
    [`${RES.POC}:3`]:   "EGA VENOSA",
    [`${RES.POC}:166`]: "EGA ARTERIOSA",
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
    [`${RES.URGENZE}:159`]: "PROCALCITONINA",
    [`${RES.URGENZE}:297`]: "NT PRO-BNP",
    [`${RES.URGENZE}:317`]: "ESAME URINE",
    [`${RES.RX}:35`]: "RX TORACE",
    [`${RES.RX}:36`]: "RX TORACE 1 PROIEZ.",
    [`${RES.RX}:28`]: "RX ADDOME",
  };
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
  const EMBEDDED_CATALOG = {"00660001P":{"label":"LABORATORIO ANALISI POC - SSG (P)","items":{"3":"EMOGASANALISI VENOSA POC (POC2117)","30":"GLUCOSIO (POC1250)","31":"ACIDO LATTICO POC (POC1094)","63":"NA+ POC (POC1434)","64":"K+ POC (POC1435)","101":"D-DIMERO POC (POC1405)","102":"BICARBONATI EMATICI POC (POC1499)","134":"PTT POC (POC1402)","135":"FIBRINOGENO POC (POC1404)","138":"ACT POC (POCACT)","166":"EGA EMOGASANALISI ARTERIOSA (POC1006)","176":"CREATININEMIA (POC1206)","220":"PT (POC1401)","221":"CL- POC (POC1436)","222":"TROPONINA I POC (POC2102)","223":"ACT LR POC (POCACTLR)","224":"CALCIO IONIZZATO (POC1982)","225":"TEST GRAVIDANZA URINE (POC1612)","266":"PCR POC (POC1102)","303":"BILIRUBINA (NEONATALE) (POC1341NEO)","305":"PANNELLO 1 - ANEMIA, EMORRAGIA, ISCHEMIA ARTO","306":"PANNELLO 3 - CARDIOPALMO","307":"PANNELLO 4 - TRAUMA","308":"PANNELLO 5 - DISPNEA, STROKE","309":"PANNELLO 6 - PDC, TORACALGIA","310":"PANNELLO 2 - BASE","318":"PANNELLO 9 - ESAMI POC","320":"EMOCROMOCITOMETRICO URGENTE (POCT1502)","323":"EMOGASANALISI MISTA POC (POC2117)","324":"TROPONINA ULTRASENSIBILE (POC3001)"}},"00720001P":{"label":"LABORATORIO ANALISI URGENZE - SSG (P)","items":{"1":"EMOCROMO (1501)","15":"PEPTIDE NATRIURETICO TIPO B BNP (450057)","16":"BILIRUBINA TOTALE REFLEX (450008)","23":"PSEUDOCOLINESTERASI (450007)","34":"LIPASI (1572)","35":"ANTIGENE URINARIO STRPTOCOCCUS PNEUMONIAE (2136)","53":"GOT (1582)","54":"PTT (1402)","59":"LIQUOR ESAME CHIMICO FISICO (2338)","62":"URINOCOLTURA DA MITTO INTERMEDIO (2015)","73":"EMOCOLTURA (2000)","92":"AZOTEMIA (1200)","93":"CPK (1560)","105":"POTASSIO NEL SIERO (1435)","141":"D-DIMERO (1405)","147":"LEGIONELLE: RICERCA ANTIGENE NELLE URINE (450124)","159":"PROCALCITONINA (1690)","167":"GAMMA GT (1596)","168":"GLUCOSIO (1250)","171":"TROPONINA I (450106)","175":"TIREOTROPINA RIFLESSA(TSH-R)TSH. INCL. EVENTUALE DOSAGGIO DI FT4 E FT3 (450064)","181":"PT (1401)","183":"AMMONIEMIA (1343)","211":"URINOCOLTURA DA SACCHETTO (2036)","215":"CLORO NEL SIERO (1436)","216":"CREATININEMIA (1206)","217":"SODIO NEL SIERO (1434)","228":"GPT (1583)","230":"BETA HCG PLASMATICO (1766)","258":"FIBRINOGENO (450102)","270":"CALCIO TOTALE (1437)","272":"ANTITROMBINA III (1530)","293":"PROTEINA C REATTIVA (1102)","297":"NT PRO-BNP (2040)","316":"RICERCA DIRETTA ANTIGENI MALARIA (21295)","317":"ESAME URINE URGENTI (21296)"}},"00130001P":{"label":"LABORATORIO ANALISI - SSG (P)","items":{"1":"EMOCROMO (1501)","2":"URICEMIA (1300)","6":"COPROCOLTURA (1205)","7":"PF4 (1209)","9":"COLTURALE SU RACCOLTA SIERO EMATICA (1275)","10":"COLTURALE SU LIQUIDO DA CISTI (1282)","15":"PEPTIDE NATRIURETICO TIPO B BNP (450057)","16":"BILIRUBINA TOTALE REFLEX (450008)","17":"QUANTIFERON SINGOLO MITOGENO (1358)","18":"PREALBUMINA (1397)","22":"DOSAGGIO AMIKACINA PICCO (450030)","23":"PSEUDOCOLINESTERASI (450007)","24":"FERRITINA (450042)","25":"DOSAGGIO GENTAMICINA VALLE (450032)","26":"HERPES VIRUS 2: RICERCA ANTICORPI IGM (450153)","27":"VIRUS PAROTITE ANTICORPI IGG E IGM PER SOSPETTA INFEZIONE ACUTA (450160)","28":"ACIDI BILIARI (1999)","29":"AB BORRELIA B. IGG (450109)","34":"LIPASI (1572)","35":"ANTIGENE URINARIO STRPTOCOCCUS PNEUMONIAE (2136)","37":"COLTURALE BRONCOLAVAGGIO BAL (1262)","39":"FT3 (1837)","41":"CRYPTOCOCCO ANTIGENE SU LIQUOR (450115)","42":"PLASMODI DELLA MALARIA: RIC. MICR. STRISCIO SOTTILE E GOCCIA SPESSA (450127)","47":"COLTURALE MICOLOGICO CUTE E ANNESSI UNGHIA (1619)","48":"COLTURALE MICOLOGICO CUTE E ANNESSI CUTE (1657)","49":"COLTURALE MICOLOGICO CUTE E ANNESSI CAPELLI (1658)","50":"FARMACI ANTIBIOTICI: VANCOMICINA (450034)","53":"GOT (1582)","54":"PTT (1402)","55":"VIRUS EPATITE B (HBSAG) ANT. AUSTRA (1119)","58":"LIQUIDO ASCITICO ESAME CHIMICO E FISICO (2335)","59":"LIQUOR ESAME CHIMICO FISICO (2338)","62":"URINOCOLTURA DA MITTO INTERMEDIO (2015)","69":"COLTURALE VALVOLA CARDIACA (2496)","70":"URICURIA (1301)","71":"LDH (LATTATODEIDROGENASI) (1569)","72":"ALCOOL ETILICO (ETANOLO) (2003)","73":"EMOCOLTURA (2000)","76":"COLTURALE SU TAMPONE CUTANEO (1274)","79":"COLTURALE BRONCOASPIRATO (1009)","84":"CONTEGGIO RETICOLOCITI (1511)","86":"IMMUNOGLOBULINE G (1539)","87":"PCR AD ALTA SENSIBILITA' (CRPH) (1556)","92":"AZOTEMIA (1200)","93":"CPK (1560)","94":"VIRUS IMMUNODEF. ACQUISITA [HIV 1-2] TEST COMB. ANTICORPI/ANTIGENE P24 (450158)","95":"VIRUS EPATITE B (HBSAG) ANTICORPI (1121)","98":"VIRUS MORBILLO IGG E IGM PER SOSPETTA INFEZIONE ACUTA (450159)","99":"DOSAGGIO GENTAMICINA PICCO (450033)","105":"POTASSIO NEL SIERO (1435)","106":"CLOSTRIDIOIDES DIFFICILE:RIC. DIRETTA DELLA TOSSINA NELLE FECI (450120)","109":"ESAME COLTURALE SU TAMPONE FARINGEO (12171)","110":"COLTURALE SU TAMPONE PIAGA DECUBITO (1270)","114":"COLTURALE BIOPSIA (1516)","116":"PARASSITI NEL SANGUE (450128)","117":"COLTURALE FERITA CHIRURGICA (1564)","120":"COLTURALE MAMMELLA SINISTRA (1603)","122":"URINOCOLTURA DA CATETERE A PERMANENZA (2035)","126":"FOSFATASI ALCALINA (1590)","127":"VIRUS EPATITE B (HBEAG) ANTIGENE (1116)","130":"COLTURALE FERITE SUPERFICIALI NON CHIRURGICHE (2494)","131":"COLTURALE FILI PACE-MAKER (2495)","133":"ALBUMINURIA (MICROALBUMINURIA) (1953)","141":"D-DIMERO (1405)","142":"VIRUS EPATITE DELTA [HDV]: RICERCA ANTICORPI (450149)","143":"ELETTROFORESI PROTEICA (2109)","147":"LEGIONELLE: RICERCA ANTIGENE NELLE URINE (450124)","149":"TEST DI COOMBS INDIRETTO (1171)","152":"FT4 (1839)","154":"EMOGLOBINE. DETERMINAZIONE FRAZIONI (HBA2, HBF, HB ANOMALE) (450104)","156":"COLTURALE PLACENTA (1575)","158":"COLTURALE MICOLOGICO CUTE E ANNESSI PELI (1654)","159":"PROCALCITONINA (1690)","160":"URINOCOLTURA DA CATETERISMO SINGOLO (2037)","161":"DOSAGGIO AMIKACINA VALLE (450031)","163":"AB BORRELIA B. IGM (450110)","164":"LIQUIDO SINOVIALE ESAME CHIMICO E FISICO (2337)","167":"GAMMA GT (1596)","168":"GLUCOSIO (1250)","169":"VIRUS EPATITE B [HBV] - REFLEX (450148)","170":"VIRUS EPATITE C (HCV) (1099)","171":"TROPONINA I (450106)","174":"HERPES VIRUS 2: RICERCA ANTICORPI IGG (450152)","175":"TIREOTROPINA RIFLESSA(TSH-R)TSH. INCL. EVENTUALE DOSAGGIO DI FT4 E FT3 (450064)","180":"ALBUMINA (2391)","181":"PT (1401)","183":"AMMONIEMIA (1343)","185":"FERRO (450043)","186":"APTOGLOBINA (1098)","187":"TITOLO ANTI-O-STREPTOLISINICO (1100)","195":"LIQUIDO PERICARDICO ESAME CHIIMICO FISICO E MICROSCOPICO (1884)","196":"TRANSFERRINA IND. SATURAZIONE (1351)","197":"COLTURALE PER YERSINIA NELLE FECI (1412)","198":"COLTURALE PER STREPTOCOCCUS AGALACTIAE (1414)","205":"IMMUNOGLOBULINE A (1538)","209":"COLTURALE MAMMELLA DESTRA (1589)","211":"URINOCOLTURA DA SACCHETTO (2036)","212":"TAMPONE ANTIGENICO SARS COV-2 (21225)","213":"BICARBONATI EMATICI (1499)","215":"CLORO NEL SIERO (1436)","216":"CREATININEMIA (1206)","217":"SODIO NEL SIERO (1434)","227":"PROTEINA S LIBERA (90724)","228":"GPT (1583)","229":"PROTEINE TOTALI (1346)","230":"BETA HCG PLASMATICO (1766)","231":"FOSFORO (SIERO) (1438)","232":"TRANSFERRINA TOTALE (1352)","233":"INSULINA (1139)","237":"TSH (1841)","239":"LIQUIDO PERITONEALE ESAME CHIMICO FISICO E MICROSCOPICO (1885)","240":"ALFA 1 GLICOPROTEINA (1348)","241":"QUANTIFERON ANTIGENI TB SPECIFICI (1357)","243":"LITIEMIA (1433)","250":"LIQUIDO DA VERSAMENTO ESAME CHIMICO FISICO (2217)","254":"LIQUIDO PLEURICO ESAME CHIMICO E FISICO (2336)","255":"TEMPO DI TROMBINA (2347)","256":"AMILASI PANCREATICA (1553)","257":"FARMACI: DIGOSSINA (450016)","258":"FIBRINOGENO (450102)","259":"VIRUS EPATITE A [HAV] ANTICORPI IGG E IGM PER SOSPETTA INFEZIONE ACUTA (450147)","260":"FARMACI ANTIEPILETTICI: CARBAMAZEPINA (450018)","261":"PROTEINA C ATTIVATA-RESISTENZA (2301)","263":"HERPES VIRUS 1: RICERCA ANTICORPI IGM (450151)","264":"HERPES VIRUS 1: RICERCA ANTICORPI IGG (450150)","265":"VIRUS VARICELLA ZOSTER ANTICORPI IGG E IGM PER SOSPETTA INF. ACUTA (450162)","267":"MAGNESIO NEL SIERO (1432)","268":"ALFA AMILASI NEL SIERO (1551)","270":"CALCIO TOTALE (1437)","271":"IG M (1540)","272":"ANTITROMBINA III (1530)","273":"VITAMINA B12 (1880)","274":"HBS AB DOSAGGIO QUANTITATIVO (1110)","275":"VELOCITA'ERITROSEDIMENTAZIONE (1095)","279":"COLTURALE MATERIALE VARIO (1212)","281":"COLTURALE SU MATERIALE DA TRACHEOSTOMA (1269)","282":"COLTURALE SU MATERIALE DA FISTOLA (1271)","293":"PROTEINA C REATTIVA (1102)","294":"MIOGLOBINA (1004)","295":"VIRUS EPATITE B (HBEAG) ANTICORPI (1120)","297":"NT PRO-BNP (2040)","299":"TREPONEMA PALLIDUM RICERCA ANTICORPI SCREENING (450137)","311":"PANNELLO 7 - ESAMI EMATICI DI CONTROLLO FANTOLI","312":"PANNELLO 8 - INFORTUNIO BIOLOGICO","316":"RICERCA DIRETTA ANTIGENI MALARIA (21295)"}},"00120001P":{"label":"RADIOLOGIA - RX - SSG (P)","items":{"21":"RX OSSA NASALI (A6952)","22":"ORTOPANORAMICA ARCATE DENTARIE (ORTOPANTOMOGRAFIA) (A699)","23":"SCHELETRO TORACICO COSTALE BIL (A6960)","24":"GINOCCHIO SX (A6936A)","25":"GINOCCHIO DX (A6936B)","26":"RX DIG.PARZ.STOMACO/DUODEN (6930)","27":"SENI PARANASALI (A6962)","28":"RX ADDOME SENZA CONTRASTO (A692)","29":"BACINO (A6917)","30":"RX COLONNA CERVICALE (6920)","31":"CRANIO (A6924)","32":"RX RACHIDE TORACO-DORSALE (A6929)","33":"RX RACHIDE LOMBO-SACRALE (A6941)","35":"RX TORACE (6979)","36":"RX TORACE 1 PROIEZIONE (6980)","37":"RX DELL'ANCA SX (A696A)","38":"RX DELL'ANCA DX (A696B)","39":"MANO SX (A6944A)","40":"GAMBA DX (A6936E)","41":"GAMBA SX (A6936F)","42":"FEMORE DX (A6936C)","43":"FEMORE SX (A6936D)","44":"GOMITO SX (A6937A)","45":"POLSO SX (A6955A)","46":"AVAMBRACCIO SX (A6915A)","47":"AVAMBRACCIO DX (A6915B)","48":"GOMITO DX (A6937B)","49":"MANO DX (A6944B)","50":"PIEDE DX (A6953B)","51":"POLSO DX (A6955B)","52":"PIEDE SX (A6953A)","53":"RX ORBITE (A6906)","54":"STERNO (A6985C)","118":"SPALLA DX (A6964C)","119":"SPALLA SX (A6964D)","120":"RADIOGRAFIA IN REPARTO (6903)","122":"TIBIO-TARSICA DX (A6953C)","123":"TIBIO-TARSICA SX (A6953D)","134":"RX CLAVICOLA DX (A6985D)","135":"RX CLAVICOLA SX (A6985E)"}},"00650002P":{"label":"LABORATORIO ANALISI POC - OSG (P)","items":{"3":"EMOGASANALISI VENOSA POC (POC2117)","30":"GLUCOSIO (POC1250)","31":"ACIDO LATTICO POC (POC1094)","63":"NA+ POC (POC1434)","64":"K+ POC (POC1435)","101":"D-DIMERO POC (POC1405)","102":"BICARBONATI EMATICI POC (POC1499)","134":"PTT POC (POC1402)","135":"FIBRINOGENO POC (POC1404)","138":"ACT POC (POCACT)","166":"EGA EMOGASANALISI ARTERIOSA (POC1006)","176":"CREATININEMIA (POC1206)","220":"PT (POC1401)","221":"CL- POC (POC1436)","223":"ACT LR POC (POCACTLR)","224":"CALCIO IONIZZATO (POC1982)","225":"TEST GRAVIDANZA URINE (POC1612)","266":"PCR POC (POC1102)","303":"BILIRUBINA (NEONATALE) (POC1341NEO)","305":"PANNELLO 1 – ANEMIA, EMORRAGIA, ISCHEMIA ARTO","306":"PANNELLO 3 - CARDIOPALMO","307":"PANNELLO 4 - TRAUMA","308":"PANNELLO 5 – DISPNEA, STROKE","309":"PANNELLO 6 – PDC, TORACALGIA","310":"PANNELLO 2 - BASE","318":"PANNELLO 9 - ESAMI POC","320":"EMOCROMOCITOMETRICO URGENTE (POCT1502)","323":"EMOGASANALISI CAPILLARE POC (POC2117)","324":"TROPONINA ULTRASENSIBILE (POC3001)","325":"EMOGASANALISI VENOSA&nbsp;POC - NEW (POC21171)","326":"EGA EMOGASANALISI ARTERIOSA POC - NEW (POC10061)","327":"BICARBONATI EMATICI POC - NEW (POC14991)","328":"GLUCOSIO POC - NEW (POC12501)","329":"ACIDO LATTICO POC - NEW (POC10941)","330":"SODIO NEL SIERO POC - NEW (POC14341)","331":"POTASSIO NEL SIERO - NEW (POC14351)","332":"CLORO NEL SIERO POC - NEW (POC14361)","333":"EMOGAS CAPILLARE POC (POC21172)"}},"00290002P":{"label":"LABORATORIO ANALISI - OSG (P)","items":{"1":"EMOCROMO (1501)","2":"URICEMIA (1300)","6":"COPROCOLTURA (1205)","7":"PF4 (1209)","9":"COLTURALE SU RACCOLTA SIERO EMATICA (1275)","10":"COLTURALE SU LIQUIDO DA CISTI (1282)","15":"PEPTIDE NATRIURETICO TIPO B BNP (450057)","16":"BILIRUBINA TOTALE REFLEX (450008)","17":"QUANTIFERON SINGOLO MITOGENO (1358)","18":"PREALBUMINA (1397)","22":"DOSAGGIO AMIKACINA PICCO (450030)","23":"PSEUDOCOLINESTERASI (450007)","24":"FERRITINA (450042)","25":"DOSAGGIO GENTAMICINA VALLE (450032)","26":"HERPES VIRUS 2: RICERCA ANTICORPI IGM (450153)","27":"VIRUS PAROTITE ANTICORPI IGG E IGM PER SOSPETTA INFEZIONE ACUTA (450160)","28":"ACIDI BILIARI (1999)","29":"AB BORRELIA B. IGG (450109)","34":"LIPASI (1572)","35":"ANTIGENE URINARIO STRPTOCOCCUS PNEUMONIAE (2136)","37":"COLTURALE BRONCOLAVAGGIO BAL (1262)","39":"FT3 (1837)","41":"CRYPTOCOCCO ANTIGENE SU LIQUOR (450115)","42":"PLASMODI DELLA MALARIA: RIC. MICR. STRISCIO SOTTILE E GOCCIA SPESSA (450127)","47":"COLTURALE MICOLOGICO CUTE E ANNESSI UNGHIA (1619)","48":"COLTURALE MICOLOGICO CUTE E ANNESSI CUTE (1657)","49":"COLTURALE MICOLOGICO CUTE E ANNESSI CAPELLI (1658)","50":"FARMACI ANTIBIOTICI: VANCOMICINA (450034)","53":"GOT (1582)","54":"PTT (1402)","55":"VIRUS EPATITE B (HBSAG) ANT. AUSTRA (1119)","58":"LIQUIDO ASCITICO ESAME CHIMICO E FISICO (2335)","59":"LIQUOR ESAME CHIMICO FISICO (2338)","62":"URINOCOLTURA DA MITTO INTERMEDIO (2015)","69":"COLTURALE VALVOLA CARDIACA (2496)","70":"URICURIA (1301)","71":"LDH (LATTATODEIDROGENASI) (1569)","72":"ALCOOL ETILICO (ETANOLO) (2003)","73":"EMOCOLTURA (2000)","76":"COLTURALE SU TAMPONE CUTANEO (1274)","79":"COLTURALE BRONCOASPIRATO (1009)","84":"CONTEGGIO RETICOLOCITI (1511)","86":"IMMUNOGLOBULINE G (1539)","87":"PCR AD ALTA SENSIBILITA' (CRPH) (1556)","92":"AZOTEMIA (1200)","93":"CPK (1560)","94":"VIRUS IMMUNODEF. ACQUISITA [HIV 1-2] TEST COMB. ANTICORPI/ANTIGENE P24 (450158)","95":"VIRUS EPATITE B (HBSAG) ANTICORPI (1121)","98":"VIRUS MORBILLO IGG E IGM PER SOSPETTA INFEZIONE ACUTA (450159)","99":"DOSAGGIO GENTAMICINA PICCO (450033)","105":"POTASSIO NEL SIERO (1435)","106":"CLOSTRIDIOIDES DIFFICILE:RIC. DIRETTA DELLA TOSSINA NELLE FECI (450120)","109":"ESAME COLTURALE SU TAMPONE FARINGEO (12171)","110":"COLTURALE SU TAMPONE PIAGA DECUBITO (1270)","114":"COLTURALE BIOPSIA (1516)","116":"PARASSITI NEL SANGUE (450128)","117":"COLTURALE FERITA CHIRURGICA (1564)","120":"COLTURALE MAMMELLA SINISTRA (1603)","122":"URINOCOLTURA DA CATETERE A PERMANENZA (2035)","126":"FOSFATASI ALCALINA (1590)","127":"VIRUS EPATITE B (HBEAG) ANTIGENE (1116)","130":"COLTURALE FERITE SUPERFICIALI NON CHIRURGICHE (2494)","131":"COLTURALE FILI PACE-MAKER (2495)","133":"ALBUMINURIA (MICROALBUMINURIA) (1953)","141":"D-DIMERO (1405)","142":"VIRUS EPATITE DELTA [HDV]: RICERCA ANTICORPI (450149)","143":"ELETTROFORESI PROTEICA (2109)","147":"LEGIONELLE: RICERCA ANTIGENE NELLE URINE (450124)","149":"TEST DI COOMBS INDIRETTO (1171)","152":"FT4 (1839)","154":"EMOGLOBINE. DETERMINAZIONE FRAZIONI (HBA2, HBF, HB ANOMALE) (450104)","156":"COLTURALE PLACENTA (1575)","158":"COLTURALE MICOLOGICO CUTE E ANNESSI PELI (1654)","159":"PROCALCITONINA (1690)","160":"URINOCOLTURA DA CATETERISMO SINGOLO (2037)","161":"DOSAGGIO AMIKACINA VALLE (450031)","163":"AB BORRELIA B. IGM (450110)","164":"LIQUIDO SINOVIALE ESAME CHIMICO E FISICO (2337)","167":"GAMMA GT (1596)","168":"GLUCOSIO (1250)","169":"VIRUS EPATITE B [HBV] - REFLEX (450148)","170":"VIRUS EPATITE C (HCV) (1099)","171":"TROPONINA I (450106)","174":"HERPES VIRUS 2: RICERCA ANTICORPI IGG (450152)","175":"TIREOTROPINA RIFLESSA(TSH-R)TSH. INCL. EVENTUALE DOSAGGIO DI FT4 E FT3 (450064)","180":"ALBUMINA (2391)","181":"PT (1401)","183":"AMMONIEMIA (1343)","185":"FERRO (450043)","186":"APTOGLOBINA (1098)","187":"TITOLO ANTI-O-STREPTOLISINICO (1100)","195":"LIQUIDO PERICARDICO ESAME CHIIMICO FISICO E MICROSCOPICO (1884)","196":"TRANSFERRINA IND. SATURAZIONE (1351)","197":"COLTURALE PER YERSINIA NELLE FECI (1412)","198":"COLTURALE PER STREPTOCOCCUS AGALACTIAE (1414)","205":"IMMUNOGLOBULINE A (1538)","209":"COLTURALE MAMMELLA DESTRA (1589)","211":"URINOCOLTURA DA SACCHETTO (2036)","212":"TAMPONE ANTIGENICO SARS COV-2 (21225)","213":"BICARBONATI EMATICI (1499)","215":"CLORO NEL SIERO (1436)","216":"CREATININEMIA (1206)","217":"SODIO NEL SIERO (1434)","227":"PROTEINA S LIBERA (90724)","228":"GPT (1583)","229":"PROTEINE TOTALI (1346)","230":"BETA HCG PLASMATICO (1766)","231":"FOSFORO (SIERO) (1438)","232":"TRANSFERRINA TOTALE (1352)","233":"INSULINA (1139)","237":"TSH (1841)","239":"LIQUIDO PERITONEALE ESAME CHIMICO FISICO E MICROSCOPICO (1885)","240":"ALFA 1 GLICOPROTEINA (1348)","241":"QUANTIFERON ANTIGENI TB SPECIFICI (1357)","243":"LITIEMIA (1433)","250":"LIQUIDO DA VERSAMENTO ESAME CHIMICO FISICO (2217)","254":"LIQUIDO PLEURICO ESAME CHIMICO E FISICO (2336)","255":"TEMPO DI TROMBINA (2347)","256":"AMILASI PANCREATICA (1553)","257":"FARMACI: DIGOSSINA (450016)","258":"FIBRINOGENO (450102)","259":"VIRUS EPATITE A [HAV] ANTICORPI IGG E IGM PER SOSPETTA INFEZIONE ACUTA (450147)","260":"FARMACI ANTIEPILETTICI: CARBAMAZEPINA (450018)","261":"PROTEINA C ATTIVATA-RESISTENZA (2301)","263":"HERPES VIRUS 1: RICERCA ANTICORPI IGM (450151)","264":"HERPES VIRUS 1: RICERCA ANTICORPI IGG (450150)","265":"VIRUS VARICELLA ZOSTER ANTICORPI IGG E IGM PER SOSPETTA INF. ACUTA (450162)","267":"MAGNESIO NEL SIERO (1432)","268":"ALFA AMILASI NEL SIERO (1551)","270":"CALCIO TOTALE (1437)","271":"IG M (1540)","272":"ANTITROMBINA III (1530)","273":"VITAMINA B12 (1880)","274":"HBS AB DOSAGGIO QUANTITATIVO (1110)","275":"VELOCITA'ERITROSEDIMENTAZIONE (1095)","279":"COLTURALE MATERIALE VARIO (1212)","281":"COLTURALE SU MATERIALE DA TRACHEOSTOMA (1269)","282":"COLTURALE SU MATERIALE DA FISTOLA (1271)","293":"PROTEINA C REATTIVA (1102)","294":"MIOGLOBINA (1004)","295":"VIRUS EPATITE B (HBEAG) ANTICORPI (1120)","297":"NT PRO-BNP (2040)","299":"TREPONEMA PALLIDUM RICERCA ANTICORPI SCREENING (450137)","311":"PANNELLO 7 – ESAMI EMATICI DI CONTROLLO FANTOLI","312":"PANNELLO 8 - INFORTUNIO BIOLOGICO","316":"RICERCA DIRETTA ANTIGENI MALARIA (21295)"}}};

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

  // --- banco di prova (offline) --------------------------------------------
  // A page that is NOT the hospital may provide these hooks to run the panel
  // against a simulator (tools/demo.mjs). The host check comes first, so on
  // the real system the hooks do not exist and nothing served by SA4PSO can
  // take over navigation, tabs or printing.
  const DEMO = (location.hostname !== "smarthealth.multimedica.it" && window.__PSA_DEMO__) || null;
  const nav = (url) => { if (DEMO && DEMO.nav) return DEMO.nav(url); location.href = url; };
  const openTab = (url, name) => (DEMO && DEMO.open ? DEMO.open(url, name) : window.open(url, name));

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

  // Lab names as they are read at a glance. The LIS writes them out in full
  // ("MCH Cont. Media Hgb"), which is unreadable in a two-line preview: what a
  // doctor scans is the short form and the number.
  const SIGLE = [
    [/^leucociti|^globuli bianchi|^wbc/i, "GB"], [/^emoglobina|^hgb\b|^hb\b/i, "Hb"],
    [/^ematocrito|^hct/i, "Ht"], [/^piastrine|^plt/i, "PLT"], [/^eritrociti|globuli rossi|^rbc/i, "GR"],
    [/^mcv|vol\.? glob/i, "MCV"], [/^mchc/i, "MCHC"], [/^mch\b|cont\.? media/i, "MCH"], [/^rdw/i, "RDW"],
    [/^granulociti|neutrofil/i, "Neu"], [/^linfocit/i, "Lin"], [/^monocit/i, "Mon"],
    [/^eosinofil/i, "Eos"], [/^basofil/i, "Bas"], [/altre popolazioni/i, "Altre"],
    [/^creatinin/i, "Cr"], [/^azotemia|^urea/i, "Az"], [/^sodio|^na\b/i, "Na"], [/^potassio|^k\b/i, "K"],
    [/^cloro|^cl\b/i, "Cl"], [/calcio ioniz/i, "Ca++"], [/^calcio/i, "Ca"], [/^magnesio/i, "Mg"],
    [/^glucosio|glicemia/i, "Glu"], [/proteina c reattiva|^pcr\b/i, "PCR"], [/procalcitonin/i, "PCT"],
    [/troponina/i, "Trop"], [/d.?dimero/i, "DD"], [/^inr/i, "INR"], [/^pt\b|protrombin/i, "PT"],
    [/^ptt|tromboplastin/i, "PTT"], [/fibrinogeno/i, "Fib"], [/bilirubina.*diretta/i, "BilD"],
    [/bilirubina/i, "Bil"], [/^got\b|^ast\b/i, "AST"], [/^gpt\b|^alt\b/i, "ALT"],
    [/gamma\s?gt|^ggt/i, "γGT"], [/fosfatasi alc/i, "ALP"], [/^ldh/i, "LDH"],
    [/^cpk|creatinchinasi|^ck\b/i, "CPK"], [/^lipasi/i, "Lip"], [/^amilasi/i, "Amy"],
    [/^albumin/i, "Alb"], [/nt.?pro.?bnp/i, "NTproBNP"], [/^bnp/i, "BNP"], [/^ves\b/i, "VES"],
    [/^ph\b/i, "pH"], [/pco2|pco₂/i, "pCO2"], [/po2\b|po₂/i, "pO2"], [/hco3|bicarbon/i, "HCO3"],
    [/base excess|^be\b|^eb\b/i, "BE"], [/lattat/i, "Lac"], [/saturaz|^so2/i, "SatO2"],
    [/carbossiemo|^cohb/i, "COHb"], [/metaemo|^methb/i, "MetHb"], [/^tsh/i, "TSH"],
    [/emogas/i, "EGA"], [/^ammonio|ammoniem/i, "NH3"], [/^mioglobin/i, "Mb"],
  ];
  function sigla(nome) {
    const n = String(nome || "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    for (const [re, s] of SIGLE) if (re.test(n)) return s;
    const w = n.split(/[\s(,.]+/).filter(Boolean)[0] || n;   // first word, never a paragraph
    return w.length > 9 ? w.slice(0, 8) + "." : w;
  }

  // ---- comparing draws -----------------------------------------------------
  // The same analyte must sit in the same place in every draw, or nothing can
  // be compared at a glance: the newest draw fixes the order, the others follow
  // it (their own extras go after, in their own order).
  const valKey = (nome) => String(nome || "").replace(/&nbsp;/g, " ").replace(/[^a-zà-ù0-9%+]+/gi, " ").trim().toLowerCase();
  const numVal = (x) => { const m = /-?\d+(?:[.,]\d+)?/.exec(String(x)); return m ? parseFloat(m[0].replace(",", ".")) : NaN; };

  // When is a change worth marking? 5% would light up half of every emocromo:
  // analytical + biological variation alone moves Hb ~3%, PLT ~9%. These
  // per-analyte thresholds approximate reference change values (the smallest
  // difference that is a real difference), rounded to be conservative;
  // anything unknown uses 20%.
  const DELTA_SOGLIA = {
    Na: 3, Cl: 3, Ca: 5, "Ca++": 6, K: 8, HCO3: 10, BE: 999, pCO2: 10, pO2: 15, SatO2: 4,
    Hb: 8, Ht: 8, GR: 8, MCV: 4, MCH: 4, MCHC: 4, RDW: 6, GB: 25, PLT: 25, Neu: 30, Lin: 30,
    Cr: 15, Az: 20, Glu: 20, Lac: 30, NH3: 30, Alb: 10, INR: 10, PT: 10, PTT: 10, Fib: 15, DD: 40,
    PCR: 50, PCT: 50, Trop: 30, Bil: 25, BilD: 25, AST: 30, ALT: 30, "γGT": 25, ALP: 25, LDH: 25,
    Lip: 30, Amy: 30, NTproBNP: 30, BNP: 30, Mb: 30, COHb: 20, MetHb: 20,
  };

  // draws: [{id, rows}] newest first → { order: Map(key→idx),
  //   delta: Map(drawId → Map(key → {prevRaw, pct, dir})) }
  function confrontaPrelievi(draws) {
    const order = new Map();
    for (const d of draws) for (const r of d.rows) {
      const k = valKey(r.nome);
      if (k && !order.has(k)) order.set(k, order.size);
    }
    const delta = new Map();
    const um = (x) => String(x || "").toLowerCase().replace(/[\s.]+/g, "");
    const modificato = (x) => /^[<>≤≥]/.test(String(x).trim());
    for (let i = 0; i < draws.length; i++) {
      const m = new Map();
      for (const r of draws[i].rows) {
        const k = valKey(r.nome), v = numVal(r.valore);
        if (!k || !isFinite(v) || modificato(r.valore)) continue;   // "<0.01" is a bound, not a number
        for (let j = i + 1; j < draws.length; j++) {                // the next older draw with this analyte
          const hit = draws[j].rows.find((rr) => valKey(rr.nome) === k);
          if (!hit) continue;
          const prev = numVal(hit.valore);
          if (isFinite(prev) && Math.abs(prev) > 1e-9 && !modificato(hit.valore)
              && !(um(r.um) && um(hit.um) && um(r.um) !== um(hit.um))) {   // g/L vs g/dL is a 10× trap
            const pct = Math.round(((v - prev) / Math.abs(prev)) * 100);
            const sg = sigla(r.nome);
            // pH is logarithmic: percent is meaningless there, 0.05 units is not
            const rilevante = sg === "pH" ? Math.abs(v - prev) >= 0.05 : Math.abs(pct) >= (DELTA_SOGLIA[sg] ?? 20);
            if (rilevante) m.set(k, { prevRaw: hit.valore, pct, dir: v > prev ? "▲" : "▼" });
          }
          break;
        }
      }
      delta.set(draws[i].id, m);
    }
    return { order, delta };
  }
  const ordinaRighe = (rows, order) => [...rows].sort((a, b) =>
    (order.get(valKey(a.nome)) ?? 9e9) - (order.get(valKey(b.nome)) ?? 9e9));

  // First ~160 chars of visible page text, for the log when a page is unexpected.
  function snippet(doc) {
    return (doc.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  // Fail-closed episode pinning: crea/exam pages ALWAYS carry EPISODIO_ID in
  // the audited system, so a page without one is itself an anomaly.
  // IMPORTANT: trust the DOCUMENT first — the response URL only echoes the id
  // WE requested, so it is not independent evidence of what the server served.
  function assertSameEpisode(doc, baseUrl, episodeId, what) {
    // The response URL only echoes the id WE asked for — it is not evidence.
    const found = findEpisodeIdInDoc(doc);
    if (!found) {
      throw new StopError(`Episodio non identificabile nella pagina "${what}"`, "Interrotto per sicurezza.");
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
    const map = {}; // richiestaId -> { prog -> row, _meta }
    const sel = 'a[title="Stampa Etichette"], a[title="Stampa Richiesta"], a[title="Stampa Prenotazione Esterna"]';
    for (const a of doc.querySelectorAll(sel)) {
      const href = absUrl(a, "href", baseUrl);
      const rid = param(href, "RICHIESTA_ID");
      if (!rid) continue;
      const prog = param(href, "RICHIESTA_PROG") || "1";
      const rows = (map[rid] = map[rid] || { _meta: { ts: 0, when: "", exams: [] } });
      const row = (rows[prog] = rows[prog] || { prog });
      const t = a.getAttribute("title");
      if (t === "Stampa Etichette") row.etichette = href;
      else if (t === "Stampa Richiesta") row.lista = href;
      else row.prenotazione = href;
      // the row this print icon lives in also carries when + what was ordered
      const tr = a.closest("tr");
      if (tr) {
        const dt = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(tr.querySelector('input[name="DATA_ORD"]')?.value || "");
        if (dt) {
          const ts = Date.UTC(+dt[1], dt[2] - 1, +dt[3], +dt[4], +dt[5]);
          if (!rows._meta.ts || ts < rows._meta.ts) { rows._meta.ts = ts; rows._meta.when = `${dt[3]}/${dt[2]} ${dt[4]}:${dt[5]}`; }
        }
        const desc = tr.querySelector('input[name="DESCRIZIONE_TITLE"]')?.value || "";
        const nice = shortLabel(desc.replace(/^\d+-\d+\s*/, "")).trim();
        if (nice && !rows._meta.exams.includes(nice)) rows._meta.exams.push(nice);
      }
    }
    // every OTHER row of the same richiesta adds its exam to the list
    for (const tr of doc.querySelectorAll("tr")) {
      const link = tr.querySelector('a[href*="RICHIESTA_ID="], a[onclick*="RICHIESTA_ID="]');
      if (!link) continue;
      const raw = link.getAttribute("href") || link.getAttribute("onclick") || "";
      const rid = (/RICHIESTA_ID=([^&'"]+)/.exec(raw) || [])[1];
      if (!rid || !map[rid]) continue;
      const desc = tr.querySelector('input[name="DESCRIZIONE_TITLE"]')?.value || "";
      const nice = shortLabel(desc.replace(/^\d+-\d+\s*/, "")).trim();
      if (nice && !map[rid]._meta.exams.includes(nice)) map[rid]._meta.exams.push(nice);
    }
    return map;
  }

  function printRowsFor(map, rid) {
    return Object.entries(map[rid] || {}).filter(([k]) => k !== "_meta").map(([, v]) => v)
      .sort((a, b) => Number(a.prog) - Number(b.prog));
  }
  const printMeta = (map, rid) => (map[rid] && map[rid]._meta) || { ts: 0, when: "", exams: [] };
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

  // ------------------------------------------------------------ REFERTI MODEL
  // Result rows on the patient page: the sheet icon before the exam name is
  // <a title="REFERTO" onclick="window.open('…Sa4ViewerExtRedirect.do?…
  // REFERTO_SISTEMA=HL7LIS|HL7RIS|HL7AMB&REFERTO_ID=<uuid>')">. The same cell
  // carries hidden inputs DATA_ORD ("YYYY-MM-DD HH:MM:SS.f") and
  // DESCRIZIONE_TITLE. Archive links (MODALITA=ELENCODOC/…) have no
  // REFERTO_ID and are ignored. The same exam can have MORE than one referto
  // (e.g. a TC with two documents): dedupe by REFERTO_ID only.
  function refertiModel(doc, baseUrl) {
    const out = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll('a[title="REFERTO"]')) {
      const m = /window\.open\(\s*['"]([^'"]+)['"]/.exec(a.getAttribute("onclick") || "");
      if (!m) continue;
      let url;
      try { url = new URL(m[1], baseUrl).href; } catch { continue; }
      const id = param(url, "REFERTO_ID");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const td = a.closest("td");
      const label = (td?.querySelector('input[name="DESCRIZIONE_TITLE"]')?.value ||
                     td?.getAttribute("title") || td?.textContent || "referto")
                    .replace(/\s+/g, " ").trim();
      const dt = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(td?.querySelector('input[name="DATA_ORD"]')?.value || "");
      out.push({
        id, url, label,
        sistema: (param(url, "REFERTO_SISTEMA") || "").replace(/^HL7/, ""),
        ts: dt ? Date.UTC(+dt[1], dt[2] - 1, +dt[3], +dt[4], +dt[5]) : 0,
        when: dt ? `${dt[3]}/${dt[2]} ${dt[4]}:${dt[5]}` : "—",
      });
    }
    out.sort((a, b) => b.ts - a.ts || a.label.localeCompare(b.label));
    return out;
  }

  // Viewers often navigate (by script) to a DIRECT pdf endpoint, e.g. the
  // field-observed label URL:
  //   /UploadDownload/uploaddownloadservlet.rra2?…&mimetype=application/pdf
  // Those URLs are built inside the page, so we harvest them as text and try
  // them in order — never constructing one ourselves.
  const PDF_SMELL = /uploaddownloadservlet|mimetype=application\/pdf|get_pdf|jasperservlet|refertostream|\.pdf(?:[?&"']|$)/i;
  function pdfCandidates(text) {
    const out = [], seen = new Set();
    const push = (raw) => {
      const u = String(raw || "").trim().replace(/&amp;/gi, "&");
      if (!u || u.length < 8 || seen.has(u)) return;
      if (/^(javascript:|#|data:|blob:|mailto:)/i.test(u)) return;
      // must look like a whole URL, not a fragment of one being concatenated
      if (!/^(https?:)?\/|^[\w.-]+\.(?:do|rra2|pdf|jsp)\b/i.test(u)) return;
      if (/[([+=&%]$|%27$/.test(u)) return;
      if (!PDF_SMELL.test(u)) return;
      seen.add(u); out.push(u);
    };
    for (const re of [/"([^"<>\n\r]{8,1200})"/g, /'([^'<>\n\r]{8,1200})'/g]) {
      for (const m of text.matchAll(re)) push(m[1]);
    }
    return out.slice(0, 4);
  }

  const isPdfBlob = (b) => b instanceof Blob && b.size > 4 &&
    (b.type.includes("pdf") || b.type === "" || b.type.includes("octet"));

  // Raised when an endpoint is a client-side VIEWER we can't safely turn into
  // a Blob (see note below). Carries the URL so the caller opens it natively.
  class ViewerError extends StopError {
    constructor(url) { super("È un visualizzatore, non un PDF diretto"); this.viewerUrl = url; }
  }

  // WHY WE DON'T HARVEST THE VIEWER'S BLOB
  // --------------------------------------
  // SA4PSO's label/referto endpoints are HTML pages whose own script builds
  // the PDF and navigates the tab to a blob: URL. Capturing that Blob from a
  // hidden iframe is not safely possible against an unknown viewer:
  //   - a SANDBOXED iframe that navigates to blob: becomes an OPAQUE origin →
  //     we can't read its location or fetch its Blob (verified);
  //   - a NON-sandboxed iframe can read it, but a framebusting viewer would
  //     navigate the doctor's whole tab away (verified — unacceptable).
  // So we only handle PDFs we can get SAFELY: a direct application/pdf
  // response, or a viewer that builds the Blob INLINE in its first document
  // (caught by a short sandboxed replay, which never navigates). Anything else
  // is opened natively in a new tab — exactly the manual fallback the doctor
  // asked for. This never hangs and never hijacks the page.
  let harvestSeq = 0;
  function harvestInlinePdf(url, { html, baseUrl, signal, timeoutMs = 6000 } = {}) {
    return new Promise((resolve, reject) => {
      const cb = `__psaH${++harvestSeq}`;
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts allow-same-origin"); // no top-nav: framebusters are inert
      iframe.style.cssText = "position:fixed;width:2px;height:2px;left:-9999px;top:-9999px;visibility:hidden";
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(tt); clearInterval(iv);
        window.removeEventListener("message", onMsg);
        signal?.removeEventListener("abort", onAbort);
        iframe.remove();
        fn(v);
      };
      const onAbort = () => finish(reject, new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", onAbort, { once: true });
      const tt = setTimeout(() => finish(reject, new ViewerError(url)), timeoutMs);
      const onMsg = (e) => {
        const d = e.data;
        if (!d || d.__psassist !== cb) return;
        if (isPdfBlob(d.blob)) return finish(resolve, { blob: d.blob, url });
        if (typeof d.nav === "string" && d.nav) {
          let u;
          try { u = new URL(d.nav, baseUrl || url); } catch { return; }
          if (u.origin !== location.origin || u.href === (baseUrl || url)) return; // never leave the hospital
          fetch(u.href, { credentials: "same-origin", cache: "no-store" })
            .then((r) => (r.ok ? r.blob() : null))
            .then((blob) => { if (isPdfBlob(blob)) finish(resolve, { blob, url }); })
            .catch(() => {});
        }
      };
      window.addEventListener("message", onMsg);
      document.documentElement.appendChild(iframe);
      // Hook createObjectURL BEFORE the replayed markup runs; postMessage
      // crosses the MV3 isolated world and Blobs survive the structured clone.
      // Prelude + a bounded rewrite of the viewer's own script, so that inside
      // the replay a navigation INTENT (location.replace/assign/href) is handed
      // to us as a URL instead of being attempted, and any Blob it builds is
      // handed over the moment it is created. Both cover viewers that assemble
      // their pdf URL piece by piece.
      const CB = JSON.stringify(cb);
      const prelude = `<script>(function(){
        function nav(u){ try { parent.postMessage({ __psassist: ${CB}, nav: String(u) }, "*"); } catch (e) {} }
        window.__psaNav = nav;
        try { Object.defineProperty(window, "__psaNavHref", { set: nav, get: function(){ return ""; } }); } catch (e) {}
        function hb(b){ try { if (b instanceof Blob) parent.postMessage({ __psassist: ${CB}, blob: b }, "*"); } catch (e) {} }
        var wo = window.open;
        window.open = function(u){ if (u) nav(u); return { closed: false, close: function(){}, focus: function(){}, document: {} }; };
        var m = window.URL.createObjectURL.bind(window.URL);
        window.URL.createObjectURL = function(b){ hb(b); return m(b); };
        if (window.webkitURL && window.webkitURL.createObjectURL) {
          var wm = window.webkitURL.createObjectURL.bind(window.webkitURL);
          window.webkitURL.createObjectURL = function(b){ hb(b); return wm(b); };
        }
      })();<\/script>`;
      const NAV_PREFIX = "(?:(?:window|self|top|parent|document)\\s*\\.\\s*)?";
      const patched = String(html || "")
        .replace(new RegExp(`\\b${NAV_PREFIX}location\\s*\\.\\s*(?:replace|assign)\\s*\\(`, "gi"), "__psaNav(")
        .replace(new RegExp(`\\b${NAV_PREFIX}location\\s*\\.\\s*href\\s*=(?!=)`, "gi"), "__psaNavHref =")
        .replace(new RegExp(`\\b(?:window|self|top)\\s*\\.\\s*location\\s*=(?!=)`, "gi"), "__psaNavHref =");
      const idoc = iframe.contentDocument;
      idoc.open();
      idoc.write(prelude + `<base href="${esc(baseUrl || url)}">` + patched);
      idoc.close();
      const grab = (u, opts) => fetch(u, opts).then((r) => (r.ok ? r.blob() : null))
        .then((blob) => { if (isPdfBlob(blob)) finish(resolve, { blob, url }); }).catch(() => {});
      const iv = setInterval(() => {
        try {
          const w = iframe.contentWindow;
          // (a) the viewer navigated the frame to its real pdf endpoint —
          //     same-origin, so readable (a blob: target would be opaque and
          //     is caught by the createObjectURL hook above instead)
          const href = w && w.location ? w.location.href : "";
          if (href && href.startsWith(location.origin)) {
            return grab(href, { credentials: "same-origin", cache: "no-store" });
          }
          // (b) or embedded the pdf inside its own document
          const el = w?.document?.querySelector('embed[src^="blob:"],iframe[src^="blob:"],object[data^="blob:"]');
          const b = el && (el.getAttribute("src") || el.getAttribute("data"));
          if (b) return grab(b);
        } catch { /* transiently inaccessible (cross-doc or opaque) */ }
      }, 150);
    });
  }

  // Get a PDF SAFELY, or throw ViewerError(url) so the caller opens it in a
  // tab. Same origin/timeout guards as fetchDoc.
  // ------------------------------------------------------- RISULTATI MODEL
  // While a lab request is still being reported, the patient page shows a
  // coloured icon that pops up RcsAccessiRisultatiElenco.do — plain HTML on
  // THIS origin, so the values can be read and shown inside the panel.
  function risultatiModel(doc, baseUrl) {
    const out = [], seen = new Set();
    for (const a of doc.querySelectorAll('a[title="Visualizza Risultati"]')) {
      const m = /window\.open\(\s*['"]([^'"]+)['"]/.exec(a.getAttribute("onclick") || "");
      if (!m) continue;
      let url;
      try { url = new URL(m[1], baseUrl).href; } catch { continue; }
      const id = param(url, "RCS_ACCESSO_ID");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const td = a.closest("td"), tr = a.closest("tr");
      const exams = (td?.getAttribute("title") || "").split(";")
        .map((x) => shortLabel(x.replace(/^\s*\d+-\d+\s*/, "")).trim()).filter(Boolean);
      const dt = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(tr?.querySelector('input[name="DATA_ORD"]')?.value || "");
      out.push({
        id, url, exams,
        ts: dt ? Date.UTC(+dt[1], dt[2] - 1, +dt[3], +dt[4], +dt[5]) : 0,
        when: dt ? `${dt[3]}/${dt[2]} ${dt[4]}:${dt[5]}` : "",
      });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }

  // a value outside its own reference range is worth the eye
  // Is this value outside its reference range? Returns -1 / 0 / +1.
  //
  // Laboratories write ranges in more ways than one ("4 - 10", "< 0.5",
  // "fino a 5", "> 60", "-2 - +2", "4 - 10 x10^3"), and values come with
  // modifiers ("<0.01") or as words ("NEGATIVO"). The rule here is
  // deliberately one-sided: when a format is not understood — or the range
  // depends on something we cannot know, like sex — it returns 0 and the
  // value is shown plain. Never a red mark we cannot justify.
  function outOfRange(value, range) {
    const num = (s) => {
      const m = /-?\d+(?:[.,]\d+)?/.exec(String(s));
      return m ? parseFloat(m[0].replace(",", ".")) : NaN;
    };
    const raw = String(range || "").replace(/\s+/g, " ").trim();
    const vs = String(value).replace(/\s+/g, " ").trim();
    if (!raw || !vs) return 0;
    // "M: 13-17 F: 12-16", or two ranges in one cell: which one applies is not
    // ours to guess
    if (/\b[MF]\s*[:=]/.test(raw)) return 0;
    if ((raw.match(/\s[-–]\s/g) || []).length > 1) return 0;

    const v = num(vs);
    if (!isFinite(v)) return 0;                       // NEGATIVO, Assente, tracce…
    const vLt = /^[<≤]/.test(vs), vGt = /^[>≥]/.test(vs);

    let lo = NaN, hi = NaN;
    const due = /^(-?[\d.,]+)\s*[-–]\s*([+-]?[\d.,]+)/.exec(raw);
    if (due) { lo = num(due[1]); hi = num(due[2]); }
    else if (/^[<≤]|^inf\.?\s*a\b|^fino a\b|^minore\b/i.test(raw)) hi = num(raw);
    else if (/^[>≥]|^sup\.?\s*a\b|^maggiore\b|^oltre\b/i.test(raw)) lo = num(raw);
    else return 0;
    if (!isFinite(lo) && !isFinite(hi)) return 0;
    if (isFinite(lo) && isFinite(hi) && lo > hi) return 0;   // unreadable, not a range

    if (isFinite(lo) && (v < lo || (vLt && v <= lo))) return -1;
    if (isFinite(hi) && (v > hi || (vGt && v >= hi))) return 1;
    return 0;
  }

  function parseRisultati(doc) {
    const rows = [];
    for (const tr of doc.querySelectorAll("tr")) {
      // DIRECT children only: the patient header of the same table nests its own
      // tables, and cells picked up from those made a row look like a result
      const tds = [...tr.querySelectorAll(":scope > td.AFCDataTD")];
      if (tds.length < 5) continue;
      const [nome, valore, um, range, stato, data] = tds.map((t) => t.textContent.replace(/\s+/g, " ").trim());
      if (!nome || !valore) continue;
      // the same table carries the patient header (Assistito, Pronto Soccorso,
      // Quesito…): those rows have no date, no range and no state, and would
      // otherwise show up among the values as a nonsense line
      if (/^(assistito|pronto soccorso|quesito|reparto|medico|paziente|data)\b/i.test(nome)) continue;
      // A result row proves itself: a reporting date, a numeric range, or a
      // laboratory state. The header block of the same table (name, età, CF,
      // quesito) has none of the three, whichever way it is nested.
      const dataOk = /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(data || "");
      const rangeOk = /\d/.test(range || "") && /[-–<>≤≥]|fino a|inf\.|sup\./i.test(range || "");
      const statoOk = /^(parziale|definitiv|refertat|eseguit|in corso|validat|preliminar|provvisori)/i.test(stato || "");
      if (!dataOk && !rangeOk && !statoOk) continue;
      rows.push({ nome, valore, um, range, stato });
    }
    return rows;
  }

  // One chronological list of everything the lab/radiology returned for this
  // patient: values we can read (risultati) and reported documents (referti).
  // what a values row needs to exist on its own, without the page
  const risMeta = (e) => ({ url: e.url, label: e.label || "", exams: e.exams || [], when: e.when || "", ts: e.ts || 0 });

  // What a referto row is, from its own label: decides how it opens today and
  // which ones become inline text when their sources are wired (lab table, RX
  // and ECG referti). Anything else stays a document you open.
  function refertoTipo(e) {
    const l = String(e.label || "").toUpperCase();
    if (/ELETTROCARDIOGRAMM|\bECG\b/.test(l)) return "ecg";
    if (/\bRX\b|RADIOGRAF/.test(l)) return "rx";
    if (/LIS/i.test(e.sistema || "")) return "lab";
    return "altro";
  }

  function esitiModel(doc, baseUrl) {
    const out = [
      ...risultatiModel(doc, baseUrl).map((r) => ({ ...r, kind: "valori", label: r.exams.join(", ") })),
      ...refertiModel(doc, baseUrl).map((r) => ({ ...r, kind: "referto" })),
    ];
    // Once an exam is reported the LIS takes its Risultati window away, and the
    // values we had already read would vanish with it. They are ours: the draws
    // read earlier in this tab stay in the list, marked as read before, each
    // with its own time. They are never attached to a referto — nothing links
    // the two — they simply keep their place.
    const ep = findEpisodeId(doc, baseUrl) || "x";
    const vivi = new Set(out.filter((r) => r.kind === "valori").map((r) => r.id));
    for (const k of tabStore.keys(`ris.${ep}.`)) {
      const id = k.slice(`ris.${ep}.`.length);
      if (!id || vivi.has(id)) continue;
      const v = tabStore.get(k, null);
      if (!v || !v.rows || !v.rows.length || !v.meta) continue;
      out.push({ ...v.meta, id, kind: "valori", storico: true });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }

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
      return { blob: await res.blob(), url: res.url || target.href, via: hop === 0 ? "diretto" : "" };
    }
    if (ctype.includes("html") && hop < 2) {
      const buf = await res.arrayBuffer();
      const text = new TextDecoder("windows-1252").decode(buf);
      const doc = new DOMParser().parseFromString(text, "text/html");
      if (classify(doc) === "login") throw new StopError("Sessione scaduta", "Fai l'accesso a SA4PSO e riprova la stampa.");
      const base = res.url || target.href;
      const tried = [];
      const attempt = async (raw, via) => {
        if (!raw || /^(javascript:|#|about:)/i.test(raw)) return null;
        let u; try { u = new URL(String(raw).replace(/&amp;/gi, "&").trim(), base); } catch { return null; }
        if (u.origin !== location.origin || u.href === base) return null;
        if (tried.includes(u.href)) return null;
        tried.push(u.href);
        try {
          const r = await fetchPdf(u.href, { signal, hop: hop + 1 });
          return r ? { ...r, via: r.via || via } : r;
        } catch (e) { if (e?.name === "AbortError") throw e; return null; }
      };

      // 1. explicit references in the markup (old apps still use <frameset>)
      const domCands = [];
      for (const el of doc.querySelectorAll('frame[src], iframe[src], embed[src], object[data], a[href], form[action]')) {
        const v = el.getAttribute("src") || el.getAttribute("data") || el.getAttribute("href") || el.getAttribute("action");
        const loose = el.tagName === "FRAME" || el.tagName === "IFRAME" || el.tagName === "EMBED" || el.tagName === "OBJECT";
        if (v && (loose || /jasperservlet|uploaddownload|\.pdf|report|stampa/i.test(v))) domCands.push(v);
      }
      const meta = doc.querySelector('meta[http-equiv="refresh" i]')?.getAttribute("content") || "";
      domCands.push((/url\s*=\s*['"]?([^'"\s>]+)/i.exec(meta) || [])[1]);
      for (const m of text.matchAll(/window\.open\(\s*["']([^"']+)["']/gi)) domCands.push(m[1]);
      for (const c of domCands) { const r = await attempt(c, "link nella pagina"); if (r) return r; }

      // 2. a whole direct-pdf URL sitting in the viewer's own script
      for (const c of pdfCandidates(text)) { const r = await attempt(c, "URL nello script"); if (r) return r; }

      // 3. the report id + the endpoint the page itself names: join what the
      //    page already contains (the id IS the document identity; a wrong one
      //    simply 404s and we fall through to opening the viewer natively).
      const idm = /\b([A-Z][A-Z0-9]*_[A-Z0-9]+_\d{6,})\b/.exec(text);
      if (idm && /uploaddownloadservlet|get_pdf/i.test(text)) {
        const r = await attempt(`/UploadDownload/uploaddownloadservlet.rra2?table=DUAL&blobfield=san_report_onthefly.get_pdf(%27${idm[1]}%27)&wherecondition=where%201=1&dataSource=jdbc/sa4web&mimetype=application/pdf`, "id report + endpoint");
        if (r) return r;
      }

      // 4. replay the viewer (sandboxed) and take the URL/Blob it produces
      // In the banco di prova the replay is skipped on purpose: it would run a
      // viewer's own script inside a frame, and the banco's promise is that
      // nothing on the page can reach the network. The tab fallback covers it.
      if (DEMO) throw new ViewerError(target.href);
      try { return { ...(await harvestInlinePdf(target.href, { html: text, baseUrl: base, signal })), via: "replay del visualizzatore" }; }
      catch (e) {
        if (e?.name === "AbortError") throw e;
        const err = new ViewerError(target.href);
        err.diag = `html ${Math.round(text.length / 1024)}KB · ${(text.match(/<script/gi) || []).length} script · ${(text.match(/<frame\b/gi) || []).length} frame · tentati ${tried.length} URL · id ${idm ? "sì" : "no"} · upload ${/uploaddownloadservlet/i.test(text) ? "sì" : "no"}`;
        throw err;
      }
    }
    throw new ViewerError(target.href);
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

  const agoLabel = (ts) => {
    const min = Math.max(0, Math.round((Date.now() - (ts || 0)) / 60000));
    if (min < 1) return "adesso";
    if (min < 60) return `${min} min fa`;
    const d = new Date(ts || 0);
    const today = new Date().toDateString() === d.toDateString();
    return `${today ? "alle" : "ieri"} ${hhmm(ts)}`;
  };
  const hhmm = (ts) => { const d = new Date(ts || 0); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const shortLabel = (l) => String(l).replace(/\s*\([\w./-]*\)\s*$/, "");

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
    keys(prefix) {
      try {
        return Object.keys(sessionStorage).filter((k) => k.startsWith(NS + prefix)).map((k) => k.slice(NS.length));
      } catch { return []; }
    },
  };

  // ------------------------------------------------------- KNOWN PATIENTS
  // The panel remembers the patients worked on during the shift so it can
  // offer them on its home screen. Deliberately minimal and short-lived:
  // name + episode + the page URL, at most 8, forgotten after one shift.
  // Never any clinical content (no exams, no values, no quesito).
  const PATIENTS_TTL = 12 * 3600e3;
  const PATIENTS_MAX = 8;

  function knownPatients() {
    const list = store.get("patients.v1", []);
    const fresh = Array.isArray(list) ? list.filter((p) => p && p.ep && Date.now() - (p.ts || 0) < PATIENTS_TTL) : [];
    return fresh.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, PATIENTS_MAX);
  }
  function rememberPatient(ep, name, url) {
    if (!ep) return;
    const list = knownPatients().filter((p) => p.ep !== ep);
    list.unshift({ ep, name: (name || "").trim().slice(0, 60), url: url || "", ts: Date.now() });
    store.set("patients.v1", list.slice(0, PATIENTS_MAX));
  }
  function forgetPatients() { store.set("patients.v1", []); }
  // end of shift / another user: drop names and every per-episode leftover
  function forgetAll() {
    forgetPatients();
    forgetQuesiti();
    try {
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith(NS) && /(^|\.)(ris|visto|log|refopen|receipt|confirm|queue|print|ui|afterNav)\b/.test(k.slice(NS.length))) sessionStorage.removeItem(k);
      }
    } catch { /* blocked storage: nothing to clear */ }
    try { if (typeof chrome !== "undefined" && chrome.runtime?.id) chrome.runtime.sendMessage({ t: "clearRef" }, () => void chrome.runtime.lastError); } catch { /* not the extension build */ }
  }

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
  // A resource id is site-local: "LABORATORIO ANALISI POC" is 00660001P in one
  // presidio and something else in another, and the same is true of radiology.
  // What travels is the NAME, so that is what we match on — the site suffix
  // ("- SSG (P)") is dropped first. Nothing is ordered on the strength of this
  // alone: the exam's own live name is still checked before every send.
  const chiaveRisorsa = (label) => String(label || "")
    .toUpperCase().replace(/\s+/g, " ")
    .replace(/\s*-\s*[A-Z]{2,5}\s*(\([A-Z]\))?\s*$/, "")
    .replace(/\s*\([A-Z]\)\s*$/, "")
    .trim();
  // the mnemonic the LIS puts in brackets — "EMOCROMOCITOMETRICO URGENTE
  // (POCT1502)" — identifies an exam far better than its numeric code
  const mnemonico = (label) => { const m = /\(([A-Z0-9._-]{3,})\)\s*$/i.exec(String(label || "").trim()); return m ? m[1].toUpperCase() : ""; };
  const normEsame = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

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
  // UI-facing short name (falls back to the catalog label, trimmed of its code)
  const displayLabel = (res, code) => DISPLAY[`${res}:${code}`] || shortLabel(examLabel(res, code));

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
    ui.beginRun(state, plan);
    const log = (msg) => ui.log(`${now()}  ${msg}`);
    // Any fetched page that is a login page means the session died mid-flow.
    const guardSession = (doc, whatMayHaveHappened) => {
      if (classify(doc) === "login") {
        throw new StopError("Sessione scaduta durante l'operazione",
          `${whatMayHaveHappened ? whatMayHaveHappened + ". " : ""}Rifai l'accesso e controlla il carrello.`);
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
    const legTag = plan.legLabel ? ` (${plan.legLabel})` : "";
    const sOpen = plan.startPage === "patient" ? step("Apro la nuova richiesta" + legTag) : null;
    const sCrea = plan.startPage !== "exam" ? step("Compilo quesito e creo la richiesta" + legTag) : null;
    const itemSteps = new Map();
    for (const it of plan.items) itemSteps.set(it, step(it.display || it.label));
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
          throw new StopError("Il server non ha aperto la pagina esami dopo la creazione", "Controlla a mano (vedi Registro).");
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
        const cat = fullCatalog();
        const perChiave = new Map();
        for (const o of model.resOptions) {
          const k = chiaveRisorsa(o.label);
          if (k && !perChiave.has(k)) perChiave.set(k, o);
        }
        for (const i of plan.items) {
          if (!i.res || offered.has(i.res)) continue;
          const atteso = chiaveRisorsa((cat[i.res] && cat[i.res].label) || RES_SHORT[i.res] || "");
          const trovata = atteso ? perChiave.get(atteso) : null;
          if (trovata) {
            log(`risorsa di questo presidio: «${trovata.label}» ${trovata.value} (nel catalogo ${i.res})`);
            i.res = trovata.value;   // the exam's own name is verified before any send
          }
        }
        const wrongRes = plan.items.filter((i) => i.res && !offered.has(i.res));
        if (wrongRes.length) {
          const qui = model.resOptions.map((o) => `«${o.label}» ${o.value}`).join(", ") || "nessuna";
          const cercate = [...new Set(wrongRes.map((i) => `«${(cat[i.res] && cat[i.res].label) || RES_SHORT[i.res] || i.res}» ${i.res}`))].join(", ");
          log(`risorse offerte qui: ${qui} — cercavo: ${cercate}`);
          throw new StopError("Esami non ordinabili in questa richiesta",
            `${wrongRes.map((i) => `«${i.display || i.label}»`).join(", ")}. Questa richiesta offre ${qui}. Nessun esame inviato.`);
        }
      }

      const items = orderItems(plan.items, model.res);
      for (const it of items) {
        const st = itemSteps.get(it);
        const nm = it.display || it.label; // short name for messages
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
          log(`già presente ✓ ${nm}`);
          state.added.push(it);
          continue;
        }
        let link = model.addLink(it.code);
        if (!link && !/^esame \d+$/i.test(it.label)) {
          // The numeric code is site-local too. The exam itself is not: match
          // it by its full name, or by the mnemonic the LIS prints in brackets
          // — and only accept a row whose name is exactly the one chosen.
          const mio = mnemonico(it.label);
          const perNome = model.exams.find((e) => e.isAdd && normEsame(e.label) === normEsame(it.label));
          const perMnemo = !perNome && mio ? model.exams.find((e) => e.isAdd && mnemonico(e.label) === mio) : null;
          const alt = perNome || perMnemo;
          if (alt) {
            log(`codice di questo presidio: ${alt.code} per «${alt.label}» (nel catalogo ${it.code})`);
            it.code = alt.code;
            link = alt;
          }
        }
        if (!link) {
          const gia = model.exams.some((e) => e.code === it.code && e.isDel);
          throw new StopError(`«${nm}» non è nell'elenco di ${RES_SHORT[it.res] || it.res}`,
            gia ? "Risulta già nel carrello: controlla a mano." : "Non inviato. Completa a mano.");
        }
        // Anti wrong-exam guardrail: the LIVE row label must match what the
        // doctor picked. If the hospital ever renumbers a code, every other
        // check would stay green — this one goes red BEFORE anything is sent.
        // (skipped for items carrying only the "esame N" fallback label)
        // Dashes differ between sites ("PANNELLO 1 – ANEMIA" vs "- ANEMIA") and
        // so does the odd word ("EMOGASANALISI MISTA" vs "CAPILLARE", same
        // POC2117). Typography is never a rename, and neither is a different
        // wording carrying the SAME LIS mnemonic — anything else still stops.
        const norm = (s) => s.replace(/[–—‐‑‒−]/g, "-").replace(/\s+/g, " ").trim().toUpperCase();
        if (!/^esame \d+$/i.test(it.label) && norm(link.label) !== norm(it.label)) {
          const mioMn = mnemonico(it.label), suoMn = mnemonico(link.label);
          if (!mioMn || mioMn !== suoMn) {
            throw new StopError(`Il codice ${it.code} oggi si chiama «${link.label}»`, `Selezionato come «${nm}» — non inviato.`);
          }
          log(`stesso esame, nome diverso in questa sede: «${link.label}» (${suoMn})`);
        }

        // ---- the one and only send of this exam -----------------------
        running(st, "invio…");
        log(`aggiungo → ${nm}`);
        ({ doc, url } = await fetchDoc(link.href, { signal }));
        guardSession(doc, `«${nm}» potrebbe essere stato aggiunto o no`);
        assertSameEpisode(doc, url, plan.episodeId, "conferma inserimento");
        if (classify(doc) !== "exam") {
          log(`pagina inattesa dopo l'inserimento: "${snippet(doc)}"`);
          throw new StopError(`«${nm}» potrebbe essere stato aggiunto o no`, "Pagina inattesa dal server (vedi Registro) — non reinviato.");
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
          guardSession(doc, `«${nm}» potrebbe essere stato aggiunto o no`);
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
          throw new StopError(`«${nm}» non risulta nel carrello`, `Verificato ${VERIFY_RECHECKS} volte, non reinviato. Apri il carrello.`);
        }
        done(st, "nel carrello ✓");
        log(`aggiunto ✓ ${nm}`);
        state.added.push(it);
      }

      // ---- 3. hand the visible tab over for review / native confirm -----
      running(sEnd);
      const last = state.added[state.added.length - 1] || null;
      const landUrl = model.listUrl(last ? last.res : model.res);
      state.finishedListUrl = landUrl;
      // Receipt for the landing page: the panel there shows the full,
      // verified accounting (including exams on other resources).
      if (!plan.hold) tabStore.set("receipt.v1", {
        richiestaId: model.richiestaId, episodeId: plan.episodeId, ts: Date.now(),
        quesitoKept: state.quesitoKept || null,
        items: state.added.map((i) => ({ res: i.res, code: i.code, label: i.label, display: i.display || i.label })),
      });
      // Radiology is deliberately excluded from auto-confirm (README, collaudo
      // step 8-9): a booking must always be a human click.
      const isRadio = state.added.some((i) => RADIO_SET.includes(i.res));
      if (plan.autoConfirm && state.added.length && !plan.hold && !isRadio) {
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
        ui.stopped(state, { head: "Interrotto", body: "L'ultimo esame inviato potrebbe essere in carrello: controlla." });
      } else if (err instanceof StopError) {
        log(`⚠ ${err.message}`);
        ui.failed(state, { head: err.head, body: err.body });
      } else {
        log(`⚠ errore imprevisto: ${err?.message || err}`);
        ui.failed(state, { head: "Errore imprevisto", body: `${err?.message || err} — apri il carrello e controlla.` });
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
    .card { width: 460px; max-width: 96vw; max-height: min(92vh, 900px); overflow: auto; background: #fff; border: 1px solid #D9E2EC;
            border-radius: 14px; box-shadow: 0 10px 32px rgba(9,42,74,.22); font-size: 13px; line-height: 1.45; }
    .hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #0B5CAD; color: #fff;
          border-radius: 13px 13px 0 0; position: sticky; top: 0; z-index: 3; cursor: move; user-select: none; touch-action: none; }
    .hd b { font-size: 13.5px; letter-spacing: .2px; }
    .hd .who { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 250px; }
    .pill .who { max-width: 200px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .hd .sub { margin-left: auto; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
    .iconbtn { background: transparent; border: 0; color: #fff; cursor: pointer; font-size: 15px; line-height: 1; padding: 4px 6px; border-radius: 6px; }
    .iconbtn:hover { background: rgba(255,255,255,.18); }
    .pbar { height: 3px; background: #E3E8EF; position: sticky; top: 42px; z-index: 3; }
    .pbar i { display: block; height: 100%; background: #0B5CAD; transition: width .25s ease; }
    /* compact, always-visible selection strip (plain text, not pills) */
    .selbar { position: sticky; top: 42px; z-index: 2; background: #F8FBFE; border-bottom: 1px solid #D9E2EC;
              padding: 7px 12px; font-size: 12px; line-height: 1.8; color: #16232E; box-shadow: 0 6px 10px -8px rgba(9,42,74,.18); }
    .selbar .selgrp { color: #0B5CAD; font-weight: 800; }
    .selbar .selrow { display: block; }
    .selbar .selcount { float: right; color: #5B6B7A; font-size: 10.5px; font-weight: 700; letter-spacing: .4px; }
    .selitem { display: inline; white-space: nowrap; border-radius: 4px; padding: 1px 2px; }
    .selitem:hover { background: #EAF2FA; }
    .selitem .selx { display: none; border: 0; background: #B3261E; color: #fff; border-radius: 999px;
                     width: 15px; height: 15px; line-height: 13px; font-size: 10px; cursor: pointer; padding: 0;
                     vertical-align: 1px; margin-left: 2px; }
    .selitem:hover .selx { display: inline-block; }
    .bd { padding: 12px; }
    .sec { margin-bottom: 14px; }
    .lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #5B6B7A; margin-bottom: 6px; }
    textarea, input[type="text"], input[type="search"] { width: 100%; border: 1px solid #C4D0DC; border-radius: 8px; padding: 8px 10px; font-size: 13px; color: #16232E; background: #fff; }
    textarea:focus-visible, input:focus-visible, .chip:focus-visible, .pbtn:focus-visible, .seg button:focus-visible, .btn:focus-visible, select.res:focus-visible, summary:focus-visible { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; align-items: center; border: 1px solid #C4D0DC; background: #F4F8FB; color: #16232E; border-radius: 999px;
            padding: 6px 12px; font-size: 12.5px; min-height: 28px; cursor: pointer; }
    .chip:hover { border-color: #0B5CAD; }
    .chip.on { background: #0B5CAD; border-color: #0B5CAD; color: #fff; }
    .chip.on::before { content: "✓ "; font-weight: 800; white-space: pre; }
    .chip.q { background: transparent; border-style: dashed; color: #35506B; }
    .chip.q:hover { border-color: #0B5CAD; color: #0B5CAD; }
    .chip.q { padding: 3px 8px; font-size: 11px; min-height: 22px; }
    .qrow { display: flex; gap: 8px; align-items: flex-start; }
    .qrow input { flex: 1 1 52%; min-width: 0; }
    .qchips { flex: 1 1 48%; display: flex; flex-wrap: wrap; gap: 4px; align-content: flex-start; }
    .chip.preset { background: #EAF2FA; border-color: #9DBFDE; font-weight: 600; padding: 5px 11px; font-size: 11.5px; min-height: 26px; }
    /* dense two-column exam grid: many exams, little space, still tappable */
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 5px; }
    .opt { display: flex; align-items: center; gap: 6px; border: 1px solid #E3E8EF; background: #fff; color: #16232E;
           border-radius: 7px; padding: 5px 7px; font-size: 11.5px; line-height: 1.2; cursor: pointer; text-align: left;
           min-height: 27px; overflow: hidden; }
    .opt:hover { border-color: #0B5CAD; background: #F4F8FB; }
    .opt .box { flex: 0 0 13px; width: 13px; height: 13px; border: 1.5px solid #9DBFDE; border-radius: 3px;
                display: inline-grid; place-items: center; font-size: 9px; font-weight: 800; color: transparent; }
    .opt.on { background: #0B5CAD; border-color: #0B5CAD; color: #fff; font-weight: 600; }
    .opt.on .box { background: #fff; border-color: #fff; color: #0B5CAD; }
    .opt .nm { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .grouphdr { grid-column: 1 / -1; font-size: 9.5px; font-weight: 800; letter-spacing: .6px; color: #5B6B7A;
                margin: 5px 0 0; text-transform: uppercase; }
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
    .btnrow { display: flex; gap: 7px; }
    .btnrow .btn { flex: 1 1 auto; min-width: 0; padding: 11px 8px; font-size: 13px; margin: 0;
                   white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btnrow .btn.confirm { flex: 0 1 auto; }
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
    .ac { position: relative; margin-top: 8px; }
    .ac input { width: 100%; }
    .acdrop { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5; background: #fff;
              border: 1px solid #C4D0DC; border-radius: 10px; box-shadow: 0 10px 24px rgba(9,42,74,.18);
              max-height: 260px; overflow: auto; padding: 4px; }
    .acitem { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; background: transparent;
              border-radius: 6px; padding: 6px 8px; font-size: 12px; cursor: pointer; color: #16232E; }
    .acitem:hover { background: #EAF2FA; }
    .acitem.on { color: #177245; font-weight: 600; }
    .acitem.on::after { content: "✓"; margin-left: auto; }
    .acnm { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .actag { flex: 0 0 auto; margin-left: auto; font-size: 9.5px; font-weight: 800; letter-spacing: .4px; color: #5B6B7A;
             background: #F4F8FB; border: 1px solid #E3E8EF; border-radius: 5px; padding: 1px 5px; }
    .acitem.on .actag { margin-left: 0; }
    .acempty { padding: 8px; font-size: 12px; color: #8296A9; }
    .list { border: 1px solid #D9E2EC; border-radius: 10px; max-height: 320px; overflow: auto; margin-top: 6px; }
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
    /* resize grip: bottom-LEFT, because the panel is anchored to the right */
    .rsz { position: absolute; left: 0; bottom: 0; width: 16px; height: 16px; cursor: nesw-resize; z-index: 4;
           background: linear-gradient(45deg, transparent 42%, #C4D0DC 42%, #C4D0DC 56%, transparent 56%,
                                        transparent 66%, #C4D0DC 66%, #C4D0DC 80%, transparent 80%); }
    .rsz:hover { background: linear-gradient(45deg, transparent 42%, #0B5CAD 42%, #0B5CAD 56%, transparent 56%,
                                             transparent 66%, #0B5CAD 66%, #0B5CAD 80%, transparent 80%); }
    .card { position: relative; }
    .commit { position: sticky; bottom: -1px; margin: 0 -12px -12px; padding: 10px 12px 12px; background: #fff;
              border-top: 1px solid #EEF2F6; box-shadow: 0 -10px 14px -12px rgba(9,42,74,.25); }
    .rlist { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow: auto; }
    .rrow { display: flex; align-items: center; gap: 8px; border: 1px solid #E3E8EF; background: #fff; border-radius: 8px;
            padding: 7px 9px; font-size: 12px; cursor: pointer; text-align: left; width: 100%; color: #16232E; }
    .rrow:hover { border-color: #0B5CAD; background: #F4F8FB; }
    .prow { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; width: 100%; text-align: left;
            border: 1px solid #E3E8EF; background: #fff; border-radius: 8px; padding: 6px 9px; cursor: pointer; color: #16232E; }
    .prow:hover { border-color: #0B5CAD; background: #F4F8FB; }
    .prow.hot { border-color: #9DBFDE; background: #EAF2FA; }
    .pline1 { font-size: 12px; font-variant-numeric: tabular-nums; }
    .pline1 small { color: #5B6B7A; font-size: 10.5px; }
    .pline2 { font-size: 10.5px; color: #5B6B7A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

    .rdot { flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid #C4D0DC; background: transparent; }
    .rdot.saved { background: #177245; border-color: #177245; }
    .rdot.open { background: #9DBFDE; border-color: #9DBFDE; }
    .rdot.busy { background: #E5A83B; border-color: #E5A83B; animation: psaPulse 1s infinite; }
    .rdot.err { background: #B3261E; border-color: #B3261E; }
    .rnum { flex: 0 0 auto; color: #B3261E; font-weight: 800; font-size: 10.5px; font-variant-numeric: tabular-nums; }
    .tagp { flex: 0 0 auto; color: #8a4b03; background: #FFF3DB; border-radius: 999px; padding: 1px 7px; font-size: 10px; font-weight: 700; }
    .tagl { flex: 0 0 auto; color: #5B6B7A; background: #EEF2F6; border-radius: 999px; padding: 1px 7px; font-size: 10px; font-weight: 600; }
    .rrow.saved { background: #F6FBF8; border-color: #BCE0C9; }
    .mini { float: right; border: 1px solid #C4D0DC; background: #fff; color: #0B5CAD; border-radius: 6px;
            padding: 1px 7px; font-size: 10.5px; font-weight: 700; cursor: pointer; letter-spacing: 0; text-transform: none; }
    .mini:hover { border-color: #0B5CAD; background: #F4F8FB; }
    .rwhen { flex: 0 0 auto; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; color: #35506B; font-variant-numeric: tabular-nums; }
    .rsys { flex: 0 0 auto; font-size: 9.5px; font-weight: 800; letter-spacing: .5px; color: #5B6B7A; background: #F4F8FB;
            border: 1px solid #E3E8EF; border-radius: 5px; padding: 1px 5px; }
    .rlab { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .seg { display: flex; margin: 10px 12px 0; border: 1px solid #C4D0DC; border-radius: 10px; overflow: hidden; background: #F4F8FB; }
    .seg button { flex: 1 1 50%; border: 0; background: transparent; padding: 9px 8px; min-height: 36px;
                  font-size: 13px; font-weight: 700; color: #35506B; cursor: pointer; }
    .seg button + button { border-left: 1px solid #C4D0DC; }
    .seg button.on { background: #0B5CAD; color: #fff; }
    .seg button:not(.on):hover { background: #EAF2FA; color: #0B5CAD; }
    .seg .n { margin-left: 4px; font-weight: 800; opacity: .7; font-variant-numeric: tabular-nums; }
    .rgo { flex: 0 0 auto; color: #8296A9; font-size: 12px; }
    .egroup, .rgroup { display: flex; flex-direction: column; }
    .pcard { border: 1px solid #E3E8EF; border-radius: 10px; padding: 9px 10px; margin-bottom: 7px; background: #fff; cursor: pointer; }
    .pcard:hover { border-color: #9DBFDE; background: #F4F9FD; }
    .pcard:focus-visible { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    .pgo { float: right; color: #0B5CAD; font-weight: 700; font-size: 11px; }
    .pd { color: #B7791F; font-weight: 800; font-size: 10px; margin-left: 1px; }
    .pcard.now { border-color: #9DBFDE; background: #EAF2FA; }
    .pname { display: flex; align-items: baseline; gap: 8px; font-size: 13.5px; font-weight: 700; margin-bottom: 2px; }
    .ptag { flex: 0 0 auto; font-size: 9.5px; font-weight: 800; letter-spacing: .4px; color: #0B5CAD; background: #EAF2FA;
            border: 1px solid #9DBFDE; border-radius: 999px; padding: 1px 7px; text-transform: uppercase; }
    .pmeta { font-size: 10.5px; color: #5B6B7A; margin-bottom: 7px; font-variant-numeric: tabular-nums; }
    .pname .nm { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .pacts { display: flex; gap: 6px; }
    .pbtn { flex: 1 1 0; border: 1px solid #C4D0DC; background: #fff; color: #16232E; border-radius: 8px;
            padding: 8px 6px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .pbtn:hover { border-color: #0B5CAD; background: #EAF2FA; color: #0B5CAD; }
    .pcard.now .pbtn { background: #fff; }
    .eprev { display: block; width: 100%; text-align: left; border: 1px solid #E3E8EF; border-top: 0;
             border-radius: 0 0 8px 8px; background: #F8FBFE; color: #5B6B7A; cursor: pointer;
             font-size: 11px; line-height: 1.45; padding: 5px 9px 6px;
             display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .eprev:hover { background: #EAF2FA; color: #16232E; }
    .eprev .pit { white-space: nowrap; }   /* sigla and value wrap TOGETHER, never apart */
    .eprev .pn { color: #8296A9; font-weight: 500; }
    .eprev .pv { color: #35506B; font-weight: 700; font-variant-numeric: tabular-nums; }
    .eprev .pv.bad { color: #B3261E; font-weight: 800; }
    /* Novelty rides a different channel: a tint behind the pair (a whole new
       analyte) or behind the number alone (same analyte, new value). Text
       colour is untouched, so red keeps meaning "out of range" and amber
       ▲▼ keeps meaning "moved since the previous draw". */
    .eprev .pit.nuovo, .eprev .pv.agg, .rval .rvv.agg {
      background: #DCEAF9; border-radius: 3px; padding: 0 3px; box-shadow: inset 0 -2px 0 #0B5CAD; }
    .eprev.nuovi { -webkit-line-clamp: unset; }   /* nothing new stays hidden behind the clamp */
    .rval.nuova { border-left: 2px solid #0B5CAD; padding-left: 6px; margin-left: -8px; }
    .rval .rvn.nuovo { background: #DCEAF9; border-radius: 3px; padding: 0 3px; }
    .tagn { flex: 0 0 auto; color: #0B5CAD; background: #EAF2FA; border: 1px solid #9DBFDE;
            border-radius: 999px; padding: 0 7px; font-size: 10px; font-weight: 700; }
    .newbar { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #0B5CAD;
              background: #EAF2FA; border: 1px solid #9DBFDE; border-radius: 8px; padding: 5px 9px; margin-bottom: 6px; }
    .newbar button { margin-left: auto; border: 0; background: transparent; color: #0B5CAD; font: inherit; font-weight: 700; cursor: pointer; }
    .vhide { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .rvals.plain { border: 0; background: transparent; padding: 0; }
    .rvals { border: 1px solid #E3E8EF; border-top: 0; border-radius: 0 0 8px 8px; padding: 4px 8px 6px; background: #F8FBFE; }
    .rval { display: flex; gap: 8px; align-items: baseline; font-size: 11.5px; padding: 2px 0; }
    .rval .rvn { flex: 0 0 84px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #8296A9; }
    .rval .rvv { flex: 0 0 78px; font-weight: 700; font-variant-numeric: tabular-nums; color: #35506B; }
    .rval .rvr { flex: 1 1 auto; font-size: 10px; color: #A3B2C2; text-align: right; }
    .rval.bad .rvv { color: #B3261E; font-weight: 800; }
    .foot { padding: 8px 12px 10px; border-top: 1px solid #EEF2F6; display: flex; justify-content: space-between; align-items: center; color: #5B6B7A; font-size: 11px; }
    .footlink { border: 0; background: transparent; color: #0B5CAD; font-size: 11px; cursor: pointer; padding: 0; text-decoration: underline; }
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
  }
  const hasExt = () => { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch { return false; } };
  const ask = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || { ok: false }); }); }
    catch { res({ ok: false }); }
  });

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
      const saved = tabStore.get("log." + (findEpisodeId(document, location.href) || "x"), null);
      this.logLines = saved && Date.now() - (saved.ts || 0) < 2 * 3600e3 ? saved.lines || [] : [];
      this.runState = null; // null | 'running' | 'done' | 'fail' | 'stopped'
      this.runData = null;
      this.message = null;  // string (inline) or {head, body} (result banner)
      this.stopFn = null;
      this.host = document.createElement("div");
      this.host.id = "psassist-host";
      this.root = this.host.attachShadow({ mode: "open" });
      document.documentElement.appendChild(this.host);
      this.collapsed = store.get("collapsed", false);
      this.acq = "";           // catalog search text
      this.referti = [];                // patient page: result rows, newest first
      this.risultati = [];              // lab values still being reported
      this.esiti = [];                  // risultati + referti, newest first
      this.pos = store.get("pos", null); // user-dragged panel position {left, top}
      this.size = store.get("size", null); // user-resized panel {w, h}
      this.runPatient = null;           // patient name PINNED when a run starts
      this.episodeId = findEpisodeId(document, location.href);
      this.view = null;                 // home | richieste | esiti | valori
      this.viewId = null;               // which esito is open in 'valori'
      // The header must always show the patient this page belongs to: follow
      // any <title> change (the EHR sets it to the patient name).
      const titleEl = document.querySelector("title");
      if (titleEl) {
        this._titleObs = new MutationObserver(() => {
          if (this.runState !== "running") this.render();
        });
        this._titleObs.observe(titleEl, { childList: true, characterData: true, subtree: true });
      }
      this._unload = (e) => { e.preventDefault(); e.returnValue = ""; };
      this._esc = (e) => { if (e.key === "Escape" && this.runState === "running") this.stop(); };
      window.addEventListener("keydown", this._esc, true);
    }

    // ---- cross-page continuity -------------------------------------------
    // The EHR reloads the page at every click (that's the app, not us). To
    // make the panel FEEL persistent, its working state — quesito, selected
    // exams, open sections — is saved per (tab,
    // episode) and restored on the next page of the SAME patient. A page of
    // another episode restores nothing.
    uiKey() { return this.episodeId ? `ui.${this.episodeId}` : null; }
    // the view is per (tab, episode) like the rest of the working state
    refKey() { return "refopen." + (this.episodeId || "x"); }
    risKey(id) { return `ris.${this.episodeId || "x"}.${id}`; }
    // what this draw looked like the last time the doctor actually looked at it
    vistoKey(id) { return `visto.${this.episodeId || "x"}.${id}`; }
    segnaVisto(id, rows) {
      const vals = {};
      for (const r of rows || []) { const k = valKey(r.nome); if (k) vals[k] = String(r.valore); }
      tabStore.set(this.vistoKey(id), { ts: Date.now(), vals });
    }
    // key → "nuovo" (analyte that was not there) | "cambiato" (value moved
    // since the last look). Empty until there IS a previous look: the first
    // read of a draw is the baseline, never a wall of marks.
    novita(id, rows) {
      const out = new Map();
      const seen = tabStore.get(this.vistoKey(id), null);
      if (!seen || !seen.vals) return out;
      for (const r of rows || []) {
        const k = valKey(r.nome);
        if (!k) continue;
        if (!(k in seen.vals)) out.set(k, "nuovo");
        else if (seen.vals[k] !== String(r.valore)) out.set(k, "cambiato");
      }
      return out;
    }
    setView(v, id) {
      // leaving a draw's values means they have been read: that is when the
      // "nuovi" marks are cleared, never on the render that has to show them
      if (this.view === "valori" && this.viewId && !(v === "valori" && id === this.viewId)) this.marcaLetto(this.viewId);
      this.view = v; this.viewId = id || null; this.persistUi(); this.render();
    }
    marcaLetto(id) {
      const held = tabStore.get(this.risKey(id), null);
      if (held && held.rows) this.segnaVisto(id, held.rows);
    }
    // ordering is the 90% action: land there whenever this page can order.
    defaultView() {
      if (this.pageType !== "patient") return "richieste";
      return this.entry && (this.entry.labUrl || this.entry.radioUrl) ? "richieste" : "home";
    }
    persistUi() {
      const k = this.uiKey();
      if (!k) return;
      tabStore.set(k, {
        q: this._q || "",
        sel: [...this.selected.values()].map((i) => [i.res, i.code, i.label]),
        acq: this.acq || "",
        view: this.view === "home" ? "richieste" : this.view,
        viewId: this.viewId,
        ts: Date.now(),
      });
    }
    applyAfterNav() {
      const a = tabStore.get("afterNav.v1", null);
      if (!a || a.ep !== this.episodeId || Date.now() - (a.ts || 0) > 60e3) return;
      tabStore.set("afterNav.v1", null);
      this.view = a.view; this.viewId = null; this.persistUi();
    }

    restoreUi() {
      const k = this.uiKey();
      const s = k ? tabStore.get(k, null) : null;
      if (!s || Date.now() - (s.ts || 0) > 6 * 3600e3) {
        this._q = store.get("lastQ", "") || ""; // keep the last quesito typed
        this.view = this.defaultView() === "home" ? "home" : (this.view || this.defaultView());
        return;
      }
      this._q = s.q || store.get("lastQ", "") || "";
      this.selected = new Map((s.sel || []).map(([res, code, label]) => [this.key(res, code), { res, code, label, display: displayLabel(res, code) }]));
      this.acq = s.acq || "";
      // A page load decides the view, not the stored one: opening a patient
      // from the EHR means "act" and lands on Richieste; coming from a panel
      // card means "see" and afterNav switches to Esiti right after this.
      // (The ER worklist stays on the patient list either way.)
      this.view = this.defaultView();
      this.viewId = null;
    }
    clearOrderUi() { // after a successful run the order is placed: start clean
      this._q = "";
      this.selected.clear();
      this.persistUi();
    }

    // ---- selection ----
    key(res, code) { return `${res}:${code}`; }
    isSel(res, code) { return this.selected.has(this.key(res, code)); }
    toggle(res, code) {
      if (this.acq) this.acFocus = true; // stay in the search box
      const k = this.key(res, code);
      if (this.selected.has(k)) this.selected.delete(k);
      else this.selected.set(k, { res, code, label: examLabel(res, code), display: displayLabel(res, code) });
      this.persistUi();
      this.render();
    }
    togglePreset(p) {
      const allOn = p.items.every(([r, c]) => this.isSel(r, c));
      for (const [r, c] of p.items) {
        const k = this.key(r, c);
        if (allOn) this.selected.delete(k);
        else this.selected.set(k, { res: r, code: c, label: examLabel(r, c), display: displayLabel(r, c) });
      }
      this.persistUi();
      this.render();
    }

    // Copy the log for reporting. The quesito is the only clinical text that
    // can end up in it, so it is masked out before leaving the page.
    async copyLog() {
      const head = [
        `PS Assist ${VERSION} · pagina ${this.pageType}`,
        `${navigator.userAgent}`,
        `${new Date().toLocaleString("it-IT")}`,
        "",
      ].join("\n");
      const body = this.logLines.join("\n").replace(/(quesito[^:]*:\s*)"[^"]*"/gi, '$1"…"');
      const text = head + body;
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fallback below */ }
      if (!ok) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        ta.remove();
      }
      const b = this.root.querySelector("#copylog");
      if (b) { b.textContent = ok ? "✓ copiato" : "copia non riuscita"; setTimeout(() => { if (b.isConnected) b.textContent = "⧉ Copia"; }, 2000); }
    }

    log(line) {
      this.logLines.push(line);
      if (this.logLines.length > 200) this.logLines.shift();
      tabStore.set("log." + (this.episodeId || "x"), { ts: Date.now(), lines: this.logLines });
      const el = this.root.querySelector(".log");
      if (el) { el.textContent = this.logLines.join("\n"); el.scrollTop = el.scrollHeight; }
    }

    // ---- engine callbacks ----
    beginRun(state, plan) {
      // a chained second richiesta keeps the first one's steps on screen
      if (plan && plan.continuation && this.runData && this.runData.steps) state.steps.unshift(...this.runData.steps);
      this.runState = "running"; this.runData = state; this.stopFn = state.stop;
      if (this.collapsed) { this.collapsed = false; store.set("collapsed", false); }
      window.addEventListener("beforeunload", this._unload); // a run must not die silently
      this.render();
    }
    renderRun(state) { this.runData = state; this.render(); }
    finished(state, plan) {
      if (plan.hold) { this.runData = state; this.render(); return; } // the chain finishes for us
      window.removeEventListener("beforeunload", this._unload);
      this.clearOrderUi(); // the order is placed: next page starts clean
      this.runState = "done"; this.runData = state;
      const n = state.added.length;
      this.message = {
        head: `✓ ${n} ${n === 1 ? "esame" : "esami"} in carrello, ${n === 1 ? "verificato" : "verificati"}`,
        body: state.quesitoKept ? "Quesito del triage mantenuto." : "",
      };
      this.render();
      if (state.finishedListUrl) setTimeout(() => nav(state.finishedListUrl), 900);
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
      this.log(`${now()}  ── nuova operazione ──`);
      this.message = null;
      tabStore.set("receipt.v1", null);
      // Pin the patient this run belongs to: the running/result views show
      // THIS name, never whatever the page title becomes later.
      this.runPatient = (document.title || "").trim();
      const plan = { quesito: (this._q || "").trim(), items, episodeId, patientName: this.runPatient, ...base };
      if (plan.quesito) rememberQuesito(plan.quesito);
      if (plan.legs && plan.legs.length > 1) this.runChain(plan);
      else runPlan(plan, this); // fire and forget; the engine drives the UI via callbacks
    }

    // Lab and radiology cannot share a richiesta, so when both are selected we
    // build them one after the other and then walk the doctor through both
    // confirmations (and one single print flow at the end).
    async runChain(plan) {
      const done = [];
      for (let i = 0; i < plan.legs.length; i++) {
        const leg = plan.legs[i];
        const st = await runPlan({
          ...plan, hold: true, continuation: i > 0,
          entryUrl: leg.entryUrl, items: leg.items, legLabel: leg.label,
        }, this);
        if (this.runState !== "running" || !st || !st.richiestaId) return; // failed/stopped: stop here
        done.push({
          rid: st.richiestaId, listUrl: st.finishedListUrl || st.lastListUrl, kind: leg.kind,
          count: st.added.length,
          lastCode: st.added.length ? st.added[st.added.length - 1].code : null,
          lastLabel: st.added.length ? st.added[st.added.length - 1].label : null,
          added: st.added.map((x) => ({ res: x.res, code: x.code, label: x.label, display: x.display || x.label })),
        });
      }
      if (!done.length) return;
      window.removeEventListener("beforeunload", this._unload);
      this.clearOrderUi();
      this.runState = "done";
      const total = done.reduce((n, d) => n + d.count, 0);
      this.message = { head: `✓ ${done.length} richieste, ${total} esami verificati`, body: "" };
      // hand the rest of the walk to the pages we are about to land on
      const first = done[0];
      tabStore.set("queue.v1", { episodeId: plan.episodeId, autoConfirm: !!plan.autoConfirm, ts: Date.now(), items: done });
      tabStore.set("receipt.v1", { richiestaId: first.rid, episodeId: plan.episodeId, ts: Date.now(), items: first.added });
      if (plan.autoConfirm && first.lastCode && first.kind !== "radio") {
        tabStore.set("confirm.v1", { richiestaId: first.rid, episodeId: plan.episodeId, lastCode: first.lastCode, lastLabel: first.lastLabel, count: first.count, ts: Date.now() });
      }
      this.render();
      if (first.listUrl) setTimeout(() => nav(first.listUrl), 900);
    }

    // ---- live validation (before anything is sent) ----
    computeProblems() {
      const items = [...this.selected.values()];
      const problems = { go: [], confirm: [] };
      const both = (m) => { problems.go.push(m); problems.confirm.push(m); };
      const wantsRadio = items.some((i) => RADIO_SET.includes(i.res));
      const wantsLab = items.some((i) => !RADIO_SET.includes(i.res));
      if (this.pageType === "patient") {
        if (items.length && !(this._q || "").trim()) both("Scrivi il quesito diagnostico prima di creare la richiesta.");
        if (wantsRadio && !wantsLab && !this.entry?.radioUrl) both("Link Richieste Radiologia non trovato su questa pagina.");
        if (wantsLab && !this.entry?.labUrl) both("Link Richieste Laboratorio non trovato su questa pagina.");
      } else if (this.pageType === "crea") {
        const allowed = new Set((param(location.href, "RISORSE") || "").split(",").filter(Boolean));
        if (allowed.size) {
          const wrong = items.filter((i) => i.res && !allowed.has(i.res));
          if (wrong.length) both(`Non ordinabili in questa richiesta: ${wrong.map((i) => i.display || shortLabel(i.label)).join(", ")}.`);
        }
        const form = document.forms.namedItem("RICHIESTACrea");
        const pageQ = (form?.elements?.namedItem("QUESITO_DIAGNOSTICO")?.value || "").trim();
        if (items.length && !pageQ && !(this._q || "").trim()) both("Scrivi il quesito diagnostico (nel pannello o nella pagina).");
      } else if (this.pageType === "exam") {
        const live = examModel(document, location.href);
        const offered = new Set(live.resOptions.map((o) => o.value));
        if (offered.size) {
          const wrong = items.filter((i) => i.res && !offered.has(i.res));
          if (wrong.length) both(`Non ordinabili in questa richiesta: ${wrong.map((i) => i.display || shortLabel(i.label)).join(", ")}.`);
        }
      }

      return problems;
    }

    // =============================================================== VIEWS
    // Compact always-visible selection strip: plain text grouped by resource
    // ("POC: EMOGAS, EMOCROMO · URGENZE: PCT"), an ✕ appears on hover.
    selbarHtml() {
      if (!this.selected.size) return "";
      if (this.pageType === "patient" && !(this.entry && (this.entry.labUrl || this.entry.radioUrl))) return "";
      const byRes = {};
      for (const i of this.selected.values()) (byRes[i.res] = byRes[i.res] || []).push(i);
      const groups = Object.entries(byRes).map(([r, arr]) => {
        const items = arr.map((i) =>
          `<span class="selitem" title="${esc(i.label)}">${esc(i.display || shortLabel(i.label))}<button class="selx" data-unsel="${esc(this.key(i.res, i.code))}" title="Rimuovi" aria-label="Rimuovi ${esc(i.display || shortLabel(i.label))}">✕</button></span>`
        ).join(", ");
        return `<span class="selgrp">${esc((RES_SHORT[r] || r).toUpperCase())}:</span> ${items}`;
      });
      return `<div class="selbar"><span class="selcount">${this.selected.size} SELEZIONATI</span>${groups.map((g) => `<div class="selrow">${g}</div>`).join("")}</div>`;
    }

    render() {
      const patientName = (document.title || "").trim();
      const ep = findEpisodeId(document, location.href);
      // keep every scroll position across re-renders (chip toggles must not
      // bounce the panel back to the top)
      const keepScroll = [".card", ".list", ".rlist"].map((s) => [s, this.root.querySelector(s)?.scrollTop || 0]);

      let body;
      if (this.runState === "running") body = this.viewRunning();
      else if (this.runState) body = this.viewResult();
      else if (this.view === "esiti") body = this.viewEsiti();
      else if (this.view === "valori") body = this.viewValori();
      else if (this.view === "richieste") body = this.viewIdle(patientName, ep);
      else body = this.viewHome(patientName, ep);

      const running = this.runState === "running";
      const total = this.runData?.steps?.length || 0;
      const doneN = this.runData?.steps?.filter((s) => s.status === "ok").length || 0;
      // The panel is titled by the PATIENT it is acting on — collapsed too.
      const who = (running && this.runPatient) || patientName || APP;
      const pillInner = running
        ? `<span class="dot"></span> <span class="who">${esc(who)}</span> <span class="badge">${doneN}/${total}</span>`
        : this.selected.size
          ? `${LOGO} <span class="who">${esc(who)}</span> <span class="badge">${this.selected.size}</span>`
          : `${LOGO} <span class="who">${esc(who)}</span>`;

      // whose data is on screen must be answerable at a glance, always:
      // patient in the title, episode always next to the section name.
      const inHome = !this.runState && this.view === "home";
      const section = this.runState ? "" : { richieste: "Richieste", esiti: "Esiti", valori: "Valori" }[this.view] || "";
      const sub = inHome ? "ultime 12 ore"
        : section ? `${section}${ep ? " · " + esc(ep) : ""}`
        : (ep ? "episodio " + esc(ep) : esc(APP));
      // user-resized size (clamped so it always fits the screen)
      let sizeStyle = "";
      if (this.size && this.size.w) {
        const w = Math.max(320, Math.min(window.innerWidth - 20, this.size.w));
        sizeStyle += `width:${w}px;`;
        if (this.size.h) sizeStyle += `max-height:${Math.max(240, Math.min(window.innerHeight - 20, this.size.h))}px;`;
      }
      // user-dragged position (clamped to the current viewport), else top-right
      let posStyle = "";
      if (this.pos && Number.isFinite(this.pos.left) && Number.isFinite(this.pos.top)) {
        const left = Math.max(0, Math.min(window.innerWidth - 80, this.pos.left));
        const top = Math.max(0, Math.min(window.innerHeight - 48, this.pos.top));
        posStyle = `left:${left}px;top:${top}px;right:auto;`;
      }

      this.root.innerHTML = `
        <style>${COLORS}</style>
        <div class="wrap" style="${posStyle}">
          ${this.collapsed ? `
            <button class="pill" id="expand" title="${esc(who)}${ep ? " · episodio " + esc(ep) : ""} — ${esc(APP)}, trascina per spostare">${pillInner}</button>
          ` : `
            <div class="card" role="dialog" aria-label="${esc(APP)}" style="${sizeStyle}">
              <div class="hd" id="draghd" title="Trascina per spostare · doppio click per riportare in alto a destra">
                ${section ? `<button class="iconbtn" id="back" title="${this.view === "valori" ? "Torna agli esiti" : "Tutti i pazienti"}">‹</button>` : LOGO}<b class="who">${esc(inHome ? "Pazienti" : who)}</b>
                <span class="sub" title="${esc(who)} — episodio ${esc(ep || "?")}">${sub}</span>
                <button class="iconbtn" id="collapse" title="Riduci">—</button>
              </div>
              ${running && total ? `<div class="pbar"><i style="width:${Math.round((doneN / Math.max(total, 1)) * 100)}%"></i></div>` : ""}
              ${!this.runState && this.pageType === "patient" && this.entry && (this.entry.labUrl || this.entry.radioUrl) && this.view !== "home" ? `
                <div class="seg">
                  <button class="${this.view === "richieste" ? "on" : ""}" data-seg="richieste">Richieste</button>
                  <button class="${this.view === "richieste" ? "" : "on"}" data-seg="esiti">Esiti${this.esiti.length ? ` <span class="n">${this.esiti.length}</span>` : ""}</button>
                </div>` : ""}
              ${!this.runState ? this.selbarHtml() : ""}
              <div class="bd">${body}</div>
              <div class="rsz" id="rsz" title="Trascina per ridimensionare · doppio click per la misura originale"></div>
              ${inHome ? `<div class="foot">
                <span><button id="verbtn" class="footlink" title="Mostra il Registro delle operazioni">${esc(APP)} ${VERSION}</button>${(typeof chrome !== "undefined" && chrome.runtime?.id)
                  ? ` · <button id="extreload" class="footlink" title="Dopo aver sostituito i file nella cartella dell'estensione, questo la ricarica con la nuova versione">⟳ ricarica estensione</button>` : ""}</span>
                <span></span>
              </div>` : ""}
            </div>
          `}
        </div>`;
      this.bind();
      for (const [sel, top] of keepScroll) {
        const el = this.root.querySelector(sel);
        if (el && top) el.scrollTop = top;
      }
    }

    // HOME — the patients this shift. Picking one of the OTHERS navigates to
    // their page first: the panel never shows data belonging to a patient
    // other than the page in front of you.
    viewHome(patientName, ep) {
      const list = knownPatients();
      const here = ep ? list.filter((p) => p.ep === ep) : [];
      const others = list.filter((p) => p.ep !== ep);
      const canOrder = !!(this.entry && (this.entry.labUrl || this.entry.radioUrl));
      // The card itself opens the Esiti — from the panel you go to a patient to
      // SEE something. Ordering stays one small button away; opening him from
      // the EHR instead lands on Richieste (that navigation means "act").
      const card = (p, current) => `
        <div class="pcard ${current ? "now" : ""}" data-go="esiti" data-ep="${esc(p.ep)}" role="button" tabindex="0" title="Apri gli esiti di ${esc(p.name || "questo paziente")}">
          <div class="pname"><span class="nm">${esc(p.name || "paziente")}</span>${current ? `<span class="ptag">qui</span>` : ""}</div>
          <div class="pmeta">${current ? `episodio ${esc(p.ep)}` : esc(agoLabel(p.ts))}<span class="pgo">Esiti ›</span></div>
          <div class="pacts">
            <button class="pbtn" data-go="richieste" data-ep="${esc(p.ep)}">Richieste</button>
          </div>
        </div>`;
      const cards = [
        ...here.map((p) => card({ ...p, name: patientName || p.name }, true)),
        ...(here.length ? [] : ep && canOrder ? [card({ ep, name: patientName, ts: Date.now() }, true)] : []),
        ...others.map((p) => card(p, false)),
      ].join("");
      return `
        <div class="sec">
          <div class="lbl">Pazienti${others.length ? `<button class="mini" id="forget">svuota</button>` : ""}</div>
          ${cards || `<div class="hint">Nessun paziente ancora. Apri un paziente: resta qui per il turno.</div>`}
          ${others.length ? `<div class="hint">Aprire un altro paziente ne carica la pagina.</div>` : ""}
          ${this.showLog ? `<details class="reg" open><summary>Registro <button class="mini" id="copylog" title="Copia il registro negli appunti (il quesito viene omesso)">⧉ Copia</button></summary><div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div></details>` : ""}
        </div>`;
    }

    viewIdle(patientName, ep) {
      const cat = fullCatalog();
      // On the ER worklist (no patient open) nothing can be ordered: show no
      // exams at all rather than a picker that would dead-end.
      const canOrder = this.pageType === "exam" || this.pageType === "crea" ||
        (this.pageType === "patient" && !!(this.entry && (this.entry.labUrl || this.entry.radioUrl)));
      if (!canOrder) {
        const extra = this.viewPrint();
        return `${extra}<div class="hint" style="margin:2px 0 0">Apri un paziente per creare richieste.</div>`;
      }
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
          receiptSec = `
            <div class="banner ok"><b>✓ ${n} ${n === 1 ? "esame" : "esami"} in carrello, ${n === 1 ? "verificato" : "verificati"}</b></div>
            ${live.confirmButton ? `<button class="btn confirm" id="confirmnow" style="margin-bottom:12px">✓ CONFERMA → stampa</button>` : ""}`;
        }
      }

      const quesitoSec = canOneClick ? `
        <div class="sec">
          <div class="lbl">Quesito diagnostico</div>
          <div class="qrow">
            <input id="q" type="text" placeholder="Es. dolore toracico in atto…" value="${esc(this._q || "")}">
            <div class="qchips">${quesiti.slice(0, 6).map((q) => `<button class="chip q" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
          </div>
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
              ${elsewhere.map((i) => `<span class="chip ghosted" title="verificato su ${esc(RES_SHORT[i.res] || i.res)}">${esc(i.display || shortLabel(i.label))} · ${esc(RES_SHORT[i.res] || i.res)} ✓</span>`).join("")}
            </div>
          </div>`;
      }

      const presetHtml = PRESETS.map((p, i) => {
        const ok = p.items.every(([r, c]) => cat[r]?.items?.[c]);
        if (!ok) return "";
        const on = p.items.every(([r, c]) => this.isSel(r, c));
        return `<button class="chip preset ${on ? "on" : ""}" data-preset="${i}">${esc(p.name)}</button>`;
      }).join("");
      const byLab = {};
      for (const [r, c] of SINGLES) if (cat[r]?.items?.[c]) (byLab[r] = byLab[r] || []).push(c);
      const singles = Object.entries(byLab).map(([r, codes]) => `
        <div class="grouphdr">${esc(RES_SHORT[r] || r)}</div>
        ${codes.map((c) => {
          const on = this.isSel(r, c);
          return `<button class="opt ${on ? "on" : ""}" data-res="${esc(r)}" data-code="${esc(c)}" title="${esc(examLabel(r, c))} — ${esc(RES_SHORT[r] || r)}"><span class="box">✓</span><span class="nm">${esc(displayLabel(r, c))}</span></button>`;
        }).join("")}`).join("");

      const n = this.selected.size;
      const nTxt = n === 0 ? "esami" : n === 1 ? "1 esame" : `${n} esami`;
      const twoLegs = this.pageType === "patient" &&
        [...this.selected.values()].some((i) => RADIO_SET.includes(i.res)) &&
        [...this.selected.values()].some((i) => !RADIO_SET.includes(i.res));
      const goLabel = this.pageType === "exam" ? `Aggiungi ${nTxt}`
        : twoLegs ? `Crea 2 richieste · ${nTxt}` : `Crea e aggiungi ${nTxt}`;
      const confirmLabel = `+ Conferma 🖨`;

      const problems = this.computeProblems();

      const pendingSec = this.pending ? `
        <button class="btn confirm" id="goqueued" style="margin-bottom:12px">→ Conferma ${esc(this.pending.next.kind === "radio" ? "la radiologia" : "il laboratorio")} (${this.pending.next.count})</button>` : "";
      return `
        ${pendingSec}
        ${receiptSec}
        ${quesitoSec}
        ${cartSec}
        <div class="sec">
          ${presetHtml ? `<div class="lbl">Profili rapidi</div><div class="chips">${presetHtml}</div>` : ""}
          <div class="lbl" style="margin-top:10px">Esami singoli</div>
          <div class="grid">${singles}</div>
          ${this.viewBrowse(cat)}
        </div>
        ${this.viewPrint()}

        <div class="commit">
          ${typeof this.message === "string" && this.message ? `<div class="banner warn">${esc(this.message)}</div>` : ""}
          <div class="idline">Richiesta per <b>${esc(patientName)}</b>${ep ? ` · episodio <b>${esc(ep)}</b>` : ""}</div>
          <div id="problems">${problems.go[0] ? `<div class="problem">${esc(problems.go[0])}</div>` : ""}</div>
          <div class="btnrow">
            <button class="btn primary" id="go" ${n && !problems.go.length ? "" : "disabled"}>${esc(goLabel)}</button>
            <button class="btn confirm" id="goconfirm" title="Come il bottone a sinistra, e in più preme Conferma per te (conto alla rovescia annullabile con Esc) e avvia la stampa guidata" ${n && !problems.confirm.length ? "" : "disabled"}>${esc(confirmLabel)}</button>
          </div>

        </div>
      `;
    }

    // Patient page: reprint any richiesta's PDFs (labels → label printer,
    // exam list → normal printer) through the sequential wizard.
    viewPrint() {
      if (this.pageType !== "patient") return "";
      const map = printModel(document, location.href);
      const rids = Object.keys(map).sort((a, b) => (printMeta(map, b).ts - printMeta(map, a).ts) || Number(b) - Number(a));
      if (!rids.length) return "";
      const receipt = freshReceipt(null);
      const hot = receipt && map[receipt.richiestaId] ? receipt.richiestaId : null;
      const rows = rids.slice(0, 6).map((rid) => {
        const m = printMeta(map, rid);
        const exams = m.exams.join(", ");
        return `<button class="prow ${rid === hot ? "hot" : ""}" data-print="${esc(rid)}" title="Richiesta ${esc(rid)} — ${esc(printLabelFor(map, rid))}">
          <span class="pline1">🖨 <b>${esc(m.when || "richiesta " + rid)}</b> <small>${esc(printLabelFor(map, rid))}</small></span>
          ${exams ? `<span class="pline2">${esc(exams)}</span>` : ""}
        </button>`;
      }).join("");
      return `
        <div class="sec">
          <div class="lbl">Stampa</div>
          <div class="rlist">${rows}</div>

        </div>`;
    }

    // Values are fetched once per accesso and kept for the tab, so reopening
    // is instant; ↻ pulls them again while the lab is still completing.
    // ESITI — one chronological list: values we can read, and reported PDFs.
    // Row = open it (values expand / PDF opens). The 2-line preview under a
    // saved row is its own target: it opens the full values screen.
    // every draw whose values this tab has, newest first — the basis for the
    // shared ordering and the change marks
    prelieviLetti() {
      return this.esiti
        .filter((e) => e.kind === "valori")
        .map((e) => ({ id: e.id, rows: (tabStore.get(this.risKey(e.id), null) || {}).rows || [] }))
        .filter((d) => d.rows.length);
    }

    viewEsiti() {
      if (!this.esiti.length) return `<div class="hint">Nessun esito per questo paziente.</div>`;
      const cmp = confrontaPrelievi(this.prelieviLetti());
      const open = new Set(tabStore.get(this.refKey(), []));
      const cached = this.refCache || {};
      const busy = this.refBusy || {};
      const rows = this.esiti.map((e) => {
        const vals = e.kind === "valori" ? tabStore.get(this.risKey(e.id), null) : null;
        const state = e.kind === "valori"
          ? (vals ? "saved" : busy[e.id] === true ? "busy" : typeof busy[e.id] === "string" ? "err" : "")
          : (cached[e.id] ? "saved" : busy[e.id] === true ? "busy" : typeof busy[e.id] === "string" ? "err" : open.has(e.id) ? "open" : "");
        const why = typeof busy[e.id] === "string" ? busy[e.id] : "";
        const dd = cmp.delta.get(e.id);
        const nov = vals && vals.rows ? this.novita(e.id, vals.rows) : new Map();
        const nNuovi = [...nov.values()].filter((x) => x === "nuovo").length;
        const nAgg = nov.size - nNuovi;
        const preview = vals && vals.rows && vals.rows.length
          ? `<button class="eprev${nov.size ? " nuovi" : ""}" data-vals="${esc(e.id)}" title="Vedi tutti i valori">${
              ordinaRighe(vals.rows, cmp.order)
                .slice(0, nov.size ? 40 : 12)
                .map((v) => {
                  const oo = outOfRange(v.valore, v.range);
                  const k = valKey(v.nome);
                  const d = dd && dd.get(k);
                  const n = nov.get(k);
                  const tip = [n === "nuovo" ? "nuovo" : n === "cambiato" ? "aggiornato" : "",
                               d ? `prima ${d.prevRaw} (${d.pct > 0 ? "+" : ""}${d.pct}%)` : ""].filter(Boolean).join(" · ");
                  return `<span class="pit${n === "nuovo" ? " nuovo" : ""}"><span class="pn">${esc(sigla(v.nome))}</span> <span class="pv${oo ? " bad" : ""}${n === "cambiato" ? " agg" : ""}"${tip ? ` title="${esc(tip)}"` : ""}>${esc(v.valore)}${oo ? (oo < 0 ? "↓" : "↑") : ""}</span>${n ? `<span class="vhide"> ${n === "nuovo" ? "nuovo" : "aggiornato"}</span>` : ""}${d ? `<span class="pd">${d.dir}</span>` : ""}</span>`;
                }).join(" · ")}</button>`
          : "";
        return `<div class="egroup">
          <button class="rrow ${esc(state)}" data-esito="${esc(e.id)}" data-kind="${esc(e.kind)}" title="${esc(e.label)}${why ? " — " + esc(why) : ""}">
            <span class="rdot ${esc(state)}"></span>
            <span class="rwhen">${esc(e.when)}</span>
            <span class="rsys">${esc(e.kind === "valori" ? "LAB" : e.sistema)}</span>
            <span class="rlab">${esc(shortLabel(e.label))}</span>
            ${(() => { const nb = vals && vals.rows ? vals.rows.filter((v) => outOfRange(v.valore, v.range) !== 0).length : 0;
               return nb ? `<span class="rnum" title="${nb} valori fuori range">${nb}↑↓</span>` : ""; })()}
            ${vals && vals.rows && vals.rows.some((v) => /parz/i.test(v.stato || "")) ? `<span class="tagp">parziale</span>` : ""}
            ${nov.size ? `<span class="tagn" title="${nNuovi} ${nNuovi === 1 ? "nuovo" : "nuovi"}${nAgg ? ` · ${nAgg} ${nAgg === 1 ? "aggiornato" : "aggiornati"}` : ""} dall'ultima lettura">${nov.size} ${nov.size === 1 ? "nuovo" : "nuovi"}</span>` : ""}
            ${e.storico ? `<span class="tagl" title="Il laboratorio ha refertato: la finestra Risultati non c'è più, questi sono i valori già letti">già letti</span>` : ""}
            <span class="rgo">${e.kind === "valori" ? "›" : refertoTipo(e) === "altro" ? "Apri referto ↗" : "↗"}</span>
          </button>${preview}</div>`;
      }).join("");
      const nRef = this.esiti.filter((e) => e.kind === "referto").length;
      const nSaved = this.esiti.filter((e) => e.kind === "referto" && cached[e.id]).length;
      const nVivi = this.esiti.filter((e) => e.kind === "valori" && !e.storico).length;
      const ra = this._refreshAll;
      return `
        <div class="sec">
          <div class="lbl">Esiti (${this.esiti.length})
            ${nVivi ? `<button class="mini" id="risall" ${ra ? "disabled" : ""} title="Rilegge tutti i valori dal server, un prelievo alla volta">${ra ? `↻ ${ra.done}/${ra.total}…` : "↻ Aggiorna"}</button>` : ""}
            ${hasExt() && nSaved < nRef ? `<button class="mini" id="refsave">⬇ Salva referti</button>` : ""}
            ${(nSaved || open.size) ? `<button class="mini" id="refreset">↻ Resetta</button>` : ""}
          </div>
          <div class="rlist">${rows}</div>
        </div>`;
    }

    async refreshRefCache() {
      if (!hasExt() || !this.esiti.length) return;
      const r = await ask({ t: "listRef", ep: this.episodeId, ids: this.esiti.filter((e) => e.kind === "referto").map((e) => e.id) });
      if (r && r.ok) { this.refCache = r.cached || {}; this.render(); }
    }

    async saveAllReferti() {
      if (!hasExt()) return;
      this.refBusy = this.refBusy || {};
      const todo = this.esiti.filter((e) => e.kind === "referto" && !(this.refCache || {})[e.id]);
      for (const e of todo) this.refBusy[e.id] = true;
      this.render();
      for (const e of todo) {
        const res = await ask({ t: "cacheRef", id: e.id, url: e.url, ep: this.episodeId });
        if (res && res.ok) {
          this.refCache = { ...(this.refCache || {}), [e.id]: res.size || 1 };
          this.refBusy[e.id] = false;
        } else {
          this.refBusy[e.id] = (res && res.why) || "non riuscito";
          this.log(`${now()}  referto non salvato (${shortLabel(e.label)}): ${this.refBusy[e.id]}`);
        }
        this.render();
      }
    }

    async openReferto(id) {
      const r = this.esiti.find((x) => x.id === id);
      if (!r) return;
      if ((this.refCache || {})[id] && hasExt()) {          // saved copy → instant, no server
        const got = await ask({ t: "getRef", id, ep: this.episodeId });
        if (got && got.ok && got.data) {
          const bin = atob(got.data);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
          openTab(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          return;
        }
      }
      const name = "psaRef_" + String(id).replace(/\W/g, ""); // else its own tab, reused on re-click
      const w = openTab("", name);
      if (!w) { this.message = "Consenti i popup per aprire i referti."; this.render(); return; }
      let blank = true;
      try { blank = !w.location.href || w.location.href === "about:blank"; } catch { blank = false; }
      if (blank) w.location.href = r.url;
      try { w.focus(); } catch { /* ignore */ }
      const open = new Set(tabStore.get(this.refKey(), []));
      open.add(id);
      tabStore.set(this.refKey(), [...open]);
      this.render();
      this.keepOne(id);   // opened once → keep it, so the next click is instant
    }

    // Save the copy of a referto that was just opened. Only that one: nothing
    // is fetched before it is asked for, and a document already on screen is
    // not new information.
    async keepOne(id) {
      if (!hasExt() || (this.refCache || {})[id]) return;
      const e = this.esiti.find((x) => x.id === id);
      if (!e || e.kind !== "referto") return;
      this.refBusy = { ...(this.refBusy || {}), [id]: true };
      this.render();
      const res = await ask({ t: "cacheRef", id, url: e.url, ep: this.episodeId });
      if (res && res.ok) {
        this.refCache = { ...(this.refCache || {}), [id]: res.size || 1 };
        this.refBusy[id] = false;
      } else {
        this.refBusy[id] = (res && res.why) || "non riuscito";
      }
      this.render();
    }

    async resetReferti() {
      for (const id of tabStore.get(this.refKey(), [])) {
        try { openTab("", "psaRef_" + String(id).replace(/\W/g, ""))?.close(); } catch { /* ignore */ }
      }
      tabStore.set(this.refKey(), []);
      if (hasExt()) await ask({ t: "clearRef" });
      this.refCache = {}; this.refBusy = {};
      this.render();
    }

    // Copy the log for reporting. The quesito is the only clinical text that
    // can end up in it, so it is masked out before leaving the page.
    async copyLog() {
      const head = [`PS Assist ${VERSION} · pagina ${this.pageType}`, `${navigator.userAgent}`, `${new Date().toLocaleString("it-IT")}`, ""].join("\n");
      const text = head + this.logLines.join("\n").replace(/(quesito[^:]*:\s*)"[^"]*"/gi, '$1"…"');
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fallback below */ }
      if (!ok) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        ta.remove();
      }
      const b = this.root.querySelector("#copylog");
      if (b) { b.textContent = ok ? "✓ copiato" : "non riuscito"; setTimeout(() => { if (b.isConnected) b.textContent = "⧉ Copia"; }, 2000); }
    }

    // full values of one accesso, inside the panel
    viewValori() {
      const e = this.esiti.find((x) => x.id === this.viewId);
      const vals = e ? tabStore.get(this.risKey(e.id), null) : null;
      if (!e) return `<div class="hint">Esito non disponibile.</div>`;
      const cmp = confrontaPrelievi(this.prelieviLetti());
      const dd = cmp.delta.get(e?.id);
      // marks are read from the snapshot taken when this draw was LAST LEFT:
      // entering must not erase what it is here to show
      const nov = e && vals && vals.rows ? this.novita(e.id, vals.rows) : new Map();
      const body = vals && vals.rows && vals.rows.length
        ? ordinaRighe(vals.rows, cmp.order).map((v) => {
            const oo = outOfRange(v.valore, v.range);
            const k = valKey(v.nome);
            const d = dd && dd.get(k);
            const n = nov.get(k);
            const tip = [esc(v.nome), n === "nuovo" ? "nuovo dall'ultima lettura" : n === "cambiato" ? "aggiornato dall'ultima lettura" : "",
                         d ? `prelievo precedente: ${esc(d.prevRaw)} (${d.pct > 0 ? "+" : ""}${d.pct}%)` : ""].filter(Boolean).join(" — ");
            return `<div class="rval ${oo ? "bad" : ""}${n ? " nuova" : ""}" title="${tip}"><span class="rvn${n === "nuovo" ? " nuovo" : ""}">${esc(sigla(v.nome))}</span><span class="rvv${n === "cambiato" ? " agg" : ""}">${esc(v.valore)}${oo ? (oo < 0 ? " ↓" : " ↑") : ""}${d ? `<span class="pd">${d.dir}</span>` : ""}</span><span class="rvr">${esc(v.um || "")}${v.range ? " · " + esc(v.range) : ""}</span></div>`;
          }).join("")
        : `<div class="rval">${this.risBusy === e.id ? "carico…" : "nessun valore"}</div>`;
      return `
        <div class="sec">
          <div class="lbl">${esc(e.when)} · ${esc(shortLabel(e.label))}
            <button class="mini" id="copyvals">⧉ Copia</button><button class="mini" id="risreload">↻</button></div>
          ${nov.size ? `<div class="newbar"><span>${nov.size} ${nov.size === 1 ? "valore nuovo" : "valori nuovi"} dall'ultima lettura</span><button id="letto" type="button">Letto</button></div>` : ""}
          <div class="rvals plain">${body}</div>
        </div>`;
    }

    async openEsito(id, kind) {
      if (kind === "referto") return this.openReferto(id);
      // values: fetch once, then straight to the full screen
      const key = this.risKey(id);
      if (!tabStore.get(key, null)) {
        const e = this.esiti.find((x) => x.id === id);
        if (!e) return;
        this.risBusy = id;
        this.render();
        try {
          const { doc } = await fetchDoc(e.url, {});
          const rows = parseRisultati(doc);
          tabStore.set(key, { ts: Date.now(), rows, meta: risMeta(e) });
          this.segnaVisto(id, rows);     // first read is the baseline
        } catch (err) {
          this.log(`${now()}  valori non letti: ${err?.head || err?.message || err}`);
        }
        this.risBusy = null;
      }
      this.setView("valori", id);
    }

    // One tap re-reads EVERY open draw, paced one request at a time: the manual
    // rehearsal of a future automatic refresh — same read, same honesty (an
    // empty or dead page never replaces values already held). Reported draws
    // (storico) are skipped: their page no longer answers.
    async reloadTuttiValori() {
      if (this._refreshAll) return;
      const targets = this.esiti.filter((e) => e.kind === "valori" && !e.storico);
      if (!targets.length) return;
      this._refreshAll = { done: 0, total: targets.length };
      this.refBusy = this.refBusy || {};
      for (const e of targets) this.refBusy[e.id] = true;
      this.render();
      let cambiati = 0;
      for (const e of targets) {
        const key = this.risKey(e.id);
        const prima = JSON.stringify((tabStore.get(key, null) || {}).rows || []);
        try {
          const { doc } = await fetchDoc(e.url, {});
          const rows = parseRisultati(doc);
          if (rows.length) {
            const mai = !tabStore.get(this.vistoKey(e.id), null);
            tabStore.set(key, { ts: Date.now(), rows, meta: risMeta(e) });
            if (mai) this.segnaVisto(e.id, rows);   // never seen before: this read is its baseline
            if (JSON.stringify(rows) !== prima) cambiati++;
          } else {
            this.log(`${now()}  ${shortLabel(e.label)}: la finestra Risultati non risponde più, tengo i valori già letti`);
          }
        } catch (err) {
          this.log(`${now()}  ${shortLabel(e.label)}: valori non aggiornati (${err?.head || err?.message || err})`);
        }
        this.refBusy[e.id] = false;
        this._refreshAll.done++;
        this.render();
        await sleep(PACE_MS).catch(() => {});
      }
      this._refreshAll = null;
      this.log(`${now()}  aggiornati ${targets.length} prelievi${cambiati ? `, ${cambiati} con valori nuovi` : ", nessun valore nuovo"}`);
      this.render();
    }

    // Values ready before he asks: the 2-line preview is the point of Esiti.
    async prefetchValori() {
      const todo = this.esiti.filter((e) => e.kind === "valori" && !tabStore.get(this.risKey(e.id), null)).slice(0, 6);
      for (const e of todo) {
        try {
          const { doc } = await fetchDoc(e.url, {});
          const rows = parseRisultati(doc);
          tabStore.set(this.risKey(e.id), { ts: Date.now(), rows, meta: risMeta(e) });
          this.segnaVisto(e.id, rows);   // first read is the baseline
          this.render();
        } catch { /* stays without preview; opening it will retry */ }
        await sleep(PACE_MS).catch(() => {});
      }
    }

    async copyValori() {
      const e = this.esiti.find((x) => x.id === this.viewId);
      const vals = e ? tabStore.get(this.risKey(e.id), null) : null;
      if (!vals || !vals.rows) return;
      const cmp = confrontaPrelievi(this.prelieviLetti());
      const dd = cmp.delta.get(e.id);
      const text = ordinaRighe(vals.rows, cmp.order).map((v) => {
        const oo = outOfRange(v.valore, v.range);
        const d = dd && dd.get(valKey(v.nome));
        return `${v.nome} ${v.valore}${v.um ? " " + v.um : ""}${v.range ? ` (${v.range})` : ""}${oo ? (oo < 0 ? " ↓" : " ↑") : ""}${d ? ` [prima ${d.prevRaw}, ${d.pct > 0 ? "+" : ""}${d.pct}%]` : ""}`;
      }).join("\n");
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { /* below */ }
      const b = this.root.querySelector("#copyvals");
      if (b) { b.textContent = ok ? "✓ copiato" : "non riuscito"; setTimeout(() => { if (b.isConnected) b.textContent = "⧉ Copia"; }, 2000); }
    }

    async reloadValori() {
      const e = this.esiti.find((x) => x.id === this.viewId);
      if (!e) return;
      this.risBusy = e.id;
      this.render();
      try {
        const { doc } = await fetchDoc(e.url, {});
        const rows = parseRisultati(doc);
        // a reported draw no longer answers: keep what we already had
        if (rows.length) tabStore.set(this.risKey(e.id), { ts: Date.now(), rows, meta: risMeta(e) });
        else this.log(`${now()}  la finestra Risultati non risponde più: tengo i valori già letti`);
      } catch (err) { this.log(`${now()}  valori non letti (tengo i precedenti): ${err?.head || err?.message || err}`); }
      this.risBusy = null;
      this.render();
    }

    viewBrowse(cat) {
      const q = (this.acq || "").trim().toUpperCase();
      let drop = "";
      if (q.length >= 2) {
        const hits = [];
        for (const [res, v] of Object.entries(cat)) {
          for (const [code, label] of Object.entries(v.items || {})) {
            if (label.toUpperCase().includes(q)) hits.push({ res, code, label });
          }
        }
        hits.sort((a, b) => a.label.toUpperCase().indexOf(q) - b.label.toUpperCase().indexOf(q) || a.label.localeCompare(b.label));
        drop = `<div class="acdrop">${
          hits.slice(0, 12).map((h) => `<button class="acitem ${this.isSel(h.res, h.code) ? "on" : ""}" data-res="${esc(h.res)}" data-code="${esc(h.code)}" title="${esc(h.label)}">
            <span class="acnm">${esc(h.label)}</span><span class="actag">${esc(RES_SHORT[h.res] || h.res)}</span></button>`).join("")
          || `<div class="acempty">Nessun esame trovato</div>`}</div>`;
      }
      return `<div class="ac"><input id="acq" type="search" autocomplete="off" placeholder="altri esami…" value="${esc(this.acq || "")}">${drop}</div>`;
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
        ${this.runPatient ? `<div class="idline" style="margin-top:0">Operazione per <b>${esc(this.runPatient)}</b></div>` : ""}
        <div class="sec"><div class="lbl">In corso — passo ${Math.min(doneN + 1, total)} di ${total}</div><div class="steps">${stepHtml}</div></div>
        <details class="reg" open><summary>Registro <button class="mini" id="copylog" title="Copia il registro negli appunti (il quesito viene omesso)">⧉ Copia</button></summary><div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div></details>
        <div class="commit">
          <button class="btn stop" id="stopbtn">INTERROMPI (Esc)</button>
  
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
        ${this.runPatient ? `<div class="idline" style="margin-top:0">Operazione per <b>${esc(this.runPatient)}</b></div>` : ""}
        <div class="banner ${cls}">${head ? `<b>${esc(head)}</b>` : ""}${esc(bodyTxt || "")}</div>
        <div class="sec"><div class="steps">${steps}</div></div>
        <details class="reg" open><summary>Registro <button class="mini" id="copylog" title="Copia il registro negli appunti (il quesito viene omesso)">⧉ Copia</button></summary><div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div></details>
        <div class="commit">
          ${!ok && listUrl ? `<button class="btn primary" id="openlist">Apri il carrello e controlla</button>` : ""}
          <button class="btn ghost" id="reset">Torna al pannello</button>
        </div>
      `;
    }

    // Drag to move (header or collapsed pill); a real click on the pill still
    // expands it, and double-click on the header resets to the default corner.
    attachDrag(el) {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest(".iconbtn")) return;
        const wrap = this.root.querySelector(".wrap");
        const r = wrap.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY, ox = r.left, oy = r.top;
        let moved = false;
        const mm = (ev) => {
          if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
          moved = true;
          this.pos = {
            left: Math.max(0, Math.min(window.innerWidth - 80, ox + ev.clientX - sx)),
            top: Math.max(0, Math.min(window.innerHeight - 48, oy + ev.clientY - sy)),
          };
          wrap.style.left = this.pos.left + "px";
          wrap.style.top = this.pos.top + "px";
          wrap.style.right = "auto";
        };
        const up = () => {
          window.removeEventListener("pointermove", mm, true);
          window.removeEventListener("pointerup", up, true);
          if (moved) {
            store.set("pos", this.pos);
            this._justDragged = true;
            setTimeout(() => { this._justDragged = false; }, 0);
          }
        };
        window.addEventListener("pointermove", mm, true);
        window.addEventListener("pointerup", up, true);
      });
    }

    bind() {
      const $ = (s) => this.root.querySelector(s);
      $("#expand")?.addEventListener("click", () => {
        if (this._justDragged) return; // it was a drag, not a click
        this.collapsed = false; store.set("collapsed", false); this.render();
      });
      $("#collapse")?.addEventListener("click", () => { this.collapsed = true; store.set("collapsed", true); this.render(); });
      const rsz = $("#rsz");
      if (rsz) {
        rsz.addEventListener("pointerdown", (e) => {
          e.preventDefault(); e.stopPropagation();
          const card = this.root.querySelector(".card");
          const r = card.getBoundingClientRect();
          const sx = e.clientX, sy = e.clientY, w0 = r.width, h0 = r.height;
          const mm = (ev) => {
            // dragging left widens (the panel grows towards the page), down heightens
            this.size = {
              w: Math.max(320, Math.min(window.innerWidth - 20, w0 + (sx - ev.clientX))),
              h: Math.max(240, Math.min(window.innerHeight - 20, h0 + (ev.clientY - sy))),
            };
            card.style.width = this.size.w + "px";
            card.style.maxHeight = this.size.h + "px";
          };
          const up = () => {
            window.removeEventListener("pointermove", mm, true);
            window.removeEventListener("pointerup", up, true);
            store.set("size", this.size);
          };
          window.addEventListener("pointermove", mm, true);
          window.addEventListener("pointerup", up, true);
        });
        rsz.addEventListener("dblclick", (e) => { e.stopPropagation(); this.size = null; store.set("size", null); this.render(); });
      }
      const hd = $("#draghd");
      if (hd) {
        this.attachDrag(hd);
        hd.addEventListener("dblclick", () => { this.pos = null; store.set("pos", null); this.render(); });
      }
      const pill = $("#expand");
      if (pill) this.attachDrag(pill);
      $("#stopbtn")?.addEventListener("click", () => this.stop());
      $("#reset")?.addEventListener("click", () => { this.runState = null; this.runData = null; this.message = null; this.render(); });
      $("#openlist")?.addEventListener("click", () => {
        const u = this.runData?.finishedListUrl || this.runData?.lastListUrl;
        if (u) nav(u);
      });

      $("#back")?.addEventListener("click", () => this.setView(this.view === "valori" ? "esiti" : "home"));
      this.root.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => this.setView(b.getAttribute("data-seg"))));
      $("#forget")?.addEventListener("click", () => { forgetPatients(); this.render(); });
      $("#verbtn")?.addEventListener("click", () => { this.showLog = !this.showLog; this.render(); });
      $("#risall")?.addEventListener("click", () => this.reloadTuttiValori());
      $("#letto")?.addEventListener("click", () => { if (this.viewId) { this.marcaLetto(this.viewId); this.render(); } });
      this.root.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", (ev) => {
        ev.stopPropagation();   // Richieste sits inside the card, which is itself a [data-go]
        const ep = b.getAttribute("data-ep"), go = b.getAttribute("data-go");
        if (ep === this.episodeId) return this.setView(go);
        const p = knownPatients().find((x) => x.ep === ep);
        if (!p || !p.url) return;
        tabStore.set("afterNav.v1", { ep, view: go, ts: Date.now() }); // open there, on their page
        nav(p.url);
      }));
      $("#goqueued")?.addEventListener("click", () => { if (this.pending) goToQueued(this.pending); });
      $("#confirmnow")?.addEventListener("click", () => {
        // native click → server confirm → print handoff (armed at boot)
        const live = examModel(document, location.href);
        live.confirmButton?.click();
      });
      $("#extreload")?.addEventListener("click", () => {
        try { chrome.runtime.sendMessage("psassist-reload"); } catch { /* not the extension build */ }
      });
      const qEl = $("#q");
      qEl?.addEventListener("input", () => { this._q = qEl.value; this.persistUi(); this.refreshCommit(); });
      this.root.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
        qEl.value = b.getAttribute("data-q"); this._q = qEl.value; this.persistUi(); this.refreshCommit(); qEl.focus();
      }));
      this.root.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => this.togglePreset(PRESETS[+b.getAttribute("data-preset")])));
      this.root.querySelectorAll(".chip[data-code], .opt[data-code]").forEach((b) => b.addEventListener("click", () => this.toggle(b.getAttribute("data-res"), b.getAttribute("data-code"))));
      this.root.querySelectorAll(".acitem[data-code]").forEach((b) => b.addEventListener("click", () => {
        this.toggle(b.getAttribute("data-res"), b.getAttribute("data-code"));
      }));
      this.root.querySelectorAll("[data-unsel]").forEach((b) => b.addEventListener("click", () => { this.selected.delete(b.getAttribute("data-unsel")); this.persistUi(); this.render(); }));
      const ac = $("#acq");
      if (ac) {
        ac.addEventListener("input", () => { this.acq = ac.value; this.acFocus = true; this.render(); });
        ac.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const first = this.root.querySelector(".acitem[data-code]");
            if (first) { e.preventDefault(); this.toggle(first.getAttribute("data-res"), first.getAttribute("data-code")); }
          } else if (e.key === "Escape") { e.stopPropagation(); this.acq = ""; this.render(); }
        });
        if (this.acFocus) { ac.focus(); ac.setSelectionRange(ac.value.length, ac.value.length); }
      }
      $("#go")?.addEventListener("click", () => this.launch(false));
      $("#goconfirm")?.addEventListener("click", () => this.launch(true));
      this.root.querySelectorAll("[data-print]").forEach((b) => b.addEventListener("click", () => {
        const rid = b.getAttribute("data-print");
        const jobs = printJobsFor(printModel(document, location.href), rid);
        if (jobs.length) openPrintWizard(jobs, { panel: this, title: `Richiesta ${rid}.` });
      }));
      this.root.querySelectorAll("[data-esito]").forEach((b) => b.addEventListener("click", () =>
        this.openEsito(b.getAttribute("data-esito"), b.getAttribute("data-kind"))));
      this.root.querySelectorAll("[data-vals]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation(); this.setView("valori", b.getAttribute("data-vals"));
      }));
      $("#risreload")?.addEventListener("click", () => this.reloadValori());
      $("#copyvals")?.addEventListener("click", () => this.copyValori());
      $("#refreset")?.addEventListener("click", () => this.resetReferti());
      $("#refsave")?.addEventListener("click", () => this.saveAllReferti());
      $("#copylog")?.addEventListener("click", (e) => { e.preventDefault(); this.copyLog(); });
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
        const lab = items.filter((i) => !RADIO_SET.includes(i.res));
        const radio = items.filter((i) => RADIO_SET.includes(i.res));
        const legs = [];
        if (lab.length) legs.push({ kind: "lab", label: "laboratorio", items: lab, entryUrl: this.entry?.labUrl });
        if (radio.length) legs.push({ kind: "radio", label: "radiologia", items: radio, entryUrl: this.entry?.radioUrl });
        if (legs.some((l) => !l.entryUrl)) { this.message = "Link di apertura richiesta non trovato su questa pagina."; this.render(); return; }
        base.startPage = "patient";
        base.legs = legs;
        base.entryUrl = legs[0].entryUrl;
        base.items = legs[0].items;
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
    // The native Conferma submits the WHOLE richiesta, not this run's
    // additions. This page shows only the CURRENT resource's cart rows, so the
    // honest comparison is per-resource against the receipt: a row in the cart
    // that this run did not add (a leftover from an earlier attempt) means the
    // click would confirm more than the banner says — refuse, human decides.
    const receipt = tabStore.get("receipt.v1", null);
    if (receipt && receipt.richiestaId === model.richiestaId && Array.isArray(receipt.items)) {
      const attesi = new Set(receipt.items.filter((i) => i.res === model.res).map((i) => String(i.code)));
      const visti = inCart.map((e) => String(e.code));
      const estranei = visti.filter((c) => !attesi.has(c));
      if (estranei.length || visti.length !== attesi.size) {
        if (panel) {
          panel.message = `Conferma automatica sospesa: il carrello ha ${visti.length} esami su questa risorsa, la richiesta ne ha aggiunti ${attesi.size}. Controlla il carrello e premi Conferma sulla pagina.`;
          panel.log(`${now()}  auto-conferma sospesa: carrello ${visti.length} ≠ attesi ${attesi.size}${estranei.length ? ` (estranei: ${estranei.join(", ")})` : ""}`);
          panel.render();
        }
        return;
      }
    }

    // The doctor already chose "+ Conferma": that click was the decision, and
    // every gate above has passed (episode, richiesta, last exam present under
    // its right name, cart identical to the receipt for this resource).
    // Confirm now — a countdown here was dead time, not safety.
    panel?.log(`${now()}  conferma automatica: ${flag.count} ${flag.count === 1 ? "esame" : "esami"} · ${cartPreview.join(" · ")} · click nativo su Conferma`);
    void patientName;
    model.confirmButton.click(); // native click → server confirm → label print flow
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

  function openPrintWizard(jobs, { title = "", onClose, panel = null } = {}) {
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
      if (DEMO) return; // banco di prova: PDF shown, no print dialog
      try { f?.contentWindow?.print(); } catch { /* fallback: the re-open button */ }
    };

    const render = (err, viewer) => {
      const job = jobs[i];
      const nextLbl = `✓ Stampata — ${i + 1 < jobs.length ? "avanti" : "fatto"}`;
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
            ${viewer
              ? `<button class="pwbtn re" id="pwtab">↗ Apri ${esc(job.name)} (poi Ctrl+P → ${esc(job.printer)})</button>`
              : `<button class="pwbtn re" id="pwre">🖨 Riapri stampa</button>`}
            <button class="pwbtn next" id="pwnext">${nextLbl}</button>
            <button class="pwbtn ghost" id="pwskip">Salta</button>
            ${viewer ? "" : `<button class="pwbtn ghost" id="pwtab">Apri in una scheda</button>`}
            <button class="pwbtn exit" id="pwexit">Annulla (Esc)</button>
            <div class="pwhint">${viewer ? `Ctrl+P nella nuova scheda → <b style="display:inline">${esc(job.printer)}</b>` : `Scegli <b style="display:inline">${esc(job.printer)}</b> nel dialogo`}</div>
          </div>
        </div>`;
      root.querySelector("#pwre")?.addEventListener("click", tryPrint);
      root.querySelector("#pwnext").onclick = advance;
      root.querySelector("#pwskip").onclick = advance;
      root.querySelector("#pwexit").onclick = cleanup;
      root.querySelector("#pwtab").onclick = () => openTab(job.url, "_blank"); // user-activated → not popup-blocked
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
        const { blob, via } = await fetchPdf(jobs[i].url, {});
        panel?.log(`${now()}  ${jobs[i].name}: PDF ottenuto${via ? " via " + via : ""}`);
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
        if (e?.name === "AbortError") return;
        // This endpoint is a viewer we can't safely turn into a Blob. Don't
        // auto-open (a popup after the async fetch is blocked for lack of user
        // activation) — offer a big button the doctor clicks, which carries
        // activation and always opens the tab. The sequence still advances.
        const job = jobs[i];
        render(`Anteprima non catturabile per questo documento (è un visualizzatore).${e?.diag ? " [" + e.diag + "]" : ""}`, true);
        root.querySelector(".pwbody").innerHTML =
          `<div class="pwmsg">Premi <b>↗ Apri ${esc(job.name)}</b> qui sotto, poi <b>Ctrl+P → ${esc(job.printer)}</b>,<br>torna qui e premi «Stampata — avanti».</div>`;
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
    const arm = () => {
      const q = tabStore.get("queue.v1", null);
      if (q && q.items) { // this richiesta is done: drop it from the walk
        const left = q.items.filter((it) => it.rid !== model.richiestaId);
        tabStore.set("queue.v1", left.length ? { ...q, items: left, ts: Date.now() } : null);
      }
      const prev = tabStore.get("print.v1", null);
      const fresh = prev && prev.episodeId === episodeId && Date.now() - (prev.ts || 0) < PRINT_FLAG_TTL ? prev.ids || [] : [];
      const ids = [...new Set([...fresh, model.richiestaId])]; // lab + radiology land in ONE flow
      tabStore.set("print.v1", { ids, episodeId, ts: Date.now() });
    };
    for (const name of ["Update", "Update1"]) {
      const b = model.form.elements.namedItem(name);
      if (b && (b.type || "").toLowerCase() === "submit") b.addEventListener("click", arm, true);
    }
  }

  // After confirming one richiesta of a lab+radiology pair, the server drops us
  // on the patient page: carry on to the one still to confirm.
  function nextQueued(episodeId) {
    const q = tabStore.get("queue.v1", null);
    if (!q || !q.items || !q.items.length) return null;
    if (Date.now() - (q.ts || 0) > QUEUE_TTL) { tabStore.set("queue.v1", null); return null; }
    if (!episodeId || (q.episodeId && q.episodeId !== episodeId)) return null; // fail closed
    return { q, next: q.items[0] };
  }

  function goToQueued(entry) {
    const { q, next } = entry;
    tabStore.set("receipt.v1", { richiestaId: next.rid, episodeId: q.episodeId, ts: Date.now(), items: next.added || [] });
    if (q.autoConfirm && next.lastCode && next.kind !== "radio") {
      tabStore.set("confirm.v1", { richiestaId: next.rid, episodeId: q.episodeId, lastCode: next.lastCode, lastLabel: next.lastLabel, count: next.count, ts: Date.now() });
    }
    tabStore.set("queue.v1", { ...q, items: q.items.map((it, i) => (i ? it : { ...it, nav: true })), ts: Date.now() });
    nav(next.listUrl);
  }

  function maybeAutoPrint(panel) {
    const flag = tabStore.get("print.v1", null);
    if (!flag) return false;
    // never print for an episode other than the page in front of the user
    const here = findEpisodeId(document, location.href);
    if (!here || (flag.episodeId && flag.episodeId !== here)) return false;
    if (Date.now() - (flag.ts || 0) > PRINT_FLAG_TTL) { tabStore.set("print.v1", null); return false; }
    const map = printModel(document, location.href);
    const ids = (flag.ids || [flag.richiestaId]).filter((id) => map[id]);
    if (!ids.length) return false; // this page doesn't list them yet — keep waiting
    // group by printer ACROSS the confirmed richieste: labels, then lists,
    // then radiology bookings — one uninterrupted flow
    const all = ids.map((id) => printJobsFor(map, id));
    const jobs = [
      ...all.flatMap((j) => j.filter((x) => x.printer === "etichettatrice")),
      ...all.flatMap((j) => j.filter((x) => x.printer !== "etichettatrice")),
    ];
    if (!jobs.length) return false;
    if (wizardOpen) return false;   // keep the flag: these jobs must not vanish behind another wizard
    tabStore.set("print.v1", null);
    openPrintWizard(jobs, { panel, title: ids.length > 1 ? `${ids.length} richieste appena confermate.` : "Richiesta appena confermata." });
    return true;
  }

  // ==================================================================== BOOT
  function boot() {
    if (document.getElementById("psassist-host")) return;
    scadenzaQuesiti();
    const pageType = classify(document);
    if (pageType === "login") { forgetAll(); return; }
    if (pageType === "other") {
      // e.g. the post-confirm label page: no panel, but a pending print
      // handoff starts here when the page lists the richiesta's print links.
      maybeAutoPrint(null);
      return;
    }
    const panel = new Panel(pageType);
    // the EHR navigates on every click: leaving the page with a draw open
    // counts as reading it, exactly like pressing ‹
    window.addEventListener("pagehide", () => {
      try { if (panel.view === "valori" && panel.viewId) panel.marcaLetto(panel.viewId); } catch { /* going away anyway */ }
    });
    if (pageType === "patient") {
      panel.entry = patientModel(document, location.href);
      panel.esiti = esitiModel(document, location.href);
    }
    panel.restoreUi(); // same tab + same episode → quesito/selezione/vista tornano come prima
    panel.render();
    if (pageType === "patient") {
      // this patient is now one the panel knows (name + episode + page only)
      // only a page that can actually order is a patient: the ER worklist
      // classifies the same way but its episode belongs to someone in the list
      if (panel.entry && (panel.entry.labUrl || panel.entry.radioUrl)) {
        rememberPatient(panel.episodeId, (document.title || "").trim(), location.href);
      }
      panel.applyAfterNav();
      const pending = nextQueued(findEpisodeId(document, location.href));
      panel.pending = pending; // a richiesta of this run still needs confirming
      panel.render();
      panel.refreshRefCache();
      panel.prefetchValori();
      if (pending) {
        // auto-continue once per richiesta; afterwards it is a button, so an
        // abandoned confirmation can never turn into a navigation loop
        if (pending.q.autoConfirm && !pending.next.nav) { goToQueued(pending); return; }
      } else {
        maybeAutoPrint(panel); // nothing left to confirm → print everything at once
      }
    } else {
      panel.render();
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
