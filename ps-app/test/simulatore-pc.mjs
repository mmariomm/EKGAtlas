#!/usr/bin/env node
/*
 * Il PC SIMULATO: l'estensione VERA in Chromium, davanti un gestionale finto
 * (gestionale-vero.mjs: dodici pazienti, esami e referti inventati), collegata al
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
// i pazienti finti (nomi, date e codici inventati): area, posto sulla mappa, referti
const PAZ = [
  { nome: "ROSSI MARIO", ep: "999001", cf: CF_A, triage: "ARANCIONE", nascita: "17/05/1949 (77) M", area: "alta", posto: ["alta", "a1"], referti: true },
  { nome: "BIANCHI ANNA", ep: "999002", cf: CF_B, triage: "VERDE", nascita: "", area: "alta", posto: ["alta", "as2"] },
  { nome: "ESPOSITO GIUSEPPE", ep: "999004", cf: "SPSGPP44D12F839Q", triage: "ROSSO", nascita: "12/04/1944 (82) M", area: "alta", posto: ["alta", "rossa"], referti: true },
  { nome: "MARINO GIULIA", ep: "999005", cf: "MRNGLI90P43F205T", triage: "AZZURRO", nascita: "03/09/1990 (36) F", area: "alta", posto: ["alta", "a2"] },
  { nome: "GRECO ANTONIO", ep: "999006", cf: "GRCNTN58A21F205E", triage: "ARANCIONE", nascita: "21/01/1958 (68) M", area: "alta", posto: ["alta", "box"], referti: true },
  { nome: "DE LUCA ELENA", ep: "999007", cf: "DLCLNE71H70F205W", triage: "AZZURRO", nascita: "30/06/1971 (55) F", area: "alta", posto: ["alta", "ab1"] },
  { nome: "VERDI LUCA", ep: "999003", cf: "VRDLCU85S08F205M", triage: "AZZURRO", nascita: "08/11/1985 (41) M", area: "bassa", posto: ["ps", "obi2"] },
  { nome: "COLOMBO FRANCESCA", ep: "999008", cf: "CLMFNC67B54F205R", triage: "VERDE", nascita: "14/02/1967 (59) F", area: "bassa", posto: ["ps", "oss1"] },
  { nome: "RICCI ANDREA", ep: "999009", cf: "RCCNDR01L02F205H", triage: "BIANCO", nascita: "02/07/2001 (25) M", area: "bassa", posto: ["ps", "attesa"] },
  { nome: "BRUNO SOFIA", ep: "999010", cf: "BRNSFO94T59F205C", triage: "VERDE", nascita: "19/12/1994 (31) F", area: "bassa" },
  { nome: "GALLO PAOLO", ep: "999011", cf: "GLLPLA39C05F205D", triage: "AZZURRO", nascita: "05/03/1939 (87) M", area: "bassa", posto: ["ps", "obi4"], referti: true },
  { nome: "FONTANA LAURA", ep: "999012", cf: "FNTLRA79M62F205N", triage: "VERDE", nascita: "22/08/1979 (47) F", area: "bassa" },
];
// un gestionale finto per paziente: le sue richieste in un intervallo suo di numeri
const MOCK = PAZ.map((x, i) => {
  const m = createMock({ name: x.nome, episodeId: x.ep, cf: x.cf, withResults: !!x.referti });
  m.state.nextRichiestaId = 700001 + i * 10000;
  return m;
});
const PER_EP = new Map(PAZ.map((x, i) => [x.ep, i]));
const A = MOCK[0];
const indice = (url) => {
  const p = new URL(url).searchParams;
  if (PER_EP.has(p.get("EPISODIO_ID"))) return PER_EP.get(p.get("EPISODIO_ID"));
  const i = Math.floor((Number(p.get("RICHIESTA_ID")) - 700001) / 10000);
  return i >= 0 && i < MOCK.length ? i : 0;
};
const quale = (url) => MOCK[indice(url)];
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
    const x = PAZ[indice(u)];
    const html = Buffer.from(out.body).toString("latin1").replace("<body>", "<body>" + riquadro(x.nome, x.triage, x.ep, x.cf, x.nascita));
    out = { ...out, body: Buffer.from(html, "latin1") };
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa */ }
});
const sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || await ctx.waitForEvent("serviceworker", { timeout: 15000 });

