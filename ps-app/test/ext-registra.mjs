#!/usr/bin/env node
/*
 * Il registratore con l'estensione VERA: ⋯ → Registra sulla lista del PS, la
 * scheda di un paziente e quella di un altro, un ordine confermato con le
 * etichette, un referto che passa da due rinvii a un PDF in una finestra nuova;
 * ⋯ → Ferma e scarica. Si apre lo zip e si guarda: le pagine, il flusso con i
 * rinvii e i tempi, il testo del PDF anonimizzato — e da nessuna parte un nome,
 * un codice fiscale o un episodio del simulatore.
 *   node test/ext-registra.mjs
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
const PROFILE = join("/tmp", "psa-reg-" + process.pid);
const OUT = join("/tmp", "psa-reg-zip-" + process.pid);
mkdirSync(OUT, { recursive: true });

function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`);
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

// Due pazienti, due simulatori (come in ext-ordine.mjs)
const A = createMock({});
const B = createMock({ name: "BIANCHI ANNA", episodeId: "999002" });
B.state.nextRichiestaId = 800001;
const quale = (url) => {
  const p = new URL(url).searchParams;
  return p.get("EPISODIO_ID") === "999002" || Number(p.get("RICHIESTA_ID")) >= 800000 ? B : A;
};
// Quello che il simulatore NON ha e il gestionale vero sì: codice fiscale e
// data di nascita nell'intestazione, un medico, un telefono. Tutto inventato.
const CF_A = "RSSMRA47L05F205K", NATO_A = "05/07/1947", TEL_A = "347 5550123";
const intestazione = (u, html) => (/MVPG=PsoEpisodioClinicoAmbulatorio/.test(u) && /EPISODIO_ID=999001/.test(u)
  ? html.replace("<body>", `<body><table><tr><td class="AFCDataTD">ROSSI MARIO</td><td>${CF_A}</td><td>nato il ${NATO_A}</td><td>Tel. ${TEL_A}</td><td>Medico: Dott. ESPOSITO GENNARO</td></tr></table>`)
  : html);

// Il referto di radiologia, com'è al lavoro: il link apre una finestra nuova,
// il gestionale rinvia due volte, l'ultimo indirizzo è un PDF. I rinvii VERI
// (un 302 inventato da Playwright non si segue) li fa un piccolo server HTTPS
// qui, a cui Chromium manda il nome del gestionale (--host-resolver-rules); il
// resto del gestionale è il simulatore di sempre.
const pdfReferto = refertoRxPdf([
  "RADIOLOGIA - Ospedale di esempio",
  `Paziente: ROSSI MARIO nato il ${NATO_A}`,
  `C.F. ${CF_A}`,
  "Quesito Diagnostico: dispnea",
  "RADIOGRAFIA TORACE 2 PROIEZIONI",
  "Non focolai a carattere broncopneumonico.",
  "Il Medico DOTTORE ESEMPIO",
]);
const CERT = join(OUT, "cert");
mkdirSync(CERT, { recursive: true });
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=smarthealth.multimedica.it", "-days", "1",
  "-keyout", join(CERT, "k.pem"), "-out", join(CERT, "c.pem")], { stdio: "ignore" });
const alServer = [];
const srv = https.createServer({ key: readFileSync(join(CERT, "k.pem")), cert: readFileSync(join(CERT, "c.pem")) }, (req, res) => {
  alServer.push(req.url);
  if (/Sa4ViewerExtRedirect\.do/.test(req.url)) { res.writeHead(302, { location: "/sa4/restrict2/refertostream?REFERTO_ID=cccc3333-0000-0000-0000-000000000003&token=t0k3nSegreto" }); return res.end(); }
  if (/refertostream/.test(req.url)) { res.writeHead(302, { location: "/sa4/restrict2/documenti/4471/contenuto.pdf" }); return res.end(); }
  if (/contenuto\.pdf/.test(req.url)) { res.writeHead(200, { "content-type": "application/pdf", "cache-control": "private, max-age=300" }); return res.end(pdfReferto); }
  res.writeHead(404); res.end();
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const dalSw = [];   // le richieste del service worker al documento
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  acceptDownloads: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean),
    `--host-resolver-rules=MAP smarthealth.multimedica.it 127.0.0.1:${srv.address().port}`, "--ignore-certificate-errors", "--no-proxy-server"],
});
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 })); } catch { /* niente */ }
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  const u = req.url();
  if ((/Sa4ViewerExtRedirect\.do/.test(u) && /REFERTO_SISTEMA=HL7RIS/.test(u)) || /refertostream|contenuto\.pdf/.test(u)) {
    if (req.serviceWorker()) dalSw.push(new URL(u).pathname);
    return r.continue();
  }
  const mock = quale(u);
  let out = mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  if (/html/.test(out.headers["content-type"] || "")) out = { ...out, body: Buffer.from(intestazione(u, Buffer.from(out.body).toString("latin1")), "latin1") };
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa intanto */ }
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const stato = () => sw.evaluate(() => chrome.storage.local.get("registra").then((o) => o.registra || null));
const sospendi = (ms) => new Promise((res) => setTimeout(res, ms));
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(200)) if (await fn()) return true;
  return false;
}
async function suPagina(p, url) {
  await p.goto(url);
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}
async function apriPannello(p) {
  if (!(await $panel(p, ".card").count())) {
    await $panel(p, "#expand").click();
    await p.waitForSelector("#psassist-host .card", { timeout: 8000 });
  }
}
async function voce(p) {
  await apriPannello(p);
  await $panel(p, "#menubtn").click();
  const t = (await $panel(p, "#regmenu").innerText().catch(() => "")).trim();
  return t;
}

