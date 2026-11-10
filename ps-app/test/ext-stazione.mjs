#!/usr/bin/env node
/*
 * La STAZIONE DI STAMPA, tutta vera: due PC — quello del medico, con
 * l'estensione e il gestionale simulato, e quello dell'infermeria, con la
 * stessa estensione nella sua pagina «Stazione di stampa» —, ognuno col suo
 * finto aiutante di stampa (test/ospite-finto.mjs, le sue stampanti); il
 * ripetitore Node del ponte; l'app dell'iPhone in un terzo browser, con una
 * fotocamera finta che inquadra il QR della stazione.
 * Le prove: la pagina della stazione (il QR, il codice, le stampanti, il
 * nome); il QR inquadrato dal telefono (una carta, «Collega»), il PC e la
 * stazione collegati, lo stesso codice dalle due parti, il telefono che non ha
 * la chiave; un QR scaduto o sbagliato, un telefono senza associazione: niente
 * collegato; un ordine dal PC con «Stampa: Infermeria»: gli stessi fogli della
 * stampa di qui, sulle stampanti della stazione, una volta, e «Stampato in
 * Infermeria»; lo stesso dal telefono (e, per un ordine, «PC»); la stazione
 * spenta: «Infermeria non risponde» e «Stampa qui», un tocco, una stampa qui;
 * la risposta che non arriva: «forse stampate», mai due volte; la stazione che
 * prova a mandare comandi: scartati; nessun nome nel registro della stazione;
 * «Scollega» da tutte e due le parti (anche con l'altra spenta); il
 * ripetitore che non vede niente in chiaro.
 *   node test/ext-stazione.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./gestionale-vero.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "../public/ponte/cripto.js"));
const P = globalThis.PonteCripto;
const EXT = join(root, "extension");
const PROFILO = { pc: join("/tmp", `psa-sta-pc-${process.pid}`), sta: join("/tmp", `psa-sta-sta-${process.pid}`) };
const FINTO = { pc: PROFILO.pc + "-ospite", sta: PROFILO.sta + "-ospite" };
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
const sezione = (t) => console.log("\nstazione: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, nome) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, nome + ".png") }).catch((e) => console.log(`  (foto ${nome} non salvata: ${String(e.message).split("\n")[0]})`)); };
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) { const v = await fn(); if (v) return v; }
  return null;
}

// ---- il ripetitore, che registra quello che inoltra --------------------------
const inoltrati = [];
const relay = await avviaRelay({ osserva: (b) => inoltrati.push(b) });

// ---- i due finti aiutanti di stampa: le stampanti di ognuno --------------------
const STAMPANTI = { pc: ["Zebra Medico", "HP Medico A4"], sta: ["Zebra Infermeria", "HP Infermeria A4"] };
const comportati = (chi, extra = {}) => writeFileSync(join(FINTO[chi], "config.json"), JSON.stringify({ stampanti: STAMPANTI[chi], predefinita: STAMPANTI[chi][1], ...extra }));
const lavori = (chi) => (existsSync(join(FINTO[chi], "lavori.jsonl")) ? readFileSync(join(FINTO[chi], "lavori.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])
  .filter((x) => x.tipo);
for (const chi of ["pc", "sta"]) {
  rmSync(PROFILO[chi], { recursive: true, force: true });
  mkdirSync(FINTO[chi], { recursive: true });
  rmSync(join(FINTO[chi], "lavori.jsonl"), { force: true });
  const l = join(FINTO[chi], "ospite.sh");
  writeFileSync(l, `#!/bin/sh\nPSA_FINTO='${FINTO[chi]}' exec '${process.execPath}' '${join(root, "test/ospite-finto.mjs")}' "$@"\n`);
  chmodSync(l, 0o755);
  comportati(chi);
}
const ID = "jhhlgabilanhhnncahahclcjbefaofij";   // l'ID fisso dell'estensione (la «key» del manifest)
for (const chi of ["pc", "sta"]) {
  mkdirSync(join(PROFILO[chi], "NativeMessagingHosts"), { recursive: true });
  writeFileSync(join(PROFILO[chi], "NativeMessagingHosts", "it.psassist.stampa.json"),
    JSON.stringify({ name: "it.psassist.stampa", description: "finto", path: join(FINTO[chi], "ospite.sh"), type: "stdio", allowed_origins: [`chrome-extension://${ID}/`] }));
}

// ---- il gestionale (sul PC del medico): ROSSI MARIO ---------------------------
const A = createMock({ seedConfirmed: true });
const FOGLIO = /RcsStampaEtichetteLISHMIMU|uploaddownloadservlet|jasperservlet/;
const lancia = (chi) => chromium.launchPersistentContext(PROFILO[chi], {
  headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(), viewport: { width: 1366, height: 820 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
});
const ctx = await lancia("pc");
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 })); } catch { /* niente */ }
  // (il pannello in finestra: la pill «al passaggio» coprirebbe il ⋯ mentre la striscia parla)
  try { localStorage.setItem("psassist:forma.v1", JSON.stringify("finestra")); } catch { /* niente */ }
  try {
    const lab = JSON.stringify({ ris: [], ref: ["aaaa1111-0000-0000-0000-000000000001", "bbbb2222-0000-0000-0000-000000000002"], rich: [] });
    localStorage.setItem("psassist:autoCarica.v1", JSON.stringify({ 999001: { ts: Date.now(), lab, parz: Date.now() } }));
  } catch { /* niente */ }
  // le finestre di stampa (il dialogo) aperte in ogni scheda del gestionale
  if (window.top !== window || location.origin !== "https://smarthealth.multimedica.it") return;
  setInterval(() => {
    const w = document.getElementById("psassist-print");
    if (w && !w.dataset.contato) {
      w.dataset.contato = "1";
      const l = JSON.parse(localStorage.getItem("__psaStampe") || "[]");
      l.push({ titolo: document.title });
      localStorage.setItem("__psaStampe", JSON.stringify(l));
    }
  }, 25);
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request(), u = req.url();
  if (FOGLIO.test(u)) await sospendi(150);
  let out = A.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = A.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* chiusa intanto */ }
});
const swDi = async (c) => c.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || c.waitForEvent("serviceworker", { timeout: 15000 });
const sw = await swDi(ctx);
const EXTURL = (f) => `chrome-extension://${ID}/${f}`;
check(new URL(sw.url()).host === ID, "l'estensione ha il suo ID fisso (lo stesso sui due PC)");
const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`);
const AZIONE = "#strazione, #psassist-host #gchipaz";
const azione = (p) => $panel(p, AZIONE).innerText().then((t) => t.trim()).catch(() => "");
const ordini = () => sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []));
const stampe = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("__psaStampe") || "[]"));
const coppiaPc = () => sw.evaluate(() => chrome.storage.local.get("stazione.coppia").then((o) => o["stazione.coppia"] || null));
const pubblicoPc = () => sw.evaluate(() => chrome.storage.session.get("stazione").then((o) => o.stazione || null));
const striscia = async (page, re, timeout = 30000) => {
  const h = await page.waitForFunction((src) => {
    const r = document.getElementById("psassist-host")?.shadowRoot;
    const t = (r?.querySelector(".pill.run")?.innerText || r?.querySelector(".gchip")?.dataset.riga || "").replace(/\s+/g, " ").trim();
    return new RegExp(src).test(t) ? t : false;
  }, re.source, { timeout }).catch(() => null);
  return h ? h.jsonValue() : "";
};
async function suPagina(p, url) {
  await p.goto(url);
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}
async function apriPannello(page) {
  if (!(await $panel(page, ".card").count())) {
    await $panel(page, "#expand").click();
    await page.waitForSelector("#psassist-host .card", { timeout: 8000 });
  }
  if (!(await $panel(page, "#q").count())) await $panel(page, '[data-seg="richieste"]').click();
  await $panel(page, "#q").waitFor({ timeout: 8000 });
}
async function ordina(page, esami) {
  await apriPannello(page);
  await $panel(page, "#q").fill("dolore toracico");
  for (const e of esami) await $panel(page, `.opt[title*="${e}"]`).click();
  await $panel(page, "#goconfirm").click();
}
// un ordine nuovo e finito: quello che non c'era prima
const finito = (prima, cond, timeout = 60000) => finche(async () => (await ordini()).find((x) => !prima.has(x.id) && x.stampa !== undefined && cond(x)), timeout);
const idsOra = async () => new Set((await ordini()).map((x) => x.id));

// ---- la stazione: l'altro PC ------------------------------------------------
let staCtx = await lancia("sta");
let staSw = await swDi(staCtx);
const statoSta = () => staSw.evaluate(() => chrome.storage.session.get("stazione.stato").then((o) => o["stazione.stato"] || null));
const quiSta = () => staSw.evaluate(() => chrome.storage.local.get("stazione.qui").then((o) => o["stazione.qui"] || null));
// le prove del ponte vanno verso il ripetitore di qui (solo http://localhost: ponte-sw.js)
const versoRelay = (w) => w.evaluate((u) => chrome.storage.local.set({ "ponte.host": u }).then(() => Promise.all([ponteAvvia(), stmAvvia(), stzAvvia()])), relay.url);
await versoRelay(sw);
await versoRelay(staSw);
// la stampa automatica del PC del medico: le sue due stampanti («Stampa qui», e la stampa di sempre)
await sw.evaluate(() => chrome.storage.local.set({ stampa: { attiva: true, etichette: "Zebra Medico", a4: "HP Medico A4" } }));

// ===========================================================================
sezione("la pagina della stazione: il QR, il codice, le stampanti, il nome");
let pSta = await staCtx.newPage();
await pSta.goto(EXTURL("stazione.html"));
await pSta.waitForSelector("#qr svg", { timeout: 10000 });
const testoSta = () => pSta.locator(".box").innerText().catch(() => "");
check(/PS Assist · Stazione di stampa/.test(await pSta.title()) && /Non collegata/.test(await testoSta()) && /⋯ → Collega stampante/.test(await testoSta()),
  "«PS Assist · Stazione di stampa»: non collegata, il QR, e come si inquadra (⋯ → Collega stampante)");
const codiceQr = (await pSta.locator("#qrcodice").innerText()).trim();
check(/^\d{3} \d{3}$/.test(codiceQr), `sotto il QR un codice di sei cifre (got «${codiceQr}»)`);
const offerta = (await statoSta()).offerta;
check(!!offerta && offerta.qr.startsWith(`${relay.url}/ponte/#sta=`) && /&nome=Infermeria$/.test(offerta.qr) && offerta.scade - Date.now() > 4 * 60e3 && offerta.scade - Date.now() <= 5 * 60e3,
  `il QR: un link dell'app del telefono con l'offerta della stazione (#sta=…), il nome, cinque minuti (got ${offerta && offerta.qr.slice(0, 60)}…)`);
