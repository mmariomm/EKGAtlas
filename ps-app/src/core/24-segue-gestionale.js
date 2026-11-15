//@frammento 24-segue-gestionale.js — SEGUE IL GESTIONALE: lettura e sincronia della lista smart (triage, dimessi), dimentica/azzera; CONSENSI.
  // ------------------------------------------------- SEGUE IL GESTIONALE
  // La lista smart (tutto il pronto soccorso, ogni area col suo nome e il
  // colore del triage) si legge appena il gestionale è aperto (la prima pagina
  // dopo l'accesso, o dopo un «Reset»), quando il medico apre l'app
  // sull'iPhone (o ci torna sopra; al più ogni 2 minuti) e subito col ⟳ del
  // tabellone. Niente giri da soli a tempo. Si apre come la apre il medico: col SUO link (l'icona
  // elenco_smart della lista dell'area, annotato quando lo si vede — mai un
  // indirizzo costruito), in una scheda dietro che si chiude appena letta.
  const SMART_URL = "smart.url.v1";            // { url, ts } — dalla pagina, mai inventato; un'impostazione
  const SMART_SYNC = "smart.sync.v1";          // { ts: partita, fine, esito, n, intera, dimessi, letta: l'ultima lettura riuscita }
  const DIMESSI = "dimessi.v1";                // { id, ts, eps, nomi, posti } — l'ultima uscita, per «Annulla»
  const SMART_TEL = 2 * 60e3;                  // dall'iPhone (e al gestionale appena aperto): al più una rilettura ogni 2 minuti
  // Il gestionale appena aperto: la smart non è ancora stata letta da quando
  // (nessuna lettura riuscita), o il service worker l'ha rimandata per un motivo
  // del momento (un ordine, un carrello aperto). Una scheda dietro che si è
  // aperta e non ha letto non si riapre da sola: il telefono e il ⟳ ci riprovano.
  // («estensione»: il service worker che dormiva non ha risposto alla scheda appena aperta)
  const SMART_PIU_TARDI = new Set(["ordine in corso", "carrello aperto", "già in corso", "troppe letture in corso", "estensione"]);
  const smartDaLeggere = (s = store.get(SMART_SYNC, null)) => !s || (!s.letta && SMART_PIU_TARDI.has(s.esito));
  const SMART_APERTO_MS = 1500;
  const SMART_GIRO = "smart.giro.v1";          // (nella scheda dietro) le schede della smart già lette
  const DIMESSI_MS = 8000;
  const DIMESSI_QUOTA = 0.3;                   // oltre il 30% in un colpo solo: non si archivia nessuno
  const NO_DIM_MS = 3 * 3600e3;                // «Annulla» su un dimesso: per 3 ore non si riarchivia da solo
  // il link della lista smart, come lo scrive la lista dell'area: l'icona
  // elenco_smart.png dentro un <a onclick="window.open('<indirizzo>', …)">
  function smartLinkDi(doc, base) {
    let origine = "";
    try { origine = new URL(base).origin; } catch { return ""; }
    for (const img of doc.querySelectorAll('img[src*="elenco_smart"]')) {
      const a = img.closest("a[onclick]");
      const m = a && /window\.open\(\s*(['"])(.+?)\1/.exec(a.getAttribute("onclick") || "");
      if (!m) continue;
      let u;
      try { u = new URL(m[2].replace(/&amp;/g, "&"), base); } catch { continue; }
      if (u.origin !== origine || !/\/sa4pso\/restrict\/menuPsoSmart\.do$/.test(u.pathname) || u.searchParams.get("MVPG") !== "PsoPazientiSmart"
          || [...u.searchParams.keys()].some((k) => !["MVPG", "PAZIENTI_FILTRO"].includes(k))) continue;
      return u.href;
    }
    return "";
  }
  function smartUrlQui(doc, url) {
    const u = smartLinkDi(doc, url);
    if (u && store.get(SMART_URL, null)?.url !== u) store.set(SMART_URL, { url: u, ts: Date.now() });
    return u;
  }
  // La lista smart letta: le sue schede («Ambulatorio (8)», …: quella scelta
  // e le altre, coi loro link), le righe, e se è filtrata. Le schede «nostre»
  // sono quelle dei pazienti di cui il medico risponde: Ambulatorio (e OBI,
  // dove c'è); l'attesa del triage e «tutti» no.
  const SCHEDA_NOSTRA = /^(AMBULATORIO|OBI)\b/i, SCHEDA_TRIAGE = /^TRIAGE\b/i;
  const TRIAGE_LISTA = "triage.lista.v1";   // { ts, righe: [{ nome, breve, eta, triage, area, arrivo }] } — per il telefono e la mappa
  // Chi aspetta al Triage, sulla mappa (PC e telefono): non è fra i pazienti,
  // ma di partenza sta nella Sala attesa della Bassa — un posto di partenza,
  // mai scritto. Il medico lo porta dove vuole (trascinandolo): quel posto si
  // scrive, sotto la sua chiave — nome e ora d'arrivo; la nascita qui non si
  // tiene —, e vince. Letta più di 30 minuti fa, la lista non conta (come sul telefono).
  const TRIAGE_ATTESA = { k: "ps", tipo: "area", id: "attesa" };
  function chiaveTriage(r) {
    let h = 0x811c9dc5;
    for (const c of `${normNome(r?.nome)}|${Number(r?.arrivo) || 0}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
    return "tr" + h.toString(36);
  }
  // chi è al Triage adesso e non è già fra i pazienti (lui ha il suo posto, o la lista: mai spostato da qui)
  function triageOspiti(pazienti) {
    const t = store.get(TRIAGE_LISTA, null);
    if (!t || !Array.isArray(t.righe) || Date.now() - (t.ts || 0) > 30 * 60e3) return [];
    const noti = new Set((pazienti || []).map((p) => normNome(p.name)));
    return t.righe.filter((r) => r && r.nome && !noti.has(normNome(r.nome))).map((r) => ({ ...r, k: chiaveTriage(r) }));
  }
  // dove sta: il posto che gli ha dato il medico, in una delle mappe; se no la Sala attesa della Bassa (se c'è)
  function postoOspite(key, sala) {
    for (const k of Object.keys(MAPPE)) {
      const raw = store.get(MAPPE[k].posti, {}), v = raw && typeof raw === "object" ? raw[key] : null, s = v && sala(k);
      if (s && (v.tipo === "letto" ? s.letti : v.tipo === "area" ? s.aree : []).some((o) => o.id === v.id)) return { k, tipo: v.tipo, id: v.id, ts: +v.ts || 0 };
    }
    // la Sala attesa di partenza: l'area «attesa» della mappa «ps»; se il medico
    // l'ha rinominata o rifatta, una che si chiama «attesa», se no la prima area
    // (così un paziente del triage non sparisce mai dalla mappa personalizzata).
    const ps = sala(TRIAGE_ATTESA.k);
    if (!ps || !Array.isArray(ps.aree) || !ps.aree.length) return null;
    const a = ps.aree.find((x) => x.id === TRIAGE_ATTESA.id) || ps.aree.find((x) => /attes/i.test(x.nome || "")) || ps.aree[0];
    return a ? { k: TRIAGE_ATTESA.k, tipo: "area", id: a.id, ts: 0 } : null;
  }
  function leggiSmartPagina(doc, url) {
    if (!eSmart(doc, url) || classify(doc) === "login" || !doc.querySelector(".AFCHeaderTable")) return { ok: false, perche: "non è la lista smart" };
    let origine = "";
    try { origine = new URL(url).origin; } catch { return { ok: false, perche: "indirizzo" }; }
    const schede = [];
    for (const a of doc.querySelectorAll("a.shiny-button, a.shiny-button-selected")) {
      if (/window\.close/.test(a.getAttribute("onclick") || "")) continue;   // «Chiudi»
      const t = spazi(a.textContent), m = /^(.*?)\s*\((\d+)\)$/.exec(t), base = spazi(m ? m[1] : t);
      let u = "";
      try {
        const x = new URL(a.getAttribute("href") || "", url);
        if (x.origin === origine && x.searchParams.get("MVPG") === "PsoPazientiSmart") u = x.href;
      } catch { /* niente */ }
      if (!u || !base) continue;
      schede.push({ base, n: m ? Number(m[2]) : null, sel: a.classList.contains("shiny-button-selected"), url: u, nostra: SCHEDA_NOSTRA.test(base), triage: SCHEDA_TRIAGE.test(base) });
    }
    let filtrata = [...doc.querySelectorAll('input[name^="s_"]')].some((i) => !/^(hidden|submit|button)$/i.test(i.type || "") && spazi(i.value))
      || [...doc.querySelectorAll('select[name^="s_"]')].some((s) => spazi(s.value));
    try { filtrata = filtrata || [...new URL(url).searchParams].some(([k, v]) => /^s_/.test(k) && v); } catch { /* niente */ }
    return { ok: true, schede, sel: schede.find((s) => s.sel) || null, filtrata, righe: righeSmart(doc) };
  }
  // un paziente che si conosce solo dalla lista smart: la chiave è l'impronta
  // (nome e nascita), finché la lista della sua area non dà il suo episodio
  function chiaveSmart(nome, nato) {
    let h = 0x811c9dc5;
    for (const c of `${normNome(nome)}|${nato}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
    return "sm" + h.toString(36);
  }
  // Chi era noto solo dalla smart ed ecco il suo episodio (la lista della sua
  // area, o la sua pagina): il posto, «Da fare» e l'area passano a lui.
  function fondiSmart(l, ep, nome, nato) {
    if (!nato) return null;
    const s = l.find((x) => x.smart && x.ep !== ep && normNome(x.name) === normNome(nome) && x.nato === nato);
    if (!s) return null;
    const da = s.ep;
    for (const k of TUTTI_I_POSTI()) {
      const posti = store.get(k, null);
      if (posti && posti[da]) { if (!posti[ep]) posti[ep] = posti[da]; delete posti[da]; store.set(k, posti); }
    }
    const df = store.get(PROM, null);
    if (df && df[da]) { df[ep] = [...(df[ep] || []), ...df[da]]; delete df[da]; store.set(PROM, df); }
    const a = areeLeggi();
    if (a.membri[da]) { if (!a.membri[ep]) a.membri[ep] = a.membri[da]; delete a.membri[da]; store.set(AREE, a); }
    if (l.some((x) => x.ep === ep)) l.splice(l.indexOf(s), 1);
    else { s.ep = ep; delete s.smart; }   // la riga resta, con l'episodio vero (e l'ingresso, il triage)
    return s;
  }
  // Uscire da un elenco intero vuol dire «dimesso»: archiviato (si riporta
  // con «Annulla», per 8 secondi, o dagli Archiviati), il letto vuoto. Mai da
  // un elenco filtrato, monco, vuoto o da una pagina di login/errore (chi
  // chiama lo sa), mai più del 30% in un colpo (allora niente, e zitti), mai
  // chi il medico ha appena riportato indietro.
  function dimettiUsciti(eps, su) {
    const ora = Date.now(), list = store.get("patients.v1", []);
    if (!Array.isArray(list) || !eps.length || !su || eps.length > su * DIMESSI_QUOTA) return [];
    const via = list.filter((p) => p && eps.includes(p.ep) && !p.arch && !(ora - (p.noDim || 0) < NO_DIM_MS));
    if (!via.length) return [];
    const posti = {};
    for (const k of TUTTI_I_POSTI()) {
      const pp = store.get(k, null);
      if (!pp || typeof pp !== "object") continue;
      for (const p of via) if (pp[p.ep]) { (posti[k] = posti[k] || {})[p.ep] = pp[p.ep]; delete pp[p.ep]; }
      if (posti[k]) store.set(k, pp);
    }
    for (const p of via) Object.assign(p, { arch: true, archTs: ora, archAuto: ora });
    store.set("patients.v1", list);
    const rec = { id: ora.toString(36) + Math.random().toString(36).slice(2, 6), ts: ora, eps: via.map((p) => p.ep), nomi: via.map((p) => nomeCorto(p.name || "")), posti };
    store.set(DIMESSI, rec);
    return rec.eps;
  }
  // «Annulla»: di nuovo fra i pazienti, al suo posto se è ancora libero
  function annullaDimessi(rec) {
    if (!rec || !Array.isArray(rec.eps)) return;
    const ora = Date.now(), list = store.get("patients.v1", []);
    if (Array.isArray(list)) {
      for (const p of list) if (p && rec.eps.includes(p.ep)) { p.arch = false; p.archTs = 0; delete p.archAuto; p.noDim = ora; }
      store.set("patients.v1", list);
    }
    for (const [k, v] of Object.entries(rec.posti || {})) {
      const pp = store.get(k, {}) || {};
      for (const [ep, x] of Object.entries(v)) {
        if (pp[ep] || (x?.tipo === "letto" && Object.values(pp).some((y) => y?.tipo === "letto" && y.id === x.id))) continue;
        pp[ep] = x;
      }
      store.set(k, pp);
    }
    if (store.get(DIMESSI, null)?.id === rec.id) store.del(DIMESSI);
  }
  // Le righe della smart (di tutte le sue schede nostre) sull'elenco. Chi si
  // riconosce — nome e impronta della nascita, uno solo — prende l'area e il
  // triage della riga; chi no entra lo stesso, con la sua chiave d'impronta.
  // Due righe uguali: nessuno dei due si tocca (non si indovina). Letta tutta
  // (intera), chi manca è dimesso — con le regole di dimettiUsciti.
  function applicaSmart(righe, intera) {
    const ora = Date.now(), list = store.get("patients.v1", []);
    const l = Array.isArray(list) ? list.filter((p) => p && p.ep && ora - vistoTs(p) < PATIENTS_TTL) : [];
    const a = areeLeggi(), presenti = new Set(), quante = new Map();
    const chiave = (r) => `${normNome(r.nome)}|${r.nato}`;
    for (const r of righe) if (r.nato) quante.set(chiave(r), (quante.get(chiave(r)) || 0) + 1);
    let nuovi = 0;
    for (const [n, r] of righe.entries()) {
      if (!r.nato || !r.nome) continue;
      const noti = l.filter((p) => normNome(p.name) === normNome(r.nome) && p.nato === r.nato);
      for (const p of noti) presenti.add(p.ep);
      if (quante.get(chiave(r)) > 1 || noti.filter((p) => !p.smart).length > 1) continue;
      const k = chiaveArea(r.area), tr = TRIAGE_COLORI.includes(r.triage) ? { triage: r.triage, triageTs: ora } : {};
      let p = noti.find((x) => !x.smart) || noti[0];
      if (!p) {
        p = { ep: chiaveSmart(r.nome, r.nato), name: spazi(r.nome).slice(0, 60), url: "", ts: 0, pk: "", nato: r.nato, smart: true };
        l.push(p);
        nuovi++;
      }
      Object.assign(p, { lista: ora, ...tr, ...(r.arrivo ? { arrivo: r.arrivo } : {}), ...(Number.isInteger(p.eta) || !Number.isInteger(r.eta) ? {} : { eta: r.eta }) });
      // tornato in un elenco dopo un'uscita decisa da qui: di nuovo fra i vivi
      if (p.arch && p.archAuto) { p.arch = false; p.archTs = 0; delete p.archAuto; }
      presenti.add(p.ep);
      if (k) { a.membri[p.ep] = { k, ts: ora, ...rigaDi(a.membri[p.ep], k, intera ? n : null) }; a.viste[k] = { label: spazi(r.area).slice(0, 60), ts: a.viste[k]?.ts || ora }; }
    }
    store.set(AREE, a);
    store.set("patients.v1", l.sort((x, y) => (y.ts || 0) - (x.ts || 0) || vistoTs(y) - vistoTs(x)).slice(0, PATIENTS_MAX));
    // chi manca da una lettura intera: solo chi si potrebbe riconoscere (con l'impronta)
    let dimessi = [];
    if (intera && righe.length) {
      const attivi = l.filter((p) => !p.arch && p.nato);
      dimessi = dimettiUsciti(attivi.filter((p) => !presenti.has(p.ep)).map((p) => p.ep), attivi.length);
    }
    return { righe: righe.length, nuovi, dimessi };
  }
  // Nella scheda dietro, aperta dal service worker: la smart si legge, una
  // scheda nostra dopo l'altra (col SUO link), poi si chiude.
  async function smartSottoQui() {
    const fine = (esito, extra = {}) => {
      const s = store.get(SMART_SYNC, {}) || {};
      store.set(SMART_SYNC, { ...s, fine: Date.now(), esito, ...extra, ...(esito === "ok" ? { letta: Date.now() } : {}) });
      tabStore.del(SMART_GIRO);
      return ask({ t: "smartFine", esito });
    };
    const L = leggiSmartPagina(document, location.href);
    if (!L.ok) return fine(classify(document) === "login" ? "login" : "pagina");
    const g0 = tabStore.get(SMART_GIRO, null);
    const giro = g0 && Date.now() - (g0.ts || 0) < 60e3 ? g0 : { ts: Date.now(), letti: {}, salti: 0 };
    if (L.sel && L.sel.nostra) {
      giro.letti[L.sel.base] = { n: L.sel.n, filtrata: L.filtrata,
        righe: L.righe.map((r) => ({ nome: r.name, nato: improntaNascita(r.nato), eta: r.eta, triage: r.triage, area: r.area, arrivo: r.arrivo || 0 })) };
    }
    // l'attesa del triage: letta in fondo, col suo link, e tenuta a parte (solo per il telefono)
    if (L.sel && L.sel.triage) {
      giro.triage = { n: L.sel.n, filtrata: L.filtrata,
        righe: L.righe.map((r) => ({ nome: r.name, breve: nomeCorto(r.name), eta: r.eta, triage: r.triage, area: AREE_TITOLO[chiaveArea(r.area)] || "", arrivo: r.arrivo || 0,
          // (chiave di nome e nascita: identifica la riga della lista smart sul telefono. NB «Accetta
          // in ambulatorio» combacia per episodio o chiaveTriage «tr…», non con questa chiaveSmart «sm…»)
          ...(r.nato ? { k: chiaveSmart(r.name, improntaNascita(r.nato)) } : {}) })) };   // (l'area solo se si riconosce, col nome corto)
    }
    const prossima = L.schede.find((s) => s.nostra && !giro.letti[s.base]) || (giro.triage ? null : L.schede.find((s) => s.triage));
    // Prima di ogni salto, i controlli della partenza (il service worker): un ordine partito o in
    // coda, un carrello aperto a mano intanto — e la smart si ferma qui, con quello che ha letto, mai
    // «intera»: nessuno dimesso da una lettura a metà. (Nessuna risposta: ci si ferma lo stesso.)
    let ferma = "";
    if (prossima && giro.salti < 4) {
      const r = await ask({ t: "smartAvanti" });
      if (r.ok) {
        giro.salti++;
        tabStore.set(SMART_GIRO, giro);
        location.href = prossima.url;   // il link della scheda, nella pagina
        return;
      }
      ferma = r.why || "estensione";
    }
    const lette = Object.values(giro.letti);
    if (!lette.length) return fine(ferma || "schede");
    const t = giro.triage;
    // (una scheda senza il conto «(N)» si prende com'è; col conto, le righe devono tornare)
    if (t && !t.filtrata && (t.n == null || t.n === t.righe.length)) store.set(TRIAGE_LISTA, { ts: Date.now(), righe: t.righe });
    const righe = lette.flatMap((x) => x.righe);
    const intera = !ferma && lette.every((x) => !x.filtrata && x.n != null && x.n === x.righe.length);
    const r = applicaSmart(righe, intera);
    return fine(ferma || "ok", { n: r.righe, intera, dimessi: r.dimessi.length });
  }
  // Rileggere la smart adesso (⟳) o perché il medico ha aperto l'app
  // sull'iPhone: lo chiede il service worker, che apre la scheda dietro e ne
  // tiene una sola.
  async function smartSync(forza) {
    if (TABELLONE) return tabelloneChiede({ cosa: "sync" });   // la rilegge una scheda del gestionale, dal suo link
    if (!hasExt()) return { ok: false, why: "senza estensione" };
    const u = store.get(SMART_URL, null)?.url;
    if (!u) return { ok: false, why: "nessun link" };
    const s = store.get(SMART_SYNC, null) || {}, ora = Date.now();
    if (!forza && ora - (s.ts || 0) < SMART_TEL) return { ok: false, why: "non ancora" };
    if (s.ts && !s.fine && ora - s.ts < 45e3) return { ok: false, why: "in corso" };
    // (una pagina della stessa sessione: mai mentre un motore manda esami — il prossimo giro, fra 30 secondi)
    if (motoreOvunque()) return { ok: false, why: "ordine in corso" };
    store.set(SMART_SYNC, { ts: ora, fine: 0, esito: "", n: s.n || 0, ...(s.letta ? { letta: s.letta } : {}) });
    const r = await ask({ t: "smartSotto", url: u });
    if (!r || !r.ok) store.set(SMART_SYNC, { ...(store.get(SMART_SYNC, {}) || {}), fine: Date.now(), esito: (r && r.why) || "estensione" });
    return r || { ok: false };
  }
  // Il ⟳ del tabellone, oltre alla smart: chi il medico ha aperto in questo
  // turno si rilegge dietro, un paziente alla volta, come aprendolo — la sua
  // pagina (Lab · ECG · RX, il «nuovo»), i valori se il laboratorio è cambiato —
  // dal suo indirizzo, quello che il gestionale ha dato. Lo fa il service worker
  // (ponte-sw.js), mai mentre un motore manda esami. Chi non è stato aperto in
  // questo turno resta com'è la lista: nessuna pagina aperta senza il medico.
  function rileggiAperti(m) {
    if (!hasExt() || TABELLONE) return 0;
    const ora = Date.now();
    const l = knownPatients().filter((p) => apertoNelTurno(p, ora) && !m.info.get(p.ep)?.prec && ponteUrlPaziente(p))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 40).map((p) => ({ ep: p.ep, url: ponteUrlPaziente(p) }));
    if (l.length) ask({ t: "ponteTabellone", pazienti: l }).catch(() => {});
    return l.length;
  }

  // la chiave della scheda clinica, annotata quando la conosciamo, così
  // archiviare o eliminare un paziente sa cosa toccare
  function segnaChiave(ep, pk) {
    if (!ep || !pk) return;
    const list = tuttiPazienti();
    const p = list.find((x) => x.ep === ep);
    if (!p || p.pk === pk) return;
    p.pk = pk;
    store.set("patients.v1", list);
  }
  function archiviaPaziente(ep, si = true) {
    const list = tuttiPazienti();
    const p = list.find((x) => x.ep === ep);
    if (!p) return false;
    p.arch = !!si;
    p.archTs = si ? Date.now() : 0;
    return store.set("patients.v1", list);
  }
  function forgetPatients() { store.set("patients.v1", []); }
  // end of shift / another user: drop names and every per-episode leftover
  function forgetAll() {
    forgetPatients();
    forgetQuesiti();
    try {
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith(NS) && /(^|\.)(ris|visto|reftxt|log|refopen|receipt|confirm|queue|print|ui|afterNav|dimdraft|eodraft|storico|corsa)\b/.test(k.slice(NS.length))) sessionStorage.removeItem(k);
      }
    } catch { /* blocked storage: nothing to clear */ }
    store.set(APERTA, null);    // porta un nome: se ne va col turno
    store.del(STAMPE_FRESCHE);  // i fogli letti dopo un ordine (nomi di esami): col turno
    dimenticaAnagrafiche();     // le allergie lette: testo clinico, se ne vanno col turno
    store.set(PRESIDIO, null);
    // I posti nella stanza NO: sono solo numeri di episodio, e chi viene
    // riaperto dopo una sessione scaduta deve ritrovare il suo letto.
    try { if (typeof chrome !== "undefined" && chrome.runtime?.id) chrome.runtime.sendMessage({ t: "clearRef" }, () => void chrome.runtime.lastError); } catch { /* not the extension build */ }
  }
  // «Dimentica i dati…» (⋯, l'unico comando che cancella; due tocchi, Annulla
  // per 8 secondi): via tutto quello che si sa dei pazienti e del
  // turno, qui e nella memoria di questa scheda. Restano le impostazioni
  // (finestra, stanze, le opzioni delle aree, catalogo, stampe già fatte) e i
  // modelli del medico; chi sta in quale area se ne va.
  const DIMENTICA_TITOLO = "Dimentica quello che il pannello tiene dei pazienti — elenco, posti, valori, referti salvati, Da fare, note, registrazioni — in questo browser e nell'estensione. Restano le impostazioni, i tuoi fogli e l'associazione con l'iPhone. Due tocchi; per 8 secondi si annulla. (Da soli i dati scadono comunque in 12–24 ore.)";
  const RESET_VIA = () => ["patients.v1", ...TUTTI_I_POSTI(), "stanza.posti.v1", AREE, AREA_VAI, SMART_SYNC, DIMESSI, STATO, PROM, PROM_VECCHI, DF_GEN, noteKey, segniKey, "refVisti.v1",
    "refPortale", DA_CONFERMARE, CONFERME, "quesiti", "quesiti.ts", "lastQ", APERTA, PRESIDIO, AUTO_CARICA, FALLITI, TRIAGE_LISTA];
  function azzeraScheda() {
    try { for (const k of Object.keys(sessionStorage)) if (k.startsWith(NS)) sessionStorage.removeItem(k); } catch { /* niente */ }
  }
  function azzeraPazienti() {
    for (const k of RESET_VIA()) store.del(k);
    store.del(STAMPE_FRESCHE);   // (i fogli letti dopo un ordine)
    potaImparati();   // (via i quesiti, via i pacchetti che avevano imparato; quelli dell'elenco di partenza restano)
    azzeraScheda();
  }
  // le altre schede puliscono la loro (vedi «storage» all'avvio)
  function resetAlleAltreSchede() {
    try { localStorage.setItem(NS + "reset.v1", String(Date.now())); localStorage.removeItem(NS + "reset.v1"); } catch { /* niente */ }
  }
  // «Annulla» del reset: la fotografia di quello che azzeraPazienti toglie
  // (la memoria del browser, quella di questa scheda), da rimettere com'era.
  function fotoReset() {
    let scheda = [];
    try { scheda = Object.keys(sessionStorage).filter((k) => k.startsWith(NS)).map((k) => [k, sessionStorage.getItem(k)]); } catch { /* niente */ }
    return { locale: RESET_VIA().map((k) => [k, store.get(k, null)]), scheda };
  }
  function rimettiReset(f) {
    for (const [k, v] of f.locale) { if (v === null) store.del(k); else store.set(k, v); }
    try { for (const [k, v] of f.scheda) sessionStorage.setItem(k, v); } catch { /* niente */ }
  }

  // The doctor's edits live in localStorage under their own key. They are
  // templates, not patient data, so forgetAll leaves them alone — and nothing
  // patient-specific ever gets written here.
  // ------------------------------------------------------------- CONSENSI
  // I moduli di consenso stanno DENTRO l'estensione (cartella consensi/):
  // niente rete, niente server, funzionano anche se il gestionale è giù.
  // Un tocco apre il PDF e la finestra di stampa, come per la lista esami.
  // `pagine` è quanta carta esce: nove pagine non si scoprono dalla stampante.
  // `gruppo` separa i consensi da firmare dalle deleghe per il ritiro.
  const CONSENSI = [
    { k: "emocolture", nome: "Emocolture", file: "emocolture.pdf", pagine: 1,
      esteso: "Esame colturale su campioni biologici diversi" },
    { k: "hiv-dipendente", nome: "HIV Dipendente", file: "hiv-dipendente.pdf", pagine: 1,
      esteso: "Consenso del dipendente all'esecuzione del test HIV (MDL 170)" },
    { k: "lesioni-animali", nome: "Lesioni Animali", file: "lesioni-animali.pdf", pagine: 1,
      esteso: "Rapporto di lesione provocata da animali" },
    { k: "antitetano", nome: "Antitetano", file: "antitetano.pdf", pagine: 1,
      esteso: "Immuno-profilassi antitetanica" },
    { k: "tac-cmdc", nome: "TAC cmdc", file: "tac-cmdc.pdf", pagine: 1,
      esteso: "Consenso alla TAC con mezzo di contrasto" },
    { k: "emotrasfusione", nome: "Emotrasfusione", file: "emotrasfusione.pdf", pagine: 9,
      esteso: "Pacchetto trasfusionale: consenso informato, richiesta emocomponenti, dichiarazione del medico in urgenza" },
    { k: "ritiro-esami", nome: "Ritiro esami", file: "ritiro-esami.pdf", pagine: 1, gruppo: "ritiro",
      esteso: "Delega per il ritiro del referto degli esami ematochimici di Pronto Soccorso" },
    { k: "ritiro-referto-rx", nome: "Ritiro referto RX", file: "ritiro-referto-rx.pdf", pagine: 1, gruppo: "ritiro",
      esteso: "Delega per il ritiro del referto radiologico" },
    { k: "ritiro-cartella-cd", nome: "Ritiro cartella e CD", file: "ritiro-cartella-cd.pdf", pagine: 5, gruppo: "ritiro",
      esteso: "Richiesta e delega per copia della documentazione sanitaria: verbale di PS, referti, CD radiologico" },
  ];
  const urlConsenso = (c) => (hasExt() ? chrome.runtime.getURL("consensi/" + c.file) : "");

