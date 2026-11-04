/*
 * PS Assist — «Ricetta SISS», la parte del service worker (importata da bg.js).
 *
 * Il pannello (sulla pagina del paziente) chiede una ricetta: farmaci con
 * quantità e «non sostituibile», un quesito. Qui la si consegna a UNA scheda
 * del Prescrittivo Regionale già aperta e già entrata, dove ricetta-siss.js la
 * compila come una persona — identificazione col codice fiscale, ogni farmaco
 * cercato nella ricerca del SISS e scelto col suo codice esatto — e si ferma
 * sull'ANTEPRIMA. Registra, Salva, Stampa: mai, li preme il medico.
 *
 * Una ricetta alla volta, in storage.session «ricetta» (muore col browser; il
 * codice fiscale e il nome si tolgono appena finisce). La consegna alla
 * scheda è UNA (`consegnata`): una scheda che chiede di nuovo — si è ricaricata
 * a metà — non riparte, si ferma e lo dice. I farmaci si danno UNA volta
 * (`compilato`). La stessa domanda due volte (stesso id) è la stessa ricetta.
 * Nessuna richiesta al SISS da qui: solo messaggi alle schede.
 *
 * I preferiti (storage.local «ricetta.preferiti.v1»): gli ultimi farmaci visti
 * davvero in un'Anteprima del SISS — codice, descrizione, quantità. Niente del
 * paziente.
 */

const RIC = "ricetta", RIC_PREF = "ricetta.preferiti.v1", RIC_PREF_MAX = 12;
const RIC_PR = "https://operatorisiss.servizirl.it";
const RIC_PR_URL = RIC_PR + "/prescrittivoRegionale/*";
const RIC_MENU = "https://dcss.cgi.crs.lombardia.it/menusiss/";
const RIC_ATTIVI = new Set(["attesa", "login", "identifico", "pronto", "compilo"]);
const RIC_CF = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
let ricFila = Promise.resolve();
const ricInFila = (fn) => (ricFila = ricFila.then(fn, fn));
const ricLeggi = async () => (await chrome.storage.session.get(RIC))[RIC] || null;
const ricScrivi = (j) => chrome.storage.session.set({ [RIC]: j });
const ricCorto = (s, n = 160) => String(s == null ? "" : s).slice(0, n);
const dalPrescrittivo = (u) => { try { const x = new URL(u); return x.origin === RIC_PR && x.pathname.startsWith("/prescrittivoRegionale/"); } catch { return false; } };

// Quanto può restare ferma una ricetta prima di scadere: il login con la carta
// ha 10 minuti, una ricetta identificata che aspetta le scelte del medico 20,
// un passo della compilazione 3 (la scheda scrive a ogni passo).
function ricScaduta(j) {
  if (!j || !RIC_ATTIVI.has(j.stato)) return false;
  const lim = j.stato === "login" || j.stato === "attesa" ? 10 * 60e3 : j.stato === "pronto" ? 20 * 60e3 : 3 * 60e3;
  return Date.now() - (j.agg || 0) > lim;
}
// L'ultima parola: il paziente se ne va dalla memoria, resta l'esito per il pannello.
function ricChiudi(j, stato, testo, tono = "warn") {
  j.stato = stato; j.vista = { testo: ricCorto(testo, 240), tono }; j.agg = j.fine = Date.now();
  delete j.cf; delete j.nome;
}
// Le voci che il pannello manda: farmaci (codice AIC, 9 cifre) o visite ed
// esami (il codice della prestazione, come lo scrive la tendina del SISS).
// Mai le due cose insieme: che il SISS le mescoli in una ricetta non è
// provato, quindi una ricetta alla volta (`misto`).
const ricTipo = (codice) => (/^\d{9}$/.test(codice) ? "farmaco" : "visita");
const ricCodiceBuono = (c) => /^\d{9}$/.test(c) || /^[0-9A-Z][0-9A-Z.\-/]{0,15}$/i.test(c);
function ricVoci(l) {
  if (!Array.isArray(l)) return null;
  const out = [];
  for (const v of l.slice(0, 10)) {
    const codice = ricCorto(v && v.codice, 16).trim();
    if (!ricCodiceBuono(codice) || out.some((x) => x.codice === codice)) continue;
    const tipo = ricTipo(codice);
    out.push(tipo === "farmaco"
      ? { codice, tipo, descr: ricCorto(v.descr, 90), cerca: ricCorto(v.cerca, 40), qta: Math.max(1, Math.min(99, Math.round(Number(v.qta) || 1))), ns: !!v.ns }
      : { codice, tipo, descr: ricCorto(v.descr, 90), cerca: ricCorto(v.cerca, 40) });
  }
  if (new Set(out.map((x) => x.tipo)).size > 1) out.misto = true;
  return out;
}
const RIC_MISTO = "Una ricetta alla volta: farmaci o visite";

