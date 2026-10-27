#!/usr/bin/env node
/*
 * L'ordine in sottofondo in una scheda DAVVERO nascosta. Playwright tiene ogni
 * scheda «visibile» e col fuoco (attacca l'emulazione del fuoco a ogni
 * pagina): la scheda dell'ordine che in reparto è nascosta, coi timer
 * rallentati e le risorse caricate col contagocce, in ext-ordine.mjs non
 * esiste. Qui Chrome parte da solo, senza Playwright, guidato con CDP grezzo
 * solo nella scheda del medico; il simulatore lo serve un server HTTPS locale
 * (host-resolver-rules), con le icone delle pagine vere (non in cache), un po'
 * di latenza, e una Conferma che al server costa 12 secondi.
 *
 * Fino alla 3.54 la scheda dell'ordine confermava in una cornice: nascosta,
 * Chrome ne caricava le icone due alla volta, i 25 secondi scadevano mentre il
 * server confermava, e UNA lettura della pagina del paziente diceva «Non
 * confermata» per una richiesta confermata. Adesso conferma sulla pagina vera.
 *   node test/ext-nascosta.mjs
 */
import https from "node:https";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const sleep = (x) => new Promise((r) => setTimeout(r, x));
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
console.log("ordine in una scheda nascosta (Chrome senza Playwright)");

// ---- certificato usa e getta (Chrome parte con --ignore-certificate-errors) ----
const TMP = mkdtempSync(join(tmpdir(), "psa-nascosta-"));
try {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(TMP, "key.pem"), "-out", join(TMP, "cert.pem"),
    "-days", "2", "-subj", "/CN=smarthealth.multimedica.it"], { stdio: "ignore" });
} catch {
  console.log("  (manca openssl: prova SALTATA)\n\nNASCOSTA: SALTATA\n");
  rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
}

