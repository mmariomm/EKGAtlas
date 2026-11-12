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
// Un ordine confermato dice «Confermata»: com'è andata la stampa è la frase
// sotto («Stampato su …»), e quello che le stava sotto scende alla riga dopo.
// Qui si legge la stampa com'è andata, per un ordine e per una ristampa.
const conStampa = (p) => !!p && p.titolo === "Confermata" && !!p.testo && !/^(Stampo|Etichette pronte|Fermo la stampa|L'etichetta anagrafica)/.test(p.testo);
const stampaDi = (p) => (!p ? "" : conStampa(p) ? p.testo : p.titolo);
const sottoDi = (p) => (!p ? "" : conStampa(p) ? String(p.dettaglio || "").split(" · ")[0] : p.testo);
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
  // (il pannello che si apre col tocco, Affianca: la pill «al passaggio» coprirebbe il ⋯ mentre la striscia parla)
  try { localStorage.setItem("psassist:forma.v1", JSON.stringify("affianca")); } catch { /* niente */ }
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
check(/PS Assist · Stazione di stampa/.test(await pSta.title()) && /Non collegata/.test(await testoSta()) && /⋯ → Scansiona il QR/.test(await testoSta()),
  "«PS Assist · Stazione di stampa»: non collegata, il QR, e come si inquadra (⋯ → Scansiona il QR)");
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
// (gli stessi PSA_CHROMIUM_ARGS del PC, come in ext-ponte: senza --disable-dev-shm-usage il telefono si schianta aprendo i PDF)
const telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video(offerta.qr, VID)}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)] });
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
check(await tel.locator('.menu [data-a="scansiona"]').innerText() === "📷 Scansiona il QR", "⋯ sul telefono: «📷 Scansiona il QR» (un QR solo per tutto: anche la stazione)");
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
// subito, SENZA ricaricare la pagina del telefono: il telefono sa già la stazione
// (dopo «Collega» rilegge il catalogo del PC) — prima la scelta compariva solo
// riaprendo l'app, e dal telefono non si poteva scegliere l'Infermeria
await tocca('[data-a="menu"]');
const menuSta = await finche(async () => { const t = await tel.locator('.menu [data-a="stampaPdf"]').innerText().catch(() => ""); return /· PC$/.test(t) ? t : ""; }, 10000) || "";
check(!!menuSta && await tel.locator(".menu .stdove").count() === 0 && !/Stampa su/.test(await tel.locator(".menu").innerText()) && await tel.locator('.menu [data-a="stampaPdf"]').count() === 1,
  `collegata, senza ricaricare: nel ⋯ del telefono una sola «📄 Stampa PDF · PC» (com'è sul PC), e niente riga «Stampa su» (got «${menuSta}»)`);
await tocca('[data-a="menu"]');   // (lo richiude)
const imp = await ctx.newPage();
await imp.goto(EXTURL("portale.html"));
await imp.waitForSelector("#stasi:not([hidden])", { timeout: 8000 });
check(/^Infermeria · collegata dal telefono alle \d\d:\d\d$/.test((await imp.locator("#stast").innerText()).trim()) && await imp.locator("#stavia").innerText() === "Scollega",
  `sul PC (⋯ → Stampanti): «Infermeria · collegata dal telefono alle HH:MM», con «Scollega» (got «${(await imp.locator("#stast").innerText()).trim()}»)`);
check(await imp.locator("[data-dove]").count() === 0 && /menu ⋯ del pannello/.test(await imp.locator("#stasi").innerText()),
  "nelle impostazioni la stazione e «Scollega», ma la scelta «Stampa su» no: sta nel menu ⋯ del pannello (un posto solo)");

// ===========================================================================
sezione("un ordine dal PC: prima qui, poi in Infermeria");
await doc.bringToFront();
await suPagina(doc, A.patientUrl);
let prima = await idsOra();
await ordina(doc, ["TROPONINA"]);
const qui1 = await finito(prima, (x) => x.stato === "avviso" && /^Stampato/.test(stampaDi(x.pubblico) || ""));
const locali = lavori("pc");
check(!!qui1 && /^Stampato su /.test(stampaDi(qui1.pubblico)) && locali.length >= 2 && lavori("sta").length === 0,
  `«Stampa: Qui»: i fogli sulle stampanti del PC del medico, come sempre (got ${JSON.stringify(locali.map((x) => `${x.tipo}→${x.stampante}`))})`);
// «Stampa: Infermeria», dal menu ⋯ del pannello
await doc.bringToFront();
await apriPannello(doc);
await $panel(doc, "#menubtn").dispatchEvent("click");
check(await $panel(doc, '.menu [data-stdove="stazione"]').innerText() === "Infermeria" && await $panel(doc, '.menu [data-stdove="qui"]').getAttribute("aria-checked") === "true",
  "nel menu ⋯ del pannello: «Stampa su: PC · Infermeria» (con una stazione collegata), su «PC», la scelta di partenza");
