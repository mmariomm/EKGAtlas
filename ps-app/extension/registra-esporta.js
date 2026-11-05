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
  // «Invia per l'analisi»: lo zip va nel repository GitHub PRIVATO del medico
  // (un file in registrazioni/), con un token che può scrivere solo lì,
  // salvato su questo PC (storage.local «registra.invio»). Solo a un tocco,
  // mai da solo. Il token non va mai in un registro né in un messaggio.
  const INVIO = "registra.invio";
  const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  function invio(zip, nome, avviso) {
    const imp = $("invioimp"), bott = $("invia"), detto = $("inviato");
    const dillo = (t, tono = "") => { detto.hidden = false; detto.textContent = t; detto.className = "msg " + tono; };
    const leggi = async () => ((await chrome.storage.local.get(INVIO))[INVIO]) || {};
    const mostra = async () => {
      const c = await leggi();
      $("invrepo").value = c.repo || "mmariomm/psassist-registrazioni";
      $("invtoken").value = "";
      $("invtoken").placeholder = c.token ? "(salvato — incollane uno nuovo per cambiarlo)" : "github_pat_…";
      bott.hidden = !c.token || !c.repo;
      imp.hidden = false;
      if (!c.token) imp.open = true;
    };
    $("invsalva").addEventListener("click", async () => {
      const repo = $("invrepo").value.trim(), token = $("invtoken").value.trim(), c = await leggi();
      if (!REPO_RE.test(repo)) return dillo("Il repository si scrive utente/nome, per esempio mmariomm/psassist-registrazioni.", "ko");
      if (!token && !c.token) return dillo("Incolla il token.", "ko");
      await chrome.storage.local.set({ [INVIO]: { repo, token: token || c.token } });
      imp.open = false;
      dillo("Salvato. Ora «Invia per l'analisi».", "ok");
      mostra();
    });
    $("invtogli").addEventListener("click", async () => { await chrome.storage.local.remove(INVIO); dillo("Token tolto da questo PC."); mostra(); });
    bott.addEventListener("click", async () => {
      const c = await leggi();
      if (!c.token || !REPO_RE.test(c.repo || "")) return mostra();
      bott.disabled = true;
      dillo(`Invio ${nome}…`);
      try {
        const r = await fetch(`https://api.github.com/repos/${c.repo}/contents/registrazioni/${encodeURIComponent(nome)}`, {
          method: "PUT", cache: "no-store",
          headers: { Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
          body: JSON.stringify({ message: `Registrazione ${nome}${avviso ? ` (${avviso})` : ""}`, content: b64(zip) }),
        });
        if (r.status === 201 || r.status === 200) { dillo(`Inviato: ${nome} è in ${c.repo}, cartella registrazioni.`, "ok"); return; }
        const perche = r.status === 401 ? "il token non vale più (scaduto o tolto): rifallo e salvalo"
          : r.status === 403 || r.status === 404 ? `il token non può scrivere in ${c.repo} (repository giusto? permesso Contents: Read and write?)`
          : r.status === 422 ? "c'è già un file con questo nome nel repository"
          : `GitHub ha risposto ${r.status}`;
        dillo(`Non inviato: ${perche}. Lo zip scaricato resta, puoi mandarlo a mano.`, "ko");
        bott.disabled = false;
      } catch (e) {
        dillo(`Non inviato: la rete non arriva a GitHub (${String(e && e.message || e).slice(0, 60)}). Lo zip scaricato resta, puoi mandarlo a mano.`, "ko");
        bott.disabled = false;
      }
    });
    mostra();
  }
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
    // il registro degli errori, dall'ultima registrazione esportata (le voci restano: si sposta solo il segno)
    const reg = await chrome.storage.local.get(["errori.v1", "errori.esportati"]);
    const errori = (Array.isArray(reg["errori.v1"]) ? reg["errori.v1"] : []).filter((x) => x && x.ts > (reg["errori.esportati"] || 0));
    const raccolta = { versione: st.versione, inizio: st.inizio, fine: st.fine, comeFinita: st.comeFinita, origini: st.origini, pagine, flusso, pdf, schede, errori };
    const r = RegistraAnonimo.anonimizza(raccolta, { vocabolario });
    const zip = RegistraAnonimo.creaZip(r.files, new Date(st.inizio));
    const d = new Date(st.inizio), p2 = (n) => String(n).padStart(2, "0");
    const nome = `psassist-registrazione-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.zip`;
    const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
    const scarica = () => { const a = document.createElement("a"); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); };
    scarica();
    $("ancora").hidden = false;
    $("ancora").addEventListener("click", scarica);
    invio(zip, nome, r.gate.ok ? "" : `restano ${r.gate.punti} dati da controllare`);
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
    await chrome.storage.local.set({ registra: { ...st, esportata: Date.now() },
      ...(errori.length ? { "errori.esportati": Math.max(...errori.map((x) => x.ts)) } : {}) });
    esito({ ok: true, nome, byte: zip.length, controllo: r.gate.ok, punti: r.gate.punti, dove: r.gate.dove });
  } catch (e) {
    dici(`Non esporto: qualcosa è andato storto (${String(e && e.message || e).slice(0, 120)}). La registrazione resta su questo PC.`, "ko");
    esito({ ok: false, why: String(e && e.message || e) });
  }
})();
