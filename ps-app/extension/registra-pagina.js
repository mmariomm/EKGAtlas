/*
 * PS Assist — il registratore, la parte nella pagina (gestionale, portale e
 * SISS, ogni riquadro). Fa quello che segue mentre il medico registra (⋯ →
 * Registrazioni → Registra) e, se no, per la registrazione automatica (gli
 * ultimi 3 minuti nel service worker; accesa di norma, senza pill né rilettura):
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
 *     un clic offre «Ferma e salva» (lo zip resta nell'estensione).
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
 * Sul visualizzatore di immagini del PACS (eViewer, la fotocamera «IMMAGINE»
 * del gestionale: un'app a canvas) le stesse istantanee a viste, e in più:
 *   - MAI un'immagine: ogni indirizzo data: (le miniature, gli sfondi) esce
 *     dall'istantanea prima di lasciare la pagina; i canvas non hanno pixel nel DOM;
 *   - una descrizione tecnica (canvas e contesto, miniature <img> e che
 *     indirizzi hanno, riquadri, WebSocket, blob, script, le misure della
 *     Resource Timing): numeri e tipi, chiesti alla sonda (registra-sonda.js,
 *     nel mondo della pagina) — mai un pixel, mai un byte;
 *   - i clic (dove: il tag, la classe, il testo corto, se è una miniatura),
 *     per sapere che richieste fa un tocco su una miniatura.
 * Niente esce dal PC: tutto va al service worker, che lo tiene finché il
 * medico non salva (o cancella) la registrazione, o — gli ultimi minuti — lo pota. Nessuno script nel mondo
 * della pagina (sul visualizzatore solo la sonda, che conta e descrive), nessuna richiesta in più.
 */
