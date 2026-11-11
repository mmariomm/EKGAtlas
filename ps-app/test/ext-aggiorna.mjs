#!/usr/bin/env node
/*
 * L'aggiornamento DA SÉ (niente tocco del medico), con l'estensione VERA caricata in Chromium dalla
 * cartella dove la mette installa.cmd (qui una cartella di prova che fa da
 * %LOCALAPPDATA%\PSAssist\estensione, con il suo installata.json), il finto
 * aiutante (test/ospite-finto.mjs: «chi» e «aggiorna» come host.ps1, e lo
 * scambio della cartella fatto davvero) e GitHub finto (le richieste a
 * raw.githubusercontent.com intercettate: VERSION.txt e lo zip).
 * Le prove: la versione su GitHub uguale, più vecchia o più nuova (e niente
 * puntino, niente «Aggiorna app», niente «Ricarica» nel pannello: il medico
 * non tocca niente); senza installata.json o senza aiutante non si applica, e
 * una riga nel ⋯ dice come; mai a metà di qualcosa: un ordine in corso (anche
 * dal telefono), un giro nella scheda del medico, un testo non salvato (una
 * cartella, una dimissione), una registrazione, un foglio sulla stazione:
 * niente zip scaricato, niente all'aiutante — e quando il momento è buono
 * si applica da sé; uno zip che non è quello di VERSION.txt o
 * non è di PS Assist: niente all'aiutante; l'aiutante che dice di no: niente
 * ricarica; e l'applicazione: lo zip all'aiutante, la cartella scambiata
 * (la vecchia in estensione.prima), i file di stampa rinnovati, nessuna
 * cartella temporanea rimasta, chrome.runtime.reload() e l'estensione nuova
 * che parte (e lo dice all'aiutante), la pillola «Ricarica la pagina» nella
 * scheda col pannello vecchio, e il tocco sulla pillola che la riapre.
 *   node test/ext-aggiorna.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { rmSync, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, chmodSync, cpSync, readdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = join("/tmp", "psa-agg-" + process.pid);
const PROFILE = BASE + "-profilo";
const FINTO = BASE + "-ospite";
const CASA = join(BASE, "PSAssist");          // %LOCALAPPDATA%\PSAssist
const EST = join(CASA, "estensione");
const STAGE = join(BASE, "zip");              // lo zip «su GitHub»
for (const d of [FINTO, CASA, STAGE]) mkdirSync(d, { recursive: true });
const MIA = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8")).version;
const NUOVA = "99.1.0";

// installa.cmd: l'estensione copiata nella cartella, con installata.json
cpSync(join(root, "extension"), EST, { recursive: true });
const MARCA = JSON.stringify({ da: "installa.cmd" });
writeFileSync(join(EST, "installata.json"), MARCA);

// lo zip di una versione nuova, fatto come tools/dist.mjs (extension/, stampa/)
function zipDi(versione, { chiave } = {}) {
  rmSync(STAGE, { recursive: true, force: true });
  cpSync(join(root, "extension"), join(STAGE, "extension"), { recursive: true });
  cpSync(join(root, "stampa"), join(STAGE, "stampa"), { recursive: true, filter: (f) => !/SumatraPDF\.exe$/.test(f) });
  const m = JSON.parse(readFileSync(join(STAGE, "extension/manifest.json"), "utf8"));
  m.version = versione;
  if (chiave) m.key = chiave;
  writeFileSync(join(STAGE, "extension/manifest.json"), JSON.stringify(m, null, 2));
  writeFileSync(join(STAGE, "extension/nuova.txt"), versione);
  writeFileSync(join(STAGE, "stampa/host.ps1"), readFileSync(join(STAGE, "stampa/host.ps1"), "utf8") + `\n# versione ${versione}\n`);
  const z = join(BASE, "latest.zip");
  rmSync(z, { force: true });
  execFileSync("zip", ["-q", "-r", z, "extension", "stampa"], { cwd: STAGE });
  return readFileSync(z);
}
const gh = { versione: MIA, zip: null, richieste: [] };

function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`);
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sospendi = (ms) => new Promise((res) => setTimeout(res, ms));
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) { const v = await fn().catch(() => null); if (v) return v; }
  return null;
}

const A = createMock({ seedConfirmed: true });
// il finto aiutante
const comportati = (extra = {}) => writeFileSync(join(FINTO, "config.json"), JSON.stringify({ stampanti: ["HP LaserJet A4"], predefinita: "HP LaserJet A4", casa: CASA, ...extra }));
const lavori = () => (existsSync(join(FINTO, "lavori.jsonl")) ? readFileSync(join(FINTO, "lavori.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const azzeraLavori = () => rmSync(join(FINTO, "lavori.jsonl"), { force: true });
const lanciatore = join(FINTO, "ospite.sh");
writeFileSync(lanciatore, `#!/bin/sh\nPSA_FINTO='${FINTO}' exec '${process.execPath}' '${join(root, "test/ospite-finto.mjs")}' "$@"\n`);
chmodSync(lanciatore, 0o755);
comportati();

// la Modalità sviluppatore accesa, come sul PC del medico (l'estensione non
// pacchettizzata la chiede): senza, chrome.runtime.reload() la scarica e basta
mkdirSync(join(PROFILE, "Default"), { recursive: true });
writeFileSync(join(PROFILE, "Default", "Preferences"), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EST}`, `--load-extension=${EST}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
});
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 })); } catch { /* niente */ }
  try {
    const ids = ["aaaa1111-0000-0000-0000-000000000001", "bbbb2222-0000-0000-0000-000000000002", "cccc3333-0000-0000-0000-000000000003"];
    localStorage.setItem("psassist:autoCarica.v1", JSON.stringify({ 999001: { ts: Date.now() + 864e5, ids } }));
  } catch { /* niente */ }
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  let out = A.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = A.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa intanto */ }
});
// GitHub finto: le sole due cose che si chiedono
await ctx.route("https://raw.githubusercontent.com/**", async (r) => {
  const u = r.request().url();
  gh.richieste.push({ url: u, cookie: r.request().headers().cookie || "" });
  if (u.endsWith("/mmariomm/EKGAtlas/main/ps-app/dist/VERSION.txt")) return r.fulfill({ status: 200, contentType: "text/plain", body: gh.versione + "\n" });
  if (u.endsWith("/mmariomm/EKGAtlas/main/ps-app/dist/ps-assist-latest.zip") && gh.zip) return r.fulfill({ status: 200, contentType: "application/zip", body: gh.zip });
  return r.fulfill({ status: 404, body: "no" });
});
// qualunque altra cosa fuori: annotata (non deve essercene)
const fuori = [];
await ctx.route(/^https?:\/\/(?!smarthealth\.multimedica\.it|raw\.githubusercontent\.com)/, (r) => { fuori.push(r.request().url()); r.abort(); });

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const ID = new URL(sw.url()).host;
const MANIFEST = join(PROFILE, "NativeMessagingHosts", "it.psassist.stampa.json");
const installaAiutante = (si) => {
  if (!si) return rmSync(MANIFEST, { force: true });
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify({ name: "it.psassist.stampa", description: "finto", path: lanciatore, type: "stdio", allowed_origins: [`chrome-extension://${ID}/`] }));
};
installaAiutante(true);