// le stampanti di questo PC, dall'aiutante: l'A4 di partenza è la predefinita; le etichette si scelgono
await pSta.waitForFunction(() => !document.getElementById("setic").disabled, null, { timeout: 15000 });
check(await pSta.locator("#sa4").inputValue() === "HP Infermeria A4", "l'A4: la stampante predefinita di Windows di questo PC");
await pSta.locator("#setic").selectOption("Zebra Infermeria");
await finche(async () => (await staSw.evaluate(() => chrome.storage.local.get("stampa"))).stampa?.etichette === "Zebra Infermeria", 5000);
await pSta.locator('[data-prova="etichette"]').click();
await finche(async () => /Pagina di prova/.test(await pSta.locator("#sm").innerText()), 15000);
check(lavori("sta").length === 1 && lavori("sta")[0].stampante === "Zebra Infermeria", "«Prova»: una pagina di prova sull'etichettatrice dell'infermeria");
check(await pSta.locator("#nome").inputValue() === "Infermeria", "il nome di partenza: «Infermeria»");
await shot(pSta, "stazione-1-pagina-qr");
rmSync(join(FINTO.sta, "lavori.jsonl"), { force: true });

// ===========================================================================
sezione("il telefono, associato al PC");
const doc = await ctx.newPage();
await suPagina(doc, A.patientUrl);
const pp = await ctx.newPage();
await pp.goto(EXTURL("ponte.html"));
await pp.waitForSelector("#stato b");
await pp.locator("#associa").click();
await pp.waitForSelector("#qr svg", { timeout: 8000 });
const qrTel = await sw.evaluate(() => ponteQr());
await pp.close();
// il QR della stazione in un video finto per la fotocamera del telefono (y4m, in grigio)
const qrcodegen = (() => { const c = vm.createContext({}); vm.runInContext(readFileSync(join(EXT, "qr.js"), "utf8"), c); return c.qrcodegen; })();
const VID = join("/tmp", `psa-sta-qr-${process.pid}.y4m`);
function video(testo, file) {
  const q = qrcodegen.QrCode.encodeText(testo, qrcodegen.QrCode.Ecc.MEDIUM), W = 640, H = 480, px = Math.floor(460 / (q.size + 8)), lato = (q.size + 8) * px;
  const y = Buffer.alloc(W * H, 235), x0 = (W - lato) / 2 | 0, y0 = (H - lato) / 2 | 0;
  for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.getModule(c, r)) {
    for (let dy = 0; dy < px; dy++) y.fill(16, (y0 + (r + 4) * px + dy) * W + x0 + (c + 4) * px, (y0 + (r + 4) * px + dy) * W + x0 + (c + 5) * px);
  }
  const uv = Buffer.alloc(W * H / 2, 128), fot = Buffer.concat([Buffer.from("FRAME\n"), y, uv]);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), fot, fot]));
  return file;
}
const IPHONE = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "it-IT",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};
const telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video(offerta.qr, VID)}`] });
const telCtx = await telBrowser.newContext({ ...IPHONE, permissions: ["camera"] });
const tel = await telCtx.newPage();
const testoTel = (t = tel) => t.locator("#app").innerText().catch(() => "");
const aspettaTel = async (re, timeout = 20000, t = tel) => ((await finche(async () => re.test(await testoTel(t)), timeout)) ? testoTel(t) : "");
const tocca = (sel, t = tel) => t.locator(sel).first().click();
await tel.goto(qrTel);
check(/ROSSI MARIO/.test(await aspettaTel(/ROSSI MARIO/, 30000)), "il telefono associato al PC: l'elenco dei pazienti");
const chiaveTel = await tel.evaluate(() => localStorage.getItem("psassist.ponte.v1"));

// ===========================================================================
sezione("un QR scaduto, uno sbagliato, un telefono senza associazione: niente collegato");
const b64 = (n) => P.b64u(P.casuale(n));
const pubFinta = () => { const b = P.casuale(65); b[0] = 4; return P.b64u(b); };
const linkSta = (scade, nome = "Infermeria") => `${relay.url}/ponte/#sta=${pubFinta()}.${b64(16)}.${scade}&nome=${encodeURIComponent(nome)}`;
// (un link della stazione aperto, come dalla Fotocamera dell'iPhone: la stessa carta del QR inquadrato)
await tel.evaluate((u) => { location.hash = new URL(u).hash; }, linkSta(Date.now() - 10 * 60e3));
check(/QR scaduto: sulla stazione ne compare uno nuovo/.test(await aspettaTel(/QR scaduto/, 8000)) && await tel.locator('[data-a="stacollega"]').count() === 0,
  "un QR scaduto: «QR scaduto: sulla stazione ne compare uno nuovo», e niente «Collega»");
