//@frammento 45-panel-viste.js — Panel (segue): VIEWS — render(), menu ⋯, distintivo della mini, pannello scaduto, viewHome.
    // =============================================================== VIEWS
    // Compact always-visible selection strip: plain text grouped by resource
    // ("POC: EMOGAS, EMOCROMO · URGENZE: PCT"), an ✕ appears on hover.
    selbarHtml() {
      if (!this.selected.size || this.pageType === "vista") return "";
      if (this.pageType === "patient" && !(this.entry && (this.entry.labUrl || this.entry.radioUrl))) return "";
      const byRes = {};   // per nome corto: Urgenze e centrale sono un gruppo solo
      for (const i of this.selected.values()) (byRes[risorsaCorta(i.res)] = byRes[risorsaCorta(i.res)] || []).push(i);
      const groups = Object.entries(byRes).map(([r, arr]) => {
        const items = arr.map((i) =>
          `<span class="selitem" title="${esc(i.label)}">${esc(i.display || shortLabel(i.label))}<button class="selx" data-unsel="${esc(this.key(i.res, i.code))}" title="Rimuovi" aria-label="Rimuovi ${esc(i.display || shortLabel(i.label))}">✕</button></span>`
        ).join(", ");
        return `<span class="selgrp">${esc(r.toUpperCase())}:</span> ${items}`;
      });
      return `<div class="selbar">${groups.map((g) => `<div class="selrow">${g}</div>`).join("")}</div>`;
    }
    // Il menu ⋯ a sezioni (Paziente · Strumenti · Impostazioni): un titolo
    // piccolo e sotto le voci, due per riga se corte (una lunga prende la
    // riga). Una sezione che qui non ha voci non c'è.
    menuSez(titolo, voci) {
      const v = voci.filter(Boolean).join("");
      return v ? `<div class="msez" role="group"${titolo ? ` aria-label="${esc(titolo)}"><div class="mtit" aria-hidden="true">${esc(titolo)}</div>` : ">"}${v}</div>` : "";
    }

    // Il distintivo della build mini (sola lettura): niente pannello, solo una
    // riga discreta in basso a sinistra. Dice che il PC è in sola lettura e,
    // quando il telefono è collegato, lo mostra con «Scollega» — come la spia
    // del pannello pieno, perché chi è davanti al PC lo veda e la possa chiudere.
    renderBadge() {
      const viva = !!(PONTE_STATO && PONTE_STATO.sessione);
      this.root.innerHTML = `<style>:host{all:initial}
        .b{position:fixed;left:12px;bottom:12px;z-index:2147483646;display:inline-flex;align-items:center;gap:8px;
           font:12px/1.3 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0B2C50;
           background:#EAF0F6;border:1px solid #C6D4E4;border-radius:999px;padding:5px 11px;box-shadow:0 2px 8px rgba(11,44,80,.12);opacity:.85}
        .b.viva{background:#E6F5EE;border-color:#A6D8BF;color:#0A5A33}
        .dot{width:7px;height:7px;border-radius:50%;background:#6B8CAE;flex:none}
        .b.viva .dot{background:#17A05B;animation:psaPulse 1.6s ease-in-out infinite}
        @keyframes psaPulse{0%,100%{opacity:1}50%{opacity:.35}}
        button{border:0;background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer;text-decoration:underline;padding:0 0 0 4px}</style>
        <div class="b${viva ? " viva" : ""}" role="status" title="PS Assist · questo PC è una porta d'ingresso in sola lettura per l'iPhone del medico">
          <span class="dot"></span><span>${viva ? "👁️ iPhone collegato · sola lettura" : "👁️ PS Assist · sola lettura"}</span>${
          viva ? `<button id="solaoff" title="Chiude la sessione dell'iPhone">Scollega</button>` : ""}</div>`;
      const off = this.root.getElementById("solaoff");
      if (off) off.addEventListener("click", (e) => { e.stopPropagation(); ask({ t: "ponteScollega" }); });
    }
    // Il pannello di prima di un aggiornamento: una riga, e un tocco riapre la
    // pagina con una GET dello stesso indirizzo (come la pillola di
    // aggiornata.js: mai un «ricarica» che rimanderebbe un modulo).
    renderScaduta() {
      if (this.root.getElementById("psscaduta")) return;
      const leggibile = leggibilePagina(location.href);
      this.root.innerHTML = `<style>:host{all:initial}
        button{position:fixed;right:12px;bottom:12px;z-index:2147483646;border:0;border-radius:999px;padding:9px 15px;
          font:600 13px -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#fff;background:#0B5CAD;box-shadow:0 6px 20px rgba(9,42,74,.25);cursor:pointer}
        button:focus-visible{outline:2px solid #fff;outline-offset:-4px}</style>
        <button type="button" id="psscaduta" title="Questo pannello è quello di prima dell'aggiornamento: non manda ordini e non stampa">${
          leggibile ? "PS Assist aggiornata · Ricarica la pagina" : "PS Assist aggiornata · Riapri la pagina dal gestionale"}</button>`;
      this.root.getElementById("psscaduta").addEventListener("click", () => { if (leggibile) location.assign(location.href.split("#")[0]); });
    }
    render() {
      // La build mini non ha il pannello degli ordini: solo un distintivo
      // discreto «sola lettura», che diventa «iPhone collegato · Scollega»
      // quando una sessione del telefono è aperta (chi passa davanti al PC lo
      // sa e la può chiudere). Ogni chiamata a render() finisce qui.
      if (SOLA_LETTURA) return this.renderBadge();
      if (extPersa()) return this.renderScaduta();
      const patientName = this.pageType === "vista" ? this.nomePaziente() : nomeInPagina();
      // (su una pagina «altra» l'episodio è quello che il pannello ha
      // riconosciuto, o nessuno: non il primo link che la pagina porta)
      const ep = this.pageType === "vista" ? this.episodeId || "" : findEpisodeId(document, location.href);
      // keep every scroll position across re-renders (chip toggles must not
      // bounce the panel back to the top), sideways too: dopo un paziente
      // portato la mappa, la lista e le aree restano dove li hai lasciati
      const scorre = (el) => {
        const a = el.classList.contains("starbody") && el.closest("[data-area]");
        return a ? `[data-area="${CSS.escape(a.getAttribute("data-area"))}"] .starbody` : "." + ["bd", "list", "rlist", "stcanvas", "pzcoda", "pzpiede", "tdcorpo"].find((c) => el.classList.contains(c));
      };
      const keepScroll = [...this.root.querySelectorAll(".bd, .list, .rlist, .stcanvas, .pzcoda, .pzpiede, .starbody, .tdcorpo")]
        .filter((el) => el.scrollTop || el.scrollLeft).map((el) => [scorre(el), el.scrollTop, el.scrollLeft]);
      // ridotta e riaperta (il mouse che passa e ripassa): la schermata torna come l'avevi lasciata, scorrimento compreso
      const eraAperta = !!this.root.querySelector(".card");
      if (eraAperta && this.collapsed) this._scorreRidotta = { view: this.view, l: keepScroll };
      else if (!eraAperta && !this.collapsed && this._scorreRidotta) {
        if (this._scorreRidotta.view === this.view) keepScroll.push(...this._scorreRidotta.l);
        this._scorreRidotta = null;
      }
      // la lista «Da fare» aperta si riapre uguale (dfRiattacca), con quello che
      // si stava scrivendo e il cursore dov'era; il menu della sveglia si chiude
      const din = this.root.querySelector("#dfin");
      if (din && this._df) { this._df.inFuoco = this.root.activeElement === din; this._df.sel = [din.selectionStart, din.selectionEnd]; }
      this.promChiudiMenu();
      this.cartaChiudi();   // la scheda al passaggio non sopravvive al ridisegno

      // Il resoconto di un giro (un errore, un ⏹, la ricevuta) sta nelle
      // Richieste, con le schede: dagli Esiti si torna e «Riprova» è ancora lì.
      // Dove la fila non ha le Richieste di quel paziente (la «Nuova
      // richiesta», la scheda di un altro paziente) prende la finestra, come prima.
      const resoTab = this.resoNelleRichieste(patientName);
      let body;
      if (this.runState === "running") body = this.viewRunning();
      else if (this.runState && (!resoTab || this.view === "richieste")) body = this.viewResult();
      else if (this.view === "esiti") body = this.viewEsiti();
      else if (this.view === "referto") body = this.viewEsiti();   // (non c'è più: il testo si apre negli Esiti)
      else if (this.view === "dimissioni") body = this.viewDimissioni();
      else if (this.view === "dimtesto") body = this.viewDimTesto();
      else if (this.view === "eotesto") body = this.viewEoTesto();
      else if (this.view === "dimimport") body = this.viewDimImport();
      else if (this.view === "eo") body = this.viewEo();
      else if (this.view === "registrazioni") body = this.viewRegistrazioni();
      else if (this.view === "ricetta" && this.ricettaPossibile()) body = this.viewRicetta();
      else if (this.view === "terapia" && this.terapiaPossibile()) body = this.viewTerapia();
      else if (this.view === "consegne") body = this.viewConsegne();
      else if (this.view === "etichetta" && hasExt()) body = this.viewEtichetta();
      else if (this.view === "iphone" && hasExt()) body = this.viewIphone();
      else if (this.view === "stampa") body = this.viewStampa();
      else if (this.view === "richieste") body = this.viewIdle(patientName, ep);
      else body = this.viewHome(patientName, ep);
      // i Pazienti (la lista sopra, la stanza sotto) prendono tutta la finestra che resta
      const inStanza = this.inPazienti();

      const running = this.runState === "running";
      const { badgeEsami, fase } = this.statoGiro();
      // The panel is titled by the PATIENT it is acting on — collapsed too.
      // Dove un paziente non c'è (la lista del PS) il titolo della pagina è
      // «PRONTO SOCCORSO - LISTA»: quello non va mai dove va un nome.
      const sulPaziente = !!this.epDiQuesta();
      const who = (this.runState && this.runPatient) || (sulPaziente ? patientName : "") || APP;
      // Sei su un'altra scheda: il giro continua (le richieste portano il loro
      // episodio), ma va detto a chiare lettere di chi sono gli esami.
      const altrove = !!(this.runState && this.runPatient && patientName && this.runPatient !== patientName);
      // la striscia di quello che succede fuori dalla finestra: rossa per un
      // errore, ambra quando tocca a te
      const strWho = (this.striscia && this.striscia.paziente) || who;
      const strTono = !this.striscia ? "" : this.striscia.tono === "err" ? "err" : this.striscia.tono === "warn" ? "warn" : "";
      const chiPill = this.avvisoPill || ((this.runState || sulPaziente) ? who : "Pazienti");
      const pillInner = running
        ? `<span class="dot"></span> <span class="who">${esc(who)}</span>${badgeEsami ? ` <span class="badge">${esc(badgeEsami)}</span>` : ""}`
        : this.selected.size && !this.avvisoPill
          ? `${LOGO} <span class="who">${esc(chiPill)}</span> <span class="badge">${this.selected.size}</span>`
          : `${LOGO} <span class="who">${esc(chiPill)}</span>`;

      // whose data is on screen must be answerable at a glance, always:
      // patient in the title, episode always next to the section name.
      const inHome = (!this.runState || resoTab) && this.view === "home";
      const section = this.runState && !resoTab ? "" : { richieste: "Richieste", esiti: "Esiti", referto: "Referto", dimissioni: "Dimissioni", dimtesto: "Dimissioni", dimimport: "Dimissioni", eo: "EO", eotesto: "EO", registrazioni: "Registrazioni", consegne: "Consegne", etichetta: "Etichetta", iphone: "iPhone", ricetta: "Ricetta", terapia: "Terapia" }[this.view] || "";
      // (i fogli di dimissione sono modelli, ma chi va a casa è questo paziente:
      // l'intestazione lo dice anche lì)
      const inDim = this.view === "dimissioni" || this.view === "dimtesto" || this.view === "dimimport";
      // accanto al nome, il secondo identificativo: età e sesso, l'episodio e
      // il posto — su ogni scheda, Dimissioni comprese: di chi sono i dati, e
      // per chi sono le azioni, sempre a colpo d'occhio
      const idp = sulPaziente && !inHome && !this.runState ? this.idPaz() : null;
      const sub = idp ? [idp.es, ep ? `ep. ${ep}` : "", idp.posto].filter(Boolean).map(esc).join(" · ") : "";
      // Il titolo è il paziente, e solo lui: dove non c'è, niente titolo — lo
      // dice la scheda accesa, e sulla lista PS la scheda Pazienti fa anche da ‹.
      // Il ‹ resta sul paziente, e dentro un referto o un foglio di dimissione.
      // (le schermate del menu ⋯ hanno il loro ‹ nel titolo, al posto delle schede: torna alla scheda di prima)
      const vm = this.vistaMenu();
      // in cima alla scheda del paziente, i SUOI Da fare, come la lista dei Pazienti (tdPazHtml)
      this._tdSolo = idp && !vm && !inStanza && !TABELLONE && this.view !== "home" && this.schedePaziente() ? this.epDiQuesta() || null : null;
      const indietro = !vm && !!section && (sulPaziente || ["referto", "dimtesto", "dimimport", "eotesto"].includes(this.view));
      const titolo = this.runState || (sulPaziente && !inHome) ? who : "";
      // Aperto: una finestra al centro, l'85% dello schermo (o come l'hai
      // lasciata tu). Ridotto: la pill, dove l'hai messa (in alto a destra
      // se non l'hai mai spostata).
      const ridotto = this.collapsed;
      const forma = formaOra();
      const pp = this.pillPos;
      const pillStyle = pp && Number.isFinite(pp.left) && Number.isFinite(pp.top)
        ? `left:${Math.max(0, Math.min(window.innerWidth - 80, pp.left))}px;top:${Math.max(0, Math.min(window.innerHeight - 48, pp.top))}px;right:auto;`
        : "";
      let posStyle;
      if (TABELLONE) posStyle = "left:0;top:0;width:100%;height:100%;right:auto;";
      else if (ridotto) posStyle = pillStyle;
      else {
        const g = geometriaFinestra(this.win);
        // di partenza (niente geometria tua) la misura segue lo schermo anche
        // se il browser cambia misura: il tetto è in CSS, non nel conto di adesso
        posStyle = geometriaPropria(this.win)
          ? `left:${g.x * 100}vw;top:${g.y * 100}vh;width:${g.w * 100}vw;height:${g.h * 100}vh;right:auto;`
          : `left:max(${FINESTRA.x * 100}vw,calc((100vw - ${FINESTRA_MAX_PX}px) / 2));top:${g.y * 100}vh;width:min(${FINESTRA.w * 100}vw,${FINESTRA_MAX_PX}px);height:${g.h * 100}vh;right:auto;`;
      }
      // i valori e la stanza si leggono in larghezza; il resto su una colonna comoda

      // (Chrome manda il «blur» a un campo col fuoco PRIMA di staccarlo, quando
      // è ancora attaccato: chi ascolta il blur guarda _staccando, non isConnected)
      this._staccando = true;
      this.ponteParcheggia();   // la cornice dell'iPhone non si ridisegna: si mette da parte, e torna dopo
      try {
      this.root.innerHTML = `
        <style>${COLORS}${PONTE_CSS}</style>
        <div class="wrap${ridotto ? "" : " win"}${TABELLONE ? " tab" : ""}" style="${posStyle}">
          ${this.collapsed && !running && this.striscia ? `
            <div class="strip">
              <button class="pill run ${esc(strTono)}" id="expand" title="${esc(strWho)} — ${esc(this.striscia.titolo || (this.striscia.onTap ? "tocca per i comandi" : "tocca per aprire il pannello"))}">
                ${this.striscia.tono === "run" ? `<span class="dot"></span>` : `<span class="tick">${this.striscia.tono === "err" || this.striscia.tono === "warn" ? "!" : "✓"}</span>`}
                <span class="col">
                  <span class="l1"><b class="who">${esc(strWho)}</b>${this.striscia.tag ? ` <span class="tag">${esc(this.striscia.tag)}</span>` : ""}${
                    this.striscia.badge ? ` <span class="badge">${esc(this.striscia.badge)}</span>` : ""}</span>
                  ${this.striscia.testo ? `<span class="l2">${esc(this.striscia.testo)}</span>` : ""}
                  ${this.striscia.quesito ? `<span class="l3">${esc(this.striscia.quesito)}</span>` : ""}
                </span>
              </button>
              ${this.striscia.azione ? `<button class="strazione" id="strazione" title="${esc(this.striscia.azione.titolo || "")}">${esc(this.striscia.azione.label)}</button>` : ""}
              ${this.piegatiHtml("strpieg")}
              ${this.segnoBtnHtml("strsegno")}
              ${this.striscia.onStop ? (this.striscia.ferma
                ? `<button class="stopmini" id="strstop" title="${esc(this.striscia.titoloStop || "Ferma l'ordine")}" aria-label="${esc(this.striscia.titoloStop || "Ferma l'ordine")}">${ICO.ferma}</button>`
                : `<button class="stopmini" id="strstop" title="${esc(this.striscia.titoloStop || "Annulla (Esc)")}">✕</button>`) : ""}
            </div>
            ${this.righeHtml(this.striscia.righe)}
          ` : this.collapsed && this.runState ? `
            <div class="strip">
              <button class="pill run ${altrove ? "alt" : this.runState === "fail" ? "err" : this.runState === "stopped" ? "warn" : ""}" id="expand" title="${esc(who)}${
                altrove ? " — stai guardando un'altra scheda" : ""} — tocca per aprire il pannello">
                ${running ? `<span class="dot"></span>` : `<span class="tick">${this.runState === "done" ? "✓" : "!"}</span>`}
                <span class="col">
                  <span class="l1"><b>${esc(who)}</b>${badgeEsami ? ` <span class="badge">${esc(badgeEsami)}</span>` : ""}</span>
                  ${running ? "" : `<span class="l2">${esc(fase || (this.runState === "done" ? "fatto" : ""))}</span>`}
                </span>
              </button>
              ${running ? `<button class="stopmini" id="stopbtn" title="Interrompi" aria-label="Interrompi">${ICO.ferma}</button>` : ""}
            </div>
            ${running ? this.righeHtml([this.rigaGiro()]) : ""}
          ` : this.collapsed ? `
            <button class="pill" id="expand" title="${esc(who)}${ep ? " · episodio " + esc(ep) : ""} — ${esc(APP)}, trascina per spostare">${pillInner}${sulPaziente ? this.pillNovita() : ""}${this.chipRec()}${this.promUrgente()}${this.segnoHtml()}</button>
            ${sulPaziente ? this.dfNotaSlot(this.epDiQuesta(), undefined, `${pp && Number.isFinite(pp.left) && pp.left < window.innerWidth / 2 ? " sx" : ""}${pp && Number.isFinite(pp.top) && pp.top > window.innerHeight - 180 ? " su" : ""}`) : ""}
          ` : `
            <div class="card${inStanza ? " stanza" : ""}${this.view === "iphone" && !this.runState ? " iphone" : ""}" role="dialog" aria-label="${esc(APP)}" tabindex="-1">
              <div class="hd" id="draghd"${TABELLONE ? "" : ` title="Trascina per spostare · doppio clic per rimetterla al centro"`}>
                ${indietro ? `<button class="iconbtn" id="back" title="${
                  this.view === "referto" ? "Torna agli esiti"
                  : this.view === "dimtesto" || this.view === "dimimport" ? "Torna ai fogli di dimissione"
                  : this.view === "eotesto" ? "Torna all'esame obiettivo"
                  : "Tutti i pazienti"}" aria-label="Indietro">${ICO.indietro}</button>` : `<span class="logo">${LOGO_BLU}</span>`}${titolo ? `<b class="who">${esc(titolo)}</b>` : TABELLONE ? `<b class="who">Tabellone</b>${this.tabelloneSpia()}` : ""}
                ${sub ? `<span class="sub" title="${esc(who)} — episodio ${esc(ep || "?")}">${sub}</span>` : ""}
                ${idp && this.epDiQuesta() ? `<span class="hdpaz">${this.cuoreHtml(this.epDiQuesta())}${this.dfSlot(this.epDiQuesta(), undefined, "testa")}${this.braccialeHtml()}</span>` : ""}
                <span class="hsp"></span>
                <span id="girow">${this.chipGiro()}</span>
                ${TABELLONE ? "" : ponteSpia()}
                ${this.listaPs() && this.inPazienti() && hasExt() && !TABELLONE ? `<button class="iconbtn" id="tabapri" title="Il tabellone in una scheda sua" aria-label="Il tabellone in una scheda sua">${ICO.tabellone}</button>` : ""}
                <span id="stautow">${this.chipStampa()}</span>
                ${this.chipRec(true)}
                ${TABELLONE ? "" : `<span class="menuw">
                  <button class="iconbtn" id="menubtn" title="Altro" aria-label="Altro" aria-haspopup="true" aria-expanded="${this.menuAperto ? "true" : "false"}">${ICO.altro}</button>
                  ${this.menuAperto ? `<div class="menu" role="menu">
                    ${this.menuSez("Paziente", [
                      this.terapiaPossibile() ? `<button role="menuitem" id="termenu" title="I farmaci nella pagina Terapia del gestionale, una riga per volta: Conferma la premi tu">${mico("terapia")}Terapia</button>` : "",
                      this.pageType === "patient" && this.epDiQuesta() && richiesteStampabili(stampePaziente(this.epDiQuesta())).length
                        ? `<button role="menuitem" id="stampamenu" title="Etichette e lista esami delle richieste già confermate">${mico("etichetta")}Stampa le richieste</button>` : ""])}
                    ${this.menuSez("Strumenti", [
                      hasExt() ? `<button role="menuitem" id="tabmenu" title="Il tabellone dei Pazienti in una scheda sua: da fissare, o sul secondo schermo">${mico("tabellone")}Tabellone</button>` : "",
                      hasExt() ? `<button role="menuitem" id="pontemenu" title="Il pannello sull'iPhone: associa il telefono, prova la rete">${memo("📱")}iPhone</button>` : "",
                      hasExt() ? `<button role="menuitem" id="etimenu" title="Poche righe scritte da te, sull'etichettatrice di questo PC o in Infermeria: prima l'anteprima, poi Stampa">${mico("etichetta")}Etichetta</button>` : "",
                      hasExt() && this.pinN() ? `<button role="menuitem" id="pinmenu" title="I pazienti da rivedere nei prossimi giorni (anche dall'iPhone)">${memo("📌")}Da rivedere (${this.pinN()})</button>` : "",
                      `<button role="menuitem" id="consmenu" title="Al cambio turno: una riga per paziente — posto, nome, età, da quanto è in PS, cosa aspetta, cosa c'è da fare — da copiare o stampare">${mico("dafare")}Consegne</button>`,
                      // (quelle della stanza ci sono solo sulla mappa: in fondo, così le altre non cambiano posto)
                      inStanza && !this.stanzaEdit ? `<button role="menuitem" id="stmodmenu" title="Ritocca la stanza: aggiungi, sposta e rinomina letti, sedie e aree">${mico("matita")}Modifica la stanza</button>` : ""])}
                    ${this.menuSez("Questo PC", [
                      hasExt() ? `<button role="menuitem" id="stampanti" title="La forma del pannello, le stampanti (etichettatrice e A4), la stazione di stampa, l'indirizzo del portale, l'iPhone">${mico("impostazioni")}Impostazioni</button>` : "",
                      this.stampaAuto && this.stampaAuto.sta ? `<div class="mforma" role="group" aria-label="Dove stampano gli ordini"><span>Stampa su</span>${[["qui", "PC"], ["stazione", this.nomeStazione()]].map(([d, t]) =>
                        `<button role="menuitemradio" data-stdove="${d}" aria-checked="${this.stampaDove() === d}"${this.stampaDove() === d ? ' class="on"' : ""} title="${d === "qui" ? "I fogli degli ordini su questo PC" : `I fogli degli ordini e l'etichetta anagrafica in ${esc(this.nomeStazione())}, la stazione di stampa`}">${esc(t)}</button>`).join("")}</div>` : "",
                      `<button role="menuitem" id="regmenu" title="${hasExt() ? "Registra una sessione, gli zip salvati su questo PC (anche dall'iPhone), e in fondo il Registro delle operazioni" : "Il Registro delle operazioni di questa scheda"}">${memo("●")}Registrazioni</button>`,
                      // l'ultima, da sola sulla sua riga, in rosso: non sta accanto a niente di innocuo
                      this.giroQui() ? "" : this.resetArmato() ? `<button role="menuitem" id="resetpaz" class="mreset mrischio" title="${esc(DIMENTICA_TITOLO)}">${mico("cestino")}Dimentico tutto? Tocca di nuovo</button>`
                        : `<button role="menuitem" id="resetpaz" class="mreset" title="${esc(DIMENTICA_TITOLO)}">${mico("cestino")}Dimentica i dati…</button>`])}
                    <div class="mpiede">
                      ${this.agg ? `<div class="mver">${esc(this.agg.come)}</div>` : ""}
                      <div class="mver">${esc(APP)} ${VERSION}</div>
                    </div>
                  </div>` : ""}
                </span>`}
                ${TABELLONE ? "" : `<button class="iconbtn" id="collapse" title="Riduci alla pill (Esc)" aria-label="Riduci">${ICO.riduci}</button>`}
              </div>
              ${idp ? this.avvisiPaz(idp.ep || ep) : ""}
              ${this._tdSolo ? this.tdPazHtml(this._tdSolo) : ""}
              ${running && this.runData?.steps?.length ? `<div class="pbar"><i style="width:${Math.round((this.runData.steps.filter((x) => x.status === "ok").length / this.runData.steps.length) * 100)}%"></i></div>` : ""}
              <div class="cap">
              ${!this.runState && inStanza && this.stanzaEdit ? `
                <div class="seg modifica" role="toolbar" aria-label="Modifica la stanza">
                  <b class="segtit">Modifica la stanza</b><span class="segdx">${this.stanzaAzioni()}</span>
                </div>` : vm ? `
                <div class="seg modifica vmenu" role="toolbar" aria-label="${esc(vm.nome)}">
                  <button class="iconbtn vback" id="back" title="Torna a ${esc(this.nomeRitorno())} (Esc)" aria-label="Torna a ${esc(this.nomeRitorno())}">${ICO.indietro}</button><b class="segtit">${mico(vm.ico)}${esc(vm.nome)}</b>
                </div>` : (!this.runState || resoTab) && !TABELLONE ? `
                <div class="seg" role="tablist">
                  ${this.schedePaziente() && this.view !== "home" ? `
                  <button class="${this.view === "richieste" ? "on" : ""}" data-seg="richieste" data-t="Richieste">Richieste</button>
                  <button class="${this.view === "esiti" || this.view === "referto" ? "on" : ""}" data-seg="esiti" data-t="Esiti">Esiti</button>`
                  : `<button class="${inHome || !section ? "on" : ""}" data-seg="home" data-t="Pazienti">Pazienti</button>`}
                  <button class="${this.view === "eo" || this.view === "eotesto" ? "on" : ""}" data-seg="eo" data-t="EO" title="Esame obiettivo da copiare">EO</button>
                  <button class="${inDim ? "on" : ""}" data-seg="dimissioni" data-t="Dimissioni">Dimissioni</button>
                  ${(inHome || !section) && this.stanzaAzioni ? `<span class="segdx">${this.stanzaAzioni()}</span>` : ""}
                </div>` : ""}
              ${!this.runState ? this.selbarHtml() : ""}
              </div>
              <div class="bd"><div class="bdi">${this.view === "richieste" ? "" : this.notaHtml()}${body}</div></div>
              ${this.inPazienti() ? "" : this.stanzaSnack()}
              ${TABELLONE ? "" : `
              ${["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) => `<div class="rz rz-${d}" data-rz="${d}"></div>`).join("")}
              <div class="rsz" id="rsz" data-rz="se" title="Trascina per ridimensionare · doppio click per la misura di partenza"></div>`}
            </div>
          `}
          ${this.collapsed ? ponteSpia() : ""}
        </div>
        ${forma === "passaggio" && !ridotto && !TABELLONE ? `<div class="wrap ppass" style="${pillStyle}">
          <button class="pill${this.fissata ? " fissa" : ""}" id="pinpill" aria-pressed="${this.fissata}" title="${this.fissata
            ? "Fissata: resta aperta. Un tocco la lascia richiudere uscendo col mouse; Esc la chiude" : "Si richiude uscendo col mouse: tocca per fissarla"}">${pillInner}</button></div>` : ""}`;
      } finally { this._staccando = false; }
      this.ponteRimetti();
      this.bind();
      this.dfAdatta();
      // Al passaggio la pill resta sopra la finestra: se copre i comandi in fondo all'intestazione (⋯, —), quelli si fanno in là
      const pin = this.root.querySelector("#pinpill"), hd = this.root.querySelector("#draghd");
      if (pin && hd) {
        const a = pin.getBoundingClientRect(), b = hd.getBoundingClientRect();
        if (a.bottom > b.top && a.top < b.bottom && a.right > b.right - 90 && a.left < b.right) hd.style.paddingRight = `${Math.round(b.right - a.left) + 8}px`;
      }
      for (const [sel, top, left] of keepScroll) {
        const el = this.root.querySelector(sel);
        if (el) { el.scrollTop = top; el.scrollLeft = left; }
      }
      this._bordiStanza?.();   // i bordi sfumati della mappa, sullo scorrimento appena rimesso
      if (this._fuocoId && !this.root.activeElement) {
        const f = this.root.getElementById ? this.root.getElementById(this._fuocoId) : null;
        if (f && !/^(INPUT|TEXTAREA)$/.test(f.tagName)) f.focus({ preventScroll: true });
      }
      this.pubblicaLavoro();   // la scheda di sottofondo racconta a che punto è
    }

    // A che punto è il giro, in ESAMI (non in passi): «esame 2 di 6» — e che
    // cosa sta facendo adesso. Lo dice la striscia di questa scheda e, dalla
    // scheda di sottofondo, quella di tutte le altre.
    // (si contano quelli già passati: l'ordine in cui vanno non è quello della lista)
    statoGiro() {
      const running = this.runState === "running";
      const esami = (this.runData?.steps || []).filter((s) => s.esame);
      const passati = esami.filter((s) => s.status !== "pending" && s.status !== "running").length;
      const badgeEsami = !esami.length ? "" : esami.some((s) => s.status === "running") ? `esame ${passati + 1} di ${esami.length}`
        : passati ? `${passati} di ${esami.length}` : `${esami.length} ${esami.length === 1 ? "esame" : "esami"}`;
      const passo = (this.runData?.steps || []).find((s) => s.status === "running");
      const fase = running
        ? (passo ? `${passo.label}${passo.note ? " · " + passo.note : ""}` : "…")
        : typeof this.message === "string" ? this.message
          : (this.message?.ok || this.message?.head || this.message?.body || "");
      return { badgeEsami, fase, passati, tot: esami.length };
    }

    // HOME — the patients this shift. Picking one of the OTHERS navigates to
    // their page first: the panel never shows data belonging to a patient
    // other than the page in front of you.
    // Una vista sola: sopra la lista di chi non ha ancora un posto (una riga
    // per paziente), sotto la stanza. Messo un paziente al suo posto, la lista
    // si accorcia e la stanza sale; rimesso in lista, il letto torna vuoto.
    // In Modifica la lista si toglie di mezzo: si vede tutta la pianta, e i
    // comandi stanno nella fila delle schede (stanzaAzioni()).
    // Il TABELLONE: in alto Alta | Bassa | Entrambe (e ⟳), le mappe (due,
    // affiancate se c'è larghezza, se no una sopra l'altra: sempre in scala,
    // mai di lato), sotto la lista di tutti quelli della vista — chi ha un
    // posto e chi no.
    viewHome(patientName) {
      const T = this.pazTabellone(), edit = !!this.stanzaEdit;
      // il filtro aperto resta com'era, col cursore dov'era; vuoto e lasciato, si chiude
      const cerca = this.root.querySelector("#pzcerca");
      if (cerca && this.root.activeElement === cerca) { this._filtroFuoco = true; this._filtroSel = [cerca.selectionStart, cerca.selectionEnd]; }
      else if (this._filtro === "" && !this._filtroFuoco) this._filtro = null;   // (aperto adesso, dalla lente o da F2: il cursore ci sta per andare)
      const lista = this.modoTab() === "lista", daf = this.modoTab() === "dafare";
      this._tdTutto = daf;
      // il campo del Da fare generale col cursore dentro: dopo il ridisegno è ancora lì
      const tin = this.root.querySelector("#tdin");
      this._tdFuoco = tin && this.root.activeElement === tin ? [tin.selectionStart, tin.selectionEnd] : null;
      // «Da fare»: la barra e, sotto, lo stesso Da fare di sempre (generale e per paziente), tutto largo
      if (daf) return `<div class="sec tdsec"><div class="tdriga tdtutto"><div class="pzunita lista">${this.tabelloneBarra()}</div>${this.tdHtml(T)}</div></div>`;
      return `<div class="sec tdsec"><div class="tdriga"><div class="pzunita${edit ? " edit" : ""}${lista ? " lista" : ""}">
        ${edit ? "" : this.tabelloneBarra()}
        ${lista ? "" : `<div class="stmappe"><div class="stmappei${T.ks.length > 1 ? " due" : ""}">${T.ks.map((k) => this.conMappa(k, () => this.viewStanza(T.per.get(k)))).join("")}</div></div>`}
        ${edit ? "" : this.viewLista(T.lista, patientName)}
        ${edit ? "" : this.pazArchivio(T.lista)}
        ${lista ? "" : `<div class="pzrimetti" data-drop="tray" aria-hidden="true">${ico('<path d="M8 12.5v-9M4 7.5l4-4 4 4"/>')}Togli dal posto</div>`}
        ${this.stanzaSnack()}
      </div>${edit ? "" : this.tdHtml(T)}</div></div>`;
    }
