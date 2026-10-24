#!/usr/bin/env node
/*
 * L'ordine in una scheda di sottofondo, con l'estensione VERA caricata in
 * Chromium: «Conferma e stampa» apre una seconda scheda dietro, che manda gli
 * esami, conferma con la prova e passa le etichette alla scheda dove sta il
 * medico — che intanto è andato su un altro paziente. E poi: la scheda su cui
 * il medico va sopra non si chiude; l'errore diventa una striscia rossa con
 * «apri la scheda»; «Svuota il carrello e ricomincia» dalla scheda dell'ordine;
 * la scheda chiusa a metà; due ordini in coda; la sessione scaduta; e se la
 * scheda non si apre, l'ordine lo manda la pagina come sempre.
 *   node test/ext-ordine.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-ord-" + process.pid);
const SHOTS = process.env.TEST_SHOTS_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`);
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const shot = async (page, nome) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, nome + ".png") }).catch(() => {}); };

// Due pazienti, due simulatori: ROSSI MARIO (999001) e BIANCHI ANNA (999002).
// Le richieste di BIANCHI partono da 800001, così i numeri non si confondono.
let A, B;
const nuovi = (optsA = {}) => {
  A = createMock(optsA);
  B = createMock({ name: "BIANCHI ANNA", episodeId: "999002" });
  B.state.nextRichiestaId = 800001;
};
nuovi();
const quale = (url) => {
  const p = new URL(url).searchParams;
  if (p.get("EPISODIO_ID") === "999002" || Number(p.get("RICHIESTA_ID")) >= 800000) return B;
  return A;
};
// le risposte lente servono a VEDERE il giro mentre va, e a navigare durante
let lento = 0;
let arrivati = 0;   // gli inserimenti arrivati al «server» (prima della risposta lenta)
let riscrivi = null;   // (url, html) → html: il server che si comporta in modo strano
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
// aperto, il pannello è una finestra all'85%: qui parte come colonna a destra
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 })); } catch { /* niente */ }
});
// Che cosa ha detto la striscia di ogni scheda (resta nella scheda anche
// cambiando pagina), e quante volte si è aperta una stampa in TUTTE le schede
// (localStorage è dell'origine: lo vedono tutte).
await ctx.addInitScript(() => {
  if (window.top !== window || location.origin !== "https://smarthealth.multimedica.it") return;
  setInterval(() => {
    try {
      const r = document.getElementById("psassist-host")?.shadowRoot;
      const t = (r?.querySelector(".pill.run")?.innerText || "").replace(/\s+/g, " ").trim();
      const s = JSON.parse(sessionStorage.getItem("__psaStrisce") || "[]");
      if (t && s[s.length - 1] !== t) { s.push(t); sessionStorage.setItem("__psaStrisce", JSON.stringify(s)); }
      const w = document.getElementById("psassist-print");
      if (w && !w.dataset.contato) {
        w.dataset.contato = "1";
        const l = JSON.parse(localStorage.getItem("__psaStampe") || "[]");
        l.push({ titolo: document.title, url: location.href });
        localStorage.setItem("__psaStampe", JSON.stringify(l));
      }
    } catch { /* niente */ }
  }, 25);
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  const u = req.url();
  if (/Insert=Inserisci/.test(u)) arrivati++;
  if (lento && /Insert=Inserisci/.test(u)) await new Promise((res) => setTimeout(res, lento));
  const mock = quale(u);
  let out = mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  if (riscrivi && /html/.test(out.headers["content-type"] || "")) {
    out = { ...out, body: Buffer.from(riscrivi(u, Buffer.from(out.body).toString("latin1")), "latin1") };
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa intanto */ }
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });

const ordini = () => sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []));
const attiva = () => sw.evaluate(() => chrome.tabs.query({ active: true }).then((t) => t.map((x) => x.url || "")));
const stampe = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("__psaStampe") || "[]"));
const azzeraStampe = (p) => p.evaluate(() => localStorage.setItem("__psaStampe", "[]"));
const strisce = (p) => p.evaluate(() => JSON.parse(sessionStorage.getItem("__psaStrisce") || "[]"));
const striscia = async (page, re, timeout = 30000) => {
  const h = await page.waitForFunction((src) => {
    const t = (document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run")?.innerText || "").replace(/\s+/g, " ").trim();
    return new RegExp(src).test(t) ? t : false;
  }, re.source, { timeout });
  return h.jsonValue();
};
const titoloStampa = (p) => p.evaluate(() => {
  const r = document.getElementById("psassist-print")?.shadowRoot;
  return (r?.querySelector(".pw .pwhd")?.textContent || "").replace(/\s+/g, " ").trim();
});
const conferme = (m) => m.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
const inviati = (m) => m.state.requests.filter((q) => q.params.Insert === "Inserisci");
// il pannello si apre dalla pill (si arriva dal gestionale), poi Richieste
async function ordina(page, esami, { quesito = "dolore toracico", solo = false } = {}) {
  if (!(await $panel(page, ".card").count())) {
    await $panel(page, "#expand").click();
    await page.waitForSelector("#psassist-host .card", { timeout: 8000 });
  }
  if (!(await $panel(page, "#q").count())) await $panel(page, '[data-seg="richieste"]').click();
  await $panel(page, "#q").fill(quesito);
  for (const e of esami) await $panel(page, `.opt[title*="${e}"]`).click();
  await $panel(page, solo ? "#go" : "#goconfirm").click();
}
const nuovaPagina = (timeout = 15000) => ctx.waitForEvent("page", { timeout }).catch(() => null);
async function aspettaChiusa(p, timeout = 15000) {
  if (p.isClosed()) return true;
  await p.waitForEvent("close", { timeout }).catch(() => {});
  return p.isClosed();
}
async function chiudiStampa(p) {
  await p.keyboard.press("Escape").catch(() => {});
  await p.waitForSelector("#psassist-print", { state: "detached", timeout: 5000 }).catch(() => {});
}

const doc = await ctx.newPage();   // la scheda del medico

// ---- 1. il giro in sottofondo, il medico su un altro paziente ------------
console.log("\nordine: la scheda di sottofondo manda, il medico va altrove");
{
  lento = 700;
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const worker = await nasce;
  check(!!worker, "«Conferma e stampa» apre una seconda scheda");
  const davanti = await attiva();
  check(davanti.length === 1 && /EPISODIO_ID=999001/.test(davanti[0]) && /PsoEpisodioClinicoAmbulatorio/.test(davanti[0]),
    `in sottofondo: davanti resta la scheda del medico (got ${davanti.join(" | ").slice(-60)})`);
  // il medico va subito su un altro paziente
  await doc.goto(B.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const corre = await striscia(doc, /ROSSI MARIO.*esame \d di 2/, 30000).catch(() => "");
  check(/ROSSI MARIO/.test(corre) && /esame \d di 2/.test(corre),
    `sulla pagina di BIANCHI la striscia racconta l'ordine di ROSSI: «esame N di 2» e il passo (got: ${corre || "niente"})`);
  await shot(doc, "1-striscia-altro-paziente");
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 });
  const rid = Object.keys(A.state.richieste)[0];
  check(A.state.richieste[rid]?.confirmed === true, "la richiesta è confermata");
  check(conferme(A).length === 1, `una conferma sola (got ${conferme(A).length})`);
  check(Object.values(A.state.insertCount).every((n) => n === 1) && Object.keys(A.state.insertCount).length === 2,
    `ogni esame mandato una volta (${JSON.stringify(A.state.insertCount)})`);
  check(inviati(B).length === 0 && Object.keys(B.state.richieste).length === 0, "su BIANCHI non parte niente");
  check(/EPISODIO_ID=999002/.test(doc.url()), "e il medico è ancora dove l'ha lasciato");
  await doc.waitForFunction(() => !!document.getElementById("psassist-print")?.shadowRoot?.querySelector(".pw:not([hidden]) .pwbody iframe"), null, { timeout: 15000 }).catch(() => {});
  const testa = await titoloStampa(doc);
  check(/Etichette provette/.test(testa) && /ROSSI MARIO/.test(testa) && /etichettatrice/.test(testa),
    `le etichette in anteprima nella scheda del medico, col nome di chi sono (got: ${testa})`);
  await shot(doc, "2-stampa-nella-scheda-del-medico");
  check(await aspettaChiusa(worker), "fatto il suo lavoro, la scheda di sottofondo si chiude da sola");
  const viste = await strisce(doc);
  check(viste.some((t) => /Confermata/.test(t) && /etichette/i.test(t)), `poi «Confermata · Aspetto le etichette…» (got: ${viste.slice(-4).join(" | ")})`);
  await doc.waitForTimeout(1500);
  const quante = await stampe(doc);
  check(quante.length === 1 && /BIANCHI ANNA/.test(quante[0].titolo), `la stampa si apre una volta sola, dov'è il medico (got ${JSON.stringify(quante)})`);
  check((await ordini()).length === 0, "e l'ordine non c'è più fra quelli aperti");
  const sorv = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:daConfermare.v1") || "[]"));
  check(!sorv.some((x) => x.rid === rid), "confermata con la prova: il promemoria «non confermata» se ne va");
  await chiudiStampa(doc);
  const fine = await striscia(doc, /confermat/, 5000).catch(() => "");
  check(/ROSSI MARIO/.test(fine), `il resoconto della stampa porta il nome di ROSSI, non di chi hai davanti (got: ${fine})`);
}

