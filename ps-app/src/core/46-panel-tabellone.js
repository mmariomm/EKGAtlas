//@frammento 46-panel-tabellone.js — Panel (segue): DA FARE sul tabellone, barra e viste del tabellone, la scheda al passaggio, i dimessi.
    // ===================================================== DA FARE · TABELLONE
    // Sul tabellone, sempre in vista (Mappa e Lista, ogni vista): il «Da fare»
    // generale — di nessun paziente — e sotto quello di ogni paziente, col
    // COGNOME davanti (una volta, all'inizio delle sue voci), nell'ordine del
    // tabellone (le aree, poi l'ordine del gestionale). Una colonna sola, una
    // riga per voce. Un tocco sul testo lo modifica, ✕ lo cancella, la spunta lo
    // fa; le voci dei pazienti sono quelle della loro lista (dafare.v1).
    // Accanto alle mappe quando c'è posto, sopra quando la finestra è stretta;
    // si riduce a una barra sottile, e se lo ricorda.
    tdOrdine(info) {
      const a = areeLeggi(), k = (i) => a.membri[i.p.ep]?.k || "", n = (i) => a.membri[i.p.ep]?.n, sa = (i) => Number.isInteger(n(i));
      const ingresso = (i) => i.p.arrivo || i.p.ts || 0, ord = (i) => (k(i) ? ordineArea(k(i)) : 1e3);
      return [...info.values()].filter((i) => !i.prec)
        .sort((x, y) => ord(x) - ord(y) || k(x).localeCompare(k(y)) || (sa(x) && sa(y) ? n(x) - n(y) : sa(y) - sa(x)) || ingresso(x) - ingresso(y))
        .map((i) => ({ ep: i.p.ep, chi: ((i.omonimo ? i.breve : cognomeTitolo(i.p.name)) || "paziente").toUpperCase() + (i.coda || "") }));
    }
    // la riga di sempre (dfRiga), col cognome a sinistra: scritto solo sulla prima del paziente
    tdVoce(x, ora, ep = "", chi = "", primo = false) {
      return `<li class="dfi tdi${x.fatto ? " fatto" : ""}${primo ? " tdg" : ""}" data-id="${esc(x.id)}"${ep ? ` data-tdep="${esc(ep)}"` : ""}>
        ${primo ? (this._tdTutto
          ? `<span class="tdchi tdtesta"><button type="button" class="tdapri" data-tdapri="${esc(ep)}" title="Apri ${esc(chi)}">${esc(chi)}${this._tdPosti?.get(ep) ? `<span class="tdposto">${esc(this._tdPosti.get(ep))}</span>` : ""}</button><button type="button" class="tdpiu" data-tdpiu="${esc(ep)}" data-chi="${esc(chi)}" title="+ nota per ${esc(chi)}" aria-label="+ nota per ${esc(chi)}">+</button></span>`
          : `<b class="tdchi">${esc(chi)}</b>`) : `<span class="tdchi" aria-hidden="true"></span>`}
        <button type="button" class="dfck" role="checkbox" aria-checked="${x.fatto ? "true" : "false"}" aria-label="${esc((chi ? chi + ": " : "") + x.testo)}"
          title="${x.fatto ? "Fatta: un tocco la riapre (se ne va fra 5 minuti)" : "Un tocco quando è fatta"}"></button>
        ${this.dfOra(x, ora)}<span class="dftx tdtx" data-tdmod role="button" tabindex="0" title="${esc(x.testo)}&#10;Tocca per modificare">${esc(x.testo)}</span>
        <button type="button" class="dfx" data-tdvia title="Cancella" aria-label="Cancella ${esc(x.testo)}">${CESTINO}</button>
      </li>`;
    }
    tdListe(tutti = dfTutti(), ora = Date.now()) {
      const solo = this._tdSolo, gen = solo ? [] : genTutte(ora), suoi = solo ? [{ ep: solo, chi: "" }] : this._tdOrdine || [];
      return {
        gen: gen.map((x) => this.tdVoce(x, ora)).join(""),
        paz: suoi.flatMap(({ ep, chi }) => dfDi(ep, tutti).map((x, i) => this.tdVoce(x, ora, ep, chi, !solo && i === 0))).join(""),
        aperte: gen.filter((x) => !x.fatto).length + suoi.reduce((n, { ep }) => n + dfAperte(ep, tutti).length, 0),
      };
    }
    tdHtml(T) {
      this._tdOrdine = this.tdOrdine(T.lista.info);
      this._tdPosti = new Map([...T.lista.info].map(([ep, i]) => [ep, this.nomePosto(T.lista, i) || ""]));
      const chiusa = !!store.get(TD_UI, null)?.chiusa, { gen, paz, aperte } = this.tdListe(T.lista.df);
      this._tdFirma = { gen, paz };
      return `<aside class="tdcard${chiusa ? " chiusa" : ""}" aria-label="Da fare">
        <div class="tdhd"><button type="button" class="tdtog" id="tdtog" aria-expanded="${!chiusa}" title="${chiusa ? "Mostra il Da fare" : "Riduci il Da fare a una barra"}">${
          ICO.dafare}<b>Da fare</b><span class="tdn">${aperte || ""}</span></button>${chiusa ? "" : `
          <input type="text" class="dfin tdin" id="tdin" maxlength="160" autocomplete="off" spellcheck="false" placeholder="Da fare generale…" value="${esc(this._tdTesto || "")}"
            aria-label="Aggiungi al Da fare generale (di nessun paziente)" title="Una cosa da fare di nessun paziente: Invio la aggiunge">`}</div>
        ${chiusa ? "" : `<div class="tdcorpo"><ul class="dfl tdl" data-tdl="gen" aria-label="Da fare generale">${gen}</ul><ul class="dfl tdl" data-tdl="paz" aria-label="Da fare dei pazienti">${paz}</ul></div>`}
      </aside>`;
    }
    // Sulla scheda del paziente, in cima (sotto le allergie, sopra le schede):
    // i suoi Da fare come nella lista dei Pazienti — la spunta tonda, l'ora,
    // il testo, ✕ — e il campo per aggiungerne uno a lui. Ridotto, una barra.
    // Senza voci, niente: basta l'icona nell'intestazione.
    tdPazHtml(ep) {
      const { paz, aperte } = this.tdListe();
      this._tdFirma = { gen: "", paz };
      if (!paz) return "";
      const chiusa = !!store.get(TD_PAZ, null)?.chiusa, chi = nomeCorto(this.nomePaziente() || "") || "lui";
      return `<aside class="tdcard solo${chiusa ? " chiusa" : ""}" aria-label="Da fare di ${esc(chi)}">
        <div class="tdhd"><button type="button" class="tdtog" id="tdtog" aria-expanded="${!chiusa}" title="${chiusa ? "Mostra il Da fare" : "Riduci il Da fare a una barra"}">${
          ICO.dafare}<b>Da fare</b><span class="tdn">${aperte || ""}</span></button>${chiusa ? "" : `
          <input type="text" class="dfin tdin" id="tdin" maxlength="160" autocomplete="off" spellcheck="false" placeholder="+ nota per ${esc(chi.replace(/\.$/, ""))}…" value="${esc(this._tdTesto || "")}"
            aria-label="Nuova nota per ${esc(chi)}" title="Una cosa da fare per ${esc(chi)}: Invio la aggiunge (con un'ora, «16:30 …» o «tra 30 min …»)">`}</div>
        ${chiusa ? "" : `<div class="tdcorpo"><ul class="dfl tdl" data-tdl="paz" aria-label="Da fare di ${esc(chi)}">${paz}</ul></div>`}
      </aside>`;
    }
    // rifatte SUL POSTO (un gesto, il tempo che passa, un'altra scheda): niente
    // ridisegno, il campo resta com'è; mai sotto una modifica in corso
    tdMetti(tutti = dfTutti(), ora = Date.now()) {
      const c = this.root.querySelector(".tdcard");
      // sul paziente il blocco c'è solo con delle voci: la prima arrivata (o l'ultima andata) lo rifà, se nessuno sta scrivendo
      if (this._tdSolo && !!c !== dfDi(this._tdSolo, tutti).length > 0) {
        const a = this.root.activeElement, scrive = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
        if (!scrive && !this._df?.pop?.isConnected) this.render();
        return;
      }
      if (!c || c.querySelector(".dfmod")) return;
      const { gen, paz, aperte } = this.tdListe(tutti, ora);
      const f = this.root.activeElement?.closest?.(".tdi"), fid = f && [f.getAttribute("data-id"), f.getAttribute("data-tdep") || ""];
      for (const [ul, html] of [[c.querySelector('[data-tdl="gen"]'), gen], [c.querySelector('[data-tdl="paz"]'), paz]]) {
        if (ul && ul._firma !== html) { ul.innerHTML = html; ul._firma = html; }
      }
      const n = c.querySelector(".tdn");
      this._tdFirma = { gen, paz };
      if (n) n.textContent = aperte || "";
      if (fid && !this.root.activeElement?.closest?.(".tdi")) {
        const li = [...c.querySelectorAll(".tdi")].find((x) => x.getAttribute("data-id") === fid[0] && (x.getAttribute("data-tdep") || "") === fid[1]);
        (li?.querySelector(".dfck") || c.querySelector("#tdin"))?.focus({ preventScroll: true });
      }
    }
    tdLega() {
      const c = this.root.querySelector(".tdcard");
      if (!c) return;
      const g = c.querySelector('[data-tdl="gen"]'), pz = c.querySelector('[data-tdl="paz"]');
      if (g) g._firma = this._tdFirma?.gen;
      if (pz) pz._firma = this._tdFirma?.paz;
      const inp = c.querySelector("#tdin");
      if (inp && this._tdFuoco) { inp.focus({ preventScroll: true }); inp.setSelectionRange(...this._tdFuoco); }
      this._tdFuoco = null;
      inp?.addEventListener("input", () => { this._tdTesto = inp.value; inp.classList.remove("ko"); });
      inp?.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && inp.value) { e.preventDefault(); e.stopPropagation(); inp.value = this._tdTesto = ""; return; }
        if (e.key !== "Enter" || !inp.value.trim()) return;
        e.preventDefault();
        const solo = this._tdSolo || this._tdPer;
        if (!(solo ? dfAggiungi(solo, inp.value) : genAggiungi(inp.value))) { inp.classList.add("ko"); return; }
        inp.value = this._tdTesto = "";
        if (this._tdPer) { this._tdPer = null; inp.placeholder = "Da fare generale…"; }
        this.tdMetti();
        if (solo) this.dfMetti(solo);
      });
      const voce = (el) => { const li = el.closest(".tdi"); return li ? { id: li.getAttribute("data-id"), ep: li.getAttribute("data-tdep") || "" } : null; };
      // una voce di un paziente cambiata qui: anche la sua icona, il post-it, la sua lista aperta
      const dopo = (v) => { this.tdMetti(); if (v.ep) { this.dfMetti(v.ep); if (this._df?.ep === v.ep) this.dfLista(); } };
      const modifica = (mod) => {
        const v = voce(mod);
        if (v) this.modificaVoce(mod, (t) => { if (t != null) { if (v.ep) dfCambia(v.ep, v.id, t); else genTesto(v.id, t); } dopo(v); });
      };
      const K = this._tdSolo ? TD_PAZ : TD_UI;
      const apriChiudi = () => { store.set(K, { ...(store.get(K, null) || {}), chiusa: !store.get(K, null)?.chiusa }); this.render(); };
      this.root.querySelector(".tdtogb")?.addEventListener("click", apriChiudi);
      c.addEventListener("click", (e) => {
        if (e.target.closest("#tdtog")) return apriChiudi();
        // («Da fare»: il cognome apre il paziente; «+» scrive la prossima nota per lui, nello stesso campo)
        const apri = e.target.closest("[data-tdapri]"), piu = e.target.closest("[data-tdpiu]");
        if (apri) return this.apriPaziente(apri.getAttribute("data-tdapri"));
        if (piu && inp) { this._tdPer = piu.getAttribute("data-tdpiu"); inp.placeholder = `+ nota per ${piu.getAttribute("data-chi")}…`; inp.focus(); return; }
        const ck = e.target.closest(".dfck"), via = e.target.closest("[data-tdvia]"), mod = e.target.closest("[data-tdmod]");
        const v = voce(ck || via || mod || c);
        if (!v) return;
        if (ck) {
          const si = ck.getAttribute("aria-checked") !== "true";
          if (v.ep) dfSpunta(v.ep, v.id, si); else genSpunta(v.id, si);
          dopo(v);
        } else if (via) {
          if (v.ep) dfTogli(v.ep, v.id); else genTogli(v.id);
          dopo(v);
        } else if (mod) modifica(mod);
      });
      c.addEventListener("keydown", (e) => {
        const mod = e.target.closest?.("[data-tdmod]");
        if (mod && e.target === mod && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); modifica(mod); }
      });
    }
    // Alta | Bassa | Entrambe, e il ⟳ che rilegge subito la lista smart
    tabelloneBarra() {
      const v = this.vistaTab(), s = store.get(SMART_SYNC, null) || {};
      const gira = !!s.ts && !s.fine && Date.now() - s.ts < 45e3;
      const m = this.modoTab();
      return `<div class="tbbar"><div class="tbseg" role="radiogroup" aria-label="Mappe">${VISTE.map((x) => `<button type="button" role="radio" data-vista="${x}" aria-checked="${x === v}"${
        x === v ? ' class="on"' : ""}>${NOME_VISTA[x]}</button>`).join("")}</div><div class="tbseg" role="radiogroup" aria-label="Mappa o lista">${MODI.map((x) => `<button type="button" role="radio" data-modo="${x}" aria-checked="${x === m}"${
        x === m ? ' class="on"' : ""}>${NOME_MODO[x]}</button>`).join("")}</div><button type="button" class="tbsync" id="tbcerca" title="Cerca un paziente — o scrivi e basta" aria-label="Cerca un paziente"${
        this._filtro != null ? ' aria-pressed="true"' : ""}>${ICO.cerca}</button>${hasExt() ? `<button type="button" class="tbsync${gira ? " gira" : ""}" id="tbsync" title="Rileggi adesso la lista smart del gestionale${
        s.fine && s.esito === "ok" ? ` (l'ultima: ${hhmm(s.fine)})` : ""}" aria-label="Aggiorna dal gestionale">${ICO.aggiorna}</button>` : ""}${
        store.get(TD_UI, null)?.chiusa ? `<button type="button" class="tdtog tdtogb" aria-expanded="false" title="Mostra il Da fare">${ICO.dafare}<b>Da fare</b></button>` : ""}</div>`;
    }
    // Quale vista: quella scelta dal medico; finché non ne ha scelta una,
    // quella dell'area in cui lavora.
    vistaTab() {
      const v = store.get(VISTA, null);
      return VISTE.includes(v) ? v : mappaDiArea(store.get(AREA_ORA, null)?.k) === "alta" ? "alta" : "bassa";
    }
    // Mappa (le mappe, e sotto chi non ha un posto) o Lista (tutti, senza mappe).
    // In Modifica la mappa serve: si vede, e finito si torna a com'era.
    modoTab() {
      const m = store.get(MODO, null);
      return !this.stanzaEdit && (m === "lista" || m === "dafare") ? m : "mappa";
    }
    // le mappe che si vedono (in Modifica, una sola: quella che si ritocca)
    mappeVisibili() {
      if (this.stanzaEdit) return [MAPPE[this._mappaEdit] ? this._mappaEdit : MAPPA_DI_VISTA[this.vistaTab()] || mappaDiArea(store.get(AREA_ORA, null)?.k)];
      const v = this.vistaTab();
      return v === "entrambe" ? ["alta", "ps"] : [MAPPA_DI_VISTA[v]];
    }
    conMappa(k, fn) {
      const prima = this._mk;
      this._mk = k;
      try { return fn(); } finally { this._mk = prima; }
    }
    // Il modello del tabellone: una mappa per mappa visibile, e la lista (chi
    // è nella vista: l'area e il triage) col posto, in qualunque mappa.
    // Un paziente sta in un posto solo: se due mappe lo dicono, vale l'ultimo.
    pazTabellone() {
      const ks = this.mappeVisibili(), per = new Map(ks.map((k) => [k, this.conMappa(k, () => this.pazModello())]));
      const base = per.get(ks[0]), info = new Map();
      for (const [ep, i] of base.info) info.set(ep, { ...i, posto: null, mk: "" });
      for (const k of Object.keys(MAPPE)) {
        const raw = store.get(MAPPE[k].posti, {}), m = per.get(k);
        for (const [ep, j] of info) {
          const v = m ? m.posti[ep] : raw && typeof raw === "object" && !j.prec ? raw[ep] : null;
          if (v && (!j.posto || (v.ts || 0) > (j.posto.ts || 0))) { j.posto = v; j.mk = k; }
        }
      }
      for (const [k, m] of per) for (const [ep, i] of m.info) {
        if (!i.posto || info.get(ep)?.mk === k) continue;
        if (i.posto.tipo === "letto" && m.perLetto[i.posto.id] === ep) delete m.perLetto[i.posto.id];
        delete m.posti[ep];
        i.posto = null;
      }
      const v = this.vistaTab(), a = areeLeggi();
      for (const j of info.values()) {
        const k = a.membri[j.p.ep]?.k || "";
        j.area = k;
        j.ignoto = triageIgnoto(k, j.p.triage);
        j.vista = v === "entrambe" || tabelloniDi(k, j.p.triage).includes(v) || (!!j.posto && MAPPE[j.mk]?.vista === v);
      }
      return { ks, per, lista: { ...base, info, nomeDi: (i) => this.nomePostoIn(i) } };
    }
    // il nome del posto, in qualunque mappa
    nomePostoIn(i) {
      if (!i || !i.posto || !MAPPE[i.mk]) return "";
      const sala = this.conMappa(i.mk, () => this.stanzaSala());
      return (i.posto.tipo === "letto" ? sala.letti : sala.aree).find((o) => o.id === i.posto.id)?.nome || "";
    }
    // Un tocco sulla scelta: si ricorda (un'impostazione di questo browser)
    sceglieVista(v) {
      if (!VISTE.includes(v)) return;
      store.set(VISTA, v);
      this.render();
    }
    sceglieModo(m) {
      if (!MODI.includes(m)) return;
      store.set(MODO, m);
      this.render();
    }
    // Quello che un'altra scheda (la smart dietro, un'altra lista) ha scritto:
    // si ridisegna — ma non sotto un gesto in corso; ci si riprova fra poco.
    aggiornaDaFuori() {
      clearTimeout(this._fuoriT);
      // (ridotto: solo la scritta delle novità sulla pill — visti altrove, sul telefono o in un'altra
      // scheda, si spengono anche qui; il resto del pannello non si ridisegna)
      if (this.collapsed) {
        const v = this.root.querySelector("#expand .pnov");
        if (v) { const t = this.pillNovita(); if (t) v.outerHTML = t; else v.remove(); }
        return;
      }
      if (!this.inPazienti()) return;
      const occupato = this._stanzaPresa || this._stanzaMenu?.menu?.isConnected || this._df?.pop?.isConnected || this.stanzaEdit || this.menuAperto || this._carta
        || this.root.activeElement?.id === "pzcerca" || !!this.root.querySelector(".dfmod");   // (il campo del Da fare generale sopravvive al ridisegno: non ferma niente)
      if (occupato) { this._fuoriT = setTimeout(() => this.aggiornaDaFuori(), 3000); return; }
      this.cartaChiudi();
      this.render();
    }
    // ------------------------------------------------- la scheda al passaggio
    // Passando col mouse sul NOME (nella riga) o sul letto, dopo un quarto di
    // secondo: chi è, dov'è, da quanto è in PS; il cuore coi parametri fuori
    // norma; i valori fuori range; ECG e RX (lo stato, e le prime parole del
    // referto scritto). Solo da leggere: non prende il mouse, il clic arriva
    // sotto. Non copre mai il suo letto. Si chiude uscendo.
    // La riga e il letto dello stesso paziente si accendono insieme.
    cartaLega(box) {
      const bersaglio = (e) => {
        if (this.stanzaEdit || this._stanzaPresa) return null;
        const letto = e.target.closest?.(".stbed.occ, .starbody .stp[data-stp]");
        if (letto?.matches(".ospite, .stbed:has(.ospite)")) return null;   // (chi è al triage: niente scheda, ha solo il nome)
        if (letto) { const ep = letto.getAttribute("data-occep") || letto.getAttribute("data-stp"); return ep ? { ep, el: letto, carta: true } : null; }
        const riga = e.target.closest?.(".pzrow[data-pz]");
        if (!riga) return null;
        const nm = riga.querySelector(".pznm"), r = nm?.getBoundingClientRect();
        const sulNome = !!r && e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4;
        return { ep: riga.getAttribute("data-pz"), el: riga, carta: sulNome };
      };
      box.addEventListener("pointermove", (e) => {
        if (e.pointerType && e.pointerType !== "mouse") return;
        const b = bersaglio(e), cur = this._carta;
        if (b && cur && cur.ep === b.ep && cur.el === b.el && cur.carta === b.carta) return;
        this.cartaChiudi();
        if (!b) return;
        this.cartaLegaAccendi(b.ep, true);
        this._carta = { ...b, t: b.carta ? setTimeout(() => this.cartaApri(), 250) : 0 };
      });
      box.addEventListener("pointerleave", () => this.cartaChiudi());
      box.addEventListener("pointerdown", () => this.cartaChiudi(), true);
    }
    cartaLegaAccendi(ep, si) {
      for (const el of this.root.querySelectorAll(".lega")) el.classList.remove("lega");
      if (!si || !ep) return;
      const e = CSS.escape(ep);
      for (const el of this.root.querySelectorAll(`.pzrow[data-pz="${e}"], .stbed[data-occep="${e}"], .starbody .stp[data-stp="${e}"]`)) el.classList.add("lega");
    }
    cartaChiudi() {
      const c = this._carta;
      this._carta = null;
      if (c) clearTimeout(c.t);
      c?.box?.remove();
      this.root?.querySelector(".pzcarta")?.remove();
      this.cartaLegaAccendi(null, false);
    }
    cartaApri() {
      const c = this._carta, wrap = this.root.querySelector(".wrap");
      if (!c || !wrap || !c.el.isConnected) return;
      const p = tuttiPazienti().find((x) => x.ep === c.ep);
      if (!p) return;
      wrap.insertAdjacentHTML("beforeend", `<div class="pzcarta" role="tooltip">${this.cartaHtml(p)}</div>`);
      c.box = wrap.lastElementChild;
      this.cartaPosa(c.box, c.el, c.el.classList.contains("pzrow"));
      // i valori e i referti scritti stanno nella scheda clinica (estensione): arrivano dopo
      this.cartaStorico(p).then((dati) => {
        if (this._carta !== c || !c.box?.isConnected || !dati) return;
        const altro = this.cartaDaStorico(p, dati);
        if (!altro) return;
        c.box.innerHTML = this.cartaHtml(p, altro);
        this.cartaPosa(c.box, c.el, c.el.classList.contains("pzrow"));
      }).catch(() => {});
    }
    // fuori dal suo letto (a destra, a sinistra, sotto, sopra), o sotto/sopra la riga; sempre nella finestra
    cartaPosa(box, el, riga) {
      const wr = this.root.querySelector(".wrap").getBoundingClientRect(), ar = el.getBoundingClientRect();
      const w = box.offsetWidth, h = box.offsetHeight, g = 8, W = innerWidth, H = innerHeight;
      const lim = (v, a, b) => Math.max(a, Math.min(b, v));
      const prove = [
        ...(riga ? [] : [{ x: ar.right + g, y: lim(ar.top, g, H - h - g), ok: ar.right + g + w <= W - g },
          { x: ar.left - g - w, y: lim(ar.top, g, H - h - g), ok: ar.left - g - w >= g }]),
        { x: lim(riga ? ar.left + 24 : ar.left, g, W - w - g), y: ar.bottom + g, ok: ar.bottom + g + h <= H - g },
        { x: lim(riga ? ar.left + 24 : ar.left, g, W - w - g), y: ar.top - g - h, ok: ar.top - g - h >= g },
      ];
      const p = prove.find((x) => x.ok) || prove[prove.length - 1];
      box.style.left = p.x - wr.left + "px";
      box.style.top = p.y - wr.top + "px";
    }
    // la scheda clinica di questo paziente (la stessa regola d'identità degli Esiti e del Ponte)
    async cartaStorico(p) {
      if (!hasExt()) return null;
      const cache = (this._cartaCache = this._cartaCache || new Map()), c = cache.get(p.ep);
      if (c && Date.now() - c.ts < 30e3) return c.dati;
      const r = await ask({ t: "getStorico" });
      const mio = String(p.pk || "").startsWith("cf:") ? p.pk.slice(3) : "";
      const scelta = scegliScheda((r && r.ok && r.indice) || [], mio, p.name, p.ep);
      const x = scelta ? await ask({ t: "getStorico", chiave: scelta.chiave }) : null;
      const dati = x && x.ok ? x.dati : null;
      cache.set(p.ep, { ts: Date.now(), dati });
      return dati;
    }
    // Dalla scheda clinica, solo quello di QUESTO passaggio in PS (dall'ingresso,
    // o dalle ultime 24 ore): i valori fuori range dell'ultimo prelievo di
    // ciascun esame, e i referti di ECG e RX col loro testo.
    cartaDaStorico(p, dati) {
      const da = p.arrivo || Date.now() - 24 * 3600e3, dd = new Date(da);
      const lim = Date.UTC(dd.getFullYear(), dd.getMonth(), dd.getDate(), dd.getHours(), dd.getMinutes());
      let lab = [];
      const st = dati && dati.righe && dati.righe.length ? normalizzaStorico(dati) : null;
      if (st) {
        const tieni = st.date.map((d, i) => [d, i]).filter(([d]) => !d.ignota && ordData(d.label) >= lim).map(([, i]) => i);
        if (tieni.length) lab = fuoriRangeUltimi({ ...st, date: tieni.map((i) => st.date[i]), righe: st.righe.map((r) => ({ ...r, valori: tieni.map((i) => r.valori[i]) })) });
      }
      const referti = ((dati && dati.referti) || []).map((x) => ({ ...x, t: arrivoDa(x.quando) })).filter((x) => x.t && x.t >= da - 60e3 && x.testo)
        .map((x) => ({ ...x, tipo: refertoTipo({ label: x.titolo, sistema: x.sistema }) })).filter((x) => x.tipo === "ecg" || x.tipo === "rx")
        .sort((a, b) => b.t - a.t);
      return lab.length || referti.length ? { lab, referti } : null;
    }
    cartaHtml(p, altro = null) {
      const ora = Date.now(), posto = this.postoDi(p.ep), st = statoEsami(statoDi(p.ep), ora);
      const tr = p.triage ? " t-" + p.triage.toLowerCase() : "";
      const prime = (testo) => {
        const w = anteprimaReferto(String(testo || "").split("\n")).split(/\s+/).filter(Boolean);
        return w.length ? `${w.slice(0, 9).join(" ")}${w.length > 9 ? "…" : ""}` : "";
      };
      const riga = (cls, html) => `<div class="pc ${cls}">${html}</div>`;
      const out = [riga("pc1", `<i class="pztr${tr}" aria-hidden="true"></i><b>${esc(p.name || "paziente")}</b>${
        [Number.isInteger(p.eta) ? String(p.eta) : "", p.sesso || ""].filter(Boolean).length ? ` ${esc([Number.isInteger(p.eta) ? p.eta : "", p.sesso || ""].filter((x) => x !== "").join(" "))}` : ""}${
        posto ? ` · ${esc(posto)}` : ""}${p.arrivo ? ` · ${attesaTesto(minDa(p.arrivo, ora))}` : ""}`)];
      // le cose da fare (la prima è la nota), tutte quelle aperte
      const df = dfAperte(p.ep);
      if (df.length) out.push(`<div class="pcd" aria-label="Da fare">${df.slice(0, 8).map((x) => this.dfRiga(x, ora)).join("")}${
        df.length > 8 ? `<span class="dfpiun">+${df.length - 8}</span>` : ""}</div>`);
      const c = cuoreDi(statoDi(p.ep)?.vit, ora);
      if (c) out.push(riga("pcv", `<span class="cuore ${c.livello}${c.vecchio ? " vecchio" : ""}" aria-hidden="true">${c.vecchio ? "♡" : "♥"}</span> NEWS ${c.punti}${
        c.fuori.length ? " · " + esc(c.fuori.join(" · ")) : ""}${c.vecchio ? ` · ${c.ore}h fa` : ""}`));
      if (altro && altro.lab.length) out.push(riga("pcl", altro.lab.slice(0, 8).map((x) => `<span><b>${esc(x.sigla)}</b> ${esc(x.v)}${x.stato < 0 ? "↓" : "↑"}</span>`).join(" ")));
      // ECG e RX: lo stato dalla pagina del paziente, il testo dal referto letto
      const esami = st ? st.esami : [], ref = altro ? altro.referti : [];
      // in attesa: da quanto, in ambra (senza l'orologio ⏳: i minuti lo dicono già)
      const attesa = (e) => ` <span class="pcatt">${e && e.ts ? attesaTesto(minDa(e.ts, ora)) : "in attesa"}</span>`;
      const ecg = esami.filter((e) => e.tipo === "ecg"), rEcg = ref.find((x) => x.tipo === "ecg");
      if (ecg.length || rEcg) {
        const aspetta = ecg.filter((e) => !e.fatto).sort((a, b) => (a.ts || 0) - (b.ts || 0))[0];
        out.push(riga("pce", rEcg || ecg.some((e) => e.fatto)
          ? `<b>ECG</b> ✓${rEcg ? ` ${hhmm(rEcg.t)} <q>${esc(prime(rEcg.testo))}</q>` : ""}${aspetta ? ` ·${attesa(aspetta)}` : ""}`
          : `<b>ECG</b>${attesa(aspetta)}`));
      }
      const img = esami.filter((e) => e.tipo === "img"), rRx = ref.filter((x) => x.tipo === "rx");
      for (const e of img.filter((x) => !x.fatto)) out.push(riga("pcr", `<b>${esc(frase(e.label))}</b>${attesa(e)}`));
      if (rRx.length) for (const x of rRx.slice(0, 3)) out.push(riga("pcr", `<b>${esc(frase(x.titolo))}</b> ✓ <q>${esc(prime(x.testo))}</q>`));
      else for (const e of img.filter((x) => x.fatto)) out.push(riga("pcr", `<b>${esc(frase(e.label))}</b> ✓`));
      return out.join("");
    }
    // «ROSSI M. dimesso · Annulla», per 8 secondi, dove il medico guarda
    mostraDimessi(avvio) {
      const rec = store.get(DIMESSI, null);
      if (!rec || !Array.isArray(rec.eps) || !rec.eps.length || rec.id === this._dimessiVisto) return;
      const resta = (rec.ts || 0) + DIMESSI_MS - Date.now();
      if (resta <= 0) return;
      this._dimessiVisto = rec.id;
      clearTimeout(this._stanzaAnnT);
      const nomi = (rec.nomi || []).filter(Boolean);
      this._stanzaAnn = { testo: `${nomi.join(", ") || "Un paziente"} ${nomi.length > 1 ? "dimessi" : "dimesso"}`, foto: () => annullaDimessi(rec), fino: Date.now() + resta };
      this._stanzaAnnT = setTimeout(() => { this._stanzaAnn = null; this.root.querySelector(".stsnack")?.remove(); }, resta);
      if (!avvio) this.render();
    }

