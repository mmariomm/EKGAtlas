//@frammento 53-panel-finestra.js — Panel (fine): viewRunning/viewResult, riduci/apri, forma, drag/resize, bind() degli eventi, launch;
//@ qui si chiude la classe.
    viewRunning() {
      const steps = this.runData?.steps || [];
      const total = steps.length;
      const doneN = steps.filter((s) => s.status === "ok").length;
      const stepHtml = steps.map((s) => `
        <div class="step ${esc(s.status === "pending" ? "" : s.status)}">
          <span class="ic">${s.status === "ok" ? "✓" : s.status === "running" ? "⟳" : s.status === "fail" ? "✕" : s.status === "skipped" ? "–" : "·"}</span>
          <span>${esc(s.label)}</span><small>${esc(s.note || "")}</small>
        </div>`).join("");
      const qui = nomeInPagina();
      return `
        ${this.runPatient && qui && qui !== this.runPatient ? `<div class="banner warn">Stai guardando <b>${esc(qui)}</b>: questi esami sono di <b>${esc(this.runPatient)}</b> e vanno alla sua richiesta.</div>` : ""}
        <div class="sec"><div class="lbl">In corso — passo ${Math.min(doneN + 1, total)} di ${total}</div><div class="steps">${stepHtml}</div></div>
        <details class="reg" open><summary>Registro <button class="mini" id="copylog" title="Copia il registro negli appunti (il quesito viene omesso)">⧉ Copia</button></summary><div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div></details>
        <div class="commit">
          <button class="btn stop" id="stopbtn">⏹ INTERROMPI</button>
  
        </div>
      `;
    }

    // Il resoconto, corto: il motivo, gli elenchi che servono per finire
    // (Mancano / Da controllare / Nel carrello) e un'azione sola — «↻ Riprova
    // i mancanti» o «Apri il carrello» — più «Chiudi». I passi e il Registro
    // stanno insieme sotto «Dettagli», chiuso: si aprono quando servono.
    viewResult() {
      const ok = this.runState === "done";
      const cls = ok ? "ok" : this.runState === "stopped" ? "warn" : "err";
      const m = this.message || {};
      const head = typeof m === "string" ? "" : m.head;
      const bodyTxt = typeof m === "string" ? m : m.body;
      const steps = (this.runData?.steps || []).map((s) => `
        <div class="step ${esc(s.status === "pending" ? "" : s.status)}">
          <span class="ic">${s.status === "ok" ? "✓" : s.status === "fail" ? "✕" : s.status === "skipped" ? "–" : "·"}</span>
          <span>${esc(s.label)}</span><small>${esc(s.note || "")}</small>
        </div>`).join("");
      const listUrl = this.runData?.finishedListUrl || this.runData?.lastListUrl;
      // già sul carrello di quella richiesta (ci ha portato l'errore): niente bottone per andarci
      const giaQui = !!listUrl && this.pageType === "exam" && param(listUrl, "RICHIESTA_ID") === param(location.href, "RICHIESTA_ID");
      // dopo un errore: rifare i mancanti si può solo dov'è sicuro (riprovaQui)
      const riprova = this.riprovaQui() ? this.riprova.mancanti.length : 0;
      // un errore si chiude; un giro che riprenderà da solo no (lì resta «Torna al pannello»)
      const chiudi = this.runState === "fail" && !tabStore.get(CORSA, null);
      // quale quesito è partito, in una riga (giro riuscito)
      const qd = ok ? quesitoDetto(this.runData?.quesito) : "";
      // Fermato a metà: che cosa manca, che cosa va guardato e che cosa c'è
      // già in carrello — l'elenco che serve per finire.
      const nel = (typeof m === "object" && m.nel) || [], mancano = (typeof m === "object" && m.mancano) || [];
      const controllare = (typeof m === "object" && m.controllare) || [];
      const gruppo = (lbl, chips, extra = "") => chips.length
        ? `<div class="sec"><div class="lbl">${lbl} (${chips.length})</div><div class="chips">${chips.join("")}</div>${extra}</div>` : "";
      const nomi = (l, c) => l.map((x) => `<span class="chip ${c}">${esc(x)}</span>`);
      const alPosto = (x) => (x.alPostoDi ? `<small class="alposto">al posto di ${esc(x.alPostoDi)}</small>` : "");
      const liste = ok
        ? gruppo("Nel carrello", (this.runData?.addedTutti || this.runData?.added || []).map((x) => `<span class="chip nel">${esc(x.display || shortLabel(x.label))}${alPosto(x)}</span>`))
        : gruppo("Mancano", nomi(mancano, "manca"))
          + gruppo("Da controllare", nomi(controllare, "controlla"), `<div class="hint">${riprova
            ? "Mandati, ma non visti in carrello: «Riprova» non li rimanda — guardali nel carrello prima."
            : "Mandati, ma non visti in carrello: guarda se ci sono prima di aggiungerli — mai due volte."}</div>`)
          + gruppo("Nel carrello", nomi(nel, "nel"));
      return `
        <div class="banner ${cls}">${head ? `<b>${esc(head)}</b>` : ""}${esc(bodyTxt || "")}${qd ? `<span class="qline">${esc(qd)}</span>` : ""}</div>
        ${liste}
        <details class="dett"><summary>Dettagli</summary>
          <div class="steps">${steps}</div>
          <div class="reghd">Registro <button class="mini" id="copylog" title="Copia il registro negli appunti (il quesito viene omesso)">⧉ Copia</button></div>
          <div class="log" aria-live="polite">${esc(this.logLines.join("\n"))}</div>
        </details>
        <div class="commit">
          ${riprova ? `<button class="btn primary" id="riprova" title="${this.riprova.rid
            ? "Manda solo gli esami mai partiti, in questa stessa richiesta: quelli già in carrello non si rimandano"
            : "Nessuna richiesta era nata: rifà il giro da capo, con gli stessi esami"}">↻ Riprova i mancanti (${riprova})</button>`
            : (listUrl || this.carrelloDaAprire) && !giaQui && (!ok || this.runRipreso || this.carrelloDaAprire) ? `<button class="btn primary" id="openlist">${
            ok ? "Apri il carrello" : "Apri il carrello e controlla"}</button>` : ""}
          ${this.svuotaQui() ? `<button class="btn ghost${this._svuota?.ok ? " armato" : ""}" id="svuota" ${this._svuota && !this._svuota.ok ? "disabled" : ""} title="Toglie dal carrello tutti gli esami di questa richiesta col «Svuota carrello» del gestionale, controlla che sia vuoto e rimette tutto: la selezione e quello che c'era già">${esc(this._svuota?.testo || "Svuota il carrello e ricomincia")}</button>` : ""}
          ${chiudi ? `<button class="btn ghost" id="chiudi" title="Chiude il resoconto e torna alle Richieste: restano scelti solo gli esami che mancano. La richiesta a metà resta da confermare.">Chiudi</button>`
            : `<button class="btn ghost" id="reset">Torna al pannello</button>`}
        </div>
      `;
    }

    // Ridurre alla pill e riaprire. Ridurre chiude anche il menu e la
    // Modifica della stanza; il fuoco va sulla pill (e al riaprire sul titolo),
    // così la tastiera non finisce nel gestionale coperto.
    // (`fuoco: false`: chi chiude o apre non è il medico — il mouse che passa —
    // e la tastiera resta dov'è: magari in un campo del gestionale)
    riduci({ fuoco = true } = {}) {
      if (this.collapsed || TABELLONE) return;
      this.collapsed = true; this.menuAperto = false; this.stanzaEdit = false;
      this.fissata = true; clearTimeout(this._tChiude); this._tChiude = 0;
      this._ridottaAlle = fuoco ? Date.now() : 0;   // ridotta da un gesto (—, Esc, un clic fuori): la pill che ricompare sotto il mouse fermo non si riapre da sola
      store.set("collapsed", true);
      // la striscia di un ordine in sottofondo torna subito, non al prossimo aggiornamento
      if (!LAVORO && this.ordini.length) { this._firmaOrdine = ""; this.stripOrdine(); }
      this.render();
      if (fuoco) this.root.querySelector("#expand")?.focus({ preventScroll: true });
    }
    apri({ passaggio = false } = {}) {
      this.collapsed = false; this.avvisoPill = "";
      this.fissata = !passaggio;
      clearTimeout(this._tApre); this._tChiude = 0;
      // aperta la finestra, la striscia ha detto quello che doveva (quella di
      // un ordine o di una ricetta no: resta, come chip in intestazione)
      if (this.striscia && !this.striscia.onTap && !this.striscia.daOrdine && !this.striscia.daRicetta) { clearTimeout(this._tStriscia); this.striscia = null; }
      store.set("collapsed", false);
      this.render();
      if (!passaggio) this.root.querySelector(".card")?.focus({ preventScroll: true });   // la tastiera nel pannello, non nel gestionale coperto
    }
    // Al passaggio, il mouse è uscito da mezzo secondo: si richiude — ma non
    // sotto le dita del medico. Un campo del pannello col cursore dentro o con
    // del testo non ancora mandato, esami scelti, un ordine in partenza, un
    // trascinamento: resta aperta, e si riguarda fra poco.
    tieneAperto() {
      if (this.fissata || this._premuto || this._stanzaPresa || this.selected.size || this.runState === "running" || this._delegando) return true;
      // un menu o una lista aperti (⋯, «Da fare», «Sposta in…», la sveglia), la Modifica della stanza, una
      // domanda a due tocchi (il reset, lo svuota carrello), un giro andato storto o fermato, una conferma in coda
      if (this.menuAperto || this.stanzaEdit || this._dfPresa || this._df?.pop?.isConnected || this._promMenu?.menu?.isConnected || this._stanzaMenu?.menu?.isConnected) return true;
      // la pagina dell'iPhone: il mouse dentro la cornice non si vede da qui, e
      // col QR davanti la mano va al telefono — si chiude con un clic fuori, — o Esc
      if (this.view === "iphone") return true;
      if (this.resetArmato() || this._svuota || (this.runState && this.runState !== "done") || this.pending?.next) return true;
      if (String(this._tdTesto || "").trim() || String(this._filtro || "").trim()) return true;   // il Da fare del tabellone, il filtro a metà
      if (document.getElementById("psassist-confirm") || document.getElementById("psassist-print") || document.getElementById("psassist-visore")) return true;
      if ((this.quesitoMio && String(this._q || "").trim()) || String(this.acq || "").trim()) return true;   // un quesito scritto, una ricerca a metà
      const campo = (el) => !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !NON_SCRITTURA.test(el.type || "")));
      if (campo(this.root.activeElement)) return true;
      return [...this.root.querySelectorAll("textarea, input")].some((el) => campo(el) && el.value.trim() && el.value !== el.defaultValue);
    }
    passaggioChiude() {
      this._tChiude = 0;
      if (formaOra() !== "passaggio" || this.collapsed || this.fissata) return;
      if (this.tieneAperto()) { this._tChiude = setTimeout(() => this.passaggioChiude(), PASSAGGIO_CHIUDE_MS); return; }
      this.riduci({ fuoco: false });
    }
    // La forma si sceglie in Impostazioni (portale.html): `forma` in
    // chrome.storage.local, copiata qui nella memoria del gestionale, che il
    // disegno legge. Affianca mette la finestra nella colonna a destra; Al
    // passaggio la rimette al centro, se era lì. Finché in Impostazioni non
    // c'è una scelta, si scrive quella di qui (anche quella migrata dalla
    // Finestra): la pagina mostra la forma com'è. (Solo il gestionale: sul
    // portale, un'altra origine con una memoria sua, il pannello non c'è.)
    seguiForma() {
      const metti = (f) => {
        if (TABELLONE || !FORME_PANNELLO.includes(f) || f === formaOra()) return;
        store.set(FORMA, f);
        if (f === "affianca") this.win = { ...AFFIANCA };
        else if (eAffiancata(this.win)) this.win = null;
        store.set("win.v1", this.win);
        this.fissata = true;
        clearTimeout(this._tChiude); this._tChiude = 0;
        this.render();
      };
      try {
        chrome.storage.local.get("forma").then((o) => {
          if (FORME_PANNELLO.includes(o.forma)) metti(o.forma);
          else if (!TABELLONE) chrome.storage.local.set({ forma: formaOra() }).catch(() => {});
        }).catch(() => {});
        chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.forma) metti(ch.forma.newValue); });
      } catch { /* senza estensione: resta quella di qui */ }
    }
    // Copiato un testo da incollare nel gestionale (EO, dimissioni, referto):
    // la finestra si toglie di mezzo da sola, la pill dice che è pronto.
    dopoCopia(ok) {
      if (!ok || this.collapsed || this.runState || TABELLONE) return;
      setTimeout(() => {
        if (this.collapsed || this.runState) return;
        // di chi è quello che stai per incollare: «✓ Copiato · ROSSI M.»
        const chi = this.idPaz().breve;
        this.avvisoPill = chi ? `✓ Copiato · ${chi}` : "✓ Copiato · incolla";
        this.riduci();
        setTimeout(() => { if (this.avvisoPill) { this.avvisoPill = ""; if (this.collapsed) this.render(); } }, 5000);
      }, 650);
    }

    // Trascinare: la pill (ridotta) si sposta dove vuoi e resta lì; la
    // finestra (aperta) si sposta intera dall'intestazione. Un clic vero
    // sulla pill la apre comunque; il doppio clic sull'intestazione rimette
    // la finestra al centro.
    attachDrag(el) {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest(".iconbtn, .menuw, button:not(#expand):not(#pinpill), input, a, [data-rz], [data-prurg], [data-segno]")) return;
        try { el.setPointerCapture(e.pointerId); } catch { /* niente */ }
        const wrap = el.closest(".wrap") || this.root.querySelector(".wrap");   // (Al passaggio la pill sopra la finestra ha la sua)
        const r = wrap.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY, ox = r.left, oy = r.top;
        const finestra = wrap.classList.contains("win");
        let moved = false;
        const mm = (ev) => {
          if (!ev.buttons) return up();   // il bottone è stato lasciato fuori dalla finestra
          if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
          moved = true;
          const vw = window.innerWidth, vh = window.innerHeight;
          if (finestra) {
            const g = geometriaFinestra(this.win);
            this.win = geometriaFinestra({ ...g, x: (ox + ev.clientX - sx) / vw, y: (oy + ev.clientY - sy) / vh });
            wrap.style.left = this.win.x * 100 + "vw";
            wrap.style.top = this.win.y * 100 + "vh";
          } else {
            this.pillPos = {
              left: Math.max(0, Math.min(vw - 80, ox + ev.clientX - sx)),
              top: Math.max(0, Math.min(vh - 48, oy + ev.clientY - sy)),
            };
            wrap.style.left = this.pillPos.left + "px";
            wrap.style.top = this.pillPos.top + "px";
            wrap.style.right = "auto";
          }
        };
        const up = () => {
          window.removeEventListener("pointermove", mm, true);
          window.removeEventListener("pointerup", up, true);
          window.removeEventListener("pointercancel", up, true);
          if (moved) {
            if (finestra) store.set("win.v1", this.win); else store.set("pillpos.v1", this.pillPos);
            this._justDragged = true;
            setTimeout(() => { this._justDragged = false; }, 0);
          }
        };
        window.addEventListener("pointermove", mm, true);
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", up, true);
      });
    }

    // Ridimensionare da ogni bordo e da ogni angolo, come una finestra vera.
    attachResize(el) {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const d = el.getAttribute("data-rz") || "se";
        try { el.setPointerCapture(e.pointerId); } catch { /* niente */ }
        const wrap = this.root.querySelector(".wrap");
        const r = wrap.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY;
        const mm = (ev) => {
          if (!ev.buttons) return up();
          const vw = window.innerWidth, vh = window.innerHeight;
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          let { left, top, width, height } = r;
          if (d.includes("e")) width = r.width + dx;
          if (d.includes("s")) height = r.height + dy;
          if (d.includes("w")) { width = r.width - dx; left = r.left + dx; }
          if (d.includes("n")) { height = r.height - dy; top = r.top + dy; }
          // mai più piccola del minimo: il bordo che si tira si ferma lì
          if (width < 380) { if (d.includes("w")) left -= 380 - width; width = 380; }
          if (height < 320) { if (d.includes("n")) top -= 320 - height; height = 320; }
          this.win = geometriaFinestra({ x: left / vw, y: top / vh, w: Math.min(width, vw) / vw, h: Math.min(height, vh) / vh });
          wrap.style.left = this.win.x * 100 + "vw"; wrap.style.top = this.win.y * 100 + "vh";
          wrap.style.width = this.win.w * 100 + "vw"; wrap.style.height = this.win.h * 100 + "vh";
        };
        const up = () => {
          window.removeEventListener("pointermove", mm, true);
          window.removeEventListener("pointerup", up, true);
          window.removeEventListener("pointercancel", up, true);
          store.set("win.v1", this.win);
        };
        window.addEventListener("pointermove", mm, true);
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", up, true);
      });
    }

    bind() {
      const $ = (s) => this.root.querySelector(s);
      $("#expand")?.addEventListener("click", (e) => {
        if (e.target.closest?.("[data-prurg]")) return;   // il segno del promemoria ha il suo menu
        // aprire la striscia di un giro in corso è un gesto di adesso, non una
        // preferenza: finito il giro il pannello torna com'era
        if (this.runState === "running") { this.collapsed = false; this.render(); return; }
        if (this._justDragged) return; // it was a drag, not a click
        // il segno di un ordine finito di un altro paziente: l'ordine, non il pannello
        if (e.target.closest?.("[data-segno]")) { this.apriSegno(); return; }
        // durante la stampa la striscia porta i suoi comandi, non il pannello
        if (this.striscia && this.striscia.onTap) { this.striscia.onTap(); return; }
        this.apri();
      });
      $("#strstop")?.addEventListener("click", () => this.striscia?.onStop?.());
      // il chip in intestazione: gli stessi comandi della striscia
      $("#girow")?.addEventListener("click", (e) => {
        const b = e.target.closest?.("button");
        if (!b) return;
        e.stopPropagation();
        // le righe sotto il chip (cambiano al loro posto: qui, non un ascolto per bottone)
        if (b.hasAttribute("data-pjx")) { b.disabled = true; this.rigaTocco(b.getAttribute("data-pjx")); return; }
        if (b.hasAttribute("data-pjrist")) { ask({ t: "ordineStampaQui", id: b.getAttribute("data-pjrist"), ...(b.hasAttribute("data-pjqui") ? { qui: true } : {}) }); return; }
        if (b.id === "gchipstop") { if (this.runState === "running") this.stop(); else this.striscia?.onStop?.(); }
        else if (b.id === "gchipaz") { b.blur(); this.striscia?.azione?.fn?.(); }
        else if (b.id === "gchipapri") this.striscia?.onTap?.();
        else if (b.id === "gchipsegno") this.apriSegno();
        else if (b.id === "gchippieg") this.mostraPiegati();
      });
      $("#strpieg")?.addEventListener("click", (e) => { e.stopPropagation(); this.mostraPiegati(); });
      $("#strsegno")?.addEventListener("click", (e) => { e.stopPropagation(); this.apriSegno(); });
      // le righe sotto la striscia: ✕ toglie quella sola, «Ristampa» rifà i fogli non usciti
      this.root.querySelectorAll("[data-pjx]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); b.disabled = true; this.rigaTocco(b.getAttribute("data-pjx")); }));
      this.root.querySelectorAll("[data-pjrist]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); ask({ t: "ordineStampaQui", id: b.getAttribute("data-pjrist"), ...(b.hasAttribute("data-pjqui") ? { qui: true } : {}) }); }));
      // (il bottone non tiene il fuoco, e il pannello non glielo ridà: col fuoco
      // nel pannello certi aggiornamenti aspettano — la spia del Ponte, per esempio)
      $("#strazione")?.addEventListener("click", (e) => { this._fuocoId = null; e.currentTarget.blur(); this.striscia?.azione?.fn?.(); });
      $("#collapse")?.addEventListener("click", () => this.riduci());
      $("#menubtn")?.addEventListener("click", (e) => {
        e.stopPropagation(); this.menuAperto = !this.menuAperto; if (this.resetArmato()) this._armato = null; this.render();
      });
      // due tocchi: il primo chiede, il secondo (entro pochi secondi) cancella
      $("#resetpaz")?.addEventListener("click", (e) => {
        e.stopPropagation();
        // (passati i secondi il bottone torna «Dimentica i dati…»: dueTocchi)
        if (!this.dueTocchi("dimentica", () => { if (this.menuAperto) this.render(); })) return;
        this.menuAperto = false;
        // (i pin «Da rivedere» non sono del turno: restano — se ne vanno solo con ⋯ → Da rivedere → «Elimina tutti…»)
        this.resetDatiPazienti();
      });
      $("#pinmenu")?.addEventListener("click", (e) => { e.stopPropagation(); this.menuAperto = false; this.render(); this.pinMenu(this.root.querySelector("#menubtn")); });
      this.root.querySelectorAll("[data-rz]").forEach((el) => this.attachResize(el));
      // doppio clic sull'angolo o sull'intestazione: di nuovo al centro, all'85%
      const alCentro = (e) => { e.stopPropagation(); this.win = null; store.set("win.v1", null); this.render(); };
      $("#rsz")?.addEventListener("dblclick", alCentro);
      const forma = formaOra();
      const hd = $("#draghd");
      if (hd && !TABELLONE) {
        this.attachDrag(hd);
        hd.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) alCentro(e); });
      }
      const pill = $("#expand");
      if (pill) this.attachDrag(pill);
      if ($("#pinpill")) this.attachDrag($("#pinpill"));   // Al passaggio, aperta: la pill si trascina lo stesso
      // «Stampa: PC · Infermeria» (si ricorda: vale anche per le altre schede, e il telefono la propone)
      this.root.querySelectorAll("[data-stdove]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const dove = b.getAttribute("data-stdove") === "stazione" ? "stazione" : "qui";
        this.stampaAuto = { ...this.stampaAuto, s: { ...(this.stampaAuto.s || {}), dove } };
        chrome.storage.local.get("stampa").then((o) => chrome.storage.local.set({ stampa: { ...(o.stampa || {}), dove } })).catch(() => {});
        this.render();
      }));
      // Al passaggio: il mouse fermo sulla pill la apre; la pill resta, e un
      // tocco la fissa (o la lascia di nuovo richiudere). Col dito: un tocco apre, un tocco chiude.
      if (forma === "passaggio" && pill && pill.matches(".pill:not(.run)")) {
        pill.addEventListener("pointerenter", (e) => {
          if (e.pointerType !== "mouse" || e.buttons || Date.now() - (this._ridottaAlle || 0) < 800) return;
          clearTimeout(this._tApre);
          this._sullaPill = true;
          this._tApre = setTimeout(() => { if (this.collapsed && this._sullaPill && !this._premuto && formaOra() === "passaggio") this.apri({ passaggio: true }); }, PASSAGGIO_APRE_MS);
        });
        pill.addEventListener("pointerleave", () => { this._sullaPill = false; clearTimeout(this._tApre); });
      }
      const pin = $("#pinpill");
      if (pin) {
        let dito = false;
        pin.addEventListener("pointerdown", (e) => { dito = e.pointerType !== "mouse"; });
        pin.addEventListener("click", () => {
          if (this._justDragged) return;   // era un trascinamento, non un tocco
          if (dito) return this.riduci();
          this.fissata = !this.fissata;
          clearTimeout(this._tChiude); this._tChiude = 0;
          this.render();
        });
      }
      // il tabellone in una scheda sua (dal menu, e dal ↗ sulla lista)
      const tabellone = () => { this.menuAperto = false; this.render(); ask({ t: "tabelloneApriPagina" }); };
      $("#tabmenu")?.addEventListener("click", tabellone);
      $("#tabapri")?.addEventListener("click", tabellone);
      $("#stopbtn")?.addEventListener("click", () => this.stop());
      $("#reset")?.addEventListener("click", () => {
        this.runState = null; this.runData = null; this.message = null; this.carrelloDaAprire = null; this.render();
      });
      // «Svuota il carrello e ricomincia»: un tocco legge il carrello e chiede, il secondo fa
      $("#svuota")?.addEventListener("click", () => (this._svuota?.ok ? this.svuotaERicomincia() : this.svuotaChiedi()));
      $("#chiudi")?.addEventListener("click", () => this.chiudiErrore());
      $("#riprova")?.addEventListener("click", () => this.riprovaMancanti());
      $("#openlist")?.addEventListener("click", () => {
        if (this.carrelloDaAprire) return this.carrelloDaAprire();   // la navigazione rimandata, col suo passaggio di consegne
        const u = this.runData?.finishedListUrl || this.runData?.lastListUrl;
        if (!u) return;
        if (this.runState === "fail") this.consegnaErrore?.();   // il resoconto (e «Riprova») viaggia col carrello
        nav(u);
      });

      $("#back")?.addEventListener("click", () => this.vistaMenu() ? this.tornaDaVista() : this.setView(
        this.view === "referto" ? "esiti"
        : this.view === "dimtesto" || this.view === "dimimport" ? "dimissioni"
        : this.view === "eotesto" ? "eo"
        : "home"));
      this.root.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => {
        const v = b.getAttribute("data-seg");
        // le Richieste aperte col clic sulla scheda (non al passaggio del mouse,
        // che lascia la tastiera al gestionale): il cursore nel quesito, se è vuoto
        if (v === "richieste" && !String(this._q || "").trim()) this._qFocus = true;
        this.setView(v);
      }));
      $("#archtog")?.addEventListener("click", () => { this.mostraArch = !this.mostraArch; this.render(); });
      this.root.querySelectorAll("[data-unarch]").forEach((b) => b.addEventListener("click", () => {
        archiviaPaziente(b.getAttribute("data-unarch"), false);
        this.render();
      }));
      // il ponte: la pagina dell'iPhone (nel pannello, o in una scheda se lì non si apre), e «Scollega» dall'intestazione
      $("#pontemenu")?.addEventListener("click", () => { this.menuAperto = false; this._ponteNo = ""; this.setView("iphone"); });
      $("#ponteapri")?.addEventListener("click", () => this.ponteInScheda());
      $("#ponteoff")?.addEventListener("click", (e) => { e.stopPropagation(); ask({ t: "ponteScollega" }); });
      $("#ponterica")?.addEventListener("click", (e) => { e.stopPropagation(); ponteRicarica(); });
      $("#ponteavv")?.addEventListener("click", (e) => { e.stopPropagation(); this.menuAperto = false; this._ponteNo = ""; this.setView("iphone"); });
      $("#risall")?.addEventListener("click", () => this.caricaValori().catch(() => {}).then(() => this.caricaReferti()));
      // «Letto»: da qui in poi le novità si contano da adesso, per tutti i prelievi
      $("#letto")?.addEventListener("click", () => {
        for (const e of this.esiti) if (e.kind === "valori") this.marcaLetto(e.id);
        segnaVisti(this.episodeId, this.refertiMostrati().map((e) => e.id));   // e i referti nuovi: visti
        this.render();
      });
      $("#apripdf")?.addEventListener("click", () => { const id = this.espanso ?? this._autoAperto; if (id) this.openReferto(id); });
      this.root.querySelectorAll("[data-pdf]").forEach((b) => b.addEventListener("click", () => this.openReferto(b.getAttribute("data-pdf"))));
      // un tocco su un valore lo segna (giallo → arancio → niente): si cambia
      // la cella sul posto, senza ridisegnare, così la tabella non scatta
      const tabella = this.root.querySelector(".sttab");
      if (tabella) tabella.addEventListener("click", (ev) => {
        const td = ev.target?.closest?.("td[data-cella]");
        if (!td) return;
        const stato = (td.classList.contains("marca2") ? 2 : td.classList.contains("marca1") ? 1 : 0) + 1;
        const prossimo = stato > 2 ? 0 : stato;
        if (!scriviSegno(this.chiaveNota(), td.getAttribute("data-cella"), prossimo)) {
          // un salvataggio rifiutato si dice, non si finge
          this.message = "Il browser non ha accettato il segno: memoria piena o bloccata.";
          this.render();
          return;
        }
        td.classList.remove("marca1", "marca2");
        if (prossimo) td.classList.add("marca" + prossimo);
      });
      const filtra = () => { this.soloAlterati = !this.soloAlterati; this.render(); };
      $("#storfiltro")?.addEventListener("click", filtra);
      this.root.querySelectorAll("[data-dcopy]").forEach((b) => b.addEventListener("click", async () => {
        const d = dimissioni()[b.getAttribute("data-dcopy")];
        if (!d) return;
        const ico = b.querySelector(".dico");
        let ok = false;
        ok = await copiaTesto(d.testo);
        this.dopoCopia(ok);
        b.classList.toggle("fatto", ok);
        if (ico) ico.textContent = ok ? "✓ copiato" : "✗ non riuscito";
        setTimeout(() => {
          if (!b.isConnected) return;
          b.classList.remove("fatto");
          if (ico) ico.textContent = "⧉";
        }, 1800);
      }));
      // EO: la riga copia, la tendina copia scegliendo. In tutti e due i casi
      // il testo scelto resta scritto sotto, così si vede cosa si è preso.
      const eoFatto = (b, ok) => {
        const ico = b.querySelector(".dico");
        b.classList.toggle("fatto", ok);
        if (ico) ico.textContent = ok ? "✓ copiato" : "✗ non riuscito";
        setTimeout(() => {
          if (!b.isConnected) return;
          b.classList.remove("fatto");
          if (ico) ico.textContent = "⧉";
        }, 1800);
      };
      this.root.querySelectorAll("[data-eocopy]").forEach((b) => b.addEventListener("click", async () => {
        const v = eoVoci()[b.getAttribute("data-eocopy")];
        if (!v) return;
        const ok = await copiaTesto(v.testo);
        eoFatto(b, ok);
        this.dopoCopia(ok);
      }));
      $("#eocaso")?.addEventListener("change", async (ev) => {
        const k = ev.target.value;
        this.eoSel = k || "";
        const v = eoVoci()[k];
        const txt = this.root.querySelector("#eotxt");
        const riga = this.root.querySelector(".eoazione");
        const btn = this.root.querySelector("#eoricopia");
        if (txt) { txt.textContent = v ? v.testo : ""; txt.hidden = !v; }
        if (riga) riga.hidden = !v;
        if (btn) btn.setAttribute("data-eocopy", k || "");
        this.root.querySelector("#eoedit")?.setAttribute("data-eoedit", k || "");
        if (!v) return;
        this.persistUi();
        if (btn) { const ok = await copiaTesto(v.testo); eoFatto(btn, ok); this.dopoCopia(ok); }
      });
      this.root.querySelectorAll("[data-dedit]").forEach((b) => b.addEventListener("click", () => this.setView("dimtesto", b.getAttribute("data-dedit"))));
      // EO: ✎ apre il testo, che si riscrive come un foglio di dimissione
      this.root.querySelectorAll("[data-eoedit]").forEach((b) => b.addEventListener("click", () => {
        const k = b.getAttribute("data-eoedit");
        if (k && eoVoci()[k]) this.setView("eotesto", k);
      }));
      const eoArea = this.root.querySelector("#eoarea");
      if (eoArea) eoArea.addEventListener("input", () => tabStore.set(this.eoDraftKey(this.viewId), { ts: Date.now(), testo: eoArea.value }));
      $("#eocopia")?.addEventListener("click", async () => {
        const ok = await copiaTesto(eoArea ? eoArea.value : "");
        segnaCopia(this.root.querySelector("#eocopia"), ok);
        this.dopoCopia(ok);
      });
      $("#eosave")?.addEventListener("click", () => {
        const v = eoVoci()[this.viewId];
        if (!eoArea || !v) return;
        if (!eoArea.value.trim()) { this.message = "Il testo è vuoto: non lo salvo."; this.render(); return; }
        const scritto = salvaEo(this.viewId, eoArea.value);
        tabStore.set(this.eoDraftKey(this.viewId), null);
        this.setView("eo", null, scritto
          ? { ok: `«${v.nome}» salvato: sarà questo il testo copiato d'ora in poi.` }
          : `«${v.nome}» NON salvato: la memoria di questo browser è piena o bloccata.`);
      });
      $("#eoreset")?.addEventListener("click", (ev) => {
        const v = eoVoci()[this.viewId] || {}, k = "eoreset:" + this.viewId;
        // un tocco non deve poter buttare un testo scritto dal medico: due tocchi (dueTocchi), il bottone cambiato
        // sul posto (un render rifarebbe la casella sotto le dita)
        const mostra = () => { const x = this.root.querySelector("#eoreset"); if (!x) return; const a = this.armatoDi(k); x.textContent = a ? EO_RESET_ARMATO : "↺ Originale"; x.classList.toggle("armato", a); };
        if (!this.dueTocchi(k, mostra)) return;
        const scritto = ripristinaEo(this.viewId);
        tabStore.set(this.eoDraftKey(this.viewId), null);
        this.setView("eo", null, scritto ? { ok: `«${v.nome || "Testo"}» riportato all'originale.` } : "Non ripristinato: la memoria di questo browser è bloccata.");
      });
      // every keystroke goes into the tab's draft: a re-render, a page change
      // or a mis-click can no longer throw away a rewritten sheet
      const area = this.root.querySelector("#dimarea");
      const inNome = this.root.querySelector("#dimnome");
      const bozza = () => tabStore.set(this.dimDraftKey(this.viewId), { ts: Date.now(), testo: area ? area.value : "", ...(inNome ? { nome: inNome.value } : {}) });
      if (area) area.addEventListener("input", bozza);
      if (inNome) {
        inNome.addEventListener("input", bozza);
        inNome.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); area?.focus(); } });
        if (!inNome.value && !this.root.activeElement) inNome.focus();   // un foglio nuovo comincia dal nome
      }
      $("#dimnuovo")?.addEventListener("click", () => this.setView("dimtesto", DIM_NUOVO));
      $("#dimcopy")?.addEventListener("click", async () => {
        const b = this.root.querySelector("#dimcopy");
        let ok = false;
        ok = await copiaTesto(area ? area.value : "");
        segnaCopia(b, ok);
        this.dopoCopia(ok);
      });
      $("#dimsave")?.addEventListener("click", () => {
        const nuovo = this.viewId === DIM_NUOVO;
        const tutte = dimissioni();
        const d = nuovo ? { nome: "", mio: true } : tutte[this.viewId];
        if (!area || !d) return;
        const nome = inNome ? inNome.value.replace(/\s+/g, " ").trim().slice(0, 60) : d.nome;
        const no = (m) => { bozza(); this.message = m; this.render(); };
        if (!nome) return no("Dai un nome al foglio: è quello che vedrai nell'elenco.");
        if (!area.value.trim()) return no("Il testo è vuoto: non lo salvo.");
        // due righe con lo stesso nome, nell'elenco, non si distinguono
        if (Object.entries(tutte).some(([k, x]) => k !== this.viewId && x.nome.trim().toLowerCase() === nome.toLowerCase())) {
          return no(`C'è già un foglio «${nome}»: scegli un altro nome.`);
        }
        let k = this.viewId;
        if (nuovo) do k = "mio-" + Math.random().toString(36).slice(2, 8); while (tutte[k] || DIMISSIONI[k]);
        const scritto = salvaDimissione(k, nome, area.value);
        tabStore.set(this.dimDraftKey(this.viewId), null);
        this.log(`${now()}  foglio di dimissione «${nome}» ${nuovo ? "aggiunto" : "aggiornato"}`);
        // never say "saved" when the browser refused to write it
        this.setView("dimissioni", null, !scritto
          ? `«${nome}» NON salvato: la memoria di questo browser è piena o bloccata.`
          : nuovo ? { ok: `«${nome}» aggiunto ai tuoi fogli, in cima all'elenco.` }
          : { ok: `«${nome}» salvato: sarà questo il testo copiato d'ora in poi.` });
      });
      $("#dimreset")?.addEventListener("click", (ev) => {
        const d = dimissioni()[this.viewId] || {}, k = "dimreset:" + this.viewId;
        // un tocco non deve poter buttare un testo scritto dal medico: due tocchi (dueTocchi), sul posto come sopra
        const mostra = () => { const x = this.root.querySelector("#dimreset"); if (!x) return; const a = this.armatoDi(k);
          x.textContent = a ? (d.mio ? DIM_VIA_ARMATO : EO_RESET_ARMATO) : d.mio ? "✕ Elimina" : "↺ Originale"; x.classList.toggle("armato", a); };
        if (!this.dueTocchi(k, mostra)) return;
        const nome = d.nome || this.viewId;
        const scritto = ripristinaDimissione(this.viewId);
        tabStore.set(this.dimDraftKey(this.viewId), null);
        this.setView("dimissioni", null, !scritto
          ? `«${nome}» non ${d.mio ? "eliminato" : "ripristinato"}: la memoria di questo browser è bloccata.`
          : d.mio ? { ok: `«${nome}» eliminato.` } : { ok: `«${nome}» riportato al testo originale.` });
      });
      $("#dimexport")?.addEventListener("click", async () => {
        const tutte = dimissioni();
        const mie = store.get(dimKey, {});
        const dati = {};
        for (const [k, v] of Object.entries(tutte)) {
          dati[k] = { nome: v.nome, testo: v.testo };
          // carry the fingerprint of the original this version was forked from,
          // so a re-import keeps knowing when the original moves
          if (mie[k] && mie[k].base) dati[k].base = mie[k].base;
        }
        const testo = JSON.stringify({ app: APP, versione: VERSION, salvato: new Date().toISOString(), dimissioni: dati }, null, 1);
        // the file where downloads are allowed, the clipboard everywhere else:
        // the doctor must end up with the text in his hands either way
        let file = false, appunti = false;
        try {
          const url = URL.createObjectURL(new Blob([testo], { type: "application/json" }));
          const a2 = document.createElement("a");
          a2.href = url; a2.download = "dimissioni.json";
          document.documentElement.appendChild(a2); a2.click(); a2.remove();
          setTimeout(() => URL.revokeObjectURL(url), 20000);
          file = true;
        } catch { /* clipboard below */ }
        appunti = await copiaTesto(testo);
        this.menuAperto = false;
        this.message = file || appunti
          ? { ok: file && appunti ? "Fogli salvati: dimissioni.json e negli appunti." : file ? "Fogli salvati: dimissioni.json." : "Fogli negli appunti." }
          : "Esportazione non riuscita.";
        this.render();
      });
      $("#dimricetta")?.addEventListener("click", () => this.setView("ricetta"));   // (solo dalle Dimissioni: chi va a casa porta la ricetta)
      if (this.view === "ricetta") this.legaRicetta($);
      $("#termenu")?.addEventListener("click", () => { this.menuAperto = false; this.setView("terapia"); });
      if (this.view === "terapia") this.legaTerapia($);
      $("#consmenu")?.addEventListener("click", () => { this.menuAperto = false; this.setView("consegne"); });
      $("#etimenu")?.addEventListener("click", () => { this.menuAperto = false; this.apriEtichetta(); });
      if (this.view === "etichetta") this.legaEtichetta($);
      $("#conscopia")?.addEventListener("click", async (e) => {
        const b = e.currentTarget;
        segnaCopia(b, await copiaTesto(this.consegne().map((r) => r.testo).join("\n")));
      });
      $("#consstampa")?.addEventListener("click", () => {
        const d = new Date();
        stampaTesto(`Consegne · ${giornoDi(d.getTime())} ${hhmm(d.getTime())}`, this.consegne().map((r) => r.testo),
          () => { this.message = "Il dialogo di stampa non si è aperto: ⧉ Copia, e incolla dove vuoi."; this.render(); });
      });
      $("#stampamenu")?.addEventListener("click", () => { this.menuAperto = false; this.setView("stampa"); });
      $("#bracciale")?.addEventListener("click", (e) => this.stampaBracciale(e));
      this.root.querySelectorAll("[data-cons]").forEach((b) => b.addEventListener("click", () => {
        const c = CONSENSI.find((x) => x.k === b.getAttribute("data-cons"));
        const url = c && urlConsenso(c);
        if (!url) { this.message = "I moduli ci sono solo con l'estensione."; this.render(); return; }
        this.log(`${now()}  modulo «${c.nome}» aperto per la stampa`);
        avviaStampa([{ name: c.nome, printer: "stampante normale", url, diretto: true }],
          { title: c.nome, panel: this, ep: this.episodeId, paziente: this.nomePaziente() });
      }));
      $("#dimimport")?.addEventListener("click", () => { this.menuAperto = false; this.setView("dimimport"); });
      $("#dimimpok")?.addEventListener("click", () => {
        const ta = this.root.querySelector("#dimimparea");
        const testo = (ta && ta.value || "").trim();
        if (!testo) { this.message = "Incolla prima il JSON esportato."; this.render(); return; }
        let dims = null;
        try {
          const dati = JSON.parse(testo);
          dims = dati && dati.dimissioni && typeof dati.dimissioni === "object" ? dati.dimissioni : dati;
        } catch (e) {
          this.message = `JSON non valido: ${e.message}`; this.render(); return;
        }
        if (!dims || typeof dims !== "object") { this.message = "Questo file non contiene fogli di dimissione."; this.render(); return; }
        const mie = store.get(dimKey, {});
        let n = 0, uguali = 0, saltati = 0;
        for (const [k, v] of Object.entries(dims)) {
          if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
          if (!dimValido(v) || v.testo.length > 40000 || k.length > 80) { saltati++; continue; }
          const orig = DIMISSIONI[k];
          // a text identical to the shipped one is NOT a change: importing it
          // as an override would freeze that sheet at today's wording forever
          if (orig && v.testo.trim() === orig.testo.trim()) { delete mie[k]; uguali++; continue; }
          if (!(k in mie) && Object.keys(mie).length >= 40) { saltati++; continue; }
          mie[k] = {
            nome: String(v.nome || (orig && orig.nome) || k).slice(0, 80),
            testo: v.testo,
            base: typeof v.base === "string" && v.base ? v.base : (orig ? impronta(orig.testo) : ""),
          };
          n++;
        }
        if (!n && !uguali) { this.message = "Nessun testo valido in questo JSON."; this.render(); return; }
        const scritto = store.set(dimKey, mie);
        this.log(`${now()}  importati ${n} fogli di dimissione`);
        const coda = [uguali ? `${uguali} già uguali all'originale` : "", saltati ? `${saltati} ignorati` : ""].filter(Boolean).join(", ");
        this.setView("dimissioni", null, scritto
          ? { ok: `${n === 1 ? "Importato 1 foglio" : `Importati ${n} fogli`}${coda ? ` (${coda})` : ""}.` }
          : "Import NON salvato: la memoria di questo browser è piena o bloccata.");
      });
      $("#copytxt")?.addEventListener("click", async () => {
        const e = this.esiti.find((x) => x.id === (this.espanso ?? this._autoAperto));
        const t = e ? this.testoDi(e) : null;
        if (!t || t.stato !== "testo") return;   // mai il testo di un altro paziente
        let ok = false;
        ok = await copiaTesto([`${e.when} · ${shortLabel(e.label)}${this.nomePaziente() ? ` · ${this.nomePaziente()}` : ""}`, ...t.righe].join("\n"));
        const b = this.root.querySelector("#copytxt");
        segnaCopia(b, ok);
        this.dopoCopia(ok);
      });
      this.root.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", (ev) => {
        ev.stopPropagation();   // Richieste sits inside the card, which is itself a [data-go]
        this.apriPaziente(b.getAttribute("data-ep"), b.getAttribute("data-go"));
      }));
      $("#goqueued")?.addEventListener("click", () => { if (this.pending) goToQueued(this.pending); });
      $("#confirmnow")?.addEventListener("click", () => {
        // native click → server confirm → print handoff (armed at boot); una volta sola per pagina
        if (confermaPannello) return;
        const live = examModel(document, location.href);
        if (!live.confirmButton || this.confermaGiaPartita(live.richiestaId)) return;
        confermaPannello = "Confermo…";
        tabStore.set(PREMUTO, Date.now());   // (la Conferma è sua)
        live.confirmButton.click();
        this.render();
      });
      // la ricevuta tiene la griglia chiusa: «+ aggiungi» la apre
      $("#aggiungi")?.addEventListener("click", () => { this.aggiungi = true; this.render(); });
      // la richiesta ancora da confermare: un tocco porta al suo carrello (una lettura)
      $("#apridaconf")?.addEventListener("click", (e) => { const u = e.currentTarget.getAttribute("data-url"); if (u) nav(u); });
      $("#ignoradaconf")?.addEventListener("click", () => {
        for (const x of nonConfermateQui()) confermataProvata(x.rid);
        if (this.striscia && this.striscia.sorveglia) this.segnala(null);
        this.render();
      });
      // …e sul suo carrello, le sue due azioni (a due tocchi)
      $("#dcconferma")?.addEventListener("click", () => this.daConfTocco("conferma"));
      $("#dcsvuota")?.addEventListener("click", () => this.daConfTocco("svuota"));
      // la stampa automatica: le impostazioni (anche dalla stampantina in
      // intestazione, che si ridisegna da sola: l'ascolto sta sul suo posto) e l'interruttore
      $("#stampanti")?.addEventListener("click", () => this.apriStampanti());
      $("#regmenu")?.addEventListener("click", () => { this.menuAperto = false; this.apriRegistrazioni(); });
      $("#recchip")?.addEventListener("click", () => this.apriRegistrazioni());
      if (this.view === "registrazioni") this.legaRegistrazioni($);
      $("#registro")?.addEventListener("toggle", (e) => { this.registroAperto = e.currentTarget.open; });
      $("#stautow")?.addEventListener("click", (e) => { if (e.target.closest("#stauto")) this.apriStampanti(); });
      const qEl = $("#q");
      // «Quesito o esame…». Scritto a mano nella casella è il quesito del
      // medico, e vale anche sopra quello del triage. Se somiglia a degli
      // esami, sotto compaiono: per primo «Quesito: …» (Invio), poi gli esami;
      // scelto un esame (o con Esc) nella casella torna il quesito di prima.
      if (qEl) {
        if (!this._cerca) this._qBase = this._q || "";
        const chiudi = (testo) => { this._q = testo; qEl.value = testo; this._cerca = false; this.persistUi(); this.render(); };
        qEl.addEventListener("input", () => {
          this._q = qEl.value; this.quesitoMio = true; this.persistUi();
          const ha = this.esamiDalQuesito(this._q, fullCatalog()).length > 0;
          if (!ha) this._qBase = this._q;   // non somiglia a un esame: è il quesito
          const aperto = !!this.root.querySelector("#qdrop");
          this._cerca = ha;
          if (ha || aperto) { this._qFocus = true; this.render(); } else this.refreshCommit();
        });
        qEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && this.root.querySelector("#qdrop")) { e.preventDefault(); this._qBase = this._q; this._qFocus = true; chiudi(this._q); }
          else if (e.key === "Escape" && (this.root.querySelector("#qdrop") || qEl.value !== this._qBase)) { e.preventDefault(); e.stopPropagation(); this._qFocus = true; chiudi(this._qBase || ""); }
        });
        qEl.addEventListener("blur", () => {
          if (!qEl.isConnected || this._staccando) return;   // (tolta da un ridisegno: non è il medico che se ne va)
          this._qFocus = false;
          setTimeout(() => {
            if (this.root.activeElement?.id === "q" || !this._cerca) return;
            this._cerca = false; this._qBase = this._q;
            if (this.root.querySelector("#qdrop")) this.render();
          }, 200);
        });
        $("#usaq")?.addEventListener("click", () => { this._qBase = this._q; chiudi(this._q); });
        if (this._qFocus) { qEl.focus(); qEl.setSelectionRange(qEl.value.length, qEl.value.length); }
      }
      this.root.querySelectorAll("[data-espandi]").forEach((b) => b.addEventListener("click", () => {
        const p = b.getAttribute("data-espandi"), s = this.profiliAperti || (this.profiliAperti = new Set());
        if (s.has(p)) s.delete(p); else s.add(p);
        this.render();
      }));
      // Ctrl+Invio: la Conferma (quando c'è qualcosa da confermare); nella
      // Ricetta SISS e nella Terapia, «Prepara» (Registra e Conferma restano del medico)
      if (!this._ctrlInvio) {
        this._ctrlInvio = true;
        this.root.addEventListener("keydown", (e) => {
          const id = { richieste: "#goconfirm", ricetta: "#ricprepara", terapia: "#terprepara" }[this.view];
          if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !id || this.runState) return;
          const b = this.root.querySelector(id);
          if (!b || b.disabled) return;
          e.preventDefault();
          b.click();
        });
      }
      const qrxEl = $("#qrx");
      qrxEl?.addEventListener("input", () => { this._qrx = qrxEl.value; this.persistUi(); this.refreshCommit(); });
      this.root.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
        const q = b.getAttribute("data-q");
        // un pacchetto (o un pacchetto da lasciare) cambia anche gli esami: si ridisegna
        if (this.pacchettoDi(q) || this.pacchetto) { this.scegliQuesito(q); this.root.querySelector("#q")?.focus(); return; }
        qEl.value = q; this._q = qEl.value; this.quesitoMio = false; this.persistUi(); this.refreshCommit(); qEl.focus();
      }));
      this.root.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => this.togglePreset(PRESETS[+b.getAttribute("data-preset")])));
      this.root.querySelectorAll(".chip[data-code], .opt[data-code]").forEach((b) => b.addEventListener("click", () => this.toggle(b.getAttribute("data-res"), b.getAttribute("data-code"))));
      this.root.querySelectorAll(".acitem[data-code]").forEach((b) => b.addEventListener("click", () => {
        // dalla casella «Quesito o esame…»: scelto l'esame, torna il quesito di prima
        if (b.closest("#qdrop")) { this._q = this._qBase || ""; this._cerca = false; this._qFocus = false; this.persistUi(); }
        this.toggle(b.getAttribute("data-res"), b.getAttribute("data-code"));
      }));
      this.root.querySelectorAll("[data-unsel]").forEach((b) => b.addEventListener("click", () => { this.selected.delete(b.getAttribute("data-unsel")); this.persistUi(); this.render(); }));
      const ac = $("#acq");
      if (ac) {
        ac.addEventListener("input", () => { this.acq = ac.value; this.acFocus = true; this.render(); });
        ac.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const first = this.root.querySelector(".acitem[data-code]");
            if (first) { e.preventDefault(); this.toggle(first.getAttribute("data-res"), first.getAttribute("data-code")); }
          } else if (e.key === "Escape") { e.stopPropagation(); this.acq = ""; this.render(); }
        });
        if (this.acFocus) { ac.focus(); ac.setSelectionRange(ac.value.length, ac.value.length); }
      }
      $("#go")?.addEventListener("click", () => this.launch(false));
      $("#goconfirm")?.addEventListener("click", () => this.launch(true));
      this.root.querySelectorAll("[data-print]").forEach((b) => b.addEventListener("click", () => {
        const rid = b.getAttribute("data-print");
        const jobs = printJobsFor(stampePaziente(this.epDiQuesta()), rid);
        // doppio click (su stampa automatica partirebbe due volte): due tocchi nella stessa
        // finestra di 2 s hanno lo stesso id e il service worker ne stampa uno solo; una
        // ristampa voluta più tardi cade in un'altra finestra e riparte
        avviaStampa(jobs, { panel: this, title: `Richiesta ${rid}.`, ep: this.episodeId, paziente: this.nomePaziente(), url: location.href,
          jobId: `rist-${rid}-${Math.floor(Date.now() / 2000)}` });
      }));
      $("#stultima")?.addEventListener("click", () => {
        const map = stampePaziente(this.epDiQuesta());
        const ids = ultimeRichieste(map, this.epDiQuesta());
        avviaStampa(fogliDi(map, ids), { panel: this, title: `${ids.length > 1 ? "Richieste" : "Richiesta"} ${ids.join(" e ")}.`,
          ep: this.episodeId, paziente: this.nomePaziente(), url: location.href, jobId: `rist-${ids.join("-")}-${Math.floor(Date.now() / 2000)}` });
      });
      this.root.querySelectorAll("[data-esito]").forEach((b) => b.addEventListener("click", () =>
        this.openEsito(b.getAttribute("data-esito"))));
      $("#reflab")?.addEventListener("toggle", (e) => { this.labAperto = e.target.open; });
      $("#ritiro")?.addEventListener("toggle", (e) => { this.ritiroAperto = e.target.open; });
      $("#copylog")?.addEventListener("click", (e) => { e.preventDefault(); this.copyLog(); });
      this.bindStanza();
      this.dfRiattacca();   // la lista «Da fare» rimasta aperta
    }

    // Patch only the commit zone while the doctor types (a full re-render
    // would steal the textarea focus at every keystroke).
    refreshCommit() {
      const problems = this.computeProblems();
      const go = this.root.querySelector("#go");
      const goc = this.root.querySelector("#goconfirm");
      const n = this.selected.size;
      if (go) go.disabled = !n || !!problems.go.length;
      if (goc) goc.disabled = !n || !!problems.confirm.length;
      const box = this.root.querySelector("#problems");
      if (box) box.innerHTML = problems.go[0] ? `<div class="problem">${esc(problems.go[0])}</div>` : "";
    }

    launch(autoConfirm) {
      if (this.pageType === "vista") return;   // da una pagina «altra» non si ordina
      // Belt over the live validation braces: recompute and refuse loudly.
      const problems = this.computeProblems();
      const blocking = autoConfirm ? problems.confirm : problems.go;
      if (blocking.length) { this.message = blocking[0]; this.render(); return; }
      const items = [...this.selected.entries()].map(([k, i]) => ({ ...i, chiave: k }));   // copie (vedi startPlan)
      if (!items.length) return;

      const base = { autoConfirm, quesitoMio: !!this.quesitoMio };
      if (this.pageType === "patient") {
        const lab = items.filter((i) => !RADIO_SET.includes(i.res));
        const radio = items.filter((i) => RADIO_SET.includes(i.res));
        const legs = [];
        // ognuna col suo quesito: la radiologia ha il suo, se è scritto. Il
        // quesito RX si scrive solo a mano (non ha chip): scritto, è del medico
        const q = (this._q || "").trim(), suoRx = (this._qrx || "").trim(), qrx = suoRx || q;
        // il laboratorio: una richiesta per erogatore (POC, Urgenze…), ognuna col quesito
        if (lab.length) legs.push(...gambeLab(lab, this.entry?.labUrl, { entryUrl: this.entry?.labUrl, quesito: q, quesitoMio: !!this.quesitoMio }));
        if (radio.length) legs.push({ kind: "radio", label: "radiologia", items: radio, entryUrl: this.entry?.radioUrl, quesito: qrx, quesitoMio: suoRx ? true : !!this.quesitoMio });
        if (legs.some((l) => !l.entryUrl)) { this.message = "Link di apertura richiesta non trovato su questa pagina."; this.render(); return; }
        base.startPage = "patient";
        base.legs = legs;
        base.entryUrl = legs[0].entryUrl;
        base.items = legs[0].items;
        base.quesito = legs[0].quesito;
        base.quesitoMio = legs[0].quesitoMio;
      } else if (this.pageType === "crea") {
        const form = document.forms.namedItem("RICHIESTACrea");
        if (!form) { this.message = "Form della richiesta non trovato."; this.render(); return; }
        base.startPage = "crea";
        // una richiesta di radiologia prende il quesito RX, se è scritto
        if (items.every((i) => RADIO_SET.includes(i.res)) && (this._qrx || "").trim()) { base.quesito = this._qrx.trim(); base.quesitoMio = true; }
        base.creaForm = form;
        base.creaUrl = location.href;
        // più erogatori di laboratorio: questa richiesta per il primo, e per
        // gli altri una «Nuova richiesta» ciascuno, dallo stesso indirizzo
        // da cui il gestionale ha aperto questa (una lettura: nasce vuota)
        const gambe = items.some((i) => RADIO_SET.includes(i.res)) ? [] : gambeLab(items, location.href, {});
        if (gambe.length > 1) {
          if (!leggibilePagina(location.href) || param(location.href, "MVPG") !== "PsoRichiestaCreaRcs") {
            this.message = "Da questa pagina un laboratorio solo: gli altri esami ordinali dalla pagina del paziente."; this.render(); return;
          }
          // (il quesito scritto nella pagina, se il pannello non ne ha uno, va anche nelle altre)
          const q = (this._q || "").trim(), suoQ = (form.elements.namedItem("QUESITO_DIAGNOSTICO")?.value || "").trim();
          const altre = q ? {} : { quesito: suoQ, quesitoMio: true };
          base.legs = gambe.map((l, k) => ({ ...l, ...(k ? { startPage: "patient", entryUrl: location.href, ...altre } : { startPage: "crea" }) }));
          base.items = base.legs[0].items;
        }
      } else {
        base.startPage = "exam";
        base.examDoc = document;
        base.examUrl = location.href;
      }
      // confermato col quesito di un chip: il chip impara questi esami
      if (autoConfirm && this.pageType !== "exam" && !this.quesitoMio) imparaPacchetto(this._q, items);
      this.startPlan(base);
    }
  }