// ---- 2. il medico va sulla scheda dell'ordine: è sua --------------------
console.log("\nordine: la scheda su cui il medico va sopra resta");
{
  nuovi();
  lento = 600;
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  const worker = await nasce;
  await worker.waitForLoadState().catch(() => {});
  await worker.bringToFront();
  await worker.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 }).catch(() => {});
  check(conferme(A).length === 1, "confermata");
  const quante = await stampe(doc);
  check(quante.length === 1 && /ROSSI MARIO/.test(quante[0].titolo) && (await worker.locator("#psassist-print").count()) === 1,
    `la stampa si apre dove sta il medico: sulla scheda dell'ordine (got ${JSON.stringify(quante)})`);
  await worker.waitForTimeout(2500);
  check(!worker.isClosed(), "ci è andato sopra: la scheda è sua, non si chiude");
  await chiudiStampa(worker);
  await worker.close();
  await doc.bringToFront();
}

// ---- 2b. «solo carrello»: il carrello lo apri tu, nella tua scheda --------
console.log("\nordine: «solo carrello» — la scheda si chiude, il carrello si apre nella tua");
{
  nuovi();
  lento = 300;
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"], { solo: true });
  const worker = await nasce;
  await doc.goto(B.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const pronto = await striscia(doc, /2 esami in carrello.*Conferma dal gestionale/, 30000).catch(() => "");
  check(/ROSSI MARIO/.test(pronto) && (await $panel(doc, "#strazione").innerText().catch(() => "")).trim() === "apri il carrello",
    `la striscia: «✓ 2 esami in carrello · Conferma dal gestionale», e «apri il carrello» (got: ${pronto || "niente"})`);
  check(await aspettaChiusa(worker), "la scheda dell'ordine ha finito: si chiude");
  check(conferme(A).length === 0, "niente confermato da solo");
  const rid = Object.keys(A.state.richieste)[0];
  await $panel(doc, "#strazione").click();
  await doc.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 15000 });
  check(new URL(doc.url()).searchParams.get("RICHIESTA_ID") === rid && /EPISODIO_ID=999001/.test(doc.url()),
    "«apri il carrello»: il carrello della richiesta si apre nella tua scheda (una lettura)");
  await doc.waitForSelector("#psassist-host .pill.run", { timeout: 10000 });
  await $panel(doc, ".pill.run").click();
  await doc.waitForSelector("#psassist-host #confirmnow", { timeout: 10000 });
  const ricevuta = (await $panel(doc, ".banner.ok").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/2 esami in carrello, verificati/.test(ricevuta), `con la ricevuta e un bottone solo, «Conferma e stampa» (got: ${ricevuta})`);
  await $panel(doc, "#confirmnow").click();
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 });
  check(conferme(A).length === 1 && A.state.richieste[rid].confirmed === true, "confermata da te, una volta");
  await doc.waitForTimeout(1000);
  check((await stampe(doc)).length === 1, "e le etichette si stampano lì, una volta");
  await chiudiStampa(doc);
  check((await ordini()).length === 0, "nessun ordine aperto");
  lento = 0;
}

