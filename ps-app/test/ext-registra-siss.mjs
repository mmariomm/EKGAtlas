#!/usr/bin/env node
/*
 * Il registratore sul SISS, con l'estensione VERA: ⋯ → Registra sul gestionale,
 * poi una pagina d'accesso, il menu operatore e il Prescrittivo Regionale —
 * un'app finta a viste (pushState), con un dialogo come quelli di Angular
 * Material (cdk-overlay-container), un modulo (con un PIN che non si deve
 * leggere mai), «Registra» e «Stampa RE», che passa da un rinvio a un PDF in
 * una scheda nuova. Ferma e scarica dalla pill «● Registrando…» (la stessa pill
 * del pannello, nello stesso posto), si apre lo zip e si guarda.
 * Tutto inventato; i nomi del SISS li risolve Chromium su un piccolo server
 * HTTPS qui (--host-resolver-rules), il gestionale è il simulatore di sempre.
 *   node test/ext-registra-siss.mjs
 */
import { chromium } from "playwright";
import { createMock, refertoRxPdf } from "./sa4pso-mock.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import https from "node:https";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-regsiss-" + process.pid);
const OUT = join("/tmp", "psa-regsiss-zip-" + process.pid);
mkdirSync(OUT, { recursive: true });
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sospendi = (ms) => new Promise((res) => setTimeout(res, ms));
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(200)) if (await fn()) return true;
  return false;
}

// ------------------------------------------------------ i dati (inventati)
const PZ = { cog: "FERRARIS", nom: "ADELMO", cf: "FRRDLM51C03F205T", nato: "03/03/1951", tessera: "778QW215", mpi: "55120934" };
const OP = { nome: "Ilaria Berti", maiusc: "ILARIA BERTI" };
const NRE = "0301A7000123456", AUT = "K4P9Z1", PIN = "8642", PAI = "PAI00731";
const MENU = "dcss.cgi.crs.lombardia.it", PR = "operatorisiss.servizirl.it";

// ------------------------------------------------------ il SISS finto
const pdfStampa = refertoRxPdf([
  "SERVIZIO SANITARIO NAZIONALE", "REGIONE LOMBARDIA", "PROMEMORIA PER L'ASSISTITO", `NRE ${NRE}`,
  `COGNOME E NOME / INIZIALI DELL'ASSISTITO: ${PZ.cog} ${PZ.nom}`, `CODICE FISCALE: ${PZ.cf}`,
  "052594013 AUGMENTIN*OS 12BUST875MG+125MG", `CODICE AUTENTICAZIONE: ${AUT}`, `COGNOME E NOME DEL MEDICO: ${OP.maiusc}`,
]);
const login = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Accesso SISS</title></head><body>
  <h1>Benvenuto nel SISS</h1><p>Inserisci la carta operatore e il PIN</p>
  <form><input type="password" id="pinCarta" name="pinCarta"><button type="button">Accedi</button></form></body></html>`;
const menu = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Menu SISS</title></head><body>
  <a role="button" title="Esci dal SISS" aria-label="Esci dal SISS">Esci dal SISS</a>
  <div>Servizi Socio Sanitari Operatore</div><div>Operatore: ${OP.maiusc} Ruolo: MEDICO</div>
  <a class="nav-link active" href="#/menusiss">Menu</a>
  <a class="list-item" id="prreg" href="https://${PR}/prescrittivoRegionale/pages/prescription/patient-identify">Prescrittivo Regionale (PRREG) Produzione</a>
  <a class="list-item" href="#/menusiss">Fascicolo Sanitario Elettronico</a></body></html>`;
