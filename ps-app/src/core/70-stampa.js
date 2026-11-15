//@frammento 70-stampa.js — PRINT WIZARD: openPrintWizard, stampa automatica e stazione, stampa dopo la Conferma, stampe fresche, ascoltaOrdini.
  // ============================================================ PRINT WIZARD
  // Sequential printing of the richiesta PDFs: labels first (label printer),
  // then the exam list (normal printer). A web page cannot pick a printer or
  // skip the dialog: that takes the Windows helper (stampa automatica, above).
  // Without it this is the most automatic legal flow; Chrome's dialog
  // remembers recent destinations, so switching printer is one click.
  // Mentre un PDF arriva non c'è niente davanti: a che punto è lo dice la pill
  // — o, senza pannello (o col pannello aperto), un riquadrino nell'angolo.
  // Arrivato il PDF compare la scheda di sempre: il PDF in anteprima e la
  // stampante su cui va. È il controllo di un'occhiata, e dice quale
  // stampante scegliere. Da quella cornice, visibile, si apre subito il
  // dialogo di stampa; chiuso il dialogo si passa da soli al documento dopo,
  // e la scheda si toglie finché quello non arriva.
  let wizardOpen = false;
  const cosaStampo = (job) => /^etichetta anagrafica/i.test(job.name) ? "l'etichetta anagrafica"
    : /^etichett/i.test(job.name) ? "le etichette"
    : /^lista esami/i.test(job.name) ? "la lista esami"
    : /^prenotazione/i.test(job.name) ? "la prenotazione RX"
    : /^richiesta radiologia/i.test(job.name) ? "la richiesta RX"
    : `«${job.name}»`;

  // «6 esami confermati 14:32»: il resoconto che resta sulla pill
  // (per l'ordine in sottofondo senza l'ora: la dice com'è finita la stampa)
  const confermati = (fine) => (fine.n ? `${fine.n} ${fine.n === 1 ? "esame confermato" : "esami confermati"}` : "Richiesta confermata");
  const confermatiTesto = (fine) => `${confermati(fine)} ${hhmm(fine.ts || Date.now())}`;

  // La STAMPA AUTOMATICA. Con l'aiutante di Windows installato (la cartella
  // stampa/ dello zip) e le due stampanti scelte nelle impostazioni, ogni
  // foglio va da solo alla sua: le etichette all'etichettatrice, il resto
  // (liste, prenotazioni, consensi) all'A4. Niente dialogo, e niente davanti:
  // la stampa la fa il service worker, col motore dell'ordine in sottofondo
  // (bg.js, ordStampaFogli: ogni foglio annotato prima di partire, una volta
  // sola), e i PDF glieli dà una scheda sua, aperta dietro sulla pagina del
  // paziente. Il medico può andare dove vuole subito. La striscia dice «Stampo
  // … su …», poi com'è andata: «Stampato su», «Mandato a» (è nella coda di
  // Windows), «Esito sconosciuto» (può essere uscito: mai un secondo foglio da
  // solo), «NON stampate». Solo un foglio che non è partito per un no detto
  // (`motivo`) torna qui, alla scheda col dialogo. Spenta, non configurata,
  // col bookmarklet: la scheda di sempre.
  async function stampaAutomatica() {
    if (!hasExt()) return null;
    try {
      const s = (await chrome.storage.local.get("stampa")).stampa;
      return s && s.etichette && s.a4 ? s : null;
    } catch { return null; }
  }
  // Ogni stampa che il pannello fa parte da qui. `ep`, `paziente`: di chi
  // sono i fogli (la striscia lo dice, anche altrove).
  async function avviaStampa(jobs, opzioni = {}) {
    if (!jobs.length) return;
    // Dove: `dest` — «stazione» (una «Ristampa» di un suo ordine), «qui»
    // («Stampa qui»), «ricordata» (la scelta del medico: i fogli di una
    // conferma e l'etichetta anagrafica). Alla stazione non serve l'aiutante qui.
    const dest = opzioni.dest || (opzioni.tag === "Confermata" ? "ricordata" : "qui");
    const motivo = jobs.some((j) => j.motivo);
    if (!motivo && (dest === "stazione" || (dest === "ricordata" && await allaStazione())) && await stampaAltrove(jobs, { ...opzioni, dest })) return;
    if (!motivo && await stampaAutomatica() && await stampaAltrove(jobs, { ...opzioni, dest: "qui" })) return;
    openPrintWizard(jobs, opzioni);
  }
  // la stazione di stampa collegata, e scelta («Stampa: PC · Infermeria»)
  async function allaStazione() {
    if (!hasExt()) return false;
    try {
      const [l, x] = await Promise.all([chrome.storage.local.get("stampa"), chrome.storage.session.get("stazione")]);
      return (l.stampa || {}).dove === "stazione" && !!x.stazione;
    } catch { return false; }
  }
  // I fogli al service worker. Un no detto (spenta per lui, la scheda dei
  // PDF che non si apre): false, e la scheda col dialogo. Nessuna risposta
  // (tre volte, con lo stesso numero: una stampa sola): non si sa se è
  // partita — mai un dialogo da solo, lo si dice con «Ristampa».
  async function stampaAltrove(jobs, opzioni) {
    if (extPersa()) return false;
    const { panel = null, tag = "Stampa", fine = null, title = "" } = opzioni;
    const ep = String(opzioni.ep || "");
    const job = { id: opzioni.jobId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, ep, tag,
      paziente: opzioni.paziente || (tuttiPazienti().find((p) => p.ep === ep) || {}).name || "",
      url: urlPaziente(ep, opzioni.url), fine, riassunto: fine ? confermati(fine) : title.replace(/\.$/, ""), dest: opzioni.dest || "qui",
      jobs: jobs.map(({ name, printer, url, diretto, breve }) => ({ name, printer, url, ...(breve ? { breve } : {}), ...(diretto ? { diretto: true } : {}) })) };
    let r = { ok: false };
    for (let k = 0; k < 3 && !r.ok && !r.no; k++) r = await ask({ t: "ordineFogli", job });
    if (r.no) return false;
    // (le etichette di un ordine prese qui: i PDF li prende adesso la scheda della stampa — la coda non aspetta questa)
    if (opzioni.presi) ask({ t: "ordinePresi", id: opzioni.presi }).catch(() => {});
    panel?.log(`${now()}  ${jobs.map((j) => j.name).join(", ")}: alla stampa automatica, senza anteprima${r.ok ? "" : " — il service worker non risponde"}`);
    if (!panel) return true;
    // la striscia è della stampa (a pannello aperto, il chip in intestazione: il
    // pannello non si nasconde) e il giro finito lascia il posto
    // (l'etichetta anagrafica no: il medico sta lavorando nel pannello, e lì resta)
    if (!opzioni.resta) {
      panel.chiudiGiro();
      if (panel.striscia && !panel.striscia.daOrdine) panel.segnala(null);
    }
    if (r.ok) panel.ordiniAggiorna(r.ordini || panel.ordini);
    else panel.segnala({ tag, testo: "Esito della stampa sconosciuto: controlla la stampante", tono: "warn", paziente: job.paziente,
      azione: { label: "Ristampa", titolo: "Stampa di nuovo, dal dialogo", fn: () => openPrintWizard(jobs, opzioni) }, ...panel.avvisoVisto() });
    panel.render();
    return true;
  }
  function openPrintWizard(jobs, opzioni = {}) {
    const { title = "", onClose, panel = null, tag = "Stampa", fine = null } = opzioni;
    let ultimaDiag = null;   // l'ultimo visualizzatore non catturato, per «⧉ Diagnosi»
    if (wizardOpen || !jobs.length || extPersa()) return;
    wizardOpen = true;
    // di chi sono i fogli: «ROSSI M. · 68 M», sulla striscia e in testa alla scheda
    const { chi, testata } = (() => {
      const ep = String(opzioni.ep || ""), p = ep ? tuttiPazienti().find((x) => x.ep === ep) : null;
      const nome = opzioni.paziente || p?.name || "", b = nomeBreve(nome);
      const es = [Number.isInteger(p?.eta) ? String(p.eta) : "", p?.sesso || ""].filter(Boolean).join(" ");
      const c = b ? [b, es].filter(Boolean).join(" · ") : "";
      // un titolo che porta già il nome intero lo tiene, con età e sesso accanto
      const t = nome && title.includes(nome) ? title.replace(nome, [nome, es].filter(Boolean).join(" · ")) : [c, title].filter(Boolean).join(" · ");
      return { chi: c, testata: t };
    })();

    const wrap = document.createElement("div");
    wrap.id = "psassist-print";
    const root = wrap.attachShadow({ mode: "open" });
    document.documentElement.appendChild(wrap);

    let i = 0;
    let attempts = 0;
    let blobUrl = null;
    let timer = null;
    let gen = 0;               // il caricamento in corso: uno saltato non deve stampare al posto del dopo
    // Chiudere (✕, Esc) deve fermare davvero la caccia al PDF: senza questo il
    // medico annullava, la catena continuava a chiedere al server, e una
    // seconda stampa poteva partire mentre la prima era ancora in giro.
    // Anche «Avanti» ferma quella del documento che si salta.
    let ctlDoc = null;
    let cur = null;            // il documento in anteprima: { f, printed, apertoIl, avanzato }
    let tuttiChiesti = true;   // ogni documento ha avuto la sua stampa
    let daSola = false;        // si è andati avanti da soli, a dialogo chiuso: stampato o annullato, non si sa
    let chiuso = false;
    let staccaStampa = () => {};   // toglie l'ascolto del dialogo di stampa del documento in corso
    // Tutti i PDF subito, uno dopo l'altro (pochi, e piccoli): il foglio dopo
    // è già qui quando lo chiedi, e la coda degli ordini sa che questa scheda
    // ha i suoi (`presi`: le etichette di un ordine in sottofondo — il prossimo
    // ordine aspetta questo, mai a metà: ordinePresi). Chiudere li ferma.
    const ctlPre = new AbortController(), pre = new Map();
    // (le etichette di un ordine, `presi`: UNA scadenza per tutto quello che si
    // comincia a leggere per loro — ogni rinvio, il corpo del PDF, anche un
    // foglio chiesto prima del tempo dal dialogo —, PRESA_SCHEDA_MAX +
    // TIMEOUT_MS dall'inizio: quanto il service worker aspetta al più prima del
    // prossimo ordine (PRESA_PDF_MAX). Un foglio chiesto dopo passa dal
    // cancello del motore, come ogni lettura.)
    const ctlPresa = new AbortController();
    if (opzioni.presi) {
      const t = setTimeout(() => ctlPresa.abort(new DOMException("Timeout", "TimeoutError")), PRESA_SCHEDA_MAX + TIMEOUT_MS);
      ctlPre.signal.addEventListener("abort", () => { clearTimeout(t); ctlPresa.abort(); }, { once: true });
    }
    const prendi = (k) => {
      if (!pre.has(k)) {
        const j = jobs[k], signal = opzioni.presi && !ctlPresa.signal.aborted ? ctlPresa.signal : ctlPre.signal;
        const p = j.diretto ? fetch(j.url, { signal }).then((r) => r.blob()).then((blob) => ({ blob, via: "estensione" }))
          : fetchPdf(j.url, { signal });
        pre.set(k, p.catch((e) => { pre.delete(k); throw e; }));   // (non arrivato: lo si richiede, se lo si richiede)
      }
      return pre.get(k);
    };
    // (passati PRESA_SCHEDA_MAX non se ne comincia un altro: quello in volo,
    // rinvii e corpo compresi, si ferma alla scadenza — ctlPresa —, e il
    // service worker aspetta al più tanto — PRESA_PDF_MAX —, così il prossimo
    // ordine non parte mai mentre una lettura di questa scheda sposta la
    // richiesta corrente della sessione)
    (async () => {
      const t0 = Date.now();
      for (let k = 0; k < jobs.length && !chiuso; k++) {
        if (opzioni.presi && Date.now() - t0 > PRESA_SCHEDA_MAX) break;
        await prendi(k).catch(() => {});
      }
      if (opzioni.presi && hasExt()) ask({ t: "ordinePresi", id: opzioni.presi }).catch(() => {});
    })();

    const CSS = `${COLORS}
      .ps[hidden], .pw[hidden] { display: none; }
      .ps .psgo { border: 0; background: #fff; color: #0B5CAD; border-radius: 999px; padding: 3px 10px; font-weight: 700; font-size: 12px; cursor: pointer; flex: none; }
      /* mentre il PDF arriva, senza pill: un riquadrino nell'angolo */
      .ps { position: fixed; top: 10px; right: 10px; z-index: 2147483647; display: flex; align-items: center; gap: 8px;
            max-width: min(380px, 82vw); background: #0B5CAD; color: #fff; border-radius: 12px; padding: 7px 8px 7px 11px;
            font-size: 12px; box-shadow: 0 4px 14px rgba(9,42,74,.22); cursor: pointer; }
      .ps .dot { width: 8px; height: 8px; border-radius: 50%; background: #7FD1A8; flex: none; animation: psaPulse 1.2s ease-in-out infinite; }
      .ps .pst { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ps .psx { border: 0; background: rgba(255,255,255,.18); color: #fff; border-radius: 999px; width: 24px; height: 24px; cursor: pointer; flex: none; }
      /* arrivato il PDF: la scheda al centro, il PDF in anteprima — senza velo
         sulla pagina (il dialogo di stampa del browser è già lui davanti) */
      .pw { position: fixed; top: 4vh; left: 50%; transform: translateX(-50%); z-index: 2147483647;
            width: min(720px, 94vw); background: #fff; border-radius: 16px; overflow: hidden;
            box-shadow: 0 18px 48px rgba(9,42,74,.4); font-size: 13.5px; color: #16232E;
            display: flex; flex-direction: column; max-height: 92vh; }
      .pwhd { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 12px 16px; background: #0B5CAD; color: #fff; }
      .pwhd b { font-size: 14.5px; }
      .pwhd .pwtit { font-size: 12px; opacity: .85; }
      .pwhd .dest { margin-left: auto; background: #FFF7E6; color: #8a4b03; border-radius: 999px; padding: 4px 12px; font-weight: 700; font-size: 12.5px; }
      .pwbody { flex: 1; min-height: 320px; background: #E8EEF4; }
      .pwbody iframe { width: 100%; height: 56vh; border: 0; display: block; background: #fff; }
      .pwmsg { padding: 40px 20px; text-align: center; color: #5B6B7A; }
      .pwft { padding: 12px 16px; display: flex; gap: 8px; align-items: center; border-top: 1px solid #E3E8EF; flex-wrap: wrap; }
      .pwbtn { border: 0; border-radius: 10px; padding: 11px 16px; font-weight: 700; font-size: 13.5px; cursor: pointer; }
      .pwbtn:disabled { opacity: .45; cursor: default; }
      .pwbtn.next { background: #177245; color: #fff; }
      .pwbtn.next:hover { background: #125c37; }
      .pwbtn.re { background: #0B5CAD; color: #fff; }
      .pwbtn.re:hover:enabled { background: #094a8c; }
      .pwbtn.ghost { background: #F4F8FB; color: #16232E; border: 1px solid #C4D0DC; }
      .pwbtn.exit { background: transparent; color: #B3261E; border: 1px solid #E9BAB6; margin-left: auto; }
      /* quando la cattura non riesce, l'unica strada che funziona si vede */
      .pwbtn.grande { font-size: 15px; padding: 13px 22px; box-shadow: 0 3px 12px rgba(11,92,173,.35); }
      .pwhint { width: 100%; font-size: 11.5px; color: #5B6B7A; }
      .pwerr { margin: 12px 16px 0; background: #FBEBEA; border: 1px solid #E9BAB6; color: #7c1a14; border-radius: 10px; padding: 10px 12px; font-size: 12.5px; }
      .pwavv { margin: 12px 16px 0; background: #FFF7E6; border: 1px solid #F0D49A; color: #6b3d02; border-radius: 10px; padding: 8px 12px; font-size: 12.5px; }
    `;
    root.innerHTML = `<style>${CSS}</style><div class="ps" role="status" hidden></div>
      <div class="pw" role="dialog" aria-label="Stampa documenti" hidden><div class="pwhd"></div><div class="pwguaio"></div><div class="pwbody"></div><div class="pwft"></div></div>`;
    const ps = root.querySelector(".ps"), pw = root.querySelector(".pw");
    const testa = pw.querySelector(".pwhd"), guaio = pw.querySelector(".pwguaio"), corpo = pw.querySelector(".pwbody"), piede = pw.querySelector(".pwft");

    const conto = () => (jobs.length > 1 ? `${Math.min(i + 1, jobs.length)}/${jobs.length}` : "");
    // La scheda si vede o no. Il riquadrino serve solo senza pannello, e solo
    // quando la scheda non c'è.
    const vedi = (si) => {
      pw.hidden = !si;
      if (!panel) ps.hidden = si;
    };
    // Un foglio arrivato mentre scrivi aspetta (vedi aspettaChiScrive): un
    // tocco sulla striscia lo stampa subito.
    let subito = null;
    const tocca = () => (subito ? subito() : vedi(true));
    // A che punto è: nella striscia del pannello — ridotto, la striscia;
    // aperto, il chip in intestazione —, e solo senza pannello nel riquadrino.
    // Un tocco lì mostra la scheda; ✕ (o Esc, a scheda aperta) annulla.
    // (`azione`: «Stampa», per un foglio che aspetta chi scrive)
    const stato = (testo, tono = "run", azione = null) => {
      wrap.dataset.testo = testo;
      if (panel) {
        ps.hidden = true;
        panel.segnala({ tag, badge: conto(), testo, tono, daStampa: true, onTap: tocca, onStop: () => chiudi(false), ...(azione ? { azione } : {}) });
        return;
      }
      ps.hidden = !pw.hidden;
      ps.innerHTML = `<span class="dot"></span><span class="pst"><b>${esc(tag)}${conto() ? " " + esc(conto()) : ""}</b>${chi ? ` · ${esc(chi)}` : ""} · ${esc(testo)}</span>${
        azione ? `<button class="psgo" title="${esc(azione.titolo || "")}">${esc(azione.label)}</button>` : ""}<button class="psx" title="Annulla la stampa" aria-label="Annulla la stampa">✕</button>`;
      ps.querySelector(".psx").onclick = (e) => { e.stopPropagation(); chiudi(false); };
      ps.onclick = tocca;
    };
    const nota = (html) => { const h = piede.querySelector(".pwhint"); if (h) h.innerHTML = html; };
    const scegli = () => `Scegli <b>${esc(jobs[i].printer)}</b> nel dialogo di stampa.`;

    // Testata e comandi della scheda: quale documento, su quale stampante, e
    // i bottoni di sempre. Un verbo per pulsante, un'icona per verbo (prima ce
    // n'erano cinque, e «Avanti» e «Salta» facevano la stessa cosa). Il corpo
    // — l'anteprima — non si tocca: rimettere la cornice la ricaricherebbe.
    // `avviso`: una riga che dice perché questo documento passa dal dialogo
    // (la stampa automatica non ci è riuscita).
    const comandi = ({ err = "", viewer = false, avviso = "" } = {}) => {
      const job = jobs[i];
      const nextLbl = i + 1 < jobs.length ? `→ Avanti (${i + 2} di ${jobs.length})` : "✓ Fine";
      testa.innerHTML = `<b>Stampa ${i + 1} di ${jobs.length} — ${esc(job.name)}</b>${testata ? `<span class="pwtit">${esc(testata)}</span>` : ""}<span class="dest">→ ${esc(job.printer)}</span>`;
      guaio.innerHTML = err ? `<div class="pwerr">${esc(err)}</div>` : avviso ? `<div class="pwavv">${esc(avviso)}</div>` : "";
      piede.innerHTML = `
        ${viewer
          ? `<button class="pwbtn re grande" id="pwtab" title="Apre il documento in una scheda: da lì Ctrl+P">${icoIn("esterno")}Apri e stampa</button>`
          : `<button class="pwbtn re" id="pwre" title="Riapre la finestra di stampa del browser" ${cur ? "" : "disabled"}>${icoIn("stampante")}Stampa</button>`}
        <button class="pwbtn next" id="pwnext" title="${i + 1 < jobs.length ? "Passa al documento successivo" : "Chiude: hai stampato tutto"}">${nextLbl}</button>
        ${viewer ? "" : `<button class="pwbtn ghost" id="pwtab" title="Se la stampa non parte, aprilo in una scheda">${icoIn("esterno")}Scheda</button>`}
        ${viewer && ultimaDiag ? `<button class="pwbtn ghost" id="pwdiag" title="Copia com'è fatto il visualizzatore, da mandare a chi fa il pannello: senza numeri, date né valori dei campi, e ${hasExt() && !TABELLONE ? "pseudonimizzato come le registrazioni (nomi e codici fiscali finti)" : "senza i nomi dei pazienti che il pannello conosce"}. Il testo della pagina resta: rileggilo prima di mandarlo.">⧉&nbsp; Diagnosi</button>` : ""}
        <button class="pwbtn exit" id="pwexit" title="Chiude senza stampare il resto (Esc)">✕&nbsp; Chiudi</button>
        <div class="pwhint">${viewer
          ? `Questo documento non si lascia stampare da qui: <b>Apri e stampa</b>, poi Ctrl+P → <b>${esc(job.printer)}</b>, e qui «→ Avanti».`
          : err ? "" : scegli()}</div>`;
      piede.querySelector("#pwre")?.addEventListener("click", () => { if (cur && cur.f.isConnected) stampa(cur); });
      piede.querySelector("#pwnext").onclick = advance;
      piede.querySelector("#pwexit").onclick = () => chiudi(false);
      piede.querySelector("#pwtab").onclick = () => openTab(job.url, "_blank"); // user-activated → not popup-blocked
      piede.querySelector("#pwdiag")?.addEventListener("click", async () => {
        const b = piede.querySelector("#pwdiag");
        const c = await testoDaCopiare("diagnosi-1.txt", diagnosiTesto(ultimaDiag), [opzioni.paziente, panel?.nomePaziente?.()]);
        segnaCopia(b, await copiaTesto([c.testo, copiaAvviso(c)].join("\n")));
      });
    };

    const chiudi = (finito) => {
      if (chiuso) return;
      chiuso = true;
      wizardOpen = false;
      ctlDoc?.abort(); ctlPre.abort();
      staccaStampa();
      clearTimeout(timer);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      window.removeEventListener("keydown", onKey, true);
      wrap.remove();
      if (panel) {
        const tutto = finito && tuttiChiesti;
        // «Stampato» solo se lo si sa: il medico è andato avanti lui,
        // documento per documento. Chiuso il dialogo il browser non dice se
        // ha stampato o annullato, e allora è «Stampa finita», con «Ristampa».
        const certo = tutto && !daSola;
        if (fine) {
          // Una richiesta confermata: la pill ne resta il resoconto finché non
          // fai altro — quanti esami, a che ora — e se i fogli non sono usciti
          // tutti (annullato, saltato, non scaricato), «Ristampa» li rifà
          // (con la stampa automatica, senza dialogo: un foglio che non era
          // partito ci riprova).
          // (non finita: ambra, non il ✓ blu di una stampa uscita — «Etichette non stampate · Ristampa»)
          const etichette = jobs.some((j) => /^etichett/i.test(j.name));
          // (l'ordine è «Confermata»; com'è andata la stampa, sotto)
          // (più richieste dallo stesso tocco: i conti e la Ristampa sono di tutte — stampaOrdine)
          const gr = opzioni.gruppo || null;
          const daRifare = gr ? gr.jobs : jobs;
          panel.segnala({ tag: "Confermata", testo: !tutto ? (etichette ? "Etichette non stampate" : "Fogli non stampati") : certo ? "Stampato" : "Stampa finita",
            tono: tutto ? "ok" : "warn", quesito: gr ? `${gr.k} richieste, ${confermatiTesto({ ...fine, n: gr.n || fine.n })}` : confermatiTesto(fine),
            azione: certo ? null : { label: "Ristampa", titolo: gr ? "Stampa di nuovo tutti i fogli di questo ordine: etichette, lista esami, RX" : "Stampa di nuovo etichette e lista esami",
              fn: () => avviaStampa(daRifare.map(({ motivo, ...j }) => j), { ...opzioni, gruppo: null }) }, ...(tutto ? {} : panel.avvisoVisto()) });
        } else if (finito) {
          // una stampa chiesta a mano: la striscia (o il chip) lo dice per qualche secondo
          panel.segnala({ tag, testo: certo ? "✓ Stampato" : "✓ Stampa finita", tono: "ok" }, { ms: 4000, poi: () => panel.chiudiGiro() });
        } else if (panel.striscia && panel.striscia.daStampa) panel.segnala(null);
      }
      onClose?.();
    };
    // Esc annulla solo quando è per la stampa: la scheda a vista, o il fuoco
    // nel riquadrino. Mentre il PDF arriva (o il foglio aspetta chi scrive) un
    // Esc dato al gestionale — una tendina, un campo — è suo.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (pw.hidden && !(e.composedPath ? e.composedPath() : []).includes(wrap)) return;
      e.stopPropagation(); chiudi(false);
    };
    window.addEventListener("keydown", onKey, true);

    // Il dialogo non si è aperto (o si è chiuso all'istante: stampa non
    // disponibile su quel PC): non si salta niente, «🖨 Stampa» lo riapre.
    const nonParte = () => {
      wrap.dataset.stato = "mano";
      nota(`La finestra di stampa non si è aperta? <b>Stampa</b> la riapre — scegli <b>${esc(jobs[i].printer)}</b>.`);
      stato("Stampa: serve un tuo clic", "warn");
    };
    // La stampa del documento in anteprima: il dialogo del browser, dalla sua
    // cornice.
    const stampa = (c) => {
      c.printed = true;
      c.apertoIl = Date.now();
      attempts++;
      wrap.dataset.printAttempts = String(attempts);
      wrap.dataset.stato = "stampo";
      nota(scegli());
      stato(`Stampo ${cosaStampo(jobs[i])}`);
      try { c.f.contentWindow.print(); }
      catch { nonParte(); return; }
      guardaDialogo(c);
    };
    // Il PDF lo stampa il visore di Chrome, e quel visore «afterprint» non lo
    // manda né alla cornice né alla pagina: in Chrome vero si restava ad
    // aspettare «→ Avanti». Il dialogo di stampa però, finché è aperto, si
    // prende il fuoco: fuoco perso dopo la stampa = dialogo aperto, fuoco
    // tornato = dialogo chiuso, e si va avanti da soli. Solo se il fuoco c'era
    // quando è partita la stampa: altrimenti un dialogo non si distingue da
    // un'altra finestra, e resta «→ Avanti» (o l'afterprint, dove arriva).
    const guardaDialogo = (c) => {
      clearInterval(c.vigile);
      if (!document.hasFocus()) return;
      let aperto = false;
      c.vigile = setInterval(() => {
        if (cur !== c || c.avanzato || !c.f.isConnected) { clearInterval(c.vigile); return; }
        if (!document.hasFocus()) aperto = true;
        else if (aperto) { clearInterval(c.vigile); c.dopo?.(); }
      }, 250);
    };

    // Una stampa partita da sola (le etichette dopo la conferma) guarda,
    // prima di OGNI foglio — non solo del primo —, se intanto stai
    // scrivendo: nel gestionale o in un campo del pannello. Allora la scheda
    // e il dialogo aspettano che smetti, e intanto la striscia dice
    // «Etichette pronte · Stampa» (un tocco: subito). Una stampa chiesta da
    // te col suo tocco non aspetta.
    // (e, dopo un ordine, se dalla sua Conferma hai toccato qualcosa: allora
    // il foglio aspetta il tuo tocco, come le etichette — vedi toccatoDopo)
    const toccato = () => !!opzioni.dopo && toccatoDopo(opzioni.dopo);
    const aspettaChiScrive = async (mio, job) => {
      const perche = !opzioni.auto ? "" : toccato() ? "hai toccato qualcosa dalla Conferma" : staScrivendo(true);
      if (!perche) return true;
      let via = () => {};
      const tocco = new Promise((r) => { via = r; });
      subito = () => via(true);
      wrap.dataset.stato = "aspetta"; wrap.dataset.perche = perche;
      panel?.log(`${now()}  ${job.name}: arrivato mentre scrivi (${perche}) — aspetto che smetti (o un tocco su «Stampa»)`);
      const breve = nomeBreve(opzioni.paziente || "");
      stato(/^etichett/i.test(job.name) ? (breve ? `Etichette di ${breve} pronte` : "Etichette pronte") : `Pronto: ${cosaStampo(job)}`, "run",
        { label: "Stampa", titolo: "Stampa adesso, senza aspettare", fn: () => subito && subito() });
      while (!chiuso && mio === gen && (toccato() || staScrivendo(true))) {
        if (await Promise.race([tocco, sleep(500).then(() => false)])) break;
      }
      subito = null;
      return !chiuso && mio === gen;
    };
    const advance = () => {
      clearTimeout(timer);
      staccaStampa();
      if (!cur || !cur.printed) tuttiChiesti = false;
      cur = null;
      ctlDoc?.abort();
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
      i++;
      if (i >= jobs.length) return chiudi(true);
      load();
    };

    const load = async () => {
      const mio = ++gen;
      const job = jobs[i];
      cur = null;
      ctlDoc = new AbortController();
      const segnale = ctlDoc.signal;
      // quello che si sta stampando, leggibile da fuori (i test)
      wrap.dataset.doc = `Stampa ${i + 1} di ${jobs.length} — ${job.name}`;
      wrap.dataset.printer = job.printer;
      wrap.dataset.stato = "carico";
      // Mentre arriva il PDF, niente davanti: la scheda si toglie (via anche
      // l'anteprima di prima) e la si vede solo chiedendola con un tocco.
      vedi(false);
      corpo.innerHTML = `<div class="pwmsg">Carico il PDF…</div>`;
      comandi();
      stato(`Aspetto ${cosaStampo(job)}…`);
      try {
        // un modulo di consenso è un file dell'estensione, non una pagina del
        // gestionale: si prende così com'è, senza la catena same-origin (prendi)
        // («→ Avanti» smette di aspettarlo: segnale)
        // (la scadenza delle etichette di un ordine, ctlPresa, ferma anche un
        // foglio chiesto da qui e ancora in volo: non è il medico che annulla —
        // lo si richiede, una volta, dal cancello del motore come ogni lettura
        // dopo la scadenza)
        const foglio = prendi(i).catch((e) => {
          if (e?.name !== "AbortError" || !ctlPresa.signal.aborted || ctlPre.signal.aborted || segnale.aborted) throw e;
          panel?.log(`${now()}  ${job.name}: fermato dalla scadenza delle etichette dell'ordine, lo richiedo`);
          return prendi(i);
        });
        const { blob, via } = await Promise.race([foglio, new Promise((_, no) => {
          if (segnale.aborted) no(new DOMException("Aborted", "AbortError"));
          segnale.addEventListener("abort", () => no(new DOMException("Aborted", "AbortError")), { once: true });
        })]);
        if (mio !== gen || chiuso) return;
        panel?.log(`${now()}  ${job.name}: PDF ottenuto${via ? " via " + via : ""}`);
        if (!(await aspettaChiScrive(mio, job))) return;
        blobUrl = URL.createObjectURL(blob);
        const f = document.createElement("iframe");
        f.title = `Anteprima — ${job.name}`;
        const c = cur = { f, printed: false, apertoIl: 0, avanzato: false, vigile: 0, dopo: null };
        // Chiuso il dialogo di stampa si passa al documento dopo da soli: è
        // quello che il medico farebbe premendo «→ Avanti», e con
        // l'etichettatrice davanti non ha una mano libera. Il browser non dice
        // se ha stampato o annullato — dice solo che il dialogo si è chiuso —
        // quindi si va avanti in tutt'e due i casi, una volta sola per
        // documento. Un dialogo che si chiude PRIMA di essersi aperto davvero
        // (stampa non disponibile) non fa saltare niente: lo dice la scheda.
        const dopoStampa = () => {
          if (c.avanzato || cur !== c || !f.isConnected || !c.printed) return;
          if (Date.now() - c.apertoIl < 500) { nonParte(); return; }
          c.avanzato = true; daSola = true;
          staccaStampa();
          panel?.log(`${now()}  ${job.name}: finestra di stampa chiusa, passo al documento dopo`);
          clearTimeout(timer);
          timer = setTimeout(advance, 300);
        };
        c.dopo = dopoStampa;
        staccaStampa();   // resti del documento precedente
        window.addEventListener("afterprint", dopoStampa);
        staccaStampa = () => {
          clearInterval(c.vigile);
          window.removeEventListener("afterprint", dopoStampa);
          try { f.contentWindow?.removeEventListener("afterprint", dopoStampa); } catch { /* cornice già andata */ }
        };
        // il cronometro va SEMPRE dentro `timer`, e la stampa parte solo se
        // quella cornice è ancora quella in anteprima: «Avanti» ne lasciava
        // uno orfano, che stampava il documento dopo al posto di questo
        const once = () => { if (!c.printed && cur === c && f.isConnected) stampa(c); };
        f.addEventListener("load", () => {
          try { f.contentWindow?.addEventListener("afterprint", dopoStampa); } catch { /* cornice già andata */ }
          clearTimeout(timer); timer = setTimeout(once, 350);
        });
        timer = setTimeout(once, 1500); // headless/viewer-less fallback
        f.src = blobUrl;      // prima di inserirla: un solo «load», quello del PDF
        corpo.replaceChildren(f);
        // («🖨 Stampa» adesso ha un documento; un foglio che la stampa
        // automatica non ha fatto uscire dice perché passa dal dialogo)
        comandi(job.motivo ? { avviso: `Stampa automatica non riuscita: ${job.motivo}. Dal dialogo, stavolta.` } : {});
        wrap.dataset.stato = "pronto";
        vedi(true);
        stato(`Stampo ${cosaStampo(job)}`);
      } catch (e) {
        if (e?.name === "AbortError" || mio !== gen || chiuso) return;
        // This endpoint is a viewer we can't safely turn into a Blob. Don't
        // auto-open (a popup after the async fetch is blocked for lack of user
        // activation) — offer a big button the doctor clicks, which carries
        // activation and always opens the tab. The sequence still advances.
        // Non tutto quello che fallisce è «un visualizzatore»: una sessione
        // scaduta, un HTTP 500 o una risposta fuori dall'ospedale finivano
        // sotto quella scritta, e «Apri e stampa» apriva la pagina di login.
        const suo = e instanceof ViewerError;
        if (suo && e.html) {
          ultimaDiag = { cosa: `stampa ${job.name}`, url: job.url, html: e.html, diag: e.diag, quando: now() };
          if (panel) panel.segnaDiagnosi(ultimaDiag);
        }
        panel?.log(`${now()}  ${job.name}: PDF non catturato — ${suo ? `visualizzatore${e.diag ? " [" + e.diag + "]" : ""}` : `${e?.head || e?.message || e}`}`);
        corpo.innerHTML = suo
          ? `<div class="pwmsg">Premi <b>Apri e stampa</b> qui sotto, poi <b>Ctrl+P → ${esc(job.printer)}</b>,<br>torna qui e premi «→ Avanti».</div>`
          : `<div class="pwmsg">Questo documento non è stato scaricato. Risolvi il problema qui sopra e riprova la stampa dal pannello.</div>`;
        comandi({
          viewer: suo,
          err: suo ? `Questo documento non si lascia catturare (è un visualizzatore).${e?.diag ? " [" + e.diag + "]" : ""}`
            : `${e?.head || "Non riuscito"}${e?.body ? " — " + e.body : ""}`,
        });
        wrap.dataset.stato = "mano";
        vedi(true);
        stato(suo ? "Apri e stampa: serve un tuo clic" : "Documento non scaricato", "warn");
      }
    };

    load();
  }

  // Le richieste di PS Assist: quelle su cui il motore ha lavorato in questa
  // scheda (NOSTRE), quelle in cui ha mandato esami (daConfermare, in ogni
  // scheda), quella della sua ricevuta. Una richiesta fatta tutta a mano nel
  // gestionale non è fra queste: confermata col suo bottone, non stampa niente da sola.
  const NOSTRE = "richieste.nostre.v1";
  const segnaNostra = (rid) => { if (rid) tabStore.set(NOSTRE, [...(tabStore.get(NOSTRE, []) || []).filter((x) => x !== String(rid)), String(rid)].slice(-20)); };
  const richiestaNostra = (rid) => !!rid && ((tabStore.get(NOSTRE, []) || []).includes(String(rid))
    || daConfermare().some((x) => x.rid === String(rid)) || String(tabStore.get("receipt.v1", null)?.richiestaId || "") === String(rid));

  // Post-confirm print handoff: armed when the native Conferma button is
  // clicked (both by the doctor and by the auto-confirm countdown) on a
  // richiesta of PS Assist, consumed by the first subsequent page that lists
  // this richiesta's print links — the post-confirm page if it has them,
  // otherwise the patient page.
  // Il segno della stampa per una richiesta appena confermata (lab e radiologia
  // dello stesso giro finiscono in UNA stampa). Dalla sua ricevuta: quanti
  // esami, quale quesito, quanti erogatori (le righe da stampare che si
  // aspettano) e la foto delle richieste che la pagina aveva prima del giro.
  function segnoStampa(episodeId, rid, rc) {
    const prev = tabStore.get("print.v1", null);
    const p = prev && prev.episodeId === (episodeId || "") && Date.now() - (prev.ts || 0) < PRINT_FLAG_TTL ? prev : {};
    const suo = rc && String(rc.richiestaId) === String(rid) && Array.isArray(rc.items) ? rc : null;
    const n = { ...(p.n || {}) }, q = { ...(p.q || {}) }, attesi = { ...(p.attesi || {}) };
    let prima = Array.isArray(p.prima) ? p.prima : null;
    if (suo) {
      // quanti esami: lo sa la ricevuta di questa richiesta; senza, il conto non si inventa
      n[rid] = suo.items.length;
      if (suo.quesito) q[rid] = suo.quesito;
      attesi[rid] = new Set(suo.items.map((i) => i.res)).size || 1;
      if (Array.isArray(suo.prima)) prima = [...new Set([...(prima || []), ...suo.prima.map(String)])];
    }
    tabStore.set("print.v1", { ids: [...new Set([...(p.ids || []), rid])], episodeId: episodeId || "", ts: Date.now(), n, q, attesi, ...(prima ? { prima } : {}) });
  }
  // Prima del gancio (bootGestionale, dopo la risposta del service worker:
  // fino a 3 s) la Conferma del gestionale premuta a mano si annota lo stesso,
  // prima che il clic parta: dall'avvio, un ascolto su tutto il documento.
  // Come col gancio: i bottoni del pannello si spengono, e la stampa si arma.
  function confermaPresto(e) {
    const b = e.isTrusted && e.target && e.target.closest ? e.target.closest('input[type="submit"]') : null;
    if (!b || (b.name !== "Update" && b.name !== "Update1")) return;
    const m = examModel(document, location.href);
    if (!m.form || !m.richiestaId || b.form !== m.form) return;
    segnaConferma(m.richiestaId, "premuta");
    confermaAMano();
    confermaNostra(m.richiestaId, findEpisodeId(document, location.href));
  }
  // La Conferma del gestionale premuta da lui (un clic vero): da qui contano i
  // suoi tocchi (PREMUTO) — quella del motore no —, e i bottoni del pannello su
  // questa pagina non premono più: la Conferma vera torna in 3–14 s, e intanto
  // la pagina col bottone è ancora lì (confermaPannello).
  function confermaAMano() {
    tabStore.set(PREMUTO, Date.now());
    confermaPannello = "Confermo…";
    PANNELLO?.render();
  }
  // La Conferma di una richiesta di PS Assist: lascia il giro, e la stampa si arma.
  function confermaNostra(rid, episodeId) {
    if (!richiestaNostra(rid)) return;
    const q = tabStore.get("queue.v1", null);
    if (q && q.items) { // this richiesta is done: drop it from the walk
      const left = q.items.filter((it) => it.rid !== rid);
      tabStore.set("queue.v1", left.length ? { ...q, items: left, ts: Date.now() } : null);
    }
    segnoStampa(episodeId, rid, tabStore.get("receipt.v1", null));
  }
  function armPrintOnConfirm(model, episodeId) {
    if (!model.form || !model.richiestaId) return;
    const arm = (e) => {
      // (ogni Conferma su questo carrello, di chiunque: prima che il clic parta — conferme.v1)
      segnaConferma(model.richiestaId, "premuta");
      if (e && e.isTrusted) confermaAMano();
      confermaNostra(model.richiestaId, episodeId);
    };
    for (const name of ["Update", "Update1"]) {
      const b = model.form.elements.namedItem(name);
      if (b && (b.type || "").toLowerCase() === "submit") b.addEventListener("click", arm, true);
    }
  }

  // After confirming one richiesta of a lab+radiology pair, the server drops us
  // on the patient page: carry on to the one still to confirm.
  function nextQueued(episodeId) {
    const q = tabStore.get("queue.v1", null);
    if (!q || !q.items || !q.items.length) return null;
    if (Date.now() - (q.ts || 0) > QUEUE_TTL) { tabStore.set("queue.v1", null); return null; }
    if (!episodeId || (q.episodeId && q.episodeId !== episodeId)) return null; // fail closed
    return { q, next: q.items[0] };
  }

  function goToQueued(entry, vai = nav) {
    const { q, next } = entry;
    tabStore.set("receipt.v1", { richiestaId: next.rid, episodeId: q.episodeId, ts: Date.now(), items: next.added || [], carrelli: next.carrelli || {}, quesito: next.quesito || null, ...(next.prima ? { prima: next.prima } : {}) });
    if (q.autoConfirm && next.lastCode) {
      tabStore.set("confirm.v1", { richiestaId: next.rid, episodeId: q.episodeId, lastCode: next.lastCode, lastLabel: next.lastLabel, count: next.count, ts: Date.now() });
    }
    tabStore.set("queue.v1", { ...q, items: q.items.map((it, i) => (i ? it : { ...it, nav: true })), ts: Date.now() });
    vai(next.listUrl);
  }

  const PARZIALI = new Set();   // (le richieste già segnalate «meno esami in pagina», una volta per pagina)
  function maybeAutoPrint(panel, doc = document, url = location.href) {
    if (extPersa()) return false;
    const flag = tabStore.get("print.v1", null);
    if (!flag) return false;
    // never print for an episode other than the page in front of the user
    const here = findEpisodeId(doc, url);
    if (!here || (flag.episodeId && flag.episodeId !== here)) return false;
    if (Date.now() - (flag.ts || 0) > PRINT_FLAG_TTL) { tabStore.set("print.v1", null); return false; }
    const map = printModel(doc, url);
    const proprie = (flag.ids || [flag.richiestaId]).filter((id) => map[id]);
    if (!proprie.length) return false; // this page doesn't list them yet — keep waiting
    // Dopo la Conferma il gestionale fa una richiesta per erogatore: si
    // stampano anche quelle NUOVE sulla pagina (non nella foto di prima del
    // giro), mai una che c'era già. Senza la foto, come prima: le sue sole.
    const prima = Array.isArray(flag.prima) ? new Set(flag.prima.map(String)) : null;
    const ids = [...proprie, ...(prima ? Object.keys(map).filter((id) => !prima.has(id) && !proprie.includes(id)) : [])];
    // Meno righe di quanti erogatori aveva il giro: una richiesta può comparire
    // in ritardo. Una rilettura della pagina, poi si stampa quello che c'è.
    const attese = (flag.ids || []).reduce((k, id) => k + ((flag.attesi || {})[id] || 1), 0);
    const trovate = ids.reduce((k, id) => k + printRowsFor(map, id).length, 0);
    const rileggo = prima && trovate < attese && !flag.riletto && !wizardOpen ? urlPaziente(here, url) : "";
    if (rileggo) {
      tabStore.set("print.v1", { ...flag, riletto: true });
      panel?.log(`${now()}  dopo la Conferma: ${trovate} righe da stampare su ${attese} attese — rileggo la pagina fra ${RILEGGI_STAMPA / 1000} s`);
      setTimeout(async () => {
        let r = null;
        try { r = await fetchDoc(rileggo); } catch { r = null; }
        const ok = r && r.doc && classify(r.doc) !== "login" && findEpisodeIdInDoc(r.doc) === here;
        try { maybeAutoPrint(panel, ok ? r.doc : doc, ok ? r.url : url); } catch { /* il segno resta: la pagina dopo */ }
      }, RILEGGI_STAMPA);
      return true;
    }
    if (ids.length > proprie.length) panel?.log(`${now()}  dopo la Conferma: stampo anche ${ids.length - proprie.length === 1 ? "la richiesta nuova" : `le ${ids.length - proprie.length} richieste nuove`} della pagina (una per erogatore)`);
    // group by printer ACROSS the confirmed richieste: labels, then lists,
    // then radiology bookings — one uninterrupted flow
    const jobs = fogliDi(map, ids);
    ids.forEach(confermataProvata);   // in pagina coi suoi fogli: confermata, non c'è più da sorvegliarla
    if (!jobs.length) return false;
    // il resoconto che resta sulla pill: quanti esami, e quando
    const conti = ids.map((id) => (flag.n || {})[id]);
    const fine = { n: conti.every((x) => x > 0) ? conti.reduce((a, b) => a + b, 0) : 0, ts: flag.ts || Date.now(),
      quesito: ids.map((id) => (flag.q || {})[id]).find(Boolean) || null };
    // Meno esami in pagina di quanti ne sono stati confermati: il gestionale ne
    // ha perso una parte dopo la Conferma (visto una volta: nel modulo Richieste
    // c'erano tutti, la pagina, la lista e le etichette ne avevano meno, e
    // aspettare non li riportava). Il medico lo vede da sé: niente da dire — una
    // registrazione automatica, in silenzio, per capire perché. (Le etichette
    // sono per provetta: si contano gli esami delle righe, non le etichette.)
    if (prima && fine.n) try {   // (una lettura e basta: un intoppo qui non tocca la stampa)
      const suoi = new Set(ids.map(String));
      const visti = richiestePagina(doc).filter((r) => suoi.has(String(r.rid))).reduce((k, r) => k + r.esami.length, 0);
      const chiave = [...suoi].sort().join(",");
      if (visti > 0 && visti < fine.n && !PARZIALI.has(chiave)) { PARZIALI.add(chiave); segnaErrore("parziale", { confermati: fine.n, visti }); }
    } catch { /* niente */ }
    // La scheda di un ordine non apre il dialogo di stampa: lì non c'è
    // nessuno. Le etichette si stampano dove sta il medico — le consegna il
    // service worker, a una scheda sola (gli indirizzi sono quelli letti da
    // questa pagina) — o, con la stampa automatica, le stampa lui (vedi
    // consegnaFogli). Solo quelle della richiesta dell'ordine, per il suo
    // paziente: una conferma fatta qui a mano per un altro paziente si stampa
    // qui, come sempre (con la stampa automatica, anche lei dal service worker).
    // (le etichette di queste richieste le ha prese questa scheda — conferme.v1:
    // «Conferma di nuovo» che le trova confermate non le ristampa)
    const prese = () => ids.forEach((id) => segnaConferma(id, "stampata"));
    if (LAVORO && String(flag.episodeId || here) === String(LAVORO.ep)) {
      tabStore.set("print.v1", null);
      prese();
      ricordaStampe(here, map, { gesto: LAVORO.gesto || LAVORO.id, rids: ids });   // (la pagina del medico non si ricarica: i fogli nuovi li vede da qui; e quali sono di questo tocco)
      if (panel) panel._lavoroChiuso = true;   // da qui la scheda non racconta più niente: l'ordine è delle etichette
      consegnaFogli(panel, LAVORO.id, jobs, fine);
      panel?.segnala({ tag: "Confermata", testo: "Etichette pronte: si stampano dove sei", tono: "ok" });
      return true;
    }
    if (wizardOpen) return false;   // keep the flag: these jobs must not vanish behind another wizard
    tabStore.set("print.v1", null);
    prese();
    // (le richieste che si stampano insieme sono lo stesso tocco su Conferma — il giro, la revisione,
    // la cornice, il bottone del gestionale —: «Ristampa» le rifà insieme, come quelle di un ordine in
    // sottofondo. Solo quali sono: i fogli restano quelli della pagina — quella nella cornice può non elencarli tutti)
    ricordaStampe(here, null, { gesto: "p" + (flag.ts || Date.now()), rids: ids });
    // (la Conferma: quando l'ha premuta lui — il giro, o il bottone del gestionale)
    const p = Number(tabStore.get(PREMUTO, 0)) || 0;
    const premuto = p && p <= (flag.ts || 0) + 1000 && (flag.ts || 0) - p < PRINT_FLAG_TTL ? p : flag.ts || 0;
    const op = { panel, tag: "Confermata", fine, title: ids.length > 1 ? `${ids.length} richieste appena confermate.` : "Richiesta appena confermata.",
      ep: flag.episodeId || here, paziente: panel?.nomePaziente(), url, auto: true, dopo: premuto };
    // Il dialogo si apre da solo solo se da quella Conferma non hai toccato
    // niente (la stampa automatica, senza dialogo, va come sempre). Se no la
    // striscia dice «Etichette di ROSSI M. pronte · Stampa», e il segno
    // resta: anche cambiando pagina le etichette aspettano il tuo tocco.
    (async () => {
      if (panel && (flag.tocca || (toccatoDopo(premuto) && !(await stampaAutomatica())))) {
        tabStore.set("print.v1", { ...flag, tocca: true });
        const nome = nomeBreve(op.paziente || "");
        panel?.log(`${now()}  etichette pronte: dalla Conferma hai toccato qualcosa, il dialogo aspetta il tuo «Stampa»`);
        panel?.segnala({ tag: "Confermata", testo: nome ? `Etichette di ${nome} pronte` : "Etichette pronte", tono: "run", daStampa: true,
          azione: { label: "Stampa", titolo: "Stampa adesso le etichette", fn: () => {
            if (wizardOpen || !tabStore.get("print.v1", null)) return;
            tabStore.set("print.v1", null);
            panel.segnala(null);
            avviaStampa(jobs, { ...op, auto: false, dopo: 0 });
          } },
          titoloStop: "Non stamparle adesso (dopo: «Ristampa», in fondo alle Richieste)", onStop: () => { tabStore.set("print.v1", null); panel.segnala(null); } });
        return;
      }
      avviaStampa(jobs, op);
    })();
    return true;
  }

  // I fogli di un ordine fatto in sottofondo, appena la conferma è provata: i
  // link letti da questa pagina vanno al service worker, che da lì tiene il
  // conto foglio per foglio. Con la stampa automatica li stampa lui, senza
  // dialogo e senza nessuno davanti — il medico può essere altrove, anche
  // lontano (l'ordine arriva dal telefono) —, chiedendo i PDF a questa scheda
  // (psassistPdf); se no li consegna alla scheda dove sta il medico. Una volta
  // sola: il segno della stampa è già consumato.
  async function consegnaFogli(panel, id, jobs, fine) {
    const m = { t: "ordineStampa", id, fine, riassunto: confermati(fine), registro: registroLavoro(panel),
      jobs: jobs.map(({ name, printer, url, breve }) => ({ name, printer, url, ...(breve ? { breve } : {}) })) };
    let r = await ask(m);
    if (r.perso) r = await ask(m);   // il service worker che si sveglia può perdere la prima (la seconda è la stessa)
    if (r && r.ok) return panel?.slegaLavoro();
    // il service worker non li vuole (ordine sparito): si stampano da qui, come sempre
    panel?.log(`${now()}  consegna delle etichette non riuscita: le stampo da questa scheda`);
    if (!wizardOpen) avviaStampa(jobs, { panel, tag: "Confermata", fine, title: "Richiesta appena confermata.", ep: LAVORO && LAVORO.ep, url: LAVORO && LAVORO.url });
  }

  // Le ultime righe del Registro della scheda di un ordine: viaggiano con la
  // sua ultima parola, perché la scheda si chiude e il perché di com'è
  // andata deve restare al medico (lo aggiunge al suo Registro: registriOrdini).
  function registroLavoro(panel) {
    const l = panel ? panel.logLines : (tabStore.get("log." + (LAVORO && LAVORO.ep || "x"), null) || {}).lines;
    // (questa scheda, se resta aperta, non se lo riaggiunge)
    if (LAVORO) tabStore.set(REGISTRI, [...(tabStore.get(REGISTRI, []) || []), String(LAVORO.id)].slice(-30));
    return (Array.isArray(l) ? l : []).slice(-40).map((s) => String(s).slice(0, 240));
  }
  const REGISTRI = "registriOrdini.v1";   // gli ordini il cui Registro questa scheda ha già aggiunto al suo
  const GESTI = "gesti.v1", GESTI_TTL = 10 * 60e3;   // i fogli di un tocco su Conferma stampati qui col dialogo (stampaOrdine)
  // la richiesta dell'ordine, e se la sua Conferma è già partita da questa scheda
  const ridLavoro = () => String((LAVORO && LAVORO.rid) || (tabStore.get("receipt.v1", null) || {}).richiestaId || "");
  function confermaPartita() {
    const rid = ridLavoro(), pr = tabStore.get("print.v1", null);
    return !!rid && !!pr && (pr.ids || []).map(String).includes(rid);
  }
  // La scheda di un ordine che si ritrova senza niente da fare — ricaricata
  // (dal gestionale, o da un clic del medico), o finita su una pagina che non
  // è il carrello — quando l'ordine non ha ancora detto com'è andata: niente
  // da riprendere, nessuna conferma armata. Non resta «in corso» per sempre
  // (la coda aspetterebbe con lei): se la Conferma era partita da qui se ne
  // cerca la prova — solo letture —, se no si dice di controllare il
  // carrello. E l'ordine finisce.
  async function lavoroSenzaSeguito(panel) {
    if (!LAVORO || (panel && panel._lavoroChiuso)) return;
    const L = LAVORO, ep = String(L.ep || ""), rid = ridLavoro();
    const listUrl = [(daConfermare().find((x) => x.rid === rid) || {}).listUrl, L.listUrl].find(leggibilePagina) || "";
    const fine = (vista, striscia = null, testo = "") => {
      const consegna = listUrl && striscia ? { url: listUrl, avviso: { striscia: { paziente: L.paziente || "", ...striscia }, ...(testo ? { testo } : {}) }, receipt: tabStore.get("receipt.v1", null) } : null;
      if (panel) return panel.consegnaLavoro(vista, consegna);
      // (una pagina senza pannello: l'ultima parola la dice da qui)
      const m = { t: "ordineAggiorna", id: L.id, stato: "avviso", vista, ...(consegna ? { consegna } : {}), registro: registroLavoro(null) };
      LAVORO = null;
      return ask(m).then((r) => (r.perso ? ask(m) : r));
    };
    if (confermaPartita()) {
      const pr = tabStore.get("print.v1", null) || {};
      const subito = pr.durata != null && pr.durata < CONFERMA_SOSPETTA;
      if (pr.durata != null) panel?.log(`${now()}  la Conferma è tornata in ${(pr.durata / 1000).toFixed(1)} s${subito ? ": guardo subito anche il carrello" : ""}`);
      const prova = await provaConferma(rid, ep, { patientUrl: (L.piano && L.piano.patientUrl) || "", panel, carrello: listUrl, subito });
      if (LAVORO !== L || (panel && panel._lavoroChiuso)) return;
      if (prova && prova.doc && maybeAutoPrint(panel, prova.doc, prova.url)) return;
      if (prova && prova.doc) { ricordaStampe(ep, printModel(prova.doc, prova.url), { gesto: L.gesto || L.id, rid }); return fine({ tag: "Confermata", testo: "etichette dalla sua pagina, Stampa", tono: "ok" }); }
      if (prova && prova.nonPartita) {
        // Il gestionale non l'ha presa (il suo carrello lo dice). Mai una
        // seconda Conferma da sola: «Conferma di nuovo» è un tocco del medico,
        // una volta per richiesta (ordineRiconferma). Già rifatta: il carrello.
        segnaErrore("ordine", { episodio: ep, richiesta: rid, motivo: "Conferma non presa dal gestionale", durata: pr.durata ?? null });
        // Intanto un'altra Conferma per questa richiesta (il medico sul suo
        // carrello, in un'altra scheda): forse in volo, il carrello non lo dice
        // ancora. Non è «non partita»: da controllare, mai «Conferma di nuovo».
        if (confermaDopo(rid, "premuta", pr.ts)) {
          panel?.log(`${now()}  intanto è stata premuta un'altra Conferma per questa richiesta: da controllare, niente da rifare da qui`);
          return fine({ tag: "Da controllare", testo: GUARDA, tono: "warn", quesito: "premuta intanto un'altra Conferma, da un'altra scheda" },
            { tag: "Da controllare", testo: RIFARLA, tono: "warn" }, RIFARLA_PERCHE);
        }
        // (non è in volo: la Conferma del medico sul carrello non la aspetta — confermaGiaPartita)
        segnaConferma(rid, "smentita");
        const rifatta = !!(L.piano && L.piano.startPage === "riconferma");
        // (`premuta`: quale Conferma il carrello ha smentito — «Conferma di nuovo» non parte se ce n'è una dopo)
        return fine({ tag: "Non partita", testo: rifatta ? "apri il carrello" : "Conferma di nuovo", tono: "err",
          quesito: rifatta ? "il gestionale non ha preso nemmeno la seconda Conferma" : "il gestionale non ha preso la Conferma", ...(rifatta ? {} : { riconferma: true, premuta: pr.ts || 0 }) },
        { tag: "Non partita", testo: "Il gestionale non ha preso la Conferma: premi tu Conferma", tono: "err" },
        "Il gestionale non ha preso la Conferma: il carrello ha ancora i suoi esami e il suo bottone Conferma. Controlla e premi tu Conferma.");
      }
      // la Conferma è partita e non si vede: prima di rifarla, le sue richieste (RIFARLA)
      return fine({ tag: "Da controllare", testo: GUARDA, tono: "warn" },
        { tag: "Da controllare", testo: RIFARLA, tono: "warn" }, RIFARLA_PERCHE);
    }
    panel?.log(`${now()}  la scheda dell'ordine è ripartita a giro finito: niente da riprendere, la conferma non è partita`);
    // la Conferma non è partita: lo dice questa striscia, una volta, e poi
    // non resta un promemoria «da confermare»
    if (rid) confermataProvata(rid);
    return fine({ tag: "Non partita", testo: listUrl ? "apri il carrello" : "guarda le sue richieste", tono: "err", quesito: "la scheda dell'ordine si è ricaricata prima della Conferma" },
      { tag: "Non partita", testo: "Controlla il carrello e premi tu Conferma", tono: "err" });
  }

  // Dopo un ordine in sottofondo (dal PC o dal telefono) la pagina del
  // paziente davanti al medico è quella di prima: la richiesta nuova non c'è.
  // Non la si ricarica (tre ricariche in mezzo minuto, nelle registrazioni
  // vere, e ognuna si portava via scorrimento e campi): la scheda dell'ordine
  // ha già letto la pagina del paziente per la prova, e i fogli che quella
  // elenca (printModel: solo numeri, indirizzi della pagina, nomi di esami —
  // mai il paziente) vanno qui, in memoria condivisa, per episodio. Il
  // pannello di una pagina caricata PRIMA usa quelli (stampePaziente): la
  // Ristampa e «Stampa le richieste» vedono la richiesta nuova. Il resto (lo stato degli
  // esami, ✓ e ⏳) lo scrive già leggiStatoPagina. L'«Aggiorna» del gestionale
  // resta quello che è: un tocco tuo.
  const STAMPE_FRESCHE = "stampeFresche.v1", STAMPE_FRESCHE_TTL = 12 * 3600e3;
  // (`chi`: la richiesta e il tocco su Conferma da cui viene — `gesti`, per
  // episodio: quali richieste sono lo stesso ordine, perché «Ristampa» le rifaccia insieme)
  const stampeVive = () => {
    const l = store.get(STAMPE_FRESCHE, {}) || {};
    return Object.fromEntries(Object.entries(l).filter(([, x]) => x && Date.now() - (x.ts || 0) < STAMPE_FRESCHE_TTL).slice(-30));
  };
  // (`map` null: solo il tocco — i fogli e la loro ora restano quelli di prima)
  function ricordaStampe(ep, map, chi = null) {
    if (!ep || (map ? typeof map !== "object" : !chi)) return;
    try {
      const vive = stampeVive(), prima = vive[String(ep)] || {};
      const gesti = { ...(prima.gesti || {}) };
      const rids = chi ? (Array.isArray(chi.rids) ? chi.rids : [chi.rid]).filter(Boolean).map(String) : [];
      if (chi && chi.gesto && rids.length) gesti[String(chi.gesto)] = [...new Set([...(gesti[String(chi.gesto)] || []), ...rids])].slice(-6);
      const tieni = Object.fromEntries(Object.entries(gesti).slice(-10));
      const fogli = map ? { ts: Date.now(), map } : { ts: prima.ts || Date.now(), ...(prima.map ? { map: prima.map } : {}) };
      store.set(STAMPE_FRESCHE, { ...vive, [String(ep)]: { ...fogli, gesti: tieni } });
    } catch { /* memoria piena: resta la pagina com'è */ }
  }
  // i fogli che la pagina del paziente elenca: quelli letti dopo di lei, se ci sono
  // (scaduti, non valgono nemmeno a leggerli)
  function stampePaziente(ep, doc = document, url = location.href) {
    const viva = printModel(doc, url);
    const f = ep ? stampeVive()[String(ep)] : null;
    return f && f.map && f.ts > performance.timeOrigin && doc === document ? f.map : viva;
  }
  // all'avvio: quelli scaduti se ne vanno (anche se nessuno scrive più)
  function potaStampe() {
    try {
      const l = store.get(STAMPE_FRESCHE, null);
      if (!l) return;
      const vive = stampeVive();
      if (Object.keys(vive).length !== Object.keys(l).length) store.set(STAMPE_FRESCHE, vive);
    } catch { /* niente */ }
  }

  // Le etichette di un ordine fatto in sottofondo arrivano qui, dalla scheda
  // dell'ordine attraverso il service worker: i link sono quelli che quella
  // scheda ha letto dalla pagina del gestionale (mai costruiti), e la stampa è
  // quella di sempre. Una volta sola: lo stesso ordine non si stampa due volte,
  // nemmeno da due schede (il segno sta nella memoria condivisa). Da sola,
  // non sopra chi scrive e non sulla pagina di un altro paziente: lì si dice
  // di no, la striscia dice di chi sono, e un tocco («Stampa», `forza`) le stampa.
  function stampaOrdine(panel, m) {
    if (document.visibilityState === "hidden") return { ok: false, why: "nascosta" };
    const fatti = store.get("ordini.stampati", []);
    const giaFatti = Array.isArray(fatti) ? fatti : [];
    if (giaFatti.includes(m.id)) return { ok: true, gia: true };
    if (wizardOpen) return { ok: false, why: "occupata" };
    // (un motore che lavora qui: i PDF sono pagine della stessa sessione — dopo)
    if (motoreQui()) return { ok: false, why: "motore" };
    if (!m.forza) {
      if (staScrivendo(true)) return { ok: false, why: "scrive" };
      // il dialogo da solo solo se dalla Conferma non hai toccato niente: se no
      // le etichette restano al service worker, e la striscia ha «Stampa»
      if (toccatoDopo(Number(m.conferma) || 0)) return { ok: false, why: "toccato" };
      const qui = panel ? panel.epDiQuesta() : findEpisodeId(document, location.href);
      if (qui && qui !== String(m.ep || "")) return { ok: false, why: "altro paziente" };
    }
    const st = m.stampa || {};
    // (un consenso è un file dell'estensione: solo quelli)
    const nostro = (j) => !!j.diretto && String(j.url).startsWith(chrome.runtime.getURL("consensi/"));
    const jobs = (Array.isArray(st.jobs) ? st.jobs : []).filter((j) => {
      try { return j && typeof j.name === "string" && (nostro(j) || new URL(j.url, location.href).origin === location.origin); } catch { return false; }
    }).map((j) => ({ name: j.name, printer: j.printer || "stampante normale", url: nostro(j) ? j.url : new URL(j.url, location.href).href,
      ...(nostro(j) ? { diretto: true } : {}),
      ...(j.motivo ? { motivo: String(j.motivo).slice(0, 160) } : {}) }));   // (la stampa automatica non ci è riuscita: si dice perché)
    if (!jobs.length) return { ok: false, why: "niente da stampare" };
    store.set("ordini.stampati", [...giaFatti, String(m.id)].slice(-30));
    const nome = String(m.paziente || "").slice(0, 60);
    // Si può essere sulla pagina di un altro paziente: la striscia della
    // stampa porta il nome di chi sono le etichette, e la scheda lo scrive.
    const conNome = panel ? new Proxy(panel, {
      get(t, k) {
        if (k === "segnala") return (s, o) => t.segnala(s ? { paziente: nome, ...s } : s, o);
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
      set(t, k, v) { t[k] = v; return true; },
    }) : null;
    panel?.log(`${now()}  etichette dell'ordine per ${nome || "un paziente"}: le stampo qui`);
    // (con la stampa automatica, «Ristampa» non apre niente qui: li rifà il service worker)
    const tag = st.tag || "Confermata";
    // Lo stesso tocco su Conferma, più richieste (una per erogatore): la
    // striscia alla fine e la sua Ristampa sono di tutte — i fogli di ognuna,
    // una volta, le etichette prima. (Solo in questa scheda, dieci minuti.)
    let gruppo = null;
    if (m.gesto && tag === "Confermata") {
      const G = tabStore.get(GESTI, {}) || {}, vivo = (x) => x && Date.now() - (x.ts || 0) < GESTI_TTL;
      const prima = vivo(G[m.gesto]) ? G[m.gesto] : { jobs: [], n: 0, k: 0, ids: [] };
      if (!prima.ids.includes(String(m.id))) {
        const visti = new Set(prima.jobs.map((j) => j.url));
        const tutti = [...prima.jobs, ...jobs.filter((j) => !visti.has(j.url)).map(({ motivo, ...j }) => j)];
        gruppo = { ts: Date.now(), ids: [...prima.ids, String(m.id)], n: prima.n + (Number(st.fine && st.fine.n) || 0), k: prima.k + 1,
          jobs: [...tutti.filter((j) => j.printer === "etichettatrice"), ...tutti.filter((j) => j.printer !== "etichettatrice")] };
        tabStore.set(GESTI, { ...Object.fromEntries(Object.entries(G).filter(([, x]) => vivo(x))), [m.gesto]: gruppo });
      } else gruppo = prima;
    }
    const opz = { tag, fine: st.fine || null, ep: m.ep, paziente: nome, title: `${nome ? nome + " · " : ""}${tag === "Confermata" ? "richiesta appena confermata." : st.riassunto || ""}`,
      dest: m.dest === "stazione" ? "stazione" : "qui", ...(gruppo && gruppo.k > 1 ? { gruppo } : {}) };
    // (la pagina non si ricarica dopo: i fogli nuovi li ha già letti la scheda dell'ordine — stampePaziente)
    avviaStampa(jobs, { ...opz, panel: conNome, auto: !m.forza, dopo: m.forza ? 0 : Number(m.conferma) || 0, presi: String(m.id) });
    return { ok: true };
  }
  // Un foglio che il service worker sta stampando: il PDF, preso da qui come
  // sempre (solo da questa origine). Ogni scheda del gestionale risponde, da
  // subito — prima ancora di sapere chi è: la scheda aperta apposta per dare i
  // PDF di una stampa (ordineFogli) riceve la prima domanda appena l'ha detto.
  function ascoltaPdf() {
    try {
      chrome.runtime.onMessage.addListener((m, _s, reply) => {
        if (!m || m.t !== "psassistPdf") return;
        (async () => {
          const u = new URL(String(m.url || ""), location.href);
          if (u.origin !== location.origin) throw new Error("fuori dal gestionale");
          const { blob } = await fetchPdf(u.href, {});
          return { ok: true, pdf: bufB64(await blob.arrayBuffer()) };
        })().catch((e) => ({ ok: false, why: String(e?.head || e?.message || e).slice(0, 120) })).then(reply);
        return true;
      });
    } catch { /* niente estensione */ }
  }
  // Una scheda del gestionale ascolta gli ordini in sottofondo: le etichette
  // da stampare, e — se è la scheda di un ordine — ⏹ e «ci sei?». Lo stato
  // degli ordini arriva da storage.session (onChanged) e, ogni pochi secondi
  // finché un ordine gira o aspetta la stampa, da una domanda al service
  // worker: è anche lì che si accorge di una scheda chiusa o ferma.
  function ascoltaOrdini(panel) {
    try {
      chrome.runtime.onMessage.addListener((m, _s, reply) => {
        if (!m || typeof m !== "object") return;
        if (m.t === "psassistStampa") { reply(stampaOrdine(panel, m)); return; }
        // (la ricetta pronta: la scheda del SISS viene davanti solo se qui non scrivi)
        if (m.t === "psassistScrive") { reply({ ok: true, scrive: !!staScrivendo(true) }); return; }
        if (!panel || !LAVORO || m.id !== LAVORO.id) return;
        if (m.t === "psassistVivo") { reply({ ok: true }); return; }
        if (m.t === "psassistFerma") reply({ ok: panel.fermaLavoro() });
      });
      if (panel) {
        chrome.storage.onChanged.addListener((ch, area) => {
          if (area === "session" && ch.ordini) panel.ordiniAggiorna(ch.ordini.newValue || []);
        });
      }
    } catch { /* niente estensione */ }
    if (!panel) return;
    setInterval(() => {
      if (!LAVORO && !panel.ordini.some((x) => ORDINE_APERTO.has(x.stato))) return;
      ask({ t: "ordineControlla" }).then((r) => { if (r && r.ok && Array.isArray(r.ordini)) panel.ordiniAggiorna(r.ordini); });
    }, 4000);
  }