const doc = await ctx.newPage();
// ---- 1. ⋯ → Registra, sulla lista del PS --------------------------------
await suPagina(doc, A.worklistUrl);
check(await voce(doc) === "Registra", "nel menu ⋯ c'è «Registra»");
await $panel(doc, "#regmenu").click();
check(await finche(async () => (await stato())?.stato === "rec", 8000), "parte la registrazione");
await doc.waitForSelector("#psassist-host .recchip", { timeout: 5000 }).catch(() => {});
check(/● REC/.test(await $panel(doc, ".recchip").first().innerText().catch(() => "")), "in intestazione il «● REC»");
await $panel(doc, "#collapse").click();
check(/● REC/.test(await $panel(doc, "#expand .recchip").innerText().catch(() => "")), "e sulla pill");
check(await voce(doc) === "Ferma e scarica", "nel menu, adesso, «Ferma e scarica»");
await doc.keyboard.press("Escape");
await doc.waitForTimeout(800);   // la lista, già caricata, si fotografa quando parte la registrazione

// ---- 2. due pazienti, un ordine confermato con le etichette ---------------
await suPagina(doc, B.patientUrl);
await doc.waitForTimeout(1200);
await suPagina(doc, A.patientUrl);
await apriPannello(doc);
if (!(await $panel(doc, "#q").count())) await $panel(doc, '[data-seg="richieste"]').click();
await $panel(doc, "#q").fill("dolore toracico");
for (const e of ["EMOCROMOCITOMETRICO", "TROPONINA"]) await $panel(doc, `.opt[title*="${e}"]`).click();
await $panel(doc, "#goconfirm").click();
const confermata = await finche(() => Object.values(A.state.richieste).some((x) => x.confirmed), 45000);
check(confermata, "l'ordine è confermato");
if (!confermata) {   // per capire una corsa lunga che si inceppa (succede): che cosa dice il pannello
  console.log("    pannello:", (await $panel(doc, ".card, .pill").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300));
  console.log("    richieste al simulatore:", A.state.requests.map((q) => q.params.MVPG || q.params.ccsForm || q.params.Insert || "?").join(", ").slice(0, 300));
}
const etichette = await finche(() => A.state.requests.some((q) => /RcsStampaEtichetteLISHMIMU|jasperservlet/.test(q.url)), 30000);
check(etichette, "e le etichette sono state chieste");
await doc.waitForTimeout(3000);
await doc.keyboard.press("Escape").catch(() => {});
await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});

// ---- 3. un referto: due rinvii, un PDF, una finestra nuova ------------------
await suPagina(doc, A.patientUrl);
if (await $panel(doc, ".card").count()) await $panel(doc, "#collapse").click();
const [popup] = await Promise.all([
  ctx.waitForEvent("page", { timeout: 15000 }),
  doc.locator('a[onclick*="cccc3333"]').dispatchEvent("click"),
]);
await popup.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
check(/\/sa4\/restrict2\/documenti\/4471\/contenuto\.pdf$/.test(popup.url()), `il referto si apre in una finestra nuova, dopo i rinvii (${popup.url()})`);
// il registratore rilegge il PDF una volta dalla cache (2,5 s dopo)
await finche(() => sw.evaluate(() => regConta().then((c) => c.pdf.some((u) => /documenti/.test(u)))), 15000);
await doc.waitForTimeout(1500);

