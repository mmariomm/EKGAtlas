//@frammento 14-storico-risultati.js — STORICO (portale clinico: tabella multi-giorno, fusione, chiavi paziente e codice fiscale)
//@ e RISULTATI MODEL (outOfRange, parseRisultati).
  // ------------------------------------------------------- STORICO (portale clinico)
  // "Storico dati clinici" draws the multi-day table as TWO tables side by
  // side: a frozen left one with the exam names, a scrollable right one with
  // one column per draw, row-aligned by position. Nothing is asked of the
  // server here — this reads the table the doctor already has on screen.
  const STORICO_SX = ".clinical-data-table__freeze-container-left table";
  const STORICO_DX = ".clinical-data-table__freeze-container-right table";
  const DATA_ORA = /\b(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))?/;

  function haStorico(doc) { return !!(doc.querySelector(STORICO_SX) && doc.querySelector(STORICO_DX)); }

  // Both tooltips open with an identifier and " - ": the exam one with the
  // catalogue code ("1583 - ALT TRANSAMINASI", "ABC1234 - …"), the specific
  // one with the LIS mnemonic ("ALT - S-ALT (…)", "LINF% - …", "HbA1c - …").
  function primoToken(t) {
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9%._/-]{0,23})\s+-\s+/.exec(String(t || ""));
    return m ? m[1] : "";
  }
  function pezziTooltip(t) {
    const tok = primoToken(t);
    // a code has a number in it: a bare word is a name, and naming it "code"
    // would be a made-up identifier
    const codice = /\d/.test(tok) ? tok : "";
    const resto = tok ? String(t).slice(String(t).indexOf(tok) + tok.length).replace(/^\s*-\s*/, "") : String(t || "");
    return { codice, nome: resto.trim() };
  }
  const mnemonicoStorico = (t) => primoToken(t);

  function leggiStorico(doc) {
    const sx = doc.querySelector(STORICO_SX), dx = doc.querySelector(STORICO_DX);
    if (!sx || !dx) return null;
    // The two tables are one table cut in half: if they ever stop lining up,
    // a value would land on the wrong exam. Then we read nothing at all.
    if (sx.rows.length !== dx.rows.length) return null;

    // Two draws can carry the SAME date and time — a POC and the central lab
    // drawn together is an ordinary morning here — so a column's identity is
    // not its label: each gets an occurrence key, or merging two reads would
    // pour one draw's values into the other's empty cells.
    const date = [], visti = new Map();
    for (const th of dx.rows[0] ? dx.rows[0].cells : []) {
      const m = DATA_ORA.exec((th.textContent || "").replace(/\s+/g, " "));
      if (!m) { date.push(null); continue; }
      const label = m[1] + (m[2] ? " " + m[2] : "");
      const n = (visti.get(label) || 0) + 1;
      visti.set(label, n);
      date.push({ data: m[1], ora: m[2] || "", label, chiave: label + "#" + n });
    }
    if (!date.some(Boolean)) return null;

    const righe = [], scartate = [];
    const nCol = dx.rows[0] ? dx.rows[0].cells.length : 0;
    for (let i = 1; i < sx.rows.length; i++) {
      const tdE = sx.rows[i].querySelector("td.exam");
      if (!tdE) continue;                                   // header and filler rows
      // The LEFT column is the ordered exam ("ESAME URINE COMPLETO"), the one
      // next to it is the analyte ("U-Albumina", "S-ALT"): a panel repeats the
      // same exam on every one of its rows, so the analyte is the name — and
      // its specimen prefix (U-, S-) stays, because U-Emoglobina is not Hb.
      const esame = (tdE.textContent || "").replace(/\s+/g, " ").trim();
      const tdS = sx.rows[i].querySelector("td.exam-specific");
      const spec = tdS ? tdS.querySelector("[uib-tooltip]") : null;
      const nome = (tdS?.textContent || "").replace(/\s+/g, " ").trim() || esame;
      if (!nome) continue;
      const { codice } = pezziTooltip(tdE.querySelector("[uib-tooltip]")?.getAttribute("uib-tooltip"));
      const mnem = mnemonicoStorico(spec?.getAttribute("uib-tooltip"));
      const valori = [];
      const celle = dx.rows[i] ? dx.rows[i].cells : [];
      // one cell per column, or the values would slide under the wrong draw:
      // a row that does not line up is left out AND declared, never guessed
      if (celle.length !== nCol) { scartate.push({ nome, valore: "riga fuori colonna" }); continue; }
      for (let c = 0; c < date.length; c++) {
        if (!date[c]) continue;
        const d = celle[c] ? celle[c].querySelector(".exam-value") : null;
        const v = d ? (d.textContent || "").replace(/\s+/g, " ").trim() : "";
        // the page already knows what is out of range: SUP above, INF below
        const stato = !v || !d.classList.contains("out-of-range") ? 0
          : d.classList.contains("SUP") ? 1 : d.classList.contains("INF") ? -1 : 0;
        valori.push({ v, stato });
      }
      if (valori.some((x) => x.v)) righe.push({ nome, esame, codice, mnem, pos: i, valori });
    }
    if (!righe.length) return null;

    // who this table belongs to — a value under the wrong name is the worst
    // thing this program could do, so the identity travels WITH the values
    const testa = [...doc.querySelectorAll(".panel-heading, app-root-selected-anagrafe")]
      .map((e) => (e.textContent || "").replace(/\s+/g, " ")).find((t) => /idMPI/i.test(t)) || "";
    // "Nome" must not match inside "Cognome": the label starts a word
    // The heading is one line of "Etichetta: valore" pairs. Cutting it on the
    // labels we know is the only way to keep a two-word name whole: a generic
    // "up to the next word with a colon" stops at the first space, turning
    // "MARIA ANNA" into "MARIA" — the name of a different patient.
    const campi = new Map();
    for (const pezzo of testa.split(/\s+(?=(?:idMPI|Cognome|Nome|Sesso|Data di nascita|Data nascita)\s*:)/i)) {
      const m = /^\s*([A-Za-z ]+?)\s*:\s*(.*)$/.exec(pezzo);
      if (m) campi.set(m[1].toLowerCase(), m[2].trim());
    }
    const campo = (k) => campi.get(k.toLowerCase()) || "";
    const periodo = [...doc.querySelectorAll(".panel-heading")]
      .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
      .find((t) => /^Tabella esami periodo/i.test(t)) || "";

    return normalizzaStorico({
      paziente: { idMPI: campo("idMPI"), cognome: campo("Cognome"), nome: campo("Nome") },
      cf: cfImpronta(doc),
      periodo, date: date.filter(Boolean), righe, scartate, letto: Date.now(),
    });
  }

  // Two reads of the same table can show different draws: the portal only
  // renders the columns in view. Merging by (esame, data) means scrolling the
  // period ADDS draws instead of replacing them.
  // Scrivere nella scheda clinica del paziente SENZA cancellare quello che
  // c'è: si legge, si fonde, si riscrive dicendo da quale revisione si è
  // partiti. Se un'altra scrittura è passata nel mezzo, si rilegge e si
  // rifonde. Prima si scriveva e basta: la tabella del portale arrivata dopo i
  // Risultati si portava via i prelievi letti e i referti salvati.
  async function mettiInScheda(chiave, nuovo, fondi = unisciStorico) {
    for (let i = 0; i < 4; i++) {
      const gia = await ask({ t: "getStorico", chiave });
      const vecchio = gia && gia.ok ? gia.dati : null;
      const r = await ask({ t: "putStorico", chiave, dati: fondi(vecchio, nuovo), base: (vecchio && vecchio.rev) || 0 });
      if (!r || !r.conflitto) return r || { ok: false };
    }
    return { ok: false };
  }

  function unisciStorico(vecchio, nuovo) {
    if (!vecchio || !nuovo) return nuovo || vecchio || null;
    // Un altro paziente: si ricomincia. Il nome NON basta a dire «è lo
    // stesso»: sul portale si passa da un omonimo all'altro senza ricaricare
    // la pagina, e due persone con lo stesso nome finirebbero in un unico
    // grafico. Quindi devono combaciare il codice fiscale E il nome, e
    // un'identità che non si è potuta leggere conta come un altro paziente.
    if (!stessoPaziente(vecchio.paziente, nuovo.paziente)) return nuovo;
    // Due codici fiscali che non si sono potuti leggere NON sono lo stesso
    // codice fiscale: "" === "" è vero per JavaScript, non per due persone.
    // Senza questa riga due omonimi senza codice finivano in un grafico solo.
    if (!vecchio.cf || !nuovo.cf || vecchio.cf !== nuovo.cf) return nuovo;
    return fondiStorico(vecchio, nuovo);
  }
  // La fusione vera e propria, SENZA il cancello d'identità: la usa chi sa già
  // che le due tabelle sono dello stesso paziente — i prelievi letti in questa
  // scheda del browser sono tutti della pagina aperta.
  function fondiStorico(vecchio, nuovo) {
    if (!vecchio || !nuovo) return nuovo || vecchio || null;
    const date = [...vecchio.date];
    // Due prelievi allo stesso minuto (POC e laboratorio centrale: una
    // mattina qualunque) NON sono lo stesso prelievo: se l'accesso è un
    // altro, la colonna è un'altra e prende il primo numero libero. Senza
    // accesso (la tabella del portale) vale la chiave com'è.
    const rinomina = new Map();
    for (const d of nuovo.date) {
      const k = chiaveCol(d);
      const gia = date.find((x) => chiaveCol(x) === k);
      if (!gia) { date.push(d); continue; }
      if (!d.id || !gia.id || d.id === gia.id) continue;
      const stesso = date.find((x) => x.id && x.id === d.id);
      if (stesso) { rinomina.set(k, chiaveCol(stesso)); continue; }
      let n = 2;
      while (date.some((x) => chiaveCol(x) === d.label + "#" + n)) n++;
      const nuova = { ...d, chiave: d.label + "#" + n };
      date.push(nuova); rinomina.set(k, nuova.chiave);
    }
    date.sort((a, b) => ordData(a.label) - ordData(b.label));   // stable: same minute keeps its order
    const perEsame = new Map();
    const versa = (dati, mappa) => {
      const colDi = (d) => (mappa && mappa.get(chiaveCol(d))) || chiaveCol(d);
      const qui = new Map();   // chiave → { nome, celle }, dentro QUESTA tabella
      for (const r of dati.righe) {
        // HB is both blood haemoglobin and the urine dipstick: the analyte
        // alone is not an identity, the ordered exam is part of it
        // La chiave di una riga è l'ANALITA, la stessa identità che il
        // programma usa già per dire «è lo stesso esame» fra due prelievi.
        // Così l'emoglobina letta dalla finestra Risultati del gestionale e
        // quella della tabella del portale finiscono nella stessa riga,
        // invece di diventarne due. Quando l'analita non c'è (il nome ricade
        // sulla prestazione) solo la posizione distingue le righe.
        const anonima = !r.mnem && r.nome === r.esame;
        const base = valKey(r.nome) + (anonima ? "|#" + (r.pos ?? 0) : "");
        // L'emogas fa riga a sé (vedi eEga). Si decide valore per valore: una
        // tabella salvata prima di questa regola può avere nella stessa riga
        // valori dell'emocromo e dell'emogas — qui si separano.
        const gruppi = new Map();   // chiave → indici dei valori
        r.valori.forEach((v, i) => {
          if (!(v && v.v && dati.date[i])) return;
          const kv = base + (eEga(v.esame || r.esame) ? "|ega" : "");
          if (!gruppi.has(kv)) gruppi.set(kv, []);
          gruppi.get(kv).push(i);
        });
        if (!gruppi.size) gruppi.set(base + (eEga(r.esame) ? "|ega" : ""), []);
        for (const [k0, idx] of gruppi) {
          let k = k0;
          // due righe della stessa tabella con la stessa chiave (S-Sodio e
          // P-Sodio, o lo stesso nome due volte nello stesso prelievo) si
          // fondono solo se non si contraddicono: un valore non ne copre mai
          // un altro
          const gia = qui.get(k);
          if (gia && idx.some((i) => gia.celle.has(colDi(dati.date[i])) && gia.celle.get(colDi(dati.date[i])) !== r.valori[i].v)) {
            k += gia.nome !== r.nome ? "|" + r.nome : "|#" + (r.pos ?? 0);
          }
          const mio = qui.get(k) || { nome: r.nome, celle: new Map() };
          idx.forEach((i) => mio.celle.set(colDi(dati.date[i]), r.valori[i].v));
          qui.set(k, mio);
          const primo = idx.length ? r.valori[idx[0]] : null;
          const cur = perEsame.get(k) || { nome: r.nome, esame: (primo && primo.esame) || r.esame, codice: r.codice, mnem: r.mnem, pos: r.pos, per: new Map() };
          // La provenienza viaggia CON il valore. Due prelievi possono aver
          // fatto lo stesso esame con macchine diverse (POC e laboratorio):
          // stessa riga, ma si deve poter dire quale cella viene da dove.
          // Una cella che sa già con cosa è stata fatta lo tiene: rifondere una
          // tabella già fusa non deve riscrivere ogni cella con l'esame della
          // riga, o la provenienza (POC vs laboratorio) sparisce alla seconda
          // passata.
          idx.forEach((i) => { const v = r.valori[i]; cur.per.set(colDi(dati.date[i]), v.esame ? v : r.esame ? { ...v, esame: r.esame } : v); });
          perEsame.set(k, cur);
        }
      }
    };
    versa(vecchio); versa(nuovo, rinomina);
    const righe = [...perEsame.values()].map((e) => ({
      nome: e.nome, esame: e.esame, codice: e.codice, mnem: e.mnem, pos: e.pos,
      valori: date.map((d) => e.per.get(chiaveCol(d)) || { v: "", stato: 0 }),
    }));
    // i referti già letti per questo paziente non si perdono in una fusione
    const referti = [...(nuovo.referti || []), ...(vecchio.referti || [])]
      .filter((r, i, a) => r && r.id && a.findIndex((x) => x.id === r.id) === i).slice(0, 40);
    // Chi arriva dopo con meno non cancella quello che c'era: un prelievo dei
    // Risultati non ha il periodo del portale, e ha il nome solo come titolo
    // di pagina. L'identità strutturata (cognome/nome del portale) resta —
    // mai mescolata campo per campo, o «ROSSI» + «ROSSI MARIO» diventerebbe
    // un terzo nome che non combacia più con nessuno.
    const strutturata = (p) => !!(p && (p.cognome || p.idMPI));
    const paziente = strutturata(vecchio.paziente) && !strutturata(nuovo.paziente) ? vecchio.paziente : nuovo.paziente;
    return { paziente, cf: nuovo.cf || vecchio.cf || "",
             ep: nuovo.ep || vecchio.ep || "", nomeSa4: nuovo.nomeSa4 || vecchio.nomeSa4 || "",
      periodo: nuovo.periodo || vecchio.periodo || "", date, righe, referti,
             // le stesse righe rifiutate arrivano da tutt'e due i lati quando
             // una tabella viene rifusa: una volta sola
             scartate: [...(vecchio.scartate || []), ...(nuovo.scartate || [])]
               .filter((x, i, a) => x && a.findIndex((y) => y && y.nome === x.nome && y.valore === x.valore) === i).slice(0, 40),
             letto: Date.now() };
  }
  // Una tabella passa per la fusione anche da sola, appena letta e prima di
  // mostrarla: così le colonne vanno sempre in ordine di tempo (il portale le
  // può dare dalla più recente, e «ultimo» finiva sul prelievo più vecchio),
  // lo stesso analita ripetuto da due prestazioni è una riga sola, e una
  // scheda salvata prima che l'emogas avesse righe sue si divide.
  function normalizzaStorico(st) {
    return st ? fondiStorico(st, { ...st, righe: [], date: [], referti: [], scartate: [] }) : null;
  }
  const chiaveCol = (d) => (d && (d.chiave || d.label)) || "";
  const ordData = (label) => {
    const m = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(label || "");
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : 0;
  };
  // names as the two systems write them: "ROSSI MARIO" in SA4PSO's title,
  // Cognome + Nome on the portal. Only those two ORDERS are accepted: sorting
  // the words would make "MARINO BRUNO" and "BRUNO MARINO" the same person,
  // and that check is the only thing standing between one patient's lab table
  // and another patient's screen.
  const normNome = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ").trim().replace(/\s+/g, " ");
  const chiavePaziente = (p) => normNome([p?.cognome, p?.nome].filter(Boolean).join(" "));
  // La scheda di un paziente nell'archivio: il codice fiscale quando c'è (è
  // l'unica identità che non si può confondere), altrimenti il nome.
  const chiaveArchivio = (d) => (d?.cf ? "cf:" + d.cf : "nome:" + chiavePaziente(d?.paziente));
  // Il gestionale scrive il nome come una stringa sola («ROSSI MARIO» o
  // «MARIO ROSSI», a seconda del presidio), il portale lo dà separato: si
  // accettano i due ordini, mai le parole mescolate.
  function stessoPaziente(a, b) {
    const ka = chiavePaziente(a), kb = chiavePaziente(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    return (!a?.cognome && combaciaNome(a?.nome, b)) || (!b?.cognome && combaciaNome(b?.nome, a));
  }
  // SA4PSO scrive il nome come una stringa sola, il portale lo dà già
  // separato: da lì l'ordine delle due parole non si può dedurre. Ma
  // entrambi i sistemi scrivono anche il CODICE FISCALE — il portale nel
  // titolo, il gestionale accanto al nome nella finestra Risultati, che il
  // pannello legge già per i valori. Quello è un identificativo unico: dove
  // c'è, decide lui. Ne teniamo solo l'IMPRONTA, mai il codice in chiaro.
  const CF_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g;
  function cfPagina(doc) {
    const testo = ((doc.title || "") + " " + (doc.body?.textContent || "")).toUpperCase();
    const trovati = [...new Set(testo.match(CF_RE) || [])];
    return trovati.length === 1 ? trovati[0] : "";   // più di uno: non sappiamo quale
  }
  const cfImpronta = (doc) => { const c = cfPagina(doc); return c ? impronta(c) : ""; };

  // Il codice fiscale è più forte del nome, ma le due prove non devono
  // potersi CONTRADDIRE: un codice che combacia accanto a un nome che non
  // ha niente in comune è un segnale che qualcosa non torna, non un via
  // libera. Basta una parola in comune (il titolo può portare altro).
  function nomiCompatibili(titolo, p) {
    const a = normNome(titolo).split(" ").filter((x) => x.length >= 3);
    const b = normNome([p?.cognome, p?.nome].filter(Boolean).join(" ")).split(" ").filter((x) => x.length >= 3);
    if (!a.length || !b.length) return true;          // uno dei due non è leggibile
    return a.some((x) => b.includes(x));
  }
  // Fra le schede in archivio, quella di questo paziente. DUE PASSATE, non
  // una decisione per candidato: se esiste una scheda col codice fiscale di
  // questo paziente è QUELLA, sempre. Si ripiega sul nome solo se nessuna
  // scheda porta un codice fiscale — altrimenti un omonimo senza codice,
  // incontrato per primo, vincerebbe su una scheda verificata col codice.
  function scegliScheda(indice, mio, titolo, ep) {
    const v = indice || [];
    // Prima di tutto: la scheda letta ARRIVANDO DA QUESTO PAZIENTE. È stato il
    // medico ad aprire il portale da questa pagina, e nessun confronto di nomi
    // può essere più sicuro di così.
    // …ma il clic non può CONTRADDIRE le altre prove: sul portale si passa
    // da un omonimo all'altro senza ricaricare, e la scheda arrivata da quel
    // clic può essere di un altro ROSSI MARIO. Con un codice fiscale diverso
    // o un nome che non c'entra, il clic non conta.
    if (ep) {
      const suo = v.find((x) => x.ep && String(x.ep) === String(ep)
        && (!mio || !x.cf || x.cf === mio) && nomiCompatibili(titolo, x.paziente));
      if (suo) return suo;
    }
    // Se di questo paziente conosciamo il codice fiscale, decide SOLO quello:
    // niente ripieghi sul nome, perché una scheda senza codice col suo stesso
    // nome può essere di un omonimo.
    if (mio) return v.find((x) => x.cf === mio && nomiCompatibili(titolo, x.paziente)) || null;
    // Se non lo conosciamo ancora, si può andare solo per nome — ma allora si
    // guarda solo fra le schede che un codice non ce l'hanno: una scheda che
    // porta un codice non si può attribuire a un paziente di cui non ne
    // sappiamo nessuno.
    return v.find((x) => !x.cf && combaciaNome(titolo, x.paziente)) || null;
  }
  function combaciaNome(titolo, p) {
    const t = normNome(titolo);
    const c = normNome(p?.cognome), n = normNome(p?.nome);
    if (!t || (!c && !n)) return false;
    const dritto = [c, n].filter(Boolean).join(" ");
    const rovescio = [n, c].filter(Boolean).join(" ");
    return t === dritto || t === rovescio;
  }

  // ------------------------------------------------------- RISULTATI MODEL
  // While a lab request is still being reported, the patient page shows a
  // coloured icon that pops up RcsAccessiRisultatiElenco.do — plain HTML on
  // THIS origin, so the values can be read and shown inside the panel.
  // QUANDO è stato fatto un prelievo. SA4PSO lo scrive in un campo nascosto
  // della riga (DATA_ORD) come «yyyy-mm-dd HH:MM», ma un presidio può averlo
  // in un'altra forma, e senza un istante un prelievo non può diventare una
  // colonna. Si accettano le forme che NON sono ambigue; il giorno prima del
  // mese perché questo programma gira in un ospedale italiano, dove così è
  // scritto anche a video. Tutto il resto si rifiuta invece di indovinare.
  function istanteDa(grezzo) {
    const s = String(grezzo || "").trim();
    const fatto = (a, me, g, h, mi) => ({ ts: Date.UTC(a, me - 1, g, h, mi), when: `${String(g).padStart(2, "0")}/${String(me).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` });
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2})[:.](\d{2})/.exec(s);
    if (m) return fatto(+m[1], +m[2], +m[3], +m[4], +m[5]);
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})[ ,T]+(\d{1,2})[:.](\d{2})/.exec(s);
    if (m) return fatto(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1], +m[4], +m[5]);
    m = /^(\d{4})(\d{2})(\d{2})[ T]?(\d{2})(\d{2})/.exec(s);
    if (m) return fatto(+m[1], +m[2], +m[3], +m[4], +m[5]);
    return null;
  }
  // La data della riga, presa dalla riga: prima il campo nascosto, e se non
  // c'è (o è scritto in un modo mai visto) la cella che il medico ha davanti.
  // Non si costruisce niente: si legge quello che la pagina mostra già.
  function istanteRiga(tr) {
    const campo = tr?.querySelector('input[name="DATA_ORD"]');
    const dal = istanteDa(campo ? campo.value : "");
    if (dal) return { ...dal, via: "campo" };
    for (const td of tr?.querySelectorAll(":scope > td") || []) {
      const t = istanteDa(td.textContent.replace(/\s+/g, " ").trim());
      if (t) return { ...t, via: "cella" };
    }
    return null;
  }

  function risultatiModel(doc, baseUrl) {
    const out = [], seen = new Set();
    for (const a of doc.querySelectorAll('a[title="Visualizza Risultati"]')) {
      const m = /window\.open\(\s*['"]([^'"]+)['"]/.exec(a.getAttribute("onclick") || "");
      if (!m) continue;
      let url;
      try { url = new URL(m[1], baseUrl).href; } catch { continue; }
      const id = param(url, "RCS_ACCESSO_ID");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const td = a.closest("td"), tr = a.closest("tr");
      const exams = (td?.getAttribute("title") || "").split(";")
        .map((x) => shortLabel(x.replace(/^\s*\d+-\d+\s*/, "")).trim()).filter(Boolean);
      const dt = istanteRiga(tr);
      out.push({ id, url, exams, ts: dt ? dt.ts : 0, when: dt ? dt.when : "", dataVia: dt ? dt.via : "" });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }

  // Perché un prelievo non è diventato una colonna: l'unica risposta sta
  // nelle righe della pagina, non nel pannello. Una riga per collegamento
  // «Visualizza Risultati», con quello che c'era scritto davvero.
  function diagPrelievi(doc, baseUrl) {
    const righe = [], visti = new Set();
    for (const a of doc.querySelectorAll('a[title="Visualizza Risultati"]')) {
      const m = /window\.open\(\s*['"]([^'"]+)['"]/.exec(a.getAttribute("onclick") || "");
      const tr = a.closest("tr");
      const campo = tr?.querySelector('input[name="DATA_ORD"]');
      let id = "";
      if (m) { try { id = param(new URL(m[1], baseUrl).href, "RCS_ACCESSO_ID") || ""; } catch { /* indirizzo rotto */ } }
      const doppio = !!id && visti.has(id);
      if (id) visti.add(id);
      const dt = istanteRiga(tr);
      righe.push({
        ok: !!dt && !doppio && !!id && !!m,
        testo: `${id || "senza identificativo"}${doppio ? " (già visto: la riga si ripete)" : ""} · campo ${
          !campo ? "ASSENTE" : campo.value ? `«${String(campo.value).slice(0, 30)}»` : "vuoto"} · ${
          dt ? `letta dalla ${dt.via}: ${dt.when}` : "NESSUNA data leggibile in questa riga"}${m ? "" : " · senza collegamento"}`,
      });
    }
    return righe;
  }

  // a value outside its own reference range is worth the eye
  // Is this value outside its reference range? Returns -1 / 0 / +1.
  //
  // Laboratories write ranges in more ways than one ("4 - 10", "< 0.5",
  // "fino a 5", "> 60", "-2 - +2", "4 - 10 x10^3"), and values come with
  // modifiers ("<0.01") or as words ("NEGATIVO"). The rule here is
  // deliberately one-sided: when a format is not understood — or the range
  // depends on something we cannot know, like sex — it returns 0 and the
  // value is shown plain. Never a red mark we cannot justify.
  function outOfRange(value, range) {
    const num = (s) => {
      const m = /-?\d+(?:[.,]\d+)?/.exec(String(s));
      return m ? parseFloat(m[0].replace(",", ".")) : NaN;
    };
    const raw = String(range || "").replace(/\s+/g, " ").trim();
    const vs = String(value).replace(/\s+/g, " ").trim();
    if (!raw || !vs) return 0;
    // "M: 13-17 F: 12-16", or two ranges in one cell: which one applies is not
    // ours to guess
    if (/\b[MF]\s*[:=]/.test(raw)) return 0;
    if ((raw.match(/\s[-–]\s/g) || []).length > 1) return 0;

    const v = num(vs);
    if (!isFinite(v)) return 0;                       // NEGATIVO, Assente, tracce…
    const vLt = /^[<≤]/.test(vs), vGt = /^[>≥]/.test(vs);

    let lo = NaN, hi = NaN;
    const due = /^(-?[\d.,]+)\s*[-–]\s*([+-]?[\d.,]+)/.exec(raw);
    if (due) { lo = num(due[1]); hi = num(due[2]); }
    else if (/^[<≤]|^inf\.?\s*a\b|^fino a\b|^minore\b/i.test(raw)) hi = num(raw);
    else if (/^[>≥]|^sup\.?\s*a\b|^maggiore\b|^oltre\b/i.test(raw)) lo = num(raw);
    else return 0;
    if (!isFinite(lo) && !isFinite(hi)) return 0;
    if (isFinite(lo) && isFinite(hi) && lo > hi) return 0;   // unreadable, not a range

    if (isFinite(lo) && (v < lo || (vLt && v <= lo))) return -1;
    if (isFinite(hi) && (v > hi || (vGt && v >= hi))) return 1;
    return 0;
  }

  // Returns the value rows AND the candidate rows it refused: a row this
  // parser does not understand must become a warning, never a hole.
  function parseRisultati(doc) {
    const rows = [], scartate = [];
    for (const tr of doc.querySelectorAll("tr")) {
      // DIRECT children only: the patient header of the same table nests its own
      // tables, and cells picked up from those made a row look like a result
      const tds = [...tr.querySelectorAll(":scope > td.AFCDataTD")];
      if (tds.length < 5) continue;
      const [nome, valore, um, range, stato, data] = tds.map((t) => t.textContent.replace(/\s+/g, " ").trim());
      if (!nome || !valore) continue;
      // the same table carries the patient header (Assistito, Pronto Soccorso,
      // Quesito…): those rows have no date, no range and no state, and would
      // otherwise show up among the values as a nonsense line
      if (/^(assistito|pronto soccorso|quesito|reparto|medico|paziente|data)\b/i.test(nome)) continue;
      // A result row proves itself: a reporting date, a numeric range, or a
      // laboratory state. The header block of the same table (name, età, CF,
      // quesito) has none of the three, whichever way it is nested.
      const dataOk = /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(data || "");
      const rangeOk = /\d/.test(range || "") && /[-–<>≤≥]|fino a|inf\.|sup\./i.test(range || "");
      const statoOk = /^(parziale|definitiv|refertat|eseguit|in corso|validat|preliminar|provvisori)/i.test(stato || "");
      if (!dataOk && !rangeOk && !statoOk) { scartate.push({ nome, valore }); continue; }
      rows.push({ nome, valore, um, range, stato });
    }
    return { rows, scartate };
  }

  // One chronological list of everything the lab/radiology returned for this
  // patient: values we can read (risultati) and reported documents (referti).
  // what a values row needs to exist on its own, without the page
  const risMeta = (e) => ({ id: e.id || "", url: e.url, label: e.label || "", exams: e.exams || [], when: e.when || "", ts: e.ts || 0 });

