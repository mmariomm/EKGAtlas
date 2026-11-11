#!/usr/bin/env node
/*
 * Il ponte verso l'iPhone, tutto vero: l'estensione caricata in Chromium col
 * gestionale simulato, il ripetitore Node (la stessa logica del Worker del
 * sito) e l'app del telefono in un secondo browser, in formato iPhone, con la
 * sua rete fra lei e il ripetitore (per perdere messaggi, come il 5G).
 * ⋯ → iPhone dentro il pannello (una cornice dell'estensione, e la scheda
 * quando la cornice non si apre), associazione dal QR (una volta, un telefono solo), elenco, esiti con
 * «Aggiorna i valori», un ordine dal telefono fino alle etichette (il doppio
 * tocco, la risposta persa), nota e promemoria, la spia sul PC, i 3 minuti
 * senza comandi, «Scollega», un altro dispositivo, la pagina ricaricata, il
 * battito, la revoca, la scadenza, la pagina d'accesso del gestionale, i
 * messaggi ripetuti o manomessi, nessun gestionale aperto, il service worker
 * che si riavvia, il browser chiuso e riaperto, «Stampa un PDF» sull'A4 del
 * PC, «Scansiona il QR» con una fotocamera finta — e il ripetitore che non vede
 * mai niente in chiaro. In fondo, la prova della rete, e l'app al buio.
 *   node test/ext-ponte.mjs
 */
import { chromium } from "playwright";
import { createMock, refertoRxPdf } from "./gestionale-vero.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "../public/ponte/cripto.js"));
const P = globalThis.PonteCripto;
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-ponte-" + process.pid);
const SHOTS = process.env.TEST_SHOTS_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\nponte: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, nome) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, nome + ".png") }).catch((e) => console.log(`  (foto ${nome} non salvata: ${String(e.message).split("\n")[0]})`)); };
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) if (await fn()) return true;
  return false;
}

// ---- il ripetitore, che registra tutto quello che inoltra -----------------
const inoltrati = [];
const relay = await avviaRelay({ osserva: (b) => inoltrati.push(b) });

// ---- il gestionale: ROSSI MARIO (con i prelievi da leggere) e BIANCHI ANNA --
const CF_A = "RSSMRA60A01F205Z", CF_B = "BNCNNA75C41F205K";
// l'età di BIANCHI (nata il 1/3/1975), che la sua testata non dice: dal codice fiscale
const ETA_B = new Date().getFullYear() - 1975 - (new Date().getMonth() < 2 ? 1 : 0);
let A, B;
const nuovi = () => {
  A = createMock({ withResults: true, cf: CF_A });
  B = createMock({ name: "BIANCHI ANNA", episodeId: "999002", cf: CF_B });
  B.state.nextRichiestaId = 800001;
};
nuovi();
const quale = (url) => {
  const p = new URL(url).searchParams;
  if (p.get("EPISODIO_ID") === "999002" || Number(p.get("RICHIESTA_ID")) >= 800000) return B;
  return A;
};
let lento = 0;
let lentoRef = 0;    // i documenti dei referti arrivano dopo tanti ms
let login = false;   // il gestionale risponde con la pagina d'accesso (sessione scaduta)
// la pagina di ROSSI passa prima da un'altra: «ponte» (una pagina che porta da sé alla sua), «lista» (la lista dei pazienti)
const PASSA = { n: 0, tipo: "" };
// la testata della scheda del paziente, com'è nel gestionale: il triage, il
// nome e, in corpo 120%, la data di nascita con l'età — di ROSSI 77 anni
// (non i 66 del suo codice fiscale: conta la testata); quella di BIANCHI non la dice
const riquadro = (nome, triage, ep, cf, nascita) => `<table><tr><td title="${triage}"><font style="font-size: 120%; font-weight: bolder; ">${ep}</font><br><font style="font-size: 150%; font-weight: bolder; ">${nome}</font><br>${
  nascita ? `<font style="font-size: 120%; font-weight: bolder; ">${nascita}</font><br>` : ""}<font style="font-size: 120%; font-weight: bolder; ">${cf}</font></td></tr></table>`;
// La cartella di ROSSI: il modulo AmbulatorioPSO com'è nella pagina vera (i
// cinque campi, l'esame obiettivo di sola lettura se l'ha scritto un altro
// medico, «Conferma»), e il gestionale che lo riceve. Accesa solo nella sua sezione.
// (`altrove`: dopo «Conferma» il gestionale salva, ma risponde con un'altra pagina invece di quella del paziente)
const CART = { on: false, lento: 0, eoRo: true, ignora: "", altrove: false, post: [], campi: {}, arrivati: 0 };
let ALLERGIE_B = false;   // la pagina di BIANCHI porta il campo delle allergie (il suo «aperto dal telefono»)
let TRATTIENI = null;     // una promessa: la pagina di ROSSI, aperta in una scheda, arriva quando si compie (una lettura vista mentre va)
const TRATTENUTE = [];    // …e le schede che l'hanno chiesta intanto
const APERTE = [];        // ogni pagina di un paziente aperta in una scheda: { url, pg } (la richiesta vera, anche se l'evento «page» arriva tardi)
// (le schede dietro sulla pagina di un episodio, viste dal service worker: quelle che il medico non ha davanti)
const dietroSu = (ep) => sw.evaluate((e) => chrome.tabs.query({}).then((l) => l.filter((t) => !t.active && new RegExp(`EPISODIO_ID=${e}\\b`).test(t.pendingUrl || t.url || "")).length), ep);
const CART_NOMI = ["ANAMNESI", "ALLERGIE", "MALATTIE_PREGRESSE", "FARMACI_ASSUNTI", "ESAME_OBIETTIVO"];
const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const formCartella = (ep) => `<form method="post" name="AmbulatorioPSO" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${ep}">
  <table class="AFCFormTABLE"><tr><td class="AFCFieldCaptionTD">Anamnesi</td><td><textarea style="WIDTH: 90%" id="ANAMNESI" class="AFCTextarea" rows="3" name="ANAMNESI">${escH(CART.campi.ANAMNESI)}</textarea></td>
  <td class="AFCFieldCaptionTD">Allergie<br>Nega/Non riferisce <input id="ALLERGIE_NEGA" class="AFCInput" value="val" type="checkbox" name="ALLERGIE_NEGA"></td>
  <td><textarea id="ALLERGIE" class="AFCTextarea" rows="3" name="ALLERGIE">${escH(CART.campi.ALLERGIE)}</textarea></td></tr>
  <tr><td class="AFCFieldCaptionTD">Anamnesi Remota</td><td><textarea id="MALATTIE_PREGRESSE" class="AFCTextarea" rows="4" name="MALATTIE_PREGRESSE">${escH(CART.campi.MALATTIE_PREGRESSE)}</textarea></td>
  <td class="AFCFieldCaptionTD">Farmaci Assunti</td><td><textarea id="FARMACI_ASSUNTI" class="AFCTextarea" rows="4" name="FARMACI_ASSUNTI">${escH(CART.campi.FARMACI_ASSUNTI)}</textarea></td></tr>
  <tr><td class="AFCFieldCaptionTD">Esame obiettivo</td><td colspan="3"><textarea style="WIDTH: 95%" id="ESAME_OBIETTIVO" class="${CART.eoRo ? "JPSOReadonly" : "AFCTextarea"}" rows="6" name="ESAME_OBIETTIVO"${CART.eoRo ? ' readonly=""' : ""}>${escH(CART.campi.ESAME_OBIETTIVO)}</textarea></td></tr>
  <tr><td><input id="ESAMEOBIETTIVOAUTOSAVE" value="N" type="hidden" name="ESAMEOBIETTIVOAUTOSAVE"><input style="WIDTH: 90%" class="AFCInput" value="" maxlength="100" name="PERSONA_RIFERIMENTO"></td>
  <td colspan="3" align="right"><input class="AFCButton" value="Annulla OBI" type="submit" name="AnnullaOBI" style="display: none;"> <input class="AFCButton" value="Conferma" type="submit" name="Update"></td></tr></table></form>`;
// (il corpo del modulo, in windows-1252 come lo manda il browser)
const decodificaModulo = (buf) => Object.fromEntries(Buffer.from(buf || []).toString("latin1").split("&").filter(Boolean).map((kv) => {
  const d = (s) => s.replace(/\+/g, " ").replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const i = kv.indexOf("=");
  return i < 0 ? [d(kv), ""] : [d(kv.slice(0, i)), d(kv.slice(i + 1))];
}));
const LOGIN = `<html><head><title>Accesso</title></head><body><form name="Login" method="post" action="login.do"><input name="username"><input type="password" name="password"><input type="submit" value="Accedi"></form></body></html>`;

// il browser del PC (una funzione: lo si chiude e lo si riapre, con lo stesso profilo)
async function apriBrowser() {
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
});
// le stampe che si aprono, in tutte le schede del gestionale
await ctx.addInitScript(() => {
  if (window.top !== window || location.origin !== "https://smarthealth.multimedica.it") return;
  setInterval(() => {
    const w = document.getElementById("psassist-print");
    if (w && !w.dataset.contato) {
      w.dataset.contato = "1";
      const l = JSON.parse(localStorage.getItem("__psaStampe") || "[]");
      l.push({ titolo: document.title, url: location.href });
      localStorage.setItem("__psaStampe", JSON.stringify(l));
    }
  }, 25);
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  const u = req.url();
  if (login && /menuPsoEpisodio\.do/.test(u)) { await r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: LOGIN }); return; }
  if (lento && /Insert=Inserisci/.test(u)) await sospendi(lento);
  if (lentoRef && /Sa4ViewerExtRedirect\.do/.test(u) && /REFERTO_ID=/.test(u)) await sospendi(lentoRef);
  if (req.isNavigationRequest() && /MVPG=PsoEpisodioClinico/.test(u)) {   // (la pagina che si apre; gli esiti la leggono con un fetch, e passano)
    let pg = null;
    try { pg = req.frame().page(); } catch { /* la scheda non ha ancora la cornice */ }
    APERTE.push({ url: u, pg });
    if (TRATTIENI && /MVPG=PsoEpisodioClinicoAmbulatorio/.test(u) && quale(u) === A) { TRATTENUTE.push({ url: u, pg }); await TRATTIENI; }
  }
  if (PASSA.n > 0 && req.method() === "GET" && /MVPG=PsoEpisodioClinicoAmbulatorio/.test(u) && quale(u) === A) {
    PASSA.n--;
    const via = PASSA.tipo === "lista" ? A.worklistUrl : u;   // (la lista: ci si resta)
    const body = `<html><head><title>ROSSI MARIO</title></head><body><script>setTimeout(() => location.replace(${JSON.stringify(via)}), 800)</script></body></html>`;
    await r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(body, "latin1") });
    return;
  }
  // «Conferma» della cartella di ROSSI: il gestionale salva i campi (non quello che ignora) e risponde con la pagina del paziente
  let metodo = req.method();
  if (CART.on && metodo === "POST" && /ccsForm=AmbulatorioPSO(:|%3A)Edit/i.test(u) && quale(u) === A) {
    CART.arrivati++;   // (arrivato: il gestionale comincia a salvare)
    if (CART.lento) await sospendi(CART.lento);
    const f = decodificaModulo(req.postDataBuffer());
    CART.post.push(f);
    for (const n of CART_NOMI) if (n in f && n !== CART.ignora) CART.campi[n] = f[n].replace(/\r\n/g, "\n");
    if (CART.altrove) {
      try { await r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from("<html><head><title>PRONTO SOCCORSO - LISTA</title></head><body><p>Lista</p></body></html>", "latin1") }); } catch { /* chiusa */ }
      return;
    }
    metodo = "GET";
  }
  const mock = quale(u);
  let out = metodo !== req.method() ? mock.handle({ method: "GET", url: A.patientUrl }) : mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  if (/html/.test(out.headers["content-type"] || "") && /MVPG=PsoEpisodioClinicoAmbulatorio|^[^?]*\?EPISODIO_ID/.test(u)) {
    const m = quale(u), rossi = m === A;
    // (il referto di radiologia del banco è una TC, il cui testo il PC non legge più da solo
    // — si apre nel visore —: a ROSSI si aggiunge una radiografia, il cui testo sì)
    const rx = `<table><tr><td class="AFCDataTD" title="69-140 RX TORACE (A6900)"><a href="#" title="REFERTO" onclick="javascript:window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=*TEST00001&REFERTO_SISTEMA=HL7RIS&REFERTO_ID=dddd4444-0000-0000-0000-000000000004','HL7RIS')"><img alt="referto"></a>
      69-140 RX TORACE (A6900)<input type="hidden" name="DATA_ORD" value="2026-08-22 03:10:00.0"><input type="hidden" name="DESCRIZIONE_TITLE" value="69-140 RX TORACE (A6900)"></td></tr></table>`;
    let html0 = Buffer.from(out.body).toString("latin1");
    if (rossi && CART.on) html0 = html0.replace(/<form name="AmbulatorioPSO"[\s\S]*?<\/form>/, formCartella(m.state.episodeId));
    if (!rossi && ALLERGIE_B) html0 = html0.replace('<textarea name="DIARIO"></textarea>', '<textarea name="DIARIO"></textarea><textarea name="ALLERGIE">PENICILLINA</textarea>');
    const html = html0.replace("</body>", (rossi ? rx : "") + "</body>").replace("<body>", "<body>" + riquadro(rossi ? "ROSSI MARIO" : "BIANCHI ANNA", rossi ? "ARANCIONE" : "VERDE", m.state.episodeId, rossi ? CF_A : CF_B, rossi ? "17/05/1949 (77) M" : ""));
    out = { ...out, body: Buffer.from(html, "latin1") };
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa intanto */ }
});
return ctx;
}
let ctx = await apriBrowser();
const swDi = async (c) => c.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || c.waitForEvent("serviceworker", { timeout: 15000 });
let sw = await swDi(ctx);
const extId = new URL(sw.url()).host;
const EXTURL = (f) => `chrome-extension://${extId}/${f}`;
const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`);
// i bottoni della striscia: nella striscia, o nel chip in intestazione a pannello aperto
const AZIONE = "#strazione, #psassist-host #gchipaz", STOP = "#strstop, #psassist-host #gchipstop, #psassist-host #stopbtn";
const statoPonte = () => sw.evaluate(() => chrome.storage.session.get("ponte").then((o) => o.ponte || null));
const coppiaPc = () => sw.evaluate(() => chrome.storage.local.get("ponte.coppia").then((o) => o["ponte.coppia"] || null));
const registroPonte = async () => ((await statoPonte())?.registro || []).map((x) => x.testo).join("\n");
const nuovaPagina = (timeout = 15000) => ctx.waitForEvent("page", { timeout }).catch(() => null);
async function suPagina(p, url) {
  await p.goto(url);
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}
const registroPc = (p) => p.evaluate(() => Object.entries(sessionStorage).filter(([k]) => /^psassist:log\./.test(k)).map(([, v]) => (JSON.parse(v).lines || []).join("\n")).join("\n"));
// le righe arrivate nel Registro dopo `prima` (il Registro tiene le ultime 200: contarle non basta, una nuova
// in fondo ne fa uscire una in cima)
const registroRighe = (p) => p.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([k]) => /^psassist:log\./.test(k)).map(([k, v]) => [k, JSON.parse(v).lines || []])));
const righeDopo = (prima, dopo) => Object.entries(dopo).flatMap(([k, d]) => {
  const p = prima[k] || [];
  for (let n = 0; n <= d.length; n++) {
    const resto = d.slice(0, d.length - n);
    if (resto.length <= p.length && resto.every((x, i) => x === p[p.length - resto.length + i])) return d.slice(d.length - n);
  }
  return d;
});
const lunghezze = (r) => Object.entries(r).map(([k, l]) => `${k.replace("psassist:", "")} ${l.length}`).join(", ");

// ---- il telefono: un altro browser, in formato iPhone ---------------------
// (gli stessi PSA_CHROMIUM_ARGS del PC: con /dev/shm piccolo, senza --disable-dev-shm-usage il telefono si schianta aprendo i PDF)
const telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(), args: (process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean) });
const IPHONE = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "it-IT",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};
const telCtx = await telBrowser.newContext(IPHONE);
// l'orologio del telefono avanti o indietro, quando una prova lo chiede (sessionStorage «__salto», in ms)
const salto = () => { try { const x = Number(sessionStorage.getItem("__salto") || 0); if (x) { const v = Date.now; Date.now = () => v() + x; } } catch { /* about:blank */ } };
await telCtx.addInitScript(salto);
// La rete del telefono: ogni presa passa di qui. `perdi` = il numero di una
// presa di cui si perdono i messaggi cifrati dal PC (le risposte); `muta` =
// una presa che non porta più niente in nessun verso, nemmeno il «pong»;
// `ritarda` = quanti millisecondi trattenere i messaggi cifrati verso il PC.
const rete = { n: 0, prese: new Map(), ultima: 0, perdi: 0, muta: 0, ritarda: 0, dalPc: [], alPc: [] };
const chiusura = (code, reason) => (code === 1000 || (code >= 3000 && code <= 4999) ? { code, reason } : {});
await telCtx.routeWebSocket(/\/ponte\/ws/, (ws) => {
  const n = ++rete.n;
  const server = ws.connectToServer();
  rete.prese.set(n, { ws, server });
  rete.ultima = n;
  ws.onMessage((m) => {
    if (typeof m !== "string") rete.alPc.push(Buffer.from(m));
    if (rete.muta === n) return;
    if (rete.ritarda && typeof m !== "string") setTimeout(() => { try { server.send(m); } catch { /* chiusa intanto */ } }, rete.ritarda);
    else server.send(m);
  });
  server.onMessage((m) => {
    if (rete.muta === n) return;
    if (typeof m !== "string") rete.dalPc.push(Buffer.from(m));
    if (rete.perdi === n && typeof m !== "string") return;
    ws.send(m);
  });
  ws.onClose((code, reason) => server.close(chiusura(code, reason)));
  server.onClose((code, reason) => ws.close(chiusura(code, reason)));
});
const testoTel = (t) => t.locator("#app").innerText().catch(() => "");
async function aspettaTel(t, re, timeout = 20000) {
  const ok = await finche(async () => re.test(await testoTel(t)), timeout);
  return ok ? testoTel(t) : "";
}
const tocca = (t, sel) => t.locator(sel).first().click();
// tornati sull'app: l'elenco si rilegge da solo (nel ⋯ non c'è più «Aggiorna elenco»)
const rileggiTel = (t) => t.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const qrUrl = () => sw.evaluate(() => ponteQr());
// «Associa» sulla pagina iPhone del PC; con un telefono già entrato il bottone è «Nuovo QR», che butta fuori
// l'iPhone di prima e chiede il secondo tocco («Butto fuori l'iPhone? Tocca di nuovo»)
async function nuovoQr(pg) {
  await pg.locator("#associa").click();
  if (await finche(async () => /Tocca di nuovo/.test(await pg.locator("#associa").innerText()) || await pg.locator("#qr svg").isVisible(), 5000)
    && /Tocca di nuovo/.test(await pg.locator("#associa").innerText())) await pg.locator("#associa").click();
  await pg.waitForSelector("#qr svg", { timeout: 8000 });
}
// la chiave del telefono: ora la lista dei PC (pcs.v1) — l'associazione attiva
const chiaveTel = (t) => t.evaluate(() => {
  try {
    const o = JSON.parse(localStorage.getItem("psassist.ponte.pcs.v1") || "null");
    if (!o || !Array.isArray(o.v) || !o.v.length) return null;
    return o.v.find((p) => p.id === o.attivo) || o.v[0];
  } catch { return null; }
});
// i bottoni visibili più piccoli di 44 px (larghezza o altezza)
const piccoli = (t) => t.evaluate(() => [...document.querySelectorAll("#app button")].filter((b) => b.offsetParent).map((b) => {
  const r = b.getBoundingClientRect();
  // (i chip fitti delle Richieste: 38 px più 6 di vuoto = 44 di passo per ogni tocco)
  return { t: (b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height), fitto: !!b.closest(".gruppo, .q-w") };
}).filter((x) => x.fitto ? x.w < 38 || x.h < 38 : x.w < 44 || x.h < 44).map(({ fitto, ...x }) => x));

// ===========================================================================
sezione("il PC: il gestionale aperto, il ponte, il QR");
const doc = await ctx.newPage();
await suPagina(doc, A.patientUrl);
await suPagina(doc, B.patientUrl);
const pazPc = () => doc.evaluate(() => localStorage.getItem("psassist:patients.v1") || "[]");
const etaPc = async () => Object.fromEntries(JSON.parse(await pazPc()).map((p) => [p.name, p.eta]));
await finche(async () => (await etaPc())["BIANCHI ANNA"] != null, 8000);
check((await etaPc())["ROSSI MARIO"] === 77 && (await etaPc())["BIANCHI ANNA"] === ETA_B && !/\d{1,2}\/\d{1,2}\/\d{4}/.test(await pazPc()),
  `aperta la sua pagina, del paziente resta l'età — dalla testata (ROSSI 77), se no dal codice fiscale (BIANCHI ${ETA_B}) —, mai la data di nascita`);
// ROSSI sta nel letto OBI 2 della stanza (un posto messo dal medico); BIANCHI
// ha anche un episodio di stanotte (stesso codice fiscale); VERDI è in lista
// (senza la sua pagina)
await doc.evaluate(({ CF_B, bUrl }) => {
  const K = "psassist:patients.v1";
  const l = JSON.parse(localStorage.getItem(K) || "[]");
  const ora = Date.now();
  for (const p of l) if (p.ep === "999002") p.pk = "cf:" + CF_B;
  l.push({ ep: "998002", name: "BIANCHI ANNA", url: bUrl.replace("EPISODIO_ID=999002", "EPISODIO_ID=998002"), ts: ora - 5 * 3600e3, pk: "cf:" + CF_B, triage: "VERDE" });
  l.push({ ep: "999003", name: "VERDI LUCA", url: "", ts: ora - 40 * 60e3, pk: "", triage: "AZZURRO" });
  localStorage.setItem(K, JSON.stringify(l));
  localStorage.setItem("psassist:stanza.ps.posti.v1", JSON.stringify({ 999001: { tipo: "letto", id: "obi2", ts: ora } }));
  // le aree lette dalle liste del gestionale: in Alta BIANCHI (riga 1) e ROSSI (riga 2), VERDI in Bassa
  localStorage.setItem("psassist:aree.v1", JSON.stringify({ membri: { 999002: { k: "alta", ts: ora, n: 1 }, 999001: { k: "alta", ts: ora, n: 2 }, 999003: { k: "bassa", ts: ora, n: 1 } },
    viste: { alta: { label: "AREA ALTA INTENSITA'", ts: ora }, bassa: { label: "AREA BASSA INTENSITA'", ts: ora } } }));
  // VERDI (senza la sua pagina: nessuno lo rilegge) ha uno stato noto sul PC: il Lab
  // chiesto 50′ fa, l'RX 100′ fa (oltre la prima soglia: ambra), il cuore rosso
  const m = 60e3, S = JSON.parse(localStorage.getItem("psassist:stato.v1") || "{}");
  S[999003] = { righe: [{ k: "a", rid: "a", ts: ora - 50 * m, fatto: "", quando: 0, esami: [["lab", "EMOCROMO"]] }, { k: "b", rid: "b", ts: ora - 100 * m, fatto: "", quando: 0, esami: [["img", "RX TORACE"]] }],
    vit: { p: { fr: 26, spo2: 90, fc: 118, pas: 95, t: 38.6 }, ts: ora - 20 * m,
      storia: [{ ts: ora - 20 * m, p: { fr: 26, spo2: 90, fc: 118, pas: 95, t: 38.6 } }, { ts: ora - 80 * m, p: { fr: 18, spo2: 96, fc: 84, pas: 122, pad: 80, t: 36.8 } }, { ts: ora - 140 * m, p: { fr: 16, spo2: 97, fc: 80, pas: 120, t: 36.6 } }] }, agg: ora, letto: ora - 2 * m, esitiVisto: ora - 30 * m };
  localStorage.setItem("psassist:stato.v1", JSON.stringify(S));
  // «Febbre» ha imparato il suo pacchetto da un ordine confermato sul PC: emocromo POC e PCR
  localStorage.setItem("psassist:pacchettiImparati.v1", JSON.stringify({ febbre: [["00660001P", "320"], ["00720001P", "293"]] }));
}, { CF_B, bUrl: B.patientUrl });
await suPagina(doc, A.worklistUrl);   // il medico lascia il PC sulla lista

// ⋯ → iPhone: la pagina del ponte DENTRO il pannello, in una cornice
// dell'estensione — nessuna scheda nuova. (La cornice e non un disegno del
// pannello: l'ombra del pannello la pagina del gestionale la legge, una
// cornice dell'estensione no — e il QR porta la chiave.)
// una scheda del pannello; dalla vista «iPhone» (una schermata del ⋯, con «‹ iPhone» al posto delle schede) si torna col suo ‹
const allaScheda = async (p, seg) => {
  if (await $panel(p, ".seg.vmenu #back").count()) await $panel(p, ".seg.vmenu #back").click();
  await $panel(p, `[data-seg="${seg}"]`).click();
};
const corniceIn = async (p, timeout = 10000) => {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) {
    const f = p.frames().find((x) => x.url().startsWith(EXTURL("ponte.html")));
    if (f && await f.locator("#stato b").count().catch(() => 0)) return f;
  }
  return null;
};
await $panel(doc, "#expand").click();
await doc.waitForSelector("#psassist-host .card", { timeout: 8000 });
await $panel(doc, "#menubtn").click();
check(await $panel(doc, '.menu .msez[aria-label="Strumenti"] #pontemenu').count() === 1, "«iPhone» sta nel menu ⋯, fra gli Strumenti");
// la stessa emoji del menu ⋯ del telefono: 📱
const telIco = await doc.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector("#pontemenu .mico")?.textContent.trim() || "");
check(telIco === "📱", `l'icona dell'iPhone è la stessa del telefono (got «${telIco}»)`);
const nasce = nuovaPagina(4000);
await $panel(doc, "#pontemenu").click();
let ponte = await corniceIn(doc);
const nata = await nasce;
await sospendi(300);
// (le schede di sottofondo del gestionale, «Segue il gestionale», possono nascere intanto: conta che non sia la pagina del ponte)
const schedaPonte = ctx.pages().find((p) => p.url().startsWith("chrome-extension:") && /\/ponte\.html/.test(p.url()));
check(!schedaPonte && !(nata && /^chrome-extension:/.test(nata.url())), `⋯ → iPhone non apre una scheda nuova (${nata ? "nata: " + nata.url() : "nessuna scheda nata"})`);
check(!!ponte && await $panel(doc, ".card.iphone #ponteslot > iframe#pontecornice").count() === 1 && await $panel(doc, ".menu").count() === 0,
  `…apre la vista «iPhone» del pannello: la pagina del ponte in una cornice (got ${ponte && ponte.url()})`);
const srcCornice = await $panel(doc, "#pontecornice").getAttribute("src");
check(/^chrome-extension:\/\/[0-9a-f-]{36}\/ponte\.html$/.test(srcCornice) && !srcCornice.includes(extId),
  `la cornice si apre dall'indirizzo dinamico dell'estensione, non dal suo ID (${srcCornice})`);
check(await doc.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector("#pontecornice").contentDocument === null),
  "la pagina del gestionale vede la cornice ma non ci legge dentro (un'altra origine)");
const altoCornice = await $panel(doc, "#pontecornice").boundingBox(), altoCorpo = await $panel(doc, ".bd").boundingBox();
check(altoCornice && altoCorpo && Math.abs(altoCornice.y + altoCornice.height - (altoCorpo.y + altoCorpo.height)) <= 2 && altoCornice.height > 300,
  `la cornice prende tutto il corpo del pannello che resta (${altoCornice && Math.round(altoCornice.height)} px)`);
check(await ponte.evaluate(() => document.documentElement.classList.contains("cornice") && getComputedStyle(document.querySelector("h1")).display === "none" && getComputedStyle(document.body).paddingTop === "14px"),
  "dentro il pannello la pagina è compatta: niente testata, niente margini di pagina");
check(/\(ekg-atlas\.whirly\.workers\.dev\)/.test(await ponte.locator("#dove").innerText()) && !(await ponte.locator("#associa").isDisabled()) && /Nessun iPhone associato/.test(await ponte.locator("#stato").innerText()),
  `l'indirizzo del ponte è quello fissato nella build (ponte/host.txt): ekg-atlas.whirly.workers.dev (${await ponte.locator("#dove").innerText()})`);
check(await ponte.locator("input").count() === 0, "l'indirizzo del ponte non si scrive in nessuna pagina: niente campo");
// (per le prove, e solo verso questo PC: il ripetitore locale)
await sw.evaluate((u) => chrome.storage.local.set({ "ponte.host": u }).then(() => ponteAvvia()), relay.url);
// via dalla vista, la cornice se ne va; ⋯ → iPhone di nuovo, una cornice nuova (che legge il ripetitore locale)
await allaScheda(doc, "eo");
check(await $panel(doc, "#pontecornice").count() === 0 && !doc.frames().some((f) => f.url().includes("/ponte.html")), "lasciata la vista «iPhone», la cornice non c'è più");
await $panel(doc, "#menubtn").click();
await $panel(doc, "#pontemenu").click();
ponte = await corniceIn(doc);
await ponte.locator("#associa").click();
await ponte.waitForSelector("#qr svg", { timeout: 8000 });
const url1 = await qrUrl();
check(url1.startsWith(relay.url + "/ponte/#k=") && /&scade=\d+$/.test(url1), `il QR porta all'app, con la chiave nel frammento (${url1.slice(0, 40)}…)`);
const K1 = P.leggiFrammento(new URL(url1).hash).k, CH1 = await P.chiaviCoppia(K1);
const scade1 = Number(/scade=(\d+)/.exec(url1)[1]);
check(Math.abs(scade1 - Date.now() - 5 * 60e3) < 60e3, "il link del QR vale pochi minuti (5), non un turno: la scadenza nel frammento è quella del primo scambio");
const codice1 = (await ponte.locator("#qrcodice").innerText()).trim();
check(codice1 === await P.codice(K1), `accanto al QR, il codice dell'associazione: ${codice1}`);
const pagina = `${await ponte.locator("#stato").innerText()}\n${await ponte.locator("#qrsec").innerText()}`;
check(pagina.split(codice1).length === 2 && (pagina.match(/fino alle \d\d:\d\d/g) || []).length === 1 && /^\d\d:\d\d$/.test(await ponte.locator("#qrscade").innerText()),
  `il codice e l'ora di fine una volta sola, accanto al QR (${(await ponte.locator("#stato").innerText()).replace(/\n/g, " / ")})`);
const cp = await coppiaPc();
check(cp && cp.k === P.b64u(K1) && !("scade" in cp) && cp.creata + 5 * 60e3 === scade1, "sul PC la chiave sta in storage.local, senza scadenza dell'associazione (regge il browser chiuso: più sotto)");
check(await finche(async () => (await statoPonte())?.relay === "su", 10000), "il PC è collegato al ponte");
check(relay.prese().pc === 1, "sul ripetitore: una presa del PC");
await ponte.locator("#qrvia").click();
check(/Mostra il QR/.test(await ponte.locator("#associa").innerText()), "nascosto il QR, nei primi due minuti: «Mostra il QR»");
await ponte.locator("#associa").click();
await ponte.waitForSelector("#qr svg", { timeout: 8000 });
check(await qrUrl() === url1, "…e mostra lo stesso");
// il pannello si ridisegna (il menu aperto e chiuso), si riduce e si riapre: la cornice è la stessa, col QR davanti
await ponte.evaluate(() => { window.__stessa = 1; });
await $panel(doc, "#menubtn").click();
await $panel(doc, "#menubtn").click();
await $panel(doc, "#collapse").click();
check(await $panel(doc, ".card").count() === 0 && await doc.evaluate(() => !!document.querySelector("#psassist-host > iframe#pontecornice")), "ridotto il pannello, la cornice aspetta da parte (non si vede)");
await $panel(doc, "#expand").click();
await doc.waitForSelector("#psassist-host .card #pontecornice", { timeout: 5000 });
ponte = await corniceIn(doc);
check(await ponte.evaluate(() => window.__stessa) === 1 && await ponte.locator("#qr svg").count() === 1 && (await ponte.locator("#qrcodice").innerText()).trim() === codice1,
  "ridisegnato, ridotto e riaperto: la stessa pagina, senza ricaricarsi, col QR e il codice ancora lì");
await shot(doc, "pc-1-qr-associazione");

// ===========================================================================
sezione("⋯ → iPhone al passaggio, Esc, «Prova la rete» dalla cornice, e la cornice che non si apre");
const g = await ctx.newPage();
await suPagina(g, A.worklistUrl);
await sospendi(400);
const apertaG = async () => (await $panel(g, ".card").count()) === 1;
// al passaggio (la forma di partenza): il mouse fermo sulla pill la apre, senza fissarla
const pillG = await $panel(g, "#expand").boundingBox();
await g.mouse.move(pillG.x + pillG.width / 2, pillG.y + pillG.height / 2, { steps: 3 });
await sospendi(700);
check(await apertaG() && await $panel(g, "#pinpill[aria-pressed=false]").count() === 1, "(al passaggio: aperta dal mouse, non fissata)");
const menuG = await $panel(g, "#menubtn").boundingBox();
await g.mouse.move(menuG.x + menuG.width / 2, menuG.y + menuG.height / 2, { steps: 4 });
await $panel(g, "#menubtn").click();
await $panel(g, "#pontemenu").click();
const pg = await corniceIn(g);
await g.mouse.move(4, 760, { steps: 4 });
await sospendi(1300);
check(!!pg && await apertaG() && await $panel(g, "#pontecornice").count() === 1,
  "al passaggio, uscito il mouse, la vista «iPhone» resta aperta (il mouse nella cornice non si vede, e col QR la mano va al telefono)");
await pg.locator('a[href="ponte-prova.html"]').focus();
const fuocoDentro = await pg.evaluate(() => document.hasFocus() && document.activeElement?.tagName === "A");
await g.keyboard.press("Escape");
check(fuocoDentro && await finche(async () => !(await apertaG()), 4000), "Esc dentro la cornice (il fuoco è lì) riduce il pannello, come Esc nel pannello");
// «Prova la rete» dalla cornice: in una scheda sua (la tenuta di 15 minuti deve reggere i cambi di pagina del gestionale)
await $panel(g, "#expand").click();
const pg2 = await corniceIn(g);
const nasceProva = nuovaPagina(8000);
const inoltrati0 = inoltrati.length;
await pg2.locator('a[href="ponte-prova.html"]').click();
const provaDaCornice = await nasceProva;
check(!!provaDaCornice && provaDaCornice.url() === EXTURL("ponte-prova.html"), `«Prova la rete» dalla cornice apre la prova in una scheda sua (got ${provaDaCornice && provaDaCornice.url()})`);
// (finita la prova — la sua stanza è buttata — prima di andare avanti col ripetitore)
await provaDaCornice?.waitForFunction(() => !document.getElementById("ancora").disabled, null, { timeout: 30000 }).catch(() => {});
await provaDaCornice?.close();
// (i suoi cinque messaggi — [i, 1, 2, 3], nella stanza di prova — non sono del ponte: fuori dal conto del ripetitore, più sotto)
const diProva = (b) => b.length === 4 && b[1] === 1 && b[2] === 2 && b[3] === 3;
inoltrati.push(...inoltrati.splice(inoltrati0).filter((b) => !diProva(b)));
await g.bringToFront();
// Una cornice che non si apre. Qui la pagina le rimette l'indirizzo statico
// dell'estensione — che una pagina web non può aprire (use_dynamic_url): è
// bloccata come lo sarebbe su un'origine fuori dal manifest. La pagina
// dell'iPhone va in una scheda, come prima, e il pannello lo dice.
await allaScheda(g, "eo");
await g.evaluate((id) => {
  const r = document.getElementById("psassist-host").shadowRoot;
  new MutationObserver(() => {
    const f = r.querySelector("#pontecornice");
    if (f && !f.dataset.rotta) { f.dataset.rotta = "1"; f.src = `chrome-extension://${id}/ponte.html`; }
  }).observe(r, { childList: true, subtree: true });
}, extId);
const nasceScheda = nuovaPagina(15000);
await $panel(g, "#menubtn").click();
await $panel(g, "#pontemenu").click();
const scheda = await nasceScheda;
check(!!scheda && scheda.url() === EXTURL("ponte.html"), `la cornice non si apre: la pagina dell'iPhone si apre in una scheda, come prima (got ${scheda && scheda.url()})`);
const detto = await finche(async () => /non si apre nel pannello/.test(await $panel(g, ".bd").innerText().catch(() => "")) && /in una scheda sua/.test(await $panel(g, ".bd").innerText().catch(() => "")), 5000);
check(detto && await $panel(g, "#pontecornice").count() === 0 && await $panel(g, "#ponteapri").count() === 1,
  `e il pannello lo dice, con «Aprila in una scheda» (${(await $panel(g, ".bd").innerText().catch(() => "")).replace(/\n+/g, " / ").slice(0, 140)})`);
