#!/usr/bin/env node
/*
 * Il registratore sul visualizzatore di immagini del PACS (eViewer), con
 * l'estensione VERA: ⋯ → Registrazioni → Registra sul gestionale, la scheda
 * del paziente, la fotocamera «IMMAGINE» → una finestra nuova, un rinvio del
 * gestionale, e l'eViewer (http, porta 18188, un gettone «account»
 * nell'indirizzo). Il visualizzatore è FINTO e inventato: una lista di serie
 * con le miniature (una data:, una http, una blob:), un canvas WebGL2 e uno
 * 2D, la sovraimpressione DICOM con «ROSSI^MARIO» (il paziente del simulatore),
 * un operatore che c'è solo lì, un riquadro, un WebSocket. Due tocchi su due
 * miniature, «Ferma e salva» dalla pill: lo zip ha la forma (pagine, flusso,
 * eviewer.json, la sezione nel riepilogo) e NIENTE del paziente — né il nome
 * (in nessuna forma), né il gettone, né un byte d'immagine. Poi lo stesso
 * grezzo con un nome vero piantato in forma DICOM: il controllo lo trova.
 *   node test/ext-registra-eviewer.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { WebSocketServer } from "ws";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import https from "node:https";
import http from "node:http";

// (mai la rete vera: nessun proxy, ogni nome risolto in locale — il gestionale finto passa dalle route di Playwright)
const RETE_CHIUSA = ["--proxy-server=direct://", "--host-resolver-rules=MAP * 127.0.0.1"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-regview-" + process.pid);
const OUT = join("/tmp", "psa-regview-zip-" + process.pid);
mkdirSync(OUT, { recursive: true });
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sospendi = (ms) => new Promise((res) => setTimeout(res, ms));
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(200)) if (await fn()) return true;
  return false;
}

// ------------------------------------------------------ i dati (inventati)
const HOST = "mmeviewer.multimedica.root.lan";
const TOK = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822c";
const ACC = "16146285-1", PID = "4455667", NATO = "05/07/1947";
const UID4 = "1.2.392.200036.9125.4.0.1234.5678.4", UID5 = "1.2.392.200036.9125.4.0.1234.5678.5", UIDS = "1.2.392.200036.9125.2.1234567.20261029";
const VIEWER = `http://${HOST}:18188/e4cure/eviewer/viewer?requestType=STUDY&accessionNumber=${ACC}&account=${TOK}`;
// un PNG di un pixel (inventato): la miniatura data:, e i byte delle immagini «servite»
const PNG64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG64, "base64");
const DICOM = Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), Buffer.alloc(2048, 7)]);   // la forma di un file DICOM, nient'altro

// ------------------------------------------------------ il visualizzatore finto
const pagina = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>eViewer</title>
<style>.serie{display:inline-block;width:80px;margin:4px;cursor:pointer}.serie img{width:64px;height:64px}#ov{position:absolute;top:10px;left:600px;color:#fff;background:#000}</style>
<script src="/e4cure/eviewer/js/viewer.js"></script></head>
<body>
<div id="studi">
  <div class="serie" data-serie="1" data-uid="${UID4}"><img class="thumb" id="tb1" src="data:image/png;base64,${PNG64}"><span>1 DX - T Piede DP</span></div>
  <div class="serie" data-serie="4" data-uid="${UID4}"><img class="thumb" id="tb4" src="/e4cure/eviewer/thumb?uid=${UID4}&amp;account=${TOK}"><span>4 DX - W Torace PA</span></div>
  <div class="serie" data-serie="5" data-uid="${UID5}"><img class="thumb" id="tb5"><span>5 DX - Ginocchio LL</span></div>
  <div class="serie tutte"><span>All images</span></div>
</div>
<canvas id="vista" width="512" height="512"></canvas> <canvas id="mini" width="64" height="64"></canvas>
<div id="ov"><div>ROSSI^MARIO</div><div>Birth: ${NATO} (79Y)</div><div>Sex: M</div><div>ID: ${PID}</div><div>Acc: ${ACC}</div>
  <div>Study Date: 29/10/2026</div><div>Age At Study: 079Y</div><div>KVP: 70</div><div>MULTIMEDICA</div><div>Operator: GALBIATI^LUCIO</div><div id="se">Se: 1 Im: 1/1</div></div>
<iframe src="/e4cure/eviewer/info.html" width="200" height="40"></iframe>
<script>
const ACC = new URLSearchParams(location.search).get("account");
const gl = document.getElementById("vista").getContext("webgl2", { preserveDrawingBuffer: false });
const g2 = document.getElementById("mini").getContext("2d");
fetch("/e4cure/eviewer/thumb?uid=${UID5}&account=" + ACC).then((r) => r.blob()).then((b) => { document.getElementById("tb5").src = URL.createObjectURL(b); });
const ws = new WebSocket("ws://" + location.host + "/e4cure/ws?account=" + ACC);
ws.onopen = () => ws.send("pronto");
function mostra(el) {
  const uid = el.dataset.uid;
  // come un visualizzatore DICOM: i pixel da una risposta application/dicom, in una texture
  fetch("/e4cure/eviewer/wado?requestType=WADO&studyUID=${UIDS}&objectUID=" + uid + "&contentType=application/dicom&account=" + ACC).then((r) => r.arrayBuffer()).then(() => {
    if (gl) { gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, 2, 2, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(4)); }
  });
  // …e l'anteprima, un'immagine della stessa origine disegnata sul canvas 2D
  const im = new Image();
  im.onload = () => { g2.drawImage(im, 0, 0, 64, 64); g2.putImageData(g2.createImageData(2, 2), 0, 0); };
  im.src = "/e4cure/eviewer/render/" + uid + ".jpg?account=" + ACC;
  document.getElementById("se").textContent = "Se: " + el.dataset.serie + " Im: 1/1";
  for (const x of document.querySelectorAll(".serie")) x.classList.toggle("scelta", x === el);
}
for (const el of document.querySelectorAll(".serie[data-uid]")) el.addEventListener("click", () => mostra(el));
</script></body></html>`;
const alViewer = [];
const srvV = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  alViewer.push(`${req.method} ${u.pathname}`);
  if (u.pathname === "/e4cure/eviewer/viewer") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(pagina); }
  if (u.pathname === "/e4cure/eviewer/js/viewer.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "public, max-age=86400" }); return res.end("window.EVIEWER_FINTO = 1;"); }
  if (u.pathname === "/e4cure/eviewer/info.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<!DOCTYPE html><html><body><p>eViewer di prova</p></body></html>"); }
  if (u.pathname === "/e4cure/eviewer/thumb") { res.writeHead(200, { "content-type": "image/png", "content-length": PNG.length, "cache-control": "private, max-age=600", etag: '"t1"' }); return res.end(PNG); }
  if (/^\/e4cure\/eviewer\/render\/[\d.]+\.jpg$/.test(u.pathname)) {
    res.writeHead(200, { "content-type": "image/jpeg", "content-length": PNG.length, "cache-control": "private, max-age=3600", etag: '"r1"', "last-modified": "Thu, 29 Oct 2026 09:00:00 GMT" });
    return res.end(PNG);
  }
  if (u.pathname === "/e4cure/eviewer/wado") { res.writeHead(200, { "content-type": "application/dicom", "content-length": DICOM.length, "cache-control": "no-cache" }); return res.end(DICOM); }
  res.writeHead(404); res.end();
});
new WebSocketServer({ server: srvV }).on("connection", (s) => { s.on("message", () => s.send(Buffer.from([1, 2, 3, 4]))); });
await new Promise((ok) => srvV.listen(0, "127.0.0.1", ok));
// il rinvio della fotocamera (un 302 vero: quello di Playwright non si segue), dal «gestionale»
const CERT = join(OUT, "cert");
mkdirSync(CERT, { recursive: true });
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=smarthealth.multimedica.it", "-days", "1",
  "-keyout", join(CERT, "k.pem"), "-out", join(CERT, "c.pem")], { stdio: "ignore" });
const srvG = https.createServer({ key: readFileSync(join(CERT, "k.pem")), cert: readFileSync(join(CERT, "c.pem")) }, (req, res) => {
  if (/Sa4ViewerExtRedirect\.do\?ASSISTITO_ID=7001234/.test(req.url)) { res.writeHead(302, { location: VIEWER }); return res.end(); }
  res.writeHead(404); res.end();
});
await new Promise((ok) => srvG.listen(0, "127.0.0.1", ok));

// il gestionale: il simulatore di sempre (ROSSI MARIO), con la fotocamera nella scheda del paziente
const A = createMock({});
const camera = `<a id="psa-prova-foto" title="IMMAGINE" href="#" onclick="window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=7001234&amp;REFERTO_SISTEMA=HL7RIS&amp;REFERTO_ID=99887766','HL7RIS'); return false;"><img src="../Themes/AFC/images/foto.png" alt="foto"></a>`;
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean), ...RETE_CHIUSA,
    `--host-resolver-rules=MAP smarthealth.multimedica.it 127.0.0.1:${srvG.address().port}, MAP ${HOST} 127.0.0.1:${srvV.address().port}`, "--ignore-certificate-errors", "--no-proxy-server"],
});
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 })); } catch { /* niente */ }
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request(), u = req.url();
  if (/Sa4ViewerExtRedirect\.do\?ASSISTITO_ID=7001234/.test(u)) return r.continue();
  let out = A.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = A.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  if (/html/.test(out.headers["content-type"] || "") && /MVPG=PsoEpisodioClinicoAmbulatorio/.test(u)) {
    out = { ...out, body: Buffer.from(Buffer.from(out.body).toString("latin1").replace("<body>", `<body>${camera}`), "latin1") };
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa */ }
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const stato = () => sw.evaluate(() => chrome.storage.local.get("registra").then((o) => o.registra || null));
const lista = () => sw.evaluate(() => regElenco());
const $panel = (p, sel) => p.locator(`#psassist-host ${sel}`);
const $pill = (p, sel = "") => p.locator(`#psassist-reg-host ${sel}`.trim());

