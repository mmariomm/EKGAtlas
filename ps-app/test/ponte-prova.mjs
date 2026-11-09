#!/usr/bin/env node
/*
 * «Prova»: l'app del telefono a /ponte/?prova, col PC finto (public/ponte/prova.js).
 * Il ripetitore Node serve l'app; un telefono (formato iPhone) ha già un'associazione
 * vera nella sua memoria. Si controlla che in prova: non si apre nessuna presa, la chiave
 * dell'associazione non si tocca (né letta né scritta né tolta), si vede l'elenco, si apre
 * un paziente, un ordine arriva fino a «Stampato», e quello per NERI GIULIA finisce «Non
 * partito». Poi, all'indirizzo di sempre, il telefono usa ancora la sua associazione.
 *   node test/ponte-prova.mjs        (TEST_SHOTS_DIR=… per le foto)
 */
import { chromium } from "playwright";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { existsSync, statSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const SHOTS = process.env.TEST_SHOTS_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
const chromiumPath = () => ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find((p) => existsSync(p) && statSync(p).isFile());
async function finche(fn, timeout = 20000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) if (await fn()) return true;
  return false;
}

const relay = await avviaRelay({});
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "it-IT",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
// l'associazione «vera» di questo telefono (una chiave a caso, buona un'ora), e lo spione: ogni presa aperta,
// e ogni accesso alla memoria sul suo nome
const VERA = JSON.stringify({ k: randomBytes(32).toString("base64url"), scade: Date.now() + 3600e3, dev: randomBytes(16).toString("base64url") });
await ctx.addInitScript((vera) => {
  try { if (!localStorage.getItem("psassist.ponte.v1")) localStorage.setItem("psassist.ponte.v1", vera); } catch { /* niente */ }
  window.__prese = 0; window.__chiave = [];
  const WS = window.WebSocket;
  window.WebSocket = function (...a) { window.__prese++; return new WS(...a); };
  window.WebSocket.prototype = WS.prototype;
  for (const m of ["getItem", "setItem", "removeItem"]) {
    const f = Storage.prototype[m];
    Storage.prototype[m] = function (k, ...r) { if (this === localStorage && /^psassist\.ponte\.v1/.test(k) && window.__scrivi !== false) window.__chiave.push(m); return f.call(this, k, ...r); };
  }
}, VERA);
const tel = await ctx.newPage();
const testo = () => tel.evaluate(() => document.body.innerText);
const aspetta = async (re, t = 20000) => (await finche(async () => re.test(await testo()), t)) ? testo() : "";
const vera = () => tel.evaluate(() => { window.__scrivi = false; const v = localStorage.getItem("psassist.ponte.v1"); window.__scrivi = true; return v; });
const shot = async (nome) => { if (SHOTS) await tel.screenshot({ path: join(SHOTS, nome + ".png") }).catch(() => {}); };

console.log("\nprova: l'app con un PC finto");
await tel.goto(relay.url + "/ponte/?prova");
check(/ROSSI MARIO/.test(await aspetta(/ROSSI MARIO/)), "?prova: si vede l'elenco dei pazienti finti");
const t0 = await testo();
check(/Prova · dati finti · niente va al PC/.test(t0), "la striscia «Prova · dati finti · niente va al PC» è in cima");
check(await tel.locator(".prova-banda").isVisible(), "…ed è visibile");
check(/GALLO PAOLO/.test(t0) && /VERDI LUCA/.test(t0) && /NERI GIULIA/.test(t0) && /BIANCHI ANNA/.test(t0), "alta e bassa intensità, l'episodio precedente");
check(/ROSA ELIO/.test(t0) || /Triage/i.test(t0), "chi aspetta al Triage");
check(/SpO2 90|NEWS 6|NEWS 9/.test(t0), "un paziente con i valori fuori range");
await shot("prova-telefono-lista");
check(await tel.evaluate(() => window.__prese) === 0, "nessuna presa del ponte aperta");
check(await tel.evaluate(() => window.__chiave.length) === 0, "la chiave dell'associazione non è stata né letta, né scritta, né tolta");
check(await vera() === VERA, "e nella memoria è com'era");

// un paziente, e un ordine fino alle etichette
await tel.locator('[data-a="paz"][data-ep="999001"]').first().click();
check(/RX TORACE/.test(await aspetta(/RX TORACE/)), "un paziente: Esiti col suo referto");
await tel.locator('[data-a="scheda"][data-s="richieste"]').click();
await aspetta(/Dol th/);
await tel.locator('[data-a="esame"]:has-text("TROPONINA US")').first().click();
await tel.locator("#quesito").fill("dolore toracico");
await tel.locator("#quesito").press("Enter");
await tel.locator("#ordina").click();
await sospendi(900);
await tel.locator("#ordina").click();
check(/Parte|In coda|In corso|Confermata/.test(await aspetta(/Parte|In coda|In corso|Confermata/, 8000)), "«Conferma e stampa»: l'ordine parte");
check(/Stampato su Zebra/.test(await aspetta(/Stampato su Zebra/, 20000)), "e arriva a «Stampato su Zebra…» (passando da Confermata)");
await shot("prova-telefono-paziente");
// l'ordine che non parte
await tel.locator('[data-a="indietro"]').first().click();
await tel.locator('[data-a="paz"][data-ep="999005"]').first().click();
await tel.locator('[data-a="scheda"][data-s="richieste"]').click();
await aspetta(/Dol th/);
await tel.locator('[data-a="esame"]:has-text("EMOCROMO POC")').first().click();
await tel.locator("#quesito").fill("febbre");
await tel.locator("#quesito").press("Enter");
await tel.locator("#ordina").click();
await sospendi(900);
await tel.locator("#ordina").click();
check(/Non partito/.test(await aspetta(/Non partito/, 20000)) && /La scheda per l'ordine non si è aperta/.test(await testo()), "l'ordine per NERI GIULIA finisce «Non partito», col suo perché");
check(await tel.evaluate(() => window.__prese) === 0 && await tel.evaluate(() => window.__chiave.length) === 0, "dopo tutto questo: ancora nessuna presa, ancora la chiave intatta");
check(await vera() === VERA, "…e uguale a prima");

// l'indirizzo di sempre: la sua associazione vera
console.log("\nprova: l'indirizzo di sempre");
await tel.goto(relay.url + "/ponte/");
await finche(async () => (await tel.evaluate(() => window.__prese)) >= 1, 8000);
check(await tel.evaluate(() => window.__prese) >= 1, "senza ?prova l'app apre la presa del ponte");
check(!/Prova · dati finti/.test(await testo()) && !/ROSSI MARIO/.test(await testo()), "e non ha né la striscia né i pazienti finti");
{ const x = await testo(); check(!/PS Assist sull.iPhone/.test(x) && /Mi collego|PC non risponde|Il PC/.test(x), `usa ancora la sua associazione, senza chiedere un QR (${x.replace(/\s+/g, " ").slice(0, 90)})`); }
check(await vera() === VERA, "la chiave dell'associazione è intatta");

await browser.close();
await relay.chiudi?.();
console.log(fail ? `\n${fail} controlli falliti` : "\ntutto ok");
process.exit(fail ? 1 : 0);