const memoria = () => sw.evaluate(() => chrome.storage.local.get("aggiorna").then((o) => o.aggiorna || null));
const dimentica = () => sw.evaluate(() => chrome.storage.local.remove("aggiorna"));
const controlla = () => sw.evaluate(() => aggControlla(true));
const nessunOrdine = () => sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
const temporanei = () => readdirSync(tmpdir()).filter((f) => /^psassist-agg-/.test(f));

const doc = await ctx.newPage();
await doc.goto(A.patientUrl);
await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
async function apriPannello() {
  if (!(await $panel(doc, ".card").count())) {
    await $panel(doc, "#expand").click();
    await doc.waitForSelector("#psassist-host .card", { timeout: 8000 });
  }
}
async function apriMenu() {
  await apriPannello();
  if (!(await $panel(doc, ".menu").count())) await $panel(doc, "#menubtn").click();
  await doc.waitForSelector("#psassist-host .menu", { timeout: 5000 });
}
const chiudiMenu = async () => { if (await $panel(doc, ".menu").count()) await $panel(doc, "#menubtn").click(); };
const puntino = () => $panel(doc, "#menubtn").evaluate((b) => b.classList.contains("agg")).catch(() => null);
const voce = () => $panel(doc, "#aggapp").count();
const zipScaricati = () => gh.richieste.filter((x) => /\.zip$/.test(x.url)).length;
const pausa = () => sw.evaluate(() => chrome.storage.local.get("aggiornaPausa").then((o) => o.aggiornaPausa || null));
const azzeraZip = () => sw.evaluate(() => Promise.all([caches.delete("psassist-aggiorna"), chrome.storage.local.remove("aggiornaPausa")]));
const allarme = () => sw.evaluate(() => chrome.alarms.get("psassist-aggiorna").then((a) => a && a.scheduledTime));
// il service worker che si ferma e riparte (come fa Chrome dopo mezzo minuto di quiete): la memoria
// del service worker si perde, storage e Cache Storage restano. Lo risveglia una pagina dell'estensione.
// (Playwright tiene lo stesso oggetto `sw`: un segno nella memoria dice se è ripartito davvero)
const cdpPag = await ctx.newPage();
const cdp = await ctx.newCDPSession(cdpPag);
await cdp.send("ServiceWorker.enable");
async function riavviaSw() {
  await sw.evaluate(() => { self.__primaDelRiavvio = true; });
  await cdp.send("ServiceWorker.stopAllWorkers");
  await sospendi(300);
  await cdpPag.goto(`chrome-extension://${ID}/ponte.html`);
  await cdpPag.evaluate(() => chrome.runtime.sendMessage({ t: "nessuno" }).catch(() => null)).catch(() => null);
  const nuovo = await finche(() => Promise.race([sw.evaluate(() => typeof self.__primaDelRiavvio === "undefined"), sospendi(2000).then(() => false)]), 15000);
  await cdpPag.goto("about:blank");
  return !!nuovo;
}

