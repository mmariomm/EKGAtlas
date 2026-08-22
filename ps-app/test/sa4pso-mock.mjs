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
    30: "GLUCOSIO (POC1250)",
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
export const TINY_PDF = Buffer.from(
  "%PDF-1.4\n" +
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n" +
  "trailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

// ------------------------------------------------------------------ pages
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HEAD = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>ROSSI MARIO</title></head><body>`;
const FOOT = `</body></html>`;

export function createMock(opts = {}) {
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
      ${FOOT}`;
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
  function printRows() {
    return Object.keys(state.richieste)
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
    const options = alloc.risorse.map((x) => `<option value="${x}" ${x === res ? "selected" : ""}>${esc(RES_LABEL[x])}</option>`).join("");
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

  const loginPage = () => `${HEAD}<form name="Login" method="post" action="login.do"><input name="username"><input type="password" name="password"><input type="submit" value="Accedi"></form>${FOOT}`;
  const labelsPage = (rid) => `${HEAD}<h1>Stampa etichette LIS</h1><p>richiesta ${rid} confermata</p>
      ${opts.labelsBare ? "" : rowsFor(rid).join("\n")}
      <a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP()}">Chiudi</a>${FOOT}`;
  const notFound = (msg) => `${HEAD}<h1>Pagina non prevista dal mock</h1><p>${esc(msg)}</p>${FOOT}`;

  // -------------------------------------------------------------- handler
  // Takes {method, url, bodyBuffer} and returns {status, headers, body(Buffer)}.
  function handle({ method, url, bodyBuffer }) {
    const u = new URL(url);
    const params = u.searchParams;
    const rec = { method, url, params: Object.fromEntries(params.entries()) };
    if (bodyBuffer?.length) { rec.form = decodeFormBody(bodyBuffer); rec.rawBody = bodyBuffer.toString("latin1"); }
    state.requests.push(rec);

    const respond = (html, status = 200, headers = {}) => ({
      status,
      headers: { "content-type": "text/html; charset=windows-1252", ...headers },
      body: encodeWin1252(html),
    });
    const redirect = (loc) => ({ status: 302, headers: { location: loc }, body: Buffer.alloc(0) });
    const pageOrRedirect = (html, loc) => (state.directRender ? respond(html) : redirect(loc));

    if (state.requests.length > state.expireAfter) return respond(loginPage());

    // ---- print endpoints (audited paths) ----
    const pdf = () => ({ status: 200, headers: { "content-type": "application/pdf" }, body: TINY_PDF });
    if (u.pathname.endsWith("RcsStampaEtichetteLISHMIMU.do")) {
      if (opts.etichetteWrapper) {
        // some installations answer with an HTML wrapper that links the PDF
        return respond(`${HEAD}<p>Etichette pronte</p><a href="/jasperserverSAN/jasperservlet?PROJECT=sa4rcs&REPORT=RcsEtichetteLIS&RICHIESTA_ID=${params.get("RICHIESTA_ID")}">Apri PDF</a>${FOOT}`);
      }
      return pdf();
    }
    if (u.pathname.includes("/jasperserverSAN/jasperservlet")) return pdf();

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
      state.richieste[rid] = { quesito: f.QUESITO_DIAGNOSTICO, urgenza: f.URGENZA, modalita: f.MODALITA, medico: f.MEDICO, cart: new Map(), confirmed: false };
      const res0 = alloc.risorse[0];
      return pageOrRedirect(examPage(rid, res0), `${ORIGIN}${PATH}?${listQuery(rid, res0, alloc)}`);
    }

    if (method === "POST" && ccs.startsWith("Prestazioni")) {
      const f = rec.form || {};
      const rid = params.get("RICHIESTA_ID");
      const r = state.richieste[rid];
      if (!r) return respond(notFound("conferma su richiesta inesistente"));
      if (!("Update" in f) && !("Update1" in f)) return respond(notFound("conferma senza submit"));
      if ("Cancel" in f || "Cancel1" in f) return respond(notFound("Cancel co-inviato con Update: bug del serializzatore"));
      if (f.MVPG !== "RcsStampaEtichetteLIS") return respond(notFound("MVPG nascosto mancante"));
      r.confirmed = true;
      return respond(labelsPage(rid));
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

    if (mvpg === "PsoRichiestaCreaRcs") return respond(creaPage(params));
    if (mvpg === "PsoEpisodioClinicoAmbulatorio" || !mvpg) return respond(patientPage());

    return respond(notFound("MVPG " + mvpg), 404);
  }

  return { state, handle, ORIGIN, PATH, patientUrl: `${ORIGIN}${PATH}?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${EP()}` };
}
