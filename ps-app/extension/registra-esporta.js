/*
 * PS Assist — il registratore, «Ferma e scarica»: la pagina che prende quello
 * che il service worker ha tenuto (registra.js), legge il testo dei PDF con la
 * stessa strada del pannello (registra-pdf.js), anonimizza e controlla
 * (registra-anonimo.js) e scarica lo zip — se il controllo trova qualcosa,
 * scarica lo stesso ma lo dice qui e in cima a riepilogo.txt. Tutto
 * qui, su questo PC: lo zip si scarica come un file qualunque, e lo manda il
 * medico.
 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const dici = (testo, tono = "") => { const s = $("stato"); s.textContent = testo; s.className = "msg " + tono; };
  // il grezzo sta in IndexedDB (vedi registra.js), lo stato in storage.local
  const db = () => new Promise((ok, no) => {
    const r = indexedDB.open("psassist-registra", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("grezzi", { autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  const tx = async (modo, fn) => {
    const d = await db();
    return new Promise((ok, no) => {
      const t = d.transaction("grezzi", modo);
      const out = fn(t.objectStore("grezzi"));
      t.oncomplete = () => { ok(out && "result" in out ? out.result : undefined); d.close(); };
      t.onerror = t.onabort = () => { no(t.error); d.close(); };
    });
  };
  const cancella = async () => {
    await tx("readwrite", (s) => { s.clear(); });
    await chrome.storage.local.remove("registra");
  };
  $("cancella").addEventListener("click", async () => {
    await cancella().catch(() => {});
    $("ancora").hidden = true; $("cancella").hidden = true;
    dici("Registrazione cancellata da questo PC.", "ok");
  });
  const esito = (x) => { window.__registra = x; document.documentElement.dataset.esito = x.ok ? "ok" : "no"; };

  try {
    const st = (await chrome.storage.local.get("registra")).registra;
    if (!st) { dici("Su questo PC non c'è nessuna registrazione."); esito({ ok: false, why: "nessuna" }); return; }
    if (st.stato === "rec" && Date.now() < st.scade) {
      dici("La registrazione è ancora in corso: fermala dal pannello (⋯ → Ferma e scarica).");
      esito({ ok: false, why: "in corso" }); return;
    }
    $("azioni").hidden = false;
    const pagine = [], flusso = [], note = [], schede = [], grezzi = [];
    for (const v of await tx("readonly", (s) => s.getAll())) {
      if (v.tipo === "pagina") pagine.push(v);
      else if (v.tipo === "flusso") { flusso.push(...(v.flusso || [])); note.push(...(v.note || [])); schede.push(...(v.schede || [])); }
      else if (v.tipo === "pdf") grezzi.push(v);
    }
    // le richieste del pannello (content.js): stesso indirizzo e metodo, un
    // attimo dopo che il pannello l'ha chiesta
    note.sort((a, b) => a.ts - b.ts);
    for (const r of flusso.sort((a, b) => a.inizio - b.inizio)) {
      if (r.estensione || r.registratore) continue;
      const i = note.findIndex((n) => n.url === r.url && n.metodo === r.metodo && r.inizio - n.ts > -1500 && r.inizio - n.ts < 8000);
      if (i >= 0) { r.estensione = true; note.splice(i, 1); }
    }
    // i PDF: il testo, le pagine, la misura — i byte non vanno oltre questa pagina
    const pdf = [];
    for (const [i, d] of grezzi.sort((a, b) => a.ts - b.ts).entries()) {
      dici(`Leggo il testo dei PDF: ${i + 1} di ${grezzi.length}…`);
      const u8 = new Uint8Array(d.byte || []);
      const o = { url: d.url, ts: d.ts, scheda: d.scheda, origine: d.origine, righe: [], lettore: null, pagine: null, misura: null };
      try { const t = await RegistraPdf.testoPdf(u8.buffer); o.righe = t.righe || []; o.lettore = t.lettore || null; if (!o.righe.length && t.motivo) o.errore = t.motivo; }
      catch (e) { o.errore = String(e && e.message || e).slice(0, 80); }
      try {
        const doc = await globalThis.pdfjsLib.getDocument({ data: u8.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
          useWorkerFetch: false, disableAutoFetch: true, disableStream: true, verbosity: 0 }).promise;
        o.pagine = doc.numPages;
        const v = (await doc.getPage(1)).view;
        o.misura = [Math.round(v[2] - v[0]), Math.round(v[3] - v[1])];
        Promise.resolve(doc.destroy()).catch(() => {});
      } catch { /* pagine e misura restano sconosciute */ }
      pdf.push(o);
    }
    dici("Anonimizzo…");
    const vocabolario = await (await fetch(chrome.runtime.getURL("registra-vocabolario.json"))).json();
    const raccolta = { versione: st.versione, inizio: st.inizio, fine: st.fine, comeFinita: st.comeFinita, origini: st.origini, pagine, flusso, pdf, schede };
    const r = RegistraAnonimo.anonimizza(raccolta, { vocabolario });
    const zip = RegistraAnonimo.creaZip(r.files, new Date(st.inizio));
    const d = new Date(st.inizio), p2 = (n) => String(n).padStart(2, "0");
    const nome = `psassist-registrazione-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.zip`;
    const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
    const scarica = () => { const a = document.createElement("a"); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); };
    scarica();
    $("ancora").hidden = false;
    $("ancora").addEventListener("click", scarica);
    const fatto = `Scaricato: ${nome} (${Math.max(1, Math.round(zip.length / 1024))} KB) — ${r.riepilogo.pagine} pagine, ${r.riepilogo.richieste} richieste, ${r.riepilogo.pdf} PDF. `
      + "È nella cartella Download: è quello da mandare. Quando l'hai mandato, cancella la registrazione da questo PC.";
    if (r.gate.ok) dici(fatto, "ok");
    else {
      // lo zip esce lo stesso: l'avviso dice quanti e dove (file e tipo), mai i valori —
      // è anche in cima a riepilogo.txt
      dici(`Attenzione: restano ${r.gate.punti} dati da controllare. ${fatto.replace("è quello da mandare", "guarda questi punti prima di mandarlo")}`, "ko");
      const ul = $("dove");
      ul.hidden = false;
      for (const [file, cat] of Object.entries(r.gate.dove).slice(0, 30)) {
        const li = document.createElement("li");
        li.textContent = `${file}: ${Object.entries(cat).map(([k, n]) => `${k} ×${n}`).join(", ")}`;
        ul.appendChild(li);
      }
    }
    $("riep").hidden = false;
    $("riep").textContent = r.files["riepilogo.txt"];
    await chrome.storage.local.set({ registra: { ...st, esportata: Date.now() } });
    esito({ ok: true, nome, byte: zip.length, controllo: r.gate.ok, punti: r.gate.punti, dove: r.gate.dove });
  } catch (e) {
    dici(`Non esporto: qualcosa è andato storto (${String(e && e.message || e).slice(0, 120)}). La registrazione resta su questo PC.`, "ko");
    esito({ ok: false, why: String(e && e.message || e) });
  }
})();
