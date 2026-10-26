/*
 * PS Assist — il PONTE verso l'iPhone, nel service worker (importato da bg.js).
 *
 * Il medico lascia il PC per qualche minuto e dal telefono vuole vedere i
 * pazienti, i loro esiti, ordinare esami, scrivere una nota o un promemoria.
 * Tutto succede QUI, sul PC, col gestionale aperto e col codice di sempre: il
 * telefono manda una domanda, una scheda del gestionale la esegue e risponde.
 *
 * Come si parlano: una presa WebSocket in uscita (wss://, porta 443) verso il
 * ripetitore del sito (/ponte/ws), che passa i messaggi fra le due prese di
 * una «stanza» senza leggerli né tenerli. I messaggi sono cifrati da un capo
 * all'altro (ponte-cripto.js): la chiave sta solo qui e sul telefono, che l'ha
 * presa dal QR una volta al giorno. Il ripetitore vede byte, orari, misure e
 * gli indirizzi IP: mai un nome, un esame, un valore.
 *
 * Perché la presa sta nel service worker: da Chrome 116 una WebSocket che
 * manda o riceve almeno ogni 30 secondi lo tiene sveglio (qui un battito ogni
 * 20), ed è la strada indicata da Chrome; un documento «offscreen» vorrebbe un
 * permesso in più per fare la stessa cosa. Se il service worker si ferma lo
 * stesso (Chrome aggiornato, estensione ricaricata), la sessione muore con le
 * sue chiavi — che stanno solo in memoria — e il telefono ne apre una nuova:
 * lo sveglia la prima pagina del gestionale che chiede (ponteSveglia).
 *
 * La sessione finisce dopo 20 minuti senza comandi, con «Scollega» sul PC,
 * con la revoca, alla scadenza dell'associazione (14 ore) o col riavvio
 * dell'estensione. Mentre è aperta, ogni scheda del gestionale lo dice
 * nell'intestazione del pannello: «iPhone collegato · Scollega».
 */
/* global PonteCripto, ordLeggi, sulGestionale, leggibileOrd, corto */

const PONTE_HOST = "ponte.host";            // storage.local: l'indirizzo del sito col ponte
const PONTE_COPPIA = "ponte.coppia";        // storage.local: { k, scade, creata }
const PONTE_STATO = "ponte";                // storage.session: quello che le pagine mostrano
const PONTE_ORDINI = "ponte.ordini";        // storage.session: gli ordini partiti dal telefono
// Il sito del ponte di partenza. Vuoto: lo si scrive una volta nella pagina
// «iPhone» (è l'indirizzo del sito EKG Atlas, dove il ponte sta sotto /ponte/).
const PONTE_HOST_PREDEFINITO = "";
const PONTE_DURATA = 14 * 3600e3;           // un'associazione dura un turno lungo
const PONTE_INATTIVO = 20 * 60e3;           // senza comandi, la sessione si chiude
const PONTE_BATTITO = 20e3;                 // la presa parla almeno ogni 20 secondi
const PONTE_ERRORI = 5;                     // messaggi scartati di fila: sessione chiusa
const PONTE_SALUTO_MAX = 2 * 60e3;          // un saluto senza seguito si dimentica
const PONTE_VALORI_MAX = 150e3;             // «Aggiorna i valori» non aspetta di più
const PONTE_FRAME_MAX = (1 << 20) - 4096;   // il ripetitore non passa messaggi più grandi
const PONTE_PERCHE = {
  inattivo: "20 minuti senza comandi", "scollegata dal PC": "«Scollega» sul PC", revocata: "associazione revocata",
  scaduta: "associazione scaduta", "nuova associazione": "nuovo QR sul PC", "chiusa dall'iPhone": "chiusa dall'iPhone",
  "messaggi non validi": "messaggi non validi", riavvio: "estensione riavviata", "indirizzo cambiato": "indirizzo del ponte cambiato",
};

