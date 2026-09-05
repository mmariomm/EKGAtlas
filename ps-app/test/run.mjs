#!/usr/bin/env node
/*
 * End-to-end tests: the REAL built content script running in a REAL Chromium
 * against the stateful SA4PSO mock (route interception — no network).
 *
 *   npm test          (from ps-app/)
 *
 * Screenshots for design review land in TEST_SHOTS_DIR if set.
 */
import { chromium } from "playwright";
import { createMock, RES } from "./sa4pso-mock.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(root, "extension/content.js");
readFileSync(CONTENT); // fail fast if not built

const SHOTS = process.env.TEST_SHOTS_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const results = [];
function check(scen, cond, msg) {
  if (!cond) { failures++; results.push(`  ✗ [${scen}] ${msg}`); }
  else results.push(`  ✓ [${scen}] ${msg}`);
}

async function newPage(browser, mock) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("https://smarthealth.multimedica.it/**", async (route) => {
    const req = route.request();
    let out = mock.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
    // Playwright drops fulfilled redirects out of interception (they'd hit
    // the real network), so the harness follows them itself for every
    // request; tests therefore wait on page CONTENT, never on the URL.
    let hops = 0;
    while (out.status === 302 && hops++ < 5) {
      out = mock.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
    }
    await route.fulfill({ status: out.status, headers: out.headers, body: out.body });
  });
  // Fail on any request that tries to leave the hospital origin
  // (blob:https://smarthealth… IS the hospital origin).
  context.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("https://smarthealth.multimedica.it/") &&
        !u.startsWith("blob:https://smarthealth.multimedica.it/") &&
        !u.startsWith("data:") && !u.startsWith("about:")) {
      failures++; results.push(`  ✗ [net] request left the origin: ${u}`);
    }
  });
  const page = await context.newPage();
  const inject = async () => { try { await page.addScriptTag({ path: CONTENT }); } catch { /* navigation race */ } };
  page.on("load", inject);
  return { context, page, inject };
}

const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`); // pierces open shadow DOM

// «⭳ Carica i valori» legge OGNI prelievo, uno alla volta: si aspetta che la
// tabella abbia le sue colonne e che il bottone sia tornato pronto — finché
// gira porta scritto «↻ 1/2…» e la schermata si ridisegna a ogni passo.
async function attendiTabella(page, nCol, timeout = 25000) {
  await page.waitForFunction(
    (n) => {
      const r = document.getElementById("psassist-host").shadowRoot;
      const b = r.querySelector("#risall");
      return r.querySelectorAll(".sttab thead th").length === n + 1 && (!b || !b.disabled);
    },
    nCol, { timeout },
  );
}

async function selectExams(page, labels) {
  // one-line catalog search + dropdown
  for (const { text } of labels) {
    await $panel(page, "#acq").fill(text);
    await $panel(page, `.acitem:has-text("${text}")`).first().click();
    await $panel(page, "#acq").fill("");
  }
}

async function shot(page, name) {
  if (!SHOTS) return;
  try { await page.screenshot({ path: join(SHOTS, name + ".png") }); } catch {}
}

// ---------------------------------------------------------------- scenarios
async function scenarioHappyLab(browser, { directRender = false } = {}) {
  const scen = directRender ? "happy-direct" : "happy";
  const mock = createMock({ directRender });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);

  await $panel(page, "#q").fill("Sospetta colangite acuta — età ≥80");
  // preset chip: Epatico (5 URGENZE exams) + one POC single via chip
  await $panel(page, '.chip.preset:has-text("Epatico")').click();
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await shot(page, scen + "-idle");
  await $panel(page, "#go").click();
  await shot(page, scen + "-running");

  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 20000 });
  await page.waitForTimeout(400);

  const rid = Object.keys(mock.state.richieste)[0];
  const r = mock.state.richieste[rid];
  check(scen, !!r, "richiesta creata");
  if (!r) return context.close();
  check(scen, r.quesito === "Sospetta colangite acuta — età &#8805;80",
    `quesito win1252+NCR corretto (got: ${JSON.stringify(r.quesito)})`);
  // byte-level: the raw body must carry the exact win1252 percent-encoding
  // Chromium itself produces for this string (golden-verified)
  const creaPost = mock.state.requests.find((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("RICHIESTACrea"));
  check(scen, /QUESITO_DIAGNOSTICO=Sospetta\+colangite\+acuta\+%97\+et%E0\+%26%238805%3B80(&|$)/.test(creaPost?.rawBody || ""),
    "byte win1252 identici alla codifica nativa del browser");
  check(scen, r.urgenza === "2", `URGENZA=2 dal doppio selected (got ${JSON.stringify(r.urgenza)})`);
  check(scen, r.medico === "42", `MEDICO=42 dal doppio selected (got ${JSON.stringify(r.medico)})`);
  const codes = [...r.cart.keys()].sort();
  check(scen, JSON.stringify(codes) === JSON.stringify(["16", "167", "228", "320", "34", "53"].sort()),
    `carrello = Epatico+emocromo (got ${codes})`);
  const dup = Object.entries(mock.state.insertCount).filter(([, n]) => n !== 1);
  check(scen, dup.length === 0, `ogni Insert inviato esattamente una volta (${JSON.stringify(mock.state.insertCount)})`);
  check(scen, !r.confirmed, "NON confermata (bottone senza conferma)");
  const insertsInLists = mock.state.requests.filter((q) => q.params.MVPG === "RcsRichiestaPrestazioniRicercaErogatore" && q.params.Insert);
  check(scen, insertsInLists.length === 0, "nessuna GET di lista contiene Insert=");
  // the panel on the landing page shows the cart rows of the CURRENT resource
  // (the run ends on URGENZE: its 5 exams are visible there, the POC one isn't)
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.waitForTimeout(300);
  const cartChips = await $panel(page, ".chip.cart").count();
  check(scen, cartChips === 5, `pannello mostra i 5 esami in carrello su questa risorsa (got ${cartChips})`);
  const receipt = await $panel(page, ".banner.ok").innerText().catch(() => "");
  check(scen, /6 esami in carrello, verificati/.test(receipt), `ricevuta sintetica (got: ${receipt.trim().slice(0, 50)})`);
  const ghosted = await $panel(page, ".chip.ghosted").count();
  check(scen, ghosted === 1, `l'esame POC fuori pagina è mostrato come verificato altrove (got ${ghosted})`);
  await shot(page, scen + "-landed");
  await context.close();
}

async function scenarioLabelMismatch(browser) {
  const scen = "label-mismatch";
  // the server renamed code 320 → the tool must refuse BEFORE sending anything
  const mock = createMock({ mislabel: { 320: "TEST COAGULATIVO SPECIALE (X999)" } });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host .banner.err", { timeout: 30000 });
  const banner = await $panel(page, ".banner.err").innerText();
  check(scen, /oggi si chiama/.test(banner) && /TEST COAGULATIVO/.test(banner), `spiega il cambio nome (got: ${banner.slice(0, 90)})`);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, !mock.state.insertCount[`${rid}:320`], "NESSUN invio per l'esame rinominato");
  await context.close();
}

async function scenarioAutoConfirm(browser) {
  const scen = "autoconfirm";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  const eraQui = page.url();
  await $panel(page, "#goconfirm").click();
  // la conferma avviene in una cornice invisibile: la scheda del medico non
  // va sul carrello, e questo è esattamente il punto
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 });
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === true, "richiesta confermata");
  check(scen, page.url() === eraQui, `la scheda non si è mossa dalla pagina del paziente (got …${page.url().slice(-40)})`);
  const confirmPost = mock.state.requests.find((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
  check(scen, confirmPost && confirmPost.form.MVPG === "RcsStampaEtichetteLIS", "POST Conferma con MVPG etichette (click nativo)");
  check(scen, confirmPost && confirmPost.form.Cancel === undefined && confirmPost.form.Update === "Conferma",
    "e i campi inviati sono quelli del modulo, come li serializza il browser");
  check(scen, /Etichette provette/.test(await $wiz(page, ".pwhd").innerText()), "la stampa parte lo stesso");
  await context.close();
}

// Se il server non si lascia incorniciare, la conferma in sottofondo non è
// possibile: si torna alla strada di sempre — la pagina del carrello davanti
// agli occhi — e la richiesta si conferma lo stesso, una volta sola.
async function scenarioCorniceVietata(browser) {
  const scen = "cornice-vietata";
  const mock = createMock({ vietaCornice: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 });
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === true, "la richiesta viene confermata lo stesso");
  const conferme = mock.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
  check(scen, conferme.length === 1, `e una volta sola, mai due (got ${conferme.length})`);
  check(scen, /Etichette provette/.test(await $wiz(page, ".pwhd").innerText()), "e la stampa parte");
  await context.close();
}

async function scenarioAutoConfirmMismatch(browser) {
  const scen = "confirm-blocked";
  // an exam is already in the cart from an earlier, abandoned attempt: the
  // native Conferma would submit MORE than this run added → no auto-confirm
  const mock = createMock({ preloadCart: { code: "30", res: RES.POC } });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === false, "col carrello diverso dalla ricevuta NON conferma");
  check(scen, /sospesa/i.test(await $panel(page, ".card").innerText()), "e lo dice: conferma sospesa, decide il medico");
  await context.close();
}

// Non poter controllare NON è come aver controllato. Se la ricevuta della
// corsa non c'è (memoria piena, un'altra scheda, un tentativo di prima), il
// controllo «nel carrello c'è solo quello che ho aggiunto io» non si può fare
// — e la Conferma nativa invia la richiesta intera. Si ferma.
async function scenarioAutoConfirmSenzaRicevuta(browser) {
  const scen = "confirm-senza-ricevuta";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  // la ricevuta sparisce appena viene scritta, prima che la pagina la legga
  await page.evaluate(() => {
    const K = "psassist:receipt.v1";
    const vero = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === K) return;                       // scritta persa, come a memoria piena
      return vero.call(this, k, v);
    };
  });
  await $panel(page, "#goconfirm").click();
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === false,
    "senza ricevuta NON conferma da sola");
  check(scen, /sospesa/i.test(await $panel(page, ".card").innerText()),
    "e lo dice invece di fingere di aver controllato");
  await context.close();
}

// La Conferma nativa invia la richiesta INTERA. Se l'avanzo di un tentativo
// precedente sta sul carrello di un'ALTRA risorsa, questa pagina non lo mostra
// nemmeno: l'auto-conferma deve guardare il carrello di ogni risorsa che il
// run ha visitato, non solo quello che ha davanti.
async function scenarioAutoConfirmAltraRisorsa(browser) {
  const scen = "confirm-blocked-altra-risorsa";
  const mock = createMock({ preloadCart: { code: "30", res: RES.POC } });   // avanzo su POC
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("sepsi");
  await $panel(page, '.opt[title*="TROPONINA"]').click();              // POC
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();         // URGENZE: si finisce qui
  await $panel(page, "#goconfirm").click();
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 25000 });
  await page.waitForTimeout(3000);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === false,
    "un avanzo su un'altra risorsa impedisce l'auto-conferma");
  const card = await $panel(page, ".card").innerText();
  check(scen, /sospesa/i.test(card), "e lo dice");
  check(scen, /POC/i.test(card), `nominando la risorsa dove sta l'avanzo (got: ${(/sospesa[^.]{0,110}/i.exec(card) || [""])[0]})`);
  await context.close();
}

