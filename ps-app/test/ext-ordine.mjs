#!/usr/bin/env node
/*
 * L'ordine in una scheda di sottofondo, con l'estensione VERA caricata in
 * Chromium: «Conferma e stampa» apre una seconda scheda dietro, che manda gli
 * esami, conferma con la prova e passa le etichette alla scheda dove sta il
 * medico — che intanto è andato su un altro paziente. La scheda dell'ordine
 * esegue e basta: ogni esito (le etichette, il carrello da confermare, un
 * errore col resoconto intero) arriva alla scheda del medico, poi si slega e
 * si chiude — resta, una scheda qualunque, solo se il medico la sta guardando
 * in quel momento. E poi: ⏹ prima che parta e fra una pagina e l'altra; la
 * scheda chiusa a metà; una scheda zitta; due ordini in coda; la sessione
 * scaduta; il browser che cade; le etichette che non saltano sopra chi
 * scrive né sulla pagina di un altro paziente; e se la scheda non si apre,
 * l'ordine lo manda la pagina come sempre.
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
let riscrivi = null;   // (url, html, req) → html: il server che si comporta in modo strano
let intercetta = null;   // async (route, req, url) → true se la richiesta l'ha presa lui (non arriva al «server»)
let pazienteLento = 0;   // la pagina di ROSSI che arriva lenta (la scheda dell'ordine che si apre)
const sospendi = (ms) => new Promise((res) => setTimeout(res, ms));
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
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
  if (intercetta && await intercetta(r, req, u)) return;
  if (/Insert=Inserisci/.test(u)) arrivati++;
  if (lento && /Insert=Inserisci/.test(u)) await sospendi(lento);
  if (pazienteLento && /MVPG=PsoEpisodioClinicoAmbulatorio/.test(u) && /EPISODIO_ID=999001/.test(u)) await sospendi(pazienteLento);
  const mock = quale(u);
  let out = mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  if (riscrivi && /html/.test(out.headers["content-type"] || "")) {
    out = { ...out, body: Buffer.from(riscrivi(u, Buffer.from(out.body).toString("latin1"), req), "latin1") };
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa intanto */ }
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });

const ordini = () => sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []));
const nessunOrdine = () => sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
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
const azione = (p) => $panel(p, "#strazione").innerText().then((t) => t.trim()).catch(() => "");
const titoloStampa = (p) => p.evaluate(() => {
  const r = document.getElementById("psassist-print")?.shadowRoot;
  return (r?.querySelector(".pw .pwhd")?.textContent || "").replace(/\s+/g, " ").trim();
});
const conferme = (m) => m.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
const inviati = (m) => m.state.requests.filter((q) => q.params.Insert === "Inserisci");
// finché il service worker non dice che c'è (o il tempo finisce)
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) if (await fn()) return true;
  return false;
}
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
async function suPagina(p, url) {
  await p.goto(url);
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}
// Chiuso il dialogo di stampa il browser manda «afterprint» (o la pagina
// riprende il fuoco), e si passa da soli al documento dopo: qui lo si manda
// come lo manda lui, a stampa chiesta.
async function dialogoChiuso(p) {
  const prima = await p.evaluate(() => document.getElementById("psassist-print")?.dataset.doc || "");
  await p.waitForFunction(() => {
    const w = document.getElementById("psassist-print");
    return !w || w.dataset.stato === "stampo";
  }, null, { timeout: 25000 });
  await p.waitForTimeout(650);
  await p.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await p.waitForFunction((x) => {
    const w = document.getElementById("psassist-print");
    return !w || w.dataset.doc !== x;
  }, prima, { timeout: 8000 });
}
// «Svuota il carrello e ricomincia»: il primo tocco legge il carrello e chiede
async function armaSvuota(p) {
  await $panel(p, "#svuota").click();
  const h = await p.waitForFunction(() => {
    const t = (document.getElementById("psassist-host")?.shadowRoot?.querySelector("#svuota")?.innerText || "").trim();
    return /^(Svuoto|Il carrello è vuoto|Non )/.test(t) ? t : false;
  }, null, { timeout: 15000 });
  return h.jsonValue();
}
const rinomina = (u, html) => html.replace(/PROCALCITONINA \(1690\)/g, "ANTITROMBINA III (1450)");
// i messaggi del service worker alle schede che «si perdono» (una scheda fra
// una pagina e l'altra, o che non risponde più): [] li rimette tutti
const silenzia = (tipi) => sw.evaluate((t) => {
  self.__smVero = self.__smVero || chrome.tabs.sendMessage;
  self.__muti = new Set(t);
  chrome.tabs.sendMessage = (id, m, ...r) => (m && self.__muti.has(m.t) ? Promise.reject(new Error("persa")) : self.__smVero.call(chrome.tabs, id, m, ...r));
}, tipi);

const doc = await ctx.newPage();   // la scheda del medico
const SOLO = (process.argv[2] || "").toLowerCase();   // `node test/ext-ordine.mjs caduta`: solo le prove che lo nominano
const prova = (t) => { if (SOLO && !t.toLowerCase().includes(SOLO)) return false; console.log("\nordine: " + t); nuovi(); return true; };

