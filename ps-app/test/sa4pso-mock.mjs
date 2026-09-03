/*
 * Stateful SA4PSO simulator for the e2e tests.
 *
 * Reproduces the DOM patterns measured in the 2026 audit of the real saved
 * pages — with ANONYMIZED data only (no real patients/doctors/ids):
 *   - windows-1252 charset (bodies are encoded buffers)
 *   - duplicate `selected` attributes (server quirk; last one wins)
 *   - RELATIVE hrefs/actions (stricter than the absolutized saved pages)
 *   - AFCDataLink Insert/Delete rows with the audited param sets
 *   - a cart-wide "svuota" link that has Delete=Elimina but NO PRESTAZIONE
 *   - Prestazioni form with hidden MVPG=RcsStampaEtichetteLIS + IN_* pairs
 *   - two Conferma submits (Update / Update1)
 *   - Post/Redirect/Get by default; direct-render mode as a variant
 */

const ORIGIN = "https://smarthealth.multimedica.it";
const PATH = "/sa4pso/restrict/menuPsoEpisodio.do";

export const RES = {
  POC: "00660001P", URGENZE: "00720001P", CENTRAL: "00130001P",
  RX: "00120001P", ECO: "00400001P", RMN: "00360001P", TAC: "00380001P",
};
const LAB_RES = [RES.POC, RES.CENTRAL, RES.URGENZE];
const RADIO_RES = [RES.RX, RES.ECO, RES.RMN, RES.TAC];

export const RES_LABEL = {
  [RES.POC]: "LABORATORIO ANALISI POC - SSG (P)",
  [RES.URGENZE]: "LABORATORIO ANALISI URGENZE - SSG (P)",
  [RES.CENTRAL]: "LABORATORIO ANALISI - SSG (P)",
  [RES.RX]: "RADIOLOGIA - RX - SSG (P)",
  [RES.ECO]: "RADIOLOGIA - ECOGRAFIA - SSG (P)",
  [RES.RMN]: "RADIOLOGIA - RISONANZA MAGNETICA NUCLEARE - SSG (P)",
  [RES.TAC]: "RADIOLOGIA - TAC - SSG (P)",
};

// Test catalog: real codes for the exams the presets use, everything else synthetic.
export const CATALOG = {
  [RES.POC]: {
    320: "EMOCROMOCITOMETRICO URGENTE (POCT1502)",
    3: "EMOGASANALISI VENOSA POC (POC2117)",
    166: "EGA EMOGASANALISI ARTERIOSA (POC1006)",
    176: "CREATININEMIA (POC1206)",
    266: "PCR POC (POC1102)",
    101: "D-DIMERO POC (POC1405)",
    222: "TROPONINA I POC (POC2102)",
    324: "TROPONINA ULTRASENSIBILE (POC3001)",
    30: "GLUCOSIO (POC1250)",
    220: "PT (POC1401)",
    134: "PTT POC (POC1402)",
    135: "FIBRINOGENO POC (POC1404)",
    310: "PANNELLO 2 - BASE",
    306: "PANNELLO 3 - CARDIOPALMO",
  },
  [RES.URGENZE]: {
    16: "BILIRUBINA TOTALE REFLEX (450008)",
    228: "GPT (1583)",
    53: "GOT (1582)",
    167: "GAMMA GT (1596)",
    34: "LIPASI (1572)",
    159: "PROCALCITONINA (1690)",
    293: "PROTEINA C REATTIVA (1102)",
    181: "PT (1401)",
    54: "PTT (1402)",
    258: "FIBRINOGENO (450102)",
    297: "NT PRO-BNP (2040)",
    317: "ESAME URINE URGENTI (21296)",
  },
  [RES.CENTRAL]: {
    16: "BILIRUBINA TOTALE REFLEX (450008)",
    228: "GPT (1583)",
    999: "ESAME RARO CENTRALE (0001)",
  },
  [RES.RX]: {
    35: "RX TORACE (6979)",
    36: "RX TORACE 1 PROIEZIONE (6980)",
    28: "RX ADDOME SENZA CONTRASTO (A692)",
    401: "RX TORACE 2 PROIEZIONI (87441)",
    402: "RX ADDOME DIRETTO (87442)",
  },
  [RES.ECO]: { 501: "ECOGRAFIA ADDOME COMPLETO (88761)" },
  [RES.RMN]: { 601: "RMN ENCEFALO (88911)" },
  [RES.TAC]: { 701: "TAC CAPO SENZA MDC (87031)" },
};

// --- windows-1252 encode/decode (independent from the app's implementation) --
const W1252 = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
};
export function encodeWin1252(str) {
  const bytes = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF) bytes.push(cp);
    else if (W1252[cp] !== undefined) bytes.push(W1252[cp]);
    else bytes.push(0x3F); // '?'
  }
  return Buffer.from(bytes);
}
export function decodeFormBody(raw) {
  // raw: Buffer of an application/x-www-form-urlencoded body in win1252
  const out = {};
  for (const pair of raw.toString("latin1").split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    const k = idx < 0 ? pair : pair.slice(0, idx);
    const v = idx < 0 ? "" : pair.slice(idx + 1);
    const dec = (s) => {
      const bytes = [];
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "+") bytes.push(0x20);
        else if (c === "%" && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
        else bytes.push(s.charCodeAt(i) & 0xFF);
      }
      return new TextDecoder("windows-1252").decode(Buffer.from(bytes));
    };
    const key = dec(k);
    if (out[key] === undefined) out[key] = dec(v);
  }
  return out;
}

