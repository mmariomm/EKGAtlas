/*
 * PS Assist — il PONTE verso l'iPhone, nel service worker (importato da bg.js).
 *
 * Il medico lascia il PC per qualche minuto e dal telefono vuole vedere i
 * pazienti, i loro esiti, ordinare esami, scrivere una nota o un promemoria.
 * Tutto succede QUI, sul PC, col gestionale aperto e col codice di sempre: il
 * telefono manda una domanda, una scheda del gestionale la esegue e risponde.
 *
 * Come si parlano: una presa WebSocket in uscita (wss://, porta 443) verso il
 * ripetitore del ponte (/ponte/ws), che passa i messaggi fra le due prese di
 * una «stanza» senza leggerli né tenerli. I messaggi sono cifrati da un capo
 * all'altro (ponte-cripto.js): la chiave sta solo qui e sul telefono, che l'ha
 * presa dal QR. Il ripetitore vede byte, orari, misure e gli indirizzi IP: mai
 * un nome, un esame, un valore. Il suo indirizzo è fissato nella build
 * (ponte-host.js, da ponte/host.txt): nessuna pagina lo cambia.
 *
 * La chiave sta in storage.local fino alla sua scadenza (14 ore): un turno,
 * anche se il browser si chiude e si riapre. Il QR si rivede solo nei primi
 * due minuti e solo finché nessun telefono è entrato; il primo che entra è
 * quello dell'associazione, e un altro telefono con lo stesso QR non entra.
 *
 * Perché la presa sta nel service worker: da Chrome 116 una WebSocket che
 * manda o riceve almeno ogni 30 secondi lo tiene sveglio (qui un battito ogni
 * 20, e se il «pong» non torna entro 10 secondi la presa si rifà), ed è la
 * strada indicata da Chrome. Se il service worker si ferma lo stesso, la
 * sessione muore con le sue chiavi — che stanno solo in memoria — e il
 * telefono ne apre una nuova: lo sveglia la prima pagina del gestionale che
 * chiede (ponteSveglia).
 *
 * La sessione finisce dopo 20 minuti senza comandi del medico, con «Scollega»
 * sul PC, con la revoca, alla scadenza dell'associazione (14 ore), col riavvio
 * dell'estensione, o quando una scheda del gestionale torna alla pagina
 * d'accesso (l'associazione no: rientrati nel gestionale, il telefono riapre).
 * Mentre è aperta, ogni scheda del gestionale lo dice nell'intestazione del
 * pannello: «iPhone collegato · Scollega».
 */
/* global PonteCripto, PONTE_HOST_FISSO, ordLeggi, sulGestionale, leggibileOrd, corto */

const PONTE_HOST_PROVA = "ponte.host";      // storage.local: solo per le prove, e solo verso questo PC
const PONTE_COPPIA = "ponte.coppia";        // storage.local: { k, scade, creata, usata, dev, nTel }
const PONTE_STATO = "ponte";                // storage.session: quello che le pagine mostrano
const PONTE_ORDINI = "ponte.ordini";        // storage.session: gli ordini partiti dal telefono
const PONTE_VALORI = "ponte.valori";        // storage.session: le schede aperte per «Aggiorna i valori»
const PONTE_DURATA = 14 * 3600e3;           // un'associazione dura un turno lungo
const PONTE_INATTIVO = 20 * 60e3;           // senza comandi del medico, la sessione si chiude
const PONTE_BATTITO = 20e3;                 // la presa parla almeno ogni 20 secondi
const PONTE_QR_MAX = 2 * 60e3;              // il QR si rivede solo per poco
const PONTE_SALUTO_MAX = 2 * 60e3;          // un saluto senza seguito si dimentica
const PONTE_VALORI_MAX = 150e3;             // «Aggiorna i valori» non aspetta di più
const PONTE_FRAME_MAX = (1 << 20) - 4096;   // il ripetitore non passa messaggi più grandi
// quanto si aspetta una scheda del gestionale, e il «pong» (i test li accorciano)
const PONTE_ATTESA = { ordina: 25e3, esiti: 30e3, altro: 10e3, pong: 10e3 };
// Perché una sessione finisce: la frase, la stessa qui, sulla pagina iPhone e sul telefono.
const PONTE_PERCHE = {
  inattivo: "20 minuti senza comandi", "scollegata dal PC": "Chiusa dal PC con «Scollega»",
  revocata: "Associazione revocata dal PC", scaduta: "Associazione scaduta", "nuova associazione": "Sul PC c'è un QR nuovo",
  "chiusa dall'iPhone": "Chiusa dall'iPhone", riavvio: "L'estensione sul PC si è riavviata",
  login: "Il gestionale sul PC è tornato alla pagina d'accesso",
};
const ponteFrase = (perche) => PONTE_PERCHE[perche] || corto(perche, 80) || "Sessione chiusa";

