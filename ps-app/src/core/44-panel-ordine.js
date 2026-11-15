//@frammento 44-panel-ordine.js — Panel (segue): L'ORDINE IN SOTTOFONDO (scheda dell'ordine e scheda del medico), righe degli ordini,
//@ Svuota e ricomincia, richiesta da confermare, Riprova, startPlan/runChain, validazione.
    // ================================================ L'ORDINE IN SOTTOFONDO
    // ---- nella scheda dell'ordine ------------------------------------------
    // Che cosa deve dire la striscia delle altre schede mentre il giro va: lo
    // stesso che dice la striscia di questa — chi, «esame 3 di 6», il passo —
    // e che cosa è già entrato, che cosa è partito, che cosa manca ancora.
    vistaLavoro() {
      const st = this.runData;
      const nomeDi = (x) => x.display || shortLabel(x.label);
      const m = this.message && typeof this.message === "object" ? this.message : {};
      let resto = null;
      if (Array.isArray(m.mancano) || Array.isArray(m.nel)) resto = { mancano: m.mancano || [], controllare: m.controllare || [], nel: m.nel || [] };
      else if (st) {
        const dentro = st.added || [];
        const fuori = (st.ordine || this.pianoGiro?.items || []).filter((x) => !dentro.includes(x) && !x.tolto);
        // mentre si svuota il carrello, niente è sicuro: tutto da controllare
        const forse = (x) => !!st.svuotando || x.inviato || x.soloVerifica;
        resto = { nel: dentro.map(nomeDi), controllare: fuori.filter(forse).map(nomeDi), mancano: fuori.filter((x) => !forse(x)).map(nomeDi) };
      }
      const dove = { ...(st?.richiestaId ? { rid: String(st.richiestaId) } : {}), ...(st?.lastListUrl ? { listUrl: st.lastListUrl } : {}), ...(resto ? { resto } : {}) };
      if (this.runState === "running") {
        const { badgeEsami, fase, passati, tot } = this.statoGiro();
        return { stato: "corre", vista: { badge: badgeEsami, testo: fase, tono: "run", ferma: true, prog: [passati, tot] }, ...dove };
      }
      // (finché l'ordine è in corso, il ⏹ c'è sempre: lo finisce, qualunque cosa stia aspettando)
      if (this.runState === "fail" && tabStore.get(CORSA, null)) return { stato: "corre", vista: { tag: "", testo: "riprendo da dov'ero…", tono: "warn", ferma: true }, ...dove };
      const s = this.striscia;
      if (s) return { stato: "corre", vista: { tag: s.tag || "", badge: s.badge || "", testo: s.testo || "", tono: s.tono || "run", quesito: s.quesito || "", ferma: true }, ...dove };
      return null;
    }
    // A che punto è, per le altre schede (a ogni ridisegno, solo se cambia).
    // La risposta porta il ⏹ che questa scheda non ha ricevuto direttamente.
    pubblicaLavoro() {
      if (!LAVORO || this._lavoroChiuso || !hasExt()) return this._annuncio;
      const v = this.vistaLavoro();
      if (!v) return this._annuncio;
      const firma = JSON.stringify(v);
      if (firma === this._ultimaVista) return this._annuncio;
      this._ultimaVista = firma;
      return (this._annuncio = ask({ t: "ordineAggiorna", id: LAVORO.id, ...v }).then((r) => { if (r && r.ferma) this.fermaLavoro(); return r; }));
    }
    // Prima di ogni invio il service worker deve sapere quale esame parte: se
    // questa scheda muore adesso, quell'esame è «da controllare», mai «non mandato».
    annunciaLavoro() { this.render(); return this.pubblicaLavoro(); }
    // L'ultima parola della scheda di un ordine: com'è finita e, se c'è da fare
    // a mano, il carrello da aprire con quello che la pagina deve dire. Va alle
    // schede del medico; poi questa scheda si slega (il service worker la
    // chiude, se il medico non la sta guardando proprio adesso).
    async consegnaLavoro(vista, consegna = null, stato = "avviso") {
      if (!LAVORO || this._lavoroChiuso) return false;   // l'ultima parola si dice una volta
      const v = this.vistaLavoro() || {};
      this._lavoroChiuso = true;
      const m = { t: "ordineAggiorna", id: LAVORO.id, stato, vista, ...(consegna ? { consegna } : {}), registro: registroLavoro(this),
        ...(v.resto ? { resto: v.resto } : {}), ...(v.rid ? { rid: v.rid } : {}), ...(v.listUrl ? { listUrl: v.listUrl } : {}) };
      // il service worker che si sta svegliando può perdere la prima: una volta ancora
      if ((await ask(m)).perso) await ask(m);
      this.slegaLavoro();
      return true;
    }
    // L'ordine è finito: da qui è una scheda qualunque, e del giro non tiene
    // niente — l'esito lo mostra la striscia, come in tutte le altre.
    slegaLavoro() {
      if (!LAVORO) return;
      LAVORO = null;
      if (this.runState === "running") this.stop();
      this.dimenticaErrore();
      this.runPatient = null; this._firmaOrdine = "";
      this.stripOrdine();
      this.render();
    }
    // ⏹ dalla scheda del medico. Il giro che manda si ferma; una conferma
    // automatica non ancora cliccata non parte; un giro che stava per
    // riprendere non riprende. Quello che è già andato (la Conferma premuta)
    // non si ferma più: allora si dice di no, il fermo resta segnato al
    // service worker, e la prova o le etichette arrivano da sé. In ogni altro
    // caso l'ordine finisce qui: la coda non aspetta una scheda ferma.
    fermaLavoro() {
      if (!LAVORO) return false;
      if (this.runState === "running") { this.stop(); return true; }
      if (confermaPartita()) return false;   // la prova, o le etichette, arrivano da sé (lavoroSenzaSeguito)
      const c = tabStore.get(CORSA, null);
      const armata = !!tabStore.get("confirm.v1", null);
      clearTimeout(this._tRiprendi); clearTimeout(this._tVai);
      tabStore.set(CORSA, null);
      tabStore.set("confirm.v1", null);
      if (c) store.set(APERTA, null);   // fermato: lo dice la striscia del medico
      // fermato prima che la Conferma partisse: non resta «da confermare»
      // (lo dice una volta la striscia, qui sotto: «se non parte, ignoralo»)
      if ((c || armata) && ridLavoro()) confermataProvata(ridLavoro());
      this.log(`${now()}  ⏹ dalla scheda del medico: ${c ? "il giro non riprende" : armata ? "la conferma automatica non parte" : "l'ordine finisce qui"}`);
      // (che cosa manca e che cosa è da controllare lo sa già il service worker: l'ultima parola prima della pagina)
      const u = [c && c.listUrl, LAVORO.listUrl].find(leggibilePagina);
      this.consegnaLavoro({ tag: "Non partita", testo: "apri il carrello", tono: "err", quesito: c ? "fermato col ⏹ fra una pagina e l'altra" : "fermato col ⏹ prima della Conferma" },
        u ? { url: u } : null, "interrotto");
      return true;
    }
    // La scheda di sottofondo è appena nata: si controlla che sia la pagina
    // giusta (lo stesso episodio, il link per la richiesta, o il carrello di
    // quella richiesta), si dice al service worker «parto» — una volta sola,
    // anche se la pagina si ricarica — e si fa girare il motore di sempre.
    async avviaLavoro() {
      const L = LAVORO, p = L && L.piano;
      const no = (testo) => this.consegnaLavoro({ tag: "Non partita", testo: "niente inviato: riprova", tono: "err", quesito: testo }, null, "errore");
      if (!p || !Array.isArray(p.items) || !p.items.length) return no("L'ordine non è arrivato a questa scheda: niente inviato");
      if (!this.episodeId || this.episodeId !== String(p.episodeId)) return no("La scheda ha aperto un altro paziente: niente inviato");
      if (p.startPage === "riconferma") return this.riconfermaLavoro(L, p);
      let base;
      if (p.startPage === "patient") {
        const entry = this.pageType === "patient" ? (p.kind === "radio" ? this.entry?.radioUrl : this.entry?.labUrl) : "";
        // (nessuna Richiesta sulla pagina: così la mostra il gestionale messo su
        // un'area che non è quella del paziente — si dice su quale è)
        const area = !entry && this.pageType === "patient" && !this.entry?.labUrl && !this.entry?.radioUrl ? areaInTesta(document) : null;
        // Il paziente sta in un'altra area, e si sa quale (la lista della sua
        // area, la smart): questa scheda ci passa il gestionale, come il medico
        // a mano, e poi riapre la sua pagina (lavoroAreaQui) — una volta per
        // ordine. Mai un'area indovinata, mai sopra il passaggio d'area di una
        // scheda del medico. (Cambia l'area anche per le sue schede: lo dicono
        // la striscia, «passo all'area …», e l'esito.)
        const giro = tabStore.get(LAVORO_AREA, null), passato = giro && giro.id === L.id ? giro : null;
        if (area && passato) {
          return no(passato.fatto && area.k === passato.k ? `Le Richieste non ci sono nemmeno sull'area ${passato.area}: niente inviato`
            : `Non sono riuscito a passare il gestionale all'area ${passato.area}: niente inviato`);
        }
        const kp = area ? areeLeggi().membri[String(p.episodeId)]?.k : "", vai = store.get(AREA_VAI, null);
        const torna = [L.url, p.patientUrl].find((u) => leggibilePagina(u) && param(u, "EPISODIO_ID") === String(p.episodeId));
        if (kp && kp !== area.k && torna && !(vai && Date.now() - (vai.ts || 0) <= AREA_VAI_MS)) {
          const nome = titoloArea(kp, (store.get(AREE_OPZ, {}) || {})[kp]?.label || areeLeggi().viste[kp]?.label);
          if (tabStore.set(LAVORO_AREA, { id: L.id, k: kp, area: nome, torna, ts: Date.now() })) {
            this.log(`${now()}  il gestionale è sull'area ${titoloArea(area.k, area.label)}, ${p.patientName || "il paziente"} nell'area ${nome}: passo all'area ${nome} (Imposta → Conferma), poi riapro la sua pagina`);
            const m = { t: "ordineAggiorna", id: L.id, vista: { tag: "Parte", testo: `passo all'area ${nome}…`, tono: "run" } };
            let r = await ask(m);
            if (r.perso) r = await ask(m);
            if (r.ok && LAVORO === L) nav(urlMenu("PsoPsoImposta"));   // (se no: l'ordine è già finito, ⏹)
            return;
          }
        }
        if (area) return no(`Sulla pagina del paziente il gestionale non mostra le Richieste: è sull'area ${AREE_TITOLO[area.k] || area.label}, è quella del paziente? Niente inviato`);
        if (!entry) return no("Sulla pagina del paziente manca il link della richiesta: niente inviato");
        if (passato) this.log(`${now()}  gestionale sull'area ${passato.area}: le Richieste ci sono, l'ordine parte`);
        base = { ...p, entryUrl: entry };
      } else {
        const rid = String(p.richiestaId || param(L.url, "RICHIESTA_ID") || "");
        if (this.pageType !== "exam" || !rid || param(location.href, "RICHIESTA_ID") !== rid) return no("La scheda non ha aperto il carrello della richiesta: niente inviato");
        base = p.startPage === "exam" ? { ...p, examDoc: document, examUrl: location.href } : { ...p };
      }
      const r = await ask({ t: "ordineParto", id: L.id });
      if (!r || !r.ok) return;   // già partita (la pagina si è ricaricata: il giro va avanti da sé), o fermata
      this.log(`${now()}  ── scheda di sottofondo: l'ordine per ${p.patientName || "il paziente"} parte da qui ──`);
      this.startPlan({ ...base, dalLavoro: true });
    }
    // «Conferma di nuovo» (ordineRiconferma, bg.js): la Conferma che il
    // gestionale non aveva preso, rifatta UNA volta, perché il medico l'ha
    // toccato. Sul carrello di quella richiesta: prima la pagina del paziente
    // (se la elenca, era confermata: niente si preme), poi la Conferma vera,
    // coi controlli di sempre — il carrello identico alla ricevuta, l'ultimo
    // esame col suo nome, il bottone del gestionale (maybeAutoConfirm). Poi la
    // stessa prova (lavoroSenzaSeguito, alla pagina dopo). Un no: il carrello.
    async riconfermaLavoro(L, p) {
      const rid = String(p.richiestaId || ""), ep = String(p.episodeId || "");
      const m = examModel(document, location.href);
      const alCarrello = (perche) => this.consegnaLavoro({ tag: "Non partita", testo: "apri il carrello", tono: "err", quesito: perche },
        leggibilePagina(p.listUrl) ? { url: p.listUrl, avviso: { striscia: { paziente: p.patientName || "", tag: "Non partita", testo: "Controlla il carrello e premi tu Conferma", tono: "err" } },
          receipt: tabStore.get("receipt.v1", null) } : null, "avviso");
      if (this.pageType !== "exam" || !rid || String(m.richiestaId) !== rid) {
        return this.consegnaLavoro({ tag: "Non partita", testo: "apri il carrello", tono: "err", quesito: "la scheda non ha aperto il carrello della richiesta: niente premuto" }, null, "avviso");
      }
      const r = await ask({ t: "ordineParto", id: L.id });
      if (!r || !r.ok) return;
      this.log(`${now()}  ── «Conferma di nuovo» per ${p.patientName || "il paziente"}: richiesta ${rid}, una volta ──`);
      this.segnala({ tag: "", testo: "Confermo di nuovo…", tono: "run" });
      // Non più fra le «da confermare»: provata intanto altrove, o tolta senza
      // prova («Ignora», «Svuota», una pagina che la elencava, le 12 ore).
      // Da qui niente si preme: se la pagina del paziente non la elenca, il carrello.
      const fuori = !daConfermare().some((x) => x.rid === rid);
      // la ricevuta del giro di allora, senza la foto delle richieste di prima:
      // le richieste nate da allora sono altri ordini, non si stampano con questa
      const { prima, ...rc } = p.receipt || {};
      tabStore.set("receipt.v1", { ...rc, ts: Date.now() });
      if (!fuori) ricordaDaConfermare(rid, ep, p.listUrl || location.href, (rc.items || []).length);
      const gia = await provaConferma(rid, ep, { patientUrl: p.patientUrl || "", panel: this, una: true });
      if (LAVORO !== L || this._lavoroChiuso) return;
      if (gia && gia.doc) {
        // La pagina del paziente la elenca: era confermata, niente si preme.
        // Le sue etichette le ha già prese una scheda, dopo la Conferma che il
        // carrello aveva smentito (conferme.v1: chi l'ha confermata a mano) —
        // o le prenderà: un'altra Conferma premuta dopo quella, la sua scheda
        // ha la stampa di quel tocco (forse ancora in volo): niente si stampa,
        // la Ristampa resta in fondo alle sue Richieste. Se no — nessuno le ha
        // stampate: tolta da «Ignora», da una pagina che la elencava — si
        // stampano adesso, una volta.
        if (confermaDopo(rid, "stampata", p.premuta) || confermaDopo(rid, "premuta", p.premuta)) {
          this.log(`${now()}  la pagina del paziente la elenca, e le sue etichette le ${confermaDopo(rid, "stampata", p.premuta) ? "ha già prese" : "prende"} la scheda della Conferma: era già confermata — niente premuto, niente stampato`);
          ricordaStampe(ep, printModel(gia.doc, gia.url), { gesto: L.gesto || L.id, rid });
          return this.consegnaLavoro({ tag: "Confermata", testo: "era già confermata: Ristampa in fondo alle sue Richieste", tono: "ok" }, null, "avviso");
        }
        this.log(`${now()}  la pagina del paziente la elenca già: era confermata, niente si preme — le sue etichette`);
        segnoStampa(ep, rid, tabStore.get("receipt.v1", null));
        if (maybeAutoPrint(this, gia.doc, gia.url)) return;
        return this.consegnaLavoro({ tag: "Confermata", testo: "era già confermata", tono: "ok" }, null, "avviso");
      }
      if (fuori) return alCarrello("non risulta più da confermare: guarda le sue richieste — niente premuto");
      const items = Array.isArray(rc.items) ? rc.items : [];
      const last = items[items.length - 1];
      if (!last) return alCarrello("la ricevuta del giro non c'è più: niente premuto");
      // Il carrello che è qui adesso, subito prima di premere: ancora col SUO
      // Conferma e con tutti gli esami della ricevuta per questo erogatore. Se
      // no non è più quello di allora (un esame tolto, la richiesta passata):
      // niente si preme, decide il medico.
      const vivo = examModel(document, location.href);
      const nel = new Set((vivo.exams || []).filter((e) => e.isDel).map((e) => String(e.code)));
      const suoi = items.filter((i) => String(i.res) === String(vivo.res)).map((i) => String(i.code));
      if (String(vivo.richiestaId) !== rid || !vivo.confirmButton || !suoi.length || !suoi.every((c) => nel.has(c))) {
        this.log(`${now()}  il carrello non è più quello della ricevuta (${vivo.confirmButton ? "manca un esame" : "senza la sua Conferma"}): niente premuto`);
        return alCarrello("il carrello non è più quello della ricevuta: niente premuto");
      }
      // E proprio adesso: nessun'altra Conferma per questa richiesta dopo
      // quella che il carrello aveva smentito (`premuta`) — il medico sul suo
      // carrello, in un'altra scheda: forse in volo, e il carrello qui non lo
      // dice ancora (conferme.v1). Se sì, niente si preme: da controllare.
      if (confermaDopo(rid, "premuta", p.premuta)) {
        this.log(`${now()}  intanto è stata premuta un'altra Conferma per questa richiesta: niente premuto`);
        return this.consegnaLavoro({ tag: "Da controllare", testo: GUARDA, tono: "warn", quesito: "premuta intanto un'altra Conferma, da un'altra scheda: niente premuto da qui" },
          leggibilePagina(p.listUrl) ? { url: p.listUrl, avviso: { striscia: { paziente: p.patientName || "", tag: "Da controllare", testo: RIFARLA, tono: "warn" }, testo: RIFARLA_PERCHE },
            receipt: tabStore.get("receipt.v1", null) } : null, "avviso");
      }
      tabStore.set("confirm.v1", { richiestaId: rid, episodeId: ep, lastCode: last.code, lastLabel: last.label, count: items.length, ts: Date.now() });
      let cliccato = false;
      try { cliccato = maybeAutoConfirm(this); } catch (e) { this.log(`${now()}  conferma interrotta: ${e?.message || e}`); }
      if (cliccato === true) return;   // la pagina dopo dice com'è andata (lavoroSenzaSeguito)
      tabStore.set("confirm.v1", null);
      return alCarrello("un controllo prima della Conferma ha detto di no: niente premuto");
    }

    // ---- nella scheda del medico -------------------------------------------
    // Si può dare l'ordine a una scheda di sottofondo? Con l'estensione, un
    // giro solo (la coppia laboratorio + radiologia resta qui), e da una
    // pagina che si riapre così com'è: quella del paziente o il carrello
    // della richiesta — l'indirizzo da cui il motore partirebbe, mai uno
    // costruito. La pagina «Nuova richiesta» ha il suo modulo vivo: resta qui.
    urlLavoro(plan) {
      if (!hasExt() || LAVORO || !this.ordiniOk) return "";
      const ep = String(plan.episodeId || "");
      const ok = (u) => (leggibilePagina(u) && param(u, "EPISODIO_ID") === ep ? u : "");
      if (plan.startPage === "patient") return urlPaziente(ep, plan.patientUrl);
      if (plan.startPage === "exam") {
        const m = examModel(plan.examDoc || document, plan.examUrl || location.href);
        return m.richiestaId ? ok(m.listUrl(m.res)) : "";
      }
      if (plan.startPage === "carrello") return ok(plan.listUrl);
      return "";
    }
    // (true: l'ordine è dato; `ripiego`: che cosa fare qui se nessuna scheda di sottofondo lo prende)
    async delega(plan, url, ripiego = () => runPlan(plan, this)) {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const pulito = (i) => ({ res: i.res, code: i.code, label: i.label, display: i.display || i.label,
        ...(i.chiave ? { chiave: i.chiave } : {}), ...(i.resCat ? { resCat: i.resCat } : {}), ...(i.alPostoDi ? { alPostoDi: i.alPostoDi } : {}),
        ...(i.soloVerifica ? { soloVerifica: true } : {}), ...(i.giaFatto ? { giaFatto: true } : {}) });
      const n = plan.items.length;
      const piano = {
        startPage: plan.startPage, items: plan.items.map(pulito), quesito: plan.quesito || "", quesitoMio: !!plan.quesitoMio,
        autoConfirm: !!plan.autoConfirm, episodeId: plan.episodeId, patientName: plan.patientName || "",
        patientUrl: plan.startPage === "patient" ? url : plan.patientUrl || "",
        kind: plan.legs && plan.legs[0] ? plan.legs[0].kind : "",
        ...(plan.richiestaId ? { richiestaId: String(plan.richiestaId) } : {}),
        ...(plan.daControllare ? { daControllare: plan.daControllare.map(pulito) } : {}),
        ...(plan.svuota ? { svuota: true } : {}), ...(plan.listUrl ? { listUrl: plan.listUrl } : {}),
        ...(plan.originali ? { originali: plan.originali.map(pulito) } : {}), ...(plan.nostri ? { nostri: plan.nostri.map(pulito) } : {}),
        ...(plan.qinfo ? { qinfo: plan.qinfo } : {}), ...(plan.ritentato ? { ritentato: true } : {}),
      };
      const chi = plan.patientName || "";
      this._delegando = true;
      this.message = null;
      // (il pannello resta com'è: aperto, la striscia è il chip in intestazione)
      this.segnala({ paziente: chi, badge: n === 1 ? "1 esame" : `${n} esami`, testo: "Apro la scheda dell'ordine…", tono: "run", daOrdine: true });
      const job = { id, ep: String(plan.episodeId), paziente: chi, n, autoConfirm: !!plan.autoConfirm, url,
        rid: plan.richiestaId || param(url, "RICHIESTA_ID") || null, nomi: plan.items.map((i) => i.display || shortLabel(i.label)), piano,
        gesto: plan.gesto || id };   // (gli ordini dello stesso tocco su Conferma: un esito, una Ristampa)
      // Una risposta persa (il service worker che si sveglia) si richiede con
      // lo stesso numero: il service worker lo riconosce, l'ordine è uno.
      let r = { ok: false };
      for (let k = 0; k < 3 && !r.ok && !r.no; k++) r = await ask({ t: "ordineNuovo", job });
      this._delegando = false;
      if (r.ok) {
        this.log(`${now()}  ordine di ${n} ${n === 1 ? "esame" : "esami"} per ${chi || "il paziente"} dato a una scheda di sottofondo${r.coda ? ", in coda" : ""}`);
        // l'ordine è partito: la selezione qui riparte pulita
        if (!plan.episodeId || plan.episodeId === this.episodeId) this.clearOrderUi();
        this.ordiniAggiorna(r.ordini || this.ordini);
        this.render();
        return true;
      }
      if (!r.no) {
        // il service worker non risponde: non si sa, e da qui non si manda niente
        this.segnala({ tag: "Da controllare", testo: GUARDA, quesito: "PS Assist non ha risposto: non so se l'ordine è partito", tono: "warn", paziente: chi,
          onStop: () => this.segnala(null) });
        return false;
      }
      // PS Assist si stava aggiornando: niente partito, e niente da mandare da qui (questa pagina sta per
      // perdere l'estensione: la pillola «Ricarica la pagina»)
      if (r.aggiorna) {
        this.log(`${now()}  ordine non partito: PS Assist si stava aggiornando`);
        this.segnala({ tag: "Non partita", testo: "niente inviato: ricarica la pagina e riprova", quesito: "PS Assist si stava aggiornando", tono: "err", paziente: chi,
          onStop: () => this.segnala(null) });
        return false;
      }
      // niente scheda di sottofondo (non si apre, o la pagina non va): l'ordine lo manda questa pagina, come sempre
      this.log(`${now()}  scheda di sottofondo non disponibile (${r.why || "?"}): mando da questa pagina`);
      if (this.striscia && this.striscia.daOrdine) this.segnala(null);
      ripiego();
      return false;
    }
    // Un giro che aspetta il suo turno (prendiMotore): lo dicono la striscia e il Registro.
    inCodaMotore(on, smart = false) {
      if (on) {
        // (`smart`: ad aspettare non è un altro ordine ma la lista dei pazienti, letta dietro)
        this.log(`${now()}  ${smart ? "la lista smart si sta leggendo" : "un altro motore sta mandando esami"}: aspetto il turno, poi parto`);
        this.segnala({ tag: "In coda", testo: smart ? "leggo la lista dei pazienti, un attimo" : "un altro ordine sta mandando esami: parto appena ha finito", tono: "run", paziente: this.runPatient || "", inCoda: true });
      } else if (this.striscia && this.striscia.inCoda) this.segnala(null);
    }
    // Laboratorio e radiologia (il pacchetto «Dolore toracico» porta l'RX):
    // due ordini in sottofondo, uno dopo l'altro — il laboratorio, poi la
    // radiologia col suo quesito —, come dal telefono (ponteOrdina). Questa
    // scheda non si ferma e non si sposta; le etichette escono in due giri.
    // Se la prima scheda di sottofondo non si apre, la catena di sempre, qui;
    // se non si apre la seconda, quella gamba qui.
    async delegaGambe(plan, url) {
      const gesto = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;   // (un tocco, un esito)
      for (const [i, leg] of plan.legs.entries()) {
        const gamba = { ...plan, gesto, legs: [leg], entryUrl: leg.entryUrl, items: leg.items, legLabel: leg.label,
          quesito: leg.quesito ?? plan.quesito, quesitoMio: leg.quesitoMio ?? plan.quesitoMio };
        if (!(await this.delega(gamba, url, i ? () => runPlan(gamba, this) : () => this.runChain(plan)))) return;
      }
    }
    // Gli ordini dal service worker. La scheda di un ordine guarda solo il
    // suo: finito, si slega; un ⏹ segnato, lo esegue. Le altre mostrano la striscia.
    ordiniAggiorna(l) {
      this.ordini = Array.isArray(l) ? l.filter((x) => x && x.id) : [];
      if (LAVORO) {
        const mio = this.ordini.find((x) => x.id === LAVORO.id);
        if (!mio || mio.worker == null) return this.slegaLavoro();   // (un ordine finito non ha più scheda)
        if (mio.ferma && !LAVORO.ferma) { LAVORO.ferma = true; this.fermaLavoro(); }
        return;
      }
      // un ordine «Da controllare» di questo paziente, e questa pagina che elenca la sua richiesta: la prova
      const ep = this.pageType === "patient" ? findEpisodeId(document, location.href) : "";
      if (ep && this.ordini.some((x) => String(x.ep) === ep && (x.pubblico || {}).titolo === "Da controllare" && !x.stampa)) {
        const qui = Object.keys(printModel(document, location.href));
        if (qui.length) ordiniProvati(ep, qui);
      }
      this.registriOrdini();
      this.stripOrdine();
      const w = this.root.querySelector("#bracciale");
      if (w) w.innerHTML = this.braccialeDentro();
    }
    // Il Registro della scheda di un ordine arriva con la sua ultima parola (la
    // scheda si chiude): si aggiunge, una volta, al Registro di quel paziente
    // in questa scheda — quello che «⧉ Copia» copia —, segnato come suo.
    registriOrdini() {
      const fatti = tabStore.get(REGISTRI, []) || [];
      const nuovi = this.ordini.filter((o) => Array.isArray(o.registro) && o.registro.length && o.ep && !fatti.includes(String(o.id)));
      if (!nuovi.length) return;
      for (const o of nuovi) {
        const righe = [`${now()}  ── il Registro della scheda dell'ordine ──`, ...o.registro.map((r) => `  » ${r}`)];
        if (String(o.ep) === String(this.episodeId || "")) { for (const r of righe) this.log(r); continue; }
        const k = "log." + o.ep, prima = tabStore.get(k, null);
        const lines = prima && Date.now() - (prima.ts || 0) < 2 * 3600e3 && Array.isArray(prima.lines) ? prima.lines : [];
        tabStore.set(k, { ts: Date.now(), lines: [...lines, ...righe].slice(-200) });
      }
      tabStore.set(REGISTRI, [...fatti, ...nuovi.map((o) => String(o.id))].slice(-30));
    }
    // Una striscia sola: la cosa più seria, e fra due pari la più nuova. Un
    // errore, poi un avviso da leggere (un carrello da confermare, una stampa
    // da controllare), le etichette pronte qui, quello che gira, la coda, le
    // etichette di un ordine dal telefono (aspettano un tocco, ma non coprono
    // il resto) e per ultimo un «Stampato», che dopo due minuti se ne va da
    // solo (la Ristampa resta nella sezione Stampa del paziente). Quanti
    // aspettano in coda, nel numerino. Le parole sono quelle dell'ordine
    // (`pubblico`, le scrive il service worker: le stesse sul telefono); qui ci
    // sono i bottoni. È solo una vista: non scrive niente (le azioni, sì).
    stripOrdine() {
      const tel = (x) => String(x.id).startsWith("tel");
      const grado = (x) => {
        const t = x.pubblico && x.pubblico.tono;
        return t === "err" ? 0 : x.stato === "stampa" ? (tel(x) ? 5 : 2) : t === "warn" ? 1
          : ["avvio", "corre", "stampo"].includes(x.stato) ? 3 : x.stato === "coda" ? 4 : 6;
      };
      const vivi = this.ordini.filter((x) => !x.visto && (grado(x) < 6 || Date.now() - (x.agg || 0) < OK_STRISCIA));
      // L'ordine che gira vince la striscia: gli avvisi di ordini finiti
      // (un errore, uno da guardare) intanto si piegano in un «!1» accanto —
      // un tocco li mostra (mostraPiegati), e finito l'ordine tornano loro.
      const gira = (x) => ["avvio", "corre", "stampo"].includes(x.stato);
      // Sulla pagina di UN ALTRO paziente un ordine finito non prende il posto
      // della sua pill: resta un segno piccolo («✓ ROSSI M.») dentro la pill, e
      // un tocco lo apre (_segnoAperto). Quello che gira, che è in coda o che
      // aspetta un tocco per le etichette resta una striscia: serve a chi guarda.
      const qui = this.epDiQuesta();
      if (this._segnoAperto && !this.ordini.some((x) => x.id === this._segnoAperto)) this._segnoAperto = null;
      const altrove = (x) => !!qui && !!x.ep && String(x.ep) !== String(qui) && !gira(x) && x.stato !== "coda" && x.stato !== "stampa" && x.id !== this._segnoAperto;
      const l = vivi.filter((x) => !altrove(x));
      const altri = vivi.filter(altrove).sort((a, b) => grado(a) - grado(b) || (b.agg || 0) - (a.agg || 0));
      const segnoDi = altri[0];
      // (✓ solo per un ordine «Confermata», o per una stampa che non è un ordine
      // — una ristampa, un consenso —: un carrello pronto, «solo carrello», non è fatto)
      const tonoSegno = (x) => {
        const p = x.pubblico || {};
        if (p.tono === "err" || p.tono === "warn") return p.tono;
        return (x.stampa && x.stampa.tag === "Stampa") || p.titolo === "Confermata" ? "ok" : "warn";
      };
      // («+N»: i tocchi su Conferma, non le richieste — un tocco con POC e RX è un ordine solo, come gestoDi)
      const tocchi = new Set(altri.map((x) => x.gesto || x.id)).size;
      const segno = segnoDi ? { id: segnoDi.id, chi: nomeCorto(segnoDi.paziente || ""), tono: tonoSegno(segnoDi), n: tocchi,
        titolo: [segnoDi.paziente, (segnoDi.pubblico || {}).titolo, (segnoDi.pubblico || {}).testo].filter(Boolean).join(" · ") + (tocchi > 1 ? ` (e altri ${tocchi - 1})` : "") } : null;
      this.segnaSegno(segno);
      const avviso = (x) => grado(x) <= 1 && !gira(x) && x.stato !== "stampa";
      if (this._mostraAvviso && !l.some((x) => x.id === this._mostraAvviso && avviso(x))) this._mostraAvviso = null;
      // (il segno toccato è la striscia: mai piegato, mai coperto da quello che
      // girava già. Un ordine partito DOPO il tocco vince lui, come sempre — il
      // suo ⏹ a vista —, e quello toccato si piega accanto: un tocco, e torna)
      const apertoX = this._segnoAperto ? l.find((x) => x.id === this._segnoAperto) : null;
      // (partito: quando ha lasciato la coda — non quando ci è entrato)
      const dopo = !!apertoX && l.some((x) => gira(x) && x !== apertoX && (x.partito || x.ts || 0) > (this._segnoApertoTs || 0));
      const aperto = apertoX && !dopo ? apertoX : null;
      const piegati = l.some(gira) ? l.filter((x) => x !== aperto && x.id !== this._mostraAvviso && (avviso(x) || x === apertoX)) : [];
      const fuoco = aperto || [...l].filter((x) => !piegati.includes(x)).sort((a, b) => grado(a) - grado(b) || (b.agg || 0) - (a.agg || 0))[0];
      clearTimeout(this._tOk);
      const scadono = [fuoco, segnoDi].filter((x) => x && grado(x) === 6).map((x) => OK_STRISCIA - (Date.now() - (x.agg || 0)) + 500);
      if (scadono.length) this._tOk = setTimeout(() => this.stripOrdine(), Math.min(...scadono));
      const mia = !!(this.striscia && this.striscia.daOrdine);
      if (!fuoco) {
        if (mia && !this._delegando) { this.segnala(null); this.sorvegliaConferme(); this.stripRicetta?.(); }
        return;
      }
      // questa scheda ha già la sua da dire: un giro suo, una stampa, un errore
      if (this.runState || (this.striscia && !mia && (this.striscia.daStampa || this.striscia.tono === "err"))) return;
      // (lo stesso tocco su Conferma, più richieste finite: una riga sola — gestoDi)
      const g = this.gestoDi(fuoco);
      const v = fuoco.vista || {}, p = g ? g.pubblico : fuoco.pubblico || {};
      const coda = l.filter((x) => x.stato === "coda" && x !== fuoco).length;
      const id = fuoco.id;
      // Un tocco sulla striscia apre il TUO pannello, come sempre: questa
      // scheda resta tua, anche per ordinare a un altro paziente. Le azioni
      // dell'ordine stanno nel bottoncino accanto.
      const alCarrello = fuoco.consegna || leggibilePagina(fuoco.listUrl)
        ? { azione: { label: "Apri il carrello", titolo: "Apre qui il carrello della richiesta, col resoconto (una lettura: niente si manda)", fn: () => this.ordineCarrello(fuoco) } } : {};
      const chiudi = g ? g.ids : [id];
      const letto = { onStop: () => { this.lettoOrdine(fuoco); Promise.all(chiudi.map((x) => ask({ t: "ordineChiudi", id: x }))).then((rs) => { const x = rs[rs.length - 1]; if (x && x.ordini) this.ordiniAggiorna(x.ordini); }); },
        titoloStop: "Chiudi l'avviso" };
      const ferma = { onStop: () => ask({ t: "ordineFerma", id }).then((x) => { if (x && x.tolto) ask({ t: "ordineControlla" }).then((y) => y && y.ordini && this.ordiniAggiorna(y.ordini)); }), ferma: true };
      // (la Ristampa — o «Stampa qui» — di un gesto: di ogni sua richiesta i fogli non usciti, una volta ciascuno)
      const stampaQui = (label, titolo, qui = false) => ({ azione: { label, titolo, fn: () => ask({ t: "ordineStampaQui", id: g && g.conStampa ? g.conStampa.id : id,
        ...(g ? { gruppo: g.ids } : {}), ...(qui ? { qui: true } : {}) }) } });
      // (un ordine per la stazione di stampa: quello che lei non ha stampato si stampa qui con un tocco, mai da solo)
      const sta = fuoco.dest === "stazione", nonUsciti = (fuoco.fogli || []).some((f) => f.stato !== "stampato" && f.stato !== "mandato" && f.stato !== "tolto");
      const quiTitolo = `Stampa qui, su questo PC, i fogli che ${fuoco.destNome || "la stazione"} non ha stampato`;
      const esami = (k) => (k === 1 ? "1 esame" : `${k} esami`);
      let s = { tag: p.titolo || "", testo: p.testo || "", tono: p.tono || "run", quesito: p.dettaglio || "" };
      if (fuoco.stato === "coda") s = { ...s, badge: esami(fuoco.n || 0), ...ferma, ferma: false, titoloStop: "Togli dalla coda" };
      else if (fuoco.stato === "avvio") s = { ...s, badge: esami(fuoco.n || 0), ...ferma };
      else if (fuoco.stato === "corre" && !fuoco.muto && !fuoco.ferma) {
        // il giro, come lo dice la sua scheda: chi e «esame 3 di 6» — il passo
        // («invio LIPASI», «controllo il carrello 2/3») resta nel pannello della
        // sua scheda: qui sarebbe una scritta che cambia ogni secondo nell'angolo dell'occhio
        const passo = Array.isArray(v.prog) && (v.tono || "run") === "run";   // (solo il giro che manda: le altre parole della sua scheda restano)
        s = { tag: v.tag || "", badge: v.badge || "", testo: passo ? "" : v.testo || "…", tono: v.tono || "run", quesito: v.quesito || "", ...(v.ferma ? ferma : {}) };
      } else if (fuoco.stato === "corre") s = { ...s, ...(fuoco.muto ? ferma : {}) };
      // la stampa dopo la conferma, senza dialogo: ⏹ ferma i fogli che restano
      else if (fuoco.stato === "stampo") s = { ...s, ...(fuoco.ferma ? {} : ferma) };
      else if (fuoco.stato === "stampa") {
        // Le etichette pronte. Sulla pagina di un altro paziente il dialogo
        // non si apre da solo, e un ordine dal telefono mai: un tocco le stampa.
        const altro = !!this.epDiQuesta() && this.epDiQuesta() !== String(fuoco.ep);
        if (altro && s.testo === "Etichette pronte") s.testo = `Etichette di ${nomeCorto(fuoco.paziente)} pronte`;
        if (fuoco.ferma) s.quesito = "⏹ arrivato tardi: era già confermata";
        // (✕: non si stampano — e lo dice anche al telefono, «NON stampate»)
        s = { ...s, ...(sta ? stampaQui("Stampa qui", quiTitolo, true) : stampaQui("Stampa", "Stampa adesso le etichette, in questa scheda")), titoloStop: "Annulla: non stamparle",
          onStop: () => ask({ t: "ordineChiudi", id }).then((x) => { if (x && x.ordini) this.ordiniAggiorna(x.ordini); }) };
      } else if (fuoco.stato === "avviso") {
        // (stampato senza dialogo: i fogli restano per «Ristampa», qui)
        const ristampa = !(g ? g.conStampa : fuoco.stampa) ? {} : sta && nonUsciti ? stampaQui("Stampa qui", quiTitolo, true)
          : stampaQui("Ristampa", sta ? `Stampa di nuovo i fogli, in ${fuoco.destNome || "Infermeria"}` : "Stampa di nuovo i fogli non usciti (o tutti, se sono usciti), in questa scheda");
        // (il gestionale non ha preso la Conferma: un tocco la rifà, una volta, sul suo carrello)
        const riconferma = v.riconferma ? { azione: { label: "Conferma di nuovo", titolo: "Il gestionale non ha preso la Conferma: la premo di nuovo, una volta, sul carrello di quella richiesta",
          fn: () => ask({ t: "ordineRiconferma", id }).then((x) => { if (x && x.ordini) this.ordiniAggiorna(x.ordini); }) } } : null;
        s = { ...s, ...(riconferma || (fuoco.consegna ? alCarrello : ristampa)), ...letto };
      } else s = { ...s, ...alCarrello, ...letto };   // errore, scheda chiusa, interrotto
      // La stazione non ha risposto quando l'ordine è nato: lo si dice subito, e
      // «Stampa qui» (un tocco: il consenso) manda le sue etichette a questo PC.
      if (["coda", "avvio", "corre"].includes(fuoco.stato) && fuoco.dest === "stazione" && fuoco.stazioneMuta) {
        const nome = fuoco.destNome || "Infermeria";
        if (!/non risponde: stampo qui/.test(s.quesito || "")) s.quesito = [`${nome} non risponde: stampo qui?`, s.quesito].filter(Boolean).join(" · ");
        s.azione = { label: "Stampa qui", titolo: `${nome} non risponde: le etichette di questo ordine le stampa questo PC`,
          fn: () => ask({ t: "ordineQui", id }).then(() => ask({ t: "ordineControlla" })).then((y) => y && y.ordini && this.ordiniAggiorna(y.ordini)) };
      }
      // (un ordine partito dal telefono lo dice: chi preleva va avvisato)
      if (tel(fuoco)) s.badge = s.badge ? `${s.badge} · dall'iPhone` : "dall'iPhone";
      s.paziente = fuoco.paziente || "";
      s.daOrdine = id;
      if (coda) s.badge = `${s.badge ? s.badge + " · " : ""}+${coda} in coda`;
      if (piegati.length) s.piegati = { n: piegati.length, err: piegati.some((x) => grado(x) === 0), id: piegati[0].id,
        chi: [...new Set(piegati.map((x) => nomeCorto(x.paziente)))].join(", ") };
      if (segno) s.segno = segno;   // (un ordine finito di un altro paziente, accanto alla striscia di questo: non sparisce)
      // sotto, una riga per foglio (e una per la richiesta che gira)
      const rg = this.righeOrdini(l, fuoco);
      if (rg.righe.length) s.righe = rg.righe;
      clearTimeout(this._tRighe);
      if (rg.prossima) this._tRighe = setTimeout(() => this.stripOrdine(), rg.prossima + 150);
      // la stessa striscia di prima, ancora lì: niente ridisegno
      const firma = JSON.stringify(s);
      if (mia && firma === this._firmaOrdine && this.striscia === this._strisciaOrdine) return;
      this._firmaOrdine = firma;
      this.segnala(s);
      this._strisciaOrdine = this.striscia;
    }
    // Un tocco su Conferma, un esito. Gli ordini nati dallo stesso gesto (una
    // richiesta per erogatore: POC, laboratorio, RX), finiti tutti, dicono una
    // riga sola: la parola peggiore (Non partita, poi Da controllare, poi
    // Confermata), coi conti sotto; e la loro Ristampa rifà i fogli di tutti.
    // Finché uno gira, la striscia è sua e gli altri sono righe sotto. Solo
    // una vista: niente si scrive.
    gestoDi(fuoco) {
      if (!fuoco || !fuoco.gesto) return null;
      const tutti = (this.ordini || []).filter((x) => x.gesto === fuoco.gesto && !x.visto);
      if (tutti.length < 2 || tutti.some((x) => !["avviso", "errore", "chiusa", "interrotto"].includes(x.stato))) return null;
      const peso = (x) => ({ err: 0, warn: 1, run: 2 }[(x.pubblico || {}).tono] ?? 3);
      const peggio = [...tutti].sort((a, b) => peso(a) - peso(b) || (b.agg || 0) - (a.agg || 0))[0];
      const pp = peggio.pubblico || {};
      const n = tutti.reduce((k, x) => k + (Number(x.n) || 0), 0);
      const quante = (t) => tutti.filter((x) => (x.pubblico || {}).titolo === t).length;
      const conti = [["Confermata", "confermata", "confermate"], ["Da controllare", "da controllare", "da controllare"], ["Non partita", "non partita", "non partite"]]
        .map(([t, s, pl]) => [quante(t), s, pl]).filter(([k]) => k);
      const misto = conti.length > 1 ? `: ${conti.map(([k, s, pl]) => `${k} ${k === 1 ? s : pl}`).join(", ")}` : "";
      // tutto stampato: dove, in una frase sola
      const fogli = tutti.flatMap((x) => x.fogli || []);
      const tuttoOk = tutti.every((x) => (x.pubblico || {}).tono === "ok" && (x.pubblico || {}).titolo === "Confermata");
      const su = tuttoOk && fogli.length && fogli.every((f) => f.stato === "stampato" || f.stato === "tolto")
        ? `Stampato ${fogli.every((f) => f.stazione) ? "in" : "su"} ${[...new Set(fogli.filter((f) => f.stato === "stampato").map((f) => f.stampante).filter(Boolean))].join(" e ") || "la stampante"}` : "";
      const testo = su || pp.testo || "";
      const dettaglio = [`${tutti.length} richieste, ${n === 1 ? "1 esame" : `${n} esami`}${misto}`, su ? "" : pp.dettaglio].filter(Boolean).join(" · ");
      return { ids: tutti.map((x) => x.id), conStampa: tutti.find((x) => x.stampa) || null, pubblico: { ...pp, testo, dettaglio } };
    }
    // Le righe sotto la striscia: una per la richiesta che gira («Richiesta ·
    // 3/6»), una per foglio («Et POC», «Fg RX»), ognuna con la sua barretta
    // (arriva → alla stampante → fatto) e il suo ✕ finché il foglio non è
    // dell'aiutante. Un foglio fatto se ne va dopo pochi secondi; uno non
    // uscito resta rosso, con «Ristampa». Solo una vista: le azioni le fa il
    // service worker (ordineTogliFoglio, ordineFerma, ordineStampaQui).
    // Una riga di un ALTRO paziente (non quello della striscia) porta il suo
    // cognome: il suo ✕ ferma il suo ordine, e deve dire di chi è.
    righeOrdini(l, fuoco = null) {
      const righe = [], ora = Date.now();
      let prossima = 0;
      for (const o of [...l].sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
        if (o.visto) continue;   // (✕ «Visto»: il giornale lo tiene, qui non si mostra più)
        const v = o.vista || {};
        const chi = o.kind === "radio" ? "RX" : o.kind === "lab" ? "Lab" : "";
        const suo = !fuoco || String(o.ep || "") === String(fuoco.ep || "") ? "" : cognomeTitolo(o.paziente) || (o.ep ? `ep. ${o.ep}` : "");
        const di = (r) => (suo ? { ...r, nome: `${suo} · ${r.nome}`, html: `<b class="pjchi">${esc(suo)}</b>${r.html}`, di: suo } : r);
        const metti = (r) => righe.push(di(r));
        if ((o.stato === "avvio" || (o.stato === "corre" && !o.muto)) && !o.ferma) {
          const [k, n] = Array.isArray(v.prog) ? v.prog : [0, o.n || 0];
          metti({ k: `r:${o.id}`, ...nomeRichiesta(chi, k, n), p: n ? Math.max(0.04, k / n) : 0.04,
            x: o.stato === "avvio" || v.ferma ? `f:${o.id}` : "", xt: o.stato === "avvio" || v.ferma ? `Ferma l'ordine${suo ? ` di ${suo}` : ""}` : "" });
        } else if (o.confermata) {
          // confermata (provata): verde, pochi secondi
          const resta = o.confermata + RIGA_FATTA - ora;
          if (resta > 0) {
            prossima = prossima ? Math.min(prossima, resta) : resta;
            metti({ k: `r:${o.id}`, ...nomeRichiesta(chi, o.n || 0, o.n || 0), p: 1, ok: true, ico: "fatto" });
          }
        }
        const fogli = Array.isArray(o.fogli) ? o.fogli : [];
        // (a ordine finito — anche a stampa interrotta — quello che aspettava non
        // parte più da solo: è «non uscito», con «Ristampa»; e il ✕ «Visto» lo
        // toglie dalla vista. Il ✕ «togli» solo mentre stampa: dopo non toglie niente)
        const finito = ["avviso", "errore", "chiusa", "interrotto"].includes(o.stato), visto = finito ? o.id : "";
        // l'etichetta anagrafica: N copie dello stesso foglio, una riga sola («Et anag ×3»)
        const brac = fogli.length && ((o.stampa && o.stampa.jobs) || []).every(braccialeJob);
        if (brac) {
          const vive = fogli.map((f, i) => ({ f, i })).filter(({ f }) => f.stato !== "tolto");
          if (!vive.length) continue;
          const st = (xs) => vive.filter(({ f }) => xs.includes(f.stato));
          const fatte = st(["stampato", "mandato"]), invio = st(["invio"]);
          const rotte = st(["fallito", "sconosciuto", ...(finito ? ["attesa", "prendo"] : [])]), presto = finito ? [] : st(["attesa", "prendo"]);
          const tutte = fatte.length === vive.length;
          // aspetta che escano le etichette di un ordine che stampa: barra vuota, la clessidra (✕ al passaggio)
          const attende = presto.length === vive.length && !!braccialeAspetta(l, o);
          if (tutte) {
            const resta = Math.max(...fatte.map(({ f }) => f.ts || o.agg || 0)) + RIGA_FATTA - ora;
            if (resta <= 0) continue;
            prossima = prossima ? Math.min(prossima, resta) : resta;
          }
          metti({ k: `${o.id}:b`, ...nomeFoglio("anag", vive.length), attende,
            p: tutte || rotte.length ? 1 : attende ? 0 : Math.max(0.04, (fatte.length + 0.7 * invio.length + 0.35 * st(["prendo"]).length) / vive.length),
            ok: tutte, err: !!rotte.length && !presto.length && !invio.length,
            x: !invio.length && presto.length && !fatte.length ? `t:${o.id}:${presto.map(({ i }) => i).join(",")}` : "",
            ico: invio.length ? "pulsa" : tutte ? "fatto" : "",
            rist: rotte.length && !presto.length && !invio.length && o.stato !== "stampo" && o.stampa ? o.id : "", riqui: o.dest === "stazione", v: rotte.length && !invio.length ? visto : "" });
          continue;
        }
        fogli.forEach((f, i) => {
          if (f.stato === "tolto") return;
          const fatto = f.stato === "stampato" || f.stato === "mandato";
          const rotto = f.stato === "fallito" || f.stato === "sconosciuto" || (finito && (f.stato === "attesa" || f.stato === "prendo"));
          if (fatto) {
            const resta = (f.ts || o.agg || 0) + RIGA_FATTA - ora;
            if (resta <= 0) return;
            prossima = prossima ? Math.min(prossima, resta) : resta;
          }
          metti({ k: `${o.id}:${i}`, ...(f.breve ? nomeFoglio(f.breve) : { nome: f.name || "", html: `${ICO[f.tipo === "etichette" ? "etichetta" : "foglio"]}` }),
            p: rotto ? 1 : { attesa: 0.04, prendo: 0.35, invio: 0.7 }[f.stato] ?? 1, ok: fatto, err: rotto,
            x: o.stato === "stampo" && (f.stato === "attesa" || f.stato === "prendo") ? `t:${o.id}:${i}` : "", ico: f.stato === "invio" ? "pulsa" : fatto ? "fatto" : "",
            rist: rotto && o.stato !== "stampo" && o.stampa ? o.id : "", riqui: o.dest === "stazione", v: rotto ? visto : "" });
        });
      }
      return { righe: righe.slice(0, 12), prossima };
    }
    righeHtml(righe) {
      if (!Array.isArray(righe) || !righe.length) return "";
      return `<div class="pjobs">${righe.map((r) => `
        <div class="pjob${r.ok ? " ok" : ""}${r.err ? " err" : ""}" data-riga="${esc(r.k)}">
          <span class="pjn" aria-label="${esc(r.nome)}" title="${esc(r.nome)}">${r.html != null ? r.html : esc(r.nome)}</span>${
            r.rist || r.v ? `<span class="pjaz">${r.rist ? `<button class="pjrist" data-pjrist="${esc(r.rist)}"${r.riqui ? ' data-pjqui="1" title="Stampa qui, su questo PC, quello che la stazione non ha stampato"' : ""}>${r.riqui ? "Stampa qui" : "Ristampa"}</button>` : ""}${
              r.v ? `<button class="pjx" data-pjx="v:${esc(r.v)}" title="Visto: togli" aria-label="${esc(`Visto: togli ${r.nome}`)}">✕</button>` : ""}</span>`
            : r.ico === "pulsa" ? `<span class="pjico pulsa" title="Alla stampante">${ICO.stampante}</span>`
            : r.ico === "fatto" ? `<span class="pjico fatto" title="Fatto">✓</span>`
            : r.x ? `<button class="pjx${r.attende ? " att" : ""}" data-pjx="${esc(r.x)}" title="${esc(r.attende ? "Aspetta le etichette in stampa · togli" : r.xt || "Togli solo questo")}" aria-label="${esc(r.xt || `Togli ${r.nome}`)}">${r.attende ? `<span class="pjclx">⌛</span><span class="pjxx">✕</span>` : "✕"}</button>` : ""}
          <span class="pjbar"><i style="width:${Math.round(Math.min(1, r.p) * 100)}%"></i></span>
        </div>`).join("")}</div>`;
    }
    // «!1»: l'avviso piegato si mostra nella striscia (l'ordine che gira resta
    // nella sua riga, sotto, col suo ✕); chiuso o aperto, torna l'ordine.
    mostraPiegati() {
      const p = this.striscia && this.striscia.piegati;
      if (!p) return;
      this._mostraAvviso = p.id;
      this._firmaOrdine = "";
      this.stripOrdine();
    }
    // la richiesta che gira in questa scheda (la coppia laboratorio + radiologia)
    rigaGiro() {
      const { passati, tot } = this.statoGiro();
      const g = this.pianoGiro && this.pianoGiro.legLabel;
      return { k: "giro", ...nomeRichiesta(g === "radiologia" ? "RX" : /^laboratorio/.test(g || "") ? "Lab" : "", passati, tot), p: tot ? Math.max(0.04, passati / tot) : 0.04, x: "giro" };
    }
    // ✕ su una riga: quella sola
    rigaTocco(x) {
      const [k, id, i] = String(x).split(":");
      const dopo = (r) => { if (r && r.ordini) this.ordiniAggiorna(r.ordini); else ask({ t: "ordineControlla" }).then((y) => y && y.ordini && this.ordiniAggiorna(y.ordini)); };
      if (k === "giro") return this.stop();
      if (k === "f") return ask({ t: "ordineFerma", id }).then(dopo);
      if (k === "v") return ask({ t: "ordineVisto", id }).then(dopo);
      // (l'etichetta anagrafica: tutte le sue copie che non sono ancora partite)
      if (k === "t") return Promise.all(String(i).split(",").map((n) => ask({ t: "ordineTogliFoglio", id, i: Number(n) }))).then((rs) => dopo(rs[rs.length - 1]));
    }
    // L'avviso di un ordine è letto (✕, o il carrello aperto): il segno
    // condiviso «giro rimasto a metà» di quella richiesta lo diceva già lui.
    lettoOrdine(o) {
      const a = store.get(APERTA, null);
      if (a && ((o.rid && String(a.rid || "") === String(o.rid)) || a.ep === o.ep)) store.set(APERTA, null);
    }
    // Il carrello della richiesta, in QUESTA scheda: una lettura, mai un
    // invio, col passaggio di consegne che la pagina deve mostrare (la
    // ricevuta, il resoconto e «Riprova»). L'avviso così è letto: via.
    ordineCarrello(o) {
      const c = o.consegna || null;
      const u = c && leggibilePagina(c.url) ? c.url : leggibilePagina(o.listUrl) ? o.listUrl : "";
      if (!u) return;
      if (c && c.avviso) tabStore.set(AVVISO, { ...c.avviso, ts: Date.now() });
      if (c && c.receipt) tabStore.set("receipt.v1", { ...c.receipt, ts: Date.now() });
      this.lettoOrdine(o);
      ask({ t: "ordineChiudi", id: o.id });
      nav(u);
    }

    // ---- «Svuota il carrello e ricomincia» ---------------------------------
    // Dopo un errore, sul carrello di QUELLA richiesta: si vuota il carrello
    // (col «Svuota carrello» del gestionale), si dimostra vuoto rileggendolo
    // dal server, e si rimette tutta la selezione di partenza — più quello che
    // nel carrello c'era già (aggiunto a mano, o da un giro di prima) — nella
    // stessa richiesta, come il primo giro: conferma e stampa, o solo carrello.
    svuotaQui() {
      const r = this.riprova;
      if (!r || this.runState !== "fail" || !r.rid || !(r.tutti || []).length || !r.nCarrello) return false;
      if (findEpisodeId(document, location.href) !== r.ep) return false;
      return this.pageType === "exam" && param(location.href, "RICHIESTA_ID") === r.rid;
    }
    // Il primo tocco legge il carrello vero, tutte le sezioni (solo letture),
    // e dice che cosa toglierà, per nome: «Svuoto 3 esami: EMOCROMO POC,
    // TROPONINA US, PCR?». Il secondo fa. Una riga che non si saprebbe
    // rimettere lo dice subito, e non si svuota.
    async svuotaChiedi() {
      const r = this.riprova;
      if (!this.svuotaQui() || this._svuota) return;
      const io = this._svuota = { testo: "Leggo il carrello…", legge: true };
      this.render();
      let fatto = { testo: "", ok: false };
      try {
        const { righe } = await leggiCarrello(examModel(document, location.href), { rid: r.rid, ep: r.ep });
        const { ignoti } = daRimettere(righe, r.tutti, [...(r.verdi || []), ...(r.controllare || [])]);
        const nomi = righe.map(nomeRiga);
        fatto = ignoti.length ? { testo: `Non svuoto: non saprei rimettere ${ignoti.map((x) => `«${x}»`).join(", ")}` }
          : !righe.length ? { testo: `Il carrello è vuoto: rimetto ${r.tutti.length === 1 ? "1 esame" : `${r.tutti.length} esami`}?`, ok: true }
            : { testo: `Svuoto ${nomi.length === 1 ? "1 esame" : `${nomi.length} esami`}: ${nomi.join(", ")}?`, ok: true };
      } catch (e) {
        fatto = { testo: `Non riesco a leggere il carrello: ${e?.head || e?.message || e}` };
      }
      if (this._svuota !== io) return;
      const ora = this._svuota = fatto;
      this.render();
      setTimeout(() => { if (this._svuota === ora) { this._svuota = null; this.render(); } }, 8000);
    }
    svuotaERicomincia() {
      const r = this.riprova;
      if (!this.svuotaQui()) return;
      const live = examModel(document, location.href);
      const listUrl = (live.richiestaId === r.rid && live.listUrl(live.res)) || r.listUrl;
      this.dimenticaErrore();
      this.log(`${now()}  ↺ svuoto il carrello della richiesta e rimetto la selezione: ${r.tutti.map((x) => x.display || shortLabel(x.label)).join(", ")}`);
      this.startPlan({
        startPage: "carrello", listUrl, richiestaId: r.rid, svuota: true,
        autoConfirm: r.autoConfirm, patientName: r.paziente, patientUrl: r.patientUrl,
        ...(r.qinfo ? { qinfo: r.qinfo } : {}),
        originali: r.tutti.map((x) => ({ ...x })),
        items: r.tutti.map((x) => ({ ...x })),
        // con quale codice sono entrati quelli di questo giro (un riflesso ne cambia il numero)
        nostri: [...(r.verdi || []), ...(r.controllare || [])].map((x) => ({ ...x })),
      });
    }
    // ---- La richiesta ancora da confermare, sul suo carrello ----------------
    // Riaperta più tardi (dopo «Chiudi», un ricarico, da un'altra scheda) la
    // richiesta non ha più né la ricevuta né il resoconto di un errore: la sua
    // riga ha «Conferma e stampa» e «Svuota», a due tocchi come «Svuota il
    // carrello e ricomincia». Il primo legge il carrello vero, tutte le
    // sezioni (solo letture), e dice per nome che cosa farà; il secondo lo fa.
    // Solo se la pagina ha la Conferma del gestionale: senza, la richiesta è
    // forse già confermata, e il motore non svuoterebbe comunque.
    daConfQui() {
      if (this.pageType !== "exam" || this.runState || this._delegando) return null;
      const rid = param(location.href, "RICHIESTA_ID"), ep = findEpisodeId(document, location.href);
      const live = examModel(document, location.href);
      if (!rid || !ep || String(live.richiestaId) !== rid || !live.confirmButton) return null;
      return nonConfermateQui().some((x) => x.rid === rid) ? { rid, ep, live } : null;
    }
    daConfAzioni() {
      const q = this.daConfQui();
      if (!q) return "";
      const a = confermaPannello ? { cosa: "conferma", testo: confermaPannello }
        : this._daconf && this._daconf.rid === q.rid && !this._daconf.vuoto ? this._daconf : null;
      const titoli = {
        dcconferma: "Preme la Conferma del gestionale per questa richiesta, poi parte la stampa. Il primo tocco legge il carrello e dice che cosa conferma",
        dcsvuota: "Toglie dal carrello tutti gli esami di questa richiesta col «Svuota carrello» del gestionale, controlla che sia vuoto e la dimentica. Il primo tocco legge il carrello e dice che cosa toglie",
      };
      const lnk = (id, testo, cls = "") => `<button class="lnk${cls}" id="${id}" title="${esc(titoli[id])}"${a && !a.ok ? " disabled" : ""}>${esc(testo)}</button>`;
      // armata (o mentre legge), l'altra si toglie di mezzo: la domanda sta da sola
      if (a) return `<span class="dcaz">${lnk(a.cosa === "conferma" ? "dcconferma" : "dcsvuota", a.testo, ` chiede${a.cosa === "svuota" ? " via" : ""}`)}</span>`;
      return `<span class="dcaz">${lnk("dcconferma", "Conferma e stampa")}${lnk("dcsvuota", "Svuota")}</span>`;
    }
    async daConfTocco(cosa) {
      if (confermaPannello) return;   // premuta, o già partita altrove: niente altro da questa pagina
      const a = this._daconf;
      if (a && a.cosa === cosa && a.ok) return cosa === "conferma" ? this.daConfConferma(a) : this.daConfSvuota(a);
      if (a && !a.vuoto) return;   // legge, o ha detto di no: si aspetta che torni a capo
      const q = this.daConfQui();
      if (!q) return;
      if (cosa === "conferma" && this.confermaGiaPartita(q.rid)) return;
      const io = this._daconf = { rid: q.rid, cosa, testo: "Leggo il carrello…" };
      this.render();
      let fatto;
      try {
        const nomi = (await leggiCarrello(q.live, { rid: q.rid, ep: q.ep })).righe.map(nomeRiga);
        const conto = nomi.length === 1 ? "1 esame" : `${nomi.length} esami`;
        // la pagina del paziente: il motore la legge prima di svuotare (che non sia confermata)
        const pu = [(tuttiPazienti().find((p) => p.ep === q.ep) || {}).url].find(leggibilePagina);
        if (!nomi.length) {
          // vuoto, riletto dal server: niente da confermare, il promemoria non serve più
          confermataProvata(q.rid);
          this.log(`${now()}  la richiesta da confermare ha il carrello vuoto: non la sorveglio più`);
          fatto = { testo: "Il carrello è vuoto: niente da confermare", vuoto: true };
        } else if (cosa === "svuota" && !pu) fatto = { testo: "Non svuoto: apri prima la pagina del paziente" };
        else fatto = { testo: `${cosa === "conferma" ? "Confermo" : "Svuoto"} ${conto}: ${nomi.join(", ")}?`, ok: true, nomi, pu };
      } catch (e) {
        fatto = { testo: `Non riesco a leggere il carrello: ${e?.head || e?.message || e}` };
      }
      if (this._daconf !== io) return;
      const ora = this._daconf = { ...io, ...fatto };
      this.render();
      setTimeout(() => { if (this._daconf === ora) { this._daconf = null; this.render(); } }, 8000);
    }
    // Una Conferma per questa richiesta premuta nell'ultimo minuto, da
    // qualunque scheda (conferme.v1), e ancora senza prova (fra quelle da
    // confermare): forse in volo, e il carrello qui non lo dice ancora. I due
    // bottoni non premono: lo dicono, finché la pagina non se ne va. Una
    // Conferma che il carrello ha già smentito («smentita»: non presa) non è in volo.
    confermaGiaPartita(rid) {
      const smentita = Number((conferme().find((x) => x.rid === String(rid)) || {}).smentita) || 0;
      if (!confermaDopo(rid, "premuta", Math.max(Date.now() - 60e3, smentita)) || !daConfermare().some((x) => x.rid === String(rid))) return false;
      confermaPannello = "Una Conferma è già partita: guarda le sue richieste";
      this._daconf = null;
      this.log(`${now()}  Conferma dal pannello non premuta: un'altra per la richiesta ${rid} è partita nell'ultimo minuto`);
      this.render();
      return true;
    }
    // «Confermo 1 esame: PCR?» — sì: il clic vero sulla Conferma della pagina,
    // come quello della ricevuta. La richiesta è di PS Assist (è fra quelle da
    // confermare), quindi il gancio sul bottone arma la stampa.
    daConfConferma(a) {
      if (confermaPannello) return;
      const q = this.daConfQui();
      if (!q || q.rid !== a.rid) { this._daconf = null; this.render(); return; }
      if (this.confermaGiaPartita(q.rid)) return;
      // (la pagina se ne va col modulo; finché resta, la riga dice «Confermo…» e
      // non torna a capo: la Conferma può essere ancora in volo)
      confermaPannello = "Confermo…";
      this._daconf = null;
      this.render();
      this.log(`${now()}  conferma della richiesta rimasta da confermare: ${a.nomi.length} ${a.nomi.length === 1 ? "esame" : "esami"} · ${a.nomi.join(" · ")} · click nativo su Conferma`);
      tabStore.set(PREMUTO, Date.now());   // (la Conferma è sua)
      q.live.confirmButton.click();
      // quanti esami: qui non c'è ricevuta, lo dice la lettura del primo tocco
      const p = tabStore.get("print.v1", null);
      if (p && (p.ids || []).includes(q.rid)) tabStore.set("print.v1", { ...p, n: { ...(p.n || {}), [q.rid]: a.nomi.length } });
    }
    // «Svuoto 1 esame: PCR?» — sì: il motore di «Svuota il carrello e
    // ricomincia», con niente da rimettere. Gira in questa scheda (è corto, e
    // non si riprende): provato vuoto, la richiesta si dimentica.
    daConfSvuota(a) {
      const q = this.daConfQui();
      this._daconf = null;
      if (!q || q.rid !== a.rid) { this.render(); return; }
      this.log(`${now()}  ↺ svuoto il carrello della richiesta rimasta da confermare: ${a.nomi.join(", ")} — niente da rimettere`);
      this.startPlan({ startPage: "carrello", listUrl: q.live.listUrl(q.live.res), richiestaId: q.rid,
        svuota: true, soloSvuota: true, items: [], autoConfirm: false, patientUrl: a.pu });
    }

    // «↻ Riprova i mancanti» si mostra solo dov'è sicuro: sul carrello di
    // QUELLA richiesta (il motore rilegge il carrello dal server: quelli già
    // entrati li ritrova e non li rimanda), o sulla pagina del paziente se la
    // richiesta non era ancora nata. Altrove si apre prima il carrello.
    riprovaQui() {
      const r = this.riprova;
      if (!r || this.runState !== "fail" || !(r.mancanti || []).length) return false;
      if (findEpisodeId(document, location.href) !== r.ep) return false;
      if (r.rid) return this.pageType === "exam" && param(location.href, "RICHIESTA_ID") === r.rid;
      return this.pageType === "patient" && !!(this.entry && (this.entry.labUrl || this.entry.radioUrl));
    }
    // (daSolo: l'elenco del carrello da cui ritenta il giro stesso, una volta)
    riprovaMancanti(daSolo = "") {
      const r = this.riprova;
      if (!daSolo && !this.riprovaQui()) return;
      this.dimenticaErrore();
      // senza richiesta: un giro normale, col quesito e gli esami del pannello
      if (!r.rid) { this.view = "richieste"; this.launch(r.autoConfirm); return; }
      const nomi = (l) => l.map((x) => x.display || shortLabel(x.label)).join(", ");
      const fuori = r.controllare || [];
      this.startPlan({
        ...(daSolo ? { startPage: "carrello", listUrl: daSolo } : { startPage: "exam", examDoc: document, examUrl: location.href }),
        richiestaId: r.rid, autoConfirm: r.autoConfirm, patientName: r.paziente, patientUrl: r.patientUrl,
        // quelli già in carrello si cercano soltanto: mai un secondo invio
        items: [...(r.verdi || []).map((x) => ({ ...x, soloVerifica: true, giaFatto: true })), ...r.mancanti.map((x) => ({ ...x }))],
        daControllare: fuori.map((x) => ({ ...x })),   // fuori dal giro, ma se va storto di nuovo restano in elenco
        ...(r.originali ? { originali: r.originali.map((x) => ({ ...x })) } : {}),   // per «Svuota», se si ferma ancora
        ...(r.qinfo ? { qinfo: r.qinfo } : {}),
        ...(daSolo || r.ritentato ? { ritentato: true } : {}), ...(LAVORO ? { dalLavoro: true } : {}), riprova: true,
      });
      this.log(`${now()}  ↻ riprovo ${daSolo ? "da solo, una volta, " : ""}i mancanti: ${nomi(r.mancanti)}${
        fuori.length ? ` — non rimando quelli da controllare: ${nomi(fuori)}` : ""}`);
    }
    // Via l'errore: la pill torna quella di sempre, e il passaggio di
    // consegne verso il carrello (e «Riprova») si dimentica.
    dimenticaErrore() {
      this.runState = null; this.runData = null; this.message = null;
      this.carrelloDaAprire = null; this.consegnaErrore = null; this.riprova = null;
      this.tieneDopoErrore = null; this._svuota = null;
      clearTimeout(this._tStriscia); this.striscia = null;
      tabStore.set(AVVISO, null);
    }
    // «Chiudi» (era «Annulla», ma non annullava niente): via il resoconto, la
    // pill torna quella di sempre, e si torna alle Richieste col quesito. La
    // richiesta rimasta a metà resta nel gestionale, ma il pannello non la
    // ricorda («se non parte l'ordine nel carrello, ignoralo»). Restano scelti
    // solo gli esami che mancano davvero — quelli già nel suo carrello non si
    // offrono di nuovo, così il conto sul bottone è quello vero.
    chiudiErrore() {
      const tiene = this.tieneDopoErrore;
      this.dimenticaErrore();
      this.restoreUi();
      if (Array.isArray(tiene)) {
        const resta = new Set(tiene);
        for (const k of [...this.selected.keys()]) if (!resta.has(k)) this.selected.delete(k);
        for (const k of [...this.pkgDa]) if (!this.selected.has(k)) this.pkgDa.delete(k);
      }
      // (sulla lista del PS, dove non si ordina, si resta sui Pazienti)
      this.view = this.defaultView() === "home" ? "home" : "richieste"; this.viewId = null;
      this.persistUi();
      this.render();
    }

    // ---- run starters ----
    startPlan(base) {
      if (extPersa()) return this.render();
      if (this.runState === "running" || this._delegando || this._motoreAtteso) return;
      if (!base.dalLavoro) tabStore.set(PREMUTO, Date.now());
      // La scheda di un ordine che gira fa solo quell'ordine: un altro, da
      // qui, si confonderebbe col suo (le etichette, l'esito).
      if (LAVORO && !base.dalLavoro) {
        this.message = `Questa scheda sta finendo l'ordine di ${LAVORO.paziente || "un paziente"}: aspetta un momento, o ordina da un'altra scheda.`;
        this.render();
        return;
      }
      // Copie: il motore traduce codici e risorse per la sede, e la selezione
      // del medico deve restare la sua (dopo un errore, «Chiudi» la ritrova).
      const items = base.items || [...this.selected.entries()].map(([k, i]) => ({ ...i, chiave: k }));
      if (!items.length && !base.soloSvuota) return;   // («Svuota» dalla riga non rimette niente)
      const episodeId = findEpisodeId(document, location.href);
      if (!episodeId) { // fail-closed: never order on an unidentifiable episode
        this.message = "Episodio non identificabile su questa pagina: usa la pagina nativa.";
        this.render();
        return;
      }
      this.log(`${now()}  ── nuova operazione ──`);
      this.message = null;
      tabStore.set("receipt.v1", null);
      // Pin the patient this run belongs to: the running/result views show
      // THIS name, never whatever the page title becomes later.
      this.runPatient = base.patientName || nomeInPagina();
      const plan = { quesito: (this._q || "").trim(), quesitoMio: !!this.quesitoMio, items, episodeId, patientName: this.runPatient, ...base,
        // la pagina che elenca le richieste confermate: serve a provare una conferma
        patientUrl: base.patientUrl || (this.pageType === "patient" ? location.href : ""),
        ...(this.pageType === "patient" && !base.prima ? { prima: fotoRichieste(document, location.href) } : {}) };
      if ((this._q || "").trim()) rememberQuesito((this._q || "").trim());
      // Laboratorio e radiologia: con l'estensione due ordini in sottofondo,
      // uno dopo l'altro (delegaGambe); senza, la catena qui (runChain).
      if (plan.legs && plan.legs.length > 1) {
        const dove = this.urlLavoro(plan);
        if (dove) this.delegaGambe(plan, dove);
        else this.runChain(plan);
        return;
      }
      // Con l'estensione il giro lo fa una scheda di sottofondo: questa resta
      // libera. Se la scheda non si apre, lo fa questa pagina, come sempre.
      // («Svuota» dalla riga di una richiesta da confermare resta qui: è corto,
      // e un ordine senza esami da mandare non è un ordine.)
      const dove = plan.soloSvuota ? "" : this.urlLavoro(plan);
      if (dove) this.delega(plan, dove);
      else runPlan(plan, this); // fire and forget; the engine drives the UI via callbacks
    }

    // Lab and radiology cannot share a richiesta, so when both are selected we
    // build them one after the other and then walk the doctor through both
    // confirmations (and one single print flow at the end). (Col bookmarklet,
    // o se la scheda di sottofondo non si apre: con l'estensione è delegaGambe.)
    async runChain(plan) {
      const done = [];
      for (let i = 0; i < plan.legs.length; i++) {
        const leg = plan.legs[i];
        const st = await runPlan({
          ...plan, hold: true, continuation: i > 0, legIndex: i,
          // (dalla pagina «Nuova richiesta»: la prima col suo modulo vivo, le altre se ne aprono una)
          ...(leg.startPage ? { startPage: leg.startPage } : {}),
          entryUrl: leg.entryUrl, items: leg.items, legLabel: leg.label,
          quesito: leg.quesito ?? plan.quesito, quesitoMio: leg.quesitoMio ?? plan.quesitoMio,
        }, this);
        if (this.runState !== "running" || !st || !st.richiestaId) return; // failed/stopped: stop here
        done.push({
          rid: st.richiestaId, listUrl: st.finishedListUrl || st.lastListUrl, kind: leg.kind,
          carrelli: st.carrelli || {},
          count: st.added.length,
          lastCode: st.added.length ? st.added[st.added.length - 1].code : null,
          lastLabel: st.added.length ? st.added[st.added.length - 1].label : null,
          added: st.added.map((x) => ({ res: x.res, code: x.code, label: x.label, display: x.display || x.label,
            ...(x.alPostoDi ? { alPostoDi: x.alPostoDi } : {}) })),
          quesito: st.quesito || null,
          ...(plan.prima ? { prima: plan.prima } : {}),
        });
      }
      if (!done.length) return;
      // ogni richiesta della catena resta da confermare finché non lo si vede
      for (const d of done) ricordaDaConfermare(d.rid, plan.episodeId, d.listUrl, d.count);
      window.removeEventListener("beforeunload", this._unload);
      this.clearOrderUi();
      this.runState = "done";
      const total = done.reduce((n, d) => n + d.count, 0);
      this.message = { head: `✓ ${done.length} richieste, ${total} esami verificati`, body: "" };
      // il resoconto elenca gli esami di tutte e due le richieste, non solo dell'ultima
      // …e il quesito solo se è lo stesso per tutte e due (la radiologia può avere il suo)
      if (this.runData) {
        this.runData.addedTutti = done.flatMap((d) => d.added);
        this.runData.quesito = done.every((d) => JSON.stringify(d.quesito) === JSON.stringify(done[0].quesito)) ? done[0].quesito : null;
      }
      // hand the rest of the walk to the pages we are about to land on
      const first = done[0];
      tabStore.set("queue.v1", { episodeId: plan.episodeId, autoConfirm: !!plan.autoConfirm, ts: Date.now(), items: done });
      tabStore.set("receipt.v1", { richiestaId: first.rid, episodeId: plan.episodeId, ts: Date.now(), items: first.added, carrelli: first.carrelli || {}, quesito: first.quesito || null, ...(first.prima ? { prima: first.prima } : {}) });
      if (plan.autoConfirm && first.lastCode) {
        tabStore.set("confirm.v1", { richiestaId: first.rid, episodeId: plan.episodeId, lastCode: first.lastCode, lastLabel: first.lastLabel, count: first.count, ts: Date.now() });
      }
      this.render();
      if (first.listUrl) this.vaiSeLibero(first.listUrl, { ms: 900, striscia: { tag: `✓ ${done.length} richieste`, testo: "Conferma dal gestionale", tono: "ok" } });
    }

    // ---- live validation (before anything is sent) ----
    computeProblems() {
      const items = [...this.selected.values()];
      const problems = { go: [], confirm: [] };
      const both = (m) => { problems.go.push(m); problems.confirm.push(m); };
      const wantsRadio = items.some((i) => RADIO_SET.includes(i.res));
      const wantsLab = items.some((i) => !RADIO_SET.includes(i.res));
      const q = (this._q || "").trim(), qrx = (this._qrx || "").trim();
      if (this.pageType === "patient") {
        if ((wantsLab && !q) || (wantsRadio && !q && !qrx)) both("Scrivi il quesito diagnostico prima di creare la richiesta.");
        if (wantsRadio && !wantsLab && !this.entry?.radioUrl) both("Link Richieste Radiologia non trovato su questa pagina.");
        if (wantsLab && !this.entry?.labUrl) both("Link Richieste Laboratorio non trovato su questa pagina.");
      } else if (this.pageType === "crea") {
        const allowed = new Set((param(location.href, "RISORSE") || "").split(",").filter(Boolean));
        if (allowed.size) {
          const cat = fullCatalog();
          const opzioni = [...allowed].map((v) => ({ value: v, label: (cat[v] && cat[v].label) || v }));
          const wrong = items.filter((i) => i.res && !risorsaQui(i, opzioni, cat));
          if (wrong.length) both(`Non ordinabili in questa richiesta: ${wrong.map((i) => i.display || shortLabel(i.label)).join(", ")}.`);
        }
        const form = document.forms.namedItem("RICHIESTACrea");
        const pageQ = (form?.elements?.namedItem("QUESITO_DIAGNOSTICO")?.value || "").trim();
        if (items.length && !pageQ && !q && !(wantsRadio && !wantsLab && qrx)) both("Scrivi il quesito diagnostico (nel pannello o nella pagina).");
      } else if (this.pageType === "exam") {
        const live = examModel(document, location.href);
        if (live.resOptions.length) {
          // lo stesso criterio del motore: un esame che in questa sede sta in
          // un'altra risorsa (per nome, o perché ha lo stesso esame) si ordina
          const cat = fullCatalog();
          const wrong = items.filter((i) => i.res && !risorsaQui(i, live.resOptions, cat));
          if (wrong.length) both(`Non ordinabili in questa richiesta: ${wrong.map((i) => i.display || shortLabel(i.label)).join(", ")}.`);
          else {
            // Una richiesta, un erogatore: il gestionale rifiuta il primo
            // esame di un secondo («ORA-20965 … Progressivo richiesta già
            // utilizzato»). Da un carrello si aggiunge solo nel suo erogatore
            // (o, a carrello vuoto, in uno solo); il resto, dalla pagina del paziente.
            const dove = (i) => (risorsaQui(i, live.resOptions, cat) || {}).res || i.res;
            const erogatori = [...new Set(items.map(dove))];
            const suo = live.exams.some((e) => e.isDel) ? live.res : null;
            const fuori = items.filter((i) => dove(i) !== (suo || erogatori[0]));
            if (fuori.length) {
              both(`Una richiesta, un erogatore: ${fuori.map((i) => i.display || shortLabel(i.label)).join(", ")} ${fuori.length === 1 ? "va" : "vanno"} in un'altra richiesta — dalla pagina del paziente.`);
            }
          }
        }
      }

      return problems;
    }