// ---- 1. il giro in sottofondo, il medico su un altro paziente ------------
if (prova("la scheda di sottofondo manda, il medico va altrove")) {
  lento = 700;
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const worker = await nasce;
  check(!!worker, "«Conferma e stampa» apre una seconda scheda");
  const davanti = await attiva();
  check(davanti.length === 1 && /EPISODIO_ID=999001/.test(davanti[0]) && /PsoEpisodioClinicoAmbulatorio/.test(davanti[0]),
    `in sottofondo: davanti resta la scheda del medico (got ${davanti.join(" | ").slice(-60)})`);
  // il medico va subito su un altro paziente
  await suPagina(doc, B.patientUrl);
  const corre = await striscia(doc, /ROSSI MARIO.*esame \d di 2/, 30000).catch(() => "");
  check(/ROSSI MARIO/.test(corre) && /esame \d di 2/.test(corre),
    `sulla pagina di BIANCHI la striscia racconta l'ordine di ROSSI: «esame N di 2» e il passo (got: ${corre || "niente"})`);
  await shot(doc, "1-striscia-altro-paziente");
  // Le etichette di ROSSI, sulla pagina di BIANCHI: il dialogo non si apre da
  // solo — la striscia dice di chi sono, e un tocco le stampa.
  const pronte = await striscia(doc, /Etichette di ROSSI M\. pronte/, 40000).catch(() => "");
  const rid = Object.keys(A.state.richieste)[0];
  check(/ROSSI MARIO/.test(pronte) && (await azione(doc)) === "Stampa",
    `sulla pagina di un altro paziente: «Etichette di ROSSI M. pronte» e «Stampa» (got: ${pronte || "niente"} · ${await azione(doc)})`);
  check(A.state.richieste[rid]?.confirmed === true, "la richiesta è confermata");
  check(conferme(A).length === 1, `una conferma sola (got ${conferme(A).length})`);
  check(Object.values(A.state.insertCount).every((n) => n === 1) && Object.keys(A.state.insertCount).length === 2,
    `ogni esame mandato una volta (${JSON.stringify(A.state.insertCount)})`);
  check(inviati(B).length === 0 && Object.keys(B.state.richieste).length === 0, "su BIANCHI non parte niente");
  check(await aspettaChiusa(worker), "fatto il suo lavoro, la scheda di sottofondo si chiude da sola");
  await doc.waitForTimeout(2500);
  check((await stampe(doc)).length === 0 && (await doc.locator("#psassist-print").count()) === 0,
    "e il dialogo di stampa non si apre da solo sulla pagina di un altro paziente");
  check(/EPISODIO_ID=999002/.test(doc.url()), "il medico è ancora dove l'ha lasciato");
  await shot(doc, "2-etichette-pronte-altro-paziente");
  await $panel(doc, "#strazione").click();
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 15000 });
  await doc.waitForFunction(() => !!document.getElementById("psassist-print")?.shadowRoot?.querySelector(".pw:not([hidden]) .pwbody iframe"), null, { timeout: 15000 }).catch(() => {});
  const testa = await titoloStampa(doc);
  check(/Etichette provette/.test(testa) && /ROSSI MARIO/.test(testa) && /etichettatrice/.test(testa),
    `un tocco: le etichette in anteprima nella scheda del medico, col nome di chi sono (got: ${testa})`);
  await doc.waitForTimeout(800);
  const quante = await stampe(doc);
  check(quante.length === 1 && /BIANCHI ANNA/.test(quante[0].titolo), `la stampa si apre una volta sola, dov'è il medico (got ${JSON.stringify(quante)})`);
  check((await ordini()).length === 0, "e l'ordine non c'è più fra quelli aperti");
  const sorv = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:daConfermare.v1") || "[]"));
  check(!sorv.some((x) => x.rid === rid), "confermata con la prova: il promemoria «non confermata» se ne va");
  // il dialogo che si chiude, documento dopo documento: andati avanti da
  // soli non si sa se ha stampato o annullato — «Stampa finita», e «Ristampa»
  await dialogoChiuso(doc);
  await dialogoChiuso(doc);
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});
  const fine = await striscia(doc, /Stampa finita/, 5000).catch(() => "");
  check(/ROSSI MARIO/.test(fine) && /2 esami confermati/.test(fine) && !/Stampato/.test(fine) && (await azione(doc)) === "Ristampa",
    `alla fine «Stampa finita · 2 esami confermati», di ROSSI, mai «Stampato», e «Ristampa» (got: ${fine || "niente"} · ${await azione(doc)})`);
  await shot(doc, "3-stampa-finita");
}

// ---- 2. il medico passa un attimo sulla scheda dell'ordine --------------
// Non diventa sua: l'esito arriva lo stesso nella sua scheda, e la scheda
// dell'ordine — che lui non guarda più — si chiude.
if (prova("un'occhiata alla scheda dell'ordine — l'esito arriva lo stesso nella tua")) {
  nuovi();
  lento = 700;
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"], { solo: true });
  const worker = await nasce;
  await worker.waitForLoadState().catch(() => {});
  await striscia(doc, /esame \d di 2/, 20000).catch(() => "");
  await worker.bringToFront();
  await worker.waitForTimeout(300);
  await doc.bringToFront();
  const pronto = await striscia(doc, /2 esami in carrello.*Conferma dal gestionale/, 30000).catch(() => "");
  check(/ROSSI MARIO/.test(pronto) && (await azione(doc)) === "apri il carrello",
    `nella tua scheda: «✓ 2 esami in carrello · Conferma dal gestionale», e «apri il carrello» (got: ${pronto || "niente"})`);
  check(await aspettaChiusa(worker), "e la scheda dell'ordine, che non guardavi più, si chiude");
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
}

// ---- 2b. il medico guarda la scheda dell'ordine quando finisce: resta ----
if (prova("la scheda dell'ordine che stai guardando quando finisce resta — una scheda qualunque")) {
  nuovi();
  lento = 600;
  await suPagina(doc, A.patientUrl);
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
    `le etichette si aprono dove sta il medico: lì, sulla pagina di ROSSI (got ${JSON.stringify(quante)})`);
  await worker.waitForTimeout(2000);
  check(!worker.isClosed(), "la stavi guardando: non si chiude sotto di te");
  await chiudiStampa(worker);
  check((await ordini()).length === 0, "e l'ordine è finito: non è legato a nessuna scheda");
  // una scheda qualunque: ricaricata, non riparte niente
  const n0 = inviati(A).length;
  // (la Conferma l'ha premuta lei, sulla pagina vera: il gestionale risponde con un
  // redirect alla pagina del paziente, che qui il banco segue da sé lasciando
  // l'indirizzo del modulo — ricaricare quello lo rimanderebbe. Si ricarica quello vero.)
  if (/ccsForm=/.test(worker.url())) await worker.goto(A.patientUrl);
  else await worker.reload();
  await worker.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await worker.waitForTimeout(2500);
  check(inviati(A).length === n0 && conferme(A).length === 1, "ricaricata, non manda niente: non è più la scheda di un ordine");
  await worker.close();
  await doc.bringToFront();
}

// ---- 3. errore: il resoconto intero passa alla scheda del medico ---------
if (prova("l'errore arriva nella tua scheda, col resoconto intero — e «Svuota» da lì")) {
  nuovi();
  lento = 0;
  riscrivi = rinomina;
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const w1 = await nasce;
  await suPagina(doc, B.patientUrl);
  const rossa = await striscia(doc, /ROSSI MARIO.*Errore/, 40000).catch(() => "");
  check(/oggi si chiama/.test(rossa) && /Mancano: PROCALCITONINA/.test(rossa) && (await $panel(doc, ".pill.run.err").count()) === 1,
    `la striscia del medico è rossa, col motivo corto e cosa manca (got: ${rossa || "niente"})`);
  check((await azione(doc)) === "apri il carrello", `e accanto «apri il carrello» (got: ${await azione(doc) || "niente"})`);
  await shot(doc, "3b-striscia-rossa");
  check(await aspettaChiusa(w1), "la scheda dell'ordine, che nessuno guardava, si chiude: il resoconto è passato a te");
  const rid = Object.keys(A.state.richieste)[0];
  await $panel(doc, "#strazione").click();
  await doc.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 15000 });
  check(new URL(doc.url()).searchParams.get("RICHIESTA_ID") === rid, "«apri il carrello» apre il carrello della richiesta nella tua scheda");
  await doc.waitForSelector("#psassist-host .pill.run", { timeout: 10000 });
  await $panel(doc, ".pill.run").click();
  await doc.waitForSelector("#psassist-host .card #svuota", { timeout: 10000 }).catch(() => {});
  const card = (await $panel(doc, ".card").innerText().catch(() => "")).replace(/\s+/g, " ");
  const bottoni = await doc.evaluate(() => [...(document.getElementById("psassist-host")?.shadowRoot?.querySelectorAll(".commit button") || [])].map((b) => b.id));
  check(/oggi si chiama/.test(card) && ["riprova", "svuota", "chiudi"].every((b) => bottoni.includes(b)),
    `lì il resoconto intero: «↻ Riprova i mancanti», «Svuota il carrello e ricomincia», «Chiudi» (got ${bottoni.join(",")} · ${card.slice(0, 80)})`);
  check((await ordini()).length === 0, "e l'avviso, letto, non c'è più");
  riscrivi = null;
  const n0 = A.state.requests.length;
  const chiede = await armaSvuota(doc);
  check(chiede === "Svuoto 2 esami: EMOCROMO POC, TROPONINA US?", `il primo tocco legge il carrello e dice cosa toglie, per nome (got: ${chiede})`);
  check(!A.state.requests.slice(n0).some((q) => q.params.Delete || q.params.Insert), "e intanto solo letture");
  await shot(doc, "1-errore-svuota-armato");
  const nasce2 = nuovaPagina();
  await $panel(doc, "#svuota").click();
  const w2 = await nasce2;
  check(!!w2, "«Svuota e ricomincia» va a una scheda di sottofondo nuova: la tua resta libera");
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 }).catch(() => {});
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
  check(Object.keys(A.state.richieste).length === 1 && conferme(A).length === 1 && A.state.richieste[rid].confirmed === true
    && [...A.state.richieste[rid].cart.keys()].sort().join(",") === "159,320,324", "confermata una volta, coi tre esami");
  check((await stampe(doc)).length === 1 && /ROSSI MARIO/.test(await titoloStampa(doc)),
    "e le etichette nella tua scheda, da sole: sei sul carrello di ROSSI");
  if (w2) check(await aspettaChiusa(w2), "la scheda nuova si chiude da sola");
  await chiudiStampa(doc);
}

