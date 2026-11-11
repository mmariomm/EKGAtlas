/*
 * Il gestionale come l'hanno mostrato le registrazioni vere (ottobre–novembre
 * 2026, anonimizzate), sopra il simulatore di sempre. `sa4pso-mock.mjs` non si
 * tocca: qui si avvolge il suo `createMock` e si aggiunge solo quello che il
 * server vero fa e il simulatore non sapeva.
 *
 *  (a) «Risorsa» + «Cerca» sul carrello: la pagina manda il suo modulo
 *      RisorsaFiltro (POST `ccsForm=RisorsaFiltro:Edit`, corpo esattamente
 *      `RISORSA_ID=<nuova>&s_PRESTAZIONE=`) e il server risponde 302 all'elenco
 *      con quella RISORSA_ID: da lì l'erogatore «corrente» di quella richiesta
 *      è quello. Dopo «Crea» è il primo delle RISORSE (il corpo di Crea porta
 *      la RISORSA_ID di partenza). Una semplice lettura dell'elenco con
 *      un'altra RISORSA_ID mostra quell'elenco, ma l'erogatore non cambia.
 *  (b) Un inserimento con una RISORSA_ID che non è l'erogatore corrente di
 *      quella richiesta, o in un secondo erogatore di una richiesta che ha già
 *      esami in un altro, non entra: il server risponde con l'elenco e
 *      «ORA-20965: AMB_RICHIESTA: Progressivo richiesta<rid>-1 già utilizzato»
 *      (le due tracce d'errore del motore 3.70.0: POC + laboratorio in UNA
 *      richiesta, l'errore al primo esame del secondo erogatore). Il medico,
 *      a mano, fa sempre una richiesta per erogatore.
 *  (c) Il foglio della radiologia si chiama «Stampa Richiesta Radiologia»
 *      sulla pagina del paziente vera (il simulatore: «Stampa Prenotazione Esterna»).
 *
 *  (d) opts.carrelloPerso: n (o [n1, n2, …]) — quello che le registrazioni vere
 *      della 3.71.1 e della 3.73.0 hanno mostrato su ordini di soli esami POC:
 *      a metà ordine la sessione perde il carrello della richiesta. L'n-esimo
 *      inserimento di una richiesta risponde con l'elenco e «ORA-20965 …
 *      Progressivo richiesta<rid>-1 già utilizzato», niente entra, e da lì il
 *      carrello di quella richiesta si rilegge vuoto; ogni altro inserimento
 *      lì dentro risponde lo stesso. Un numero per ogni volta che succede, a
 *      una richiesta dopo l'altra (n: una volta sola; [2, 2]: due richieste).
 *
 *  (e) opts.dopoConferma: ms — dopo la Conferma il server vero non torna
 *      dritto alla pagina del paziente (registrazioni della 3.77.1): risponde
 *      con la pagina delle etichette LIS (nessun link da stampare: le apre lei
 *      in una finestra), che va da sé su `MVPG=PsoEpisodio`, che va da sé sulla
 *      pagina del paziente. Ognuna resta `ms` millisecondi. Le pagine servite
 *      stanno in `state.passaggi`.
 *
 *  (f) Il carrello di una richiesta confermata non ha più il suo bottone
 *      Conferma: la richiesta non è più una bozza (le registrazioni della 3.85
 *      l'hanno visto al contrario: una Conferma che il gestionale non aveva
 *      preso lasciava l'esame in carrello col suo Conferma). Il simulatore lo
 *      mostrava sempre; qui no. (opts.confermaSempre: come il simulatore.)
 *
 * opts.prenotazioneEsterna: il foglio RX resta «Stampa Prenotazione Esterna».
 * opts.filtroStaccato: il modulo RisorsaFiltro com'è nella pagina salvata
 * (`esempi-gestionale/esami-centrale.html`): vuoto, coi controlli fuori — lì
 * `form.elements` non li ha, e il motore manda il corpo che manda la pagina.
 */
import { createMock as createMockBase, decodeFormBody } from "./sa4pso-mock.mjs";

export * from "./sa4pso-mock.mjs";

export const ORA_PROGRESSIVO = (rid) => `ORA-20965: AMB_RICHIESTA: Progressivo richiesta${rid}-1 già utilizzato`;