// A tiny but structurally valid PDF (one blank page), served for the print
// endpoints. Content is irrelevant to the client; the magic bytes and the
// application/pdf content type are what the wizard checks.
// A radiology report with real, extractable text (CID font + ToUnicode), the
// way the hospital's RIS builds them. Invented content only.
export function refertoRxPdf(righe = [
  "RADIOLOGIA - Ospedale di esempio",
  "Quesito Diagnostico: dispnea",
  "RADIOGRAFIA TORACE 2 PROIEZIONI",
  "Non focolai a carattere broncopneumonico.",
  "Ombra cardiaca nei limiti. Seni costofrenici liberi.",
  "Il Medico DOTTORE ESEMPIO",
]) {
  const enc = (x) => [...x].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  let content = "BT /F1 10 Tf\n";
  let y = 700;
  for (const r of righe) { content += `1 0 0 1 60 ${y} Tm <${enc(r)}> Tj\n`; y -= 14; }
  content += "ET\n";
  const cmap = [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "1 begincodespacerange <0000> <FFFF> endcodespacerange",
    "1 beginbfrange <0020> <00ff> <0020> endbfrange",
    "endcmap end end",
  ].join("\n");
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
    { dict: `<</Length ${content.length}>>`, raw: Buffer.from(content, "latin1") },
    "<</Type/Font/Subtype/Type0/BaseFont/AAAAAA+ArialMT/ToUnicode 6 0 R>>",
    { dict: `<</Length ${cmap.length}>>`, raw: Buffer.from(cmap, "latin1") },
  ];
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  let pos = parts[0].length;
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(pos);
    const head = Buffer.from(`${i + 1} 0 obj\n${typeof o === "string" ? o : o.dict}\n`, "latin1");
    const body = typeof o === "string" ? Buffer.alloc(0)
      : Buffer.concat([Buffer.from("stream\n", "latin1"), o.raw, Buffer.from("\nendstream\n", "latin1")]);
    const end = Buffer.from("endobj\n", "latin1");
    parts.push(head, body, end);
    pos += head.length + body.length + end.length;
  });
  const xref = pos;
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")
    + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}