async function scenarioConfirmPostFails(browser) {
  const scen = "confirm-500";
  // the confirm POST dies on the server: nothing must print for that richiesta
  const mock = createMock({ confirmFails: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await page.waitForTimeout(6000);   // la conferma parte, il server risponde 500
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === false, "la richiesta resta non confermata");
  check(scen, hits(mock, "RcsStampaEtichetteLISHMIMU") === 0 && hits(mock, "jasperservlet") === 0,
    "nessun PDF stampato per una conferma mai registrata");
  check(scen, (await page.locator("#psassist-print").count()) === 0, "nessun wizard di stampa");
  await context.close();
}

async function scenarioAltroPresidio(browser) {
  const scen = "altro-presidio";
  // Same hospital group, another site: resources and exam codes are numbered
  // differently, names and LIS mnemonics are not. The panel must recognise
  // them by name and order anyway — never by trusting a stale id.
  const mock = createMock({ altroPresidio: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#q").fill("dispnea");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();   // POC
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();        // URGENZE
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host #confirmnow", { timeout: 40000 });

  const rid = Object.keys(mock.state.richieste)[0];
  const cart = [...mock.state.richieste[rid].cart.keys()].sort();
  check(scen, JSON.stringify(cart) === JSON.stringify(["159", "320"]),
    `i due esami arrivano al LIS giusti (got ${cart})`);
  const dup = Object.entries(mock.state.insertCount).filter(([, n]) => n !== 1);
  check(scen, dup.length === 0, "ogni esame inviato una volta sola");
  const reg = await page.evaluate(() => JSON.parse(sessionStorage.getItem("psassist:log.999001") || "{}").lines?.join("\n") || "");
  check(scen, /risorsa di questo presidio/.test(reg), "il Registro dichiara la risorsa tradotta");
  check(scen, /codice di questo presidio/.test(reg), "e il codice tradotto");

  // typography differs between sites: an en dash is not a rename
  const mock2 = createMock({ altroPresidio: true });
  const b2 = await newPage(browser, mock2);
  await b2.page.goto(mock2.patientUrl);
  await b2.page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(b2.page, "#q").fill("dispnea");
  await $panel(b2.page, '.opt[title*="EMOGASANALISI VENOSA"]').first().click();
  await $panel(b2.page, "#go").click();
  await b2.page.waitForSelector("#psassist-host #confirmnow", { timeout: 40000 });
  const rid2 = Object.keys(mock2.state.richieste)[0];
  check(scen, mock2.state.richieste[rid2].cart.has("3"),
    "«VENOSA» che qui si chiama «CAPILLARE», stesso mnemonico, non ferma l'ordine");
  const reg2 = await b2.page.evaluate(() => JSON.parse(sessionStorage.getItem("psassist:log.999001") || "{}").lines?.join("\n") || "");
  check(scen, /stesso esame, nome diverso in questa sede/.test(reg2), "e la differenza è dichiarata nel Registro");
  await b2.context.close();
  check(scen, /esami in carrello, verificati/.test(await $panel(page, ".banner.ok").innerText()), "la ricevuta è quella di sempre");
  await context.close();
}

async function scenarioPresidioSconosciuto(browser) {
  const scen = "presidio-sconosciuto";
  // A resource whose NAME does not match anything known: no guessing — stop,
  // and say exactly what this richiesta offers.
  // another site's ids AND a name nothing can be matched against
  const mock = createMock({ altroPresidio: true, resLabels: { "00660001P": "SETTORE ANALISI SPECIALI 7" } });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host .banner.err", { timeout: 30000 });
  const banner = await $panel(page, ".banner.err").innerText();
  check(scen, /Questa richiesta offre/.test(banner), `l'errore dice cosa c'è davvero (got: ${banner.replace(/\s+/g, " ").slice(0, 80)})`);
  check(scen, Object.keys(mock.state.insertCount).length === 0, "e non invia nulla");
  await context.close();
}

async function scenarioLagVerify(browser) {
  const scen = "lag-verify";
  // the DEL row for 320 stays hidden for the first 2 list renders after the add
  const mock = createMock({ lagRenders: { 320: 2 } });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 30000 });
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.insertCount[`${rid}:320`] === 1, "verifica in ritardo NON causa un secondo Insert");
  check(scen, mock.state.richieste[rid].cart.has("320"), "esame nel carrello");
  await context.close();
}

async function scenarioNeverVisible(browser) {
  const scen = "hard-stop";
  const mock = createMock({ neverAdd: ["320"] }); // server "loses" the add
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("controllo");
  // POC exam (lost by the server) runs first; the URGENZE one must never start
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host .banner.err", { timeout: 30000 });
  const banner = await $panel(page, ".banner.err").innerText();
  check(scen, /non risulta nel carrello/i.test(banner), `messaggio hard-stop chiaro (got: ${banner.slice(0, 80)})`);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.insertCount[`${rid}:320`] === 1, "esame perso inviato UNA volta sola");
  check(scen, !mock.state.insertCount[`${rid}:159`], "gli esami successivi NON vengono inviati dopo lo stop");
  check(scen, mock.state.richieste[rid].confirmed === false, "nessuna conferma dopo hard-stop");
  await shot(page, scen);
  await context.close();
}

async function scenarioEpisodeSwap(browser) {
  const scen = "episode-swap";
  // after 3 handled requests every page belongs to ANOTHER episode:
  // the wrong-patient guard must abort BEFORE any Insert is sent
  const mock = createMock({ swapEpisodeAfter: 3 });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host .banner.err", { timeout: 30000 });
  const banner = await $panel(page, ".banner.err").innerText();
  check(scen, /altro episodio|episodio/i.test(banner), `errore parla dell'episodio (got: ${banner.slice(0, 80)})`);
  check(scen, Object.keys(mock.state.insertCount).length === 0, "ZERO Insert inviati su episodio sbagliato");
  await context.close();
}

async function scenarioExpiryOnInsert(browser) {
  const scen = "expiry-on-insert";
  // the session dies exactly on the Insert response: the message must state
  // the ambiguity and nothing further may be sent
  const mock = createMock({ expireAfter: 5 });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host .banner.err", { timeout: 30000 });
  const banner = await $panel(page, ".banner.err").innerText();
  check(scen, /potrebbe essere stato aggiunto/i.test(banner), `messaggio di ambiguità presente (got: ${banner.slice(0, 90)})`);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.insertCount[`${rid}:320`] === 1, "l'Insert ambiguo è stato inviato una sola volta");
  check(scen, !mock.state.insertCount[`${rid}:159`], "nessun invio successivo dopo la sessione scaduta");
  await context.close();
}

async function scenarioSessionExpiry(browser) {
  const scen = "session-expiry";
  const mock = createMock({ expireAfter: 3 }); // patient + entry + crea POST, then dead
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host .banner.err", { timeout: 30000 });
  const banner = await $panel(page, ".banner.err").innerText();
  check(scen, /sessione scaduta/i.test(banner), `errore parla di sessione scaduta (got: ${banner.slice(0, 80)})`);
  await context.close();
}

async function scenarioPrefilledQuesito(browser) {
  const scen = "quesito-prefilled";
  const mock = createMock({ prefilledQuesito: "trauma cranico da triage" });
  const { context, page } = await newPage(browser, mock);
  // start from the CREA page like the doctor who already clicked Laboratorio
  await page.goto(`${mock.ORIGIN}${mock.PATH}?MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=999001&ASSISTITO_ID=*TEST00001&STRUTTURA=1&RISORSA_ID=${RES.POC}&RISORSE=${RES.POC},${RES.CENTRAL},${RES.URGENZE}&PADIGLIONE=&toPage=RcsRichiestaPrestazioniRicercaErogatore&returnPage=PsoEpisodio`);
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#q").fill("QUESTO NON DEVE VINCERE");
  await $panel(page, "#go").click();
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 20000 });
  const r = Object.values(mock.state.richieste)[0];
  check(scen, r.quesito === "trauma cranico da triage", `quesito del server non sovrascritto (got ${JSON.stringify(r.quesito)})`);
  await context.close();
}

async function scenarioExamPageManual(browser) {
  const scen = "exam-manual";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  // create a richiesta by driving the REAL pages natively (no helper)
  await page.goto(mock.patientUrl);
  await page.click('a[title="Richieste Laboratorio"]');
  await page.fill('form[name="RICHIESTACrea"] textarea[name="QUESITO_DIAGNOSTICO"]', "febbre");
  await page.click('form[name="RICHIESTACrea"] input[name="Update"]');
  await page.waitForSelector('form[name="Prestazioni"]', { timeout: 20000 });
  await page.waitForSelector("#psassist-host", { state: "attached" });
  // now use the panel ON the exam page: one POC chip + one URGENZE chip → resource switch
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  await page.waitForFunction(() => {
    const host = document.getElementById("psassist-host");
    const b = host?.shadowRoot?.querySelector(".banner.ok, .banner.err");
    return !!b || !document.getElementById("psassist-host");
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForURL(/RISORSA_ID=00720001P/, { timeout: 20000 }); // lands on the last resource used
  const r = Object.values(mock.state.richieste)[0];
  check(scen, r.cart.has("320") && r.cart.has("159"), `carrello con POC+URGENZE (got ${[...r.cart.keys()]})`);
  check(scen, r.cart.get("159") === RES.URGENZE, "PCT aggiunta sulla risorsa giusta (URGENZE)");
  // MANUAL native Conferma must also arm the print handoff (server then
  // redirects to the patient page, where the wizard fires)
  await page.click('form[name="Prestazioni"] input[name="Update"]');
  await page.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 20000 });
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const wh = await page.locator("#psassist-print .pwhd").innerText();
  check(scen, /Etichette provette/.test(wh), "conferma manuale → wizard di stampa automatico sulla pagina paziente");
  // i pulsanti: uno per verbo, niente doppioni. «Avanti» e «Salta» facevano
  // esattamente la stessa cosa e stavano uno accanto all'altro.
  const bott = await page.evaluate(() => [...document.getElementById("psassist-print").shadowRoot
    .querySelectorAll(".pwft .pwbtn")].map((b) => ({ id: b.id, txt: b.textContent.replace(/\s+/g, " ").trim() })));
  check(scen, bott.length === 4, `quattro pulsanti, non cinque (got ${bott.map((b) => b.txt).join(" | ")})`);
  check(scen, !bott.some((b) => /salta/i.test(b.txt)), "niente «Salta»: era «Avanti» con un altro nome");
  check(scen, bott.every((b) => /^[^A-Za-z0-9]/.test(b.txt)), `ognuno ha la sua icona (got ${bott.map((b) => b.txt).join(" | ")})`);
  check(scen, new Set(bott.map((b) => b.id)).size === 4, "e nessun identificativo ripetuto");
  await context.close();
}

async function scenarioWrongResourceRefused(browser) {
  const scen = "wrong-res";
  const mock = createMock({ prefilledQuesito: "x" });
  const { context, page } = await newPage(browser, mock);
  // radiology crea page + a POC exam selected → refused LIVE, before any click
  await page.goto(`${mock.ORIGIN}${mock.PATH}?MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=999001&ASSISTITO_ID=*TEST00001&STRUTTURA=1&RISORSA_ID=${RES.RX}&RISORSE=${RES.RX},${RES.ECO},${RES.RMN},${RES.TAC}&PADIGLIONE=&toPage=RcsRichiestaPrestazioniRicercaErogatore&returnPage=PsoEpisodio`);
  const before = mock.state.requests.length;
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await page.waitForSelector("#psassist-host .problem", { timeout: 8000 });
  const problem = await $panel(page, ".problem").innerText();
  check(scen, /Non ordinabili/i.test(problem), `avviso live chiaro (got: ${problem.slice(0, 60)})`);
  check(scen, await $panel(page, "#go").isDisabled(), "CTA disabilitato con motivo visibile");
  check(scen, mock.state.requests.length === before, "zero richieste inviate al server");
  await context.close();
}

async function scenarioMissingQuesito(browser) {
  const scen = "no-quesito";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  const before = mock.state.requests.length;
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  check(scen, await $panel(page, "#go").isDisabled(), "senza quesito il CTA è disabilitato");
  const problem = await $panel(page, ".problem").innerText();
  check(scen, /quesito/i.test(problem), `motivo visibile (got: ${problem.slice(0, 60)})`);
  // typing the quesito re-enables it live, without re-render stealing focus
  await $panel(page, "#q").fill("febbre");
  check(scen, !(await $panel(page, "#go").isDisabled()), "col quesito il CTA si riattiva subito");
  check(scen, mock.state.requests.length === before, "nel frattempo zero richieste al server");
  await context.close();
}

async function scenarioRadiologyLearning(browser) {
  const scen = "radio-learn";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  // 1) the doctor opens a radiology richiesta natively once
  await page.goto(mock.patientUrl);
  await page.click('a[title="Richieste Radiologia"]');
  await page.fill('form[name="RICHIESTACrea"] textarea[name="QUESITO_DIAGNOSTICO"]', "sospetta frattura");
  await page.click('form[name="RICHIESTACrea"] input[name="Update"]');
  await page.waitForSelector('form[name="Prestazioni"]', { timeout: 20000 });
  await page.waitForSelector("#psassist-host", { state: "attached" }); // content script ran → learned the RX list
  // 2) back on the patient page, RX TORACE is now selectable and one-click works
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dispnea e dolore toracico");
  await selectExams(page, [{ res: RES.RX, text: "RX TORACE 2 PROIEZIONI" }]); // mock-only: proves learning
  await $panel(page, "#go").click();
  await page.waitForURL(/RISORSA_ID=00120001P/, { timeout: 20000 });
  const rids = Object.keys(mock.state.richieste);
  const second = mock.state.richieste[rids[rids.length - 1]];
  check(scen, second && second.cart.has("401"), `RX torace ordinato one-click dopo l'apprendimento (cart ${second && [...second.cart.keys()]})`);
  check(scen, second.quesito === "dispnea e dolore toracico", "quesito radiologia corretto");
  await context.close();
}