check(!(await tel.evaluate(() => location.hash)) && await tel.evaluate(() => localStorage.getItem("psassist.ponte.v1")) === chiaveTel, "il frammento non resta nell'indirizzo, e l'associazione del telefono è quella di prima");
await tocca('[data-a="stachiudi"]');
// sbagliato: una stazione che non c'è (il PC aspetta, poi lo dice)
await sw.evaluate(() => { STA_ATTESA.abbina = 4000; });
await tel.evaluate((u) => { location.hash = new URL(u).hash; }, linkSta(Date.now() + 4 * 60e3, "Sbagliata"));
await aspettaTel(/Collegala al PC/, 8000);
await tocca('[data-a="stacollega"]');
const sbagliata = await aspettaTel(/La stazione non risponde/, 20000);
check(/La stazione non risponde: tieni aperta la sua pagina, col QR, e riprova/.test(sbagliata), "un QR di una stazione che non c'è: «La stazione non risponde…»");
check(!(await coppiaPc()) && !(await pubblicoPc()) && !(await quiSta()), "e niente collegato, né sul PC né sulla stazione");
await tocca('[data-a="stachiudi"]');
await sw.evaluate(() => { STA_ATTESA.abbina = 20e3; });
// un telefono senza associazione
const nudoCtx = await telBrowser.newContext(IPHONE);
const nudo = await nudoCtx.newPage();
await nudo.goto(offerta.qr);
check(/Prima associa l'iPhone al PC/.test(await aspettaTel(/Prima associa/, 10000, nudo)) && await nudo.locator('[data-a="stacollega"]').count() === 0,
  "un telefono senza associazione: «Prima associa l'iPhone al PC», niente «Collega»");