// ---- 0. i permessi: l'host del visualizzatore, ogni porta, http e https -------------------
{
  const m = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
  const pat = [`http://${HOST}/*`, `https://${HOST}/*`];
  const reg = m.content_scripts.find((c) => c.js.includes("registra-pagina.js"));
  const sonda = m.content_scripts.find((c) => c.js.includes("registra-sonda.js"));
  check(pat.every((x) => m.host_permissions.includes(x) && reg.matches.includes(x) && sonda.matches.includes(x)) && sonda.world === "MAIN" && sonda.run_at === "document_start"
    && !m.content_scripts.some((c) => c.js.includes("content.js") && c.matches.some((x) => x.includes(HOST))),
    "manifest: l'host del visualizzatore (ogni porta) nei permessi, nel registratore e nella sonda (mondo della pagina); il pannello no");
  check(await sw.evaluate((o) => chrome.permissions.contains({ origins: o }), [`http://${HOST}:18188/*`]), "il permesso c'è già, senza chiederlo (porta 18188 compresa)");
}

// ---- 1. ⋯ → Registrazioni → Registra sul gestionale ---------------------------------------
const doc = await ctx.newPage();
await doc.goto(A.patientUrl);
await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
if (!(await $panel(doc, ".card").count())) { await $panel(doc, "#expand").click(); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
await $panel(doc, "#menubtn").click();
await $panel(doc, "#regmenu").click();
await doc.waitForSelector("#psassist-host #regvia", { timeout: 8000 });
await $panel(doc, "#regvia").click();
check(await finche(async () => (await stato())?.stato === "rec", 8000), "la registrazione parte dal pannello del gestionale");
await $panel(doc, "#collapse").click();
await doc.waitForTimeout(1500);

// ---- 2. la fotocamera: una finestra nuova, il rinvio, l'eViewer ---------------------------
const [vw] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), doc.locator("#psa-prova-foto").dispatchEvent("click")]);
await vw.waitForURL(/e4cure\/eviewer\/viewer/, { timeout: 15000 });
await vw.waitForLoadState("load").catch(() => {});
check(vw.url() === VIEWER, `la fotocamera apre l'eViewer dopo il rinvio (${vw.url().replace(TOK, "<gettone>")})`);
check(await finche(async () => (await $pill(vw, "#expand").count()) === 1, 8000) && await vw.locator("#psassist-host").count() === 0,
  "sull'eViewer: niente pannello, la pill «● Registrando…» sì");
