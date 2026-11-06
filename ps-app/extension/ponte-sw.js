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
 * La sessione finisce dopo 3 minuti senza comandi del medico, con «Scollega»
 * sul PC, con la revoca, alla scadenza dell'associazione (14 ore), col riavvio
 * dell'estensione, o quando una scheda del gestionale torna alla pagina
 * d'accesso (l'associazione no: rientrati nel gestionale, il telefono riapre).
 * Mentre è aperta, ogni scheda del gestionale lo dice nell'intestazione del
 * pannello: «iPhone collegato · Scollega».
 */
/* global PonteCripto, PONTE_HOST_FISSO, ordLeggi, sulGestionale, leggibileOrd, corto, KEY, REF_TTL, stampaScelte, stampaDalTel, stampaTelVista */

const PONTE_HOST_PROVA = "ponte.host";      // storage.local: solo per le prove, e solo verso questo PC
const PONTE_COPPIA = "ponte.coppia";        // storage.local: { k, scade, creata, usata, dev, nTel, cambiata?, errori?, blocco?, cambi? }
const PONTE_STATO = "ponte";                // storage.session: quello che le pagine mostrano
const PONTE_ORDINI = "ponte.ordini";        // storage.session: gli ordini partiti dal telefono
const PONTE_VALORI = "ponte.valori";        // storage.session: le schede aperte per «Aggiorna i valori»
const PONTE_CARTELLE = "ponte.cartelle";    // storage.session: le schede aperte per salvare la cartella (solo { ep, ts })
const PONTE_CARTELLA = "ponte.cartella";    // storage.session: l'ultima lettura della cartella di ogni paziente (memoria, mai disco)
const PONTE_DURATA = 14 * 3600e3;           // un'associazione dura un turno lungo
const PONTE_INATTIVO = 3 * 60e3;            // senza comandi del medico, la sessione si chiude (il telefono si ricollega in un attimo)
const PONTE_ORDINE_MAX = 30e3;              // un ordine vale 30 secondi dal tocco sul telefono: arrivato dopo, non si fa
const PONTE_BATTITO = 20e3;                 // la presa parla almeno ogni 20 secondi
const PONTE_QR_MAX = 2 * 60e3;              // il QR si rivede solo per poco
const PONTE_SALUTO_MAX = 2 * 60e3;          // un saluto senza seguito si dimentica
const PONTE_VALORI_MAX = 150e3;             // «Aggiorna i valori» non aspetta di più
const PONTE_ALTROVE_MS = 5e3;               // finita su un'altra pagina: tanto si aspetta quella dopo
const PONTE_PAGINE = { PsoPazienti: "la lista dei pazienti", PsoPazientiAmbulatorio: "la lista dei pazienti", PsoPazientiTriage: "la lista del triage",
  PsoEpisodioClinicoTriage: "la pagina del triage", PsoPsoImposta: "la scelta dell'area", PsoPazientiSmart: "la lista dell'ospedale" };
const PONTE_CARTELLA_MAX = 60e3;            // salvare la cartella: aprire, controllare, «Conferma», rileggere
// i campi della cartella (modulo AmbulatorioPSO) che il telefono può chiedere di scrivere:
// se lo sono davvero lo dice la pagina, campo per campo (readonly, disabled)
const PONTE_CARTELLA_CAMPI = { ANAMNESI: "Anamnesi", MALATTIE_PREGRESSE: "Anamnesi remota", FARMACI_ASSUNTI: "Farmaci", ALLERGIE: "Allergie", ESAME_OBIETTIVO: "Esame obiettivo" };
const PONTE_FRAME_MAX = (1 << 20) - 4096;   // il ripetitore non passa messaggi più grandi
// «Cancella e riassocia» (dal telefono che trova il PC già associato): con questo
// codice il telefono prende il posto di quello di prima. Il codice sta SOLO qui.
// La vera protezione è la chiave del QR — senza, la richiesta nemmeno si apre:
// il 93 evita solo un cambio per sbaglio. Sbagliato 5 volte, per 10 minuti niente cambi.
const PONTE_CODICE_CAMBIO = "93";
const PONTE_CAMBIO_ERRORI = 5;
const PONTE_CAMBIO_BLOCCO = 10 * 60e3;
// quanto si aspetta una scheda del gestionale, e il «pong» (i test li accorciano)
const PONTE_ATTESA = { ordina: 25e3, esiti: 30e3, cartella: 30e3, altro: 10e3, pong: 10e3 };
// Perché una sessione finisce: la frase, la stessa qui, sulla pagina iPhone e sul telefono.
const PONTE_PERCHE = {
  inattivo: "3 minuti senza comandi", "scollegata dal PC": "Chiusa dal PC con «Scollega»",
  revocata: "Associazione revocata dal PC", scaduta: "Associazione scaduta", "nuova associazione": "Sul PC c'è un QR nuovo",
  "chiusa dall'iPhone": "Chiusa dall'iPhone", riavvio: "L'estensione sul PC si è riavviata",
  login: "Il gestionale sul PC è tornato alla pagina d'accesso",
  cambiato: "Un altro iPhone ha preso il posto di questo",
};
const ponteFrase = (perche) => PONTE_PERCHE[perche] || corto(perche, 80) || "Sessione chiusa";