// ---- 3. errore: striscia rossa, «apri la scheda» ------------------------
console.log("\nordine: l'errore nella scheda del medico, e «apri la scheda»");
let workerErr = null;
let rotta = true;
{
  nuovi();
  lento = 0;
  riscrivi = (u, html) => (rotta ? html.replace(/PROCALCITONINA \(1690\)/g, "ANTITROMBINA III (1450)") : html);
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  workerErr = await nasce;
  await doc.goto(B.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const rossa = await striscia(doc, /ROSSI MARIO.*Errore/, 40000).catch(() => "");
  check(/oggi si chiama/.test(rossa) && /Mancano: PROCALCITONINA/.test(rossa) && (await $panel(doc, ".pill.run.err").count()) === 1,
    `la striscia del medico è rossa, col motivo corto e cosa manca (got: ${rossa || "niente"})`);
  const az = (await $panel(doc, "#strazione").innerText().catch(() => "")).trim();
  check(az === "apri la scheda", `e accanto «apri la scheda» (got: ${az || "niente"})`);
  await shot(doc, "3-striscia-rossa");
  check(!workerErr.isClosed(), "dopo un errore la scheda dell'ordine resta: lì c'è il resoconto");
  if (process.env.DEBUG_ORD) await sw.evaluate(() => {
    self.__log = [];
    const sm = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = (id, m) => { self.__log.push(["send", id, m.t]); return sm(id, m).then((r) => { self.__log.push(["resp", JSON.stringify(r)]); return r; }, (e) => { self.__log.push(["err", e.message]); throw e; }); };
  });
  await $panel(doc, "#strazione").click();
  await doc.waitForTimeout(800);
  if (process.env.DEBUG_ORD) console.log("DEBUG log", await sw.evaluate(() => JSON.stringify(self.__log)));
  const davanti = await attiva();
  check(davanti.some((u) => /RcsRichiestaPrestazioniRicercaErogatore/.test(u) && /EPISODIO_ID=999001/.test(u)),
    `«apri la scheda» porta sulla scheda dell'ordine, sul carrello della richiesta (got ${davanti.join(" | ").slice(-80)})`);
  await workerErr.waitForSelector("#psassist-host .card #svuota", { timeout: 10000 }).catch(() => {});
  const card = (await workerErr.locator("#psassist-host .card").innerText().catch(() => "")).replace(/\s+/g, " ");
  const bottoni = await workerErr.evaluate(() => [...(document.getElementById("psassist-host")?.shadowRoot?.querySelectorAll(".commit button") || [])].map((b) => b.id));
  if (process.env.DEBUG_ORD) console.log("DEBUG send", await sw.evaluate(async () => {
    const l = (await chrome.storage.session.get("ordini")).ordini || [];
    const r = l[0];
    const x = await chrome.tabs.sendMessage(r.worker, { t: "psassistMostra", id: r.id }).catch((e) => "ERR " + e.message);
    return { worker: r.worker, id: r.id, stato: r.stato, x };
  }));
  if (process.env.DEBUG_ORD) console.log("DEBUG worker", workerErr.url(), await workerErr.evaluate(() => ({ host: !!document.getElementById("psassist-host"), pill: document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill")?.innerText, card: !!document.getElementById("psassist-host")?.shadowRoot?.querySelector(".card"), avv: sessionStorage.getItem("psassist:avviso.v1") })), JSON.stringify(await ordini()).slice(0, 600));
  check(/oggi si chiama/.test(card) && ["riprova", "svuota", "chiudi"].every((b) => bottoni.includes(b)),
    `lì il resoconto intero: «↻ Riprova i mancanti», «Svuota il carrello e ricomincia», «Chiudi» (got ${bottoni.join(",")} · ${card.slice(0, 100)})`);
}

// ---- 4. «Svuota il carrello e ricomincia», dalla scheda dell'ordine ------
console.log("\nordine: svuota il carrello e ricomincia, nella scheda dell'ordine");
{
  const w = workerErr;
  const rid = Object.keys(A.state.richieste)[0];
  rotta = false;
  const n0 = A.state.requests.length;
  await w.locator("#psassist-host #svuota").click();
  const chiede = (await w.locator("#psassist-host #svuota").innerText()).trim();
  check(chiede === "Svuoto 2 esami?", `il primo tocco chiede (got: ${chiede})`);
  await shot(w, "4-svuota-armato");
  await w.locator("#psassist-host #svuota").click();
  await w.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 }).catch(() => {});
  const dopo = A.state.requests.slice(n0);
  const del = dopo.filter((q) => q.params.Delete === "Elimina");
  check(del.length >= 1 && del.every((q) => !q.params.PRESTAZIONE && q.params.MVPG === "RcsRichiestaCarrelloSvuota"
    && q.params.RICHIESTA_ID === rid && q.params.EPISODIO_ID === "999001"),
  `svuotato col «Svuota carrello» della richiesta (got ${del.map((q) => `${q.params.MVPG}/${q.params.RICHIESTA_ID}/${q.params.PRESTAZIONE || "-"}`).join(", ")})`);
  const iDel = dopo.indexOf(del[0]);
  const iIns = dopo.findIndex((q) => q.params.Insert === "Inserisci");
  const prove = new Set(dopo.slice(iDel + 1, iIns).filter((q) => q.method === "GET" && q.params.MVPG === "RcsRichiestaPrestazioniRicercaErogatore" && !q.params.Delete).map((q) => q.params.RISORSA_ID));
  check(iIns > iDel && prove.size === 3, `provato vuoto, sezione per sezione, prima di rimettere (got ${[...prove].join(", ")})`);
  const rimessi = dopo.filter((q) => q.params.Insert === "Inserisci").map((q) => q.params.PRESTAZIONE).sort();
  check(JSON.stringify(rimessi) === JSON.stringify(["159", "320", "324"]), `poi tutta la selezione, nella stessa richiesta (got ${rimessi.join(", ")})`);
  check(Object.keys(A.state.richieste).length === 1 && conferme(A).length === 1 && A.state.richieste[rid].confirmed === true,
    "e confermata, una volta");
  check([...A.state.richieste[rid].cart.keys()].sort().join(",") === "159,320,324", "con i tre esami, una volta ciascuno");
  await chiudiStampa(w);
  await w.close();
  await doc.bringToFront();
  await doc.waitForTimeout(500);
  check((await ordini()).length === 0, "finito: nessun ordine aperto");
  riscrivi = null;
}

// ---- 4b. errore, e la scheda dell'ordine chiusa: il resoconto nella tua --
// «apri la scheda» non trova più la scheda: apre il carrello nella tua, col
// resoconto intero; «Svuota il carrello e ricomincia» da lì va a una scheda
// di sottofondo nuova, e le etichette tornano da te.
console.log("\nordine: errore, scheda chiusa — il resoconto nella tua scheda, e «Svuota» da lì");
{
  nuovi();
  rotta = true;
  riscrivi = (u, html) => (rotta ? html.replace(/PROCALCITONINA \(1690\)/g, "ANTITROMBINA III (1450)") : html);
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const w1 = await nasce;
  await doc.goto(B.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await striscia(doc, /ROSSI MARIO.*Errore/, 40000).catch(() => "");
  await w1.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 10000 }).catch(() => {});
  await w1.close();
  await doc.waitForTimeout(500);
  const rid = Object.keys(A.state.richieste)[0];
  await $panel(doc, "#strazione").click();
  await doc.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 15000 });
  check(new URL(doc.url()).searchParams.get("RICHIESTA_ID") === rid,
    "la scheda dell'ordine non c'è più: «apri la scheda» apre il carrello della richiesta nella tua");
  await doc.waitForSelector("#psassist-host .pill.run", { timeout: 10000 });
  await $panel(doc, ".pill.run").click();
  await doc.waitForSelector("#psassist-host .card #svuota", { timeout: 10000 }).catch(() => {});
  const bottoni = await doc.evaluate(() => [...(document.getElementById("psassist-host")?.shadowRoot?.querySelectorAll(".commit button") || [])].map((b) => b.id));
  check(["riprova", "svuota", "chiudi"].every((b) => bottoni.includes(b)), `col resoconto intero (got ${bottoni.join(",")})`);
  check((await ordini()).length === 0, "e l'avviso, letto, non c'è più");
  rotta = false;
  const n0 = A.state.requests.length;
  await $panel(doc, "#svuota").click();
  const nasce2 = nuovaPagina();
  await $panel(doc, "#svuota").click();
  const w2 = await nasce2;
  check(!!w2, "«Svuota e ricomincia» va a una scheda di sottofondo nuova: la tua resta libera");
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 }).catch(() => {});
  const del = A.state.requests.slice(n0).filter((q) => q.params.Delete === "Elimina");
  check(del.length >= 1 && del.every((q) => !q.params.PRESTAZIONE && q.params.RICHIESTA_ID === rid && q.params.EPISODIO_ID === "999001"),
    `svuotato col «Svuota carrello» della richiesta (got ${del.length})`);
  check(conferme(A).length === 1 && [...A.state.richieste[rid].cart.keys()].sort().join(",") === "159,320,324",
    "rimessi tutti e tre, confermata una volta");
  check((await stampe(doc)).length === 1 && /ROSSI MARIO/.test(await titoloStampa(doc)), "e le etichette nella tua scheda");
  if (w2) check(await aspettaChiusa(w2), "la scheda nuova si chiude da sola");
  await chiudiStampa(doc);
  riscrivi = null;
}

