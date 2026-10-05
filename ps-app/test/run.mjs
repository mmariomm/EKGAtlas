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
import { createMock, RES, OSG } from "./sa4pso-mock.mjs";
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

// Aperto, il pannello è una finestra all'85% dello schermo che copre il
// gestionale. Qui i test cliccano ANCHE la pagina vera: la finestra parte
// come colonna a destra (i test della finestra la rimettono al centro).
const COLONNA = { x: 0.6, y: 0.01, w: 0.39, h: 0.97 };
async function colonna(context) {
  await context.addInitScript((g) => {
    try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify(g)); } catch { /* niente */ }
  }, COLONNA);
}
// Una pagina a cui il medico arriva dal gestionale apre il pannello ridotto
// (la pill). Nei test si arriva con page.goto: si fa come se ci avesse
// portato il pannello, così parte aperto — tranne dove si prova proprio la pill.
async function apertoDalPannello(context) {
  await context.addInitScript(() => {
    try { sessionStorage.setItem("psassist:navPannello.v1", JSON.stringify(Date.now())); } catch { /* niente */ }
  });
}
// Copiato un testo da incollare nel gestionale, la finestra si riduce da
// sola alla pill («✓ Copiato · incolla»): per andare avanti si riapre.
async function riapriDopoCopia(page) {
  await page.waitForSelector("#psassist-host #expand", { state: "attached", timeout: 3000 });
  const t = await page.locator("#psassist-host #expand").innerText();
  await page.locator("#psassist-host #expand").click();
  await page.waitForSelector("#psassist-host .card", { state: "attached", timeout: 3000 });
  return /Copiato/.test(t);
}
// il Registro sta nel menu «⋯» dell'intestazione
async function registro(page) {
  await page.locator("#psassist-host #menubtn").click();
  await page.locator("#psassist-host #verbtn").click();
}
// …e nella scheda del browser: si legge senza aprire niente
const registroDi = (page, ep = "999001") => page.evaluate((e) =>
  (JSON.parse(sessionStorage.getItem("psassist:log." + e) || "{}").lines || []).join("\n"), ep);

// Un giro in sottofondo non apre mai la finestra da solo: dalla spedizione
// alle etichette parla la striscia nell'angolo. Si aspetta che dica una certa
// cosa, e se ne restituisce il testo.
async function striscia(page, re, timeout = 30000) {
  const h = await page.waitForFunction((src) => {
    const t = (document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run")?.innerText || "").replace(/\s+/g, " ").trim();
    return new RegExp(src).test(t) ? t : false;
  }, re.source, { timeout });
  return h.jsonValue();
}
// un tocco sulla striscia apre il pannello: la ricevuta, o il resoconto dell'errore
async function apriStriscia(page) {
  await page.locator("#psassist-host .pill.run").click();
  await page.waitForSelector("#psassist-host .card", { timeout: 5000 });
}
// Revisione: finito il giro si atterra sul carrello come striscia
// («Conferma dal gestionale»), non come finestra.
async function atterraCarrello(page, timeout = 30000) {
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout });
  return striscia(page, /Conferma dal gestionale/, timeout);
}
// Errore in sottofondo: striscia rossa «completa a mano», e — se la richiesta
// c'è — la scheda sul carrello (URL atteso in `su`).
async function errore(page, { su = /RcsRichiestaPrestazioniRicercaErogatore/, timeout = 30000 } = {}) {
  if (su) await page.waitForURL(su, { timeout });
  return striscia(page, /Errore · completa a mano|Sessione scaduta/, timeout);
}
async function newPage(browser, mock, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (opts.finestra !== "centro") await colonna(context);
  if (!opts.pill) await apertoDalPannello(context);
  await context.route("https://smarthealth.multimedica.it/**", async (route) => {
    const req = route.request();
    // opts.ritardo(url) → ms: una risposta lenta è l'unico modo per navigare
    // MENTRE il motore sta mandando qualcosa
    const attesa = opts.ritardo ? opts.ritardo(req.url(), req) : 0;
    if (attesa) await new Promise((r) => setTimeout(r, attesa));
    let out = mock.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
    // Playwright drops fulfilled redirects out of interception (they'd hit
    // the real network), so the harness follows them itself for every
    // request; tests therefore wait on page CONTENT, never on the URL.
    let hops = 0;
    while (out.status === 302 && hops++ < 5) {
      out = mock.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
    }
    // opts.riscrivi(url, html) → html: il server che si comporta in modo
    // strano (un elenco monco, un nome cambiato) si simula QUI, riscrivendo la
    // risposta, senza toccare il mock
    if (opts.riscrivi && /html/.test(out.headers["content-type"] || "")) {
      const html = Buffer.from(out.body).toString("latin1");
      out = { ...out, body: Buffer.from(opts.riscrivi(req.url(), html), "latin1") };
    }
    // (una risposta lenta può arrivare quando la pagina — o la cornice — non c'è più)
    try { await route.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* andata */ }
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

// Il pannello si apre sugli ESITI: aprire un paziente vuol dire quasi sempre
// guardare. Per ordinare si passa da Richieste — un tocco, come fa il medico.
async function richieste(page) {
  const q = page.locator("#psassist-host #q");
  if (!(await q.count())) await page.locator('#psassist-host [data-seg="richieste"]').click();
  await q.waitFor({ timeout: 10000 });
}

async function selectExams(page, labels) {
  // one-line catalog search + dropdown
  for (const { text } of labels) {
    await $panel(page, "#acq").fill(text);
    await $panel(page, `.acitem:has-text("${text}")`).first().click();
    await $panel(page, "#acq").fill("");
  }
}

// Gli Esiti non mostrano più i referti di laboratorio (la tabella dei Valori
// dice già tutto). Il banco ne ha due (LIS) e uno di radiologia (RIS): per
// provare i documenti «da aprire» — né laboratorio né radiologia — uno dei due
// LIS si traveste da consulenza (stesso id, un altro sistema). Il mock non si
// tocca: si cambia la pagina mentre passa.
function conPagina(mock, cambia) {   // le pagine HTML del mock passano da qui (il corpo è win1252: si legge come latin1)
  const h = mock.handle;
  mock.handle = (req) => {
    const out = h(req);
    return Buffer.isBuffer(out.body) && /html/.test(out.headers["content-type"] || "")
      ? { ...out, body: Buffer.from(cambia(out.body.toString("latin1")), "latin1") }
      : out;
  };
  return mock;
}
const conConsulenza = (mock) => conPagina(mock, (html) =>
  html.replace(/REFERTO_SISTEMA=HL7LIS(&REFERTO_ID=bbbb2222)/g, "REFERTO_SISTEMA=HL7CONS$1"));

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
  await richieste(page);

  await $panel(page, "#q").fill("Sospetta colangite acuta — età ≥80");
  // preset chip: Epatico (5 URGENZE exams) + one POC single via chip
  await $panel(page, '.chip.preset:has-text("Epatico")').click();
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await shot(page, scen + "-idle");
  await $panel(page, "#go").click();
  await shot(page, scen + "-running");

  // revisione: si atterra sul carrello come striscia, la finestra non si apre da sola
  const arrivo = await atterraCarrello(page, 20000);
  check(scen, /6 esami in carrello/.test(arrivo) && /Conferma dal gestionale/.test(arrivo),
    `sul carrello la striscia dice quanti e cosa fare (got: ${arrivo})`);
  check(scen, (await $panel(page, ".card").count()) === 0, "e la finestra resta chiusa");

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
  // — un tocco sulla striscia lo apre, con la ricevuta
  await apriStriscia(page);
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
  await richieste(page);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  // la richiesta c'è: si finisce sul suo carrello, con la striscia rossa
  await errore(page);
  await apriStriscia(page);
  const banner = await $panel(page, ".banner.err").innerText();
  check(scen, /oggi si chiama/.test(banner) && /TEST COAGULATIVO/.test(banner), `spiega il cambio nome (got: ${banner.slice(0, 90)})`);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, !mock.state.insertCount[`${rid}:320`], "NESSUN invio per l'esame rinominato");
  await context.close();
}

// Che cosa ha mostrato il pannello mentre il giro andava in sottofondo: i
// testi della striscia, uno per cambio, e quante volte si è vista la finestra.
// E la stampa: quante volte qualcosa di grande copriva la pagina MENTRE un PDF
// arrivava (`inCarico`: dev'essere zero) e quante la scheda col PDF in
// anteprima (`anteprima`). Sta nella scheda, così sopravvive al
// ricaricamento della pagina.
async function registraStriscia(context) {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    setInterval(() => {
      try {
        const K = "__psaTest";
        const s = JSON.parse(sessionStorage.getItem(K) || '{"testi":[],"finestra":0,"inCarico":0,"anteprima":0}');
        const r = document.getElementById("psassist-host")?.shadowRoot;
        const t = (r?.querySelector(".pill.run")?.innerText || "").replace(/\s+/g, " ").trim();
        if (t && s.testi[s.testi.length - 1] !== t) s.testi.push(t);
        if (r?.querySelector(".card")) s.finestra++;
        const w = document.getElementById("psassist-print");
        if (w) {
          const area = innerWidth * innerHeight;
          const grande = [...w.shadowRoot.querySelectorAll("*")]
            .some((e) => { if (e.tagName === "STYLE") return false; const b = e.getBoundingClientRect(); return b.width * b.height >= area * 0.25; });
          if (grande && w.dataset.stato === "carico") s.inCarico++;
          const f = w.shadowRoot.querySelector(".pw:not([hidden]) .pwbody iframe");
          if (grande && f && f.getBoundingClientRect().height >= 200) s.anteprima++;
        }
        sessionStorage.setItem(K, JSON.stringify(s));
      } catch { /* niente */ }
    }, 20);
  });
}
const azzeraRegistrato = (page) => page.evaluate(() => sessionStorage.setItem("__psaTest", JSON.stringify({ testi: [], finestra: 0, inCarico: 0, anteprima: 0 })));
const registrato = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("__psaTest") || '{"testi":[],"finestra":0,"inCarico":0,"anteprima":0}'));
// Arrivato il PDF, la scheda di sempre: il PDF in anteprima, a vista, sotto la
// testata col documento e la stampante su cui va. Restituisce la testata
// («Stampa 1 di 2 — Etichette provette → etichettatrice»), o "" se non c'è.
const anteprima = (page) => page.evaluate(() => {
  const r = document.getElementById("psassist-print")?.shadowRoot;
  const pw = r?.querySelector(".pw:not([hidden])");
  const f = pw?.querySelector(".pwbody iframe");
  if (!f || !r.querySelector(".back:not([hidden])")) return "";
  const b = f.getBoundingClientRect();
  if (b.width < 300 || b.height < 200 || !/^blob:/.test(f.getAttribute("src") || "")) return "";
  return `${pw.querySelector(".pwhd b")?.textContent || ""} ${pw.querySelector(".pwhd .dest")?.textContent || ""}`;
});
const attendiAnteprima = (page, timeout = 15000) => page.waitForFunction(() => {
  const r = document.getElementById("psassist-print")?.shadowRoot;
  return !!r?.querySelector(".pw:not([hidden]) .pwbody iframe");
}, null, { timeout });
// mentre il PDF arriva: niente scheda, niente velo
const nienteDavanti = (page) => page.evaluate(() => {
  const r = document.getElementById("psassist-print")?.shadowRoot;
  return !r || (!r.querySelector(".pw:not([hidden])") && !r.querySelector(".back:not([hidden])"));
});
// le risposte lente servono a VEDERE ogni passo nella striscia
const lentiStampa = (u) => (/RcsStampaEtichetteLISHMIMU|jasperservlet/.test(u) ? 450 : /ccsForm=Prestazioni/.test(u) ? 300 : 0);

// Il giro in sottofondo con la conferma: dalla spedizione alle etichette la
// finestra NON si apre mai. Parla la striscia — «Confermo…», «Confermata»,
// «Aspetto le etichette…», «Stampo le etichette», e alla fine il resoconto
// che RESTA: «Stampato · 2 esami confermati 14:32». Mentre un PDF arriva non
// c'è niente davanti alla pagina; arrivato, la scheda lo mostra in anteprima
// con la stampante su cui va, e da lì si apre il dialogo di stampa.
async function scenarioAutoConfirm(browser) {
  const scen = "autoconfirm";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock, { ritardo: lentiStampa });
  await registraStriscia(context);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  const eraQui = page.url();
  await $panel(page, "#goconfirm").click();
  await azzeraRegistrato(page);   // da qui in poi la finestra non deve comparire mai
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
  check(scen, /Etichette provette/.test(await docStampa(page)), "la stampa parte da sola, dalle etichette");
  await page.waitForFunction(() => document.getElementById("psassist-print")?.dataset.stato === "stampo", null, { timeout: 15000 });
  const vista = await anteprima(page);
  check(scen, /Stampa 1 di 2 — Etichette provette/.test(vista) && /→ etichettatrice/.test(vista),
    `arrivato il PDF, la scheda lo mostra in anteprima con la stampante su cui va (got: ${vista || "niente"})`);
  check(scen, Number(await page.locator("#psassist-print").getAttribute("data-print-attempts")) >= 1,
    "e il dialogo di stampa si apre subito, da quella cornice");
  await avanti(page);   // chiuso il dialogo delle etichette…
  check(scen, /Lista esami/.test(await docStampa(page)), "…si passa da soli alla lista esami");
  check(scen, await nienteDavanti(page), "e mentre la lista arriva la scheda non c'è");
  await attendiAnteprima(page);
  check(scen, /Lista esami/.test(await anteprima(page)) && /→ stampante normale/.test(await anteprima(page)),
    `poi ricompare, con la lista in anteprima (got: ${await anteprima(page) || "niente"})`);
  await avanti(page);
  await page.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 });
  const resoconto = await striscia(page, /Stampato/, 5000).catch(() => "");
  await page.waitForTimeout(200);
  const reg = await registrato(page);
  const tutto = reg.testi.join(" | ");
  check(scen, reg.finestra === 0, `dalla spedizione alle etichette la finestra non si apre mai (vista ${reg.finestra} volte)`);
  check(scen, reg.inCarico === 0, `e mentre un PDF arriva non c'è niente davanti alla pagina (coperta ${reg.inCarico} volte)`);
  check(scen, reg.anteprima > 0, "arrivato il PDF, la scheda col PDF in anteprima");
  check(scen, /ROSSI MARIO/.test(reg.testi[0] || "") && /\b2 esami\b/.test(reg.testi[0] || ""),
    `la striscia: paziente e quanti esami (got: ${reg.testi[0]})`);
  const giro = reg.testi.slice(0, Math.max(0, reg.testi.findIndex((t) => /Confermo/.test(t))));
  check(scen, giro.some((t) => /esame 1 di 2/.test(t)) && giro.some((t) => /esame 2 di 2/.test(t)) && !giro.some((t) => /\b\d+\/\d+\b/.test(t)),
    `e a che punto, in ESAMI: «esame 1 di 2», «esame 2 di 2» — non i passi (got: ${reg.testi.filter((t) => /esame \d/.test(t)).join(" | ").slice(0, 160)})`);
  check(scen, /esami in carrello/.test(tutto) && /Confermo/.test(tutto), `poi «✓ N esami in carrello · Confermo…» (got: ${tutto.slice(0, 300)})`);
  check(scen, /Confermata/.test(tutto) && /Aspetto le etichette/.test(tutto), "poi «Confermata · Aspetto le etichette…»");
  check(scen, /Stampo le etichette/.test(tutto) && /Aspetto la lista esami/.test(tutto) && /Stampo la lista esami/.test(tutto),
    "poi le etichette e la lista, una dopo l'altra");
  check(scen, /Stampato/.test(resoconto) && /2 esami confermati \d\d:\d\d/.test(resoconto),
    `e alla fine il resoconto: «Stampato · 2 esami confermati HH:MM» (got: ${resoconto})`);
  await page.waitForTimeout(6000);
  const resta = (await $panel(page, ".pill.run").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(scen, /2 esami confermati/.test(resta), `e il resoconto resta finché non fai altro, non svanisce (got: ${resta})`);
  check(scen, (await $panel(page, "#strazione").count()) === 0, "stampato tutto: niente «Ristampa»");
  const sorvegliate = await page.evaluate(() => JSON.parse(localStorage.getItem("psassist:daConfermare.v1") || "[]"));
  check(scen, Array.isArray(sorvegliate) && !sorvegliate.some((x) => x.rid === rid), "confermata con la prova: non resta fra quelle da sorvegliare");
  await context.close();

  // Quando la pagina dopo la conferma non porta i fogli di questa richiesta,
  // non è ancora una prova: la si cerca con UNA lettura della pagina del
  // paziente — e i fogli si prendono da lì, senza ricaricare niente.
  const mock2 = createMock({ labelsInterstitial: true, labelsBare: true });
  const b = await newPage(browser, mock2, { ritardo: lentiStampa });
  await registraStriscia(b.context);
  await b.page.goto(mock2.patientUrl);
  await richieste(b.page);
  await $panel(b.page, "#q").fill("dolore toracico");
  await $panel(b.page, '.opt[title*="TROPONINA"]').click();
  await b.page.evaluate(() => { window.__nonRicaricata = true; });
  await $panel(b.page, "#goconfirm").click();
  await azzeraRegistrato(b.page);
  await b.page.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 });
  await b.page.waitForTimeout(300);
  const reg2 = await registrato(b.page);
  const nPost = mock2.state.requests.findIndex((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
  check(scen, nPost >= 0 && mock2.state.requests.slice(nPost + 1).some((q) => q.method === "GET" && q.params.MVPG === "PsoEpisodioClinicoAmbulatorio"),
    "nessuna prova dalla pagina dopo la conferma: si legge (GET) la pagina del paziente");
  check(scen, await b.page.evaluate(() => window.__nonRicaricata === true), "e la pagina del medico non si ricarica");
  check(scen, reg2.finestra === 0, `e la finestra non si apre (vista ${reg2.finestra} volte)`);
  check(scen, reg2.inCarico === 0, "e niente davanti mentre le etichette arrivano");
  check(scen, /Confermata/.test(reg2.testi.join(" | ")) && /etichette/.test(reg2.testi.join(" | ")),
    `con lo stato delle etichette nella striscia (got: ${reg2.testi.slice(-2).join(" | ")})`);
  // la stampa annullata: il resoconto resta, con «Ristampa»
  await b.page.keyboard.press("Escape");
  await b.page.waitForSelector("#psassist-print", { state: "detached", timeout: 5000 });
  const annullata = await striscia(b.page, /confermat/, 5000).catch(() => "");
  check(scen, /Stampa non finita/.test(annullata) && /1 esame confermato \d\d:\d\d/.test(annullata) && (await $panel(b.page, "#strazione").innerText().catch(() => "")) === "Ristampa",
    `annullata la stampa: «1 esame confermato HH:MM» e un «Ristampa» tranquillo (got: ${annullata})`);
  await $panel(b.page, "#strazione").click();
  check(scen, await b.page.waitForSelector("#psassist-print", { state: "attached", timeout: 8000 }).then(() => true).catch(() => false),
    "«Ristampa» rifà la stampa");
  await b.context.close();
}

// Se il server non si lascia incorniciare, la conferma in sottofondo non è
// possibile: si torna alla strada di sempre — la pagina del carrello davanti
// agli occhi — e la richiesta si conferma lo stesso, una volta sola.
async function scenarioCorniceVietata(browser) {
  const scen = "cornice-vietata";
  const mock = createMock({ vietaCornice: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 });
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === true, "la richiesta viene confermata lo stesso");
  const conferme = mock.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
  check(scen, conferme.length === 1, `e una volta sola, mai due (got ${conferme.length})`);
  check(scen, /Etichette provette/.test(await docStampa(page)), "e la stampa parte");
  await context.close();
}

// La conferma automatica sospesa (un controllo ha detto di no): si finisce
// sul carrello con la striscia ambra, e un tocco apre il motivo.
async function sospesa(page) {
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 25000 });
  const t = await striscia(page, /Conferma sospesa/, 10000).catch(() => "");
  if (t) await apriStriscia(page);
  return t;
}

async function scenarioAutoConfirmMismatch(browser) {
  const scen = "confirm-blocked";
  // an exam is already in the cart from an earlier, abandoned attempt: the
  // native Conferma would submit MORE than this run added → no auto-confirm
  const mock = createMock({ preloadCart: { code: "30", res: RES.POC } });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  const pill = await sospesa(page);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === false, "col carrello diverso dalla ricevuta NON conferma");
  check(scen, !!pill, "si atterra sul carrello con la striscia «Conferma sospesa», non con la finestra");
  check(scen, /sospesa/i.test(await $panel(page, ".card").innerText()), "e un tocco dice perché: decide il medico");
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
  await richieste(page);
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
  await sospesa(page);
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
  await richieste(page);
  await $panel(page, "#q").fill("sepsi");
  await $panel(page, '.opt[title*="TROPONINA"]').click();              // POC
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();         // URGENZE: si finisce qui
  await $panel(page, "#goconfirm").click();
  await sospesa(page);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === false,
    "un avanzo su un'altra risorsa impedisce l'auto-conferma");
  const card = await $panel(page, ".card").innerText();
  check(scen, /sospesa/i.test(card), "e lo dice");
  check(scen, /POC/i.test(card), `nominando la risorsa dove sta l'avanzo (got: ${(/sospesa[^.]{0,110}/i.exec(card) || [""])[0]})`);
  await context.close();
}

