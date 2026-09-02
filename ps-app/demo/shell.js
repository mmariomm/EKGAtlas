/*
 * Banco di prova — the saved gestionale, in one page.
 *
 * Nothing here is a re-implementation. The pages come from esempi-gestionale/
 * (the REAL saved SA4PSO html, with every piece of content replaced by
 * invented data — see tools/esempi.mjs), the panel is the built extension
 * (extension/content.js), and this file is only the missing browser: it
 * answers navigation and fetch from those pages, keeps the small amount of
 * state an order needs, and re-runs the panel on every page load.
 *
 * The one promise it enforces by construction: nothing leaves this page.
 * Same-origin requests are served from memory; everything else — any host,
 * XHR, WebSocket, EventSource, beacon — throws instead of being sent.
 */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  // Embedded source runs as an injected inline <script>, never eval/new
  // Function, so the banco works under any Content-Security-Policy (it
  // inherits the nonce of this very script when the host uses one).
  const NONCE = (document.currentScript && document.currentScript.nonce) || "";
  const runScript = (src) => {
    const el = document.createElement("script");
    if (NONCE) el.nonce = NONCE;
    el.textContent = src;
    document.body.appendChild(el);
    el.remove();
  };
  const decodeB64 = (id) => {
    const raw = atob(document.getElementById(id).textContent.trim());
    return new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
  };
  const BASE = "/sa4pso/restrict/menuPsoEpisodio.do";

  // Some hosts (a sandboxed frame, a browser set to block site data) throw on
  // storage. The panel treats that as "nothing saved" and would lose its
  // per-tab handoffs, so give it memory that works everywhere.
  for (const name of ["localStorage", "sessionStorage"]) {
    try { window[name].setItem("__psa", "1"); window[name].removeItem("__psa"); continue; } catch (e) { /* shim below */ }
    const m = new Map();
    const shim = {
      getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => { m.set(String(k), String(v)); },
      removeItem: (k) => { m.delete(String(k)); },
      clear: () => m.clear(),
      key: (i) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    };
    try { Object.defineProperty(window, name, { configurable: true, get: () => shim }); } catch (e) { /* nothing else to try */ }
  }

  // ---------------------------------------------------------------- pages
  // esempi-gestionale/, embedded at build time: { pagine, icone, css }
  const E = JSON.parse(decodeB64("psa-esempi"));
  const PAZIENTI = [
    { ep: "700001", nome: "ROSSI MARIO", pagina: "paziente-1", tri: "arancione", motivo: "Dolore toracico", eta: 68, arrivo: "07:12", letto: "B3" },
    { ep: "700003", nome: "BIANCHI ANNA", pagina: "paziente-2", tri: "azzurro", motivo: "Dolore addominale", eta: 34, arrivo: "08:40", letto: "A1" },
  ];
  const byEp = (ep) => PAZIENTI.find((p) => p.ep === ep);

  // resource id → the saved catalogue for that laboratory / radiology
  const CATALOGHI = {
    "00660001P": "esami-poc", "00130001P": "esami-centrale", "00720001P": "esami-urgenze",
    "00120001P": "esami-rx", "00400001P": "esami-rx", "00360001P": "esami-rx", "00380001P": "esami-rx",
  };
  const RADIO = new Set(["00120001P", "00400001P", "00360001P", "00380001P"]);

  // what this visit has ordered so far: richiesta → { risorsa, carrello, confermata }
  let carrelli = new Map();
  let prossimaRichiesta = 800200;
  let labCompletato = false;   // the harness switch below flips it
  const pagina = (nome) => E.pagine[nome] || "";

  // A saved page belongs to the visit it was captured in. The real server
  // renders it for the visit you are in, so the banco rewrites the episode and
  // the richiesta before serving it — otherwise the panel's wrong-patient guard
  // fires, correctly, on a catalogue captured for somebody else.
  function perVisita(html, ep, rid) {
    if (ep) html = html.replace(/EPISODIO_ID=\d+/g, "EPISODIO_ID=" + ep);
    if (rid) {
      html = html.replace(/RICHIESTA_ID=\d+/g, "RICHIESTA_ID=" + rid)
                 .replace(/(<input[^>]*name="RICHIESTA_ID"[^>]*)value="\d+"/gi, `$1value="${rid}"`)
                 .replace(/(value=")\d+("[^>]*name="RICHIESTA_ID")/gi, `$1${rid}$2`);
    }
    return html;
  }
  const icone = (html) => html.replace(/src="icona:([^"]*)"/g, (m, n) => `src="${E.icone[n] || "data:,"}"`);

  // The label of an exam, read from the catalogue page it lives in: the printed
  // documents show names, not codes.
  function etichettaEsame(risorsa, code) {
    const html = pagina(CATALOGHI[risorsa] || "esami-poc");
    const m = new RegExp(`<a[^>]*PRESTAZIONE=${code}(?:&amp;|&)[^>]*>([\\s\\S]{0,300}?)</a>`, "i").exec(html);
    const testo = m ? m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";
    return testo || `prestazione ${code}`;
  }

  // referto id → what that document is, taken from the row it sits in
  let refertiIndice = null;
  function etichettaReferto(id) {
    if (!refertiIndice) {
      refertiIndice = new Map();
      for (const nome of Object.keys(E.pagine)) {
        const html = E.pagine[nome];
        const re = /title="([^"]{3,90})"[\s\S]{0,600}?REFERTO_ID=([\w-]+)/g;
        let m;
        while ((m = re.exec(html))) if (!refertiIndice.has(m[2])) refertiIndice.set(m[2], m[1]);
      }
    }
    return refertiIndice.get(id) || "Documento clinico";
  }

  // A saved exam page is static: mark the rows that are in the cart by turning
  // their Insert link into the Delete link the application would render — which
  // is exactly what the panel reads back to verify what it added.
  function applicaCarrello(html, rid) {
    const c = carrelli.get(rid);
    if (!c || !c.carrello.size) return html;
    for (const code of c.carrello) {
      const re = new RegExp(`(<a[^>]*href=")([^"]*?PRESTAZIONE=${code}(?:&amp;|&)[^"]*?)(")`, "g");
      html = html.replace(re, (m, a, href, b) => {
        if (!/Insert=Inserisci/.test(href)) return m;
        return a + href
          .replace(/Insert=Inserisci/, "Delete=Elimina")
          .replace(/MVPG=RcsRichiestaCarrelloAggiungi/, "MVPG=RcsRichiestaCarrelloSvuota")
          .replace(/ccsForm=RichiestaCarrelloAggiungi/, "ccsForm=RichiestaCarrelloElimina") + b;
      });
    }
    return html;
  }

  // The only page nobody ever saved: of the gestionale we have patient screens,
  // not the ward list. Built with the application's own classes so it sits in
  // the same world as the rest.
  function listaPS() {
    const righe = PAZIENTI.map((p) => `
      <tr>
        <td class="AFCDataTD"><b class="tri ${p.tri}">${p.tri}</b></td>
        <td class="AFCDataTD"><a class="AFCDataLink" href="${BASE}?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${p.ep}"><b>${p.nome}</b></a></td>
        <td class="AFCDataTD">${p.eta}</td><td class="AFCDataTD">${p.motivo}</td>
        <td class="AFCDataTD">${p.arrivo}</td><td class="AFCDataTD">${p.letto}</td><td class="AFCDataTD">${p.ep}</td>
      </tr>`).join("");
    return `<html><head><title>PRONTO SOCCORSO - LISTA</title></head><body class="AFCPageBODY">
      <form name="AmbulatorioPSO" method="post" action="${BASE}?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=PsoLista"></form>
      <table width="100%" cellspacing="0" cellpadding="3" border="0">
        <tbody>
        <tr><td class="AFCColumnTD">Triage</td><td class="AFCColumnTD">Assistito</td><td class="AFCColumnTD">Et&agrave;</td>
            <td class="AFCColumnTD">Motivo</td><td class="AFCColumnTD">Arrivo</td><td class="AFCColumnTD">Postazione</td>
            <td class="AFCColumnTD">Episodio</td></tr>
        ${righe}
        </tbody>
      </table>
      <p class="psa-nota">Unica pagina ricostruita: del gestionale erano state salvate le schede paziente, non la lista del reparto. Tutto il resto che vedi è la pagina vera.</p>
      </body></html>`;
  }

  const nonSalvata = (url) => `<html><head><title>PAGINA NON SALVATA</title></head><body class="AFCPageBODY">
      <table width="100%" cellspacing="0" cellpadding="3"><tbody>
      <tr><td class="AFCColumnTD">Pagina non presente negli esempi</td></tr>
      <tr><td class="AFCDataTD">
        <p>Di questa schermata non era stato salvato l'HTML, quindi il banco non la può mostrare. Nel gestionale vero il collegamento funziona.</p>
        <p class="psa-nota">${String(url).replace(/[<&"]/g, "")}</p>
        <p><a class="AFCDataLink" href="${BASE}?MVPG=PsoLista">Torna alla lista PS</a></p>
      </td></tr></tbody></table></body></html>`;

  // a structurally valid one-page PDF: the print flow needs bytes, not content
  const PDF = (() => {
    const s = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
      + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 150]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  })();
  // The panel reads the patient's name from <title>, exactly like at work, so
  // every page of a visit carries the name of the patient you are on — the
  // saved catalogues came from other visits and must not contradict it.
  let pazienteCorrente = PAZIENTI[0];
  const conTitolo = (html, titolo) => (titolo ? html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${titolo}</title>`) : html);
  const html200 = (html, titolo) => ({
    status: 200, headers: { "content-type": "text/html; charset=utf-8" },
    body: icone(conTitolo(html, titolo)),
  });
  const pdf200 = (bytes) => ({ status: 200, headers: { "content-type": "application/pdf" }, body: bytes || PDF });
  const vai = (loc) => ({ status: 302, headers: { location: loc }, body: new Uint8Array(0) });

  // ------------------------------------------------------------- routing
  function rispondi(rawUrl, init) {
    const u = new URL(rawUrl, location.href);
    const q = u.searchParams;
    const path = u.pathname;
    const metodo = (init.method || "GET").toUpperCase();
    const form = new URLSearchParams(typeof init.body === "string" ? init.body : "");

    // --- the documents the print flow produces, drawn for real
    if (/RcsStampaEtichetteLISHMIMU\.do/i.test(path)) {
      const c = carrelli.get(q.get("RICHIESTA_ID") || "");
      return pdf200(PSA_PDF.etichette({
        paziente: pazienteCorrente.nome, episodio: pazienteCorrente.ep,
        richiesta: q.get("RICHIESTA_ID") || "-", esami: c ? [...c.etichette.values()] : [],
      }));
    }
    if (/jasperservlet/i.test(path)) {
      const c = carrelli.get(q.get("RICHIESTA_ID") || "");
      const radio = /Radiograf/i.test(q.get("REPORT") || "");
      return pdf200(PSA_PDF.lista({
        titolo: radio ? "Prenotazione radiologica" : "Richiesta di laboratorio",
        paziente: pazienteCorrente.nome, episodio: pazienteCorrente.ep,
        richiesta: q.get("RICHIESTA_ID") || "-", quesito: (c && c.quesito) || "",
        esami: c ? [...c.etichette.values()] : [],
      }));
    }
    // "Storico Dati Clinici" — the portal page with every draw side by side.
    // Here it is the rebuilt one (invented exams): the panel reads it exactly
    // as it reads the real one, and nothing is asked of anybody.
    if (/MODALITA=CLINICA/i.test(u.search)) {
      return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: pagina("storico") };
    }
    if (/Sa4ViewerExtRedirect\.do|refertostream|uploaddownloadservlet/i.test(path)) {
      const id = q.get("REFERTO_ID") || "";
      const titolo = etichettaReferto(id);
      // radiology reports carry readable text, like the real RIS ones: the
      // panel shows them inside itself
      if (/RIS/i.test(q.get("REFERTO_SISTEMA") || "") || /\bTC\b|RX|RADIOGRAF|ECOGRAF/i.test(titolo)) {
        return pdf200(PSA_PDF.referto({
          paziente: pazienteCorrente.nome, episodio: pazienteCorrente.ep, titolo,
          righe: [
            "Quesito Diagnostico: dolore addominale",
            titolo,
            "Non falde fluide libere in addome. Anse non distese.",
            "Reni in sede, non idronefrosi. Milza nei limiti.",
            "Conclusioni: quadro nei limiti per l'età.",
            "Il Medico DOTTORE ESEMPIO 1",
          ],
        }));
      }
      return pdf200(PSA_PDF.referto({
        paziente: pazienteCorrente.nome, episodio: pazienteCorrente.ep, titolo,
        righe: [
          "Esito: nella norma per i parametri considerati.",
          "Nota: documento generato dal banco di prova, contenuto inventato.",
          "",
          `Identificativo documento: ${id || "-"}`,
        ],
      }));
    }
    if (/RcsAccessiRisultatiElenco\.do/i.test(path)) {
      const id = q.get("RCS_ACCESSO_ID") || "";
      let html = pagina(id.endsWith("2") ? "risultati-2" : "risultati-1");
      // "il laboratorio ha completato": one value moves and one analyte
      // appears, so ↻ Aggiorna has something real to mark
      if (labCompletato) {
        html = html.replace(/(Emoglobina[\s\S]{0,200}?class="AFCDataTD"[^>]*>)\s*80\s*</i, "$192<")
          .replace(/<\/table>/i, `<tr>
            <td class="AFCDataTD">Sodio&nbsp;</td><td class="AFCDataTD">128</td><td class="AFCDataTD">mmol/L</td>
            <td class="AFCDataTD">136 - 145</td><td class="AFCDataTD">definitivo</td><td class="AFCDataTD">23/08/2026 08:10</td>
          </tr></table>`);
      }
      return html200(html, pazienteCorrente.nome);
    }
    if (!/menuPsoEpisodio\.do/i.test(path) && path !== "/" && !/\.html?$/i.test(path)) return html200(nonSalvata(u.href));

    const mvpg = q.get("MVPG") || "";
    const ccs = q.get("ccsForm") || "";
    const ep = q.get("EPISODIO_ID") || "";
    if (ep && byEp(ep)) pazienteCorrente = byEp(ep);

    // create a richiesta → the application lands on the first resource's list
    if (metodo === "POST" && ccs.startsWith("RICHIESTACrea")) {
      const rid = form.get("RICHIESTA_ID") || String(prossimaRichiesta++);
      const nota = carrelli.get(rid);
      const risorse = (nota && nota.risorse) || (q.get("RISORSE") || "00660001P").split(",");
      carrelli.set(rid, {
        risorsa: risorse[0], carrello: new Set(), etichette: new Map(), confermata: false,
        ep: ep || pazienteCorrente.ep, risorse, quesito: form.get("QUESITO_DIAGNOSTICO") || (nota && nota.quesito) || "",
      });
      return vai(`${BASE}?MVPG=RcsRichiestaPrestazioniRicercaErogatore&RICHIESTA_ID=${rid}&RISORSA_ID=${risorse[0]}`
        + `&RISORSE=${risorse.join("%2C")}&EPISODIO_ID=${ep}&STRUTTURA=1&s_PRESTAZIONE=&returnPage=PsoEpisodio`);
    }
    // Conferma → back to the patient page, like the real server
    if (metodo === "POST" && ccs.startsWith("Prestazioni")) {
      const rid = q.get("RICHIESTA_ID") || "";
      const c = carrelli.get(rid);
      if (c) c.confermata = true;
      return vai(`${BASE}?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${ep || (c && c.ep) || PAZIENTI[0].ep}`);
    }
    if (q.get("Insert") === "Inserisci" || q.get("Delete") === "Elimina") {
      const rid = q.get("RICHIESTA_ID") || "";
      const code = q.get("PRESTAZIONE");
      const risorsa = q.get("RISORSA_ID") || "00660001P";
      const c = carrelli.get(rid) || { risorsa, carrello: new Set(), etichette: new Map(), confermata: false, ep };
      if (!c.etichette) c.etichette = new Map();
      carrelli.set(rid, c);
      if (q.get("Insert")) { c.carrello.add(String(code)); c.etichette.set(String(code), etichettaEsame(risorsa, code)); }
      else if (code) { c.carrello.delete(String(code)); c.etichette.delete(String(code)); }
      else { c.carrello.clear(); c.etichette.clear(); }
      c.risorsa = risorsa;
      return html200(perVisita(applicaCarrello(pagina(CATALOGHI[risorsa] || "esami-poc"), rid), c.ep || ep, rid), pazienteCorrente.nome);
    }
    if (mvpg === "RcsRichiestaPrestazioniRicercaErogatore") {
      const rid2 = q.get("RICHIESTA_ID") || "";
      const c2 = carrelli.get(rid2);
      return html200(perVisita(applicaCarrello(pagina(CATALOGHI[q.get("RISORSA_ID")] || "esami-poc"), rid2), (c2 && c2.ep) || ep || pazienteCorrente.ep, rid2), pazienteCorrente.nome);
    }
    if (mvpg === "PsoRichiestaCreaRcs") {
      const risorse = (q.get("RISORSE") || "00660001P").split(",");
      const radio = risorse.some((r) => RADIO.has(r));
      const rid = String(prossimaRichiesta++);
      carrelli.set(rid, { risorsa: risorse[0], carrello: new Set(), etichette: new Map(), confermata: false, ep: ep || pazienteCorrente.ep, risorse });
      return html200(perVisita(pagina(radio ? "crea-radiologia" : "crea-laboratorio"), ep || pazienteCorrente.ep, rid), pazienteCorrente.nome);
    }
    if (mvpg === "PsoLista" || (!mvpg && !ep)) return html200(listaPS());
    if (mvpg === "PsoEpisodioClinicoAmbulatorio" || ep) {
      pazienteCorrente = byEp(ep) || pazienteCorrente;
      let html = pagina(pazienteCorrente.pagina);
      // A confirmed richiesta must appear among the printable ones, or the
      // print flow would have nothing of ours to print: the saved page already
      // carries a row group (labels + list, one per laboratory), so it is
      // handed over to the richiesta just confirmed.
      const confermata = [...carrelli.entries()].reverse()
        .find(([, c]) => c.confermata && (!c.ep || c.ep === pazienteCorrente.ep));
      if (confermata) {
        const m = /RcsStampaEtichetteLISHMIMU\.do\?RICHIESTA_ID=(\d+)/i.exec(html);   // attribute order varies
        if (m) html = html.split("RICHIESTA_ID=" + m[1]).join("RICHIESTA_ID=" + confermata[0]);
      }
      return html200(html, pazienteCorrente.nome);
    }
    return html200(nonSalvata(u.href));
  }

  function answer(rawUrl, init = {}) {
    let final = new URL(rawUrl, location.href).href;
    let out = rispondi(final, init);
    for (let hop = 0; out.status === 302 && hop < 5; hop++) {
      final = new URL(out.headers.location, final).href;
      out = rispondi(final, { method: "GET" });
    }
    return { out, final };
  }

  // ------------------------------------------------------------ sealed
  let latency = 120;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const origFetch = window.fetch.bind(window);
  const outside = (what, where) => new TypeError(`banco di prova: ${what} verso l'esterno bloccata (${String(where).slice(0, 80)})`);
  window.fetch = async function (input, init = {}) {
    const raw = typeof input === "string" ? input : (input && input.url) || String(input);
    if (/^(blob:|data:)/i.test(raw)) return origFetch(input, init);
    let u; try { u = new URL(raw, location.href); } catch { throw outside("richiesta", raw); }
    if (u.origin !== location.origin) throw outside("richiesta", u.href);
    if (latency) await sleep(latency);
    const { out, final } = answer(u.href, init);
    const res = new Response(out.body, { status: out.status, headers: out.headers });
    Object.defineProperty(res, "url", { value: final });
    return res;
  };
  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"]) {
    if (!(name in window)) continue;
    try { window[name] = function () { throw outside(name, "—"); }; } catch (e) { /* locked down already */ }
  }
  try { navigator.sendBeacon = () => false; } catch (e) { /* read-only: nothing to send to anyway */ }

  // ------------------------------------------- the extension, simulated
  // The panel asks a service worker to fetch and keep referto PDFs. The same
  // message API answers from memory here, so saving, the green dots, instant
  // reopen and Resetta behave as they do with the extension installed.
  const b64 = (buf) => {
    const by = new Uint8Array(buf); let s = "";
    for (let i = 0; i < by.length; i += 0x8000) s += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const refs = new Map();
  async function estensione(msg) {
    if (!msg || typeof msg !== "object") return { ok: true };
    if (msg.t === "cacheRef") {
      const r = await window.fetch(msg.url);
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("pdf")) return { ok: false, why: "tipo " + (ct.split(";")[0] || "?") };
      const buf = await r.arrayBuffer();
      refs.set(msg.id, { data: b64(buf), ts: Date.now(), size: buf.byteLength, ep: msg.ep || "" });
      return { ok: true, size: buf.byteLength };
    }
    if (msg.t === "getRef") {
      const hit = refs.get(msg.id);
      if (!hit || (msg.ep && hit.ep && hit.ep !== msg.ep)) return { ok: false };
      return { ok: true, data: hit.data };
    }
    if (msg.t === "listRef") {
      const want = Array.isArray(msg.ids) ? new Set(msg.ids) : null;
      const cached = {};
      for (const [id, rec] of refs) {
        if (want && !want.has(id)) continue;
        if (msg.ep && rec.ep && rec.ep !== msg.ep) continue;
        cached[id] = rec.size || 1;
      }
      return { ok: true, cached };
    }
    if (msg.t === "clearRef") { refs.clear(); return { ok: true }; }
    return { ok: false };
  }
  window.chrome = {
    runtime: {
      id: "banco-di-prova",
      lastError: undefined,
      sendMessage(msg, cb) {
        if (msg === "psassist-reload") { reloadPage(); return; }
        estensione(msg).then((r) => { try { cb && cb(r); } catch (e) { console.error(e); } });
      },
    },
  };

  // --------------------------------------------------------- fake tabs
  const tabs = new Map();
  function fakeTab(url, name) {
    const key = name || "_blank";
    let t = tabs.get(key);
    if (!t) {
      const el = document.createElement("div");
      el.className = "psa-tab";
      el.innerHTML = `<header><b></b><button type="button">Chiudi</button></header><div class="note">apertura…</div>`;
      document.body.appendChild(el);
      const frame = document.createElement("iframe");
      frame.title = "Contenuto della scheda";
      const close = () => { el.remove(); tabs.delete(key); if (t.stub) t.stub.closed = true; };
      el.querySelector("button").addEventListener("click", close);
      const swap = (src) => {
        el.querySelector(".note")?.remove();
        if (!frame.isConnected) el.appendChild(frame);
        frame.src = src;
      };
      t = {
        el, frame, close, stub: null,
        async show(u) {
          const label = /^blob:/i.test(u)
            ? "documento PDF · aperto dalla copia salvata"
            : (() => { try { const p = new URL(u, location.href); return p.pathname.split("/").pop() + p.search.slice(0, 40); } catch (e) { return String(u).slice(0, 60); } })();
          el.querySelector("b").textContent = "scheda · " + label;
          if (/^(blob:|data:)/i.test(u)) return swap(u);
          try {
            const r = await window.fetch(u);
            swap(URL.createObjectURL(await r.blob()));
          } catch (e) {
            const n = el.querySelector(".note");
            if (n) n.textContent = "errore: " + e.message;
          }
        },
      };
      t.stub = {
        closed: false, close, focus() {}, print() {}, document: {},
        location: { get href() { return frame.src || "about:blank"; }, set href(u) { t.show(u); } },
      };
      tabs.set(key, t);
    }
    if (url) t.show(url);
    return t.stub;
  }

  // ------------------------------------------------------- the browser
  // Timers and window/document listeners left behind by the previous page are
  // dropped before the next one runs: a real navigation destroys them, and a
  // panel keeping two Esc handlers alive would not behave like the real one.
  const timers = new Set(), listeners = [];
  const oST = window.setTimeout.bind(window), oSI = window.setInterval.bind(window);
  window.setTimeout = (fn, ms, ...a) => { const id = oST(fn, ms, ...a); timers.add(id); return id; };
  window.setInterval = (fn, ms, ...a) => { const id = oSI(fn, ms, ...a); timers.add(id); return id; };
  let recording = false;
  for (const t of [window, document]) {
    const orig = t.addEventListener.bind(t);
    t.addEventListener = (type, fn, opt) => { if (recording) listeners.push([t, type, fn, opt]); orig(type, fn, opt); };
  }
  const wipe = () => {
    for (const id of timers) { clearTimeout(id); clearInterval(id); }
    timers.clear();
    for (const [t, ty, fn, opt] of listeners.splice(0)) { try { t.removeEventListener(ty, fn, opt); } catch (e) { /* gone */ } }
  };

  let coreSrc = "";
  function runCore() {
    document.getElementById("psassist-host")?.remove();
    document.getElementById("psassist-print")?.remove();   // a real page load takes the wizard with it
    document.getElementById("psassist-confirm")?.remove(); // and any countdown
    recording = true;
    try { runScript(coreSrc); } catch (e) { console.error("core:", e); }
  }

  let current = BASE + "?MVPG=PsoLista";
  const navigate = (rawUrl) => render(new URL(rawUrl, location.href).href);
  const reloadPage = () => render(current);

  function render(url) {
    wipe();
    const { out, final } = answer(url, { method: "GET" });
    current = final;
    const html = new TextDecoder().decode(
      typeof out.body === "string" ? new TextEncoder().encode(out.body) : out.body,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    document.title = (doc.title || "SA4PSO").trim();
    const page = $("#sa4-page");
    page.replaceChildren(...doc.body.childNodes);
    const u = new URL(final);
    $(".psa-url").textContent = "simulatore · " + u.pathname.replace("/sa4pso/restrict", "…") + u.search;
    try { history.replaceState(null, "", u.search || "?"); } catch (e) { /* framed: keep going */ }
    window.scrollTo(0, 0);
    runCore();
  }

  // links and form submits inside the simulated app behave like a browser
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("#sa4-page a[href]");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    e.preventDefault();
    if (a.getAttribute("onclick")) { try { a.onclick(e); } catch (err) { console.error(err); } return; }
    if (href.startsWith("#") || /^javascript:/i.test(href)) return;
    navigate(new URL(href, location.href).href);
  });
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!form.closest?.("#sa4-page")) return;
    e.preventDefault();
    const data = new URLSearchParams(new FormData(form));
    const action = new URL(form.getAttribute("action") || location.href, location.href).href;
    const { final } = answer(action, { method: (form.method || "GET").toUpperCase(), body: data.toString() });
    render(final);
  });

  // ------------------------------------------------------- the harness
  window.__PSA_DEMO__ = { nav: (u) => navigate(u), open: (u, name) => fakeTab(u, name) };
  window.open = (u, name) => fakeTab(u, name);   // inline handlers in the saved pages

  function help() {
    const box = document.createElement("div");
    box.className = "psa-help";
    box.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Come usare il banco di prova">
      <h2>Banco di prova</h2>
      <p class="sub">Le pagine vere del gestionale — struttura, stile e icone originali — con dentro dati inventati, e sopra il pannello vero. Niente esce da questa pagina.</p>
      <h3>Cosa funziona</h3>
      <ul>
        <li>Lista PS → apri un assistito → il pannello parte su <b>Richieste</b>.</li>
        <li>Quesito, profili, esami, «Crea e aggiungi»: la richiesta si crea e gli esami finiscono nel carrello della pagina vera.</li>
        <li><b>Esiti</b>: valori dentro il pannello, anteprima a due righe, referti in una finta scheda, «Salva referti» e pallini verdi.</li>
        <li>I collegamenti del gestionale portano alle altre pagine salvate.</li>
      </ul>
      <h3>Cosa no, di proposito</h3>
      <ul>
        <li>Le schermate mai salvate mostrano una pagina di cortesia, non un errore.</li>
        <li>La stampa mostra il PDF ma <b>non apre il dialogo</b>; i PDF sono fogli vuoti.</li>
        <li>Gli script del gestionale sono rimossi: schede e menu interni non si aprono.</li>
      </ul>
      <button class="close" type="button">Ho capito</button></div>`;
    const close = () => box.remove();
    box.querySelector(".close").addEventListener("click", close);
    box.addEventListener("click", (e) => { if (e.target === box) close(); });
    document.addEventListener("keydown", function onEsc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); } });
    document.body.appendChild(box);
    box.querySelector(".close").focus();
  }

  function harness() {
    const bar = document.createElement("div");
    bar.className = "psa-bar";
    bar.innerHTML = `
      <span class="psa-badge">● banco di prova · dati finti</span>
      <span class="psa-build" title="La build del pannello dentro questa pagina"></span>
      <button type="button" id="psa-home">Lista PS</button>
      <button type="button" id="psa-reload">↻ Ricarica</button>
      <button type="button" id="psa-wipe">⌫ Azzera</button>
      <label>rete <select id="psa-net">
        <option value="0">rapida</option><option value="120" selected>reale</option><option value="700">lenta</option>
      </select></label>
      <button type="button" id="psa-lab" title="Il laboratorio completa il pannello: un valore cambia e un esame compare. Poi premi ↻ Aggiorna negli Esiti.">🧪 Nuovi valori</button>
      <button type="button" id="psa-help" aria-label="Come funziona il banco di prova">?</button>
      <span class="psa-url"></span>`;
    const b = window.__PSA_BUILD__ || {};
    bar.querySelector(".psa-build").textContent = "pannello " + (b.version || "?") + (b.built ? " · " + b.built : "");
    document.body.prepend(bar);
    bar.querySelector("#psa-home").addEventListener("click", () => navigate(BASE + "?MVPG=PsoLista"));
    bar.querySelector("#psa-reload").addEventListener("click", reloadPage);
    bar.querySelector("#psa-help").addEventListener("click", help);
    bar.querySelector("#psa-lab").addEventListener("click", (e) => {
      labCompletato = !labCompletato;
      e.target.textContent = labCompletato ? "🧪 Valori aggiornati ✓" : "🧪 Nuovi valori";
    });
    bar.querySelector("#psa-net").addEventListener("change", (e) => { latency = Number(e.target.value); });
    bar.querySelector("#psa-wipe").addEventListener("click", () => {
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* private mode */ }
      refs.clear(); carrelli = new Map(); labCompletato = false;
      for (const t of [...tabs.values()]) t.close();
      navigate(BASE + "?MVPG=PsoLista");
    });
  }

  // ------------------------------------------------------------- start
  const stile = document.createElement("style");
  stile.textContent = E.css || "";
  document.head.appendChild(stile);
  coreSrc = decodeB64("psa-core");
  harness();
  // a reload keeps the page you were on: the query is the real location
  render(location.search && location.search.length > 1 ? BASE + location.search : BASE + "?MVPG=PsoLista");
})();
