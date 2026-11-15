//@frammento 05-utili.js — UTILS: sleep/esc, copia negli appunti, sorveglianza di chi scrive, codifica windows-1252,
//@ fetchDoc (con la traccia dei passi), serializzazione dei form.
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

  // Una pagina a cui ci ha portato il PANNELLO si apre con la finestra
  // aperta; una a cui è arrivato il medico dal gestionale, con la pill.
  const nav = (url) => {
    try { sessionStorage.setItem("psassist:navPannello.v1", JSON.stringify(Date.now())); } catch { /* niente */ }
    location.href = url;
  };
  const openTab = (url, name) => window.open(url, name);

  // Il medico sta scrivendo nel gestionale? Una navigazione decisa dal
  // programma (errore → carrello, revisione, conferma sospesa) non deve mai
  // portarsi via quello che ha sotto le dita: un campo col cursore dentro, un
  // campo cambiato e non salvato, un tasto premuto da poco. Allora non si va:
  // lo dice la pill, e un tocco porta dove si sarebbe andati.
  const TASTO_MS = 15e3;
  const scrittura = { tasto: 0, cambiato: false, toccato: false, nostri: new WeakSet(), attivo: false, pannello: 0, campoPannello: false };
  const dalGestionale = (e) => e.isTrusted && !(e.composedPath ? e.composedPath() : []).some((x) => x && x.id === "psassist-host");
  const nelPannello = (e) => (e.composedPath ? e.composedPath() : []).some((x) => x && x.id === "psassist-host");
  const NON_SCRITTURA = /^(button|submit|reset|image|hidden|checkbox|radio|file|range|color)$/i;
  const eCampo = (el) => !!el && el.id !== "psassist-host" && (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
    || (el.tagName === "INPUT" && !NON_SCRITTURA.test(el.type || "")));
  // L'ultimo clic o tasto del medico — nel gestionale o nel pannello, in
  // qualunque scheda (la memoria del browser), non nella scheda di stampa:
  // dopo un ordine il dialogo delle etichette si apre da solo SOLO se dalla
  // Conferma non ha toccato niente (toccatoDopo). Se no, un tocco su «Stampa».
  const TOCCO = "tocco.v1";
  let toccoQui = 0, toccoScritto = 0;
  const nellaStampa = (e) => (e.composedPath ? e.composedPath() : []).some((x) => x && x.id === "psassist-print");
  function segnaTocco() {
    toccoQui = Date.now();
    if (toccoQui - toccoScritto < 300) return;
    toccoScritto = toccoQui;
    try { localStorage.setItem(NS + TOCCO, String(toccoQui)); } catch { /* resta quello di questa scheda */ }
  }
  function toccatoDopo(t) {
    if (!t) return false;
    let l = 0;
    try { l = Number(localStorage.getItem(NS + TOCCO)) || 0; } catch { l = 0; }
    return Math.max(l, toccoQui) > t;
  }
  // il momento in cui il medico ha premuto Conferma (il giro, la conferma dal pannello o dal gestionale), in questa scheda
  const PREMUTO = "premuto.v1";
  // La Conferma dal pannello in questa pagina («Conferma per …», «Conferma e
  // stampa»): una volta sola, finché la pagina non se ne va. La Conferma vera
  // torna in 3–14 s, e intanto la pagina col bottone è ancora lì: un secondo
  // tocco manderebbe la stessa richiesta due volte. Il testo che i due bottoni
  // mostrano, spenti: «Confermo…», o perché non premono (confermaGiaPartita).
  let confermaPannello = "";
  function osservaScrittura() {
    if (scrittura.attivo) return;
    scrittura.attivo = true;
    document.addEventListener("keydown", (e) => { if (e.isTrusted && !nellaStampa(e)) segnaTocco(); }, true);
    document.addEventListener("pointerdown", (e) => { if (e.isTrusted && !nellaStampa(e)) segnaTocco(); }, true);
    document.addEventListener("keydown", (e) => {
      if (dalGestionale(e)) { scrittura.tasto = Date.now(); scrittura.toccato = true; }
      else if (e.isTrusted && nelPannello(e)) {
        // nel pannello si scrive in un suo campo; Ctrl+Invio è «Conferma», non scrivere
        const t = e.composedPath()[0];
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { scrittura.pannello = 0; scrittura.campoPannello = false; }
        else if (eCampo(t)) { scrittura.pannello = Date.now(); scrittura.campoPannello = true; }
      }
    }, true);
    // il cursore in un campo conta se ce l'ha messo lui (un campo col fuoco
    // automatico, appena caricata la pagina, non è qualcuno che scrive);
    // nel pannello, un tocco su un bottone («Conferma») vuol dire che ha smesso
    document.addEventListener("pointerdown", (e) => {
      if (dalGestionale(e)) scrittura.toccato = true;
      else if (e.isTrusted && nelPannello(e)) {
        scrittura.campoPannello = eCampo(e.composedPath()[0]);
        if (!scrittura.campoPannello) scrittura.pannello = 0;
      }
    }, true);
    const cambia = (e) => { if (dalGestionale(e) && eCampo(e.target)) scrittura.cambiato = true; };
    document.addEventListener("input", cambia, true);
    document.addEventListener("change", cambia, true);
  }
  // Nel pannello: il cursore in un suo campo (messo lì da lui), o un tasto da
  // poco in un suo campo. Conta solo per quello che lo interromperebbe adesso
  // (il dialogo di stampa), non per cambiare pagina.
  function scriveNelPannello() {
    const h = document.getElementById("psassist-host");
    const a = h && document.activeElement === h && h.shadowRoot ? h.shadowRoot.activeElement : null;
    return (scrittura.campoPannello && !!a && eCampo(a)) || Date.now() - scrittura.pannello < TASTO_MS;
  }
  // perché adesso non si cambia pagina ("" = si può). `adesso`: sta scrivendo
  // in questo momento (il cursore in un campo, un tasto da poco) — quello che
  // un dialogo di stampa interromperebbe; un campo cambiato e lasciato no.
  function staScrivendo(adesso = false) {
    if (scrittura.toccato && eCampo(document.activeElement)) return "cursore in un campo";
    if (adesso && scriveNelPannello()) return "scrivi nel pannello";
    if (adesso) return Date.now() - scrittura.tasto < TASTO_MS ? "un tasto premuto da poco" : "";
    if (scrittura.cambiato) return "un campo modificato";
    // il testo scritto prima che il programma arrivasse (il bookmarklet si clicca dopo).
    // Non nella scheda di un ordine: quella pagina l'ha aperta il programma, e
    // un campo diverso dal suo valore di partenza lì l'ha cambiato la pagina.
    if (!LAVORO) for (const t of document.querySelectorAll("textarea")) {
      if (!scrittura.nostri.has(t) && t.value !== t.defaultValue) return "un campo modificato";
    }
    if (Date.now() - scrittura.tasto < TASTO_MS) return "un tasto premuto da poco";
    return "";
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
  // La TRACCIA di un ordine: ogni pagina che il motore legge o manda mentre
  // lavora (quando, quanto ci ha messo, com'è andata, quali esami mostrava il
  // carrello, la pagina di accesso, un messaggio del gestionale). Serve al
  // registro degli errori per distinguere un problema del server da uno
  // nostro sui casi difficili («non risulta nel carrello», «non confermata»).
  // Solo numeri e codici: niente nomi. Nessuna richiesta in più.
  let TRACCIA = null;
  function avvisoGestionale(doc) {
    const el = doc.querySelector(".AFCErrorDataTD, .AFCError, .AFCErrorTD, font.AFCErrorDataTD");
    let t = el ? el.textContent : "";
    if (!t) for (const s of doc.querySelectorAll("script:not([src])")) { const m = /\balert\(\s*(['"])(.{1,300}?)\1\s*\)/.exec(s.textContent || ""); if (m) { t = m[2]; break; } }
    return String(t || "").replace(/\s+/g, " ").trim().slice(0, 200);
  }
  function annotaPasso(url, method, t0, err, r) {
    const T = TRACCIA;
    if (!T || !T.attiva || T.passi.length >= 120) return;
    let u = null;
    try { u = new URL(url, location.href); } catch { return; }
    const p = u.searchParams;
    const passo = { t: t0 - T.t0, ms: Date.now() - t0, m: method, pagina: p.get("MVPG") || p.get("ccsForm") || u.pathname.split("/").pop(),
      ...(p.get("Insert") ? { insert: p.get("PRESTAZIONE") || "" } : {}), ...(p.get("Delete") ? { delete: p.get("PRESTAZIONE") || "" } : {}),
      esito: err ? String(err.head || err.name || err.message || err).slice(0, 80) : "ok" };
    if (r && r.doc) {
      if (classify(r.doc) === "login") passo.login = true;
      if (/RcsRichiestaPrestazioniRicercaErogatore/.test(r.url)) {
        try { const em = examModel(r.doc, r.url); passo.carrello = em.exams.filter((e) => e.isDel).map((e) => String(e.code)); } catch { /* niente */ }
      }
      const av = avvisoGestionale(r.doc);
      if (av) passo.avviso = av;
    }
    T.passi.push(passo);
  }
  const riassuntoTraccia = () => {
    const T = TRACCIA;
    return T ? { ordine: T.ordine, esami: T.esami, scheda: T.scheda, visibile: T.visibile, nascostaDopo: T.nascosta || false,
      durata: Date.now() - T.t0, riprova: T.riprova, ...(T.ricreata ? { ricreata: true } : {}), passi: T.passi } : null;
  };
  async function fetchDoc(url, opts = {}) {
    const t0 = Date.now();
    const annota = (e, r) => { try { annotaPasso(url, opts.method || "GET", t0, e, r); } catch { /* la traccia non ferma mai il motore */ } };
    try {
      const r = await fetchDocVero(url, opts);
      annota(null, r);
      return r;
    } catch (e) { annota(e, null); throw e; }
  }
  async function fetchDocVero(url, { method = "GET", body = null, signal } = {}) {
    // Enforce, not just promise, that nothing ever leaves the hospital origin.
    const target = new URL(url, location.href);
    if (target.origin !== location.origin) {
      throw new StopError("Richiesta fuori dall'ospedale bloccata", `destinazione inattesa: ${target.origin}`);
    }
    await cancelloMotore(signal);   // un motore al lavoro altrove: si aspetta che finisca
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

