//@frammento 52-panel-eo-esami.js — Panel (segue): EO, apri/stampa referto, reset e dimentica, copia del log, rilettura dei valori, ricerca esami.
    // EO — un tocco copia l'esame obiettivo generale. Sotto, una tendina con
    // le aggiunte per caso: sceglierne una la copia subito, e la lascia
    // scritta qui perché si veda cosa è finito negli appunti.
    viewEo() {
      const voci = eoVoci();
      const basi = Object.entries(voci).filter(([, v]) => v.gruppo === "base");
      const sel = voci[this.eoSel] ? this.eoSel : "";
      const scelta = sel ? voci[sel] : null;
      const opz = (gruppo, etichetta) => {
        const l = Object.entries(voci).filter(([, v]) => v.gruppo === gruppo);
        if (!l.length) return "";
        return `<optgroup label="${esc(etichetta)}">${l.map(([k, v]) =>
          `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(v.nome)}${v.modificato ? " •" : ""}</option>`).join("")}</optgroup>`;
      };
      if (!Object.keys(voci).length) return `<div class="hint">Modelli di EO non disponibili in questa versione.</div>`;
      return `
        <div class="sec">
          <div class="lbl">Esame obiettivo</div>
          ${basi.map(([k, b]) => `
            <div class="drow">
              <button class="dcopia" data-eocopy="${esc(k)}" title="Copia negli appunti: ${esc(b.nome)}"
                      aria-label="Copia ${esc(b.nome)}">
                <span class="dnome">${esc(b.nome)}${b.aggiornato ? `<span class="dmod agg" title="L'originale è cambiato dopo la tua modifica">⟳</span>` : b.modificato ? `<span class="dmod" title="Testo modificato da te">•</span>` : ""}</span>
                <span class="dmeta">${esc(b.meta)}</span><span class="dico">⧉</span>
              </button>
              <button class="dbtn" data-eoedit="${esc(k)}" title="Riscrivi: ${esc(b.nome)}" aria-label="Modifica ${esc(b.nome)}">✎</button>
            </div>`).join("")}
          <div class="lbl" title="Prima l'EO generale, poi l'aggiunta del caso: due incollate. ✎ riscrive un testo per le volte successive (• = riscritto da te). I testi sono uguali per tutti i pazienti: quello che riguarda questo paziente si scrive in cartella.">Aggiungi per caso</div>
          <select class="res" id="eocaso" aria-label="Aggiunta di esame obiettivo da copiare">
            <option value="">Scegli…</option>
            ${opz("casi", "Casi")}
            ${opz("frasi", "Frasi pronte")}
          </select>
          <div class="drow eoazione" ${scelta ? "" : "hidden"}>
            <button class="dcopia" data-eocopy="${esc(sel)}" id="eoricopia" title="Copia di nuovo questo testo">
              <span class="dnome">Copia di nuovo</span><span class="dico">⧉</span>
            </button>
            <button class="dbtn" data-eoedit="${esc(sel)}" id="eoedit" title="Riscrivi questo testo" aria-label="Modifica questo testo">✎</button>
          </div>
          <div class="eotxt" id="eotxt" ${scelta ? "" : "hidden"}>${esc(scelta ? scelta.testo : "")}</div>
        </div>`;
    }

    // Riscrivere un testo dell'EO: come un foglio di dimissione. La bozza si
    // tiene a ogni tasto, perché il gestionale ridisegna la pagina sotto le mani.
    eoDraftKey(k) { return "eodraft." + k; }
    viewEoTesto() {
      const k = this.viewId;
      const v = eoVoci()[k];
      if (!v) return `<div class="hint">Testo non disponibile.</div>`;
      const bozza = tabStore.get(this.eoDraftKey(k), null);
      const testo = bozza && typeof bozza.testo === "string" ? bozza.testo : v.testo;
      return `
        <div class="sec">
          <div class="lbl">${esc(v.nome)}
            <button class="mini" id="eocopia" title="Copia questo testo senza salvarlo">⧉ Copia</button>
            <button class="mini" id="eosave" title="Tieni questo testo per le prossime volte">✓ Salva</button>
            ${v.modificato ? `<button class="mini${this.armatoDi("eoreset:" + this.viewId) ? " armato" : ""}" id="eoreset" title="Butta le tue modifiche e riprendi l'originale">${this.armatoDi("eoreset:" + this.viewId) ? EO_RESET_ARMATO : "↺ Originale"}</button>` : ""}
          </div>
          ${v.aggiornato ? `<div class="banner warn">L'originale è cambiato dopo la tua modifica: ↺ Originale per la versione nuova.</div>` : ""}
          ${testo !== v.testo ? `<div class="banner ok">Bozza non salvata.</div>` : ""}
          <textarea class="dedit" id="eoarea" spellcheck="false" aria-label="Testo di ${esc(v.nome)}">${esc(testo)}</textarea>
          <div class="hint">Niente dati del paziente: è un modello.</div>
        </div>`;
    }

    // Un modulo in elenco: un tocco lo apre e parte la stampa. Lo stesso per i
    // consensi e per i moduli della dimissione.
    rigaModulo(c) {
      return `<button class="crow" data-cons="${esc(c.k)}" title="${esc(c.esteso)}">
          <span class="cnome">${esc(c.nome)}</span>
          ${c.pagine > 1 ? `<span class="cpag" title="Esce così tanta carta">${esc(String(c.pagine))} pagine</span>` : ""}
          <span class="cgo">${icoIn("stampante", 13)}apri e stampa</span>
        </button>`;
    }
    notaModuli() {
      return hasExt()
        ? "I moduli sono dentro l'estensione: si aprono anche se il gestionale è lento o giù, e nessuna richiesta esce dal computer."
        : "Servono i moduli dell'estensione: con il preferito (bookmarklet) questa sezione non ha i PDF.";
    }

    // Import is a paste screen, not a window.prompt: a 20 KB JSON in a
    // one-line browser dialog cannot be read, checked or corrected.
    viewDimImport() {
      return `
        <div class="sec">
          <div class="lbl">Importa i fogli
            <button class="mini" id="dimimpok">⤒ Importa</button>
          </div>
          <textarea class="dedit" id="dimimparea" spellcheck="false"
                    placeholder="Incolla qui il JSON esportato con ⬇ JSON" aria-label="JSON dei fogli di dimissione"></textarea>
          <div class="hint">Entrano solo i testi diversi dagli originali: gli altri restano come sono.</div>
        </div>`;
    }

    async openReferto(id) {
      const r = this.esiti.find((x) => x.id === id);
      if (!r) return;
      segnaVisti(this.episodeId, [id]);
      if ((this.refCache || {})[id] && hasExt()) {          // saved copy → instant, no server
        const got = await ask({ t: "getRef", id, ep: this.episodeId });
        if (got && got.ok && got.data) {
          if (await this.vediReferto(r, bufDaB64(got.data))) return;
          const bin = atob(got.data);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
          openTab(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          return;
        }
      }
      const name = "psaRef_" + String(id).replace(/\W/g, ""); // else its own tab, reused on re-click
      const w = openTab("", name);
      if (!w) { this.message = "Consenti i popup per aprire i referti."; this.render(); return; }
      let blank = true;
      try { blank = !w.location.href || w.location.href === "about:blank"; } catch { blank = false; }
      if (blank) w.location.href = r.url;
      try { w.focus(); } catch { /* ignore */ }
      const open = new Set(tabStore.get(this.refKey(), []));
      open.add(id);
      tabStore.set(this.refKey(), [...open]);
      this.render();
      // Qui prima si rileggeva il PDF per tenerne una copia: una seconda
      // richiesta per un documento che è già sullo schermo del medico. Per
      // tenerne una copia c'è «⬇ Salva referti», che è una cosa che si chiede.
    }

    // Un referto salvato si apre nel visore dell'estensione, dalla copia su
    // questo computer: anche senza testo, mai di un altro paziente.
    // (`nuova`: una copia appena presa — segnata di un altro paziente, si riguarda di chi è: il segno
    // resta finché una lettura non dice altro; una copia di prima segnata così non si apre)
    async vediReferto(e, buf, nuova = false) {
      let t = this.testoDi(e);
      if (!t || (nuova && t.stato === "altro")) {
        const l = await this.leggiTesto(e, buf, { soloIdentita: !testoAuto(e) }).catch(() => null);
        t = l && l.altro ? { stato: "altro" } : this.testoDi(e);
      }
      if (t && t.stato === "altro") {
        this.message = GRAVE_ALTRO;
        this.render();
        return true;
      }
      const lib = await pdfjsPronto().catch(() => null);
      if (!lib) return false;
      return apriVisore(lib, buf, [this.nomePaziente(), shortLabel(e.label), e.when].filter(Boolean).join(" · "),
        { stampa: () => this.stampaReferto(e, buf) });
    }

    // «Stampa» nel visore: sull'A4 del medico con la stampa automatica (lo
    // stesso motore della lista esami: ogni foglio annotato prima di partire,
    // una volta sola), dalla copia salvata; senza stampa automatica, il
    // dialogo del browser. Risponde "auto" o "dialogo".
    async stampaReferto(e, buf) {
      const titolo = `${shortLabel(e.label)}${e.when ? " " + e.when : ""}`;
      const job = { name: `Referto ${shortLabel(e.label)}`.slice(0, 60), printer: "stampante normale",
        url: `psassist-ref:${e.id}?ep=${this.episodeId || ""}`, diretto: true };
      if ((this.refCache || {})[e.id] && await stampaAutomatica()
        && await stampaAltrove([job], { panel: this, ep: this.episodeId, paziente: this.nomePaziente(), title: titolo })) {
        this.log(`${now()}  ${shortLabel(e.label)}: alla stampa automatica dal visore`);
        return "auto";
      }
      stampaDialogoPdf(buf);
      this.log(`${now()}  ${shortLabel(e.label)}: stampa dal dialogo del browser`);
      return "dialogo";
    }

    // Le azioni che non si annullano — «Dimentica i dati…», cancellare una
    // registrazione, «Elimina tutti…» di Da rivedere — vogliono due tocchi: il
    // primo arma il bottone (rosso, «… Tocca di nuovo»), il secondo entro
    // DUE_TOCCHI_MS la fa. Passato il tempo il bottone torna com'era: mai un
    // «Tocca di nuovo» che non vale più. Una regola, un tempo, per tutte.
    // → true al secondo tocco; al primo `ridisegna` (anche quando scade) e false.
    dueTocchi(k, ridisegna = () => this.render()) {
      clearTimeout(this._armatoT);
      if (this.armatoDi(k)) { this._armato = null; return true; }
      const prima = this._armato;   // (un altro bottone armato: si disarma, e lo si vede)
      this._armato = { k, ts: Date.now(), ridisegna };
      this._armatoT = setTimeout(() => { if (this._armato && this._armato.k === k) { this._armato = null; ridisegna(); } }, DUE_TOCCHI_MS + 50);
      if (prima && prima.k !== k) prima.ridisegna();
      ridisegna();
      return false;
    }
    armatoDi(k) { return !!this._armato && this._armato.k === k && Date.now() - this._armato.ts < DUE_TOCCHI_MS; }
    resetArmato() { return this.armatoDi("dimentica"); }
    // Cancella subito qui (la memoria del browser e di questa scheda), con
    // «Annulla» per 8 secondi come ogni altra cosa che si può rimpiangere: la
    // fotografia di prima torna com'era. Le altre schede e l'estensione
    // (referti salvati, schede cliniche, ordini finiti, registrazioni) si
    // puliscono finiti gli 8 secondi — o subito, se la pagina se ne va prima.
    async resetDatiPazienti() {
      if (extPersa()) return this.render();   // (qui pulirebbe la pagina sola, e direbbe «dimenticati»)
      if (this.giroQui()) return;
      this.fermaAuto();   // (il caricamento da solo non riscrive quello che si cancella)
      this._resetFuori?.();   // (un reset di prima ancora nei suoi 8 secondi: il suo resto adesso)
      const foto = fotoReset();
      const mem = { storico: this.storico, storicoAltri: this.storicoAltri, storicoDaConfermare: this.storicoDaConfermare, notaPortale: this.notaPortale,
        refCache: this.refCache, refBusy: this.refBusy, espanso: this.espanso, logLines: this.logLines, esiti: this.esiti, rotti: [...this.rottiTab] };
      azzeraPazienti();
      this.dimenticaTutto();
      let fatto = false;
      const chiudi = () => { fatto = true; clearTimeout(t); window.removeEventListener("pagehide", fuori); if (this._resetFuori === fuori) this._resetFuori = null; };
      const fuori = () => {
        if (fatto) return;
        chiudi();
        resetAlleAltreSchede();
        if (hasExt()) ask({ t: "resetPazienti" });
      };
      const t = setTimeout(fuori, 8000);
      window.addEventListener("pagehide", fuori);
      this._resetFuori = fuori;
      this.message = null;
      this.stanzaAnnullabile("Dati dei pazienti dimenticati", () => {
        if (fatto) return;
        chiudi();
        rimettiReset(foto);
        const { rotti, ...resto } = mem;
        Object.assign(this, resto);
        for (const x of rotti) this.rottiTab.add(x);
        this.log(`${now()}  «Dimentica i dati» annullato: tutto com'era`);
      });
      this.render();
    }
    // quello che il pannello tiene in mente, oltre la memoria
    dimenticaTutto() {
      this.storico = null; this.storicoAltri = ""; this.storicoDaConfermare = false; this.notaPortale = "";
      this.refCache = {}; this.refBusy = {}; this.espanso = null;
      this.rottiTab.clear(); this.logLines = [];
      this.esiti = esitiModel(document, location.href);
    }

    // Copy the log for reporting. The quesito is masked out before leaving the
    // page, and the rest goes through the recorder's anonymizer (testoDaCopiare):
    // the Registro names the patients («iPhone · nota di …»).
    async copyLog() {
      const c = await testoDaCopiare("registro.txt", this.logLines.map(senzaQuesito).join("\n"), [this.nomePaziente()]);
      const head = [`PS Assist ${VERSION} · pagina ${this.pageType}`, `${navigator.userAgent}`, `${new Date().toLocaleString("it-IT")}`, copiaAvviso(c), ""].join("\n");
      const text = head + c.testo;
      const ok = await copiaTesto(text);
      const b = this.root.querySelector("#copylog");
      segnaCopia(b, ok);
    }

    // full values of one accesso, inside the panel
    // Two things the doctor must never discover by himself: a name this
    // program does not know (its abbreviation would be a guess) and a row it
    // refused to read. Non sono più una riga ambra sullo schermo: il nome fuori
    // elenco è scritto per esteso e sottolineato a puntini nella tabella, e il
    // dettaglio — quali nomi, quali righe non lette, con il loro valore — sta
    // nel Registro, una volta per ogni cambiamento.
    registraNomi(rows, scartate) {
      const inattesi = nomiInattesi(rows);
      const persi = (scartate || []).filter((x) => x && x.nome);
      if (!inattesi.length && !persi.length) return;
      const firma = JSON.stringify([inattesi, persi.map((x) => [x.nome, x.valore])]);
      if (firma === this._firmaNomi) return;
      this._firmaNomi = firma;
      this.log(`${now()}  valori: ${[inattesi.length ? `non in elenco (scritti per esteso): ${inattesi.join(", ")}` : "",
        persi.length ? `righe non lette: ${persi.map((x) => `${x.nome} = ${x.valore}`).join(" · ")}` : ""].filter(Boolean).join(" — ")}`);
    }

    async openEsito(id) { return this.espandi(id); }

    // One tap re-reads EVERY open draw, paced one request at a time: the manual
    // rehearsal of a future automatic refresh — same read, same honesty (an
    // empty or dead page never replaces values already held). Reported draws
    // (storico) are skipped: their page no longer answers.
    async reloadTuttiValori({ ferma, aspetta } = {}) {
      if (this._refreshAll) return;
      const targets = this.esiti.filter((e) => e.kind === "valori" && !e.storico);
      if (!targets.length) return;
      this._refreshAll = { done: 0, total: targets.length };
      this.refBusy = this.refBusy || {};
      for (const e of targets) this.refBusy[e.id] = true;
      this.render();
      let cambiati = 0;
      try {
      for (const e of targets) {
        if (aspetta) await aspetta();   // un ordine al lavoro: dopo
        if (ferma && ferma()) break;   // il medico ha lasciato il paziente
        const key = this.risKey(e.id);
        const prima = JSON.stringify((tabStore.get(key, null) || {}).rows || []);
        try {
          const mai = !tabStore.get(this.vistoKey(e.id), null);
          const rows = await this.leggiPrelievo(e, { baseline: mai });
          this.rottiTab.delete(e.id);
          if (rows && JSON.stringify(rows) !== prima) cambiati++;
          // una riga nel Registro per prelievo: quando la tabella non torna,
          // qui si vede cosa è stato letto e cosa non ha una data per entrarci
          const inTabella = rows && rows.length ? prelievoComeTabella(risMeta(e), rows, "") : null;
          this.log(`${now()}  ${e.when || "senza data"} · ${shortLabel(e.label)}: ${rows ? rows.length : 0} valori${
            inTabella ? ` → colonna ${inTabella.date[0].ignota ? "«?» (il gestionale non dà data e ora)" : inTabella.date[0].label}` : ""}`);
        } catch (err) {
          this.rottiTab.add(e.id);   // lo dice la schermata, non solo il Registro
          this.log(`${now()}  ${shortLabel(e.label)}: valori non aggiornati (${err?.head || err?.message || err})`);
        }
        this.refBusy[e.id] = false;
        this._refreshAll.done++;
        this.render();
        await sleep(PACE_MS).catch(() => {});
      }
      } finally {
        // come per «Salva referti»: senza il finally «↻ Aggiorna» resta
        // disabilitato per sempre alla prima eccezione
        this._refreshAll = null;
        for (const e of targets) this.refBusy[e.id] = false;
      }
      const letti = targets.filter((e) => !this.rottiTab.has(e.id)).length;
      this.log(`${now()}  letti ${letti} prelievi su ${targets.length}${cambiati ? `, ${cambiati} con valori nuovi` : ", nessun valore nuovo"}`);
      this.render();
      return letti > 0;
    }

    // Values ready before he asks: the 2-line preview is the point of Esiti.
    // UNA lettura di un prelievo, usata da tutti: aprirlo, rileggerlo,
    // ↻ Aggiorna, e il precarico. Prima erano quattro copie della stessa
    // sequenza con quattro politiche d'errore diverse — ed è da lì che
    // veniva un prelievo rotto riletto a ogni ricarico di pagina.
    async leggiPrelievo(e, { baseline = false } = {}) {
      const key = this.risKey(e.id);
      const { doc } = await fetchDoc(e.url, {});
      const { rows, scartate } = parseRisultati(doc);
      const cf = cfImpronta(doc);
      // una finestra che non risponde più non cancella quello che sapevamo
      if (!rows.length && (tabStore.get(key, null) || {}).rows?.length) {
        this.log(`${now()}  la finestra Risultati non risponde più: tengo i valori già letti`);
        return null;
      }
      tabStore.set(key, { ts: Date.now(), rows, scartate, cf, meta: risMeta(e) });
      // in scheda PRIMA di rileggerla, o la riga «Storico» negli Esiti
      // comparirebbe solo alla prossima visita. Un archivio che fallisce non
      // è un prelievo non letto: i valori sono già qui sopra.
      await this.archiviaPrelievo(e, rows, cf, scartate).catch((err) => this.log(`${now()}  prelievo non archiviato (${err?.message || err})`));
      if (baseline) this.segnaVisto(e.id, rows);   // prima lettura: è il riferimento
      // coi valori arriva il codice fiscale: adesso la scheda clinica del
      // portale si può attribuire (o escludere) con certezza — e il prelievo
      // appena letto è già dentro
      this.caricaStorico();
      return rows;
    }

    // Aprire un paziente NON legge niente. I valori si leggono quando li
    // chiedi: aprendo un prelievo, o col bottone «Carica i valori» che li
    // prende tutti, uno alla volta. Un clic su un paziente non è una
    // richiesta di leggere il laboratorio.
    daLeggere() {
      return this.esiti.filter((x) => x.kind === "valori"
        && !tabStore.get(this.risKey(x.id), null) && !this.rottiTab.has(x.id));
    }

    // Le risorse di QUESTA sede, lette dalla pagina: i link «Richieste
    // Laboratorio/Radiologia» (paziente), l'indirizzo (nuova richiesta), la
    // tendina (esami). Vuoto = non si sa, e allora si mostra tutto.
    risorseQui() {
      const ids = new Set();
      const da = (u) => (param(u || "", "RISORSE") || "").split(",").filter(Boolean).forEach((x) => ids.add(x));
      if (this.pageType === "patient") { da(this.entry?.labUrl); da(this.entry?.radioUrl); }
      else da(location.href);
      if (this.pageType === "exam") examModel(document, location.href).resOptions.forEach((o) => ids.add(o.value));
      return ids;
    }

    // la ricerca nella pagina esami (là non c'è un quesito)
    viewBrowse(cat) {
      const q = (this.acq || "").trim().toUpperCase();
      const hits = this.cercaEsami(q, cat);
      const drop = q.length >= 2 ? `<div class="acdrop">${this.vociEsami(hits, cat) || `<div class="acempty">Nessun esame trovato</div>`}</div>` : "";
      return `<div class="ac"><input id="acq" type="search" autocomplete="off" placeholder="altri esami…" value="${esc(this.acq || "")}">${drop}</div>`;
    }
    vociEsami(hits, cat) {
      return hits.slice(0, 12).map((h) => `<button class="acitem ${this.isSel(h.res, h.code) ? "on" : ""}" data-res="${esc(h.res)}" data-code="${esc(h.code)}" title="${esc(h.label)}">
            <span class="acnm">${esc(h.label)}</span><span class="actag">${esc(risorsaCorta(h.res, cat))}</span></button>`).join("");
    }
    // La tendina della casella «Quesito o esame…» si apre solo quando il testo
    // è l'inizio del nome di un esame (o un nome di reparto, PCR): «dispnea»,
    // che sta in mezzo a «PANNELLO 5 – DISPNEA», resta un quesito.
    esamiDalQuesito(testo, cat) {
      const q = String(testo || "").trim().toUpperCase();
      const hits = this.cercaEsami(q, cat);
      return hits.some((h) => h.perAlias || h.label.toUpperCase().startsWith(q)) ? hits : [];
    }
    // Gli esami di tutto il catalogo che rispondono a quello che si è scritto
    cercaEsami(q, cat) {
      const hits = [];
      if (q.length >= 2) {
        // I nomi che si dicono in reparto non sono quelli del laboratorio:
        // «PCR» è «PROTEINA C REATTIVA», che scrivendo PCR non si trovava —
        // e restava solo la PCR POC.
        const alias = ALIAS_RICERCA[q] || [];
        // solo le risorse di questa sede: senza, ogni esame compariva due
        // volte, una per sede, con un codice che qui non vale
        // (se di questa sede il catalogo non conosce ancora niente, si mostra
        // tutto: meglio un doppione che una ricerca vuota)
        const noti = [...this.risorseQui()].filter((r) => cat[r]);
        const qui = new Set(noti);
        for (const [res, v] of Object.entries(cat)) {
          if (qui.size && !qui.has(res)) continue;
          for (const [code, label] of Object.entries(v.items || {})) {
            const L = label.toUpperCase();
            const perAlias = alias.some((x) => L.startsWith(x));
            if (perAlias || L.includes(q)) hits.push({ res, code, label, perAlias, poc: ePoc(label) || ePoc(v.label) });
          }
        }
        // Le Urgenze sono un sottomenu del laboratorio centrale: lo stesso
        // esame stava due volte, identico, una riga per ciascuno. Una sola:
        // quella delle Urgenze, come la ordinano i pacchetti («PT PTT
        // Fantoli» = Urgenze) — o quella già scelta, se è l'altra.
        {
          const uno = new Map();
          for (const h of hits) {
            const k = `${risorsaCorta(h.res, cat)}|${normEsame(h.label)}`;
            const c = uno.get(k);
            const meglio = !c || (this.isSel(h.res, h.code) && !this.isSel(c.res, c.code))
              || (this.isSel(h.res, h.code) === this.isSel(c.res, c.code) && ordineRisorsa(h.res, cat) < ordineRisorsa(c.res, cat));
            if (meglio) uno.set(k, h);
          }
          const tenuti = new Set(uno.values());
          for (let i = hits.length - 1; i >= 0; i--) if (!tenuti.has(hits[i])) hits.splice(i, 1);
        }
        // prima il nome che il medico intendeva, e fra quelli il laboratorio
        // prima del POC; poi chi comincia con quello che ha scritto
        const rango = (h) => (h.perAlias ? 0 : 1) * 10 + (h.poc ? 1 : 0);
        hits.sort((a, b) => rango(a) - rango(b)
          || a.label.toUpperCase().indexOf(q) - b.label.toUpperCase().indexOf(q)
          || ordineRisorsa(a.res, cat) - ordineRisorsa(b.res, cat)
          || a.label.localeCompare(b.label));
      }
      return hits;
    }

