#!/usr/bin/env node
/*
 * La pill su ogni pagina del gestionale, con l'estensione vera e un
 * gestionale finto (nomi e numeri inventati): la dimissione (una pagina
 * «altra» di /sa4pso/) di un paziente noto apre il pannello sul paziente,
 * Esiti, e da lì non si ordina; quella di un episodio sconosciuto, o una
 * lista, apre il tabellone; una finestra Risultati di /sa4rcs/ ha la pill e
 * basta — niente letto né scritto della pagina, nessuna richiesta in più —;
 * le schede di sottofondo (una lettura, un ordine) restano senza pannello.
 *   node test/ext-ovunque.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync } from "node:fs";

// (mai la rete vera: nessun proxy, ogni nome risolto in locale — il gestionale finto passa dalle route di Playwright)
const RETE_CHIUSA = ["--proxy-server=direct://", "--host-resolver-rules=MAP * 127.0.0.1"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-ovunque-" + process.pid);
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function finche(fn, timeout = 10000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) if (await fn()) return true;
  return false;
}

// ---------------------------------------------------------- il gestionale finto
const ORIGIN = "https://smarthealth.multimedica.it", DIR = "/sa4pso/restrict/";
const PAZ = [
  { ep: "700001", name: "ROSSI MARIO", nato: "05/07/1947", eta: 79, triage: "ROSSO" },
  { ep: "700002", name: "VERDI ANNA", nato: "12/03/1960", eta: 66, triage: "ARANCIONE" },
];
const URL_PAZ = (ep) => `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${ep}`;
const URL_DIM = (ep) => `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=PsoEpisodioDimissione&EPISODIO_ID=${ep}`;
const URL_TRIAGE = `${ORIGIN}${DIR}menuPso.do?MVPG=PsoPazientiTriage`;
const URL_RIS = `${ORIGIN}/sa4rcs/restrict/RcsAccessiRisultatiElenco.do?RCS_ACCESSO_ID=90000000000101`;
const testa = (label, id) => `<table class="AFCHeaderTable" width="100%"><tbody><tr><td><table width="100%"><tbody><tr><td width="15%"></td>
  <td width="70%" align="center"><font style="font-size: 130%; font-weight: bolder; ">OSPEDALE ESEMPIO</font><br><font style="font-size: 110%; font-weight: bolder; ">${label}</font><br><b>Salve!</b></td>
  <td width="15%" align="right">${id}<br></td></tr></tbody></table></td></tr></tbody></table>`;
const pagina = (titolo, corpo, t = testa("AREA ALTA INTENSITA'", "00010001P")) =>
  `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>${titolo}</title></head><body>${t}${corpo}</body></html>`;
const riquadro = (p) => `<table><tr><td title="${p.triage}"><font style="font-size: 150%">${p.name}</font><br><font style="font-size: 120%">${p.nato} (${p.eta}) M</font></td></tr></table>`;
// la dimissione: il riquadro del paziente, i link del suo episodio, l'etichetta anagrafica — niente per ordinare
const dimPage = (ep) => {
  const p = PAZ.find((x) => x.ep === ep) || { ep, name: "BIANCHI ESEMPIO", nato: "01/01/1950", eta: 76, triage: "VERDE" };
  return pagina(p.name, `${riquadro(p)}
    <a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${ep}">Torna all'episodio</a>
    <a href="/jasperserverSAN/jasperservlet?PROJECT=sa4pso&amp;REPORT=PsoBraccialettoHMIMU&amp;EPISODIO_ID=${ep}" target="_blank">Stampa Bracciale</a>
    <form name="Dimissione" method="post" action="menuPsoEpisodio.do?ccsForm=Dimissione:Edit&amp;MVPG=PsoEpisodioDimissione&amp;EPISODIO_ID=${ep}">
      <textarea name="DIAGNOSI"></textarea></form>
    <h1 id="dimissione">Dimissione ${ep}</h1>`);
};
const pazientePage = (ep) => {
  const p = PAZ.find((x) => x.ep === ep) || PAZ[0];
  return pagina(p.name, `<form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${ep}"></form>
    ${riquadro(p)}
    <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">Laboratorio</a>`);
};
// una lista (il triage): gli episodi di tanti nei link, nessun riquadro
const triagePage = () => pagina("Pronto Soccorso", `<table class="AFCFormTABLE">${PAZ.map((p) => `<tr>
  <td><a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoTriage&amp;EPISODIO_ID=${p.ep}">${p.name}</a></td></tr>`).join("")}</table>`);
// la finestra Risultati, fuori da /sa4pso/: con un'intestazione d'area diversa,
// che una pagina di /sa4pso/ leggerebbe
const risPage = () => pagina("", `<a href="/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=700001">episodio</a>
  <table><tr><td>EMOGLOBINA</td><td>13.5</td></tr></table>`, testa("AREA BASSA INTENSITA'", "00010002P"));

const richieste = [];
const seme = () => {
  const ora = Date.now();
  return {
    "patients.v1": PAZ.map((p, i) => ({ ep: p.ep, name: p.name, url: URL_PAZ(p.ep), ts: ora - (i + 1) * 20 * 60e3, lista: ora, pk: "", triage: p.triage, eta: p.eta, arrivo: ora - (i + 1) * 40 * 60e3 })),
    "aree.v1": { membri: Object.fromEntries(PAZ.map((p) => [p.ep, { k: "alta", ts: ora }])), viste: { alta: { label: "AREA ALTA INTENSITA'", ts: ora } } },
    "area.corrente.v1": { k: "alta", label: "AREA ALTA INTENSITA'", id: "00010001P", ts: ora },
  };
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean), ...RETE_CHIUSA],
});
await ctx.addInitScript((s) => {
  if (location.origin !== "https://smarthealth.multimedica.it") return;
  try {
    if (!localStorage.getItem("psassist-seme")) {
      localStorage.setItem("psassist-seme", "1");
      for (const [k, v] of Object.entries(s)) localStorage.setItem("psassist:" + k, JSON.stringify(v));
    }
  } catch { /* niente */ }
}, seme());
await ctx.route(`${ORIGIN}/**`, async (r) => {
  const u = new URL(r.request().url()), mvpg = u.searchParams.get("MVPG");
  richieste.push(u.href);
  const html = mvpg === "PsoEpisodioDimissione" ? dimPage(u.searchParams.get("EPISODIO_ID"))
    : mvpg === "PsoEpisodioClinicoAmbulatorio" ? pazientePage(u.searchParams.get("EPISODIO_ID"))
    : mvpg === "PsoPazientiTriage" ? triagePage()
    : /RcsAccessiRisultatiElenco/.test(u.pathname) ? risPage()
    : pagina("Pronto Soccorso", "<p>altro</p>");
  await r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(html, "latin1") });
});
const sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const $p = (page, sel) => page.locator(`#psassist-host ${sel}`);
const lsGest = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem("psassist:" + k) || "null"), k);
const pannello = (page) => page.evaluate(() => !!document.getElementById("psassist-host"));
const testoHd = (page) => $p(page, ".hd .who").innerText().catch(() => "");
const schedaAccesa = (page) => $p(page, ".seg button.on").getAttribute("data-t").catch(() => "");
const apri = async (page) => {
  await page.waitForSelector("#psassist-host #expand", { state: "attached", timeout: 15000 });
  await $p(page, "#expand").click();
  await $p(page, ".card").waitFor({ timeout: 5000 });
};
// una scheda di sottofondo come le apre il service worker: nasce vuota, si
// annota per chi è, POI va sulla pagina
async function dietro(url, annota) {
  const nata = ctx.waitForEvent("page", { timeout: 10000 });
  await sw.evaluate(async ([url, annota]) => {
    const t = await chrome.tabs.create({ url: "about:blank", active: false });
    if (annota === "sotto") await chrome.storage.session.set({ ["sotto:" + t.id]: { opener: 0, cosa: "smart", ts: Date.now(), esito: "attesa" } });
    else {
      const l = (await chrome.storage.session.get("ordini")).ordini || [];
      l.push({ id: "prova-" + t.id, ep: "700001", paziente: "ROSSI MARIO", n: 1, url: "", opener: null, worker: t.id, stato: "errore", ts: Date.now(), agg: Date.now(), vista: null, resto: { mancano: [], controllare: [], nel: [] } });
      await chrome.storage.session.set({ ordini: l });
    }
    await chrome.tabs.update(t.id, { url });
  }, [url, annota]);
  const p = await nata;
  await p.waitForLoadState("load").catch(() => {});
  return p;
}