// «Confermata» solo con una PROVA: una pagina dello stesso episodio che
// elenca i fogli di quella richiesta. Il POST della conferma che risponde 500
// — o che ripresenta il carrello — non lo è: la pagina del paziente si legge
// UNA volta, e se non la elenca la pill è ambra, «Non confermata», mai verde.
// Nessuna seconda conferma da sola: un tocco apre il carrello.
async function scenarioConfirmPostFails(browser) {
  for (const [scen, opz, rifiuta] of [["confirm-500", { confirmFails: true }, false], ["confirm-ancora-carrello", {}, true]]) {
    const mock = createMock(opz);
    // il gestionale che alla Conferma risponde ripresentando l'elenco (200), senza confermare
    if (rifiuta) {
      const h = mock.handle;
      mock.handle = (req) => {
        if (req.method === "POST" && /ccsForm=Prestazioni/.test(req.url)) {
          mock.state.requests.push({ method: "POST", url: req.url, params: Object.fromEntries(new URL(req.url).searchParams), form: {} });
          const u = new URL(req.url); u.searchParams.delete("ccsForm");
          return h({ method: "GET", url: u.href });
        }
        return h(req);
      };
    }
    const { context, page } = await newPage(browser, mock);
    await registraStriscia(context);
    await page.goto(mock.patientUrl);
    await richieste(page);
    await $panel(page, "#q").fill("dolore toracico");
    await $panel(page, '.opt[title*="TROPONINA"]').click();
    await $panel(page, "#goconfirm").click();
    const ambra = await striscia(page, /Non confermata/, 30000).catch(() => "");
    const rid = Object.keys(mock.state.richieste)[0];
    check(scen, mock.state.richieste[rid].confirmed === false, "la richiesta resta non confermata");
    check(scen, /Non confermata/.test(ambra) && /tocca per il carrello/.test(ambra) && (await $panel(page, ".pill.run.warn").count()) === 1,
      `pill ambra «Non confermata · tocca per il carrello» (got: ${ambra})`);
    const testi = (await registrato(page)).testi;
    check(scen, !testi.some((t) => /Confermata|confermat[ia] \d/.test(t)), `mai verde, mai «Confermata» (got: ${testi.slice(-3).join(" | ")})`);
    const conferme = mock.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
    check(scen, conferme.length === 1, `una conferma sola, mai ripetuta da sola (got ${conferme.length})`);
    const nPost = mock.state.requests.indexOf(conferme[0]);
    check(scen, mock.state.requests.slice(nPost + 1).some((q) => q.method === "GET" && q.params.MVPG === "PsoEpisodioClinicoAmbulatorio"),
      "per saperlo si è letta la pagina del paziente");
    check(scen, hits(mock, "RcsStampaEtichetteLISHMIMU") === 0 && hits(mock, "jasperservlet") === 0,
      "nessun PDF stampato per una conferma mai registrata");
    check(scen, (await page.locator("#psassist-print").count()) === 0, "nessun wizard di stampa");
    check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()), "la pagina non si è mossa da sola");
    await $panel(page, ".pill.run").click();
    await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 10000 });
    check(scen, new URL(page.url()).searchParams.get("RICHIESTA_ID") === rid, "un tocco: il carrello di quella richiesta");
    await page.waitForTimeout(1500);
    check(scen, mock.state.richieste[rid].confirmed === false && mock.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni")).length === 1,
      "e lì niente si conferma da solo: decide il medico");
    await context.close();
  }
}

async function scenarioAltroPresidio(browser) {
  const scen = "altro-presidio";
  // Same hospital group, another site: resources and exam codes are numbered
  // differently, names and LIS mnemonics are not. The panel must recognise
  // them by name and order anyway — never by trusting a stale id.
  const mock = createMock({ altroPresidio: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#q").fill("dispnea");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();   // POC
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();        // URGENZE
  await $panel(page, "#go").click();
  await atterraCarrello(page, 40000);
  await apriStriscia(page);
  await page.waitForSelector("#psassist-host #confirmnow", { timeout: 5000 });

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
  await richieste(b2.page);
  await b2.page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(b2.page, "#q").fill("dispnea");
  await $panel(b2.page, '.opt[title*="EMOGASANALISI VENOSA"]').first().click();
  await $panel(b2.page, "#go").click();
  await atterraCarrello(b2.page, 40000);
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
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  await errore(page);
  await apriStriscia(page);
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
  await richieste(page);
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
  await richieste(page);
  await $panel(page, "#q").fill("controllo");
  // POC exam (lost by the server) runs first; the URGENZE one must never start
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  const rossa = await errore(page);
  // mandato e non visto è «da controllare» (mai da rifare); mai partito, «manca»
  check(scen, /Mancano: PROCALCITONINA/.test(rossa) && /Da controllare: EMOCROMO POC/.test(rossa) && !/Mancano:[^·]*EMOCROMO/.test(rossa),
    `la striscia separa «Mancano» da «Da controllare» (got: ${rossa})`);
  check(scen, new URL(page.url()).searchParams.get("RISORSA_ID") === RES.URGENZE,
    "e si atterra sul carrello del laboratorio del primo esame mancante, non dell'ultimo usato");
  await apriStriscia(page);
  const banner = await $panel(page, ".banner.err").innerText();
  check(scen, /non risulta nel carrello/i.test(banner), `messaggio hard-stop chiaro (got: ${banner.slice(0, 80)})`);
  const controlla = await page.locator("#psassist-host .chip.controlla").allInnerTexts();
  const manca = await page.locator("#psassist-host .chip.manca").allInnerTexts();
  check(scen, controlla.length === 1 && /EMOCROMO/.test(controlla[0]) && manca.length === 1 && /PROCALCITONINA/.test(manca[0]),
    `nel resoconto: «Da controllare» l'emocromo, «Da aggiungere a mano» la PCT (got ${controlla} / ${manca})`);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.insertCount[`${rid}:320`] === 1, "esame perso inviato UNA volta sola");
  check(scen, !mock.state.insertCount[`${rid}:159`], "gli esami successivi NON vengono inviati dopo lo stop");
  check(scen, mock.state.richieste[rid].confirmed === false, "nessuna conferma dopo hard-stop");
  await shot(page, scen);
  await context.close();
}

// Una prestazione «a riflesso» entra in carrello col codice dell'esame che ne
// deriva: cercare il proprio numero non la trova più, e il vecchio motore si
// fermava dicendo che non era entrata mentre invece c'era.
async function scenarioRiflesso(browser) {
  const scen = "riflesso";
  const mock = createMock({ riflesso: { 16: { code: "17", label: "BILIRUBINA TOTALE (1341)" } } });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("ittero");
  await $panel(page, '.opt[title*="BILIRUBINA"]').click();
  await $panel(page, "#go").click();
  await atterraCarrello(page);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].cart.has("17"), "l'esame a riflesso è in carrello col suo codice derivato");
  check(scen, mock.state.insertCount[`${rid}:16`] === 1, "inviato una volta sola");
  await apriStriscia(page);
  const err = await $panel(page, ".banner.err").count();
  check(scen, err === 0, "nessun errore: la riga nuova col nome giusto vale come conferma");
  const ok = await $panel(page, ".banner.ok").innerText().catch(() => "");
  check(scen, /1 esame in carrello, verificato/.test(ok), `ricevuta corretta (got: ${ok.trim().slice(0, 40)})`);
  await context.close();

  // …ma una riga nuova che NON è l'esame chiesto non vale come conferma:
  // il carrello cresce e il motore si ferma lo stesso.
  const scen2 = "riflesso-estraneo";
  const mock2 = createMock({ riflesso: { 159: { code: "555", label: "ANTITROMBINA III (1450)" } } });
  const b = await newPage(browser, mock2);
  await b.page.goto(mock2.patientUrl);
  await richieste(b.page);
  await $panel(b.page, "#q").fill("controllo");
  await $panel(b.page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(b.page, "#go").click();
  await errore(b.page);
  await apriStriscia(b.page);
  const banner = await $panel(b.page, ".banner.err").innerText();
  check(scen2, /non risulta nel carrello/i.test(banner), `si ferma comunque (got: ${banner.trim().slice(0, 60)})`);
  const rid2 = Object.keys(mock2.state.richieste)[0];
  check(scen2, mock2.state.insertCount[`${rid2}:159`] === 1, "e non reinvia niente");
  await b.context.close();
}

// Il server risponde all'inserimento con una pagina che non è l'elenco:
// l'esame è entrato lo stesso, e si vede rileggendo il carrello.
async function scenarioAvvisoDopoInsert(browser) {
  const scen = "avviso-dopo-insert";
  const mock = createMock({ avvisoDopoInsert: ["159"] });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  await atterraCarrello(page);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].cart.has("159"), "esame in carrello");
  check(scen, mock.state.insertCount[`${rid}:159`] === 1, "una pagina inattesa non fa reinviare l'esame");
  await apriStriscia(page);
  const err = await $panel(page, ".banner.err").count();
  check(scen, err === 0, "nessun errore: il carrello riletto dice che c'è");
  await registro(page);
  const reg = await $panel(page, ".log").innerText();
  check(scen, /rileggo il carrello/.test(reg), `il Registro dice che è successo (got: ${(/[^\n]*rilegg[^\n]*/.exec(reg) || ["niente"])[0].slice(0, 70)})`);
  await context.close();
}

// L'elenco a volte arriva monco: la riga di un esame c'è, ma la pagina non la
// mostra. Qui lo si simula riscrivendo la risposta del server.
const togliRiga = (codice) => (html) => html.replace(
  new RegExp(`<tr><td><a class="AFCDataLink" href="[^"]*Insert=Inserisci[^"]*[?&]PRESTAZIONE=${codice}&[^"]*">[^<]*</a></td></tr>`, "g"), "");
const togliTutteLeRighe = (html) => html.replace(/<tr><td><a class="AFCDataLink" href="[^"]*Insert=Inserisci[^"]*">[^<]*<\/a><\/td><\/tr>/g, "");
const chiaviUrl = (u) => [...new URL(u).searchParams.keys()].join(",");

// La riga di un esame che l'elenco non mostra (a volte arriva monco): si
// rilegge UNA volta con la ricerca del gestionale — l'elenco stesso, con
// s_PRESTAZIONE, una semplice lettura — e la riga che compare passa per la
// strada di sempre: nome vivo controllato, un invio solo. Mai un indirizzo
// costruito: se la riga non c'è nemmeno lì, non si manda niente («Mancano»).
async function scenarioRigaCercata(browser) {
  const scen = "riga-cercata";
  const intero = (u) => !new URL(u).searchParams.get("s_PRESTAZIONE");   // l'elenco senza ricerca
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock, { riscrivi: (u, h) => (intero(u) ? togliRiga("159")(h) : h) });
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, '.opt[title*="LIPASI"]').click();
  await $panel(page, "#goconfirm").click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 }).catch(() => {});
  const rid = Object.keys(mock.state.richieste)[0];
  const cerca = mock.state.requests.filter((q) => q.params.MVPG === "RcsRichiestaPrestazioniRicercaErogatore" && q.params.s_PRESTAZIONE);
  check(scen, cerca.length === 1 && cerca[0].method === "GET" && cerca[0].params.s_PRESTAZIONE === "1690" && !cerca[0].params.Insert
    && cerca[0].params.RICHIESTA_ID === rid && cerca[0].params.RISORSA_ID === RES.URGENZE,
    `una sola rilettura con la ricerca del gestionale, per mnemonico (got ${cerca.map((q) => q.params.s_PRESTAZIONE).join(",") || "nessuna"})`);
  check(scen, mock.state.insertCount[`${rid}:159`] === 1 && mock.state.richieste[rid].cart.has("159"),
    "la riga trovata lì: inviata una volta, ed è in carrello");
  check(scen, mock.state.richieste[rid].confirmed === true,
    "e la conferma automatica passa: il carrello confrontato è quello intero, non quello della ricerca");
  check(scen, /riletto con la ricerca del gestionale/.test(await registroDi(page)), "il Registro lo dice");
  await context.close();

  // …la riga non c'è nemmeno con la ricerca: niente si manda, la PCT «manca»
  const scen2 = "riga-assente";
  const mock2 = createMock({});
  const b = await newPage(browser, mock2, { riscrivi: (u, h) => togliRiga("159")(h) });
  await b.page.goto(mock2.patientUrl);
  await richieste(b.page);
  await $panel(b.page, "#q").fill("febbre");
  await $panel(b.page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(b.page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(b.page, "#goconfirm").click();
  const rossa = await errore(b.page);
  const rid2 = Object.keys(mock2.state.richieste)[0];
  check(scen2, /Mancano: PROCALCITONINA/.test(rossa), `striscia rossa: «Mancano: PROCALCITONINA» (got: ${rossa})`);
  check(scen2, !mock2.state.requests.some((q) => q.params.Insert === "Inserisci" && q.params.PRESTAZIONE === "159"),
    "nessun indirizzo d'inserimento per la PCT è stato chiesto");
  check(scen2, mock2.state.requests.filter((q) => q.params.s_PRESTAZIONE).length === 1, "cercata una volta sola");
  check(scen2, mock2.state.richieste[rid2].confirmed === false
    && !mock2.state.requests.some((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni")), "e niente confermato");
  check(scen2, new URL(b.page.url()).searchParams.get("RISORSA_ID") === RES.URGENZE, "la scheda è sul carrello del laboratorio della PCT");
  await apriStriscia(b.page);
  check(scen2, /ricerca del gestionale/.test(await $panel(b.page, ".banner.err").innerText()), "e il motivo dice che è stata cercata");
  await b.context.close();

  // …la ricerca la mostra, ma il suo codice oggi porta un altro nome: il
  // controllo del nome vivo la ferma PRIMA dell'invio, come ogni altra riga
  const scen3 = "riga-cercata-altro-nome";
  const mock3 = createMock({});
  const altro = (h) => h.replace(/(PRESTAZIONE=159[^"]*">0-159 )[^<]*/g, "$1ANTITROMBINA III (1450)");
  const c = await newPage(browser, mock3, { riscrivi: (u, h) => (intero(u) ? togliRiga("159")(h) : altro(h)) });
  await c.page.goto(mock3.patientUrl);
  await richieste(c.page);
  await $panel(c.page, "#q").fill("febbre");
  await $panel(c.page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(c.page, "#goconfirm").click();
  const rossa3 = await errore(c.page);
  check(scen3, /Mancano: PROCALCITONINA/.test(rossa3), `si ferma: «Mancano: PROCALCITONINA» (got: ${rossa3})`);
  check(scen3, !mock3.state.requests.some((q) => q.params.Insert === "Inserisci"), "e non manda niente");
  await apriStriscia(c.page);
  check(scen3, /oggi si chiama «ANTITROMBINA III/.test(await $panel(c.page, ".banner.err").innerText()), "dicendo che quel codice oggi è un altro esame");
  await c.context.close();
}

const confermePost = (mock) => mock.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));

// Il medico clicca nel gestionale mentre la cornice sta ancora confermando: la
// pagina se ne va, e la conferma automatica con lei — non riparte da sola più
// tardi su un carrello aperto a mano. Resta un segno (solo numeri): passati i
// 2 minuti (qui accorciati), la pagina di quell'episodio dice «Richiesta HH:MM
// non confermata · tocca per il carrello». Confermata dal gestionale, il
// segno se ne va.
async function scenarioConfermaInterrotta(browser) {
  const scen = "conferma-interrotta";
  const mock = createMock({});
  // solo la cornice nascosta è lenta: il tempo di cambiare pagina durante «Confermo…»
  const ritardo = (u, req) => { try { return req.isNavigationRequest() && req.frame().parentFrame() ? 4000 : 0; } catch { return 0; } };
  const { context, page } = await newPage(browser, mock, { pill: true, ritardo });
  await context.addInitScript(() => { try { localStorage.setItem("psassist:attesaConferma.ms", "5000"); } catch { /* niente */ } });
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host #expand", { state: "attached" });
  await $panel(page, "#expand").click();
  await richieste(page);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#goconfirm").click();
  await striscia(page, /Confermo/, 30000);
  const t0 = Date.now();
  await page.waitForTimeout(300);
  await page.goto(mock.patientUrl);   // un clic qualunque nel gestionale
  await page.waitForSelector("#psassist-host #expand", { state: "attached" });
  await page.waitForTimeout(300);
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === false && confermePost(mock).length === 0, "la conferma è morta con la pagina");
  const segno = await page.evaluate(() => JSON.parse(localStorage.getItem("psassist:daConfermare.v1") || "[]"));
  check(scen, segno.length === 1 && segno[0].rid === rid && segno[0].ep === "999001" && segno[0].n === 2 && !/ROSSI|MARIO/i.test(JSON.stringify(segno)),
    `resta il segno, solo numeri (got ${JSON.stringify(segno).slice(0, 140)})`);
  check(scen, !/non confermata/i.test(await $panel(page, "#expand").innerText()), "prima del tempo la pill non dice niente");
  const avviso = await striscia(page, /Richiesta \d\d:\d\d non confermata/, 15000).catch(() => "");
  check(scen, /tocca per il carrello/.test(avviso) && (await $panel(page, ".pill.run.warn").count()) === 1,
    `passato il tempo, la pagina dello stesso episodio lo dice, ambra (got: ${avviso})`);
  check(scen, Date.now() - t0 >= 4000, "e non prima");
  check(scen, confermePost(mock).length === 0, "niente si è confermato da solo");
  await $panel(page, ".pill.run").click();
  await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 10000 });
  check(scen, new URL(page.url()).searchParams.get("RICHIESTA_ID") === rid, "un tocco apre il carrello di quella richiesta");
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.waitForTimeout(1500);
  check(scen, mock.state.richieste[rid].confirmed === false && confermePost(mock).length === 0,
    "e lì la conferma automatica non riparte da sola: decide il medico");
  check(scen, !/non confermata/i.test(await $panel(page, ".wrap").innerText()), "sul carrello di quella richiesta l'avviso non serve");
  // il medico conferma dal gestionale: la pagina dopo la elenca coi suoi fogli, e il segno se ne va
  await page.locator('form[name="Prestazioni"] input[name="Update"]').click();
  await page.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  check(scen, mock.state.richieste[rid].confirmed === true && confermePost(mock).length === 1, "confermata a mano, una volta");
  const dopo = await page.evaluate(() => JSON.parse(localStorage.getItem("psassist:daConfermare.v1") || "[]"));
  check(scen, !dopo.some((x) => x.rid === rid), "vista confermata, non la si sorveglia più");
  await context.close();
}

// Una navigazione decisa dal programma non si porta mai via quello che il
// medico sta scrivendo nel gestionale: cursore in un campo, testo cambiato, un
// tasto da meno di 15 secondi. La scheda resta dov'è, la pill dice «… · tocca
// per il carrello», e un tocco ci porta.
async function scenarioNonMangiaLaScrittura(browser) {
  for (const [scen, opz, bottone, attesa] of [
    ["scrive-revisione", {}, "#go", /Conferma dal gestionale · tocca per il carrello/],
    ["scrive-errore", { mislabel: { 159: "ANTITROMBINA III (1450)" } }, "#goconfirm", /Mancano: PROCALCITONINA · tocca per il carrello/],
  ]) {
    const mock = createMock(opz);
    const { context, page } = await newPage(browser, mock, { ritardo: (u) => (/Insert=Inserisci/.test(u) ? 600 : 0) });
    await page.goto(mock.patientUrl);
    await richieste(page);
    await $panel(page, "#q").fill("febbre");
    await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
    await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
    await $panel(page, bottone).click();
    await page.waitForSelector("#psassist-host .pill.run", { timeout: 15000 });
    const diario = page.locator('textarea[name="DIARIO"]');
    await diario.click();
    const testo = "Paziente vigile, orientato. Dolore addominale da ieri sera.";
    await page.keyboard.type(testo, { delay: 20 });
    const pill = await striscia(page, attesa, 30000).catch(() => "");
    await page.waitForTimeout(1500);
    check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()) && (await diario.inputValue()) === testo,
      `la scheda resta dov'è, col testo del diario (url …${page.url().slice(-36)})`);
    check(scen, !!pill, `la pill dice di toccare per il carrello (got: ${pill || (await $panel(page, ".pill.run").innerText().catch(() => "—")).replace(/\s+/g, " ")})`);
    const rid = Object.keys(mock.state.richieste)[0];
    check(scen, confermePost(mock).length === 0, "e niente si è confermato");
    await $panel(page, ".pill.run").click();
    await page.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 10000 });
    check(scen, new URL(page.url()).searchParams.get("RICHIESTA_ID") === rid, "un tocco: il carrello della richiesta");
    await context.close();
  }
}

