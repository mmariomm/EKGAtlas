//@frammento 51-panel-schede.js — Panel (segue): le schede del menu — dimissioni, iPhone, consegne, etichetta, registrazioni, ricetta SISS, terapia.
    viewDimissioni() {
      const tutte = dimissioni();
      const chiavi = Object.keys(tutte);
      // I fogli rivisti stanno in cima, gli altri sotto una riga che lo dice:
      // così si vede a colpo d'occhio dove si è già messo mano.
      let stacco = false;
      const righe = chiavi.map((k) => {
        const d = tutte[k];
        let sep = "";
        if (!d.mio && !d.rivisto && !stacco && chiavi.some((x) => tutte[x].rivisto)) {
          stacco = true;
          sep = `<div class="dsep"><span>non ancora rivisti</span></div>`;
        }
        const n = d.testo.split("\n").filter((r) => r.trim()).length;
        const segno = d.mio ? `<span class="dtuo" title="Un foglio scritto da te">tuo</span>`
          : d.aggiornato ? `<span class="dmod agg" title="L'originale è cambiato dopo la tua modifica">⟳</span>`
          : d.modificato ? `<span class="dmod" title="Testo modificato da te">•</span>` : "";
        return `${sep}
        <div class="drow">
          <button class="dcopia" data-dcopy="${esc(k)}" title="Copia negli appunti il foglio «${esc(d.nome)}»"
                  aria-label="Copia il foglio ${esc(d.nome)}">
            <span class="dnome">${esc(d.nome)}${segno}</span>
            <span class="dmeta">${n} righe</span><span class="dico">⧉</span>
          </button>
          <button class="dbtn" data-dedit="${esc(k)}" title="Modifica il testo di «${esc(d.nome)}»"
                  aria-label="Modifica il foglio ${esc(d.nome)}">✎</button>
        </div>`;
      }).join("");
      // sotto i fogli i moduli di consenso (la stessa riga), e chiuse le deleghe
      // per il ritiro, che si danno a chi va a casa
      const consensi = CONSENSI.filter((c) => !c.gruppo), ritiro = CONSENSI.filter((c) => c.gruppo === "ritiro");
      return `
        ${this.apertiHtml()}
        ${this.ricettaPossibile() ? `
        <div class="sec">
          <div class="lbl">Ricetta SISS</div>
          <button type="button" class="dnuovo" id="dimricetta" title="Farmaci (e visite) preparati nel Prescrittivo del SISS, fino all'Anteprima: Registra lo premi tu"><span class="dplus" aria-hidden="true">℞</span>Prepara la ricetta nel SISS</button>
        </div>` : ""}
        <div class="sec">
          <div class="lbl">Fogli di dimissione (${chiavi.length})</div>
          <div class="dlist">${righe}
            <button type="button" class="dnuovo" id="dimnuovo" title="Scrivi un foglio tuo: resta in cima all'elenco, su questo computer"><span class="dplus" aria-hidden="true">+</span>Nuovo foglio di dimissione</button>
          </div>
          <div class="dfile"><button type="button" class="mini" id="dimexport" title="Salva i tuoi testi in un file JSON (e negli appunti): per un altro PC, o una copia">${icoIn("esporta", 13)}Esporta i fogli</button><button type="button" class="mini" id="dimimport" title="Rimetti i testi di un JSON esportato (o salvato da dimissioni.html)">${icoIn("importa", 13)}Importa i fogli…</button></div>
        </div>
        <div class="sec consensi">
          <div class="lbl" title="${esc(this.notaModuli())}">Moduli di consenso (${consensi.length})</div>
          <div class="mlist">${consensi.map((c) => this.rigaModulo(c)).join("")}</div>
        </div>
        ${ritiro.length ? `
        <details class="sec ritiro" id="ritiro"${this.ritiroAperto ? " open" : ""}>
          <summary title="${esc(this.notaModuli())}">Moduli per il ritiro</summary>
          <div class="mlist">${ritiro.map((c) => this.rigaModulo(c)).join("")}</div>
        </details>` : ""}`;
    }

    // The editor keeps a draft in tabStore at every keystroke: the EHR retitles
    // the page (which re-renders the panel) and reloads it under the doctor's
    // hands, and a rewritten sheet must never die to something he did not do.
    dimDraftKey(k) { return "dimdraft." + k; }
    viewDimTesto() {
      const k = this.viewId;
      // un foglio nuovo non è ancora nell'elenco: nasce vuoto, nome compreso
      const nuovo = k === DIM_NUOVO;
      const d = nuovo ? { nome: "", testo: "", mio: true, nuovo: true } : dimissioni()[k];
      if (!d) return `<div class="hint">Testo non disponibile.</div>`;
      const bozza = tabStore.get(this.dimDraftKey(k), null);
      const testo = bozza && typeof bozza.testo === "string" ? bozza.testo : d.testo;
      const nome = bozza && typeof bozza.nome === "string" ? bozza.nome : d.nome;
      const bottoni = `
            <button class="mini" id="dimcopy" title="Copia questo testo senza salvarlo">⧉ Copia</button>
            <button class="mini" id="dimsave" title="${nuovo ? "Aggiungi questo foglio ai tuoi" : "Tieni questo testo per le prossime dimissioni"}">✓ Salva</button>
            ${d.modificato && !nuovo ? `<button class="mini${this.armatoDi("dimreset:" + this.viewId) ? " armato" : ""}" id="dimreset" title="${d.mio ? "Elimina questo foglio" : "Butta le tue modifiche e riprendi l'originale"}">${this.armatoDi("dimreset:" + this.viewId) ? (d.mio ? DIM_VIA_ARMATO : EO_RESET_ARMATO) : d.mio ? "✕ Elimina" : "↺ Originale"}</button>` : ""}`;
      // i fogli tuoi si possono anche rinominare; quelli del pannello no
      const testa = d.mio
        ? `<div class="dhd"><input class="dtit" id="dimnome" type="text" maxlength="60" value="${esc(nome)}" spellcheck="false" autocomplete="off"
             placeholder="Nome del foglio — es. Lombalgia acuta" aria-label="Nome del foglio">${bottoni}</div>`
        : `<div class="lbl">${esc(d.nome)}${bottoni}</div>`;
      return `
        <div class="sec">
          ${testa}
          ${d.aggiornato ? `<div class="banner warn">L'originale è cambiato dopo la tua modifica: ↺ Originale per la versione nuova.</div>` : ""}
          ${!nuovo && (testo !== d.testo || nome !== d.nome) ? `<div class="banner ok">Bozza non salvata.</div>` : ""}
          <textarea class="dedit" id="dimarea" spellcheck="false" aria-label="Testo del foglio ${esc(nome || "nuovo")}"
            placeholder="Terapia, controlli, quando tornare">${esc(testo)}</textarea>
          <div class="hint">Niente dati del paziente: è un modello.</div>
        </div>`;
    }

    // ⋯ → iPhone: la pagina «iPhone» dell'estensione (ponte.html: il QR, il
    // codice, Associa, Revoca, Prova la rete) dentro il pannello, in una
    // cornice. Una cornice e non un disegno del pannello: la pagina del
    // gestionale può leggere l'ombra del pannello (è aperta), non una cornice
    // dell'estensione — e il QR porta la chiave dell'associazione. Se la
    // cornice non si apre (una pagina fuori dalle origini del gestionale, un
    // blocco), la pagina va in una scheda come prima, e il pannello lo dice.
    viewIphone() {
      if (!this._ponteNo) return `<div class="ponteslot" id="ponteslot"></div>`;
      return `<div class="sec ponteno">
        <div class="banner warn"><b>Qui la pagina dell'iPhone non si apre nel pannello</b>${this._ponteNo === "scheda"
          ? "L'ho aperta in una scheda sua, accanto a questa." : this._ponteNo === "apro" ? "La apro in una scheda sua…"
          : "E nemmeno in una scheda: ricarica la pagina e riprova."}</div>
        <button class="btn ghost" id="ponteapri">Aprila in una scheda</button></div>`;
    }
    ponteCornice() {
      if (this._ponte) return this._ponte;
      const f = document.createElement("iframe");
      f.id = "pontecornice";
      f.title = "Il pannello sull'iPhone";
      const c = this._ponte = { f, pronto: false, timer: 0 };
      // la pagina dice «pronto» appena parte; caricata senza dirlo (bloccata, una pagina d'errore) o mai caricata: in una scheda
      const aspetta = (ms) => { clearTimeout(c.timer); c.timer = setTimeout(() => { if (this._ponte === c && !c.pronto) this.ponteInScheda(); }, ms); };
      f.addEventListener("load", () => { if (!c.pronto) aspetta(1500); });
      aspetta(8000);
      if (!this._ponteAscolta) {
        this._ponteAscolta = true;
        let mia = "";
        try { mia = new URL(chrome.runtime.getURL("")).origin; } catch { /* estensione ricaricata */ }
        // solo la nostra cornice (la pagina non può fingersi lei), e solo due parole: nessun dato passa di qui
        window.addEventListener("message", (e) => {
          const p = this._ponte;
          if (!p || !mia || e.origin !== mia || e.source !== p.f.contentWindow || !e.data) return;
          if (e.data.psassistPonte === "pronto") { p.pronto = true; clearTimeout(p.timer); }
          else if (e.data.psassistPonte === "esc" && !this.collapsed) this.riduci();
        });
      }
      try { f.src = chrome.runtime.getURL("ponte.html"); } catch { aspetta(0); }
      return c;
    }
    // Il ridisegno rifà l'ombra da capo: la cornice si mette da parte prima
    // (nell'host, fuori dall'ombra: c'è ma non si vede) e torna al suo posto
    // dopo; ridotto il pannello, aspetta lì. moveBefore la sposta senza
    // ricaricarla (il QR resta davanti); dove non c'è, si ricarica.
    ponteParcheggia() {
      const f = this._ponte && this._ponte.f;
      if (!f || !f.isConnected || f.parentNode === this.host || typeof this.host.moveBefore !== "function") return;
      try { this.host.moveBefore(f, null); } catch { /* si ricaricherà */ }
    }
    ponteRimetti() {
      const posto = this.root.querySelector("#ponteslot");
      if (!posto) { if (this.view !== "iphone" || this._ponteNo) this.ponteChiudi(); return; }
      const f = this.ponteCornice().f;
      if (f.parentNode === posto) return;
      if (f.isConnected && typeof posto.moveBefore === "function") { try { posto.moveBefore(f, null); return; } catch { /* sotto */ } }
      posto.append(f);
    }
    ponteChiudi() {
      const c = this._ponte;
      if (!c) return;
      this._ponte = null;
      clearTimeout(c.timer);
      c.f.remove();
    }
    async ponteInScheda() {
      this.ponteChiudi();
      this._ponteNo = "apro";
      if (this.view === "iphone") this.render();
      const r = await ask({ t: "ponteApri" });
      this._ponteNo = r && r.ok ? "scheda" : "no";
      if (this.view === "iphone") this.render();
    }

    // ⋯ → Consegne: al cambio turno, una riga per paziente nell'ordine del
    // tabellone — il posto, COGNOME N. ed età, da quanto è in PS, quello che
    // aspetta (Lab · ECG · RX col tempo, come la riga corta del tabellone), le
    // cose da fare aperte. Solo quello che il tabellone sa già: niente da
    // leggere, niente di salvato. «Copia» dà le stesse righe in testo,
    // «Stampa» le manda al dialogo di stampa: solo al tocco, portano dei nomi.
    consegne(ora = Date.now()) {
      const m = this.pazModello();
      return inOrdineTabellone(m).filter(({ i }) => !i.prec).map(({ i }) => {
        const { p } = i, st = statoEsami(statoDi(p.ep), ora), aspetta = inAttesa(st, ora);
        const eta = Number.isInteger(p.eta) ? p.eta : String(p.pk || "").startsWith("cf:") ? etaDaCf(p.pk.slice(3)) : null;
        const df = dfAperte(p.ep, m.df).map((x) => (x.t != null ? `${hhmm(x.t)} ${x.testo}` : x.testo));
        // (una lettura vecchia lo dice: l'attesa è contata da allora)
        const parti = [this.nomePosto(m, i), `${i.breve}${i.coda}${eta != null ? ` ${eta}` : ""}`, p.arrivo ? `in PS ${attesaTesto(minDa(p.arrivo, ora))}` : "",
          aspetta.length ? `Aperti: ${aspetta.map((x) => `${x.nome}${x.tempo ? " " + x.tempo : ""}`).join(", ")}${st.vecchio ? ` (letto ${hhmm(st.letto)})` : ""}` : "",
          df.length ? `Da fare: ${df.join("; ")}` : ""];
        return { parti, chi: 1, testo: parti.filter(Boolean).join(" · ") };
      });
    }
    // ⋯ → Etichetta: poche righe scritte dal medico, sull'etichettatrice di
    // questo PC e/o in Infermeria (la stazione collegata). L'anteprima e il PDF
    // li fa l'estensione dalla stessa impaginazione (etichetta.js): l'anteprima
    // è alla misura vera, e il PDF è lei. «Stampa» manda, «Annulla» no. Un
    // numero (rid) per stampa: rimandata (la risposta persa), non stampa due
    // volte. Il testo resta solo qui, finché la schermata è aperta.
    apriEtichetta() {
      if (!this._eti) this._eti = { testo: "", copie: 1, dest: "", ant: null, occ: false, esito: null, rid: "" };
      this.setView("etichetta");
      this.etiAnteprima();
    }
    etiAnteprima() {
      const e = this._eti;
      if (!e) return;
      const testo = e.testo, n = (e.nAnt = (e.nAnt || 0) + 1);
      ask({ t: "etichettaAnteprima", testo }).then((r) => {
        if (this._eti !== e || e.nAnt !== n) return;
        e.ant = r && (r.ok || r.errore) ? r : { ok: false, errore: "PS Assist non risponde: ricarica la pagina" };
        const d = (r && r.dove) || {};
        if (!e.dest || (e.dest !== "stazione" && !d.qui) || (e.dest !== "qui" && !d.stazione)) e.dest = d.qui ? "qui" : d.stazione ? "stazione" : "";
        if (this.view !== "etichetta") return;
        // (mentre si scrive: solo l'anteprima e Stampa, il campo non si ridisegna)
        const box = this.root.getElementById("etiant");
        if (box && this.root.activeElement && this.root.activeElement.id === "etitesto") {
          box.innerHTML = this.etiAntHtml();
          const b = this.root.getElementById("etistampa");
          if (b) b.disabled = !this.etiPronta();
        } else this.render();
      });
    }
    etiPronta() { const e = this._eti; return !!(e && e.ant && e.ant.ok && e.dest && !e.occ); }
    etiAntHtml() {
      const e = this._eti, a = e && e.ant;
      if (!a) return `<small>Preparo l'anteprima…</small>`;
      if (!a.ok) return `<div class="etierr" role="alert">${esc(a.errore || "Anteprima non disponibile")}</div>`;
      const mm = (pt) => Math.round(pt * 25.4 / 72);
      return `${a.svg}<small>${mm(a.misura[0])}×${mm(a.misura[1])} mm · ${a.righe} ${a.righe === 1 ? "riga" : "righe"} · corpo ${String(a.corpo).replace(".", ",")} pt · così esce</small>`;
    }
    viewEtichetta() {
      const e = this._eti || (this._eti = { testo: "", copie: 1, dest: "", ant: null, occ: false, esito: null, rid: "" });
      const d = (e.ant && e.ant.dove) || {};
      const dove = [d.qui ? ["qui", `Questo PC (${d.qui})`] : null, d.stazione ? ["stazione", d.stazione] : null, d.qui && d.stazione ? ["entrambi", "Tutt'e due"] : null].filter(Boolean);
      const x = e.esito;
      return `
        <div class="sec eti">
          <div class="lbl">Testo · al massimo 4 righe da 32 caratteri</div>
          <textarea id="etitesto" rows="4" maxlength="200" spellcheck="false" autocomplete="off" placeholder="Scrivi qui: ogni riga va a capo così">${esc(e.testo)}</textarea>
          <div class="etiant" id="etiant" aria-live="polite">${this.etiAntHtml()}</div>
          <div class="etirow"><label for="eticopie">Copie</label><input id="eticopie" type="number" min="1" max="10" step="1" value="${e.copie}">
            ${dove.length ? `<span>Su</span>${dove.map(([k, t]) => `<button type="button" class="mini${e.dest === k ? " on" : ""}" data-etidove="${k}" aria-pressed="${e.dest === k}">${esc(t)}</button>`).join("")}`
              : e.ant ? `<span class="etierr">Nessuna etichettatrice: impostala in ⋯ → Impostazioni, o collega una stazione di stampa</span>` : ""}</div>
          <div class="etiaz"><button class="btn primary" id="etistampa"${this.etiPronta() ? "" : " disabled"}>${e.occ ? "Stampo…" : "Stampa"}</button><button class="btn" id="etiannulla">Annulla</button></div>
          ${x ? `<div class="ricstato ${esc(x.tono === "run" ? "" : x.tono)}" id="etiesito" role="status"><b>${esc(x.titolo)}</b>${x.testo ? ` · ${esc(x.testo)}` : ""}</div>` : ""}
        </div>`;
    }
    legaEtichetta($) {
      const e = this._eti;
      if (!e) return;
      const t = $("#etitesto");
      if (t) {
        t.addEventListener("input", () => {
          e.testo = t.value; e.sel = [t.selectionStart, t.selectionEnd]; e.rid = ""; e.esito = null;
          clearTimeout(this._etiT); this._etiT = setTimeout(() => this.etiAnteprima(), 120);
        });
        t.addEventListener("focus", () => { e.fuoco = true; });
        // (un ridisegno toglie il campo e lo rimette, col cursore: lì il fuoco non si è perso)
        t.addEventListener("blur", () => setTimeout(() => { e.fuoco = !!(this.root.activeElement && this.root.activeElement.id === "etitesto"); }, 0));
        if (e.fuoco) { t.focus(); if (e.sel) try { t.setSelectionRange(e.sel[0], e.sel[1]); } catch { /* ignore */ } }
      }
      $("#eticopie")?.addEventListener("change", (ev) => {
        const n = Math.trunc(Number(ev.target.value));
        e.copie = n >= 1 && n <= 10 ? n : Math.min(10, Math.max(1, n || 1)); e.rid = "";
        this.render();
      });
      for (const b of this.root.querySelectorAll("[data-etidove]")) b.addEventListener("click", () => { e.dest = b.dataset.etidove; e.rid = ""; this.render(); });
      $("#etiannulla")?.addEventListener("click", () => { this._eti = null; this.tornaDaVista(); });
      $("#etistampa")?.addEventListener("click", () => this.etiStampa());
    }
    async etiStampa() {
      const e = this._eti;
      if (!this.etiPronta()) return;
      // (un numero per stampa: lo stesso se la risposta di prima si era persa — il PC non la rifà)
      if (!e.rid) e.rid = "et" + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
      e.occ = true; e.esito = { tono: "run", titolo: e.dest === "stazione" ? `Stampo in ${(e.ant.dove || {}).stazione || "Infermeria"}…` : "Stampo…", testo: "" };
      this.render();
      const r = await ask({ t: "etichettaStampa", testo: e.testo, copie: e.copie, dest: e.dest, rid: e.rid, misura: e.ant.misura });
      e.occ = false;
      if (this._eti !== e) return;
      if (r.perso) e.esito = { tono: "warn", titolo: "Non so se è stampata", testo: "guarda la stampante; Stampa di nuovo non la rifà se è già partita" };
      else if (!r.ok) { e.esito = { tono: "err", titolo: r.errore || "Etichetta NON stampata", testo: "" }; e.rid = ""; if (r.misura) this.etiAnteprima(); }
      else {
        e.esito = r.dati;
        if (!r.gia && r.nota) this.log(`${now()}  ${r.nota}`);
        e.rid = "";   // (finita: un altro Stampa è un'altra etichetta)
      }
      this.render();
    }
    viewConsegne() {
      const righe = this.consegne();
      if (!righe.length) return `<div class="sec"><div class="hint">Nessun paziente nel tabellone.</div></div>`;
      return `
        <div class="sec consegne">
          <div class="lbl">Pazienti (${righe.length})<button class="mini" id="conscopia" title="Le stesse righe, in testo, negli appunti">⧉ Copia</button><button class="mini" id="consstampa" title="Queste righe al dialogo di stampa">Stampa</button></div>
          <div class="conslist">${righe.map((r) => `<div class="consr">${r.parti.map((x, k) => (!x ? "" : k === r.chi ? `<b>${esc(x)}</b>` : esc(x))).filter(Boolean).join(" · ")}</div>`).join("")}</div>
        </div>`;
    }

    // ⋯ → Registrazioni (registra.js nel service worker). In testa la
    // registrazione a mano (Registra / Ferma e salva: anonimizzata e salvata
    // QUI, nell'estensione — nessuna scheda, nessuno scarico), poi la
    // registrazione automatica (gli ultimi 3 minuti, salvati da soli quando un
    // ordine finisce male), poi gli zip salvati: quando, quanto, a mano o
    // automatica e perché, il controllo; per ognuno il riepilogo, «Scarica sul
    // PC» e «Cancella» (due tocchi). Gli stessi zip li vede e scarica l'iPhone.
    // Niente pazienti: solo i nomi degli zip e i loro numeri.
    apriRegistrazioni() { this.setView("registrazioni"); if (hasExt()) this.caricaRegistrazioni(); }
    caricaRegistrazioni() {
      if (this._regCarica) { this._regDiNuovo = true; return; }
      this._regCarica = ask({ t: "registraLista" }).then((r) => {
        this._regCarica = null;
        if (r && r.ok) { this.regLista = r; this.reg = r.stato || null; }
        else if (!this.regLista) this.regLista = { ok: false };
        if (this._regDiNuovo) { this._regDiNuovo = false; return this.caricaRegistrazioni(); }
        if (this.view === "registrazioni" && !this.root.activeElement?.matches?.("textarea, input:not([type=checkbox])")) this.render();
      });
    }
    viewRegistrazioni() {
      // in fondo, chiuso, il Registro delle operazioni di questa scheda (⧉ Copia, senza il quesito); senza
      // l'estensione (il preferito) c'è solo lui, aperto
      const copiaTit = hasExt() && !TABELLONE
        ? "Copia il registro negli appunti, pseudonimizzato come le registrazioni: nomi, codici fiscali, date e numeri dei casi diventano finti, il quesito viene omesso. Il resto resta: rileggilo prima di mandarlo."
        : "Copia il registro negli appunti: i nomi dei pazienti che il pannello conosce e i codici fiscali vengono tolti, il quesito viene omesso. Il resto resta com'è: rileggilo prima di mandarlo.";
      const registro = `<details class="sec reg" id="registro"${this.registroAperto || !hasExt() ? " open" : ""}><summary>Registro <button class="mini" id="copylog" title="${esc(copiaTit)}">⧉ Copia</button></summary><div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div></details>`;
      if (!hasExt()) return registro;
      const L = this.regLista;
      if (!L) { this.caricaRegistrazioni(); return `<div class="sec"><div class="hint">Leggo le registrazioni…</div></div>${registro}`; }
      if (!L.ok) return `<div class="sec"><div class="hint">PS Assist non risponde: ricarica la pagina e riprova.</div></div>${registro}`;
      const r = this.reg, occ = this.regOcc || "";
      const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
      const giorno = (ts) => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
      const min = Math.round((L.finestra || 180000) / 60000);
      let testa;
      if (r && r.stato === "rec" && Date.now() < r.scade) {
        testa = `<div class="tnow regnow"><span class="recchip">● REC</span><span class="tlab">dalle ${esc(hhmm(r.inizio))} · si ferma e si salva da sola alle ${esc(hhmm(r.scade))}</span>
          <button class="btn primary" id="regferma"${occ ? " disabled" : ""}>${occ === "ferma" ? "Salvo…" : "Ferma e salva"}</button></div>`;
      } else if ((r && r.salvo && Date.now() - r.salvo < 5 * 60e3) || occ === "ferma" || occ === "salva") {
        testa = `<div class="tnow regnow"><span class="tlab">Salvo la registrazione: anonimizzo e controllo, qui su questo PC…</span></div>`;
      } else if (r && r.stato === "fermo") {
        const armata = this.armatoDi("reg:grezzo");
        testa = `<div class="regko" role="alert">Registrazione ferma ma non salvata${r.errore ? `: ${esc(r.errore)}` : ""}.</div>
          <button class="btn primary" id="regsalva">Salva di nuovo</button><button class="btn ghost${armata ? " armato" : ""}" id="regbutta">${armata ? "La cancello? Tocca di nuovo" : "Cancellala da questo PC"}</button>`;
      } else {
        testa = `<button class="btn ghost" id="regvia"><span class="recpt" aria-hidden="true">●</span> Registra</button>
          <div class="hint">Le pagine, le richieste e i PDF di questa sessione, per al più 60 minuti. «Ferma e salva» la anonimizza e la salva qui, nell'estensione: la vedi qui sotto e dall'iPhone.</div>`;
      }
      const auto = L.auto !== false;
      const righe = (L.lista || []).map((z) => {
        const armata = this.armatoDi("reg:" + z.id), aperta = this.regRiep === z.id, scarica = occ === "pc:" + z.id;
        return `<div class="regrow" data-zip="${esc(z.id)}">
          <div class="rr1"><b>${esc(giorno(z.quando || z.ts))} ${esc(hhmm(z.quando || z.ts))}</b><span class="regtag${z.motivo === "auto" ? " auto" : ""}">${z.motivo === "auto" ? "automatica" : "a mano"}</span><span class="rkb">${esc(kb(z.byte))}</span></div>
          ${z.motivo === "auto" && z.errore ? `<div class="rr2">${esc(z.errore)}</div>` : ""}
          <div class="rr3"><span class="${z.controllo ? "rok" : "rko"}">${z.controllo ? "controllo superato" : `restano ${z.punti} dati da controllare`}</span> · ${esc(z.nome)}</div>
          <div class="rr4"><button class="mini" data-regriep="${esc(z.id)}" aria-expanded="${aperta}">Riepilogo</button><button class="mini" data-regpc="${esc(z.id)}"${scarica ? " disabled" : ""}>${scarica ? "Scarico…" : "Scarica"}</button><button class="mini via${armata ? " armato" : ""}" data-regvia="${esc(z.id)}">${armata ? "Cancello? Tocca di nuovo" : "Cancella"}</button></div>
          ${aperta ? `<pre class="regriep">${esc(z.riepilogo || "")}</pre>` : ""}
        </div>`;
      }).join("");
      const tot = (L.lista || []).reduce((n, z) => n + (z.byte || 0), 0);
      return `
        <div class="sec registrazioni">
          ${testa}
          <label class="regauto"><input type="checkbox" id="regauto" role="switch"${auto ? " checked" : ""}><span><b>Registrazione automatica</b> · ${auto ? "accesa" : "spenta"}</span></label>
          <div class="hint">${auto ? `Tiene in memoria gli ultimi ${min} minuti di lavoro (su questo PC; spariscono chiudendo il browser) e, quando un ordine finisce male, li salva da sola, anonimizzati.`
            : "Spenta: niente in memoria, niente salvato da solo."}${r && r.stato === "rec" ? " Mentre registri a mano, vale la tua." : ""}</div>
          <div class="lbl">Salvate (${(L.lista || []).length})${tot ? `<span class="ttot">${esc(kb(tot))}</span>` : ""}</div>
          ${righe ? `<div class="reglist">${righe}</div>` : `<div class="hint">Nessuna registrazione salvata.</div>`}
          ${(L.lista || []).length > 1 ? `<button class="mini via${this.armatoDi("reg:*") ? " armato" : ""}" id="regtutte">${this.armatoDi("reg:*")
            ? `Cancello tutte le ${(L.lista || []).length} registrazioni? Tocca di nuovo` : "Cancella tutto"}</button>` : ""}
          <div class="hint">Al più 30 zip e 300 MB: oltre, se ne vanno i più vecchi, prima gli automatici. Ogni zip porta anche il Registro e le diagnosi di quei minuti.</div>
        </div>${registro}`;
    }
    legaRegistrazioni($) {
      const dopo = (x, ok, no) => {
        this.regOcc = "";
        this.message = x && x.ok ? ok(x) : (no || ((y) => `Non riuscito: ${(y && y.why) || "PS Assist non risponde: ricarica la pagina"}`))(x);
        this.caricaRegistrazioni();
        this.render();
      };
      const fatto = (x) => {
        const z = x.zip || {};
        const quanto = z.byte >= 1048576 ? `${(z.byte / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round((z.byte || 0) / 1024))} KB`;
        const cosa = `${z.nome} (${quanto}) — ${z.pagine} pagine, ${z.richieste} richieste, ${z.pdf} PDF`;
        return z.controllo ? { ok: `Salvata: ${cosa}. Controllo superato.` } : `Salvata, ma restano ${z.punti} dati da controllare: guarda il riepilogo prima di mandarla. ${cosa}.`;
      };
      $("#regvia")?.addEventListener("click", async () => {
        const x = await ask({ t: "registraVia" });
        dopo(x, () => ({ ok: "Registro questa sessione (al più 60 minuti). Quando hai finito: Ferma e salva." }));
      });
      $("#regferma")?.addEventListener("click", async () => {
        this.regOcc = "ferma"; this.render();
        dopo(await ask({ t: "registraFerma" }), fatto);
      });
      $("#regsalva")?.addEventListener("click", async () => {
        this.regOcc = "salva"; this.render();
        dopo(await ask({ t: "registraSalva" }), fatto);
      });
      // due tocchi, per il grezzo non salvato e per ogni zip (dueTocchi)
      const arma = (id) => this.dueTocchi("reg:" + id, () => { if (this.view === "registrazioni") this.render(); });
      $("#regbutta")?.addEventListener("click", async () => {
        if (!arma("grezzo")) return;
        dopo(await ask({ t: "registraButta" }), () => ({ ok: "Registrazione cancellata da questo PC." }));
      });
      $("#regauto")?.addEventListener("change", async (e) => {
        const x = await ask({ t: "registraAuto", acceso: e.target.checked });
        dopo(x, (y) => ({ ok: y.auto ? "Registrazione automatica accesa." : "Registrazione automatica spenta: quello che aveva in memoria è cancellato." }));
      });
      this.root.querySelectorAll("[data-regriep]").forEach((b) => b.addEventListener("click", () => {
        const id = b.getAttribute("data-regriep");
        this.regRiep = this.regRiep === id ? null : id;
        this.render();
      }));
      this.root.querySelectorAll("[data-regvia]").forEach((b) => b.addEventListener("click", async () => {
        const id = b.getAttribute("data-regvia");
        if (!arma(id)) return;
        const nome = ((this.regLista && this.regLista.lista) || []).find((z) => z.id === id)?.nome || "la registrazione";
        dopo(await ask({ t: "registraCancella", id }), () => ({ ok: `Cancellata: ${nome}.` }));
      }));
      $("#regtutte")?.addEventListener("click", async () => {
        if (!arma("*")) return;
        dopo(await ask({ t: "registraCancellaTutte" }), (y) => ({ ok: `Cancellate ${y.n} registrazioni.` }));
      });
      this.root.querySelectorAll("[data-regpc]").forEach((b) => b.addEventListener("click", () => this.scaricaRegistrazione(b.getAttribute("data-regpc"))));
    }
    // «Scarica»: lo zip a pezzi dal service worker, un file nei Download
    async scaricaRegistrazione(id) {
      if (this.regOcc) return;
      this.regOcc = "pc:" + id; this.render();
      const parti = [];
      let nome = "", n = 1, err = "";
      for (let i = 0; i < n; i++) {
        const x = await ask({ t: "registraPezzo", id, i });
        if (!(x && x.ok && typeof x.b === "string")) { err = (x && x.why) || "il registratore non risponde"; break; }
        n = x.n; nome = x.nome;
        const bin = atob(x.b), u = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
        parti.push(u);
      }
      this.regOcc = "";
      if (err) { this.message = `Non scaricata: ${err}.`; this.render(); return; }
      const url = URL.createObjectURL(new Blob(parti, { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url; a.download = nome;
      document.documentElement.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      this.message = { ok: `Nei Download: ${nome}.` };
      this.render();
    }

    // ⋯ → Ricetta SISS. Si scelgono i farmaci (i preferiti, che si imparano da
    // soli dalle Anteprime del SISS, o la ricerca — quella del SISS, scritta
    // nella sua scheda), quantità e «non sostituibile», un quesito; «Prepara
    // nel SISS» li fa scrivere nel Prescrittivo (ricetta-sw.js, ricetta-siss.js)
    // fino all'Anteprima. Registra lo preme il medico, nel SISS. Qui niente del
    // paziente resta: codice fiscale e nome partono col tocco, e il service
    // worker li butta appena la ricetta finisce.
    // (anche sulle altre pagine del paziente, la dimissione per prima: il codice fiscale lo dà la sua testata)
    ricettaPossibile() { return hasExt() && (this.pageType === "patient" || this.pageType === "vista") && !!this.epDiQuesta() && !TABELLONE; }
    seguiRicetta() {
      this.ric = this.ric || { voci: [], q: "", quesito: null };
      this.ricJob = null; this.ricPref = [];
      const leggi = () => Promise.all([chrome.storage.session.get("ricetta").catch(() => ({})), chrome.storage.local.get("ricetta.preferiti.v1").catch(() => ({}))]).then(([a, b]) => {
        const prima = JSON.stringify([this.ricJob, this.ricPref]);
        this.ricJob = a.ricetta || null;
        // (i preferiti: i fissati 📌 nel tuo ordine, poi i più usati, poi i più recenti)
        this.ricPref = (Array.isArray(b["ricetta.preferiti.v1"]) ? b["ricetta.preferiti.v1"] : []).filter((x) => x && x.codice)
          .sort((x, y) => (Number(x.pin) || 1e9) - (Number(y.pin) || 1e9) || (Number(y.n) || 1) - (Number(x.n) || 1) || (y.ts || 0) - (x.ts || 0));
        if (this.view === "ricetta" && JSON.stringify([this.ricJob, this.ricPref]) !== prima) this.ricRidisegna();
        this.stripRicetta();
      }).catch(() => {});
      try {
        leggi();
        chrome.storage.onChanged.addListener((ch, area) => { if ((area === "session" && ch.ricetta) || (area === "local" && ch["ricetta.preferiti.v1"])) leggi(); });
      } catch { /* senza la memoria dell'estensione niente ricetta */ }
    }
    // il ridisegno non toglie il campo sotto le dita
    ricRidisegna() {
      const a = this.root.activeElement, id = a && a.id, sel = a && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
      this.render();
      const el = id && /^ric/.test(id) && this.root.getElementById ? this.root.getElementById(id) : null;
      if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* campo numerico */ } } }
    }
    ricAttiva(j) { return !!j && ["attesa", "login", "identifico", "pronto", "compilo"].includes(j.stato); }
    // La ricetta nel SISS parla nella stessa striscia degli ordini (e, a
    // pannello aperto, nel chip in intestazione), non solo in ⋯ → Ricetta: a
    // che punto è, e ⏹ la ferma; finita, com'è andata sulla pagina di quel
    // paziente — pronta in Anteprima, «apri il SISS» (la scheda del SISS non
    // viene davanti da sola mentre scrivi). Gli ordini vengono prima: la
    // ricetta prende la striscia quando non ha altro da dire.
    stripRicetta() {
      if (LAVORO || TABELLONE) return;
      const j = this.ricJob;
      const mia = !!(this.striscia && this.striscia.daRicetta);
      if (this.runState || (this.striscia && !mia)) return;
      const attiva = this.ricAttiva(j);
      const finita = !!j && !attiva && !!j.fine && Date.now() - j.fine < 10 * 60e3 && j.ep === this.epDiQuesta() && this._ricLetta !== j.id;
      if (!attiva && !finita) { if (mia) { this._firmaRic = ""; this.segnala(null); } return; }
      const v = j.vista || {};
      const davanti = j.stato === "anteprima" || j.stato === "inserite";
      const tono = j.grave || j.stato === "errore" ? "err" : attiva ? (j.stato === "login" ? "warn" : "run") : davanti || j.stato === "fermo" ? "warn" : "ok";
      const s = { tag: "Ricetta", testo: j.stato === "anteprima" ? "pronta in Anteprima: Registra lo premi tu" : v.testo || "", tono,
        paziente: j.nome || (finita ? nomeInPagina() : ""), daRicetta: j.id,
        ...(attiva ? { onStop: () => ask({ t: "ricettaFerma", id: j.id }), ferma: true, titoloStop: "Ferma la ricetta" }
          : { onStop: () => { this._ricLetta = j.id; this._firmaRic = ""; this.segnala(null); }, titoloStop: "Chiudi l'avviso" }),
        ...(j.worker != null && (davanti || j.stato === "compilo" || j.stato === "fermo")
          ? { azione: { label: "Apri il SISS", titolo: "Porta davanti la scheda del SISS", fn: () => ask({ t: "ricettaApri", id: j.id }) } } : {}) };
      const firma = JSON.stringify(s);
      if (mia && firma === this._firmaRic) return;
      this._firmaRic = firma;
      this.segnala(s);
    }
    // il codice fiscale del riquadro del paziente, uno solo (le righe separate da <br>: testo per testo)
    ricCf() {
      const r = riquadroPaziente(document);
      if (!r) return "";
      const parti = [], giro = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let n = giro.nextNode(); n; n = giro.nextNode()) parti.push(n.nodeValue);
      const tutti = [...new Set(parti.join(" ").toUpperCase().match(new RegExp(CF_UNO.source, "g")) || [])];
      return tutti.length === 1 ? tutti[0] : "";
    }
    // la ricetta di QUESTO paziente (l'episodio), o nessuna
    ricQui() { const j = this.ricJob; return j && j.ep === this.epDiQuesta() ? j : null; }
    // un quesito già scritto in un campo «Diagnosi» della pagina, se ce n'è uno solo
    ricDiagnosi() {
      const c = [...document.querySelectorAll('textarea[name="DIAGNOSI"], input[name="DIAGNOSI"], textarea[name^="DIAGNOSI_"], input[name^="DIAGNOSI_"]')]
        .map((x) => String(x.value || "").replace(/\s+/g, " ").trim()).filter(Boolean);
      return c.length === 1 ? c[0].slice(0, 256) : "";
    }
    // (`cerca`: che cosa scrivere nella ricerca del SISS per ritrovarlo — la
    // ricerca fatta, o la prima parola della descrizione)
    // Farmaci (codice AIC, 9 cifre) o visite/esami (il codice della
    // prestazione): una ricetta alla volta, mai mescolati (non è provato che il
    // SISS li tenga insieme). Una visita non ha quantità né «non sostituibile».
    ricTipoDi(codice) { return /^\d{9}$/.test(String(codice || "")) ? "farmaco" : "visita"; }
    ricVoce(codice, descr, qta, cerca) {
      const r = this.ric;
      if (r.voci.some((v) => v.codice === codice) || r.voci.length >= 10) return;
      const tipo = this.ricTipoDi(codice);
      if (r.voci.some((v) => (v.tipo || "farmaco") !== tipo)) { this.message = "Una ricetta alla volta: farmaci o visite"; return; }
      const parola = cerca || String(descr || "").split(/[*\s]/)[0];
      r.voci.push(tipo === "farmaco" ? { codice, descr, tipo, qta: Math.max(1, Math.min(99, Number(qta) || 1)), ns: false, cerca: parola } : { codice, descr, tipo, cerca: parola });
      return r.voci[r.voci.length - 1];
    }
    ricConVisite() { return !!this.ric && this.ric.voci.some((v) => v.tipo === "visita"); }
    // il quesito: con le visite solo quello scritto da te (il campo «Diagnosi» della pagina non vale)
    ricQuesito() { const r = this.ric; return !r ? "" : this.ricConVisite() && !r.quesitoMio ? "" : r.quesito || ""; }
    viewRicetta() {
      const r = this.ric || (this.ric = { voci: [], q: "", quesito: null });
      if (r.quesito == null) r.quesito = this.ricDiagnosi();
      const j = this.ricQui(), altro = this.ricAttiva(this.ricJob) && !j;
      const attiva = this.ricAttiva(j);
      const cf = this.ricCf(), nome = nomeInPagina();
      const scelti = new Set(r.voci.map((v) => v.codice));
      const visite = this.ricConVisite();
      const pref = (this.ricPref || []).map((p) => `<span class="ricchipw${p.pin ? " fisso" : ""}" data-ricw="${esc(p.codice)}"${p.pin ? ` draggable="true" title="Trascina per cambiare l'ordine (o Alt+← →)"` : ""}><button class="ricchip${scelti.has(p.codice) ? " on" : ""}" data-ricpref="${esc(p.codice)}" aria-pressed="${scelti.has(p.codice)}" title="${esc(p.codice)}${this.ricTipoDi(p.codice) === "visita" ? " · visita/esame" : ` · quantità ${esc(p.qta || 1)}${p.ns ? " · non sostituibile" : ""}${Object.entries(p.campi || {}).map(([k, v]) => ` · ${esc(k)}: ${esc(v)}`).join("")}`} · ${esc(p.n || 1)} volte">${esc(p.descr)}</button><button class="ricpin${p.pin ? " on" : ""}" data-ricpin="${esc(p.codice)}" aria-pressed="${!!p.pin}" aria-label="${p.pin ? "Togli da" : "Fissa fra"} i preferiti: ${esc(p.descr)}" title="${p.pin ? "Fissato: tocca per toglierlo (Alt+← → lo sposta)" : "Fissa in testa"}">📌</button></span>`).join("");
      const ris = attiva && j.risultati && j.cerca && j.risultati.n === j.cerca.n ? j.risultati : null;
      const risHtml = !ris ? "" : `<div class="ricris">${ris.voci.map((v) => `<button class="ricrisv${scelti.has(v.codice) ? " on" : ""}" data-ricadd="${esc(v.codice)}" data-descr="${esc(v.descr)}" data-tipo="${this.ricTipoDi(v.codice)}"><b>${esc(v.codice)}</b> ${esc(v.descr)}${this.ricTipoDi(v.codice) === "visita" ? ` <i class="rictipo">visita/esame</i>` : ""}</button>`).join("")
        || `<div class="ricnota">Niente per «${esc(ris.q)}»${ris.why ? ` (${esc(ris.why)})` : ""}.</div>`}</div>`;
      const righe = r.voci.map((v, i) => `
        <div class="ricv" data-ricriga="${esc(v.codice)}">
          <span class="ricvd" title="${esc(v.codice)}">${esc(v.descr || v.codice)} <i>${esc(v.codice)}</i></span>
          ${v.tipo === "visita" ? `<i class="rictipo">visita/esame</i>` : `
          <label class="ricq">Qtà <input type="number" min="1" max="99" id="ricqta${i}" data-ricqta="${i}" value="${esc(v.qta)}" aria-label="Quantità di ${esc(v.descr)}"></label>
          <label class="ricns"><input type="checkbox" id="ricns${i}" data-ricns="${i}"${v.ns ? " checked" : ""}> non sostituibile</label>`}
          <button class="ricx" data-ricvia="${i}" title="Togli" aria-label="Togli ${esc(v.descr)}">✕</button>
        </div>`).join("");
      const puo = !!cf && !!nome && r.voci.length > 0 && !altro && !(attiva && j.voci);
      const tono = !j ? "" : j.grave || j.stato === "errore" ? "err" : (j.vista && j.vista.tono) || "";
      return `
        <div class="sec ricetta">
          ${!cf ? `<div class="ricstato warn">Codice fiscale non trovato nella pagina: la ricetta si fa a mano nel SISS.</div>` : ""}
          ${altro ? `<div class="ricstato warn">C'è una ricetta in preparazione nel SISS per un altro paziente: aspetta che finisca.</div>` : ""}
          <div class="lbl">Preferiti</div>
          <div class="ricpref">${pref || `<span class="ricnota">Ancora nessuno: si imparano da soli dalle ricette che arrivano in Anteprima nel SISS.</span>`}</div>
          <div class="lbl">Cerca nel SISS</div>
          <div class="riccerca">
            <input id="ricq" type="search" autocomplete="off" spellcheck="false" value="${esc(r.q)}" placeholder="Farmaco o visita: augmentin, tachipirina…" aria-label="Cerca nel SISS: un farmaco, una visita, un esame">
            <button class="ricbtn" id="riccerca"${!cf || altro || (attiva && j.voci) ? " disabled" : ""}>Cerca</button>
          </div>
          ${attiva && j.cerca && !ris ? `<div class="ricnota">Cerco «${esc(j.cerca.q)}» nel SISS…</div>` : risHtml}
          <div class="lbl">Nella ricetta${r.voci.length ? ` (${r.voci.length})` : ""}</div>
          <div class="ricvoci">${righe || `<span class="ricnota">Scegli un preferito o un risultato della ricerca.</span>`}</div>
          <div class="lbl">Quesito diagnostico</div>
          <input id="ricquesito" class="ricquesito" maxlength="256" autocomplete="off" value="${esc(this.ricQuesito())}" placeholder="(facoltativo)" aria-label="Quesito diagnostico">
          <button class="btn primary" id="ricprepara"${puo ? "" : " disabled"}>Prepara nel SISS</button>
          ${j && j.vista ? `<div class="ricstato ${esc(tono)}" id="ricstato" role="status">${esc(j.vista.testo)}${attiva ? ` <button class="ricbtn" id="ricferma">Ferma</button>` : ""}</div>` : ""}
          <div class="ricnota">${visite ? "Con una visita si ferma prima dell'Anteprima: quesito, durata e Anteprima li fai tu nel SISS."
            : "Si ferma sull'Anteprima del SISS: Registra (e la stampa) li premi tu."}</div>
        </div>`;
    }
    legaRicetta($) {
      const r = this.ric;
      if (!r) return;
      const ridisegna = () => this.ricRidisegna();
      $("#ricq")?.addEventListener("input", (e) => { r.q = e.target.value; });
      $("#ricq")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.ricCerca(); } });
      $("#riccerca")?.addEventListener("click", () => this.ricCerca());
      $("#ricquesito")?.addEventListener("input", (e) => { r.quesito = e.target.value; r.quesitoMio = true; });
      this.root.querySelectorAll("[data-ricpref]").forEach((b) => b.addEventListener("click", () => {
        const c = b.getAttribute("data-ricpref"), p = (this.ricPref || []).find((x) => x.codice === c);
        this.message = null;
        if (r.voci.some((v) => v.codice === c)) r.voci = r.voci.filter((v) => v.codice !== c);
        else if (p) {
          const v = this.ricVoce(p.codice, p.descr, p.qta);
          if (v && v.tipo === "farmaco") { v.ns = !!p.ns; if (p.campi && typeof p.campi === "object") v.campi = { ...p.campi }; v.freq = (this.ricPref || []).indexOf(p) + 1; }
        }
        ridisegna();
      }));
      // 📌 fissa/togli; i fissati si riordinano trascinandoli (o Alt+← → sul 📌)
      const fissi = () => (this.ricPref || []).filter((x) => x.pin).map((x) => x.codice);
      const ordina = (l) => ask({ t: "ricettaFissa", ordine: l });
      this.root.querySelectorAll("[data-ricpin]").forEach((b) => {
        const c = b.getAttribute("data-ricpin");
        b.addEventListener("click", () => ask({ t: "ricettaFissa", codice: c, pin: b.getAttribute("aria-pressed") !== "true" }));
        b.addEventListener("keydown", (e) => {
          if (!e.altKey || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
          const l = fissi(), i = l.indexOf(c), k = i + (/Left|Up/.test(e.key) ? -1 : 1);
          if (i < 0 || k < 0 || k >= l.length) return;
          e.preventDefault();
          [l[i], l[k]] = [l[k], l[i]];
          this._ricFuoco = c;
          ordina(l);
        });
        if (this._ricFuoco === c) { this._ricFuoco = null; b.focus({ preventScroll: true }); }
      });
      let tirato = null;
      this.root.querySelectorAll(".ricchipw.fisso").forEach((w) => {
        const c = w.getAttribute("data-ricw");
        w.addEventListener("dragstart", (e) => { tirato = c; try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c); } catch { /* niente */ } });
        w.addEventListener("dragover", (e) => { if (tirato && tirato !== c) e.preventDefault(); });
        w.addEventListener("drop", (e) => {
          e.preventDefault();
          const da = tirato || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
          tirato = null;
          const l = fissi(), i = l.indexOf(da), k = l.indexOf(c);
          if (i < 0 || k < 0 || i === k) return;
          l.splice(i, 1); l.splice(k, 0, da);
          ordina(l);
        });
        w.addEventListener("dragend", () => { tirato = null; });
      });
      this.root.querySelectorAll("[data-ricadd]").forEach((b) => b.addEventListener("click", () => {
        const j = this.ricQui(), c = b.getAttribute("data-ricadd");
        this.message = null;
        if (r.voci.some((v) => v.codice === c)) r.voci = r.voci.filter((v) => v.codice !== c);
        else this.ricVoce(c, b.getAttribute("data-descr"), 1, (j && j.cerca && j.cerca.q) || "");
        ridisegna();
      }));
      this.root.querySelectorAll("[data-ricqta]").forEach((x) => x.addEventListener("input", () => {
        const v = r.voci[Number(x.getAttribute("data-ricqta"))];
        if (v) v.qta = Math.max(1, Math.min(99, Math.round(Number(x.value) || 1)));
      }));
      this.root.querySelectorAll("[data-ricns]").forEach((x) => x.addEventListener("change", () => {
        const v = r.voci[Number(x.getAttribute("data-ricns"))];
        if (v) v.ns = !!x.checked;
      }));
      this.root.querySelectorAll("[data-ricvia]").forEach((b) => b.addEventListener("click", () => { r.voci.splice(Number(b.getAttribute("data-ricvia")), 1); ridisegna(); }));
      $("#ricprepara")?.addEventListener("click", () => this.ricPrepara());
      $("#ricferma")?.addEventListener("click", () => { const j = this.ricQui(); if (j) ask({ t: "ricettaFerma", id: j.id }); });
    }
    ricNuovoId() { return "ric-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
    async ricChiedi(msg) {
      const x = await ask(msg);
      if (!(x && x.ok)) { this.message = (x && x.why) || "PS Assist non risponde: ricarica la pagina e riprova."; this.ricRidisegna(); }
      return x;
    }
    async ricCerca() {
      const r = this.ric, q = String((r && r.q) || "").trim();
      if (q.length < 3) { this.message = "Scrivi almeno 3 lettere da cercare nel SISS."; return this.ricRidisegna(); }
      this.message = null;
      const j = this.ricQui();
      if (this.ricAttiva(j) && !j.voci) return this.ricChiedi({ t: "ricettaCerca", id: j.id, q });
      const cf = this.ricCf(), nome = nomeInPagina();
      if (!cf || !nome) return;
      return this.ricChiedi({ t: "ricettaNuova", job: { id: this.ricNuovoId(), ep: this.epDiQuesta(), cf, nome, voci: null, cerca: q } });
    }
    async ricPrepara() {
      const r = this.ric;
      if (!r || !r.voci.length) return;
      if (this._ricVia && Date.now() - this._ricVia < 1500) return;   // (un doppio tocco è un tocco)
      this._ricVia = Date.now();
      const voci = r.voci.map((v) => ({ codice: v.codice, tipo: v.tipo || "farmaco", descr: v.descr, qta: v.qta, ns: v.ns, cerca: v.cerca, ...(v.campi ? { campi: v.campi } : {}) }));
      for (const v of r.voci) if (v.freq) this.log(`${now()}  ricetta: farmaco frequente ${v.freq}`);   // (mai il paziente)
      if (new Set(voci.map((v) => v.tipo)).size > 1) { this.message = "Una ricetta alla volta: farmaci o visite"; return this.ricRidisegna(); }
      const j = this.ricQui(), quesito = String(this.ricQuesito() || "").trim();
      this.message = null;
      if (this.ricAttiva(j) && !j.voci) return this.ricChiedi({ t: "ricettaPrepara", id: j.id, voci, quesito });
      const cf = this.ricCf(), nome = nomeInPagina();
      if (!cf || !nome) return;
      return this.ricChiedi({ t: "ricettaNuova", job: { id: this.ricNuovoId(), ep: this.epDiQuesta(), cf, nome, voci, quesito } });
    }

    // ⋯ → Terapia. I farmaci da mettere nella pagina Terapia del gestionale
    // (vedi «la terapia», terapiaQui): i preferiti — farmaco e dose come li
    // hai confermati in quella pagina, i più usati in cima — o un farmaco
    // nuovo, da scegliere nella tendina della pagina. «Prepara nel gestionale»
    // apre la pagina col suo pulsante e riempie la riga nuova, un farmaco per
    // Conferma; Conferma la premi tu, sempre.
    terapiaPossibile() { return hasExt() && !TABELLONE && this.pageType === "patient" && !!this.epDiQuesta(); }
    // il pulsante «Terapia» di QUESTO paziente, uno solo
    terapiaLink() { return linkTerapia(this.epDiQuesta()); }
    terRidisegna() {
      const a = this.root.activeElement, id = a && a.id, sel = a && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
      this.render();
      const el = id && /^ter/.test(id) && this.root.getElementById ? this.root.getElementById(id) : null;
      if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* niente */ } } }
    }
    viewTerapia() {
      const t = this.ter || (this.ter = { voci: [], q: "" });
      const pref = terapiaPreferiti(), q = normTer(t.q).toUpperCase();
      const scelte = new Set(t.voci.map(chiaveTer));
      const dose = (p) => [p.qta && `${p.qta}${p.um ? " " + p.um.t : ""}`, !p.qta && p.um && p.um.t, p.via && p.via.t, p.dil && p.dil.t,
        p.freq && `freq. ${p.freq}`, p.durata && `durata ${p.durata}`, p.continua && "continua", p.bisogno && "al bisogno"].filter(Boolean).join(" · ");
      const lista = (q ? pref.filter((p) => normTer(p.descr).toUpperCase().includes(q)) : pref).slice(0, 30);
      const righe = lista.map((p) => { const k = chiaveTer(p); return `<button class="ricrisv${scelte.has(k) ? " on" : ""}" data-terpref="${esc(k)}" aria-pressed="${scelte.has(k)}" title="${esc(p.descr)} — ${esc(dose(p) || "senza dose")}"><b>${esc(p.descr)}</b> ${esc(dose(p))}</button>`; }).join("");
      const nuovo = q.length >= 3 && !lista.some((p) => normTer(p.descr).toUpperCase() === q);
      const voci = t.voci.map((v, i) => `
        <div class="ricv"><span class="ricvd" title="${esc(v.descr)}">${i + 1}. ${esc(v.descr)} <i>${esc(v.nuovo ? "da scegliere nella tendina" : dose(v))}</i></span>
          <button class="ricx" data-tervia="${i}" title="Togli" aria-label="Togli ${esc(v.descr)}">✕</button></div>`).join("");
      const link = this.terapiaLink();
      return `
        <div class="sec ricetta">
          ${link ? "" : `<div class="ricstato warn">Il pulsante «Terapia» del gestionale non c'è in questa pagina: la terapia si scrive a mano.</div>`}
          <div class="lbl">Preferiti</div>
          <div class="riccerca"><input id="terq" type="search" autocomplete="off" spellcheck="false" value="${esc(t.q)}" placeholder="Cerca un farmaco…" aria-label="Cerca fra i preferiti, o un farmaco nuovo"></div>
          <div class="ricris">${righe || `<span class="ricnota">${pref.length ? `Nessun preferito con «${esc(t.q)}».` : "Ancora nessuno: si imparano da soli da quello che confermi nella pagina Terapia del gestionale."}</span>`}
            ${nuovo ? `<button class="ricrisv" id="ternuovo" title="Lo scrivo nella tendina della pagina Terapia: la voce la scegli tu">＋ «${esc(normTer(t.q))}»: da scegliere nella tendina del gestionale</button>` : ""}</div>
          <div class="lbl">Da preparare${t.voci.length ? ` (${t.voci.length})` : ""}</div>
          <div class="ricvoci">${voci || `<span class="ricnota">Scegli un preferito, o cerca un farmaco.</span>`}</div>
          <button class="btn primary" id="terprepara" style="margin-top:10px"${link && t.voci.length && !this.giroQui() ? "" : " disabled"}>Prepara nel gestionale</button>
          <div class="ricnota">Apro la pagina Terapia del gestionale e scrivo un farmaco nella riga nuova: lo controlli e premi tu Conferma; dopo la Conferma preparo il successivo. Conferma non la premo mai.</div>
        </div>`;
    }
    legaTerapia($) {
      const t = this.ter;
      if (!t) return;
      $("#terq")?.addEventListener("input", (e) => { t.q = e.target.value; this.terRidisegna(); });
      $("#ternuovo")?.addEventListener("click", () => {
        const d = normTer(t.q).slice(0, 200);
        if (d.length >= 3 && t.voci.length < 10) t.voci.push({ descr: d, nuovo: true });
        t.q = ""; this.terRidisegna();
      });
      this.root.querySelectorAll("[data-terpref]").forEach((b) => b.addEventListener("click", () => {
        const k = b.getAttribute("data-terpref"), p = terapiaPreferiti().find((x) => chiaveTer(x) === k);
        if (t.voci.some((v) => chiaveTer(v) === k)) t.voci = t.voci.filter((v) => chiaveTer(v) !== k);
        else if (p && t.voci.length < 10) { const { n, ts, ...v } = p; t.voci.push(v); }
        this.terRidisegna();
      }));
      this.root.querySelectorAll("[data-tervia]").forEach((b) => b.addEventListener("click", () => { t.voci.splice(Number(b.getAttribute("data-tervia")), 1); this.terRidisegna(); }));
      $("#terprepara")?.addEventListener("click", () => this.terPrepara());
    }
    // apre la pagina Terapia col suo pulsante; il resto lo fa terapiaQui, là
    async terPrepara() {
      const t = this.ter;
      if (!t || !t.voci.length || this._terVia || this.giroQui()) return;
      const a = this.terapiaLink(), ep = this.epDiQuesta(), nome = nomeInPagina();
      if (!a || !ep || !nome) { this.message = "Il pulsante «Terapia» o il nome del paziente non ci sono in questa pagina."; return this.render(); }
      const perche = staScrivendo();
      if (perche) { this.message = `Prima finisci nella pagina (${perche}), poi «Prepara nel gestionale».`; return this.render(); }
      this._terVia = true;
      try {
        if (motoreAltrove()) { this.message = "Aspetto che finisca l'ordine in corso in un'altra scheda…"; this.render(); await cancelloMotore(); }
        if (motoreAltrove()) { this.message = "Un ordine sta ancora lavorando in un'altra scheda: riprova fra poco."; return this.render(); }
        if (this.terapiaLink() !== a || this.epDiQuesta() !== ep) return;
        const intanto = staScrivendo();   // (intanto hai cominciato a scrivere nella pagina?)
        if (intanto) { this.message = `Prima finisci nella pagina (${intanto}), poi «Prepara nel gestionale».`; return this.render(); }
        tabStore.set(TERAPIA, { id: "ter-" + Date.now().toString(36), ep, nome, voci: t.voci.map((v) => ({ ...v })), i: 0, fase: "apro", ts: Date.now() });
        this.message = { ok: "Apro la pagina Terapia del gestionale…" };
        this.render();
        a.click();
      } finally { this._terVia = false; }
    }