console.log("la pill su ogni pagina del gestionale");
try {
  // --- la dimissione di un paziente noto: il pannello è suo, sugli Esiti
  const doc = await ctx.newPage();
  await doc.goto(URL_DIM("700001"));
  check(await finche(() => pannello(doc), 8000), "la dimissione (una pagina «altra» di /sa4pso/) ha la pill");
  await apri(doc);
  check((await testoHd(doc)) === "ROSSI MARIO", `aperta, è del paziente della pagina (got «${await testoHd(doc)}»)`);
  check((await schedaAccesa(doc)) === "Esiti", `e parte dagli Esiti (got «${await schedaAccesa(doc)}»)`);
  const brac = await $p(doc, "#bracciale").getAttribute("href").catch(() => "");
  check(/REPORT=PsoBraccialettoHMIMU/.test(brac) && /EPISODIO_ID=700001/.test(brac), `l'etichetta anagrafica c'è, col link della pagina (got ${brac})`);
  await $p(doc, '.seg [data-seg="richieste"]').click();
  const ric = await $p(doc, ".bd").innerText().catch(() => "");
  check(/non si ordina/.test(ric) && (await $p(doc, "#go, #goconfirm, .chip[data-code]").count()) === 0,
    `Richieste: niente esami da scegliere, una riga dice dove ordinare (got «${ric.trim().slice(0, 90)}»)`);
  check(/Dimissione 700001/.test(await doc.locator("#dimissione").innerText()), "la pagina del gestionale è quella di prima, sotto");
  await $p(doc, "#collapse").click();

  // --- la dimissione di un episodio che il pannello non conosce: il tabellone
  await doc.goto(URL_DIM("799999"));
  await apri(doc);
  check((await testoHd(doc)) === "" && (await schedaAccesa(doc)) === "Pazienti", `episodio sconosciuto: niente nome, il tabellone (got «${await testoHd(doc)}» · ${await schedaAccesa(doc)})`);
  check((await $p(doc, '.pzrow[data-pz="700001"]').count()) === 1, "con i pazienti di sempre");
  await $p(doc, "#collapse").click();

  // --- una lista, con gli episodi di tanti nei link e nessun riquadro: il tabellone
  await doc.goto(URL_TRIAGE);
  await apri(doc);
  check((await testoHd(doc)) === "" && (await schedaAccesa(doc)) === "Pazienti", `la lista del triage: nessun paziente, il tabellone (got «${await testoHd(doc)}» · ${await schedaAccesa(doc)})`);
  await $p(doc, "#collapse").click();

  // --- una finestra Risultati, fuori da /sa4pso/: la pill e basta
  const area0 = await lsGest(doc, "area.corrente.v1");
  const n0 = richieste.length;
  await doc.goto(URL_RIS);
  check(await finche(() => pannello(doc), 8000), "la finestra Risultati di /sa4rcs/ ha la pill");
  await apri(doc);
  check((await testoHd(doc)) === "" && (await schedaAccesa(doc)) === "Pazienti", `nessun paziente letto dalla pagina: il tabellone (got «${await testoHd(doc)}» · ${await schedaAccesa(doc)})`);
  await sospendi(1500);
  const area = await lsGest(doc, "area.corrente.v1");
  check(area && area.k === "alta" && area.ts === area0?.ts, `l'intestazione della pagina non si legge: l'area resta quella (got ${JSON.stringify(area)})`);
  check(richieste.length - n0 === 1, `nessuna richiesta oltre la pagina stessa (got ${richieste.slice(n0).join(" · ")})`);

  // --- il paziente vero: la pagina di sempre, il pannello di sempre
  await doc.goto(URL_PAZ("700002"));
  await apri(doc);
  check((await testoHd(doc)) === "VERDI ANNA" && (await $p(doc, '.seg [data-seg="richieste"]').count()) === 1, "la pagina del paziente: il suo pannello, con le Richieste");
  await doc.close();

  // --- le schede di sottofondo restano senza
  for (const [url, chi, dove] of [[URL_RIS, "sotto", "una lettura su /sa4rcs/"], [URL_DIM("700001"), "sotto", "una lettura sulla dimissione"],
    [URL_RIS, "ordine", "un ordine su /sa4rcs/"], [URL_DIM("700001"), "ordine", "un ordine sulla dimissione"]]) {
    const p = await dietro(url, chi);
    await sospendi(2500);
    check(!(await pannello(p).catch(() => false)), `la scheda di sottofondo di ${dove}: niente pannello`);
    await p.close().catch(() => {});
  }
} catch (e) {
  check(false, "si è fermato: " + String(e.message || e).split("\n")[0]);
}
await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fail ? `\nOVUNQUE: ${fail} FALLITI\n` : "\nOVUNQUE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