// Un errore a metà giro: la finestra non si apre. La striscia diventa rossa e
// dice cosa manca, la scheda va sul carrello della richiesta (una lettura:
// niente si manda, niente si conferma) e lì si finisce a mano dal gestionale.
// Un tocco apre il motivo intero e gli elenchi «Nel carrello» / «Da
// aggiungere a mano».
async function scenarioErroreCompletaAMano(browser) {
  const scen = "errore-a-mano";
  const mock = createMock({ mislabel: { 159: "ANTITROMBINA III (1450)" } });   // la PCT si ferma prima dell'invio
  const { context, page } = await newPage(browser, mock);
  await registraStriscia(context);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await azzeraRegistrato(page);
  const rossa = await errore(page);
  const n0 = mock.state.requests.length;
  const rid = Object.keys(mock.state.richieste)[0];
  const qui = new URL(page.url()).searchParams;
  check(scen, qui.get("RICHIESTA_ID") === rid && qui.get("RISORSA_ID") === RES.URGENZE && !qui.get("Insert") && !qui.get("Delete"),
    `atterrato sull'elenco del carrello della richiesta, senza parametri d'invio (got …${page.url().slice(-60)})`);
  const ultima = mock.state.requests[n0 - 1];
  check(scen, ultima && ultima.method === "GET" && ultima.params.MVPG === "RcsRichiestaPrestazioniRicercaErogatore" && !ultima.params.Insert,
    "l'ultima cosa chiesta al server è la lettura del carrello");
  check(scen, /Errore · completa a mano/.test(rossa) && /Mancano: PROCALCITONINA/.test(rossa),
    `striscia: «Errore · completa a mano» / «Mancano: …» (got: ${rossa})`);
  check(scen, (await $panel(page, ".pill.run.err").count()) === 1, "e rossa");
  await page.waitForTimeout(2500);
  check(scen, mock.state.requests.length === n0,
    `dopo, nessuna richiesta al server (got ${mock.state.requests.slice(n0).map((q) => q.params.MVPG || q.url.slice(-40)).join(", ")})`);
  check(scen, Object.keys(mock.state.insertCount).length === 2 && !mock.state.insertCount[`${rid}:159`],
    `inviati solo i due prima dell'errore (${JSON.stringify(mock.state.insertCount)})`);
  check(scen, mock.state.richieste[rid].confirmed === false
    && !mock.state.requests.some((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni")), "niente confermato");
  const reg = await registrato(page);
  check(scen, reg.finestra === 0, `la finestra non si apre mai da sola (vista ${reg.finestra} volte)`);
  await apriStriscia(page);
  const card = await $panel(page, ".card").innerText();
  check(scen, /oggi si chiama/.test(card), "un tocco: il motivo per intero");
  const nel = await page.locator("#psassist-host .chip.nel").allInnerTexts();
  const manca = await page.locator("#psassist-host .chip.manca").allInnerTexts();
  check(scen, nel.length === 2 && nel.some((t) => /EMOCROMO/.test(t)) && nel.some((t) => /TROPONINA/.test(t)),
    `«Nel carrello»: i due entrati (got ${nel.join(", ")})`);
  check(scen, manca.length === 1 && /PROCALCITONINA/.test(manca[0]), `«Da aggiungere a mano»: la PCT (got ${manca.join(", ")})`);
  check(scen, (await $panel(page, "#openlist").count()) === 0, "già sul carrello: nessun bottone per andarci");
  await context.close();
}

// Dopo un errore si riprova SOLO quello che manca, sulla STESSA richiesta e
// nello stesso modo. Qui la TROPONINA parte e il server non la prende (da
// controllare: mai rimandata), la PCT non parte mai (manca). Sul carrello un
// tocco sulla striscia rossa, e «↻ Riprova i mancanti (1)»: l'EMOCROMO già in
// carrello si ritrova e non si rimanda, la TROPONINA resta fuori, parte solo
// la PCT. Il primo giro era «+ Conferma 🖨», e lo è anche questo: una conferma
// sola, alla fine, e la stampa della richiesta intera.
async function scenarioRiprova(browser) {
  const scen = "riprova";
  const mock = createMock({ neverAdd: ["324"] });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#goconfirm").click();
  const rossa = await errore(page, { timeout: 40000 });
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, /Mancano: PROCALCITONINA/.test(rossa) && /Da controllare: TROPONINA/.test(rossa),
    `l'errore: la PCT manca, la TROPONINA è da controllare (got: ${rossa})`);
  check(scen, new URL(page.url()).searchParams.get("RICHIESTA_ID") === rid, "e la scheda è sul carrello della richiesta");
  await apriStriscia(page);
  const card = (await $panel(page, ".card").innerText()).replace(/\s+/g, " ");
  const bott = (await $panel(page, "#riprova").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  check(scen, bott === "↻ Riprova i mancanti (1)", `sul carrello di quella richiesta: «↻ Riprova i mancanti (1)» (got: ${bott || "niente"})`);
  check(scen, (await $panel(page, "#annulla").count()) === 1 && (await $panel(page, "#reset").count()) === 0,
    "e «Annulla» al posto di «Torna al pannello»");
  check(scen, /guardali nel carrello prima/.test(card), "la TROPONINA resta in elenco: «guardali nel carrello prima»");
  const n0 = mock.state.requests.length;
  await $panel(page, "#riprova").click();
  // riparte in sottofondo: conferma in una cornice nascosta, poi la stampa
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 });
  const inviati = mock.state.requests.slice(n0).filter((q) => q.params.Insert === "Inserisci").map((q) => q.params.PRESTAZIONE);
  check(scen, JSON.stringify(inviati) === JSON.stringify(["159"]), `riprovando parte solo la PCT (got ${inviati.join(", ") || "niente"})`);
  check(scen, mock.state.insertCount[`${rid}:320`] === 1 && mock.state.insertCount[`${rid}:324`] === 1 && mock.state.insertCount[`${rid}:159`] === 1,
    `in tutto, ogni esame mandato una volta sola (${JSON.stringify(mock.state.insertCount)})`);
  check(scen, Object.keys(mock.state.richieste).length === 1, "sulla stessa richiesta: nessuna richiesta nuova");
  check(scen, confermePost(mock).length === 1 && mock.state.richieste[rid].confirmed === true,
    `come il primo giro, conferma da sola — una volta, alla fine (got ${confermePost(mock).length})`);
  const carrello = [...mock.state.richieste[rid].cart.keys()].sort();
  check(scen, JSON.stringify(carrello) === JSON.stringify(["159", "320"]), `confermati EMOCROMO e PCT (got ${carrello})`);
  check(scen, /Etichette provette/.test(await docStampa(page)), "e la stampa parte, dalle etichette");
  const reg = await registroDi(page);
  check(scen, /riprovo i mancanti: PROCALCITONINA/.test(reg) && /non rimando quelli da controllare: TROPONINA US/.test(reg)
    && /già presente ✓ EMOCROMO POC/.test(reg),
    "il Registro dice cosa ha rifatto, cosa ha ritrovato in carrello e cosa no");
  await page.keyboard.press("Escape");
  await context.close();
}

// In revisione il giro rifatto finisce come sempre: sul carrello, «Conferma
// dal gestionale», niente confermato da solo. L'errore qui passa (la riga
// della PCT arriva una volta col nome di un altro esame), così si vede che
// partono la PCT e l'ESAME URINE. L'EMOCROMO era entrato al primo giro, e
// intanto qualcuno l'ha tolto a mano: «Riprova» lo cerca, non lo rimette.
async function scenarioRiprovaRevisione(browser) {
  const scen = "riprova-revisione";
  const mock = createMock({});
  let rotta = true;
  const { context, page } = await newPage(browser, mock, {
    riscrivi: (u, html) => (rotta ? html.replace(/PROCALCITONINA \(1690\)/g, "ANTITROMBINA III (1450)") : html),
  });
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, '.opt[title*="ESAME URINE"]').click();
  await $panel(page, "#go").click();
  const rossa = await errore(page);
  check(scen, /Mancano: PROCALCITONINA, ESAME URINE/.test(rossa), `l'errore: mancano PCT e urine (got: ${rossa})`);
  rotta = false;
  const rid = Object.keys(mock.state.richieste)[0];
  // l'EMOCROMO tolto a mano dal carrello (da un'altra scheda: questa resta dov'è)
  await page.evaluate((u) => fetch(u).then((r) => r.text()),
    `${mock.ORIGIN}${mock.PATH}?Delete=Elimina&RICHIESTA_ID=${rid}&PRESTAZIONE=320&RISORSA_ID=${RES.POC}&STRUTTURA=1&EPISODIO_ID=999001`);
  check(scen, mock.state.richieste[rid].cart.has("320") === false, "(l'EMOCROMO non è più in carrello)");
  const n0 = mock.state.requests.length;
  await apriStriscia(page);
  const bott = (await $panel(page, "#riprova").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  check(scen, bott === "↻ Riprova i mancanti (2)", `«↻ Riprova i mancanti (2)» (got: ${bott || "niente"})`);
  await $panel(page, "#riprova").click();
  const fine = await striscia(page, /Conferma dal gestionale/, 40000).catch(() => "");
  check(scen, !!fine && new URL(page.url()).searchParams.get("RICHIESTA_ID") === rid,
    `come il primo giro, atterra sul carrello della richiesta: «Conferma dal gestionale» (got: ${fine || "niente"})`);
  const inviati = mock.state.requests.slice(n0).filter((q) => q.params.Insert === "Inserisci").map((q) => q.params.PRESTAZIONE).sort();
  check(scen, JSON.stringify(inviati) === JSON.stringify(["159", "317"]), `partono solo i due mancanti (got ${inviati.join(", ") || "niente"})`);
  check(scen, mock.state.insertCount[`${rid}:320`] === 1 && !mock.state.richieste[rid].cart.has("320"),
    "l'EMOCROMO del primo giro si cerca soltanto: tolto a mano, non si rimette");
  check(scen, /non è più in carrello/.test(await registroDi(page)) || /non lo rimetto/.test(await registroDi(page)),
    "e il Registro lo dice");
  check(scen, confermePost(mock).length === 0 && mock.state.richieste[rid].confirmed === false, "e niente si conferma da solo");
  check(scen, Object.keys(mock.state.richieste).length === 1, "sempre la stessa richiesta");
  await context.close();
}

// Due errori di fila. Il primo: la TROPONINA è da controllare, la PCT manca.
// «Riprova» lascia fuori la TROPONINA e la PCT si ferma di nuovo: il secondo
// resoconto la elenca ancora fra i «da controllare» — non è sparita — e il
// secondo «Riprova» manda solo la PCT. Niente di già passato riparte.
async function scenarioRiprovaDueVolte(browser) {
  const scen = "riprova-due-volte";
  const mock = createMock({ neverAdd: ["324"] });
  let rotta = false;
  const { context, page } = await newPage(browser, mock, {
    riscrivi: (u, html) => (rotta ? html.replace(/PROCALCITONINA \(1690\)/g, "ANTITROMBINA III (1450)") : html),
  });
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  await errore(page, { timeout: 40000 });
  const rid = Object.keys(mock.state.richieste)[0];
  rotta = true;   // al primo «Riprova» la riga della PCT arriva sbagliata
  await apriStriscia(page);
  const ricarica = page.waitForEvent("load", { timeout: 40000 });
  await $panel(page, "#riprova").click();
  await ricarica;   // il secondo errore riporta sul carrello
  const rossa = await striscia(page, /Errore · completa a mano/, 20000).catch(() => "");
  check(scen, /Mancano: PROCALCITONINA/.test(rossa) && /Da controllare: TROPONINA US/.test(rossa),
    `il secondo errore: la PCT manca ancora, e la TROPONINA resta da controllare (got: ${rossa || "niente"})`);
  rotta = false;
  await apriStriscia(page);
  const controlla = await page.locator("#psassist-host .chip.controlla").allInnerTexts();
  const bott = (await $panel(page, "#riprova").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  check(scen, controlla.some((t) => /TROPONINA/.test(t)) && bott === "↻ Riprova i mancanti (1)",
    `in elenco fra i «da controllare», e «↻ Riprova i mancanti (1)» (got: ${controlla.join(", ")} · ${bott || "niente"})`);
  await $panel(page, "#riprova").click();
  await striscia(page, /Conferma dal gestionale/, 40000).catch(() => "");
  const conti = mock.state.insertCount;
  check(scen, Object.keys(conti).length === 3 && [320, 324, 159].every((c) => conti[`${rid}:${c}`] === 1),
    `in tutto, ognuno mandato una volta sola (${JSON.stringify(conti)})`);
  check(scen, Object.keys(mock.state.richieste).length === 1 && confermePost(mock).length === 0,
    "sempre la stessa richiesta, e niente confermato da solo");
  await context.close();
}

// «Annulla» dopo un errore: via la striscia rossa e il passaggio di consegne,
// si torna alle Richieste col quesito e gli esami di prima. La richiesta
// lasciata a metà non viene più ricordata: chi rifà da capo non deve trovarsi
// a confermare anche quella.
async function scenarioAnnulla(browser) {
  const scen = "annulla";
  const mock = createMock({ mislabel: { 159: "ANTITROMBINA III (1450)" } });
  const { context, page } = await newPage(browser, mock);
  await context.addInitScript(() => { try { localStorage.setItem("psassist:attesaConferma.ms", "2000"); } catch { /* niente */ } });
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre di origine sconosciuta");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#goconfirm").click();
  await errore(page);
  const rid = Object.keys(mock.state.richieste)[0];
  await apriStriscia(page);
  const n0 = mock.state.requests.length;
  await $panel(page, "#annulla").click();
  await page.waitForSelector("#psassist-host .selbar", { timeout: 5000 });
  const sel = (await $panel(page, ".selbar").innerText()).replace(/\s+/g, " ");
  check(scen, (await $panel(page, "#annulla").count()) === 0 && /2 SELEZIONATI/.test(sel) && /EMOCROMO/.test(sel) && /PROCALCITONINA/.test(sel),
    `si torna alle Richieste con gli esami scelti (got: ${sel})`);
  const tab = await page.evaluate(() => ({
    avviso: sessionStorage.getItem("psassist:avviso.v1"),
    ui: JSON.parse(sessionStorage.getItem("psassist:ui.999001") || "{}"),
    sorvegliate: JSON.parse(localStorage.getItem("psassist:daConfermare.v1") || "[]"),
  }));
  check(scen, tab.ui.q === "febbre di origine sconosciuta" && (tab.ui.sel || []).length === 2, `quesito ed esami restano (got ${JSON.stringify(tab.ui).slice(0, 120)})`);
  check(scen, !tab.avviso || tab.avviso === "null", "il passaggio di consegne dell'errore si dimentica");
  check(scen, !tab.sorvegliate.some((x) => x.rid === rid), "e la richiesta lasciata a metà non si sorveglia più");
  check(scen, mock.state.requests.length === n0, "«Annulla» non chiede niente al server");
  await $panel(page, "#collapse").click();
  await page.waitForTimeout(200);
  check(scen, (await $panel(page, ".pill.run").count()) === 0, "la pill torna quella di sempre, non più rossa");
  // si rifà da capo dalla pagina del paziente: quesito ed esami sono lì, e
  // passati i due minuti (qui accorciati) nessuno ricorda la richiesta lasciata
  await page.waitForTimeout(2300);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host .card, #psassist-host #expand", { state: "attached", timeout: 10000 });
  await page.waitForTimeout(500);
  check(scen, (await $panel(page, ".pill.run").count()) === 0 && (await $panel(page, ".card").count()) === 1,
    `passato il tempo, nessun «non confermata» per la richiesta lasciata (got: ${(await $panel(page, ".pill.run").innerText().catch(() => "niente")).replace(/\s+/g, " ")})`);
  await richieste(page);
  const q = await $panel(page, "#q").inputValue();
  const sel2 = (await $panel(page, ".selbar").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(scen, q === "febbre di origine sconosciuta" && /EMOCROMO/.test(sel2) && /PROCALCITONINA/.test(sel2),
    `sulla pagina del paziente: quesito ed esami pronti (got «${q}» · ${sel2})`);
  await context.close();
}

// La richiesta non è nemmeno nata (qui la pagina «Nuova richiesta» arriva una
// volta sbagliata): niente da ritrovare, niente da rimandare. «↻ Riprova» è
// un giro normale dalla pagina del paziente, con gli stessi esami.
async function scenarioRiprovaSenzaRichiesta(browser) {
  const scen = "riprova-senza-richiesta";
  const mock = createMock({});
  let rotta = true;
  const { context, page } = await newPage(browser, mock, {
    riscrivi: (u, html) => (rotta ? html.replace('name="RICHIESTACrea"', 'name="RICHIESTAAltra"') : html),
  });
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  const rossa = await errore(page, { su: null });
  check(scen, Object.keys(mock.state.richieste).length === 0 && /PsoEpisodioClinicoAmbulatorio/.test(page.url()),
    `nessuna richiesta nata, e si resta sulla pagina del paziente (got: ${rossa})`);
  rotta = false;
  await apriStriscia(page);
  const bott = (await $panel(page, "#riprova").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  check(scen, bott === "↻ Riprova i mancanti (2)" && (await $panel(page, "#openlist").count()) === 0,
    `«↻ Riprova i mancanti (2)», e nessun carrello da aprire (got: ${bott || "niente"})`);
  await $panel(page, "#riprova").click();
  await atterraCarrello(page, 40000);
  const rids = Object.keys(mock.state.richieste);
  check(scen, rids.length === 1, `un giro normale: una richiesta nuova (got ${rids.length})`);
  const doppi = Object.entries(mock.state.insertCount).filter(([, n]) => n !== 1);
  check(scen, Object.keys(mock.state.insertCount).length === 2 && doppi.length === 0,
    `con i due esami, una volta ciascuno (${JSON.stringify(mock.state.insertCount)})`);
  check(scen, mock.state.richieste[rids[0]].quesito === "febbre", "e lo stesso quesito");
  await context.close();
}

// Il gestionale ricarica la pagina a ogni click, e il motore muore con lei.
// Il giro però è annotato passo per passo: riprende da dov'era, su qualunque
// pagina, e quello che era IN VOLO si cerca in carrello — mai rimandato.
async function scenarioRipresa(browser) {
  const scen = "ripresa";
  const mock = createMock({});
  // la PROCALCITONINA parte lenta: si naviga via mentre il server la sta prendendo
  const { context, page } = await newPage(browser, mock, {
    ritardo: (u) => (/Insert=Inserisci/.test(u) && /PRESTAZIONE=(159|317)/.test(u) ? 2500 : 0),
  });
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, '.opt[title*="ESAME URINE"]').click();
  await $panel(page, "#go").click();

  // mentre gira, il pannello è una striscia: chi, a che punto, che cosa sta facendo
  await page.waitForSelector("#psassist-host .pill.run", { timeout: 15000 });
  check(scen, (await page.locator("#psassist-host .card").count()) === 0,
    "mentre gira il pannello è una striscia, non il pannello intero");
  // si aspetta che stia mandando PROPRIO la PCT (quella lenta): così la
  // navigazione la coglie in volo, sempre, non a caso
  const vivo = await (await page.waitForFunction(() => {
    const r = document.getElementById("psassist-host")?.shadowRoot;
    const t = (r?.querySelector(".pill.run")?.innerText || "").replace(/\s+/g, " ");
    return /PROCALCITONINA/.test(t) && /invio/i.test(t) ? t : false;
  }, { timeout: 20000 })).jsonValue();
  check(scen, /ROSSI MARIO/.test(vivo) && /esame \d di 3/.test(vivo) && /invio/i.test(vivo),
    `la striscia dice paziente, passo e che cosa sta facendo (got: ${vivo})`);
  check(scen, (await page.locator("#psassist-host #stopbtn").count()) === 1, "e si può fermare da lì");

  // …e si naviga via, come farebbe un click qualunque del gestionale
  await page.goto(mock.worklistUrl);
  await page.waitForSelector("#psassist-host .pill.run", { timeout: 15000 });
  const ripresa = (await $panel(page, ".pill.run").innerText()).replace(/\s+/g, " ");
  check(scen, /ROSSI MARIO/.test(ripresa) && /esame \d di 3|\d esami/.test(ripresa),
    `il giro riprende da solo sulla pagina nuova, e la striscia resta (got: ${ripresa})`);

  // e si cambia pagina un'altra volta, mentre manda l'ultimo: si riprende
  // quante volte serve, senza mai rimandare niente
  await page.waitForFunction(() => {
    const t = document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run")?.innerText || "";
    return /ESAME URINE/.test(t) && /invio/i.test(t);
  }, { timeout: 30000 });
  await page.goto(mock.patientUrl);
  // finito: la striscia lo dice, la finestra resta chiusa
  const fine = await striscia(page, /esami in carrello/, 40000);
  check(scen, /aprilo quando vuoi/.test(fine), `e il carrello è lì quando vuoi (got: ${fine})`);
  const rid = Object.keys(mock.state.richieste)[0];
  const carrello = [...mock.state.richieste[rid].cart.keys()].sort();
  check(scen, JSON.stringify(carrello) === JSON.stringify(["159", "317", "320"]),
    `tutti e tre gli esami sono in carrello (got ${carrello})`);
  const doppi = Object.entries(mock.state.insertCount).filter(([, n]) => n !== 1);
  check(scen, doppi.length === 0, `ogni esame inviato UNA volta sola (${JSON.stringify(mock.state.insertCount)})`);
  check(scen, [...mock.state.requests.filter((q) => q.params.Insert === "Inserisci")].length === 3,
    "tre inserimenti in tutto, quanti sono gli esami");
  check(scen, !/RcsRichiestaPrestazioniRicercaErogatore/.test(page.url()),
    "e il pannello non si riprende la pagina: resti dove sei, il carrello non si apre da solo");
  await $panel(page, ".pill.run").click();
  await page.waitForSelector("#psassist-host .card", { timeout: 5000 });
  const reg = await $panel(page, ".card").innerText();
  check(scen, /riprendo il giro/.test(reg), "il Registro dice che ha ripreso");
  check(scen, /ritrovato ✓ PROCALCITONINA|già presente ✓ PROCALCITONINA/.test(reg),
    `e che l'esame in volo è stato ritrovato, non rimandato (got: ${JSON.stringify(reg.split("\n").filter((l) => /PROCALCITONINA/.test(l)))})`);
  check(scen, (reg.match(/aggiungo → /g) || []).length === 3,
    `nel Registro un solo «aggiungo» per esame (${(reg.match(/aggiungo → /g) || []).length})`);
  check(scen, /Apri il carrello/.test(reg), "il carrello si apre col bottone, quando vuoi tu");
  await shot(page, scen);
  await context.close();
}

// L'esame che era in volo e che il server NON ha preso: non si rimanda, si
// dice. Un secondo invio sarebbe una provetta in più.
async function scenarioRipresaInVoloPerso(browser) {
  const scen = "ripresa-in-volo";
  const mock = createMock({ neverAdd: ["159"] });   // il server perde la PCT
  const { context, page } = await newPage(browser, mock, {
    ritardo: (u) => (/Insert=Inserisci/.test(u) && /PRESTAZIONE=159/.test(u) ? 2500 : 0),
  });
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, '.opt[title*="ESAME URINE"]').click();
  await $panel(page, "#go").click();
  await page.waitForFunction(() => /invio/.test(document.getElementById("psassist-host")
    ?.shadowRoot?.querySelector(".pill.run .l2")?.textContent || ""), { timeout: 20000 });
  await page.goto(mock.worklistUrl);
  // ripreso sulla lista del PS: l'errore lo dice la striscia rossa, e la
  // pagina dove sei non te la porta via
  const rossa = await errore(page, { su: null, timeout: 40000 });
  // la PCT era partita (in volo): non «manca», è da controllare — chi la
  // aggiungesse a mano potrebbe ordinarla due volte
  check(scen, /Mancano: ESAME URINE/.test(rossa) && /Da controllare: PROCALCITONINA/.test(rossa) && !/Mancano:[^·]*PROCALCITONINA/.test(rossa),
    `la striscia dice cosa manca e cosa è da controllare (got: ${rossa})`);
  await page.waitForTimeout(800);
  check(scen, !/RcsRichiestaPrestazioniRicercaErogatore/.test(page.url()), "e resti sulla pagina dove eri");
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.insertCount[`${rid}:159`] === 1, "l'esame in volo NON viene rimandato");
  check(scen, !mock.state.insertCount[`${rid}:317`], "e il giro si ferma lì: niente esami dopo");
  await apriStriscia(page);
  await page.waitForSelector("#psassist-host .banner.err", { timeout: 10000 });
  const err = await $panel(page, ".banner.err").innerText();
  check(scen, /invio interrotto dal cambio pagina/i.test(err) && /controlla/i.test(err),
    `e lo dice con parole chiare (got: ${err.replace(/\s+/g, " ").slice(0, 80)})`);
  // La richiesta c'è, ma tu non sei sul suo carrello: niente «Riprova», prima
  // «Apri il carrello e controlla» — e lì, col resoconto, «Riprova» compare.
  check(scen, (await $panel(page, "#riprova").count()) === 0 && (await $panel(page, "#openlist").count()) === 1,
    "lontano dal carrello niente «Riprova»: prima si apre il carrello");
  await $panel(page, "#openlist").click();
  await errore(page);
  await apriStriscia(page);
  const rip = (await $panel(page, "#riprova").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  check(scen, rip === "↻ Riprova i mancanti (1)", `sul carrello, col resoconto, «↻ Riprova i mancanti (1)» (got: ${rip || "niente"})`);
  await $panel(page, "#riprova").click();
  await striscia(page, /Conferma dal gestionale/, 40000).catch(() => "");
  check(scen, mock.state.insertCount[`${rid}:317`] === 1 && mock.state.insertCount[`${rid}:159`] === 1,
    `riprovando parte l'ESAME URINE, e la PCT da controllare non si rimanda (${JSON.stringify(mock.state.insertCount)})`);
  await context.close();
}

// Due interruzioni di fila sullo STESSO esame in volo: deve restare «in volo»
// anche alla seconda ripresa. Se scivolasse fra i «già fatti», un esame mai
// partito verrebbe saltato in silenzio e la richiesta confermata senza.
async function scenarioRipresaDueVolteInVolo(browser) {
  const scen = "ripresa-due-volte";
  const mock = createMock({ neverAdd: ["159"] });   // il server non prende mai la PCT
  const { context, page } = await newPage(browser, mock, {
    ritardo: (u) => (/Insert=Inserisci/.test(u) && /PRESTAZIONE=159/.test(u) ? 2500 : 0),
  });
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, '.opt[title*="ESAME URINE"]').click();
  await $panel(page, "#go").click();
  const inVolo = () => page.waitForFunction(() => {
    const t = document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run")?.innerText || "";
    return /PROCALCITONINA/.test(t) && /invio|controllo/i.test(t);
  }, { timeout: 25000 });
  await inVolo();
  await page.goto(mock.worklistUrl);          // prima interruzione
  await inVolo();
  await page.goto(mock.patientUrl);           // seconda, mentre lo sta cercando
  // ripreso sulla scheda dello stesso paziente: l'errore porta sul carrello
  await errore(page, { timeout: 45000 });
  await apriStriscia(page);
  await page.waitForSelector("#psassist-host .banner.err", { timeout: 10000 });
  const err = await $panel(page, ".banner.err").innerText();
  check(scen, /invio interrotto dal cambio pagina/i.test(err),
    `dopo due interruzioni l'esame in volo si ferma ancora (got: ${err.replace(/\s+/g, " ").slice(0, 70)})`);
  check(scen, !/non è più in carrello/i.test(err), "e NON viene scambiato per uno tolto a mano");
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.insertCount[`${rid}:159`] === 1, "inviato una volta sola, mai rimandato");
  check(scen, mock.state.richieste[rid].confirmed === false, "e la richiesta NON viene confermata senza di lui");
  await context.close();
}

