//@frammento 10-pagine.js — PAGE MODELS: classify, episodio della pagina, SIGLE e sezioni degli analiti, formule, patientModel.
  // ============================================================ PAGE MODELS
  function classify(doc) {
    if (doc.querySelector('form[name="RICHIESTACrea"]')) return "crea";
    if (doc.querySelector('form[name="Prestazioni"]')) return "exam";
    if (doc.querySelector('form[name="AmbulatorioPSO"]') ||
        doc.querySelector('a[title="Richieste Laboratorio"], a[title="Richieste Radiologia"]')) return "patient";
    if (doc.querySelector('input[type="password"]')) return "login";
    return "other";
  }

  // Episode id as stated by the SERVER inside the page (links/forms).
  function findEpisodeIdInDoc(doc) {
    const el = doc.querySelector('a[href*="EPISODIO_ID="], form[action*="EPISODIO_ID="]');
    if (el) {
      const raw = el.getAttribute("href") || el.getAttribute("action") || "";
      const m = /[?&]EPISODIO_ID=([^&]+)/.exec(raw);
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
  }
  function findEpisodeId(doc, baseUrl) {
    return param(baseUrl, "EPISODIO_ID") || findEpisodeIdInDoc(doc);
  }

  // Lab names as they are read at a glance. The LIS writes them out in full
  // ("MCH Cont. Media Hgb"), which is unreadable in a two-line preview: what a
  // doctor scans is the short form and the number.
  const SIGLE = [
    [/^leucociti|^globuli bianchi|^wbc/i, "GB"],
    // l'emoglobina glicata è un'altra grandezza in un'altra unità: non deve
    // mai finire nella riga dell'Hb accanto a un'emoglobina in g/dL
    [/emoglobina\s*glicat|^hba1c|\bhb\s?a1c\b/i, "HbA1c"],
    [/^emoglobina(?!\s*glicat)|^hgb\b|^hb\b|^c?thb\b/i, "Hb"],
    [/^ematocrito|^hct/i, "Ht"], [/^piastrine|^plt/i, "PLT"], [/^eritrociti|globuli rossi|^rbc/i, "GR"],
    [/^mcv|vol\.? glob/i, "MCV"], [/^mchc/i, "MCHC"], [/^mch\b|cont\.? media/i, "MCH"], [/^rdw/i, "RDW"],
    [/^(granulociti\s+)?eosinofil/i, "Eos"], [/^(granulociti\s+)?basofil/i, "Bas"], [/^granulociti|neutrofil/i, "Neu"], [/^linfocit/i, "Lin"], [/^monocit/i, "Mon"],
    [/^eosinofil/i, "Eos"], [/^basofil/i, "Bas"], [/altre popolazioni/i, "Altre"],
    [/^creatinin/i, "Cr"], [/^azotemia|^urea/i, "Az"], [/^sodio|^na\b/i, "Na"], [/^potassio|^k\b/i, "K"],
    [/^cloro|^cl\b/i, "Cl"], [/calcio ioniz/i, "Ca++"], [/^calcio/i, "Ca"], [/^magnesio/i, "Mg"],
    [/^glucosio|glicemia/i, "Glu"], [/proteina c reattiva|^pcr\b/i, "PCR"], [/procalcitonin/i, "PCT"],
    [/troponina/i, "Trop"], [/d.?dimero/i, "DD"], [/^inr/i, "INR"], [/^pt\b|protrombin/i, "PT"],
    // il rapporto del PTT è un'altra grandezza dei secondi: con la stessa
    // sigla le due righe finivano scritte per esteso, e sembravano un doppione
    [/^a?ptt\s*ratio/i, "PTTr"],
    [/^ptt|tromboplastin/i, "PTT"], [/fibrinogeno/i, "Fib"],
    // "indiretta" contiene "diretta": vanno distinte, o la bilirubina diretta
    // e l'indiretta diventano due righe con la stessa etichetta
    [/bilirubina\s+indiretta|bil\.?\s*indiretta/i, "BilI"],
    [/bilirubina\s+diretta|bil\.?\s*diretta/i, "BilD"],
    [/bilirubina/i, "Bil"], [/^got\b|^ast\b/i, "AST"], [/^gpt\b|^alt\b/i, "ALT"],
    [/gamma\s?gt|^ggt/i, "γGT"], [/fosfatasi alc/i, "ALP"], [/^ldh/i, "LDH"],
    // «cK+» è il potassio dell'emogas: senza questa riga la regola del CPK
    // (^ck) lo prendeva, e il potassio compariva come CPK fra gli enzimi
    [/^c?k\s*\+/i, "K"],
    // gli altri nomi dell'emogas, scritti come li scrive l'emogasanalizzatore
    [/^c?na\s*\+/i, "Na"], [/^c?cl\s*-/i, "Cl"], [/^c?ca\s*(?:2\s*\+|\+\+)/i, "Ca++"],
    [/^c?glu\b/i, "Glu"], [/^cLac\b/, "Lac"],   // «LAC» (lupus anticoagulant) non è lattato
    [/\bck\s?-?\s?mb\b/i, "CKMB"], [/^cpk|creatinchinasi|^ck\b(?!\s?-?\s?mb)/i, "CPK"],
    [/^lipasi/i, "Lip"], [/^amilasi/i, "Amy"],
    [/albuminuria|microalbuminur/i, "Albu"], [/^albumin/i, "Alb"],
    [/nt.?pro.?bnp/i, "NTproBNP"], [/^bnp/i, "BNP"], [/^ves\b/i, "VES"],
    [/^ph\b/i, "pH"], [/pco2|pco₂/i, "pCO2"], [/po2\b|po₂/i, "pO2"], [/hco3|bicarbon/i, "HCO3"],
    [/base excess|^be\b|^eb\b|^[as]be\b|^cbase/i, "BE"],
    [/lattico\s+deidrogen|lattato\s+deidrogen/i, "LDH"],   // prima di "lattat"
    [/lattat/i, "Lac"], [/saturaz|^so2/i, "SatO2"],
    [/carbossiemo|^cohb/i, "COHb"], [/metaemo|^methb/i, "MetHb"], [/^tsh/i, "TSH"],
    [/emogas/i, "EGA"], [/^ammonio|ammoniem/i, "NH3"], [/^mioglobin/i, "Mb"],
    // urine dipstick and blood-gas derivatives: names the portal's multi-day
    // table shows and the Risultati window does not
    [/corpi chetonici|^chetoni/i, "Chet"], [/esterasi leucocit/i, "EstLeu"],
    [/peso specifico/i, "PesoSp"], [/urobilinogen/i, "Urob"], [/^nitriti/i, "Nitr"],
    [/anion gap/i, "AG"], [/^ca\+\+/i, "Ca++"],
    [/^fcohb/i, "FCOHb"], [/^fo2hb|^fo₂hb/i, "FO2Hb"], [/^hhb/i, "HHb"],
    [/^shunt/i, "Shunt"], [/^ctco2|^ctco₂/i, "ctCO2"], [/^cto2|^cto₂/i, "ctO2"],
  ];
  // The portal writes the specimen in front of the analyte: S-ALT, P-Sodio,
  // U-Emoglobina, Lcr-Glucosio. Serum, plasma and blood are what a sigla
  // already means, so they drop; every other specimen STAYS in the label,
  // because urine haemoglobin is not haemoglobin and must never read as Hb.
  const CAMPIONE = /^\s*(S|P|B|Sg|Ser|Pl)\s*-\s*/i;
  const CAMPIONE_ALTRO = /^\s*(U|Lcr|Liq|F|Fec|Exp|Esc)\s*-\s*/i;
  // Le sezioni dello storico. La chiave è la SIGLA (l'uscita di sigla()), non
  // il nome del laboratorio: così bastano poche righe invece di un elenco di
  // sinonimi, e l'ordine dentro ogni sezione è l'ordine in cui si leggono.
  // Chi non è in elenco finisce in «Altri»: non si perde niente, mai.
  const SEZIONI = [
    ["Emocromo", ["GB", "Neu", "Lin", "Mon", "Eos", "Bas", "Altre", "Hb", "Ht", "GR", "MCV", "MCH", "MCHC", "RDW", "PLT"]],
    ["Coagulazione", ["PT", "INR", "PTT", "PTTr", "Fib", "DD"]],
    ["Biochim", ["PCR", "PCT", "VES", "Trop", "NTproBNP", "BNP", "CPK", "CKMB", "Mb", "LDH"]],
    ["Organi", ["Cr", "Az", "AST", "ALT", "γGT", "ALP", "Bil", "BilD", "BilI", "Amy", "Lip", "Alb", "NH3"]],
    ["Elettroliti e metabolismo", ["Na", "K", "Cl", "Ca", "Ca++", "Mg", "Glu", "HbA1c", "TSH"]],
    ["Emogas", ["pH", "pCO2", "pO2", "HCO3", "BE", "Lac", "SatO2", "AG", "ctCO2", "ctO2", "COHb", "MetHb", "FCOHb", "FO2Hb", "HHb", "Shunt", "EGA"]],
    ["Urine e altri liquidi", ["Albu", "PesoSp", "Nitr", "Chet", "EstLeu", "Urob"]],
  ];
  const ALTRI = "Altri";
  // sigla → [sezione, posizione dentro la sezione], costruita una volta sola
  const DOVE = (() => {
    const m = new Map();
    SEZIONI.forEach(([sez, sigle]) => sigle.forEach((s, i) => m.set(s, [sez, i])));
    return m;
  })();
  // Un'abbreviazione che porta il campione (U·Hb, Lcr·Glu) non è quell'analita
  // nel sangue: l'emoglobina delle urine non va nell'emocromo. Il campione
  // decide la sezione prima di tutto il resto.
  function sezioneDi(sg) {
    const s = String(sg || "");
    if (s.includes("·")) return ["Urine e altri liquidi", 900];
    return DOVE.get(s) || [ALTRI, 900];
  }
  // L'emogas è un'altra macchina e un altro campione: Hb, Ht, K, Na, Cl, Ca++
  // e glucosio dell'emogas NON sono quelli dell'emocromo o della chimica.
  // Chi li legge li vuole divisi: stanno nella sezione Emogas, su righe loro,
  // e non si fondono mai con gli stessi analiti fatti in laboratorio. Lo dice
  // l'ESAME che li ha prodotti (EGA venosa, emogasanalisi…), non il nome.
  const eEga = (esame) => /EMOGAS|\bEGA\b/i.test(String(esame || ""));
  const ORDINE_EGA = ["pH", "pCO2", "pO2", "HCO3", "BE", "Lac", "SatO2", "Hb", "Ht", "Na", "K", "Cl", "Ca++", "Glu",
    "AG", "ctCO2", "ctO2", "COHb", "MetHb", "FCOHb", "FO2Hb", "HHb", "Shunt", "EGA"];
  function sezioneRiga(r, sg = sigla(r.nome)) {
    const [sez, ord] = eEga(r.esame) && !String(sg).includes("·") ? ["Emogas", 0] : sezioneDi(sg);
    if (sez !== "Emogas") return [sez, ord];
    const i = ORDINE_EGA.indexOf(sg);
    return ["Emogas", i < 0 ? 900 : i];
  }
  const ordineSezioni = [...SEZIONI.map(([n]) => n), "Urine e altri liquidi", ALTRI]
    .filter((n, i, a) => a.indexOf(n) === i);

  function scomponi(nome) {
    const n = String(nome || "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (CAMPIONE.test(n)) return { pre: "", resto: n.replace(CAMPIONE, "") };
    const m = CAMPIONE_ALTRO.exec(n);
    if (m) return { pre: m[1].toUpperCase() + "·", resto: n.slice(m[0].length) };
    return { pre: "", resto: n };
  }
  function sigla(nome) {
    const n = String(nome || "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const { pre, resto } = scomponi(n);
    for (const [re, s] of SIGLE) if (re.test(resto)) return pre + s;
    // Dropping the prefix only pays off when what is left is a name we KNOW.
    // Otherwise that letter was never a specimen: "S-100" is a protein, not
    // serum 100, and "B-12" is a vitamin. Keep the name whole.
    const w = n.split(/[\s(,]+/).filter(Boolean)[0] || n;   // first word, never a paragraph
    return w.length > 9 ? w.slice(0, 8) + "." : w;
  }
  // An abbreviation this program has NOT been taught is a guess, and a guess
  // that looks like a known sigla is how a doctor reads the wrong analyte.
  // Everywhere a guess is shown it is marked, and counted.
  // «x10» da solo non dice niente: il gestionale perde l'esponente. Per i
  // conteggi cellulari l'unità è una sola in tutti i laboratori italiani —
  // globuli bianchi e piastrine ×10⁹/L (= 10³/µL), globuli rossi ×10¹²/L — e si
  // scrive per esteso SOLO se l'unità è proprio «x10» nuda e l'analita è una
  // di queste sigle curate. Altrimenti resta com'è: mai un'ipotesi.
  const ESPONENTI_CONTEGGI = { GB: 9, Neu: 9, Lin: 9, Mon: 9, Eos: 9, Bas: 9, Altre: 9, PLT: 9, GR: 12 };
  function unitaChiara(um, nome) {
    const u = String(um || "").trim();
    if (!/^[x×*]\s?10$/i.test(u)) return u;
    const e = ESPONENTI_CONTEGGI[sigla(nome)];
    return e ? "×10" + String(e).replace(/\d/g, (c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[c]) + "/L" : u;
  }
  const siglaCurata = (nome) => SIGLE.some(([re]) => re.test(scomponi(nome).resto));
  // Peggio di un nome che non conosciamo: due nomi DIVERSI che nello stesso
  // prelievo escono con la stessa abbreviazione («PTT secondi» e «PTT Ratio»,
  // «Granulociti» e «Granulociti %»). Anche quelli vanno scritti per esteso.
  // (L'Hb dell'emogas e quella dell'emocromo stanno in due sezioni diverse:
  // la stessa sigla non le confonde. Si confondono due righe della STESSA
  // sezione con la stessa sigla — la chiave è quella.)
  const chiaveAmbigua = (r) => sezioneRiga(r)[0] + "|" + sigla(r.nome);
  function sigleAmbigue(rows) {
    const per = new Map();
    for (const r of rows || []) {
      const nome = String(r.nome || "").trim();
      if (!nome) continue;
      const k = chiaveAmbigua(r);
      const set = per.get(k) || new Set();
      set.add(nome + (eEga(r.esame) ? "|ega" : ""));
      per.set(k, set);
    }
    const out = new Set();
    for (const [k, nomi] of per) if (nomi.size > 1) out.add(k);
    return out;
  }
  // Le righe divise in sezioni, in ordine FISSO. L'ordine non deve dipendere da
  // come il laboratorio ha stampato la tabella: se dipendesse, lo stesso esame
  // cambierebbe posto da un prelievo all'altro e lo si cercherebbe ogni volta.
  // La formula leucocitaria arriva in coppia — «Granulociti» (x10³/µL) e
  // «Granulociti %» — e in tabella erano due righe con lo stesso nome, che il
  // medico leggeva come doppioni (e che, per non confonderle, finivano pure
  // scritte per esteso). Diventano UNA riga: il valore assoluto, e fra
  // parentesi la percentuale. Il fuori range è quello dell'assoluto; una
  // percentuale senza assoluto resta da sola («Altre 5.9%»).
  const FORMULA = new Set(["Neu", "Lin", "Mon", "Eos", "Bas", "Altre"]);
  const ePct = (r) => /%/.test(String(r.nome || "")) || (r.valori || []).some((v) => v && String(v.um || "").trim() === "%");
  function fondiFormula(righe) {
    const coppie = new Map();   // sigla → { abs, pct }
    const out = [];
    for (const r of righe || []) {
      const sg = sigla(r.nome);
      if (!FORMULA.has(sg)) { out.push(r); continue; }
      const stelo = valKey(String(r.nome).replace(/[%#]/g, " "));   // «Granulociti %» → «granulociti»
      const c = coppie.get(stelo) || {};
      const lato = ePct(r) ? "pct" : "abs";
      // una terza riga con la stessa sigla non si indovina: resta com'è
      if (c[lato]) { out.push(r); continue; }
      c[lato] = r;
      if (!coppie.has(stelo)) { coppie.set(stelo, c); out.push({ segnaposto: stelo }); }
    }
    return out.map((r) => {
      if (!r.segnaposto) return r;
      const { abs, pct } = coppie.get(r.segnaposto);
      if (!abs || !pct) return abs || pct;
      const n = Math.max(abs.valori.length, pct.valori.length);
      const valori = Array.from({ length: n }, (_, i) => {
        const a = abs.valori[i], q = pct.valori[i];
        if (a && a.v) return { ...a, pct: q && q.v ? String(q.v) : "" };
        // solo la percentuale in quel prelievo: il numero porta il suo «%», e
        // l'unità resta quella dell'assoluto per tutta la riga
        if (q && q.v) return { ...q, v: String(q.v) + "%", um: "" };
        return a || q;
      });
      return { ...abs, valori };
    });
  }

  // Lo stesso esame in due prestazioni della stessa richiesta («EMOCROMO» e
  // «EMOCROMO CON FORMULA») dà le stesse righe due volte, a volte col nome
  // scritto in due modi («MCH Cont. Medio Hgb», «… Media Hgb»): in tabella
  // erano doppioni. Due righe della stessa sezione con la stessa sigla
  // diventano una sola se dicono LA STESSA COSA: tutte e due assolute o
  // tutte e due percentuali, almeno un prelievo in comune e lo stesso valore
  // in ognuno. Un solo valore diverso, e restano due (scritte per esteso).
  function fondiDoppioni(righe) {
    const numero = (x) => (/^-?\d+(?:[.,]\d+)?$/.test(x) ? Number(x.replace(",", ".")) : NaN);
    const uguali = (a, b) => a === b || numero(a) === numero(b);   // «131.0» e «131»: lo stesso numero
    const stessa = (a, b) => {
      let comuni = 0;
      for (let i = 0; i < Math.max(a.valori.length, b.valori.length); i++) {
        const x = String(a.valori[i]?.v || "").trim(), y = String(b.valori[i]?.v || "").trim();
        if (!x || !y) continue;
        if (!uguali(x, y)) return false;
        comuni++;
      }
      return comuni > 0;
    };
    const out = [];
    for (const r of righe || []) {
      const k = chiaveAmbigua(r) + (ePct(r) ? "|%" : "") + (eEga(r.esame) ? "|ega" : "");
      const gemella = out.find((x) => x.k === k && stessa(x.r, r));
      if (!gemella) { out.push({ k, r }); continue; }
      gemella.r = { ...gemella.r, valori: gemella.r.valori.map((v, i) => (v && v.v ? v : r.valori[i] || v)) };
    }
    return out.map((x) => x.r);
  }
  // le righe come si mostrano: prima via i doppioni, poi la formula in coppia
  const righeTabella = (righe) => fondiFormula(fondiDoppioni(righe));

  function raggruppaStorico(righe) {
    const per = new Map();
    for (const r of righe || []) {
      const sg = sigla(r.nome);
      const [sez, ord] = sezioneRiga(r, sg);
      if (!per.has(sez)) per.set(sez, []);
      per.get(sez).push({ ...r, sg, ord });
    }
    const out = [];
    for (const sez of ordineSezioni) {
      const l = per.get(sez);
      if (!l) continue;
      l.sort((a, b) => (a.ord - b.ord) || String(a.sg).localeCompare(String(b.sg), "it"));
      out.push({ nome: sez, righe: l });
      per.delete(sez);
    }
    for (const [sez, l] of per) out.push({ nome: sez, righe: l });   // mai, ma non si perde
    return out;
  }

  // Chi ha fatto quale valore. Quasi sempre una macchina sola, e allora non si
  // segna niente. Quando sono due o più — l'emocromo del POC e quello del
  // laboratorio — la più frequente resta muta e le altre prendono un segno,
  // spiegato sotto la tabella e sul valore stesso.
  const SEGNI = ["*", "†", "‡", "§"];
  // `simboli` è condiviso da tutta la tabella (esame → segno): così «*» vuol
  // dire lo stesso esame in ogni riga, e la legenda lo spiega una volta sola.
  function provenienze(r, simboli = new Map()) {
    const conta = new Map();
    (r.valori || []).forEach((v, i) => {
      if (!v || !v.v) return;
      const e = String(v.esame || r.esame || "").trim();
      if (!e) return;
      const c = conta.get(e) || { n: 0, ultimo: -1 };
      c.n++; c.ultimo = i;                       // date: dal più vecchio al più recente
      conta.set(e, c);
    });
    const nulla = { solita: "", segno: () => "", legenda: [] };
    if (conta.size < 2) return nulla;
    const ord = [...conta.entries()].sort((a, b) => (b[1].n - a[1].n) || (b[1].ultimo - a[1].ultimo));
    const solita = ord[0][0];
    const marchi = new Map();
    ord.slice(1).forEach(([e]) => {
      if (!simboli.has(e)) simboli.set(e, SEGNI[simboli.size] || "•");
      marchi.set(e, simboli.get(e));
    });
    return {
      solita,
      segno: (v) => marchi.get(String((v && v.esame) || r.esame || "").trim()) || "",
      legenda: [...marchi.entries()].map(([esame, segno]) => ({ segno, esame, solita })),
    };
  }

  const nomiInattesi = (rows) => {
    const out = [];
    for (const r of rows || []) {
      const n = String(r.nome || "").trim();
      if (n && !siglaCurata(n) && !out.includes(n)) out.push(n);
    }
    return out;
  };

  // ---- comparing draws -----------------------------------------------------
  // The identity of an analyte across draws: the same name however the
  // laboratory spelled it. Rows of two draws meet on this key.
  // Il campione neutro (S-, P-, B-…) non fa l'identità, come per sigla(): «S-Sodio» del portale
  // e «Sodio» della finestra Risultati sono lo stesso analita — solo se il resto è un nome noto
  // («S-100» resta intero), e U-/Lcr- restano. pCO₂ = pCO2, «Linfociti%» = «Linfociti %».
  const valKey = (nome) => { const n = String(nome || "").replace(/&nbsp;/g, " ").normalize("NFKC"), { pre, resto } = scomponi(n); return (siglaCurata(n) ? pre + resto : n).replace(/[^a-zà-ù0-9%+]+/gi, " ").replace(/\s*%\s*/g, " % ").trim().toLowerCase(); };

  // First ~160 chars of visible page text, for the log when a page is unexpected.
  function snippet(doc) {
    return (doc.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  // Fail-closed episode pinning: crea/exam pages ALWAYS carry EPISODIO_ID in
  // the audited system, so a page without one is itself an anomaly.
  // IMPORTANT: trust the DOCUMENT first — the response URL only echoes the id
  // WE requested, so it is not independent evidence of what the server served.
  function assertSameEpisode(doc, episodeId, what) {
    const found = findEpisodeIdInDoc(doc);
    if (!found) {
      throw restaQui(new StopError(`Episodio non identificabile nella pagina "${what}"`, "Interrotto per sicurezza."));
    }
    if (episodeId && found !== episodeId) {
      throw restaQui(new StopError(`La pagina "${what}" appartiene a un altro episodio (${found} ≠ ${episodeId})`, "Interrotto per sicurezza."));
    }
  }
  // Un errore dopo il quale la scheda NON va portata sul carrello: un episodio
  // che non torna (quel carrello potrebbe essere di un altro paziente), la
  // sessione scaduta, un'altra scheda al lavoro sulla stessa richiesta.
  const restaQui = (err) => { err.restaQui = true; return err; };
  // Uno stop dopo il quale il giro ritenta da solo, una volta: un elenco
  // venuto male (la riga che non si vede, l'elenco di un'altra risorsa).
  const ritentabile = (err) => { err.ritentabile = true; return err; };

  // Patient page: entry links to open a new richiesta.
  function patientModel(doc, baseUrl) {
    const link = (title) => {
      const a = doc.querySelector(`a[title="${title}"]`);
      return a ? absUrl(a, "href", baseUrl) : null;
    };
    return {
      labUrl: link("Richieste Laboratorio"),
      radioUrl: link("Richieste Radiologia"),
    };
  }

