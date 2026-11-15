//@frammento 12-modelli-stampa-referti.js — PRINT MODEL (fogli e lavori di stampa) e REFERTI MODEL: diagnosi mascherata, nomi tolti,
//@ il PDF del visore (harvestInlinePdf), ESAME_DI, il prelievo come tabella.
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
  const SEL_FOGLI = 'a[title="Stampa Etichette"], a[title="Stampa Richiesta"], a[title="Stampa Prenotazione Esterna"], a[title="Stampa Richiesta Radiologia"], a[href*="REPORT=PsoRichiestaAccertamentiRadiografici"]';
  function printModel(doc, baseUrl) {
    const map = {}; // richiestaId -> { prog -> row, _meta }
    // (il foglio della radiologia ha più nomi — «Stampa Prenotazione Esterna»,
    // «Stampa Richiesta Radiologia», altri — ma un indirizzo solo: si
    // riconosce da quello, come titolo qualunque)
    for (const a of doc.querySelectorAll(SEL_FOGLI)) {
      const href = absUrl(a, "href", baseUrl);
      const rid = param(href, "RICHIESTA_ID");
      if (!rid) continue;
      const prog = param(href, "RICHIESTA_PROG") || "1";
      const rows = (map[rid] = map[rid] || { _meta: { ts: 0, when: "", exams: [] } });
      const row = (rows[prog] = rows[prog] || { prog });
      const t = a.getAttribute("title");
      if (t === "Stampa Etichette") row.etichette = href;
      else if (t === "Stampa Richiesta" && !/REPORT=PsoRichiestaAccertamentiRadiografici/i.test(href)) row.lista = href;
      else { row.prenotazione = href; row.esterna = t === "Stampa Prenotazione Esterna"; }
      // the row this print icon lives in also carries when + what was ordered
      const tr = a.closest("tr");
      if (tr) {
        const dt = istanteRiga(tr);
        if (dt && (!rows._meta.ts || dt.ts < rows._meta.ts)) { rows._meta.ts = dt.ts; rows._meta.when = dt.when; }
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
  // Il nome corto di un foglio, per le righe sotto la striscia: «Et» (le
  // etichette) o «Fg» (il foglio A4) e di chi è — «POC», «Lab», «RX» (la
  // prenotazione). Ogni erogatore ha la sua richiesta: la risorsa la dice la
  // lista esami (RISORSA_ID). Due laboratori nello stesso giro (Urgenze e
  // centrale) non si chiamano «Lab» tutti e due: il resto del nome di
  // ciascuno, il più corto («Urg»), e «Lab» quello che non ha altro.
  const resRiga = (r) => (r.lista ? param(r.lista, "RISORSA_ID") || "" : "");
  const tipoRes = (res) => {
    if (!res) return "";
    if (RADIO_SET.includes(res)) return "RX";
    const label = (fullCatalog()[res] || {}).label || "";
    if (!label) return "";
    return /\bPOC\b/i.test(label) ? "POC" : "Lab";
  };
  const restoNome = (res) => String((fullCatalog()[res] || {}).label || "")
    .replace(/\s*-\s*[A-Z]{2,4}\s*\(P\)\s*$/i, "").replace(/^LABORATORIO\s+(ANALISI\s*)?/i, "").trim();
  function nomiCorti(jobs) {
    const labs = [...new Set(jobs.filter((j) => j.res && tipoRes(j.res) === "Lab").map((j) => j.res))];
    const chi = (res) => {
      const t = tipoRes(res);
      if (t !== "Lab" || labs.length < 2) return t;
      const r = restoNome(res);
      return r ? r.charAt(0).toUpperCase() + r.slice(1, 3).toLowerCase() : "Lab";
    };
    for (const j of jobs) {
      if (!j.pre) continue;
      const c = j.pre === "Fg" && j.rx ? "RX" : chi(j.res);
      j.breve = `${j.pre === "Et" ? "et" : "fg"}:${c || ""}`;
    }
    return jobs;
  }
  // Jobs grouped by printer to minimise switching: every label PDF first
  // (etichettatrice), then every exam-list sheet, then radiology bookings.
  function printJobsFor(map, rid) {
    const rows = printRowsFor(map, rid);
    const multi = rows.length > 1;
    const tag = (r) => (multi ? ` — riga ${r.prog}` : "");
    const jobs = [];
    for (const r of rows) if (r.etichette) jobs.push({ name: `Etichette provette${tag(r)}`, pre: "Et", res: resRiga(r), printer: "etichettatrice", url: r.etichette });
    for (const r of rows) if (r.lista) jobs.push({ name: `Lista esami${tag(r)}`, pre: "Fg", res: resRiga(r), printer: "stampante normale", url: r.lista });
    for (const r of rows) if (r.prenotazione) jobs.push({ name: `${r.esterna ? "Prenotazione esterna" : "Richiesta radiologia"}${tag(r)}`, pre: "Fg", rx: true, printer: "stampante normale", url: r.prenotazione });
    const seen = new Set();
    return nomiCorti(jobs.filter((j) => !seen.has(j.url) && seen.add(j.url)));
  }
  // Le richieste che la pagina del paziente sa già stampare, PRIMA di un giro:
  // dopo la Conferma il gestionale fa una richiesta per erogatore (POC, lab
  // centrale…), ognuna col suo RICHIESTA_ID — i fogli da stampare sono quelli
  // delle richieste nuove, mai quelli di una che c'era già.
  const fotoRichieste = (doc, url) => { try { return Object.keys(printModel(doc, url)).slice(0, 200); } catch { return []; } };
  // Le richieste che la pagina sa stampare (cioè confermate), la più recente per prima.
  const richiesteStampabili = (map) => Object.keys(map).sort((a, b) => (printMeta(map, b).ts - printMeta(map, a).ts) || Number(b) - Number(a));
  // I fogli di più richieste in un giro solo: tutte le etichette, poi il resto.
  const fogliDi = (map, ids) => {
    const all = ids.map((id) => printJobsFor(map, id));
    return nomiCorti([...all.flatMap((j) => j.filter((x) => x.printer === "etichettatrice")), ...all.flatMap((j) => j.filter((x) => x.printer !== "etichettatrice"))]);
  };
  // «Ristampa»: l'ultimo ordine intero — la richiesta più recente, e con lei
  // le altre dello STESSO tocco su Conferma (una per erogatore: POC,
  // laboratorio, RX), come le ha annotate chi ne ha preso le etichette
  // (maybeAutoPrint: la scheda dell'ordine, o quella del medico — ricordaStampe).
  // Mai a occhio, dall'ora: una richiesta di tre minuti prima può essere un
  // altro ordine. Senza l'annotazione, la più recente sola. Al più quattro.
  function ultimeRichieste(map, ep = "") {
    const l = richiesteStampabili(map);
    if (!l.length) return [];
    const f = ep ? stampeVive()[String(ep)] : null;
    const gruppo = f && f.gesti ? Object.values(f.gesti).find((rids) => Array.isArray(rids) && rids.includes(String(l[0]))) : null;
    return gruppo ? l.filter((r) => gruppo.includes(String(r))).slice(0, 4) : [l[0]];
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
      const dt = istanteDa(td?.querySelector('input[name="DATA_ORD"]')?.value) || istanteRiga(a.closest("tr"));
      out.push({
        id, url, label,
        sistema: (param(url, "REFERTO_SISTEMA") || "").replace(/^HL7/, ""),
        ts: dt ? dt.ts : 0,
        when: dt ? dt.when : "—",
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
  // Il codice fiscale e le date intere, prima delle cifre: «VRDCRL50C12F###Z» e
  // «12/03/###» direbbero ancora nome, nascita e sesso.
  function mascheraDiagnosi(html) {
    return String(html || "")
      .replace(/(value\s*=\s*")[^"]*(")/gi, "$1…$2")
      .replace(/(value\s*=\s*')[^']*(')/gi, "$1…$2")
      .replace(/(?<![A-Za-z0-9])(?=[A-Za-z]{0,15}\d)[A-Za-z]{6}[\dLMNPQRSTUV]{2}[A-Za-z][\dLMNPQRSTUV]{2}[A-Za-z][\dLMNPQRSTUV]{3}[A-Za-z](?![A-Za-z0-9])/g, "[CF]")
      .replace(/(?<![\d/.-])\d{1,2}([/.-])\d{1,2}\1(?:\d{4}|\d{2})(?!\d)/g, "[data]")
      .replace(/(?<!\d)(?:1[89]|20)\d{2}-\d{1,2}-\d{1,2}(?!\d)/g, "[data]")
      .replace(/\d{3,}/g, "###")
      .slice(0, 16000);
  }
  // il quesito è l'unico testo clinico che può finire nel Registro: fuori dalla pagina (⧉ Copia, lo zip) non esce.
  // Una riga del Registro alla volta: da «quesito …: "» alla fine, anche se il quesito ha altre virgolette o un a capo.
  const senzaQuesito = (t) => String(t).replace(/(quesito[^:\n]*:\s*)"[\s\S]*/i, '$1"…"');
  function diagnosiTesto(d) {
    if (!d) return "";
    let dove = String(d.url || "");
    try { const u = new URL(d.url, location.href); dove = u.pathname + "?" + [...u.searchParams.keys()].join("&"); } catch { /* com'è */ }
    return [`PS Assist ${VERSION} · ${d.quando || ""} · ${d.cosa || ""}`, dove, d.diag || "", "---", mascheraDiagnosi(d.html)].join("\n");
  }
  // «⧉ Copia» (il Registro) e «⧉ Diagnosi» vanno negli appunti, e da lì in una
  // mail, una chat, una segnalazione. Prima passano dallo STESSO anonimizzatore
  // delle registrazioni (registra-anonimo.js, che il service worker mette la
  // prima volta nel mondo isolato del pannello, come pdf.js), coi pazienti che
  // il pannello conosce: nomi, codici fiscali, date, numeri dei casi diventano
  // quelli finti, come in testi/registro.txt e testi/diagnosi-N.txt dello zip.
  // Il resto del testo (una frase della pagina, un esame) resta, come nello zip.
  // Senza l'estensione, o se l'anonimizzatore non c'è: almeno i nomi che il
  // pannello conosce — interi, girati e parola per parola — e i codici fiscali.
  // Mai il testo com'è.
  let anonimoInArrivo = null;
  function anonimoPronto() {
    const c = () => !!(globalThis.RegistraAnonimo?.anonimizza && globalThis.__psaVocabolario);
    if (c()) return Promise.resolve(true);
    if (!hasExt() || TABELLONE) return Promise.resolve(false);
    return anonimoInArrivo = anonimoInArrivo || ask({ t: "anonimo" }).then((r) => { anonimoInArrivo = null; return !!(r && r.ok) && c(); });
  }
  // i pazienti che il pannello conosce: la lista (anche gli archiviati), chi aspetta al Triage, e chi dice chi chiama
  function nomiNoti(piu = []) {
    const s = new Set();
    const metti = (n) => { const t = String(n || "").replace(/\s+/g, " ").trim().slice(0, 60); if (t.length >= 4) s.add(t); };
    try { for (const p of tuttiPazienti()) metti(p && p.name); } catch { /* niente da qui */ }
    try { const t = store.get(TRIAGE_LISTA, null); for (const r of Array.isArray(t?.righe) ? t.righe : []) metti(r && r.nome); } catch { /* niente da qui */ }
    for (const n of piu) metti(n);
    return [...s].slice(0, 400);
  }
  const PARTICELLE_NOME = /^(?:DEL|DELLA|DELLE|DELLO|DEI|DEGLI|DAL|DALLA|DALLE|DALLO|VAN|VON|SAN|SANTA|SANTO|MAC)$/;
  // il ripiego: ogni nome noto (intero, girato, e ogni sua parola di 4 lettere o più) → «[paziente N]», i codici fiscali → «[CF]»
  function senzaNomiNoti(testo, nomi) {
    const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const L = "A-Za-zÀ-ÿ'’";
    let t = String(testo).replace(/(?<![A-Za-z0-9])(?=[A-Za-z]{0,15}\d)[A-Za-z]{6}[\dLMNPQRSTUV]{2}[A-Za-z][\dLMNPQRSTUV]{2}[A-Za-z][\dLMNPQRSTUV]{3}[A-Za-z](?![A-Za-z0-9])/g, "[CF]");
    const numero = new Map();
    const segno = (k) => { if (!numero.has(k)) numero.set(k, numero.size + 1); return `[paziente ${numero.get(k)}]`; };
    const interi = [], parole = new Map();
    for (const n of nomi) {
      const w = String(n).replace(/\s*[(\[].*$/, "").split(/[^A-Za-zÀ-ÿ'’]+/).filter(Boolean);
      if (w.length < 2) continue;
      const k = w.join(" ").toUpperCase();
      for (const o of [w, [...w].reverse()]) interi.push({ re: o.map(reEsc).join("(?:[\\s,.+_-]|&nbsp;|%20)+"), k });
      for (const x of w) if (x.length >= 4 && !PARTICELLE_NOME.test(x.toUpperCase()) && !parole.has(x.toUpperCase())) parole.set(x.toUpperCase(), k);
    }
    for (const { re, k } of interi.sort((a, b) => b.re.length - a.re.length)) t = t.replace(new RegExp(`(?<![${L}])${re}(?![${L}])`, "gi"), () => segno(k));
    if (parole.size) {
      const re = new RegExp(`(?<![${L}])(?:${[...parole.keys()].sort((a, b) => b.length - a.length).map(reEsc).join("|")})(?![${L}])`, "gi");
      t = t.replace(re, (m) => segno(parole.get(m.toUpperCase())));
    }
    return t;
  }
  // il testo da mettere negli appunti, e come è stato ripulito
  async function testoDaCopiare(nome, testo, piu = []) {
    const nomi = nomiNoti(piu);
    if (await anonimoPronto().catch(() => false)) {
      try {
        const r = globalThis.RegistraAnonimo.anonimizza({ inizio: Date.now(), origini: globalThis.__psaOrigini || { gestionale: location.origin }, pagine: [],
          testi: [{ nome, testo: String(testo) }], nomi }, { vocabolario: globalThis.__psaVocabolario });
        const t = r?.files?.[`testi/${nome}`];
        if (typeof t === "string") return { testo: t, come: "anonimizzato", punti: r.gate && !r.gate.ok ? r.gate.punti || 1 : 0 };
      } catch { /* il ripiego, qui sotto */ }
    }
    return { testo: senzaNomiNoti(testo, nomi), come: "nomi", punti: 0 };
  }
  const COPIA_COME = {
    anonimizzato: "(pseudonimizzato come le registrazioni: nomi, codici fiscali, date e numeri dei casi sono finti; il resto resta — rileggilo prima di mandarlo)",
    nomi: "(i nomi dei pazienti che il pannello conosce e i codici fiscali sono tolti; il resto resta com'è — rileggilo prima di mandarlo)",
  };
  const copiaAvviso = (c) => [COPIA_COME[c.come] || "", ...(c.punti ? [`ATTENZIONE: restano ${c.punti} dati da controllare`] : [])].filter(Boolean).join("\n");
  const bufDaB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  // I referti già aperti (o segnati «visti»), per episodio: gli altri sono
  // «nuovi». Solo gli id dei documenti, niente del loro contenuto; un giorno.
  function refertiVisti(ep) {
    const t = (store.get("refVisti.v1", {}) || {})[ep || "x"];
    return new Set(t && Date.now() - (t.ts || 0) < 24 * 3600e3 ? t.ids || [] : []);
  }
  function segnaVisti(ep, ids) {
    const tutti = store.get("refVisti.v1", {}) || {};
    const vivi = Object.fromEntries(Object.entries(tutti).filter(([, v]) => v && Date.now() - (v.ts || 0) < 24 * 3600e3));
    const k = ep || "x";
    vivi[k] = { ts: Date.now(), ids: [...new Set([...((vivi[k] && vivi[k].ids) || []), ...ids])].slice(-80) };
    store.set("refVisti.v1", vivi);
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
    (b.type.includes("pdf") || b.type === "" || b.type.includes("octet") || b.type.includes("download"));

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
      // (il segno dei messaggi della replica: a caso, non un contatore che uno script della pagina indovina)
      const cb = `__psaH${++harvestSeq}_${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
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
        if (!d || d.__psassist !== cb || e.source !== iframe.contentWindow) return;   // (solo dalla replica, col suo segno)
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
    // cK+, cNa+, ctHb, cGlu, cLac, Hctc… sono i nomi dell'emogasanalizzatore:
    // in un pacchetto con l'emocromo e l'EGA, quei valori sono dell'EGA
    if (/^c(?:K|Na|Ca|Cl|Glu|Lac|tHb|HCO3|tCO2|tO2|Base|Crea|Urea)(?![a-z])|^Hctc\b|^[as]BE\b/.test(String(nome || "").trim())) {
      const ega = tutti.filter((x) => eEga(x));
      if (ega.length === 1) return ega[0];
    }
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
    if (!rows || !rows.length) return null;
    // Senza data il prelievo NON sparisce: diventa una colonna «?». Un valore
    // che il medico vede, con l'ora dichiarata ignota, vale infinitamente più
    // di un valore buttato via in silenzio. L'accesso fa da identità, così due
    // prelievi senza ora restano due colonne e non si fondono.
    const ignota = !label;
    const id = String(meta?.id || "");
    // il titolo della richiesta viaggia con la colonna: in tabella lo dice il
    // tooltip dell'intestazione, e non serve più una riga per prelievo
    const date = [{
      data, ora, ignota, id,
      label: label || "?",
      chiave: ignota ? "?#" + (id || Math.random().toString(36).slice(2)) : label + "#1",
      titolo: String(meta?.label || "").replace(/\s+/g, " ").trim(),
    }];
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
    return { paziente: { idMPI: "", cognome: "", nome: nomeInPagina() },
             // le righe che il lettore ha rifiutato viaggiano con la tabella:
             // in Esiti si devono vedere, non solo nella finestra di origine
             cf: cf || "", periodo: "", date, righe,
             scartate: (scartate || []).filter((x) => x && x.nome).slice(0, 40), letto: Date.now() };
  }