(() => {
  if (globalThis.__psaRegistra) return;
  globalThis.__psaRegistra = true;
  const SISS = new Set(["https://dcss.cgi.crs.lombardia.it", "https://operatorisiss.servizirl.it"]);
  const suSiss = SISS.has(location.origin);
  // il PACS: un solo host, ogni porta (anche in manifest.json, registra.js, registra-anonimo.js)
  const VIEWER = "mmeviewer.multimedica.root.lan";
  const suViewer = location.hostname === VIEWER;
  const aViste = suSiss || suViewer;   // un'app che cambia senza ricaricare: istantanee a ogni cambiamento
  const inAlto = (() => { try { return window.top === window; } catch { return false; } })();
  // rec: la registrazione a mano (con la pill); attivo: si tiene la pagina —
  // a mano, o per la registrazione automatica (gli ultimi minuti, senza pill:
  // accesa di norma, «registra.auto» false la spegne)
  let rec = false, attivo = false;
  const leggi = () => chrome.storage.local.get(["registra", "registra.auto"]).then((o) => {
    const r = o && o.registra;
    const prima = rec, primaA = attivo;
    rec = !!(r && r.stato === "rec" && Date.now() < r.scade);
    attivo = rec || (o && o["registra.auto"]) !== false;
    // (partita a mano: la pagina di adesso si rimanda, anche se gli ultimi minuti l'avevano già)
    if (rec && !prima) { ultima = ""; visti.clear(); }
    if (attivo && (!primaA || (rec && !prima)) && document.readyState === "complete") setTimeout(() => scatta("caricata"), 300);
    if (rec !== prima) pill();
    if (attivo !== primaA && aViste) osserva();
  }).catch(() => {});
  try {
    leggi();
    chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.registra || ch["registra.auto"])) leggi(); });
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
    if (!attivo || !buf || buf.byteLength < 5 || buf.byteLength > 15 * 1024 * 1024) return;
    if (String.fromCharCode(...new Uint8Array(buf, 0, 5)) !== "%PDF-") return;
    manda({ t: "regPdf", url, b64: b64(buf) });
  };
  const f0 = globalThis.fetch;
  if (typeof f0 === "function") {
    globalThis.fetch = function (input, init) {
      const p = f0.apply(this, arguments);
      if (attivo) {
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
      if (attivo && r) {
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
    if (!attivo || !document.documentElement) return;
    if (aViste) {
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
        if (suViewer) {
          try { extra.tecnica = tecnica(); } catch { /* l'istantanea va lo stesso */ }
          if (fuori.size) extra.fuori = [...fuori].slice(0, 20);
        }
      }
      c.querySelectorAll(NOI).forEach((n) => n.remove());   // il pannello e la pill non sono la pagina
      const dt = document.doctype;
      html = (dt ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ""}${dt.systemId ? ` "${dt.systemId}"` : ""}>\n` : "") + c.outerHTML;
      // il visualizzatore: nessuna immagine esce dalla pagina, nemmeno una miniatura
      if (suViewer) html = html.replace(DATI_RE, "data:,");
    } catch { return; }
    if (html === ultima) return;
    if (aViste) {
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
    if (!attivo) {
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
      for (const ev of ["change", "input"]) addEventListener(ev, (e) => { if (attivo && !(e.target && e.target.closest && e.target.closest(NOI))) quiete(); }, true);
      addEventListener("popstate", () => attivo && rotta());
      addEventListener("hashchange", () => attivo && rotta());
      try { if (globalThis.navigation) globalThis.navigation.addEventListener("currententrychange", () => attivo && setTimeout(rotta, 0)); } catch { /* niente */ }
    }
    giro = setInterval(rotta, 500);   // pushState/replaceState, anche senza la Navigation API
    // gli host chiamati fuori dal SISS (o dal visualizzatore): solo il nome (non sono registrati);
    // sul visualizzatore anche le misure di ogni risorsa (Resource Timing: solo numeri)
    try {
      perf = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          if (suViewer) risorsa(e);
          else if (!/^(xmlhttprequest|fetch|beacon|other)$/.test(e.initiatorType)) continue;
          try {
            const u = new URL(e.name);
            if (/^https?:$/.test(u.protocol) && (suViewer ? u.hostname !== VIEWER : !SISS.has(u.origin))) fuori.add(u.origin);
          } catch { /* niente */ }
        }
      });
      perf.observe({ type: "resource", buffered: true });
    } catch { perf = null; }
  }

  // ------------------------------------- il visualizzatore (PACS): com'è fatto
  // Le immagini mai: gli indirizzi data: escono dall'istantanea (le miniature,
  // gli sfondi), i canvas non hanno pixel nel DOM. Quello che si tiene è la
  // forma: numeri, tipi, percorsi senza i valori della query (e anche quelli,
  // all'esportazione, anonimizzati).
  const DATI_RE = /data:(?:image|application|video|audio|font)\/[^,"'\s<>)]{0,120},[^"'\s<>)]*/gi;
  const tipoSrc = (s) => {
    s = String(s || "");
    if (!s) return "vuoto";
    if (/^data:/i.test(s)) return "data:" + ((/^data:([\w.+/-]{1,40})/i.exec(s) || [])[1] || "").toLowerCase();
    if (/^blob:/i.test(s)) return "blob:";
    return /^(?:https?:|\/|[\w.-]+(?:[/?]|$))/i.test(s) ? "http" : "altro";
  };
  // un indirizzo senza i valori della query: origine, percorso, nomi dei parametri
  const senzaQuery = (s) => {
    try {
      const u = new URL(String(s), location.href);
      if (!/^(?:https?|wss?):$/.test(u.protocol)) return "";
      return (u.origin + u.pathname).slice(0, 400) + (u.search ? "?" + [...new Set(u.searchParams.keys())].sort().slice(0, 20).join("&") : "");
    } catch { return ""; }
  };
  const risorse = new Map();   // «tipo indirizzo» → misure (Resource Timing)
  function risorsa(e) {
    const k = `${String(e.initiatorType || "altro").slice(0, 20)} ${senzaQuery(e.name)}`;
    let x = risorse.get(k);
    if (!x) {
      if (risorse.size >= 300) return;
      x = { n: 0, trasferiti: 0, corpo: 0, decodificati: 0, max: 0, ms: 0, cache: 0 };
      risorse.set(k, x);
    }
    x.n++; x.trasferiti += e.transferSize || 0; x.corpo += e.encodedBodySize || 0; x.decodificati += e.decodedBodySize || 0;
    x.max = Math.max(x.max, e.encodedBodySize || 0); x.ms += Math.round(e.duration || 0);
    if (e.deliveryType === "cache" || (!e.transferSize && e.decodedBodySize)) x.cache++;
  }
  // la sonda nel mondo della pagina (registra-sonda.js): risponde subito, a un evento
  function sonda() {
    let r = null;
    const h = (e) => { if (typeof e.detail === "string" && e.detail.length < 300000) r = e.detail; };
    document.addEventListener("psa-sonda", h);
    try { document.dispatchEvent(new CustomEvent("psa-sonda-chiedi")); } finally { document.removeEventListener("psa-sonda", h); }
    try { return r ? JSON.parse(r) : null; } catch { return null; }
  }
  const schermo = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
  const aGruppi = (lista, chiave, fai, max) => {
    const m = new Map();
    for (const el of lista) {
      const k = chiave(el);
      if (!m.has(k)) { if (m.size >= max) continue; m.set(k, fai(el)); }
      m.get(k).n++;
    }
    return [...m.values()];
  };
  const srcDi = (im) => im.currentSrc || im.getAttribute("src") || "";
  const sfondoDi = (el) => (/url\(\s*['"]?([^'")]*)/i.exec(el.getAttribute("style") || "") || [])[1] || "";
  function tecnica() {
    const s = sonda();
    const canvas = [...document.querySelectorAll("canvas")].slice(0, 60).map((c, i) => {
      const x = s && Array.isArray(s.canvas) ? s.canvas[i] : null;
      return { larghezza: c.width, altezza: c.height, schermo: schermo(c), contesto: x ? x.tipo : null, preserveDrawingBuffer: x ? x.pdb : null, ...(x && x.wrf ? { willReadFrequently: true } : {}) };
    });
    const immagini = aGruppi([...document.images].slice(0, 3000), (im) => { const t = tipoSrc(srcDi(im)); return `${t} ${t === "http" ? senzaQuery(srcDi(im)) : ""}`; }, (im) => {
      const src = srcDi(im), tipo = tipoSrc(src);
      return { tipo, ...(tipo === "http" ? { indirizzo: senzaQuery(src) } : {}), ...(tipo.startsWith("data:") ? { caratteri: src.length } : {}),
        naturale: [im.naturalWidth, im.naturalHeight], schermo: schermo(im), n: 0 };
    }, 100);
    const sfondi = aGruppi([...document.querySelectorAll('[style*="url("]')].slice(0, 3000), (el) => tipoSrc(sfondoDi(el)), (el) => ({ tipo: tipoSrc(sfondoDi(el)), n: 0 }), 20);
    const riquadri = [...document.querySelectorAll("iframe, frame")].slice(0, 20).map((f) => ({ tipo: tipoSrc(f.getAttribute("src") || ""), indirizzo: senzaQuery(f.src || ""), schermo: schermo(f) }));
    return {
      sonda: !!s, elementi: document.getElementsByTagName("*").length, canvas, immagini, sfondi, riquadri,
      video: document.querySelectorAll("video").length, svg: document.querySelectorAll("svg").length, oggetti: document.querySelectorAll("object, embed").length,
      script: [...document.scripts].map((x) => x.src && senzaQuery(x.src)).filter(Boolean).slice(0, 60), scriptNellaPagina: [...document.scripts].filter((x) => !x.src).length,
      risorse: [...risorse].map(([chiave, x]) => ({ chiave, ...x })),
      ...(s ? { contesti: s.perTipo || {}, disegni: s.disegni || {}, websocket: Array.isArray(s.prese) ? s.prese.slice(0, 20) : [], blob: s.blob || {} } : {}),
    };
  }
  // i clic: dove (tag, classe, un testo corto, se è una miniatura), mai altro
  function descrivi(el) {
    const strada = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body && strada.length < 5; n = n.parentElement) {
      strada.push({ tag: n.tagName.toLowerCase(), ...(n.id ? { id: n.id.slice(0, 80) } : {}),
        ...(typeof n.className === "string" && n.className.trim() ? { classe: n.className.trim().slice(0, 120) } : {}),
        ...(n.getAttribute("role") ? { ruolo: n.getAttribute("role").slice(0, 30) } : {}) });
    }
    const img = el.tagName === "IMG" ? el : el.querySelector && el.querySelector("img");
    const src = img ? srcDi(img) : "";
    return { strada, testo: String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80), schermo: schermo(el),
      ...(img ? { img: { tipo: tipoSrc(src), ...(tipoSrc(src) === "http" ? { indirizzo: senzaQuery(src) } : {}), naturale: [img.naturalWidth, img.naturalHeight] } } : {}),
      ...(el.tagName === "CANVAS" || (el.querySelector && el.querySelector("canvas")) ? { canvas: true } : {}) };
  }
  if (suViewer) {
    for (const ev of ["click", "dblclick"]) {
      addEventListener(ev, (e) => {
        if (!attivo || !e.isTrusted) return;
        const el = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
        if (!el || (el.closest && el.closest(NOI))) return;
        try { manda({ t: "regClic", tipo: ev, ts: Date.now(), url: location.href, bersaglio: descrivi(el) }); } catch { /* niente */ }
      }, true);
    }
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
  // «Ferma e salva»: la pill resta il tempo di dire com'è andata
  let detto = "", dettoT = 0;
  const dici = (t, ms = 0) => { detto = t; clearTimeout(dettoT); if (ms) dettoT = setTimeout(() => { detto = ""; pill(); }, ms); pill(); };
  function pill() {
    if (!inAlto || !pronta) return;
    const vista = rec || !!detto;
    if (!vista || document.getElementById("psassist-host")) {
      if (ospite) { ospite.remove(); ospite = null; }
      if (rec && !attesaPannello) attesaPannello = setInterval(pill, 1000);
      if (!rec) { clearInterval(attesaPannello); attesaPannello = null; }
      return;
    }
    if (!attesaPannello) attesaPannello = setInterval(pill, 1000);   // il pannello può arrivare dopo (document_idle)
    if (ospite && ospite.isConnected) { scrivi(); return; }
    if (!document.documentElement) return;
    ospite = document.createElement("div");
    ospite.id = "psassist-reg-host";
    const root = ospite.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${globalThis.__psaPillCss || ""}
      .pill .dot.rec { background: #FF8A80; }
      .pill .slot { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; }   /* dove sta il logo */
      .menu[hidden] { display: none; }</style>
      <div class="wrap"><button class="pill" id="expand" title="PS Assist sta registrando questa sessione — tocca per fermare" aria-haspopup="menu" aria-expanded="false"><span class="slot"><span class="dot rec"></span></span> <span class="who">Registrando…</span></button>
      <div class="menu" role="menu" hidden><button role="menuitem" id="regferma">Ferma e salva</button></div></div>`;
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
    root.getElementById("regferma").addEventListener("click", (e) => {
      e.stopPropagation(); chiudiMenu();
      dici("Salvo la registrazione…");
      // anonimizzata e salvata nell'estensione, senza schede né scarichi: la si trova nel pannello
      manda({ t: "registraFerma" }, (x) => dici(x && x.ok ? "Salvata: ⋯ → Registrazioni" : "Non salvata: ⋯ → Registrazioni", 5000));
    });
    trascina(btn, wrap);
    document.documentElement.appendChild(ospite);
    scrivi();
    metti();
  }
  // la pill dice «Registrando…», o com'è andato «Ferma e salva»
  function scrivi() {
    const r = ospite && ospite.shadowRoot;
    if (!r) return;
    r.querySelector(".who").textContent = detto || "Registrando…";
    r.querySelector(".dot").hidden = !!detto;
    r.getElementById("expand").disabled = !!detto;
  }
})();
