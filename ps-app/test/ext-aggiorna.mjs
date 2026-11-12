#!/usr/bin/env node
/*
 * ⋯ → «Aggiorna app», con l'estensione VERA caricata in Chromium dalla
 * cartella dove la mette installa.cmd (qui una cartella di prova che fa da
 * %LOCALAPPDATA%\PSAssist\estensione, con il suo installata.json), il finto
 * aiutante (test/ospite-finto.mjs: «chi» e «aggiorna» come host.ps1, e lo
 * scambio della cartella fatto davvero) e GitHub finto (le richieste a
 * raw.githubusercontent.com intercettate: VERSION.txt e lo zip).
 * Le prove: la versione su GitHub uguale, più vecchia o più nuova (il puntino
 * sul ⋯ e «Aggiorna app» solo per la più nuova); senza installata.json o
 * senza aiutante «Aggiorna app» non c'è, e una riga dice come; un ordine in
 * corso (anche dal telefono) o un giro nella scheda del medico: «Dopo l'ordine
 * in corso», niente all'aiutante; uno zip che non è quello di VERSION.txt o
 * non è di PS Assist: niente all'aiutante; l'aiutante che dice di no: niente
 * ricarica; e il tocco che va: lo zip all'aiutante, la cartella scambiata
 * (la vecchia in estensione.prima), i file di stampa rinnovati, nessuna
 * cartella temporanea rimasta, chrome.runtime.reload() e l'estensione nuova
 * che parte (e lo dice all'aiutante), la pillola «Ricarica la pagina» nella
 * scheda col pannello vecchio, e il tocco sulla pillola che la riapre.
 * Da sé (3.85.3, anche la build completa): la sveglia ogni sei ore; mai con un
 * ordine, una registrazione o un comando del telefono in corso, né col telefono
 * in uso; VERSION.txt riletta subito prima dello
 * scambio; una prova andata male aspetta sei ore, senza riscaricare lo zip;
 * l'aiutante che non risponde: niente ricarica, e dopo «già nella cartella»
 * (solo la ricarica, niente zip); la sveglia che suona con la scheda del
 * gestionale aperta: aggiornata, e la pillola (il telefono, intanto: «sul PC
 * tocca Ricarica la pagina»); un ordine premuto mentre
 * l'aiutante scambia la cartella: «Non partita · niente inviato», mai perso in
 * silenzio né mandato due volte; una scheda del gestionale con la pagina
 * d'errore di Chrome (lo script non entra) non la ferma per sempre; dopo
 * ripristina.cmd la versione tolta non torna da sé (a mano sì).
 *   node test/ext-aggiorna.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { rmSync, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, chmodSync, cpSync, readdirSync, renameSync } from "node:fs";

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
const gh = { versione: MIA, zip: null, richieste: [], dopoZip: null, zipDato: false };

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
  // (`dopoZip`: quello che dice VERSION.txt dopo che lo zip è stato scaricato — una versione ritirata)
  if (u.endsWith("/mmariomm/EKGAtlas/main/ps-app/dist/VERSION.txt")) return r.fulfill({ status: 200, contentType: "text/plain", body: (gh.dopoZip && gh.zipDato ? gh.dopoZip : gh.versione) + "\n" });
  if (u.endsWith("/mmariomm/EKGAtlas/main/ps-app/dist/ps-assist-latest.zip") && gh.zip) { gh.zipDato = true; return r.fulfill({ status: 200, contentType: "application/zip", body: gh.zip }); }
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
const AGG_ALLARME = "psassist-aggiorna";
// (la sveglia vera, spostata lontano: durante le prove non suona da sola)
const svegliaLontana = () => sw.evaluate((n) => chrome.alarms.create(n, { delayInMinutes: 360, periodInMinutes: 360 }), AGG_ALLARME).catch(() => {});

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

console.log("\naggiorna: la versione su GitHub");
{
  check(await sw.evaluate(() => typeof chrome.runtime.getManifest().key === "string" && chrome.runtime.getManifest().key.length > 100),
    "il manifest dice la sua chiave (si confronta con quella dello zip)");
  // anche la build completa si aggiorna da sé: la sveglia ogni sei ore
  const sveglia = await finche(() => sw.evaluate((n) => chrome.alarms.get(n), AGG_ALLARME), 5000);
  check(!!sveglia && sveglia.periodInMinutes === 360, `la build completa ha la sua sveglia, ogni sei ore (got ${JSON.stringify(sveglia)})`);
  await svegliaLontana();
  // il pannello, all'apertura, guarda una volta al giorno
  await finche(async () => gh.richieste.length > 0, 10000);
  check(gh.richieste.length >= 1 && gh.richieste.every((x) => /VERSION\.txt$/.test(x.url) && !x.cookie),
    `aperto il pannello: una lettura di VERSION.txt, senza cookie (got ${JSON.stringify(gh.richieste)})`);
  for (const [v, attesa] of [[MIA, false], ["1.0.0", false], [NUOVA, true]]) {
    gh.versione = v;
    await dimentica();
    const r = await controlla();
    check(!!r.nuova === attesa && (!attesa || (r.nuova === NUOVA && r.puo === true)),
      `GitHub ${v === MIA ? "uguale" : attesa ? "più nuova" : "più vecchia"} (${v}, questa ${MIA}): ${attesa ? "c'è la nuova, e si può aggiornare da qui" : "niente"} (got ${JSON.stringify(r)})`);
  }
  await apriPannello();
  check(await finche(async () => (await puntino()) === true, 5000), "il puntino sul ⋯");
  await apriMenu();
  const titolo = await $panel(doc, "#aggapp").getAttribute("title").catch(() => "");
  check((await voce()) === 1 && (await $panel(doc, "#aggapp").innerText()).trim() === "Aggiorna app" && titolo.includes(NUOVA),
    `nel ⋯: «Aggiorna app», con la versione nel suggerimento (got «${titolo}»)`);
  check(lavori().some((x) => x.chi), "(l'aiutante ha detto che cosa c'è nella cartella: «chi»)");
  await chiudiMenu();
  gh.versione = MIA;
  await dimentica();
  await controlla();
  check(await finche(async () => (await puntino()) === false, 5000), "GitHub di nuovo uguale: il puntino se ne va");
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
  check((await voce()) === 0 && (await puntino()) === true && testo.includes(`C'è la ${NUOVA}`),
    `nel ⋯ il puntino e una riga che lo dice, senza «Aggiorna app» (got ${testo.slice(-220)})`);
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
  // dal pannello: con un ordine aperto il tocco non chiede nemmeno
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [{ id: "o3", stato: "corre", agg: Date.now(), ts: Date.now() }] }));
  await apriMenu();
  await $panel(doc, "#aggapp").click();
  const msg = await finche(async () => { const t = await $panel(doc, ".card").innerText(); return /Dopo l'ordine in corso/.test(t) ? t : null; }, 5000);
  check(!!msg, "dal pannello, con l'ordine aperto: «Dopo l'ordine in corso»");
  await nessunOrdine();
  check(!lavori().some((x) => x.aggiorna) && !gh.richieste.some((x) => /\.zip$/.test(x.url)), "niente zip scaricato, niente all'aiutante");
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
  r = await sw.evaluate(() => aggiorna());
  check(!r.ok && /Aggiornamento non riuscito: la cartella è in uso/.test(r.why) && !r.ricarica, `l'aiutante dice di no: lo si dice, niente ricarica (got ${r.why})`);
  check(JSON.parse(readFileSync(join(EST, "manifest.json"), "utf8")).version === MIA && temporanei().length === 0, "la cartella è quella di prima, e niente di temporaneo resta");
  comportati();
}

console.log("\naggiorna: il tocco");
{
  azzeraLavori();
  gh.zip = zipDi(NUOVA);
  await dimentica();
  await controlla();
  const nasce = ctx.waitForEvent("serviceworker", { timeout: 30000 }).catch(() => null);
  await apriMenu();
  await $panel(doc, "#aggapp").click();
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
  await svegliaLontana();
  const dopo = await memoria();
  check(!dopo || !dopo.nuova, `dopo: nessuna versione nuova da offrire (got ${JSON.stringify(dopo)})`);
}

// ---- da sé (3.85.3): anche la build completa, anche con le schede aperte ----
const NUOVA2 = "99.2.0", NUOVA3 = "99.3.0", NUOVA4 = "99.4.0";
const zipChiesti = () => gh.richieste.filter((x) => /\.zip$/.test(x.url)).length;
const scambi = () => lavori().filter((x) => x.aggiorna).length;
const versioneSw = () => sw.evaluate(() => chrome.runtime.getManifest().version).catch(() => "");
const versioneCartella = () => JSON.parse(readFileSync(join(EST, "manifest.json"), "utf8")).version;
// quello che fa la sveglia (aggAuto), aspettato: null se non c'era niente da fare
const daSe = () => sw.evaluate(() => (typeof aggAuto === "function" ? aggAuto() : { manca: "aggAuto" })).catch((e) => ({ errore: String(e) }));
const pausa = () => sw.evaluate(() => chrome.storage.local.get("aggiornaPausa").then((o) => o.aggiornaPausa || null));
const togliPausa = () => sw.evaluate(() => chrome.storage.local.remove("aggiornaPausa"));
const pillola = (p) => p.evaluate(() => document.getElementById("psassist-aggiornata")?.shadowRoot?.querySelector("button")?.textContent || "").catch(() => "");
async function riapriDallaPillola(p) {
  await p.evaluate(() => document.getElementById("psassist-aggiornata")?.shadowRoot?.querySelector("button")?.click());
  await p.waitForLoadState("load");
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}

console.log("\naggiorna: da sé, mai a metà di qualcosa");
{
  gh.versione = NUOVA2;
  gh.zip = zipDi(NUOVA2);
  azzeraLavori();
  await dimentica();
  await togliPausa();
  const z0 = zipChiesti();
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [{ id: "o9", stato: "corre", agg: Date.now(), ts: Date.now() }] }));
  let r = await daSe();
  check(!!r && r.why === "Dopo l'ordine in corso", `un ordine che gira: la sveglia non aggiorna (got ${JSON.stringify(r)})`);
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [{ id: "tel-9", stato: "coda", agg: Date.now(), ts: Date.now() }] }));
  r = await daSe();
  check(!!r && r.why === "Dopo l'ordine in corso", `un ordine in coda: nemmeno (got ${JSON.stringify(r)})`);
  await nessunOrdine();
  // la registrazione automatica che aspetta il suo minuto prima di salvarsi (REG_INC)
  await sw.evaluate(() => chrome.storage.session.set({ "registra.incidente": { ts: Date.now(), motivi: ["prova"] } }));
  r = await daSe();
  check(!!r && r.why === "Dopo la registrazione in corso", `una registrazione che aspetta di salvarsi: nemmeno (got ${JSON.stringify(r)})`);
  await sw.evaluate(() => chrome.storage.session.remove("registra.incidente"));
  // il telefono: da sé non mentre il medico lo usa (dopo la ricarica le schede aperte non gli rispondono più)
  const TEL = "Dopo il comando dall'iPhone in corso";
  const telefono = (x) => sw.evaluate((y) => {
    pt.sessione = y.sessione ? { canale: null, dal: Date.now(), ultimo: Date.now(), n: 1 } : null;
    pt.fine = y.finita ? { perche: "inattivo", testo: "", ts: Date.now() - y.finita } : null;
  }, x);
  await telefono({ sessione: true });
  r = await daSe();
  check(!!r && r.why === TEL, `una sessione col telefono aperta: la sveglia non aggiorna (got ${JSON.stringify(r)})`);
  check((await sw.evaluate(() => aggOccupato())) === "", "…a mano sì (il medico è al PC: vede «Ricarica la pagina»)");
  await telefono({ finita: 5 * 60e3 });
  r = await daSe();
  check(!!r && r.why === TEL, `la sessione finita da 5 minuti: nemmeno (got ${JSON.stringify(r)})`);
  await telefono({ finita: 11 * 60e3 });
  check((await sw.evaluate(() => aggOccupato(true))) === "", "finita da più di 10 minuti: si può");
  await telefono({});
  // un comando del telefono che lavora in una scheda di sottofondo (la cartella): né da sé né a mano
  await sw.evaluate(() => chrome.storage.session.set({ "ponte.cartelle": { 4242: { ep: "1", ts: Date.now() } } }));
  r = await sw.evaluate(() => aggiorna());
  check(!r.ok && r.why === TEL, `la cartella che il telefono sta salvando: nemmeno a mano (got ${JSON.stringify(r)})`);
  await sw.evaluate(() => chrome.storage.session.remove("ponte.cartelle"));
  check(zipChiesti() === z0 && !scambi() && (await versioneSw()) === NUOVA,
    "niente zip scaricato, niente all'aiutante, la versione è quella di prima");
}

console.log("\naggiorna: VERSION.txt riletta subito prima dello scambio");
{
  azzeraLavori();
  await dimentica();
  await togliPausa();
  // VERSION.txt cambia fra lo zip e lo scambio (una versione ritirata, o una più nuova): niente scambio
  gh.dopoZip = "99.1.5";
  gh.zipDato = false;
  const r = await sw.evaluate(() => aggiorna());
  gh.dopoZip = null;
  check(!r.ok && /Su GitHub adesso c'è la 99\.1\.5, non la 99\.2\.0/.test(r.why || "") && !scambi() && (await versioneSw()) === NUOVA,
    `non dice più quella scaricata: niente all'aiutante, niente ricarica (got ${JSON.stringify(r)})`);
  const m = await memoria();
  check(!!m && m.nuova === "99.1.5", `quella di adesso si prova al giro dopo (got ${JSON.stringify(m)})`);
}

console.log("\naggiorna: da sé, andata male aspetta sei ore");
{
  azzeraLavori();
  await dimentica();
  await togliPausa();
  comportati({ aggiornaNo: "la cartella è in uso" });
  let r = await daSe();
  check(!!r && !r.ok && /la cartella è in uso/.test(r.why || ""), `l'aiutante dice di no (got ${JSON.stringify(r)})`);
  const p = await pausa();
  check(!!p && p.v === NUOVA2 && /la cartella è in uso/.test(p.why), `annotata: la ${NUOVA2}, e perché (got ${JSON.stringify(p)})`);
  comportati();
  const z0 = zipChiesti(), s0 = scambi();
  await dimentica();
  r = await daSe();
  check(r === null && zipChiesti() === z0 && scambi() === s0, `la sveglia dopo: per sei ore niente, nemmeno lo zip (got ${JSON.stringify(r)})`);
  await togliPausa();
}

console.log("\naggiorna: l'aiutante che non risponde — niente ricarica; poi «già nella cartella»");
{
  azzeraLavori();
  await dimentica();
  await togliPausa();
  // lo scambio lo fa, ma la risposta non arriva (Chrome ha chiuso l'aiutante, o il tempo è scaduto)
  await sw.evaluate(() => {
    self.ospiteVero = ospite;
    ospite = async (m, ms) => {
      if (m.t !== "aggiorna") return self.ospiteVero(m, ms);
      await self.ospiteVero(m, ms);
      return { ok: false, why: "l'aiutante di stampa si è chiuso senza rispondere", ignoto: true };
    };
  });
  const r = await sw.evaluate(() => aggiorna());
  await sospendi(1500);
  check(!r.ok && !r.ricarica && /non ha risposto/.test(r.why || "") && (await versioneSw()) === NUOVA,
    `nessuna risposta: niente ricarica (potrebbe essere a metà della copia), gira la versione di prima (got ${JSON.stringify(r)})`);
  check(versioneCartella() === NUOVA2 && ((await pausa()) || {}).v === NUOVA2, "(la copia, qui, era finita) e la pausa: da sé, non prima di sei ore");
  check((await daSe()) === null, "la sveglia intanto: niente");
  // a mano, dopo: l'aiutante dice che nella cartella c'è già la nuova — niente zip, solo la ricarica
  const z0 = zipChiesti(), s0 = scambi();
  await dimentica();
  const nasce = ctx.waitForEvent("serviceworker", { timeout: 30000 }).catch(() => null);
  await sw.evaluate(() => { aggiorna(); });
  const nuovo = await nasce;
  const v = nuovo ? await nuovo.evaluate(() => chrome.runtime.getManifest().version).catch(() => "") : "";
  check(v === NUOVA2 && zipChiesti() === z0 && scambi() === s0, `già nella cartella: solo la ricarica, niente zip né scambio (got ${v || "nessun service worker nuovo"}, ${zipChiesti() - z0} zip)`);
  if (nuovo) { sw = nuovo; await svegliaLontana(); }
  if (await finche(() => pillola(doc), 15000)) await riapriDallaPillola(doc);
}

console.log("\naggiorna: da sé, con la scheda del gestionale aperta");
{
  gh.versione = NUOVA3;
  gh.zip = zipDi(NUOVA3);
  azzeraLavori();
  await dimentica();
  await togliPausa();
  check(await doc.evaluate(() => !!document.getElementById("psassist-host") && !document.getElementById("psassist-aggiornata")), "(la scheda del gestionale è aperta, col pannello)");
  const nasce = ctx.waitForEvent("serviceworker", { timeout: 60000 }).catch(() => null);
  // la sveglia vera, che suona fra mezzo secondo
  await sw.evaluate((n) => chrome.alarms.create(n, { when: Date.now() + 500, periodInMinutes: 360 }), AGG_ALLARME);
  const nuovo = await nasce;
  const v = nuovo ? await nuovo.evaluate(() => chrome.runtime.getManifest().version).catch(() => "") : "";
  check(v === NUOVA3 && lavori().filter((x) => x.aggiorna && x.ok).length === 1,
    `la sveglia: aggiornata da sé alla ${NUOVA3}, con la scheda del gestionale aperta (got ${v || "nessun service worker nuovo"})`);
  const pill = await finche(() => pillola(doc), 15000);
  check(pill === "PS Assist aggiornata · Ricarica la pagina", `nella scheda aperta la pillola «Ricarica la pagina» (got «${pill}»)`);
  // il telefono, intanto: la scheda col pannello vecchio non gli risponde più, e lo si dice
  const SI = "PS Assist si è aggiornato: sul PC tocca «Ricarica la pagina»";
  const tel = nuovo ? await finche(async () => { const e = (await nuovo.evaluate(() => ponteSuScheda("pazienti", {}))).errore; return e === SI ? e : null; }, 10000)
    || (await nuovo.evaluate(() => ponteSuScheda("pazienti", {})).catch((e) => ({ errore: String(e) }))).errore : "";
  check(tel === SI, `un comando dal telefono, prima di «Ricarica la pagina»: «${SI}» (got «${tel}»)`);
  if (nuovo) { sw = nuovo; await svegliaLontana(); }
  if (pill) await riapriDallaPillola(doc);
}

console.log("\naggiorna: un ordine premuto mentre l'aiutante scambia la cartella");
{
  gh.versione = NUOVA4;
  gh.zip = zipDi(NUOVA4);
  azzeraLavori();
  await dimentica();
  await togliPausa();
  await controlla();
  comportati({ lento: 8000 });   // l'aiutante ci mette otto secondi a scambiarla
  // «Aggiorna app» da un'altra scheda del gestionale
  const altra = await ctx.newPage();
  await altra.goto(A.patientUrl);
  await altra.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  if (!(await $panel(altra, ".card").count())) { await $panel(altra, "#expand").click(); await altra.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  await $panel(altra, "#menubtn").click();
  await altra.waitForSelector("#psassist-host #aggapp", { timeout: 5000 });
  const nasce = ctx.waitForEvent("serviceworker", { timeout: 60000 }).catch(() => null);
  const z0 = zipChiesti();
  await $panel(altra, "#aggapp").click();
  await finche(async () => zipChiesti() > z0, 15000);
  // lo scambio è deciso (l'aiutante sta copiando)
  await finche(() => sw.evaluate(() => typeof aggScambio !== "undefined" && aggScambio === true), 4000);
  const prima = A.state.requests.length;
  // il medico, nella sua scheda, manda un ordine
  await apriPannello();
  if (!(await $panel(doc, "#q").count())) await $panel(doc, '[data-seg="richieste"]').click();
  await $panel(doc, "#q").fill("dolore toracico");
  for (const e of ["CREATININEMIA", "TROPONINA"]) await $panel(doc, `.opt[title*="${e}"]`).click();
  await $panel(doc, "#goconfirm").click();
  const nuovo = await nasce;
  const v = nuovo ? await nuovo.evaluate(() => chrome.runtime.getManifest().version).catch(() => "") : "";
  check(v === NUOVA4, `l'aggiornamento è andato (got ${v || "nessun service worker nuovo"})`);
  await sospendi(6000);   // (una scheda d'ordine aperta prima della ricarica avrebbe avuto il tempo di mandare)
  const striscia = await doc.evaluate(() => {
    const r = document.getElementById("psassist-host")?.shadowRoot;
    return ((r?.querySelector(".gchip")?.dataset.riga || "") + " " + (r?.querySelector(".pill")?.innerText || "")).replace(/\s+/g, " ").trim();
  }).catch(() => "");
  const nuovi = A.state.requests.slice(prima);
  const ins = nuovi.filter((q) => q.params.Insert === "Inserisci"), conf = nuovi.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
  const nonPartita = /Non partita/.test(striscia) && /niente inviato/.test(striscia) && /si stava aggiornando/.test(striscia);
  // (prima: l'ordine partiva subito dopo lo scambio, in una scheda che la ricarica lasciava orfana —
  // mandato a metà o tutto, senza etichette e senza che il medico lo sapesse)
  check(nonPartita && ins.length === 0 && conf.length === 0,
    `mai perso in silenzio: «Non partita · niente inviato», e davvero niente mandato (got «${striscia}» · ${ins.length} inserimenti, ${conf.length} conferme)`);
  check(ins.length <= 2 && conf.length <= 1, `mai due volte (got ${ins.length} inserimenti, ${conf.length} conferme)`);
  const resta = nuovo ? await nuovo.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || [])).catch(() => null) : null;
  check(Array.isArray(resta) && (resta.length === 0 || ins.length === 2), `nessun ordine fantasma dopo la ricarica (got ${JSON.stringify(resta)})`);
  check(await finche(async () => (await pillola(doc)) === "PS Assist aggiornata · Ricarica la pagina", 15000), "e la pillola «Ricarica la pagina»");
  comportati();
  await altra.close().catch(() => {});
  if (nuovo) { sw = nuovo; await svegliaLontana(); }
}

console.log("\naggiorna: una scheda del gestionale dove lo script non entra (la pagina d'errore di Chrome)");
{
  if (await finche(() => pillola(doc), 3000)) await riapriDallaPillola(doc);
  await nessunOrdine();
  await doc.evaluate(() => { sessionStorage.removeItem("psassist:corsa.v1"); localStorage.removeItem("psassist:corsa.presidio.v1"); });
  check((await sw.evaluate(() => aggOccupato())) === "", "(niente in corso: libero)");
  // il gestionale non risponde: Chrome mostra la sua pagina d'errore, all'indirizzo del gestionale
  const rotta = await ctx.newPage();
  await rotta.route("**/*", (r) => r.abort("connectionrefused"));
  const ROTTA = A.patientUrl + "&rotta=1";
  await rotta.goto(ROTTA).catch(() => {});
  const vista = await finche(() => sw.evaluate((u) => chrome.tabs.query({ url: SA4 + "/*" }).then((l) => l.find((t) => t.url === u && t.status === "complete"))
    .then((t) => t && chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => 1 }).then(() => "entra", (e) => e.message)), ROTTA), 10000);
  check(/error page/.test(vista || ""), `(la scheda c'è, all'indirizzo del gestionale, e lo script non entra: «${vista}»)`);
  const r = await sw.evaluate(() => aggOccupato());
  check(r === "", `la pagina d'errore di Chrome (lì il pannello non c'è): non tiene fermo l'aggiornamento per sempre (got «${r}»)`);
  await rotta.close();
}