console.log("\naggiorna: la versione su GitHub");
{
  check(await sw.evaluate(() => typeof chrome.runtime.getManifest().key === "string" && chrome.runtime.getManifest().key.length > 100),
    "il manifest dice la sua chiave (si confronta con quella dello zip)");
  // da sé: una sveglia ogni quarto d'ora; il pannello e il ⋯ non leggono GitHub (non lo fanno più)
  const sv = await sw.evaluate(() => chrome.alarms.get("psassist-aggiorna"));
  check(!!sv && sv.periodInMinutes === 15, `una sveglia ogni quarto d'ora (got ${JSON.stringify(sv)})`);
  await apriMenu();
  await chiudiMenu();
  await sospendi(1000);
  check(gh.richieste.length === 0, `aprire il pannello e il ⋯ non legge GitHub (got ${JSON.stringify(gh.richieste)})`);
  await sw.evaluate(() => aggControlla());
  check(gh.richieste.length === 1 && /VERSION\.txt$/.test(gh.richieste[0].url) && !gh.richieste[0].cookie, `il service worker: una lettura di VERSION.txt, senza cookie (got ${JSON.stringify(gh.richieste)})`);
  await sw.evaluate(() => aggControlla());
  check(gh.richieste.length === 1, "e non di nuovo prima di sei ore");
  for (const [v, attesa] of [[MIA, false], ["1.0.0", false], [NUOVA, true]]) {
    gh.versione = v;
    await dimentica();
    const r = await controlla();
    check(!!r.nuova === attesa && (!attesa || (r.nuova === NUOVA && r.puo === true)),
      `GitHub ${v === MIA ? "uguale" : attesa ? "più nuova" : "più vecchia"} (${v}, questa ${MIA}): ${attesa ? "c'è la nuova, e si può aggiornare da qui" : "niente"} (got ${JSON.stringify(r)})`);
  }
  gh.versione = NUOVA;
  await dimentica();
  await controlla();
  await apriPannello();
  await apriMenu();
  const piede = (await $panel(doc, ".menu .mpiede").innerText()).replace(/\s+/g, " ").trim();
  check((await puntino()) === false && (await voce()) === 0 && (await $panel(doc, "#extreload").count()) === 0 && !/Ricarica|Aggiorna/.test(piede) && /^PS Assist \S+$/.test(piede),
    `c'è la nuova, e il medico non vede niente: né puntino sul ⋯, né «Aggiorna app», né «Ricarica» (piede: «${piede}»)`);
  check(lavori().some((x) => x.chi), "(l'aiutante ha detto che cosa c'è nella cartella: «chi»)");
  await chiudiMenu();
  // nessuno può più chiederlo con un messaggio: né «aggiorna» né «aggiornaControlla»
  const pagina = await ctx.newPage();
  await pagina.goto(`chrome-extension://${ID}/ponte.html`);
  const risposte = await pagina.evaluate(() => Promise.all(["aggiorna", "aggiornaControlla"].map((t) => chrome.runtime.sendMessage({ t }).then((r) => r || null, () => null))));
  check(risposte.every((r) => !r || !r.ok), `i messaggi «aggiorna» e «aggiornaControlla» non ci sono più (got ${JSON.stringify(risposte)})`);
  await pagina.close();
  gh.versione = MIA;
  await dimentica();
  await controlla();
}

