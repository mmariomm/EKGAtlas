// worker.mjs -- "I Miei Turni" dietro due password, su Cloudflare Workers.
//
// Formato a moduli (ESM, `export default { fetch }`): è l'unico che Wrangler
// accetta davvero. Con un entry CommonJS il bundle esce in formato "service
// worker" e gli export vengono buttati via, quindi niente handler. Il pacchetto
// è `"type": "commonjs"`, perciò il file ha estensione .mjs e i test lo caricano
// con `await import(...)`.
//
// La pagina dei turni non sta su disco né in un binding "assets": arriva dal
// bundle (worker-page.js, generato da `node build.js`). Così non esiste nessun
// percorso che la serva senza password.
//
// Segreti attesi (secret di Cloudflare, mai nel repository):
//   PASS_MEDICO, PASS_GESTORE, SESSION_SECRET
// Binding KV: TURNI.
//
// Oltre alla pagina c'è la sottoscrizione al calendario: /cal/<slug>-<firma>.ics
// si apre senza cookie (la chiave sta nell'indirizzo), mentre /cal-link la sessione
// la chiede ed è l'unico posto da cui la pagina può sapere la firma.

// Il motore delle regole serve anche qui: fold per lo slug, buildAssignments e
// buildICS per il file di calendario. src/rules.js è CommonJS con la coda UMD e
// il pacchetto è `"type": "commonjs"`, quindi sia Node (test) sia esbuild (il
// bundler di Wrangler) lo trattano da CommonJS e l'import di default riceve
// `module.exports`. Niente copie del file, niente modifiche a build.js: le
// regole restano in un posto solo.
import TurniRules from './src/rules.js';

// ============================================================
// Costanti
// ============================================================

const COOKIE_NAME = 'turni_s';
const SESSION_TTL = 15552000;          // 180 giorni, in secondi
const KV_DATA_KEY = 'turni.json';      // il JSON dei turni pubblicato
const KV_TRY_PREFIX = 'try:';          // freno ai tentativi, una chiave per IP
const TRY_TTL = 600;                   // 10 minuti
const TRY_LIMIT = 10;                  // dal decimo fallimento in poi: 429
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_LOGIN_BYTES = 4096;
const ROLE_MEDICO = 'medico';
const ROLE_GESTORE = 'gestore';
const SECRET_NAMES = ['PASS_MEDICO', 'PASS_GESTORE', 'SESSION_SECRET'];

const CAL_PREFIX = '/cal/';            // /cal/<slug>-<firma>.ics
const CAL_MESSAGE = 'cal:';            // cosa si firma: "cal:" + il nome vero
const CAL_SIG_LEN = 22;                // 22 caratteri base64url ~ 132 bit
const CAL_MAX_AGE = 3600;              // quanto può tenerselo il telefono

const MSG_PASSWORD_ERRATA = 'Password non valida.';
const MSG_TROPPI_TENTATIVI = 'Troppi tentativi, riprova tra qualche minuto.';
const MSG_SERVIZIO = 'Servizio non disponibile, riprova più tardi.';
const MSG_NOME_NON_TROVATO = 'Nome non trovato.';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ============================================================
// Utilità di basso livello
// ============================================================

function utf8(text) {
  return encoder.encode(typeof text === 'string' ? text : '');
}

function errText(err) {
  return err && err.message ? err.message : String(err);
}