await shot(g, "pc-8-iphone-in-una-scheda");
if (scheda) {
  await scheda.waitForSelector("#stato b", { timeout: 10000 }).catch(() => {});
  check(/iPhone|associat/.test(await scheda.locator("#stato").innerText().catch(() => "")) && !(await scheda.evaluate(() => document.documentElement.classList.contains("cornice"))),
    "nella scheda, la pagina intera di sempre, e il service worker le risponde");
  await scheda.close();
}
const nasceScheda2 = nuovaPagina(8000);
await $panel(g, "#ponteapri").click();
const scheda2 = await nasceScheda2;
check(!!scheda2 && scheda2.url() === EXTURL("ponte.html"), "«Aprila in una scheda» la riapre");
await scheda2?.close();
await g.close();
await doc.bringToFront();

// ===========================================================================
sezione("l'iPhone: il QR, una volta");
const tel = await telCtx.newPage();
tel.on("pageerror", (e) => console.log("  PAGEERR " + String(e.stack).slice(0, 500)));
await tel.goto(url1);
const lista = await aspettaTel(tel, /ROSSI MARIO/, 20000);
check(/ROSSI MARIO/.test(lista) && /BIANCHI ANNA/.test(lista), "inquadrato il QR: l'elenco dei pazienti del PC");
const associato = await aspettaTel(tel, /Associato · codice/, 6000);
check(new RegExp(`Associato · codice ${codice1}`).test(associato),
  `appena associato, per un momento lo stesso codice del PC (${codice1}): il momento in cui lo si confronta con quello sotto il QR`);
check(!(await tel.evaluate(() => location.hash)), "il frammento con la chiave non resta nell'indirizzo");
const salvato = await tel.evaluate(() => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
const sv = salvato.length === 1 ? JSON.parse(salvato[0][1]) : {};
const pc0 = sv && Array.isArray(sv.v) && sv.v.length === 1 ? sv.v[0] : null;
check(salvato.length === 1 && salvato[0][0] === "psassist.ponte.pcs.v1" && pc0 && Object.keys(pc0).sort().join() === "dev,id,k,kind,nome" && !/ROSSI|BIANCHI/.test(salvato[0][1]),
  "sul telefono resta solo la lista dei PC (chiave, numero del telefono, tipo e nome): nessun paziente, nessuna scadenza");
const titoli = JSON.stringify(await tel.locator(".lbl").evaluateAll((l) => l.map((x) => x.textContent)));
const fila = (await tel.locator("main > .carta").first().locator(".paz .nome").allInnerTexts()).join(",");
check(/OBI 2/.test(lista) && titoli === '["Alta intensità","Bassa"]' && /^BIANCHI ANNA,ROSSI MARIO$/.test(fila),
  `per area come la Lista del PC (Alta, poi Bassa), dentro nell'ordine del gestionale (BIANCHI, ROSSI col suo posto OBI 2); niente conteggi (${titoli} · ${fila})`);
// (14) gli episodi precedenti: una riga chiusa in fondo, «Episodi precedenti (1)»; un tocco li apre, un altro li richiude
const precRiga = tel.locator("button.prec");
check(await precRiga.textContent() === "Episodi precedenti (1)" && await precRiga.getAttribute("aria-expanded") === "false" && await tel.locator('.paz[data-ep="998002"]').count() === 0,
  "gli episodi precedenti: una riga chiusa in fondo, «Episodi precedenti (1)», senza le righe");
await precRiga.click();
check(await tel.locator('.paz[data-ep="998002"]').count() === 1 && await precRiga.getAttribute("aria-expanded") === "true", "un tocco li apre");
check(await tel.locator('.paz[data-ep="999001"] .eta').innerText() === "77 anni", "nella riga il nome intero e l'età: ROSSI MARIO 77 anni");
check(await tel.locator(".paz.t-arancione").count() === 1 && await tel.locator(".paz.t-verde").count() >= 1, "la striscia del triage: ROSSI arancione, BIANCHI verde");
// lo stato della riga, com'è sul tabellone del PC: il cuore, quello che aspetta col suo tempo, il pallino del letto
const statoRiga = (ep) => tel.evaluate((e) => {
  const x = document.querySelector(`.paz[data-ep="${e}"] .st`);
  return x ? { cuore: x.querySelector(".cuore")?.className || "", esami: [...x.querySelectorAll(".esp")].map((p) => p.textContent.replace(/\s+/g, " ").trim()),
    bande: [...x.querySelectorAll(".esp i")].map((i) => i.className), segno: x.querySelector(".segno")?.className || "", titolo: x.title } : null;
}, ep);
const sVerdi = await statoRiga("999003");
check(!!sVerdi && /\bros\b/.test(sVerdi.cuore) && sVerdi.esami.length === 2 && /^Lab [5-6]\d′$/.test(sVerdi.esami[0]) && /^RX 1h[4-5]\d$/.test(sVerdi.esami[1])
  && sVerdi.bande[0] === "" && sVerdi.bande[1] === "amb" && /\bamb\b/.test(sVerdi.segno) && /letto alle \d\d:\d\d/.test(sVerdi.titolo),
  `nella riga di VERDI lo stato del PC: ♥ rosso, «Lab 50′», «RX 1h40» in ambra, il pallino ambra del letto; «letto alle …» nel titolo (${JSON.stringify(sVerdi)})`);
check(await tel.locator('.paz[data-ep="999003"] .st .cuorev').innerText() === "NEWS 11 · FR 26 · SpO2 90",
  "nella riga, accanto al cuore, come sul PC: «NEWS 11 · FR 26 · SpO2 90» (i due più fuori norma)");
check(await tel.locator('.paz[data-ep="999001"] .cuorev').count() === 0, "senza cuore: niente testo");
check(await statoRiga("998002") === null, "un episodio precedente: niente stato (il PC non lo dice)");
await precRiga.click();
check(await tel.locator('.paz[data-ep="998002"]').count() === 0, "un altro tocco li richiude");
if (process.env.PSA_SIDE) {
  // la foto a deviceScaleFactor 2: la stessa pagina, ferma, in un telefono a 2×
  const html = await tel.evaluate(() => document.documentElement.outerHTML.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
  const fotoCtx = await telBrowser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
  const foto = await fotoCtx.newPage();
  await foto.route("**/*", (r) => (/app\.css$/.test(r.request().url()) ? r.fulfill({ path: join(root, "../public/ponte/app.css"), contentType: "text/css" }) : r.fulfill({ status: 200, contentType: "text/html", body: html })));
  await foto.goto("https://ponte.invalid/ponte/");
  await foto.screenshot({ path: join(process.env.PSA_SIDE, "uxC2-telefono-elenco.png") }).catch(() => {});
  await fotoCtx.close();
}
check(/Aggiornato alle \d\d:\d\d/.test(lista) && !/Dal PC del pronto soccorso/.test(lista), "in testa «Aggiornato alle …»; niente piede che ripete la testata");
// ---- il Triage in fondo alle aree (letto dal PC, a parte: nessun paziente in più)
{
  const triagePc = (righe, ts = Date.now()) => doc.evaluate(({ righe, ts }) => (righe
    ? localStorage.setItem("psassist:triage.lista.v1", JSON.stringify({ ts, righe })) : localStorage.removeItem("psassist:triage.lista.v1")), { righe, ts });
  const min = (m) => Date.now() - m * 60e3;
  const titoliTel = async () => JSON.stringify(await tel.locator(".lbl").evaluateAll((l) => l.map((x) => x.textContent.replace(/\s+/g, " ").trim())));
  const ricarica = async () => { await tel.reload(); await aspettaTel(tel, /ROSSI MARIO/, 20000); };
  check(!/Triage/.test(titoli), "senza niente letto al Triage, la sezione non c'è");
  await triagePc([
    { nome: "GRIGI TINA", breve: "GRIGI T.", eta: 30, triage: "VERDE", area: "", arrivo: min(80) },
    { nome: "BLU CARLO", breve: "BLU C.", eta: 71, triage: "AZZURRO", area: "AREA BASSA INTENSITA'", arrivo: min(20) },
    { nome: "ROSA ELIO", breve: "ROSA E.", eta: 44, triage: "ROSSO", area: "", arrivo: min(5) },
    { nome: "BLU ALDO", breve: "BLU A.", eta: 63, triage: "AZZURRO", area: "", arrivo: min(35) },
    { nome: "ZERO MARTA", breve: "ZERO M.", eta: null, triage: "", area: "", arrivo: 0 },
  ]);
  await ricarica();
  const lbl = await titoliTel();
  const righeTr = await tel.locator(".paz.trg").evaluateAll((l) => l.map((x) => ({ nome: x.querySelector(".nome").textContent, eta: x.querySelector(".eta")?.textContent || "", att: x.querySelector(".att")?.textContent || "",
    ar: x.querySelector(".ar")?.textContent || "", cl: [...x.classList].find((c) => /^t-/.test(c)), tag: x.tagName })));
  check(/"Triage · alle \d\d:\d\d"/.test(lbl) && lbl.indexOf("Triage") > lbl.indexOf("Bassa")
    && await tel.evaluate(() => { const t = [...document.querySelectorAll(".lbl")].find((x) => /Triage/.test(x.textContent)), pr = document.querySelector("button.prec"); return !!(t && pr && (t.compareDocumentPosition(pr) & Node.DOCUMENT_POSITION_FOLLOWING)); }),
    `sotto le aree (prima degli episodi precedenti) una sezione «Triage · alle 14:32» (${lbl})`);
  // (15) chi aspetta non sembra un paziente da toccare: senza carta, più piccolo e grigio, la striscia del triage resta
  const trgStile = await tel.evaluate(() => { const r = document.querySelector(".paz.trg"), p = document.querySelector("button.paz"), n = r.querySelector(".nome"), pn = p.querySelector(".nome");
    return { carta: getComputedStyle(r.parentElement).backgroundColor, bordo: getComputedStyle(r.parentElement).borderTopColor, fs: parseFloat(getComputedStyle(n).fontSize), fsP: parseFloat(getComputedStyle(pn).fontSize), col: getComputedStyle(n).color, colP: getComputedStyle(pn).color,
      striscia: getComputedStyle(r.querySelector(".tr")).backgroundColor }; });
  check(trgStile.carta === "rgba(0, 0, 0, 0)" && trgStile.bordo === "rgba(0, 0, 0, 0)" && trgStile.fs < trgStile.fsP && trgStile.col !== trgStile.colP && trgStile.striscia !== "rgba(0, 0, 0, 0)",
    `(15) le righe del triage: senza carta, testo più piccolo e grigio, la striscia resta (${JSON.stringify(trgStile)})`);
  check(righeTr.map((x) => x.nome).join() === "ROSA ELIO,BLU ALDO,BLU CARLO,GRIGI TINA,ZERO MARTA" && righeTr.map((x) => x.cl).join() === "t-rosso,t-azzurro,t-azzurro,t-verde,t-nessuno",
    `per urgenza (rosso, azzurro, verde, senza) e a pari colore da chi aspetta di più (${righeTr.map((x) => x.nome).join()})`);
  check(/^\d+′$/.test(righeTr[0].att) && righeTr[0].eta === "44 anni" && /^3[5-9]′$/.test(righeTr[1].att) && /^1h(2\d|3\d)$/.test(righeTr[3].att) && righeTr[4].att === "" && righeTr[4].eta === "",
    `età e attesa («5′», «35′», «1h20»); dove non si sa, niente (${JSON.stringify(righeTr.map((x) => [x.eta, x.att]))})`);
  check(righeTr[2].ar === "AREA BASSA INTENSITA'" && !righeTr[0].ar && righeTr.every((x) => x.tag === "DIV") && !(await tel.locator("button.paz.t-rosso").count()),
    "l'area come testo piccolo solo dove si sa; le righe non si toccano (niente bottone)");
  check(!(await pazPc()).includes("GRIGI") && !(await tel.locator('.paz[data-ep]').evaluateAll((l) => l.map((x) => x.textContent).join())).includes("GRIGI"),
    "chi è al Triage non entra fra i pazienti");
  if (process.env.PSA_SIDE) {
    const html = await tel.evaluate(() => document.documentElement.outerHTML.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
    const fotoCtx = await telBrowser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
    const foto = await fotoCtx.newPage();
    await foto.route("**/*", (r) => (/app\.css$/.test(r.request().url()) ? r.fulfill({ path: join(root, "../public/ponte/app.css"), contentType: "text/css" }) : r.fulfill({ status: 200, contentType: "text/html", body: html })));
    await foto.goto("https://ponte.invalid/ponte/");
    await foto.screenshot({ path: join(process.env.PSA_SIDE, "triage-telefono.png") }).catch(() => {});
    await fotoCtx.close();
  }
  // letta più di 30 minuti fa: via
  await triagePc([{ nome: "ROSA ELIO", breve: "ROSA E.", eta: 44, triage: "ROSSO", area: "", arrivo: min(50) }], Date.now() - 31 * 60e3);
  await ricarica();
  check(!/Triage/.test(await titoliTel()), "letta più di 30 minuti fa: la sezione non c'è");
  // un'estensione vecchia (il comando non lo conosce: «Comando sconosciuto»): niente sezione, niente errore
  await triagePc([{ nome: "ROSA ELIO", breve: "ROSA E.", eta: 44, triage: "ROSSO", area: "", arrivo: min(5) }]);
  await tel.route(/\/app\.js/, async (r) => { const t = await (await r.fetch()).text(); await r.fulfill({ status: 200, contentType: "text/javascript", body: "window.__triageVecchio = true;" + t.replace('chiedi("triage"', 'chiedi("triage_vecchio"') }); });
  await tel.evaluate(() => navigator.serviceWorker?.getRegistrations().then((l) => Promise.all(l.map((x) => x.unregister()))));
  await ricarica();
  const vecchia = await tel.evaluate(() => window.__triageVecchio === true);
  check(vecchia && !/Triage/.test(await titoliTel()) && !(await tel.locator(".avviso, .err, [role=alert]").count()) && /ROSSI MARIO/.test(await testoTel(tel)),
    `con un comando che il PC non conosce: nessuna sezione, nessun errore, l'elenco c'è (prova attiva: ${vecchia})`);
  await tel.unroute(/\/app\.js/);
  await triagePc(null);
  await ricarica();
}
const nomi = await tel.locator(".paz .nome").evaluateAll((l) => l.map((x) => { const s = getComputedStyle(x); return { taglia: s.textOverflow === "ellipsis" || s.whiteSpace === "nowrap", pieno: x.scrollWidth <= x.clientWidth + 1 }; }));
check(nomi.length >= 3 && nomi.every((x) => !x.taglia && x.pieno), `i nomi non si troncano mai (il posto e il promemoria vanno a capo) ${JSON.stringify(nomi)}`);
check(!(await piccoli(tel)).length, `ogni bottone almeno 44 px (${JSON.stringify(await piccoli(tel))})`);
await tocca(tel, '[data-a="menu"]');
// (le voci, senza il perché in piccolo di una voce spenta: «Sul PC la stampa automatica non è impostata»)
const vociMenu = await tel.locator(".menu button").evaluateAll((l) => l.map((b) => [...b.childNodes].filter((n) => n.nodeName !== "SMALL").map((n) => n.textContent).join("").replace(/\s+/g, " ").trim()));
check(await tel.locator('.menu [data-a="stampaPdf"]').isDisabled() === /stampa automatica non è impostata/.test(await tel.locator('.menu [data-a="stampaPdf"]').innerText()),
  "«Stampa PDF» spenta solo col suo perché (il PC senza stampa automatica), accesa senza");
check(JSON.stringify(vociMenu) === JSON.stringify(["📄 Stampa PDF", "📷 Scansiona il QR", "● Registrazioni", "🗑️ Scollega il PC"])
  && !/codice|Aggiorna elenco|Chiudi sessione|Stampa su|Dimentica|Associato/.test(await tel.locator(".menu").innerText()),
  `il ⋯ del telefono: solo quello che non c'è altrove — niente «Aggiorna elenco», «Chiudi sessione», codice; per finire una parola sola, «Scollega» (${vociMenu.join(" | ")})`);
await shot(tel, "tel-1-menu");
await tocca(tel, '[data-a="menu"]');
const st1 = await statoPonte();
check(!!st1?.sessione, "sul PC la sessione è aperta");
check(await qrUrl() === "" && /Nuovo QR/.test(await ponte.locator("#associa").innerText()), "entrato il telefono, il QR non si rivede più: «Nuovo QR»");
await doc.bringToFront();
await $panel(doc, "#collapse").click();
const spia = await finche(async () => /iPhone collegato/.test(await $panel(doc, ".pontespia").innerText().catch(() => "")), 8000);
check(spia && await $panel(doc, "#ponteoff").count() === 1, "sul PC, sotto la pill: «iPhone collegato · Scollega»");
await shot(doc, "pc-2-spia-pill");
await $panel(doc, "#expand").click();
await doc.waitForSelector("#psassist-host .card .hd .pontespia", { timeout: 5000 }).catch(() => {});
check(await $panel(doc, ".hd .pontespia").count() === 1, "e nell'intestazione del pannello aperto");
await shot(doc, "pc-3-spia-intestazione");
await $panel(doc, "#collapse").click();
await shot(tel, "tel-1-elenco");
await tel.emulateMedia({ colorScheme: "dark" });
const fondoBuio = await tel.evaluate(() => getComputedStyle(document.body).backgroundColor);
await shot(tel, "tel-1-elenco-buio");
await tel.emulateMedia({ colorScheme: "light" });
const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
check(lum(fondoBuio) < 0.15 && lum(await tel.evaluate(() => getComputedStyle(document.body).backgroundColor)) > 0.9, `al buio l'app è scura, di giorno chiara (${fondoBuio})`);

// ===========================================================================
sezione("un solo telefono: il QR visto da un altro, un'altra scheda");
const altroCtx = await telBrowser.newContext(IPHONE);
const altro = await altroCtx.newPage();
await altro.goto(url1);
check(/associato a un altro telefono/.test(await aspettaTel(altro, /associato a un altro telefono/, 15000)), "un altro telefono con lo stesso QR: «Il PC è associato a un altro telefono»");
check(await altro.evaluate(() => localStorage.length) === 1, "…e la sua chiave la tiene (serve a «Usa questo telefono», più sotto)");
check(await altro.locator("#app input").count() === 0
  && JSON.stringify(await altro.locator("#app button").allInnerTexts()) === '["Usa questo telefono","Scansiona il QR"]' && await altro.locator(".grande.quiet[data-a=scansiona]").count() === 1
  && !/Revoca|[Cc]odice/.test(await testoTel(altro)), "su quella schermata: «Usa questo telefono», e sotto, più quieto, «Scansiona il QR»; nient'altro (niente codice, niente spiegazioni)");
check(/Un altro telefono ha provato a entrare/.test(await registroPonte()), "il registro del ponte lo dice");
await altroCtx.close();
// il ripetitore gli aveva dato la presa del telefono: questo si è fermato, e non fa a gara
check(/Aperto su un altro dispositivo/.test(await aspettaTel(tel, /Aperto su un altro dispositivo/, 10000)), "il telefono buono: «Aperto su un altro dispositivo»");
const entrate0 = relay.entrate().tel;
await sospendi(3000);
check(relay.entrate().tel === entrate0, "e non si ricollega da solo (niente tiro alla fune)");
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 15000)), "«Riprendi qui»: di nuovo l'elenco");
// la stessa app in un'altra scheda dello stesso telefono
const tel2 = await telCtx.newPage();
await tel2.goto(relay.url + "/ponte/");
check(/ROSSI MARIO/.test(await aspettaTel(tel2, /ROSSI MARIO/, 15000)), "un'altra scheda dello stesso telefono entra (è lo stesso telefono)…");
check(/Aperto su un altro dispositivo/.test(await aspettaTel(tel, /Aperto su un altro dispositivo/, 10000)), "…e la prima si ferma");
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 15000)) && /Aperto su un altro dispositivo/.test(await aspettaTel(tel2, /Aperto su un altro dispositivo/, 10000)),
  "«Riprendi qui» sulla prima: lei riprende, l'altra si ferma");
await tel2.close();

// ===========================================================================
sezione("«Usa questo telefono»: un secondo telefono, due tocchi");
// niente codice da ricordare: la protezione è la chiave del QR, con cui la richiesta viaggia cifrata
const dev0 = (await chiaveTel(tel)).dev;
const cp0 = await coppiaPc();
const nuovoTel = async () => { const c = await telBrowser.newContext(IPHONE); return { c, p: await c.newPage() }; };
const bottoneCambio = (t) => t.locator('[data-a="cambia"]').innerText().catch(() => "");
// i due tocchi: il primo arma, il secondo (dopo il secondo di un doppio tocco) lo fa
const usaQuesto = async (t) => {
  await finche(() => t.locator('[data-a="cambia"]').isEnabled().catch(() => false), 10000);
  await tocca(t, '[data-a="cambia"]');
  await sospendi(1000);
  await tocca(t, '[data-a="cambia"]');
};
const registroSenza = async (re) => !re.test(await registroPonte());

// 1. un telefono SENZA la chiave del QR non può nemmeno chiederlo: il messaggio non si apre, il PC non risponde e non cambia niente
const estraneo = await nuovoTel();
await estraneo.p.goto(relay.url + "/ponte/");
const KF = P.casuale(32), CHF = await P.chiaviCoppia(KF);
const richiesta = await P.sigilla(CHF.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: P.b64u(P.casuale(16)), dev: P.b64u(P.casuale(16)), cambio: true });
const risposte = await estraneo.p.evaluate(({ url, frame }) => new Promise((ok) => {
  const got = [], ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(new Uint8Array(frame));
  ws.onmessage = (e) => got.push(typeof e.data === "string" ? "testo" : "binario");
  setTimeout(() => { ws.close(); ok(got); }, 2500);
}), { url: relay.url.replace(/^http/, "ws") + "/ponte/ws?r=" + CH1.stanza + "&ruolo=tel", frame: Array.from(richiesta) });
const cpE = await coppiaPc();
check(!risposte.includes("binario") && cpE.dev === dev0 && !cpE.cambiata && !(await statoPonte()).cambiato && await registroSenza(/Usa questo telefono|cambiato/),
  `un telefono senza la chiave che chiede il posto: nessuna risposta, niente cambia (risposte: ${risposte.join(",") || "nessuna"})`);
await estraneo.c.close();

// 2. il secondo telefono (la chiave ce l'ha: ha inquadrato il QR) vede «Usa questo telefono»; un tocco solo, o un doppio tocco: niente cambia
const secondo = await nuovoTel();
// (le richieste di questo telefono, catturate sulla strada: più sotto una viene rimandata)
const uscite = [];
await secondo.c.routeWebSocket(/\/ponte\/ws/, (ws) => {
  const server = ws.connectToServer();
  ws.onMessage((m) => { if (typeof m !== "string") uscite.push(Buffer.from(m)); server.send(m); });
  server.onMessage((m) => ws.send(m));
  ws.onClose((code, reason) => server.close(chiusura(code, reason)));
  server.onClose((code, reason) => ws.close(chiusura(code, reason)));
});
await secondo.p.goto(url1);
await aspettaTel(secondo.p, /associato a un altro telefono/, 15000);
check(await bottoneCambio(secondo.p) === "Usa questo telefono" && await secondo.p.locator("#app input").count() === 0,
  "il secondo telefono, sulla schermata «associato a un altro telefono»: «Usa questo telefono», nessun campo per un codice");
await tocca(secondo.p, '[data-a="cambia"]');
await tocca(secondo.p, '[data-a="cambia"]');   // il secondo tocco di un doppio tocco, subito dopo
await sospendi(1500);
const cpS = await coppiaPc();
check(await bottoneCambio(secondo.p) === "Usa questo telefono? Tocca di nuovo" && cpS.dev === dev0 && !cpS.cambiata && !(await statoPonte()).cambiato && !!(await statoPonte()).sessione,
  "il primo tocco arma («Usa questo telefono? Tocca di nuovo»), un doppio tocco non vale: sul PC non cambia niente, la sessione di prima è ancora lì");
await shot(secondo.p, "tel-2-usa-questo-telefono");
await sospendi(6000);
check(await bottoneCambio(secondo.p) === "Usa questo telefono" && (await coppiaPc()).dev === dev0, "lasciato lì, dopo 6 secondi si disarma da solo");

// 3. due tocchi: questo telefono prende il posto
await usaQuesto(secondo.p);
const lista2 = await aspettaTel(secondo.p, /ROSSI MARIO/, 20000);
check(/ROSSI MARIO/.test(lista2) && /BIANCHI ANNA/.test(lista2), "«Usa questo telefono», due tocchi: questo telefono è quello associato, e compare l'elenco");
const cpC = await coppiaPc();
check(cpC.dev === (await chiaveTel(secondo.p)).dev && cpC.dev !== dev0 && cpC.scade === cp0.scade && cpC.k === cp0.k && Math.abs(cpC.cambiata - Date.now()) < 60e3 && !("errori" in cpC) && !("blocco" in cpC),
  "sul PC: il telefono dell'associazione è il nuovo, stessa chiave e stessa scadenza (il cambio non la allunga)");
const stC = await statoPonte();
check(!!stC.sessione && stC.cambiato === cpC.cambiata && /iPhone cambiato alle \d\d:\d\d/.test(await registroPonte()), "e il registro del ponte dice «iPhone cambiato alle HH:MM»");
// (il pannello del PC è ridotto, sulla vista «iPhone»: riaperto, la cornice è lì)
await doc.bringToFront();
await $panel(doc, "#expand").click();
ponte = await corniceIn(doc);
check(await finche(async () => /iPhone cambiato alle \d\d:\d\d/.test(await ponte.locator("#stato").innerText()), 8000), `la pagina ⋯ → iPhone del PC lo mostra: «iPhone cambiato alle HH:MM» (${(await ponte.locator("#stato").innerText()).replace(/\n/g, " / ")})`);
await shot(doc, "pc-5-iphone-cambiato");
await $panel(doc, "#collapse").click();

let richiestaCambio = null;
for (const f of uscite) { try { if ((await P.apri(CH1.salutoTel, new Uint8Array(f), P.TIPO.SALUTO_TEL)).dati.cambio === true) richiestaCambio = f; } catch { /* altro */ } }
// 4. il telefono di prima: se rientra, «associato a un altro telefono» (con la sua chiave, come prima)
await sospendi(500);
await tocca(tel, '[data-a="riapri"]');
const fuori = await aspettaTel(tel, /associato a un altro telefono/, 15000);
check(/associato a un altro telefono/.test(fuori) && await bottoneCambio(tel) === "Usa questo telefono" && (await chiaveTel(tel))?.dev === dev0,
  "il telefono di prima, rientrando: «Il PC è associato a un altro telefono», col suo «Usa questo telefono»");
// …e se lo riprende allo stesso modo
await usaQuesto(tel);
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 20000)) && (await coppiaPc()).dev === dev0 && (await coppiaPc()).scade === cp0.scade, "due tocchi e si riprende il posto: di nuovo l'elenco, sul PC il telefono di prima");
await secondo.p.reload();
await secondo.c.close();
// la richiesta di prima, catturata sulla strada e rimandata da chi sta in mezzo, non vale una seconda volta
const rimando = await nuovoTel();
await rimando.p.goto(relay.url + "/ponte/");
const rimandata = await rimando.p.evaluate(({ url, frame }) => new Promise((ok) => {
  const got = [], ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(new Uint8Array(frame));
  ws.onmessage = (e) => { if (typeof e.data !== "string") got.push(Array.from(new Uint8Array(e.data))); };
  setTimeout(() => { ws.close(); ok(got); }, 2500);
}), { url: relay.url.replace(/^http/, "ws") + "/ponte/ws?r=" + CH1.stanza + "&ruolo=tel", frame: Array.from(richiestaCambio || []) });
let rifiutata = false;
for (const f of rimandata) { try { rifiutata = (await P.apri(CH1.salutoPc, new Uint8Array(f), P.TIPO.SALUTO_PC)).dati.no === "altro telefono"; } catch { /* altro */ } }
check(!!richiestaCambio && rifiutata && (await coppiaPc()).dev === dev0, "la richiesta di prima, rimandata più tardi dal ripetitore: rifiutata, il telefono associato resta quello");
await rimando.c.close();
await tel.reload();
await aspettaTel(tel, /ROSSI MARIO/, 20000);

// ===========================================================================
sezione("nota e promemoria dal telefono");
// sul PC nota e promemoria sono voci di «Da fare», per episodio: la nota è la prima
// aperta senza ora, i promemoria quelle aperte con l'ora (una spuntata resta 5 minuti, barrata)
const daFarePc = (ep = "999001") => doc.evaluate((e) => (JSON.parse(localStorage.getItem("psassist:dafare.v1") || "{}")[e] || []).filter((x) => !x.fatto), ep);
const notePc = () => doc.evaluate(() => Object.values(JSON.parse(localStorage.getItem("psassist:dafare.v1") || "{}")).flat().filter((x) => x.t == null && !x.fatto).map((x) => x.testo));
await tocca(tel, '.paz[data-ep="999001"]');
const testa = await aspettaTel(tel, /Rileggi/, 20000);
check(await tel.locator(".note").count() === 0 && await tel.locator("button.dfriga").count() === 1 && /^○ \+ nota$/.test(await tel.locator("button.dfriga").innerText()),
  "(11) il Da fare è una riga sotto il nome anche sugli Esiti («○ + nota» se non c'è niente); la lista aperta non c'è finché non la si tocca");
// il titolo del paziente è un bottone «Torna alla lista» (≥ 44 px), come «‹»
const titolo = tel.locator(".top button.tit");
check(await titolo.getAttribute("aria-label") === "Torna alla lista" && (await titolo.boundingBox()).height >= 44, "il titolo è un bottone «Torna alla lista», alto almeno 44 px");
await titolo.click();
check(/BIANCHI ANNA/.test(await aspettaTel(tel, /BIANCHI ANNA/, 10000)) && await tel.locator(".top button.tit").count() === 0, "toccato, torna all'elenco come «‹»");
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Rileggi/, 20000);
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
check(await tel.locator(".top .tit").innerText() === "ROSSI MARIO · 77 anni · OBI 2", `in testa il nome intero, l'età e il posto, e nient'altro: «ROSSI MARIO · 77 anni · OBI 2» (${(await tel.locator(".top .tit").innerText()).replace(/\n/g, " / ")})`);
check(await tel.evaluate(() => { const s = document.querySelector(".seg"), n = document.querySelector(".dfriga"); return !!s && !!n && !!(n.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); }),
  "la riga del Da fare sta sotto il nome, prima delle schede");
await tocca(tel, "button.dfriga");
check(await tel.locator(".foglio .note").count() === 1 && await tel.locator(".foglio #promin").count() === 1, "un tocco sulla riga apre la lista del paziente col campo «+ nota»");
// «Da fare»: la lista del PC, una voce per riga, e un solo campo «+ nota»
const tuttiPc = (ep = "999001") => doc.evaluate((e) => JSON.parse(localStorage.getItem("psassist:dafare.v1") || "{}")[e] || [], ep);
// («+ nota» sta nella lista del Da fare, che si apre dalla riga sotto il nome: la si apre, e — salvo `tieni` — la si richiude)
const aggiungiNota = async (t, testo, tieni = false) => {
  if (!(await t.locator("#promin").count())) await t.locator("button.dfriga").click();
  await t.locator("#promin").fill(testo); await t.locator("#promin").press("Enter");
  if (!tieni) { await sospendi(300); const x = t.locator('.foglio [data-a="dfchiudi"]'); if (await x.count()) await x.last().click(); }
};
check(await tel.locator("#promin").getAttribute("placeholder") === "+ nota" && await tel.locator('#nota, [data-a="nota"], [data-a="promApri"]').count() === 0,
  "un solo campo, «+ nota»: niente «+ Da fare» né «+ Con l'ora»");
check(!/\bNota\b|Promemoria/.test(await tel.locator(".foglio .note").innerText()), "niente «Nota» né «Promemoria» sullo schermo");
await aggiungiNota(tel, "dolore dalle 6, allergico a PCN", true);
await aspettaTel(tel, /Da fare salvato sul PC/, 10000);
const noteSuPc = await daFarePc();
check(noteSuPc.length === 1 && noteSuPc[0].testo === "dolore dalle 6, allergico a PCN" && noteSuPc[0].t === null,
  `senza un'ora è una cosa da fare: la prima voce di «Da fare» del PC, senza ora (got: ${JSON.stringify(noteSuPc.map((x) => [x.testo, x.t]))})`);
await aggiungiNota(tel, "tra 2h tropo", true);
await finche(async () => (await tel.locator(".dfr").count()) === 2, 10000);
const prom = (await daFarePc()).filter((x) => x.t != null);
check(prom.length === 1 && prom[0].testo === "tropo" && Math.abs(prom[0].t - Date.now() - 2 * 3600e3) < 120e3, "con un'ora dentro, «tra 2h tropo», è un promemoria: sul PC, per quel paziente");
await aggiungiNota(tel, "ECG", true);
await finche(async () => (await tel.locator(".dfr").count()) === 3, 10000);
check((await notePc()).includes("ECG"), "«ECG», senza ora: una cosa da fare (non più un errore)");
await aggiungiNota(tel, "11:30 ecg di controllo", true);
await finche(async () => (await tel.locator(".dfr").count()) === 4, 10000);
const promPc = async () => (await daFarePc()).filter((x) => x.t != null && !x.fatto);
check((await promPc()).length === 2 && await tel.locator(".dfr .quando").count() === 2, "l'ora sta davanti al testo solo sui promemoria");
check(/^○ (domani )?\d\d:\d\d [\s\S]+· \+3$/.test(await tel.locator("button.dfriga").innerText()), `(11) la riga: «○ 11:30 ecg di controllo · +3» — l'ora, il testo, le altre (${await tel.locator("button.dfriga").innerText()})`);
// la spunta: barrata, resta; un altro tocco la riapre; il cestino grigio la toglie subito
const rigaT = tel.locator('.dfr:has-text("tropo")');
check(await rigaT.locator(".dfck").evaluate((b) => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44), "la spunta tonda si tocca bene (≥ 44 px)");
await rigaT.locator(".dfck").click();
await finche(async () => (await rigaT.getAttribute("class")).includes("fatta"), 8000);
const tolto = (await tuttiPc()).find((x) => x.testo === "tropo");
check(Number.isFinite(tolto && tolto.fatto) && await rigaT.locator(".cosa").evaluate((e) => getComputedStyle(e).textDecorationLine) === "line-through" && await rigaT.locator(".dfx").count() === 1,
  `spuntata: barrata, resta al suo posto, segnata fatta anche sul PC; compare il cestino (${JSON.stringify(tolto)})`);
await rigaT.locator(".dfck").click();
await finche(async () => !(await rigaT.getAttribute("class")).includes("fatta"), 8000);
check(!(await tuttiPc()).find((x) => x.testo === "tropo").fatto && await rigaT.locator(".dfx").count() === 0, "un altro tocco sulla spunta la riapre (e il cestino se ne va)");
await rigaT.locator(".dfck").click();
await finche(async () => (await rigaT.getAttribute("class")).includes("fatta"), 8000);
await rigaT.locator(".dfx").click();
await finche(async () => (await tel.locator('.dfr:has-text("tropo")').count()) === 0, 8000);
check(!(await tuttiPc()).some((x) => x.testo === "tropo") && (await promPc()).length === 1, `il cestino la toglie subito, anche dal PC (${JSON.stringify((await tuttiPc()).map((x) => [x.testo, x.fatto]))})`);
const reg = await registroPc(doc);
check(/iPhone · Da fare per ROSSI MARIO/.test(reg) && /iPhone · Da fare di ROSSI MARIO: fatto/.test(reg) && /iPhone · Da fare di ROSSI MARIO: cancellato/.test(reg),
  "ogni comando dal telefono è nel Registro del PC");
