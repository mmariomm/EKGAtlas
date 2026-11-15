//@frammento 30-motore.js — ENGINE: il motore delle richieste (orderItems, runPlan/runPlanVero; regole in README), ricettaRiprova, testoResto.
  // ================================================================ ENGINE
  // A run is a linear list of steps executed by runPlan(). Each step updates
  // its own status so the UI can render live progress.
  //
  // plan = {
  //   startPage: 'patient' | 'crea' | 'exam' | 'ripresa',
  //   entryUrl:  (patient only) crea-page URL to open,
  //   creaForm:  (crea only) the LIVE form element to serialize,
  //   examDoc/examUrl: (exam only) the live page — used ONLY to find the
  //              list URL, which is then re-read from the server,
  //   quesito:   text written if the server field is empty — or over the
  //              triage's, when quesitoMio (typed by the doctor in #q),
  //   quesitoMio: the doctor typed the quesito himself (not a chip/package),
  //   items:     [{res, code, label}],
  //   autoConfirm: boolean,
  //   episodeId: pinned patient episode,
  //   listUrl:   (ripresa only) the exam list to re-read — nothing is created,
  //   items:     (ripresa) what is still to send; the one that was IN FLIGHT
  //              when the page changed comes first, marked soloVerifica: it is
  //              looked up in the cart and NEVER sent again.
  // }

  // Una richiesta per erogatore di laboratorio. Il gestionale non ne vuole
  // due nella stessa: il primo esame del secondo risponde «ORA-20965 …
  // Progressivo richiesta già utilizzato» (le due tracce d'errore vere, POC +
  // laboratorio), e il medico, a mano, ne fa sempre una per erogatore. Gli
  // esami si raggruppano per l'erogatore che li fa IN QUESTA SEDE (la stessa
  // scelta del motore, per nome: dove Urgenze non c'è, il laboratorio unico),
  // nell'ordine delle RISORSE della richiesta (POC per primo, com'è dopo «Crea»).
  function perErogatore(items, entryUrl) {
    const risorse = String(param(entryUrl || "", "RISORSE") || "").split(",").filter(Boolean);
    const cat = fullCatalog();
    const opzioni = risorse.map((v) => ({ value: v, label: (cat[v] && cat[v].label) || v }));
    const gruppi = new Map();
    for (const i of items) {
      const d = opzioni.length ? risorsaQui(i, opzioni, cat) : null;
      const r = (d && d.res) || i.res;
      if (!gruppi.has(r)) gruppi.set(r, []);
      gruppi.get(r).push(i);
    }
    const pos = (r) => { const k = risorse.indexOf(r); return k < 0 ? risorse.length : k; };
    return [...gruppi.entries()].sort((a, b) => pos(a[0]) - pos(b[0])).map(([res, l]) => ({ res, items: l }));
  }
  // le gambe di laboratorio di un ordine: una per erogatore, col suo nome
  // quando sono più d'una («laboratorio POC», «laboratorio Urgenze»)
  const NOME_EROGATORE = { [RES.POC]: "POC", [RES.URGENZE]: "Urgenze", [RES.CENTRAL]: "centrale" };
  function gambeLab(items, entryUrl, leg) {
    const g = perErogatore(items, entryUrl);
    return g.map(({ res, items: l }) => ({ ...leg, kind: "lab", items: l,
      label: g.length > 1 ? `laboratorio ${NOME_EROGATORE[res] || risorsaCorta(res)}` : "laboratorio" }));
  }

  function orderItems(items, currentRes) {
    const rank = (r) => (r === currentRes ? "0" : "1" + r);
    return [...items].sort((a, b) => rank(a.res).localeCompare(rank(b.res)) || a.code.localeCompare(b.code));
  }

  function applyExclusions(items, log) {
    let out = [...items];
    for (const rule of EXCLUDE) {
      const has = out.some((i) => i.res === rule.keep[0] && i.code === rule.keep[1]);
      if (!has) continue;
      const before = out.length;
      out = out.filter((i) => !(i.res === rule.drop[0] && i.code === rule.drop[1]));
      if (out.length !== before) log(`↺ ${rule.note}`);
    }
    const seen = new Set();
    return out.filter((i) => { const k = i.res + ":" + i.code; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async function runPlan(plan, ui) {
    const mio = Math.random().toString(36).slice(2), prima = MOTORE_MIO;
    // il turno, prima di tutto (e intanto un secondo «Conferma» non parte)
    ui._motoreAtteso = true;
    let preso;
    try { preso = prima ? true : await prendiMotore(mio, ui); } finally { ui._motoreAtteso = false; }
    if (!preso) {
      ui.message = "Un altro ordine sta ancora mandando esami: niente inviato da qui. Riprova fra poco.";
      ui.render();
      return null;
    }
    MOTORE_MIO = mio;
    battitoMotore();
    try { return await runPlanVero(plan, ui); }
    finally {
      if (MOTORE_MIO === mio) MOTORE_MIO = prima;
      // (la conferma automatica che parte dalla pagina dopo è ancora questo
      // motore: il turno resta alla scheda, e la conferma lo riprende)
      if (!MOTORE_MIO && (LAVORO || !tabStore.get("confirm.v1", null))) mollaMotore(mio);
      battitoMotore();
    }
  }
  async function runPlanVero(plan, ui) {
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    // Un giro solo si riprende dopo un cambio pagina; una catena
    // lab+radiologia no: le sue due gambe vivono nella memoria del pannello,
    // e a metà non si riprendono. Lì si avvisa prima di uscire, come sempre.
    // Nemmeno «Svuota» dalla riga di una richiesta da confermare: non ha niente
    // da annotare, quindi niente da riprendere — si avvisa prima di uscire.
    plan.riprendibile = !plan.hold && !plan.soloSvuota;
    // (le richieste che la pagina del paziente stampa già: la foto prima del giro)
    if (!plan.prima && plan.startPage === "patient" && classify(document) === "patient" && String(findEpisodeId(document, location.href) || "") === String(plan.episodeId || "")) {
      plan.prima = fotoRichieste(document, location.href);
    }
    const token = Math.random().toString(36).slice(2);   // questo motore, per il presidio
    // La pagina che se ne va porta via il motore: il presidio si molla subito,
    // o la pagina dopo crederebbe che ci sia ancora qualcuno a lavorare.
    const mollaPresidio = () => liberaPresidio(token);
    window.addEventListener("pagehide", mollaPresidio);
    const state = {
      steps: [], added: [], stop: () => ctrl.abort(),
      finishedListUrl: null, lastListUrl: null, richiestaId: null,
    };
    // quale quesito è partito (una ripresa lo porta con sé dall'appunto)
    if (plan.qinfo) state.quesito = plan.qinfo;
    // la traccia di questo giro (vedi TRACCIA): attiva finché il motore lavora
    // (la richiesta rifatta da capo dopo un «ORA-»: la traccia continua, coi passi di quella persa)
    const T0 = plan.ricreata && TRACCIA ? TRACCIA : null;
    TRACCIA = { t0: T0 ? T0.t0 : Date.now(), attiva: true, passi: T0 ? T0.passi : [], ordine: (LAVORO && LAVORO.id) || "", riprova: !!plan.riprova,
      esami: (plan.items || []).map((i) => ({ codice: String(i.code), risorsa: String(i.res) })),
      scheda: LAVORO ? "ordine in sottofondo" : "scheda del medico", visibile: !document.hidden, ...(plan.ricreata ? { ricreata: true } : {}) };
    const nascosta = () => { if (document.hidden && TRACCIA) TRACCIA.nascosta = true; };
    document.addEventListener("visibilitychange", nascosta);
    ui.beginRun(state, plan);
    const ereditati = state.steps.length;   // i passi di una richiesta prima di questa (una catena), già sullo schermo
    const log = (msg) => ui.log(`${now()}  ${msg}`);
    // Any fetched page that is a login page means the session died mid-flow.
    const guardSession = (doc, whatMayHaveHappened) => {
      if (classify(doc) === "login") {
        const e = restaQui(new StopError("Sessione scaduta durante l'operazione",
          `${whatMayHaveHappened ? whatMayHaveHappened + ". " : ""}Rifai l'accesso e controlla il carrello.`));
        e.sessione = true;
        throw e;
      }
    };
    const step = (label) => {
      const s = { label, status: "pending", note: "" };
      state.steps.push(s);
      return s;
    };
    const running = (s, note) => { s.status = "running"; if (note) s.note = note; ui.renderRun(state); };
    const done = (s, note) => { s.status = "ok"; if (note) s.note = note; ui.renderRun(state); };
    const pace = () => sleep(PACE_MS, signal);

    plan.items = applyExclusions(plan.items, log);
    // gli esami come arrivano, prima che il giro li tocchi: una richiesta rifatta da capo riparte da questi
    const partenza = plan.items.map((i) => ({ ...i }));
    // La selezione del medico com'era, prima che il motore traduca codici e
    // risorse per la sede (o che un esame a riflesso entri con un altro
    // numero): è quella che «Svuota il carrello e ricomincia» rimette.
    // Viaggia con il giro: «Riprova» e la ripresa dopo un cambio pagina la portano.
    const nudoSel = (i) => ({ res: i.res, code: i.code, label: i.label, display: i.display || i.label,
      ...(i.resCat ? { resCat: i.resCat } : {}), ...(i.chiave ? { chiave: i.chiave } : {}) });
    if (!Array.isArray(plan.originali) || !plan.originali.length) {
      // (un giro ripreso o rifatto senza la selezione di partenza non la sa: niente «Svuota»)
      const parziale = plan.startPage === "ripresa" || plan.items.some((i) => i.soloVerifica) || (plan.daControllare || []).length > 0;
      plan.originali = parziale ? null : plan.items.map(nudoSel);
    }

    // Pre-build the visible step list.
    const legTag = plan.legLabel ? ` (${plan.legLabel})` : "";
    const riprende = plan.startPage === "ripresa";
    // dal carrello di una richiesta già nata (dopo «Svuota il carrello»): niente da creare
    const daCarrello = plan.startPage === "carrello";
    // il ritentativo da solo dopo un elenco venuto male: lo dice la striscia
    const daSolo = daCarrello && !!plan.ritentato;
    const nMai = plan.items.filter((i) => !i.soloVerifica).length;
    const sOpen = plan.startPage === "patient" ? step("Apro la nuova richiesta" + legTag) : null;
    const sRipresa = riprende ? step("Riprendo la richiesta da dov'ero")
      : daCarrello ? step(daSolo ? `Riprovo ${nMai === 1 ? "1 esame" : `${nMai} esami`}…` : "Apro il carrello della richiesta") : null;
    const sCrea = plan.startPage !== "exam" && !riprende && !daCarrello ? step("Compilo quesito e creo la richiesta" + legTag) : null;
    const sSvuota = plan.svuota ? step("Svuoto il carrello") : null;
    const sVuoto = plan.svuota ? step("Controllo che sia vuoto") : null;
    const itemSteps = new Map();
    // i passi-esame si contano a parte: la striscia dice «esame 2 di 6», non i passi
    for (const it of plan.items) { const s = step(it.display || it.label); s.esame = true; itemSteps.set(it, s); }
    const sEnd = plan.soloSvuota ? null : step(riprende && !plan.autoConfirm ? "Chiudo: il carrello è pronto"
      : plan.autoConfirm ? "Passo alla pagina esami per la conferma" : "Passo alla pagina esami per la revisione");
    ui.renderRun(state);

    // Svuotare il carrello di UNA richiesta, quella del giro, e dimostrarlo.
    // Col link «Svuota carrello» del gestionale — un'azione sola, niente che
    // resta indietro — preso dalla pagina esami della richiesta e seguito solo
    // se porta la sua RICHIESTA_ID e il suo EPISODIO_ID (e, quando c'è, la
    // RISORSA_ID della sezione: nelle pagine vere svuota una sezione alla
    // volta, quindi si segue per ogni sezione che ha righe). Una sezione senza
    // «Svuota» si toglie riga per riga coi suoi «Elimina» (PRESTAZIONE sempre
    // presente). Mai una richiesta confermata: prima si legge la pagina del
    // paziente, e se la elenca fra quelle coi fogli da stampare non si tocca
    // niente. Prima di togliere qualunque cosa si legge il carrello vero: quello
    // che c'è e non è della selezione si rimette anche lui, e una riga che non
    // si saprebbe rimettere ferma tutto lì. Poi OGNI sezione si rilegge dal
    // server: se c'è ancora una riga, stop — si dice cosa resta e non si
    // rimette niente.
    const svuotaCarrello = async (model0) => {
      const rid = String(plan.richiestaId || ""), ep = String(plan.episodeId || "");
      if (!rid || String(model0.richiestaId) !== rid) throw new StopError("Non so quale carrello svuotare", "Niente toccato.");
      state.svuotando = true;
      running(sSvuota, "controllo che non sia confermata…");
      const pu = [plan.patientUrl, (tuttiPazienti().find((p) => p.ep === ep) || {}).url].find(leggibilePagina);
      if (!pu) throw new StopError("Non riesco a controllare che la richiesta non sia confermata", "Non svuoto niente.");
      const pz = await fetchDoc(pu, { signal });
      guardSession(pz.doc, "Niente svuotato");
      assertSameEpisode(pz.doc, ep, "pagina del paziente");
      if (classify(pz.doc) !== "patient") throw new StopError("Non ritrovo la pagina del paziente", "Non svuoto niente.");
      if (printModel(pz.doc, pz.url)[rid]) throw new StopError("Questa richiesta risulta già confermata", "Una richiesta confermata non si svuota: non tocco niente.");
      if (!model0.confirmButton) throw new StopError("Il carrello non ha più la Conferma", "Forse è già confermata: non svuoto niente.");
      const leggi = (res, cosa) => leggiSezione(model0, res, { rid, ep, signal, cosa });
      // il carrello vero, tutte le sezioni: che cosa si toglie, e che cosa si rimette
      running(sSvuota, "leggo il carrello…");
      const { sezioni, righe } = await leggiCarrello(model0, { rid, ep, signal, cosa: "Niente svuotato" });
      state.inCarrello = righe.map(nomeRiga);
      // (con niente da rimettere, niente che non si saprebbe rimettere)
      const piano = plan.soloSvuota ? { extra: [], ignoti: [] } : daRimettere(righe, plan.items, plan.nostri || []);
      if (piano.ignoti.length) {
        throw new StopError(`Non saprei rimettere ${piano.ignoti.map((x) => `«${x}»`).join(", ")}`,
          "È nel carrello ma non so ordinarlo da qui: non svuoto niente.");
      }
      for (const it of piano.extra) {
        log(`nel carrello c'è anche «${it.display}», fuori dalla selezione: lo rimetto con gli altri`);
        plan.items.push(it);
        const s = { label: it.display, status: "pending", note: "", esame: true };
        state.steps.splice(state.steps.indexOf(sEnd), 0, s);
        itemSteps.set(it, s);
      }
      if (piano.extra.length) plan.originali = [...(plan.originali || []), ...piano.extra.map(nudoSel)];
      // il link «Svuota» di questa sezione, e solo se è suo
      const linkSvuota = (d, base, res) => {
        for (const a of d.querySelectorAll('a[href*="Delete=Elimina"]')) {
          let u; try { u = new URL(a.getAttribute("href"), base); } catch { continue; }
          const p = u.searchParams;
          if (u.origin !== location.origin || p.get("Delete") !== "Elimina" || p.get("MVPG") !== "RcsRichiestaCarrelloSvuota") continue;
          if (p.has("PRESTAZIONE") || p.has("RICHIESTA_PRESTAZIONE_PROG") || p.has("Insert")) continue;
          if (p.get("RICHIESTA_ID") !== rid || p.get("EPISODIO_ID") !== ep) continue;
          if (p.has("RISORSA_ID") && p.get("RISORSA_ID") !== res) continue;
          return u.href;
        }
        return null;
      };
      // l'«Elimina» di una riga: il suo esame, la sua richiesta, la sua sezione
      const eliminaDi = (e, res) => {
        let u; try { u = new URL(e.href); } catch { return null; }
        const p = u.searchParams;
        if (u.origin !== location.origin || !e.isDel || p.get("Delete") !== "Elimina" || p.has("Insert")) return null;
        if (p.get("PRESTAZIONE") !== String(e.code) || p.get("RICHIESTA_ID") !== rid || p.get("RISORSA_ID") !== res) return null;
        if (p.has("EPISODIO_ID") && p.get("EPISODIO_ID") !== ep) return null;
        return u.href;
      };
      const presidio = () => {
        if (!presidioLibero(rid, token)) {
          throw restaQui(new StopError("Un'altra scheda sta lavorando su questa richiesta", "Da qui non svuoto niente."));
        }
        segnaPresidio(rid, token);
      };
      // Da qui non si sa più che cosa c'è nel carrello finché non si rimette:
      // se la scheda muore adesso, la prima pagina utile dice di controllare.
      store.set(APERTA, { ts: Date.now(), ep, paziente: plan.patientName || "", rid, quanti: 0, forse: plan.items.length });
      let tolti = 0;
      for (const { res, m: m0, doc: d, url: u, righe: suo } of sezioni) {
        let m = m0;
        const prima = suo.map(nomeRiga);
        if (!prima.length) continue;
        presidio();
        state.tolgo = true;
        const sv = linkSvuota(d, u, res);
        if (sv) {
          running(sSvuota, `svuoto ${risorsaCorta(res)} (${prima.length})…`);
          log(`svuoto ${risorsaCorta(res)} col «Svuota carrello» del gestionale: ${prima.join(", ")}`);
          const r = await fetchDoc(sv, { signal });
          guardSession(r.doc, "Il carrello potrebbe essere svuotato o no");
          assertSameEpisode(r.doc, ep, "svuota carrello");
          tolti += prima.length;
          await pace();
          continue;
        }
        // niente «Svuota» in questa sezione: una riga alla volta, rileggendo
        // il carrello dopo ognuna (ogni link porta il suo stato)
        log(`${risorsaCorta(res)}: nessun «Svuota carrello» in pagina — tolgo le righe una per una`);
        for (let giro = 0; giro < prima.length + 2; giro++) {
          const e = m.exams.find((x) => x.isDel && eliminaDi(x, res));
          if (!e) break;
          presidio();
          running(sSvuota, `tolgo ${shortLabel(e.label)}…`);
          log(`tolgo «${shortLabel(e.label)}» col suo «Elimina»`);
          const r = await fetchDoc(eliminaDi(e, res), { signal });
          guardSession(r.doc, `«${shortLabel(e.label)}» potrebbe essere tolto o no`);
          assertSameEpisode(r.doc, ep, "elimina esame");
          tolti++;
          await pace();
          ({ m } = await leggi(res, "Il carrello potrebbe essere svuotato in parte"));
        }
      }
      done(sSvuota, tolti ? `${tolti} ${tolti === 1 ? "tolto" : "tolti"}` : "era già vuoto");
      // la prova: ogni sezione riletta dal server, e vuota
      running(sVuoto);
      const restano = [];
      let primo = null;
      for (const { res } of sezioni) {
        const l = await leggi(res, "Il carrello potrebbe essere svuotato in parte");
        for (const n of righeCarrello(l.doc, l.m)) restano.push(sezioni.length > 1 ? `${n} (${risorsaCorta(res)})` : n);
        if (res === model0.res) primo = l;
        await pace();
      }
      if (restano.length) {
        state.rimasti = restano;
        throw new StopError("Il carrello non si è svuotato", `Restano: ${restano.join(", ")}. Non rimetto niente: finiscilo a mano.`);
      }
      if (!primo) throw new StopError("Non ritrovo la sezione del carrello da cui ripartire", "Il carrello è vuoto: rimetti gli esami a mano.");
      done(sVuoto, "vuoto ✓");
      log(`carrello vuoto su ${sezioni.length === 1 ? "1 sezione" : `tutte le ${sezioni.length} sezioni`}, riletto dal server: ${
        plan.soloSvuota ? "niente da rimettere" : `rimetto ${plan.items.length} esami`}`);
      // un carrello vuoto non ha niente da confermare: il promemoria torna
      // quando rientra il primo esame
      confermataProvata(rid);
      state.svuotando = false;
      state.svuotato = true;
      return { model: primo.m, doc: primo.doc, url: primo.url };
    };

    try {
      // ---- 1. reach the exam page --------------------------------------
      let doc, url;
      if (plan.startPage === "patient") {
        running(sOpen);
        ({ doc, url } = await fetchDoc(plan.entryUrl, { signal }));
        guardSession(doc, "Nessuna richiesta creata");
        assertSameEpisode(doc, plan.episodeId, "nuova richiesta");
        if (classify(doc) !== "crea") throw new StopError("Pagina Nuova Richiesta inattesa", "Il server non ha aperto la pagina prevista. Nessuna richiesta creata.");
        done(sOpen);
      }

      if (riprende || daCarrello) {
        // Non si crea niente e non si manda niente: si rilegge l'elenco della
        // richiesta che era già aperta, e da lì si continua.
        running(sRipresa);
        if (daSolo) await sleep(VERIFY_WAITS[0], signal);   // un attimo all'elenco, come prima di una verifica
        ({ doc, url } = await fetchDoc(plan.listUrl, { signal }));
        guardSession(doc, "Nessun esame inviato");
        assertSameEpisode(doc, plan.episodeId, "elenco esami");
        if (classify(doc) !== "exam") {
          log(`elenco esami inatteso alla ripresa: "${snippet(doc)}"`);
          throw new StopError("Non ritrovo l'elenco esami della richiesta", "Il giro si ferma qui: apri il carrello e controlla.");
        }
        done(sRipresa);
      } else if (plan.startPage !== "exam") {
        running(sCrea);
        if (plan.startPage === "patient") await pace();
        let form, base;
        if (plan.startPage === "crea") { form = plan.creaForm; base = plan.creaUrl; }
        else { form = doc.querySelector('form[name="RICHIESTACrea"]'); base = url; }
        if (!form) throw new StopError("form RICHIESTACrea non trovato");

        // Il quesito del triage resta, di norma. Ma se il medico ha scritto
        // il suo nel pannello — a mano, non un chip né un pacchetto — vale il
        // suo: l'ha deciso lui, e ignorarlo in silenzio era il difetto.
        const quesitoEl = form.elements.namedItem("QUESITO_DIAGNOSTICO");
        if (quesitoEl) {
          const existing = (quesitoEl.value || "").trim();
          const q = (plan.quesito || "").trim();
          const mio = !!plan.quesitoMio && !!q && q !== existing;
          if (!existing || mio) {
            if (!q) throw new StopError("Quesito diagnostico mancante", "Scrivilo nel pannello e riprova. Nessuna richiesta creata.");
            quesitoEl.value = q;
            scrittura.nostri.add(quesitoEl);   // scritto da noi: non è il medico che sta scrivendo
            state.quesito = existing ? { fonte: "tuo", sopra: true } : { fonte: "tuo" };
            // (nessun testo fra virgolette: il Registro si copia, e il quesito non deve uscire)
            if (existing) log("quesito del triage sostituito col tuo, scritto nel pannello");
          } else {
            state.quesitoKept = existing;
            state.quesito = { fonte: "triage", testo: existing.slice(0, 80) };
            log(`quesito del triage mantenuto: "${existing.slice(0, 60)}"`);
          }
        }
        const submit = form.querySelector('input[type="submit"][name="Update"]');
        if (!submit) throw new StopError('bottone "Crea" non trovato');
        const body = encodeFormBody(serializeForm(form, submit));
        const action = absUrl(form, "action", base);
        ({ doc, url } = await fetchDoc(action, { method: "POST", body, signal }));
        guardSession(doc, "La richiesta potrebbe non essere stata creata");
        assertSameEpisode(doc, plan.episodeId, "esami della richiesta");
        if (classify(doc) !== "exam") {
          log(`pagina inattesa dopo Crea: "${snippet(doc)}"`);
          throw new StopError("Il server non ha aperto la pagina esami dopo la creazione", "Controlla a mano (vedi Registro).");
        }
        done(sCrea);
        await pace();
      } else {
        // La pagina esami che il medico ha davanti NON è una fonte attendibile:
        // gli inserimenti viaggiano in background, quindi dopo una corsa
        // interrotta il carrello sullo schermo è quello di prima. Fidarsene
        // vorrebbe dire leggere «non c'è» un esame che c'è già — e ordinarlo
        // una seconda volta. Del DOM vivo si prende solo l'INDIRIZZO
        // dell'elenco, e lo si rilegge dal server come fa tutto il resto del
        // motore: una richiesta in più, e in cambio i due controlli che questa
        // strada saltava — sessione scaduta ed episodio.
        const vivo = examModel(plan.examDoc, plan.examUrl);
        ({ doc, url } = await fetchDoc(vivo.listUrl(vivo.res) || plan.examUrl, { signal }));
        guardSession(doc, "Nessun esame inviato");
        assertSameEpisode(doc, plan.episodeId, "esami della richiesta");
        if (classify(doc) !== "exam") {
          log(`pagina esami inattesa alla partenza: "${snippet(doc)}"`);
          throw new StopError("Questa non è più la pagina degli esami", "Ricaricala e riprova. Nessun esame inviato.");
        }
      }

      // ---- 2. add each exam, verifying every add ------------------------
      let model = examModel(doc, url);
      learnFrom(model);
      // «↻ Riprova» lavora sul carrello della richiesta di prima e su nessun
      // altro: un elenco di un'altra richiesta non si tocca.
      if (plan.richiestaId && String(model.richiestaId) !== String(plan.richiestaId)) {
        throw new StopError("Non è il carrello della richiesta di prima", "Nessun esame inviato.");
      }
      // (la richiesta rifatta da capo è un'altra, sempre: in quella lasciata non si rimanda niente)
      if (plan.persa && String(model.richiestaId) === String(plan.persa)) {
        throw new StopError("Il gestionale ha riaperto la richiesta di prima", "Lì dentro non rimando niente: apri il carrello e controlla.");
      }
      state.richiestaId = model.richiestaId;
      segnaNostra(model.richiestaId);   // da qui la sua Conferma nativa arma la stampa
      const noteList = () => { const u = model.listUrl(model.res); if (u) state.lastListUrl = u; };
      noteList();
      // Una pagina riletta per verificare vale solo se è l'elenco di QUESTA
      // richiesta, su quella risorsa: un altro elenco non dice niente del
      // nostro carrello, e da lui non si prende nemmeno l'indirizzo della
      // rilettura dopo. Si conta il tentativo e si rilegge il nostro.
      const nostroElenco = (m, res) => {
        if (String(m.richiestaId) === String(state.richiestaId) && m.res === res) return true;
        log(`è tornato l'elenco di un'altra richiesta o risorsa (${m.richiestaId || "?"}, ${risorsaCorta(m.res) || "?"}): non lo uso, rileggo il nostro`);
        return false;
      };
      if (!state.lastListUrl) throw new StopError("Impossibile ricostruire l'indirizzo dell'elenco esami", "Nessun esame inviato.");
      // «Svuota il carrello e ricomincia»: prima il carrello di QUESTA
      // richiesta si vuota e si dimostra vuoto, poi si rimette tutta la
      // selezione, come il primo giro.
      if (plan.svuota) ({ model, doc, url } = await svuotaCarrello(model));
      if (plan.soloSvuota) {
        // «Svuota» dalla riga di una richiesta da confermare: niente da
        // rimettere. Vuoto e provato, la richiesta è già dimenticata.
        tabStore.set(CORSA, null);
        store.set(APERTA, null);
        liberaPresidio(token);
        window.removeEventListener("pagehide", mollaPresidio);
        state.finishedListUrl = model.listUrl(model.res);
        ui.svuotato(state, plan);
        return state;
      }
      const offered = new Set(model.resOptions.map((o) => o.value));
      if (offered.size) {
        const cat = fullCatalog();
        for (const i of plan.items) {
          if (!i.res || offered.has(i.res)) continue;
          const dove = risorsaQui(i, model.resOptions, cat);
          if (!dove) continue;
          if (dove.perNome) log(`risorsa di questo presidio: «${dove.opt.label}» ${dove.res} (nel catalogo ${i.res})`);
          else log(`«${i.display || i.label}»: qui la risorsa ${risorsaCorta(i.res, cat)} non c'è — lo stesso esame sta in «${dove.opt.label}»`);
          i.resCat = i.res;        // il catalogo che conosce questo esame resta quello di partenza
          i.res = dove.res;        // the exam's own name is verified before any send
          if (dove.code && dove.code !== i.code) i.code = dove.code;
        }
        const wrongRes = plan.items.filter((i) => i.res && !offered.has(i.res));
        if (wrongRes.length) {
          const qui = model.resOptions.map((o) => `«${o.label}» ${o.value}`).join(", ") || "nessuna";
          const cercate = [...new Set(wrongRes.map((i) => `«${(cat[i.res] && cat[i.res].label) || RES_SHORT[i.res] || i.res}» ${i.res}`))].join(", ");
          log(`risorse offerte qui: ${qui} — cercavo: ${cercate}`);
          throw new StopError("Esami non ordinabili in questa richiesta",
            `${wrongRes.map((i) => `«${i.display || i.label}»`).join(", ")}. Questa richiesta offre ${qui}. Nessun esame inviato.`);
        }
      }

      // Quello che in questo giro era già passato — sistemato prima
      // dell'interruzione, o in volo nell'istante in cui la pagina è cambiata —
      // viene per primo e si CERCA soltanto in carrello: non si rimanda mai.
      const items = [
        ...plan.items.filter((i) => i.soloVerifica),
        ...orderItems(plan.items.filter((i) => !i.soloVerifica), model.res),
      ];
      state.ordine = items;   // l'ordine vero: dice qual è il primo esame rimasto fuori
      // Il giro annotato dove sopravvive al cambio pagina: cosa è già entrato,
      // cosa era in volo, cosa resta. Si riscrive a ogni passo — è la memoria
      // da cui il pannello riparte, e l'unica che non muore con la pagina.
      // …con la risorsa di catalogo di partenza: serve al ritorno alla versione
      // vecchia in una sede che la «- NEW» non ce l'ha
      // (e la chiave della selezione da cui è nato: dopo un errore «Chiudi»
      // lascia scelti solo quelli che mancano davvero)
      const nudo = (i) => ({ res: i.res, code: i.code, label: i.label, display: i.display || i.label,
        ...(i.resCat ? { resCat: i.resCat } : {}), ...(i.chiave ? { chiave: i.chiave } : {}),
        ...(i.alPostoDi ? { alPostoDi: i.alPostoDi } : {}) });
      const salvaCorsa = (inVolo, resto) => {
        if (!plan.riprendibile) return;
        // Un esame che è già passato di qui non torna mai fra quelli «da
        // mandare»: resta fra i fatti, e alla ripresa si cerca in carrello.
        const rimasti = resto || [];
        segnaPresidio(state.richiestaId, token);
        // Il segno condiviso: se questa scheda muore, la prima pagina utile —
        // anche in un'altra scheda — dirà che un giro è rimasto a metà: quanti
        // non sono partiti, e quanti sono da controllare (quello in volo:
        // mai fra i «non mandati»).
        const mai = rimasti.filter((x) => !x.soloVerifica).length;
        const forse = inVolo ? 1 : rimasti.filter((x) => x.soloVerifica && !x.giaFatto).length;
        store.set(APERTA, mai || forse
          ? { ts: Date.now(), ep: plan.episodeId, paziente: plan.patientName || "", rid: state.richiestaId || null, quanti: mai, forse }
          : null);
        const scritto = tabStore.set(CORSA, {
          ts: Date.now(), ep: plan.episodeId, paziente: plan.patientName || "",
          autoConfirm: !!plan.autoConfirm, quesito: plan.quesito || "", qinfo: state.quesito || null,
          rid: state.richiestaId || null, listUrl: state.lastListUrl || null,
          riprese: plan.riprese || 0,
          ...(plan.ritentato ? { ritentato: true } : {}),   // il ritentativo da solo c'è già stato
          // il giro di un ordine in sottofondo: si riprende solo nella sua
          // scheda, e solo finché il service worker lo conosce
          ...(LAVORO ? { ordine: LAVORO.id } : {}),
          // la selezione di partenza (per «Svuota il carrello»)
          ...(plan.originali ? { originali: plan.originali } : {}),
          ...(plan.patientUrl ? { patientUrl: plan.patientUrl } : {}),
          ...(plan.prima ? { prima: plan.prima } : {}),
          // «in volo» resta in volo finché non lo si ritrova: se scivolasse fra
          // i fatti, alla ripresa dopo passerebbe per uno che qualcuno ha tolto
          // dal carrello — e un esame mai partito sparirebbe in silenzio.
          fatti: [...state.added, ...rimasti.filter((x) => x.giaFatto)].map(nudo),
          involo: inVolo ? nudo(inVolo) : (rimasti.find((x) => x.soloVerifica && !x.giaFatto) ? nudo(rimasti.find((x) => x.soloVerifica && !x.giaFatto)) : null),
          restanti: rimasti.filter((x) => !x.soloVerifica).map(nudo),
        });
        // Memoria piena o bloccata: l'appunto non c'è. Non si promette una
        // ripresa che non ci sarà — si dice, una volta sola, e da qui in poi
        // il giro è quello di prima: se cambi pagina, va perso.
        if (!scritto && plan.riprendibile) {
          plan.riprendibile = false;
          log("⚠ non riesco ad annotare il giro: se cambi pagina adesso, quello che resta non riparte da solo");
        }
      };
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const st = itemSteps.get(it);
        const nm = it.display || it.label; // short name for messages
        salvaCorsa(null, items.slice(i));   // da qui in poi, questo è ancora da mandare
        running(st);
        await pace(); // pace AFTER marking, so exactly one step is always live

        // Switch erogatore when the exam lives on another resource — the way
        // the page does it, with its «Risorsa» (cambioErogatore). Solo una
        // pagina senza quel modulo si legge per indirizzo, come prima.
        if (it.res && model.res !== it.res) {
          running(st, `passo a ${risorsaCorta(it.res)}`);
          const via = cambioErogatore(model, it.res, { rid: state.richiestaId, ep: plan.episodeId });
          if (via) log(`passo a ${risorsaCorta(it.res)} col «Risorsa» della pagina`);
          ({ doc, url } = via ? await fetchDoc(via.action, { method: "POST", body: via.body, signal })
            : await fetchDoc(model.listUrl(it.res) || state.lastListUrl, { signal }));
          guardSession(doc, "Nessun esame inviato per questo erogatore");
          assertSameEpisode(doc, plan.episodeId, "elenco esami");
          const passato = classify(doc) === "exam" ? examModel(doc, url) : null;
          if (!passato || passato.res !== it.res || String(passato.richiestaId) !== String(state.richiestaId)) {
            if (!passato) log(`pagina inattesa passando a ${risorsaCorta(it.res)}: "${snippet(doc)}"`);
            throw ritentabile(new StopError(`Cambio risorsa fallito (${risorsaCorta(it.res)})`, "Nessun ordine inviato per questo esame."));
          }
          model = passato;
          learnFrom(model);
          noteList();
        }

        if (model.inCart(it.code)) {
          done(st, "già nel carrello");
          log(`già presente ✓ ${nm}`);
          state.added.push(it);
          // anche qui il carrello vero di questa risorsa va registrato: la
          // conferma automatica confronta la ricevuta col carrello, e una
          // risorsa mai «toccata» in questo giro le risulterebbe non vista
          state.carrelli = state.carrelli || {};
          state.carrelli[model.res] = model.exams.filter((e) => e.isDel).map((e) => String(e.code));
          salvaCorsa(null, items.slice(i + 1));
          continue;
        }
        if (it.soloVerifica) {
          // Questo era IN VOLO quando la pagina è cambiata: il server può
          // averlo preso lo stesso. Si guarda — con le stesse riletture di
          // sempre — e non si rimanda mai: un esame ordinato due volte è una
          // provetta in più al laboratorio.
          running(st, "controllo se è entrato…");
          let riga = null;
          for (let attempt = 1; !riga && attempt <= VERIFY_RECHECKS; attempt++) {
            running(st, `controllo il carrello ${attempt}/${VERIFY_RECHECKS}…`);
            await sleep(VERIFY_WAITS[attempt - 1], signal);
            ({ doc, url } = await fetchDoc(model.listUrl(it.res || model.res) || state.lastListUrl, { signal }));
            guardSession(doc, `«${nm}» potrebbe essere stato aggiunto o no`);
            assertSameEpisode(doc, plan.episodeId, "verifica carrello");
            if (classify(doc) !== "exam") { log(`pagina inattesa in verifica: "${snippet(doc)}"`); continue; }
            const riletto = examModel(doc, url);
            if (!nostroElenco(riletto, it.res || model.res)) continue;
            model = riletto;
            noteList();
            // Qui la fotografia «prima» non c'è più: senza, «POTASSIO» si
            // riconoscerebbe in «POTASSIO URINARIO». Vale il proprio codice,
            // il nome IDENTICO, o lo stesso mnemonico LIS — niente di più
            // largo, o si dichiara entrato un esame che non c'è.
            riga = model.inCart(it.code) ? { code: it.code, label: it.label }
              : model.exams.find((e) => e.isDel && (
                baseEsame(e.label) === baseEsame(it.label) ||
                (mnemonico(it.label) && mnemonico(e.label) === mnemonico(it.label)))) || null;
          }
          if (!riga) {
            if (it.giaFatto) {
              // era entrato prima dell'interruzione e adesso non c'è più: lo
              // ha tolto qualcuno a mano. Non si rimette: si dice e si va.
              st.status = "skipped"; st.note = "non è più in carrello";
              it.tolto = true;   // tolto a mano: non è uno «da aggiungere»
              log(`⚠ «${nm}» era in carrello e adesso non c'è più: non lo rimetto`);
              ui.renderRun(state);
              salvaCorsa(null, items.slice(i + 1));
              continue;
            }
            throw new StopError(`«${nm}»: invio interrotto dal cambio pagina`,
              "Non risulta nel carrello e NON è stato rimandato. Apri il carrello e controlla.");
          }
          if (riga.code !== it.code) {
            log(`«${nm}» era entrato come «${riga.label}» (${riga.code})`);
            it.code = riga.code; it.label = riga.label;
          }
          done(st, "nel carrello ✓");
          log(`ritrovato ✓ ${nm}`);
          state.added.push(it);
          // il carrello vero di questa risorsa, come per un inserimento: senza,
          // una ripresa fatta di sole verifiche lascerebbe la ricevuta vuota e
          // la conferma automatica si sospenderebbe da sola
          state.carrelli = state.carrelli || {};
          state.carrelli[model.res] = model.exams.filter((e) => e.isDel).map((e) => String(e.code));
          salvaCorsa(null, items.slice(i + 1));
          continue;
        }
        // La versione «- NEW» dello stesso esame, se la pagina ne offre una:
        // si guarda l'elenco VIVO, non il catalogo, così vale in ogni sede e
        // anche per gli esami nuovi che il catalogo non ha mai visto.
        // …e al contrario: se qui la «- NEW» non c'è ancora, si torna a quella
        // di sempre invece di fallire per un codice che questa sede non ha.
        if (!/^esame \d+$/i.test(it.label)) {
          const mia = baseEsame(it.label);
          const trova = (nuova) => mia && model.exams.find((e) => e.isAdd && eNuovo(e.label) === nuova && baseEsame(e.label) === mia);
          let scelto = trova(true) || (eNuovo(it.label) ? trova(false) : null);
          // Qui la «- NEW» non c'è e nemmeno la sua gemella in elenco: si
          // torna alla vecchia del NOSTRO catalogo. Serve davvero, perché la
          // versione nuova ha anche un mnemonico nuovo (POC21171 contro
          // POC2117): senza questo passo, in una sede che ha solo la vecchia
          // e la chiama in un altro modo non la ritroverebbe più nessuno.
          if (!scelto && eNuovo(it.label)) {
            const items = (fullCatalog()[it.resCat || it.res]?.items) || {};
            const twin = Object.entries(items).find(([c, l]) => c !== it.code && !eNuovo(l) && baseEsame(l) === mia);
            if (twin) scelto = { code: twin[0], label: twin[1] };
          }
          if (scelto && scelto.code !== it.code) {
            log(eNuovo(scelto.label)
              ? `questa sede ha la versione nuova: «${scelto.label}» al posto di «${it.label}»`
              : `qui la versione «- NEW» non c'è: uso «${scelto.label}»`);
            // Tornare alla vecchia non si dice solo nel Registro: la ricevuta
            // mostra quella che è entrata, «al posto di EGA VENOSA NEW».
            if (!eNuovo(scelto.label)) {
              it.alPostoDi = it.display || shortLabel(it.label);
              it.display = shortLabel(scelto.label);
              st.label = it.display;
            }
            it.code = scelto.code; it.label = scelto.label;
          }
        }
        // la riga dell'esame su un elenco: col suo codice o — il numero cambia
        // da un presidio all'altro, l'esame no — col nome esatto o col
        // mnemonico che il LIS stampa fra parentesi. Mai per somiglianza.
        const rigaDi = (m) => {
          const l = m.addLink(it.code);
          if (l || /^esame \d+$/i.test(it.label)) return l || null;
          const mio = mnemonico(it.label);
          const perNome = m.exams.find((e) => e.isAdd && normEsame(e.label) === normEsame(it.label));
          const alt = perNome || (mio ? m.exams.find((e) => e.isAdd && mnemonico(e.label) === mio) : null);
          if (!alt) return null;
          log(`codice di questo presidio: ${alt.code} per «${alt.label}» (nel catalogo ${it.code})`);
          it.code = alt.code;
          return alt;
        };
        let link = rigaDi(model);
        // Né il codice né il nome sull'elenco: a volte arriva monco (la riga
        // c'è, ma non si vede). Lo si rilegge UNA volta con la ricerca del
        // gestionale — una semplice lettura — e la riga che compare passa per
        // la strada di sempre: il nome vivo controllato, un invio solo. Se non
        // c'è nemmeno lì, non si manda niente: lo si aggiunge a mano.
        let cercato = false, giaCercando = false, riletto = false;
        if (!link && !/^esame \d+$/i.test(it.label) && !model.inCart(it.code)) {
          const termine = termineRicerca(it.label);
          const su = urlRicerca(model.listUrl(it.res || model.res), termine);
          if (su) {
            running(st, `cerco «${termine}»…`);
            log(`«${nm}» non è sull'elenco: lo cerco con la ricerca del gestionale («${termine}»)`);
            const r = await fetchDoc(su, { signal });
            guardSession(r.doc, "Nessun esame inviato");
            assertSameEpisode(r.doc, plan.episodeId, "ricerca esame");
            const trovata = classify(r.doc) === "exam" ? examModel(r.doc, r.url) : null;
            if (!trovata) log(`pagina inattesa nella ricerca: "${snippet(r.doc)}"`);
            else if (trovata.res !== model.res || trovata.richiestaId !== model.richiestaId) log("la ricerca ha risposto con un altro elenco: non la uso");
            else {
              riletto = true;
              link = rigaDi(trovata);
              giaCercando = trovata.inCart(it.code);
              if (link) { cercato = true; log(`riletto con la ricerca del gestionale: «${link.label}»`); }
            }
            await pace();
          }
        }
        if (!link) {
          const gia = model.inCart(it.code) || giaCercando;
          throw ritentabile(new StopError(`«${nm}» non è nell'elenco di ${risorsaCorta(it.res)}`,
            gia ? "Risulta già nel carrello: controlla a mano."
              : riletto ? "Non c'è nemmeno con la ricerca del gestionale: non inviato. Aggiungilo a mano." : "Non inviato. Completa a mano."));
        }
        // Anti wrong-exam guardrail: the LIVE row label must match what the
        // doctor picked. If the hospital ever renumbers a code, every other
        // check would stay green — this one goes red BEFORE anything is sent.
        // (skipped for items carrying only the "esame N" fallback label)
        // Dashes differ between sites ("PANNELLO 1 – ANEMIA" vs "- ANEMIA") and
        // so does the odd word ("EMOGASANALISI MISTA" vs "CAPILLARE", same
        // POC2117). Typography is never a rename, and neither is a different
        // wording carrying the SAME LIS mnemonic — anything else still stops.
        if (!/^esame \d+$/i.test(it.label) && nomeVivo(link.label) !== nomeVivo(it.label)) {
          if (!stessoNomeVivo(link.label, it.label)) {
            throw new StopError(`Il codice ${it.code} oggi si chiama «${link.label}»`, `Selezionato come «${nm}» — non inviato.`);
          }
          log(`stesso esame, nome diverso in questa sede: «${link.label}» (${mnemonico(link.label)})`);
        }

        // ---- the one and only send of this exam -----------------------
        running(st, "invio…");
        log(`aggiungo → ${nm}`);
        // Il carrello com'è un attimo prima: se l'esame entra sotto un altro
        // codice — le prestazioni «REFLEX» lo fanno — è questa differenza a
        // dire quale riga ha prodotto il nostro clic.
        // Un'altra scheda sta mandando gli esami di QUESTA richiesta (succede
        // duplicando la scheda: si porta dietro l'appunto del giro). Due
        // motori sullo stesso carrello vuol dire due volte lo stesso esame.
        if (!presidioLibero(state.richiestaId, token)) {
          throw restaQui(new StopError("Un'altra scheda sta mandando gli esami di questa richiesta",
            "Da qui non mando niente. Finisci di là, o ricarica questa pagina."));
        }
        const prima = new Set(model.exams.filter((e) => e.isDel).map((e) => e.code));
        const resQui = model.res;
        salvaCorsa(it, items.slice(i + 1));   // da qui è IN VOLO: non si rimanda
        it.inviato = true;   // da qui, se non si vede in carrello, è «da controllare» — mai «manca»
        // …e così lo sa anche il service worker, PRIMA che parta (si aspetta
        // la sua risposta): se questa scheda muore adesso, quell'esame è da
        // guardare, non da rifare
        if (LAVORO) await ui.annunciaLavoro?.();
        ({ doc, url } = await fetchDoc(link.href, { signal }));
        guardSession(doc, `«${nm}» potrebbe essere stato aggiunto o no`);
        assertSameEpisode(doc, plan.episodeId, "conferma inserimento");
        // Un errore del database nella risposta («ORA-20965: … Progressivo
        // richiesta già utilizzato»): il gestionale ha rifiutato l'inserimento,
        // e la sua sessione non è più quella del giro. In QUESTA richiesta non
        // si manda più niente — niente riletture, niente altri invii — e si
        // dice al medico che cosa ha risposto, non «non risulta nel carrello»
        // trenta secondi dopo. Una richiesta nata in questo giro, dalla pagina
        // del paziente, si rifà da capo una volta (sotto, nel catch): la 3.71.1
        // e la 3.73.0 l'hanno visto su ordini di soli esami POC, a metà, col
        // carrello riletto vuoto.
        const allarme = avvisoGestionale(doc);
        if (/\bORA-\d{3,5}\b/.test(allarme)) {
          log(`⚠ il gestionale ha risposto all'inserimento di «${nm}»: ${allarme}`);
          const e = new StopError(`Il gestionale ha risposto: ${allarme}`, plan.ricreata
            ? `«${nm}» non è entrato, ed era già la richiesta rifatta da capo. Il giro si ferma qui e non rimanda niente: apri il carrello e controlla.`
            : `«${nm}» non è entrato. Il giro si ferma qui e non rimanda niente: apri il carrello e controlla.`);
          if (plan.startPage === "patient" && plan.entryUrl && !plan.ricreata && state.richiestaId) e.ricrea = String(state.richiestaId);
          throw e;
        }
        // Una pagina inattesa QUI non dice che l'esame non sia entrato:
        // l'inserimento è già partito. Invece di fermarsi al buio si rilegge
        // l'elenco pulito — mai un secondo invio — e si guarda il carrello.
        let risposta = classify(doc) === "exam" ? examModel(doc, url) : null;
        if (!risposta) {
          log(`pagina inattesa dopo l'inserimento: "${snippet(doc)}" — rileggo il carrello`);
        } else if (!nostroElenco(risposta, resQui)) {
          risposta = null;
        } else {
          model = risposta;
          learnFrom(model);
          noteList();
        }

        // ---- verify (re-reading the clean list only — never re-insert) --
        // In carrello l'esame può comparire col proprio codice oppure, se è a
        // riflesso, con quello dell'esame che ne deriva: una riga nuova vale
        // solo se porta il NOME di quello che il medico ha scelto.
        const entrato = () => {
          if (model.inCart(it.code)) return { code: it.code, label: it.label };
          const nuove = model.exams.filter((e) => e.isDel && !prima.has(e.code));
          if (nuove.length) log(`nuove righe in carrello: ${nuove.map((e) => `«${e.label}» ${e.code}`).join(", ")}`);
          return nuove.find((e) => stessoEsame(e.label, it.label)) || null;
        };
        // Mandato da una ricerca, la risposta è l'elenco FILTRATO: il carrello
        // che la conferma automatica confronta deve essere quello intero, e
        // lo dà solo una rilettura dell'elenco pulito.
        let verified = !!risposta && !cercato && entrato();
        for (let attempt = 1; !verified && attempt <= VERIFY_RECHECKS; attempt++) {
          running(st, `verifica ${attempt}/${VERIFY_RECHECKS}…`);
          await sleep(VERIFY_WAITS[attempt - 1], signal);
          ({ doc, url } = await fetchDoc(model.listUrl(resQui) || state.lastListUrl, { signal }));
          guardSession(doc, `«${nm}» potrebbe essere stato aggiunto o no`);
          assertSameEpisode(doc, plan.episodeId, "verifica carrello");
          if (classify(doc) !== "exam") {
            log(`pagina inattesa in verifica: "${snippet(doc)}"`);
            continue; // count the attempt; the next re-read may recover
          }
          const riletto = examModel(doc, url);
          if (!nostroElenco(riletto, resQui)) continue;
          model = riletto;
          verified = entrato();
          noteList();
        }
        if (!verified) {
          // Una riga che porta lo stesso esame sotto un altro nome c'era già
          // PRIMA del nostro clic: non vale come conferma — potrebbe essere
          // un altro esame con un nome che somiglia — ma dirlo evita al medico
          // di cercare al buio.
          const simile = model.exams.find((e) => e.isDel && stessoEsame(e.label, it.label));
          throw new StopError(`«${nm}» non risulta nel carrello`,
            simile ? `In carrello c'è «${simile.label}»: forse c'era già. Non reinviato — controlla.`
              : `Verificato ${VERIFY_RECHECKS} volte, non reinviato. Apri il carrello.`);
        }
        // È entrato con un altro numero: da qui in poi l'esame è QUELLA riga —
        // la ricevuta, il carrello registrato e la conferma automatica devono
        // parlare del carrello vero, non di quello che avevamo chiesto.
        if (verified.code !== it.code) {
          log(`«${nm}» è entrato come «${verified.label}» (${verified.code})`);
          it.code = verified.code;
          it.label = verified.label;
        }
        done(st, it.alPostoDi ? `nel carrello ✓ · al posto di ${it.alPostoDi}` : "nel carrello ✓");
        log(`aggiunto ✓ ${nm}`);
        state.added.push(it);
        // (Il promemoria «da confermare» non nasce qui: un giro che si ferma
        // a metà si dimentica — «se non parte l'ordine nel carrello,
        // ignoralo». Nasce col carrello finito, chiudiRichiesta; se la scheda
        // muore a metà lo dice il segno del giro rimasto a metà, APERTA.)
        salvaCorsa(null, items.slice(i + 1));
        // Il carrello di QUESTA risorsa come lo vediamo adesso. La Conferma
        // nativa invia la richiesta INTERA, comprese le righe che stanno sul
        // carrello di un'altra risorsa e che questa pagina non mostra: senza
        // registrarle qui, l'auto-conferma non potrebbe nemmeno vederle.
        state.carrelli = state.carrelli || {};
        state.carrelli[model.res] = model.exams.filter((e) => e.isDel).map((e) => String(e.code));
      }

      // ---- 3. hand the visible tab over for review / native confirm -----
      running(sEnd);
      const last = state.added[state.added.length - 1] || null;
      const landUrl = model.listUrl(last ? last.res : model.res);
      state.finishedListUrl = landUrl;
      // Receipt for the landing page: the panel there shows the full,
      // verified accounting (including exams on other resources).
      if (!plan.hold) tabStore.set("receipt.v1", {
        richiestaId: model.richiestaId, episodeId: plan.episodeId, ts: Date.now(),
        quesitoKept: state.quesitoKept || null, quesito: state.quesito || null,
        carrelli: state.carrelli || {}, ...(plan.prima ? { prima: plan.prima } : {}),
        items: state.added.map((i) => ({ res: i.res, code: i.code, label: i.label, display: i.display || i.label,
          ...(i.alPostoDi ? { alPostoDi: i.alPostoDi } : {}) })),
      });
      // La radiologia si conferma come il laboratorio: stessi controlli (la
      // riga in carrello, una volta sola, la conferma provata).
      if (plan.autoConfirm && state.added.length && !plan.hold) {
        tabStore.set("confirm.v1", {
          richiestaId: model.richiestaId, episodeId: plan.episodeId,
          lastCode: last.code, lastLabel: last.label, count: state.added.length, ts: Date.now(),
        });
      }
      done(sEnd);
      // Da qui in poi il giro non ha più esami da mandare: quello che resta
      // (conferma e stampa) ha già i suoi passaggi di consegna fra le pagine.
      tabStore.set(CORSA, null);
      store.set(APERTA, null);
      liberaPresidio(token);
      window.removeEventListener("pagehide", mollaPresidio);
      log(plan.autoConfirm ? "tutti verificati — passo alla pagina esami per la conferma" : "tutti verificati — rivedi il carrello e premi Conferma");
      ui.finished(state, plan);
      return state;
    } catch (err) {
      // «ORA-» all'inserimento in una richiesta nata in questo giro: quella
      // richiesta è persa — il gestionale ne ha perso il carrello, e non torna.
      // Resta com'è: mai un altro invio lì dentro, mai confermata, nessun
      // promemoria (non è un ordine: «se non parte l'ordine nel carrello,
      // ignoralo»). Dopo un attimo il giro si rifà da capo UNA volta, con una
      // richiesta nuova — «Crea» di nuovo — e tutti gli esami di partenza; un
      // secondo «ORA-» è l'errore di sempre. Lo dicono il Registro e la traccia.
      if (err && err.ricrea && !signal.aborted) {
        tabStore.set(CORSA, null);
        store.set(APERTA, null);
        liberaPresidio(token);
        window.removeEventListener("pagehide", mollaPresidio);
        confermataProvata(err.ricrea);   // (non ce n'è, ma per lei un promemoria non deve esserci mai)
        log(`⚠ la richiesta ${err.ricrea} non si usa più (non la confermo e non ci rimando niente): fra ${RIFAI_MS / 1000} s ne creo una nuova, con ${partenza.length === 1 ? "l'esame" : `tutti i ${partenza.length} esami`}`);
        if (TRACCIA && TRACCIA.passi.length < 120) TRACCIA.passi.push({ t: Date.now() - TRACCIA.t0, ms: 0, m: "rifaccio", pagina: "RICHIESTACrea", esito: `richiesta ${err.ricrea} lasciata: una nuova da capo` });
        let fermato = false;
        try { await sleep(RIFAI_MS, signal); } catch { fermato = true; }
        if (!fermato && !signal.aborted) {
          // (in una catena, sullo schermo restano i passi delle richieste di prima, non quelli di questa)
          if (plan.continuation) ui.runData = { ...state, steps: state.steps.slice(0, ereditati) };
          return runPlanVero({ ...plan, items: partenza.map((i) => ({ ...i })), ricreata: true, persa: err.ricrea }, ui);
        }
        // ⏹ nell'attesa: si dice come sempre, qui sotto
      }
      // Una decisione — STOP del medico, o un controllo che ha detto no — mette
      // fine al giro: da lì in poi decide lui, con quello che il pannello gli
      // ha appena detto. Un errore non deciso (la rete, o la pagina che muore
      // mentre navighi) invece NON cancella il giro: è proprio quello da cui
      // si riprende.
      if (signal.aborted || err?.name === "AbortError" || err instanceof StopError) {
        tabStore.set(CORSA, null);
        store.set(APERTA, null);   // fermato o fallito: il medico lo sta leggendo adesso
        liberaPresidio(token);
        window.removeEventListener("pagehide", mollaPresidio);
      }
      // Make the failure legible in the step plan: the live step goes red,
      // everything not yet run is explicitly "skipped".
      for (const s of state.steps) {
        if (s.status === "running") { s.status = "fail"; s.note = "fermato qui"; }
        else if (s.status === "pending") { s.status = "skipped"; s.note = "non eseguito"; }
      }
      // Che cosa è in carrello e che cosa resta da aggiungere a mano: è quello
      // che il medico deve sapere per finire dal gestionale. (Un esame tolto a
      // mano durante il giro non è «da aggiungere».)
      const nomeDi = (x) => x.display || shortLabel(x.label);
      const fuori = (state.ordine || plan.items).filter((x) => !state.added.includes(x) && !x.tolto);
      // Mandato (o in volo, o già entrato prima di un cambio pagina) ma non
      // visto in carrello adesso: è da CONTROLLARE, non da rifare — chi lo
      // aggiungesse a mano lo ordinerebbe due volte. «Mancano» sono solo
      // quelli mai partiti.
      // (quelli da controllare di un errore prima, lasciati fuori da «Riprova»,
      // restano in elenco: non sono spariti, sono ancora da guardare)
      const controllare = [...fuori.filter((x) => x.inviato || x.soloVerifica), ...(plan.daControllare || [])];
      const mancanoIt = fuori.filter((x) => !controllare.includes(x));
      // Fermato mentre svuotava il carrello: che cosa c'è dentro adesso lo
      // sa solo il carrello. Niente «Mancano» (si aggiungerebbe un esame che
      // magari è ancora lì), niente «Riprova» né «Svuota» da soli: si dice
      // cosa resta, se lo si è visto, e si finisce a mano.
      const aMeta = !!state.svuotando;
      state.mancanti = aMeta ? [] : mancanoIt;          // per «↻ Riprova i mancanti»: questi soli si mandano
      state.daControllare = aMeta ? [] : controllare;   // …e questi mai
      // (fermato prima di togliere qualunque cosa: il carrello è com'era, e si dice cosa c'è)
      const liste = aMeta
        ? { nel: state.rimasti || (state.tolgo ? [] : state.inCarrello || []), mancano: [], controllare: [], niente: true }
        : { nel: state.added.map(nomeDi), mancano: mancanoIt.map(nomeDi), controllare: controllare.map(nomeDi) };
      if (aMeta && state.tolgo && err instanceof StopError && !state.rimasti) {
        err.body = `${err.body ? err.body + " " : ""}Il carrello potrebbe essere svuotato in parte: controllalo e finiscilo a mano.`;
      }
      if (signal.aborted || err?.name === "AbortError") {
        log("■ interrotto dall'utente");
        ui.stopped(state, { head: "Interrotto", body: "L'ultimo esame inviato potrebbe essere in carrello: controlla.", ...liste }, plan);
      } else if (err instanceof StopError) {
        log(`⚠ ${err.message}`);
        // quanti esami restavano fuori: senza questo, il messaggio parla solo
        // di quello che è andato storto e il resto si vede solo espandendo
        const restavano = aMeta ? 0 : plan.items.filter((x) => !state.added.includes(x)).length - 1;
        ui.failed(state, { head: err.head, body: `${err.body || ""}${
          restavano > 0 ? (restavano === 1 ? " Restava 1 altro esame da mandare." : ` Restavano ${restavano} altri esami da mandare.`) : ""}`,
          ...liste, restaQui: !!err.restaQui, sessione: !!err.sessione, ritentabile: !!err.ritentabile }, plan);
      } else {
        // La pagina che muore mentre navighi arriva qui come una fetch fallita:
        // il giro annotato è ancora lì, e riprende da solo alla pagina dopo.
        const riprende2 = !!tabStore.get(CORSA, null);
        log(`⚠ ${riprende2 ? "giro interrotto" : "errore imprevisto"}: ${err?.message || err}`);
        ui.failed(state, riprende2
          ? { head: "Giro interrotto", body: "Riprende da solo appena si carica una pagina del gestionale: niente viene rimandato due volte.", ...liste }
          : { head: "Errore imprevisto", body: `${err?.message || err} — apri il carrello e controlla.`, ...liste }, plan);
      }
      return state;
    }
  }

  // Che cosa rifà «↻ Riprova i mancanti» dopo un errore: gli esami mai
  // partiti, sulla STESSA richiesta e nello stesso modo (revisione, o conferma
  // automatica e stampa). Quelli già in carrello vanno con loro solo per
  // essere ritrovati — mai rimandati — così ricevuta e conferma parlano della
  // richiesta intera; quelli «da controllare» (mandati e non visti) restano
  // fuori. Se la richiesta non era ancora nata, è un giro nuovo dalla pagina
  // del paziente. Mai per una catena lab+radiologia: a metà non si riprende.
  function ricettaRiprova(state, plan) {
    if (!plan || plan.hold || !plan.episodeId) return null;
    const nudo = (i) => ({ res: i.res, code: i.code, label: i.label, display: i.display || i.label,
      ...(i.resCat ? { resCat: i.resCat } : {}), ...(i.chiave ? { chiave: i.chiave } : {}),
      ...(i.alPostoDi ? { alPostoDi: i.alPostoDi } : {}) });
    const mancanti = (state.mancanti || []).map(nudo);
    const suo = plan.examUrl || plan.listUrl;
    const rid = state.richiestaId || (suo ? param(suo, "RICHIESTA_ID") : null);
    // «Svuota il carrello e ricomincia»: c'è una richiesta nata, qualcosa
    // nel suo carrello (entrato o da controllare) e la selezione di partenza
    const nelCarrello = (state.added || []).length + (state.daControllare || []).length;
    const tutti = Array.isArray(plan.originali) ? plan.originali.map(nudo) : [];
    const svuotabile = !!rid && tutti.length > 0 && nelCarrello > 0 && leggibilePagina(state.lastListUrl || "");
    if (!mancanti.length && !svuotabile) return null;
    if (!rid && plan.startPage !== "patient" && plan.startPage !== "crea") return null;
    return {
      ep: String(plan.episodeId), rid: rid ? String(rid) : null, autoConfirm: !!plan.autoConfirm,
      paziente: plan.patientName || "", patientUrl: plan.patientUrl || "",
      verdi: (state.added || []).map(nudo), mancanti, controllare: (state.daControllare || []).map(nudo),
      ...(svuotabile ? { tutti, listUrl: state.lastListUrl, nCarrello: nelCarrello } : {}),
      ...(state.quesito ? { qinfo: state.quesito } : {}),
      ...(plan.originali ? { originali: plan.originali.map(nudo) } : {}),
      ...(plan.ritentato ? { ritentato: true } : {}),   // una volta per ordine: da qui «Riprova» è solo del medico
    };
  }

  // Quale quesito è partito davvero, in una riga: quello del triage (che di
  // norma resta) o il tuo. Va nella ricevuta e nella striscia finale.
  function quesitoDetto(qi) {
    if (!qi || !qi.fonte) return "";
    if (qi.fonte === "triage") {
      const t = String(qi.testo || "").replace(/\s+/g, " ").trim();
      return t ? `Quesito del triage: "${t.length > 60 ? t.slice(0, 59) + "…" : t}"` : "Quesito del triage";
    }
    return qi.sopra ? "Quesito: il tuo, al posto del triage" : "Quesito: il tuo";
  }

  // «Mancano: … · Da controllare: …», una frase sola e la stessa ovunque: la
  // striscia di questa scheda, quella delle altre, il resoconto passato di
  // mano. Mancano = mai partiti (da aggiungere); da controllare = mandati e non
  // visti in carrello (da guardare, mai da rimandare). Dopo uno svuotamento
  // fermato, quello che c'è ancora nel carrello.
  function testoResto(r) {
    const l = (k) => (r && Array.isArray(r[k]) ? r[k] : []);
    return [l("mancano").length ? `Mancano: ${l("mancano").join(", ")}` : "",
      l("controllare").length ? `Da controllare: ${l("controllare").join(", ")}` : "",
      r && r.niente && l("nel").length ? `Nel carrello: ${l("nel").join(", ")}` : ""].filter(Boolean).join(" · ");
  }
  // «ROSSI MARIO» → «ROSSI M.»: di chi sono, in poco spazio (il nome intero sta sopra)
  const nomeCorto = (n) => {
    const p = String(n || "").trim().split(/\s+/).filter(Boolean);
    return p.length < 2 ? p.join(" ") || "un altro paziente" : `${p.slice(0, -1).join(" ")} ${p[p.length - 1][0]}.`;
  };