await vw.waitForTimeout(1500);
await vw.locator("#tb4").click();
await vw.waitForTimeout(1800);
await finche(() => vw.evaluate(() => /^blob:/.test(document.getElementById("tb5").src)), 5000);
await vw.locator("#tb5").click();
await vw.waitForTimeout(1800);

// ---- 3. il grezzo, prima di uscire dal PC: mai un'immagine, la forma sì -------------------
const g = await sw.evaluate(() => regTutto().then((l) => l.map((x) => (x.byte ? { ...x, byte: x.byte.length } : x))));
const gv = g.filter((x) => x.tipo === "pagina" && x.url.includes(HOST));
const tec = gv.map((x) => x.tecnica).filter(Boolean).pop() || {};
check(gv.length >= 2 && gv.every((x) => !x.html.includes(PNG64) && !/data:image\/png;base64/.test(x.html)), `nel grezzo (${gv.length} istantanee del visualizzatore) nessuna immagine: la miniatura data: è già tolta nella pagina`);
const canvas = tec.canvas || [];
check(tec.sonda && canvas.length === 2 && canvas[0].contesto === "webgl2" && canvas[0].preserveDrawingBuffer === false && canvas[1].contesto === "2d",
  `la sonda (mondo della pagina) dice i contesti dei canvas, senza crearli (${JSON.stringify(canvas.map((c) => [c.contesto, c.preserveDrawingBuffer]))})`);