// La seconda sede (OSG) non ha il laboratorio «Urgenze»: gli esami di quella
// colonna stanno nel laboratorio unico. La PCR deve andare lì — non nel POC,
// che è un altro strumento — e cercando «PCR» si deve trovare quella.
async function scenarioSedeOSG(browser) {
  const scen = "sede-osg";
  const mock = createMock({ sedeOSG: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);

  // la ricerca: «PCR» trova PROTEINA C REATTIVA, prima del POC, e solo di questa sede
  await $panel(page, "#acq").fill("PCR");
  await page.waitForSelector("#psassist-host .acitem", { timeout: 5000 });
  const voci = await page.locator("#psassist-host .acitem").allInnerTexts();
  const prima = (voci[0] || "").replace(/\s+/g, " ");
  check(scen, /PROTEINA C REATTIVA/.test(prima) && !/POC/.test(prima),
    `scrivendo PCR la prima voce è la PCR di laboratorio (got: ${prima})`);
  const ids = await page.locator("#psassist-host .acitem").evaluateAll((els) => els.map((e) => e.getAttribute("data-res")));
  check(scen, ids.every((r) => r === OSG.POC || r === OSG.LAB),
    `solo esami di questa sede, niente doppioni dell'altra (got ${[...new Set(ids)].join(",")})`);
  check(scen, !voci.some((v) => /0029000|0065000/.test(v)), "e le risorse hanno un nome, non un numero");
  await $panel(page, "#acq").fill("");

  // il bottone PCR (colonna Urgenze) a OSG va nel laboratorio unico
  await $panel(page, "#q").fill("febbre");
  await $panel(page, '.opt[title*="PROTEINA C REATTIVA"]').click();
  await $panel(page, "#go").click();
  const fine = await striscia(page, /in carrello|Errore/, 30000);
  const rid = Object.keys(mock.state.richieste)[0];
  const carrello = [...mock.state.richieste[rid].cart.entries()];
  check(scen, carrello.length === 1 && carrello[0][1] === OSG.LAB && carrello[0][0] === "293",
    `la PCR è nel laboratorio unico, non nel POC (got ${JSON.stringify(carrello)})`);
  check(scen, !Object.keys(mock.state.insertCount).some((k) => k.endsWith(":266")), "la PCR POC non viene nemmeno tentata");
  check(scen, !/Errore/.test(fine), `nessun errore di risorsa (got: ${fine})`);
  await context.close();
}

async function scenarioEpisodeSwap(browser) {
  const scen = "episode-swap";
  // after 3 handled requests every page belongs to ANOTHER episode:
  // the wrong-patient guard must abort BEFORE any Insert is sent
  const mock = createMock({ swapEpisodeAfter: 3 });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  // un episodio che non torna: striscia rossa, e la scheda NON va su un
  // carrello che potrebbe essere di un altro paziente
  await errore(page, { su: null });
  await page.waitForTimeout(600);
  check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()), "resta sulla pagina del paziente");
  await apriStriscia(page);
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
  await richieste(page);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  // sessione scaduta: solo la striscia rossa, nessun salto di pagina
  const rossa = await errore(page, { su: null });
  check(scen, /Sessione scaduta/.test(rossa), `la striscia dice che la sessione è scaduta (got: ${rossa})`);
  await apriStriscia(page);
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
  await richieste(page);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  await errore(page, { su: null });
  await page.waitForTimeout(500);
  check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()), "nessun salto di pagina con la sessione scaduta");
  await apriStriscia(page);
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
  await richieste(page);
  await page.click('a[title="Richieste Laboratorio"]');
  await page.fill('form[name="RICHIESTACrea"] textarea[name="QUESITO_DIAGNOSTICO"]', "febbre");
  await page.click('form[name="RICHIESTACrea"] input[name="Update"]');
  await page.waitForSelector('form[name="Prestazioni"]', { timeout: 20000 });
  await page.waitForSelector("#psassist-host", { state: "attached" });
  // now use the panel ON the exam page: one POC chip + one URGENZE chip → resource switch
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  await atterraCarrello(page);   // la striscia sul carrello: il giro è finito
  await page.waitForURL(/RISORSA_ID=00720001P/, { timeout: 20000 }); // lands on the last resource used
  const r = Object.values(mock.state.richieste)[0];
  check(scen, r.cart.has("320") && r.cart.has("159"), `carrello con POC+URGENZE (got ${[...r.cart.keys()]})`);
  check(scen, r.cart.get("159") === RES.URGENZE, "PCT aggiunta sulla risorsa giusta (URGENZE)");
  // MANUAL native Conferma must also arm the print handoff (server then
  // redirects to the patient page, where the wizard fires)
  await page.click('form[name="Prestazioni"] input[name="Update"]');
  await page.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 20000 });
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  check(scen, /Etichette provette/.test(await docStampa(page)), "conferma manuale → stampa automatica sulla pagina paziente");
  // Arrivate le etichette, la scheda le mostra coi comandi di sempre.
  // I pulsanti: uno per verbo, niente doppioni. «Avanti» e «Salta» facevano
  // esattamente la stessa cosa e stavano uno accanto all'altro.
  await attendiAnteprima(page);
  check(scen, /Etichette provette/.test(await anteprima(page)), "la scheda mostra le etichette in anteprima");
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
  await richieste(page);
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
  await richieste(page);
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
// La stampa non ha più una finestra: il PDF va in una cornice nascosta e si
// apre il dialogo del browser. Che documento è in stampa lo dice data-doc.
const docStampa = (page) => page.evaluate(() => document.getElementById("psassist-print")?.dataset.doc || "");
// Chiuso il dialogo di stampa il browser manda «afterprint», e si passa al
// documento dopo: qui lo si manda come lo manda lui, a stampa chiesta. Se
// invece ci sono i comandi a vista (visualizzatore, stampa non partita) si
// preme «→ Avanti».
async function avanti(page) {
  const prima = await docStampa(page);
  await page.waitForFunction(() => {
    const w = document.getElementById("psassist-print");
    return !w || w.dataset.stato === "stampo" || w.dataset.stato === "mano";
  }, null, { timeout: 25000 });
  const st = await page.evaluate(() => document.getElementById("psassist-print")?.dataset.stato || "");
  if (!st) return;
  if (st === "mano") await $wiz(page, "#pwnext").click();
  else {
    await page.waitForTimeout(600);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  }
  await page.waitForFunction((p) => {
    const w = document.getElementById("psassist-print");
    return !w || w.dataset.doc !== p;
  }, prima, { timeout: 8000 });
}
async function scenarioPrintManual(browser) {
  const scen = "print-manual";
  const mock = createMock({ seedConfirmed: true });
  // i PDF arrivano lenti: si vede che mentre arrivano non c'è niente davanti
  const { context, page } = await newPage(browser, mock, { ritardo: lentiStampa });
  await page.goto(mock.patientUrl);
  await richieste(page);
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const stampante = () => page.evaluate(() => document.getElementById("psassist-print")?.dataset.printer || "");
  let head = await docStampa(page);
  check(scen, /Stampa 1 di 2 — Etichette provette/.test(head) && /etichettatrice/.test(await stampante()), `job 1 = etichette → etichettatrice (got: ${head.slice(0, 70)})`);
  // mentre il PDF arriva, a pannello aperto lo stato sta in un riquadrino: niente davanti
  check(scen, await nienteDavanti(page) && (await $panel(page, ".card").count()) === 1
    && /Aspetto le etichette/.test(await $wiz(page, ".ps:not([hidden])").innerText().catch(() => "")),
    "mentre le etichette arrivano: il pannello resta com'era, un riquadrino dice a che punto è");
  await attendiAnteprima(page);
  const vista = await anteprima(page);
  check(scen, /Stampa 1 di 2 — Etichette provette/.test(vista) && /→ etichettatrice/.test(vista),
    `arrivate: la scheda col PDF in anteprima e la stampante da scegliere (got: ${vista || "niente"})`);
  check(scen, (await $wiz(page, ".ps:not([hidden])").count()) === 0, "e il riquadrino si toglie di mezzo");
  await page.waitForTimeout(1800); // fallback print attempt fires even without a PDF viewer
  check(scen, Number(await page.locator("#psassist-print").getAttribute("data-print-attempts")) >= 1, "print dialog richiesto automaticamente");
  check(scen, hits(mock, "RcsStampaEtichetteLISHMIMU.do") === 1, "PDF etichette scaricato una volta");
  await $wiz(page, "#pwnext").click();
  head = await docStampa(page);
  check(scen, /Stampa 2 di 2 — Lista esami/.test(head) && /stampante normale/.test(await stampante()), `job 2 = lista → stampante normale (got: ${head.slice(0, 70)})`);
  check(scen, await nienteDavanti(page), "«→ Avanti»: la scheda se ne va finché la lista non arriva");
  await attendiAnteprima(page);
  const vista2 = await anteprima(page);
  check(scen, /Stampa 2 di 2 — Lista esami/.test(vista2) && /→ stampante normale/.test(vista2), `poi la lista in anteprima (got: ${vista2 || "niente"})`);
  check(scen, hits(mock, "REPORT=RcsRichiesta&") === 1, "PDF lista esami scaricato una volta");
  await avanti(page);
  await page.waitForTimeout(300);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "stampa chiusa a fine sequenza");
  await context.close();
}

async function scenarioPrintMultiLab(browser) {
  const scen = "print-multi-lab";
  // POC + URGENZE in one richiesta → the LIS splits it into two rows
  // (RICHIESTA_PROG 1 and 2): ALL four PDFs must be printed, labels first.
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("febbre di origine sconosciuta");
  await $panel(page, '.opt[title*="TROPONINA"]').click();      // POC
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click(); // URGENZE
  await $panel(page, "#goconfirm").click();
  // confirm → patient page; the wizard is the signal
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 });

  const heads = [];
  for (let k = 0; k < 4; k++) {
    heads.push(`${await docStampa(page)} → ${await page.evaluate(() => document.getElementById("psassist-print")?.dataset.printer || "")}`);
    await avanti(page);
  }
  check(scen, /Stampa 1 di 4 — Etichette provette — riga 1/.test(heads[0]) && /etichettatrice/.test(heads[0]),
    `job 1: etichette riga 1 → etichettatrice (got: ${heads[0]})`);
  check(scen, /Stampa 2 di 4 — Etichette provette — riga 2/.test(heads[1]),
    `job 2: etichette riga 2 (got: ${heads[1]})`);
  check(scen, /Stampa 3 di 4 — Lista esami — riga 1/.test(heads[2]) && /stampante normale/.test(heads[2]),
    `job 3: lista riga 1 → stampante normale (got: ${heads[2]})`);
  check(scen, /Stampa 4 di 4 — Lista esami — riga 2/.test(heads[3]),
    `job 4: lista riga 2 (got: ${heads[3]})`);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "stampa chiusa dopo tutte e 4");

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
  await richieste(page);
  const rowTxt = await page.locator('#psassist-host [data-print="699998"]').first().innerText();
  check(scen, /prenotazione/i.test(rowTxt), `riga radiologia etichettata "prenotazione" (got: ${rowTxt.trim().slice(0, 60)})`);
  await page.locator('#psassist-host [data-print="699998"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const head = `${await docStampa(page)} → ${await page.evaluate(() => document.getElementById("psassist-print")?.dataset.printer || "")}`;
  check(scen, /Stampa 1 di 1 — Prenotazione esterna/.test(head) && /stampante normale/.test(head),
    `RX: un solo PDF prenotazione → stampante normale (got: ${head})`);
  await page.waitForTimeout(400);
  check(scen, hits(mock, "REPORT=PsoRichiestaAccertamentiRadiografici") === 1, "PDF prenotazione radiologica scaricato");
  await avanti(page);
  await page.waitForTimeout(300);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "stampa chiusa");
  await context.close();
}

async function scenarioPrintAutoOnPatient(browser) {
  const scen = "print-auto-patient";
  // field-observed default: Conferma redirects to the PATIENT page, whose
  // audited print rows are where the wizard fires
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  // countdown → confirm → back on the patient page (content-based wait)
  await page.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 30000 });
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  check(scen, /Etichette provette/.test(await docStampa(page)), "la stampa parte da sola sulla pagina paziente");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "Esc annulla la stampa");
  check(scen, !/Aspetto|Stampo/.test(await page.evaluate(() => document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run")?.innerText || "")),
    "e la striscia non dice più che sta stampando");
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
  await richieste(page);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  // la pagina intermedia coi link ora sta nella cornice invisibile: il wizard
  // deve partire lo stesso, e il medico non deve vederla passare
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 });
  check(scen, /Etichette provette/.test(await docStampa(page)), "la stampa parte dai link della pagina intermedia");
  await context.close();
}

async function scenarioPrintAutoOnReturn(browser) {
  const scen = "print-auto-return";
  // interstitial WITHOUT links: the handoff must wait and fire when the
  // doctor gets back to the patient page
  const mock = createMock({ labelsInterstitial: true, labelsBare: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#goconfirm").click();
  // La pagina intermedia non ha i link, quindi non prova niente: il programma
  // legge in sottofondo la pagina del paziente, e i fogli si prendono da lì —
  // la scheda del medico resta dov'è.
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 });
  check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()),
    `i fogli dalla pagina del paziente, e la scheda è ancora lì (got …${page.url().slice(-40)})`);
  await avanti(page); // etichette stampate
  await avanti(page); // lista stampata
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
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  await page.waitForFunction(() => Number(document.getElementById("psassist-print")?.dataset.printAttempts || 0) >= 1, { timeout: 25000 });
  check(scen, mock.state.requests.filter((q) => q.url.includes("REPORT=RcsEtichetteLIS")).length >= 1,
    "viewer inline: PDF interno raggiunto e stampato in-pannello");
  check(scen, /PsoEpisodioClinicoAmbulatorio/.test(page.url()), "il framebuster del viewer NON ha dirottato la pagina");
  await page.keyboard.press("Escape");   // Esc annulla la stampa
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
  await richieste(page);
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
  await page.keyboard.press("Escape");   // Esc annulla la stampa
  await context.close();
}