check(!(await piccoli(tel)).length, `anche qui ogni bottone almeno 44 px (${JSON.stringify(await piccoli(tel))})`);
await shot(tel, "dafare-paziente");
await tocca(tel, '[data-a="dfchiudi"] >> nth=1');
check(await tel.locator(".foglio").count() === 0, "«Chiudi»: la lista se ne va");
// «Da fare» sulla schermata principale: le voci di tutti, per paziente
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /BIANCHI ANNA/);
// (1) il promemoria in lista: l'ora vera, mai una durata che si legge come un orario
const pillTxt = await tel.locator('.paz[data-ep="999001"] .prom').innerText();
check(/^(domani |\d\d\/\d\d |ieri )?\d\d:\d\d .+/.test(pillTxt) && !/\d+h\d\d|\d+m\b/.test(pillTxt.split(" ")[0]), `(1) promemoria in lista: l'ora d'orologio, non «14h40» (${pillTxt})`);
await tocca(tel, '[data-a="modo"][data-m="dafare"]');
const dfg = await tel.evaluate(() => ({ seg: [...document.querySelectorAll("main > .seg button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join("|"),
  gruppi: [...document.querySelectorAll(".dfg .dfhd b")].map((b) => b.textContent), righe: [...document.querySelectorAll(".dfg .dfr .cosa")].map((e) => e.textContent), chiave: localStorage.getItem("psassist.ponte.modo") }));
check(/Da fare\*$/.test(dfg.seg) && dfg.gruppi.join() === "ROSSI" && dfg.righe.join("|") === "ecg di controllo|dolore dalle 6, allergico a PCN|ECG" && dfg.chiave === "dafare",
  `Lista · Mappa · Da fare: chi ha qualcosa da fare, col cognome; i promemoria prima, poi le altre; la scelta si ricorda (${JSON.stringify(dfg)})`);
await shot(tel, "dafare-generale");
await tel.locator('.dfg .dfr:has(.cosa:text-is("ECG")) .dfck').first().click();
check(await finche(async () => (await tel.locator('.dfg .dfr.fatta').count()) === 1, 8000), "la stessa spunta e lo stesso cestino anche qui");
await tel.locator('.dfg .dfr.fatta .dfx').click();
check(await finche(async () => (await tel.locator('.dfg .dfr').count()) === 2, 8000) && !(await notePc()).includes("ECG"), "il cestino la toglie, anche dal PC");
await tocca(tel, ".dfg .dfhd");
check(await finche(async () => (await tel.locator(".top button.tit").count()) === 1, 8000), "un tocco sul paziente apre la sua schermata");
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /ROSSI/);
check(await tel.locator(".dfg").count() === 1, "e tornando si è ancora nel Da fare");
await tocca(tel, '[data-a="modo"][data-m="lista"]');
await tel.evaluate(() => localStorage.removeItem("psassist.ponte.modo"));
await tocca(tel, '.paz[data-ep="999001"]');   // (le prove dopo cominciano dal paziente)

// ===========================================================================
sezione("esiti, e «Aggiorna i valori»");
// (la risposta nuova, non gli esiti di prima che restano sullo schermo intanto)
const esitiDi = async (ep, re = /./) => {
  await tocca(tel, '[data-a="indietro"]'); await aspettaTel(tel, /BIANCHI ANNA/);
  const n = inoltrati.length;
  await tocca(tel, `.paz[data-ep="${ep}"]`);
  await finche(() => inoltrati.length >= n + 2, 20000); await sospendi(400);
  return aspettaTel(tel, re, 20000);
};
// ROSSI, aperto sul PC solo un attimo (all'inizio): il laboratorio della sua pagina mai letto. Aprendolo sul
// telefono il PC lo trova, e lo legge da solo — dietro, come «↻ Rileggi», senza il tocco: «Leggo i valori
// nuovi sul PC… · 14:32», poi la tabella. Finché la tabella non c'è, i referti del laboratorio (emogas,
// emocromo) non stanno fra la radiografia e la TC, ma a parte, in fondo
{
  // (la lettura partita da sé nella sezione delle note finisce prima: una lettura chiesta mentre va si unisce
  // a lei — lo stesso paziente è una lettura sola — e la sua scheda non sarebbe quella che si guarda qui)
  await finche(() => sw.evaluate(() => ponteValoriLetture.size === 0 && pt.valori.size === 0), 150000);
  // (aperto prima, nella sezione delle note, il PC l'ha già letto da solo: si torna a com'era — i valori
  // via dalla sua scheda, nessuna firma del laboratorio letta, e il telefono appena aperto)
  await sw.evaluate(() => chrome.storage.local.get("storicoArch").then((o) => {
    const a = o.storicoArch || {};
    for (const r of Object.values(a)) if (r.ep === "999001" || /ROSSI/.test(JSON.stringify(r.paziente || {}))) Object.assign(r, { righe: [], date: [] });
    return chrome.storage.local.set({ storicoArch: a });
  }));
  await doc.evaluate(() => { for (const k of ["psassist:autoCarica.v1", "psassist:autoFalliti.v1"]) { const o = JSON.parse(localStorage.getItem(k) || "{}"); delete o["999001"]; localStorage.setItem(k, JSON.stringify(o)); } });
  // (la sua pagina, aperta dietro, la si trattiene: così la lettura si vede mentre va)
  let lasciaRossi = () => {};
  TRATTIENI = new Promise((r) => { lasciaRossi = () => { TRATTIENI = null; r(); }; });
  TRATTENUTE.length = 0;
  const vistoR = () => doc.evaluate(() => (JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").find((p) => p.ep === "999001") || {}).ts);
  const vistoR0 = await vistoR();
  await tel.reload();
  await aspettaTel(tel, /ROSSI MARIO/, 20000);
  await tocca(tel, '.paz[data-ep="999001"]');
  await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
  const es = await aspettaTel(tel, /Leggo i valori nuovi sul PC…/, 20000);
  const ordine = await tel.evaluate(() => [...document.querySelectorAll("main > .carta, main > .lbl")].map((x) => (x.classList.contains("lbl") ? "#" + x.textContent
    : [...x.querySelectorAll(".ref .t")].map((t) => t.textContent).join("+") || (x.querySelector(".vuoto") ? "vuoto" : "?"))).join(" | "));
  check(/Leggo i valori nuovi sul PC… · \d\d:\d\d/.test(es) && !/non ha ancora letto|non ancora letti/.test(es) && await tel.locator('[data-a="valori"][disabled]').count() === 1,
    `aperti gli Esiti, il laboratorio della sua pagina il PC non l'ha mai letto: lo legge da solo — «Leggo i valori nuovi sul PC… · 14:32», nessun tocco, ↻ aspetta (${(es.match(/Leggo[^\n]*/) || [""])[0]})`);
  check(/^\? \| RX TORACE\+TC ENCEFALO \| #Laboratorio \| EMOGASANALISI VENOSA POC\+EMOCROMOCITOMETRICO URGENTE$/.test(ordine),
    `finché la tabella non c'è, i referti del laboratorio a parte, in fondo, sotto «Laboratorio»: prima la radiografia e la TC (${ordine})`);
  // un titolo lungo (EMOCROMOCITOMETRICO) va a capo: mai sotto il «nuovo»
  const sotto = await tel.evaluate(() => [...document.querySelectorAll(".ref .r1")].filter((r) => r.querySelector(".nuovo")).map((r) => {
    const t = r.querySelector(".t"), n = r.querySelector(".nuovo");
    return { t: t.textContent.slice(0, 20), fuori: t.scrollWidth > t.clientWidth + 1, sopra: t.getBoundingClientRect().right > n.getBoundingClientRect().left + 1 };
  }).filter((x) => x.fuori || x.sopra));
  check(!sotto.length, `un titolo lungo va a capo, mai sotto «nuovo» (${JSON.stringify(sotto)})`);
  await shot(tel, "esiti-laboratorio");
  await finche(() => TRATTENUTE.length > 0, 30000);   // (la scheda dietro nasce quando tocca a lei: una alla volta, dopo quello che il PC sta già facendo)
  // (la scheda la si cerca per un poco: la richiesta trattenuta può arrivare prima che il browser segni dove va la scheda)
  let dietroR = 0;
  await finche(async () => (dietroR = await dietroSu("999001")) === 1, 5000);
  const chieste = TRATTENUTE.slice(), pagR = new Set(chieste.map((x) => x.pg).filter(Boolean));
  const schedeR = dietroR === 1 ? "" : JSON.stringify(await sw.evaluate(async () => ({
    schede: (await chrome.tabs.query({})).map((t) => [t.id, t.active, (t.pendingUrl || "").slice(-40), (t.url || "").slice(-40)]),
    letture: [...ponteValoriLetture].map(([ep, j]) => [ep, j.modo, j.partita]), valori: [...pt.valori].map(([id, w]) => [id, w.ep, !!w.chiesto]) })));
  lasciaRossi();
  check(chieste.length >= 1 && dietroR === 1 && !pagR.has(doc) && pagR.size <= 1 && chieste.every((x) => /EPISODIO_ID=999001/.test(x.url)),
    `…in una scheda dietro, sul PC (non quella del medico): la sua pagina (${chieste.length} richieste, ${dietroR} schede dietro${schedeR && " — " + schedeR})`);
  const pronta = await aspettaTel(tel, /Letti sul PC alle \d\d:\d\d/, 150000);
  check(/Hb/.test(pronta) && !/Leggo i valori nuovi/.test(pronta) && await finche(async () => await dietroSu("999001") === 0, 20000),
    `…e la tabella arriva da sola, la scheda dietro si chiude: zero tocchi (${(pronta.match(/Letti[^\n]*/) || ["niente"])[0]})`);
  check(await vistoR() === vistoR0, "leggere da soli non è «aperto adesso» dal medico");
  // VERDI, che il PC conosce solo dalla lista smart (senza l'indirizzo della sua pagina): una riga, che dice cosa fare
  const v = await esitiDi("999003", /solo dalla lista smart/);
  check(/Il PC lo conosce solo dalla lista smart: apri una volta la lista «Bassa» nel gestionale\./.test(v) && await tel.locator('[data-a="valori"]').count() === 0 && !/Mai aperto/.test(v),
    `noto solo dalla lista smart: una riga sola, cosa fare — «apri una volta la lista «Bassa» nel gestionale», senza ↻ Rileggi (${v.replace(/\n+/g, " / ").slice(0, 160)})`);
  await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
  check(/Il PC lo conosce solo dalla lista smart: per ordinare, apri una volta la lista «Bassa» nel gestionale\./.test(await testoTel(tel)), "…e per ordinare, la stessa riga");
  await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
}
// BIANCHI, che il PC conosce dalla lista della sua area ma non ha aperto in questo turno: un tocco sul
// telefono è un clic sulla lista — la sua pagina vera, dietro, una volta: chi è, le allergie, la
// cartella, lo stato, poi valori e referti; il telefono intanto dice «Apro sul PC…»
{
  // (com'è chi la lista dell'area ha portato e nessuno ha aperto: `ts` 0, `lista` adesso)
  await doc.evaluate(() => { const K = "psassist:patients.v1", l = JSON.parse(localStorage.getItem(K) || "[]"); for (const p of l) if (p.ep === "999002") Object.assign(p, { ts: 0, lista: Date.now() }); localStorage.setItem(K, JSON.stringify(l)); });
  ALLERGIE_B = true;
  const a0 = APERTE.length;
  const pagineB = () => APERTE.slice(a0).filter((x) => /EPISODIO_ID=999002/.test(x.url));
  const es = await esitiDi("999002", /Apro sul PC…/);
  check(/Apro sul PC… · \d\d:\d\d/.test(es), `un tocco su chi il PC non ha aperto in questo turno: «Apro sul PC… · 14:32» (${(es.match(/Apro[^\n]*/) || [""])[0]})`);
  const fatto = await aspettaTel(tel, /Allergie: PENICILLINA/, 150000);
  await finche(() => tel.locator('[data-a="valori"]:not([disabled])').count().then((n) => n === 1), 150000);
  const b = await doc.evaluate(() => ({ p: (JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").find((x) => x.ep === "999002") || {}),
    s: (JSON.parse(localStorage.getItem("psassist:stato.v1") || "{}")["999002"] || {}) }));
  check(!!fatto && b.p.ts > 0 && b.s.anag?.allergie?.testo === "PENICILLINA" && b.s.letto > 0,
    `…il PC apre la sua pagina dietro come un clic: ora è «aperto» (alle ${b.p.ts ? new Date(b.p.ts).toTimeString().slice(0, 5) : "—"}), le sue allergie e lo stato letti — e il telefono le mostra (${JSON.stringify(b.s.anag || null)})`);
  const pagB = new Set(pagineB().map((x) => x.pg).filter(Boolean));
  check(pagineB().length >= 1 && !pagB.has(doc) && pagB.size <= 1 && await finche(async () => await dietroSu("999002") === 0, 20000),
    `…in una scheda dietro sola, che si chiude (${pagineB().length} richieste, ${pagB.size} schede)`);
  // di nuovo: è aperto in questo turno, niente scheda nuova
  const prima = pagineB().length;
  await esitiDi("999002", /Allergie: PENICILLINA/);
  await sospendi(3000);
  check(pagineB().length === prima && !/Apro sul PC/.test(await testoTel(tel)), "riaperto: già aperto in questo turno, niente scheda nuova");
  ALLERGIE_B = false;
}
await doc.bringToFront();
// sul PC il referto della radiografia si è letto da solo, aprendo il paziente: il suo testo ora viaggia anche verso il telefono
await suPagina(doc, A.patientUrl);
await $panel(doc, "#expand").click();
await doc.waitForSelector("#psassist-host .card", { timeout: 8000 });
await $panel(doc, '[data-seg="esiti"]').click();
await doc.waitForSelector('#psassist-host [data-esito="dddd4444-0000-0000-0000-000000000004"] .wuex', { timeout: 30000 }).catch(() => {});
await $panel(doc, "#collapse").click();
await suPagina(doc, A.worklistUrl);
const vistoPrima = await doc.evaluate(() => (JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").find((p) => p.ep === "999001") || {}).ts);
// Il PDF della radiografia l'ha salvato il PC; il suo testo lo legge la pagina che l'ha chiesto, e il
// medico può essere già passato oltre: lì il testo non arrivava mai al telefono. Qui il testo letto si
// toglie dalla scheda del paziente (resta la copia del PDF): com'è quando il medico se ne va subito.
const archivio = () => sw.evaluate(() => chrome.storage.local.get("storicoArch").then((o) => o.storicoArch || {}));
const ID_RX = "dddd4444-0000-0000-0000-000000000004";
const salvatoRx = await sw.evaluate((k) => chrome.storage.local.get(k).then((o) => !!o[k]), "ref:" + ID_RX);
await sw.evaluate(() => chrome.storage.local.get("storicoArch").then((o) => { for (const r of Object.values(o.storicoArch || {})) r.referti = []; return chrome.storage.local.set(o); }));
const es0 = await esitiDi("999001", /RX TORACE/);
check(salvatoRx && /Hb/.test(es0) && /Letti sul PC alle \d\d:\d\d/.test(es0) && !/non ha ancora letto valori/.test(es0),
  `il PC ha aperto ROSSI (da solo, nessun tocco): sul telefono i valori che ha salvato, senza ↻ Rileggi (${(es0.match(/Letti[^\n]*/) || ["niente"])[0]})`);
const visteRx = () => doc.evaluate((id) => ((JSON.parse(localStorage.getItem("psassist:refVisti.v1") || "{}")["999001"] || {}).ids || []).includes(id), ID_RX);
const nuovoRx = async () => await tel.locator('.ref:has-text("RX TORACE") .nuovo').count() === 1;
const rxNuovoPrima = await nuovoRx() && !(await visteRx());
await tocca(tel, '.ref:has-text("RX TORACE")');
check(/Non focolai a carattere broncopneumonico/.test(await aspettaTel(tel, /Non focolai/, 8000)),
  "e il testo della radiografia salvata sul PC, anche se nessuna pagina l'aveva letto: dalla copia, senza ↻ Rileggi");
check(Object.values(await archivio()).some((r) => (r.referti || []).some((x) => x.id === ID_RX && /Non focolai/.test(x.testo))),
  "letto una volta, va nella scheda del paziente: la prossima volta è già lì");
// visto sul telefono = visto sul PC: aperto qui, il referto non è più «nuovo» nemmeno nel pannello (segnaVisti)
check(rxNuovoPrima && await finche(visteRx, 8000) && !(await nuovoRx()),
  "aperto sul telefono, il referto è visto anche sul PC: «nuovo» se ne va, qui e nel pannello (refVisti)");
{
  // Un PDF come quelli del RIS: anagrafica in testa, riga dell'esame, corpo fra due righe di trattini. Il telefono
  // riceve la riga dell'esame e il corpo, non l'anagrafica né l'operatore.
  const TR = "_".repeat(37);
  const pdfRis = refertoRxPdf(["OSPEDALE ZQINTESTA", "Reparto ZQREPARTO", "69-140 RX TORACE (A6900) 22/08/2026 03:10", "Modalita ZQMODALITA", "OPERATORE ZQOPER", TR, "Torace ZQCORPO nei limiti.", TR, "Firma ZQPIEDE"]);
  await sw.evaluate(([k, ep, data]) => chrome.storage.local.set({ [k]: { ep, data, ts: Date.now() } }), ["ref:" + ID_RX, "999001", pdfRis.toString("base64")]);
  await sw.evaluate(() => chrome.storage.local.get("storicoArch").then((o) => { for (const r of Object.values(o.storicoArch || {})) r.referti = []; return chrome.storage.local.set(o); }));
  await tocca(tel, '[data-a="indietro"]'); await aspettaTel(tel, /BIANCHI ANNA/);
  const n1 = inoltrati.length;
  await tocca(tel, '.paz[data-ep="999001"]'); await aspettaTel(tel, /RX TORACE/, 20000);
  await finche(() => inoltrati.length >= n1 + 2, 15000); await sospendi(500);   // (la risposta nuova, non quella di prima)
  await tocca(tel, '.ref:has-text("RX TORACE")');
  // (se la riga era rimasta aperta dal controllo di prima, il tocco l'ha chiusa: un secondo la riapre)
  if (!(await aspettaTel(tel, /ZQCORPO/, 4000))) { await tocca(tel, '.ref:has-text("RX TORACE")'); await aspettaTel(tel, /ZQCORPO/, 8000); }
  const tx = await tel.evaluate(() => document.body.innerText);
  check(/ZQCORPO/.test(tx) && /RX TORACE[^\n]*22\/08\/2026/.test(tx) && !/ZQINTESTA|ZQREPARTO|ZQMODALITA|ZQOPER|ZQPIEDE/.test(tx),
    `il telefono mostra della radiografia la riga dell'esame e il corpo, non l'anagrafica né l'operatore né il piè di pagina (${tx.match(/ZQ\w+/g)} // ${tx.replace(/\s+/g, " ").slice(0, 700)})`);
  // Il testo nella scheda del paziente è già quello che mostra il PC («mostrato»): il telefono non lo
  // ritaglia (qui la firma che il RIS ha scritto fra i trattini, che il PC mostra, resta anche lì).
  // Un testo salvato prima del taglio, senza il segno, si taglia una volta.
  const RIGA = "69-140 RX TORACE (A6900) 22/08/2026 03:10";
  for (const [mostrato, testo, resta, via, cosa] of [
    [true, [RIGA, "Torace ZQCORPO nei limiti.", "Dott. Zqfirma"], /ZQCORPO[\s\S]*Zqfirma/, null, "già tagliato sul PC: com'è, firma compresa"],
    [false, ["OSPEDALE ZQINTESTA", RIGA, "Torace ZQCORPO nei limiti."], /ZQCORPO/, /ZQINTESTA/, "salvato prima del taglio: tagliato una volta, via l'intestazione"]]) {
    await sw.evaluate(([id, testo, mostrato]) => chrome.storage.local.get("storicoArch").then((o) => {
      for (const r of Object.values(o.storicoArch || {})) r.referti = [{ id, quando: "2026-08-22 03:10:00.0", titolo: "RX TORACE", sistema: "HL7RIS", testo, ...(mostrato ? { mostrato } : {}) }];
      return chrome.storage.local.set(o);
    }), [ID_RX, testo.join("\n"), mostrato]);
    await tocca(tel, '[data-a="indietro"]'); await aspettaTel(tel, /BIANCHI ANNA/);
    const n = inoltrati.length;
    await tocca(tel, '.paz[data-ep="999001"]'); await aspettaTel(tel, /RX TORACE/, 20000);
    await finche(() => inoltrati.length >= n + 2, 15000); await sospendi(500);
    await tocca(tel, '.ref:has-text("RX TORACE")');
    if (!(await aspettaTel(tel, /ZQCORPO/, 4000))) { await tocca(tel, '.ref:has-text("RX TORACE")'); await aspettaTel(tel, /ZQCORPO/, 8000); }
    const t = await tel.evaluate(() => document.body.innerText);
    check(resta.test(t) && !(via && via.test(t)), `il testo dalla scheda del paziente, ${cosa} (${t.match(/ZQ\w+|Zqfirma/g)})`);
  }
}
{
  // «● 2 nuovi» davanti sul telefono per qualche secondo vale come la finestra del PC aperta sugli Esiti:
  // il pallino del tabellone e «N nuovi» si spengono anche sul PC (la memoria dell'estensione, niente nel gestionale)
  const statoR = () => doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:stato.v1") || "{}")["999001"] || {});
  await doc.evaluate(() => { const K = "psassist:stato.v1", S = JSON.parse(localStorage.getItem(K) || "{}"); S["999001"] = { ...(S["999001"] || {}), valori: { nuovi: 2, fuori: 1, fuoriTot: 1 }, esitiVisto: 0 }; localStorage.setItem(K, JSON.stringify(S)); });
  const t0 = Date.now();
  const es = await esitiDi("999001", /● 2 nuovi/);
  const visti = await finche(async () => { const s = await statoR(); return s.valori?.nuovi === 0 && s.valori?.fuori === 0 && s.esitiVisto >= t0 && s.valoriVisti > 0; }, 15000);
  check(/● 2 nuovi/.test(es) && visti && await finche(async () => !/● 2 nuovi/.test(await testoTel(tel)), 5000) && /visti sul telefono: gli esiti di ROSSI MARIO/.test(await registroPonte()),
    `«● 2 nuovi» guardati sul telefono: visti anche sul PC — il pallino e «N nuovi» si spengono, qui e là; nel Registro (${JSON.stringify((await statoR()).valori)})`);
}

// ===========================================================================
sezione("un referto PDF salvato sul PC, sul telefono");
{
  const idRef = await tel.locator('.ref:has-text("TC ENCEFALO")').first().getAttribute("data-id");
  const SEGNO = "ZQXW7731 CAMPIONE PDF";
  // più di due pezzi: il PDF vero, e dietro un riempitivo (i pezzi sono da ~390 KB)
  const pdf = Buffer.concat([refertoRxPdf(["RADIOLOGIA - prova", SEGNO, "Non focolai a carattere broncopneumonico."]), Buffer.alloc(900000, 0x41)]);
  const esa = (x) => [...x].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  const seme = (ep) => sw.evaluate(([k, ep, data]) => chrome.storage.local.set({ [k]: { ep, data, ts: Date.now() } }), ["ref:" + idRef, ep, pdf.toString("base64")]);
  // (gli esiti di prima restano sullo schermo finché non arriva la risposta nuova: si aspetta lei)
  const riapri = async () => {
    await tocca(tel, '[data-a="indietro"]'); await aspettaTel(tel, /BIANCHI ANNA/);
    const n = inoltrati.length;
    await tocca(tel, '.paz[data-ep="999001"]'); await aspettaTel(tel, /TC ENCEFALO/, 20000);
    await finche(() => inoltrati.length >= n + 2, 15000); await sospendi(500);
  };
  // la copia sta sotto un altro episodio: non è di questo paziente, non si offre
  await seme("999002");
  await riapri();
  check(await tel.locator('.refw:has-text("TC ENCEFALO") .pdf').count() === 0, "una copia salvata sotto un altro episodio non si offre: niente «PDF»");
  await seme("999001");
  await riapri();
  check(await tel.locator('.refw:has-text("TC ENCEFALO") .pdf').count() === 1, "una TC salvata per questo episodio, anche senza testo letto (le TC non si leggono): un tasto «PDF» sul referto");
  const stato = () => tel.evaluate(async () => ({
    ls: JSON.stringify(Object.entries(localStorage).sort()), ss: JSON.stringify(Object.entries(sessionStorage).sort()),
    idb: JSON.stringify(((await indexedDB.databases?.()) || []).map((d) => d.name).sort()),
    cache: JSON.stringify(await Promise.all((await caches.keys()).sort().map(async (k) => [k, (await (await caches.open(k)).keys()).map((r) => r.url).sort()]))),
  }));
  const prima = await stato(), n0 = inoltrati.length;
  // (la pagina non può rileggere un blob: — la sua CSP lo vieta —: si guarda com'è fatto, e quando viene revocato)
  await tel.evaluate(() => {
    window.__blob = []; window.__rev = [];
    const o = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => { const u = o(b), x = { url: u, type: b.type, size: b.size, testa: "" }; window.__blob.push(x); b.slice(0, 5).text().then((t) => { x.testa = t; }); return u; };
    URL.revokeObjectURL = (u) => { window.__rev.push(u); r(u); };
  });
  const [popup] = await Promise.all([tel.waitForEvent("popup", { timeout: 15000 }), tocca(tel, '.refw:has-text("TC ENCEFALO") .pdf')]);
  const aperto = await finche(() => /^blob:/.test(popup.url()), 20000);
  const blob = await tel.evaluate(() => window.__blob);
  check(aperto && blob.length === 1 && popup.url() === blob[0].url, `il telefono lo mostra nel suo visore, da un blob: in memoria (${popup.url().slice(0, 40)})`);
  check(blob[0] && blob[0].type === "application/pdf" && blob[0].size === pdf.length, `ricomposto dai pezzi, della misura giusta (${blob[0] && blob[0].size} su ${pdf.length} byte)`);
  check(await finche(async () => (await tel.evaluate(() => window.__blob[0].testa)) === "%PDF-", 3000), "e comincia come un PDF");
  const visti = inoltrati.slice(n0), tuttiPdf = Buffer.concat(visti);
  const nomi = ["%PDF", "JVBERi", "endstream", SEGNO, esa(SEGNO), esa(SEGNO).toUpperCase(), "ROSSI", "MARIO", "ENCEFALO", "RADIOLOGIA", pdf.subarray(2000, 2040).toString("latin1"), pdf.subarray(2000, 2040).toString("base64").slice(4, 40)];
  const trovati = nomi.filter((x) => tuttiPdf.includes(Buffer.from(x, "latin1")) || tuttiPdf.includes(Buffer.from(x, "utf16le")));
  check(visti.length >= 6 && !trovati.length, `sul ripetitore (${visti.length} messaggi, ${tuttiPdf.length} byte) niente «%PDF», niente del suo testo, niente del nome (trovati: ${trovati.length})`);
  const dopo = await stato();
  check(dopo.ls === prima.ls && dopo.ss === prima.ss && dopo.idb === prima.idb && dopo.cache === prima.cache,
    "sul telefono non resta niente: localStorage, sessionStorage, IndexedDB e Cache Storage come prima");
  check(!/pdf|blob/i.test(dopo.cache.replace(/ponte-guscio/g, "")), "e il suo service worker non l'ha messo in cassa");
  await popup.close();
  const revocato = await finche(async () => (await tel.evaluate(() => window.__rev)).includes(blob[0].url), 8000);
  check(revocato, "chiusa la finestra, il blob si revoca");
  await sw.evaluate((k) => chrome.storage.local.remove(k), "ref:" + idRef);
}
lentoRef = 8000;   // la TC, qui sotto, arriva al PC dopo 8 secondi
// anche la radiografia non è più sul PC (né la copia né il testo): «↻ Rileggi» la riprende
await sw.evaluate((k) => chrome.storage.local.remove(k), "ref:" + ID_RX);
await sw.evaluate(() => chrome.storage.local.get("storicoArch").then((o) => { for (const r of Object.values(o.storicoArch || {})) r.referti = []; return chrome.storage.local.set(o); }));
const nasceValori = nuovaPagina(20000);
await tocca(tel, '[data-a="valori"]');
const schedaValori = await nasceValori;
check(!!schedaValori, "«Aggiorna i valori»: sul PC si apre una scheda di sottofondo");
await finche(async () => await tel.locator('[data-a="valori"]:not([disabled])').count() === 1, 200000);   // (la risposta, non gli esiti di prima)
const es1 = await aspettaTel(tel, /Letti sul PC alle/, 90000);
check(await tel.locator('.refw:has(.ref:has-text("TC ENCEFALO")) .pdf').count() === 1 && /Non focolai/.test(es1) && (!schedaValori || schedaValori.isClosed()),
  "«↻ Rileggi» carica anche i referti non ancora caricati, e il telefono li ha con la stessa risposta: la TC col suo PDF, il testo della radiografia; la scheda dei valori è già chiusa");
check(/Hb/.test(es1) && /80↓/.test(es1), `la tabella arriva sul telefono: Hb 80↓ (got: ${(es1.match(/Hb[^\n]*/) || [""])[0]})`);
check(/Letti sul PC alle \d\d:\d\d(?! ·)/.test(es1) && await tel.locator(".letti.amb").count() === 0, "con l'ora in cui il PC li ha letti: «Letti sul PC alle …»");
check(await tel.locator(".val thead th:has(small.parz)").count() >= 1 && /parziale/.test(await tel.locator(".val thead").innerText()),
  "una colonna con valori parziali lo dice nella sua testata: «parziale»");
lentoRef = 0;
const vistoDopo = await doc.evaluate(() => (JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").find((p) => p.ep === "999001") || {}).ts);
check(vistoDopo === vistoPrima, "la scheda dei valori non conta come «visto adesso» dal medico");
await tel.waitForSelector(".avviso", { state: "detached", timeout: 8000 }).catch(() => {});
await shot(tel, "tel-2-esiti");
await tel.emulateMedia({ colorScheme: "dark" }); await shot(tel, "tel-2-esiti-buio"); await tel.emulateMedia({ colorScheme: "light" });
// letti quattro ore fa: lo si vede, in ambra
await sw.evaluate(() => chrome.storage.local.get("storicoArch").then((o) => { for (const r of Object.values(o.storicoArch || {})) r.letto -= 4 * 3600e3 + 60e3; return chrome.storage.local.set(o); }));
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /BIANCHI ANNA/);
await tocca(tel, '.paz[data-ep="999001"]');
await finche(async () => (await tel.locator(".letti.amb").count()) === 1, 20000);
const es2 = await testoTel(tel);
check(/Letti sul PC alle \d\d:\d\d(?! ·)/.test(es2) && await tel.locator(".letti.amb").count() === 1, "letti quattro ore fa: «Letti sul PC alle …» (niente «4 h fa»), in ambra (dopo un'ora)");
// il gestionale passa prima da un'altra pagina, che porta da sé a quella del paziente: si aspetta, e si legge
Object.assign(PASSA, { n: 1, tipo: "ponte" });
await tocca(tel, '[data-a="valori"]');
await finche(async () => (await tel.locator(".letti.amb").count()) === 0 || /niente letto/.test(await testoTel(tel)), 90000);
const es3 = await testoTel(tel);
check(/Letti sul PC alle \d\d:\d\d(?! ·)/.test(es3) && !/niente letto/.test(es3) && PASSA.n === 0,
  `la scheda dei valori passa da un'altra pagina prima di quella del paziente: aspetta, e legge (${(es3.match(/Letti[^\n]*|[^\n]*niente letto[^\n]*/) || [""])[0]})`);
// …e se resta sulla lista: riapre l'indirizzo una volta, poi dice dov'è finita
Object.assign(PASSA, { n: 2, tipo: "lista" });
await tel.waitForSelector(".avviso", { state: "detached", timeout: 8000 }).catch(() => {});
await tocca(tel, '[data-a="valori"]');
const av = await tel.waitForSelector(".avviso", { timeout: 90000 }).then((x) => x.innerText()).catch(() => "");
check(/il gestionale ha aperto «PsoLista» invece della paziente: niente letto/.test(av) && PASSA.n === 0,
  `finita sulla lista anche riaprendola: lo dice, con la pagina (${av}; aperture rimaste ${PASSA.n})`);
Object.assign(PASSA, { n: 0, tipo: "" });
await tel.waitForSelector(".avviso", { state: "detached", timeout: 15000 }).catch(() => {});
await tel.evaluate(() => window.scrollTo(0, 0));

// ===========================================================================
sezione("la cartella dal telefono: leggere, scrivere col «Conferma» della pagina");
{
  CART.on = true;
  Object.assign(CART.campi, { ANAMNESI: "Dolore toracico KAPPAZETA da due ore", ALLERGIE: "Nessuna BETALLERG nota", MALATTIE_PREGRESSE: "Ipertensione SIGMAREMOTA",
    FARMACI_ASSUNTI: "Ramipril OMEGAFARM 5 mg", ESAME_OBIETTIVO: "Vigile TAUOBIETT, eupnoico" });
  const valoreTel = (n) => tel.locator(`#cc-${n}`).inputValue();
  const roTel = (n) => tel.locator(`#cc-${n}`).evaluate((t) => t.readOnly);
  const schedeNuove = [];
  const contaSchede = (p) => schedeNuove.push(p);
  ctx.on("page", contaSchede);
  // «Salva» (passato il messaggio di prima), e «Salvato»
  const salvaTel = async () => { await tel.waitForSelector(".avviso", { state: "detached", timeout: 8000 }).catch(() => {}); await tocca(tel, '[data-a="csalva"]'); };
  const salvato = () => finche(async () => (await tel.locator(".avviso").innerText().catch(() => "")) === "Salvato", 60000);
  const errori = () => sw.evaluate(() => chrome.storage.local.get("errori.v1").then((o) => (o["errori.v1"] || []).filter((x) => x.dati && x.dati.comando === "cartellaSalva")));
  // il medico apre ROSSI sul PC: la sua cartella, letta lì, è quella che il telefono vede
  await doc.bringToFront();
  await suPagina(doc, A.patientUrl);
  await tocca(tel, '[data-a="scheda"][data-s="cartella"]');
  const c0 = await aspettaTel(tel, /Letto sul PC alle/, 20000);
  check(await tel.locator(".seg button").evaluateAll((l) => l.map((b) => b.textContent).join("|")) === "Richieste|Esiti|Cartella|Terapia", "le schede nell'ordine del PC: Richieste · Esiti, «Cartella» e «Terapia» (il PC conosce la Terapia)");
  check(["Anamnesi", "Anamnesi remota", "Farmaci", "Allergie", "Esame obiettivo"].every((x) => c0.includes(x)) && (c0.match(/Letto sul PC alle \d\d:\d\d(?! ·)/g) || []).length === 1,
    `i cinque campi, e «Letto sul PC alle …» una volta (${c0.replace(/\s+/g, " ").slice(0, 160)})`);
  check(await valoreTel("ANAMNESI") === CART.campi.ANAMNESI && await valoreTel("FARMACI_ASSUNTI") === CART.campi.FARMACI_ASSUNTI && await valoreTel("ESAME_OBIETTIVO") === CART.campi.ESAME_OBIETTIVO,
    "con i testi della pagina del paziente sul PC");
  // una verità sola per le allergie: con la cartella, la riga sotto il nome dice quello che dice il campo (l'elenco era di prima)
  check(await finche(async () => await tel.locator(".alle").innerText().catch(() => "") === "Allergie: Nessuna BETALLERG nota", 8000) && await tel.locator(".alle.ros").count() === 1,
    `aperta la cartella, sotto il nome le allergie del campo, non «non lette» (${await tel.locator(".alle").innerText().catch(() => "")})`);
  check(await roTel("ESAME_OBIETTIVO") && !(await roTel("ANAMNESI")) && !(await roTel("ALLERGIE")) && await tel.locator(".cc.ro").count() === 1,
    "l'esame obiettivo che la pagina dà di sola lettura (JPSOReadonly) si legge e basta, gli altri si scrivono");
  check(await tel.locator(".cta").count() === 0, "senza modifiche, niente «Salva»");
  check(!(await piccoli(tel)).length, `ogni bottone almeno 44 px (${JSON.stringify(await piccoli(tel))})`);

  // un collega cambia l'anamnesi sul suo PC; il telefono ha ancora quella di prima: «Cambiato sul PC», niente inviato
  await tel.locator("#cc-ANAMNESI").fill("Dolore toracico KAPPAZETA da due ore, irradiato NUOVAZETA");
  check(await tel.locator('.cta [data-a="csalva"]').innerText() === "Salva" && await tel.locator(".cta").evaluate((e) => getComputedStyle(e).position) === "fixed",
    "scritto un campo: un «Salva» solo, fermo in fondo");
  CART.campi.ANAMNESI = "Anamnesi scritta da un collega";
  await salvaTel();
  const c1 = await aspettaTel(tel, /Cambiato sul PC: ricarica/, 40000);
  check(!!c1 && CART.post.length === 0, `la pagina non ha più il testo da cui il telefono è partito: «Cambiato sul PC: ricarica», e niente inviato (inviati: ${CART.post.length})`);
  check(await finche(async () => schedeNuove.length === 1 && schedeNuove[0].isClosed(), 10000), "la scheda di sottofondo si è aperta e richiusa");
  await tocca(tel, '[data-a="cricarica"]');
  check(await finche(async () => await valoreTel("ANAMNESI") === "Anamnesi scritta da un collega", 20000) && await tel.locator(".cta").count() === 0,
    "«Ricarica»: il testo del PC al posto della bozza, e niente da salvare");

  // due campi insieme: la scheda di sottofondo li scrive, clicca «Conferma», rilegge
  CART.lento = 1500;
  await tel.locator("#cc-ANAMNESI").fill("Dolore toracico NUOVAZETA dalle 6\ncon sudorazione");
  await tel.locator("#cc-FARMACI_ASSUNTI").fill("Ramipril OMEGAFARM 5 mg, ASA 100");
  await tel.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  await shot(tel, "tel-cartella");
  await salvaTel();
  check(/Salvo sul PC…/.test(await aspettaTel(tel, /Salvo sul PC…/, 8000)), "mentre salva: «Salvo sul PC…»");
  check(await salvato(), `poi «Salvato» (${await tel.locator(".cta").innerText().catch(() => "")} · ${(await registroPonte()).split("\n").slice(-2).join(" / ")})`);
  CART.lento = 0;
  const f = CART.post[0] || {};
  check(CART.post.length === 1 && f.Update === "Conferma" && f.ANAMNESI.replace(/\r\n/g, "\n") === "Dolore toracico NUOVAZETA dalle 6\ncon sudorazione" && f.FARMACI_ASSUNTI === "Ramipril OMEGAFARM 5 mg, ASA 100"
    && f.MALATTIE_PREGRESSE === "Ipertensione SIGMAREMOTA" && f.ESAME_OBIETTIVO === "Vigile TAUOBIETT, eupnoico" && f.ESAMEOBIETTIVOAUTOSAVE === "N" && !("AnnullaOBI" in f),
    `un invio solo, il modulo della pagina col suo «Conferma» (Update=Conferma), gli altri campi com'erano (${Object.keys(f).join(",")})`);
  check(await valoreTel("ANAMNESI") === "Dolore toracico NUOVAZETA dalle 6\ncon sudorazione" && await tel.locator(".cta").count() === 0, "sul telefono, il testo riletto dal PC; niente più da salvare");
  check(await finche(async () => schedeNuove.length === 2 && schedeNuove[1].isClosed(), 10000), "e la scheda di sottofondo si chiude da sola");
  // la pagina di ROSSI aperta sul PC, pulita, era di prima (il suo «Conferma» rimanderebbe i testi vecchi): si ricarica da sola
  check(await finche(async () => (await doc.locator('textarea[name="ANAMNESI"]').inputValue().catch(() => "")).includes("NUOVAZETA"), 15000) && CART.post.length === 1,
    "sul PC la pagina di ROSSI, aperta e pulita, si ricarica da sola: col testo del telefono (niente inviato)");
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  check(await $panel(doc, "#ponterica").count() === 0, "…e senza la pill «Ricarica»: non c'è niente da fare");
  // la corsa: il medico scrive sul PC DOPO il controllo (mentre il gestionale salva) — la pagina non si ricarica
  // (si perderebbe quello che ha scritto), e il suo «Conferma» è fermo finché non la ricarica
  CART.lento = 3000;
  const arr0 = CART.arrivati;
  await tel.locator("#cc-ANAMNESI").fill("Dolore toracico NUOVAZETA dalle 6\ncon sudorazione, ORAZETA");
  await salvaTel();
  check(await finche(async () => CART.arrivati > arr0, 40000), "(il gestionale comincia a salvare quello del telefono)");
  await doc.locator('textarea[name="MALATTIE_PREGRESSE"]').fill("Ipertensione SIGMAREMOTA, scritto sul PC intanto");
  check(await salvato(), "il telefono: «Salvato»");
  CART.lento = 0;
  const pillCorsa = await finche(async () => /Aggiornato dal telefono/.test((await $panel(doc, ".pontespia").allInnerTexts().catch(() => [])).join(" ")), 10000);
  check(pillCorsa && await $panel(doc, "#ponterica").count() === 1 && await doc.locator('textarea[name="MALATTIE_PREGRESSE"]').inputValue() === "Ipertensione SIGMAREMOTA, scritto sul PC intanto",
    "scritto sul PC dopo il controllo: la pagina non si ricarica (il testo resta), «Aggiornato dal telefono · Ricarica»");
  const post0 = CART.post.length;
  await doc.locator('input[name="Update"]').click();
  await sospendi(1500);
  const fermo = await doc.locator("#psassist-terapia").evaluate((h) => h.shadowRoot.querySelector(".b").textContent).catch(() => "");
  check(CART.post.length === post0 && /Cartella/.test(fermo) && /Niente inviato/.test(fermo) && /ricarica la pagina/.test(fermo),
    `…e il suo «Conferma» è fermo: niente inviato (i testi di prima non vanno sopra quelli del telefono), e lo dice (${fermo.replace(/\s+/g, " ").slice(0, 160)})`);
  await shot(doc, "pc-6-cartella-aggiornata");
  await $panel(doc, "#ponterica").click();
  await doc.waitForLoadState("load");
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  check(await finche(async () => (await doc.locator('textarea[name="ANAMNESI"]').inputValue().catch(() => "")).includes("ORAZETA"), 10000) && await $panel(doc, "#ponterica").count() === 0 && CART.post.length === post0,
    "«Ricarica»: la pagina col testo nuovo, e la pill se ne va"); 
  const regP = await registroPonte();
  check(/Cartella di ROSSI MARIO dal telefono: salvati Anamnesi, Farmaci/.test(regP) && !/NUOVAZETA|OMEGAFARM|KAPPAZETA/.test(regP), "nel registro del ponte: i campi salvati, mai i testi");

  // il medico sta scrivendo nella pagina di ROSSI sul PC: dal telefono no
  await doc.locator('textarea[name="FARMACI_ASSUNTI"]').fill("il medico scrive qui");
  await tel.locator("#cc-ALLERGIE").fill("Penicillina BETALLERG");
  await salvaTel();
  check(!!(await aspettaTel(tel, /Sul PC c'è un testo non salvato in questa pagina/, 30000)) && CART.post.length === 2 && schedeNuove.length === 3,
    "un testo non salvato nella pagina di ROSSI sul PC (anche in un altro campo: il suo «Conferma» rimanderebbe tutto il modulo): «Sul PC c'è un testo non salvato in questa pagina», niente scheda, niente inviato");
  await suPagina(doc, A.patientUrl);   // (il medico lascia stare: la pagina come il gestionale l'ha salvata)
  await salvaTel();
  check(await salvato() && CART.campi.ALLERGIE === "Penicillina BETALLERG" && CART.post.length === 3, "pagina pulita: lo stesso «Salva» adesso passa");
  const anagPc = () => doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:stato.v1") || "{}")["999001"]?.anag?.allergie?.testo || "").catch(() => "");
  check(await finche(async () => await tel.locator(".alle").innerText().catch(() => "") === "Allergie: Penicillina BETALLERG" && await anagPc() === "Penicillina BETALLERG", 10000),
    `salvate le allergie dal telefono: sotto il nome (e nel riepilogo della Terapia) il testo nuovo, e il PC sa lo stesso (${await tel.locator(".alle").innerText().catch(() => "")} · PC: ${await anagPc()})`);

  // l'esame obiettivo scrivibile, quando la pagina lo dà scrivibile — e se intanto non lo è più, no
  CART.eoRo = false;
  await suPagina(doc, A.patientUrl);
  await tocca(tel, '[data-a="crileggi"]');
  check(await finche(async () => !(await roTel("ESAME_OBIETTIVO").catch(() => true)), 20000), "l'esame obiettivo che la pagina dà scrivibile si scrive anche dal telefono");
  await tel.locator("#cc-ESAME_OBIETTIVO").fill("Vigile TAUOBIETT, dispnoico");
  CART.eoRo = true;   // (un altro medico l'ha scritto intanto: adesso è di sola lettura)
  await salvaTel();
  check(!!(await aspettaTel(tel, /Sul PC non è più modificabile: Esame obiettivo/, 40000)) && CART.post.length === 3,
    "diventato di sola lettura sul PC: «Sul PC non è più modificabile», niente inviato");
  await tocca(tel, '[data-a="cricarica"]');
  check(await finche(async () => await roTel("ESAME_OBIETTIVO") && await valoreTel("ESAME_OBIETTIVO") === "Vigile TAUOBIETT, eupnoico", 20000), "«Ricarica»: di nuovo di sola lettura, col testo del PC");
  CART.eoRo = false;
  await tocca(tel, '[data-a="crileggi"]');
  await finche(async () => !(await roTel("ESAME_OBIETTIVO").catch(() => true)), 20000);
  await tel.locator("#cc-ESAME_OBIETTIVO").fill("Vigile TAUOBIETT, dispnoico");
  await salvaTel();
  check(await salvato() && CART.campi.ESAME_OBIETTIVO === "Vigile TAUOBIETT, dispnoico", "scrivibile fino alla fine: salvato con lo stesso «Conferma»");

  // il gestionale non salva un campo: la verifica lo dice, campo per campo
  CART.ignora = "FARMACI_ASSUNTI";
  // (la pagina di ROSSI aperta sul PC, pulita: quella ricaricata dopo il salvataggio di prima)
  await finche(async () => (await doc.locator('textarea[name="ESAME_OBIETTIVO"]').inputValue().catch(() => "")).includes("dispnoico"), 15000);
  await finche(() => doc.evaluate(() => { window.__aMeta = true; return true; }).catch(() => false), 10000);
  await tel.locator("#cc-FARMACI_ASSUNTI").fill("Ramipril OMEGAFARM 10 mg");
  await tel.locator("#cc-MALATTIE_PREGRESSE").fill("Ipertensione SIGMAREMOTA, diabete");
  await salvaTel();
  check(/Salvato: Anamnesi remota · Non salvato sul PC: Farmaci/.test(await aspettaTel(tel, /Non salvato sul PC/, 60000)),
    "riletta la pagina dopo «Conferma»: «Salvato: Anamnesi remota · Non salvato sul PC: Farmaci»");
  check(await finche(async () => !(await doc.evaluate(() => window.__aMeta === true).catch(() => true))
    && (await doc.locator('textarea[name="MALATTIE_PREGRESSE"]').inputValue().catch(() => "")).includes("diabete"), 15000),
    "salvato a metà, la pagina di ROSSI sul PC è di prima lo stesso (il gestionale ha già una parte dei testi nuovi): pulita, si ricarica");
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  CART.ignora = "";
  const err = await errori();
  check(err.length >= 4 && err.every((x) => Array.isArray(x.dati.campi) && x.dati.campi.every((n) => CART_NOMI.includes(n))) && !/KAPPAZETA|NUOVAZETA|OMEGAFARM|BETALLERG|SIGMAREMOTA|TAUOBIETT|medico scrive/.test(JSON.stringify(err)),
    `ogni no nel registro degli errori: il perché e i nomi dei campi, mai un testo (${err.map((x) => x.dati.perche).join(" · ")})`);
  const memTel = await tel.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  check(!/KAPPAZETA|NUOVAZETA|OMEGAFARM|BETALLERG|SIGMAREMOTA|TAUOBIETT/.test(memTel), "sul telefono niente della cartella fuori dalla memoria della pagina");

  // la pagina di ROSSI sul PC, salvata dal telefono: ricaricata (la stessa pagina di prima non c'è più) col testo nuovo
  const anamnesiPc = () => doc.locator('textarea[name="ANAMNESI"]').inputValue().catch(() => "");
  const segnaPagina = () => finche(() => doc.evaluate(() => { window.__diPrima = true; return true; }).catch(() => false), 10000);
  const ricaricata = (testo) => finche(async () => !(await doc.evaluate(() => window.__diPrima === true).catch(() => true)) && (await anamnesiPc()).includes(testo), 15000);
  const fuocoPannello = () => doc.evaluate(() => document.getElementById("psassist-host")?.shadowRoot?.activeElement?.id || "").catch(() => "");
  const salvaAnamnesi = async (testo) => { await tel.locator("#cc-ANAMNESI").fill(testo); await salvaTel(); return salvato(); };
  // il medico ha cliccato un tasto del pannello (il fuoco ci resta, ridisegno dopo ridisegno) e se n'è andato: la pagina, pulita, si ricarica lo stesso
  await suPagina(doc, A.patientUrl);
  if (await $panel(doc, "#expand").count()) { await $panel(doc, "#expand").click(); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  await $panel(doc, "#menubtn").click();
  await $panel(doc, "#menubtn").click();
  const sulTasto = await fuocoPannello();
  await segnaPagina();
  check(sulTasto === "menubtn" && await salvaAnamnesi("Dolore toracico TASTOZETA"), `(il fuoco sul tasto ⋯ del pannello: «${sulTasto}»; il telefono salva)`);
  check(await ricaricata("TASTOZETA"), "il fuoco su un tasto del pannello non è un testo da perdere: la pagina pulita si ricarica da sola, col testo del telefono");
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  // il cursore in un campo del pannello, con un testo: la pagina non si ricarica; il «Conferma» è fermo, e la pill arriva lasciato il campo
  if (await $panel(doc, "#expand").count()) { await $panel(doc, "#expand").click(); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  if (!(await $panel(doc, "#q").count())) await $panel(doc, '[data-seg="richieste"]').click();
  await $panel(doc, "#q").fill("QUESITOZETA");
  await segnaPagina();
  check(await fuocoPannello() === "q" && await salvaAnamnesi("Dolore toracico CAMPOZETA"), "(il cursore nel «Quesito» del pannello, con un testo; il telefono salva)");
  await sospendi(1500);
  check(await doc.evaluate(() => window.__diPrima === true) && await fuocoPannello() === "q" && await $panel(doc, "#q").inputValue() === "QUESITOZETA",
    "col cursore in un campo del pannello la pagina non si ricarica: il campo ha ancora il cursore e il testo");
  // lascia il campo (riduce il pannello col suo tasto): la pill; poi il «Conferma» della pagina è fermo
  await $panel(doc, "#collapse").click();
  check(await finche(async () => /Aggiornato dal telefono/.test((await $panel(doc, ".pontespia").allInnerTexts().catch(() => [])).join(" ")), 5000),
    "…lasciato il campo, la pill «Aggiornato dal telefono · Ricarica»");
  const postC = CART.post.length;
  await doc.locator('input[name="Update"]').click();
  await sospendi(1000);
  const fermoC = await doc.locator("#psassist-terapia").evaluate((h) => h.shadowRoot.querySelector(".b").textContent).catch(() => "");
  check(CART.post.length === postC && /Niente inviato/.test(fermoC), `…e il «Conferma» della pagina è fermo: niente inviato (${fermoC.replace(/\s+/g, " ").slice(0, 80)})`);
  if (await $panel(doc, "#expand").count()) { await $panel(doc, "#expand").click(); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  await $panel(doc, "#q").fill("");
  await $panel(doc, "#ponterica").click();
  check(await ricaricata("CAMPOZETA"), "(«Ricarica»: la pagina col testo del telefono)");
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  // la pagina aperta con un «#» in fondo (un suo link «href="#"», poi un F5): ricaricarla è ricaricarla, non un salto nella stessa pagina
  await suPagina(doc, A.worklistUrl);
  await suPagina(doc, A.patientUrl + "#");
  const conCancelletto = doc.url();
  await segnaPagina();
  check(/#$/.test(conCancelletto) && await salvaAnamnesi("Dolore toracico CANCELLETTOZETA"), `(la pagina di ROSSI col «#» in fondo: ${conCancelletto.slice(-30)}; il telefono salva)`);
  check(await ricaricata("CANCELLETTOZETA"), `l'indirizzo col «#» in fondo: la pagina si ricarica davvero (${doc.url().slice(-30)})`);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  // «Conferma» premuto, e dopo il gestionale non mostra la pagina del paziente: non si sa se è salvato — ma può
  // esserlo, e la pagina di ROSSI sul PC (pulita) si ricarica lo stesso: il suo «Conferma» non rimanda i testi di prima
  CART.altrove = true;
  await segnaPagina();
  await tel.locator("#cc-ANAMNESI").fill("Dolore toracico DUBBIOZETA");
  await salvaTel();
  check(!!(await aspettaTel(tel, /Non so se è salvato: guarda la cartella sul PC prima di rifarlo/, 90000)), "dopo «Conferma» un'altra pagina: «Non so se è salvato: guarda la cartella sul PC prima di rifarlo»");
  CART.altrove = false;
  check(await ricaricata("DUBBIOZETA"), "…e la pagina di ROSSI sul PC, pulita, si ricarica: il gestionale aveva salvato");
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  // via la cartella: le sezioni dopo hanno la pagina di sempre
  ctx.off("page", contaSchede);
  CART.on = false;
  await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
  await suPagina(doc, A.worklistUrl);
}

// ===========================================================================
sezione("gli EO salvati, sopra l'esame obiettivo della cartella dal telefono");
{
  CART.on = true; CART.eoRo = false;
  Object.assign(CART.campi, { ANAMNESI: "Dolore toracico", ALLERGIE: "Nessuna", MALATTIE_PREGRESSE: "Ipertensione", FARMACI_ASSUNTI: "Ramipril", ESAME_OBIETTIVO: "" });
  const eo = JSON.parse(readFileSync(join(root, "src/eo.json"), "utf8"));
  const solito = eo.basi.find((b) => b.k === "solito"), caso = eo.casi[0];
  const SUO = "Vigile EOSUO, eupnoico, apiretto";
  // il medico ha riscritto «Mio solito base» sul PC: il telefono ha il suo testo
  await doc.evaluate((SUO) => localStorage.setItem("psassist:eo.v1", JSON.stringify({ "base:solito": { testo: SUO, base: "x" } })), SUO);
  const r = await sw.evaluate(() => ponteSuScheda("eo", {}));
  const l = r.dati || [];
  check(r.ok === true && l.length === eo.basi.length + 1 + eo.casi.length + eo.frasi.length && Object.keys(l[0] || {}).sort().join() === "gruppo,k,nome,testo",
    `«eo»: chiave, nome, gruppo e testo di ognuno (${l.length} voci: ${eo.basi.length + 1} di base, ${eo.casi.length} casi, ${eo.frasi.length} frasi)`);
  check(l.slice(0, 2).map((x) => x.k + "=" + x.nome).join() === "base:solito=Mio solito base,base=EO generale" && l[0].testo === SUO && l[0].gruppo === "base" && l[1].testo === eo.base.testo
    && l.find((x) => x.k === "caso:" + caso.k).testo === caso.testo && l.filter((x) => x.gruppo === "casi").length === eo.casi.length && l.filter((x) => x.gruppo === "frasi").length === eo.frasi.length,
    "i suoi EO di base per primi (con la sua modifica), poi Casi e Frasi, con i testi verbatim");

  await doc.bringToFront();
  await suPagina(doc, A.patientUrl);
  await tel.reload();   // (senza le bozze della sezione di prima)
  await aspettaTel(tel, /ROSSI MARIO/, 20000);
  await tocca(tel, '.paz[data-ep="999001"]');
  await tocca(tel, '[data-a="scheda"][data-s="cartella"]');
  await aspettaTel(tel, /Letto sul PC alle/, 20000);
  const campoEo = () => tel.locator("#cc-ESAME_OBIETTIVO");
  const valore = () => campoEo().inputValue();
  const chipTel = () => tel.evaluate(() => ({
    sopra: [...document.querySelectorAll(".cc")].map((c) => (c.querySelector("textarea").id.slice(3)) + ":" + [...c.querySelectorAll(".eoc .chip")].map((b) => b.textContent).join("|")).filter((x) => !/:$/.test(x)),
    n: document.querySelectorAll(".eoc").length, ann: [...(document.querySelector(".eoann")?.children || [])].map((x) => x.textContent.trim()).join(" ") }));
  const c0 = await chipTel();
  check(c0.n === 1 && c0.sopra.join() === "ESAME_OBIETTIVO:Mio solito base|EO generale|Altri…" && !c0.ann,
    `sopra l'esame obiettivo, e solo lì: i suoi EO di base per nome, poi «Altri…» (${c0.sopra.join()})`);
  check(!(await piccoli(tel)).length, `i chip e i bottoni almeno 44 px (${JSON.stringify(await piccoli(tel))})`);
  const posti0 = CART.post.length;

  // campo vuoto: il testo ci va; niente parte; il cursore dopo il testo; 5 secondi di «Annulla»
  await tel.locator('.eoc [data-a="eo"][data-k="base:solito"]').click();
  const dopo1 = await tel.evaluate(() => { const t = document.getElementById("cc-ESAME_OBIETTIVO"); return { v: t.value, fuoco: document.activeElement === t, cur: t.selectionStart === t.value.length && t.selectionEnd === t.value.length }; });
  const c1 = await chipTel();
  check(dopo1.v === SUO && dopo1.fuoco && dopo1.cur && c1.ann === "Inserito: Mio solito base Annulla" && CART.post.length === posti0 && await tel.locator('.cta [data-a="csalva"]').count() === 1,
    `campo vuoto: il testo ci va, il cursore dopo; «Inserito: Mio solito base · Annulla»; «Salva» compare, ma niente è partito (${JSON.stringify(dopo1)} · ${c1.ann})`);
  await tel.locator('[data-a="eoannulla"]').click();
  check(await valore() === "" && !(await chipTel()).ann && await tel.locator(".cta").count() === 0, "«Annulla»: il campo com'era, vuoto; niente da salvare");

  // campo con del testo: in fondo, a capo; «Annulla» toglie solo quello
  await tel.locator('.eoc [data-a="eo"][data-k="base:solito"]').click();
  await tel.locator('.eoc [data-a="eo"][data-k="base"]').click();
  check(await valore() === SUO + "\n" + eo.base.testo && (await chipTel()).ann === "Inserito: EO generale Annulla", "con del testo già nel campo: l'EO va in fondo, a capo, senza toccare quello che c'è");
  await tel.locator('[data-a="eoannulla"]').click();
  check(await valore() === SUO, "«Annulla»: via esattamente quello appena inserito, resta il primo");
  // passati i 5 secondi, l'«Annulla» se ne va e il testo resta
  await tel.locator('.eoc [data-a="eo"][data-k="base"]').click();
  check(!!(await chipTel()).ann, "(di nuovo inserito)");
  check(await finche(async () => !(await chipTel()).ann, 8000) && await valore() === SUO + "\n" + eo.base.testo, "dopo 5 secondi «Annulla» sparisce, il testo resta");
  await campoEo().fill(SUO);

  // «Altri…»: il foglio con Casi e Frasi (la ricerca solo se sono tanti)
  await tel.locator('.eoc [data-a="eoaltri"]').click();
  const foglio = await tel.evaluate(() => ({ lbl: [...document.querySelectorAll(".foglio .lbl")].map((x) => x.textContent), voci: document.querySelectorAll(".foglio .voce").length, cerca: !!document.getElementById("eocerca"),
    prima: document.querySelector(".foglio .voce b")?.textContent, fissa: getComputedStyle(document.querySelector(".foglio")).position }));
  check(foglio.lbl.join() === "Casi,Frasi" && foglio.voci === eo.casi.length + eo.frasi.length && !foglio.cerca && foglio.prima === caso.nome && foglio.fissa === "fixed",
    `«Altri…»: un foglio con «Casi» e «Frasi» (${foglio.voci} voci), senza ricerca finché la lista è corta (${JSON.stringify(foglio)})`);
  await shot(tel, "tel-eo-foglio");
  if (process.env.PSA_SIDE) {
    const html = await tel.evaluate(() => document.documentElement.outerHTML.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
    const fotoCtx = await telBrowser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
    const foto = await fotoCtx.newPage();
    await foto.route("**/*", (rr) => (/app\.css$/.test(rr.request().url()) ? rr.fulfill({ path: join(root, "../public/ponte/app.css"), contentType: "text/css" }) : rr.fulfill({ status: 200, contentType: "text/html", body: html })));
    await foto.goto("https://ponte.invalid/ponte/");
    await foto.screenshot({ path: join(process.env.PSA_SIDE, "eo-telefono-altri.png") }).catch(() => {});
    await fotoCtx.close();
  }
  await tel.locator('.foglio [data-a="eochiudi"].velo').click({ position: { x: 20, y: 20 } });
  check(await tel.locator(".foglio").count() === 0 && await valore() === SUO, "un tocco fuori: il foglio si chiude, il campo non cambia");
  await tel.locator('.eoc [data-a="eoaltri"]').click();
  await tel.locator(`.foglio [data-a="eo"][data-k="caso:${caso.k}"]`).click();
  const dopo2 = await valore();
  check(await tel.locator(".foglio").count() === 0 && dopo2 === SUO + "\n" + caso.testo && (await chipTel()).ann === `Inserito: ${caso.nome} Annulla` && CART.post.length === posti0,
    `un caso dal foglio: il foglio si chiude, il testo va in fondo, a capo; niente è ancora partito`);
  if (process.env.PSA_SIDE) {
    await tel.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    const html = await tel.evaluate(() => document.documentElement.outerHTML.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
    const fotoCtx = await telBrowser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
    const foto = await fotoCtx.newPage();
    await foto.route("**/*", (rr) => (/app\.css$/.test(rr.request().url()) ? rr.fulfill({ path: join(root, "../public/ponte/app.css"), contentType: "text/css" }) : rr.fulfill({ status: 200, contentType: "text/html", body: html })));
    await foto.goto("https://ponte.invalid/ponte/");
    await foto.screenshot({ path: join(process.env.PSA_SIDE, "eo-telefono-chip.png"), fullPage: true }).catch(() => {});
    await fotoCtx.close();
  }

  // «Salva»: il campo, col testo inserito, per la strada di sempre
  await tel.evaluate(() => document.activeElement && document.activeElement.blur());
  await tel.waitForSelector(".avviso", { state: "detached", timeout: 8000 }).catch(() => {});
  await tocca(tel, '[data-a="csalva"]');
  check(await finche(async () => (await tel.locator(".avviso").innerText().catch(() => "")) === "Salvato", 60000), "«Salva»: salvato per la strada di sempre");
  const f = CART.post[CART.post.length - 1] || {};
  check(CART.post.length === posti0 + 1 && f.Update === "Conferma" && String(f.ESAME_OBIETTIVO).replace(/\r\n/g, "\n") === SUO + "\n" + caso.testo && f.ANAMNESI === "Dolore toracico",
    `un invio solo, il «Conferma» della pagina, col campo con il testo inserito e gli altri com'erano (${CART.post.length - posti0} invio)`);
  check(await valore() === SUO + "\n" + caso.testo, "(riletto dal PC: lo stesso testo)");

  // dove la pagina lo dà di sola lettura: niente chip
  CART.eoRo = true;
  await suPagina(doc, A.patientUrl);
  await tocca(tel, '[data-a="crileggi"]');
  check(await finche(async () => (await tel.locator("#cc-ESAME_OBIETTIVO").evaluate((t) => t.readOnly).catch(() => false)), 20000) && (await chipTel()).n === 0,
    "esame obiettivo di sola lettura sulla pagina: niente chip");
  CART.eoRo = false;
  await tocca(tel, '[data-a="crileggi"]');
  await finche(async () => !(await tel.locator("#cc-ESAME_OBIETTIVO").evaluate((t) => t.readOnly).catch(() => true)), 20000);

  // un PC più vecchio non conosce i comandi («Comando sconosciuto»): niente chip, niente scheda «Terapia», nessun errore, la cartella com'è
  await tel.route(/\/app\.js/, async (rr) => { const t = await (await rr.fetch()).text(); await rr.fulfill({ status: 200, contentType: "text/javascript", body: "window.__eoVecchio = true;" + t.replace('chiedi("eo"', 'chiedi("eo_vecchio"').replace('chiedi("terapie", {}', 'chiedi("terapie_vecchio", {}') }); });
  await tel.evaluate(() => navigator.serviceWorker?.getRegistrations().then((x) => Promise.all(x.map((y) => y.unregister()))));
  await tel.reload();
  await aspettaTel(tel, /ROSSI MARIO/, 20000);
  await tocca(tel, '.paz[data-ep="999001"]');
  await tocca(tel, '[data-a="scheda"][data-s="cartella"]');
  await aspettaTel(tel, /Letto sul PC alle/, 20000);
  const vecchio = await tel.evaluate(() => ({ prova: window.__eoVecchio === true, chip: document.querySelectorAll(".eoc, .eoann, .foglio").length, campo: !!document.getElementById("cc-ESAME_OBIETTIVO"), err: document.querySelectorAll(".avviso, [role=alert]").length }));
  check(vecchio.prova && !vecchio.chip && vecchio.campo && !vecchio.err, `con un PC che non conosce «eo»: niente chip, nessun errore, la cartella com'è (${JSON.stringify(vecchio)})`);
  const schedeV = await tel.locator(".seg button").evaluateAll((l) => l.map((b) => b.textContent).join("|"));
  check(schedeV === "Richieste|Esiti|Cartella" && !vecchio.err, `con un PC che non conosce «terapie»: niente scheda «Terapia», nessun errore (${schedeV})`);
  await tel.unroute(/\/app\.js/);

  // via la prova
  await doc.evaluate(() => localStorage.removeItem("psassist:eo.v1"));
  CART.on = false;
  await tel.reload();
  await aspettaTel(tel, /ROSSI MARIO/, 20000);
  await tocca(tel, '.paz[data-ep="999001"]');
  await aspettaTel(tel, /Richieste/, 10000);
  await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
  await suPagina(doc, A.worklistUrl);
}

// ===========================================================================
sezione("un ordine dal telefono, fino alle etichette");
lento = 900;
await doc.evaluate(() => localStorage.setItem("__psaStampe", "[]"));
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await aspettaTel(tel, /Dol th/, 10000);
// compatte: il catalogo intero in al più due schermi, ogni tasto alto almeno 38 px (+6 di vuoto)
await shot(tel, "tel-richieste");
if (SHOTS) await tel.screenshot({ path: join(SHOTS, "tel-richieste-tutte.png"), fullPage: true }).catch(() => {});
const compatte = await tel.evaluate(() => {
  const c = [...document.querySelectorAll("main .carta")], tasti = [...document.querySelectorAll("main .esame, main .chip")];
  return { alt: c[c.length - 1].getBoundingClientRect().bottom - c[0].getBoundingClientRect().top, vh: innerHeight, n: document.querySelectorAll("main .esame").length,
           minAlt: Math.min(...tasti.map((b) => b.getBoundingClientRect().height)) };
});
check(compatte.alt <= 2 * compatte.vh, `le Richieste (${compatte.n} esami) stanno in due schermi: ${Math.round(compatte.alt)} px su ${compatte.vh} di altezza`);
check(compatte.minAlt >= 37.9, `ogni tasto è alto almeno 38 px, più 6 di vuoto: 44 di passo (il più basso: ${compatte.minAlt})`);
// «Febbre» ha imparato il suo pacchetto sul PC: sul telefono è un chip come gli altri
const accesi = () => tel.locator("main .esame.on .nm").allInnerTexts();   // (il nome: accanto può esserci «✓ 22:10»)
check(await tel.locator('[data-a="quesito"][data-q="Febbre"]').count() === 1, "il quesito che ha imparato il suo pacchetto sul PC è un chip anche sul telefono: «Febbre»");
await tocca(tel, '[data-a="quesito"][data-q="Febbre"]');
const conFebbre = (await accesi()).sort();
check(JSON.stringify(conFebbre) === JSON.stringify(["EMOCROMO POC", "PCR"]) && await tel.locator("#quesito").inputValue() === "Febbre",
  `un tocco scrive «Febbre» e spunta gli esami che ha imparato (${conFebbre.join(", ")})`);
await tocca(tel, '[data-a="quesito"][data-q="Febbre"]');
check((await accesi()).length === 0 && await tel.locator("#quesito").inputValue() === "", "toccato di nuovo li toglie");
check(await tel.locator("#ordina").count() === 0 && await tel.locator(".cta").count() === 0 && !/Scegli gli esami/.test(await testoTel(tel)),
  "(5) senza un esame scelto niente barra, e niente bottone spento «Scegli gli esami»: la barra compare scegliendo");
// accanto agli esami, come sul PC: niente se mai chiesto (TROPONINA US); «✓ 22:10» se già tornato (EMOCROMO POC, in verde)
const ultTel = (nome) => tel.locator(`[data-a="esame"]:has-text("${nome}")`).first().locator(".ult").innerText({ timeout: 1000 }).catch(() => "");
check(!(await ultTel("TROPONINA US")) && /^✓ \d\d:\d\d$/.test(await ultTel("EMOCROMO POC"))
  && await tel.locator('[data-a="esame"]:has-text("EMOCROMO POC")').first().locator(".ult .uok").count() === 1,
  `accanto al nome, come sul PC: TROPONINA US mai chiesta, niente; EMOCROMO POC già tornata, «${await ultTel("EMOCROMO POC")}» in verde`);
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
await tocca(tel, '[data-a="esame"]:has-text("EMOCROMO POC")');
check(await tel.locator("#ordina").count() === 1, "(5) scelto un esame, la barra c'è");
// (13) le allergie sotto il nome, con le parole del PC: «non lette» (neutro) finché il PC non le sa, poi il testo, in rosso, su ogni scheda
const alle0 = await tel.locator(".alle").innerText();
check(/^Allergie: \S/.test(alle0), `(13) sotto il nome le allergie con le parole del PC (${alle0})`);
await doc.evaluate(() => { const S = JSON.parse(localStorage.getItem("psassist:stato.v1") || "{}"); S["999001"] = { ...(S["999001"] || {}), anag: { allergie: { nega: false, testo: "Penicillina" }, attenzione: [], ts: Date.now() } }; localStorage.setItem("psassist:stato.v1", JSON.stringify(S)); });
await tocca(tel, '[data-a="indietro"]'); await aspettaTel(tel, /BIANCHI ANNA/);   // (tornati all'elenco: si rilegge)
await tocca(tel, '.paz[data-ep="999001"]'); await aspettaTel(tel, /Richieste/, 10000);
check(await finche(async () => (await tel.locator(".alle.ros").count()) === 1, 15000) && await tel.locator(".alle.ros").innerText() === "Allergie: Penicillina",
  "(13) con un testo: «Allergie: Penicillina», in rosso, sotto il nome");
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
check(await tel.locator(".alle.ros").count() === 1, "…e resta su ogni scheda (anche gli Esiti)");
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await doc.evaluate(() => { const S = JSON.parse(localStorage.getItem("psassist:stato.v1") || "{}"); delete S["999001"].anag; localStorage.setItem("psassist:stato.v1", JSON.stringify(S)); });
check(await tel.locator("#ordina").isDisabled(), "senza quesito il bottone non parte");
// (una risposta del PC che arriva adesso — gli esiti appena guardati, «visto» — ridisegna la scheda: il bottone
// di prima non c'è più, e il tocco si rifà su quello nuovo)
for (let k = 0; k < 3 && !(await tel.locator("#ordina").click({ force: true, timeout: 5000 }).then(() => true, () => false)); k++) await tel.waitForTimeout(300);
check(await tel.evaluate(() => document.activeElement && document.activeElement.id) === "quesito", "e toccarlo porta il cursore sul quesito");
await tel.locator("#quesito").fill("dolore toracico atipico");
await tel.locator("#quesito").press("Enter");
check(/Conferma e stampa · 2 esami/.test(await tel.locator("#ordina").innerText()), "«Conferma e stampa · 2 esami»");
check(await tel.locator("#ordina").evaluate((b) => getComputedStyle(b).touchAction) === "manipulation", "niente doppio tocco per ingrandire sul bottone (touch-action: manipulation)");
await tocca(tel, "#ordina");
await tocca(tel, "#ordina");   // il secondo tocco di un doppio tocco, subito dopo
await sospendi(400);
const armato = await tel.locator("#ordina").innerText();
check(/^Ordino 2 esami · tocca di nuovo\nROSSI MARIO · 77 anni · OBI 2$/.test(armato) && !/\?/.test(armato), `il primo tocco chiede conferma in due righe: che cosa, e il paziente intero con età e posto (${armato.replace(/\n/g, " / ")})`);
check(Object.keys(A.state.richieste).length === 0, "un doppio tocco (il secondo entro 800 ms) non conferma: niente è partito");
await shot(tel, "tel-3-ordine-conferma");
await tel.emulateMedia({ colorScheme: "dark" }); await shot(tel, "tel-3-ordine-conferma-buio"); await tel.emulateMedia({ colorScheme: "light" });
const nasceOrdine = nuovaPagina(20000);
await sospendi(500);
await tocca(tel, "#ordina");
const worker = await nasceOrdine;
check(!!worker, "un tocco deciso: sul PC parte la scheda dell'ordine, quella di sempre");
const corre = await aspettaTel(tel, /esame \d di 2/, 30000);
check(/esame \d di 2/.test(corre), "sul telefono: a che punto è, «esame N di 2»");
check(await finche(async () => /dall'iPhone/.test(await $panel(doc, ".strip").innerText().catch(() => "")), 15000), "sul PC la striscia dell'ordine dice «dall'iPhone»");
await tel.evaluate(() => window.scrollTo(0, 0));
await shot(tel, "tel-4-ordine-in-corso");
// (un ordine dal telefono non apre da solo il dialogo sul PC: davanti può non esserci nessuno)
const fatto = await aspettaTel(tel, /Confermata[\s\S]*etichette al PC/, 60000);
check(/Confermata[\s\S]*etichette al PC/.test(fatto) && !/NON stampate|aspettano qualcuno|tocca Stampa|sulla striscia/.test(fatto),
  "e alla fine «Confermata · etichette al PC» (la frase del telefono, non un allarme e non quella del PC)");
const rid = Object.keys(A.state.richieste)[0];
check(A.state.richieste[rid]?.confirmed === true && Object.values(A.state.insertCount).every((n) => n === 1) && Object.keys(A.state.insertCount).length === 2,
  `confermata, ogni esame mandato una volta (${JSON.stringify(A.state.insertCount)})`);
check(A.state.richieste[rid]?.quesito === "dolore toracico atipico", "col quesito scritto sul telefono");
await doc.waitForTimeout(2500);
check((await doc.evaluate(() => JSON.parse(localStorage.getItem("__psaStampe") || "[]"))).length === 0, "sul PC il dialogo di stampa non si apre da solo");
await doc.locator(`#psassist-host ${AZIONE}`).click();   // «Stampa», sulla striscia del PC
check(await finche(async () => (await doc.evaluate(() => JSON.parse(localStorage.getItem("__psaStampe") || "[]"))).length === 1, 10000),
  "un tocco su «Stampa» nella striscia del PC: le etichette si stampano lì, come sempre");
check(/Etichette prese in stampa sul PC/.test(await aspettaTel(tel, /Etichette prese in stampa sul PC/, 15000)),
  "e il telefono lo sa: «Etichette prese in stampa sul PC», una delle tre parole");
// gli esami appena ordinati, accanto al nome come nelle Richieste del PC: «0′» in attesa (ambra), e il perché nel nome per la voce
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
check(await finche(async () => /^\d+′$/.test(await ultTel("TROPONINA US")) && /^✓ \d\d:\d\d \d+′$/.test(await ultTel("EMOCROMO POC")), 15000)
  && await tel.locator('[data-a="esame"]:has-text("TROPONINA US")').first().locator(".ult .uatt").count() === 1
  && /^TROPONINA US · in attesa dalle \d\d:\d\d( · letto alle \d\d:\d\d)?$/.test(await tel.locator('[data-a="esame"]:has-text("TROPONINA US")').first().getAttribute("aria-label")),
  `ordinati: accanto al nome «${await ultTel("TROPONINA US")}» in attesa, come sul PC — un doppione si vede prima di sceglierlo`);
check(!(await ultTel("PCR")), "…e gli altri no");
await shot(tel, "tel-richieste-gia-chieste");
const carta = await tel.locator(".ord").first().innerText();
check(!/Quesito: il tuo/.test(carta) && (carta.match(/2 esami/g) || []).length <= 1, `la carta dell'ordine: niente «Quesito: il tuo», niente «2 esami» ripetuto (${carta.replace(/\s+/g, " ")})`);
check(await tel.locator(".ord").first().locator(".c b > span").innerText() === "Confermata" && /Etichette prese in stampa sul PC/.test(carta) && (carta.match(/\d\d:\d\d/g) || []).length === 1,
  `il titolo della carta è «Confermata», sotto la stampa, e l'ora c'è una volta (${carta.replace(/\s+/g, " ")})`);
await shot(tel, "tel-5-ordine-confermato");
await tel.emulateMedia({ colorScheme: "dark" }); await shot(tel, "tel-5-ordine-confermato-buio"); await tel.emulateMedia({ colorScheme: "light" });
// finito bene, dopo due minuti se ne va da solo: le carte verdi non si ammucchiano
await tel.evaluate(() => { window.__oraVera = Date.now; const v = Date.now; Date.now = () => v() + 3 * 60e3; });
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
const dopoDue = await testoTel(tel);
await tel.evaluate(() => { Date.now = window.__oraVera; });
check(!/Etichette prese in stampa sul PC/.test(dopoDue), "un ordine finito bene, dopo due minuti, se ne va da solo: le carte verdi non si ammucchiano");
await doc.keyboard.press("Escape").catch(() => {});
lento = 0;
check(/iPhone · ordine di 2 esami per ROSSI MARIO/.test(await registroPc(doc)), "l'ordine è nel Registro del PC");
const ordiniFiniti = () => sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => (o.ordini || []).every((x) => !["coda", "avvio", "corre"].includes(x.stato))));
await finche(ordiniFiniti, 30000);

// ===========================================================================
sezione("«Richieste fatte» e «Ristampa»: anche le richieste non fatte dall'estensione");
// una richiesta già sulla pagina del paziente, che il pannello non ha fatto (il gestionale la dà con i suoi link)
const rid0 = Object.keys(A.state.richieste)[0];
A.state.allocated[699999] = { ...A.state.allocated[rid0] };
A.state.richieste[699999] = { ...A.state.richieste[rid0], cart: new Map(A.state.richieste[rid0].cart), confirmed: true };
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
const attese = Object.keys(A.state.richieste).filter((r) => A.state.richieste[r].confirmed).sort();
const righeRis = async () => tel.locator(".rist [data-a=\"ristampa\"]").evaluateAll((l) => l.map((b) => b.dataset.id).sort());
check(await finche(async () => (await righeRis()).length === attese.length, 15000) && (await righeRis()).join() === attese.join() && /Richieste fatte/i.test(await testoTel(tel)),
  `Richieste: «Richieste fatte», una riga per ogni richiesta della pagina — anche la 699999, che il pannello non ha fatto (telefono: ${(await righeRis()).join(", ")}; gestionale: ${attese.join(", ")})`);
const rigaTxt = await tel.locator('.rist:has([data-id="699999"])').innerText();
check(/etichette/.test(rigaTxt) && /lista esami/.test(rigaTxt) && /Ristampa/.test(rigaTxt), `ognuna con che cosa stampa e «Ristampa» (${rigaTxt.replace(/\s+/g, " ")})`);
await shot(tel, "tel-richieste-fatte");
// senza la stampa automatica sul PC «Ristampa» è spenta, e lo dice PRIMA del tocco (catalogo.stampa.auto)
const risBtn = tel.locator('[data-a="ristampa"][data-id="699999"]');
check(await risBtn.isDisabled() && /Sul PC la stampa automatica non è impostata: si ristampa dal PC/.test(await testoTel(tel)),
  "senza la stampa automatica sul PC: «Ristampa» spenta, col perché prima del tocco — «Sul PC la stampa automatica non è impostata: si ristampa dal PC»");
// accesa sul PC: il telefono lo sa subito (l'evento «stampa»), senza riaprire, e «Ristampa» si accende
await sw.evaluate(() => chrome.storage.local.set({ stampa: { attiva: true, etichette: "Zebra ZD421", a4: "HP LaserJet A4" } }));
check(await finche(async () => !(await risBtn.isDisabled()), 10000) && !/stampa automatica non è impostata/.test(await testoTel(tel)),
  "accesa la stampa automatica sul PC: il telefono lo sa subito, e «Ristampa» si accende");
// «Ristampa»: un doppio tocco è una ristampa sola (al PC arriva un comando solo). (Il PC
// la spegne proprio mentre arriva il comando: la sua parola è quella che conta.)
await sw.evaluate(() => { self.__ris = []; self.__risVera = ponteRistampa;
  globalThis.ponteRistampa = async (d) => { self.__ris.push(d.rid); await chrome.storage.local.remove("stampa"); return self.__risVera(d); }; });
await tocca(tel, '[data-a="ristampa"][data-id="699999"]');
check(await tel.locator('.rist:has([data-id="699999"]) .quali [data-a="ristampaQ"]').allInnerTexts().then((l) => l.join("|")) === "🏷️ Etichette|📄 Foglio|Entrambi" && !(await sw.evaluate(() => self.__ris)).length,
  "«Ristampa» su una richiesta con etichette E foglio: il primo tocco non stampa, apre «🏷️ Etichette · 📄 Foglio · Entrambi»");
await tel.locator('[data-a="ristampaQ"][data-id="699999"][data-q="tutto"]').dblclick();
await finche(async () => (await sw.evaluate(() => self.__ris)).length >= 1, 10000);
await sospendi(800);
check((await sw.evaluate(() => self.__ris)).join() === "699999", "«Ristampa» → «Entrambi», doppio tocco: al PC arriva un comando solo, per quella richiesta");
// (qui la stampa automatica non è impostata: lo dice, niente di stampato, niente dialogo)
check(/Ristampa non partita: la stampa automatica non è impostata/.test(await aspettaTel(tel, /Ristampa non partita/, 15000)) &&!(await sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => (o.ordini || []).some((x) => String(x.id).startsWith("ris"))))),
  "senza la stampa automatica sul PC: il telefono lo dice com'è («Ristampa non partita»), e sul PC nessuna stampa nata");
await sw.evaluate(() => { globalThis.ponteRistampa = self.__risVera; });

// ===========================================================================
sezione("stampare dal telefono: un referto con 🖨️, e «Ristampa» solo etichette, solo foglio, o entrambi");
{
  // il finto aiutante di stampa (come più sotto): annota i fogli invece di stamparli
  const FINTO = join("/tmp", "psa-ponte-finto-ref-" + process.pid);
  mkdirSync(FINTO, { recursive: true });
  writeFileSync(join(FINTO, "config.json"), JSON.stringify({ stampanti: ["Zebra ZD421", "HP LaserJet A4"], predefinita: "HP LaserJet A4" }));
  const lavori = () => (existsSync(join(FINTO, "lavori.jsonl")) ? readFileSync(join(FINTO, "lavori.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((x) => x.tipo);
  const lanciatore = join(FINTO, "ospite.sh");
  writeFileSync(lanciatore, `#!/bin/sh\nPSA_FINTO='${FINTO}' exec '${process.execPath}' '${join(root, "test/ospite-finto.mjs")}' "$@"\n`);
  chmodSync(lanciatore, 0o755);
  mkdirSync(join(PROFILE, "NativeMessagingHosts"), { recursive: true });
  const manifesto = join(PROFILE, "NativeMessagingHosts", "it.psassist.stampa.json");
  writeFileSync(manifesto, JSON.stringify({ name: "it.psassist.stampa", description: "finto", path: lanciatore, type: "stdio", allowed_origins: [`chrome-extension://${extId}/`] }));
  await sw.evaluate(() => chrome.storage.local.set({ stampa: { attiva: true, etichette: "Zebra ZD421", a4: "HP LaserJet A4" } }));
  const tipi = (l) => [...new Set(l.map((x) => x.tipo))].sort().join();

  // il menu ⋯, senza una stazione di stampa: una voce «Stampa PDF», niente «Stampa su»
  await tocca(tel, '[data-a="menu"]');
  check(await tel.locator('.menu [data-a="stampaPdf"]').count() === 1 && /📄 Stampa PDF$/.test((await tel.locator('.menu [data-a="stampaPdf"]').innerText()).trim())
    && await tel.locator(".menu .stdove").count() === 0 && !/Stampa su/.test(await tel.locator(".menu").innerText()),
    "senza una stazione: il ⋯ ha una sola voce «📄 Stampa PDF» e nessuna riga «Stampa su»");
  await tocca(tel, '[data-a="menu"]');

  // un referto PDF salvato sul PC, e il 🖨️ accanto
  await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
  await aspettaTel(tel, /TC ENCEFALO/, 20000);
  const idRef = await tel.locator('.ref:has-text("TC ENCEFALO")').first().getAttribute("data-id");
  const pdf = refertoRxPdf(["RADIOLOGIA - prova", "XKJW2290 REFERTO DA STAMPARE"]);
  await sw.evaluate(([k, ep, data]) => chrome.storage.local.set({ [k]: { ep, data, ts: Date.now() } }), ["ref:" + idRef, "999001", pdf.toString("base64")]);
  await tocca(tel, '[data-a="indietro"]'); await aspettaTel(tel, /BIANCHI ANNA/);
  { const n = inoltrati.length; await tocca(tel, '.paz[data-ep="999001"]'); await aspettaTel(tel, /TC ENCEFALO/, 20000); await finche(() => inoltrati.length >= n + 2, 15000); await sospendi(500); }
  await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
  const prn = tel.locator('.refw:has-text("TC ENCEFALO") .prn');
  const box = await prn.boundingBox().catch(() => null);
  check(await prn.count() === 1 && await prn.getAttribute("aria-label") === "Stampa il referto" && box && box.width >= 44 && box.height >= 44, `accanto al referto col PDF, un 🖨️ «Stampa il referto» da 44 px (${box && Math.round(box.width)}×${box && Math.round(box.height)})`);
  const l0 = lavori().length;
  await prn.dblclick();
  const carta = async (re, ms = 40000) => (await finche(async () => re.test(await tel.locator(".stampa").innerText().catch(() => "")), ms)) ? tel.locator(".stampa").innerText() : "";
  const fatto = await carta(/Stampato su/);
  await sospendi(1500);
  const l1 = lavori().slice(l0);
  check(/Stampato su HP LaserJet A4/.test(fatto) && l1.length === 1 && l1[0].tipo === "a4" && l1[0].stampante === "HP LaserJet A4" && l1[0].byte === pdf.length,
    `🖨️ sul referto, con un doppio tocco: UN foglio sull'A4 del PC, intero, e la carta dice «Stampato su HP LaserJet A4» (${JSON.stringify(l1.map((x) => [x.tipo, x.stampante, x.byte]))} · ${fatto.replace(/\s+/g, " ")})`);
  const reg = (await registroPonte()).split("\n").filter((x) => /referto (non )?stampato/.test(x));   // (le altre note del registro sono di altre prove)
  check(reg.length === 1 && /^iPhone · un referto stampato su HP LaserJet A4$/.test(reg[0]), `il registro del ponte dice «un referto stampato su …», senza testo del paziente (${JSON.stringify(reg)})`);
  const rec = (await sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []))).find((x) => /^pdftel/.test(x.id));
  check(!!rec && rec.paziente === "Referto dall'iPhone", "nel giornale delle stampe del PC: «Referto dall'iPhone»");
  // un referto che il PC non ha più: la carta lo dice, niente stampato
  await tocca(tel, '[data-a="stampaVia"]');
  await sw.evaluate((k) => chrome.storage.local.remove(k), "ref:" + idRef);
  await prn.click();
  const perso = await carta(/NON stampato|non è più|non disponibile/i, 15000);
  check(/Il PDF non è più sul PC|NON stampato/.test(perso) && lavori().length === l0 + 1, `senza più la copia sul PC: la carta lo dice, niente stampato (${perso.replace(/\s+/g, " ")})`);
  await tocca(tel, '[data-a="stampaVia"]');

  // «Ristampa»: solo foglio, solo etichette, entrambi
  await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
  await finche(async () => (await tel.locator('.rist [data-a="ristampa"]').count()) >= 2, 15000);
  const ids = await tel.locator('.rist [data-a="ristampa"]').evaluateAll((l) => l.map((b) => b.dataset.id));
  await tocca(tel, `[data-a="ristampa"][data-id="${ids[0]}"]`);
  await tocca(tel, `[data-a="ristampa"][data-id="${ids[1]}"]`);
  check(await tel.locator(".quali").count() === 1 && await tel.locator(`.rist:has([data-id="${ids[1]}"]) .quali`).count() === 1, "toccando un'altra riga, la scelta della prima si chiude: ne resta una sola aperta");
  const stampa = async (q, re) => {
    const n = lavori().length;
    await tocca(tel, `[data-a="ristampaQ"][data-id="${ids[1]}"][data-q="${q}"]`);
    await finche(async () => lavori().length > n, 60000);
    await sospendi(1500);
    const nuovi = lavori().slice(n);
    await tocca(tel, '[data-a="stampaVia"]').catch(() => {});
    await tocca(tel, `[data-a="ristampa"][data-id="${ids[1]}"]`).catch(() => {});
    return nuovi;
  };
  const f = await stampa("foglio", /foglio/);
  check(f.length >= 1 && tipi(f) === "a4", `«📄 Foglio»: solo fogli A4, nessuna etichetta (${JSON.stringify(f.map((x) => [x.tipo, x.stampante]))})`);
  const e = await stampa("etichette", /etichette/);
  check(e.length >= 1 && tipi(e) === "etichette", `«🏷️ Etichette»: solo etichette, nessun foglio A4 (${JSON.stringify(e.map((x) => [x.tipo, x.stampante]))})`);
  const t = await stampa("tutto", /tutto/);
  check(t.length === f.length + e.length && tipi(t) === "a4,etichette", `«Entrambi»: le une e gli altri (${t.length} = ${f.length} + ${e.length})`);
  // (sul PC il contatore delle richieste dice quanti di ognuno: un telefono vecchio non lo sa e stampa tutto)
  const ris = (await sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []))).filter((x) => String(x.id).startsWith("ris"));
  const riass = ris.map((x) => (x.stampa && x.stampa.riassunto) || "");
  check(ris.length === 3 && riass.some((x) => /^Ristampa foglio /.test(x)) && riass.some((x) => /^Ristampa etichette /.test(x)) && riass.some((x) => /^Ristampa (?!foglio|etichette)/.test(x)),
    `tre ristampe nel giornale, ognuna dice che cosa: «Ristampa foglio …», «Ristampa etichette …», «Ristampa …» (${JSON.stringify(riass)})`);

  // ripulito: la stampa automatica com'era, nessun foglio vecchio
  await sw.evaluate(() => Promise.all([chrome.storage.local.remove(["stampa", "stampaEsito"]), chrome.storage.session.set({ ordini: [] })]));
  rmSync(manifesto, { force: true });
  rmSync(FINTO, { recursive: true, force: true });
}
delete A.state.richieste[699999]; delete A.state.allocated[699999];

// ===========================================================================
sezione("l'ordine di cui non si sa: la scheda che tarda, la risposta persa");
// la scheda del gestionale risponde dopo l'attesa: il PC non sa, l'ordine nasce lo stesso
await sw.evaluate(() => { PONTE_ATTESA.ordina = 1; });
await tocca(tel, '[data-a="indietro"]');
await tocca(tel, '.paz[data-ep="999002"]');
await aspettaTel(tel, /Dol th/, 15000);
check(await tel.locator('[data-a="scheda"][data-s="richieste"].on').count() === 1, "l'ultima scheda scelta (Richieste) resta quella, anche per un altro paziente");
check(await tel.locator(".top .tit").innerText() === `BIANCHI ANNA · ${ETA_B} anni`, `l'età che la testata non dice viene dal codice fiscale: «BIANCHI ANNA · ${ETA_B} anni»`);
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
await tel.locator("#quesito").fill("controllo");
await tocca(tel, "#ordina"); await sospendi(900); await tocca(tel, "#ordina");
const incerto = await aspettaTel(tel, /Non so se l'ordine è partito/, 20000);
check(/Non so se l'ordine è partito: controlla qui sopra prima di rifarlo/.test(incerto), "la scheda tarda: «Non so se l'ordine è partito: controlla qui sopra prima di rifarlo»");
check(await tel.evaluate(() => { const a = document.querySelector(".avviso.alto"); if (!a) return false; const r = a.getBoundingClientRect();
  return [...document.querySelectorAll(".esame")].every((e) => { const q = e.getBoundingClientRect(); return q.bottom <= r.top || q.top >= r.bottom; }); }),
  "il «non so se» sta in cima: non copre nemmeno un esame della griglia che chiede di guardare");
check(await tel.locator(".esame.on").count() === 0, "la selezione se ne va: un secondo tocco non rifà l'ordine");
check(await finche(async () => (await tel.locator(".ord").count()) >= 1 && Object.keys(B.state.richieste).length === 1, 30000), "e l'ordine, nato lo stesso, compare sul telefono");
await sw.evaluate(() => { PONTE_ATTESA.ordina = 25e3; });
await finche(ordiniFiniti, 60000);
check(Object.keys(B.state.richieste).length === 1 && Object.values(B.state.insertCount).every((n) => n === 1), `un ordine solo (${JSON.stringify(B.state.insertCount)})`);
// la rete perde la risposta (ascensore, 5G): il telefono non lo rifà alla cieca
await tel.waitForSelector(".avviso", { state: "detached", timeout: 10000 }).catch(() => {});
await tocca(tel, '[data-a="esame"]:has-text("EMOCROMO POC")');
await tel.locator("#quesito").fill("anemia");
const prese0 = relay.entrate().tel;
rete.perdi = rete.ultima;
await tocca(tel, "#ordina"); await sospendi(900); await tocca(tel, "#ordina");
const perso = await aspettaTel(tel, /Non so se l'ordine è partito/, 75000);
check(/Non so se l'ordine è partito/.test(perso), "risposta persa: dopo l'attesa, «Non so se l'ordine è partito…»");
check(await finche(async () => relay.entrate().tel > prese0, 5000), "e la presa che non risponde si rifà");
check(await tel.locator(".esame.on").count() === 0, "la selezione se ne va anche qui");
check(await finche(async () => Object.keys(B.state.richieste).length === 2 && (await tel.locator(".ord").count()) >= 2, 30000),
  "l'ordine partito davvero compare sul telefono appena la rete torna");
await finche(ordiniFiniti, 60000);
check(Object.keys(B.state.richieste).length === 2, `e nessun ordine doppio (${Object.keys(B.state.richieste).length}; ${(await registroPonte()).split("\n").slice(-3).join(" / ")})`);
await shot(tel, "tel-6-ordine-incerto");
// La risposta si perde, ma la presa cade e si rifà subito: l'ordine è già lì
// sopra. Niente allarme rosso che dice il contrario, e il bottone non aspetta.
await tel.waitForSelector(".avviso", { state: "detached", timeout: 10000 }).catch(() => {});
await tel.evaluate(() => {
  window.__avvisi = [];
  new MutationObserver(() => { const a = document.querySelector(".avviso"); if (a && !window.__avvisi.includes(a.textContent)) window.__avvisi.push(a.textContent); })
    .observe(document.getElementById("app"), { childList: true, subtree: true });
});
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
await tel.locator("#quesito").fill("controllo serale");
const richiesteB = Object.keys(B.state.richieste).length, carte0 = await tel.locator(".ord").count();
rete.perdi = rete.ultima;
await tocca(tel, "#ordina"); await sospendi(900); await tocca(tel, "#ordina");
const tPerso = Date.now();
check(await finche(async () => Object.keys(B.state.richieste).length > richiesteB, 30000), "(la risposta si perde; l'ordine nasce sul PC)");
await sospendi(1500);
check(/Mando l'ordine al PC/.test(await tel.locator("#ordina").innerText()), "(il bottone aspetta la risposta)");
rete.prese.get(rete.perdi).ws.close({ code: 1001, reason: "rete" });   // la presa cade: il telefono si ricollega
const visto = await finche(async () => !/Mando l'ordine al PC/.test(await tel.locator("#ordina").innerText().catch(() => "")) && (await tel.locator(".ord").count()) > carte0, 15000);
check(visto, `ricollegato, il telefono vede l'ordine nato sul PC, e il bottone non aspetta più la risposta persa (${await tel.locator("#ordina").innerText().catch(() => "")})`);
await finche(ordiniFiniti, 60000);

// ===========================================================================
sezione("un ordine finito male resta sulla lista, con le parole di bg.js");
// un ordine del telefono come lo racconta bg.js (`pubblico`), qui scritto a mano
const male = { id: "telmaleprova1l", ep: "999002", paziente: "BIANCHI ANNA", n: 1, stato: "errore", ts: Date.now(), agg: Date.now(), worker: null, vista: null,
  resto: { mancano: ["TROPONINA US"], controllare: [], nel: [] }, pubblico: { tono: "err", titolo: "Non partita", testo: "niente inviato: riprova", dettaglio: "Mancano: TROPONINA US" } };
await sw.evaluate((m) => chrome.storage.session.get("ordini").then((o) => chrome.storage.session.set({ ordini: [...(o.ordini || []), m] })), male);
await tocca(tel, '[data-a="indietro"]');
const barra = await aspettaTel(tel, /Non partita · BIANCHI ANNA/, 10000);
check(/Non partita · BIANCHI ANNA/.test(barra) && /niente inviato: riprova/.test(barra) && !/Tocca per vedere/.test(barra),
  "in fondo alla lista: «Non partita · BIANCHI ANNA», con le parole di bg.js (e nient'altro)");
await shot(tel, "tel-6b-ordine-non-completo");
// sulla pagina di un altro paziente lo si vede lo stesso, in testa (in fondo c'è il bottone dell'ordine)
await tocca(tel, '.paz[data-ep="999001"]');
const suRossi = await aspettaTel(tel, /Non partita · BIANCHI ANNA/, 10000);
check(/Non partita · BIANCHI ANNA/.test(suRossi) && await tel.locator("main > .ordbar.sopra").count() === 1,
  "l'ordine finito male si vede anche dalla pagina di un altro paziente, in testa");
await tocca(tel, '.ordbar[data-a="paz"]');
await aspettaTel(tel, /Esiti/, 10000);
check(await tel.locator(".top .tit").innerText() === `BIANCHI ANNA · ${ETA_B} anni` && await tel.locator(".ordbar").count() === 0 && /Non partita/.test(await testoTel(tel)),
  "toccato: si è sul suo paziente, dove l'ordine ha la sua carta (e niente barra)");
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /Non partita · BIANCHI ANNA/, 10000);
await sw.evaluate((id) => chrome.storage.session.get("ordini").then((o) => chrome.storage.session.set({ ordini: (o.ordini || []).filter((x) => x.id !== id) })), male.id);
await sospendi(1500);
check(/Non partita · BIANCHI ANNA/.test(await testoTel(tel)), "tolto dal PC (✕ là): sul telefono resta com'era l'ultima volta, finché non lo si chiude");
await tocca(tel, '.ordbar [data-a="nascondi"]');
check(!/Non partita · BIANCHI ANNA/.test(await testoTel(tel)), "✕: via");
await tocca(tel, '.paz[data-ep="999002"]');
await aspettaTel(tel, /Richieste/, 10000);

// ===========================================================================
sezione("episodio precedente, paziente dimesso");
await tocca(tel, '[data-a="indietro"]');
await tocca(tel, "button.prec");
await tocca(tel, '.paz[data-ep="998002"]');
check(/Episodio precedente: per ordinare apri quello di oggi/.test(await aspettaTel(tel, /per ordinare apri quello di oggi/, 15000)) && await tel.locator("#ordina").count() === 0,
  "un episodio precedente si legge, ma non si ordina");
check(await tel.locator(".top .tit").innerText() === `BIANCHI ANNA · ${ETA_B} anni\nEpisodio precedente`,
  `in testa lo dice, e l'età (mai vista la sua pagina: dal codice fiscale che il PC conosce) (${(await tel.locator(".top .tit").innerText()).replace(/\n/g, " / ")})`);
await tocca(tel, '[data-a="indietro"]');
await tocca(tel, '.paz[data-ep="999003"]');
await aspettaTel(tel, /VERDI LUCA/, 15000);
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
// i parametri vitali sotto il nome: l'ultima riga, il fuori norma colorito; un tocco apre le righe di prima, un altro le chiude
const vitTel = () => tel.evaluate(() => {
  const v = document.querySelector("main > .vit");
  return v ? { riga: v.querySelector("button").textContent.replace(/\s+/g, " ").trim(), ros: [...v.querySelectorAll("button .ros")].map((x) => x.textContent),
    amb: [...v.querySelectorAll("button .amb")].map((x) => x.textContent), storia: [...v.querySelectorAll(".vitst > div")].map((x) => x.textContent.replace(/\s+/g, " ").trim()),
    grigio: v.classList.contains("vecchio"), aperto: v.querySelector("button").getAttribute("aria-expanded") } : null;
});
const v1 = await vitTel();
check(!!v1 && /^Parametri \d\d:\d\d PA 95 · FC 118 · SpO2 90 · FR 26 · T 38,6 · NEWS2 11$/.test(v1.riga) && v1.ros.join() === "SpO2 90,FR 26"
  && v1.amb.join() === "PA 95,FC 118,T 38,6" && !v1.grigio && v1.storia.length === 0,
  `sotto il nome una riga: ora, PA FC SpO2 FR T, NEWS2; rosso SpO2 e FR, ambra PA FC T (${JSON.stringify(v1)})`);
await tocca(tel, '.vit > button');
const v2 = await vitTel();
check(!!v2 && v2.aperto === "true" && v2.storia.length === 2 && /^\d\d:\d\d PA 122\/80 · FC 84 · SpO2 96 · FR 18 · T 36,8$/.test(v2.storia[0]) && /^\d\d:\d\d PA 120 · FC 80 · SpO2 97 · FR 16 · T 36,6$/.test(v2.storia[1]),
  `un tocco: le righe di prima, la più recente in alto, con l'ora (${JSON.stringify(v2 && v2.storia)})`);
if (process.env.PSA_SIDE) {
  const html = await tel.evaluate(() => document.documentElement.outerHTML.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
  const fotoCtx = await telBrowser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
  const foto = await fotoCtx.newPage();
  await foto.route("**/*", (r) => (/app\.css$/.test(r.request().url()) ? r.fulfill({ path: join(root, "../public/ponte/app.css"), contentType: "text/css" }) : r.fulfill({ status: 200, contentType: "text/html", body: html })));
  await foto.goto("https://ponte.invalid/ponte/");
  await foto.screenshot({ path: join(process.env.PSA_SIDE, "vitali-telefono-paziente.png") }).catch(() => {});
  await fotoCtx.close();
}
await tocca(tel, '.vit > button');
check((await vitTel()).storia.length === 0, "un altro tocco le chiude");
// più vecchi di 4 ore: l'ora lo dice, grigi
await doc.evaluate(() => {
  const S = JSON.parse(localStorage.getItem("psassist:stato.v1") || "{}"), h = 3600e3;
  S[999003].vit = { p: { fr: 16, spo2: 97, fc: 80, pas: 120, t: 36.6 }, ts: Date.now() - 5 * h };
  localStorage.setItem("psassist:stato.v1", JSON.stringify(S));
});
await tocca(tel, '[data-a="indietro"]');   // (tornati all'elenco: si rilegge)
await aspettaTel(tel, /VERDI LUCA/, 15000);
await tocca(tel, '.paz[data-ep="999003"]');
await aspettaTel(tel, /Parametri di 5 ore fa/, 15000);
const v3 = await vitTel();
check(!!v3 && /^Parametri di 5 ore fa PA 120 · FC 80 · SpO2 97 · FR 16 · T 36,6 · NEWS2 0$/.test(v3.riga) && v3.grigio && !v3.ros.length && !v3.amb.length,
  `vecchio: «Parametri di 5 ore fa», grigio; tutto nella norma: niente colori, NEWS2 0 (${JSON.stringify(v3)})`);
await doc.evaluate(() => {
  const K = "psassist:patients.v1"; const l = JSON.parse(localStorage.getItem(K) || "[]");
  for (const p of l) if (p.ep === "999003") { p.arch = true; p.archTs = Date.now(); }
  localStorage.setItem(K, JSON.stringify(l));
});
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await aggiungiNota(tel, "nota dopo la dimissione");
check(/Dimesso sul PC: niente inviato/.test(await aspettaTel(tel, /Dimesso sul PC/, 10000)), "dimesso sul PC: «Dimesso sul PC: niente inviato»");
check(!(await notePc()).some((t) => /dimissione/.test(t)), "e la nota non arriva");
await tocca(tel, '[data-a="indietro"]');
check(!/VERDI/.test(await aspettaTel(tel, /ROSSI MARIO/, 10000)), "e dall'elenco del telefono se ne va");
// un paziente senza parametri letti (o un PC più vecchio, che il campo non lo manda): niente riga, nessun errore
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Richieste/, 10000);
check(await tel.locator("main > .vit").count() === 0 && await tel.locator(".seg").count() === 1, "senza parametri letti: sotto il nome niente, la pagina c'è");
await tocca(tel, '[data-a="indietro"]');

// ===========================================================================
sezione("due pazienti con lo stesso nome");
const omonimo = (si) => doc.evaluate((si) => {
  const K = "psassist:patients.v1";
  const l = JSON.parse(localStorage.getItem(K) || "[]").filter((p) => p.ep !== "999004");
  if (si) l.push({ ep: "999004", name: "ROSSI MARIO", url: "", ts: Date.now() - 30 * 60e3, pk: "", triage: "VERDE" });
  localStorage.setItem(K, JSON.stringify(l));
}, si);
await omonimo(true);
await rileggiTel(tel);
const due = await aspettaTel(tel, /…9004/, 10000);
check(/ROSSI MARIO · …9001/.test(due) && /ROSSI MARIO · …9004/.test(due), "(nell'elenco: «⚠ ROSSI MARIO · …9001» e «⚠ ROSSI MARIO · …9004»)");
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Richieste/, 10000);
const testaOm = await tel.locator(".top .tit").innerText();
check(testaOm === "⚠ ROSSI MARIO · …9001 · 77 anni · OBI 2", `in testa il segno che li distingue, come nell'elenco: «⚠ ROSSI MARIO · …9001 · 77 anni · OBI 2» (${testaOm})`);
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await aspettaTel(tel, /Dol th/, 10000);
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
await tel.locator("#quesito").fill("omonimo");
await tocca(tel, "#ordina");
const armOm = await tel.locator("#ordina").innerText();
check(/^Ordino 1 esame · tocca di nuovo\n⚠ ROSSI MARIO · …9001 · 77 anni · OBI 2$/.test(armOm), `e la conferma ha il ⚠ davanti al paziente, col segno anche lì (${armOm.replace(/\n/g, " / ")})`);
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');   // non si conferma: via la scelta
await omonimo(false);
await tocca(tel, '[data-a="indietro"]');
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 10000)), "(l'omonimo non c'è più)");

// ===========================================================================
sezione("la mappa sul telefono: sola lettura, Lista · Mappa, Alta · Bassa");
{
  const POSTI_PRIMA = await doc.evaluate(() => localStorage.getItem("psassist:stanza.ps.posti.v1"));
  const EXTRA = ["999011", "999012", "999013", "999014", "999015", "999016", "999017", "999018", "999019"];
  // pazienti inventati, sulla mappa: PS (OBI 4, OSS 1, le due sale d'attesa) e Alta (Letto 1, Rossa, Sedia 1, una barella); ROSA ELIO senza posto
  await doc.evaluate(({ EXTRA }) => {
    const K = "psassist:patients.v1", ora = Date.now(), min = 60e3;
    const l = JSON.parse(localStorage.getItem(K) || "[]").filter((p) => !EXTRA.includes(p.ep));
    const nuovi = [["999011", "NERI SARA", "ROSSO", 61], ["999012", "GALLI PAOLO", "VERDE", 34], ["999013", "DE LUCA ANNA", "AZZURRO", 82], ["999014", "SOLDI MARCO", "BIANCO", 19],
      ["999015", "MONTI GIORGIO", "ROSSO", 70], ["999016", "DE ANGELIS FRANCESCA", "ARANCIONE", 47], ["999017", "BARBIERI ELENA", "AZZURRO", 55], ["999018", "ROSA ELIO", "VERDE", 28], ["999019", "SERRA LUCIA", "VERDE", 66]];
    for (const [ep, name, triage, eta] of nuovi) l.push({ ep, name, url: "", ts: ora - 20 * min, pk: "", triage, eta });
    localStorage.setItem(K, JSON.stringify(l));
    const ps = JSON.parse(localStorage.getItem("psassist:stanza.ps.posti.v1") || "{}");
    Object.assign(ps, { 999011: { tipo: "letto", id: "obi4", ts: ora }, 999012: { tipo: "letto", id: "oss1", ts: ora }, 999019: { tipo: "area", id: "attesa", ts: ora - 5 * min },
      999013: { tipo: "area", id: "attesa", ts: ora - 4 * min }, 999014: { tipo: "area", id: "attesa2", ts: ora - 3 * min } });
    localStorage.setItem("psassist:stanza.ps.posti.v1", JSON.stringify(ps));
    localStorage.setItem("psassist:stanza.alta.posti.v1", JSON.stringify({ 999002: { tipo: "letto", id: "a1", ts: ora }, 999015: { tipo: "letto", id: "rossa", ts: ora },
      999016: { tipo: "letto", id: "as1", ts: ora }, 999017: { tipo: "letto", id: "ab1", ts: ora }, 998002: { tipo: "letto", id: "a2", ts: ora } }));
  }, { EXTRA });

  // il comando del PC: solo geometria e chi-sta-dove (episodi), niente nomi
  const r = await sw.evaluate(() => ponteSuScheda("mappa", {}));
  const d = r.dati || {};
  const per = (k) => (d.mappe || []).find((m) => m.k === k) || { letti: [], aree: [], posti: [] };
  const dove = (k) => JSON.stringify(per(k).posti.map((x) => `${x.ep}:${x.tipo}:${x.id}`).sort());
  check(r.ok === true && Object.keys(d).sort().join() === "cols,mappe,modifica,rows,vista" && d.cols === 40 && d.rows === 24 && (d.mappe || []).map((m) => m.k + "=" + m.nome).join() === "alta=Alta,ps=Bassa",
    `«mappa»: la griglia 40 × 24 e le due mappe, Alta e Bassa, e la vista del PC (${r.ok} · ${Object.keys(d).join()} · ${(d.mappe || []).map((m) => m.k + "=" + m.nome).join()} · ${d.vista})`);
  check(per("ps").letti.length === 8 && per("ps").aree.length === 2 && per("alta").letti.length === 11 && per("alta").aree.length === 0
    && JSON.stringify(per("alta").letti.find((l) => l.id === "rossa")) === JSON.stringify({ id: "rossa", c: 26, r: 10, w: 7, h: 7, nome: "Rossa", forma: "box" })
    && JSON.stringify(per("ps").letti.find((l) => l.id === "obi2")) === JSON.stringify({ id: "obi2", c: 10, r: 0, w: 5, h: 4, nome: "OBI 2" }),
    "letti e aree come sul PC (quelli di partenza: 8 + 2 al PS, 11 in Alta), ognuno con la sua misura e il suo nome");
  check(dove("ps") === JSON.stringify(["999001:letto:obi2", "999011:letto:obi4", "999012:letto:oss1", "999013:area:attesa", "999014:area:attesa2", "999019:area:attesa"])
    && dove("alta") === JSON.stringify(["999002:letto:a1", "999015:letto:rossa", "999016:letto:as1", "999017:letto:ab1"]),
    `chi sta dove, per episodio: ognuno in un posto solo, l'episodio precedente (998002) non ha posto (PS ${dove("ps")} · Alta ${dove("alta")})`);
  check(!/ROSSI|BIANCHI|NERI|GALLI|MONTI|SOLDI|BARBIERI/.test(JSON.stringify(d)) && JSON.stringify(Object.keys(per("ps").posti[0]).sort()) === '["ep","id","tipo"]',
    "e nient'altro: nessun nome di paziente nella risposta (il nome il telefono lo ha dalla riga di «pazienti»)");

  // il telefono: «Lista · Mappa»
  await rileggiTel(tel);
  await aspettaTel(tel, /NERI SARA/, 15000);
  const modoTel = () => tel.evaluate(() => ({ seg: [...document.querySelectorAll("main > .seg:not(.pic) button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join("|"),
    pic: [...document.querySelectorAll("main > .seg.pic button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join("|"), mappa: !!document.querySelector(".mappa"),
    chiave: localStorage.getItem("psassist.ponte.modo"), tutte: Object.keys(localStorage).sort().join() }));
  const m0 = await modoTel();
  check(m0.seg === "Lista*|Mappa|Da fare" && !m0.pic && !m0.mappa && m0.chiave === null, `in testa, quieto: «Lista · Mappa», si parte dalla Lista; scelta niente finché non si tocca (${JSON.stringify(m0)})`);
  await tocca(tel, '[data-a="modo"][data-m="mappa"]');
  const m1 = await modoTel();
  check(m1.seg === "Lista|Mappa*|Da fare" && m1.pic === "Alta|Bassa*" && m1.mappa && m1.chiave === "mappa" && m1.tutte === "psassist.ponte.modo,psassist.ponte.pcs.v1",
    `Mappa: sotto, «Alta · Bassa» (come il PC: la vista è Bassa); la scelta resta sul telefono, senza dati di pazienti (${JSON.stringify(m1)})`);
  const bassa = await tel.evaluate(() => ({
    occ: [...document.querySelectorAll(".mappa .letto.occ")].map((b) => `${b.dataset.ep}:${b.querySelector(".lb")?.textContent}:${b.querySelector(".ln").textContent}:${b.querySelector(".le")?.textContent || ""}:${[...b.classList].find((c) => /^t-/.test(c))}`).sort(),
    vuoti: [...document.querySelectorAll(".mappa .letto.vuoto")].map((b) => b.textContent).sort(),
    aree: [...document.querySelectorAll(".mappa .area")].map((a) => `${a.querySelector("h4").textContent}=${[...a.querySelectorAll(".pa")].map((c) => c.dataset.ep + ":" + c.textContent.replace(/[♥♡]/g, "")).sort().join(",")}`),
    senza: [...document.querySelectorAll("main > .lbl")].filter((x) => x.textContent === "Senza posto").length, senzaPaz: [...document.querySelectorAll("main > .lbl")].filter((x) => x.textContent === "Senza posto").map((x) => [...x.nextElementSibling.querySelectorAll(".paz[data-ep]")].map((r) => r.dataset.ep).join())[0],
  }));
  check(JSON.stringify(bassa.occ) === JSON.stringify(["999001:OBI 2:ROSSI:77:t-arancione", "999011:OBI 4:NERI:61:t-rosso", "999012:OSS 1:GALLI:34:t-verde"])
    && bassa.vuoti.join() === "OBI 1,OBI 3,OSS 2,OSS 3,OSS 4",
    `Bassa: i tre letti occupati col cognome (senza l'iniziale), l'età e il colore del triage; gli altri cinque vuoti, col solo nome (${JSON.stringify(bassa.occ)} · ${bassa.vuoti})`);
  check(bassa.aree.join("|") === "Sala attesa · 2=999013:DE LUCA,999019:SERRA|Sala attesa 2 · 1=999014:SOLDI",
    `le sale d'attesa: i pazienti come piccole etichette, col numero (${bassa.aree.join(" | ")})`);
  check(bassa.senza === 1 && bassa.senzaPaz === "999018",
    `chi non ha un posto su nessuna mappa resta sotto, «Senza posto», come righe della lista (${bassa.senzaPaz})`);
  // intera: larga quanto lo schermo, niente da scorrere (né di lato né dentro), i cognomi leggibili
  const forma = () => tel.evaluate(() => {
    const p = document.querySelector(".piano"), m = document.querySelector(".mappa"), r = m.getBoundingClientRect();
    // (un cognome lungo su una sedia — 4 celle — intera nella larghezza non ci sta: lo mostra il tocco che ingrandisce)
    const eccesso = [...document.querySelectorAll(".mappa .letto .ln, .mappa .pa .ln")].filter((x) => x.scrollWidth > x.clientWidth + 1
      && !(Number((x.closest("[data-mg]")?.dataset.mg || "").split(",")[2]) < 5 && x.closest(".letto"))).map((x) => x.textContent);
    const corpo = Math.min(...[...document.querySelectorAll(".mappa .letto.occ .ln, .mappa .pa .ln")].map((e) => parseFloat(getComputedStyle(e).fontSize)));
    return { larg: Math.round(p.getBoundingClientRect().width), mappa: Math.round(r.width), schermo: window.innerWidth, pagina: document.documentElement.scrollWidth <= window.innerWidth,
      scorre: m.scrollWidth > m.clientWidth || m.scrollHeight > m.clientHeight, eccesso, corpo, ta: getComputedStyle(m).touchAction, scala: window.visualViewport.scale };
  });
  const intera = (f) => f.larg <= f.mappa && f.mappa <= f.schermo && f.pagina && !f.scorre && !f.eccesso.length && f.corpo >= 8;
  const dimmi = (f) => `${f.larg} px in ${f.mappa}, schermo ${f.schermo}, scorre ${f.scorre}, cognomi ≥ ${f.corpo} px${f.eccesso.length ? `, tagliati: ${f.eccesso}` : ""}`;
  const f0 = await forma();
  check(intera(f0) && f0.ta === "pan-x pan-y",
    `la mappa intera sta nella larghezza dello schermo: niente da scorrere, né di lato né dentro; la pagina non scorre di lato; i cognomi interi e leggibili (${dimmi(f0)})`);
  await shot(tel, "tel-mappa-bassa");
  await shot(tel, "mappa-verticale-bassa");

  // «Alta · Bassa»
  await tocca(tel, '[data-a="mappasel"][data-k="alta"]');
  const alta = await tel.evaluate(() => ({ pic: [...document.querySelectorAll("main > .seg.pic button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join("|"),
    occ: [...document.querySelectorAll(".mappa .letto.occ")].map((b) => `${b.dataset.ep}:${b.querySelector(".ln").textContent}`).sort(), vuoti: [...document.querySelectorAll(".mappa .letto.vuoto")].map((b) => b.textContent).sort(),
    aree: document.querySelectorAll(".mappa .area").length, senza: [...document.querySelectorAll("main > .lbl")].filter((x) => x.textContent === "Senza posto").length }));
  check(alta.pic === "Alta*|Bassa" && alta.occ.join() === "999002:BIANCHI,999015:MONTI,999016:DE ANGELIS,999017:BARBIERI" && alta.vuoti.length === 7 && alta.aree === 0 && alta.senza === 1,
    `Alta: Letto 1, Rossa, Sedia 1 e la barella con i loro pazienti; gli altri sette vuoti; l'episodio precedente da nessuna parte (${alta.occ} · ${alta.vuoti.length} vuoti)`);
  await shot(tel, "tel-mappa-alta");
  const f1 = await forma();
  check(intera(f1), `anche l'Alta, intera nella larghezza, senza scorrere (${dimmi(f1)})`);
  // in orizzontale (il telefono girato): tutte e due intere, senza scorrere — decide l'altezza della cornice
  await tel.setViewportSize({ width: 844, height: 390 });
  await sospendi(300);
  const fA = await forma();
  await shot(tel, "mappa-orizzontale-alta");
  await tocca(tel, '[data-a="mappasel"][data-k="ps"]');
  const fB = await forma();
  await shot(tel, "mappa-orizzontale-bassa");
  check(intera(fA) && intera(fB), `girato in orizzontale: Alta e Bassa intere, senza scorrere (Alta ${dimmi(fA)} · Bassa ${dimmi(fB)})`);
  await tel.setViewportSize(IPHONE.viewport);
  await sospendi(300);
  await tocca(tel, '[data-a="mappasel"][data-k="alta"]');
  await shot(tel, "mappa-verticale-alta");

  // un tocco su un posto vuoto la ingrandisce lì; un altro la riporta intera
  {
    const zoom = () => tel.evaluate(() => Number(document.querySelector(".piano").style.getPropertyValue("--zoom")));
    await tel.locator(".letto.vuoto").first().click();
    const z1 = await zoom();
    await tel.locator(".letto.vuoto").first().click();
    const fz = await forma();
    check(z1 > 2 && await zoom() === 1 && intera(fz), `tocco su un posto vuoto: la mappa si ingrandisce (${z1}), un altro la riporta intera — larga quanto lo schermo, senza scorrere (${dimmi(fz)})`);
    const minimo = await tel.evaluate(() => Math.min(...[...document.querySelectorAll(".letto.occ .ln")].map((e) => parseFloat(getComputedStyle(e).fontSize))));
    check(minimo >= 9, `i cognomi sui letti sono leggibili anche in verticale: almeno 9 px (${minimo})`);
  }
  // si modifica: un nome tenuto premuto si trascina su un letto; fuori dalla mappa torna fra «Senza posto»; la mappa resta in cima
  {
    const cdp = await telCtx.newCDPSession(tel);
    let mk = "ps";   // (la mappa che si vede: Alta o Bassa, «ps»)
    const postiPc = () => doc.evaluate((k) => JSON.parse(localStorage.getItem(`psassist:stanza.${k}.posti.v1`) || "{}"), mk);
    const trascina = async (da, a) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [da] });
      await sospendi(700);
      for (let k = 1; k <= 6; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(da.x + (a.x - da.x) * k / 6), y: Math.round(da.y + (a.y - da.y) * k / 6) }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    // la riga di chi è «Senza posto», portata nella metà bassa dello schermo (sotto la mappa che resta in cima)
    const riga = await tel.evaluate(() => { const r = document.querySelector('.paz[data-ep="999018"]'); window.scrollBy(0, r.getBoundingClientRect().top - innerHeight * 0.85);
      const m = document.querySelector(".mappa").getBoundingClientRect(), b = r.getBoundingClientRect(); return { x: Math.round(b.x + 60), y: Math.round(b.y + b.height / 2), mappaFondo: Math.round(m.bottom), mappaCima: Math.round(m.top) }; });
    check(await tel.locator(".mappa").evaluate((m) => getComputedStyle(m).position === "sticky") && riga.y > riga.mappaFondo, `la mappa è «sticky» (in cima mentre la lista scorre): mappa ${riga.mappaCima}–${riga.mappaFondo}, riga a ${riga.y}`);
    // un letto vuoto che si vede per intero nella cornice
    const letto = await tel.evaluate(() => { const m = document.querySelector(".mappa").getBoundingClientRect();
      for (const e of document.querySelectorAll(".letto.vuoto[data-lid]")) { const b = e.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
        if (x > m.left + 8 && x < m.right - 8 && y > m.top + 8 && y < m.bottom - 8) return { lid: e.dataset.lid, x: Math.round(x), y: Math.round(y) }; } return null; });
    check(!!letto, "un letto vuoto c'è, e si vede");
    await trascina({ x: riga.x, y: riga.y }, { x: letto.x, y: letto.y });
    const idLetto = letto.lid.split(":")[1].split("@")[0];
    mk = letto.lid.split("@")[1];
    check(await finche(async () => (await postiPc())["999018"]?.id === idLetto, 15000), `trascinato su un letto: il PC lo mette lì (${idLetto}), con lo stesso gesto della sua mappa`);
    await shot(tel, "mappa-modificabile");
    check(await finche(async () => await tel.locator(`.letto.occ[data-ep="999018"]`).count() === 1 && await tel.locator('.paz[data-ep="999018"]').count() === 0, 15000), "e il telefono lo ridisegna dalla risposta del PC: sul letto, non più «Senza posto»");
    // fuori dalla mappa: di nuovo senza posto
    const sul = await tel.evaluate(() => { const b = document.querySelector('.letto.occ[data-ep="999018"]').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), fuori: Math.round(document.querySelector(".mappa").getBoundingClientRect().bottom + 40) }; });
    await trascina({ x: sul.x, y: sul.y }, { x: sul.x, y: Math.min(sul.fuori, 800) });
    check(await finche(async () => !(await postiPc())["999018"], 15000) && await finche(async () => await tel.locator('.paz[data-ep="999018"]').count() === 1, 15000), "lasciato fuori dalla mappa: torna fra «Senza posto», sul PC e sul telefono");
    check(await tel.locator(".fantasma").count() === 0, "il nome trascinato non resta in giro");
    // Chi è al Triage (la lista letta dal PC; non fra i pazienti): di partenza nella Sala attesa della
    // Bassa, senza che niente si scriva; DE LUCA, che è fra i pazienti col suo posto, non si sposta né si
    // ripete. Portato su un letto dal telefono, il PC lo scrive e lì resta.
    await doc.evaluate(() => localStorage.setItem("psassist:triage.lista.v1", JSON.stringify({ ts: Date.now(), righe: [
      { nome: "GRIGI TINA", breve: "GRIGI T.", eta: 30, triage: "VERDE", area: "", arrivo: Date.now() - 80 * 60e3 },
      { nome: "DE LUCA ANNA", breve: "DE LUCA A.", eta: 82, triage: "AZZURRO", area: "", arrivo: Date.now() - 30 * 60e3 }] })));
    await rileggiTel(tel);
    await tocca(tel, '[data-a="mappasel"][data-k="ps"]');
    await finche(async () => await tel.locator('.mappa .area .pa[data-a="ospite"]').count() === 1, 15000);
    const attesa = await tel.evaluate(() => [...document.querySelectorAll(".mappa .area")].map((a) => `${a.querySelector("h4").textContent}=${[...a.querySelectorAll(".pa")].map((p) => `${p.dataset.a}:${p.textContent}`).join(",")}`).join(" | "));
    const scrittoPrima = Object.keys(await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:stanza.ps.posti.v1") || "{}"))).filter((k) => /^tr/.test(k)).length;
    // (la parte che si vede: l'area scorre per conto suo, e il terzo nome può esserne mezzo fuori)
    const ospite = await tel.evaluate(() => { const e = document.querySelector('.mappa .pa[data-a="ospite"]'), b = e.getBoundingClientRect(), a = e.closest(".area").getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round((Math.max(b.top, a.top) + Math.min(b.bottom, a.bottom - 2)) / 2) }; });
    const libero = await tel.evaluate(() => { const e = document.querySelector('.letto.vuoto[data-lid^="letto:obi1"]'), b = e.getBoundingClientRect(); return { lid: e.dataset.lid, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; });
    await trascina(ospite, libero);
    const scritto = async () => Object.entries(await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:stanza.ps.posti.v1") || "{}"))).filter(([k]) => /^tr/.test(k)).map(([, v]) => v.id).join();
    const sulLetto = await finche(async () => await scritto() === "obi1" && await tel.locator('.letto.occ[data-a="ospite"]').count() === 1, 15000);
    check(/^Sala attesa · 3=paz:DE LUCA,paz:SERRA,ospite:GRIGI \| Sala attesa 2 · 1=paz:SOLDI$/.test(attesa) && scrittoPrima === 0 && sulLetto
      && (await tel.locator('.letto.occ[data-a="ospite"] .ln').innerText()) === "GRIGI",
      `chi è al Triage: di partenza nella Sala attesa della Bassa (mai scritto), chi ha già un posto non si sposta; portato su OBI 1 dal telefono, il PC lo scrive e lì resta (${attesa} · scritto: ${await scritto()})`);
    await shot(tel, "mappa-triage-attesa");
    // (24) dopo lo spostamento: «GRIGI in OBI 1 · Annulla» per 5 secondi, e «Annulla» rimette il posto di prima
    const avvisoAnn = await finche(async () => await tel.locator('.avviso [data-a="avvisoAz"]').count() === 1, 8000);
    const testoAnn = avvisoAnn ? await tel.locator(".avviso").innerText() : "";
    await tel.locator('.avviso [data-a="avvisoAz"]').click({ timeout: 4000 }).catch(() => {});
    const tornato = await finche(async () => await scritto() !== "obi1" && await tel.locator('.letto.occ[data-a="ospite"]').count() === 0, 15000);
    check(avvisoAnn && /^GRIGI in OBI 1\s+Annulla$/.test(testoAnn) && tornato && await tel.locator(".avviso").count() === 0,
      `(24) dopo lo spostamento «GRIGI in OBI 1 · Annulla»; un tocco lo rimette dov'era (${testoAnn.replace(/\n/g, " ")} · scritto: ${await scritto()})`);
    await doc.evaluate(() => {
      localStorage.removeItem("psassist:triage.lista.v1");
      const p = JSON.parse(localStorage.getItem("psassist:stanza.ps.posti.v1") || "{}");
      for (const k of Object.keys(p)) if (/^tr/.test(k)) delete p[k];
      localStorage.setItem("psassist:stanza.ps.posti.v1", JSON.stringify(p));
    });
    await rileggiTel(tel);
    await finche(async () => await tel.locator(".mappa").count() === 1 && await tel.locator('[data-a="ospite"]').count() === 0, 15000);
  }

  // il pizzico: due dita, dentro la mappa; la pagina non si ingrandisce
  {
    const cdp = await telCtx.newCDPSession(tel), b = await tel.locator(".mappa").boundingBox(), y = Math.round(b.y + Math.min(b.height / 2, 120)), x = Math.round(b.x + b.width / 2);
    const punti = (a, c) => [{ x: x - a, y, id: 0 }, { x: x + c, y, id: 1 }];
    const prima = await tel.evaluate(() => document.querySelector(".piano").getBoundingClientRect().width);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: punti(40, 40) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: punti(80, 80) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: punti(100, 100) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const dopo = await tel.evaluate(() => ({ w: document.querySelector(".piano").getBoundingClientRect().width, z: Number(document.querySelector(".piano").style.getPropertyValue("--zoom")), scala: window.visualViewport.scale,
      pagina: document.documentElement.scrollWidth <= window.innerWidth, scorre: document.querySelector(".mappa").scrollWidth > document.querySelector(".mappa").clientWidth }));
    check(dopo.z > 1.8 && dopo.z <= 2.6 && dopo.w > prima * 1.7 && dopo.scala === 1 && dopo.pagina && dopo.scorre,
      `il pizzico ingrandisce la mappa (×${dopo.z.toFixed(2)}: ${Math.round(prima)} → ${Math.round(dopo.w)} px), scorre di lato dentro la sua cornice, la pagina resta com'è (scala ${dopo.scala})`);
    await tocca(tel, '[data-a="mappasel"][data-k="ps"]');
    check(await tel.evaluate(() => Number(document.querySelector(".piano").style.getPropertyValue("--zoom"))) > 1.8, "cambiando mappa (o a un ridisegno) lo zoom resta");
    await tel.evaluate(() => { document.querySelector(".piano").style.setProperty("--zoom", 1); });
    await tocca(tel, '[data-a="mappasel"][data-k="alta"]');
  }

  // un tocco su un letto occupato apre il paziente, come una riga della lista
  await tocca(tel, '.mappa .letto.occ[data-ep="999002"]');
  check(/BIANCHI ANNA · \d+ anni/.test(await aspettaTel(tel, /Richieste/, 10000) && await tel.locator(".top .tit").innerText()), "un tocco sul letto occupato: la schermata del paziente, come da una riga della lista");
  await tocca(tel, '[data-a="indietro"]');
  await aspettaTel(tel, /Alta/, 10000);
  const torna = await modoTel();
  check(torna.mappa && torna.seg === "Lista|Mappa*|Da fare", "«indietro»: di nuovo la mappa");
  // ricordata: ricaricata la pagina, ancora la Mappa
  await tel.reload();
  await aspettaTel(tel, /Lista\s*Mappa/, 20000);
  await finche(async () => (await modoTel()).mappa, 10000);
  const m2 = await modoTel();
  check(m2.mappa && m2.seg === "Lista|Mappa*|Da fare",
    `ricaricata la pagina: ancora la Mappa (${JSON.stringify(m2)})`);

  // le foto: verticale e orizzontale, Alta e Bassa
  if (process.env.PSA_SIDE) {
    for (const k of ["ps", "alta"]) {
      await tocca(tel, `[data-a="mappasel"][data-k="${k}"]`);
      const html = await tel.evaluate(() => document.documentElement.outerHTML.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
      for (const [nome, w, h] of [["verticale", 390, 844], ["orizzontale", 844, 390]]) {
        const fotoCtx = await telBrowser.newContext({ ...IPHONE, viewport: { width: w, height: h }, deviceScaleFactor: 2 });
        const foto = await fotoCtx.newPage();
        await foto.route("**/*", (r) => (/app\.css$/.test(r.request().url()) ? r.fulfill({ path: join(root, "../public/ponte/app.css"), contentType: "text/css" }) : r.fulfill({ status: 200, contentType: "text/html", body: html })));
        await foto.goto("https://ponte.invalid/ponte/");
        await foto.screenshot({ path: join(process.env.PSA_SIDE, `mappa-telefono-${k === "ps" ? "bassa" : "alta"}-${nome}.png`), fullPage: true }).catch(() => {});
        await fotoCtx.close();
      }
    }
  }

  // un PC più vecchio non conosce il comando: niente scelta, la lista di sempre, nessun errore
  await tel.route(/\/app\.js/, async (r) => { const t = await (await r.fetch()).text(); await r.fulfill({ status: 200, contentType: "text/javascript", body: "window.__mappaVecchia = true;" + t.replace('chiedi("mappa"', 'chiedi("mappa_vecchia"') }); });
  await tel.evaluate(() => navigator.serviceWorker?.getRegistrations().then((l) => Promise.all(l.map((x) => x.unregister()))));
  await tel.reload();
  await aspettaTel(tel, /ROSSI MARIO/, 20000);
  const vecchia = await tel.evaluate(() => ({ prova: window.__mappaVecchia === true, seg: [...document.querySelectorAll("main > .seg button")].map((b) => b.textContent).join("|"), mappa: !!document.querySelector(".mappa"), righe: document.querySelectorAll(".paz[data-ep]").length, err: document.querySelectorAll(".avviso, [role=alert]").length }));   // (l'ordine finito male di prima, che sta su ogni pagina, non è un errore di questa)
  check(vecchia.prova && vecchia.seg === "Lista|Da fare" && !vecchia.mappa && vecchia.righe >= 8 && !vecchia.err, `con un PC che non conosce «mappa» («Comando sconosciuto»): niente «Mappa» nella scelta, la lista com'è, nessun errore (${JSON.stringify(vecchia)})`);
  await tel.unroute(/\/app\.js/);

  // via la prova
  await doc.evaluate(({ EXTRA, POSTI_PRIMA }) => {
    const K = "psassist:patients.v1";
    localStorage.setItem(K, JSON.stringify(JSON.parse(localStorage.getItem(K) || "[]").filter((p) => !EXTRA.includes(p.ep))));
    if (POSTI_PRIMA == null) localStorage.removeItem("psassist:stanza.ps.posti.v1"); else localStorage.setItem("psassist:stanza.ps.posti.v1", POSTI_PRIMA);
    localStorage.removeItem("psassist:stanza.alta.posti.v1");
  }, { EXTRA, POSTI_PRIMA });
  await tel.evaluate(() => localStorage.removeItem("psassist.ponte.modo"));
  await tel.reload();
  await aspettaTel(tel, /ROSSI MARIO/, 20000);
  check(!/NERI SARA|ROSA ELIO/.test(await testoTel(tel)), "(finita la prova: i pazienti inventati non ci sono più, la Lista come prima)");
}

// ===========================================================================
sezione("i messaggi ripetuti o manomessi non passano");
const daTel = () => inoltrati.filter((b) => b[1] === 3);
// una nota, catturata per strada, poi un'altra: rimandare la prima non la rimette
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Rileggi/, 15000);
const noteSulPc = () => notePc();
const prima = daTel().length;
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await aggiungiNota(tel, "nota A");
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
await finche(async () => (await noteSulPc()).includes("nota A"), 10000);
const fNotaA = daTel().slice(prima).at(-1);
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await aggiungiNota(tel, "nota B");
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
await finche(async () => (await noteSulPc()).includes("nota B"), 10000);
const senzaOra = (await daFarePc()).filter((x) => x.t == null).map((x) => x.testo);
check(senzaOra.join("|") === "dolore dalle 6, allergico a PCN|nota A|nota B", `ogni «+ nota» è una voce nuova di «Da fare», in fondo (got: ${senzaOra.join(" | ")})`);
// qualcuno sulla strada (fra il telefono e il ripetitore) che rimanda quello che vuole
const versoPc = (frames) => { const p = rete.prese.get(rete.ultima); for (const f of frames) p.server.send(Buffer.from(f)); };
const manomesso = Buffer.from(fNotaA); manomesso[9] ^= 0x7f; manomesso[manomesso.length - 2] ^= 1;
versoPc([fNotaA, manomesso]);
await sospendi(1200);
check((await noteSulPc()).filter((x) => x === "nota A").length === 1 && (await noteSulPc()).filter((x) => x === "nota B").length === 1 && (await noteSulPc()).length === 3, "una nota ripetuta per strada non torna, e una manomessa nemmeno: scartate");
versoPc([0, 1, 2, 3, 4, 5].map((i) => { const g = Buffer.from(manomesso); g[g.length - 3 - i] ^= 0x55; return g; }));
await sospendi(1500);
check(!!(await statoPonte())?.sessione, "sei messaggi non validi di fila: ignorati, la sessione resta (chi non ha le chiavi non chiude niente)");
await tocca(tel, '[data-a="indietro"]');
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 10000)) && !/Sessione chiusa/.test(await testoTel(tel)), "e il telefono continua");

// ===========================================================================
// (passato il tempo in cui la risposta persa sarebbe scaduta: nessun allarme)
await sospendi(Math.max(0, tPerso + 63e3 - Date.now()));
const avvisi = await tel.evaluate(() => window.__avvisi || []);
check(!avvisi.some((x) => /Non so se l'ordine/.test(x)), `e la risposta persa di un ordine già visto non accende mai «Non so se l'ordine è partito» (${JSON.stringify(avvisi)})`);

// ===========================================================================
sezione("la pagina del telefono si ricarica (iOS la butta via in sottofondo)");
await tel.reload();
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 15000)), "ricaricata: di nuovo dentro subito, senza QR (la sessione di prima non la blocca)");
check(/iPhone ricollegato: sessione nuova/.test(await registroPonte()), "sul PC: «iPhone ricollegato: sessione nuova»");

// ===========================================================================
sezione("il battito: una presa che sembra aperta ma non porta niente");
const prese1 = relay.entrate().tel;
rete.muta = rete.ultima;
await tel.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));   // tornati sull'app: si prova subito la presa
check(await finche(async () => relay.entrate().tel > prese1, 14000), "nessun «pong» entro 10 secondi: il telefono rifà la presa");
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 10000)), "e l'elenco resta");
// tornati sull'app: l'elenco si rilegge da solo (contato sul PC, al comando: il Registro del pannello tiene le
// ultime 200 righe, e pieno non cresce più — contarci le righe non dice se ne è arrivata una nuova)
await sw.evaluate(() => {
  self.__elenchi = 0;
  if (!self.__suScheda) { self.__suScheda = ponteSuScheda; ponteSuScheda = (c, ...a) => { if (c === "pazienti") self.__elenchi++; return self.__suScheda(c, ...a); }; }
});
await tel.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
check(await finche(async () => (await sw.evaluate(() => self.__elenchi)) > 0, 10000),
  "tornati sull'app, l'elenco si rilegge da solo");
// …e sulla pagina di un paziente, i suoi esiti (un referto arrivato intanto), senza contare come un comando del medico
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Rileggi/, 15000);
await sospendi(800);
const esiti0 = await registroRighe(doc), ultimo0 = await sw.evaluate(() => pt.sessione && pt.sessione.ultimo);
await tel.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
check(await finche(async () => righeDopo(esiti0, await registroRighe(doc)).some((x) => /iPhone · esiti di ROSSI MARIO/.test(x)), 10000), "tornati sull'app sulla pagina di un paziente, i suoi esiti si rileggono da soli");
check(await sw.evaluate(() => pt.sessione && pt.sessione.ultimo) === ultimo0, "e non tengono aperta la sessione: li chiede l'app, non il medico");
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /ROSSI MARIO/, 10000);

// ===========================================================================
sezione("3 minuti senza comandi");
const avanti = (ms) => sw.evaluate((x) => { self.__oraVera = self.__oraVera || Date.now; const v = self.__oraVera; Date.now = () => v() + x; return ponteControlla(); }, ms);
const orologio = () => sw.evaluate(() => { if (self.__oraVera) Date.now = self.__oraVera; });
// il telefono che nessuno tocca, sulla Mappa ingrandita e spostata: il ridisegno di ogni 30 secondi la rimette dov'era
// (uno «scroll» che non è il medico) — niente al PC, e ai 3 minuti si chiude
{
  const ultimoPc = () => sw.evaluate(() => pt.sessione && pt.sessione.ultimo);
  const posMappa = () => tel.evaluate(() => { const m = document.querySelector(".mappa"); return m ? [Math.round(m.scrollLeft), Math.round(m.scrollTop)] : null; });
  await tocca(tel, '[data-a="modo"][data-m="mappa"]');
  await tel.waitForSelector(".mappa .letto.vuoto", { timeout: 10000 });
  await tel.locator(".mappa .letto.vuoto").first().click();   // (ingrandita)
  await tel.evaluate(() => { const m = document.querySelector(".mappa"); m.scrollLeft = 150; m.scrollTop = 120; });
  await sospendi(500);
  const u0 = await ultimoPc(), p0 = await posMappa();
  await tel.evaluate(() => {
    const v = Date.now; window.__oraVera = v; Date.now = () => v() + 70e3;   // (passato più di un minuto dall'ultimo comando)
    window.__ridisegni = 0;
    new MutationObserver(() => { window.__ridisegni++; }).observe(document.getElementById("app"), { childList: true });
  });
  const ridisegnata = await finche(async () => (await tel.evaluate(() => window.__ridisegni)) > 0, 35000);
  await sospendi(1500);
  check(ridisegnata && p0 && p0[0] > 0 && JSON.stringify(await posMappa()) === JSON.stringify(p0) && await ultimoPc() === u0,
    `nessuno tocca, sulla Mappa spostata: il ridisegno la rimette dov'era (${JSON.stringify(p0)}), e non è un comando — niente al PC`);
  await tel.evaluate(() => { Date.now = () => window.__oraVera() + 3 * 60e3 + 10e3; });
  check(!!(await aspettaTel(tel, /Sessione chiusa/, 35000)) && await finche(async () => !(await statoPonte())?.sessione, 10000),
    "…e ai 3 minuti senza un tocco si chiude, sul telefono e sul PC");
  await tel.evaluate(() => { Date.now = window.__oraVera; document.dispatchEvent(new Event("visibilitychange")); });   // tornati sull'app: si riapre
  await finche(async () => !!(await statoPonte())?.sessione && await tel.locator('[data-a="modo"][data-m="lista"]').count() === 1, 20000);
  await tocca(tel, '[data-a="modo"][data-m="lista"]');
  await tel.evaluate(() => localStorage.removeItem("psassist.ponte.modo"));
  await aspettaTel(tel, /BIANCHI ANNA/, 10000);
}
// (12) il telefono è su un paziente, scheda Esiti: dopo i 3 minuti si riapre lì
await tocca(tel, '.paz[data-ep="999001"]'); await aspettaTel(tel, /Richieste/, 10000);
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
// il telefono in mano: un tocco (anche su niente, anche quello che comincia a scorrere) è il medico che legge — conta come un comando, al più uno al minuto
{
  await sospendi(500);
  const ultimoPc = () => sw.evaluate(() => pt.sessione && pt.sessione.ultimo);
  const u0 = await ultimoPc();
  await tel.evaluate(() => { const m = document.querySelector("main"); m.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); m.dispatchEvent(new TouchEvent("touchstart", { bubbles: true })); });
  await sospendi(1200);
  check(await ultimoPc() === u0, "un tocco subito dopo un comando: niente al PC (al più uno al minuto)");
  // un minuto dopo, sul telefono: uno «scroll» da solo no (lo fa anche un ridisegno); il dito che comincia a scorrere i valori sì
  await tel.evaluate(() => { const v = Date.now; window.__oraVera = v; Date.now = () => v() + 70e3; document.querySelector("main").dispatchEvent(new Event("scroll")); });
  await sospendi(1200);
  check(await ultimoPc() === u0, "passato un minuto, uno «scroll» senza un dito (lo fa anche il ridisegno): niente al PC");
  await tel.evaluate(() => document.querySelector("main").dispatchEvent(new TouchEvent("touchstart", { bubbles: true })));
  check(await finche(async () => (await ultimoPc()) > u0, 6000), "…il dito che comincia a scorrere i valori conta come un comando: anche il PC sposta il suo orologio dei 3 minuti");
  const u1 = await ultimoPc();
  await tel.evaluate(() => document.querySelector("main").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await sospendi(1200);
  check(await ultimoPc() === u1, "…e un altro tocco subito dopo no");
  await tel.evaluate(() => { Date.now = window.__oraVera; });
}
await avanti(2 * 60e3);
check(!!(await statoPonte())?.sessione, "a 2 minuti la sessione c'è ancora");
await avanti(4 * 60e3);
check(!(await statoPonte())?.sessione, "a 4 minuti senza comandi la sessione è chiusa");
await orologio();
const inatt = await aspettaTel(tel, /Sessione chiusa/, 10000);
check(/3 minuti senza comandi/.test(inatt) && !/ROSSI/.test(inatt), "il telefono davanti lo dice, «3 minuti senza comandi», e i pazienti non ci sono più");
await shot(tel, "tel-7-sessione-chiusa");
check(await finche(async () => (await $panel(doc, ".pontespia").count()) === 0, 8000), "e sul PC la spia si spegne");
// (che cosa si vede, da qui in poi: «Sessione chiusa» non deve passare nemmeno per un attimo)
const guardaChiusa = () => tel.evaluate(() => {
  window.__chiusa = false;
  window.__guarda?.disconnect();
  window.__guarda = new MutationObserver(() => { if (/Sessione chiusa/.test(document.getElementById("app").textContent)) window.__chiusa = true; });
  window.__guarda.observe(document.getElementById("app"), { childList: true, subtree: true, characterData: true });
});
const sessioniNuove = async () => ((await registroPonte()).match(/iPhone ricollegato: sessione nuova|iPhone collegato/g) || []).length;
const s0 = await sessioniNuove();
await tel.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));   // tornati sull'app
const riaperta0 = await aspettaTel(tel, /ROSSI MARIO/, 15000);
check(/ROSSI MARIO/.test(riaperta0) && !!(await statoPonte())?.sessione, `tornati sull'app dopo la chiusura: si riapre da sola, senza QR e senza un tocco (${s0} → ${await sessioniNuove()}; ${riaperta0.replace(/\s+/g, " ").slice(0, 100)})`);
check(await finche(async () => await tel.locator(".top button.tit").count() === 1 && await tel.locator('.seg [data-s="esiti"].on').count() === 1, 10000)
  && (await tel.evaluate(() => Object.keys(localStorage))).every((k) => /^psassist\.ponte\.(pcs\.v1|modo)$/.test(k)) && !/ROSSI/.test(await tel.evaluate(() => JSON.stringify(Object.entries(localStorage)))),
  "(12) dopo i 3 minuti si riapre sul paziente dov'eri e sulla stessa scheda (Esiti); su disco niente più della lista dei PC");
await tocca(tel, '[data-a="indietro"]'); await aspettaTel(tel, /BIANCHI ANNA/, 10000);
// l'app lasciata in sottofondo: le riletture da sola non contano come comandi
await guardaChiusa();
await tel.evaluate(() => { const v = Date.now; window.__oraVera = v; Date.now = () => v() + 2 * 60e3; document.dispatchEvent(new Event("visibilitychange")); });
await sospendi(1500);
check(!/Sessione chiusa/.test(await testoTel(tel)), "a 2 minuti, tornati sull'app: l'elenco si rilegge da solo…");
const s1 = await sessioniNuove(), sess1 = await sw.evaluate(() => pt.sessione && pt.sessione.dal);
await tel.evaluate(() => { const v = window.__oraVera; Date.now = () => v() + 4 * 60e3; document.dispatchEvent(new Event("visibilitychange")); });
const dalDi = () => sw.evaluate(() => pt.sessione && pt.sessione.dal);   // (il registro tiene 60 righe: contare lì le sessioni non regge)
const riaperta = await finche(async () => (await dalDi()) !== sess1 && /ROSSI MARIO/.test(await testoTel(tel)), 15000);
await tel.evaluate(() => { Date.now = window.__oraVera; });
check(riaperta && await dalDi() !== sess1,
  "…ma non conta: a 4 minuti dall'ultimo comando del medico la sessione di prima è chiusa (via i pazienti), e se ne apre un'altra da sola");
check(!(await tel.evaluate(() => window.__chiusa)), "e «Sessione chiusa» non si è visto nemmeno per un attimo");

// ===========================================================================
sezione("«Scollega» sul PC");
await finche(async () => (await $panel(doc, "#ponteoff").count()) === 1, 8000);
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Rileggi/, 15000);
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await aggiungiNota(tel, "nota C");
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
await aspettaTel(tel, /Da fare salvato sul PC/, 10000);
await $panel(doc, "#ponteoff").click();
const scollegata = await aspettaTel(tel, /Sessione chiusa/, 10000);
check(/Chiusa dal PC con «Scollega»/.test(scollegata), "«Scollega»: il telefono si chiude, «Chiusa dal PC con «Scollega»» (con la maiuscola)");
check(await tel.locator(".avviso").count() === 0, "e gli avvisi di prima se ne vanno con la sessione");
await tocca(tel, '[data-a="riapri"]');
await aspettaTel(tel, /ROSSI MARIO/, 15000);

// ===========================================================================
sezione("nessun gestionale aperto, sessione del gestionale scaduta");
await doc.close();
await tocca(tel, '.paz[data-ep="999002"]');
check(/Apri il gestionale sul PC/.test(await aspettaTel(tel, /Apri il gestionale sul PC/, 15000)), "senza schede del gestionale: «Apri il gestionale sul PC»");
await tel.reload();   // (la sessione di nuovo da capo, senza gestionale)
check(/Elenco non letto/.test(await aspettaTel(tel, /Elenco non letto/, 15000)) && await tel.locator('[data-a="aggiornaLista"]:has-text("Riprova")').count() === 1,
  "riaperta senza gestionale: «Elenco non letto» e «Riprova», non una rotella per sempre");
await shot(tel, "tel-8-elenco-non-letto");
const doc2 = await ctx.newPage();
await suPagina(doc2, A.worklistUrl);
await tocca(tel, '[data-a="aggiornaLista"]');
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 15000)), "aperto il gestionale, «Riprova»: l'elenco");
login = true;
await tocca(tel, '[data-a="paz"][data-ep="999002"]');
check(/Gestionale da riaprire/.test(await aspettaTel(tel, /Gestionale da riaprire/, 15000)), "col gestionale che chiede l'accesso: «Gestionale da riaprire»");
login = false;
await tocca(tel, '[data-a="indietro"]').catch(() => {});

// ===========================================================================
sezione("il service worker si ferma e riparte");
await aspettaTel(tel, /ROSSI MARIO/, 15000);
await tocca(tel, '.paz[data-ep="999002"]');
await aspettaTel(tel, /Richieste/, 10000);
await tocca(tel, '[data-a="scheda"][data-s="cartella"]');
await guardaChiusa();
// (la pagina del ponte, aperta, lo sveglierebbe lei: devono farlo le schede del gestionale)
check(!ctx.pages().some((p) => p.frames().some((f) => f.url().includes("/ponte.html"))), "(nessuna pagina del ponte aperta, né scheda né cornice)");
await sw.evaluate(() => { self.__vecchio = true; });
const dalPc0 = rete.dalPc.length;
// Chrome lo ferma (qui lo si ferma dal protocollo di debug, come farebbe Chrome)
// (da una pagina dell'estensione che non gli parla: quella del portale)
const pag = await ctx.newPage();
await pag.goto(EXTURL("portale.html"));
const cdp = await ctx.newCDPSession(pag);
const versioni = [];
cdp.on("ServiceWorker.workerVersionUpdated", (e) => versioni.push(...e.versions));
await cdp.send("ServiceWorker.enable");
await finche(async () => versioni.some((v) => v.scriptURL.endsWith("bg.js") && v.runningStatus === "running"), 5000);
const fermato = Date.now();
const errStop = await cdp.send("ServiceWorker.stopWorker", { versionId: versioni.find((v) => v.scriptURL.endsWith("bg.js")).versionId }).then(() => "", (e) => e.message);
await pag.close();
check(!errStop && await finche(async () => relay.prese().pc === 0, 10000), `fermato il service worker, la sua presa sul ponte cade${errStop ? ` (${errStop})` : ""}`);
check(await finche(async () => relay.prese().pc === 1, 45000), "le schede del gestionale lo svegliano, e si ricollega da solo al ponte (la chiave è rimasta)");
sw = await swDi(ctx).catch(() => sw);
// (il telefono si ricollega subito: una sessione, se c'è già, è una nuova)
check(!(await sw.evaluate(() => self.__vecchio).catch(() => true)) && !((await statoPonte())?.sessione?.dal < fermato),
  "è un service worker nuovo: la sessione di prima non c'è più, le sue chiavi stavano in memoria");
// il telefono era su BIANCHI, scheda Cartella: se ne accorge appena il PC torna sul ponte, e si ricollega da solo lì —
// «Sessione chiusa» non si vede nemmeno per un attimo (nessuno l'ha chiusa)
check(await finche(async () => !!(await statoPonte())?.sessione && await tel.locator('.seg [data-s="cartella"].on').count() === 1 && /BIANCHI ANNA/.test(await tel.locator(".top").innerText().catch(() => "")), 20000)
  && !(await tel.evaluate(() => window.__chiusa)) && await sw.evaluate(() => !self.__vecchio),
  "l'estensione sul PC riavviata: il telefono si ricollega da solo, sullo stesso paziente e sulla stessa scheda, senza «Sessione chiusa»");
await shot(tel, "tel-7-riavvio-ricollegato");
// il «riparti» che l'ha chiusa, catturato per strada
let riparti = null;
for (const f of rete.dalPc.slice(dalPc0)) {
  if (f[1] !== P.TIPO.SALUTO_PC) continue;
  try { if ((await P.apri(CH1.salutoPc, new Uint8Array(f), P.TIPO.SALUTO_PC)).dati.riparti) riparti = f; } catch { /* altro */ }
}
check(!!riparti, "(il «riparti» del PC, catturato sulla strada)");
const dal1 = await sw.evaluate(() => pt.sessione && pt.sessione.dal);
if (riparti) rete.prese.get(rete.ultima).ws.send(riparti);
await sospendi(1500);
check(!(await tel.evaluate(() => window.__chiusa)) && /BIANCHI ANNA/.test(await testoTel(tel)) && await sw.evaluate(() => pt.sessione && pt.sessione.dal) === dal1,
  "quel «riparti» rimandato più tardi non chiude la sessione nuova");
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /ROSSI MARIO/, 15000);

// ===========================================================================
sezione("revoca, link che sostituiscono, scadenza, la pagina d'accesso");
const ponte2 = await ctx.newPage();
await ponte2.goto(EXTURL("ponte.html"));
await ponte2.waitForSelector("#revoca:not([hidden])");
await ponte2.locator("#revoca").click();
check(await finche(async () => /Revoco\?/.test(await ponte2.locator("#revoca").innerText()), 5000), "«Revoca» chiede conferma");
await ponte2.locator("#revoca").click();
check(/revocat/.test(await aspettaTel(tel, /revocat/, 10000)), "revocata: il telefono lo dice");
check(await tel.evaluate(() => localStorage.length) === 0, "e dimentica la chiave");
const vecchio = await telCtx.newPage();
await vecchio.goto(url1);
const nonRisponde = await aspettaTel(vecchio, /Il PC non risponde|QR scaduto/, 15000);
check(/Il PC non risponde/.test(nonRisponde) ? /QR nuovo/.test(nonRisponde) : /QR scaduto/.test(nonRisponde), "il vecchio QR non apre più niente: «Il PC non risponde» (e se c'è un QR nuovo, inquadra quello), o «QR scaduto» se i pochi minuti sono passati");
await vecchio.close();
await tel.evaluate(() => localStorage.clear());
await ponte2.locator("#associa").click();
await ponte2.waitForSelector("#qr svg", { timeout: 8000 });
const url2 = await qrUrl();
check(url2 !== url1, "un QR nuovo, con una chiave nuova");
await tel.goto(url2);   // con l'app già aperta: cambia solo il frammento
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 15000)), "il QR nuovo inquadrato con l'app aperta: chiave nuova, e di nuovo l'elenco");
// Un QR nuovo AGGIUNGE un PC alla lista e ci passa (ognuno la sua chiave: una
// non apre gli altri; l'associazione non scade). Non toglie quelli di prima —
// un PC completo che risponde prende il posto del completo; questi PC finti non
// rispondono, quindi restano in lista come «da collegare».
const linkCtx = await telBrowser.newContext(IPHONE);
const lnk = await linkCtx.newPage();
const finta = (k) => `${relay.url}/ponte/#k=${P.b64u(k)}&scade=${Date.now() + 100 * 365 * 86400e3}`;
const listaK = () => lnk.evaluate(() => { const o = JSON.parse(localStorage.getItem("psassist.ponte.pcs.v1") || "null"); return o ? o.v.map((p) => p.k) : []; });
const KX = P.casuale(32), KY = P.casuale(32);
await lnk.goto(finta(KX));
await aspettaTel(lnk, /Mi collego|non risponde/, 10000);
const cx = await chiaveTel(lnk);
check(cx && cx.k === P.b64u(KX) && !("scade" in cx), "un link con la sua scadenza lunga: sul telefono resta solo la chiave (l'associazione non scade)");
await lnk.goto(finta(KY));
await aspettaTel(lnk, /Mi collego|non risponde/, 10000);
const cy = await chiaveTel(lnk);
check(cy && cy.k === P.b64u(KY), "un QR nuovo aggiunge un PC e ci passa: il suo è l'attivo");
const ks = await listaK();
check(ks.length === 2 && ks.includes(P.b64u(KX)) && ks.includes(P.b64u(KY)), "…e non toglie quello di prima: la lista tiene i due PC, ognuno la sua chiave");
await linkCtx.close();
// l'associazione non scade: passate le 14 ore (e il PC controlla), la chiave c'è ancora, sul PC e sul telefono, e il telefono riapre
const K2 = P.b64u(P.leggiFrammento(new URL(url2).hash).k);
await avanti(14 * 3600e3 + 60e3);
await sw.evaluate(() => ponteAvvia());   // (come al risveglio del service worker: rilegge la chiave da disco)
check((await coppiaPc())?.k === K2 && (await statoPonte())?.accoppiato && (await chiaveTel(tel))?.k === K2, "passate le 14 ore: l'associazione c'è ancora, sul PC (anche su disco) e sul telefono");
await aspettaTel(tel, /Riapri|Sessione chiusa|ROSSI MARIO/, 15000);
if (await tel.locator('[data-a="riapri"]').count()) await tocca(tel, '[data-a="riapri"]');
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 20000)), "…e il telefono riapre da solo, senza QR nuovo, dopo le 14 ore");
await shot(tel, "tel-10-oltre-14-ore");
await orologio();
// il link del QR, invece, vale solo per il primo scambio, e poco: un QR nuovo, e passati 7 minuti non apre più
await ponte2.reload();
await ponte2.waitForSelector("#stato b");
await nuovoQr(ponte2);   // (un telefono è già entrato: «Nuovo QR», due tocchi)
const urlE = await qrUrl();
await avanti(7 * 60e3);
{
  const lateCtx = await telBrowser.newContext(IPHONE);
  const late = await lateCtx.newPage();
  await late.goto(urlE);
  check(/Il PC non risponde/.test(await aspettaTel(late, /Il PC non risponde/, 15000)) && (await coppiaPc())?.dev === "",
    "il link del QR dopo il suo tempo: il PC non lo accetta, nessun telefono entra");
  await lateCtx.close();
  const vecCtx = await telBrowser.newContext(IPHONE);
  const vec = await vecCtx.newPage();
  await vec.goto(`${relay.url}/ponte/#k=${P.b64u(P.casuale(32))}&scade=${Date.now() - 1000}`);
  check(/QR scaduto/.test(await aspettaTel(vec, /QR scaduto/, 10000)) && await vec.evaluate(() => localStorage.length) === 0, "un link con la scadenza passata: «QR scaduto» sul telefono, niente salvato");
  await vecCtx.close();
}
await orologio();
await tel.evaluate(() => localStorage.clear());
// una scheda del gestionale torna alla pagina d'accesso: la sessione si chiude, l'associazione resta
await ponte2.reload();
await ponte2.waitForSelector("#stato b");
await ponte2.locator("#associa").click();
await ponte2.waitForSelector("#qr svg", { timeout: 8000 });
const url3 = await qrUrl();
const K3 = P.b64u(P.leggiFrammento(new URL(url3).hash).k);
await tel.goto(url3);
await aspettaTel(tel, /ROSSI MARIO/, 15000);
login = true;
await doc2.goto(A.patientUrl);
login = false;
const accesso = await aspettaTel(tel, /pagina d'accesso/, 15000);
check(/Sessione chiusa/.test(accesso) && /Il gestionale sul PC è tornato alla pagina d'accesso/.test(accesso) && !/ROSSI/.test(accesso),
  "una scheda del gestionale alla pagina d'accesso: la sessione si chiude, «Il gestionale sul PC è tornato alla pagina d'accesso», via i pazienti");
check((await coppiaPc())?.k === K3 && (await chiaveTel(tel))?.k === K3, "l'associazione resta, sul PC e sul telefono");
await shot(tel, "tel-11-pagina-accesso");
// rientrato nel gestionale (la pagina d'accesso ha svuotato l'elenco del PC: i pazienti si riaprono)
await suPagina(doc2, A.patientUrl);
await suPagina(doc2, B.patientUrl);
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 15000)) && (await coppiaPc())?.k === K3, "rientrati nel gestionale, «Riapri»: di nuovo l'elenco, con la stessa associazione e senza QR nuovo");