// il medico apre la pagina di ognuno (il pannello li conosce), e resta su ROSSI
const doc = ctx.pages()[0] || await ctx.newPage();
for (const m of [...MOCK.slice(1), A]) {
  await doc.goto(m.patientUrl);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 20000 });
  await sospendi(1200);
}
// e quello che il PC saprebbe dopo un turno: aree, posti, parametri, Da fare
await doc.evaluate((PAZ) => {
  const NS = "psassist:", ora = Date.now(), m = 60e3;
  const leggi = (k, d) => { try { return JSON.parse(localStorage.getItem(NS + k)) ?? d; } catch { return d; } };
  const scrivi = (k, v) => localStorage.setItem(NS + k, JSON.stringify(v));
  const membri = {}, n = { alta: 0, bassa: 0 };
  for (const x of PAZ) membri[x.ep] = { k: x.area, ts: ora, n: ++n[x.area] };
  scrivi("aree.v1", { membri, viste: { alta: { label: "AREA ALTA INTENSITA'", ts: ora }, bassa: { label: "AREA BASSA INTENSITA'", ts: ora } } });
  for (const k of ["alta", "ps"]) {
    const posti = {};
    for (const x of PAZ) if (x.posto && x.posto[0] === k) posti[x.ep] = { tipo: "letto", id: x.posto[1], ts: ora };
    scrivi(`stanza.${k}.posti.v1`, posti);
  }
  // i parametri: alcuni fuori norma, con la storia
  const vit = (ep, righe) => ({ p: righe[0][1], ts: ora - righe[0][0] * m, storia: righe.map(([min, p]) => ({ ts: ora - min * m, p })) });
  const S = leggi("stato.v1", {});
  const metti = (ep, v) => { S[ep] = { ...(S[ep] || {}), vit: v }; };
  metti("999004", vit("999004", [[10, { fr: 28, spo2: 88, fc: 124, pas: 88, pad: 52, t: 38.9 }], [70, { fr: 22, spo2: 92, fc: 108, pas: 102, pad: 60, t: 38.2 }]]));
  metti("999001", vit("999001", [[25, { fr: 20, spo2: 94, fc: 96, pas: 158, pad: 92, t: 37.4 }], [120, { fr: 18, spo2: 95, fc: 90, pas: 165, pad: 95, t: 37.1 }]]));
  metti("999006", vit("999006", [[15, { fr: 18, spo2: 97, fc: 52, pas: 176, pad: 98, t: 36.5 }]]));
  metti("999005", vit("999005", [[40, { fr: 16, spo2: 99, fc: 78, pas: 118, pad: 74, t: 36.6 }]]));
  metti("999003", vit("999003", [[20, { fr: 24, spo2: 93, fc: 112, pas: 104, pad: 66, t: 38.4 }], [90, { fr: 18, spo2: 96, fc: 88, pas: 120, pad: 78, t: 37.6 }]]));
  metti("999011", vit("999011", [[300, { fr: 16, spo2: 96, fc: 72, pas: 134, pad: 80, t: 36.4 }]]));
  metti("999008", vit("999008", [[35, { fr: 14, spo2: 98, fc: 70, pas: 126, pad: 82, t: 36.7 }]]));
  scrivi("stato.v1", S);
  // Da fare: dei pazienti (uno con l'orario) e generali
  const id = () => Math.random().toString(36).slice(2, 10);
  const alle = (min) => ora + min * m;
  const D = leggi("dafare.v1", {});
  const df = (ep, testo, t = null) => { (D[ep] = D[ep] || []).push({ id: id(), testo, t, fatto: null, ord: (D[ep] || []).length, ts: ora }); };
  df("999004", "emogasanalisi di controllo", alle(30));
  df("999004", "chiamare la rianimazione");
  df("999001", "rivalutare il dolore");
  df("999006", "ECG di controllo", alle(60));
  df("999003", "emocolture prima dell'antibiotico");
  df("999011", "sentire i familiari per la terapia a casa");
  df("999008", "rivalutare dopo la terapia", alle(45));
  scrivi("dafare.v1", D);
  scrivi("dafare.generale.v1", [{ id: id(), testo: "passaggio di consegne alle 20", fatto: null, ts: ora }, { id: id(), testo: "controllare i posti in OBI", fatto: null, ts: ora }]);
}, PAZ);
await doc.reload();
await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 20000 });
log(`gestionale finto aperto: ${PAZ.length} pazienti`);

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