const pt = {
  host: "", coppia: null, k: null, chiavi: null,
  ws: null, wsUrl: "", relay: "spento", pari: false, tentativi: 0, tRiprova: 0,
  attesa: null,        // { canale, ts }: un saluto ricevuto, la sessione nuova che aspetta il primo messaggio
  sessione: null,      // { canale, dal, ultimo, n }
  errori: 0, ripartito: 0, fine: null, registro: [],
  valori: new Map(),   // scheda → { ep, risolvi }: le schede aperte per «Aggiorna i valori»
  fila: Promise.resolve(),
};

const ponteOra = () => Date.now();
const hhmmPonte = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const attendi = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

function ponteNota(testo) {
  pt.registro.push({ ts: ponteOra(), testo: corto(testo, 160) });
  if (pt.registro.length > 60) pt.registro.splice(0, pt.registro.length - 60);
}
// quello che le pagine possono sapere: niente chiavi, niente QR
function pontePubblico() {
  const s = pt.sessione;
  return {
    host: pt.host, accoppiato: !!pt.coppia, scade: pt.coppia ? pt.coppia.scade : 0, relay: pt.relay, telefono: pt.pari,
    sessione: s ? { dal: s.dal, ultimo: s.ultimo, n: s.n } : null, fine: pt.fine, registro: pt.registro.slice(-60),
  };
}
// (solo quando cambia: le schede lo ascoltano)
let ponteScritto = "";
function ponteScriviStato() {
  const s = pontePubblico(), firma = JSON.stringify(s);
  if (firma === ponteScritto) return Promise.resolve();
  ponteScritto = firma;
  return chrome.storage.session.set({ [PONTE_STATO]: s }).catch(() => { ponteScritto = ""; });
}

function ponteOrigine(t) {
  let s = String(t || "").trim();
  if (!s) return "";
  if (!/^[a-z]+:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const locale = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && locale)) return null;
  return u.origin;
}
const ponteQr = () => (pt.host && pt.coppia ? `${pt.host}/ponte/#${PonteCripto.frammento(pt.k, pt.coppia.scade)}` : "");

// ---------------------------------------------------------------- la presa
// Una alla volta: le schede che svegliano, un QR nuovo e un nuovo tentativo
// possono chiederlo insieme, e una chiave vecchia non deve arrivare per ultima.
let ponteFilaAvvio = Promise.resolve();
const ponteAvvia = () => (ponteFilaAvvio = ponteFilaAvvio.then(ponteAvviaOra, ponteAvviaOra));
async function ponteAvviaOra() {
  const o = await chrome.storage.local.get([PONTE_HOST, PONTE_COPPIA]);
  pt.host = o[PONTE_HOST] ?? PONTE_HOST_PREDEFINITO;
  let c = o[PONTE_COPPIA] || null;
  if (c && ponteOra() >= c.scade) {
    await chrome.storage.local.remove(PONTE_COPPIA);
    ponteNota(`Associazione con l'iPhone scaduta alle ${hhmmPonte(c.scade)}`);
    c = null;
  }
  if (!c) { pt.coppia = null; pt.k = null; pt.chiavi = null; }
  else if (!pt.coppia || pt.coppia.k !== c.k) {
    pt.k = PonteCripto.daB64u(c.k);
    pt.chiavi = await PonteCripto.chiaviCoppia(pt.k);
    pt.coppia = c;
  }
  if (pt.host && pt.coppia) ponteConnetti();
  else ponteStacca();
  await ponteScriviStato();
}
function ponteUrlPresa() {
  const u = new URL(pt.host);
  return `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}/ponte/ws?r=${pt.chiavi.stanza}&ruolo=pc`;
}
function ponteConnetti() {
  const url = ponteUrlPresa();
  if (pt.ws && pt.wsUrl === url && pt.ws.readyState <= 1) return;
  ponteStacca();
  clearTimeout(pt.tRiprova);
  let ws;
  try { ws = new WebSocket(url); } catch { pt.relay = "giu"; ponteRiprova(); return; }
  ws.binaryType = "arraybuffer";
  pt.ws = ws; pt.wsUrl = url; pt.relay = "collego";
  ws.onopen = () => { if (pt.ws !== ws) return; pt.relay = "su"; pt.tentativi = 0; ponteScriviStato(); };
  ws.onmessage = (ev) => { if (pt.ws === ws) pt.fila = pt.fila.then(() => ponteRicevi(ev.data)).catch(() => {}); };
  ws.onclose = () => {
    if (pt.ws !== ws) return;
    pt.ws = null; pt.relay = "giu"; pt.pari = false;
    ponteScriviStato();
    ponteRiprova();
  };
}
function ponteStacca() {
  const ws = pt.ws;
  pt.ws = null; pt.wsUrl = ""; pt.pari = false;
  pt.relay = pt.host && pt.coppia ? "giu" : "spento";
  if (ws) try { ws.close(1000, "fine"); } catch { /* già chiusa */ }
}
function ponteRiprova() {
  clearTimeout(pt.tRiprova);
  if (!pt.host || !pt.coppia) return;
  const ms = [1e3, 2e3, 5e3, 10e3, 30e3][Math.min(pt.tentativi++, 4)];
  pt.tRiprova = setTimeout(() => ponteAvvia().catch(() => {}), ms);
}
function ponteManda(frame) {
  if (pt.ws && pt.ws.readyState === 1) { pt.ws.send(frame); return true; }
  return false;
}
// il battito tiene sveglia la presa (e il service worker); intanto i conti
setInterval(() => {
  if (pt.ws && pt.ws.readyState === 1) pt.ws.send("ping");
  ponteControlla().catch(() => {});
}, PONTE_BATTITO);

