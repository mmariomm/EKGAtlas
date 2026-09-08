'use strict';

// test/worker.test.js -- Node 22, zero dipendenze: `node test/worker.test.js`.
//
// Il Worker viene chiamato come lo chiamerebbe Cloudflare: fetch(request, env)
// con un env finto (KV in memoria, secret finti, pagina finta in env.__PAGE).
// worker.mjs è un modulo ESM, il pacchetto è CommonJS: si carica con import().
//
// Le password qui sotto sono INVENTATE e servono solo al finto env: quelle vere
// stanno soltanto nei secret di Cloudflare e non compaiono in nessun file del
// repository.

const path = require('path');
const { pathToFileURL } = require('url');
const { createHmac } = require('crypto');

const PASS_MEDICO = 'prova-medico-aaaa';
const PASS_GESTORE = 'prova-gestore-bbbb';
const SECRET = 'segreto-di-prova-solo-per-i-test';
const ALTRO_SECRET = 'un-altro-segreto-di-prova';

const MARCATORE = 'PAGINA-DEI-TURNI-FINTA';
const PAGINA = '<!doctype html><html lang="it"><head><title>I Miei Turni</title></head>' +
  '<body class="x"><!--ROLE--><main>' + MARCATORE + '</main></body></html>';
const PAGINA_SENZA_SEGNAPOSTO = '<!doctype html><html lang="it"><head><title>I Miei Turni</title></head>' +
  '<body class="x"><main>' + MARCATORE + '</main></body></html>';

const ORIGIN = 'https://turni.esempio';
const SESSION_TTL = 15552000;

// ============================================================
// Micro-libreria di asserzioni: al primo errore si esce diverso da zero.
// ============================================================

let asserzioni = 0;
let inCorso = '';

// Il Worker scrive nei log anche nelle prove che lo mettono in difficoltà: le
// righe si raccolgono qui, sia per non sporcare l'uscita, sia per controllare
// alla fine che non contengano password, cookie o indirizzi degli utenti.
const registro = [];
const consoleVera = { log: console.log, warn: console.warn, error: console.error };

function catturaConsole() {
  const raccogli = function () {
    registro.push(Array.prototype.join.call(arguments, ' '));
  };
  console.log = raccogli;
  console.warn = raccogli;
  console.error = raccogli;
}

function ripristinaConsole() {
  console.log = consoleVera.log;
  console.warn = consoleVera.warn;
  console.error = consoleVera.error;
}

function fallito(messaggio) {
  ripristinaConsole();
  for (const riga of registro) consoleVera.error('  log: ' + riga);
  consoleVera.error('FALLITO [' + inCorso + '] ' + messaggio);
  process.exit(1);
}

function vero(condizione, messaggio) {
  asserzioni++;
  if (!condizione) fallito(messaggio);
}

function uguale(effettivo, atteso, messaggio) {
  asserzioni++;
  if (effettivo !== atteso) {
    fallito(messaggio + ' -- atteso ' + JSON.stringify(atteso) + ', ricevuto ' + JSON.stringify(effettivo));
  }
}

function contiene(testo, pezzo, messaggio) {
  asserzioni++;
  if (String(testo).indexOf(pezzo) === -1) fallito(messaggio + ' -- manca ' + JSON.stringify(pezzo));
}

function nonContiene(testo, pezzo, messaggio) {
  asserzioni++;
  if (String(testo).indexOf(pezzo) !== -1) fallito(messaggio + ' -- non doveva esserci ' + JSON.stringify(pezzo));
}

// ============================================================
// Finti env, KV, richieste
// ============================================================

function kvFinto() {
  const store = new Map();
  const puts = [];
  return {
    store: store,
    puts: puts,
    async get(key, tipo) {
      const valore = store.has(key) ? store.get(key) : null;
      if (valore === null) return null;
      return tipo === 'json' ? JSON.parse(valore) : valore;
    },
    async put(key, valore, opzioni) {
      store.set(key, String(valore));
      puts.push({ key: key, valore: String(valore), opzioni: opzioni || null });
    },
    async delete(key) {
      store.delete(key);
    },
    // Fotografia dei dati (senza i contatori: né quelli dei tentativi né quelli
    // d'uso) per verificare che una richiesta rifiutata non abbia scritto niente.
    fotografia() {
      const dati = [];
      for (const [key, valore] of store) {
        if (key.indexOf('try:') !== 0 && key.indexOf('stat:') !== 0) dati.push(key + '=' + valore);
      }
      return dati.sort().join('|');
    }
  };
}

function envFinto(extra) {
  return Object.assign({
    PASS_MEDICO: PASS_MEDICO,
    PASS_GESTORE: PASS_GESTORE,
    SESSION_SECRET: SECRET,
    TURNI: kvFinto(),
    __PAGE: PAGINA
  }, extra || {});
}

function richiesta(metodo, percorso, opzioni) {
  const o = opzioni || {};
  const headers = new Headers(o.headers || {});
  if (o.cookie) headers.set('Cookie', 'turni_s=' + o.cookie);
  if (o.ip) headers.set('CF-Connecting-IP', o.ip);
  const init = { method: metodo, headers: headers };
  if (o.body !== undefined) init.body = o.body;
  return new Request(ORIGIN + percorso, init);
}

// Il browser manda `ricordami=1` quando la casella è spuntata, cioè di default:
// si passa `false` come terzo argomento per simulare chi la toglie.
function richiestaLogin(password, ip, ricordami) {
  return richiesta('POST', '/login', {
    ip: ip,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=' + encodeURIComponent(password) + (ricordami === false ? '' : '&ricordami=1')
  });
}

function richiestaPut(cookie, corpo, contentType) {
  const headers = {};
  const tipo = contentType === undefined ? 'application/json' : contentType;
  if (tipo !== null) headers['Content-Type'] = tipo;
  return richiesta('PUT', '/data/turni.json', { cookie: cookie, headers: headers, body: corpo });
}

// ============================================================
// Cookie: lettura, falsificazione
// ============================================================

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function firmaCookie(claims, secret) {
  const payload = base64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const firma = base64url(createHmac('sha256', secret).update(payload).digest());
  return payload + '.' + firma;
}

