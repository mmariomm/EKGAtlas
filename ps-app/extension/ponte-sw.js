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
 * La chiave sta in storage.local finché non la si revoca (Revoca, Nuovo QR, o
 * «Dimentica PC» sul telefono): nessuna scadenza, anche se il browser si chiude
 * e si riapre. Il QR si rivede solo nei primi due minuti, il suo link vale per
 * il primo scambio solo pochi minuti, e solo finché nessun telefono è entrato; il primo che entra è
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
 * sul PC, con la revoca, col riavvio
 * dell'estensione, o quando una scheda del gestionale torna alla pagina
 * d'accesso (l'associazione no: rientrati nel gestionale, il telefono riapre).
 * Mentre è aperta, ogni scheda del gestionale lo dice nell'intestazione del
 * pannello: «iPhone collegato · Scollega».
 */
/* global PonteCripto, PONTE_HOST_FISSO, ordLeggi, sulGestionale, leggibileOrd, corto, KEY, REF_TTL, stampaScelte, stampaDalTel, stampaTelVista, regElenco, regPezzo, regZipVia, stazioneCollega */

const PONTE_HOST_PROVA = "ponte.host";      // storage.local: solo per le prove, e solo verso questo PC
const PONTE_COPPIA = "ponte.coppia";        // storage.local: { k, creata, usata, dev, nTel, cambiata?, errori?, blocco?, cambi? }
const PONTE_STATO = "ponte";                // storage.session: quello che le pagine mostrano
const PONTE_ORDINI = "ponte.ordini";        // storage.session: gli ordini partiti dal telefono
const PONTE_VALORI = "ponte.valori";        // storage.session: le schede aperte per «Aggiorna i valori»
const PONTE_CARTELLE = "ponte.cartelle";    // storage.session: le schede aperte per salvare la cartella (solo { ep, ts })
const PONTE_CARTELLA = "ponte.cartella";    // storage.session: l'ultima lettura della cartella di ogni paziente (memoria, mai disco)
const PONTE_REGISTRO = 14 * 3600e3;         // quanto restano gli appunti e il registro dei referti (NON la durata dell'associazione: quella non scade)
const PONTE_INATTIVO = 3 * 60e3;            // senza comandi del medico, la sessione si chiude (il telefono si ricollega in un attimo)
const PONTE_ORDINE_MAX = 30e3;              // un ordine vale 30 secondi dal tocco sul telefono: arrivato dopo, non si fa
const PONTE_BATTITO = 20e3;                 // la presa parla almeno ogni 20 secondi
const PONTE_QR_MAX = 2 * 60e3;              // il QR si rivede solo per poco
const PONTE_QR_PRIMO = 5 * 60e3;            // e il suo link vale per il primo scambio solo per poco (e una volta sola)
const PONTE_SALUTO_MAX = 2 * 60e3;          // un saluto senza seguito si dimentica
const PONTE_VALORI_MAX = 150e3;             // «Aggiorna i valori» non aspetta di più
const PONTE_ALTROVE_MS = 5e3;               // finita su un'altra pagina: tanto si aspetta quella dopo
const PONTE_PAGINE = { PsoPazienti: "la lista dei pazienti", PsoPazientiAmbulatorio: "la lista dei pazienti", PsoPazientiTriage: "la lista del triage",
  PsoEpisodioClinicoTriage: "la pagina del triage", PsoPsoImposta: "la scelta dell'area", PsoPazientiSmart: "la lista dell'ospedale" };
const PONTE_CARTELLA_MAX = 60e3;            // salvare la cartella: aprire, controllare, «Conferma», rileggere
const PONTE_TERAPIE = "ponte.terapie";      // storage.session: le schede aperte per la pagina Terapia (solo { ep, ts })
const PONTE_TERAPIA = "ponte.terapia";      // storage.session: l'ultima lettura delle terapie di ogni paziente (memoria, mai disco)
const PONTE_TERAPIA_RQ = "ponte.terapia.rq"; // storage.session: le terapie mandate dal telefono, per numero: { fase, esito }
const PONTE_TERAPIA_MAX = 90e3;             // la pagina Terapia: il paziente, il pulsante, la tendina, «Conferma», rileggere
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
const PONTE_ATTESA = { ordina: 25e3, ristampa: 25e3, ristampe: 30e3, esiti: 30e3, cartella: 30e3, altro: 10e3, pong: 10e3 };
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
  terapie: new Map(),  // scheda → { ep, nome, fase, job, prima, risolvi }: la pagina Terapia (leggere, cercare, aggiungere)
  terapiaRq: new Map(), // rq → la terapia dal telefono che sta andando (la stessa risposta a chi la rimanda)
  accette: new Map(),  // scheda → { ep, k, nome, area, rq, fase, risolvi }: «Accetta in ambulatorio» (la lista del triage, la freccia)
  accettaRq: new Map(), // rq → l'accettazione dal telefono che sta andando
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
    host: pt.host, accoppiato: !!pt.coppia, qrFino: pt.coppia && !pt.coppia.usata ? pt.coppia.creata + PONTE_QR_MAX : 0, relay: pt.relay, telefono: pt.pari,
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
  ? `${pt.host}/ponte/#${PonteCripto.frammento(pt.k, pt.coppia.creata + PONTE_QR_PRIMO)}` : "");