await nudoCtx.close();

// ===========================================================================
sezione("il QR della stazione, inquadrato dal telefono: «Collega»");
await tocca('[data-a="menu"]');
await shot(tel, "tel-menu");
check(await tel.locator('.menu [data-a="scansiona"]').innerText() === "🖨️ Collega stampante", "⋯ sul telefono: «🖨️ Collega stampante»");
await tocca('.menu [data-a="scansiona"]');
const carta = await aspettaTel(/Collegala al PC/, 15000);
check(/Stazione di stampa/.test(carta) && /Infermeria/.test(carta) && carta.includes(codiceQr) && await tel.locator('[data-a="stacollega"]').count() === 1,
  `inquadrato il QR: la carta «Stazione di stampa · Infermeria», lo stesso codice della stazione (${codiceQr}), «Collega»`);
check(await tel.evaluate(() => sessionStorage.length === 0 && localStorage.getItem("psassist.ponte.v1")) === chiaveTel && !(await coppiaPc()),
  "la carta non tocca niente: l'associazione del telefono resta quella, e il PC non è collegato finché non si tocca «Collega»");
await shot(tel, "stazione-2-telefono-carta");
await tocca('[data-a="stacollega"]');
const fatta = await aspettaTel(/Collegata al PC/, 40000);
const cPc = await coppiaPc(), qSta = await quiSta(), pubPc = await pubblicoPc();
check(/Collegata al PC/.test(fatta) && !!cPc && !!qSta && cPc.k === qSta.k && cPc.nome === "Infermeria" && cPc.via === "telefono" && qSta.conferma === true,
  "«Collega»: il PC e la stazione hanno la stessa chiave (nata fra loro), il telefono dice «Collegata al PC»");
check(!!pubPc && pubPc.codice === qSta.codice && fatta.includes(qSta.codice) && /^\d{3} \d{3}$/.test(qSta.codice) && !("k" in pubPc),
  `lo stesso codice sul telefono, sul PC e sulla stazione (${qSta.codice}); quello che le pagine del PC vedono non ha la chiave`);
const telTutto = await tel.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
check(!telTutto.includes(cPc.k) && await tel.evaluate(() => localStorage.getItem("psassist.ponte.v1")) === chiaveTel, "il telefono non ha la chiave della stazione: solo la sua di sempre");
const statoS = await finche(async () => { const t = await testoSta(); return /Collegata al PC del medico/.test(t) ? t : ""; }, 10000);
check(!!statoS && statoS.includes(qSta.codice) && /Il PC del medico è collegato adesso/.test(statoS) && await pSta.locator("#qrsec").isHidden(),
  "la stazione: «Collegata al PC del medico», dalle …, lo stesso codice, il PC collegato adesso; il QR non c'è più");
await tocca('[data-a="stachiudi"]');
const imp = await ctx.newPage();
await imp.goto(EXTURL("portale.html"));
await imp.waitForSelector("#stasi:not([hidden])", { timeout: 8000 });
check(/^Infermeria · collegata dal telefono alle \d\d:\d\d$/.test((await imp.locator("#stast").innerText()).trim()) && await imp.locator("#stavia").innerText() === "Scollega",
  `sul PC (⋯ → Stampanti): «Infermeria · collegata dal telefono alle HH:MM», con «Scollega» (got «${(await imp.locator("#stast").innerText()).trim()}»)`);
check(await imp.locator('[data-dove="qui"]').getAttribute("aria-pressed") === "true", "la scelta di partenza: «Stampa: Qui» (niente cambia finché il medico non sceglie)");

// ===========================================================================
sezione("un ordine dal PC: prima qui, poi in Infermeria");
await doc.bringToFront();
await suPagina(doc, A.patientUrl);
let prima = await idsOra();
await ordina(doc, ["TROPONINA"]);
const qui1 = await finito(prima, (x) => x.stato === "avviso" && /^Stampato/.test(x.pubblico?.titolo || ""));
const locali = lavori("pc");
check(!!qui1 && /^Stampato su /.test(qui1.pubblico.titolo) && locali.length >= 2 && lavori("sta").length === 0,
  `«Stampa: Qui»: i fogli sulle stampanti del PC del medico, come sempre (got ${JSON.stringify(locali.map((x) => `${x.tipo}→${x.stampante}`))})`);
// «Stampa: Infermeria», dal menu ⋯ del pannello
await doc.bringToFront();
await apriPannello(doc);
await $panel(doc, "#menubtn").dispatchEvent("click");
check(await $panel(doc, '.menu [data-stdove="stazione"]').innerText() === "Infermeria" && await $panel(doc, '.menu [data-stdove="qui"]').getAttribute("aria-checked") === "true",
  "nel menu ⋯ del pannello: «Stampa: PC · Infermeria» (con una stazione collegata), su «PC»");
