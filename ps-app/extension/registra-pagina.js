/*
 * PS Assist — il registratore, la parte nella pagina (gestionale, portale e
 * SISS, ogni riquadro). Non fa niente finché il medico non preme ⋯ → Registra; poi:
 *   - manda al service worker il DOM della pagina com'è dopo il caricamento (e
 *     com'è quando la si lascia, se nel frattempo è cambiato), senza il pannello;
 *   - segna le richieste che fa il PANNELLO (content.js vive in questo stesso
 *     mondo isolato: il suo fetch e il suo XMLHttpRequest sono questi), così il
 *     flusso dice quali sono dell'estensione; e se una di quelle risposte è un
 *     PDF, ne passa i byte, così non serve rileggerlo;
 *   - dove il pannello non c'è (SISS, portale, le pagine del gestionale senza
 *     pannello), nel riquadro principale, mostra la pill «● Registrando…»: la
 *     stessa pill del pannello ridotto (le sue regole CSS, da registra-pill.js),
 *     nello stesso posto (si trascina, e resta dove la lasci, sito per sito);
 *     un clic offre «Ferma e scarica».
 * Sul SISS (menu operatore e Prescrittivo Regionale: un'app Angular che cambia
 * vista senza ricaricare la pagina) in più:
 *   - un'istantanea a ogni cambio di vista (pushState/replaceState visti dalla
 *     Navigation API e dall'indirizzo che cambia, popstate, hashchange), quando
 *     si apre o si chiude un dialogo (cdk-overlay-container), e dopo 800 ms di
 *     quiete dopo un cambiamento vero del DOM — mai due uguali (impronta del
 *     contenuto), al più 15 al minuto;
 *   - i valori dei campi (input, select, caselle, radio) scritti nell'istantanea,
 *     che poi l'anonimizzazione tratta come tutto il resto;
 *   - MAI le credenziali: password, PIN, OTP, codice di sblocco — il valore non
 *     si legge nemmeno; una pagina d'accesso (smart card, login) o un dialogo
 *     con un campo così si registra solo nella forma, senza testo;
 *   - gli host fuori dal SISS che la pagina chiama (solo il nome, dalla
 *     Resource Timing): per sapere se manca qualcosa al perimetro.
 * Niente esce dal PC: tutto va al service worker, che lo tiene finché il
 * medico non scarica (o cancella) la registrazione. Nessuno script nel mondo
 * della pagina, nessuna richiesta in più.
 */