const $wiz = (page, sel) => page.locator(`#psassist-print ${sel}`);
const hits = (mock, substr) => mock.state.requests.filter((q) => q.url.includes(substr)).length;

async function scenarioPrintManual(browser) {
  const scen = "print-manual";
  const mock = createMock({ seedConfirmed: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  let head = await $wiz(page, ".pwhd").innerText();
  check(scen, /Stampa 1 di 2 — Etichette provette/.test(head) && /etichettatrice/.test(head), `job 1 = etichette → etichettatrice (got: ${head.slice(0, 70)})`);
  await page.waitForTimeout(1800); // fallback print attempt fires even without a PDF viewer
  check(scen, Number(await page.locator("#psassist-print").getAttribute("data-print-attempts")) >= 1, "print dialog richiesto automaticamente");
  check(scen, hits(mock, "RcsStampaEtichetteLISHMIMU.do") === 1, "PDF etichette scaricato una volta");
  await $wiz(page, "#pwnext").click();
  head = await $wiz(page, ".pwhd").innerText();
  check(scen, /Stampa 2 di 2 — Lista esami/.test(head) && /stampante normale/.test(head), `job 2 = lista → stampante normale (got: ${head.slice(0, 70)})`);
  await page.waitForTimeout(400);
  check(scen, hits(mock, "REPORT=RcsRichiesta&") === 1, "PDF lista esami scaricato una volta");
  await $wiz(page, "#pwnext").click();
  await page.waitForTimeout(300);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "wizard chiuso a fine sequenza");
  await context.close();
}

async function scenarioPrintMultiLab(browser) {
  const scen = "print-multi-lab";
  // POC + URGENZE in one richiesta → the LIS splits it into two rows
  // (RICHIESTA_PROG 1 and 2): ALL four PDFs must be printed, labels first.
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("febbre di origine sconosciuta");
  await $panel(page, '.opt[title*="TROPONINA"]').click();      // POC
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click(); // URGENZE
  await $panel(page, "#goconfirm").click();
  // confirm → patient page; the wizard is the signal
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 });

  const heads = [];
  for (let k = 0; k < 4; k++) {
    heads.push(await $wiz(page, ".pwhd").innerText());
    await $wiz(page, "#pwnext").click();
    await page.waitForTimeout(350);
  }
  check(scen, /Stampa 1 di 4 — Etichette provette — riga 1/.test(heads[0]) && /etichettatrice/.test(heads[0]),
    `job 1: etichette riga 1 → etichettatrice (got: ${heads[0].split("\n")[0]})`);
  check(scen, /Stampa 2 di 4 — Etichette provette — riga 2/.test(heads[1]),
    `job 2: etichette riga 2 (got: ${heads[1].split("\n")[0]})`);
  check(scen, /Stampa 3 di 4 — Lista esami — riga 1/.test(heads[2]) && /stampante normale/.test(heads[2]),
    `job 3: lista riga 1 → stampante normale (got: ${heads[2].split("\n")[0]})`);
  check(scen, /Stampa 4 di 4 — Lista esami — riga 2/.test(heads[3]),
    `job 4: lista riga 2 (got: ${heads[3].split("\n")[0]})`);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "wizard chiuso dopo tutte e 4 le stampe");

  const et = mock.state.requests.filter((q) => q.url.includes("RcsStampaEtichetteLISHMIMU.do"));
  check(scen, et.length === 2 && new Set(et.map((q) => q.params.RICHIESTA_PROG)).size === 2,
    `due PDF etichette, PROG distinti (got ${et.map((q) => q.params.RICHIESTA_PROG)})`);
  const li = mock.state.requests.filter((q) => q.url.includes("REPORT=RcsRichiesta&"));
  check(scen, li.length === 2 && new Set(li.map((q) => q.params.RISORSA_ID)).size === 2,
    `due PDF lista, risorse distinte (got ${li.map((q) => q.params.RISORSA_ID)})`);
  check(scen, new Set(li.map((q) => q.params.BRANCA)).size === 2,
    `BRANCA passato tale e quale dal DOM, mai costruito (got ${li.map((q) => q.params.BRANCA)})`);
  await context.close();
}

async function scenarioPrintRadio(browser) {
  const scen = "print-radio";
  const mock = createMock({ seedConfirmedRadio: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  const rowTxt = await page.locator('#psassist-host [data-print="699998"]').first().innerText();
  check(scen, /prenotazione/i.test(rowTxt), `riga radiologia etichettata "prenotazione" (got: ${rowTxt.trim().slice(0, 60)})`);
  await page.locator('#psassist-host [data-print="699998"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const head = await $wiz(page, ".pwhd").innerText();
  check(scen, /Stampa 1 di 1 — Prenotazione esterna/.test(head) && /stampante normale/.test(head),
    `RX: un solo PDF prenotazione → stampante normale (got: ${head.split("\n")[0]})`);
  await page.waitForTimeout(400);
  check(scen, hits(mock, "REPORT=PsoRichiestaAccertamentiRadiografici") === 1, "PDF prenotazione radiologica scaricato");
  await $wiz(page, "#pwnext").click();
  await page.waitForTimeout(300);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "wizard chiuso");
  await context.close();
}

async function scenarioPrintAutoOnPatient(browser) {
  const scen = "print-auto-patient";
  // field-observed default: Conferma redirects to the PATIENT page, whose
  // audited print rows are where the wizard fires
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  // countdown → confirm → back on the patient page (content-based wait)
  await page.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 30000 });
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const head = await $wiz(page, ".pwhd").innerText();
  check(scen, /Etichette provette/.test(head), "wizard si apre da solo al ritorno sulla pagina paziente");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "Esc chiude il wizard");
  await page.reload();
  await page.waitForTimeout(1800);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "flag consumato: al reload non riparte");
  await context.close();
}

async function scenarioPrintAutoInterstitial(browser) {
  const scen = "print-auto-interstitial";
  // deployment variant with an intermediate label page CARRYING the links:
  // the wizard must fire right there (panel-less page)
  const mock = createMock({ labelsInterstitial: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  // la pagina intermedia coi link ora sta nella cornice invisibile: il wizard
  // deve partire lo stesso, e il medico non deve vederla passare
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 });
  check(scen, /Etichette provette/.test(await $wiz(page, ".pwhd").innerText()), "il wizard parte dai link della pagina intermedia");
  await context.close();
}

async function scenarioPrintAutoOnReturn(browser) {
  const scen = "print-auto-return";
  // interstitial WITHOUT links: the handoff must wait and fire when the
  // doctor gets back to the patient page
  const mock = createMock({ labelsInterstitial: true, labelsBare: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  // La pagina intermedia non ha i link. Prima toccava al medico tornare sulla
  // pagina del paziente; ora ci torna il programma, e i fogli si raccolgono lì.
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 });
  check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()),
    `il programma riporta da solo sulla pagina del paziente (got …${page.url().slice(-40)})`);
  await $wiz(page, "#pwnext").click(); // etichette stampate
  await page.waitForTimeout(400);
  await $wiz(page, "#pwnext").click(); // lista stampata
  await page.waitForTimeout(300);
  check(scen, hits(mock, "RcsStampaEtichetteLISHMIMU.do") === 1 && hits(mock, "REPORT=RcsRichiesta&") === 1,
    "al ritorno sulla pagina paziente stampa entrambi i PDF una volta");
  check(scen, (await page.locator("#psassist-print").count()) === 0, "sequenza completata e chiusa");
  await context.close();
}

async function scenarioPrintInlineViewer(browser) {
  const scen = "print-inline-viewer";
  // an etichette endpoint that builds the PDF INLINE → the short sandboxed
  // replay captures it and prints it in-panel (framebuster stays inert)
  const mock = createMock({ seedConfirmed: true, blobViewers: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  await page.waitForFunction(() => Number(document.getElementById("psassist-print")?.dataset.printAttempts || 0) >= 1, { timeout: 25000 });
  check(scen, mock.state.requests.filter((q) => q.url.includes("REPORT=RcsEtichetteLIS")).length >= 1,
    "viewer inline: PDF interno raggiunto e stampato in-pannello");
  check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()), "il framebuster del viewer NON ha dirottato la pagina");
  await $wiz(page, "#pwexit").click();
  await context.close();
}

