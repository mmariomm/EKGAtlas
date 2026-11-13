#!/usr/bin/env node
/*
 * La build «PS Assist · Stampa Infermeria» (dalla 3.88; fino alla 3.87 la mini
 * «Lettura e stampa»), tutto vero: il PC del medico (la build normale, il
 * gestionale simulato), la stazione dell'infermeria (la build Infermeria, come
 * nello zip), ognuno col suo finto aiutante di stampa; il ripetitore Node e
 * l'app del telefono in un terzo browser. Le prove:
 *  - una mini 3.87 (il suo manifest e la sua bandiera) collegata come stazione,
 *    con le stampanti scelte e un iPhone associato, si aggiorna nella build
 *    Infermeria (la stessa cartella, lo stesso id): il collegamento e le
 *    stampanti restano, l'iPhone associato a quel PC no;
 *  - il manifest: niente content script, niente permessi sugli indirizzi, la
 *    pagina della stazione dall'icona e dalle Opzioni; niente pagine del telefono;
 *  - SENZA nessuna pagina aperta sulla stazione: è sul ponte, e un foglio dal PC
 *    del medico (etichette, «etichetta», A4) esce sulla stampante giusta;
 *  - un'ora di battiti simulata: la presa resta quella, nessuna riconnessione;
 *  - installata da zero: la pagina si apre da sola, e mostra solo il QR, le
 *    stampanti (con la prova) e lo stato.
 *   node test/ext-mini.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./gestionale-vero.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { preparaLettura, LETTURA_KEY, LETTURA_VIA } from "../tools/lettura.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import { existsSync, statSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, chmodSync } from "node:fs";

const RETE_CHIUSA = ["--proxy-server=direct://", "--host-resolver-rules=MAP * 127.0.0.1"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const T = (n) => join("/tmp", `psa-inf-${n}-${process.pid}`);
const PROF = { pc: T("pc"), sta: T("sta"), nuova: T("nuova") };
const FINTO = { pc: T("pc-ospite"), sta: T("sta-ospite") };
const MINI = T("ext");          // la cartella della stazione: prima la mini 3.87, poi la build Infermeria
const MINI2 = T("ext2");        // un'installazione da zero
const ID = "jhhlgabilanhhnncahahclcjbefaofij", ID_INF = "afheakecoidbgjomgfnjmnkblgfhehbl";
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) if (existsSync(p) && statSync(p).isFile()) return p;
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\ninfermeria: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function finche(fn, timeout = 20000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) { const v = await fn(); if (v) return v; }
  return null;
}

// ---- le due copie: la mini 3.87 (com'era tools/lettura.mjs fino alla 3.87) e la build Infermeria ----
function mini387(dir) {
  rmSync(dir, { recursive: true, force: true });
  cpSync(EXT, dir, { recursive: true });
  rmSync(join(dir, "installata.json"), { force: true });
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  Object.assign(m, { name: "PS Assist · Lettura e stampa", short_name: "PS Assist Lettura", key: LETTURA_KEY,
    options_ui: { page: "ponte.html", open_in_tab: true }, action: { default_popup: "azione.html", default_title: "PS Assist · Lettura e stampa" } });
  m.content_scripts = m.content_scripts.filter((cs) => !(cs.js || []).includes("ricetta-siss.js"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  writeFileSync(join(dir, "sola-lettura.js"), "self.PSA_SOLA_LETTURA = true;\n");
}
// (`dopo`: una versione più nuova, come in un aggiornamento vero — con la stessa, Chrome terrebbe gli script del
// service worker di prima)
function infermeria(dir, dopo = false) {
  rmSync(dir, { recursive: true, force: true });
  cpSync(EXT, dir, { recursive: true });
  preparaLettura(dir, fs, join);
  if (dopo) {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    m.version = m.version.replace(/\d+$/, (x) => String(Number(x) + 1));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  }
}

// ---- i finti aiutanti di stampa ----
const STAMPANTI = { pc: ["Zebra Medico", "HP Medico A4"], sta: ["Zebra Infermeria", "HP Infermeria A4"] };
const lavori = (chi) => (existsSync(join(FINTO[chi], "lavori.jsonl")) ? readFileSync(join(FINTO[chi], "lavori.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((x) => x.tipo);
for (const chi of ["pc", "sta"]) {
  mkdirSync(FINTO[chi], { recursive: true });
  const l = join(FINTO[chi], "ospite.sh");
  writeFileSync(l, `#!/bin/sh\nPSA_FINTO='${FINTO[chi]}' exec '${process.execPath}' '${join(root, "test/ospite-finto.mjs")}' "$@"\n`);
  chmodSync(l, 0o755);
  writeFileSync(join(FINTO[chi], "config.json"), JSON.stringify({ stampanti: STAMPANTI[chi], predefinita: STAMPANTI[chi][1] }));
}
for (const [p, chi] of [[PROF.pc, "pc"], [PROF.sta, "sta"], [PROF.nuova, "sta"]]) {
  rmSync(p, { recursive: true, force: true });
  mkdirSync(join(p, "NativeMessagingHosts"), { recursive: true });
  // (la Modalità sviluppatore accesa, come sul PC: senza, chrome.runtime.reload() scarica l'estensione e basta)
  mkdirSync(join(p, "Default"), { recursive: true });
  writeFileSync(join(p, "Default", "Preferences"), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
  writeFileSync(join(p, "NativeMessagingHosts", "it.psassist.stampa.json"), JSON.stringify({ name: "it.psassist.stampa", description: "finto",
    path: join(FINTO[chi], "ospite.sh"), type: "stdio", allowed_origins: [`chrome-extension://${ID}/`, `chrome-extension://${ID_INF}/`] }));
}
const lancia = (profilo, ext) => chromium.launchPersistentContext(profilo, {
  headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(), viewport: { width: 1200, height: 820 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean), ...RETE_CHIUSA],
});
const swDi = async (c) => c.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || c.waitForEvent("serviceworker", { timeout: 15000 });
const relay = await avviaRelay({});
const versoRelay = (w) => w.evaluate((u) => chrome.storage.local.set({ "ponte.host": u }).then(() => Promise.all([ponteAvvia(), stmAvvia(), stzAvvia()])), relay.url);

// ---- il PC del medico, col gestionale ----
const A = createMock({ seedConfirmed: true });
const ctx = await lancia(PROF.pc, EXT);
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  let out = A.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = A.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* chiusa */ }
});
const sw = await swDi(ctx);
await versoRelay(sw);
const doc = await ctx.newPage();
await doc.goto(A.patientUrl);
await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });

// ===========================================================================
sezione("la mini 3.87: collegata come stazione, con le stampanti, e un iPhone associato");
mini387(MINI);
let staCtx = await lancia(PROF.sta, MINI);
let staSw = await swDi(staCtx);
check(new URL(staSw.url()).host === ID_INF, `la mini ha il suo id (${new URL(staSw.url()).host})`);
await versoRelay(staSw);
// l'iPhone associato alla mini (il ruolo `pc` di sola lettura: dopo l'aggiornamento non c'è più)
const pm = await staCtx.newPage();
await pm.goto(`chrome-extension://${ID_INF}/ponte.html`);
await pm.waitForSelector("#associa", { timeout: 8000 });
await pm.locator("#associa").click();
check(!!(await finche(() => staSw.evaluate(() => chrome.storage.local.get("ponte.coppia").then((o) => !!o["ponte.coppia"])), 8000)), "la mini ha un iPhone associato (il QR del ponte)");
await pm.close();
// il telefono, associato al PC del medico
const pp = await ctx.newPage();
await pp.goto(`chrome-extension://${ID}/ponte.html`);
await pp.locator("#associa").click();
await pp.waitForSelector("#qr svg", { timeout: 8000 });
const qrTel = await sw.evaluate(() => ponteQr());
await pp.close();
const telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(), args: [...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean), ...RETE_CHIUSA] });
const telCtx = await telBrowser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT" });
const tel = await telCtx.newPage();
const testoTel = () => tel.locator("#app").innerText().catch(() => "");
const aspettaTel = async (re, t = 30000) => ((await finche(async () => re.test(await testoTel()), t)) ? testoTel() : "");
await tel.goto(qrTel);
check(/ROSSI MARIO/.test(await aspettaTel(/ROSSI MARIO/)), "il telefono associato al PC del medico");
// la pagina della stazione (mini 3.87): il QR; il telefono lo apre e «Collega»
let pSta = await staCtx.newPage();
await pSta.goto(`chrome-extension://${ID_INF}/stazione.html`);
await pSta.waitForSelector("#qr svg", { timeout: 10000 });
const statoSta = () => staSw.evaluate(() => chrome.storage.session.get("stazione.stato").then((o) => o["stazione.stato"] || null));
const offerta = (await statoSta()).offerta;
await tel.evaluate((u) => { location.hash = new URL(u).hash; }, offerta.qr);
await aspettaTel(/Collegala al PC/, 10000);
await tel.locator('[data-a="stacollega"]').first().click();
check(/Collegata al PC/.test(await aspettaTel(/Collegata al PC/, 40000)), "«Collega» dal telefono: la stazione collegata al PC del medico");
const quiSta = () => staSw.evaluate(() => chrome.storage.local.get("stazione.qui").then((o) => o["stazione.qui"] || null));
const qPrima = await finche(async () => { const q = await quiSta(); return q && q.conferma ? q : null; }, 15000);
check(!!qPrima, "sulla mini: collegata e confermata");
await pSta.waitForFunction(() => !document.getElementById("setic").disabled, null, { timeout: 15000 });
await pSta.locator("#setic").selectOption("Zebra Infermeria");
await finche(async () => (await staSw.evaluate(() => chrome.storage.local.get("stampa"))).stampa?.etichette === "Zebra Infermeria", 5000);
const scelte = (await staSw.evaluate(() => chrome.storage.local.get("stampa"))).stampa;
check(scelte.etichette === "Zebra Infermeria" && scelte.a4 === "HP Infermeria A4", `le stampanti scelte sulla mini (${JSON.stringify(scelte)})`);
await pSta.close();

