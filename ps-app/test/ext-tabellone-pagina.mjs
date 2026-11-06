#!/usr/bin/env node
/*
 * Il tabellone in una scheda sua (extension/tabellone.html), con l'estensione
 * vera e un gestionale finto (nomi e numeri inventati): ⋯ → Tabellone la apre
 * (e la seconda volta la porta davanti, non ne apre un'altra); disegna il
 * tabellone dallo specchio in chrome.storage.local e lo segue quando cambia;
 * un tocco su un paziente lo apre nella scheda del gestionale, dal SUO
 * indirizzo; un paziente messo in un letto da qui finisce nella memoria del
 * gestionale; senza una scheda del gestionale si guarda soltanto («—») e
 * quello che si sposta torna com'era.
 *   node test/ext-tabellone-pagina.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-tabpag-" + process.pid);
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
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function finche(fn, timeout = 10000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) if (await fn()) return true;
  return false;
}

// ---------------------------------------------------------- il gestionale finto
const ORIGIN = "https://smarthealth.multimedica.it", DIR = "/sa4pso/restrict/";
const ALTA = { id: "00010001P", label: "AREA ALTA INTENSITA'" };
const PAZ = [
  { ep: "700001", name: "ROSSI MARIO", nato: "05/07/1947", eta: 79, triage: "ROSSO" },
  { ep: "700002", name: "VERDI ANNA", nato: "12/03/1960", eta: 66, triage: "ARANCIONE" },
  { ep: "700003", name: "NERI LUIGI", nato: "07/07/1957", eta: 69, triage: "AZZURRO" },
];
const URL_LISTA = `${ORIGIN}${DIR}menuPso.do?MVPG=PsoPazientiAmbulatorio`;
const URL_PAZ = (ep) => `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${ep}`;
const testa = `<table class="AFCHeaderTable" width="100%"><tbody><tr><td><table width="100%"><tbody><tr><td width="15%"></td>
  <td width="70%" align="center"><font style="font-size: 130%; font-weight: bolder; ">OSPEDALE ESEMPIO</font><br><font style="font-size: 110%; font-weight: bolder; ">${ALTA.label}</font><br><b>Salve!</b></td>
  <td width="15%" align="right">${ALTA.id}<br></td></tr></tbody></table></td></tr></tbody></table>`;
const pagina = (titolo, corpo) => `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>${titolo}</title></head><body>${testa}${corpo}</body></html>`;
const linguetta = (p) => `<div class="myLinguetta"><table width="100%"><tbody><tr><td width="1%"><img title="${p.triage}" src="icona:2.gif" width="18"></td>
  <td width="40%" title="${p.triage}"><strong>${p.name}</strong><br>${p.nato}(${p.eta})</td><td width="50%"><strong>MEDICO ESEMPIO</strong><br>DOLORE</td></tr></tbody></table></div>`;
const listaPage = () => pagina("Pronto Soccorso", `
  <a class="shiny-button-selected" href="?MVPG=PsoPazientiAmbulatorio">Ambulatorio (${PAZ.length})</a>
  <table class="AFCFormTABLE">${PAZ.map((p) => `<tr><td class="AFCDataTD"></td><td class="AFCDataTD" name="EPISODIO">2026/0${p.ep}</td>
    <td class="AFCDataTD"><a style="text-decoration: none" href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${p.ep}" title="Apri Episodio">${linguetta(p)}</a></td>
    <td class="AFCDataTD"><a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${p.ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">L</a></td>
    <td class="AFCDataTD" name="INGRESSO">10:00</td><td class="AFCDataTD" name="MEDICO">MEDICO ESEMPIO</td></tr>`).join("")}</table>
  <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=1&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio" style="display:none">L</a>`);
const pazientePage = (ep) => {
  const p = PAZ.find((x) => x.ep === ep) || PAZ[0];
  return pagina(p.name, `<form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${ep}"></form>
    <table><tr><td title="${p.triage}"><font style="font-size: 150%">${p.name}</font><br><font style="font-size: 120%">${p.nato} (${p.eta}) M</font></td></tr></table>
    <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">Laboratorio</a>
    <h1 id="cartella">Cartella ${ep}</h1>`);
};
const richieste = [];
const seme = () => {
  const ora = Date.now();
  return {
    "patients.v1": PAZ.map((p, i) => ({ ep: p.ep, name: p.name, url: URL_PAZ(p.ep), ts: i === 0 ? ora - 20 * 60e3 : 0, lista: ora, pk: "", triage: p.triage, eta: p.eta, arrivo: ora - (i + 1) * 40 * 60e3 })),
    "aree.v1": { membri: Object.fromEntries(PAZ.map((p) => [p.ep, { k: "alta", ts: ora }])), viste: { alta: { label: ALTA.label, ts: ora } } },
    "area.corrente.v1": { k: "alta", label: ALTA.label, id: ALTA.id, ts: ora },
    "tabellone.vista.v1": "alta",
    "stanza.alta.posti.v1": { 700001: { tipo: "letto", id: "rossa", ts: ora - 3 * 3600e3 } },
  };
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
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
  const html = mvpg === "PsoEpisodioClinicoAmbulatorio" ? pazientePage(u.searchParams.get("EPISODIO_ID")) : mvpg === "PsoPazientiAmbulatorio" ? listaPage() : pagina("Pronto Soccorso", "<p>altro</p>");
  await r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(html, "latin1") });
});
const sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const EXTURL = (f) => `chrome-extension://${new URL(sw.url()).host}/${f}`;
const $p = (page, sel) => page.locator(`#psassist-host ${sel}`);
const lsGest = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem("psassist:" + k) || "null"), k);
const spia = (page) => $p(page, ".tbspia").innerText().catch(() => "");
// chi c'è sul tabellone: le righe della lista e chi sta in un letto o in un'area (in Mappa la lista ha solo chi non ha un posto)
const righe = (page) => page.evaluate(() => [...new Set([...(document.getElementById("psassist-host")?.shadowRoot.querySelectorAll(".pzrow[data-pz], .stbed[data-occep], .starbody .stp[data-stp]") || [])]
  .map((r) => r.getAttribute("data-pz") || r.getAttribute("data-occep") || r.getAttribute("data-stp")))].sort());
const vista = (page) => page.evaluate(() => document.getElementById("psassist-host")?.shadowRoot.querySelector('.tbseg [aria-checked="true"]')?.getAttribute("data-vista") || "");
// (senza il permesso «tabs» l'indirizzo della scheda del tabellone non si vede: la si trova fra le pagine nostre)
const tabelloneDavanti = () => sw.evaluate(async () => { const [c] = await chrome.runtime.getContexts({ contextTypes: ["TAB"], documentUrls: [chrome.runtime.getURL("tabellone.html")] }); return !!c && (await chrome.tabs.get(c.tabId)).active; });
const attive = () => sw.evaluate(() => chrome.tabs.query({ active: true }).then((l) => l.map((t) => t.url)));

console.log("tabellone in una scheda sua");
try {
  // --- ⋯ → Tabellone, dalla lista del gestionale
  const gest = await ctx.newPage();
  await gest.goto(URL_LISTA);
  await gest.waitForSelector("#psassist-host #expand", { state: "attached", timeout: 15000 });
  await $p(gest, "#expand").click();
  await $p(gest, ".card").waitFor({ timeout: 5000 });
  check((await $p(gest, "#tabapri").count()) === 1, "sulla lista, accanto al ⋯, il ↗ del tabellone");
  await $p(gest, "#menubtn").click();
  const nuova = ctx.waitForEvent("page", { timeout: 10000 }).catch(() => null);
  await $p(gest, "#tabmenu").click();
  const tab = await nuova;
  await tab?.waitForLoadState("load").catch(() => {});
  check(!!tab && tab.url() === EXTURL("tabellone.html"), `⋯ → Tabellone apre la pagina del tabellone (got ${tab && tab.url()})`);
  if (!tab) throw new Error("niente tabellone");

  // --- disegnato dallo specchio
  await finche(async () => (await righe(tab)).length === PAZ.length);
  const r1 = await righe(tab);
  check(r1.length === PAZ.length && PAZ.every((p) => r1.includes(p.ep)), `il tabellone disegna i pazienti dallo specchio (got ${r1.join(",")})`);
  check(/ROSSI/.test(await $p(tab, '.stbed[data-letto="rossa"]').innerText().catch(() => "")), "e i letti: ROSSI nella Rossa");
  const sp = await sw.evaluate(() => chrome.storage.local.get("tabellone.specchio").then((o) => o["tabellone.specchio"]));
  check(!!sp && sp.kv && "patients.v1" in sp.kv && "stanza.alta.posti.v1" in sp.kv && !Object.keys(sp.kv).some((k) => /^(corsa|catalog|win|dimissioni|quesiti)/.test(k)),
    `lo specchio porta solo le chiavi del tabellone (got ${sp ? Object.keys(sp.kv).join(", ") : "niente"})`);
  check(await finche(async () => (await $p(tab, ".tbspia:not(.no)").count()) === 1 && !(await spia(tab)).trim()), `con il gestionale aperto non dice niente (got: «${await spia(tab)}»)`);
  check((await $p(tab, '.seg [data-seg="eo"]').count()) === 0 && (await $p(tab, "#menubtn").count()) === 0, "solo il tabellone: niente schede EO/Dimissioni, niente ⋯");
  const vistaTab = await tab.evaluate(() => localStorage.length);
  check(vistaTab === 0, `nella memoria della pagina dell'estensione non resta niente (got ${vistaTab} chiavi)`);
  if (SHOTS) await tab.screenshot({ path: join(SHOTS, "forma-tabellone.png") }).catch(() => {});

  // --- la seconda volta la porta davanti, non ne apre un'altra
  await gest.bringToFront();
  const prima = ctx.pages().length;
  await $p(gest, "#tabapri").click();
  await sospendi(800);
  check(ctx.pages().length === prima && (await tabelloneDavanti()), "il ↗ con il tabellone già aperto lo porta davanti, non ne apre un altro");

  // --- segue il gestionale: Alta → Bassa sulla lista, e il tabellone cambia
  await $p(gest, '[data-vista="bassa"]').click();
  check(await finche(async () => (await vista(tab)) === "bassa", 5000), `una scelta fatta nel gestionale arriva al tabellone (got ${await vista(tab)})`);
  await $p(gest, '[data-vista="alta"]').click();
  await finche(async () => (await vista(tab)) === "alta", 5000);

  // --- un letto dal tabellone: lo scrive il gestionale
  await $p(tab, '.pzrow[data-pz="700002"] .pzmetti').click();
  await $p(tab, '.stmi[data-dove^="letto:a1"]').click();
  check(await finche(async () => (await lsGest(gest, "stanza.alta.posti.v1"))?.["700002"]?.id === "a1", 5000),
    `VERDI nel Letto 1 dal tabellone: finisce nella memoria del gestionale (got ${JSON.stringify(await lsGest(gest, "stanza.alta.posti.v1"))})`);
  check(await finche(async () => /VERDI/.test(await $p(tab, '.stbed[data-letto="a1"]').innerText().catch(() => "")), 5000), "e torna al tabellone dallo specchio");

  // --- il Da fare del tabellone: una voce generale scritta qui la scrive il gestionale, e torna
  await $p(tab, "#tdin").fill("chiamare il laboratorio");
  await $p(tab, "#tdin").press("Enter");
  check(await finche(async () => (await lsGest(gest, "dafare.generale.v1"))?.some((x) => x.testo === "chiamare il laboratorio"), 5000),
    `il Da fare generale scritto nel tabellone finisce nella memoria del gestionale (got ${JSON.stringify(await lsGest(gest, "dafare.generale.v1"))})`);
  await sospendi(600);
  check(/chiamare il laboratorio/.test(await $p(tab, '.tdcard [data-tdl="gen"]').innerText().catch(() => "")), "e resta nel tabellone, dallo specchio");
  await gest.reload();
  await gest.waitForSelector("#psassist-host #expand", { state: "attached", timeout: 15000 });
  await $p(gest, "#expand").click();
  check(/VERDI/.test(await $p(gest, '.stbed[data-letto="a1"]').innerText().catch(() => "")), "il pannello del gestionale lo vede nel suo letto");
  await $p(gest, "#collapse").click();

  // --- un tocco su un paziente: lo apre la scheda del gestionale, dal suo indirizzo
  const nPagine = ctx.pages().length;
  // (le etichette di un altro ordine che aspettano la stampa non sono «un ordine che parte»: non fermano l'apertura)
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [{ id: "ord-et", stato: "stampa", ep: "700099", paziente: "BIANCHI ANNA", n: 1, ts: Date.now(), agg: Date.now(),
    pubblico: { tono: "run", titolo: "Confermata", testo: "Etichette pronte" }, stampa: { jobs: [] } }] }));
  await sospendi(400);
  await tab.bringToFront();
  await $p(tab, '.pzrow[data-pz="700003"] .pzapri').click();
  check(await finche(async () => gest.url() === URL_PAZ("700003"), 8000), `un tocco su NERI: la scheda del gestionale va sulla sua pagina (got ${gest.url()})`);
  await gest.waitForSelector("#psassist-host .card", { state: "attached", timeout: 10000 }).catch(() => {});
  check((await $p(gest, ".card").count()) === 1, "e ci arriva col pannello aperto");
  check(ctx.pages().length === nPagine && (await attive()).includes(URL_PAZ("700003")), "nella stessa scheda, portata davanti (nessuna scheda nuova)");
  check(richieste.filter((u) => /EPISODIO_ID=700003/.test(u)).every((u) => u === URL_PAZ("700003")), "l'indirizzo è quello noto, tale e quale");
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));

  // --- senza gestionale: si guarda soltanto
  await gest.close();
  check(await finche(async () => /gestionale chiuso/.test(await spia(tab)), 8000), `senza gestionale lo dice: «gestionale chiuso» (got: ${await spia(tab)})`);
  await $p(tab, '.pzrow[data-pz="700003"] .pzmetti').click();
  await $p(tab, '.stmi[data-dove^="letto:a2"]').click();
  await sospendi(1200);
  const torna = await tab.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    return { letto: r.querySelector('.stbed[data-letto="a2"]')?.innerText || "", msg: r.querySelector(".bd")?.innerText || "" };
  });
  check(!/NERI/.test(torna.letto) && /nessuna scheda del gestionale/.test(torna.msg), `un letto senza gestionale non si salva: torna com'era, e lo dice (got: ${JSON.stringify(torna.letto)} · ${torna.msg.slice(0, 80)})`);
  await tab.reload();
  await finche(async () => (await righe(tab)).length === PAZ.length);
  check((await righe(tab)).length === PAZ.length && /gestionale chiuso/.test(await spia(tab)), "riaperta senza gestionale, il tabellone è quello dello specchio, da guardare");
} catch (e) {
  check(false, "si è fermato: " + String(e.message || e).split("\n")[0]);
}
await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fail ? `\nTABELLONE (pagina): ${fail} FALLITI\n` : "\nTABELLONE (pagina): TUTTO OK\n");
process.exit(fail ? 1 : 0);