// ===========================================================================
sezione("il browser del PC si chiude e si riapre");
await guardaChiusa();
const chiuso = Date.now();
await ctx.close();
ctx = await apriBrowser();
sw = await swDi(ctx);
check((await coppiaPc())?.k === K3, "riaperto il browser, l'associazione c'è ancora: sta su disco (storage.local) fino alla revoca");
// la sessione di prima è finita (le sue chiavi stavano in memoria): il telefono se ne accorge e se ne apre una nuova da solo, senza «Sessione chiusa»
check(await finche(async () => (await statoPonte())?.sessione?.dal > chiuso, 30000) && !(await tel.evaluate(() => window.__chiusa)),
  "il telefono sa che la sessione di prima è finita, e si ricollega da solo (nessuno l'ha chiusa): niente «Sessione chiusa»");
const doc3 = await ctx.newPage();
await suPagina(doc3, A.worklistUrl);
// (senza una scheda del gestionale l'elenco non si legge: «Riprova», o tornando sull'app)
if (await tel.locator('[data-a="aggiornaLista"]').count()) await tocca(tel, '[data-a="aggiornaLista"]'); else await rileggiTel(tel);
check(/ROSSI MARIO/.test(await aspettaTel(tel, /ROSSI MARIO/, 20000)), "aperto il gestionale: di nuovo l'elenco, senza QR nuovo");