// ===========================================================================
// (come l'aggiornamento vero: l'aiutante scambia la cartella, poi l'estensione si ricarica — chrome.runtime.reload)
sezione("l'aggiornamento: la stessa cartella diventa la build Infermeria, e si ricarica");
infermeria(MINI, true);
const man = JSON.parse(readFileSync(join(MINI, "manifest.json"), "utf8"));
check(man.name === "PS Assist · Stampa Infermeria" && man.key === LETTURA_KEY, `il nome e la stessa chiave della mini (stesso id): «${man.name}»`);
check(!man.content_scripts && !man.host_permissions && !man.optional_host_permissions && !man.web_accessible_resources, "niente content script, niente permessi sugli indirizzi, niente risorse per le pagine");
check(man.options_ui.page === "stazione.html" && man.action && !man.action.default_popup && !(man.permissions || []).includes("background"),
  "la sua pagina è la stazione (Opzioni e icona, senza popup); nessun permesso «background»");
check(LETTURA_VIA.every((f) => !existsSync(join(MINI, f))) && /PSA_SOLO_STAZIONE = true/.test(readFileSync(join(MINI, "sola-lettura.js"), "utf8")), "niente pagine del telefono (ponte.html, azione.html); la bandiera «solo stazione»");
const swNuovo = staCtx.waitForEvent("serviceworker", { timeout: 20000 });
await staSw.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 50); }).catch(() => {});
staSw = await swNuovo;
check(new URL(staSw.url()).host === ID_INF && await staSw.evaluate(() => self.PSA_SOLO_STAZIONE === true && chrome.runtime.getManifest().name), "lo stesso id dopo l'aggiornamento, con la build nuova");
await staSw.evaluate(() => staCaricato);
const qDopo = await quiSta();
const chiave = await staSw.evaluate(() => cassaLeggi("stazione.qui").then((x) => !!(x && x.k)));
check(!!qDopo && qDopo.id === qPrima.id && qDopo.conferma && chiave, "il collegamento della stazione resta (la stessa coppia, la chiave nella cassa)");
const scelteDopo = (await staSw.evaluate(() => chrome.storage.local.get("stampa"))).stampa;
check(JSON.stringify(scelteDopo) === JSON.stringify(scelte), "le stampanti scelte restano");
check(!!(await finche(() => staSw.evaluate(() => chrome.storage.local.get("ponte.coppia").then((o) => !o["ponte.coppia"])), 8000)), "l'iPhone associato a questo PC quando era la mini: via (il ruolo `pc` non c'è più)");
// il registro dei PC (⋯ → Dispositivi sul telefono): la build Infermeria si annuncia come «stazione», senza ponte.html
const idReg = await staSw.evaluate(() => chrome.storage.local.get("registro.id").then((o) => o["registro.id"] || ""));
const rigaSta = await finche(async () => { await staSw.evaluate(() => annForse({ evento: true })); const r = relay.elencoPc()[idReg]; return r && r.kind === "stazione" && !r.tel && r.stz ? r : null; }, 20000);
check(!!rigaSta && rigaSta.stz.tag && /^\d+\.\d+/.test(rigaSta.ver || ""), `la stazione si annuncia al registro come «stazione», collegata (stz.tag), senza telefono (${JSON.stringify(rigaSta)})`);

