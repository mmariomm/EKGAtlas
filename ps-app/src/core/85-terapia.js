//@frammento 85-terapia.js — La terapia: lettura e compilazione della pagina delle terapie del gestionale.
  // ---------------------------------------------------------- la terapia
  // La pagina delle terapie del gestionale: PsoEpisodioTerapieImposta con
  // MODALITA=PRESCRIZIONE, dal pulsante «Terapia» (a[title="Apri Terapia"])
  // della pagina del paziente. Il modulo EpisodioTerapia è una tabella
  // (TerapiaTable<episodio>): le terapie già confermate, ognuna coi suoi
  // TERAPIA_PROG_n ed EPISODIO_ID_n, e in fondo UNA riga nuova, vuota — la sola
  // con la tendina dei farmaci (#DESCRIZIONE, jQuery UI: da 3 lettere, dopo
  // mezzo secondo, chiede a Sa4JsonService.do; scegliere una voce scrive
  // DESCRIZIONE, e CODICE e PRINCIPIO_ATTIVO dall'«id» della voce). Poi
  // QUANTITA (testo, 10), UM e SOMMINISTRAZIONE_VIA (tendine), PRESC_DATA,
  // TERAPIA_DILUIZIONE_ID (tendina), CONTINUA e AL_BISOGNO (spunte), FREQUENZA
  // (4), DURATA (1, «1»), NOTE. «Conferma» (Update) manda il modulo — il
  // TERAPIA_SERIALIZED lo compone la pagina al clic — e il server torna sulla
  // stessa pagina con la riga confermata e una riga nuova (n+1): una terapia
  // per Conferma. Una riga «aggiungi» la pagina non la mostra.
  // Qui: (1) quello che il medico conferma diventa un preferito — farmaco e
  // dose, mai niente del paziente (né note né ora); (2) un giro preparato dal
  // pannello riempie la riga nuova attraverso la pagina — la sua tendina, i
  // suoi campi —, un farmaco per Conferma, e si ferma lì: «Controlla e premi
  // Conferma». Conferma, Chiudi, TERAPIA_SERIALIZED e i campi nascosti non li
  // tocchiamo mai.
  const TERAPIA = "terapia.v1";                  // tabStore: il giro di questa scheda (col nome: muore finito)
  const TERAPIA_PREF = "terapia.preferiti.v1";   // store: farmaco e dose, niente del paziente
  const TERAPIA_TTL = 10 * 60e3, TERAPIA_APRO_MS = 60e3, TERAPIA_PREF_MAX = 60;
  const normTer = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const ugualeTer = (a, b) => normTer(a).toUpperCase() === normTer(b).toUpperCase();
  const eTerapie = (url = location.href) => param(url, "MVPG") === "PsoEpisodioTerapieImposta";
  // il pulsante «Terapia» (la prescrizione) di QUESTO episodio, uno solo — o i suoi uguali
  function linkTerapia(ep) {
    const l = ep ? [...document.querySelectorAll('a[href*="PsoEpisodioTerapieImposta"]')].filter((a) =>
      param(a.href, "MVPG") === "PsoEpisodioTerapieImposta" && param(a.href, "MODALITA") === "PRESCRIZIONE" && param(a.href, "EPISODIO_ID") === ep) : [];
    return l.length && l.every((a) => a.href === l[0].href) ? l[0] : null;
  }
  function formTerapia(doc = document) {
    const f = doc.querySelector('form[name="EpisodioTerapia"]');
    return f && param(new URL(f.getAttribute("action") || "", location.href).href, "MODALITA") === "PRESCRIZIONE" ? f : null;
  }
  const campoTer = (form, k, n) => [...form.elements].find((el) => el.name === `${k}_${n}`) || null;
  function righeTerapia(form) {
    const out = [];
    for (const el of form.elements) {
      const m = /^DESCRIZIONE_(\d+)$/.exec(el.name || "");
      if (m) out.push({ n: m[1], descr: el, salvata: !!normTer(campoTer(form, "TERAPIA_PROG", m[1])?.value) });
    }
    return out;
  }
  // una riga com'è scritta: farmaco e dose (le tendine col valore E la scritta)
  function rigaTerapia(form, n) {
    const v = (k, max) => normTer(campoTer(form, k, n)?.value).slice(0, max);
    const sel = (k) => { const o = campoTer(form, k, n)?.selectedOptions?.[0]; return o && o.value ? { v: o.value, t: normTer(o.text) } : null; };
    return { descr: v("DESCRIZIONE", 200), codice: v("CODICE", 40), qta: v("QUANTITA", 10), um: sel("UM"), via: sel("SOMMINISTRAZIONE_VIA"),
      dil: sel("TERAPIA_DILUIZIONE_ID"), continua: !!campoTer(form, "CONTINUA", n)?.checked, bisogno: !!campoTer(form, "AL_BISOGNO", n)?.checked,
      freq: v("FREQUENZA", 4), durata: v("DURATA", 2) };
  }
  // Di chi è la pagina delle terapie: l'episodio dell'indirizzo e del modulo, il
  // nome in testa. "" se è di `ep` e `nome`, se no il perché (Errore grave).
  function terapiaDiChi(form, ep, nome) {
    const epForm = param(new URL(form.getAttribute("action") || "", location.href).href, "EPISODIO_ID") || "";
    if ((param(location.href, "EPISODIO_ID") || "") !== ep || epForm !== ep) return "episodio diverso";
    const n = nomeInPagina();
    return n && ugualeTer(n, nome) ? "" : "nome diverso";
  }
  // Le terapie confermate e le voci delle tendine, per il telefono: solo
  // quello che la pagina mostra di ogni riga (mai le note, mai i nascosti), e
  // il TERAPIA_PROG che la distingue.
  function terapieLette(form, ep) {
    const righe = righeTerapia(form), nuova = righe.find((r) => !r.salvata);
    const opz = (k) => (nuova ? [...(campoTer(form, k, nuova.n)?.options || [])] : []).filter((o) => o.value).slice(0, 60).map((o) => ({ v: o.value.slice(0, 40), t: normTer(o.text).slice(0, 60) }));
    return {
      ep, letto: Date.now(),
      righe: righe.filter((r) => r.salvata).slice(-200).map((r) => {
        const x = rigaTerapia(form, r.n);
        return { prog: normTer(campoTer(form, "TERAPIA_PROG", r.n)?.value).slice(0, 20), descr: x.descr, qta: x.qta, um: x.um?.t || "", via: x.via?.t || "", dil: x.dil?.t || "",
          continua: x.continua, bisogno: x.bisogno, freq: x.freq, ora: normTer(campoTer(form, "PRESC_DATA", r.n)?.value).slice(0, 11) };
      }),
      opz: { um: opz("UM"), via: opz("SOMMINISTRAZIONE_VIA"), dil: opz("TERAPIA_DILUIZIONE_ID") },
    };
  }
  const chiaveTer = (p) => JSON.stringify([normTer(p.descr).toUpperCase(), p.codice || "", p.qta || "", p.um?.v || "", p.via?.v || "", p.dil?.v || "",
    !!p.continua, !!p.bisogno, p.freq || "", p.durata || ""]);
  const terapiaPreferiti = () => { const l = store.get(TERAPIA_PREF, []); return Array.isArray(l) ? l.filter((p) => p && p.descr) : []; };
  // i preferiti: lo stesso farmaco con la stessa dose è uno solo, i più usati in cima
  function imparaTerapia(righe) {
    if (!righe.length) return;
    const l = terapiaPreferiti();
    for (const r of righe) {
      const x = l.find((p) => chiaveTer(p) === chiaveTer(r));
      if (x) { x.n = (x.n || 0) + 1; x.ts = Date.now(); } else l.push({ ...r, n: 1, ts: Date.now() });
    }
    l.sort((a, b) => (b.n || 0) - (a.n || 0) || (b.ts || 0) - (a.ts || 0));
    store.set(TERAPIA_PREF, l.slice(0, TERAPIA_PREF_MAX));
  }
  // la riga in fondo alla pagina, da sola, finché il giro è qui
  // Chi è il paziente della pagina, come nell'intestazione del pannello: COGNOME N., l'età,
  // le allergie (sulla pagina della terapia non c'è il campo: sono quelle lette dal pannello).
  function terapiaChi(ep, nome) {
    const p = (store.get("patients.v1", []) || []).find((x) => x && String(x.ep) === String(ep));
    const eta = p && Number.isInteger(p.eta) ? p.eta : p && String(p.pk || "").startsWith("cf:") ? etaDaCf(p.pk.slice(3)) : null;
    const all = statoDi(ep)?.anag?.allergie;
    const a = !all ? "Allergie: non lette" : all.nega ? "Allergie: nega" : all.testo ? `Allergie: ${all.testo}` : "Allergie: non compilate";
    return `${nomeBreve(nome) || nome}${eta != null ? ` · ${eta}` : ""} · ${a}`;
  }
  // (`azione`: un bottone in più, { testo, fai }; `titolo`: di che cosa parla — la Terapia, o la cartella dal telefono)
  function terapiaDice(tono, testo, azione = null, titolo = "Terapia") {
    let h = document.getElementById("psassist-terapia");
    if (!h) {
      h = document.createElement("div");
      h.id = "psassist-terapia";
      h.attachShadow({ mode: "open" });
      document.documentElement.appendChild(h);
    }
    const fondo = { err: "#B3261E", warn: "#8A5300", ok: "#1E6B3A" }[tono] || "#0B5CAD";
    h.shadowRoot.innerHTML = `<style>.b{position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:min(560px,92vw);background:${fondo};color:#fff;border-radius:10px;
      padding:10px 12px;font:13px/1.45 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;box-shadow:0 6px 20px rgba(9,42,74,.35);display:flex;gap:10px;align-items:flex-start}
      button{border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;border-radius:7px;padding:2px 8px;font:inherit;cursor:pointer}</style>
      <div class="b" role="status" data-tono="${esc(tono)}"><span><b>PS Assist · ${esc(titolo)}</b> — ${esc(testo)}</span>${azione ? `<button id="fai">${esc(azione.testo)}</button>` : ""}<button id="via" aria-label="Chiudi">✕</button></div>`;
    h.shadowRoot.getElementById("via").addEventListener("click", () => h.remove());
    if (azione) h.shadowRoot.getElementById("fai").addEventListener("click", () => { h.remove(); azione.fai(); });
  }
  // le richieste di questa pagina (la tendina) aspettano un ordine che lavora altrove
  async function terapiaAspetta() {
    try {
      const o = await chrome.storage.session.get(["ordini", "motore"]);
      if (Array.isArray(o && o.ordini)) ORDINI_VIVI = o.ordini;
      MOTORE_SW = (o && o.motore) || null;
    } catch { /* resta quello che si sa */ }
    if (!motoreAltrove()) return true;
    terapiaDice("run", "Aspetto che finisca l'ordine in corso in un'altra scheda…");
    await cancelloMotore();
    return !motoreAltrove();
  }
  const visibileTer = (el) => getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
  // Scrive nella tendina della pagina e aspetta la sua risposta (la rotella,
  // ui-autocomplete-loading, che compare e se ne va): le voci della tendina,
  // [] se non ne ha, null se non risponde.
  async function tendinaTerapia(d, q) {
    let partita = false, finita = false;
    const giro = () => { if (d.classList.contains("ui-autocomplete-loading")) partita = true; else if (partita) finita = true; };
    const oss = new MutationObserver((rr) => { if (rr.some((r) => /\bui-autocomplete-loading\b/.test(r.oldValue || ""))) partita = true; giro(); });
    oss.observe(d, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    try {
      d.focus();
      d.value = q;
      d.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true }));
      d.dispatchEvent(new Event("input", { bubbles: true }));
      d.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      for (const t0 = Date.now(); !finita && Date.now() - t0 < (partita ? 12e3 : 3e3);) await sleep(100);
    } finally { oss.disconnect(); }
    if (!finita) return null;
    await sleep(60);
    const menu = [...document.querySelectorAll("ul.ui-autocomplete")].filter(visibileTer);
    return menu.length > 1 ? null : menu.length ? [...menu[0].querySelectorAll("li.ui-menu-item")] : [];
  }
  // la voce si sceglie come col mouse: sopra (la tendina la fa sua), poi il clic
  function sceltaTendina(li) {
    const t = li.querySelector("a") || li.firstElementChild || li;
    const m = (tipo, bolle = true) => t.dispatchEvent(new MouseEvent(tipo, { bubbles: bolle, cancelable: true, composed: true, button: 0 }));
    m("mouseover"); m("mouseenter", false); m("mousemove"); m("mousedown"); m("mouseup"); m("click");
  }
  // un campo visibile della riga: testo, tendina ({v, t}: valore e scritta, tutt'e due), spunta
  function scriviTer(el, val) {
    const avvisa = () => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    if (el.type === "checkbox") { if (el.checked !== !!val) el.click(); return el.checked === !!val; }
    if (el.tagName === "SELECT") {
      const o = [...el.options].find((x) => x.value === val.v && ugualeTer(x.text, val.t));
      if (!o) return false;
      if (!o.selected) { o.selected = true; avvisa(); }
      return o.selected;
    }
    const s = String(val ?? "");
    if (el.maxLength > 0 && s.length > el.maxLength) return false;
    if (el.value !== s) { el.value = s; avvisa(); }
    return el.value === s;
  }
  // (una tendina senza «selected» parte dalla prima voce)
  const cambiatoTer = (el) => el.tagName === "SELECT" ? el.selectedIndex !== Math.max(0, [...el.options].map((o) => o.defaultSelected).lastIndexOf(true))
    : el.type === "checkbox" || el.type === "radio" ? el.checked !== el.defaultChecked : el.value !== el.defaultValue;
  const NOMI_TER = { QUANTITA: "la quantità", UM: "l'unità", SOMMINISTRAZIONE_VIA: "la via", TERAPIA_DILUIZIONE_ID: "la diluizione",
    CONTINUA: "«continua»", AL_BISOGNO: "«al bisogno»", FREQUENZA: "la frequenza", DURATA: "la durata" };
  // Riempie la riga nuova con un farmaco: { ok } fatto, { tocca } a metà e
  // tocca al medico (la riga resta com'è), { stop } niente da fare qui.
  async function riempiTerapia(form, v, inizio) {
    const nuove = righeTerapia(form).filter((r) => !r.salvata);
    if (nuove.length !== 1) return { stop: "la riga nuova della pagina non c'è" };
    const n = nuove[0].n, d = nuove[0].descr;
    if (document.getElementById("DESCRIZIONE") !== d || !d.classList.contains("ui-autocomplete-input")) return { stop: "la tendina dei farmaci della pagina non è pronta" };
    if ([...form.elements].some((el) => el.name && el.name.endsWith("_" + n) && el.type !== "hidden" && cambiatoTer(el))) return { stop: "nella riga nuova c'è già scritto qualcosa: non la tocco" };
    const scrive = () => scrittura.tasto > inizio;   // il medico scrive nella pagina: si lascia a lui
    // 1. il farmaco, dalla tendina della pagina: la voce con la stessa scritta, una sola.
    // Le ricerche, dalla più stretta alla più larga: il nome intero; il nome fino alla
    // prima minuscola (il gestionale porta il termine in maiuscolo: «SF 500cc» cerca
    // «SF 500CC» e non trova la sua voce, «SF 500» sì); poi il nome accorciato parola per
    // parola. Una ricerca più larga non cambia la regola: si sceglie SOLO la voce con la
    // stessa scritta, e due uguali le sceglie il medico.
    const nome = normTer(v.descr), minus = nome.search(/[a-zà-ÿ]/), parole = nome.split(/[\s*]+/);
    const cerca = [nome, minus > 0 ? nome.slice(0, minus).trim() : "", ...parole.map((_, i) => parole.slice(0, parole.length - i).join(" "))]
      .filter((x, k, a) => x && x.length >= 3 && a.indexOf(x) === k).slice(0, 4);
    for (const q of cerca) {
      if (!(await terapiaAspetta())) return { stop: "un ordine sta ancora lavorando in un'altra scheda: riprova fra poco" };
      if (scrive()) return { stop: "stai scrivendo nella pagina: mi fermo" };
      const voci = await tendinaTerapia(d, q);
      if (voci === null) return { stop: "la tendina dei farmaci non risponde" };
      const uguali = voci.filter((li) => ugualeTer(li.textContent, v.descr));
      if (uguali.length > 1) return { tocca: `nella tendina ci sono più voci «${v.descr}»: scegli tu quella giusta, completa la dose e premi Conferma`, breve: `nella tendina ci sono più voci «${v.descr}»: va scelta sul PC`, perche: "voci uguali" };
      if (!uguali.length) continue;
      sceltaTendina(uguali[0]);
      for (let k = 0; k < 20 && !ugualeTer(d.value, v.descr); k++) await sleep(50);
      if (!ugualeTer(d.value, v.descr) || (v.codice && normTer(campoTer(form, "CODICE", n)?.value) !== v.codice)) {
        return { tocca: `la voce «${v.descr}» non è entrata nella riga: sceglila tu nella tendina, completa la dose e premi Conferma`, breve: `la voce «${v.descr}» non è entrata nella riga`, perche: "voce non entrata" };
      }
      if (v.nuovo) return { ok: true, testo: "scrivi la dose e la via, poi controlla e premi Conferma" };
      // 2. la dose, nei campi della riga (niente note, niente ora)
      const passi = [["QUANTITA", v.qta], ["UM", v.um], ["SOMMINISTRAZIONE_VIA", v.via], ["TERAPIA_DILUIZIONE_ID", v.dil],
        ["CONTINUA", v.continua], ["AL_BISOGNO", v.bisogno], ["FREQUENZA", v.freq], ["DURATA", v.durata]];
      for (const [k, val] of passi) {
        if (val == null || val === false || (k !== "QUANTITA" && k !== "FREQUENZA" && k !== "DURATA" && !val)) continue;
        const el = campoTer(form, k, n);
        if (scrive()) return { stop: "stai scrivendo nella pagina: mi fermo" };
        const scritta = `${NOMI_TER[k]} «${typeof val === "object" ? val.t : val === true ? "sì" : val}» non si lascia scrivere`;
        if (!el || !scriviTer(el, val)) return { tocca: `${scritta}: completa tu e premi Conferma`, breve: scritta, perche: "campo non scritto" };
      }
      return { ok: true, testo: "controlla e premi Conferma" };
    }
    return { tocca: v.nuovo ? `scegli il farmaco nella tendina, scrivi la dose e la via, poi premi Conferma`
      : `«${v.descr}» non c'è uguale nella tendina: sceglilo tu, completa la dose e premi Conferma`, breve: `«${v.descr}» non c'è uguale nella tendina del gestionale`, perche: "voce non trovata" };
  }
  // La riga nuova riletta campo per campo contro il farmaco scelto (dal
  // telefono): "" se è quella, se no che cosa non torna. Quello che non si
  // scriveva dev'essere com'era (le note e l'ora sempre).
  function rilettaTer(form, n, v) {
    const x = rigaTerapia(form, n);
    if (!ugualeTer(x.descr, v.descr) || (v.codice && x.codice !== v.codice)) return "il farmaco";
    const passi = [["QUANTITA", v.qta], ["UM", v.um], ["SOMMINISTRAZIONE_VIA", v.via], ["TERAPIA_DILUIZIONE_ID", v.dil],
      ["CONTINUA", v.continua], ["AL_BISOGNO", v.bisogno], ["FREQUENZA", v.freq], ["DURATA", v.durata], ["NOTE", null], ["PRESC_DATA", null]];
    for (const [k, val] of passi) {
      const el = campoTer(form, k, n);
      // (come riempiTerapia: i testi si scrivono anche vuoti, tendine e spunte solo se ci sono)
      const scritto = !(val == null || val === false || (k !== "QUANTITA" && k !== "FREQUENZA" && k !== "DURATA" && !val));
      const ok = !!el && (!scritto ? !cambiatoTer(el) : el.type === "checkbox" ? el.checked
        : el.tagName === "SELECT" ? el.value === val.v && ugualeTer(el.selectedOptions[0]?.text, val.t) : el.value === String(val));
      if (!ok) return NOMI_TER[k] || (k === "NOTE" ? "le note" : "l'ora");
    }
    return "";
  }
  // In una scheda del medico: la Terapia di quel paziente è sua adesso? Il
  // giro del pannello, o la pagina delle terapie con qualcosa di cambiato.
  function terapiaSporca(ep) {
    if (LAVORO || PONTE_VALORI || PONTE_CARTELLA || PONTE_TERAPIA || typeof ep !== "string" || !ep) return false;
    const j = tabStore.get(TERAPIA, null);
    if (j && j.ep === ep) return true;
    const f = eTerapie() && param(location.href, "EPISODIO_ID") === ep ? formTerapia() : null;
    return !!f && [...f.elements].some((el) => el.name && el.type !== "hidden" && cambiatoTer(el));
  }
  // Sulla pagina delle terapie: quello che il medico conferma si impara, e un
  // giro preparato dal pannello va avanti di una riga per Conferma.
  async function terapiaQui() {
    if (!hasExt() || !eTerapie()) return;
    const form = formTerapia();
    const j = tabStore.get(TERAPIA, null);
    if (!form) {
      if (j) { tabStore.del(TERAPIA); terapiaDice("warn", "questa non è la pagina della prescrizione: non ho scritto niente."); }
      return;
    }
    const ep = param(location.href, "EPISODIO_ID") || "";
    // quello che la pagina mostra, per il telefono (il service worker lo tiene solo con un iPhone associato)
    if (ep && form.querySelector('table[id^="TerapiaTable"]')?.id === "TerapiaTable" + ep
      && param(new URL(form.getAttribute("action") || "", location.href).href, "EPISODIO_ID") === ep) ask({ t: "ponteTerapieLette", ep, lettura: terapieLette(form, ep) });
    // Conferma del medico: le righe nuove scritte diventano preferiti (si
    // legge e basta: l'invio è il suo, mai fermato). Chiudi chiude il giro.
    window.addEventListener("submit", (ev) => {
      if (ev.target !== form || ev.defaultPrevented) return;
      const g = tabStore.get(TERAPIA, null);
      if (!ev.submitter || ev.submitter.name !== "Update") { if (g) tabStore.del(TERAPIA); return; }
      const righe = righeTerapia(form), nuove = righe.filter((r) => !r.salvata && normTer(r.descr.value));
      try { imparaTerapia(nuove.map((r) => rigaTerapia(form, r.n))); } catch { /* memoria piena: nessun preferito */ }
      if (g && g.ep === ep) tabStore.set(TERAPIA, { ...g, fase: "attesa", ts: Date.now(),
        confermata: { descr: nuove.length ? normTer(nuove[0].descr.value) : "", salvate: righe.filter((r) => r.salvata).length } });
    });
    if (!j) return;
    if (!Array.isArray(j.voci) || !j.voci.length || Date.now() - (j.ts || 0) > (j.fase === "apro" ? TERAPIA_APRO_MS : TERAPIA_TTL)) { tabStore.del(TERAPIA); return; }
    // di chi è la pagina: l'episodio dell'indirizzo e del modulo, il nome in testa
    const altro = terapiaDiChi(form, j.ep, j.nome);
    if (altro) {
      tabStore.del(TERAPIA);
      segnaErrore("terapia", { grave: true, perche: altro });
      return terapiaDice("err", "Errore grave: questa pagina delle terapie è di un altro paziente — non ho scritto niente.");
    }
    const tab = form.querySelector('table[id^="TerapiaTable"]');
    if (!tab || tab.id !== "TerapiaTable" + j.ep) { tabStore.del(TERAPIA); return terapiaDice("warn", "non riconosco la tabella delle terapie: non ho scritto niente."); }
    let i = j.i || 0;
    if (j.fase !== "apro") {
      const c = j.confermata, resto = j.voci.length - i - 1;
      const restano = resto > 0 ? ` ${resto === 1 ? "L'ultimo farmaco non l'ho preparato" : `Gli ultimi ${resto} farmaci non li ho preparati`}.` : "";
      if (!c) { tabStore.del(TERAPIA); return terapiaDice("warn", `la pagina si è ricaricata senza Conferma: non riscrivo niente.${restano}`); }
      const salvate = righeTerapia(form).filter((r) => r.salvata);
      if (!(salvate.length > c.salvate && salvate.some((r) => ugualeTer(r.descr.value, c.descr)))) {
        tabStore.del(TERAPIA);
        return terapiaDice("warn", `non vedo «${c.descr || "la terapia"}» fra le terapie confermate: controlla la pagina.${restano}`);
      }
      i++;
      if (i >= j.voci.length) { tabStore.del(TERAPIA); return terapiaDice("ok", j.voci.length === 1 ? "confermata." : `fatto: ${j.voci.length} terapie confermate.`); }
    }
    const g = { ...j, i, fase: "scrivo", confermata: null, ts: Date.now() };
    tabStore.set(TERAPIA, g);
    osservaScrittura();
    const v = g.voci[i], dove = `${g.voci.length > 1 ? `${i + 1} di ${g.voci.length} · ` : ""}${v.descr}`;
    terapiaDice("run", `scrivo ${dove}…`);
    const r = await riempiTerapia(form, v, Date.now()).catch(() => ({ stop: "errore nel riempire la riga" }));
    const ora = tabStore.get(TERAPIA, null);
    if (!ora || ora.id !== g.id || ora.fase !== "scrivo") return;   // (Conferma o Chiudi premuti intanto: decide la pagina dopo)
    if (r.stop) { tabStore.del(TERAPIA); return terapiaDice("warn", `fermato su ${dove}: ${r.stop}.`); }
    tabStore.set(TERAPIA, { ...ora, fase: "attesa", ts: Date.now() });
    terapiaDice(r.ok ? "ok" : "warn", `${terapiaChi(g.ep, g.nome)} — ${dove}: ${r.ok ? r.testo : r.tocca}.${g.voci.length - i - 1 > 0 ? " Dopo la Conferma preparo il successivo." : ""}`);
  }