await $panel(doc, '.menu [data-stdove="stazione"]').dispatchEvent("click");
await finche(async () => (await sw.evaluate(() => chrome.storage.local.get("stampa"))).stampa?.dove === "stazione", 5000);
await shot(doc, "stazione-3-pc-scelta");
await $panel(doc, "#menubtn").dispatchEvent("click");
if (!(await $panel(doc, "#q").count())) console.log("  (debug) pannello: " + (await $panel(doc, ".card").innerText().catch(() => "—")).replace(/\s+/g, " ").slice(0, 400));
await apriPannello(doc);
await $panel(doc, "#q").fill("dolore toracico");
await $panel(doc, '.opt[title*="TROPONINA"]').click();
const cta = (await $panel(doc, "#goconfirm").innerText()).trim();
check(/→ Infermeria$/.test(cta), `il bottone dell'ordine lo dice: «${cta}»`);
const chip = await doc.evaluate(() => document.getElementById("psassist-host")?.shadowRoot?.querySelector("#stauto")?.innerText.trim() || "");
check(chip === "→ Infermeria", `e la stampantina in intestazione: «→ Infermeria» (got «${chip}»)`);
check(await imp.locator('[data-dove="stazione"]').getAttribute("aria-pressed") === "true", "la scelta resta (e la pagina delle Stampanti la mostra)");
prima = await idsOra();
const pcPrima = lavori("pc").length;
await $panel(doc, "#goconfirm").click();
const inf1 = await finito(prima, (x) => x.stato === "avviso" && /^Stampato/.test(x.pubblico?.titolo || ""));
const st1 = lavori("sta");
const tipi = (l) => l.map((x) => x.tipo).sort().join(",");
check(!!inf1 && inf1.pubblico.titolo === "Stampato in Infermeria" && inf1.dest === "stazione" && inf1.fogli.every((f) => f.stato === "stampato" && f.stazione),
  `l'ordine dice «Stampato in Infermeria» (got ${JSON.stringify(inf1 && inf1.pubblico)})`);
check(st1.length === locali.length && tipi(st1) === tipi(locali) && st1.every((x) => x.ok)
  && st1.filter((x) => x.tipo === "etichette").every((x) => x.stampante === "Zebra Infermeria") && st1.filter((x) => x.tipo === "a4").every((x) => x.stampante === "HP Infermeria A4"),
  `la stazione ha stampato gli stessi fogli della stampa di qui: le etichette sull'etichettatrice dell'infermeria, il resto sull'A4 (got ${JSON.stringify(st1.map((x) => `${x.tipo}→${x.stampante}`))})`);
check(lavori("pc").length === pcPrima && (await stampe(doc)).length === 0, "e niente sulle stampanti del PC del medico, nessun dialogo");
const fine1 = await striscia(doc, /Stampato in Infermeria/, 10000);
check(/Stampato in Infermeria/.test(fine1) && (await azione(doc)) === "Ristampa", `la striscia: «Stampato in Infermeria», con «Ristampa» (got «${fine1}» · ${await azione(doc)})`);
await sospendi(3000);
check(lavori("sta").length === st1.length, "una volta sola");
// la pagina della stazione: gli ultimi fogli, senza nomi
await finche(async () => (await pSta.locator("#lavori li").count()) >= st1.length, 8000);
const righeSta = await pSta.locator("#lavori").innerText();
check(/Etichette/.test(righeSta) && /A4/.test(righeSta) && /Stampato su Zebra Infermeria/.test(righeSta) && /\d\d:\d\d/.test(righeSta),
  "la stazione, «Ultimi fogli»: l'ora, il tipo, com'è andata");
await shot(pSta, "stazione-4-pagina-collegata");

// ===========================================================================
sezione("un ordine dal telefono: la scelta del PC, e per un ordine «PC»");
await tel.reload();
await aspettaTel(/ROSSI MARIO/, 30000);
await tocca('[data-a="paz"]:has-text("ROSSI MARIO")');
await aspettaTel(/Richieste/, 10000);
await tocca('[data-a="scheda"][data-s="richieste"]');
await tocca('[data-a="esame"]:has-text("TROPONINA US")');
await tel.locator("#quesito").fill("dolore toracico");
await tel.locator("#quesito").press("Enter");
const doveTel = async () => tel.locator(".cta .dove button.on").innerText().catch(() => "");
check(await tel.locator(".cta .dove").count() === 1 && await doveTel() === "Infermeria" && /→ Infermeria$/.test(await tel.locator("#ordina").innerText()),
  `sul telefono, sopra «Conferma e stampa»: «Stampa: PC · Infermeria», com'è sul PC (Infermeria), e il bottone lo dice (got «${await tel.locator("#ordina").innerText()}»)`);
await shot(tel, "stazione-5-telefono-ordine");
const sta0 = lavori("sta").length;
prima = await idsOra();
await tocca("#ordina"); await sospendi(900); await tocca("#ordina");
const inf2 = await finito(prima, (x) => x.id.startsWith("tel") && x.stato === "avviso" && /^Stampato/.test(x.pubblico?.titolo || ""));
check(!!inf2 && inf2.pubblico.titolo === "Stampato in Infermeria" && lavori("sta").length === sta0 + st1.length && lavori("pc").length === pcPrima,
  `l'ordine dal telefono: i fogli in Infermeria, una volta (got ${JSON.stringify(inf2 && inf2.pubblico)})`);
check(/Stampato in Infermeria/.test(await aspettaTel(/Stampato in Infermeria/, 15000)), "e il telefono dice «Stampato in Infermeria»");
// per un ordine solo: «PC»
await tocca('[data-a="esame"]:has-text("TROPONINA US")');
await tel.locator("#quesito").fill("dolore toracico");
await tel.locator("#quesito").press("Enter");
await tocca('.cta .dove [data-d="qui"]');
check(await doveTel() === "PC" && !/→/.test(await tel.locator("#ordina").innerText()), "«PC» per questo ordine: il bottone non dice più «→ Infermeria»");
prima = await idsOra();
await tocca("#ordina"); await sospendi(900); await tocca("#ordina");
const qui2 = await finito(prima, (x) => x.id.startsWith("tel") && x.stato === "avviso" && /^Stampato/.test(x.pubblico?.titolo || ""));
check(!!qui2 && /^Stampato su /.test(qui2.pubblico.titolo) && lavori("pc").length === pcPrima + locali.length && lavori("sta").length === sta0 + st1.length,
  `…e i fogli escono sulle stampanti del PC del medico, non in Infermeria (got ${JSON.stringify(qui2 && qui2.pubblico)})`);
check((await sw.evaluate(() => chrome.storage.local.get("stampa"))).stampa?.dove === "stazione", "la scelta del PC resta «Infermeria»: il telefono l'ha cambiata per un ordine solo");