console.log("\naggiorna: ripristina.cmd — da sé, la versione tolta non torna");
{
  // ripristina.cmd: estensione.prima torna estensione; poi ⟳ in chrome://extensions
  const da = await versioneSw(), PRIMA = join(CASA, "estensione.prima"), TOLTA = join(CASA, "estensione.tolta");
  const prima = JSON.parse(readFileSync(join(PRIMA, "manifest.json"), "utf8")).version;
  renameSync(EST, TOLTA);
  renameSync(PRIMA, EST);
  let nasce = ctx.waitForEvent("serviceworker", { timeout: 30000 }).catch(() => null);
  await sw.evaluate(() => chrome.runtime.reload()).catch(() => {});
  let nuovo = await nasce;
  if (nuovo) { sw = nuovo; await svegliaLontana(); }
  check(da === NUOVA4 && prima === NUOVA3 && (await versioneSw()) === NUOVA3, `rimessa la versione di prima (${da} → ${await versioneSw()})`);
  gh.versione = NUOVA4;
  gh.zip = zipDi(NUOVA4);
  azzeraLavori();
  await dimentica();
  await togliPausa();
  const z0 = zipChiesti();
  const r = await daSe();
  check(r === null && zipChiesti() === z0 && !scambi() && (await versioneSw()) === NUOVA3,
    `da sé la ${NUOVA4}, tolta con ripristina.cmd, non torna: niente zip, niente all'aiutante (got ${JSON.stringify(r)})`);
  const m = await memoria();
  check(!!m && m.nuova === NUOVA4 && m.puo === true, `a mano resta: il puntino e «Aggiorna app» (got ${JSON.stringify(m)})`);
  nasce = ctx.waitForEvent("serviceworker", { timeout: 30000 }).catch(() => null);
  await sw.evaluate(() => { aggiorna(); });
  nuovo = await nasce;
  const v = nuovo ? await nuovo.evaluate(() => chrome.runtime.getManifest().version).catch(() => "") : "";
  check(v === NUOVA4, `«Aggiorna app», a mano, la rimette (got ${v || "nessun service worker nuovo"})`);
  if (nuovo) { sw = nuovo; await svegliaLontana(); }
  rmSync(TOLTA, { recursive: true, force: true });
}

check(fuori.length === 0, `nessun'altra richiesta fuori dall'ospedale (got ${fuori.slice(0, 3).join(", ")})`);
await ctx.close();
for (const d of [BASE, PROFILE, FINTO]) rmSync(d, { recursive: true, force: true });
console.log(fail ? `\nAGGIORNA: ${fail} CHECK FALLITI\n` : "\nAGGIORNA: TUTTO OK\n");
process.exit(fail ? 1 : 0);

