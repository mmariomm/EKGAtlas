#!/usr/bin/env node
/*
 * Le prese nel documento fuori schermo (fuori.html, fuori-sw.js): tutto vero —
 * l'estensione in Chromium col gestionale simulato, il ripetitore Node (che
 * conta ogni presa che entra) e un telefono finto in Node (la stessa
 * crittografia dell'app, PonteCripto). Il service worker lo si ferma dal
 * protocollo di debug, come fa Chrome 109 mezzo minuto dopo ogni risveglio.
 *   - il costo da fermo: un PC associato col gestionale aperto, per un'ora
 *     simulata (il service worker fermato ogni volta, e svegliato come lo
 *     sveglierebbe la pagina ogni 30 secondi): al più 2 prese — e il «prima»,
 *     con la 3.86 (PSA_EXT=<la sua cartella>, FUORI_SOLO_COSTO=1);
 *   - senza schede del gestionale: la presa si chiude dopo 2 minuti, e poi
 *     nessuna presa nuova, per quanti risvegli ci siano;
 *   - una sessione del telefono sopravvive al service worker fermato: niente
 *     saluto nuovo, nessuna risposta persa, e una scrittura rimandata non si rifà;
 *   - lo zip del registratore con la sessione aperta: si salva, e il documento
 *     (con la presa) resta;
 *   - il ripiego (senza documento fuori schermo): la presa nel service worker,
 *     come la 3.86, con la sveglia della pagina.
 *   node test/ext-fuori.mjs
 */
import { chromium } from "playwright";
import WebSocket from "ws";
import { createMock } from "./gestionale-vero.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, rmSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "../public/ponte/cripto.js"));
const P = globalThis.PonteCripto;
const EXT = process.env.PSA_EXT || join(root, "extension");
const SOLO_COSTO = process.env.FUORI_SOLO_COSTO === "1";
const CICLI = Number(process.env.FUORI_CICLI || 120);   // un'ora: un risveglio ogni 30 secondi
const VERI = Number(process.env.FUORI_VERI ?? 3);       // e qualche fermata in tempo vero, 30 secondi l'una
const PROFILE = join("/tmp", "psa-fuori-" + process.pid);
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\nfuori: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function finche(fn, timeout = 20000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(100)) { const v = await fn(); if (v) return v; }
  return null;
}

// ---- il ripetitore (conta le prese), il gestionale ------------------------
const relay = await avviaRelay({});
const A = createMock({});
const EP = String(A.state.episodeId);
rmSync(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
    // (mai verso il ripetitore vero, nemmeno per sbaglio: il suo nome non si risolve)
    "--host-resolver-rules=MAP *.workers.dev ~NOTFOUND",
    ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
});
let login = false;   // il gestionale risponde con la pagina d'accesso (sessione scaduta)
const LOGIN = `<html><head><title>Accesso</title></head><body><form name="Login" method="post" action="login.do"><input name="username"><input type="password" name="password"><input type="submit" value="Accedi"></form></body></html>`;
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  if (login && /menuPsoEpisodio\.do/.test(req.url())) { await r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: LOGIN }); return; }
  let out = A.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = A.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa */ }
});
const swDi = async () => ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || ctx.waitForEvent("serviceworker", { timeout: 15000 });
let sw = await swDi();
const extId = new URL(sw.url()).host;
const EXTURL = (f) => `chrome-extension://${extId}/${f}`;
const NUOVA = await sw.evaluate(() => typeof FUORI === "object");
console.log(`(estensione: ${EXT} — ${NUOVA ? "con il documento fuori schermo" : "senza (la 3.86)"})`);
const statoPonte = () => sw.evaluate(() => chrome.storage.session.get("ponte").then((o) => o.ponte || null));
const fuoriAperti = () => sw.evaluate(() => (chrome.runtime.getContexts ? chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).then((c) => c.map((x) => x.documentUrl)) : []));

