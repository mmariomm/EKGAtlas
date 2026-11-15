//@frammento 26-stato-esami-vitali.js — STATO ESAMI (richieste, allergie e anagrafica della pagina, statoEsami/statoHtml)
//@ e PARAMETRI VITALI (NEWS2, cuore).
  // ============================================================ STATO ESAMI
  // Quello che il pannello sa degli esami di un paziente, per la riga dei
  // Pazienti, il letto, la riga «Aperti» delle Dimissioni e il suffisso grigio
  // delle Richieste. Viene da due posti soli, e da nient'altro:
  //  1. la pagina del paziente quando è aperta (dal medico, dal pannello, da
  //     un ordine in sottofondo): ogni richiesta del gestionale è una riga
  //     con TIPO=RICH — anche quelle fatte a mano —, l'ora (DATA_ORD), gli
  //     esami (DESCRIZIONE_TITLE), il tipo (l'icona: Laboratorio, Radiologia,
  //     Consulenze → ECG solo se l'esame è un elettrocardiogramma) e lo stato:
  //     un REFERTO, o la finestra «Visualizza Risultati», vuol dire «tornato»;
  //     niente dei due, «in attesa»; un'icona che dice annullata/revocata la
  //     toglie dal conto;
  //  2. gli esami che PS Assist ha messo in carrello (il giro finito), per
  //     numero di richiesta: finché la pagina del paziente non elenca quella
  //     richiesta contano come «ordinati da qui, in attesa».
  // Un ordine e il suo risultato si legano solo così: stessa riga del
  // gestionale, o stesso numero di richiesta. Mai per nome e ora a occhio.
  // Al server non si chiede niente: si aggiorna quando la pagina si apre.
  // Solo numeri di episodio, ore e nomi di esami: mai il nome del paziente.
  //
  // Quanto può aspettare un esame prima di farsi ambra e poi rosso (minuti
  // dall'ora della richiesta). Li tara il medico, qui.
  const ATTESA_LAB = [60, 120];
  const ATTESA_ECG = [15, 30];
  const ATTESA_IMG = [90, 180];
  const ATTESA = { lab: ATTESA_LAB, ecg: ATTESA_ECG, img: ATTESA_IMG };
  // letto più di mezz'ora fa: grigio, «letto alle 11:02»
  const STATO_VECCHIO = 30 * 60e3;
  const STATO = "stato.v1";
  const STATO_TTL = 24 * 3600e3;
  const TIPI_ESAME = [["lab", "Lab"], ["ecg", "ECG"], ["img", "RX"]];
  const ANNULLATA = /annullat|revocat|cancellat|rifiutat|non\s+esegu|sospes/i;
  // «0-324 TROPONINA ULTRASENSIBILE (POC3001)» → «TROPONINA ULTRASENSIBILE (POC3001)»: il nome del catalogo
  const nomeEsame = (s) => String(s || "").replace(/ /g, " ").replace(/^\s*\d+-\d+\s+/, "").replace(/\s+/g, " ").trim();
  const chiaveEsame = (s) => nomeEsame(s).toUpperCase();
  // istanteDa() scrive l'ora del gestionale come se fosse UTC: qui serve l'istante vero
  const istanteLocale = (dt) => {
    if (!dt || !dt.ts) return 0;
    const d = new Date(dt.ts);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()).getTime();
  };
  function tipoEsame(label, icone, sistema) {
    const l = chiaveEsame(label), t = icone.join(" ");
    if (/ELETTROCARDIOGRAMM|\bECG\b/.test(l)) return "ecg";
    if (/radiolog/i.test(t)) return "img";
    if (/laborator/i.test(t)) return "lab";
    if (/consulen/i.test(t)) return "";
    const s = String(sistema || "").toUpperCase();
    if (s.includes("RIS") || /\bRX\b|RADIOGRAF|\bTC\b|\bTAC\b|ECOGRAF|RISONANZA|\bRMN\b/.test(l)) return "img";
    if (s.includes("LIS")) return "lab";
    return "";
  }
  // Le richieste che la pagina del paziente elenca. Una riga per richiesta
  // (o per prelievo, per le finestre Risultati), coi suoi esami e il loro tipo.
  function richiestePagina(doc) {
    const out = [], righe = new Set(), chiavi = new Set();
    const ancore = doc.querySelectorAll('input[name="TIPO"][value="RICH"], a[title="Visualizza Risultati"]');
    for (const el of ancore) {
      const tr = el.closest("tr");
      if (!tr || righe.has(tr)) continue;
      righe.add(tr);
      const cella = el.closest("td");
      const descr = cella?.querySelector('input[name="DESCRIZIONE_TITLE"]')?.value || cella?.getAttribute("title") || "";
      const nomi = descr.split(";").map(nomeEsame).filter(Boolean);
      if (!nomi.length) continue;
      const stati = [...(cella?.querySelectorAll("img[title]") || [])].map((x) => x.getAttribute("title") || "");
      if (stati.some((t) => ANNULLATA.test(t))) continue;
      const prima = tr.querySelector(":scope > td");
      const icone = prima && prima !== cella ? [...prima.querySelectorAll("[title]")].map((x) => x.getAttribute("title") || "") : [];
      const ref = [...tr.querySelectorAll('a[title="REFERTO"]')].find((a) => /REFERTO_ID=/.test(a.getAttribute("onclick") || a.getAttribute("href") || ""));
      const ris = tr.querySelector('a[title="Visualizza Risultati"]');
      const sistema = (/REFERTO_SISTEMA=([^&'"]+)/.exec(ref?.getAttribute("onclick") || "") || [])[1] || "";
      const rid = (/RICHIESTA_ID=(\d+)/.exec(prima?.innerHTML || "") || [])[1] || "";
      const accesso = (/RCS_ACCESSO_ID=(\d+)/.exec(ris?.getAttribute("onclick") || "") || [])[1] || "";
      const esami = nomi.map((n) => [tipoEsame(n, icone, sistema), n]).filter(([t]) => t);
      if (!esami.length) continue;
      const ts = istanteLocale(istanteRiga(tr));
      const k = rid ? `r${rid}:${nomi.join("|")}` : accesso ? `a${accesso}` : `t${ts}:${nomi.join("|")}`;
      if (chiavi.has(k)) continue;
      chiavi.add(k);
      out.push({ k, rid, ts, esami, fatto: ref ? "referto" : ris ? "risultati" : "" });
    }
    return out;
  }
  // Allergie e Attenzione del gestionale, parola per parola. Senza il campo
  // in pagina: non lette — mai «nessuna».
  function allergiePagina(doc) {
    const ta = doc.querySelector('textarea[name="ALLERGIE"]');
    const nega = doc.querySelector('input[name="ALLERGIE_NEGA"]');
    if (!ta && !nega) return null;
    const testo = String(ta ? ta.value : "").replace(/\s*\n\s*/g, " · ").replace(/\s+/g, " ").trim();
    return { nega: !!(nega && nega.checked), testo };
  }
  function attenzionePagina(doc) {
    const tit = [...doc.querySelectorAll("td.AFCColumnTD")].find((td) => td.textContent.replace(/\s+/g, " ").trim() === "Attenzione");
    if (!tit) return null;
    const td = tit.closest("tr")?.nextElementSibling?.querySelector("td");
    if (!td) return [];
    const righe = [""];
    const giro = doc.createTreeWalker(td, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = giro.nextNode(); n; n = giro.nextNode()) {
      if (n.nodeType === 1 && n.tagName === "BR") righe.push("");
      else if (n.nodeType === 3) righe[righe.length - 1] += n.nodeValue;
    }
    return righe.map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean);
  }
  // L'età e il sesso: la riga in corpo 120% del riquadro («17/05/1949 (77) M»),
  // se no il codice fiscale (giorno oltre 40: femmina).
  function sessoDaCf(cf) {
    if (!/^[A-Z]{6}[\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{2}/.test(cf || "")) return "";
    const g = Number(cf.slice(9, 11).replace(/[LMNPQRSTUV]/g, (c) => "LMNPQRSTUV".indexOf(c)));
    return g > 40 ? "F" : g ? "M" : "";
  }
  function anagraficaPagina(doc = document) {
    const r = riquadroPaziente(doc);
    const eta = etaInPagina(doc);
    if (!r) return { eta, sesso: "" };
    // riga per riga: fra un <br> e l'altro il testo si attaccherebbe («M» e il codice fiscale)
    const pezzi = [], giro = doc.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    for (let n = giro.nextNode(); n; n = giro.nextNode()) pezzi.push(n.nodeValue || "");
    const t = pezzi.join(" ").replace(/\s+/g, " ").toUpperCase();
    const m = /\b\d{1,2}\/\d{1,2}\/\d{4}\s*\(\d{1,3}\)\s*([MF])\b/.exec(t);
    const cf = CF_UNO.exec(t);
    return { eta, sesso: m ? m[1] : cf ? sessoDaCf(cf[0]) : "" };
  }

  // ======================================================= PARAMETRI VITALI
  // Il cuore accanto al nome: dalle righe dei parametri vitali della pagina
  // del paziente (`<tr id="VAMI">`: l'ora, poi «ETICHETTA: <b>valore</b>» uno
  // dopo l'altro). Anche quelli del triage stanno lì. Conta la riga più
  // recente che porta almeno un parametro (il triage, quindi, solo finché è
  // l'unica); un parametro che quella riga non ha NON si prende da una riga
  // più vecchia e non si inventa: si conta su quello che c'è e il passaggio
  // del mouse dice cosa manca. Si legge solo quando la pagina è aperta.
  //
  // Rosso: un parametro da solo nella fascia rossa NEWS2 (3 punti) — SpO2 ≤91
  // (una soglia per tutti), FR ≤8 o ≥25, PAS ≤90 o ≥220, FC ≤40 o ≥131,
  // T ≤35,0, coscienza: ACVPU diverso da A o GCS <15 — oppure NEWS2 ≥7.
  // Ambra: NEWS2 5–6. Altrimenti niente. Dopo 4 ore senza una riga più nuova
  // il cuore resta, vuoto: «♡ 5h».
  const VIT_VECCHIO = 4 * 3600e3;
  const VIT_ETICHETTE = [
    ["acvpu", /^ACVPU$/], ["gcs", /^GCS$/], ["fio2", /^FIO2$/],
    ["fr", /^(FREQUENZARESPIRATORIA|FR|FREQRESP|ATTIRESPIRATORI)$/],
    ["spo2", /^(SATURIMETRIA|SPO2|SATO2|SATURAZIONE)$/],
    ["fc", /^(FCRAR|FC|FREQUENZACARDIACA|POLSOFC)$/],
    ["pas", /^(SISTOLICAMAX|SISTOLICA|PAS|PASISTOLICA)$/], ["pad", /^(DIASTOLICAMIN|DIASTOLICA|PAD|PADIASTOLICA)$/],
    ["t", /^(TCTIMPASC|TC|TEMPERATURA|TEMP)$/],
  ];
  // valori fuori da questi limiti sono un errore di battitura, non un paziente
  const VIT_LIMITI = { gcs: [3, 15], fio2: [21, 100], fr: [1, 80], spo2: [40, 100], fc: [15, 300], pas: [40, 300], pad: [15, 200], t: [25, 45] };
  function vitaliRiga(tr) {
    const p = {};
    for (const b of tr.querySelectorAll("td b")) {
      // l'etichetta è il testo fra il valore di prima (o l'inizio) e questo
      let et = "";
      for (let n = b.previousSibling; n && !(n.nodeType === 1 && n.tagName === "B"); n = n.previousSibling) et = (n.textContent || "") + et;
      et = (et.split(/\s\/\s/).pop() || "").replace(/:\s*$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const chi = VIT_ETICHETTE.find(([, re]) => re.test(et))?.[0];
      if (!chi || chi in p) continue;
      const v = b.textContent.replace(/\s+/g, " ").trim();
      if (chi === "acvpu") { const m = /^([ACVPU])(?![A-Z])/i.exec(v); if (m) p.acvpu = m[1].toUpperCase(); continue; }
      if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(v)) continue;
      const n = Number(v.replace(",", ".")), [lo, hi] = VIT_LIMITI[chi];
      if (n >= lo && n <= hi) p[chi] = n;
    }
    return ["fr", "spo2", "fc", "pas", "t", "acvpu", "gcs"].some((k) => k in p) ? p : null;
  }
  function vitaliPagina(doc) {
    let ultima = null, righe = 0;
    const tutte = [];
    for (const tr of doc.querySelectorAll('tr[id="VAMI"]')) {
      const p = vitaliRiga(tr);
      const ts = p ? istanteLocale(istanteRiga(tr)) : 0;
      if (!p || !ts) continue;   // senza l'ora non si sa se è l'ultima: non conta
      righe++;
      tutte.push({ ts, p });
      if (!ultima || ts > ultima.ts) ultima = { ts, p };
    }
    // e le righe, dall'ultima indietro (al massimo 12), per il passaggio del mouse
    const storia = tutte.sort((a, b) => b.ts - a.ts).slice(0, 12);
    return ultima ? { ...ultima, righe, storia } : null;
  }
  // NEWS2 su quello che c'è: i punti, i parametri in fascia rossa (3 punti da
  // soli), quelli che la riga non ha. Coscienza: ACVPU diverso da A, o GCS <15.
  function news2(p) {
    const fasce = {
      fr: ["FR", (v) => (v <= 8 ? 3 : v <= 11 ? 1 : v <= 20 ? 0 : v <= 24 ? 2 : 3)],
      spo2: ["SpO2", (v) => (v <= 91 ? 3 : v <= 93 ? 2 : v <= 95 ? 1 : 0)],
      fio2: ["O2 (FiO2)", (v) => (v > 21 ? 2 : 0)],
      pas: ["PA", (v) => (v <= 90 ? 3 : v <= 100 ? 2 : v <= 110 ? 1 : v <= 219 ? 0 : 3)],
      fc: ["FC", (v) => (v <= 40 ? 3 : v <= 50 ? 1 : v <= 90 ? 0 : v <= 110 ? 1 : v <= 130 ? 2 : 3)],
      t: ["T", (v) => (v <= 35 ? 3 : v <= 36 ? 1 : v <= 38 ? 0 : v <= 39 ? 1 : 2)],
    };
    let punti = 0;
    const rossi = [], mancano = [], per = {};
    for (const [k, [nome, f]] of Object.entries(fasce)) {
      if (p[k] == null) { mancano.push(nome); continue; }
      const n = f(p[k]);
      punti += n;
      if (n) per[k] = n;
      if (n === 3) rossi.push(k);
    }
    if (p.acvpu == null && p.gcs == null) mancano.push("coscienza");
    else if ((p.acvpu && p.acvpu !== "A") || (p.gcs != null && p.gcs < 15)) { const k = p.acvpu && p.acvpu !== "A" ? "acvpu" : "gcs"; punti += 3; per[k] = 3; rossi.push(k); }
    return { punti, rossi, mancano, per, livello: rossi.length || punti >= 7 ? "ros" : punti >= 5 ? "amb" : "" };
  }
  // i parametri di una riga, scritti come si leggono
  function vitTesto(p) {
    const num = (v) => String(v).replace(".", ",");
    return {
      fr: p.fr != null && `FR ${p.fr}`, spo2: p.spo2 != null && `SpO2 ${p.spo2}`, fio2: p.fio2 > 21 && `FiO2 ${p.fio2}`,
      fc: p.fc != null && `FC ${p.fc}`, pas: p.pas != null && `PA ${p.pas}${p.pad != null ? "/" + p.pad : ""}`,
      t: p.t != null && `T ${num(p.t)}`, acvpu: p.acvpu && p.acvpu !== "A" && `ACVPU ${p.acvpu}`, gcs: p.gcs != null && `GCS ${p.gcs}`,
    };
  }
  // Il cuore di un paziente, o null: rosso, ambra, e vuoto se la riga ha più di 4 ore
  function cuoreDi(vit, ora = Date.now()) {
    if (!vit || !vit.p || !vit.ts) return null;
    const n = news2(vit.p);
    if (!n.livello) return null;
    const eta = Math.max(0, ora - vit.ts), vecchio = eta > VIT_VECCHIO;
    const testo = vitTesto(vit.p), rossi = n.rossi.map((k) => testo[k]).filter(Boolean);
    // il passaggio del mouse: il NEWS2, poi le righe misurate, l'ultima in alto
    const storia = (Array.isArray(vit.storia) && vit.storia.length ? vit.storia : [{ ts: vit.ts, p: vit.p }]).filter((r) => r && r.ts && r.p);
    const titolo = [
      `NEWS2 ${n.punti}${rossi.length ? ` · critico: ${rossi.join(" · ")}` : ""}`,
      ...storia.map((r) => `${promOra(r.ts, ora)}  ${Object.values(vitTesto(r.p)).filter(Boolean).join(" · ")}`),
      vecchio ? `Nessuna riga più nuova da ${Math.floor(eta / 3600e3)} ore` : "",
    ].filter(Boolean).join("\n");
    // accanto al cuore, i parametri fuori norma: i più lontani prima, al massimo due
    const fuori = Object.entries(n.per).sort((x, y) => y[1] - x[1]).map(([k]) => testo[k]).filter(Boolean).slice(0, 2);
    return { livello: n.livello, punti: n.punti, vecchio, fuori, ore: Math.floor(eta / 3600e3), ts: vit.ts, titolo, chiave: `${vit.ts}|${n.livello}` };
  }

  function statoTutti() {
    const s = store.get(STATO, {});
    const tutti = s && typeof s === "object" && !Array.isArray(s) ? s : {};
    const ora = Date.now();
    // (3.90) una lettura non scrive: gli scaduti restano fuori, e se ne vanno alla prossima scrittura voluta (scriviStato)
    for (const k of Object.keys(tutti)) if (!tutti[k] || ora - (tutti[k].agg || 0) > STATO_TTL) delete tutti[k];
    return tutti;
  }
  const statoDi = (ep) => (ep ? statoTutti()[ep] || null : null);
  function scriviStato(ep, cambia) {
    if (!ep) return false;
    const tutti = statoTutti();
    const s = cambia({ ...(tutti[ep] || {}) });
    if (!s) return false;
    tutti[ep] = { ...s, agg: Date.now() };
    const tieni = Object.entries(tutti).sort((a, b) => (b[1].agg || 0) - (a[1].agg || 0)).slice(0, PATIENTS_MAX);
    return store.set(STATO, Object.fromEntries(tieni));
  }
  // La pagina del paziente letta adesso. Un risultato che c'è adesso e prima
  // no porta l'ora in cui è stato visto: è «nuovo» finché il medico non guarda
  // gli Esiti. La prima lettura di un paziente è il riferimento: niente nuovi.
  function leggiStatoPagina(ep, doc = document) {
    const righe = richiestePagina(doc), all = allergiePagina(doc), att = attenzionePagina(doc), vit = vitaliPagina(doc);
    return scriviStato(ep, (s) => {
      const ora = Date.now(), primaVolta = !s.letto;
      const prima = new Map((s.righe || []).map((r) => [r.k, r]));
      s.righe = righe.slice(0, 80).map((r) => {
        const p = prima.get(r.k);
        return { ...r, quando: r.fatto ? (p && p.fatto ? p.quando || 0 : primaVolta ? 0 : ora) : 0 };
      });
      s.letto = ora;
      if (all || att) s.anag = { allergie: all, attenzione: att, ts: ora };
      if (vit) s.vit = vit;   // una pagina senza righe dei parametri non cancella le ultime lette
      return s;
    });
  }
  // Le allergie (e l'«Attenzione») di una pagina del paziente letta adesso — riletta per il telefono, o appena
  // salvata dal telefono —: la stessa verità per la riga sotto il nome e per il riepilogo della Terapia.
  function segnaAnag(ep, doc) {
    const all = allergiePagina(doc), att = attenzionePagina(doc);
    if (ep && (all || att)) scriviStato(ep, (s) => { s.anag = { allergie: all, attenzione: att, ts: Date.now() }; return s; });
  }
  // Gli esami appena messi in carrello da PS Assist, con il numero della richiesta.
  function segnaOrdineNostro(ep, rid, items) {
    const esami = (items || []).map((it) => {
      const label = nomeEsame(it.label || examLabel(it.res, it.code));
      return [RADIO_SET.includes(it.res) ? "img" : /ELETTROCARDIOGRAMM|\bECG\b/i.test(label) ? "ecg" : "lab", label];
    }).filter(([, l]) => l);
    if (!ep || !esami.length) return false;
    return scriviStato(ep, (s) => {
      const l = (s.nostri || []).filter((o) => !rid || o.rid !== String(rid));
      l.push({ ts: Date.now(), rid: rid ? String(rid) : "", esami });
      s.nostri = l.slice(-20);
      return s;
    });
  }
  // Fine turno (pagina di login): le allergie se ne vanno, il resto no — come
  // i promemoria, sono solo episodi, ore e nomi di esami.
  function dimenticaAnagrafiche() {
    const tutti = statoTutti();
    let tolte = 0;
    for (const s of Object.values(tutti)) if (s.anag) { delete s.anag; tolte++; }
    if (tolte) store.set(STATO, tutti);
  }

  // Tutti gli esami noti di un paziente, uno per voce, e il conto per tipo.
  function statoEsami(s, ora = Date.now()) {
    if (!s) return null;
    const pagina = new Set((s.righe || []).map((r) => r.rid).filter(Boolean));
    const aperte = new Set(daConfermare().map((x) => x.rid));   // ancora da confermare: non sono ordini
    const esami = [];
    for (const r of s.righe || []) for (const [tipo, label] of r.esami || []) {
      esami.push({ tipo, label, ts: r.ts || 0, fatto: r.fatto || "", quando: r.quando || 0, qui: false });
    }
    let ultimoNostro = 0;
    for (const o of s.nostri || []) {
      if (o.rid && (pagina.has(o.rid) || aperte.has(o.rid))) continue;
      ultimoNostro = Math.max(ultimoNostro, o.ts || 0);
      for (const [tipo, label] of o.esami || []) esami.push({ tipo, label, ts: o.ts || 0, fatto: "", quando: 0, qui: true });
    }
    if (!esami.length) return null;
    const tipi = {};
    for (const e of esami) {
      const t = (tipi[e.tipo] = tipi[e.tipo] || { n: 0, fatti: 0, attesa: 0, pendenti: 0 });
      t.n++;
      if (e.fatto) t.fatti++;
      else { t.pendenti++; if (e.ts && (!t.attesa || e.ts < t.attesa)) t.attesa = e.ts; }
    }
    const visto = Math.max(s.esitiVisto || 0, 0);
    const nuovi = esami.filter((e) => e.fatto && e.quando && e.quando > visto);
    const v = s.valori || {};
    const letto = s.letto || ultimoNostro;
    return {
      esami, tipi, nuovi, valoriNuovi: v.nuovi || 0, valoriFuori: v.fuori || 0, valoriFuoriTot: v.fuoriTot ?? (v.fuori || 0),
      nuovo: !!nuovi.length || (v.nuovi || 0) > 0, rosso: (v.fuori || 0) > 0,
      // la pagina del paziente non è mai stata letta: si sa solo quello che è partito da qui
      letto, vecchio: !!letto && ora - letto > STATO_VECCHIO, soloQui: !s.letto,
    };
  }
  // «ROSSI MARIO» → «ROSSI M.» (il cognome si porta dietro le particelle: DE LUCA A.)
  function nomeBreve(nome) {
    const w = String(nome || "").trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < w.length - 2 && PARTICELLE_COGNOME.has(w[i].toUpperCase())) i++;
    const cognome = w.slice(0, i + 1).join(" "), resto = w.slice(i + 1);
    return !cognome ? "" : resto.length ? `${cognome} ${resto[0][0].toUpperCase()}.` : cognome;
  }
  // «50′», «1h20», «2h»
  function attesaTesto(min) { return min < 60 ? `${min}′` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`; }
  // neutro sotto la prima soglia, ambra da lì, rosso dalla seconda
  function bandaAttesa(min, [amb, ros]) { return min >= ros ? "ros" : min >= amb ? "amb" : ""; }
  const attesaBanda = (tipo, min) => bandaAttesa(min, ATTESA[tipo] || ATTESA_LAB);
  const minDa = (ts, ora) => Math.max(0, Math.floor((ora - ts) / 60e3));
  // «RX ADDOME SENZA CONTRASTO (A692)» → «RX addome senza contrasto»: le sigle restano sigle
  const frase = (label) => {
    const w = shortLabel(nomeEsame(label)).split(" ").map((x, i) => (x.length <= 3 && /^[A-Z0-9-]+$/.test(x) ? x : i ? x.toLowerCase() : x[0] + x.slice(1).toLowerCase()));
    return w.join(" ");
  };
  // Tutto quello che si sa degli esami, in parole: il passaggio del mouse
  // della riga, del letto e del segnale.
  function statoTitolo(st, ora = Date.now()) {
    if (!st) return "";
    return [
      ...st.esami.map((e) => `${frase(e.label)}: ${e.fatto ? `${e.fatto === "referto" ? "refertato" : "risultati"}${e.ts ? ` (richiesta ${hhmm(e.ts)})` : ""}`
        : `in attesa${e.ts ? ` da ${attesaTesto(minDa(e.ts, ora))} (richiesta ${hhmm(e.ts)})` : ""}`}${e.qui ? " · ordinato da qui" : ""}`),
      st.nuovi.length ? `● nuovo da quando hai guardato gli Esiti: ${st.nuovi.map((e) => frase(e.label)).join(", ")}` : "",
      st.valoriNuovi ? `${st.valoriNuovi} ${st.valoriNuovi === 1 ? "valore nuovo" : "valori nuovi"} non ancora letti${st.valoriFuoriTot ? `, ${st.valoriFuoriTot} fuori range${st.valoriFuori ? ` (${st.valoriFuori} da guardare subito)` : ""}` : ""}` : "",
      st.soloQui ? "Solo gli esami ordinati da qui: la pagina del paziente non è ancora stata letta" : "",
      st.letto ? `letto alle ${hhmm(st.letto)}` : "",
    ].filter(Boolean).join("\n");
  }
  // La riga di stato: un pezzetto per tipo, sempre Lab · ECG · RX in
  // quest'ordine e ognuno col colore della sua sezione negli Esiti:
  // «Lab 3/6 50′», «ECG ✓», «RX 0/1 1h20». L'ambra e il rosso stanno solo sul
  // tempo che aspetta; il pallino «nuovo» dentro il pezzo del suo tipo (i
  // valori nuovi sono del Lab). Nella lista ogni pezzo ha la sua colonna,
  // così il Lab sta sempre allo stesso posto. Corta (l'area): solo quello che
  // aspetta, o ✓ se è tornato tutto.
  function statoHtml(st, { breve = false, ora = Date.now() } = {}) {
    if (!st) return "";
    const pezzi = [];
    const nuovoDi = (t) => st.nuovi.some((e) => e.tipo === t) || (t === "lab" && st.valoriNuovi > 0);
    const dot = (rosso) => `<b class="esdot${rosso ? " ros" : ""}" aria-label="${rosso ? "nuovo, fuori range" : "nuovo"}">●</b>`;
    for (const [t, nome] of TIPI_ESAME) {
      const x = st.tipi[t], nuovo = !breve && nuovoDi(t);
      if (!x && !nuovo) continue;
      if (breve && !x.pendenti) continue;
      const min = x && x.pendenti && x.attesa ? minDa(x.attesa, ora) : null, banda = min == null ? "" : attesaBanda(t, min);
      const timer = min == null ? "" : ` <i class="esatt${banda ? " " + banda : ""}">${attesaTesto(min)}</i>`;
      const conto = breve || !x ? "" : ` ${x.n === 1 && x.fatti === 1 ? "✓" : `${x.fatti}/${x.n}`}`;
      pezzi.push(`<span class="esp es-${t}"><b class="esn">${nome}</b>${conto}${timer}${nuovo ? " " + dot(t === "lab" && st.rosso) : ""}</span>`);
    }
    if (breve && !pezzi.length) pezzi.push(`<span class="esp">✓</span>`);
    const tutto = breve && st.nuovo ? " " + dot(st.rosso) : "";
    return `<span class="esst${breve ? " breve" : ""}${st.vecchio ? " vecchio" : ""}" title="${esc(statoTitolo(st, ora))}">${pezzi.join(" ")}${tutto}</span>`;
  }
  // I tre segni della riga del tabellone: Lab · ECG · RX, ognuno col suo
  // stato. Grigio: chiesto e ancora in attesa, col tempo dalla richiesta
  // («Lab 50′»); ambra: tornato in parte; verde: tornato tutto. Mai chiesto:
  // niente. Nessun valore, nessun testo.
  function marchiEsami(st, ora = Date.now()) {
    if (!st) return "";
    return TIPI_ESAME.map(([t, nome]) => {
      const x = st.tipi[t];
      if (!x || !x.n) return "";
      const stato = !x.fatti ? "att" : x.fatti < x.n ? "parz" : "ok";
      const min = x.pendenti && x.attesa ? minDa(x.attesa, ora) : null;
      const dopo = stato === "att" ? (min != null ? ` ${attesaTesto(min)}` : "") : stato === "parz" ? ` ${x.fatti}/${x.n}` : " ✓";
      const tit = stato === "att" ? `${nome}: chiesto${min != null ? `, in attesa da ${attesaTesto(min)}` : ""}`
        : stato === "parz" ? `${nome}: tornati ${x.fatti} di ${x.n}` : `${nome}: tornato tutto`;
      return `<span class="esm es-${t} ${stato}" title="${esc(tit)}"><b>${nome}</b>${dopo}</span>`;
    }).join("");
  }
  // Il letto è piccolo: nome ed età, e al massimo UN segnale — un pallino.
  // Rosso: un esame oltre la seconda soglia, valori nuovi critici (solo gli
  // analiti di PRIMA_DI_TUTTI) fuori range, un promemoria passato. Ambra:
  // oltre la prima soglia, o un promemoria fra meno di 15 minuti. Blu: un
  // risultato nuovo, anche fuori range se non è critico. Grigio: qualcosa aspetta
  // (un esame, una cosa da fare). Il resto lo dice il passaggio del mouse.
  function segnaleLetto(st, aperte, ora = Date.now()) {
    const perche = { ros: [], amb: [], nuovo: [], att: [] };
    if (st) {
      for (const [t, nome] of TIPI_ESAME) {
        const x = st.tipi[t];
        if (!x || !x.pendenti) continue;
        const min = x.attesa ? minDa(x.attesa, ora) : null, b = min == null ? "" : attesaBanda(t, min);
        perche[b || "att"].push(`${nome} in attesa${min == null ? "" : ` da ${attesaTesto(min)}`}`);
      }
      if (st.rosso) perche.ros.push("valori nuovi critici fuori range");
      else if (st.valoriFuoriTot) perche.nuovo.push(st.valoriFuoriTot === 1 ? "un valore nuovo fuori range" : `${st.valoriFuoriTot} valori nuovi fuori range`);
      else if (st.valoriNuovi) perche.nuovo.push(st.valoriNuovi === 1 ? "un valore nuovo" : `${st.valoriNuovi} valori nuovi`);
      if (st.nuovi.length) perche.nuovo.push(`nuovo: ${st.nuovi.map((e) => frase(e.label)).join(", ")}`);
    }
    for (const x of aperte || []) {
      const b = x.t != null ? promBanda(x.t, ora) : "";
      perche[b || "att"].push(`da fare: ${x.t != null ? hhmm(x.t) + " " : ""}${x.testo}`);
    }
    const livello = ["ros", "amb", "nuovo", "att"].find((k) => perche[k].length);
    if (!livello) return "";
    const testo = ["ros", "amb", "nuovo", "att"].flatMap((k) => perche[k]).join("\n");
    return `<b class="stseg ${livello}" role="img" aria-label="${esc(testo.replace(/\n/g, "; "))}" title="${esc(testo)}"></b>`;
  }