// Confronto a tempo costante fra due sequenze di byte: nessuna uscita al primo
// byte diverso e la differenza di lunghezza finisce nello stesso accumulatore,
// così anche "lunghezze diverse" costa quanto "contenuti diversi". Il ciclo gira
// sulla lunghezza maggiore leggendo in modo circolare, per non uscire dagli array.
function equalBytes(a, b) {
  let diff = a.length ^ b.length;
  const rounds = Math.max(a.length, b.length, 1);
  for (let i = 0; i < rounds; i++) {
    const x = a.length > 0 ? a[i % a.length] : 0;
    const y = b.length > 0 ? b[i % b.length] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

function base64urlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Torna null (non un'eccezione) su qualunque input storto: un cookie rotto è
// semplicemente "nessuna sessione".
function base64urlDecode(text) {
  if (typeof text !== 'string' || text === '' || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch (err) {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(message)));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// Sessione: cookie `<payload>.<firma>` firmato con SESSION_SECRET
// ============================================================

async function createSessionValue(role, secret, nowSec) {
  const payload = base64urlEncode(utf8(JSON.stringify({ r: role, e: nowSec + SESSION_TTL })));
  const signature = base64urlEncode(await hmacSha256(secret, payload));
  return payload + '.' + signature;
}

function sessionCookie(value) {
  return COOKIE_NAME + '=' + value +
    '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + SESSION_TTL;
}

function clearedCookie() {
  return COOKIE_NAME + '=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const piece of header.split(';')) {
    const raw = piece.trim();
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    if (raw.slice(0, eq).trim() === name) return raw.slice(eq + 1).trim();
  }
  return null;
}

// Il ruolo della richiesta, oppure null: cookie assente, rotto, con firma
// sbagliata o scaduto valgono tutti "nessuna sessione", mai un errore.
async function sessionRole(request, env, nowSec) {
  const value = readCookie(request, COOKIE_NAME);
  if (!value) return null;

  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  const payloadPart = value.slice(0, dot);
  const signaturePart = value.slice(dot + 1);
  if (signaturePart.indexOf('.') !== -1) return null;

  const given = base64urlDecode(signaturePart);
  if (given === null) return null;
  const expected = await hmacSha256(env.SESSION_SECRET, payloadPart);
  if (!equalBytes(given, expected)) return null;

  const payloadBytes = base64urlDecode(payloadPart);
  if (payloadBytes === null) return null;
  let claims;
  try {
    claims = JSON.parse(decoder.decode(payloadBytes));
  } catch (err) {
    return null;
  }
  if (!claims || (claims.r !== ROLE_MEDICO && claims.r !== ROLE_GESTORE)) return null;
  if (typeof claims.e !== 'number' || !Number.isFinite(claims.e) || claims.e <= nowSec) return null;
  return claims.r;
}

// ============================================================
// Risposte
// ============================================================

function securityHeaders(extra) {
  const headers = new Headers(extra || {});
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  return headers;
}

function htmlResponse(html, status, extra) {
  const headers = securityHeaders(extra);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(html, { status: status, headers: headers });
}

function jsonResponse(value, status, extra) {
  const headers = securityHeaders(extra);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status: status, headers: headers });
}

function methodNotAllowed(allow) {
  return new Response(null, { status: 405, headers: securityHeaders({ Allow: allow }) });
}

// Un 404 sempre uguale, a corpo vuoto: rotta sconosciuta e calendario rifiutato
// devono essere indistinguibili da fuori.
function notFound() {
  return new Response(null, { status: 404, headers: securityHeaders() });
}

// ============================================================
// Pagina di accesso (autonoma: niente font esterni, niente richieste in uscita)
// ============================================================

function shellPage(inner) {
  return '<!doctype html>\n' +
    '<html lang="it">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<meta name="robots" content="noindex, nofollow">\n' +
    '<title>I Miei Turni</title>\n' +
    '<style>\n' +
    ':root { color-scheme: light dark; }\n' +
    '* { box-sizing: border-box; }\n' +
    'body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;\n' +
    '  padding: 24px; background: light-dark(#F3F4F6, #14181D);\n' +
    '  color: light-dark(#111827, #E8EBEF);\n' +
    '  font: 400 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;\n' +
    '  -webkit-text-size-adjust: 100%; }\n' +
    '.card { width: 100%; max-width: 340px; padding: 28px 24px; border-radius: 10px;\n' +
    '  background: light-dark(#FFFFFF, #1C2229);\n' +
    '  box-shadow: 0 1px 2px rgba(0,0,0,.10), 0 10px 28px rgba(0,0,0,.08); }\n' +
    '.marchio { margin: 0; text-align: center; font-family: Georgia, "Times New Roman", serif;\n' +
    '  font-style: italic; font-weight: 400; font-size: 28px; letter-spacing: .2px; }\n' +
    '.riga { margin: 6px 0 22px; text-align: center; font-size: 12px;\n' +
    '  color: light-dark(#6B7280, #9AA4B0); }\n' +
    '.errore { margin: 0 0 12px; text-align: center; font-size: 13px;\n' +
    '  color: light-dark(#B91C1C, #F87171); }\n' +
    '.campo { width: 100%; height: 44px; padding: 0 12px; font-size: 16px; border-radius: 8px;\n' +
    '  border: 1px solid light-dark(#D1D5DB, #3A424D);\n' +
    '  background: light-dark(#FFFFFF, #14181D); color: inherit; }\n' +
    '.campo:focus { outline: 2px solid light-dark(#111827, #E8EBEF); outline-offset: 1px; }\n' +
    '.entra { width: 100%; height: 44px; margin-top: 12px; border: 0; border-radius: 8px;\n' +
    '  font-size: 15px; font-weight: 600; cursor: pointer;\n' +
    '  background: light-dark(#111827, #E8EBEF); color: light-dark(#FFFFFF, #111827); }\n' +
    '.entra:active { opacity: .88; }\n' +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<main class="card">\n' +
    '<h1 class="marchio">I Miei Turni</h1>\n' +
    '<p class="riga">Turni del Pronto Soccorso — DEA e OSG</p>\n' +
    inner +
    '</main>\n' +
    '</body>\n' +
    '</html>\n';
}

function loginPage(message) {
  const errore = message ? '<p class="errore">' + escapeHtml(message) + '</p>\n' : '';
  return shellPage(
    '<form method="post" action="/login">\n' +
    errore +
    '<input class="campo" type="password" name="password" autocomplete="current-password"\n' +
    '       placeholder="Password" autofocus required aria-label="Password">\n' +
    '<button class="entra" type="submit">Entra</button>\n' +
    '</form>\n'
  );
}

// Pagina neutra per gli errori: all'utente non arriva mai il dettaglio.
function neutralPage() {
  return shellPage('<p class="errore">' + escapeHtml(MSG_SERVIZIO) + '</p>\n');
}

// ============================================================
// La pagina dei turni, dal bundle
// ============================================================

// Import pigro e in un solo posto: se worker-page.js non è ancora stato generato
// il Worker resta caricabile (i test lo importano senza build) e la mancanza
// diventa un 500 con messaggio nei log. Wrangler risolve l'import in fase di
// bundle, quindi in produzione non c'è nessun caricamento dinamico a runtime.
let pagePromise = null;

function bundledPage() {
  if (pagePromise === null) {
    pagePromise = import('./worker-page.js')
      .then(function (mod) {
        const page = (mod && mod.PAGE) || (mod && mod.default && mod.default.PAGE);
        return typeof page === 'string' ? page : '';
      })
      .catch(function (err) {
        console.error('Pagina non disponibile nel bundle: ' + errText(err));
        return '';
      });
  }
  return pagePromise;
}

// `env.__PAGE` è la presa per i test: qualunque stringa (anche vuota, per
// simulare la build mancante) vince sul bundle. In produzione non esiste nessun
// binding con questo nome, quindi la pagina arriva sempre dal bundle.
async function resolvePage(env) {
  if (env && typeof env.__PAGE === 'string') return env.__PAGE;
  return await bundledPage();
}

// Inietta il ruolo nella pagina: al posto del segnaposto <!--ROLE--> se c'è,
// altrimenti subito dopo il tag <body>. Nient'altro della pagina viene toccato.
function injectRole(page, role) {
  const tag = '<script>window.TURNI_ROLE="' + role + '";</script>';
  if (page.indexOf('<!--ROLE-->') !== -1) {
    return page.replace('<!--ROLE-->', function () { return tag; });
  }
  const body = /<body[^>]*>/i.exec(page);
  if (body) {
    const cut = body.index + body[0].length;
    return page.slice(0, cut) + '\n' + tag + page.slice(cut);
  }
  return tag + page;
}

// ============================================================
// Freno ai tentativi: un contatore per IP in KV, TTL 10 minuti.
// KV è a consistenza eventuale, quindi il conto è una stima: va bene, serve a
// rallentare chi prova a forza bruta, non a contare con precisione. Se KV non
// c'è o non risponde si prosegue senza freno, con una riga nei log.
// ============================================================

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}