async function scenarioPrintUploadViewer(browser) {
  const scen = "print-upload-viewer";
  // field-observed: the label .do navigates (by script) to a direct pdf
  // endpoint (uploaddownloadservlet…mimetype=application/pdf) — the URL is
  // harvested from the page and printed in-panel, fully automatic
  const mock = createMock({ seedConfirmed: true, uploadViewer: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  await page.waitForFunction(() => Number(document.getElementById("psassist-print")?.dataset.printAttempts || 0) >= 1, { timeout: 25000 });
  const dl = mock.state.requests.filter((q) => q.url.includes("uploaddownloadservlet") && (q.params.mimetype || "").includes("pdf"));
  check(scen, dl.length === 1, `PDF etichette preso una volta dall'endpoint diretto del visualizzatore (got ${dl.length})`);
  check(scen, /get_pdf\('PSOWEB/.test(decodeURIComponent(dl[0]?.url || "")), "id del report letto dalla pagina, non costruito");
  const junk = mock.state.requests.filter((q) => q.url.includes("uploaddownloadservlet")).length - dl.length;
  check(scen, junk === 0, `nessuna richiesta sprecata su frammenti di URL (got ${junk})`);
  check(scen, (await page.locator("#psassist-print .pwerr").count()) === 0, "nessun ripiego manuale necessario");
  await $wiz(page, "#pwexit").click();
  await context.close();
}

async function scenarioPrintViewerVariants(browser) {
  // Un visualizzatore che NOMINA il PDF nella pagina: si prende da lì.
  {
    const scen = "print-frameset-viewer";
    const mock = createMock({ seedConfirmed: true, framesetViewer: true });
    const { context, page } = await newPage(browser, mock);
    await page.goto(mock.patientUrl);
    await page.waitForSelector("#psassist-host", { state: "attached" });
    await page.locator('#psassist-host [data-print="699999"]').first().click();
    await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
    await page.waitForFunction(() => Number(document.getElementById("psassist-print")?.dataset.printAttempts || 0) >= 1, { timeout: 25000 }).catch(() => {});
    const dl = mock.state.requests.filter((q) => q.url.includes("uploaddownloadservlet") && (q.params.mimetype || "").includes("pdf"));
    check(scen, dl.length === 1, `frameset: PDF preso dal <frame src> (got ${dl.length})`);
    check(scen, (await page.locator("#psassist-print .pwerr").count()) === 0, "stampa automatica, nessun ripiego manuale");
    await context.close();
  }
  // Un visualizzatore che dà solo un ID: l'indirizzo del PDF NON si costruisce
  // a mano. Un id letto male non darebbe un errore, darebbe il documento di un
  // altro paziente. Si apre in una scheda e si stampa da lì.
  {
    const scen = "print-idonly-viewer";
    const mock = createMock({ seedConfirmed: true, idOnlyViewer: true });
    const { context, page } = await newPage(browser, mock);
    await page.goto(mock.patientUrl);
    await page.waitForSelector("#psassist-host", { state: "attached" });
    await page.locator('#psassist-host [data-print="699999"]').first().click();
    await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
    await page.waitForSelector("#psassist-print .pwerr", { timeout: 25000 });
    const inventati = mock.state.requests.filter((q) => q.url.includes("uploaddownloadservlet"));
    check(scen, inventati.length === 0,
      `nessun indirizzo di PDF costruito a mano (got ${inventati.length})`);
    const testo = await page.evaluate(() =>
      document.getElementById("psassist-print").shadowRoot.textContent.replace(/\s+/g, " "));
    check(scen, /Apri/.test(testo),
      `e il medico ha il bottone per aprirlo in una scheda e stamparlo (got: ${testo.slice(0, 80)})`);
    await context.close();
  }
}

async function scenarioPrintMergedFlow(browser) {
  const scen = "print-merged";
  // lab richiesta + radiology richiesta confirmed before getting back to the
  // patient page → ONE print flow: all labels first, then lists, then the
  // radiology booking
  const mock = createMock({ seedConfirmed: true, seedConfirmedRadio: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.evaluate(() => sessionStorage.setItem("psassist:print.v1",
    JSON.stringify({ ids: ["699999", "699998"], episodeId: "999001", ts: Date.now() })));
  await page.reload();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 15000 });
  const heads = [];
  for (let k = 0; k < 3; k++) {
    heads.push((await $wiz(page, ".pwhd").innerText()).split("\n")[0]);
    await $wiz(page, "#pwnext").click();
    await page.waitForTimeout(300);
  }
  check(scen, /1 di 3 — Etichette/.test(heads[0]), `prima le etichette del laboratorio (got: ${heads[0]})`);
  check(scen, /2 di 3 — Lista esami/.test(heads[1]), `poi la lista esami (got: ${heads[1]})`);
  check(scen, /3 di 3 — Prenotazione esterna/.test(heads[2]), `infine la RX, nello stesso flusso (got: ${heads[2]})`);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "un solo wizard per entrambe le richieste");
  await context.close();
}

async function scenarioPrintHardViewer(browser) {
  const scen = "print-hard-viewer";
  // Il visualizzatore che costruisce l'indirizzo del PDF dalla PROPRIA query
  // string. Girando dentro la cornice della replica leggeva la nostra e non
  // trovava niente: si finiva sul ripiego manuale, ed è il caso che il medico
  // ha visto al lavoro. Ora la replica gli dice dov'è — nessun indirizzo
  // inventato, il PDF se lo calcola sempre lui — e la cattura riesce.
  const mock = createMock({ seedConfirmed: true, hardViewer: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print iframe", { timeout: 20000 });
  const st = await page.evaluate(() => {
    const r = document.getElementById("psassist-print").shadowRoot;
    return { src: r.querySelector("iframe")?.getAttribute("src") || "",
             err: r.querySelector(".pwerr")?.textContent || "",
             testa: r.querySelector(".pwhd")?.textContent?.replace(/\s+/g, " ").trim() || "" };
  });
  check(scen, st.src.startsWith("blob:") && !st.err,
    `il visualizzatore che legge il proprio indirizzo ora si lascia catturare (got ${st.src.slice(0, 22)}… ${st.err.slice(0, 40)})`);
  check(scen, /Etichette provette/.test(st.testa), `e sono le etichette (got ${st.testa.slice(0, 40)})`);
  check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()), "la pagina paziente NON è stata dirottata dal framebuster");
  // e nessun indirizzo è stato costruito: quelli che passano dal servlet sono
  // solo quelli che il visualizzatore stesso ha calcolato
  const inventati = mock.state.requests.filter((q) => q.url.includes("uploaddownloadservlet")
    && !q.url.includes("san_report_onthefly"));
  check(scen, inventati.length === 0, `nessun indirizzo ricomposto a mano (got ${inventati.length})`);
  await $wiz(page, "#pwnext").click();
  await page.waitForTimeout(400);
  const head = await $wiz(page, ".pwhd").innerText();
  check(scen, /Lista esami/.test(head), "la sequenza prosegue col foglio esami");
  await $wiz(page, "#pwexit").click();
  await context.close();
}

async function scenarioPrintWrapper(browser) {
  const scen = "print-wrapper";
  const mock = createMock({ seedConfirmed: true, etichetteWrapper: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  await page.waitForTimeout(800);
  check(scen, hits(mock, "REPORT=RcsEtichetteLIS") === 1, "wrapper HTML seguito fino al PDF etichette");
  await $wiz(page, "#pwnext").click();
  await page.waitForTimeout(400);
  check(scen, hits(mock, "REPORT=RcsRichiesta&") === 1, "poi il PDF della lista");
  await $wiz(page, "#pwexit").click();
  await context.close();
}

async function scenarioUiErgonomics(browser) {
  const scen = "ui-ergonomics";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });

  // sticky compact selection bar: grouped plain text + count
  await $panel(page, '.chip.preset:has-text("Epatico")').click();
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  const bar = await $panel(page, ".selbar").innerText();
  check(scen, /POC:/.test(bar) && /URGENZE:/.test(bar) && /6 SELEZIONATI/.test(bar),
    `selbar compatta con gruppi e conteggio (got: ${bar.replace(/\s+/g, " ").slice(0, 80)})`);
  check(scen, (await $panel(page, ".selbar .chip").count()) === 0, "selbar è testo, non pill");

  // hover ✕ removes one exam
  await $panel(page, ".selbar .selitem").first().hover();
  await $panel(page, ".selbar .selx").first().click();
  check(scen, /5 SELEZIONATI/.test(await $panel(page, ".selbar").innerText()), "✕ al passaggio rimuove il singolo esame");

  // selecting must NOT bounce the scroll back to the top
  const posPrima = await page.evaluate(() => {
    const card = document.getElementById("psassist-host").shadowRoot.querySelector(".card");
    card.scrollTop = 180;                    // the browser clamps to what fits
    return card.scrollTop;
  });
  await $panel(page, '.opt[title*="GLUCOSIO"]').click();
  const st = await page.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".card").scrollTop);
  check(scen, posPrima > 40 && Math.abs(st - posPrima) <= 2, `lo scroll resta dov'era dopo la selezione (${st} ≈ ${posPrima})`);

  // drag the header → position saved and restored after reload
  const hd = $panel(page, "#draghd");
  const box = await hd.boundingBox();
  await page.mouse.move(box.x + 60, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + 200, { steps: 5 });
  await page.mouse.up();
  const pos1 = await page.evaluate(() => {
    const w = document.getElementById("psassist-host").shadowRoot.querySelector(".wrap");
    return { left: w.style.left, top: w.style.top };
  });
  check(scen, pos1.left !== "" && pos1.top !== "", `pannello trascinato (got ${pos1.left},${pos1.top})`);
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  const pos2 = await page.evaluate(() => {
    const w = document.getElementById("psassist-host").shadowRoot.querySelector(".wrap");
    return { left: w.style.left, top: w.style.top };
  });
  check(scen, pos2.left === pos1.left && pos2.top === pos1.top, `posizione ricordata dopo reload (got ${pos2.left},${pos2.top})`);
  // double-click header → back to default corner
  await $panel(page, "#draghd").dblclick();
  const pos3 = await page.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".wrap").style.left);
  check(scen, pos3 === "", "doppio click riporta in alto a destra");

  // the two CTAs share one row
  check(scen, (await $panel(page, ".btnrow #go").count()) === 1 && (await $panel(page, ".btnrow #goconfirm").count()) === 1,
    "CTA su una sola riga");

  // no PANNELLO chips anymore; no PCR / old tropo singles; new tropo present
  const optTxt = await page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".opt")].map((c) => c.textContent).join("|"));
  const preTxt = await page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".chip.preset")].map((c) => c.textContent).join("|"));
  check(scen, !/PANNELLO|P1 - |P2 - /.test(optTxt + preTxt), "chips PANNELLO rimossi");
  check(scen, /EMOCROMO POC/.test(optTxt) && !/EMOCROMOCITOMETRICO/.test(optTxt), "emocromo rinominato in EMOCROMO POC");
  check(scen, /\bPCR\b/.test(optTxt) && /LIPASI/.test(optTxt) && /TROPONINA US/.test(optTxt) && !/TROPONINA I POC/.test(optTxt),
    "singoli aggiornati: PCR e lipasi presenti, tropo ultrasensibile al posto della vecchia");
  check(scen, /Coag POC/.test(preTxt) && /Coag/.test(preTxt), "profili rapidi: Coag POC e Coag");
  const optBox = await $panel(page, ".opt").first().boundingBox();
  check(scen, optBox.height <= 34, `righe esame compatte (${Math.round(optBox.height)}px)`);
  await context.close();
}

async function scenarioContinuity(browser) {
  const scen = "continuity";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });

  // build up state, then reload: the EHR refreshes pages all the time and
  // the panel must come back exactly as it was
  await $panel(page, "#q").fill("dolore toracico irradiato");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, (await $panel(page, "#q").inputValue()) === "dolore toracico irradiato", "quesito ripristinato dopo il refresh");
  check(scen, /2 SELEZIONATI/.test(await $panel(page, ".selbar").innerText()), "selezione ripristinata dopo il refresh");

  // run WITHOUT auto-confirm → land with the receipt → the panel's own
  // CONFERMA button presses the native one → wizard on the patient page
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host #confirmnow", { timeout: 30000 });
  check(scen, (await page.locator("#psassist-host .selbar").count()) === 0, "dopo l'ordine la selezione riparte pulita");
  await $panel(page, "#confirmnow").click();
  await page.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 20000 });
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === true, "CONFERMA dal pannello = click nativo, richiesta confermata");
  check(scen, /Etichette provette/.test(await page.locator("#psassist-print .pwhd").innerText()),
    "e la stampa guidata parte da sola");
  await context.close();
}

async function scenarioReferti(browser) {
  const scen = "referti";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host [data-esito]");

  const refs = page.locator('#psassist-host [data-esito][data-kind="referto"]');
  const rows = await refs.allInnerTexts();
  check(scen, rows.length === 3, `3 referti, il link-archivio senza REFERTO_ID è ignorato (got ${rows.length})`);
  check(scen, /22\/08 07:45/.test(rows[0]) && /EMOGASANALISI/.test(rows[0]), `più recente in cima (got: ${rows[0]?.replace(/\s+/g, " ").slice(0, 40)})`);
  check(scen, /↗/.test(rows[0]), "il referto dichiara che si apre in una scheda");
  check(scen, (await page.locator("#psassist-host .rdot.open").count()) === 0, "nessuno ancora aperto");

  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 8000 }),
    refs.first().click(),
  ]);
  // the tab is opened blank and then navigated, so wait for the real URL
  await popup.waitForURL(/Sa4ViewerExtRedirect/, { timeout: 8000 }).catch(() => {});
  check(scen, popup.url().includes("Sa4ViewerExtRedirect") && popup.url().includes("bbbb2222"),
    `apre il referto dal server (got …${popup.url().slice(-28)})`);
  await page.waitForTimeout(200);
  check(scen, (await page.locator("#psassist-host .rdot.open").count()) === 1, "segnato come aperto");

  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host [data-esito]");
  check(scen, (await page.locator("#psassist-host .rdot.open").count()) === 1, "lo stato resiste al refresh");

  const before = context.pages().length, reqBefore = hits(mock, "bbbb2222");
  await refs.first().click();
  await page.waitForTimeout(700);
  check(scen, context.pages().length === before && hits(mock, "bbbb2222") === reqBefore,
    "riclick torna alla scheda già aperta, senza ricaricare");

  await $panel(page, "#refreset").click();
  await page.waitForTimeout(400);
  check(scen, (await page.locator("#psassist-host .rdot.open").count()) === 0, "Resetta azzera lo stato");
  await context.close();
}

async function scenarioLabPlusRx(browser) {
  const scen = "lab+rx";
  // lab and radiology selected together → two richieste, both confirmed, one print flow
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#q").fill("dispnea e dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();   // POC
  await $panel(page, '.opt[title*="RX TORACE ("]').first().click(); // RX
  check(scen, /Crea 2 richieste/.test(await $panel(page, "#go").innerText()), "il bottone annuncia due richieste");
  await $panel(page, "#goconfirm").click();

  // the lab richiesta confirms itself; the RADIOLOGY one never does (README,
  // collaudo 8-9): the panel walks to its exam page and waits for a human
  await page.waitForFunction(() => {
    const f = document.forms.namedItem("Prestazioni");
    return !!f && !!document.querySelector('a[href*="Delete=Elimina"][href*="PRESTAZIONE=35"]');
  }, { timeout: 60000 });
  await page.waitForTimeout(600);
  check(scen, (await page.locator("#psassist-confirm").count()) === 0, "nessun conto alla rovescia sulla radiologia");
  await page.locator('form[name="Prestazioni"] input[name="Update"]').first().click();   // the human confirms the RX
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 60000 });

  const rich = Object.entries(mock.state.richieste);
  check(scen, rich.length === 2, `due richieste create (got ${rich.length})`);
  const lab = rich.find(([, r]) => r.cart.has("324"));
  const rx = rich.find(([, r]) => r.cart.has("35"));
  check(scen, !!lab && !!rx, "una di laboratorio (troponina) e una di radiologia (RX torace)");
  check(scen, lab && lab[1].confirmed && rx && rx[1].confirmed, "entrambe confermate (lab da sola, RX dal click umano)");
  check(scen, lab && lab[1].quesito === "dispnea e dolore toracico" && rx && rx[1].quesito === "dispnea e dolore toracico",
    "stesso quesito su entrambe");

  // one single print flow covering both
  const heads = [];
  for (let k = 0; k < 3; k++) {
    heads.push((await $wiz(page, ".pwhd").innerText()).split("\n")[0]);
    await $wiz(page, "#pwnext").click();
    await page.waitForTimeout(300);
  }
  check(scen, /1 di 3 — Etichette/.test(heads[0]) && /2 di 3 — Lista esami/.test(heads[1]) && /3 di 3 — Prenotazione/.test(heads[2]),
    `un solo flusso: etichette → lista → RX (got ${heads.join(" | ")})`);
  await context.close();
}