export const TINY_PDF = Buffer.from(
  "%PDF-1.4\n" +
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n" +
  "trailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

// ------------------------------------------------------------------ pages
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HEAD0 = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>ROSSI MARIO</title></head><body>`;
const FOOT = `</body></html>`;

// Another presidio numbers the same resources and the same exams differently
// (site-local ids). Names and LIS mnemonics are what stay put.
const ALTRO_PRESIDIO = { "00660001P": "00680001P", "00720001P": "00740001P", "00130001P": "00150001P", "00120001P": "00140001P" };

export function createMock(opts = {}) {
  // one simulator per patient: the name lands in <title>, which is where the
  // panel reads it from (opts.name defaults to the single test patient)
  const NAME = opts.name || "ROSSI MARIO";
  const HEAD = HEAD0.replace(">ROSSI MARIO<", ">" + esc(NAME) + "<");
  const state = {
    nextRichiestaId: 700001,
    allocated: {},          // richiestaId -> {tipo:'lab'|'radio', risorse:[..]}
    richieste: {},          // richiestaId -> {quesito, urgenza, cart: Map(code->res), confirmed, quesitoRaw}
    requests: [],           // {method, url, params, body?}
    insertCount: {},        // `${rid}:${code}` -> times the Insert URL was requested
    lagLeft: { ...(opts.lagRenders || {}) },   // code -> list renders that still hide its DEL row
    expireAfter: opts.expireAfter ?? Infinity, // total requests before the session "dies"
    directRender: !!opts.directRender,         // no PRG redirects
    episodeId: opts.episodeId || "999001",
  };

  // Optionally pre-seed an already-confirmed richiesta so the patient page
  // carries its print links from the start (manual-reprint scenarios).
  if (opts.seedConfirmed) {
    const rid = 699999;
    state.allocated[rid] = { tipo: "lab", risorse: LAB_RES };
    state.richieste[rid] = { quesito: "seed", urgenza: "2", cart: new Map([["320", RES.POC]]), confirmed: true };
  }
  if (opts.seedConfirmedRadio) {
    const rid = 699998;
    state.allocated[rid] = { tipo: "radio", risorse: RADIO_RES };
    state.richieste[rid] = { quesito: "seed rx", urgenza: "2", cart: new Map([["401", RES.RX]]), confirmed: true };
  }

  const EP0 = state.episodeId;
  // After swapEpisodeAfter handled requests, every page renders as ANOTHER
  // episode — the client's wrong-patient guard must abort before any Insert.
  const EP = () => (state.requests.length > (opts.swapEpisodeAfter ?? Infinity) ? "666999" : EP0);
  const risorseOf = (tipo) => (tipo === "radio" ? RADIO_RES : LAB_RES);
  // opts.altroPresidio: resource ids and exam codes shift, labels do not
  const R = (res) => (opts.altroPresidio ? (ALTRO_PRESIDIO[res] || res) : res);
  const Rback = (res) => (opts.altroPresidio
    ? (Object.entries(ALTRO_PRESIDIO).find(([, v]) => v === res) || [res])[0] : res);
  const C = (code) => (opts.altroPresidio ? String(Number(code) + 500) : String(code));
  const Cback = (code) => (opts.altroPresidio ? String(Number(code) - 500) : String(code));

  function patientPage() {
    const mk = (tipo, title) => {
      const rs = risorseOf(tipo);
      return `<a title="${title}" class="myButton" href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=${EP()}&ASSISTITO_ID=*TEST00001&STRUTTURA=1&RISORSA_ID=${rs[0]}&RISORSE=${rs.join(",")}&PADIGLIONE=&toPage=RcsRichiestaPrestazioniRicercaErogatore&returnPage=PsoEpisodio">${title.split(" ").pop()}</a>`;
    };
    return `${HEAD}
      <form name="RefertiImposta" method="post" action="menuPsoEpisodio.do?ccsForm=RefertiImposta:Edit&MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP()}"></form>
      <form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP()}">
        <textarea name="DIARIO"></textarea>
      </form>
      ${mk("lab", "Richieste Laboratorio")} ${mk("radio", "Richieste Radiologia")}
      <a title="Richieste Consulenza" href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=${EP()}&REPARTO=001PS&STRUTTURA=1&toPage=PsoRichiestaPrestazioniRicercaErogatore&returnPage=PsoEpisodio">Consulenze</a>
      <table>${printRows()}</table>
      ${risultatiRows()}
      ${refertiRows()}
      ${FOOT}`;
  }

  // Result rows (esiti), faithful to the audited structure: sheet icon with
  // title="REFERTO" + onclick window.open to Sa4ViewerExtRedirect, hidden
  // DATA_ORD/DESCRIZIONE_TITLE in the same cell. Deliberately OUT of
  // chronological order in the DOM, plus an archive link without REFERTO_ID
  // that clients must ignore.
  function refertiRows() {
    if (opts.noReferti) return "";   // a patient with nothing reported yet
    const mk = (id, sistema, dt, label) => `
      <tr><td class="AFCDataTD" title="${esc(label)}" valign="top">
        <a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP()}#" title="REFERTO" onclick="javascript:window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=*TEST00001&REFERTO_SISTEMA=${sistema}&REFERTO_ID=${id}','${sistema}')"><img alt="referto"></a>
        ${esc(label)}<input type="hidden" name="TIPO" value="RICH"><input type="hidden" name="DATA_ORD" value="${dt}"><input type="hidden" name="NOMINATIVO" value="OPERATORE PROVA"><input type="hidden" name="DESCRIZIONE_TITLE" value="${esc(label)}">
      </td></tr>`;
    return `<table>
      ${mk("aaaa1111-0000-0000-0000-000000000001", "HL7LIS", "2026-08-21 22:10:00.0", "0-320 EMOCROMOCITOMETRICO URGENTE (POCT1502)")}
      ${mk("bbbb2222-0000-0000-0000-000000000002", "HL7LIS", "2026-08-22 07:45:00.0", "68-3 EMOGASANALISI VENOSA POC (POC2117)")}
      ${mk("cccc3333-0000-0000-0000-000000000003", "HL7RIS", "2026-08-22 01:30:00.0", "69-133 TC ENCEFALO (A69846)")}
    </table>
    <a title="REFERTO" href="menuPsoEpisodio.do?x#" onclick="javascript:window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=*TEST00001&MODALITA=ELENCODOC','ELENCODOC')">Archivio documenti</a>`;
  }

  // Per-richiesta print rows, exactly as audited on the real patient page.
  // The LIS splits a multi-laboratory richiesta into one row per resource:
  // same RICHIESTA_ID, RICHIESTA_PROG 1..n, each row with its own barcode
  // link (relative .do) and its own exam-list link (root-relative
  // jasperservlet, BRANCA varying per row). Radiology richieste get a single
  // "Stampa Prenotazione Esterna" row instead; consulenze only the list.
  function rowsFor(rid) {
    const alloc = state.allocated[rid];
    const r = state.richieste[rid];
    if (!alloc || !r) return [];
    if (alloc.tipo === "radio") {
      return [`<a title="Stampa Prenotazione Esterna" href="/jasperserverSAN/jasperservlet?PROJECT=sa4pso&REPORT=PsoRichiestaAccertamentiRadiografici&CONN=jdbc/sa4web&&RICHIESTA_ID=${rid}&RICHIESTA_PROG=1&BRANCA=69&REPARTO=001PS&EPISODIO_ID=${EP()}&STAMPA_ID=18&RISORSA_ID=00010001P"><img alt="prenotazione"></a>`];
    }
    const resList = [...new Set([...r.cart.values()])];
    if (!resList.length) resList.push(alloc.risorse[0]);
    return resList.map((res, i) => {
      const prog = i + 1;
      const branca = prog === 1 ? 68 : 0; // opaque server value: clients must pass it through
      return `<a title="Stampa Richiesta" href="/jasperserverSAN/jasperservlet?PROJECT=sa4rcs&REPORT=RcsRichiesta&CONN=jdbc/sa4web&RICHIESTA_ID=${rid}&RICHIESTA_PROG=${prog}&BRANCA=${branca}&RISORSA_ID=${res}&REPARTO=001PS"><img alt="lista"></a>
        <a title="Stampa Etichette" href="RcsStampaEtichetteLISHMIMU.do?RICHIESTA_ID=${rid}&RICHIESTA_PROG=${prog}"><img alt="etichette"></a>`;
    });
  }
  // lab still being reported: the coloured icon opens RcsAccessiRisultatiElenco.do
  const ACCESSI = [
    { id: "20260010040701", when: "2026-08-23 07:28:00.0", exams: "0-320 EMOCROMOCITOMETRICO URGENTE (POCT1502)" },
    { id: "20260010035301", when: "2026-08-22 22:23:00.0", exams: "0-220 PT (POC1401); 0-320 EMOCROMOCITOMETRICO URGENTE (POCT1502)" },
  ];
  function risultatiRows() {
    if (!opts.withResults) return "";
    return `<table>${ACCESSI.map((a) => `<tr>
      <td class="AFCDataTD" title="${esc(a.exams)}">
        <a class="AFCDataLink" href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP()}#" title="Visualizza Risultati" onclick="window.open('/sa4rcs/restrict/RcsAccessiRisultatiElenco.do?RCS_ACCESSO_ID=${a.id}','*TEST00001','height=500,width=800');"><img alt="risultati"></a>
        <input type="hidden" name="DATA_ORD" value="${a.when}">
      </td></tr>`).join("")}</table>`;
  }
  // two draws with the same panel: the older one differs where a change mark
  // must appear (Hb −16%) and where it must not (GB +5%, Ht 0%)
  const risultatiPage = (id) => {
    const vecchio = String(id).endsWith("5301");
    const [gb, hb] = vecchio ? ["6.1", "95"] : ["6.4", state.hbNuova || "80"];
    return `${HEAD}<table>
      <tr><td class="AFCColumnTD">Esame</td><td class="AFCColumnTD">Valore</td><td class="AFCColumnTD">Unit&agrave; di Misura</td><td class="AFCColumnTD">Range</td><td class="AFCColumnTD">Stato</td><td class="AFCColumnTD">Data</td></tr>
      <tr><td class="AFCDataTD">Assistito</td><td class="AFCDataTD"><strong>${esc(NAME)}</strong>&nbsp;&nbsp;et&agrave;&nbsp;79&nbsp;&nbsp;M&nbsp;${esc(opts.cf || "SMPRSS80A01F205X")}</td></tr>
      <tr><td class="AFCDataTD">Leucociti&nbsp;</td><td class="AFCDataTD">${gb}</td><td class="AFCDataTD">x10</td><td class="AFCDataTD">4 - 10</td><td class="AFCDataTD">parziale</td><td class="AFCDataTD">23/08/2026 07:47</td></tr>
      <tr><td class="AFCDataTD">Emoglobina&nbsp;</td><td class="AFCDataTD">${hb}</td><td class="AFCDataTD">g/L</td><td class="AFCDataTD">135 - 180</td><td class="AFCDataTD">parziale</td><td class="AFCDataTD">23/08/2026 07:47</td></tr>
      <tr><td class="AFCDataTD">Ematocrito&nbsp;</td><td class="AFCDataTD">44</td><td class="AFCDataTD">%</td><td class="AFCDataTD">40 - 54</td><td class="AFCDataTD">parziale</td><td class="AFCDataTD">23/08/2026 07:47</td></tr>
      <tr><td class="AFCDataTD">Ricerca sangue occulto&nbsp;</td><td class="AFCDataTD">POSITIVO</td><td class="AFCDataTD"></td><td class="AFCDataTD">assente</td><td class="AFCDataTD">definitivo</td><td class="AFCDataTD">23/08/2026 07:47</td></tr>
      <tr><td class="AFCDataTD">Aspetto del campione&nbsp;</td><td class="AFCDataTD">limpido</td><td class="AFCDataTD"></td><td class="AFCDataTD"></td><td class="AFCDataTD"></td><td class="AFCDataTD"></td></tr>
      ${state.extraRow && !vecchio ? `<tr><td class="AFCDataTD">${esc(state.extraRow.nome)}&nbsp;</td><td class="AFCDataTD">${esc(state.extraRow.valore)}</td><td class="AFCDataTD">${esc(state.extraRow.um || "")}</td><td class="AFCDataTD">${esc(state.extraRow.range || "")}</td><td class="AFCDataTD">definitivo</td><td class="AFCDataTD">23/08/2026 08:10</td></tr>` : ""}
    </table>accesso ${esc(id)}${FOOT}`;
  };

  function printRows() {
    // the real patient page lists print links only for richieste the LIS has
    // registered: an unconfirmed bozza has no labels to print
    return Object.keys(state.richieste)
      .filter((rid) => state.richieste[rid].confirmed)
      .map((rid) => rowsFor(rid).map((row) => `<tr><td>Richiesta ${rid}</td><td>${row}</td></tr>`).join("\n"))
      .join("\n");
  }

  function creaPage(params) {
    const risorse = (params.get("RISORSE") || LAB_RES.join(",")).split(",");
    const rid = state.nextRichiestaId++;
    state.allocated[rid] = { tipo: RADIO_RES.includes(risorse[0]) ? "radio" : "lab", risorse };
    const prefill = opts.prefilledQuesito || "";
    const options = risorse.map((r) => `<option value="${r}" ${r === params.get("RISORSA_ID") ? "selected" : ""}>${esc(RES_LABEL[r])}</option>`).join("");
    return `${HEAD}
      <form name="RefertiImposta" method="post" action="menuPsoEpisodio.do?ccsForm=RefertiImposta:Edit&STRUTTURA=1&MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=${EP()}"></form>
      <form name="Allergie" method="post" action="menuPsoEpisodio.do?ccsForm=Allergie&STRUTTURA=1&MVPG=PsoRichiestaCrea&EPISODIO_ID=${EP()}"></form>
      <form name="RisorsaFiltro" method="post" action="menuPsoEpisodio.do?ccsForm=RisorsaFiltro:Edit&STRUTTURA=1&MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=${EP()}&RISORSE=${risorse.join("%2C")}">
        <select name="RISORSA_ID"><option value="" selected>&lt;Seleziona&gt;</option>${options}</select>
        <input class="AFCButton" value="Cerca" type="submit" name="DoSearch">
      </form>
      <form name="RICHIESTACrea" method="post" action="menuPsoEpisodio.do?ccsForm=RICHIESTACrea:Edit&STRUTTURA=1&MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=${EP()}&RISORSE=${risorse.join("%2C")}&toPage=RcsRichiestaPrestazioniRicercaErogatore&returnPage=PsoEpisodio">
        <select name="URGENZA">
          <option value="" selected>- -</option><option value="1">Rosso</option>
          <option value="2" selected>Arancione</option><option value="3">Azzurro</option>
        </select>
        <textarea name="QUESITO_DIAGNOSTICO">${esc(prefill)}</textarea>
        <input type="hidden" name="CREA_RICH" value="">
        <input name="NOTE" value="">
        <select name="MODALITA"><option value="1" selected>Paziente si reca autonomamente al servizio</option><option value="3">Paziente su lettino o barella</option></select>
        <select name="RISORSA_ID"><option value="" selected>&lt;Seleziona&gt;</option>${options}</select>
        <input type="hidden" name="RICHIESTA_ID" value="${rid}">
        <input type="hidden" name="CLASSE_RICHIESTA" value="PRESTAZIONI">
        <select name="MEDICO"><option value="" selected>&lt;Seleziona Medico&gt;</option><option value="42" selected>DOTTORE PROVA</option></select>
        <input name="PIANIFICAZIONE_DATA" value=""><input name="PIANIFICAZIONE_ORA" value="">
        <input type="submit" name="Update" value="  Crea  ">
        <input type="submit" name="Cancel" value="Chiudi">
      </form>${FOOT}`;
  }

  function listQuery(rid, res, alloc) {
    return `RICHIESTA_ID=${rid}&STRUTTURA=1&EPISODIO_ID=${EP()}&returnPage=PsoEpisodio&PADIGLIONE=&MVPG=RcsRichiestaPrestazioniRicercaErogatore&RISORSE=${alloc.risorse.join("%2C")}&toPage=RcsRichiestaPrestazioniRicercaErogatore&s_PRESTAZIONE=&RISORSA_ID=${res}`;
  }

  function examPage(rid, res, search) {
    const alloc = state.allocated[rid];
    const r = state.richieste[rid];
    const cat = CATALOG[res] || {};
    const common = `STRUTTURA=1&EPISODIO_ID=${EP()}&returnPage=PsoEpisodio&RISORSE=${alloc.risorse.join("%2C")}&RICHIESTA_ID=${rid}&PADIGLIONE=&toPage=RcsRichiestaPrestazioniRicercaErogatore&s_PRESTAZIONE=`;
    const rows = [];
    let inIdx = 0;
    const IN = [];
    for (let [code, label] of Object.entries(cat)) {
      if (opts.mislabel?.[code]) label = opts.mislabel[code];
      // the other site writes the same exam with an en dash, and sometimes
      // with one different word, keeping the LIS mnemonic
      // exactly what the two real sites differ by: an en dash, and one word
      // changed while the LIS mnemonic stays (VENOSA → CAPILLARE, POC2117)
      if (opts.altroPresidio) label = label.replace(/ - /, " – ").replace(/EMOGASANALISI VENOSA/, "EMOGASANALISI CAPILLARE");
      if (search && !label.toUpperCase().includes(search.toUpperCase())) continue;
      inIdx++;
      IN.push(`<input type="hidden" name="IN_PRESTAZIONE_ID_${inIdx}" value="${String(code).padStart(8, "0")}"><input type="hidden" name="IN_RISORSA_ID_${inIdx}" value="${res}">`);
      const inCart = r && r.cart.has(String(code));
      const hidden = state.lagLeft[code] > 0; // lag: row still shows Insert even though the cart has it
      if (inCart && !hidden) {
        rows.push(`<tr><td><a class="AFCDataLink" href="menuPsoEpisodio.do?Delete=Elimina&${common}&RISORSA_ID=${res}&MVPG=RcsRichiestaCarrelloSvuota&toPG=RcsRichiestaPrestazioniRicercaErogatore&ccsForm=RichiestaCarrelloElimina&PRESTAZIONE=${code}">0-${code} ${esc(label)}</a></td></tr>`);
      } else {
        rows.push(`<tr><td><a class="AFCDataLink" href="menuPsoEpisodio.do?toPG=RcsRichiestaPrestazioniRicercaErogatore&PADIGLIONE=&Insert=Inserisci&MVPG=RcsRichiestaCarrelloAggiungi&BRANCA=0&ccsForm=RichiestaCarrelloAggiungi&PRESTAZIONE=${code}&RICHIESTA_ID=${rid}&RISORSA_ID=${res}&s_PRESTAZIONE=&STRUTTURA=1&EPISODIO_ID=${EP()}&returnPage=PsoEpisodio&RISORSE=${alloc.risorse.join(",")}&toPage=RcsRichiestaPrestazioniRicercaErogatore">0-${code} ${esc(label)}</a></td></tr>`);
      }
    }
    const etichetta = (x) => (opts.resLabels && opts.resLabels[x]) || RES_LABEL[x];
    const options = alloc.risorse.map((x) => `<option value="${x}" ${x === res ? "selected" : ""}>${esc(etichetta(x))}</option>`).join("");
    // NB: the cart-wide "svuota" link (Delete without PRESTAZIONE) is a trap the
    // client must not mistake for an exam row.
    return `${HEAD}
      <form name="RefertiImposta" method="post" action="menuPsoEpisodio.do?ccsForm=RefertiImposta:Edit&STRUTTURA=1&MVPG=RcsRichiestaPrestazioniRicercaErogatore&EPISODIO_ID=${EP()}"></form>
      <form name="RisorsaFiltro" method="post" action="menuPsoEpisodio.do?ccsForm=RisorsaFiltro:Edit&STRUTTURA=1&MVPG=RcsRichiestaPrestazioniRicercaErogatore&EPISODIO_ID=${EP()}&RISORSE=${alloc.risorse.join("%2C")}&RICHIESTA_ID=${rid}&s_PRESTAZIONE=&RISORSA_ID=${res}">
        <select name="RISORSA_ID"><option value="" selected>&lt;Seleziona&gt;</option>${options}</select>
        <input style="TEXT-TRANSFORM: uppercase" class="AFCInput" value="${esc(search || "")}" name="s_PRESTAZIONE">
        <input class="AFCButton" value="Cerca" type="submit" name="DoSearch">
      </form>
      <a class="AFCDataLink" href="menuPsoEpisodio.do?Delete=Elimina&${common}&RISORSA_ID=${res}&MVPG=RcsRichiestaCarrelloSvuota&toPG=RcsRichiestaPrestazioniRicercaErogatore&ccsForm=RichiestaCarrelloElimina">Svuota carrello</a>
      <form name="Prestazioni" method="post" action="menuPsoEpisodio.do?ccsForm=Prestazioni:Edit&STRUTTURA=1&MVPG=RcsRichiestaPrestazioniRicercaErogatore&EPISODIO_ID=${EP()}&RISORSE=${alloc.risorse.join("%2C")}&RICHIESTA_ID=${rid}&s_PRESTAZIONE=&RISORSA_ID=${res}">
        <input type="hidden" name="MVPG" value="RcsStampaEtichetteLIS">
        <input type="hidden" name="RETURNPAGE" value="PsoEpisodio">
        <input type="submit" name="Update" value="Conferma"><input type="submit" name="Cancel" value="Chiudi">
        <table>${rows.join("\n")}</table>
        ${IN.join("")}
        <input type="submit" name="Update1" value="Conferma"><input type="submit" name="Cancel1" value="Chiudi">
      </form>${FOOT}`;
  }

  // the ER worklist: no patient open — classified like a patient page (it has
  // the same shell form) but with nothing that can be ordered
  const worklistPage = () => `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>PRONTO SOCCORSO - LISTA</title></head><body>
      <form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&MVPG=PsoLista"></form>
      <table>
        <tr><td><a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP0}">ROSSI MARIO</a></td></tr>
        <tr><td><a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=999002">BIANCHI ANNA</a></td></tr>
      </table></body></html>`;
  const loginPage = () => `${HEAD}<form name="Login" method="post" action="login.do"><input name="username"><input type="password" name="password"><input type="submit" value="Accedi"></form>${FOOT}`;
  const labelsPage = (rid) => `${HEAD}<h1>Stampa etichette LIS</h1><p>richiesta ${rid} confermata</p>
      ${opts.labelsBare ? "" : rowsFor(rid).join("\n")}
      <a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP()}">Chiudi</a>${FOOT}`;
  const notFound = (msg) => `${HEAD}<h1>Pagina non prevista dal mock</h1><p>${esc(msg)}</p>${FOOT}`;

  // -------------------------------------------------------------- handler
  // Takes {method, url, bodyBuffer} and returns {status, headers, body(Buffer)}.
  function handle({ method, url, bodyBuffer }) {
    if (opts.altroPresidio) {   // the client speaks this site's ids: translate back
      let v = url;
      for (const [canonico, locale] of Object.entries(ALTRO_PRESIDIO)) v = v.split(locale).join(canonico);
      v = v.replace(/([?&])PRESTAZIONE=(\d+)/g, (m, sep, c) => `${sep}PRESTAZIONE=${Cback(c)}`);
      url = v;
    }
    const u = new URL(url);
    const params = u.searchParams;
    const rec = { method, url, params: Object.fromEntries(params.entries()) };
    if (bodyBuffer?.length) { rec.form = decodeFormBody(bodyBuffer); rec.rawBody = bodyBuffer.toString("latin1"); }
    state.requests.push(rec);

    const traduci = (html) => {
      if (!opts.altroPresidio) return html;
      let out = html;
      for (const [canonico, locale] of Object.entries(ALTRO_PRESIDIO)) out = out.split(canonico).join(locale);
      out = out.replace(/([?&])PRESTAZIONE=(\d+)/g, (m, sep, c) => `${sep}PRESTAZIONE=${C(c)}`);
      out = out.replace(/>(\d+)-(\d+) /g, (m, b, c) => `>${b}-${C(c)} `);
      out = out.replace(/name="IN_PRESTAZIONE_ID_(\d+)" value="(\d+)"/g,
        (m, i, c) => `name="IN_PRESTAZIONE_ID_${i}" value="${C(String(Number(c))).padStart(8, "0")}"`);
      return out;
    };
    const respond = (html, status = 200, headers = {}) => ({
      status,
      headers: { "content-type": "text/html; charset=windows-1252", ...headers },
      body: encodeWin1252(traduci(html)),
    });
    const redirect = (loc) => ({ status: 302, headers: { location: traduci(loc) }, body: Buffer.alloc(0) });
    const pageOrRedirect = (html, loc) => (state.directRender ? respond(html) : redirect(loc));

    if (state.requests.length > state.expireAfter) return respond(loginPage());

    // ---- print endpoints (audited paths) ----
    const pdf = () => ({ status: 200, headers: { "content-type": "application/pdf" }, body: TINY_PDF });
    // blobViewers: field-observed behavior — the endpoint is an HTML viewer
    // whose SCRIPT builds the PDF blob and navigates to it (address becomes
    // blob:…). URLs are assembled dynamically so naive scraping can't find
    // them, and a framebuster proves the client sandbox holds.
    // blobViewers: an HTML viewer whose INLINE script builds the PDF blob
    // (caught by the app's short sandboxed replay). hardViewer: a viewer whose
    // script needs the REAL URL's query (location.search) to build the PDF —
    // it can't be replayed off-URL, modelling the field case where capture
    // fails and the app must fall back to opening the viewer in a tab.
    const blobViewer = (innerPath, query) => respond(`${HEAD}
      <script>
        try { if (top !== self) top.location.href = 'about:blank'; } catch (e) {}
        var a = '${innerPath.slice(0, 8)}' + '${innerPath.slice(8)}';
        fetch(a + '${query}').then(function (r) { return r.blob(); }).then(function (b) {
          location.replace(URL.createObjectURL(new Blob([b], { type: 'application/pdf' })));
        });
      <\/script>caricamento referto...${FOOT}`);
    const hardViewer = (innerPath) => respond(`${HEAD}
      <script>
        try { if (top !== self) top.location.href = 'about:blank'; } catch (e) {}
        // only builds the PDF when running at its OWN url (marker present) —
        // a replay in the host page's context can't reproduce that, modelling
        // the field viewer whose script needs its real URL.
        if (/Sa4ViewerExtRedirect|EtichetteLISHMIMU/i.test(location.href)) {
          fetch('${innerPath}' + location.search).then(function (r) { return r.blob(); }).then(function (b) {
            location.replace(URL.createObjectURL(new Blob([b], { type: 'application/pdf' })));
          });
        }
      <\/script>caricamento…${FOOT}`);
    const uploadViewer = (rid, prog) => respond(`${HEAD}
      <script>
        try { if (top !== self) top.location.href = 'about:blank'; } catch (e) {}
        var rep = 'PSOWEB_HL7_2026001' + '${String(rid).slice(-4)}${prog}';
        location.replace("/UploadDownload/uploaddownloadservlet.rra2?table=DUAL&blobfield=san_report_onthefly.get_pdf(%27" + rep + "%27)&wherecondition=where%201=1&dataSource=jdbc/sa4web&mimetype=application/pdf");
      <\/script>attendere…${FOOT}`);
    if (u.pathname.includes("/UploadDownload/uploaddownloadservlet.rra2")) {
      return (params.get("mimetype") || "").includes("pdf") ? pdf() : respond(notFound("mimetype non pdf"), 404);
    }
    // frameset viewer: the pdf lives in a <frame src>, as old apps do
    const framesetViewer = (rid, prog) => respond(`<html><head><title>Etichette</title></head>
      <frameset rows="*"><frame src="/UploadDownload/uploaddownloadservlet.rra2?table=DUAL&amp;blobfield=san_report_onthefly.get_pdf(%27PSOWEB_HL7_2026001${String(rid).slice(-4)}${prog}%27)&amp;wherecondition=where%201=1&amp;dataSource=jdbc/sa4web&amp;mimetype=application/pdf"></frameset></html>`);
    // id-only viewer: no whole URL and no navigation we can reproduce — only
    // the report id and the endpoint name appear in the page
    const idOnlyViewer = (rid, prog) => respond(`${HEAD}
      <script>
        var rep = 'PSOWEB_HL7_2026001${String(rid).slice(-4)}${prog}';
        function show(){ /* uploaddownloadservlet.rra2 · san_report_onthefly.get_pdf */
          if (!window.__viewerReady) return; buildAndGo(rep);
        }
      <\/script>caricamento…${FOOT}`);
    if (u.pathname.endsWith("RcsStampaEtichetteLISHMIMU.do")) {
      if (opts.framesetViewer) return framesetViewer(params.get("RICHIESTA_ID"), params.get("RICHIESTA_PROG"));
      if (opts.idOnlyViewer) return idOnlyViewer(params.get("RICHIESTA_ID"), params.get("RICHIESTA_PROG"));
      if (opts.uploadViewer) return uploadViewer(params.get("RICHIESTA_ID"), params.get("RICHIESTA_PROG"));
      if (opts.hardViewer) return hardViewer("/jasperserverSAN/jasperservlet");
      if (opts.blobViewers) return blobViewer("/jasperserverSAN/jasperservlet", `?PROJECT=sa4rcs&REPORT=RcsEtichetteLIS&RICHIESTA_ID=${params.get("RICHIESTA_ID")}&RICHIESTA_PROG=${params.get("RICHIESTA_PROG")}`);
      if (opts.etichetteWrapper) {
        // installations that answer with a plain HTML wrapper linking the PDF
        return respond(`${HEAD}<p>Etichette pronte</p><a href="/jasperserverSAN/jasperservlet?PROJECT=sa4rcs&REPORT=RcsEtichetteLIS&RICHIESTA_ID=${params.get("RICHIESTA_ID")}">Apri PDF</a>${FOOT}`);
      }
      return pdf();
    }
    if (u.pathname.includes("/jasperserverSAN/jasperservlet")) {
      return params.get("REPORT") ? pdf() : respond(notFound("jasperservlet senza REPORT"), 404);
    }
    if (u.pathname.includes("/sa4rcs/restrict/RcsAccessiRisultatiElenco.do")) {
      return respond(risultatiPage(params.get("RCS_ACCESSO_ID") || ""));
    }
    if (u.pathname.includes("/sa4/restrict2/refertostream")) {
      return params.get("REFERTO_ID") ? pdf() : respond(notFound("stream senza REFERTO_ID"), 404);
    }
    if (u.pathname.includes("/sa4/restrict2/Sa4ViewerExtRedirect.do")) {
      if (!params.get("REFERTO_ID")) return respond(`${HEAD}<h1>Archivio documenti</h1>${FOOT}`);
      // the radiology report carries readable text, like the real RIS one
      if ((params.get("REFERTO_SISTEMA") || "").includes("RIS")) {
        return { status: 200, headers: { "content-type": "application/pdf" }, body: refertoRxPdf() };
      }
      if (opts.blobViewers) return blobViewer("/sa4/restrict2/refertostream", `?REFERTO_ID=${params.get("REFERTO_ID")}`);
      return pdf();
    }

    if (!u.pathname.endsWith("menuPsoEpisodio.do")) return respond(notFound(u.pathname), 404);

    const mvpg = params.get("MVPG") || "";
    const ccs = params.get("ccsForm") || "";

    if (method === "POST" && ccs.startsWith("RICHIESTACrea")) {
      const f = rec.form || {};
      const rid = f.RICHIESTA_ID;
      const alloc = state.allocated[rid];
      if (!alloc) return respond(notFound("richiesta non allocata " + rid));
      if (!("Update" in f)) return respond(notFound("submit Update mancante"));
      if ("Cancel" in f || "Cancel1" in f) return respond(notFound("Cancel co-inviato con Update: bug del serializzatore"));
      if (!(f.QUESITO_DIAGNOSTICO || "").trim()) return respond(creaPage(params)); // server re-renders the form
      const cart = new Map();
      if (opts.preloadCart) cart.set(String(opts.preloadCart.code), opts.preloadCart.res);   // leftover from an earlier attempt
      state.richieste[rid] = { quesito: f.QUESITO_DIAGNOSTICO, urgenza: f.URGENZA, modalita: f.MODALITA, medico: f.MEDICO, cart, confirmed: false };
      const res0 = alloc.risorse[0];
      return pageOrRedirect(examPage(rid, res0), `${ORIGIN}${PATH}?${listQuery(rid, res0, alloc)}`);
    }

    if (method === "POST" && ccs.startsWith("Prestazioni")) {
      if (opts.confirmFails) return respond(`${HEAD}<h1>Errore interno del server</h1><p>La richiesta non \u00e8 stata elaborata.</p>${FOOT}`, 500);
      const f = rec.form || {};
      const rid = params.get("RICHIESTA_ID");
      const r = state.richieste[rid];
      if (!r) return respond(notFound("conferma su richiesta inesistente"));
      if (!("Update" in f) && !("Update1" in f)) return respond(notFound("conferma senza submit"));
      if ("Cancel" in f || "Cancel1" in f) return respond(notFound("Cancel co-inviato con Update: bug del serializzatore"));
      if (f.MVPG !== "RcsStampaEtichetteLIS") return respond(notFound("MVPG nascosto mancante"));
      r.confirmed = true;
      // Field-observed default: after Conferma the server goes back to the
      // PATIENT page. labelsInterstitial simulates a deployment with an
      // intermediate label page instead.
      if (opts.labelsInterstitial) return respond(labelsPage(rid));
      return pageOrRedirect(patientPage(), `${ORIGIN}${PATH}?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP()}`);
    }

    if (params.get("Insert") === "Inserisci" && mvpg === "RcsRichiestaCarrelloAggiungi") {
      const rid = params.get("RICHIESTA_ID");
      const code = params.get("PRESTAZIONE");
      const res = params.get("RISORSA_ID");
      const r = state.richieste[rid];
      if (!r) return respond(notFound("insert su richiesta inesistente"));
      state.insertCount[`${rid}:${code}`] = (state.insertCount[`${rid}:${code}`] || 0) + 1;
      if (!(opts.neverAdd || []).includes(code)) r.cart.set(String(code), res);
      const alloc = state.allocated[rid];
      return pageOrRedirect(examPage(rid, res), `${ORIGIN}${PATH}?${listQuery(rid, res, alloc)}`);
    }

    if (params.get("Delete") === "Elimina") {
      const rid = params.get("RICHIESTA_ID");
      const code = params.get("PRESTAZIONE");
      const r = state.richieste[rid];
      if (r && code) r.cart.delete(String(code));
      else if (r) r.cart.clear();
      const alloc = state.allocated[rid];
      const res = params.get("RISORSA_ID");
      return pageOrRedirect(examPage(rid, res), `${ORIGIN}${PATH}?${listQuery(rid, res, alloc)}`);
    }

    if (mvpg === "RcsRichiestaPrestazioniRicercaErogatore") {
      const rid = params.get("RICHIESTA_ID");
      if (!state.richieste[rid]) return respond(notFound("lista su richiesta inesistente " + rid));
      const res = params.get("RISORSA_ID");
      const html = examPage(rid, res, params.get("s_PRESTAZIONE") || "");
      // one list render consumed per lagging exam
      for (const k of Object.keys(state.lagLeft)) if (state.lagLeft[k] > 0) state.lagLeft[k]--;
      return respond(html);
    }

    if (mvpg === "PsoLista") return respond(worklistPage());
    if (mvpg === "PsoRichiestaCreaRcs") return respond(creaPage(params));
    if (mvpg === "PsoEpisodioClinicoAmbulatorio" || !mvpg) return respond(patientPage());

    return respond(notFound("MVPG " + mvpg), 404);
  }

  return { state, handle, ORIGIN, PATH, worklistUrl: `${ORIGIN}${PATH}?MVPG=PsoLista`, patientUrl: `${ORIGIN}${PATH}?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP()}` };
}