async function readFailures(env, ip) {
  if (!env.TURNI || !ip) {
    if (!env.TURNI) console.warn('Freno ai tentativi disattivato: binding KV TURNI assente.');
    return 0;
  }
  try {
    const raw = await env.TURNI.get(KV_TRY_PREFIX + ip);
    const count = raw === null || raw === undefined ? 0 : parseInt(raw, 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch (err) {
    console.warn('Freno ai tentativi disattivato, KV non raggiungibile in lettura: ' + errText(err));
    return 0;
  }
}

async function noteFailure(env, ip, current) {
  if (!env.TURNI || !ip) return;
  try {
    await env.TURNI.put(KV_TRY_PREFIX + ip, String(current + 1), { expirationTtl: TRY_TTL });
  } catch (err) {
    console.warn('Freno ai tentativi disattivato, KV non raggiungibile in scrittura: ' + errText(err));
  }
}

async function clearFailures(env, ip) {
  if (!env.TURNI || !ip) return;
  try {
    await env.TURNI.delete(KV_TRY_PREFIX + ip);
  } catch (err) {
    console.warn('Contatore tentativi non azzerato, KV non raggiungibile: ' + errText(err));
  }
}

// ============================================================
// Corpo della richiesta
// ============================================================

async function readBody(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { tooBig: true, text: '' };
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) return { tooBig: true, text: '' };
  return { tooBig: false, text: decoder.decode(buffer) };
}

// Forma attesa: { generatedAt: stringa, rosters: [ { hospital, month, slots, days } ] }.
// Torna null se va bene, altrimenti il messaggio da mostrare.
function validateTurni(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'Il corpo deve essere un oggetto JSON.';
  }
  if (typeof data.generatedAt !== 'string' || data.generatedAt === '') {
    return 'Campo "generatedAt" mancante o non valido.';
  }
  if (!Array.isArray(data.rosters)) {
    return 'Campo "rosters" mancante o non è un elenco.';
  }
  for (let i = 0; i < data.rosters.length; i++) {
    const roster = data.rosters[i];
    const dove = 'rosters[' + i + ']';
    if (!roster || typeof roster !== 'object' || Array.isArray(roster)) {
      return dove + ' non è un oggetto.';
    }
    if (typeof roster.hospital !== 'string' || roster.hospital === '') {
      return dove + ': campo "hospital" mancante o non valido.';
    }
    if (typeof roster.month !== 'string' || !/^\d{4}-\d{2}$/.test(roster.month)) {
      return dove + ': campo "month" non nel formato AAAA-MM.';
    }
    if (!Array.isArray(roster.slots)) {
      return dove + ': campo "slots" non è un elenco.';
    }
    if (!Array.isArray(roster.days)) {
      return dove + ': campo "days" non è un elenco.';
    }
  }
  return null;
}