// Le schede del Prescrittivo, una per una: entrata? ha già una ricetta? il
// medico ci sta scrivendo? La prima libera vince.
async function ricTrova() {
  const tabs = await chrome.tabs.query({ url: RIC_PR_URL }).catch(() => []);
  const r = { tab: null, occupata: null, scrive: null };
  for (const t of tabs) {
    const s = await allaScheda(t.id, { t: "ricettaStato" }, 3000);
    if (!s || !s.dentro) continue;
    if (s.occupata) { r.occupata = r.occupata || t; continue; }
    if (s.scrive) { r.scrive = r.scrive || t; continue; }
    r.tab = t; break;
  }
  return r;
}
// Il menu del SISS davanti al medico, perché entri con la carta: quello già
// aperto, se c'è, altrimenti una scheda nuova. Nessun campo si tocca.
async function ricMenuDavanti(j) {
  const [m] = await chrome.tabs.query({ url: RIC_MENU + "*" }).catch(() => []);
  const t = m ? await chrome.tabs.update(m.id, { active: true }).catch(() => null) : await chrome.tabs.create({ url: RIC_MENU, active: true }).catch(() => null);
  if (t && t.windowId != null) chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
  j.menu = t ? t.id : null;
}
// Cerca la scheda e le dà la ricetta; se non c'è, il menu del SISS e si
// aspetta (riprovo da solo: una scheda del Prescrittivo che entra lo dice).
async function ricAvvia(j) {
  const r = await ricTrova();
  if (r.tab) {
    j.worker = r.tab.id; j.stato = "identifico"; j.agg = Date.now();
    j.vista = { testo: "Apro una ricetta nuova nel SISS…", tono: "run" };
    await ricScrivi(j);
    allaScheda(r.tab.id, { t: "ricettaSveglia", id: j.id });
    return;
  }
  if (r.occupata) ricChiudi(j, "fermo", "Il SISS ha già una ricetta aperta: finiscila (o chiudila) e riprova. Niente è stato scritto.");
  else if (r.scrive) ricChiudi(j, "fermo", "Stai scrivendo nel SISS: riprova quando hai finito. Niente è stato scritto.");
  else {
    if (j.stato !== "login") await ricMenuDavanti(j);
    j.stato = "login"; j.agg = j.agg || Date.now();
    j.vista = { testo: "Entra nel SISS con la carta, poi riprovo da solo", tono: "warn" };
  }
  await ricScrivi(j);
}
// I preferiti: il più recente davanti, uno per codice, al più 12.
// (un farmaco: codice, descrizione, quantità, dall'Anteprima; una visita:
// codice, descrizione e tipo, quando la ricetta l'ha inserita davvero)
async function ricImpara(voci) {
  const l = ((await chrome.storage.local.get(RIC_PREF))[RIC_PREF]) || [];
  let pref = Array.isArray(l) ? l.filter((x) => x && ricCodiceBuono(String(x.codice || ""))) : [];
  for (const v of voci.slice(0, 10).reverse()) {
    const codice = ricCorto(v && v.codice, 16).trim();
    if (!ricCodiceBuono(codice)) continue;
    const descr = ricCorto(v.descr, 90).replace(/\s+/g, " ").trim();
    if (!descr) continue;
    const voce = ricTipo(codice) === "farmaco"
      ? { codice, descr, tipo: "farmaco", qta: Math.max(1, Math.min(99, Math.round(Number(v.qta) || 1))), ts: Date.now() }
      : { codice, descr, tipo: "visita", ts: Date.now() };
    pref = [voce, ...pref.filter((x) => x.codice !== codice)];
  }
  await chrome.storage.local.set({ [RIC_PREF]: pref.slice(0, RIC_PREF_MAX) });
}

