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
  const VERSION = "3.29.1";
  const NS = "psassist:"; // storage namespace

  const TIMEOUT_MS = 20000;      // per-request timeout
  const PACE_MS = 250;           // gentle pause between consecutive requests
  const VERIFY_RECHECKS = 3;     // list re-reads before declaring an add lost
  const VERIFY_WAIT_MS = 1200;   // pause before each verify re-read
  const CONFIRM_FLAG_TTL = 120e3;// ms an auto-confirm handoff stays valid
  // un messaggio che deve sopravvivere al cambio di pagina: quello che si è
  // deciso in sottofondo va detto sulla pagina dove il medico arriva
  const AVVISO = "avviso.v1";
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
  // Discharge instructions, reviewed before shipping and freely editable by
  // the doctor: what is kept here is a TEMPLATE, never a patient's text.
  const DIMISSIONI = {"gastrite":{"nome":"Gastrite acuta","rivisto":true,"testo":"GASTRITE ACUTA — INDICAZIONI ALLA DIMISSIONE\n\nFARMACI\n- Pantoprazolo 40 mg, 1 compressa al mattino a digiuno (30 minuti prima di colazione), per 4 settimane.\n- Antiacido/alginato al bisogno dopo i pasti e alla sera.\n- Sospendere i FANS. Per il dolore utilizzare paracetamolo 1 g fino a 3 volte al giorno.\n\nCOSA FARE A CASA\n- Sospendere alcol e fumo.\n- Pasti piccoli e frequenti; evitare cibi piccanti, grassi, caffè, cioccolato, bevande gassate.\n- Non coricarsi nelle 3 ore dopo il pasto.\n- Prediligere carboidrati come fette biscottate, pasta, patate, riso, e carni bianche come pollo e tacchino.\n\nFOLLOW-UP\n- Rivalutazione dal Medico Curante entro 7–10 giorni.\n- Valutare EGDS in caso di persistenza dei sintomi oltre 4 settimane di terapia, o in presenza di segni d'allarme.\n\nRITORNARE IN PRONTO SOCCORSO O CHIAMARE IL 112 SE\n- Vomito con sangue o a «fondo di caffè».\n- Feci nere, catramose o con sangue.\n- Dolore addominale intenso o improvviso.\n- Vomito persistente con impossibilità a bere.\n- Febbre.\n- Svenimento, vertigini, sudorazione fredda o palpitazioni.\n- Dolore che si irradia al dorso o al torace.\n\nQueste indicazioni si riferiscono alla valutazione di oggi e non sostituiscono il medico curante. Se compaiono sintomi nuovi o il disturbo peggiora torni in Pronto Soccorso anche prima dei tempi indicati; chiami il 112 se il sintomo è grave o improvviso e non si metta alla guida. Porti con sé questo foglio, la documentazione consegnata e l'elenco dei farmaci che assume, allergie comprese. Attenzione ai preparati per l'influenza: contengono già paracetamolo."},"gastroenterite":{"nome":"Gastroenterite / diarrea acuta","rivisto":true,"testo":"GASTROENTERITE ACUTA — INDICAZIONI ALLA DIMISSIONE\n\nBERE\n- Almeno 2 litri al giorno a piccoli sorsi, più un bicchiere in più dopo ogni scarica.\n- Evitare bevande molto zuccherate, alcolici, caffè.\n\nMANGIARE\n- Appena tollerato, in bianco, con pasti piccoli e frequenti.\n- Nei primi giorni evitare latte e latticini, fritti e cibi grassi, frutta e verdura (in particolare cruda).\n- Prediligere carboidrati semplici come fette biscottate, pasta, patate, riso, e carni bianche come pollo e tacchino.\n- Utili i fermenti lattici.\n\nIGIENE\n- Lavarsi le mani con acqua e sapone dopo ogni evacuazione.\n- Non preparare cibo per altri fino a 48 ore dopo l'ultima scarica.\n\nFARMACI\n- Sospendere metformina, farmaci per la pressione, diuretici o gliflozine.\n- Se dolore o febbre: paracetamolo 1 g ogni 8 ore (massimo 3 g al giorno).\n- NON prendere antinfiammatori (ibuprofene, ketoprofene, diclofenac, aspirina) finché vomito e diarrea non sono passati.\n- Se la diarrea è un problema pratico: loperamide 2 mg (Imodium, Dissenten) 2 compresse subito, poi 1 compressa dopo ogni scarica liquida; massimo 8 compresse al giorno, per non più di due giorni consecutivi. NON assumerla se ha febbre o sangue nelle feci.\n\nTORNI IN PRONTO SOCCORSO SE\n- Sangue nelle feci o feci nere.\n- Vomito continuo che impedisce di bere.\n- Febbre oltre 39 °C che non risponde al paracetamolo o che dura più di 3 giorni.\n- Dolore addominale forte e localizzato, in peggioramento.\n\nCONTROLLO\n- Medico curante se non migliora in 3–4 giorni.\n\nQueste indicazioni si riferiscono alla valutazione di oggi e non sostituiscono il medico curante. Se compaiono sintomi nuovi o il disturbo peggiora torni in Pronto Soccorso anche prima dei tempi indicati; chiami il 112 se il sintomo è grave o improvviso e non si metta alla guida. Porti con sé questo foglio, la documentazione consegnata e l'elenco dei farmaci che assume, allergie comprese. Attenzione ai preparati per l'influenza: contengono già paracetamolo."},"colica-renale":{"nome":"Colica renale","rivisto":true,"testo":"COLICA RENALE — INDICAZIONI ALLA DIMISSIONE\n\nFARMACI\n- Metoclopramide 10 mg, 1 compressa fino a 3 volte al giorno.\n- Tamsulosina 0,4 mg dopo cena: si alzi lentamente e non la associ a farmaci per l'erezione.\n- Cefixoral 400 mg, 1 compressa al giorno per 5 giorni.\n\nSE DOLORE\n- Ketoprofene sale di lisina 80 mg (1 bustina) fino a 3 volte al giorno, a stomaco pieno (in alternativa ibuprofene 600 mg fino a 3 volte al giorno).\n- Se il dolore non è controllato, insieme al ketoprofene: Tachidol 500/30 mg, 1 bustina al bisogno, massimo 3 volte al giorno.\n- In alternativa, sospendere quanto sopra e assumere Lenizak 75/25, 1 bustina fino a 3 volte al giorno.\n\nCOSA FARE A CASA\n- Bere normalmente, 1,5–2 litri al giorno: non deve forzarsi a bere di più, ma nemmeno bere di meno.\n- Filtrare l'urina (con un filtro da caffè americano) se possibile e conservare il calcolo espulso per l'analisi.\n- Il calcolo può essere espulso in giorni o settimane: un nuovo episodio di dolore è possibile.\n\nTORNI SUBITO IN PRONTO SOCCORSO SE\n- Febbre o brividi: possono indicare un rene ostruito e infetto. Chiami il 112.\n- Dolore che non passa con la terapia.\n- Vomito che impedisce di assumere i farmaci.\n- Urina assente o molto ridotta.\n\nCONTROLLI\n- Ecografia addome completo entro 5 giorni.\n- Visita urologica in 7–14 giorni, con esami e documentazione del Pronto Soccorso.\n- Se il calcolo non viene espulso entro 4 settimane serve comunque una rivalutazione.\n\nQueste indicazioni si riferiscono alla valutazione di oggi e non sostituiscono il medico curante. Se compaiono sintomi nuovi o il disturbo peggiora torni in Pronto Soccorso anche prima dei tempi indicati; chiami il 112 se il sintomo è grave o improvviso e non si metta alla guida. Porti con sé questo foglio, la documentazione consegnata e l'elenco dei farmaci che assume, allergie comprese. Attenzione ai preparati per l'influenza: contengono già paracetamolo."},"cistite":{"nome":"Cistite non complicata","rivisto":true,"testo":"CISTITE NON COMPLICATA — INDICAZIONI ALLA DIMISSIONE\n(indicazioni per la donna non in gravidanza; nell'uomo la cistite va sempre rivalutata dal medico)\n\nANTIBIOTICO\n- Se nitriti presenti: fosfomicina 3 g, una sola bustina sciolta in un bicchiere d'acqua, la sera prima di coricarsi dopo aver urinato, lontano dai pasti. Una dose sola è tutta la cura.\n- Cefixoral 400 mg, 1 compressa al giorno per 5 giorni.\n\nSINTOMI\n- Paracetamolo 1 g ogni 8 ore (massimo 3 g al giorno) oppure ibuprofene 400 mg fino a 3 volte al giorno per bruciore e dolore.\n- Bere 1,5–2 litri al giorno e urinare spesso, senza trattenere.\n\nSE È O POTREBBE ESSERE IN GRAVIDANZA\n- Lo dica subito: non prenda ibuprofene, servono un esame delle urine con antibiogramma e un controllo dopo la terapia. Usi solo paracetamolo e non assuma antibiotici di sua iniziativa.\n\nPER EVITARE CHE TORNI\n- Urinare dopo i rapporti sessuali.\n- Evitare lavande vaginali e detergenti aggressivi.\n\nTORNI IN PRONTO SOCCORSO SE\n- Febbre oltre 38 °C, brividi, dolore al fianco o alla schiena: possibile infezione del rene.\n- Vomito che impedisce di assumere l'antibiotico.\n\nCONTROLLO\nDal medico di base se:\n- I sintomi non migliorano dopo 48–72 ore di terapia.\n- Sangue nelle urine che persiste a terapia finita.\n- Se i sintomi scompaiono non serve un esame delle urine di controllo.\n- Se i sintomi non passano o tornano entro 2 settimane, serve un esame delle urine con antibiogramma prima di riprendere l'antibiotico.\n- Se gli episodi si ripetono (3 o più in un anno).\n\nQueste indicazioni si riferiscono alla valutazione di oggi e non sostituiscono il medico curante. Se compaiono sintomi nuovi o il disturbo peggiora torni in Pronto Soccorso anche prima dei tempi indicati; chiami il 112 se il sintomo è grave o improvviso e non si metta alla guida. Porti con sé questo foglio, la documentazione consegnata e l'elenco dei farmaci che assume, allergie comprese. Attenzione ai preparati per l'influenza: contengono già paracetamolo."},"trauma-cranico-minore":{"nome":"Trauma cranico minore","rivisto":true,"testo":"TRAUMA CRANICO MINORE — INDICAZIONI ALLA DIMISSIONE\n\nSE ASSUME ANTICOAGULANTI O CARDIOASPIRINA\n- Non resti solo nelle prossime 24 ore e torni in Pronto Soccorso per qualsiasi sintomo nuovo, anche solo mal di testa.\n- Non sospenda di sua iniziativa l'anticoagulante o la cardioaspirina.\n- Il sanguinamento può comparire anche dopo 3–7 giorni.\n\nLE PROSSIME 24–48 ORE\n- Non resti solo: una persona adulta deve poterla assistere.\n- Può dormire normalmente. Chi assiste deve solo verificare che respiri regolarmente e che si svegli facilmente chiamandolo; se non si sveglia facilmente, chiami subito il 112.\n- Riposo nelle prime 24–48 ore, poi ripresa graduale.\n- Niente alcol, niente sonniferi o sedativi.\n- Non guidare, non usare macchinari, non fare sport finché i sintomi non sono scomparsi. Ritorno allo sport per gradi.\n\nFARMACI\n- Per il mal di testa usi solo paracetamolo 1 g ogni 8 ore (massimo 3 g al giorno).\n- Non prenda antinfiammatori (ibuprofene, ketoprofene, aspirina come antidolorifico) per una settimana.\n\nCHIAMI IL 112 SE COMPARE ANCHE UNO SOLO DI QUESTI (non si metta alla guida)\n- Mal di testa che peggiora e non passa con il paracetamolo.\n- Vomito ripetuto.\n- Sonnolenza insolita o difficoltà a svegliarsi.\n- Confusione, difficoltà a parlare, vista doppia, pupille di dimensione diversa, debolezza o formicolio a un braccio o a una gamba, perdita di equilibrio.\n- Convulsioni.\n- Sangue o liquido chiaro dal naso o dalle orecchie.\n\nNELLE SETTIMANE SUCCESSIVE\n- Sopra i 65 anni o in terapia anticoagulante i sintomi possono comparire anche dopo 2–6 settimane: mal di testa persistente, sonnolenza, cambiamento di carattere o difficoltà a camminare vanno rivalutati dal medico.\n\nCONTROLLO\n- Medico curante se mal di testa, stanchezza, difficoltà di concentrazione o irritabilità durano oltre una settimana.\n\nQueste indicazioni si riferiscono alla valutazione di oggi e non sostituiscono il medico curante. Se compaiono sintomi nuovi o il disturbo peggiora torni in Pronto Soccorso anche prima dei tempi indicati; chiami il 112 se il sintomo è grave o improvviso e non si metta alla guida. Porti con sé questo foglio, la documentazione consegnata e l'elenco dei farmaci che assume, allergie comprese. Attenzione ai preparati per l'influenza: contengono già paracetamolo."},"artrosi":{"nome":"Artrosi (fase dolorosa)","testo":"ARTROSI IN FASE DOLOROSA — INDICAZIONI ALLA DIMISSIONE\n\nLA CURA PRINCIPALE È IL MOVIMENTO\n- Camminare in piano ogni giorno, secondo tolleranza: il riposo assoluto peggiora l'artrosi.\n- Esercizi quotidiani di rinforzo della coscia (li insegna il fisioterapista o il medico curante).\n- Evitare solo ciò che provoca dolore forte.\n- Perdere peso quando indicato: ogni chilo in meno scarica il ginocchio in modo significativo.\n- Bastone dal lato opposto all'articolazione dolente, se serve.\n- Ghiaccio 15–20 minuti 2–3 volte al giorno in fase acuta; calore se prevale la rigidità.\n\nFARMACI\n- Gel antinfiammatorio localmente 2–3 volte al giorno: è la prima scelta, più sicuro degli antinfiammatori per bocca. Non esporre al sole la zona trattata durante la cura e nelle 2 settimane successive.\n- Paracetamolo 1 g ogni 8 ore (massimo 3 g al giorno; massimo 2 g sopra i 75 anni, sotto i 50 kg, con problemi di fegato o se beve alcolici).\n- Se non basta: ibuprofene 400–600 mg fino a 3 volte al giorno a stomaco pieno, per pochi giorni, con un farmaco che protegge lo stomaco.\n\nQUANDO NON PRENDERE ANTINFIAMMATORI PER BOCCA\n- Se prende anticoagulanti (warfarin, apixaban, rivaroxaban, edoxaban, dabigatran) o due antiaggreganti: in questi casi NON vanno presi in nessun caso, nemmeno con il gastroprotettore. Usi paracetamolo e gel locale.\n- Problemi di reni, scompenso cardiaco, pressione alta non controllata, ulcera.\n\nTORNI IN PRONTO SOCCORSO SE\n- Articolazione calda, molto gonfia e arrossata, con febbre: possibile infezione.\n- Articolazione che si gonfia improvvisamente senza trauma.\n- Impossibilità totale di caricare il peso, o deformità dopo una caduta.\n- Feci nere o vomito con sangue: sospenda l'antinfiammatorio e venga subito.\n\nCONTROLLO\n- Medico curante entro 1–2 settimane per la terapia di fondo e la fisioterapia.\n- Valutazione ortopedica se il dolore limita la vita quotidiana nonostante la terapia.\n\nQueste indicazioni si riferiscono alla valutazione di oggi e non sostituiscono il medico curante. Se compaiono sintomi nuovi o il disturbo peggiora torni in Pronto Soccorso anche prima dei tempi indicati; chiami il 112 se il sintomo è grave o improvviso e non si metta alla guida. Porti con sé questo foglio, la documentazione consegnata e l'elenco dei farmaci che assume, allergie comprese. Attenzione ai preparati per l'influenza: contengono già paracetamolo."},"lombalgia":{"nome":"Lombalgia acuta","testo":"MAL DI SCHIENA ACUTO — INDICAZIONI ALLA DIMISSIONE\n\nCOSA SAPERE\n- Nella grande maggioranza dei casi non c'è una lesione grave e il dolore migliora in 2–6 settimane.\n- Le radiografie non servono nel mal di schiena semplice: non cambiano la cura.\n\nCOSA FARE\n- Restare attivi: continuare le normali attività riducendo ciò che fa male. Il riposo a letto oltre 1–2 giorni PEGGIORA il dolore.\n- Camminare ogni giorno e alzarsi spesso se si sta seduti a lungo.\n- Calore locale 20 minuti più volte al giorno.\n\nFARMACI\n- Ibuprofene 400–600 mg fino a 3 volte al giorno a stomaco pieno per 5–7 giorni, oppure ketoprofene sale di lisina 80 mg 2 volte al giorno.\n- Paracetamolo 1 g ogni 8 ore, associabile (massimo 3 g al giorno; 2 g sopra i 75 anni, sotto i 50 kg, con problemi di fegato o se beve alcolici).\n- Farmaco che protegge lo stomaco se prende antinfiammatori per più giorni, ha più di 65 anni, ha avuto ulcera o gastrite, o prende cortisone o cardioaspirina.\n- Se le è stato prescritto un farmaco che rilassa i muscoli (tiocolchicoside 4 mg 2 volte al giorno): non più di 7 giorni, mai in gravidanza, allattamento o in età fertile senza contraccezione sicura. Dà sonnolenza: non guidi, non usi macchinari, non beva alcolici.\n\nTORNI IN PRONTO SOCCORSO SE\n- Difficoltà a urinare, o perdita di urina o feci.\n- Perdita di sensibilità nella zona genitale o all'interno delle cosce.\n- Debolezza di una gamba che peggiora.\n- Febbre insieme al mal di schiena.\n- Dolore che non si calma nemmeno da sdraiati o che sveglia di notte.\n\nCONTATTI PRESTO IL MEDICO SE\n- Ha avuto un tumore, prende cortisone, ha osteoporosi, ha perso peso senza motivo, oppure ha più di 65 anni e il dolore è comparso dopo una caduta.\n\nCONTROLLO\n- Medico curante se il dolore non migliora in 7–10 giorni o si accompagna a dolore lungo la gamba.\n\nQueste indicazioni si riferiscono alla valutazione di oggi e non sostituiscono il medico curante. Se compaiono sintomi nuovi o il disturbo peggiora torni in Pronto Soccorso anche prima dei tempi indicati; chiami il 112 se il sintomo è grave o improvviso e non si metta alla guida. Porti con sé questo foglio, la documentazione consegnata e l'elenco dei farmaci che assume, allergie comprese. Attenzione ai preparati per l'influenza: contengono già paracetamolo."},"distorsione-caviglia":{"nome":"Distorsione di caviglia","testo":"DISTORSIONE DI CAVIGLIA — INDICAZIONI ALLA DIMISSIONE\n\nPRIME 48–72 ORE\n- Ghiaccio 15–20 minuti ogni 2–3 ore, mai a contatto diretto con la pelle.\n- Bendaggio elastico durante il giorno, da togliere la notte.\n- Gamba sollevata sopra il livello del cuore da seduti o sdraiati.\n- Appoggiare il piede quanto il dolore permette, aiutandosi con le stampelle all'inizio.\n\nFARMACI\n- Paracetamolo 1 g ogni 8 ore (massimo 3 g al giorno; 2 g sopra i 75 anni, sotto i 50 kg, con problemi di fegato o se beve alcolici).\n- Ibuprofene 400–600 mg fino a 3 volte al giorno a stomaco pieno per 3–5 giorni; gel antinfiammatorio localmente 2–3 volte al giorno.\n- Non prenda antinfiammatori in gravidanza, con anticoagulanti, ulcera o problemi di reni.\n\nDOPO I PRIMI GIORNI\n- Riprendere gradualmente il movimento: la caviglia rigida guarisce peggio.\n- Esercizi: muovere il piede su e giù, disegnare l'alfabeto con l'alluce, più volte al giorno; poi equilibrio su un piede solo.\n- Tornare allo sport quando si cammina e si corre senza dolore né gonfiore, di solito in 2–6 settimane; cavigliera negli sport per i 6 mesi successivi riduce le recidive.\n\nTORNI IN PRONTO SOCCORSO SE\n- Polpaccio dolente, gonfio e caldo, oppure affanno improvviso o dolore al torace.\n- Dolore sopra la caviglia lungo la gamba, vicino al ginocchio sul lato esterno, o sul bordo esterno del piede: possono essere fratture non visibili all'inizio.\n- Impossibilità di appoggiare il piede dopo 3–4 giorni.\n- Deformità evidente, formicolii persistenti, piede freddo o pallido.\n- Dolore o gonfiore che peggiorano dopo il terzo giorno.\n\nCONTROLLO\n- Medico curante o visita ortopedica se dopo 7–10 giorni persistono dolore o instabilità.\n- Se le è stato messo un tutore o un gesso, chieda al medico curante se le serve una puntura anticoagulante.\n\nQueste indicazioni si riferiscono alla valutazione di oggi e non sostituiscono il medico curante. Se compaiono sintomi nuovi o il disturbo peggiora torni in Pronto Soccorso anche prima dei tempi indicati; chiami il 112 se il sintomo è grave o improvviso e non si metta alla guida. Porti con sé questo foglio, la documentazione consegnata e l'elenco dei farmaci che assume, allergie comprese. Attenzione ai preparati per l'influenza: contengono già paracetamolo."},"faringotonsillite":{"nome":"Faringite / mal di gola","testo":"MAL DI GOLA — INDICAZIONI ALLA DIMISSIONE\n\nCOSA SAPERE\n- La maggior parte dei mal di gola è virale e guarisce da sola in 5–7 giorni: l'antibiotico non serve e non accorcia i tempi.\n- L'antibiotico serve solo nelle forme da streptococco, quando lo indica il medico: in quel caso va completato tutto il ciclo.\n\nFARMACI\n- Paracetamolo 1 g ogni 8 ore (massimo 3 g al giorno; 2 g sopra i 75 anni, sotto i 50 kg, con problemi di fegato o se beve alcolici), oppure ibuprofene 400–600 mg fino a 3 volte al giorno a stomaco pieno.\n- Non prenda insieme bustine o compresse per l'influenza e il raffreddore: contengono già paracetamolo.\n- Bevande fresche o tiepide, ghiaccioli, miele (non sotto l'anno di età).\n\nCOSA FARE\n- Riposo relativo, bere spesso, non fumare.\n- Rientro al lavoro o a scuola dopo almeno 24 ore di antibiotico E almeno 24 ore senza febbre.\n\nTORNI IN PRONTO SOCCORSO SE\n- Difficoltà a respirare, voce ovattata come se avesse qualcosa in bocca, saliva che cola perché non riesce a deglutire.\n- Impossibilità a deglutire anche i liquidi.\n- Difficoltà ad aprire la bocca, gonfiore del collo, dolore forte da un lato solo.\n- Macchie rosse o violacee che NON scompaiono premendoci sopra un bicchiere trasparente.\n- Febbre che dura oltre 5 giorni o che ricompare dopo il miglioramento.\n- Gonfiore del viso, orticaria o affanno dopo l'antibiotico: lo sospenda e chiami il 112.\n\nATTENZIONE PARTICOLARE\n- Se assume metimazolo (per la tiroide), clozapina, immunosoppressori o chemioterapia, un mal di gola con febbre richiede un emocromo urgente: lo dica subito al medico.\n\nCONTROLLO\n- Medico curante se non migliora in 5 giorni.\n\nQueste indicazioni si riferiscono alla valutazione di oggi e non sostituiscono il medico curante. Se compaiono sintomi nuovi o il disturbo peggiora torni in Pronto Soccorso anche prima dei tempi indicati; chiami il 112 se il sintomo è grave o improvviso e non si metta alla guida. Porti con sé questo foglio, la documentazione consegnata e l'elenco dei farmaci che assume, allergie comprese."}};
  // Esame obiettivo: modelli PER IL MEDICO, da incollare nella cartella.
  // Non escono mai dal computer e non contengono dati di nessun paziente.
  const EO = {"base":{"nome":"EO generale","meta":"completo, tutto negativo","testo":"Vigile, orientato, eupnoico, normocolorito, ben perfuso, apiretico. Non segni di distress. Torace: MV normotrasmesso bilateralmente, non rumori patologici aggiunti. Cuore: toni ritmici, validi, non soffi. Polsi periferici presenti e simmetrici. Addome: piano, trattabile, non dolente né dolorabile, peristalsi presente, Blumberg e Murphy negativi, Giordano negativo bilateralmente. Non masse, non organomegalie. Arti inferiori: non edemi, non segni di TVP, polpacci indolori. Neuro: non deficit focali, forza e sensibilità conservate ai 4 arti, non segni meningei. Cute: integra, non lesioni, non esantemi."},"casi":[{"k":"toracico","nome":"Dolore toracico","testo":"Dolore non riproducibile alla palpazione della parete / riproducibile. Toni validi, non sfregamenti. Polsi radiali e femorali simmetrici, PA comparativa agli arti superiori [dx/sx]. Non turgore giugulare. Non edemi. Polpacci indolori simmetrici."},{"k":"dispnea","nome":"Dispnea","testo":"Utilizzo dei muscoli accessori sì/no, parla per frasi intere. MV ridotto alle basi con crepitii bibasali fino a [livello] / sibili diffusi espiratori. Non ottusità plessica. Turgore giugulare. Edemi declivi improntabili fino a [livello]. Polpacci simmetrici."},{"k":"addominale","nome":"Dolore addominale","testo":"Blumberg, Rovsing, Murphy, Giordano, psoas. Non difesa, non peritonismo. Non masse pulsanti (AAA). Orifizi erniari liberi. Peristalsi presente/torpida."},{"k":"cefalea","nome":"Cefalea","testo":"Non segni meningei (Kernig, Brudzinski negativi). Pupille isocoriche isocicliche normoreagenti. Nervi cranici indenni. Non deficit focali, non atassia, Romberg negativo. arterie temporali non dolenti (>50 anni)."},{"k":"trauma","nome":"Trauma / caduta","testo":"Non ferite lacerocontuse. Rachide cervicale non dolente alla palpazione della linea mediana, ROM conservato (criteri NEXUS soddisfatti). Bacino stabile. Non dolorabilità sternale né costale. Arti: assi conservati, non deformità, articolarità e polsi distali conservati, sensibilità integra. Sempre: polso distale + sensibilità + motilità distalmente alla lesione."},{"k":"sincope","nome":"Sincope","testo":"PA in clino e ortostatismo [valori], toni validi non soffi, polsi simmetrici, non deficit neurologici, esplorazione rettale negativa per melena se indicata."},{"k":"lombalgia","nome":"Lombalgia","testo":"Lasègue negativo bilateralmente, forza 5/5 ai distretti L2-S1, ROT rotulei e achillei normoevocabili simmetrici, sensibilità conservata, non anestesia a sella, tono sfinteriale conservato, non globo vescicale (cauda equina)"},{"k":"vertigine","nome":"Vertigine","testo":"Nistagmo [assente/orizzontale con fase rapida verso...], HINTS: head impulse [ ], nistagmo direzione fissa/mutevole, skew deviation assente. Marcia e Romberg [ ]. Non dismetria, non deficit focali."},{"k":"pediatrico","nome":"Pediatrico","testo":"Bambino vivace, reattivo, consolabile, colorito valido, refill capillare <2s, non segni di disidratazione (mucose umide, lacrimazione presente, diuresi riferita normale). Non esantemi, non petecchie. Fontanella normotesa. Non segni meningei."}],"frasi":[{"k":"rettale","nome":"Rettale non eseguita","testo":"Esplorazione rettale non eseguita per rifiuto del paziente"},{"k":"collaborazione","nome":"Neuro poco collaborante","testo":"esame neurologico limitato dalla scarsa collaborazione"},{"k":"nexus","nome":"NEXUS: niente collare","testo":"criteri NEXUS applicabili, non necessaria immobilizzazione"},{"k":"allarme","nome":"Segni d'allarme spiegati","testo":"Paziente informato dei segni d'allarme (elencati), che dichiara di aver compreso, con indicazione a tornare in PS."}]};

  // ================================================================ UTILS
  const sleep = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const now = () => new Date().toLocaleTimeString("it-IT");

  // Copiare negli appunti. navigator.clipboard non esiste sulle origini non
  // sicure (il portale clinico è http://): lì si passa dal vecchio
  // execCommand, che invece funziona. Un pulsante «copia» non deve dipendere
  // da quale delle due pagine si ha davanti.
  // il lampo sul pulsante dopo una copia: era ricopiato in sette punti
  function segnaCopia(b, ok, riposo = "⧉ Copia", ms = 2000) {
    if (!b) return ok;
    b.textContent = ok ? "✓ copiato" : "non riuscito";
    setTimeout(() => { if (b.isConnected) b.textContent = riposo; }, ms);
    return ok;
  }
  async function copiaTesto(text) {
    const t = String(text ?? "");
    try { await navigator.clipboard.writeText(t); return true; } catch { /* ripiego qui sotto */ }
    let ok = false;
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch { ok = false; }
    return ok;
  }

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
    let res, buf;
    try {
      res = await fetch(target.href, {
        method, body, signal: ctl.signal,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "follow",
        headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      });
      // La scadenza e lo STOP devono coprire ANCHE il corpo: il vecchio
      // finally li spegneva appena arrivavano le intestazioni, e un corpo che
      // non arriva mai lasciava la corsa appesa senza modo di fermarla.
      if (new URL(res.url || target.href).origin !== location.origin) {
        throw new StopError("Risposta fuori dall'ospedale bloccata", `destinazione inattesa: ${res.url}`);
      }
      if (!res.ok) throw new StopError(`Il server ha risposto HTTP ${res.status}`, res.statusText || "");
      buf = await res.arrayBuffer();
    } finally {
      clearTimeout(tid);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
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
    [/^leucociti|^globuli bianchi|^wbc/i, "GB"],
    // l'emoglobina glicata è un'altra grandezza in un'altra unità: non deve
    // mai finire nella riga dell'Hb accanto a un'emoglobina in g/dL
    [/emoglobina\s*glicat|^hba1c|\bhb\s?a1c\b/i, "HbA1c"],
    [/^emoglobina(?!\s*glicat)|^hgb\b|^hb\b/i, "Hb"],
    [/^ematocrito|^hct/i, "Ht"], [/^piastrine|^plt/i, "PLT"], [/^eritrociti|globuli rossi|^rbc/i, "GR"],
    [/^mcv|vol\.? glob/i, "MCV"], [/^mchc/i, "MCHC"], [/^mch\b|cont\.? media/i, "MCH"], [/^rdw/i, "RDW"],
    [/^granulociti|neutrofil/i, "Neu"], [/^linfocit/i, "Lin"], [/^monocit/i, "Mon"],
    [/^eosinofil/i, "Eos"], [/^basofil/i, "Bas"], [/altre popolazioni/i, "Altre"],
    [/^creatinin/i, "Cr"], [/^azotemia|^urea/i, "Az"], [/^sodio|^na\b/i, "Na"], [/^potassio|^k\b/i, "K"],
    [/^cloro|^cl\b/i, "Cl"], [/calcio ioniz/i, "Ca++"], [/^calcio/i, "Ca"], [/^magnesio/i, "Mg"],
    [/^glucosio|glicemia/i, "Glu"], [/proteina c reattiva|^pcr\b/i, "PCR"], [/procalcitonin/i, "PCT"],
    [/troponina/i, "Trop"], [/d.?dimero/i, "DD"], [/^inr/i, "INR"], [/^pt\b|protrombin/i, "PT"],
    [/^ptt|tromboplastin/i, "PTT"], [/fibrinogeno/i, "Fib"],
    // "indiretta" contiene "diretta": vanno distinte, o la bilirubina diretta
    // e l'indiretta diventano due righe con la stessa etichetta
    [/bilirubina\s+indiretta|bil\.?\s*indiretta/i, "BilI"],
    [/bilirubina\s+diretta|bil\.?\s*diretta/i, "BilD"],
    [/bilirubina/i, "Bil"], [/^got\b|^ast\b/i, "AST"], [/^gpt\b|^alt\b/i, "ALT"],
    [/gamma\s?gt|^ggt/i, "γGT"], [/fosfatasi alc/i, "ALP"], [/^ldh/i, "LDH"],
    [/\bck\s?-?\s?mb\b/i, "CKMB"], [/^cpk|creatinchinasi|^ck\b(?!\s?-?\s?mb)/i, "CPK"],
    [/^lipasi/i, "Lip"], [/^amilasi/i, "Amy"],
    [/albuminuria|microalbuminur/i, "Albu"], [/^albumin/i, "Alb"],
    [/nt.?pro.?bnp/i, "NTproBNP"], [/^bnp/i, "BNP"], [/^ves\b/i, "VES"],
    [/^ph\b/i, "pH"], [/pco2|pco₂/i, "pCO2"], [/po2\b|po₂/i, "pO2"], [/hco3|bicarbon/i, "HCO3"],
    [/base excess|^be\b|^eb\b/i, "BE"],
    [/lattico\s+deidrogen|lattato\s+deidrogen/i, "LDH"],   // prima di "lattat"
    [/lattat/i, "Lac"], [/saturaz|^so2/i, "SatO2"],
    [/carbossiemo|^cohb/i, "COHb"], [/metaemo|^methb/i, "MetHb"], [/^tsh/i, "TSH"],
    [/emogas/i, "EGA"], [/^ammonio|ammoniem/i, "NH3"], [/^mioglobin/i, "Mb"],
    // urine dipstick and blood-gas derivatives: names the portal's multi-day
    // table shows and the Risultati window does not
    [/corpi chetonici|^chetoni/i, "Chet"], [/esterasi leucocit/i, "EstLeu"],
    [/peso specifico/i, "PesoSp"], [/urobilinogen/i, "Urob"], [/^nitriti/i, "Nitr"],
    [/anion gap/i, "AG"], [/^ca\+\+/i, "Ca++"],
    [/^fcohb/i, "FCOHb"], [/^fo2hb|^fo₂hb/i, "FO2Hb"], [/^hhb/i, "HHb"],
    [/^shunt/i, "Shunt"], [/^ctco2|^ctco₂/i, "ctCO2"], [/^cto2|^cto₂/i, "ctO2"],
  ];
  // The portal writes the specimen in front of the analyte: S-ALT, P-Sodio,
  // U-Emoglobina, Lcr-Glucosio. Serum, plasma and blood are what a sigla
  // already means, so they drop; every other specimen STAYS in the label,
  // because urine haemoglobin is not haemoglobin and must never read as Hb.
  const CAMPIONE = /^\s*(S|P|B|Sg|Ser|Pl)\s*-\s*/i;
  const CAMPIONE_ALTRO = /^\s*(U|Lcr|Liq|F|Fec|Exp|Esc)\s*-\s*/i;
  // Le sezioni dello storico. La chiave è la SIGLA (l'uscita di sigla()), non
  // il nome del laboratorio: così bastano poche righe invece di un elenco di
  // sinonimi, e l'ordine dentro ogni sezione è l'ordine in cui si leggono.
  // Chi non è in elenco finisce in «Altri»: non si perde niente, mai.
  const SEZIONI = [
    ["Emocromo", ["GB", "Neu", "Lin", "Mon", "Eos", "Bas", "Altre", "Hb", "Ht", "GR", "MCV", "MCH", "MCHC", "RDW", "PLT"]],
    ["Coagulazione", ["PT", "INR", "PTT", "Fib", "DD"]],
    ["Biochim", ["PCR", "PCT", "VES", "Trop", "NTproBNP", "BNP", "CPK", "CKMB", "Mb", "LDH"]],
    ["Organi", ["Cr", "Az", "AST", "ALT", "γGT", "ALP", "Bil", "BilD", "BilI", "Amy", "Lip", "Alb", "NH3"]],
    ["Elettroliti e metabolismo", ["Na", "K", "Cl", "Ca", "Ca++", "Mg", "Glu", "HbA1c", "TSH"]],
    ["Emogas", ["pH", "pCO2", "pO2", "HCO3", "BE", "Lac", "SatO2", "AG", "ctCO2", "ctO2", "COHb", "MetHb", "FCOHb", "FO2Hb", "HHb", "Shunt", "EGA"]],
    ["Urine e altri liquidi", ["Albu", "PesoSp", "Nitr", "Chet", "EstLeu", "Urob"]],
  ];
  const ALTRI = "Altri";
  // sigla → [sezione, posizione dentro la sezione], costruita una volta sola
  const DOVE = (() => {
    const m = new Map();
    SEZIONI.forEach(([sez, sigle]) => sigle.forEach((s, i) => m.set(s, [sez, i])));
    return m;
  })();
  // Un'abbreviazione che porta il campione (U·Hb, Lcr·Glu) non è quell'analita
  // nel sangue: l'emoglobina delle urine non va nell'emocromo. Il campione
  // decide la sezione prima di tutto il resto.
  function sezioneDi(sg) {
    const s = String(sg || "");
    if (s.includes("·")) return ["Urine e altri liquidi", 900];
    return DOVE.get(s) || [ALTRI, 900];
  }
  const ordineSezioni = [...SEZIONI.map(([n]) => n), "Urine e altri liquidi", ALTRI]
    .filter((n, i, a) => a.indexOf(n) === i);

  function scomponi(nome) {
    const n = String(nome || "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (CAMPIONE.test(n)) return { pre: "", resto: n.replace(CAMPIONE, "") };
    const m = CAMPIONE_ALTRO.exec(n);
    if (m) return { pre: m[1].toUpperCase() + "·", resto: n.slice(m[0].length) };
    return { pre: "", resto: n };
  }
  function sigla(nome) {
    const n = String(nome || "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const { pre, resto } = scomponi(n);
    for (const [re, s] of SIGLE) if (re.test(resto)) return pre + s;
    // Dropping the prefix only pays off when what is left is a name we KNOW.
    // Otherwise that letter was never a specimen: "S-100" is a protein, not
    // serum 100, and "B-12" is a vitamin. Keep the name whole.
    const w = n.split(/[\s(,]+/).filter(Boolean)[0] || n;   // first word, never a paragraph
    return w.length > 9 ? w.slice(0, 8) + "." : w;
  }
  // An abbreviation this program has NOT been taught is a guess, and a guess
  // that looks like a known sigla is how a doctor reads the wrong analyte.
  // Everywhere a guess is shown it is marked, and counted.
  const siglaCurata = (nome) => SIGLE.some(([re]) => re.test(scomponi(nome).resto));
  // Peggio di un nome che non conosciamo: due nomi DIVERSI che nello stesso
  // prelievo escono con la stessa abbreviazione («PTT secondi» e «PTT Ratio»,
  // «Granulociti» e «Granulociti %»). Anche quelli vanno scritti per esteso.
  function sigleAmbigue(rows) {
    const per = new Map();
    for (const r of rows || []) {
      const nome = String(r.nome || "").trim();
      if (!nome) continue;
      const s = sigla(nome);
      const set = per.get(s) || new Set();
      set.add(nome);
      per.set(s, set);
    }
    const out = new Set();
    for (const [s, nomi] of per) if (nomi.size > 1) out.add(s);
    return out;
  }
  // Le righe divise in sezioni, in ordine FISSO. L'ordine non deve dipendere da
  // come il laboratorio ha stampato la tabella: se dipendesse, lo stesso esame
  // cambierebbe posto da un prelievo all'altro e lo si cercherebbe ogni volta.
  function raggruppaStorico(righe) {
    const per = new Map();
    for (const r of righe || []) {
      const sg = sigla(r.nome);
      const [sez, ord] = sezioneDi(sg);
      if (!per.has(sez)) per.set(sez, []);
      per.get(sez).push({ ...r, sg, ord });
    }
    const out = [];
    for (const sez of ordineSezioni) {
      const l = per.get(sez);
      if (!l) continue;
      l.sort((a, b) => (a.ord - b.ord) || String(a.sg).localeCompare(String(b.sg), "it"));
      out.push({ nome: sez, righe: l });
      per.delete(sez);
    }
    for (const [sez, l] of per) out.push({ nome: sez, righe: l });   // mai, ma non si perde
    return out;
  }

  // Chi ha fatto quale valore. Quasi sempre una macchina sola, e allora non si
  // segna niente. Quando sono due o più — l'emocromo del POC e quello del
  // laboratorio — la più frequente resta muta e le altre prendono un segno,
  // spiegato sotto la tabella e sul valore stesso.
  const SEGNI = ["*", "†", "‡", "§"];
  // `simboli` è condiviso da tutta la tabella (esame → segno): così «*» vuol
  // dire lo stesso esame in ogni riga, e la legenda lo spiega una volta sola.
  function provenienze(r, simboli = new Map()) {
    const conta = new Map();
    (r.valori || []).forEach((v, i) => {
      if (!v || !v.v) return;
      const e = String(v.esame || r.esame || "").trim();
      if (!e) return;
      const c = conta.get(e) || { n: 0, ultimo: -1 };
      c.n++; c.ultimo = i;                       // date: dal più vecchio al più recente
      conta.set(e, c);
    });
    const nulla = { solita: "", segno: () => "", legenda: [] };
    if (conta.size < 2) return nulla;
    const ord = [...conta.entries()].sort((a, b) => (b[1].n - a[1].n) || (b[1].ultimo - a[1].ultimo));
    const solita = ord[0][0];
    const marchi = new Map();
    ord.slice(1).forEach(([e]) => {
      if (!simboli.has(e)) simboli.set(e, SEGNI[simboli.size] || "•");
      marchi.set(e, simboli.get(e));
    });
    return {
      solita,
      segno: (v) => marchi.get(String((v && v.esame) || r.esame || "").trim()) || "",
      legenda: [...marchi.entries()].map(([esame, segno]) => ({ segno, esame, solita })),
    };
  }

  const nomiInattesi = (rows) => {
    const out = [];
    for (const r of rows || []) {
      const n = String(r.nome || "").trim();
      if (n && !siglaCurata(n) && !out.includes(n)) out.push(n);
    }
    return out;
  };

  // ---- comparing draws -----------------------------------------------------
  // The identity of an analyte across draws: the same name however the
  // laboratory spelled it. Rows of two draws meet on this key.
  const valKey = (nome) => String(nome || "").replace(/&nbsp;/g, " ").replace(/[^a-zà-ù0-9%+]+/gi, " ").trim().toLowerCase();

  // First ~160 chars of visible page text, for the log when a page is unexpected.
  function snippet(doc) {
    return (doc.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  // Fail-closed episode pinning: crea/exam pages ALWAYS carry EPISODIO_ID in
  // the audited system, so a page without one is itself an anomaly.
  // IMPORTANT: trust the DOCUMENT first — the response URL only echoes the id
  // WE requested, so it is not independent evidence of what the server served.
  function assertSameEpisode(doc, episodeId, what) {
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
                    .replace(/\s+/g, " ").trim()
                    .replace(/^\d+-\d+\s+/, "");   // «0-324 TROPONINA» → «TROPONINA»: le prime cifre sono del LIS
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
  // Volutamente PIÙ STRETTA di quella in extension/bg.js: là si cacciano i
  // referti, dove «report» è un indizio buono; qui si passa in rassegna una
  // pagina intera e si tengono i primi quattro candidati — una parola larga
  // se li mangia prima che tocchi a quello giusto. Le due cacciano documenti
  // diversi su host diversi: farle identiche era un'idea mia, non un requisito.
  const PDF_SMELL = /uploaddownloadservlet|mimetype=application\/pdf|get_pdf|jasperservlet|refertostream|\.pdf(?:[?&"']|$)/i;
  // Quando un visualizzatore non si lascia leggere, l'unica cosa che può
  // dire com'è fatto è la sua pagina. La si copia SENZA numeri
  // (identificativi, date, token) e senza i valori dei campi: resta la
  // struttura, che è quello che serve per adattare il lettore.
  function mascheraDiagnosi(html) {
    return String(html || "")
      .replace(/(value\s*=\s*")[^"]*(")/gi, "$1…$2")
      .replace(/(value\s*=\s*')[^']*(')/gi, "$1…$2")
      .replace(/\d{3,}/g, "###")
      .slice(0, 16000);
  }
  function diagnosiTesto(d) {
    if (!d) return "";
    let dove = String(d.url || "");
    try { const u = new URL(d.url, location.href); dove = u.pathname + "?" + [...u.searchParams.keys()].join("&"); } catch { /* com'è */ }
    return [`PS Assist ${VERSION} · ${d.quando || ""} · ${d.cosa || ""}`, dove, d.diag || "", "---", mascheraDiagnosi(d.html)].join("\n");
  }
  function bufB64(buf) {
    const by = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < by.length; i += 0x8000) s += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000));
    return btoa(s);
  }

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
      if (signal?.aborted) return finish(reject, new DOMException("Aborted", "AbortError"));
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
      // Il visualizzatore replicato deve sapere DOV'È. Il suo script gira in
      // una cornice che non ha il suo indirizzo, quindi un visualizzatore che
      // costruisce l'indirizzo del PDF dalla propria query string leggeva la
      // nostra: non trovava niente, e si finiva sul ripiego manuale. Qui non
      // si inventa nessun indirizzo — si toglie una bugia che avevamo messo
      // noi: l'indirizzo che gli si dà è il suo, quello che il medico ha
      // aperto. L'indirizzo del PDF continua a calcolarselo lui.
      const suo = (() => { try { return new URL(baseUrl || url, location.href); } catch { return null; } })();
      const LOC = JSON.stringify(suo ? {
        href: suo.href, search: suo.search, pathname: suo.pathname, origin: suo.origin,
        protocol: suo.protocol, host: suo.host, hostname: suo.hostname, port: suo.port, hash: suo.hash,
        toString: undefined,
      } : {});
      const prelude = `<script>(function(){
        window.__psaLoc = ${LOC};
        window.__psaLoc.toString = function(){ return this.href || ""; };
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
      // `location` va riconosciuto SOLO quando è quello globale: preceduto da
      // niente, o da window/self/top/parent/document. Con un prefisso
      // facoltativo «a.location.search» diventava «a.__psaLoc.search», cioè un
      // errore dentro lo script del visualizzatore — che moriva lì.
      const LOCRE = "(?:\\b(?:window|self|top|parent|document)\\s*\\.\\s*|(?<![.\\w$]))location";
      const PROPS = "href|search|pathname|hostname|host|origin|protocol|port|hash";
      const patched = String(html || "")
        .replace(new RegExp(`${LOCRE}\\s*\\.\\s*(?:replace|assign)\\s*\\(`, "g"), "__psaNav(")
        // una SCRITTURA su una qualunque parte dell'indirizzo è una navigazione:
        // prima solo «.href =» era riconosciuta, e «.search = …» finiva fra le
        // letture, cioè spariva senza che nessuno se ne accorgesse
        .replace(new RegExp(`${LOCRE}\\s*\\.\\s*(?:${PROPS})\\s*(?:\\+)?=(?!=)`, "g"), "__psaNavHref =")
        .replace(new RegExp(`\\b(?:window|self|top)\\s*\\.\\s*location\\s*=(?!=)`, "g"), "__psaNavHref =")
        // quello che resta sono LETTURE: codice che vuole sapere dove si trova
        .replace(new RegExp(`${LOCRE}\\s*\\.\\s*(${PROPS})\\b`, "g"), "__psaLoc.$1");
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
  // Un prelievo letto dalla finestra Risultati del gestionale, messo nella
  // stessa forma della tabella del portale: una colonna (la sua data e ora) e
  // una riga per analita. Così la scheda del paziente è una sola, alimentata
  // da tutt'e due le finestre — comprese quelle ancora PARZIALI, che restano
  // marcate come tali.
  // La finestra Risultati porta TUTTA la richiesta («PT, PTT POC, EMOCROMO
  // URGENTE»): un valore va attribuito al SUO esame dentro il pacchetto, o
  // due richieste che differiscono per un esame in più segnerebbero come
  // «fatta con un'altra macchina» ogni riga. Si sceglie l'esame che parla
  // della stessa sezione dell'analita; se non è uno solo, resta il pacchetto.
  const ESAME_DI = {
    "Emocromo": /EMOCROM|EMOCITOM/i,
    "Coagulazione": /\bPT\b|\bPTT\b|\bINR\b|FIBRIN|D.?DIM|COAGUL|ANTITROMB/i,
    "Biochim": /\bPCR\b|PROTEINA C|PROCALC|\bPCT\b|\bVES\b|TROPON|BNP|\bCPK\b|CK.?MB|MIOGLOB|\bLDH\b/i,
    "Organi": /CREATININ|AZOT|\bUREA\b|\bAST\b|\bALT\b|TRANSAMIN|\bGGT\b|GAMMA.?GT|γ.?GT|FOSFATASI|BILIRUB|AMILAS|LIPAS|ALBUMIN|AMMON/i,
    "Elettroliti e metabolismo": /SODIO|POTASSIO|CLORO|CALCIO|MAGNESIO|ELETTROL|GLUC|GLICEM|GLICAT|HBA1C|\bTSH\b/i,
    "Emogas": /EMOGAS|\bEGA\b/i,
    "Urine e altri liquidi": /URIN|LIQU|STICK/i,
  };
  // PT e PTT viaggiano quasi sempre insieme: la sezione non basta a dire
  // quale dei due è il SUO, la sigla sì.
  const ESAME_DI_SIGLA = {
    PT: /\bPT\b|PROTROMB/i, INR: /\bPT\b|PROTROMB|\bINR\b/i, PTT: /\bPTT\b|TROMBOPLASTINA/i, Fib: /FIBRIN/i, DD: /D.?DIM/i,
  };
  function esameDiRiga(exams, label, nome) {
    // un tampone o una PCR virale non fanno valori di chimica: fuori dai candidati
    const tutti = (Array.isArray(exams) ? exams : []).map((x) => String(x || "").replace(/\s+/g, " ").trim())
      .filter((x) => x && !/TAMPONE|MOLECOL|SARS|COV|VIRUS|ANTIGEN/i.test(x));
    const pacchetto = String(label || "").replace(/\s+/g, " ").trim();
    if ((Array.isArray(exams) ? exams.length : 0) < 2) return pacchetto;
    const sg = sigla(nome);
    for (const re of [ESAME_DI_SIGLA[sg], ESAME_DI[sezioneDi(sg)[0]]]) {
      const miei = re ? tutti.filter((x) => re.test(x)) : [];
      if (miei.length === 1) return miei[0];
    }
    return pacchetto;
  }

  function prelievoComeTabella(meta, rows, cf, scartate = []) {
    // La colonna vuole giorno E ora completi: «10/07 22:23» come lo scrive
    // la lista Esiti non dice l'anno, e sia il confronto con «oggi» sia
    // l'ordine fra le colonne si fanno sulla data intera. L'istante della
    // richiesta (DATA_ORD, tenuto come ore UTC) ce l'ha tutta.
    const pad = (n) => String(n).padStart(2, "0");
    const m = DATA_ORA.exec(String(meta?.when || ""));
    const t = !m && meta?.ts ? new Date(meta.ts) : null;
    const data = m ? m[1] : t ? `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}` : String(meta?.when || "").trim();
    const ora = m ? (m[2] || "") : t ? `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` : "";
    const label = [data, ora].filter(Boolean).join(" ");
    if (!label || !rows || !rows.length) return null;
    // il titolo della richiesta viaggia con la colonna: in tabella lo dice il
    // tooltip dell'intestazione, e non serve più una riga per prelievo
    const date = [{ data, ora, label, chiave: label + "#1", id: String(meta?.id || ""), titolo: String(meta?.label || "").replace(/\s+/g, " ").trim() }];
    const righe = rows.filter((r) => r.nome && String(r.valore).trim()).map((r, i) => ({
      nome: String(r.nome).replace(/\s+/g, " ").trim(),
      esame: esameDiRiga(meta?.exams, meta?.label, r.nome),
      codice: "", mnem: "", pos: i,
      valori: [{
        v: String(r.valore).trim(), stato: outOfRange(r.valore, r.range),
        um: String(r.um || "").trim(), range: String(r.range || "").trim(),
        parziale: /parz/i.test(r.stato || ""),
      }],
    }));
    if (!righe.length) return null;
    return { paziente: { idMPI: "", cognome: "", nome: (document.title || "").trim() },
             // le righe che il lettore ha rifiutato viaggiano con la tabella:
             // in Esiti si devono vedere, non solo nella finestra di origine
             cf: cf || "", periodo: "", date, righe,
             scartate: (scartate || []).filter((x) => x && x.nome).slice(0, 40), letto: Date.now() };
  }

  // ------------------------------------------------------- STORICO (portale clinico)
  // "Storico dati clinici" draws the multi-day table as TWO tables side by
  // side: a frozen left one with the exam names, a scrollable right one with
  // one column per draw, row-aligned by position. Nothing is asked of the
  // server here — this reads the table the doctor already has on screen.
  const STORICO_SX = ".clinical-data-table__freeze-container-left table";
  const STORICO_DX = ".clinical-data-table__freeze-container-right table";
  const DATA_ORA = /\b(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))?/;

  function haStorico(doc) { return !!(doc.querySelector(STORICO_SX) && doc.querySelector(STORICO_DX)); }

  // Both tooltips open with an identifier and " - ": the exam one with the
  // catalogue code ("1583 - ALT TRANSAMINASI", "ABC1234 - …"), the specific
  // one with the LIS mnemonic ("ALT - S-ALT (…)", "LINF% - …", "HbA1c - …").
  function primoToken(t) {
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9%._/-]{0,23})\s+-\s+/.exec(String(t || ""));
    return m ? m[1] : "";
  }
  function pezziTooltip(t) {
    const tok = primoToken(t);
    // a code has a number in it: a bare word is a name, and naming it "code"
    // would be a made-up identifier
    const codice = /\d/.test(tok) ? tok : "";
    const resto = tok ? String(t).slice(String(t).indexOf(tok) + tok.length).replace(/^\s*-\s*/, "") : String(t || "");
    return { codice, nome: resto.trim() };
  }
  const mnemonicoStorico = (t) => primoToken(t);

  function leggiStorico(doc) {
    const sx = doc.querySelector(STORICO_SX), dx = doc.querySelector(STORICO_DX);
    if (!sx || !dx) return null;
    // The two tables are one table cut in half: if they ever stop lining up,
    // a value would land on the wrong exam. Then we read nothing at all.
    if (sx.rows.length !== dx.rows.length) return null;

    // Two draws can carry the SAME date and time — a POC and the central lab
    // drawn together is an ordinary morning here — so a column's identity is
    // not its label: each gets an occurrence key, or merging two reads would
    // pour one draw's values into the other's empty cells.
    const date = [], visti = new Map();
    for (const th of dx.rows[0] ? dx.rows[0].cells : []) {
      const m = DATA_ORA.exec((th.textContent || "").replace(/\s+/g, " "));
      if (!m) { date.push(null); continue; }
      const label = m[1] + (m[2] ? " " + m[2] : "");
      const n = (visti.get(label) || 0) + 1;
      visti.set(label, n);
      date.push({ data: m[1], ora: m[2] || "", label, chiave: label + "#" + n });
    }
    if (!date.some(Boolean)) return null;

    const righe = [], scartate = [];
    const nCol = dx.rows[0] ? dx.rows[0].cells.length : 0;
    for (let i = 1; i < sx.rows.length; i++) {
      const tdE = sx.rows[i].querySelector("td.exam");
      if (!tdE) continue;                                   // header and filler rows
      // The LEFT column is the ordered exam ("ESAME URINE COMPLETO"), the one
      // next to it is the analyte ("U-Albumina", "S-ALT"): a panel repeats the
      // same exam on every one of its rows, so the analyte is the name — and
      // its specimen prefix (U-, S-) stays, because U-Emoglobina is not Hb.
      const esame = (tdE.textContent || "").replace(/\s+/g, " ").trim();
      const tdS = sx.rows[i].querySelector("td.exam-specific");
      const spec = tdS ? tdS.querySelector("[uib-tooltip]") : null;
      const nome = (tdS?.textContent || "").replace(/\s+/g, " ").trim() || esame;
      if (!nome) continue;
      const { codice } = pezziTooltip(tdE.querySelector("[uib-tooltip]")?.getAttribute("uib-tooltip"));
      const mnem = mnemonicoStorico(spec?.getAttribute("uib-tooltip"));
      const valori = [];
      const celle = dx.rows[i] ? dx.rows[i].cells : [];
      // one cell per column, or the values would slide under the wrong draw:
      // a row that does not line up is left out AND declared, never guessed
      if (celle.length !== nCol) { scartate.push({ nome, valore: "riga fuori colonna" }); continue; }
      for (let c = 0; c < date.length; c++) {
        if (!date[c]) continue;
        const d = celle[c] ? celle[c].querySelector(".exam-value") : null;
        const v = d ? (d.textContent || "").replace(/\s+/g, " ").trim() : "";
        // the page already knows what is out of range: SUP above, INF below
        const stato = !v || !d.classList.contains("out-of-range") ? 0
          : d.classList.contains("SUP") ? 1 : d.classList.contains("INF") ? -1 : 0;
        valori.push({ v, stato });
      }
      if (valori.some((x) => x.v)) righe.push({ nome, esame, codice, mnem, pos: i, valori });
    }
    if (!righe.length) return null;

    // who this table belongs to — a value under the wrong name is the worst
    // thing this program could do, so the identity travels WITH the values
    const testa = [...doc.querySelectorAll(".panel-heading, app-root-selected-anagrafe")]
      .map((e) => (e.textContent || "").replace(/\s+/g, " ")).find((t) => /idMPI/i.test(t)) || "";
    // "Nome" must not match inside "Cognome": the label starts a word
    // The heading is one line of "Etichetta: valore" pairs. Cutting it on the
    // labels we know is the only way to keep a two-word name whole: a generic
    // "up to the next word with a colon" stops at the first space, turning
    // "MARIA ANNA" into "MARIA" — the name of a different patient.
    const campi = new Map();
    for (const pezzo of testa.split(/\s+(?=(?:idMPI|Cognome|Nome|Sesso|Data di nascita|Data nascita)\s*:)/i)) {
      const m = /^\s*([A-Za-z ]+?)\s*:\s*(.*)$/.exec(pezzo);
      if (m) campi.set(m[1].toLowerCase(), m[2].trim());
    }
    const campo = (k) => campi.get(k.toLowerCase()) || "";
    const periodo = [...doc.querySelectorAll(".panel-heading")]
      .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
      .find((t) => /^Tabella esami periodo/i.test(t)) || "";

    return {
      paziente: { idMPI: campo("idMPI"), cognome: campo("Cognome"), nome: campo("Nome") },
      cf: cfImpronta(doc),
      periodo, date: date.filter(Boolean), righe, scartate, letto: Date.now(),
    };
  }

  // Two reads of the same table can show different draws: the portal only
  // renders the columns in view. Merging by (esame, data) means scrolling the
  // period ADDS draws instead of replacing them.
  function unisciStorico(vecchio, nuovo) {
    if (!vecchio || !nuovo) return nuovo || vecchio || null;
    // Un altro paziente: si ricomincia. Il nome NON basta a dire «è lo
    // stesso»: sul portale si passa da un omonimo all'altro senza ricaricare
    // la pagina, e due persone con lo stesso nome finirebbero in un unico
    // grafico. Quindi devono combaciare il codice fiscale E il nome, e
    // un'identità che non si è potuta leggere conta come un altro paziente.
    if (!stessoPaziente(vecchio.paziente, nuovo.paziente)) return nuovo;
    // Due codici fiscali che non si sono potuti leggere NON sono lo stesso
    // codice fiscale: "" === "" è vero per JavaScript, non per due persone.
    // Senza questa riga due omonimi senza codice finivano in un grafico solo.
    if (!vecchio.cf || !nuovo.cf || vecchio.cf !== nuovo.cf) return nuovo;
    return fondiStorico(vecchio, nuovo);
  }
  // La fusione vera e propria, SENZA il cancello d'identità: la usa chi sa già
  // che le due tabelle sono dello stesso paziente — i prelievi letti in questa
  // scheda del browser sono tutti della pagina aperta.
  function fondiStorico(vecchio, nuovo) {
    if (!vecchio || !nuovo) return nuovo || vecchio || null;
    const date = [...vecchio.date];
    // Due prelievi allo stesso minuto (POC e laboratorio centrale: una
    // mattina qualunque) NON sono lo stesso prelievo: se l'accesso è un
    // altro, la colonna è un'altra e prende il primo numero libero. Senza
    // accesso (la tabella del portale) vale la chiave com'è.
    const rinomina = new Map();
    for (const d of nuovo.date) {
      const k = chiaveCol(d);
      const gia = date.find((x) => chiaveCol(x) === k);
      if (!gia) { date.push(d); continue; }
      if (!d.id || !gia.id || d.id === gia.id) continue;
      const stesso = date.find((x) => x.id && x.id === d.id);
      if (stesso) { rinomina.set(k, chiaveCol(stesso)); continue; }
      let n = 2;
      while (date.some((x) => chiaveCol(x) === d.label + "#" + n)) n++;
      const nuova = { ...d, chiave: d.label + "#" + n };
      date.push(nuova); rinomina.set(k, nuova.chiave);
    }
    date.sort((a, b) => ordData(a.label) - ordData(b.label));   // stable: same minute keeps its order
    const perEsame = new Map();
    const versa = (dati, mappa) => {
      const colDi = (d) => (mappa && mappa.get(chiaveCol(d))) || chiaveCol(d);
      for (const r of dati.righe) {
        // HB is both blood haemoglobin and the urine dipstick: the analyte
        // alone is not an identity, the ordered exam is part of it
        // La chiave di una riga è l'ANALITA, la stessa identità che il
        // programma usa già per dire «è lo stesso esame» fra due prelievi.
        // Così l'emoglobina letta dalla finestra Risultati del gestionale e
        // quella della tabella del portale finiscono nella stessa riga,
        // invece di diventarne due. Quando l'analita non c'è (il nome ricade
        // sulla prestazione) solo la posizione distingue le righe.
        const anonima = !r.mnem && r.nome === r.esame;
        const k = valKey(r.nome) + (anonima ? "|#" + (r.pos ?? 0) : "");
        const cur = perEsame.get(k) || { nome: r.nome, esame: r.esame, codice: r.codice, mnem: r.mnem, pos: r.pos, per: new Map() };
        // La provenienza viaggia CON il valore. Due prelievi possono aver
        // fatto lo stesso esame con macchine diverse (POC e laboratorio):
        // stessa riga, ma si deve poter dire quale cella viene da dove.
        // Una cella che sa già con cosa è stata fatta lo tiene: rifondere una
        // tabella già fusa non deve riscrivere ogni cella con l'esame della
        // riga, o la provenienza (POC vs laboratorio) sparisce alla seconda
        // passata.
        r.valori.forEach((v, i) => { if (v.v && dati.date[i]) cur.per.set(colDi(dati.date[i]), v.esame ? v : r.esame ? { ...v, esame: r.esame } : v); });
        perEsame.set(k, cur);
      }
    };
    versa(vecchio); versa(nuovo, rinomina);
    const righe = [...perEsame.values()].map((e) => ({
      nome: e.nome, esame: e.esame, codice: e.codice, mnem: e.mnem, pos: e.pos,
      valori: date.map((d) => e.per.get(chiaveCol(d)) || { v: "", stato: 0 }),
    }));
    // i referti già letti per questo paziente non si perdono in una fusione
    const referti = [...(nuovo.referti || []), ...(vecchio.referti || [])]
      .filter((r, i, a) => r && r.id && a.findIndex((x) => x.id === r.id) === i).slice(0, 40);
    return { paziente: nuovo.paziente, cf: nuovo.cf || vecchio.cf || "",
             ep: nuovo.ep || vecchio.ep || "", nomeSa4: nuovo.nomeSa4 || vecchio.nomeSa4 || "",
      periodo: nuovo.periodo, date, righe, referti,
             // le stesse righe rifiutate arrivano da tutt'e due i lati quando
             // una tabella viene rifusa: una volta sola
             scartate: [...(vecchio.scartate || []), ...(nuovo.scartate || [])]
               .filter((x, i, a) => x && a.findIndex((y) => y && y.nome === x.nome && y.valore === x.valore) === i).slice(0, 40),
             letto: Date.now() };
  }
  const chiaveCol = (d) => (d && (d.chiave || d.label)) || "";
  const ordData = (label) => {
    const m = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(label || "");
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : 0;
  };
  // names as the two systems write them: "ROSSI MARIO" in SA4PSO's title,
  // Cognome + Nome on the portal. Only those two ORDERS are accepted: sorting
  // the words would make "MARINO BRUNO" and "BRUNO MARINO" the same person,
  // and that check is the only thing standing between one patient's lab table
  // and another patient's screen.
  const normNome = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ").trim().replace(/\s+/g, " ");
  const chiavePaziente = (p) => normNome([p?.cognome, p?.nome].filter(Boolean).join(" "));
  // La scheda di un paziente nell'archivio: il codice fiscale quando c'è (è
  // l'unica identità che non si può confondere), altrimenti il nome.
  const chiaveArchivio = (d) => (d?.cf ? "cf:" + d.cf : "nome:" + chiavePaziente(d?.paziente));
  // Il gestionale scrive il nome come una stringa sola («ROSSI MARIO» o
  // «MARIO ROSSI», a seconda del presidio), il portale lo dà separato: si
  // accettano i due ordini, mai le parole mescolate.
  function stessoPaziente(a, b) {
    const ka = chiavePaziente(a), kb = chiavePaziente(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    return (!a?.cognome && combaciaNome(a?.nome, b)) || (!b?.cognome && combaciaNome(b?.nome, a));
  }
  // SA4PSO scrive il nome come una stringa sola, il portale lo dà già
  // separato: da lì l'ordine delle due parole non si può dedurre. Ma
  // entrambi i sistemi scrivono anche il CODICE FISCALE — il portale nel
  // titolo, il gestionale accanto al nome nella finestra Risultati, che il
  // pannello legge già per i valori. Quello è un identificativo unico: dove
  // c'è, decide lui. Ne teniamo solo l'IMPRONTA, mai il codice in chiaro.
  const CF_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g;
  function cfPagina(doc) {
    const testo = ((doc.title || "") + " " + (doc.body?.textContent || "")).toUpperCase();
    const trovati = [...new Set(testo.match(CF_RE) || [])];
    return trovati.length === 1 ? trovati[0] : "";   // più di uno: non sappiamo quale
  }
  const cfImpronta = (doc) => { const c = cfPagina(doc); return c ? impronta(c) : ""; };

  // Il codice fiscale è più forte del nome, ma le due prove non devono
  // potersi CONTRADDIRE: un codice che combacia accanto a un nome che non
  // ha niente in comune è un segnale che qualcosa non torna, non un via
  // libera. Basta una parola in comune (il titolo può portare altro).
  function nomiCompatibili(titolo, p) {
    const a = normNome(titolo).split(" ").filter((x) => x.length >= 3);
    const b = normNome([p?.cognome, p?.nome].filter(Boolean).join(" ")).split(" ").filter((x) => x.length >= 3);
    if (!a.length || !b.length) return true;          // uno dei due non è leggibile
    return a.some((x) => b.includes(x));
  }
  // Fra le schede in archivio, quella di questo paziente. DUE PASSATE, non
  // una decisione per candidato: se esiste una scheda col codice fiscale di
  // questo paziente è QUELLA, sempre. Si ripiega sul nome solo se nessuna
  // scheda porta un codice fiscale — altrimenti un omonimo senza codice,
  // incontrato per primo, vincerebbe su una scheda verificata col codice.
  function scegliScheda(indice, mio, titolo, ep) {
    const v = indice || [];
    // Prima di tutto: la scheda letta ARRIVANDO DA QUESTO PAZIENTE. È stato il
    // medico ad aprire il portale da questa pagina, e nessun confronto di nomi
    // può essere più sicuro di così.
    // …ma il clic non può CONTRADDIRE le altre prove: sul portale si passa
    // da un omonimo all'altro senza ricaricare, e la scheda arrivata da quel
    // clic può essere di un altro ROSSI MARIO. Con un codice fiscale diverso
    // o un nome che non c'entra, il clic non conta.
    if (ep) {
      const suo = v.find((x) => x.ep && String(x.ep) === String(ep)
        && (!mio || !x.cf || x.cf === mio) && nomiCompatibili(titolo, x.paziente));
      if (suo) return suo;
    }
    // Se di questo paziente conosciamo il codice fiscale, decide SOLO quello:
    // niente ripieghi sul nome, perché una scheda senza codice col suo stesso
    // nome può essere di un omonimo.
    if (mio) return v.find((x) => x.cf === mio && nomiCompatibili(titolo, x.paziente)) || null;
    // Se non lo conosciamo ancora, si può andare solo per nome — ma allora si
    // guarda solo fra le schede che un codice non ce l'hanno: una scheda che
    // porta un codice non si può attribuire a un paziente di cui non ne
    // sappiamo nessuno.
    return v.find((x) => !x.cf && combaciaNome(titolo, x.paziente)) || null;
  }
  function combaciaNome(titolo, p) {
    const t = normNome(titolo);
    const c = normNome(p?.cognome), n = normNome(p?.nome);
    if (!t || (!c && !n)) return false;
    const dritto = [c, n].filter(Boolean).join(" ");
    const rovescio = [n, c].filter(Boolean).join(" ");
    return t === dritto || t === rovescio;
  }

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

  // Returns the value rows AND the candidate rows it refused: a row this
  // parser does not understand must become a warning, never a hole.
  function parseRisultati(doc) {
    const rows = [], scartate = [];
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
      if (!dataOk && !rangeOk && !statoOk) { scartate.push({ nome, valore }); continue; }
      rows.push({ nome, valore, um, range, stato });
    }
    return { rows, scartate };
  }

  // One chronological list of everything the lab/radiology returned for this
  // patient: values we can read (risultati) and reported documents (referti).
  // what a values row needs to exist on its own, without the page
  const risMeta = (e) => ({ id: e.id || "", url: e.url, label: e.label || "", exams: e.exams || [], when: e.when || "", ts: e.ts || 0 });

  // What a referto row is, from its own label: decides how it opens today and
  // which ones become inline text when their sources are wired (lab table, RX
  // and ECG referti). Anything else stays a document you open.
  function refertoTipo(e) {
    const l = String(e.label || "").toUpperCase();
    const sis = String(e.sistema || "").toUpperCase();
    if (/ELETTROCARDIOGRAMM|\bECG\b/.test(l)) return "ecg";
    // the whole of radiology reads as text, not just plain films: the system
    // that issued the document says it better than the exam's name does
    if (sis.includes("RIS") || /\bRX\b|RADIOGRAF|\bTC\b|\bTAC\b|ECOGRAF|RISONANZA|\bRMN\b/.test(l)) return "rx";
    if (sis.includes("LIS")) return "lab";
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

  // Un tetto duro ai tentativi, UNO SOLO per tutta la caccia: un documento che
  // non si lascia catturare in pochi colpi si apre in una scheda e si stampa da
  // lì. Il contatore va passato ai livelli sotto — quando stava dentro la
  // funzione ogni ricorsione ripartiva da zero e il tetto vero era 6+6×6 = 43.
  const MAX_TENTATIVI = 6;
  async function fetchPdf(url, { signal, hop = 0, budget } = {}) {
    budget = budget || { n: 0 };
    const target = new URL(url, location.href);
    if (target.origin !== location.origin) {
      throw new StopError("Richiesta fuori dall'ospedale bloccata", `destinazione inattesa: ${target.origin}`);
    }
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(new DOMException("Timeout", "TimeoutError")), TIMEOUT_MS);
    const onAbort = () => ctl.abort(new DOMException("Aborted", "AbortError"));
    if (signal) {
      // agganciarsi a un segnale GIÀ abortito non fa scattare niente: chiudere
      // la finestra di stampa deve fermare anche il tentativo che deve ancora
      // partire, non solo quello in volo
      if (signal.aborted) { clearTimeout(tid); throw new DOMException("Aborted", "AbortError"); }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    let res;
    try {
      res = await fetch(target.href, { signal: ctl.signal, credentials: "same-origin", cache: "no-store", redirect: "follow" });
      if (new URL(res.url || target.href).origin !== location.origin) {
        throw new StopError("Risposta fuori dall'ospedale bloccata", `destinazione inattesa: ${res.url}`);
      }
      if (!res.ok) throw new StopError(`Il server ha risposto HTTP ${res.status}`, res.statusText || "");
    } finally {
      clearTimeout(tid);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
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
        if (++budget.n > MAX_TENTATIVI) return null;
        let u; try { u = new URL(String(raw).replace(/&amp;/gi, "&").trim(), base); } catch { return null; }
        if (u.origin !== location.origin || u.href === base) return null;
        if (tried.includes(u.href)) return null;
        tried.push(u.href);
        try {
          const r = await fetchPdf(u.href, { signal, hop: hop + 1, budget });
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

      // Qui prima c'era una terza strada: prendere l'id del documento dalla
      // pagina e COSTRUIRE l'indirizzo del PDF. È stata tolta. Un indirizzo
      // costruito a mano su un id letto male non dà un errore: dà il
      // documento di qualcun altro. La regola del programma è che gli
      // indirizzi si prendono dalla pagina, e questa era l'unica eccezione.

      // 3. replay the viewer (sandboxed) and take the URL/Blob it produces
      // In the banco di prova the replay is skipped on purpose: it would run a
      // viewer's own script inside a frame, and the banco's promise is that
      // nothing on the page can reach the network. The tab fallback covers it.
      if (DEMO) throw new ViewerError(target.href);
      try { return { ...(await harvestInlinePdf(target.href, { html: text, baseUrl: base, signal })), via: "replay del visualizzatore" }; }
      catch (e) {
        if (e?.name === "AbortError") throw e;
        const err = new ViewerError(target.href);
        // NB: questa diagnosi è l'unica cosa che dice, da uno schermo al
        // lavoro, com'è fatto il visualizzatore vero. Era morta: citava una
        // variabile che non esiste più, quindi al posto del ViewerError con la
        // diagnosi partiva un ReferenceError, e non si vedeva niente.
        const idQui = /\b[A-Z][A-Z0-9]*_[A-Z0-9]+_\d{6,}\b/.test(text);
        err.diag = `html ${Math.round(text.length / 1024)}KB · ${(text.match(/<script/gi) || []).length} script · ${(text.match(/<frame\b/gi) || []).length} frame · tentati ${tried.length} URL · id ${idQui ? "sì" : "no"} · upload ${/uploaddownloadservlet/i.test(text) ? "sì" : "no"}`;
        err.html = text;   // la pagina stessa, per «⧉ Diagnosi» (mascherata prima di copiarla)
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
  // Un solo magazzino, due depositi. `set` torna false quando la scrittura NON
  // è avvenuta (memoria piena o bloccata): chi promette al medico «salvato»
  // deve poterlo verificare — e ora vale anche per le consegne fra pagina e
  // pagina, che prima fallivano in silenzio.
  const magazzino = (dep) => ({
    get(key, fallback) {
      try { const v = JSON.parse(dep.getItem(NS + key)); return v ?? fallback; }
      catch { return fallback; }
    },
    set(key, value) { try { dep.setItem(NS + key, JSON.stringify(value)); return true; } catch { return false; } },
    del(key) { try { dep.removeItem(NS + key); return true; } catch { return false; } },
    keys(prefix) {
      try { return Object.keys(dep).filter((k) => k.startsWith(NS + prefix)).map((k) => k.slice(NS.length)); }
      catch { return []; }
    },
  });
  const store = magazzino(localStorage);
  // Tab-scoped storage for the run→landing handoffs (receipt + auto-confirm
  // flag): sessionStorage survives the same-tab navigation but is invisible
  // to other tabs, so two patients in two tabs can never clobber or clear
  // each other's pending confirm.
  const tabStore = magazzino(sessionStorage);

  // ------------------------------------------------------- KNOWN PATIENTS
  // I pazienti su cui si è lavorato, per ritrovarli dalla schermata iniziale:
  // nome, episodio e indirizzo della pagina. Un turno è di dodici ore e i
  // pazienti sono più di dodici, quindi l'elenco tiene un giorno e non ha un
  // limite che dia fastidio. Qui non entra MAI contenuto clinico (né esami,
  // né valori, né quesito): quello sta nella scheda, che è un'altra cosa.
  // Chi viene dimesso si ARCHIVIA: esce dall'elenco principale e resta negli
  // archiviati, da dove si può riportare indietro o cancellare del tutto.
  const PATIENTS_TTL = 24 * 3600e3;
  const PATIENTS_MAX = 60;

  function tuttiPazienti() {
    const list = store.get("patients.v1", []);
    const fresh = Array.isArray(list) ? list.filter((p) => p && p.ep && Date.now() - (p.ts || 0) < PATIENTS_TTL) : [];
    return fresh.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, PATIENTS_MAX);
  }
  const knownPatients = () => tuttiPazienti().filter((p) => !p.arch);
  const pazientiArchiviati = () => tuttiPazienti().filter((p) => p.arch);
  function rememberPatient(ep, name, url) {
    if (!ep) return;
    const prima = tuttiPazienti().find((p) => p.ep === ep);
    const list = tuttiPazienti().filter((p) => p.ep !== ep);
    // riaprire un paziente archiviato lo riporta fra i vivi: se sei sulla sua
    // pagina, è di lui che ti stai occupando
    list.unshift({ ep, name: (name || "").trim().slice(0, 60), url: url || "", ts: Date.now(),
                   pk: prima?.pk || "" });
    store.set("patients.v1", list.slice(0, PATIENTS_MAX));
  }
  // la chiave della scheda clinica, annotata quando la conosciamo, così
  // archiviare o eliminare un paziente sa cosa toccare
  function segnaChiave(ep, pk) {
    if (!ep || !pk) return;
    const list = tuttiPazienti();
    const p = list.find((x) => x.ep === ep);
    if (!p || p.pk === pk) return;
    p.pk = pk;
    store.set("patients.v1", list);
  }
  function archiviaPaziente(ep, si = true) {
    const list = tuttiPazienti();
    const p = list.find((x) => x.ep === ep);
    if (!p) return false;
    p.arch = !!si;
    p.archTs = si ? Date.now() : 0;
    return store.set("patients.v1", list);
  }
  // Eliminare un paziente vuol dire eliminare TUTTO quello che il programma
  // sa di lui: la riga nell'elenco, la sua scheda clinica, i referti tenuti,
  // la nota, e i dati per episodio in questa scheda del browser.
  function eliminaPaziente(ep, pk, nome) {
    const list = tuttiPazienti().filter((x) => x.ep !== ep);
    store.set("patients.v1", list);
    // la nota può stare sotto la chiave del codice fiscale O sotto il nome,
    // a seconda di quando è stata scritta: si tolgono tutt'e due
    const n = store.get(noteKey, {});
    const perNome = nome ? "nome:" + normNome(nome) : "";
    let tolte = 0;
    for (const k of [pk, perNome].filter(Boolean)) if (n[k]) { delete n[k]; tolte++; }
    if (tolte) store.set(noteKey, n);
    const s = store.get(segniKey, {});   // e i segni sui valori, stesse chiavi
    let toltiSegni = 0;
    for (const k of [pk, perNome].filter(Boolean)) if (s[k]) { delete s[k]; toltiSegni++; }
    if (toltiSegni) store.set(segniKey, s);
    try {
      for (const k of Object.keys(sessionStorage)) {
        const kk = k.startsWith(NS) ? k.slice(NS.length) : "";
        if (kk && new RegExp(`(^|\\.)(ris|visto|reftxt|log|refopen|ui)\\.${ep}\\b`).test(kk)) sessionStorage.removeItem(k);
      }
    } catch { /* memoria bloccata: niente da togliere */ }
    if (hasExt()) ask({ t: "delStorico", chiave: pk, ep, nome: nome || "" }).catch(() => {});
    return true;
  }
  function forgetPatients() { store.set("patients.v1", []); }
  // end of shift / another user: drop names and every per-episode leftover
  function forgetAll() {
    forgetPatients();
    forgetQuesiti();
    try {
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith(NS) && /(^|\.)(ris|visto|reftxt|log|refopen|receipt|confirm|queue|print|ui|afterNav|dimdraft|storico)\b/.test(k.slice(NS.length))) sessionStorage.removeItem(k);
      }
    } catch { /* blocked storage: nothing to clear */ }
    try { if (typeof chrome !== "undefined" && chrome.runtime?.id) chrome.runtime.sendMessage({ t: "clearRef" }, () => void chrome.runtime.lastError); } catch { /* not the extension build */ }
  }

  // The doctor's edits live in localStorage under their own key. They are
  // templates, not patient data, so forgetAll leaves them alone — and nothing
  // patient-specific ever gets written here.
  // ------------------------------------------------------------- CONSENSI
  // I moduli di consenso stanno DENTRO l'estensione (cartella consensi/):
  // niente rete, niente server, funzionano anche se il gestionale è giù.
  // Un tocco apre il PDF e la finestra di stampa, come per la lista esami.
  const CONSENSI = [
    { k: "emocolture", nome: "Emocolture", file: "emocolture.pdf",
      esteso: "Esame colturale su campioni biologici diversi" },
    { k: "hiv-dipendente", nome: "HIV Dipendente", file: "hiv-dipendente.pdf",
      esteso: "Consenso del dipendente all'esecuzione del test HIV (MDL 170)" },
    { k: "lesioni-animali", nome: "Lesioni Animali", file: "lesioni-animali.pdf",
      esteso: "Rapporto di lesione provocata da animali" },
    { k: "antitetano", nome: "Antitetano", file: "antitetano.pdf",
      esteso: "Immuno-profilassi antitetanica" },
    { k: "tac-cmdc", nome: "TAC cmdc", file: "tac-cmdc.pdf",
      esteso: "Consenso alla TAC con mezzo di contrasto" },
  ];
  // nel banco di prova non c'è un'estensione: la pagina finta serve un PDF
  const urlConsenso = (c) => (DEMO ? "/consensi/" + c.file
    : (hasExt() ? chrome.runtime.getURL("consensi/" + c.file) : ""));

  // ------------------------------------------------------------------ NOTA
  // Una nota per paziente, sotto il suo nome. Si scrive e basta: non c'è un
  // tasto Salva, si salva mentre scrivi. Sta nel browser di questo computer,
  // legata al paziente (codice fiscale quando c'è, altrimenti il nome), e
  // scade dopo 24 ore come i dati clinici letti.
  const noteKey = "note.v1";
  const NOTA_TTL = 24 * 3600e3;
  function noteTutte() {
    const n = store.get(noteKey, {});
    const ora = Date.now();
    let pulito = false;
    for (const k of Object.keys(n)) if (ora - (n[k]?.ts || 0) > NOTA_TTL) { delete n[k]; pulito = true; }
    if (pulito) store.set(noteKey, n);
    return n;
  }
  const leggiNota = (chiave) => (chiave ? (noteTutte()[chiave]?.t || "") : "");
  function scriviNota(chiave, testo) {
    if (!chiave) return false;
    const n = noteTutte();
    if (String(testo).trim()) n[chiave] = { t: String(testo).slice(0, 4000), ts: Date.now() };
    else delete n[chiave];
    return store.set(noteKey, n);
  }

  // ----------------------------------------------------------------- SEGNI
  // Un valore toccato si evidenzia: giallo, al secondo tocco arancio, al
  // terzo torna com'era. Il medico «segna» quello che vuole tenere d'occhio.
  // Per paziente come la nota, con la stessa chiave e la stessa scadenza;
  // la cella è «colonna|analita», la stessa identità della tabella.
  const segniKey = "segni.v1";
  function segniTutti() {
    const s = store.get(segniKey, {});
    const ora = Date.now();
    let pulito = false;
    for (const k of Object.keys(s)) if (ora - (s[k]?.ts || 0) > NOTA_TTL) { delete s[k]; pulito = true; }
    if (pulito) store.set(segniKey, s);
    return s;
  }
  const leggiSegni = (chiave) => (chiave ? (segniTutti()[chiave]?.celle || {}) : {});
  function scriviSegno(chiave, cella, stato) {
    if (!chiave || !cella) return false;
    const s = segniTutti();
    const celle = { ...(s[chiave]?.celle || {}) };
    if (stato) celle[cella] = stato; else delete celle[cella];
    if (Object.keys(celle).length) s[chiave] = { celle, ts: Date.now() }; else delete s[chiave];
    return store.set(segniKey, s);
  }
  // come la nota: i segni fatti prima di conoscere il codice fiscale lo seguono
  function migraSegni(da, a) {
    const s = segniTutti();
    if (!s[da]) return;
    // due buste (una per il nome, una per il codice) si sommano, non si scelgono
    s[a] = { celle: { ...s[da].celle, ...(s[a]?.celle || {}) }, ts: Date.now() };
    delete s[da];
    store.set(segniKey, s);
  }

  // ----------------------------------------------------------------- TEMPI
  // Un cronometro per capire dove va il tempo di un turno. Si tiene solo
  // l'ISTANTE DI INIZIO, mai i secondi passati: così ricaricare la pagina o
  // riavviare il browser non perde niente e il conto resta giusto. Il
  // cronometro in corso è semplicemente la voce che non ha ancora una fine.
  const tempiKey = "tempi.v1";
  const TEMPI_TTL = 7 * 24 * 3600e3;
  const TITOLI = ["Visita ed esami", "Scrittura cartella", "Gestione (consulenti)", "Dimissione"];
  function tempi() {
    const l = store.get(tempiKey, []);
    const ora = Date.now();
    const vivi = (Array.isArray(l) ? l : []).filter((t) => t && t.inizio && ora - t.inizio < TEMPI_TTL);
    if (vivi.length !== (Array.isArray(l) ? l.length : 0)) store.set(tempiKey, vivi);
    return vivi;
  }
  const tempoInCorso = () => tempi().find((t) => !t.fine) || null;
  function avviaTempo(titolo, paz, ep) {
    const l = tempi();
    const ora = Date.now();
    for (const t of l) if (!t.fine) t.fine = ora;   // uno solo alla volta: il precedente si chiude
    l.push({ id: "t" + ora.toString(36), titolo: String(titolo || "").slice(0, 60) || "Attivita",
             paz: String(paz || "").slice(0, 60), ep: String(ep || ""), inizio: ora });
    return store.set(tempiKey, l);
  }
  function fermaTempo() {
    const l = tempi();
    const t = l.find((x) => !x.fine);
    if (!t) return false;
    t.fine = Date.now();
    return store.set(tempiKey, l);
  }
  const scordaTempo = (id) => store.set(tempiKey, tempi().filter((t) => t.id !== id));
  const durata = (t) => Math.max(0, ((t.fine || Date.now()) - t.inizio));
  const mmss = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
  };
  const oraDi = (ms) => new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const giornoDi = (ms) => new Date(ms).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });

  const dimKey = "dimissioni.v1";
  // A short fingerprint of the text a doctor's version was forked from. It is
  // what lets a later release SAY that the original changed (a dose, a
  // contraindication): without it, a corrected sheet would be silently
  // invisible to everyone who had ever edited that sheet.
  function impronta(testo) {
    let h = 0x811c9dc5;
    const t = String(testo || "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  const dimValido = (v) => !!(v && typeof v.testo === "string" && v.testo.trim());
  function dimissioni() {
    const mie = store.get(dimKey, {});
    const out = {};
    for (const [k, v] of Object.entries(DIMISSIONI)) {
      const m = dimValido(mie[k]) ? mie[k] : null;
      out[k] = {
        nome: v.nome, testo: m ? m.testo : v.testo, originale: v.testo, modificato: !!m,
        rivisto: !!v.rivisto,
        // the shipped text moved AFTER this doctor forked it
        aggiornato: !!(m && m.base && m.base !== impronta(v.testo)),
      };
    }
    for (const [k, v] of Object.entries(mie)) {
      if (!out[k] && dimValido(v)) out[k] = { nome: (v.nome || k), testo: v.testo, originale: "", modificato: true, mio: true };
    }
    return out;
  }
  function salvaDimissione(k, nome, testo) {
    const mie = store.get(dimKey, {});
    const base = DIMISSIONI[k];
    if (base && testo.trim() === base.testo.trim()) delete mie[k];   // back to the original: stop overriding
    else mie[k] = { nome, testo, base: base ? impronta(base.testo) : "" };
    return store.set(dimKey, mie);
  }
  function ripristinaDimissione(k) {
    const mie = store.get(dimKey, {});
    delete mie[k];
    return store.set(dimKey, mie);
  }

  // EO — un elenco piatto chiave→voce, così una riga o una tendina copiano
  // allo stesso modo. I testi sono quelli scritti dal medico, verbatim.
  function eoVoci() {
    const out = {};
    if (EO.base && EO.base.testo) out.base = { nome: EO.base.nome || "EO generale", meta: EO.base.meta || "", testo: EO.base.testo, gruppo: "base" };
    for (const v of EO.casi || []) if (v && v.k && v.testo) out["caso:" + v.k] = { nome: v.nome || v.k, testo: v.testo, gruppo: "casi" };
    for (const v of EO.frasi || []) if (v && v.k && v.testo) out["frase:" + v.k] = { nome: v.nome || v.k, testo: v.testo, gruppo: "frasi" };
    return out;
  }

  function learnedCatalog() { return store.get("catalog.v1", {}); }
  // Il catalogo si impara dalle pagine vere, MA un nome già noto non viene
  // mai sovrascritto. Il motivo è il controllo anti-esame-sbagliato: quello
  // confronta il nome della riga viva col nome con cui l'esame è stato
  // scelto. Se la stessa pagina potesse riscrivere il catalogo un istante
  // prima del click, il confronto sarebbe fra un valore e se stesso — e non
  // potrebbe più fallire. Un codice che oggi porta un altro nome è proprio
  // l'anomalia che deve fermare tutto: la si registra, non la si assorbe.
  function learnFrom(model) {
    if (!model.res || !model.exams.length) return;
    const cat = learnedCatalog();
    const entry = cat[model.res] || { label: "", items: {} };
    const opt = model.resOptions.find((o) => o.value === model.res);
    if (opt) entry.label = opt.label;
    const incisi = (EMBEDDED_CATALOG[model.res] || {}).items || {};
    entry.rinominati = entry.rinominati || {};
    for (const e of model.exams) {
      const noto = incisi[e.code] || entry.items[e.code];
      if (!noto) { entry.items[e.code] = e.label; delete entry.rinominati[e.code]; continue; }
      if (normEsame(noto) !== normEsame(e.label)) entry.rinominati[e.code] = e.label;
      else delete entry.rinominati[e.code];
    }
    entry.ts = Date.now();
    cat[model.res] = entry;
    store.set("catalog.v1", cat);
    return entry.rinominati;
  }
  // i codici che su questa pagina portano un nome diverso da quello noto
  const rinominatiQui = (model) => {
    const r = (learnedCatalog()[model.res] || {}).rinominati || {};
    return (model.exams || []).filter((e) => r[e.code]).map((e) => `${e.code}: «${r[e.code]}»`);
  };
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
  // Il laboratorio affianca al vecchio esame la sua versione «- NEW» e lascia
  // in elenco tutti e due (l'emogas venoso e l'arterioso sono così). Chi
  // ordina vuole il nuovo. Il confronto è sul NOME, non sul numero, che cambia
  // da un ospedale all'altro.
  // NB: si toglie SOLO il mnemonico in fondo — «(POC2117)» — non tutte le
  // parentesi: «EPATITE B (HBSAG) ANTICORPI» e «EPATITE B (HBEAG) ANTICORPI»
  // sono due esami diversi e diventerebbero lo stesso nome.
  const baseEsame = (label) => String(label || "").replace(/&nbsp;/gi, " ").toUpperCase()
    .replace(/\s*\([A-Z]*\d+\)\s*$/, " ").replace(/\s+-\s*NEW\b/g, " ").replace(/\bPOC\b/g, " ")
    .replace(/[^A-Z0-9()]+/g, " ").trim();
  const eNuovo = (label) => /\s-\s*NEW\b/i.test(String(label || "").replace(/&nbsp;/gi, " "));
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
  //   examDoc/examUrl: (exam only) the live page — used ONLY to find the
  //              list URL, which is then re-read from the server,
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
        assertSameEpisode(doc, plan.episodeId, "nuova richiesta");
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
        assertSameEpisode(doc, plan.episodeId, "esami della richiesta");
        if (classify(doc) !== "exam") {
          log(`pagina inattesa dopo Crea: "${snippet(doc)}"`);
          throw new StopError("Il server non ha aperto la pagina esami dopo la creazione", "Controlla a mano (vedi Registro).");
        }
        done(sCrea);
        await pace();
      } else {
        // La pagina esami che il medico ha davanti NON è una fonte attendibile:
        // gli inserimenti viaggiano in background, quindi dopo una corsa
        // interrotta il carrello sullo schermo è quello di prima. Fidarsene
        // vorrebbe dire leggere «non c'è» un esame che c'è già — e ordinarlo
        // una seconda volta. Del DOM vivo si prende solo l'INDIRIZZO
        // dell'elenco, e lo si rilegge dal server come fa tutto il resto del
        // motore: una richiesta in più, e in cambio i due controlli che questa
        // strada saltava — sessione scaduta ed episodio.
        const vivo = examModel(plan.examDoc, plan.examUrl);
        ({ doc, url } = await fetchDoc(vivo.listUrl(vivo.res) || plan.examUrl, { signal }));
        guardSession(doc, "Nessun esame inviato");
        assertSameEpisode(doc, plan.episodeId, "esami della richiesta");
        if (classify(doc) !== "exam") {
          log(`pagina esami inattesa alla partenza: "${snippet(doc)}"`);
          throw new StopError("Questa non è più la pagina degli esami", "Ricaricala e riprova. Nessun esame inviato.");
        }
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
          assertSameEpisode(doc, plan.episodeId, "elenco esami");
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
        // La versione «- NEW» dello stesso esame, se la pagina ne offre una:
        // si guarda l'elenco VIVO, non il catalogo, così vale in ogni sede e
        // anche per gli esami nuovi che il catalogo non ha mai visto.
        if (!/^esame \d+$/i.test(it.label) && !eNuovo(it.label)) {
          const mia = baseEsame(it.label);
          const nuova = mia && model.exams.find((e) => e.isAdd && eNuovo(e.label) && baseEsame(e.label) === mia);
          if (nuova && nuova.code !== it.code) {
            log(`questa sede ha la versione nuova: «${nuova.label}» al posto di «${it.label}»`);
            it.code = nuova.code; it.label = nuova.label;
          }
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
        assertSameEpisode(doc, plan.episodeId, "conferma inserimento");
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
          assertSameEpisode(doc, plan.episodeId, "verifica carrello");
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
        // Il carrello di QUESTA risorsa come lo vediamo adesso. La Conferma
        // nativa invia la richiesta INTERA, comprese le righe che stanno sul
        // carrello di un'altra risorsa e che questa pagina non mostra: senza
        // registrarle qui, l'auto-conferma non potrebbe nemmeno vederle.
        state.carrelli = state.carrelli || {};
        state.carrelli[model.res] = model.exams.filter((e) => e.isDel).map((e) => String(e.code));
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
        carrelli: state.carrelli || {},
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
                  font-size: 13px; font-weight: 700; color: #35506B; cursor: pointer;
                  min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .seg button + button { border-left: 1px solid #C4D0DC; }
    .seg button.on { background: #0B5CAD; color: #fff; }
    .seg button:not(.on):hover { background: #EAF2FA; color: #0B5CAD; }
    .seg .n { margin-left: 4px; font-weight: 800; opacity: .7; font-variant-numeric: tabular-nums; }
    /* Seconda riga: Dimissioni, Consensi, EO non appartengono al paziente che
       hai davanti — sono modelli. Stanno separati e pesano meno di proposito:
       la riga sopra è quello che AGISCE su questo paziente. */
    .seg2 { display: flex; align-items: center; gap: 5px; margin: 7px 12px 0; flex-wrap: wrap; }
    .seg2lab { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
               color: #A3B2C2; margin-right: 1px; cursor: default; }
    .seg2 button { border: 1px solid #E3E8EF; background: #fff; border-radius: 999px; padding: 4px 11px;
                   font: inherit; font-size: 11.5px; font-weight: 700; color: #5D6E7E; cursor: pointer; }
    .seg2 button:hover { border-color: #9DBFDE; background: #F4F9FD; color: #0B5CAD; }
    .seg2 button.on { border-color: #9DBFDE; background: #EAF2FA; color: #0B5CAD; }
    .seg2 button:focus-visible { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    .rgo { flex: 0 0 auto; color: #8296A9; font-size: 12px; }
    .pcard { border: 1px solid #E3E8EF; border-radius: 10px; padding: 9px 10px; margin-bottom: 7px; background: #fff; cursor: pointer; }
    .pcard:hover { border-color: #9DBFDE; background: #F4F9FD; }
    .pcard:focus-visible { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    .pgo { float: right; color: #0B5CAD; font-weight: 700; font-size: 11px; }
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
    .dlist { display: flex; flex-direction: column; gap: 4px; }
    .dsep { display: flex; align-items: center; gap: 8px; margin: 8px 2px 3px; font-size: 10.5px;
            color: #A3B2C2; text-transform: uppercase; letter-spacing: .06em; }
    .dsep::after { content: ""; flex: 1 1 auto; height: 1px; background: #E3E8EF; }
    .drow { display: flex; align-items: stretch; gap: 5px; }
    /* Copying is what this list is FOR: the target is the whole row, not a
       13px glyph at its edge. The pencil stays a button of its own. */
    .dcopia { flex: 1 1 auto; display: flex; align-items: center; gap: 8px; min-width: 0; text-align: left;
              border: 1px solid #E3E8EF; border-radius: 9px; background: #fff; cursor: pointer;
              padding: 8px 10px 8px 11px; font: inherit; }
    .dcopia:hover { border-color: #9DBFDE; background: #F4F9FD; }
    .dcopia:focus-visible { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    .dcopia.fatto { border-color: #BCE0C9; background: #EDF7F0; }
    .dcopia.fatto .dico { color: #124F31; }
    .dnome { flex: 1 1 auto; font-size: 12.5px; font-weight: 600; color: #16232E; overflow: hidden;
             white-space: nowrap; text-overflow: ellipsis; }
    .dmeta { flex: 0 0 auto; font-size: 10.5px; color: #A3B2C2; }
    .dico { flex: 0 0 auto; font-size: 13px; color: #6E8398; }
    .dmod { color: #0B5CAD; font-weight: 800; margin-left: 5px; }
    .dmod.agg { color: #A2600A; }
    .dbtn { flex: 0 0 auto; min-width: 38px; border: 1px solid #E3E8EF; border-radius: 9px;
            background: #F8FBFE; color: #35506B; font-size: 13px; cursor: pointer; }
    .dbtn:hover { background: #EAF2FA; border-color: #9DBFDE; color: #0B5CAD; }
    .dbtn:focus-visible { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    /* il testo scelto nella tendina: si vede cosa è finito negli appunti */
    .eotxt { margin-top: 8px; border: 1px solid #E3E8EF; border-left: 3px solid #0B5CAD; border-radius: 8px;
             background: #F8FBFE; padding: 9px 11px; font-size: 12.5px; line-height: 1.55; color: #35506B;
             max-height: 34vh; overflow: auto; white-space: pre-wrap; }
    .eoazione { margin-top: 8px; }
    .dedit { width: 100%; min-height: 46vh; resize: vertical; border: 1px solid #D9E2EC; border-radius: 9px;
             padding: 9px 10px; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
             color: #16232E; background: #fff; }
    .dedit:focus { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    /* a name we were never taught: shown in full, and underlined so it can
       never be mistaken for one of the curated sigle */
    .sttab th.stn.grezza { text-decoration: underline dotted #C08A2E; text-underline-offset: 2px; }
    .avvnomi { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #7a4b03;
               background: #FFF7E6; border: 1px solid #E5C588; border-radius: 8px; padding: 5px 9px; margin-bottom: 6px; }
    .avvnomi .avvi { flex: 0 0 auto; width: 16px; height: 16px; border-radius: 50%; background: #E5C588;
                     color: #4d2f02; font-weight: 800; font-size: 11px; text-align: center; line-height: 16px; }
    .avvnomi .avvb { margin-left: auto; border: 0; background: transparent; color: #7a4b03; font: inherit;
                     font-weight: 700; cursor: pointer; text-decoration: underline; }
    .avvlista { white-space: pre-wrap; font-size: 11px; line-height: 1.45; color: #5B6B7A;
                background: #FFFDF7; border: 1px solid #EEDFC0; border-radius: 8px; padding: 6px 9px; margin-bottom: 6px; }
    .pbtn.pdim { color: #177245; border-color: #BCE0C9; }
    .pbtn.pdim:hover { background: #EDF7F0; border-color: #177245; color: #124F31; }
    .archhd { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 8px; cursor: pointer;
              border: 1px solid #E3E8EF; border-radius: 9px; background: #F8FBFE; padding: 7px 10px;
              font: 600 12px/1 inherit; color: #5B6B7A; }
    .archhd:hover { border-color: #9DBFDE; color: #16232E; }
    .archhd .an { background: #E3E8EF; color: #35506B; border-radius: 999px; padding: 1px 7px; font-size: 10.5px; }
    .archhd .ago { margin-left: auto; color: #8296A9; }
    .alist { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
    .arow { display: flex; align-items: center; gap: 8px; padding: 5px 8px 5px 10px;
            border: 1px solid #EDF1F6; border-radius: 8px; background: #fff; }
    .arow .anm { flex: 1 1 auto; font-size: 12px; color: #5B6B7A; overflow: hidden;
                 white-space: nowrap; text-overflow: ellipsis; }
    .arow .ameta { flex: 0 0 auto; font-size: 10.5px; color: #A3B2C2; }
    .abtn { flex: 0 0 auto; border: 1px solid #D9E2EC; background: #F8FBFE; color: #35506B;
            border-radius: 7px; padding: 3px 8px; font: 600 11px/1.4 inherit; cursor: pointer; }
    .abtn:hover { border-color: #9DBFDE; color: #0B5CAD; }
    .abtn.del:hover { border-color: #E9BAB6; background: #FBEBEA; color: #B3261E; }
    .tchip { display: flex; align-items: center; }
    .tchip button { border: 1px solid rgba(255,255,255,.45); background: transparent; color: #fff;
                    font: 600 11.5px/1 inherit; border-radius: 7px; padding: 5px 7px; cursor: pointer; }
    .tchip button:hover { background: rgba(255,255,255,.16); }
    .tchip.on button:first-child { border-radius: 7px 0 0 7px; border-right: 0; font-variant-numeric: tabular-nums; }
    .tchip.on button:last-child { border-radius: 0 7px 7px 0; }
    .tchip.on { box-shadow: 0 0 0 2px rgba(255,255,255,.18); border-radius: 8px; }
    .tnow { display: flex; align-items: center; gap: 10px; background: #EDF7F0; border: 1px solid #BCE0C9;
            border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
    .tbig { font: 800 20px/1 inherit; color: #124F31; font-variant-numeric: tabular-nums; }
    .tlab { flex: 1 1 auto; font-size: 12px; color: #35506B; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .tpres { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
    .tpre { border: 1px solid #C4D0DC; background: #fff; color: #16232E; border-radius: 999px;
            padding: 7px 12px; font: 600 12px/1 inherit; cursor: pointer; }
    .tpre:hover { border-color: #0B5CAD; color: #0B5CAD; background: #F4F8FB; }
    .tlibero { display: flex; gap: 6px; }
    .tlibero input { flex: 1 1 auto; border: 1px solid #D9E2EC; border-radius: 8px; padding: 7px 9px;
                     font: 12.5px/1.3 inherit; color: #16232E; }
    .tlibero input:focus { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    .ttot { float: right; font-size: 11px; color: #5B6B7A; font-weight: 600; }
    .tlist { display: flex; flex-direction: column; gap: 3px; }
    .trow { display: flex; align-items: center; gap: 8px; padding: 5px 6px 5px 9px; font-size: 11.5px;
            border: 1px solid #EDF1F6; border-radius: 8px; background: #fff; }
    .trow .tt { flex: 1 1 auto; font-weight: 600; color: #16232E; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .trow .tp { flex: 0 1 90px; color: #8296A9; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .trow .td { flex: 0 0 auto; font-weight: 700; color: #0B5CAD; font-variant-numeric: tabular-nums; }
    .trow .to { flex: 0 0 auto; color: #A3B2C2; font-size: 10.5px; font-variant-numeric: tabular-nums; }
    .tdel { border: 0; background: transparent; color: #A3B2C2; cursor: pointer; font-size: 12px; padding: 0 2px; }
    .tdel:hover { color: #B3261E; }
    .notaw { position: relative; padding: 6px 10px 0; }
    .nota { display: block; width: 100%; resize: none; overflow: hidden;
            border: 1px solid transparent; border-radius: 8px; background: #F8FBFE;
            padding: 6px 8px; font: 12.5px/1.45 inherit; color: #16232E; }
    .nota::placeholder { color: #9DB0C2; }
    .nota:hover { border-color: #E3E8EF; }
    .nota:focus { outline: 0; border-color: #9DBFDE; background: #fff; }
    .notaok { position: absolute; right: 16px; bottom: 4px; font-size: 10px; color: #177245; }
    .notaok.ko { color: #B3261E; }
    .crow { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; cursor: pointer;
            border: 1px solid #E3E8EF; border-radius: 9px; background: #fff; padding: 10px 11px; font: inherit; }
    .crow:hover { border-color: #9DBFDE; background: #F4F9FD; }
    .crow:focus-visible { outline: 2px solid #0B5CAD; outline-offset: 1px; }
    .cnome { flex: 1 1 auto; font-size: 12.5px; font-weight: 600; color: #16232E; }
    .cgo { flex: 0 0 auto; font-size: 11px; color: #0B5CAD; font-weight: 700; }
    .linkbtn { border: 0; background: transparent; color: #0B5CAD; font: inherit; font-weight: 700;
               text-decoration: underline; cursor: pointer; padding: 0; }
    .portok { color: #177245; font-weight: 700; }

    /* La tabella scorre dentro la sua cornice, non col pannello: solo così
       l'intestazione (sticky) resta sotto gli occhi con venti analiti. */
    .stwrap { overflow: auto; max-height: 60vh; overscroll-behavior: contain; border: 1px solid #E3E8EF; border-radius: 8px; }
    .sttab { border-collapse: collapse; font-size: 11.5px; width: 100%; }
    .sttab th, .sttab td { padding: 3px 7px; white-space: nowrap; border-bottom: 1px solid #EDF1F6; }
    .sttab thead th { position: sticky; top: 0; background: #F8FBFE; color: #5B6B7A; font-weight: 600;
                      font-size: 10.5px; text-align: right; border-bottom: 1px solid #D9E2EC; }
    .sttab .sth { display: block; font-size: 9.5px; color: #A3B2C2; font-weight: 500; }
    .sttab th.stn { position: sticky; left: 0; z-index: 1; background: #fff; text-align: left;
                    font-weight: 600; color: #16232E; max-width: 116px; overflow: hidden; text-overflow: ellipsis; }
    .sttab thead th.stn { background: #F8FBFE; z-index: 2; }
    .sttab td { text-align: right; color: #35506B; font-variant-numeric: tabular-nums; }
    .sttab td.fuori { color: #B3261E; font-weight: 800; }
    .sttab td.parz { font-style: italic; }   /* parziale: in corsivo, niente puntini */
    /* Novelty rides a different channel: a tint behind the number. Text
       colour is untouched, so red keeps meaning "out of range". */
    .sttab td.nuovo, .sttab td.agg, .sttab tbody tr:hover td.nuovo, .sttab tbody tr:hover td.agg {
      background: #DCEAF9; box-shadow: inset 0 -2px 0 #0B5CAD; }
    /* I segni del medico: un tocco giallo, due arancio, tre via. Stanno DOPO
       la novità perché il segno vince sullo sfondo azzurro; la riga blu sotto
       il numero (box-shadow) resta e continua a dire «nuovo». */
    .sttab td[data-cella] { cursor: pointer; user-select: none; }   /* due tocchi non devono selezionare il numero */
    /* Il segno è una pastiglia stretta attorno al numero (freccia e segno
       compresi), non tutta la cella: il margine negativo compensa il padding,
       così il numero non si sposta quando la pastiglia compare. */
    .sttab td .val { display: inline-block; border-radius: 999px; padding: 0 5px; margin: 0 -5px; }
    .sttab td.marca1 .val { background: #FFE58A; }
    .sttab td.marca2 .val { background: #FFC46B; }
    .sttab tbody tr:hover td, .sttab tbody tr:hover th.stn { background: #F4F9FD; }
    /* Sezioni: gli esami stanno dove un medico li cerca, e sempre nello stesso
       posto. L'ordine non dipende più da come il laboratorio ha stampato. */
    .sttab tr.stsez th.stn, .sttab tr.stsez td { background: #EEF4FA; border-bottom: 1px solid #D9E4EF;
      font-size: 9.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: #5B6B7A; }
    .sttab tr.stsez th.stn { color: #35506B; padding-top: 7px; padding-bottom: 4px; }
    .sttab tr.stsez td { text-align: left; padding-top: 7px; padding-bottom: 4px; }
    .sttab tr.stsez:hover th.stn, .sttab tr.stsez:hover td { background: #EEF4FA; }
    /* una cella senza valore si deve VEDERE che è vuota, o una riga con due
       soli prelievi sembra una riga piena */
    .sttab td.vuoto { color: #AEBECD; }
    .stum { display: block; font-size: 9px; color: #A3B2C2; font-weight: 500; letter-spacing: 0; }
    .sttab th.ultima { color: #0B5CAD; }
    .sttab th.ultima::after { content: "ultimo"; display: block; font-size: 8.5px; font-weight: 700;
      letter-spacing: .06em; text-transform: uppercase; color: #9DBFDE; }
    /* il segno di provenienza: piccolo, in alto, mai confondibile con un valore */
    .sttab .prov { font-style: normal; font-size: 9px; vertical-align: super; color: #0B5CAD;
                   font-weight: 800; margin-left: 1px; cursor: help; }
    .reftxt { font-size: 12.5px; line-height: 1.5; color: #16232E; }
    .reftxt .rt { padding: 1px 0; }
    .reftxt .rt:empty { display: none; }
    .newbar { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #0B5CAD;
              background: #EAF2FA; border: 1px solid #9DBFDE; border-radius: 8px; padding: 5px 9px; margin-bottom: 6px; }
    .newbar button { margin-left: auto; border: 0; background: transparent; color: #0B5CAD; font: inherit; font-weight: 700; cursor: pointer; }
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
      this.esiti = [];                  // risultati + referti, newest first
      this.storico = null;              // the portal's multi-day table, if it is THIS patient's
      this.storicoAltri = "";           // ...or the name it belongs to, when it is not
      this.storicoVia = "dal nome";     // su cosa è stata confermata l'identità
      this.storicoDaConfermare = false; // c'è, ma serve il codice fiscale per dire che è suo
      this.portale = "";                // indirizzo del portale aggiunto dal medico
      this.soloAlterati = false;        // valori: show only what is out of range
      this.nColEsiti = 0;               // colonne della tabella degli Esiti: decide la larghezza
      this.mostraNomi = false;          // the unexpected-name list, open or closed
      this.mostraArch = false;          // l'elenco degli archiviati, aperto o chiuso
      this.rottiTab = new Set();        // prelievi che hanno già fallito: niente ritentativi da soli
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
          // mai ricostruire una schermata in cui si sta scrivendo
          const scrive = this.root.activeElement && this.root.activeElement.id === "nota";
          if (this.runState !== "running" && !scrive
              && this.view !== "dimtesto" && this.view !== "dimimport") this.render();
        });
        this._titleObs.observe(titleEl, { childList: true, characterData: true, subtree: true });
      }
      // the portal page is another tab: coming back here is the moment to look
    // for a table read in the meantime
    this._visibile = () => { if (!document.hidden && this.pageType === "patient") this.caricaStorico(); };
    document.addEventListener("visibilitychange", this._visibile);
    this._unload = (e) => { e.preventDefault(); e.returnValue = ""; };
      this._esc = (e) => {
        if (e.key !== "Escape") return;
        if (this.runState === "running") this.stop();
      };
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
    setView(v, id, nota) {
      // a banner belongs to the screen that raised it: changing screen clears
      // it, unless this navigation is itself carrying the answer
      this.message = nota || null;
      this.view = v; this.viewId = id || null; this.persistUi(); this.render();
      if (v === "esiti") this.caricaStorico();   // letto sul portale intanto? e l'identità è cambiata?
    }
    // Il cronometro si vede da ogni schermata, altrimenti ci si dimentica di
    // fermarlo — ed è l'unica cosa che lo rende utile. Un tocco sul tempo
    // apre la scheda, un tocco su ⏹ lo ferma: fermarlo non deve costare due
    // passaggi.
    chipTempo() {
      const t = tempoInCorso();
      if (!t) return `<button class="tchip off" id="tapri" title="Cronometro: misura quanto ti prende un'attività">▶</button>`;
      return `<span class="tchip on"><button id="tapri" title="${esc(t.titolo)}${t.paz ? " · " + esc(t.paz) : ""} — apri i tempi">● ${esc(mmss(durata(t)))}</button><button id="tstop" title="Ferma il cronometro">⏹</button></span>`;
    }

    // the inline banner: a string is something that went wrong, {ok} is a
    // confirmation. Every view shows it — the panel always answers.
    notaHtml() {
      const m = this.message;
      if (this.runState) return "";
      if (typeof m === "string" && m) return `<div class="banner warn">${esc(m)}</div>`;
      if (m && typeof m.ok === "string") return `<div class="banner ok">${esc(m.ok)}</div>`;
      return "";
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
        eoSel: this.eoSel || "",
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
      this.eoSel = s.eoSel || "";
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
      const items = p.items;
      const allOn = items.every(([r, c]) => this.isSel(r, c));
      for (const [r, c] of items) {
        const k = this.key(r, c);
        if (allOn) this.selected.delete(k);
        else this.selected.set(k, { res: r, code: c, label: examLabel(r, c), display: displayLabel(r, c) });
      }
      this.persistUi();
      this.render();
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
      if (state.finishedListUrl) this.chiudiRichiesta(state.finishedListUrl);
    }

    // Ultimo passo: la conferma. Si prova a farla in sottofondo — la pagina
    // del carrello caricata davvero, in una cornice invisibile, col suo
    // bottone premuto davvero. Se il server non si lascia incorniciare, o se
    // un controllo dice di no, si va sulla pagina come si è sempre fatto: lì
    // il medico vede tutto e decide lui.
    async chiudiRichiesta(listUrl) {
      const daConfermare = !!tabStore.get("confirm.v1", null);
      if (!daConfermare || DEMO) { setTimeout(() => nav(listUrl), 400); return; }
      this.message = { head: this.message?.head || "", body: "Confermo in sottofondo…" };
      this.render();
      let esito = "rifiutata";
      try { esito = await confermaInCornice(listUrl, { panel: this, episodeId: this.episodeId }); }
      catch { esito = "rifiutata"; }
      this.log(`${now()}  conferma in sottofondo: ${esito}`);
      if (esito === "stampata") {
        this.message = { ok: "✓ Richiesta confermata — senza passare dal carrello." };
        this.render();
        return;
      }
      if (esito === "confermata") {
        // Confermata, ma i fogli non erano su quella pagina: si ricarica quella
        // del paziente e la stampa parte come è sempre partita.
        tabStore.set(AVVISO, { testo: { ok: "✓ Richiesta confermata — senza passare dal carrello." }, ts: Date.now() });
        nav(location.href);
        return;
      }
      // Rifiutata (il server non si lascia incorniciare), sospesa (un controllo
      // ha detto di no) o incerta: si finisce sulla pagina vera, col motivo.
      if (esito !== "rifiutata") {
        tabStore.set(AVVISO, {
          testo: esito === "incerta"
            ? "Stato della conferma incerto: controlla il carrello prima di confermare."
            : (typeof this.message === "string" && this.message) || "Conferma automatica sospesa: controlla il carrello e premi tu Conferma.",
          ts: Date.now(),
        });
      }
      nav(listUrl);
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
          carrelli: st.carrelli || {},
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
      tabStore.set("receipt.v1", { richiestaId: first.rid, episodeId: plan.episodeId, ts: Date.now(), items: first.added, carrelli: first.carrelli || {} });
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
      else if (this.view === "referto") body = this.viewReferto();
      else if (this.view === "dimissioni") body = this.viewDimissioni();
      else if (this.view === "dimtesto") body = this.viewDimTesto();
      else if (this.view === "dimimport") body = this.viewDimImport();
      else if (this.view === "consensi") body = this.viewConsensi();
      else if (this.view === "eo") body = this.viewEo();
      else if (this.view === "tempi") body = this.viewTempi();
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
      const section = this.runState ? "" : { richieste: "Richieste", esiti: "Esiti", referto: "Referto", dimissioni: "Dimissioni", dimtesto: "Dimissioni", dimimport: "Dimissioni", consensi: "Consensi", eo: "EO", tempi: "Tempi" }[this.view] || "";
      // the discharge sheets are templates: no episode belongs in that header
      const inDim = this.view === "dimissioni" || this.view === "dimtesto" || this.view === "dimimport";
      const sub = inHome ? "ultime 12 ore"
        : this.view === "tempi" ? "quanto ti prende"
        : this.view === "consensi" ? "Consensi · moduli"
        : this.view === "eo" ? "EO · modelli"
        : inDim ? "Dimissioni · modelli"
        : section ? `${section}${ep ? " · " + esc(ep) : ""}`
        : (ep ? "episodio " + esc(ep) : esc(APP));
      // user-resized size (clamped so it always fits the screen)
      let sizeStyle = "";
      if (this.size && this.size.w) {
        const w = Math.max(320, Math.min(window.innerWidth - 20, this.size.w));
        sizeStyle += `width:${w}px;`;
        if (this.size.h) sizeStyle += `max-height:${Math.max(240, Math.min(window.innerHeight - 20, this.size.h))}px;`;
      }
      // I valori si leggono per confronto fra colonne: il pannello si allarga
      // da solo quanto serve alla tabella, fino all'80% dello schermo — mai
      // più stretto di quanto il medico l'ha già fatto a mano.
      if (!this.runState && this.view === "esiti" && this.nColEsiti) {
        const serve = 220 + 88 * this.nColEsiti;
        const tetto = Math.round(window.innerWidth * 0.8);
        const w = Math.max(this.size?.w || 460, Math.min(serve, tetto));
        sizeStyle = `width:${w}px;max-height:${Math.round(window.innerHeight * 0.8)}px;`;
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
                ${section ? `<button class="iconbtn" id="back" title="${
                  this.view === "referto" ? "Torna agli esiti"
                  : this.view === "dimtesto" || this.view === "dimimport" ? "Torna ai fogli di dimissione"
                  : "Tutti i pazienti"}">‹</button>` : LOGO}<b class="who">${esc(inHome ? "Pazienti" : who)}</b>
                <span class="sub" title="${esc(who)} — episodio ${esc(ep || "?")}">${sub}</span>
                ${this.chipTempo()}
                <button class="iconbtn" id="collapse" title="Riduci">—</button>
              </div>
              ${running && total ? `<div class="pbar"><i style="width:${Math.round((doneN / Math.max(total, 1)) * 100)}%"></i></div>` : ""}
              ${!this.runState && this.pageType === "patient" && !inHome ? this.notaHtmlPaziente() : ""}
              ${!this.runState && this.pageType === "patient" && this.view !== "home" ? `
                <div class="seg">
                  <button class="${this.view === "richieste" ? "on" : ""}" data-seg="richieste">Richieste</button>
                  <button class="${this.view === "esiti" || this.view === "referto" ? "on" : ""}" data-seg="esiti">Esiti${this.esiti.length ? ` <span class="n">${this.esiti.length}</span>` : ""}</button>
                </div>` : ""}
              ${!this.runState ? `
                <div class="seg2">
                  <span class="seg2lab" title="Non dipendono dal paziente: sono modelli tuoi, uguali per tutti">Modelli</span>
                  <button class="${inDim ? "on" : ""}" data-seg="dimissioni">Dimissioni</button>
                  <button class="${this.view === "consensi" ? "on" : ""}" data-seg="consensi">Consensi</button>
                  <button class="${this.view === "eo" ? "on" : ""}" data-seg="eo" title="Esame obiettivo da copiare">EO</button>
                </div>` : ""}
              ${!this.runState ? this.selbarHtml() : ""}
              <div class="bd">${this.view === "richieste" ? "" : this.notaHtml()}${this.registroHtml()}${body}</div>
              <div class="rsz" id="rsz" title="Trascina per ridimensionare · doppio click per la misura originale"></div>
              ${!this.runState ? `<div class="foot">
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
            <button class="pbtn pdim" data-arch="${esc(p.ep)}" title="Lo toglie da questo elenco e lo mette negli archiviati. Nel gestionale non cambia niente.">Togli dall'elenco</button>
          </div>
        </div>`;
      const rigaArch = (p) => `
        <div class="arow">
          <span class="anm" title="${esc(p.name || "")}">${esc(p.name || "paziente")}</span>
          <span class="ameta">${esc(agoLabel(p.archTs || p.ts))}</span>
          <button class="abtn" data-unarch="${esc(p.ep)}" title="Riportalo fra i pazienti attivi">↩ riporta</button>
          <button class="abtn del" data-del="${esc(p.ep)}" title="Elimina tutto quello che il programma sa di lui">🗑</button>
        </div>`;
      const archiviati = pazientiArchiviati();
      const cards = [
        // Il nome è quello con cui il paziente è stato conosciuto. Il titolo
        // della pagina si usa solo se non ne abbiamo uno: sulla lista PS quel
        // titolo è «PRONTO SOCCORSO - LISTA», e stamparlo dove va il nome del
        // paziente è esattamente ciò che questo programma promette di non fare.
        ...here.map((p) => card({ ...p, name: p.name || patientName }, true)),
        ...(here.length ? [] : ep && canOrder ? [card({ ep, name: patientName, ts: Date.now() }, true)] : []),   // solo dove si può ordinare: lì il titolo È il paziente
        ...others.map((p) => card(p, false)),
      ].join("");
      return `
        <div class="sec">
          <div class="lbl">Pazienti${others.length ? `<button class="mini" id="forget">svuota</button>` : ""}</div>
          ${cards || `<div class="hint">Nessun paziente ancora. Apri un paziente: resta qui per il turno.</div>`}
          ${others.length ? `<div class="hint">Aprire un altro paziente ne carica la pagina.</div>` : ""}
          ${archiviati.length ? `
            <button class="archhd" id="archtog" aria-expanded="${this.mostraArch ? "true" : "false"}">
              <span>Archiviati</span><span class="an">${archiviati.length}</span><span class="ago">${this.mostraArch ? "▾" : "▸"}</span>
            </button>
            ${this.mostraArch ? `<div class="alist">${archiviati.map(rigaArch).join("")}
              <div class="hint">🗑 cancella tutto di quel paziente: scheda clinica, referti tenuti e nota. Non si torna indietro.</div>
            </div>` : ""}` : ""}
        </div>`;
    }

    // Il Registro si apre col numero di versione in fondo, che ora c'è su ogni
    // schermata: dopo un banner rosso è lì che si va a vedere cos'è successo,
    // e due ‹ di distanza erano due di troppo.
    registroHtml() {
      if (!this.showLog) return "";
      return `<details class="reg" open><summary>Registro <button class="mini" id="copylog" title="Copia il registro negli appunti (il quesito viene omesso)">⧉ Copia</button></summary><div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div></details>`;
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
          ${this.notaHtml()}
          <div class="idline">Richiesta per <b>${esc(patientName)}</b>${ep ? ` · episodio <b>${esc(ep)}</b>` : ""}</div>
          <div id="problems">${problems.go[0] ? `<div class="problem">${esc(problems.go[0])}</div>` : ""}</div>
          <div class="btnrow">
            <button class="btn primary" id="go" ${n && !problems.go.length ? "" : "disabled"}>${esc(goLabel)}</button>
            <button class="btn confirm" id="goconfirm" title="Come il bottone a sinistra, e in più preme Conferma SUBITO — non si annulla — e avvia la stampa guidata" ${n && !problems.confirm.length ? "" : "disabled"}>${esc(confirmLabel)}</button>
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
    // La tabella degli Esiti: i prelievi letti in QUESTA scheda del browser
    // (sempre, anche senza estensione) più la scheda clinica in archivio
    // quando è di questo paziente — il portale, e i prelievi letti altrove.
    // Una tabella sola: per gruppo, una colonna a prelievo, il più recente a
    // sinistra. Non c'è più una riga per richiesta da aprire.
    datiEsiti() {
      let dati = this.storico || null;
      for (const e of this.esiti) {
        if (e.kind !== "valori") continue;
        const v = tabStore.get(this.risKey(e.id), null);
        const t = v && v.rows ? prelievoComeTabella(risMeta(e), v.rows, v.cf || "", v.scartate) : null;
        // la scheda in archivio ha già questi prelievi: la fusione non cambia
        // niente. Se l'archivio manca (o non ha risposto) restano in tabella.
        if (t) dati = fondiStorico(t, dati);
      }
      return dati && dati.righe && dati.righe.length ? dati : null;
    }

    // «↺ Reset»: si dimentica tutto quello che si era letto di questo
    // paziente — i prelievi in questa scheda del browser e la scheda clinica
    // in archivio — e si ricomincia da «⭳ Carica i valori». I segni del
    // medico restano: sono suoi, e ritrovano le stesse celle.
    resetValori() {
      const ep = this.episodeId || "x";
      for (const k of [...tabStore.keys(`ris.${ep}.`), ...tabStore.keys(`visto.${ep}.`)]) tabStore.del(k);
      this.rottiTab.clear();
      if (hasExt()) ask({ t: "delStorico", chiave: this.chiavePaz(), ep: this.episodeId, nome: this.nomePaziente() || "" }).catch(() => {});
      this.storico = null; this.storicoAltri = ""; this.storicoDaConfermare = false;
      this.esiti = esitiModel(document, location.href);   // le righe «già letti» se ne vanno coi loro valori
      this.log(`${now()}  valori azzerati: si rileggono da zero`);
      this.message = { ok: "Valori dimenticati: ⭳ Carica i valori li rilegge da zero." };
      this.render();
    }

    viewEsiti() {
      const open = new Set(tabStore.get(this.refKey(), []));
      const cached = this.refCache || {};
      const busy = this.refBusy || {};
      const prelievi = this.esiti.filter((e) => e.kind === "valori");
      const referti = this.esiti.filter((e) => e.kind === "referto");
      const st = this.datiEsiti();
      this.nColEsiti = st ? st.date.length : 0;
      if (!this.esiti.length && !st) return `<div class="hint">Nessun esito per questo paziente.</div>`;

      // ---- valori: cosa è cambiato dall'ultima lettura, colonna per colonna
      // si parte dalle COLONNE della tabella: ognuna porta l'accesso da cui
      // viene, così due prelievi allo stesso minuto non si rubano i marchi
      const nov = new Map();
      let nNov = 0;
      for (const d of st ? st.date : []) {
        if (!d.id) continue;
        const v = tabStore.get(this.risKey(d.id), null);
        const n = v && v.rows ? this.novita(d.id, v.rows) : null;
        if (n && n.size) { nov.set(chiaveCol(d), n); nNov += n.size; }
      }
      const vivi = prelievi.filter((e) => !e.storico).length;
      const daLeggere = this.daLeggere().length;
      const rotti = prelievi.filter((e) => this.rottiTab.has(e.id));
      // letti, ma senza una data e ora nel gestionale: non possono diventare
      // una colonna, e non devono sparire in silenzio
      const senzaData = prelievi.filter((e) => {
        const v = tabStore.get(this.risKey(e.id), null);
        return v && v.rows && v.rows.length && !prelievoComeTabella(risMeta(e), v.rows, "");
      });
      const ra = this._refreshAll;
      const t = st ? this.tabellaStorico(st, nov, leggiSegni(this.chiaveNota())) : null;
      const chi = st ? [st.paziente?.cognome, st.paziente?.nome].filter(Boolean).join(" ") : "";
      const valori = prelievi.length || st ? `
        <div class="sec">
          <div class="lbl">Valori${t ? ` (${st.righe.length} esami · ${t.nCol} prelievi)` : ""}
            ${vivi ? `<button class="mini" id="risall" ${ra ? "disabled" : ""} title="Legge i valori dal gestionale, un prelievo alla volta">${
              ra ? `↻ ${ra.done}/${ra.total}…` : daLeggere === vivi ? "⭳ Carica i valori" : "↻ Aggiorna"}</button>` : ""}
            ${t ? `<button class="mini" id="storfiltro">${this.soloAlterati ? "tutti" : "solo alterati"}</button>` : ""}
            ${t || prelievi.some((e) => tabStore.get(this.risKey(e.id), null)) ? `<button class="mini" id="valreset" title="Dimentica i valori letti e la scheda in archivio di questo paziente: ⭳ Carica i valori li rilegge da zero">↺ Reset</button>` : ""}
          </div>
          ${nNov ? `<div class="newbar"><span>${nNov} ${nNov === 1 ? "valore nuovo" : "valori nuovi"} dall'ultima lettura</span><button id="letto" type="button">Letto</button></div>` : ""}
          ${daLeggere && !ra ? `<div class="hint">${daLeggere} ${daLeggere === 1 ? "prelievo ancora da leggere" : "prelievi ancora da leggere"}: <b>⭳ Carica i valori</b>.</div>` : ""}
          ${rotti.length ? `<div class="hint">${rotti.length === 1 ? "Un prelievo non si è lasciato leggere" : `${rotti.length} prelievi non si sono lasciati leggere`} (${
            esc(rotti.map((e) => e.when).filter(Boolean).join(", "))}): il Registro dice perché, <b>↻ Aggiorna</b> riprova.</div>` : ""}
          ${senzaData.length ? `<div class="hint">${senzaData.length === 1 ? "Un prelievo letto è" : `${senzaData.length} prelievi letti sono`} senza data e ora nel gestionale: non ${senzaData.length === 1 ? "entra" : "entrano"} in tabella (${
            esc(senzaData.map((e) => shortLabel(e.label)).join(", "))}).</div>` : ""}
          ${t ? `${this.avvisoNomi(st.righe, st.scartate)}${t.nRighe ? t.html
            : `<div class="hint">Tutti i valori sono in range: con «solo alterati» non resta niente da mostrare.</div>`}${this.piedeStorico(st, t.legenda)}` : ""}
          ${this.storico && (this.storico.periodo || this.storico.paziente?.idMPI) ? `<div class="hint">Con lo storico del portale, letto per <b>${esc(chi || "—")}</b> · identità confermata <b>${esc(this.storicoVia || "dal nome")}</b>.</div>`
            : this.storicoAltri ? `<div class="hint">In memoria c'è lo storico di <b>${esc(this.storicoAltri)}</b>, non di questo paziente: non lo mostro.</div>`
            : this.storicoDaConfermare ? `<div class="hint">C'è uno storico letto per un paziente con questo nome. Per essere sicuri
              che sia il suo serve il codice fiscale, che sta nella finestra Risultati: <b>⭳ Carica i valori</b> e comparirà.</div>` : ""}
          ${this.htmlPortale()}
        </div>` : "";

      // ---- referti: i documenti, uno per riga, come sempre
      const nSaved = referti.filter((e) => cached[e.id]).length;
      const rows = referti.map((e) => {
        const state = cached[e.id] ? "saved" : busy[e.id] === true ? "busy" : typeof busy[e.id] === "string" ? "err" : open.has(e.id) ? "open" : "";
        const why = typeof busy[e.id] === "string" ? busy[e.id] : "";
        const tipo = refertoTipo(e);
        return `<button class="rrow ${esc(state)}" data-esito="${esc(e.id)}" data-kind="referto" title="${esc(e.label)}${why ? " — " + esc(why) : ""}">
            <span class="rdot ${esc(state)}"></span>
            <span class="rwhen">${esc(e.when)}</span>
            <span class="rsys">${esc(e.sistema)}</span>
            <span class="rlab">${esc(shortLabel(e.label))}</span>
            <span class="rgo">${(tipo === "rx" || tipo === "ecg") && busy[e.id] === undefined ? "›" : "Apri referto ↗"}</span>
          </button>`;
      }).join("");
      const docs = referti.length ? `
        <div class="sec">
          <div class="lbl">Referti (${referti.length})
            ${hasExt() && nSaved < referti.length ? `<button class="mini" id="refsave"${this._salvaRef ? " disabled" : ""}>${this._salvaRef ? "salvo…" : "⬇ Salva referti"}</button>` : ""}
            ${(nSaved || open.size) ? `<button class="mini" id="refreset">↻ Resetta</button>` : ""}
            ${this.diagnosi ? `<button class="mini" id="refdiag" title="Copia com'è fatto il visualizzatore che non si è lasciato leggere (senza numeri), da mandare a chi fa il pannello">⧉ Copia diagnosi</button>` : ""}
          </div>
          <div class="rlist">${rows}</div>
        </div>` : "";
      return valori + docs;
    }

    // L'indirizzo del portale clinico. Stava scritto dentro il programma: se
    // l'ospedale lo cambia, o se è diverso da un presidio all'altro, il
    // pannello non compare di là e da qui non si può capire perché. Ora lo
    // aggiunge il medico, una volta: Chrome chiede il permesso per quel sito
    // e lo script si registra lì.
    htmlPortale() {
      if (!hasExt() || DEMO) return "";   // nel banco non c'è un portale da autorizzare
      // Il permesso lo chiede la pagina delle impostazioni: da qui non si può,
      // perché Chrome vuole un gesto e il gesto non arriva fin là.
      return `<div class="hint">Il pannello non compare sulla pagina dello storico?
        <button class="linkbtn" id="portapri">Aggiungi l'indirizzo del portale</button>${
        this.portale ? ` <span class="portok">✓ ${esc(this.portale)}</span>` : ""}</div>`;
    }

    // The multi-day table: exams down, draws across, newest first. It is read
    // from the portal page, never asked to the server.
    // UNA sola tabella, per il pannello e per il testo copiato: due
    // sorgenti che disegnano «la stessa» tabella finiscono sempre per
    // divergere, e la differenza la scopre il medico.
    tabellaStorico(st, nov = null, segni = {}) {
      const col = st.date.map((d, i) => ({ ...d, i })).reverse();   // il più recente a sinistra
      const ambS = sigleAmbigue(st.righe);
      const inatteso = (r) => !siglaCurata(r.nome) || ambS.has(sigla(r.nome));
      const simboli = new Map();   // esame → segno, uno per tutta la tabella
      const gruppi = raggruppaStorico(st.righe)
        .map((g) => ({ ...g, righe: g.righe.filter((r) => !this.soloAlterati || r.valori.some((v) => v.v && v.stato)) }))
        .filter((g) => g.righe.length);

      const rigaEsame = (r) => {
        const p = provenienze(r, simboli);
        const um = (r.valori.find((v) => v && v.um) || {}).um || "";
        const celle = col.map((c) => {
          const v = r.valori[c.i] || { v: "", stato: 0 };
          if (!v.v) return `<td class="vuoto">·</td>`;
          const sg = p.segno(v);
          const daChi = String(v.esame || r.esame || "").trim();
          // la novità (analita nuovo, valore cambiato dall'ultima lettura)
          // viaggia su un canale suo: lo sfondo, mai il colore del testo
          const n = nov && nov.get(chiaveCol(c))?.get(valKey(r.nome));
          const tip = [v.um, v.range, sg && daChi ? "fatto con " + daChi : "",
                       n === "nuovo" ? "nuovo dall'ultima lettura" : n === "cambiato" ? "aggiornato dall'ultima lettura" : ""].filter(Boolean).join(" · ");
          // il segno del medico (un tocco giallo, due arancio) vive sulla
          // cella: «colonna|analita», la stessa identità con cui la tabella
          // fonde i prelievi, così sopravvive a ogni ridisegno
          const cella = chiaveCol(c) + "|" + valKey(r.nome) + (!r.mnem && r.nome === r.esame ? "|#" + (r.pos ?? 0) : "");
          const segno = segni[cella] === 2 ? " marca2" : segni[cella] === 1 ? " marca1" : "";
          return `<td class="${v.stato ? "fuori" : ""}${v.parziale ? " parz" : ""}${n === "nuovo" ? " nuovo" : n === "cambiato" ? " agg" : ""}${segno}" data-cella="${esc(cella)}"${
            tip ? ` title="${esc(tip)}${v.parziale ? " · parziale" : ""}"` : v.parziale ? ` title="parziale"` : ""
          }><span class="val">${esc(v.v)}${v.stato ? (v.stato < 0 ? "↓" : "↑") : ""}${
            sg ? `<i class="prov" title="${esc(daChi ? "fatto con " + daChi + (p.solita ? " — gli altri con " + p.solita : "") : "")}">${esc(sg)}</i>` : ""
          }</span></td>`;
        }).join("");
        const etichetta = inatteso(r) ? String(r.nome).replace(/\s+/g, " ").trim() : sigla(r.nome);
        return `<tr><th class="stn${inatteso(r) ? " grezza" : ""}" title="${esc(r.nome)}${
          r.esame && r.esame !== r.nome ? " — " + esc(r.esame) : ""}${r.mnem ? " · " + esc(r.mnem) : ""}">${
          esc(etichetta)}${um ? `<span class="stum">${esc(um)}</span>` : ""}</th>${celle}</tr>`;
      };

      const corpo = gruppi.map((g) => {
        // niente conteggio dei fuori norma sulla riga di sezione: tanti sono
        // insignificanti, e il numero distrae da quelli che contano
        return `<tr class="stsez"><th class="stn">${esc(g.nome)}</th><td colspan="${col.length}"></td></tr>${g.righe.map(rigaEsame).join("")}`;
      }).join("");

      // In cima a ogni colonna: se il prelievo è di oggi basta l'ora; se è di
      // un altro giorno la data (27/08), con l'ora sotto in piccolo. Si legge
      // per confronto, e «quale giorno» conta solo quando non è questo.
      const d0 = new Date();
      const oggi = `${String(d0.getDate()).padStart(2, "0")}/${String(d0.getMonth() + 1).padStart(2, "0")}/${d0.getFullYear()}`;
      const testa = `<tr><th class="stn">Esame</th>${col.map((c, i) => {
        const diOggi = c.data === oggi;
        return `<th class="${i === 0 ? "ultima" : ""}" title="${esc([c.label, c.titolo].filter(Boolean).join(" · "))}">${esc(diOggi ? c.ora || "oggi" : c.data.slice(0, 5))}<span class="sth">${
          esc(diOggi ? "" : c.ora)}</span></th>`;
      }).join("")}</tr>`;
      const nRighe = gruppi.reduce((n, g) => n + g.righe.length, 0);
      const legenda = [...simboli].map(([esame, segno]) => ({ segno, esame }));
      return {
        html: `<div class="stwrap"><table class="sttab"><thead>${testa}</thead><tbody>${corpo}</tbody></table></div>`,
        legenda, nRighe, nCol: col.length,
      };
    }

    // La legenda dei segni + la nota sui valori parziali: sotto la tabella,
    // scritta, non solo in un tooltip che su un portatile non si vede.
    piedeStorico(st, legenda) {
      const parz = st.righe.some((r) => r.valori.some((v) => v.parziale));
      return `${legenda.map((l) => `<div class="hint"><b>${esc(l.segno)}</b> fatto con <b>${esc(l.esame)}</b> (sul valore c'è scritto con cosa gli altri)</div>`).join("")}${
        parz ? `<div class="hint"><i>In corsivo</i>: valore ancora <b>parziale</b>, il laboratorio non ha finito.</div>` : ""}
        <div class="hint">Tocca un valore per segnarlo: giallo, poi arancio, poi via.</div>`;
    }

    // The table read on the portal page comes back through the extension. It
    // is shown ONLY if it belongs to the patient on screen: everywhere else
    // in this program the identity is checked before the data is used, and a
    // table of values is the last place to make an exception.
    // Fra le schede in memoria, quella di QUESTO paziente. L'identità la
    // decide il pannello, non il service worker: le regole stanno in un posto
    // solo. Le altre schede non vengono nemmeno chieste.
    async schedaMia() {
      const r = await ask({ t: "getStorico" });
      const indice = (r && r.ok && r.indice) || [];
      if (!indice.length) { this.storicoAltri = ""; return null; }
      const titolo = (document.title || "").trim();
      const mio = this.cfEpisodio();
      const scelta = scegliScheda(indice, mio, titolo, this.episodeId);
      this.storicoVia = scelta && scelta.ep && String(scelta.ep) === String(this.episodeId)
        ? "dal paziente da cui l'hai aperta"
        : scelta && scelta.cf && mio ? "dal codice fiscale" : "dal nome";
      // C'è una scheda con questo nome ma non gliela si può attribuire perché
      // di questo paziente non conosciamo ancora il codice fiscale: lo si
      // dice, invece di far sparire un bottone senza spiegazioni.
      this.storicoDaConfermare = !scelta && !mio
        && indice.some((v) => v.cf && !v.ep && combaciaNome(titolo, v.paziente));

      if (!scelta) {
        const altri = [...new Set(indice.map((v) => [v.paziente?.cognome, v.paziente?.nome].filter(Boolean).join(" "))
          .filter(Boolean))];
        // se la scheda porta QUESTO nome non è «di un altro paziente»: manca
        // solo la prova che sia sua, e quella la si dice diversamente
        this.storicoAltri = this.storicoDaConfermare ? ""
          : altri.length
            ? (altri.length === 1 ? altri[0] : `${altri.length} pazienti (${altri.slice(0, 2).join(", ")}…)`)
            : "un paziente che la pagina non nomina";
        return null;
      }
      const pieno = await ask({ t: "getStorico", chiave: scelta.chiave });
      return pieno && pieno.ok ? pieno.dati : null;
    }

    // E anche il testo di un referto letto: la scheda di un paziente è tutto
    // quello che il programma sa di lui, non solo i numeri.
    async archiviaReferto(e, righe) {
      if (!hasExt() || !righe || !righe.length) return;
      const chiave = this.chiavePaz();
      if (!chiave || chiave === "nome:") return;
      segnaChiave(this.episodeId, chiave);
      const gia = await ask({ t: "getStorico", chiave });
      const base = (gia && gia.ok && gia.dati) || {
        paziente: { idMPI: "", cognome: "", nome: (document.title || "").trim() },
        cf: this.cfEpisodio() || "", periodo: "", date: [], righe: [], scartate: [], letto: Date.now(),
      };
      const referti = (base.referti || []).filter((r) => r.id !== e.id);
      referti.unshift({ id: e.id, quando: e.when || "", titolo: shortLabel(e.label || ""),
                        sistema: e.sistema || "", testo: righe.slice(0, 200).join("\n").slice(0, 20000) });
      await ask({ t: "putStorico", chiave, dati: { ...base, referti: referti.slice(0, 40), letto: Date.now() } });
    }

    // Ogni prelievo letto entra anche nella scheda clinica del paziente, così
    // quello che il pannello sa di lui sta in un posto solo: la tabella del
    // portale e le finestre Risultati del gestionale, parziali comprese.
    async archiviaPrelievo(e, rows, cf, scartate) {
      if (!hasExt() || !rows || !rows.length) return;
      const t = prelievoComeTabella(risMeta(e), rows, cf, scartate);
      if (!t) return;
      const chiave = chiaveArchivio(t);
      if (!chiave || chiave === "nome:") return;
      segnaChiave(this.episodeId, chiave);
      const gia = await ask({ t: "getStorico", chiave });
      const unito = unisciStorico(gia && gia.ok ? gia.dati : null, t);
      await ask({ t: "putStorico", chiave, dati: unito });
    }

    // Chi è questo paziente, per la nota: il codice fiscale se i prelievi
    // ce l'hanno detto, altrimenti il nome della pagina. Cambia da nome a
    // codice fiscale appena i valori arrivano — e la nota lo segue.
    // Il titolo della pagina è il nome del paziente SOLO dove c'è davvero un
    // paziente: sulla lista del reparto quel titolo è «PRONTO SOCCORSO -
    // LISTA», e prenderlo per un nome è come attribuire una nota, un tempo o
    // una scheda a un paziente che non esiste.
    nomePaziente() {
      const puoOrdinare = !!(this.entry && (this.entry.labUrl || this.entry.radioUrl));
      return this.pageType === "patient" && puoOrdinare ? (document.title || "").trim() : "";
    }

    // La chiave del paziente di questa pagina: una sola, usata dalla nota,
    // dalla scheda clinica e dai referti tenuti — così «elimina questo
    // paziente» sa esattamente cosa togliere.
    chiavePaz() {
      const cf = this.cfEpisodio();
      if (cf) return "cf:" + cf;
      const n = normNome(this.nomePaziente());
      return n ? "nome:" + n : "";
    }
    // La chiave passa da «nome:» a «cf:» nel momento in cui i valori portano
    // il codice fiscale. La nota scritta prima deve SEGUIRE il paziente, non
    // restare indietro (e non riaffiorare su un omonimo): la si sposta.
    chiaveNota() {
      const k = this.chiavePaz();
      if (!k.startsWith("cf:")) return k;
      const vecchia = "nome:" + normNome(this.nomePaziente());
      const tutte = noteTutte();
      if (!tutte[k] && tutte[vecchia] && vecchia !== "nome:") {
        scriviNota(k, tutte[vecchia].t);
        scriviNota(vecchia, "");
        this.log(`${now()}  nota spostata sul codice fiscale del paziente`);
      } else if (tutte[vecchia] && vecchia !== "nome:") {
        scriviNota(vecchia, "");   // già migrata: la copia vecchia non deve restare in giro
      }
      if (vecchia !== "nome:") migraSegni(vecchia, k);
      // «elimina paziente» deve trovare anche questa chiave, con o senza estensione
      segnaChiave(this.episodeId, k);
      return k;
    }
    notaHtmlPaziente() {
      const k = this.chiaveNota();
      if (!k) return "";
      const t = leggiNota(k);
      return `<div class="notaw">
        <textarea class="nota" id="nota" rows="2" spellcheck="false"
          placeholder="Nota su questo paziente — si salva mentre scrivi"
          aria-label="Nota su questo paziente">${esc(t)}</textarea>
        <span class="notaok" id="notaok" aria-live="polite"></span>
      </div>`;
    }

    // l'impronta del codice fiscale di QUESTO episodio, presa dai prelievi
    // che il pannello ha già letto: nessuna richiesta in più
    cfEpisodio() {
      for (const k of tabStore.keys(`ris.${this.episodeId || "x"}.`)) {
        const v = tabStore.get(k, null);
        if (v && v.cf) return v.cf;
      }
      return "";
    }

    async caricaStorico() {
      if (this.pageType !== "patient" || !hasExt()) return;
      const prima = (this.storico?.letto || 0) + "|" + this.storicoAltri;
      // schedaMia() ha già deciso l'identità: qui non si ricontrolla, o la
      // regola finirebbe scritta in due posti e prima o poi in due modi
      const dati = await this.schedaMia();
      // rifiutare è giusto, rifiutare in silenzio no: il medico quella tabella
      // l'ha letta un minuto prima e deve sapere perché non è qui
      this.storico = dati && dati.righe ? dati : null;
      if (this.storico) this.storicoAltri = "";
      // si ridisegna solo se è cambiato qualcosa, e mai sopra una schermata in
      // cui si sta scrivendo: tornare su questa scheda non deve costare il cursore
      if ((this.storico?.letto || 0) + "|" + this.storicoAltri === prima) return;
      if (this.view === "dimtesto" || this.view === "dimimport") return;
      if (this.root.activeElement && this.root.activeElement.id === "nota") return;
      this.render();
    }

    async refreshRefCache() {
      if (!hasExt() || !this.esiti.length) return;
      const r = await ask({ t: "listRef", ep: this.episodeId, ids: this.esiti.filter((e) => e.kind === "referto").map((e) => e.id) });
      if (r && r.ok) { this.refCache = r.cached || {}; this.render(); }
    }

    async saveAllReferti() {
      if (!hasExt() || this._salvaRef) return;   // due clic non sono due salvataggi
      this._salvaRef = true;
      try {
      this.refBusy = this.refBusy || {};
      const todo = this.esiti.filter((e) => e.kind === "referto" && !(this.refCache || {})[e.id]);
      for (const e of todo) this.refBusy[e.id] = true;
      this.render();
      for (const e of todo) {
        // Prima dal pannello, con lo stesso lettore delle etichette (sa
        // replicare un visualizzatore); se non basta, dal service worker. Il
        // perché di un fallimento va nel Registro, e la pagina del
        // visualizzatore resta pronta da copiare come diagnosi.
        let res = null;
        const motivi = [];
        try {
          const r = await fetchPdf(e.url, {});
          res = await ask({ t: "cacheRef", id: e.id, ep: this.episodeId, pk: this.chiavePaz(), data: bufB64(await r.blob.arrayBuffer()), size: r.blob.size });
          if (!(res && res.ok)) motivi.push(`memoria: ${(res && res.why) || "non riuscito"}`);
        } catch (err) {
          motivi.push(`${err?.head || err?.message || err}${err?.diag ? ` [${err.diag}]` : ""}`);
          if (err instanceof ViewerError && err.html) this.diagnosi = { cosa: `referto ${shortLabel(e.label)}`, url: e.url, html: err.html, diag: err.diag, quando: now() };
          res = await ask({ t: "cacheRef", id: e.id, url: e.url, ep: this.episodeId, pk: this.chiavePaz() });
          if (!(res && res.ok)) motivi.push(`service worker: ${(res && res.why) || "non riuscito"}`);
        }
        if (res && res.ok) {
          this.refCache = { ...(this.refCache || {}), [e.id]: res.size || 1 };
          this.refBusy[e.id] = false;
        } else {
          this.refBusy[e.id] = motivi.join(" · ") || "non riuscito";
          this.log(`${now()}  referto non salvato (${shortLabel(e.label)}): ${this.refBusy[e.id]}`);
        }
        this.render();
      }
      } finally {
        // senza il finally una sola eccezione spegneva «Salva referti» per
        // tutta la vita della scheda, e i pallini restavano a girare
        this._salvaRef = false;
        this.render();
      }
    }

    txtKey(id) { return `reftxt.${this.episodeId || "x"}.${id}`; }

    // Radiology and ECG reports become TEXT inside the panel: their PDFs carry
    // a real font map, so the words can be recovered exactly. Everything else
    // stays a document to open. The PDF itself is never shown here — the ↗
    // button is always one tap away.
    async apriTesto(id) {
      const e = this.esiti.find((x) => x.id === id);
      if (!e) return;
      if (!tabStore.get(this.txtKey(id), null)) {
        this.refBusy = { ...(this.refBusy || {}), [id]: true };
        this.render();
        try {
          const { blob } = await fetchPdf(e.url, {});
          const righe = await estraiTestoPdf(await blob.arrayBuffer());
          if (righe.length) {
            tabStore.set(this.txtKey(id), { ts: Date.now(), righe });
            this.archiviaReferto(e, righe);
            this.refBusy[id] = false;
          } else {
            this.refBusy[id] = "nessun testo leggibile";
            this.log(`${now()}  ${shortLabel(e.label)}: il PDF non contiene testo leggibile — resta da aprire`);
          }
        } catch (err) {
          this.refBusy[id] = (err && (err.head || err.message)) || "non letto";
          this.log(`${now()}  ${shortLabel(e.label)}: referto non letto (${this.refBusy[id]})`);
        }
        this.render();
      }
      if (tabStore.get(this.txtKey(id), null)) this.setView("referto", id);
    }

    // The list shows only WHAT, never the text: at discharge the doctor knows
    // which sheet he wants, and reading it here would only cost him a scroll.
    viewDimissioni() {
      const tutte = dimissioni();
      const chiavi = Object.keys(tutte);
      // I fogli rivisti stanno in cima, gli altri sotto una riga che lo dice:
      // così si vede a colpo d'occhio dove si è già messo mano.
      let stacco = false;
      const righe = chiavi.map((k) => {
        const d = tutte[k];
        let sep = "";
        if (!d.rivisto && !stacco && chiavi.some((x) => tutte[x].rivisto)) {
          stacco = true;
          sep = `<div class="dsep"><span>non ancora rivisti</span></div>`;
        }
        const n = d.testo.split("\n").filter((r) => r.trim()).length;
        const segno = d.aggiornato
          ? `<span class="dmod agg" title="L'originale è cambiato dopo la tua modifica">⟳</span>`
          : d.modificato ? `<span class="dmod" title="Testo modificato da te">•</span>` : "";
        return `${sep}
        <div class="drow">
          <button class="dcopia" data-dcopy="${esc(k)}" title="Copia negli appunti il foglio «${esc(d.nome)}»"
                  aria-label="Copia il foglio ${esc(d.nome)}">
            <span class="dnome">${esc(d.nome)}${segno}</span>
            <span class="dmeta">${n} righe</span><span class="dico">⧉</span>
          </button>
          <button class="dbtn" data-dedit="${esc(k)}" title="Modifica il testo di «${esc(d.nome)}»"
                  aria-label="Modifica il foglio ${esc(d.nome)}">✎</button>
        </div>`;
      }).join("");
      return `
        <div class="sec">
          <div class="lbl">Fogli di dimissione (${chiavi.length})
            <button class="mini" id="dimexport" title="Salva i tuoi testi in un file JSON">⬇ JSON</button>
            <button class="mini" id="dimimport" title="Rimetti i testi di un JSON esportato">⤒ Importa</button>
          </div>
          <div class="dlist">${righe}</div>
          <div class="hint">Clic sulla riga per copiare il foglio, ✎ per modificarlo una volta per tutte. Le modifiche restano su questo computer.</div>
        </div>`;
    }

    // The editor keeps a draft in tabStore at every keystroke: the EHR retitles
    // the page (which re-renders the panel) and reloads it under the doctor's
    // hands, and a rewritten sheet must never die to something he did not do.
    dimDraftKey(k) { return "dimdraft." + k; }
    viewDimTesto() {
      const k = this.viewId;
      const d = dimissioni()[k];
      if (!d) return `<div class="hint">Testo non disponibile.</div>`;
      const bozza = tabStore.get(this.dimDraftKey(k), null);
      const testo = bozza && typeof bozza.testo === "string" ? bozza.testo : d.testo;
      return `
        <div class="sec">
          <div class="lbl">${esc(d.nome)}
            <button class="mini" id="dimcopy" title="Copia questo testo senza salvarlo">⧉ Copia</button>
            <button class="mini" id="dimsave" title="Tieni questo testo per le prossime dimissioni">✓ Salva</button>
            ${d.modificato ? `<button class="mini" id="dimreset" title="${d.mio ? "Elimina questo foglio" : "Butta le tue modifiche e riprendi l'originale"}">${d.mio ? "✕ Elimina" : "↺ Originale"}</button>` : ""}
          </div>
          ${d.aggiornato ? `<div class="banner warn">L'originale di questo foglio è stato aggiornato dopo la tua modifica: con ↺ Originale prendi la versione nuova.</div>` : ""}
          ${testo !== d.testo ? `<div class="banner ok">Bozza non salvata, ripresa da dove l'avevi lasciata.</div>` : ""}
          <textarea class="dedit" id="dimarea" spellcheck="false" aria-label="Testo del foglio ${esc(d.nome)}">${esc(testo)}</textarea>
          <div class="hint">Salva tiene questo testo per le prossime volte. Per un foglio su misura per QUESTO paziente, modifica e usa ⧉ Copia senza salvare: qui non vanno dati del paziente.</div>
        </div>`;
    }

    // Un tocco apre il modulo e la finestra di stampa. I PDF sono dentro
    // l'estensione: nessuna richiesta al server, funziona anche offline.
    // Fine turno: una pagina HTML da guardare o stampare, raggruppata per
    // paziente, coi totali per attività. Come per l'editor dei fogli, si apre
    // anche in una scheda: un download che il browser rifiuta non deve
    // lasciare le mani vuote.
    esportaTempi() {
      const chiusi = tempi().filter((t) => t.fine).sort((a, b) => a.inizio - b.inizio);
      if (!chiusi.length) return;
      const perPaz = new Map(), perTit = new Map();
      for (const t of chiusi) {
        const k = t.paz || "(senza paziente)";
        if (!perPaz.has(k)) perPaz.set(k, []);
        perPaz.get(k).push(t);
        perTit.set(t.titolo, (perTit.get(t.titolo) || 0) + durata(t));
      }
      const tot = chiusi.reduce((n, t) => n + durata(t), 0);
      const riga = (t) => `<tr><td>${esc(t.titolo)}</td><td class="n">${esc(mmss(durata(t)))}</td><td class="n">${esc(oraDi(t.inizio))}</td><td class="n">${esc(oraDi(t.fine))}</td></tr>`;
      const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>Tempi ${esc(giornoDi(chiusi[0].inizio))}</title><style>
  body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#151E27;background:#fff;margin:0;padding:28px 22px 60px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#5D6E7E;font-size:13px;margin-bottom:22px}
  h2{font-size:15px;margin:22px 0 6px;padding-bottom:4px;border-bottom:1px solid #DBE3EA;display:flex;justify-content:space-between}
  table{border-collapse:collapse;width:100%;max-width:760px} td,th{padding:4px 8px;border-bottom:1px solid #EDF1F6;text-align:left}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8397A8}
  .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap} .tot{font-weight:700}
  @media print{body{padding:0}}
</style></head><body>
<h1>Tempi — ${esc(giornoDi(chiusi[0].inizio))}</h1>
<p class="sub">${chiusi.length} attività · totale <b>${esc(mmss(tot))}</b> · dalle ${esc(oraDi(chiusi[0].inizio))} alle ${esc(oraDi(chiusi[chiusi.length - 1].fine))}</p>
<h2>Per attività</h2>
<table><tbody>${[...perTit.entries()].sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n tot">${esc(mmss(v))}</td><td class="n">${Math.round((v / tot) * 100)}%</td></tr>`).join("")}</tbody></table>
${[...perPaz.entries()].map(([paz, l]) => `<h2><span>${esc(paz)}</span><span class="tot">${esc(mmss(l.reduce((n, t) => n + durata(t), 0)))}</span></h2>
<table><thead><tr><th>Attività</th><th class="n">Durata</th><th class="n">Inizio</th><th class="n">Fine</th></tr></thead>
<tbody>${l.map(riga).join("")}</tbody></table>`).join("")}
</body></html>`;
      // UN solo Blob: prima se ne creavano due per lo stesso testo e il secondo
      // non veniva mai liberato, quindi restava in memoria per tutta la scheda
      const u = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      let file = false;
      try {
        const a = document.createElement("a");
        a.href = u; a.download = `tempi-${new Date(chiusi[0].inizio).toISOString().slice(0, 10)}.html`;
        document.documentElement.appendChild(a); a.click(); a.remove();
        file = true;
      } catch { /* la scheda qui sotto resta */ }
      openTab(u, "_blank");
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      this.message = { ok: file ? "Tempi esportati: file nei download, e aperti in una scheda." : "Tempi aperti in una scheda: da lì Ctrl+S o Ctrl+P." };
      this.render();
    }

    viewTempi() {
      const t = tempoInCorso();
      const chiusi = tempi().filter((x) => x.fine).sort((a, b) => b.inizio - a.inizio);
      const chi = this.nomePaziente();
      const preset = TITOLI.map((x) => `<button class="tpre" data-avvia="${esc(x)}">${esc(x)}</button>`).join("");
      const tot = chiusi.reduce((n, x) => n + durata(x), 0);
      const righe = chiusi.slice(0, 40).map((x) => `
        <div class="trow">
          <span class="tt">${esc(x.titolo)}</span>
          <span class="tp">${esc(x.paz || "—")}</span>
          <span class="td">${esc(mmss(durata(x)))}</span>
          <span class="to">${esc(oraDi(x.inizio))}–${esc(oraDi(x.fine))}</span>
          <button class="tdel" data-scorda="${esc(x.id)}" title="Togli questa riga">✕</button>
        </div>`).join("");
      return `
        <div class="sec">
          ${t ? `
            <div class="tnow">
              <span class="tbig">${esc(mmss(durata(t)))}</span>
              <span class="tlab">${esc(t.titolo)}${t.paz ? ` · ${esc(t.paz)}` : ""}</span>
              <button class="btn primary" id="tstop2">⏹ Ferma</button>
            </div>` : `
            <div class="lbl">Cosa stai facendo${chi ? ` · ${esc(chi)}` : ""}</div>
            <div class="tpres">${preset}</div>
            <div class="tlibero">
              <input id="tlib" placeholder="…oppure scrivilo" maxlength="60" aria-label="Attività">
              <button class="mini" id="tavvia">▶ Avvia</button>
            </div>`}
          <div class="lbl">Registrati (${chiusi.length})${chiusi.length ? `<button class="mini" id="texp">⬇ Esporta</button><span class="ttot">totale ${esc(mmss(tot))}</span>` : ""}</div>
          <div class="tlist">${righe || `<div class="hint">Ancora niente. Avvia un cronometro qui sopra.</div>`}</div>
          <div class="hint">Non si salvano i secondi passati, si salva l'istante di inizio: ricaricare
            la pagina o riavviare il browser non cambia il conto. Restano una settimana, su questo computer.</div>
        </div>`;
    }

    // EO — un tocco copia l'esame obiettivo generale. Sotto, una tendina con
    // le aggiunte per caso: sceglierne una la copia subito, e la lascia
    // scritta qui perché si veda cosa è finito negli appunti.
    viewEo() {
      const voci = eoVoci();
      const base = voci.base;
      const sel = voci[this.eoSel] ? this.eoSel : "";
      const scelta = sel ? voci[sel] : null;
      const opz = (gruppo, etichetta) => {
        const l = Object.entries(voci).filter(([, v]) => v.gruppo === gruppo);
        if (!l.length) return "";
        return `<optgroup label="${esc(etichetta)}">${l.map(([k, v]) =>
          `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(v.nome)}</option>`).join("")}</optgroup>`;
      };
      if (!base && !Object.keys(voci).length) return `<div class="hint">Modelli di EO non disponibili in questa versione.</div>`;
      return `
        <div class="sec">
          <div class="lbl">Esame obiettivo</div>
          ${base ? `
            <div class="drow">
              <button class="dcopia" data-eocopy="base" title="Copia negli appunti l'esame obiettivo generale"
                      aria-label="Copia l'esame obiettivo generale">
                <span class="dnome">${esc(base.nome)}</span>
                <span class="dmeta">${esc(base.meta)}</span><span class="dico">⧉</span>
              </button>
            </div>` : ""}
          <div class="lbl">Aggiungi per caso</div>
          <select class="res" id="eocaso" aria-label="Aggiunta di esame obiettivo da copiare">
            <option value="">Scegli: si copia da sé…</option>
            ${opz("casi", "Casi")}
            ${opz("frasi", "Frasi pronte")}
          </select>
          <div class="drow eoazione" ${scelta ? "" : "hidden"}>
            <button class="dcopia" data-eocopy="${esc(sel)}" id="eoricopia" title="Copia di nuovo questo testo">
              <span class="dnome">Copia di nuovo</span><span class="dico">⧉</span>
            </button>
          </div>
          <div class="eotxt" id="eotxt" ${scelta ? "" : "hidden"}>${esc(scelta ? scelta.testo : "")}</div>
          <div class="hint">Prima l'EO generale, poi l'aggiunta del caso: due incollate. I testi restano
            uguali per tutti i pazienti — quello che riguarda questo paziente si scrive in cartella.</div>
        </div>`;
    }

    viewConsensi() {
      const righe = CONSENSI.map((c) => `
        <button class="crow" data-cons="${esc(c.k)}" title="${esc(c.esteso)}">
          <span class="cnome">${esc(c.nome)}</span>
          <span class="cgo">🖨 apri e stampa</span>
        </button>`).join("");
      return `
        <div class="sec">
          <div class="lbl">Moduli di consenso (${CONSENSI.length})</div>
          <div class="dlist">${righe}</div>
          <div class="hint">${hasExt() || DEMO
            ? "I moduli sono dentro l'estensione: si aprono anche se il gestionale è lento o giù, e nessuna richiesta esce dal computer."
            : "Servono i moduli dell'estensione: con il preferito (bookmarklet) questa sezione non ha i PDF."}</div>
        </div>`;
    }

    // Import is a paste screen, not a window.prompt: a 20 KB JSON in a
    // one-line browser dialog cannot be read, checked or corrected.
    viewDimImport() {
      return `
        <div class="sec">
          <div class="lbl">Importa i fogli
            <button class="mini" id="dimimpok">⤒ Importa</button>
          </div>
          <textarea class="dedit" id="dimimparea" spellcheck="false"
                    placeholder="Incolla qui il JSON esportato con ⬇ JSON" aria-label="JSON dei fogli di dimissione"></textarea>
          <div class="hint">Entrano solo i testi diversi dagli originali: gli altri restano come sono.</div>
        </div>`;
    }

    viewReferto() {
      const e = this.esiti.find((x) => x.id === this.viewId);
      if (!e) return `<div class="hint">Referto non disponibile.</div>`;
      const t = tabStore.get(this.txtKey(e.id), null);
      const righe = (t && t.righe) || [];
      return `
        <div class="sec">
          <div class="lbl">${esc(e.when)} · ${esc(shortLabel(e.label))}
            <button class="mini" id="copytxt">⧉ Copia</button><button class="mini" id="apripdf">↗ PDF</button></div>
          <div class="reftxt">${righe.map((r) => `<div class="rt">${esc(r)}</div>`).join("") || `<div class="hint">Nessun testo.</div>`}</div>
        </div>`;
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
      // Qui prima si rileggeva il PDF per tenerne una copia: una seconda
      // richiesta per un documento che è già sullo schermo del medico. Per
      // tenerne una copia c'è «⬇ Salva referti», che è una cosa che si chiede.
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
      const ok = await copiaTesto(text);
      const b = this.root.querySelector("#copylog");
      segnaCopia(b, ok);
    }

    // full values of one accesso, inside the panel
    // Two things the doctor must never discover by himself: a name this
    // program does not know (its abbreviation would be a guess) and a row it
    // refused to read. Both are declared, with the names, and nothing is
    // hidden — the values are all on screen anyway.
    avvisoNomi(rows, scartate) {
      const inattesi = nomiInattesi(rows);
      const amb = sigleAmbigue(rows);
      const doppi = (rows || []).map((r) => r.nome).filter((n, i, a) => n && amb.has(sigla(n)) && a.indexOf(n) === i);
      const persi = (scartate || []).filter((x) => x && x.nome);
      // due nomi che si abbrevierebbero uguale sono GIÀ scritti per esteso in
      // tabella: non meritano un avviso a ogni emocromo, solo l'elenco «quali»
      if (!inattesi.length && !persi.length) return "";
      const pezzi = [];
      if (inattesi.length) pezzi.push(`${inattesi.length} ${inattesi.length === 1 ? "nome non in elenco" : "nomi non in elenco"}: scritti per esteso`);
      if (persi.length) pezzi.push(`${persi.length} ${persi.length === 1 ? "riga non letta" : "righe non lette"}`);
      const elenco = [
        inattesi.length ? "Non in elenco: " + inattesi.join(", ") : "",
        doppi.length ? "Stessa abbreviazione: " + doppi.join(", ") : "",
        persi.length ? "Non lette: " + persi.map((x) => `${x.nome} = ${x.valore}`).join(" · ") : "",
      ].filter(Boolean).join("\n");
      return `<div class="avvnomi" title="${esc(elenco)}">
          <span class="avvi">!</span><span>${esc(pezzi.join(" · "))}</span>
          <button class="avvb" id="avvnomi" type="button">${this.mostraNomi ? "nascondi" : "quali"}</button>
        </div>${this.mostraNomi ? `<div class="avvlista">${esc(elenco)}</div>` : ""}`;
    }

    async openEsito(id) {
      const e = this.esiti.find((x) => x.id === id);
      const tipo = e ? refertoTipo(e) : "altro";
      // a report whose text we could not read must never trap the doctor:
      // it falls back to opening the document
      if ((tipo === "rx" || tipo === "ecg") && this.refBusy?.[id] === undefined) return this.apriTesto(id);
      return this.openReferto(id);
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
      try {
      for (const e of targets) {
        const key = this.risKey(e.id);
        const prima = JSON.stringify((tabStore.get(key, null) || {}).rows || []);
        try {
          const mai = !tabStore.get(this.vistoKey(e.id), null);
          const rows = await this.leggiPrelievo(e, { baseline: mai });
          this.rottiTab.delete(e.id);
          if (rows && JSON.stringify(rows) !== prima) cambiati++;
          // una riga nel Registro per prelievo: quando la tabella non torna,
          // qui si vede cosa è stato letto e cosa non ha una data per entrarci
          const inTabella = rows && rows.length ? prelievoComeTabella(risMeta(e), rows, "") : null;
          this.log(`${now()}  ${e.when || "senza data"} · ${shortLabel(e.label)}: ${rows ? rows.length : 0} valori${
            rows && rows.length && !inTabella ? " — senza data e ora nel gestionale: non entra in tabella" : inTabella ? ` → colonna ${inTabella.date[0].label}` : ""}`);
        } catch (err) {
          this.rottiTab.add(e.id);   // lo dice la schermata, non solo il Registro
          this.log(`${now()}  ${shortLabel(e.label)}: valori non aggiornati (${err?.head || err?.message || err})`);
        }
        this.refBusy[e.id] = false;
        this._refreshAll.done++;
        this.render();
        await sleep(PACE_MS).catch(() => {});
      }
      } finally {
        // come per «Salva referti»: senza il finally «↻ Aggiorna» resta
        // disabilitato per sempre alla prima eccezione
        this._refreshAll = null;
        for (const e of targets) this.refBusy[e.id] = false;
      }
      const letti = targets.filter((e) => !this.rottiTab.has(e.id)).length;
      this.log(`${now()}  letti ${letti} prelievi su ${targets.length}${cambiati ? `, ${cambiati} con valori nuovi` : ", nessun valore nuovo"}`);
      this.render();
    }

    // Values ready before he asks: the 2-line preview is the point of Esiti.
    // UNA lettura di un prelievo, usata da tutti: aprirlo, rileggerlo,
    // ↻ Aggiorna, e il precarico. Prima erano quattro copie della stessa
    // sequenza con quattro politiche d'errore diverse — ed è da lì che
    // veniva un prelievo rotto riletto a ogni ricarico di pagina.
    async leggiPrelievo(e, { baseline = false } = {}) {
      const key = this.risKey(e.id);
      const { doc } = await fetchDoc(e.url, {});
      const { rows, scartate } = parseRisultati(doc);
      const cf = cfImpronta(doc);
      // una finestra che non risponde più non cancella quello che sapevamo
      if (!rows.length && (tabStore.get(key, null) || {}).rows?.length) {
        this.log(`${now()}  la finestra Risultati non risponde più: tengo i valori già letti`);
        return null;
      }
      tabStore.set(key, { ts: Date.now(), rows, scartate, cf, meta: risMeta(e) });
      // in scheda PRIMA di rileggerla, o la riga «Storico» negli Esiti
      // comparirebbe solo alla prossima visita. Un archivio che fallisce non
      // è un prelievo non letto: i valori sono già qui sopra.
      await this.archiviaPrelievo(e, rows, cf, scartate).catch((err) => this.log(`${now()}  prelievo non archiviato (${err?.message || err})`));
      if (baseline) this.segnaVisto(e.id, rows);   // prima lettura: è il riferimento
      // coi valori arriva il codice fiscale: adesso la scheda clinica del
      // portale si può attribuire (o escludere) con certezza — e il prelievo
      // appena letto è già dentro
      this.caricaStorico();
      return rows;
    }

    // Aprire un paziente NON legge niente. I valori si leggono quando li
    // chiedi: aprendo un prelievo, o col bottone «Carica i valori» che li
    // prende tutti, uno alla volta. Un clic su un paziente non è una
    // richiesta di leggere il laboratorio.
    daLeggere() {
      return this.esiti.filter((x) => x.kind === "valori"
        && !tabStore.get(this.risKey(x.id), null) && !this.rottiTab.has(x.id));
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

      $("#back")?.addEventListener("click", () => this.setView(
        this.view === "referto" ? "esiti"
        : this.view === "dimtesto" || this.view === "dimimport" ? "dimissioni"
        : "home"));
      this.root.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => this.setView(b.getAttribute("data-seg"))));
      $("#forget")?.addEventListener("click", () => { forgetPatients(); this.render(); });
      $("#archtog")?.addEventListener("click", () => { this.mostraArch = !this.mostraArch; this.render(); });
      this.root.querySelectorAll("[data-arch]").forEach((b) => b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        archiviaPaziente(b.getAttribute("data-arch"), true);
        this.render();
      }));
      this.root.querySelectorAll("[data-unarch]").forEach((b) => b.addEventListener("click", () => {
        archiviaPaziente(b.getAttribute("data-unarch"), false);
        this.render();
      }));
      this.root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
        // un tasto che cancella davvero chiede una volta, e non di nascosto
        if (b.dataset.sicuro !== "1") {
          b.dataset.sicuro = "1"; b.textContent = "cancello?";
          setTimeout(() => { if (b.isConnected && b.dataset.sicuro === "1") { b.dataset.sicuro = ""; b.textContent = "🗑"; } }, 4000);
          return;
        }
        const ep = b.getAttribute("data-del");
        const p = pazientiArchiviati().find((x) => x.ep === ep);
        eliminaPaziente(ep, p?.pk || "", p?.name || "");
        this.message = { ok: `Eliminato tutto di ${p?.name || "quel paziente"}.` };
        this.render();
      }));
      $("#verbtn")?.addEventListener("click", () => { this.showLog = !this.showLog; this.render(); });
      $("#risall")?.addEventListener("click", () => this.reloadTuttiValori());
      // «Letto»: da qui in poi le novità si contano da adesso, per tutti i prelievi
      $("#letto")?.addEventListener("click", () => {
        for (const e of this.esiti) if (e.kind === "valori") this.marcaLetto(e.id);
        this.render();
      });
      $("#apripdf")?.addEventListener("click", () => { if (this.viewId) this.openReferto(this.viewId); });
      $("#portapri")?.addEventListener("click", async () => {
        const r = await ask({ t: "apriImpostazioni" }).catch(() => null);
        this.message = r && r.ok
          ? { ok: "Si è aperta la pagina delle impostazioni: incolla lì l'indirizzo del portale." }
          : "Non riesco ad aprire le impostazioni: aprile da chrome://extensions → PS Assist → Dettagli → Opzioni.";
        this.render();
      });
      // un tocco su un valore lo segna (giallo → arancio → niente): si cambia
      // la cella sul posto, senza ridisegnare, così la tabella non scatta
      const tabella = this.root.querySelector(".sttab");
      if (tabella) tabella.addEventListener("click", (ev) => {
        const td = ev.target?.closest?.("td[data-cella]");
        if (!td) return;
        const stato = (td.classList.contains("marca2") ? 2 : td.classList.contains("marca1") ? 1 : 0) + 1;
        const prossimo = stato > 2 ? 0 : stato;
        if (!scriviSegno(this.chiaveNota(), td.getAttribute("data-cella"), prossimo)) {
          // un salvataggio rifiutato si dice, non si finge
          this.message = "Il browser non ha accettato il segno: memoria piena o bloccata.";
          this.render();
          return;
        }
        td.classList.remove("marca1", "marca2");
        if (prossimo) td.classList.add("marca" + prossimo);
      });
      const filtra = () => { this.soloAlterati = !this.soloAlterati; this.render(); };
      $("#storfiltro")?.addEventListener("click", filtra);
      $("#avvnomi")?.addEventListener("click", () => { this.mostraNomi = !this.mostraNomi; this.render(); });
      $("#valreset")?.addEventListener("click", () => this.resetValori());
      $("#refdiag")?.addEventListener("click", async () => {
        const b = this.root.querySelector("#refdiag");
        segnaCopia(b, await copiaTesto(diagnosiTesto(this.diagnosi)));
      });
      this.root.querySelectorAll("[data-dcopy]").forEach((b) => b.addEventListener("click", async () => {
        const d = dimissioni()[b.getAttribute("data-dcopy")];
        if (!d) return;
        const ico = b.querySelector(".dico");
        let ok = false;
        ok = await copiaTesto(d.testo);
        b.classList.toggle("fatto", ok);
        if (ico) ico.textContent = ok ? "✓ copiato" : "✗ non riuscito";
        setTimeout(() => {
          if (!b.isConnected) return;
          b.classList.remove("fatto");
          if (ico) ico.textContent = "⧉";
        }, 1800);
      }));
      // EO: la riga copia, la tendina copia scegliendo. In tutti e due i casi
      // il testo scelto resta scritto sotto, così si vede cosa si è preso.
      const eoFatto = (b, ok) => {
        const ico = b.querySelector(".dico");
        b.classList.toggle("fatto", ok);
        if (ico) ico.textContent = ok ? "✓ copiato" : "✗ non riuscito";
        setTimeout(() => {
          if (!b.isConnected) return;
          b.classList.remove("fatto");
          if (ico) ico.textContent = "⧉";
        }, 1800);
      };
      this.root.querySelectorAll("[data-eocopy]").forEach((b) => b.addEventListener("click", async () => {
        const v = eoVoci()[b.getAttribute("data-eocopy")];
        if (!v) return;
        eoFatto(b, await copiaTesto(v.testo));
      }));
      $("#eocaso")?.addEventListener("change", async (ev) => {
        const k = ev.target.value;
        this.eoSel = k || "";
        const v = eoVoci()[k];
        const txt = this.root.querySelector("#eotxt");
        const riga = this.root.querySelector(".eoazione");
        const btn = this.root.querySelector("#eoricopia");
        if (txt) { txt.textContent = v ? v.testo : ""; txt.hidden = !v; }
        if (riga) riga.hidden = !v;
        if (btn) btn.setAttribute("data-eocopy", k || "");
        if (!v) return;
        this.persistUi();
        if (btn) eoFatto(btn, await copiaTesto(v.testo));
      });
      this.root.querySelectorAll("[data-dedit]").forEach((b) => b.addEventListener("click", () => this.setView("dimtesto", b.getAttribute("data-dedit"))));
      // every keystroke goes into the tab's draft: a re-render, a page change
      // or a mis-click can no longer throw away a rewritten sheet
      const area = this.root.querySelector("#dimarea");
      if (area) area.addEventListener("input", () => tabStore.set(this.dimDraftKey(this.viewId), { ts: Date.now(), testo: area.value }));
      $("#dimcopy")?.addEventListener("click", async () => {
        const b = this.root.querySelector("#dimcopy");
        let ok = false;
        ok = await copiaTesto(area ? area.value : "");
        segnaCopia(b, ok);
      });
      $("#dimsave")?.addEventListener("click", () => {
        const d = dimissioni()[this.viewId];
        if (!area || !d) return;
        if (!area.value.trim()) { this.message = "Il testo è vuoto: non lo salvo."; this.render(); return; }
        const scritto = salvaDimissione(this.viewId, d.nome, area.value);
        tabStore.set(this.dimDraftKey(this.viewId), null);
        this.log(`${now()}  foglio di dimissione «${d.nome}» aggiornato`);
        // never say "saved" when the browser refused to write it
        this.setView("dimissioni", null, scritto
          ? { ok: `«${d.nome}» salvato: sarà questo il testo copiato d'ora in poi.` }
          : `«${d.nome}» NON salvato: la memoria di questo browser è piena o bloccata.`);
      });
      $("#dimreset")?.addEventListener("click", (ev) => {
        const b = ev.currentTarget;
        const d = dimissioni()[this.viewId] || {};
        const etichetta = b.textContent;
        // one tap must not be able to destroy a text the doctor wrote
        if (b.dataset.sicuro !== "1") {
          b.dataset.sicuro = "1";
          b.textContent = d.mio ? "Elimino?" : "Confermi?";
          setTimeout(() => { if (b.isConnected && b.dataset.sicuro === "1") { b.dataset.sicuro = ""; b.textContent = etichetta; } }, 4000);
          return;
        }
        const nome = d.nome || this.viewId;
        const scritto = ripristinaDimissione(this.viewId);
        tabStore.set(this.dimDraftKey(this.viewId), null);
        this.setView("dimissioni", null, scritto
          ? { ok: `«${nome}» riportato al testo originale.` }
          : `«${nome}» non ripristinato: la memoria di questo browser è bloccata.`);
      });
      $("#dimexport")?.addEventListener("click", async () => {
        const tutte = dimissioni();
        const mie = store.get(dimKey, {});
        const dati = {};
        for (const [k, v] of Object.entries(tutte)) {
          dati[k] = { nome: v.nome, testo: v.testo };
          // carry the fingerprint of the original this version was forked from,
          // so a re-import keeps knowing when the original moves
          if (mie[k] && mie[k].base) dati[k].base = mie[k].base;
        }
        const testo = JSON.stringify({ app: APP, versione: VERSION, salvato: new Date().toISOString(), dimissioni: dati }, null, 1);
        // the file where downloads are allowed, the clipboard everywhere else:
        // the doctor must end up with the text in his hands either way
        let file = false, appunti = false;
        try {
          const url = URL.createObjectURL(new Blob([testo], { type: "application/json" }));
          const a2 = document.createElement("a");
          a2.href = url; a2.download = "dimissioni.json";
          document.documentElement.appendChild(a2); a2.click(); a2.remove();
          setTimeout(() => URL.revokeObjectURL(url), 20000);
          file = true;
        } catch { /* clipboard below */ }
        appunti = await copiaTesto(testo);
        const b = this.root.querySelector("#dimexport");
        if (b) {
          b.textContent = file && appunti ? "✓ file + appunti" : file ? "✓ dimissioni.json" : appunti ? "✓ negli appunti" : "✗ non riuscito";
          setTimeout(() => { if (b.isConnected) b.textContent = "⬇ JSON"; }, 2500);
        }
      });
      const nota = this.root.querySelector("#nota");
      if (nota) {
        const cresci = () => {
          nota.style.height = "auto";
          nota.style.height = Math.min(nota.scrollHeight, 160) + "px";
        };
        cresci();
        let attesa = null;
        nota.addEventListener("input", () => {
          cresci();
          clearTimeout(attesa);
          attesa = setTimeout(() => {
            const ok = scriviNota(this.chiaveNota(), nota.value);
            const spia = this.root.querySelector("#notaok");
            if (spia) {
              spia.textContent = ok ? "salvata" : "NON salvata";
              spia.classList.toggle("ko", !ok);
              setTimeout(() => { if (spia.isConnected) spia.textContent = ""; }, 1400);
            }
          }, 500);
        });
        // uscire dal campo salva subito: non si perde una riga per un clic
        nota.addEventListener("blur", () => { clearTimeout(attesa); scriviNota(this.chiaveNota(), nota.value); });
      }
      $("#tapri")?.addEventListener("click", () => this.setView("tempi"));
      const ferma = () => { fermaTempo(); this.render(); };
      $("#tstop")?.addEventListener("click", ferma);
      $("#tstop2")?.addEventListener("click", ferma);
      const avvia = (titolo) => {
        if (!String(titolo || "").trim()) return;
        avviaTempo(titolo, this.nomePaziente(), this.episodeId);
        this.setView("tempi");
      };
      this.root.querySelectorAll("[data-avvia]").forEach((b) =>
        b.addEventListener("click", () => avvia(b.getAttribute("data-avvia"))));
      $("#tavvia")?.addEventListener("click", () => avvia(this.root.querySelector("#tlib")?.value));
      $("#tlib")?.addEventListener("keydown", (e) => { if (e.key === "Enter") avvia(e.target.value); });
      this.root.querySelectorAll("[data-scorda]").forEach((b) =>
        b.addEventListener("click", () => { scordaTempo(b.getAttribute("data-scorda")); this.render(); }));
      $("#texp")?.addEventListener("click", () => this.esportaTempi());
      this.root.querySelectorAll("[data-cons]").forEach((b) => b.addEventListener("click", () => {
        const c = CONSENSI.find((x) => x.k === b.getAttribute("data-cons"));
        const url = c && urlConsenso(c);
        if (!url) { this.message = "I moduli di consenso ci sono solo con l'estensione."; this.render(); return; }
        this.log(`${now()}  consenso «${c.nome}» aperto per la stampa`);
        openPrintWizard([{ name: c.nome, printer: "stampante normale", url, diretto: true }],
          { title: c.nome, panel: this });
      }));
      $("#dimimport")?.addEventListener("click", () => this.setView("dimimport"));
      $("#dimimpok")?.addEventListener("click", () => {
        const ta = this.root.querySelector("#dimimparea");
        const testo = (ta && ta.value || "").trim();
        if (!testo) { this.message = "Incolla prima il JSON esportato."; this.render(); return; }
        let dims = null;
        try {
          const dati = JSON.parse(testo);
          dims = dati && dati.dimissioni && typeof dati.dimissioni === "object" ? dati.dimissioni : dati;
        } catch (e) {
          this.message = `JSON non valido: ${e.message}`; this.render(); return;
        }
        if (!dims || typeof dims !== "object") { this.message = "Questo file non contiene fogli di dimissione."; this.render(); return; }
        const mie = store.get(dimKey, {});
        let n = 0, uguali = 0, saltati = 0;
        for (const [k, v] of Object.entries(dims)) {
          if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
          if (!dimValido(v) || v.testo.length > 40000 || k.length > 80) { saltati++; continue; }
          const orig = DIMISSIONI[k];
          // a text identical to the shipped one is NOT a change: importing it
          // as an override would freeze that sheet at today's wording forever
          if (orig && v.testo.trim() === orig.testo.trim()) { delete mie[k]; uguali++; continue; }
          if (!(k in mie) && Object.keys(mie).length >= 40) { saltati++; continue; }
          mie[k] = {
            nome: String(v.nome || (orig && orig.nome) || k).slice(0, 80),
            testo: v.testo,
            base: typeof v.base === "string" && v.base ? v.base : (orig ? impronta(orig.testo) : ""),
          };
          n++;
        }
        if (!n && !uguali) { this.message = "Nessun testo valido in questo JSON."; this.render(); return; }
        const scritto = store.set(dimKey, mie);
        this.log(`${now()}  importati ${n} fogli di dimissione`);
        const coda = [uguali ? `${uguali} già uguali all'originale` : "", saltati ? `${saltati} ignorati` : ""].filter(Boolean).join(", ");
        this.setView("dimissioni", null, scritto
          ? { ok: `${n === 1 ? "Importato 1 foglio" : `Importati ${n} fogli`}${coda ? ` (${coda})` : ""}.` }
          : "Import NON salvato: la memoria di questo browser è piena o bloccata.");
      });
      $("#copytxt")?.addEventListener("click", async () => {
        const t = tabStore.get(this.txtKey(this.viewId), null);
        if (!t || !t.righe) return;
        let ok = false;
        ok = await copiaTesto(t.righe.join("\n"));
        const b = this.root.querySelector("#copytxt");
        segnaCopia(b, ok);
      });
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
        this.openEsito(b.getAttribute("data-esito"))));
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

  // La conferma senza guardare la pagina.
  //
  // La pagina del carrello viene caricata DAVVERO — stessa sessione, stesso
  // modulo, stesso bottone — solo dentro una cornice invisibile invece che
  // davanti agli occhi. Il clic è quello vero sul bottone del gestionale, e i
  // byte che partono sono gli stessi: la codifica del modulo la fa il browser,
  // non noi. Cambia solo che il medico non deve stare a guardare il LIS.
  //
  // La cornice gira SENZA script (`allow-forms allow-same-origin`, mai
  // `allow-scripts` né `allow-top-navigation`): così il codice della pagina non
  // può portarsi via la scheda del medico, e non serve — l'invio di un modulo
  // lo fa il browser. Se il server vieta di essere incorniciato, il documento
  // non è leggibile: ce ne accorgiamo e si torna a fare come prima.
  //
  // Fallisce sempre CHIUSA: qualunque intoppo lascia la conferma al medico.
  const FRAME_MS = 25000;
  function confermaInCornice(listUrl, { panel, episodeId }) {
    return new Promise((resolve) => {
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-forms allow-same-origin");
      f.setAttribute("aria-hidden", "true");
      f.style.cssText = "position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;visibility:hidden";
      let fatto = false, fase = "carico";
      const chiudi = (esito) => {
        if (fatto) return;
        fatto = true;
        clearTimeout(tid);
        try { f.remove(); } catch { /* già via */ }
        resolve(esito);
      };
      const tid = setTimeout(() => chiudi(fase === "carico" ? "rifiutata" : "incerta"), FRAME_MS);

      f.addEventListener("load", () => {
        let doc = null, url = "";
        try { doc = f.contentDocument; url = f.contentWindow.location.href; } catch { doc = null; }
        // Una cornice appena inserita emette un `load` per la sua pagina vuota,
        // prima ancora di caricare la nostra: quello non è il carrello.
        if (url === "about:blank" || url === "") return;
        // Non leggibile = il server non si lascia incorniciare. Non è un
        // errore: è la strada di prima, e si prende quella.
        if (!doc || !doc.documentElement) return chiudi("rifiutata");

        if (fase === "carico") {
          fase = "confermo";
          let cliccato = false;
          try { cliccato = maybeAutoConfirm(panel, doc, url); }
          catch (e) { panel?.log(`${now()}  conferma in sottofondo interrotta: ${e?.message || e}`); }
          // Nessun clic vuol dire che un controllo ha detto di no: la pagina
          // va mostrata al medico, che decide lui.
          if (!cliccato) return chiudi("sospesa");
          panel?.render();
          return;
        }
        // Seconda pagina: quella dopo la conferma. In certe installazioni i
        // fogli da stampare stanno proprio lì, e da lì si prendono; altrimenti
        // si lascia il segno e li raccoglie la pagina del paziente, come ha
        // sempre fatto.
        const suo = findEpisodeId(doc, url);
        if (episodeId && suo && suo !== episodeId) return chiudi("incerta");
        if (classify(doc) === "login") return chiudi("incerta");
        let stampata = false;
        try { stampata = maybeAutoPrint(panel, doc, url); } catch { stampata = false; }
        chiudi(stampata ? "stampata" : "confermata");
      });
      f.addEventListener("error", () => chiudi("rifiutata"));
      document.documentElement.appendChild(f);
      f.src = listUrl;
    });
  }

  function maybeAutoConfirm(panel, doc = document, url = location.href) {
    const flag = tabStore.get("confirm.v1", null);
    if (!flag) return false;
    const clear = () => { tabStore.set("confirm.v1", null); return false; };
    if (Date.now() - (flag.ts || 0) > CONFIRM_FLAG_TTL) return clear();

    const model = examModel(doc, url);
    const ep = findEpisodeId(doc, url);
    if (!model.form || !model.richiestaId) return false; // not an exam page
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

    const inCart = model.exams.filter((e) => e.isDel);
    const cartPreview = inCart.slice(0, 5).map((e) => shortLabel(e.label));
    if (inCart.length > 5) cartPreview.push(`+${inCart.length - 5} altri`);
    // The native Conferma submits the WHOLE richiesta, not this run's
    // additions. This page shows only the CURRENT resource's cart rows, so the
    // honest comparison is per-resource against the receipt: a row in the cart
    // that this run did not add (a leftover from an earlier attempt) means the
    // click would confirm more than the banner says — refuse, human decides.
    const receipt = tabStore.get("receipt.v1", null);
    // Senza ricevuta non si può dire «nel carrello c'è solo quello che ho
    // aggiunto io» — e la Conferma nativa invia la richiesta INTERA. Non
    // poter controllare non è come aver controllato: si ferma, e preme il
    // medico. (Prima di questa riga il controllo veniva semplicemente
    // saltato e la conferma partiva lo stesso.)
    if (!receipt || receipt.richiestaId !== model.richiestaId || !Array.isArray(receipt.items)) {
      clear();
      if (panel) {
        panel.message = "Conferma automatica sospesa: non risulta cosa è stato aggiunto in questa corsa. La Conferma invia la richiesta intera — controlla il carrello e premila tu sulla pagina.";
        panel.log(`${now()}  auto-conferma sospesa: ricevuta assente o di un'altra richiesta`);
        panel.render();
      }
      return false;
    }
    {
      // Questa pagina mostra il carrello di UNA risorsa sola, ma la Conferma
      // invia la richiesta intera. Quindi si controlla risorsa per risorsa:
      // quella davanti agli occhi dal vivo, le altre col carrello che il run
      // ha visto quando le ha visitate. Una riga che non abbiamo aggiunto,
      // su qualunque risorsa, sospende: decide una persona.
      const perRes = new Map();
      for (const i of receipt.items) {
        const r = String(i.res);
        perRes.set(r, (perRes.get(r) || new Set()).add(String(i.code)));
      }
      const carrelli = receipt.carrelli || {};
      const guai = [];
      let vistiQui = 0;
      for (const [res, attesi] of perRes) {
        const visti = res === model.res
          ? inCart.map((e) => String(e.code))
          : (Array.isArray(carrelli[res]) ? carrelli[res].map(String) : null);
        if (res === model.res) vistiQui = visti.length;
        if (!visti) { guai.push(`${RES_SHORT[res] || res}: carrello non visto`); continue; }
        const estranei = visti.filter((c) => !attesi.has(c));
        if (estranei.length || visti.length !== attesi.size) {
          guai.push(`${RES_SHORT[res] || res}: ${visti.length} nel carrello, ${attesi.size} aggiunti${estranei.length ? ` (estranei ${estranei.join(", ")})` : ""}`);
        }
      }
      if (guai.length) {
        if (panel) {
          panel.message = `Conferma automatica sospesa: ${guai.join("; ")}. La Conferma invia la richiesta intera — controlla il carrello e premila tu sulla pagina.`;
          panel.log(`${now()}  auto-conferma sospesa (${vistiQui} esami su questa risorsa): ${guai.join("; ")}`);
          panel.render();
        }
        return false;
      }
    }

    // The doctor already chose "+ Conferma": that click was the decision, and
    // every gate above has passed (episode, richiesta, last exam present under
    // its right name, cart identical to the receipt for this resource).
    // Confirm now — a countdown here was dead time, not safety.
    panel?.log(`${now()}  conferma automatica: ${flag.count} ${flag.count === 1 ? "esame" : "esami"} · ${cartPreview.join(" · ")} · click nativo su Conferma`);
    // Quando la pagina non è quella davanti agli occhi, la stampa va armata
    // qui: il gancio sul bottone vive solo sulla pagina vera.
    if (doc !== document) {
      const prec = tabStore.get("print.v1", null);
      const vecchi = prec && prec.episodeId === (ep || "") && Date.now() - (prec.ts || 0) < PRINT_FLAG_TTL ? prec.ids || [] : [];
      tabStore.set("print.v1", { ids: [...new Set([...vecchi, model.richiestaId])], episodeId: ep || "", ts: Date.now() });
      const q = tabStore.get("queue.v1", null);
      if (q && q.items) {
        const restano = q.items.filter((it) => it.rid !== model.richiestaId);
        tabStore.set("queue.v1", restano.length ? { ...q, items: restano, ts: Date.now() } : null);
      }
    }
    model.confirmButton.click(); // native click → server confirm → label print flow
    return true;
  }

  // ============================================================ PDF → TESTO
  // Radiology and ECG reports are PDFs whose text can be recovered: the fonts
  // carry their own ToUnicode map, so glyph codes can be translated exactly
  // instead of guessed. (Laboratory reports cannot: they are drawn one glyph
  // at a time with a subset font and no map — those stay documents to open.)
  async function estraiTestoPdf(bytes) {
    // NB: TextDecoder("latin1") is windows-1252 in the browser and rewrites
    // bytes 0x80-0x9F — which corrupts every compressed stream. One byte, one
    // code unit, by hand.
    const byteStr = (u8) => {
      let out = "";
      for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return out;
    };
    const lat = byteStr(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    const objs = new Map();
    for (const m of lat.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)) objs.set(Number(m[1]), m[2]);
    if (!objs.size) return [];

    // The browser only decompresses asynchronously, so the whole extraction is
    // async: zlib-wrapped first (what PDFs use), raw deflate as a fallback.
    const inflate = async (grezzo) => {
      const buf = new Uint8Array(grezzo.length);
      for (let i = 0; i < grezzo.length; i++) buf[i] = grezzo.charCodeAt(i) & 0xff;
      for (const modo of ["deflate", "deflate-raw"]) {
        try {
          const ds = new DecompressionStream(modo);
          const out = new Response(new Blob([buf]).stream().pipeThrough(ds));
          return new TextDecoder("latin1").decode(await out.arrayBuffer());
        } catch { /* try the next mode */ }
      }
      return null;
    };
    const streamOf = async (body) => {
      const i = body.indexOf("stream");
      if (i < 0) return null;
      let a = i + 6;
      if (body[a] === "\r") a++;
      if (body[a] === "\n") a++;
      const e = body.lastIndexOf("endstream");
      if (e < 0 || e <= a) return null;
      // exact length when the dictionary states it (a trailing newline would
      // make the decompressor reject the whole stream), else trim it by hand
      const len = /\/Length\s+(\d+)/.exec(body.slice(0, i));
      const grezzo = len && a + Number(len[1]) <= e
        ? body.slice(a, a + Number(len[1]))
        : body.slice(a, e).replace(/\r?\n$/, "");
      if (!/\/FlateDecode/.test(body.slice(0, i))) return grezzo;
      return await inflate(grezzo);
    };

    const hexToStr = (h) => {
      let out = "";
      for (let i = 0; i + 3 < h.length + 1; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
      return out;
    };
    const parseCMap = (txt) => {
      const map = new Map();
      const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(txt);
      const primo = cs && /<([0-9A-Fa-f]{2,})>/.exec(cs[1]);
      map.byteLen = primo ? Math.max(1, Math.floor(primo[1].length / 2)) : 1;
      for (const b of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const m of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
      }
      for (const b of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const m of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
          const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), dst = parseInt(m[3], 16);
          for (let c = lo; c <= hi && c - lo < 4096; c++) map.set(c, String.fromCharCode(dst + (c - lo)));
        }
      }
      return map;
    };
    const cmapDiOggetto = new Map();
    for (const [num, body] of objs) {
      const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(body);
      if (!tu) continue;
      const src = objs.get(Number(tu[1]));
      const txt = src && await streamOf(src);
      if (txt) cmapDiOggetto.set(num, parseCMap(txt));
    }
    const fonts = new Map();
    for (const [, body] of objs) {
      for (const m of body.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
        const cm = cmapDiOggetto.get(Number(m[2]));
        if (cm) fonts.set(m[1], cm);
      }
    }

    let content = "";
    for (const [, body] of objs) {
      if (!/\/Type\s*\/Page[^s]/.test(body)) continue;
      const c = /\/Contents\s+(\d+)\s+0\s+R/.exec(body);
      if (c && objs.has(Number(c[1]))) content += ((await streamOf(objs.get(Number(c[1])))) || "") + "\n";
    }
    if (!content.trim()) {
      let best = "";
      for (const [, body] of objs) {
        const t = (await streamOf(body)) || "";
        if ((t.match(/T[jJ]/g) || []).length > (best.match(/T[jJ]/g) || []).length) best = t;
      }
      content = best;
    }
    if (!content.trim()) return [];

    let cm = null, x = 0, y = 0;
    const items = [];
    const unesc = (t) => t.replace(/\\([nrtbf()\\])/g, (m, c) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[c] || c))
      .replace(/\\([0-7]{1,3})/g, (m, o) => String.fromCharCode(parseInt(o, 8)));
    const decode = (t) => {
      if (!cm) return t;
      const n = cm.byteLen || 1;
      let out = "";
      for (let i = 0; i < t.length; i += n) {
        let code = 0;
        for (let k = 0; k < n && i + k < t.length; k++) code = (code << 8) | (t.charCodeAt(i + k) & 0xff);
        const u = cm.get(code);
        out += u !== undefined ? u : (n === 1 ? t[i] : "");
      }
      return out;
    };
    // strings come either literal — (testo) — or hexadecimal — <00520041>
    const daHex = (h) => {
      const pulito = h.replace(/[^0-9A-Fa-f]/g, "");
      let out = "";
      for (let i = 0; i + 1 < pulito.length; i += 2) out += String.fromCharCode(parseInt(pulito.slice(i, i + 2), 16));
      return out;
    };
    // BT resets the text matrix: without this the Td offsets of every block
    // pile up and the lines come out in the wrong order.
    const re = /\bBT\b|\/(F\d+)[^\S\n]+[\d.]+\s+Tf|([\d.-]+)\s+([\d.-]+)\s+T[dD]|([\d.-]+\s+){4}([\d.-]+)\s+([\d.-]+)\s+Tm|\((?:\\.|[^()\\])*\)\s*Tj|<[0-9A-Fa-f\s]*>\s*Tj|\[[\s\S]*?\]\s*TJ/g;
    for (const m of content.matchAll(re)) {
      const t = m[0];
      if (t === "BT") { x = 0; y = 0; continue; }
      // cambiare font azzera la mappa: un font senza ToUnicode va letto
      // grezzo, non con la tabella di un altro font (i caratteri cambierebbero)
      if (t.startsWith("/F")) { const nf = t.slice(1).split(/\s/)[0]; cm = fonts.has(nf) ? fonts.get(nf) : null; continue; }
      if (/Tm$/.test(t)) { const n = t.trim().split(/\s+/); x = parseFloat(n[4]); y = parseFloat(n[5]); continue; }
      if (/T[dD]$/.test(t)) { const n = t.trim().split(/\s+/); x += parseFloat(n[0]); y += parseFloat(n[1]); continue; }
      if (/Tj$/.test(t)) {
        const grezzo = t.trim().startsWith("<")
          ? daHex(t.slice(t.indexOf("<") + 1, t.lastIndexOf(">")))
          : unesc(t.slice(t.indexOf("(") + 1, t.lastIndexOf(")")));
        items.push({ x, y, s: decode(grezzo) });
        continue;
      }
      let s2 = "";
      for (const p of t.matchAll(/\((?:\\.|[^()\\])*\)|<[0-9A-Fa-f\s]*>/g)) {
        s2 += decode(p[0][0] === "<" ? daHex(p[0].slice(1, -1)) : unesc(p[0].slice(1, -1)));
      }
      items.push({ x, y, s: s2 });
    }
    if (!items.length) return [];

    // rebuild lines from the coordinates: same y is the same line
    items.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
    const righe = [];
    let cur = null;
    for (const it of items) {
      if (!it.s) continue;
      if (!cur || Math.abs(cur.y - it.y) > 2) { cur = { y: it.y, parts: [] }; righe.push(cur); }
      cur.parts.push(it);
    }
    return righe.map((l) => {
      const passi = [];
      for (let i = 1; i < l.parts.length; i++) {
        const dx = l.parts[i].x - l.parts[i - 1].x, n = Math.max(1, l.parts[i - 1].s.length);
        if (dx > 0) passi.push(dx / n);
      }
      passi.sort((a, b) => a - b);
      const unita = passi.length ? passi[Math.floor(passi.length / 2)] : 6;
      let out = "", prev = null;
      for (const p of l.parts) {
        if (prev) {
          const dx = p.x - prev.x;
          if (dx > unita * Math.max(1, prev.s.length) * 0.7 && !/\s$/.test(out) && !/^\s/.test(p.s)) out += " ";
        }
        out += p.s; prev = p;
      }
      return out.replace(/\s+/g, " ").trim();
    }).filter(Boolean);
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
    let ultimaDiag = null;   // l'ultimo visualizzatore non catturato, per «⧉ Diagnosi»
    // Chiudere la finestra deve fermare davvero la caccia al PDF: senza questo
    // il medico premeva Annulla, la catena continuava a chiedere al server, e
    // una seconda stampa poteva partire mentre la prima era ancora in giro.
    const abbandona = new AbortController();
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
      .pwhd .pwtit { font-size: 12px; opacity: .85; }
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
      /* quando la cattura non riesce, l'unica strada che funziona si vede */
      .pwbtn.grande { font-size: 15px; padding: 13px 22px; box-shadow: 0 3px 12px rgba(11,92,173,.35); }
      .pwhint { width: 100%; font-size: 11.5px; color: #5B6B7A; }
      .pwerr { margin: 12px 16px 0; background: #FBEBEA; border: 1px solid #E9BAB6; color: #7c1a14; border-radius: 10px; padding: 10px 12px; font-size: 12.5px; }
    `;

    const cleanup = () => {
      wizardOpen = false;
      abbandona.abort();
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
      // Un verbo per pulsante, un'icona per verbo. Prima ce n'erano cinque e
      // due («Avanti» e «Salta») facevano esattamente la stessa cosa.
      const nextLbl = i + 1 < jobs.length ? `→ Avanti (${i + 2} di ${jobs.length})` : "✓ Fine";
      root.innerHTML = `<style>${CSS}</style>
        <div class="back"></div>
        <div class="pw" role="dialog" aria-label="Stampa documenti">
          <div class="pwhd">
            <b>Stampa ${i + 1} di ${jobs.length} — ${esc(job.name)}</b>
            ${title ? `<span class="pwtit">${esc(title)}</span>` : ""}
            <span class="dest">→ ${esc(job.printer)}</span>
          </div>
          ${err ? `<div class="pwerr">${esc(err)}</div>` : ""}
          <div class="pwbody"><div class="pwmsg">Carico il PDF…</div></div>
          <div class="pwft">
            ${viewer
              ? `<button class="pwbtn re grande" id="pwtab" title="Apre il documento in una scheda: da lì Ctrl+P">↗&nbsp; Apri e stampa</button>`
              : `<button class="pwbtn re" id="pwre" title="Riapre la finestra di stampa del browser">🖨&nbsp; Stampa</button>`}
            <button class="pwbtn next" id="pwnext" title="${i + 1 < jobs.length ? "Passa al documento successivo" : "Chiude: hai stampato tutto"}">${nextLbl}</button>
            ${viewer ? "" : `<button class="pwbtn ghost" id="pwtab" title="Se la stampa non parte, aprilo in una scheda">↗&nbsp; Scheda</button>`}
            ${viewer && ultimaDiag ? `<button class="pwbtn ghost" id="pwdiag" title="Copia com'è fatto il visualizzatore (senza numeri), da mandare a chi fa il pannello">⧉&nbsp; Diagnosi</button>` : ""}
            <button class="pwbtn exit" id="pwexit" title="Chiude senza stampare il resto (Esc)">✕&nbsp; Chiudi</button>
            <div class="pwhint">${viewer
              ? `Questo documento non si lascia stampare da qui: <b style="display:inline">↗ Apri e stampa</b>, poi Ctrl+P → <b style="display:inline">${esc(job.printer)}</b>`
              : `Scegli <b style="display:inline">${esc(job.printer)}</b> nel dialogo`}</div>
          </div>
        </div>`;
      root.querySelector("#pwre")?.addEventListener("click", tryPrint);
      root.querySelector("#pwnext").onclick = advance;
      root.querySelector("#pwexit").onclick = cleanup;
      root.querySelector("#pwtab").onclick = () => openTab(job.url, "_blank"); // user-activated → not popup-blocked
      root.querySelector("#pwdiag")?.addEventListener("click", async () => {
        const b = root.querySelector("#pwdiag");
        segnaCopia(b, await copiaTesto(diagnosiTesto(ultimaDiag)));
      });
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
        // un modulo di consenso è un file dell'estensione, non una pagina del
        // gestionale: si prende così com'è, senza la catena same-origin
        const { blob, via } = jobs[i].diretto
          ? { blob: await (await fetch(jobs[i].url, { signal: abbandona.signal })).blob(), via: "estensione" }
          : await fetchPdf(jobs[i].url, { signal: abbandona.signal });
        panel?.log(`${now()}  ${jobs[i].name}: PDF ottenuto${via ? " via " + via : ""}`);
        blobUrl = URL.createObjectURL(blob);
        const body = root.querySelector(".pwbody");
        body.innerHTML = `<iframe title="Anteprima PDF"></iframe>`;
        const f = body.querySelector("iframe");
        let printed = false;
        // il cronometro va SEMPRE dentro `timer`, e la stampa parte solo se
        // quella cornice è ancora quella a schermo: «Avanti» ne lasciava uno
        // orfano, che stampava il documento dopo al posto di questo
        const once = () => { if (!printed && root.contains(f)) { printed = true; tryPrint(); } };
        f.addEventListener("load", () => { clearTimeout(timer); timer = setTimeout(once, 350); });
        timer = setTimeout(once, 1500); // headless/viewer-less fallback
        f.src = blobUrl;
      } catch (e) {
        if (e?.name === "AbortError") return;
        // This endpoint is a viewer we can't safely turn into a Blob. Don't
        // auto-open (a popup after the async fetch is blocked for lack of user
        // activation) — offer a big button the doctor clicks, which carries
        // activation and always opens the tab. The sequence still advances.
        const job = jobs[i];
        // Non tutto quello che fallisce è «un visualizzatore»: una sessione
        // scaduta, un HTTP 500 o una risposta fuori dall'ospedale finivano
        // sotto quella scritta, e «Apri e stampa» apriva la pagina di login.
        const suo = e instanceof ViewerError;
        if (suo && e.html) {
          ultimaDiag = { cosa: `stampa ${job.name}`, url: job.url, html: e.html, diag: e.diag, quando: now() };
          if (panel) panel.diagnosi = ultimaDiag;
        }
        panel?.log(`${now()}  ${job.name}: PDF non catturato — ${suo ? `visualizzatore${e.diag ? " [" + e.diag + "]" : ""}` : `${e?.head || e?.message || e}`}`);
        render(suo
          ? `Anteprima non catturabile per questo documento (è un visualizzatore).${e?.diag ? " [" + e.diag + "]" : ""}`
          : `${e?.head || "Non riuscito"}${e?.body ? " — " + e.body : ""}`, true);
        root.querySelector(".pwbody").innerHTML = suo
          ? `<div class="pwmsg">Premi <b>↗ Apri ${esc(job.name)}</b> qui sotto, poi <b>Ctrl+P → ${esc(job.printer)}</b>,<br>torna qui e premi «→ Avanti».</div>`
          : `<div class="pwmsg">Questo documento non è stato scaricato. Risolvi il problema qui sopra e riprova la stampa dal pannello.</div>`;
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
    tabStore.set("receipt.v1", { richiestaId: next.rid, episodeId: q.episodeId, ts: Date.now(), items: next.added || [], carrelli: next.carrelli || {} });
    if (q.autoConfirm && next.lastCode && next.kind !== "radio") {
      tabStore.set("confirm.v1", { richiestaId: next.rid, episodeId: q.episodeId, lastCode: next.lastCode, lastLabel: next.lastLabel, count: next.count, ts: Date.now() });
    }
    tabStore.set("queue.v1", { ...q, items: q.items.map((it, i) => (i ? it : { ...it, nav: true })), ts: Date.now() });
    nav(next.listUrl);
  }

  function maybeAutoPrint(panel, doc = document, url = location.href) {
    const flag = tabStore.get("print.v1", null);
    if (!flag) return false;
    // never print for an episode other than the page in front of the user
    const here = findEpisodeId(doc, url);
    if (!here || (flag.episodeId && flag.episodeId !== here)) return false;
    if (Date.now() - (flag.ts || 0) > PRINT_FLAG_TTL) { tabStore.set("print.v1", null); return false; }
    const map = printModel(doc, url);
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
  // The extension runs on two applications: SA4PSO, and the clinical portal
  // where the multi-day table lives. Everything below the storico reader is
  // written for SA4PSO's markup and must never be applied to the other one —
  // its login page carries a password field, and mistaking it for SA4PSO's
  // would wipe the shift's saved documents.
  const SA4PSO = location.hostname === "smarthealth.multimedica.it" || !!DEMO;
  function boot() {
    if (document.getElementById("psassist-host")) return;
    // The portal's multi-day table: here the panel does not order anything and
    // does not ask the server anything. It reads the table already on screen
    // and hands it to the patient's page. Nothing else.
    if (haStorico(document)) { bootStorico(); return; }
    if (!SA4PSO) {
      // The portal is a single-page application: it paints the table AFTER
      // this script has run, and reaching it is an in-app route change that
      // never re-injects us. Probing once would mean never reading anything.
      let atteso = null;
      const occhio = new MutationObserver(() => {
        clearTimeout(atteso);
        atteso = setTimeout(() => {
          if (document.getElementById("psassist-host")) return;
          if (haStorico(document)) { occhio.disconnect(); clearTimeout(muto); bootStorico(); }
        }, 120);
      });
      occhio.observe(document.documentElement, { childList: true, subtree: true });
      // Se dopo un po' la tabella non c'è, non si resta muti: «non si vede
      // niente» è indistinguibile da «l'estensione non gira su questa pagina»,
      // e senza saperlo non si sa nemmeno cosa raccontarmi. La striscia dice
      // che il programma c'è e cosa gli manca. Sparisce da sola.
      const muto = setTimeout(() => {
        if (document.getElementById("psassist-host") || haStorico(document)) return;
        const h = document.createElement("div");
        h.id = "psassist-attesa";
        const r = h.attachShadow({ mode: "open" });
        r.innerHTML = `<style>:host{all:initial}
          .b{position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:10px;
             max-width:min(520px,92vw);font:12.5px/1.4 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;
             background:#6B7A88;color:#fff;border-radius:10px;padding:8px 10px 8px 12px;box-shadow:0 6px 22px rgba(11,44,80,.28)}
          button{border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;border-radius:7px;
                 padding:4px 9px;font:inherit;font-weight:600;cursor:pointer}
          button:hover{background:rgba(255,255,255,.14)}</style>
          <div class="b" role="status"><span><b>PS Assist</b> è attivo, ma qui non c'è nessuna tabella:
          apri <b>Tabella</b> nello storico dati clinici.</span><button id="via">✕</button></div>`;
        r.getElementById("via").addEventListener("click", () => h.remove());
        document.documentElement.appendChild(h);
        setTimeout(() => h.remove(), 15000);
      }, 1500);
      return;
    }
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
    if (pageType === "patient") {
      panel.entry = patientModel(document, location.href);
      panel.esiti = esitiModel(document, location.href);
    }
    panel.restoreUi(); // same tab + same episode → quesito/selezione/vista tornano come prima
    // Quello che è stato deciso in sottofondo si dice sulla pagina dove il
    // medico atterra — che può essere il carrello, non solo quella del paziente.
    const av = tabStore.get(AVVISO, null);
    if (av) {
      tabStore.set(AVVISO, null);
      if (Date.now() - (av.ts || 0) < CONFIRM_FLAG_TTL) panel.message = av.testo;
    }
    panel.render();
    if (pageType === "patient") {
      // this patient is now one the panel knows (name + episode + page only)
      // only a page that can actually order is a patient: the ER worklist
      // classifies the same way but its episode belongs to someone in the list
      if (panel.entry && (panel.entry.labUrl || panel.entry.radioUrl)) {
        rememberPatient(panel.episodeId, (document.title || "").trim(), location.href);
        // Il portale clinico si apre da QUESTO link, sulla pagina di QUESTO
        // paziente: quel clic è l'identità, ed è esatta. Si annota qui, prima
        // che la scheda si apra, così di là la tabella sa di chi è senza
        // confrontare nomi e senza chiedere niente al server.
        document.addEventListener("click", (ev) => {
          const a = ev.target?.closest?.('a[href*="MODALITA=CLINICA"]');
          if (!a || !hasExt()) return;
          ask({ t: "apreStorico", ep: panel.episodeId || "", nome: panel.nomePaziente() || "" }).catch(() => {});
        }, true);
      }
      if (hasExt()) ask({ t: "portale" }).then((r) => {
        if (r && r.ok && r.origine) { panel.portale = r.origine; panel.render(); }
      }).catch(() => {});
      panel.applyAfterNav();
      const pending = nextQueued(findEpisodeId(document, location.href));
      panel.pending = pending; // a richiesta of this run still needs confirming
      panel.render();
      panel.refreshRefCache();
      panel.caricaStorico();
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
      const rin = rinominatiQui(model);
      if (rin.length) panel.log(`${now()}  ATTENZIONE: su questa pagina ${rin.length} codici portano un nome diverso da quello noto — ${rin.slice(0, 4).join(" · ")}`);
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

  // ---------------------------------------------------- portale clinico
  // A strip at the bottom of the portal page: what was read, for whom, and a
  // way to read it again after moving the columns. No panel, no ordering.
  function bootStorico() {
    document.getElementById("psassist-attesa")?.remove();
    let unito = null;
    let chiAprivo;   // undefined = non ancora chiesto, null = non lo sappiamo
    const host = document.createElement("div");
    host.id = "psassist-host";
    const root = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);

    const disegna = (stato) => {
      root.innerHTML = `
        <style>
          :host { all: initial; }
          .bar { position: fixed; left: 12px; bottom: 12px; z-index: 2147483647;
                 display: flex; align-items: center; gap: 10px; max-width: min(560px, 92vw);
                 font: 12.5px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
                 background: #0B5CAD; color: #fff; border-radius: 10px; padding: 8px 10px 8px 12px;
                 box-shadow: 0 6px 22px rgba(11,44,80,.28); }
          .bar.ko { background: #6B7A88; }
          b { font-weight: 700; }
          .who { opacity: .85; }
          button { border: 1px solid rgba(255,255,255,.5); background: transparent; color: #fff;
                   border-radius: 7px; padding: 4px 9px; font: inherit; font-weight: 600; cursor: pointer; }
          button:hover { background: rgba(255,255,255,.14); }
          button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
        </style>
        <div class="bar ${stato.ok ? "" : "ko"}" role="status">
          <span>${stato.html || esc(stato.testo || "")}</span>
          <button id="rileggi" title="Dopo aver spostato le colonne o cambiato il periodo">↻ Rileggi</button>
        </div>`;
      root.getElementById("rileggi").addEventListener("click", leggi);
    };

    const leggi = async () => {
      const letto = leggiStorico(document);
      if (!letto) { disegna({ ok: false, testo: "Nessuna tabella da leggere in questa pagina." }); return; }
      // Da quale paziente il medico è arrivato qui: l'ha aperto lui, dalla sua
      // pagina. È l'identità più solida che ci sia, e non costa una richiesta.
      // Si richiede a OGNI lettura: la scheda del portale resta aperta, e nel
      // frattempo il medico può aver cliccato «Storico» da un altro paziente.
      if (hasExt()) {
        chiAprivo = null;
        try { const r = await ask({ t: "chiAprivo" }); if (r && r.ok) chiAprivo = r; } catch { /* si va avanti */ }
      }
      // …ma vale solo se di là c'è LO STESSO nome: il portale cambia paziente
      // senza ricaricare la pagina, e la tabella di un altro non deve portarsi
      // dietro l'episodio da cui si era partiti.
      const dalClic = !!(chiAprivo && chiAprivo.ep && combaciaNome(chiAprivo.nome, letto.paziente));
      if (dalClic) { letto.ep = chiAprivo.ep; letto.nomeSa4 = chiAprivo.nome || ""; }
      unito = unisciStorico(unito, letto);
      const valori = unito.righe.reduce((n, r) => n + r.valori.filter((v) => v.v).length, 0);
      const chi = [unito.paziente.cognome, unito.paziente.nome].filter(Boolean).join(" ");
      const quanti = `<b>${esc(String(unito.righe.length))} esami · ${esc(String(unito.date.length))} prelievi</b> letti (${esc(String(valori))} valori)`;
      // l'unico testo con del markup dentro: passa da `html`, e ogni pezzo che
      // viene dalla pagina del portale è scappato qui, uno per uno
      const nonSuo = chiAprivo && chiAprivo.ep && !dalClic
        ? ` · non è ${esc(chiAprivo.nome || "il paziente")}, da cui l'hai aperta: si attribuirà col codice fiscale (⭳ Carica i valori)` : "";
      const detto = (nuovo, n) => `${quanti} <span class="who">— ${esc(chi)}${nuovo ? ", nuovo" : ""}${n > 1 ? ` · ${esc(String(n))} pazienti in memoria` : ""}${nonSuo}</span>. Torna sul paziente: sono in Esiti.`;
      if (!hasExt()) {
        disegna({ ok: false, testo: `Letti ${unito.righe.length} esami, ma serve l'estensione per portarli sul paziente.` });
        return;
      }
      // una scheda per paziente: se non c'era, la crea
      ask({ t: "putStorico", chiave: chiaveArchivio(unito), dati: unito }).then((r) => {
        disegna(r && r.ok ? { ok: true, html: detto(r.nuovo, r.pazienti || 1) }
          : { ok: false, testo: "Letto, ma l'estensione non li ha ricevuti: apri il paziente e riprova." });
      });
    };

    // the table redraws when the period changes or the columns are scrolled
    let attesa = null;
    const osserva = document.querySelector(".clinical-data-table__freeze-panel");
    if (osserva) {
      new MutationObserver(() => { clearTimeout(attesa); attesa = setTimeout(leggi, 400); })
        .observe(osserva, { childList: true, subtree: true });
    }
    leggi();
  }

  boot();
})();
