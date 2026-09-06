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
    // Fotografia dei dati (senza i contatori dei tentativi) per verificare
    // che una richiesta rifiutata non abbia scritto niente.
    fotografia() {
      const dati = [];
      for (const [key, valore] of store) {
        if (key.indexOf('try:') !== 0) dati.push(key + '=' + valore);
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

function richiestaLogin(password, ip) {
  return richiesta('POST', '/login', {
    ip: ip,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=' + encodeURIComponent(password)
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
// 15. Nei log non finiscono password, cookie o indirizzi
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
  ['configurazione incompleta', testConfigurazioneIncompleta]
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