// ---- fermare il service worker, come Chrome 109 ---------------------------
// (da una pagina dell'estensione che non gli parla: il portale; la stessa, poi, lo sveglia come una pagina del gestionale)
const pag = await ctx.newPage();
await pag.goto(EXTURL("portale.html"));
const cdp = await ctx.newCDPSession(pag);
const versioni = new Map();
let fermate = 0;   // quante volte lo si è visto fermo (dopo che correva)
cdp.on("ServiceWorker.workerVersionUpdated", (e) => {
  for (const v of e.versions) {
    if (!v.scriptURL.endsWith("bg.js")) continue;
    if (versioni.get(v.versionId) !== "stopped" && v.runningStatus === "stopped") fermate++;
    versioni.set(v.versionId, v.runningStatus);
  }
});
await cdp.send("ServiceWorker.enable");
const corre = () => [...versioni.values()].includes("running");
async function ferma() {
  await finche(async () => corre(), 10000);
  const id = [...versioni].find(([, s]) => s === "running")?.[0];
  const f0 = fermate;
  const err = await cdp.send("ServiceWorker.stopWorker", { versionId: id }).then(() => "", (e) => e.message);
  const ok = !!(await finche(async () => fermate > f0, 10000));
  if (!ok) console.log(`  (non si ferma: ${err || "nessun errore"} · ${JSON.stringify([...versioni])})`);
  return ok;
}
// la sveglia che la pagina del gestionale dava ogni 30 secondi fino alla 3.86 (ponteSveglia): un risveglio
const sveglia = () => pag.evaluate(() => chrome.runtime.sendMessage({ t: "ponteSveglia" }).catch(() => null));
async function riprendiSw() { await finche(async () => corre(), 10000); sw = await swDi(); }

// ---- un PC associato (la chiave scritta come la scrive l'associazione) ----
const K = P.casuale(32), DEV = "telefonofinto0001";
const CH = await P.chiaviCoppia(K);
await sw.evaluate(({ host, k, dev }) => chrome.storage.local.set({ "ponte.host": host, "ponte.coppia": { k, creata: Date.now() - 3600e3, usata: true, dev, nTel: "" } }), { host: relay.url, k: P.b64u(K), dev: DEV });
await sw.evaluate(() => ponteAvvia());
const doc = await ctx.newPage();
await doc.goto(A.patientUrl);
await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });

// ===========================================================================
sezione(`il costo da fermo: il gestionale aperto, un'ora (${CICLI} risvegli), il service worker fermato ogni volta`);
check(!!(await finche(async () => relay.prese().pc === 1, 20000)), "il PC associato col gestionale aperto: sul ponte, una presa");
if (NUOVA) {
  check((await sw.evaluate(() => FUORI.ripiego)) === false && (await fuoriAperti()).some((u) => u.endsWith("/fuori.html")),
    `la presa nel documento fuori schermo (fuori.html), non nel service worker (${JSON.stringify(await fuoriAperti())})`);
}
{
  // prima, in tempo vero: la pagina fa da sé quello che fa (fino alla 3.86, «ponteSveglia» ogni 30 secondi)
  const e0 = relay.entrate().pc, t0 = Date.now();
  for (let i = 0; i < VERI; i++) {
    check(await ferma(), `(fermato il service worker, ${i + 1})`);
    await sospendi(32000);
  }
  const vere = relay.entrate().pc - e0;
  console.log(`  · in tempo vero, ${Math.round((Date.now() - t0) / 1000)} s, ${VERI} fermate: ${vere} prese nuove`);
  // poi l'ora, compressa: ogni giro una fermata e il risveglio che la pagina avrebbe dato dopo 30 secondi
  const e1 = relay.entrate().pc;
  for (let i = 0; i < CICLI; i++) {
    await ferma();
    await sveglia();
    await riprendiSw();
    await sospendi(250);
  }
  await sospendi(3000);
  const ora = relay.entrate().pc - e1;
  console.log(`  · un'ora simulata (${CICLI} risvegli): ${ora} prese nuove`);
  if (NUOVA) {
    check(vere + ora <= 2, `in tutto al più 2 prese nuove (${vere} in tempo vero, ${ora} nell'ora simulata; la 3.86 ne apre una a ogni risveglio)`);
    check(relay.prese().pc === 1, "e il PC è sempre sul ponte, con una presa sola");
  } else {
    console.log(`  · PRIMA (questa estensione): ${vere + ora} prese in ${CICLI + VERI} risvegli`);
  }
}
if (SOLO_COSTO || !NUOVA) {
  await ctx.close(); await relay.chiudi(); rmSync(PROFILE, { recursive: true, force: true });
  console.log(fail ? `\nFUORI: ${fail} CHECK FALLITI\n` : "\nFUORI (solo il costo): fatto\n");
  process.exit(fail ? 1 : 0);
}

