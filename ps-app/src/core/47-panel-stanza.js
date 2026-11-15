//@frammento 47-panel-stanza.js — Panel (segue): STANZA (mappa, letti, trascinamento, Modifica), LISTA, filtri, pin «Da rivedere».
    // ================================================================ STANZA
    // La mappa della stanza del PS. Letti (un paziente ciascuno) e aree senza
    // letto (corridoio, attesa: quanti ne servono); sopra, la lista, dove
    // sta chiunque non abbia un posto — un paziente non sparisce mai.
    // Di norma si spostano i PAZIENTI (trascinando, o «Sposta in…»); con
    // Modifica si disegna la STANZA, di solito una volta sola. Ogni spostamento
    // si annulla per 8 secondi. Tutto resta in questo browser: la stanza in
    // "stanza.<mappa>.v1" (celle intere della PIANTA, così a ogni misura è la
    // stessa), chi-sta-dove in "stanza.<mappa>.posti.v1" — solo episodi, mai
    // nomi. Una mappa per area (MAPPE): si vede quella dell'area del medico.
    mappa() { return MAPPE[this._mk] || MAPPE[this.mappeVisibili()[0]] || MAPPE.ps; }
    // l'episodio della pagina aperta. La lista del PS non ne ha uno suo: i
    // suoi link portano quello del primo in elenco, che non è «qui».
    epDiQuesta() { return this.episodeId && !this.listaPs() ? this.episodeId : ""; }
    listaPs() { return this.pageType === "patient" && !(this.entry && (this.entry.labUrl || this.entry.radioUrl)); }
    // Richieste | Esiti nella fila delle schede: dove c'è un paziente — la sua
    // pagina, una sua pagina «altra», il carrello di una sua richiesta (lì
    // dopo un errore c'è il resoconto, e dagli Esiti ci si torna). Sulla
    // lista del PS no: lì c'è Pazienti, anche da EO, Consensi o Dimissioni.
    schedePaziente() { return !!this.epDiQuesta() && ["patient", "vista", "exam"].includes(this.pageType); }
    // il resoconto di un giro finito o fermato sta nelle Richieste (con le
    // schede) se il giro è del paziente di questa pagina
    mostraResoconto() { if (this.schedePaziente()) { this.view = "richieste"; this.viewId = null; } }
    resoNelleRichieste(qui = nomeInPagina()) {
      return !!this.runState && this.runState !== "running" && this.schedePaziente() && !(this.runPatient && qui && this.runPatient !== qui);
    }
    // Aprire un paziente dal pannello: il suo è già qui, un altro si carica
    // (e la sua pagina si apre sulla schermata scelta).
    apriPaziente(ep, go) {
      // dal tabellone: lo apre una scheda del gestionale, dal SUO indirizzo
      if (TABELLONE) return void tabelloneChiede({ cosa: "apri", ep, go });
      if (ep && ep === this.epDiQuesta()) return this.setView(this.vistaApertura(go));
      const p = knownPatients().find((x) => x.ep === ep);
      // noto solo dalla lista smart (nessun link suo): la sua area, e dalla lista il link della sua riga
      if (p && p.smart && !p.url) {
        const k = areeLeggi().membri[ep]?.k;
        return k && p.nato ? apriArea(k, { nome: normNome(p.name), nato: p.nato }) : undefined;
      }
      if (!p || !p.url) return;
      this.fermaAuto();   // si lascia questo paziente: il caricamento in sottofondo si ferma
      tabStore.set("afterNav.v1", { ep, view: go, ts: Date.now() }); // open there, on their page
      nav(p.url);
    }
    // nel tabellone, accanto al titolo: c'è una scheda del gestionale a cui chiedere?
    tabelloneSpia() {
      if (!TABELLONE) return "";
      return TAB_SCHEDE == null ? `<span class="tbspia">…</span>`
        : TAB_SCHEDE ? `<span class="tbspia"></span>`
        : `<span class="tbspia no" title="Nessuna scheda del gestionale aperta: qui si guarda soltanto">gestionale chiuso</span>`;
    }
    // la schermata dei Pazienti: quella che non è nessun'altra
    inPazienti() {
      return !this.runState && !["esiti", "referto", "dimissioni", "dimtesto", "dimimport", "eo", "eotesto", "registrazioni", "consegne", "etichetta", "iphone", "richieste", "stampa", "ricetta", "terapia"].includes(this.view);
    }
    // In fondo alla fila delle schede, solo in Modifica: + Letto, + Sedia,
    // + Area e Fine. Si entra in Modifica dal menu «⋯».
    stanzaAzioni() {
      if (!this.inPazienti() || !this.stanzaEdit) return "";
      return `<span class="stazioni"><button type="button" class="stbtn" id="stpiuletto" title="Aggiungi un letto: un paziente">+ Letto</button><button type="button" class="stbtn" id="stpiusedia" title="Aggiungi una sedia: un paziente, in meno spazio">+ Sedia</button><button type="button" class="stbtn" id="stpiuarea" title="Aggiungi un'area senza letti (corridoio, attesa): più pazienti">+ Area</button><button type="button" class="stbtn pri" id="stfine" title="La stanza è pronta: si torna a spostare i pazienti (Esc)">Fine</button></span>`;
    }
    // La stanza com'è salvata, ripulita: celle intere dentro la pianta, niente
    // sopra un altro, nomi corti, niente doppioni. Quello che non torna (anche
    // una stanza salvata in un altro formato) si lascia fuori. Senza una
    // stanza salvata — o se non ne resta niente — quella di partenza (del PS, o dell'Alta):
    // togliendo tutto, torna quella.
    stanzaSala() {
      const mp = this.mappa(), salvata = store.get(mp.sala, null);
      // mai salvata: la pianta di partenza. Svuotata apposta: resta vuota
      if (!salvata || typeof salvata !== "object") return { letti: mp.base.letti.map((l) => ({ ...l })), aree: mp.base.aree.map((a) => ({ ...a })) };
      const s = salvata;
      const { cols, rows, aw, ah } = PIANTA;
      const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
      const visti = new Set(), presi = [];
      const buono = (o) => typeof o.id === "string" && /^[\w-]{1,16}$/.test(o.id) && !visti.has(o.id) && visti.add(o.id);
      const posa = (q) => !presi.some((p) => troppoVicini(p, q)) && presi.push(q);
      const nome = (o, d) => String(o.nome ?? "").replace(/\s+/g, " ").trim().slice(0, 24) || d;
      const letti = [], aree = [];
      for (const l of Array.isArray(s.letti) ? s.letti : []) {
        const { w, h } = misuraLetto(l || {}), forma = FORME.includes(l?.forma) ? l.forma : "", sedia = forma === "sedia";
        if (letti.length >= 60 || !l || !int(l.c, 0, cols - w) || !int(l.r, 0, rows - h) || !buono(l) || !posa({ c: l.c, r: l.r, w, h })) continue;
        letti.push({ id: l.id, c: l.c, r: l.r, nome: nome(l, sedia ? "Sedia" : "Letto"), ...(forma && { forma }) });
      }
      for (const a of Array.isArray(s.aree) ? s.aree : []) {
        if (aree.length >= 30 || !a || !int(a.w, aw, cols) || !int(a.h, ah, rows) || !int(a.c, 0, cols - a.w) || !int(a.r, 0, rows - a.h)
          || !buono(a) || !posa({ c: a.c, r: a.r, w: a.w, h: a.h })) continue;
        aree.push({ id: a.id, c: a.c, r: a.r, w: a.w, h: a.h, nome: nome(a, "Area") });
      }
      return { letti, aree };
    }
    // gli oggetti della stanza come rettangoli di celle
    stanzaRettangoli(sala) {
      return [...sala.letti.map((l) => ({ id: l.id, c: l.c, r: l.r, ...misuraLetto(l) })),
        ...sala.aree.map((a) => ({ id: a.id, c: a.c, r: a.r, w: a.w, h: a.h }))];
    }
    stanzaScrivi(sala) {
      if (store.set(this.mappa().sala, sala)) return true;
      this.message = "La stanza NON è stata salvata: la memoria di questo browser è piena o bloccata.";
      this.render();
      return false;
    }
    // Lo stesso paziente (stesso codice fiscale) con due episodi aperti: il
    // più vecchio è l'«episodio precedente» — fuori dalla stanza, in grigio.
    stanzaPrecedenti(pazienti) {
      const perCf = new Map(), out = new Set();
      for (const p of pazienti) if (String(p.pk || "").startsWith("cf:")) perCf.set(p.pk, [...(perCf.get(p.pk) || []), p]);
      const num = (p) => (/^\d+$/.test(p.ep) ? Number(p.ep) : NaN);
      for (const l of perCf.values()) {
        if (l.length < 2) continue;
        l.sort((a, b) => (Number.isNaN(num(a)) || Number.isNaN(num(b)) ? (b.ts || 0) - (a.ts || 0) : num(b) - num(a)));
        for (const p of l.slice(1)) out.add(p.ep);
      }
      return out;
    }
    // Chi sta dove. Un paziente in elenco tiene il suo posto finché non lo
    // sposti, non lo togli dall'elenco o dall'elenco non sparisce: se non lo
    // apri da 12 ore diventa grigio, ma resta dov'è. Un letto tiene un
    // paziente: se i dati ne dicono due, resta il più recente. Il posto di chi
    // non è in elenco (sessione scaduta, archiviato) aspetta un giorno che
    // torni — ma mai su un letto già preso.
    stanzaStato(pazienti, sala, precedenti) {
      const kp = this.mappa().posti, raw = store.get(kp, {});
      const tutti = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const ora = Date.now(), perEp = new Map(pazienti.map((p) => [p.ep, p]));
      const letti = new Set(sala.letti.map((l) => l.id)), aree = new Set(sala.aree.map((a) => a.id));
      const esiste = (v) => v && (v.tipo === "letto" ? letti.has(v.id) : v.tipo === "area" && aree.has(v.id));
      const voci = Object.entries(tutti).filter(([ep]) => /^[\w.-]{1,40}$/.test(ep)).sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0));
      const posti = {}, perLetto = {}, tieni = {}, preso = {};
      for (const [ep, v] of voci) {   // prima chi è in elenco: sono loro a occupare i letti
        const p = perEp.get(ep);
        if (!p || !esiste(v) || precedenti.has(ep) || (v.tipo === "letto" && perLetto[v.id])) continue;
        if (v.tipo === "letto") perLetto[v.id] = preso[v.id] = ep;
        posti[ep] = tieni[ep] = { tipo: v.tipo, id: v.id, ts: +v.ts || 0 };
      }
      for (const [ep, v] of voci) {   // poi chi non c'è
        if (perEp.has(ep) || !esiste(v) || ora - (+v.ts || 0) > PATIENTS_TTL || (v.tipo === "letto" && preso[v.id])) continue;
        if (v.tipo === "letto") preso[v.id] = ep;
        tieni[ep] = { tipo: v.tipo, id: v.id, ts: +v.ts || 0 };
      }
      if (tutti !== raw || Object.keys(tieni).length !== Object.keys(tutti).length) store.set(kp, tieni);
      return { posti, perLetto };
    }
    // I nomi. «ROSSI MARIO» → «ROSSI M.»; il cognome si porta dietro le
    // particelle (DE LUCA, DELLA ROSA). Due pazienti attivi con lo stesso
    // cognome: ⚠ e il nome intero. Con lo stesso nome intero: anche le ultime
    // quattro cifre dell'episodio, «· …9001».
    stanzaNomi(pazienti, precedenti) {
      const PART = new Set(["DE", "DI", "DA", "DEL", "DELLA", "DELLE", "DELLO", "DEI", "DEGLI", "DAL", "DALLA", "DALLE", "DALLO",
        "LA", "LO", "LE", "LI", "SAN", "SANTA", "SANTO", "VAN", "VON", "MC", "MAC", "DOS", "DAS", "DU"]);
      const parti = (nome) => {
        const w = String(nome || "").trim().split(/\s+/).filter(Boolean);
        let i = 0;
        while (i < w.length - 2 && PART.has(w[i].toUpperCase())) i++;
        return { cognome: w.slice(0, i + 1).join(" "), nome: w.slice(i + 1).join(" ") };
      };
      const conta = (chiave) => {
        const c = new Map();
        for (const p of pazienti) if (!precedenti.has(p.ep)) { const k = chiave(p); if (k) c.set(k, (c.get(k) || 0) + 1); }
        return c;
      };
      const perCognome = conta((p) => normNome(parti(p.name).cognome)), perNome = conta((p) => normNome(p.name));
      return new Map(pazienti.map((p) => {
        const { cognome, nome } = parti(p.name), vivo = !precedenti.has(p.ep);
        const omonimo = vivo && perCognome.get(normNome(cognome)) > 1;
        const coda = vivo && perNome.get(normNome(p.name)) > 1 ? ` · …${String(p.ep).slice(-4)}` : "";
        const breve = !cognome ? "paziente" : omonimo || !nome ? `${cognome} ${nome}`.trim() : `${cognome} ${nome[0].toUpperCase()}.`;
        return [p.ep, { breve, lungo: p.name || "paziente", coda, omonimo }];
      }));
    }
    // Tutto quello che la lista e la stanza mostrano dei pazienti, calcolato una volta
    pazModello() {
      const pazienti = knownPatients(), sala = this.stanzaSala();
      const precedenti = this.stanzaPrecedenti(pazienti);
      const { posti, perLetto } = this.stanzaStato(pazienti, sala, precedenti);
      const nomi = this.stanzaNomi(pazienti, precedenti);
      const qui = this.epDiQuesta(), ora = Date.now();
      const info = new Map(pazienti.map((p) => [p.ep, {
        p, ...nomi.get(p.ep), qui: p.ep === qui, prec: precedenti.has(p.ep),
        spento: precedenti.has(p.ep) || ora - vistoTs(p) > 12 * 3600e3, posto: posti[p.ep] || null,
      }]));
      const df = dfTutti();
      return { pazienti, sala, posti, perLetto, info, qui, df, prom: promTutti(df) };
    }
    nomePosto(m, i) {
      const v = i && i.posto;
      return !v ? "" : (v.tipo === "letto" ? m.sala.letti : m.sala.aree).find((o) => o.id === v.id)?.nome || "";
    }
    oraDi(ts) { return (new Date().toDateString() === new Date(ts || 0).toDateString() ? "" : "ieri ") + hhmm(ts); }
    vistoFa(ts) {
      const min = Math.max(0, Math.round((Date.now() - (ts || 0)) / 60000));
      return min < 1 ? "visto adesso" : min < 60 ? `visto ${min} min fa` : `visto ${Math.floor(min / 60)} h fa`;
    }
    // Il passaggio del mouse dice tutto: chi è, quale episodio, quando l'hai
    // aperto, da quando sta dove sta, il triage, la prima cosa da fare.
    pazTitolo(m, i, mappa) {
      const { p } = i, posto = this.nomePosto(m, i);
      const cuore = i.prec ? null : cuoreDi(statoDi(p.ep)?.vit);
      return [
        i.lungo + i.coda + (Number.isInteger(p.eta) ? `, ${p.eta} anni` : ""),
        `episodio ${p.ep}${p.ts ? ` · aperto ${this.oraDi(p.ts)}` : ""}`,
        posto && `in ${posto} dalle ${this.oraDi(i.posto.ts)}`,
        p.triage && `triage all'apertura: ${p.triage}`,
        cuore && `♥ ${cuore.titolo.split("\n")[0]}`,
        !i.prec && statoTitolo(statoEsami(statoDi(p.ep))),
        m.df && dfPrima(p.ep, m.df) && `Da fare: ${dfPrima(p.ep, m.df).testo}${dfAperte(p.ep, m.df).length > 1 ? ` (+${dfAperte(p.ep, m.df).length - 1})` : ""}`,
        i.omonimo && "⚠ stesso cognome di un altro paziente in elenco",
        i.prec && "Episodio precedente: di questo paziente c'è un episodio più recente",
        mappa && (i.prec ? "Un tocco lo apre" : "Un tocco apre gli esiti · trascinalo, o tasto destro: Sposta in…"),
      ].filter(Boolean).join("\n");
    }
    // a destra del nome: «questa pagina», o da quanto non lo apri (in ambra dopo 3 ore)
    pazStato(i) {
      if (i.prec) return `<span class="sttag">episodio precedente</span>`;
      if (i.qui) return `<span class="stqui">questa pagina</span>`;
      if (!i.p.ts) return "";   // dalla lista della sua area, mai aperto
      return `<span class="stvisto${Date.now() - (i.p.ts || 0) > 3 * 3600e3 ? " amb" : ""}">${this.vistoFa(i.p.ts)}</span>`;
    }
    // LISTA — chi non ha ancora un posto, una riga per paziente: triage, nome,
    // il cuore e lo stato degli esami, «Da fare» (quante, e la prima: il
    // post-it), da quanto non lo apri; ▾ lo mette nella stanza senza
    // trascinarlo, e passandoci sopra la ✕.
    // Chi è su questa pagina per primo, l'episodio precedente in fondo.
    viewLista(m, patientName) {
      const canOrder = !!(this.entry && (this.entry.labUrl || this.entry.radioUrl));
      // tutti quelli della vista (l'area e il triage). In Lista, tutti; in Mappa
      // solo chi non ha ancora un posto: gli altri sono sulla mappa
      const tutti = [...m.info.values()].filter((i) => i.vista !== false || i.qui).sort((a, b) => b.qui - a.qui || a.prec - b.prec || !!a.posto - !!b.posto);
      const inLista = this.modoTab() === "lista", lista = inLista ? tutti : tutti.filter((i) => !i.posto);
      // Il nome è quello con cui il paziente è stato conosciuto. Il titolo
      // della pagina si usa solo se non ne abbiamo uno: sulla lista PS quel
      // titolo è «PRONTO SOCCORSO - LISTA», e stamparlo dove va il nome del
      // paziente è esattamente ciò che questo programma promette di non fare.
      if (m.qui && canOrder && !m.info.has(m.qui)) {
        lista.unshift({ p: { ep: m.qui, name: patientName, ts: Date.now() }, breve: patientName, lungo: patientName || "paziente",
                        coda: "", omonimo: false, qui: true, prec: false, spento: false, posto: null });
      }
      // la riga intera apre il paziente: il bottone del nome la copre tutta, e
      // gli altri comandi stanno sopra — niente bottoni dentro bottoni. Si
      // prende e si porta su un letto, una sedia o un'area, come nella stanza.
      // La riga dice poco, e sempre nello stesso posto: triage, nome ed età, il
      // posto, da quanto è in PS, il cuore, Lab · ECG · RX (grigio: chiesto e
      // in attesa, col tempo; ambra: tornato in parte; verde: tornato tutto)
      // e quante cose ha da fare. Niente valori, niente testo: quelli li dice
      // la scheda che si apre passando sul nome.
      const ora = Date.now();
      const riga = (i) => {
        const { p } = i, tr = p.triage ? " t-" + p.triage.toLowerCase() : i.ignoto ? " t-ignoto" : "", vero = m.info.has(p.ep), mobile = vero && !i.prec;
        const posto = m.nomeDi ? m.nomeDi(i) : "", inPs = p.arrivo ? attesaTesto(minDa(p.arrivo, ora)) : "";
        const eta = Number.isInteger(p.eta) ? p.eta : null;
        return `
        <div class="pzrow${i.qui ? " qui" : ""}${i.prec ? " prec" : ""}${i.posto ? " haposto" : ""}"${mobile ? ` data-riga="${esc(p.ep)}"` : ""} data-pz="${esc(p.ep)}" data-cerca="${esc(normNome(i.lungo))}">
          <i class="pztr${tr}" aria-hidden="true"></i>
          <div class="pzchi">
            <button type="button" class="pzapri" data-go="esiti" data-ep="${esc(p.ep)}"${mobile ? ' aria-haspopup="menu"' : ""} aria-label="${esc(this.pazTitolo(m, i, mobile).replace(/\n/g, " · "))}">
              <span class="pznm">${i.omonimo ? `<b class="stom" aria-label="attenzione, stesso cognome di un altro paziente">⚠</b>` : ""}${esc(i.lungo)}${i.coda ? `<span class="stcoda">${esc(i.coda)}</span>` : ""}${
                eta != null ? ` <span class="pzeta">${eta}</span>` : ""}</span>${p.triage ? `<span class="stsr">, triage ${esc(p.triage)}</span>` : ""}
            </button>
            ${posto ? `<span class="pzposto">${esc(posto)}</span>` : ""}
            ${inPs ? `<span class="pzinps" title="In pronto soccorso dalle ${esc(hhmm(p.arrivo))}">${inPs}</span>` : ""}
            ${i.prec ? `<span class="sttag">episodio precedente</span>` : this.cuoreHtml(p.ep) + marchiEsami(statoEsami(statoDi(p.ep), ora), ora) + this.dfSlot(p.ep, m.df, "lista")}
          </div>
          ${mobile ? `<button type="button" class="pzmetti" data-posto="${esc(p.ep)}" aria-haspopup="menu" title="Mettilo nella stanza: scegli il letto, la sedia o l'area" aria-label="Metti ${esc(i.lungo)} nella stanza">${ico('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>')}</button>` : ""}
          ${vero ? `<button type="button" class="pzx" data-parch="${esc(p.ep)}" title="Togli dall'elenco: va negli archiviati (si può annullare). Nel gestionale non cambia niente." aria-label="Togli ${esc(i.lungo)} dall'elenco">✕</button>` : ""}
        </div>`;
      };
      // il filtro: compare scrivendo una lettera (vedi filtroTasto)
      const filtro = this._filtro == null ? "" : `
        <div class="pzfiltro" role="search">${ico('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>')}
          <input type="text" id="pzcerca" value="${esc(this._filtro)}" maxlength="40" placeholder="Cerca un paziente" autocomplete="off" spellcheck="false"
            aria-label="Cerca fra i pazienti: la lista si stringe, nella stanza gli altri si spengono">
          <button type="button" class="pzfx" id="pzcercax" title="Togli il filtro (Esc)" aria-label="Togli il filtro">✕</button>
        </div>`;
      const righe = this.listaPerArea(lista, riga, tutti, inLista);
      if (righe) return `${filtro}<div class="pzcoda" data-drop="tray" role="group" aria-label="Pazienti: ${lista.length}"><div class="pzvuoto pzfnone" hidden></div>${righe}</div>`;
      return filtro + (m.pazienti.length ? "" : `<div class="pzvuoto">Nessun paziente.</div>`);
    }
    // La lista per area — Alta intensità · Bassa · OBI · Codici minori, poi le
    // aree che il programma non conosce, col loro nome —, ognuna sotto un filo
    // col suo titolo: un tocco apre la sua lista nel gestionale. Ci sono le
    // aree con qualcuno in lista e quelle di cui si è vista la lista; chi non
    // ha ancora un'area sta in cima, senza titolo. Nessuna area vista mai: la
    // lista di sempre.
    // `tutti`: chi è nella vista, posti compresi (in Mappa la lista ne mostra
    // solo una parte: un'area vuota perché i suoi sono sulla mappa non ha titolo).
    // In Lista (`ordinata`) ogni area ha solo chi c'è, nell'ordine del gestionale
    // — la riga dell'ultima lista intera letta; chi non è mai stato in una lista
    // viene dopo, per ingresso — e chi non ha area sta in fondo.
    listaPerArea(lista, riga, tutti = lista, ordinata = false) {
      const a = areeLeggi(), k = (i) => a.membri[i.p.ep]?.k || "";
      if (!ordinata && !Object.keys(a.viste).length && !tutti.some(k)) return lista.map(riga).join("");
      // (le aree vuote solo se sono della vista: il loro titolo apre la loro lista)
      const v = this.vistaTab(), dellaVista = (c) => v === "entrambe" || (c === "obi" ? true : tabelloniDi(c, "").length === 1 && tabelloniDi(c, "")[0] === v);
      const chiavi = [...new Set([...Object.keys(a.viste).filter(dellaVista), ...tutti.map(k).filter(Boolean)])]
        .sort((x, y) => ordineArea(x) - ordineArea(y) || x.localeCompare(y));
      const gruppi = new Map([["", []], ...chiavi.map((c) => [c, []])]);
      for (const i of lista) gruppi.get(k(i)).push(i);
      if (ordinata) {
        const n = (i) => a.membri[i.p.ep]?.n, sa = (i) => Number.isInteger(n(i)), ingresso = (i) => i.p.arrivo || i.p.ts || Infinity;
        for (const l of gruppi.values()) l.sort((x, y) => !!x.prec - !!y.prec || (sa(x) && sa(y) ? n(x) - n(y) : sa(y) - sa(x)) || (ingresso(x) - ingresso(y)) || 0);
      }
      return (ordinata ? [...chiavi, ""] : ["", ...chiavi]).filter((c) => gruppi.get(c).length || (!ordinata && !tutti.some((i) => k(i) === c && i.posto)))
        .map((c) => (c ? `<div class="pzsez"><button type="button" class="pzsezt" data-sez="${esc(c)}" title="Apri la lista dell'area nel gestionale">${
          esc(titoloArea(c, a.viste[c]?.label))}</button></div>` : "") + gruppi.get(c).map(riga).join("")).join("");
    }
    // in fondo, chiusi: gli archiviati
    pazArchivio(m) {
      const rigaArch = (p) => `
        <div class="pzarow">
          <span class="pzanm" title="${esc(p.name || "")}">${esc(p.name || "paziente")}</span>
          <span class="pzameta">archiviato ${esc(agoLabel(p.archTs || p.ts))}</span>
          <button type="button" class="pzabtn" data-unarch="${esc(p.ep)}" title="Riportalo fra i pazienti attivi">↩ riporta</button>
        </div>`;
      const archiviati = pazientiArchiviati();
      if (!m.pazienti.length && !archiviati.length) return "";
      return `<div class="pzpiede">
        <button type="button" class="pzarchhd" id="archtog" aria-expanded="${this.mostraArch ? "true" : "false"}">Archiviati${archiviati.length ? ` <span class="stn">${archiviati.length}</span>` : ""}<span aria-hidden="true">${this.mostraArch ? "▾" : "▸"}</span></button>
        ${this.mostraArch ? `<div class="pzarch">${archiviati.map(rigaArch).join("")}
          ${archiviati.length ? "" : `<div class="pzhint">Nessun paziente archiviato.</div>`}
        </div>` : ""}</div>`;
    }
    // Il paziente nella Stanza: striscia del triage, nome (⚠ se un altro ha
    // lo stesso cognome), e sotto il cuore, «questa pagina» (o «episodio
    // precedente»), gli esami e la prima cosa da fare. Da quanto non lo apri lo dice la lista; qui, dopo 12 ore, il
    // grigio. Nel letto la striscia la porta il letto, il nome sta su una riga
    // e l'episodio che lo distingue scende accanto allo stato: non si taglia mai.
    stanzaChip(m, i, inLetto) {
      const { p } = i, edit = !!this.stanzaEdit;
      const cls = ["stp", i.qui && "qui", i.prec && "prec", i.spento && "spento", !inLetto && p.triage && "tri t-" + p.triage.toLowerCase()].filter(Boolean).join(" ");
      const etichetta = `${esc(i.lungo + i.coda)}${Number.isInteger(p.eta) ? `, ${p.eta} anni` : ""}${p.triage ? `, triage ${esc(p.triage)}` : ""}${i.qui ? ", questa pagina" : i.prec ? ", episodio precedente" : ""}`;
      // Nel letto: il nome e l'età, e basta. In alto a destra, sulla riga del
      // letto, il cuore (solo l'icona) e un pallino solo, se c'è qualcosa;
      // tutto il resto nel passaggio del mouse e nella riga della lista.
      if (inLetto) {
        // DELL'ACQUA va a capo dopo l'apostrofo; l'iniziale resta attaccata al cognome («ROSSI M.» non si spezza)
        const nome = esc(i.breve).replace(/&#39;/g, "&#39;<wbr>").replace(/ (\S\.)$/, "\u00A0$1");
        const segni = i.prec ? "" : `<span class="stsegni">${this.cuoreHtml(p.ep, undefined, true)}<span class="stsegslot" data-dfseg="${esc(p.ep)}">${this.segnaleHtml(p.ep, m.df)}</span></span>`;
        return `<div class="${cls}" data-stp="${esc(p.ep)}" data-cerca="${esc(normNome(i.lungo))}" role="button" tabindex="${edit ? -1 : 0}"${i.prec ? "" : ' aria-haspopup="menu"'} aria-label="${etichetta}">
        <span class="stp1">${i.omonimo ? `<b class="stom" aria-hidden="true">⚠</b>` : ""}<b class="stpn">${nome}${i.coda ? `<span class="stcoda">${esc(i.coda)}</span>` : ""}</b>${
          Number.isInteger(p.eta) ? ` <span class="steta">${p.eta}</span>` : ""}</span>${segni}</div>`;
      }
      // nell'area: sotto il nome il cuore, gli esami in breve (un pezzetto per
      // tipo, solo quello che aspetta) e il post-it, che cede per primo
      const post = i.prec ? "" : this.dfPostSlot(p.ep, m.df);
      const stato = i.prec ? `<span class="sttag">episodio precedente</span>` : i.qui ? `<span class="stqui">questa pagina</span>` : "";
      const cuore = i.prec ? "" : this.cuoreHtml(p.ep), es = i.prec ? "" : statoHtml(statoEsami(statoDi(p.ep)), { breve: true });
      const sotto = `${cuore}${stato}${es}${post}`;
      return `<div class="${cls}" data-stp="${esc(p.ep)}" data-cerca="${esc(normNome(i.lungo))}" role="button" tabindex="${edit ? -1 : 0}"${i.prec ? "" : ' aria-haspopup="menu"'} aria-label="${etichetta}">
        <span class="stp1">${i.omonimo ? `<b class="stom" aria-hidden="true">⚠</b>` : ""}<b class="stpn">${esc(i.breve)}${i.coda ? `<span class="stcoda">${esc(i.coda)}</span>` : ""}</b>${i.prec ? "" : this.dfSlot(p.ep, m.df, "area")}</span>${
        sotto ? `<span class="stp2">${sotto}</span>` : ""}</div>`;
    }
    // il letto (o la sedia) vuoto: a tratto, appena accennato
    stanzaGlifo(w, cls, sedia, barella) {
      const t = 'vector-effect="non-scaling-stroke"';
      const [vb, h, d] = barella ? ["0 0 12 24", w * 2, `<rect ${t} x="2" y="2" width="8" height="20" rx="2"/><path ${t} d="M4 6h4"/>`]
        : sedia ? ["0 0 20 20", w, `<path ${t} d="M5 3l1.5 8v6M6.5 11h8.5v6"/>`]
        : ["0 0 30 20", Math.round(w * 2 / 3), `<path ${t} d="M2 3v15M2 14h26v4M2 10h24a2 2 0 0 1 2 2v2"/><rect ${t} x="5" y="6" width="7" height="4" rx="1.5"/>`];
      return `<svg${cls ? ` class="${cls}"` : ""} width="${w}" height="${h}" viewBox="${vb}" fill="none" stroke="#C4D0DC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    }
    // il nome di un letto, di una sedia o di un'area; in Modifica un tocco lo rende scrivibile
    stanzaNome(tipo, o) {
      const r = this._stanzaRinomina;
      if (this.stanzaEdit && r && r.tipo === tipo && r.id === o.id) {
        return `<input type="text" class="stnomein" maxlength="24" value="${esc(r.testo)}" spellcheck="false" autocomplete="off" aria-label="Nome ${tipo === "area" ? "dell'area" : o.forma === "sedia" ? "della sedia" : "del letto"}">`;
      }
      return this.stanzaEdit
        ? `<span class="stname" data-stnome="${tipo}" role="button" tabindex="0" title="Tocca per rinominare, trascina per spostare">${esc(o.nome)}</span>`
        : `<span class="stname">${esc(o.nome)}</span>`;
    }
    // In Modifica, sull'oggetto scelto o sotto il mouse: × lo elimina;
    // l'angolo in basso a destra allarga l'area.
    stanzaCtl(tipo, o) {
      const del = `<button type="button" class="stctl stx" data-stdel="${tipo}:${esc(o.id)}" title="Elimina ${tipo === "area" ? "l'area" : o.forma === "sedia" ? "la sedia" : "il letto"} «${esc(o.nome)}»: chi c'era torna in lista. Si può annullare." aria-label="Elimina ${esc(o.nome)}">×</button>`;
      return tipo === "letto" ? del : `${del}<span class="strsz" data-strsz="1" title="Trascina per ridimensionare l'area"></span>`;
    }
    // Chi aspetta al Triage, nella mappa `k`: { r (la riga della lista), posto }
    ospitiIn(k, pazienti) {
      const sala = (kk) => this.conMappa(kk, () => this.stanzaSala());
      return triageOspiti(pazienti).map((r) => ({ r, posto: postoOspite(r.k, sala) })).filter((x) => x.posto && x.posto.k === k);
    }
    // la sua etichetta: il nome corto e il colore del triage; si trascina, non si apre (non ha una pagina nostra)
    stanzaOspite({ r }, inLetto) {
      const tr = TRIAGE_COLORI.includes(r.triage) ? ` tri t-${r.triage.toLowerCase()}` : "";
      const eta = Number.isInteger(r.eta) ? r.eta : null;
      return `<div class="stp ospite${inLetto ? "" : tr}" data-stp="${esc(r.k)}" data-ospite="1" data-cerca="${esc(normNome(r.nome))}" role="button" tabindex="${this.stanzaEdit ? -1 : 0}"
        aria-label="${esc(r.nome)}${eta != null ? `, ${eta} anni` : ""}${r.triage ? `, triage ${esc(r.triage)}` : ""}, al triage" title="${esc(r.nome)} — al triage: trascinalo dove sta">
        <span class="stp1"><b class="stpn">${esc(r.breve || r.nome)}</b>${eta != null ? ` <span class="steta">${eta}</span>` : ""}</span>${inLetto ? "" : `<span class="stp2"><span class="sttag">al triage</span></span>`}</div>`;
    }
    viewStanza(m) {
      const { sala, pazienti, info, perLetto, posti } = m;
      const edit = !!this.stanzaEdit;
      const chip = (p) => this.stanzaChip(m, info.get(p.ep));
      const ospiti = edit ? [] : this.ospitiIn(this.mappa().k, pazienti);
      const ospiteIn = (tipo, id) => ospiti.filter((o) => o.posto.tipo === tipo && o.posto.id === id);
      // In Modifica la pianta intera, coi puntini: sotto il mouse niente cambia
      // misura. Fuori, solo il pezzo disegnato con una cella di margine: anche
      // una stanza piccola riempie la mappa.
      const rett = this.stanzaRettangoli(sala);
      let c0 = 0, r0 = 0, cols = PIANTA.cols, rows = PIANTA.rows;
      if (!edit && rett.length) {
        c0 = Math.min(...rett.map((q) => q.c)) - 1;
        r0 = Math.min(...rett.map((q) => q.r)) - 1;
        cols = Math.max(...rett.map((q) => q.c + q.w)) + 1 - c0;
        rows = Math.max(...rett.map((q) => q.r + q.h)) + 1 - r0;
      }
      const celle = (c, r, w, h) => `--c:${c - c0};--r:${r - r0};--w:${w};--h:${h}`;
      // la sedia è un letto più piccolo: stesse regole, un paziente
      const letto = (l) => {
        const i = perLetto[l.id] ? info.get(perLetto[l.id]) : null, sedia = l.forma === "sedia", { w, h } = misuraLetto(l);
        const o = i ? null : ospiteIn("letto", l.id)[0];   // (un letto preso da un paziente non ha ospiti)
        const tr = i ? i.p.triage : o && TRIAGE_COLORI.includes(o.r.triage) ? o.r.triage : "";
        const cls = ["stbed", l.forma, (i || o) && "occ", i?.qui && "qui", tr && "tri t-" + tr.toLowerCase(),
          edit && this._stanzaSel === "letto:" + l.id && "sel"].filter(Boolean).join(" ");
        const occ = i ? { nome: i.breve + i.coda, ep: i.p.ep, lungo: i.lungo } : o ? { nome: o.r.breve || o.r.nome, ep: o.r.k, lungo: o.r.nome } : null;
        return `<div class="${cls}" data-letto="${esc(l.id)}" data-drop="letto:${esc(l.id)}"${occ ? ` data-occ="${esc(occ.nome)}" data-occep="${esc(occ.ep)}" data-cerca="${esc(normNome(occ.lungo))}"` : ""} role="group"
          aria-label="${esc(l.nome)}: ${occ ? esc(i ? i.lungo + i.coda : occ.lungo) : "vuoto"}"${edit || occ ? "" : ` title="${esc(l.nome)} — trascina qui un paziente"`}
          style="${celle(l.c, l.r, w, h)}">
          <div class="stbedin">${i ? `<div class="stbedhd">${this.stanzaNome("letto", l)}</div>${this.stanzaChip(m, i, true)}`
            : o ? `<div class="stbedhd">${this.stanzaNome("letto", l)}</div>${this.stanzaOspite(o, true)}`
            : this.stanzaNome("letto", l) + this.stanzaGlifo(sedia ? 24 : l.forma === "barella" ? 14 : 28, "stglifo", sedia, l.forma === "barella")}</div>
          ${edit ? this.stanzaCtl("letto", l) : ""}
        </div>`;
      };
      const area = (a) => {
        const dentro = pazienti.filter((p) => posti[p.ep]?.tipo === "area" && posti[p.ep].id === a.id)
          .sort((x, y) => posti[x.ep].ts - posti[y.ep].ts);   // in ordine di arrivo: chi c'è non si sposta
        const osp = ospiteIn("area", a.id), n = dentro.length + osp.length;   // (chi è al triage dopo i pazienti)
        return `<div class="starea${edit && this._stanzaSel === "area:" + a.id ? " sel" : ""}" data-area="${esc(a.id)}" data-drop="area:${esc(a.id)}" role="group" aria-label="${esc(a.nome)}: ${n} ${n === 1 ? "paziente" : "pazienti"}"${edit ? "" : ` title="${esc(a.nome)} — trascina qui i pazienti"`}
          style="${celle(a.c, a.r, a.w, a.h)}">
          <div class="sthd">${this.stanzaNome("area", a)}${n ? `<span class="stn">${n}</span>` : ""}</div>
          <div class="starbody">${dentro.map(chip).join("")}${osp.map((o) => this.stanzaOspite(o)).join("")}</div>
          ${edit ? this.stanzaCtl("area", a) : ""}
        </div>`;
      };
      // chi non ha un posto sta nella lista, sopra (viewLista)
      return `
        <div class="stmap${edit ? " edit" : ""}" data-mappa="${esc(this.mappa().k)}" role="region" aria-label="Mappa ${esc(NOME_VISTA[this.mappa().vista] || "")}">
          <div class="stcanvas">
            <div class="stplan" style="--cols:${cols};--rows:${rows}">${sala.letti.map(letto).join("")}${sala.aree.map(area).join("")}</div>
            ${sala.letti.length + sala.aree.length ? "" : edit
              ? `<div class="stvuota"><b>Comincia con + Letto, in alto a destra</b></div>`
              : `<div class="stvuota"><b>La stanza è vuota</b><button type="button" class="stbtn" id="stdisegna">Disegna la stanza</button><button type="button" class="stlink" id="stpianta" title="${esc(this.mappa().rimette)}">o riprendi la pianta ${esc(this.mappa().nome)}</button></div>`}
          </div>
        </div>`;
    }
    // «Annulla» per 8 secondi dopo ogni cosa che si può rimpiangere
    stanzaSnack() {
      const a = this._stanzaAnn;
      if (!a || Date.now() > a.fino) return "";
      return `<div class="stsnack" role="status"><span>${esc(a.testo)}</span><button type="button" class="stannulla" title="Rimetti com'era">Annulla</button></div>`;
    }
    bindStanza() {
      const $ = (s) => this.root.querySelector(s);
      this._bordiStanza = null;   // vale solo per la mappa disegnata adesso
      // scrivere una lettera apre il filtro (una volta sola, per tutta la pagina)
      if (!this._filtroLegato) { this._filtroLegato = true; window.addEventListener("keydown", (e) => this.filtroTasto(e), true); }
      if (!this.inPazienti() || this.collapsed) this._filtro = null;   // fuori dai Pazienti (o ridotto) il filtro non resta appeso
      // In Modifica si entra dal menu «⋯», e si esce con Fine (o Esc); il
      // fuoco resta dove si continua.
      const modifica = (si) => () => {
        if (!si) this.stanzaSalvaBozza();
        // si ritocca una mappa sola: quella della vista (con tutt'e due, quella dell'area)
        if (si) { const v = this.vistaTab(); this._mappaEdit = v === "entrambe" ? mappaDiArea(store.get(AREA_ORA, null)?.k) : MAPPA_DI_VISTA[v]; }
        this.cartaChiudi();
        this.stanzaEdit = si; this._stanzaRinomina = null; this._stanzaSel = null; this.menuAperto = false;
        if (si) this._filtro = null;
        this._stanzaFocus = si ? "#stpiuletto" : "#menubtn";
        this.render();
      };
      $("#stmodmenu")?.addEventListener("click", modifica(true));
      $("#stdisegna")?.addEventListener("click", modifica(true));
      // la pianta di partenza: il prossimo disegno la ripropone
      $("#stpianta")?.addEventListener("click", () => { store.del(this.mappa().sala); this.render(); });
      $("#stfine")?.addEventListener("click", modifica(false));
      $("#stpiuletto")?.addEventListener("click", () => this.stanzaAggiungi("letto"));
      $("#stpiusedia")?.addEventListener("click", () => this.stanzaAggiungi("sedia"));
      $("#stpiuarea")?.addEventListener("click", () => this.stanzaAggiungi("area"));
      $(".stannulla")?.addEventListener("click", () => this.stanzaAnnulla());
      // la lista: ▾ apre «Sposta in…»; la ✕ archivia (e si annulla)
      this.root.querySelectorAll("[data-posto]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); this.stanzaMenu(b.getAttribute("data-posto"), b); }));
      this.root.querySelectorAll("[data-parch]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); this.stanzaArchivia(b.getAttribute("data-parch")); }));
      // il titolo di un'area: la sua lista, nel gestionale
      this.root.querySelectorAll("[data-sez]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); apriArea(b.getAttribute("data-sez")); }));
      // il filtro: si scrive, la lista si stringe e la stanza spegne gli altri,
      // senza ridisegnare; Esc (o ✕) lo toglie, Invio apre l'unico che torna
      const cerca = $("#pzcerca");
      if (cerca) {
        if (this._filtroFuoco) {
          const [a, z] = this._filtroSel || [cerca.value.length, cerca.value.length];
          cerca.focus({ preventScroll: true });
          cerca.setSelectionRange(a, z);
          this._filtroFuoco = false; this._filtroSel = null;
        }
        cerca.addEventListener("input", () => { this._filtro = cerca.value; this.filtroApplica(); });
        cerca.addEventListener("keydown", (e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.filtroChiudi(); }
          else if (e.key === "Enter") { e.preventDefault(); const ep = this.filtroUnico(); if (ep) this.apriPaziente(ep, "esiti"); }
        });
      }
      $("#pzcercax")?.addEventListener("click", () => this.filtroChiudi());
      // la lente accanto a ⟳: apre lo stesso filtro (che si apre anche scrivendo e basta)
      $("#tbcerca")?.addEventListener("click", () => {
        if (this._filtro != null) return this.root.querySelector("#pzcerca")?.focus();
        this._filtro = ""; this._filtroFuoco = true; this._filtroSel = null;
        this.render();
      });
      this.filtroApplica();
      this.tdLega();
      // Alta | Bassa | Entrambe, e ⟳: la lista smart adesso
      this.root.querySelectorAll("[data-vista]").forEach((b) => b.addEventListener("click", () => this.sceglieVista(b.getAttribute("data-vista"))));
      this.root.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => this.sceglieModo(b.getAttribute("data-modo"))));
      // (il ⟳ gira finché la lettura è in corso: al massimo 45 secondi)
      const giro = store.get(SMART_SYNC, null);
      if ($("#tbsync.gira") && giro?.ts) setTimeout(() => this.root.querySelector("#tbsync")?.classList.remove("gira"), Math.max(0, giro.ts + 45e3 - Date.now()));
      $("#tbsync")?.addEventListener("click", async (e) => {
        const b = e.currentTarget;
        b.classList.add("gira");
        const r = await smartSync(true);
        const n = rileggiAperti(this.pazModello()) || Number(r?.dietro) || 0;   // (nel tabellone in una scheda sua lo fa la scheda del gestionale, e lo dice)
        const dietro = n ? `rileggo dietro ${n === 1 ? "il paziente aperto" : `i ${n} pazienti aperti`} in questo turno, uno alla volta` : "";
        if (r && r.ok) { if (dietro) { this.message = { ok: dietro[0].toUpperCase() + dietro.slice(1) }; this.render(); } return; }
        b.classList.remove("gira");
        const perche = { "nessun link": "La lista smart non si è ancora vista: aprila una volta dalla lista dell'area", "in corso": "La lista smart si sta già rileggendo",
          "ordine in corso": "La lista smart dopo l'ordine: un ordine sta mandando esami", "carrello aperto": "La lista smart dopo: c'è un carrello aperto in una scheda del gestionale" }[r?.why];
        this.message = [perche || `Lista smart non riletta${r?.why ? `: ${r.why}` : ""}`, dietro].filter(Boolean).join(" · ");
        this.render();
      });
      const box = $(".pzunita"), map = $(".stmap");
      if (box && (map || box.classList.contains("lista"))) {
        box.addEventListener("pointerdown", (e) => this.stanzaPresa(e, box));
        // la scheda del paziente: passando sul nome (nella riga) o sul letto
        this.cartaLega(box);
        // una riga portata via (o tenuta premuta col dito) non è anche un tocco che apre
        box.addEventListener("click", (e) => { if (this._rigaMossa && e.detail) { this._rigaMossa = false; e.preventDefault(); e.stopPropagation(); } }, true);
        box.querySelectorAll(".stmap").forEach((mp) => mp.addEventListener("click", (e) => {
          const del = e.target.closest("[data-stdel]");
          if (del) { const [tipo, id] = del.getAttribute("data-stdel").split(":"); this.stanzaElimina(tipo, id); }
        }));
        // da tastiera: Invio apre il paziente (o rinomina, in Modifica); Maiusc+F10 o il tasto menu: Sposta in…
        box.addEventListener("keydown", (e) => {
          const riga = e.target.closest?.(".pzapri")?.closest(".pzrow[data-riga]");
          const chip = e.target.closest?.(".stp[data-stp]:not(.ospite)"), nome = e.target.closest?.("[data-stnome]");
          const menu = e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
          if (riga && menu) { e.preventDefault(); this.stanzaMenu(riga.getAttribute("data-riga"), riga.querySelector("[data-posto]") || riga); }
          else if (chip && !this.stanzaEdit && menu) {
            e.preventDefault();
            if (!chip.classList.contains("prec")) this.stanzaMenu(chip.getAttribute("data-stp"), chip);
          } else if (e.key === "Enter" || e.key === " ") {
            if (chip && !this.stanzaEdit) { e.preventDefault(); this.apriPaziente(chip.getAttribute("data-stp"), "esiti"); }
            else if (nome) { e.preventDefault(); this.stanzaRinomina(nome); }
          }
        });
        box.addEventListener("contextmenu", (e) => {
          if (this.stanzaEdit || e.target.closest("input")) return;
          const riga = e.target.closest(".pzrow[data-riga]");
          if (riga) { e.preventDefault(); return this.stanzaMenu(riga.getAttribute("data-riga"), riga.querySelector("[data-posto]") || riga); }
          const chip = e.target.closest(".stp[data-stp]") || e.target.closest(".stbed.occ")?.querySelector(".stp[data-stp]");
          if (!chip || chip.classList.contains("ospite")) return;
          e.preventDefault();
          if (!chip.classList.contains("prec")) this.stanzaMenu(chip.getAttribute("data-stp"), chip);
        });
        // (le mappe stanno sempre nel loro spazio, in scala: niente da scorrere di lato)
        const inp = box.querySelector(".stmap .stnomein");
        if (inp) {
          inp.focus();
          if (this._stanzaRinomina?.seleziona) { inp.select(); this._stanzaRinomina.seleziona = false; }
          else inp.setSelectionRange(inp.value.length, inp.value.length);
          inp.addEventListener("input", () => { if (this._stanzaRinomina) this._stanzaRinomina.testo = inp.value; });
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); this.stanzaChiudiNome(inp, true, true); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.stanzaChiudiNome(inp, false, true); }
          });
          inp.addEventListener("blur", () => { if (inp.isConnected && !this._staccando) this.stanzaChiudiNome(inp, true); });
        }
      }
      if (this._stanzaFocus) { const f = $(this._stanzaFocus); this._stanzaFocus = null; f?.focus(); }
    }
    // Il filtro. Una lettera scritta con i Pazienti davanti — e il cursore
    // fuori da un campo, del pannello o del gestionale — lo apre con quella
    // lettera: la lista si stringe ai nomi che tornano, nella stanza gli altri
    // si spengono. Esc (o ✕) lo toglie.
    filtroTasto(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const esc = e.key === "Escape";
      if (!esc && !/^\p{L}$/u.test(e.key || "")) return;
      if (this.collapsed || this.stanzaEdit || this.menuAperto || this._stanzaPresa || this._stanzaMenu?.menu?.isConnected || this._promMenu?.menu?.isConnected
          || this._df || !this.root.querySelector(".pzunita")) return;
      const via = e.composedPath ? e.composedPath() : [], t = via[0];
      // dal pannello, o da nessuna parte (la finestra copre la pagina): mai da un elemento del gestionale
      if (!via.includes(this.host) && t && t !== document.body && t !== document.documentElement && t !== document) return;
      const campo = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "") || t.isContentEditable);
      // Esc col filtro aperto lo toglie, prima di ridurre la finestra (vedi escLocale);
      // dal campo di un promemoria, l'Esc è del campo
      if (esc) {
        if (this._filtro == null || (campo && t.id !== "pzcerca")) return;
        e.preventDefault(); e.stopPropagation();
        return this.filtroChiudi();
      }
      if (campo) return;
      e.preventDefault();
      this._filtro = (this._filtro || "") + e.key;
      this._filtroFuoco = true; this._filtroSel = null;
      this.render();
    }
    filtroChiudi() {
      this._filtro = null;
      this.render();
      this.root.querySelector(".card")?.focus({ preventScroll: true });
    }
    // sul posto, senza ridisegnare: le righe che non tornano si nascondono, i
    // pazienti della stanza che non tornano si spengono
    filtroApplica() {
      const box = this.root.querySelector(".pzunita");
      if (!box) return;
      const q = this.stanzaEdit ? "" : normNome(this._filtro || "");
      box.classList.toggle("filtra", !!q);
      let righe = 0, viste = 0;
      for (const el of box.querySelectorAll("[data-cerca]")) {
        const si = !q || el.getAttribute("data-cerca").includes(q);
        el.classList.toggle("nofiltro", !si);
        if (el.classList.contains("pzrow")) { righe++; viste += si; }
      }
      const nessuno = box.querySelector(".pzfnone");
      if (nessuno) {
        nessuno.hidden = !(q && righe && !viste);
        nessuno.textContent = `Nessuno in lista con «${(this._filtro || "").trim()}»`;
      }
    }
    // Invio nel filtro apre il paziente solo se ne torna uno: mai a caso
    filtroUnico() {
      const box = this.root.querySelector(".pzunita");
      if (!box || !normNome(this._filtro || "")) return "";
      const eps = new Set([...box.querySelectorAll(".pzrow[data-cerca]:not(.nofiltro) .pzapri[data-ep], .stp[data-cerca]:not(.nofiltro)")]
        .map((el) => el.getAttribute("data-ep") || el.getAttribute("data-stp")));
      return eps.size === 1 ? [...eps][0] : "";
    }
    // Esc appartiene a chi lo sta usando: il menu «Sposta in…» o un trascinamento
    // (il gestore di Esc della finestra lo chiede prima di ridurre il pannello)
    escLocale() {
      return !!(this._stanzaPresa || this._stanzaMenu?.menu?.isConnected || this._promMenu?.menu?.isConnected || this._df?.pop?.isConnected || this._dfPresa
        || (this._filtro != null && !this.collapsed && !this.stanzaEdit && !!this.root.querySelector("#pzcerca")));   // il filtro: lo toglie filtroTasto
    }
    // Un solo gesto alla volta. Tocco o trascinamento? Sotto i 5px col mouse
    // (10 col dito) è un tocco, per quanto duri; oltre la soglia, un
    // trascinamento. Tenere premuto col dito (mezzo secondo): «Sposta in…».
    // Esc o un annullo del browser lasciano tutto com'era.
    stanzaGesto(e, { inizia, muovi, lascia, tocco, lungo, annulla }) {
      const id = e.pointerId, sx = e.clientX, sy = e.clientY;
      const soglia = e.pointerType === "mouse" ? 5 : 10;
      let mosso = false, partito = false;
      const via = () => {
        clearTimeout(tl);
        window.removeEventListener("pointermove", mm, true);
        window.removeEventListener("pointerup", su, true);
        window.removeEventListener("pointercancel", nulla, true);
        window.removeEventListener("keydown", kd, true);
        this._stanzaPresa = false;
      };
      const nulla = () => { via(); if (partito) annulla?.(); };
      const mm = (ev) => {
        if (ev.pointerId !== id) return;
        if (ev.pointerType === "mouse" && !ev.buttons) return nulla();   // bottone mollato fuori dalla finestra
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!mosso) {
          if (Math.hypot(dx, dy) < soglia) return;
          mosso = true;
          clearTimeout(tl);
          if (inizia) { partito = true; inizia(); }
        }
        if (partito) muovi(dx, dy, ev);
      };
      const su = (ev) => {
        if (ev.pointerId !== id) return;
        via();
        if (partito) lascia(ev);
        else if (!mosso) tocco?.();
      };
      const kd = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); nulla(); } };
      const tl = lungo && e.pointerType !== "mouse" ? setTimeout(() => { if (!partito) { via(); lungo(); } }, 500) : 0;
      this._stanzaPresa = true;
      window.addEventListener("pointermove", mm, true);
      window.addEventListener("pointerup", su, true);
      window.addEventListener("pointercancel", nulla, true);
      window.addEventListener("keydown", kd, true);
    }
    stanzaPresa(e, box) {
      if (e.button !== 0 || this._stanzaPresa) return;
      this._rigaMossa = false;
      // una riga della lista si prende dal nome (cioè da tutta la riga): gli
      // altri suoi comandi restano i loro, e un tocco la apre come sempre
      const riga = !this.stanzaEdit && this.modoTab() !== "lista" && e.target.closest(".pzrow[data-riga]");   // (in Lista non c'è dove portarlo)
      if (riga) return e.target.closest("button:not(.pzapri), input") ? undefined : this.stanzaTrascinaPaziente(e, box, riga, true);
      if (e.target.closest("button, input, .stsnack, .pzrow, .pzfiltro, .pzpiede")) return;
      const map = box.querySelector(".stmap");
      if (!this.stanzaEdit) {
        // un letto occupato si prende tutto: è il suo paziente che si porta
        const chip = e.target.closest(".stp[data-stp]") || e.target.closest(".stbed.occ")?.querySelector(".stp[data-stp]");
        if (!chip) return;
        const ep = chip.getAttribute("data-stp");
        // l'episodio precedente non va nella stanza: un tocco lo apre, e basta
        if (chip.classList.contains("prec")) return this.stanzaGesto(e, { tocco: () => this.apriPaziente(ep, "esiti") });
        return this.stanzaTrascinaPaziente(e, box, chip, false);
      }
      const obj = e.target.closest("[data-letto], [data-area]");
      this.stanzaSeleziona(obj, map);
      if (obj) this.stanzaTrascinaOggetto(e, map, obj, !!e.target.closest("[data-strsz]"), e.target.closest("[data-stnome]"));
    }
    // in Modifica, l'oggetto toccato per ultimo mostra i suoi comandi
    stanzaSeleziona(obj, map) {
      const k = !obj ? null : obj.hasAttribute("data-letto") ? "letto:" + obj.getAttribute("data-letto") : "area:" + obj.getAttribute("data-area");
      if (k === this._stanzaSel) return;
      this._stanzaSel = k;
      map.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
      obj?.classList.add("sel");
    }
    // il bersaglio sotto il puntatore: un letto, un'area o la lista
    stanzaBersaglio(x, y) {
      for (const el of this.root.elementsFromPoint(x, y)) {
        const d = el.closest?.(".pzunita [data-drop]");
        if (d) return d;
      }
      return null;
    }
    // Il paziente si porta col suo nome accanto al puntatore (in basso a
    // destra, o dall'altra parte se lì non c'è posto): non copre mai il nome
    // del letto che si mira. Il posto si scrive solo quando lo si lascia.
    // Sopra un letto occupato si legge chi torna in lista. Preso dalla
    // stanza, in cima compare «Rimetti in lista» — anche a lista vuota: il
    // letto torna vuoto. Preso dalla lista (daLista: la sua riga), va solo
    // nella stanza.
    stanzaTrascinaPaziente(e, box, chip, daLista) {
      const ep = chip.getAttribute(daLista ? "data-riga" : "data-stp"), ospite = !daLista && chip.hasAttribute("data-ospite");
      let copia = null, sopra = null;
      const bersaglio = (x, y) => { const t = this.stanzaBersaglio(x, y); return daLista && t?.getAttribute("data-drop") === "tray" ? null : t; };
      const segna = (el) => {
        if (el === sopra) return;
        if (sopra) { sopra.classList.remove("over"); sopra.querySelector(".stfuori")?.remove(); }
        sopra = el;
        if (!el) return;
        el.classList.add("over");
        const altro = el.getAttribute("data-occep");
        if (!altro || altro === ep) return;
        el.insertAdjacentHTML("beforeend", `<span class="stfuori">${esc(el.getAttribute("data-occ") || "")} → senza posto</span>`);
        // tutta dentro la mappa: se sporge da un lato, si sposta verso l'altro
        const lab = el.lastElementChild, cv = (el.closest(".stcanvas") || box).getBoundingClientRect(), lr = lab.getBoundingClientRect();
        const dx = Math.max(0, cv.left + 4 - lr.left) - Math.max(0, lr.right - cv.right + 4);
        if (dx) lab.style.marginLeft = dx + "px";
      };
      const pulisci = () => { segna(null); copia?.remove(); chip.classList.remove("via"); box.classList.remove("trascino", "dastanza"); };
      // la copia resta dentro i Pazienti: fuori non si lascia niente
      const metti = (ev) => {
        const mr = box.getBoundingClientRect(), w = copia.offsetWidth, h = copia.offsetHeight;
        let x = ev.clientX - mr.left + 12, y = ev.clientY - mr.top + 12;
        if (x + w > mr.width) x = ev.clientX - mr.left - 12 - w;
        if (y + h > mr.height) y = ev.clientY - mr.top - 12 - h;
        copia.style.transform = `translate(${Math.max(0, x)}px,${Math.max(0, y)}px)`;
      };
      this.stanzaGesto(e, {
        inizia: () => {
          const i = this.pazModello().info.get(ep);
          copia = document.createElement("div");
          copia.className = "stghost";
          copia.setAttribute("aria-hidden", "true");
          copia.textContent = i ? i.breve + i.coda : chip.querySelector(".stpn, .pznm")?.textContent || "";
          box.appendChild(copia);
          chip.classList.add("via");
          box.classList.add("trascino");
          if (daLista) this._rigaMossa = true;   // il clic che segue non apre il paziente
          else box.classList.add("dastanza");
        },
        muovi: (dx, dy, ev) => {
          metti(ev);
          segna(bersaglio(ev.clientX, ev.clientY));
        },
        lascia: (ev) => {
          const t = bersaglio(ev.clientX, ev.clientY);
          pulisci();
          if (t) { const k = t.closest(".stmap")?.getAttribute("data-mappa"); this.stanzaSposta(ep, t.getAttribute("data-drop") + (k ? "@" + k : "")); }
        },
        // la riga si apre col suo clic (anche da tastiera); il paziente nella stanza qui
        // (chi è al triage non ha una pagina nostra: si trascina e basta)
        tocco: daLista || ospite ? null : () => this.apriPaziente(ep, "esiti"),
        lungo: ospite ? null : () => {
          if (daLista) this._rigaMossa = true;
          this.stanzaMenu(ep, daLista ? chip.querySelector("[data-posto]") || chip : chip);
        },
        annulla: pulisci,
      });
    }
    // Portare un paziente: sullo stesso posto non succede niente; su un letto
    // occupato il nuovo prende il letto e chi c'era torna in lista — niente
    // scambi, che spostano qualcuno dove non l'hai deciso tu. Si annulla.
    // `dove`: «letto:id», «area:id» o «tray», con «@mappa» quando le mappe sono
    // due. Un paziente ha un posto solo: messo in una mappa, lascia l'altra.
    stanzaSposta(ep, dove) {
      const [luogo, mk] = String(dove || "").split("@");
      const [tipo, id] = luogo.split(":");
      const k = MAPPE[mk] ? mk : this.mappa().k;
      if (!["tray", "area", "letto"].includes(tipo)) return;
      const T = this.pazTabellone(), m = T.per.get(k) || this.conMappa(k, () => this.pazModello());
      // chi è al triage: il posto di partenza (la Sala attesa) non è scritto — scritto è solo quello che gli dai tu
      const o = m.info.get(ep) ? null : triageOspiti(m.pazienti).find((r) => r.k === ep);
      const po = o ? postoOspite(ep, (kk) => this.conMappa(kk, () => this.stanzaSala())) : null;
      const j = o ? { posto: po && (po.ts || tipo !== "tray") ? po : null, mk: po?.k } : T.lista.info.get(ep), i = o ? { breve: o.breve || o.nome, coda: "" } : m.info.get(ep);
      if (!i || !j || i.prec) return;
      const da = j.posto, daQui = da && j.mk === k;
      if (tipo === "tray" ? !da : daQui && da.tipo === tipo && da.id === id) return;   // è già lì
      const foto = this.stanzaFoto("posti"), nm = (x) => x.breve + x.coda;
      const nomeDi = (t, x) => (t === "letto" ? m.sala.letti : m.sala.aree).find((o) => o.id === x)?.nome || "";
      let testo = tipo === "tray" ? `${nm(i)} ${o ? "di nuovo in Sala attesa" : "senza posto"}` : `${nm(i)} in ${nomeDi(tipo, id)}`;
      const tutti = {};
      for (const kk of Object.keys(MAPPE)) {
        const raw = store.get(MAPPE[kk].posti, {});
        tutti[kk] = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
        if (kk !== k || tipo === "tray") delete tutti[kk][ep];
      }
      const posti = tutti[k];
      if (tipo !== "tray") posti[ep] = { tipo, id, ts: Date.now() };
      if (tipo === "letto") {
        // chiunque altro reclami quel letto (anche chi ora non è in elenco) lo lascia
        for (const [x, v] of Object.entries(posti)) if (x !== ep && v?.tipo === "letto" && v.id === id) delete posti[x];
        const altro = m.perLetto[id];
        if (altro && altro !== ep) testo += ` · ${nm(m.info.get(altro))} senza posto`;
      }
      if (!Object.keys(MAPPE).every((kk) => store.set(MAPPE[kk].posti, tutti[kk]))) { this.message = "Il posto NON è stato salvato: la memoria di questo browser è piena o bloccata."; return this.render(); }
      this.stanzaAnnullabile(testo, foto);
      this.render();
    }
    // la fotografia di prima, per «Annulla» (con l'elenco, anche i promemoria)
    stanzaFoto(conPazienti) {
      const mp = this.mappa();
      return { mp, sala: store.get(mp.sala, null), posti: store.get(mp.posti, null), tuttiPosti: conPazienti ? TUTTI_I_POSTI().map((k) => [k, store.get(k, null)]) : undefined,
               // («posti»: solo i posti, in tutte le mappe)
               pazienti: conPazienti === true ? store.get("patients.v1", null) : undefined,
               prom: conPazienti === true ? store.get(PROM, null) : undefined, stato: conPazienti === true ? store.get(STATO, null) : undefined };
    }
    stanzaAnnullabile(testo, foto) {
      clearTimeout(this._stanzaAnnT);
      this._stanzaAnn = { testo, foto, fino: Date.now() + 8000 };
      this._stanzaAnnT = setTimeout(() => { this._stanzaAnn = null; this.root.querySelector(".stsnack")?.remove(); }, 8000);
    }
    stanzaAnnulla() {
      const a = this._stanzaAnn;
      if (!a) return;
      clearTimeout(this._stanzaAnnT);
      this._stanzaAnn = null;
      if (typeof a.foto === "function") a.foto();   // un passo solo da disfare: il promemoria fatto torna
      else {
        store.set(a.foto.mp.sala, a.foto.sala);
        store.set(a.foto.mp.posti, a.foto.posti);
        for (const [k, v] of a.foto.tuttiPosti || []) store.set(k, v);
        if (a.foto.pazienti !== undefined) store.set("patients.v1", a.foto.pazienti);
        if (a.foto.prom !== undefined) store.set(PROM, a.foto.prom);
        if (a.foto.stato !== undefined) store.set(STATO, a.foto.stato);
      }
      this.render();
    }
    // «Sposta in…»: i letti e le sedie vuoti, per nome, poi quelli occupati
    // (chi c'è torna in lista), le aree; per chi ha già un posto «Rimetti in
    // lista»; in fondo, a parte, «Da fare…» e «Togli dall'elenco» (come
    // l'icona e la ✕ della riga, che chi sta nella stanza non ha più). Col
    // tasto destro, tenendo premuto col dito, con Maiusc+F10 o dal ▾ della
    // riga. Frecce, Invio, Esc.
    stanzaMenu(ep, anchor) {
      const aperto = this._stanzaMenu;
      if (aperto && aperto.ep === ep && aperto.menu.isConnected) return;
      this.stanzaChiudiMenu();
      const T = this.pazTabellone(), i = T.lista.info.get(ep), wrap = this.root.querySelector(".wrap");
      if (!i || i.prec || !wrap || !anchor?.isConnected) return;
      const qui = i.posto, due = T.ks.length > 1;
      const voce = (dove, testo, det, cur) => `<button type="button" role="menuitem" class="stmi${cur ? " cur" : ""}" data-dove="${esc(dove)}"${cur ? ' aria-disabled="true"' : ""}><span>${esc(testo)}</span><small>${esc(cur ? "qui ora" : det)}</small></button>`;
      const sezioni = [];
      // una mappa dopo l'altra (con due mappe, ognuna col suo nome)
      for (const k of T.ks) {
        const m = T.per.get(k), suf = due ? "@" + k : "";
        const attuale = (tipo, id) => !!qui && i.mk === k && qui.tipo === tipo && qui.id === id;
        const inArea = (a) => Object.values(m.posti).filter((v) => v.tipo === "area" && v.id === a.id).length;
        const letti = [...m.sala.letti].sort((a, b) => a.nome.localeCompare(b.nome, "it", { numeric: true }));
        const gruppi = [
          letti.filter((l) => !m.perLetto[l.id]).map((l) => voce("letto:" + l.id + suf, l.nome, "vuoto")),
          letti.filter((l) => m.perLetto[l.id]).map((l) => {
            const o = m.info.get(m.perLetto[l.id]);
            return voce("letto:" + l.id + suf, l.nome, "al posto di " + o.breve + o.coda, attuale("letto", l.id));
          }),
          m.sala.aree.map((a) => voce("area:" + a.id + suf, a.nome, inArea(a) ? `${inArea(a)} ${inArea(a) === 1 ? "paziente" : "pazienti"}` : "", attuale("area", a.id))),
        ].filter((g) => g.length);
        if (gruppi.length) sezioni.push((due ? `<div class="stmenuhd stmenumap" aria-hidden="true">${esc(NOME_VISTA[MAPPE[k].vista])}</div>` : "")
          + gruppi.map((g) => g.join("")).join('<div class="stmsep" role="separator"></div>'));
      }
      const df = T.lista.df;
      const coda = [qui ? [voce("tray", "Togli dal posto", "")] : [],
        [voce("dafare", "Da fare…", dfAperte(ep, df).length ? String(dfAperte(ep, df).length) : ""), voce("togli", "Togli dall'elenco", "")],
        hasExt() && !TABELLONE && this.pins && !this._pinSenza ? [this.pinDi(ep) ? voce("pinvia", "Togli da Da rivedere", "📌") : voce("pin", "Aggiungi a Da rivedere…", "📌")] : []].filter((g) => g.length);
      const titolo = `Sposta ${i.breve + i.coda} in…`;
      wrap.insertAdjacentHTML("beforeend", `<div class="stmenu" role="menu" aria-label="${esc(titolo)}"><div class="stmenuhd" aria-hidden="true">${esc(titolo)}</div>${
        [...sezioni, ...coda.map((g) => g.join(""))].join('<div class="stmsep" role="separator"></div>')}</div>`);
      const menu = wrap.lastElementChild;
      // sotto chi l'ha aperto; se non c'è posto sotto, sopra; sempre dentro lo schermo
      const wr = wrap.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      let y = ar.bottom + 4;
      if (y + menu.offsetHeight > innerHeight - 8) y = Math.max(8, ar.top - 4 - menu.offsetHeight);
      menu.style.left = Math.max(8, Math.min(ar.left, innerWidth - menu.offsetWidth - 8)) - wr.left + "px";
      menu.style.top = y - wr.top + "px";
      const voci = () => [...menu.querySelectorAll(".stmi:not([aria-disabled])")];
      menu.addEventListener("click", (e) => {
        const b = e.target.closest(".stmi");
        if (!b || b.hasAttribute("aria-disabled")) return;
        const dove = b.getAttribute("data-dove");
        // (il menu resta, col «Salvo…», finché il ponte risponde)
        if (dove === "pinvia") return void this.pinTogli(this.pinDi(ep), b);
        this.stanzaChiudiMenu();
        if (dove === "togli") return this.stanzaArchivia(ep);
        if (dove === "pin") return void this.pinMetti(ep, anchor);
        // «Da fare…»: la lista sotto la sua icona (nella riga, o nel letto), o sotto il paziente
        if (dove === "dafare") return this.dfApri(ep, this.dfAncora(ep) || anchor);
        // il fuoco segue il paziente: nel posto nuovo, o sulla sua riga
        this._stanzaFocus = dove === "tray" ? `.pzrow[data-riga="${CSS.escape(ep)}"] .pzapri` : `.stmap[data-mappa="${CSS.escape(dove.split("@")[1] || this.mappa().k)}"] .stp[data-stp="${CSS.escape(ep)}"]`;
        this.stanzaSposta(ep, dove);
      });
      menu.addEventListener("keydown", (e) => {
        const l = voci(), k = l.indexOf(this.root.activeElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); l[(k + (e.key === "ArrowDown" ? 1 : l.length - 1)) % l.length]?.focus(); }
        else if (e.key === "Home" || e.key === "End") { e.preventDefault(); l[e.key === "Home" ? 0 : l.length - 1]?.focus(); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.stanzaChiudiMenu(true); }
        else if (e.key === "Tab") this.stanzaChiudiMenu();
      });
      const fuori = (e) => { if (!e.composedPath().includes(menu)) this.stanzaChiudiMenu(); };
      window.addEventListener("pointerdown", fuori, true);
      this._stanzaMenu = { menu, anchor, ep, fuori };
      voci()[0]?.focus();
    }
    stanzaChiudiMenu(ritorna) {
      const a = this._stanzaMenu;
      if (!a) return;
      this._stanzaMenu = null;
      window.removeEventListener("pointerdown", a.fuori, true);
      a.menu.remove();
      if (ritorna && a.anchor?.isConnected) a.anchor.focus();
    }
    // ---- i pin «Da rivedere» (appunti-sw.js): tasto destro su un paziente, e ⋯ → Da rivedere (N)
    pinCarica(forza = false) {
      if (!hasExt() || TABELLONE) return;
      // la copia dei pin sul PC cambia (un pin da un'altra scheda, la chiave arrivata dall'iPhone): qui la si segue
      if (!this._pinAscolto && chrome.storage?.onChanged) {
        this._pinAscolto = true;
        chrome.storage.onChanged.addListener((c, area) => {
          if (area !== "local" || !c["appunti.copia"]) return;
          this.pins = c["appunti.copia"].newValue?.pin || {};
          this._pinSenza = false;
          if (this._stanzaMenu?.ep === "pin") { this.stanzaChiudiMenu(); this.render(); this.pinMenu(this.root.querySelector("#menubtn"), "", false); }
          else if (!this.root.activeElement) this.render();
        });
      }
      const prima = JSON.stringify(this.pins || {});   // (prima della domanda: la copia può cambiare intanto, appunti.copia)
      ask({ t: "appunti", azione: "leggi", forza }).then((r) => {
        if (!r || !r.pin) return;
        this.pins = r.pin;
        this._pinSenza = !!r.senza;
        if (JSON.stringify(r.pin) === prima) return;
        // (il riquadro «Da rivedere» aperto si rifà con i pin riletti)
        const aperto = this._stanzaMenu?.ep === "pin";
        if (aperto) { this.stanzaChiudiMenu(); this.render(); this.pinMenu(this.root.querySelector("#menubtn"), "", false); }
        else if (!this.root.activeElement) this.render();
      }).catch(() => {});
    }
    pinDi(ep) {
      const p = knownPatients().find((x) => x.ep === ep);
      if (!p || !this.pins) return "";
      const d = pinDati(p);
      return Object.keys(this.pins).find((k) => { const x = this.pins[k]; return (d.cf && x.cf === d.cf) || (d.url && x.url === d.url) || (!d.cf && !x.cf && x.ep === ep && normNome(x.paziente) === normNome(d.paziente)); }) || "";
    }
    // «Aggiungi a Da rivedere…»: la nota in un riquadro del pannello, accanto al
    // paziente (mai il prompt del browser, che blocca la pagina), al più 500
    // caratteri. «Salva» dice «Salvo…» finché il ponte risponde (10 secondi al
    // più: appunti-sw.js). Esc o un clic fuori: niente salvato.
    pinMetti(ep, anchor = null) {
      const p = knownPatients().find((x) => x.ep === ep), wrap = this.root.querySelector(".wrap");
      if (!p || !wrap) return;
      this.stanzaChiudiMenu();
      const k = this.pinDi(ep), prima = k ? this.pins[k].nota || "" : "";
      wrap.insertAdjacentHTML("beforeend", `<div class="stmenu pinmenu" role="dialog" aria-label="Aggiungi a Da rivedere"><div class="stmenuhd">📌 ${
        k ? "Da rivedere" : "Aggiungi a Da rivedere"}: ${esc(p.name)}</div><textarea class="pintesto" maxlength="${PIN_NOTA_MAX}" rows="3" placeholder="Una nota (facoltativa)" aria-label="Nota, al più ${PIN_NOTA_MAX} caratteri">${
        esc(prima)}</textarea><div class="pinaz"><button type="button" class="stmi" data-pinsalva="1">Salva</button><button type="button" class="stmi" data-pinannulla="1">Annulla</button></div></div>`);
      const menu = wrap.lastElementChild, ta = menu.querySelector("textarea"), wr = wrap.getBoundingClientRect(), ar = (anchor?.isConnected ? anchor : wrap).getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(ar.left, innerWidth - menu.offsetWidth - 8)) - wr.left + "px";
      menu.style.top = Math.max(8, Math.min(ar.bottom + 4, innerHeight - menu.offsetHeight - 8)) - wr.top + "px";
      const salva = async () => {
        const b = menu.querySelector("[data-pinsalva]");
        if (b.hasAttribute("aria-disabled")) return;
        b.setAttribute("aria-disabled", "true"); b.textContent = "Salvo…"; ta.readOnly = true;
        const r = await ask({ t: "appunti", azione: "aggiungi", pin: { ...pinDati(p), nota: ta.value.slice(0, PIN_NOTA_MAX), quando: Date.now() } });
        if (this._stanzaMenu?.menu === menu) this.stanzaChiudiMenu();
        if (r && r.pin) this.pins = r.pin;
        if (r && r.ok) this.log(`${now()}  pin aggiunto`);
        else this.segnala({ tag: "Da rivedere", tono: "warn", testo: (r && r.errore) || "Non salvato" }, { ms: 6000 });
        this.render();
      };
      menu.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        e.stopPropagation();
        if (b.dataset.pinsalva) salva();
        else if (b.dataset.pinannulla) this.stanzaChiudiMenu(true);
      });
      menu.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.stanzaChiudiMenu(true); }
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salva(); }
      });
      const fuori = (e) => { if (!e.composedPath().includes(menu)) this.stanzaChiudiMenu(); };
      window.addEventListener("pointerdown", fuori, true);
      this._stanzaMenu = { menu, anchor, ep: "pinnota", fuori };
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    // «Togli»: il bottone toccato dice «Salvo…» finché il ponte risponde, poi il riquadro si chiude
    async pinTogli(k, bottone = null) {
      const menu = bottone && this._stanzaMenu?.menu?.contains(bottone) ? this._stanzaMenu.menu : null;
      if (bottone) {
        if (bottone.hasAttribute("aria-disabled")) return;
        bottone.setAttribute("aria-disabled", "true");
        (bottone.querySelector("span") || bottone).textContent = "Salvo…";
        bottone.querySelector("small")?.remove();
      }
      const r = await ask({ t: "appunti", azione: "togli", k });
      if (menu && this._stanzaMenu?.menu === menu) this.stanzaChiudiMenu();
      if (r && r.pin) this.pins = r.pin;
      if (r && r.ok) this.log(`${now()}  pin tolto`);
      else this.segnala({ tag: "Da rivedere", tono: "warn", testo: (r && r.errore) || "Non tolto" }, { ms: 6000 });
      this.render();
    }
    pinN() { return Object.keys(this.pins || {}).length; }
    pinTesto(x) {
      const d = new Date(x.quando || 0), q = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      return [x.paziente || [x.cognome, x.nome].join(" "), x.nascita ? `nato/a ${x.nascita}` : "", `dal ${q}`].filter(Boolean).join(" · ");
    }
    // il riquadro di ⋯ → Da rivedere: uno per riga, con la nota, «Apri» e «Togli»; in fondo «Elimina tutti i pin»
    pinMenu(anchor, evid = "", rileggi = true) {
      this.stanzaChiudiMenu();
      const wrap = this.root.querySelector(".wrap");
      if (!wrap) return;
      const l = Object.entries(this.pins || {}).sort(([, a], [, b]) => (b.quando || 0) - (a.quando || 0));
      const riga = ([k, x]) => `<div class="pinr${k === evid ? " evid" : ""}" data-pink="${esc(k)}"><div class="pinchi">${esc(this.pinTesto(x))}</div>${
        x.nota ? `<div class="pinnota">${esc(x.nota)}</div>` : ""}<div class="pinaz"><button type="button" class="stmi" data-pinapri="${esc(k)}">Apri</button><button type="button" class="stmi" data-pintogli="${esc(k)}">Togli</button></div></div>`;
      wrap.insertAdjacentHTML("beforeend", `<div class="stmenu pinmenu" role="dialog" aria-label="Da rivedere"><div class="stmenuhd">📌 Da rivedere (${l.length})</div>${
        l.length ? l.map(riga).join("") : `<div class="pinnota">Nessun paziente da rivedere. Tasto destro su un paziente: «Aggiungi a Da rivedere…».</div>`}${
        l.length ? `<div class="stmsep" role="separator"></div><button type="button" class="stmi" data-pinvia="1" title="Toglie tutti i pazienti da rivedere, anche dall'iPhone">Elimina tutti…</button>` : ""}</div>`);
      const menu = wrap.lastElementChild, wr = wrap.getBoundingClientRect(), ar = (anchor?.isConnected ? anchor : wrap).getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(ar.left, innerWidth - menu.offsetWidth - 8)) - wr.left + "px";
      menu.style.top = Math.max(8, Math.min(ar.bottom + 4, innerHeight - menu.offsetHeight - 8)) - wr.top + "px";
      menu.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        e.stopPropagation();
        if (b.dataset.pintogli) this.pinTogli(b.dataset.pintogli, b);
        else if (b.dataset.pinapri) { this.stanzaChiudiMenu(); this.pinApri(b.dataset.pinapri); }
        else if (b.dataset.pinvia) {
          const armato = () => { const a = this.armatoDi("pinvia"); b.textContent = a ? "Elimino tutti, anche dall'iPhone? Tocca di nuovo" : "Elimina tutti…"; b.classList.toggle("armato", a); };
          if (!this.dueTocchi("pinvia", armato)) return;
          this.stanzaChiudiMenu();
          ask({ t: "appunti", azione: "elimina" }).then((r) => {
            if (r && r.ok) { this.pins = {}; this.log(`${now()}  pin eliminati tutti`); }
            else this.segnala({ tag: "Da rivedere", tono: "warn", testo: (r && r.errore) || "Niente eliminato" }, { ms: 6000 });
            this.render();
          });
        }
      });
      const fuori = (e) => { if (!e.composedPath().includes(menu)) this.stanzaChiudiMenu(); };
      window.addEventListener("pointerdown", fuori, true);
      this._stanzaMenu = { menu, anchor, ep: "pin", fuori };
      menu.querySelector("button")?.focus();
      if (rileggi) this.pinCarica(true);   // (riletto dal ponte: dall'iPhone potrebbe esserne arrivato uno, o andato via)
    }
    // «Apri»: il paziente che il PC conosce adesso, come sempre; se no, la pagina all'indirizzo che il gestionale gli
    // aveva dato (mai costruito), in questa scheda, dopo il tocco del medico — e lì si controlla chi è (pinControlla).
    pinApri(k) {
      const x = this.pins?.[k];
      if (!x) return;
      const p = pinNoto(x);
      if (p && (p.url || p.ep === this.epDiQuesta())) return this.apriPaziente(p.ep, "esiti");
      if (!x.url || !leggibilePagina(x.url) || !/\/menuPsoEpisodio\.do$/i.test(new URL(x.url).pathname)) return this.pinNonRiesco(k);
      this.fermaAuto();
      tabStore.set("pinApri.v1", { k, pin: x, ts: Date.now() });
      nav(x.url);
    }
    pinNonRiesco(k, x = this.pins?.[k]) {
      this.segnala({ tag: "Da rivedere", tono: "warn", testo: `Non riesco a riaprirlo dal gestionale: ecco i dati salvati — ${x ? this.pinTesto(x) + (x.nota ? ` · «${x.nota.slice(0, 120)}»` : "") : ""}` }, { ms: 15000 });
      if (x && this.pins?.[k]) setTimeout(() => this.pinMenu(this.root.querySelector("#menubtn"), k), 0);
    }
    // arrivati dalla pagina di un pin: è lui? il nome, e il codice fiscale o la data di nascita della pagina
    pinControlla() {
      const a = tabStore.get("pinApri.v1", null);
      if (!a) return;
      tabStore.set("pinApri.v1", null);
      if (Date.now() - (a.ts || 0) > 60e3 || !a.pin) return;
      const x = a.pin, nome = this.episodeId ? this.nomePaziente() || "" : "";
      if (!nome) return this.pinNonRiesco(a.k, x);
      const cf = cfPagina(document), nato = improntaNascita(nascitaInPagina(document));
      const stessoNome = normNome(nome) === normNome(x.paziente || [x.cognome, x.nome].join(" "));
      const cfOk = !!x.cf && cf === x.cf, natoOk = !!x.nato && nato === x.nato;
      const contro = (!!x.cf && !!cf && cf !== x.cf) || (!!x.nato && !!nato && nato !== x.nato);
      if (stessoNome && (cfOk || natoOk) && !contro) return this.segnala({ tag: "Da rivedere", tono: "ok", testo: `Riaperto da Da rivedere: ${cfOk ? "codice fiscale" : "data di nascita"} e nome controllati` }, { ms: 5000 });
      if (!stessoNome || contro) return this.segnala({ tag: "Errore grave", tono: "err", testo: "Errore grave: la pagina aperta da Da rivedere è di un altro paziente — controlla chi è prima di fare qualunque cosa", ...this.avvisoVisto() });
      this.pinNonRiesco(a.k, x);
    }
    // togliere dall'elenco e svuotarlo: niente conferme, si annulla
    stanzaArchivia(ep) {
      const p = knownPatients().find((x) => x.ep === ep), foto = this.stanzaFoto(true);
      if (!archiviaPaziente(ep, true)) return;
      this.stanzaAnnullabile(`${p?.name || "Paziente"}: tolto dall'elenco`, foto);
      this.render();
    }
    // In Modifica: si spostano letti, sedie e aree (o si allarga un'area dall'angolo)
    // di cella in cella, sempre dentro la pianta. Dove finirebbe sopra un
    // altro si fa rosso e, lasciato lì, torna com'era. Un tocco fermo sul nome
    // lo rende scrivibile.
    stanzaTrascinaOggetto(e, map, obj, allarga, nome) {
      const plan = map.querySelector(".stplan");
      const tipo = obj.hasAttribute("data-letto") ? "letto" : "area";
      const id = obj.getAttribute("data-" + tipo);
      const sala = this.stanzaSala(), o = (tipo === "letto" ? sala.letti : sala.aree).find((x) => x.id === id);
      if (!plan || !o) return;
      const { cols, rows, aw, ah } = PIANTA;
      const u = plan.getBoundingClientRect().width / cols;   // in Modifica la pianta è intera
      const altri = this.stanzaRettangoli(sala).filter((x) => x.id !== id);
      const lim = (v, a, b) => Math.max(a, Math.min(b, v));
      const { w: w0, h: h0 } = tipo === "letto" ? misuraLetto(o) : o;
      let q = { c: o.c, r: o.r, w: w0, h: h0 }, ok = true;
      this.stanzaGesto(e, {
        inizia: () => { obj.classList.add("drag"); map.classList.add("trascino"); },
        muovi: (dx, dy) => {
          const dc = Math.round(dx / u), dr = Math.round(dy / u);
          q = allarga
            ? { c: o.c, r: o.r, w: lim(w0 + dc, aw, cols - o.c), h: lim(h0 + dr, ah, rows - o.r) }
            : { c: lim(o.c + dc, 0, cols - w0), r: lim(o.r + dr, 0, rows - h0), w: w0, h: h0 };
          ok = !altri.some((x) => troppoVicini(x, q));
          for (const k of ["c", "r", "w", "h"]) obj.style.setProperty("--" + k, q[k]);
          obj.classList.toggle("bad", !ok);
        },
        lascia: () => {
          if (!ok || (q.c === o.c && q.r === o.r && q.w === w0 && q.h === h0)) return this.render();
          // si riparte da quella salvata adesso: un nome appena scritto (salvato uscendo dal campo) resta
          const ora = this.stanzaSala(), x = (tipo === "letto" ? ora.letti : ora.aree).find((y) => y.id === id);
          if (!x) return this.render();
          x.c = q.c; x.r = q.r;
          if (tipo === "area") { x.w = q.w; x.h = q.h; }
          if (this.stanzaScrivi(ora)) this.render();
        },
        tocco: () => { if (nome) this.stanzaRinomina(nome); },
        annulla: () => this.render(),
      });
    }
    stanzaRinomina(nomeEl) {
      const obj = nomeEl.closest("[data-letto], [data-area]");
      if (!obj) return;
      const tipo = nomeEl.getAttribute("data-stnome"), id = obj.getAttribute("data-" + tipo);
      const o = (tipo === "letto" ? this.stanzaSala().letti : this.stanzaSala().aree).find((q) => q.id === id);
      if (!o) return;
      this._stanzaRinomina = { tipo, id, testo: o.nome, seleziona: true };
      this._stanzaSel = tipo + ":" + id;
      this.render();
    }
    // Invio o uscire dal campo salvano, Esc lascia il nome di prima.
    stanzaChiudiNome(inp, salva, tasto) {
      const r = this._stanzaRinomina;
      if (!r) return;
      this._stanzaRinomina = null;
      const sala = this.stanzaSala();
      const o = (r.tipo === "letto" ? sala.letti : sala.aree).find((q) => q.id === r.id);
      if (!o) return this.render();
      const nuovo = inp.value.replace(/\s+/g, " ").trim().slice(0, 24);
      if (salva && nuovo && nuovo !== o.nome) {
        o.nome = nuovo;
        if (!this.stanzaScrivi(sala)) return;
      }
      if (tasto) {   // da tastiera: si ridisegna e si resta sul nome
        this.render();
        return [...this.root.querySelectorAll("[data-stnome]")].find((s) => s.closest(`[data-${r.tipo}]`)?.getAttribute(`data-${r.tipo}`) === r.id)?.focus();
      }
      // uscendo col mouse NON si ridisegna: il clic che ha tolto il fuoco deve arrivare
      const t = document.createElement("template");
      t.innerHTML = this.stanzaNome(r.tipo, o);
      if (inp.isConnected) inp.replaceWith(t.content.firstChild);
    }
    // il nome che si stava scrivendo, quando si esce da Modifica senza Invio
    stanzaSalvaBozza() {
      const r = this._stanzaRinomina;
      if (!r) return;
      this._stanzaRinomina = null;
      const nuovo = String(r.testo || "").replace(/\s+/g, " ").trim().slice(0, 24);
      const sala = this.stanzaSala(), o = (r.tipo === "letto" ? sala.letti : sala.aree).find((q) => q.id === r.id);
      if (o && nuovo && nuovo !== o.nome) { o.nome = nuovo; store.set(this.mappa().sala, sala); }
    }
    // Il primo posto libero per il nuovo arrivato: riga per riga dall'angolo in
    // alto a sinistra, meglio se con una cella d'aria intorno.
    stanzaPostoLibero(sala, w, h) {
      const presi = this.stanzaRettangoli(sala);
      for (const g of [1, 0]) {
        for (let r = 0; r + h <= PIANTA.rows; r++) {
          for (let c = 0; c + w <= PIANTA.cols; c++) if (!presi.some((q) => troppoVicini(q, { c, r, w, h }, g))) return { c, r };
        }
      }
      return null;
    }
    // tipo: "letto", "sedia" o "area"; la sedia è un letto con forma: "sedia"
    stanzaAggiungi(tipo) {
      const sala = this.stanzaSala(), area = tipo === "area", sedia = tipo === "sedia";
      const lista = area ? sala.aree : sala.letti.filter((l) => (l.forma === "sedia") === sedia);
      if ((area ? sala.aree : sala.letti).length >= (area ? 30 : 60)) { this.message = area ? "Al massimo 30 aree." : "Al massimo 60 fra letti e sedie."; return this.render(); }
      // un'area nasce 8 × 5; se non ci sta, piccola quanto può
      const { w: lw, h: lh } = misuraLetto({ forma: tipo });
      const misure = area ? [[8, 5], [PIANTA.aw, PIANTA.ah]] : [[lw, lh]];
      let p = null, w = 0, h = 0;
      for (const [mw, mh] of misure) if ((p = this.stanzaPostoLibero(sala, mw, mh))) { w = mw; h = mh; break; }
      const piena = "La stanza è piena: togli o sposta qualcosa.";
      if (!p) { this.message = piena; return this.render(); }
      if (this.message === piena) this.message = null;
      let id;
      do id = Math.random().toString(36).slice(2, 8); while (!id || sala.letti.some((o) => o.id === id) || sala.aree.some((o) => o.id === id));
      // il nome segue quello dell'ultimo: dopo «Box 1» viene «Box 2», dopo «B3» «B4»
      const ultimo = /^(.*?)(\d+)$/.exec(lista[lista.length - 1]?.nome || "");
      const base = ultimo ? ultimo[1] : area ? "Area " : sedia ? "Sedia " : "Letto ";
      const usati = new Set(lista.map((o) => o.nome.toLowerCase()));
      let n = ultimo ? +ultimo[2] + 1 : 1;
      while (usati.has(`${base}${n}`.toLowerCase())) n++;
      const nome = `${base}${n}`.slice(0, 24);
      if (area) sala.aree.push({ id, c: p.c, r: p.r, w, h, nome });
      else sala.letti.push({ id, c: p.c, r: p.r, nome, ...(sedia && { forma: "sedia" }) });
      if (!this.stanzaScrivi(sala)) return;
      const k = area ? "area" : "letto";
      this._stanzaRinomina = { tipo: k, id, testo: nome, seleziona: true };   // appena messo, si battezza
      this._stanzaSel = k + ":" + id;
      this.render();
    }
    stanzaElimina(tipo, id) {
      const sala = this.stanzaSala();
      const o = (tipo === "letto" ? sala.letti : sala.aree).find((x) => x.id === id);
      if (!o) return;
      const foto = this.stanzaFoto();
      if (tipo === "letto") sala.letti = sala.letti.filter((x) => x.id !== id);
      else sala.aree = sala.aree.filter((x) => x.id !== id);
      if (this._stanzaRinomina?.id === id) this._stanzaRinomina = null;
      if (!this.stanzaScrivi(sala)) return;
      // chi ci stava torna fra i da sistemare (lo farebbe comunque la pulizia: qui si vede subito)
      const kp = this.mappa().posti, posti = store.get(kp, {}) || {};
      for (const [ep, v] of Object.entries(posti)) if (v?.tipo === tipo && v.id === id) delete posti[ep];
      store.set(kp, posti);
      this.stanzaAnnullabile(tipo === "area" ? `Eliminata l'area ${o.nome}` : o.forma === "sedia" ? `Eliminata la sedia ${o.nome}` : `Eliminato il letto ${o.nome}`, foto);
      this.render();
    }