// ============================================================
// Rotte
// ============================================================

async function handleRoot(request, env, nowSec) {
  const role = await sessionRole(request, env, nowSec);
  if (!role) return htmlResponse(loginPage(''), 200);

  const page = await resolvePage(env);
  if (!page) {
    console.error('Pagina dei turni assente dal bundle: eseguire "node build.js" prima del deploy.');
    return htmlResponse(neutralPage(), 500);
  }
  return htmlResponse(injectRole(page, role), 200);
}

async function handleLogin(request, env, nowSec) {
  const ip = clientIp(request);
  const failures = await readFailures(env, ip);
  if (failures >= TRY_LIMIT) {
    return htmlResponse(loginPage(MSG_TROPPI_TENTATIVI), 429, { 'Retry-After': String(TRY_TTL) });
  }

  const body = await readBody(request, MAX_LOGIN_BYTES);
  const password = body.tooBig ? '' : (new URLSearchParams(body.text).get('password') || '');

  // Le due verifiche girano sempre entrambe: nessun ramo corto che riveli quale
  // password era vicina o quale ruolo esiste. Prima gestore, poi medico.
  const given = utf8(password);
  const isGestore = equalBytes(given, utf8(env.PASS_GESTORE));
  const isMedico = equalBytes(given, utf8(env.PASS_MEDICO));
  const role = isGestore ? ROLE_GESTORE : (isMedico ? ROLE_MEDICO : null);

  if (!role) {
    await noteFailure(env, ip, failures);
    return htmlResponse(loginPage(MSG_PASSWORD_ERRATA), 200);
  }

  await clearFailures(env, ip);
  const value = await createSessionValue(role, env.SESSION_SECRET, nowSec);
  return new Response(null, {
    status: 303,
    headers: securityHeaders({ Location: '/', 'Set-Cookie': sessionCookie(value) })
  });
}