// ===========================================================================
sezione("«Stampa un PDF» dal telefono, sull'A4 del PC");
{
  // il finto aiutante di stampa (lo stesso di ext-stampa.mjs): annota i fogli invece di stamparli
  const FINTO = join("/tmp", "psa-ponte-finto-" + process.pid);
  mkdirSync(FINTO, { recursive: true });
  const comportati = (extra = {}) => writeFileSync(join(FINTO, "config.json"), JSON.stringify({ stampanti: ["Zebra ZD421", "HP LaserJet A4"], predefinita: "HP LaserJet A4", ...extra }));
  const lavori = () => (existsSync(join(FINTO, "lavori.jsonl")) ? readFileSync(join(FINTO, "lavori.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const lanciatore = join(FINTO, "ospite.sh");
  writeFileSync(lanciatore, `#!/bin/sh\nPSA_FINTO='${FINTO}' exec '${process.execPath}' '${join(root, "test/ospite-finto.mjs")}' "$@"\n`);
  chmodSync(lanciatore, 0o755);
  comportati();
  mkdirSync(join(PROFILE, "NativeMessagingHosts"), { recursive: true });
  writeFileSync(join(PROFILE, "NativeMessagingHosts", "it.psassist.stampa.json"),
    JSON.stringify({ name: "it.psassist.stampa", description: "finto", path: lanciatore, type: "stdio", allowed_origins: [`chrome-extension://${extId}/`] }));
  const SEGNO = "QJXV5518 FOGLIO DAL TELEFONO";
  // tre pezzi: il PDF vero, e dietro un riempitivo (i pezzi sono da ~390 KB)
  const pdf = Buffer.concat([refertoRxPdf(["Foglio di prova", SEGNO]), Buffer.alloc(900000, 0x42)]);
  // (le parole della carta della stampa, tutte quelle che passano)
  await tel.evaluate(() => {
    window.__stampa = [];
    new MutationObserver(() => { const b = document.querySelector(".stampa b"); if (b && window.__stampa.at(-1) !== b.textContent) window.__stampa.push(b.textContent); })
      .observe(document.getElementById("app"), { childList: true, subtree: true });
  });
  const scegli = async (file) => {
    await tocca(tel, '[data-a="menu"]');
    const [fc] = await Promise.all([tel.waitForEvent("filechooser", { timeout: 8000 }), tocca(tel, '[data-a="stampaPdf"]')]);
    await fc.setFiles(file);
  };
  const carta = async (re, ms = 30000) => (await finche(async () => re.test(await tel.locator(".stampa").innerText().catch(() => "")), ms)) ? tel.locator(".stampa").innerText() : "";
  const comePdf = { name: "foglio.pdf", mimeType: "application/pdf", buffer: pdf };

  // 1. senza la stampa automatica la voce è spenta, e dice perché PRIMA del tocco (catalogo.stampa.auto)
  const voce = tel.locator('.menu [data-a="stampaPdf"]');
  await tocca(tel, '[data-a="menu"]');
  check(await voce.isDisabled() && /Sul PC la stampa automatica non è impostata/.test(await voce.innerText()),
    `senza la stampa automatica sul PC: «Stampa PDF» spenta, col perché (${(await voce.innerText()).replace(/\s+/g, " ")})`);
  // accesa sul PC, la voce si accende da sola (l'evento «stampa»)…
  await sw.evaluate(() => chrome.storage.local.set({ stampa: { attiva: true, etichette: "Zebra ZD421", a4: "HP LaserJet A4" } }));
  check(await finche(async () => !(await voce.isDisabled()), 10000), "accesa la stampa automatica sul PC: «Stampa PDF» si accende da sola");
  // …e se il PC la spegne proprio mentre il PDF parte: no, e il resto del PDF non parte (il PC lo dice al primo pezzo)
  const a0 = rete.alPc.length;
  {
    const [fc] = await Promise.all([tel.waitForEvent("filechooser", { timeout: 8000 }), tocca(tel, '[data-a="stampaPdf"]')]);
    await sw.evaluate(() => chrome.storage.local.remove("stampa"));
    await fc.setFiles(comePdf);
  }
  const senza = await carta(/stampa automatica/, 15000);
  check(/Sul PC la stampa automatica non è impostata/.test(senza) && await tel.locator(".stampa.err").count() === 1 && rete.alPc.slice(a0).filter((x) => x.length > 1e5).length === 1 && !lavori().length,
    `senza la stampa automatica sul PC: «Sul PC la stampa automatica non è impostata», e il resto del PDF non parte (${rete.alPc.slice(a0).filter((x) => x.length > 1e5).length} pezzi)`);
  await tocca(tel, '[data-a="stampaVia"]');

  // (la stampa automatica di nuovo accesa: le prove dopo)
  await sw.evaluate(() => chrome.storage.local.set({ stampa: { attiva: true, etichette: "Zebra ZD421", a4: "HP LaserJet A4" } }));
  await tocca(tel, '[data-a="menu"]');
  await finche(async () => !(await voce.isDisabled()), 10000);
  await tocca(tel, '[data-a="menu"]');

  // 2. un file che non è un PDF: il telefono non lo manda
  const a1 = rete.alPc.length;
  await scegli({ name: "nota.pdf", mimeType: "application/pdf", buffer: Buffer.from("non sono un PDF") });
  check(/Non è un PDF/.test(await carta(/Non è un PDF/, 8000)) && rete.alPc.length === a1, "un file che non comincia con «%PDF»: «Non è un PDF», e non parte niente");
  await tocca(tel, '[data-a="stampaVia"]');

  // 3. con la stampa automatica: a pezzi, cifrato, fino all'A4
  const n0 = inoltrati.length, a2 = rete.alPc.length;
  await scegli(comePdf);
  const fatto = await carta(/Stampato su/, 40000);
  check(/Stampato su HP LaserJet A4/.test(fatto) && await tel.locator(".stampa.ok").count() === 1, `il telefono: «Stampato su HP LaserJet A4», in verde (${fatto.replace(/\s+/g, " ")})`);
  const visti = await tel.evaluate(() => window.__stampa);
  check(visti.some((t) => /^Invio… \d+%$/.test(t)), `mentre va, «Invio… 40%» (${visti.join(" → ")})`);
  const l1 = lavori();
  check(l1.length === 1 && l1[0].tipo === "a4" && l1[0].stampante === "HP LaserJet A4" && l1[0].byte === pdf.length, `sul PC: un foglio, sull'A4, intero (${JSON.stringify(l1.map((x) => [x.tipo, x.stampante, x.byte]))})`);
  check(/PDF dall'iPhone stampato su HP LaserJet A4/.test(await registroPonte()), "il registro del ponte: «PDF dall'iPhone stampato su HP LaserJet A4»");
  await shot(tel, "tel-stampa-1-stampato");
  const visto = inoltrati.slice(n0), tutto = Buffer.concat(visto);
  const pezzi = ["%PDF", "JVBERi", "endstream", SEGNO, pdf.subarray(400, 440).toString("latin1"), pdf.subarray(300, 330).toString("base64").slice(4, 36)];
  const trovati = pezzi.filter((x) => tutto.includes(Buffer.from(x, "latin1")) || tutto.includes(Buffer.from(x, "utf16le")));
  check(rete.alPc.length - a2 >= 3 && !trovati.length, `sul ripetitore (${visto.length} messaggi, ${tutto.length} byte) niente «%PDF», niente del suo testo (trovati: ${trovati.length})`);
  const memoria = await sw.evaluate(async () => ({ tel: PDF_TEL.size, s: JSON.stringify(await chrome.storage.session.get(null)), l: JSON.stringify(await chrome.storage.local.get(null)) }));
  const b64 = pdf.subarray(0, 600).toString("base64").slice(0, 200);
  check(memoria.tel === 0 && !memoria.s.includes(b64) && !memoria.l.includes(b64), "stampato, sul PC il PDF non c'è più: né in memoria né in storage");
  const rec = (await sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []))).find((x) => /^pdftel/.test(x.id));
  check(!!rec && rec.paziente === "PDF dall'iPhone" && rec.stato === "avviso" && !rec.stampa, "nel giornale delle stampe: «PDF dall'iPhone», finito, e senza «Ristampa» (il PDF non c'è più)");

  // 4. rimandato: i messaggi ripetuti per strada, o la stessa richiesta col suo numero — una stampa sola
  versoPc(rete.alPc.slice(a2));
  await sospendi(2500);
  const rid = rec ? rec.id.slice(6) : "";
  const rifatta = await sw.evaluate(([rid, b]) => ponteStampa({}, { rid, i: 0, n: 1, size: b.length * 3 / 4, b }), [rid, pdf.subarray(0, 3000).toString("base64")]);
  await sospendi(1500);
  check(lavori().length === 1 && rifatta.ok && /Stampato su HP LaserJet A4/.test(rifatta.dati.titolo),
    `la richiesta ripetuta per strada, o rimandata col suo numero: com'è andata, e nessuna seconda stampa (fogli: ${lavori().length})`);

  // 5. il PC controlla da sé: un file che non è un PDF, o oltre 15 MB, no
  const nonPdf = await sw.evaluate(() => ponteStampa({}, { rid: "nonpdf12345", i: 0, n: 1, size: 12, b: btoa("ciao, niente") }));
  const grosso = await sw.evaluate(() => ponteStampa({}, { rid: "grosso12345", i: 0, n: 40, size: 15e6 + 1, b: btoa("%PDF-1.4 x") }));
  check(!nonPdf.ok && /Non è un PDF/.test(nonPdf.errore) && !grosso.ok && /troppo grande/.test(grosso.errore) && lavori().length === 1,
    `sul PC: un file che non è un PDF, o oltre 15 MB, è rifiutato (${nonPdf.errore} / ${grosso.errore})`);

  // 6. finito nella coda di Windows: «Mandato a …», in ambra
  comportati({ esito: { "HP LaserJet A4": "mandato" } });
  await tocca(tel, '[data-a="stampaVia"]');
  await scegli({ ...comePdf, buffer: refertoRxPdf(["Foglio corto"]) });
  const mandato = await carta(/Mandato a/, 40000);
  check(/Mandato a HP LaserJet A4/.test(mandato) && /coda di Windows/.test(mandato) && await tel.locator(".stampa.warn").count() === 1 && lavori().length === 2,
    `nella coda di Windows: «Mandato a HP LaserJet A4», in ambra (${mandato.replace(/\s+/g, " ")})`);
  await shot(tel, "tel-stampa-2-mandato");
  comportati();
  await tocca(tel, '[data-a="stampaVia"]');
  await sw.evaluate(() => chrome.storage.local.remove(["stampa", "stampaEsito"]));
  rmSync(FINTO, { recursive: true, force: true });
}

// ===========================================================================
sezione("le registrazioni del PC dal telefono: elenco, scarica a pezzi, cancella");
{
  // due zip già salvati sul PC (registra.js): uno automatico di ~1 MB (tre pezzi), uno a mano
  const SEGNO = "QZWX4417 DENTRO LO ZIP";
  const zipFinto = (n, seme) => { const b = Buffer.alloc(n); let x = seme; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } Buffer.from("PK\x03\x04").copy(b, 0); Buffer.from(SEGNO).copy(b, 5000); return b; };
  const zA = zipFinto(1000000, 7), zM = zipFinto(30000, 11), ora = Date.now();
  // (gli ordini finiti male qui sopra hanno già salvato i loro zip automatici: si parte da un elenco vuoto)
  await sw.evaluate(async () => { for (const z of await regElenco()) await regZipVia(z.id); });
  const metti = (b, meta) => sw.evaluate(async ([b64z, meta]) => {
    const bin = atob(b64z), u = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    await RegistraDb.tx(["zip", "zipdati"], "readwrite", (z, d) => { z.put(meta); d.put(u, meta.id); });
    await regAvvisaElenco();
  }, [b.toString("base64"), meta]);
  await metti(zA, { id: "provazipauto", nome: "psassist-registrazione-20261106-0930-auto.zip", ts: ora - 60e3, quando: ora - 120e3, byte: zA.length, motivo: "auto",
    errore: "Errore · mancano: TROPONINA", controllo: false, punti: 2, pagine: 6, richieste: 20, pdf: 1, riepilogo: "PS Assist — registrazione anonimizzata" });
  await metti(zM, { id: "provazipmano", nome: "psassist-registrazione-20261106-0800.zip", ts: ora - 3600e3, quando: ora - 7200e3, byte: zM.length, motivo: "manuale",
    errore: "", controllo: true, punti: 0, pagine: 3, richieste: 9, pdf: 0, riepilogo: "PS Assist — registrazione anonimizzata" });
  await tocca(tel, '[data-a="menu"]');
  await tocca(tel, '[data-a="registrazioni"]');
  const el = await aspettaTel(tel, /a mano/, 20000);
  const righe = await tel.locator(".zip").evaluateAll((l) => l.map((x) => x.dataset.zip));
  check(/Registrazioni/.test(await tel.locator("header").innerText()) && righe.join() === "provazipauto,provazipmano",
    `⋯ → Registrazioni: l'elenco del PC, la più recente in testa (${righe.join(", ")})`);
  check(/automatica/.test(el) && /977 KB|1,0 MB|0,9 MB/.test(el) && /Errore · mancano: TROPONINA/.test(el) && /Restano 2 dati da controllare/.test(el) && /Controllo superato/.test(el) && /29 KB/.test(el),
    `per ognuna: quando, a mano o automatica e perché, la misura, il controllo (${el.replace(/\s+/g, " ").slice(0, 200)})`);
  check(!/ROSSI|BIANCHI|999001/.test(el) && !(await piccoli(tel)).length, `niente pazienti, e ogni bottone almeno 44 px (${JSON.stringify(await piccoli(tel))})`);
  check(/iPhone · elenco delle registrazioni \(2\)/.test(await registroPonte()), "il registro del ponte: «iPhone · elenco delle registrazioni»");
  await shot(tel, "tel-registrazioni");
  await tel.emulateMedia({ colorScheme: "dark" }); await shot(tel, "tel-registrazioni-buio"); await tel.emulateMedia({ colorScheme: "light" });
  // «Scarica»: a pezzi; poi «Condividi…» la passa a iOS (qui il foglio di condivisione è finto)
  await tel.evaluate(() => { window.__condiviso = null; navigator.canShare = (d) => !!(d && d.files && d.files.length); navigator.share = (d) => { window.__condiviso = d.files[0]; return Promise.resolve(); }; });
  const n0 = inoltrati.length, a0 = rete.alPc.length;
  await tocca(tel, '.zip[data-zip="provazipauto"] [data-a="zipScarica"]');
  check(await finche(async () => await tel.locator('.zip[data-zip="provazipauto"] [data-a="zipManda"]').count() === 1, 30000), "«Scarica»: arrivata, e il bottone diventa «Condividi…»");
  await tocca(tel, '.zip[data-zip="provazipauto"] [data-a="zipManda"]');
  await finche(() => tel.evaluate(() => !!window.__condiviso), 5000);
  const cond = await tel.evaluate(async () => { const f = window.__condiviso; if (!f) return null; const u = new Uint8Array(await f.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return { nome: f.name, tipo: f.type, b: btoa(s) }; });
  check(cond && cond.nome === "psassist-registrazione-20261106-0930-auto.zip" && cond.tipo === "application/zip" && Buffer.from(cond.b, "base64").equals(zA),
    `«Condividi…»: a iOS va un file .zip, ricomposto dai pezzi, identico a quello del PC (${cond && cond.nome}, ${cond && Buffer.from(cond.b, "base64").length} byte)`);
  const chiesti = rete.alPc.length - a0, visti = Buffer.concat(inoltrati.slice(n0));
  check(chiesti >= 3 && !visti.includes(Buffer.from(SEGNO)) && !visti.includes(Buffer.from(zA.subarray(6000, 6040).toString("base64").slice(4, 36))),
    `a pezzi (${chiesti} domande), e il ripetitore non vede niente dello zip`);
  check(/iPhone · registrazione psassist-registrazione-20261106-0930-auto\.zip scaricata sul telefono/.test(await registroPonte()), "il registro del ponte: «registrazione … scaricata sul telefono»");
  const memTel = await tel.evaluate(async () => JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage), ((await indexedDB.databases?.()) || []).map((d) => d.name)]));
  check(memTel === '[["psassist.ponte.pcs.v1"],[],[]]', `sul telefono lo zip sta solo in memoria: niente su disco (${memTel})`);
  // senza la condivisione di iOS: «Salva», un file
  await tel.evaluate(() => { delete navigator.canShare; delete navigator.share; });
  await tocca(tel, '.zip[data-zip="provazipmano"] [data-a="zipScarica"]');
  await finche(async () => await tel.locator('.zip[data-zip="provazipmano"] a.btnmini').count() === 1, 20000);
  const [dl] = await Promise.all([tel.waitForEvent("download", { timeout: 10000 }).catch(() => null), tel.locator('.zip[data-zip="provazipmano"] a.btnmini').click()]);
  const dlFile = join("/tmp", `psa-ponte-zip-${process.pid}.zip`);
  if (dl) await dl.saveAs(dlFile);
  check(dl && dl.suggestedFilename() === "psassist-registrazione-20261106-0800.zip" && readFileSync(dlFile).equals(zM), `senza la condivisione: «Salva», lo stesso file (${dl && dl.suggestedFilename()})`);
  rmSync(dlFile, { force: true });
  // «Cancella»: due tocchi, e sul PC non c'è più
  await tocca(tel, '.zip[data-zip="provazipauto"] [data-a="zipVia"]');
  check(/Cancello dal PC\? Tocca di nuovo/.test(await tel.locator('.zip[data-zip="provazipauto"] [data-a="zipVia"]').innerText()) && (await sw.evaluate(() => regElenco())).length === 2,
    "«Cancella»: il primo tocco chiede «Cancello dal PC? Tocca di nuovo», e non cancella");
  await tocca(tel, '.zip[data-zip="provazipauto"] [data-a="zipVia"]');
  check((await sw.evaluate(() => regElenco())).length === 2, "un secondo tocco subito (un doppio tocco per sbaglio) non conta");
  await sospendi(900);
  await tocca(tel, '.zip[data-zip="provazipauto"] [data-a="zipVia"]');
  const via = await finche(async () => (await sw.evaluate(() => regElenco())).map((z) => z.id).join() === "provazipmano", 15000);
  check(via && await finche(async () => await tel.locator('.zip[data-zip="provazipauto"]').count() === 0, 8000) && await sw.evaluate(() => RegistraDb.tx("zipdati", "readonly", (s) => s.count())) === 1,
    "il secondo tocco la cancella sul PC (anche i byte), e la riga se ne va");
  check(/iPhone · registrazione psassist-registrazione-20261106-0930-auto\.zip cancellata dal PC/.test(await registroPonte()), "il registro del ponte: «registrazione … cancellata dal PC»");
  // una non elencata in questa sessione non si dà e non si cancella
  const furbo = await sw.evaluate(() => ponteDaiRegistrazione({ zip: new Set() }, { zip: "provazipmano", i: 0 }));
  check(!furbo.ok && /riapri l'elenco/.test(furbo.errore), `una registrazione non elencata in questa sessione non si dà (${furbo.errore})`);
  // «Cancella» pesa meno di «Scarica»; «Cancella tutto» (due tocchi) toglie dal PC tutte quelle in elenco
  await metti(zA, { id: "provazipauto", nome: "psassist-registrazione-20261106-0930-auto.zip", ts: ora - 60e3, quando: ora - 120e3, byte: zA.length, motivo: "auto",
    errore: "", controllo: true, punti: 0, pagine: 6, richieste: 20, pdf: 1, riepilogo: "PS Assist — registrazione anonimizzata" });
  await tocca(tel, '[data-a="indietro"]'); await tocca(tel, '[data-a="menu"]'); await tocca(tel, '[data-a="registrazioni"]');
  check(await finche(async () => await tel.locator(".zip").count() === 2, 15000), "di nuovo due registrazioni in elenco");
  const peso = await tel.evaluate(() => { const f = (s) => getComputedStyle(document.querySelector(s)).backgroundColor;
    return { via: f('[data-a="zipVia"]'), scarica: f('[data-a="zipScarica"]') }; });
  check(peso.via === "rgba(0, 0, 0, 0)" && peso.scarica !== "rgba(0, 0, 0, 0)", `«Cancella» senza fondo, «Scarica» pieno (${JSON.stringify(peso)})`);
  await tocca(tel, '[data-a="zipTutte"]');
  check(/Cancello tutte le 2 dal PC\? Tocca di nuovo/.test(await tel.locator('[data-a="zipTutte"]').innerText()) && (await sw.evaluate(() => regElenco())).length === 2,
    "«Cancella tutto»: il primo tocco chiede («Cancello tutte le 2 dal PC? Tocca di nuovo»), e non cancella");
  await sospendi(900);
  await tocca(tel, '[data-a="zipTutte"]');
  check(await finche(async () => (await sw.evaluate(() => regElenco())).length === 0, 15000) && await finche(async () => await tel.locator(".zip").count() === 0, 8000),
    "il secondo tocco le cancella tutte dal PC, e l'elenco sul telefono si svuota");
  check(/iPhone · 2 registrazioni cancellate dal PC/.test(await registroPonte()), "il registro del ponte: «2 registrazioni cancellate dal PC»");
  await tocca(tel, '[data-a="indietro"]');
  await aspettaTel(tel, /BIANCHI ANNA/);
}