// Scadenze: la sessione dopo 20 minuti senza comandi, l'associazione alla sua
// ora, un saluto rimasto a metà. (Con un nome: i test la chiamano con l'orologio avanti.)
async function ponteControlla() {
  const ora = ponteOra();
  if (pt.coppia && ora >= pt.coppia.scade) {
    await ponteFine("scaduta");
    await chrome.storage.local.remove(PONTE_COPPIA);
    ponteNota(`Associazione con l'iPhone scaduta alle ${hhmmPonte(pt.coppia.scade)}`);
    pt.coppia = null; pt.k = null; pt.chiavi = null;
    ponteStacca();
    await ponteScriviStato();
    return;
  }
  if (pt.sessione && ora - pt.sessione.ultimo >= PONTE_INATTIVO) await ponteFine("inattivo");
  if (pt.attesa && ora - pt.attesa.ts > PONTE_SALUTO_MAX) pt.attesa = null;
}

// ------------------------------------------------------- i messaggi in arrivo
async function ponteRicevi(dati) {
  if (typeof dati === "string") {
    if (dati === "pong") return;
    let m = null;
    try { m = JSON.parse(dati); } catch { return; }
    if (m && typeof m.pari === "boolean" && m.pari !== pt.pari) { pt.pari = m.pari; await ponteScriviStato(); }
    return;
  }
  if (!pt.chiavi) return;
  const b = new Uint8Array(dati);
  const h = PonteCripto.leggiTestata(b);
  if (h && h.tipo === PonteCripto.TIPO.SALUTO_TEL) return ponteSaluto(b);
  if (h && h.tipo === PonteCripto.TIPO.DATI_TEL) return ponteDati(b);
  return ponteScarto("tipo");
}
// Il telefono apre una sessione: il suo numero casuale, il nostro, le chiavi
// nuove. La sessione di prima (se c'è) resta finché la nuova non parla: un
// saluto ripetuto da qualcun altro non chiude niente.
async function ponteSaluto(b) {
  let m;
  try { m = (await PonteCripto.apri(pt.chiavi.salutoTel, b, PonteCripto.TIPO.SALUTO_TEL)).dati; }
  catch (e) { return ponteScarto(e.codice); }
  let nTel;
  try { nTel = PonteCripto.daB64u(m && m.n); } catch { return ponteScarto("contenuto"); }
  if (!m || m.v !== 1 || nTel.length !== 16) return ponteScarto("contenuto");
  const nPc = PonteCripto.casuale(16);
  pt.attesa = { canale: PonteCripto.canalePc(await PonteCripto.chiaviSessione(pt.k, nTel, nPc)), ts: ponteOra() };
  ponteManda(await PonteCripto.sigilla(pt.chiavi.salutoPc, PonteCripto.TIPO.SALUTO_PC, 0,
    { v: 1, n: PonteCripto.b64u(nPc), eco: m.n, scade: pt.coppia.scade }));
}
async function ponteDati(b) {
  if (pt.sessione) {
    try {
      const d = await pt.sessione.canale.decifra(b);
      pt.errori = 0;
      ponteComando(pt.sessione, d);
      return;
    } catch (e) {
      if (e.codice === "ripetuto") return ponteScarto("ripetuto");
    }
  }
  if (pt.attesa) {
    try {
      const d = await pt.attesa.canale.decifra(b);
      // il primo messaggio della sessione nuova: adesso è lei
      const nuova = !pt.sessione;
      pt.sessione = { canale: pt.attesa.canale, dal: ponteOra(), ultimo: ponteOra(), n: 0 };
      pt.attesa = null; pt.errori = 0; pt.fine = null;
      ponteNota(nuova ? "iPhone collegato" : "iPhone ricollegato: sessione nuova");
      await ponteScriviStato();
      ponteComando(pt.sessione, d);
      return;
    } catch { /* né l'una né l'altra */ }
  }
  // Nessuna sessione qui (l'estensione si è riavviata, o è stata chiusa): il
  // telefono lo deve sapere, o aspetterebbe risposte che non arrivano.
  if (!pt.sessione && !pt.attesa) return ponteRiparti();
  return ponteScarto("chiave");
}
async function ponteRiparti() {
  if (ponteOra() - pt.ripartito < 2000) return;
  pt.ripartito = ponteOra();
  ponteManda(await PonteCripto.sigilla(pt.chiavi.salutoPc, PonteCripto.TIPO.SALUTO_PC, 0,
    { v: 1, riparti: true, perche: (pt.fine && pt.fine.perche) || "riavvio" }));
}
async function ponteScarto(codice) {
  pt.errori++;
  if (pt.errori < PONTE_ERRORI) return;
  pt.errori = 0;
  ponteNota(`Messaggi dal ponte non validi (${codice}): scartati`);
  pt.attesa = null;
  if (pt.sessione) await ponteFine("messaggi non validi");
  else await ponteScriviStato();
}