// ---- 4. ⋯ → Ferma e scarica -----------------------------------------------
if (process.env.REG_GREZZO) {   // per capire un cancello che non passa: i dati grezzi (del simulatore) in un file
  const g = await sw.evaluate(() => regTutto().then((l) => l.map((x) => (x.byte ? { ...x, byte: x.byte.length } : x))));
  (await import("node:fs")).writeFileSync(process.env.REG_GREZZO, JSON.stringify(g));
}
await doc.bringToFront();
check(await voce(doc) === "Ferma e scarica", "il menu dice ancora «Ferma e scarica»");
const [pagina] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), $panel(doc, "#regmenu").click()]);
const download = await pagina.waitForEvent("download", { timeout: 60000 }).catch(() => null);
check(!!download, "«Ferma e scarica» apre la pagina della registrazione e scarica lo zip");
const nomeZip = download ? download.suggestedFilename() : "";
check(/^psassist-registrazione-\d{8}-\d{4}\.zip$/.test(nomeZip), `il nome: psassist-registrazione-AAAAMMGG-HHMM.zip (${nomeZip})`);
const zip = join(OUT, nomeZip || "x.zip");
if (download) await download.saveAs(zip);
if (download && process.env.REG_ZIP) await download.saveAs(process.env.REG_ZIP);   // per guardarci dentro a mano
const esitoPagina = await pagina.evaluate(() => window.__registra || null).catch(() => null);
const testoPagina = await pagina.locator("#stato").innerText().catch(() => "");
check(esitoPagina && esitoPagina.ok && /Scaricato/.test(testoPagina), `la pagina dice com'è andata (${testoPagina.slice(0, 120)}${esitoPagina && esitoPagina.dove ? " " + JSON.stringify(esitoPagina.dove).slice(0, 600) : ""})`);
const dopo = await stato();
check(dopo && dopo.stato === "fermo" && dopo.esportata, "la registrazione è ferma e segnata come scaricata");
await doc.bringToFront();
await doc.waitForTimeout(500);
check(await $panel(doc, ".recchip").count() === 0, "il «● REC» sparisce");

// ---- 5. dentro lo zip --------------------------------------------------------
const dir = join(OUT, "dentro");
mkdirSync(dir, { recursive: true });
try { execFileSync("unzip", ["-q", "-o", zip, "-d", dir]); } catch (e) { check(false, "lo zip si apre: " + e.message); }
const leggi = (f) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return ""; } };
const pagine = existsSync(join(dir, "pagine")) ? readdirSync(join(dir, "pagine")) : [];
const pdfs = existsSync(join(dir, "pdf")) ? readdirSync(join(dir, "pdf")) : [];
check(pagine.some((f) => /^\d{3}-PsoLista\.html$/.test(f)), `c'è la lista del PS (${pagine.length} pagine)`);
check(pagine.filter((f) => /-PsoEpisodioClinicoAmbulatorio\.html$/.test(f)).length >= 2, "ci sono le schede dei pazienti");
check(pagine.some((f) => /-RcsRichiestaPrestazioniRicercaErogatore\.html$|-PsoRichiestaCreaRcs\.html$/.test(f)), "e le pagine dell'ordine (la scheda di sottofondo)");
const flusso = JSON.parse(leggi("flusso.json") || "{}");
const rq = flusso.richieste || [];
const ref = rq.find((x) => /Sa4ViewerExtRedirect\.do/.test(x.url) && /HL7RIS/.test(x.url));
check(ref && ref.rinvii.length === 2 && ref.rinvii[0].stato === 302 && /^https:\/\/gestionale\.esempio\/sa4\/restrict2\/refertostream\?REFERTO_ID=[0-9a-f-]{36}&token=\w+$/.test(ref.rinvii[0].a)
  && /^https:\/\/gestionale\.esempio\/sa4\/restrict2\/documenti\/\d+\/contenuto\.pdf$/.test(ref.rinvii[1].a) && ref.rinvii[1].t >= ref.rinvii[0].t,
  `il referto nel flusso: due rinvii, con i tempi, su indirizzi finti (${ref ? ref.rinvii.map((x) => x.stato + " " + x.a).join(" → ") : "non c'è"})`);
check(ref && ref.contenuto === "application/pdf" && ref.pdf && ref.tipo === "main_frame" && typeof ref.inizio === "number" && typeof ref.durata === "number" && ref.durata >= 0
  && ref.scheda && ref.scheda !== rq.find((x) => /PsoLista/.test(x.url))?.scheda,
  `con tipo, contenuto, tempi e la sua scheda (${ref && JSON.stringify({ tipo: ref.tipo, inizio: ref.inizio, durata: ref.durata, scheda: ref.scheda })})`);
