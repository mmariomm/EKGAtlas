//@frammento 16-esiti-carrello.js — WORKUP: richieste in attesa, fuori range, referti da scaricare (riprova, errori), esitiModel,
//@ fetchPdf, examModel e la lettura del carrello.
  // What a referto row is, from its own label: decides how it opens today and
  // which ones become inline text when their sources are wired (lab table, RX
  // and ECG referti). Anything else stays a document you open.
  // ------------------------------------------------------------ WORKUP
  // Quello che è stato chiesto e non è ancora refertato, dalla pagina del
  // paziente: le righe «RICH» del diario senza l'icona del referto. Chi ha la
  // finestra Risultati è un esame di laboratorio già in lavorazione (parziale).
  function richiesteInAttesa(doc) {
    const out = [];
    for (const tr of doc.querySelectorAll('tr[id="RICH"]')) {
      if (tr.querySelector('a[title="REFERTO"]')) continue;
      const icone = [...tr.querySelectorAll("img[title], a[title]")].map((x) => x.getAttribute("title") || "");
      const desc = tr.querySelector('input[name="DESCRIZIONE_TITLE"]')?.value || "";
      const esami = desc.split(";").map((x) => shortLabel(x.replace(/^\s*\d+-\d+\s*/, "")).trim()).filter(Boolean);
      if (!esami.length) continue;
      const dt = istanteRiga(tr);
      const tipo = esami.some((x) => /ELETTROCARDIOGRAMM|\bECG\b/i.test(x)) ? "ecg"
        : icone.includes("Radiologia") || esami.some((x) => /\bRX\b|RADIOGRAF|\bTC\b|\bTAC\b|ECOGRAF|RISONANZA|\bRMN\b/i.test(x)) ? "rx"
        : icone.includes("Laboratorio") ? "lab" : "altro";
      out.push({ tipo, esami, ts: dt ? dt.ts : 0, when: dt ? dt.when : "", parziale: icone.includes("Visualizza Risultati") });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }
  // Da quanto aspetta: gli istanti del gestionale sono ore «di muro» scritte
  // come UTC (vedi istanteDa), e l'adesso va scritto allo stesso modo.
  function attesaDa(ts) {
    if (!ts) return "";
    const d = new Date();
    const min = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) - ts) / 60e3);
    if (min < 0 || min > 48 * 60) return "";
    return min < 60 ? `${min}′` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
  }
  // La data di nascita del paziente, dal riquadro in testa alla scheda
  // («17/05/1949 (77) M»): serve solo a confrontarla col referto, non si tiene.
  function nascitaInPagina(doc = document) {
    const r = riquadroPaziente(doc);
    const m = r && /\b(\d{1,2}\/\d{1,2}\/\d{4})\s*\(\d{1,3}\)/.exec((r.textContent || "").replace(/\s+/g, " "));
    return m ? m[1] : "";
  }
  // Il codice fiscale scritto nel riquadro del paziente (uno solo, o niente).
  function cfInRiquadro(doc = document) {
    const r = riquadroPaziente(doc);
    const tutti = r ? [...new Set(((r.textContent || "").toUpperCase().match(new RegExp(CF_UNO.source, "g"))) || [])] : [];
    return tutti.length === 1 ? tutti[0] : "";
  }
  // La riga in cima agli Esiti: prima i valori fuori range dell'ultimo
  // prelievo di ciascun esame (i più gravi per primi), la troponina con la
  // misura precedente e la sua ora.
  const PRIMA_DI_TUTTI = ["K", "Na", "Hb", "Trop", "Lac", "pH", "Glu", "Cr", "PLT", "INR", "GB", "PCR", "Ca++", "pCO2", "pO2", "HCO3"];
  // «Critico» per il pallino rosso del letto: un analita fra quelli da guardare
  // per primi (PRIMA_DI_TUTTI). Non c'è altra soglia clinica nel codice: il
  // resto fuori range è «da guardare», non allarme.
  function analitaCritico(nome) {
    const s = siglaCurata(nome) ? sigla(nome) : String(nome).replace(/\s+/g, " ").trim().split(" ")[0];
    return PRIMA_DI_TUTTI.includes(s.replace(/^[A-Z]·/, ""));
  }
  function fuoriRangeUltimi(st) {
    if (!st || !st.righe) return [];
    const oggi = new Date();
    const gg = `${String(oggi.getDate()).padStart(2, "0")}/${String(oggi.getMonth() + 1).padStart(2, "0")}/${oggi.getFullYear()}`;
    const quando = (d) => (!d || d.ignota ? "" : d.data === gg ? d.ora || "" : `${String(d.data || "").slice(0, 5)}${d.ora ? " " + d.ora : ""}`);
    const out = [];
    for (const r of righeTabella(st.righe)) {
      let i = r.valori.length - 1;
      while (i >= 0 && !(r.valori[i] && r.valori[i].v)) i--;
      if (i < 0 || !r.valori[i].stato) continue;
      const s = siglaCurata(r.nome) ? sigla(r.nome) : String(r.nome).replace(/\s+/g, " ").trim().split(" ")[0];
      const nuda = s.replace(/^[A-Z]·/, "");
      let prima = null;
      if (nuda === "Trop") {
        let k = i - 1;
        while (k >= 0 && !(r.valori[k] && r.valori[k].v)) k--;
        if (k >= 0) prima = { v: r.valori[k].v, quando: quando(st.date[k]) };
      }
      const pos = PRIMA_DI_TUTTI.indexOf(nuda);
      out.push({ sigla: s, v: r.valori[i].v, stato: r.valori[i].stato, prima, ord: pos < 0 ? 99 : pos, nome: r.nome, col: i });
    }
    return out.sort((a, b) => a.ord - b.ord);
  }
  // Una riga per dire cosa dice un referto, sulla sua riga chiusa: le
  // conclusioni se ci sono, se no la prima frase che dice qualcosa — mai la
  // riga dell'esame o il titolo (sono già l'etichetta della riga), né
  // un'etichetta «Quesito: …», né l'intestazione, né il medico.
  function anteprimaReferto(righe) {
    const r = (righe || []).map((x) => String(x || "").trim()).filter(Boolean);
    const unaRiga = (t) => (t.length > 220 ? t.slice(0, 220).replace(/\s+\S*$/, "") + "…" : t);
    const i = r.findIndex((x) => /^(?:conclusion[ei]|in conclusione|impressione(?:\s+diagnostica)?)\b/i.test(x));
    if (i >= 0) {
      const dopo = r[i].replace(/^(?:conclusion[ei]|in conclusione|impressione(?:\s+diagnostica)?)\s*:?\s*/i, "");
      return unaRiga(dopo || r[i + 1] || "");
    }
    const parole = (x) => x.split(/\s+/).length;
    const minuscole = (x) => /[a-zà-ù]/.test(x);
    // la riga dell'esame («69-35 RX TORACE (6979) 01/10/2026 10:51») o, tutto maiuscolo, il titolo
    // dell'esame, l'intestazione del reparto o una riga corta. Una riga maiuscola di tre parole o
    // più, se no, è il referto: molti li scrivono così («NON FOCOLAI BRONCOPNEUMONICI IN ATTO.»)
    const titolo = (x) => /^\d+-\d+\s+\S.*\(\s*[A-Z0-9]+\s*\)\s+\d/i.test(x) || (!minuscole(x) && (parole(x) < 3
      || /^(?:\d+-\d+\s+)?(?:RX|RADIOGRAFIA|TC|TAC|RM|RMN|ECOGRAFIA|ECOCOLORDOPPLER|ECG|ELETTROCARDIOGRAMMA|ANGIO-?TC|MAMMOGRAFIA|U\.\s?O|S\.\s?C|RADIOLOGIA|RADIODIAGNOSTICA|DIAGNOSTICA PER IMMAGINI|REPARTO|SERVIZIO|DIPARTIMENTO|STRUTTURA|UNIT[ÀA] OPERATIVA)\b/.test(x)));
    const meta = /^(?:quesito(?:\s+diagnostico)?|anamnesi|dati\s+clinici|notizie\s+cliniche|tecnica|metodica|indicazione|motivo|richiesta|esame|data|ora|paziente|medico|operatore|modalit[àa]|reparto|confronto|precedenti)(?![A-Za-zÀ-ÿ])[^:]{0,20}:/i;
    const intest = /ospedale|azienda|presidio|\bdott|\bdr\.|medico|paziente|\bnat[oa]\b|\bdata\b|pagina/i;
    const corpo = r.filter((x) => !titolo(x) && !meta.test(x) && !intest.test(x));
    // prima una frase scritta con le minuscole; una riga maiuscola solo se non ce n'è
    return unaRiga(corpo.find((x) => minuscole(x) && parole(x) >= 4)
      || corpo.find((x) => minuscole(x) && parole(x) >= 2)
      || corpo.find((x) => !minuscole(x))
      || r.find((x) => !titolo(x)) || r[0] || "");
  }
  // Al massimo due scaricamenti di referti insieme, per tutta la scheda: un
  // tocco su un referto e «Salva» passano dalla stessa fila.
  const scaricaRef = codaLimitata(1);   // uno alla volta
  const PAUSA_REF = [600, 1600];   // ms prima di ogni scaricamento in fila: mai a raffica
  // Il caricamento da solo all'apertura: per paziente, la firma del laboratorio
  // all'ultima lettura e quando si è ricontrollato un laboratorio a metà
  const AUTO_CARICA = "autoCarica.v1";
  // …e quello che, caricato da solo, non è riuscito: per episodio, chi (un
  // referto, o «lab» per i valori), quando, quante volte. Da solo lo si
  // riprova al più due volte, dopo 2 e dopo 10 minuti (i valori anche quando
  // la pagina del laboratorio è cambiata); un tocco o un bottone ci prova
  // sempre. Un PDF che si è rivelato di un altro paziente da solo non si
  // riprende più.
  const FALLITI = "autoFalliti.v1";
  const RIPROVA_MS = [2 * 60e3, 10 * 60e3];
  const fallito = (ep, id) => ((store.get(FALLITI, {}) || {})[ep] || {})[id] || null;
  function segnaFallito(ep, id, extra = {}) {
    if (!ep || !id) return;
    const t = store.get(FALLITI, {}) || {};
    for (const k of Object.keys(t)) if (!Object.values(t[k] || {}).some((r) => Date.now() - ((r && r.ts) || 0) < 24 * 3600e3)) delete t[k];
    const r = (t[ep] || {})[id];
    t[ep] = { ...(t[ep] || {}), [id]: { ...(r || {}), ts: Date.now(), n: ((r && r.n) || 0) + 1, ...extra } };
    store.set(FALLITI, t);
  }
  function togliFallito(ep, id) {
    const t = store.get(FALLITI, {}) || {};
    if (!t[ep] || !t[ep][id]) return;
    delete t[ep][id];
    if (!Object.keys(t[ep]).length) delete t[ep];
    store.set(FALLITI, t);
  }
  function riprovaDaSolo(ep, id, firma) {
    const r = fallito(ep, id);
    if (!r) return true;
    if (r.altro) return false;
    if (firma !== undefined && r.firma !== firma) return true;
    return r.n <= RIPROVA_MS.length && Date.now() - (r.ts || 0) >= RIPROVA_MS[r.n - 1];
  }
  // un PDF scelto che si rivela di un altro paziente: un errore del pannello
  const GRAVE_ALTRO = "Errore grave: questo PDF è di un altro paziente — non mostrato";
  // Il registro degli errori (uno solo: lo tiene il service worker, bg.js
  // segnaErrore). Da qui solo numeri, codici, impronte e messaggi nostri.
  function segnaErrore(tipo, dati = {}) {
    if (!hasExt()) return;
    let pagina = "";
    try { pagina = new URL(location.href).searchParams.get("MVPG") || ""; } catch { /* niente */ }
    ask({ t: "errore", tipo, dati, pagina }).catch(() => {});
  }
  const PARZ_MS = 10 * 60e3;
  // Che cosa la pagina dice del laboratorio, in una riga: cambia quando cambia
  // qualcosa. Nelle pagine vere una richiesta di laboratorio passa da
  // «Prenotata» a «Erogata» (con le finestre «Visualizza Risultati», un
  // RCS_ACCESSO_ID) a «REFERTO» (un REFERTO_ID del LIS): l'icona di stato, il
  // suo titolo e i link. Mentre è «Erogata» e i valori arrivano uno a uno, la
  // riga NON cambia: quello lo si ricontrolla aprendo gli Esiti.
  const TITOLI_FISSI = new Set(["Laboratorio", "Stampa Richiesta", "Stampa Etichette"]);
  function firmaLab(doc, baseUrl) {
    const rich = [];
    for (const tr of doc.querySelectorAll('tr[id="RICH"]')) {
      const t = [...tr.querySelectorAll("img[title], a[title]")].map((x) => x.getAttribute("title") || "");
      if (!t.includes("Laboratorio")) continue;
      const quando = tr.querySelector('input[name="DATA_ORD"]')?.value || "";
      rich.push(`${quando}|${t.filter((x) => !TITOLI_FISSI.has(x) && !/^OPERATORE|^\d+-\d+ /.test(x)).join(",")}`);
    }
    return JSON.stringify({
      ris: risultatiModel(doc, baseUrl).map((r) => r.id).sort(),
      ref: refertiModel(doc, baseUrl).filter((r) => refertoTipo(r) === "lab").map((r) => r.id).sort(),
      rich: rich.sort(),
    });
  }

  function refertoTipo(e) {
    const l = String(e.label || "").toUpperCase();
    const sis = String(e.sistema || "").toUpperCase();
    if (/ELETTROCARDIOGRAMM|\bECG\b/.test(l)) return "ecg";
    // il sistema che emette il referto dice il tipo meglio del nome: un referto
    // di laboratorio (LIS) con una «TC» nel nome è colesterolo totale o tempo di
    // coagulazione, non un torace — quindi LIS=laboratorio prima del regex imaging
    if (sis.includes("LIS")) return "lab";
    // the whole of radiology reads as text, not just plain films: the system
    // that issued the document says it better than the exam's name does
    if (sis.includes("RIS") || /\bRX\b|RADIOGRAF|\bTC\b|\bTAC\b|ECOGRAF|RISONANZA|\bRMN\b/.test(l)) return "rx";
    return "altro";
  }

  // Il testo che si legge da solo (salvando, aprendo gli Esiti): solo ECG e
  // radiografie. TC, ecografie, RM, visite si salvano e si aprono nel visore.
  function testoAuto(e) {
    const tipo = refertoTipo(e);
    return tipo === "ecg" || (tipo === "rx" && /\bRX\b|RADIOGRAF/i.test(String(e.label || "")));
  }

  // Quali sistemi di referti stanno nel portale (lo si scopre al primo tocco:
  // il link del gestionale rimanda là). Vale un turno, poi si riverifica.
  const nelPortale = (e) => {
    if (!hasExt() || !e || !e.sistema) return false;
    const t = (store.get("refPortale", {}) || {})[String(e.sistema).toUpperCase()];
    return !!t && Date.now() - t < 12 * 3600e3;
  };
  const segnaPortale = (e) => {
    if (!e || !e.sistema) return;
    store.set("refPortale", { ...(store.get("refPortale", {}) || {}), [String(e.sistema).toUpperCase()]: Date.now() });
  };

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
    if (!hop) await cancelloMotore(signal);   // (vedi fetchDocVero)
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
    let res, buf;
    try {
      try {
        res = await fetch(target.href, { signal: ctl.signal, credentials: "same-origin", cache: "no-store", redirect: "follow" });
      } catch (e) {
        // Solo l'errore di rete (TypeError) si traduce: timeout e stop
        // restano quello che sono. Quasi sempre è un rinvio verso un ALTRO
        // server (il RIS, gli ECG, il portale in http): la pagina del
        // gestionale non può leggerlo, il medico che clicca sì — per questo
        // il referto si apre ma non si lascia salvare.
        if (!(e instanceof TypeError)) throw e;
        throw new StopError("Non raggiungibile da qui", "rete, o rinvio a un altro server");
      }
      if (new URL(res.url || target.href).origin !== location.origin) {
        // si dice DOVE (solo il server: nell'indirizzo ci sono gli id del paziente)
        throw new StopError("Il documento sta su un altro server", `rimanda a ${new URL(res.url).origin}`);
      }
      if (!res.ok) throw new StopError(`Il server ha risposto HTTP ${res.status}`, res.statusText || "");
      // (il tempo è per la risposta; il corpo lo ferma chi chiama — la scheda di stampa chiusa, la scadenza delle etichette di un ordine)
      clearTimeout(tid);
      buf = await res.arrayBuffer();
    } finally {
      clearTimeout(tid);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    // Il tipo dichiarato è un'etichetta; i primi cinque byte sono il
    // documento. Un servlet che manda un PDF chiamandolo «text/html» o
    // «application/force-download» manda comunque un PDF, e buttarlo via per
    // il nome sarebbe l'unico errore vero: si guarda dentro.
    const magico = buf.byteLength > 4
      && String.fromCharCode(...new Uint8Array(buf, 0, 5)) === "%PDF-";
    if (magico || ctype.includes("pdf") || ctype.includes("octet-stream")) {
      return { blob: new Blob([buf], { type: "application/pdf" }), url: res.url || target.href,
               via: hop === 0 ? "diretto" : magico && !ctype.includes("pdf") ? `dichiarato ${ctype.split(";")[0] || "senza tipo"}` : "" };
    }
    if (ctype.includes("html") && hop < 2) {
      const text = new TextDecoder("windows-1252").decode(buf);
      const doc = new DOMParser().parseFromString(text, "text/html");
      if (classify(doc) === "login") throw new StopError("Sessione scaduta", "Fai l'accesso a SA4PSO e riprova la stampa.");
      const base = res.url || target.href;
      const tried = [];
      const fuoriQui = new Set();   // dove rimanda, quando rimanda a un altro server
      const attempt = async (raw, via) => {
        if (!raw || /^(javascript:|#|about:)/i.test(raw)) return null;
        if (++budget.n > MAX_TENTATIVI) return null;
        let u; try { u = new URL(String(raw).replace(/&amp;/gi, "&").trim(), base); } catch { return null; }
        if (u.origin !== location.origin && /^https?:$/.test(u.protocol)) fuoriQui.add(u.origin);
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
      // Il rinvio del visualizzatore delle etichette porta l'indirizzo del PDF
      // con dentro degli APICI:
      //   URL=…uploaddownloadservlet.rra2?…blobfield=…get_pdf('PSOWEB_HL7_123')…
      // Tagliarlo al primo apice dava un indirizzo monco — ed era l'unico
      // tentativo che il programma faceva, quindi le etichette non uscivano.
      // Dopo «URL=» finisce l'attributo: si prende tutto quello che resta.
      const meta = doc.querySelector('meta[http-equiv="refresh" i]')?.getAttribute("content") || "";
      const rinvio = /url\s*=\s*(.+)$/is.exec(meta);
      // Un rinvio verso un ALTRO server è il portale (ECG, radiologia): là il
      // referto si apre con un accesso a token, e la pagina lo scarica e lo
      // mostra da sé. Da qui non si legge e non ci si prova nemmeno (niente
      // replay, niente attese): chi chiama lo apre nel portale, in una scheda.
      if (rinvio) {
        let dest = null;
        try { dest = new URL(rinvio[1].trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim().replace(/&amp;/gi, "&"), base); } catch { /* niente */ }
        if (dest && dest.origin !== location.origin && /^https?:$/.test(dest.protocol)) {
          const x = new StopError("Il referto si apre nel portale", `rimanda a ${dest.origin}`);
          x.portale = dest.origin;
          throw x;
        }
      }
      domCands.push(rinvio ? rinvio[1].trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim() : undefined);
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
      try { return { ...(await harvestInlinePdf(target.href, { html: text, baseUrl: base, signal })), via: "replay del visualizzatore" }; }
      catch (e) {
        if (e?.name === "AbortError") throw e;
        const err = new ViewerError(target.href);
        // NB: questa diagnosi è l'unica cosa che dice, da uno schermo al
        // lavoro, com'è fatto il visualizzatore vero. Era morta: citava una
        // variabile che non esiste più, quindi al posto del ViewerError con la
        // diagnosi partiva un ReferenceError, e non si vedeva niente.
        const idQui = /\b[A-Z][A-Z0-9]*_[A-Z0-9]+_\d{6,}\b/.test(text);
        err.diag = `html ${Math.round(text.length / 1024)}KB · ${(text.match(/<script/gi) || []).length} script · ${(text.match(/<frame\b/gi) || []).length} frame · tentati ${tried.length} URL · id ${idQui ? "sì" : "no"} · upload ${/uploaddownloadservlet/i.test(text) ? "sì" : "no"}${fuoriQui.size ? ` · rimanda a ${[...fuoriQui].join(", ")}` : ""}`;
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
    // (RICHIESTA_PRESTAZIONE_PROG: la riga «Elimina» di un esame in carrello lo
    // porta, e da lì passerebbe in ogni rilettura dell'elenco)
    const DROP = ["Insert", "Delete", "MVPG", "ccsForm", "PRESTAZIONE", "BRANCA", "toPG", "RICHIESTA_PRESTAZIONE_PROG"];
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
    // «Risorsa» + «Cerca»: il modulo con cui la pagina cambia erogatore (vedi cambioErogatore)
    const filtro = doc.querySelector('form[name="RisorsaFiltro"]');
    const filtroUrl = filtro && filtro.getAttribute("action") ? absUrl(filtro, "action", baseUrl) : null;

    return {
      form, exams, res, resOptions, listUrl, richiestaId, filtro, filtroUrl,
      inCart: (code) => exams.some((e) => e.code === code && e.isDel),
      addLink: (code) => exams.find((e) => e.code === code && e.isAdd),
      confirmButton: form ? form.querySelector('input[type="submit"][name="Update"]') || form.querySelector('input[type="submit"][name="Update1"]') : null,
    };
  }

  // Cambiare erogatore come lo cambia la pagina: il suo modulo RisorsaFiltro
  // (la tendina «Risorsa», che la pagina manda da sola appena cambia),
  // all'indirizzo del modulo, col corpo che manda la pagina — RISORSA_ID e
  // s_PRESTAZIONE vuoto (l'elenco intero) — e il server risponde con l'elenco
  // di quell'erogatore. È così che il gestionale sposta la richiesta: una
  // semplice lettura dell'elenco di un altro erogatore glielo mostra, ma il
  // primo inserimento risponde «ORA-20965 … Progressivo richiesta già
  // utilizzato» (le registrazioni vere). Nella pagina salvata il modulo è
  // vuoto e i controlli gli stanno fuori (li lega il parser della pagina
  // viva): se `elements` non li ha, il corpo è quello, scritto. Solo il
  // modulo di QUESTA richiesta e di questo episodio; senza modulo, null.
  function cambioErogatore(m, res, { rid, ep }) {
    if (!m.filtro) return null;
    let u = null;
    try { u = new URL(m.filtroUrl); } catch { u = null; }
    const p = u && u.searchParams;
    if (!u || u.origin !== location.origin || !/^RisorsaFiltro(:|$)/.test(p.get("ccsForm") || "")
      || String(p.get("RICHIESTA_ID") || "") !== String(rid || "") || (p.has("EPISODIO_ID") && p.get("EPISODIO_ID") !== String(ep || ""))) {
      throw new StopError(`Non passo a ${risorsaCorta(res)}: il «Risorsa» di questa pagina non è della richiesta`, "Nessun esame inviato per questo erogatore.");
    }
    const altri = serializeForm(m.filtro, null).filter(([k]) => k !== "RISORSA_ID" && k !== "s_PRESTAZIONE");
    return { action: u.href, body: encodeFormBody([["RISORSA_ID", res], ["s_PRESTAZIONE", ""], ...altri]) };
  }

  // Che cosa c'è ancora nel carrello di questa sezione: le righe dell'elenco
  // col loro «Elimina» (codice e nome) e, nelle pagine vere, le righe della
  // tabella «Carrello Prestazioni» (RICHIESTA_PRESTAZIONE_PROG, senza
  // PRESTAZIONE) che l'elenco non mostra già. Il «Svuota carrello» non ha né
  // l'una né l'altra: non è una riga.
  function righeVive(doc, m) {
    const out = m.exams.filter((e) => e.isDel).map((e) => ({ res: m.res, code: String(e.code), label: e.label }));
    const visti = new Set(out.map(nomeRiga));
    for (const a of doc.querySelectorAll('a[href*="Delete=Elimina"]')) {
      let p;
      try { p = new URL(a.getAttribute("href"), location.href).searchParams; } catch { continue; }
      if (p.has("PRESTAZIONE") || !p.has("RICHIESTA_PRESTAZIONE_PROG")) continue;
      const r = { res: m.res, code: null, label: (a.closest("tr")?.textContent || "").replace(/\s+/g, " ").trim().replace(/^\d+-\d+\s*/, "") };
      if (!visti.has(nomeRiga(r))) { visti.add(nomeRiga(r)); out.push(r); }
    }
    return out;
  }
  const nomeRiga = (r) => (r.code ? DISPLAY[`${r.res}:${r.code}`] : "") || shortLabel(r.label) || "una riga senza nome";
  const righeCarrello = (doc, m) => righeVive(doc, m).map(nomeRiga);
  // Il carrello vero di una richiesta, sezione per sezione, riletto dal
  // server (solo letture): ogni pagina dev'essere di quella richiesta, di
  // quell'episodio e di quella sezione — e non la pagina di accesso.
  async function leggiSezione(model0, res, { rid, ep, signal, cosa = "Niente toccato" }) {
    const u = model0.listUrl(res);
    if (!u) throw new StopError("Non ritrovo il carrello della richiesta", "Controllalo a mano.");
    const r = await fetchDoc(u, { signal });
    if (classify(r.doc) === "login") {
      const e = restaQui(new StopError("Sessione scaduta durante l'operazione", `${cosa}. Rifai l'accesso e controlla il carrello.`));
      e.sessione = true;
      throw e;
    }
    assertSameEpisode(r.doc, ep, "carrello");
    if (classify(r.doc) !== "exam") throw new StopError("Non ritrovo il carrello della richiesta", "Controllalo a mano.");
    const m = examModel(r.doc, r.url);
    if (String(m.richiestaId) !== String(rid)) throw restaQui(new StopError("Non è il carrello di questa richiesta", "Mi fermo qui."));
    if (m.res !== res) throw new StopError(`Non apro la sezione ${risorsaCorta(res)} del carrello`, "Controllalo a mano.");
    return { res, m, doc: r.doc, url: r.url, righe: righeVive(r.doc, m) };
  }
  async function leggiCarrello(model0, opz) {
    const sezioni = [];
    for (const res of new Set([model0.res, ...model0.resOptions.map((o) => o.value)].filter(Boolean))) sezioni.push(await leggiSezione(model0, res, opz));
    return { sezioni, righe: sezioni.flatMap((s) => s.righe) };
  }
  // Che cosa rimette «Svuota il carrello e ricomincia»: la selezione di
  // partenza e, in più, ogni riga del carrello vero che non ne fa parte
  // (aggiunta a mano, o rimasta da un giro di prima) — per codice, col nome
  // del catalogo, che dev'essere quello che la riga porta oggi: svuotare non
  // deve mai far sparire un esame. Una riga che non si saprebbe rimettere
  // ferma tutto prima di togliere qualunque cosa. (`nostri`: con quale codice
  // sono entrati gli esami del giro — un riflesso ne cambia il numero.)
  function daRimettere(righe, sel, nostri = [], cat = fullCatalog()) {
    const noti = [...sel, ...nostri];
    const suo = (r) => noti.some((x) => (String(x.res) === String(r.res) && String(x.code) === String(r.code)) || stessoNomeVivo(x.label, r.label));
    const extra = [], ignoti = [];
    for (const r of righe) {
      if (suo(r)) continue;
      const label = r.code ? (cat[r.res]?.items || {})[r.code] : "";
      if (label && stessoNomeVivo(label, r.label)) {
        const it = { res: r.res, code: r.code, label, display: displayLabel(r.res, r.code) };
        extra.push(it); noti.push(it);
      } else ignoti.push(nomeRiga(r));
    }
    return { items: [...sel, ...extra], extra, ignoti };
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