// L'app a viste: identificazione → (pushState) compilazione → dialogo
// Anteprima → Registra → dialogo con «Stampa RE». Tutto disegnato nella pagina.
const spa = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prescrittivo Regionale</title>
<style>.cdk-overlay-container{position:fixed;inset:0;pointer-events:none}.cdk-overlay-pane{pointer-events:auto;background:#fff;position:absolute;top:120px;left:40px;padding:12px;border:1px solid #888}</style></head>
<body><app-root>
  <header><a href="/prescrittivoRegionale/pages/dashboard" type="button">Home</a> <a href="/prescrittivoRegionale/pages/prescription/patient-identify">Nuova Prescrizione</a>
  <div>Sede di lavoro: Prescrittivo Regionale</div><span class="op">${OP.nome}</span> <span class="ruolo">Medico</span></header>
  <main id="vista"></main>
  <iframe id="riq" src="/prescrittivoRegionale/riquadro.html" style="width:300px;height:60px;border:0"></iframe>
</app-root>
<script>
const P = "/prescrittivoRegionale/pages/prescription/";
let paz = null;
const vista = document.getElementById("vista");
function overlay(html) {
  let c = document.querySelector(".cdk-overlay-container");
  if (!c) { c = document.createElement("div"); c.className = "cdk-overlay-container"; document.body.appendChild(c); }
  c.innerHTML = '<div class="cdk-global-overlay-wrapper"><div class="cdk-overlay-pane"><mat-dialog-container class="mat-dialog-container">' + html + '</mat-dialog-container></div></div>';
}
const chiudi = () => { const c = document.querySelector(".cdk-overlay-container"); if (c) c.innerHTML = ""; };
function identifica() {
  vista.innerHTML = '<form><mat-form-field class="mat-form-field"><input formcontrolname="idCard" id="idCard" name="idCard" placeholder="ID Personale (CF/STP/TEAM/Altro)" type="text"></mat-form-field>'
    + '<input formcontrolname="patientLastName" id="patientLastName" name="patientLastName" placeholder="Cognome" type="text">'
    + '<input formcontrolname="patientFirstName" id="patientFirstName" name="patientFirstName" placeholder="Nome" type="text">'
    + '<input formcontrolname="birthDate" id="birthDate" name="birthDate" placeholder="Data nascita">'
    + '<input formcontrolname="idSsn" id="idSsn" name="idSsn" placeholder="Tessera" type="text">'
    + '<mat-form-field class="mat-form-field"><label>PIN della carta operatore</label><input type="password" id="pinCarta" name="pinCarta"></mat-form-field>'
    + '<input formcontrolname="otp" id="otp" placeholder="Codice OTP" type="text">'
    + '<div>Ricerca su AR/ANA</div><button type="button" id="cerca">Cerca</button></form>';
  document.getElementById("cerca").onclick = async () => {
    const r = await fetch("/prescrittivoRegionale/api/patients?idCard=" + encodeURIComponent(document.getElementById("idCard").value));
    paz = await r.json();
    history.pushState({}, "", P + "editing");
    editing();
  };
}
function banner() {
  return '<mat-expansion-panel-header class="mat-expansion-panel-header" role="button"><span>Cognome: ' + paz.cog + ' Nome: ' + paz.nom + ' Sesso: M Data di nascita: ' + paz.nato + '</span>'
    + '<span>Id personale: ' + paz.cf + ' Tessera: ' + paz.tessera + ' Id MPI: ' + paz.mpi + ' Nazione TEAM: </span></mat-expansion-panel-header>';
}
function editing() {
  vista.innerHTML = banner() + '<div role="tab">Prescrizione medica</div><div role="tab">Storico paziente</div>'
    + '<input formcontrolname="paiCounter" name="paiCounter" placeholder="Contatore PAI" type="text" id="mat-input-6">'
    + '<input formcontrolname="diagnosticQuestionText" name="diagnosticQuestionText" placeholder="Quesito diagnostico testuale" type="text" id="mat-input-9">'
    + '<input aria-label="lista esenzioni" formcontrolname="exemption" type="text" role="combobox" id="mat-input-8" placeholder="Esenzioni">'
    + '<input class="mat-checkbox-input" type="checkbox" id="mat-checkbox-5-input"> <span>Visita in Urgenza</span>'
    + '<table><tr><th>Codice farmaco</th><th>Descrizione farmaco</th></tr><tr><td>052594013</td><td>AUGMENTIN*OS 12BUST875MG+125MG</td></tr></table>'
    + '<div>Programmabile - Da eseguire entro 120gg</div>'
    + '<button type="button" id="anteprima">Anteprima</button> <button type="button" id="salva">Salva</button> <button type="button" id="registra">Registra</button>';
  document.getElementById("anteprima").onclick = () => {
    overlay('<h2 class="mat-dialog-title">Anteprima</h2><span>Cognome:</span><span>' + paz.cog + '</span><span>Nome:</span><span>' + paz.nom + '</span>'
      + '<div>052594013 AUGMENTIN*OS 12BUST875MG+125MG</div><button type="button" id="chiudi">Chiudi</button>');
    document.getElementById("chiudi").onclick = chiudi;
  };
  document.getElementById("registra").onclick = async () => {
    const r = await fetch("/prescrittivoRegionale/api/prescriptions", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cf: paz.cf, pai: document.getElementById("mat-input-6").value }) });
    const x = await r.json();
    overlay('<h2>Ricetta registrata</h2><div>NRE: ' + x.nre + '</div><div>Codice di autenticazione: ' + x.aut + '</div>'
      + '<a id="stampa" class="mat-raised-button" target="_blank" href="/prescrittivoRegionale/api/prescriptions/' + x.nre + '/print">Stampa RE</a>');
  };
}
if (/editing$/.test(location.pathname)) editing(); else identifica();
</script></body></html>`;
const CERT = join(OUT, "cert");
mkdirSync(CERT, { recursive: true });
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${PR}`, "-addext", `subjectAltName=DNS:${PR},DNS:${MENU}`, "-days", "1",
  "-keyout", join(CERT, "k.pem"), "-out", join(CERT, "c.pem")], { stdio: "ignore" });
