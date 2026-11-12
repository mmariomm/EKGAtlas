/*
 * PS Assist — il registratore, «Ferma e salva»: prende quello che il service
 * worker ha tenuto (registra.js, nel database di registra-db.js), legge il
 * testo dei PDF con la stessa strada del pannello (registra-pdf.js),
 * anonimizza e controlla (registra-anonimo.js) e salva lo zip nel database
 * dell'estensione — nessuna scheda, nessuno scarico: gira in un documento
 * fuori schermo (chrome.offscreen, registra-esporta.html), che il service
 * worker apre per il tempo dello zip e poi chiude. Se il controllo trova
 * qualcosa lo zip si salva lo stesso, e lo dice in cima a riepilogo.txt e
 * nell'elenco. Lo zip salvato e la cancellazione del grezzo sono una
 * transazione sola: o tutte e due, o niente (il grezzo resta, e si riprova).
 * Qui niente chrome.storage (un documento fuori schermo ha solo chrome.runtime):
 * lo stato e il registro degli errori li porta il messaggio del service worker.
 */
(function (g) {
  // Il grezzo di una fonte («grezzi»: la registrazione a mano; «scorre»: gli
  // ultimi 3 minuti), da `da` in poi, già anonimizzato e chiuso in uno zip.
  // `nomi`: i pazienti che l'estensione conosce (registra.js), sostituiti come quelli delle pagine.
  async function esporta({ fonte = "grezzi", st, errori = [], da = 0, nomi = [], opz = {} }) {
    const pagine = [], flusso = [], note = [], schede = [], clic = [], grezzi = [], registro = [], diagnosi = [];
    for (const v of await RegistraDb.tx(fonte, "readonly", (s) => s.getAll())) {
      if (da && !((v.ts || 0) >= da)) continue;
      if (v.tipo === "pagina") pagine.push(v);
      else if (v.tipo === "flusso") {
        flusso.push(...(v.flusso || [])); note.push(...(v.note || [])); schede.push(...(v.schede || [])); clic.push(...(v.clic || []));
        registro.push(...(v.registro || [])); diagnosi.push(...(v.diagnosi || []));
      } else if (v.tipo === "pdf") grezzi.push(v);
    }
    // Il Registro dei pannelli di quei minuti (le righe di ogni scheda, in
    // ordine) e le diagnosi dei documenti che non si sono lasciati leggere:
    // testi liberi, che l'anonimizzazione tratta come il resto (raccolta.testi:
    // testi/registro.txt, testi/diagnosi-N.txt) e il cancello ricontrolla.
    const perScheda = new Map();
    for (const b of registro.sort((a, b) => a.ts - b.ts)) {
      if (!perScheda.has(b.scheda)) perScheda.set(b.scheda, []);
      perScheda.get(b.scheda).push(...(b.righe || []).map(String));
    }
    const testi = [];
    if (perScheda.size) testi.push({ nome: "registro.txt", testo: [...perScheda.values()].map((l, i) => `── scheda ${i + 1} ──\n${l.join("\n")}`).join("\n\n") });
    diagnosi.sort((a, b) => a.ts - b.ts).forEach((d, i) => testi.push({ nome: `diagnosi-${i + 1}.txt`, testo: String(d.testo || "") }));
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
    for (const d of grezzi.sort((a, b) => a.ts - b.ts)) {
      const u8 = new Uint8Array(d.byte || []);
      const o = { url: d.url, ts: d.ts, scheda: d.scheda, origine: d.origine, righe: [], lettore: null, pagine: null, misura: null };
      try { const t = await RegistraPdf.testoPdf(u8.buffer); o.righe = t.righe || []; o.lettore = t.lettore || null; if (!o.righe.length && t.motivo) o.errore = t.motivo; }
      catch (e) { o.errore = String(e && e.message || e).slice(0, 80); }
      try {
        const doc = await g.pdfjsLib.getDocument({ data: u8.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
          useWorkerFetch: false, disableAutoFetch: true, disableStream: true, verbosity: 0 }).promise;
        o.pagine = doc.numPages;
        const v = (await doc.getPage(1)).view;
        o.misura = [Math.round(v[2] - v[0]), Math.round(v[3] - v[1])];
        Promise.resolve(doc.destroy()).catch(() => {});
      } catch { /* pagine e misura restano sconosciute */ }
      pdf.push(o);
    }
    const vocabolario = await (await fetch(chrome.runtime.getURL("registra-vocabolario.json"))).json();
    const raccolta = { versione: st.versione, inizio: st.inizio, fine: st.fine, comeFinita: st.comeFinita, origini: st.origini, pagine, flusso, pdf, schede, clic, errori, testi,
      nomi: Array.isArray(nomi) ? nomi.map(String) : [] };
    const r = RegistraAnonimo.anonimizza(raccolta, { vocabolario, ...opz });
    const zip = RegistraAnonimo.creaZip(r.files, new Date(st.inizio));
    return { zip, r };
  }

  // Salvato: lo zip e i suoi dati in due tabelle (l'elenco non legge i byte),
  // col nome libero (lo stesso minuto due volte: «…-2.zip»), e — per la
  // registrazione a mano — il grezzo via, nella stessa transazione.
  async function salva(m) {
    const { zip, r } = await esporta(m);
    const meta = {
      id: m.meta.id, nome: m.meta.base, ts: Date.now(), quando: m.meta.quando || m.st.inizio, inizio: m.st.inizio, fine: m.st.fine,
      byte: zip.length, motivo: m.meta.motivo === "auto" ? "auto" : "manuale", errore: String(m.meta.errore || "").slice(0, 300),
      controllo: !!r.gate.ok, punti: r.gate.punti || 0, dove: Object.fromEntries(Object.entries(r.gate.dove || {}).slice(0, 30)),
      pagine: r.riepilogo.pagine, richieste: r.riepilogo.richieste, pdf: r.riepilogo.pdf, riepilogo: r.files["riepilogo.txt"] || "",
    };
    await RegistraDb.tx(["zip", "zipdati", ...(m.fonte === "grezzi" ? ["grezzi"] : [])], "readwrite", (z, d, grezzo) => {
      const q = z.getAll();
      q.onsuccess = () => {
        const nomi = new Set(q.result.map((x) => x.nome));
        for (let k = 2; nomi.has(meta.nome); k++) meta.nome = m.meta.base.replace(/\.zip$/, `-${k}.zip`);
        z.put(meta);
        d.put(zip, meta.id);
        if (grezzo) grezzo.clear();
      };
    });
    return meta;
  }

  g.RegistraEsporta = { esporta, salva };
  // Il documento fuori schermo: un messaggio del service worker, uno zip.
  // (Solo lì: aperta in una scheda, questa pagina non fa niente.)
  if (new URLSearchParams(location.search).get("fuori") === "1") {
    chrome.runtime.onMessage.addListener((m, sender, reply) => {
      if (!m || m.t !== "regFuoriEsporta" || !sender || sender.id !== chrome.runtime.id || sender.tab) return;
      salva(m).then((meta) => reply({ ok: true, meta }), (e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 160) }));
      return true;
    });
  }
})(globalThis);
