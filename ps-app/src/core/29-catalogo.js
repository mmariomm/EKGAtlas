//@frammento 29-catalogo.js — Il catalogo imparato dalle pagine, la ricerca degli esami, le risorse, le etichette (examLabel, displayLabel).
  function learnedCatalog() { return store.get("catalog.v1", {}); }
  // Il catalogo si impara dalle pagine vere, MA un nome già noto non viene
  // mai sovrascritto. Il motivo è il controllo anti-esame-sbagliato: quello
  // confronta il nome della riga viva col nome con cui l'esame è stato
  // scelto. Se la stessa pagina potesse riscrivere il catalogo un istante
  // prima del click, il confronto sarebbe fra un valore e se stesso — e non
  // potrebbe più fallire. Un codice che oggi porta un altro nome è proprio
  // l'anomalia che deve fermare tutto: la ferma quel controllo, non si assorbe.
  function learnFrom(model) {
    if (!model.res || !model.exams.length) return;
    const cat = learnedCatalog();
    const entry = cat[model.res] || { label: "", items: {} };
    const opt = model.resOptions.find((o) => o.value === model.res);
    if (opt) entry.label = opt.label;
    const incisi = (EMBEDDED_CATALOG[model.res] || {}).items || {};
    for (const e of model.exams) if (!incisi[e.code] && !entry.items[e.code]) entry.items[e.code] = e.label;
    // gli appunti delle versioni prima (lo schema dell'«aggiungi», BRANCA, i
    // nomi cambiati) servivano solo a mandare un esame col codice salvato:
    // quella strada non c'è più, e nemmeno loro
    delete entry.ins; delete entry.par; delete entry.rinominati;
    entry.ts = Date.now();
    cat[model.res] = entry;
    store.set("catalog.v1", cat);
  }
  // La ricerca del gestionale, quella della casella «Prestazione» sopra la
  // griglia: l'elenco stesso, con s_PRESTAZIONE scritto (ogni link della
  // pagina lo porta già: è lo stato della ricerca). Si cerca per mnemonico LIS
  // se il nome ne ha uno — «(POC1401)» — altrimenti per nome.
  const termineRicerca = (label) => mnemonico(label) || shortLabel(String(label || "")).replace(/\s+/g, " ").trim();
  function urlRicerca(listUrl, termine) {
    if (!listUrl || !termine || !/[?&]s_PRESTAZIONE=/.test(listUrl)) return null;
    return listUrl.replace(/([?&]s_PRESTAZIONE=)[^&#]*/, (m, k) => k + encodeW1252Component(termine));
  }
  // A resource id is site-local: "LABORATORIO ANALISI POC" is 00660001P in one
  // presidio and something else in another, and the same is true of radiology.
  // What travels is the NAME, so that is what we match on — the site suffix
  // ("- SSG (P)") is dropped first. Nothing is ordered on the strength of this
  // alone: the exam's own live name is still checked before every send.
  const chiaveRisorsa = (label) => String(label || "")
    .toUpperCase().replace(/\s+/g, " ")
    .replace(/\s*-\s*[A-Z]{2,5}\s*(\([A-Z]\))?\s*$/, "")
    .replace(/\s*\([A-Z]\)\s*$/, "")
    .trim();
  // the mnemonic the LIS puts in brackets — "EMOCROMOCITOMETRICO URGENTE
  // (POCT1502)" — identifies an exam far better than its numeric code
  const mnemonico = (label) => { const m = /\(([A-Z0-9._-]{3,})\)\s*$/i.exec(String(label || "").trim()); return m ? m[1].toUpperCase() : ""; };
  const normEsame = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();
  // Lo stesso esame su una riga viva: lo stesso nome (la tipografia non conta:
  // i trattini cambiano da una sede all'altra) o lo stesso mnemonico LIS. Mai
  // per somiglianza. È il cancello prima di ogni invio (regola 4).
  const nomeVivo = (s) => String(s || "").replace(/[–—‐‑‒−]/g, "-").replace(/\s+/g, " ").trim().toUpperCase();
  const stessoNomeVivo = (a, b) => (!!nomeVivo(a) && nomeVivo(a) === nomeVivo(b)) || (!!mnemonico(a) && mnemonico(a) === mnemonico(b));

  // Dove va un esame in QUESTA sede. Le risorse cambiano numero da una sede
  // all'altra (e si riconoscono per nome), ma una sede può anche non avere
  // proprio quella risorsa: a OSG il laboratorio «Urgenze» non esiste, e i
  // suoi esami stanno nel laboratorio unico. Allora vale la risorsa offerta
  // qui che ha lo STESSO esame — stesso nome o stesso mnemonico LIS — e mai un
  // POC per un esame che POC non è (è un altro strumento, un'altra provetta),
  // né il contrario. Nessun esame viene inviato sulla fiducia di questa
  // scelta: il nome vero si ricontrolla sull'elenco vivo prima di ogni invio.
  const ePoc = (label) => /\bPOC\b/i.test(String(label || ""));
  function risorsaQui(it, opzioni, cat) {
    const offerte = new Set(opzioni.map((o) => o.value));
    if (!it.res || offerte.has(it.res)) return it.res ? { res: it.res } : null;
    const nomeRis = (cat[it.res] && cat[it.res].label) || "";
    const atteso = chiaveRisorsa(nomeRis);
    const stessoNome = atteso ? opzioni.find((o) => chiaveRisorsa(o.label) === atteso) : null;
    if (stessoNome) return { res: stessoNome.value, perNome: true, opt: stessoNome };
    const mioPoc = ePoc(nomeRis) || ePoc(it.label);
    const mioNome = normEsame(it.label), mioMn = mnemonico(it.label);
    if (!mioNome || /^ESAME \d+$/.test(mioNome)) return null;
    for (const o of opzioni) {
      if (ePoc(o.label) !== mioPoc) continue;
      const voci = Object.entries((cat[o.value] && cat[o.value].items) || {});
      const hit = voci.find(([, l]) => normEsame(l) === mioNome) || (mioMn ? voci.find(([, l]) => mnemonico(l) === mioMn) : null);
      if (hit) return { res: o.value, code: hit[0], label: hit[1], opt: o };
    }
    return null;
  }
  // Come si chiamano in reparto → come comincia il nome nel catalogo del LIS.
  const ALIAS_RICERCA = {
    PCR: ["PROTEINA C REATTIVA"], PCT: ["PROCALCITONINA"],
    EGA: ["EMOGAS", "EGA "], GGT: ["GAMMA GT"], AST: ["GOT"], ALT: ["GPT"],
    BNP: ["NT PRO-BNP", "NT-PRO", "BNP"], TROPO: ["TROPONINA"], TROP: ["TROPONINA"],
    EMOCROMO: ["EMOCROMOCITOMETRICO"], URINE: ["ESAME URINE"],
  };
  // a parità di nome: urgenze, poi il laboratorio, poi il POC, poi il resto
  function ordineRisorsa(res, cat) {
    const l = chiaveRisorsa((cat[res] && cat[res].label) || "");
    if (/URGENZ/.test(l)) return 0;
    if (/\bPOC\b/.test(l)) return 2;
    if (/^LABORATORIO/.test(l)) return 1;
    return 3;
  }
  // un nome corto per una risorsa che RES_SHORT non conosce (quelle di
  // un'altra sede): «LABORATORIO ANALISI POC - OSG (P)» → «POC»
  function risorsaCorta(res, cat = fullCatalog()) {
    if (RES_SHORT[res]) return RES_SHORT[res];
    const l = chiaveRisorsa((cat[res] && cat[res].label) || "");
    if (!l) return res;
    if (/\bPOC\b/.test(l)) return "POC";
    if (/URGENZ/.test(l)) return "Lab centrale";
    if (/^RADIOLOGIA/.test(l)) return l.replace(/^RADIOLOGIA\s*-?\s*/, "").replace(/RISONANZA MAGNETICA NUCLEARE/, "RMN").trim() || "Radiologia";
    if (/^LABORATORIO/.test(l)) return "Lab centrale";
    return l.slice(0, 18);
  }

  function fullCatalog() {
    const out = {};
    for (const [res, v] of Object.entries(EMBEDDED_CATALOG)) out[res] = { label: v.label, items: { ...v.items } };
    for (const [res, v] of Object.entries(learnedCatalog())) {
      out[res] = out[res] || { label: v.label || res, items: {} };
      if (v.label) out[res].label = v.label;
      Object.assign(out[res].items, v.items);
    }
    return out;
  }
  const examLabel = (res, code) => (fullCatalog()[res]?.items || {})[code] || `esame ${code}`;
  // Il laboratorio affianca al vecchio esame la sua versione «- NEW» e lascia
  // in elenco tutti e due (l'emogas venoso e l'arterioso sono così). Chi
  // ordina vuole il nuovo. Il confronto è sul NOME, non sul numero, che cambia
  // da un ospedale all'altro.
  // NB: si toglie SOLO il mnemonico in fondo — «(POC2117)» — non tutte le
  // parentesi: «EPATITE B (HBSAG) ANTICORPI» e «EPATITE B (HBEAG) ANTICORPI»
  // sono due esami diversi e diventerebbero lo stesso nome.
  const baseEsame = (label) => String(label || "").replace(/&nbsp;/gi, " ").toUpperCase()
    .replace(/\s*\([A-Z]*\d+\)\s*$/, " ").replace(/\s+-\s*NEW\b/g, " ").replace(/\bPOC\b/g, " ")
    .replace(/[^A-Z0-9()]+/g, " ").trim();
  const eNuovo = (label) => /\s-\s*NEW\b/i.test(String(label || "").replace(/&nbsp;/gi, " "));
  // Due nomi che parlano dello stesso esame: identici, stesso mnemonico, o
  // l'uno dentro l'altro parola per parola — «BILIRUBINA TOTALE REFLEX» mette
  // in carrello «BILIRUBINA TOTALE». Serve SOLO a riconoscere la riga che il
  // nostro inserimento ha appena prodotto: nessun esame viene mai scelto o
  // inviato in base a questo.
  const stessoEsame = (a, b) => {
    const x = baseEsame(a), y = baseEsame(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const ma = mnemonico(a), mb = mnemonico(b);
    if (ma && ma === mb) return true;
    const [lungo, corto] = x.length >= y.length ? [x, y] : [y, x];
    return corto.length >= 6 && ` ${lungo} `.includes(` ${corto} `);
  };
  // UI-facing short name (falls back to the catalog label, trimmed of its code)
  const displayLabel = (res, code) => DISPLAY[`${res}:${code}`] || shortLabel(examLabel(res, code));