const alServer = [];
const srv = https.createServer({ key: readFileSync(join(CERT, "k.pem")), cert: readFileSync(join(CERT, "c.pem")) }, (req, res) => {
  const host = String(req.headers.host || "").split(":")[0], u = req.url;
  alServer.push(`${req.method} ${host}${u}`);
  const html = (b) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(b); };
  const json = (o, st = 200) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (host === MENU && /^\/idp\/login/.test(u)) return html(login);
  if (host === MENU && /^\/menusiss\//.test(u)) return html(menu);
  if (host === PR && /^\/prescrittivoRegionale\/riquadro\.html/.test(u)) return html("<!DOCTYPE html><html><body><p>Avvisi: nessuno</p></body></html>");
  if (host === PR && /^\/prescrittivoRegionale\/pages\//.test(u)) return html(spa);
  if (host === PR && /^\/prescrittivoRegionale\/api\/patients/.test(u)) return json(PZ);
  if (host === PR && req.method === "POST" && /^\/prescrittivoRegionale\/api\/prescriptions$/.test(u)) { req.resume(); return json({ nre: NRE, aut: AUT }, 201); }
  if (host === PR && /\/api\/prescriptions\/\w+\/print$/.test(u)) { res.writeHead(302, { location: `/prescrittivoRegionale/stampe/${NRE}.pdf` }); return res.end(); }
  if (host === PR && /\/stampe\/\w+\.pdf$/.test(u)) { res.writeHead(200, { "content-type": "application/pdf", "cache-control": "private, max-age=300" }); return res.end(pdfStampa); }
  res.writeHead(404); res.end();
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const porta = srv.address().port;

const A = createMock({});
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  acceptDownloads: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean),
    `--host-resolver-rules=MAP ${MENU} 127.0.0.1:${porta}, MAP ${PR} 127.0.0.1:${porta}`, "--ignore-certificate-errors", "--no-proxy-server"],
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  let out = A.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = A.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa */ }
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const stato = () => sw.evaluate(() => chrome.storage.local.get("registra").then((o) => o.registra || null));
const $panel = (p, sel) => p.locator(`#psassist-host ${sel}`);
const $pill = (p, sel = "") => p.locator(`#psassist-reg-host ${sel}`.trim());
const grezzo = () => sw.evaluate(() => regTutto().then((l) => l.filter((x) => x.tipo === "pagina").map((x) => ({ url: x.url, html: x.html, motivo: x.motivo, forma: !!x.forma, alto: x.alto }))));
const stile = (loc) => loc.evaluate((el) => {
  const c = getComputedStyle(el), b = el.getBoundingClientRect();
  return { top: Math.round(b.top), right: Math.round(innerWidth - b.right), h: Math.round(b.height), bg: c.backgroundColor, radius: c.borderRadius, font: c.fontFamily,
    size: c.fontSize, weight: c.fontWeight, pad: c.padding, shadow: c.boxShadow, color: c.color, pos: getComputedStyle(el.parentElement).position };
});

