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
  await $panel(page, "#goconfirm").click();
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 20000 });
  // countdown, native Conferma click, then (field-observed) back to the patient page
  await page.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 15000 });
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
  await $panel(page, '.opt[title*="TROPONINA"]').click();
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
  await page.waitForSelector("text=Stampa etichette LIS", { timeout: 30000 });
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  check(scen, /Etichette provette/.test(await $wiz(page, ".pwhd").innerText()), "wizard parte sulla pagina intermedia con i link");
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
  await page.waitForSelector("text=Stampa etichette LIS", { timeout: 30000 });
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
  for (const [scen, opt, why] of [
    ["print-frameset-viewer", "framesetViewer", "frameset: PDF preso dal <frame src>"],
    ["print-idonly-viewer", "idOnlyViewer", "solo id report in pagina: URL ricomposto e PDF preso"],
  ]) {
    const mock = createMock({ seedConfirmed: true, [opt]: true });
    const { context, page } = await newPage(browser, mock);
    await page.goto(mock.patientUrl);
    await page.waitForSelector("#psassist-host", { state: "attached" });
    await page.locator('#psassist-host [data-print="699999"]').first().click();
    await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
    await page.waitForFunction(() => Number(document.getElementById("psassist-print")?.dataset.printAttempts || 0) >= 1, { timeout: 25000 }).catch(() => {});
    const dl = mock.state.requests.filter((q) => q.url.includes("uploaddownloadservlet") && (q.params.mimetype || "").includes("pdf"));
    check(scen, dl.length === 1, `${why} (got ${dl.length})`);
    check(scen, (await page.locator("#psassist-print .pwerr").count()) === 0, "stampa automatica, nessun ripiego manuale");
    await context.close();
  }
}

async function scenarioPrintHardViewer(browser) {
  const scen = "print-hard-viewer";
  // a viewer that can't be replayed off its real URL → the wizard must fall
  // back to opening it in a new tab (Ctrl+P), never hang, never hijack
  const mock = createMock({ seedConfirmed: true, hardViewer: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  // harvest fails (viewer can't be replayed off-URL) → the fallback state (pwerr) appears
  await page.waitForSelector("#psassist-print .pwerr", { timeout: 15000 });
  const hint = await $wiz(page, ".pwhint").innerText().catch(() => "");
  check(scen, /Ctrl\+P/.test(hint) && /etichettatrice/.test(hint), `guida chiara al ripiego manuale (got: ${hint.slice(0, 70)})`);
  check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()), "la pagina paziente NON è stata dirottata dal framebuster");
  // clicking the button (user activation) opens the viewer tab — not popup-blocked
  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 8000 }),
    $wiz(page, "#pwtab").click(),
  ]);
  check(scen, popup.url().includes("RcsStampaEtichetteLISHMIMU.do"), `il bottone apre le etichette in una scheda (got …${popup.url().slice(-40)})`);
  // sequence still advances to the exam-list job
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
  await page.evaluate(() => {
    const card = document.getElementById("psassist-host").shadowRoot.querySelector(".card");
    card.scrollTop = 180;
  });
  await $panel(page, '.opt[title*="GLUCOSIO"]').click();
  const st = await page.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".card").scrollTop);
  check(scen, st > 100, `lo scroll resta dov'era dopo la selezione (got ${st})`);

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

  const rows = await page.locator("#psassist-host .rrow").allInnerTexts();
  check(scen, rows.length === 3, `3 referti listati, il link-archivio senza REFERTO_ID è ignorato (got ${rows.length})`);
  check(scen, /22\/08 07:45/.test(rows[0]) && /EMOGASANALISI/.test(rows[0]), `ordinati per data/ora: primo = il più recente (got: ${rows[0]?.slice(0, 50)})`);
  check(scen, /21\/08 22:10/.test(rows[2] || ""), `ultimo = il più vecchio (got: ${rows[2]?.slice(0, 40)})`);
  check(scen, (await page.locator("#psassist-host .rdot.on").count()) === 0, "all'inizio nessun referto è segnato come aperto");

  // first click opens it in its own named tab
  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 8000 }),
    page.locator("#psassist-host .rrow").first().click(),
  ]);
  check(scen, popup.url().includes("Sa4ViewerExtRedirect") && popup.url().includes("bbbb2222"),
    `apre il referto dal server (got …${popup.url().slice(-30)})`);
  await page.waitForTimeout(200);
  check(scen, (await page.locator("#psassist-host .rdot.on").count()) === 1, "il referto aperto è marcato ●");

  // the marker survives the EHR's constant page reloads
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, (await page.locator("#psassist-host .rdot.on").count()) === 1, "lo stato ● resiste al refresh della pagina");

  // second click reuses the SAME tab (no new popup, no reload of the viewer)
  const before = context.pages().length;
  const reqBefore = hits(mock, "bbbb2222");
  await page.locator("#psassist-host .rrow").first().click();
  await page.waitForTimeout(700);
  check(scen, context.pages().length === before, `riclick non apre una nuova scheda (${before} schede)`);
  check(scen, hits(mock, "bbbb2222") === reqBefore, "riclick non ricarica il referto dal server: è già pronto");

  // reset closes the tabs and clears the state
  await page.locator("#psassist-host #refreset").click();
  await page.waitForTimeout(500);
  check(scen, (await page.locator("#psassist-host .rdot.on").count()) === 0, "Resetta azzera lo stato");
  check(scen, (await page.locator("#psassist-host #refreset").count()) === 0, "il bottone Resetta sparisce quando non serve");
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
  ["print multi-lab rows (PROG split)", scenarioPrintMultiLab],
  ["print radiology prenotazione", scenarioPrintRadio],
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