function claimsDi(cookie) {
  const payload = cookie.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

function intestazioneCookie(risposta) {
  return risposta.headers.get('Set-Cookie') || '';
}

function valoreCookie(risposta) {
  const primo = intestazioneCookie(risposta).split(';')[0];
  return primo.slice(primo.indexOf('=') + 1);
}

async function accedi(worker, env, password, ip) {
  const risposta = await worker.fetch(richiestaLogin(password, ip), env);
  return { risposta: risposta, cookie: valoreCookie(risposta) };
}

function datiValidi(extra) {
  return Object.assign({
    generatedAt: '2026-09-01T08:00:00.000Z',
    rosters: [{
      hospital: 'DEA',
      month: '2026-09',
      slots: [{ key: 'M', label: 'Mattina' }],
      days: [{ date: '2026-09-01', cells: {} }]
    }]
  }, extra || {});
}

// ============================================================
// 1. Pagina di accesso senza cookie
// ============================================================

async function testAccessoSenzaCookie(worker) {
  const risposta = await worker.fetch(richiesta('GET', '/'), envFinto());
  const html = await risposta.text();
  uguale(risposta.status, 200, 'GET / senza cookie deve dare 200, non 401');
  contiene(html, 'name="password"', 'la pagina di accesso deve avere il campo password');
  contiene(html, 'Entra', 'la pagina di accesso deve avere il bottone Entra');
  contiene(html, 'I Miei Turni', 'la pagina di accesso deve avere il titolo');
  nonContiene(html, MARCATORE, 'senza sessione la pagina dei turni non esce');
  nonContiene(html, 'TURNI_ROLE', 'senza sessione non si inietta nessun ruolo');
}

// ============================================================
// 2-3. Accesso riuscito nei due ruoli
// ============================================================

async function testAccessoMedico(worker) {
  const env = envFinto();
  const { risposta, cookie } = await accedi(worker, env, PASS_MEDICO, '203.0.113.1');
  const intestazione = intestazioneCookie(risposta);
  uguale(risposta.status, 303, 'accesso riuscito: 303');
  uguale(risposta.headers.get('Location'), '/', 'accesso riuscito: redirect su /');
  contiene(intestazione, 'turni_s=', 'il cookie si chiama turni_s');
  contiene(intestazione, 'HttpOnly', 'cookie HttpOnly');
  contiene(intestazione, 'Secure', 'cookie Secure');
  contiene(intestazione, 'SameSite=Lax', 'cookie SameSite=Lax');
  contiene(intestazione, 'Path=/', 'cookie Path=/');
  contiene(intestazione, 'Max-Age=' + SESSION_TTL, 'cookie con 180 giorni di durata');

  const claims = claimsDi(cookie);
  uguale(claims.r, 'medico', 'la password del medico dà il ruolo medico');
  const adesso = Math.floor(Date.now() / 1000);
  vero(claims.e > adesso + SESSION_TTL - 60, 'la scadenza è a circa 180 giorni');
}

async function testAccessoGestore(worker) {
  const env = envFinto();
  const { risposta, cookie } = await accedi(worker, env, PASS_GESTORE, '203.0.113.2');
  uguale(risposta.status, 303, 'accesso gestore: 303');
  uguale(claimsDi(cookie).r, 'gestore', 'la password del gestore dà il ruolo gestore');
}

// ============================================================
// 4. Password sbagliata
// ============================================================

async function testPasswordSbagliata(worker) {
  const env = envFinto();
  const risposta = await worker.fetch(richiestaLogin('non-e-la-password', '203.0.113.3'), env);
  const html = await risposta.text();
  uguale(risposta.status, 200, 'password sbagliata: 200 con la pagina di accesso');
  contiene(html, 'Password non valida.', 'password sbagliata: messaggio in italiano');
  uguale(risposta.headers.get('Set-Cookie'), null, 'password sbagliata: nessun cookie');
  nonContiene(html, MARCATORE, 'password sbagliata: niente pagina dei turni');
  nonContiene(html, 'gestore', 'il messaggio non rivela l\'esistenza di due ruoli');
}

// ============================================================
// 5. La pagina dei turni con il ruolo iniettato
// ============================================================

async function testPaginaConRuolo(worker) {
  const env = envFinto();
  const medico = await accedi(worker, env, PASS_MEDICO, '203.0.113.4');
  const gestore = await accedi(worker, env, PASS_GESTORE, '203.0.113.5');

  const rispostaMedico = await worker.fetch(richiesta('GET', '/', { cookie: medico.cookie }), env);
  const htmlMedico = await rispostaMedico.text();
  uguale(rispostaMedico.status, 200, 'con sessione medico: 200');
  contiene(htmlMedico, MARCATORE, 'con sessione medico arriva la pagina dei turni');
  contiene(htmlMedico, 'window.TURNI_ROLE="medico";', 'ruolo medico iniettato');
  nonContiene(htmlMedico, '<!--ROLE-->', 'il segnaposto viene consumato');
  nonContiene(htmlMedico, 'name="password"', 'con sessione non si mostra il campo password');

  const rispostaGestore = await worker.fetch(richiesta('GET', '/', { cookie: gestore.cookie }), env);
  const htmlGestore = await rispostaGestore.text();
  contiene(htmlGestore, 'window.TURNI_ROLE="gestore";', 'ruolo gestore iniettato');

  // Se il segnaposto non c'è, lo script entra subito dopo <body...>.
  const envSenza = envFinto({ __PAGE: PAGINA_SENZA_SEGNAPOSTO });
  const senza = await accedi(worker, envSenza, PASS_MEDICO, '203.0.113.6');
  const htmlSenza = await (await worker.fetch(richiesta('GET', '/', { cookie: senza.cookie }), envSenza)).text();
  contiene(htmlSenza, '<body class="x">\n<script>window.TURNI_ROLE="medico";</script>',
    'senza segnaposto lo script va subito dopo <body>');
}

// ============================================================
// 6-8. Cookie manomesso, scaduto, firmato con un altro segreto
// ============================================================

async function paginaDiAccesso(worker, env, cookie, messaggio) {
  const risposta = await worker.fetch(richiesta('GET', '/', { cookie: cookie }), env);
  const html = await risposta.text();
  uguale(risposta.status, 200, messaggio + ': 200');
  contiene(html, 'name="password"', messaggio + ': si torna alla pagina di accesso');
  nonContiene(html, MARCATORE, messaggio + ': niente pagina dei turni');
}

async function testCookieManomesso(worker) {
  const env = envFinto();
  const { cookie } = await accedi(worker, env, PASS_MEDICO, '203.0.113.7');
  const punto = cookie.indexOf('.');
  const primo = cookie[punto + 1];
  const cambiato = primo === 'A' ? 'B' : 'A';
  const manomesso = cookie.slice(0, punto + 1) + cambiato + cookie.slice(punto + 2);
  vero(manomesso !== cookie, 'il cookie manomesso è diverso dall\'originale');
  await paginaDiAccesso(worker, env, manomesso, 'firma manomessa');

  // Anche il payload manomesso (ruolo alzato a gestore) non deve passare.
  const alzato = firmaCookie({ r: 'gestore', e: Math.floor(Date.now() / 1000) + 60 }, ALTRO_SECRET);
  await paginaDiAccesso(worker, env, alzato, 'payload rifirmato di nascosto');
}

async function testCookieScaduto(worker) {
  const env = envFinto();
  const scaduto = firmaCookie({ r: 'medico', e: Math.floor(Date.now() / 1000) - 10 }, SECRET);
  await paginaDiAccesso(worker, env, scaduto, 'cookie scaduto');
}

async function testCookieAltroSegreto(worker) {
  const env = envFinto();
  const estraneo = firmaCookie({ r: 'medico', e: Math.floor(Date.now() / 1000) + 3600 }, ALTRO_SECRET);
  await paginaDiAccesso(worker, env, estraneo, 'cookie firmato con un altro segreto');

  // Cookie senza punto, con tre pezzi, o con base64 illegale: nessuna sessione.
  await paginaDiAccesso(worker, env, 'senzapunto', 'cookie senza firma');
  await paginaDiAccesso(worker, env, 'a.b.c', 'cookie con tre pezzi');
  await paginaDiAccesso(worker, env, '!!!.???', 'cookie con base64 illegale');
}

// ============================================================
// 9. GET /data/turni.json
// ============================================================

async function testLetturaDati(worker) {
  const env = envFinto();

  const senza = await worker.fetch(richiesta('GET', '/data/turni.json'), env);
  uguale(senza.status, 401, 'dati senza sessione: 401');
  uguale(senza.headers.get('Content-Type'), 'application/json; charset=utf-8', 'dati senza sessione: JSON');
  const erroreSenza = await senza.json();
  vero(typeof erroreSenza.error === 'string', 'dati senza sessione: campo error');
  nonContiene(JSON.stringify(erroreSenza), MARCATORE, 'dati senza sessione: niente pagina');

  const medico = await accedi(worker, env, PASS_MEDICO, '203.0.113.8');
  const vuoto = await worker.fetch(richiesta('GET', '/data/turni.json', { cookie: medico.cookie }), env);
  uguale(vuoto.status, 404, 'KV vuoto: 404 (la pagina ha i dati di riserva)');

  const gestore = await accedi(worker, env, PASS_GESTORE, '203.0.113.9');
  const dati = datiValidi();
  const salvataggio = await worker.fetch(richiestaPut(gestore.cookie, JSON.stringify(dati)), env);
  uguale(salvataggio.status, 200, 'il gestore salva i turni');

  const pieno = await worker.fetch(richiesta('GET', '/data/turni.json', { cookie: medico.cookie }), env);
  uguale(pieno.status, 200, 'KV pieno: 200');
  uguale(pieno.headers.get('Cache-Control'), 'private, no-store', 'i dati non si mettono in cache');
  const letti = await pieno.json();
  uguale(JSON.stringify(letti), JSON.stringify(dati), 'i dati letti sono quelli salvati');
}

// ============================================================
// 10. PUT /data/turni.json
// ============================================================

async function testScritturaDati(worker) {
  const env = envFinto();
  const kv = env.TURNI;
  const medico = await accedi(worker, env, PASS_MEDICO, '198.51.100.1');
  const gestore = await accedi(worker, env, PASS_GESTORE, '198.51.100.2');
  const dati = datiValidi();

  const prima = kv.fotografia();
  const negato = await worker.fetch(richiestaPut(medico.cookie, JSON.stringify(dati)), env);
  uguale(negato.status, 403, 'il medico non può salvare: 403');
  uguale(kv.fotografia(), prima, 'dopo il 403 il KV è invariato');

  const senzaSessione = await worker.fetch(richiestaPut('', JSON.stringify(dati)), env);
  uguale(senzaSessione.status, 401, 'salvataggio senza sessione: 401');

  const salvato = await worker.fetch(richiestaPut(gestore.cookie, JSON.stringify(dati)), env);
  uguale(salvato.status, 200, 'il gestore salva: 200');
  const esito = await salvato.json();
  uguale(esito.ok, true, 'il salvataggio conferma con ok');
  uguale(kv.fotografia(), 'turni.json=' + JSON.stringify(dati), 'il KV contiene i turni salvati');

  const dopoSalvataggio = kv.fotografia();

  const rotto = await worker.fetch(richiestaPut(gestore.cookie, '{ questo non è json'), env);
  uguale(rotto.status, 400, 'JSON malformato: 400');
  contiene((await rotto.json()).error, 'JSON non valido.', 'JSON malformato: messaggio in italiano');
  uguale(kv.fotografia(), dopoSalvataggio, 'JSON malformato: KV invariato');

  const forme = [
    [{ rosters: [] }, 'generatedAt mancante'],
    [{ generatedAt: '2026-09-01', rosters: {} }, 'rosters non è un elenco'],
    [{ generatedAt: '2026-09-01', rosters: [{ month: '2026-09', slots: [], days: [] }] }, 'hospital mancante'],
    [{ generatedAt: '2026-09-01', rosters: [{ hospital: 'DEA', month: 'settembre', slots: [], days: [] }] }, 'month non AAAA-MM'],
    [{ generatedAt: '2026-09-01', rosters: [{ hospital: 'DEA', month: '2026-09', days: [] }] }, 'slots mancante'],
    [{ generatedAt: '2026-09-01', rosters: [{ hospital: 'DEA', month: '2026-09', slots: [] }] }, 'days mancante'],
    [[], 'corpo non oggetto']
  ];
  for (const [corpo, descrizione] of forme) {
    const risposta = await worker.fetch(richiestaPut(gestore.cookie, JSON.stringify(corpo)), env);
    uguale(risposta.status, 400, 'forma sbagliata (' + descrizione + '): 400');
    vero(typeof (await risposta.json()).error === 'string', 'forma sbagliata (' + descrizione + '): campo error');
  }
  uguale(kv.fotografia(), dopoSalvataggio, 'forme sbagliate: KV invariato');

  const senzaTipo = await worker.fetch(richiestaPut(gestore.cookie, JSON.stringify(dati), 'text/plain'), env);
  uguale(senzaTipo.status, 400, 'Content-Type sbagliato: 400');
  uguale(kv.fotografia(), dopoSalvataggio, 'Content-Type sbagliato: KV invariato');

  // Oltre 2 MB: 413 (documentato), niente scrittura.
  const enorme = datiValidi();
  enorme.rosters[0].days = [{ date: '2026-09-01', nota: 'x'.repeat(2 * 1024 * 1024) }];
  const troppoGrande = await worker.fetch(richiestaPut(gestore.cookie, JSON.stringify(enorme)), env);
  uguale(troppoGrande.status, 413, 'corpo oltre 2 MB: 413');
  uguale(kv.fotografia(), dopoSalvataggio, 'corpo oltre 2 MB: KV invariato');
}

// ============================================================
// 11. Freno ai tentativi
// ============================================================

async function testFrenoTentativi(worker) {
  const env = envFinto();
  const kv = env.TURNI;
  const ip = '198.51.100.10';

  for (let i = 1; i <= 10; i++) {
    const risposta = await worker.fetch(richiestaLogin('sbagliata-' + i, ip), env);
    uguale(risposta.status, 200, 'tentativo ' + i + ' di 10: ancora la pagina di accesso');
  }
  uguale(kv.store.get('try:' + ip), '10', 'dieci fallimenti contati');
  const ultimoPut = kv.puts[kv.puts.length - 1];
  uguale(ultimoPut.opzioni && ultimoPut.opzioni.expirationTtl, 600, 'il contatore scade dopo 10 minuti');

  const bloccato = await worker.fetch(richiestaLogin('sbagliata-11', ip), env);
  uguale(bloccato.status, 429, 'undicesimo tentativo: 429');
  uguale(bloccato.headers.get('Retry-After'), '600', 'il 429 dice quando riprovare');
  contiene(await bloccato.text(), 'Troppi tentativi, riprova tra qualche minuto.', 'messaggio del freno');

  // Anche con la password giusta l'IP bloccato resta fuori per i 10 minuti.
  const giustaMaBloccato = await worker.fetch(richiestaLogin(PASS_GESTORE, ip), env);
  uguale(giustaMaBloccato.status, 429, 'IP bloccato: nemmeno la password giusta passa');
  uguale(giustaMaBloccato.headers.get('Set-Cookie'), null, 'IP bloccato: nessun cookie');

  // Un altro IP non è toccato dal blocco.
  const altroIp = '198.51.100.11';
  const altro = await worker.fetch(richiestaLogin('sbagliata', altroIp), env);
  uguale(altro.status, 200, 'un IP diverso non è bloccato');

  // Dopo un accesso riuscito il contatore di quell\'IP è azzerato.
  const terzoIp = '198.51.100.12';
  await worker.fetch(richiestaLogin('sbagliata', terzoIp), env);
  await worker.fetch(richiestaLogin('sbagliata', terzoIp), env);
  uguale(kv.store.get('try:' + terzoIp), '2', 'due fallimenti contati per il terzo IP');
  const riuscito = await worker.fetch(richiestaLogin(PASS_MEDICO, terzoIp), env);
  uguale(riuscito.status, 303, 'accesso riuscito dopo qualche errore');
  uguale(kv.store.has('try:' + terzoIp), false, 'il contatore si azzera al primo accesso riuscito');

  // Senza KV il Worker non deve rompersi: si continua senza freno.
  const envSenzaKv = envFinto({ TURNI: undefined });
  const senzaKv = await worker.fetch(richiestaLogin('sbagliata', ip), envSenzaKv);
  uguale(senzaKv.status, 200, 'senza KV l\'accesso funziona lo stesso');
  const conKvRotto = envFinto({
    TURNI: {
      async get() { throw new Error('KV giù'); },
      async put() { throw new Error('KV giù'); },
      async delete() { throw new Error('KV giù'); }
    }
  });
  const rotto = await worker.fetch(richiestaLogin(PASS_MEDICO, ip), conKvRotto);
  uguale(rotto.status, 303, 'con KV in errore l\'accesso riesce comunque');
}

// ============================================================
// 12. Uscita
// ============================================================

async function testUscita(worker) {
  const env = envFinto();
  const { cookie } = await accedi(worker, env, PASS_GESTORE, '198.51.100.20');
  const risposta = await worker.fetch(richiesta('POST', '/logout', { cookie: cookie }), env);
  const intestazione = intestazioneCookie(risposta);
  uguale(risposta.status, 303, 'uscita: 303');
  uguale(risposta.headers.get('Location'), '/', 'uscita: redirect su /');
  contiene(intestazione, 'turni_s=;', 'uscita: il cookie viene svuotato');
  contiene(intestazione, 'Max-Age=0', 'uscita: il cookie scade subito');
  contiene(intestazione, 'HttpOnly', 'uscita: il cookie resta HttpOnly');
}

// ============================================================
// 13. Rotte e metodi
// ============================================================

async function testRotteEMetodi(worker) {
  const env = envFinto();

  const ignota = await worker.fetch(richiesta('GET', '/qualcosa-che-non-esiste'), env);
  uguale(ignota.status, 404, 'rotta sconosciuta: 404');
  uguale(await ignota.text(), '', 'rotta sconosciuta: corpo vuoto');

  const indice = await worker.fetch(richiesta('GET', '/index.html'), env);
  uguale(indice.status, 404, '/index.html non è una scorciatoia per la pagina');

  const loginGet = await worker.fetch(richiesta('GET', '/login'), env);
  uguale(loginGet.status, 405, 'GET /login: 405');
  uguale(loginGet.headers.get('Allow'), 'POST', 'GET /login: intestazione Allow');

  const radicePost = await worker.fetch(richiesta('POST', '/', { body: 'x' }), env);
  uguale(radicePost.status, 405, 'POST /: 405');
  uguale(radicePost.headers.get('Allow'), 'GET, HEAD', 'POST /: intestazione Allow');

  const datiPatch = await worker.fetch(richiesta('PATCH', '/data/turni.json', { body: '{}' }), env);
  uguale(datiPatch.status, 405, 'PATCH sui dati: 405');
  uguale(datiPatch.headers.get('Allow'), 'GET, HEAD, PUT', 'PATCH sui dati: intestazione Allow');

  const testa = await worker.fetch(richiesta('HEAD', '/'), env);
  uguale(testa.status, 200, 'HEAD / funziona come GET');
  uguale(await testa.text(), '', 'HEAD / non ha corpo');
}

// ============================================================
// 14. Intestazioni di sicurezza e configurazione incompleta
// ============================================================

function controllaIntestazioni(risposta, dove) {
  uguale(risposta.headers.get('Cache-Control'), 'private, no-store', dove + ': Cache-Control');
  uguale(risposta.headers.get('X-Robots-Tag'), 'noindex, nofollow', dove + ': X-Robots-Tag');
  uguale(risposta.headers.get('Referrer-Policy'), 'no-referrer', dove + ': Referrer-Policy');
  uguale(risposta.headers.get('X-Content-Type-Options'), 'nosniff', dove + ': X-Content-Type-Options');
  uguale(risposta.headers.get('X-Frame-Options'), 'DENY', dove + ': X-Frame-Options');
}

async function testIntestazioni(worker) {
  const env = envFinto();
  const accesso = await worker.fetch(richiesta('GET', '/'), env);
  controllaIntestazioni(accesso, 'pagina di accesso');
  uguale(accesso.headers.get('Content-Type'), 'text/html; charset=utf-8', 'pagina di accesso: text/html');

  const { cookie } = await accedi(worker, env, PASS_MEDICO, '198.51.100.30');
  const pagina = await worker.fetch(richiesta('GET', '/', { cookie: cookie }), env);
  controllaIntestazioni(pagina, 'pagina dei turni');
}

async function testConfigurazioneIncompleta(worker) {
  for (const mancante of ['PASS_MEDICO', 'PASS_GESTORE', 'SESSION_SECRET']) {
    const env = envFinto();
    delete env[mancante];
    const risposta = await worker.fetch(richiesta('GET', '/'), env);
    const html = await risposta.text();
    uguale(risposta.status, 500, 'senza ' + mancante + ': 500');
    contiene(html, 'Servizio non disponibile', 'senza ' + mancante + ': pagina neutra');
    nonContiene(html, mancante, 'senza ' + mancante + ': il dettaglio non arriva all\'utente');
    nonContiene(html, 'name="password"', 'senza ' + mancante + ': niente form di accesso');
  }

  // Nessuna pagina nel bundle: 500 neutro, non la pagina di accesso.
  const env = envFinto({ __PAGE: '' });
  const { cookie } = await accedi(worker, env, PASS_MEDICO, '198.51.100.31');
  const risposta = await worker.fetch(richiesta('GET', '/', { cookie: cookie }), env);
  uguale(risposta.status, 500, 'senza pagina nel bundle: 500');
}

// ============================================================
// 15. Calendario: /cal-link e /cal/<slug>-<firma>.ics
// ============================================================

const FORMA_INDIRIZZO = /^\/cal\/([a-z]+)-([A-Za-z0-9_-]{22})\.ics$/;

// La firma ricalcolata qui in modo indipendente dal Worker, come la descrive la
// specifica: primi 22 caratteri di base64url(HMAC-SHA256(segreto, "cal:" + nome)),
// con il nome vero e non con lo slug.
function firmaCalendario(nome, secret) {
  return base64url(createHmac('sha256', secret).update('cal:' + nome).digest()).slice(0, 22);
}

function fasceCalendario() {
  return [
    { key: 'M', label: 'MATTINA', header: 'MATTINA 8-14', sub: '', roles: [],
      start: '08:00', end: '14:00', startMin: 480, endMin: 840, col: 'C' },
    { key: 'N', label: 'NOTTE', header: 'NOTTE 20-08', sub: '', roles: [],
      start: '20:00', end: '08:00', startMin: 1200, endMin: 1920, col: 'F' }
  ];
}

function giornoCalendario(date, mattina, notte) {
  return {
    day: Number(date.slice(8)),
    date: date,
    cells: {
      M: { raw: mattina.join('/'), names: mattina },
      N: { raw: notte.join('/'), names: notte }
    }
  };
}

// Due mesi e due sedi, con i nomi difficili: apostrofo, punto, spazio.
// FLORENZAN ha tre turni (due a settembre al DEA, uno a ottobre all'OSG),
// D'AMORE e DI VITA F. ne hanno due ciascuno.
function datiCalendario() {
  return {
    generatedAt: '2026-09-01T08:00:00.000Z',
    rosters: [
      {
        hospital: 'DEA', month: '2026-09', slots: fasceCalendario(),
        days: [
          giornoCalendario('2026-09-03', ['FLORENZAN', 'D\'AMORE'], ['DI VITA F.']),
          giornoCalendario('2026-09-04', ['DI VITA F.'], ['FLORENZAN'])
        ]
      },
      {
        hospital: 'OSG', month: '2026-10', slots: fasceCalendario(),
        days: [giornoCalendario('2026-10-05', ['FLORENZAN'], ['D\'AMORE'])]
      }
    ]
  };
}

function envConTurni(dati, extra) {
  const env = envFinto(extra);
  env.TURNI.store.set('turni.json', JSON.stringify(dati || datiCalendario()));
  return env;
}

async function chiediLink(worker, env, cookie, nome) {
  const percorso = nome === null ? '/cal-link' : '/cal-link?nome=' + encodeURIComponent(nome);
  return await worker.fetch(richiesta('GET', percorso, { cookie: cookie }), env);
}

async function indirizzoDi(worker, env, cookie, nome) {
  const risposta = await chiediLink(worker, env, cookie, nome);
  return new URL((await risposta.json()).url).pathname;
}

async function testCalLink(worker) {
  const env = envConTurni();
  const kv = env.TURNI;

  const senza = await chiediLink(worker, env, '', 'FLORENZAN');
  uguale(senza.status, 401, '/cal-link senza sessione: 401');
  uguale(senza.headers.get('Content-Type'), 'application/json; charset=utf-8', '/cal-link senza sessione: JSON');
  vero(typeof (await senza.json()).error === 'string', '/cal-link senza sessione: campo error');

  const medico = await accedi(worker, env, PASS_MEDICO, '198.51.100.40');
  const scritture = kv.puts.length;
  const risposta = await chiediLink(worker, env, medico.cookie, 'FLORENZAN');
  const corpo = await risposta.json();
  uguale(risposta.status, 200, '/cal-link con sessione medico: 200');
  uguale(risposta.headers.get('Cache-Control'), 'private, no-store', '/cal-link: l\'indirizzo non si mette in cache');
  const atteso = ORIGIN + '/cal/florenzan-' + firmaCalendario('FLORENZAN', SECRET) + '.ics';
  uguale(corpo.url, atteso, '/cal-link: slug in minuscolo e firma calcolata sul nome vero');
  uguale(corpo.webcal, 'webcal://' + atteso.slice('https://'.length), '/cal-link: webcal è lo stesso indirizzo con l\'altro schema');
  vero(FORMA_INDIRIZZO.test(new URL(corpo.url).pathname), '/cal-link: forma /cal/<slug>-<22 caratteri>.ics');
  uguale(kv.puts.length, scritture, '/cal-link non scrive niente in KV');

  // Vale qualunque ruolo, e lo stesso nome dà sempre lo stesso indirizzo.
  const gestore = await accedi(worker, env, PASS_GESTORE, '198.51.100.41');
  const perGestore = await chiediLink(worker, env, gestore.cookie, 'FLORENZAN');
  uguale(perGestore.status, 200, '/cal-link con sessione gestore: 200');
  uguale((await perGestore.json()).url, corpo.url, '/cal-link: indirizzo stabile fra i ruoli');

  // L'host arriva dalla richiesta, non da una costante nel codice.
  const altrove = await worker.fetch(new Request('https://altro.esempio/cal-link?nome=FLORENZAN', {
    headers: { Cookie: 'turni_s=' + medico.cookie }
  }), env);
  const daAltrove = await altrove.json();
  const percorso = new URL(corpo.url).pathname;
  uguale(daAltrove.url, 'https://altro.esempio' + percorso, '/cal-link: l\'host è quello della richiesta');
  uguale(daAltrove.webcal, 'webcal://altro.esempio' + percorso, '/cal-link: anche il webcal segue l\'host');

  // Nome assente, vuoto o sconosciuto: sempre 404, sempre lo stesso messaggio.
  const senzaNome = [[null, 'senza il parametro'], ['', 'con il nome vuoto'], ['NESSUNO', 'con un nome che non c\'è']];
  for (const [nome, descrizione] of senzaNome) {
    const vuoto = await chiediLink(worker, env, medico.cookie, nome);
    uguale(vuoto.status, 404, '/cal-link ' + descrizione + ': 404');
    uguale((await vuoto.json()).error, 'Nome non trovato.', '/cal-link ' + descrizione + ': messaggio in italiano');
  }

  const metodo = await worker.fetch(richiesta('POST', '/cal-link?nome=FLORENZAN', { cookie: medico.cookie, body: '' }), env);
  uguale(metodo.status, 405, 'POST /cal-link: 405');
  uguale(metodo.headers.get('Allow'), 'GET, HEAD', 'POST /cal-link: intestazione Allow');
}

async function testCalendarioPubblico(worker) {
  const env = envConTurni();
  const kv = env.TURNI;
  const medico = await accedi(worker, env, PASS_MEDICO, '198.51.100.42');
  const percorso = await indirizzoDi(worker, env, medico.cookie, 'FLORENZAN');

  const prima = kv.fotografia();
  const scritture = kv.puts.length;
  // Come lo chiede l'app del calendario: senza nessun cookie.
  const risposta = await worker.fetch(richiesta('GET', percorso), env);
  const testo = await risposta.text();

  uguale(risposta.status, 200, 'il calendario si apre senza cookie: 200');
  uguale(risposta.headers.get('Content-Type'), 'text/calendar; charset=utf-8', 'calendario: Content-Type');
  uguale(risposta.headers.get('Cache-Control'), 'private, max-age=3600', 'calendario: Cache-Control di un\'ora');
  uguale(risposta.headers.get('X-Robots-Tag'), 'noindex, nofollow', 'calendario: X-Robots-Tag');
  uguale(risposta.headers.get('X-Content-Type-Options'), 'nosniff', 'calendario: nosniff');
  uguale(risposta.headers.get('Set-Cookie'), null, 'la rotta pubblica non tocca i cookie');
  uguale(kv.fotografia(), prima, 'il calendario non cambia niente in KV');
  uguale(kv.puts.length, scritture, 'il calendario non scrive in KV');

  uguale(testo.indexOf('BEGIN:VCALENDAR'), 0, 'il file comincia con BEGIN:VCALENDAR');
  contiene(testo, 'END:VCALENDAR', 'il file si chiude come un calendario');
  contiene(testo, 'X-WR-CALNAME:Turni FLORENZAN', 'il calendario porta il nome della persona');
  contiene(testo, 'SUMMARY:PS DEA', 'ci sono i turni al DEA');
  contiene(testo, 'SUMMARY:PS OSG', 'ci sono i turni all\'OSG');

  // Tutti i mesi presenti in KV, non solo quello corrente.
  contiene(testo, 'DTSTART:202609', 'gli eventi di settembre ci sono');
  contiene(testo, 'DTSTART:202610', 'e anche quelli di ottobre');
  uguale((testo.match(/BEGIN:VEVENT/g) || []).length, 3, 'tre eventi, i tre turni di FLORENZAN');

  // Solo i propri: gli altri nomi non compaiono nemmeno dentro gli UID.
  nonContiene(testo, 'damore', 'nel calendario di uno non finiscono i turni di un altro');
  nonContiene(testo, 'divitaf', 'nel calendario di uno non finiscono i turni di un altro');

  const testa = await worker.fetch(richiesta('HEAD', percorso), env);
  uguale(testa.status, 200, 'HEAD sul calendario: 200');
  uguale(await testa.text(), '', 'HEAD sul calendario: senza corpo');

  const metodo = await worker.fetch(richiesta('POST', percorso, { body: '' }), env);
  uguale(metodo.status, 405, 'POST sul calendario: 405');
  uguale(metodo.headers.get('Allow'), 'GET, HEAD', 'POST sul calendario: intestazione Allow');
}

async function testCalendarioFirmaSbagliata(worker) {
  const env = envConTurni();
  const medico = await accedi(worker, env, PASS_MEDICO, '198.51.100.43');
  const percorso = await indirizzoDi(worker, env, medico.cookie, 'FLORENZAN');
  const pezzi = FORMA_INDIRIZZO.exec(percorso);
  vero(pezzi !== null, 'l\'indirizzo ha la forma attesa');
  const slug = pezzi[1];
  const firma = pezzi[2];

  async function respinto(indirizzo, descrizione) {
    const risposta = await worker.fetch(richiesta('GET', indirizzo), env);
    uguale(risposta.status, 404, descrizione + ': 404');
    uguale(await risposta.text(), '', descrizione + ': corpo vuoto');
    uguale(risposta.headers.get('Set-Cookie'), null, descrizione + ': nessun cookie');
  }

  const cambia = function (c) { return c === 'A' ? 'B' : 'A'; };
  await respinto('/cal/' + slug + '-' + cambia(firma[0]) + firma.slice(1) + '.ics', 'firma cambiata nel primo carattere');
  await respinto('/cal/' + slug + '-' + firma.slice(0, 21) + cambia(firma[21]) + '.ics', 'firma cambiata nell\'ultimo carattere');
  await respinto('/cal/nessuno-' + firma + '.ics', 'slug che non esiste');
  await respinto('/cal/damore-' + firma + '.ics', 'firma di un\'altra persona');
  await respinto('/cal/' + slug + '-' + firma.slice(0, 21) + '.ics', 'firma troppo corta');
  await respinto('/cal/' + slug + '.ics', 'indirizzo senza firma');
  await respinto('/cal/' + slug + '-' + firma, 'indirizzo senza .ics');
  await respinto('/cal/', 'la cartella nuda');
  await respinto('/cal/FLORENZAN-' + firma + '.ics', 'slug in maiuscolo');

  // Solo i primi 22 caratteri sono la firma: quella intera non vale.
  const intera = base64url(createHmac('sha256', SECRET).update('cal:FLORENZAN').digest());
  await respinto('/cal/' + slug + '-' + intera + '.ics', 'firma non troncata');

  // Cambiare SESSION_SECRET revoca tutti gli indirizzi già distribuiti.
  const revocato = await worker.fetch(richiesta('GET', percorso), envConTurni(null, { SESSION_SECRET: ALTRO_SECRET }));
  uguale(revocato.status, 404, 'cambiando SESSION_SECRET gli indirizzi vecchi smettono di valere');
}

async function testCalendarioNomiDifficili(worker) {
  const env = envConTurni();
  const medico = await accedi(worker, env, PASS_MEDICO, '198.51.100.44');

  const casi = [
    ['D\'AMORE', 'damore', 2, 'nome con l\'apostrofo'],
    ['DI VITA F.', 'divitaf', 2, 'nome con il punto e lo spazio']
  ];
  for (const [nome, slug, eventi, descrizione] of casi) {
    const percorso = await indirizzoDi(worker, env, medico.cookie, nome);
    uguale(percorso, '/cal/' + slug + '-' + firmaCalendario(nome, SECRET) + '.ics', descrizione + ': slug e firma');
    const risposta = await worker.fetch(richiesta('GET', percorso), env);
    const testo = await risposta.text();
    uguale(risposta.status, 200, descrizione + ': il giro completo funziona');
    uguale(testo.indexOf('BEGIN:VCALENDAR'), 0, descrizione + ': è un file di calendario');
    contiene(testo, 'X-WR-CALNAME:Turni ' + nome, descrizione + ': il nome vero nel titolo');
    uguale((testo.match(/BEGIN:VEVENT/g) || []).length, eventi, descrizione + ': i suoi turni, tutti');
  }

  // Lo stesso nome scritto in un altro modo porta allo stesso indirizzo.
  const diretto = await indirizzoDi(worker, env, medico.cookie, 'DI VITA F.');
  const piegato = await indirizzoDi(worker, env, medico.cookie, 'di vita f');
  uguale(piegato, diretto, 'il nome si può chiedere anche senza punti e maiuscole');

  // Un refuso nel foglio ("DAMORE" accanto a "D'AMORE") dà due nomi diversi con
  // lo stesso slug: non sapendo quale sia, 404 su tutte e due le rotte.
  const dati = datiCalendario();
  dati.rosters[0].days[1].cells.N.names.push('DAMORE');
  const ambiguo = envConTurni(dati);
  const suAmbiguo = await accedi(worker, ambiguo, PASS_MEDICO, '198.51.100.45');
  const link = await chiediLink(worker, ambiguo, suAmbiguo.cookie, 'D\'AMORE');
  uguale(link.status, 404, 'slug ambiguo: /cal-link non consegna nessun indirizzo');
  const file = await worker.fetch(
    richiesta('GET', '/cal/damore-' + firmaCalendario('D\'AMORE', SECRET) + '.ics'), ambiguo);
  uguale(file.status, 404, 'slug ambiguo: il calendario non si apre');
  uguale(await file.text(), '', 'slug ambiguo: corpo vuoto');
  const altri = await chiediLink(worker, ambiguo, suAmbiguo.cookie, 'FLORENZAN');
  uguale(altri.status, 200, 'un refuso su un nome non tocca gli altri');
}

async function testCalendarioSenzaTurni(worker) {
  const env = envConTurni();
  const medico = await accedi(worker, env, PASS_MEDICO, '198.51.100.46');
  const percorso = await indirizzoDi(worker, env, medico.cookie, 'FLORENZAN');

  // KV vuoto: lo stesso indirizzo non apre più niente.
  const vuoto = envFinto();
  const senzaTurni = await worker.fetch(richiesta('GET', percorso), vuoto);
  uguale(senzaTurni.status, 404, 'KV vuoto: 404');
  uguale(await senzaTurni.text(), '', 'KV vuoto: corpo vuoto');
  const medicoVuoto = await accedi(worker, vuoto, PASS_MEDICO, '198.51.100.47');
  uguale((await chiediLink(worker, vuoto, medicoVuoto.cookie, 'FLORENZAN')).status, 404,
    'KV vuoto: nemmeno /cal-link trova il nome');

  // Binding assente, KV in errore, turni illeggibili: sempre 404, mai un 500.
  const senzaKv = envFinto({ TURNI: undefined });
  uguale((await worker.fetch(richiesta('GET', percorso), senzaKv)).status, 404, 'senza binding KV: 404');

  const kvRotto = envFinto({
    TURNI: {
      async get() { throw new Error('KV giù'); },
      async put() {},
      async delete() {}
    }
  });
  uguale((await worker.fetch(richiesta('GET', percorso), kvRotto)).status, 404, 'con KV in errore: 404');

  const illeggibile = envFinto();
  illeggibile.TURNI.store.set('turni.json', '{ questo non è json');
  uguale((await worker.fetch(richiesta('GET', percorso), illeggibile)).status, 404, 'con i turni illeggibili: 404');
}

// ============================================================
// 16. «Ricordami su questo dispositivo»
// ============================================================

async function testRicordami(worker) {
  const env = envFinto();

  const pagina = await (await worker.fetch(richiesta('GET', '/'), env)).text();
  contiene(pagina, '<input type="checkbox" name="ricordami" value="1" checked',
    'la casella c\'è ed è spuntata di default');
  contiene(pagina, '<label class="ricorda">', 'la casella sta dentro un\'etichetta cliccabile');
  contiene(pagina, 'Ricordami su questo dispositivo', 'l\'etichetta è in italiano');
  contiene(pagina, '.ricorda { display: flex; align-items: center; gap: 10px; min-height: 44px;',
    'l\'area di tocco è alta almeno 40px');
  contiene(pagina, 'font-size: 16px; cursor: pointer; }', 'l\'etichetta è da 16px');

  const conRicordo = await worker.fetch(richiestaLogin(PASS_MEDICO, '198.51.100.56'), env);
  const ricordato = intestazioneCookie(conRicordo);
  uguale(conRicordo.status, 303, 'con «Ricordami»: accesso riuscito');
  contiene(ricordato, 'Max-Age=' + SESSION_TTL, 'con «Ricordami»: cookie da 180 giorni');

  const senzaRicordo = await worker.fetch(richiestaLogin(PASS_MEDICO, '198.51.100.57', false), env);
  const diSessione = intestazioneCookie(senzaRicordo);
  uguale(senzaRicordo.status, 303, 'senza «Ricordami»: accesso riuscito lo stesso');
  nonContiene(diSessione, 'Max-Age', 'senza «Ricordami»: nessun Max-Age');
  nonContiene(diSessione, 'Expires', 'senza «Ricordami»: nessun Expires');
  contiene(diSessione, 'HttpOnly', 'senza «Ricordami»: resta HttpOnly');
  contiene(diSessione, 'Secure', 'senza «Ricordami»: resta Secure');
  contiene(diSessione, 'SameSite=Lax', 'senza «Ricordami»: resta SameSite=Lax');
  contiene(diSessione, 'Path=/', 'senza «Ricordami»: resta Path=/');

  // Cambia solo quanto il browser lo conserva: la firma dice sempre 180 giorni.
  const cookie = valoreCookie(senzaRicordo);
  const claims = claimsDi(cookie);
  uguale(claims.r, 'medico', 'anche il cookie di sessione porta il ruolo');
  vero(claims.e > Math.floor(Date.now() / 1000) + SESSION_TTL - 60,
    'la scadenza firmata resta a 180 giorni anche senza «Ricordami»');
  const conSessione = await worker.fetch(richiesta('GET', '/', { cookie: cookie }), env);
  contiene(await conSessione.text(), MARCATORE, 'il cookie di sessione apre la pagina dei turni');

  // La password non viene conservata da nessuna parte.
  nonContiene(diSessione, PASS_MEDICO, 'la password non finisce nel cookie di sessione');
  nonContiene(ricordato, PASS_MEDICO, 'la password non finisce nel cookie da 180 giorni');
  for (const [chiave, valore] of env.TURNI.store) {
    nonContiene(chiave + '=' + valore, PASS_MEDICO, 'la password non finisce in KV');
  }
}

// ============================================================
// 17. Conteggi d'uso e GET /stats
// ============================================================

async function leggiStats(worker, env, cookie) {
  const risposta = await worker.fetch(richiesta('GET', '/stats', { cookie: cookie }), env);
  return { risposta: risposta, corpo: await risposta.json() };
}

async function testStatistiche(worker) {
  const env = envFinto();
  const kv = env.TURNI;
  const mese = new Date().toISOString().slice(0, 7);

  const senza = await worker.fetch(richiesta('GET', '/stats'), env);
  uguale(senza.status, 401, '/stats senza sessione: 401');
  vero(typeof (await senza.json()).error === 'string', '/stats senza sessione: campo error');

  const medico = await accedi(worker, env, PASS_MEDICO, '198.51.100.50');
  const gestore = await accedi(worker, env, PASS_GESTORE, '198.51.100.51');

  const negato = await leggiStats(worker, env, medico.cookie);
  uguale(negato.risposta.status, 403, '/stats con ruolo medico: 403');
  vero(typeof negato.corpo.error === 'string', '/stats vietato: campo error');

  const stats = await leggiStats(worker, env, gestore.cookie);
  uguale(stats.risposta.status, 200, '/stats come gestore: 200');
  uguale(stats.corpo.mese, mese, '/stats: il mese corrente');
  uguale(stats.corpo.accessi, 2, '/stats: due accessi riusciti');
  uguale(stats.corpo.perRuolo.medico, 1, '/stats: uno come medico');
  uguale(stats.corpo.perRuolo.gestore, 1, '/stats: uno come gestore');
  uguale(stats.corpo.salvataggi, 0, '/stats: nessun salvataggio ancora');
  uguale(stats.corpo.ultimoSalvataggio, null, '/stats: nessun ultimo salvataggio');

  // I tentativi andati male non sono accessi.
  await worker.fetch(richiestaLogin('sbagliata', '198.51.100.52'), env);
  const dopoErrore = await leggiStats(worker, env, gestore.cookie);
  uguale(dopoErrore.corpo.accessi, 2, 'i tentativi falliti non si contano');

  // Nei contatori solo numeri: niente indirizzi IP, niente nomi.
  let contatori = 0;
  for (const [chiave, valore] of kv.store) {
    if (chiave.indexOf('stat:') !== 0) continue;
    contatori++;
    nonContiene(chiave, '198.51.100.', 'nelle chiavi dei contatori non finiscono gli indirizzi');
    nonContiene(valore, '198.51.100.', 'nei contatori non finiscono gli indirizzi');
  }
  uguale(contatori, 3, 'tre contatori: il totale del mese e i due per ruolo');

  // KV vuoto: zeri, non un 404. La sessione si firma senza passare dall'accesso,
  // altrimenti l'accesso stesso farebbe salire il contatore.
  const vuoto = envFinto();
  const soloCookie = firmaCookie({ r: 'gestore', e: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const zeri = await leggiStats(worker, vuoto, soloCookie);
  uguale(zeri.risposta.status, 200, '/stats su KV vuoto: 200, non 404');
  uguale(zeri.corpo.accessi, 0, '/stats su KV vuoto: zero accessi');
  uguale(zeri.corpo.perRuolo.medico, 0, '/stats su KV vuoto: zero per il medico');
  uguale(zeri.corpo.perRuolo.gestore, 0, '/stats su KV vuoto: zero per il gestore');
  uguale(zeri.corpo.salvataggi, 0, '/stats su KV vuoto: zero salvataggi');
  uguale(zeri.corpo.ultimoSalvataggio, null, '/stats su KV vuoto: nessun ultimo salvataggio');

  const metodo = await worker.fetch(richiesta('POST', '/stats', { cookie: gestore.cookie, body: '' }), env);
  uguale(metodo.status, 405, 'POST /stats: 405');
  uguale(metodo.headers.get('Allow'), 'GET, HEAD', 'POST /stats: intestazione Allow');
}

async function testStatisticheSalvataggi(worker) {
  const env = envFinto();
  const gestore = await accedi(worker, env, PASS_GESTORE, '198.51.100.53');
  const medico = await accedi(worker, env, PASS_MEDICO, '198.51.100.54');

  const prima = Date.now();
  const salvato = await worker.fetch(richiestaPut(gestore.cookie, JSON.stringify(datiValidi())), env);
  uguale(salvato.status, 200, 'il gestore salva i turni');

  const dopo = await leggiStats(worker, env, gestore.cookie);
  uguale(dopo.corpo.salvataggi, 1, 'un salvataggio contato');
  vero(dopo.corpo.ultimoSalvataggio !== null, 'l\'ultimo salvataggio è registrato');
  uguale(dopo.corpo.ultimoSalvataggio.rosters, 1, 'con quanti roster è stato salvato');
  const quando = Date.parse(dopo.corpo.ultimoSalvataggio.at);
  vero(Number.isFinite(quando), 'la data dell\'ultimo salvataggio è in forma ISO');
  vero(quando >= prima - 1000 && quando <= Date.now() + 1000, 'la data dell\'ultimo salvataggio è adesso');

  // Un salvataggio rifiutato non conta e non tocca la data.
  const respinto = await worker.fetch(richiestaPut(medico.cookie, JSON.stringify(datiValidi())), env);
  uguale(respinto.status, 403, 'il medico non può salvare');
  const storto = await worker.fetch(richiestaPut(gestore.cookie, '{ questo non è json'), env);
  uguale(storto.status, 400, 'JSON storto: 400');
  const ancora = await leggiStats(worker, env, gestore.cookie);
  uguale(ancora.corpo.salvataggi, 1, 'i salvataggi rifiutati non si contano');
  uguale(ancora.corpo.ultimoSalvataggio.at, dopo.corpo.ultimoSalvataggio.at,
    'e non toccano la data dell\'ultimo salvataggio');
}

// Un KV che funziona per i dati ma rifiuta ogni scrittura dei contatori.
function kvSenzaContatori() {
  const kv = kvFinto();
  const scriviDavvero = kv.put;
  kv.put = async function (key, valore, opzioni) {
    if (String(key).indexOf('stat:') === 0) throw new Error('KV giù');
    return await scriviDavvero(key, valore, opzioni);
  };
  return kv;
}

async function testContatoriNonBloccanti(worker) {
  const env = envFinto({ TURNI: kvSenzaContatori() });
  const gestore = await accedi(worker, env, PASS_GESTORE, '198.51.100.55');
  uguale(gestore.risposta.status, 303, 'contatori guasti: l\'accesso riesce lo stesso');
  vero(gestore.cookie.length > 0, 'contatori guasti: il cookie arriva comunque');

  const dati = JSON.stringify(datiValidi());
  const salvato = await worker.fetch(richiestaPut(gestore.cookie, dati), env);
  uguale(salvato.status, 200, 'contatori guasti: il salvataggio riesce lo stesso');
  uguale((await salvato.json()).ok, true, 'contatori guasti: il salvataggio conferma con ok');
  uguale(env.TURNI.store.get('turni.json'), dati, 'contatori guasti: i turni sono davvero salvati');

  const stats = await leggiStats(worker, env, gestore.cookie);
  uguale(stats.risposta.status, 200, 'contatori guasti: /stats risponde lo stesso');
  uguale(stats.corpo.accessi, 0, 'contatori guasti: quello che non è stato scritto vale zero');

  // KV completamente giù, anche in lettura: sempre 200 con gli zeri.
  const giu = envFinto({
    TURNI: {
      async get() { throw new Error('KV giù'); },
      async put() { throw new Error('KV giù'); },
      async delete() { throw new Error('KV giù'); }
    }
  });
  const accesso = await accedi(worker, giu, PASS_GESTORE, '198.51.100.58');
  uguale(accesso.risposta.status, 303, 'KV giù: l\'accesso riesce');
  const zeri = await leggiStats(worker, giu, accesso.cookie);
  uguale(zeri.risposta.status, 200, 'KV giù: /stats risponde 200');
  uguale(zeri.corpo.accessi, 0, 'KV giù: zeri');
  uguale(zeri.corpo.ultimoSalvataggio, null, 'KV giù: nessun ultimo salvataggio');
}

// ============================================================
// 18. Installazione sul telefono: manifest e icone
// ============================================================

async function testManifest(worker) {
  const env = envFinto();
  const risposta = await worker.fetch(richiesta('GET', '/manifest.webmanifest'), env);
  uguale(risposta.status, 200, 'il manifest si apre senza sessione: 200');
  uguale(risposta.headers.get('Content-Type'), 'application/manifest+json', 'manifest: Content-Type');
  uguale(risposta.headers.get('Set-Cookie'), null, 'manifest: nessun cookie');

  const m = await risposta.json();
  uguale(m.name, 'I Miei Turni', 'manifest: nome');
  uguale(m.short_name, 'Turni', 'manifest: nome corto');
  uguale(m.start_url, '/', 'manifest: start_url');
  uguale(m.scope, '/', 'manifest: scope');
  uguale(m.display, 'standalone', 'manifest: standalone');
  uguale(m.background_color, '#F3F4F6', 'manifest: colore di sfondo');
  uguale(m.theme_color, '#FFFFFF', 'manifest: colore del tema');
  uguale(m.lang, 'it', 'manifest: lingua italiana');
  uguale(m.orientation, 'portrait', 'manifest: in verticale');
  uguale(m.icons.length, 3, 'manifest: tre icone');
  uguale(m.icons.filter(function (i) { return i.purpose === 'maskable'; }).length, 1, 'manifest: una maskable');
  vero(m.icons.every(function (i) {
    return i.type === 'image/png' && /^\/icon-\d+\.png$/.test(i.src);
  }), 'manifest: icone PNG servite dal Worker');
}

async function testIcone(worker) {
  const env = envFinto();
  const attese = [['/icon-180.png', 180], ['/icon-192.png', 192], ['/icon-512.png', 512]];
  for (const [percorso] of attese) {
    const risposta = await worker.fetch(richiesta('GET', percorso), env);
    uguale(risposta.status, 200, percorso + ': 200 senza sessione');
    uguale(risposta.headers.get('Content-Type'), 'image/png', percorso + ': image/png');
    uguale(risposta.headers.get('Cache-Control'), 'public, max-age=604800, immutable',
      percorso + ': si può mettere in cache pubblica');
    uguale(risposta.headers.get('Set-Cookie'), null, percorso + ': nessun cookie');
    const byte = new Uint8Array(await risposta.arrayBuffer());
    uguale(String.fromCharCode(byte[0], byte[1], byte[2], byte[3]), '\x89PNG',
      percorso + ': comincia con la firma PNG');
    vero(byte.length > 300, percorso + ': l\'immagine non è vuota');
  }

  const metodo = await worker.fetch(richiesta('POST', '/icon-192.png', { body: '' }), env);
  uguale(metodo.status, 405, 'POST su un\'icona: 405');
  uguale((await worker.fetch(richiesta('GET', '/icon-999.png'), env)).status, 404, 'icona che non esiste: 404');
}

async function testPagineInstallabili(worker) {
  const env = envFinto();
  const manifest = '<link rel="manifest" href="/manifest.webmanifest">';
  const icona = '<link rel="apple-touch-icon" href="/icon-180.png">';

  const accesso = await (await worker.fetch(richiesta('GET', '/'), env)).text();
  contiene(accesso, manifest, 'pagina di accesso: manifest');
  contiene(accesso, icona, 'pagina di accesso: icona per la schermata Home');
  vero(accesso.indexOf(manifest) < accesso.indexOf('</head>'), 'pagina di accesso: i link stanno nel <head>');

  const medico = await accedi(worker, env, PASS_MEDICO, '198.51.100.59');
  const turni = await (await worker.fetch(richiesta('GET', '/', { cookie: medico.cookie }), env)).text();
  contiene(turni, manifest, 'pagina dei turni: manifest');
  contiene(turni, icona, 'pagina dei turni: icona per la schermata Home');
  vero(turni.indexOf(manifest) < turni.indexOf('</head>'), 'pagina dei turni: i link stanno nel <head>');
  contiene(turni, MARCATORE, 'la pagina dei turni resta quella');
  contiene(turni, 'window.TURNI_ROLE="medico";', 'il ruolo si inietta come prima');

  // Una pagina senza </head> (o la copia locale, dove il Worker non c'è) non
  // viene toccata: nessuna eccezione, nessun link appeso in fondo.
  const senzaHead = envFinto({ __PAGE: '<html><body>' + MARCATORE + '</body></html>' });
  const suSenzaHead = await accedi(worker, senzaHead, PASS_MEDICO, '198.51.100.60');
  const html = await (await worker.fetch(richiesta('GET', '/', { cookie: suSenzaHead.cookie }), senzaHead)).text();
  uguale(html.indexOf('rel="manifest"'), -1, 'senza </head> non si inietta niente');
  contiene(html, MARCATORE, 'senza </head> la pagina arriva comunque');
}

// ============================================================
// 19. Nei log non finiscono password, cookie o indirizzi
// ============================================================

function controllaRegistro() {
  const proibiti = [PASS_MEDICO, PASS_GESTORE, SECRET, ALTRO_SECRET, '203.0.113.', '198.51.100.', 'turni_s='];
  vero(registro.length > 0, 'le prove hanno prodotto almeno una riga di log');
  for (const riga of registro) {
    for (const proibito of proibiti) {
      if (riga.indexOf(proibito) !== -1) {
        fallito('una riga di log contiene ' + JSON.stringify(proibito) + ': ' + riga);
      }
    }
  }
  asserzioni++;
}

// ============================================================
// Esecuzione
// ============================================================

const prove = [
  ['accesso senza cookie', testAccessoSenzaCookie],
  ['accesso medico', testAccessoMedico],
  ['accesso gestore', testAccessoGestore],
  ['password sbagliata', testPasswordSbagliata],
  ['pagina con ruolo', testPaginaConRuolo],
  ['cookie manomesso', testCookieManomesso],
  ['cookie scaduto', testCookieScaduto],
  ['cookie con altro segreto', testCookieAltroSegreto],
  ['lettura dati', testLetturaDati],
  ['scrittura dati', testScritturaDati],
  ['freno ai tentativi', testFrenoTentativi],
  ['uscita', testUscita],
  ['rotte e metodi', testRotteEMetodi],
  ['intestazioni di sicurezza', testIntestazioni],
  ['configurazione incompleta', testConfigurazioneIncompleta],
  ['indirizzo del calendario', testCalLink],
  ['calendario senza cookie', testCalendarioPubblico],
  ['calendario con firma sbagliata', testCalendarioFirmaSbagliata],
  ['calendario con nomi difficili', testCalendarioNomiDifficili],
  ['calendario senza turni salvati', testCalendarioSenzaTurni],
  ['ricordami su questo dispositivo', testRicordami],
  ['conteggi d\'uso e /stats', testStatistiche],
  ['conteggio dei salvataggi', testStatisticheSalvataggi],
  ['i conteggi non bloccano niente', testContatoriNonBloccanti],
  ['manifest', testManifest],
  ['icone', testIcone],
  ['pagine installabili', testPagineInstallabili]
];

async function main() {
  const modulo = await import(pathToFileURL(path.join(__dirname, '..', 'worker.mjs')).href);
  const worker = modulo.default;
  vero(worker && typeof worker.fetch === 'function', 'worker.mjs esporta un handler fetch');

  catturaConsole();
  try {
    for (const [nome, prova] of prove) {
      inCorso = nome;
      await prova(worker);
    }
  } finally {
    ripristinaConsole();
  }

  inCorso = 'log senza segreti';
  controllaRegistro();
  console.log('ok — ' + asserzioni + ' asserzioni');
}

main().catch(function (err) {
  ripristinaConsole();
  consoleVera.error('FALLITO [' + inCorso + '] ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