// ---------------------------------------------------------------- la presa
// Una alla volta: le schede che svegliano, un QR nuovo e un nuovo tentativo
// possono chiederlo insieme, e una chiave vecchia non deve arrivare per ultima.
let ponteFilaAvvio = Promise.resolve();
const ponteAvvia = () => (ponteFilaAvvio = ponteFilaAvvio.then(ponteAvviaOra, ponteAvviaOra));
async function ponteAvviaOra() {
  pt.host = await ponteIndirizzo();
  let c = (await chrome.storage.local.get(PONTE_COPPIA))[PONTE_COPPIA] || null;
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
  for (const [id, v] of Object.entries(await ponteTerapieTutte())) {
    if (ora - v.ts > PONTE_TERAPIA_MAX + 5e3) await ponteTerapiaFine(Number(id), { ok: false, incerto: true, testo: "la scheda non ha finito in tempo" });
  }
  for (const [id, v] of Object.entries(await ponteAccetteTutte())) {
    if (ora - v.ts > PONTE_ACCETTA_MAX + 5e3) await ponteAccettaFine(Number(id), { ok: false, incerto: true, testo: "la scheda non ha finito in tempo" });
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
  // il link del QR vale per il primo scambio solo pochi minuti: poi non entra più nessuno
  if (!pt.coppia.dev && ponteOra() - pt.coppia.creata >= PONTE_QR_PRIMO + 60e3) return;
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
    { v: 1, n: PonteCripto.b64u(nPc), eco: m.n, ora: ponteOra() }));
}
// «Cancella e riassocia»: la richiesta è un saluto (cifrato con la chiave del QR:
// senza, non si apre e non arriva qui) che porta il codice. Il codice si controlla
// QUI, sul PC. Giusto: il telefono di prima esce come con «Revoca» e un'associazione
// nuova — senza scadenza, come l'altra — e questo è il telefono dell'associazione.
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
  await chrome.storage.session.remove([PONTE_CARTELLA, PONTE_TERAPIA]).catch(() => {});   // le cartelle e le terapie lette per il telefono: via con la sessione
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
  if (typeof d.rid === "string" && /^[\w-]{1,30}$/.test(d.rid)) a.rid = d.rid;   // (la richiesta da ristampare)
  if (d.rileggi) a.rileggi = true;
  // (dove stampare i fogli di un ordine: «qui», sul PC, o alla stazione di stampa)
  if (d.dest === "qui" || d.dest === "stazione") a.dest = d.dest;
  // (la ristampa: solo le etichette, solo il foglio, o tutto)
  if (d.quali === "etichette" || d.quali === "foglio" || d.quali === "tutto") a.quali = d.quali;
  if ("si" in d) a.si = !!d.si;
  if (typeof d.dove === "string" && /^(tray|(letto|area):[\w.-]{1,40})(@\w{1,8})?$/.test(d.dove)) a.dove = d.dove;
  return a;
}
// quelli che l'app manda da sé: non sono il medico, non tengono aperta la sessione
const PONTE_DA_SE = new Set(["ciao", "ordini"]);
// La build mini (PS Assist · Lettura e stampa) è di SOLA LETTURA: il ponte
// risponde solo ai comandi di lettura e alla ristampa (legge la pagina aperta e
// stampa, non scrive niente nel gestionale). Elenco a consenso esplicito: tutto
// quello che non è qui dentro è rifiutato sul PC. Ogni comando di scrittura del
// gestionale (ordina, cartellaSalva, terapiaAggiungi, accetta, i Da fare, la
// nota, posto, stazioneCollega…) cade quindi nel «Questo PC è in sola lettura».
// È il primo muro, davanti alla scheda; il secondo è in content.js (ponteEsegui).
const PONTE_LETTURA = new Set([
  "ciao", "esci", "ordini",
  "pazienti", "triage", "mappa", "eo",
  "esiti", "aggiornaValori", "richieste", "cartella", "terapie",
  "pdf", "ristampe", "ristampa", "stampa",   // «stampa»: un PDF del telefono sull'A4 di QUESTO PC (non scrive nel gestionale)
  "stampaReferto",                            // un referto già salvato su questo PC, stampato (non scrive nel gestionale)
]);
const ponteSolaLettura = () => typeof self !== "undefined" && self.PSA_SOLA_LETTURA === true;
// Chi è questo PC, per il menu del telefono (nel saluto `ciao`): il tipo
// (completo 💻 o sola lettura 👁️), un nome breve configurabile (ponte.nomePc) e,
// se il gestionale lo mostra, chi è loggato adesso sul PC — informazione, mai un
// blocco: se non si legge, semplicemente non c'è.
const PONTE_NOME_PC = "ponte.nomePc";       // storage.local: il nome breve del PC
const PONTE_OPERATORE = "ponte.operatore";  // storage.session: chi è loggato nel gestionale (solo il nome, un'ora)
async function ponteChiSono() {
  const o = await chrome.storage.local.get(PONTE_NOME_PC).catch(() => ({}));
  const n = o[PONTE_NOME_PC];
  const nome = typeof n === "string" && n.trim() ? n.trim().slice(0, 40) : (ponteSolaLettura() ? "Sola lettura" : "PC completo");
  const s = (await chrome.storage.session.get(PONTE_OPERATORE).catch(() => ({})))[PONTE_OPERATORE];
  const operatore = s && typeof s.nome === "string" && Date.now() - (s.ts || 0) < 36e5 ? s.nome.slice(0, 60) : "";
  return { kind: ponteSolaLettura() ? "lettura" : "completo", nome, ...(operatore ? { operatore } : {}) };
}
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
    // La build mini: solo lettura e ristampa. Qualunque altro comando (le
    // scritture del gestionale, ma anche un comando che non conosciamo) cade
    // qui, prima di toccare una scheda. Il telefono lo sa (`solaLettura`) e
    // nasconde quei controlli, ma lo stesso comando mandato grezzo è rifiutato.
    if (ponteSolaLettura() && !PONTE_LETTURA.has(d.cmd)) return { ok: false, errore: "Questo PC è in sola lettura", solaLettura: true };
    if (d.cmd === "ciao") return { ok: true, dati: { inattivoMin: PONTE_INATTIVO / 60e3, ...(await ponteChiSono()) } };
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
    if (d.cmd === "ristampa") return await ponteRistampa(d);
    if (d.cmd === "ordineQui") return await ponteOrdineQui(d);
    if (d.cmd === "pdf") return await ponteDaiPdf(s, d);
    if (d.cmd === "stampa") return await ponteStampa(s, d);
    if (d.cmd === "stampaReferto") return await ponteStampaReferto(s, d);
    if (d.cmd === "registrazioni") return await ponteRegistrazioni(s, d);
    if (d.cmd === "registrazione") return await ponteDaiRegistrazione(s, d);
    if (d.cmd === "registrazioneVia") return await ponteViaRegistrazione(s, d);
    if (d.cmd === "cartella") return await ponteCartella(ponteArgomenti(d));
    if (d.cmd === "cartellaSalva") return await ponteCartellaSalva(d);
    if (d.cmd === "terapie") return await ponteTerapie(ponteArgomenti(d));
    if (d.cmd === "terapiaCerca") return await ponteTerapiaCerca(d);
    if (d.cmd === "terapiaAggiungi") return await ponteTerapiaAggiungi(d);
    if (d.cmd === "accetta") return await ponteAccetta(d);
    // il QR di una stazione di stampa, inquadrato dal telefono: il PC la collega (stazione-sw.js)
    if (d.cmd === "stazioneCollega" && typeof stazioneCollega === "function") {
      const r = await stazioneCollega(d);
      ponteNota(r.ok ? `iPhone · stazione di stampa collegata: ${corto(r.dati.nome, 40)}` : `iPhone · stazione di stampa non collegata: ${corto(r.errore, 100)}`);
      await ponteScriviStato();
      return r;
    }
    if (["pazienti", "mappa", "eo", "triage", "esiti", "richieste", "ristampe", "nota", "promemoria", "fatto", "dfAggiungi", "dfSpunta", "dfTogli", "posto"].includes(d.cmd)) {
      const a = ponteArgomenti(d);
      const r = await ponteSuScheda(d.cmd, a);
      if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
      if (d.cmd === "richieste" && r.ok && r.dati) r.dati.stampa = await ponteStampaDove();
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

// Le registrazioni (registra.js, ⋯ → Registrazioni): gli zip salvati su
// questo PC, già anonimizzati e controllati. Il telefono ne vede l'elenco —
// niente pazienti: il nome dello zip, quando, quanto, a mano o automatica e
// perché, il controllo —, li scarica a pezzi come i PDF dei referti (una
// risposta per pezzo, ~390 KB, dentro la stessa sessione cifrata) e li
// cancella, sul PC. Si danno e si cancellano solo quelli elencati in questa
// sessione. Ogni comando va nel registro del ponte.
const PONTE_ZIP_MAX = 100 * 1024 * 1024;     // oltre, «scaricala sul PC» (un telefono tiene lo zip in memoria)
async function ponteRegistrazioni(s, d) {
  if (typeof regElenco !== "function") return { ok: false, errore: "Sul PC il registratore non c'è" };
  const l = await regElenco(false);
  s.zip = new Set(l.map((z) => z.id));
  if (!d.auto) { ponteNota(`iPhone · elenco delle registrazioni (${l.length})`); await ponteScriviStato(); }
  return { ok: true, dati: l.map((z) => ({ ...z, troppo: z.byte > PONTE_ZIP_MAX })) };
}
async function ponteDaiRegistrazione(s, d) {
  const id = typeof d.zip === "string" ? d.zip : "";   // (non «id»: quello è il numero del messaggio)
  if (!Number.isSafeInteger(d.i) || d.i < 0 || !s.zip || !s.zip.has(id)) return { ok: false, errore: "Registrazione non disponibile: riapri l'elenco" };
  const p = await regPezzo(id, d.i, PONTE_PDF_PEZZO / 4 * 3);
  if (!p) return { ok: false, errore: "La registrazione non è più sul PC" };
  if (p.size > PONTE_ZIP_MAX) return { ok: false, errore: "Troppo grande per il telefono: scaricala sul PC" };
  if (d.i === 0) { ponteNota(`iPhone · registrazione ${corto(p.nome, 80)} scaricata sul telefono`); await ponteScriviStato(); }
  return { ok: true, dati: { size: p.size, n: p.n, i: p.i, b: p.b } };
}
async function ponteViaRegistrazione(s, d) {
  const id = typeof d.zip === "string" ? d.zip : "";
  // «Cancella tutto»: quelle che il telefono ha in elenco (una nata intanto resta), una per una
  if (id === "*") {
    if (!s.zip) return { ok: false, errore: "Registrazione non disponibile: riapri l'elenco" };
    let n = 0;
    for (const x of [...s.zip]) { if (await regZipVia(x)) n++; s.zip.delete(x); }
    ponteNota(`iPhone · ${n} registrazioni cancellate dal PC`);
    await ponteScriviStato();
    return { ok: true, dati: { id, n } };
  }
  if (!s.zip || !s.zip.has(id)) return { ok: false, errore: "Registrazione non disponibile: riapri l'elenco" };
  const z = await regZipVia(id);
  s.zip.delete(id);
  ponteNota(z ? `iPhone · registrazione ${corto(z.nome, 80)} cancellata dal PC` : "iPhone · una registrazione già cancellata");
  await ponteScriviStato();
  return { ok: true, dati: { id, gia: !z } };
}

// Un PDF dall'iPhone da stampare qui, sull'A4 (⋯ → «Stampa PDF»): arriva a
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
    // dove: questo PC (la sua stampa automatica) o la stazione di stampa collegata (Infermeria)
    const dest = d.dest === "stazione" ? "stazione" : "qui";
    if (dest === "stazione") { if (!(await ponteStampaDove()).stazione) return no("Nessuna stazione di stampa collegata a questo PC"); }
    else if (!(await stampaScelte())) return no("Sul PC la stampa automatica non è impostata");
    s.stampe.clear();   // una alla volta
    s.stampe.set(rid, { n, size, parti: [], lun: 0, dest });
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
  const r = await stampaDalTel(rid, pdf, c.dest);
  if (!r.ok) return no(corto(r.why, 120));
  const rec = await ponteStampaEsito(rid, PONTE_STAMPA_ATTESA);
  const { nota, ...p } = ponteStampaParole(rec);
  if (!r.gia && nota) { ponteNota(nota); await ponteScriviStato(); }
  return { ok: true, dati: p };
}
// «🖨️» accanto a un referto PDF (Esiti): il PC stampa la SUA copia salvata, la
// stessa che il telefono può aprire — solo un referto offerto in questa sessione
// (cioè di quel paziente: `s.pdf`), mai un file mandato dal telefono. Stesse
// regole di `stampa` per la destinazione, stesso motore e giornale (una
// richiesta, una stampa: rimandata, dice com'è andata e non rifà). Il registro
// non porta testo del paziente.
async function ponteStampaReferto(s, d) {
  const rid = typeof d.rid === "string" && /^[\w-]{8,24}$/.test(d.rid) ? d.rid : "";
  const ep = typeof d.ep === "string" && /^[\w.-]{1,40}$/.test(d.ep) ? d.ep : "", ref = typeof d.ref === "string" && /^[\w-]{1,80}$/.test(d.ref) ? d.ref : "";
  const no = (errore) => { ponteNota(`iPhone · un referto non stampato: ${errore}`); ponteScriviStato(); return { ok: false, errore }; };
  if (!rid || !ep || !ref) return { ok: false, errore: "Referto non disponibile: riapri gli esiti" };
  // già chiesta (la risposta si era persa): com'è andata, e niente seconda stampa
  if (await stampaTelVista(rid)) { const { nota, ...p } = ponteStampaParole(await ponteStampaEsito(rid, 0)); return { ok: true, dati: p }; }
  if (!s.pdf || !s.pdf.has(ep + "|" + ref)) return no("Referto non disponibile: riapri gli esiti");
  const dest = d.dest === "stazione" ? "stazione" : "qui";
  if (dest === "stazione") { if (!(await ponteStampaDove()).stazione) return no("Nessuna stazione di stampa collegata a questo PC"); }
  else if (!(await stampaScelte())) return no("Sul PC la stampa automatica non è impostata");
  const b = await ponteCopia(ep, ref);
  if (!b) return no("Il PDF non è più sul PC");
  if (ponteMisura(b) > PONTE_PDF_MAX) return no("PDF troppo grande: oltre 15 MB");
  const r = await stampaDalTel(rid, b, dest, "Referto dall'iPhone");
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
  // (un referto: il registro dice «un referto», mai il paziente)
  const rf = rec.paziente === "Referto dall'iPhone", chi = rf ? "iPhone · un referto" : "PDF dall'iPhone";
  if (rec.stato === "stampo") return { fine: true, tono: "run", titolo: rec.dest === "stazione" ? `Stampo in ${dove}…` : "Stampo sul PC…", testo: `guarda ${dove}`, nota: `${chi}: la stampa tarda` };
  if (f.stato === "stampato") return { fine: true, tono: "ok", titolo: p.titolo, testo, nota: `${chi} stampato su ${dove}` };
  if (f.stato === "mandato") return { fine: true, tono: "warn", titolo: p.titolo, testo, nota: `${chi} mandato a ${dove}` };
  if (f.stato === "sconosciuto") return { fine: true, tono: "warn", titolo: p.titolo, testo, nota: `${chi}: esito della stampa sconosciuto (${dove})` };
  const why = corto(f.why || rec.interrotta || p.testo, 200);
  return { fine: true, tono: "err", titolo: rf ? "Referto NON stampato" : "PDF NON stampato", testo: why, nota: `${chi} NON stampato: ${why}` };
}