const pt = {
  host: "", coppia: null, k: null, chiavi: null, codice: "", chiaviDi: "",
  ws: null, wsUrl: "", relay: "spento", pari: false, tentativi: 0, tRiprova: 0, tPong: 0,
  attesa: null,        // { canale, ts, dev, nTel }: un saluto ricevuto, la sessione nuova che aspetta il primo messaggio
  sessione: null,      // { canale, dal, ultimo, n }
  ripartito: 0, rifiuto: 0, fine: null, registro: [],
  valori: new Map(),   // scheda → { ep, risolvi, promessa }: chi aspetta «Aggiorna i valori», qui
  inVolo: new Map(),   // "tel"+oid → l'ordine che una scheda sta ancora preparando
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
async function ponteScriviCoppia(c) {
  pt.coppia = c;
  await chrome.storage.local.set({ [PONTE_COPPIA]: c });
}

// L'indirizzo del ponte viene dalla build. Per le prove, e solo verso questo
// PC (http://localhost), storage.local lo può sostituire.
async function ponteIndirizzo() {
  const prova = String((await chrome.storage.local.get(PONTE_HOST_PROVA))[PONTE_HOST_PROVA] || "");
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(prova)) return prova;
  return typeof PONTE_HOST_FISSO === "string" ? PONTE_HOST_FISSO : "";
}
// Il QR si rivede solo nei primi due minuti, e solo finché nessun telefono è
// entrato: dopo, «Associa» fa una chiave nuova.
const ponteQr = () => (pt.host && pt.coppia && !pt.coppia.usata && ponteOra() - pt.coppia.creata < PONTE_QR_MAX
  ? `${pt.host}/ponte/#${PonteCripto.frammento(pt.k, pt.coppia.scade)}` : "");