// ===========================================================================
sezione("«Richieste fatte» sul telefono: «Ristampa» sul PC e in Infermeria, una volta");
await tocca('[data-a="scheda"][data-s="esiti"]');
await tocca('[data-a="scheda"][data-s="richieste"]');
const confermate = () => Object.keys(A.state.richieste).filter((r) => A.state.richieste[r].confirmed).sort();
const righeRis = () => tel.locator('[data-a="ristampa"]').evaluateAll((l) => l.map((b) => b.dataset.id).sort());
check(!!(await finche(async () => (await righeRis()).join() === confermate().join(), 15000)) && confermate().includes("699999") && confermate().length >= 3,
  `una riga per ogni richiesta della pagina, anche la 699999 che c'era già (non l'ha fatta il pannello): ${(await righeRis()).join(", ")}`);
await shot(tel, "stazione-5b-richieste-fatte");
const ristampati = (pre) => ordini().then((l) => l.filter((x) => String(x.id).startsWith("ris") && !pre.has(x.id)));
const deiRid = (x, rid) => !!x.stampa && x.stampa.jobs.length >= 2 && x.stampa.jobs.every((j) => new RegExp(`RICHIESTA_ID=${rid}(&|$)`).test(j.url));
// sul PC (la richiesta che non è del pannello), con un doppio tocco: una ristampa sola
await tocca('.dove [data-d="qui"]');
prima = await idsOra();
const pcR = lavori("pc").length, staR = lavori("sta").length;
await tel.locator('[data-a="ristampa"][data-id="699999"]').dblclick();
const risQui = await finche(async () => (await ristampati(prima)).find((x) => x.stato === "avviso" && /^Stampato/.test(x.pubblico?.titolo || "")), 60000);
await sospendi(2500);
check(!!risQui && /^Stampato su /.test(risQui.pubblico.titolo) && (await ristampati(prima)).length === 1 && risQui.dest === "qui" && deiRid(risQui, 699999),
  `«Ristampa» → PC: etichette e foglio della 699999, una ristampa sola nonostante il doppio tocco (got ${JSON.stringify(risQui && risQui.pubblico)})`);
check(lavori("pc").length === pcR + risQui.stampa.jobs.length && lavori("sta").length === staR && tipi(lavori("pc").slice(pcR)) === "a4,etichette" && (await stampe(doc)).length === 0,
  "sulle stampanti del PC del medico, una volta: le etichette sull'etichettatrice e la lista sull'A4; niente in Infermeria, nessun dialogo");
check(/Stampato su/.test(await aspettaTel(/Stampato su/, 15000)), "e il telefono dice «Stampato su …»");
// in Infermeria (un'altra richiesta, quella di un ordine)
const altra = confermate().find((r) => r !== "699999");
await tocca('.dove [data-d="stazione"]');
prima = await idsOra();
const pcR2 = lavori("pc").length, staR2 = lavori("sta").length;
await tel.locator(`[data-a="ristampa"][data-id="${altra}"]`).click();
const risSta = await finche(async () => (await ristampati(prima)).find((x) => x.stato === "avviso" && /^Stampato/.test(x.pubblico?.titolo || "")), 60000);
await sospendi(2500);
check(!!risSta && risSta.pubblico.titolo === "Stampato in Infermeria" && risSta.dest === "stazione" && deiRid(risSta, altra),
  `«Ristampa» → Infermeria: i fogli della richiesta ${altra} (got ${JSON.stringify(risSta && risSta.pubblico)})`);
check(lavori("sta").length === staR2 + risSta.stampa.jobs.length && lavori("pc").length === pcR2 && (await ristampati(prima)).length === 1,
  "sulle stampanti della stazione, una volta; niente sul PC del medico");
check(/Stampato in Infermeria/.test(await aspettaTel(/Stampato in Infermeria/, 15000)), "e il telefono dice «Stampato in Infermeria»");

// ===========================================================================
sezione("la risposta della stazione che non arriva: «forse stampate», mai due volte");
comportati("sta", { lento: 5000 });
await sw.evaluate(() => { STA_ATTESA.ultimo = 2000; STA_ATTESA.esito = 1500; });
await suPagina(doc, A.patientUrl);
prima = await idsOra();
const sta1 = lavori("sta").length, pc1 = lavori("pc").length;
await ordina(doc, ["TROPONINA"]);
const ign = await finito(prima, (x) => x.stato === "avviso" && x.fogli && x.fogli.some((f) => f.stato === "sconosciuto"));
check(!!ign && /Infermeria non risponde/.test(ign.pubblico.titolo) && /forse stampat/.test(ign.pubblico.testo),
  `l'ultimo pezzo è arrivato, la risposta no: «Infermeria non risponde · forse stampate: guarda lì…» (got ${JSON.stringify(ign && ign.pubblico)})`);
const forse = await striscia(doc, /Infermeria non risponde/, 10000);
check(/forse stampat/.test(forse) && (await azione(doc)) === "Stampa qui", `la striscia lo dice, con «Stampa qui» accanto (got «${forse}» · ${await azione(doc)})`);
await finche(() => lavori("sta").length >= sta1 + locali.length, 20000);
await sospendi(2000);
check(lavori("sta").length === sta1 + locali.length && lavori("pc").length === pc1 && (await stampe(doc)).length === 0,
  "la stazione li ha stampati, una volta; qui niente da solo, nessun dialogo");
await sw.evaluate(() => { STA_ATTESA.ultimo = 120e3; STA_ATTESA.esito = 15e3; });
comportati("sta");