// Con il catalogo, dove vanno i fogli: la stazione collegata (il suo nome) e
// la scelta del PC, che il telefono propone e si può cambiare per un ordine.
// (`auto`: questo PC stampa da solo, con l'aiutante — se no il telefono spegne
// Ristampa, 🖨️ e Stampa PDF verso il PC, e dice perché, prima del tocco)
async function ponteStampaDove() {
  const o = await chrome.storage.local.get(["stampa", "stazione.coppia"]);
  const c = o["stazione.coppia"];
  const auto = !!(await stampaScelte().catch(() => null));
  if (!c || c.revoca) return { stazione: "", auto };
  return { stazione: corto(c.nome || "Infermeria", 40), dove: (o.stampa || {}).dove === "stazione" ? "stazione" : "qui", auto };
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
  // (le tre parole di un ordine finito: bg.js, CONFERMATA / DA_CONTROLLARE / NON_PARTITA)
  ponteInvia(pt.sessione, { evento: "ordine", ordine: { ...sp, tono: r.incerto ? "warn" : "err", titolo: r.incerto ? DA_CONTROLLARE : NON_PARTITA,
    testo: r.incerto ? GUARDA : "niente inviato: riprova", dettaglio: corto(r.errore || "", 240), fine: true } });
  return r;
}

// «Stampa sul PC» sulla carta di un ordine del telefono la cui stazione di
// stampa non risponde: lo stesso tocco di «Stampa qui» sulla striscia del PC
// (ordQui, bg.js) — il tocco è il consenso, mai una stampa da sola; un ordine
// che stampa già qui, o già stampato, non si rifà. Solo un ordine del telefono.
async function ponteOrdineQui(d) {
  const id = typeof d.id === "string" && /^tel[\w-]{8,40}$/.test(d.id) ? d.id : "";
  if (!id || !(await ponteOrdiniMemo()).some((m) => m.id === id)) return { ok: false, errore: "Ordine non trovato sul PC" };
  const r = await ordQui(id, { daTel: true });
  ponteNota(r.ok ? "iPhone · «Stampa sul PC» per un ordine della stazione" : `iPhone · «Stampa sul PC» non riuscita: ${corto(r.errore || "", 80)}`);
  await ponteScriviStato();
  return r.ok ? { ok: true, dati: { cambiata: !!r.cambiata } } : { ok: false, errore: r.errore || "Stampa non partita" };
}

// «Ristampa» di una richiesta già sulla pagina del paziente (Richieste fatte):
// le sue etichette e il suo foglio, dove dice il telefono (`dest`), col giro
// dei fogli di un ordine — stesso giornale, stesse parole, «Infermeria non
// risponde». Il numero lo fa il telefono (`oid`): rimandata, è la stessa; una
// scheda che tace non si rifà (PONTE_UNA_VOLTA). Si guarda passare come un
// ordine (ponteSegnaOrdini), ma l'id non è «tel…»: non ha né un quesito né esami.
async function ponteRistampa(d) {
  if (typeof d.oid !== "string" || !/^[\w-]{8,24}$/.test(d.oid)) return { ok: false, errore: "Ristampa senza numero: ricarica il pannello sul telefono" };
  // (come un ordine: arrivata più di 30 secondi dopo il tocco — una presa morta, un ritardo — non si fa)
  const eta = ponteOra() - d.nato;
  if (!Number.isFinite(d.nato) || eta > PONTE_ORDINE_MAX || eta < -PONTE_ORDINE_MAX) return { ok: false, scaduto: true, errore: "Scaduta: non inviata" };
  const a = { ...ponteArgomenti(d), id: "ris" + d.oid + "x" };   // (la x: un id che finisce per «r» sarebbe una radiologia)
  if (!a.ep || !a.rid) return { ok: false, errore: "Ristampa senza richiesta: riapri l'elenco" };
  const r = await ponteSuScheda("ristampa", a);
  if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
  if (!r.ok) return r;
  await ponteSegnaOrdini(r.dati.ordini || []);
  const ids = new Set(r.dati.ordini.map((o) => o.id));
  const nati = (await ponteOrdiniMemo()).filter((m) => ids.has(m.id));
  return { ok: true, dati: { ordini: nati.length ? nati : r.dati.ordini } };
}