(() => {
  if (globalThis.__psaRegistra) return;
  globalThis.__psaRegistra = true;
  const SISS = new Set(["https://dcss.cgi.crs.lombardia.it", "https://operatorisiss.servizirl.it"]);
  const suSiss = SISS.has(location.origin);
  const inAlto = (() => { try { return window.top === window; } catch { return false; } })();
  let rec = false;
  const leggi = () => chrome.storage.local.get("registra").then((o) => {
    const r = o && o.registra;
    const prima = rec;
    rec = !!(r && r.stato === "rec" && Date.now() < r.scade);
    if (rec && !prima && document.readyState === "complete") setTimeout(() => scatta("caricata"), 300);
    if (rec !== prima) { pill(); if (suSiss) osserva(); }
  }).catch(() => {});
  try {
    leggi();
    chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.registra) leggi(); });
  } catch { return; }
  const manda = (m, cb) => { try { chrome.runtime.sendMessage(m, (x) => { void chrome.runtime.lastError; if (cb) cb(x); }); } catch { /* estensione ricaricata */ } };
  const assoluto = (u) => { try { return new URL(String(u), location.href).href; } catch { return String(u || ""); } };

  // ------------------------------------------ le richieste del pannello
  const b64 = (buf) => {
    const u8 = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const forsePdf = (url, buf) => {
    if (!rec || !buf || buf.byteLength < 5 || buf.byteLength > 15 * 1024 * 1024) return;
    if (String.fromCharCode(...new Uint8Array(buf, 0, 5)) !== "%PDF-") return;
    manda({ t: "regPdf", url, b64: b64(buf) });
  };
  const f0 = globalThis.fetch;
  if (typeof f0 === "function") {
    globalThis.fetch = function (input, init) {
      const p = f0.apply(this, arguments);
      if (rec) {
        try {
          const url = assoluto(typeof input === "string" || input instanceof URL ? input : input && input.url);
          manda({ t: "regRichiesta", metodo: (init && init.method) || (input && input.method) || "GET", url, ts: Date.now() });
          p.then((res) => {
            if (/pdf|octet-stream/i.test(res.headers.get("content-type") || "")) res.clone().arrayBuffer().then((b) => forsePdf(res.url || url, b)).catch(() => {});
          }).catch(() => {});
        } catch { /* la richiesta parte comunque */ }
      }
      return p;
    };
  }
  const X = globalThis.XMLHttpRequest && globalThis.XMLHttpRequest.prototype;
  if (X) {
    const open0 = X.open, send0 = X.send;
    X.open = function (metodo, url) {
      try { this.__psaReg = { metodo: String(metodo || "GET").toUpperCase(), url: assoluto(url) }; } catch { /* niente */ }
      return open0.apply(this, arguments);
    };
    X.send = function () {
      const r = this.__psaReg;
      if (rec && r) {
        manda({ t: "regRichiesta", metodo: r.metodo, url: r.url, ts: Date.now() });
        this.addEventListener("load", () => {
          try { if (this.response instanceof ArrayBuffer) forsePdf(this.responseURL || r.url, this.response); } catch { /* niente */ }
        });
      }
      return send0.apply(this, arguments);
    };
  }

  // ---------------------------------------- le credenziali: mai lette
  const CRED = /(?:^|[^a-z])(?:pin|otp|password|passwd|pwd|passcode|puk|sblocco)(?:[^a-z]|$)|codice\s+di\s+sblocco|one[\s-]?time|parola\s+chiave/i;
  const etichettaDi = (el) => {
    const pezzi = [el.name, el.id, el.getAttribute("formcontrolname"), el.getAttribute("autocomplete"), el.getAttribute("aria-label"), el.getAttribute("placeholder")];
    try { for (const l of el.labels || []) pezzi.push(l.textContent); } catch { /* niente */ }
    const ff = el.closest && el.closest("mat-form-field, .mat-form-field, .mat-mdc-form-field");
    const lab = ff && ff.querySelector("label, mat-label");
    if (lab) pezzi.push(lab.textContent);
    return pezzi.filter(Boolean).join(" ").slice(0, 400);
  };
  const credenziale = (el) => {
    const tipo = String(el.type || el.getAttribute("type") || "").toLowerCase();
    if (tipo === "password") return true;
    if (/one-time-code|current-password|new-password/i.test(el.getAttribute("autocomplete") || "")) return true;
    return CRED.test(etichettaDi(el).replace(/([a-z0-9])([A-Z])/g, "$1 $2"));   // anche «pinCarta»
  };

  // ---------------------------------------------------- la pagina vista
  const NOI = "#psassist-host, #psassist-reg-host";
  const impronta = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ":" + s.length; };
  const SISS_APP = /^\/(?:menusiss|prescrittivoRegionale)(?:\/|$)/i;
  const ACCESSO = /login|logon|logout|signin|auth|sso|idp|saml|oauth|smart-?card|cns|spid|cie\b/i;
  // lo stato dei campi, scritto nell'istantanea (il DOM ha solo il valore di partenza)
  function moduli(c) {
    const vivi = document.querySelectorAll("input, select, textarea");
    const copie = c.querySelectorAll("input, select, textarea");
    if (vivi.length !== copie.length) return 0;
    let cred = 0;
    vivi.forEach((el, i) => {
      const k = copie[i];
      if (el.closest(NOI)) return;
      if (credenziale(el)) {
        cred++;
        k.removeAttribute("value"); k.setAttribute("data-psa-escluso", "credenziale");
        if (k.tagName === "TEXTAREA") k.textContent = "";
        return;
      }
      const tipo = String(el.type || "").toLowerCase();
      if (tipo === "file" || tipo === "hidden") return;
      if (tipo === "checkbox" || tipo === "radio") { if (el.checked) k.setAttribute("checked", ""); else k.removeAttribute("checked"); return; }
      if (el.tagName === "SELECT") { [...el.options].forEach((o, j) => { if (o.selected) k.options[j].setAttribute("selected", ""); else k.options[j].removeAttribute("selected"); }); return; }
      if (el.tagName === "TEXTAREA") { k.textContent = el.value; return; }
      if (el.value !== "") k.setAttribute("value", el.value); else k.removeAttribute("value");
    });
    return cred;
  }
  // solo la forma: i tag e la struttura, senza un testo né un valore
  function forma(n) {
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    const t = [];
    while (w.nextNode()) t.push(w.currentNode);
    for (const x of t) x.nodeValue = x.nodeValue.trim() ? "·" : x.nodeValue;
    for (const el of n.querySelectorAll ? [n, ...n.querySelectorAll("*")] : []) {
      for (const a of ["value", "placeholder", "title", "aria-label", "alt", "aria-valuetext"]) if (el.hasAttribute && el.hasAttribute(a)) el.setAttribute(a, "");
      if (el.tagName === "SCRIPT") el.textContent = "";
    }
  }
  let ultima = "";
  const visti = new Set();
  const minuto = [];
  let fuori = new Set();
  const MAX_MINUTO = 15;
  let rinviato = null;
  function scatta(motivo) {
    if (!rec || !document.documentElement) return;
    if (suSiss) {
      const ora = Date.now();
      while (minuto.length && ora - minuto[0] > 60e3) minuto.shift();
      if (minuto.length >= MAX_MINUTO && motivo !== "uscita") {
        // al più 15 al minuto: l'ultima si fa appena c'è posto, così lo stato finale c'è
        clearTimeout(rinviato);
        rinviato = setTimeout(() => scatta(motivo), 60e3 - (ora - minuto[0]) + 50);
        return;
      }
    }
    let html, extra = {};
    try {
      const c = document.documentElement.cloneNode(true);
      if (suSiss) {
        const cred = moduli(c);
        // una pagina d'accesso, o un dialogo con un campo di credenziali: solo la forma
        // (e tutto quello che sul SISS non è il menu operatore o il Prescrittivo Regionale)
        const accesso = !SISS_APP.test(location.pathname) || ACCESSO.test(location.pathname + location.hash);
        if (accesso) { forma(c); extra.forma = true; }
        else if (cred) for (const p of c.querySelectorAll(".cdk-overlay-pane")) if (p.querySelector("[data-psa-escluso]")) { forma(p); extra.forma = true; }
        if (cred) extra.credenziali = cred;
        if (fuori.size) extra.fuori = [...fuori].slice(0, 20);
      } else {
        c.querySelectorAll('input[type="password"]').forEach((k) => { k.removeAttribute("value"); k.setAttribute("data-psa-escluso", "credenziale"); });
      }
      c.querySelectorAll(NOI).forEach((n) => n.remove());   // il pannello e la pill non sono la pagina
      const dt = document.doctype;
      html = (dt ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ""}${dt.systemId ? ` "${dt.systemId}"` : ""}>\n` : "") + c.outerHTML;
    } catch { return; }
    if (html === ultima) return;
    if (suSiss) {
      // mai due uguali: la quiete non rifotografa una vista già vista
      const h = impronta(location.href + "\n" + html);
      if (motivo === "quiete" && visti.has(h)) return;
      visti.add(h);
      minuto.push(Date.now());
    }
    ultima = html;
    manda({ t: "regPagina", url: location.href, titolo: document.title, html, motivo, ts: Date.now(), ...extra });
  }
  const dopoIlCaricamento = () => setTimeout(() => scatta("caricata"), 800);
  if (document.readyState === "complete") dopoIlCaricamento();
  else addEventListener("load", dopoIlCaricamento, { once: true });
  addEventListener("pagehide", () => scatta("uscita"));

  // ------------------------------------------------ il SISS: un'app a viste
  let ascolta = false, osservatore = null, quieteT = null, rottaT = null, overlayT = null, giro = null, indirizzo = location.href, perf = null;
  const quiete = () => { clearTimeout(quieteT); quieteT = setTimeout(() => scatta("quiete"), 800); };
  const rotta = () => {
    if (location.href === indirizzo) return;
    indirizzo = location.href;
    clearTimeout(quieteT); clearTimeout(rottaT);
    rottaT = setTimeout(() => scatta("rotta"), 600);   // la vista nuova ha il tempo di disegnarsi
  };
  const nostro = (n) => n && n.nodeType === 1 && (n.id === "psassist-host" || n.id === "psassist-reg-host");
  // un dialogo, un menu a tendina, un elenco di suggerimenti: Angular li mette tutti nel cdk-overlay-container
  const eContenitore = (n) => !!n && n.nodeType === 1 && n.classList.contains("cdk-overlay-container");
  function osserva() {
    if (!rec) {
      if (osservatore) { osservatore.disconnect(); osservatore = null; }
      clearInterval(giro); giro = null;
      if (perf) { perf.disconnect(); perf = null; }
      return;
    }
    if (osservatore || !document.documentElement) return;
    osservatore = new MutationObserver((lista) => {
      let vero = false, dialogo = false;
      for (const m of lista) {
        if (nostro(m.target) || (m.target.closest && m.target.closest(NOI))) continue;
        const nodi = [...m.addedNodes, ...m.removedNodes];
        if (m.type === "childList" && nodi.length && nodi.every(nostro)) continue;
        if (m.type === "childList" && (eContenitore(m.target) || nodi.some(eContenitore))) dialogo = true;
        vero = true;
      }
      if (dialogo) { clearTimeout(quieteT); clearTimeout(overlayT); overlayT = setTimeout(() => scatta("overlay"), 350); }
      else if (vero) quiete();
    });
    osservatore.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    indirizzo = location.href;
    if (!ascolta) {
      ascolta = true;
      // i campi compilati non cambiano il DOM: li dice l'evento
      for (const ev of ["change", "input"]) addEventListener(ev, (e) => { if (rec && !(e.target && e.target.closest && e.target.closest(NOI))) quiete(); }, true);
      addEventListener("popstate", () => rec && rotta());
      addEventListener("hashchange", () => rec && rotta());
      try { if (globalThis.navigation) globalThis.navigation.addEventListener("currententrychange", () => rec && setTimeout(rotta, 0)); } catch { /* niente */ }
    }
    giro = setInterval(rotta, 500);   // pushState/replaceState, anche senza la Navigation API
    // gli host chiamati fuori dal SISS: solo il nome (non sono registrati)
    try {
      perf = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          if (!/^(xmlhttprequest|fetch|beacon|other)$/.test(e.initiatorType)) continue;
          try { const o = new URL(e.name).origin; if (!SISS.has(o) && /^https?:/.test(o)) fuori.add(o); } catch { /* niente */ }
        }
      });
      perf.observe({ type: "resource", buffered: true });
    } catch { perf = null; }
  }

  // ----------------------------------------- la pill «● Registrando…»
  // Solo dove il pannello non c'è e nel riquadro principale. La stessa pill
  // del pannello ridotto: le sue regole (registra-pill.js), il suo posto.
  let ospite = null, attesaPannello = null, pronta = false;
  // il pannello arriva a document_idle: la pill aspetta il caricamento, così
  // dove il pannello c'è non compare neanche per un attimo
  const prontaDopo = () => setTimeout(() => { pronta = true; pill(); }, 1200);
  if (document.readyState === "complete") prontaDopo();
  else addEventListener("load", prontaDopo, { once: true });
  const chiudiMenu = () => {
    const r = ospite && ospite.shadowRoot;
    if (!r) return;
    r.querySelector(".menu").hidden = true;
    r.getElementById("expand").setAttribute("aria-expanded", "false");
  };
  addEventListener("keydown", (e) => { if (e.key === "Escape") chiudiMenu(); }, true);
  addEventListener("click", (e) => { if (ospite && !e.composedPath().includes(ospite)) chiudiMenu(); }, true);
  // Trascinata, la pill resta dove la lasci, sito per sito (chrome.storage.local,
  // «registra.pill»: { origine: {left, top} }), sempre dentro lo schermo; un
  // clic senza trascinare è quello di sempre.
  const POSTO = "registra.pill";
  let posto = null, trascinata = false;
  try { chrome.storage.local.get(POSTO).then((o) => { const p = o && o[POSTO] && o[POSTO][location.origin]; if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) { posto = p; metti(); } }).catch(() => {}); } catch { /* niente */ }
  const dentro = (p, w, h) => ({ left: Math.max(0, Math.min(innerWidth - w, p.left)), top: Math.max(0, Math.min(innerHeight - h, p.top)) });
  function metti() {
    const wrap = ospite && ospite.shadowRoot && ospite.shadowRoot.querySelector(".wrap");
    if (!wrap || !posto) return;
    const b = wrap.getBoundingClientRect(), p = dentro(posto, b.width || 140, b.height || 36);
    wrap.style.left = p.left + "px"; wrap.style.top = p.top + "px"; wrap.style.right = "auto";
  }
  addEventListener("resize", () => metti());
  function trascina(btn, wrap) {
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* niente */ }
      const r = wrap.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      let mosso = false;
      const mm = (ev) => {
        if (!mosso && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
        if (!mosso) { mosso = true; chiudiMenu(); }
        posto = dentro({ left: r.left + ev.clientX - sx, top: r.top + ev.clientY - sy }, r.width, r.height);
        metti();
      };
      const su = () => {
        btn.removeEventListener("pointermove", mm);
        btn.removeEventListener("pointerup", su);
        btn.removeEventListener("pointercancel", su);
        if (!mosso) return;
        trascinata = true;
        setTimeout(() => { trascinata = false; }, 0);   // il clic che chiude il trascinamento non apre il menu
        try {
          chrome.storage.local.get(POSTO).then((o) => chrome.storage.local.set({ [POSTO]: { ...((o && o[POSTO]) || {}), [location.origin]: posto } })).catch(() => {});
        } catch { /* estensione ricaricata */ }
      };
      btn.addEventListener("pointermove", mm);
      btn.addEventListener("pointerup", su);
      btn.addEventListener("pointercancel", su);
    });
  }
  function pill() {
    if (!inAlto || !pronta) return;
    if (!rec || document.getElementById("psassist-host")) {
      if (ospite) { ospite.remove(); ospite = null; }
      if (rec && !attesaPannello) attesaPannello = setInterval(pill, 1000);
      if (!rec) { clearInterval(attesaPannello); attesaPannello = null; }
      return;
    }
    if (!attesaPannello) attesaPannello = setInterval(pill, 1000);   // il pannello può arrivare dopo (document_idle)
    if (ospite && ospite.isConnected) return;
    if (!document.documentElement) return;
    ospite = document.createElement("div");
    ospite.id = "psassist-reg-host";
    const root = ospite.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${globalThis.__psaPillCss || ""}
      .pill .dot.rec { background: #FF8A80; }
      .pill .slot { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; }   /* dove sta il logo */
      .menu[hidden] { display: none; }</style>
      <div class="wrap"><button class="pill" id="expand" title="PS Assist sta registrando questa sessione — tocca per fermare" aria-haspopup="menu" aria-expanded="false"><span class="slot"><span class="dot rec"></span></span> <span class="who">Registrando…</span></button>
      <div class="menu" role="menu" hidden><button role="menuitem" id="regferma">Ferma e scarica</button></div></div>`;
    const btn = root.getElementById("expand"), menu = root.querySelector(".menu"), wrap = root.querySelector(".wrap");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (trascinata) return;
      menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden));
      if (menu.hidden) return;
      // il menu sta dalla parte dove c'è posto (la pill trascinata in un angolo)
      const b = wrap.getBoundingClientRect(), m = menu.getBoundingClientRect();
      Object.assign(menu.style, b.right - m.width < 0 ? { left: "0", right: "auto" } : { left: "", right: "" },
        b.bottom + m.height + 8 > innerHeight ? { top: "auto", bottom: b.height + 4 + "px" } : { top: "", bottom: "" });
    });
    root.getElementById("regferma").addEventListener("click", (e) => { e.stopPropagation(); chiudiMenu(); manda({ t: "registraFerma" }); });
    trascina(btn, wrap);
    document.documentElement.appendChild(ospite);
    metti();
  }
})();