export function createMock(opts = {}) {
  const mock = createMockBase(opts);
  const base = mock.handle;
  const st = mock.state;
  // RICHIESTA_ID → l'erogatore su cui il server tiene quella richiesta (gli
  // identificativi come li vede il cliente, anche quelli di un'altra sede)
  const corrente = (st.erogatore = {});
  st.rifiutati = [];   // gli inserimenti respinti con l'ORA: {rid, code, res}
  // (d) le volte che la sessione perderà il carrello, e le richieste che l'hanno perso
  const perdite = [].concat(opts.carrelloPerso ?? []).map(Number).filter((n) => n > 0);
  st.perse = [];
  const inseriti = {};   // RICHIESTA_ID → quanti inserimenti ha ricevuto
  // l'elenco semplice di quella richiesta, su quella risorsa
  const elenco = (url, res) => {
    const l = new URL(url);
    for (const k of ["Insert", "Delete", "ccsForm", "PRESTAZIONE", "BRANCA", "toPG", "RICHIESTA_PRESTAZIONE_PROG"]) l.searchParams.delete(k);
    l.searchParams.set("MVPG", "RcsRichiestaPrestazioniRicercaErogatore");
    l.searchParams.set("RISORSA_ID", res);
    return l.href;
  };
  // la risorsa del simulatore per un identificativo del cliente: le RISORSE
  // di ogni indirizzo sono le stesse, nello stesso ordine
  const canonica = (rid, risorse, res) => {
    const a = st.allocated[rid], i = risorse.indexOf(res);
    return a && i >= 0 && a.risorse[i] ? a.risorse[i] : res;
  };
  // una pagina resa dal simulatore senza che conti come lettura di un elenco
  // (le righe «in ritardo» si consumano solo con gli elenchi veri)
  const senzaLag = (fn) => { const lag = { ...st.lagLeft }; try { return fn(); } finally { Object.assign(st.lagLeft, lag); } };
  const scaduta = () => st.requests.length > st.expireAfter;
  // la risposta del database a un inserimento: l'elenco, con l'errore, e niente aggiunto
  const rifiuta = (req, p, rid, code, res) => {
    st.requests.push({ method: req.method, url: req.url, params: Object.fromEntries(p.entries()) });
    st.insertCount[`${rid}:${code}`] = (st.insertCount[`${rid}:${code}`] || 0) + 1;
    st.rifiutati.push({ rid, code, res });
    const lista = senzaLag(() => base({ method: "GET", url: elenco(req.url, res) }));
    st.requests.pop();   // (non è una richiesta del cliente)
    const html = Buffer.from(lista.body).toString("latin1").replace(/<body>/i,
      `<body><table><tr><td class="AFCErrorDataTD">${ORA_PROGRESSIVO(rid)}</td></tr></table>`);
    return { ...lista, body: Buffer.from(html, "latin1") };
  };
  // (e) una pagina di passaggio: dell'episodio (nei suoi link), niente da stampare, e se ne va da sola
  st.passaggi = [];
  const passaggio = (nome, ep, dove) => {
    st.passaggi.push(nome);
    const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>${nome}</title></head><body>
      <a href="?MVPG=PsoEpisodioDiario&EPISODIO_ID=${ep}">Diario</a>
      <script>setTimeout(function () { location.href = ${JSON.stringify(dove)}; }, ${Number(opts.dopoConferma) || 0});</script></body></html>`;
    return { status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(html, "latin1") };
  };

  mock.handle = (req) => {
    let u;
    try { u = new URL(req.url); } catch { return base(req); }
    const p = u.searchParams, ccs = p.get("ccsForm") || "", mvpg = p.get("MVPG") || "";
    const risorse = (p.get("RISORSE") || "").split(",").filter(Boolean);

    // (e) dopo la Conferma: le etichette LIS, poi PsoEpisodio, poi il paziente
    if (opts.dopoConferma != null && req.method === "POST" && ccs.startsWith("Prestazioni")) {
      const out = base(req), rid = p.get("RICHIESTA_ID"), ep = p.get("EPISODIO_ID") || "";
      if (out.status >= 400 || !(st.richieste[rid] || {}).confirmed) return out;
      return passaggio("RcsStampaEtichetteLIS", ep, `?MVPG=PsoEpisodio&&RICHIESTA_ID=${rid}&STRUTTURA=1&EPISODIO_ID=${ep}`);
    }
    if (opts.dopoConferma != null && req.method === "GET" && mvpg === "PsoEpisodio") {
      const ep = p.get("EPISODIO_ID") || "";
      return passaggio("PsoEpisodio", ep, `?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${ep}`);
    }

    // (a) il modulo RisorsaFiltro del carrello
    if (req.method === "POST" && ccs.startsWith("RisorsaFiltro") && mvpg === "RcsRichiestaPrestazioniRicercaErogatore") {
      const out = senzaLag(() => base(req));   // (registrata fra le richieste, come ogni altra)
      if (scaduta()) return out;
      const f = req.bodyBuffer?.length ? decodeFormBody(req.bodyBuffer) : {};
      const rid = p.get("RICHIESTA_ID"), nuova = f.RISORSA_ID || "";
      if (!rid || !st.richieste[rid] || !risorse.includes(nuova)) return out;   // niente scelto: l'elenco di prima
      corrente[rid] = nuova;
      const dove = new URL(elenco(req.url, nuova));
      dove.searchParams.set("s_PRESTAZIONE", f.s_PRESTAZIONE || "");
      return { status: 302, headers: { location: dove.href }, body: Buffer.alloc(0) };
    }

    // Crea: la richiesta nasce sul primo erogatore delle RISORSE
    if (req.method === "POST" && ccs.startsWith("RICHIESTACrea")) {
      const out = base(req);
      const rid = (req.bodyBuffer?.length ? decodeFormBody(req.bodyBuffer) : {}).RICHIESTA_ID;
      if (rid && st.richieste[rid] && !(rid in corrente) && risorse.length) corrente[rid] = risorse[0];
      return out;
    }

    // (b) l'inserimento fuori dall'erogatore della richiesta
    if (p.get("Insert") === "Inserisci" && mvpg === "RcsRichiestaCarrelloAggiungi" && st.requests.length + 1 <= st.expireAfter) {
      const rid = p.get("RICHIESTA_ID"), res = p.get("RISORSA_ID"), code = p.get("PRESTAZIONE");
      const r = st.richieste[rid];
      const mia = canonica(rid, risorse, res);
      const altrove = !!r && [...r.cart.values()].some((x) => x !== mia);
      if (r && ((rid in corrente && corrente[rid] !== res) || altrove)) return rifiuta(req, p, rid, code, res);
      // (d) il carrello perso: l'n-esimo inserimento, e tutti quelli dopo nella stessa richiesta
      if (r && st.perse.includes(rid)) return rifiuta(req, p, rid, code, res);
      if (r) inseriti[rid] = (inseriti[rid] || 0) + 1;
      if (r && perdite.length && inseriti[rid] === perdite[0]) {
        perdite.shift();
        st.perse.push(rid);
        r.cart.clear();   // da qui l'elenco di quella richiesta si rilegge vuoto
        return rifiuta(req, p, rid, code, res);
      }
      return base(req);
    }

    const out = base(req);
    if (!/html/.test((out.headers || {})["content-type"] || "")) return out;
    let html = Buffer.from(out.body).toString("latin1");
    const prima = html;
    // (c) il foglio RX col suo nome vero (opts.prenotazioneEsterna: quello di una prenotazione esterna)
    if (!opts.prenotazioneEsterna) html = html.replace(/title="Stampa Prenotazione Esterna"/g, 'title="Stampa Richiesta Radiologia"');
    // (f) il carrello di una richiesta confermata: senza il suo bottone Conferma
    if (!opts.confermaSempre && mvpg === "RcsRichiestaPrestazioniRicercaErogatore" && (st.richieste[p.get("RICHIESTA_ID")] || {}).confirmed) {
      html = html.replace(/<input type="submit" name="Update1?" value="Conferma">/g, "");
    }
    // il modulo vuoto e i controlli fuori, come nella pagina salvata (solo il carrello)
    if (opts.filtroStaccato && /name="Prestazioni"/.test(html)) {
      html = html.replace(/(<form name="RisorsaFiltro"[^>]*>)([\s\S]*?)<\/form>/, (m, apre, dentro) => `${apre}</form><div>${dentro}</div>`);
    }
    return html === prima ? out : { ...out, body: Buffer.from(html, "latin1") };
  };
  return mock;
}