// ---- 6. la scheda dell'ordine chiusa a metà ------------------------------
console.log("\nordine: la scheda dell'ordine chiusa a metà");
{
  nuovi();
  lento = 1500;
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const nasce = nuovaPagina();
  arrivati = 0;
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const worker = await nasce;
  await doc.goto(B.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  // il primo esame è entrato, il secondo è in volo: il medico chiude la scheda
  for (let i = 0; i < 100 && arrivati < 2; i++) await doc.waitForTimeout(100);
  await doc.waitForTimeout(150);
  await worker.close();
  const rossa = await striscia(doc, /Scheda chiusa/, 20000).catch(() => "");
  check(/ROSSI MARIO/.test(rossa) && /1 esame non mandato: PROCALCITONINA/.test(rossa) && /PROCALCITONINA/.test(rossa),
    `la scheda del medico dice cosa non è partito (got: ${rossa || "niente"})`);
  check(/Da controllare: TROPONINA/.test(rossa), "e quello che era in volo è «da controllare»: mai fra i non mandati");
  const rid = Object.keys(A.state.richieste)[0];
  const sorv = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:daConfermare.v1") || "[]"));
  check(sorv.some((x) => x.rid === rid), "quello che è entrato resta sorvegliato: la richiesta è da confermare");
  check(conferme(A).length === 0, "e niente si è confermato da solo");
  await $panel(doc, "#strstop").click().catch(() => {});
  await doc.waitForTimeout(400);
  check((await ordini()).length === 0 && (await $panel(doc, ".pill.run.err").count()) === 0, "✕: letto, la striscia se ne va");
  lento = 0;
}

// ---- 6b. ⏹ dalla scheda del medico ferma l'ordine -----------------------
console.log("\nordine: ⏹ sulla striscia ferma l'ordine");
{
  nuovi();
  lento = 1200;
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const nasce = nuovaPagina();
  arrivati = 0;
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const worker = await nasce;
  await doc.goto(B.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await striscia(doc, /esame 1 di 3/, 20000).catch(() => "");
  const ferma = (await $panel(doc, "#strstop").innerText().catch(() => "")).trim();
  check(ferma === "⏹", `mentre manda, accanto alla striscia c'è ⏹ (got: ${ferma || "niente"})`);
  await $panel(doc, "#strstop").click();
  const ferma2 = await striscia(doc, /Interrotto/, 15000).catch(() => "");
  const n = arrivati;
  await doc.waitForTimeout(3000);
  check(/ROSSI MARIO/.test(ferma2) && arrivati === n && n < 3 && conferme(A).length === 0,
    `l'ordine si ferma nella sua scheda: niente più invii, niente confermato (got: ${ferma2 || "niente"} · ${n} invii)`);
  check((await $panel(doc, "#strazione").innerText().catch(() => "")).trim() === "apri la scheda", "e «apri la scheda» per vedere dove si è fermato");
  await $panel(doc, "#strstop").click();
  check(await aspettaChiusa(worker, 8000), "✕: letto — la scheda dell'ordine, mai guardata, si chiude");
  lento = 0;
}

// ---- 7. due ordini: il secondo in coda -----------------------------------
console.log("\nordine: due ordini, il secondo aspetta in coda");
{
  nuovi();
  lento = 700;
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await azzeraStampe(doc);
  const nasce1 = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const w1 = await nasce1;
  await doc.goto(B.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await ordina(doc, ["TROPONINA"], { quesito: "dispnea" });
  const coda = await striscia(doc, /coda/, 10000).catch(() => "");
  const l = await ordini();
  check(l.length === 2 && l[1].stato === "coda" && l[1].paziente === "BIANCHI ANNA",
    `il secondo ordine aspetta in coda (got ${l.map((x) => `${x.paziente}:${x.stato}`).join(", ")})`);
  check(/in coda/.test(coda), `e la striscia lo dice (got: ${coda || "niente"})`);
  check(inviati(B).length === 0, "BIANCHI non parte finché ROSSI non ha finito");
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 });
  const t1 = await titoloStampa(doc);
  check(/ROSSI MARIO/.test(t1), `prima le etichette di ROSSI (got: ${t1})`);
  await aspettaChiusa(w1);
  await chiudiStampa(doc);
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 }).catch(() => {});
  await doc.waitForFunction(() => /BIANCHI/.test(document.getElementById("psassist-print")?.shadowRoot?.querySelector(".pw .pwhd")?.textContent || ""), null, { timeout: 30000 }).catch(() => {});
  const t2 = await titoloStampa(doc);
  check(/BIANCHI ANNA/.test(t2), `poi quelle di BIANCHI (got: ${t2})`);
  check(conferme(A).length === 1 && conferme(B).length === 1, `una conferma ciascuno (got ${conferme(A).length} + ${conferme(B).length})`);
  check((await stampe(doc)).length === 2, `due stampe, una per ordine (got ${(await stampe(doc)).length})`);
  await chiudiStampa(doc);
  lento = 0;
}