check((tec.websocket || []).length === 1 && tec.websocket[0].ricevuti >= 1 && tec.websocket[0].binari >= 1 && !JSON.stringify(tec.websocket).includes(TOK),
  `il WebSocket: percorso, messaggi e byte — senza la query (${JSON.stringify(tec.websocket && tec.websocket[0])})`);
const clicG = g.filter((x) => x.tipo === "flusso").flatMap((x) => x.clic || []);
check(clicG.length >= 2 && clicG.every((c) => c.bersaglio && c.bersaglio.strada[0].tag === "img"), `i due tocchi sulle miniature sono registrati (${clicG.length})`);

// ---- 4. «Ferma e salva» dalla pill dell'eViewer ------------------------------------------
await sw.evaluate(() => {
  const vero = regSalvaOra;
  self.__grezzo = null;
  regSalvaOra = async (o) => { if (o.fonte === "grezzi" && !self.__grezzo) self.__grezzo = { grezzi: await regTutto(), st: o.st }; return vero(o); };
});
await $pill(vw, "#expand").click();
await $pill(vw, "#regferma").click();
check(await finche(async () => (await lista()).length === 1, 90000), "«Ferma e salva» dalla pill: lo zip è nella memoria dell'estensione");
const zz = (await lista())[0] || {};
check(zz.controllo && zz.punti === 0, `il controllo è passato (${zz.nome} · punti ${zz.punti})`);
const zip = join(OUT, "r.zip");
writeFileSync(zip, Buffer.from(await sw.evaluate(async (id) => b64(await RegistraDb.tx("zipdati", "readonly", (s) => s.get(id))), zz.id), "base64"));
if (process.env.REG_ZIP) writeFileSync(process.env.REG_ZIP, readFileSync(zip));

// ---- 5. dentro lo zip ------------------------------------------------------------------------
const dir = join(OUT, "dentro");
mkdirSync(dir, { recursive: true });
try { execFileSync("unzip", ["-q", "-o", zip, "-d", dir]); } catch (e) { check(false, "lo zip si apre: " + e.message); }
const leggi = (f) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return ""; } };
const pagine = existsSync(join(dir, "pagine")) ? readdirSync(join(dir, "pagine")) : [];
const pv = pagine.filter((f) => /-eviewer-viewer\.html$/.test(f)).map((f) => leggi("pagine/" + f));
check(pv.length >= 2 && pagine.some((f) => /-eviewer-info\.html$/.test(f)) && pagine.some((f) => /PsoEpisodioClinicoAmbulatorio/.test(f)),
  `le istantanee del visualizzatore (e del suo riquadro), accanto a quelle del gestionale (${pagine.join(", ")})`);