console.log("\naggiorna: non da qui");
{
  gh.versione = NUOVA;
  rmSync(join(EST, "installata.json"));
  await dimentica();
  let r = await controlla();
  check(r.nuova === NUOVA && !r.puo && /installa\.cmd/.test(r.come) && /PSAssist\\estensione/.test(r.come),
    `senza installata.json (caricata da un'altra cartella): niente tocco, e come si fa (got ${JSON.stringify(r)})`);
  await apriMenu();
  const testo = (await $panel(doc, ".menu").innerText()).replace(/\s+/g, " ");
  check((await voce()) === 0 && (await puntino()) === false && testo.includes(`C'è la ${NUOVA}`),
    `nel ⋯ una riga che dice come, senza puntino né «Aggiorna app» (got ${testo.slice(-220)})`);
  await chiudiMenu();
  writeFileSync(join(EST, "installata.json"), MARCA);
  installaAiutante(false);
  await dimentica();
  r = await controlla();
  check(r.nuova === NUOVA && !r.puo && /aiutante non risponde/.test(r.come), `senza aiutante: niente tocco, «l'aiutante non risponde» (got ${r.come})`);
  installaAiutante(true);
  await dimentica();
  r = await controlla();
  check(r.puo === true, "(di nuovo con l'aiutante: si può)");
}