function handleLogout() {
  return new Response(null, {
    status: 303,
    headers: securityHeaders({ Location: '/', 'Set-Cookie': clearedCookie() })
  });
}

async function handleDataGet(request, env, nowSec) {
  const role = await sessionRole(request, env, nowSec);
  if (!role) return jsonResponse({ error: 'Accesso richiesto.' }, 401);
  if (!env.TURNI) {
    console.error('Binding KV TURNI assente: impossibile leggere i turni.');
    return jsonResponse({ error: 'Archivio non disponibile.' }, 500);
  }

  let stored;
  try {
    stored = await env.TURNI.get(KV_DATA_KEY);
  } catch (err) {
    console.error('Lettura da KV non riuscita: ' + errText(err));
    return jsonResponse({ error: 'Archivio non disponibile.' }, 503);
  }
  if (stored === null || stored === undefined) {
    return jsonResponse({ error: 'Nessun turno pubblicato.' }, 404);
  }

  const headers = securityHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(stored, { status: 200, headers: headers });
}

async function handleDataPut(request, env, nowSec) {
  const role = await sessionRole(request, env, nowSec);
  if (!role) return jsonResponse({ error: 'Accesso richiesto.' }, 401);
  if (role !== ROLE_GESTORE) {
    return jsonResponse({ error: 'Non hai i permessi per aggiornare i turni.' }, 403);
  }
  if (!env.TURNI) {
    console.error('Binding KV TURNI assente: impossibile salvare i turni.');
    return jsonResponse({ error: 'Archivio non disponibile.' }, 500);
  }

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return jsonResponse({ error: 'Serve Content-Type: application/json.' }, 400);
  }

  const body = await readBody(request, MAX_JSON_BYTES);
  if (body.tooBig) {
    return jsonResponse({ error: 'Il file dei turni supera i 2 MB.' }, 413);
  }

  let data;
  try {
    data = JSON.parse(body.text);
  } catch (err) {
    return jsonResponse({ error: 'JSON non valido.' }, 400);
  }
  const problema = validateTurni(data);
  if (problema) return jsonResponse({ error: problema }, 400);

  try {
    await env.TURNI.put(KV_DATA_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Scrittura su KV non riuscita: ' + errText(err));
    return jsonResponse({ error: 'Salvataggio non riuscito, riprova.' }, 503);
  }
  return jsonResponse({ ok: true, rosters: data.rosters.length }, 200);
}

// ============================================================
// Calendario: un indirizzo per persona, da dare in pasto al telefono
// ============================================================

