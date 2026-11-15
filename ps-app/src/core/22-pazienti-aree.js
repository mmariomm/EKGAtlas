//@frammento 22-pazienti-aree.js — KNOWN PATIENTS (i pazienti del turno; nome, CF, età in pagina), AREE (lista d'area, apriArea,
//@ lavoro d'area, lista smart) e le costanti del TABELLONE.
  // ------------------------------------------------------- KNOWN PATIENTS
  // I pazienti su cui si è lavorato, per ritrovarli dalla schermata iniziale:
  // nome, episodio, indirizzo della pagina, il colore di triage e l'età che la
  // sua intestazione mostra (il numero, mai la data di nascita: di quella solo
  // un'impronta, `nato`, per riconoscerlo nella lista smart). Anche chi la
  // lista di un'area mostra entra qui (`lista`: l'ultima volta che c'era), con
  // `ts` a 0 finché non lo apri. Un turno è di
  // dodici ore e i pazienti sono più di dodici, quindi l'elenco tiene un giorno
  // e non ha un limite che dia fastidio. Qui non entra MAI altro contenuto clinico (né esami,
  // né valori, né quesito): quello sta nella scheda, che è un'altra cosa.
  // Chi viene dimesso si ARCHIVIA: esce dall'elenco principale e resta negli
  // archiviati, da dove si può riportare indietro o cancellare del tutto.
  const PATIENTS_TTL = 24 * 3600e3;
  const PATIENTS_MAX = 150;
  // l'ultima volta che l'hai visto: aperto, o nella lista della sua area
  const vistoTs = (p) => Math.max(p?.ts || 0, p?.lista || 0);
  // aperto in questo turno (dodici ore): dal PC, o col tocco sul telefono. Solo
  // di questi il PC rilegge la pagina da sé (il ⟳ del tabellone, gli esiti sul telefono)
  const TURNO_MS = 12 * 3600e3;
  const apertoNelTurno = (p, ora = Date.now()) => !!p?.ts && ora - p.ts < TURNO_MS;

  function tuttiPazienti() {
    const list = store.get("patients.v1", []);
    const fresh = Array.isArray(list) ? list.filter((p) => p && p.ep && Date.now() - vistoTs(p) < PATIENTS_TTL)
      .map((p) => (p.name && NON_NOME.test(p.name) ? { ...p, name: "" } : p)) : [];
    return fresh.sort((a, b) => (b.ts || 0) - (a.ts || 0) || vistoTs(b) - vistoTs(a)).slice(0, PATIENTS_MAX);
  }
  const knownPatients = () => tuttiPazienti().filter((p) => !p.arch);
  const pazientiArchiviati = () => tuttiPazienti().filter((p) => p.arch);
  // Il codice colore del triage, come lo mostra l'intestazione della scheda:
  // un elemento col titolo esatto. Le righe del diario (.myRiepilogo) portano
  // il colore di quando sono state scritte, e non contano.
  const TRIAGE_COLORI = ["ROSSO", "ARANCIONE", "AZZURRO", "VERDE", "BIANCO"];
  function triageDi(doc) {
    for (const el of doc.querySelectorAll("[title]")) {
      const t = (el.getAttribute("title") || "").trim();
      if (TRIAGE_COLORI.includes(t) && !el.closest(".myRiepilogo")) return t;
    }
    return "";
  }
  // Chi è il paziente di QUESTA pagina lo dice il riquadro in testa alla
  // scheda — episodio, NOME, nascita, codice fiscale, motivo — quello col
  // colore del triage. Il titolo della scheda del browser NON è un nome: su
  // molte pagine il gestionale ci scrive «ROSSI MARIO», su altre «Pronto
  // Soccorso» o «PRONTO SOCCORSO - LISTA», e prenderlo per un nome faceva
  // entrare in elenco un paziente chiamato «Pronto Soccorso». Il titolo resta
  // solo un ripiego, dove il riquadro non c'è, e solo se sembra un nome.
  const NON_NOME = /pronto\s*soccorso|\blista\b|sa4pso|gestionale/i;
  const pareNome = (t) => !!t && t.length >= 3 && t.length <= 80 && !/\d/.test(t) && /[a-z]/i.test(t) && !NON_NOME.test(t);
  function riquadroPaziente(doc) {
    for (const el of doc.querySelectorAll("td[title]")) {
      if (TRIAGE_COLORI.includes((el.getAttribute("title") || "").trim()) && !el.closest(".myRiepilogo") && el.querySelector("font")) return el;
    }
    return null;
  }
  function nomeInPagina(doc = document) {
    const r = riquadroPaziente(doc);
    if (r) {
      // il nome è la riga scritta più grande del riquadro
      let nome = null, max = 0;
      for (const f of r.querySelectorAll("font")) {
        const m = /font-size:\s*(\d+)%/i.exec(f.getAttribute("style") || "");
        if (m && Number(m[1]) > max) { max = Number(m[1]); nome = f; }
      }
      const t = (nome?.textContent || "").replace(/\s+/g, " ").trim();
      if (pareNome(t)) return t;
    }
    const t = (doc.title || "").replace(/\s+/g, " ").trim();
    return pareNome(t) ? t : "";
  }
  // Accanto al codice fiscale, nel riquadro in testa alla scheda, un'icona
  // che lo copia. È la sola cosa che il pannello aggiunge alla pagina del
  // gestionale: piccola, del colore del testo, e il suo clic non arriva al
  // doppio clic del riquadro (che riporta alla home dell'episodio).
  const CF_UNO = /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/;
  const ICO_COPIA = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICO_FATTO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';
  function iconaCf(doc = document) {
    const r = riquadroPaziente(doc);
    if (!r || r.querySelector(".psassist-cf")) return;
    const giro = doc.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    for (let n = giro.nextNode(); n; n = giro.nextNode()) {
      const m = CF_UNO.exec((n.nodeValue || "").toUpperCase());
      if (!m) continue;
      const cf = m[0];
      const dopo = n.splitText(m.index + cf.length);
      const b = doc.createElement("span");
      b.className = "psassist-cf";
      b.setAttribute("role", "button");
      b.tabIndex = 0;
      b.title = "Copia il codice fiscale";
      b.setAttribute("aria-label", "Copia il codice fiscale");
      b.style.cssText = "display:inline-flex;align-items:center;vertical-align:-2px;margin-left:7px;cursor:pointer;opacity:.85;line-height:0";
      b.innerHTML = ICO_COPIA;
      let t = 0;
      const copia = async (e) => {
        e.preventDefault(); e.stopPropagation();
        const ok = await copiaTesto(cf);
        b.innerHTML = ok ? ICO_FATTO : ICO_COPIA;
        b.title = ok ? "Copiato" : "Non copiato: riprova";
        clearTimeout(t);
        t = setTimeout(() => { b.innerHTML = ICO_COPIA; b.title = "Copia il codice fiscale"; }, 1600);
      };
      b.addEventListener("click", copia);
      b.addEventListener("dblclick", (e) => e.stopPropagation());
      b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") copia(e); });
      b.addEventListener("mouseenter", () => { b.style.opacity = "1"; });
      b.addEventListener("mouseleave", () => { b.style.opacity = ".85"; });
      n.parentNode.insertBefore(b, dopo);
      return;
    }
  }
  // L'età: la riga in corpo 120% del riquadro la dice dopo la data di nascita
  // («17/05/1949 (77) M»); se no, dal codice fiscale. Si tiene solo il numero,
  // mai la data.
  function etaDaCf(cf) {
    if (!/^[A-Z]{6}[\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{2}/.test(cf)) return null;
    const n = (t) => Number(t.replace(/[LMNPQRSTUV]/g, (c) => "LMNPQRSTUV".indexOf(c)));
    const mese = "ABCDEHLMPRST".indexOf(cf[8]), giorno = n(cf.slice(9, 11)) % 40, oggi = new Date();
    if (mese < 0 || !giorno) return null;
    // il secolo non c'è: nato nel 2000 e qualcosa, o cent'anni prima
    const eta = oggi.getFullYear() - 2000 - n(cf.slice(6, 8)) - (oggi.getMonth() < mese || (oggi.getMonth() === mese && oggi.getDate() < giorno) ? 1 : 0);
    return eta < 0 ? eta + 100 : eta;
  }
  // la data di nascita della riga in corpo 120% del riquadro: solo per farne l'impronta
  function nascitaInPagina(doc = document) {
    const r = riquadroPaziente(doc);
    if (!r) return "";
    for (const f of r.querySelectorAll("font")) {
      const m = /font-size:\s*120%/i.test(f.getAttribute("style") || "") && /\b(\d{1,2}\/\d{1,2}\/\d{4})\s*\(\d{1,3}\)/.exec(f.textContent || "");
      if (m) return m[1];
    }
    return "";
  }
  function etaInPagina(doc = document) {
    const r = riquadroPaziente(doc);
    if (!r) return null;
    // riga per riga (fra un <br> e l'altro il testo si attaccherebbe)
    const righe = [];
    const giro = doc.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    for (let n = giro.nextNode(); n; n = giro.nextNode()) righe.push([n.parentElement?.closest("font")?.getAttribute("style") || "", (n.nodeValue || "").toUpperCase()]);
    for (const [stile, t] of righe) {
      const m = /font-size:\s*120%/i.test(stile) && /\b\d{1,2}\/\d{1,2}\/\d{4}\s*\((\d{1,3})\)/.exec(t);
      if (m) return Number(m[1]);
    }
    const cf = righe.map(([, t]) => CF_UNO.exec(t)).find(Boolean);
    return cf ? etaDaCf(cf[0]) : null;
  }
  function rememberPatient(ep, name, url, triage, eta, sesso, nato) {
    if (!ep) return;
    // noto finora solo dalla lista smart: la sua pagina dà l'episodio (posto, «Da fare» e area lo seguono)
    if (nato) {
      const tutti = store.get("patients.v1", []);
      if (Array.isArray(tutti) && fondiSmart(tutti, ep, name, nato)) store.set("patients.v1", tutti);
    }
    const prima = tuttiPazienti().find((p) => p.ep === ep);
    const list = tuttiPazienti().filter((p) => p.ep !== ep);
    // il triage è quello letto all'ultima apertura; se la pagina non lo dice,
    // resta quello di prima
    const tr = TRIAGE_COLORI.includes(triage) ? { triage, triageTs: Date.now() }
      : prima?.triage ? { triage: prima.triage, triageTs: prima.triageTs || 0 } : {};
    const anni = Number.isInteger(eta) && eta >= 0 && eta < 130 ? eta : prima?.eta;
    // riaprire un paziente archiviato lo riporta fra i vivi: se sei sulla sua
    // pagina, è di lui che ti stai occupando
    list.unshift({ ep, name: ((name || "").trim() || prima?.name || "").slice(0, 60), url: (url || "").split("#")[0], ts: Date.now(),
                   pk: prima?.pk || "", ...tr, ...(Number.isInteger(anni) ? { eta: anni } : {}),
                   ...(sesso === "M" || sesso === "F" ? { sesso } : prima?.sesso ? { sesso: prima.sesso } : {}),
                   ...(nato || prima?.nato ? { nato: nato || prima.nato } : {}), ...(prima?.lista ? { lista: prima.lista } : {}),
                   ...(prima?.arrivo ? { arrivo: prima.arrivo } : {}) });
    store.set("patients.v1", list.slice(0, PATIENTS_MAX));
    // la sua area, se nessuna lista l'ha ancora detta: quella in testa a questa pagina
    const a = areeLeggi(), ora = store.get(AREA_ORA, null);
    if (!a.membri[ep] && ora && ora.k) { a.membri[ep] = { k: ora.k, ts: Date.now() }; store.set(AREE, a); }
  }
  // ------------------------------------------------------------------ AREE
  // L'area in cui lavora il medico (Alta intensità, OBI, Bassa, Codici
  // minori…) è un'impostazione del gestionale, sul server: si sceglie in
  // PsoPsoImposta (la tendina RISORSA_ID e «Conferma») e ogni pagina la dice
  // in testa. Le opzioni si leggono dalla pagina e si riconoscono dal nome;
  // un nome che non si riconosce resta il suo. Chi sta in quale area lo dice
  // la LISTA dell'area (PsoPazientiAmbulatorio), ogni volta che il medico la
  // apre: niente si chiede al server da solo.
  const AREE = "aree.v1";              // { membri: {ep: {k, ts, n?}}, viste: {k: {label, ts}} } — n: la riga nella lista del gestionale; se ne va col reset
  const AREA_ORA = "area.corrente.v1"; // l'area in testa all'ultima pagina: {k, label, id, ts}
  const AREE_OPZ = "aree.opzioni.v1";  // le opzioni di PsoPsoImposta: {k: {id, label}} — un'impostazione, resta
  const AREA_VAI = "area.vai.v1";      // un passaggio d'area in corso: {k, chi?, ts, premuto?}
  const AREA_VAI_MS = 45e3;
  const AREE_ORDINE = ["alta", "bassa", "obi", "minori"];
  const AREE_TITOLO = { alta: "Alta intensità", obi: "OBI", bassa: "Bassa", minori: "Codici minori" };
  const spazi = (t) => String(t || "").replace(/\s+/g, " ").trim();
  function chiaveArea(label) {
    const t = String(label || "").replace(/\s+/g, " ").trim().toUpperCase();
    if (!t) return "";
    if (/\bALTA\b/.test(t)) return "alta";
    if (/\bOBI\b/.test(t)) return "obi";
    if (/\bMEDIA\b|\bBASSA\b/.test(t)) return "bassa";
    if (/\bMINOR/.test(t)) return "minori";
    return "x:" + t.slice(0, 40);
  }
  const titoloArea = (k, label) => AREE_TITOLO[k] || spazi(label) || String(k || "").replace(/^x:/, "") || "Area";
  // ogni area ha la sua mappa: l'Alta la sua, tutte le altre quella del PS
  const mappaDiArea = (k) => (k === "alta" ? "alta" : "ps");
  const ordineArea = (k) => (AREE_ORDINE.includes(k) ? AREE_ORDINE.indexOf(k) : AREE_ORDINE.length);
  // La riga di un paziente nella lista del gestionale (l'ultima lista intera che
  // l'ha letto): è l'ordine della lista dei Pazienti. Una lista filtrata o monca
  // non lo cambia; cambiando area, quello di prima non vale più.
  const rigaDi = (prima, k, n) => (Number.isInteger(n) ? { n } : prima && prima.k === k && Number.isInteger(prima.n) ? { n: prima.n } : {});
  function areeLeggi() {
    const a = store.get(AREE, null), ok = (x) => x && typeof x === "object" && !Array.isArray(x);
    return { membri: ok(a?.membri) ? a.membri : {}, viste: ok(a?.viste) ? a.viste : {} };
  }
  // Un'impronta della data di nascita (FNV-1a): la data non si tiene, ma una
  // riga della lista smart si riconosce lo stesso, col nome.
  function improntaNascita(d) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d || "").trim());
    if (!m) return "";
    let h = 0x811c9dc5;
    for (const c of `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
    return h.toString(36);
  }
  // L'area in testa alla pagina: «AREA ALTA INTENSITA'» in corpo 110%, e il
  // numero della risorsa («00010001P») accanto.
  function areaInTesta(doc) {
    const f = [...doc.querySelectorAll(".AFCHeaderTable font")].find((x) => /font-size:\s*110%/i.test(x.getAttribute("style") || "")
      && /bold/i.test(x.getAttribute("style") || "") && spazi(x.textContent));
    if (!f) return null;
    const label = spazi(f.textContent).slice(0, 60), k = chiaveArea(label);
    const id = (/\b(\d{8}[A-Z])\b/.exec(f.closest(".AFCHeaderTable").textContent || "") || [])[1] || "";
    return k ? { k, label, id } : null;
  }
  const mvpgDi = (doc, url) => {
    const m = param(url, "MVPG");
    if (m && !param(url, "ccsForm")) return m;
    // dopo un modulo inviato l'indirizzo è quello del modulo: lo dice il filtro della pagina
    const f = doc.querySelector('form[name="PazientiFiltro"]');
    try { return f ? param(new URL(f.getAttribute("action") || "", url).href, "MVPG") || "" : m || ""; } catch { return m || ""; }
  };
  // la lista dell'area (non la smart, che le ha tutte; non un'altra scheda)
  const eListaArea = (doc, url) => !!doc.querySelector('form[name="PazientiFiltro"][action*="MVPG=PsoPazientiAmbulatorio"]')
    || (param(url, "MVPG") === "PsoPazientiAmbulatorio" && !!doc.querySelector(".AFCHeaderTable"));
  const eSmart = (doc, url) => param(url, "MVPG") === "PsoPazientiSmart" || !!doc.querySelector('form[name="PazientiFiltro"][action*="MVPG=PsoPazientiSmart"]');
  // nome e nascita dalla linguetta di una riga: «<strong>ROSSI MARIO</strong><br>05/07/1947(79)»
  function linguettaDi(div) {
    const cella = [...div.querySelectorAll("td")].find((td) => td.querySelector("strong") && /\d{1,2}\/\d{1,2}\/\d{4}/.test(td.textContent || ""));
    if (!cella) return null;
    const name = spazi(cella.querySelector("strong").textContent).slice(0, 60);
    const m = /(\d{1,2}\/\d{1,2}\/\d{4})\s*\((\d{1,3})\)/.exec(cella.textContent || "");
    const triage = TRIAGE_COLORI.find((c) => c === (cella.getAttribute("title") || "").trim()) || "";
    return name ? { name, nato: m ? m[1] : "", eta: m ? Number(m[2]) : null, triage } : null;
  }
  // L'ingresso in PS: «21/09/2026 08:54» (la smart) o «08:48» (la lista
  // dell'area: oggi, o ieri se l'ora non è ancora venuta). 0 se non si legge.
  function arrivoDa(t, ora = Date.now()) {
    const s = spazi(t);
    let m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(s);
    if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime(); return d <= ora + 5 * 60e3 && ora - d < 7 * 864e5 ? d : 0; }
    m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m || +m[1] > 23 || +m[2] > 59) return 0;
    const d = new Date(ora);
    d.setHours(+m[1], +m[2], 0, 0);
    return d.getTime() > ora + 5 * 60e3 ? d.getTime() - 864e5 : d.getTime();
  }
  // Le righe della lista di un'area: ognuna col SUO link alla cartella.
  function righeLista(doc, base) {
    const out = [], visti = new Set();
    for (const a of doc.querySelectorAll('a[href*="MVPG=PsoEpisodioClinicoAmbulatorio"]')) {
      const div = a.querySelector(".myLinguetta");
      if (!div) continue;
      let url;
      try { url = new URL(a.getAttribute("href"), base).href; } catch { continue; }
      const ep = param(url, "EPISODIO_ID"), l = linguettaDi(div);
      if (!ep || !/^[\w.-]{1,40}$/.test(ep) || !l || visti.has(ep)) continue;
      visti.add(ep);
      out.push({ ep, url, a, ...l, arrivo: arrivoDa(a.closest("tr")?.querySelector('td[name="INGRESSO"]')?.textContent) });
    }
    return out;
  }
  // «Ambulatorio (8)»: quante righe la lista dice di avere
  const contoLista = (doc) => {
    const t = spazi(doc.querySelector('a.shiny-button-selected[href*="MVPG=PsoPazientiAmbulatorio"]')?.textContent);
    const m = /\((\d+)\)\s*$/.exec(t);
    return m ? Number(m[1]) : null;
  };
  // Le opzioni della tendina dell'area, in PsoPsoImposta
  const opzioniArea = (doc) => [...doc.querySelectorAll('select[name="RISORSA_ID"] option')]
    .map((o) => ({ id: String(o.value || ""), label: spazi(o.textContent).slice(0, 60), k: chiaveArea(o.textContent) }))
    .filter((o) => o.id && o.k);

  // Ogni pagina del gestionale: l'area in testa; la lista di un'area ne
  // rifà i membri — chi c'è ci sta, chi non c'è più ne esce — e chi c'è
  // entra fra i pazienti (nome, episodio, il link della sua riga). Una lista
  // filtrata o monca (le righe non sono quante dice la sua scheda) aggiunge e
  // basta: non toglie nessuno.
  function leggiAreaPagina(doc, url) {
    const testa = areaInTesta(doc), ora = Date.now();
    if (testa) store.set(AREA_ORA, { ...testa, ts: ora });
    const opz = opzioniArea(doc);
    if (opz.length) {
      const prima = store.get(AREE_OPZ, {}) || {}, tutte = {};
      for (const o of opz) if (!tutte[o.k]) tutte[o.k] = { id: o.id, label: o.label };
      if (JSON.stringify(prima) !== JSON.stringify(tutte)) store.set(AREE_OPZ, tutte);
    }
    if (!testa || !eListaArea(doc, url)) return null;
    const righe = righeLista(doc, url);
    let filtro = !!spazi(doc.querySelector('input[name="s_ASSISTITO"]')?.value);
    try { filtro = filtro || [...new URL(url).searchParams].some(([k, v]) => /^s_/.test(k) && v); } catch { /* niente */ }
    const conto = contoLista(doc);
    const intera = !filtro && (conto == null || conto === righe.length);
    const a = areeLeggi(), usciti = new Set(), list = store.get("patients.v1", []);
    const attivi = new Set((Array.isArray(list) ? list : []).filter((p) => p && p.ep && !p.arch).map((p) => p.ep));
    let membri = 0;
    const prec = { ...a.membri };   // (la riga di prima, se la lista di adesso è filtrata)
    if (intera) for (const [ep, v] of Object.entries(a.membri)) if (v?.k === testa.k) { delete a.membri[ep]; usciti.add(ep); membri += attivi.has(ep); }
    righe.forEach((r, n) => { a.membri[r.ep] = { k: testa.k, ts: ora, ...rigaDi(prec[r.ep], testa.k, intera ? n : null) }; usciti.delete(r.ep); });
    a.viste[testa.k] = { label: testa.label, ts: ora };
    store.set(AREE, a);
    // Uscito da una lista intera (e non vuota): dimesso — archiviato, il letto
    // vuoto, «Annulla» per 8 secondi. Se però se ne andrebbe più del 30% in un
    // colpo, niente: chi c'era solo per la lista (mai aperto) se ne va con lei,
    // come sempre, e gli altri restano.
    const fuori = [...usciti].filter((ep) => attivi.has(ep));
    const dimetti = !!righe.length && fuori.length > 0 && fuori.length <= membri * DIMESSI_QUOTA;
    // e fra i pazienti: chi c'era si aggiorna (senza «visto adesso»: non l'hai aperto), chi no entra
    const l = Array.isArray(list) ? list.filter((p) => p && p.ep && (dimetti || !(usciti.has(p.ep) && !p.ts && !p.arch))) : [];
    for (const r of righe) {
      const nato = improntaNascita(r.nato);
      fondiSmart(l, r.ep, r.name, nato);   // noto finora solo dalla smart: ecco il suo episodio
      const p = l.find((x) => x.ep === r.ep);
      const tr = { ...(r.triage ? { triage: r.triage, triageTs: ora } : {}), ...(r.arrivo ? { arrivo: r.arrivo } : {}) };
      if (p) Object.assign(p, { lista: ora, ...tr, ...(p.name ? {} : { name: r.name }), ...(p.url ? {} : { url: r.url }),
        ...(nato ? { nato } : {}), ...(Number.isInteger(p.eta) || !Number.isInteger(r.eta) ? {} : { eta: r.eta }),
        ...(p.arch && p.archAuto ? { arch: false, archTs: 0, archAuto: 0 } : {}) });   // dimesso da qui, e invece c'è
      else l.push({ ep: r.ep, name: r.name, url: r.url, ts: 0, lista: ora, pk: "", ...tr, ...(Number.isInteger(r.eta) ? { eta: r.eta } : {}), ...(nato ? { nato } : {}) });
    }
    if (righe.length || l.length !== (Array.isArray(list) ? list.length : 0)) store.set("patients.v1", l.filter((p) => ora - vistoTs(p) < PATIENTS_TTL)
      .sort((x, y) => (y.ts || 0) - (x.ts || 0) || vistoTs(y) - vistoTs(x)).slice(0, PATIENTS_MAX));
    const dimessi = dimetti ? dimettiUsciti(fuori, membri) : [];
    return { area: testa, righe, dimessi };
  }

  // Un indirizzo del gestionale da APRIRE come lo apre il medico: il link
  // della pagina se c'è (le schede in alto, il menu), se no la stessa pagina
  // del menu, senza altro. Mai un modulo, mai un parametro in più.
  function urlMenu(mvpg) {
    for (const a of document.querySelectorAll(`a[href*="MVPG=${mvpg}"]`)) {
      try {
        const u = new URL(a.getAttribute("href"), location.href);
        if (u.origin === location.origin && /\/menuPso\.do$/.test(u.pathname)
          && [...u.searchParams.keys()].every((k) => k === "MVPG") && u.searchParams.get("MVPG") === mvpg) return u.href;
      } catch { /* il prossimo */ }
    }
    const dir = location.pathname.replace(/[^/]*$/, "");
    return new URL(`${/\/sa4pso\/restrict\/$/.test(dir) ? dir : "/sa4pso/restrict/"}menuPso.do?MVPG=${mvpg}`, location.origin).href;
  }
  // Aprire la lista di un'area: se è già quella del medico, la lista; se no
  // PsoPsoImposta, dove la tendina e «Conferma» le fa la pagina dopo
  // (areaVaiQui) — proprio come il medico a mano. `chi`: una riga da aprire,
  // arrivati (nome e impronta della nascita). `tel`: il numero del tocco sul
  // telefono che l'ha chiesto (ponteAreaApri) — com'è finita si dice a lui.
  function apriArea(k, chi, dove = (u) => nav(u), tel = "") {
    if (!k) return false;
    if (TABELLONE) { tabelloneChiede({ cosa: "area", k }); return true; }   // la apre una scheda del gestionale
    const ora = store.get(AREA_ORA, null);
    store.set(AREA_VAI, { k, ...(chi ? { chi } : {}), ...(tel ? { tel } : {}), ts: Date.now() });
    return dove(urlMenu(ora && ora.k === k ? "PsoPazientiAmbulatorio" : "PsoPsoImposta"));
  }
  // Il passaggio d'area, pagina dopo pagina. In PsoPsoImposta: l'opzione
  // dell'area (una sola, riconosciuta dal nome — mai indovinata), poi il suo
  // «Conferma». Sulla lista dell'area: la riga cercata, per nome e nascita, e
  // il SUO link; due righe uguali, o nessuna, e si resta sulla lista.
  // (PsoPsoImposta: la tendina, il suo «Conferma» e le opzioni dell'area k, per nome)
  function impostaQui(doc, url, k) {
    const sel = doc.querySelector('select[name="RISORSA_ID"]'), btn = doc.getElementById("AGG_RISORSA");
    if (!sel || !btn || mvpgDi(doc, url) !== "PsoPsoImposta") return null;
    return { sel, btn, opz: [...sel.options].filter((o) => o.value && chiaveArea(o.textContent) === k) };
  }
  // Il passaggio chiesto da un tocco sul telefono (`tel`, il suo numero): com'è
  // finito si dice al service worker, che lo dice al telefono (ponteAreaApri).
  // `cambiata`: il gestionale è passato all'area, ma il paziente non si apre.
  const areaVaiDetto = (vai, esito) => (vai && vai.tel && hasExt()
    ? Promise.race([ask({ t: "ponteAreaFatto", rq: vai.tel, ...esito }).catch(() => null), sleep(1500)]) : Promise.resolve(null));
  const areaVaiNome = (k) => titoloArea(k, (store.get(AREE_OPZ, {}) || {})[k]?.label || areeLeggi().viste[k]?.label);
  function areaVaiQui(doc, url) {
    const vai = store.get(AREA_VAI, null);
    if (!vai || !vai.k || Date.now() - (vai.ts || 0) > AREA_VAI_MS) {
      if (vai) { store.del(AREA_VAI); areaVaiDetto(vai, { ok: false, testo: "il passaggio d'area non è finito in tempo" }); }
      return false;
    }
    const im = impostaQui(doc, url, vai.k);
    if (im) {
      const { sel, btn, opz } = im;
      if (opz.length !== 1) {
        store.del(AREA_VAI);
        areaVaiDetto(vai, { ok: false, testo: opz.length ? `in Imposta ci sono ${opz.length} aree «${areaVaiNome(vai.k)}»: non scelgo` : `in Imposta il gestionale non offre l'area ${areaVaiNome(vai.k)}` });
        return false;
      }
      if (vai.premuto) {
        // Già premuto, e siamo ancora qui. Se la tendina dice già l'area, il
        // passaggio c'è stato: la sua lista. Se no il «Conferma» si è perso
        // (la pagina del gestionale si ricarica da sé quando la scheda prende
        // il fuoco, e un invio a metà muore lì): ancora una volta, una sola.
        if (sel.value === opz[0].value) {   // (una pagina appena caricata: la tendina è quella del server)
          if (!store.set(AREA_VAI, { ...vai, ts: Date.now() })) return false;
          nav(urlMenu("PsoPazientiAmbulatorio"));
          return true;
        }
        if (vai.ripremuto) {   // due volte, e niente: non si insiste
          store.del(AREA_VAI);
          areaVaiDetto(vai, { ok: false, testo: `il gestionale non è passato all'area ${areaVaiNome(vai.k)}: «Conferma» premuto due volte` });
          return false;
        }
      }
      if (!store.set(AREA_VAI, { ...vai, premuto: Date.now(), ...(vai.premuto ? { ripremuto: 1 } : {}) })) return false;
      sel.value = opz[0].value;
      btn.click();
      return true;
    }
    if (!eListaArea(doc, url)) return false;   // una pagina di passaggio (PsoPazienti, che rimanda alla lista): si aspetta la lista
    const testa = areaInTesta(doc);
    // Sulla lista dell'area di prima: il passaggio non è mai arrivato al
    // gestionale — la scheda, prendendo il fuoco, si è ricaricata sopra la
    // nostra navigazione (refreshOnFocus del gestionale), o l'invio si è perso.
    // Si riprende da PsoPsoImposta, una volta sola.
    if (testa && testa.k !== vai.k && !vai.ripreso) {
      if (!store.set(AREA_VAI, { k: vai.k, ...(vai.chi ? { chi: vai.chi } : {}), ...(vai.tel ? { tel: vai.tel } : {}), ts: Date.now(), ripreso: 1 })) return false;
      nav(urlMenu("PsoPsoImposta"));
      return true;
    }
    store.del(AREA_VAI);
    const nome = areaVaiNome(vai.k);
    if (!testa || testa.k !== vai.k || !vai.chi) {
      areaVaiDetto(vai, { ok: false, testo: testa ? `il gestionale non è passato all'area ${nome}: è ancora su ${titoloArea(testa.k, testa.label)}` : "la lista non dice su che area è il gestionale" });
      return false;
    }
    const trovate = righeLista(doc, url).filter((r) => normNome(r.name) === vai.chi.nome && improntaNascita(r.nato) === vai.chi.nato);
    if (trovate.length !== 1) {
      // passato all'area, ma il paziente non si apre: la lista resta davanti, e il pannello lo dice
      if (vai.tel) tabStore.set(AVVISO, { ts: Date.now(), testo: `Dall'iPhone: il gestionale è passato all'area ${nome}. ${trovate.length ? "Due righe uguali nella lista: scegli tu." : "Il paziente non è nella lista."}` });
      areaVaiDetto(vai, { ok: false, cambiata: true, testo: trovate.length ? "due righe uguali nella sua lista: aprilo sul PC" : "non è nella lista dell'area, sul PC" });
      return false;
    }
    const r = trovate[0];
    if (!vai.tel) { r.a.click(); return true; }   // il suo link, nella pagina
    // dal telefono: la pagina dove si atterra dice che l'area è cambiata, e il telefono lo sa prima del clic
    tabStore.set(AVVISO, { ts: Date.now(), testo: `Dall'iPhone: il gestionale è passato all'area ${nome}.` });
    areaVaiDetto(vai, { ok: true, ep: r.ep, area: nome }).then(() => r.a.click());
    return true;
  }
  // Lo stesso passaggio, nella scheda di un ordine in sottofondo che ha
  // trovato il gestionale su un'altra area (la pagina del paziente senza le
  // Richieste, avviaLavoro): PsoPsoImposta, l'opzione dell'area del paziente,
  // «Conferma», poi di nuovo la pagina del paziente che il service worker ha
  // aperto (`torna`, mai costruita), dove l'ordine parte come sempre. Tutto
  // prima di «parto»: fin lì non si manda niente. L'appunto è della scheda
  // (tabStore), mai quello condiviso (AREA_VAI): una scheda del medico che si
  // carica intanto non lo vede e non preme niente. Una volta per ordine, due
  // «Conferma» al più, AREA_VAI_MS in tutto; ogni intoppo, «Non partito» col
  // perché. Le pagine di mezzo restano senza pannello (true: questa la tiene lui).
  const LAVORO_AREA = "lavoro.area.v1";   // {id, k, area, torna, ts, premuto?, fatto?}
  let tLavoroArea = 0;
  function lavoroAreaQui(doc, url) {
    const L = LAVORO, v = tabStore.get(LAVORO_AREA, null);
    if (!L || L.stato !== "avvio" || !v || v.id !== L.id || v.fatto) return false;
    const no = (testo) => { lavoroNonPartito(testo); return true; };
    const tardi = `Non sono riuscito a passare il gestionale all'area ${v.area}: niente inviato`;
    const resta = (v.ts || 0) + AREA_VAI_MS - Date.now();
    if (resta <= 0) return no(tardi);
    // passato: l'esito lo dirà («gestionale ora sull'area …»), e si torna dal paziente
    const fatto = () => {
      if (!tabStore.set(LAVORO_AREA, { ...v, fatto: Date.now() })) return no(tardi);
      ask({ t: "ordineAggiorna", id: L.id, area: v.area }).then(() => { if (LAVORO === L) nav(v.torna); });
      return true;
    };
    const im = impostaQui(doc, url, v.k), due = `Il gestionale non è passato all'area ${v.area}, «Conferma» premuto due volte: niente inviato`;
    if (im) {
      if (im.opz.length !== 1) return no(im.opz.length ? `In Imposta ci sono ${im.opz.length} aree «${v.area}»: non scelgo, niente inviato` : `In Imposta il gestionale non offre l'area ${v.area}: niente inviato`);
      // (una pagina appena caricata: la tendina è quella del server)
      if (v.premuto && im.sel.value === im.opz[0].value) return fatto();
      if (v.premuto >= 2) return no(due);
      if (!tabStore.set(LAVORO_AREA, { ...v, premuto: (v.premuto || 0) + 1 })) return no(tardi);
      im.sel.value = im.opz[0].value;
      im.btn.click();
    } else if (v.premuto) {
      // dopo «Conferma»: la pagina dove il gestionale atterra dice in testa su che area è.
      // Quella di prima: il «Conferma» si è perso — da PsoPsoImposta, che lo ripreme una volta.
      // (Senza testa: una pagina di passaggio, si aspetta la prossima.)
      const testa = areaInTesta(doc);
      if (testa && testa.k === v.k) return fatto();
      if (testa && v.premuto >= 2) return no(due);
      if (testa) nav(urlMenu("PsoPsoImposta"));
    }
    clearTimeout(tLavoroArea);
    tLavoroArea = setTimeout(() => { if (LAVORO === L && !(tabStore.get(LAVORO_AREA, null) || {}).fatto) lavoroNonPartito(tardi); }, resta);
    return true;
  }
  // «Non partito» da una pagina senza pannello: l'ultima parola (col perché
  // anche nel Registro della scheda), e la scheda si slega
  function lavoroNonPartito(testo) {
    const L = LAVORO;
    if (!L) return;
    const k = "log." + (L.ep || "x"), prima = tabStore.get(k, null);
    tabStore.set(k, { ts: Date.now(), lines: [...(Array.isArray(prima?.lines) ? prima.lines : []), `${now()}  ${testo}`].slice(-200) });
    const m = { t: "ordineAggiorna", id: L.id, stato: "errore", vista: { tag: "Non partita", testo: "niente inviato: riprova", tono: "err", quesito: testo }, registro: registroLavoro(null) };
    LAVORO = null;
    ask(m).then((r) => (r.perso ? ask(m) : r));
  }

  // La LISTA SMART (tutto il pronto soccorso, in una finestra sua): le righe
  // non hanno link. Ogni riga diventa cliccabile — il puntatore, un'ombra
  // al passaggio, nient'altro — e apre la cartella del paziente se lo si
  // conosce già (nome e nascita, una sola corrispondenza); se no si passa
  // alla sua area e si apre dalla lista dell'area, col link della sua riga.
  // Due corrispondenze: non si indovina, si apre la lista dell'area.
  function righeSmart(doc) {
    const etichette = new Set([...doc.querySelectorAll('select[name="s_PERCORSO"] option')].map((o) => spazi(o.textContent).toUpperCase())
      .concat(Object.values(store.get(AREE_OPZ, {}) || {}).map((o) => spazi(o?.label).toUpperCase())).filter(Boolean));
    const out = [];
    for (const div of doc.querySelectorAll(".myLinguetta")) {
      const td = div.parentElement, tr = td?.parentElement;
      if (!td || td.tagName !== "TD" || !tr || tr.tagName !== "TR" || tr.querySelector('a[href*="EPISODIO_ID="]')) continue;
      const l = linguettaDi(div);
      if (!l) continue;
      const celle = [...tr.children], i = celle.indexOf(td);
      const cella = celle.slice(i + 1).find((c) => etichette.has(spazi(c.textContent).toUpperCase())) || celle[i + 3];
      out.push({ tr, ...l, area: spazi(cella?.textContent).slice(0, 60), arrivo: arrivoDa(celle[i + 1]?.textContent) });
    }
    return out;
  }
  // Prima il fuoco, POI la pagina. Le pagine del gestionale si ricaricano da
  // sole quando la loro scheda prende il fuoco (<body onfocus="refreshOnFocus()">):
  // portata davanti insieme alla navigazione, la scheda ricaricava la lista di
  // prima sopra la nostra, e il passaggio d'area spariva (il medico atterrava
  // sulla lista, senza area cambiata né paziente aperto). Se nel frattempo la
  // pagina ricaricata ha già ripreso il passaggio d'area (areaVaiQui), non si
  // naviga una seconda volta sopra di lei.
  async function apriNelGestionale(url) {
    const vai0 = JSON.stringify(store.get(AREA_VAI, null));
    const ripreso = () => vai0 !== "null" && JSON.stringify(store.get(AREA_VAI, null)) !== vai0;
    // con l'estensione: nella scheda del gestionale da cui la finestra è nata (o l'ultima usata), in primo piano
    if (hasExt()) {
      const f = await ask({ t: "apriNelGestionale", url, soloFuoco: true });
      if (f && f.ok) {
        await sleep(400);
        if (ripreso()) return "ripreso";
        const r = await ask({ t: "apriNelGestionale", url, tabId: f.tabId });
        if (r && r.ok) return "scheda";
      }
    }
    try {
      const o = window.opener;
      if (o && !o.closed && o.location.origin === location.origin) {
        o.focus();
        await sleep(400);
        if (o.closed) return "chiusa";
        if (ripreso()) return "ripreso";
        o.location.href = url;
        return "opener";
      }
    } catch { /* un'altra origine: qui */ }
    nav(url);
    return "qui";
  }
  function smartApri(r) {
    const nato = improntaNascita(r.nato), nome = normNome(r.name);
    const chi = nato ? tuttiPazienti().filter((p) => normNome(p.name) === nome && p.nato === nato) : [];
    const url = chi.length === 1 ? chi[0].url : "";
    if (url && leggibilePagina(url) && param(url, "MVPG") === "PsoEpisodioClinicoAmbulatorio" && param(url, "EPISODIO_ID") === chi[0].ep) return apriNelGestionale(url);
    return apriArea(chiaveArea(r.area), chi.length > 1 || !nato ? null : { nome, nato }, apriNelGestionale);
  }
  function smartQui(doc, url) {
    if (!eSmart(doc, url)) return 0;
    const righe = righeSmart(doc);
    if (righe.length && !doc.getElementById("psassist-smart")) {
      const st = doc.createElement("style");
      st.id = "psassist-smart";
      st.textContent = "tr.psassist-smart{cursor:pointer}tr.psassist-smart:hover>td{background-color:#EAF2FB!important}";
      (doc.head || doc.documentElement).appendChild(st);
    }
    for (const r of righe) {
      if (r.tr.classList.contains("psassist-smart")) continue;
      r.tr.classList.add("psassist-smart");
      r.tr.addEventListener("click", (e) => {
        if (e.target.closest?.("a, button, input, select, textarea")) return;
        smartApri(r);
      });
    }
    return righe.length;
  }

  // ------------------------------------------------------------ TABELLONE
  // Due mappe, Alta e Bassa, e una lista sola sotto: chi si vede dove lo
  // dicono l'area e il triage, sullo stesso elenco. Alta: l'area Alta e l'OBI
  // rosso o arancione. Bassa: Bassa, Codici minori e l'OBI azzurro, verde o
  // bianco. L'OBI senza triage, chi non ha ancora un'area, un'area che non si
  // riconosce: tutt'e due — nessuno sparisce.
  const VISTA = "tabellone.vista.v1";          // "alta" | "bassa" | "entrambe" — un'impostazione, resta
  const VISTE = ["alta", "bassa", "entrambe"];
  const MAPPA_DI_VISTA = { alta: "alta", bassa: "ps" };
  const NOME_VISTA = { alta: "Alta", bassa: "Bassa", entrambe: "Entrambe" };
  const MODO = "tabellone.modo.v1";            // "mappa" | "lista" | "dafare" — un'impostazione, resta
  const MODI = ["mappa", "lista", "dafare"];
  const TD_UI = "tabellone.dafare.v1";         // { chiusa } — il Da fare del tabellone ridotto a una barra: un'impostazione, resta
  const TD_PAZ = "paziente.dafare.v1";         // { chiusa } — quello in cima alla scheda del paziente, lo stesso, per conto suo
  const NOME_MODO = { mappa: "Mappa", lista: "Lista", dafare: "Da fare" };
  function tabelloniDi(k, triage) {
    if (k === "alta") return ["alta"];
    if (k === "bassa" || k === "minori") return ["bassa"];
    if (k === "obi" && (triage === "ROSSO" || triage === "ARANCIONE")) return ["alta"];
    if (k === "obi" && ["AZZURRO", "VERDE", "BIANCO"].includes(triage)) return ["bassa"];
    return ["alta", "bassa"];
  }
  // l'OBI senza triage sta in tutt'e due, con la striscia grigia
  const triageIgnoto = (k, triage) => k === "obi" && !TRIAGE_COLORI.includes(triage);