// ---- 4. errore con il medico sulla scheda dell'ordine --------------------
// Resta — ci sta guardando — ma non si muove (niente salto sul carrello), e
// da lì è una scheda qualunque: un ordine per BIANCHI, aperto da lì, va a una
// scheda nuova, e le sue etichette sono di BIANCHI. L'avviso di ROSSI resta.
if (prova("errore mentre guardi la scheda dell'ordine — resta, slegata, e lì ordini un altro paziente")) {
  nuovi();
  lento = 500;
  riscrivi = rinomina;
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const w = await nasce;
  await w.waitForLoadState().catch(() => {});
  await w.bringToFront();
  const rossa = await striscia(w, /ROSSI MARIO.*Errore/, 40000).catch(() => "");
  check(/oggi si chiama/.test(rossa) && (await azione(w)) === "apri il carrello",
    `lì l'esito è quello di ogni scheda: la striscia rossa, con «apri il carrello» (got: ${rossa || "niente"})`);
  const dove = w.url();
  await w.waitForTimeout(1500);
  check(!w.isClosed() && w.url() === dove && /PsoEpisodioClinicoAmbulatorio/.test(dove),
    "la stavi guardando: non si chiude, e dopo l'errore non salta sul carrello da sola");
  const l = await ordini();
  check(l.length === 1 && l[0].stato === "errore" && l[0].worker == null, `l'ordine finito non è legato a nessuna scheda (got ${JSON.stringify(l.map((x) => [x.stato, x.worker]))})`);
  riscrivi = null;
  lento = 300;
  await suPagina(w, B.patientUrl);
  const nasce2 = nuovaPagina();
  await ordina(w, ["TROPONINA"], { quesito: "dispnea" });
  const w2 = await nasce2;
  check(!!w2, "da quella scheda l'ordine di BIANCHI va a una scheda di sottofondo nuova");
  await w.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 }).catch(() => {});
  await w.waitForFunction(() => !!document.getElementById("psassist-print")?.shadowRoot?.querySelector(".pw:not([hidden]) .pwbody iframe"), null, { timeout: 15000 }).catch(() => {});
  const t = await titoloStampa(w);
  check(/BIANCHI ANNA/.test(t) && !/ROSSI/.test(t), `le etichette di BIANCHI portano il nome di BIANCHI (got: ${t || "niente"})`);
  check(conferme(B).length === 1 && conferme(A).length === 0, "una conferma, di BIANCHI; quella di ROSSI resta da fare");
  const l2 = await ordini();
  check(l2.some((x) => x.paziente === "ROSSI MARIO" && x.stato === "errore"), `e l'avviso rosso di ROSSI resta: nessuno l'ha letto (got ${l2.map((x) => `${x.paziente}:${x.stato}:${x.vista?.tag || ""}`).join(", ")})`);
  await chiudiStampa(w);
  if (w2) await aspettaChiusa(w2);
  await w.close();
  await nessunOrdine();
  await doc.bringToFront();
}