const doc = await ctx.newPage();
// ---- 1. ⋯ → Registra sul gestionale: lì c'è il pannello, quindi niente pill in più
await doc.goto(A.worklistUrl);
await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
if (!(await $panel(doc, ".card").count())) { await $panel(doc, "#expand").click(); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
await $panel(doc, "#menubtn").click();
await $panel(doc, "#regmenu").click();
check(await finche(async () => (await stato())?.stato === "rec", 8000), "la registrazione parte dal pannello del gestionale");
await $panel(doc, "#collapse").click();
await doc.waitForTimeout(2500);
check(await $panel(doc, "#expand .recchip").count() === 1 && await $pill(doc).count() === 0, "sul gestionale: il «● REC» sulla pill del pannello, nessuna seconda pill");
const pillGest = await stile($panel(doc, "#expand"));

// ---- 2. una pagina d'accesso del SISS, poi il menu operatore ----------------
await doc.goto(`https://${MENU}/idp/login`);
await doc.locator("#pinCarta").fill(PIN);
await doc.waitForTimeout(1500);
await doc.goto(`https://${MENU}/menusiss/#/menusiss`);
await doc.waitForTimeout(2200);
check(await doc.locator("#psassist-host").count() === 0, "sul SISS il pannello di PS Assist non c'è");
check(await $pill(doc, "#expand").count() === 1 && /● ?Registrando…|Registrando…/.test(await $pill(doc, "#expand").innerText().catch(() => "")), "c'è la pill «● Registrando…»");
const pillSiss = await stile($pill(doc, "#expand"));
const uguali = ["top", "right", "bg", "radius", "font", "size", "weight", "pad", "shadow", "color", "pos"].every((k) => pillSiss[k] === pillGest[k]) && Math.abs(pillSiss.h - pillGest.h) <= 1;
check(uguali, `è la stessa pill del pannello ridotto, nello stesso posto (gestionale ${JSON.stringify(pillGest)} · SISS ${JSON.stringify(pillSiss)})`);

// ---- 3. il Prescrittivo Regionale: identificazione, compilazione, dialoghi ----
await doc.locator("#prreg").click();
await doc.waitForURL(/patient-identify/, { timeout: 15000 });
await doc.waitForTimeout(1500);
check(await doc.locator("#psassist-host").count() === 0 && await $pill(doc, "#expand").count() === 1, "nel Prescrittivo Regionale: niente pannello, la pill sì");
const riq = doc.frames().find((f) => /riquadro\.html/.test(f.url()));
check(riq && await riq.locator("#psassist-reg-host").count() === 0 && await riq.locator("#psassist-host").count() === 0, "nel riquadro (iframe) nessuna pill");
await doc.fill("#idCard", PZ.cf);
await doc.fill("#patientLastName", PZ.cog);
await doc.fill("#patientFirstName", PZ.nom);
await doc.fill("#birthDate", PZ.nato);
await doc.fill("#idSsn", PZ.tessera);
await doc.fill("#pinCarta", PIN);
await doc.fill("#otp", "551177");
await doc.waitForTimeout(1500);   // la quiete: l'istantanea con i campi compilati
await doc.click("#cerca");
await doc.waitForURL(/editing$/, { timeout: 10000 });
await doc.waitForTimeout(1500);
await doc.fill("#mat-input-6", PAI);
await doc.fill("#mat-input-9", `dolore toracico da due giorni, il sig. ${PZ.cog} riferisce febbre`);
await doc.fill("#mat-input-8", "048");
await doc.check("#mat-checkbox-5-input");
await doc.waitForTimeout(1500);
await doc.click("#anteprima");
await doc.waitForTimeout(1200);
await doc.click("#chiudi");
await doc.waitForTimeout(1200);
await doc.click("#registra");
await doc.waitForSelector("#stampa", { timeout: 8000 });
await doc.waitForTimeout(1200);
const [pdfTab] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), doc.click("#stampa")]);
await pdfTab.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
check(/\/stampe\/\w+\.pdf$/.test(pdfTab.url()), `«Stampa RE» apre il PDF in una scheda nuova, dopo il rinvio (${pdfTab.url().replace(NRE, "<NRE>")})`);
await finche(() => sw.evaluate(() => regConta().then((c) => c.pdf.some((u) => /stampe/.test(u)))), 15000);

