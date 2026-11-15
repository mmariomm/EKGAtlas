//@frammento 90-portale.js — Portale clinico (lo storico multi-giorno, bootStorico), poi boot() e la chiusura dell'IIFE.
  // ---------------------------------------------------- portale clinico
  // A strip at the bottom of the portal page: what was read, for whom, and a
  // way to read it again after moving the columns. No panel, no ordering.
  // Una scheda del portale aperta dal pannello per leggere un REFERTO (ECG,
  // radiologia). Il PDF lo ha in mano la pagina — l'ha scaricato lei, per
  // mostrarlo — e portale-pdf.js, che sta nel suo mondo, ne passa una copia:
  // qui la si porta al service worker, che la tiene e chiude la scheda. Se il
  // portale chiede di entrare lo si dice; se il PDF non arriva, si manda com'è
  // fatta la pagina (mai il contenuto), per capire perché.
  // Il portale può mostrare più di un PDF — quello rimasto aperto da prima,
  // poi il nostro —: non si tiene il primo che passa. Si raccolgono, si
  // aspetta un attimo che non ne arrivino altri, e si tiene quello che è di
  // QUESTO paziente (e dell'esame chiesto): vedi scegliPdfReferto. Se sono
  // tutti di un altro paziente non se ne tiene nessuno, e lo si dice.
  function leggiRefertoPortale(chi) {
    let fatto = false, deciso = false;
    let sguardo = null;   // i conti di portale-pdf.js: se risponde, e cosa ha visto
    const candidati = [];
    let attesa = null;
    const decidi = async () => {
      if (deciso) return;
      deciso = true;
      const letti = [];
      for (const c of candidati) letti.push({ righe: (await testoPdf(c.buf).catch(() => null))?.righe || [] });
      const k = scegliPdfReferto(letti, chi || {});
      if (k.i < 0) {
        ask({ t: "refertoSottoDiag", esito: "altro", diag: `${candidati.length} PDF nel portale, ${k.altri} di un altro paziente` }).catch(() => {});
        return;
      }
      const c = candidati[k.i];
      ask({ t: "refertoSotto", data: bufB64(c.buf), size: c.buf.byteLength,
        via: `${c.via}${candidati.length > 1 ? ` ${k.i + 1}/${candidati.length}` : ""}` }).catch(() => {});
    };
    const consegna = (buf, via) => {
      if (deciso || !buf || !(buf.byteLength > 8)) return;
      // lo stesso PDF visto due volte (dal frame e dalla rete) è uno solo
      const coda = new Uint8Array(buf, Math.max(0, buf.byteLength - 48), Math.min(48, buf.byteLength));
      const firma = `${buf.byteLength}:${String.fromCharCode(...coda)}`;
      if (candidati.some((c) => c.firma === firma)) return;
      candidati.push({ buf, via, firma });
      fatto = true;
      clearTimeout(attesa);
      attesa = setTimeout(decidi, 2500);
    };
    window.addEventListener("message", (ev) => {
      const d = ev.data;
      if (ev.origin !== location.origin || !d || typeof d !== "object") return;
      if (d.psassistPdfPronto === 1) {
        const v = sguardo || { blob: 0, rete: 0, pdf: 0 };
        sguardo = { blob: Math.max(v.blob, d.blob || 0), rete: Math.max(v.rete, d.rete || 0), pdf: Math.max(v.pdf, d.pdf || 0) };
      }
      if (d.psassistPdf === 1) consegna(d.buf, d.via || "");
    });
    // a tutti i frame di questa origine: «sei una scheda del pannello» e
    // «ripeti quelli già visti» (lo script del portale parte prima di noi)
    const chiedi = () => {
      const tutti = [window];
      for (let i = 0; i < window.frames.length; i++) tutti.push(window.frames[i]);
      for (const w of tutti) { try { w.postMessage({ psassistSotto: 1, psassistPdfChiedi: 1 }, location.origin); } catch { /* altra origine */ } }
    };
    // …e la pagina stessa: un PDF dentro un frame, un embed o un object come blob:
    const nellaPagina = async () => {
      for (const el of document.querySelectorAll("iframe[src], embed[src], object[data]")) {
        const src = el.getAttribute("src") || el.getAttribute("data") || "";
        if (!/^blob:/i.test(src)) continue;
        try {
          const b = await (await fetch(src)).arrayBuffer();
          if (b.byteLength > 8 && String.fromCharCode(...new Uint8Array(b, 0, 5)) === "%PDF-") consegna(b, "pagina");
        } catch { /* revocato, o d'altra origine */ }
      }
    };
    (async () => {
      for (let giro = 0; giro < 25 && !deciso; giro++) {
        if (document.querySelector('input[type="password"]')) { ask({ t: "sottoLogin" }).catch(() => {}); return; }
        chiedi();
        await nellaPagina();
        await sleep(1000);
      }
      if (!fatto) ask({ t: "refertoSottoDiag", diag: diagPortale(sguardo) }).catch(() => {});
    })();
  }
  // Com'è fatta la pagina del portale, senza niente del paziente: il percorso
  // (numeri tolti), i frame e cosa mostrano, e cosa ha visto portale-pdf.js.
  function diagPortale(sguardo) {
    const senzaId = (x) => String(x || "").replace(/[?#].*$/, "").replace(/\d{2,}/g, "#").slice(0, 80);
    const hash = String(location.hash || "").replace(/[?].*$/, "").replace(/\d+/g, "#").slice(0, 60);
    const frame = [...document.querySelectorAll("iframe, embed, object")].slice(0, 6).map((el) => {
      const src = el.getAttribute("src") || el.getAttribute("data") || "";
      const tipo = el.getAttribute("type") ? `[${el.getAttribute("type")}]` : "";
      return `${el.tagName.toLowerCase()}${tipo} ${/^blob:/i.test(src) ? "blob:" : src ? senzaId(src) : "(vuoto)"}`;
    });
    return [
      `portale ${senzaId(location.pathname)}${hash ? " " + hash : ""}`,
      sguardo ? `sguardo sì (blob ${sguardo.blob} · rete ${sguardo.rete} · pdf ${sguardo.pdf})` : "sguardo NO (portale-pdf.js non risponde)",
      `frame: ${frame.length ? frame.join(", ") : "nessuno"}`,
      `canvas ${document.querySelectorAll("canvas").length}`,
      `textLayer ${document.querySelectorAll(".textLayer").length}`,
      `script ${document.scripts.length}`,
    ].join(" · ");
  }

  function bootStorico() {
    document.getElementById("psassist-attesa")?.remove();
    let unito = null;
    let chiAprivo;   // undefined = non ancora chiesto, null = non lo sappiamo
    const host = document.createElement("div");
    host.id = "psassist-host";
    const root = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);

    const disegna = (stato) => {
      root.innerHTML = `
        <style>
          :host { all: initial; }
          .bar { position: fixed; left: 12px; bottom: 12px; z-index: 2147483647;
                 display: flex; align-items: center; gap: 10px; max-width: min(560px, 92vw);
                 font: 12.5px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
                 background: #0B5CAD; color: #fff; border-radius: 10px; padding: 8px 10px 8px 12px;
                 box-shadow: 0 6px 22px rgba(11,44,80,.28); }
          .bar.ko { background: #6B7A88; }
          b { font-weight: 700; }
          .who { opacity: .85; }
          button { border: 1px solid rgba(255,255,255,.5); background: transparent; color: #fff;
                   border-radius: 7px; padding: 4px 9px; font: inherit; font-weight: 600; cursor: pointer; }
          button:hover { background: rgba(255,255,255,.14); }
          button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
        </style>
        <div class="bar ${stato.ok ? "" : "ko"}" role="status">
          <span>${stato.html || esc(stato.testo || "")}</span>
          <button id="rileggi" title="Dopo aver spostato le colonne o cambiato il periodo">${icoIn("aggiorna", 13)}Rileggi</button>
        </div>`;
      root.getElementById("rileggi").addEventListener("click", leggi);
    };

    const leggi = async () => {
      const letto = leggiStorico(document);
      if (!letto) { disegna({ ok: false, testo: "Nessuna tabella da leggere in questa pagina." }); return; }
      // Da quale paziente il medico è arrivato qui: l'ha aperto lui, dalla sua
      // pagina. È l'identità più solida che ci sia, e non costa una richiesta.
      // Si richiede a OGNI lettura: la scheda del portale resta aperta, e nel
      // frattempo il medico può aver cliccato «Storico» da un altro paziente.
      if (hasExt()) {
        chiAprivo = null;
        try { const r = await ask({ t: "chiAprivo" }); if (r && r.ok) chiAprivo = r; } catch { /* si va avanti */ }
      }
      // …ma vale solo se di là c'è LO STESSO nome: il portale cambia paziente
      // senza ricaricare la pagina, e la tabella di un altro non deve portarsi
      // dietro l'episodio da cui si era partiti.
      const dalClic = !!(chiAprivo && chiAprivo.ep && combaciaNome(chiAprivo.nome, letto.paziente));
      if (dalClic) { letto.ep = chiAprivo.ep; letto.nomeSa4 = chiAprivo.nome || ""; }
      unito = unisciStorico(unito, letto);
      const valori = unito.righe.reduce((n, r) => n + r.valori.filter((v) => v.v).length, 0);
      const chi = [unito.paziente.cognome, unito.paziente.nome].filter(Boolean).join(" ");
      const quanti = `<b>${esc(String(unito.righe.length))} esami · ${esc(String(unito.date.length))} prelievi</b> letti (${esc(String(valori))} valori)`;
      // l'unico testo con del markup dentro: passa da `html`, e ogni pezzo che
      // viene dalla pagina del portale è scappato qui, uno per uno
      const nonSuo = chiAprivo && chiAprivo.ep && !dalClic
        ? ` · non è ${esc(chiAprivo.nome || "il paziente")}, da cui l'hai aperta: si attribuirà col codice fiscale (⭳ Carica i valori)` : "";
      const detto = (nuovo, n) => `${quanti} <span class="who">— ${esc(chi)}${nuovo ? ", nuovo" : ""}${n > 1 ? ` · ${esc(String(n))} pazienti in memoria` : ""}${nonSuo}</span>. Torna sul paziente: sono in Esiti.`;
      if (!hasExt()) {
        disegna({ ok: false, testo: `Letti ${unito.righe.length} esami, ma serve l'estensione per portarli sul paziente.` });
        return;
      }
      // una scheda per paziente: se non c'era, la crea
      mettiInScheda(chiaveArchivio(unito), unito).then((r) => {
        disegna(r && r.ok ? { ok: true, html: detto(r.nuovo, r.pazienti || 1) }
          : { ok: false, testo: "Letto, ma l'estensione non li ha ricevuti: apri il paziente e riprova." });
      });
    };

    // the table redraws when the period changes or the columns are scrolled
    let attesa = null;
    const osserva = document.querySelector(".clinical-data-table__freeze-panel");
    if (osserva) {
      new MutationObserver(() => { clearTimeout(attesa); attesa = setTimeout(leggi, 400); })
        .observe(osserva, { childList: true, subtree: true });
    }
    // Il portale disegna solo le colonne IN VISTA: il medico scorre la tabella e
    // i prelievi compaiono. Nella scheda che il pannello ha aperto in sottofondo
    // non scorre nessuno — e si leggevano solo i primi quattro. Lì la tabella la
    // si scorre qui, a passi, da un capo all'altro: lo stesso gesto del medico,
    // nessuna richiesta nostra. Ogni passo che disegna colonne nuove le aggiunge
    // a quelle già lette (unisciStorico somma, non sostituisce).
    const scorriTutto = async () => {
      const sc = document.querySelector(".clinical-data-table__freeze-container-right");
      if (!sc || sc.scrollWidth <= sc.clientWidth + 4) return;
      const vai = async (x) => {
        sc.scrollLeft = x;
        sc.dispatchEvent(new Event("scroll"));   // in una scheda nascosta il browser non lo manda da sé
        await sleep(700);
        await leggi();
      };
      const passo = Math.max(60, Math.floor(sc.clientWidth * 0.7));
      for (let x = 0; x < sc.scrollWidth; x += passo) await vai(x);
      await vai(sc.scrollWidth);
    };
    leggi().then(() => { if (chiAprivo && chiAprivo.sotto) scorriTutto().catch(() => {}); });
  }

  boot();
})();
