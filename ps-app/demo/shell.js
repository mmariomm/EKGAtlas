/*
 * Banco di prova — a fake SA4PSO in one page.
 *
 * The panel is NOT reimplemented here: dist/demo.html embeds the real built
 * core (extension/content.js) and the real simulator used by the e2e tests
 * (test/sa4pso-mock.mjs). This file is only the missing browser: it answers
 * fetch() from the simulator, re-runs the core on every fake navigation, and
 * paints the host application around it.
 *
 * Rule kept throughout: the shell only ADDS to the DOM the panel reads
 * (wrappers, headings, CSS). It never rewrites the markup the simulator
 * produced, so what works here works there.
 */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const HOSPITAL = "https://smarthealth.multimedica.it";
  const PATH = "/sa4pso/restrict/menuPsoEpisodio.do";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Three fake patients, in three different states, so every screen of the
  // panel has something to show. No real person, no real code, no real id.
  const PATIENTS = [
    { ep: "999001", name: "ROSSI MARIO", nato: "12/03/1958", eta: 68, sex: "M", tri: "giallo",
      motivo: "Dolore toracico", arrivo: "07:12", letto: "B3",
      opts: { withResults: true, seedConfirmed: true },
      nota: "richiesta di laboratorio già confermata, due prelievi in corso, tre referti" },
    { ep: "999002", name: "BIANCHI ANNA", nato: "02/09/1991", eta: 34, sex: "F", tri: "verde",
      motivo: "Dolore addominale", arrivo: "08:40", letto: "A1",
      opts: { noReferti: true },
      nota: "appena arrivata: nessuna richiesta, nessun esito" },
    { ep: "999003", name: "COLOMBO LUIGI", nato: "27/11/1944", eta: 81, sex: "M", tri: "arancione",
      motivo: "Trauma cranico", arrivo: "06:05", letto: "Shock room",
      opts: { seedConfirmedRadio: true },
      nota: "radiologia già confermata, referti disponibili" },
  ];
  const byEp = (ep) => PATIENTS.find((p) => p.ep === ep);

  let mocks = new Map();
  const buildMocks = () => {
    mocks = new Map(PATIENTS.map((p) => [p.ep, window.MockLib.createMock({ episodeId: p.ep, name: p.name, ...p.opts })]));
  };

  // Some hosts (a sandboxed frame, a browser set to block site data) throw on
  // storage. The panel treats that as "nothing saved" and would lose the
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

  // ------------------------------------------------------------ bytes
  const toBuf = (body) => {
    if (!body) return null;
    if (typeof body === "string") {
      const b = new Uint8Array(body.length);
      for (let i = 0; i < body.length; i++) b[i] = body.charCodeAt(i) & 0xff;
      b.toString = () => body;
      return b;
    }
    return body;
  };
  const b64 = (buf) => {
    const by = new Uint8Array(buf); let s = "";
    for (let i = 0; i < by.length; i += 0x8000) s += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // ------------------------------------------------------- url mapping
  // browser side (this origin, any path) <-> simulator side (hospital urls)
  const toMock = (raw) => {
    const u = new URL(raw, location.href);
    const path = /\.(do|rra2)$|jasperservlet|refertostream/.test(u.pathname) ? u.pathname : PATH;
    return HOSPITAL + path + u.search;
  };
  const toBrowser = (mockUrl) => {
    const u = new URL(mockUrl);
    return location.origin + u.pathname + u.search;
  };
  const isWorklist = (mockUrl) => {
    const u = new URL(mockUrl);
    if (!u.pathname.endsWith("menuPsoEpisodio.do")) return false; // print, referti, risultati
    const p = u.searchParams;
    return (p.get("MVPG") || "") === "PsoLista" || (!p.get("MVPG") && !p.get("EPISODIO_ID"));
  };
  let currentEp = PATIENTS[0].ep;
  const mockFor = (mockUrl) => {
    const ep = new URL(mockUrl).searchParams.get("EPISODIO_ID");
    return mocks.get(ep) || mocks.get(currentEp) || mocks.values().next().value;
  };

  // --------------------------------------------------------- the server
  const enc = (html) => window.MockLib.encodeWin1252(html);
  const htmlOut = (html) => ({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: enc(html) });

  // one request, redirects followed, exactly like the browser does
  function answer(rawUrl, init) {
    let mockUrl = toMock(rawUrl);
    if (isWorklist(mockUrl)) return { out: htmlOut(worklistPage()), final: mockUrl };
    let out = mockFor(mockUrl).handle({
      method: (init.method || "GET").toUpperCase(),
      url: mockUrl,
      bodyBuffer: toBuf(init.body),
    });
    for (let hop = 0; out.status === 302 && hop < 5; hop++) {
      mockUrl = new URL(out.headers.location, mockUrl).href;
      out = isWorklist(mockUrl) ? htmlOut(worklistPage()) : mockFor(mockUrl).handle({ method: "GET", url: mockUrl });
    }
    return { out, final: mockUrl };
  }

  // Nothing leaves this page. Ever. Same-origin requests are answered by the
  // simulator above; anything else — a hospital address, any other host, a
  // beacon, a socket — is refused here rather than sent, so the banco cannot
  // touch a real server even if a future change asked it to.
  let latency = 150;
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
    Object.defineProperty(res, "url", { value: toBrowser(final) }); // real fetch reports the final url
    return res;
  };

  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"]) {
    if (!(name in window)) continue;
    try { window[name] = function () { throw outside(name, "—"); }; } catch (e) { /* locked down already */ }
  }
  try { navigator.sendBeacon = () => false; } catch (e) { /* read-only: nothing to send to anyway */ }

  // ------------------------------------------- the extension, simulated
  // The panel asks a service worker to fetch and keep referto PDFs. Here the
  // same message API answers from memory, so the whole Esiti flow — saving,
  // green dots, instant reopen, Resetta — behaves as it does with the real
  // extension installed.
  const refs = new Map();
  async function extension(msg) {
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
        extension(msg).then((r) => { try { cb && cb(r); } catch (e) { console.error(e); } });
      },
    },
  };

  // ------------------------------------------------------- fake tabs
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
      const close = () => { el.remove(); tabs.delete(key); t.stub.closed = true; };
      el.querySelector("button").addEventListener("click", close);
      t = {
        el, frame, close,
        async show(u) {
          const label = /^blob:/i.test(u)
            ? "documento PDF · aperto dalla copia salvata"
            : (() => { try { const p = new URL(u, location.href); return p.pathname.split("/").pop() + p.search.slice(0, 40); } catch (e) { return String(u).slice(0, 60); } })();
          el.querySelector("b").textContent = "scheda · " + label;
          if (/^(blob:|data:)/i.test(u)) { swap(u); return; }
          try {
            const r = await window.fetch(u);
            const blob = await r.blob();
            swap(URL.createObjectURL(blob));
          } catch (e) {
            const n = el.querySelector(".note");
            if (n) n.textContent = "errore: " + e.message;
          }
        },
        stub: null,
      };
      const swap = (src) => {
        el.querySelector(".note")?.remove();
        if (!frame.isConnected) el.appendChild(frame);
        frame.src = src;
      };
      const stub = {
        closed: false,
        close, focus() {}, print() {},
        document: {},
        location: { get href() { return frame.src || "about:blank"; }, set href(u) { t.show(u); } },
      };
      t.stub = stub;
      tabs.set(key, t);
    }
    if (url) t.show(url);
    return t.stub;
  }

  // ---------------------------------------------------- pages by the shell
  function worklistPage() {
    const rows = PATIENTS.map((p) => `
      <tr>
        <td><span class="tri ${p.tri}">${p.tri}</span></td>
        <td class="n"><a href="${PATH}?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${p.ep}">${esc(p.name)}</a></td>
        <td class="num">${p.eta}</td><td>${p.sex}</td>
        <td>${esc(p.motivo)}</td><td class="num">${p.arrivo}</td><td>${esc(p.letto)}</td>
        <td class="num">${p.ep}</td>
      </tr>`).join("");
    return `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252">
      <title>PRONTO SOCCORSO - LISTA</title></head><body>
      <form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&MVPG=PsoLista"></form>
      <table class="wl">
        <tr><th>Triage</th><th>Assistito</th><th>Età</th><th>Sesso</th><th>Motivo</th><th>Arrivo</th><th>Postazione</th><th>Episodio</th></tr>
        ${rows}
      </table></body></html>`;
  }

  // ------------------------------------------------------- the browser
  // Timers and window/document listeners left behind by the previous page are
  // dropped before the next one runs — a real navigation destroys them, and a
  // panel that kept two Esc handlers alive would not behave like the real one.
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
    recording = true;
    try { new Function(coreSrc)(); } catch (e) { console.error("core:", e); }
  }

  let current = HOSPITAL + PATH + "?MVPG=PsoLista";
  function navigate(rawUrl) {
    const target = /^https?:/i.test(rawUrl) && !rawUrl.startsWith(location.origin) ? rawUrl : toMock(rawUrl);
    render(target);
  }
  function reloadPage() { render(current); }

  function render(mockUrl) {
    wipe();
    const { out, final } = answer(mockUrl, { method: "GET" });
    current = final;
    const ep = new URL(final).searchParams.get("EPISODIO_ID");
    if (ep && byEp(ep)) currentEp = ep;
    const html = new TextDecoder("windows-1252").decode(out.body);
    const doc = new DOMParser().parseFromString(html, "text/html");
    document.title = (doc.title || "SA4PSO").trim();

    const page = $("#sa4-page");
    page.replaceChildren(...doc.body.childNodes);
    decorate(page, final);
    appChrome(final);
    $(".psa-url").textContent = "simulatore · " + new URL(final).pathname.replace("/sa4pso/restrict", "…") + new URL(final).search;
    // the query is real, so location.href carries EPISODIO_ID exactly as at work
    try { history.replaceState(null, "", new URL(final).search || "?"); } catch (e) { /* framed: keep going */ }
    window.scrollTo(0, 0);
    runCore();
  }

  // header + patient banner around the simulated page
  function appChrome(finalUrl) {
    const p = byEp(new URL(finalUrl).searchParams.get("EPISODIO_ID"));
    const list = isWorklist(finalUrl);
    $("#sa4-head").innerHTML = `
      <div class="sa4-top"><b>SA4 · Pronto Soccorso</b><span>simulatore locale — nessun collegamento all'ospedale</span></div>
      <div class="sa4-tabs">
        <i class="${list ? "on" : ""}">Lista PS</i><i class="${!list ? "on" : ""}">Episodio</i>
        <i>Triage</i><i>Diario</i><i>Verbale</i>
      </div>
      ${p && !list ? `<div class="sa4-pat">
        <span class="tri ${p.tri}">${p.tri}</span>
        <span class="nm">${esc(p.name)}</span>
        <span class="kv">nato il <b>${p.nato}</b></span>
        <span class="kv">età <b>${p.eta}</b></span>
        <span class="kv">episodio <b>${esc(p.ep)}</b></span>
        <span class="kv">postazione <b>${esc(p.letto)}</b></span>
        <span class="kv">motivo <b>${esc(p.motivo)}</b></span>
      </div>` : ""}`;
  }

  // Section titles the simulator has no reason to carry. Only inserted
  // BEFORE existing nodes: nothing the panel queries is touched.
  const SECTIONS = [
    ['a[title="Richieste Laboratorio"], a[title="Richieste Radiologia"]', "Nuova richiesta", "self"],
    ['a[title="Stampa Etichette"], a[title="Stampa Richiesta"], a[title="Stampa Prenotazione Esterna"]', "Richieste effettuate — ristampa", "table"],
    ['a[title="Visualizza Risultati"]', "Risultati in corso (non ancora refertati)", "table"],
    ['a[title="REFERTO"]', "Referti e documenti", "table"],
    ['textarea[name="DIARIO"]', "Diario clinico", "form"],
    ['form[name="RICHIESTACrea"]', "Nuova richiesta — dati", "self"],
    ['form[name="RisorsaFiltro"]', "Ricerca prestazioni", "self"],
    ['form[name="Prestazioni"]', "Carrello della richiesta", "self"],
  ];
  function decorate(page, finalUrl) {
    for (const [sel, title, mode] of SECTIONS) {
      const el = page.querySelector(sel);
      if (!el) continue;
      const anchor = mode === "table" ? el.closest("table") : mode === "form" ? el.closest("form") : el;
      if (!anchor || !anchor.parentNode || anchor.previousElementSibling?.classList?.contains("sechead")) continue;
      const h = document.createElement("h2");
      h.className = "sechead";
      h.textContent = title;
      anchor.parentNode.insertBefore(h, anchor);
    }
    if (isWorklist(finalUrl)) {
      const h = document.createElement("p");
      h.className = "hint";
      h.textContent = "Nessun paziente aperto: da qui il pannello mostra solo l'elenco dei pazienti che conosce. Apri un assistito per ordinare.";
      page.prepend(h);
    }
  }

  // links and form submits inside the simulated app behave like a browser
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("#sa4-page a[href]");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    e.preventDefault();
    // links whose real job is the inline window.open (referti, risultati)
    if (a.getAttribute("onclick")) { try { a.onclick(e); } catch (err) { console.error(err); } return; }
    if (href.startsWith("#") || /^javascript:/i.test(href)) return;
    navigate(new URL(href, location.href).href);
  });
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!form.closest?.("#sa4-page")) return;
    e.preventDefault();
    const data = new URLSearchParams(new FormData(form));
    const action = new URL(form.getAttribute("action") || "", location.href).href;
    const { out, final } = answer(action, { method: (form.method || "GET").toUpperCase(), body: data.toString() });
    void out; render(final);
  });

  // ------------------------------------------------------- the harness
  window.__PSA_DEMO__ = {
    nav: (u) => navigate(u),
    open: (u, name) => fakeTab(u, name),
  };
  window.open = (u, name) => fakeTab(u, name); // inline handlers in the simulated pages

  function help() {
    const box = document.createElement("div");
    box.className = "psa-help";
    box.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Come usare il banco di prova">
      <h2>Banco di prova</h2>
      <p class="sub">Il pannello vero (la stessa build dell'estensione) sopra un pronto soccorso finto. Tre pazienti inventati, nessun dato reale, niente che esca da questa pagina.</p>
      <h3>Funziona come al lavoro</h3>
      <ul>
        <li>Lista PS → apri un assistito → il pannello parte su <b>Richieste</b>.</li>
        <li>Quesito, profili, esami, «Crea e aggiungi», conferma: il flusso completo, verifiche comprese.</li>
        <li><b>Esiti</b>: valori dentro il pannello, anteprima a due righe, referti in una finta scheda, «Salva referti» e pallini verdi.</li>
        <li>Il tasto <b>‹</b> apre l'elenco dei pazienti conosciuti; sceglierne un altro carica la sua pagina.</li>
      </ul>
      <h3>Diverso dal vero</h3>
      <ul>
        <li>La stampa mostra il PDF ma <b>non apre il dialogo</b> di stampa.</li>
        <li>I PDF sono fogli vuoti: qui conta il flusso, non il contenuto.</li>
        <li>Le schede dei referti sono finestre finte in basso a destra, non schede del browser.</li>
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
        <option value="0">rapida</option><option value="150" selected>reale</option><option value="700">lenta</option>
      </select></label>
      <button type="button" id="psa-help" aria-label="Come funziona il banco di prova">?</button>
      <span class="psa-url"></span>`;
    const b = window.__PSA_BUILD__ || {};
    bar.querySelector(".psa-build").textContent = "pannello " + (b.version || "?") + (b.built ? " · " + b.built : "");
    document.body.prepend(bar);
    bar.querySelector("#psa-home").addEventListener("click", () => navigate(HOSPITAL + PATH + "?MVPG=PsoLista"));
    bar.querySelector("#psa-reload").addEventListener("click", reloadPage);
    bar.querySelector("#psa-help").addEventListener("click", help);
    bar.querySelector("#psa-net").addEventListener("change", (e) => { latency = Number(e.target.value); });
    bar.querySelector("#psa-wipe").addEventListener("click", () => {
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* private mode */ }
      refs.clear(); buildMocks();
      for (const t of [...tabs.values()]) t.close();
      navigate(HOSPITAL + PATH + "?MVPG=PsoLista");
    });
  }

  // ------------------------------------------------------------- start
  const decodeB64 = (id) => {
    const raw = atob(document.getElementById(id).textContent.trim());
    return new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
  };
  window.MockLib = new Function(decodeB64("psa-mock") + "\n;return { createMock, encodeWin1252, RES, CATALOG };")();
  coreSrc = decodeB64("psa-core");
  buildMocks();
  harness();
  // a reload keeps the page you were on: the query is the real location
  const boot = location.search && location.search.length > 1
    ? HOSPITAL + PATH + location.search
    : HOSPITAL + PATH + "?MVPG=PsoLista";
  render(boot);
})();