// Visto al lavoro: le etichette non uscivano mai. La pagina è 1 KB, senza
// script e senza frame — solo un <meta refresh> dentro una cella — e
// l'indirizzo del PDF porta degli apici: get_pdf('PSOWEB_HL7_…'). Tagliarlo
// al primo apice dava un indirizzo monco, ed era l'unico tentativo fatto.
async function scenarioPrintMetaViewer(browser) {
  const scen = "print-meta-viewer";
  const mock = createMock({ seedConfirmed: true, metaViewer: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  await page.waitForFunction(() => Number(document.getElementById("psassist-print")?.dataset.printAttempts || 0) >= 1, { timeout: 25000 });
  const dl = mock.state.requests.filter((q) => q.url.includes("uploaddownloadservlet") && (q.params.mimetype || "").includes("pdf"));
  check(scen, dl.length === 1, `le etichette si prendono dal rinvio della pagina (got ${dl.length} richieste buone)`);
  check(scen, /get_pdf\('PSOWEB_HL7_\d+'\)/.test(decodeURIComponent(dl[0]?.url || "")),
    `l'indirizzo arriva intero, apici compresi (got ${decodeURIComponent(dl[0]?.url || "").slice(-90)})`);
  const monchi = mock.state.requests.filter((q) => q.url.includes("uploaddownloadservlet")).length - dl.length;
  check(scen, monchi === 0, `nessun tentativo su un indirizzo tagliato (got ${monchi})`);
  check(scen, (await page.locator("#psassist-print .pwerr").count()) === 0, "e niente «apri e stampa» a mano");
  check(scen, /^blob:/.test(await page.locator("#psassist-print iframe").getAttribute("src") || ""),
    "il PDF è nel wizard, pronto da stampare");
  await page.keyboard.press("Escape");   // Esc annulla la stampa
  await context.close();
}

// Con l'etichettatrice davanti non si ha una mano libera: chiuso il dialogo di
// stampa si passa al documento dopo da soli. Il browser dice solo che il
// dialogo si è chiuso («afterprint»), non se ha stampato: qui lo si simula
// esattamente come lo manda lui.
async function scenarioPrintAvanzaDaSolo(browser) {
  const scen = "print-avanza";
  const mock = createMock({ seedConfirmed: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const titolo = () => docStampa(page);
  const attesi = (n) => page.waitForFunction(
    (k) => Number(document.getElementById("psassist-print")?.dataset.printAttempts || 0) >= k, n, { timeout: 25000 });
  await attesi(1);
  check(scen, /Stampa 1 di 2/.test(await titolo()), `si parte dal primo (got ${await titolo()})`);

  // un «afterprint» che arriva subito NON conta: sarebbe una corsa a vuoto
  // fino in fondo alla coda su un computer dove la stampa non è disponibile
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.waitForTimeout(400);
  check(scen, /Stampa 1 di 2/.test(await titolo()), `un dialogo che si chiude all'istante non fa saltare niente (got ${await titolo()})`);
  const detto = await $wiz(page, ".pw:not([hidden]) .pwhint").innerText().catch(() => "");
  check(scen, (await $wiz(page, ".pw:not([hidden]) #pwre:enabled").count()) === 1 && /non si è aperta/.test(detto),
    `e la scheda lo dice: la stampa non è partita, «🖨 Stampa» la riapre (got: ${detto})`);

  await page.waitForTimeout(600);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.waitForFunction(() => /Stampa 2 di 2/.test(document.getElementById("psassist-print")?.dataset.doc || ""),
    null, { timeout: 8000 }).catch(() => {});
  check(scen, /Stampa 2 di 2/.test(await titolo()), `chiuso il dialogo si passa al documento dopo (got ${await titolo()})`);

  await attesi(2);
  await page.waitForTimeout(700);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});
  check(scen, (await page.locator("#psassist-print").count()) === 0, "e dopo l'ultimo la stampa si chiude da sola");
  await context.close();
}

async function scenarioPrintViewerVariants(browser) {
  // Un visualizzatore che NOMINA il PDF nella pagina: si prende da lì.
  {
    const scen = "print-frameset-viewer";
    const mock = createMock({ seedConfirmed: true, framesetViewer: true });
    const { context, page } = await newPage(browser, mock);
    await page.goto(mock.patientUrl);
    await richieste(page);
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
    await richieste(page);
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
    check(scen, await page.evaluate(() => !!document.getElementById("psassist-print").shadowRoot.querySelector(".pw:not([hidden]) #pwtab.grande")),
      "la scheda si apre da sola, col bottone grande «↗ Apri e stampa»");
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
    heads.push(await docStampa(page));
    await avanti(page);
  }
  check(scen, /1 di 3 — Etichette/.test(heads[0]), `prima le etichette del laboratorio (got: ${heads[0]})`);
  check(scen, /2 di 3 — Lista esami/.test(heads[1]), `poi la lista esami (got: ${heads[1]})`);
  check(scen, /3 di 3 — Prenotazione esterna/.test(heads[2]), `infine la RX, nello stesso flusso (got: ${heads[2]})`);
  check(scen, (await page.locator("#psassist-print").count()) === 0, "una sola stampa per entrambe le richieste");
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
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print iframe", { timeout: 20000 });
  const st = await page.evaluate(() => {
    const r = document.getElementById("psassist-print").shadowRoot;
    return { src: r.querySelector("iframe")?.getAttribute("src") || "",
             err: r.querySelector(".pwerr")?.textContent || "",
             testa: document.getElementById("psassist-print").dataset.doc || "" };
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
  await avanti(page);
  check(scen, /Lista esami/.test(await docStampa(page)), "la sequenza prosegue col foglio esami");
  await page.keyboard.press("Escape");   // Esc annulla la stampa
  await context.close();
}

async function scenarioPrintWrapper(browser) {
  const scen = "print-wrapper";
  const mock = createMock({ seedConfirmed: true, etichetteWrapper: true });
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await page.locator('#psassist-host [data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  await page.waitForTimeout(800);
  check(scen, hits(mock, "REPORT=RcsEtichetteLIS") === 1, "wrapper HTML seguito fino al PDF etichette");
  await avanti(page);
  await page.waitForTimeout(400);
  check(scen, hits(mock, "REPORT=RcsRichiesta&") === 1, "poi il PDF della lista");
  await page.keyboard.press("Escape");   // Esc annulla la stampa
  await context.close();
}

async function scenarioUiErgonomics(browser) {
  const scen = "ui-ergonomics";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });

  // sticky compact selection bar: grouped plain text + count
  await $panel(page, '.chip.preset:has-text("Epatico")').click();
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  const bar = await $panel(page, ".selbar").innerText();
  check(scen, /POC:/.test(bar) && /LAB CENTRALE:/.test(bar) && /6 SELEZIONATI/.test(bar),
    `selbar compatta con gruppi e conteggio (got: ${bar.replace(/\s+/g, " ").slice(0, 80)})`);
  check(scen, (await $panel(page, ".selbar .chip").count()) === 0, "selbar è testo, non pill");

  // hover ✕ removes one exam
  await $panel(page, ".selbar .selitem").first().hover();
  await $panel(page, ".selbar .selx").first().click();
  check(scen, /5 SELEZIONATI/.test(await $panel(page, ".selbar").innerText()), "✕ al passaggio rimuove il singolo esame");

  // selecting must NOT bounce the scroll back to the top
  const posPrima = await page.evaluate(() => {
    const bd = document.getElementById("psassist-host").shadowRoot.querySelector(".bd");
    bd.scrollTop = 180;                    // the browser clamps to what fits
    return bd.scrollTop;
  });
  await $panel(page, '.opt[title*="GLUCOSIO"]').click();
  const st = await page.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".bd").scrollTop);
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
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  const pos2 = await page.evaluate(() => {
    const w = document.getElementById("psassist-host").shadowRoot.querySelector(".wrap");
    return { left: w.style.left, top: w.style.top };
  });
  check(scen, pos2.left === pos1.left && pos2.top === pos1.top, `posizione ricordata dopo reload (got ${pos2.left},${pos2.top})`);
  // doppio clic sull'intestazione → di nuovo al centro, all'85%
  await $panel(page, "#draghd").dblclick();
  const pos3 = await page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot.querySelector(".wrap").getBoundingClientRect();
    return { l: Math.round(r.left), w: Math.round(r.width), vw: innerWidth };
  });
  check(scen, Math.abs(pos3.w - pos3.vw * 0.85) < 3 && Math.abs(pos3.l - pos3.vw * 0.075) < 3,
    `doppio clic: di nuovo al centro, all'85% (${pos3.l}px, largo ${pos3.w} su ${pos3.vw})`);

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
  check(scen, /\bGPT\b/.test(optTxt) && /\bGOT\b/.test(optTxt) && /GAMMA GT/.test(optTxt) && /BILIRUBINA/.test(optTxt),
    "gli epatici si ordinano anche uno per uno, non solo col profilo");
  check(scen, /Coag POC/.test(preTxt) && /Coag/.test(preTxt), "profili rapidi: Coag POC e Coag");
  // ogni profilo sta nel gruppo del suo laboratorio; Urgenze e centrale sono un gruppo solo
  const dove = await page.evaluate(() => {
    const root = document.getElementById("psassist-host").shadowRoot;
    const gruppoDi = (el) => { let x = el; while (x && !x.classList?.contains("grouphdr")) x = x.previousElementSibling; return x ? x.textContent.trim() : "?"; };
    return {
      hdr: [...root.querySelectorAll(".grid .grouphdr")].map((h) => h.textContent.trim()),
      profili: Object.fromEntries([...root.querySelectorAll(".grid .gchips .chip.preset")].map((c) => [c.textContent.trim(), gruppoDi(c.parentElement)])),
      qrx: root.querySelector(".grid #qrx") ? gruppoDi(root.querySelector(".grid #qrx")) : null,
    };
  });
  check(scen, dove.hdr.join("|") === "POC|Lab centrale|RX", `gruppi: POC, Lab centrale, RX (got ${dove.hdr.join("|")})`);
  check(scen, dove.profili["Epatico"] === "Lab centrale" && dove.profili["Coag"] === "Lab centrale" && dove.profili["Coag POC"] === "POC",
    `Epatico e Coag sotto Lab centrale, Coag POC sotto POC (got ${JSON.stringify(dove.profili)})`);
  check(scen, dove.qrx === "RX", `quesito RX nel gruppo RX (got ${dove.qrx})`);
  const optBox = await $panel(page, ".opt").first().boundingBox();
  check(scen, optBox.height <= 34, `righe esame compatte (${Math.round(optBox.height)}px)`);
  await context.close();
}

async function scenarioContinuity(browser) {
  const scen = "continuity";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });

  // build up state, then reload: the EHR refreshes pages all the time and
  // the panel must come back exactly as it was
  await $panel(page, "#q").fill("dolore toracico irradiato");
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await page.reload();
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, (await $panel(page, "#q").inputValue()) === "dolore toracico irradiato", "quesito ripristinato dopo il refresh");
  check(scen, /2 SELEZIONATI/.test(await $panel(page, ".selbar").innerText()), "selezione ripristinata dopo il refresh");

  // run WITHOUT auto-confirm → land with the receipt → the panel's own
  // CONFERMA button presses the native one → wizard on the patient page
  await $panel(page, "#go").click();
  await atterraCarrello(page);
  await apriStriscia(page);
  await page.waitForSelector("#psassist-host #confirmnow", { timeout: 5000 });
  check(scen, (await page.locator("#psassist-host .selbar").count()) === 0, "dopo l'ordine la selezione riparte pulita");
  await $panel(page, "#confirmnow").click();
  await page.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 20000 });
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.richieste[rid].confirmed === true, "CONFERMA dal pannello = click nativo, richiesta confermata");
  check(scen, /Etichette provette/.test(await docStampa(page)), "e la stampa parte da sola");
  await context.close();
}

async function scenarioReferti(browser) {
  const scen = "referti";
  const mock = conConsulenza(createMock({}));
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host [data-esito]");

  const refs = page.locator('#psassist-host .sec:not(.reflab) [data-esito][data-kind="referto"]');
  // In elenco i referti che non sono di laboratorio; il link-archivio senza
  // REFERTO_ID è ignorato come prima. Quelli di laboratorio, qui — niente
  // tabella dei valori, niente portale — non spariscono: stanno raccolti,
  // chiusi, sotto «Laboratorio (N)».
  const rows = await refs.allInnerTexts();
  check(scen, rows.length === 2, `in elenco i referti che non sono di laboratorio (got ${rows.length}: ${rows.map((t) => t.replace(/\s+/g, " ").slice(0, 24)).join(" · ")})`);
  check(scen, !rows.some((t) => /EMOCROMOCITOMETRICO/.test(t)), "il referto LIS vero non è fra loro");
  const gruppo = page.locator("#psassist-host #reflab");
  check(scen, (await gruppo.count()) === 1 && (await gruppo.getAttribute("open")) === null
    && /Laboratorio \(1\)/i.test(await gruppo.locator("summary").innerText())
    && /EMOCROMOCITOMETRICO/.test(await gruppo.locator("[data-esito]").evaluate((e) => e.textContent)),   // chiuso: innerText è vuoto
    "senza tabella dei valori il referto di laboratorio resta, chiuso sotto «Laboratorio (1)»");
  check(scen, /referti \(2\)/i.test(await $panel(page, ".sec .lbl:has-text('Referti')").innerText()), "l'intestazione conta solo quelli mostrati");
  // il più recente in cima
  const consulenza = () => page.locator('#psassist-host [data-esito][data-kind="referto"]').nth(0);
  check(scen, /22\/08 07:45/.test(rows[0]) && /EMOGASANALISI/.test(rows[0]), `più recente in cima (got: ${rows[0]?.replace(/\s+/g, " ").slice(0, 40)})`);
  check(scen, /TC ENCEFALO/.test(rows[1]), "e sotto la TC");
  check(scen, /↗/.test(rows[0]), "il referto dichiara che si apre in una scheda");
  check(scen, (await page.locator("#psassist-host .rdot.open").count()) === 0, "nessuno ancora aperto");

  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 8000 }),
    consulenza().click(),
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
  await consulenza().click();
  await page.waitForTimeout(700);
  check(scen, context.pages().length === before && hits(mock, "bbbb2222") === reqBefore,
    "riclick torna alla scheda già aperta, senza ricaricare");

  await $panel(page, "#refreset").click();
  await page.waitForTimeout(400);
  check(scen, (await page.locator("#psassist-host .rdot.open").count()) === 0, "Resetta azzera lo stato");
  await context.close();
}

async function scenarioSoloLabEsiti(browser) {
  const scen = "esiti-senza-lab";
  // Un paziente che ha SOLO referti di laboratorio, come col bookmarklet:
  // niente estensione, niente portale, nessuna tabella dei valori. Quei
  // referti sono l'unico posto dove si vedono i risultati finali: restano,
  // chiusi sotto «Laboratorio (N)». Mai «Nessun esito» con un referto in pagina.
  const mock = conPagina(createMock({}), (html) =>
    html.replace(/<tr><td class="AFCDataTD" title="[^"]*TC ENCEFALO[\s\S]*?<\/tr>/, ""));
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host #reflab", { timeout: 10000 }).catch(() => {});
  const gruppo = page.locator("#psassist-host #reflab");
  check(scen, (await gruppo.count()) === 1 && /Laboratorio \(2\)/i.test(await gruppo.locator("summary").innerText().catch(() => "")),
    "solo referti di laboratorio e nessuna tabella: «Laboratorio (2)»");
  check(scen, (await gruppo.getAttribute("open").catch(() => "x")) === null, "chiuso: un tocco lo apre");
  check(scen, !/Nessun esito/.test(await $panel(page, ".bd").innerText()), "mai «Nessun esito» con un referto in pagina");
  check(scen, (await gruppo.locator('[data-esito][data-kind="referto"]').count()) === 2, "dentro, i due referti del laboratorio");
  check(scen, /Esiti\s*2/.test((await $panel(page, '[data-seg="esiti"]').innerText()).replace(/\s+/g, " ")),
    "e la scheda Esiti li conta");
  await gruppo.locator("summary").click();
  check(scen, (await gruppo.getAttribute("open")) !== null && await gruppo.locator("[data-esito]").first().isVisible(), "aperto, si vedono");
  await context.close();
}

async function scenarioQuesitoRx(browser) {
  const scen = "quesito-rx";
  // la radiologia ha il suo quesito: il laboratorio prende quello sopra
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await page.waitForSelector("#psassist-host #qrx", { state: "attached" });
  await $panel(page, '.opt[title*="TROPONINA"]').click();   // POC
  await $panel(page, '.opt[title*="RX TORACE ("]').first().click(); // RX
  // solo il quesito RX: la radiologia partirebbe, il laboratorio no
  await $panel(page, "#qrx").fill("sospetto PNX");
  check(scen, await $panel(page, "#go").isDisabled(), "senza il quesito del lab non parte");
  await $panel(page, "#q").fill("dolore toracico");
  check(scen, !(await $panel(page, "#go").isDisabled()), "con tutti e due parte");
  await $panel(page, "#go").click();
  for (let i = 0; i < 150; i++) {
    const r = Object.values(mock.state.richieste);
    if (r.length === 2 && r.some((x) => x.cart.has("324")) && r.some((x) => x.cart.has("35"))) break;
    await page.waitForTimeout(200);
  }
  const rich = Object.values(mock.state.richieste);
  const lab = rich.find((r) => r.cart.has("324"));
  const rx = rich.find((r) => r.cart.has("35"));
  check(scen, lab && lab.quesito === "dolore toracico", `laboratorio col suo quesito (got ${lab && JSON.stringify(lab.quesito)})`);
  check(scen, rx && rx.quesito === "sospetto PNX", `radiologia col quesito RX (got ${rx && JSON.stringify(rx.quesito)})`);
  await context.close();
}

async function scenarioQuesitoPacchetti(browser) {
  const scen = "pacchetti";
  // quesito = pacchetto di esami: il chip scrive il quesito E spunta gli esami
  const P = (c) => `${RES.POC}:${c}`, U = (c) => `${RES.URGENZE}:${c}`;
  const TORACICO = [P(320), P(325), P(176), P(220), P(134), P(324)].sort();
  const DISPNEA = [P(320), P(326), P(176), P(220), P(134), P(101), P(324), U(297)].sort();
  const ADDOME = [P(320), P(325), P(176), U(16), U(228), U(53), U(167), U(34), U(181), U(54)].sort();
  // le versioni NEW degli emogas esistono anche sul server (senza, il motore ordina le vecchie)
  const mock = createMock({ nuoveVersioni: { 3: "325", 166: "326" } });
  const { context, page } = await newPage(browser, mock);
  // l'elenco dei quesiti salvato dal medico NON ha i tre pacchetti
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem("psassist:quesiti")) {
        localStorage.setItem("psassist:quesiti", JSON.stringify(["Febbre", "Trauma", "Cefalea", "Sincope"]));
        localStorage.setItem("psassist:quesiti.ts", String(Date.now()));
      }
    } catch { /* niente */ }
  });
  await page.goto(mock.patientUrl);
  await richieste(page);

  const selezione = () => page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot
    .querySelectorAll("[data-unsel]")].map((b) => b.getAttribute("data-unsel")).sort());
  const chip = (q) => $panel(page, `.chip.q[data-q="${q}"]`);
  const acceso = async (q) => (await chip(q).getAttribute("aria-pressed")) === "true" && /\bon\b/.test(await chip(q).getAttribute("class"));
  const quesito = () => $panel(page, "#q").inputValue();
  const uguali = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mostra = (a) => a.map((k) => k.replace(RES.POC + ":", "P").replace(RES.URGENZE + ":", "U")).join(",");

  // ---- i tre pacchetti sono sempre in testa, anche se la lista salvata non li ha
  const chips = (await $panel(page, ".qchips .chip.q").allInnerTexts()).map((t) => t.trim());
  check(scen, uguali(chips.slice(0, 3), ["Dolore toracico", "Dispnea", "Dolore addominale"]),
    `i tre pacchetti sono i primi chip (got ${chips.join(" · ")})`);
  check(scen, uguali(chips.slice(3), ["Febbre", "Trauma", "Cefalea"]),
    "e dopo vengono i quesiti salvati dal medico");
  check(scen, (await selezione()).length === 0 && !(await acceso("Dolore toracico")), "all'inizio niente è scelto");

  // ---- Dolore toracico: base, PT PTT POC, troponina
  await chip("Dolore toracico").click();
  let sel = await selezione();
  check(scen, uguali(sel, TORACICO), `«Dolore toracico» sceglie esattamente i suoi esami (got ${mostra(sel)})`);
  check(scen, (await quesito()) === "Dolore toracico", `e scrive il quesito (got ${JSON.stringify(await quesito())})`);
  check(scen, await acceso("Dolore toracico") && !(await acceso("Dispnea")) && !(await acceso("Dolore addominale")),
    "il chip scelto è acceso, gli altri no");
  check(scen, /^Crea e aggiungi 6 esami/.test(await $panel(page, "#go").innerText()) && !(await $panel(page, "#go").isDisabled()),
    "e il bottone è pronto, con il quesito già scritto");
  // la coagulazione del pacchetto si vede anche nella griglia degli esami singoli
  const coag = (c) => $panel(page, `.opt[data-res="${RES.POC}"][data-code="${c}"]`);
  check(scen, (await coag(220).count()) === 1 && (await coag(134).count()) === 1
    && /\bon\b/.test(await coag(220).getAttribute("class")) && /\bon\b/.test(await coag(134).getAttribute("class")),
    "PT POC e PTT POC stanno nella griglia degli esami singoli, accesi dal pacchetto");

  // ---- un esame scelto a mano resta quando si cambia pacchetto
  await $panel(page, `.opt[data-res="${RES.POC}"][data-code="30"]`).click();     // glucosio POC
  await $panel(page, `.opt[data-res="${RES.URGENZE}"][data-code="293"]`).click(); // PCR
  await chip("Dispnea").click();
  sel = await selezione();
  check(scen, uguali(sel, [...DISPNEA, P(30), U(293)].sort()),
    `cambiando pacchetto: quelli del vecchio se ne vanno, quelli scelti a mano restano (got ${mostra(sel)})`);
  check(scen, sel.includes(P(326)) && !sel.includes(P(325)),
    "«Dispnea» ha l'EGA arteriosa e NON la venosa");
  check(scen, (await quesito()) === "Dispnea" && await acceso("Dispnea") && !(await acceso("Dolore toracico")),
    "il quesito e il chip acceso seguono il pacchetto");

  // ---- il pacchetto attivo e gli esami che ha messo sopravvivono al cambio pagina
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await richieste(page);
  check(scen, uguali(await selezione(), [...DISPNEA, P(30), U(293)].sort()) && await acceso("Dispnea"),
    "dopo il ricaricamento la scelta e il chip acceso sono rimasti");

  await chip("Dolore addominale").click();
  sel = await selezione();
  check(scen, uguali(sel, [...ADDOME, P(30), U(293)].sort()),
    `anche dopo il ricaricamento il cambio toglie solo il suo (got ${mostra(sel)})`);
  check(scen, sel.includes(U(181)) && sel.includes(U(54)) && !sel.includes(P(220)),
    "«PT PTT Fantoli» è il laboratorio non-POC (Urgenze), non il POC");

  // ---- toccarlo di nuovo toglie quesito e pacchetto, non gli esami a mano
  await chip("Dolore addominale").click();
  sel = await selezione();
  check(scen, uguali(sel, [P(30), U(293)].sort()), `di nuovo: via il pacchetto, restano i due scelti a mano (got ${mostra(sel)})`);
  check(scen, (await quesito()) === "" && !(await acceso("Dolore addominale")), "e il quesito è vuoto, il chip spento");

  // ---- un esame che il pacchetto trova già scelto a mano non se ne va con lui
  await $panel(page, `.opt[data-res="${RES.POC}"][data-code="325"]`).click();   // EGA venosa a mano
  await chip("Dolore toracico").click();
  check(scen, uguali(await selezione(), [...TORACICO, P(30), U(293)].sort()), "il pacchetto aggiunge solo quello che manca");
  await chip("Dolore toracico").click();
  sel = await selezione();
  check(scen, uguali(sel, [P(30), P(325), U(293)].sort()),
    `togliendolo resta anche l'EGA venosa scelta a mano prima (got ${mostra(sel)})`);

  // ---- un esame del pacchetto tolto a mano non torna da solo
  const togli = (k) => page.evaluate((x) => document.getElementById("psassist-host").shadowRoot.querySelector(`[data-unsel="${x}"]`).click(), k);
  await chip("Dispnea").click();
  await togli(U(297));
  sel = await selezione();
  check(scen, !sel.includes(U(297)), "un esame del pacchetto si può togliere a mano");
  await chip("Dolore addominale").click();
  sel = await selezione();
  check(scen, !sel.includes(U(297)) && !sel.includes(P(326)) && sel.includes(U(34)),
    "e al cambio non resta niente del pacchetto vecchio");

  // ---- un quesito normale scrive solo il quesito: il pacchetto lo lascia andare
  await chip("Febbre").click();
  check(scen, (await quesito()) === "Febbre" && !(await acceso("Dolore addominale")),
    "un chip normale scrive il quesito e spegne il pacchetto");
  sel = await selezione();
  check(scen, sel.includes(U(34)) && sel.includes(P(30)), "gli esami restano, ora sono del medico");
  await chip("Dispnea").click();
  await chip("Dispnea").click();
  sel = await selezione();
  check(scen, sel.includes(U(34)) && sel.includes(P(30)) && !sel.includes(P(326)),
    "e un pacchetto che arriva dopo, poi tolto, non li porta via");

  // ---- partire: il pacchetto è un ordine vero, col suo quesito
  for (const k of await selezione()) await togli(k);
  check(scen, (await selezione()).length === 0, "pulito per l'ordine vero");
  await chip("Dispnea").click();
  await coag(134).click();
  check(scen, !(await selezione()).includes(P(134)), "il PTT POC del pacchetto si toglie dalla griglia");
  await coag(134).click();
  check(scen, (await selezione()).includes(P(134)), "e si rimette");
  await $panel(page, "#go").click();
  for (let i = 0; i < 150; i++) {
    if (Object.values(mock.state.richieste).some((r) => r.cart.size >= 8)) break;
    await page.waitForTimeout(200);
  }
  const r = Object.values(mock.state.richieste)[0];
  const cart = r ? [...r.cart.keys()].sort() : [];
  check(scen, r && r.quesito === "Dispnea", `la richiesta parte col quesito del pacchetto (got ${r && JSON.stringify(r.quesito)})`);
  check(scen, uguali(cart, ["101", "134", "176", "220", "297", "320", "324", "326"].sort()),
    `in carrello i suoi otto esami, con l'EGA arteriosa e non la venosa (got ${cart})`);
  await context.close();
}