// ---- 8. la sessione scade nella scheda dell'ordine -----------------------
console.log("\nordine: la sessione scade nella scheda dell'ordine");
{
  nuovi();
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  // da qui in poi tre risposte, poi la pagina di accesso
  A.state.expireAfter = A.state.requests.length + 4;
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const w = await nasce;
  await doc.goto(B.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const rossa = await striscia(doc, /Sessione scaduta/, 30000).catch(() => "");
  check(/ROSSI MARIO/.test(rossa) && /Sessione scaduta/.test(rossa), `la striscia del medico lo dice (got: ${rossa || "niente"})`);
  check(conferme(A).length === 0, "e niente è confermato");
  await $panel(doc, "#strstop").click().catch(() => {});
  if (w && !w.isClosed()) await w.close();
  A.state.expireAfter = Infinity;
}

// ---- 9. la scheda non si apre: l'ordine lo manda la pagina, come sempre ---
console.log("\nordine: se la scheda di sottofondo non si apre, manda la pagina");
{
  nuovi();
  await doc.goto(A.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await azzeraStampe(doc);
  const tolto = await sw.evaluate(() => {
    self.__creaVera = chrome.tabs.create;
    try { chrome.tabs.create = () => Promise.reject(new Error("bloccato dal test")); } catch { return false; }
    return chrome.tabs.create !== self.__creaVera;
  });
  check(tolto, "(il test impedisce al service worker di aprire schede)");
  const nasce = nuovaPagina(4000);
  await ordina(doc, ["TROPONINA"]);
  const w = await nasce;
  check(!w, "nessuna scheda nuova");
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 }).catch(() => {});
  check(conferme(A).length === 1 && A.state.richieste[Object.keys(A.state.richieste)[0]].confirmed === true,
    "l'ordine parte lo stesso, da questa pagina, e si conferma");
  check((await stampe(doc)).length === 1, "e le etichette si stampano qui, come sempre");
  const reg = await doc.evaluate(() => (JSON.parse(sessionStorage.getItem("psassist:log.999001") || "{}").lines || []).join("\n"));
  check(/scheda di sottofondo non disponibile/.test(reg), "il Registro dice perché");
  await chiudiStampa(doc);
  await sw.evaluate(() => { chrome.tabs.create = self.__creaVera; });
}

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fail ? `\nORDINE-ESTENSIONE: ${fail} CHECK FALLITI\n` : "\nORDINE-ESTENSIONE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