// (con un nome: i test lo chiamano due volte con la stessa domanda)
function ricMessaggio(msg, sender, reply) {
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string" || !msg.t.startsWith("ricetta")) return;
  const tab = sender && sender.tab;
  const fai = (fn) => { ricInFila(fn).catch((e) => reply({ ok: false, why: ricCorto(e && e.message || e, 80) })); return true; };
  const daGestionale = !!tab && sulGestionale(sender.url);
  const daSiss = !!tab && dalPrescrittivo(sender.url);

  // ---- dal pannello (la pagina del paziente) ------------------------------
  if (["ricettaNuova", "ricettaCerca", "ricettaPrepara", "ricettaFerma"].includes(msg.t) && !daGestionale) return reply({ ok: false, why: "non dal gestionale" }), true;
  if (msg.t === "ricettaNuova") return fai(async () => {
    const x = msg.job || {};
    const id = ricCorto(x.id, 40);
    const cur = await ricLeggi();
    // la stessa domanda due volte (la risposta si è persa, un doppio tocco): una ricetta sola
    if (cur && cur.id === id) return reply({ ok: true, gia: true, ricetta: cur });
    if (cur && RIC_ATTIVI.has(cur.stato) && !ricScaduta(cur)) return reply({ ok: false, why: "C'è già una ricetta in preparazione nel SISS: aspetta che finisca" });
    const cf = ricCorto(x.cf, 16).toUpperCase(), nome = ricCorto(x.nome, 80).replace(/\s+/g, " ").trim();
    if (!id || !RIC_CF.test(cf) || !nome) return reply({ ok: false, why: "manca il codice fiscale o il nome del paziente" });
    const voci = x.voci == null ? null : ricVoci(x.voci);
    if (voci && !voci.length) return reply({ ok: false, why: "nessun farmaco scelto" });
    if (voci && voci.misto) return reply({ ok: false, why: RIC_MISTO });
    const j = { id, ep: ricCorto(x.ep, 20), opener: tab.id, cf, nome, quesito: ricCorto(x.quesito, 256), voci,
      cerca: x.cerca ? { q: ricCorto(x.cerca, 40), n: 1 } : null, stato: "attesa", ts: Date.now(), agg: Date.now(),
      vista: { testo: "Cerco il SISS…", tono: "run" } };
    await ricScrivi(j);
    reply({ ok: true, ricetta: j });
    await ricAvvia(j);
  });
  const attiva = async () => {
    const j = await ricLeggi();
    if (!j || j.id !== msg.id) return null;
    if (ricScaduta(j)) { ricChiudi(j, "fermo", "Scaduta: il SISS non ha risposto in tempo. Riprova."); await ricScrivi(j); return null; }
    return RIC_ATTIVI.has(j.stato) ? j : null;
  };
  // una ricerca nella ricerca del SISS (la fa la scheda, quando il paziente è identificato)
  if (msg.t === "ricettaCerca") return fai(async () => {
    const j = await attiva();
    if (!j || j.voci) return reply({ ok: false });
    j.cerca = { q: ricCorto(msg.q, 40), n: ((j.cerca && j.cerca.n) || 0) + 1 };
    j.risultati = null;
    await ricScrivi(j);
    reply({ ok: true });
    if (j.stato === "pronto" && j.worker != null) allaScheda(j.worker, { t: "ricettaComando", id: j.id });
  });
  // i farmaci scelti: una volta sola per ricetta
  if (msg.t === "ricettaPrepara") return fai(async () => {
    const j = await attiva();
    if (!j) return reply({ ok: false, why: "la ricetta non è più aperta: rifai «Prepara nel SISS»" });
    if (j.voci) return reply({ ok: true, gia: true });
    const voci = ricVoci(msg.voci);
    if (!voci || !voci.length) return reply({ ok: false, why: "nessun farmaco scelto" });
    if (voci.misto) return reply({ ok: false, why: RIC_MISTO });
    j.voci = voci; j.quesito = ricCorto(msg.quesito, 256); j.agg = Date.now();
    await ricScrivi(j);
    reply({ ok: true });
    if (j.stato === "pronto" && j.worker != null) allaScheda(j.worker, { t: "ricettaComando", id: j.id });
  });
  if (msg.t === "ricettaFerma") return fai(async () => {
    const j = await attiva();
    if (!j) return reply({ ok: false });
    const w = j.worker;
    ricChiudi(j, "fermo", "Fermata da te: quello che è già scritto resta nel SISS.");
    await ricScrivi(j);
    reply({ ok: true });
    if (w != null) allaScheda(w, { t: "ricettaFerma", id: j.id });
  });

  // ---- dal Prescrittivo (ricetta-siss.js) ---------------------------------
  if (!daSiss) return;
  // una scheda del Prescrittivo è entrata (o ha cambiato vista): c'è una ricetta che aspettava il login?
  if (msg.t === "ricettaQui") return fai(async () => {
    reply({ ok: true });
    const j = await ricLeggi();
    if (j && j.stato === "login" && msg.dentro && !ricScaduta(j)) await ricAvvia(j);
    // la scheda che aveva la ricetta è ripartita da capo (ricaricata): non riparte, lo si dice
    else if (j && j.worker === tab.id && j.consegnata && Number(msg.nata) > j.consegnata && RIC_ATTIVI.has(j.stato)) {
      ricChiudi(j, "fermo", "La pagina del SISS si è ricaricata a metà: controlla nel SISS e, se serve, rifai «Prepara nel SISS».");
      await ricScrivi(j);
      segnaErrore("ricetta", { passo: "consegna", motivo: "scheda del SISS ricaricata a metà" });
    }
  });
  if (msg.t === "ricettaImpara") return fai(async () => { await ricImpara(Array.isArray(msg.voci) ? msg.voci : []); reply({ ok: true }); });
  // «chi sono?»: la ricetta va a questa scheda UNA volta
  if (msg.t === "ricettaChi") return fai(async () => {
    const j = await ricLeggi();
    if (!j || j.worker !== tab.id || !RIC_ATTIVI.has(j.stato)) return reply({ ok: true });
    if (j.consegnata) {
      ricChiudi(j, "fermo", "La pagina del SISS si è ricaricata a metà: controlla nel SISS e, se serve, rifai «Prepara nel SISS».");
      await ricScrivi(j);
      segnaErrore("ricetta", { passo: "consegna", motivo: "scheda del SISS ricaricata a metà" });
      return reply({ ok: true });
    }
    j.consegnata = Date.now(); j.agg = Date.now();
    await ricScrivi(j);
    reply({ ok: true, lavoro: { id: j.id, cf: j.cf, nome: j.nome } });
  });
  const suo = async () => {
    const j = await ricLeggi();
    return j && j.id === msg.id && j.worker === tab.id && RIC_ATTIVI.has(j.stato) ? j : null;
  };
  // a che punto è
  if (msg.t === "ricettaPasso") return fai(async () => {
    const j = await suo();
    if (!j) return reply({ ok: false, fermo: true });
    j.agg = Date.now();
    if (msg.testo) j.vista = { testo: ricCorto(msg.testo, 200), tono: "run" };
    await ricScrivi(j);
    reply({ ok: true });
  });
  // identificato: i farmaci (una volta), o una ricerca da fare
  if (msg.t === "ricettaPronto") return fai(async () => {
    const j = await suo();
    if (!j) return reply({ ok: false, fermo: true });
    j.agg = Date.now();
    if (j.voci && !j.compilato) {
      j.compilato = Date.now(); j.stato = "compilo";
      j.vista = { testo: "Compilo la ricetta nel SISS…", tono: "run" };
      await ricScrivi(j);
      return reply({ ok: true, voci: j.voci, quesito: j.quesito || "" });
    }
    if (j.stato !== "compilo") {
      j.stato = "pronto";
      if (!j.cerca || j.risultati) j.vista = { testo: "Paziente identificato nel SISS: scegli i farmaci", tono: "ok" };
    }
    await ricScrivi(j);
    reply({ ok: true, cerca: j.stato === "pronto" ? j.cerca : null });
  });
  if (msg.t === "ricettaRisultati") return fai(async () => {
    const j = await suo();
    if (!j) return reply({ ok: false });
    const voci = (Array.isArray(msg.voci) ? msg.voci : []).slice(0, 40)
      .map((v) => ({ codice: ricCorto(v && v.codice, 16), descr: ricCorto(v && v.descr, 90) })).filter((v) => ricCodiceBuono(v.codice))
      .map((v) => ({ ...v, tipo: ricTipo(v.codice) }));
    j.risultati = { q: ricCorto(msg.q, 40), n: Number(msg.n) || 0, voci, altri: Math.max(0, Math.min(999, Number(msg.altri) || 0)), why: ricCorto(msg.why, 120) };
    j.agg = Date.now();
    j.vista = { testo: "Paziente identificato nel SISS: scegli i farmaci", tono: "ok" };
    await ricScrivi(j);
    reply({ ok: true });
  });
  // l'ultima parola della scheda: Anteprima, o fermo/errore (dove e perché)
  if (msg.t === "ricettaFine") return fai(async () => {
    const j = await suo();
    if (!j) return reply({ ok: false });
    // («inserite»: le visite sono nella ricetta del SISS; quesito, durata e
    // Anteprima li fa il medico — l'Anteprima, con una visita, non si preme)
    const esito = msg.esito === "anteprima" ? "anteprima" : msg.esito === "inserite" ? "inserite" : msg.esito === "errore" ? "errore" : "fermo";
    const testo = esito === "anteprima" ? "Ricetta pronta in Anteprima nel SISS: controlla e premi tu Registra"
      : esito === "inserite" ? "Visite inserite: aggiungi quesito e durata, poi Anteprima"
      : ricCorto(msg.testo, 240) || "Fermato: completa tu nel SISS";
    const visite = esito === "inserite" ? (j.voci || []).filter((v) => v.tipo === "visita") : [];
    ricChiudi(j, esito, testo, esito === "anteprima" || esito === "inserite" ? "ok" : esito === "errore" ? "err" : "warn");
    if (msg.grave) j.grave = true;
    await ricScrivi(j);
    reply({ ok: true });
    if (visite.length) await ricImpara(visite);
    const d = msg.dati && typeof msg.dati === "object" ? { cf: ricCorto(msg.dati.cf, 10), nome: ricCorto(msg.dati.nome, 10) } : {};
    if (esito !== "anteprima") segnaErrore("ricetta", { esito, passo: ricCorto(msg.passo, 40), motivo: ricCorto(msg.testo, 160), ...(msg.grave ? { grave: true, ...d } : {}) });
    // la scheda del SISS davanti al medico: tocca a lui (un errore grave lo
    // dice il pannello, forte, dove sta lui)
    if (esito === "errore") return;
    const t = await chrome.tabs.update(tab.id, { active: true }).catch(() => null);
    if (t && t.windowId != null) chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
  });
  // (lo stato di questa scheda la chiede il service worker, ricTrova: qui niente)
}
chrome.runtime.onMessage.addListener(ricMessaggio);
// La seconda guardia. Noi Registra non lo premiamo mai; ma se, mentre la
// ricetta è nella scheda del SISS, quella scheda chiede al SISS di REGISTRARE
// (un bottone che fa più di quel che dice, un'app cambiata), lo si vede —
// webRequest, solo osservare: niente si blocca né si cambia — e lo si dice
// forte, fermando la scheda. Dopo l'Anteprima la ricetta è del medico: lì no.
const RIC_REGISTRA = /\/prescriptions\/(?:prepare-register-request|register-prescriptions)/;
try {
  chrome.webRequest.onBeforeRequest.addListener((d) => {
    if (!RIC_REGISTRA.test(d.url || "")) return;
    ricInFila(async () => {
      const j = await ricLeggi();
      if (!j || j.worker !== d.tabId || !j.consegnata || !RIC_ATTIVI.has(j.stato)) return;
      ricChiudi(j, "errore", "Attenzione: il SISS sta registrando la ricetta, e non l'ho chiesto io. Controlla subito nel SISS.", "err");
      j.grave = true;
      await ricScrivi(j);
      segnaErrore("ricetta", { esito: "errore", passo: "registrazione", grave: true, motivo: "il SISS ha chiesto una registrazione durante la compilazione" });
      allaScheda(d.tabId, { t: "ricettaFerma", id: j.id });
    }).catch(() => {});
  }, { urls: [RIC_PR + "/prescrittivoRegionale/*"] });
} catch { /* senza webRequest resta la prima guardia: il bottone giusto, riletto */ }
// la scheda del SISS chiusa a metà: la ricetta finisce lì, e lo si dice
chrome.tabs.onRemoved.addListener((id) => ricInFila(async () => {
  const j = await ricLeggi();
  if (j && j.worker === id && RIC_ATTIVI.has(j.stato)) { ricChiudi(j, "fermo", "La scheda del SISS si è chiusa prima dell'Anteprima: niente è stato registrato."); await ricScrivi(j); }
}).catch(() => {}));
