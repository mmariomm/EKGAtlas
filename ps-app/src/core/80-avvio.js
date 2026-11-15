//@frammento 80-avvio.js — BOOT: SA4PSO/IN_PSO, il TABELLONE a tutta pagina, boot(), sola lettura, bootGestionale,
//@ la pill su ogni pagina (bootVista).
  // ==================================================================== BOOT
  // The extension runs on two applications: SA4PSO, and the clinical portal
  // where the multi-day table lives. Everything below the storico reader is
  // written for SA4PSO's markup and must never be applied to the other one —
  // its login page carries a password field, and mistaking it for SA4PSO's
  // would wipe the shift's saved documents.
  const SA4PSO = location.hostname === "smarthealth.multimedica.it";
  // Il pronto soccorso vero e proprio: tutto quello che il pannello legge e
  // scrive sta sotto /sa4pso/. Sulle altre pagine dello stesso gestionale
  // (/sa4rcs/, /si4Portal/, /sa4/) c'è solo la pill.
  const IN_PSO = SA4PSO && /^\/sa4pso\//i.test(location.pathname);
  function voceTabella(doc) {
    const el = [...doc.querySelectorAll('button, a, [role="tab"], [role="button"], li, span')]
      .find((x) => x.childElementCount <= 2 && /^tabella$/i.test((x.textContent || "").trim()));
    return el ? el.closest('button, a, [role="tab"], [role="button"], [onclick]') || el : null;
  }

  // ============================================================ TABELLONE
  // La pagina extension/tabellone.html (vedi «IL TABELLONE IN UNA SCHEDA»).
  // Dal tabellone non si ordina: si apre un paziente (lo apre una scheda del
  // gestionale, col SUO indirizzo, che il gestionale stesso ha dato) e si
  // sposta un letto (lo scrive una scheda del gestionale).
  let TAB_SCHEDE = null;   // quante schede del gestionale rispondono (null: non si sa ancora)
  async function tabelloneChiede(m) {
    const r = await ask({ t: "tabellone", ...m });
    if (!(r && r.ok) && PANNELLO && m.cosa !== "sync") {
      PANNELLO.message = `Non fatto: ${(r && r.why) || "il gestionale non ha risposto"}.`;
      PANNELLO.render();
    }
    return r && typeof r === "object" ? r : { ok: false };
  }
  // quello che il medico ha cambiato qui va al gestionale; se non ci arriva, torna com'era
  async function tabelloneScrive(kv) {
    const r = await tabelloneChiede({ cosa: "scrivi", kv });
    if (r.ok) return;
    rimettiSpecchio();
    PANNELLO?.render();
  }
  function rimettiSpecchio() {
    for (const c of MEM.chiavi()) if (specchiata(c.slice(NS.length))) MEM.removeItem(c);
    for (const [k, v] of Object.entries(specchioKv)) MEM.setItem(NS + k, v);
  }
  function bootTabellone() {
    document.title = `Tabellone — ${APP}`;
    const panel = new Panel("patient");
    PANNELLO = panel;
    panel.entry = { labUrl: null, radioUrl: null };   // come la lista del PS: nessun paziente «qui»
    panel.view = "home";
    const applica = (sp) => {
      const kv = sp && sp.kv && typeof sp.kv === "object" ? sp.kv : {};
      specchioKv = Object.fromEntries(Object.entries(kv).filter(([k, v]) => specchiata(k) && typeof v === "string"));
      rimettiSpecchio();
    };
    try {
      chrome.storage.local.get(SPECCHIO).then((o) => { applica(o[SPECCHIO]); panel.mostraDimessi(true); panel.render(); }).catch(() => {});
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== "local" || !ch[SPECCHIO]) return;
        const prima = specchioKv[DIMESSI];
        applica(ch[SPECCHIO].newValue);
        if (specchioKv[DIMESSI] !== prima) panel.mostraDimessi();
        panel.aggiornaDaFuori();
      });
    } catch { /* fuori dall'estensione: niente da mostrare */ }
    // il gestionale c'è? Senza, il tabellone si guarda soltanto
    const spia = () => ask({ t: "tabellone", cosa: "stato" }).then((r) => {
      const n = r && r.ok ? r.schede : 0;
      if (n === TAB_SCHEDE) return;
      TAB_SCHEDE = n;
      const el = panel.root.querySelector(".tbspia");
      if (el) el.outerHTML = panel.tabelloneSpia();
    });
    spia();
    setInterval(spia, 5000);
    panel.render();
  }
  // Nella scheda del gestionale: le domande del tabellone, dal service worker
  async function tabelloneEsegui(panel, m) {
    if (classify(document) === "login") return { no: "login" };
    if (LAVORO || PONTE_VALORI) return { no: "lavoro" };
    if (m.cosa === "scrivi") {
      // (3.90) i cambi del tabellone (cambioDi), applicati a quello che c'è adesso qui — mai il suo valore intero
      const kv = Array.isArray(m.kv) ? m.kv : [];
      if (!kv.length || !kv.every((x) => Array.isArray(x) && typeof x[0] === "string" && specchiata(x[0]) && oggetto(x[1]))) {
        return { ok: false, why: "scrittura inattesa" };
      }
      try {
        for (const [k, c] of kv) {
          const prima = jsonDi(localStorage.getItem(NS + k)), dopo = cambioApplica(prima, c);
          if (dopo === prima) continue;
          if (dopo === undefined) localStorage.removeItem(NS + k); else localStorage.setItem(NS + k, JSON.stringify(dopo));
        }
      } catch { return { ok: false, why: "la memoria del browser è piena o bloccata" }; }
      specchia(null);
      if (kv.some(([k]) => k === DIMESSI)) panel.mostraDimessi();
      panel.aggiornaDaFuori();
      return { ok: true };
    }
    if (m.cosa === "sync") {
      const r = await smartSync(true);
      return { ...(r || { ok: false }), dietro: rileggiAperti(panel.pazModello()) };   // (il ⟳ del tabellone: anche chi è stato aperto in questo turno)
    }
    if (m.cosa !== "apri" && m.cosa !== "area") return { ok: false, why: "domanda sconosciuta" };
    // aprire un paziente cambia pagina: mai sotto un ordine che parte, mai sotto le dita di chi scrive
    if (panel.giroQui()) return { ok: false, why: "in quella scheda del gestionale sta partendo un ordine: aspetta che finisca" };
    const scrive = staScrivendo();
    if (scrive) return { ok: false, why: `nel gestionale stai scrivendo (${scrive}): finisci lì, poi riprova` };
    if (m.cosa === "area") return m.prova ? { ok: true } : { ok: !!apriArea(String(m.k || "")) };
    const ep = String(m.ep || ""), qui = !!ep && ep === panel.epDiQuesta();
    const p = knownPatients().find((x) => x.ep === ep);
    if (!qui && !p) return { ok: false, why: "questo paziente non è nell'elenco del gestionale" };
    if (m.prova) {
      // la pagina che si apre (o che si ricarica prendendo il fuoco) parte col pannello aperto, sulla schermata giusta
      tabStore.set("afterNav.v1", { ep, view: m.go, ts: Date.now() });
      tabStore.set("navPannello.v1", Date.now());
      return qui ? { ok: true, qui: true } : p.url ? { ok: true, url: p.url } : { ok: true };
    }
    if (qui) {
      tabStore.set("navPannello.v1", 0); tabStore.set("afterNav.v1", null);
      panel.apri(); panel.setView(panel.vistaApertura(m.go));
      return { ok: true };
    }
    panel.apriPaziente(ep, m.go);
    return { ok: true };
  }
  function tabelloneAscolta(panel) {
    try {
      chrome.runtime.onMessage.addListener((m, s, reply) => {
        if (!m || m.t !== "tabelloneEsegui" || (s && s.tab)) return;   // solo dal service worker
        tabelloneEsegui(panel, m).then(reply, (e) => reply({ ok: false, why: String(e?.message || e).slice(0, 80) }));
        return true;
      });
    } catch { /* niente estensione */ }
    specchia(null);   // lo specchio, appena arrivati
  }

  function boot() {
    if (TABELLONE) { bootTabellone(); return; }
    if (document.getElementById("psassist-host")) return;
    // The portal's multi-day table: here the panel does not order anything and
    // does not ask the server anything. It reads the table already on screen
    // and hands it to the patient's page. Nothing else.
    if (haStorico(document)) { bootStorico(); return; }
    if (!SA4PSO) {
      // Una scheda che il pannello ha aperto per un REFERTO: qui non c'è
      // nessuna tabella da aspettare, si aspetta il PDF (vedi sotto).
      let perReferto = false;
      const chi = hasExt() ? ask({ t: "chiAprivo" }).catch(() => null) : Promise.resolve(null);
      chi.then((r) => { if (r && r.ok && r.sotto && r.cosa === "referto") { perReferto = true; leggiRefertoPortale(r); } });
      // The portal is a single-page application: it paints the table AFTER
      // this script has run, and reaching it is an in-app route change that
      // never re-injects us. Probing once would mean never reading anything.
      let atteso = null;
      const occhio = new MutationObserver(() => {
        clearTimeout(atteso);
        atteso = setTimeout(() => {
          if (document.getElementById("psassist-host")) return;
          if (haStorico(document)) { occhio.disconnect(); clearTimeout(muto); bootStorico(); }
        }, 120);
      });
      occhio.observe(document.documentElement, { childList: true, subtree: true });
      // Se dopo un po' la tabella non c'è, non si resta muti: «non si vede
      // niente» è indistinguibile da «l'estensione non gira su questa pagina»,
      // e senza saperlo non si sa nemmeno cosa raccontarmi. La striscia dice
      // che il programma c'è e cosa gli manca. Sparisce da sola.
      const muto = setTimeout(async () => {
        if (document.getElementById("psassist-host") || haStorico(document)) return;
        // La scheda che il pannello ha aperto in sottofondo («⭳ Carica i
        // valori»): nessuno la guarda, quindi niente striscia. Se il portale
        // chiede di entrare lo si dice al pannello; se la tabella sta dietro la
        // voce «Tabella», la si apre — un clic nell'interfaccia del portale,
        // come farebbe il medico, e UNA volta sola.
        let mia = false;
        const r0 = await chi;
        if (perReferto || (r0 && r0.ok && r0.sotto && r0.cosa === "referto")) return;
        mia = !!(r0 && r0.ok && r0.sotto);
        if (mia) {
          let cliccato = false;
          for (let giro = 0; giro < 8 && !document.getElementById("psassist-host") && !haStorico(document); giro++) {
            if (document.querySelector('input[type="password"]')) { ask({ t: "sottoLogin" }).catch(() => {}); return; }
            const voce = !cliccato && voceTabella(document);
            if (voce) { voce.click(); cliccato = true; }
            await sleep(1500);
          }
          return;
        }
        const h = document.createElement("div");
        h.id = "psassist-attesa";
        const r = h.attachShadow({ mode: "open" });
        r.innerHTML = `<style>:host{all:initial}
          .b{position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:10px;
             max-width:min(520px,92vw);font:12.5px/1.4 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;
             background:#6B7A88;color:#fff;border-radius:10px;padding:8px 10px 8px 12px;box-shadow:0 6px 22px rgba(11,44,80,.28)}
          button{border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;border-radius:7px;
                 padding:4px 9px;font:inherit;font-weight:600;cursor:pointer}
          button:hover{background:rgba(255,255,255,.14)}</style>
          <div class="b" role="status"><span><b>PS Assist</b> è attivo, ma qui non c'è nessuna tabella:
          apri <b>Tabella</b> nello storico dati clinici.</span><button id="via">✕</button></div>`;
        r.getElementById("via").addEventListener("click", () => h.remove());
        document.documentElement.appendChild(h);
        setTimeout(() => h.remove(), 15000);
      }, 1500);
      return;
    }
    // Fuori da /sa4pso/ (le finestre Risultati, il portale delle applicazioni,
    // il passaggio verso il visore): la pill e basta. Qui non parte niente di
    // quello che segue — né ordini, né stampe, né letture della pagina.
    if (!IN_PSO) {
      // La build mini non ha pill né registratore fuori dal gestionale: niente.
      if (!SOLA_LETTURA && classify(document) !== "login" && !/login/i.test(location.pathname)) vistaQui();
      return;
    }
    document.addEventListener("click", confermaPresto, true);   // (fino a bootGestionale)
    // Con l'estensione, per prima cosa: questa scheda è quella di un ordine
    // in sottofondo? Lo sa il service worker, dal numero della scheda. (Una
    // risposta che non arriva vale «no»: la scheda parte come sempre.)
    if (hasExt()) {
      let fatto = false;
      const via = (r) => { if (fatto) return; fatto = true; bootGestionale(r && r.ok ? r : null); };
      ascoltaPdf();
      // la lista smart aperta dietro per «segue il gestionale»: si legge e basta
      if (eSmart(document, location.href)) {
        ask({ t: "smartChi" }).then((r) => {
          if (r && r.ok) { fatto = true; smartSottoQui().catch(() => ask({ t: "smartFine", esito: "errore" })); }
          else ask({ t: "ordineChi" }).then(via);
        });
        setTimeout(() => via(null), 3000);
        return;
      }
      ask({ t: "ordineChi" }).then(via);
      setTimeout(() => via(null), 3000);
      return;
    }
    bootGestionale(null);
  }

  // Chi è loggato nel gestionale su questo PC, dalla testata della pagina
  // («Salve! Sei connesso come Utente Medico: NOME»): lo si dice al service
  // worker per la testata «Sola lettura · gestionale di …» del telefono. Solo
  // il nome, e solo se si legge: non blocca mai una lettura.
  function reportOperatore() {
    if (!hasExt()) return;
    try {
      // (nel suo testo soltanto: il textContent di tutta la pagina incolla la cella dopo — l'episodio, il nome
      // e il codice fiscale del paziente — come se fossero il nome dell'operatore)
      const giro = document.body ? document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT) : null;
      let testo = "";
      for (let n = giro && giro.nextNode(), k = 0; n && k < 4000; n = giro.nextNode(), k++) if (/connesso come/i.test(n.nodeValue)) { testo = n.nodeValue; break; }
      const m = /connesso come[^:]*:\s*([^<\n]{1,60})/i.exec(testo);
      const nome = m ? m[1].replace(/\s+/g, " ").trim() : "";
      if (nome) ask({ t: "ponteOperatore", nome }).catch(() => {});
    } catch { /* niente: la testata è solo informativa */ }
  }

  // La scheda del gestionale nella build mini: nessun pannello degli ordini,
  // solo il distintivo e le LETTURE che servono al telefono (le stesse della
  // build piena). Niente ascolto degli ordini, niente conferme sorvegliate,
  // niente stampa automatica: questo PC non scrive nel gestionale. Il pannello
  // si costruisce lo stesso, perché i comandi di lettura del ponte (ponteEsegui)
  // leggono dal suo modello (PANNELLO.pazModello()).
  function bootSolaLettura(chi, pageType) {
    const panel = new Panel(pageType);
    PANNELLO = panel;
    reportOperatore();
    if (pageType !== "patient") {
      panel.render();                       // il distintivo
      if (PONTE_VALORI) ponteValoriQui(panel);
      return;
    }
    panel.entry = patientModel(document, location.href);
    if (eListaArea(document, location.href)) panel.entry = { labUrl: null, radioUrl: null };
    panel.esiti = esitiModel(document, location.href);
    if (panel.episodeId && (panel.entry.labUrl || panel.entry.radioUrl)) leggiStatoPagina(panel.episodeId, document);
    panel.render();                         // il distintivo
    // il collega apre il paziente sul PC: le letture per il telefono, identiche
    // alla build piena (nome, età, cartella, portale clinico, valori e referti)
    if (panel.entry && (panel.entry.labUrl || panel.entry.radioUrl) && !PONTE_VALORI) {
      const an = anagraficaPagina(document);
      rememberPatient(panel.episodeId, nomeInPagina(), location.href, triageDi(document), an.eta, an.sesso, improntaNascita(nascitaInPagina(document)));
      cartellaLettaQui(panel.episodeId);
      iconaCf(document);
      document.addEventListener("click", (ev) => {
        const a = ev.target?.closest?.('a[href*="MODALITA=CLINICA"]');
        if (!a || !hasExt()) return;
        ask({ t: "apreStorico", ep: panel.episodeId || "", nome: panel.nomePaziente() || "" }).catch(() => {});
      }, true);
    }
    if (hasExt()) ask({ t: "portale" }).then((r) => { if (r && r.ok && r.origine) panel.portale = r.origine; }).catch(() => {});
    const daSolo = !PONTE_VALORI;
    if (!daSolo || panel.ordineInCorso()) panel.refreshRefCache();
    panel.caricaStorico();
    if (daSolo) panel.autoCarica({ esiti: panel.view === "esiti" }).catch(() => {});
    // finché la pagina resta aperta, un laboratorio a metà si ricontrolla (solo
    // mentre la si guarda, e dopo due giri a vuoto basta) — come la build piena
    if (!PONTE_VALORI && !TABELLONE) {
      let vuoti = 0, ultimo = Date.now();
      const ricontrolla = async () => {
        if (vuoti >= 2 || document.visibilityState !== "visible") return;
        if (!panel.esiti.some((e) => e.kind === "valori" && !e.storico)) return;
        ultimo = Date.now();
        const prima = panel.impValori();
        const r = await panel.autoCarica({ esiti: true }).catch(() => null);
        if (r && r.lab) vuoti = panel.impValori() === prima ? vuoti + 1 : 0;
      };
      setInterval(ricontrolla, PARZ_MS + 5e3);
      document.addEventListener("visibilitychange", () => { if (Date.now() - ultimo >= PARZ_MS) ricontrolla(); });
    }
    if (PONTE_VALORI) { ponteValoriQui(panel); return; }
  }

  function bootGestionale(chi) {
    document.removeEventListener("click", confermaPresto, true);   // (da qui il gancio sul bottone: armPrintOnConfirm)
    if (document.getElementById("psassist-host")) return;
    // la scheda aperta dal service worker solo per dare i PDF di una stampa: niente pannello
    if (chi && chi.fogli) return;
    if (!eTerapie()) tabStore.del(TERAPIA);   // il giro della terapia vive solo di pagina delle terapie in pagina delle terapie
    LAVORO = chi && chi.lavoro ? chi.lavoro : null;
    if (LAVORO) annotaDurataConferma();   // (la prima pagina dopo il clic su Conferma: quanto ci ha messo)
    potaStampe();   // (i fogli letti dopo un ordine, scaduti: via, anche se nessuno scrive più)
    segnaScheda(chi);
    PONTE_VALORI = chi && chi.ponteValori ? chi.ponteValori : null;
    PONTE_CARTELLA = chi && chi.ponteCartella ? chi.ponteCartella : null;
    PONTE_TERAPIA = chi && chi.ponteTerapia ? chi.ponteTerapia : null;
    PONTE_ACCETTA = chi && chi.ponteAccetta ? chi.ponteAccetta : null;
    PONTE_LISTA = chi && chi.ponteLista ? chi.ponteLista : null;
    ponteAscolta();
    scadenzaQuesiti();
    const pageType = classify(document);
    if (pageType === "login") {
      // La sessione è caduta. forgetAll() porta via anche l'appunto del giro:
      // se c'era qualcosa da mandare va detto QUI, prima di cancellare, perché
      // dopo il nuovo accesso non ne resterebbe traccia. Senza nomi: questa
      // pagina la può avere davanti chiunque.
      const c = tabStore.get(CORSA, null);
      // (anche un giro di un'altra scheda, o di un browser chiuso a metà: il
      // segno condiviso lo sa, e dopo il nuovo accesso non ci sarebbe più)
      const a = store.get(APERTA, null);
      const fresca = !!a && Date.now() - (a.ts || 0) < APERTA_TTL;
      const mai = c ? (c.restanti || []).length : fresca ? a.quanti || 0 : 0;
      const forse = c ? (c.involo ? 1 : 0) : fresca ? a.forse || 0 : 0;
      // Gli ordini in sottofondo restano — le etichette da stampare, gli
      // avvisi —: dopo il nuovo accesso la striscia li dice ancora. Qui solo
      // quanti sono, senza nomi. La scheda di un ordine lo dice alle altre.
      const aperti = LAVORO ? 0 : (chi?.ordini || []).length;
      // (la Conferma già partita da questa scheda: può essere confermata — da controllare, mai «non partita»)
      if (LAVORO) ask({ t: "ordineAggiorna", id: LAVORO.id, ...(confermaPartita()
        ? { stato: "avviso", vista: { tag: "Da controllare", testo: GUARDA, tono: "warn", quesito: "sessione scaduta dopo la Conferma: rifai l'accesso" } }
        : { stato: "errore", vista: { tag: "Non partita", testo: "rifai l'accesso, poi apri il carrello", tono: "err", sessione: true } }) });
      if (PONTE_VALORI) ask({ t: "ponteValoriFatto", ok: false, testo: "il gestionale chiede di rifare l'accesso" });
      if (PONTE_CARTELLA) ask({ t: "ponteCartellaFatto", ok: false, incerto: PONTE_CARTELLA.fase === "inviato", testo: "il gestionale chiede di rifare l'accesso" });
      if (PONTE_TERAPIA) ask({ t: "ponteTerapiaFatto", ok: false, incerto: PONTE_TERAPIA.fase === "inviato", testo: "il gestionale chiede di rifare l'accesso" });
      if (PONTE_ACCETTA) ask({ t: "ponteAccettaFatto", ok: false, incerto: PONTE_ACCETTA.fase !== "lista", testo: "il gestionale chiede di rifare l'accesso" });
      if (PONTE_LISTA) ask({ t: "ponteListaFatto", ok: false, testo: "il gestionale chiede di rifare l'accesso" });
      // e la sessione del ponte verso l'iPhone si chiude (l'associazione resta: rientrati, il telefono riapre)
      if (hasExt()) ask({ t: "ponteLogin" });
      forgetAll();
      store.del(SMART_SYNC);   // rientrati, la prima pagina rilegge la smart (l'elenco se n'è andato con forgetAll)
      if (mai || forse || aperti) {
        const d = document.createElement("div");
        d.id = "psassist-avviso-login";
        d.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:min(520px,92vw);background:#B3261E;color:#fff;border-radius:10px;padding:10px 12px;font:13px/1.45 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;box-shadow:0 6px 20px rgba(9,42,74,.35)";
        d.textContent = "PS Assist: " + [
          mai || forse ? `la sessione è scaduta mentre mandava gli esami — ${contoRimasto(mai, forse)}. Rientra e controlla il carrello dell'ultima richiesta.` : "",
          aperti ? `${mai || forse ? "E c'è" : "La sessione è scaduta con"} ${aperti === 1 ? "1 ordine di esami ancora aperto" : `${aperti} ordini di esami ancora aperti`} (etichette da stampare, o un avviso): rientra, e la striscia ${aperti === 1 ? "lo mostra" : "li mostra"}.` : "",
        ].filter(Boolean).join(" ");
        document.documentElement.appendChild(d);
      }
      return;
    }
    // Le aree: quella in testa alla pagina, chi c'è dalla lista di un'area, le
    // opzioni di PsoPsoImposta; un passaggio d'area a metà va avanti (e la
    // pagina se ne va: niente pannello); la lista smart diventa cliccabile.
    // (La scheda di un ordine in sottofondo non legge niente di tutto questo.)
    // la scheda che salva la cartella dal telefono: niente pannello, fa quello e basta
    if (PONTE_CARTELLA) { ponteCartellaQui().catch(() => ask({ t: "ponteCartellaFatto", ok: false, testo: "errore nella scheda" })); return; }
    // …e quella della pagina Terapia dal telefono (un errore dopo «Conferma» resta un dubbio)
    if (PONTE_TERAPIA) { ponteTerapiaQui().catch(() => ask({ t: "ponteTerapiaFatto", ok: false, incerto: PONTE_TERAPIA.fase === "inviato", testo: "errore nella scheda" })); return; }
    // …e quella di «Accetta in ambulatorio» (dopo il clic, un errore resta un dubbio)
    if (PONTE_ACCETTA) { ponteAccettaQui().catch(() => ask({ t: "ponteAccettaFatto", ok: false, incerto: PONTE_ACCETTA.fase !== "lista", testo: "errore nella scheda" })); return; }
    // …e quella della lista dell'area, per chi il PC conosce solo dalla smart (una lettura)
    if (PONTE_LISTA) { ponteListaQui().catch(() => ask({ t: "ponteListaFatto", ok: false, testo: "errore nella scheda" })); return; }
    // la scheda di un ordine che passa il gestionale all'area del paziente: le
    // pagine di mezzo (PsoPsoImposta, la lista dove atterra) fanno quello e basta
    if (lavoroAreaQui(document, location.href)) return;
    migraStanza();
    store.del("segue.v1");   // («Segue il gestionale» non si spegne più: l'interruttore di prima se ne va)
    if (!LAVORO && !PONTE_VALORI) {
      smartUrlQui(document, location.href);   // il link della lista smart, quando la pagina lo porta
      leggiAreaPagina(document, location.href);
      if (areaVaiQui(document, location.href)) return;
      smartQui(document, location.href);
      // il gestionale appena aperto (dopo l'accesso, o un «Reset»: la smart non è ancora stata letta):
      // tutto il pronto soccorso, dietro, per il telefono e il tabellone (mai a tempo). Un attimo dopo:
      // la pagina finisce di nascere prima che ne nasca un'altra accanto (se se ne va prima, la legge la prossima)
      if (hasExt() && !eSmart(document, location.href) && smartDaLeggere()) setTimeout(() => { if (smartDaLeggere()) smartSync(false).catch(() => {}); }, SMART_APERTO_MS);
    }
    // La build mini (sola lettura): da qui niente pannello degli ordini, niente
    // sorveglianza delle conferme, niente stampa automatica — solo le letture
    // per il telefono e il distintivo. Le schede di sottofondo di sola lettura
    // (PONTE_VALORI, e PONTE_TERAPIA del «rileggi») sono già passate sopra.
    if (SOLA_LETTURA) return bootSolaLettura(chi, pageType);
    if (pageType === "other") {
      // e.g. the post-confirm label page: no panel, but a pending print
      // handoff starts here when the page lists the richiesta's print links.
      if (chi) ascoltaOrdini(null);   // e le etichette di un ordine in sottofondo, se il medico è qui
      if (PONTE_VALORI) ponteValoriQui(null);
      nonConfermateQui();   // le richieste che questa pagina mostra confermate non vanno più sorvegliate
      // (nella scheda di un ordine, dopo una sosta: una stampa partita da una
      // pagina che il gestionale sta lasciando chiedeva i PDF a una pagina che
      // non c'era più — «Stampa interrotta». Lasciata, parte dal paziente.)
      const stampa = !LAVORO && maybeAutoPrint(null);
      if (LAVORO) setTimeout(() => { if (LAVORO && !maybeAutoPrint(null) && LAVORO.stato !== "avvio") lavoroSenzaSeguito(null); }, SOSTA_LAVORO);
      // …e la pill, come su ogni pagina del gestionale (la dimissione, le
      // terapie, le stampe…): mai nella scheda di un ordine o del ponte, mai
      // mentre questa pagina stampa, mai nella lista smart.
      if (!stampa && !LAVORO && !PONTE_VALORI && !eSmart(document, location.href)) vistaQui();
      if (!LAVORO && !PONTE_VALORI) terapiaQui().catch(() => {});   // la pagina delle terapie: impara, e il giro preparato dal pannello
      return;
    }
    // le eccezioni non prese del NOSTRO codice (la pila passa dall'estensione), nel registro degli errori
    const eccezione = (messaggio, pila) => {
      if (!/chrome-extension:/.test(String(pila || ""))) return;
      segnaErrore("eccezione", { dove: "pannello", messaggio: String(messaggio || "").slice(0, 200), pila: String(pila).split("\n").slice(0, 4).join(" | ") });
    };
    window.addEventListener("error", (ev) => eccezione(ev.message, `${ev.filename || ""}\n${ev.error?.stack || ""}`));
    window.addEventListener("unhandledrejection", (ev) => eccezione(ev.reason?.message || ev.reason, ev.reason?.stack));
    const panel = new Panel(pageType);
    PANNELLO = panel;
    // «Dimentica i dati…» da un'altra scheda: anche questa dimentica (non a metà di un giro)
    window.addEventListener("storage", (ev) => {
      if (ev.key !== NS + "reset.v1" || !ev.newValue || panel.giroQui()) return;
      azzeraScheda();
      panel.fermaAuto();
      panel.dimenticaTutto();
      panel.render();
    });
    // Il tabellone segue il gestionale: quello che ha letto la scheda dietro
    // (o un'altra scheda) si vede qui, e chi è uscito porta il suo «Annulla».
    // (la smart non si rilegge a tempo: appena aperto il gestionale, aprendo l'app sull'iPhone, e col ⟳)
    window.addEventListener("storage", (ev) => {
      if (ev.key === NS + PROM || ev.key === NS + DF_GEN) return panel.promTick();   // un «Da fare» scritto in un'altra scheda: rifatto sul posto
      // i fogli di un ordine appena confermato, letti dalla sua scheda: la Ristampa li vede (mai sopra chi scrive nel pannello)
      if (ev.key === NS + STAMPE_FRESCHE) {
        const a = panel.root.activeElement;
        if (!panel.collapsed && ["richieste", "stampa"].includes(panel.view) && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) panel.render();
        return;
      }
      if (![NS + "patients.v1", NS + AREE, NS + SMART_SYNC, NS + DIMESSI, NS + STATO, NS + "refVisti.v1"].includes(ev.key)) return;   // (STATO: una scheda dietro ha riletto un paziente; refVisti: visti sul telefono)
      if (ev.key === NS + DIMESSI) panel.mostraDimessi();
      panel.aggiornaDaFuori();
    });
    panel.mostraDimessi(true);
    if (chi) { panel.ordiniOk = true; ascoltaOrdini(panel); }
    if (hasExt() && !LAVORO && !PONTE_VALORI) tabelloneAscolta(panel);
    if (hasExt()) { panel.seguiStampa(); panel.seguiRec(); panel.seguiAggiorna(); panel.seguiRicetta(); panel.seguiForma(); }
    if (pageType === "patient") {
      panel.entry = patientModel(document, location.href);
      // la lista di un'area ha, riga per riga, i link per ordinare di ognuno:
      // non è la pagina di un paziente (quello del primo in elenco)
      if (eListaArea(document, location.href)) panel.entry = { labUrl: null, radioUrl: null };
      panel.esiti = esitiModel(document, location.href);
      // le richieste che la pagina elenca, con il loro stato: per la riga dei
      // Pazienti, le Dimissioni e le Richieste (solo la pagina del paziente,
      // non la lista del PS, che porta l'episodio del primo in elenco)
      if (panel.episodeId && (panel.entry.labUrl || panel.entry.radioUrl)) leggiStatoPagina(panel.episodeId, document);
      // Se una riga di prelievo non si lascia leggere, il Registro lo dice
      // subito e con le sue parole: senza questo, un prelievo che non diventa
      // una colonna è indistinguibile da un prelievo che non esiste. Quando
      // sono tutte a posto non si scrive niente: la pagina si ricarica a ogni
      // click, e un Registro pieno di righe uguali non lo legge nessuno.
      const dp = diagPrelievi(document, location.href);
      const male = dp.filter((r) => !r.ok);
      if (male.length) {
        panel.log(`${now()}  ${male.length} righe di prelievo su ${dp.length} non si lasciano leggere:\n${
          dp.map((r) => `    ${r.ok ? "ok" : "✗ "} ${r.testo}`).join("\n")}`);
      }
    }
    panel.restoreUi(); // same tab + same episode → quesito/selezione/vista tornano come prima
    // Quello che è stato deciso in sottofondo si dice sulla pagina dove il
    // medico atterra — che può essere il carrello, non solo quella del paziente.
    // Con la striscia si atterra come pill (un giro in sottofondo non apre mai
    // la finestra da solo); un errore porta con sé il resoconto, che si apre
    // con un tocco.
    const av = tabStore.get(AVVISO, null);
    if (av) {
      tabStore.set(AVVISO, null);
      if (Date.now() - (av.ts || 0) < CONFIRM_FLAG_TTL) {
        if (av.testo) panel.message = av.testo;
        if (av.giro) {
          panel.runState = av.giro.stato || "fail";
          panel.runPatient = av.giro.paziente || "";
          panel.runData = { steps: Array.isArray(av.giro.steps) ? av.giro.steps : [], added: [],
            lastListUrl: av.giro.listUrl || null, finishedListUrl: null };
          if (av.riprova && Array.isArray(av.riprova.mancanti)) panel.riprova = av.riprova;
          panel.mostraResoconto();
          panel.tieneDopoErrore = Array.isArray(av.giro.tiene) ? av.giro.tiene.map(String) : null;
        }
        if (av.striscia) {
          panel.collapsed = true; panel.striscia = av.striscia;
          // sul carrello di quella richiesta, «Riprova i mancanti» è un tocco anche sulla striscia
          if (panel.riprova && panel.riprovaQui()) panel.striscia = { ...av.striscia, testo: "riprova i mancanti",
            azione: { label: "Riprova i mancanti", titolo: "Manda solo gli esami mai partiti, su questa richiesta: quelli già in carrello non si rimandano", fn: () => panel.riprovaMancanti() } };
        }
        else panel.collapsed = false;
      }
    }
    panel.render();
    // La scheda di un ordine fermato col ⏹ mentre cambiava pagina: non
    // riprende, non conferma — lo dice alle altre e si slega.
    if (LAVORO && LAVORO.ferma) panel.fermaLavoro();
    // Un giro rimasto a metà viene prima di tutto: ha esami ancora da mandare,
    // e riprende da qualunque pagina del gestionale — anche da quella di un
    // altro paziente, perché le richieste portano il loro episodio con sé.
    const ripresa = riprendiCorsa(panel);
    let segue = false;   // (la conferma cliccata, o un carrello da rileggere: la pagina dopo dirà)
    // (un ordine in sottofondo di quel paziente lo racconta già la sua striscia)
    if (!ripresa && !LAVORO) avvisaGiroAbbandonato(panel, chi?.ordini || []);
    osservaScrittura();
    // (le richieste da confermare le ricordano le schede del medico, non quella di un ordine)
    if (!ripresa && !LAVORO) panel.sorvegliaConferme();
    if (chi) panel.ordiniAggiorna(chi.ordini || []);
    // la scheda di sottofondo appena aperta: l'ordine parte da qui
    if (LAVORO && LAVORO.stato === "avvio" && !ripresa) panel.avviaLavoro();
    if (pageType === "patient") {
      // this patient is now one the panel knows (name + episode + page only)
      // only a page that can actually order is a patient: the ER worklist
      // classifies the same way but its episode belongs to someone in the list
      // (la scheda di un ordine non è il medico che apre il paziente: niente «visto adesso»)
      if (panel.entry && (panel.entry.labUrl || panel.entry.radioUrl) && !LAVORO && !PONTE_VALORI) {
        const an = anagraficaPagina(document);
        rememberPatient(panel.episodeId, nomeInPagina(), location.href, triageDi(document), an.eta, an.sesso, improntaNascita(nascitaInPagina(document)));
        cartellaLettaQui(panel.episodeId);   // per il telefono: la cartella come la pagina l'ha caricata
        iconaCf(document);
        // Il portale clinico si apre da QUESTO link, sulla pagina di QUESTO
        // paziente: quel clic è l'identità, ed è esatta. Si annota qui, prima
        // che la scheda si apra, così di là la tabella sa di chi è senza
        // confrontare nomi e senza chiedere niente al server.
        document.addEventListener("click", (ev) => {
          const a = ev.target?.closest?.('a[href*="MODALITA=CLINICA"]');
          if (!a || !hasExt()) return;
          ask({ t: "apreStorico", ep: panel.episodeId || "", nome: panel.nomePaziente() || "" }).catch(() => {});
        }, true);
      }
      if (hasExt()) ask({ t: "portale" }).then((r) => {
        if (r && r.ok && r.origine) { panel.portale = r.origine; panel.render(); }
      }).catch(() => {});
      panel.applyAfterNav();
      panel.pinControlla();   // (arrivati dall'indirizzo di un pin: è lui?)
      panel.pinCarica();      // (i pin «Da rivedere»: letti una volta all'avvio, mai a intervalli)
      const pending = nextQueued(findEpisodeId(document, location.href));
      panel.pending = pending; // a richiesta of this run still needs confirming
      // Il bottone che porta a termine la richiesta rimasta a metà (la
      // radiologia dopo il laboratorio) sta nelle Richieste: finché qualcosa
      // è in sospeso si atterra lì, non sugli Esiti.
      if (pending && panel.view === "esiti") panel.view = "richieste";
      panel.render();
      // il medico apre il paziente: quello che la pagina mostra e non è ancora qui si carica da sé
      // (mai nella scheda di un ordine, del ponte, di un giro ripreso o con una richiesta da confermare)
      const daSolo = !LAVORO && !PONTE_VALORI && !ripresa && !pending;
      // (i salvati li chiede già il caricamento da solo, se parte subito)
      if (!daSolo || panel.ordineInCorso()) panel.refreshRefCache();
      panel.caricaStorico();
      if (daSolo) panel.autoCarica({ esiti: panel.view === "esiti" }).catch(() => {});
      // e finché la pagina resta aperta ogni 10 minuti il laboratorio a metà si
      // ricontrolla (i referti no: salvati, non cambiano più) — ma solo mentre
      // la si guarda (tornandoci, se ne sono passati 10), e dopo due
      // ricontrolli senza niente di nuovo, basta: lo rifà aprire gli Esiti
      if (!LAVORO && !PONTE_VALORI && !TABELLONE) {
        let vuoti = 0, ultimo = Date.now();
        const ricontrolla = async () => {
          if (vuoti >= 2 || document.visibilityState !== "visible") return;
          if (!panel.esiti.some((e) => e.kind === "valori" && !e.storico)) return;
          ultimo = Date.now();
          const prima = panel.impValori();
          const r = await panel.autoCarica({ esiti: true }).catch(() => null);
          if (r && r.lab) vuoti = panel.impValori() === prima ? vuoti + 1 : 0;
        };
        setInterval(ricontrolla, PARZ_MS + 5e3);
        document.addEventListener("visibilitychange", () => { if (Date.now() - ultimo >= PARZ_MS) ricontrolla(); });
      }
      // (la scheda dei valori del ponte legge e basta: niente conferme né stampe da qui)
      if (PONTE_VALORI) { ponteValoriQui(panel); return; }
      if (ripresa) return;   // il giro ripreso arriva da sé a conferma e stampa
      if (pending) {
        // auto-continue once per richiesta; afterwards it is a button, so an
        // abandoned confirmation can never turn into a navigation loop
        if (pending.q.autoConfirm && !pending.next.nav) {
          goToQueued(pending, (u) => panel.vaiSeLibero(u, { ms: 0, striscia: { tag: "", testo: "Confermo la richiesta dopo…", tono: "run" } }));
          return;
        }
      } else {
        // nothing left to confirm → print everything at once
        maybeAutoPrint(panel);
      }
    } else {
      panel.render();
      if (PONTE_VALORI) ponteValoriQui(panel);   // non è la pagina del paziente: lo dice e basta
    }
    if (pageType === "exam") {
      const model = examModel(document, location.href);
      learnFrom(model);
      panel.render(); // pick up anything just learned
      armPrintOnConfirm(model, findEpisodeId(document, location.href)); // native Conferma → print handoff
      if (!ripresa) {   // prima si finisce di mandare gli esami
        let cliccato = maybeAutoConfirm(panel);
        const qui = model.richiestaId && model.listUrl(model.res);
        // Al carrello manca una riga che deve avere: si ricarica l'elenco
        // pulito (una lettura), e i controlli ripartono da capo; la striscia
        // che aspetta la conferma viaggia con la pagina.
        if (cliccato && cliccato.rileggi) {
          const s = panel.striscia;
          if (leggibilePagina(qui)) panel.vaiSeLibero(qui, { ms: cliccato.rileggi, striscia: s, prima: () => { if (s) tabStore.set(AVVISO, { ts: Date.now(), striscia: s }); } });
          else { tabStore.set("confirm.v1", null); cliccato = false; }
        }
        segue = !!cliccato;
        // si aspettava la conferma e un controllo ha detto di no: tocca al medico
        if (!cliccato && panel.striscia && panel.striscia.attesaConferma) {
          // (la Conferma non è partita: «Non partita», e la preme il medico)
          const sospesa = { tag: "Non partita", testo: "Controlla il carrello e premi tu Conferma", quesito: "un controllo prima della Conferma ha detto di no", tono: "err", paziente: panel.striscia.paziente || "" };
          // nella scheda di un ordine: lo si passa alle schede del medico
          if (LAVORO) {
            panel.consegnaLavoro({ tag: "Non partita", testo: "apri il carrello", tono: "err", quesito: "un controllo prima della Conferma ha detto di no" },
              leggibilePagina(qui) ? { url: qui, avviso: { striscia: sospesa, ...(typeof panel.message === "string" && panel.message ? { testo: panel.message } : {}) },
                receipt: tabStore.get("receipt.v1", null) } : null);
          } else panel.segnala(sospesa);
        }
      }
    }
    if (pageType === "crea") {
      // Mirror a quesito the server (triage) already filled in, so the panel
      // never suggests overwriting it.
      const pageQ = document.forms.namedItem("RICHIESTACrea")?.elements?.namedItem("QUESITO_DIAGNOSTICO");
      if (pageQ && pageQ.value.trim()) { panel._q = pageQ.value; panel.quesitoMio = false; panel.render(); }
    }
    // La scheda di un ordine che qui non ha più niente da fare: l'ordine non
    // resta «in corso» per sempre (vedi lavoroSenzaSeguito).
    if (LAVORO && LAVORO.stato !== "avvio" && !ripresa && !segue) lavoroSenzaSeguito(panel);
  }

  // ------------------------------------------------ la pill su ogni pagina
  // Le pagine del gestionale che non sono né il paziente, né una richiesta, né
  // il carrello (la dimissione, le terapie, le stampe, /sa4rcs/…): la pill,
  // per non perdere il pannello. Da qui non si ordina. Le schede di
  // sottofondo — un ordine o i suoi fogli, lo storico, un referto, la lista
  // smart, il ponte — restano senza: lo chiede al service worker, che lo sa
  // dal numero della scheda (una risposta che non arriva vale «nostra»).
  function vistaQui() {
    const via = () => { if (!document.getElementById("psassist-host")) bootVista(); };
    if (!hasExt()) { via(); return; }
    ask({ t: "schedaNostra" }).then((r) => { if (r && r.ok && r.nostra === false) via(); });
  }
  // Il paziente di una di queste pagine: l'episodio dell'indirizzo o, dove in
  // testa c'è il riquadro del paziente, quello dei suoi link — e solo se il
  // pannello lo conosce già. Una lista porta gli episodi di tanti e non ha il
  // riquadro: lì nessun paziente, il tabellone. Fuori da /sa4pso/ mai.
  function epVista(doc, url) {
    if (!IN_PSO) return "";
    const suo = param(url, "EPISODIO_ID") || "";
    const riq = riquadroPaziente(doc) ? findEpisodeIdInDoc(doc) || "" : "";
    if (suo && riq && suo !== riq) return "";   // l'indirizzo e la pagina non dicono lo stesso: nessuno
    const ep = suo || riq;
    return ep && tuttiPazienti().some((p) => p.ep === ep) ? ep : "";
  }
  function bootVista() {
    const panel = new Panel("vista");
    panel.episodeId = epVista(document, location.href) || null;
    panel.entry = { labUrl: null, radioUrl: null };
    // (PANNELLO resta vuoto: i comandi del telefono e del tabellone vanno,
    // come prima, alle schede del paziente e delle richieste)
    // (come sulle altre pagine: il reset da un'altra scheda, il tabellone che cambia)
    window.addEventListener("storage", (ev) => {
      if (ev.key !== NS + "reset.v1" || !ev.newValue || panel.giroQui()) return;
      azzeraScheda();
      panel.fermaAuto();
      panel.dimenticaTutto();
      panel.esiti = [];   // (qui gli esiti non vengono dalla pagina)
      panel.render();
    });
    window.addEventListener("storage", (ev) => {
      if (ev.key === NS + PROM || ev.key === NS + DF_GEN) return panel.promTick();   // un «Da fare» scritto in un'altra scheda: rifatto sul posto
      if (![NS + "patients.v1", NS + AREE, NS + SMART_SYNC, NS + DIMESSI, NS + STATO, NS + "refVisti.v1"].includes(ev.key)) return;   // (STATO: una scheda dietro ha riletto un paziente; refVisti: visti sul telefono)
      if (ev.key === NS + DIMESSI) panel.mostraDimessi();
      panel.aggiornaDaFuori();
    });
    panel.mostraDimessi(true);
    if (hasExt()) { panel.seguiStampa(); panel.seguiRec(); panel.seguiAggiorna(); panel.seguiForma(); }
    panel.restoreUi();
    panel.render();
    panel.caricaStorico();
  }

