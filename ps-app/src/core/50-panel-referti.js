//@frammento 50-panel-referti.js — Panel (segue): storico in sottofondo, caricamento dei valori, lettura/scarico/salvataggio dei referti,
//@ autoCarica, visore.
    // l'impronta del codice fiscale di QUESTO episodio, presa dai prelievi
    // che il pannello ha già letto: nessuna richiesta in più
    cfEpisodio() {
      for (const k of tabStore.keys(`ris.${this.episodeId || "x"}.`)) {
        const v = tabStore.get(k, null);
        if (v && v.cf) return v.cf;
      }
      return "";
    }

    // Il link «Storico Dati Clinici» di QUESTA pagina, come ce l'ha il
    // gestionale: mai un indirizzo costruito.
    linkStorico() {
      const a = document.querySelector('a[href*="MODALITA=CLINICA"]');
      if (!a) return "";
      try { const u = new URL(a.href, location.href); return u.origin === location.origin ? u.href : ""; } catch { return ""; }
    }
    // «⭳ Carica i valori» apre anche lo storico del portale, in una scheda di
    // sottofondo che si chiude da sola: la stessa pagina che si apre col link,
    // letta come sempre. Se non arriva, lo si dice — e il link a mano resta.
    async storicoInSottofondo() {
      if (!hasExt() || this._sotto || !this.episodeId || !this.nomePaziente()) return;
      const url = this.linkStorico();
      if (!url) { this.log(`${now()}  portale: su questa pagina non c'è il link «Storico Dati Clinici»`); return; }
      this._sotto = { t0: Date.now() };
      this.render();
      let s = { esito: "" };
      try {
        const r = await ask({ t: "apriStoricoSotto", url, ep: this.episodeId, nome: this.nomePaziente() });
        if (!r || !r.ok) { s = { esito: "rifiutato", why: r && r.why }; return; }
        // l'orologio parte adesso: il service worker può aver tenuto la
        // risposta finché il portale era libero (una lettura alla volta) o il
        // motore lavorava. Poi la scheda ha 30 secondi per arrivare alla
        // tabella e uno al più per leggerla: la tabella si scorre a passi (il
        // portale disegna solo le colonne in vista)
        this._sotto.t0 = Date.now();
        while (Date.now() - this._sotto.t0 < 95000) {
          await sleep(800);
          s = await ask({ t: "esitoSotto", tabId: r.tabId });
          if (!s || !s.ok || (s.esito !== "attesa" && s.esito !== "lettura")) break;
        }
      } finally {
        this._sotto = null;
        // ancora «in lettura» allo scadere: quello che è arrivato è arrivato
        if (s && s.esito === "lettura") s = { ...s, esito: "letto" };
        if (s && s.esito === "letto") {
          this.log(`${now()}  storico del portale letto in sottofondo: ${s.esami} esami · ${s.prelievi} prelievi`);
          this.notaPortale = "";
          this._labLetto = Date.now();   // (letto, anche senza niente: il Lab vuoto dice quando)
          await this.caricaStorico();
        } else {
          const perche = {
            login: "il portale chiede di entrare", tempo: "la tabella non è comparsa in 30 secondi",
            altrove: "il portale si è aperto a un indirizzo che l'estensione non conosce (aggiungi l'indirizzo del portale)",
            nonportale: "il link dello storico non ha aperto il portale",
            altro: "il portale ha aperto un altro paziente: non lo attribuisco", chiusa: "la scheda del portale è stata chiusa",
            rifiutato: (s && s.why) || "non aperto",
          }[s && s.esito] || "nessuna risposta";
          this.log(`${now()}  storico del portale in sottofondo: ${perche}`);
          this.notaPortale = perche;
        }
        this.render();
      }
      return !!(s && s.esito === "letto");
    }

    // «⭳ Carica i valori». Lo storico del portale ha TUTTI i valori del
    // laboratorio, refertati e no: basta quello, una pagina sola. Le finestre
    // Risultati — una richiesta per prelievo — si leggono solo se il portale
    // non si può leggere: senza estensione, senza link, o se non ha risposto.
    // Dice se i valori sono arrivati (lo storico, o almeno un prelievo).
    async caricaValori(opts = {}) {
      if (!this.conPortale()) return !!(await this.reloadTuttiValori(opts));
      const letto = await this.storicoInSottofondo();
      if (!letto && !(opts.ferma && opts.ferma())) {
        this.log(`${now()}  leggo i prelievi dalle finestre Risultati, uno alla volta`);
        return !!(await this.reloadTuttiValori(opts));
      }
      return !!letto;
    }
    conPortale() { return this.pageType !== "vista" && hasExt() && !!this.nomePaziente() && !!this.linkStorico(); }

    async caricaStorico() {
      // (anche su una pagina «altra» del suo paziente: la scheda in archivio, da leggere e basta)
      if (!(this.pageType === "patient" || (this.pageType === "vista" && this.epDiQuesta())) || !hasExt()) return;
      const prima = (this.storico?.letto || 0) + "|" + this.storicoAltri;
      // schedaMia() ha già deciso l'identità: qui non si ricontrolla, o la
      // regola finirebbe scritta in due posti e prima o poi in due modi
      const dati = await this.schedaMia();
      // rifiutare è giusto, rifiutare in silenzio no: il medico quella tabella
      // l'ha letta un minuto prima e deve sapere perché non è qui
      this.storico = dati && dati.righe ? dati : null;
      if (this.storico) this.storicoAltri = "";
      // si ridisegna solo se è cambiato qualcosa, e mai sopra una schermata in
      // cui si sta scrivendo: tornare su questa scheda non deve costare il cursore
      if ((this.storico?.letto || 0) + "|" + this.storicoAltri === prima) return;
      if (this.view === "dimtesto" || this.view === "dimimport" || this.view === "eotesto") return;
      if (this.root.activeElement && ["dfin", "riffiltro"].includes(this.root.activeElement.id)) return;
      this.render();
    }

    async refreshRefCache() {
      const ids = this.refertiMostrati().map((e) => e.id);
      if (!hasExt() || !ids.length) return;
      const r = await ask({ t: "listRef", ep: this.episodeId, ids });
      if (r && r.ok) { this.refCache = r.cached || {}; this.render(); this.estraiSalvati(); }
    }

    // Il testo dei PDF già salvati si legge SEMPRE, dalla copia su questo
    // computer: nessuna richiesta a nessuno, uno alla volta, appena si sa che
    // ci sono. Così il medico non deve toccare un referto per leggerlo.
    async estraiSalvati() {
      if (!hasExt() || this._estraggo) return;
      this._estraggo = true;
      try {
        for (const e of this.refertiMostrati()) {
          // (il testo da solo: di ECG e radiografie; il resto si apre nel visore)
          if (!testoAuto(e) || !(this.refCache || {})[e.id] || tabStore.get(this.txtKey(e.id), null) || this.refBusy?.[e.id] === true) continue;
          const g = await ask({ t: "getRef", id: e.id, ep: this.episodeId }).catch(() => null);
          if (!(g && g.ok && g.data)) continue;
          await this.leggiTesto(e, bufDaB64(g.data)).catch(() => null);
          this.render();
        }
      } finally { this._estraggo = false; }
    }

    // Chi è il paziente di questa pagina, per confrontarlo col referto: il
    // codice fiscale del riquadro (o l'impronta di quello dei prelievi), il
    // nome e la data di nascita. Niente di questo si tiene.
    identitaPaz() {
      const cf = this.pageType === "patient" ? cfInRiquadro(document) : "";
      return { cf, cfImp: this.cfEpisodio() || (cf ? impronta(cf) : ""), nome: this.nomePaziente(), nascita: nascitaInPagina(document) };
    }

    // Dal PDF al testo, e prima di tutto: di chi è. Un PDF intestato a un altro
    // paziente non lascia il suo testo, e la sua copia non resta sotto questo
    // referto.
    // soloIdentita: di TC, ecografie, RM e visite non si tiene il testo (si
    // aprono nel visore): si guarda solo di chi è.
    // Il PDF scelto — da salvare, mostrare, stampare o mandare al telefono — è
    // di un altro paziente: vuol dire che il pannello ha sbagliato. Non si
    // tiene e non si mostra, e lo si dice forte: sulla riga, sulla striscia, e
    // in un piccolo registro locale da allegare a una registrazione (episodio,
    // referto, ora, su che cosa non torna e le impronte — mai un nome).
    erroreIdentita(e, id, righe) {
      const testo = (righe || []).join(" ").toUpperCase();
      const cfs = [...new Set(testo.match(new RegExp(CF_UNO.source, "g")) || [])].slice(0, 3);
      const date = [...new Set(testo.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) || [])].slice(0, 3);
      const chi = this.identitaPaz();
      // (della nascita solo se torna: le date sono poche, la loro impronta si rovescia in un attimo)
      const lette = date.map(improntaNascita).filter(Boolean), sua = improntaNascita(chi.nascita);
      const voce = { ts: Date.now(), ep: String(this.episodeId || ""), referto: e.id, via: id.via || "",
        cfLetti: cfs.map(impronta), cfPaziente: chi.cfImp || "", nascita: !lette.length || !sua ? "non confrontate" : lette.includes(sua) ? "uguali" : "diverse" };
      segnaErrore("identita", voce);
      this.log(`${now()}  ERRORE GRAVE: il PDF di ${shortLabel(e.label)} (referto ${e.id}) è di un altro paziente (${voce.via}) — non tenuto, non mostrato · impronte CF ${voce.cfLetti.join(",") || "—"} contro ${voce.cfPaziente || "—"} · date di nascita ${voce.nascita}`);
      this.segnala({ tag: "Errore grave", testo: GRAVE_ALTRO, tono: "err", paziente: this.nomePaziente() || "", ...this.avvisoVisto() });
    }
    async leggiTesto(e, buf, { soloIdentita = false } = {}) {
      const size = buf?.byteLength || 0;   // (prima del lettore: la copia letta, per chiRef)
      const letto = await testoPdf(buf);
      const righe = letto.righe;
      if (!righe.length) {
        // Un PDF senza testo (una scansione): di chi è non si sa, quindi al telefono non va. La copia lo ricorda
        // («vuoto»), così il telefono dice «aprilo sul PC» e non lo rilegge a ogni apertura degli esiti.
        if (hasExt() && size) ask({ t: "chiRef", id: e.id, ep: this.episodeId, chi: "vuoto", size }).catch(() => {});
        return { vuoto: true, letto };
      }
      const id = identitaReferto(righe, this.identitaPaz());
      // Guardato di chi è, e non è di un altro: lo sa la copia salvata (chiRef: senza, al telefono non
      // va), e un «di un altro paziente» di prima — una copia vecchia — non vale più per questa.
      if (id.esito !== "altro") {
        if (fallito(this.episodeId, e.id)?.altro) togliFallito(this.episodeId, e.id);
        if (hasExt() && size) ask({ t: "chiRef", id: e.id, ep: this.episodeId, chi: id.esito === "ok" ? "ok" : "nv", size }).catch(() => {});
      }
      if (id.esito === "altro") {
        tabStore.set(this.txtKey(e.id), { ts: Date.now(), altro: true });
        segnaFallito(this.episodeId, e.id, { altro: true });   // (da solo non si riprende più)
        if (hasExt()) {
          await ask({ t: "delRef", id: e.id, ep: this.episodeId }).catch(() => {});
          const c = { ...(this.refCache || {}) };
          delete c[e.id];
          this.refCache = c;
        }
        this.erroreIdentita(e, id, righe);
        return { altro: true, letto };
      }
      if (soloIdentita) {
        const t0 = tabStore.get(this.txtKey(e.id), null);
        if (!t0 || t0.altro) tabStore.set(this.txtKey(e.id), { ts: Date.now(), soloId: true });
        this.log(`${now()}  ${shortLabel(e.label)}: salvato, si apre nel visore (${id.esito === "ok" ? `intestazione verificata: ${id.via}` : "intestazione non verificata"})`);
        return { soloId: true, letto };
      }
      tabStore.set(this.txtKey(e.id), { ts: Date.now(), righe });
      // nella scheda del paziente va quello che si mostra: di un ECG, il referto scritto
      const mostra = refertoMostrato(e, righe, this.identitaPaz());
      if (mostra.length) this.archiviaReferto(e, mostra);
      this.log(`${now()}  ${shortLabel(e.label)}: testo letto (${righe.length} righe, ${letto.lettore}${letto.motivo ? `; ${letto.motivo}` : ""}${id.esito === "ok" ? `; intestazione verificata: ${id.via}` : "; intestazione non verificata"})`);
      return { righe, letto };
    }

    // Cosa si mostra di un referto letto. L'identità si ricontrolla a ogni
    // disegno: il codice fiscale del paziente può arrivare dopo il testo.
    testoDi(e) {
      const t = tabStore.get(this.txtKey(e.id), null);
      if (!t || t.soloId) return null;
      if (t.altro) return { stato: "altro" };
      const righe = t.righe || [];
      const id = identitaReferto(righe, this.identitaPaz());
      if (id.esito === "altro") return { stato: "altro" };
      const verificato = id.esito === "ok";
      if (refertoTipo(e) === "ecg") {
        const s = refertoScrittoEcg(righe);
        return s.righe.length ? { stato: "testo", righe: s.righe, verificato } : { stato: "macchina", verificato };
      }
      return { stato: "testo", righe: refertoScrittoRx(righe, this.identitaPaz()).righe, verificato };
    }

    // In fila per scaricare: al massimo due insieme (un tocco e «Salva» stanno
    // nella stessa fila). Chi aspetta lo dice la sua riga.
    inFila(e, fn) {
      this.refCoda = this.refCoda || new Set();
      this.refCoda.add(e.id);
      this.render();
      return scaricaRef(async () => {
        this.refCoda.delete(e.id);
        this.refBusy = { ...(this.refBusy || {}), [e.id]: true };
        this.render();
        const r = await fn();
        // preso: niente più da riprovare — tranne «di un altro paziente», che lo toglie solo la
        // lettura di questa copia (leggiTesto), mai il fatto di averla presa
        if (r && r.salvato && !fallito(this.episodeId, e.id)?.altro) togliFallito(this.episodeId, e.id);
        return r;
      }).finally(() => this.refCoda.delete(e.id));
    }

    // Il PDF di un referto: la copia salvata se c'è; se no lo si prende — dal
    // portale se il sistema sta là, se no dal gestionale (e, non riuscendo,
    // dal service worker) — e lo si tiene. Lo chiama solo un gesto del medico:
    // un tocco sul referto o «Salva i referti». Mai da solo.
    async scaricaReferto(e) {
      const id = e.id, ep = this.episodeId, pk = this.chiavePaz();
      if (hasExt() && (this.refCache || {})[id]) {
        const g = await ask({ t: "getRef", id, ep });
        if (g && g.ok && g.data) return { buf: bufDaB64(g.data), salvato: true };
      }
      let buf = null;
      try {
        // un sistema che si è già visto stare nel portale (ECG, RIS) ci va
        // diretto: chiedere di nuovo il link al gestionale solo per scoprire
        // che rimanda là sarebbe una richiesta in più
        if (nelPortale(e)) return { buf: await this.refertoDalPortale(e), salvato: true };
        buf = await (await fetchPdf(e.url, {})).blob.arrayBuffer();
      } catch (err) {
        if (err?.name === "AbortError" || !hasExt()) throw err;
        if (err && err.portale) {
          segnaPortale(e);
          return { buf: await this.refertoDalPortale(e), salvato: true };
        }
        // dal pannello no: ci prova il service worker, e se neanche lui il
        // perché dei due tentativi resta sul pallino e nella diagnosi
        const r = await ask({ t: "cacheRef", id, url: e.url, ep, pk });
        const g = r && r.ok ? await ask({ t: "getRef", id, ep }) : null;
        if (!(g && g.ok && g.data)) {
          err.diag = `${err.diag ? `${err.diag} · ` : ""}service worker: ${(r && r.why) || "non riuscito"}`;
          throw err;
        }
        this.refCache = { ...(this.refCache || {}), [id]: r.size || 1 };
        return { buf: bufDaB64(g.data), salvato: true };
      }
      if (!hasExt()) return { buf, salvato: false };
      const res = await ask({ t: "cacheRef", id, ep, pk, data: bufB64(buf), size: buf.byteLength });
      if (res && res.ok) {
        this.refCache = { ...(this.refCache || {}), [id]: res.size || 1 };
        return { buf, salvato: true };
      }
      return { buf, salvato: false, perche: `memoria: ${(res && res.why) || "non riuscito"}` };
    }

    // Il perché di un referto non letto: sul pallino, nella diagnosi e nel Registro.
    refertoRotto(e, err) {
      const why = `${(err && (err.head || err.message)) || "non letto"}${err && err.body ? ` — ${err.body}` : ""}${err && err.diag ? ` [${err.diag}]` : ""}`;
      this.refBusy = { ...(this.refBusy || {}), [e.id]: why };
      segnaFallito(this.episodeId, e.id);
      this.segnaDiagnosi({ cosa: `referto ${shortLabel(e.label)} (${e.sistema || "?"})`, url: e.url, html: (err && err.html) || "", diag: why, quando: now() });
      this.log(`${now()}  ${shortLabel(e.label)}: referto non letto (${why})`);
      segnaErrore("referto", { episodio: this.episodeId || "", referto: e.id, sistema: e.sistema || "", motivo: why.slice(0, 200) });
    }

    // ↻ Rileggi e «⭳ Carica i valori» (e da soli, all'apertura): quelli non ancora salvati
    // (mai il laboratorio), due alla volta con una pausa a caso prima di
    // ognuno, e di ognuno si legge subito il testo (dalla copia appena presa).
    // Il pannello non salva MAI da solo: lo decide il medico, con uno di
    // questi bottoni o con un tocco su un referto.
    // (da solo — auto — non quelli già falliti di recente: vedi riprovaDaSolo)
    async saveAllReferti({ ferma, aspetta, auto = false } = {}) {
      if (!hasExt() || this._salva) return;   // due clic non sono due salvataggi
      const todo = this.refertiMostrati().filter((e) => !(this.refCache || {})[e.id]
        && this.refBusy?.[e.id] !== true && !(this.refCoda && this.refCoda.has(e.id)) && (!auto || riprovaDaSolo(this.episodeId, e.id)));
      if (!todo.length) return;
      this._salva = { fatti: 0, totale: todo.length };
      this.refBusy = this.refBusy || {};
      const pausa = () => sleep(PAUSA_REF[0] + Math.random() * (PAUSA_REF[1] - PAUSA_REF[0]));
      // lasciato il paziente, chi è ancora in fila non parte più
      const LASCIATO = {};
      try {
        await Promise.all(todo.map((e) => (aspetta ? aspetta() : Promise.resolve()).then(() => this.inFila(e, () => pausa().then(async () => {
          if (aspetta) await aspetta();   // un ordine partito intanto: si aspetta che finisca
          if (ferma && ferma()) throw LASCIATO;
          return this.scaricaReferto(e);
        })).then(async (r) => {
          if (!r.salvato) {
            this.refBusy[e.id] = r.perche || "non salvato";
            segnaFallito(this.episodeId, e.id);
            this.log(`${now()}  referto non salvato (${shortLabel(e.label)}): ${this.refBusy[e.id]}`);
            return;
          }
          this.refBusy[e.id] = false;
          // di chi è, sempre; il testo solo di ECG e radiografie (segnato di un altro paziente: questa
          // copia è nuova, si riguarda — il segno resta finché una lettura non dice altro)
          const t = tabStore.get(this.txtKey(e.id), null);
          if (!t || t.altro) await this.leggiTesto(e, r.buf, { soloIdentita: !testoAuto(e) }).catch(() => null);
        }, (err) => { if (err === LASCIATO) this.refBusy[e.id] = false; else this.refertoRotto(e, err); }).finally(() => {
          if (this._salva) this._salva.fatti++;
          this.render();
        }))));
      } finally {
        // senza il finally una sola eccezione spegneva «Salva» per tutta la
        // vita della scheda, e i pallini restavano a girare
        this._salva = null;
        this.render();
      }
    }

    // dopo i valori, i referti: i già salvati (anche da un'altra scheda) no
    async caricaReferti(opts) {
      if (!hasExt() || this._salva) return;
      await this.refreshRefCache().catch(() => {});
      return this.saveAllReferti(opts);
    }

    // Aprire un paziente carica DA SÉ quello che la pagina mostra e il
    // pannello non ha ancora: è «⭳ Carica i valori» senza il tocco — i valori
    // (lo storico del portale, o le finestre Risultati) e poi i referti che non
    // sono di laboratorio, due alla volta con la pausa a caso, quelli già
    // salvati mai più, l'identità controllata come sempre. Solo quando c'è
    // qualcosa di nuovo: un referto non ancora salvato (salvato non cambia
    // più); il laboratorio quando la sua firma nella pagina è cambiata, e — a
    // metà, dove la pagina non lo dice — aprendo gli Esiti, al più ogni 10
    // minuti. Mai mentre un ordine si prepara, parte, si conferma o stampa (di
    // qualunque paziente): aspetta e riprende da sé. Si ferma se il medico
    // lascia il paziente.
    // (`referti: false`: solo i valori — il ⟳ del tabellone, che rilegge dietro chi è stato aperto: lo stato e il laboratorio, niente PDF)
    async autoCarica({ esiti = false, referti = true } = {}) {
      const ep = this.epDiQuesta();
      if (!hasExt() || !ep || this._auto || this._salva || this._refreshAll || this._sotto) return;
      if (this.ordineInCorso()) return this.autoDopoOrdine(esiti);
      await Promise.all([this.refreshRefCache().catch(() => {}), this.caricaStorico().catch(() => {})]);
      if (this.epDiQuesta() !== ep || this._auto || this._salva || this._refreshAll || this._sotto) return;
      const tutti = store.get(AUTO_CARICA, {}) || {};
      const prima = tutti[ep] || {};
      const ora = Date.now();
      const firma = firmaLab(document, location.href);
      const labInPagina = this.esiti.some((e) => !e.storico && (e.kind === "valori" || refertoTipo(e) === "lab"));
      const aMeta = this.esiti.some((e) => e.kind === "valori" && !e.storico);   // la finestra Risultati: il laboratorio non ha finito
      const cambiato = labInPagina && firma !== prima.lab;
      const ricontrolla = esiti && aMeta && ora - (prima.parz || 0) >= PARZ_MS;
      // (quello che non è riuscito si riprova da solo solo più tardi: riprovaDaSolo)
      const leggiLab = (cambiato || ricontrolla) && riprovaDaSolo(ep, "lab", firma);
      const daSalvare = !referti ? [] : this.refertiMostrati().filter((e) => !(this.refCache || {})[e.id] && riprovaDaSolo(ep, e.id));
      if (!leggiLab && !daSalvare.length) return;
      for (const k of Object.keys(tutti)) if (ora - (tutti[k]?.ts || 0) > 24 * 3600e3) delete tutti[k];
      // la firma del laboratorio si scrive solo a lettura riuscita (qui sotto):
      // una lettura fallita non deve sembrare fatta
      tutti[ep] = { ...prima, ts: ora, ...(leggiLab ? { parz: ora } : {}) };
      store.set(AUTO_CARICA, tutti);
      const au = this._auto = { ep, nLab: leggiLab ? (this.conPortale() ? 1 : this.esiti.filter((e) => e.kind === "valori" && !e.storico).length) : 0,
        nRef: daSalvare.length, labFatto: !leggiLab, stop: false };
      const ferma = () => au.stop || this.epDiQuesta() !== ep;
      // un ordine partito intanto: chi è già in volo finisce, il resto aspetta
      const aspetta = async () => { while (this.ordineInCorso() && !ferma()) await sleep(2000); };
      const via = () => { au.stop = true; };
      window.addEventListener("pagehide", via, { once: true });
      this.log(`${now()}  apertura: carico da solo ${[leggiLab ? `i valori (${cambiato ? "la pagina è cambiata" : "a metà: gli Esiti aperti"})` : "", daSalvare.length ? `${daSalvare.length} referti` : ""].filter(Boolean).join(" e ")}`);
      this.render();
      let letto = false;
      try {
        if (leggiLab) {
          await aspetta();
          if (!ferma()) letto = await this.caricaValori({ ferma, aspetta }).catch(() => false);
          if (letto) {
            const t = store.get(AUTO_CARICA, {}) || {};
            t[ep] = { ...(t[ep] || {}), ts: Date.now(), lab: firma };
            store.set(AUTO_CARICA, t);
            togliFallito(ep, "lab");
          } else if (!ferma()) {
            if (fallito(ep, "lab")?.firma !== firma) togliFallito(ep, "lab");   // (una pagina cambiata: si riconta da uno)
            segnaFallito(ep, "lab", { firma });
          }
        }
        au.labFatto = true;
        if (!ferma() && referti) await this.caricaReferti({ ferma, aspetta, auto: true });
      } finally {
        window.removeEventListener("pagehide", via);
        if (this._auto === au) this._auto = null;
        this.render();
      }
      return { lab: leggiLab, letto };
    }
    fermaAuto() { if (this._auto) this._auto.stop = true; }
    // Un ordine al lavoro, di qualunque paziente: il motore che gira (o un giro
    // da riprendere), una scheda d'ordine viva, una conferma in sospeso, i fogli
    // che passano alla stampa.
    // (un motore che manda, qui o altrove; non un ordine in coda o le etichette che aspettano)
    ordineInCorso() { return this.giroQui() || motoreOvunque() || !!tabStore.get("confirm.v1", null) || wizardOpen; }
    // …finito l'ordine, il caricamento riparte da sé
    autoDopoOrdine(esiti) {
      this._autoEsiti = this._autoEsiti || esiti;
      if (this._autoAttende) return;
      this._autoAttende = setInterval(() => {
        if (this.ordineInCorso()) return;
        clearInterval(this._autoAttende); this._autoAttende = null;
        const e = this._autoEsiti; this._autoEsiti = false;
        this.autoCarica({ esiti: e }).catch(() => {});
      }, 3000);
    }

    txtKey(id) { return `reftxt.${this.episodeId || "x"}.${id}`; }

    // Il referto sta nel portale (ECG, radiologia): si apre col link del
    // gestionale — lo stesso clic del medico — in una scheda DIETRO. Là la
    // pagina lo scarica e lo mostra da sé, e lo script del portale ne passa
    // una copia; la scheda si chiude. Nessuna richiesta nostra.
    async refertoDalPortale(e) {
      // con chi è e cosa si è chiesto: là, fra i PDF che il portale mostra, si tiene il suo
      const chi = this.identitaPaz();
      const r = await ask({ t: "apriRefertoSotto", url: e.url, id: e.id, ep: this.episodeId, pk: this.chiavePaz(),
        nome: chi.nome, cfImp: chi.cfImp, nascita: chi.nascita, titolo: shortLabel(e.label || "") });
      if (!r || !r.ok) throw new StopError("Portale non aperto", (r && r.why) || "estensione non raggiungibile");
      // (intanto l'ha preso un'altra scheda, o il telefono: è già fra i salvati)
      let s = r.salvato ? { ok: true, esito: "letto" } : null;
      if (!r.salvato) {
        this.log(`${now()}  ${shortLabel(e.label)}: lo apro nel portale, in una scheda dietro`);
        // quanto aspetta il service worker: 30 secondi, e 10 per un PDF in ritardo
        const fine = Date.now() + 42e3;
        while (Date.now() < fine) {
          await sleep(900);
          s = await ask({ t: "esitoSotto", tabId: r.tabId });
          if (!s || !s.ok || (s.esito !== "attesa" && s.esito !== "lettura" && !(s.esito === "tempo" && s.tardi))) break;
        }
      }
      if (!s || !s.ok || s.esito !== "letto") {
        const perche = {
          login: "il portale chiede di entrare: aprilo una volta e fai l'accesso",
          tempo: "il portale non l'ha mostrato in tempo", attesa: "il portale non l'ha mostrato in tempo",
          nonportale: "il link non ha portato al portale (sessione del gestionale?)",
          nonTrovato: "il portale l'ha aperto, ma il PDF non si vede da qui",
          altro: "il portale ha mostrato solo referti di un altro paziente: non tenuti",
          chiusa: "la scheda del portale è stata chiusa", altrove: "la scheda del portale è andata altrove",
        }[s && s.esito] || (s && s.esito) || "nessuna risposta dall'estensione";
        const x = new StopError("Referto non letto dal portale", perche);
        if (s && s.diag) x.diag = s.diag;
        throw x;
      }
      const g = await ask({ t: "getRef", id: e.id, ep: this.episodeId });
      if (!(g && g.ok && g.data)) throw new StopError("Referto letto ma non ritrovato", "riprova");
      this.refCache = { ...(this.refCache || {}), [e.id]: Math.round(g.data.length * 3 / 4) || 1 };
      return Uint8Array.from(atob(g.data), (c) => c.charCodeAt(0)).buffer;
    }

    // Un tocco su un referto lo apre LÌ, sotto la sua riga: il testo di
    // radiologia ed ECG (dell'ECG solo il referto scritto). Se non c'è ancora,
    // il tocco è il gesto che lo prende: in fila (due alla volta), lo tiene e
    // ne legge il testo. Un secondo tocco lo richiude. Gli altri documenti,
    // senza testo, si aprono nella loro scheda; il PDF è sempre a un tocco
    // (↗ PDF), anche quando il testo non esce.
    // Il referto senza testo nel pannello: salvato si apre nel visore; se non
    // lo è ancora lo si prende (la stessa fila, due alla volta), si guarda di
    // chi è, e poi il visore. Non riuscendo, il documento del gestionale.
    async apriNelVisore(e) {
      if ((this.refCache || {})[e.id]) return this.openReferto(e.id);
      if (this.refBusy?.[e.id] === true || (this.refCoda && this.refCoda.has(e.id))) return;
      try {
        const r = await this.inFila(e, () => this.scaricaReferto(e));
        this.refBusy[e.id] = false;
        this.render();
        if (!(await this.vediReferto(e, r.buf, true))) return this.openReferto(e.id);
      } catch (err) {
        this.refertoRotto(e, err);
        this.render();
        return this.openReferto(e.id);
      }
    }
    async espandi(id) {
      const e = this.esiti.find((x) => x.id === id);
      if (!e) return;
      segnaVisti(this.episodeId, [id]);
      // TC, ecografie, RM, visite: niente testo, il PDF nel visore (preso prima, se manca)
      if (hasExt() && !testoAuto(e)) return this.apriNelVisore(e);
      if (this.espanso === undefined) this.espanso = this._autoAperto || null;   // da qui decide il medico
      if (this.espanso === id) { this.espanso = null; this.render(); return; }
      const tipo = refertoTipo(e);
      const t0 = tabStore.get(this.txtKey(id), null);
      const testo = t0 && !t0.soloId ? t0 : null;   // salvato senza testo: il tocco lo legge
      // non letto la volta scorsa: il documento si apre, invece del testo che non c'è
      if (!testo && typeof this.refBusy?.[id] === "string") return this.openReferto(id);
      if (!testo && tipo !== "rx" && tipo !== "ecg") return this.openReferto(id);
      this.espanso = id;
      this.render();
      if (testo || this.refBusy?.[id] === true || (this.refCoda && this.refCoda.has(id))) return;
      try {
        const r = await this.inFila(e, () => this.scaricaReferto(e));
        const l = await this.leggiTesto(e, r.buf);
        this.refBusy[id] = false;
        if (l.vuoto) {
          // I referti sono PDF di testo: se il testo non esce lo sbaglio è del
          // lettore. Si apre il PDF, e la diagnosi dice com'è fatto (la
          // struttura, mai il contenuto) per correggerlo.
          const diag = `${l.letto.motivo ? `${l.letto.motivo} · ` : ""}${pdfDiag(r.buf)}`;
          this.segnaDiagnosi({ cosa: `referto ${shortLabel(e.label)} (${e.sistema || "?"})`, url: e.url, html: "", diag, quando: now() });
          this.log(`${now()}  ${shortLabel(e.label)}: testo non letto — si apre il PDF [${diag}]`);
          if (this.espanso === id) this.espanso = null;
          this.render();
          return this.openReferto(id);
        }
      } catch (err) {
        // Non letto: si dice perché (sul pallino e nel Registro) e il
        // documento si apre lo stesso, con lo stesso tocco — non al secondo.
        this.refertoRotto(e, err);
        if (this.espanso === id) this.espanso = null;
        this.render();
        return this.openReferto(id);
      }
      this.render();
    }

    // The list shows only WHAT, never the text: at discharge the doctor knows
    // which sheet he wants, and reading it here would only cost him a scroll.
    // «Aperti»: prima di scrivere la dimissione, una riga sola con quello che
    // è ancora aperto — esami in attesa (con l'ora della richiesta), referti
    // non arrivati o non visti, promemoria, valori segnati o nuovi fuori
    // range. Solo quando c'è qualcosa, non blocca niente, e dice di quando è
    // la lettura. Copre quello che il pannello sa: la pagina del paziente e
    // gli ordini partiti da qui («ordinati da qui» se la pagina non l'ha letta).
    apertiHtml() {
      const ep = this.epDiQuesta();
      if (!ep) return "";
      const st = statoEsami(statoDi(ep));
      const voci = [];
      if (st) {
        for (const e of st.esami.filter((x) => !x.fatto).sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
          voci.push(`${frase(e.label)}${e.tipo === "lab" ? "" : " non refertato"}${e.ts ? ` (${hhmm(e.ts)})` : ""}`);
        }
        for (const e of st.nuovi) if (e.tipo !== "lab") voci.push(`${frase(e.label)}: referto da leggere`);
      }
      const daFare = dfAperte(ep).length;
      if (daFare) voci.push(`Da fare: ${daFare}`);
      const segnati = Object.keys(leggiSegni(this.chiaveNota())).length;
      if (segnati) voci.push(segnati === 1 ? "1 valore segnato" : `${segnati} valori segnati`);
      if (st && st.valoriFuoriTot) voci.push(`${st.valoriFuoriTot === 1 ? "1 valore nuovo" : `${st.valoriFuoriTot} valori nuovi`} fuori range, non letti`);
      if (!voci.length) return "";
      const MAX = 8, vedi = voci.length > MAX ? [...voci.slice(0, MAX - 1), `e altri ${voci.length - MAX + 1}`] : voci;
      const coda = [st && st.soloQui && st.esami.length ? "ordinati da qui" : "", st && st.letto ? `letto alle ${hhmm(st.letto)}` : ""].filter(Boolean);
      return `<div class="aperti" role="status" title="${esc(voci.join("\n"))}"><b>Aperti:</b> ${vedi.map(esc).join(" · ")}${
        coda.length ? ` <span class="apl">· ${esc(coda.join(" · "))}</span>` : ""}</div>`;
    }