async function scenarioLabPlusRxManual(browser) {
  const scen = "lab+rx-manuale";
  // same, without auto-confirm: the panel walks the doctor to the second one
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#q").fill("trauma");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="RX ADDOME"]').first().click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host #confirmnow", { timeout: 60000 });
  await $panel(page, "#confirmnow").click(); // confirm the lab one
  await page.waitForSelector("#psassist-host #goqueued", { timeout: 30000 });
  check(scen, /radiologia/i.test(await $panel(page, "#goqueued").innerText()), "il bottone dice che manca la radiologia");
  await $panel(page, "#goqueued").click();
  await page.waitForSelector("#psassist-host #confirmnow", { timeout: 30000 });
  await $panel(page, "#confirmnow").click(); // confirm the radiology one
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 });
  const rich = Object.values(mock.state.richieste);
  check(scen, rich.length === 2 && rich.every((r) => r.confirmed), "entrambe le richieste confermate a mano");
  check(scen, (await page.locator("#psassist-host #goqueued").count()) === 0, "l'avviso sparisce quando non manca più nulla");
  await context.close();
}

async function scenarioRisultati(browser) {
  const scen = "risultati";
  const mock = createMock({ withResults: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host .sec", { timeout: 15000 });
  // I prelievi non sono più righe da aprire: sono le colonne di UNA tabella,
  // e finché non li si chiede la tabella non c'è.
  check(scen, (await page.locator('#psassist-host [data-esito][data-kind="valori"]').count()) === 0,
    "i prelievi non sono più righe da aprire");
  check(scen, (await page.locator("#psassist-host .sttab").count()) === 0, "e all'arrivo non c'è nessuna tabella");
  check(scen, /2 prelievi ancora da leggere/.test(await $panel(page, ".sec").first().innerText()),
    "la schermata dice quanti prelievi ci sono da leggere");

  // I valori non si leggono da soli: si chiedono. È il bottone che li carica.
  await $panel(page, "#risall").click();
  await attendiTabella(page, 2);
  const lbl = (await $panel(page, ".sec .lbl").first().innerText()).replace(/\s+/g, " ");
  check(scen, /valori \(4 esami · 2 prelievi\)/i.test(lbl), `l'intestazione conta esami e prelievi (got: ${lbl.slice(0, 40)})`);

  const tab = await page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    const testa = [...r.querySelectorAll(".sttab thead th")].slice(1);
    const righe = [...r.querySelectorAll(".sttab tbody tr:not(.stsez)")].map((tr) => ({
      nome: tr.cells[0].firstChild.textContent.trim(),
      grezza: tr.cells[0].classList.contains("grezza"),
      celle: [...tr.cells].slice(1).map((c) => ({ t: c.textContent.trim(), fuori: c.classList.contains("fuori") })),
    }));
    return {
      colonne: testa.map((th) => ({ titolo: th.getAttribute("title"), ultima: th.classList.contains("ultima") })),
      righe,
    };
  });
  // il più recente a SINISTRA, ogni colonna con la sua richiesta nel tooltip
  check(scen, tab.colonne.length === 2 && tab.colonne[0].ultima && !tab.colonne[1].ultima,
    "due colonne, e la prima è marcata come l'ultimo prelievo");
  check(scen, /^23\/08\/2026 07:28 · EMOCROMOCITOMETRICO URGENTE/.test(tab.colonne[0].titolo || "")
    && /^22\/08\/2026 22:23 · PT, EMOCROMOCITOMETRICO URGENTE/.test(tab.colonne[1].titolo || ""),
    `il più recente a sinistra, con data, ora e richiesta (got: ${tab.colonne.map((c) => c.titolo).join(" | ").slice(0, 70)})`);
  // nomi in sigla, e OGNI analita una riga sola: i due prelievi si leggono per
  // confronto sulla stessa riga, non due elenchi da rimettere in ordine
  check(scen, tab.righe.length === 4, `tutti i valori, compreso quello dal nome sconosciuto (got ${tab.righe.length})`);
  check(scen, tab.righe.map((r) => r.nome).join(",") === "GB,Hb,Ht,Ricerca sangue occulto",
    `nomi in sigla, per esteso solo quelli non in elenco (got: ${tab.righe.map((r) => r.nome).join(",")})`);
  const hb = tab.righe.find((r) => r.nome === "Hb");
  check(scen, hb && hb.celle.length === 2 && /^80↓/.test(hb.celle[0].t) && /^95↓/.test(hb.celle[1].t),
    `l'emoglobina è UNA riga con i due prelievi (got: ${hb ? hb.celle.map((c) => c.t).join(" | ") : "nessuna"})`);
  // solo il fuori range è segnalato, e solo dove è fuori
  const fuori = tab.righe.filter((r) => r.celle.some((c) => c.fuori)).map((r) => r.nome);
  check(scen, fuori.join(",") === "Hb", `solo il fuori range è segnalato (got: ${fuori.join(",") || "nessuno"})`);
  const rosso = await page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    const cella = r.querySelector(".sttab td.fuori");
    return { nome: getComputedStyle(cella.closest("tr").cells[0]).color, val: getComputedStyle(cella).color };
  });
  check(scen, /179, 38, 30/.test(rosso.val) && !/179, 38, 30/.test(rosso.nome), `in rosso c'è solo il valore (${rosso.val} vs ${rosso.nome})`);

  // copy the whole table for the diario, with the names spelled out
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await $panel(page, "#storcopy").click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /^Esame\t23\/08\/2026 07:28\t22\/08\/2026 22:23/.test(clip),
    `la copia parte dalle colonne, in ordine (got: ${clip.split("\n")[0]})`);
  check(scen, /Emoglobina\t80 \(basso\)\t95 \(basso\)/.test(clip),
    `coi nomi per esteso e il fuori range scritto (got: ${(clip.split("\n").find((l) => /Emoglobina/.test(l)) || "").slice(0, 60)})`);

  // un tocco su un valore lo segna (giallo, poi arancio, poi via), e il segno
  // resta col paziente: dopo un ricaricamento della pagina è ancora lì
  const cella = page.locator("#psassist-host .sttab td[data-cella]").first();
  const segno = async () => ((await cella.getAttribute("class")) || "").split(/\s+/).find((c) => /^seg\d$/.test(c)) || "nessuno";
  await cella.click();
  const primo = await segno();
  await cella.click();
  const secondo = await segno();
  await cella.click();
  const terzo = await segno();
  check(scen, primo === "seg1" && secondo === "seg2" && terzo === "nessuno", `un tocco giallo, due arancio, tre via (${primo} → ${secondo} → ${terzo})`);
  await cella.click();
  const quale = await cella.getAttribute("data-cella");
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host .sttab", { timeout: 10000 });
  check(scen, (await page.locator(`#psassist-host .sttab td[data-cella="${quale}"].seg1`).count()) === 1,
    "e il segno sopravvive al ricaricamento della pagina");
  await context.close();
}

async function scenarioResizeAndLog(browser) {
  const scen = "resize+log";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });

  // --- resize from the bottom-left grip ---
  const w0 = (await $panel(page, ".card").boundingBox()).width;
  const g = await $panel(page, "#rsz").boundingBox();
  await page.mouse.move(g.x + 6, g.y + 6);
  await page.mouse.down();
  await page.mouse.move(g.x - 120, g.y + 80, { steps: 6 });
  await page.mouse.up();
  const w1 = (await $panel(page, ".card").boundingBox()).width;
  check(scen, w1 > w0 + 80, `trascinando si allarga (${Math.round(w0)} → ${Math.round(w1)} px)`);
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  const w2 = (await $panel(page, ".card").boundingBox()).width;
  check(scen, Math.abs(w2 - w1) < 3, `la misura resta dopo il refresh (${Math.round(w2)} px)`);
  await $panel(page, "#rsz").dblclick();
  const w3 = (await $panel(page, ".card").boundingBox()).width;
  check(scen, Math.abs(w3 - w0) < 3, "doppio click torna alla misura originale");

  // --- copy the log, with the quesito masked ---
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host #confirmnow", { timeout: 30000 });
  // the Registro now lives behind the version button, on the Pazienti screen
  await $panel(page, "#back").click();
  await page.waitForSelector("#psassist-host #verbtn");
  await $panel(page, "#verbtn").click();
  await page.waitForSelector("#psassist-host #copylog");
  await $panel(page, "#copylog").click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /PS Assist \d+\.\d+\.\d+ · pagina/.test(clip), "il registro copiato ha versione e pagina");
  check(scen, /aggiunto ✓/.test(clip), "contiene le righe del registro");
  check(scen, !/dolore toracico/.test(clip), "il quesito NON finisce negli appunti");
  check(scen, /✓ copiato/.test(await $panel(page, "#copylog").innerText()), "il bottone conferma la copia");
  await context.close();
}

async function scenarioHomePills(browser) {
  const scen = "home";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  // visit patient A, then a second episode: both become pills
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, (await $panel(page, "#q").count()) === 1, "su una pagina paziente si apre su Richieste, non sull'elenco");

  await page.goto(mock.patientUrl.replace("999001", "999002"));
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#back").click(); // to Home
  const cards = await page.locator("#psassist-host .pcard").allInnerTexts();
  check(scen, cards.length === 2, `due pazienti conosciuti (got ${cards.length})`);
  check(scen, /qui/i.test(cards[0]), "il paziente della pagina è marcato «qui» ed è il primo");
  check(scen, /min fa|adesso|alle/.test(cards[1]), `gli altri mostrano quando (got: ${cards[1]?.replace(/\s+/g, " ").slice(0, 40)})`);

  // picking another patient LOADS HIS PAGE (never shows his data from here)
  // the card itself is the button, and it opens the Esiti
  await page.locator("#psassist-host .pcard:not(.now)").click();
  await page.waitForFunction(() => /EPISODIO_ID=999001/.test(location.href), { timeout: 15000 });
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, /999001/.test(await $panel(page, ".hd .sub").innerText()), "siamo sulla pagina di quel paziente");
  check(scen, (await $panel(page, '[data-seg="esiti"].on').count()) === 1, "e si apre proprio sulla sezione scelta");

  // the panel never carries another patient's selection across
  check(scen, (await page.locator("#psassist-host .selbar").count()) === 0, "nessuna selezione trascinata da un paziente all'altro");
  await context.close();
}

async function scenarioAggiornaTutti(browser) {
  const scen = "aggiorna-tutti";
  const mock = createMock({ withResults: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  // I valori non si leggono da soli: si chiedono. È il bottone che li carica.
  check(scen, /⭳ Carica i valori/.test(await $panel(page, "#risall").innerText()),
    "prima di leggere niente il bottone invita a caricare");
  await $panel(page, "#risall").click();
  await attendiTabella(page, 2);
  check(scen, /↻ Aggiorna/.test(await $panel(page, "#risall").innerText()),
    "letti i prelievi, lo stesso bottone diventa «↻ Aggiorna»");
  const prima = hits(mock, "RcsAccessiRisultatiElenco");
  // the lab has updated a value since the prefetch
  mock.state.hbNuova = "92";
  await $panel(page, "#risall").click();
  await attendiTabella(page, 2, 20000);
  check(scen, hits(mock, "RcsAccessiRisultatiElenco") === prima + 2, "rilegge ogni prelievo aperto, una volta ciascuno");
  // il valore nuovo è nella colonna del prelievo giusto, quella più recente
  const hb = await page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    const tr = [...r.querySelectorAll(".sttab tbody tr:not(.stsez)")]
      .find((x) => x.cells[0].firstChild.textContent.trim() === "Hb");
    return tr ? [...tr.cells].slice(1).map((c) => c.textContent.trim()) : [];
  });
  check(scen, /^92↓/.test(hb[0] || "") && /^95↓/.test(hb[1] || ""),
    `la tabella mostra il valore nuovo nella colonna dell'ultimo prelievo (got: ${hb.join(" | ")})`);
  const reg = await page.evaluate(() => JSON.parse(sessionStorage.getItem("psassist:log.999001") || "{}").lines?.join("\n") || "");
  check(scen, /aggiornati 2 prelievi, 1 con valori nuovi/.test(reg), "il Registro dice quanti sono cambiati");
  await context.close();
}