// Le schede del gestionale che possono eseguire: non quelle di un ordine o
// dei valori in sottofondo; prima quella davanti al medico.
async function ponteSchede() {
  const lavoro = new Set((await ordLeggi()).filter((x) => x.worker != null).map((x) => x.worker));
  for (const id of Object.keys(await ponteValoriTutti())) lavoro.add(Number(id));
  for (const id of Object.keys(await ponteCartelleTutte())) lavoro.add(Number(id));
  for (const id of Object.keys(await ponteTerapieTutte())) lavoro.add(Number(id));
  for (const id of Object.keys(await ponteAccetteTutte())) lavoro.add(Number(id));
  const tutte = (await chrome.tabs.query({}).catch(() => [])).filter((t) => sulGestionale(t.url) && !t.discarded && !lavoro.has(t.id));
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const peso = (t) => (t.active ? 2 : 0) + (win && t.windowId === win.id ? 1 : 0);
  return tutte.sort((a, b) => peso(b) - peso(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
}
// Una scheda che tace oltre l'attesa può star lavorando ancora: la risposta
// è «incerto» (per un ordine: non si sa se è partito), mai un no. Un ordine o
// un promemoria non si rimanda alla scheda dopo: quella di prima può averlo
// fatto, e sarebbero due.
const PONTE_UNA_VOLTA = new Set(["ordina", "ristampa", "promemoria", "dfAggiungi"]);
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
  if (incerto.incerto && (cmd === "promemoria" || cmd === "dfAggiungi")) return { ok: false, errore: "Il gestionale sul PC tarda: guarda i promemoria prima di rifarlo", incerto: true };
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
  // (allo scadere coi valori già letti e i referti ancora a metà: i valori, e la scheda si chiude)
  const tempo = setTimeout(() => ponteValoriFine(t.id, pt.valori.get(t.id)?.letti || { ok: false, testo: "i valori non sono arrivati in tempo" }), PONTE_VALORI_MAX);
  try {
    await chrome.tabs.update(t.id, { url: u.href, autoDiscardable: false });
  } catch {
    ponteValoriFine(t.id, { ok: false, testo: "la scheda dei valori non si apre" });
  }
  const esito = await promessa;
  clearTimeout(tempo);   // (finita: col «fatto», chiusa, altrove — o è stato lui)
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
  if (a) return { ponteCartella: { ep: a.ep, fase: "perso" } };
  // la scheda della Terapia: che cosa fare, e a che punto (dopo «Conferma» si guarda e basta)
  const w = pt.terapie.get(tabId);
  if (w) return { ponteTerapia: { ep: w.ep, nome: w.nome, fase: w.fase, cosa: w.job.cosa, q: w.job.q, voce: w.job.voce, visti: w.job.visti, prima: w.prima } };
  const b = (await ponteTerapieTutte())[tabId];
  if (b) return { ponteTerapia: { ep: b.ep, fase: "perso" } };
  // la scheda di «Accetta in ambulatorio»: chi, e a che punto (dopo il clic si guarda e basta)
  const x = pt.accette.get(tabId);
  if (x) { x.visto = true; return { ponteAccetta: { ep: x.ep, k: x.k, nome: x.nome, area: x.area, fase: x.fase } }; }
  return (await ponteAccetteTutte())[tabId] ? { ponteAccetta: { fase: "perso" } } : {};
}
chrome.tabs.onRemoved.addListener((id) => { ponteValoriFine(id, { ok: false, testo: "la scheda dei valori è stata chiusa" }).catch(() => {}); });
chrome.tabs.onRemoved.addListener((id) => { ponteCartellaFine(id, { ok: false, incerto: pt.cartelle.get(id)?.fase === "inviato", testo: "la scheda è stata chiusa" }).catch(() => {}); });
chrome.tabs.onRemoved.addListener((id) => { ponteTerapiaFine(id, { ok: false, incerto: pt.terapie.get(id)?.fase === "inviato", testo: "la scheda è stata chiusa" }).catch(() => {}); });
chrome.tabs.onRemoved.addListener((id) => { ponteAccettaFine(id, { ok: false, incerto: ponteAccettaDopo(id), testo: "la scheda è stata chiusa" }).catch(() => {}); });

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
  const tieni = Object.values(m).filter((x) => ponteOra() - x.letto < PONTE_REGISTRO).sort((a, b) => b.letto - a.letto).slice(0, 40);
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

// ------------------------------------------------- la Terapia dal telefono
// La pagina Terapia del gestionale (PsoEpisodioTerapieImposta): leggerla,
// cercare nella sua tendina dei farmaci, e aggiungere un farmaco col SUO
// «Conferma» — l'ha scelto il medico: rivede sul telefono e tocca «Conferma».
// Ogni volta una scheda di sottofondo sulla pagina del paziente, che apre la
// Terapia col pulsante del paziente e fa quella cosa sola (ponteTerapiaQui,
// core.js); una alla volta, e si chiude. Leggere: l'ultima lettura (di una
// scheda così, o della pagina aperta dal medico; solo con un iPhone
// associato, in memoria) o la pagina riletta. Aggiungere: una volta sola per
// numero (rq), anche dopo un riavvio del service worker o una scheda che si
// ricarica — il numero e la sua fase stanno in storage.session, e «inviato»
// si annota PRIMA del clic. Dopo «Conferma» si guarda e basta: vista fra le
// confermate è «Confermata»; se no «Incerto: controlla sul PC», mai di nuovo.
const ponteTerapieMemo = async () => (await chrome.storage.session.get(PONTE_TERAPIA))[PONTE_TERAPIA] || {};
const ponteTerapieTutte = async () => (await chrome.storage.session.get(PONTE_TERAPIE))[PONTE_TERAPIE] || {};
const ponteTerapiaRqTutti = async () => (await chrome.storage.session.get(PONTE_TERAPIA_RQ))[PONTE_TERAPIA_RQ] || {};
const ponteTerapiaOpz = (o) => (o && typeof o.v === "string" && o.v && o.v.length <= 40 && typeof o.t === "string" && o.t.length <= 80 ? { v: o.v, t: o.t } : null);
// una lettura della pagina: le righe confermate (quello che la pagina ne mostra) e le voci delle tendine, niente altro
function ponteTerapiaPulita(l) {
  if (!l || typeof l !== "object" || !Array.isArray(l.righe)) return null;
  const t = (x, n) => (typeof x === "string" ? x.slice(0, n) : "");
  const opz = (a) => (Array.isArray(a) ? a.map(ponteTerapiaOpz).filter(Boolean).slice(0, 60) : []);
  return {
    ep: t(l.ep, 40), letto: Number(l.letto) || ponteOra(),
    righe: l.righe.slice(-200).filter((r) => r && typeof r.descr === "string").map((r) => ({ prog: t(r.prog, 20), descr: t(r.descr, 200), qta: t(r.qta, 10),
      um: t(r.um, 80), via: t(r.via, 80), dil: t(r.dil, 80), continua: r.continua === true, bisogno: r.bisogno === true, freq: t(r.freq, 4), ora: t(r.ora, 11) })),
    opz: { um: opz(l.opz && l.opz.um), via: opz(l.opz && l.opz.via), dil: opz(l.opz && l.opz.dil) },
  };
}
// un farmaco (dal telefono, o un preferito): la scritta della voce e la dose; niente note, niente ora. Un campo storto: null
function ponteTerapiaVoce(x) {
  if (!x || typeof x !== "object" || typeof x.descr !== "string") return null;
  const testo = (k, n) => (x[k] == null || x[k] === "" ? "" : typeof x[k] === "string" && x[k].length <= n ? x[k].trim() : false);
  const opz = (k) => (x[k] == null ? null : ponteTerapiaOpz(x[k]) || false);
  const descr = x.descr.replace(/\s+/g, " ").trim(), freq = testo("freq", 4), durata = testo("durata", 2);
  const v = { descr, codice: testo("codice", 40), qta: testo("qta", 10), um: opz("um"), via: opz("via"), dil: opz("dil"), continua: x.continua === true, bisogno: x.bisogno === true };
  if (descr.length < 3 || descr.length > 200 || [v.codice, v.qta, v.um, v.via, v.dil, freq, durata].includes(false)) return null;
  if (freq) v.freq = freq;
  if (durata) v.durata = durata;
  return v;
}
let ponteFilaTerapiaMemo = Promise.resolve();
const ponteTerapiaMemoScrivi = (ep, l) => (ponteFilaTerapiaMemo = ponteFilaTerapiaMemo.then(async () => {
  const x = ponteTerapiaPulita(l);
  if (!pt.coppia || !x || x.ep !== ep) return;
  const m = await ponteTerapieMemo();
  m[ep] = x;
  const tieni = Object.values(m).filter((y) => ponteOra() - y.letto < PONTE_REGISTRO).sort((a, b) => b.letto - a.letto).slice(0, 40);
  await chrome.storage.session.set({ [PONTE_TERAPIA]: Object.fromEntries(tieni.map((y) => [y.ep, y])) });
}).catch(() => {}));
// (questa può fallire: chi annota «inviato» non deve credere di averlo fatto)
let ponteFilaTerapiaRq = Promise.resolve();
function ponteTerapiaRqScrivi(rq, x) {
  const p = ponteFilaTerapiaRq.then(async () => {
    const m = await ponteTerapiaRqTutti();
    m[rq] = { ...(m[rq] || {}), ...x, ts: ponteOra() };
    const tieni = Object.entries(m).filter(([, y]) => ponteOra() - y.ts < PONTE_REGISTRO).sort((a, b) => b[1].ts - a[1].ts).slice(0, 60);
    await chrome.storage.session.set({ [PONTE_TERAPIA_RQ]: Object.fromEntries(tieni) });
  });
  ponteFilaTerapiaRq = p.catch(() => {});
  return p;
}
// nel registro degli errori (e la registrazione automatica: registra.js): il perché, mai un nome
function ponteTerapiaErrore(perche, grave = false) {
  if (typeof segnaErrore === "function") segnaErrore("terapia telefono", { perche: corto(perche, 60) || "?", ...(grave ? { grave: true } : {}) });
}
const PONTE_TERAPIA_GRAVE = "Errore grave: la pagina delle terapie sul PC è di un altro paziente";
// una lettura o una ricerca non riuscite, in parole
function ponteTerapiaNo(e, cosa) {
  if (e.grave) { ponteTerapiaErrore(e.grave, true); return { ok: false, errore: `${PONTE_TERAPIA_GRAVE} — non mostrata` }; }
  return { ok: false, errore: `${cosa}: ${e.testo || "la pagina Terapia sul PC non risponde"}` };
}
// Leggere. Senza paziente il telefono chiede solo se il PC conosce il comando.
async function ponteTerapie(a) {
  if (!a.ep) return { ok: true, dati: null };
  const r = await ponteSuScheda("terapie", { ep: a.ep });
  if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
  if (!r.ok) return r;
  const pref = (Array.isArray(r.dati.pref) ? r.dati.pref : []).map(ponteTerapiaVoce).filter(Boolean);
  const memo = a.rileggi ? null : (await ponteTerapieMemo())[a.ep];
  if (memo) return { ok: true, dati: { ...memo, pref } };
  const e = await ponteTerapiaSotto(r.dati.url, a.ep, r.dati.paziente, { cosa: "leggi" });
  if (!e.ok) return ponteTerapiaNo(e, "Terapie non lette");
  await ponteTerapiaMemoScrivi(a.ep, e.lettura);
  return { ok: true, dati: { ...e.lettura, pref } };
}
// Cercare: la scheda scrive nella tendina della pagina come una persona, e torna con le scritte delle voci
async function ponteTerapiaCerca(d) {
  const a = ponteArgomenti(d), q = typeof d.q === "string" ? d.q.replace(/\s+/g, " ").trim() : "";
  if (!a.ep || q.length < 3 || q.length > 60) return { ok: false, errore: "Scrivi almeno 3 lettere" };
  const r = await ponteSuScheda("terapiaCerca", { ep: a.ep });
  if (r.registro) { ponteNota(r.registro); delete r.registro; await ponteScriviStato(); }
  if (!r.ok) return r;
  const e = await ponteTerapiaSotto(r.dati.url, a.ep, r.dati.paziente, { cosa: "cerca", q });
  if (e.lettura) await ponteTerapiaMemoScrivi(a.ep, e.lettura);
  if (!e.ok) return ponteTerapiaNo(e, "Tendina non letta");
  return { ok: true, dati: { q, voci: e.voci || [] } };
}
// Aggiungere: un farmaco per volta, una volta sola per numero.
function ponteTerapiaAggiungi(d) {
  const a = ponteArgomenti(d), v = ponteTerapiaVoce(d.voce);
  const rq = typeof d.rq === "string" && /^[\w-]{8,40}$/.test(d.rq) ? d.rq : "";
  const visti = Array.isArray(d.visti) && d.visti.length <= 200 && d.visti.every((x) => typeof x === "string" && x.length <= 20) ? d.visti : null;
  if (!a.ep || !rq || !v || !visti) return Promise.resolve({ ok: false, errore: "Terapia non valida: niente confermato" });
  // lo stesso numero che sta andando: la sua risposta (annotato prima di qualunque attesa)
  if (pt.terapiaRq.has(rq)) return pt.terapiaRq.get(rq);
  const p = (async () => {
    const prima = (await ponteTerapiaRqTutti())[rq];
    if (prima && prima.esito) return prima.esito;   // com'è andata
    // (il service worker è ripartito dopo «Conferma»: non si sa, e non si rifà)
    if (prima && prima.fase === "inviato") return { ok: false, incerto: true, errore: "Incerto: controlla sul PC" };
    return ponteTerapiaAggiungiOra(a.ep, rq, v, visti);
  })();
  pt.terapiaRq.set(rq, p);
  p.finally(() => pt.terapiaRq.delete(rq)).catch(() => {});
  return p;
}
async function ponteTerapiaAggiungiOra(ep, rq, v, visti) {
  // il paziente (in elenco, non dimesso, non un episodio precedente) e la sua pagina
  const r = await ponteSuScheda("terapiaAggiungi", { ep });
  if (!r.ok) return r;
  const paz = corto(r.dati.paziente, 40) || "un paziente";
  const fatto = async (esito, perche = "", grave = false) => {
    if (perche) ponteTerapiaErrore(perche, grave);
    ponteNota(`Terapia di ${paz} dal telefono: ${esito.ok ? `confermata ${corto(v.descr, 60)}` : esito.errore}`);
    await ponteScriviStato();
    // (il numero ricorda com'è andata, senza la lettura: chi lo rimanda ha la stessa risposta)
    await ponteTerapiaRqScrivi(rq, { ep, fase: "fatto", esito: esito.ok ? { ok: true, dati: { riga: esito.dati.riga } } : { ...esito, dati: undefined } }).catch(() => {});
    return esito;
  };
  // la Terapia di questo paziente è del medico, in una scheda del PC (il suo giro, la sua riga scritta): no
  if (await ponteTerapiaSporche(ep)) return fatto({ ok: false, errore: "Non confermata: sul PC la Terapia di questo paziente è aperta e già toccata" }, "pagina del medico");
  await ponteTerapiaRqScrivi(rq, { ep, fase: "corso" });
  const e = await ponteTerapiaSotto(r.dati.url, ep, r.dati.paziente, { cosa: "aggiungi", voce: v, visti, rq });
  if (e.lettura) await ponteTerapiaMemoScrivi(ep, e.lettura);
  const dati = e.lettura ? { dati: e.lettura } : {};
  if (e.ok && e.riga) {
    // le pagine delle terapie di quel paziente aperte sul PC: sono di prima
    for (const t of await ponteSchede()) chrome.tabs.sendMessage(t.id, { t: "ponteTerapiaAggiornata", ep, descr: v.descr }).catch(() => {});
    return fatto({ ok: true, dati: { ...(e.lettura || {}), riga: e.riga } });
  }
  if (e.incerto || e.ok) return fatto({ ok: false, incerto: true, errore: e.grave ? `${PONTE_TERAPIA_GRAVE}: controlla sul PC` : "Incerto: controlla sul PC", ...dati }, e.grave || "conferma non vista", !!e.grave);
  if (e.grave) return fatto({ ok: false, errore: `${PONTE_TERAPIA_GRAVE} — niente confermato`, ...dati }, e.grave, true);
  return fatto({ ok: false, errore: `Non confermata: ${e.testo || "la pagina Terapia sul PC non risponde"}`, ...dati }, e.gia ? "già confermata" : e.perche || e.testo);
}
// Ogni scheda del gestionale (non quelle di sottofondo) dice se la Terapia di
// quel paziente è del medico adesso. Chi non risponde in 3 secondi non ha una pagina viva.
async function ponteTerapiaSporche(ep) {
  const lavoro = new Set(Object.keys(await ponteTerapieTutte()).map(Number));
  const schede = (await chrome.tabs.query({}).catch(() => [])).filter((t) => sulGestionale(t.url) && !t.discarded && !lavoro.has(t.id));
  const r = await Promise.all(schede.map((t) => Promise.race([chrome.tabs.sendMessage(t.id, { t: "ponteTerapiaSporca", ep }).catch(() => null), attendi(3000, null)])));
  return r.some((x) => x && x.sporca === true);
}
let ponteFilaTerapie = Promise.resolve();
const ponteTerapieCambia = (fn) => (ponteFilaTerapie = ponteFilaTerapie.then(async () => {
  const v = await ponteTerapieTutte();
  const r = fn(v);
  await chrome.storage.session.set({ [PONTE_TERAPIE]: v });
  return r;
}).catch(() => null));
// la scheda di sottofondo, come quella della cartella — una alla volta
let ponteFilaTerapia = Promise.resolve();
function ponteTerapiaSotto(url, ep, nome, job) {
  const p = ponteFilaTerapia.then(() => ponteTerapiaSottoOra(url, ep, nome, job));
  ponteFilaTerapia = p.catch(() => {});
  return p;
}
async function ponteTerapiaSottoOra(url, ep, nome, job) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, testo: "indirizzo del paziente non valido" }; }
  if (!leggibileOrd(url) || u.searchParams.get("EPISODIO_ID") !== ep) return { ok: false, testo: "indirizzo del paziente inatteso" };
  if (typeof dopoIlMotore === "function") await dopoIlMotore();   // (mai una pagina del gestionale mentre un motore inserisce: bg.js)
  const davanti = (await ponteSchede())[0];
  const vuota = { url: "about:blank", active: false };
  const t = await chrome.tabs.create(davanti ? { ...vuota, windowId: davanti.windowId, index: davanti.index + 1 } : vuota)
    .catch(() => chrome.tabs.create(vuota));
  let risolvi;
  const promessa = new Promise((r) => { risolvi = r; });
  pt.terapie.set(t.id, { ep, nome, fase: "apro", job, prima: [], risolvi });
  await ponteTerapieCambia((v) => { v[t.id] = { ep, ts: ponteOra() }; });
  const tempo = setTimeout(() => ponteTerapiaFine(t.id, { ok: false, incerto: pt.terapie.get(t.id)?.fase === "inviato", testo: "la scheda non ha finito in tempo" }), PONTE_TERAPIA_MAX);
  try {
    await chrome.tabs.update(t.id, { url: u.href, autoDiscardable: false });
  } catch {
    ponteTerapiaFine(t.id, { ok: false, testo: "la pagina del paziente sul PC non si apre" });
  }
  const esito = await promessa;
  clearTimeout(tempo);
  return esito;
}
async function ponteTerapiaFine(id, esito) {
  const w = pt.terapie.get(id);
  pt.terapie.delete(id);
  const c = await ponteTerapieCambia((v) => { const c = v[id]; delete v[id]; return c; });
  if (!c && !w) return false;
  const t = await chrome.tabs.get(id).catch(() => null);
  if (t && !t.active) await chrome.tabs.remove(id).catch(() => {});
  if (w) w.risolvi(esito);
  return true;
}