// ---- 5. ⏹ mentre la scheda dell'ordine si apre ---------------------------
if (prova("⏹ mentre la scheda dell'ordine si apre — non parte niente")) {
  nuovi();
  lento = 0;
  await suPagina(doc, A.patientUrl);
  pazienteLento = 4000;   // la pagina della scheda dell'ordine arriva lenta
  arrivati = 0;
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const w = await nasce;
  const apre = await striscia(doc, /Apro la scheda dell'ordine/, 5000).catch(() => "");
  check(!!apre && (await $panel(doc, "#strstop").innerText().catch(() => "")).trim() === "⏹", `«Apro la scheda dell'ordine…» con ⏹ (got: ${apre || "niente"})`);
  await $panel(doc, "#strstop").click();
  const fermo = await striscia(doc, /Interrotto/, 8000).catch(() => "");
  await doc.waitForTimeout(5500);
  pazienteLento = 0;
  check(/niente inviato/.test(fermo) && arrivati === 0 && Object.keys(A.state.richieste).length === 0,
    `fermato prima di partire: niente richiesta, niente inviato (got: ${fermo || "niente"} · ${arrivati} invii)`);
  check(!w || await aspettaChiusa(w, 3000), "e la sua scheda si chiude");
  await $panel(doc, "#strstop").click().catch(() => {});
  await doc.waitForTimeout(300);
  check((await ordini()).length === 0, "✕: letto");
}

// ---- 6. la scheda dell'ordine chiusa a metà ------------------------------
if (prova("la scheda dell'ordine chiusa a metà")) {
  nuovi();
  lento = 1500;
  await suPagina(doc, A.patientUrl);
  const nasce = nuovaPagina();
  arrivati = 0;
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const worker = await nasce;
  await suPagina(doc, B.patientUrl);
  // il primo esame è entrato, il secondo è in volo: il medico chiude la scheda
  for (let i = 0; i < 100 && arrivati < 2; i++) await doc.waitForTimeout(100);
  await doc.waitForTimeout(150);
  await worker.close();
  const rossa = await striscia(doc, /Scheda chiusa/, 20000).catch(() => "");
  check(/ROSSI MARIO/.test(rossa) && /1 esame non mandato: PROCALCITONINA/.test(rossa),
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
if (prova("⏹ sulla striscia ferma l'ordine")) {
  nuovi();
  lento = 1200;
  await suPagina(doc, A.patientUrl);
  const nasce = nuovaPagina();
  arrivati = 0;
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const worker = await nasce;
  await suPagina(doc, B.patientUrl);
  await striscia(doc, /esame 1 di 3/, 20000).catch(() => "");
  const ferma = (await $panel(doc, "#strstop").innerText().catch(() => "")).trim();
  check(ferma === "⏹", `mentre manda, accanto alla striscia c'è ⏹ (got: ${ferma || "niente"})`);
  await $panel(doc, "#strstop").click();
  const ferma2 = await striscia(doc, /Interrotto/, 15000).catch(() => "");
  const n = arrivati;
  await doc.waitForTimeout(3000);
  check(/ROSSI MARIO/.test(ferma2) && arrivati === n && n < 3 && conferme(A).length === 0,
    `l'ordine si ferma nella sua scheda: niente più invii, niente confermato (got: ${ferma2 || "niente"} · ${n} invii)`);
  check((await azione(doc)) === "apri il carrello", "e «apri il carrello» per vedere dove si è fermato");
  check(await aspettaChiusa(worker, 8000), "la scheda dell'ordine, mai guardata, si chiude da sola");
  await $panel(doc, "#strstop").click();
  await doc.waitForTimeout(300);
  check((await ordini()).length === 0, "✕: letto");
  lento = 0;
}

// ---- 6c. ⏹ che la scheda non riceve subito ------------------------------
// (come fra una pagina e l'altra): resta segnato, la striscia lo dice, e la
// scheda si ferma alla prima parola che scambia col service worker.
if (prova("⏹ che non arriva subito — segnato, e la scheda si ferma appena parla")) {
  nuovi();
  lento = 1500;
  await suPagina(doc, A.patientUrl);
  const nasce = nuovaPagina();
  arrivati = 0;
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const worker = await nasce;
  await suPagina(doc, B.patientUrl);
  await striscia(doc, /esame 1 di 3/, 20000).catch(() => "");
  await silenzia(["psassistFerma"]);
  await sw.evaluate(() => {
    self.__ferme = 0;
    chrome.storage.onChanged.addListener((ch, a) => { if (a === "session" && ch.ordini && (ch.ordini.newValue || []).some((x) => x.ferma)) self.__ferme++; });
  });
  await $panel(doc, "#strstop").click();
  const fermo = await striscia(doc, /Interrotto/, 20000).catch(() => "");
  const viste = await strisce(doc);
  const n = arrivati;
  await doc.waitForTimeout(3000);
  await silenzia([]);
  const segnato = await sw.evaluate(() => self.__ferme);
  check(segnato > 0, `non arrivato: il fermo resta segnato per la scheda («Fermo chiesto» sulla striscia: ${viste.filter((t) => /Fermo/.test(t)).join(" | ") || "troppo breve da vedere"})`);
  check(!!fermo && arrivati === n && n < 3 && conferme(A).length === 0,
    `alla prima parola la scheda si ferma: niente più invii, niente confermato (got: ${fermo || "niente"} · ${n} invii)`);
  check(await aspettaChiusa(worker, 8000), "e si chiude");
  await $panel(doc, "#strstop").click().catch(() => {});
  await doc.waitForTimeout(300);
  lento = 0;
}

// ---- 7. due ordini: il secondo in coda -----------------------------------
if (prova("due ordini, il secondo aspetta in coda")) {
  nuovi();
  lento = 700;
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce1 = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const w1 = await nasce1;
  await suPagina(doc, B.patientUrl);
  await ordina(doc, ["TROPONINA"], { quesito: "dispnea" });
  const coda = await striscia(doc, /coda/, 10000).catch(() => "");
  const l = await ordini();
  check(l.length === 2 && l[1].stato === "coda" && l[1].paziente === "BIANCHI ANNA",
    `il secondo ordine aspetta in coda (got ${l.map((x) => `${x.paziente}:${x.stato}`).join(", ")})`);
  check(/in coda/.test(coda), `e la striscia lo dice (got: ${coda || "niente"})`);
  check(inviati(B).length === 0, "BIANCHI non parte finché ROSSI non ha finito");
  // sulla lista del pronto soccorso (nessun paziente) le etichette partono da sole
  await suPagina(doc, A.worklistUrl);
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 });
  const t1 = await titoloStampa(doc);
  check(/ROSSI MARIO/.test(t1), `prima le etichette di ROSSI, da sole sulla lista (got: ${t1})`);
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

// ---- 8. la scheda dell'ordine zitta --------------------------------------
// Tre minuti senza una parola (qui l'orologio dell'ordine si sposta): prima
// le si chiede se c'è. Se risponde, era solo lenta. Se no «Ordine fermo», ma
// finché la scheda esiste niente è «non mandato» — tutto da controllare — e
// la coda aspetta: mai due motori.
if (prova("una scheda d'ordine zitta — si chiede se c'è, e la coda aspetta")) {
  nuovi();
  lento = 25000;
  await suPagina(doc, A.patientUrl);
  arrivati = 0;
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const w = await nasce;
  await suPagina(doc, B.patientUrl);
  for (let i = 0; i < 100 && arrivati < 1; i++) await doc.waitForTimeout(100);
  await ordina(doc, ["TROPONINA"], { quesito: "dispnea" });
  await striscia(doc, /coda/, 10000).catch(() => "");
  const zitta = () => sw.evaluate(() => inFilaOrd(async () => {
    const l = await ordLeggi();
    for (const r of l) if (r.stato === "corre") r.agg = Date.now() - 200e3;
    await ordScrivi(l);
  }));
  await zitta();
  await doc.waitForTimeout(5500);   // un giro di controllo: «ci sei?» — sì
  let l = await ordini();
  const r1 = l.find((x) => x.paziente === "ROSSI MARIO");
  check(r1 && r1.stato === "corre" && !r1.muto && l.find((x) => x.paziente === "BIANCHI ANNA")?.stato === "coda",
    `zitta ma viva (risponde): niente è dato per fermo, BIANCHI aspetta (got ${l.map((x) => `${x.paziente}:${x.stato}${x.muto ? ":muto" : ""}`).join(", ")})`);
  await silenzia(["psassistVivo"]);
  await zitta();
  const fermo = await striscia(doc, /Ordine fermo/, 10000).catch(() => "");
  check(/ROSSI MARIO/.test(fermo) && /Da controllare: .*EMOCROMO/.test(fermo) && !/non mandat/.test(fermo),
    `non risponde: «Ordine fermo», tutto da controllare, mai «non mandati» finché la scheda c'è (got: ${fermo || "niente"})`);
  l = await ordini();
  check(inviati(B).length === 0 && l.find((x) => x.paziente === "BIANCHI ANNA")?.stato === "coda" && !w.isClosed(),
    "e la coda aspetta: nessun secondo motore mentre la prima scheda esiste");
  // ⏹ su una scheda che non risponde la chiude: da lì sì, quello che manca non è partito
  lento = 0;
  await silenzia(["psassistVivo", "psassistFerma"]);
  await $panel(doc, "#strstop").click();
  check(await aspettaChiusa(w, 8000), "⏹ su una scheda che non risponde: la chiude");
  await silenzia([]);
  const chiusa = await striscia(doc, /Scheda chiusa/, 10000).catch(() => "");
  check(/non mandat/.test(chiusa) && /Da controllare: EMOCROMO/.test(chiusa), `chiusa: quello in volo da controllare, il resto non mandato (got: ${chiusa || "niente"})`);
  // e solo adesso parte BIANCHI
  await finche(async () => conferme(B).length === 1, 40000);
  check(conferme(B).length === 1, "solo adesso parte il secondo ordine");
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 20000 }).catch(() => {});
  await chiudiStampa(doc);
  await nessunOrdine();
}

