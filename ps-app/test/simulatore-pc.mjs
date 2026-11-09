#!/usr/bin/env node
/*
 * Il PC SIMULATO: l'estensione VERA in Chromium, davanti un gestionale finto
 * (gestionale-vero.mjs: pazienti, esami e referti inventati), collegata al
 * ripetitore VERO del ponte (quello fissato nella build). Stampa il link del QR:
 * lo si apre sull'iPhone e si prova l'app del telefono col percorso di sempre.
 * Resta acceso finché non lo si ferma (Ctrl+C). Niente di vero: nomi, codici
 * fiscali ed esami sono finti.
 *   node test/simulatore-pc.mjs            (prima: npm run build)
 *   SIM_DIR=<cartella>  dove scrive qr.txt + qr.svg, stato.json, le foto; in comando.txt:
 *                       «qr» = un'associazione nuova (QR nuovo), «foto» = le schermate del PC
 */
import { chromium } from "playwright";
import { createMock } from "./gestionale-vero.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const DIR = process.env.SIM_DIR || join("/tmp", "psa-simulatore");
mkdirSync(DIR, { recursive: true });
const PROFILE = join("/tmp", "psa-sim-profilo");
const chromiumPath = () => ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find((p) => existsSync(p) && statSync(p).isFile());
const log = (m) => console.log(`${new Date().toTimeString().slice(0, 8)}  ${m}`);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));

// il QR come immagine, col codificatore dell'estensione (qr.js, Project Nayuki)
const QRG = (() => { const c = {}; vm.runInNewContext(readFileSync(join(EXT, "qr.js"), "utf8"), c); return c.qrcodegen; })();
function qrSvg(testo) {
  const q = QRG.QrCode.encodeText(testo, QRG.QrCode.Ecc.MEDIUM), n = q.size, m = 4, lato = n + 2 * m;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.getModule(x, y)) d += `M${x + m},${y + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lato} ${lato}" width="${lato * 10}" height="${lato * 10}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
const CF_A = "RSSMRA60A01F205Z", CF_B = "BNCNNA75C41F205K";
const A = createMock({ withResults: true, cf: CF_A });
const B = createMock({ name: "BIANCHI ANNA", episodeId: "999002", cf: CF_B });
B.state.nextRichiestaId = 800001;
const quale = (url) => {
  const p = new URL(url).searchParams;
  return p.get("EPISODIO_ID") === "999002" || Number(p.get("RICHIESTA_ID")) >= 800000 ? B : A;
};
const riquadro = (nome, triage, ep, cf, nascita) => `<table><tr><td title="${triage}"><font style="font-size: 120%; font-weight: bolder; ">${ep}</font><br><font style="font-size: 150%; font-weight: bolder; ">${nome}</font><br>${
  nascita ? `<font style="font-size: 120%; font-weight: bolder; ">${nascita}</font><br>` : ""}<font style="font-size: 120%; font-weight: bolder; ">${cf}</font></td></tr></table>`;

if (!process.env.SIM_TIENI) rmSync(PROFILE, { recursive: true, force: true });
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--disable-features=PdfOopif",
    ...(proxy ? [`--proxy-server=${proxy}`] : [])],
});
// il gestionale finto: ogni richiesta a smarthealth la serve il banco, mai la rete
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request(), u = req.url(), mock = quale(u);
  let out = mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  if (/html/.test(out.headers["content-type"] || "") && /MVPG=PsoEpisodioClinicoAmbulatorio|^[^?]*\?EPISODIO_ID/.test(u)) {
    const rossi = quale(u) === A;
    const html = Buffer.from(out.body).toString("latin1").replace("<body>", "<body>" + riquadro(rossi ? "ROSSI MARIO" : "BIANCHI ANNA",
      rossi ? "ARANCIONE" : "VERDE", quale(u).state.episodeId, rossi ? CF_A : CF_B, rossi ? "17/05/1949 (77) M" : ""));
    out = { ...out, body: Buffer.from(html, "latin1") };
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa */ }
});
const sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || await ctx.waitForEvent("serviceworker", { timeout: 15000 });

// il medico: la pagina di BIANCHI, poi quella di ROSSI (il pannello li conosce), e resta su ROSSI
const doc = ctx.pages()[0] || await ctx.newPage();
for (const u of [B.patientUrl, A.patientUrl]) {
  await doc.goto(u);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 20000 });
  await sospendi(1500);
}
log("gestionale finto aperto: ROSSI MARIO e BIANCHI ANNA");

// il ponte verso il ripetitore vero, e il QR (di nuovo con «qr» in comando.txt)
await sw.evaluate(() => ponteAvvia());
async function nuovoQr() {
  let qr = "";
  for (let i = 0; i < 40 && !qr; i++) {
    // (come «Associa l'iPhone» della pagina del ponte: una coppia nuova, poi il QR; il link vale finché non entra un telefono)
    qr = await sw.evaluate(async () => {
      if (!pt.host) return "";
      await ponteFine("nuova associazione");
      const ora = ponteOra();
      await ponteScriviCoppia({ k: PonteCripto.b64u(PonteCripto.casuale(32)), scade: ora + PONTE_DURATA, creata: ora, usata: false, dev: "", nTel: "" });
      ponteNota(`Nuovo QR (PC simulato): vale fino alle ${hhmmPonte(ora + PONTE_DURATA)}`);
      await ponteAvvia();
      return ponteQr();
    }).catch((e) => { log(`associa: ${String(e.message).split("\n")[0]}`); return ""; });
    if (!qr) await sospendi(500);
  }
  if (!qr) { log("niente QR: il ponte non si è avviato"); return ""; }
  writeFileSync(join(DIR, "qr.txt"), qr + "\n");
  writeFileSync(join(DIR, "qr.svg"), qrSvg(qr));
  log(`QR: ${qr}`);
  return qr;
}
if (!(await nuovoQr())) process.exit(1);

// lo stato, ogni 3 s: il ponte e il suo registro (per chi guarda da fuori)
let ultimo = "";
setInterval(async () => {
  try {
    const s = await sw.evaluate(() => chrome.storage.session.get("ponte").then((o) => o.ponte || null));
    const reg = (s?.registro || []).map((x) => `${x.ora || ""} ${x.testo}`);
    writeFileSync(join(DIR, "stato.json"), JSON.stringify({ relay: s?.relay, tel: s?.tel, registro: reg.slice(-40) }, null, 1));
    const nuovo = reg.slice(-1)[0] || "";
    if (nuovo && nuovo !== ultimo) { ultimo = nuovo; log(`ponte: ${nuovo}`); }
    // i comandi da fuori: «qr» (un QR nuovo), «foto» (le schermate del PC)
    const f = join(DIR, "comando.txt"), c = existsSync(f) ? readFileSync(f, "utf8").trim() : "";
    if (c) writeFileSync(f, "");
    if (c === "qr") await nuovoQr();
    if (c === "foto") {
      for (const [i, p] of ctx.pages().entries()) await p.screenshot({ path: join(DIR, `pc-${i}.png`) }).catch(() => {});
      log("foto del PC salvate");
    }
  } catch { /* il service worker dorme: al giro dopo */ }
}, 3000);
process.on("SIGINT", async () => { await ctx.close().catch(() => {}); process.exit(0); });
log("PC simulato acceso (Ctrl+C per spegnerlo)");