// ===========================================================================
sezione("la rete del telefono: ascensore, 5G, presa tagliata, rete lenta");
{
  // Un telefono con la rete vera di Chromium (non la strada finta di prima), la
  // stessa chiave e lo stesso numero: la rete la cambia il protocollo DevTools
  // (Network.emulateNetworkConditions), il ripetitore taglia le prese. Le prese
  // che l'app apre si contano, con l'ora.
  const chiave = await chiaveTel(tel);
  const vCtx = await telBrowser.newContext(IPHONE);
  await vCtx.addInitScript(salto);
  await vCtx.addInitScript(() => {
    const W = window.WebSocket;
    window.__prese = [];
    window.WebSocket = class extends W { constructor(u, p) { super(u, p); window.__prese.push(Date.now()); } };
  });
  const v = await vCtx.newPage();
  await v.goto(relay.url + "/ponte/");
  await v.evaluate((c) => localStorage.setItem("psassist.ponte.pcs.v1", JSON.stringify({ v: [c], attivo: c.id })), chiave);
  await v.reload();
  await aspettaTel(v, /ROSSI MARIO/, 20000);
  const cdp = await vCtx.newCDPSession(v);
  await cdp.send("Network.enable");
  const reteV = (o = {}) => cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, ...o });
  const pill = () => v.evaluate(() => document.querySelector(".statopc")?.textContent || "").catch(() => "");
  const grigi = () => v.locator("#app .nopc").count();
  await tocca(v, '.paz[data-ep="999001"]');
  await aspettaTel(v, /RX TORACE/, 20000);

  // 1. l'ascensore: niente rete. Quello che c'è resta; quello che va chiesto al PC, in grigio
  const p0 = await v.evaluate(() => window.__prese.length);
  await reteV({ offline: true });
  await finche(async () => /Senza rete/.test(await pill()), 5000);
  const offline = await v.evaluate(() => ({ valori: document.querySelector('[data-a="valori"]')?.classList.contains("nopc"), testo: document.getElementById("app").innerText }));
  check(offline.valori && await grigi() >= 1 && /RX TORACE/.test(offline.testo) && /Senza rete/.test(await pill()),
    `senza rete: in testa «Senza rete», gli esiti in memoria restano, e quello che va chiesto al PC è in grigio (${await grigi()} in grigio)`);
  // la presa di prima è morta senza dirlo: il battito se ne accorge, e i tentativi si diradano
  await sospendi(40000);
  const ore = (await v.evaluate(() => window.__prese)).slice(p0);
  const passi = ore.slice(1).map((t, i) => t - ore[i]);
  check(ore.length >= 4 && ore.length <= 12 && passi[0] < 1500 && Math.max(...passi) <= 15500 && Math.max(...passi) >= 6000,
    `senza rete i tentativi si diradano: il primo subito, poi sempre più radi, mai oltre 15 s (${ore.length} prese in 40 s; ${passi.map((x) => (x / 1000).toFixed(1)).join(" · ")} s)`);
  // 2. fuori dall'ascensore: la rete torna, la presa si rifà subito, i bottoni tornano da soli
  let t0 = Date.now();
  await reteV();
  const tornata = await finche(async () => !(await pill()) && relay.prese().tel === 1, 10000);
  const dt = Date.now() - t0;
  check(tornata && dt < 3000, `tornata la rete, il telefono si ricollega subito, senza aspettare il prossimo tentativo (${dt} ms)`);
  check(await finche(async () => (await grigi()) === 0, 5000), "e quello che era in grigio torna da solo");
  // 3. la presa tagliata (il ripetitore, un proxy, il passaggio dal wifi al 5G)
  const e0 = relay.entrate().tel;
  t0 = Date.now();
  relay.taglia("tel");
  const rifatta = await finche(async () => relay.entrate().tel > e0 && relay.prese().tel === 1 && !(await pill()), 10000);
  check(rifatta && Date.now() - t0 < 3000, `la presa tagliata si rifà da sola, subito (${Date.now() - t0} ms)`);

  // 4. un promemoria la cui risposta si perde: la presa cade mentre il PC lo
  // scrive, il telefono lo rimanda col suo numero — sul PC uno solo
  await sw.evaluate(() => {
    self.__vere = { scheda: ponteSuScheda, comando: ponteComando, pdf: ponteDaiPdf, ordina: ponteOrdina };
    // (gli ordini che il PC fa davvero, per quesito: quanti arrivano alla scheda del gestionale)
    self.__eseguiti = [];
    globalThis.ponteOrdina = (d) => { self.__eseguiti.push(d.quesito); return self.__vere.ordina(d); };
    self.__arrivi = []; self.__pezzi = [];
    globalThis.ponteSuScheda = async (cmd, a) => { if (cmd === "dfAggiungi") await attendi(3000); return self.__vere.scheda(cmd, a); };
    self.__ordini = [];
    globalThis.ponteComando = (s, d) => {
      if (d && d.cmd === "dfAggiungi") self.__arrivi.push(d.rq);
      if (d && d.cmd === "ordina") self.__ordini.push(d.quesito);
      return self.__vere.comando(s, d);
    };
    globalThis.ponteDaiPdf = async (s, d) => { self.__pezzi.push(d.i); if (d.i === 1 && self.__pezzi.length === 2) await attendi(2000); return self.__vere.pdf(s, d); };
  });
  const emogas = () => doc3.evaluate(() => (JSON.parse(localStorage.getItem("psassist:dafare.v1") || "{}")["999001"] || []).filter((x) => !x.fatto && /emogas/.test(x.testo)).length);
  await tocca(v, '[data-a="scheda"][data-s="richieste"]');
  await tocca(v, "button.dfriga");
  await v.locator("#promin").fill("tra 3h emogas");
  await v.locator("#promin").press("Enter");
  await finche(() => sw.evaluate(() => self.__arrivi.length === 1), 10000);
  await reteV({ offline: true });
  relay.taglia("tel");
  await sospendi(5000);   // intanto il PC l'ha scritto, e la sua risposta non trova il telefono
  await reteV();
  const visto = await finche(async () => (await v.locator('.dfr:has-text("emogas")').count()) === 1, 20000);
  const arrivi = await sw.evaluate(() => self.__arrivi);
  check(visto && arrivi.length >= 2 && new Set(arrivi).size === 1 && await emogas() === 1,
    `la presa cade mentre il PC scrive un promemoria: il telefono lo rimanda col suo numero (${arrivi.length} arrivi), sul PC ce n'è uno solo, e il telefono lo mostra`);

  await v.locator('.foglio [data-a="dfchiudi"]').last().click();
  // 5. un PDF tagliato a metà strada riprende da dove era, non da capo
  await tocca(v, '[data-a="scheda"][data-s="esiti"]');
  const idRef = await v.locator('.ref:has-text("TC ENCEFALO")').first().getAttribute("data-id");
  const pdf = Buffer.concat([refertoRxPdf(["RADIOLOGIA - ripresa"]), Buffer.alloc(1200000, 0x43)]);
  await sw.evaluate(([k, data]) => chrome.storage.local.set({ [k]: { ep: "999001", data, ts: Date.now() } }), ["ref:" + idRef, pdf.toString("base64")]);
  await tocca(v, '[data-a="indietro"]'); await aspettaTel(v, /BIANCHI ANNA/);
  await tocca(v, '.paz[data-ep="999001"]');
  await finche(async () => (await v.locator('.refw:has-text("TC ENCEFALO") .pdf').count()) === 1, 20000);
  // (il PC tarda col secondo pezzo: intanto la rete se ne va, e la sua risposta si perde)
  const e1 = relay.entrate().tel;
  const [popup] = await Promise.all([v.waitForEvent("popup", { timeout: 15000 }), tocca(v, '.refw:has-text("TC ENCEFALO") .pdf')]);
  await finche(() => sw.evaluate(() => self.__pezzi.includes(1)), 20000);
  await reteV({ offline: true });
  relay.taglia("tel");
  await sospendi(3000);
  await reteV();
  const arrivato = await finche(() => /^blob:/.test(popup.url()), 60000);
  const pezzi = await sw.evaluate(() => self.__pezzi);
  check(arrivato && relay.entrate().tel > e1 && pezzi.filter((i) => i === 0).length === 1 && pezzi.filter((i) => i === 1).length >= 2 && Math.max(...pezzi) === Math.ceil(pdf.length * 4 / 3 / 520000) - 1,
    `un PDF tagliato a metà strada: ripreso dal pezzo dove era (non da capo), ricomposto e aperto (pezzi chiesti al PC: ${pezzi.join(",")})`);
  await popup.close();
  await sw.evaluate((k) => chrome.storage.local.remove(k), "ref:" + idRef);

  // (un ordine dal telefono: quante volte il PC lo fa — la scheda del gestionale lo porta poi fino in fondo, o dice perché no —
  // e quando il telefono ha la risposta: il bottone non aspetta più)
  const eseguiti = (q) => sw.evaluate((q) => self.__eseguiti.filter((x) => x === q).length, q);
  const risposto = async (p) => !/Mando l'ordine al PC|In coda/.test(await p.locator("#ordina").innerText().catch(() => "")) && !(await p.locator(".coda").count());
  // 6. una rete lenta (1500 ms, 50 kbit/s): elenco, esiti e un ordine arrivano, senza falsi allarmi
  await v.waitForSelector(".avviso", { state: "detached", timeout: 10000 }).catch(() => {});
  await v.evaluate(() => {
    window.__allarmi = [];
    new MutationObserver(() => {
      for (const a of document.querySelectorAll(".avviso.err, .statopc")) if (!window.__allarmi.includes(a.textContent)) window.__allarmi.push(a.textContent);
    }).observe(document.getElementById("app"), { childList: true, subtree: true });
  });
  await reteV({ latency: 1500, downloadThroughput: 50e3 / 8, uploadThroughput: 50e3 / 8 });
  const e2 = relay.entrate().tel, ric0 = Object.keys(B.state.richieste).length;
  const elenchi = async () => ((await registroPc(doc3)).match(/iPhone · elenco dei pazienti/g) || []).length;
  // (un paziente nuovo sul PC: quando il telefono lo mostra, l'elenco è arrivato)
  const gialli = (si) => doc3.evaluate((si) => {
    const K = "psassist:patients.v1";
    const l = JSON.parse(localStorage.getItem(K) || "[]").filter((p) => p.ep !== "999005");
    if (si) l.push({ ep: "999005", name: "GIALLI PIETRO", url: "", ts: Date.now() - 10 * 60e3, pk: "", triage: "VERDE" });
    localStorage.setItem(K, JSON.stringify(l));
  }, si);
  await gialli(true);
  const el0 = await elenchi();
  await tocca(v, '[data-a="indietro"]');
  const elenco = await finche(async () => (await elenchi()) > el0 && /GIALLI/.test(await testoTel(v)), 30000);
  await tocca(v, '.paz[data-ep="999002"]');
  const esitiB = /Rileggi/.test(await aspettaTel(v, /Rileggi/, 40000));
  await tocca(v, '[data-a="scheda"][data-s="richieste"]');
  await aspettaTel(v, /Dol th/, 10000);
  await tocca(v, '[data-a="esame"]:has-text("TROPONINA US")');
  await v.locator("#quesito").fill("rete lenta");
  await tocca(v, "#ordina"); await sospendi(900); await tocca(v, "#ordina");
  const ordinato = await finche(async () => (await eseguiti("rete lenta")) === 1 && await risposto(v), 120000);
  await sospendi(3000);
  // (solo gli allarmi della rete: un no della scheda del gestionale è un'altra storia)
  const allarmi = (await v.evaluate(() => window.__allarmi)).filter((x) => /Non so|in tempo|Ricollego|Senza rete|raggiungibile|PC assente/.test(x));
  check(elenco && esitiB && ordinato && !allarmi.length && relay.entrate().tel === e2 && await eseguiti("rete lenta") === 1 && Object.keys(B.state.richieste).length <= ric0 + 1,
    `rete lenta (1500 ms, 50 kbit/s): l'elenco, gli esiti di BIANCHI e un ordine arrivano, senza un allarme e senza rifare la presa (${allarmi.join(" | ") || "nessun allarme"}; elenco ${elenco}, esiti ${esitiB}, ordine ${ordinato}, prese +${relay.entrate().tel - e2}, richieste +${Object.keys(B.state.richieste).length - ric0})`);
  await reteV();
  await gialli(false);
  await finche(ordiniFiniti, 60000);

  // 7. un ordine toccato senza rete: in coda, col conto alla rovescia; tornata la rete entro 30 secondi, parte, una volta
  const richB = () => Object.keys(B.state.richieste).length;
  const arrivatiPc = (q) => sw.evaluate((q) => self.__ordini.filter((x) => x === q).length, q);
  const ordinaSu = async (p, q) => {
    await tocca(p, '[data-a="esame"]:has-text("TROPONINA US")');
    await p.locator("#quesito").fill(q);
    await tocca(p, "#ordina"); await sospendi(900); await tocca(p, "#ordina");
  };
  const coda = () => v.locator(".coda").first().innerText().catch(() => "");
  await reteV({ offline: true });
  await finche(async () => /Senza rete/.test(await pill()), 15000);
  const usabile = await v.locator("#ordina.nopc").count() === 0;
  const r1 = richB();
  await ordinaSu(v, "in coda");
  const c1 = (await finche(async () => /In coda · 0:\d\d/.test(await coda()), 5000)) ? await coda() : "";
  await sospendi(2500);
  const c2 = await coda();
  const sec = (t) => Number((/0:(\d\d)/.exec(t) || [])[1]);
  await reteV();
  const partito = await finche(async () => (await eseguiti("in coda")) === 1 && await risposto(v), 60000);
  await finche(ordiniFiniti, 60000); await sospendi(2000);
  check(usabile && sec(c1) >= 26 && sec(c2) < sec(c1) && partito && await eseguiti("in coda") === 1 && richB() <= r1 + 1 && await arrivatiPc("in coda") >= 1,
    `senza rete «Conferma e stampa» resta usabile: l'ordine va in coda («${c1.split("\n")[0]}» → «${c2.split("\n")[0]}»), e tornata la rete parte, una volta sola (usabile ${usabile}, partito ${partito}, fatto sul PC ${await eseguiti("in coda")} volte, richieste +${richB() - r1}, arrivi al PC ${await arrivatiPc("in coda")}; ${(await testoTel(v)).replace(/\s+/g, " ").slice(0, 160)})`);

  // 8. senza rete per più di 30 secondi: scade, non parte più — nemmeno quando la rete torna; toccato, si riarma
  await reteV({ offline: true });
  await finche(async () => /Senza rete/.test(await pill()), 15000);
  const r2 = richB();
  await ordinaSu(v, "scade senza rete");
  const scaduta = await finche(async () => /Scaduta: non inviata/.test(await coda()), 40000);
  await reteV();
  await finche(async () => !(await pill()), 10000);
  await sospendi(4000);
  check(scaduta && richB() === r2 && await arrivatiPc("scade senza rete") === 0 && await eseguiti("scade senza rete") === 0,
    "senza rete oltre 30 secondi: «Scaduta: non inviata», e tornata la rete non parte (il PC non lo vede mai)");
  await tocca(v, '.coda[data-a="riarma"]');
  const riarmato = await v.locator("#ordina").innerText();
  check(/Ordino 1 esame · tocca di nuovo\n.*BIANCHI ANNA/.test(riarmato) && !(await v.locator(".coda").count()),
    `toccata la carta scaduta, la scelta torna e il bottone chiede di nuovo conferma (${riarmato})`);
  await tocca(v, '[data-a="esame"]:has-text("TROPONINA US")');   // (non lo conferma: via la scelta)

  // 9. l'orologio del telefono 5 minuti avanti o indietro: l'ordine in coda parte lo stesso, una volta
  const esiti = [];
  for (const x of [-5 * 60e3, 5 * 60e3]) {
    await v.evaluate((x) => sessionStorage.setItem("__salto", String(x)), x);
    await v.reload();
    await aspettaTel(v, /BIANCHI ANNA/, 20000);
    await tocca(v, '.paz[data-ep="999002"]');
    await aspettaTel(v, /Rileggi/, 20000);
    await tocca(v, '[data-a="scheda"][data-s="richieste"]');
    await aspettaTel(v, /Dol th/, 10000);
    await reteV({ offline: true });
    await finche(async () => /Senza rete/.test(await pill()), 15000);
    const r = richB(), q = `orologio ${x > 0 ? "avanti" : "indietro"}`;
    await ordinaSu(v, q);
    await finche(async () => /In coda/.test(await coda()), 5000);
    await sospendi(3000);
    await reteV();
    const ok = await finche(async () => (await eseguiti(q)) === 1 && await risposto(v), 60000);
    await finche(ordiniFiniti, 60000); await sospendi(2000);
    esiti.push(ok && await eseguiti(q) === 1 && richB() <= r + 1);
  }
  check(esiti.length === 2 && esiti.every(Boolean), `con l'orologio del telefono 5 minuti indietro o avanti, l'ordine in coda parte lo stesso, una volta (${esiti.join(", ")})`);
  await v.evaluate(() => sessionStorage.removeItem("__salto"));

  await sw.evaluate(() => { globalThis.ponteSuScheda = self.__vere.scheda; globalThis.ponteComando = self.__vere.comando; globalThis.ponteDaiPdf = self.__vere.pdf; globalThis.ponteOrdina = self.__vere.ordina; });
  await vCtx.close();
  await tocca(tel, '[data-a="riapri"]');
  await aspettaTel(tel, /ROSSI MARIO/, 20000);

  // 10. un ordine partito ma trattenuto per strada oltre i 30 secondi (e l'orologio
  // del telefono 5 minuti avanti): il PC non lo fa, e il telefono lo dice
  await tel.evaluate(() => sessionStorage.setItem("__salto", String(5 * 60e3)));
  await tel.reload();
  await aspettaTel(tel, /BIANCHI ANNA/, 20000);
  await tocca(tel, '.paz[data-ep="999002"]');
  await aspettaTel(tel, /Rileggi/, 20000);
  await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
  await aspettaTel(tel, /Dol th/, 10000);
  const r3 = Object.keys(B.state.richieste).length;
  rete.ritarda = 35000;
  await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
  await tel.locator("#quesito").fill("trattenuto");
  await tocca(tel, "#ordina"); await sospendi(900); await tocca(tel, "#ordina");
  const tardivo = await finche(async () => /Scaduta: non inviata/.test(await tel.locator(".coda").first().innerText().catch(() => "")), 50000);
  rete.ritarda = 0;
  await sospendi(3000);
  check(tardivo && Object.keys(B.state.richieste).length === r3 && /un ordine arrivato tardi: scaduto, non fatto/.test(await registroPonte())
    && !/Non so se l'ordine/.test(await testoTel(tel)),
    "un ordine trattenuto per strada 35 secondi (orologio del telefono 5 minuti avanti): il PC non lo fa, e il telefono dice «Scaduta: non inviata»");
  await tocca(tel, '.coda [data-a="codaVia"]');
  await tel.evaluate(() => sessionStorage.removeItem("__salto"));
  await tel.reload();
  await aspettaTel(tel, /ROSSI MARIO/, 20000);
}