// ===========================================================================
sezione("nessuna pagina aperta sulla stazione: è sul ponte, e stampa");
const pagine = await staSw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["TAB"] }).then((l) => l.length));
check(pagine === 0, `nessuna scheda dell'estensione aperta sulla stazione (${pagine})`);
check(!!(await finche(async () => (await statoSta())?.qui?.su, 20000)), "la stazione è in linea da sola (la presa nel documento fuori schermo)");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF\n").toString("base64");
const fogli = [["etichette", "Zebra Infermeria"], ["etichetta", "Zebra Infermeria"], ["a4", "HP Infermeria A4"]];
for (const [tipo, attesa] of fogli) {
  const prima = lavori("sta").length;
  const r = await sw.evaluate(([t, p, rq]) => stazioneStampa(t, p, 1, rq), [tipo, PDF, `rq-inf-${tipo}-0001`]);
  const l = lavori("sta");
  check(r && r.ok && r.esito === "stampato" && l.length === prima + 1 && l.at(-1).stampante === attesa,
    `un foglio «${tipo}» dal PC del medico: stampato sulla stazione, su ${attesa} (got ${JSON.stringify(r && { ok: r.ok, esito: r.esito, why: r.why })} → ${l.at(-1)?.stampante})`);
}
check(lavori("pc").length === 0, "e niente sulle stampanti del PC del medico");

// ===========================================================================
sezione("un'ora di battiti, a gestionale e pagina chiusi: una presa sola");
const entrate0 = relay.entrate().stazione;
const docPresa = () => staSw.evaluate(() => fuoriPing().then((r) => r && r.prese && r.prese.stazione));
const p0 = await docPresa();
await staSw.evaluate(async () => { FUORI.prova = true; await fuoriRegola({ battito: 200, pong: 150 }); FUORI.prova = false; });
// 120 battiti (un'ora a uno ogni 30 secondi), e intanto i risvegli del service worker e i cambi di schede
for (let i = 0; i < 12; i++) {
  await sospendi(2000);
  await staSw.evaluate(() => Promise.all([stzAvvia(), stzAvvia(false)]).then(() => staCambio()));
}
const p1 = await docPresa();
await staSw.evaluate(async () => { FUORI.prova = true; await fuoriRegola({ battito: 30e3, pong: 15e3 }); FUORI.prova = false; });
const entrate1 = relay.entrate().stazione;
check(!!p0 && !!p1 && p1.su && p1.entrate === p0.entrate && entrate1 === entrate0,
  `120 battiti (risposta entro 150 ms) e 24 risvegli: la presa è sempre quella — riconnessioni ${entrate1 - entrate0} al ripetitore, aperture nel documento ${p1 && p0 ? p1.entrate - p0.entrate : "?"}`);
await staCtx.close();

// ===========================================================================
sezione("installata da zero: la pagina si apre da sola, e mostra solo il QR, le stampanti e lo stato");
infermeria(MINI2);
const nuovaCtx = await lancia(PROF.nuova, MINI2);
const nuovaSw = await swDi(nuovaCtx);
await versoRelay(nuovaSw);
const pagina = await finche(() => nuovaCtx.pages().find((p) => p.url().endsWith("/stazione.html")), 15000);
check(!!pagina, "alla prima installazione si apre da sola la pagina della stazione");
if (pagina) {
  await pagina.reload();   // (con il ponte di prova)
  await pagina.waitForSelector("#qr svg", { timeout: 10000 });
  await pagina.waitForFunction(() => !document.getElementById("setic").disabled, null, { timeout: 15000 });
  const vis = await pagina.evaluate(() => {
    const si = (el) => !!el && el.offsetParent !== null;
    return { titolo: document.title, qr: si(document.getElementById("qr")), etic: si(document.getElementById("setic")), a4: si(document.getElementById("sa4")),
      prove: [...document.querySelectorAll("[data-prova]")].filter(si).length, stato: si(document.getElementById("stato")),
      nome: si(document.getElementById("nome")), lavori: si(document.getElementById("lavori")), h2: [...document.querySelectorAll("h2")].filter(si).map((h) => h.textContent) };
  });
  check(vis.titolo === "PS Assist · Stampa Infermeria" && vis.qr && vis.etic && vis.a4 && vis.prove === 2 && vis.stato && !vis.nome && !vis.lavori && JSON.stringify(vis.h2) === '["Stampanti"]',
    `solo il QR, lo stato e le due stampanti con la prova: niente nome, niente elenco (${JSON.stringify(vis)})`);
  check(/puoi chiuderla/.test(await pagina.locator("#piede").innerText()) && /Non collegata/.test(await pagina.locator("#stato").innerText()), "«Non collegata», e la pagina si può chiudere");
}
await nuovaCtx.close();

await telCtx.close().catch(() => {});
await telBrowser.close().catch(() => {});
await ctx.close().catch(() => {});
await relay.chiudi?.().catch?.(() => {}) ?? relay.close?.();
for (const p of [...Object.values(PROF), ...Object.values(FINTO), MINI, MINI2]) rmSync(p, { recursive: true, force: true });
console.log(fail ? `\nINFERMERIA: ${fail} CHECK FALLITI\n` : "\nINFERMERIA: TUTTO OK\n");
process.exit(fail ? 1 : 0);