// ===========================================================================
sezione("la stazione spenta: «Infermeria non risponde» e «Stampa qui»");
await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));   // (l'avviso di prima, letto)
await pSta.close();
await staCtx.close();
check(!!(await finche(async () => (await pubblicoPc())?.presente === false, 10000)), "chiuso Chrome sulla stazione: il PC lo sa (non risponde)");
await suPagina(doc, A.patientUrl);
prima = await idsOra();
const pc2 = lavori("pc").length, sta2 = lavori("sta").length;
await ordina(doc, ["TROPONINA"]);
const muta = await finito(prima, (x) => x.stato === "stampa");
check(!!muta && muta.pubblico.titolo === "Infermeria non risponde" && muta.dest === "stazione" && muta.fogli.every((f) => f.stato === "fallito" && f.nonRisponde),
  `«Infermeria non risponde», nessun foglio arrivato (got ${JSON.stringify(muta && muta.pubblico)})`);
const nr = await striscia(doc, /Infermeria non risponde/, 10000);
check(/Infermeria non risponde/.test(nr) && (await azione(doc)) === "Stampa qui", `la striscia: «Infermeria non risponde», con «Stampa qui» (got «${nr}» · ${await azione(doc)})`);
const righeQui = await doc.evaluate(() => [...(document.getElementById("psassist-host")?.shadowRoot?.querySelectorAll(".pjrist") || [])].map((b) => b.textContent.trim()));
check(righeQui.length > 0 && righeQui.every((t) => t === "Stampa qui"), `…e sotto, sulle righe dei fogli: «Stampa qui», non «Ristampa» (got ${JSON.stringify(righeQui)})`);
await sospendi(3000);
check(lavori("pc").length === pc2 && (await stampe(doc)).length === 0, "niente stampato qui da solo: né l'aiutante, né il dialogo");
await shot(doc, "stazione-6-pc-non-risponde");
await $panel(doc, AZIONE).click();
await finche(() => lavori("pc").length >= pc2 + locali.length, 30000);
await sospendi(2500);
const quiOra = lavori("pc").slice(pc2);
check(quiOra.length === locali.length && tipi(quiOra) === tipi(locali) && quiOra.filter((x) => x.tipo === "etichette").every((x) => x.stampante === "Zebra Medico")
  && lavori("sta").length === sta2 && (await stampe(doc)).length === 0,
  `«Stampa qui», un tocco: gli stessi fogli sulle stampanti del PC del medico, una volta (got ${JSON.stringify(quiOra.map((x) => `${x.tipo}→${x.stampante}`))})`);
const dopoQui = await striscia(doc, /Stampato su/, 15000);
check(/Stampato su Zebra Medico/.test(dopoQui) && !(await ordini()).some((x) => x.id === muta.id), `poi «Stampato su Zebra Medico…», e l'ordine di prima non aspetta più (got «${dopoQui}»)`);

// ===========================================================================
sezione("«Ristampa» dal telefono con la stazione spenta: «Infermeria non risponde», niente qui da solo");
await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
await tocca('[data-a="scheda"][data-s="esiti"]');
await tocca('[data-a="scheda"][data-s="richieste"]');
await tocca('.dove [data-d="stazione"]');
prima = await idsOra();
const pcR3 = lavori("pc").length;
await tel.locator('[data-a="ristampa"][data-id="699999"]').click();
const risMuta = await finche(async () => (await ristampati(prima)).find((x) => x.stato === "stampa"), 60000);
check(!!risMuta && risMuta.pubblico.titolo === "Infermeria non risponde" && risMuta.dest === "stazione" && risMuta.fogli.every((f) => f.stato === "fallito" && f.nonRisponde),
  `la stazione spenta: «Infermeria non risponde», nessun foglio arrivato (got ${JSON.stringify(risMuta && risMuta.pubblico)})`);
check(/Infermeria non risponde/.test(await aspettaTel(/Infermeria non risponde/, 15000)), "e il telefono lo dice");
await sospendi(2500);
check(lavori("pc").length === pcR3 && (await stampe(doc)).length === 0, "niente stampato qui da solo");
await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));

// ===========================================================================
sezione("la stazione riaperta: si ricollega da sola; non può mandare comandi");
staCtx = await lancia("sta");
staSw = await swDi(staCtx);
pSta = await staCtx.newPage();
await pSta.goto(EXTURL("stazione.html"));
check(!!(await finche(async () => (await pubblicoPc())?.presente === true, 30000)) && /Collegata al PC del medico/.test(await testoSta()),
  "riaperto Chrome sulla stazione: si ricollega da sola, «Collegata al PC del medico»");
// un ordine, perché ci sia una sessione; poi la stazione prova a parlare per prima
await suPagina(doc, A.patientUrl);
prima = await idsOra();
await ordina(doc, ["TROPONINA"]);
check(!!(await finito(prima, (x) => x.stato === "avviso" && x.pubblico?.titolo === "Stampato in Infermeria")), "un ordine: di nuovo «Stampato in Infermeria»");
const ign0 = await sw.evaluate(() => stm.ignorati);
const ord0 = (await ordini()).length, reg0 = JSON.stringify((await sw.evaluate(() => chrome.storage.session.get("ponte"))).ponte?.registro || []);
const mandati = await staSw.evaluate(async () => {
  const s = stz.sessione;
  if (!s) return 0;
  let n = 0;
  for (const m of [{ id: 9001, cmd: "pazienti" }, { id: 9002, cmd: "ordina", ep: "999001", esami: ["00660001P:324"] }, { re: 777, ok: true, dati: { esito: "stampato" } }, { evento: "ordine", ordine: {} }]) {
    if (stz.presa.manda(await s.canale.cifra(m))) n++;
  }
  // e un saluto da «telefono», con la chiave della coppia
  if (stz.presa.manda(await PonteCripto.sigilla(stz.chiavi.salutoTel, PonteCripto.TIPO.SALUTO_TEL, 0, { v: 1, n: PonteCripto.b64u(PonteCripto.casuale(16)), dev: "x".repeat(16) }))) n++;
  return n;
});
await sospendi(2000);
const ign1 = await sw.evaluate(() => stm.ignorati);
check(mandati === 5 && ign1 - ign0 === 5, `la stazione manda al PC due comandi, una risposta a una domanda mai fatta, un evento e un saluto: il PC li scarta tutti (${ign1 - ign0} di ${mandati})`);
check((await ordini()).length === ord0 && JSON.stringify((await sw.evaluate(() => chrome.storage.session.get("ponte"))).ponte?.registro || []) === reg0,
  "nessun ordine nato, niente nel registro del ponte: la stazione non comanda niente");