async function scenarioPacchettiCatalogo(browser) {
  const scen = "pacchetti-catalogo";
  // un catalogo a cui mancano D-dimero POC (101) e NT-proBNP (297): quelli si
  // saltano e si dicono, il resto del pacchetto si sceglie lo stesso
  const mock = createMock({});
  const { context, page, inject } = await newPage(browser, mock);
  let src = readFileSync(CONTENT, "utf8");
  const m = /const EMBEDDED_CATALOG = (\{.*\});\n/.exec(src);
  const cat = JSON.parse(m[1]);
  delete cat[RES.POC].items["101"];
  delete cat[RES.URGENZE].items["297"];
  src = src.replace(m[0], () => `const EMBEDDED_CATALOG = ${JSON.stringify(cat)};\n`);
  page.removeListener("load", inject);
  page.on("load", async () => { try { await page.addScriptTag({ content: src }); } catch { /* navigation race */ } });
  await page.goto(mock.patientUrl);
  await richieste(page);

  const selezione = () => page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot
    .querySelectorAll("[data-unsel]")].map((b) => b.getAttribute("data-unsel")).sort());
  await $panel(page, '.chip.q[data-q="Dispnea"]').click();
  const sel = await selezione();
  const atteso = ["320", "326", "176", "220", "134", "324"].map((c) => `${RES.POC}:${c}`).sort();
  check(scen, JSON.stringify(sel) === JSON.stringify(atteso), `si sceglie quello che c'è, senza inventare il resto (got ${sel.length} esami: ${sel.map((k) => k.split(":")[1]).join(",")})`);
  const avviso = (await $panel(page, ".banner.warn").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  check(scen, /Dispnea/.test(avviso) && /D-DIMERO POC/.test(avviso) && /NT PRO-BNP/.test(avviso),
    `il pannello dice cosa non ha aggiunto (got: ${avviso.slice(0, 110) || "niente"})`);
  await registro(page);
  const reg = await $panel(page, ".log").innerText();
  check(scen, (reg.match(/non ho aggiunto/g) || []).length === 1, "e lo scrive una volta sola nel Registro");
  await context.close();
}

async function scenarioLabPlusRx(browser) {
  const scen = "lab+rx";
  // lab and radiology selected together → two richieste, both confirmed, one print flow
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
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
    heads.push(await docStampa(page));
    await avanti(page);
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
  await richieste(page);
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
  // Un prelievo di cui il gestionale non dà l'ora NON sparisce: diventa la
  // colonna «?», in fondo, coi suoi valori tutti leggibili.
  const senzaOra = createMock({ withResults: true, senzaOra: true });
  const b4 = await newPage(browser, senzaOra);
  await b4.page.goto(senzaOra.patientUrl);
  await b4.page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(b4.page, '[data-seg="esiti"]').click();
  await $panel(b4.page, "#risall").click();
  await attendiTabella(b4.page, 2);
  const ignota = await b4.page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    const th = [...r.querySelectorAll(".sttab thead th")].slice(1);
    const riga = [...r.querySelectorAll(".sttab tbody tr:not(.stsez)")]
      .find((t) => t.cells[0].firstChild.textContent.trim() === "Hb");
    return { teste: th.map((t) => t.textContent.replace(/\s+/g, " ").trim()),
             ultima: th[th.length - 1]?.getAttribute("title") || "",
             hb: [...(riga?.querySelectorAll("td") || [])].map((td) => td.textContent.trim()),
             avviso: (/non dà data e ora[^.]*\./.exec(r.textContent.replace(/\s+/g, " ")) || [""])[0] };
  });
  check(scen, ignota.teste.length === 2 && /^\?/.test(ignota.teste[1]),
    `il prelievo senza ora è la colonna «?», in fondo (got ${ignota.teste.join(" | ")})`);
  check(scen, /non dà data e ora/.test(ignota.ultima), `e l'intestazione lo spiega (got ${ignota.ultima})`);
  check(scen, ignota.hb.length === 2 && ignota.hb.every((v) => /\d/.test(v)),
    `i suoi valori ci sono tutti (Hb: ${ignota.hb.join(" | ")})`);
  check(scen, /colonn/.test(ignota.avviso), `e la schermata lo dice (got ${ignota.avviso.slice(0, 90)})`);
  await b4.context.close();

  // «↺ Reset» dimentica i valori letti: la tabella sparisce, il bottone torna
  // a «⭳ Carica i valori», e una nuova lettura la ricostruisce da zero
  await $panel(page, "#valreset").click();
  await page.waitForTimeout(300);
  check(scen, (await page.locator("#psassist-host .sttab").count()) === 0 && /Carica i valori/.test(await $panel(page, "#risall").innerText()),
    "«↺ Reset» dimentica i valori letti: niente tabella, si ricomincia da «Carica i valori»");
  await $panel(page, "#risall").click();
  await attendiTabella(page, 2);
  check(scen, (await page.locator("#psassist-host .sttab thead th").count()) === 3, "e una nuova lettura ricostruisce le due colonne");

  // un tocco su un valore lo segna (giallo, poi arancio, poi via), e il segno
  // resta col paziente: dopo un ricaricamento della pagina è ancora lì
  const cella = page.locator("#psassist-host .sttab td[data-cella]").first();
  const segno = async () => ((await cella.getAttribute("class")) || "").split(/\s+/).find((c) => /^marca\d$/.test(c)) || "nessuno";
  await cella.click();
  const primo = await segno();
  await cella.click();
  const secondo = await segno();
  await cella.click();
  const terzo = await segno();
  check(scen, primo === "marca1" && secondo === "marca2" && terzo === "nessuno", `un tocco giallo, due arancio, tre via (${primo} → ${secondo} → ${terzo})`);
  await cella.click();
  const quale = await cella.getAttribute("data-cella");
  await page.reload();
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host .sttab", { timeout: 10000 });
  check(scen, (await page.locator(`#psassist-host .sttab td[data-cella="${quale}"].marca1`).count()) === 1,
    "e il segno sopravvive al ricaricamento della pagina");
  // l'unità sta fra parentesi accanto al nome, non su un rigo suo
  const nome = await $panel(page, ".sttab tbody tr:not(.stsez) th.stn").first().innerText();
  check(scen, /\(.+\)/.test(nome) && !/\n/.test(nome), `unità accanto al nome (got: ${JSON.stringify(nome)})`);
  await shot(page, scen + "-tabella");
  await context.close();
}

async function scenarioResizeAndLog(browser) {
  const scen = "resize+log";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });

  // --- ridimensionare: si tira un bordo qualsiasi, qui il sinistro ---
  const w0 = (await $panel(page, ".card").boundingBox()).width;
  const g = await $panel(page, ".rz-w").boundingBox();
  await page.mouse.move(g.x + 3, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x - 120, g.y + g.height / 2, { steps: 6 });
  await page.mouse.up();
  const w1 = (await $panel(page, ".card").boundingBox()).width;
  check(scen, w1 > w0 + 80, `tirando il bordo si allarga (${Math.round(w0)} → ${Math.round(w1)} px)`);
  await page.reload();
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  const w2 = (await $panel(page, ".card").boundingBox()).width;
  check(scen, Math.abs(w2 - w1) < 3, `la misura resta dopo il refresh (${Math.round(w2)} px)`);
  await $panel(page, "#rsz").dblclick();
  const w3 = (await $panel(page, ".card").boundingBox()).width;
  check(scen, Math.abs(w3 - 1280 * 0.85) < 4, `doppio clic sull'angolo: la misura di partenza, l'85% (${Math.round(w3)} px)`);

  // --- copy the log, with the quesito masked ---
  await $panel(page, "#q").fill("dolore toracico");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, "#go").click();
  await atterraCarrello(page);
  await apriStriscia(page);
  await page.waitForSelector("#psassist-host #confirmnow", { timeout: 5000 });
  // the Registro now lives behind the version button, on the Pazienti screen
  await $panel(page, "#back").click();
  await page.waitForSelector("#psassist-host #menubtn");
  await registro(page);
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

