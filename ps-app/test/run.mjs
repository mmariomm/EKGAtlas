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
    // Playwright can't fulfill 302s for fetch() subresources, so the harness
    // follows redirects itself (the engine never depends on response.url).
    let hops = 0;
    while (out.status === 302 && hops++ < 5) {
      out = mock.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
    }
    await route.fulfill({ status: out.status, headers: out.headers, body: out.body });
  });
  // Fail on any request that tries to leave the hospital origin.
  context.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("https://smarthealth.multimedica.it/") && !u.startsWith("data:") && !u.startsWith("about:")) {
      failures++; results.push(`  ✗ [net] request left the origin: ${u}`);
    }
  });
  const page = await context.newPage();
  const inject = async () => { try { await page.addScriptTag({ path: CONTENT }); } catch { /* navigation race */ } };
  page.on("load", inject);
  return { context, page, inject };
}

const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`); // pierces open shadow DOM

async function selectExams(page, labels) {
  // open the full-catalog browser and tick by label text
  await $panel(page, "#browse summary").click();
  for (const { res, text } of labels) {
    await $panel(page, "#pickres").selectOption(res);
    await $panel(page, "#filter").fill(text);
    await $panel(page, `.list label:has-text("${text}") input`).first().check();
    await $panel(page, "#filter").fill("");
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
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
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
  check(scen, /6 esami nel carrello, tutti verificati/.test(receipt), `ricevuta verde con conteggio pieno (got: ${receipt.slice(0, 60)})`);
  check(scen, /1 in POC/.test(receipt) && /5 in Urgenze \(questa pagina\)/.test(receipt), "ricevuta spiega la ripartizione per risorsa");
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
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
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
  await $panel(page, '.chip[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 20000 });
  // countdown banner appears, then the native Conferma is clicked
  await page.waitForSelector("text=Stampa etichette LIS", { timeout: 15000 });
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === true, "richiesta confermata dopo il countdown");
  const confirmPost = mock.state.requests.find((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
  check(scen, confirmPost && confirmPost.form.MVPG === "RcsStampaEtichetteLIS", "POST Conferma con MVPG etichette (click nativo)");
  await context.close();
}

async function scenarioAutoConfirmCancel(browser) {
  const scen = "confirm-cancel";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.chip[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 20000 });
  await page.waitForSelector("#cancel", { timeout: 8000 }); // countdown visible
  await page.keyboard.press("Escape"); // Esc must cancel the countdown
  await page.waitForTimeout(6500);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === false, "annulla ferma la conferma automatica");
  // reload: the flag was consumed, no new countdown
  await page.reload();
  await page.waitForTimeout(1500);
  check(scen, (await page.locator("#cancel").count()) === 0, "dopo reload nessun nuovo countdown (flag consumato)");
  check(scen, mock.state.richieste[rid].confirmed === false, "ancora non confermata dopo reload");
  await context.close();
}

async function scenarioLagVerify(browser) {
  const scen = "lag-verify";
  // the DEL row for 320 stays hidden for the first 2 list renders after the add
  const mock = createMock({ lagRenders: { 320: 2 } });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
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
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.chip[title*="PROCALCITONINA"]').click();
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
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
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
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.chip[title*="PROCALCITONINA"]').click();
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
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
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
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
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
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.chip[title*="PROCALCITONINA"]').click();
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
  // MANUAL native Conferma must also arm the print handoff
  await page.click('form[name="Prestazioni"] input[name="Update"]');
  await page.waitForSelector("text=Stampa etichette LIS", { timeout: 20000 });
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const wh = await page.locator("#psassist-print .pwhd").innerText();
  check(scen, /Etichette provette/.test(wh), "conferma manuale → wizard di stampa automatico");
  await context.close();
}

async function scenarioWrongResourceRefused(browser) {
  const scen = "wrong-res";
  const mock = createMock({ prefilledQuesito: "x" });
  const { context, page } = await newPage(browser, mock);
  // radiology crea page + a POC exam selected → refused LIVE, before any click
  await page.goto(`${mock.ORIGIN}${mock.PATH}?MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=999001&ASSISTITO_ID=*TEST00001&STRUTTURA=1&RISORSA_ID=${RES.RX}&RISORSE=${RES.RX},${RES.ECO},${RES.RMN},${RES.TAC}&PADIGLIONE=&toPage=RcsRichiestaPrestazioniRicercaErogatore&returnPage=PsoEpisodio`);
  const before = mock.state.requests.length;
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
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
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
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
  await selectExams(page, [{ res: RES.RX, text: "RX TORACE" }]);
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

async function scenarioPrintAutoOnLabels(browser) {
  const scen = "print-auto-labels";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.chip[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await page.waitForSelector("text=Stampa etichette LIS", { timeout: 25000 }); // countdown → native confirm
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const head = await $wiz(page, ".pwhd").innerText();
  check(scen, /Etichette provette/.test(head), "wizard si apre da solo sulla pagina etichette");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "Esc chiude il wizard");
  await page.reload();
  await page.waitForTimeout(1800);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "flag consumato: al reload non riparte");
  await context.close();
}

async function scenarioPrintAutoOnReturn(browser) {
  const scen = "print-auto-return";
  // the post-confirm page has NO print links here: the handoff must wait and
  // fire when the doctor gets back to the patient page
  const mock = createMock({ labelsBare: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.chip[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await page.waitForSelector("text=Stampa etichette LIS", { timeout: 25000 });
  await page.waitForTimeout(1800);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "nessun wizard dove mancano i link");
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  await $wiz(page, "#pwnext").click(); // etichette stampate
  await page.waitForTimeout(400);
  await $wiz(page, "#pwnext").click(); // lista stampata
  await page.waitForTimeout(300);
  check(scen, hits(mock, "RcsStampaEtichetteLISHMIMU.do") === 1 && hits(mock, "REPORT=RcsRichiesta&") === 1,
    "al ritorno sulla pagina paziente stampa entrambi i PDF una volta");
  check(scen, (await page.locator("#psassist-print").count()) === 0, "sequenza completata e chiusa");
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

async function scenarioStopButton(browser) {
  const scen = "stop";
  const mock = createMock({ lagRenders: { 320: 99 } }); // verify loop gives time to press stop
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.chip[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.chip[title*="TROPONINA"]').click();
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
  ["auto-confirm cancel", scenarioAutoConfirmCancel],
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
  ["print auto on labels page", scenarioPrintAutoOnLabels],
  ["print auto on patient return", scenarioPrintAutoOnReturn],
  ["print etichette html wrapper", scenarioPrintWrapper],
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