// ===========================================================================
// Il telefono finto: la stessa crittografia dell'app, una presa sua verso il ripetitore.
function telefono() {
  const t = { ws: null, pari: false, canale: null, n: null, attese: new Map(), id: 0, salutiPc: 0, riparti: 0, eventi: [] };
  t.apri = () => new Promise((ok) => {
    const ws = new WebSocket(`${relay.url.replace(/^http/, "ws")}/ponte/ws?r=${CH.stanza}&ruolo=tel`);
    ws.binaryType = "arraybuffer";
    t.ws = ws;
    ws.on("open", () => ok());
    ws.on("message", async (d, bin) => {
      if (!bin) { try { const m = JSON.parse(d.toString()); if (typeof m.pari === "boolean") t.pari = m.pari; } catch { /* pong */ } return; }
      const b = new Uint8Array(d);
      const h = P.leggiTestata(b);
      if (h && h.tipo === P.TIPO.SALUTO_PC) {
        t.salutiPc++;
        let m;
        try { m = (await P.apri(CH.salutoPc, b, P.TIPO.SALUTO_PC)).dati; } catch { return; }
        if (m.riparti) { t.riparti++; return; }
        if (t.n && m.eco === t.n.testo && m.n) { t.canale = P.canaleTel(await P.chiaviSessione(K, t.n.byte, P.daB64u(m.n))); t.n.ok(); }
        return;
      }
      if (h && h.tipo === P.TIPO.DATI_PC && t.canale) {
        let x;
        try { x = await t.canale.decifra(b); } catch { return; }
        if (x.re != null && t.attese.has(x.re)) { t.attese.get(x.re)(x); t.attese.delete(x.re); }
        else t.eventi.push(x);
      }
    });
    t.batti = setInterval(() => { try { ws.send("ping"); } catch { /* chiusa */ } }, 20e3);
  });
  t.saluta = async () => {
    const byte = P.casuale(16);
    const fatto = new Promise((ok) => { t.n = { byte, testo: P.b64u(byte), ok }; });
    t.ws.send(await P.sigilla(CH.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: P.b64u(byte), dev: DEV }));
    return Promise.race([fatto.then(() => true), sospendi(8000).then(() => false)]);
  };
  // un comando, e la sua risposta (null: niente in `ms`). `id`: lo stesso numero (una domanda rimandata)
  t.chiedi = async (cmd, args = {}, ms = 15000, id = ++t.id) => {
    const r = new Promise((ok) => t.attese.set(id, ok));
    t.ws.send(await t.canale.cifra({ id, cmd, ...args }));
    return Promise.race([r, sospendi(ms).then(() => null)]);
  };
  t.chiudi = () => { clearInterval(t.batti); try { t.ws.close(1000); } catch { /* già */ } };
  return t;
}

// ===========================================================================
sezione("una sessione del telefono sopravvive al service worker fermato");
const tel = telefono();
await tel.apri();
await finche(async () => tel.pari, 10000);
check(await tel.saluta(), "il telefono saluta il PC: una sessione");
const ciao = await tel.chiedi("ciao");
check(!!ciao && ciao.ok, `«ciao»: il PC risponde (${ciao && ciao.dati && ciao.dati.kind})`);
const paz0 = await tel.chiedi("pazienti", {}, 20000);
check(!!paz0 && paz0.ok, `«pazienti»: l'elenco (${paz0 && paz0.ok ? "letto" : JSON.stringify(paz0)})`);
const dal0 = (await statoPonte())?.sessione?.dal;
const ePc = relay.entrate().pc, eTel = relay.entrate().tel, saluti0 = tel.salutiPc;
check(await ferma(), "fermato il service worker");
await sospendi(1500);
check(relay.prese().pc === 1 && relay.entrate().pc === ePc, "la presa del PC non cade: sta nel documento fuori schermo");
const paz1 = await tel.chiedi("pazienti", {}, 20000);
await riprendiSw();
check(!!paz1 && paz1.ok, `il telefono chiede ancora, sulla stessa sessione: il messaggio sveglia il service worker, e la risposta arriva (${paz1 ? (paz1.ok ? "ok" : paz1.errore) : "niente"})`);
check(tel.salutiPc === saluti0 && tel.riparti === 0 && relay.entrate().tel === eTel && relay.entrate().pc === ePc,
  `niente saluto nuovo, nessun «riparti», nessuna presa nuova (saluti +${tel.salutiPc - saluti0}, riparti ${tel.riparti}, prese tel +${relay.entrate().tel - eTel}, pc +${relay.entrate().pc - ePc})`);