// ---------------------------------------------------------------- la presa
// Una alla volta: le schede che svegliano, un QR nuovo e un nuovo tentativo
// possono chiederlo insieme, e una chiave vecchia non deve arrivare per ultima.
let ponteFilaAvvio = Promise.resolve();
const ponteAvvia = () => (ponteFilaAvvio = ponteFilaAvvio.then(ponteAvviaOra, ponteAvviaOra));
async function ponteAvviaOra() {
  pt.host = await ponteIndirizzo();
  let c = (await chrome.storage.local.get(PONTE_COPPIA))[PONTE_COPPIA] || null;
  if (c && ponteOra() >= c.scade) {
    await chrome.storage.local.remove(PONTE_COPPIA);
    ponteNota(`Associazione con l'iPhone scaduta alle ${hhmmPonte(c.scade)}`);
    c = null;
  }
  if (c && pt.chiaviDi !== c.k) {
    try {
      pt.k = PonteCripto.daB64u(c.k);
      pt.chiavi = await PonteCripto.chiaviCoppia(pt.k);
      pt.codice = await PonteCripto.codice(pt.k);
      pt.chiaviDi = c.k;
    } catch {   // una chiave rovinata su disco non tiene fermo il ponte per sempre
      await chrome.storage.local.remove(PONTE_COPPIA);
      c = null;
    }
  }
  if (!c) { pt.coppia = null; pt.k = null; pt.chiavi = null; pt.codice = ""; pt.chiaviDi = ""; }
  else pt.coppia = c;
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
  ws.onmessage = (ev) => {
    if (pt.ws !== ws) return;
    if (ev.data === "pong") { clearTimeout(pt.tPong); pt.tPong = 0; return; }
    pt.fila = pt.fila.then(() => ponteRicevi(ev.data)).catch(() => {});
  };
  ws.onclose = (ev) => {
    if (pt.ws !== ws) return;
    pt.ws = null; pt.relay = "giu"; pt.pari = false;
    clearTimeout(pt.tPong); pt.tPong = 0;
    // un'altra presa del PC ha preso il posto di questa: non si fa a gara ogni secondo
    if (ev && ev.code === 4001) pt.tentativi = Math.max(pt.tentativi, 4);
    ponteScriviStato();
    ponteRiprova();
  };
}
function ponteStacca() {
  const ws = pt.ws;
  pt.ws = null; pt.wsUrl = ""; pt.pari = false;
  clearTimeout(pt.tPong); pt.tPong = 0;
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
// Il battito tiene sveglia la presa (e il service worker). Se il «pong» non
// torna, la presa è morta anche se sembra aperta (un proxy che la lascia
// cadere senza dirlo): se ne apre un'altra subito. Intanto, i conti.
function ponteBattito() {
  const ws = pt.ws;
  if (ws && ws.readyState === 1 && !pt.tPong) {
    ws.send("ping");
    pt.tPong = setTimeout(() => {
      pt.tPong = 0;
      if (pt.ws !== ws) return;
      ponteStacca();
      ponteConnetti();
    }, PONTE_ATTESA.pong);
  }
  ponteControlla().catch(() => {});
}
setInterval(ponteBattito, PONTE_BATTITO);

// Scadenze: la sessione dopo 20 minuti senza comandi, l'associazione alla sua
// ora, un saluto rimasto a metà, una scheda dei valori che non ha finito.
// (Con un nome: i test la chiamano con l'orologio avanti.)
async function ponteControlla() {
  const ora = ponteOra();
  for (const [id, v] of Object.entries(await ponteValoriTutti())) {
    if (ora - v.ts > PONTE_VALORI_MAX + 5e3) await ponteValoriFine(Number(id), { ok: false, testo: "i valori non sono arrivati in tempo" });
  }
  if (pt.coppia && ora >= pt.coppia.scade) {
    const scade = pt.coppia.scade;
    await ponteFine("scaduta");
    await chrome.storage.local.remove(PONTE_COPPIA);
    ponteNota(`Associazione con l'iPhone scaduta alle ${hhmmPonte(scade)}`);
    await ponteAvvia();
    return;
  }
  if (pt.sessione && ora - pt.sessione.ultimo >= PONTE_INATTIVO) await ponteFine("inattivo");
  if (pt.attesa && ora - pt.attesa.ts > PONTE_SALUTO_MAX) pt.attesa = null;
}

// ------------------------------------------------------- i messaggi in arrivo
// Quello che non si apre con le nostre chiavi si ignora e basta: senza le
// chiavi nessuno può far chiudere una sessione, né far scartare un messaggio buono.
async function ponteRicevi(dati) {
  if (typeof dati === "string") {
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
}
// Il telefono apre una sessione: il suo numero casuale, il nostro, le chiavi
// nuove. La sessione di prima (se c'è) resta finché la nuova non parla: un
// saluto ripetuto da qualcun altro non chiude niente.
async function ponteSaluto(b) {
  let m, nTel;
  try {
    m = (await PonteCripto.apri(pt.chiavi.salutoTel, b, PonteCripto.TIPO.SALUTO_TEL)).dati;
    nTel = PonteCripto.daB64u(m.n);
  } catch { return; }
  if (m.v !== 1 || nTel.length !== 16 || typeof m.dev !== "string" || !/^[\w-]{16,32}$/.test(m.dev)) return;
  // L'associazione è del primo telefono che è entrato: un altro, anche con lo
  // stesso QR, si sente dire di no (e il registro lo dice, una volta al minuto).
  if (pt.coppia.dev && m.dev !== pt.coppia.dev) {
    if (ponteOra() - pt.rifiuto > 60e3) {
      pt.rifiuto = ponteOra();
      ponteNota("Un altro telefono ha provato a entrare con il QR: rifiutato");
      await ponteScriviStato();
    }
    ponteManda(await PonteCripto.sigilla(pt.chiavi.salutoPc, PonteCripto.TIPO.SALUTO_PC, 0, { v: 1, eco: m.n, no: "altro telefono" }));
    return;
  }
  const nPc = PonteCripto.casuale(16);
  pt.attesa = { canale: PonteCripto.canalePc(await PonteCripto.chiaviSessione(pt.k, nTel, nPc)), ts: ponteOra(), dev: m.dev, nTel: m.n };
  ponteManda(await PonteCripto.sigilla(pt.chiavi.salutoPc, PonteCripto.TIPO.SALUTO_PC, 0,
    { v: 1, n: PonteCripto.b64u(nPc), eco: m.n, scade: pt.coppia.scade }));
}
async function ponteDati(b) {
  if (pt.sessione) {
    try {
      ponteComando(pt.sessione, await pt.sessione.canale.decifra(b));
      return;
    } catch (e) {
      if (e.codice === "ripetuto") return;   // decifrato, e già visto: si ignora
    }
  }
  if (pt.attesa) {
    try {
      const d = await pt.attesa.canale.decifra(b);
      // il primo messaggio della sessione nuova: adesso è lei
      const a = pt.attesa, nuova = !pt.sessione;
      pt.sessione = { canale: a.canale, dal: ponteOra(), ultimo: ponteOra(), n: 0 };
      pt.attesa = null; pt.fine = null;
      // il telefono dell'associazione è questo (il primo che entra), e il QR
      // non si rivede più; il numero del suo saluto lega un eventuale «riparti»
      await ponteScriviCoppia({ ...pt.coppia, dev: pt.coppia.dev || a.dev, usata: true, nTel: a.nTel });
      ponteNota(nuova ? "iPhone collegato" : "iPhone ricollegato: sessione nuova");
      await ponteScriviStato();
      ponteComando(pt.sessione, d);
      return;
    } catch { /* né l'una né l'altra */ }
  }
  // Nessuna sessione qui (l'estensione si è riavviata, o è stata chiusa): il
  // telefono lo deve sapere, o aspetterebbe risposte che non arrivano.
  if (!pt.sessione && !pt.attesa) return ponteRiparti();
}
// «Riparti» porta il numero del saluto dell'ultima sessione: il telefono lo
// accetta solo per quella, e ripetuto più tardi non chiude niente.
async function ponteRiparti() {
  if (ponteOra() - pt.ripartito < 2000 || !pt.coppia.nTel) return;
  pt.ripartito = ponteOra();
  const perche = (pt.fine && pt.fine.perche) || "riavvio";
  ponteManda(await PonteCripto.sigilla(pt.chiavi.salutoPc, PonteCripto.TIPO.SALUTO_PC, 0,
    { v: 1, riparti: true, eco: pt.coppia.nTel, perche, testo: ponteFrase(perche) }));
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
  pt.fine = { perche, testo: ponteFrase(perche), ts: ponteOra() };
  ponteNota(`Sessione con l'iPhone chiusa — ${pt.fine.testo}`);
  try { ponteManda(await s.canale.cifra({ evento: "fine", perche, testo: pt.fine.testo })); } catch { /* la presa è giù: lo saprà dal «riparti» */ }
  await ponteScriviStato();
}
// Revoca: la chiave se ne va.
async function ponteVia(perche, nota) {
  await ponteFine(perche);
  await chrome.storage.local.remove(PONTE_COPPIA);
  ponteNota(nota);
  await ponteAvvia();
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
// quelli che l'app manda da sé: non sono il medico, non tengono aperta la sessione
const PONTE_DA_SE = new Set(["ciao", "ordini"]);
async function ponteComando(s, d) {
  if (!d || typeof d !== "object" || !Number.isSafeInteger(d.id) || typeof d.cmd !== "string") return;
  if (!d.auto && !PONTE_DA_SE.has(d.cmd)) s.ultimo = ponteOra();
  s.n++;
  const rispondi = (r) => ponteInvia(s, { re: d.id, ...r });
  try {
    if (d.cmd === "ciao") return rispondi({ ok: true, dati: { scade: pt.coppia.scade, inattivoMin: PONTE_INATTIVO / 60e3 } });
    if (d.cmd === "esci") { await rispondi({ ok: true }); return ponteFine("chiusa dall'iPhone"); }
    if (d.cmd === "ordini") return rispondi({ ok: true, dati: await ponteOrdiniTel() });
    if (d.cmd === "aggiornaValori") return rispondi(await ponteAggiornaValori(ponteArgomenti(d)));
    if (d.cmd === "ordina") return rispondi(await ponteOrdina(d));
    if (["pazienti", "esiti", "richieste", "nota", "promemoria", "fatto"].includes(d.cmd)) {
      const r = await ponteSuScheda(d.cmd, ponteArgomenti(d));
      if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
      return rispondi(r);
    }
    return rispondi({ ok: false, errore: "Comando sconosciuto" });
  } catch (e) {
    return rispondi({ ok: false, errore: "Errore sul PC: " + corto(e && e.message || e, 80) });
  }
}

// L'ordine. Il numero lo fa il telefono quando arma «Conferma» (oid): la
// stessa conferma rimandata — la risposta si era persa — è lo stesso ordine,
// e bg.js lo manda una volta sola (ordiniVisti). Finché una scheda lo prepara
// il telefono lo vede «in preparazione»; se la scheda tarda oltre l'attesa ma
// l'ordine nasce lo stesso, il telefono lo vede nascere.
async function ponteOrdina(d) {
  if (typeof d.oid !== "string" || !/^[\w-]{8,24}$/.test(d.oid)) return { ok: false, errore: "Ordine senza numero: ricarica il pannello sul telefono" };
  const a = { ...ponteArgomenti(d), id: "tel" + d.oid };
  const suoi = (l) => l.filter((m) => m.id === a.id + "l" || m.id === a.id + "r");
  const gia = pt.inVolo.get(a.id);
  if (gia) return { ok: true, dati: { ordini: [gia] } };
  const sp = { id: a.id, ep: a.ep || "", paziente: "", n: (a.esami || []).length, ts: ponteOra(), stato: "invio", tono: "run",
    titolo: "In preparazione", testo: "Il PC prepara l'ordine", dettaglio: "", fine: false, segnaposto: true };
  pt.inVolo.set(a.id, sp);
  let r;
  try { r = await ponteSuScheda("ordina", a); } finally { pt.inVolo.delete(a.id); }
  if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
  await ponteSegnaOrdini(r.ok ? r.dati.ordini || [] : []);
  const nati = suoi(await ponteOrdiniMemo());
  if (r.ok || nati.length) return { ok: true, dati: { ...(r.ok ? r.dati : {}), ordini: nati.length ? nati : r.dati.ordini } };
  // non partito, o non si sa: la sua carta (se il telefono l'aveva) lo dice
  ponteInvia(pt.sessione, { evento: "ordine", ordine: { ...sp, tono: r.incerto ? "warn" : "err", titolo: r.incerto ? "Da controllare" : "Non partito",
    testo: r.errore || "", fine: true } });
  return r;
}

// Le schede del gestionale che possono eseguire: non quelle di un ordine o
// dei valori in sottofondo; prima quella davanti al medico.
async function ponteSchede() {
  const lavoro = new Set((await ordLeggi()).filter((x) => x.worker != null).map((x) => x.worker));
  for (const id of Object.keys(await ponteValoriTutti())) lavoro.add(Number(id));
  const tutte = (await chrome.tabs.query({}).catch(() => [])).filter((t) => sulGestionale(t.url) && !t.discarded && !lavoro.has(t.id));
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const peso = (t) => (t.active ? 2 : 0) + (win && t.windowId === win.id ? 1 : 0);
  return tutte.sort((a, b) => peso(b) - peso(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
}
// Una scheda che tace oltre l'attesa può star lavorando ancora: la risposta
// è «incerto» (per un ordine: non si sa se è partito), mai un no. Un ordine o
// un promemoria non si rimanda alla scheda dopo: quella di prima può averlo
// fatto, e sarebbero due.
const PONTE_UNA_VOLTA = new Set(["ordina", "promemoria"]);
async function ponteSuScheda(cmd, args) {
  const tempo = PONTE_ATTESA[cmd] || PONTE_ATTESA.altro;
  const schede = await ponteSchede();
  if (!schede.length) return { ok: false, errore: "Apri il gestionale sul PC", senzaGestionale: true };
  const no = new Set();
  for (const t of schede) {
    const r = await Promise.race([chrome.tabs.sendMessage(t.id, { t: "ponteEsegui", cmd, args }).catch(() => null), attendi(tempo, { no: "tempo" })]);
    if (r && !r.no) return r;
    no.add(r ? r.no : "assente");
    if (no.has("tempo") && PONTE_UNA_VOLTA.has(cmd)) break;
  }
  const incerto = no.has("tempo") ? { incerto: true } : {};
  if (incerto.incerto && cmd === "promemoria") return { ok: false, errore: "Il gestionale sul PC tarda: guarda i promemoria prima di rifarlo", incerto: true };
  if (no.has("login")) return { ok: false, errore: "Gestionale da riaprire: sul PC la sessione è scaduta", sessione: true, ...incerto };
  if (no.has("pannello") && !incerto.incerto) return { ok: false, errore: "Sul PC apri la lista del pronto soccorso o un paziente, nel gestionale" };
  return { ok: false, errore: "Il gestionale sul PC non risponde: ricarica la sua pagina", ...incerto };
}

// «Aggiorna i valori»: lo stesso «⭳ Carica i valori» del pannello, in una
// scheda di sottofondo sulla pagina del paziente — il suo indirizzo, quello
// che il gestionale stesso ha dato —, che si chiude da sola. Poi gli esiti
// rifatti da capo. La scheda è annotata in storage.session: anche se il
// service worker si ferma a metà, la si riconosce, scade e si chiude.
async function ponteAggiornaValori(a) {
  const r = await ponteSuScheda("aggiornaValori", a);
  if (!r.ok) return r;
  if (r.registro) ponteNota(r.registro);
  const fatto = await ponteValoriSotto(r.dati.url, a.ep);
  ponteNota(`Valori di ${corto(r.dati.paziente, 40) || "un paziente"}: ${fatto.testo}`);
  await ponteScriviStato();
  if (!fatto.ok) return { ok: false, errore: `Valori non aggiornati: ${fatto.testo}` };
  const e = await ponteSuScheda("esiti", a);
  delete e.registro;
  return e;
}
const ponteValoriTutti = async () => (await chrome.storage.session.get(PONTE_VALORI))[PONTE_VALORI] || {};
let ponteFilaValori = Promise.resolve();
// (una scrittura alla volta: due schede che finiscono insieme non si cancellano a vicenda)
const ponteValoriCambia = (fn) => (ponteFilaValori = ponteFilaValori.then(async () => {
  const v = await ponteValoriTutti();
  const r = fn(v);
  await chrome.storage.session.set({ [PONTE_VALORI]: v });
  return r;
}).catch(() => null));
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
  pt.valori.set(t.id, { ep, risolvi, promessa });
  // annotata PRIMA di andare sulla pagina: così la risposta a «chi sono?» c'è già
  await ponteValoriCambia((v) => { v[t.id] = { ep, ts: ponteOra() }; });
  const tempo = setTimeout(() => ponteValoriFine(t.id, { ok: false, testo: "i valori non sono arrivati in tempo" }), PONTE_VALORI_MAX);
  try {
    await chrome.tabs.update(t.id, { url: u.href, autoDiscardable: false });
  } catch {
    ponteValoriFine(t.id, { ok: false, testo: "la scheda dei valori non si apre" });
  }
  const esito = await promessa;
  clearTimeout(tempo);
  return esito;
}
// finita (letto, tempo scaduto, chiusa): via l'appunto, via la scheda (se il
// medico non la sta guardando), e la risposta a chi aspetta
async function ponteValoriFine(id, esito) {
  const w = pt.valori.get(id);
  pt.valori.delete(id);
  const c = await ponteValoriCambia((v) => { const c = v[id]; delete v[id]; return c; });
  if (!c && !w) return false;
  const t = await chrome.tabs.get(id).catch(() => null);
  if (t && !t.active) await chrome.tabs.remove(id).catch(() => {});
  if (w) w.risolvi(esito);
  return true;
}
// bg.js lo chiede quando una scheda domanda «chi sono?»
async function ponteLavoroDi(tabId) {
  const v = (await ponteValoriTutti())[tabId];
  return v ? { ponteValori: { ep: v.ep } } : {};
}
chrome.tabs.onRemoved.addListener((id) => { ponteValoriFine(id, { ok: false, testo: "la scheda dei valori è stata chiusa" }).catch(() => {}); });

// ------------------------------------------- gli ordini partiti dal telefono
// L'ordine fa il giro di sempre (scheda di sottofondo, controlli, conferma,
// etichette): qui lo si guarda passare in `ordini` e si racconta al telefono
// con le parole che bg.js scrive (`pubblico`, e `pubblico.tel` dove il telefono
// dice altro). Un ordine che sparisce da `ordini` (etichette prese da una
// scheda, ✕ sul PC) resta com'era l'ultima volta.
const PONTE_FINALI = new Set(["avviso", "errore", "chiusa", "interrotto"]);
function ponteStatoOrdine(m, rec) {
  const base = { id: m.id, ep: m.ep, paziente: m.paziente, n: m.n, rx: m.rx, ts: m.ts };
  if (!rec) {
    if (m.stato === "coda") return { ...base, stato: "tolto", tono: "warn", titolo: "Tolto dalla coda", testo: "Tolto dalla coda sul PC: niente inviato", dettaglio: "", fine: true };
    // sparito prima della conferma: non si sa che cosa è entrato
    if (["", "avvio", "corre"].includes(m.stato || "")) {
      return { ...base, stato: "perso", tono: "warn", titolo: "Da controllare", testo: "L'ordine non risulta più sul PC: guarda il carrello prima di rifarlo", dettaglio: "", fine: true };
    }
    // etichette in attesa che spariscono: una scheda del PC le ha prese per stamparle
    if (m.stato === "stampa") return { ...base, stato: "preso", tono: "ok", titolo: "Etichette prese in stampa sul PC", testo: "", dettaglio: "", fine: true };
    return { ...m, fine: true };
  }
  const p = { ...rec.pubblico, ...(rec.pubblico && rec.pubblico.tel) };
  return { ...base, stato: rec.stato, tono: p.tono || "run", titolo: corto(p.titolo, 80), testo: corto(p.testo, 200),
    dettaglio: corto(p.dettaglio, 240), fine: PONTE_FINALI.has(rec.stato) };
}
async function ponteOrdiniMemo() {
  const l = (await chrome.storage.session.get(PONTE_ORDINI))[PONTE_ORDINI];
  return (Array.isArray(l) ? l : []).filter((m) => ponteOra() - (m.ts || 0) < 6 * 3600e3);
}
// quello che il telefono vede: gli ordini, e quelli che una scheda sta ancora preparando
async function ponteOrdiniTel() {
  await ponteSegnaOrdini([]);
  return [...await ponteOrdiniMemo(), ...pt.inVolo.values()];
}
let ponteFilaOrdini = Promise.resolve();
const ponteInFilaOrdini = (fn) => (ponteFilaOrdini = ponteFilaOrdini.then(fn, fn));
const ponteMemo = (o) => ({ id: o.id, ep: corto(o.ep, 40), paziente: corto(o.paziente, 60), n: Number(o.n) || 0,
  rx: !!o.rx || /r$/.test(o.id), ts: ponteOra(), stato: "", fine: false });
function ponteSegnaOrdini(nuovi) {
  return ponteInFilaOrdini(async () => {
    const memo = await ponteOrdiniMemo();
    for (const o of nuovi) if (o && typeof o.id === "string" && !memo.some((m) => m.id === o.id)) memo.push(ponteMemo(o));
    await ponteAggiornaOrdini(memo, await ordLeggi());
  });
}
const ponteDelTelefono = (memo, l) => l.filter((x) => typeof x.id === "string" && x.id.startsWith("tel") && !memo.some((m) => m.id === x.id));
async function ponteAggiornaOrdini(memo, l) {
  // anche quelli nati da un comando la cui risposta si è persa: sono del telefono
  const adottati = ponteDelTelefono(memo, l);
  for (const o of adottati) memo.push(ponteMemo(o));
  let cambiato = adottati.length > 0;
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
    if (memo.some((m) => !m.fine) || ponteDelTelefono(memo, l).length) await ponteAggiornaOrdini(memo, l);
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
  // Una scheda del gestionale è sulla pagina d'accesso: senza il gestionale
  // il ponte non fa niente, e la sessione si chiude. L'associazione resta:
  // rientrati nel gestionale, il telefono riapre con un tocco, senza QR.
  if (msg.t === "ponteLogin" && gestionale) return fai(async () => { await ponteFine("login"); return { ok: true }; });
  if (msg.t === "ponteApri" && gestionale) {
    return fai(async () => {
      const t = sender.tab;
      await chrome.tabs.create({ url: chrome.runtime.getURL("ponte.html"), windowId: t.windowId, index: t.index + 1 })
        .catch(() => chrome.tabs.create({ url: chrome.runtime.getURL("ponte.html") }));
      return { ok: true };
    });
  }
  if (msg.t === "ponteValoriFatto" && gestionale) {
    return fai(async () => ({ ok: await ponteValoriFine(sender.tab.id, { ok: !!msg.ok, testo: corto(msg.testo, 120) || (msg.ok ? "letti" : "non letti") }) }));
  }
  // da qui, solo le pagine dell'estensione: la chiave (nel QR) non va mai a una pagina web
  if (!estensione) return reply({ ok: false, why: "non da qui" }), undefined;
  if (msg.t === "ponteStato") return fai(async () => ({ ok: true, stato: pontePubblico(), qr: ponteQr(), codice: pt.codice }));
  if (msg.t === "ponteAssocia") {
    return fai(async () => {
      if (!pt.host) return { ok: false, why: "Ponte da configurare: in questa versione di PS Assist manca il suo indirizzo." };
      await ponteFine("nuova associazione");
      const k = PonteCripto.casuale(32);
      const ora = ponteOra();
      await ponteScriviCoppia({ k: PonteCripto.b64u(k), scade: ora + PONTE_DURATA, creata: ora, usata: false, dev: "", nTel: "" });
      ponteNota(`Nuovo QR: vale fino alle ${hhmmPonte(ora + PONTE_DURATA)}`);
      await ponteAvvia();
      return { ok: true, qr: ponteQr(), codice: pt.codice, stato: pontePubblico() };
    });
  }
  if (msg.t === "ponteRevoca") {
    return fai(async () => {
      await ponteVia("revocata", "Associazione revocata: l'iPhone non entra più");
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
    pt.fine = { perche: "riavvio", testo: ponteFrase("riavvio"), ts: ponteOra() };
    ponteNota(`Sessione con l'iPhone chiusa — ${pt.fine.testo}`);
  }
  await ponteAvvia();
})().catch(() => {});