// ---- 9. la sessione scade nella scheda dell'ordine -----------------------
if (prova("la sessione scade nella scheda dell'ordine")) {
  nuovi();
  await suPagina(doc, A.patientUrl);
  // da qui in poi tre risposte, poi la pagina di accesso
  A.state.expireAfter = A.state.requests.length + 4;
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const w = await nasce;
  await suPagina(doc, B.patientUrl);
  const rossa = await striscia(doc, /Sessione scaduta/, 30000).catch(() => "");
  check(/ROSSI MARIO/.test(rossa) && /Sessione scaduta/.test(rossa), `la striscia del medico lo dice (got: ${rossa || "niente"})`);
  check(conferme(A).length === 0, "e niente è confermato");
  check(!w || await aspettaChiusa(w, 8000), "e la scheda dell'ordine si chiude");
  await $panel(doc, "#strstop").click().catch(() => {});
  A.state.expireAfter = Infinity;
}

// ---- 10. la pagina di accesso non butta via le etichette in attesa -------
if (prova("la pagina di accesso tiene le etichette in attesa, e le conta senza nomi")) {
  nuovi();
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  await doc.goto("about:blank");   // davanti niente del gestionale: le etichette aspettano
  check(await finche(async () => (await ordini()).some((x) => x.stato === "stampa"), 40000), "confermata: le etichette aspettano una scheda del gestionale");
  B.state.expireAfter = B.state.requests.length;
  await doc.goto(B.patientUrl);
  await doc.waitForSelector("#psassist-avviso-login", { state: "attached", timeout: 10000 }).catch(() => {});
  const avv = await doc.locator("#psassist-avviso-login").innerText().catch(() => "");
  check(/1 ordine di esami ancora aperto/.test(avv) && !/ROSSI|BIANCHI/.test(avv), `la pagina di accesso lo conta, senza nomi (got: ${avv || "niente"})`);
  check((await ordini()).some((x) => x.stato === "stampa"), "e le etichette in attesa restano");
  B.state.expireAfter = Infinity;
  await suPagina(doc, A.patientUrl);
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 20000 }).catch(() => {});
  check(/ROSSI MARIO/.test(await titoloStampa(doc)), "rientrato, sulla pagina di ROSSI si stampano da sole");
  await chiudiStampa(doc);
}

// ---- 11. il browser cade a metà ordine ----------------------------------
// L'appunto della scheda sopravvive (Chrome la ripristina), la memoria
// dell'estensione no: ripristinata, la scheda non riprende l'ordine di
// nascosto. Il segno condiviso resta, e dice giusto: quello in volo è da
// controllare, mai «non mandato».
if (prova("dopo che il browser cade, la scheda dell'ordine non finisce l'ordine di nascosto")) {
  nuovi();
  lento = 2500;
  await suPagina(doc, A.patientUrl);
  arrivati = 0;
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const w = await nasce;
  await suPagina(doc, B.patientUrl);
  for (let i = 0; i < 150 && arrivati < 2; i++) await doc.waitForTimeout(100);
  await doc.waitForTimeout(200);
  // il browser cade: la pagina muore col motore, la memoria dell'estensione
  // (storage.session) se ne va; l'appunto della scheda (sessionStorage) no
  await w.goto("about:blank");
  await sw.evaluate(() => chrome.storage.session.clear());
  const n = arrivati;
  // …e Chrome, riaperto, ripristina la scheda
  await w.goto(A.patientUrl).catch(() => {});
  await w.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 }).catch(() => {});
  await w.waitForTimeout(5000);
  check(arrivati === n, `ripristinata, la scheda non riprende l'ordine: niente più mandato (got ${arrivati - n} invii dopo)`);
  const a = await w.evaluate(() => JSON.parse(localStorage.getItem("psassist:corsa.aperta.v1") || "null"));
  check(!!a && a.quanti === 1 && a.forse === 1, `il segno «giro rimasto a metà» resta, giusto: 1 non mandato, 1 da controllare (got ${JSON.stringify(a)})`);
  await w.evaluate(() => { const k = "psassist:corsa.aperta.v1"; const x = JSON.parse(localStorage.getItem(k)); x.ts -= 120e3; localStorage.setItem(k, JSON.stringify(x)); });
  await w.close();
  lento = 0;
  await suPagina(doc, B.patientUrl);
  await doc.waitForSelector("#psassist-host .card", { timeout: 10000 }).catch(() => {});
  const msg = (await $panel(doc, ".card").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/rimasto a metà: 1 esame non è stato mandato, 1 è da controllare/.test(msg),
    `la prima pagina del medico lo dice: 1 non mandato, 1 da controllare — mai «2 non mandati» (got: ${msg.slice(0, 160)})`);
}

// ---- 12. le etichette non saltano sopra chi scrive -----------------------
if (prova("il dialogo di stampa non salta sopra chi scrive")) {
  nuovi();
  lento = 300;
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  await doc.locator('textarea[name="DIARIO"]').click();
  await doc.keyboard.type("Paziente vigile, orientato", { delay: 40 });
  check(await finche(async () => (await ordini()).some((x) => x.stato === "stampa"), 40000), "confermata: le etichette sono pronte");
  await doc.waitForTimeout(5000);
  check((await stampe(doc)).length === 0, "mentre scrivi nel gestionale, il dialogo non si apre");
  const pronte = await striscia(doc, /Etichette pronte/, 5000).catch(() => "");
  check(/ROSSI MARIO/.test(pronte) && (await azione(doc)) === "Stampa", `la striscia lo dice, e «Stampa» le stampa con un tocco (got: ${pronte || "niente"})`);
  await doc.mouse.click(20, 700);   // fuori dal campo; e smetti di scrivere
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 }).catch(() => {});
  check((await stampe(doc)).length === 1, "smesso di scrivere, partono da sole");
  await chiudiStampa(doc);
}

// ---- 13. le etichette vanno nella finestra in primo piano ---------------
if (prova("le etichette vanno nella finestra in primo piano")) {
  nuovi();
  lento = 600;
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  const apre = nuovaPagina();
  const win = await sw.evaluate((u) => chrome.windows.create({ url: u, focused: true }).then((x) => x.id), A.worklistUrl);
  const p2 = await apre;
  await p2.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 }).catch(() => {});
  await p2.waitForSelector("#psassist-print", { state: "attached", timeout: 40000 }).catch(() => {});
  check((await p2.locator("#psassist-print").count()) === 1 && (await doc.locator("#psassist-print").count()) === 0,
    "le etichette si aprono nella finestra in primo piano, non nella scheda da cui è partito l'ordine");
  await chiudiStampa(p2);
  await sw.evaluate((id) => chrome.windows.remove(id), win).catch(() => {});
  await doc.bringToFront();
}