check((await statoPonte())?.sessione?.dal === dal0, "per il PC è la stessa sessione (dal stesso inizio): nessuna associazione rifatta");
// una scrittura, la sua risposta persa (il service worker fermato subito dopo), rimandata: non si rifà
{
  const rq = "rqfuori" + Date.now().toString(36), testo = "controllo fuori " + Date.now().toString(36);
  const quante = () => doc.evaluate((t) => Object.values(JSON.parse(localStorage.getItem("psassist:dafare.v1") || "{}")).flat().filter((x) => x && x.testo === t).length, testo);
  const r1 = await tel.chiedi("dfAggiungi", { ep: EP, testo, rq }, 20000);
  check(!!r1 && r1.ok && await quante() === 1, `una nota dal telefono (rq): fatta, una (${r1 ? (r1.ok ? "ok" : r1.errore) : "niente"})`);
  check(await ferma(), "fermato il service worker (la risposta, per il telefono, si è persa)");
  const r2 = await tel.chiedi("dfAggiungi", { ep: EP, testo, rq }, 20000);
  await riprendiSw();
  await sospendi(500);
  // (la risposta tenuta in storage.session torna con le chiavi in ordine: si confronta il contenuto)
  const ordinato = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
  check(!!r2 && r2.ok && ordinato(r2.dati) === ordinato(r1.dati) && await quante() === 1,
    `rimandata con lo stesso numero dopo il riavvio: la stessa risposta, e la nota non si rifà (${await quante()} nel gestionale; risposta ${JSON.stringify(r1).length} byte, poi ${JSON.stringify(r2).slice(0, 120)})`);
}
// passati i 3 minuti senza comandi mentre il service worker dormiva: al risveglio la sessione si chiude, e il telefono lo sa
{
  await sw.evaluate(() => { const s = pt.sessione; s.ultimo -= PONTE_INATTIVO + 1000; return ponteSessioneSalva(); });
  const ev0 = tel.eventi.length;
  check(await ferma(), "fermato il service worker, con la sessione ferma da più di 3 minuti");
  await sveglia();
  await riprendiSw();
  check(!!(await finche(async () => tel.eventi.slice(ev0).some((x) => x.evento === "fine" && x.perche === "inattivo"), 10000)) && !(await statoPonte())?.sessione,
    "al risveglio la sessione si chiude («3 minuti senza comandi»), e il telefono lo sa");
  check(await tel.saluta(), "il telefono ne apre un'altra");
  const c2 = await tel.chiedi("ciao");
  check(!!c2 && c2.ok, "…e il PC risponde");
}

// ===========================================================================
sezione("lo zip del registratore, con la sessione aperta: si salva, la presa resta");
{
  const ePc0 = relay.entrate().pc;
  await sw.evaluate(() => regAvvia());
  await doc.reload();
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await sospendi(1500);
  const n0 = (await sw.evaluate(() => regElenco())).length;
  const r = await sw.evaluate(() => regFermaESalva("fermata a mano"));
  check(!!r && r.ok, `«Ferma e salva»: lo zip è salvato (${r && (r.ok ? r.zip && r.zip.nome : r.why)})`);
  check((await sw.evaluate(() => regElenco())).length === n0 + 1, "e c'è nell'elenco delle registrazioni");
  await sospendi(2500);
  check((await fuoriAperti()).some((u) => u.endsWith("/fuori.html")), "il registratore non chiude il documento: sotto c'è la presa del ponte");
  const c3 = await tel.chiedi("ciao");
  check(!!c3 && c3.ok && relay.entrate().pc === ePc0 && relay.prese().pc === 1, "la sessione col telefono risponde ancora, sulla stessa presa (nessuna presa nuova)");
}