async function scenarioNuoviValori(browser) {
  const scen = "nuovi-valori";
  const mock = createMock({ withResults: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  // I valori non si leggono da soli: si chiedono. È il bottone che li carica.
  await $panel(page, "#risall").click();
  await attendiTabella(page, 2);
  check(scen, (await page.locator("#psassist-host .sttab td.nuovo, #psassist-host .sttab td.agg").count()) === 0,
    "alla prima lettura nulla è «nuovo»: quella lettura È il riferimento");
  check(scen, (await page.locator("#psassist-host .newbar").count()) === 0, "e non c'è niente da annunciare");

  // the laboratory completes the panel: one value moves, one analyte appears
  mock.state.hbNuova = "92";
  mock.state.extraRow = { nome: "Sodio", valore: "128", um: "mmol/L", range: "136 - 145" };
  await $panel(page, "#risall").click();
  await page.waitForFunction(
    () => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".sttab td.nuovo, .sttab td.agg").length === 2,
    { timeout: 20000 },
  );
  await attendiTabella(page, 2, 20000);
  check(scen, /2 valori nuovi dall'ultima lettura/.test(await $panel(page, ".newbar").innerText()),
    "la striscia annuncia quanti sono");
  const marcate = await page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    const sigla = (td) => td.closest("tr").cells[0].firstChild.textContent.trim();
    const dove = (td) => [...td.closest("tr").cells].indexOf(td);
    return { nuovo: [...r.querySelectorAll(".sttab td.nuovo")].map((td) => [sigla(td), td.textContent.trim(), dove(td)]),
             agg: [...r.querySelectorAll(".sttab td.agg")].map((td) => [sigla(td), td.textContent.trim(), dove(td)]) };
  });
  check(scen, marcate.nuovo.length === 1 && marcate.nuovo[0][0] === "Na" && /^128↓/.test(marcate.nuovo[0][1]),
    `l'analita comparso è marcato «nuovo» (got: ${JSON.stringify(marcate.nuovo)})`);
  check(scen, marcate.agg.length === 1 && marcate.agg[0][0] === "Hb" && /^92↓/.test(marcate.agg[0][1]),
    `il valore cambiato è marcato «aggiornato», e i due marchi restano distinti (got: ${JSON.stringify(marcate.agg)})`);
  check(scen, marcate.nuovo[0][2] === 1 && marcate.agg[0][2] === 1,
    "e i marchi stanno nella colonna del prelievo riletto, non sugli altri");
  // il rosso non si perde per strada: la novità viaggia su un canale suo
  check(scen, (await page.locator("#psassist-host .sttab td.agg.fuori, #psassist-host .sttab td.nuovo.fuori").count()) === 2,
    "un valore nuovo fuori range resta anche fuori range");

  // «Letto»: da qui in poi le novità si contano da adesso, per tutti i prelievi
  await $panel(page, "#letto").click();
  await page.waitForTimeout(300);
  check(scen, (await page.locator("#psassist-host .sttab td.nuovo, #psassist-host .sttab td.agg").count()) === 0,
    "«Letto» spegne i marchi: sono stati visti");
  check(scen, (await page.locator("#psassist-host .newbar").count()) === 0, "e la striscia sparisce con loro");
  check(scen, (await page.locator("#psassist-host .sttab tbody tr:not(.stsez)").count()) === 5,
    "i valori restano tutti in tabella: si spegne il marchio, non la riga");
  await context.close();
}

async function scenarioRefertoTesto(browser) {
  const scen = "referto-testo";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host [data-esito]", { timeout: 15000 });

  // the radiology row announces it opens INSIDE the panel, the lab one does not
  const rx = page.locator('#psassist-host [data-esito][data-kind="referto"]', { hasText: "TC ENCEFALO" });
  check(scen, /›/.test(await rx.innerText()), "il referto RIS si apre nel pannello");
  const lis = page.locator('#psassist-host [data-esito][data-kind="referto"]', { hasText: "EMOGASANALISI" });
  check(scen, /Apri referto/.test(await lis.innerText()), "quello di laboratorio resta un documento da aprire");

  await rx.click();
  await page.waitForSelector("#psassist-host .reftxt .rt", { timeout: 20000 });
  const testo = await $panel(page, ".reftxt").innerText();
  check(scen, /RADIOGRAFIA TORACE 2 PROIEZIONI/.test(testo), "il titolo dell'esame è nel testo");
  check(scen, /Non focolai a carattere broncopneumonico/.test(testo), `il corpo del referto, parola per parola (got: ${testo.replace(/\s+/g, " ").slice(0, 60)})`);
  check(scen, !/\u0000/.test(testo), "nessun byte di codifica lasciato a vista");

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await $panel(page, "#copytxt").click();
  await page.waitForTimeout(250);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /Ombra cardiaca nei limiti/.test(clip), "si copia per il diario");

  // and the PDF is always one tap away
  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 8000 }).catch(() => null),
    $panel(page, "#apripdf").click(),
  ]);
  check(scen, !!popup, "il PDF resta a un tocco di distanza");
  await $panel(page, "#back").click();
  await page.waitForSelector("#psassist-host [data-esito]", { timeout: 8000 });
  check(scen, (await page.locator("#psassist-host [data-esito]").count()) > 0, "‹ torna agli esiti");
  await context.close();
}

// Un nome che il pannello non conosce, e una riga che non sa leggere, devono
// diventare un avviso: mai un buco che il medico scopre da solo.
async function scenarioNomiInattesi(browser) {
  const scen = "nomi-inattesi";
  const mock = createMock({ withResults: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host .sec", { timeout: 10000 });
  await $panel(page, "#risall").click();
  await attendiTabella(page, 2);

  const avviso = await $panel(page, ".avvnomi").innerText().catch(() => "");
  check(scen, /nome non in elenco|nomi non in elenco/.test(avviso), `avvisa dei nomi che non conosce (got: ${avviso})`);
  // La finestra Risultati ha una riga che il programma non sa leggere
  // («Aspetto del campione = limpido»): viaggia con la tabella, e l'avviso
  // la conta — un buco che il medico non deve scoprire da solo.
  check(scen, /riga non letta|righe non lette/.test(avviso), `e delle righe che non ha letto (got: ${avviso})`);

  // il nome sconosciuto è scritto per esteso, non abbreviato a caso
  const tabella = await $panel(page, ".sttab").innerText();
  check(scen, /Ricerca sangue occulto/.test(tabella) && !/^Ricerca$/m.test(tabella),
    "un nome non in elenco è scritto per esteso, non ridotto a un'ipotesi");
  check(scen, /POSITIVO/.test(tabella), "e il suo valore c'è");
  check(scen, (await page.locator("#psassist-host .sttab th.stn.grezza").count()) === 1,
    "ed è marcato come non riconosciuto");

  // «quali» mostra esattamente cosa è rimasto fuori
  await $panel(page, "#avvnomi").click();
  await page.waitForTimeout(200);
  const elenco = await $panel(page, ".avvlista").innerText();
  check(scen, /Non in elenco: Ricerca sangue occulto/.test(elenco.replace(/\s+/g, " ")),
    `il nome non in elenco è mostrato per esteso (got: ${elenco.replace(/\n/g, " · ").slice(0, 90)})`);
  check(scen, /Aspetto del campione/.test(elenco) && /limpido/.test(elenco),
    `la riga non letta è mostrata con nome e valore (got: ${elenco.replace(/\n/g, " · ").slice(0, 90)})`);

  // e i valori conosciuti non vengono toccati
  check(scen, /\bHb\b/.test(tabella) && /\bGB\b/.test(tabella), "gli esami noti restano con la loro sigla");
  await context.close();
}

// Il cronometro tiene l'ISTANTE DI INIZIO, non i secondi passati: ricaricare
// la pagina non deve azzerare niente, e il paziente registrato dev'essere un
// paziente vero — non il titolo della lista del reparto.
async function scenarioTempi(browser) {
  const scen = "tempi";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#tapri").click();
  await page.waitForSelector("#psassist-host .tpre", { timeout: 8000 });
  await $panel(page, '[data-avvia="Visita ed esami"]').click();
  await page.waitForSelector("#psassist-host .tbig", { timeout: 8000 });
  check(scen, /0m/.test(await $panel(page, ".tbig").innerText()), "il cronometro parte con un tocco");

  // il tempo continua a correre attraverso un ricarico della pagina
  await page.evaluate(() => {
    const k = "psassist:tempi.v1";
    const l = JSON.parse(localStorage.getItem(k));
    l[l.length - 1].inizio -= 5 * 60 * 1000;   // come se fosse partito 5 minuti fa
    localStorage.setItem(k, JSON.stringify(l));
  });
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.waitForTimeout(600);
  const chip = await $panel(page, ".tchip.on").innerText();
  check(scen, /5m/.test(chip), `dopo il ricarico il conto è giusto, non azzerato (got ${chip.replace(/\s+/g, " ")})`);

  await $panel(page, "#tstop").click();
  await page.waitForTimeout(400);
  await $panel(page, "#tapri").click();
  await page.waitForSelector("#psassist-host .trow", { timeout: 8000 });
  const riga = (await $panel(page, ".trow").first().innerText()).replace(/\s+/g, " ");
  check(scen, /Visita ed esami/.test(riga) && /5m/.test(riga), `fermandolo resta durata e titolo (got ${riga})`);
  check(scen, /ROSSI MARIO/.test(riga), "e il paziente su cui stavi");
  check(scen, (await $panel(page, ".tchip.off").count()) === 1, "e il cronometro torna spento");
  await context.close();
}

// Dopo una corsa fallita su una pagina esami, il carrello sullo SCHERMO è
// quello di prima: gli inserimenti sono partiti in background e la pagina non
// si è mai ricaricata. Rilanciare non deve reinserire quello che c'è già —
// sarebbe un esame ordinato due volte a un paziente vero.
async function scenarioRilancioPaginaEsami(browser) {
  const scen = "rilancio-esami";
  const mock = createMock({ neverAdd: ["159"] });   // la PCT non entra mai: la corsa fallisce
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.click('a[title="Richieste Laboratorio"]');
  await page.fill('form[name="RICHIESTACrea"] textarea[name="QUESITO_DIAGNOSTICO"]', "controllo");
  await page.click('form[name="RICHIESTACrea"] input[name="Update"]');
  await page.waitForSelector('form[name="Prestazioni"]', { timeout: 20000 });
  await page.waitForSelector("#psassist-host", { state: "attached" });

  const banner = () => page.waitForFunction(() => !!document.getElementById("psassist-host")
    ?.shadowRoot?.querySelector(".banner.ok, .banner.err"), { timeout: 30000 }).catch(() => {});
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  await banner();

  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.insertCount[`${rid}:320`] === 1,
    `la prima corsa manda un inserimento (got ${mock.state.insertCount[`${rid}:320`]})`);
  check(scen, (await $panel(page, ".banner.err").count()) === 1, "e fallisce sull'esame che non entra");

  // «Torna al pannello»: la selezione resta, la pagina NON si è ricaricata
  await $panel(page, "#reset").click();
  await page.waitForSelector("#psassist-host #go", { timeout: 8000 });
  await $panel(page, "#go").click();
  await banner();
  check(scen, mock.state.insertCount[`${rid}:320`] === 1,
    `rilanciando NON lo ordina una seconda volta (got ${mock.state.insertCount[`${rid}:320`]})`);
  const reg = await $panel(page, ".bd").innerText();
  check(scen, /già nel carrello/i.test(reg), `lo ritrova nel carrello rileggendolo dal server (got ${reg.slice(0, 80).replace(/\s+/g, " ")})`);
  await context.close();
}

// Tutta la sicurezza del pannello sulle stringhe che arrivano dal gestionale
// sta nel ricordarsi di chiamare esc(). Nessun test lo verificava: un esc()
// dimenticato sarebbe passato in silenzio.
async function scenarioNomeConHtml(browser) {
  const scen = "html-nel-nome";
  const CATTIVO = 'ROSSI <img src=x onerror="window.__bucato=1"> "MARIO" & Co';
  const mock = createMock({ name: CATTIVO });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.waitForTimeout(400);

  const bucato = await page.evaluate(() => !!window.__bucato);
  check(scen, !bucato, "un nome col markup dentro non esegue niente");
  const img = await page.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll("img").length);
  check(scen, img === 0, `e non diventa un elemento (got ${img} img nel pannello)`);
  const testo = await $panel(page, ".hd").innerText();
  check(scen, testo.includes('"MARIO"') && testo.includes("&"),
    `si legge esattamente com'è scritto (got ${testo.replace(/\s+/g, " ").slice(0, 70)})`);
  await context.close();
}