// ===========================================================================
sezione("«Scansiona il QR» dentro l'app");
{
  // un QR in un video finto per la fotocamera di Chromium (y4m, in grigio)
  const qrDi = (() => { const c = vm.createContext({}); vm.runInContext(readFileSync(join(EXT, "qr.js"), "utf8"), c); return c.qrcodegen; })();
  const video = (testo, file) => {
    const q = qrDi.QrCode.encodeText(testo, qrDi.QrCode.Ecc.MEDIUM), W = 640, H = 480, px = 8, lato = (q.size + 8) * px;
    const y = Buffer.alloc(W * H, 235), x0 = (W - lato) / 2 | 0, y0 = (H - lato) / 2 | 0;
    for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.getModule(c, r)) {
      for (let dy = 0; dy < px; dy++) y.fill(16, (y0 + (r + 4) * px + dy) * W + x0 + (c + 4) * px, (y0 + (r + 4) * px + dy) * W + x0 + (c + 5) * px);
    }
    const uv = Buffer.alloc(W * H / 2, 128), fot = Buffer.concat([Buffer.from("FRAME\n"), y, uv]);
    writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), fot, fot]));
    return file;
  };
  // un telefono con la fotocamera finta, senza associazione
  const VID = join("/tmp", `psa-ponte-qr-${process.pid}.y4m`);
  const conCamera = async (testo) => {
    const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video(testo, VID)}`] });
    const c = await b.newContext({ ...IPHONE, permissions: ["camera"] });
    await c.addInitScript((k) => {
      // (la fotocamera, vista da fuori: le sue tracce, e quante volte si spegne)
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__tracce = [];
      navigator.mediaDevices.getUserMedia = async (v) => { const s = await gum(v); window.__tracce.push(...s.getTracks()); return s; };
      const stop = MediaStreamTrack.prototype.stop;
      MediaStreamTrack.prototype.stop = function () { sessionStorage.setItem("__spenta", String(Number(sessionStorage.getItem("__spenta") || 0) + 1)); return stop.call(this); };
    }, P.b64u(P.casuale(32)));
    const p = await c.newPage();
    await p.goto(relay.url + "/ponte/");
    return { b, p };
  };
  // il file del decodificatore: servito, con la fotocamera permessa solo a questo sito
  const fileQr = await fetch(relay.url + "/ponte/jsqr.min.js");
  check(fileQr.status === 200 && /jsQR 1\.4\.0/.test(await fileQr.text()) && fileQr.headers.get("permissions-policy") === "camera=(self), microphone=(), geolocation=()",
    "il decodificatore (jsQR 1.4.0) è un file dell'app; la fotocamera è permessa a lei sola, microfono e posizione a nessuno");

  // 1. la fotocamera che non c'è: una riga, e la strada di prima
  const nudoCtx = await telBrowser.newContext(IPHONE);
  const nudo = await nudoCtx.newPage();
  await nudo.goto(relay.url + "/ponte/");
  await aspettaTel(nudo, /Scansiona il QR/, 10000);
  check(await nudo.locator("#app .grande").count() === 1 && await nudo.locator('.grande[data-a="scansiona"]').count() === 1, "senza associazione: un bottone solo, «Scansiona il QR»");
  await tocca(nudo, '[data-a="scansiona"]');
  check(/Fotocamera non disponibile: inquadra il QR con la Fotocamera dell'iPhone/.test(await aspettaTel(nudo, /Fotocamera non disponibile/, 10000)) && await nudo.locator(".scan").count() === 0,
    "senza fotocamera: «Fotocamera non disponibile: inquadra il QR con la Fotocamera dell'iPhone»");
  await shot(nudo, "tel-qr-1-senza-fotocamera");
  await nudoCtx.close();

  // il PC fa un QR nuovo
  const pqr = await ctx.newPage();
  await pqr.goto(EXTURL("ponte.html"));
  await pqr.waitForSelector("#stato b");
  await nuovoQr(pqr);   // (un telefono è già entrato: «Nuovo QR», due tocchi)
  const url4 = await qrUrl();
  const K4 = P.b64u(P.leggiFrammento(new URL(url4).hash).k);

  // 2. il QR di un altro sito (con una chiave e tutto): si ignora; ✕ spegne la fotocamera
  const fuori = await conCamera(url4.replace(relay.url, "https://altro.example.org"));
  check(/Scansiona il QR/.test(await aspettaTel(fuori.p, /Scansiona il QR/, 10000)) && await fuori.p.locator('.grande[data-a="scansiona"]').count() === 1,
    "un telefono senza associazione: «Scansiona il QR»");
  await shot(fuori.p, "tel-qr-2-scaduta");
  await tocca(fuori.p, '[data-a="scansiona"]');
  const vivo = await finche(() => fuori.p.evaluate(() => { const v = document.querySelector(".scan video"); return !!v && v.readyState >= 2 && !v.paused; }), 10000);
  await sospendi(2500);
  check(vivo && await fuori.p.locator(".scan .guida").count() === 1 && await fuori.p.evaluate(() => localStorage.length) === 0 && /Scansiona il QR/.test(await testoTel(fuori.p)),
    "la fotocamera nella pagina, col quadrato: un QR di un altro sito si ignora (nessuna chiave, si resta lì)");
  await shot(fuori.p, "tel-qr-3-fotocamera");
  await tocca(fuori.p, ".scan .x");
  check(await fuori.p.locator(".scan").count() === 0 && await fuori.p.evaluate(() => window.__tracce.length > 0 && window.__tracce.every((t) => t.readyState === "ended")),
    "✕: la vista si chiude e la fotocamera si spegne");
  await fuori.b.close();

  // 3. il QR nuovo del PC, inquadrato dentro l'app: l'elenco
  const dentro = await conCamera(url4);
  await aspettaTel(dentro.p, /Scansiona il QR/, 10000);
  await tocca(dentro.p, '[data-a="scansiona"]');
  const elenco = await aspettaTel(dentro.p, /ROSSI MARIO/, 25000);
  check(/ROSSI MARIO/.test(elenco) && (await chiaveTel(dentro.p))?.k === K4 && !(await dentro.p.evaluate(() => location.hash)),
    "inquadrato dentro l'app il QR nuovo del PC: la chiave nuova, e l'elenco (il frammento non resta nell'indirizzo)");
  check(Number(await dentro.p.evaluate(() => sessionStorage.getItem("__spenta"))) >= 1, "letto il codice, la fotocamera si spegne");
  await shot(dentro.p, "tel-qr-4-elenco");
  // 4. associato: nel ⋯ «📷 Scansiona il QR», sempre — un lettore solo per un PC, un PC di sola lettura, una stazione
  await tocca(dentro.p, '[data-a="menu"]');
  check(await dentro.p.locator('.menu [data-a="scansiona"]').innerText() === "📷 Scansiona il QR" && !/Collega stampante/.test(await dentro.p.locator(".menu").innerText()),
    "associato, nel ⋯: «📷 Scansiona il QR» (non più «Collega stampante»)");
  await shot(dentro.p, "tel-qr-5-menu");
  await tocca(dentro.p, '.menu [data-a="scansiona"]');
  check(await finche(() => dentro.p.evaluate(() => !!document.querySelector(".scan video")), 10000), "…apre la stessa fotocamera");
  // (letto il QR la pagina riparte: prima la vista della fotocamera se ne va, poi l'elenco di nuovo)
  const riletto = await finche(async () => await dentro.p.locator(".scan").count() === 0 && /ROSSI MARIO/.test(await testoTel(dentro.p)), 30000);
  check(riletto && (await chiaveTel(dentro.p))?.k === K4,
    `e lo stesso QR del PC, inquadrato di nuovo: lo stesso PC, la stessa chiave, l'elenco (${(await testoTel(dentro.p)).replace(/\s+/g, " ").slice(0, 80)})`);
  await dentro.b.close();
  await pqr.close();
  rmSync(VID, { force: true });
}