// ---- 4. il grezzo, prima di uscire dal PC: mai il PIN, l'accesso solo nella forma
const g = await grezzo();
const gSiss = g.filter((x) => /servizirl|lombardia/.test(x.url));
const gLogin = gSiss.find((x) => /idp\/login/.test(x.url));
check(gSiss.length >= 6 && !g.some((x) => x.html.includes(PIN)) && !g.some((x) => x.html.includes("551177")), `nel grezzo (${gSiss.length} istantanee del SISS) il PIN e l'OTP non ci sono mai, neanche lì`);
check(gLogin && gLogin.forma && !/Benvenuto|Inserisci la carta/.test(gLogin.html) && /<form>/.test(gLogin.html), "la pagina d'accesso: solo la forma, senza testo");
check(gSiss.some((x) => x.html.includes(`value="${PZ.cog}"`)) && gSiss.some((x) => /id="mat-checkbox-5-input" checked/.test(x.html)), "i valori dei campi e le caselle spuntate sono nelle istantanee");
const motivi = new Set(gSiss.map((x) => x.motivo));
check(["caricata", "rotta", "overlay", "quiete"].every((m) => motivi.has(m)), `istantanee al caricamento, al cambio di vista, al dialogo, dopo la quiete (${[...motivi].join(", ")})`);
check(gSiss.every((x) => !/psassist-host|psassist-reg-host/.test(x.html)), "nelle istantanee né pannello né pill");
check(gSiss.filter((x) => !x.alto).length >= 1, "anche il riquadro è registrato");

// ---- 5. «Ferma e scarica» dalla pill -------------------------------------------
await doc.bringToFront();
await $pill(doc, "#expand").click();
check(/Ferma e scarica/.test(await $pill(doc, ".menu").innerText().catch(() => "")), "un clic sulla pill offre «Ferma e scarica»");
const [pagina] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), $pill(doc, "#regferma").click()]);
const download = await pagina.waitForEvent("download", { timeout: 60000 }).catch(() => null);
check(!!download, "«Ferma e scarica» apre la pagina della registrazione e scarica lo zip");
const zip = join(OUT, "r.zip");
if (download) await download.saveAs(zip);
if (download && process.env.REG_ZIP) await download.saveAs(process.env.REG_ZIP);
const esito = await pagina.evaluate(() => window.__registra || null).catch(() => null);
check(esito && esito.ok && esito.controllo, `lo zip è uscito e il controllo è passato (${esito && JSON.stringify(esito.dove || {}).slice(0, 400)})`);
await doc.bringToFront();
check(await finche(async () => (await $pill(doc).count()) === 0, 5000), "fermata la registrazione, la pill sparisce");

// ---- 6. dentro lo zip ----------------------------------------------------------
const dir = join(OUT, "dentro");
mkdirSync(dir, { recursive: true });
try { execFileSync("unzip", ["-q", "-o", zip, "-d", dir]); } catch (e) { check(false, "lo zip si apre: " + e.message); }
const leggi = (f) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return ""; } };
const pagine = existsSync(join(dir, "pagine")) ? readdirSync(join(dir, "pagine")) : [];
const di = (v) => pagine.filter((f) => f.endsWith(`-${v}.html`));
check(["siss-accesso", "siss-menu", "siss-patient-identify", "siss-editing", "siss-anteprima", "siss-registrata"].every((v) => di(v).length >= 1),
  `un'istantanea per vista (${pagine.filter((f) => /siss/.test(f)).join(", ")})`);