// Lo slug è il nome "piegato" (via accenti, apostrofi, spazi e punti) in
// minuscolo: FLORENZAN → florenzan, "DI VITA F." → divitaf, "D'AMORE" → damore.
// Serve solo a rendere leggibile l'indirizzo: non è un segreto.
function calSlug(person) {
  return TurniRules.fold(person).toLowerCase();
}

// La firma è la chiave d'accesso: primi 22 caratteri base64url dell'HMAC del
// nome vero (non dello slug, che è ambiguo per costruzione). 22 caratteri sono
// circa 132 bit: non si indovina. Si revocano tutte cambiando SESSION_SECRET.
async function calSignature(secret, person) {
  const full = base64urlEncode(await hmacSha256(secret, CAL_MESSAGE + person));
  return full.slice(0, CAL_SIG_LEN);
}

// "/cal/<slug>-<firma>.ics" → { slug, signature }, oppure null se l'indirizzo
// non ha quella forma. Lo slug non contiene mai un trattino (fold tiene solo
// A-Z), quindi il primo trattino è sempre quello che separa i due pezzi.
function parseCalPath(path) {
  if (path.indexOf(CAL_PREFIX) !== 0) return null;
  const file = path.slice(CAL_PREFIX.length);
  if (file.slice(-4) !== '.ics') return null;
  const stem = file.slice(0, -4);
  const dash = stem.indexOf('-');
  if (dash <= 0) return null;
  const slug = stem.slice(0, dash);
  const signature = stem.slice(dash + 1);
  if (!/^[a-z]+$/.test(slug)) return null;
  if (signature.length !== CAL_SIG_LEN || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  return { slug: slug, signature: signature };
}

// I turni salvati, già ridotti a elenco di assegnazioni; null se non c'è niente
// da leggere. KV assente, vuoto, irraggiungibile o con dentro qualcosa di rotto
// valgono tutti la stessa cosa: chi chiede il calendario riceve un 404.
async function readAssignments(env) {
  if (!env.TURNI) {
    console.error('Binding KV TURNI assente: impossibile leggere i turni.');
    return null;
  }
  let stored;
  try {
    stored = await env.TURNI.get(KV_DATA_KEY);
  } catch (err) {
    console.error('Lettura da KV non riuscita: ' + errText(err));
    return null;
  }
  if (stored === null || stored === undefined) return null;
  try {
    const data = JSON.parse(stored);
    const rosters = data && Array.isArray(data.rosters) ? data.rosters : [];
    return TurniRules.buildAssignments(rosters);
  } catch (err) {
    console.error('Turni salvati non utilizzabili: ' + errText(err));
    return null;
  }
}

// Il nome vero il cui slug è quello chiesto. Nessuna corrispondenza, oppure due
// nomi diversi che si piegano allo stesso slug (un refuso tipo "DAMORE" accanto
// a "D'AMORE"): null, cioè 404 — non sapendo quale dei due sia non si può
// nemmeno ricalcolare la firma, e tirare a indovinare mostrerebbe i turni
// sbagliati a qualcuno.
function personBySlug(assignments, slug) {
  let found = null;
  for (let i = 0; i < assignments.length; i++) {
    const person = assignments[i].person;
    if (calSlug(person) !== slug) continue;
    if (found === null) found = person;
    else if (found !== person) return null;
  }
  return found;
}

// GET /cal/<slug>-<firma>.ics — nessuna sessione: la chiave sta nell'indirizzo,
// perché l'app del calendario interroga senza cookie. Ogni intoppo (indirizzo
// storto, nome assente, slug ambiguo, firma diversa, KV vuoto) esce allo stesso
// modo, 404 a corpo vuoto: da fuori non si capisce nemmeno se il nome esista.
async function handleCalendar(request, env) {
  const parsed = parseCalPath(new URL(request.url).pathname);
  if (parsed === null) return notFound();

  const assignments = await readAssignments(env);
  if (assignments === null) return notFound();

  const person = personBySlug(assignments, parsed.slug);
  if (person === null) return notFound();

  const expected = await calSignature(env.SESSION_SECRET, person);
  if (!equalBytes(utf8(parsed.signature), utf8(expected))) return notFound();

  // Tutti i mesi presenti in KV: chi si iscrive una volta se li ritrova tutti.
  const ics = TurniRules.buildICS(assignments, person);
  const headers = securityHeaders();
  headers.set('Content-Type', 'text/calendar; charset=utf-8');
  headers.set('Cache-Control', 'private, max-age=' + CAL_MAX_AGE);
  return new Response(ics, { status: 200, headers: headers });
}

// GET /cal-link?nome=<nome> — con la sessione (qualunque ruolo). È l'unico modo
// in cui la pagina può conoscere la firma, perché il segreto sta solo qui.
// Il nome chiesto si risolve attraverso lo slug, così "florenzan" e "FLORENZAN"
// portano allo stesso indirizzo e i casi ambigui vengono rifiutati qui, invece
// di consegnare un indirizzo che poi darebbe 404.
async function handleCalLink(request, env, nowSec) {
  const role = await sessionRole(request, env, nowSec);
  if (!role) return jsonResponse({ error: 'Accesso richiesto.' }, 401);

  const url = new URL(request.url);
  const slug = calSlug(url.searchParams.get('nome') || '');
  if (slug === '') return jsonResponse({ error: MSG_NOME_NON_TROVATO }, 404);

  const assignments = await readAssignments(env);
  const person = assignments === null ? null : personBySlug(assignments, slug);
  if (person === null) return jsonResponse({ error: MSG_NOME_NON_TROVATO }, 404);

  const signature = await calSignature(env.SESSION_SECRET, person);
  const path = CAL_PREFIX + calSlug(person) + '-' + signature + '.ics';
  return jsonResponse({
    url: 'https://' + url.host + path,
    webcal: 'webcal://' + url.host + path
  }, 200);
}

// ============================================================
// Instradamento
// ============================================================

function missingSecrets(env) {
  return SECRET_NAMES.filter(function (name) {
    return !env || typeof env[name] !== 'string' || env[name] === '';
  });
}

async function route(request, env) {
  const missing = missingSecrets(env);
  if (missing.length > 0) {
    console.error('Configurazione incompleta, mancano i secret: ' + missing.join(', ') +
      ' (impostarli con "npx wrangler secret put <NOME>").');
    return htmlResponse(neutralPage(), 500);
  }

  const path = new URL(request.url).pathname;
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const nowSec = Math.floor(Date.now() / 1000);
  let response;

  if (path === '/') {
    response = method === 'GET'
      ? await handleRoot(request, env, nowSec)
      : methodNotAllowed('GET, HEAD');
  } else if (path === '/login') {
    response = method === 'POST' ? await handleLogin(request, env, nowSec) : methodNotAllowed('POST');
  } else if (path === '/logout') {
    response = method === 'POST' ? handleLogout() : methodNotAllowed('POST');
  } else if (path === '/data/turni.json') {
    if (method === 'GET') response = await handleDataGet(request, env, nowSec);
    else if (method === 'PUT') response = await handleDataPut(request, env, nowSec);
    else response = methodNotAllowed('GET, HEAD, PUT');
  } else if (path === '/cal-link') {
    response = method === 'GET'
      ? await handleCalLink(request, env, nowSec)
      : methodNotAllowed('GET, HEAD');
  } else if (path.indexOf(CAL_PREFIX) === 0) {
    response = method === 'GET'
      ? await handleCalendar(request, env)
      : methodNotAllowed('GET, HEAD');
  } else {
    response = notFound();
  }

  if (request.method === 'HEAD' && response.body) {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}

async function fetchHandler(request, env) {
  try {
    return await route(request, env);
  } catch (err) {
    // Rete di sicurezza: all'utente la pagina neutra, il dettaglio solo nei log.
    console.error('Errore non gestito: ' + errText(err));
    return htmlResponse(neutralPage(), 500);
  }
}

export default { fetch: fetchHandler };