console.log("\naggiorna: mai a metà di qualcosa");
{
  gh.zip = zipDi(NUOVA);
  azzeraLavori();
  for (const [cosa, rec] of [["un ordine che gira", { id: "o1", stato: "corre" }], ["un ordine dal telefono in coda", { id: "tel-1", stato: "coda" }],
    ["una stampa", { id: "s1", stato: "stampo" }], ["etichette che aspettano", { id: "o2", stato: "stampa" }]]) {
    await sw.evaluate((x) => chrome.storage.session.set({ ordini: [{ ...x, agg: Date.now(), ts: Date.now() }] }), rec);
    const r = await sw.evaluate(() => aggiorna());
    check(!r.ok && r.why === "Dopo l'ordine in corso", `${cosa}: «Dopo l'ordine in corso» (got ${JSON.stringify(r)})`);
  }
  await nessunOrdine();
  await doc.evaluate(() => sessionStorage.setItem("psassist:corsa.v1", JSON.stringify({ ts: Date.now(), ep: "999001" })));
  let r = await sw.evaluate(() => aggiorna());
  check(!r.ok && r.why === "Dopo l'ordine in corso", `un giro nella scheda del medico (il suo appunto): lo stesso (got ${JSON.stringify(r)})`);
  await doc.evaluate(() => sessionStorage.removeItem("psassist:corsa.v1"));
  await doc.evaluate(() => localStorage.setItem("psassist:corsa.presidio.v1", JSON.stringify({ rid: "1", token: "x", ts: Date.now() })));
  r = await sw.evaluate(() => aggiorna());
  check(!r.ok && r.why === "Dopo l'ordine in corso", `qualcuno sta mandando (il presidio): lo stesso (got ${JSON.stringify(r)})`);
  await doc.evaluate(() => localStorage.removeItem("psassist:corsa.presidio.v1"));
  // un testo scritto e non salvato: nella pagina (la cartella), nel pannello, una dimissione o la terapia a metà
  const prima0 = zipScaricati();
  await doc.evaluate(() => { const t = document.createElement("textarea"); t.id = "prova-cartella"; t.defaultValue = "come prima"; t.value = "scritto adesso"; document.body.appendChild(t); });
  r = await sw.evaluate(() => aggiorna());
  check(!r.ok && r.why === "Dopo l'ordine in corso", `un testo cambiato e non salvato nella pagina (la cartella): occupato (got ${JSON.stringify(r)})`);
  await doc.evaluate(() => { document.getElementById("prova-cartella").value = "come prima"; });
  r = await sw.evaluate(() => aggOccupato());
  check(r === false, `lo stesso campo com'era: libero (got ${r})`);
  await doc.evaluate(() => sessionStorage.setItem("psassist:dimdraft.x", JSON.stringify({ ts: Date.now(), testo: "Si dimette in buone condizioni" })));
  r = await sw.evaluate(() => aggOccupato());
  check(r === true, `una dimissione riscritta e non salvata (la bozza): occupato (got ${r})`);
  await doc.evaluate(() => sessionStorage.setItem("psassist:dimdraft.x", JSON.stringify({ ts: Date.now(), testo: "  " })));
  r = await sw.evaluate(() => aggOccupato());
  check(r === false, `una bozza vuota non conta (got ${r})`);
  await doc.evaluate(() => sessionStorage.removeItem("psassist:dimdraft.x"));
  await doc.evaluate(() => sessionStorage.setItem("psassist:terapia.v1", JSON.stringify({ ep: "999001" })));
  r = await sw.evaluate(() => aggOccupato());
  check(r === true, `un giro di terapia a metà: occupato (got ${r})`);
  await doc.evaluate(() => sessionStorage.removeItem("psassist:terapia.v1"));
  await doc.evaluate(() => sessionStorage.setItem("psassist:confirm.v1", JSON.stringify({ ts: Date.now() })));
  r = await sw.evaluate(() => aggOccupato());
  check(r === true, `un ordine che aspetta la sua Conferma: occupato (got ${r})`);
  await doc.evaluate(() => sessionStorage.removeItem("psassist:confirm.v1"));
  // una registrazione in corso
  await sw.evaluate(() => chrome.storage.local.set({ [REG]: { stato: "rec", inizio: Date.now(), scade: Date.now() + 600e3 } }));
  await finche(async () => sw.evaluate(() => regAttiva()), 5000);
  r = await sw.evaluate(() => aggOccupato());
  check(r === true, `una registrazione in corso: occupato (got ${r})`);
  await sw.evaluate(() => chrome.storage.local.remove(REG));
  await finche(async () => !(await sw.evaluate(() => regAttiva())), 5000);
  // un foglio che arriva sulla stazione di stampa (questo PC fa anche da stazione)
  await sw.evaluate(() => stz.inCorso.set("prova", { n: 1 }));
  r = await sw.evaluate(() => aggOccupato());
  check(r === true, `un foglio in arrivo sulla stazione di stampa: occupato (got ${r})`);
  await sw.evaluate(() => stz.inCorso.delete("prova"));
  r = await sw.evaluate(() => aggOccupato());
  check(r === false, `tutto finito: libero (got ${r})`);
  // nel dubbio aspetta: una scheda del gestionale che non risponde in tempo (la pagina ferma), o che
  // non si lascia leggere (una pagina d'errore), è occupata; quella di un PDF delle stampe non conta
  const ferma = doc.evaluate(() => { const t0 = Date.now(); while (Date.now() - t0 < 5000); }).catch(() => {});
  await sospendi(300);
  r = await sw.evaluate(() => aggOccupato());
  check(r === true, `una scheda del gestionale che non risponde in tempo: occupato (got ${r})`);
  await ferma;
  // (una scheda che non si lascia leggere — una pagina d'errore, un documento che Chrome non apre agli script:
  // qui executeScript che fallisce per quella scheda)
  const nonLeggibile = (url) => sw.evaluate((u) => chrome.tabs.query({ url: u }).then((ts) => {
    const ids = new Set(ts.map((t) => t.id));
    self.__exe = self.__exe || chrome.scripting.executeScript;
    chrome.scripting.executeScript = (o) => (ids.has(o.target.tabId) ? Promise.reject(new Error("Frame with ID 0 is showing error page")) : self.__exe.call(chrome.scripting, o));
  }), url);
  const leggibili = () => sw.evaluate(() => { if (self.__exe) chrome.scripting.executeScript = self.__exe; });
  await nonLeggibile(`${A.ORIGIN}/sa4pso/*`);
  r = await sw.evaluate(() => aggOccupato());
  await leggibili();
  check(r === true, `una scheda del gestionale che non si lascia leggere: occupato (got ${r})`);
  const pdf = await ctx.newPage();
  await pdf.goto(`${A.ORIGIN}/jasperserverSAN/stampa.pdf`).catch(() => {});
  await nonLeggibile(`${A.ORIGIN}/jasperserverSAN/*`);
  r = await sw.evaluate(() => aggOccupato());
  await leggibili();
  check(r === false, `una scheda dei PDF delle stampe (lì il pannello non nasce) non conta (got ${r})`);
  await pdf.close();
  check(!lavori().some((x) => x.aggiorna) && zipScaricati() === prima0, "niente zip scaricato, niente all'aiutante");
  await doc.evaluate(() => document.getElementById("prova-cartella")?.remove());
}