async function ponteInvia(s, obj) {
  if (!s || pt.sessione !== s) return false;
  let f = await s.canale.cifra(obj);
  if (f.byteLength > PONTE_FRAME_MAX) {
    f = await s.canale.cifra(obj.re != null ? { re: obj.re, ok: false, errore: "Risposta troppo grande per il telefono: guardala sul PC" }
      : { evento: "avviso", testo: "Un aggiornamento era troppo grande per il telefono" });
  }
  return ponteManda(f);
}
async function ponteFine(perche) {
  const s = pt.sessione;
  pt.attesa = null;
  if (!s) return;
  pt.sessione = null;
  pt.fine = { perche, ts: ponteOra() };
  ponteNota(`Sessione con l'iPhone chiusa: ${PONTE_PERCHE[perche] || perche}`);
  try { ponteManda(await s.canale.cifra({ evento: "fine", perche })); } catch { /* la presa è giù: lo saprà dal saluto */ }
  await ponteScriviStato();
}

// --------------------------------------------------------------- i comandi
// Solo questi, e solo con questi argomenti: niente navigazione libera, niente
// script, niente appunti. Le regole del motore (episodio, richiesta,
// presidio…) restano quelle di sempre: i comandi le attraversano tutte.
const ponteTesto = (x, n) => (typeof x === "string" ? x.slice(0, n) : "");
function ponteArgomenti(d) {
  const a = {};
  if (typeof d.ep === "string" && /^[\w.-]{1,40}$/.test(d.ep)) a.ep = d.ep;
  if ("testo" in d) a.testo = ponteTesto(d.testo, 4000);
  if (typeof d.pid === "string" && /^[\w-]{1,40}$/.test(d.pid)) a.pid = d.pid;
  if (Array.isArray(d.esami)) a.esami = d.esami.filter((x) => typeof x === "string" && /^[\w]{1,16}:[\w]{1,16}$/.test(x)).slice(0, 40);
  if ("quesito" in d) a.quesito = ponteTesto(d.quesito, 300);
  if ("mio" in d) a.mio = !!d.mio;
  return a;
}
async function ponteComando(s, d) {
  if (!d || typeof d !== "object" || !Number.isSafeInteger(d.id) || typeof d.cmd !== "string") return ponteScarto("contenuto");
  s.ultimo = ponteOra(); s.n++;
  const rispondi = (r) => ponteInvia(s, { re: d.id, ...r });
  try {
    if (d.cmd === "ciao") return rispondi({ ok: true, dati: { scade: pt.coppia.scade, inattivoMin: PONTE_INATTIVO / 60e3 } });
    if (d.cmd === "esci") { await rispondi({ ok: true }); return ponteFine("chiusa dall'iPhone"); }
    if (d.cmd === "ordini") return rispondi({ ok: true, dati: await ponteOrdiniMemo() });
    if (d.cmd === "aggiornaValori") return rispondi(await ponteAggiornaValori(ponteArgomenti(d)));
    if (["pazienti", "esiti", "richieste", "nota", "promemoria", "fatto", "ordina"].includes(d.cmd)) {
      const a = ponteArgomenti(d);
      // il numero dell'ordine lo dà il PC: rimandato a un'altra scheda, resta lo stesso ordine
      if (d.cmd === "ordina") a.id = `tel${ponteOra().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const r = await ponteSuScheda(d.cmd, a);
      if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
      if (d.cmd === "ordina" && r.ok) await ponteSegnaOrdini(r.dati.ordini || []);
      return rispondi(r);
    }
    return rispondi({ ok: false, errore: "Comando sconosciuto" });
  } catch (e) {
    return rispondi({ ok: false, errore: "Errore sul PC: " + corto(e && e.message || e, 80) });
  }
}

// Le schede del gestionale che possono eseguire: non quelle di un ordine o
// dei valori in sottofondo; prima quella davanti al medico.
async function ponteSchede() {
  const lavoro = new Set((await ordLeggi()).filter((x) => x.worker != null).map((x) => x.worker));
  for (const id of pt.valori.keys()) lavoro.add(id);
  const tutte = (await chrome.tabs.query({}).catch(() => [])).filter((t) => sulGestionale(t.url) && !t.discarded && !lavoro.has(t.id));
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const peso = (t) => (t.active ? 2 : 0) + (win && t.windowId === win.id ? 1 : 0);
  return tutte.sort((a, b) => peso(b) - peso(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
}
async function ponteSuScheda(cmd, args) {
  const tempo = { ordina: 25e3, esiti: 30e3 }[cmd] || 10e3;
  const schede = await ponteSchede();
  if (!schede.length) return { ok: false, errore: "Apri il gestionale sul PC", senzaGestionale: true };
  const no = new Set();
  for (const t of schede) {
    const r = await Promise.race([chrome.tabs.sendMessage(t.id, { t: "ponteEsegui", cmd, args }).catch(() => null), attendi(tempo, null)]);
    if (!r) continue;
    if (r.no) { no.add(r.no); continue; }
    return r;
  }
  if (no.has("login")) return { ok: false, errore: "Gestionale da riaprire: sul PC la sessione è scaduta", sessione: true };
  if (no.has("pannello")) return { ok: false, errore: "Sul PC apri la lista del pronto soccorso o un paziente, nel gestionale" };
  return { ok: false, errore: "Il gestionale sul PC non risponde: ricarica la sua pagina" };
}

// «Aggiorna i valori»: lo stesso «⭳ Carica i valori» del pannello, in una
// scheda di sottofondo sulla pagina del paziente — il suo indirizzo, quello
// che il gestionale stesso ha dato —, che si chiude da sola. Poi gli esiti
// rifatti da capo.
async function ponteAggiornaValori(a) {
  const r = await ponteSuScheda("aggiornaValori", a);
  if (!r.ok) return r;
  if (r.registro) ponteNota(r.registro);
  const fatto = await ponteValoriSotto(r.dati.url, a.ep);
  ponteNota(`Valori di ${corto(r.dati.paziente, 40) || "un paziente"}: ${fatto.testo}`);
  await ponteScriviStato();
  if (!fatto.ok) return { ok: false, errore: fatto.testo };
  const e = await ponteSuScheda("esiti", a);
  delete e.registro;
  return e;
}
async function ponteValoriSotto(url, ep) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, testo: "indirizzo del paziente non valido" }; }
  if (!leggibileOrd(url) || u.searchParams.get("EPISODIO_ID") !== ep) {
    return { ok: false, testo: "indirizzo del paziente inatteso" };
  }
  for (const v of pt.valori.values()) if (v.ep === ep) return v.promessa;   // già in lettura
  const davanti = (await ponteSchede())[0];
  const vuota = { url: "about:blank", active: false };
  const t = await chrome.tabs.create(davanti ? { ...vuota, windowId: davanti.windowId, index: davanti.index + 1 } : vuota)
    .catch(() => chrome.tabs.create(vuota));
  let risolvi;
  const promessa = new Promise((r) => { risolvi = r; });
  const rec = { ep, risolvi, promessa };
  pt.valori.set(t.id, rec);
  const tempo = setTimeout(() => risolvi({ ok: false, testo: "i valori non sono arrivati in tempo" }), PONTE_VALORI_MAX);
  try {
    await chrome.tabs.update(t.id, { url: u.href, autoDiscardable: false });
  } catch {
    risolvi({ ok: false, testo: "la scheda dei valori non si apre" });
  }
  const esito = await promessa;
  clearTimeout(tempo);
  pt.valori.delete(t.id);
  const ora = await chrome.tabs.get(t.id).catch(() => null);
  if (ora && !ora.active) await chrome.tabs.remove(t.id).catch(() => {});
  return esito;
}
// bg.js lo chiede quando una scheda domanda «chi sono?»
function ponteLavoroDi(tabId) {
  const v = pt.valori.get(tabId);
  return v ? { ponteValori: { ep: v.ep } } : {};
}
chrome.tabs.onRemoved.addListener((id) => {
  const v = pt.valori.get(id);
  if (v) v.risolvi({ ok: false, testo: "la scheda dei valori è stata chiusa" });
});

// ------------------------------------------- gli ordini partiti dal telefono
// L'ordine fa il giro di sempre (scheda di sottofondo, controlli, conferma,
// etichette): qui lo si guarda passare in `ordini` e si racconta al telefono.
const PONTE_FINALI = new Set(["stampate", "avviso", "errore", "chiusa", "interrotto", "tolto", "perso"]);
function ponteStatoOrdine(m, rec) {
  const base = { id: m.id, ep: m.ep, paziente: m.paziente, n: m.n, rx: !!m.rx, ts: m.ts };
  const da = (stato, tono, titolo, testo, extra = {}) => ({ ...base, stato, tono, titolo, testo: corto(testo, 200), fine: PONTE_FINALI.has(stato), ...extra });
  if (!rec) {
    if (m.stato === "stampa") return da("stampate", "ok", "Confermata", "Etichette mandate alla stampa sul PC");
    if (m.stato === "coda") return da("tolto", "warn", "Tolto dalla coda", "Tolto dalla coda sul PC: niente inviato");
    if (m.fine) return m;
    if (!m.stato) return da("avvio", "run", "Parte", "Apro la scheda dell'ordine sul PC…");
    return da("perso", "warn", "Da controllare", "L'ordine non risulta più sul PC: guarda il carrello prima di rifarlo");
  }
  const v = rec.vista || {}, r = rec.resto || {};
  const resto = [r.mancano && r.mancano.length ? `Mancano: ${r.mancano.join(", ")}` : "",
    r.controllare && r.controllare.length ? `Da controllare: ${r.controllare.join(", ")}` : ""].filter(Boolean).join(" · ");
  switch (rec.stato) {
    case "coda": return da("coda", "run", "In coda", "Parte quando finisce l'ordine in corso sul PC");
    case "avvio": return da("avvio", "run", "Parte", "Apro la scheda dell'ordine sul PC…");
    case "corre":
      if (rec.muto) return da("corre", "warn", "Il PC non risponde", "La scheda dell'ordine tace: guarda il PC");
      return da("corre", "run", v.badge || v.tag || "In corso", [v.tag && v.badge ? v.tag : "", v.testo].filter(Boolean).join(" · ") || "…");
    case "stampa": return da("stampa", "ok", "Confermata", "Etichette pronte sul PC");
    case "avviso": return da("avviso", v.tono === "err" ? "err" : v.tono === "warn" ? "warn" : "ok", v.tag || "Fatto", v.testo || "", { dettaglio: corto(v.quesito, 120) });
    case "errore": return da("errore", "err", v.tag || "Errore", v.testo || "Da completare sul PC", { dettaglio: resto });
    case "chiusa": return da("chiusa", "err", "Scheda chiusa sul PC", resto || "Controlla il carrello sul PC");
    case "interrotto": return da("interrotto", "warn", "Interrotto", v.testo || "Controlla il carrello sul PC", { dettaglio: resto });
    default: return da(rec.stato, "run", v.tag || "…", v.testo || "");
  }
}
async function ponteOrdiniMemo() {
  const l = (await chrome.storage.session.get(PONTE_ORDINI))[PONTE_ORDINI];
  return (Array.isArray(l) ? l : []).filter((m) => ponteOra() - (m.ts || 0) < 6 * 3600e3);
}
let ponteFilaOrdini = Promise.resolve();
const ponteInFilaOrdini = (fn) => (ponteFilaOrdini = ponteFilaOrdini.then(fn, fn));
function ponteSegnaOrdini(nuovi) {
  return ponteInFilaOrdini(async () => {
    const memo = await ponteOrdiniMemo();
    for (const o of nuovi) {
      if (!o || typeof o.id !== "string" || memo.some((m) => m.id === o.id)) continue;
      memo.push({ id: o.id, ep: corto(o.ep, 40), paziente: corto(o.paziente, 60), n: Number(o.n) || 0, rx: !!o.rx, ts: ponteOra(), stato: "", fine: false });
    }
    await ponteAggiornaOrdini(memo, await ordLeggi());
  });
}
async function ponteAggiornaOrdini(memo, l) {
  let cambiato = false;
  for (let i = 0; i < memo.length; i++) {
    if (memo[i].fine) continue;
    const nuovo = ponteStatoOrdine(memo[i], l.find((x) => x.id === memo[i].id));
    if (JSON.stringify(nuovo) === JSON.stringify(memo[i])) continue;
    memo[i] = nuovo; cambiato = true;
    await ponteInvia(pt.sessione, { evento: "ordine", ordine: nuovo });
  }
  if (cambiato) await chrome.storage.session.set({ [PONTE_ORDINI]: memo.slice(-20) });
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "session" || !ch.ordini) return;
  const l = Array.isArray(ch.ordini.newValue) ? ch.ordini.newValue : [];
  ponteInFilaOrdini(async () => {
    const memo = await ponteOrdiniMemo();
    if (memo.some((m) => !m.fine)) await ponteAggiornaOrdini(memo, l);
  }).catch(() => {});
});

// --------------------------------------------- le pagine dell'estensione e del gestionale
function ponteDaPagina(msg, sender, reply) {
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string" || !msg.t.startsWith("ponte")) return;
  const estensione = !!sender && typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
  const gestionale = !!sender && !!sender.tab && sulGestionale(sender.url);
  const fai = (fn) => {
    ponteCaricato.then(fn).then(reply, (e) => reply({ ok: false, why: corto(e && e.message || e, 80) }));
    return true;
  };
  if (msg.t === "ponteSveglia" && (estensione || gestionale)) return fai(async () => { await ponteAvvia(); return { ok: true }; });
  if (msg.t === "ponteScollega" && (estensione || gestionale)) return fai(async () => { await ponteFine("scollegata dal PC"); return { ok: true }; });
  if (msg.t === "ponteApri" && gestionale) {
    return fai(async () => {
      const t = sender.tab;
      await chrome.tabs.create({ url: chrome.runtime.getURL("ponte.html"), windowId: t.windowId, index: t.index + 1 })
        .catch(() => chrome.tabs.create({ url: chrome.runtime.getURL("ponte.html") }));
      return { ok: true };
    });
  }
  if (msg.t === "ponteValoriFatto" && gestionale) {
    const v = pt.valori.get(sender.tab.id);
    if (v) v.risolvi({ ok: !!msg.ok, testo: corto(msg.testo, 120) || (msg.ok ? "letti" : "non letti") });
    reply({ ok: !!v });
    return;
  }
  // da qui, solo le pagine dell'estensione: la chiave (nel QR) non va mai a una pagina web
  if (!estensione) return reply({ ok: false, why: "non da qui" }), undefined;
  if (msg.t === "ponteStato") return fai(async () => ({ ok: true, stato: pontePubblico(), qr: ponteQr() }));
  if (msg.t === "ponteHost") {
    return fai(async () => {
      const o = ponteOrigine(msg.host);
      if (o === null) return { ok: false, why: "Serve l'indirizzo di un sito https:// (per esempio https://nome.workers.dev)." };
      if (o !== pt.host) await ponteFine("indirizzo cambiato");
      await chrome.storage.local.set({ [PONTE_HOST]: o });
      ponteNota(o ? `Indirizzo del ponte: ${o}` : "Indirizzo del ponte tolto");
      await ponteAvvia();
      return { ok: true, host: o };
    });
  }
  if (msg.t === "ponteAssocia") {
    return fai(async () => {
      if (!pt.host) return { ok: false, why: "Prima scrivi l'indirizzo del ponte." };
      await ponteFine("nuova associazione");
      const k = PonteCripto.casuale(32);
      const ora = ponteOra();
      await chrome.storage.local.set({ [PONTE_COPPIA]: { k: PonteCripto.b64u(k), scade: ora + PONTE_DURATA, creata: ora } });
      ponteNota(`Nuovo QR: vale fino alle ${hhmmPonte(ora + PONTE_DURATA)}`);
      await ponteAvvia();
      return { ok: true, qr: ponteQr(), stato: pontePubblico() };
    });
  }
  if (msg.t === "ponteRevoca") {
    return fai(async () => {
      await ponteFine("revocata");
      await chrome.storage.local.remove(PONTE_COPPIA);
      ponteNota("Associazione revocata: l'iPhone non entra più");
      await ponteAvvia();
      return { ok: true, stato: pontePubblico() };
    });
  }
  reply({ ok: false, why: "richiesta sconosciuta" });
}
chrome.runtime.onMessage.addListener(ponteDaPagina);
chrome.runtime.onStartup?.addListener(() => { ponteAvvia().catch(() => {}); });

// All'avvio del service worker: una sessione di prima non c'è più (le sue
// chiavi stavano in memoria). Lo si dice, e la presa si riapre.
const ponteCaricato = (async () => {
  const s = (await chrome.storage.session.get(PONTE_STATO))[PONTE_STATO];
  pt.registro = Array.isArray(s && s.registro) ? s.registro : [];
  if (s && s.sessione) {
    pt.fine = { perche: "riavvio", ts: ponteOra() };
    ponteNota(`Sessione con l'iPhone chiusa: ${PONTE_PERCHE.riavvio}`);
  }
  await ponteAvvia();
})().catch(() => {});