const ultima = pv[pv.length - 1] || "";
const nomeF = (/<div>([A-Z]+\^[A-Z]+)<\/div>/.exec(ultima) || [])[1];
check(nomeF && !/ROSSI|MARIO/.test(nomeF) && /Sex: M/.test(ultima) && /KVP: 70/.test(ultima) && /Birth: \d{2}\/\d{2}\/1947 \(79Y\)/.test(ultima) && /Operator: OPERATORE \d+/.test(ultima)
  && /Se: [45] Im: 1\/1/.test(ultima) && ultima.includes("4 DX - W Torace PA") && /<canvas id="vista" width="512" height="512">/.test(ultima),
  `la pagina del visualizzatore: la struttura, la sovraimpressione leggibile con valori finti (${nomeF}), le serie, i canvas`);
const fl = JSON.parse(leggi("flusso.json") || "{}");
const rq = (fl.richieste || []).filter((x) => x.viewer);
const di = (re) => rq.filter((x) => re.test(x.url));
const thumb = di(/\/thumb\?/), render = di(/\/render\//), wado = di(/\/wado\?/);
check(thumb.length >= 2 && render.length >= 2 && wado.length >= 2 && rq.every((x) => x.url.startsWith("http://eviewer.esempio:18188/")),
  `il flusso del visualizzatore su indirizzi finti: miniature ${thumb.length}, immagini ${render.length}, WADO ${wado.length}`);
check(render.every((x) => x.contenuto === "image/jpeg" && x.misura === PNG.length && x.intestazioni.cache === "private, max-age=3600" && x.intestazioni.etag && x.intestazioni.ultimaModifica)
  && wado.every((x) => x.contenuto === "application/dicom" && x.misura === DICOM.length && x.intestazioni.cache === "no-cache" && x.tipo === "xmlhttprequest"),
  `con tipo, misura, Cache-Control, ETag, Last-Modified (${JSON.stringify(render[0] && { c: render[0].contenuto, m: render[0].misura, i: render[0].intestazioni })})`);
check(rq.every((x) => !/account=[0-9a-f]/i.test(x.url)) && wado.every((x) => /requestType=WADO/.test(x.url) && /contentType=application\/dicom/.test(x.url)),
  "il gettone «account» non c'è (il valore è vuoto); i parametri tecnici restano");
const rin = (fl.richieste || []).find((x) => /Sa4ViewerExtRedirect/.test(x.url));
check(rin && rin.rinvii.length === 1 && /^http:\/\/eviewer\.esempio:18188\/e4cure\/eviewer\/viewer\?requestType=STUDY&accessionNumber=\d{8}-\d&account=$/.test(rin.rinvii[0].a),
  `il rinvio della fotocamera, verso l'indirizzo finto (${rin && rin.rinvii.map((x) => x.a).join(" → ")})`);
const ev = JSON.parse(leggi("eviewer.json") || "{}");
const c0 = (ev.clic || [])[0] || {};
check((ev.clic || []).length >= 2 && c0.bersaglio.strada[0].tag === "img" && c0.bersaglio.strada[0].classe === "thumb" && c0.bersaglio.img.tipo === "http"
  && c0.bersaglio.img.indirizzo === "http://eviewer.esempio:18188/e4cure/eviewer/thumb?account&uid" && ev.clic[1].bersaglio.img.tipo === "blob:",
  `eviewer.json: i clic sulle miniature (http, poi blob:) (${JSON.stringify(c0.bersaglio).slice(0, 160)})`);
const tz = (ev.pagine || []).map((x) => x.tecnica).filter((x) => x && x.canvas.length).pop() || {};
check(tz.immagini && ["data:image/png", "http", "blob:"].every((t) => tz.immagini.some((x) => x.tipo === t)) && (tz.riquadri || []).length === 1
  && (tz.script || []).includes("http://eviewer.esempio:18188/e4cure/eviewer/js/viewer.js") && (tz.risorse || []).some((x) => x.tipo === "img" && /\/render\/[\d.]+\.jpg(?:\?|$)/.test(x.indirizzo))
  && (tz.disegni || {})["2d drawImage img-stessa-origine"] >= 1 && (tz.disegni || {})["2d putImageData"] >= 1 && Object.keys(tz.disegni || {}).some((k) => /^webgl texImage2D pixel-Uint16Array$/.test(k))
  && (tz.blob || {})["image/png"] && tz.blob["image/png"].n >= 1,
  `eviewer.json: miniature (data:, http, blob:), riquadro, script, Resource Timing, da dove si disegna, i blob (${JSON.stringify(tz.disegni)})`);
const riep = leggi("riepilogo.txt");
const sez = (riep.split("Visualizzatore di immagini")[1] || "").split("\n\n")[0];
check(/Canvas: 2 — webgl2 512×512 \(sullo schermo \d+×\d+, preserveDrawingBuffer no\); 2d 64×64/.test(sez)
  && /WebSocket: ws:\/\/eviewer\.esempio:18188\/e4cure\/ws \(parametri account\): ricevuti \d+ \(binari \d+/.test(sez)
  && /GET http:\/\/eviewer\.esempio:18188\/e4cure\/eviewer\/render\/\{uid\}\.jpg\?account — \d+× image\/jpeg \[image\]/.test(sez)
  && /wado\?account&contentType=application\/dicom&objectUID&requestType=WADO&studyUID — \d+× application\/dicom \[xmlhttprequest\]/.test(sez)
  && /Cache-Control «private, max-age=3600»/.test(sez) && /Miniature e immagini <img>: 3 — /.test(sez),
  "riepilogo.txt: canvas e preserveDrawingBuffer, WebSocket, le richieste d'immagine per modello con contenuto e cache, le miniature");
const tocco = (/[^\n]*click su img\.thumb#tb4 \(immagine http 1×1 [^)]*\) → [^\n]*/.exec(sez) || [""])[0];
check(/Clic: 2/.test(sez) && /nei 3 s dopo 2 richieste: /.test(tocco) && /1× GET [^;]*\/wado\?[^;]*application\/dicom/.test(tocco) && /1× GET [^;]*\/render\/\{uid\}\.jpg[^;]*image\/jpeg/.test(tocco)
  && /click su img\.thumb#tb5 \(immagine blob: 1×1\) → nei 3 s dopo 2 richieste/.test(sez),
  `riepilogo.txt: il tocco su una miniatura e le richieste che fa — il DICOM e l'immagine, non quelle del tocco dopo (${tocco.trim().slice(0, 90)}…)`);
console.log("\n----- riepilogo.txt (visualizzatore) -----\nVisualizzatore di immagini" + sez + "\n------------------------------------------");
// niente del paziente, da nessuna parte (e nemmeno nell'elenco)
const tutto = readdirSync(dir, { recursive: true }).filter((f) => statSync(join(dir, String(f))).isFile()).map((f) => leggi(String(f))).join("\n") + JSON.stringify(await lista());
for (const [cosa, re] of [["il paziente in forma DICOM", /ROSSI\^MARIO/i], ["il paziente", /ROSSI(?:\s|&nbsp;|\+|%20|\^|,)+MARIO/i], ["il paziente girato", /MARIO(?:\s|&nbsp;|\+|%20|\^|,)+ROSSI/i],
  ["l'operatore (solo nel visualizzatore)", /GALBIATI|LUCIO/i], ["il gettone", new RegExp(TOK.slice(0, 12), "i")], ["l'accettazione", /16146285/], ["l'ID del paziente", new RegExp(PID)],
  ["la data di nascita", /05\/07\/1947/], ["un UID vero", /200036\.9125/], ["l'host del visualizzatore", /mmeviewer|root\.lan/i], ["l'ospedale", /multimedica/i],
  ["un'immagine in base64", new RegExp(PNG64.slice(0, 16))], ["un'immagine data:", /data:image\/png;base64/i], ["l'intestazione DICOM", /DICM/]]) {
  check(!re.test(tutto), `nello zip non c'è ${cosa}`);
}

// ---- 6. lo stesso grezzo, con un nome vero piantato in forma DICOM: il controllo lo trova ---------------
const piantato = await sw.evaluate(async () => {
  const v = self.__grezzo;
  if (!v) return null;
  await RegistraDb.tx("grezzi", "readwrite", (s) => { for (const x of v.grezzi) s.add(x); });
  await chrome.storage.local.set({ registra: v.st });
  REG_PROVA = { aggiungi: { "pagine/999-piantata.html": "<p>Paziente: ROSSI^MARIO^^</p><p>Op: GALBIATI^LUCIO</p>" } };
  const r = await regSalvaManuale();
  REG_PROVA = null;
  return r;
});
const zp = (await lista()).find((x) => x.id !== zz.id) || {};
const dove = (await sw.evaluate((id) => RegistraDb.tx("zip", "readonly", (s) => s.get(id)), zp.id || "")) || {};
check(piantato && piantato.ok && zp.controllo === false && zp.punti >= 2 && dove.dove && dove.dove["pagine/999-piantata.html"]
  && dove.dove["pagine/999-piantata.html"].nome >= 1 && dove.dove["pagine/999-piantata.html"].personale >= 1 && /^ATTENZIONE: restano \d+ dati da controllare/.test(zp.riepilogo || ""),
  `un nome vero piantato in forma DICOM (il paziente, e l'operatore visto solo nel visualizzatore): il controllo lo trova (${JSON.stringify(dove.dove || {})})`);
check(!/ROSSI|GALBIATI/.test(zp.riepilogo || "x ROSSI"), "e l'avviso dice dove e che cosa, mai il valore");
await ctx.close();

// ---- 7. «Aggiorna app» da una versione senza l'eViewer: la cartella cambia, chrome.runtime.reload()
// (l'estensione non pacchettizzata, con la Modalità sviluppatore come sul PC del medico): Chrome
// non chiede niente e il permesso per l'host del visualizzatore c'è
{
  const VEC = join(OUT, "vecchia"), PROF2 = join(OUT, "profilo2");
  cpSync(EXT, VEC, { recursive: true });
  const man = JSON.parse(readFileSync(join(VEC, "manifest.json"), "utf8"));
  const senza = (l) => l.filter((x) => !x.includes(HOST));
  writeFileSync(join(VEC, "manifest.json"), JSON.stringify({ ...man, host_permissions: senza(man.host_permissions),
    content_scripts: man.content_scripts.map((c) => ({ ...c, matches: senza(c.matches) })).filter((c) => c.matches.length) }, null, 2));
  mkdirSync(join(PROF2, "Default"), { recursive: true });
  writeFileSync(join(PROF2, "Default", "Preferences"), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
  const ctx2 = await chromium.launchPersistentContext(PROF2, { headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
    args: [`--disable-extensions-except=${VEC}`, `--load-extension=${VEC}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean), ...RETE_CHIUSA, "--no-proxy-server"] });
  let sw2 = ctx2.serviceWorkers()[0] || await ctx2.waitForEvent("serviceworker", { timeout: 15000 });
  const ha = (s) => s.evaluate((o) => chrome.permissions.contains({ origins: o }), [`http://${HOST}:18188/*`]);
  const prima = await ha(sw2);
  writeFileSync(join(VEC, "manifest.json"), JSON.stringify(man, null, 2));   // la cartella nuova, come la mette «Aggiorna app»
  const nasce = ctx2.waitForEvent("serviceworker", { timeout: 30000 }).catch(() => null);
  await sw2.evaluate(() => chrome.runtime.reload()).catch(() => {});
  sw2 = await nasce;
  const dopo = sw2 ? await ha(sw2).catch(() => null) : null;
  const nonPacchettizzata = sw2 ? await sw2.evaluate(() => chrome.management.getSelf().then((x) => x.installType)).catch(() => "?") : "?";
  check(prima === false && dopo === true, `«Aggiorna app» (ricarica dell'estensione non pacchettizzata, ${nonPacchettizzata}): prima senza il permesso, dopo con — nessuna richiesta, nessuna estensione disattivata`);
  await ctx2.close();
}

srvV.close();
srvG.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nREGISTRA EVIEWER: TUTTO OK");
process.exit(fail ? 1 : 0);