// ---- il «server»: ROSSI (l'ordine) e BIANCHI (dove va il medico) ----------------
const A = createMock({ nuoveVersioni: { 3: "325", 166: "326" } });
const B = createMock({ name: "BIANCHI ANNA", episodeId: "999002", nuoveVersioni: { 3: "325" } });
B.state.nextRichiestaId = 800001;
const quale = (u) => {
  const p = new URL(u).searchParams;
  return p.get("EPISODIO_ID") === "999002" || Number(p.get("RICHIESTA_ID")) >= 800000 ? B : A;
};
const ICONE = 140, ICONA_MS = 200, LAT = 300, CONFERMA_MS = 12000;   // come le pagine vere, non in cache
const srv = https.createServer({ key: readFileSync(join(TMP, "key.pem")), cert: readFileSync(join(TMP, "cert.pem")) }, (req, res) => {
  const pezzi = [];
  req.on("data", (c) => pezzi.push(c));
  req.on("end", async () => {
    if (req.url.startsWith("/sa4pso/icone/")) {
      await sleep(ICONA_MS);
      res.writeHead(200, { "content-type": "image/gif", "cache-control": "no-store" });
      return res.end(Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"));
    }
    const u = "https://smarthealth.multimedica.it" + req.url;
    await sleep(LAT);
    if (req.method === "POST" && /Prestazioni/.test(new URL(u).searchParams.get("ccsForm") || "")) await sleep(CONFERMA_MS);
    const out = quale(u).handle({ method: req.method, url: u, bodyBuffer: Buffer.concat(pezzi) });
    let body = out.body;
    if (/html/.test(out.headers["content-type"] || "")) {
      const img = Array.from({ length: ICONE }, (_, k) => `<img src="/sa4pso/icone/i${k}.gif?v=${Date.now()}" width="1" height="1">`).join("");
      body = Buffer.from(Buffer.from(body).toString("latin1").replace(/<\/body>/i, img + "</body>"), "latin1");
    }
    res.writeHead(out.status, out.headers);
    res.end(body);
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));

// ---- Chrome, senza Playwright ---------------------------------------------------
const exe = process.env.CHROMIUM_PATH || [chromium.executablePath(), "/opt/pw-browsers/chromium"].find((p) => p && existsSync(p) && statSync(p).isFile());
const PROFILO = join(TMP, "profilo");
const ch = spawn(exe, [`--user-data-dir=${PROFILO}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--no-sandbox",
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--disable-features=PdfOopif", "--ignore-certificate-errors", "--no-proxy-server",
  `--host-resolver-rules=MAP smarthealth.multimedica.it 127.0.0.1:${srv.address().port}`, "--window-size=1366,768", "--kiosk-printing", "--headless=new", "about:blank"],
{ stdio: ["ignore", "ignore", "pipe"] });
const fine = async (codice) => {
  ch.kill("SIGKILL");
  srv.close();
  await sleep(500);
  rmSync(TMP, { recursive: true, force: true });
  console.log(codice ? `\nNASCOSTA: ${fail || 1} CHECK FALLITI\n` : "\nNASCOSTA: TUTTO OK\n");
  process.exit(codice);
};
const wsUrl = await new Promise((ok, no) => {
  let b = ""; const t = setTimeout(() => no(new Error("Chrome non parte")), 20000);
  ch.stderr.on("data", (d) => { b += d; const m = /DevTools listening on (ws:\S+)/.exec(b); if (m) { clearTimeout(t); ok(m[1]); } });
});
const ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((r) => ws.once("open", r));
let nid = 0;
const attese = new Map(), ascolti = [];
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const i = ++nid; attese.set(i, { ok, no, method });
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
});
ws.on("message", (m) => {
  const x = JSON.parse(m);
  if (x.id && attese.has(x.id)) { const p = attese.get(x.id); attese.delete(x.id); return x.error ? p.no(new Error(p.method + ": " + x.error.message)) : p.ok(x.result); }
  for (const h of ascolti) h(x);
});

// le schede che nascono (la scheda dell'ordine) e il service worker
let medico = null, lavoro = null, swS = null, nascosta = null;
ascolti.push(async (x) => {
  if (x.method !== "Target.attachedToTarget") return;
  const { sessionId, targetInfo, waitingForDebugger } = x.params;
  if (targetInfo.type === "page" && medico && targetInfo.targetId !== medico && !lavoro && !/^chrome-extension:/.test(targetInfo.url)) lavoro = { id: targetInfo.targetId, s: sessionId };
  if (targetInfo.type === "service_worker") swS = sessionId;
  if (waitingForDebugger) await send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
});
await send("Target.setDiscoverTargets", { discover: true });
await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
const ordini = async () => {
  if (!swS) {
    const sw = (await send("Target.getTargets")).targetInfos.find((t) => t.type === "service_worker" && /bg\.js$/.test(t.url));
    if (sw) swS = (await send("Target.attachToTarget", { targetId: sw.targetId, flatten: true }).catch(() => ({}))).sessionId || null;
  }
  if (!swS) return null;
  const r = await send("Runtime.evaluate", { expression: "chrome.storage.session.get('ordini').then((o) => o.ordini || [])", awaitPromise: true, returnByValue: true }, swS).catch(() => null);
  return r && r.result ? r.result.value : null;
};

// la scheda del medico
medico = (await send("Target.getTargets")).targetInfos.find((t) => t.type === "page").targetId;
const docS = (await send("Target.attachToTarget", { targetId: medico, flatten: true })).sessionId;
await send("Page.enable", {}, docS);
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, docS);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const aspetta = async (expr, ms = 15000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(150)) if (await ev(expr).catch(() => false)) return true;
  throw new Error("aspetto invano: " + expr.slice(0, 80));
};
const vai = async (url) => {
  await send("Page.navigate", { url }, docS);
  for (let k = 0; k < 80; k++) { await sleep(150); if (await ev(`document.readyState === "complete" && location.href.includes(${JSON.stringify(url.slice(-20))})`).catch(() => false)) break; }
};
const SR = "document.getElementById('psassist-host')?.shadowRoot";
const clic = async (sel, testo = "") => {
  const b = await ev(`(() => { const e = [...${SR}.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.includes(${JSON.stringify(testo)})); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!b) throw new Error("non trovo " + sel + " " + testo);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: b.x, y: b.y, button: "left", clickCount: 1 }, docS);
};
const striscia = () => ev(`(${SR}?.querySelector('.pill.run')?.innerText || '').replace(/\\s+/g, ' ').trim()`).catch(() => "");

try {
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }, docS).catch(() => {});
  await vai(A.patientUrl);
  await aspetta(`!!${SR}`);
  await sleep(800);
  if (!(await ev(`!!${SR}.querySelector('.card')`))) { await clic("#expand"); await aspetta(`!!${SR}.querySelector('.card')`); }
  if (!(await ev(`!!${SR}.querySelector('#q')`))) { await clic('[data-seg="richieste"]'); await aspetta(`!!${SR}.querySelector('#q')`); }
  await ev(`(() => { const q = ${SR}.querySelector('#q'); q.focus(); q.select(); return true; })()`);
  await send("Input.insertText", { text: "dolore toracico" }, docS);
  await sleep(200);
  await clic(".chip.preset", "Base PS");
  await sleep(300);
  await clic("#goconfirm");
  await sleep(300);
  await vai(B.patientUrl);   // il medico va subito su un altro paziente

  // a metà giro: la scheda dell'ordine è davvero nascosta (se no questa prova non prova niente)
  for (let k = 0; k < 100 && !nascosta; k++) {
    await sleep(200);
    if (lavoro) nascosta = await send("Runtime.evaluate", { expression: "location.origin + ' ' + document.visibilityState + ' ' + document.hasFocus()", returnByValue: true }, lavoro.s)
      .then((r) => (/^https:\/\/smarthealth\.multimedica\.it hidden false$/.test(r.result.value) ? r.result.value : null)).catch(() => null);
  }
  check(!!nascosta, `la scheda dell'ordine è nascosta e senza fuoco, come in reparto (got: ${nascosta || "mai"})`);

  let l = null;
  for (const t0 = Date.now(); Date.now() - t0 < 150000; await sleep(500)) {
    l = await ordini();
    if (l && l.length && !l.some((x) => ["coda", "avvio", "corre"].includes(x.stato))) break;
  }
  const rid = Object.keys(A.state.richieste)[0];
  const o = (l || [])[0] || {};
  check(!!rid && A.state.richieste[rid].confirmed === true, "il server ha confermato la richiesta");
  check(o.stato === "stampa" && /Confermata/.test(o.pubblico?.titolo || ""),
    `e l'ordine lo dice: «Confermata», etichette pronte — mai un falso «Non confermata» (got: ${o.stato} · ${o.pubblico?.titolo} · ${o.pubblico?.testo})`);
  const conf = A.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
  check(conf.length === 1, `una Conferma sola (got ${conf.length})`);
  check(Object.values(A.state.insertCount).every((n) => n === 1) && Object.keys(A.state.insertCount).length === 3,
    `ogni esame mandato una volta (${JSON.stringify(A.state.insertCount)})`);
  check(/Etichette di ROSSI M\. pronte/.test(await striscia()), `sulla pagina di BIANCHI: «Etichette di ROSSI M. pronte» (got: ${await striscia()})`);
} catch (e) {
  console.log("  ✗ " + (e && e.message || e));
  fail++;
}
await fine(fail ? 1 : 0);