// ===========================================================================
sezione("senza schede del gestionale: la presa si chiude dopo 2 minuti, e poi nessuna presa nuova");
{
  tel.chiudi();
  // (FUORI_DOPO: un «dopo» più corto, per provare in fretta; di norma i 2 minuti veri)
  const DOPO = Number(process.env.FUORI_DOPO || 120e3);
  if (process.env.FUORI_DOPO) await sw.evaluate((ms) => { FUORI.dopo = ms; }, DOPO);
  await doc.close();
  // (e le schede del gestionale che l'estensione apre da sé, dietro: lo storico del portale, che si chiude da solo — qui subito)
  for (const p of ctx.pages()) if (/^https:\/\/smarthealth\./.test(p.url())) await p.close().catch(() => {});
  const chiusa = Date.now();
  check(relay.prese().pc === 1, "chiusa l'ultima scheda del gestionale: la presa resta, per ora");
  await sospendi(1500);
  check(await ferma(), "(e il service worker si ferma)");
  const giu = await finche(async () => relay.prese().pc === 0, DOPO + 50e3);
  const dopo = (Date.now() - chiusa) / 1000;
  check(!!giu && dopo >= DOPO / 1000 - 10 && dopo <= DOPO / 1000 + 30, `…e si chiude da sola dopo ${DOPO / 60e3} minuti (${Math.round(dopo)} s), col service worker fermo`);
  const e0 = relay.entrate().pc;
  const altra = await ctx.newPage();
  await altra.goto(EXTURL("tabellone.html")).catch(() => {});
  for (let i = 0; i < 40; i++) {
    await ferma();
    await sveglia();
    await riprendiSw();
    await sospendi(200);
  }
  await sospendi(2000);
  check(relay.entrate().pc === e0 && relay.prese().pc === 0, `40 risvegli dopo (e pagine che non sono il gestionale): nessuna presa nuova (${relay.entrate().pc - e0} nuove, ${relay.prese().pc} aperte)`);
  await altra.close();
  const fuori = await finche(async () => !(await fuoriAperti()).length, 20000);
  check(!!fuori, "e il documento fuori schermo, che non serve più a nessuno, si chiude");
  // il gestionale riaperto: di nuovo sul ponte (una pagina che si apre lo dice)
  const doc2 = await ctx.newPage();
  await doc2.goto(A.worklistUrl);
  check(!!(await finche(async () => relay.prese().pc === 1, 20000)) && relay.entrate().pc === e0 + 1, "riaperto il gestionale: di nuovo sul ponte, una presa");
  // la pagina d'accesso: quella scheda non tiene più il PC sul ponte
  await sw.evaluate(() => { FUORI.dopo = 2000; });
  login = true;
  await doc2.goto(A.patientUrl);
  login = false;
  const giuAcc = await finche(async () => relay.prese().pc === 0, 15000);
  check(!!giuAcc, `una scheda del gestionale sulla pagina d'accesso non tiene il PC sul ponte (qui il «dopo» accorciato)${giuAcc ? "" : " " + JSON.stringify(await sw.evaluate(async () => ({ g: await psaGestionale(), acc: [...ponteAcc.schede], st: pt.presa.stato(), dopo: FUORI.dopo, schede: (await chrome.tabs.query({})).map((t) => [t.id, t.url]) })))}`);
  await doc2.goto(A.patientUrl);
  check(!!(await finche(async () => relay.prese().pc === 1, 15000)), "rientrati nel gestionale (la pagina che si apre): di nuovo sul ponte");
  await sw.evaluate(() => { FUORI.dopo = 2 * 60e3; });
  await doc2.close();
}

// ===========================================================================
sezione("il ripiego: senza documento fuori schermo, la presa nel service worker come la 3.86");
{
  await sw.evaluate(async () => { await pt.presa.ferma(); await chrome.storage.session.set({ "fuori.ripiego": { ts: Date.now(), why: "prova" } }); });
  await finche(async () => relay.prese().pc === 0, 10000);
  await sw.evaluate(() => chrome.offscreen.closeDocument().catch(() => {}));
  check(await ferma(), "(fermato il service worker: riparte nel ripiego)");
  const doc3 = await ctx.newPage();
  await doc3.goto(A.patientUrl);
  await riprendiSw();
  check(!!(await finche(async () => relay.prese().pc === 1, 20000)), "una pagina del gestionale: sul ponte");
  check((await sw.evaluate(() => FUORI.ripiego)) === true && !(await fuoriAperti()).length && (await statoPonte())?.sveglia === true,
    "…con la presa nel service worker (nessun documento fuori schermo), e la pagina sa che deve svegliarlo ogni 30 secondi");
  const e0 = relay.entrate().pc, t0 = Date.now();
  check(await ferma(), "fermato il service worker");
  // (il ripetitore la vede uscire: subito dopo può già esserci quella nuova, se qualcosa lo risveglia)
  check(!!(await finche(async () => relay.eventi().some((e) => e.ts >= t0 && e.ruolo === "pc" && e.tipo === "esce"), 10000)), "la presa muore con lui (come fino alla 3.86)");
  check(!!(await finche(async () => relay.prese().pc === 1 && relay.entrate().pc > e0, 45000)), "la sveglia della pagina lo risveglia, e la presa si riapre (come fino alla 3.86)");
  await doc3.close();
}

await ctx.close();
await relay.chiudi();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fail ? `\nFUORI: ${fail} CHECK FALLITI\n` : "\nFUORI: TUTTO OK\n");
process.exit(fail ? 1 : 0);