// ------------------------------------- «Accetta in ambulatorio» dal telefono
// Un paziente al triage — una riga del Triage del telefono (la chiave di nome
// e nascita della lista smart) o un paziente noto al PC ancora al triage —
// passa in ambulatorio con la FRECCIA della sua riga nella lista del triage
// del gestionale (PsoPazientiTriage, «Accetta in ambulatorio»), come il
// medico: l'ha scelto lui. Una scheda di sottofondo apre la lista (il suo
// link, o la stessa pagina del menu), trova la riga — episodio e nome, una
// sola — e il service worker annota «inviato» (il numero rq, in
// storage.session) PRIMA che la scheda clicchi la freccia. Dopo si guarda e
// basta (ponteAccettaQui, core.js): «In ambulatorio» solo con la pagina del
// paziente in ambulatorio, o la lista dell'ambulatorio che lo mostra; se no
// «Incerto: controlla sul PC». Lo stesso rq non si rifà mai; un nome diverso
// è «Errore grave», e niente si clicca.
const PONTE_ACCETTE = "ponte.accette";       // storage.session: le schede aperte per accettare (solo { ts })
const PONTE_ACCETTA_RQ = "ponte.accetta.rq"; // storage.session: le accettazioni dal telefono, per numero: { fase, esito }
const PONTE_ACCETTA_MAX = 60e3;              // la lista, il clic, le pagine di passaggio, la verifica
const PONTE_ACCETTA_RIPROVA = 8e3;           // una scheda che in tanto non ha ancora chiesto chi è: si riapre sulla lista, una volta
const PONTE_ACCETTA_GRAVE = "Errore grave: la riga del triage sul PC è di un altro paziente";
const ponteAccetteTutte = async () => (await chrome.storage.session.get(PONTE_ACCETTE))[PONTE_ACCETTE] || {};
const ponteAccettaRqTutti = async () => (await chrome.storage.session.get(PONTE_ACCETTA_RQ))[PONTE_ACCETTA_RQ] || {};
const ponteAccettaDopo = (id) => ["inviato", "verifica"].includes(pt.accette.get(id)?.fase);
// (questa può fallire: chi annota «inviato» non deve credere di averlo fatto)
let ponteFilaAccettaRq = Promise.resolve();
function ponteAccettaRqScrivi(rq, x) {
  const p = ponteFilaAccettaRq.then(async () => {
    const m = await ponteAccettaRqTutti();
    m[rq] = { ...(m[rq] || {}), ...x, ts: ponteOra() };
    const tieni = Object.entries(m).filter(([, y]) => ponteOra() - y.ts < PONTE_REGISTRO).sort((a, b) => b[1].ts - a[1].ts).slice(0, 60);
    await chrome.storage.session.set({ [PONTE_ACCETTA_RQ]: Object.fromEntries(tieni) });
  });
  ponteFilaAccettaRq = p.catch(() => {});
  return p;
}
let ponteFilaAccette = Promise.resolve();
const ponteAccetteCambia = (fn) => (ponteFilaAccette = ponteFilaAccette.then(async () => {
  const v = await ponteAccetteTutte();
  const r = fn(v);
  await chrome.storage.session.set({ [PONTE_ACCETTE]: v });
  return r;
}).catch(() => null));
// la lista del triage: solo la pagina del menu, senza altro (mai un modulo, mai un parametro in più)
const ponteUrlTriage = (url) => {
  try {
    const u = new URL(url);
    return sulGestionale(url) && /\/menuPso\.do$/i.test(u.pathname) && [...u.searchParams.keys()].join() === "MVPG" && u.searchParams.get("MVPG") === "PsoPazientiTriage" ? u.href : "";
  } catch { return ""; }
};
function ponteAccetta(d) {
  // la chiave di una riga del Triage è la chiaveTriage (nome e arrivo), come la manda il
  // comando «triage» e come la usa la mappa (`tr…`) — non più la chiaveSmart di nome e nascita
  const a = ponteArgomenti(d), k = typeof d.k === "string" && /^tr[0-9a-z]{1,10}$/.test(d.k) ? d.k : "";
  const rq = typeof d.rq === "string" && /^[\w-]{8,40}$/.test(d.rq) ? d.rq : "";
  if (!rq || (!a.ep && !k)) return Promise.resolve({ ok: false, errore: "Richiesta non valida: niente fatto" });
  // lo stesso numero che sta andando: la sua risposta (annotato prima di qualunque attesa)
  if (pt.accettaRq.has(rq)) return pt.accettaRq.get(rq);
  const p = (async () => {
    const prima = (await ponteAccettaRqTutti())[rq];
    if (prima && prima.esito) return prima.esito;   // com'è andata
    // (il service worker è ripartito dopo il clic: non si sa, e non si rifà)
    if (prima && prima.fase === "inviato") return { ok: false, incerto: true, errore: "Incerto: controlla sul PC" };
    return ponteAccettaOra(a.ep ? { ep: a.ep } : { k }, rq);
  })();
  pt.accettaRq.set(rq, p);
  p.finally(() => pt.accettaRq.delete(rq)).catch(() => {});
  return p;
}
async function ponteAccettaOra(chi, rq) {
  // chi è (in elenco, non dimesso; o la riga del Triage) e la lista del triage, da una scheda del medico
  const r = await ponteSuScheda("accetta", chi);
  if (!r.ok) { const { incerto, ...no } = r; return no; }   // (qui niente si clicca: una scheda lenta non fa un dubbio)
  const paz = corto(r.dati.nome, 40) || "un paziente";
  const fatto = async (esito, perche = "", grave = false) => {
    if (perche && typeof segnaErrore === "function") segnaErrore("accetta telefono", { perche: corto(perche, 60), ...(grave ? { grave: true } : {}) });
    ponteNota(`«Accetta in ambulatorio» di ${paz} dal telefono: ${esito.ok ? `in ambulatorio${esito.dati.area ? ` (${corto(esito.dati.area, 30)})` : ""}` : esito.errore}`);
    await ponteScriviStato();
    // (il numero ricorda com'è andata: chi lo rimanda ha la stessa risposta)
    await ponteAccettaRqScrivi(rq, { fase: "fatto", esito }).catch(() => {});
    return esito;
  };
  await ponteAccettaRqScrivi(rq, { fase: "corso" }).catch(() => {});
  const e = await ponteAccettaSotto(r.dati.url, { ep: r.dati.ep || "", k: r.dati.k || "", nome: r.dati.nome, area: r.dati.area || "", rq });
  if (e.ok) {
    // le pagine di quel paziente aperte sul PC sono di prima: «Aggiornato dal telefono · Ricarica»
    for (const t of await ponteSchede()) chrome.tabs.sendMessage(t.id, { t: "ponteCartellaAggiornata", ep: e.ep }).catch(() => {});
    return fatto({ ok: true, dati: { ep: e.ep, nome: r.dati.nome, area: e.area } });
  }
  if (e.incerto) {
    return fatto({ ok: false, incerto: true, errore: e.grave ? `${PONTE_ACCETTA_GRAVE}: controlla sul PC` : `Incerto: controlla sul PC${e.testo ? ` — ${e.testo}` : ""}` },
      e.grave || e.testo || "non visto", !!e.grave);
  }
  if (e.grave) return fatto({ ok: false, errore: `${PONTE_ACCETTA_GRAVE} — niente fatto` }, e.grave, true);
  return fatto({ ok: false, errore: `Non accettato: ${e.testo || "la lista del triage sul PC non risponde"}` }, e.testo || "?");
}
// la scheda di sottofondo, come quella della Terapia — una alla volta
let ponteFilaAccetta = Promise.resolve();
function ponteAccettaSotto(url, chi) {
  const p = ponteFilaAccetta.then(() => ponteAccettaSottoOra(url, chi));
  ponteFilaAccetta = p.catch(() => {});
  return p;
}
async function ponteAccettaSottoOra(url, chi) {
  const u = ponteUrlTriage(url);
  if (!u) return { ok: false, testo: "indirizzo della lista del triage inatteso" };
  if (typeof dopoIlMotore === "function") await dopoIlMotore();   // (mai una pagina del gestionale mentre un motore inserisce: bg.js)
  const davanti = (await ponteSchede())[0];
  const vuota = { url: "about:blank", active: false };
  const t = await chrome.tabs.create(davanti ? { ...vuota, windowId: davanti.windowId, index: davanti.index + 1 } : vuota)
    .catch(() => chrome.tabs.create(vuota));
  let risolvi;
  const promessa = new Promise((r) => { risolvi = r; });
  pt.accette.set(t.id, { ...chi, fase: "lista", risolvi });
  await ponteAccetteCambia((v) => { v[t.id] = { ts: ponteOra() }; });
  const tempo = setTimeout(() => ponteAccettaFine(t.id, { ok: false, incerto: ponteAccettaDopo(t.id), testo: "la scheda non ha finito in tempo" }), PONTE_ACCETTA_MAX);
  // (una scheda di sottofondo che il browser lascia scarica — «unloaded» — non chiede mai chi è:
  // prima del clic si riapre la lista, una volta; è solo una lettura)
  const riprova = setTimeout(() => {
    const w = pt.accette.get(t.id);
    if (w && w.fase === "lista" && !w.visto) chrome.tabs.update(t.id, { url: u }).catch(() => {});
  }, PONTE_ACCETTA_RIPROVA);
  try {
    await chrome.tabs.update(t.id, { url: u, autoDiscardable: false });
  } catch {
    ponteAccettaFine(t.id, { ok: false, testo: "la lista del triage sul PC non si apre" });
  }
  const esito = await promessa;
  clearTimeout(tempo);
  clearTimeout(riprova);
  return esito;
}
async function ponteAccettaFine(id, esito) {
  const w = pt.accette.get(id);
  pt.accette.delete(id);
  const c = await ponteAccetteCambia((v) => { const c = v[id]; delete v[id]; return c; });
  if (!c && !w) return false;
  const t = await chrome.tabs.get(id).catch(() => null);
  if (t && !t.active) await chrome.tabs.remove(id).catch(() => {});
  if (w) w.risolvi({ ...esito, ep: w.ep || "" });
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
  const esami = Array.isArray(m.esami) ? m.esami : rec && Array.isArray(rec.nomi) && rec.nomi.length ? rec.nomi.slice(0, 12).map((x) => corto(x, 40)) : null;
  const base = { id: m.id, ep: m.ep, paziente: m.paziente, n: m.n, rx: m.rx, ts: m.ts, ...(esami ? { esami } : {}) };
  if (!rec) {
    if (m.stato === "coda") return { ...base, stato: "tolto", tono: "err", titolo: NON_PARTITA, testo: "niente inviato", dettaglio: "tolto dalla coda sul PC", fine: true };
    // sparito prima della conferma: non si sa che cosa è entrato
    if (["", "avvio", "corre"].includes(m.stato || "")) {
      return { ...base, stato: "perso", tono: "warn", titolo: DA_CONTROLLARE, testo: GUARDA, dettaglio: "l'ordine non risulta più sul PC", fine: true };
    }
    // etichette in attesa che spariscono: una scheda del PC le ha prese per stamparle
    if (m.stato === "stampa") return { ...base, stato: "preso", tono: "ok", titolo: CONFERMATA, testo: "Etichette prese in stampa sul PC", dettaglio: "", fine: true };
    return { ...m, fine: true };
  }
  const p = { ...rec.pubblico, ...(rec.pubblico && rec.pubblico.tel) };
  // «Stampa sul PC»: la stazione non risponde (ancora prima dell'ordine), o non ha stampato le sue etichette.
  // (Mai per un foglio «forse stampato» — arrivato, risposta persa —: dal telefono non si vede il PC, e due etichette non si rischiano)
  const f = Array.isArray(rec.fogli) ? rec.fogli : [];
  const qui = rec.dest === "stazione" && (["coda", "avvio", "corre"].includes(rec.stato) ? !!rec.stazioneMuta
    : !!rec.stampa && ["stampa", "avviso"].includes(rec.stato) && f.some((x) => x.stato === "fallito") && !f.some((x) => x.stato === "sconosciuto"));
  return { ...base, stato: rec.stato, tono: p.tono || "run", titolo: corto(p.titolo, 80), testo: corto(p.testo, 200),
    dettaglio: corto(p.dettaglio, 240), quieto: !!p.quieto, fine: PONTE_FINALI.has(rec.stato), ...(qui ? { qui: true } : {}) };
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
// (quali esami, in breve: due carte «Confermata · 1 esame» uguali non dicono niente)
const ponteMemo = (o) => ({ id: o.id, ep: corto(o.ep, 40), paziente: corto(o.paziente, 60), n: Number(o.n) || 0,
  rx: !!o.rx || /r$/.test(o.id), ts: ponteOra(), stato: "", fine: false,
  ...(Array.isArray(o.nomi) && o.nomi.length ? { esami: o.nomi.slice(0, 12).map((x) => corto(x, 40)) } : {}) });
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
// Le stampe del PC cambiate (la stampa automatica accesa o spenta, la stazione
// collegata o tolta): il telefono collegato lo sa subito — i suoi bottoni di
// stampa si accendono o si spengono col perché (ponteStampaDove), senza riaprire.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !(ch.stampa || ch["stazione.coppia"]) || !pt.sessione) return;
  ponteStampaDove().then((stampa) => ponteInvia(pt.sessione, { evento: "stampa", stampa })).catch(() => {});
});
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
  // Chi è loggato nel gestionale su questo PC, letto dalla pagina dal content
  // script: solo il nome, per la testata «Sola lettura · gestionale di …» del
  // telefono. Informazione, mai un blocco: non lega niente e non apre sessioni.
  if (msg.t === "ponteOperatore" && gestionale) {
    return fai(async () => {
      const nome = typeof msg.nome === "string" ? msg.nome.replace(/\s+/g, " ").trim().slice(0, 60) : "";
      if (nome) await chrome.storage.session.set({ [PONTE_OPERATORE]: { nome, ts: ponteOra() } });
      return { ok: true };
    });
  }
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
  // la pagina delle terapie aperta dal medico: quello che mostra, per il telefono (solo con un iPhone associato)
  if (msg.t === "ponteTerapieLette" && gestionale) {
    return fai(async () => {
      if (!pt.coppia || typeof msg.ep !== "string" || !/^[\w.-]{1,40}$/.test(msg.ep) || !msg.lettura || msg.lettura.ep !== msg.ep || pt.terapie.has(sender.tab.id)) return { ok: false };
      await ponteTerapiaMemoScrivi(msg.ep, { ...msg.lettura, letto: ponteOra() });
      return { ok: true };
    });
  }
  // la scheda della Terapia sta per premere il pulsante «Terapia» del paziente
  if (msg.t === "ponteTerapiaPagina" && gestionale) {
    return fai(async () => {
      const w = pt.terapie.get(sender.tab.id);
      if (!w || w.fase !== "apro") return { ok: false };
      w.fase = "pagina";
      return { ok: true };
    });
  }
  // …e il «Conferma» della pagina: annotato PRIMA (il numero in storage.session):
  // da qui in poi la pagina che torna si guarda e basta, anche dopo un riavvio
  if (msg.t === "ponteTerapiaInvio" && gestionale) {
    return fai(async () => {
      const w = pt.terapie.get(sender.tab.id);
      if (!w || w.fase !== "pagina" || w.job.cosa !== "aggiungi" || !w.job.rq) return { ok: false };
      w.fase = "inviato";
      w.prima = Array.isArray(msg.prima) ? msg.prima.filter((x) => typeof x === "string").slice(0, 400) : [];
      try { await ponteTerapiaRqScrivi(w.job.rq, { ep: w.ep, fase: "inviato" }); }
      catch { await ponteTerapiaFine(sender.tab.id, { ok: false, testo: "il PC non riesce ad annotarlo: niente premuto" }); return { ok: false }; }
      return { ok: true };
    });
  }
  if (msg.t === "ponteTerapiaFatto" && gestionale) {
    return fai(async () => {
      const id = sender.tab.id, w = pt.terapie.get(id), cosa = w ? w.job.cosa : "";
      // «Confermata» solo dopo il clic annotato; leggere e cercare solo dalla pagina delle terapie
      const ok = !!msg.ok && !!w && w.fase === (cosa === "aggiungi" ? "inviato" : "pagina");
      const esito = { ok, testo: corto(msg.testo, 160), incerto: !!msg.incerto || (!!w && w.fase === "inviato" && !ok), gia: msg.gia === true, perche: corto(msg.perche, 40) };
      if (typeof msg.grave === "string" && msg.grave) esito.grave = corto(msg.grave, 40);
      const l = w ? ponteTerapiaPulita(msg.lettura) : null;
      if (l && l.ep === w.ep) esito.lettura = l;
      if (ok && cosa === "cerca") esito.voci = (Array.isArray(msg.voci) ? msg.voci : []).filter((x) => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, 40);
      if (ok && cosa === "aggiungi") esito.riga = (ponteTerapiaPulita({ righe: [msg.riga] }) || { righe: [] }).righe[0] || null;
      return { ok: await ponteTerapiaFine(id, esito) };
    });
  }
  // la scheda di «Accetta in ambulatorio» ha la riga, e sta per cliccare la sua freccia:
  // annotato PRIMA (il numero in storage.session) — da qui in poi si guarda e basta
  if (msg.t === "ponteAccettaInvio" && gestionale) {
    return fai(async () => {
      const w = pt.accette.get(sender.tab.id), ep = typeof msg.ep === "string" && /^[\w.-]{1,40}$/.test(msg.ep) ? msg.ep : "";
      if (!w || w.fase !== "lista" || !ep || (w.ep && w.ep !== ep)) return { ok: false };
      w.fase = "inviato";
      w.ep = ep;
      try { await ponteAccettaRqScrivi(w.rq, { ep, fase: "inviato" }); }
      catch { await ponteAccettaFine(sender.tab.id, { ok: false, testo: "il PC non riesce ad annotarlo: niente cliccato" }); return { ok: false }; }
      return { ok: true };
    });
  }
  // …tornata sulla lista del triage, e lui non c'è più: va a guardare la lista dell'ambulatorio, una volta
  if (msg.t === "ponteAccettaVerifica" && gestionale) {
    return fai(async () => {
      const w = pt.accette.get(sender.tab.id);
      if (!w || w.fase !== "inviato") return { ok: false };
      w.fase = "verifica";
      return { ok: true };
    });
  }
  if (msg.t === "ponteAccettaFatto" && gestionale) {
    return fai(async () => {
      const id = sender.tab.id, w = pt.accette.get(id), dopo = ponteAccettaDopo(id);
      // «In ambulatorio» solo dopo il clic annotato
      const ok = !!msg.ok && dopo;
      const esito = { ok, testo: corto(msg.testo, 160), incerto: !!msg.incerto || (dopo && !ok), area: corto(msg.area, 40) };
      if (typeof msg.grave === "string" && msg.grave) esito.grave = corto(msg.grave, 40);
      return { ok: !!w && await ponteAccettaFine(id, esito) };
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
  // i valori sono letti: la scheda resta per i referti non ancora caricati, e
  // il telefono ha la risposta col «fatto» — valori e referti, un tocco solo.
  // Allo scadere, quello che c'è: i valori letti (ponteValoriSotto).
  if (msg.t === "ponteValoriLetti" && gestionale) {
    return fai(async () => {
      const w = pt.valori.get(sender.tab.id);
      if (!w) return { ok: false };
      w.letti = { ok: !!msg.ok, testo: corto(msg.testo, 120) || "letti" };
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
      await ponteScriviCoppia({ k: PonteCripto.b64u(k), creata: ora, usata: false, dev: "", nTel: "" });
      ponteNota(`Nuovo QR: vale per il primo scambio fino alle ${hhmmPonte(ora + PONTE_QR_PRIMO)}`);
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