async function scenarioFinestra(browser) {
  const scen = "finestra";
  const mock = createMock({});
  // come al lavoro: la finestra al centro, e si arriva dal gestionale (niente spinta del pannello)
  const { context, page } = await newPage(browser, mock, { finestra: "centro", pill: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const box = () => page.evaluate(() => {
    const w = document.getElementById("psassist-host").shadowRoot.querySelector(".wrap");
    const r = w.getBoundingClientRect();
    return { l: Math.round(r.left), w: Math.round(r.width), vw: innerWidth, win: w.classList.contains("win") };
  });
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host #expand", { state: "attached" });
  check(scen, (await $panel(page, ".card").count()) === 0, "arrivando dal gestionale il pannello è la pill: la pagina si vede");
  await $panel(page, "#expand").click();
  const b1 = await box();
  check(scen, b1.win && Math.abs(b1.w - b1.vw * 0.85) < 3 && Math.abs(b1.l - b1.vw * 0.075) < 3, `un tocco sulla pill: la finestra al centro, all'85% (${b1.l}px, ${b1.w}px)`);
  await page.keyboard.press("Escape");
  check(scen, (await $panel(page, ".card").count()) === 0, "Esc la riduce alla pill");
  await $panel(page, "#expand").click();
  await page.mouse.click(8, 450);   // sul gestionale, nel bordo che si vede
  check(scen, (await $panel(page, ".card").count()) === 0, "un clic fuori dalla finestra la riduce");
  // due posizioni pronte nel menu «⋯»
  await $panel(page, "#expand").click();
  await $panel(page, "#menubtn").click();
  await $panel(page, "#winaffianca").click();
  const b2 = await box();
  check(scen, b2.l > b2.vw * 0.6 && b2.w < b2.vw * 0.4, `«Affianca a destra»: una colonna, il gestionale resta visibile (${b2.l}px, ${b2.w}px)`);
  await $panel(page, "#menubtn").click();
  await $panel(page, "#wincentra").click();
  const b3 = await box();
  check(scen, Math.abs(b3.w - b3.vw * 0.85) < 3, "«Al centro» la rimette all'85%");
  // copiato un testo da incollare nel gestionale: la finestra si toglie di mezzo
  await $panel(page, '[data-seg="eo"]').click();
  await $panel(page, '[data-eocopy]').first().click();
  await page.waitForSelector("#psassist-host #expand", { state: "attached", timeout: 3000 }).catch(() => {});
  const pill = await $panel(page, "#expand").innerText().catch(() => "");
  check(scen, /Copiato/.test(pill), `dopo «Copia» la finestra si riduce e la pill dice di incollare (got: ${pill})`);
  // sulla lista del PS la pill non porta mai il titolo della pagina
  await page.goto(mock.worklistUrl);
  await page.waitForSelector("#psassist-host #expand", { state: "attached" });
  const pl = await $panel(page, "#expand").innerText();
  check(scen, /Pazienti/.test(pl) && !/PRONTO SOCCORSO/i.test(pl), `sulla lista del PS la pill dice «Pazienti», non il titolo della pagina (got: ${pl})`);
  // ci porta il pannello (un paziente scelto dalla lista): si apre grande
  await $panel(page, "#expand").click();
  await $panel(page, '.pcard .pbtn[data-go="richieste"], [data-go="richieste"]').first().click();
  await page.waitForSelector("#psassist-host .card", { state: "attached", timeout: 15000 });
  check(scen, (await $panel(page, ".card").count()) === 1, "una pagina a cui ti porta il pannello si apre con la finestra aperta");
  await context.close();
}

async function scenarioHomePills(browser) {
  const scen = "home";
  const mock = createMock({});
  const { context, page } = await newPage(browser, mock);
  // visit patient A, then a second episode: both become pills
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, (await $panel(page, '[data-seg="esiti"].on').count()) === 1,
    "su una pagina paziente si apre sugli Esiti, non sull'elenco");
  check(scen, (await $panel(page, "#q").count()) === 0, "e non sulle Richieste: ordinare è un tocco più in là");
  // una nota su questo paziente: nell'elenco comparirà accanto al nome
  await $panel(page, "#nota").fill("allergico a penicillina\nrivalutare ore 14");
  await $panel(page, "#nota").press("Tab");
  await page.waitForTimeout(300);

  await page.goto(mock.patientUrl.replace("999001", "999002"));
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#back").click(); // to Home
  await shot(page, scen + "-lista");
  const righe = page.locator("#psassist-host .pzrow");
  const alta = (await righe.first().boundingBox()).height;
  check(scen, alta >= 40 && alta <= 48, `una riga per paziente, non una scheda (${Math.round(alta)}px)`);
  const cards = (await righe.allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
  check(scen, cards.length === 2, `due pazienti conosciuti (got ${cards.length})`);
  check(scen, /questa pagina/i.test(cards[0]), "il paziente della pagina è il primo e lo dice: «questa pagina»");
  check(scen, /visto (adesso|\d+ min fa)/.test(cards[1]), `gli altri: da quanto non li apri (got: ${cards[1]?.slice(0, 60)})`);
  // I due episodi del simulatore si chiamano uguali: le ultime cifre
  // dell'episodio li distinguono, e il ⚠ dice di fare attenzione.
  check(scen, /ROSSI MARIO · …9002/.test(cards[0]) && /ROSSI MARIO · …9001/.test(cards[1]),
    `stesso nome: si distinguono dalle ultime cifre dell'episodio (got: ${cards.map((c) => c.slice(0, 26)).join(" | ")})`);
  check(scen, (await page.locator("#psassist-host .pzrow .stom").count()) === 2, "e portano il ⚠ dello stesso cognome");
  const tip = (await righe.nth(1).locator(".pzapri").getAttribute("title")) || "";
  check(scen, /episodio 999001 · aperto (ieri )?\d\d:\d\d/.test(tip), `al passaggio del mouse: episodio e ora di apertura (got: ${tip.split("\n").slice(0, 2).join(" / ")})`);
  const desc = (await page.locator("#psassist-host .pzrow .pznota").allInnerTexts()).join("");
  // I due episodi del simulatore hanno lo stesso nome e nessun codice fiscale:
  // per il programma potrebbero essere due persone. La nota scritta «per
  // nome» NON si mostra: sul paziente sbagliato sarebbe peggio di niente.
  check(scen, desc === "",
    `due pazienti attivi con lo stesso nome e senza codice fiscale: la nota non si mostra nell'elenco (got: ${desc})`);
  check(scen, (await righe.first().boundingBox()).height <= 48, "e la riga resta una riga");
  // la ✕ per toglierlo dall'elenco compare solo passandoci sopra
  const opacitaX = () => page.evaluate(() => getComputedStyle(document.getElementById("psassist-host").shadowRoot.querySelectorAll(".pzrow .pzx")[1]).opacity);
  await page.mouse.move(5, 5);
  const primaX = await opacitaX();
  await righe.nth(1).hover();
  check(scen, primaX === "0" && (await opacitaX()) === "1", `la ✕ compare solo sulla riga sotto il mouse (${primaX} → ${await opacitaX()})`);

  // picking another patient LOADS HIS PAGE (never shows his data from here).
  // La riga porta agli Esiti — dove si arriva comunque —, «Richieste» porta
  // a ordinare: è quello che dimostra che la scelta viaggia.
  await page.locator('#psassist-host .pzrow:not(.qui) [data-go="richieste"]').click();
  await page.waitForFunction(() => /EPISODIO_ID=999001/.test(location.href), { timeout: 15000 });
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, /999001/.test(await $panel(page, ".hd .sub").innerText()), "siamo sulla pagina di quel paziente");
  check(scen, (await $panel(page, '[data-seg="richieste"].on').count()) === 1, "e si apre proprio sulla sezione scelta");

  // the panel never carries another patient's selection across
  check(scen, (await page.locator("#psassist-host .selbar").count()) === 0, "nessuna selezione trascinata da un paziente all'altro");
  await context.close();
}

// La Stanza: la stanza si disegna una volta (letti, aree, nomi), poi si
// portano i pazienti al loro posto. Tutto col mouse vero, come il medico:
// premi, trascini a passi, lasci. Ogni spostamento si annulla; «Sposta in…»
// fa lo stesso senza trascinare (tasto destro, tastiera, o il «posto» della
// Lista). La pianta è una griglia di celle uguali: a qualunque misura della
// finestra niente si sovrappone.
async function scenarioStanza(browser) {
  const scen = "stanza";
  const mock = createMock({});
  // si disegna come al lavoro: la finestra al centro, all'85%
  const { context, page } = await newPage(browser, mock, { finestra: "centro" });
  const ep2 = mock.patientUrl.replace("999001", "999002");
  const giu = async (da) => {
    const b = await da.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    return b;
  };
  const trascina = async (da, dx, dy) => {
    const b = await giu(da);
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  const portaSu = async (da, a) => {
    const s = await da.boundingBox(), t = await a.boundingBox();
    await trascina(da, t.x + t.width / 2 - (s.x + s.width / 2), t.y + t.height / 2 - (s.y + s.height / 2));
  };
  const chip = (dove, ep) => $panel(page, `${dove} .stp[data-stp="${ep}"]`);
  const tutti = async () => (await page.locator("#psassist-host .stmap .stp").count()) === 2;
  const avviso = async () => ((await $panel(page, ".stsnack").count()) ? (await $panel(page, ".stsnack span").innerText()) : "");
  const archivio = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem("psassist:" + k) || "null"), k);
  // letti e aree per nome: l'id sta nella stanza salvata
  const id = async (nome) => { const s = await archivio("stanza.v1"); return [...s.letti, ...s.aree].find((o) => o.nome === nome)?.id; };
  const letto = async (nome) => $panel(page, `[data-letto="${await id(nome)}"]`);
  // corregge a mano i pazienti salvati: come se il tempo fosse passato
  const ritocca = (ep, campi) => page.evaluate(([ep, campi]) => {
    const l = JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]");
    for (const p of l) if (!ep || p.ep === ep) Object.assign(p, campi);
    localStorage.setItem("psassist:patients.v1", JSON.stringify(l));
  }, [ep, campi]);
  const aiPazienti = async (sel) => {
    await page.waitForSelector("#psassist-host", { state: "attached" });
    await $panel(page, "#back").click();
    await $panel(page, sel).waitFor({ timeout: 10000 });
  };
  const alleStanze = () => aiPazienti(".stmap");
  const stile = (sel, prop, pseudo) => page.evaluate(([s, p, ps]) => {
    const el = document.getElementById("psassist-host").shadowRoot.querySelector(s);
    return el ? getComputedStyle(el, ps || null)[p] : null;
  }, [sel, prop, pseudo]);
  const alta = async (sel) => Math.round((await $panel(page, sel).boundingBox()).height);
  // nessun letto e nessuna area si sovrappone (i rettangoli veri, sullo schermo)
  const sovrapposti = () => page.evaluate(() => {
    const r = [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".stmap [data-letto], .stmap [data-area]")].map((el) => el.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) n++;
    }
    return { oggetti: r.length, n, w: Math.round(Math.min(...r.map((x) => x.width))) };
  });
  const menu = async (voce) => { await $panel(page, "#menubtn").click(); await $panel(page, voce).click(); };

  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.goto(ep2);
  await aiPazienti(".pzlista");
  check(scen, (await $panel(page, '[data-pazvista="lista"].on').count()) === 1, "l'elenco resta la vista di partenza");
  check(scen, (await $panel(page, ".stazioni button").count()) === 2 && (await $panel(page, ".stazioni [data-pazvista]").count()) === 2,
    "in fondo alla fila delle schede solo Lista | Stanza");
  const fila0 = await alta(".seg");
  await $panel(page, "#menubtn").click();
  check(scen, (await $panel(page, "#stmodmenu").count()) === 0, "nella Lista il menu ⋯ non offre «Modifica la stanza»");
  await $panel(page, "#menubtn").click();
  await $panel(page, '[data-pazvista="stanza"]').click();
  await $panel(page, ".stmap").waitFor({ timeout: 10000 });
  check(scen, /^Disegna la stanza$/.test(await $panel(page, "#stdisegna").innerText()) && (await $panel(page, ".stvuota small").count()) === 0,
    "stanza vuota: il titolo e il bottone «Disegna la stanza», nient'altro");
  check(scen, (await $panel(page, ".ststato").count()) === 0 && (await $panel(page, ".stazioni button").count()) === 2,
    "niente riga di suggerimenti sopra la mappa; nelle schede ancora solo Lista | Stanza");
  const fila1 = await alta(".seg");
  check(scen, (await $panel(page, ".sttray .stp").count()) === 2, "tutti e due i pazienti aspettano in «Da sistemare»");
  check(scen, (await chip(".sttray", "999002").getAttribute("class")).includes("qui") && /questa pagina/.test(await chip(".sttray", "999002").innerText()),
    "il paziente di questa pagina è segnato: «questa pagina»");
  check(scen, (await page.locator("#psassist-host .stp[data-go]").count()) === 0, "un paziente trascinabile non è un [data-go]");
  const nomi = (await page.locator("#psassist-host .sttray .stp .stp1").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
  check(scen, nomi.some((n) => /ROSSI MARIO · …9001/.test(n)) && nomi.some((n) => /ROSSI MARIO · …9002/.test(n)) && nomi.every((n) => n.includes("⚠")),
    `omonimi: ⚠, nome intero e le ultime cifre dell'episodio (got: ${nomi.join(" | ")})`);
  check(scen, !/visto/.test(await $panel(page, ".stmap").innerText()), "sulla mappa niente «visto … fa» (lo dice la Lista)");
  await $panel(page, "#menubtn").click();
  check(scen, /Modifica la stanza/.test(await $panel(page, "#stmodmenu").innerText()), "nella Stanza il menu ⋯ offre «Modifica la stanza»");
  await $panel(page, "#menubtn").click();

  // Modifica: al posto di Lista | Stanza, + Letto, + Area e Fine; la pianta intera, coi puntini
  await $panel(page, "#stdisegna").click();
  check(scen, (await $panel(page, "#stpiuletto").count()) === 1 && (await $panel(page, "#stpiuarea").count()) === 1 && (await $panel(page, "#stfine.pri").count()) === 1
    && (await $panel(page, ".stazioni [data-pazvista]").count()) === 0 && (await $panel(page, ".stazioni .pri").count()) === 1,
    "in Modifica, al posto di Lista | Stanza: + Letto, + Area e Fine (solo Fine in blu)");
  check(scen, await page.evaluate(() => document.getElementById("psassist-host").shadowRoot.activeElement?.id === "stpiuletto"), "e il fuoco va su + Letto");
  const fila2 = await alta(".seg");
  check(scen, fila0 === fila1 && fila1 === fila2 && (await alta(".stazioni")) === 32,
    `la fila delle schede non cambia altezza: Lista, Stanza, Modifica (${fila0}, ${fila1}, ${fila2}px)`);
  const griglia = () => stile(".stplan", "backgroundImage");
  check(scen, /radial-gradient/.test(await griglia()) && /Comincia con \+ Letto/.test(await $panel(page, ".stvuota").innerText()) && (await $panel(page, ".stvuota small").count()) === 0,
    "in Modifica la pianta mostra i puntini, e la stanza vuota dice da dove cominciare");
  await $panel(page, "#stpiuletto").click();
  await $panel(page, ".stbed").waitFor();
  // il letto nuovo si battezza subito; Esc tiene il nome proposto
  await $panel(page, ".stnomein").press("Escape");
  check(scen, (await $panel(page, ".stbed .stname").textContent()) === "Letto 1", "Esc lascia il nome proposto");
  await $panel(page, ".stbed .stname").click();
  await $panel(page, ".stnomein").fill("Box 1");
  await $panel(page, ".stnomein").press("Enter");
  check(scen, (await $panel(page, ".stbed .stname").textContent()) === "Box 1", "un tocco sul nome lo rende scrivibile: Box 1");
  // In Modifica la pianta intera (40 celle); fuori, solo il pezzo disegnato: la stanza piccola riempie la mappa
  const lettoM = await $panel(page, ".stbed").boundingBox(), piantaM = await $panel(page, ".stplan").boundingBox();
  const cella = (lettoM.width + 6) / 5;
  check(scen, Math.abs(piantaM.width / cella - 40) < 0.5, `in Modifica la pianta è intera: 40 celle (${Math.round(piantaM.width)}px, cella ${cella.toFixed(1)}px)`);
  await $panel(page, "#stfine").click();
  check(scen, !/radial-gradient/.test(await griglia()), "fuori da Modifica i puntini spariscono");
  const lettoN = await $panel(page, ".stbed").boundingBox(), piantaN = await $panel(page, ".stplan").boundingBox();
  check(scen, lettoN.width > lettoM.width * 1.5 && Math.abs(piantaN.width / ((lettoN.width + 6) / 5) - 7) < 0.5,
    `fuori da Modifica solo il pezzo disegnato, e il letto viene grande (${Math.round(lettoM.width)} → ${Math.round(lettoN.width)}px)`);

  // dal menu ⋯ si torna in Modifica, e il menu si chiude
  await menu("#stmodmenu");
  check(scen, (await $panel(page, ".menu").count()) === 0 && (await $panel(page, "#stfine").count()) === 1, "⋯ → «Modifica la stanza»: si torna a disegnare, e il menu si chiude");
  for (let k = 0; k < 5; k++) {
    await $panel(page, "#stpiuletto").click();
    await $panel(page, ".stnomein").press("Enter");
  }
  await $panel(page, "#stpiuarea").click();
  await $panel(page, ".stnomein").fill("Corridoio");
  await $panel(page, ".stnomein").press("Enter");
  check(scen, (await $panel(page, ".starea .stname").textContent()) === "Corridoio", "l'area nasce e si chiama Corridoio");
  check(scen, (await archivio("stanza.v1")).letti.map((l) => l.nome).join() === "Box 1,Box 2,Box 3,Box 4,Box 5,Box 6",
    "il nome proposto segue l'ultimo: dopo «Box 1» vengono «Box 2», «Box 3»…");
  const s1 = await archivio("stanza.v1");
  check(scen, s1.letti.map((l) => `${l.c},${l.r}`).join(" ") === "0,0 6,0 12,0 18,0 24,0 30,0" && s1.aree.map((a) => `${a.c},${a.r} ${a.w}×${a.h}`).join() === "0,5 8×5",
    `+ Letto e + Area: il primo posto libero, riga per riga, con una cella d'aria (got: ${s1.letti.map((l) => `${l.c},${l.r}`).join(" ")} | ${s1.aree.map((a) => `${a.c},${a.r} ${a.w}×${a.h}`).join()})`);
  check(scen, s1.letti.every((l) => Object.keys(l).sort().join() === "c,id,nome,r"),
    `si salvano celle intere, e nient'altro (got: ${Object.keys(s1.letti[0]).join(",")})`);
  check(scen, (await sovrapposti()).n === 0, "l'area nuova trova un posto libero, non sopra un letto");
  // la × solo sull'oggetto scelto o sotto il mouse; niente più ↻
  await page.mouse.move(5, 5);
  check(scen, (await stile(".stbed .stx", "opacity")) === "0" && (await stile(".starea .stx", "opacity")) === "1" && (await $panel(page, ".strot").count()) === 0,
    "la × solo sull'oggetto scelto (l'area appena fatta), e nessun ↻");
  check(scen, (await stile(".stmap .stp", "opacity")) === "0.4", "in Modifica i pazienti stanno fermi, in grigio");
  const u = (await $panel(page, ".stplan").boundingBox()).width / 40;
  await $panel(page, ".starea").hover();
  await trascina($panel(page, ".starea .strsz"), 2 * u + 3, u + 3);
  const a2 = (await archivio("stanza.v1")).aree[0];
  check(scen, a2.w === 10 && a2.h === 6, `l'area si allarga dall'angolo, di cella in cella (8×5 → ${a2.w}×${a2.h})`);
  // un letto si sposta di cella in cella: dove lo lasci, sulla griglia
  await trascina(await letto("Box 6"), 2.4 * u, 6.4 * u);
  const l5 = (await archivio("stanza.v1")).letti.find((l) => l.nome === "Box 6");
  const b5 = await (await letto("Box 6")).boundingBox(), pm = await $panel(page, ".stplan").boundingBox();
  check(scen, l5.c === 32 && l5.r === 6 && Math.abs(b5.x - pm.x - (32 * u + 3)) < 1.5 && Math.abs(b5.y - pm.y - (6 * u + 3)) < 1.5,
    `un letto si sposta di cella in cella (30,0 → ${l5.c},${l5.r})`);
  // sopra un altro non ci sta: rosso mentre lo porti, e lasciato lì torna dov'era
  const l2 = await letto("Box 2"), b2 = await l2.boundingBox(), b1 = await (await letto("Box 1")).boundingBox();
  await giu(l2);
  await page.mouse.move(b1.x + b1.width / 2 + 5, b1.y + b1.height / 2, { steps: 10 });
  const rosso = (await l2.getAttribute("class")).includes("bad");
  await page.mouse.up();
  await page.waitForTimeout(150);
  const b2dopo = await (await letto("Box 2")).boundingBox(), l2s = (await archivio("stanza.v1")).letti.find((l) => l.nome === "Box 2");
  check(scen, rosso && Math.abs(b2dopo.x - b2.x) < 1 && Math.abs(b2dopo.y - b2.y) < 1 && l2s.c === 6 && l2s.r === 0,
    "un letto lasciato sopra un altro: rosso mentre lo porti, e torna dov'era");
  await $panel(page, "#stfine").click();

  // a qualunque misura niente si sovrappone: all'85%, affiancata, alla misura minima
  const s85 = await sovrapposti();
  check(scen, s85.oggetti === 7 && s85.n === 0, `all'85%: 7 oggetti, nessuno sopra un altro (${s85.n})`);
  await menu("#winaffianca");
  const sAff = await sovrapposti();
  check(scen, sAff.oggetti === 7 && sAff.n === 0, `«Affianca a destra»: nessuno sopra un altro (${sAff.n}; il più stretto ${sAff.w}px)`);
  // affiancata la mappa non ci sta in larghezza: la rotella la porta di lato, il bordo sfuma
  // dalla parte dove c'è altro, e un paziente portato non la riporta a sinistra
  const tela = () => page.evaluate(() => {
    const c = document.getElementById("psassist-host").shadowRoot.querySelector(".stcanvas");
    return { l: Math.round(c.scrollLeft), max: c.scrollWidth - c.clientWidth, sx: c.classList.contains("sx"), dx: c.classList.contains("dx") };
  });
  const tl0 = await tela(), tb = await $panel(page, ".stcanvas").boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 30);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  const tlr = await tela();
  await page.evaluate(() => { const c = document.getElementById("psassist-host").shadowRoot.querySelector(".stcanvas"); c.scrollLeft = c.scrollWidth; });
  await page.waitForTimeout(100);
  const tl1 = await tela();
  await chip(".sttray", "999001").click({ button: "right" });
  await $panel(page, '.stmenu [data-dove^="letto:"]').first().click();
  const tl2 = await tela();
  check(scen, tl0.max > 0 && tl0.l === 0 && tl0.dx && !tl0.sx && tlr.l > 0 && tl1.l === tl1.max && tl1.sx && !tl1.dx && tl2.l === tl1.l && tl2.sx,
    `affiancata la mappa scorre di lato (rotella compresa), il bordo sfuma dove c'è altro, e dopo uno spostamento resta lì (${[tl0, tlr, tl1, tl2].map((t) => `${t.l}/${t.max}${t.sx ? "◂" : ""}${t.dx ? "▸" : ""}`).join(" → ")})`);
  await $panel(page, ".stannulla").click();
  const rsz = await $panel(page, "#rsz").boundingBox();
  await page.mouse.move(rsz.x + rsz.width / 2, rsz.y + rsz.height / 2);
  await page.mouse.down();
  await page.mouse.move(rsz.x - 700, rsz.y - 900, { steps: 8 });
  await page.mouse.up();
  const wMin = await $panel(page, ".card").boundingBox(), sMin = await sovrapposti();
  check(scen, wMin.width <= 382 && wMin.height <= 322 && sMin.oggetti === 7 && sMin.n === 0,
    `alla misura minima (${Math.round(wMin.width)}×${Math.round(wMin.height)}): nessuno sopra un altro (${sMin.n})`);
  await menu("#wincentra");

  // i pazienti al loro posto: uno nel letto, l'altro in corridoio
  await portaSu(chip(".sttray", "999001"), await letto("Box 1"));
  check(scen, /^ROSSI MARIO · …9001 in Box 1$/.test(await avviso()), `ogni spostamento si può annullare (got: ${await avviso()})`);
  await portaSu(chip(".sttray", "999002"), $panel(page, ".starea"));
  check(scen, (await chip(".stbed", "999001").count()) === 1, "trascinato su Box 1, il paziente è nel letto");
  // nel letto un cognome lungo va a capo invece di perdere l'iniziale
  await ritocca("999001", { name: "D'ALESSANDRO MARIO" });
  await page.reload();
  await aiPazienti(".stmap");
  const lungo = await page.evaluate(() => {
    const n = document.getElementById("psassist-host").shadowRoot.querySelector('.stbed .stp[data-stp="999001"] .stpn');
    return { t: n.textContent.trim(), tagliato: n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1, righe: Math.round(n.clientHeight / 18) };
  });
  check(scen, lungo.t === "D'ALESSANDRO M." && !lungo.tagliato,
    `nel letto il nome lungo va a capo, intero, invece di perdere l'iniziale (got: ${JSON.stringify(lungo)})`);
  await ritocca("999001", { name: "ROSSI MARIO" });
  await page.reload();
  await aiPazienti(".stmap");
  check(scen, (await chip(".starea", "999002").count()) === 1, "e l'altro nell'area");
  check(scen, (await $panel(page, ".sttray .stp").count()) === 0 && await tutti(), "nessuno resta da sistemare, e nessuno si perde");
  check(scen, /Tutti al loro posto/.test(await $panel(page, ".sttray").innerText()), "«Da sistemare» vuoto lo dice, e resta dov'è");
  const posti = JSON.stringify(await archivio("stanza.posti.v1"));
  check(scen, /999001/.test(posti) && !/ROSSI/.test(posti), "si salvano gli episodi, mai i nomi");
  const titolo = (await chip(".stbed", "999001").getAttribute("title")) || "";
  check(scen, /episodio 999001 · aperto/.test(titolo) && /in Box 1 dalle \d\d:\d\d/.test(titolo),
    `al passaggio del mouse: episodio, ora di apertura e da quando sta lì (got: ${titolo.split("\n").slice(1, 3).join(" / ")})`);
  const vuoto = $panel(page, ".stbed:not(.occ)").first();
  check(scen, !/vuoto/.test(await vuoto.innerText()) && (await vuoto.locator("svg.stglifo").count()) === 1
    && (await stile(".stbed:not(.occ)", "backgroundColor")) === "rgba(0, 0, 0, 0)" && (await stile(".stbed:not(.occ)", "borderTopColor")) === "rgb(227, 232, 239)"
    && (await stile(".stbed.occ", "backgroundColor")) === "rgb(255, 255, 255)",
    "un letto vuoto: il suo nome e un letto accennato, più quieto di uno occupato");

  // ricaricando resta tutto: vista, nomi, posti
  await page.reload();
  await alleStanze();
  check(scen, (await (await letto("Box 1")).locator(".stname").textContent()) === "Box 1", "il nome del letto resta dopo il ricaricamento");
  check(scen, (await chip(".stbed", "999001").count()) === 1 && (await chip(".starea", "999002").count()) === 1, "e anche chi sta dove");

  // su un letto occupato il nuovo prende il letto, chi c'era va in «Da sistemare»; si annulla
  await giu(chip(".starea", "999002"));
  const t0 = await (await letto("Box 1")).boundingBox(), cx = t0.x + t0.width / 2, cy = t0.y + t0.height / 2;
  await page.mouse.move(cx, cy, { steps: 12 });
  const etichetta = await $panel(page, ".stbed .stfuori").innerText().catch(() => "");
  const copia = await $panel(page, ".stghost").boundingBox(), nomeLetto = await (await letto("Box 1")).locator(".stname").boundingBox();
  const sopraNome = copia && nomeLetto && copia.x < nomeLetto.x + nomeLetto.width && nomeLetto.x < copia.x + copia.width && copia.y < nomeLetto.y + nomeLetto.height && nomeLetto.y < copia.y + copia.height;
  check(scen, /^ROSSI MARIO · …9001 → Da sistemare$/.test(etichetta), `sopra un letto occupato: «… → Da sistemare» (got: ${etichetta})`);
  check(scen, (await $panel(page, ".stghost").innerText()) === "ROSSI MARIO · …9002" && copia.x > cx && copia.y > cy && !sopraNome,
    "quello che si porta è solo il nome, accanto al puntatore: non copre il letto che si mira");
  await page.mouse.up();
  await page.waitForTimeout(150);
  check(scen, (await chip(".stbed", "999002").count()) === 1 && (await chip(".sttray", "999001").count()) === 1 && await tutti(),
    "lasciato su un letto occupato: il nuovo nel letto, chi c'era in «Da sistemare» (niente scambi)");
  check(scen, /^ROSSI MARIO · …9002 in Box 1 · ROSSI MARIO · …9001 da sistemare$/.test(await avviso()), `e l'avviso dice tutti e due (got: ${await avviso()})`);
  check(scen, (await $panel(page, ".stbed.qui").count()) === 1, "il letto di chi è su questa pagina ha il bordo blu");
  await $panel(page, ".stannulla").click();
  check(scen, (await chip(".stbed", "999001").count()) === 1 && (await chip(".starea", "999002").count()) === 1 && await tutti(),
    "Annulla: tutti e due tornano dov'erano");

  // lo stesso posto non è uno spostamento
  await portaSu(chip(".stbed", "999001"), await letto("Box 1"));
  check(scen, (await $panel(page, ".stsnack").count()) === 0, "lasciato dov'era: niente cambia, niente da annullare");

  // «Sposta in…» col tasto destro: i letti vuoti, quelli occupati, le aree, «Da sistemare»; in fondo «Togli dall'elenco»
  await chip(".starea", "999002").click({ button: "right" });
  await $panel(page, ".stmenu").waitFor();
  const voci = (await page.locator("#psassist-host .stmenu .stmi").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  check(scen, voci.length === 9 && voci.slice(0, 5).every((v) => /^Box [2-6] vuoto$/.test(v)) && /^Box 1 al posto di ROSSI MARIO · …9001$/.test(voci[5])
    && /^Corridoio qui ora/.test(voci[6]) && /^Da sistemare/.test(voci[7]) && /^Togli dall'elenco$/.test(voci[8])
    && (await $panel(page, '.stmenu .stmsep + [data-dove="togli"]').count()) === 1,
    `tasto destro: «Sposta in…» elenca letti, aree, «Da sistemare» e, a parte, «Togli dall'elenco» (got: ${voci.slice(4).join(" | ")})`);
  await $panel(page, '.stmenu [data-dove="tray"]').click();
  check(scen, (await chip(".sttray", "999002").count()) === 1 && (await $panel(page, ".stmenu").count()) === 0, "scelto «Da sistemare», ci va, e il menu si chiude");
  // …e da tastiera: Maiusc+F10, Invio (il primo è il primo letto vuoto)
  await chip(".sttray", "999002").focus();
  await page.keyboard.press("Shift+F10");
  await $panel(page, ".stmenu").waitFor();
  await page.keyboard.press("Enter");
  check(scen, (await chip(`[data-letto="${await id("Box 2")}"]`, "999002").count()) === 1, "da tastiera: Maiusc+F10, Invio → in Box 2");
  check(scen, await page.evaluate(() => document.getElementById("psassist-host").shadowRoot.activeElement?.getAttribute("data-stp") === "999002"),
    "e il fuoco resta sul paziente, nel posto nuovo");
  // «Togli dall'elenco»: come la ✕ della Lista, e si annulla
  await chip(".stbed", "999002").click({ button: "right" });
  await $panel(page, '.stmenu [data-dove="togli"]').click();
  const archiviato = (await archivio("patients.v1")).find((p) => p.ep === "999002");
  check(scen, (await chip(".stmap", "999002").count()) === 0 && archiviato?.arch === true && /tolto dall'elenco/.test(await avviso()),
    `«Togli dall'elenco» lo archivia, come la ✕ della Lista (got: ${await avviso()})`);
  await $panel(page, ".stannulla").click();
  check(scen, (await chip(`[data-letto="${await id("Box 2")}"]`, "999002").count()) === 1 && !(await archivio("patients.v1")).find((p) => p.ep === "999002").arch,
    "Annulla: torna in elenco, e al suo posto");

  // la Lista dice dove sta ognuno, e da lì si cambia
  await $panel(page, '[data-pazvista="lista"]').click();
  const posto = (ep) => $panel(page, `.pzrow [data-posto="${ep}"]`);
  check(scen, /Box 1/.test(await posto("999001").innerText()) && /Box 2/.test(await posto("999002").innerText()),
    "nella Lista, accanto a ognuno, il suo posto");
  await page.mouse.move(5, 5);
  const riga2 = $panel(page, ".pzrow:not(.qui)");
  const quieta = [await stile(".pzrow:not(.qui) .pzric", "color"), await stile(".pzrow:not(.qui) .pzric", "fontWeight"), await stile(".pzrow:not(.qui) .pzposto", "borderTopColor")];
  await riga2.hover();
  const accesa = [await stile(".pzrow:not(.qui) .pzric", "color"), await stile(".pzrow:not(.qui) .pzposto", "borderTopColor")];
  check(scen, quieta.join() === "rgb(91, 107, 122),500,rgba(0, 0, 0, 0)" && accesa[0] === "rgb(11, 92, 173)" && accesa[1] !== "rgba(0, 0, 0, 0)",
    `Richieste in grigio e il posto senza bordo; sulla riga sotto il mouse, azzurro e bordo (got: ${quieta.join(" ")} → ${accesa.join(" ")})`);
  const larghi = await page.locator("#psassist-host .pzposto").evaluateAll((l) => l.map((b) => Math.round(b.getBoundingClientRect().width)));
  check(scen, larghi.every((w) => w === 104), `il posto è largo uguale su ogni riga (${larghi.join(", ")}px)`);
  await posto("999001").click();
  await $panel(page, '.stmenu [data-dove="tray"]').click();
  check(scen, /—/.test(await posto("999001").innerText()), "e dalla Lista si sposta: tolto dal letto, il suo posto è «—»");
  // nella colonna stretta il nome non si taglia: la nota scende sotto, «visto…» si toglie
  await ritocca("999001", { name: "BIANCHI ANNA", pk: "cf:BNCNNA80A41F205X" });
  await page.evaluate(() => localStorage.setItem("psassist:note.v1", JSON.stringify({ "cf:BNCNNA80A41F205X": { t: "allergica alla penicillina, rivalutare alle 14 con gli esami", ts: Date.now() } })));
  await page.reload();
  await aiPazienti(".pzlista");
  await menu("#winaffianca");
  const stretta = await page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    const riga = [...r.querySelectorAll(".pzrow")].find((x) => /BIANCHI/.test(x.textContent));
    const nm = riga.querySelector(".pznm"), nota = riga.querySelector(".pznota"), visto = riga.querySelector(".stvisto");
    return { col: getComputedStyle(riga.querySelector(".pzapri")).flexDirection, tagliati: [...r.querySelectorAll(".pznm")].filter((n) => n.scrollWidth > n.clientWidth + 1).length,
             sotto: nota.getBoundingClientRect().top >= nm.getBoundingClientRect().bottom - 1, visto: Math.round(visto.getBoundingClientRect().width), alta: Math.round(riga.getBoundingClientRect().height) };
  });
  check(scen, stretta.col === "column" && stretta.sotto && stretta.tagliati === 0 && stretta.visto <= 1 && stretta.alta <= 48,
    `colonna stretta: la nota sotto il nome, nessun nome tagliato, «visto» via, la riga resta una riga (got: ${JSON.stringify(stretta)})`);
  await menu("#wincentra");
  await ritocca("999001", { name: "ROSSI MARIO", pk: "" });
  await page.evaluate(() => localStorage.removeItem("psassist:note.v1"));
  await page.reload();
  await aiPazienti(".pzlista");
  await $panel(page, '[data-pazvista="stanza"]').click();
  await $panel(page, ".stmap").waitFor();

  // × toglie l'area: chi c'era torna fra i da sistemare. Niente conferme: si annulla. Esc esce da Modifica
  await portaSu(chip(".stbed", "999002"), $panel(page, ".starea"));
  await menu("#stmodmenu");
  await $panel(page, ".starea").hover();
  await $panel(page, ".starea .stx").click();
  check(scen, (await $panel(page, ".starea").count()) === 0 && (await chip(".sttray", "999002").count()) === 1,
    "eliminata l'area, il suo paziente torna in «Da sistemare»");
  check(scen, /Eliminata l'area Corridoio/.test(await avviso()), `niente conferme: si annulla (got: ${await avviso()})`);
  await $panel(page, ".stannulla").click();
  check(scen, (await $panel(page, ".starea").count()) === 1 && (await chip(".starea", "999002").count()) === 1,
    "Annulla: l'area torna, col suo paziente");
  await page.mouse.move(5, 5);
  await page.keyboard.press("Escape");
  check(scen, (await $panel(page, "#stfine").count()) === 0 && (await $panel(page, '[data-pazvista="stanza"].on').count()) === 1 && (await $panel(page, ".card").count()) === 1,
    "Esc esce da Modifica (e la finestra resta aperta)");

  // chi non apri da 13 ore resta al suo posto, in grigio; e si sposta ancora
  await portaSu(chip(".sttray", "999001"), await letto("Box 1"));
  await ritocca("999001", { ts: Date.now() - 13 * 3600e3 });
  await page.reload();
  await alleStanze();
  check(scen, (await chip(".stbed", "999001").count()) === 1 && (await chip(".stbed", "999001").getAttribute("class")).includes("spento")
    && !!(await archivio("stanza.posti.v1"))["999001"], "non aperto da 13 ore: resta nel suo letto, in grigio");
  await portaSu(chip(".stbed", "999001"), await letto("Box 4"));
  await page.reload();
  await alleStanze();
  check(scen, (await chip(`[data-letto="${await id("Box 4")}"]`, "999001").count()) === 1, "e portato altrove ci resta, anche dopo un ricaricamento");

  // il triage letto sulla scheda: una striscia colorata, sempre la stessa; nel letto la porta il letto
  await ritocca("999002", { triage: "ARANCIONE" });
  await page.reload();
  await alleStanze();
  const barra = (sel) => page.evaluate((s) => {
    const cs = getComputedStyle(document.getElementById("psassist-host").shadowRoot.querySelector(s), "::before");
    return `${cs.content} ${cs.backgroundColor} ${cs.width} ${cs.left}`;
  }, sel);
  const nellArea = await barra('.stp[data-stp="999002"]');
  check(scen, nellArea === '"" rgb(239, 108, 0) 4px 4px' && /triage all'apertura: ARANCIONE/.test(await chip(".starea", "999002").getAttribute("title")),
    `triage ARANCIONE: la striscia dentro il bordo, e il passaggio del mouse lo dice (got: ${nellArea})`);
  await portaSu(chip(".starea", "999002"), await letto("Box 5"));
  const nelLetto = await barra(`[data-letto="${await id("Box 5")}"]`);
  check(scen, nelLetto === '"" rgb(239, 108, 0) 4px 4px' && !(await chip(".stbed", "999002").getAttribute("class")).includes("tri"),
    `nel letto la stessa striscia, una sola: la porta il letto (got: ${nelLetto})`);

  // premuto e lasciato senza muoversi apre il paziente, anche dopo mezzo secondo
  await giu(chip(".stbed", "999002"));
  await page.waitForTimeout(500);
  await page.mouse.up();
  await $panel(page, '[data-seg="esiti"].on').waitFor({ timeout: 5000 }).catch(() => {});
  check(scen, (await $panel(page, '[data-seg="esiti"].on').count()) === 1, "premuto mezzo secondo e lasciato fermo: apre il paziente (i suoi Esiti)");
  await $panel(page, "#back").click();
  await $panel(page, ".stmap").waitFor({ timeout: 10000 });

  // stesso paziente (stesso codice fiscale), due episodi: il più vecchio è «episodio precedente»
  await ritocca("999001", { ts: Date.now() });
  await ritocca("", { pk: "cf:RSSMRA58C15F205Z" });
  await page.reload();
  await alleStanze();
  check(scen, (await chip(".sttray", "999001").getAttribute("class")).includes("prec") && /episodio precedente/i.test(await chip(".sttray", "999001").innerText())
    && (await chip(".stbed", "999001").count()) === 0, "stesso codice fiscale: l'episodio più vecchio esce dal letto, «episodio precedente»");

  // un tocco fermo apre il paziente, come le righe dell'elenco: si carica la sua pagina
  await chip(".sttray", "999001").click();
  await page.waitForFunction(() => /EPISODIO_ID=999001/.test(location.href), null, { timeout: 15000 });
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, /999001/.test(await $panel(page, ".hd .sub").innerText()), "un tocco senza trascinare apre la pagina di quel paziente");
  check(scen, (await $panel(page, '[data-seg="esiti"].on').count()) === 1, "sui suoi Esiti");

  // Sulla lista del PS nessuno è «qui» — i suoi link portano l'episodio del
  // primo in elenco — e un tocco su quel primo carica davvero la sua pagina.
  await ritocca("", { pk: "" });
  await page.goto(mock.worklistUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, ".stmap").waitFor({ timeout: 10000 });
  check(scen, (await page.locator("#psassist-host .stp.qui, #psassist-host .stqui").count()) === 0, "sulla lista del PS nessun paziente è «qui»");
  await chip(".stmap", "999001").click();
  await page.waitForFunction(() => /EPISODIO_ID=999001/.test(location.href), null, { timeout: 15000 });
  check(scen, true, "e un tocco sul primo della lista apre la sua pagina");

  // la stanza salvata si ripulisce da sola; piena, lo dice
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.evaluate(() => {
    const letti = [];
    for (let r = 0; r < 24; r += 4) for (let c = 0; c < 40; c += 5) letti.push({ id: `p${c}-${r}`, c, r, nome: `L${letti.length + 1}` });
    letti.push({ id: "vecchio", x: 0.5, y: 0.5, rot: 90, nome: "Vecchio" }, { id: "sopra", c: 1, r: 1, nome: "Sopra" },
      { id: "fuori", c: 38, r: 0, nome: "Fuori" }, { id: "mezzo", c: 2.5, r: 0, nome: "Mezzo" });
    localStorage.setItem("psassist:stanza.v1", JSON.stringify({ letti, aree: [{ id: "piccola", c: 0, r: 0, w: 4, h: 3, nome: "Piccola" }] }));
  });
  await page.reload();
  await alleStanze();
  const disegnati = await page.locator("#psassist-host .stbed").evaluateAll((l) => l.map((b) => b.getAttribute("data-letto")));
  check(scen, disegnati.length === 48 && !disegnati.some((d) => ["vecchio", "sopra", "fuori", "mezzo"].includes(d)) && (await $panel(page, ".starea").count()) === 0,
    `la stanza salvata si ripulisce: fuori pianta, sopra un altro, a mezza cella o nel formato vecchio non si disegna (${disegnati.length} letti)`);
  await menu("#stmodmenu");
  await $panel(page, "#stpiuletto").click();
  check(scen, /La stanza è piena: togli o sposta qualcosa\./.test(await $panel(page, ".banner").innerText().catch(() => "")) && (await $panel(page, ".stbed").count()) === 48,
    "stanza piena: + Letto lo dice, e non mette niente sopra");
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
  check(scen, /letti 2 prelievi su 2, 1 con valori nuovi/.test(reg), "il Registro dice quanti sono stati letti e quanti sono cambiati");
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
  const mock = conConsulenza(createMock({}));
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, '[data-seg="esiti"]').click();
  await page.waitForSelector("#psassist-host [data-esito]", { timeout: 15000 });

  // the radiology row announces it opens INSIDE the panel, the other one does not
  const rx = page.locator('#psassist-host [data-esito][data-kind="referto"]', { hasText: "TC ENCEFALO" });
  check(scen, /›/.test(await rx.innerText()), "il referto RIS si apre nel pannello");
  const altro = page.locator('#psassist-host [data-esito][data-kind="referto"]', { hasText: "EMOGASANALISI" });
  check(scen, /Apri referto/.test(await altro.innerText()), "gli altri restano documenti da aprire");
  check(scen, !(await page.locator("#psassist-host .sec:not(.reflab) .rrow .rsys").allInnerTexts()).some((t) => /\bLIS\b/.test(t)),
    "nessun referto di laboratorio (LIS) fra gli altri: sta nel suo gruppo");

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
  await richieste(page);
  await page.click('a[title="Richieste Laboratorio"]');
  await page.fill('form[name="RICHIESTACrea"] textarea[name="QUESITO_DIAGNOSTICO"]', "controllo");
  await page.click('form[name="RICHIESTACrea"] input[name="Update"]');
  await page.waitForSelector('form[name="Prestazioni"]', { timeout: 20000 });
  await page.waitForSelector("#psassist-host", { state: "attached" });

  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await $panel(page, "#go").click();
  // fallisce sulla PCT: si finisce sul carrello di quella risorsa (Urgenze)
  await errore(page, { su: /RISORSA_ID=00720001P/ });

  const rid = Object.keys(mock.state.richieste)[0];
  check(scen, mock.state.insertCount[`${rid}:320`] === 1,
    `la prima corsa manda un inserimento (got ${mock.state.insertCount[`${rid}:320`]})`);
  await apriStriscia(page);
  check(scen, (await $panel(page, ".banner.err").count()) === 1, "e fallisce sull'esame che non entra");

  // «Annulla»: la selezione resta (la pagina adesso è il carrello)
  await $panel(page, "#annulla").click();
  await page.waitForSelector("#psassist-host #go", { timeout: 8000 });
  // la PCT la si aggiunge a mano: si rilancia solo l'emocromo, da questo
  // carrello (Urgenze) — il motore rilegge quello del POC dal server
  await $panel(page, '.opt[title*="PROCALCITONINA"]').click();
  await Promise.all([page.waitForEvent("load", { timeout: 30000 }), $panel(page, "#go").click()]);
  await striscia(page, /Conferma dal gestionale|Errore/, 10000);
  check(scen, mock.state.insertCount[`${rid}:320`] === 1,
    `rilanciando NON lo ordina una seconda volta (got ${mock.state.insertCount[`${rid}:320`]})`);
  const reg = await registroDi(page);
  check(scen, /già presente ✓/i.test(reg), `lo ritrova nel carrello rileggendolo dal server (got ${(/[^\n]*già presente[^\n]*/.exec(reg) || ["niente"])[0].slice(0, 80)})`);
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
  await richieste(page);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(page, "#q").fill("dispnea");
  // si parte da quella VECCHIA, presa dall'elenco completo: è il caso di chi
  // ha in memoria il codice di sempre, o di una selezione salvata prima
  await $panel(page, "#acq").fill("EMOGASANALISI VENOSA POC (");
  await $panel(page, '.acitem:has-text("EMOGASANALISI VENOSA POC (")').first().click();
  await $panel(page, "#acq").fill("");
  await $panel(page, "#go").click();
  await atterraCarrello(page).catch(() => {});

  const rid = Object.keys(mock.state.richieste)[0];
  const carrello = [...mock.state.richieste[rid].cart.keys()];
  check(scen, carrello.includes("325") && !carrello.includes("3"),
    `al server va la versione NEW, non la vecchia (got ${carrello})`);
  check(scen, mock.state.insertCount[`${rid}:3`] === undefined,
    "e la vecchia non viene nemmeno tentata");
  const reg = await registroDi(page);
  check(scen, /versione nuova/i.test(reg), `il Registro dice che ha cambiato (got ${(/[^.]*versione nuova[^.]*/i.exec(reg) || [])[0] || "niente"})`);

  // e dove la versione nuova NON c'è, si ordina la vecchia senza storie
  const m2 = createMock({});
  const { context: c2, page: p2 } = await newPage(browser, m2);
  await p2.goto(m2.patientUrl);
  await richieste(p2);
  await p2.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(p2, "#q").fill("dispnea");
  await $panel(p2, "#acq").fill("EMOGASANALISI VENOSA POC (");
  await $panel(p2, '.acitem:has-text("EMOGASANALISI VENOSA POC (")').first().click();
  await $panel(p2, "#acq").fill("");
  await $panel(p2, "#go").click();
  await atterraCarrello(p2).catch(() => {});
  const rid2 = Object.keys(m2.state.richieste)[0];
  check(scen, [...m2.state.richieste[rid2].cart.keys()].includes("3"),
    `senza versione nuova ordina la vecchia (got ${[...m2.state.richieste[rid2].cart.keys()]})`);

  // E dal verso opposto: il pannello parte dal codice NEW (è quello nel suo
  // catalogo), ma questa sede ha ancora solo il vecchio. Deve ordinare quello,
  // non fallire per un codice che qui non esiste.
  const m3 = createMock({});
  const { context: c3, page: p3 } = await newPage(browser, m3);
  await p3.goto(m3.patientUrl);
  await richieste(p3);
  await p3.waitForSelector("#psassist-host", { state: "attached" });
  await $panel(p3, "#q").fill("dispnea");
  await $panel(p3, '.opt[data-code="325"]').click();
  await $panel(p3, "#go").click();
  await atterraCarrello(p3).catch(() => {});
  const rid3 = Object.keys(m3.state.richieste)[0];
  const c3cart = [...m3.state.richieste[rid3].cart.keys()];
  check(scen, c3cart.includes("3"), `chiedendo la NEW dove non c'è, ordina quella di sempre (got ${c3cart})`);
  const reg3 = await registroDi(p3);
  check(scen, /non c'è: uso/i.test(reg3), `e il Registro dice perché (got ${(/[^.]*non c'è: uso[^.]*/i.exec(reg3) || [])[0] || "niente"})`);
  await c3.close();
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
  // una fila di pillole, nell'ordine in cui si lavora
  const pillole = (await page.locator("#psassist-host .seg > button").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
  check(scen, pillole.join("|") === "Richieste|Esiti|EO|Consensi|Dimissioni",
    `le schermate in una fila: Richieste, Esiti, EO, Consensi, Dimissioni (got ${pillole.join("|")})`);
  await $panel(page, '[data-seg="eo"]').click();
  await page.waitForSelector("#psassist-host [data-eocopy=\"base\"]", { timeout: 10000 });

  // un tocco: l'EO generale è negli appunti, per intero
  await $panel(page, '[data-eocopy="base"]').click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /^Vigile, orientato, eupnoico/.test(clip), "l'EO generale si copia con un tocco");
  check(scen, /Cute: integra, non lesioni, non esantemi\.$/.test(clip.trim()), "fino all'ultima riga");
  check(scen, await riapriDopoCopia(page), "copiato, la finestra si toglie di mezzo: la pill dice di incollare");

  // la tendina ha i casi e le frasi, e sceglierne uno copia subito
  const opzioni = await page.locator("#psassist-host #eocaso option").allInnerTexts();
  check(scen, opzioni.length === 14, `una voce vuota, nove casi e quattro frasi (got ${opzioni.length})`);
  await $panel(page, "#eocaso").selectOption("caso:vertigine");
  await page.waitForTimeout(300);
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /^Nistagmo \[assente\/orizzontale/.test(clip2) && /skew deviation assente/.test(clip2),
    "scegliere un caso lo copia da sé");
  check(scen, !/Vigile, orientato/.test(clip2), "e copia solo l'aggiunta, non l'EO generale");
  await riapriDopoCopia(page);
  const mostrato = await $panel(page, "#eotxt").innerText();
  check(scen, /HINTS: head impulse/.test(mostrato), "il testo scelto resta scritto sotto la tendina");

  // ⧉ ricopia lo stesso testo senza dover riscegliere
  await page.evaluate(() => navigator.clipboard.writeText("svuotato"));
  await $panel(page, "#eoricopia").click();
  await page.waitForTimeout(300);
  const clip3 = await page.evaluate(() => navigator.clipboard.readText());
  check(scen, /skew deviation assente/.test(clip3), "⧉ ricopia lo stesso testo");
  await riapriDopoCopia(page);

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
  await riapriDopoCopia(page);

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
  await riapriDopoCopia(page);

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
  await richieste(page);
  await page.waitForSelector("#psassist-host #q", { state: "attached" });
  await $panel(page, "#q").fill("controllo");
  await page.goto(mock.worklistUrl);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(scen, (await page.locator("#psassist-host .opt").count()) === 0, "nessun esame sulla pagina PS senza paziente");
  check(scen, (await page.locator("#psassist-host .chip.preset").count()) === 0, "nessun profilo rapido");
  check(scen, (await page.locator("#psassist-host #q, #psassist-host #acq, #psassist-host #go").count()) === 0,
    "niente quesito, ricerca o bottoni di invio");
  // l'elenco (l'etichetta «Pazienti» sta nella fila delle schede, non più nel corpo)
  check(scen, (await $panel(page, ".bd .pzrow").count()) >= 1, "mostra invece l'elenco pazienti");
  check(scen, (await $panel(page, ".hd .who").count()) === 0 && (await $panel(page, '[data-seg="home"].on').count()) === 1,
    "intestazione senza nome: qui il titolo è la scheda Pazienti, accesa");
  // i modelli non appartengono a un paziente: la loro riga c'è anche qui,
  // dove un paziente non c'è
  const qui = (await page.locator("#psassist-host .seg > button").allInnerTexts()).map((t) => t.trim());
  check(scen, qui.join("|") === "Pazienti|EO|Consensi|Dimissioni",
    `i modelli ci sono anche senza paziente, accanto ai Pazienti (got ${qui.join("|")})`);
  check(scen, (await page.locator('#psassist-host [data-seg="richieste"], #psassist-host [data-seg="esiti"]').count()) === 0,
    "Richieste ed Esiti no: qui non c'è un paziente");
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
  await richieste(page);
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
  await atterraCarrello(page);
  const r = Object.values(mock.state.richieste)[0];
  check(scen, r && r.cart.has("35"), `RX torace ordinato dalla pagina paziente (cart ${r && [...r.cart.keys()]})`);
  await context.close();
}

async function scenarioStopButton(browser) {
  const scen = "stop";
  const mock = createMock({ lagRenders: { 320: 99 } }); // verify loop gives time to press stop
  const { context, page } = await newPage(browser, mock);
  await page.goto(mock.patientUrl);
  await richieste(page);
  await $panel(page, "#q").fill("controllo");
  await $panel(page, '.opt[title*="EMOCROMOCITOMETRICO"]').click();
  await $panel(page, '.opt[title*="TROPONINA"]').click();
  await $panel(page, "#go").click();
  // si ferma dalla striscia, senza aprire niente
  await page.waitForSelector("#psassist-host .strip #stopbtn", { timeout: 10000 });
  await $panel(page, "#stopbtn").click();
  // fermato: lo dice la striscia (la finestra non si apre da sola), un tocco il resoconto
  const ferma = await striscia(page, /Interrotto/, 10000);
  check(scen, (await $panel(page, ".card").count()) === 0, `la striscia dice che è interrotto (got: ${ferma})`);
  await apriStriscia(page);
  await page.waitForSelector("#psassist-host .banner.warn", { timeout: 10000 });
  check(scen, /Interrotto/i.test(await $panel(page, ".banner.warn").innerText()), "e un tocco apre il pannello che dice che è interrotto");
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
  ["auto-confirm: dalla spedizione alle etichette senza finestra", scenarioAutoConfirm],
  ["errore a metà: striscia rossa, carrello, completa a mano", scenarioErroreCompletaAMano],
  ["errore: «↻ Riprova i mancanti» — solo quelli, una conferma", scenarioRiprova],
  ["errore in revisione: «↻ Riprova» atterra sul carrello", scenarioRiprovaRevisione],
  ["errore due volte: «↻ Riprova» di nuovo, i «da controllare» restano", scenarioRiprovaDueVolte],
  ["errore: «Annulla» tiene quesito ed esami", scenarioAnnulla],
  ["errore senza richiesta: «↻ Riprova» è un giro normale", scenarioRiprovaSenzaRichiesta],
  ["riga assente in pagina: la ricerca del gestionale", scenarioRigaCercata],
  ["conferma interrotta dalla navigazione: la pagina dopo avvisa", scenarioConfermaInterrotta],
  ["navigazione automatica: non si porta via chi scrive", scenarioNonMangiaLaScrittura],
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
  ["quesito RX distinto", scenarioQuesitoRx],
  ["quesito = pacchetto di esami", scenarioQuesitoPacchetti],
  ["pacchetto: esami fuori catalogo si dicono", scenarioPacchettiCatalogo],
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
  ["print meta-refresh viewer (apici nell'indirizzo)", scenarioPrintMetaViewer],
  ["print: chiuso il dialogo si passa al documento dopo", scenarioPrintAvanzaDaSolo],
  ["print viewer variants (frameset / id-only)", scenarioPrintViewerVariants],
  ["print hard viewer → tab fallback", scenarioPrintHardViewer],
  ["ui ergonomics (selbar/drag/scroll)", scenarioUiErgonomics],
  ["continuity + panel confirm button", scenarioContinuity],
  ["referti tabs + reset", scenarioReferti],
  ["esiti: referti di laboratorio senza tabella → «Laboratorio (N)»", scenarioSoloLabEsiti],
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
  ["riflesso: entra in carrello con un altro codice", scenarioRiflesso],
  ["il giro riprende dopo un cambio pagina", scenarioRipresa],
  ["l'esame in volo non viene mai rimandato", scenarioRipresaInVoloPerso],
  ["due interruzioni: l'in volo resta in volo", scenarioRipresaDueVolteInVolo],
  ["seconda sede (OSG): la PCR va nel laboratorio, non nel POC", scenarioSedeOSG],
  ["pagina inattesa dopo l'inserimento: rilegge il carrello", scenarioAvvisoDopoInsert],
  ["prelievi refertati: restano colonne della tabella", scenarioValoriRefertati],
  ["resize + copy log", scenarioResizeAndLog],
  ["home: patient pills", scenarioHomePills],
  ["stanza: la mappa della stanza", scenarioStanza],
  ["finestra: pill, Esc, clic fuori, affianca, copia", scenarioFinestra],
  ["no-patient page has no exams", scenarioNoPatientPage],
  ["panel titled by patient", scenarioPatientTitle],
  ["stop button", scenarioStopButton],
];

// `node test/run.mjs riflesso` gira solo gli scenari che contengono la parola:
// una suite intera per rivedere un dettaglio sono cinque minuti buttati
const solo = (process.argv[2] || "").toLowerCase();
for (const [name, fn] of scenarios.filter(([n]) => !solo || n.toLowerCase().includes(solo))) {
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
