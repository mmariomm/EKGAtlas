//@frammento 43-panel-selezione.js — Panel (segue): selezione e pacchetti-quesito, Registro, striscia/segni/pill delle novità,
//@ callback del motore, chiudiRichiesta (la Conferma), failed/stopped.
    // ---- selection ----
    key(res, code) { return `${res}:${code}`; }
    isSel(res, code) { return this.selected.has(this.key(res, code)); }
    toggle(res, code) {
      if (this.acq) this.acFocus = true; // stay in the search box
      const k = this.key(res, code);
      this.pkgDa.delete(k);   // toccato a mano: da qui in poi è tuo, non del pacchetto
      if (this.selected.has(k)) this.selected.delete(k);
      else this.selected.set(k, { res, code, label: examLabel(res, code), display: displayLabel(res, code) });
      this.persistUi();
      this.render();
    }
    togglePreset(p) {
      const items = p.items;
      const allOn = items.every(([r, c]) => this.isSel(r, c));
      for (const [r, c] of items) {
        const k = this.key(r, c);
        this.pkgDa.delete(k);   // toccato a mano: non è più del pacchetto
        if (allOn) this.selected.delete(k);
        else this.selected.set(k, { res: r, code: c, label: examLabel(r, c), display: displayLabel(r, c) });
      }
      this.persistUi();
      this.render();
    }

    // ---- quesito = pacchetto di esami ----
    // Un chip-pacchetto scrive il quesito E spunta il suo pacchetto. Si
    // ricorda quali esami ha messo LUI (pkgDa): cambiando pacchetto, o
    // toccando di nuovo il chip, se ne vanno solo quelli — gli esami che c'erano
    // già (scelti a mano, o di un profilo) restano. Un chip normale scrive solo
    // il quesito, come sempre; se c'era un pacchetto lo lascia andare e i suoi
    // esami restano, ora «a mano».
    pacchettoDi(q) {
      const t = String(q || "").trim().toLowerCase();
      return PACCHETTI.find((p) => p.q.toLowerCase() === t) || pacchettoImparato(q);
    }
    scegliQuesito(q) {
      const p = this.pacchettoDi(q);
      const prima = this.pkgDa;
      let mancano = [];
      this.quesitoMio = false;   // l'ha scritto un chip, non il medico: il triage resta
      if (!p) {
        this._q = q;
        this.pacchetto = ""; this.pkgDa = new Set();
      } else if (this.pacchetto === p.q) {
        // di nuovo il pacchetto attivo: via quesito e pacchetto
        for (const k of prima) this.selected.delete(k);
        this._q = ""; this.pacchetto = ""; this.pkgDa = new Set();
      } else {
        const cat = fullCatalog();
        const nuovo = new Set();
        for (const [r, c] of p.items) {
          const k = this.key(r, c);
          // (uno imparato che il catalogo non ha più si salta e basta)
          if (!cat[r]?.items?.[c]) { if (!p.imparato) mancano.push(DISPLAY[k] || `esame ${c} (${RES_SHORT[r] || r})`); continue; }
          if (!this.selected.has(k)) {
            this.selected.set(k, { res: r, code: c, label: examLabel(r, c), display: displayLabel(r, c) });
            nuovo.add(k);
          } else if (prima.has(k)) nuovo.add(k);   // lo aveva messo il pacchetto di prima: resta del pacchetto
        }
        for (const k of prima) if (!nuovo.has(k)) this.selected.delete(k);
        this.pacchetto = p.q; this.pkgDa = nuovo; this._q = p.q;
      }
      // quello che manca dal catalogo si dice una volta sola, qui e nel Registro
      if (mancano.length) {
        const nota = `«${p.q}»: non ho aggiunto ${mancano.join(", ")} — ${mancano.length === 1 ? "non è" : "non sono"} nel catalogo di questo computer.`;
        this.log(`${now()}  ${nota}`);
        this.message = this._notaPk = nota;
      } else if (this._notaPk && this.message === this._notaPk) { this.message = null; this._notaPk = ""; }
      this.persistUi();
      this.render();
    }

    log(line) {
      this.logLines.push(line);
      if (this.logLines.length > 200) this.logLines.shift();
      tabStore.set("log." + (this.episodeId || "x"), { ts: Date.now(), lines: this.logLines });
      const el = this.root.querySelector(".log");
      if (el) { el.textContent = this.logLines.join("\n"); el.scrollTop = el.scrollHeight; }
      this.registroAlRegistratore(line);
    }
    // Ogni registrazione (a mano, o gli ultimi minuti salvati da soli) porta il
    // Registro delle schede di quei minuti e le diagnosi dei documenti che non
    // si sono lasciati leggere: il registratore (registra.js) li tiene solo se
    // sta tenendo qualcosa, e nello zip passano dall'anonimizzazione come ogni
    // pagina (testi/registro.txt, testi/diagnosi-N.txt). Il quesito, come in
    // ⧉ Copia, non esce mai. Le righe vanno a mucchi, ogni secondo e mezzo, e
    // subito quando la pagina se ne va (il gestionale ricarica a quasi ogni
    // clic): quelle dell'ultimo secondo e mezzo non si perdono. Tutte, a
    // mucchi di 200.
    registroAlRegistratore(riga) {
      if (!hasExt() || TABELLONE) return;
      (this._regRighe = this._regRighe || []).push(senzaQuesito(String(riga)).slice(0, 2000));
      if (!this._regVia) {
        this._regVia = true;
        window.addEventListener("pagehide", () => this.registroManda());
        document.addEventListener("visibilitychange", () => { if (document.hidden) this.registroManda(); });
      }
      if (!this._regRigheT) this._regRigheT = setTimeout(() => this.registroManda(), 1500);
    }
    registroManda() {
      clearTimeout(this._regRigheT);
      this._regRigheT = 0;
      const tutte = this._regRighe || [];
      this._regRighe = [];
      while (tutte.length) ask({ t: "regRegistro", righe: tutte.splice(0, 200) });
    }
    segnaDiagnosi(d) {
      if (d && hasExt() && !TABELLONE) ask({ t: "regDiagnosi", testo: diagnosiTesto(d) }).catch(() => {});
    }

    // La striscia dice a che punto è, due righe: chi (e cosa) sopra, il
    // momento sotto. Con `ms` se ne va da sola, e `poi` dice cosa resta.
    segnala(s, { ms = 0, poi = null } = {}) {
      clearTimeout(this._tStriscia);
      this.striscia = s ? { ...s } : null;
      if (s && ms) {
        const mia = this.striscia;
        this._tStriscia = setTimeout(() => {
          if (this.striscia !== mia) return;
          this.striscia = null;
          poi?.();
          this.render();
        }, ms);
      }
      // a finestra aperta la striscia è il chip in intestazione: cambia solo
      // lui, al suo posto — niente ridisegno (si starebbe magari scrivendo in un campo)
      if (this.collapsed) this.render();
      else this.rifaiChipGiro();
    }
    rifaiChipGiro() {
      const w = this.root.querySelector("#girow");
      if (w) w.innerHTML = this.chipGiro();
    }
    // Il segno di un ordine finito di un altro paziente (vedi stripOrdine): solo
    // quando cambia si ridisegna, e a finestra aperta cambia solo il chip.
    segnaSegno(s) {
      const firma = JSON.stringify(s);
      if (firma === this._firmaSegno) return;
      this._firmaSegno = firma;
      this.segnoOrdine = s;
      if (this.collapsed) this.render();
      else this.rifaiChipGiro();
    }
    // Cosa c'è di nuovo, sulla pill della pagina del paziente: il primo valore
    // nuovo fuori range (i più gravi per primi) o, senza, il referto nuovo più
    // recente, e quanti sono — gli stessi conti della riga in cima agli Esiti.
    // Solo quello che il pannello ha già letto: da qui non parte nessuna lettura.
    // Niente di nuovo, niente scritta.
    novitaPill() {
      try {
        if (!this.epDiQuesta() || this.runState) return "";
        const st = this.datiEsiti();
        let nVal = 0, primo = "";
        if (st) {
          const nov = new Map();
          for (const d of st.date) {
            if (!d.id) continue;
            const v = tabStore.get(this.risKey(d.id), null);
            const n = v && v.rows ? this.novita(d.id, v.rows) : null;
            if (n && n.size) { nov.set(chiaveCol(d), n); nVal += n.size; }
          }
          const x = nVal ? fuoriRangeUltimi(st).find((y) => nov.get(chiaveCol(st.date[y.col]))?.has(valKey(y.nome))) : null;
          if (x) primo = `${x.sigla} ${x.v}${x.stato < 0 ? "↓" : "↑"}`;
        }
        const visti = refertiVisti(this.episodeId);
        const ref = this.refertiMostrati().filter((e) => !visti.has(e.id));
        const n = nVal + ref.length;
        if (!n) return "";
        if (!primo && ref.length) primo = shortLabel((ref.find((e) => ["rx", "ecg"].includes(refertoTipo(e))) || ref[0]).label);   // (prima ECG e immagini)
        const conto = !primo ? `${n} ${n === 1 ? "nuovo" : "nuovi"}` : n === 1 && !nVal ? "nuovo" : `${n} ${n === 1 ? "nuovo" : "nuovi"}`;
        return primo ? `${primo} · ${conto}` : conto;
      } catch { return ""; }
    }
    pillNovita() {
      const t = this.novitaPill();
      return t ? `<span class="pnov" title="${esc(t)} — apri gli Esiti">${esc(t)}</span>` : "";
    }
    // un tocco sul segno: l'ordine torna una striscia intera, coi suoi bottoni
    apriSegno() {
      const s = this.segnoOrdine;
      if (!s) return;
      this._segnoAperto = s.id; this._segnoApertoTs = Date.now();
      this._sullaPill = false; clearTimeout(this._tApre);   // (il mouse è lì sopra: la finestra non si apre sotto il tocco)
      this._firmaOrdine = "";
      this.stripOrdine();
    }
    // dentro la pill (collapsed): «✓ ROSSI M.» — ✓ fatto, ⚠ da guardare, ✕ non partito
    segnoHtml() {
      const s = this.segnoOrdine;
      if (!s || this.runState || this.striscia) return "";
      const ico = s.tono === "err" ? "✕" : s.tono === "warn" ? "⚠" : "✓";
      return `<span class="segno ${esc(s.tono)}" data-segno="1" title="${esc(s.titolo)} — tocca per aprirlo">${ico} ${esc(s.chi)}${s.n > 1 ? ` +${s.n - 1}` : ""}</span>`;
    }
    // A pannello aperto, quello che succede fuori dalla finestra — l'ordine in
    // sottofondo, la stampa, un errore, una ricetta — è un chip in
    // intestazione: la riga stessa della striscia (la stessa fonte, segnala),
    // corta: chi, «esame 2 di 6», com'è andata, e i suoi bottoni (⏹ / ✕,
    // «apri il carrello», «Stampa»). Niente di nuovo da dire. Il resoconto di
    // un giro di questa scheda sta già nel corpo: lì niente chip.
    chipGiro() {
      if (TABELLONE || LAVORO) return "";
      const running = this.runState === "running";
      // (il resoconto di un errore o di un ⏹ a vista nel corpo: la sua striscia è già lui)
      if ((this.runState === "fail" || this.runState === "stopped") && (this.view === "richieste" || !this.resoNelleRichieste())) return "";
      const s = !running ? this.striscia : null;
      if (!s && !running) return this.segnoChip();
      const quiNome = this.epDiQuesta() ? nomeInPagina() : "";
      const chi = s ? s.paziente || (s.daOrdine || s.daRicetta ? "" : quiNome) : this.runPatient || quiNome;
      const tono = s ? (["err", "warn", "run"].includes(s.tono) ? s.tono : "ok") : "run";
      const badge = s ? s.badge : this.statoGiro().badgeEsami;
      const parti = [s && s.tag, badge, s && s.testo].filter(Boolean);
      const tutto = [chi, ...parti, s && s.quesito].filter(Boolean).join(" · ");
      const stop = s ? (s.onStop ? (s.ferma ? "⏹" : "✕") : "") : "";   // (mentre gira, il ⏹ è uno solo: il bottone grande del corpo)
      const titStop = s ? s.titoloStop || (s.ferma ? "Ferma l'ordine" : "Chiudi l'avviso") : "Interrompi";
      const segno = tono === "run" ? `<i class="gdot"></i>` : `<span class="gtick">${tono === "err" || tono === "warn" ? "!" : "✓"}</span>`;
      const testo = `${chi ? `<b>${esc(nomeCorto(chi))}</b>` : ""}${parti.map((p, k) => `${chi || k ? " · " : ""}${esc(p)}`).join("")}`;
      // (i pezzi al contrario, disegnati da destra: stringendosi cede il testo, e
      // in un'intestazione strettissima per ultimo il ⏹ / ✕, che resta sempre a vista)
      return `<span class="gchip ${tono}" role="status" title="${esc(tutto)}" data-riga="${esc([chi, ...parti, s && s.quesito].filter(Boolean).join(" "))}">${
        stop ? `<button class="gstop${stop === "⏹" ? " ferma" : ""}" id="gchipstop" title="${esc(titStop)}" aria-label="${esc(titStop)}">${stop}</button>` : ""}${
        s ? this.piegatiHtml("gchippieg") : ""}${
        s ? this.segnoBtnHtml("gchipsegno") : ""}${
        s && s.azione ? `<button class="gaz" id="gchipaz" title="${esc(s.azione.titolo || "")}">${esc(s.azione.label)}</button>` : ""}${
        s && s.onTap
          ? `<button class="gcorpo" id="gchipapri" title="${esc(s.titolo || tutto)}">${segno}<span class="gt">${testo}</span></button>`
          : `<span class="gcorpo">${segno}<span class="gt">${testo}</span></span>`}</span>${
        // (le righe dei fogli, come sotto la striscia: ognuna col suo ✕ o «Ristampa»)
        s && s.righe && s.righe.length ? `<span class="gchiprighe">${this.righeHtml(s.righe)}</span>` : ""}`;
    }
    // accanto a una striscia (o al suo chip) il segno è un bottoncino, come gli avvisi piegati
    // (accanto a una striscia che non è di un ordine — una stampa, un errore di questa scheda — il segno resta lo stesso)
    segnoBtnHtml(id) {
      const s = this.striscia;
      const g = s && (s.segno || (!s.daOrdine ? this.segnoOrdine : null));
      if (!g) return "";
      const t = `${g.titolo} — tocca per aprirlo`;
      return `<button class="pieg ${esc(g.tono)}" id="${id}" title="${esc(t)}" aria-label="${esc(t)}">${g.tono === "err" ? "✕" : g.tono === "warn" ? "⚠" : "✓"} ${esc(g.chi)}${g.n > 1 ? ` +${g.n - 1}` : ""}</button>`;
    }
    // a finestra aperta il segno di un ordine finito (di un altro paziente) è un chip piccolo in intestazione
    segnoChip() {
      const s = this.segnoOrdine;
      if (!s || this.runState) return "";
      const ico = s.tono === "err" ? "✕" : s.tono === "warn" ? "⚠" : "✓";
      return `<span class="gchip ${esc(s.tono)}" role="status" title="${esc(s.titolo)}"><button class="gcorpo" id="gchipsegno" title="${esc(s.titolo)} — tocca per aprirlo"><span class="gtick">${ico}</span><span class="gt"><b>${esc(s.chi)}</b>${s.n > 1 ? ` +${s.n - 1}` : ""}</span></button></span>`;
    }
    // gli avvisi di prima (un errore, un ordine da guardare) mentre un altro
    // ordine gira: piegati in un «!1» rosso accanto alla striscia; un tocco li mostra
    piegatiHtml(id) {
      const p = this.striscia && this.striscia.piegati;
      if (!p || !p.n) return "";
      const t = `${p.n === 1 ? "Un avviso" : `${p.n} avvisi`} di prima: ${p.chi} — tocca per vederl${p.n === 1 ? "o" : "i"}`;
      return `<button class="pieg${p.err ? " err" : ""}" id="${id}" title="${esc(t)}" aria-label="${esc(t)}">!${p.n}</button>`;
    }
    // ✕ «Visto: togli» su un avviso che resta (un errore, una stampa non uscita):
    // via dalla striscia; il Registro lo tiene
    avvisoVisto() { return { titoloStop: "Visto: togli", onStop: () => this.segnala(null) }; }
    // finito tutto (stampato): la pill torna quella di sempre
    chiudiGiro() {
      if (this.runState !== "done") return;
      this.runState = null; this.runData = null; this.message = null;
    }

    // ---- engine callbacks ----
    beginRun(state, plan) {
      // a chained second richiesta keeps the first one's steps on screen
      if (plan && plan.continuation && this.runData && this.runData.steps) state.steps.unshift(...this.runData.steps);
      this.runState = "running"; this.runData = state; this.stopFn = state.stop;
      this.pianoGiro = plan || null; this._lavoroChiuso = false;
      clearTimeout(this._tStriscia); this.striscia = null;
      // un salto di pagina deciso dal giro di prima non parte più sopra questo
      clearTimeout(this._tVai); clearTimeout(this._tRiprendi);
      this.carrelloDaAprire = null;
      this.riprova = null; this.consegnaErrore = null; this.tieneDopoErrore = null;
      this.aggiungi = false; this._daconf = null;
      this.runRipreso = !!(plan && plan.startPage === "ripresa");
      // Il giro sopravvive al cambio pagina: riprende da dov'era. Si avvisa
      // prima di uscire solo dove riprendere non si può — le catene
      // lab+radiologia, e il bookmarklet, che va ricliccato a mano.
      if (!plan || !plan.riprendibile || !hasExt()) window.addEventListener("beforeunload", this._unload);
      // Il pannello resta com'è: non si nasconde da solo. Ridotto, la striscia
      // dice a che punto è; aperto, lo dice il giro stesso (e il chip in
      // intestazione), e il ⏹ lo ferma.
      this.render();
    }
    renderRun(state) { this.runData = state; this.render(); }
    finished(state, plan) {
      // (la conferma, se c'è, la riaccende; un «Riprova i mancanti» riuscito si annota)
      if (TRACCIA) TRACCIA.attiva = false;
      if (plan && plan.riprova) segnaErrore("ordine", { episodio: plan.episodeId || this.episodeId || "", richiesta: state.richiestaId || "", motivo: "Riprova i mancanti: riuscita", traccia: riassuntoTraccia() });
      // (la richiesta rifatta da capo dopo un «ORA-»: nel registro degli errori, con la traccia di tutte e due)
      if (plan && plan.ricreata) segnaErrore("ordine", { episodio: plan.episodeId || this.episodeId || "", richiesta: state.richiestaId || "", motivo: "ORA- all'inserimento: richiesta rifatta da capo, riuscita", traccia: riassuntoTraccia() });
      // quello che è entrato in carrello, per lo stato degli esami (riga dei Pazienti, Dimissioni)
      segnaOrdineNostro((plan && plan.episodeId) || this.episodeId, state.richiestaId, state.added);
      if (plan.hold) { this.runData = state; this.render(); return; } // the chain finishes for us
      window.removeEventListener("beforeunload", this._unload);
      // L'ordine è partito: la prossima pagina riparte pulita. Ma se il giro
      // era di un ALTRO paziente (ripreso mentre guardavi altro), il quesito e
      // gli esami che stai spuntando qui non si toccano.
      if (!plan || !plan.episodeId || plan.episodeId === this.episodeId) this.clearOrderUi();
      this.runState = "done"; this.runData = state;
      this.mostraResoconto();
      const n = state.added.length;
      // (quale quesito è partito lo dice la sua riga, sotto: viewResult)
      this.message = {
        head: `✓ ${n} ${n === 1 ? "esame" : "esami"} in carrello, ${n === 1 ? "verificato" : "verificati"}`,
        body: "",
      };
      // In sottofondo la finestra non si apre mai da sola: dalla spedizione
      // alle etichette parla la striscia, e un tocco la apre con la ricevuta.
      // (Solo la catena lab+radiologia, plan.hold, resta sotto gli occhi.)
      this.cartTag = `✓ ${n} ${n === 1 ? "esame" : "esami"} in carrello`;
      const daConfermare = !!tabStore.get("confirm.v1", null);
      this.segnala({ tag: this.cartTag, tono: daConfermare ? "run" : "ok",
        testo: daConfermare ? "Confermo…" : plan.startPage === "ripresa" ? "Il carrello è pronto: aprilo quando vuoi" : "Apro il carrello…" });
      this.render();
      if (state.finishedListUrl) this.chiudiRichiesta(state.finishedListUrl, plan, state);
    }

    // «Svuota» dalla riga di una richiesta da confermare: il carrello è vuoto,
    // provato, e la richiesta dimenticata. La pagina si rilegge (una lettura,
    // l'elenco pulito) per mostrare il carrello vero, e la striscia lo dice.
    svuotato(state, plan) {
      window.removeEventListener("beforeunload", this._unload);
      this.runState = null; this.runData = null; this.message = null;
      const n = (state.inCarrello || []).length;
      const str = { tag: "Carrello svuotato", testo: `${n === 1 ? "1 esame tolto" : `${n} esami tolti`} · niente da confermare`,
        tono: "ok", paziente: this.runPatient || plan.patientName || "" };
      this.segnala(str);
      this.render();
      const u = state.finishedListUrl;
      if (leggibilePagina(u)) this.vaiSeLibero(u, { striscia: str, prima: () => tabStore.set(AVVISO, { ts: Date.now(), striscia: str }) });
    }

    // OGNI navigazione decisa dal programma passa di qui. Se il medico sta
    // scrivendo nel gestionale (cursore in un campo, un campo cambiato, un
    // tasto da meno di 15 secondi) non si va: la pill dice «… · tocca per il
    // carrello» e un tocco ci porta. `prima` scrive il passaggio di consegne
    // per la pagina dopo, nell'istante in cui si parte davvero (se non si
    // riesce a scriverlo, non si parte).
    vaiSeLibero(url, { striscia = null, prima = null, ms = 300 } = {}) {
      const vai = () => { if (prima && prima() === false) return; nav(url); };
      const aspetta = (perche) => {
        this.log(`${now()}  non cambio pagina da solo: ${perche} — un tocco sulla striscia apre il carrello`);
        this.carrelloDaAprire = vai;   // a finestra aperta: il bottone «Apri il carrello»
        const s = striscia || this.striscia || { tag: "", tono: "warn" };
        this.segnala({ ...s, testo: `${s.testo ? s.testo + " · " : ""}tocca per il carrello`, titolo: "tocca per il carrello", onTap: vai, onStop: null });
      };
      const ora = staScrivendo();
      if (ora) { aspetta(ora); return false; }
      // il cronometro si tiene: un giro che parte intanto lo spegne (beginRun)
      clearTimeout(this._tVai);
      this._tVai = setTimeout(() => {
        const poi = staScrivendo();   // nel frattempo ha cominciato a scrivere?
        if (poi) aspetta(poi); else vai();
      }, ms);
      return true;
    }

    // Le richieste di questo episodio mandate e mai viste confermate: dopo 2
    // minuti la pill lo dice, ambra, e un tocco apre il loro carrello. Si
    // guarda solo la pagina che il medico ha davanti — al server non si chiede
    // niente — e sul carrello di quella stessa richiesta non si dice (ci sei).
    sorvegliaConferme() {
      clearTimeout(this._tConferme);
      const sua = param(location.href, "RICHIESTA_ID");
      const x = nonConfermateQui().find((r) => r.rid !== sua);
      if (!x) return;
      const manca = x.ts + attesaConferma() - Date.now();
      const occupata = this.runState === "running" || (this.striscia && (this.striscia.tono === "err" || this.striscia.tono === "run" || this.striscia.daStampa));
      if (manca > 0 || occupata) { this._tConferme = setTimeout(() => this.sorvegliaConferme(), Math.max(manca, 0) + (occupata ? 20e3 : 50)); return; }
      let u = "";
      try { u = new URL(x.listUrl).origin === location.origin && !/[?&](Insert|Delete)=/.test(x.listUrl) ? x.listUrl : ""; } catch { u = ""; }
      this.log(`${now()}  la richiesta ${x.rid} delle ${hhmm(x.ts)} non risulta confermata`);
      // (✕: il medico la ignora — l'ha fatta a mano, o non serve più: dimenticata)
      this.segnala({ tag: "Da controllare", tono: "warn", sorveglia: true, titolo: "tocca per il carrello · ✕ per ignorarla",
        testo: GUARDA, quesito: `la richiesta delle ${hhmm(x.ts)} non risulta confermata`,
        onTap: () => (u ? nav(u) : this.apri()),
        titoloStop: "Ignorala: non la segnalo più",
        onStop: () => { confermataProvata(x.rid); this.segnala(null); this.render(); this.sorvegliaConferme(); } });
    }

    // Ultimo passo: la conferma. Si prova a farla in sottofondo — la pagina
    // del carrello caricata davvero, in una cornice invisibile, col suo
    // bottone premuto davvero. Se il server non si lascia incorniciare, o se
    // un controllo dice di no, si va sulla pagina come si è sempre fatto: lì
    // il medico vede tutto e decide lui. Ogni pagina dopo ci arriva con la
    // striscia (AVVISO), mai con la finestra.
    async chiudiRichiesta(listUrl, plan, state) {
      const daConfermare = !!tabStore.get("confirm.v1", null);
      const tag = this.cartTag || "";
      const ep = plan?.episodeId || this.episodeId;
      const rid = state?.richiestaId || param(listUrl, "RICHIESTA_ID");
      const n = state?.added?.length || 0;
      const chi = this.runPatient || "";
      // (quale quesito è partito lo dice la ricevuta, non la striscia)
      const consegna = (striscia, testo) => tabStore.set(AVVISO, {
        ts: Date.now(), striscia: { paziente: chi, ...striscia }, ...(testo ? { testo } : {}),
      });
      // Nella scheda di un ordine quello che resta da fare a mano non si fa
      // qui: lo stesso passaggio di consegne va alle schede del medico, dove
      // un tocco apre il carrello (con la ricevuta). Questa scheda si slega.
      const alMedico = (vista, striscia, testo) => this.consegnaLavoro(vista,
        { url: listUrl, avviso: { striscia: { paziente: chi, ...striscia }, ...(testo ? { testo } : {}) }, receipt: tabStore.get("receipt.v1", null) });
      // da qui la richiesta è da confermare: finché una pagina del paziente
      // non la mostra confermata, la si tiene d'occhio (solo numeri)
      ricordaDaConfermare(rid, ep, listUrl, n);
      if (!daConfermare) {
        if (LAVORO) {
          return alMedico({ tag, testo: "Conferma dal gestionale", tono: "ok" },
            { tag, testo: "Conferma dal gestionale", tono: "ok" });
        }
        // Un giro ripreso vuol dire che stavi facendo altro: la pagina non te
        // la porto via. Il carrello è pronto, ci vai col bottone.
        if (plan && plan.startPage === "ripresa") {
          this.message = { head: this.message?.head || "", body: "Il carrello è pronto: aprilo quando vuoi." };
          this.render();
          return;
        }
        // Revisione: si va sul carrello, e lì la Conferma è quella del
        // gestionale (il suo clic arma comunque la stampa delle etichette).
        const str = daConfermare ? { tag, testo: "Confermo…", tono: "run", attesaConferma: true }
          : { tag, testo: "Conferma dal gestionale", tono: "ok" };
        this.vaiSeLibero(listUrl, { ms: 400, striscia: daConfermare ? { tag, testo: "Conferma da fare", tono: "warn" } : str,
          prima: () => { consegna(str); } });
        return;
      }
      this.message = { head: this.message?.head || "", body: "Confermo in sottofondo…" };
      this.render();
      let esito = "rifiutata";
      if (LAVORO) {
        // La scheda di un ordine non usa la cornice: è già lei la pagina che
        // nessuno guarda. Va sul carrello e lì preme la Conferma vera (la
        // strada di quando il server non si lascia incorniciare, qui sotto).
        // Una cornice dentro una scheda nascosta Chrome la carica col
        // contagocce, e scadeva prima che il server avesse finito.
        this.log(`${now()}  conferma: vado sul carrello e premo lì Conferma`);
      } else {
        // Se la pagina se ne va mentre la cornice lavora, la conferma automatica
        // muore con lei: non deve ripartire da sola più tardi, su un carrello
        // aperto a mano. Resta il segno qui sopra, e la pill lo dirà.
        const abbandona = () => tabStore.set("confirm.v1", null);
        window.addEventListener("pagehide", abbandona);
        if (TRACCIA) TRACCIA.attiva = true;   // le riletture della conferma vanno nella traccia
        const tC = Date.now();
        // La conferma è ancora il motore: lo chiede (il giro appena finito
        // l'ha lasciato a questa scheda: subito), e intanto le altre schede
        // aspettano; senza turno, la conferma resta al medico. (Mai rimettere
        // il motore di prima: il giro che l'ha chiamata intanto è finito.)
        const idConferma = "conferma" + Math.random().toString(36).slice(2, 8);
        const preso = await prendiMotore(idConferma, this);
        MOTORE_MIO = idConferma;
        try { esito = preso ? await confermaInCornice(listUrl, { panel: this, episodeId: ep, rid }) : "rifiutata"; }
        catch { esito = "rifiutata"; }
        finally { if (MOTORE_MIO === idConferma) { MOTORE_MIO = null; mollaMotore(idConferma); } battitoMotore(); }
        window.removeEventListener("pagehide", abbandona);
        this.log(`${now()}  conferma in sottofondo: ${esito}`);
        if (TRACCIA && TRACCIA.passi.length < 120) TRACCIA.passi.push({ t: tC - TRACCIA.t0, ms: Date.now() - tC, m: "cornice", pagina: "Conferma", esito });
      }
      if (esito === "incerta") {
        // Nessuna prova dalla cornice: la pagina del paziente, riletta con
        // pazienza. (Il carrello no: quanto ci ha messo la Conferma nella
        // cornice non si sa, e senza la strada veloce non si giudica da lui.)
        const prova = await provaConferma(rid, ep, { patientUrl: plan?.patientUrl, panel: this });
        if (prova) {
          let partita = false;
          try { partita = maybeAutoPrint(this, prova.doc, prova.url); } catch { partita = false; }
          esito = partita ? "stampata" : "confermata";
        }
      }
      const fine = { n, ts: Date.now() };
      if (esito === "stampata" || esito === "confermata") confermataProvata(rid);
      if (esito === "stampata") {
        // la striscia adesso è della stampa; alla fine resta il resoconto
        this.message = { head: `✓ ${confermatiTesto(fine)}`, body: "Senza passare dal carrello." };
        this.render();
        return;
      }
      if (esito === "confermata") {
        // Confermata, ma i fogli non sono partiti (un'altra stampa in corso):
        // restano armati, e partono dalla sua scheda. Niente si ricarica.
        this.message = { head: `✓ ${confermatiTesto(fine)}`, body: "Le etichette partono dalla sua scheda." };
        this.segnala({ tag: "Confermata", testo: confermatiTesto(fine), tono: "ok" });
        this.render();
        return;
      }
      if (esito === "incerta") {
        // Né la cornice né la pagina del paziente la dicono confermata: per
        // il pannello NON lo è. Mai verde, e mai una seconda conferma da sola:
        // un tocco apre il carrello, e lì decide il medico — ma la Conferma è
        // partita: prima di rifarla, le sue richieste (RIFARLA).
        tabStore.set("confirm.v1", null);
        if (TRACCIA) TRACCIA.attiva = false;
        segnaErrore("ordine", { episodio: ep, richiesta: rid, motivo: "Conferma non verificata", traccia: riassuntoTraccia() });
        const str = { tag: "Da controllare", testo: RIFARLA, tono: "warn" };
        this.message = { head: "Da controllare", body: RIFARLA_PERCHE };
        this.segnala({ tag: "Da controllare", testo: GUARDA, titolo: "tocca per il carrello", tono: "warn", paziente: chi,
          onTap: () => { consegna(str, RIFARLA_PERCHE); nav(listUrl); } });
        this.render();
        return;
      }
      // Rifiutata (il server non si lascia incorniciare) o sospesa (un
      // controllo ha detto di no): si finisce sulla pagina vera, col motivo.
      // La Conferma non è partita: «Non partita», e la si preme a mano.
      const motivo = "Conferma automatica sospesa: controlla il carrello e premi tu Conferma.";
      const sospesa = { tag: "Non partita", testo: "Controlla il carrello e premi tu Conferma", tono: "err" };
      const testo = (typeof this.message === "string" && this.message) || motivo;
      if (esito === "sospesa") tabStore.set("confirm.v1", null);
      if (this.runRipreso && !LAVORO) {
        // giro ripreso: niente salti di pagina, il carrello si apre col tocco
        // (la scheda di un ordine invece ci va: lì non c'è nessuno a cui portarla via)
        tabStore.set("confirm.v1", null);
        const aMano = esito === "rifiutata";
        this.message = { head: this.message?.head || "", body: aMano ? "Conferma da fare a mano: apri il carrello." : testo };
        const dopo = aMano ? { tag, testo: "Conferma dal gestionale", tono: "ok" } : sospesa;
        const vista = { tag: "Non partita", tono: "err", testo: "apri il carrello e premi Conferma",
          ...(aMano ? {} : { quesito: "un controllo prima della Conferma ha detto di no" }) };
        this.segnala({ ...vista, paziente: chi, titolo: "tocca per il carrello",
          onTap: () => { consegna(dopo, aMano ? null : testo); nav(listUrl); } });
        this.render();
        return;
      }
      if (esito === "sospesa") {
        this.vaiSeLibero(listUrl, { ms: 0, striscia: { ...sospesa, testo: "" }, prima: () => { consegna(sospesa, testo); } });
      } else {
        // cornice vietata, o la scheda di un ordine: la conferma la fa la
        // pagina vera, appena caricata. Se non si può partire adesso, la
        // conferma resta al medico. (Nella scheda di un ordine conferma e
        // stampa continuano da quella pagina, e le etichette arrivano lo
        // stesso al medico.)
        const confermo = { tag, testo: "Confermo…", tono: "run", attesaConferma: true };
        const parte = this.vaiSeLibero(listUrl, { ms: 0, striscia: { tag: "Non partita", testo: "apri il carrello e premi Conferma", tono: "err" },
          prima: () => { consegna(tabStore.get("confirm.v1", null) ? confermo : { tag, testo: "Conferma dal gestionale", tono: "ok" }); } });
        if (!parte) {
          tabStore.set("confirm.v1", null);
          if (LAVORO) alMedico({ tag: "Non partita", testo: "apri il carrello e premi Conferma", tono: "err" }, { tag, testo: "Conferma dal gestionale", tono: "ok" });
        }
      }
    }
    failed(state, msg, plan) {
      window.removeEventListener("beforeunload", this._unload);
      this.runState = "fail"; this.runData = state; this.message = msg;
      this.mostraResoconto();
      if (TRACCIA) TRACCIA.attiva = false;
      // (la traccia del giro: quando, che cosa, che cosa mostrava il carrello)
      segnaErrore("ordine", { episodio: plan?.episodeId || this.episodeId || "", richiesta: state?.richiestaId || "", motivo: String((msg && (msg.head || msg.message)) || msg || "").slice(0, 160),
        traccia: riassuntoTraccia() });
      const riprenderà = !!tabStore.get(CORSA, null);
      // Quali esami della selezione mancano ancora davvero: mai partiti, in
      // questa richiesta o nelle gambe della catena che non sono partite.
      // «Chiudi» lascia scelti solo quelli — quelli già nel carrello no, né i
      // «da controllare». Senza la chiave di ognuno (un giro di prima di
      // questa versione) non si toglie niente: meglio come prima che a caso.
      {
        const gamba = !plan || !plan.legs ? -1 : Number.isInteger(plan.legIndex) ? plan.legIndex
          : plan.legLabel ? plan.legs.findIndex((l) => l.label === plan.legLabel) : -1;
        const mancano = [...(state.mancanti || []), ...(gamba >= 0 ? plan.legs.slice(gamba + 1).flatMap((l) => l.items || []) : [])];
        this.tieneDopoErrore = mancano.every((x) => x && x.chiave) ? mancano.map((x) => x.chiave) : null;
      }
      // La catena lab+radiologia resta sotto gli occhi, com'è sempre stata.
      if (plan && plan.hold) {
        if (this.collapsed && !riprenderà) { this.collapsed = false; store.set("collapsed", false); }
        this.render();
        return;
      }
      // Un giro che riprenderà da solo alla pagina dopo: lo dice la striscia.
      if (riprenderà) {
        this.segnala({ tag: "", testo: "riprende alla prossima pagina", tono: "warn", paziente: this.runPatient || "" });
        this.render();
        // Nella scheda di un ordine nessuno cambia pagina: la si ricarica (un
        // indirizzo da leggere), e il giro riparte da dov'era — l'esame in
        // volo si cerca, mai si rimanda. Il tetto delle riprese vale anche qui.
        if (LAVORO && leggibilePagina(location.href)) this._tRiprendi = setTimeout(() => location.reload(), 2000);
        return;
      }
      // Errore in sottofondo: la finestra NON si apre. La striscia diventa
      // rossa e dice che cosa manca (mai partito) e che cosa è da controllare
      // (mandato, ma non visto in carrello), e la scheda va sul carrello della
      // richiesta — l'ultimo elenco che il gestionale ha dato, cioè
      // l'erogatore su cui tiene la richiesta (un indirizzo con un'altra
      // RISORSA_ID mostrerebbe un elenco in cui il primo «Inserisci» risponde
      // «ORA-20965»: per cambiare c'è il «Risorsa» della pagina) — con una
      // semplice lettura dell'elenco: niente si manda, niente si conferma. Lì
      // il medico vede gli esami già scelti e aggiunge il resto a mano.
      tabStore.set("confirm.v1", null);
      const cosa = testoResto(msg);
      // solo l'elenco semplice, di questo ospedale: niente che inserisca o tolga
      let listUrl = state.lastListUrl;
      try {
        if (new URL(listUrl).origin !== location.origin || /[?&](Insert|Delete)=/.test(listUrl)) listUrl = null;
      } catch { listUrl = null; }
      // «↻ Riprova i mancanti» (e «Svuota il carrello»): mai dopo una sessione
      // scaduta, un episodio che non torna, un'altra scheda al lavoro — né
      // dopo uno svuotamento non riuscito: lì si finisce a mano
      this.riprova = msg.restaQui || msg.niente ? null : ricettaRiprova(state, plan);
      // «Se manca un esame, riprova a mandarlo una volta»: da solo, UNA volta
      // per ordine, dopo un elenco venuto male, e solo se niente è «da
      // controllare» (un esame mandato e non visto non si rischia due volte).
      // È «↻ Riprova i mancanti» com'è, qui, prima dell'ultima parola — mai
      // dalla pagina di un altro paziente.
      const r = this.riprova;
      if (r && msg.ritentabile && !r.ritentato && r.rid && r.mancanti.length && !r.controllare.length
        && leggibilePagina(listUrl) && this.epDiQuesta() === r.ep) return this.riprovaMancanti(listUrl);
      if (plan && plan.ritentato) this.log(`${now()}  ritentato una volta da solo: da qui decidi tu`);
      // «Non partita»: la Conferma non c'è stata. Sotto, che cosa fare (una
      // cosa); sotto ancora, che cosa manca o il perché.
      const fare = msg.sessione ? "rifai l'accesso, poi apri il carrello"
        : r && (r.mancanti || []).length ? "riprova i mancanti" : listUrl && !msg.restaQui ? "apri il carrello" : "completa a mano nel gestionale";
      const striscia = { tag: "Non partita", testo: fare, quesito: cosa || (msg.sessione ? "" : msg.head || ""), tono: "err", paziente: this.runPatient || "" };
      // quello che la pagina del carrello dovrà dire: il resoconto e «Riprova»
      const avviso = {
        testo: msg, striscia,
        giro: { stato: "fail", paziente: this.runPatient || "", listUrl, tiene: this.tieneDopoErrore,
          steps: (state.steps || []).map(({ label, status, note }) => ({ label, status, note })) },
        ...(this.riprova ? { riprova: this.riprova } : {}),
      };
      const consegna = () => tabStore.set(AVVISO, { ts: Date.now(), ...avviso });
      // Nella scheda di un ordine la pagina non si muove: il resoconto intero
      // va alle schede del medico, e lì «apri il carrello» lo apre.
      if (LAVORO) {
        return this.consegnaLavoro({ tag: "Non partita", tono: "err", sessione: !!msg.sessione, testo: fare, quesito: striscia.quesito },
        listUrl && !msg.restaQui ? { url: listUrl, avviso } : null, "errore");
      }
      // Mai sul carrello dopo un episodio che non torna o la sessione scaduta
      // (restaQui), né se il giro ripreso ti ha trovato sulla scheda di un
      // altro paziente: quella pagina non te la porto via.
      // (epDiQuesta: la lista del PS non è la pagina di nessun paziente)
      const qui = this.epDiQuesta();
      const vai = !!listUrl && !msg.restaQui && (!this.runRipreso || (!!qui && qui === plan?.episodeId));
      // anche «Apri il carrello» porta con sé il resoconto: lì compare «Riprova»
      this.consegnaErrore = listUrl && this.riprova ? consegna : null;
      this.segnala(striscia);
      this.render();
      if (vai) {
        state.lastListUrl = listUrl;   // anche «Apri il carrello» del resoconto porta lì
        this.vaiSeLibero(listUrl, { striscia, prima: consegna });
      }
    }
    stopped(state, msg, plan) {
      window.removeEventListener("beforeunload", this._unload);
      this.runState = "stopped"; this.runData = state; this.message = msg;
      this.mostraResoconto();
      if (plan && plan.hold) {
        if (this.collapsed) { this.collapsed = false; store.set("collapsed", false); }
        this.render();
        return;
      }
      // fermato dal medico: lo dice la striscia, un tocco apre il resoconto
      const striscia = { tag: "Non partita", testo: "apri il carrello", quesito: "fermato col ⏹: l'ultimo esame potrebbe essere in carrello", tono: "err", paziente: this.runPatient || "" };
      if (LAVORO) {
        const u = leggibilePagina(state.lastListUrl) ? state.lastListUrl : "";
        return this.consegnaLavoro({ tag: "Non partita", testo: "apri il carrello", tono: "err", quesito: ["fermato col ⏹", testoResto(msg)].filter(Boolean).join(" · ") },
          u ? { url: u, avviso: { testo: msg, striscia, giro: { stato: "stopped", paziente: this.runPatient || "", listUrl: u,
            steps: (state.steps || []).map(({ label, status, note }) => ({ label, status, note })) } } } : null, "interrotto");
      }
      this.segnala(striscia);
      this.render();
    }
    stop() { this.stopFn?.(); }