check(pagine.some((f) => /PsoLista/.test(f)), "e la lista del gestionale, come sempre");
const ident = di("siss-patient-identify").map((f) => leggi("pagine/" + f)).find((h) => /name="patientLastName"[^>]*value="/.test(h)) || "";
const fCog = (/name="patientLastName"[^>]*value="([^"]*)"/.exec(ident) || [])[1];
check(fCog && fCog !== PZ.cog && /^[A-Z]+$/.test(fCog) && /name="idCard"[^>]*value="ESMPIO80A01Z\d{3}X"/.test(ident), `i campi compilati ci sono, anonimizzati (Cognome «${fCog}», CF finto)`);
check(/name="pinCarta" value=""|id="pinCarta" name="pinCarta"(?![^>]*value="[^"])/.test(ident) && /data-psa-escluso="credenziale"/.test(ident), "il campo del PIN c'è, vuoto e segnato come escluso");
const edit = di("siss-editing").map((f) => leggi("pagine/" + f)).join("\n");
check(new RegExp(`Cognome: ${fCog} Nome: [A-Z]+ Sesso: M Data di nascita: \\d{2}/\\d{2}/1951`).test(edit) && edit.includes("AUGMENTIN*OS 12BUST875MG+125MG") && edit.includes(">052594013<"),
  "il banner del paziente con lo stesso nome finto; il farmaco resta");
const flusso = JSON.parse(leggi("flusso.json") || "{}");
const rq = flusso.richieste || [];
const st = rq.find((x) => /\/print$/.test(x.url));
check(st && st.siss && st.url.startsWith("https://prescrittivo.esempio/") && st.rinvii.length === 1 && st.rinvii[0].stato === 302 && /\/stampe\/\w+\.pdf$/.test(st.rinvii[0].a) && st.contenuto === "application/pdf",
  `«Stampa RE» nel flusso: indirizzo finto, il rinvio, il PDF (${st && st.url} → ${st && st.rinvii.map((x) => x.a).join(" → ")})`);
check(rq.some((x) => x.siss && x.metodo === "POST" && /api\/prescriptions$/.test(x.url) && x.tipo === "xmlhttprequest") && rq.some((x) => x.siss && /api\/patients/.test(x.url)), "le chiamate fetch alle API del SISS ci sono, con metodo e indirizzo finto");
const pdfs = existsSync(join(dir, "pdf")) ? readdirSync(join(dir, "pdf")).map((f) => JSON.parse(leggi("pdf/" + f))) : [];
const prom = pdfs.find((x) => /prescrittivo\.esempio/.test(x.url));
check(prom && prom.righe.includes("PROMEMORIA PER L'ASSISTITO") && prom.righe.some((x) => /^COGNOME E NOME DEL MEDICO: OPERATORE \d+$/.test(x)) && prom.pagine === 1,
  `il promemoria: testo anonimizzato, pagine (${prom && prom.righe.slice(2, 5).join(" | ")})`);
const tutto = readdirSync(dir, { recursive: true }).filter((f) => statSync(join(dir, String(f))).isFile()).map((f) => leggi(String(f))).join("\n");
for (const [cosa, v] of [["il cognome", PZ.cog], ["il nome", PZ.nom], ["il codice fiscale", PZ.cf], ["la data di nascita", PZ.nato], ["la tessera", PZ.tessera],
  ["l'Id MPI", PZ.mpi], ["l'NRE", NRE], ["il codice di autenticazione", AUT], ["il contatore PAI", PAI], ["l'operatore", "Berti"], ["l'operatore (nome)", "Ilaria"],
  ["il PIN", PIN], ["l'OTP", "551177"], ["il quesito scritto", "due giorni"], ["l'host del SISS", "servizirl"], ["l'host del menu", "lombardia.it"], ["l'ospedale", "multimedica"]]) {
  check(!tutto.toUpperCase().includes(v.toUpperCase()), `nello zip non c'è ${cosa}`);
}
const riep = leggi("riepilogo.txt");
const sez = (riep.split("SISS (menu operatore e Prescrittivo Regionale):")[1] || "").split("\n\n")[0];
check(/Viste: .*siss-registrata/.test(sez) && /PDF «Stampa RE»: sì/.test(sez) && /Richieste al SISS: \d+/.test(sez) && /Credenziali \(password, PIN, OTP\): mai registrate/.test(sez),
  "riepilogo.txt: la sezione SISS");
console.log("\n----- riepilogo.txt -----\n" + riep + "-------------------------");

await ctx.close();
srv.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nREGISTRA SISS: TUTTO OK");
process.exit(fail ? 1 : 0);
