//@frammento 48-panel-esiti.js — Panel (segue): viewIdle (la scheda del paziente), viewPrint, Esiti (valori, referti, tabella storico), archivio.
    viewIdle(patientName, ep) {
      const cat = fullCatalog();
      // On the ER worklist (no patient open) nothing can be ordered: show no
      // exams at all rather than a picker that would dead-end.
      const canOrder = this.pageType === "exam" || this.pageType === "crea" ||
        (this.pageType === "patient" && !!(this.entry && (this.entry.labUrl || this.entry.radioUrl)));
      if (!canOrder) {
        const extra = this.viewPrint();
        if (this.pageType === "vista" && this.epDiQuesta()) return `<div class="hint" style="margin:2px 0 0">Da questa pagina non si ordina: le richieste si fanno dalla pagina del paziente.</div>`;
        return `${extra}<div class="hint" style="margin:2px 0 0">Apri un paziente per creare richieste.</div>`;
      }
      // i tre pacchetti sempre in testa, poi gli ultimi quesiti usati
      const quesiti = [...PACCHETTI.map((p) => p.q), ...store.get("quesiti", QUESITI_DEFAULT).filter((q) => !ePacchettoFisso(q))].slice(0, 6);
      const canOneClick = this.pageType === "patient" || this.pageType === "crea";

      // Receipt banner: the moment of decision on the landing page must show
      // the full verified accounting, not just what this list happens to show.
      // …e quale quesito è partito, in una riga: quello del triage o il tuo.
      let receiptSec = "";
      let receipt = null;
      let live = null;
      if (this.pageType === "exam") {
        live = examModel(document, location.href);
        receipt = freshReceipt(live.richiestaId);
        if (receipt) {
          const n = receipt.items.length;
          const qd = quesitoDetto(receipt.quesito);
          receiptSec = `
            <div class="banner ok"><b>✓ ${n} ${n === 1 ? "esame" : "esami"} in carrello, ${n === 1 ? "verificato" : "verificati"}</b>${
              qd ? `<span class="qline">${esc(qd)}</span>` : ""}</div>`;
        }
      }

      // Una richiesta di questo paziente mandata e non ancora confermata
      // (lasciata in revisione, o con la Conferma senza prova): una riga discreta, e un tocco porta
      // al suo carrello. Quella della ricevuta qui sopra lo dice già da sé.
      // Sul SUO carrello (la prima, se ce ne sono altre) la riga ha le sue due
      // azioni, «Conferma e stampa» e «Svuota»: riaperta più tardi la
      // richiesta non ha più né ricevuta né resoconto, e senza di loro era un
      // vicolo cieco — i bottoni del gestionale stanno sotto la finestra.
      let daConfSec = "";
      {
        const sua = this.pageType === "exam" ? param(location.href, "RICHIESTA_ID") : null;
        // (quella di un ordine ancora aperto — che sta confermando, o stampa — non è «da confermare»: lo dice il chip)
        const aperte = nonConfermateQui().filter((x) => !(receipt && x.rid === String(receipt.richiestaId))
          && !this.ordini.some((o) => ORDINE_APERTO.has(o.stato) && String(o.rid || "") === x.rid));
        const x = aperte.find((y) => y.rid === sua) || aperte[0];
        if (x) {
          let u = "";
          try { u = x.listUrl && new URL(x.listUrl).origin === location.origin && !/[?&](Insert|Delete)=/.test(x.listUrl) ? x.listUrl : ""; } catch { u = ""; }
          const qui = !!sua && sua === x.rid;
          const quanti = x.n ? ` (${x.n} ${x.n === 1 ? "esame" : "esami"})` : "";
          const az = qui ? this.daConfAzioni() : "";
          daConfSec = `<div class="daconf${az ? " az" : ""}"><i class="ddot"></i><span>${qui ? `Questa richiesta${quanti} è ancora da confermare` : `Richiesta delle ${esc(hhmm(x.ts))}${quanti} ancora da confermare`}${
            aperte.length > 1 ? ` · e altre ${aperte.length - 1}` : ""}</span>${
            // (sulla sua pagina ma su una sezione senza la Conferma: il carrello dov'è)
            az || (u && (!qui || param(u, "RISORSA_ID") !== param(location.href, "RISORSA_ID")) ? `<button class="lnk" id="apridaconf" data-url="${esc(u)}">apri il carrello</button>` : "")}${
            // (l'ha fatta a mano, o non serve più: la si dimentica, tutte quelle di questo paziente)
            `<button class="lnk" id="ignoradaconf" title="Non la segnalo più">ignora</button>`}</div>`;
        } else if (this._daconf?.vuoto && this._daconf.rid === sua) {
          // letta vuota dal server e dimenticata: la riga lo dice, poi se ne va
          daConfSec = `<div class="daconf"><i class="ddot"></i><span>${esc(this._daconf.testo)}</span></div>`;
        }
      }

      // Una casella sola, «Quesito o esame…»: quello che scrivi è il quesito;
      // se somiglia a degli esami del catalogo, sotto compaiono — per primo
      // «usa come quesito», poi gli esami. Scelto un esame, nella casella
      // torna il quesito di prima.
      const qTesto = (this._q || "").trim();
      const qHits = canOneClick && this._cerca ? this.esamiDalQuesito(qTesto, cat) : [];
      const qDrop = qHits.length ? `<div class="acdrop" id="qdrop">
          <button type="button" class="acquesito" id="usaq" title="Tieni il testo come quesito (Invio)">Quesito: «${esc(qTesto)}»</button>
          ${this.vociEsami(qHits, cat)}</div>` : "";
      const quesitoSec = canOneClick ? `
        <div class="sec rq">
          <div class="qrow">
            <div class="ac qac"><input id="q" type="text" autocomplete="off" placeholder="Quesito o esame…" aria-label="Quesito o esame" value="${esc(this._q || "")}">${qDrop}</div>
            <div class="qchips">${quesiti.map((q) => {
              const pk = this.pacchettoDi(q);
              // quanti esami porta: quelli che questo computer ha in catalogo
              const ci = pk ? pk.items.filter(([r, c]) => cat[r]?.items?.[c]) : [], quanti = ci.length;
              if (!pk || (pk.imparato && !quanti)) return `<button class="chip q" data-q="${esc(q)}">${esc(q)}</button>`;
              const on = this.pacchetto === pk.q;
              return `<button class="chip q pk ${on ? "on" : ""}" data-q="${esc(q)}" aria-pressed="${on}" title="${on ? "Tocca di nuovo per togliere quesito e pacchetto" : pk.imparato ? "Scrive il quesito e spunta gli esami dell'ultima volta: " : "Scrive il quesito e spunta: "}${esc(on ? "" : (pk.imparato ? ci : pk.items).map(([r, c]) => displayLabel(r, c)).join(", "))}">${esc(q)}<span class="pkn">&nbsp;· ${quanti}</span></button>`;
            }).join("")}</div>
          </div>
        </div>` : "";

      // On the exam page show what is already in the cart on THIS resource,
      // plus (from the receipt) what was verified on other resources. Un
      // emogas entrato nella versione di sempre perché qui la «- NEW» non c'è
      // lo dice accanto al nome: «al posto di EGA VENOSA NEW».
      let cartSec = "";
      if (this.pageType === "exam" && live) {
        const inCart = live.exams.filter((e) => e.isDel);
        const here = new Set(inCart.map((e) => e.code));
        const elsewhere = receipt ? receipt.items.filter((i) => i.res !== live.res && !here.has(i.code)) : [];
        const alPosto = (res, code) => (receipt ? receipt.items.find((i) => String(i.res) === String(res) && String(i.code) === String(code)) : null)?.alPostoDi || "";
        const nota = (al) => (al ? `<small class="alposto">al posto di ${esc(al)}</small>` : "");
        cartSec = !inCart.length && !elsewhere.length ? "" : `
          <div class="sec">
            <div class="lbl">Già nel carrello — ${esc(live.res ? risorsaCorta(live.res) : "?")} (${inCart.length})</div>
            <div class="chips">
              ${inCart.map((e) => `<span class="chip cart">${esc(shortLabel(e.label))}${nota(alPosto(live.res, e.code))}</span>`).join("")}
              ${elsewhere.map((i) => `<span class="chip ghosted" title="verificato su ${esc(risorsaCorta(i.res))}">${esc(i.display || shortLabel(i.label))} · ${esc(risorsaCorta(i.res))} ✓${nota(i.alPostoDi)}</span>`).join("")}
            </div>
          </div>`;
      }

      const pendingSec = this.pending ? `
        <button class="btn confirm" id="goqueued" style="margin-bottom:12px">→ Conferma ${esc(this.pending.next.kind === "radio" ? "la radiologia" : "il laboratorio")} (${this.pending.next.count})</button>` : "";
      const n = this.selected.size;
      // La Conferma del gestionale, dalla ricevuta: il bottone che conclude.
      // Il bottone che fa uscire gli esami dice per chi: «Conferma per ROSSI M. · 68 M · 6 esami»
      const perChi = this.idBreve();
      const confermaOra = receipt && live && live.confirmButton
        ? `<div class="btnrow"><button class="btn primary" id="confirmnow" title="Preme la Conferma del gestionale per questa richiesta, poi parte la stampa"${confermaPannello ? " disabled" : ""}>${esc(confermaPannello || (perChi ? `Conferma per ${perChi}` : "Conferma e stampa"))}</button></div>` : "";

      // La ricevuta mostra il carrello e un bottone solo. La griglia degli
      // esami resta dietro «+ aggiungi»: aggiungere ancora è l'eccezione.
      if (receipt && !this.aggiungi && !n) {
        const nota = this.notaHtml();
        return `
          ${pendingSec}
          ${daConfSec}
          ${receiptSec}
          ${cartSec}
          <button class="lnk piu" id="aggiungi" title="Aggiungi altri esami a questa richiesta">+ aggiungi</button>
          ${nota || confermaOra ? `<div class="commit">${nota}${confermaOra}</div>` : ""}
        `;
      }

      // Tre colonne strette di parole da accendere: POC · Lab · RX. In cima a
      // ogni colonna i suoi profili; un profilo che raggruppa esami della
      // colonna (l'epatico) è un «Epatico ▸» che li apre. Nella colonna RX il
      // quesito della radiologia, solo quando un RX è scelto.
      const COLONNE = ["POC", "Lab", "RX"];
      const colDi = (r) => (r === RES.POC ? "POC" : RADIO_SET.includes(r) ? "RX" : "Lab");
      const colonne = Object.fromEntries(COLONNE.map((k) => [k, { profili: [], esami: [] }]));
      const dentro = new Map();   // esame → il profilo-espansore che lo raccoglie
      const aperti = this.profiliAperti || (this.profiliAperti = new Set());
      PRESETS.forEach((p, i) => {
        if (!p.items.every(([r, c]) => cat[r]?.items?.[c])) return;
        const on = p.items.every(([r, c]) => this.isSel(r, c));
        const singoli = ESPANSORI.has(p.name) ? p.items.filter(([r, c]) => SINGLES.some(([r2, c2]) => r2 === r && c2 === c)) : [];
        for (const [r, c] of singoli) dentro.set(this.key(r, c), p.name);
        const aperto = aperti.has(p.name) || singoli.some(([r, c]) => this.isSel(r, c));
        colonne[colDi(p.items[0][0])].profili.push(`<span class="rprof"><button class="chip preset ${on ? "on" : ""}" data-preset="${i}">${esc(p.name)}</button>${
          singoli.length ? `<button type="button" class="respandi" data-espandi="${esc(p.name)}" aria-expanded="${aperto}" title="${aperto ? "Chiudi" : "Gli esami uno per uno"}">${aperto ? "▾" : "▸"}</button>` : ""}</span>`);
      });
      // accanto al nome, a colori: «✓ 11:40» fatto, «40′» in attesa
      // (rosso oltre la seconda soglia): un doppione si vede prima di sceglierlo
      const ultimi = this.ultimiEsami();
      const opt = (r, c, sotto) => {
        const on = this.isSel(r, c), ult = this.suffissoEsame(ultimi, examLabel(r, c), colDi(r) === "RX" ? "img" : "lab");
        return `<button class="opt${on ? " on" : ""}${sotto ? " sotto" : ""}" data-res="${esc(r)}" data-code="${esc(c)}" aria-pressed="${on}" title="${esc(examLabel(r, c))} — ${esc(RES_SHORT[r] || r)}${ult ? `\n${esc(ult.titolo)}` : ""}"><span class="nm">${esc(displayLabel(r, c))}</span>${ult ? ult.html : ""}</button>`;
      };
      for (const [r, c] of SINGLES) {
        if (!cat[r]?.items?.[c]) continue;
        const p = dentro.get(this.key(r, c));
        if (p && !(aperti.has(p) || PRESETS.find((x) => x.name === p).items.some(([r2, c2]) => this.isSel(r2, c2)))) continue;
        colonne[colDi(r)].esami.push({ p, html: opt(r, c, !!p) });
      }
      // gli esami raccolti da un profilo stanno subito sotto i profili, poi gli altri
      for (const k of COLONNE) colonne[k].esami.sort((a, b) => (b.p ? 1 : 0) - (a.p ? 1 : 0));
      const conRx = [...this.selected.values()].some((i) => RADIO_SET.includes(i.res));
      const qrxHtml = canOneClick && conRx
        ? `<input id="qrx" class="qrx" type="text" placeholder="Quesito RX — se vuoto, quello sopra" value="${esc(this._qrx || "")}">` : "";
      const singles = COLONNE.map((k) => `<div class="rcol" data-col="${k}">
          <div class="rch">${k}</div>
          ${colonne[k].profili.length ? `<div class="rprofs">${colonne[k].profili.join("")}</div>` : ""}
          ${colonne[k].esami.map((x) => x.html).join("")}
          ${k === "RX" ? qrxHtml : ""}
        </div>`).join("");

      // Un bottone solo: «Conferma e stampa · N esami». «solo carrello» (che
      // si ferma sul carrello e lascia la Conferma a te) è un link accanto.
      const nTxt = n === 1 ? "1 esame" : `${n} esami`;
      // quante richieste partono: una per erogatore di laboratorio (come le
      // fa launch), una per la radiologia
      const scelti = [...this.selected.values()], conRadio = scelti.some((i) => RADIO_SET.includes(i.res));
      const soloLab = scelti.filter((i) => !RADIO_SET.includes(i.res));
      const nRich = this.pageType === "patient" ? (soloLab.length ? perErogatore(soloLab, this.entry?.labUrl).length : 0) + (conRadio ? 1 : 0)
        : this.pageType === "crea" && !conRadio ? perErogatore(scelti, location.href).length : 1;
      const confirmLabel = `${perChi ? `Conferma per ${perChi}` : "Conferma e stampa"}${!n ? "" : nRich > 1 ? ` · ${nRich} richieste, ${nTxt}` : ` · ${nTxt}`}${
        this.stampaDove() === "stazione" ? ` → ${this.nomeStazione()}` : ""}`;

      const problems = this.computeProblems();
      // sulla ricevuta, finché non scegli niente, il bottone resta la Conferma del gestionale
      const bottoni = !n && confermaOra ? confermaOra : `
          <div class="btnrow">
            <button class="btn primary" id="goconfirm" title="Aggiunge e verifica gli esami, preme Conferma e avvia la stampa (Ctrl+Invio)" aria-keyshortcuts="Control+Enter" ${n && !problems.confirm.length ? "" : "disabled"}><span class="ctxt">${esc(confirmLabel)}</span></button>
            <button class="lnk" id="go" title="Aggiunge e verifica gli esami e si ferma sul carrello: la Conferma la premi tu nel gestionale" ${n && !problems.go.length ? "" : "disabled"}>solo carrello</button>
          </div>`;
      // la barra della Conferma c'è solo quando c'è qualcosa da confermare
      const barra = n || confermaOra;
      // In fondo, quieta, la ristampa: «Ristampa», l'ultimo ordine intero —
      // tutte le sue richieste (una per erogatore), etichette, lista esami e
      // RX, una volta ciascuno. Le richieste di prima, una per una: ⋯ →
      // «Stampa le richieste» (una strada sola, non due).
      let ristampa = "";
      if (this.pageType === "patient" && this.epDiQuesta()) {
        const map = stampePaziente(this.epDiQuesta()), ult = ultimeRichieste(map, this.epDiQuesta());
        if (ult.length) ristampa = `<div class="rpiede"><button class="lnk ultima" id="stultima" title="Etichette e fogli di nuovo, di tutto l'ultimo ordine: ${
          esc(ult.map((r) => printMeta(map, r).when || "richiesta " + r).join(" e "))}${perChi ? ` — ${esc(perChi)}` : ""} (le richieste di prima: ⋯ → Stampa le richieste)">${icoIn("etichetta")}Ristampa</button></div>`;
      }
      return `
        ${pendingSec}
        ${daConfSec}
        ${receiptSec}
        ${barra ? "" : this.notaHtml()}
        ${quesitoSec}
        ${cartSec}
        ${canOneClick ? "" : `<div class="sec acsec">${this.viewBrowse(cat)}</div>`}
        <div class="sec rsec"><div class="rcols">${singles}</div></div>
        ${ristampa}
        ${barra ? `<div class="commit">
          ${this.notaHtml()}
          <div id="problems">${problems.go[0] ? `<div class="problem">${esc(problems.go[0])}</div>` : ""}</div>
          ${bottoni}
        </div>` : ""}
      `;
    }

    // ⋯ → «Stampa le richieste»: i fogli delle richieste già confermate (non
    // stanno più nelle Richieste, dove si ordina)
    viewStampa() {
      return this.viewPrint() || `<div class="hint">Nessuna richiesta da stampare.</div>`;
    }

    // Patient page: reprint any richiesta's PDFs (labels → label printer,
    // exam list → normal printer) through the sequential wizard.
    viewPrint() {
      if (this.pageType !== "patient") return "";
      const map = stampePaziente(this.epDiQuesta());
      const rids = richiesteStampabili(map);
      if (!rids.length) return "";
      // («Ristampa», l'ultimo ordine intero, sta in fondo alle Richieste: qui le altre, una per una)
      const receipt = freshReceipt(null);
      const hot = receipt && map[receipt.richiestaId] ? receipt.richiestaId : null;
      const rows = rids.slice(0, 30).map((rid) => {
        const m = printMeta(map, rid);
        const exams = m.exams.join(", ");
        return `<button class="prow ${rid === hot ? "hot" : ""}" data-print="${esc(rid)}" title="Richiesta ${esc(rid)} — ${esc(printLabelFor(map, rid))}">
          <span class="pline1">${icoIn("stampante", 13)}<b>${esc(m.when || "richiesta " + rid)}</b> <small>${esc(printLabelFor(map, rid))}</small><span class="prist">Ristampa</span></span>
          ${exams ? `<span class="pline2">${esc(exams)}</span>` : ""}
        </button>`;
      }).join("");
      return `
        <div class="sec">
          <div class="lbl">Stampa</div>
          <div class="rlist">${rows}</div>

        </div>`;
    }

    // I referti che gli Esiti mostrano: quelli di laboratorio no — dicono quello
    // che la tabella dei Valori dice già, e in mezzo agli altri facevano
    // perdere l'ECG e la radiologia. Salvare, resettare e contare guardano
    // solo questi.
    refertiMostrati() {
      return this.esiti.filter((e) => e.kind === "referto" && refertoTipo(e) !== "lab");
    }
    // …ma solo dove la tabella dei Valori li può mostrare: c'è una tabella, o
    // c'è da dove leggerla (estensione e portale) e la lettura non è fallita.
    // Altrimenti — bookmarklet, niente portale, il portale che non ha dato la
    // tabella — un referto di laboratorio è l'unico posto dove quei valori si
    // vedono: resta, raccolto sotto «Laboratorio (N)». Un esito finale non
    // sparisce mai.
    refertiLab() {
      const tabella = !!(this.storico && this.storico.righe && this.storico.righe.length)
        || this.esiti.some((e) => e.kind === "valori" && ((tabStore.get(this.risKey(e.id), null) || {}).rows || []).length);
      if (tabella || (this.conPortale() && !this.notaPortale && !fallito(this.epDiQuesta(), "lab"))) return [];
      return this.esiti.filter((e) => e.kind === "referto" && refertoTipo(e) === "lab");
    }
    // I valori che il pannello ha di questo paziente, in una stringa: cambia
    // quando arriva un valore nuovo (per il ricontrollo ogni 10 minuti).
    impValori() {
      const s = this.storico;
      return JSON.stringify([s ? [s.date || [], s.righe || []] : null,
        this.esiti.filter((e) => e.kind === "valori").map((e) => (tabStore.get(this.risKey(e.id), null) || {}).rows || [])]);
    }
    // I referti che ↻ Rileggi (solo estensione) può ancora tenere: sulla
    // schermata Esiti, quelli non ancora salvati.
    refertiDaSalvare() {
      if (this.view !== "esiti" || !hasExt() || this.runState) return [];
      return this.refertiMostrati().filter((e) => !(this.refCache || {})[e.id]);
    }
    // Un giro di esami che sta mandando DA QUESTA SCHEDA (o che riprende dopo
    // un cambio pagina): cambiare pagina adesso, o cancellare, lo
    // ucciderebbe a metà. Un ordine in coda o le etichette che aspettano no:
    // le letture aspettano già il motore da sé (cancelloMotore).
    giroQui() { return this.runState === "running" || !!tabStore.get(CORSA, null); }
    // …e ricaricare o aggiornare l'estensione ucciderebbe anche un ordine che
    // manda, aspetta in coda o aspetta le etichette in un'altra scheda.
    giroInCorso() { return this.giroQui() || this.ordini.some((x) => ORDINE_APERTO.has(x.stato)); }

    // Values are fetched once per accesso and kept for the tab, so reopening
    // is instant; ↻ pulls them again while the lab is still completing.
    // ESITI — one chronological list: values we can read, and reported PDFs.
    // Row = open it (values expand / PDF opens). The 2-line preview under a
    // saved row is its own target: it opens the full values screen.
    // La tabella degli Esiti: i prelievi letti in QUESTA scheda del browser
    // (sempre, anche senza estensione) più la scheda clinica in archivio
    // quando è di questo paziente — il portale, e i prelievi letti altrove.
    // Una tabella sola: per gruppo, una colonna a prelievo, il più recente a
    // sinistra. Non c'è più una riga per richiesta da aprire.
    datiEsiti() {
      let dati = normalizzaStorico(this.storico || null);
      for (const e of this.esiti) {
        if (e.kind !== "valori") continue;
        const v = tabStore.get(this.risKey(e.id), null);
        const t = v && v.rows ? prelievoComeTabella(risMeta(e), v.rows, v.cf || "", v.scartate) : null;
        // la scheda in archivio ha già questi prelievi: la fusione non cambia
        // niente. Se l'archivio manca (o non ha risposto) restano in tabella.
        if (t) dati = fondiStorico(t, dati);
      }
      return dati && dati.righe && dati.righe.length ? dati : null;
    }

    // Gli Esiti sotto gli occhi del medico (la finestra aperta): da qui in poi
    // niente è più «nuovo» nella riga dei Pazienti. I valori nuovi non ancora
    // segnati «Letto» restano, e dicono quanti sono fuori range (il pallino rosso).
    segnaEsitiVisti(nuovi, fuori, fuoriTot = fuori) {
      const ep = this.epDiQuesta();
      if (!ep) return;
      const guarda = !this.collapsed && !this.runState, ora = Date.now();
      const s = statoDi(ep) || {};
      const v = s.valori || {};
      if (v.nuovi === nuovi && v.fuori === fuori && (v.fuoriTot ?? v.fuori) === fuoriTot && (!guarda || ora - (s.esitiVisto || 0) < 15e3)) return;
      scriviStato(ep, (x) => ({ ...x, valori: { nuovi, fuori, fuoriTot }, ...(guarda ? { esitiVisto: ora } : {}) }));
    }
    // Una lettura che aspetta il motore di un ordine (cancelloMotore: una
    // sessione sola, un ordine alla volta) lo dice dove la si aspetta: il suo
    // bottone dice «dopo l'ordine…», e di chi nel passaggio del mouse. Il
    // bottone si ricorda come si chiamava (data-dopo) e torna così appena il
    // motore si libera (aggiornaDopo), senza ridisegnare niente.
    // (restituisce gli attributi e il testo: `<button … ${dopoOrdine(…)}</button>`)
    // (`html`: il testo è un nostro pezzo di HTML, con l'icona: va com'è, non come testo)
    dopoOrdine(testo, titolo, html = false) {
      const ora = motoreAltrove();
      const t = ora ? `Aspetto che finisca ${chiTieneMotore()} (un ordine alla volta nella sessione del gestionale): poi leggo` : titolo;
      return `data-dopo="${esc(testo)}"${html ? ' data-dopohtml="1"' : ""} data-dopot="${esc(titolo)}"${t ? ` title="${esc(t)}"` : ""}>${ora ? "dopo l'ordine…" : html ? testo : esc(testo)}`;
    }
    aggiornaDopo() {
      const ora = motoreAltrove();
      for (const el of this.root.querySelectorAll("[data-dopo]")) {
        if (!ora && el.dataset.dopohtml) el.innerHTML = el.dataset.dopo;   // (il nostro HTML, con l'icona)
        else el.textContent = ora ? "dopo l'ordine…" : el.dataset.dopo;
        el.title = ora ? `Aspetto che finisca ${chiTieneMotore()} (un ordine alla volta nella sessione del gestionale): poi leggo` : el.dataset.dopot || "";
      }
    }
    viewEsiti() {
      const open = new Set(tabStore.get(this.refKey(), []));
      const cached = this.refCache || {};
      const busy = this.refBusy || {};
      const prelievi = this.esiti.filter((e) => e.kind === "valori");
      const referti = this.refertiMostrati();
      const lab = this.refertiLab();
      const st = this.datiEsiti();
      this.nColEsiti = st ? st.date.length : 0;
      // con l'estensione e il link dello storico, il portale è una fonte anche
      // quando nel gestionale non c'è niente da leggere (tutto già refertato)
      const conPortale = this.conPortale();
      // la tabella del portale è arrivata: allora non c'è più niente «da leggere»
      const dalPortale = !!(this.storico && (this.storico.periodo || this.storico.paziente?.idMPI));
      if (!prelievi.length && !referti.length && !lab.length && !st && !conPortale && !richiesteInAttesa(document).length) return `<div class="hint">Nessun esito per questo paziente.</div>`;

      // ---- valori: cosa è cambiato dall'ultima lettura, colonna per colonna
      // si parte dalle COLONNE della tabella: ognuna porta l'accesso da cui
      // viene, così due prelievi allo stesso minuto non si rubano i marchi
      const nov = new Map();
      let nNov = 0, nFuori = 0, nFuoriTot = 0;
      for (const d of st ? st.date : []) {
        if (!d.id) continue;
        const v = tabStore.get(this.risKey(d.id), null);
        const n = v && v.rows ? this.novita(d.id, v.rows) : null;
        if (n && n.size) {
          nov.set(chiaveCol(d), n); nNov += n.size;
          const fr = v.rows.filter((r) => n.has(valKey(r.nome)) && outOfRange(r.valore, r.range));
          nFuoriTot += fr.length;
          nFuori += fr.filter((r) => analitaCritico(r.nome)).length;   // solo questi fanno il pallino rosso
        }
      }
      this.segnaEsitiVisti(nNov, nFuori, nFuoriTot);
      const vivi = prelievi.filter((e) => !e.storico).length;
      const daLeggere = this.daLeggere().length;
      const rotti = prelievi.filter((e) => this.rottiTab.has(e.id));
      // letti, ma senza una data e ora nel gestionale: non possono diventare
      // una colonna, e non devono sparire in silenzio
      const senzaData = prelievi.filter((e) => {
        const v = tabStore.get(this.risKey(e.id), null);
        if (!v || !v.rows || !v.rows.length) return false;
        const t = prelievoComeTabella(risMeta(e), v.rows, "");
        return !!t && t.date[0].ignota;
      });
      const ra = this._refreshAll;
      const t = st ? this.tabellaStorico(st, nov, leggiSegni(this.chiaveNota())) : null;
      if (st) this.registraNomi(righeTabella(st.righe), st.scartate);
      const chi = st ? [st.paziente?.cognome, st.paziente?.nome].filter(Boolean).join(" ") : "";
      const sotto = this._sotto;
      // «Carica i valori» / «Aggiorna»: una volta sola. Senza tabella è il
      // bottone grande al posto della tabella; con la tabella è un piccolo
      // «Aggiorna» nella riga del titolo.
      const puoiLeggere = !!(vivi || conPortale);
      const primaLettura = conPortale ? !dalPortale : daLeggere === vivi;
      // il caricamento da solo all'apertura: un «↓ 2» accanto a ↻, nient'altro
      const au = this._auto, salva = this._salva;
      const nAuto = au ? (au.labFatto ? 0 : ra ? ra.total - ra.done : au.nLab) + (salva ? salva.totale - salva.fatti : au.nRef) : 0;
      const rilegge = icoIn("aggiorna", 13);   // (html: la freccia che rilegge, poi le parole)
      const etLeggi = au ? rilegge.replace("margin-right:4px;", "") : ra ? `${rilegge}${ra.done}/${ra.total}…` : sotto ? `${rilegge}storico…`
        : salva ? `${rilegge}referti ${salva.fatti}/${salva.totale}…` : primaLettura ? "⭳ Carica i valori" : `${rilegge}Rileggi`;
      const titLeggi = sotto ? "Leggo lo storico del portale in una scheda di sottofondo: si chiude da sola."
        : salva ? "Salvo i referti non ancora salvati, due alla volta, e ne leggo il testo"
        : !puoiLeggere ? "Riprende i referti non ancora salvati (anche quelli che da soli non sono riusciti) e ne legge il testo"
        : primaLettura ? `Legge i valori${conPortale ? ": lo storico del portale — tutti i prelievi, refertati e no — in una scheda di sottofondo, e le finestre Risultati del gestionale se serve" : " dal gestionale, un prelievo alla volta"}${
          daLeggere && !conPortale ? ` (${daLeggere} ${daLeggere === 1 ? "prelievo ancora da leggere" : "prelievi ancora da leggere"})` : ""}`
        : "Rilegge i prelievi ancora aperti, uno alla volta, poi riprende i referti non ancora salvati";
      // in attesa, dal diario della pagina: ciò che è stato chiesto e non è ancora refertato
      const attese = richiesteInAttesa(document);
      const attesaLab = attese.filter((x) => x.tipo === "lab");
      // nessun prelievo, nessun referto di laboratorio, niente in attesa: col portale lo si dice (e
      // quando lo si è letto), e lo storico resta a un tocco nel ↻ in cima — non il bottone grande
      // (i referti di laboratorio della pagina contano anche se col portale refertiLab() è vuoto per scelta)
      const vuotoLab = !t && !attesaLab.length && !prelievi.length && !lab.length
        && !this.esiti.some((e) => e.kind === "referto" && refertoTipo(e) === "lab");
      const grande = puoiLeggere && !t && !au && !(conPortale && vuotoLab);
      // letti ma senza data e ora: il perché sta nel passaggio del mouse, non in due righe
      const infoSenzaData = senzaData.length ? `<span class="infochip" tabindex="0" title="${esc(
        `Di ${senzaData.length === 1 ? "un prelievo" : `${senzaData.length} prelievi`} la pagina non dà data e ora, né nel campo nascosto né nella riga: ${
          senzaData.length === 1 ? "è la colonna" : "sono le colonne"} ?, in fondo a destra (${senzaData.map((e) => shortLabel(e.label)).join(", ")}). I valori ci sono tutti; il Registro dice cosa c'era scritto al posto dell'ora.`)}">? ${
        senzaData.length === 1 ? "1 senza ora" : `${senzaData.length} senza ora`}</span>` : "";
      // Un esame di laboratorio i cui valori hanno cominciato ad arrivare non
      // aspetta più: «parziale 15:11», senza orologio che corre (i valori sono
      // già in tabella). L'orologio resta a ciò che non ha ancora niente.
      const rigaAttesa = (x) => {
        const parz = x.tipo === "lab" && x.parziale;
        const tit = esc(`Chiesto ${x.when || "(ora ignota)"}: ${x.esami.join(", ")}${parz ? " — risultati parziali nella finestra Risultati" : " — non ancora refertato"}`);
        return parz ? `<div class="wuwait parz" title="${tit}"><b>parziale${x.when ? ` ${esc(x.when.slice(-5))}` : ""}</b>
            <span class="wuwlab">${esc(x.esami.join(", "))}</span></div>`
          : `<div class="wuwait" title="${tit}">
            <b>${esc(attesaDa(x.ts) || x.when || "—")}</b>
            <span class="wuwlab">${esc(x.esami.join(", "))}</span>
            <span class="wuwq">${x.parziale ? "parziale" : "richiesto"}${x.when && attesaDa(x.ts) ? ` ${esc(x.when.slice(-5))}` : ""}</span>
          </div>`;
      };
      // niente valori, solo referti di laboratorio: la loro lista sta nella scheda Lab, non in fondo
      // (col portale: solo senza niente di laboratorio, e non mentre lo si legge)
      const legge = !!(ra || sotto || (au && !au.labFatto));
      const soloReferti = !t && !grande && !attesaLab.length && !prelievi.length && (!conPortale || (vuotoLab && !legge));
      const lettoLab = conPortale && soloReferti ? this.storico?.letto || this._labLetto || 0 : 0;
      const valori = `
        <section class="sec wusec wulab" aria-label="Laboratorio">
          <div class="lbl wuh"><span class="wut"${t ? ` title="Tocca un valore per segnarlo: giallo, poi arancio, poi via"` : ""}>Lab</span>${t ? `<span class="wucnt"> (${righeTabella(st.righe).length} esami · ${t.nCol} prelievi)</span>` : ""}
            ${nAuto > 0 ? `<span class="wuauto" role="status" title="Carico da solo i valori e i referti nuovi: ne restano ${nAuto}">↓ ${nAuto}</span>` : ""}
            ${t ? `<button class="mini" id="storfiltro">${this.soloAlterati ? "tutti" : "solo alterati"}</button>` : ""}
            ${infoSenzaData}
          </div>
          ${grande ? `<div class="carica"><button type="button" class="grande" id="risall" ${ra || sotto || salva ? `disabled ${this.dopoOrdine(etLeggi, titLeggi, true)}` : `title="${esc(titLeggi)}">${etLeggi}`}</button></div>` : ""}
          ${attesaLab.length ? `<div class="wuwaits">${attesaLab.map(rigaAttesa).join("")}</div>` : ""}
          ${!t && (ra || sotto || (au && !au.labFatto)) ? `<div class="wuvuoto" role="status">Leggo i valori…</div>` : ""}
          ${this.notaPortale && !sotto ? `<div class="hint" title="Si legge da solo aprendo il link «Storico Dati Clinici»">Storico del portale non letto: ${esc(this.notaPortale)}.</div>` : ""}
          ${rotti.length ? `<div class="hint" title="Il Registro dice perché">${rotti.length === 1 ? "1 prelievo non letto" : `${rotti.length} prelievi non letti`} (${
            esc(rotti.map((e) => e.when).filter(Boolean).join(", "))}): <b>Aggiorna</b> riprova.</div>` : ""}
          ${t ? `${t.nRighe ? t.html
            : `<div class="hint">Tutti nel range.</div>`}${this.piedeStorico(st, t.legenda)}` : ""}
          ${this.storico && (this.storico.periodo || this.storico.paziente?.idMPI) ? `<div class="hint">Storico del portale di <b>${esc(chi || "—")}</b> · identità confermata <b>${esc(this.storicoVia || "dal nome")}</b>.</div>`
            : this.storicoAltri ? `<div class="hint">Storico del portale di <b>${esc(this.storicoAltri)}</b>, non di questo paziente: non mostrato.</div>`
            : this.storicoDaConfermare ? `<div class="hint" title="Il codice fiscale sta nella finestra Risultati">Storico del portale con questo nome: serve il codice fiscale, <b>⭳ Carica i valori</b>.</div>` : ""}
          ${soloReferti ? (lab.length ? "@@LAB@@" : `<div class="wuvuoto">Nessun esame di laboratorio${lettoLab ? ` · letto ${hhmm(lettoLab)}` : ""}</div>`) : ""}
        </section>`;

      // ---- ECG e Imaging: i referti, uno per riga; il testo si apre lì sotto
      const visti = refertiVisti(this.episodeId);
      const nuovoRef = (e) => !visti.has(e.id);
      // finché il medico non ne ha aperto o chiuso uno, il più recente non
      // ancora letto (ECG o immagini) è aperto, col suo testo
      this._autoAperto = this.espanso === undefined
        ? (referti.find((e) => ["ecg", "rx"].includes(refertoTipo(e)) && nuovoRef(e) && this.testoDi(e)?.stato === "testo") || {}).id || null
        : null;
      const riga = (e) => {
        const coda = !!(this.refCoda && this.refCoda.has(e.id));
        const state = busy[e.id] === true ? "busy" : coda ? "coda" : typeof busy[e.id] === "string" ? "err" : cached[e.id] ? "saved" : open.has(e.id) ? "open" : "";
        const why = typeof busy[e.id] === "string" ? busy[e.id] : coda ? "in fila: al massimo due scaricamenti insieme" : "";
        const tipo = refertoTipo(e);
        const testo = this.testoDi(e);
        const aperto = this.espanso === e.id || (!!this._autoAperto && this._autoAperto === e.id);
        // (con l'estensione TC, eco, RM e visite si aprono nel visore: ↗)
        const leggibile = hasExt() ? testoAuto(e) : tipo === "rx" || tipo === "ecg" || !!testo;
        // l'anteprima: la prima riga del testo che dice qualcosa (mai di un altro paziente)
        const anteprima = testo && testo.stato === "testo" ? anteprimaReferto(testo.righe)
          : testo && testo.stato === "altro" ? GRAVE_ALTRO : testo && testo.stato === "macchina" ? "solo il tracciato" : "";
        const stato = state === "busy" ? "leggo…" : coda ? "in fila" : state === "err" ? "non letto" : "";
        const corpo = !aperto ? "" : !testo ? `<div class="wutxt"><div class="wunote">${state === "busy" || coda ? "Leggo il referto…" : state === "err" ? `Non letto: ${esc(why)}` : "—"}</div></div>`
          : testo.stato === "altro" ? `<div class="wutxt"><div class="wualtro" role="alert">${esc(GRAVE_ALTRO)}</div></div>`
          : testo.stato === "macchina" ? `<div class="wutxt"><div class="wunote">Solo il tracciato della macchina: nessun referto scritto.</div>
              <div class="wuact"><button type="button" class="mini" id="apripdf">${icoIn("esterno", 12)}PDF</button></div></div>`
          : `<div class="wutxt">${testo.verificato ? "" : `<div class="wuver" title="Nel PDF non c'è un codice fiscale (né nome e data di nascita) da confrontare col paziente">intestazione non verificata</div>`}
              <div class="reftxt">${testo.righe.map((r) => `<div class="rt">${esc(r)}</div>`).join("")}</div>
              <div class="wuact"><button type="button" class="mini" id="copytxt">⧉ Copia</button><button type="button" class="mini" id="apripdf">${icoIn("esterno", 12)}PDF</button></div></div>`;
        return `<div class="wuitem${aperto ? " aperto" : ""}">
          <div class="wuline">
            <button class="rrow ${esc(state)}${testo && testo.stato === "altro" ? " altro" : ""}" data-esito="${esc(e.id)}" data-kind="referto" aria-expanded="${aperto ? "true" : "false"}" title="${esc(e.label)}${why ? " — " + esc(why) : ""}">
              <span class="rdot ${esc(state)}"></span>
              <span class="rwhen">${esc(e.when)}</span>
              <span class="rmain"><span class="rlab">${esc(shortLabel(e.label))}</span>${anteprima ? `<span class="wuex${testo && testo.stato === "altro" ? " grave" : ""}" ${testo && testo.stato === "altro" ? 'role="alert"' : ""}>${esc(anteprima)}</span>` : ""}</span>
              ${nuovoRef(e) ? `<span class="wunew" title="Non ancora aperto">nuovo</span>` : ""}
              ${stato ? `<span class="wust" ${state === "busy" ? this.dopoOrdine(stato, "") : `>${esc(stato)}`}</span>` : ""}
              ${leggibile ? `<span class="rgo" aria-hidden="true">${aperto ? "▾" : "▸"}</span>` : ""}
            </button>
            <button type="button" class="wupdf" data-pdf="${esc(e.id)}" title="${cached[e.id] ? "Apri il PDF salvato su questo computer" : "Apri il PDF dal gestionale"}">${icoIn("esterno", 13)}PDF</button>
          </div>
          ${corpo}
        </div>`;
      };
      const perTipo = (tp) => referti.filter((e) => refertoTipo(e) === tp);
      const attesaTipo = (tp) => attese.filter((x) => x.tipo === tp);
      const sezione = (tp, nome, cls) => {
        const righe = perTipo(tp), ws = attesaTipo(tp);
        return `<section class="sec wusec ${cls}" aria-label="${esc(nome)}">
          <div class="lbl wuh"><span class="wut">${esc(nome)}</span>${righe.length ? `<span class="wucnt"> (${righe.length})</span>` : ""}</div>
          ${ws.length ? `<div class="wuwaits">${ws.map(rigaAttesa).join("")}</div>` : ""}
          ${righe.length ? `<div class="rlist">${righe.map(riga).join("")}</div>` : ws.length ? "" : `<div class="wuvuoto">Nessuno.</div>`}
        </section>`;
      };
      const altri = perTipo("altro"), attesaAltri = attesaTipo("altro");
      const docAltri = altri.length || attesaAltri.length ? `<section class="sec wusec wualtri" aria-label="Altri documenti">
          <div class="lbl wuh"><span class="wut">Altri documenti</span>${altri.length ? `<span class="wucnt"> (${altri.length})</span>` : ""}</div>
          ${attesaAltri.length ? `<div class="wuwaits">${attesaAltri.map(rigaAttesa).join("")}</div>` : ""}
          ${altri.length ? `<div class="rlist">${altri.map(riga).join("")}</div>` : ""}
        </section>` : "";
      // i referti di laboratorio che la tabella non può mostrare: chiusi, ma ci sono
      const docsLab = lab.length ? `
        <details class="sec reflab" id="reflab"${this.labAperto ? " open" : ""}>
          <summary class="lbl" title="Referti del laboratorio: senza la tabella dei valori, i risultati finali sono qui">Laboratorio (${lab.length})</summary>
          <div class="rlist">${lab.map(riga).join("")}</div>
        </details>` : "";

      // ---- la riga in cima: prima i valori fuori range, poi quanti sono nuovi
      const fuori = fuoriRangeUltimi(st);
      const nRefNuovi = referti.filter(nuovoRef).length;
      const nNuovi = nNov + nRefNuovi;
      const chip = (x) => `<span class="wuv"><b>${esc(x.sigla)}</b> <span class="wuval">${esc(x.v)}${x.stato < 0 ? "↓" : "↑"}</span>${
        x.prima ? `<span class="wuprima"> (${esc(x.prima.v)}${x.prima.quando ? ` alle ${esc(x.prima.quando)}` : ""})</span>` : ""}</span>`;
      const MAXV = 6;
      // In cima a destra, da solo, ↻ Rileggi: i valori, poi i referti non ancora
      // salvati (anche quelli che da soli non sono riusciti). Senza tabella e
      // senza il caricamento da solo c'è il bottone grande, nel Lab; senza
      // valori da leggere, ↻ riprende solo i referti.
      const rileggiQui = puoiLeggere ? !grande : this.refertiDaSalvare().length > 0;
      const strumenti = rileggiQui ? `<button type="button" class="mini" id="risall" ${ra || sotto || au || salva ? `disabled ${this.dopoOrdine(etLeggi, titLeggi, true)}` : `title="${esc(titLeggi)}">${etLeggi}`}</button>` : "";
      const sep = `<span class="wusep" aria-hidden="true">·</span>`;
      const sommario = `<div class="wusum">
          <div class="wusumv">${fuori.length ? fuori.slice(0, MAXV).map(chip).join(sep)
            + (fuori.length > MAXV ? `${sep}<span class="wupiu" title="${esc(fuori.slice(MAXV).map((x) => `${x.sigla} ${x.v}`).join(", "))}">+${fuori.length - MAXV}</span>` : "")
            : st ? `<span class="wuok">Valori nel range</span>` : ""}${
            nNuovi ? `${fuori.length || st ? sep : ""}<button type="button" class="wunuovi" id="letto" title="${esc([
              nNov ? `${nNov} ${nNov === 1 ? "valore nuovo" : "valori nuovi"} dall'ultima lettura` : "",
              nRefNuovi ? `${nRefNuovi} ${nRefNuovi === 1 ? "referto non ancora aperto" : "referti non ancora aperti"}` : ""].filter(Boolean).join(" · "))} — un tocco: visti">${nNuovi} ${nNuovi === 1 ? "nuovo" : "nuovi"}</button>` : ""}</div>
          ${strumenti ? `<div class="wutools">${strumenti}</div>` : ""}
        </div>`;
      const nellaScheda = soloReferti && lab.length;
      return `<div class="esiti wu">${sommario}<div class="esgrid">${nellaScheda ? valori.replace("@@LAB@@", () => docsLab) : valori}<div class="wucol">${sezione("ecg", "ECG", "wuecg")}${sezione("rx", "Imaging", "wuimg")}${docAltri}</div></div>${nellaScheda ? "" : docsLab}</div>`;
    }

    // The multi-day table: exams down, draws across, newest first. It is read
    // from the portal page, never asked to the server.
    // UNA sola tabella, per il pannello e per il testo copiato: due
    // sorgenti che disegnano «la stessa» tabella finiscono sempre per
    // divergere, e la differenza la scopre il medico.
    tabellaStorico(st, nov = null, segni = {}) {
      const col = st.date.map((d, i) => ({ ...d, i })).reverse();   // il più recente a sinistra
      const righe = righeTabella(st.righe);   // niente doppioni, e «Neu 4.0 (56%)»: una riga, non due
      const ambS = sigleAmbigue(righe);
      const inatteso = (r) => !siglaCurata(r.nome) || ambS.has(chiaveAmbigua(r));
      const simboli = new Map();   // esame → segno, uno per tutta la tabella
      const gruppi = raggruppaStorico(righe)
        .map((g) => ({ ...g, righe: g.righe.filter((r) => !this.soloAlterati || r.valori.some((v) => v.v && v.stato)) }))
        .filter((g) => g.righe.length);

      const rigaEsame = (r) => {
        const p = provenienze(r, simboli);
        const um = unitaChiara((r.valori.find((v) => v && v.um) || {}).um || "", r.nome);
        const celle = col.map((c) => {
          const v = r.valori[c.i] || { v: "", stato: 0 };
          if (!v.v) return `<td class="vuoto">·</td>`;
          const sg = p.segno(v);
          const daChi = String(v.esame || r.esame || "").trim();
          // la novità (analita nuovo, valore cambiato dall'ultima lettura)
          // viaggia su un canale suo: lo sfondo, mai il colore del testo
          const n = nov && nov.get(chiaveCol(c))?.get(valKey(r.nome));
          const tip = [v.um, v.range, sg && daChi ? "fatto con " + daChi : "",
                       n === "nuovo" ? "nuovo dall'ultima lettura" : n === "cambiato" ? "aggiornato dall'ultima lettura" : ""].filter(Boolean).join(" · ");
          // il segno del medico (un tocco giallo, due arancio) vive sulla
          // cella: «colonna|analita», la stessa identità con cui la tabella
          // fonde i prelievi, così sopravvive a ogni ridisegno
          const cella = chiaveCol(c) + "|" + valKey(r.nome) + (eEga(r.esame) ? "|ega" : "") + (!r.mnem && r.nome === r.esame ? "|#" + (r.pos ?? 0) : "");
          const segno = segni[cella] === 2 ? " marca2" : segni[cella] === 1 ? " marca1" : "";
          return `<td class="${v.stato ? "fuori" : ""}${v.parziale ? " parz" : ""}${n === "nuovo" ? " nuovo" : n === "cambiato" ? " agg" : ""}${segno}" data-cella="${esc(cella)}"${
            tip ? ` title="${esc(tip)}${v.parziale ? " · parziale" : ""}"` : v.parziale ? ` title="parziale"` : ""
          }><span class="val">${esc(v.v)}${v.stato ? (v.stato < 0 ? "↓" : "↑") : ""}${
            sg ? `<i class="prov" title="${esc(daChi ? "fatto con " + daChi + (p.solita ? " — gli altri con " + p.solita : "") : "")}">${esc(sg)}</i>` : ""
          }</span>${v.pct ? `<span class="pct"> (${esc(v.pct)}%)</span>` : ""}</td>`;
        }).join("");
        const etichetta = inatteso(r)
          ? String(r.nome).replace(/\s+/g, " ").trim() + (eEga(r.esame) && ambS.has(chiaveAmbigua(r)) ? " (EGA)" : "")
          : sigla(r.nome);
        return `<tr><th class="stn${inatteso(r) ? " grezza" : ""}" title="${esc(r.nome)}${
          r.esame && r.esame !== r.nome ? " — " + esc(r.esame) : ""}${r.mnem ? " · " + esc(r.mnem) : ""}">${
          esc(etichetta)}${um ? `<span class="stum"> (${esc(um)})</span>` : ""}</th>${celle}</tr>`;
      };

      // In cima a ogni colonna: se il prelievo è di oggi basta l'ora; se è di
      // un altro giorno la data (27/08), con l'ora sotto in piccolo. Si legge
      // per confronto, e «quale giorno» conta solo quando non è questo.
      const d0 = new Date();
      const oggi = `${String(d0.getDate()).padStart(2, "0")}/${String(d0.getMonth() + 1).padStart(2, "0")}/${d0.getFullYear()}`;
      const ore = col.map((c, i) => {
        const diOggi = c.data === oggi;
        return {
          cima: c.ignota ? "?" : diOggi ? c.ora || "oggi" : c.data.slice(0, 5),
          sotto: c.ignota ? "ora ignota" : diOggi ? "" : c.ora,
          tip: [c.ignota ? "Il gestionale non dà data e ora per questo prelievo" : c.label, c.titolo].filter(Boolean).join(" · "),
          cls: i === 0 && !c.ignota ? "ultima" : "",
        };
      });
      const ora = (o, tag) => `<${tag} class="${o.cls}" title="${esc(o.tip)}">${esc(o.cima)}<span class="sth">${esc(o.sotto)}</span></${tag}>`;
      const testa = `<tr><th class="stn">Esame</th>${ore.map((o) => ora(o, "th")).join("")}</tr>`;

      // Fino a tre prelievi la tabella lunga e stretta lasciava vuoto il resto
      // del pannello: ogni sezione diventa un blocco con le sue ore in testa e
      // i blocchi si affiancano finché c'è posto. Resta UNA tabella (un
      // <tbody> per sezione): le celle, i segni e i tocchi sono gli stessi.
      const griglia = col.length <= 3;
      const corpo = gruppi.map((g) => {
        // niente conteggio dei fuori norma sulla riga di sezione: tanti sono
        // insignificanti, e il numero distrae da quelli che contano
        const sez = `<tr class="stsez"><th class="stn">${esc(g.nome)}</th>${griglia ? ore.map((o) => ora(o, "td")).join("") : `<td colspan="${col.length}"></td>`}</tr>`;
        // (il blocco è largo almeno quanto le sue colonne: con tre prelievi non ci stanno in 230 px)
        return griglia ? `<tbody class="stblk">${sez}${g.righe.map(rigaEsame).join("")}</tbody>` : sez + g.righe.map(rigaEsame).join("");
      }).join("");
      const nRighe = gruppi.reduce((n, g) => n + g.righe.length, 0);
      const legenda = [...simboli].map(([esame, segno]) => ({ segno, esame }));
      return {
        html: griglia
          ? `<div class="stwrap stgriglia c${col.length}"><table class="sttab"><thead>${testa}</thead>${corpo}</table></div>`
          : `<div class="stwrap"><table class="sttab"><thead>${testa}</thead><tbody>${corpo}</tbody></table></div>`,
        legenda, nRighe, nCol: col.length,
      };
    }

    // La legenda dei segni + la nota sui valori parziali: sotto la tabella,
    // scritta, non solo in un tooltip che su un portatile non si vede.
    piedeStorico(st, legenda) {
      const parz = st.righe.some((r) => r.valori.some((v) => v.parziale));
      // una riga sola; l'elenco intero degli esami nel passaggio del mouse
      const pezzi = legenda.map((l) => {
        const tutti = String(l.esame).split(/,\s*/).filter(Boolean);
        return `<span title="${esc("fatto con " + l.esame)}"><b>${esc(l.segno)}</b> con ${esc(tutti[0] || l.esame)}${tutti.length > 1 ? ` +${tutti.length - 1}` : ""}</span>`;
      });
      if (parz) pezzi.push(`<span title="Il laboratorio non ha finito"><i>corsivo</i>: parziale</span>`);
      return pezzi.length ? `<div class="hint stleg">${pezzi.join(" · ")}</div>` : "";
    }

    // The table read on the portal page comes back through the extension. It
    // is shown ONLY if it belongs to the patient on screen: everywhere else
    // in this program the identity is checked before the data is used, and a
    // table of values is the last place to make an exception.
    // Fra le schede in memoria, quella di QUESTO paziente. L'identità la
    // decide il pannello, non il service worker: le regole stanno in un posto
    // solo. Le altre schede non vengono nemmeno chieste.
    async schedaMia() {
      const r = await ask({ t: "getStorico" });
      const indice = (r && r.ok && r.indice) || [];
      if (!indice.length) { this.storicoAltri = ""; return null; }
      const titolo = nomeInPagina();
      const mio = this.cfEpisodio();
      const scelta = scegliScheda(indice, mio, titolo, this.episodeId);
      this.storicoVia = scelta && scelta.ep && String(scelta.ep) === String(this.episodeId)
        ? "dal paziente da cui l'hai aperta"
        : scelta && scelta.cf && mio ? "dal codice fiscale" : "dal nome";
      // C'è una scheda con questo nome ma non gliela si può attribuire perché
      // di questo paziente non conosciamo ancora il codice fiscale: lo si
      // dice, invece di far sparire un bottone senza spiegazioni.
      this.storicoDaConfermare = !scelta && !mio
        && indice.some((v) => v.cf && !v.ep && combaciaNome(titolo, v.paziente));

      if (!scelta) {
        // Le schede degli altri pazienti in memoria sono la norma: ognuno visto
        // nelle ultime 24 ore ha la sua, e dirlo a ogni paziente nuovo suonava
        // come uno scambio di pazienti. Lo si dice solo quando dal portale è
        // appena arrivato uno storico (dieci minuti) che non è di questo
        // paziente: è lì che il medico se lo aspettava, e deve sapere perché
        // non c'è. Se la scheda porta QUESTO nome non è «di un altro
        // paziente»: manca solo la prova che sia sua, e si dice diversamente.
        const dalPortale = (v) => !!(v.paziente?.idMPI || v.paziente?.cognome);
        // (una scheda senza codice fiscale col suo stesso nome non è «di un
        // altro»: non la si può attribuire, ma nemmeno accusare)
        const appena = indice.filter((v) => dalPortale(v) && Date.now() - (v.letto || 0) < 10 * 60e3
            && !(!v.cf && combaciaNome(titolo, v.paziente)))
          .sort((a, b) => (b.letto || 0) - (a.letto || 0))[0];
        this.storicoAltri = this.storicoDaConfermare || !appena ? ""
          : [appena.paziente.cognome, appena.paziente.nome].filter(Boolean).join(" ") || "un paziente che la pagina non nomina";
        return null;
      }
      const pieno = await ask({ t: "getStorico", chiave: scelta.chiave });
      return pieno && pieno.ok ? pieno.dati : null;
    }

    // E anche il testo di un referto letto: la scheda di un paziente è tutto
    // quello che il programma sa di lui, non solo i numeri.
    async archiviaReferto(e, righe) {
      if (!hasExt() || !righe || !righe.length) return;
      const chiave = this.chiavePaz();
      if (!chiave || chiave === "nome:") return;
      segnaChiave(this.episodeId, chiave);
      const vuota = {
        paziente: { idMPI: "", cognome: "", nome: nomeInPagina() },
        cf: this.cfEpisodio() || "", periodo: "", date: [], righe: [], scartate: [], letto: Date.now(),
      };
      await mettiInScheda(chiave, null, (vecchio) => {
        const base = vecchio || vuota;
        const referti = (base.referti || []).filter((r) => r.id !== e.id);
        // (righe è già il testo che si mostra, refertoMostrato: «mostrato», e nessuno lo ritaglia)
        referti.unshift({ id: e.id, quando: e.when || "", titolo: shortLabel(e.label || ""),
                          sistema: e.sistema || "", testo: righe.slice(0, 200).join("\n").slice(0, 20000), mostrato: true });
        return { ...base, referti: referti.slice(0, 40), letto: Date.now() };
      });
    }

    // Ogni prelievo letto entra anche nella scheda clinica del paziente, così
    // quello che il pannello sa di lui sta in un posto solo: la tabella del
    // portale e le finestre Risultati del gestionale, parziali comprese.
    async archiviaPrelievo(e, rows, cf, scartate) {
      if (!hasExt() || !rows || !rows.length) return;
      const t = prelievoComeTabella(risMeta(e), rows, cf, scartate);
      if (!t) return;
      const chiave = chiaveArchivio(t);
      if (!chiave || chiave === "nome:") return;
      segnaChiave(this.episodeId, chiave);
      await mettiInScheda(chiave, t);
    }