// ---- 14. la stessa domanda due volte è un ordine solo -------------------
// (una risposta persa: la scheda del medico rimanda lo stesso ordine, con lo
// stesso numero), anche dopo che l'ordine è finito
if (prova("la stessa domanda due volte (risposta persa) è un ordine solo")) {
  nuovi();
  await suPagina(doc, A.patientUrl);
  await doc.bringToFront();
  const nasce = nuovaPagina();
  const ris = await sw.evaluate(async (u) => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const job = { id: "doppio1", ep: "999001", paziente: "ROSSI MARIO", n: 1, autoConfirm: false, url: u, nomi: ["TROPONINA US"],
      piano: { startPage: "patient", items: [{ res: "00660001P", code: "324", label: "TROPONINA ULTRASENSIBILE (POC3001)", display: "TROPONINA US" }],
        quesito: "dolore", episodeId: "999001", patientName: "ROSSI MARIO", patientUrl: u } };
    const chiedi = (m) => new Promise((res) => ordMessaggio(m, { tab: t, url: t.url }, res));
    const a = await chiedi({ t: "ordineNuovo", job }), b = await chiedi({ t: "ordineNuovo", job });
    const n1 = ((await chrome.storage.session.get("ordini")).ordini || []).length;
    await chiedi({ t: "ordineFerma", id: "doppio1" });   // non serve che parta
    const l = (await chrome.storage.session.get("ordini")).ordini || [];
    await chiedi({ t: "ordineChiudi", id: "doppio1" });
    const c = await chiedi({ t: "ordineNuovo", job });
    const n2 = ((await chrome.storage.session.get("ordini")).ordini || []).length;
    return { a: a.ok, b: b.ok, c: c.ok, n1, n2, stato: l[0] && l[0].stato };
  }, A.patientUrl);
  const w = await nasce;
  check(ris.a && ris.b && ris.n1 === 1, `due volte la stessa domanda: un ordine solo (got ${JSON.stringify(ris)})`);
  check(ris.c && ris.n2 === 0, "e anche dopo, finito e letto: lo stesso numero non riparte");
  check(ris.stato === "interrotto" && inviati(A).length === 0, "(fermato prima di partire: niente inviato)");
  if (w) await aspettaChiusa(w, 5000);
}

// ---- 15. con un avviso solo, nessuna scheda chiede e niente si riscrive --
if (prova("con solo un avviso aperto nessuna scheda chiede niente, e niente si riscrive")) {
  nuovi();
  riscrivi = rinomina;   // un errore: l'avviso rosso, da leggere
  await suPagina(doc, A.patientUrl);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA", "PROCALCITONINA"], { quesito: "febbre" });
  const w = await nasce;
  await suPagina(doc, B.patientUrl);
  await striscia(doc, /ROSSI MARIO.*Errore/, 40000).catch(() => "");
  riscrivi = null;
  if (w) await aspettaChiusa(w, 5000);
  await doc.waitForTimeout(500);
  const avvisi = await ordini();
  check(avvisi.length === 1 && avvisi[0].stato === "errore", `(un avviso aperto, niente che giri: ${avvisi.map((x) => x.stato).join(", ")})`);
  const conto = await sw.evaluate(async () => {
    self.__giri = 0; self.__scritte = 0;
    const vero = ordControlla;
    ordControlla = async (l) => { self.__giri++; return vero(l); };
    chrome.storage.onChanged.addListener((ch, area) => { if (area === "session" && ch.ordini) self.__scritte++; });
    await new Promise((r) => setTimeout(r, 10000));
    ordControlla = vero;
    return { giri: self.__giri, scritte: self.__scritte };
  });
  check(conto.giri === 0 && conto.scritte === 0, `dieci secondi con un avviso aperto: nessun giro di controllo, nessuna scrittura (got ${JSON.stringify(conto)})`);
  await $panel(doc, "#strstop").click().catch(() => {});
}

// ---- 17. la conferma nella scheda dell'ordine: la pagina vera, con pazienza
// La scheda dell'ordine è già una pagina che nessuno guarda: conferma sul
// carrello vero, col suo bottone (una cornice dentro una scheda nascosta
// Chrome la carica col contagocce — quello si prova con Chrome vero, non qui).
// Il carrello che arriva senza la riga dell'ultimo esame (l'elenco monco o in
// ritardo che la verifica dell'inserimento conosce già) si rilegge, mai un
// secondo clic; se manca sempre, la conferma si sospende, e il perché arriva
// nel Registro del medico: la scheda dell'ordine si chiude, il suo Registro no.
const registroDi = (p, ep = "999001") => p.evaluate((e) => (JSON.parse(sessionStorage.getItem("psassist:log." + e) || "{}").lines || []).join("\n"), ep);
const senzaRiga = (code, quante) => {
  const st = { n: 0 };
  st.fn = (u, html, req) => {
    // solo le pagine del carrello caricate come pagine (le letture del motore no)
    if (st.n >= quante || req.resourceType() !== "document" || !/MVPG=RcsRichiestaPrestazioniRicercaErogatore/.test(u) || !/EPISODIO_ID=999001/.test(u)) return html;
    const via = html.replace(new RegExp(`<tr><td><a class="AFCDataLink" href="[^"]*Delete=Elimina[^"]*PRESTAZIONE=${code}[^"]*">[^<]*</a></td></tr>`, "g"), "");
    if (via !== html) st.n++;
    return via;
  };
  return st;
};
if (prova("il carrello della conferma arriva senza l'ultimo esame — si rilegge; se manca sempre, il perché arriva al medico")) {
  nuovi();
  lento = 0;
  await suPagina(doc, A.patientUrl);
  const una = senzaRiga("320", 1);
  riscrivi = una.fn;
  let nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO"]);
  let w = await nasce;
  await suPagina(doc, B.patientUrl);
  const pronte = await striscia(doc, /Etichette di ROSSI M\. pronte/, 60000).catch(() => "");
  let rid = Object.keys(A.state.richieste)[0];
  check(una.n === 1 && !!pronte && A.state.richieste[rid]?.confirmed === true && conferme(A).length === 1,
    `il carrello arrivato una volta senza EMOCROMO: si rilegge, poi confermata — un clic solo (got: ${una.n} pagine monche · ${pronte || "niente"} · ${conferme(A).length} conferme)`);
  check(/auto-conferma: «EMOCROMO[^»]*» \(320\) non è nel carrello di questa pagina — rileggo il carrello/.test(await registroDi(doc)),
    "e il Registro del medico dice perché ha riletto (lo scrive la scheda dell'ordine)");
  await aspettaChiusa(w);
  await nessunOrdine();
  // …e se manca sempre: sospesa, col perché
  nuovi();
  await doc.evaluate(() => sessionStorage.removeItem("psassist:log.999001"));   // (da BIANCHI: il Registro di ROSSI riparte vuoto)
  await suPagina(doc, A.patientUrl);
  const sempre = senzaRiga("320", 99);
  riscrivi = sempre.fn;
  nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO"]);
  w = await nasce;
  await suPagina(doc, B.patientUrl);
  const sospesa = await striscia(doc, /ROSSI MARIO.*Conferma sospesa/, 60000).catch(() => "");
  rid = Object.keys(A.state.richieste)[0];
  check(!!sospesa && sempre.n === 4 && conferme(A).length === 0 && A.state.richieste[rid]?.confirmed === false,
    `manca sempre: 3 riletture, poi «Conferma sospesa», niente confermato (got: ${sempre.n} pagine monche · ${sospesa || "niente"})`);
  const reg = await registroDi(doc);
  check(/── il Registro della scheda dell'ordine ──/.test(reg) && /» .*auto-conferma sospesa: «EMOCROMO[^»]*» \(320\) non è nel carrello di questa pagina/.test(reg),
    `il Registro del medico (⧉ Copia) ha le righe della scheda dell'ordine, col controllo che ha detto no (got: ${reg.split("\n").filter((l) => /auto-conferma|scheda dell'ordine/.test(l)).join(" | ").slice(0, 300) || "niente"})`);
  check(!/BIANCHI/.test(reg), "e nel Registro di ROSSI non entra il nome di nessun altro");
  check(await aspettaChiusa(w), "la scheda dell'ordine si chiude");
  riscrivi = null;
  await nessunOrdine();
}

