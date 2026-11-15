//@frammento 42-panel-classe.js — class Panel — si apre qui e si chiude in 53: constructor, continuità fra pagine, bracciale e icone
//@ di stampa del gestionale, stampanti, aggiornamento, defaultView/restoreUi.
  class Panel {
    constructor(pageType) {
      this.pageType = pageType;
      this.selected = new Map(); // "res:code" -> {res, code, label}
      this.pacchetto = "";       // il quesito-pacchetto attivo («Dispnea»), o ""
      this.pkgDa = new Set();    // gli esami che ha messo LUI (non quelli scelti a mano)
      // il quesito l'ha scritto il medico, a mano, nella casella: allora vale
      // il suo anche sopra quello del triage. Un chip o un pacchetto no.
      this.quesitoMio = false;
      this.aggiungi = false;     // sulla ricevuta: la griglia degli esami aperta con «+ aggiungi»
      this.tieneDopoErrore = null; // dopo un errore: le chiavi degli esami che mancano davvero
      const saved = tabStore.get("log." + (findEpisodeId(document, location.href) || "x"), null);
      this.logLines = saved && Date.now() - (saved.ts || 0) < 2 * 3600e3 ? saved.lines || [] : [];
      this.runState = null; // null | 'running' | 'done' | 'fail' | 'stopped'
      this.runData = null;
      this.message = null;  // string (inline) or {head, body} (result banner)
      this.stopFn = null;
      this.host = document.createElement("div");
      this.host.id = "psassist-host";
      this.root = this.host.attachShadow({ mode: "open" });
      document.documentElement.appendChild(this.host);
      // Dopo un aggiornamento questo pannello non tocca più niente: il primo
      // tocco (o tasto) lo ferma prima di ogni suo gestore, e lo ridisegna.
      if (EXT_AVVIO) {
        const ferma = (e) => {
          if (!extPersa() || e.target?.closest?.("#psscaduta")) return;
          e.stopImmediatePropagation(); e.preventDefault();
          this.render();
        };
        for (const t of ["click", "contextmenu", "keydown", "submit", "change"]) this.root.addEventListener(t, ferma, true);
        const veglia = setInterval(() => { if (extPersa()) { clearInterval(veglia); this.render(); } }, 2000);
      }
      // Aperto o ridotto, a ogni pagina. Il gestionale ricarica la pagina a
      // ogni clic: se ci è arrivato il medico dal gestionale voleva VEDERE il
      // gestionale, e la finestra all'85% glielo coprirebbe — si parte dalla
      // pill. Se ce l'ha portato il pannello (un paziente scelto qui, la fine
      // di un giro), si parte aperti.
      const daPannello = Date.now() - (Number(tabStore.get("navPannello.v1", 0)) || 0) < 30e3;
      tabStore.set("navPannello.v1", 0);
      this.collapsed = !daPannello;
      if (TABELLONE) this.collapsed = false;
      // Al passaggio: aperta dal mouse si richiude uscendo; aperta in ogni
      // altro modo (un clic, una pagina che l'apre da sola) resta, fissata
      this.fissata = true;
      this.menuAperto = false;   // il menu «⋯» dell'intestazione
      this.avvisoPill = "";      // una parola sulla pill, per pochi secondi («✓ Copiato · incolla»)
      // Che cosa sta succedendo fuori dalla finestra — conferma, etichette,
      // un errore da finire a mano — detto dalla striscia nell'angolo:
      // {tag, testo, tono: ok|run|warn|err, badge?, paziente?, onTap?, onStop?}
      this.striscia = null;
      // Gli ordini che girano nelle schede di sottofondo (dal service worker):
      // ogni scheda del gestionale ne mostra la striscia.
      this.ordini = [];
      this._lavoroChiuso = false;   // la scheda di sottofondo ha già detto l'ultima parola
      // la stampa automatica, dalla memoria dell'estensione: { s: { etichette, a4, dove }, esito }
      this.stampaAuto = null;
      this.acq = "";           // catalog search text
      this.esiti = [];                  // risultati + referti, newest first
      this.storico = null;              // the portal's multi-day table, if it is THIS patient's
      this.storicoAltri = "";           // ...or the name it belongs to, when it is not
      this.storicoVia = "dal nome";     // su cosa è stata confermata l'identità
      this.storicoDaConfermare = false; // c'è, ma serve il codice fiscale per dire che è suo
      this.portale = "";                // indirizzo del portale aggiunto dal medico
      this.soloAlterati = false;        // valori: show only what is out of range
      this.nColEsiti = 0;               // colonne della tabella degli Esiti: decide la larghezza
      this.mostraArch = false;          // l'elenco degli archiviati, aperto o chiuso
      this.rottiTab = new Set();        // prelievi che hanno già fallito: niente ritentativi da soli
      // La finestra aperta e la pill ridotta vivono in due posti diversi: la
      // finestra (frazioni dello schermo, così segue il browser che cambia
      // misura) parte al centro e prende l'85%; la pill resta dove la metti.
      this.win = store.get("win.v1", null);       // {x, y, w, h} in frazioni dello schermo
      this.pillPos = store.get("pillpos.v1", null); // {left, top} in px
      this.runPatient = null;           // patient name PINNED when a run starts
      this.episodeId = findEpisodeId(document, location.href);
      this.view = null;                 // home | richieste | esiti | valori
      this.viewId = null;               // which esito is open in 'valori'
      // The header must always show the patient this page belongs to: follow
      // any <title> change (the EHR sets it to the patient name).
      const titleEl = document.querySelector("title");
      if (titleEl) {
        this._titleObs = new MutationObserver(() => {
          // mai ricostruire una schermata in cui si sta scrivendo
          const scrive = this.root.activeElement?.id === "dfin" || !!this.root.querySelector(".dfmod");
          if (this.runState !== "running" && !scrive
              && this.view !== "dimtesto" && this.view !== "dimimport" && this.view !== "eotesto") this.render();
        });
        this._titleObs.observe(titleEl, { childList: true, characterData: true, subtree: true });
      }
      // the portal page is another tab: coming back here is the moment to look
    // for a table read in the meantime
    // (e i promemoria rifanno i conti: in una scheda nascosta il tempo non si aggiorna)
    this._visibile = () => {
      if (document.hidden) return;
      this.promTick();
      if ((this.pageType === "patient" || this.pageType === "vista") && !TABELLONE) this.caricaStorico();
    };
    document.addEventListener("visibilitychange", this._visibile);
    this._unload = (e) => { e.preventDefault(); e.returnValue = ""; };
      this._esc = (e) => {
        if (e.key !== "Escape") return;
        if (this.escLocale && this.escLocale()) {   // la stanza lo usa per sé (menu, trascinamento)
          // la lista «Da fare» aperta, col fuoco altrove: Esc chiude lei, non la finestra
          const d = this._df;
          if (d?.pop?.isConnected && !this._dfPresa && !(e.composedPath ? e.composedPath() : []).includes(d.pop)) { e.preventDefault(); this.dfChiudi(true); }
          return;
        }
        // una stampa in corso (Esc la annulla) e il conto alla rovescia della conferma: l'Esc è loro
        if (document.getElementById("psassist-print") || document.getElementById("psassist-confirm") || document.getElementById("psassist-visore")) return;
        // Esc non ferma mai un giro (nemmeno col pannello aperto: lascerebbe un
        // carrello a metà): riduce il pannello, come ovunque. Si ferma col ⏹.
        if (this.collapsed || (this.runState && this.runState !== "running")) return;
        // Altrimenti Esc riduce la finestra alla pill — ma solo se viene dal
        // pannello (o da nessuna parte: la finestra copre la pagina), e mai
        // da un campo in cui si sta scrivendo: lì Esc è del campo.
        const via = e.composedPath ? e.composedPath() : [];
        const dentro = via.includes(this.host);
        const t = via[0];
        if (!dentro && t && t !== document.body && t !== document.documentElement && t !== document) return;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
        if (this.menuAperto) { e.preventDefault(); this.menuAperto = false; this.render(); return; }
        if (this.stanzaEdit) { e.preventDefault(); this.stanzaEdit = false; this.render(); return; }
        // una schermata del menu ⋯: Esc torna alla scheda di prima, come il suo ‹
        if (this.vistaMenu()) { e.preventDefault(); this.tornaDaVista(); this.root.querySelector(".card")?.focus({ preventScroll: true }); return; }
        if (TABELLONE) return;
        e.preventDefault();
        this.riduci();
      };
      window.addEventListener("keydown", this._esc, true);
      // F2 apre e chiude il pannello, in ogni forma — non mentre si scrive in un
      // campo del gestionale. La finestra (e Al
      // passaggio) si apre sui Pazienti col filtro pronto: F2 · lettere · Invio.
      this._f2 = (e) => {
        if (e.key !== "F2" || e.repeat || TABELLONE) return;
        const via = e.composedPath ? e.composedPath() : [];
        if (!via.includes(this.host) && eCampo(via[0] || document.activeElement)) return;
        e.preventDefault();
        if (!this.collapsed) return this.riduci();
        this.apri();
        if (this.runState) return;
        if (this._filtro == null) this._filtro = "";
        this._filtroFuoco = true; this._filtroSel = null;
        this.setView("home");
      };
      window.addEventListener("keydown", this._f2, true);
      // Al passaggio: fuori dal pannello per mezzo secondo, e si richiude
      this._passaggio = (e) => {
        if (formaOra() !== "passaggio" || this.collapsed || this.fissata || (e.pointerType && e.pointerType !== "mouse")) return;
        const via = e.composedPath ? e.composedPath() : [];
        // (uscendo dalla pagina il browser manda un «out» senza dove: è fuori anche quello)
        const dentro = e.type === "pointerout" ? false : via.includes(this.host);
        if (e.type === "pointerout" && e.relatedTarget) return;
        if (dentro) { clearTimeout(this._tChiude); this._tChiude = 0; return; }
        if (!this._tChiude) this._tChiude = setTimeout(() => this.passaggioChiude(), PASSAGGIO_CHIUDE_MS);
      };
      window.addEventListener("pointermove", this._passaggio, true);
      document.addEventListener("pointerout", this._passaggio, true);
      // un gesto cominciato nel pannello (trascinare, ridimensionare, selezionare) lo tiene aperto
      this._premuto = false;
      this.root.addEventListener("pointerdown", () => { this._premuto = true; }, true);
      const lascia = () => { this._premuto = false; };
      window.addEventListener("pointerup", lascia, true);
      window.addEventListener("pointercancel", lascia, true);
      // Un clic FUORI dalla finestra (sul gestionale che si vede ai bordi) la
      // riduce alla pill: il clic intanto arriva alla pagina, non si ferma.
      // Dentro la finestra, un clic fuori dal menu «⋯» lo chiude.
      this._fuori = (e) => {
        const via = e.composedPath ? e.composedPath() : [];
        if (via.includes(this.host)) {
          if (this.menuAperto && !via.some((x) => x.classList && x.classList.contains("menuw"))) { this.menuAperto = false; this.render(); }
          return;
        }
        if (this.collapsed || this.runState === "running" || TABELLONE) return;
        if (via.some((x) => x.id === "psassist-print" || x.id === "psassist-confirm" || x.id === "psassist-visore")) return;   // le nostre finestre: stampa, conferma, visore
        this.riduci();
      };
      window.addEventListener("pointerdown", this._fuori, true);
      // il fuoco sopravvive al ridisegno: dopo ogni azione resta dov'era
      this.root.addEventListener("focusin", (e) => { const id = e.target && e.target.id; if (id) this._fuocoId = id; });
      // I promemoria: un tocco sulla pill apre il suo elenco, la sveglia apre
      // il campo. Ogni 30 secondi le pill rifanno i conti, sul posto.
      this.root.addEventListener("click", (e) => this.promClic(e));
      this.root.addEventListener("keydown", (e) => {
        const segno = e.target.closest?.("[data-prurg]");
        if (segno && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); this.promClic({ target: segno }); }
      });
      this._promOgni = setInterval(() => this.promTick(), 30e3);
    }

    // ---- cross-page continuity -------------------------------------------
    // The EHR reloads the page at every click (that's the app, not us). To
    // make the panel FEEL persistent, its working state — quesito, selected
    // exams, open sections — is saved per (tab,
    // episode) and restored on the next page of the SAME patient. A page of
    // another episode restores nothing.
    uiKey() { return this.episodeId ? `ui.${this.episodeId}` : null; }
    // the view is per (tab, episode) like the rest of the working state
    refKey() { return "refopen." + (this.episodeId || "x"); }
    risKey(id) { return `ris.${this.episodeId || "x"}.${id}`; }
    // what this draw looked like the last time the doctor actually looked at it
    vistoKey(id) { return `visto.${this.episodeId || "x"}.${id}`; }
    segnaVisto(id, rows) {
      const vals = {};
      for (const r of rows || []) { const k = valKey(r.nome); if (k) vals[k] = String(r.valore); }
      tabStore.set(this.vistoKey(id), { ts: Date.now(), vals });
    }
    // key → "nuovo" (analyte that was not there) | "cambiato" (value moved
    // since the last look). Empty until there IS a previous look: the first
    // read of a draw is the baseline, never a wall of marks.
    novita(id, rows) {
      const out = new Map();
      const seen = tabStore.get(this.vistoKey(id), null);
      if (!seen || !seen.vals) return out;
      // guardati sul telefono dopo l'ultimo sguardo qui: quello che questa scheda aveva già letto
      // allora è visto. Riletti qui dopo, si conta ancora dal suo ultimo sguardo: mai un valore
      // nuovo spento senza che qualcuno l'abbia avuto davanti.
      const tel = Number(statoDi(this.episodeId)?.valoriVisti) || 0, held = tabStore.get(this.risKey(id), null);
      if (tel > (seen.ts || 0) && held && (held.ts || 0) <= tel) { this.segnaVisto(id, rows); return out; }
      for (const r of rows || []) {
        const k = valKey(r.nome);
        if (!k) continue;
        if (!(k in seen.vals)) out.set(k, "nuovo");
        else if (seen.vals[k] !== String(r.valore)) out.set(k, "cambiato");
      }
      return out;
    }
    setView(v, id, nota) {
      // a banner belongs to the screen that raised it: changing screen clears
      // it, unless this navigation is itself carrying the answer
      // (il resoconto di un giro no: è delle Richieste, e ci si torna)
      if (!this.runState) this.message = nota || null;
      // da una scheda a una schermata del menu ⋯: il suo ‹ (ed Esc) torna lì
      if (VISTE_MENU[v] && !VISTE_MENU[this.view]) this._daVista = { v: this.view, id: this.viewId };
      else if (!VISTE_MENU[v]) this._daVista = null;
      this.view = v; this.viewId = id || null; this.persistUi(); this.render();
      if (v === "esiti") this.caricaStorico();   // letto sul portale intanto? e l'identità è cambiata?
      if (v === "esiti" && !LAVORO && !PONTE_VALORI) this.autoCarica({ esiti: true }).catch(() => {});   // un laboratorio a metà: si ricontrolla qui
    }
    // Una schermata del menu ⋯ (Registrazioni, Consegne…) al posto delle schede
    // dice dov'è: «‹ [icona] Nome». Solo dove la sua schermata si mostra davvero.
    vistaMenu(v = this.view) {
      const m = VISTE_MENU[v];
      if (!m || this.runState || TABELLONE) return null;
      if ((v === "ricetta" && !this.ricettaPossibile()) || (v === "terapia" && !this.terapiaPossibile()) || (v === "iphone" && !hasExt())) return null;
      return { nome: m[0], ico: m[1] };
    }
    // …e il suo ‹ torna alla scheda da cui si è venuti (non a «Tutti i pazienti»)
    ritorno() {
      const d = this._daVista;
      return d && !VISTE_MENU[d.v] ? d : { v: this.defaultView(), id: null };
    }
    nomeRitorno() { return NOME_SCHEDA[this.ritorno().v] || "Pazienti"; }
    tornaDaVista() { const d = this.ritorno(); this.setView(d.v, d.id); }
    // L'etichetta anagrafica, accanto agli identificativi: un link vero, quello
    // della pagina (senza la stampa automatica si apre in una scheda, come dal
    // gestionale). Con la stampa automatica, all'etichettatrice col motore e il
    // giornale di sempre, e le copie a tocchi: ogni tocco entro CLIC_FINESTRA
    // dall'ultimo è una copia in più (fino a 10, «×2» sul bottone); CLIC_FINESTRA
    // dopo l'ultimo parte UNA stampa con quelle copie (il PDF preso una volta).
    // Un tocco mentre quella stampa gira non fa niente: il bottone pulsa.
    braccialeHtml() {
      const url = this.pageType === "patient" || this.pageType === "vista" ? linkBracciale(document, this.epDiQuesta(), location.href) : "";
      return url ? `<a class="iconbtn brac" id="bracciale" href="${esc(url)}" target="_blank" title="Etichetta anagrafica" aria-label="Etichetta anagrafica">${this.braccialeDentro()}</a>` : "";
    }
    braccialeDentro() {
      // (partita e in coda dietro le etichette di un ordine: le sue copie, spente, finché non stampa)
      const coda = !this._brac && this.braccialeInCoda();
      const n = (this._brac && this._brac.n) || (coda ? coda.fogli.length : 0);
      return ICO.bracciale + (n > 1 ? `<span class="bracn${coda ? " spenta" : ""}">×${n}</span>` : "");
    }
    braccialeInCoda() {
      const url = linkBracciale(document, this.epDiQuesta(), location.href);
      const l = this.ordini || [];
      return (url && l.find((x) => x.stato === "stampo" && ((x.stampa && x.stampa.jobs) || [])[0]?.url === url
        && (x.fogli || []).every((f) => f.stato === "attesa" || f.stato === "tolto") && braccialeAspetta(l, x))) || null;
    }
    stampaBracciale(e) {
      const ep = this.epDiQuesta(), url = linkBracciale(document, ep, location.href);
      if (!url) { e.preventDefault(); return; }
      if (!this.senzaDialogo()) return;   // il link fa da sé
      e.preventDefault();
      this.braccialeCopie(url, ep, 1);
    }
    // n copie in più: un tocco sul bottone, o i clic sull'icona del gestionale
    // (un conto solo per tutti e due, e una riga sola sotto la pill)
    braccialeCopie(url, ep, n, icona) {
      const t = this._brac, b = this.root.querySelector("#bracciale");
      if (t && t.url === url) {
        t.n = Math.min(COPIE_MAX, t.n + n);
        clearTimeout(t.timer);
      } else if (this._bracInvio || (this.ordini || []).some((x) => x.stato === "stampo" && ((x.stampa && x.stampa.jobs) || []).some((j) => j.url === url))) {
        if (b) { b.classList.remove("pulsa"); void b.offsetWidth; b.classList.add("pulsa"); }
        return;
      } else this._brac = { url, ep, n: Math.min(COPIE_MAX, n) };
      this._brac.timer = setTimeout(() => this.braccialeVia(), CLIC_FINESTRA);
      if (b) b.innerHTML = this.braccialeDentro();
      this.contoIcona(icona || (this._conto && this._conto.a));
    }
    // Il «×N» accanto all'icona del gestionale, mentre si clicca: un nostro
    // elemento fisso sopra la pagina (la pagina non si tocca), che segue l'icona
    // se la pagina scorre, e se ne va quando la stampa parte (`a` vuoto).
    contoIcona(a) {
      let w = this._conto;
      const n = (this._brac && this._brac.n) || 0;
      if (!a || !a.isConnected || n < 2) {
        if (w) { w.via(); this._conto = null; }
        return;
      }
      if (!w) {
        const el = document.createElement("div");
        el.id = "psassist-conto";
        const r = el.attachShadow({ mode: "open" });
        // (com'è il «×N» del bottone del pannello, .bracn)
        r.innerHTML = `<style>b { position: fixed; z-index: 2147483647; pointer-events: none; transform: translateX(-100%); background: #0B5CAD; color: #fff;
          border-radius: 999px; padding: 0 4px; font: 700 11px/15px -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-variant-numeric: tabular-nums; }</style><b></b>`;
        document.documentElement.appendChild(el);
        const metti = () => {
          if (!w.a.isConnected) return this.contoIcona(null);
          const q = w.a.getBoundingClientRect();
          w.b.style.left = `${q.right + 6}px`;
          w.b.style.top = `${q.top - 4}px`;
        };
        w = this._conto = { a, b: r.querySelector("b"), metti,
          via: () => { window.removeEventListener("scroll", metti, true); window.removeEventListener("resize", metti); el.remove(); } };
        window.addEventListener("scroll", metti, true);
        window.addEventListener("resize", metti);
      }
      w.a = a;
      w.b.textContent = `×${n}`;
      w.metti();
    }
    // Le icone di stampa del gestionale — le etichette, la lista esami, il
    // foglio RX, l'etichetta anagrafica —, con la stampa automatica accesa: un
    // clic apre il PDF come sempre (quel clic, ridato CLIC_FINESTRA dopo,
    // quando si sa che non ne arriva un altro: il link della pagina, nella sua
    // finestra); due o più di fila stampano quel foglio alla sua stampante,
    // una volta; sull'etichetta anagrafica ogni clic è una copia. Spenta, un
    // link che non è dei suoi, un errore: il clic passa com'è, senza attese.
    seguiDoppioClic() {
      if (LAVORO || PONTE_VALORI) return;
      const icona = (e) => {
        if (!e.isTrusted || e.button !== 0 || !e.detail || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return null;
        if (!this.stampaPronta()) return null;
        const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        return a ? this.iconaStampa(a) : null;
      };
      // (il doppio clic non seleziona il testo intorno: solo su queste icone)
      document.addEventListener("mousedown", (e) => { try { if (e.detail > 1 && icona(e)) e.preventDefault(); } catch { /* com'è */ } }, true);
      document.addEventListener("click", (e) => {
        let ic = null;
        try { ic = icona(e); } catch { /* com'è */ }
        if (!ic) return;
        e.preventDefault();
        e.stopPropagation();
        this.clicIcona(ic);
      }, true);
    }
    // Un'icona di stampa del gestionale, se il link è uno dei suoi (stessa
    // origine, il servlet giusto, e per l'etichetta anagrafica QUESTO episodio):
    // { a, url, brac, ep } o { a, url, job, rid }. Mai un indirizzo costruito.
    iconaStampa(a) {
      const base = location.href, url = absUrl(a, "href", base);
      if (a.matches('a[href*="PsoBraccialettoHMIMU"]')) {
        const ep = this.epDiQuesta();
        const mio = (this.pageType === "patient" || this.pageType === "vista") && linkBracciale(document, ep, base);
        return mio && mio === url ? { a, url, brac: true, ep } : null;
      }
      if (!a.matches(SEL_FOGLI)) return null;
      const u = new URL(url);
      const ok = u.origin === location.origin && (a.getAttribute("title") === "Stampa Etichette" ? /\/RcsStampaEtichetteLISHMIMU\.do$/i.test(u.pathname)
        : /\/jasperservlet$/i.test(u.pathname) && ["RcsRichiesta", "PsoRichiestaAccertamentiRadiografici"].includes(u.searchParams.get("REPORT")));
      const rid = ok ? u.searchParams.get("RICHIESTA_ID") : "";
      const job = rid ? printJobsFor(printModel(document, base), rid).find((j) => j.url === url) : null;
      return job ? { a, url, job, rid } : null;
    }
    clicIcona(ic) {
      let d = this._clic;
      if (d && d.url === ic.url) { d.n++; clearTimeout(d.timer); }
      else {
        if (d) { clearTimeout(d.timer); this.clicFatto(d); }   // (un'altra icona: quella di prima si fa subito)
        d = this._clic = { ...ic, n: 1 };
      }
      // l'etichetta anagrafica: dal secondo clic (o subito, se il bottone sta già contando) le copie
      if (d.brac && (d.conta || d.n > 1 || (this._brac && this._brac.url === d.url))) {
        this.braccialeCopie(d.url, d.ep, d.conta ? 1 : d.n, d.a);
        d.conta = true;
      }
      d.timer = setTimeout(() => { if (this._clic === d) this._clic = null; this.clicFatto(d); }, CLIC_FINESTRA);
    }
    clicFatto(d) {
      if (d.brac ? d.conta : d.n > 1) {
        // (le copie partono da braccialeVia; un foglio, una volta, come dalla sezione Stampa)
        if (!d.brac) avviaStampa([d.job], { panel: this, title: `Richiesta ${d.rid}.`, ep: this.episodeId, paziente: this.nomePaziente(), url: location.href, resta: true });
        return;
      }
      // un clic solo: lo stesso link, dato dalla pagina come sempre (non è un clic
      // vero: il nostro ascolto lo lascia passare), finché il gesto del medico vale
      d.a.click();
    }
    async braccialeVia() {
      const t = this._brac;
      this._brac = null;
      this.contoIcona(null);   // (la stampa parte: il «×N» ora è la riga sotto la pill)
      const w = this.root.querySelector("#bracciale");
      if (w) w.innerHTML = this.braccialeDentro();
      if (!t) return;
      this._bracInvio = true;
      const jobs = Array.from({ length: t.n }, (_, k) => ({ name: t.n > 1 ? `Etichetta anagrafica ${k + 1}/${t.n}` : "Etichetta anagrafica", breve: "anag", printer: "etichettatrice", url: t.url }));
      // (un tocco di lato: il pannello resta com'è, sotto la pill compare solo la sua riga)
      try { await avviaStampa(jobs, { panel: this, ep: t.ep, paziente: this.nomePaziente(), url: location.href, resta: true, dest: "ricordata" }); }
      finally { this._bracInvio = false; }
    }
    // La stazione di stampa (le stampanti dell'infermeria, su un altro PC):
    // collegata, e scelta — «Stampa: PC · Infermeria» —, i fogli degli ordini
    // e l'etichetta anagrafica vanno lì. `nomeStazione`: «Infermeria».
    stampaDove() {
      const a = this.stampaAuto;
      return a && a.sta && (a.s || {}).dove === "stazione" ? "stazione" : "qui";
    }
    nomeStazione() { return (this.stampaAuto && this.stampaAuto.sta && this.stampaAuto.sta.nome) || "Infermeria"; }
    // senza il dialogo: la stampa automatica di qui, o la stazione
    senzaDialogo() { return this.stampaDove() === "stazione" || this.stampaPronta(); }
    // La stampa automatica: le due stampanti scelte (niente interruttore: col dialogo solo senza)…
    stampaPronta() {
      const s = this.stampaAuto && this.stampaAuto.s;
      return !!(s && s.etichette && s.a4);
    }
    // …e, accesa, una stampantina in intestazione che dice dove vanno i fogli —
    // rossa se l'ultimo non è uscito (o non si sa), e «non installata» se
    // l'aiutante non c'è più. Un tocco apre le impostazioni.
    chipStampa() {
      if (this.stampaDove() === "stazione") {
        const sta = this.stampaAuto.sta, nome = this.nomeStazione();
        const titolo = `I fogli degli ordini e l'etichetta anagrafica vanno in ${nome} (stazione di stampa)${sta.presente ? "" : ` · adesso ${nome} non risponde`}. Tocca per le Stampanti`;
        return `<button class="iconbtn stauto sta${sta.presente ? "" : " ko"}" id="stauto" title="${esc(titolo)}" aria-label="${esc(titolo)}">${ICO.stampante}→ ${esc(nome)}</button>`;
      }
      if (!this.stampaPronta()) return "";
      const { s, esito } = this.stampaAuto;
      const ko = !!esito && esito.ok === false;
      const titolo = esito && esito.nonInstallata ? `Stampa automatica non installata: ${esito.why}`
        : `Stampa automatica attiva: etichette su ${s.etichette}, A4 su ${s.a4}${ko ? ` · l'ultima stampa ${esito.esito === "sconosciuto" ? "ha un esito sconosciuto" : "non è uscita"}: ${esito.why}` : ""}`;
      const no = !!esito && !!esito.nonInstallata;
      return `<button class="iconbtn stauto${ko ? " ko" : ""}${no ? " no" : ""}" id="stauto" title="${esc(titolo)}" aria-label="${esc(titolo)}">${ICO.stampante}${no ? "non installata" : ""}</button>`;
    }
    // Le scelte stanno nella memoria dell'estensione: si leggono e si seguono
    // (cambiano dalle impostazioni, dal menu ⋯, e a ogni stampa automatica).
    // Cambia solo la stampantina, al suo posto: niente ridisegno sopra chi scrive.
    seguiStampa() {
      const leggi = () => Promise.all([chrome.storage.local.get(["stampa", "stampaEsito"]), chrome.storage.session.get("stazione").catch(() => ({}))]).then(([o, x]) => {
        const prima = this.stampaDove();
        this.stampaAuto = { s: o.stampa || null, esito: o.stampaEsito || null, sta: x.stazione || null };
        const w = this.root.querySelector("#stautow");
        if (w) w.innerHTML = this.chipStampa();
        // («→ Infermeria» sul bottone dell'ordine e nel menu: solo quando cambia, e mai sopra chi scrive)
        if (this.stampaDove() !== prima && !this.root.activeElement) this.render();
      }).catch(() => {});
      try {
        leggi();
        chrome.storage.onChanged.addListener((ch, area) => { if ((area === "local" && (ch.stampa || ch.stampaEsito)) || (area === "session" && ch.stazione)) leggi(); });
        this.seguiDoppioClic();   // (le icone di stampa del gestionale: doppio clic = stampa)
        // l'aiutante c'è ancora? (al più ogni mezz'ora lo chiede il service worker)
        ask({ t: "stampaVerifica" });
      } catch { /* senza la memoria dell'estensione la stampa automatica non c'è: il pannello sì */ }
    }
    // L'app si aggiorna da sola (aggiorna.js, nel service worker). Qui solo la
    // riga in fondo al ⋯, quando c'è una versione nuova ma da questa cartella non
    // si può applicare: dice come rimediare (niente puntino, niente tocco).
    seguiAggiorna() {
      const leggi = () => chrome.storage.local.get("aggiorna").then((o) => {
        const prima = this.agg && this.agg.come;
        const a = o.aggiorna || null;
        this.agg = a && a.nuova && !a.puo && a.come ? a : null;
        if (this.menuAperto && (this.agg && this.agg.come) !== prima) this.render();
      }).catch(() => {});
      try {
        leggi();
        chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.aggiorna) leggi(); });
      } catch { /* senza la memoria dell'estensione niente aggiornamenti: il pannello sì */ }
    }
    // ⋯ → Registrazioni (registra.js): finché il medico registra, «● REC» sulla
    // pill e in intestazione — lì un tocco apre le Registrazioni (Ferma e salva).
    chipRec(bottone = false) {
      const r = this.reg;
      if (!(r && r.stato === "rec" && Date.now() < r.scade)) return "";
      const t = "Registrazione in corso: ⋯ → Registrazioni → Ferma e salva";
      return bottone ? `<button class="recchip" id="recchip" title="${t}">● REC</button>` : `<span class="recchip" title="${t}">● REC</span>`;
    }
    seguiRec() {
      const leggi = () => chrome.storage.local.get("registra").then((o) => {
        const prima = JSON.stringify(this.reg || null);
        this.reg = o.registra || null;
        if (this.view === "registrazioni") this.caricaRegistrazioni();
        else if (JSON.stringify(this.reg || null) !== prima) this.render();
      }).catch(() => {});
      try {
        leggi();
        chrome.storage.onChanged.addListener((ch, area) => {
          if (area !== "local") return;
          if (ch.registra) leggi();
          // gli zip salvati, o la registrazione automatica accesa o spenta: la vista si rilegge
          else if ((ch["registra.elenco"] || ch["registra.auto"]) && this.view === "registrazioni") this.caricaRegistrazioni();
        });
      } catch { /* niente */ }
    }
    async apriStampanti() {
      this.menuAperto = false;
      const r = await ask({ t: "apriImpostazioni" });
      if (!(r && r.ok)) this.message = "Non riesco ad aprire le impostazioni: ricarica la pagina e riprova.";
      this.render();
    }

    // the inline banner: a string is something that went wrong, {ok} is a
    // confirmation. Every view shows it — the panel always answers.
    notaHtml() {
      const m = this.message;
      if (this.runState) return "";
      if (typeof m === "string" && m) return `<div class="banner warn">${esc(m)}</div>`;
      if (m && typeof m.ok === "string") return `<div class="banner ok">${esc(m.ok)}</div>`;
      return "";
    }
    marcaLetto(id) {
      const held = tabStore.get(this.risKey(id), null);
      if (held && held.rows) this.segnaVisto(id, held.rows);
    }
    // Aprire un paziente: sugli Esiti se c'è qualcosa da guardare — valori,
    // referti in pagina o già letti —, sulle Richieste se non c'è ancora
    // niente (gli Esiti vuoti non servono a nessuno). Chi arriva da una
    // scheda del pannello sceglie già dove andare.
    defaultView() {
      // una pagina «altra» del gestionale: gli Esiti del suo paziente, o il tabellone
      if (this.pageType === "vista") return this.epDiQuesta() ? "esiti" : "home";
      if (this.pageType !== "patient") return "richieste";
      // senza i link per ordinare non è la scheda di un paziente ma la lista
      // del pronto soccorso: lì si mostra l'elenco dei pazienti
      if (!(this.entry && (this.entry.labUrl || this.entry.radioUrl))) return "home";
      return this.haRisultati() ? "esiti" : "richieste";
    }
    haRisultati() { return this.esiti.length > 0 || !!this.datiEsiti(); }
    // «apri il paziente» (dalla lista, dalla mappa, da un promemoria) porta
    // sugli Esiti solo se ha esiti
    vistaApertura(go) { return go === "esiti" && !this.haRisultati() ? "richieste" : go; }
    persistUi() {
      const k = this.uiKey();
      if (!k) return;
      tabStore.set(k, {
        q: this._q || "",
        qMio: !!this.quesitoMio,
        qrx: this._qrx || "",
        sel: [...this.selected.values()].map((i) => [i.res, i.code, i.label]),
        acq: this.acq || "",
        eoSel: this.eoSel || "",
        pk: this.pacchetto || "",
        pkDa: [...this.pkgDa],
        ts: Date.now(),
      });
    }
    applyAfterNav() {
      const a = tabStore.get("afterNav.v1", null);
      if (!a || a.ep !== this.episodeId || Date.now() - (a.ts || 0) > 60e3) return;
      tabStore.set("afterNav.v1", null);
      this.view = this.vistaApertura(a.view); this.viewId = null; this.persistUi();
    }

    restoreUi() {
      const k = this.uiKey();
      const s = k ? tabStore.get(k, null) : null;
      if (!s || Date.now() - (s.ts || 0) > 6 * 3600e3) {
        this._q = store.get("lastQ", "") || ""; // keep the last quesito typed
        this.quesitoMio = false;   // l'ultimo quesito di un altro giro: non scritto per questo paziente
        this._qrx = "";
        this.view = this.defaultView() === "home" ? "home" : (this.view || this.defaultView());
        return;
      }
      this._q = s.q || store.get("lastQ", "") || "";
      this.quesitoMio = !!(s.q && s.qMio);
      this._qrx = s.qrx || "";
      this.eoSel = s.eoSel || "";
      this.selected = new Map((s.sel || []).map(([res, code, label]) => [this.key(res, code), { res, code, label, display: displayLabel(res, code) }]));
      // il gestionale ricarica a ogni click: il pacchetto attivo e gli esami
      // che ha messo restano com'erano
      this.pacchetto = s.pk && this.pacchettoDi(s.pk)?.q === s.pk ? s.pk : "";
      this.pkgDa = new Set(this.pacchetto ? (s.pkDa || []).filter((k) => this.selected.has(k)) : []);
      this.acq = s.acq || "";
      // A page load decides the view, not the stored one: opening a patient
      // lands on Esiti — quello che si va a fare, nove volte su dieci, è
      // guardare — e chi arriva da una scheda del pannello ha già scelto lui
      // dove andare (afterNav decide subito dopo).
      // (The ER worklist stays on the patient list either way.)
      this.view = this.defaultView();
      this.viewId = null;
    }
    clearOrderUi() { // after a successful run the order is placed: start clean
      this._q = "";
      this.quesitoMio = false;
      this._qrx = "";
      this.selected.clear();
      this.pacchetto = ""; this.pkgDa.clear();
      this.persistUi();
    }