console.log("\naggiorna: lo zip deve essere quello giusto");
{
  azzeraLavori();
  gh.zip = zipDi("99.0.9");
  let r = await sw.evaluate(() => aggiorna());
  check(!r.ok && /non è ancora la 99\.1\.0/.test(r.why), `lo zip di un'altra versione: no (got ${r.why})`);
  gh.zip = zipDi(NUOVA, { chiave: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAaltra" });
  r = await sw.evaluate(() => aggiorna());
  check(!r.ok && /non è di PS Assist/.test(r.why), `uno zip con un'altra chiave: no (got ${r.why})`);
  gh.zip = Buffer.from("<html>not found</html>");
  r = await sw.evaluate(() => aggiorna());
  check(!r.ok && /non è uno zip/.test(r.why), `una pagina al posto dello zip: no (got ${r.why})`);
  check(!lavori().some((x) => x.aggiorna), "all'aiutante non è arrivato niente");
  gh.zip = zipDi(NUOVA);
  comportati({ aggiornaNo: "la cartella è in uso" });
  r = await sw.evaluate(() => aggiorna({ avvio: true }));
  check(!r.ok && /Aggiornamento non riuscito: la cartella è in uso/.test(r.why) && !r.ricarica, `l'aiutante dice di no: lo si dice, niente ricarica (got ${r.why})`);
  check(JSON.parse(readFileSync(join(EST, "manifest.json"), "utf8")).version === MIA && temporanei().length === 0, "la cartella è quella di prima, e niente di temporaneo resta");
  comportati();
}

console.log("\naggiorna: da sé, quando è il momento");
{
  azzeraLavori();
  gh.zip = zipDi(NUOVA);
  await azzeraZip();
  await dimentica();
  await controlla();
  // non è il momento: un testo scritto e non salvato. La sveglia gira, e non fa niente.
  await doc.evaluate(() => { const t = document.createElement("textarea"); t.id = "prova-cartella"; t.defaultValue = ""; t.value = "anamnesi a metà"; document.body.appendChild(t); });
  const prima1 = zipScaricati();
  await sw.evaluate(() => aggAuto());
  await sw.evaluate(() => aggAuto());
  check(zipScaricati() === prima1 && !lavori().some((x) => x.aggiorna) && (await memoria())?.nuova === NUOVA,
    `con un testo non salvato: niente scaricato, niente all'aiutante, e la versione nuova resta da applicare (got ${JSON.stringify(await memoria())})`);
  // il testo è salvato (la pagina com'era), ma la scheda del gestionale è ancora aperta: lo zip si scarica e si controlla
  // in silenzio, lo scambio no (il pannello resterebbe orfano a metà turno). E non si riscarica a ogni giro.
  await doc.evaluate(() => document.getElementById("prova-cartella").remove());
  await sw.evaluate(() => aggAuto());
  check(zipScaricati() === prima1 + 1 && !lavori().some((x) => x.aggiorna) && (await memoria())?.nuova === NUOVA && await sw.evaluate(() => aggSchede()) >= 1,
    `con una scheda del gestionale aperta: lo zip scaricato e controllato, niente all'aiutante, la cartella è quella di prima (zip ${zipScaricati() - prima1}, got ${JSON.stringify(await memoria())})`);
  const ra = await sw.evaluate(() => aggiorna());
  await sw.evaluate(() => aggAuto());
  check(!ra.ok && ra.why === "Dopo la chiusura del gestionale" && zipScaricati() === prima1 + 1 && JSON.parse(readFileSync(join(EST, "manifest.json"), "utf8")).version === MIA,
    `«Dopo la chiusura del gestionale», e lo zip non si riscarica a ogni giro (got ${ra.why}, zip ${zipScaricati() - prima1})`);
  // il service worker si ferma e riparte, più volte, con la scheda aperta: lo zip non si riscarica
  // (è nella Cache Storage, non nella memoria del service worker), nessuna domanda all'aiutante,
  // VERSION.txt non si rilegge, e la sveglia non si sposta in avanti.
  const sveglia = await allarme(), chi0 = lavori().filter((x) => x.chi).length, gh0 = gh.richieste.length;
  let riavvii = 0;
  const spostata = [];
  for (let k = 0; k < 3; k++) {
    if (await riavviaSw()) riavvii++;
    const s1 = await allarme();
    if (s1 !== sveglia) spostata.push(Math.round((s1 - sveglia) / 1000));
    await sw.evaluate(() => aggAuto());
  }
  check(riavvii === 3, `(il service worker è ripartito 3 volte: ${riavvii})`);
  check(zipScaricati() === prima1 + 1 && gh.richieste.length === gh0 && lavori().filter((x) => x.chi).length === chi0 && !lavori().some((x) => x.aggiorna),
    `3 riavvii del service worker con la scheda aperta: lo zip scaricato una volta in tutto, niente rete, niente all'aiutante (zip ${zipScaricati() - prima1}, richieste ${gh.richieste.length - gh0}, «chi» ${lavori().filter((x) => x.chi).length - chi0})`);
  check(spostata.length === 0, `la sveglia non si sposta a ogni riavvio (spostata di ${JSON.stringify(spostata)} s)`);
  // chiusa la scheda (qui: una pagina che non è del gestionale), al giro dopo si applica, da sé
  await doc.goto("about:blank");
  // (il gestionale simulato ha aperto anche una finestra del visualizzatore: è una scheda del gestionale anche lei, si chiude)
  await sw.evaluate(() => chrome.tabs.query({ url: "https://smarthealth.multimedica.it/*" }).then((t) => chrome.tabs.remove(t.map((x) => x.id))));
  check(await sw.evaluate(() => aggSchede()) === 0, "nessuna scheda del gestionale aperta");
  // l'aiutante dice di no: niente ricarica, e quella versione aspetta sei ore — né zip né aiutante a ogni giro
  comportati({ aggiornaNo: "la cartella è in uso" });
  azzeraLavori();
  const zip2 = zipScaricati(), gh2 = gh.richieste.length;
  await sw.evaluate(() => aggAuto());
  const no1 = lavori().filter((x) => x.aggiorna);
  check(no1.length === 1 && !no1[0].ok && (await pausa())?.v === NUOVA && JSON.parse(readFileSync(join(EST, "manifest.json"), "utf8")).version === MIA,
    `l'aiutante dice di no: una volta, niente ricarica, la versione in pausa (got ${JSON.stringify(await pausa())})`);
  const n1 = lavori().length;
  for (let k = 0; k < 3; k++) await sw.evaluate(() => aggAuto());
  check(lavori().length === n1 && zipScaricati() === zip2 && gh.richieste.length === gh2,
    `dopo il no, altri tre giri: niente all'aiutante, niente scaricato, niente rete (aiutante ${lavori().length - n1}, zip ${zipScaricati() - zip2})`);
  // (l'orologio finto: la pausa scritta più indietro)
  const indietro = (ms) => sw.evaluate((d) => chrome.storage.local.get("aggiornaPausa").then((o) => chrome.storage.local.set({ aggiornaPausa: { ...o.aggiornaPausa, ts: Date.now() - d } })), ms);
  await indietro(6 * 3600e3 - 60e3);
  await sw.evaluate(() => aggAuto());
  check(lavori().length === n1, `cinque ore e 59 minuti dopo: ancora niente (aiutante ${lavori().length - n1})`);
  await indietro(6 * 3600e3 + 60e3);
  await sw.evaluate(() => aggAuto());
  check(lavori().filter((x) => x.aggiorna).length === 2 && zipScaricati() === zip2,
    `sei ore dopo: si riprova, una volta, con lo zip già scaricato (all'aiutante ${lavori().filter((x) => x.aggiorna).length - 1}, zip ${zipScaricati() - zip2})`);
  comportati();
  azzeraLavori();
  await sw.evaluate(() => chrome.storage.local.remove("aggiornaPausa"));
  const nasce = ctx.waitForEvent("serviceworker", { timeout: 30000 }).catch(() => null);
  await sw.evaluate(() => { aggAuto().catch(() => {}); return true; }).catch(() => {});
  const nuovo = await nasce;
  const l = lavori().filter((x) => x.aggiorna);
  check(l.length === 1 && l[0].ok && l[0].versione === NUOVA && Math.abs(l[0].byte - gh.zip.length) < 4,
    `lo zip, intero, all'aiutante (got ${JSON.stringify(l)})`);
  check(gh.richieste.filter((x) => /\.zip$/.test(x.url)).every((x) => !x.cookie), "scaricato senza cookie");
  const man = (d) => JSON.parse(readFileSync(join(d, "manifest.json"), "utf8"));
  check(man(EST).version === NUOVA && existsSync(join(EST, "nuova.txt")) && readFileSync(join(EST, "installata.json"), "utf8") === MARCA,
    "la cartella è la nuova, con installata.json");
  check(man(join(CASA, "estensione.prima")).version === MIA, "la vecchia in estensione.prima (per ripristina.cmd)");
  check(new RegExp(`# versione ${NUOVA.replace(/\./g, "\\.")}`).test(readFileSync(join(CASA, "stampa", "host.ps1"), "utf8")) && existsSync(join(CASA, "stampa", "ripristina.cmd")),
    "anche i file dell'aiutante, in PSAssist\\stampa (ripristina.cmd compreso)");
  check(temporanei().length === 0, "nessuna cartella temporanea psassist-* rimasta");
  const v = nuovo ? await nuovo.evaluate(() => chrome.runtime.getManifest().version).catch(() => "") : "";
  check(v === NUOVA, `chrome.runtime.reload(): parte l'estensione nuova (got ${v || "nessun service worker nuovo"})`);
  check(await finche(async () => lavori().some((x) => x.chi && x.avviata === NUOVA), 15000), "e lo dice all'aiutante («chi», avviata)");
  // (la pillola, per le schede ripristinate all'avvio del browser, che si aggiorna senza aspettare: qui messa a mano)
  if (nuovo) sw = nuovo;
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: "https://smarthealth.multimedica.it/*" }); await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["aggiornata.js"] }); });
  const pill = await finche(() => doc.evaluate(() => document.getElementById("psassist-aggiornata")?.shadowRoot?.querySelector("button")?.textContent || ""), 15000);
  check(pill === "PS Assist aggiornata · Ricarica la pagina", `la scheda col pannello vecchio: la pillola (got «${pill}»)`);
  const prima = A.state.requests.length;
  await doc.evaluate(() => document.getElementById("psassist-aggiornata").shadowRoot.querySelector("button").click());
  await doc.waitForLoadState("load");
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const giri = A.state.requests.slice(prima).filter((q) => q.method !== "GET");
  check(!(await doc.evaluate(() => !!document.getElementById("psassist-aggiornata"))) && giri.length === 0,
    `un tocco: la pagina riaperta (una GET, nessun modulo rimandato), il pannello nuovo (got ${giri.length} POST)`);
  if (nuovo) sw = nuovo;
  const dopo = await memoria();
  check(!dopo || !dopo.nuova, `dopo: nessuna versione nuova da offrire (got ${JSON.stringify(dopo)})`);
}

check(fuori.length === 0, `nessun'altra richiesta fuori dall'ospedale (got ${fuori.slice(0, 3).join(", ")})`);
await ctx.close();
for (const d of [BASE, PROFILE, FINTO]) rmSync(d, { recursive: true, force: true });
console.log(fail ? `\nAGGIORNA: ${fail} CHECK FALLITI\n` : "\nAGGIORNA: TUTTO OK\n");
process.exit(fail ? 1 : 0);