// ---- 18. dopo la Conferma la richiesta compare in ritardo ---------------
// Il gestionale può metterci qualche secondo a elencare la richiesta appena
// confermata coi suoi fogli: la pagina del paziente si rilegge (solo letture)
// prima di dire «non confermata», e la Conferma non riparte mai.
if (prova("dopo la Conferma la pagina del paziente la elenca in ritardo — si rilegge, mai un secondo clic")) {
  nuovi();
  lento = 0;
  await suPagina(doc, A.patientUrl);
  let tolte = 0;
  riscrivi = (u, html) => {
    const rid = Object.keys(A.state.richieste)[0];
    if (!rid || !A.state.richieste[rid].confirmed || tolte >= 2 || !/EPISODIO_ID=999001/.test(u)) return html;
    const via = html.replace(/<tr><td>Richiesta \d+<\/td><td>[\s\S]*?<\/td><\/tr>/g, "");
    if (via !== html) tolte++;
    return via;
  };
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO"]);
  const w = await nasce;
  await suPagina(doc, B.patientUrl);
  const pronte = await striscia(doc, /Etichette di ROSSI M\. pronte|Non confermata/, 60000).catch(() => "");
  check(tolte === 2 && /Etichette di ROSSI M\. pronte/.test(pronte), `elencata solo alla terza lettura: confermata, etichette pronte (got: ${tolte} pagine senza · ${pronte || "niente"})`);
  check(conferme(A).length === 1, `una Conferma sola (got ${conferme(A).length})`);
  check(/la pagina del paziente non la elenca ancora: la rileggo fra 2 s/.test(await registroDi(doc)), "e il Registro del medico dice che ha riletto");
  await aspettaChiusa(w);
  riscrivi = null;
  await nessunOrdine();
}

// ---- 19. la scheda dell'ordine si ricarica mentre conferma --------------
// (il gestionale lo fa da sé, o un clic del medico su quella scheda). La
// Conferma premuta non è arrivata al server, il giro è finito: l'ordine non
// resta «in corso» per sempre — cerca la prova, poi lo dice e finisce — e la
// coda va avanti.
if (prova("la scheda dell'ordine si ricarica mentre conferma — l'ordine finisce, la coda va avanti")) {
  nuovi();
  lento = 0;
  await suPagina(doc, A.patientUrl);
  let w = null, fatto = false;
  intercetta = async (r, req, u) => {
    if (fatto || req.method() !== "POST" || !/ccsForm=Prestazioni/.test(u) || !/EPISODIO_ID=999001/.test(u)) return false;
    fatto = true;
    w?.reload().catch(() => {});
    await r.abort().catch(() => {});
    return true;
  };
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO"]);
  w = await nasce;
  await suPagina(doc, B.patientUrl);
  await ordina(doc, ["TROPONINA"], { quesito: "dispnea" });   // in coda dietro ROSSI
  const ok = await finche(async () => conferme(B).length === 1, 70000);
  const l = await ordini();
  const r = l.find((x) => x.paziente === "ROSSI MARIO");
  check(fatto && !!r && r.stato !== "corre" && /Non confermata/.test(r.vista?.tag || ""),
    `la Conferma persa con la ricarica: l'ordine di ROSSI finisce, «Non confermata» (got: ${r ? `${r.stato} · ${r.vista?.tag} · ${r.vista?.testo}` : "niente"})`);
  check(ok && conferme(A).length === 0, `e la coda va avanti: BIANCHI parte e si conferma (got ${conferme(B).length} conferme di BIANCHI, ${conferme(A).length} di ROSSI · ${(await ordini()).map((x) => `${x.paziente}:${x.stato}:${x.vista?.tag || ""}`).join(", ")})`);
  check(!!r?.consegna && /RICHIESTA_ID=/.test(r.consegna.url || ""), "con «apri il carrello» della sua richiesta");
  check(await aspettaChiusa(w, 10000), "e la scheda di ROSSI si chiude");
  intercetta = null;
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 20000 }).catch(() => {});
  await chiudiStampa(doc);
  await nessunOrdine();
}

// ---- 20. ⏹ su una scheda d'ordine che aspetta: finisce lì ----------------
// La scheda dell'ordine sta per ricaricare il carrello (gli mancava una riga)
// e il medico, passato di lì, ha il cursore in un suo campo: lei non cambia
// pagina sopra di lui, e aspetta. ⏹ c'è, e la chiude: la coda non resta
// ferma dietro una scheda che aspetta.
if (prova("⏹ su una scheda d'ordine che aspetta — l'ordine finisce, la coda va avanti")) {
  nuovi();
  lento = 0;
  await suPagina(doc, A.patientUrl);
  riscrivi = senzaRiga("320", 1).fn;
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO"]);
  const w = await nasce;
  await suPagina(doc, B.patientUrl);
  await ordina(doc, ["TROPONINA"], { quesito: "dispnea" });   // in coda dietro ROSSI
  // sul carrello, nei 2 secondi prima di ricaricarlo: un clic e un tasto in un suo campo
  await w.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 40000 }).catch(() => {});
  await w.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 }).catch(() => {});
  await w.click('input[name="s_PRESTAZIONE"]').catch(() => {});
  await w.keyboard.type("a").catch(() => {});
  const aspetta = await striscia(doc, /ROSSI MARIO.*tocca per il carrello/, 20000).catch(() => "");
  check(!!aspetta && conferme(A).length === 0, `col cursore nel suo campo la scheda dell'ordine non ricarica il carrello: aspetta (got: ${aspetta || "niente"})`);
  const bottone = (await $panel(doc, "#strstop").innerText().catch(() => "")).trim();
  check(bottone === "⏹", `e ⏹ c'è (got «${bottone}» · ${JSON.stringify((await ordini()).map((x) => [x.paziente, x.stato, x.vista && x.vista.tag]))})`);
  await $panel(doc, "#strstop").click();
  const fermo = await striscia(doc, /ROSSI MARIO.*Interrotto/, 15000).catch(() => "");
  check(!!fermo && conferme(A).length === 0, `⏹: «Interrotto», niente confermato (got: ${fermo || "niente"})`);
  check(await finche(async () => conferme(B).length === 1, 40000), "e la coda va avanti: BIANCHI si conferma");
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 20000 }).catch(() => {});
  await chiudiStampa(doc);
  if (!w.isClosed()) await w.close();
  riscrivi = null;
  await nessunOrdine();
}

