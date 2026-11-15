//@frammento 76-ponte-gestionale.js — PONTE, il lavoro nella scheda dietro: valori, cartella, terapia, lista d'area, accettazione dal triage.
  // La scheda aperta dietro sulla pagina di un paziente (ponteValoriSotto, in
  // ponte-sw.js): legge, poi lo dice al service worker (che la chiude). `modo`:
  //   ""           «↻ Rileggi» sul telefono: il «⭳ Carica i valori» di sempre, poi i referti non ancora salvati;
  //   "auto"       lo stesso, partito da sé (gli esiti sul telefono: il laboratorio della pagina è cambiato,
  //                o un referto non è salvato) — quello che non riesce si riprova solo più tardi (riprovaDaSolo);
  //   "apri"       il tocco sul telefono su chi il PC non ha ancora aperto in questo turno: prima quello che
  //                fa un clic sulla lista (chi è, l'età, la cartella), poi come «auto»;
  //   "tabellone"  il ⟳ del tabellone: lo stato della pagina, e i valori se il laboratorio è cambiato
  //                (autoCarica, senza i PDF dei referti: quelli li prende chi apre il paziente).
  // Lo stato della pagina (Lab · ECG · RX, le allergie, i parametri) l'ha già letto la partenza della
  // scheda. Solo «apri» conta come «visto adesso»: è il medico che l'ha aperto, dal telefono.
  async function ponteValoriQui(panel) {
    const v = PONTE_VALORI, modo = v.modo || "", daSe = modo === "auto" || modo === "apri";
    let esito;
    if (!panel || panel.pageType !== "patient" || panel.episodeId !== v.ep || !panel.nomePaziente() || eListaArea(document, location.href)) {
      // Non è (ancora) la pagina del paziente: il gestionale a volte passa da
      // un'altra pagina prima (la lista, un passaggio). Lo si dice al service
      // worker, che aspetta la pagina dopo, o riapre l'indirizzo una volta.
      // (all'indirizzo del paziente ma non la sua pagina: una pagina di passaggio, senza nome)
      const mvpg = param(location.href, "MVPG") || location.pathname.split("/").pop() || "";
      const pagina = mvpg === "PsoEpisodioClinicoAmbulatorio" ? "" : mvpg;
      const altro = !!(panel && panel.pageType === "patient" && panel.episodeId && panel.episodeId !== v.ep);
      segnaErrore("ponte valori", { episodio: v.ep, motivo: altro ? "aperta la pagina di un altro paziente" : `aperta ${pagina || "un'altra pagina"}` });
      ask({ t: "ponteValoriAltrove", pagina, altro });
      return;
    } else {
      try {
        const ep = v.ep, nome = panel.nomePaziente();
        if (modo === "apri") {
          const an = anagraficaPagina(document);
          rememberPatient(ep, nomeInPagina(), location.href, triageDi(document), an.eta, an.sesso, improntaNascita(nascitaInPagina(document)));
          cartellaLettaQui(ep);
        }
        if (modo === "tabellone") {
          panel.log(`${now()}  ── ⟳ del tabellone: ${nome}, riletto dietro ──`);
          await panel.autoCarica({ referti: false }).catch(() => null);
          esito = { ok: true, testo: "riletto" };
        } else {
          panel.log(`${now()}  ── iPhone: ${modo === "apri" ? "aperto dal telefono" : modo === "auto" ? "i valori nuovi, da soli" : "«Aggiorna i valori»"} per ${nome} ──`);
          const firma = firmaLab(document, location.href);
          const lab = panel.esiti.some((e) => !e.storico && (e.kind === "valori" || refertoTipo(e) === "lab"));
          const letto = await panel.caricaValori();
          // come all'apertura sul PC: la firma del laboratorio letto, così nessuno lo rilegge da solo
          if (letto) {
            const t = store.get(AUTO_CARICA, {}) || {};
            t[ep] = { ...(t[ep] || {}), ts: Date.now(), lab: firma, parz: Date.now() };
            store.set(AUTO_CARICA, t);
            togliFallito(ep, "lab");
          } else if (daSe && lab) segnaFallito(ep, "lab", { firma });
          // i valori ci sono (lo si dice: allo scadere, il telefono ha almeno
          // quelli); poi i referti (RX, ECG, TC…) non ancora salvati, uno alla
          // volta finché c'è tempo — e il telefono ha tutto con una risposta sola
          ask({ t: "ponteValoriLetti", ok: true, testo: "letti" }).catch(() => {});
          const fine = Date.now() + 90e3;
          await panel.caricaReferti({ ferma: () => Date.now() > fine, ...(daSe ? { auto: true } : {}) }).catch(() => {});
          esito = { ok: true, testo: "letti" };
        }
      } catch (e) { esito = { ok: false, testo: `non letti: ${e?.head || e?.message || e}` }; }
    }
    ask({ t: "ponteValoriFatto", ...esito });
  }

  // ---- la cartella dal telefono: anamnesi, remota, farmaci, allergie, EO ----
  // I campi del modulo AmbulatorioPSO della pagina del paziente. Sul telefono
  // si scrive un campo se e solo se l'ultima lettura della pagina lo dava
  // scrivibile (presente, né readonly né disabled, né una classe di sola
  // lettura come JPSOReadonly): la stessa regola per tutti e cinque, e si
  // ricontrolla sulla scheda che salva. Si salva solo col «Conferma» della
  // pagina, in una scheda di sottofondo: mai un invio costruito qui.
  const CARTELLA_CAMPI = [["ANAMNESI", "Anamnesi"], ["MALATTIE_PREGRESSE", "Anamnesi remota"], ["FARMACI_ASSUNTI", "Farmaci"], ["ALLERGIE", "Allergie"], ["ESAME_OBIETTIVO", "Esame obiettivo"]];
  const cartellaNome = (n) => (CARTELLA_CAMPI.find(([k]) => k === n) || [n, n])[1];
  const normTesto = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const formCartella = (doc, ep) => [...doc.querySelectorAll('form[name="AmbulatorioPSO"]')]
    .find((f) => !!ep && param(f.getAttribute("action") || "", "EPISODIO_ID") === ep) || null;
  const cartellaChiusa = (ta) => !ta || ta.readOnly || ta.disabled || ta.hasAttribute("readonly") || ta.hasAttribute("disabled") || /readonly/i.test(ta.className || "");
  // (i testi come la pagina li ha caricati: defaultValue, non quello che qualcuno sta scrivendo)
  function cartellaPagina(doc, ep) {
    const f = formCartella(doc, ep);
    if (!f) return null;
    const conferma = !!f.querySelector('input[type="submit"][name="Update"]');
    const campi = [];
    for (const [nome] of CARTELLA_CAMPI) {
      const ta = f.querySelector(`textarea[name="${nome}"]`);
      if (ta) campi.push({ nome, v: ta.defaultValue, ro: !conferma || cartellaChiusa(ta) });
    }
    return campi.length ? { ep, letto: Date.now(), campi } : null;
  }
  // Ogni volta che il medico apre la pagina di un paziente: la sua lettura va
  // al service worker (che la tiene in memoria, solo con un iPhone associato).
  function cartellaLettaQui(ep) {
    if (!hasExt() || !ep) return;
    const c = cartellaPagina(document, ep);
    if (c) ask({ t: "ponteCartellaLetta", ep, cartella: c }).catch(() => {});
  }
  // Il comando `cartella`: l'ultima lettura (data dal service worker), o la
  // pagina del paziente riletta (solo lettura, e solo se è del suo episodio).
  // Con la lettura, le allergie con le parole del PC (`ponteAllergie`): il telefono le mette sotto il nome e nel
  // riepilogo della Terapia — una verità sola con il campo Allergie che mostra.
  async function ponteCartella(p, a) {
    const m = a.memo;
    if (!a.rileggi && m && m.ep === p.ep && Array.isArray(m.campi)) return { ok: true, dati: { ...m, allergie: ponteAllergie(p.ep) }, registro: `cartella di ${p.name}` };
    const url = ponteUrlPaziente(p);
    if (!url) return nonQui(p);
    const { doc, url: fin } = await fetchDoc(url, {});
    if (classify(doc) === "login") return { ok: false, errore: "Gestionale da riaprire: sul PC la sessione è scaduta", sessione: true };
    if (findEpisodeId(doc, fin) !== p.ep) return { ok: false, errore: "La pagina del paziente sul PC è di un altro episodio: non mostro niente" };
    const c = cartellaPagina(doc, p.ep);
    if (!c) return { ok: false, errore: "Nella pagina del paziente sul PC non c'è la cartella" };
    segnaAnag(p.ep, doc);
    return { ok: true, dati: { ...c, allergie: ponteAllergie(p.ep) }, nuova: true, registro: `cartella di ${p.name} (riletta)` };
  }
  // In una scheda del medico: c'è, per questo paziente, un testo cambiato e
  // non salvato in uno di quei campi? (rispetto a come la pagina l'ha caricato)
  function cartellaSporca(ep, nomi) {
    if (LAVORO || PONTE_VALORI || PONTE_CARTELLA || PONTE_TERAPIA) return [];
    const f = formCartella(document, ep);
    if (!f) return [];
    return (Array.isArray(nomi) ? nomi : []).filter((n) => {
      const ta = f.querySelector(`textarea[name="${n}"]`);
      return !!ta && normTesto(ta.value) !== normTesto(ta.defaultValue);
    });
  }
  // C'è qui qualcosa scritto e non salvato — un testo, una spunta, una scelta, in un modulo qualunque della
  // pagina —, o il medico ha il cursore in un campo (anche del pannello)? Allora la pagina non si ricarica da
  // sola: si perderebbe. Nel dubbio, «toccata» (resta ferma e lo dice). (Il fuoco su un TASTO del pannello
  // non conta: ci resta da solo, ridisegno dopo ridisegno, dall'ultimo clic.)
  const campoCursore = (a) => !!a && (a.isContentEditable || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || (a.tagName === "INPUT" && !/^(hidden|submit|button|image|reset)$/.test(a.type)));
  function paginaToccata() {
    if (PANNELLO && campoCursore(PANNELLO.root.activeElement)) return true;
    if (campoCursore(document.activeElement)) return true;
    return [...document.querySelectorAll("textarea, input, select")].some((el) =>
      el.tagName === "SELECT" ? (el.multiple ? [...el.options].some((o) => o.selected !== o.defaultSelected) : el.options.length > 0 && el.selectedIndex !== Math.max(0, [...el.options].findIndex((o) => o.defaultSelected)))
      : el.type === "checkbox" || el.type === "radio" ? el.checked !== el.defaultChecked
      : !/^(hidden|submit|button|image|reset|file)$/.test(el.type) && normTesto(el.value) !== normTesto(el.defaultValue));
  }
  // La pill «Aggiornato dal telefono · Ricarica», adesso: il ridisegno rimette il fuoco sul tasto del pannello
  // dov'era. Un campo del pannello col cursore dentro non si ridisegna sotto le dita (quello che c'è scritto
  // potrebbe non sopravvivere): la pill arriva appena lo si lascia — e il «Conferma» è fermo da subito.
  function pontePill() {
    if (!PANNELLO || !PONTE_AGG) return;
    if (!campoCursore(PANNELLO.root.activeElement)) { PANNELLO.render(); return; }
    PANNELLO.root.addEventListener("focusout", () => setTimeout(pontePill, 0), { once: true });
  }
  // Il «Conferma» della cartella di una pagina di prima (il telefono l'ha salvata dopo che si è aperta): fermo,
  // anche cliccato da qualcun altro (un tasto, il pannello), finché la pagina non si ricarica — mai i testi
  // vecchi sopra quelli del telefono. Lo dice, col perché e la strada.
  function confermaFerma(e) {
    if (!PONTE_AGG) return;
    const f = formCartella(document, PONTE_AGG), t = e.target;
    if (!f || !t) return;
    const tasto = e.type === "click" && t.closest ? t.closest('input[type="submit"], input[type="image"], button[type="submit"], button:not([type])') : null;
    if (e.type === "submit" ? t !== f : !tasto || tasto.form !== f) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    terapiaDice("err", "il telefono ha salvato la cartella dopo che questa pagina si è aperta: «Conferma» qui rimanderebbe i testi di prima. Niente inviato. Copia quello che hai scritto, poi ricarica la pagina.",
      { testo: "Ricarica", fai: ponteRicarica }, "Cartella");
  }
  // «Ricarica» sulla pill: la pagina del paziente, con l'indirizzo che il
  // gestionale ha dato (una GET: mai il modulo inviato di nuovo). Senza il
  // «#…» (i link «href="#"» della pagina lo lasciano): con quello sarebbe solo
  // un salto nella stessa pagina, e la pagina di prima resterebbe.
  function ponteRicarica() {
    const v = new URL(ponteUrlPaziente(pontePaziente(PONTE_AGG)) || location.href);
    v.hash = "";
    location.assign(v.href);
  }
  // La scheda aperta dal ponte per salvare. Prima volta («compila»): ogni
  // campo dev'essere ancora scrivibile e uguale a quello che il telefono ha
  // visto (`prima`) — se no niente, tutti o nessuno —; poi si scrivono i testi
  // e si clicca il «Conferma» della pagina. Dopo il ricaricamento («inviato»):
  // si rilegge la pagina e si dice, campo per campo, se c'è il testo nuovo.
  async function ponteCartellaQui() {
    const c = PONTE_CARTELLA;
    const fine = (esito) => ask({ t: "ponteCartellaFatto", ...esito });
    if (SOLA_LETTURA) return fine({ ok: false, testo: "questo PC è in sola lettura" });   // secondo muro: la scheda non scrive mai sul mini
    if (!c || c.fase === "perso" || !c.campi) return fine({ ok: false, testo: "la scheda non sa più che cosa salvare" });
    const dopo = c.fase === "inviato";
    if (classify(document) !== "patient" || findEpisodeId(document, location.href) !== c.ep || !formCartella(document, c.ep)) {
      return fine({ ok: false, incerto: dopo, testo: dopo ? "dopo «Conferma» il gestionale non ha mostrato la pagina del paziente" : "la scheda ha aperto un'altra pagina: niente salvato" });
    }
    const f = formCartella(document, c.ep);
    const nomi = Object.keys(c.campi);
    // (la pagina com'è adesso, con le sue allergie: le rileggono anche il telefono e la riga sotto il nome)
    const rilette = () => { segnaAnag(c.ep, document); const l = cartellaPagina(document, c.ep); return l && { ...l, allergie: ponteAllergie(c.ep) }; };
    if (dopo) {
      const letta = rilette();
      const verificati = Object.fromEntries(nomi.map((n) => {
        const x = letta.campi.find((y) => y.nome === n);
        return [n, !!x && normTesto(x.v) === normTesto(c.campi[n].dopo)];
      }));
      return fine({ ok: nomi.every((n) => verificati[n]), verificati, letta });
    }
    const btn = f.querySelector('input[type="submit"][name="Update"]');
    if (!btn) return fine({ ok: false, testo: "nella pagina non c'è «Conferma»" });
    const chiusi = [], cambiati = [];
    for (const n of nomi) {
      const ta = f.querySelector(`textarea[name="${n}"]`);
      if (cartellaChiusa(ta)) chiusi.push(n);
      else if (normTesto(ta.value) !== normTesto(c.campi[n].prima)) cambiati.push(n);
    }
    // (niente scritto, niente cliccato: e la lettura fresca va al telefono)
    if (chiusi.length) return fine({ ok: false, chiusi, testo: "non più modificabile", letta: rilette() });
    if (cambiati.length) return fine({ ok: false, cambiati, testo: "cambiato sul PC", letta: rilette() });
    // il service worker lo annota PRIMA del clic: la pagina che torna si verifica, non si ricompila
    const via = await ask({ t: "ponteCartellaInvio" });
    if (!via || !via.ok) return;
    for (const n of nomi) {
      const ta = f.querySelector(`textarea[name="${n}"]`);
      ta.value = c.campi[n].dopo;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
    }
    btn.click();   // il «Conferma» della pagina: il modulo lo manda il browser, come sempre
  }

  // ---- la pagina Terapia dal telefono: leggere, cercare nella tendina, aggiungere ----
  // Una scheda di sottofondo, aperta dal service worker sulla pagina del
  // paziente (l'indirizzo del gestionale); da lì il SUO pulsante «Terapia».
  // Sulla pagina delle terapie i controlli del giro del PC — l'episodio
  // dell'indirizzo e del modulo, il nome, la tabella: se no Errore grave — e
  // una cosa sola: leggere, cercare nella tendina, o aggiungere un farmaco.
  // Aggiungere è il giro del PC fino alla riga scritta e riletta (un dubbio
  // qualunque: stop, niente confermato), poi il «Conferma» della pagina, una
  // volta: il service worker lo annota prima del clic, e la pagina che torna
  // (o si ricarica) si guarda e basta.
  async function ponteTerapiaQui() {
    const c = PONTE_TERAPIA;
    // (finito il lavoro, la scheda tenuta per il telefono aspetta il prossimo: il suo PONTE_TERAPIA è «fermo»)
    // (…o, se il service worker l'aveva già lasciata a metà lavoro — finita per tempo, col medico entrato —, da
    // adesso è una pagina come le altre, qui com'è: come «ponteTerapiaLasciata»)
    const fine = (esito) => {
      PONTE_TERAPIA = c ? { ep: c.ep, fase: "fermo" } : null;
      return ask({ t: "ponteTerapiaFatto", ...esito }).then((r) => {
        if (r && r.lasciata && PONTE_TERAPIA && PONTE_TERAPIA.fase === "fermo") {
          PONTE_TERAPIA = null;
          ask({ t: "ordineChi" }).then((x) => bootGestionale(x && x.ok ? x : null));
        }
        return r;
      });
    };
    if (c && c.fase === "fermo") return;
    if (!c || c.fase === "perso") return fine({ ok: false, testo: "la scheda non sa più che cosa fare" });
    const dopo = c.fase === "inviato", ordine = "un ordine sta ancora lavorando sul PC: riprova fra poco";
    if (!eTerapie()) {
      if (dopo) return fine({ ok: false, incerto: true, testo: "dopo «Conferma» il gestionale non ha mostrato la pagina delle terapie" });
      if (c.fase !== "apro" || classify(document) !== "patient" || findEpisodeId(document, location.href) !== c.ep) return fine({ ok: false, testo: "la scheda ha aperto un'altra pagina" });
      const nome = nomeInPagina();
      if (!nome || !ugualeTer(nome, c.nome)) return fine({ ok: false, grave: "nome diverso" });
      const a = linkTerapia(c.ep);
      if (!a) return fine({ ok: false, testo: "nella pagina del paziente sul PC non c'è il pulsante «Terapia»" });
      if (!(await terapiaAspetta())) return fine({ ok: false, testo: ordine });
      const via = await ask({ t: "ponteTerapiaPagina" });
      if (via && via.ok) a.click();   // il SUO pulsante: mai un indirizzo fatto qui
      return;
    }
    const form = formTerapia();
    if (!form) return fine({ ok: false, incerto: dopo, testo: "non è la pagina della prescrizione" });
    const altro = terapiaDiChi(form, c.ep, c.nome);
    if (altro) return fine({ ok: false, incerto: dopo, grave: altro });
    if (form.querySelector('table[id^="TerapiaTable"]')?.id !== "TerapiaTable" + c.ep) return fine({ ok: false, incerto: dopo, testo: "non riconosco la tabella delle terapie" });
    // la scheda tenuta, prima di leggere o di scrivere: la pagina di adesso, col SUO pulsante «Prescrizione» (una
    // GET) — e il lavoro si fa sulla pagina che torna, coi controlli di sempre
    if (c.fase === "rileggo") {
      const a = linkTerapia(c.ep);
      if (!a) return fine({ ok: false, testo: "nella pagina Terapia non c'è il pulsante «Prescrizione»" });
      if (!(await terapiaAspetta())) return fine({ ok: false, testo: ordine });
      const via = await ask({ t: "ponteTerapiaPagina" });
      if (via && via.ok) a.click();
      return;
    }
    const lettura = terapieLette(form, c.ep), v = c.voce;
    // dopo «Conferma»: la terapia è fra le confermate, con un TERAPIA_PROG che prima non c'era?
    if (dopo) {
      const prima = new Set(c.prima || []);
      const riga = lettura.righe.find((r) => r.prog && !prima.has(r.prog) && ugualeTer(r.descr, v.descr) && r.qta === normTer(v.qta)
        && ugualeTer(r.um, v.um ? v.um.t : "") && ugualeTer(r.via, v.via ? v.via.t : ""));
      return fine(riga ? { ok: true, riga, lettura } : { ok: false, incerto: true, testo: "dopo «Conferma» la terapia non si vede fra le confermate", lettura });
    }
    if (c.cosa === "leggi") return fine({ ok: true, lettura });
    const nuove = righeTerapia(form).filter((r) => !r.salvata), d = document.getElementById("DESCRIZIONE");
    if (nuove.length !== 1 || nuove[0].descr !== d || !d.classList.contains("ui-autocomplete-input")) return fine({ ok: false, testo: "la tendina dei farmaci della pagina non è pronta", lettura });
    if (c.cosa === "cerca") {
      if (!(await terapiaAspetta())) return fine({ ok: false, testo: ordine, lettura });
      const voci = await tendinaTerapia(d, c.q);
      if (voci === null) return fine({ ok: false, testo: "la tendina dei farmaci non risponde", lettura });
      return fine({ ok: true, voci: voci.map((li) => normTer(li.textContent)).filter(Boolean), lettura });
    }
    // aggiungere: già confermata dopo la lettura del telefono? Forse è la sua
    // (una risposta persa): mai una seconda alla cieca
    if (SOLA_LETTURA) return fine({ ok: false, testo: "questo PC è in sola lettura" });   // secondo muro: il mini legge e cerca i farmaci, ma non conferma
    const visti = new Set(c.visti || []);
    if (lettura.righe.some((r) => r.prog && !visti.has(r.prog) && ugualeTer(r.descr, v.descr))) {
      return fine({ ok: false, gia: true, testo: `«${v.descr}» c'è già fra le terapie confermate, dopo la tua lettura: rileggi e controlla`, lettura });
    }
    const btn = form.querySelector('input[type="submit"][name="Update"]');
    if (!btn) return fine({ ok: false, testo: "nella pagina non c'è «Conferma»", lettura });
    const r = await riempiTerapia(form, v, Date.now()).catch(() => ({ stop: "errore nel riempire la riga" }));
    if (!r.ok) return fine({ ok: false, testo: r.stop || r.breve || r.tocca, perche: r.perche || "riga non scritta", lettura });
    const diverso = rilettaTer(form, nuove[0].n, v);
    if (diverso) return fine({ ok: false, testo: `riletta la riga, ${diverso} non è quella scelta`, perche: "rilettura diversa", lettura });
    if (!(await terapiaAspetta())) return fine({ ok: false, testo: ordine, lettura });
    // il service worker lo annota PRIMA del clic: la pagina che torna si guarda, non si riscrive
    const via = await ask({ t: "ponteTerapiaInvio", prima: lettura.righe.map((x) => x.prog) });
    if (!via || !via.ok) return;
    try { imparaTerapia([rigaTerapia(form, nuove[0].n)]); } catch { /* memoria piena: nessun preferito */ }
    btn.click();   // il «Conferma» della pagina: TERAPIA_SERIALIZED lo compone lei, il modulo lo manda il browser
  }

  // ---- Chi il PC conosce solo dalla lista smart, aperto dal telefono ----
  // La sua pagina il PC non ce l'ha (la smart non porta link, e un indirizzo
  // non si costruisce): la dà la riga della lista della sua area. Se è l'area
  // in testa al gestionale adesso, la lista si legge dietro (ponteListaQui,
  // una lettura come quella del medico che la apre: leggiAreaPagina, e
  // fondiSmart gli dà il suo episodio). Qui, nella scheda del medico, solo chi
  // è e il link della lista: quello della pagina, o la stessa pagina del menu.
  function ponteListaChi(p) {
    if (ponteUrlPaziente(p)) return { ok: true, dati: { ep: p.ep, gia: true } };
    const k = areeLeggi().membri[p.ep]?.k, ora = store.get(AREA_ORA, null);
    if (!k || !ora || ora.k !== k || !p.nato) return nonQui(p);
    return { ok: true, dati: { ep: p.ep, k, nome: normNome(p.name), nato: p.nato, url: urlMenu("PsoPazientiAmbulatorio") } };
  }
  // «Passa il PC all'area X e apri ROSSI M.»: il tocco del medico sul telefono è
  // un clic sulla riga della lista smart (smartApri), in questa scheda — la sua,
  // davanti: PsoPsoImposta, la tendina sull'area (una sola, riconosciuta dal
  // nome), «Conferma», la lista dell'area e il link della sua riga
  // (apriArea/areaVaiQui). Cambia l'area della sessione del gestionale, per
  // tutte le schede: lo dicono il Registro, la pagina dove si atterra e il
  // telefono. Mai con un ordine al lavoro, mai sopra un passaggio d'area, mai su
  // una pagina dove il medico ha scritto qualcosa e non l'ha salvato.
  const AREA_TEL_RQ = "area.tel.rq.v1";   // i numeri dei tocchi già dati a una scheda (gli ultimi 30)
  function ponteAreaApri(p, a) {
    if (ponteUrlPaziente(p)) return { ok: true, dati: { ep: p.ep, gia: true, nome: p.name } };   // la sua pagina c'è già: niente da passare
    const k = areeLeggi().membri[p.ep]?.k, nome = k ? areaVaiNome(k) : "";
    if (!k) return { ok: false, errore: "Il PC non sa in che area è: aprilo sul PC, dalla lista smart" };
    // (già su quell'area — un telefono rimasto indietro, un secondo tocco dopo «PC ora sull'area …»: niente da
    // passare, e la scheda del medico non si muove)
    const ora = store.get(AREA_ORA, null);
    if (ora && ora.k === k) return { ok: false, errore: "Il PC è già su quell'area: aprilo dalla lista" };
    const chi = p.nato ? { nome: normNome(p.name), nato: p.nato } : null;
    if (!chi || tuttiPazienti().filter((x) => normNome(x.name) === chi.nome && x.nato === chi.nato).length !== 1) {
      return { ok: false, errore: "Sul PC non so riconoscerlo da solo: aprilo sul PC, dalla lista smart" };
    }
    const opz = store.get(AREE_OPZ, null);
    if (opz && Object.keys(opz).length && !opz[k]) return { ok: false, errore: `In Imposta il gestionale non offre l'area ${nome}: niente cambiato` };
    const vai = store.get(AREA_VAI, null);
    if (vai && Date.now() - (vai.ts || 0) <= AREA_VAI_MS) return { ok: false, errore: "Sul PC il gestionale sta già cambiando area: riprova fra poco" };
    if (motoreOvunque()) return { ok: false, errore: "Un ordine sta lavorando sul PC: riprova quando ha finito — niente cambiato" };
    if (paginaToccata()) return { ok: false, errore: "Sul PC, nella pagina del gestionale, c'è qualcosa di scritto e non salvato: niente cambiato" };
    const rq = typeof a.rq === "string" && /^[\w-]{8,40}$/.test(a.rq) ? a.rq : "";
    if (!rq) return { ok: false, errore: "Richiesta non valida: niente cambiato" };
    // (un numero già dato a una scheda — anche a un'altra: la memoria è del gestionale — non muove più niente)
    const dati = store.get(AREA_TEL_RQ, []), visti = Array.isArray(dati) ? dati : [];
    if (visti.includes(rq)) return { ok: false, incerto: true, errore: "Già chiesto: guarda sul PC su che area è il gestionale" };
    store.set(AREA_TEL_RQ, [...visti, rq].slice(-30));
    // (la risposta parte prima della pagina nuova)
    apriArea(k, chi, (u) => { setTimeout(() => nav(u), 150); return true; }, rq);
    return { ok: true, dati: { ep: p.ep, k, area: nome, nome: p.name }, registro: `passo il gestionale all'area ${nome} e apro ${p.name}` };
  }

  // La scheda dietro della lista dell'area (ponteListaSotto): sulla lista, la
  // sua area dev'essere quella del paziente — se no ci si ferma, niente
  // cambiato —; poi la lista si legge come quando la apre il medico
  // (leggiAreaPagina: chi c'è entra, col link della sua riga; fondiSmart passa
  // a lui posto, «Da fare» e area). La riga: nome e impronta della nascita,
  // una sola; e il paziente che ora porta quell'episodio dev'essere lui, col
  // link della sua riga — se no «Errore grave», e niente si riprova.
  async function ponteListaQui() {
    const c = PONTE_LISTA;
    const fine = (esito) => ask({ t: "ponteListaFatto", ...esito });
    if (!c || c.fase === "perso" || !c.ep || !c.k || !c.nome || !c.nato) return fine({ ok: false, testo: "la scheda non sa più che cosa fare" });
    const nome = areaVaiNome(c.k);
    if (!eListaArea(document, location.href)) {
      // (una pagina di passaggio — PsoPazienti, che rimanda alla lista —: si aspetta la lista; il service worker ha il suo tempo)
      if (mvpgDi(document, location.href) === "PsoPazienti") return;
      return fine({ ok: false, testo: "il gestionale non ha aperto la lista dell'area" });
    }
    const testa = areaInTesta(document);
    leggiAreaPagina(document, location.href);   // come il medico che la apre: anche se è un'altra area, è quella che il gestionale mostra
    if (!testa) return fine({ ok: false, testo: "la lista non dice su che area è il gestionale" });
    if (testa.k !== c.k) return fine({ ok: false, altra: true, testo: `il gestionale sul PC è sull'area ${titoloArea(testa.k, testa.label)}, non ${nome}` });
    const sue = righeLista(document, location.href).filter((r) => normNome(r.name) === c.nome && improntaNascita(r.nato) === c.nato);
    if (!sue.length) return fine({ ok: false, testo: `non è nella lista dell'area ${nome}, sul PC` });
    if (sue.length > 1) return fine({ ok: false, testo: `due righe uguali nella lista dell'area ${nome}: aprilo sul PC` });
    const r = sue[0], q = pontePaziente(r.ep);
    if (!q || normNome(q.name) !== c.nome || (q.nato && q.nato !== c.nato) || param(q.url || "", "EPISODIO_ID") !== r.ep) return fine({ ok: false, grave: "nome o episodio diverso" });
    return fine({ ok: true, ep: r.ep, area: nome });
  }

  // ---- «Accetta in ambulatorio» dal telefono: la freccia della riga nella lista del triage ----
  // Chi: una riga del Triage del telefono (la chiave di nome e nascita della
  // lista smart) o un paziente noto al PC ancora al triage (l'episodio). Qui,
  // in una scheda del medico, solo chi è e l'indirizzo della lista del triage
  // (il link della pagina, o la stessa pagina del menu); il resto lo fa una
  // scheda di sottofondo (ponteAccettaQui).
  function ponteAccetta(a) {
    let chi = null;
    if (a.ep) {
      const p = pontePaziente(a.ep);
      if (!p) return { ok: false, errore: "Questo paziente non è più nell'elenco del PC" };
      if (p.arch) return { ok: false, errore: "Dimesso sul PC: niente fatto", dimesso: true };
      if (PANNELLO.pazModello().info.get(p.ep)?.prec) return { ok: false, errore: "Episodio precedente: niente fatto" };
      if (!ponteInTriage(p)) return { ok: false, errore: "Non è più al triage sul PC: niente fatto" };
      chi = { ep: p.ep, nome: p.name, ...(p.nato ? { k: chiaveSmart(p.name, p.nato) } : {}) };
    } else if (a.k) {
      // la riga si ritrova con la STESSA chiave che il comando «triage» manda al
      // telefono — chiaveTriage (nome e ora d'arrivo) —, non con la chiaveSmart
      // (nome e nascita) che la riga salvata porta con sé: sono due chiavi diverse.
      const t = store.get(TRIAGE_LISTA, null), r = (Array.isArray(t?.righe) ? t.righe : []).filter((x) => x && x.nome && chiaveTriage(x) === a.k);
      if (r.length !== 1) return { ok: false, errore: r.length ? "Due righe uguali al Triage: accettalo sul PC" : "Non è più al Triage sul PC: niente fatto" };
      // nome e area per i controlli e il messaggio; l'episodio solo se la riga ce l'ha (un ospite no)
      chi = { k: a.k, nome: r[0].nome, area: Object.keys(AREE_TITOLO).find((k) => AREE_TITOLO[k] === r[0].area) || "", ...(r[0].ep ? { ep: r[0].ep } : {}) };
    }
    if (!chi || !chi.nome) return { ok: false, errore: "Paziente non valido: niente fatto" };
    return { ok: true, dati: { url: urlMenu("PsoPazientiTriage"), ...chi } };
  }
  // l'ora d'arrivo della riga del triage (la colonna dell'ingresso, come la
  // smart): serve a riconoscere un ospite per chiaveTriage (nome e arrivo) — la
  // stessa chiave del telefono — quando la riga non ha un episodio nostro.
  function arrivoTriageRiga(tr) {
    const ing = tr.querySelector('td[name="INGRESSO"]');
    for (const td of ing ? [ing] : [...tr.children].filter((c) => c.tagName === "TD")) {
      const m = /\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}|\d{1,2}:\d{2}/.exec(spazi(td.textContent));
      if (m) { const v = arrivoDa(m[0]); if (v) return v; }
    }
    return 0;
  }
  // Le righe della lista del triage (PsoPazientiTriage: una per area, chi è al
  // triage per l'area in testa): il link «Apri Episodio» con la linguetta
  // (nome e nascita), l'ora d'arrivo e le frecce «Accetta in ambulatorio» della stessa riga.
  function righeTriage(doc, base) {
    const out = [];
    for (const a of doc.querySelectorAll('a[href*="MVPG=PsoEpisodioClinicoTriage"]')) {
      const div = a.querySelector(".myLinguetta"), tr = a.closest("tr"), l = div && linguettaDi(div);
      if (!l || !tr) continue;
      let ep = "";
      try { ep = new URL(a.getAttribute("href") || "", base).searchParams.get("EPISODIO_ID") || ""; } catch { continue; }
      out.push({ ep, ...l, arrivo: arrivoTriageRiga(tr), frecce: [...tr.querySelectorAll('a[name="AccettaAMBU"]')] });
    }
    return out;
  }
  // La scheda di sottofondo. Sulla lista del triage: la riga di QUEL paziente
  // — per episodio, o per nome e ora d'arrivo (chiaveTriage); una sola —, col suo nome (diverso:
  // Errore grave), e la SUA freccia, dello stesso episodio. Ogni dubbio:
  // niente cliccato. Il service worker annota «inviato» PRIMA del clic, una
  // volta. Dopo si guarda e basta: «In ambulatorio» solo con la pagina del
  // paziente in ambulatorio (il modulo dell'ambulatorio, quell'episodio, quel
  // nome) o con la lista dell'ambulatorio che lo mostra — tornati sulla lista
  // del triage senza di lui, si apre quella col suo link —; se no, incerto.
  const ACCETTA_PASSAGGIO_MS = 10e3;   // le pagine di passaggio se ne vanno da sole in un attimo
  async function ponteAccettaQui() {
    const c = PONTE_ACCETTA;
    const fine = (esito) => ask({ t: "ponteAccettaFatto", ...esito });
    if (SOLA_LETTURA) return fine({ ok: false, testo: "questo PC è in sola lettura" });   // secondo muro: niente «Accetta» dal mini
    if (!c || c.fase === "perso" || !c.nome) return fine({ ok: false, incerto: !!c && c.fase !== "lista", testo: "la scheda non sa più che cosa fare" });
    const mvpg = mvpgDi(document, location.href), testa = areaInTesta(document), area = testa ? titoloArea(testa.k, testa.label) : "";
    if (c.fase === "lista") {
      if (mvpg !== "PsoPazientiTriage" || !testa) return fine({ ok: false, testo: "la scheda non ha aperto la lista del triage" });
      // per episodio quando il PC lo conosce (il più sicuro), se no per la stessa
      // chiaveTriage (nome e arrivo) che il telefono porta — mai la chiaveSmart
      const sue = righeTriage(document, location.href).filter((r) => (c.ep ? r.ep === c.ep : chiaveTriage({ nome: r.name, arrivo: r.arrivo }) === c.k));
      if (!sue.length) {
        return fine({ ok: false, testo: c.area && c.area !== testa.k ? `è al triage per ${titoloArea(c.area)}, il gestionale sul PC è su ${area}`
          : `non è nella lista del triage di ${area}, sul PC` });
      }
      if (sue.length > 1) return fine({ ok: false, testo: "due righe uguali nella lista del triage" });
      const r = sue[0];
      if (normNome(r.name) !== normNome(c.nome)) return fine({ ok: false, grave: "nome diverso" });
      if (r.frecce.length !== 1) return fine({ ok: false, testo: "nella sua riga non c'è la freccia «Accetta in ambulatorio»" });
      const f = r.frecce[0];
      let u = null;
      try { u = new URL(f.getAttribute("href") || "", location.href); } catch { /* sotto */ }
      if (!u || u.origin !== location.origin || !/\/menuPsoEpisodio\.do$/i.test(u.pathname) || u.searchParams.get("MVPG") !== "PsoEpisodioTriageToAmbulatorio") {
        return fine({ ok: false, testo: "la freccia della sua riga non è quella che conosco" });
      }
      if (!/^[\w.-]{1,40}$/.test(r.ep) || u.searchParams.get("EPISODIO_ID") !== r.ep) return fine({ ok: false, grave: "episodio diverso" });
      // (la freccia porta la risorsa dell'area in testa: se il PC la conosce, dev'essere quella)
      const ris = (store.get(AREE_OPZ, {}) || {})[testa.k]?.id, risF = u.searchParams.get("RISORSA_ID");
      if (ris && risF && ris !== risF) return fine({ ok: false, testo: "la freccia porta a un'altra area" });
      if (!(await accettaAspetta())) return fine({ ok: false, testo: "un ordine sta ancora lavorando sul PC: riprova fra poco" });
      // il service worker lo annota PRIMA del clic: da qui in poi si guarda e basta
      const via = await ask({ t: "ponteAccettaInvio", ep: r.ep });
      if (via && via.ok) f.click();   // la SUA freccia: l'indirizzo è quello della pagina, mai fatto qui
      return;
    }
    // dopo il clic (ep: quello della riga cliccata)
    const ep = c.ep;
    if (!ep) return fine({ ok: false, incerto: true, testo: "la scheda non sa più quale episodio" });
    const qui = param(location.href, "EPISODIO_ID") === ep;
    const f = qui ? formCartella(document, ep) : null;
    if (f && param(f.getAttribute("action") || "", "MVPG") === "PsoEpisodioClinicoAmbulatorio") {
      if (normNome(nomeInPagina()) !== normNome(c.nome)) return fine({ ok: false, incerto: true, grave: "nome diverso dopo il clic" });
      accettatoQui(c, ep, true);
      return fine({ ok: true, area });
    }
    // le pagine di passaggio (PsoEpisodioTriageToAmbulatorio col suo script, PsoEpisodio e PsoPazienti col loro refresh)
    if ((qui && (mvpg === "PsoEpisodioTriageToAmbulatorio" || mvpg === "PsoEpisodio")) || mvpg === "PsoPazienti") {
      setTimeout(() => fine({ ok: false, incerto: true, testo: "dopo il clic il gestionale si è fermato a metà" }), ACCETTA_PASSAGGIO_MS);
      return;
    }
    // tornati sulla lista del triage: lui c'è ancora? Se no, la lista dell'ambulatorio (il suo link) lo dice
    if (mvpg === "PsoPazientiTriage" && c.fase === "inviato") {
      if (righeTriage(document, location.href).some((r) => r.ep === ep)) return fine({ ok: false, incerto: true, testo: "dopo il clic è ancora nella lista del triage" });
      const via = await ask({ t: "ponteAccettaVerifica" });
      if (via && via.ok) location.assign(urlMenu("PsoPazientiAmbulatorio"));
      return;
    }
    if (eListaArea(document, location.href)) {
      const r = righeLista(document, location.href).filter((x) => x.ep === ep);
      if (r.length !== 1) return fine({ ok: false, incerto: true, testo: "non lo vedo nella lista dell'ambulatorio" });
      if (normNome(r[0].name) !== normNome(c.nome)) return fine({ ok: false, incerto: true, grave: "nome diverso dopo il clic" });
      accettatoQui(c, ep, false);
      return fine({ ok: true, area });
    }
    return fine({ ok: false, incerto: true, testo: "dopo il clic il gestionale ha aperto un'altra pagina" });
  }
  // (un ordine al lavoro in un'altra scheda: la stessa sessione del server — si aspetta, prima del clic)
  async function accettaAspetta() {
    try {
      const o = await chrome.storage.session.get(["ordini", "motore"]);
      if (Array.isArray(o && o.ordini)) ORDINI_VIVI = o.ordini;
      MOTORE_SW = (o && o.motore) || null;
    } catch { /* resta quello che si sa */ }
    await cancelloMotore();
    return !motoreAltrove();
  }
  // Accettato: il PC lo conosce come lo conoscerebbe aprendolo (la sua pagina,
  // o la sua riga della lista dell'area) e dal Triage del telefono se ne va.
  function accettatoQui(c, ep, pagina) {
    leggiAreaPagina(document, location.href);
    if (pagina) {
      const an = anagraficaPagina(document);
      rememberPatient(ep, nomeInPagina(), location.href, triageDi(document), an.eta, an.sesso, improntaNascita(nascitaInPagina(document)));
    }
    const t = store.get(TRIAGE_LISTA, null);
    // via dal Triage del telefono: per chiaveSmart salvata nella riga (un paziente
    // noto) o per chiaveTriage ricalcolata (un ospite, la cui riga non ha `.k`)
    if (c.k && Array.isArray(t?.righe)) store.set(TRIAGE_LISTA, { ...t, righe: t.righe.filter((r) => r && r.k !== c.k && chiaveTriage(r) !== c.k) });
  }

