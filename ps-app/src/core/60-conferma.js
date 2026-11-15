//@frammento 60-conferma.js — Richieste da confermare, le Conferme premute, provaConferma, confermaInCornice (la Conferma nativa
//@ in una cornice), riprendiCorsa, maybeAutoConfirm.
  // ------------------------------------------------ richieste da confermare
  // Una richiesta mandata e non ancora confermata non deve sparire dalla
  // memoria di nessuno. Col carrello finito — prima della conferma in
  // sottofondo, e alla fine di un giro in revisione — se ne annotano SOLO i
  // numeri — richiesta, episodio, indirizzo del carrello, ora, quanti esami:
  // mai un nome — e ogni pagina di quell'episodio guarda: se fra le richieste
  // con i fogli da stampare la sua non c'è ancora dopo 2 minuti, la pill lo
  // dice. Al server non si chiede niente per questo: si guarda la pagina che
  // il medico ha aperto. Vista confermata, la si dimentica; dopo 12 ore,
  // anche. Un giro che si ferma prima (un errore, ⏹, la scheda dell'ordine
  // ricaricata prima della Conferma) non lascia niente: «se non parte
  // l'ordine nel carrello, ignoralo» — la striscia rossa lo dice una volta.
  const DA_CONFERMARE = "daConfermare.v1";
  const DA_CONFERMARE_TTL = 12 * 3600e3;
  const attesaConferma = () => Number(store.get("attesaConferma.ms", 0)) || 120e3;   // i test la accorciano
  function daConfermare() {
    const l = store.get(DA_CONFERMARE, []);
    return (Array.isArray(l) ? l : []).filter((x) => x && x.rid && x.ep && Date.now() - (x.ts || 0) < DA_CONFERMARE_TTL);
  }
  function ricordaDaConfermare(rid, ep, listUrl, n) {
    if (!rid || !ep) return;
    const l = daConfermare().filter((x) => x.rid !== String(rid));
    l.push({ rid: String(rid), ep: String(ep), listUrl: listUrl || "", ts: Date.now(), n: n || 0 });
    store.set(DA_CONFERMARE, l.slice(-20));
  }
  function confermataProvata(rid) {
    const l = daConfermare();
    if (l.some((x) => x.rid === String(rid))) store.set(DA_CONFERMARE, l.filter((x) => x.rid !== String(rid)));
  }
  // quelle di questo episodio ancora senza prova, la più vecchia per prima;
  // quelle che questa pagina dimostra confermate si dimenticano qui
  function nonConfermateQui(doc = document, url = location.href) {
    const ep = findEpisodeId(doc, url);
    const tutte = daConfermare();
    if (!ep || !tutte.length) return [];
    const stampabili = printModel(doc, url);
    const restano = tutte.filter((x) => !(x.ep === ep && stampabili[x.rid]));
    if (restano.length !== (store.get(DA_CONFERMARE, []) || []).length) store.set(DA_CONFERMARE, restano);
    // (provate qui: un ordine rimasto «Da controllare» per una di loro diventa «Confermata» — ordineProvata)
    const provate = tutte.filter((x) => x.ep === ep && stampabili[x.rid]).map((x) => x.rid);
    if (provate.length) ordiniProvati(ep, provate);
    return restano.filter((x) => x.ep === ep).sort((a, b) => a.ts - b.ts);
  }
  // Le richieste che la pagina del paziente elenca confermate, al service
  // worker: gli ordini di quell'episodio rimasti «Da controllare» per una di
  // loro diventano «Confermata» (le etichette dalla sua pagina: mai dette stampate).
  function ordiniProvati(ep, rids) {
    if (!hasExt() || !ep || !rids.length) return;
    ask({ t: "ordineProvata", ep: String(ep), rids: rids.map(String).slice(0, 50) }).catch(() => {});
  }

  // ------------------------------------------------ le Conferme premute
  // Ogni Conferma premuta su una richiesta — dal motore, dal pannello, dal
  // medico a mano sul bottone del gestionale, in qualunque scheda — si annota
  // PRIMA che il clic parta (armPrintOnConfirm; nella cornice,
  // maybeAutoConfirm): il numero della richiesta e l'ora, nella memoria che
  // tutte le schede del gestionale leggono subito, e lo si dice al service
  // worker. Una Conferma in volo (3–14 s sul server) il gestionale non la
  // mostra ancora; questa memoria sì: «Conferma di nuovo» non preme mai sopra
  // una Conferma premuta dopo quella che il gestionale non aveva preso
  // (confermaDopo). E quando una scheda prende le etichette di una richiesta
  // confermata (maybeAutoPrint), «stampata»: chi la trova confermata altrove
  // sa se sono già uscite. «smentita»: il carrello ha provato che l'ultima
  // non è stata presa (lavoroSenzaSeguito) — non è in volo. Solo numeri, per 12 ore.
  const CONFERME = "conferme.v1", CONFERME_TTL = 12 * 3600e3;
  const conferme = () => { const l = store.get(CONFERME, []); return (Array.isArray(l) ? l : []).filter((x) => x && x.rid && Date.now() - (x.ts || 0) < CONFERME_TTL); };
  function segnaConferma(rid, cosa) {
    if (!rid) return;
    const t = Date.now(), l = conferme(), x = l.find((y) => y.rid === String(rid)) || { rid: String(rid) };
    store.set(CONFERME, [...l.filter((y) => y !== x), { ...x, [cosa]: t, ts: t }].slice(-40));
    if (cosa === "premuta" && hasExt()) ask({ t: "ordinePremuta", rid: String(rid), ts: t });
  }
  // una Conferma premuta (o le etichette prese) per questa richiesta dopo `t`; senza `t`, quando che sia
  const confermaDopo = (rid, cosa, t) => (Number((conferme().find((x) => x.rid === String(rid)) || {})[cosa]) || 0) > (Number(t) || 0);

  // La prova che una richiesta è confermata, quando la pagina dopo il clic
  // non l'ha data: la pagina del paziente — quella che elenca le richieste
  // confermate coi loro fogli da stampare. Solo letture, mai un invio, mai un
  // secondo clic. Il gestionale può metterci qualche secondo a elencarla:
  // prima di dire «non confermata» la si rilegge (CONFIRM_WAITS).
  // La pagina delle etichette LIS che il gestionale mostra subito dopo il clic
  // (RcsStampaEtichetteLIS, coi fogli in un window.open) NON è una prova: è
  // arrivata identica anche dopo una Conferma che il gestionale non aveva
  // registrato (registrazioni vere della 3.85.0: la POST in 0,4–0,7 s invece
  // dei soliti 3–14, e la richiesta mai elencata finché il medico non l'ha
  // riconfermata). Un'altra area intanto (l'ha cambiata un'altra scheda) non
  // guasta la prova: lì la pagina perde le Richieste, non l'elenco coi fogli.
  // Una Conferma partita e non provata, detta al medico: per il pannello non
  // è confermata (mai verde, mai una seconda Conferma da sola), ma non è
  // nemmeno «come se niente fosse» — prima di rifarla, le sue richieste.
  // Com'è finito un ordine, in tre parole — le stesse sulla striscia, nel
  // pannello, sul telefono e nel Registro: «Confermata» (provata), «Da
  // controllare» (la Conferma è partita, la prova no) e «Non partita»
  // (provata non presa, o fermata prima della Conferma). Sotto, l'azione;
  // il perché in una riga ancora sotto, o nel Registro. Mai una parola nuova.
  const GUARDA = "guarda le sue richieste: se c'è, Ristampa; se no, apri il carrello";
  const RIFARLA = "Se c'è già fra le sue richieste: Ristampa. Se no: premi tu Conferma";
  const RIFARLA_PERCHE = "La Conferma è partita, ma la pagina del paziente non mostra questa richiesta. Prima di rifarla guarda le sue richieste (⋯ → Stampa le richieste): se c'è, Ristampa; se no, controlla il carrello e premi tu Conferma.";
  // `carrello`: l'elenco della richiesta. SOLO se la Conferma è tornata
  // sospettamente in fretta (`subito`: prima di CONFERMA_SOSPETTA — l'unica
  // Conferma ignorata delle registrazioni è tornata in 0,2 s, le vere in
  // 3–14 s) e la pagina del paziente alla prima lettura non la elenca, si
  // legge anche lui (carrelloFermo): ancora coi suoi esami e col SUO bottone
  // Conferma, il gestionale non l'ha presa — «Non partita». Una Conferma
  // tornata coi suoi tempi non si giudica dal carrello (che aspetto abbia
  // quello di una richiesta confermata, le registrazioni non lo dicono): resta
  // «Da controllare». `una`: una lettura sola, senza attese.
  // → { doc, url } confermata, { nonPartita } o null.
  async function provaConferma(rid, ep, { patientUrl = "", panel = null, carrello = "", subito = false, una = false } = {}) {
    // solo l'indirizzo di una pagina da leggere: mai quello di un modulo inviato
    const leggibile = (x) => { try { return !!x && new URL(x).origin === location.origin && !/[?&](ccsForm|Insert|Delete|Update)=/i.test(x); } catch { return false; } };
    const qui = findEpisodeId(document, location.href) === ep && classify(document) === "patient" ? location.href : "";
    const u = [qui, patientUrl, (tuttiPazienti().find((p) => p.ep === ep) || {}).url].find(leggibile) || "";
    if (!rid || !ep || !u) return null;
    const attese = una ? [] : CONFIRM_WAITS;
    let guardato = !carrello || !subito;   // (il carrello solo sulla strada veloce)
    for (let k = 0; ; k++) {
      try {
        const { doc, url } = await fetchDoc(u);
        if (classify(doc) === "login" || findEpisodeIdInDoc(doc) !== ep) break;
        if (printModel(doc, url)[rid]) {
          leggiStatoPagina(ep, doc);   // la pagina letta comunque: lo stato degli esami si aggiorna
          panel?.log(`${now()}  la pagina del paziente la elenca coi suoi fogli: confermata`);
          return { doc, url };
        }
      } catch (e) {
        panel?.log(`${now()}  controllo della conferma non riuscito: ${e?.head || e?.message || e}`);
      }
      if (!guardato) {
        guardato = true;
        if (await carrelloFermo(rid, ep, carrello, panel)) return { nonPartita: true };
      }
      if (k >= attese.length) break;
      panel?.log(`${now()}  la pagina del paziente non la elenca ancora: la rileggo fra ${attese[k] / 1000} s`);
      await sleep(attese[k]);
    }
    panel?.log(`${now()}  la pagina del paziente non la elenca: conferma non provata`);
    return null;
  }
  // La Conferma che il gestionale non ha preso, detta da lui: il carrello di
  // quella richiesta (una lettura dell'elenco, la pagina vera) ha ancora
  // tutti gli esami della ricevuta e il SUO bottone Conferma — la richiesta è
  // ancora una bozza. Un carrello sparito, di un'altra richiesta o senza
  // Conferma, una ricevuta che manca: non si sa, e non è «non partita» (una
  // seconda Conferma non si propone mai su un forse).
  const CONFERMA_SOSPETTA = 1500;   // ms: una Conferma tornata prima è da guardare subito (le vere: 3–14 s)
  async function carrelloFermo(rid, ep, listUrl, panel) {
    const rc = tabStore.get("receipt.v1", null);
    if (!leggibilePagina(listUrl) || param(listUrl, "RICHIESTA_ID") !== String(rid)
      || !rc || String(rc.richiestaId) !== String(rid) || !Array.isArray(rc.items)) return false;
    try {
      const { doc, url } = await fetchDoc(listUrl);
      if (classify(doc) === "login" || findEpisodeIdInDoc(doc) !== String(ep)) return false;
      const m = examModel(doc, url);
      if (String(m.richiestaId) !== String(rid) || !m.confirmButton) {
        panel?.log(`${now()}  il carrello della richiesta non ha più la sua Conferma: non si sa se è partita`);
        return false;
      }
      const nel = new Set(m.exams.filter((e) => e.isDel).map((e) => String(e.code)));
      const suoi = rc.items.filter((i) => String(i.res) === String(m.res)).map((i) => String(i.code));
      const fermo = suoi.length > 0 && suoi.every((c) => nel.has(c));
      panel?.log(`${now()}  il carrello della richiesta ${fermo ? "ha ancora i suoi esami e la sua Conferma: il gestionale NON l'ha presa" : "non è più quello della ricevuta: non si sa se è partita"}`);
      return fermo;
    } catch (e) {
      panel?.log(`${now()}  il carrello della richiesta non si legge: ${e?.head || e?.message || e}`);
      return false;
    }
  }
  // Quanto ha messo la Conferma (dal clic alla risposta), annotato dalla prima
  // pagina che arriva dopo: solo per decidere QUANDO guardare il carrello.
  // Senza l'ora della risposta (`responseStart`) non si sa: la durata resta
  // null, la strada lenta — mai «tornata subito» per un numero che manca.
  function annotaDurataConferma(n = null) {
    const p = tabStore.get("print.v1", null);
    if (!p || p.durata != null || !(p.ts > 0)) return;
    let arrivo = 0;
    try {
      n = n || performance.getEntriesByType("navigation")[0];
      if (!n || !(n.responseStart > 0)) return;
      arrivo = performance.timeOrigin + n.responseStart;
    } catch { return; }
    if (arrivo >= p.ts) tabStore.set("print.v1", { ...p, durata: Math.round(arrivo - p.ts) });
  }

  // ------------------------------------------------ native-confirm handoff
  // La conferma senza guardare la pagina.
  //
  // La pagina del carrello viene caricata DAVVERO — stessa sessione, stesso
  // modulo, stesso bottone — solo dentro una cornice invisibile invece che
  // davanti agli occhi. Il clic è quello vero sul bottone del gestionale, e i
  // byte che partono sono gli stessi: la codifica del modulo la fa il browser,
  // non noi. Cambia solo che il medico non deve stare a guardare il LIS.
  //
  // La cornice gira SENZA script (`allow-forms allow-same-origin`, mai
  // `allow-scripts` né `allow-top-navigation`): così il codice della pagina non
  // può portarsi via la scheda del medico, e non serve — l'invio di un modulo
  // lo fa il browser. Se il server vieta di essere incorniciato, il documento
  // non è leggibile: ce ne accorgiamo e si torna a fare come prima.
  //
  // Fallisce sempre CHIUSA: qualunque intoppo lascia la conferma al medico.
  // E «confermata» si dice solo con una PROVA: una pagina dello stesso
  // episodio che elenca i fogli da stampare di questa richiesta. Un errore del
  // server, il carrello di nuovo, il tempo scaduto — tutto il resto è
  // «incerta», e incerta non è mai verde.
  const FRAME_MS = 25000;
  function confermaInCornice(listUrl, { panel, episodeId, rid }) {
    return new Promise((resolve) => {
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-forms allow-same-origin");
      f.setAttribute("aria-hidden", "true");
      f.style.cssText = "position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;visibility:hidden";
      let fatto = false, fase = "carico", tid = 0;
      const chiudi = (esito) => {
        if (fatto) return;
        fatto = true;
        clearTimeout(tid);
        try { f.remove(); } catch { /* già via */ }
        resolve(esito);
      };
      const cronometro = () => { clearTimeout(tid); tid = setTimeout(() => chiudi(fase === "carico" ? "rifiutata" : "incerta"), FRAME_MS); };
      cronometro();

      f.addEventListener("load", () => {
        let doc = null, url = "";
        try { doc = f.contentDocument; url = f.contentWindow.location.href; } catch { doc = null; }
        // Una cornice appena inserita emette un `load` per la sua pagina vuota,
        // prima ancora di caricare la nostra: quello non è il carrello.
        // (Un indirizzo che non si lascia nemmeno leggere, invece, è la pagina
        // d'errore di un server che non si lascia incorniciare: qui sotto.)
        if (url === "about:blank") return;
        // Non leggibile: prima del clic vuol dire che il server non si lascia
        // incorniciare (è la strada di prima, e si prende quella); dopo il
        // clic, che non si può sapere com'è andata.
        if (!doc || !doc.documentElement) return chiudi(fase === "carico" ? "rifiutata" : "incerta");

        if (fase === "carico") {
          let cliccato = false;
          try { cliccato = maybeAutoConfirm(panel, doc, url); }
          catch (e) { panel?.log(`${now()}  conferma in sottofondo interrotta: ${e?.message || e}`); }
          // Al carrello manca una riga che deve avere: lo si ricarica (una
          // lettura dell'elenco pulito) e i controlli ripartono da capo.
          if (cliccato && cliccato.rileggi) {
            clearTimeout(tid);
            tid = setTimeout(() => { if (!fatto) { cronometro(); f.src = listUrl; } }, cliccato.rileggi);
            return;
          }
          // Nessun clic vuol dire che un controllo ha detto di no: la pagina
          // va mostrata al medico, che decide lui.
          if (!cliccato) return chiudi("sospesa");
          fase = "confermo";
          panel?.render();
          return;
        }
        // Seconda pagina: quella dopo la conferma. È la prova solo se è di
        // questo episodio e porta i fogli di QUESTA richiesta — e allora i
        // fogli si prendono da lì.
        const suo = findEpisodeIdInDoc(doc);
        if (!rid || !suo || suo !== episodeId || !printModel(doc, url)[rid]) {
          panel?.log(`${now()}  dopo la conferma: "${snippet(doc).slice(0, 80)}" — nessuna prova che sia confermata`);
          return chiudi("incerta");
        }
        let stampata = false;
        try { stampata = maybeAutoPrint(panel, doc, url); } catch { stampata = false; }
        chiudi(stampata ? "stampata" : "confermata");
      });
      f.addEventListener("error", () => chiudi(fase === "carico" ? "rifiutata" : "incerta"));
      document.documentElement.appendChild(f);
      f.src = listUrl;
    });
  }

  // Il giro che la navigazione ha interrotto: riprende da dov'era, su
  // qualunque pagina del gestionale il medico sia finito. Quello che era IN
  // VOLO si cerca in carrello e non si rimanda mai — l'unica cosa che la
  // pagina morendo si porta via è la RISPOSTA, non l'ordine.
  function riprendiCorsa(panel) {
    const c = tabStore.get(CORSA, null);
    if (!c) return false;
    const daFare = (c.involo ? 1 : 0) + (c.restanti || []).length;   // roba ancora aperta: i soli «fatti» non bastano
    const scaduta = Date.now() - (c.ts || 0) > CORSA_TTL;
    const troppe = (c.riprese || 0) >= CORSA_MAX;
    if (scaduta || troppe || !c.listUrl || !c.ep || !daFare) {
      tabStore.set(CORSA, null);
      if (daFare && (scaduta || troppe)) {
        panel.message = `Il giro su ${c.paziente || "questo paziente"} era rimasto a metà da troppo tempo: apri il carrello e controlla.`;
        panel.render();
      }
      return false;
    }
    // Il giro di un ordine in sottofondo riprende solo nella sua scheda e solo
    // finché il service worker lo conosce. Una scheda ripristinata dopo che il
    // browser è caduto (l'appunto sopravvive, l'ordine no), o la copia di una
    // scheda duplicata, non lo finisce di nascosto: lo lascia, e il segno
    // condiviso «giro rimasto a metà» resta per la prima pagina del medico.
    if (c.ordine && !(LAVORO && LAVORO.id === c.ordine)) {
      tabStore.set(CORSA, null);
      panel.log(`${now()}  l'appunto è di un ordine che non c'è più: non lo riprendo`);
      panel.message = `Il giro di esami su ${c.paziente || "un paziente"} si era fermato a metà (era una scheda d'ordine): non lo riprendo. Apri il carrello e controlla.`;
      panel.render();
      return false;
    }
    if (!presidioLibero(c.rid, null)) {
      // Qualcuno ci sta già lavorando: quasi sempre questa stessa scheda
      // duplicata, che si è portata dietro l'appunto. Non si manda niente e non
      // si butta via niente: se fra poco quel presidio scade, la pagina dopo
      // riprende. (Cambiando pagina il presidio si molla subito, quindi questo
      // non scatta per una navigazione normale.)
      panel.log(`${now()}  un'altra scheda sta già mandando gli esami di questa richiesta: da qui, niente`);
      panel.message = "Un'altra scheda sta finendo questo giro di esami: da qui non mando niente.";
      panel.render();
      return false;
    }
    const items = [];
    // Quello che era già in carrello prima dell'interruzione rientra nel giro:
    // si ricontrolla (mai si rimanda) così la ricevuta finale parla della
    // richiesta intera, non solo del pezzo dopo la navigazione.
    for (const f of c.fatti || []) items.push({ ...f, soloVerifica: true, giaFatto: true });
    if (c.involo) items.push({ ...c.involo, soloVerifica: true });
    for (const r of c.restanti || []) items.push({ ...r });
    panel.runPatient = c.paziente || "";
    // Il conto delle riprese si scrive PRIMA di ripartire: se anche questa
    // ripresa muore subito, il tetto vale lo stesso e non si ricomincia in
    // eterno a ogni ricaricamento.
    tabStore.set(CORSA, { ...c, ts: Date.now(), riprese: (c.riprese || 0) + 1 });
    panel.log(`${now()}  ── riprendo il giro dopo il cambio pagina: ${items.length} da sistemare ──`);
    runPlan({
      startPage: "ripresa", listUrl: c.listUrl, items,
      episodeId: c.ep, autoConfirm: !!c.autoConfirm, quesito: c.quesito || "", qinfo: c.qinfo || null,
      patientName: c.paziente || "", riprese: (c.riprese || 0) + 1, ...(c.ritentato ? { ritentato: true } : {}),
      ...(Array.isArray(c.originali) ? { originali: c.originali } : {}),
      ...(c.patientUrl ? { patientUrl: c.patientUrl } : {}),
      ...(Array.isArray(c.prima) ? { prima: c.prima } : {}),
    }, panel);
    return true;
  }

  // «2 esami non sono stati mandati, 1 è da controllare»: il segno di un giro
  // rimasto a metà, detto giusto — quello in volo non è mai «non mandato».
  const contoRimasto = (quanti, forse) => [
    quanti ? (quanti === 1 ? "1 esame non è stato mandato" : `${quanti} esami non sono stati mandati`) : "",
    forse ? (forse === 1 ? `1 ${quanti ? "" : "esame "}è da controllare` : `${forse} ${quanti ? "" : "esami "}sono da controllare`) : "",
  ].filter(Boolean).join(", ").replace(/\s+/g, " ");
  // Un giro rimasto a metà che NESSUNO riprenderà (scheda chiusa, browser
  // caduto, sessione scaduta): l'appunto vive nella scheda e se n'è andato con
  // lei, ma il segno condiviso no. Lo si dice, una volta, e lo si toglie —
  // a meno che lo dica già la striscia di un ordine di quel paziente.
  function avvisaGiroAbbandonato(panel, ordini = []) {
    const a = store.get(APERTA, null);
    if (!a || !(a.quanti || a.forse)) return false;
    const eta = Date.now() - (a.ts || 0);
    if (eta > APERTA_TTL) { store.set(APERTA, null); return false; }
    // fresco = c'è una scheda che ci sta ancora lavorando: non è abbandonato
    if (eta < 60e3 || tabStore.get(CORSA, null)) return false;
    if (ordini.some((x) => x.ep === a.ep)) return false;
    store.set(APERTA, null);
    panel.message = `Un giro di esami su ${a.paziente || "un paziente"} è rimasto a metà: ${contoRimasto(a.quanti, a.forse)}. Apri la sua richiesta e controlla.`;
    panel.collapsed = false;   // un avviso chiuso nella pill non lo legge nessuno
    panel.render();
    return true;
  }

  // Il carrello di una sola risorsa, la Conferma che invia la richiesta
  // intera: si clicca solo se ogni controllo dice sì. Ogni no scrive il suo
  // perché nel Registro. Un carrello a cui manca una riga che deve avere
  // (l'elenco arriva monco, o in ritardo) si rilegge — `{ rileggi: ms }`: chi
  // chiama ricarica l'elenco pulito, e i controlli ripartono da capo — al
  // massimo CONFIRM_WAITS volte; tutto il resto sospende subito.
  function maybeAutoConfirm(panel, doc = document, url = location.href) {
    const flag = tabStore.get("confirm.v1", null);
    if (!flag) return false;
    const no = (perche, { rileggi = false, messaggio = "" } = {}) => {
      const k = flag.riletture || 0;
      if (rileggi && k < CONFIRM_WAITS.length) {
        tabStore.set("confirm.v1", { ...flag, riletture: k + 1 });
        panel?.log(`${now()}  auto-conferma: ${perche} — rileggo il carrello fra ${CONFIRM_WAITS[k] / 1000} s`);
        return { rileggi: CONFIRM_WAITS[k] };
      }
      tabStore.set("confirm.v1", null);
      if (panel) {
        panel.log(`${now()}  auto-conferma sospesa: ${perche}`);
        if (messaggio) { panel.message = messaggio; panel.render(); }
      }
      return false;
    };
    const aMano = "La Conferma invia la richiesta intera — controlla il carrello e premila tu sulla pagina.";
    if (Date.now() - (flag.ts || 0) > CONFIRM_FLAG_TTL) return no("il segno della conferma è scaduto");

    const model = examModel(doc, url);
    const ep = findEpisodeId(doc, url);
    if (!model.form || !model.richiestaId) { panel?.log(`${now()}  auto-conferma: questa pagina non è il carrello`); return false; }
    // The flag is tab-scoped, so a mismatching richiesta here is stale: drop it.
    if (model.richiestaId !== flag.richiestaId || (flag.episodeId && ep && ep !== flag.episodeId)) return no(`questo carrello è di un'altra richiesta (${model.richiestaId})`);
    const ultimo = `«${shortLabel(flag.lastLabel || "") || flag.lastCode}» (${flag.lastCode})`;
    if (!model.inCart(flag.lastCode)) {
      return no(`${ultimo} non è nel carrello di questa pagina`, { rileggi: true,
        messaggio: `Conferma automatica sospesa: ${ultimo} non compare nel carrello. ${aMano}` });
    }
    // Anti wrong-exam check also at the last gate before an irreversible act.
    if (flag.lastLabel) {
      const liveRow = model.exams.find((e) => e.code === flag.lastCode && e.isDel);
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toUpperCase();
      if (!liveRow || norm(liveRow.label) !== norm(flag.lastLabel)) {
        return no(`la riga ${flag.lastCode} oggi si chiama «${liveRow ? liveRow.label : "?"}»`, { messaggio: `Conferma automatica sospesa: ${ultimo} in carrello ha un altro nome. ${aMano}` });
      }
    }
    if (!model.confirmButton) return no("nella pagina non c'è il bottone Conferma");
    const inCart = model.exams.filter((e) => e.isDel);
    const cartPreview = inCart.slice(0, 5).map((e) => shortLabel(e.label));
    if (inCart.length > 5) cartPreview.push(`+${inCart.length - 5} altri`);
    // The native Conferma submits the WHOLE richiesta, not this run's
    // additions. This page shows only the CURRENT resource's cart rows, so the
    // honest comparison is per-resource against the receipt: a row in the cart
    // that this run did not add (a leftover from an earlier attempt) means the
    // click would confirm more than the banner says — refuse, human decides.
    const receipt = tabStore.get("receipt.v1", null);
    // Senza ricevuta non si può dire «nel carrello c'è solo quello che ho
    // aggiunto io» — e la Conferma nativa invia la richiesta INTERA. Non
    // poter controllare non è come aver controllato: si ferma, e preme il
    // medico. (Prima di questa riga il controllo veniva semplicemente
    // saltato e la conferma partiva lo stesso.)
    if (!receipt || receipt.richiestaId !== model.richiestaId || !Array.isArray(receipt.items)) {
      return no("ricevuta assente o di un'altra richiesta", { messaggio: `Conferma automatica sospesa: non risulta cosa è stato aggiunto in questa corsa. ${aMano}` });
    }
    {
      // Questa pagina mostra il carrello di UNA risorsa sola, ma la Conferma
      // invia la richiesta intera. Quindi si controlla risorsa per risorsa:
      // quella davanti agli occhi dal vivo, le altre col carrello che il run
      // ha visto quando le ha visitate. Una riga che non abbiamo aggiunto,
      // su qualunque risorsa, sospende: decide una persona.
      const perRes = new Map();
      for (const i of receipt.items) {
        const r = String(i.res);
        perRes.set(r, (perRes.get(r) || new Set()).add(String(i.code)));
      }
      const carrelli = receipt.carrelli || {};
      const guai = [];
      let vistiQui = 0, soloMancaQui = true;   // (solo righe che mancano dalla pagina davanti: quelle si rileggono)
      for (const [res, attesi] of perRes) {
        const visti = res === model.res
          ? inCart.map((e) => String(e.code))
          : (Array.isArray(carrelli[res]) ? carrelli[res].map(String) : null);
        if (res === model.res) vistiQui = visti.length;
        if (!visti) { guai.push(`${risorsaCorta(res)}: carrello non visto`); soloMancaQui = false; continue; }
        const estranei = visti.filter((c) => !attesi.has(c));
        if (estranei.length || visti.length !== attesi.size) {
          guai.push(`${risorsaCorta(res)}: ${visti.length} nel carrello, ${attesi.size} aggiunti${estranei.length ? ` (estranei ${estranei.join(", ")})` : ""}`);
          if (estranei.length || res !== model.res) soloMancaQui = false;
        }
      }
      if (guai.length) {
        return no(`${guai.join("; ")} (${vistiQui} esami su questa risorsa)`, { rileggi: soloMancaQui,
          messaggio: `Conferma automatica sospesa: ${guai.join("; ")}. ${aMano}` });
      }
    }
    tabStore.set("confirm.v1", null); // consume immediately: a reload must never re-trigger the countdown

    // The doctor already chose "+ Conferma": that click was the decision, and
    // every gate above has passed (episode, richiesta, last exam present under
    // its right name, cart identical to the receipt for this resource).
    // Confirm now — a countdown here was dead time, not safety.
    panel?.log(`${now()}  conferma automatica: ${flag.count} ${flag.count === 1 ? "esame" : "esami"} · ${cartPreview.join(" · ")} · click nativo su Conferma`);
    // Quando la pagina non è quella davanti agli occhi, la stampa va armata
    // qui: il gancio sul bottone vive solo sulla pagina vera.
    if (doc !== document) {
      segnaConferma(model.richiestaId, "premuta");   // (e la Conferma premuta: lì non c'è il gancio che la annota)
      segnoStampa(ep || "", model.richiestaId, receipt);
      const q = tabStore.get("queue.v1", null);
      if (q && q.items) {
        const restano = q.items.filter((it) => it.rid !== model.richiestaId);
        tabStore.set("queue.v1", restano.length ? { ...q, items: restano, ts: Date.now() } : null);
      }
    }
    // (in volo: i bottoni del pannello di questa pagina non la rimandano — confermaPannello)
    const quiStessa = doc === document || String(examModel(document, location.href).richiestaId || "") === String(model.richiestaId);
    if (quiStessa) confermaPannello = "Confermo…";
    model.confirmButton.click(); // native click → server confirm → label print flow
    if (quiStessa) panel?.render();
    return true;
  }