// ===========================================================================
sezione("niente nomi sulla stazione, niente in chiaro sul ripetitore");
const tuttoSta = await staSw.evaluate(async () => JSON.stringify({ ...(await chrome.storage.local.get(null)), ...(await chrome.storage.session.get(null)) }));
check(!/ROSSI|MARIO|999001|TROPONINA/.test(tuttoSta) && !/ROSSI/.test(await testoSta()), "nella memoria della stazione e sulla sua pagina: nessun nome, episodio o esame");
check(!/"pdf"|JVBER/.test(tuttoSta), "e nessun PDF: dopo la stampa non tiene niente del foglio");
const tutti = Buffer.concat(inoltrati);
const visti = ["ROSSI", "MARIO", "TROPONINA", "999001", "Infermeria", "%PDF", "JVBERi"].filter((s) => tutti.includes(Buffer.from(s, "latin1")));
check(inoltrati.length > 20 && !visti.length, `il ripetitore ha inoltrato ${inoltrati.length} messaggi: niente in chiaro (trovati: ${visti.join(", ") || "nessuno"})`);

// ===========================================================================
sezione("«Scollega» dalla stazione, poi dal PC (anche con la stazione spenta)");
await pSta.locator("#scollega").click();
check(/Scollego\?/.test(await pSta.locator("#scollega").innerText()), "«Scollega» chiede conferma");
await pSta.locator("#scollega").click();
check(!!(await finche(async () => !(await coppiaPc()) && !(await pubblicoPc()), 10000)), "scollegata dalla stazione: il PC lo sa subito, e dimentica la chiave");
check(!!(await finche(async () => /Non collegata/.test(await testoSta()) && await pSta.locator("#qr svg").count() === 1, 10000)) && !(await quiSta()), "la stazione: «Non collegata», e un QR nuovo");
await imp.reload();
await imp.waitForSelector("#stano:not([hidden])", { timeout: 8000 });
check(await imp.locator("#stasi").isHidden(), "sul PC, le Stampanti: niente stazione, i passi per collegarne una");
await doc.bringToFront();
await suPagina(doc, A.patientUrl);
await apriPannello(doc);
check(!/→/.test(await $panel(doc, "#goconfirm").innerText().catch(() => "")) && !(await doc.evaluate(() => document.getElementById("psassist-host")?.shadowRoot?.querySelector("#stauto.sta"))),
  "e il pannello torna com'era: niente «→ Infermeria»");
// di nuovo collegata (il QR nuovo, aperto sul telefono come un link), poi scollegata dal PC
const nuovo = (await statoSta()).offerta;
await tel.evaluate((u) => { location.hash = new URL(u).hash; }, nuovo.qr);
await aspettaTel(/Collegala al PC/, 10000);
await tocca('[data-a="stacollega"]');
check(/Collegata al PC/.test(await aspettaTel(/Collegata al PC/, 40000)) && !!(await coppiaPc()), "collegata di nuovo, col QR nuovo");
await tocca('[data-a="stachiudi"]');
await imp.reload();
await imp.waitForSelector("#stasi:not([hidden])", { timeout: 8000 });
await imp.locator("#stavia").click();
await imp.locator("#stavia").click();
check(!!(await finche(async () => !(await pubblicoPc()) && !(await coppiaPc()), 10000)), "«Scollega» sul PC (due tocchi): niente più stazione");
check(!!(await finche(async () => /Non collegata/.test(await testoSta()) && !(await quiSta()), 10000)), "e la stazione lo sa subito: «Non collegata»");
// con la stazione spenta: il PC la scollega lo stesso, e lei lo sa quando si riaccende
await tel.evaluate((u) => { location.hash = new URL(u).hash; }, (await finche(async () => (await statoSta())?.offerta, 8000)).qr);
await aspettaTel(/Collegala al PC/, 10000);
await tocca('[data-a="stacollega"]');
check(/Collegata al PC/.test(await aspettaTel(/Collegata al PC/, 40000)), "collegata una terza volta");
await tocca('[data-a="stachiudi"]');
await pSta.close();
await staCtx.close();
await imp.reload();
await imp.waitForSelector("#stasi:not([hidden])", { timeout: 8000 });
await imp.locator("#stavia").click();
await imp.locator("#stavia").click();
check(!!(await finche(async () => !(await pubblicoPc()), 8000)), "la stazione spenta: «Scollega» sul PC vale subito (niente più «Infermeria» sul PC)");
staCtx = await lancia("sta");
staSw = await swDi(staCtx);
check(!!(await finche(async () => !(await quiSta()) && !(await coppiaPc()), 30000)), "riaccesa, la stazione sa di essere scollegata; il PC ha dimenticato tutto");

await staCtx.close();
await telBrowser.close();
await ctx.close();
await relay.chiudi();
for (const chi of ["pc", "sta"]) { rmSync(PROFILO[chi], { recursive: true, force: true }); rmSync(FINTO[chi], { recursive: true, force: true }); }
rmSync(VID, { force: true });
console.log(fail ? `\nSTAZIONE: ${fail} CHECK FALLITI\n` : "\nSTAZIONE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