check(rq.some((x) => x.da === "estensione" && /Insert=Inserisci/.test(x.url)), "gli inserimenti nel carrello sono segnati come dell'estensione");
check(rq.some((x) => x.metodo === "POST" && /ccsForm=Prestazioni/.test(x.url)), "c'è la conferma (POST)");
check(rq.some((x) => /RcsStampaEtichetteLISHMIMU|jasperservlet/.test(x.url)), "ci sono le etichette");
check(rq.some((x) => x.da === "registratore" && /documenti/.test(x.url)) && dalSw.filter((p) => /documenti/.test(p)).length <= 1,
  `il PDF aperto dal medico è riletto una volta sola, e si vede (${dalSw.join(", ") || "dalla cache"}; al server ${alServer.filter((u) => /contenuto/.test(u)).length})`);
check(flusso.schede && flusso.schede.some((s) => s.apertaDa), "le schede nuove dicono chi le ha aperte");
const pdfRef = pdfs.map((f) => JSON.parse(leggi("pdf/" + f))).find((x) => /documenti/.test(x.url));
check(pdfRef && pdfRef.pagine === 1 && JSON.stringify(pdfRef.misura) === "[595,842]" && pdfRef.righe.length === 7 && pdfRef.da === "rilettura",
  `il PDF del referto: testo (7 righe), pagine e misura, niente byte (${pdfRef && JSON.stringify({ pagine: pdfRef.pagine, misura: pdfRef.misura, righe: pdfRef.righe.length, da: pdfRef.da })})`);
check(pdfRef && !pdfRef.righe.some((r) => /ROSSI|RSSMRA|1947/.test(r)), `e il testo è anonimizzato (${pdfRef && pdfRef.righe.slice(0, 3).join(" | ")})`);
check(!readdirSync(dir, { recursive: true }).some((f) => /\.pdf$/i.test(String(f))) && !pdfs.some((f) => /%PDF/.test(leggi("pdf/" + f))), "nessun PDF dentro lo zip");

// niente del simulatore, da nessuna parte
const tutto = readdirSync(dir, { recursive: true }).filter((f) => statSync(join(dir, String(f))).isFile()).map((f) => leggi(String(f))).join("\n");
for (const [cosa, v] of [["ROSSI MARIO", /ROSSI(?:\s|&nbsp;|\+|%20)+MARIO/i], ["BIANCHI ANNA", /BIANCHI(?:\s|&nbsp;|\+|%20)+ANNA/i],
  ["il codice fiscale del simulatore", /SMPRSS80A01F205X/], ["il codice fiscale aggiunto", new RegExp(CF_A)], ["la data di nascita", new RegExp(NATO_A.replace(/\//g, "\\/"))],
  ["il telefono", /5550123/], ["il medico", /ESPOSITO/i], ["l'operatore", /OPERATORE PROVA/i], ["l'episodio 999001", /999001/], ["l'episodio 999002", /999002/],
  ["l'assistito *TEST00001", /TEST00001/], ["il token del portale", /t0k3nSegreto/], ["l'ospedale", /multimedica/i], ["l'indirizzo interno", /10\.11\.0\.151/]]) {
  check(!v.test(tutto), `nello zip non c'è ${cosa}`);
}
const riep = leggi("riepilogo.txt");
check(/Controllo prima dell'esportazione: superato/.test(riep) && /riletti UNA volta dalla cache/.test(riep), "il riepilogo: controllo superato, e la rilettura dalla cache è detta");
console.log("\n----- riepilogo.txt -----\n" + riep + "-------------------------");

// ---- 6. il grezzo resta solo nell'estensione, e si cancella ---------------------
const chiavi = await sw.evaluate(() => chrome.storage.local.get(null).then((o) => Object.keys(o)));
check(!chiavi.some((k) => /^reg[pfd]:/.test(k)) && (await sw.evaluate(() => regConta())).pagine > 0,
  "il grezzo sta nell'IndexedDB dell'estensione, non in storage.local (che il resto legge per intero)");
await pagina.bringToFront();
await pagina.locator("#cancella").click();
await pagina.waitForFunction(() => /cancellata/.test(document.getElementById("stato").textContent), null, { timeout: 5000 }).catch(() => {});
const resto = await sw.evaluate(() => regConta());
check(resto.pagine === 0 && resto.flusso === 0 && resto.pdf.length === 0 && !(await stato()), "«Cancella la registrazione da questo PC» toglie tutto");
await doc.bringToFront();
check(await voce(doc) === "Registra", "e il menu torna a «Registra»");

await ctx.close();
srv.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nREGISTRA: TUTTO OK");
process.exit(fail ? 1 : 0);