check(/^Stampa su/.test((await $panel(doc, '.menu .mforma[aria-label="Dove stampano gli ordini"]').innerText()).trim()), "con la parola «Stampa su»");
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
check((await sw.evaluate(() => chrome.storage.local.get("stampa"))).stampa?.dove === "stazione", "la scelta resta");
prima = await idsOra();
const pcPrima = lavori("pc").length;
await $panel(doc, "#goconfirm").click();
const inf1 = await finito(prima, (x) => x.stato === "avviso" && /^Stampato/.test(stampaDi(x.pubblico) || ""));
const st1 = lavori("sta");
const tipi = (l) => l.map((x) => x.tipo).sort().join(",");
check(!!inf1 && stampaDi(inf1.pubblico) === "Stampato in Infermeria" && inf1.dest === "stazione" && inf1.fogli.every((f) => f.stato === "stampato" && f.stazione),
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
sezione("«Stampa: PC · Infermeria» sopra un ordine si ricorda: poi «Stampa PDF» dal telefono, alla stazione, non al PC");
await tel.reload();
await aspettaTel(/ROSSI MARIO/, 30000);
// la scelta si fa dove si stampa: sopra «Conferma e stampa» (scelto un esame), e resta — per questo PC, sul telefono
await tocca('[data-a="paz"]:has-text("ROSSI MARIO")');
await aspettaTel(/Richieste/, 10000);
await tocca('[data-a="scheda"][data-s="richieste"]');
await tocca('[data-a="esame"]:has-text("TROPONINA US")');
await finche(async () => (await tel.locator('.cta .dove [data-d="stazione"]').count()) > 0, 10000);
await tocca('.cta .dove [data-d="stazione"]');
await tocca('[data-a="esame"]:has-text("TROPONINA US")');   // (e niente ordine: l'esame tolto)
await tocca('[data-a="indietro"]');
await aspettaTel(/ROSSI MARIO/, 10000);
await tocca('[data-a="menu"]');
const memDove = await tel.evaluate(() => JSON.parse(localStorage.getItem("psassist.ponte.dove.v1") || "null"));
check(/Stampa PDF · Infermeria/.test(await tel.locator('.menu [data-a="stampaPdf"]').innerText()) && !!memDove && Object.values(memDove).join() === "stazione",
  `«Stampa: Infermeria» toccato sopra un ordine: si ricorda (sul telefono, per questo PC) — la voce del ⋯ dice «Stampa PDF · Infermeria» (got ${JSON.stringify(memDove)})`);
const staP = lavori("sta").length, pcP = lavori("pc").length;
const pdfSta = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const [fcSta] = await Promise.all([tel.waitForEvent("filechooser", { timeout: 8000 }), tocca('.menu [data-a="stampaPdf"]')]);
await fcSta.setFiles({ name: "foglio.pdf", mimeType: "application/pdf", buffer: pdfSta });
const cartaPdf = await finche(async () => { const t = await tel.locator(".stampa").innerText().catch(() => ""); return /Stampato in Infermeria|NON stampato|Non so se/.test(t) ? t : ""; }, 60000) || "";
await finche(() => lavori("sta").length > staP, 10000);
const nuoviSta = lavori("sta").slice(staP);
check(/Stampato in Infermeria/.test(cartaPdf) && nuoviSta.length === 1 && nuoviSta[0].tipo === "a4" && nuoviSta[0].stampante === "HP Infermeria A4" && lavori("pc").length === pcP,
  `«📄 Stampa PDF» con «Stampa su» Infermeria: un foglio sull'A4 dell'infermeria, niente sulle stampanti del PC, e il telefono lo dice (got «${cartaPdf.replace(/\n+/g, " · ")}»; ${JSON.stringify(nuoviSta.map((x) => `${x.tipo}→${x.stampante}`))})`);
await tocca('[data-a="stampaVia"]').catch(() => {});

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
const inf2 = await finito(prima, (x) => x.id.startsWith("tel") && x.stato === "avviso" && /^Stampato/.test(stampaDi(x.pubblico) || ""));
check(!!inf2 && stampaDi(inf2.pubblico) === "Stampato in Infermeria" && lavori("sta").length === sta0 + st1.length && lavori("pc").length === pcPrima,
  `l'ordine dal telefono: i fogli in Infermeria, una volta (got ${JSON.stringify(inf2 && inf2.pubblico)})`);
check(/Stampato in Infermeria/.test(await aspettaTel(/Stampato in Infermeria/, 15000)), "e il telefono dice «Stampato in Infermeria»");
// «PC», toccato: per questo ordine e quelli dopo (si ricorda)
await tocca('[data-a="esame"]:has-text("TROPONINA US")');
await tel.locator("#quesito").fill("dolore toracico");
await tel.locator("#quesito").press("Enter");
await tocca('.cta .dove [data-d="qui"]');
check(await doveTel() === "PC" && !/→/.test(await tel.locator("#ordina").innerText()), "«PC» toccato: il bottone non dice più «→ Infermeria»");
prima = await idsOra();
await tocca("#ordina"); await sospendi(900); await tocca("#ordina");
const qui2 = await finito(prima, (x) => x.id.startsWith("tel") && x.stato === "avviso" && /^Stampato/.test(stampaDi(x.pubblico) || ""));
check(!!qui2 && /^Stampato su /.test(stampaDi(qui2.pubblico)) && lavori("pc").length === pcPrima + locali.length && lavori("sta").length === sta0 + st1.length,
  `…e i fogli escono sulle stampanti del PC del medico, non in Infermeria (got ${JSON.stringify(qui2 && qui2.pubblico)})`);
check((await sw.evaluate(() => chrome.storage.local.get("stampa"))).stampa?.dove === "stazione", "la scelta del PC resta «Infermeria»: il telefono ha la sua");
// riaperta l'app, la scelta del telefono è quella toccata l'ultima volta: «PC»
await tel.reload();
await aspettaTel(/ROSSI MARIO/, 30000);
await tocca('[data-a="paz"]:has-text("ROSSI MARIO")');
await aspettaTel(/Richieste/, 10000);
await tocca('[data-a="scheda"][data-s="richieste"]');
await tocca('[data-a="esame"]:has-text("TROPONINA US")');
check(await finche(async () => await doveTel() === "PC", 10000), "riaperta l'app, sopra «Conferma e stampa» c'è ancora «PC»: si ricorda l'ultima scelta");
await tocca('.cta .dove [data-d="stazione"]');   // (di nuovo Infermeria, per le prove dopo)
await tocca('[data-a="esame"]:has-text("TROPONINA US")');

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
// la scelta «Stampa [PC] [Infermeria]» sopra «Richieste fatte» (fuori dalla barra dell'ordine): si vede quale è scelta
const sceltaStile = () => tel.locator(".lbl + .dove button").evaluateAll((l) => l.map((b) => ({ d: b.dataset.d, on: b.classList.contains("on"), bg: getComputedStyle(b).backgroundColor, h: b.getBoundingClientRect().height })));
const stile = (st, d) => st.length === 2 && st.filter((x) => x.on).length === 1 && st.find((x) => x.on).d === d && st.find((x) => x.on).bg !== st.find((x) => !x.on).bg && st.every((x) => x.h >= 44);
const st0 = await sceltaStile();
check(stile(st0, "stazione"), `«Stampa PC · Infermeria» sopra «Richieste fatte»: uno solo scelto (come il PC: Infermeria), con uno stile suo, diverso dall'altro, da 44 px (got ${JSON.stringify(st0)})`);
// sul PC (la richiesta che non è del pannello), con un doppio tocco: una ristampa sola
await tocca('.dove [data-d="qui"]');
check(stile(await sceltaStile(), "qui"), "toccato «PC»: la scelta si sposta lì, e si vede");
prima = await idsOra();
const pcR = lavori("pc").length, staR = lavori("sta").length;
await tocca('[data-a="ristampa"][data-id="699999"]');
await tel.locator('[data-a="ristampaQ"][data-id="699999"][data-q="tutto"]').dblclick();
const risQui = await finche(async () => (await ristampati(prima)).find((x) => x.stato === "avviso" && /^Stampato/.test(stampaDi(x.pubblico) || "")), 60000);
await sospendi(2500);
check(!!risQui && /^Stampato su /.test(stampaDi(risQui.pubblico)) && (await ristampati(prima)).length === 1 && risQui.dest === "qui" && deiRid(risQui, 699999),
  `«Ristampa» → PC: etichette e foglio della 699999, una ristampa sola nonostante il doppio tocco (got ${JSON.stringify(risQui && risQui.pubblico)})`);
check(lavori("pc").length === pcR + risQui.stampa.jobs.length && lavori("sta").length === staR && tipi(lavori("pc").slice(pcR)) === "a4,etichette" && (await stampe(doc)).length === 0,
  "sulle stampanti del PC del medico, una volta: le etichette sull'etichettatrice e la lista sull'A4; niente in Infermeria, nessun dialogo");
check(/Stampato su/.test(await aspettaTel(/Stampato su/, 15000)), "e il telefono dice «Stampato su …»");
// in Infermeria (un'altra richiesta, quella di un ordine)
const altra = confermate().find((r) => r !== "699999");
await tocca('.dove [data-d="stazione"]');
check(stile(await sceltaStile(), "stazione"), "toccato «Infermeria»: la scelta torna lì, e si vede");
prima = await idsOra();
const pcR2 = lavori("pc").length, staR2 = lavori("sta").length;
await tocca(`[data-a="ristampa"][data-id="${altra}"]`);
await tocca(`[data-a="ristampaQ"][data-id="${altra}"][data-q="tutto"]`);
const risSta = await finche(async () => (await ristampati(prima)).find((x) => x.stato === "avviso" && /^Stampato/.test(stampaDi(x.pubblico) || "")), 60000);
await sospendi(2500);
check(!!risSta && stampaDi(risSta.pubblico) === "Stampato in Infermeria" && risSta.dest === "stazione" && deiRid(risSta, altra),
  `«Ristampa» → Infermeria: i fogli della richiesta ${altra} (got ${JSON.stringify(risSta && risSta.pubblico)})`);
check(lavori("sta").length === staR2 + risSta.stampa.jobs.length && lavori("pc").length === pcR2 && (await ristampati(prima)).length === 1,
  "sulle stampanti della stazione, una volta; niente sul PC del medico");
check(/Stampato in Infermeria/.test(await aspettaTel(/Stampato in Infermeria/, 15000)), "e il telefono dice «Stampato in Infermeria»");


// ===========================================================================
sezione("dal telefono, in Infermeria: un referto con 🖨️, e «Ristampa» solo le etichette");
{
  // un referto PDF salvato sul PC per ROSSI: la TC (il suo id è quello del gestionale simulato). La copia è già
  // stata guardata ed è sua (`chi: "ok"`): un PDF senza testo, se no, al telefono non va (fail-closed)
  const ID_TC = "cccc3333-0000-0000-0000-000000000003";
  const pdfRef = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  await sw.evaluate(([k, data]) => chrome.storage.local.set({ [k]: { ep: "999001", data, ts: Date.now(), chi: "ok" } }), ["ref:" + ID_TC, pdfRef.toString("base64")]);
  await tel.reload();
  await aspettaTel(/ROSSI MARIO/, 30000);
  await tocca('[data-a="paz"]:has-text("ROSSI MARIO")');
  await aspettaTel(/Richieste/, 10000);
  await tocca('[data-a="scheda"][data-s="esiti"]');
  await aspettaTel(/TC ENCEFALO/, 20000);
  const prn = tel.locator('.refw:has-text("TC ENCEFALO") .prn');
  await finche(async () => (await prn.count()) === 1, 15000);
  const staA = lavori("sta").length, pcA = lavori("pc").length;
  await prn.click();
  const cartaRef = await finche(async () => { const t = await tel.locator(".stampa").innerText().catch(() => ""); return /Stampato in Infermeria|NON stampato|Non so se/.test(t) ? t : ""; }, 60000) || "";
  await finche(() => lavori("sta").length > staA, 10000);
  await sospendi(1500);
  const nuoviRef = lavori("sta").slice(staA);
  check(/Stampato in Infermeria/.test(cartaRef) && nuoviRef.length === 1 && nuoviRef[0].tipo === "a4" && nuoviRef[0].stampante === "HP Infermeria A4" && nuoviRef[0].byte === pdfRef.length && lavori("pc").length === pcA,
    `🖨️ sul referto, con «Stampa su» Infermeria: un foglio sull'A4 dell'infermeria (la copia del PC, intera), niente sulle stampanti del PC (got «${cartaRef.replace(/\n+/g, " · ")}»; ${JSON.stringify(nuoviRef.map((x) => `${x.tipo}→${x.stampante}`))})`);
  await tocca('[data-a="stampaVia"]').catch(() => {});
  await sw.evaluate((k) => chrome.storage.local.remove(k), "ref:" + ID_TC);

  // «Ristampa» → «🏷️ Etichette»: solo i lavori dell'etichettatrice, in Infermeria
  await tocca('[data-a="scheda"][data-s="richieste"]');
  const altra2 = confermate().find((r) => r !== "699999");
  await finche(async () => (await tel.locator(`[data-a="ristampa"][data-id="${altra2}"]`).count()) === 1, 15000);
  prima = await idsOra();
  const staE = lavori("sta").length, pcE = lavori("pc").length;
  await tocca(`[data-a="ristampa"][data-id="${altra2}"]`);
  await tocca(`[data-a="ristampaQ"][data-id="${altra2}"][data-q="etichette"]`);
  const risEt = await finche(async () => (await ristampati(prima)).find((x) => x.stato === "avviso" && /^Stampato/.test(stampaDi(x.pubblico) || "")), 60000);
  await sospendi(2500);
  const nuoviEt = lavori("sta").slice(staE);
  check(!!risEt && risEt.dest === "stazione" && risEt.stampa.jobs.length === nuoviEt.length && nuoviEt.length >= 1 && tipi(nuoviEt) === "etichette" && lavori("pc").length === pcE && (await ristampati(prima)).length === 1,
    `«Ristampa» → «🏷️ Etichette» in Infermeria: solo lavori dell'etichettatrice, nessun foglio A4, niente sul PC (got ${JSON.stringify(nuoviEt.map((x) => `${x.tipo}→${x.stampante}`))})`);
  check(/Stampato in Infermeria/.test(await aspettaTel(/Stampato in Infermeria/, 15000)), "e il telefono dice «Stampato in Infermeria»");
  await tocca('[data-a="stampaVia"]').catch(() => {});
}

// ===========================================================================
sezione("la risposta della stazione che non arriva: «forse stampate», mai due volte");
comportati("sta", { lento: 5000 });
await sw.evaluate(() => { STA_ATTESA.ultimo = 2000; STA_ATTESA.esito = 1500; });
await suPagina(doc, A.patientUrl);
prima = await idsOra();
const sta1 = lavori("sta").length, pc1 = lavori("pc").length;
await ordina(doc, ["TROPONINA"]);
const ign = await finito(prima, (x) => x.stato === "avviso" && x.fogli && x.fogli.some((f) => f.stato === "sconosciuto"));
check(!!ign && /Infermeria non risponde/.test(stampaDi(ign.pubblico)) && /forse stampat/.test(sottoDi(ign.pubblico)),
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
sezione("la stazione fantasma: il ripetitore ha la presa, la stazione non riceve più niente");
await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));   // (l'avviso di prima, letto)
// un foglio piccolo, mandato dritto al motore della stazione (com'è per bg.js): stesso numero = stesso foglio
const foglioProva = (rq) => sw.evaluate((r) => stazioneStampa("a4", btoa("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF\n"), 1, r), rq);
{
  // «fresco» corto: dopo un paio di secondi di silenzio la sessione è «vecchia», e prima di un foglio va messa alla prova
  await sw.evaluate(() => { STA_ATTESA.fresco = 1500; });
  const rqA = "fantasma-" + Date.now().toString(36);
  const sta0 = lavori("sta").length;
  const a1 = await foglioProva(rqA);
  await finche(() => lavori("sta").length > sta0, 10000);
  check(a1.esito === "stampato" && a1.stazione && lavori("sta").length === sta0 + 1, `la via normale non cambia: un foglio, la stazione lo stampa una volta (got ${a1.esito})`);
  await sospendi(2200);
  const a2 = await foglioProva(rqA);
  await sospendi(1500);
  check(a2.esito === "stampato" && !a2.nonRisponde && lavori("sta").length === sta0 + 1,
    `lo stesso foglio rimandato su una sessione vecchia: com'è andata («${a2.esito}»), niente seconda stampa (${lavori("sta").length - sta0} sulla stazione)`);
  const sta1b = lavori("sta").length;
  await sospendi(2200);
  const a3 = await foglioProva("fantasma-b-" + Date.now().toString(36));
  await finche(() => lavori("sta").length > sta1b, 10000);
  check(a3.esito === "stampato" && lavori("sta").length === sta1b + 1, `un foglio nuovo su una sessione vecchia ma viva: la prova risponde «niente», il foglio parte, una volta (got ${a3.esito})`);

  // ora la stazione resta lì, con la presa, ma non riceve più niente
  await sospendi(2200);
  check(await sw.evaluate(() => !!stm.sessione && stm.presa.pari), "prima del guasto: il PC ha una sessione, e il ripetitore dice che la stazione c'è");
  await staSw.evaluate(() => { globalThis.__daiDati = stz.presa.ascolta.dati; stz.presa.ascolta.dati = () => {}; });
  await suPagina(doc, A.patientUrl);
  prima = await idsOra();
  const staG = lavori("sta").length, pcG = lavori("pc").length;
  const t0 = Date.now();
  await ordina(doc, ["TROPONINA"]);
  const fant = await finito(prima, (x) => x.stato === "stampa" || x.stato === "avviso", 60000);
  const durata = (Date.now() - t0) / 1000;
  check(!!fant && stampaDi(fant.pubblico) === "Infermeria non risponde" && fant.dest === "stazione" && fant.fogli.every((f) => f.stato === "fallito" && f.nonRisponde),
    `«Infermeria non risponde», non «forse»: nessun foglio è partito (got ${JSON.stringify(fant && fant.pubblico)})`);
  check(durata < 25, `detto in secondi, non in minuti: ${durata.toFixed(0)} s dal tocco (prima: più di 120 s)`);
  const sfant = await striscia(doc, /Infermeria non risponde/, 10000);
  check(!/forse/.test(sfant) && (await azione(doc)) === "Stampa qui", `la striscia: «Infermeria non risponde», con «Stampa qui» (got «${sfant}» · ${await azione(doc)})`);
  await sospendi(1500);
  check(lavori("sta").length === staG && lavori("pc").length === pcG && (await stampe(doc)).length === 0, "niente sulla stazione, niente qui da solo");
  // la stazione torna a ricevere: un foglio esce, una volta
  await staSw.evaluate(() => { stz.presa.ascolta.dati = globalThis.__daiDati; });
  await sw.evaluate(() => { STA_ATTESA.fresco = 20e3; return chrome.storage.session.set({ ordini: [] }); });
  const a4 = await foglioProva("fantasma-c-" + Date.now().toString(36));
  await finche(() => lavori("sta").length > staG, 10000);
  check(a4.esito === "stampato" && lavori("sta").length === staG + 1, `la stazione di nuovo in ascolto: un foglio, stampato, una volta (got ${a4.esito})`);
}