// ===========================================================================
sezione("il ripetitore non vede niente in chiaro");
// (solo parole di almeno 5 lettere: due o tre byte uguali per caso, in tanti byte cifrati, ci sono sempre)
const segreti = ["ROSSI", "BIANCHI", "MARIO", "VERDI", "TROPONINA", "EMOCROMO", CF_A, CF_B, "999001", "999002", "tropo", "dolore", "allergico", "ENCEFALO", "pazienti", "focolai", "ZQXW7731", "KAPPAZETA", "NUOVAZETA", "OMEGAFARM", "BETALLERG", "SIGMAREMOTA", "TAUOBIETT", "sudorazione", "Penicillina"];
const tutti = Buffer.concat(inoltrati);
check(inoltrati.length > 30, `(${inoltrati.length} messaggi inoltrati)`);
check(inoltrati.every((b) => b[0] === 1 && b[1] >= 1 && b[1] <= 4), "ognuno è un messaggio cifrato del ponte (versione 1, tipo 1–4)");
const visti = segreti.filter((s) => tutti.includes(Buffer.from(s, "latin1")) || tutti.includes(Buffer.from(s, "utf8")) || tutti.includes(Buffer.from(s, "utf16le")));
check(!visti.length, `nessun nome, esame, codice fiscale, episodio o testo in nessun messaggio (trovati: ${visti.join(", ") || "nessuno"})`);

// ===========================================================================
sezione("la prova della rete");
const prova = await ctx.newPage();
const altriHost = [];
prova.on("request", (r) => { const u = new URL(r.url()); if (u.protocol !== "chrome-extension:" && u.origin !== relay.url) altriHost.push(r.url()); });
prova.on("websocket", (w) => { if (!w.url().startsWith(relay.url.replace(/^http/, "ws") + "/ponte/ws?")) altriHost.push(w.url()); });
await prova.addInitScript(() => { navigator.clipboard.writeText = async (t) => { window.__copiato = t; }; });
await prova.goto(EXTURL("ponte-prova.html?durata=4"));
await prova.waitForFunction(() => !document.getElementById("copia").disabled, null, { timeout: 60000 });
const righe = () => prova.locator("li").evaluateAll((l) => l.map((x) => [x.className, x.innerText.replace(/\s+/g, " ")]));
const riga = async (re) => (await righe()).find(([, t]) => re.test(t)) || ["", ""];
check((await riga(/Collegamento al ponte/))[0] === "ok", `la presa vera del ponte, in una stanza di prova: verde (${(await riga(/Collegamento al ponte/))[1]})`);
check((await riga(/Andata e ritorno/))[0] === "ok" && /5 messaggi su 5 · in media \d+ ms/.test((await riga(/Andata e ritorno/))[1]), `andata e ritorno, coi tempi: verde (${(await riga(/Andata e ritorno/))[1]})`);
check(/Il ponte si può usare da questo PC/.test(await prova.locator("#esito").innerText()), "in cima, il verdetto in una riga");
await prova.locator("#lunga").click();
await prova.waitForFunction(() => !document.getElementById("lunga").disabled, null, { timeout: 30000 });
check((await riga(/Tenuta/))[0] === "ok" && /Rimasta aperta 4 s/.test((await riga(/Tenuta/))[1]), `«Tieni aperto»: rimasta aperta col battito (${(await riga(/Tenuta/))[1]})`);
await prova.locator("#lunga").click();
await sospendi(1500);
relay.taglia("tel");
await prova.waitForFunction(() => !document.getElementById("ancora").disabled, null, { timeout: 30000 });
const caduta = (await righe()).filter(([, t]) => /Tenuta/.test(t)).at(-1) || ["", ""];
check(caduta[0] === "ko" && /Caduta dopo \d+ s \(alle \d\d:\d\d, presa del telefono\): codice 1006/.test(caduta[1]), `e se cade, quando e perché (${caduta[1]})`);
await prova.locator("#copia").click();
check(await finche(async () => /copiato/.test(await prova.locator("#copiato").innerText()), 3000), "«Copia il risultato» risponde");
const copiato = await prova.evaluate(() => window.__copiato || "");
check(/Per l'IT/.test(copiato) && /\/ponte\/ws/.test(copiato) && /TCP 443/.test(copiato) && /20 secondi/.test(copiato) && /ispezione TLS/.test(copiato) && /proxy/.test(copiato),
  "nel testo copiato, il blocco «Per l'IT»: la presa, TCP 443, attraverso il proxy, il battito, niente ispezione TLS");
check(!altriHost.length, `nessun altro sito, nessun UDP: solo la presa del ponte (${altriHost.join(", ") || "niente altro"})`);
await shot(prova, "pc-4-prova-rete");
await prova.close();

await telBrowser.close();
await ctx.close();
await relay.chiudi();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fail ? `\nPONTE: ${fail} CHECK FALLITI\n` : "\nPONTE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