const pt = {
  host: "", coppia: null, k: null, chiavi: null, codice: "", chiaviDi: "",
  ws: null, wsUrl: "", relay: "spento", pari: false, tentativi: 0, tRiprova: 0, tPong: 0,
  attesa: null,        // { canale, ts, dev, nTel }: un saluto ricevuto, la sessione nuova che aspetta il primo messaggio
  sessione: null,      // { canale, dal, ultimo, n }
  ripartito: 0, rifiuto: 0, fine: null, registro: [],
  valori: new Map(),   // scheda → { ep, risolvi, promessa }: chi aspetta «Aggiorna i valori», qui
  cartelle: new Map(), // scheda → { ep, fase, campi, risolvi }: una cartella da salvare (i testi solo qui, in memoria)
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
    cambiato: (pt.coppia && pt.coppia.cambiata) || 0,   // quando un altro iPhone ha preso il posto del primo
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
    ponteScriviStato();
    // (un'altra presa del PC ha preso il posto di questa: non si fa a gara ogni secondo)
    ponteRiprova(ev && ev.code === 4001);
  };
}
function ponteStacca() {
  const ws = pt.ws;
  pt.ws = null; pt.wsUrl = ""; pt.pari = false;
  clearTimeout(pt.tPong); pt.tPong = 0;
  pt.relay = pt.host && pt.coppia ? "giu" : "spento";
  if (ws) try { ws.close(1000, "fine"); } catch { /* già chiusa */ }
}
// Presto la prima volta, poi sempre più di rado fino a 15 secondi (col caso
// dentro: un ripetitore che torna non si vede arrivare tutti insieme).
function ponteRiprova(altrove = false) {
  clearTimeout(pt.tRiprova);
  if (!pt.host || !pt.coppia) return;
  const b = altrove ? 30e3 : Math.min(15e3, 1e3 * 2 ** Math.min(pt.tentativi++, 4));
  pt.tRiprova = setTimeout(() => ponteAvvia().catch(() => {}), Math.round(b / 2 + Math.random() * b / 2));
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

// Scadenze: la sessione dopo 3 minuti senza comandi, l'associazione alla sua
// ora, un saluto rimasto a metà, una scheda dei valori che non ha finito.
// (Con un nome: i test la chiamano con l'orologio avanti.)
async function ponteControlla() {
  const ora = ponteOra();
  for (const [id, v] of Object.entries(await ponteValoriTutti())) {
    if (ora - v.ts > PONTE_VALORI_MAX + 5e3) await ponteValoriFine(Number(id), { ok: false, testo: "i valori non sono arrivati in tempo" });
  }
  for (const [id, v] of Object.entries(await ponteCartelleTutte())) {
    if (ora - v.ts > PONTE_CARTELLA_MAX + 5e3) await ponteCartellaFine(Number(id), { ok: false, incerto: true, testo: "la scheda non ha finito in tempo" });
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
  // stesso QR, si sente dire di no (e il registro lo dice, una volta al minuto)
  // — a meno che chieda «Cancella e riassocia» col codice giusto: allora è lui.
  if (pt.coppia.dev && m.dev !== pt.coppia.dev) {
    const no = typeof m.cambio === "string" ? await ponteCambio(m) : { no: "altro telefono" };
    if (no) {
      if (no.no === "altro telefono" && ponteOra() - pt.rifiuto > 60e3) {
        pt.rifiuto = ponteOra();
        ponteNota("Un altro telefono ha provato a entrare con il QR: rifiutato");
        await ponteScriviStato();
      }
      ponteManda(await PonteCripto.sigilla(pt.chiavi.salutoPc, PonteCripto.TIPO.SALUTO_PC, 0, { v: 1, eco: m.n, ...no }));
      return;
    }
  }
  const nPc = PonteCripto.casuale(16);
  pt.attesa = { canale: PonteCripto.canalePc(await PonteCripto.chiaviSessione(pt.k, nTel, nPc)), ts: ponteOra(), dev: m.dev, nTel: m.n };
  // (con l'ora del PC: il telefono ne tiene lo scarto, e un ordine porta l'ora del tocco sull'orologio del PC)
  ponteManda(await PonteCripto.sigilla(pt.chiavi.salutoPc, PonteCripto.TIPO.SALUTO_PC, 0,
    { v: 1, n: PonteCripto.b64u(nPc), eco: m.n, scade: pt.coppia.scade, ora: ponteOra() }));
}
// «Cancella e riassocia»: la richiesta è un saluto (cifrato con la chiave del QR:
// senza, non si apre e non arriva qui) che porta il codice. Il codice si controlla
// QUI, sul PC. Giusto: il telefono di prima esce come con «Revoca» e un'associazione
// nuova — la scadenza resta la stessa — e questo è il telefono dell'associazione.
// Sbagliato: niente cambia; 5 sbagli e per 10 minuti non si cambia più.
// Ritorna null se il cambio è fatto, se no la risposta da dare.
async function ponteCambio(m) {
  const c = pt.coppia, ora = ponteOra();
  if (c.blocco && ora < c.blocco) return { no: "bloccato", fino: c.blocco };
  // un saluto già visto (rimandato dal ripetitore) non vale una seconda volta
  const cambi = (Array.isArray(c.cambi) ? c.cambi : []).slice(-7);
  if (cambi.includes(m.n)) return { no: "altro telefono" };
  cambi.push(m.n);
  if (m.cambio.trim() !== PONTE_CODICE_CAMBIO) {
    const errori = (c.errori || 0) + 1, blocca = errori >= PONTE_CAMBIO_ERRORI;
    await ponteScriviCoppia({ ...c, cambi, errori: blocca ? 0 : errori, blocco: blocca ? ora + PONTE_CAMBIO_BLOCCO : 0 });
    ponteNota(blocca ? `Codice sbagliato ${PONTE_CAMBIO_ERRORI} volte da un altro telefono: niente cambi fino alle ${hhmmPonte(ora + PONTE_CAMBIO_BLOCCO)}`
      : "Un altro telefono ha provato «Cancella e riassocia» con un codice sbagliato");
    await ponteScriviStato();
    return blocca ? { no: "bloccato", fino: ora + PONTE_CAMBIO_BLOCCO } : { no: "codice" };
  }
  await ponteFine("cambiato");
  await ponteScriviCoppia({ ...pt.coppia, cambi, dev: m.dev, usata: true, nTel: m.n, cambiata: ora, errori: 0, blocco: 0 });
  ponteNota(`iPhone cambiato alle ${hhmmPonte(ora)}: un altro telefono ha preso il posto`);
  await ponteScriviStato();
  return null;
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
  await chrome.storage.session.remove(PONTE_CARTELLA).catch(() => {});   // le cartelle lette per il telefono: via con la sessione
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
  if (d.rileggi) a.rileggi = true;
  return a;
}
// quelli che l'app manda da sé: non sono il medico, non tengono aperta la sessione
const PONTE_DA_SE = new Set(["ciao", "ordini"]);
const PONTE_RQ_MAX = 40;   // le scritture ricordate per sessione (in memoria, solo qui)
async function ponteComando(s, d) {
  if (!d || typeof d !== "object" || !Number.isSafeInteger(d.id) || typeof d.cmd !== "string") return;
  if (!d.auto && !PONTE_DA_SE.has(d.cmd)) s.ultimo = ponteOra();
  s.n++;
  const rispondi = (r) => ponteInvia(s, { re: d.id, ...r });
  // (il telefono che chiude per i 3 minuti e si riapre subito: il suo saluto nuovo, se è già qui, resta)
  if (d.cmd === "esci") { await rispondi({ ok: true }); const a = pt.attesa; await ponteFine("chiusa dall'iPhone"); if (a && pt.coppia) pt.attesa = a; return; }
  // Una scrittura porta il suo numero (rq): rimandata dal telefono dopo una
  // presa caduta, non si rifà — si risponde com'è andata, o, se sta ancora
  // andando, quando finisce. Le letture si rifanno e basta.
  const rq = typeof d.rq === "string" && /^[\w-]{8,40}$/.test(d.rq) ? d.rq : "";
  if (!rq) return rispondi(await ponteRisposta(s, d));
  s.rq = s.rq || new Map();
  let r = s.rq.get(rq);
  if (!r) {
    r = ponteRisposta(s, d);
    s.rq.set(rq, r);
    if (s.rq.size > PONTE_RQ_MAX) s.rq.delete(s.rq.keys().next().value);
  }
  return rispondi(await r);
}
async function ponteRisposta(s, d) {
  try {
    if (d.cmd === "ciao") return { ok: true, dati: { scade: pt.coppia.scade, inattivoMin: PONTE_INATTIVO / 60e3 } };
    if (d.cmd === "ordini") return { ok: true, dati: await ponteOrdiniTel() };
    if (d.cmd === "aggiornaValori") { const a = ponteArgomenti(d); return await ponteOffriPdf(s, await ponteAggiornaValori(a), a.ep); }
    if (d.cmd === "ordina") {
      // Un ordine arrivato più di 30 secondi dopo il tocco (rimasto in una presa
      // morta, ritardato per strada, rimandato tardi) non si fa: il telefono l'ha
      // già dato per scaduto. `nato` è l'ora del tocco, già sull'orologio del PC.
      const eta = ponteOra() - d.nato;
      if (!Number.isFinite(d.nato) || eta > PONTE_ORDINE_MAX || eta < -PONTE_ORDINE_MAX) {
        ponteNota("iPhone · un ordine arrivato tardi: scaduto, non fatto");
        await ponteScriviStato();
        return { ok: false, scaduto: true, errore: "Scaduta: non inviata" };
      }
      return await ponteOrdina(d);
    }
    if (d.cmd === "pdf") return await ponteDaiPdf(s, d);
    if (d.cmd === "stampa") return await ponteStampa(s, d);
    if (d.cmd === "cartella") return await ponteCartella(ponteArgomenti(d));
    if (d.cmd === "cartellaSalva") return await ponteCartellaSalva(d);
    if (["pazienti", "esiti", "richieste", "nota", "promemoria", "fatto"].includes(d.cmd)) {
      const a = ponteArgomenti(d);
      const r = await ponteSuScheda(d.cmd, a);
      if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
      return d.cmd === "esiti" ? await ponteOffriPdf(s, r, a.ep) : r;
    }
    return { ok: false, errore: "Comando sconosciuto" };
  } catch (e) {
    if (typeof segnaErrore === "function") segnaErrore("ponte", { comando: String(d && d.c || "").slice(0, 30), messaggio: corto(e && e.message || e, 120) });
    return { ok: false, errore: "Errore sul PC: " + corto(e && e.message || e, 80) };
  }
}

// I PDF dei referti salvati sul PC (la stessa copia che apre il visore del
// pannello: storage.local «ref:<id>», solo per l'episodio sotto cui è stata
// salvata). Il telefono li chiede a pezzi, dentro la stessa sessione cifrata:
// una risposta per pezzo, ognuna sotto il limite del ripetitore. Si offrono
// solo i referti che il pannello segna `pdf: true` — una copia salvata per
// questo episodio, non segnata come di un altro paziente (la lettura è dove lo
// si scopre: quella copia viene tolta, e comunque ogni pezzo la rilegge); vale
// anche per una TC o una visita, di cui il testo non si legge —, e si danno
// solo quelli offerti in questa sessione.
const PONTE_PDF_MAX = 15e6;                  // oltre, «aprilo sul PC»
const PONTE_PDF_PEZZO = 4 * 130000;          // caratteri base64 per risposta (≈ 390 KB): multiplo di 4
async function ponteCopia(ep, id) {
  if (!ep || typeof id !== "string") return null;
  const hit = (await chrome.storage.local.get(KEY(id)))[KEY(id)];
  if (!hit || typeof hit.data !== "string" || !/^JVBERi/.test(hit.data) || String(hit.ep || "") !== String(ep)) return null;
  if (Date.now() - (hit.ts || 0) > REF_TTL) return null;
  return hit.data;
}
const ponteMisura = (b) => Math.floor(b.length * 3 / 4) - (b.endsWith("==") ? 2 : b.endsWith("=") ? 1 : 0);
async function ponteOffriPdf(s, r, ep) {
  if (!r || !r.ok || !r.dati || !Array.isArray(r.dati.referti)) return r;
  s.pdf = s.pdf || new Set();
  for (const x of r.dati.referti) {
    if (!x || typeof x.id !== "string") continue;
    const offri = x.pdf === true;   // il pannello: c'è la copia, e non è di un altro paziente
    delete x.pdf;
    if (!offri) continue;
    const b = await ponteCopia(ep, x.id).catch(() => null);
    if (!b) continue;
    s.pdf.add(ep + "|" + x.id);
    x.pdf = ponteMisura(b);
  }
  return r;
}
async function ponteDaiPdf(s, d) {
  const ep = typeof d.ep === "string" ? d.ep : "", id = typeof d.ref === "string" ? d.ref : "";
  if (!Number.isSafeInteger(d.i) || d.i < 0 || !s.pdf || !s.pdf.has(ep + "|" + id)) return { ok: false, errore: "Referto non disponibile: riapri gli esiti" };
  const b = await ponteCopia(ep, id);
  if (!b) return { ok: false, errore: "Il PDF non è più sul PC" };
  const size = ponteMisura(b), n = Math.ceil(b.length / PONTE_PDF_PEZZO);
  if (size > PONTE_PDF_MAX) return { ok: false, errore: "PDF troppo grande: aprilo sul PC" };
  if (d.i >= n) return { ok: false, errore: "Il PDF non è più sul PC" };
  if (d.i === 0) { ponteNota("iPhone · un referto PDF aperto sul telefono"); await ponteScriviStato(); }
  return { ok: true, dati: { size, n, i: d.i, b: b.slice(d.i * PONTE_PDF_PEZZO, (d.i + 1) * PONTE_PDF_PEZZO) } };
}

// Un PDF dall'iPhone da stampare qui, sull'A4 (⋯ → «Stampa un PDF»): arriva a
// pezzi dentro la sessione cifrata, come i referti ma al contrario (`stampa`:
// rid, i, n, size, b). Si ricompone in memoria — solo qui, solo per questa
// sessione —, si controlla (la misura, «%PDF», 15 MB al massimo) e va al
// motore della stampa senza dialogo di bg.js (stampaDalTel): lo stesso
// giornale, una richiesta (rid) una stampa. Senza la stampa automatica, no:
// davanti al PC può non esserci nessuno. Il telefono sente com'è andata con
// le parole del motore; il registro del ponte lo annota.
const PONTE_STAMPA_ATTESA = 110e3;   // l'aiutante di stampa risponde entro 90 secondi
async function ponteStampa(s, d) {
  const male = { ok: false, errore: "PDF non arrivato bene: riprova" };
  const rid = typeof d.rid === "string" && /^[\w-]{8,24}$/.test(d.rid) ? d.rid : "";
  const { i, n, size, b } = d;
  if (!rid || ![i, n, size].every(Number.isSafeInteger) || i < 0 || n < 1 || n > 64 || i >= n || size < 1 || typeof b !== "string") return male;
  const no = (errore) => { s.stampe.delete(rid); ponteNota(`PDF dall'iPhone rifiutato: ${errore}`); ponteScriviStato(); return { ok: false, errore }; };
  s.stampe = s.stampe || new Map();
  if (i === 0) {
    // già chiesta (la risposta si era persa): com'è andata, e niente seconda stampa
    if (await stampaTelVista(rid)) { const { nota, ...p } = ponteStampaParole(await ponteStampaEsito(rid, 0)); return { ok: true, dati: p }; }
    if (size > PONTE_PDF_MAX) return no("PDF troppo grande: oltre 15 MB");
    let testa = "";
    try { testa = atob(b.slice(0, 8)); } catch { /* sotto */ }
    if (!testa.startsWith("%PDF")) return no("Non è un PDF: niente stampato");
    if (!(await stampaScelte())) return no("Sul PC la stampa automatica non è impostata");
    s.stampe.clear();   // una alla volta
    s.stampe.set(rid, { n, size, parti: [], lun: 0 });
  }
  const c = s.stampe.get(rid);
  if (!c || c.n !== n || c.size !== size || c.parti.length !== i || b.length > PONTE_PDF_PEZZO || (i < n - 1 && b.length % 4)
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(b) || (c.lun += b.length) > Math.ceil(PONTE_PDF_MAX / 3) * 4) { s.stampe.delete(rid); return male; }
  c.parti.push(b);
  if (i < n - 1) return { ok: true, dati: { i } };
  s.stampe.delete(rid);
  const pdf = c.parti.join("");
  c.parti = null;
  if (ponteMisura(pdf) !== size) return male;
  const r = await stampaDalTel(rid, pdf);
  if (!r.ok) return no(corto(r.why, 120));
  const rec = await ponteStampaEsito(rid, PONTE_STAMPA_ATTESA);
  const { nota, ...p } = ponteStampaParole(rec);
  if (!r.gia && nota) { ponteNota(nota); await ponteScriviStato(); }
  return { ok: true, dati: p };
}
// il foglio nel giornale delle stampe (bg.js), appena non si stampa più — o dopo `attesa`
async function ponteStampaEsito(rid, attesa) {
  const id = "pdftel" + rid, t0 = ponteOra();
  for (;;) {
    const rec = (await ordLeggi()).find((x) => x.id === id) || null;
    if (!rec || rec.stato !== "stampo" || ponteOra() - t0 >= attesa) return rec;
    await attendi(400);
  }
}
// com'è andata, con le parole del motore (`pubblico`): «Stampato su …», «Mandato a …» (in ambra), l'errore
function ponteStampaParole(rec) {
  const f = (rec && rec.fogli && rec.fogli[0]) || {}, p = (rec && rec.pubblico) || {};
  const dove = corto(f.stampante, 80) || "la stampante";
  const testo = [p.testo, p.dettaglio].filter(Boolean).join(" · ");
  if (!rec) return { fine: true, tono: "warn", titolo: "Già mandato al PC", testo: "guarda la stampante prima di rifarlo", nota: "" };
  if (rec.stato === "stampo") return { fine: true, tono: "run", titolo: "Stampo sul PC…", testo: `guarda ${dove}`, nota: "PDF dall'iPhone: la stampa tarda" };
  if (f.stato === "stampato") return { fine: true, tono: "ok", titolo: p.titolo, testo, nota: `PDF dall'iPhone stampato su ${dove}` };
  if (f.stato === "mandato") return { fine: true, tono: "warn", titolo: p.titolo, testo, nota: `PDF dall'iPhone mandato a ${dove}` };
  if (f.stato === "sconosciuto") return { fine: true, tono: "warn", titolo: p.titolo, testo, nota: `PDF dall'iPhone: esito della stampa sconosciuto (${dove})` };
  const why = corto(f.why || rec.interrotta || p.testo, 200);
  return { fine: true, tono: "err", titolo: "PDF NON stampato", testo: why, nota: `PDF dall'iPhone NON stampato: ${why}` };
}

// L'ordine. Il numero lo fa il telefono quando arma «Conferma» (oid): la
// stessa conferma rimandata — la risposta si era persa — è lo stesso ordine,
// e bg.js lo manda una volta sola (ordiniVisti). Finché una scheda lo prepara
// il telefono lo vede «in preparazione»; se la scheda tarda oltre l'attesa ma
// l'ordine nasce lo stesso, il telefono lo vede nascere.
async function ponteOrdina(d) {
  if (typeof d.oid !== "string" || !/^[\w-]{8,24}$/.test(d.oid)) return { ok: false, errore: "Ordine senza numero: ricarica il pannello sul telefono" };
  const a = { ...ponteArgomenti(d), id: "tel" + d.oid };
  // (gli ordini di questo tocco: uno per erogatore di laboratorio — …l, …l2 — e …r per la radiologia)
  const suoi = (l) => l.filter((m) => typeof m.id === "string" && m.id.startsWith(a.id) && /^(l\d*|r)$/.test(m.id.slice(a.id.length)));
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
  for (const id of Object.keys(await ponteCartelleTutte())) lavoro.add(Number(id));
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
  // (mai una pagina del gestionale mentre un motore inserisce esami: bg.js)
  if (typeof dopoIlMotore === "function") await dopoIlMotore();
  const davanti = (await ponteSchede())[0];
  const vuota = { url: "about:blank", active: false };
  const t = await chrome.tabs.create(davanti ? { ...vuota, windowId: davanti.windowId, index: davanti.index + 1 } : vuota)
    .catch(() => chrome.tabs.create(vuota));
  let risolvi;
  const promessa = new Promise((r) => { risolvi = r; });
  pt.valori.set(t.id, { ep, risolvi, promessa, url: u.href, giri: 0 });
  // annotata PRIMA di andare sulla pagina: così la risposta a «chi sono?» c'è già
  await ponteValoriCambia((v) => { v[t.id] = { ep, ts: ponteOra() }; });
  const tempo = setTimeout(() => ponteValoriFine(t.id, { ok: false, testo: "i valori non sono arrivati in tempo" }), PONTE_VALORI_MAX);
  try {
    await chrome.tabs.update(t.id, { url: u.href, autoDiscardable: false });
  } catch {
    ponteValoriFine(t.id, { ok: false, testo: "la scheda dei valori non si apre" });
  }
  const esito = await promessa;
  // (la scheda può restare ancora per i referti: allora la chiude il «fatto», o il tempo)
  if (!pt.valori.has(t.id)) clearTimeout(tempo);
  return esito;
}
// finita (letto, tempo scaduto, chiusa): via l'appunto, via la scheda (se il
// medico non la sta guardando), e la risposta a chi aspetta
async function ponteValoriFine(id, esito) {
  const w = pt.valori.get(id);
  if (w) clearTimeout(w.attesa);
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
  if (v) return { ponteValori: { ep: v.ep } };
  // la scheda della cartella: che cosa salvare (o, se il service worker ha perso il lavoro, niente)
  const c = pt.cartelle.get(tabId);
  if (c) return { ponteCartella: { ep: c.ep, fase: c.fase, campi: c.campi } };
  const a = (await ponteCartelleTutte())[tabId];
  return a ? { ponteCartella: { ep: a.ep, fase: "perso" } } : {};
}
chrome.tabs.onRemoved.addListener((id) => { ponteValoriFine(id, { ok: false, testo: "la scheda dei valori è stata chiusa" }).catch(() => {}); });
chrome.tabs.onRemoved.addListener((id) => { ponteCartellaFine(id, { ok: false, incerto: pt.cartelle.get(id)?.fase === "inviato", testo: "la scheda è stata chiusa" }).catch(() => {}); });

// ------------------------------------------------- la cartella dal telefono
// Leggere: l'ultima lettura della pagina del paziente — annotata a ogni sua
// apertura sul PC, solo con un iPhone associato, in storage.session (in
// memoria: muore col browser e con la sessione del telefono) — o la pagina
// riletta da una scheda del medico (solo lettura). Salvare: la pagina del
// paziente in una scheda di sottofondo, che controlla, scrive e clicca il
// «Conferma» della pagina, e dopo il ricaricamento rilegge e verifica. Tutti
// o nessuno: un campo cambiato sul PC, o non più scrivibile, e non parte niente.
const ponteCartelleMemo = async () => (await chrome.storage.session.get(PONTE_CARTELLA))[PONTE_CARTELLA] || {};
let ponteFilaCartella = Promise.resolve();
const ponteCartellaMemoScrivi = (ep, c) => (ponteFilaCartella = ponteFilaCartella.then(async () => {
  if (!pt.coppia || !c || !Array.isArray(c.campi)) return;
  const m = await ponteCartelleMemo();
  m[ep] = { ep, letto: Number(c.letto) || ponteOra(), campi: c.campi.filter((x) => x && PONTE_CARTELLA_CAMPI[x.nome] && typeof x.v === "string")
    .map((x) => ({ nome: x.nome, v: x.v.slice(0, 20000), ro: !!x.ro })) };
  // al massimo 40 pazienti, e niente più vecchio di un turno
  const tieni = Object.values(m).filter((x) => ponteOra() - x.letto < PONTE_DURATA).sort((a, b) => b.letto - a.letto).slice(0, 40);
  await chrome.storage.session.set({ [PONTE_CARTELLA]: Object.fromEntries(tieni.map((x) => [x.ep, x])) });
}).catch(() => {}));
async function ponteCartella(a) {
  if (!a.ep) return { ok: false, errore: "Paziente non valido" };
  const memo = a.rileggi ? null : (await ponteCartelleMemo())[a.ep] || null;
  const r = await ponteSuScheda("cartella", { ...a, memo });
  if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
  if (r.ok && r.nuova) await ponteCartellaMemoScrivi(a.ep, r.dati);
  delete r.nuova;
  return r;
}
const ponteCartelleTutte = async () => (await chrome.storage.session.get(PONTE_CARTELLE))[PONTE_CARTELLE] || {};
let ponteFilaCartelle = Promise.resolve();
const ponteCartelleCambia = (fn) => (ponteFilaCartelle = ponteFilaCartelle.then(async () => {
  const v = await ponteCartelleTutte();
  const r = fn(v);
  await chrome.storage.session.set({ [PONTE_CARTELLE]: v });
  return r;
}).catch(() => null));
const ponteCartellaNomi = (l) => l.map((n) => PONTE_CARTELLA_CAMPI[n] || n).join(", ");
// nel registro degli errori: il perché e i nomi dei campi, mai un testo
function ponteCartellaErrore(perche, nomi) {
  if (typeof segnaErrore === "function") segnaErrore("ponte", { comando: "cartellaSalva", perche: corto(perche, 120), campi: nomi.slice(0, 5) });
}
async function ponteCartellaSalva(d) {
  const a = ponteArgomenti(d);
  const campi = {};
  for (const [k, v] of Object.entries(d.campi && typeof d.campi === "object" ? d.campi : {})) {
    if (!PONTE_CARTELLA_CAMPI[k]) return { ok: false, errore: "Campo sconosciuto: niente salvato" };
    if (!v || typeof v.prima !== "string" || typeof v.dopo !== "string" || v.prima.length > 20000 || v.dopo.length > 20000) return { ok: false, errore: "Testo non valido: niente salvato" };
    campi[k] = { prima: v.prima, dopo: v.dopo };
  }
  const nomi = Object.keys(campi);
  if (!a.ep || !nomi.length) return { ok: false, errore: "Niente da salvare" };
  if ([...pt.cartelle.values()].some((c) => c.ep === a.ep)) return { ok: false, errore: "Sto già salvando la cartella di questo paziente" };
  // il paziente (in elenco, non dimesso, non un episodio precedente) e la sua pagina
  const r = await ponteSuScheda("cartellaSalva", { ep: a.ep, nomi });
  if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
  if (!r.ok) return r;
  // il medico ha un testo non salvato nella cartella di quel paziente, in una
  // scheda del PC: no — anche in un altro campo, perché il suo «Conferma»
  // rimanderebbe il modulo intero, coi testi di prima
  const sporchi = await ponteCartellaSporche(a.ep, Object.keys(PONTE_CARTELLA_CAMPI));
  if (sporchi.length) {
    ponteCartellaErrore("testo non salvato in una scheda del PC", sporchi);
    ponteNota(`Cartella di ${corto(r.dati.paziente, 40) || "un paziente"} dal telefono: rifiutata, sul PC c'è un testo non salvato`);
    await ponteScriviStato();
    return { ok: false, errore: "Sul PC c'è un testo non salvato in questa pagina", sporchi };
  }
  const paz = corto(r.dati.paziente, 40) || "un paziente";
  const e = await ponteCartellaSotto(r.dati.url, a.ep, campi);
  if (e.ok) {
    ponteNota(`Cartella di ${paz} dal telefono: salvati ${ponteCartellaNomi(nomi)}`);
    await ponteScriviStato();
    await ponteCartellaMemoScrivi(a.ep, e.letta);
    // le schede di quel paziente aperte sul PC: «Aggiornato dal telefono · Ricarica»
    for (const t of await ponteSchede()) chrome.tabs.sendMessage(t.id, { t: "ponteCartellaAggiornata", ep: a.ep }).catch(() => {});
    return { ok: true, dati: { ...e.letta, salvati: nomi } };
  }
  const salvati = nomi.filter((n) => e.verificati && e.verificati[n]), mancano = nomi.filter((n) => !salvati.includes(n));
  const errore = e.cambiati ? "Cambiato sul PC: ricarica"
    : e.chiusi ? `Sul PC non è più modificabile: ${ponteCartellaNomi(e.chiusi)}`
    : e.verificati ? `${salvati.length ? `Salvato: ${ponteCartellaNomi(salvati)} · ` : ""}Non salvato sul PC: ${ponteCartellaNomi(mancano)}`
    : e.incerto ? "Non so se è salvato: guarda la cartella sul PC prima di rifarlo"
    : `Non salvato: ${e.testo || "la pagina del paziente sul PC non risponde"}`;
  ponteCartellaErrore(e.cambiati ? "cambiato sul PC" : e.chiusi ? "non più modificabile" : e.verificati ? "verifica: testo diverso" : e.testo || "?",
    e.cambiati || e.chiusi || (e.verificati ? mancano : nomi));
  ponteNota(`Cartella di ${paz} dal telefono: ${errore}${e.incerto && e.testo ? ` (${e.testo})` : ""}`);
  await ponteScriviStato();
  if (e.letta) await ponteCartellaMemoScrivi(a.ep, e.letta);
  return { ok: false, errore, ...(e.cambiati ? { cambiati: e.cambiati } : {}), ...(e.chiusi ? { chiusi: e.chiusi } : {}),
    ...(e.letta ? { dati: e.letta } : {}), ...(e.incerto ? { incerto: true } : {}) };
}
// Ogni scheda del gestionale (non quelle di sottofondo) dice se ha, per quel
// paziente, uno di quei campi cambiato e non salvato. Chi non risponde in 3
// secondi non ha una pagina viva.
async function ponteCartellaSporche(ep, nomi) {
  const lavoro = new Set(Object.keys(await ponteCartelleTutte()).map(Number));
  const schede = (await chrome.tabs.query({}).catch(() => [])).filter((t) => sulGestionale(t.url) && !t.discarded && !lavoro.has(t.id));
  const risposte = await Promise.all(schede.map((t) => Promise.race([
    chrome.tabs.sendMessage(t.id, { t: "ponteCartellaSporca", ep, nomi }).catch(() => null), attendi(3000, null)])));
  return [...new Set(risposte.flatMap((r) => (r && Array.isArray(r.sporchi) ? r.sporchi.filter((n) => nomi.includes(n)) : [])))];
}
// la scheda di sottofondo, come quella di «Aggiorna i valori»: annotata prima
// di andare sulla pagina (così sa chi è), chiusa alla fine
async function ponteCartellaSotto(url, ep, campi) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, testo: "indirizzo del paziente non valido" }; }
  if (!leggibileOrd(url) || u.searchParams.get("EPISODIO_ID") !== ep) return { ok: false, testo: "indirizzo del paziente inatteso" };
  if (typeof dopoIlMotore === "function") await dopoIlMotore();   // (come sopra)
  const davanti = (await ponteSchede())[0];
  const vuota = { url: "about:blank", active: false };
  const t = await chrome.tabs.create(davanti ? { ...vuota, windowId: davanti.windowId, index: davanti.index + 1 } : vuota)
    .catch(() => chrome.tabs.create(vuota));
  let risolvi;
  const promessa = new Promise((r) => { risolvi = r; });
  pt.cartelle.set(t.id, { ep, fase: "compila", campi, risolvi });
  await ponteCartelleCambia((v) => { v[t.id] = { ep, ts: ponteOra() }; });
  const tempo = setTimeout(() => ponteCartellaFine(t.id, { ok: false, incerto: pt.cartelle.get(t.id)?.fase === "inviato", testo: "la scheda non ha finito in tempo" }), PONTE_CARTELLA_MAX);
  try {
    await chrome.tabs.update(t.id, { url: u.href, autoDiscardable: false });
  } catch {
    ponteCartellaFine(t.id, { ok: false, testo: "la pagina del paziente sul PC non si apre" });
  }
  const esito = await promessa;
  clearTimeout(tempo);
  return esito;
}
async function ponteCartellaFine(id, esito) {
  const w = pt.cartelle.get(id);
  pt.cartelle.delete(id);
  const c = await ponteCartelleCambia((v) => { const c = v[id]; delete v[id]; return c; });
  if (!c && !w) return false;
  const t = await chrome.tabs.get(id).catch(() => null);
  if (t && !t.active) await chrome.tabs.remove(id).catch(() => {});
  if (w) w.risolvi(esito);
  return true;
}

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
  // (la pagina in una scheda: quando nel pannello non si apre. L'indirizzo
  // dinamico di getURL vale per la cornice nel gestionale, non per una scheda)
  if (msg.t === "ponteApri" && gestionale) {
    return fai(async () => {
      const t = sender.tab, url = new URL("ponte.html", chrome.runtime.getURL("")).href;
      await chrome.tabs.create({ url, windowId: t.windowId, index: t.index + 1 })
        .catch(() => chrome.tabs.create({ url }));
      return { ok: true };
    });
  }
  // la pagina di un paziente aperta dal medico: la sua cartella, per il telefono (solo con un iPhone associato)
  if (msg.t === "ponteCartellaLetta" && gestionale) {
    return fai(async () => {
      const c = msg.cartella;
      if (!pt.coppia || typeof msg.ep !== "string" || !/^[\w.-]{1,40}$/.test(msg.ep) || !c || c.ep !== msg.ep || pt.cartelle.has(sender.tab.id)) return { ok: false };
      await ponteCartellaMemoScrivi(msg.ep, { ...c, letto: ponteOra() });
      return { ok: true };
    });
  }
  // la scheda della cartella sta per cliccare «Conferma»: da qui in poi si verifica, non si ricompila
  if (msg.t === "ponteCartellaInvio" && gestionale) {
    return fai(async () => {
      const w = pt.cartelle.get(sender.tab.id);
      if (!w || w.fase !== "compila") return { ok: false };
      w.fase = "inviato";
      return { ok: true };
    });
  }
  if (msg.t === "ponteCartellaFatto" && gestionale) {
    return fai(async () => {
      const id = sender.tab.id, w = pt.cartelle.get(id);
      const nomi = (l) => (Array.isArray(l) && w ? l.filter((n) => w.campi[n]) : []);
      const esito = { ok: !!msg.ok && !!w && w.fase === "inviato", testo: corto(msg.testo, 120), incerto: !!msg.incerto };
      if (nomi(msg.cambiati).length) esito.cambiati = nomi(msg.cambiati);
      if (nomi(msg.chiusi).length) esito.chiusi = nomi(msg.chiusi);
      if (w && msg.verificati && typeof msg.verificati === "object") esito.verificati = Object.fromEntries(Object.keys(w.campi).map((n) => [n, msg.verificati[n] === true]));
      if (w && msg.letta && msg.letta.ep === w.ep && Array.isArray(msg.letta.campi)) esito.letta = { ep: w.ep, letto: ponteOra(), campi: msg.letta.campi };
      return { ok: await ponteCartellaFine(id, esito) };
    });
  }
  // La scheda dei valori non è sulla pagina del paziente. Spesso il gestionale
  // ci passa sopra (una lista, un passaggio) e poi arriva da sé: si aspetta la
  // pagina dopo. Se non arriva, si riapre l'indirizzo del paziente, una volta;
  // poi si dice dov'è finita. La pagina di un altro paziente: subito.
  if (msg.t === "ponteValoriAltrove" && gestionale) {
    return fai(async () => {
      const id = sender.tab.id, w = pt.valori.get(id);
      if (!w) return { ok: false };
      clearTimeout(w.attesa);
      w.giri += 1;
      const dove = PONTE_PAGINE[msg.pagina] || (msg.pagina ? `«${corto(msg.pagina, 60)}»` : "un'altra pagina");
      const fallita = () => ponteValoriFine(id, { ok: false, testo: msg.altro ? "il gestionale ha aperto un altro paziente: niente letto" : `il gestionale ha aperto ${dove} invece della paziente: niente letto` });
      if (msg.altro || w.giri > 4) { await fallita(); return { ok: true }; }
      w.attesa = setTimeout(() => {
        if (pt.valori.get(id) !== w) return;
        if (w.riprovato) { fallita().catch(() => {}); return; }
        w.riprovato = true;
        chrome.tabs.update(id, { url: w.url }).catch(() => fallita().catch(() => {}));
      }, PONTE_ALTROVE_MS);
      return { ok: true };
    });
  }
  // i valori sono letti: il telefono ha la risposta subito; la scheda resta
  // per i referti, e si chiude col «fatto» (o allo scadere)
  if (msg.t === "ponteValoriLetti" && gestionale) {
    return fai(async () => {
      const w = pt.valori.get(sender.tab.id);
      if (!w) return { ok: false };
      w.risolvi({ ok: !!msg.ok, testo: corto(msg.testo, 120) || "letti" });
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