// ===========================================================================
sezione("il puntino sull'icona: solo un guaio (foglio non stampato, aiutante muto), e si spegne guardando la stazione");
{
  const puntino = () => staSw.evaluate(async () => ({ t: await chrome.action.getBadgeText({}), c: await chrome.action.getBadgeBackgroundColor({}) }));
  const man = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
  check(man.action && !man.action.default_popup && !man.permissions.includes("notifications"), "la build intera ha l'icona (senza popup: un clic apre la stazione) e nessun permesso in più, niente notifiche");
  await pSta.goto("about:blank");   // (la pagina aperta, guardando, spegnerebbe il puntino: qui si guarda solo l'icona)
  await staSw.evaluate(() => chrome.storage.local.set({ "stazione.visto": Date.now() }));
  await sospendi(300);
  check((await puntino()).t === "", "fogli arrivati e stampati bene: niente sull'icona");
  comportati("sta", { rompi: { "HP Infermeria A4": "carta finita" } });
  const ko = await foglioProva("puntino-a-" + Date.now().toString(36));
  check(ko.esito === "fallito" && !!(await finche(async () => (await puntino()).t === " ", 8000)), `un foglio non stampato: un puntino (uno spazio), non un numero (got «${(await puntino()).t}»)`);
  const col = (await puntino()).c;
  check(col[0] > 150 && col[1] < 80 && col[2] < 80, `…rosso (got ${JSON.stringify(col)})`);
  // poi un foglio stampato bene, prima che qualcuno guardi: il foglio non stampato di prima resta da vedere
  comportati("sta");
  const dopoKo = await foglioProva("puntino-c-" + Date.now().toString(36));
  await sospendi(600);
  check(dopoKo.esito === "stampato" && (await puntino()).t === " ", `un foglio non stampato e poi uno stampato bene, prima di guardare: il puntino resta (got «${(await puntino()).t}»)`);
  await pSta.goto(EXTURL("stazione.html"));
  check(!!(await finche(async () => (await puntino()).t === "", 8000)), "aprire la pagina della stazione lo spegne");
  await pSta.goto("about:blank");
  comportati("sta");
  const bene = await foglioProva("puntino-b-" + Date.now().toString(36));
  await sospendi(600);
  check(bene.esito === "stampato" && (await puntino()).t === "", "un foglio stampato bene dopo: niente");
  // l'aiutante di stampa che non risponde: il puntino; il popup lo spegne
  await staSw.evaluate(async () => { const o = ospite; ospite = async () => ({ ok: false, why: "non risponde" }); try { await stzAiutante(true); } finally { ospite = o; } });
  check(!!(await finche(async () => (await puntino()).t === " ", 8000)), "l'aiutante di stampa non risponde: un puntino");
  const pop = await staCtx.newPage();
  await pop.goto(EXTURL("azione.html"));
  check(!!(await finche(async () => (await puntino()).t === "", 8000)), "aprire il popup lo spegne");
  const html = await pop.content();
  check(!html.includes("●") && /🖨/.test(await pop.locator("#staz").innerText()), "nel popup la voce della stazione ha una stampante, non un ● rosso (che dice «registra»)");
  await pop.close();
  await staSw.evaluate(() => stzAiutante(true));   // l'aiutante c'è di nuovo: la prova lo registra buono
  await sospendi(300);
  check((await puntino()).t === "", "l'aiutante torna: niente");
  await pSta.goto(EXTURL("stazione.html"));
  await pSta.waitForSelector("#qr, #qrsec", { state: "attached", timeout: 10000 });
}

