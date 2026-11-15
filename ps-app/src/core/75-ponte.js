//@frammento 75-ponte.js — PONTE (iPhone): stato, pin «Da rivedere», pazienti/esiti/catalogo per il telefono, ordini e ristampe, ponteAscolta.
  // =================================================================== PONTE
  // Il pannello sull'iPhone (ps-app/ponte/README.md). La presa cifrata sta
  // nel service worker (ponte-sw.js); qui, in una scheda del gestionale, si
  // eseguono i comandi del telefono col codice di sempre — elenco, esiti,
  // ordine, nota, promemoria — e ogni scheda dice, nell'intestazione, che una
  // sessione è aperta. Niente qui manda dati fuori dall'ospedale: le risposte
  // vanno al service worker, che le cifra per il telefono.
  let PANNELLO = null;       // il pannello di questa pagina (per il Registro)
  let PONTE_STATO = null;    // lo stato del ponte (storage.session), per l'intestazione
  let PONTE_VALORI = null;   // questa scheda l'ha aperta il ponte per «Aggiorna i valori» di { ep }
  let PONTE_CARTELLA = null; // questa scheda l'ha aperta il ponte per salvare la cartella: { ep, fase, campi }
  let PONTE_TERAPIA = null;  // …o per la pagina Terapia: { ep, nome, fase, cosa, q | voce, visti, prima }
  let PONTE_ACCETTA = null;  // …o per «Accetta in ambulatorio»: { ep?, k?, nome, area, fase }
  let PONTE_LISTA = null;    // …o per la lista dell'area di chi il PC conosce solo dalla smart: { ep, k, nome, nato }
  let PONTE_AGG = "";        // l'episodio di questa pagina che il telefono ha appena salvato: il suo «Conferma» è fermo («Ricarica»)
  const ICO_TEL = ICO.tel;   // (sulla griglia delle altre: 16 px, tratto 1.6)
  const PONTE_CSS = `
    .pontespia { display: inline-flex; align-items: center; gap: 7px; margin-top: 6px; padding: 4px 4px 4px 11px; border-radius: 999px;
                 background: #16232E; color: #fff; font-size: 12px; font-weight: 700; white-space: nowrap; box-shadow: 0 4px 14px rgba(9,42,74,.28); }
    .wrap:not(.win) > .pontespia { display: flex; width: max-content; margin-left: auto; }
    .hd .pontespia { margin: 0; box-shadow: none; height: 30px; padding: 0 3px 0 11px; background: #E8F5EC; color: #124F31; font-weight: 600; }
    .hd .pontespia button { height: 24px; padding: 0 10px; background: #fff; }
    .pontespia .pdot { width: 8px; height: 8px; border-radius: 50%; background: #7FD1A8; }
    .hd .pontespia .pdot { background: var(--ok); }   /* ferma: la spia resta, il movimento no */
    .pontespia button { border: 0; border-radius: 999px; background: #fff; color: #16232E; padding: 4px 10px; font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; }
    .pontespia button:hover { background: #E3E9F0; }
    /* (3.87) un avviso del ponte: ambra, e non è la spia della sessione */
    .ponteavv { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 3px 0 11px; border-radius: 999px; background: #FFF4DB; color: #5C3B00; font-weight: 600; font-size: 12px; }
    .ponteavv button { border: 0; border-radius: 999px; background: #fff; color: #16232E; height: 24px; padding: 0 10px; font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; }
  `;
  // «iPhone collegato · Scollega»: finché una sessione è aperta, in ogni
  // scheda, a pannello aperto o ridotto. Chi passa davanti al PC lo vede.
  const ponteSpia = () => (PONTE_STATO && PONTE_STATO.sessione ? `<div class="pontespia" role="status" title="Il medico sta usando il pannello dall'iPhone: ogni comando finisce nel Registro">
      <span class="pdot"></span>${ICO_TEL}<span>iPhone collegato</span><button type="button" id="ponteoff" title="Chiude la sessione dell'iPhone">Scollega</button></div>` : "")
    // la cartella di questa pagina è stata salvata dal telefono mentre qui c'era un testo scritto: la pagina è vecchia
    // (non si è ricaricata da sola per non perderlo), e il suo «Conferma» è fermo finché non la si ricarica
    + (PONTE_AGG ? `<div class="pontespia" role="status" title="Anamnesi, farmaci o allergie salvati dall'iPhone: questa pagina mostra ancora i testi di prima, e il suo «Conferma» è fermo">
      ${ICO_TEL}<span>Aggiornato dal telefono</span><button type="button" id="ponterica">Ricarica</button></div>` : "")
    // (3.87) un avviso del ponte che chiede una decisione sul PC: l'iPhone in pausa per un altro utente, una stazione di stampa
    // da confermare — «Apri» porta alla pagina iPhone, dove si decide (un iPhone cambiato lo dicono la pagina iPhone e il Registro)
    + (PONTE_STATO && (PONTE_STATO.pausa || PONTE_STATO.stazioneChiesta) && PONTE_STATO.avviso ? `<div class="ponteavv" role="status" title="${esc(PONTE_STATO.avviso.testo)}">
      ${ICO_TEL}<span>${esc(PONTE_STATO.pausa ? "iPhone in pausa: un altro utente" : "Stazione da confermare")}</span><button type="button" id="ponteavv">Apri</button></div>` : "");

  const pontePaziente = (ep) => tuttiPazienti().find((p) => p.ep === ep) || null;
  // Chi il PC conosce solo dalla lista smart non ha ancora un indirizzo della sua pagina: lo dà la riga
  // della lista della sua area (mai costruito), e l'area la cambia il medico, sul PC — mai da qui dietro.
  const senzaPagina = (p) => {
    const k = areeLeggi().membri[p?.ep]?.k;
    return `Il PC conosce ${p?.name || "questo paziente"} solo dalla lista smart: apri una volta la lista ${k ? `«${titoloArea(k, areeLeggi().viste[k]?.label)}»` : "della sua area"} nel gestionale`;
  };
  // …e per il telefono, dov'è: la sua area è quella in testa al gestionale adesso (`qui`: il service
  // worker ne legge la lista dietro, col suo link — ponteListaSotto), un'altra (`altra`: il telefono
  // offre «Passa il PC all'area …», ponteAreaApri), o non si sa (niente: mai un'area indovinata).
  const ponteSmart = (p) => {
    const k = areeLeggi().membri[p?.ep]?.k, ora = store.get(AREA_ORA, null);
    return !k ? {} : ora && ora.k === k ? { qui: true } : { altra: true };
  };
  const nonQui = (p) => ({ ok: false, errore: senzaPagina(p), smart: ponteSmart(p) });
  // l'indirizzo della sua pagina, come il gestionale l'ha dato: solo da leggere, e di quell'episodio
  const ponteUrlPaziente = (p) => (p && leggibilePagina(p.url) && param(p.url, "EPISODIO_ID") === p.ep
    && /\/menuPsoEpisodio\.do$/i.test(new URL(p.url).pathname) ? p.url : "");
  // Al triage, per quello che il PC ne sa: la sua pagina è quella del triage e nessuna lista
  // dell'ambulatorio l'ha visto dopo. (Il telefono offre «Accetta in ambulatorio»; lo dice la lista del triage.)
  const ponteInTriage = (p) => { const u = ponteUrlPaziente(p); return !!u && param(u, "MVPG") === "PsoEpisodioClinicoTriage" && !((p.lista || 0) > (p.ts || 0)); };
  // L'elenco, come la vista Pazienti: chi è in lista e chi è nella stanza (col
  // suo posto), il triage, la nota e i promemoria — cioè «Da fare»: la nota è
  // la prima voce aperta senza ora, i promemoria quelle con l'ora (il telefono
  // non ha la lista intera) —; gli episodi precedenti in fondo.
  // I pazienti nell'ordine della Lista del pannello: per area (Alta · Bassa ·
  // OBI · Codici minori, poi le altre), dentro ognuna la riga del gestionale,
  // poi per ingresso; chi non ha area in fondo. (Il telefono, e le Consegne.)
  function inOrdineTabellone(m) {
    const a = areeLeggi(), k = (i) => a.membri[i.p.ep]?.k || "", n = (i) => a.membri[i.p.ep]?.n;
    const sa = (i) => Number.isInteger(n(i)), ingresso = (i) => i.p.arrivo || i.p.ts || Infinity;
    const posizione = (c) => (c ? ordineArea(c) : AREE_ORDINE.length + 1);
    return [...m.info.values()].sort((x, y) => posizione(k(x)) - posizione(k(y)) || k(x).localeCompare(k(y))
      || (sa(x) && sa(y) ? n(x) - n(y) : sa(y) - sa(x)) || (ingresso(x) - ingresso(y)) || 0)
      .map((i) => ({ i, area: k(i) ? titoloArea(k(i), a.viste[k(i)]?.label) : "" }));
  }
  // ------------------------------------------------ i pin «Da rivedere» (appunti-sw.js)
  // Chi è un paziente, per il suo pin: il nome come lo scrive il gestionale (e cognome e nome), il codice fiscale
  // se il PC lo sa, la data di nascita se si legge (sulla sua pagina), l'impronta della nascita (per ritrovarlo
  // nelle liste) e l'indirizzo della sua pagina come il gestionale l'ha dato (ponteUrlPaziente: mai costruito).
  // L'episodio resta solo un indizio. Tutto questo viaggia e sta cifrato: il ripetitore non lo vede.
  const PIN_NOTA_MAX = 500;   // (come APP_NOTA_MAX, appunti-sw.js)
  const DUE_TOCCHI_MS = 6000;   // il secondo tocco di un'azione che non si annulla (dueTocchi)
  const EO_RESET_ARMATO = "↺ Riprendo l'originale? Tocca di nuovo", DIM_VIA_ARMATO = "✕ Elimino il foglio? Tocca di nuovo";
  const PIN_PART = /^(DE|DI|DA|DEL|DELLA|DELLE|DELLO|DEI|DEGLI|DAL|DALLA|DALLE|DALLO|LA|LO|LE|LI|SAN|SANTA|SANTO|VAN|VON|MC|MAC|DOS|DAS|DU)$/i;
  function pinDati(p) {
    const w = String(p.name || "").trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < w.length - 2 && PIN_PART.test(w[i])) i++;
    const cf = String(p.pk || "").startsWith("cf:") ? p.pk.slice(3) : "";
    const qui = !!PANNELLO && p.ep === PANNELLO.epDiQuesta();
    const m = qui ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(nascitaInPagina(document)) : null;
    return { paziente: p.name || "", cognome: w.slice(0, i + 1).join(" "), nome: w.slice(i + 1).join(" "), cf: /^[A-Z0-9]{16}$/.test(cf) ? cf : "",
      nascita: m ? `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}` : "", nato: p.nato || "", ep: p.ep, url: ponteUrlPaziente(p) };
  }
  // Il paziente di un pin fra quelli che il PC conosce adesso (le sue liste): lo stesso codice fiscale, o lo stesso
  // nome con la stessa nascita, o lo stesso episodio con lo stesso nome. Nessuna ricerca nel gestionale.
  function pinNoto(pin) {
    const l = tuttiPazienti().filter((p) => !p.arch);
    if (pin.cf) { const x = l.find((p) => p.pk === "cf:" + pin.cf); if (x) return x; }
    const nome = normNome(pin.paziente || [pin.cognome, pin.nome].join(" "));
    // (un codice fiscale diverso da quello del pin: non è lui, qualunque cosa dica il nome)
    const altroCf = (p) => !!pin.cf && String(p.pk || "").startsWith("cf:") && p.pk !== "cf:" + pin.cf;
    if (nome && pin.nato) { const x = l.filter((p) => normNome(p.name) === nome && p.nato === pin.nato && !altroCf(p)); if (x.length === 1) return x[0]; }
    const e = pin.ep ? l.find((p) => p.ep === pin.ep && !altroCf(p)) : null;
    return e && nome && normNome(e.name) === nome ? e : null;
  }
  function pontePazienti() {
    const m = PANNELLO.pazModello();
    // (il telefono mette i titoli delle aree)
    return inOrdineTabellone(m).map(({ i, area }) => ({
      area,
      // (due con lo stesso nome: il nome porta il segno che li distingue, «· …9001», anche nella conferma)
      ep: i.p.ep, nome: i.lungo + i.coda, breve: i.breve + i.coda, omonimo: !!i.omonimo, triage: i.p.triage || "",
      posto: PANNELLO.nomePosto(m, i), nota: dfNota(i.p.ep, m.df)?.testo || "", prec: !!i.prec, spento: !!i.spento, visto: i.p.ts || 0,
      eta: Number.isInteger(i.p.eta) ? i.p.eta : String(i.p.pk || "").startsWith("cf:") ? etaDaCf(i.p.pk.slice(3)) : null,
      prom: promDi(i.p.ep, m.prom).map((x) => ({ id: x.id, t: x.t, testo: x.testo })),
      df: dfDi(i.p.ep, m.df).map((x) => ({ id: x.id, testo: x.testo, t: x.t, fatto: x.fatto })),
      ordina: !!ponteUrlPaziente(i.p) && !i.prec,
      ...(!i.prec && !ponteUrlPaziente(i.p) ? { smart: ponteSmart(i.p) } : {}),   // (noto solo dalla lista smart: dov'è, per il telefono)
      ...(!i.prec && ponteInTriage(i.p) ? { accetta: true } : {}),
      stato: i.prec ? null : ponteStato(i.p.ep, m.df),
      allergie: i.prec ? null : ponteAllergie(i.p.ep),
    }));
  }
  // Le allergie, con le parole di sotto il nome sul pannello («Allergie: nega», «non compilate», «non lette», o il testo):
  // `k` è com'è colorata (ros = c'è un testo). Per il telefono, sotto il nome e nel riepilogo della Terapia.
  function ponteAllergie(ep) {
    const all = statoDi(ep)?.anag?.allergie;
    return !all ? { k: "nl", t: "Allergie: non lette" } : all.nega ? { k: "nega", t: "Allergie: nega" }
      : all.testo ? { k: "ros", t: `Allergie: ${String(all.testo).slice(0, 400)}` } : { k: "nc", t: "Allergie: non compilate" };
  }
  // Le mappe, per il telefono (sola lettura): per ciascuna il nome, la griglia, i letti e
  // le aree com'è salvata sul PC (o quella di partenza), e chi sta dove — solo l'episodio:
  // il resto del paziente il telefono lo ha già dalla riga di `pazienti`. Un paziente sta
  // in un posto solo (se due mappe lo dicono vale l'ultimo, come nel tabellone); gli
  // episodi precedenti non hanno posto. `vista` è quella che il PC sta guardando.
  function ponteMappe() {
    const ks = ["alta", "ps"].filter((k) => MAPPE[k]), per = new Map(ks.map((k) => [k, PANNELLO.conMappa(k, () => PANNELLO.pazModello())]));
    const dove = new Map();
    for (const [k, m] of per) for (const [ep, v] of Object.entries(m.posti)) {
      if (m.info.get(ep)?.prec) continue;
      const x = dove.get(ep);
      if (!x || (v.ts || 0) > (x.v.ts || 0)) dove.set(ep, { k, v });
    }
    return {
      vista: PANNELLO.vistaTab(), cols: PIANTA.cols, rows: PIANTA.rows, modifica: true,
      mappe: ks.map((k) => ({
        k, nome: NOME_VISTA[MAPPE[k].vista],
        letti: per.get(k).sala.letti.map((l) => ({ id: l.id, c: l.c, r: l.r, ...misuraLetto(l), nome: l.nome, ...(l.forma && { forma: l.forma }) })),
        aree: per.get(k).sala.aree.map((a) => ({ id: a.id, c: a.c, r: a.r, w: a.w, h: a.h, nome: a.nome })),
        posti: [...dove].filter(([, x]) => x.k === k).map(([ep, x]) => ({ ep, tipo: x.v.tipo, id: x.v.id })),
        // chi è al Triage (la sua chiave: il nome il telefono lo ha dalla riga di `triage`), di partenza in Sala attesa
        ospiti: PANNELLO.conMappa(k, () => PANNELLO.ospitiIn(k, per.get(k).pazienti))
          .filter((o) => o.posto.tipo === "area" || !per.get(k).perLetto[o.posto.id]).map((o) => ({ ep: o.r.k, tipo: o.posto.tipo, id: o.posto.id })),
      })),
    };
  }
  // Gli EO salvati, per la cartella del telefono (sola lettura): chiave, nome, gruppo e testo — i suoi, con le
  // sue modifiche (eo.v1), come li copia il tab «EO». Niente si legge dal gestionale.
  function ponteEo() {
    return Object.entries(eoVoci()).slice(0, 80).map(([k, v]) => ({ k, nome: String(v.nome || k).slice(0, 60), gruppo: v.gruppo, testo: String(v.testo).slice(0, 4000) }));
  }
  // Lo stato della riga del tabellone, in dati, per la riga del telefono: per
  // tipo solo quello che aspetta, col tempo e la sua banda («Lab 50′»), o ✓ se
  // è tornato tutto (come nell'area); il pallino del letto (segnaleLetto) e il
  // cuore. Il titolo è quello del PC, con «letto alle …». Niente se non si sa.
  function ponteStato(ep, df, ora = Date.now()) {
    const s = statoDi(ep), st = statoEsami(s, ora), c = cuoreDi(s?.vit, ora), vit = vitPonte(s?.vit);
    const segno = (/class="stseg (\w+)"/.exec(segnaleLetto(st, dfAperte(ep, df), ora)) || [])[1] || "";
    if (!st && !c && !segno && !vit) return null;
    return { vit, esami: st ? inAttesa(st, ora).map((x) => ({ nome: x.nome, t: x.tempo, banda: x.banda })) : null, vecchio: !!st?.vecchio,
      titolo: st ? statoTitolo(st, ora) : "", segno, cuore: c ? { livello: c.livello, vecchio: c.vecchio, fuori: [`NEWS ${c.punti}`, ...c.fuori].join(" · ") } : null };
  }
  // I parametri vitali che il PC ha già in memoria, per il telefono: l'ora, il
  // NEWS2 e le righe (le ultime 6, dalla più recente) come testo già scritto,
  // ogni valore col suo livello se è fuori norma (3 punti = rosso, altrimenti
  // ambra). Niente di nuovo dal gestionale.
  const VIT_ORDINE = ["pas", "fc", "spo2", "fr", "t", "fio2", "acvpu", "gcs"];
  function vitPonte(vit) {
    if (!vit || !vit.p || !vit.ts) return null;
    const riga = (p) => {
      const testo = vitTesto(p), per = news2(p).per;
      return VIT_ORDINE.filter((k) => testo[k]).map((k) => ({ t: testo[k], f: per[k] ? (per[k] >= 3 ? "ros" : "amb") : "" }));
    };
    const storia = (Array.isArray(vit.storia) && vit.storia.length ? vit.storia : [{ ts: vit.ts, p: vit.p }]).filter((r) => r && r.ts && r.p).slice(0, 6);
    return { ts: vit.ts, news: news2(vit.p).punti, v: riga(vit.p), storia: storia.map((r) => ({ ts: r.ts, v: riga(r.p) })) };
  }
  // Quello che aspetta, per tipo (Lab · ECG · RX), col tempo del più vecchio e
  // la sua banda — com'è nella riga corta del tabellone (l'area).
  function inAttesa(st, ora = Date.now()) {
    return !st ? [] : TIPI_ESAME.flatMap(([t, nome]) => {
      const x = st.tipi[t];
      if (!x || !x.pendenti) return [];
      const min = x.attesa ? minDa(x.attesa, ora) : null;
      return [{ tipo: t, nome, tempo: min == null ? "" : attesaTesto(min), banda: min == null ? "" : attesaBanda(t, min) }];
    });
  }
  // Righe di testo al dialogo di stampa del browser, da una cornice invisibile
  // (come un referto senza stampa automatica): niente scheda nuova, la
  // stampante la sceglie il medico. `no`: il dialogo non si è aperto.
  function stampaTesto(titolo, righe, no = () => {}) {
    if (extPersa()) return;
    document.getElementById("psassist-stampa-testo")?.remove();
    const f = document.createElement("iframe");
    f.id = "psassist-stampa-testo";
    f.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;opacity:0;pointer-events:none";
    f.srcdoc = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(titolo)}</title><style>
      body{font:11pt/1.45 Arial,Helvetica,sans-serif;color:#000;margin:14mm} h1{font-size:13pt;margin:0 0 6pt}
      p{margin:0;padding:3pt 0;border-bottom:.5pt solid #bbb;break-inside:avoid}</style></head>
      <body><h1>${esc(titolo)}</h1>${righe.map((r) => `<p>${esc(r)}</p>`).join("")}</body></html>`;
    f.addEventListener("load", () => {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch { no(); }
      setTimeout(() => f.remove(), 120e3);
    }, { once: true });
    document.documentElement.appendChild(f);
  }
  // Gli esami di un paziente, per nome (il nome del catalogo, identico): le
  // ore delle richieste già tornate e la più vecchia ancora in attesa. Le
  // Richieste del pannello e, per il telefono, ponteUltimi.
  function ultimiDi(ep) {
    const st = ep ? statoEsami(statoDi(ep)) : null;
    const m = new Map();
    if (!st) return m;
    for (const e of st.esami) {
      const k = chiaveEsame(e.label), x = m.get(k) || { fatti: [], attesa: 0, inAttesa: false, fatto: false };
      if (e.fatto) { x.fatto = true; if (e.ts) x.fatti.push(e.ts); }
      else { x.inAttesa = true; if (e.ts && (!x.attesa || e.ts < x.attesa)) x.attesa = e.ts; }
      m.set(k, x);
    }
    m.vecchio = st.vecchio; m.letto = st.letto;
    return m;
  }
  // Con il catalogo, per il telefono: quello che le Richieste del pannello
  // scrivono accanto a ogni esame («✓ 11:40», «40′»), in dati — il telefono lo
  // scrive con le stesse parole, e i minuti contano lì. Per ogni paziente
  // dell'elenco (non gli episodi precedenti), per chiave del telefono («r:c»):
  // `f` le ore delle richieste tornate (le ultime tre), `ok` tornato, `w` in
  // attesa, `a` da quando, `r` da quando è rosso (la seconda soglia del suo
  // tipo); `v` la lettura vecchia, `l` quando è stata letta.
  function ponteUltimi(cat) {
    const chiavi = Object.keys(cat.nomi).map((x) => {
      const [r, c] = x.split(":");
      return { x, k: chiaveEsame(examLabel(r, c)), ros: (RADIO_SET.includes(r) ? ATTESA_IMG : ATTESA_LAB)[1] };
    });
    const out = {};
    for (const i of PANNELLO.pazModello().info.values()) {
      if (i.prec) continue;
      const m = ultimiDi(i.p.ep), e = {};
      for (const { x, k, ros } of chiavi) {
        const u = m.get(k);
        if (u) e[x] = { f: u.fatti.slice().sort((a, b) => a - b).slice(-3), ...(u.fatto ? { ok: 1 } : {}), ...(u.inAttesa ? { w: 1 } : {}), ...(u.attesa ? { a: u.attesa, r: u.attesa + ros * 60e3 } : {}) };
      }
      if (Object.keys(e).length) out[i.p.ep] = { ...(m.vecchio ? { v: 1 } : {}), ...(m.letto ? { l: m.letto } : {}), e };
    }
    return out;
  }
  // Quello che serve al telefono per ordinare: i quesiti (prima i tre
  // pacchetti, con quanti esami portano su questo computer), i profili e gli
  // esami della griglia, per laboratorio. Gli stessi filtri del pannello: un
  // esame che questo catalogo non ha non compare.
  function ponteCatalogo() {
    const cat = fullCatalog();
    const c = (r, k) => !!cat[r]?.items?.[k];
    const nomi = {}, rx = [];
    const chiave = (r, k) => { const x = `${r}:${k}`; nomi[x] = displayLabel(r, k); if (RADIO_SET.includes(r)) rx.push(x); return x; };
    const gruppi = [];
    const gruppo = (r) => {
      const nome = RES_SHORT[r] || r;
      let g = gruppi.find((x) => x.nome === nome);
      if (!g) gruppi.push(g = { nome, rx: RADIO_SET.includes(r), profili: [], esami: [] });
      return g;
    };
    for (const p of PRESETS) if (p.items.every(([r, k]) => c(r, k))) gruppo(p.items[0][0]).profili.push({ nome: p.name, esami: p.items.map(([r, k]) => chiave(r, k)) });
    for (const [r, k] of SINGLES) if (c(r, k)) gruppo(r).esami.push(chiave(r, k));
    const quesiti = [...PACCHETTI.map((p) => p.q), ...store.get("quesiti", QUESITI_DEFAULT).filter((q) => !ePacchettoFisso(q))].slice(0, 6);
    // (e i quesiti che hanno imparato il loro pacchetto: sul telefono sono chip come gli altri)
    const pacchetti = [...PACCHETTI, ...quesiti.map(pacchettoImparato).filter(Boolean)]
      .map((p) => ({ q: p.q, esami: p.items.filter(([r, k]) => c(r, k)).map(([r, k]) => chiave(r, k)) }));
    return { quesiti, pacchetti, gruppi, nomi, rx: [...new Set(rx)] };
  }
  // La tabella dei Valori, in dati: colonne (il prelievo più recente a
  // sinistra, l'ora se è di oggi, se no la data) e righe per sezione, coi
  // nomi e le unità del pannello. Un valore: [testo, fuori range ±1, parziale, %].
  function ponteTabella(st) {
    const col = st.date.map((d, i) => ({ ...d, i })).reverse();
    const righe = righeTabella(st.righe);
    const ambS = sigleAmbigue(righe);
    const inatteso = (r) => !siglaCurata(r.nome) || ambS.has(chiaveAmbigua(r));
    const d0 = new Date();
    const oggi = `${String(d0.getDate()).padStart(2, "0")}/${String(d0.getMonth() + 1).padStart(2, "0")}/${d0.getFullYear()}`;
    return {
      colonne: col.map((c) => ({ cima: c.ignota ? "?" : c.data === oggi ? c.ora || "oggi" : c.data.slice(0, 5), sotto: c.ignota ? "ora ignota" : c.data === oggi ? "" : c.ora || "",
        parziale: righe.some((r) => r.valori[c.i] && r.valori[c.i].v && r.valori[c.i].parziale) })),
      gruppi: raggruppaStorico(righe).map((g) => ({ nome: g.nome, righe: g.righe.map((r) => ({
        nome: inatteso(r) ? String(r.nome).replace(/\s+/g, " ").trim() : sigla(r.nome),
        um: unitaChiara((r.valori.find((v) => v && v.um) || {}).um || "", r.nome),
        valori: col.map((c) => { const v = r.valori[c.i]; return v && v.v ? [v.v, v.stato || 0, v.parziale ? 1 : 0, v.pct || ""] : null; }),
      })) })),
    };
  }
  // Gli esiti di un paziente: la tabella che il PC ha di lui (la sua scheda
  // clinica, scelta con la regola d'identità del pannello) e i referti della
  // sua pagina — letta una volta, solo lettura, e solo se è del suo episodio —
  // col testo di quelli già letti.
  async function ponteEsiti(p) {
    const url = ponteUrlPaziente(p);
    let referti = [], nota = "", pagina = null;
    const chi = { cf: "", nascita: "" };   // dal riquadro della sua pagina: di chi è un referto
    if (url) {
      try {
        const { doc, url: fin } = await fetchDoc(url, {});
        if (classify(doc) === "login") return { ok: false, errore: "Gestionale da riaprire: sul PC la sessione è scaduta", sessione: true };
        if (findEpisodeId(doc, fin) !== p.ep) return { ok: false, errore: "La pagina del paziente sul PC è di un altro episodio: non mostro niente" };
        const es = esitiModel(doc, fin);
        referti = es.filter((e) => e.kind === "referto");
        Object.assign(chi, { cf: cfInRiquadro(doc), nascita: nascitaInPagina(doc) });
        // il laboratorio della pagina, come lo guarda l'apertura sul PC (autoCarica): c'è, e la sua firma
        pagina = { lab: es.some((e) => !e.storico && (e.kind === "valori" || refertoTipo(e) === "lab")), aMeta: es.some((e) => e.kind === "valori" && !e.storico), firma: firmaLab(doc, fin) };
      } catch (e) { nota = `Referti non letti: ${e?.head || e?.message || e}`; }
    }
    let st = null;
    const testi = new Map();
    if (hasExt()) {
      const r = await ask({ t: "getStorico" });
      const indice = (r && r.ok && r.indice) || [];
      const mio = String(p.pk || "").startsWith("cf:") ? p.pk.slice(3) : "";
      const scelta = scegliScheda(indice, mio, p.name, p.ep);
      const leggi = async (chiave) => { const x = await ask({ t: "getStorico", chiave }); return x && x.ok ? x.dati : null; };
      if (scelta) st = await leggi(scelta.chiave);
      // I testi dei referti si cercano per numero di referto, quello della
      // pagina di QUESTO paziente: un referto letto prima che il codice
      // fiscale fosse noto sta nella scheda col suo nome.
      const perNome = "nome:" + normNome(p.name);
      const altra = perNome !== "nome:" && (!scelta || scelta.chiave !== perNome) && indice.some((v) => v.chiave === perNome) ? await leggi(perNome) : null;
      // Il testo salvato è già quello che il PC mostra («mostrato»): non si ritaglia, o il
      // telefono direbbe un'altra cosa. Solo un testo salvato prima del taglio, con
      // l'intestazione dentro, si taglia — una volta, qui.
      for (const s of [altra, st]) for (const x of (s && s.referti) || []) if (x && x.id && x.testo) {
        const rif = referti.find((e) => e.id === x.id);
        testi.set(x.id, rif && refertoTipo(rif) !== "ecg" && !x.mostrato ? refertoScrittoRx(String(x.testo).split("\n"), { nome: p.name || "" }).righe.join("\n") : x.testo);
      }
    }
    const dati = st && st.righe && st.righe.length ? normalizzaStorico(st) : null;
    const tabella = dati && dati.righe.length ? ponteTabella(dati) : null;
    let resta = 400000;   // il telefono riceve un messaggio solo, mai oltre 1 MB
    // Il PDF si offre al telefono solo se c'è la copia salvata per questo
    // episodio e si è guardato di chi è (`chi`, con la copia: vale da ogni
    // scheda) senza trovarla di un altro paziente — anche senza testo: TC,
    // visite. Mai guardata, o di un altro: niente PDF (e ponteCopia, nel
    // service worker, lo rifiuta lo stesso).
    const lr = hasExt() && referti.length ? (await ask({ t: "listRef", ep: p.ep, ids: referti.map((e) => e.id) }).catch(() => null)) || {} : {};
    const salvati = lr.cached || {}, guardati = { ...(lr.chi || {}) };
    const cfImp = String(p.pk || "").startsWith("cf:") ? p.pk.slice(3) : "";
    const altri = new Set();
    // («di un altro paziente»: in questa scheda, o in autoFalliti.v1 — lo stesso per tutte le schede)
    const diAltro = (e) => {
      const t = tabStore.get(`reftxt.${p.ep}.${e.id}`, null);
      return altri.has(e.id) || !!fallito(p.ep, e.id)?.altro
        || (!!t && (!!t.altro || (Array.isArray(t.righe) && identitaReferto(t.righe, { cf: "", cfImp, nome: p.name || "", nascita: "" }).esito === "altro")));
    };
    // Un PDF salvato su questo PC ma mai guardato: il PDF lo salva la scheda
    // del portale (il service worker), lo guarda la pagina che l'ha chiesto —
    // e se il medico è già passato a un'altra pagina, non lo guarda nessuno.
    // Lo si guarda qui, dalla copia (nessuna richiesta), con lo stesso
    // controllo di chi è del pannello; di un ECG o di una radiografia il testo
    // va nella scheda del paziente: la prossima volta è già lì.
    const chiave = p.pk || (normNome(p.name) ? "nome:" + normNome(p.name) : "");
    for (const e of referti) {
      const leggi = testoAuto(e) && !testi.has(e.id);
      if (!salvati[e.id] || diAltro(e) || guardati[e.id] === "vuoto" || (!leggi && guardati[e.id])) continue;
      const g = await ask({ t: "getRef", id: e.id, ep: p.ep }).catch(() => null);
      const buf = g && g.ok && g.data ? bufDaB64(g.data) : null, size = buf ? buf.byteLength : 0;
      const righe = buf ? ((await testoPdf(buf).catch(() => null)) || {}).righe || [] : [];
      if (!righe.length) {
        // senza testo: niente da confrontare. Fail-closed (al telefono niente PDF), e lo si ricorda sulla copia: non si rilegge a ogni «esiti»
        if (size && !guardati[e.id] && (await ask({ t: "chiRef", id: e.id, ep: p.ep, chi: "vuoto", size }).catch(() => null))?.ok) guardati[e.id] = "vuoto";
        continue;
      }
      const esito = identitaReferto(righe, { cf: chi.cf, cfImp, nome: p.name || "", nascita: chi.nascita }).esito;
      if (esito === "altro") {
        altri.add(e.id);
        segnaFallito(p.ep, e.id, { altro: true });
        await ask({ t: "delRef", id: e.id, ep: p.ep }).catch(() => {});
        continue;
      }
      if (!guardati[e.id]) {
        const v = esito === "ok" ? "ok" : "nv";
        if ((await ask({ t: "chiRef", id: e.id, ep: p.ep, chi: v, size }).catch(() => null))?.ok) guardati[e.id] = v;
      }
      if (!leggi) continue;
      const mostra = refertoMostrato(e, righe, { nome: p.name || "" });
      if (!mostra.length) continue;
      const testo = mostra.slice(0, 200).join("\n").slice(0, 20000);
      testi.set(e.id, testo);
      if (chiave) {
        await mettiInScheda(chiave, null, (vecchio) => {
          const base = vecchio || { paziente: { idMPI: "", cognome: "", nome: p.name || "" }, cf: cfImp, periodo: "", date: [], righe: [], scartate: [], letto: Date.now() };
          const ref = [{ id: e.id, quando: e.when || "", titolo: shortLabel(e.label || ""), sistema: e.sistema || "", testo, mostrato: true }, ...(base.referti || []).filter((r) => r.id !== e.id)];
          return { ...base, referti: ref.slice(0, 40) };   // (l'ora dei valori resta la loro)
        }).catch(() => {});
      }
    }
    const visti = refertiVisti(p.ep);
    const lista = referti.filter((e) => refertoTipo(e) !== "lab" || !tabella).map((e) => {
      const t = testi.get(e.id) || "";
      const sta = !!t && t.length <= resta;
      if (sta) resta -= t.length;
      return { id: e.id, quando: e.when, sistema: e.sistema, titolo: shortLabel(e.label), tipo: refertoTipo(e), testo: sta ? t : "", lungo: !!t && !sta,
        ...(visti.has(e.id) ? {} : { nuovo: true }), ...(salvati[e.id] && (guardati[e.id] === "ok" || guardati[e.id] === "nv") && !diAltro(e) ? { pdf: true } : {}),
        ...(salvati[e.id] && guardati[e.id] === "vuoto" && !diAltro(e) ? { senzaTesto: true } : {}),
        ...(refertoTipo(e) !== "lab" && !testoAuto(e) ? { soloPdf: true } : {}) };   // (TC, ecografie, visite: il testo non si legge, c'è il PDF)
    });
    // Che cosa il PC legge da sé, adesso che il medico l'ha aperto sul telefono (il suo tocco è il gesto):
    // «apri» — in questo turno il PC non l'ha ancora aperto: la sua pagina dietro, come un clic sulla lista
    // (chi è, le allergie, la cartella, i valori, i referti); «nuovi» — come aprendo gli Esiti sul PC
    // (autoCarica): la firma del laboratorio della pagina non è quella già letta (mai letto, o cambiata),
    // o un laboratorio a metà non si ricontrolla da 10 minuti; o un referto non è ancora salvato. Lo chiede
    // il telefono, con «aggiornaValori»; quello che da solo non è riuscito si riprova più tardi (riprovaDaSolo).
    // (un episodio precedente si guarda e basta: niente si legge da sé)
    const riga = pontePazienti().find((x) => x.ep === p.ep) || null;   // (le allergie, lo stato: dopo una lettura sono nuovi)
    let leggi = "";
    if (pagina && !riga?.prec) {
      const prima = (store.get(AUTO_CARICA, {}) || {})[p.ep] || {};
      const lab = pagina.lab && (pagina.firma !== prima.lab || (pagina.aMeta && Date.now() - (prima.parz || 0) >= PARZ_MS)) && riprovaDaSolo(p.ep, "lab", pagina.firma);
      const ref = referti.some((e) => refertoTipo(e) !== "lab" && !salvati[e.id] && riprovaDaSolo(p.ep, e.id));
      leggi = !apertoNelTurno(p) ? "apri" : lab || ref ? "nuovi" : "";
    }
    // quando il PC li ha letti: sul telefono si vede quanto sono vecchi
    // (`mai`: il PC non ha la sua pagina — lo conosce solo dalla lista smart: niente di salvato, niente da leggere)
    // (come sul PC: i valori nuovi dall'ultima volta che il medico li ha guardati, e i referti non ancora aperti;
    // `nuovo`: il pallino del tabellone — qualcosa è tornato da quando qualcuno ha guardato i suoi Esiti)
    const nuoviVal = tabella ? Number(statoDi(p.ep)?.valori?.nuovi) || 0 : 0;
    return { ok: true, dati: { ep: p.ep, paziente: p.name, tabella, letto: tabella ? Number(st.letto) || 0 : 0, referti: lista, nota, ...(nuoviVal ? { valoriNuovi: nuoviVal } : {}),
      ...(url ? {} : { mai: true, smart: ponteSmart(p) }), ...(pagina ? { lab: pagina.lab } : {}), ...(leggi ? { leggi } : {}), ...(leggi && motoreOvunque() ? { dopoOrdine: true } : {}),
      ...(statoEsami(statoDi(p.ep))?.nuovo ? { nuovo: true } : {}), ...(riga ? { riga } : {}) }, registro: `esiti di ${p.name}` };
  }
  // L'ordine: lo stesso giro di «Conferma e stampa», dato alla scheda di
  // sottofondo dalla pagina del paziente — tutti i controlli di sempre. Il
  // laboratorio e la radiologia si confermano da soli, due ordini in fila,
  // come dal pannello. Il numero dell'ordine
  // lo dà il service worker: chiesto due volte, l'ordine è uno.
  async function ponteOrdina(p, a) {
    const url = ponteUrlPaziente(p);
    if (!url) return nonQui(p);
    const quesito = String(a.quesito || "").replace(/\s+/g, " ").trim();
    if (!quesito) return { ok: false, errore: "Scrivi il quesito diagnostico" };
    const cat = fullCatalog();
    const items = [];
    for (const k of new Set(a.esami || [])) {
      const [res, code] = k.split(":");
      if (!cat[res]?.items?.[code]) return { ok: false, errore: `Un esame non è nel catalogo di questo PC: niente inviato` };
      items.push({ res, code, label: examLabel(res, code), display: displayLabel(res, code), chiave: k });
    }
    if (!items.length) return { ok: false, errore: "Scegli almeno un esame" };
    // un ordine per erogatore di laboratorio (come dal pannello), poi la radiologia
    const lab = items.filter((i) => !RADIO_SET.includes(i.res)), radio = items.filter((i) => RADIO_SET.includes(i.res));
    const gambe = [...(lab.length ? gambeLab(lab, "", {}).map((g) => [g.kind, g.items, g.label]) : []), ...(radio.length ? [["radio", radio, "radiologia"]] : [])];
    const ordini = [];
    let nLab = 0;
    for (const [g, [kind, l]] of gambe.entries()) {
      // (gli ordini dello stesso tocco: …l, …l2, …l3 per il laboratorio, …r per la radiologia)
      const id = `${a.id}${kind === "radio" ? "r" : ++nLab > 1 ? `l${nLab}` : "l"}`, autoConfirm = true;
      const job = { id, ep: p.ep, paziente: p.name, n: l.length, autoConfirm, url, rid: null, gesto: a.id, nomi: l.map((i) => i.display), ...(a.dest ? { dest: a.dest } : {}),
        piano: { startPage: "patient", items: l, quesito, quesitoMio: !!a.mio, autoConfirm, episodeId: p.ep, patientName: p.name, patientUrl: url, kind } };
      let r = { ok: false };
      for (let k = 0; k < 3 && !r.ok && !r.no; k++) r = await ask({ t: "ordineNuovo", job });
      if (!r.ok) {
        const perche = r.no ? r.why || "rifiutato" : "PS Assist non ha risposto: guarda il carrello prima di rifarlo";
        // (senza risposta non si sa se è partito: «Da controllare» sul telefono, come sul PC — mai «niente inviato»)
        if (!ordini.length) return { ok: false, ...(r.no ? {} : { incerto: true }), errore: r.no ? `Ordine non partito: ${perche}` : `Non so se l'ordine è partito: ${perche}` };
        // (una gamba dopo la prima senza risposta: anche lei può essere partita — da controllare; quelle dopo, non mandate)
        const dubbio = r.no ? "" : gambe[g][2], fuori = gambe.slice(r.no ? g : g + 1).map(([, , nome]) => nome).join(", ");
        const avviso = [dubbio ? `Da controllare: ${dubbio} (${perche})` : "", fuori ? `Non partiti: ${fuori}${dubbio ? "" : ` (${perche})`}` : ""].filter(Boolean).join(" · ");
        return { ok: true, dati: { ordini, avviso }, registro: `ordine per ${p.name}: ${[dubbio ? `da controllare ${dubbio}` : "", fuori ? `non partiti ${fuori}` : ""].filter(Boolean).join(", ")}` };
      }
      ordini.push({ id, ep: p.ep, paziente: p.name, n: l.length, rx: kind === "radio" });
    }
    rememberQuesito(quesito);
    if (!a.mio) imparaPacchetto(quesito, items);   // (un chip del telefono impara come quello del PC)
    const n = items.length;
    return { ok: true, dati: { ordini }, registro: `ordine di ${n} ${n === 1 ? "esame" : "esami"} per ${p.name} (${items.map((i) => i.display).join(", ")})` };
  }
  // «Richieste fatte» (Richieste, sul telefono) e «Ristampa»: le richieste che
  // la pagina del paziente sa stampare — anche quelle che non ha fatto
  // l'estensione —, lette dalla sua pagina com'è adesso (solo lettura, il suo
  // indirizzo, la regola d'identità degli esiti). I link dei fogli sono quelli
  // della pagina, mai costruiti. Si stampa soltanto: niente Conferma, niente
  // Registra.
  async function ponteMappaStampe(p) {
    const url = ponteUrlPaziente(p);
    if (!url) return { errore: senzaPagina(p) };
    try {
      const { doc, url: fin } = await fetchDoc(url, {});
      if (classify(doc) === "login") return { errore: "Gestionale da riaprire: sul PC la sessione è scaduta", sessione: true };
      if (findEpisodeId(doc, fin) !== p.ep) return { errore: "La pagina del paziente sul PC è di un altro episodio: niente stampato" };
      return { map: printModel(doc, fin), url };
    } catch (e) { return { errore: `Richieste non lette: ${e?.head || e?.message || e}` }; }
  }
  async function ponteRistampe(p) {
    const { map, errore, sessione } = await ponteMappaStampe(p);
    if (!map) return { ok: false, errore, ...(sessione ? { sessione } : {}) };
    return { ok: true, dati: { ep: p.ep, richieste: richiesteStampabili(map).slice(0, 12).map((id) => {
      const m = printMeta(map, id);
      const j = printJobsFor(map, id), et = j.filter((x) => x.printer === "etichettatrice").length;   // (quante etichette e quanti fogli: il telefono offre la scelta)
      return { id, quando: m.when || "", esami: m.exams.slice(0, 8).join(", "), cosa: printLabelFor(map, id), et, fo: j.length - et };
    }) } };
  }
  // Le etichette e il foglio di una richiesta, di nuovo, dove dice `dest`: lo
  // stesso giro di quelli di un ordine (ordineFogli: il giornale delle stampe,
  // «Infermeria non risponde», un foglio una volta sola). Il numero (`id`) lo
  // fa il telefono: la stessa ristampa rimandata è la stessa.
  async function ponteRistampa(p, a) {
    const { map, url, errore, sessione } = await ponteMappaStampe(p);
    if (!map) return { ok: false, errore, ...(sessione ? { sessione } : {}) };
    const rid = String(a.rid || ""), tutti = map[rid] ? printJobsFor(map, rid) : [];
    if (!tutti.length) return { ok: false, errore: "Questa richiesta non è più sulla pagina del paziente: riapri l'elenco" };
    // «🏷️ Etichette · 📄 Foglio · Entrambi»: le etichette sono i lavori dell'etichettatrice, il foglio tutto il resto
    const quali = a.quali === "etichette" || a.quali === "foglio" ? a.quali : "tutto";
    const jobs = quali === "tutto" ? tutti : tutti.filter((j) => (j.printer === "etichettatrice") === (quali === "etichette"));
    if (!jobs.length) return { ok: false, errore: `Questa richiesta non ha ${quali === "etichette" ? "etichette" : "foglio"} da ristampare` };
    const job = { id: a.id, ep: p.ep, tag: "Stampa", paziente: p.name, url, fine: null, dest: a.dest === "stazione" ? "stazione" : "qui",
      riassunto: `Ristampa ${quali === "tutto" ? "" : quali + " "}${printMeta(map, rid).when || "richiesta"}`.slice(0, 80), quesito: "",
      jobs: jobs.map(({ name, printer, url, breve }) => ({ name, printer, url, ...(breve ? { breve } : {}) })) };
    let r = { ok: false };
    for (let k = 0; k < 3 && !r.ok && !r.no; k++) r = await ask({ t: "ordineFogli", job });
    if (r.no) return { ok: false, errore: r.aggiorna ? "Ristampa non partita: PS Assist si sta aggiornando, riprova fra un minuto" : "Ristampa non partita: la stampa automatica non è impostata sul PC" };
    if (!r.ok) return { ok: false, incerto: true, errore: "Non so se la stampa è partita: guarda la stampante prima di rifarla" };
    return { ok: true, dati: { ordini: [{ id: r.id || a.id, ep: p.ep, paziente: p.name, n: jobs.length }] }, registro: "ristampa di una richiesta di " + p.name };
  }
  // Un comando del telefono, eseguito qui. `no`: questa scheda non può (il
  // service worker prova la prossima).
  async function ponteEsegui(m) {
    if (classify(document) === "login") return { no: "login" };
    if (LAVORO || PONTE_VALORI || PONTE_CARTELLA || PONTE_TERAPIA || PONTE_ACCETTA || PONTE_LISTA) return { no: "lavoro" };
    if (!PANNELLO) return { no: "pannello" };
    const a = m.args || {}, cmd = m.cmd;
    // Secondo muro della build mini (il primo è nel service worker): qui, nella
    // scheda, solo le letture e la ristampa. Una scrittura che per qualunque
    // ragione arrivasse fin qui non tocca il gestionale.
    if (SOLA_LETTURA && !PONTE_LETTURA_SCHEDA.has(cmd)) return { ok: false, errore: "Questo PC è in sola lettura", solaLettura: true };
    const fatto = (r) => {
      if (r && r.registro) PANNELLO.log(`${now()}  iPhone · ${r.registro}`);
      if (r && r.ok && ["nota", "promemoria", "fatto", "dfAggiungi", "dfSpunta", "dfTogli"].includes(cmd) && !PANNELLO.root.activeElement) PANNELLO.render();
      return r;
    };
    if (cmd === "pazienti") return fatto({ ok: true, dati: pontePazienti(), registro: "elenco dei pazienti" });
    if (cmd === "mappa") return { ok: true, dati: ponteMappe() };
    if (cmd === "eo") return { ok: true, dati: ponteEo() };
    // l'app aperta (o tornata davanti) sull'iPhone: la smart si rilegge dietro, e lo si dice al telefono, che richiede fra poco
    if (cmd === "triage") {
      const r = a.rileggi ? await smartSync(false).catch(() => null) : null;
      const t = store.get(TRIAGE_LISTA, null);
      // (con la chiave di ognuno: sulla mappa i posti dicono solo quella)
      return { ok: true, dati: { ts: t?.ts || 0, righe: Array.isArray(t?.righe) ? t.righe.map((x) => ({ ...x, k: chiaveTriage(x) })) : [], rilegge: !!(r && r.ok) } };
    }
    if (cmd === "richieste") { const c = ponteCatalogo(); return fatto({ ok: true, dati: { ...c, ultimi: ponteUltimi(c) }, registro: "catalogo degli esami" }); }
    // chi è al Triage, portato sulla mappa dal telefono: lo stesso gesto del PC (non è fra i pazienti)
    if (cmd === "posto" && /^tr[0-9a-z]{1,10}$/.test(String(a.ep || "")) && !pontePaziente(a.ep)) {
      const o = triageOspiti(PANNELLO.pazModello().pazienti).find((r) => r.k === a.ep);
      if (!o) return { ok: false, errore: "Non è più al triage, sul PC" };
      if (!/^(tray|(letto|area):[\w.-]{1,40})(@\w{1,8})?$/.test(String(a.dove || ""))) return { ok: false, errore: "Posto non valido" };
      PANNELLO.stanzaSposta(a.ep, a.dove);
      return fatto({ ok: true, dati: ponteMappe(), registro: `posto di ${o.breve || o.nome} (al triage)` });
    }
    // «Accetta in ambulatorio»: qui solo chi è e la lista del triage da aprire; il resto la scheda di sottofondo
    if (cmd === "accetta") return ponteAccetta(a);
    // un pin toccato sul telefono: il PC lo conosce adesso? (le sue liste; mai una ricerca nel gestionale)
    if (cmd === "pinApri") return { ok: true, dati: { ep: pinNoto({ ...(a.chi || {}), ep: a.ep || "" })?.ep || "" } };
    const p = a.ep ? pontePaziente(a.ep) : null;
    if (!p) return { ok: false, errore: "Questo paziente non è più nell'elenco del PC" };
    // «📌» sul telefono: chi è (il pin lo scrive il service worker, cifrato; nel registro solo «pin aggiunto»)
    if (cmd === "pinDati") return { ok: true, dati: pinDati(p) };
    // dimesso sul PC (archiviato): dal telefono non si tocca più
    if (p.arch) return { ok: false, errore: "Dimesso sul PC: niente inviato", dimesso: true };
    // noto solo dalla lista smart: chi è e il link della lista della sua area, per la scheda dietro (una lettura);
    // e «Passa il PC all'area …», il gesto del medico dal telefono (qui, nella sua scheda davanti)
    if (cmd === "listaChi") return ponteListaChi(p);
    if (cmd === "areaApri") return fatto(ponteAreaApri(p, a));
    // un episodio precedente si legge, ma non si ordina e non si promemora
    if (["ordina", "promemoria", "cartellaSalva", "terapiaAggiungi"].includes(cmd) && PANNELLO.pazModello().info.get(p.ep)?.prec) {
      return { ok: false, errore: `Episodio precedente: ${{ ordina: "per ordinare", cartellaSalva: "per scrivere in cartella", terapiaAggiungi: "per prescrivere" }[cmd] || "per un Da fare con l'ora"} apri quello di oggi` };
    }
    // la pagina Terapia: qui i controlli del paziente, il suo indirizzo (e,
    // per leggere, i preferiti); il resto lo fa la scheda di sottofondo
    if (cmd === "terapie" || cmd === "terapiaCerca" || cmd === "terapiaAggiungi") {
      const url = ponteUrlPaziente(p);
      if (!url) return nonQui(p);
      const pref = cmd === "terapie" ? { pref: terapiaPreferiti().slice(0, 30).map(({ n, ts, ...v }) => v) } : {};
      return fatto({ ok: true, dati: { url, paziente: p.name, ...pref }, ...(cmd === "terapiaAggiungi" ? {} : { registro: `${cmd === "terapie" ? "terapie" : "tendina dei farmaci"} di ${p.name}` }) });
    }
    if (cmd === "cartella") return fatto(await ponteCartella(p, a));
    // salvare: qui solo i controlli del paziente e il suo indirizzo; il resto
    // lo fa la scheda di sottofondo, col «Conferma» della pagina
    if (cmd === "cartellaSalva") {
      const url = ponteUrlPaziente(p);
      if (!url) return nonQui(p);
      const nomi = (Array.isArray(a.nomi) ? a.nomi : []).map(cartellaNome).join(", ");
      return fatto({ ok: true, dati: { url, paziente: p.name }, registro: `cartella di ${p.name}: salvo ${nomi}` });
    }
    const riga = () => pontePazienti().find((x) => x.ep === p.ep) || null;
    if (cmd === "esiti") return fatto(await ponteEsiti(p));
    // Visto sul telefono: un referto aperto (non più «nuovo», come aprendolo qui: segnaVisti), o gli
    // Esiti coi valori nuovi guardati (come la finestra aperta sugli Esiti: il pallino del tabellone e
    // «N nuovi» si spengono; i valori che le schede avevano già letti quando la tabella mostrata sul
    // telefono è stata scritta — `fino`, l'ora della sua lettura — contano visti: novita()).
    // Solo la memoria dell'estensione: niente nel gestionale.
    if (cmd === "visto") {
      const ids = Array.isArray(a.ids) ? a.ids : [];
      if (ids.length) segnaVisti(p.ep, ids);
      if (a.valori) {
        const ora = Date.now(), fino = Math.min(ora, Number(a.fino) || 0);
        // (una tabella letta sul PC dopo quella che il telefono ha mostrato: i suoi valori nuovi non li ha visti nessuno)
        let dopo = false;
        if (fino && hasExt()) {
          const r = await ask({ t: "getStorico" });
          const sc = scegliScheda((r && r.ok && r.indice) || [], String(p.pk || "").startsWith("cf:") ? p.pk.slice(3) : "", p.name, p.ep);
          dopo = !!sc && (Number(sc.letto) || 0) > fino;
        }
        // (l'ora dei visti non torna mai indietro: una tabella più vecchia di quanto il PC ha già visto non riaccende i «nuovi»)
        scriviStato(p.ep, (s) => ({ ...s, ...(dopo ? {} : { valori: { nuovi: 0, fuori: 0, fuoriTot: 0 } }), esitiVisto: Math.max(s.esitiVisto || 0, fino || ora), ...(fino > (s.valoriVisti || 0) ? { valoriVisti: fino } : {}) }));
      }
      if (!PANNELLO.root.activeElement) PANNELLO.render();
      return fatto({ ok: true, registro: `visti sul telefono: ${[ids.length ? (ids.length === 1 ? "un referto" : `${ids.length} referti`) : "", a.valori ? "gli esiti" : ""].filter(Boolean).join(" e ") || "niente"} di ${p.name}` });
    }
    if (cmd === "aggiornaValori") {
      const url = ponteUrlPaziente(p);
      if (!url) return nonQui(p);
      return fatto({ ok: true, dati: { url, paziente: p.name }, registro: `aggiorna i valori di ${p.name}` });
    }
    // La nota del telefono è la prima voce aperta senza ora di «Da fare»:
    // scritta, cambia quella (o, se non c'è, ne fa una in cima: il post-it);
    // vuota, la toglie. Mai un'ora letta dentro: una nota resta una nota.
    if (cmd === "nota") {
      const testo = String(a.testo || "").replace(/\s*\n+\s*/g, " · ").replace(/\s+/g, " ").trim().slice(0, 500);
      const n = dfNota(p.ep);
      const ok = n ? (testo ? dfCambia(p.ep, n.id, testo) : dfTogli(p.ep, n.id)) : !testo || !!dfAggiungi(p.ep, testo, { t: null, inCima: true, max: 500 });
      if (!ok) return { ok: false, errore: n || dfAperte(p.ep).length < PROM_MAX ? "Da fare non salvato: la memoria del browser del PC è piena o bloccata" : `Già ${PROM_MAX} cose da fare per questo paziente` };
      return fatto({ ok: true, dati: riga(), registro: `nota di ${p.name}` });
    }
    if (cmd === "promemoria") {
      const x = leggiPromemoria(a.testo, Date.now());
      if (!x) return { ok: false, errore: "Scrivi anche l'ora: «11:30 tropo», «tra 2h ECG»" };
      if (dfAperte(p.ep).length >= PROM_MAX) return { ok: false, errore: `Già ${PROM_MAX} cose da fare per questo paziente` };
      if (!promAggiungi(p.ep, x)) return { ok: false, errore: "Da fare non salvato: la memoria del browser del PC è piena o bloccata" };
      return fatto({ ok: true, dati: riga(), registro: `promemoria per ${p.name}: ${promRiga(x, Date.now())}` });
    }
    if (cmd === "fatto") {
      const via = promTogli(p.ep, String(a.pid || ""));
      if (!via) return { ok: false, errore: "Da fare non trovato: forse è già fatto", dati: riga() };
      return fatto({ ok: true, dati: riga(), registro: `promemoria fatto per ${p.name}: ${via.testo}` });
    }
    // Da fare: la stessa lista del PC. Una voce con l'ora dentro è un promemoria, se no una cosa da fare.
    if (cmd === "dfAggiungi") {
      if (p.arch || PANNELLO.pazModello().info.get(p.ep)?.prec) return { ok: false, errore: "Episodio precedente: per un Da fare apri quello di oggi" };
      if (!dfAggiungi(p.ep, a.testo)) return { ok: false, errore: dfAperte(p.ep).length >= PROM_MAX ? `Già ${PROM_MAX} cose da fare per questo paziente` : "Da fare non salvato: scrivi qualcosa, o la memoria del browser del PC è piena" };
      return fatto({ ok: true, dati: riga(), registro: `Da fare per ${p.name}: nuova voce` });
    }
    if (cmd === "dfSpunta") {
      if (!dfSpunta(p.ep, String(a.pid || ""), a.si !== false)) return { ok: false, errore: "Da fare non trovato: forse se n'è già andato", dati: riga() };
      return fatto({ ok: true, dati: riga(), registro: `Da fare di ${p.name}: ${a.si === false ? "di nuovo da fare" : "fatto"}` });
    }
    if (cmd === "dfTogli") {
      dfTogli(p.ep, String(a.pid || ""));
      return fatto({ ok: true, dati: riga(), registro: `Da fare di ${p.name}: cancellato` });
    }
    // La mappa: lo stesso gesto del trascinamento sul PC (un posto per paziente, un letto uno solo, le aree molti)
    if (cmd === "posto") {
      if (!/^(tray|(letto|area):[\w.-]{1,40})(@\w{1,8})?$/.test(String(a.dove || ""))) return { ok: false, errore: "Posto non valido" };
      PANNELLO.stanzaSposta(p.ep, a.dove);
      return fatto({ ok: true, dati: ponteMappe(), registro: `posto di ${p.name}` });
    }
    if (cmd === "ordina") return fatto(await ponteOrdina(p, a));
    if (cmd === "ristampe") return ponteRistampe(p);
    if (cmd === "ristampa") return fatto(await ponteRistampa(p, a));
    return { ok: false, errore: "Comando sconosciuto" };
  }
  // In ogni scheda del gestionale: i comandi, e lo stato per l'intestazione.
  // Finché un iPhone è associato le schede tengono sveglio il service worker
  // (se Chrome l'ha fermato, la presa si riapre).
  function ponteAscolta() {
    if (!hasExt() || ponteAscolta.fatto) return;
    ponteAscolta.fatto = true;
    try {
      chrome.runtime.onMessage.addListener((m, _s, reply) => {
        if (!m) return;
        // prima di salvare dal telefono: un testo non salvato, qui, in quei campi?
        if (m.t === "ponteCartellaSporca") { reply({ sporchi: cartellaSporca(m.ep, m.nomi) }); return; }
        // prima di una terapia dal telefono: la Terapia di quel paziente è del medico, qui?
        if (m.t === "ponteTerapiaSporca") { reply({ sporca: terapiaSporca(m.ep) }); return; }
        // confermata dal telefono: una pagina delle terapie di quel paziente aperta qui è di prima (non si ricarica da sola)
        if (m.t === "ponteTerapiaAggiornata") {
          if (!LAVORO && !PONTE_TERAPIA && typeof m.ep === "string" && eTerapie() && param(location.href, "EPISODIO_ID") === m.ep && formTerapia()) {
            const a = linkTerapia(m.ep);
            terapiaDice("warn", `confermata dall'iPhone: «${normTer(m.descr).slice(0, 120)}». Questa pagina è di prima: riaprila prima di premere Conferma.`,
              a ? { testo: "Riapri", fai: () => a.click() } : null);
          }
          reply({ ok: true });
          return;
        }
        // salvato dal telefono, e questa è la sua pagina: è di prima, e il suo «Conferma» rimanderebbe i testi
        // vecchi sopra quelli del telefono. Da subito il «Conferma» è fermo (confermaFerma); pulita, la pagina si
        // ricarica da sola (una GET); con qualcosa scritto qui intanto, no — si perderebbe —: la pill
        // «Aggiornato dal telefono · Ricarica», e il «Conferma» resta fermo finché non la si ricarica
        if (m.t === "ponteCartellaAggiornata") {
          if (!LAVORO && !PONTE_VALORI && !PONTE_CARTELLA && !PONTE_TERAPIA && !PONTE_ACCETTA && PANNELLO && typeof m.ep === "string" && formCartella(document, m.ep)) {
            PONTE_AGG = m.ep;
            if (paginaToccata()) pontePill();
            else ponteRicarica();
          }
          reply({ ok: true });
          return;
        }
        // la scheda della Terapia tenuta per il telefono (ferma sulla pagina Terapia di quel paziente): il lavoro nuovo, qui
        if (m.t === "ponteTerapiaLavoro") {
          const ok = !!PONTE_TERAPIA && !!m.lavoro && m.lavoro.ep === PONTE_TERAPIA.ep && PONTE_TERAPIA.fase === "fermo" && eTerapie();
          reply({ ok });
          if (ok) { PONTE_TERAPIA = m.lavoro; ponteTerapiaQui().catch(() => ask({ t: "ponteTerapiaFatto", ok: false, incerto: PONTE_TERAPIA.fase === "inviato", testo: "errore nella scheda" })); }
          return;
        }
        // …in cui il medico è entrato: da adesso è sua — una pagina come le altre, la pill e i suoi controlli (una
        // riga scritta qui ferma il telefono), così com'è: niente ricaricato, niente di quello che c'è scritto perso
        if (m.t === "ponteTerapiaLasciata") {
          reply({ ok: true });
          if (PONTE_TERAPIA && PONTE_TERAPIA.fase === "fermo") {
            PONTE_TERAPIA = null;
            ask({ t: "ordineChi" }).then((r) => bootGestionale(r && r.ok ? r : null));
          }
          return;
        }
        if (m.t !== "ponteEsegui") return;
        ponteEsegui(m).then(reply, (e) => reply({ ok: false, errore: `Errore sul PC: ${e?.head || e?.message || e}` }));
        return true;
      });
      const segui = (s, primo = false) => {
        const prima = !!(PONTE_STATO && PONTE_STATO.sessione);
        const avvisoPrima = PONTE_STATO && PONTE_STATO.avviso ? PONTE_STATO.avviso.ts : 0;
        PONTE_STATO = s || null;
        // (3.87) un avviso del ponte (un altro iPhone, un altro utente, una stazione da confermare): nel Registro, una volta
        const av = PONTE_STATO && PONTE_STATO.avviso;
        if (!primo && av && av.ts !== avvisoPrima && PANNELLO && typeof av.testo === "string") PANNELLO.log(`${now()}  iPhone · ${av.testo}`);
        if ((prima !== !!(PONTE_STATO && PONTE_STATO.sessione) || (av ? av.ts : 0) !== avvisoPrima) && PANNELLO && !PANNELLO.root.activeElement) PANNELLO.render();
      };
      chrome.storage.session.get("ponte").then((o) => segui(o.ponte, true)).catch(() => {});
      chrome.storage.onChanged.addListener((ch, area) => { if (area === "session" && ch.ponte) segui(ch.ponte.newValue); });
      window.addEventListener("click", confermaFerma, true);
      window.addEventListener("submit", confermaFerma, true);
      // La pagina che si apre lo dice una volta (e se è quella d'accesso): il PC sta sul ponte finché il
      // gestionale è aperto, e la presa sta nel documento fuori schermo, sveglia anche mentre il service
      // worker dorme. Ogni 30 secondi solo nel ripiego (un Chrome senza documento fuori schermo: `sveglia`).
      ask({ t: "ponteSveglia", login: classify(document) === "login" });
      setInterval(() => { if (PONTE_STATO && PONTE_STATO.accoppiato && PONTE_STATO.sveglia) ask({ t: "ponteSveglia" }); }, 30e3);
      // chi è entrato nel gestionale (la testata): l'associazione col telefono lo ricorda (3.87, il cambio turno)
      reportOperatore();
    } catch { /* niente estensione */ }
  }