// Il laboratorio affianca al vecchio esame la sua versione «- NEW» e lascia in
// elenco tutti e due. Chi ordina vuole sempre il nuovo. La scelta si fa
// sull'elenco VIVO della pagina, non sul catalogo: i codici nuovi cambiano da
// una sede all'altra, e in una sede il catalogo non li ha mai visti.
async function scenarioEmogasNew(browser) {
  const scen = "emogas-new";
  const mock = createMock({ nuoveVersioni: { 3: "325", 166: "326" } });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#q").fill("dispnea");
  await $panel(page, '.opt[title*="EMOGASANALISI VENOSA"]').click();
  await $panel(page, "#go").click();
  await page.waitForFunction(() => !!document.getElementById("psassist-host")
    ?.shadowRoot?.querySelector(".banner.ok, .banner.err"), { timeout: 30000 }).catch(() => {});

  const rid = Object.keys(mock.state.richieste)[0];
  const carrello = [...mock.state.richieste[rid].cart.keys()];
  check(scen, carrello.includes("325") && !carrello.includes("3"),
    `al server va la versione NEW, non la vecchia (got ${carrello})`);
  check(scen, mock.state.insertCount[`${rid}:3`] === undefined,
    "e la vecchia non viene nemmeno tentata");
  const reg = await $panel(page, ".card").innerText();
  check(scen, /versione nuova/i.test(reg), `il Registro dice che ha cambiato (got ${(/[^.]*versione nuova[^.]*/i.exec(reg) || [])[0] || "niente"})`);

  // e dove la versione nuova NON c'è, si ordina la vecchia senza storie
  const m2 = createMock({});
  const { context: c2, page: p2 } = await newPage(browser, m2);
  await p2.goto(m2.patientUrl);
  await p2.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(p2, "#q").fill("dispnea");
  await $panel(p2, '.opt[title*="EMOGASANALISI VENOSA"]').click();
  await $panel(p2, "#go").click();
  await p2.waitForFunction(() => !!document.getElementById("psassist-host")
    ?.shadowRoot?.querySelector(".banner.ok, .banner.err"), { timeout: 30000 }).catch(() => {});
  const rid2 = Object.keys(m2.state.richieste)[0];
  check(scen, [...m2.state.richieste[rid2].cart.keys()].includes("3"),
    `senza versione nuova ordina la vecchia (got ${[...m2.state.richieste[rid2].cart.keys()]})`);
  await c2.close();
  await context.close();
}

async function scenarioEo(browser) {
  const scen = "eo";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  // due righe: sopra quello che agisce sul paziente, sotto i modelli
  check(scen, (await page.locator("#psassist-host .seg button").count()) === 2,
    "la riga del paziente ha Richieste ed Esiti");
  const modelli = await page.locator("#psassist-host .seg2 button").allInnerTexts();
  check(scen, modelli.join("|") === "Dimissioni|Consensi|EO",
    `i modelli stanno su un rigo loro (got ${modelli.join("|")})`);
  await $panel(page, '[data-seg="eo"]').click();
  await page.waitForSelector("#psassist-host [data-eocopy=\"base\"]", { timeout: 10000 });

  // un tocco: l'EO generale è negli appunti, per intero
  await $panel(page, '[data-eocopy="base"]').click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /^Vigile, orientato, eupnoico/.test(clip), "l'EO generale si copia con un tocco");
  check(scen, /Cute: integra, non lesioni, non esantemi\.$/.test(clip.trim()), "fino all'ultima riga");

  // la tendina ha i casi e le frasi, e sceglierne uno copia subito
  const opzioni = await page.locator("#psassist-host #eocaso option").allInnerTexts();
  check(scen, opzioni.length === 14, `una voce vuota, nove casi e quattro frasi (got ${opzioni.length})`);
  await $panel(page, "#eocaso").selectOption("caso:vertigine");
  await page.waitForTimeout(300);
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /^Nistagmo \[assente\/orizzontale/.test(clip2) && /skew deviation assente/.test(clip2),
    "scegliere un caso lo copia da sé");
  check(scen, !/Vigile, orientato/.test(clip2), "e copia solo l'aggiunta, non l'EO generale");
  const mostrato = await $panel(page, "#eotxt").innerText();
  check(scen, /HINTS: head impulse/.test(mostrato), "il testo scelto resta scritto sotto la tendina");

  // ⧉ ricopia lo stesso testo senza dover riscegliere
  await page.evaluate(() => navigator.clipboard.writeText("svuotato"));
  await $panel(page, "#eoricopia").click();
  await page.waitForTimeout(300);
  const clip3 = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /skew deviation assente/.test(clip3), "⧉ ricopia lo stesso testo");

  // la scelta sopravvive a un cambio di schermata
  await $panel(page, '[data-seg="esiti"]').click();
  await $panel(page, '[data-seg="eo"]').click();
  await page.waitForSelector("#psassist-host #eotxt", { timeout: 8000 });
  const ancora = await $panel(page, "#eotxt").innerText();
  check(scen, /HINTS: head impulse/.test(ancora), "e resta scelto tornando sulla scheda");

  // i modelli non sono dati di nessuno: nessun nome di paziente in giro
  const testo = await $panel(page, ".sec").innerText();
  check(scen, !/ROSSI|MARIO/.test(testo), "nessun dato di paziente in questa schermata");
  await context.close();
}

async function scenarioDimissioni(browser) {
  const scen = "dimissioni";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="dimissioni"]').click();
  await page.waitForSelector("#psassist-host .drow", { timeout: 10000 });

  const righe = await page.locator("#psassist-host .drow").count();
  check(scen, righe === 9, `nove fogli di dimissione (got ${righe})`);
  // i rivisti in cima, poi una riga che separa gli altri
  const ordine = await page.locator("#psassist-host .dnome").allInnerTexts();
  check(scen, /Gastrite/.test(ordine[0] || ""), `i fogli rivisti vengono per primi (got ${ordine[0]})`);
  check(scen, (await page.locator("#psassist-host .dsep").count()) === 1,
    "e una riga separa quelli non ancora rivisti");
  const testoLista = await $panel(page, ".dlist").innerText();
  check(scen, /Colica renale/.test(testoLista) && !/paracetamolo/i.test(testoLista),
    "la lista mostra le patologie, mai il testo");

  // copy puts the whole sheet in the clipboard
  await page.locator('#psassist-host [data-dcopy="colica-renale"]').click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /COLICA RENALE/.test(clip) && /Ketoprofene sale di lisina/.test(clip), "⧉ copia il foglio intero");
  check(scen, /Tamsulosina 0,4 mg/.test(clip), "col testo aggiornato dal medico");
  check(scen, /non sostituiscono il medico curante/.test(clip), "con la frase di chiusura standard");

  // edit, save, and the change survives a page reload
  await page.locator('#psassist-host [data-dedit="artrosi"]').click();
  await page.waitForSelector("#psassist-host #dimarea", { timeout: 8000 });
  await page.evaluate(() => {
    const t = document.getElementById("psassist-host").shadowRoot.querySelector("#dimarea");
    t.value = "ARTROSI — testo mio\nRiga di prova.";
  });
  await $panel(page, "#dimsave").click();
  await page.waitForSelector("#psassist-host .drow", { timeout: 8000 });
  check(scen, (await page.locator("#psassist-host .dmod").count()) === 1, "il foglio modificato è marcato");
  const conferma = await $panel(page, ".bd").innerText();
  check(scen, /salvato/.test(conferma), "Salva lo dice, invece di tornare muto alla lista");
  // ...and that banner must NOT follow the doctor onto the ordering screen
  await $panel(page, '[data-seg="richieste"]').click();
  await page.waitForTimeout(200);
  check(scen, !/salvato: sarà questo il testo/.test(await $panel(page, ".bd").innerText()),
    "la conferma resta sulla sua schermata, non compare sopra Crea");
  await $panel(page, '[data-seg="dimissioni"]').click();
  await page.waitForSelector("#psassist-host .drow", { timeout: 8000 });
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="dimissioni"]').click();
  await page.waitForSelector("#psassist-host .drow", { timeout: 10000 });
  await page.locator('#psassist-host [data-dcopy="artrosi"]').click();
  await page.waitForTimeout(300);
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /testo mio/.test(clip2), "la modifica resta dopo il cambio pagina");

  // the export carries every sheet, edited ones included
  await $panel(page, "#dimexport").click();
  await page.waitForTimeout(400);
  const json = await page.evaluate(() => navigator.clipboard.readText());
  let dati = null;
  try { dati = JSON.parse(json); } catch { /* checked below */ }
  check(scen, !!dati && Object.keys(dati.dimissioni || {}).length === 9, "⬇ JSON esporta tutti i fogli");
  check(scen, !!dati && /testo mio/.test(dati.dimissioni.artrosi.testo), "compresa la mia versione");

  // back to the original
  await page.waitForSelector('#psassist-host [data-dedit="artrosi"]', { timeout: 8000 });
  await page.locator('#psassist-host [data-dedit="artrosi"]').click({ force: true });
  await page.waitForSelector("#psassist-host #dimreset", { timeout: 8000 });
  await $panel(page, "#dimreset").click();          // one tap only asks
  await page.waitForTimeout(150);
  check(scen, /Confermi/.test(await $panel(page, "#dimreset").innerText()),
    "↺ Originale chiede conferma prima di buttare il testo del medico");
  check(scen, await $panel(page, "#dimarea").isVisible(), "e intanto non ha cancellato niente");
  await $panel(page, "#dimreset").click();          // the second confirms
  await page.waitForTimeout(300);
  await page.locator('#psassist-host [data-dcopy="artrosi"]').click();
  await page.waitForTimeout(300);
  const clip3 = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /ARTROSI IN FASE DOLOROSA/.test(clip3), "↺ riporta al testo originale");

  // a discharge sheet is a template, not patient data: the login wipe leaves it
  await page.goto(`${mock.ORIGIN}${mock.PATH}?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=999001&expire=1`);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("psassist:dimissioni.v1") || "{}");
    s.artrosi = { nome: "Artrosi", testo: "mio testo dopo il logout" };
    localStorage.setItem("psassist:dimissioni.v1", JSON.stringify(s));
  });
  const rimasto = await page.evaluate(() => localStorage.getItem("psassist:dimissioni.v1"));
  check(scen, /mio testo dopo il logout/.test(rimasto || ""), "i fogli non sono dati del paziente: restano");

  // an edited sheet remembers WHICH original it forked from: when a release
  // corrects a dose, the doctor who edited that sheet has to be told
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.evaluate(() => {
    localStorage.setItem("psassist:dimissioni.v1", JSON.stringify({
      cistite: { nome: "Cistite non complicata", testo: "mia versione", base: "originale-di-ieri" },
    }));
  });
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="dimissioni"]').click();
  await page.waitForSelector("#psassist-host .drow", { timeout: 10000 });
  check(scen, (await page.locator("#psassist-host .dmod.agg").count()) === 1,
    "il foglio la cui versione originale è cambiata è segnalato");
  await page.locator('#psassist-host [data-dedit="cistite"]').click();
  await page.waitForSelector("#psassist-host #dimarea", { timeout: 8000 });
  check(scen, /originale di questo foglio è stato aggiornato/i.test(await $panel(page, ".bd").innerText()),
    "e l'editor lo spiega");

  // a blank sheet is never saved as if it were a text
  await page.evaluate(() => {
    document.getElementById("psassist-host").shadowRoot.querySelector("#dimarea").value = "   ";
  });
  await $panel(page, "#dimsave").click();
  await page.waitForTimeout(200);
  check(scen, /vuoto/.test(await $panel(page, ".bd").innerText()) && await $panel(page, "#dimarea").isVisible(),
    "un testo vuoto viene rifiutato, non salvato");

  // tap ✎, get called away, come back: the text is still there
  await page.evaluate(() => {
    const t = document.getElementById("psassist-host").shadowRoot.querySelector("#dimarea");
    t.value = "sto ancora scrivendo questo foglio";
    t.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForTimeout(200);
  await $panel(page, '[data-seg="dimissioni"]').click();
  await page.waitForSelector("#psassist-host .drow", { timeout: 8000 });
  await page.locator('#psassist-host [data-dedit="cistite"]').click();
  await page.waitForSelector("#psassist-host #dimarea", { timeout: 8000 });
  check(scen, /sto ancora scrivendo/.test(await $panel(page, "#dimarea").inputValue()),
    "quello che stavo scrivendo mi aspetta al ritorno");
  check(scen, /Bozza non salvata/.test(await $panel(page, ".bd").innerText()), "e il pannello dice che è una bozza");

  // import: a paste screen, and only the texts that really differ get in
  await $panel(page, "#back").click();
  await page.waitForSelector("#psassist-host .drow", { timeout: 8000 });
  await $panel(page, "#dimimport").click();
  await page.waitForSelector("#psassist-host #dimimparea", { timeout: 8000 });
  await page.evaluate(() => {
    // written by hand: an object literal cannot carry an own "__proto__" key
    document.getElementById("psassist-host").shadowRoot.querySelector("#dimimparea").value = `{"dimissioni":{
      "lombalgia": {"nome":"Lombalgia acuta","testo":"LOMBALGIA - la mia versione importata"},
      "colica-renale": {"nome":"Colica renale","testo":"   "},
      "__proto__": {"nome":"x","testo":"veleno"}
    }}`;
  });
  await $panel(page, "#dimimpok").click();
  await page.waitForSelector("#psassist-host .drow", { timeout: 8000 });
  check(scen, /Importato 1 foglio/.test(await $panel(page, ".bd").innerText()), "l'import conta solo ciò che entra davvero");
  const dopoImport = await page.evaluate(() => JSON.parse(localStorage.getItem("psassist:dimissioni.v1") || "{}"));
  check(scen, !!dopoImport.lombalgia && /la mia versione importata/.test(dopoImport.lombalgia.testo),
    "il testo importato è quello che viene copiato");
  check(scen, !Object.prototype.hasOwnProperty.call(dopoImport, "__proto__"),
    "una chiave __proto__ nel JSON non viene scritta");
  check(scen, Object.keys(dopoImport).length === 2, "i fogli identici all'originale non diventano miei");
  check(scen, await page.evaluate(() => ({}).veleno === undefined), "e il prototipo della pagina resta intatto");
  await context.close();
}

async function scenarioValoriRefertati(browser) {
  const scen = "valori-refertati";
  // Before: the draw is still open, its values can be read.
  const prima = createMock({ withResults: true });
  const { context, page } = await newPage(browser, prima);
  await page.goto(prima.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  // both draws must be read before the laboratory reports, or there is nothing to keep
  // I valori non si leggono da soli: si chiedono. È il bottone che li carica.
  await $panel(page, "#risall").click();
  await attendiTabella(page, 2);
  const testeprima = await page.evaluate(() =>
    [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".sttab thead th")].slice(1)
      .map((th) => th.getAttribute("title")));
  check(scen, testeprima.length === 2, `i due prelievi sono le colonne della tabella (got ${testeprima.length})`);

  // After: the laboratory reports and the LIS takes the window away.
  const dopo = createMock({});                     // stesso episodio, niente icona Risultati
  await context.unroute("https://smarthealth.multimedica.it/**");
  await context.route("https://smarthealth.multimedica.it/**", async (route) => {
    const req = route.request();
    let out = dopo.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
    let hops = 0;
    while (out.status === 302 && hops++ < 5) out = dopo.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
    await route.fulfill({ status: out.status, headers: out.headers, body: out.body });
  });
  const chiamate = dopo.state.requests.length;
  await page.goto(dopo.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host .sttab", { timeout: 20000 });

  const tab = await page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    const tr = [...r.querySelectorAll(".sttab tbody tr:not(.stsez)")]
      .find((x) => x.cells[0].firstChild.textContent.trim() === "Hb");
    return { teste: [...r.querySelectorAll(".sttab thead th")].slice(1).map((th) => th.getAttribute("title")),
             righe: r.querySelectorAll(".sttab tbody tr:not(.stsez)").length,
             hb: tr ? [...tr.cells].slice(1).map((c) => c.textContent.trim()) : [],
             risall: r.querySelectorAll("#risall").length };
  });
  // la finestra Risultati non c'è più: quei prelievi restano COLONNE, coi
  // loro valori e la loro ora — sono nostri, li abbiamo letti noi
  check(scen, tab.teste.length === 2 && tab.teste.join("|") === testeprima.join("|"),
    `i prelievi già letti restano colonne della tabella (got ${tab.teste.join(" | ")})`);
  check(scen, tab.righe === 4, `con tutti i loro valori (got ${tab.righe} analiti)`);
  check(scen, /^80↓/.test(tab.hb[0] || "") && /^95↓/.test(tab.hb[1] || ""),
    `la tabella li mostra ancora (got: ${tab.hb.join(" | ") || "niente"})`);
  // niente più da leggere: non c'è nemmeno il bottone per rileggerli
  check(scen, tab.risall === 0, "e non c'è più niente da caricare: quelle finestre non rispondono più");
  check(scen, dopo.state.requests.length === chiamate + 1, "senza rileggere dal server: solo la pagina del paziente");
  await context.close();
}

