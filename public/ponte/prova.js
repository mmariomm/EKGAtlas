/*
 * «Prova» — il PC finto. L'app del telefono aperta all'indirizzo /ponte/?prova
 * parla con questo file invece che col ponte: niente presa, niente chiave, niente
 * PC vero (app.js: `chiedi` gli passa ogni comando, e basta). Risponde con i
 * dati inventati di prova-dati.js e finge le scritture — un ordine che passa
 * da «In coda» a «Stampato», la cartella che si salva, la Terapia che si
 * conferma, i Da fare tenuti in memoria. Tutto vive nella memoria della pagina
 * e sparisce quando la si chiude.
 *
 * Due casi per vedere gli stati cattivi: l'ordine per NERI GIULIA finisce
 * «Non partito», e il KETOROLAC in Terapia resta «Incerto: controlla sul PC».
 */
(function () {
  "use strict";
  const MIN = 60e3, H = 3600e3;
  let ctx = null, D = null, contaId = 0;
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const copia = (x) => JSON.parse(JSON.stringify(x));
  const no = (testo, extra) => Object.assign(new Error(testo), extra || {});
  const hm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const paz = (ep) => D.pazienti.find((p) => p.ep === ep) || null;
  const letto = {};   // ep → quando il PC «ha letto» la cartella

  // ------------------------------------------------------------- gli ordini
  const ORDINE_MALE = "NERI GIULIA";
  function spingi(o) {
    const i = D.ordini.findIndex((x) => x.id === o.id);
    if (i >= 0) D.ordini[i] = o; else D.ordini.push(o);
    ctx.ordineVisto(copia(o));
    ctx.render();
  }
  // un ordine (una gamba: laboratorio o radiologia) che va avanti da solo
  function percorso(g, p) {
    const base = { id: g.id, ep: p.ep, paziente: p.nome, n: g.n, rx: g.rx, ts: Date.now(), dettaglio: "" };
    const passo = (ms, o) => setTimeout(() => { if (D) spingi({ ...base, fine: false, ...o }); }, ms);
    passo(300, { stato: "coda", tono: "run", titolo: "In coda", testo: "parte fra poco" });
    passo(1800, { stato: "avvio", tono: "run", titolo: "Parte", testo: "Apro la scheda dell'ordine…" });
    if (p.nome === ORDINE_MALE) {
      passo(4200, { stato: "errore", tono: "err", titolo: "Non partito", testo: "La scheda per l'ordine non si è aperta: niente inviato", fine: true });
      return;
    }
    passo(3500, { stato: "corre", tono: "run", titolo: "In corso", testo: `${g.n} ${g.n === 1 ? "esame" : "esami"}: li inserisco nel carrello` });
    passo(6000, { stato: "stampo", tono: "run", titolo: "Confermata", testo: g.rx ? "Stampo la richiesta su Stampante A4…" : "Stampo le etichette su Zebra ZD421…" });
    setTimeout(() => {
      if (!D) return;
      const s = p.stato || (p.stato = { vit: null, esami: [], vecchio: false, titolo: "", segno: "", cuore: null });
      const nome = g.rx ? "RX" : "Lab";
      if (!s.esami.some((e) => e.nome === nome)) s.esami.push({ nome, t: "1′", banda: "" });
    }, 6000);
    passo(9000, { stato: "avviso", tono: "ok", titolo: g.rx ? "Stampato su Stampante A4" : "Stampato su Zebra ZD421", testo: "alle " + hm(Date.now() + 9000 - 0), fine: true });
  }
  async function ordina(a) {
    const p = paz(a.ep);
    if (!p) throw no("Questo paziente non è più nell'elenco del PC");
    if (p.prec) throw no("Episodio precedente: per ordinare apri quello di oggi");
    if (!String(a.quesito || "").trim()) throw no("Scrivi il quesito diagnostico");
    const esami = [...new Set(a.esami || [])];
    if (!esami.length) throw no("Scegli almeno un esame");
    const rx = new Set(D.richieste.rx);
    const lab = esami.filter((k) => !rx.has(k)), radio = esami.filter((k) => rx.has(k));
    const gambe = [];
    if (lab.length) gambe.push({ id: `tel${a.oid}l`, n: lab.length, rx: false });
    if (radio.length) gambe.push({ id: `tel${a.oid}r`, n: radio.length, rx: true });
    gambe.forEach((g) => percorso(g, p));
    await pausa(900);
    return { ordini: gambe.map((g) => ({ id: g.id, ep: p.ep, paziente: p.nome, n: g.n, rx: g.rx })) };
  }

  // ------------------------------------------------------------ i Da fare
  function leggiProm(testo, adesso) {
    let m = /^(\d{1,2})[:.](\d{2})\s+(.+)$/.exec(testo);
    if (m) { const d = new Date(adesso); d.setHours(+m[1], +m[2], 0, 0); if (d.getTime() <= adesso) d.setDate(d.getDate() + 1); return { t: d.getTime(), testo: m[3] }; }
    m = /^tra\s+(\d+)\s*(h|ore|ora|o|m|min)\s+(.+)$/i.exec(testo);
    return m ? { t: adesso + Number(m[1]) * (/^(h|ore|ora|o)$/i.test(m[2]) ? H : MIN), testo: m[3] } : null;
  }

  // ------------------------------------------------------------ la cartella
  const NOMI = ["ANAMNESI", "MALATTIE_PREGRESSE", "FARMACI_ASSUNTI", "ALLERGIE", "ESAME_OBIETTIVO"];
  function cartella(ep, aggiorna) {
    const c = D.cartelle[ep] || (D.cartelle[ep] = Object.fromEntries(NOMI.map((n) => [n, ["", false]])));
    if (aggiorna || !letto[ep]) letto[ep] = Date.now() - (aggiorna ? 0 : 7 * MIN);
    return { ep, letto: letto[ep], campi: NOMI.map((n) => ({ nome: n, v: c[n][0], ro: c[n][1] })) };
  }

  // ------------------------------------------------------------ la Terapia
  const riga = (v, prog) => ({ prog: String(prog), descr: v.descr, qta: v.qta || "", um: v.um ? v.um.t : "", via: v.via ? v.via.t : "", dil: v.dil ? v.dil.t : "",
    continua: !!v.continua, bisogno: !!v.bisogno, freq: v.freq || "", ora: hm(Date.now()) });
  function terapie(ep) { return { ep, letto: Date.now(), righe: copia(D.terapie[ep] || []), opz: D.opz, pref: D.preferiti }; }

  // ------------------------------------------------------------------ un PDF
  // (un foglio vero ma piccolo: il testo del referto, e «prova» in cima)
  function pdfDi(testo) {
    const c = "BT /F1 11 Tf 14 TL 50 790 Td\n" + ("PROVA - referto finto\n\n" + testo).split("\n").slice(0, 44).map((r) => "(" + r.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&") + ") Tj T*").join("\n") + "\nET";
    const o = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>", "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
      `<</Length ${c.length}>>\nstream\n${c}\nendstream`, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"];
    let s = "%PDF-1.4\n";
    const off = o.map((x, i) => { const a = s.length; s += `${i + 1} 0 obj\n${x}\nendobj\n`; return a; });
    const x = s.length;
    s += `xref\n0 ${o.length + 1}\n0000000000 65535 f \n${off.map((a) => String(a).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<</Size ${o.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF`;
    return s;
  }
  function pdf(a) {
    let testo = "";
    for (const e of Object.values(D.esiti)) for (const r of e.referti) if (r.id === a.ref) testo = `${r.titolo} - ${r.quando}\n\n${r.testo}`;
    if (!testo) throw no("Referto non trovato");
    const s = pdfDi(testo);
    return { size: s.length, n: 1, i: 0, b: btoa(s) };
  }

  // ------------------------------------------------------ i comandi del PC
  async function esegui(cmd, a) {
    const p = a.ep ? paz(a.ep) : null;
    switch (cmd) {
      case "ciao": return { scade: Date.now() + 14 * H, inattivoMin: 3 };
      case "esci": return null;
      case "pazienti": return copia(D.pazienti);
      case "triage": return copia(D.triage);
      case "mappa": return copia(D.mappa);
      case "richieste": return copia(D.richieste);
      case "eo": return copia(D.eo);
      case "ordini": return copia(D.ordini);
      case "terapie": if (!a.ep) return null;
        if (!p) throw no("Questo paziente non è più nell'elenco del PC");
        return terapie(a.ep);
      case "terapiaCerca": {
        const q = String(a.q || "").toLowerCase();
        await pausa(700);
        return { q: a.q, voci: D.voci.filter((v) => v.toLowerCase().includes(q)) };
      }
      case "terapiaAggiungi": {
        if (!p) throw no("Questo paziente non è più nell'elenco del PC");
        if (p.prec) throw no("Episodio precedente: per prescrivere apri quello di oggi");
        await pausa(2500);
        if (/KETOROLAC/i.test(a.voce.descr)) throw no("Incerto: controlla sul PC", { incerto: true });
        const l = D.terapie[a.ep] || (D.terapie[a.ep] = []);
        l.push(riga(a.voce, Math.max(0, ...l.map((r) => Number(r.prog) || 0)) + 1));
        const t = terapie(a.ep);
        delete t.pref;
        return t;
      }
      case "esiti": if (!p) throw no("Questo paziente non è più nell'elenco del PC");
        return copia(D.esiti[a.ep] || D.vuoti(p));
      case "aggiornaValori": {
        if (!p) throw no("Questo paziente non è più nell'elenco del PC");
        await pausa(2200);
        const e = D.esiti[a.ep] || (D.esiti[a.ep] = D.vuoti(p));
        e.letto = Date.now();
        return copia(e);
      }
      case "pdf": return pdf(a);
      case "cartella": if (!p) throw no("Questo paziente non è più nell'elenco del PC");
        return cartella(a.ep, !!a.rileggi);
      case "cartellaSalva": {
        if (!p) throw no("Questo paziente non è più nell'elenco del PC");
        if (p.prec) throw no("Episodio precedente: per scrivere in cartella apri quello di oggi");
        await pausa(1500);
        const c = D.cartelle[a.ep] || (D.cartelle[a.ep] = Object.fromEntries(NOMI.map((n) => [n, ["", false]])));
        const salvati = [];
        for (const [n, x] of Object.entries(a.campi || {})) if (c[n] && !c[n][1]) { c[n][0] = x.dopo; salvati.push(n); }
        letto[a.ep] = Date.now();
        return { ...cartella(a.ep), salvati };
      }
      case "nota": {
        if (!p) throw no("Questo paziente non è più nell'elenco del PC");
        await pausa(400);
        p.nota = String(a.testo || "").replace(/\s*\n+\s*/g, " · ").replace(/\s+/g, " ").trim().slice(0, 500);
        return copia(p);
      }
      case "promemoria": {
        if (!p) throw no("Questo paziente non è più nell'elenco del PC");
        if (p.prec) throw no("Episodio precedente: per un Da fare con l'ora apri quello di oggi");
        await pausa(400);
        const x = leggiProm(String(a.testo || "").trim(), Date.now());
        if (!x) throw no("Scrivi anche l'ora: «11:30 tropo», «tra 2h ECG»");
        p.prom.push({ id: "pr" + ++contaId + "x", t: x.t, testo: x.testo });
        p.prom.sort((u, v) => u.t - v.t);
        return copia(p);
      }
      case "fatto": {
        if (!p) throw no("Questo paziente non è più nell'elenco del PC");
        await pausa(300);
        const n = p.prom.length;
        p.prom = p.prom.filter((x) => x.id !== a.pid);
        if (p.prom.length === n) throw no("Da fare non trovato: forse è già fatto", { dati: copia(p) });
        return copia(p);
      }
      case "ordina": return ordina(a);
      default: throw no("Nella prova questo non c'è: " + cmd);
    }
  }

  const PROVA = {
    chiedi(cmd, args) {
      return pausa(cmd === "ordina" || /^(terapia|cartellaSalva)/.test(cmd) ? 0 : 150 + Math.random() * 250).then(() => esegui(cmd, args || {}));
    },
    avvia(c) {
      ctx = c;
      D = window.PROVA_DATI(Date.now());
      D.ordini = [];
      const S = c.S;
      // un «PC» presente per tutto il resto dell'app: sessione aperta, presa viva, niente scadenza
      S.coppia = { k: null, scade: Date.now() + 14 * H, dev: "" };
      S.codice = "prova";
      S.canale = {};
      S.nSessione = "prova";
      S.pari = true;
      S.ws = { readyState: 1, bufferedAmount: 0, send() {}, close() {} };
      document.body.classList.add("prova");
      const b = document.createElement("div");
      b.className = "prova-banda";
      b.setAttribute("role", "note");
      b.textContent = "Prova · dati finti · niente va al PC";
      document.body.insertBefore(b, document.body.firstChild);
      // niente da chiudere né da riassociare, qui; e le voci che parlano col PC vero non ci sono
      document.addEventListener("click", (e) => {
        const x = e.target.closest && e.target.closest("[data-a]");
        const a = x && x.dataset.a;
        if (!a) return;
        if (["esci", "dimentica", "riapri", "scansiona", "sostituisci", "tieni", "cambia"].includes(a)) {
          e.stopImmediatePropagation(); e.preventDefault();
          c.avviso("Prova: riparto da capo");
          setTimeout(() => location.reload(), 600);
        } else if (["stampaPdf", "registrazioni"].includes(a)) {
          e.stopImmediatePropagation(); e.preventDefault();
          c.avviso("Nella prova questa voce non c'è");
        }
      }, true);
    },
  };
  window.PROVA = PROVA;
})();