// ===========================================================================
sezione("la stazione spenta: «Infermeria non risponde» e «Stampa qui»");
await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));   // (l'avviso di prima, letto)
await pSta.close();
await staCtx.close();
check(!!(await finche(async () => (await pubblicoPc())?.presente === false, 10000)), "chiuso Chrome sulla stazione: il PC lo sa (non risponde)");
// all'ordine che nasce la stazione si chiede SUBITO (in sola lettura): tace →
// la striscia lo dice mentre l'ordine gira, e «Stampa qui» — un tocco — cambia strada
check(await sw.evaluate(() => stazioneSonda()) === false, "la domanda alla stazione, quando un ordine nasce: spenta, non risponde");
await suPagina(doc, A.patientUrl);
{
  const ora = Date.now();
  await sw.evaluate((x) => ordScrivi(x), [{ id: "pcmuta0001", ep: "999001", paziente: "ROSSI MARIO", n: 1, stato: "corre", ts: ora, agg: ora, worker: null,
    vista: { tag: "Invio", testo: "TROPONINA" }, dest: "stazione", destNome: "Infermeria", stazioneMuta: true, resto: { mancano: ["TROPONINA"], controllare: [], nel: [] } }]);
  const sm = await striscia(doc, /Infermeria non risponde: stampo qui\?/, 10000);
  check(!!sm && (await azione(doc)) === "Stampa qui", `l'ordine gira, la stazione tace: «Infermeria non risponde: stampo qui?», con «Stampa qui» (got «${sm}» · ${await azione(doc)})`);
  await $panel(doc, AZIONE).click();
  const qui = await finche(async () => (await ordini()).find((x) => x.id === "pcmuta0001" && x.dest === "qui" && !x.stazioneMuta), 10000);
  check(!!qui && !/non risponde/.test(qui.pubblico ? JSON.stringify(qui.pubblico) : ""), `un tocco: l'ordine stampa qui, e la domanda se ne va (got ${JSON.stringify(qui && [qui.dest, qui.pubblico])})`);
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
}
{
  // «Stampa qui» su un ordine in «stampa»: i suoi fogli sono già solo quelli che la
  // stazione non ha stampato (ordStampoFine), `fogli` ha ancora l'elenco intero —
  // le etichette uscite, la lista e l'RX no. Escono la lista E l'RX: nessuno perso.
  const ora = Date.now();
  const jobs = [{ name: "Lista esami", printer: "normale", url: `${A.patientUrl}&lista=1` }, { name: "Richiesta radiologia", printer: "normale", url: `${A.patientUrl}&rx=1` }];
  await sw.evaluate((x) => ordScrivi(x), [{ id: "pcqui00001", ep: "999001", paziente: "ROSSI MARIO", n: 1, stato: "stampa", ts: ora, agg: ora, worker: null, vista: null,
    dest: "stazione", destNome: "Infermeria", confermata: ora, resto: { mancano: [], controllare: [], nel: [] },
    stampa: { jobs, tag: "Confermata", fine: { n: 1, ts: ora }, riassunto: "1 esame confermato" },
    fogli: [{ name: "Etichette provette", tipo: "etichette", stato: "stampato", stazione: true, stampante: "Infermeria" },
      { name: "Lista esami", tipo: "a4", stato: "fallito", stazione: true, nonRisponde: true, why: "Infermeria non risponde" },
      { name: "Richiesta radiologia", tipo: "a4", stato: "fallito", stazione: true, nonRisponde: true, why: "Infermeria non risponde" }] }]);
  const dati = await sw.evaluate(async () => {
    const vero = chrome.tabs.sendMessage;
    let presi = null;
    chrome.tabs.sendMessage = (id, m, ...r) => (m && m.t === "psassistStampa" ? ((presi = m.stampa.jobs.map((j) => j.name)), Promise.resolve({ ok: true })) : vero.call(chrome.tabs, id, m, ...r));
    try { return { r: await ordQui("pcqui00001"), presi }; } finally { chrome.tabs.sendMessage = vero; }
  });
  check(!!dati.r?.ok && JSON.stringify(dati.presi) === JSON.stringify(["Lista esami", "Richiesta radiologia"]),
    `«Stampa qui» su un ordine in «stampa»: la lista e l'RX, tutti e due — nessun foglio perso (got ${JSON.stringify(dati)})`);
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
}
prima = await idsOra();
const pc2 = lavori("pc").length, sta2 = lavori("sta").length;
await ordina(doc, ["TROPONINA"]);
const muta = await finito(prima, (x) => x.stato === "stampa");
check(!!muta && stampaDi(muta.pubblico) === "Infermeria non risponde" && muta.dest === "stazione" && muta.fogli.every((f) => f.stato === "fallito" && f.nonRisponde),
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
await tocca('[data-a="ristampa"][data-id="699999"]');
await tocca('[data-a="ristampaQ"][data-id="699999"][data-q="tutto"]');
const risMuta = await finche(async () => (await ristampati(prima)).find((x) => x.stato === "stampa"), 60000);
check(!!risMuta && stampaDi(risMuta.pubblico) === "Infermeria non risponde" && risMuta.dest === "stazione" && risMuta.fogli.every((f) => f.stato === "fallito" && f.nonRisponde),
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
check(!!(await finito(prima, (x) => x.stato === "avviso" && stampaDi(x.pubblico) === "Stampato in Infermeria")), "un ordine: di nuovo «Stampato in Infermeria»");
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
// Chrome prima della 116 (niente chrome.runtime.getContexts): la stazione sa
// che la sua pagina è aperta solo se le ha chiesto lo stato da meno di 10
// minuti. Collegata e ferma (lo stato che mostra non cambia: qui nemmeno il PC
// del medico che va e viene), la pagina lo chiede lo stesso ogni minuto; se
// no, passati i 10 minuti la stazione lascerebbe il ponte con la pagina aperta.
sezione("Chrome senza getContexts (prima della 116): la pagina aperta tiene la stazione sul ponte");
const senza = await staSw.evaluate(() => {
  self.__getContexts = chrome.runtime.getContexts;
  Object.defineProperty(chrome.runtime, "getContexts", { value: undefined, configurable: true, writable: true });
  self.__ascolta = stz.presa.ascolta;
  stz.presa.ascolta = { ...stz.presa.ascolta, pari: () => {}, stato: () => {} };
  self.__t0 = staOra();
  stzUso.pagina = self.__t0 - 5 * 60e3;   // l'ultima richiesta della pagina: 5 minuti fa
  return stzPagina();
});
check(senza === true, "(senza getContexts: aperta, perché ha chiesto lo stato 5 minuti fa)");
check(!!(await finche(() => staSw.evaluate(() => stzUso.pagina >= self.__t0), 70000)),
  "la pagina aperta e ferma lo richiede da sé entro un minuto: per la stazione resta aperta");
await staSw.evaluate(() => {
  stz.presa.ascolta = self.__ascolta;
  Object.defineProperty(chrome.runtime, "getContexts", { value: self.__getContexts, configurable: true, writable: true });
});

// ===========================================================================
// Fuori turno: Chrome aperto sul PC delle infermiere, ma né la pagina della
// stazione né il gestionale. La stazione non tiene la presa (niente
// connessioni tutta la notte); il PC del medico la vede «non presente».
// Riaperta la pagina, la presa c'è di nuovo.
sezione("fuori turno: senza la sua pagina né il gestionale, la stazione non sta sul ponte");
// (i 2 minuti dopo che non serve più, qui accorciati: la presa la chiude il documento fuori schermo, alla sua ora)
await staSw.evaluate(() => { FUORI.dopo = 1500; });
await pSta.close();
const vuota = await staCtx.newPage();
await vuota.goto("about:blank");
check(!!(await finche(async () => (await pubblicoPc())?.presente === false && !(relay.prese().stazione) && !(await staSw.evaluate(() => !!stz.presa.ws)), 10000))
  && !!(await staSw.evaluate(() => chrome.storage.local.get("stazione.qui").then((o) => o["stazione.qui"]))),
  "chiusa la pagina della stazione, nessun gestionale sul suo PC: la presa si chiude da sola, poco dopo (l'abbinamento resta), il PC del medico la vede «non presente»");
await staSw.evaluate(() => { FUORI.dopo = 2 * 60e3; });
const entrateSta = relay.entrate().stazione;
await staSw.evaluate(() => stzAvvia());
await staSw.evaluate(() => stzAvvia());
await sospendi(1500);
check(relay.entrate().stazione === entrateSta && !(await staSw.evaluate(() => chrome.alarms.get("stazione"))), "e i risvegli non la riaprono (e non c'è più la sveglia di ogni minuto)");
pSta = await staCtx.newPage();
await pSta.goto(EXTURL("stazione.html"));
check(!!(await finche(async () => (await pubblicoPc())?.presente === true, 20000)) && relay.prese().stazione === 1, "riaperta la sua pagina: di nuovo sul ponte, una presa");
await vuota.close();

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
// (senza la sua pagina né il gestionale la stazione non sta sul ponte: lo saprà quando c'è)
await sospendi(3000);
check(!!(await quiSta()) && !!(await coppiaPc())?.revoca, "riaccesa senza la sua pagina né il gestionale: non sta sul ponte, e non lo sa ancora (il PC tiene la chiave solo per dirglielo)");
pSta = await staCtx.newPage();
await pSta.goto(EXTURL("stazione.html"));
check(!!(await finche(async () => !(await quiSta()) && !(await coppiaPc()), 30000)), "aperta la sua pagina: la stazione sa di essere scollegata; il PC ha dimenticato tutto");

await staCtx.close();
await telBrowser.close();
await ctx.close();
await relay.chiudi();
for (const chi of ["pc", "sta"]) { rmSync(PROFILO[chi], { recursive: true, force: true }); rmSync(FINTO[chi], { recursive: true, force: true }); }
rmSync(VID, { force: true });
console.log(fail ? `\nSTAZIONE: ${fail} CHECK FALLITI\n` : "\nSTAZIONE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