// ---- 16. la scheda non si apre: l'ordine lo manda la pagina, come sempre ---
if (prova("se la scheda di sottofondo non si apre, manda la pagina")) {
  nuovi();
  await suPagina(doc, A.patientUrl);
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

// ---- un esame mai partito per un elenco venuto male: si riprova da solo --
// La scheda dell'ordine ritenta UNA volta, lì, prima di dire l'ultima parola:
// il carrello riletto, l'EMOCROMO già entrato solo ritrovato, parte la PCT, e
// conferma come il primo giro. Il medico vede «Riprovo 1 esame…», poi le
// etichette. (La riga della PCT manca una volta sola, anche alla ricerca.)
const togliRiga = (codice) => (h) => h.replace(
  new RegExp(`<tr><td><a class="AFCDataLink" href="[^"]*Insert=Inserisci[^"]*[?&]PRESTAZIONE=${codice}&[^"]*">[^<]*</a></td></tr>`, "g"), "");
if (prova("un esame mai partito per un elenco venuto male — la scheda dell'ordine riprova da sola, una volta")) {
  nuovi();
  lento = 0;
  let monca = true;
  riscrivi = (u, h) => {
    if (!monca) return h;
    if (new URL(u).searchParams.get("s_PRESTAZIONE")) monca = false;   // dopo la ricerca l'elenco torna intero
    return togliRiga("159")(h);
  };
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const s0 = (await strisce(doc)).length;
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "PROCALCITONINA"], { quesito: "febbre" });
  const w = await nasce;
  await suPagina(doc, B.patientUrl);
  const pronte = await striscia(doc, /Etichette di ROSSI M\. pronte/, 45000).catch(() => "");
  const rid = Object.keys(A.state.richieste)[0];
  const viste = (await strisce(doc)).slice(s0);
  check(!!pronte, `alla fine le etichette di ROSSI, pronte (got: ${pronte || "niente"})`);
  check(viste.some((t) => /ROSSI MARIO.*Riprovo 1 esame…/.test(t)) && !viste.some((t) => /Errore/.test(t)),
    `intanto la tua striscia ha detto «Riprovo 1 esame…», e mai un errore (got ${viste.filter((t) => /Riprovo|Errore/.test(t)).join(" | ") || "niente"})`);
  check(A.state.insertCount[`${rid}:320`] === 1 && A.state.insertCount[`${rid}:159`] === 1 && Object.keys(A.state.insertCount).length === 2,
    `ogni esame mandato una volta (${JSON.stringify(A.state.insertCount)})`);
  check(Object.keys(A.state.richieste).length === 1 && conferme(A).length === 1 && A.state.richieste[rid].confirmed === true,
    `stessa richiesta, confermata una volta (got ${conferme(A).length})`);
  check(await aspettaChiusa(w), "e la scheda dell'ordine si chiude da sola");
  riscrivi = null;
  await nessunOrdine();
}

// ---- ritentato da solo e fermo di nuovo: il resoconto di sempre, a te ----
if (prova("ritentato da solo e fermo di nuovo — il resoconto arriva a te, «Riprova» resta tuo")) {
  nuovi();
  lento = 0;
  riscrivi = (u, h) => togliRiga("159")(h);
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const s0 = (await strisce(doc)).length;
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "PROCALCITONINA"], { quesito: "febbre" });
  const w = await nasce;
  await suPagina(doc, B.patientUrl);
  const rossa = await striscia(doc, /ROSSI MARIO.*Errore/, 45000).catch(() => "");
  const rid = Object.keys(A.state.richieste)[0];
  const cercate = () => A.state.requests.filter((q) => q.params.s_PRESTAZIONE).length;
  check(/Mancano: PROCALCITONINA/.test(rossa) && (await $panel(doc, ".pill.run.err").count()) === 1,
    `la striscia rossa di sempre: «Mancano: PROCALCITONINA» (got: ${rossa || "niente"})`);
  check((await strisce(doc)).slice(s0).some((t) => /ROSSI MARIO.*Riprovo 1 esame…/.test(t)), "prima, «Riprovo 1 esame…»");
  check(cercate() === 2 && !A.state.insertCount[`${rid}:159`] && A.state.insertCount[`${rid}:320`] === 1 && conferme(A).length === 0,
    `il giro e il suo unico ritentativo: la PCT mai mandata, l'EMOCROMO una volta, niente confermato (${cercate()} ricerche · ${JSON.stringify(A.state.insertCount)})`);
  check(await aspettaChiusa(w), "la scheda dell'ordine si chiude: il resoconto è passato a te");
  const n0 = A.state.requests.length;
  await doc.waitForTimeout(2500);
  check(A.state.requests.length === n0, "e poi più niente: un terzo giro da solo non parte");
  const reg = await doc.evaluate(() => (JSON.parse(sessionStorage.getItem("psassist:log.999001") || "{}").lines || []).join("\n"));
  check(/ritentato una volta da solo/.test(reg), "il Registro dell'ordine, nel tuo: «ritentato una volta da solo»");
  await $panel(doc, "#strazione").click();
  await doc.waitForURL(/RcsRichiestaPrestazioniRicercaErogatore/, { timeout: 15000 });
  await doc.waitForSelector("#psassist-host .pill.run", { timeout: 10000 });
  await $panel(doc, ".pill.run").click();
  await doc.waitForSelector("#psassist-host .card #riprova", { timeout: 10000 }).catch(() => {});
  const bottoni = await doc.evaluate(() => [...(document.getElementById("psassist-host")?.shadowRoot?.querySelectorAll(".commit button") || [])].map((b) => b.id));
  check(["riprova", "svuota", "chiudi"].every((b) => bottoni.includes(b)),
    `sul carrello il resoconto di sempre: «↻ Riprova i mancanti», «Svuota…», «Chiudi» (got ${bottoni.join(",")})`);
  riscrivi = null;
  await $panel(doc, "#chiudi").click().catch(() => {});
}

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fail ? `\nORDINE-ESTENSIONE: ${fail} CHECK FALLITI\n` : "\nORDINE-ESTENSIONE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