async function scenarioNoPatientPage(browser) {
  const scen = "no-patient";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  // come from that patient's page, where the ordering screen was in use: the
  // worklist carries HIS episode in the row links and must not inherit it
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host #q", { state: "attached" });
  await $panel(page, "#q").fill("controllo");
  await page.goto(mock.worklistUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, (await page.locator("#psassist-host .opt").count()) === 0, "nessun esame sulla pagina PS senza paziente");
  check(scen, (await page.locator("#psassist-host .chip.preset").count()) === 0, "nessun profilo rapido");
  check(scen, (await page.locator("#psassist-host #q, #psassist-host #acq, #psassist-host #go").count()) === 0,
    "niente quesito, ricerca o bottoni di invio");
  check(scen, /pazienti/i.test(await $panel(page, ".bd").innerText()), "mostra invece l'elenco pazienti");
  check(scen, /pazienti/i.test(await $panel(page, ".hd .who").innerText()), "intestazione: elenco pazienti, non un nome");
  // i modelli non appartengono a un paziente: la loro riga c'è anche qui,
  // dove un paziente non c'è
  check(scen, (await page.locator("#psassist-host .seg2 button").count()) === 3,
    "la riga dei modelli c'è anche senza paziente");
  check(scen, (await page.locator("#psassist-host .seg button").count()) === 0,
    "quella del paziente no");
  await context.close();
}

async function scenarioPatientTitle(browser) {
  const scen = "patient-title";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, (await $panel(page, ".hd .who").innerText()).trim() === "ROSSI MARIO", "il titolo è il nome del paziente");
  check(scen, /999001/.test(await $panel(page, ".hd .sub").innerText()), "l'episodio resta sempre in intestazione");
  await $panel(page, "#collapse").click();
  const pill = await $panel(page, ".pill").innerText();
  check(scen, /ROSSI MARIO/.test(pill) && !/PS Assist/.test(pill), `anche da minimizzato mostra il paziente (got: ${pill.trim()})`);
  await context.close();
}

async function scenarioRxSingles(browser) {
  const scen = "rx-singles";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  const rx = await page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".opt .nm")]
    .map((o) => o.textContent).filter((t) => /^RX/.test(t)));
  check(scen, rx.length === 3, `solo 3 esami RX tra i singoli (got ${rx.length}: ${rx})`);
  check(scen, rx.some((t) => /RX TORACE$/.test(t)) && rx.some((t) => /1 PROIEZ/.test(t)) && rx.some((t) => /ADDOME/.test(t)),
    "torace, torace 1 proiezione e addome");
  // and they really order on a radiology richiesta
  await $panel(page, "#q").fill("sospetta polmonite");
  await $panel(page, '.opt[title*="RX TORACE ("]').first().click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host .banner.ok, #psassist-host .banner.err", { timeout: 30000 });
  const r = Object.values(mock.state.richieste)[0];
  check(scen, r && r.cart.has("35"), `RX torace ordinato dalla pagina paziente (cart ${r && [...r.cart.keys()]})`);
  await context.close();
}

async function scenarioStopButton(browser) {
  const scen = "stop";
  const mock = createMock({ lagRenders: { 320: 99 } }); // verify loop gives time to press stop
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#go").click();
  await page.waitForSelector("#psassist-host .btn.stop", { timeout: 10000 });
  await $panel(page, ".btn.stop").click();
  await page.waitForSelector("#psassist-host .banner.warn", { timeout: 10000 });
  await page.waitForTimeout(2000);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, (mock.state.insertCount[`${rid}:222`] || 0) === 0, "dopo STOP niente nuovi invii");
  await shot(page, scen);
  await context.close();
}

// -------------------------------------------------------------------- main
const browser = await (async () => {
  try { return await chromium.launch(); }
  catch { return await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }
})();

const scenarios = [
  ["happy path (PRG)", (b) => scenarioHappyLab(b)],
  ["happy path (direct render)", (b) => scenarioHappyLab(b, { directRender: true })],
  ["auto-confirm handoff", scenarioAutoConfirm],
  ["altro presidio: risorse e codici diversi", scenarioAltroPresidio],
  ["risorsa sconosciuta: stop diagnostico", scenarioPresidioSconosciuto],
  ["cornice vietata dal server: si torna alla pagina", scenarioCorniceVietata],
  ["auto-confirm bloccata su carrello diverso", scenarioAutoConfirmMismatch],
  ["auto-confirm bloccata senza ricevuta", scenarioAutoConfirmSenzaRicevuta],
  ["auto-confirm bloccata da un avanzo su un'altra risorsa", scenarioAutoConfirmAltraRisorsa],
  ["conferma fallita sul server: niente stampa", scenarioConfirmPostFails],
  ["delayed cart visibility", scenarioLagVerify],
  ["lost add → hard stop", scenarioNeverVisible],
  ["renamed code → refuse before send", scenarioLabelMismatch],
  ["session expiry", scenarioSessionExpiry],
  ["episode swap mid-run", scenarioEpisodeSwap],
  ["expiry on the insert itself", scenarioExpiryOnInsert],
  ["prefilled quesito kept", scenarioPrefilledQuesito],
  ["manual add on exam page", scenarioExamPageManual],
  ["wrong resource refused", scenarioWrongResourceRefused],
  ["missing quesito refused", scenarioMissingQuesito],
  ["radiology learning loop", scenarioRadiologyLearning],
  ["print wizard manual", scenarioPrintManual],
  ["print multi-lab rows (PROG split)", scenarioPrintMultiLab],
  ["print radiology prenotazione", scenarioPrintRadio],
  ["print merged lab+RX flow", scenarioPrintMergedFlow],
  ["print auto on patient page (default)", scenarioPrintAutoOnPatient],
  ["print auto on interstitial page", scenarioPrintAutoInterstitial],
  ["print auto waits for patient return", scenarioPrintAutoOnReturn],
  ["print etichette html wrapper", scenarioPrintWrapper],
  ["print inline viewer captured", scenarioPrintInlineViewer],
  ["print upload-servlet viewer (field URL)", scenarioPrintUploadViewer],
  ["print viewer variants (frameset / id-only)", scenarioPrintViewerVariants],
  ["print hard viewer → tab fallback", scenarioPrintHardViewer],
  ["ui ergonomics (selbar/drag/scroll)", scenarioUiErgonomics],
  ["continuity + panel confirm button", scenarioContinuity],
  ["referti tabs + reset", scenarioReferti],
  ["rx singles (torace/addome)", scenarioRxSingles],
  ["lab + rx: two richieste, one flow", scenarioLabPlusRx],
  ["lab + rx manual walk", scenarioLabPlusRxManual],
  ["valori: una tabella, una colonna per prelievo", scenarioRisultati],
  ["↻ Aggiorna rilegge tutti i prelievi", scenarioAggiornaTutti],
  ["valori nuovi e aggiornati dopo il refresh", scenarioNuoviValori],
  ["referto RX letto come testo", scenarioRefertoTesto],
  ["nomi inattesi e righe non lette", scenarioNomiInattesi],
  ["cronometro: parte, sopravvive al cambio pagina, si ferma", scenarioTempi],
  ["fogli di dimissione: copia, modifica, export", scenarioDimissioni],
  ["EO: copia il generale, la tendina copia il caso", scenarioEo],
  ["rilancio su pagina esami: nessun doppio ordine", scenarioRilancioPaginaEsami],
  ["un nome col markup dentro non rompe il pannello", scenarioNomeConHtml],
  ["emogas: sceglie sempre la versione NEW", scenarioEmogasNew],
  ["prelievi refertati: restano colonne della tabella", scenarioValoriRefertati],
  ["resize + copy log", scenarioResizeAndLog],
  ["home: patient pills", scenarioHomePills],
  ["no-patient page has no exams", scenarioNoPatientPage],
  ["panel titled by patient", scenarioPatientTitle],
  ["stop button", scenarioStopButton],
];

for (const [name, fn] of scenarios) {
  const t0 = Date.now();
  try {
    await fn(browser);
    console.log(`● ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failures++;
    console.log(`✗ ${name} — ${e.message}`);
    results.push(`  ✗ [${name}] scenario error: ${e.message}`);
  }
}
await browser.close();

console.log("\n" + results.join("\n"));
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
