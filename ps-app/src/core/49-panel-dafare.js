//@frammento 49-panel-dafare.js — Panel (segue): IDENTITÀ (idPaz, chiavi di paziente e nota) e DA FARE (voci, promemoria, menu, trascinamento).
    // Chi è questo paziente, per la nota: il codice fiscale se i prelievi
    // ce l'hanno detto, altrimenti il nome della pagina. Cambia da nome a
    // codice fiscale appena i valori arrivano — e la nota lo segue.
    // Il titolo della pagina è il nome del paziente SOLO dove c'è davvero un
    // paziente: sulla lista del reparto quel titolo è «PRONTO SOCCORSO -
    // LISTA», e prenderlo per un nome è come attribuire una nota, un tempo o
    // una scheda a un paziente che non esiste.
    // ============================================================ IDENTITÀ
    // Chi è il paziente di questa pagina, con il secondo identificativo:
    // nome, età e sesso, episodio, posto. Le azioni che escono dal pannello
    // (Conferma, Copia, Stampa) lo nominano: «ROSSI M. · 68 M».
    idPaz() {
      const ep = this.epDiQuesta() || (this.pageType !== "patient" ? this.episodeId || "" : "");
      const p = ep ? tuttiPazienti().find((x) => x.ep === ep) : null;
      const nome = this.nomePaziente() || (this.pageType !== "patient" && ep ? nomeInPagina() : "") || p?.name || "";
      const an = anagraficaPagina(document);
      const eta = Number.isInteger(an.eta) ? an.eta : p?.eta;
      const es = [Number.isInteger(eta) ? String(eta) : "", an.sesso || p?.sesso || ""].filter(Boolean).join(" ");
      return { ep, nome, breve: nomeBreve(nome), es, posto: ep ? this.postoDi(ep) : "" };
    }
    // «ROSSI M. · 68 M», o «» se il nome non c'è
    idBreve() {
      const i = this.idPaz();
      return i.breve ? [i.breve, i.es].filter(Boolean).join(" · ") : "";
    }
    // il posto, in qualunque mappa (se due lo dicono, l'ultimo)
    postoDi(ep) {
      let meglio = null;
      for (const k of Object.keys(MAPPE)) {
        const raw = store.get(MAPPE[k].posti, {}), v = raw && typeof raw === "object" ? raw[ep] : null;
        if (!v || (meglio && (meglio.posto.ts || 0) >= (v.ts || 0))) continue;
        if (this.nomePostoIn({ posto: v, mk: k })) meglio = { posto: v, mk: k };
      }
      return meglio ? this.nomePostoIn(meglio) : "";
    }
    // Allergie e Attenzione del gestionale, sotto il nome, parola per parola:
    // dalla pagina se ci sono, se no da quella del paziente letta poco fa. Mai
    // «nessuna»: non lette è non lette.
    avvisiPaz(ep) {
      const qui = this.pageType === "patient" ? { allergie: allergiePagina(document), attenzione: attenzionePagina(document) } : null;
      const st = statoDi(ep);
      const a = qui && (qui.allergie || qui.attenzione) ? qui : st && st.anag ? st.anag : null;
      const all = a && a.allergie;
      const pezzi = [];
      if (!all) pezzi.push(`<span class="idall nl">Allergie: non lette</span>`);
      else if (!all.nega && !all.testo) pezzi.push(`<span class="idall nc" title="Il campo Allergie del gestionale è vuoto e «Nega» non è spuntato: nessuno l'ha compilato">Allergie: non compilate</span>`);
      else if (all.nega) pezzi.push(`<span class="idall nega" title="Allergie, dal gestionale: Nega/Non riferisce">Allergie: nega</span>`);
      else if (all.testo) pezzi.push(`<span class="idall ros" title="${esc("Allergie: " + all.testo)}">Allergie: ${esc(all.testo)}</span>`);
      const att = (a && a.attenzione) || [];
      if (att.length) pezzi.push(`<span class="idatt" title="${esc("Attenzione: " + att.join(" · "))}">Attenzione: ${esc(att.join(" · "))}</span>`);
      return pezzi.length ? `<div class="idriga">${pezzi.join("")}</div>` : "";
    }
    // Per le Richieste: esame per esame (il nome del catalogo, identico), le
    // ore delle richieste già tornate e la più vecchia ancora in attesa.
    ultimiEsami() { return ultimiDi(this.episodeId); }
    // «· 11:40, 14:30», «· in attesa 40′»; letto da più di mezz'ora: «· letto 11:02»
    // «✓ 11:40» fatto, in verde; «40′» in attesa, ambra (senza ⏳) — rosso oltre la
    // seconda soglia del suo tipo; letto da più di mezz'ora: in grigio, «letto 11:02»
    suffissoEsame(m, label, tipo = "lab") {
      const x = m.get(chiaveEsame(label));
      if (!x) return null;
      const ora = Date.now(), pezzi = [];
      const tinta = (cls, t) => `<span class="${m.vecchio ? "" : cls}">${esc(t)}</span>`;
      if (x.fatti.length) pezzi.push(tinta("uok", `✓ ${x.fatti.sort((a, b) => a - b).slice(-3).map(hhmm).join(", ")}`));
      else if (x.fatto) pezzi.push(tinta("uok", "✓"));
      if (x.inAttesa) {
        const min = x.attesa && !m.vecchio ? minDa(x.attesa, ora) : null;
        pezzi.push(tinta(min != null && attesaBanda(tipo, min) === "ros" ? "uros" : "uatt", min != null ? attesaTesto(min) : "in attesa"));
      }
      if (m.vecchio && m.letto) pezzi.push(`<span>letto ${esc(hhmm(m.letto))}</span>`);
      const titolo = `${x.fatti.length ? `Già fatto: richieste delle ${x.fatti.map(hhmm).join(", ")}` : x.fatto ? "Già fatto" : ""}${
        x.inAttesa ? `${x.fatti.length || x.fatto ? " · " : ""}in attesa${x.attesa ? ` dalle ${hhmm(x.attesa)}` : ""}` : ""}${m.letto ? ` · letto alle ${hhmm(m.letto)}` : ""}`;
      return { html: `<span class="ult${m.vecchio ? " vecchio" : ""}">${pezzi.join(" ")}</span>`, titolo };
    }
    // la riga di stato di un paziente (Pazienti, letto): in testa il cuore dei parametri vitali, poi gli esami
    statoPaz(ep, breve = false) {
      return this.cuoreHtml(ep) + statoHtml(statoEsami(statoDi(ep)), { breve });
    }

    nomePaziente() {
      // una pagina «altra»: il nome del suo riquadro, o quello che il pannello conosce
      if (this.pageType === "vista") {
        const ep = this.epDiQuesta();
        return ep ? nomeInPagina() || tuttiPazienti().find((p) => p.ep === ep)?.name || "" : "";
      }
      const puoOrdinare = !!(this.entry && (this.entry.labUrl || this.entry.radioUrl));
      return this.pageType === "patient" && puoOrdinare ? nomeInPagina() : "";
    }

    // La chiave del paziente di questa pagina: una sola, usata dalla nota,
    // dalla scheda clinica e dai referti tenuti — così «elimina questo
    // paziente» sa esattamente cosa togliere.
    chiavePaz() {
      const cf = this.cfEpisodio();
      if (cf) return "cf:" + cf;
      // (i valori letti in un'altra scheda — una dietro: il telefono, il ⟳ — hanno già segnato la chiave
      // dell'episodio col codice fiscale: questa scheda la usa, e non la riporta al nome)
      const pk = String(tuttiPazienti().find((p) => p.ep === this.episodeId)?.pk || "");
      if (this.episodeId && pk.startsWith("cf:")) return pk;
      const n = normNome(this.nomePaziente());
      return n ? "nome:" + n : "";
    }
    // La chiave passa da «nome:» a «cf:» nel momento in cui i valori portano
    // il codice fiscale. I segni fatti prima devono SEGUIRE il paziente, non
    // restare indietro (e non riaffiorare su un omonimo): li si sposta.
    chiaveNota() {
      const k = this.chiavePaz();
      if (!k.startsWith("cf:")) return k;
      const vecchia = "nome:" + normNome(this.nomePaziente());
      if (vecchia !== "nome:") migraSegni(vecchia, k);
      // «elimina paziente» deve trovare anche questa chiave, con o senza estensione
      segnaChiave(this.episodeId, k);
      return k;
    }
    // ============================================================== DA FARE
    // L'icona «Da fare» di un paziente: le spunte tonde e quante voci sono
    // aperte; ambra 15 minuti prima di un promemoria, rossa quando è passato.
    // Un tocco apre la lista lì dov'è. Il passaggio del mouse le dice tutte.
    // Nell'intestazione della finestra, al posto del numero, la prima voce
    // aperta (poi «+N»): aperta la finestra, è l'unico posto dove stanno. Se
    // un promemoria si avvicina o è passato (ambra, rossa), dice quello, col
    // tempo che manca, come la pill: «⏰ −6m tropo +2».
    dfIcona(ep, tutti = dfTutti(), dove = "lista", ora = Date.now()) {
      // (con il suo blocco Da fare aperto in cima alla scheda, l'intestazione dice solo l'icona e
      // quante: la stessa riga non si legge due volte, una sopra l'altra)
      const blocco = dove === "testa" && this._tdSolo === ep && !store.get(TD_PAZ, null)?.chiusa;
      const aperte = dfAperte(ep, tutti), n = aperte.length, testa = dove === "testa" && n > 0 && !blocco;
      const prossimo = aperte.filter((x) => x.t != null).sort((a, b) => a.t - b.t)[0];
      const b = prossimo ? promBanda(prossimo.t, ora) : "";
      const riga = (x) => (x.t != null ? promRiga(x, ora) : x.testo);
      const tit = n ? `Da fare (${n}):\n${aperte.map(riga).join("\n")}` : "Da fare: niente — un tocco per aggiungere";
      const urge = testa && b ? prossimo : null, prima = urge || aperte[0];
      const det = `${n ? `${n} ${n === 1 ? "aperta" : "aperte"}` : "niente"}${testa ? `: ${riga(prima)}` : ""}${prossimo && !(testa && prossimo === prima) ? ` · ${promRiga(prossimo, ora)}` : ""}`;
      const quando = urge ? promTempo(urge.t, ora) : prima?.t != null ? promOra(prima.t, ora) : "";
      const dentro = testa ? `${urge ? ICO.sveglia : ICO.dafare}<span class="dfict">${quando ? `<b>${esc(quando)}</b> ` : ""}${esc(prima.testo)}</span>${n > 1 ? `<b>+${n - 1}</b>` : ""}`
        : `${ICO.dafare}${n ? `<b>${n}</b>` : ""}`;
      return `<button type="button" class="dfic${b ? " " + b : ""}${b === "ros" && prossimo && ora - prossimo.t < 10 * 60e3 ? " fresco" : ""}${n ? "" : " vuota"}${testa ? " dfprima" : ""}" data-df="${esc(ep)}" data-dove="${esc(dove)}" aria-haspopup="dialog" aria-expanded="${
        this._df?.ep === ep && this._df.dove === dove ? "true" : "false"}" title="${esc(tit)}" aria-label="${esc("Da fare: " + det)}">${dentro}</button>`;
    }
    // Il post-it: la prima voce aperta, nell'ordine scelto dal medico
    dfPost(ep, tutti = dfTutti()) {
      const x = dfPrima(ep, tutti);
      return x ? `<span class="dfpost">${x.t != null ? `<b>${esc(hhmm(x.t))}</b> ` : ""}${esc(x.testo)}</span>` : "";
    }
    // l'icona, e il post-it, ognuno nel suo posto: si rifanno da soli (dfMetti)
    dfSlot(ep, tutti, dove) {
      return `<span class="dfslot" data-dfslot="${esc(ep)}" data-dove="${esc(dove)}">${this.dfIcona(ep, tutti, dove)}</span>`;
    }
    dfPostSlot(ep, tutti) {
      return `<span class="dfpslot" data-dfp="${esc(ep)}">${this.dfPost(ep, tutti)}</span>`;
    }
    // Le cose da fare di chi hai davanti, sempre in vista sotto la pill
    // ridotta (aperta la finestra, le dice l'icona nell'intestazione): al più
    // tre righe (la prima è la nota), poi «+N»; un tocco apre la lista lì
    // sopra. Niente, se non c'è niente.
    dfNotaHtml(ep, tutti = dfTutti(), ora = Date.now()) {
      const l = dfAperte(ep, tutti);
      return l.slice(0, 3).map((x) => this.dfRiga(x, ora)).join("") + (l.length > 3 ? `<span class="dfpiun">+${l.length - 3}</span>` : "");
    }
    dfNotaTitolo(ep, tutti = dfTutti(), ora = Date.now()) {
      const l = dfAperte(ep, tutti);
      return `Da fare (${l.length}):\n${l.map((x) => (x.t != null ? promRiga(x, ora) : x.testo)).join("\n")}\nUn tocco: la lista`;
    }
    dfNotaSlot(ep, tutti = dfTutti(), cls = "") {
      const h = ep ? this.dfNotaHtml(ep, tutti) : "";
      return `<button type="button" class="dfnota${cls}" data-df="${esc(ep)}" data-dove="nota" data-dfn="${esc(ep)}" aria-haspopup="dialog" aria-expanded="false"${
        h ? ` title="${esc(this.dfNotaTitolo(ep, tutti))}"` : " hidden"}>${h}</button>`;
    }
    // il pallino del letto (esami e «Da fare» insieme): si rifà da solo anche lui (dfMetti)
    segnaleHtml(ep, tutti = dfTutti(), ora = Date.now()) {
      return segnaleLetto(statoEsami(statoDi(ep), ora), dfAperte(ep, tutti), ora);
    }
    // Il cuore dei parametri vitali (vedi PARAMETRI VITALI): rosso o ambra,
    // vuoto con le ore se la riga è vecchia. Un impulso solo, la prima volta
    // che compare in questa scheda; poi fermo.
    cuoreHtml(ep, ora = Date.now(), soloIcona = false) {
      const c = cuoreDi(statoDi(ep)?.vit, ora);
      if (!c) return "";
      // l'impulso dura un secondo da quando il cuore è comparso: un ridisegno
      // in quel secondo lo continua (il ritardo negativo), non lo ricomincia
      let pulsa = -1;
      if (!c.vecchio) {
        const visti = tabStore.get("cuori.v1", {}) || {}, v = visti[ep], adesso = Date.now();
        if (!v || v.k !== c.chiave) { visti[ep] = { k: c.chiave, t: adesso }; tabStore.set("cuori.v1", visti); pulsa = 0; }
        else if (adesso - v.t < 1000) pulsa = Math.max(0, adesso - v.t);
      }
      const cosa = c.livello === "ros" ? "parametri vitali critici" : "parametri vitali: NEWS2 5–6";
      return `<span class="cuore ${c.livello}${c.vecchio ? " vecchio" : ""}${pulsa >= 0 ? " pulsa" : ""}"${pulsa > 0 ? ` style="animation-delay:-${pulsa}ms"` : ""} role="img" aria-label="${
        esc(cosa + (c.vecchio ? `, misurati ${c.ore} ore fa` : ""))}" title="${esc(c.titolo)}">${c.vecchio ? (soloIcona ? "♡" : `♡ ${c.ore}h`) : "♥"}${
        soloIcona ? "" : `<span class="cuorev">${esc([`NEWS ${c.punti}`, ...c.fuori].join(" · "))}</span>`}</span>`;
    }

    // Sulla pill ridotta, e solo quando tocca: il promemoria più urgente fra
    // i pazienti in elenco, a 10 minuti o meno, o già passato. Se è di un
    // altro paziente lo dice — «−3m Ferrari · RX polso» — perché accanto al
    // nome di chi hai davanti un tempo muto si legge come suo. Un tocco: ✓ Fatto,
    // +15′ o Apri (il paziente).
    promUrgenti(ora = Date.now()) {
      const tutti = promTutti();
      if (!Object.keys(tutti).length) return [];
      const arch = new Set(pazientiArchiviati().map((p) => p.ep)), noti = new Map(tuttiPazienti().map((p) => [p.ep, p]));
      return Object.entries(tutti).filter(([ep]) => !arch.has(ep))
        .flatMap(([ep, l]) => l.map((p) => ({ ...p, ep, nome: noti.get(ep)?.name || (ep === this.epDiQuesta() && this.nomePaziente()) || "" })))
        .filter((p) => promAllarme(p.t, ora)).sort((a, b) => a.t - b.t);
    }
    promUrgenteTesto(u, ora = Date.now()) {
      const chi = u.ep === this.epDiQuesta() ? "" : cognomeTitolo(u.nome) || "ep. " + u.ep;
      return `${promTempo(u.t, ora)}${chi ? " " + chi : ""} · ${u.testo}`;
    }
    promUrgente(ora = Date.now()) {
      const urg = this.promUrgenti(ora);
      if (!urg.length) return "";
      const u = urg[0], piu = urg.length - 1;
      const dove = (p) => `${p.nome || "episodio " + p.ep} · ${p.testo}`;
      const tit = `${urg.map(dove).join("\n")}\nUn tocco: fatto, 15 minuti in più, o apri il paziente`;
      return `<span class="prurg" role="button" tabindex="0" data-prurg="${esc(u.ep)}" data-prid="${esc(u.id)}" aria-haspopup="menu" title="${esc(tit)}" aria-label="${
        esc("Promemoria urgente: " + this.promUrgenteTesto(u, ora))}">${ICO.sveglia}<span class="prurgt">${esc(this.promUrgenteTesto(u, ora))}</span>${piu ? `<span class="prurgp">+${piu}</span>` : ""}</span>`;
    }
    // Il segno sulla pill ridotta rifatto SUL POSTO (il tempo che passa, un
    // promemoria fatto): lo stesso elemento finché è lo stesso promemoria,
    // così il suo menu aperto non perde l'àncora.
    promSegno(ora = Date.now()) {
      const pill = this.root.querySelector("#expand.pill:not(.run)");
      if (!pill) return;
      const prima = pill.querySelector(".prurg"), nuovo = this.promUrgente(ora);
      const m = this._promMenu;
      if (!nuovo) {
        prima?.remove();
        if (m && m.urg && !m.annulla) this.promChiudiMenu();
        return;
      }
      const t = document.createElement("template");
      t.innerHTML = nuovo;
      const n = t.content.firstElementChild;
      if (prima && prima.getAttribute("data-prid") === n.getAttribute("data-prid") && prima.getAttribute("data-prurg") === n.getAttribute("data-prurg")) {
        prima.title = n.title; prima.setAttribute("aria-label", n.getAttribute("aria-label"));
        prima.innerHTML = n.innerHTML;
        return;
      }
      if (m && m.urg && !m.annulla) this.promChiudiMenu();
      if (prima) prima.replaceWith(n); else pill.appendChild(n);
    }
    // ✓ Fatto · +15′ · Apri, per il promemoria del segno sulla pill
    promMenuSegno(anchor) {
      this.promChiudiMenu();
      const ep = anchor.getAttribute("data-prurg"), id = anchor.getAttribute("data-prid");
      const wrap = this.root.querySelector(".wrap"), u = this.promUrgenti().find((x) => x.ep === ep && x.id === id);
      if (!u || !wrap) return;
      const mio = ep === this.epDiQuesta(), noto = tuttiPazienti().find((x) => x.ep === ep);
      wrap.insertAdjacentHTML("beforeend", `<div class="prmenu prmini" role="menu" aria-label="${esc("Promemoria: " + this.promUrgenteTesto(u))}">
        <div class="prmhd" title="${esc(promRiga(u, Date.now()))}"><b>${esc(this.promUrgenteTesto(u))}</b></div>
        <div class="prmrow">
          <button type="button" role="menuitem" class="prmb ok" data-pu="fatto" title="Fatto: lo tolgo (si può annullare)">✓ Fatto</button>
          <button type="button" role="menuitem" class="prmb" data-pu="piu" title="Rimanda di 15 minuti">+15′</button>
          ${mio || noto?.url ? `<button type="button" role="menuitem" class="prmb" data-pu="apri" title="${mio ? "Apri il pannello" : "Apri " + esc(u.nome || "il paziente")}">Apri</button>` : ""}
        </div></div>`);
      const menu = wrap.lastElementChild;
      this.promPosiziona(menu, anchor, wrap);
      const chiudi = (ritorna) => this.promChiudiMenu(ritorna);
      menu.addEventListener("click", (e) => {
        const b = e.target.closest("[data-pu]");
        if (!b) return;
        const az = b.getAttribute("data-pu");
        if (az === "fatto") {
          const p = promTogli(ep, id);
          if (!p) return chiudi();
          // sulla pill ridotta non c'è dove mostrare «Annulla»: lo porta il menu, 8 secondi
          menu.innerHTML = `<div class="prmrow"><span class="prmq">Fatto: ${esc(p.testo)}</span><button type="button" class="prmb" data-pu="annulla">Annulla</button></div>`;
          menu.dataset.fatto = JSON.stringify(p);
          this._promMenu.annulla = true;
          this._promMenu.timer = setTimeout(() => { if (this._promMenu?.menu === menu) chiudi(); }, 8000);
          menu.querySelector("button")?.focus({ preventScroll: true });
          this.promSegno();
          // senza il segno la pill si stringe (e si sposta, ancorata a destra): il menu la segue
          const pill = this.root.querySelector("#expand");
          if (pill) this.promPosiziona(menu, pill, wrap);
        } else if (az === "annulla") {
          try { promRimetti(ep, JSON.parse(menu.dataset.fatto)); } catch { /* niente */ }
          chiudi(); this.promSegno();
        } else if (az === "piu") {
          promRinvia(ep, id); chiudi(); this.promSegno();
        } else if (az === "apri") {
          chiudi();
          if (mio) this.apri(); else this.apriPaziente(ep, "esiti");
        }
      });
      menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); chiudi(true); } });
      menu.addEventListener("focusout", (e) => { if (e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== anchor) chiudi(); });
      const fuori = (e) => { const via = e.composedPath(); if (!via.includes(menu) && !via.includes(anchor)) chiudi(); };
      window.addEventListener("pointerdown", fuori, true);
      this._promMenu = { menu, anchor, ep, fuori, urg: true };
      menu.querySelector("button")?.focus({ preventScroll: true });
    }
    // sotto l'àncora; se sotto non c'è posto, sopra; sempre dentro lo schermo
    promPosiziona(menu, anchor, wrap) {
      const wr = wrap.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      let y = ar.bottom + 6;
      if (y + menu.offsetHeight > innerHeight - 8) y = Math.max(8, ar.top - 6 - menu.offsetHeight);
      menu.style.left = Math.max(8, Math.min(ar.left, innerWidth - menu.offsetWidth - 8)) - wr.left + "px";
      menu.style.top = y - wr.top + "px";
    }
    // Ogni 30 secondi le icone «Da fare» rifanno i conti SUL POSTO (il colore,
    // le voci spuntate da 5 minuti che se ne vanno): niente ridisegno, così
    // non si ruba il fuoco e non si disturba chi scrive.
    promTick() {
      const ora = Date.now(), tutti = dfTutti(ora);
      const eps = new Set([...this.root.querySelectorAll("[data-dfslot], [data-dfp], [data-dfseg], [data-dfn]")]
        .map((s) => s.getAttribute("data-dfslot") || s.getAttribute("data-dfp") || s.getAttribute("data-dfseg") || s.getAttribute("data-dfn")));
      for (const ep of eps) if (ep) this.dfMetti(ep, tutti, ora);
      if (this._df?.pop?.isConnected) this.dfLista(tutti, ora);
      this.tdMetti(tutti, ora);
      this.promSegno(ora);
    }
    // Il Da fare della testata: se nemmeno la prima parola sta intera, solo icona e numero
    dfAdatta() {
      const fai = () => {
        for (const b of this.root.querySelectorAll(".dfic.dfprima")) {
          b.classList.remove("solo");
          const t = b.querySelector(".dfict");
          if (t && t.scrollWidth > t.clientWidth + 1) b.classList.add("solo");
        }
      };
      fai();
      const hd = this.root.querySelector("#draghd");
      this._dfRO?.disconnect();
      if (hd && typeof ResizeObserver !== "undefined") { this._dfRO = new ResizeObserver(fai); this._dfRO.observe(hd); }
    }
    // l'icona e il post-it di un paziente rifatti sul posto, dappertutto
    dfMetti(ep, tutti = dfTutti(), ora = Date.now()) {
      const e = CSS.escape(ep);
      for (const slot of this.root.querySelectorAll(`[data-dfslot="${e}"]`)) {
        const dove = slot.getAttribute("data-dove") || "lista", b = slot.querySelector(".dfic");
        const t = document.createElement("template");
        t.innerHTML = this.dfIcona(ep, tutti, dove, ora);
        const n = t.content.firstElementChild;
        if (!b) { slot.replaceChildren(n); continue; }
        // lo stesso bottone: il fuoco (e l'àncora della lista aperta) restano
        b.className = n.className; b.title = n.title; b.setAttribute("aria-label", n.getAttribute("aria-label"));
        b.setAttribute("aria-expanded", n.getAttribute("aria-expanded")); b.innerHTML = n.innerHTML;
      }
      for (const slot of this.root.querySelectorAll(`[data-dfp="${e}"]`)) slot.innerHTML = this.dfPost(ep, tutti);
      if (this._tdSolo === ep) this.tdMetti(tutti, ora);
      for (const slot of this.root.querySelectorAll(`[data-dfseg="${e}"]`)) slot.innerHTML = this.segnaleHtml(ep, tutti, ora);
      for (const b of this.root.querySelectorAll(`[data-dfn="${e}"]`)) {
        const h = this.dfNotaHtml(ep, tutti, ora);
        b.innerHTML = h; b.hidden = !h;
        if (h) b.title = this.dfNotaTitolo(ep, tutti, ora); else b.removeAttribute("title");
      }
      this.dfAdatta();
    }
    promClic(e) {
      const segno = e.target.closest?.("[data-prurg]");
      if (segno) {
        const aperto = this._promMenu?.anchor === segno && this._promMenu.menu.isConnected;
        return aperto ? this.promChiudiMenu(true) : this.promMenuSegno(segno);
      }
      const ic = e.target.closest?.("[data-df]");
      if (ic && !ic.closest(".dfpop")) {
        e.stopPropagation?.();
        const ep = ic.getAttribute("data-df");
        const aperto = this._df && this._df.ep === ep && this._df.anchor === ic && this._df.pop.isConnected;
        return aperto ? this.dfChiudi(true) : this.dfApri(ep, ic);
      }
    }
    // La lista, in una piccola finestra sotto l'icona (sopra, se sotto non
    // c'è posto): le voci con la spunta tonda, il loro orario se ce l'hanno, e
    // in fondo il campo su una riga per aggiungerne una. Esc, o un clic
    // fuori, la chiudono; niente si salva a parte: ogni gesto è già salvato.
    dfApri(ep, anchor, { fuoco = true, testo = "" } = {}) {
      this.dfChiudi();
      this.promChiudiMenu();
      this.stanzaChiudiMenu?.();
      const wrap = this.root.querySelector(".wrap");
      if (!ep || !wrap || !anchor?.isConnected) return;
      const p0 = tuttiPazienti().find((x) => x.ep === ep);
      const nome = p0?.name || (ep === this.epDiQuesta() ? this.nomePaziente() : "");
      wrap.insertAdjacentHTML("beforeend", `<div class="dfpop" role="dialog" aria-label="Da fare${nome ? " · " + esc(nome) : ""}">
        <div class="dfhd"><b>Da fare</b>${nome ? `<span> · ${esc(nome)}</span>` : ""}</div>
        <ul class="dfl" aria-label="Voci: Alt+↑ e Alt+↓ le spostano"></ul>
        <div class="dfadd"><input type="text" class="dfin" id="dfin" maxlength="160" autocomplete="off" spellcheck="false" value="${esc(testo)}"
          placeholder="+ nota" title="Con un'ora (11:30 tropo, tra 2h ECG) è un promemoria" aria-label="Nuova nota: una cosa da fare; con un'ora (11:30 tropo, tra 2h ECG) è un promemoria" aria-describedby="dfhint">
          <span class="dfhint" id="dfhint" aria-live="polite"></span></div>
        <span class="dfsr" aria-live="polite"></span>
      </div>`);
      const pop = wrap.lastElementChild;
      const fuori = (ev) => { const via = ev.composedPath(); if (!via.includes(pop) && !via.includes(this._df?.anchor)) this.dfChiudi(); };
      window.addEventListener("pointerdown", fuori, true);
      this._df = { ep, dove: anchor.getAttribute("data-dove") || "", pop, anchor, fuori, testo };
      anchor.setAttribute("aria-expanded", "true");
      this.dfLista();
      this.promPosiziona(pop, anchor, wrap);
      // dalla nota sotto la pill la lista si apre al suo posto, sopra di lei: le stesse righe, una volta
      if (anchor.classList.contains("dfnota")) {
        const wr = wrap.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
        pop.style.top = (ar.top + pop.offsetHeight <= innerHeight - 8 ? ar.top : Math.max(8, ar.bottom - pop.offsetHeight)) - wr.top + "px";
      }
      const inp = pop.querySelector("#dfin");
      // per riaprirla uguale dopo un ridisegno: il fuoco era qui dentro?
      pop.addEventListener("focusin", () => { if (this._df?.pop === pop) this._df.inFuoco = true; });
      pop.addEventListener("focusout", (ev) => { if (this._df?.pop === pop && ev.relatedTarget && !pop.contains(ev.relatedTarget)) this._df.inFuoco = false; });
      // un tocco sul testo lo modifica; ✕ la cancella
      const modifica = (mod) => {
        const id = mod.closest(".dfi").getAttribute("data-id");
        this.modificaVoce(mod, (v) => {
          if (v != null) dfCambia(ep, id, v);
          const ul = pop.querySelector(".dfl");
          if (ul) ul._firma = "";
          this.dfDopo(id, v != null ? "Modificata" : "");
        });
      };
      pop.addEventListener("click", (ev) => {
        const ck = ev.target.closest(".dfck"), piu = ev.target.closest("[data-dfpiu]"), via = ev.target.closest("[data-dfvia]"), mod = ev.target.closest("[data-dfmod]");
        if (ck) {
          const li = ck.closest(".dfi"), id = li.getAttribute("data-id"), si = ck.getAttribute("aria-checked") !== "true";
          dfSpunta(ep, id, si);
          this.dfDopo(id, si ? "Fatta: se ne va fra 5 minuti" : "Di nuovo da fare");
        } else if (piu) {
          promRinvia(ep, piu.getAttribute("data-dfpiu"));
          this.dfDopo(piu.getAttribute("data-dfpiu"), "Rimandata di 15 minuti");
        } else if (via) {
          dfTogli(ep, via.getAttribute("data-dfvia"));
          this.dfDopo(null, "Cancellata");
        } else if (mod) modifica(mod);
      });
      pop.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); return this.dfChiudi(true); }
        const mod = ev.target.closest?.("[data-dfmod]");
        if (mod && ev.target === mod && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); return modifica(mod); }
        if (ev.target.classList?.contains("dfmod")) return;   // nel campo della modifica le frecce sono sue
        const li = ev.target.closest?.(".dfi");
        if (li && ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
          ev.preventDefault();
          const l = dfDi(ep), i = l.findIndex((x) => x.id === li.getAttribute("data-id")), a = i + (ev.key === "ArrowUp" ? -1 : 1);
          if (i < 0 || a < 0 || a >= l.length) return;
          dfSposta(ep, l[i].id, a);
          this.dfDopo(l[i].id, `Spostata: ${a + 1}ª di ${l.length}`);
        }
      });
      // trascinare dalla maniglia ⋮⋮, col mouse o col dito
      pop.addEventListener("pointerdown", (ev) => { const g = ev.target.closest(".dfgrip"); if (g) this.dfTrascina(ev, g.closest(".dfi")); });
      inp.addEventListener("input", () => { if (this._df) this._df.testo = inp.value; this.dfSuggerisci(inp); });
      inp.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        if (!inp.value.trim()) return;
        const x = dfAggiungi(ep, inp.value);
        const h = pop.querySelector(".dfhint");
        if (!x) {
          h.textContent = dfAperte(ep).length >= PROM_MAX ? `Al massimo ${PROM_MAX} voci aperte per paziente` : "Non salvata: la memoria del browser è piena o bloccata";
          h.classList.add("ko");
          return;
        }
        inp.value = ""; this._df.testo = "";
        this.dfDopo(null, x.t != null ? `Aggiunta, alle ${promOra(x.t, Date.now())}` : "Aggiunta");
      });
      this.dfSuggerisci(inp);
      if (fuoco) { inp.focus({ preventScroll: true }); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
    // sotto il campo, mentre si scrive: se c'è un'ora, quando sarà
    dfSuggerisci(inp) {
      const h = inp.parentElement?.querySelector(".dfhint");
      if (!h) return;
      const p = inp.value.trim() ? leggiPromemoria(inp.value, Date.now(), DF_LUNGO) : null;
      h.classList.remove("ko");
      h.textContent = p ? `promemoria: ${promRiga({ t: p.t, testo: "" }, Date.now())}` : "";
    }
    // L'ora di una voce, davanti al testo: piccola, ambra 15 minuti prima, rossa passata
    dfOra(x, ora) {
      if (x.t == null) return "";
      const b = x.fatto ? "" : promBanda(x.t, ora);
      return `<span class="dft${b ? " " + b : ""}" title="${esc(promRiga(x, ora))}">${esc(promOra(x.t, ora))}</span>`;
    }
    // la stessa riga, solo da leggere (sotto la pill, nella scheda al passaggio)
    dfRiga(x, ora) {
      return `<span class="dfr"><i class="dfo" aria-hidden="true"></i>${this.dfOra(x, ora)}<span class="dftx">${esc(x.testo)}</span></span>`;
    }
    dfVoce(x, ora) {
      return `<li class="dfi${x.fatto ? " fatto" : ""}" data-id="${esc(x.id)}">
        <span class="dfgrip" aria-hidden="true" title="Trascina per spostarla (o Alt+↑ / Alt+↓)">⋮⋮</span>
        <button type="button" class="dfck" role="checkbox" aria-checked="${x.fatto ? "true" : "false"}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          aria-label="${esc(x.testo + (x.t != null ? ", alle " + promOra(x.t, ora) : ""))}" title="${x.fatto ? "Fatta: un tocco la riapre (se ne va fra 5 minuti)" : "Un tocco quando è fatta"}"></button>
        ${this.dfOra(x, ora)}<span class="dftx" data-dfmod role="button" tabindex="0" title="${esc(x.testo)}&#10;Tocca per modificare">${esc(x.testo)}</span>
        ${x.t != null && !x.fatto ? `<button type="button" class="dfpiu" data-dfpiu="${esc(x.id)}" title="Rimanda di 15 minuti" aria-label="Rimanda ${esc(x.testo)} di 15 minuti">+15′</button>` : ""}
        <button type="button" class="dfx" data-dfvia="${esc(x.id)}" title="Cancella" aria-label="Cancella ${esc(x.testo)}">${CESTINO}</button>
      </li>`;
    }
    dfLista(tutti = dfTutti(), ora = Date.now()) {
      const d = this._df, ul = d?.pop?.querySelector(".dfl");
      if (!ul || this._dfPresa || ul.querySelector(".dfmod")) return;   // non sotto chi trascina o modifica
      const l = dfDi(d.ep, tutti);
      const html = l.length ? l.map((x) => this.dfVoce(x, ora)).join("") : "";
      if (ul._firma === html) return;   // niente di cambiato: il fuoco resta dov'è
      // rifatta: il fuoco torna sulla stessa voce, se c'è ancora
      const f = this.root.activeElement?.closest?.(".dfi")?.getAttribute("data-id"), suCk = !!this.root.activeElement?.classList?.contains("dfck");
      ul.innerHTML = html;
      ul._firma = html;
      if (f) (ul.querySelector(`.dfi[data-id="${CSS.escape(f)}"] ${suCk ? ".dfck" : ".dfpiu"}`) || ul.querySelector(`.dfi[data-id="${CSS.escape(f)}"] .dfck`) || d.pop.querySelector("#dfin"))?.focus({ preventScroll: true });
    }
    // Modificare una voce toccandone il testo: il testo diventa un campo;
    // Invio (o uscirne) salva, Esc la lascia com'era — e così un campo vuoto.
    // `salva(nuovo)`: il testo nuovo, o null se non è cambiato niente.
    modificaVoce(el, salva) {
      if (!el || el.querySelector(".dfmod")) return;
      const prima = el.textContent;
      const inp = document.createElement("input");
      Object.assign(inp, { type: "text", className: "dfmod", value: prima, maxLength: 500, spellcheck: false, autocomplete: "off" });
      inp.setAttribute("aria-label", "Modifica: " + prima);
      el.replaceChildren(inp);
      inp.focus({ preventScroll: true });
      inp.setSelectionRange(prima.length, prima.length);
      let finito = false;
      const fine = (tieni) => {
        if (finito) return;
        finito = true;
        const v = inp.value.replace(/\s+/g, " ").trim(), nuovo = tieni && v && v !== prima ? v : null;
        el.textContent = nuovo ?? prima;
        salva(nuovo);
      };
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); fine(true); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fine(false); }
      });
      inp.addEventListener("blur", () => fine(true));
      inp.addEventListener("click", (e) => e.stopPropagation());   // un clic nel campo non è un altro tocco sul testo
    }
    // dopo un gesto: la lista, l'icona e il post-it rifatti, il fuoco dov'era
    dfDopo(id, detto) {
      const d = this._df;
      if (!d) return;
      const tutti = dfTutti();
      this.dfLista(tutti);
      this.dfMetti(d.ep, tutti);
      const sr = d.pop.querySelector(".dfsr");
      if (sr && detto) sr.textContent = detto;
      const f = id ? d.pop.querySelector(`.dfi[data-id="${CSS.escape(id)}"] .dfck`) : d.pop.querySelector("#dfin");
      (f || d.pop.querySelector("#dfin"))?.focus({ preventScroll: true });
    }
    // Trascinare una voce: oltre i 4 px (10 col dito) la voce segue il
    // puntatore e le altre le fanno posto; lasciata, l'ordine si salva. Esc,
    // o un annullo del browser, la rimettono dov'era.
    dfTrascina(e, li) {
      const d = this._df;
      if (!d || !li || e.button !== 0) return;
      e.preventDefault();
      const ul = li.parentElement, id = li.getAttribute("data-id"), y0 = e.clientY, soglia = e.pointerType === "mouse" ? 4 : 10;
      let partito = false;
      this._dfPresa = true;
      const mm = (ev) => {
        if (!partito && Math.abs(ev.clientY - y0) < soglia) return;
        ev.preventDefault();
        if (!partito) { partito = true; li.classList.add("presa"); ul.classList.add("trascino"); }
        const altre = [...ul.querySelectorAll(".dfi")].filter((x) => x !== li);
        const prima = altre.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
        if (prima) { if (li.nextElementSibling !== prima) ul.insertBefore(li, prima); } else if (ul.lastElementChild !== li) ul.appendChild(li);
      };
      const fine = (salva) => {
        window.removeEventListener("pointermove", mm, true);
        window.removeEventListener("pointerup", su, true);
        window.removeEventListener("pointercancel", via, true);
        window.removeEventListener("keydown", kd, true);
        this._dfPresa = false;
        li.classList.remove("presa"); ul.classList.remove("trascino");
        if (!partito) return;
        const a = [...ul.querySelectorAll(".dfi")].indexOf(li);
        if (salva) dfSposta(d.ep, id, a);
        ul._firma = "";   // l'ordine sullo schermo l'ha cambiato il trascinamento: si rifà comunque
        this.dfDopo(id, salva ? `Spostata: ${a + 1}ª` : "");
      };
      const su = () => fine(true), via = () => fine(false);
      const kd = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); fine(false); } };
      window.addEventListener("pointermove", mm, true);
      window.addEventListener("pointerup", su, true);
      window.addEventListener("pointercancel", via, true);
      window.addEventListener("keydown", kd, true);
    }
    dfChiudi(ritorna) {
      const d = this._df;
      if (!d) return;
      this._df = null;
      window.removeEventListener("pointerdown", d.fuori, true);
      d.pop.remove();
      const a = d.anchor?.isConnected ? d.anchor : this.root.querySelector(`[data-df="${CSS.escape(d.ep)}"][data-dove="${CSS.escape(d.dove)}"]`);
      a?.setAttribute("aria-expanded", "false");
      if (ritorna) a?.focus();
      if (this._tdSolo === d.ep) {   // (la prima voce aggiunta lì: il blocco in cima compare — e il fuoco torna sull'icona rifatta)
        this.tdMetti();
        if (ritorna && !a?.isConnected) this.root.querySelector(`[data-df="${CSS.escape(d.ep)}"][data-dove="${CSS.escape(d.dove)}"]`)?.focus();
      }
    }
    // il pannello si è ridisegnato con la lista aperta: si riapre, uguale, sotto la sua icona
    dfRiattacca() {
      const d = this._df;
      if (!d || d.pop.isConnected) return;
      const scriveva = !this.root.activeElement && d.inFuoco;
      window.removeEventListener("pointerdown", d.fuori, true);
      this._df = null;
      const a = this.dfAncora(d.ep, d.dove);
      if (!a || (this.collapsed && d.dove !== "nota")) return;   // ridotta, solo quella aperta dalla nota sotto la pill
      this.dfApri(d.ep, a, { fuoco: scriveva, testo: d.testo || "" });
      const inp = scriveva && d.sel ? this.root.querySelector("#dfin") : null;
      if (inp) inp.setSelectionRange(...d.sel);
    }
    // sotto cosa si apre la lista di un paziente: la sua icona dove si vede
    // (quella chiesta, se c'è), se no il paziente nella stanza
    dfAncora(ep, dove = "") {
      const e = CSS.escape(ep), vede = (el) => !!el && el.getClientRects().length > 0;
      const ic = [...this.root.querySelectorAll(`[data-df="${e}"]`)].filter(vede);
      return ic.find((x) => x.getAttribute("data-dove") === dove) || ic[0]
        || [...this.root.querySelectorAll(`.stmap .stp[data-stp="${e}"]`)].find(vede) || null;
    }
    promChiudiMenu(ritorna) {
      const a = this._promMenu;
      if (!a) return;
      this._promMenu = null;
      clearTimeout(a.timer);
      window.removeEventListener("pointerdown", a.fuori, true);
      a.menu.remove();
      if (ritorna && a.anchor?.isConnected) a.anchor.focus();
    }

