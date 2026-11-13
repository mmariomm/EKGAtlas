#!/usr/bin/env node
/*
 * La stampa automatica, con l'estensione VERA caricata in Chromium e un finto
 * aiutante di stampa (test/ospite-finto.mjs) registrato per il profilo di
 * prova come «native messaging host» — dove Chromium su Linux lo cerca:
 * <profilo>/NativeMessagingHosts/it.psassist.stampa.json. L'aiutante annota
 * ogni foglio che gli arriva: tipo, stampante, esito.
 * Le prove: senza aiutante non cambia niente (il dialogo di sempre); la pagina
 * delle impostazioni (non installata, poi le stampanti, l'A4 predefinita, la
 * rotazione delle etichette, le pagine di prova, l'ID fisso); i fogli che
 * vanno da soli alla loro stampante, senza dialogo e senza niente davanti
 * (li stampa il service worker, coi PDF da una scheda aperta dietro), una
 * volta sola; una conferma nella scheda del medico, che va subito altrove; una
 * richiesta fatta a mano, che non stampa; un foglio
 * che non esce passa dal dialogo, col motivo, e solo lui; l'aiutante sparito o
 * che non parte; niente interruttore (la «spenta» di prima migrata) e la stampantina in intestazione; l'ordine in
 * sottofondo che stampa mentre il medico è su un altro paziente e la sua
 * scheda non si vede, e «Ristampa»; l'ordine in sottofondo con un foglio che
 * non esce, che arriva al medico col motivo; l'aiutante che non risponde in
 * tempo («sconosciuto»: mai un secondo foglio dal dialogo); la scheda
 * dell'ordine ricaricata, chiusa o fermata col ⏹ mentre stampa; gli ordini dal
 * telefono, che non aprono mai da soli il dialogo; «Mandato»; la stampantina
 * «non installata».
 *   node test/ext-stampa.mjs [parola]
 */
import { chromium } from "playwright";
import { createMock } from "./gestionale-vero.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";

// (mai la rete vera: nessun proxy, ogni nome risolto in locale — il gestionale finto passa dalle route di Playwright)
const RETE_CHIUSA = ["--proxy-server=direct://", "--host-resolver-rules=MAP * 127.0.0.1"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-stampa-" + process.pid);
const FINTO = PROFILE + "-ospite";   // la cartella del finto aiutante: config e lavori
const SHOTS = process.env.TEST_SHOTS_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
mkdirSync(FINTO, { recursive: true });

function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`);
// i bottoni della striscia: nella striscia, o nel chip in intestazione a pannello aperto
const AZIONE = "#strazione, #psassist-host #gchipaz", STOP = "#strstop, #psassist-host #gchipstop, #psassist-host #stopbtn";
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
// Un ordine confermato dice «Confermata»: com'è andata la stampa è la frase
// sotto («Stampato su …»), e quello che le stava sotto scende alla riga dopo.
// Qui si legge la stampa com'è andata, per un ordine e per una ristampa.
const conStampa = (p) => !!p && p.titolo === "Confermata" && !!p.testo && !/^(Stampo|Etichette pronte|Fermo la stampa|L'etichetta anagrafica)/.test(p.testo);
const stampaDi = (p) => (!p ? "" : conStampa(p) ? p.testo : p.titolo);
const sottoDi = (p) => (!p ? "" : conStampa(p) ? String(p.dettaglio || "").split(" · ")[0] : p.testo);
const shot = async (page, nome) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, nome + ".png") }).catch(() => {}); };
const sospendi = (ms) => new Promise((res) => setTimeout(res, ms));

// ROSSI MARIO (999001) ha già una richiesta confermata, coi fogli nella
// sezione Stampa; BIANCHI ANNA (999002) è l'altro paziente.
let A, B;
const nuovi = () => {
  A = createMock({ seedConfirmed: true });
  B = createMock({ name: "BIANCHI ANNA", episodeId: "999002" });
  B.state.nextRichiestaId = 800001;
};
nuovi();
const quale = (url) => {
  const p = new URL(url).searchParams;
  if (p.get("EPISODIO_ID") === "999002" || Number(p.get("RICHIESTA_ID")) >= 800000) return B;
  return A;
};

// il finto aiutante: come si comporta, e che cosa ha stampato
const STAMPANTI = ["Zebra ZD421", "HP LaserJet A4", "Microsoft Print to PDF"];
const comportati = (extra = {}) => writeFileSync(join(FINTO, "config.json"), JSON.stringify({ stampanti: STAMPANTI, predefinita: "HP LaserJet A4", ...extra }));
const lavori = () => (existsSync(join(FINTO, "lavori.jsonl")) ? readFileSync(join(FINTO, "lavori.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
// (le due stampanti lavorano insieme: fra l'una e l'altra l'ordine non è detto, dentro ciascuna sì)
const lavoriPerStampante = () => { const l = lavori(); return [...l.filter((x) => x.tipo === "etichette"), ...l.filter((x) => x.tipo !== "etichette")]; };
const azzeraLavori = () =>rmSync(join(FINTO, "lavori.jsonl"), { force: true });
const lanciatore = join(FINTO, "ospite.sh");
writeFileSync(lanciatore, `#!/bin/sh\nPSA_FINTO='${FINTO}' exec '${process.execPath}' '${join(root, "test/ospite-finto.mjs")}' "$@"\n`);
chmodSync(lanciatore, 0o755);
comportati();

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean), ...RETE_CHIUSA],
});
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 })); } catch { /* niente */ }
});
// Qui si prova la stampa: il caricamento da solo all'apertura (che apre lo
// storico del portale in una scheda dietro) si dà per già fatto, o le «schede
// nuove» che le prove aspettano sarebbero la sua (lo prova ext-referti).
await ctx.addInitScript(() => {
  try {
    // la firma del laboratorio della pagina del banco (due referti del LIS), già letta
    const lab = JSON.stringify({ ris: [], ref: ["aaaa1111-0000-0000-0000-000000000001", "bbbb2222-0000-0000-0000-000000000002"], rich: [] });
    localStorage.setItem("psassist:autoCarica.v1", JSON.stringify({ 999001: { ts: Date.now(), lab, parz: Date.now() }, 999002: { ts: Date.now(), lab, parz: Date.now() } }));
  } catch { /* niente */ }
});
// le righe sotto la striscia, come si sono viste in ogni scheda del gestionale
// (nome, ✕, stampantina, verde/rosso, barretta): ogni stato nuovo, una volta
await ctx.addInitScript(() => {
  if (window.top !== window || location.origin !== "https://smarthealth.multimedica.it") return;
  setInterval(() => {
    try {
      const r = document.getElementById("psassist-host")?.shadowRoot;
      if (!r) return;
      const l = JSON.parse(localStorage.getItem("__psaRighe") || "[]");
      const visti = new Set(l.map((y) => JSON.stringify(y)));
      let nuovi = false;
      for (const el of r.querySelectorAll(".pjob")) {
        const pjn = el.querySelector(".pjn");
        const v = { n: (pjn?.getAttribute("aria-label") || pjn?.textContent || "").trim(), svg: !!pjn?.querySelector("svg"), x: !!el.querySelector(".pjx"),
          ico: el.querySelector(".pjico.pulsa") ? "pulsa" : el.querySelector(".pjico.fatto") ? "fatto" : "",
          ok: el.classList.contains("ok"), err: el.classList.contains("err"), w: el.querySelector(".pjbar i")?.style.width || "",
          att: !!el.querySelector(".pjx.att") };
        const s = JSON.stringify(v);
        if (!visti.has(s)) { visti.add(s); l.push(v); nuovi = true; }
      }
      if (nuovi) localStorage.setItem("__psaRighe", JSON.stringify(l.slice(-400)));
    } catch { /* niente */ }
  }, 40);
});
// quante volte si è aperta una stampa, in TUTTE le schede del gestionale
// (la scheda dell'ordine compresa: localStorage è dell'origine)
await ctx.addInitScript(() => {
  if (window.top !== window || location.origin !== "https://smarthealth.multimedica.it") return;
  setInterval(() => {
    try {
      const w = document.getElementById("psassist-print");
      if (w && !w.dataset.contato) {
        w.dataset.contato = "1";
        const l = JSON.parse(localStorage.getItem("__psaStampe") || "[]");
        l.push({ titolo: document.title });
        localStorage.setItem("__psaStampe", JSON.stringify(l));
      }
    } catch { /* niente */ }
  }, 25);
});
// i PDF dei fogli, come li chiede la scheda: quanti insieme (al massimo), e per
// le prove uno che si fa aspettare (`lento`) o uno che si rompe la prima volta (`rompi`)
const FOGLIO = /RcsStampaEtichetteLISHMIMU|uploaddownloadservlet|jasperservlet/;
const pdfVia = { vivi: 0, max: 0, lento: null, rompi: null, rotti: 0 };
const azzeraPdf = () => Object.assign(pdfVia, { vivi: 0, max: 0, lento: null, rompi: null, rotti: 0 });
// (una prova può ritoccare una risposta del banco: l'etichetta anagrafica)
let ritocca = null;
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  const u = req.url();
  if (FOGLIO.test(u)) {
    if (pdfVia.rompi && pdfVia.rompi.re.test(u) && pdfVia.rompi.volte > 0) {
      pdfVia.rompi.volte--; pdfVia.rotti++;
      await sospendi(300);
      return r.abort("failed").catch(() => {});
    }
    pdfVia.vivi++; pdfVia.max = Math.max(pdfVia.max, pdfVia.vivi);
    try { await sospendi(pdfVia.lento && pdfVia.lento.re.test(u) ? pdfVia.lento.ms : 400); } finally { pdfVia.vivi--; }
  }
  const mock = quale(u);
  let out = mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  if (ritocca) out = ritocca(u, out) || out;
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa intanto */ }
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const ID = new URL(sw.url()).host;
// (la chiave nel manifest: lo stesso ID su ogni PC, in Chrome e in Edge)
const ID_FISSO = "jhhlgabilanhhnncahahclcjbefaofij";
// l'aiutante «installato» (la chiave nel registro, su Windows) o no
const MANIFEST = join(PROFILE, "NativeMessagingHosts", "it.psassist.stampa.json");
const installa = (si) => {
  if (!si) return rmSync(MANIFEST, { force: true });
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify({ name: "it.psassist.stampa", description: "finto", path: lanciatore, type: "stdio", allowed_origins: [`chrome-extension://${ID}/`] }));
};
const scelte = (s) => sw.evaluate((x) => (x ? chrome.storage.local.set({ stampa: x }) : chrome.storage.local.remove(["stampa", "stampaEsito"])), s);
// l'aiutante che risponde più tardi di quanto l'estensione aspetta (90 s, qui ms)
const pazienza = (ms) => sw.evaluate((x) => {
  self.__ospite = self.__ospite || ospite;
  ospite = x ? (m, t) => self.__ospite(m, Math.min(t, x)) : self.__ospite;
}, ms);
// un ordine come lo manda il telefono (ponte-sw.js): un numero «tel…», dalla scheda davanti
const ordineTel = (id) => sw.evaluate(async ([u, id]) => {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const job = { id, ep: "999001", paziente: "ROSSI MARIO", n: 1, autoConfirm: true, url: u, nomi: ["TROPONINA US"],
    piano: { startPage: "patient", items: [{ res: "00660001P", code: "324", label: "TROPONINA ULTRASENSIBILE (POC3001)", display: "TROPONINA US" }],
      quesito: "dolore toracico", episodeId: "999001", patientName: "ROSSI MARIO", patientUrl: u, autoConfirm: true } };
  return new Promise((res) => ordMessaggio({ t: "ordineNuovo", job }, { tab: t, url: t.url }, res));
}, [A.patientUrl, id]);
const ordine = async (id) => (await ordini()).find((x) => x.id === id);
const memoria = () => sw.evaluate(() => chrome.storage.local.get(["stampa", "stampaEsito"]));
const ordini = () => sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []));
const nessunOrdine = () => sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
const stampe = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("__psaStampe") || "[]"));
const righeViste = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("__psaRighe") || "[]")).catch(() => []);
const azzeraRighe = (p) => p.evaluate(() => localStorage.setItem("__psaRighe", "[]"));
const azzeraStampe = (p) => p.evaluate(() => localStorage.setItem("__psaStampe", "[]"));
// la scheda della stampa, vista da fuori: a che punto è, quanti dialoghi ha aperto, la riga del motivo
const scheda = (p) => p.evaluate(() => {
  const w = document.getElementById("psassist-print");
  if (!w) return null;
  return { stato: w.dataset.stato || "", dialoghi: Number(w.dataset.printAttempts || 0), stampante: w.dataset.stampante || "", doc: w.dataset.doc || "",
    avviso: (w.shadowRoot.querySelector(".pwavv")?.textContent || "").trim(), dest: (w.shadowRoot.querySelector(".dest")?.textContent || "").trim(),
    nota: (w.shadowRoot.querySelector(".pwhint")?.textContent || "").trim() };
});
// finché la scheda della stampa non soddisfa `cond` (un'espressione su s = { stato, doc, stampante })
const aspettaScheda = async (p, cond, timeout = 20000) => {
  const h = await p.waitForFunction(`(() => {
    const w = document.getElementById("psassist-print");
    if (!w) return false;
    const s = { stato: w.dataset.stato || "", doc: w.dataset.doc || "", stampante: w.dataset.stampante || "" };
    return (${cond}) ? s : false;
  })()`, null, { timeout }).catch(() => null);
  return h ? h.jsonValue() : null;
};
const striscia = async (page, re, timeout = 30000) => {
  const h = await page.waitForFunction((src) => {
    const r = document.getElementById("psassist-host")?.shadowRoot;
    const t = (r?.querySelector(".pill.run")?.innerText || r?.querySelector(".gchip[data-riga]")?.dataset.riga || "").replace(/\s+/g, " ").trim();
    // un ordine finito di un altro paziente è un segno nella pill: un tocco lo apre (lo farebbe il medico)
    if (!t) { r?.querySelector("#expand .segno")?.click(); r?.querySelector("#gchipsegno")?.click(); }
    return new RegExp(src).test(t) ? t : false;
  }, re.source, { timeout }).catch(() => null);
  return h ? h.jsonValue() : "";
};
// l'esito di un altro paziente è un segno (nella pill, o accanto alla striscia): un tocco lo apre, come farebbe il medico
const apriSegno = (p) => p.waitForFunction(() => {
  const b = document.getElementById("psassist-host")?.shadowRoot?.querySelector("#strsegno, #gchipsegno, #expand .segno");
  if (!b) return false;
  b.click();
  return true;
}, null, { timeout: 10000 }).catch(() => {});
const azione = (p) => $panel(p, AZIONE).innerText().then((t) => t.trim()).catch(() => "");
// la striscia adesso (o il chip in intestazione), e le righe sotto: rossa?, «Ristampa»?, i ✕ (t: togli, v: visto)
const strisciaOra = (p) => p.evaluate(() => { const r = document.getElementById("psassist-host")?.shadowRoot; return (r?.querySelector(".pill.run")?.innerText || r?.querySelector(".gchip")?.dataset.riga || "").replace(/\s+/g, " ").trim(); }).catch(() => "");
const righeOra = (p) => p.evaluate(() => [...(document.getElementById("psassist-host")?.shadowRoot?.querySelectorAll(".pjob") || [])].map((el) => ({
  n: el.querySelector(".pjn")?.getAttribute("aria-label") || "", err: el.classList.contains("err"), rist: !!el.querySelector(".pjrist"),
  x: [...el.querySelectorAll(".pjx")].map((b) => `${b.getAttribute("data-pjx").split(":")[0]}|${b.title}`) }))).catch(() => []);
const conferme = (m) => m.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) { const v = await fn(); if (v) return v; }
  return null;
}
async function suPagina(p, url) {
  await p.goto(url);
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}
async function apriPannello(page) {
  if (!(await $panel(page, ".card").count())) {
    await $panel(page, "#expand").click({ position: { x: 12, y: 8 } });
    await page.waitForSelector("#psassist-host .card", { timeout: 8000 });
  }
  if (!(await $panel(page, "#q").count())) await $panel(page, '[data-seg="richieste"]').click();
  await $panel(page, "#q").waitFor({ timeout: 8000 });
}
// la sezione Stampa della pagina del paziente: etichette e lista della richiesta già confermata
async function ristampaDallaPagina(page, scheda = true) {
  await apriPannello(page);
  // (le richieste confermate si ristampano dal menu ⋯ → «Stampa le richieste»)
  await $panel(page, "#menubtn").click();
  await $panel(page, "#stampamenu").click();
  await $panel(page, '[data-print="699999"]').first().click();
  if (scheda) await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
}
// …con la stampa automatica: niente scheda, la stampa la fa il service worker,
// coi PDF da una scheda aperta dietro. Finita: com'è andata (l'ordine)
async function ristampaSenzaScheda(page) {
  const nasce = nuovaPagina();
  await ristampaDallaPagina(page, false);
  const dietro = await nasce;
  const rec = await finche(async () => (await ordini()).find((x) => x.stampa?.tag === "Stampa" && x.stato !== "stampo"), 40000);
  return { dietro, rec };
}
async function ordina(page, esami, soloCarrello = false) {
  await apriPannello(page);
  await $panel(page, "#q").fill("dolore toracico");
  for (const e of esami) await $panel(page, `.opt[title*="${e}"]`).click();
  await $panel(page, soloCarrello ? "#go" : "#goconfirm").click();
}
async function menu(page) {
  await apriPannello(page);
  await $panel(page, "#menubtn").click();
  await page.waitForSelector("#psassist-host .menu", { timeout: 5000 });
  return (await $panel(page, ".menu").innerText()).replace(/\s+/g, " ");
}
const stampantina = (page) => page.evaluate(() => {
  const b = document.getElementById("psassist-host")?.shadowRoot?.querySelector("#stauto");
  return b ? { titolo: b.title, ko: b.classList.contains("ko") } : null;
});
// il dialogo di stampa che si chiude (in Chromium senza finestra lo si annuncia come fa lui)
async function dialogoChiuso(p) {
  const prima = await p.evaluate(() => document.getElementById("psassist-print")?.dataset.doc || "");
  await p.waitForFunction(() => document.getElementById("psassist-print")?.dataset.stato === "stampo", null, { timeout: 25000 });
  await p.waitForTimeout(650);
  await p.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await p.waitForFunction((x) => {
    const w = document.getElementById("psassist-print");
    return !w || w.dataset.doc !== x;
  }, prima, { timeout: 8000 });
}
// Esc annulla la stampa a scheda aperta (mentre il PDF arriva è del gestionale);
// un foglio che aspetta il tuo tocco si toglie col ✕ della sua striscia
async function chiudiStampa(p) {
  await p.waitForFunction(() => { const w = document.getElementById("psassist-print"); return !w || !w.shadowRoot.querySelector(".pw").hidden || w.dataset.stato === "aspetta"; }, null, { timeout: 15000 }).catch(() => {});
  if (await p.evaluate(() => document.getElementById("psassist-print")?.dataset.stato === "aspetta").catch(() => false)) await $panel(p, STOP).first().click().catch(() => {});
  else await p.keyboard.press("Escape").catch(() => {});
  await p.waitForSelector("#psassist-print", { state: "detached", timeout: 5000 }).catch(() => {});
}
const nuovaPagina = (timeout = 15000) => ctx.waitForEvent("page", { timeout }).catch(() => null);
async function aspettaChiusa(p, timeout = 15000) {
  if (p.isClosed()) return true;
  await p.waitForEvent("close", { timeout }).catch(() => {});
  return p.isClosed();
}
const ATTIVA = { attiva: true, etichette: "Zebra ZD421", a4: "HP LaserJet A4" };

let doc = await ctx.newPage();   // la scheda del medico
const SOLO = (process.argv[2] || "").toLowerCase();
const prova = async (t) => {
  if (SOLO && !t.toLowerCase().includes(SOLO)) return false;
  console.log("\nstampa: " + t);
  nuovi(); azzeraLavori(); comportati(); azzeraPdf();
  await nessunOrdine();
  await pazienza(0);
  // la scheda del medico è quella davanti (le etichette che non escono arrivano lì)
  if (!doc.isClosed()) await doc.bringToFront();
  // (l'esito dell'ultima stampa, e la domanda «l'aiutante c'è?» di nuovo)
  await sw.evaluate(() => Promise.all([chrome.storage.local.remove(["stampaEsito", "stampaMisura", "stampaAiutante"]), chrome.storage.session.remove("stampaVerificata")]));
  return true;
};

// ---- 1. senza aiutante: niente cambia ------------------------------------
if (await prova("senza stampa automatica, il dialogo di sempre")) {
  installa(false);
  await scelte(null);
  await suPagina(doc, A.patientUrl);
  await ristampaDallaPagina(doc);
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const s = await scheda(doc);
  check(s && s.dialoghi === 1 && !s.avviso && /etichettatrice/.test(s.dest),
    `etichette: anteprima e dialogo di stampa, «→ etichettatrice», nessuna riga in più (got ${JSON.stringify(s)})`);
  check(lavori().length === 0, "all'aiutante non arriva niente");
  check(!(await stampantina(doc)), "in intestazione niente stampantina");
  await chiudiStampa(doc);
  const voci = await menu(doc);
  check(/Impostazioni/.test(await $panel(doc, "#stampanti").innerText()) && !/Stampa automatica/.test(voci) && !(await $panel(doc, "#stautosw").count()), `nel menu ⋯: «Impostazioni» (una voce sola, anche per il portale), non l'interruttore (got: ${voci})`);
  await $panel(doc, "#menubtn").click();
}

// ---- 1b. la ristampa a un tocco, in fondo alle Richieste --------------------
// Due strade sole: «Ristampa» (l'ultimo ordine, tutto) e «Altre…» (le
// richieste di prima, una per una, nella sezione Stampa).
if (await prova("ristampa a un tocco: «Ristampa» e «Altre…» in fondo alle Richieste")) {
  installa(false);
  await scelte(null);
  await suPagina(doc, A.patientUrl);
  await apriPannello(doc);
  const link = $panel(doc, ".bd .rpiede #stultima");
  check((await link.count()) === 1 && (await link.innerText()).trim() === "Ristampa" && /lnk/.test(await link.getAttribute("class")),
    "in fondo alle Richieste, un link quieto: «Ristampa»");
  await link.click();
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const s = await scheda(doc);
  check(s && s.dialoghi === 1 && /etichettatrice/.test(s.dest), `un tocco, e parte la stampa dell'ultimo ordine (got ${JSON.stringify(s)})`);
  await chiudiStampa(doc);
  // «Altre…»: la sezione Stampa, le richieste una per una (senza un secondo «Ristampa l'ultima»)
  const altre = $panel(doc, ".bd .rpiede #stampaltre");
  if (await altre.count()) {
    await altre.click();
    check((await $panel(doc, "[data-print]").count()) >= 1 && (await $panel(doc, ".bd #stultima").count()) === 0, "«Altre…»: le richieste una per una, e nient'altro");
  }
  await menu(doc);
  check((await $panel(doc, "#stampamenu").count()) === 1, "e ⋯ → «Stampa le richieste» resta, per tutte le altre");
  await $panel(doc, "#menubtn").click();
}

// ---- 2. la pagina delle impostazioni ---------------------------------------
let impostazioni = null;
if (await prova("le impostazioni: aiutante non installato, poi le due stampanti e le pagine di prova")) {
  installa(false);
  await scelte(null);
  await suPagina(doc, A.patientUrl);
  await menu(doc);
  const apre = nuovaPagina(8000);
  await $panel(doc, "#stampanti").click();
  impostazioni = await apre;
  check(!!impostazioni && /portale\.html$/.test(impostazioni.url()), `«Impostazioni» nel menu ⋯ apre le impostazioni (got ${impostazioni ? impostazioni.url().slice(-30) : "niente"})`);
  if (!impostazioni) { impostazioni = await ctx.newPage(); await impostazioni.goto(`chrome-extension://${ID}/portale.html`); }
  await impostazioni.setViewportSize({ width: 1366, height: 768 });
  const stato = () => impostazioni.locator("#sst").innerText().then((t) => t.trim());
  await impostazioni.waitForFunction(() => !/controllo/.test(document.getElementById("sst").textContent), null, { timeout: 15000 });
  check(await stato() === "Stampa automatica: non installata", `senza aiutante: «non installata» (got ${await stato()})`);
  const perche = (await impostazioni.locator("#sperche").innerText()).trim();
  check(/chrome:\/\/policy/.test(perche), `e sotto, dove guardare se l'hai appena installato: chrome://policy (got ${perche})`);
  check(await impostazioni.locator("#setic").isDisabled() && await impostazioni.locator("#sauto").count() === 0 && await impostazioni.locator("#sinst").getAttribute("open") !== null,
    "tendine spente (e nessun interruttore), e i tre passi per installare aperti");
  check(ID === ID_FISSO && (await impostazioni.locator("#sid, #sidcopia").count()) === 0,
    `l'ID è fisso (${ID_FISSO}, dalla chiave del manifest): niente ID da copiare per installa.cmd (got ${ID})`);
  installa(true);
  await impostazioni.click("#sric");
  await impostazioni.waitForFunction(() => /scegli le due/.test(document.getElementById("sst").textContent), null, { timeout: 15000 }).catch(() => {});
  check(await stato() === "Stampa automatica: scegli le due stampanti", `«Ricontrolla» con l'aiutante: ora chiede le stampanti (got ${await stato()})`);
  const opzioni = await impostazioni.locator("#setic option").allInnerTexts();
  check(JSON.stringify(opzioni) === JSON.stringify(["— scegli —", ...STAMPANTI]), `l'elenco delle stampanti di Windows (got ${opzioni.join(" | ")})`);
  check(await impostazioni.inputValue("#sa4") === "HP LaserJet A4" && (await memoria()).stampa?.a4 === "HP LaserJet A4",
    "l'A4 è già la predefinita di Windows, e salvata");
  await impostazioni.selectOption("#setic", "Zebra ZD421");
  await impostazioni.waitForFunction(() => /attiva$/.test(document.getElementById("sst").textContent), null, { timeout: 8000 }).catch(() => {});
  const m = (await memoria()).stampa || {};
  check(await stato() === "Stampa automatica: attiva" && m.etichette === "Zebra ZD421" && m.a4 === "HP LaserJet A4" && !("attiva" in m),
  `scelta l'etichettatrice: salvata, e la stampa automatica è attiva (got ${await stato()} · ${JSON.stringify(m)})`);
  await impostazioni.click("#sprovaetic");
  await impostazioni.waitForFunction(() => /mandata a/.test(document.getElementById("sm").textContent), null, { timeout: 15000 }).catch(() => {});
  const detto = (await impostazioni.locator("#sm").innerText()).trim();
  await impostazioni.click("#sprovaa4");
  await finche(() => lavori().length >= 2, 15000);
  const l = lavori();
  check(/Pagina di prova stampata su Zebra ZD421: controlla che sia uscita, dritta e intera/.test(detto) && l.length === 2 && l[0].tipo === "etichette" && l[0].stampante === "Zebra ZD421"
    && l[1].tipo === "a4" && l[1].stampante === "HP LaserJet A4" && l.every((x) => x.byte > 300),
  `«Stampa una pagina di prova»: un PDF vero a ciascuna (got ${detto} · ${JSON.stringify(l)})`);
  check(await impostazioni.inputValue("#sruota") === "no" && l[0].ruota === "no" && JSON.stringify(l[0].pagina) === "[142,71]",
    `una Zebra: le etichette di partenza non si girano («ruota: no»), e la pagina di prova è un'etichetta di 50×25 mm (got ${l[0].ruota} · ${JSON.stringify(l[0].pagina)})`);
  await shot(impostazioni, "impostazioni-due-stampanti");
}

// ---- 2b. la forma del pannello: in Impostazioni, non nel menu ⋯ --------------
// (Al passaggio · Affianca; ogni scheda del gestionale la segue subito)
if (await prova("la forma del pannello si sceglie in Impostazioni, e la scheda la segue")) {
  const formaSw = () => sw.evaluate(() => chrome.storage.local.get("forma").then((o) => o.forma));
  installa(false);
  await scelte(null);
  await sw.evaluate(() => chrome.storage.local.remove("forma"));
  // una scheda del portale aperta per prima dopo l'aggiornamento (un'altra origine, con una memoria
  // sua, vuota) non sceglie la forma per il gestionale: la scelta di prima la porta solo il gestionale
  await ctx.route("http://10.11.0.151/**", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: "<!doctype html><title>Portale</title><body><p>portale</p></body>" }));
  const por = await ctx.newPage();
  await por.goto("http://10.11.0.151/clin-port/elenco-documenti");
  const giraLi = await por.waitForSelector("#psassist-attesa", { state: "attached", timeout: 8000 }).then(() => true).catch(() => false);
  check(giraLi && (await formaSw()) === undefined, `una scheda del portale aperta per prima (lì l'estensione gira: ${giraLi}) non scrive la forma (got ${await formaSw()})`);
  await por.close();
  await ctx.unroute("http://10.11.0.151/**");
  await suPagina(doc, A.patientUrl);
  await doc.evaluate(() => { localStorage.removeItem("psassist:forma.v1"); localStorage.removeItem("psassist:win.v1"); });
  await suPagina(doc, A.patientUrl);
  const voci = await menu(doc);
  check(!/Forma|Affianca|Al passaggio|Al centro/.test(voci), `nel menu ⋯ niente Forma (got: ${voci})`);
  await $panel(doc, "#menubtn").click();
  // (una scheda delle Impostazioni sua, chiusa alla fine: quella delle prove di stampa resta com'era,
  // con le stampanti che l'aiutante le ha detto — qui l'aiutante non c'è)
  const pan = await ctx.newPage();
  await pan.goto(`chrome-extension://${ID}/portale.html`);
  const premuto = () => pan.evaluate(() => [...document.querySelectorAll("#pannello [data-forma]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.forma).join());
  await finche(async () => (await formaSw()) === "passaggio", 5000);
  await pan.reload();
  await pan.waitForFunction(() => document.querySelector('#pannello [aria-pressed="true"]'), null, { timeout: 5000 }).catch(() => {});
  check((await formaSw()) === "passaggio" && (await premuto()) === "passaggio" && /pill/.test(await pan.locator("#formadice").innerText()),
    `Impostazioni → Il pannello: la forma di adesso, Al passaggio (scritta dal pannello: got ${(await formaSw())} · ${await premuto()})`);
  await pan.click('#pannello [data-forma="affianca"]');
  const colonna = () => doc.evaluate(() => {
    const w = document.getElementById("psassist-host")?.shadowRoot?.querySelector(".wrap.win");
    const r = w && w.getBoundingClientRect();
    return { f: JSON.parse(localStorage.getItem("psassist:forma.v1") || "null"), l: r ? Math.round(r.left) : null, w: r ? Math.round(r.width) : null, vw: innerWidth };
  });
  await doc.bringToFront();
  const c1 = await finche(async () => { const c = await colonna(); return c.f === "affianca" && c.l > c.vw * 0.6 ? c : null; }, 5000);
  check(!!c1 && c1.w < c1.vw * 0.4 && (await premuto()) === "affianca", `scelta Affianca, la scheda del gestionale la segue subito: la colonna a destra (got ${JSON.stringify(c1 || await colonna())})`);
  await pan.click('#pannello [data-forma="passaggio"]');
  const c2 = await finche(async () => { const c = await colonna(); return c.f === "passaggio" && c.l < c.vw * 0.2 ? c : null; }, 5000);
  check(!!c2, `di nuovo Al passaggio: la finestra torna al centro (got ${JSON.stringify(c2 || await colonna())})`);
  await shot(pan, "impostazioni-pannello");
  await pan.close();
  // com'era prima, per le prove qui sotto: nessuna forma scelta, e la finestra a destra (quella che
  // mette l'init script, se manca): Al passaggio al centro, il mouse «via» delle prove le starebbe sopra
  await sw.evaluate(() => chrome.storage.local.remove("forma"));
  await doc.evaluate(() => { localStorage.removeItem("psassist:forma.v1"); localStorage.removeItem("psassist:win.v1"); });
}

// ---- 3. i fogli vanno da soli alla loro stampante -------------------------
// (niente davanti al medico: né la scheda né l'anteprima — la stampa la fa il
// service worker, coi PDF che gli dà una scheda aperta dietro)
if (await prova("stampa automatica: etichette all'etichettatrice, lista all'A4, niente davanti")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 1200 });   // (il tempo di leggere la striscia mentre «stampa»)
  await suPagina(doc, A.patientUrl);
  await apriPannello(doc);
  await azzeraStampe(doc);
  const st = await finche(() => stampantina(doc), 5000);
  check(st && !st.ko && st.titolo === "Stampa automatica attiva: etichette su Zebra ZD421, A4 su HP LaserJet A4",
    `in intestazione la stampantina, che dice dove vanno i fogli (got ${JSON.stringify(st)})`);
  const nasce = nuovaPagina();
  await ristampaDallaPagina(doc, false);
  const dietro = await nasce;
  check(!!dietro, "i PDF li prende una scheda aperta dietro");
  // le due stampanti lavorano insieme: i due PDF si prendono insieme, e ognuno parte appena c'è
  const str = await striscia(doc, /Stampo le etichette su Zebra ZD421 e la lista esami su HP LaserJet A4…/, 15000);
  check(/ROSSI MARIO/.test(str) && /Stampa/.test(str) && /fogli 1 e 2 di 2/.test(str),
    `la striscia: «Stampa · Stampo le etichette su Zebra ZD421 e la lista esami su HP LaserJet A4… · fogli 1 e 2 di 2» (got ${str || await striscia(doc, /./, 1000)})`);
  await shot(doc, "stampo-su-etichettatrice");
  check(pdfVia.max >= 2, `i PDF delle etichette e della lista si prendono insieme (al massimo ${pdfVia.max} in volo)`);
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli), 30000);
  check(!!rec && stampaDi(rec.pubblico) === "Stampato su Zebra ZD421 e HP LaserJet A4" && /^Richiesta 699999 alle \d\d:\d\d$/.test(sottoDi(rec.pubblico))
    && rec.fogli.every((f) => f.stato === "stampato"),
  `«Stampato su Zebra ZD421 e HP LaserJet A4 · Richiesta 699999 alle HH:MM», foglio per foglio (got ${JSON.stringify(rec && rec.pubblico)})`);
  const fine = await striscia(doc, /Stampato su/, 8000);
  check(/Stampato su Zebra ZD421 e HP LaserJet A4/.test(fine) && (await azione(doc)) === "Ristampa", `e la striscia lo dice, con «Ristampa» (got ${fine})`);
  check((await stampe(doc)).length === 0 && (await doc.locator("#psassist-print").count()) === 0, "nessuna scheda di stampa, nessuna anteprima: mai");
  check(await aspettaChiusa(dietro), "la scheda dei PDF, finito, si chiude");
  await sospendi(1000);
  const l = lavori();
  // (le due stampanti lavorano insieme: chi finisce prima non è detto)
  const et = l.find((x) => x.tipo === "etichette") || {};
  check(l.length === 2 && et.stampante === "Zebra ZD421" && l.some((x) => x.tipo === "a4" && x.stampante === "HP LaserJet A4"),
    `all'aiutante: etichette → Zebra, lista → HP, una volta ciascuna (got ${JSON.stringify(l.map((x) => `${x.tipo}→${x.stampante}`))})`);
  check(et.ruota === "no", `le etichette alla Zebra con «ruota: no» (got ${et.ruota})`);
  if (impostazioni && !impostazioni.isClosed()) {
    azzeraLavori();
    await impostazioni.click("#sprovaetic");
    await finche(() => lavori().length === 1, 15000);
    check(JSON.stringify(lavori()[0]?.pagina) === "[200,100]", `la pagina di prova delle etichette ora ha la misura dell'etichetta vera (got ${JSON.stringify(lavori()[0]?.pagina)})`);
    azzeraLavori();
  }
  const reg = await doc.evaluate(() => (JSON.parse(sessionStorage.getItem("psassist:log.999001") || "{}").lines || []).join("\n"));
  check(/Etichette provette, Lista esami: alla stampa automatica, senza anteprima/.test(reg), "il Registro dice che i fogli sono andati alla stampa automatica");
  // un modulo di consenso va all'A4: un file dell'estensione, nessuna scheda da aprire
  azzeraLavori();
  await nessunOrdine();
  await apriPannello(doc);
  await $panel(doc, '[data-seg="dimissioni"]').click();   // (i Consensi stanno nelle Dimissioni)
  const altra = nuovaPagina(4000);
  await $panel(doc, ".consensi [data-cons]").first().click();
  const c = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli), 20000);
  check(lavori().length === 1 && lavori()[0].tipo === "a4" && lavori()[0].stampante === "HP LaserJet A4" && lavori()[0].byte > 1000
    && !!c && stampaDi(c.pubblico) === "Stampato su HP LaserJet A4",
  `un consenso dalle Dimissioni → A4, «Stampato su HP LaserJet A4» (got ${JSON.stringify(lavori())} · ${JSON.stringify(c && c.pubblico)})`);
  check(!(await altra) && (await stampe(doc)).length === 0, "senza scheda dietro e senza anteprima");
}

// ---- 3b. una conferma nella scheda del medico: niente davanti, e lui va via subito
// (la richiesta rimasta da confermare, confermata dalla sua riga: il clic
// vero sulla Conferma del gestionale; dopo, la pagina del paziente coi fogli)
if (await prova("una conferma nella scheda del medico: la striscia, nessuna anteprima, e il medico può andare via subito")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 1500 });
  await suPagina(doc, A.patientUrl);
  let nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"], true);   // solo carrello: la richiesta resta da confermare
  await nasce;
  const carrello = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.consegna?.url), 60000);
  check(!!carrello, "(solo carrello: la richiesta è nel carrello, da confermare)");
  await nessunOrdine();
  await suPagina(doc, carrello.consegna.url);
  if (!(await $panel(doc, ".card").count())) await $panel(doc, "#expand").click({ position: { x: 12, y: 8 } });
  await $panel(doc, "#dcconferma").waitFor({ timeout: 10000 });
  await $panel(doc, "#dcconferma").click();   // il primo tocco legge il carrello
  await finche(async () => /Confermo 1 esame/.test(await $panel(doc, "#dcconferma").innerText().catch(() => "")), 10000);
  await azzeraStampe(doc);
  azzeraLavori();
  nasce = nuovaPagina();
  await $panel(doc, "#dcconferma").click();   // il secondo: la Conferma del gestionale
  await doc.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 20000 });
  const dietro = await nasce;
  const str = await striscia(doc, /Stampo le etichette su Zebra ZD421…/, 15000);
  check(/Confermata/.test(str) && /1 esame confermato/.test(str), `confermata: «Confermata · Stampo le etichette su Zebra ZD421… · 1 esame confermato» (got ${str || await striscia(doc, /./, 1000)})`);
  check((await stampe(doc)).length === 0, "nessuna scheda di stampa davanti");
  await suPagina(doc, B.patientUrl);   // il medico va subito su un altro paziente
  const rec = await finche(async () => (await ordini()).find((x) => x.stampa?.tag === "Confermata" && x.stato === "avviso" && x.fogli), 40000);
  const rid = String(Object.keys(A.state.richieste).find((r) => r !== "699999"));
  check(!!rec && A.state.richieste[rid]?.confirmed === true && conferme(A).length === 1,
    `la richiesta è confermata, una volta${rec ? "" : ` (got ${JSON.stringify((await ordini()).map((x) => [x.stato, x.pubblico, x.interrotta]))})`}`);
  check(!!rec && stampaDi(rec.pubblico) === "Stampato su Zebra ZD421 e HP LaserJet A4" && /^1 esame confermato alle \d\d:\d\d$/.test(sottoDi(rec.pubblico)),
    `«Stampato su Zebra ZD421 e HP LaserJet A4 · 1 esame confermato alle HH:MM» (got ${JSON.stringify(rec && rec.pubblico)})`);
  // Finito, sulla pagina di BIANCHI: non una striscia che prende il posto della sua
  // pill, ma «✓ ROSSI M.» dentro la pill di BIANCHI; un tocco apre l'esito
  const segnoOk = await doc.waitForFunction(() => {
    const r = document.getElementById("psassist-host")?.shadowRoot;
    const s = r?.querySelector("#expand .segno");
    return s && !r.querySelector(".pill.run") ? s.textContent.replace(/\s+/g, " ").trim() : false;
  }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => "");
  check(segnoOk === "✓ ROSSI M." && /BIANCHI/.test(await $panel(doc, "#expand").innerText().catch(() => "")),
    `sulla pagina di BIANCHI, l'ordine finito di ROSSI è «✓ ROSSI M.» nella pill di BIANCHI, niente striscia (got ${segnoOk || "niente"})`);
  // il mouse sulla pill: la finestra si apre come sempre (con una striscia non succedeva)
  await $panel(doc, "#expand").hover({ position: { x: 14, y: 8 } });
  await doc.waitForSelector("#psassist-host .card", { timeout: 4000 }).catch(() => {});
  check(await $panel(doc, ".card").count() === 1 && /ROSSI M\./.test(await $panel(doc, "#gchipsegno").innerText().catch(() => "")),
    "il mouse sulla pill apre la finestra, e il segno diventa un chip in intestazione");
  await doc.mouse.move(300, 600);   // via il mouse: la finestra «al passaggio» si richiude
  await doc.waitForSelector("#psassist-host .card", { state: "detached", timeout: 6000 }).catch(() => {});
  await $panel(doc, "#expand .segno").click({ timeout: 5000 });
  const fine = await striscia(doc, /Stampato su/, 8000);
  check(/ROSSI MARIO/.test(fine), `un tocco sul segno: la striscia dice di ROSSI: «Stampato su …» (got ${fine})`);
  await sospendi(1500);
  const l = lavoriPerStampante();
  check(l.length === 2 && l[0].tipo === "etichette" && l[1].tipo === "a4", `i due fogli, una volta ciascuno, anche col medico altrove (got ${JSON.stringify(l.map((x) => x.tipo))})`);
  check((await stampe(doc)).length === 0, "e nessuna anteprima, in nessuna scheda");
  check(!!dietro && await aspettaChiusa(dietro), "la scheda dei PDF si è chiusa");
}

// ---- 3b'. il segno dell'ordine di un altro paziente: com'è, quanti, e il tocco ----
// (✓ solo per «Confermata»: un carrello pronto non è fatto; due ordini dicono
// «+1»; un tocco lo apre anche con un altro ordine che gira qui)
if (await prova("il segno dell'ordine di un altro paziente: ⚠ per un carrello pronto, «+1» per il secondo, e il tocco lo apre")) {
  installa(false);
  await scelte(null);
  await suPagina(doc, B.patientUrl);
  const ora = Date.now();
  const base = { ep: "999001", paziente: "ROSSI MARIO", n: 1, ts: ora, agg: ora, worker: null, resto: { mancano: [], controllare: [], nel: ["TROPONINA US"] } };
  const scrivi = (l) => sw.evaluate((x) => ordScrivi(x), l);
  const segnoPill = () => doc.evaluate(() => (document.getElementById("psassist-host")?.shadowRoot?.querySelector("#expand .segno")?.textContent || "").replace(/\s+/g, " ").trim());
  // «solo carrello»: l'esame è nel carrello, la Conferma no
  await scrivi([{ ...base, id: "pccarr0001", stato: "avviso", vista: { tag: "✓ 1 esame in carrello", testo: "Conferma dal gestionale", tono: "ok" } }]);
  const carr = await finche(async () => (await segnoPill()) || false, 8000);
  check(/^⚠ ROSSI M\.$/.test(carr || ""), `un carrello pronto, non confermato: «⚠ ROSSI M.», mai «✓» (got «${carr || "niente"}»)`);
  // due ordini finiti dello stesso paziente: il più serio, e «+1»
  await scrivi([{ ...base, id: "pccarr0001", stato: "avviso", vista: { tag: "✓ 1 esame in carrello", testo: "Conferma dal gestionale", tono: "ok" } },
    { ...base, id: "pcerr0002", stato: "errore", agg: ora + 1, vista: { tag: "Non partita", testo: "niente inviato: riprova", tono: "err", quesito: "la scheda per l'ordine non si è aperta" } }]);
  const due = await finche(async () => { const t = await segnoPill(); return /\+1/.test(t) ? t : false; }, 8000);
  check(/^✕ ROSSI M\. \+1$/.test(due || ""), `due ordini finiti: il più serio, «✕ ROSSI M. +1» (got «${due || await segnoPill()}»)`);
  // due richieste dello STESSO tocco su Conferma (POC e RX): un ordine, niente «+1» — i tocchi, come la riga sola (gestoDi)
  await scrivi([{ ...base, id: "pcgesto0001", gesto: "guno", stato: "avviso", vista: { tag: "Confermata", testo: "Stampato su Zebra ZD421", tono: "ok" } },
    { ...base, id: "pcgesto0002", gesto: "guno", stato: "errore", agg: ora + 1, vista: { tag: "Non partita", testo: "apri il carrello", tono: "err" } }]);
  const uno = await finche(async () => { const t = await segnoPill(); return /^✕ ROSSI M\.$/.test(t) ? t : false; }, 8000);
  check(!!uno, `due richieste dello stesso tocco: un ordine, «✕ ROSSI M.» senza «+1» (got «${uno || await segnoPill()}»)`);
  // un ordine di BIANCHI che gira qui, e il segno di ROSSI accanto: il tocco apre ROSSI, non lo piega
  const wid = await sw.evaluate(() => chrome.tabs.query({}).then((l) => l.find((t) => !/smarthealth/.test(t.url || ""))?.id));
  await scrivi([{ ...base, id: "pcerr0002", stato: "errore", vista: { tag: "Non partita", testo: "niente inviato: riprova", tono: "err", quesito: "la scheda per l'ordine non si è aperta" } },
    { id: "pcgira0001", ep: "999002", paziente: "BIANCHI ANNA", n: 2, stato: "corre", ts: ora, agg: ora, worker: wid, vista: { tag: "", badge: "2 esami", testo: "esame 1 di 2", tono: "run", prog: [1, 2] },
      resto: { mancano: ["EMOCROMO"], controllare: [], nel: [] } }]);
  const accanto = await doc.waitForFunction(() => document.getElementById("psassist-host")?.shadowRoot?.querySelector("#strsegno, #gchipsegno"), null, { timeout: 8000 }).catch(() => null);
  check(!!accanto, "accanto alla striscia di BIANCHI che gira, il segno di ROSSI");
  await doc.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector("#strsegno, #gchipsegno")?.click());
  const aperta = await doc.waitForFunction(() => {
    const r = document.getElementById("psassist-host")?.shadowRoot;
    const t = (r?.querySelector(".pill.run")?.innerText || r?.querySelector(".gchip")?.dataset.riga || "").replace(/\s+/g, " ").trim();
    return /ROSSI MARIO/.test(t) && /Non partita/.test(t) ? t : false;
  }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => "");
  check(!!aperta, `un tocco sul segno: la striscia è quella di ROSSI, «Non partita» — non piegata dietro l'ordine che gira (got «${aperta || "niente"}»)`);
  // un ordine di BIANCHI entrato in coda PRIMA del tocco ma partito DOPO: vince lui (il suo ⏹ a vista), quello toccato si piega accanto
  const dopoTocco = Date.now() + 1;
  await scrivi([{ ...base, id: "pcerr0002", stato: "errore", vista: { tag: "Non partita", testo: "niente inviato: riprova", tono: "err", quesito: "la scheda per l'ordine non si è aperta" } },
    { id: "pcgira0002", ep: "999002", paziente: "BIANCHI ANNA", n: 2, stato: "corre", ts: ora, partito: dopoTocco, agg: dopoTocco, worker: wid, vista: { tag: "", badge: "2 esami", testo: "esame 1 di 2", tono: "run", prog: [1, 2] },
      resto: { mancano: ["EMOCROMO"], controllare: [], nel: [] } }]);
  const vince = await doc.waitForFunction(() => {
    const r = document.getElementById("psassist-host")?.shadowRoot;
    const t = (r?.querySelector(".pill.run")?.innerText || r?.querySelector(".gchip")?.dataset.riga || "").replace(/\s+/g, " ").trim();
    return /BIANCHI ANNA/.test(t) && !/Non partita/.test(t) ? t : false;
  }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => "");
  check(!!vince, `in coda prima del tocco, partito dopo: la striscia è sua, quella toccata si piega (got «${vince || "niente"}»)`);
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
}

// ---- 3c. una richiesta fatta tutta a mano: la sua Conferma non stampa ------
// (stampa solo quello che ha ordinato PS Assist, anche con la stampa automatica)
if (await prova("una richiesta fatta tutta a mano, confermata dal gestionale: niente stampa")) {
  installa(true);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  await doc.click('a[title="Richieste Laboratorio"]');
  await doc.fill('form[name="RICHIESTACrea"] textarea[name="QUESITO_DIAGNOSTICO"]', "febbre");
  await doc.click('form[name="RICHIESTACrea"] input[name="Update"]');
  await doc.waitForSelector('form[name="Prestazioni"]', { timeout: 20000 });
  await doc.click('a.AFCDataLink[href*="Insert=Inserisci"][href*="PRESTAZIONE=320&"]');
  await doc.waitForFunction(() => /Delete=/.test(document.body.innerHTML), null, { timeout: 15000 });
  await doc.waitForSelector("#psassist-host", { state: "attached" });
  const rid = Object.keys(A.state.richieste).find((r) => r !== "699999");
  const nasce = nuovaPagina(6000);
  await doc.click('form[name="Prestazioni"] input[name="Update"]');
  await doc.waitForSelector('a[title="Richieste Laboratorio"]', { timeout: 20000 });
  await sospendi(3000);
  check(A.state.richieste[rid]?.confirmed === true && conferme(A).length === 1, "confermata dal gestionale, una volta");
  check(!(await nasce) && (await ordini()).length === 0 && lavori().length === 0 && (await stampe(doc)).length === 0,
    `niente si stampa: nessuna scheda, nessun foglio all'aiutante (got ${lavori().length} fogli)`);
}

// ---- 4. un foglio che non esce: solo lui passa dal dialogo ----------------
if (await prova("un errore su un foglio: quel foglio dal dialogo, col motivo; gli altri da soli")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ rompi: { "Zebra ZD421": "la stampante (o il suo driver) ha dato errore" }, lento: 400 });
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  await ristampaDallaPagina(doc, false);
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const s = await scheda(doc);
  check(s && /^Stampa 1 di 1 — Etichette/.test(s.doc) && s.dialoghi === 1 && s.avviso === "Stampa automatica non riuscita: la stampante (o il suo driver) ha dato errore. Dal dialogo, stavolta."
    && /etichettatrice/.test(s.dest),
  `solo le etichette: la riga col motivo, e il dialogo di sempre (got ${JSON.stringify(s)})`);
  const l = lavoriPerStampante();
  check(l.length === 2 && !l[0].ok && l[0].stampante === "Zebra ZD421" && l[1].ok && l[1].stampante === "HP LaserJet A4",
    `la lista è già uscita da sola all'A4; le etichette no (got ${JSON.stringify(l)})`);
  await shot(doc, "riga-del-motivo");
  await dialogoChiuso(doc);
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});
  check(lavori().length === 2 && (await stampe(doc)).length === 1, "la lista non si ristampa, e la scheda si è aperta una volta, per le etichette");
  const err = ((await sw.evaluate(() => chrome.storage.local.get("errori.v1")))["errori.v1"] || []).filter((x) => x.tipo === "stampa");
  check(err.some((x) => x.dati.esito === "fallito" && x.dati.tipo === "etichette") && !/ROSSI|MARIO|BIANCHI/.test(JSON.stringify(err)),
    `il foglio non uscito sta nel registro degli errori, senza nomi (got ${JSON.stringify(err.slice(-1)).slice(0, 160)})`);
}

// ---- 5. l'aiutante sparito ----------------------------------------------
if (await prova("aiutante disinstallato con le stampanti ancora scelte: dialogo, e perché")) {
  installa(false);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  await ristampaDallaPagina(doc, false);
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const s = await scheda(doc);
  check(s && /^Stampa 1 di 2/.test(s.doc) && s.dialoghi === 1 && /non riuscita: l'aiutante di stampa non è installato su questo PC.*chrome:\/\/policy/.test(s.avviso),
    `il dialogo di sempre, con la riga «l'aiutante di stampa non è installato su questo PC», e dove guardare (chrome://policy) (got ${JSON.stringify(s)})`);
  await chiudiStampa(doc);
  await nessunOrdine();
  await apriPannello(doc);
  const rossa = await finche(async () => { const x = await stampantina(doc); return x && x.ko ? x : null; }, 5000);
  check(!!rossa && /non installata/.test(rossa.titolo), `la stampantina in intestazione è rossa, e dice perché (got ${JSON.stringify(rossa)})`);
  // installato, ma Windows non lo lascia partire: le parole esatte di Chrome
  // su Windows (qui, su Linux, un aiutante che non parte «esce» e basta)
  const parte = await sw.evaluate(() => ospiteErrore(new Error("Failed to start native messaging host.")));
  check(/l'aiutante di stampa non è partito/.test(parte.why) && !parte.ignoto,
    `«Failed to start native messaging host.» → in italiano, e il foglio passa dal dialogo (non è partito niente) (got ${JSON.stringify(parte)})`);
  // installato per un'altra copia dell'estensione (ricaricata da un'altra cartella: l'ID cambia)
  installa(true);
  writeFileSync(MANIFEST, readFileSync(MANIFEST, "utf8").replace(ID, "a".repeat(32)));
  await ristampaDallaPagina(doc, false);
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const f = await scheda(doc);
  check(f && f.dialoghi === 1 && /Chrome non permette di usare l'aiutante di stampa.*rilancia installa\.cmd/.test(f.avviso),
    `un altro ID: il dialogo, e «rilancia installa.cmd» (got ${f && f.avviso})`);
  await chiudiStampa(doc);
}

// ---- 6. niente interruttore: scelte le due stampanti, la stampa è automatica ----
// L'interruttore di prima della 3.86 se ne va dalla memoria. Un PC che l'aveva
// spento resta col dialogo del browser, com'era, finché non risceglie le
// stampanti in Impostazioni (se ne vanno anche i loro nomi); uno acceso resta automatico.
const impostazioniDicono = async () => {
  if (!impostazioni || impostazioni.isClosed()) { impostazioni = await ctx.newPage(); await impostazioni.goto(`chrome-extension://${ID}/portale.html`); }
  else await impostazioni.reload();
  await impostazioni.waitForFunction(() => !/controllo/.test(document.getElementById("sst").textContent), null, { timeout: 15000 }).catch(() => {});
  return { interruttore: await impostazioni.locator("#sauto").count(), stato: (await impostazioni.locator("#sst").innerText()).trim() };
};
if (await prova("niente interruttore: la stampa automatica «spenta» di prima resta col dialogo, l'«accesa» resta automatica")) {
  installa(true);
  // (una stazione dell'infermeria le sue stampanti le usava comunque, per gli altri: le tiene)
  await sw.evaluate((s) => chrome.storage.local.set({ stampa: s, "stazione.qui": { dal: Date.now(), conferma: true } }), { ...ATTIVA, attiva: false });
  await sw.evaluate(() => stampaMigra());
  const sta = (await memoria()).stampa || {};
  await sw.evaluate(() => chrome.storage.local.remove("stazione.qui"));
  check(!("attiva" in sta) && sta.etichette === ATTIVA.etichette && sta.a4 === ATTIVA.a4, `«spenta» su una stazione: l'interruttore se ne va, le stampanti restano (got ${JSON.stringify(sta)})`);
  // (una stazione revocata, o associata a metà, non è una stazione: come per chiunque altro)
  for (const [come, q] of [["revocata", { dal: Date.now(), conferma: true, revoca: Date.now() }], ["associata a metà", { dal: Date.now() }]]) {
    await sw.evaluate(([s, x]) => chrome.storage.local.set({ stampa: s, "stazione.qui": x }), [{ ...ATTIVA, attiva: false }, q]);
    await sw.evaluate(() => stampaMigra());
    const st = (await memoria()).stampa || {};
    await sw.evaluate(() => chrome.storage.local.remove("stazione.qui"));
    check(!("attiva" in st) && !st.etichette && !st.a4, `«spenta» su una stazione ${come}: via l'interruttore e i nomi delle stampanti (got ${JSON.stringify(st)})`);
  }
  await scelte({ ...ATTIVA, attiva: false, ruota: "no" });
  await sw.evaluate(() => stampaMigra());
  let m = (await memoria()).stampa || {};
  check(!("attiva" in m) && !m.etichette && !m.a4 && m.ruota === "no",
    `«spenta»: l'interruttore se ne va, e con lui i nomi delle due stampanti; il resto resta (got ${JSON.stringify(m)})`);
  await suPagina(doc, A.patientUrl);
  const voci = await menu(doc);
  check(!(await $panel(doc, "#stautosw").count()) && !/Stampa automatica/.test(voci), `nel menu ⋯ niente interruttore «Stampa automatica» (got: ${voci})`);
  await $panel(doc, "#menubtn").click();
  check(!(await stampantina(doc)), "in intestazione niente stampantina: non è automatica");
  await ristampaDallaPagina(doc);
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const s = await scheda(doc);
  check(s && s.dialoghi === 1 && lavori().length === 0, `la ristampa passa dal dialogo del browser, come prima; all'aiutante niente (got ${JSON.stringify(s)} · ${lavori().length})`);
  await chiudiStampa(doc);
  let imp = await impostazioniDicono();
  check(!imp.interruttore && /scegli le due stampanti$/.test(imp.stato), `e le impostazioni: niente interruttore, «scegli le due stampanti» (got ${imp.stato})`);
  // accesa: l'interruttore se ne va, le stampanti restano, e stampa da sola
  await scelte({ ...ATTIVA });
  await sw.evaluate(() => stampaMigra());
  m = (await memoria()).stampa || {};
  check(!("attiva" in m) && m.etichette === ATTIVA.etichette && m.a4 === ATTIVA.a4, `«accesa»: l'interruttore se ne va, le stampanti restano (got ${JSON.stringify(m)})`);
  await suPagina(doc, A.patientUrl);
  await apriPannello(doc);
  check(!!(await finche(() => stampantina(doc), 3000)), "la stampantina in intestazione c'è: la stampa è automatica");
  await azzeraStampe(doc);
  const { rec } = await ristampaSenzaScheda(doc);
  check(!!rec && rec.stato === "avviso" && lavori().length === 2 && (await stampe(doc)).length === 0, `e la ristampa va da sola: due fogli, niente dialogo (got ${lavori().length})`);
  imp = await impostazioniDicono();
  check(!imp.interruttore && /attiva$/.test(imp.stato), `e le impostazioni: niente interruttore, «Stampa automatica: attiva» (got ${imp.stato})`);
}

// ---- 7. l'ordine in sottofondo, il medico lontano --------------------------
// (Chromium senza finestra dice «visible» anche delle schede dietro: la prova
// più dura è che la scheda del medico non ci sia proprio più.)
if (await prova("ordine in sottofondo: stampa la scheda dell'ordine, col medico su un altro paziente e poi senza più la sua scheda")) {
  installa(true);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const worker = await nasce;
  check(!!worker, "«Conferma e stampa» apre la scheda dell'ordine");
  await suPagina(doc, B.patientUrl);   // il medico va su un altro paziente…
  const altrove = await ctx.newPage(); // …poi lascia il gestionale e chiude la sua scheda
  await altrove.goto("about:blank");
  await altrove.bringToFront();
  await doc.close();
  const davanti = await sw.evaluate(() => chrome.tabs.query({ active: true }).then((t) => t.map((x) => x.url || "")));
  check(!davanti.some((u) => /smarthealth/.test(u)), `davanti non c'è nessuna scheda del gestionale (got ${davanti.join(" | ")})`);
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && /^Stampato/.test(stampaDi(x.pubblico) || "")), 60000);
  const rid = Object.keys(A.state.richieste).find((r) => r !== "699999");
  const l = lavoriPerStampante();
  const n = rec ? rec.stampa.jobs.length : 0;
  check(!!rec && A.state.richieste[rid]?.confirmed === true && conferme(A).length === 1, "la richiesta è confermata, una volta");
  check(n >= 2 && l.length === n && l.every((x) => x.ok) && l.filter((x) => x.tipo === "etichette").every((x) => x.stampante === "Zebra ZD421")
    && l.filter((x) => x.tipo === "a4").every((x) => x.stampante === "HP LaserJet A4") && l[0].tipo === "etichette" && l[l.length - 1].tipo === "a4",
  `tutti i fogli stampati senza nessuno davanti: etichette → Zebra, poi lista → HP (got ${JSON.stringify(l.map((x) => `${x.tipo}→${x.stampante}`))})`);
  const aperte = worker.isClosed() ? null : await stampe(worker);
  check(aperte === null || aperte.length === 0, "nessuna finestra di stampa aperta, nemmeno nella scheda dell'ordine");
  check(await aspettaChiusa(worker), "fatto il suo lavoro, la scheda dell'ordine si chiude");
  check(!!rec && stampaDi(rec.pubblico) === "Stampato su Zebra ZD421 e HP LaserJet A4" && /^2 esami confermati alle \d\d:\d\d$/.test(sottoDi(rec.pubblico))
    && rec.fogli.every((f) => f.stato === "stampato"),
  `l'ordine dice «Stampato su Zebra ZD421 e HP LaserJet A4 · 2 esami confermati alle HH:MM», foglio per foglio (got ${JSON.stringify(rec && rec.pubblico)})`);
  await sospendi(3000);
  check(lavori().length === n, "e niente si stampa una seconda volta");
  // il medico torna e riapre il gestionale (su BIANCHI): lì trova com'è andata
  doc = await ctx.newPage();
  await altrove.close();
  await suPagina(doc, B.patientUrl);
  const fine = await striscia(doc, /Stampato/, 15000);
  check(/ROSSI MARIO/.test(fine) && /Stampato/.test(fine) && /2 esami confermati/.test(fine) && (await azione(doc)) === "Ristampa",
    `riaperto il gestionale (su BIANCHI): «Stampato · 2 esami confermati», di ROSSI, con «Ristampa» (got ${fine || "niente"} · ${await azione(doc)})`);
  check((await stampe(doc)).length === 0, "e nessuna finestra di stampa si è mai aperta");
  await shot(doc, "ordine-sottofondo-stampato");
  // «Ristampa»: un tocco; di nuovo da sola, senza niente davanti, e alla fine il resoconto
  await $panel(doc, AZIONE).click();
  await finche(() => lavori().length === 2 * n, 40000);
  const ancora = await striscia(doc, /Stampato/, 15000);
  check(lavori().length === 2 * n && (await stampe(doc)).length === 0, `«Ristampa»: gli stessi fogli, una volta, senza anteprima (got ${lavori().length} fogli)`);
  check(/ROSSI MARIO/.test(ancora) && /Stampato/.test(ancora) && /2 esami confermati/.test(ancora) && (await azione(doc)) === "Ristampa",
    `e il resoconto «Stampato · 2 esami confermati», con «Ristampa» accanto (got ${ancora || "niente"})`);
  check(!(await ordine(rec.id)), "l'ordine di prima non c'è più: la ristampa è la sua");
}

// ---- 7b. stampati i fogli, la pagina del paziente si ricarica ---------------
// L'ordine in sottofondo, il medico resta sulla pagina del paziente: è quella
// di prima della Conferma. Quando la stampa automatica ha preso e dato
// all'aiutante tutti i fogli — mai prima — si ricarica dal suo «Aggiorna»,
// una volta, e la striscia resta.
if (await prova("ordine in sottofondo col medico sulla pagina del paziente: stampati i fogli, la pagina NON si ricarica")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 800 });
  ritocca = (u, out) => {
    if (!/MVPG=PsoEpisodioClinicoAmbulatorio/.test(u) || !/EPISODIO_ID=999001/.test(u)) return null;
    const html = Buffer.from(out.body).toString("latin1");
    return { ...out, body: Buffer.from(html.replace(/<body>/i, `<body><a title="Aggiorna" onclick="javascript:window.location.reload( false )" href="${A.PATH}?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=999001&amp;AGG=1">Refresh</a>`), "latin1") };
  };
  const navi = [];
  const guarda = (f) => { if (f === doc.mainFrame() && /AGG=1/.test(f.url())) navi.push({ fogli: lavori().length }); };
  doc.on("framenavigated", guarda);
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli && x.confermata), 60000);
  const n = rec ? rec.stampa.jobs.length : 0;
  await sospendi(4000);
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 }).catch(() => {});
  check(!!rec && n >= 2 && navi.length === 0,
    `stampati i ${n} fogli, la pagina non si ricarica: niente salti sotto il medico (got ${JSON.stringify(navi)})`);
  const fine = await striscia(doc, /Confermata.*Stampato su/, 10000);
  check(/ROSSI MARIO/.test(fine) && /1 esame confermato/.test(fine) && (await azione(doc)) === "Ristampa",
    `e la striscia resta: «Confermata · Stampato su … · 1 esame confermato», con «Ristampa» (got ${fine || "niente"})`);
  await sospendi(4000);
  check(navi.length === 0 && lavori().length === n && (await stampe(doc)).length === 0, `e niente si stampa di nuovo, la pagina resta (got ${navi.length} · ${lavori().length} fogli)`);
  doc.off("framenavigated", guarda);
  ritocca = null;
}

// ---- 8. l'ordine in sottofondo, un foglio che non esce ---------------------
if (await prova("ordine in sottofondo con un foglio che non esce: arriva al medico col motivo, gli altri no")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ rompi: { "Zebra ZD421": "la stampante non esiste" } });
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  const worker = await nasce;
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 60000 }).catch(() => {});
  await aspettaScheda(doc, "s.stato === 'stampo'", 20000);
  const s = await scheda(doc);
  check(s && /Etichette/.test(s.doc) && /^Stampa 1 di 1/.test(s.doc) && s.dialoghi === 1 && /non riuscita: la stampante non esiste/.test(s.avviso),
    `nella scheda del medico solo le etichette, dal dialogo, col motivo (got ${JSON.stringify(s)})`);
  const l = lavoriPerStampante();
  check(l.length === 2 && !l[0].ok && l[0].tipo === "etichette" && l[1].ok && l[1].tipo === "a4" && l[1].stampante === "HP LaserJet A4",
    `la lista è già uscita dalla scheda dell'ordine; le etichette no (got ${JSON.stringify(l)})`);
  await dialogoChiuso(doc);
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});
  const fine = await striscia(doc, /Stampa finita/, 8000);
  check(/1 esame confermato/.test(fine) && (await azione(doc)) === "Ristampa", `alla fine «Stampa finita · 1 esame confermato», e «Ristampa» (got ${fine || "niente"})`);
  check(lavori().length === 2 && (await stampe(doc)).length === 1, "la lista non si ristampa da sola, e la stampa si è aperta una volta");
  check(await aspettaChiusa(worker), "la scheda dell'ordine si è chiusa");
}

// ---- 9. l'aiutante che non risponde in tempo: «sconosciuto», mai il dialogo --
// (i tempi in scala: l'aiutante ci mette 4 secondi, l'estensione ne aspetta 1,5)
if (await prova("l'aiutante che non risponde in tempo: esito sconosciuto, niente dialogo, ogni foglio una volta")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 4000 });
  await pazienza(1500);
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const { rec: r1 } = await ristampaSenzaScheda(doc);
  check(!!r1 && r1.stato === "avviso" && stampaDi(r1.pubblico) === "Esito della stampa sconosciuto" && /^controlla Zebra ZD421 e HP LaserJet A4: l'aiutante di stampa non ha risposto in tempo/.test(sottoDi(r1.pubblico))
    && r1.fogli.every((f) => f.stato === "sconosciuto"),
  `senza risposta: «Esito della stampa sconosciuto · controlla Zebra ZD421 e HP LaserJet A4: …» (got ${JSON.stringify(r1 && r1.pubblico)})`);
  const s1 = await striscia(doc, /Esito della stampa sconosciuto/, 8000);
  check(/controlla Zebra ZD421/.test(s1) && (await azione(doc)) === "Ristampa", `la striscia lo dice, con «Ristampa» (got ${s1})`);
  await shot(doc, "esito-sconosciuto");
  await finche(() => lavori().length === 2, 10000);
  await sospendi(1500);
  check(lavori().length === 2 && (await stampe(doc)).length === 0, `l'aiutante (lento) li ha stampati, una volta ciascuno: niente doppioni dal dialogo (got ${lavori().length})`);
  await apriPannello(doc);
  const rossa = await stampantina(doc);
  check(!!rossa && rossa.ko && /esito sconosciuto/.test(rossa.titolo), `la stampantina lo dice (got ${JSON.stringify(rossa)})`);
  // lo stesso per un ordine in sottofondo
  azzeraLavori();
  await nessunOrdine();
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  await suPagina(doc, B.patientUrl);
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli), 60000);
  check(!!rec && stampaDi(rec.pubblico) === "Esito della stampa sconosciuto" && /^controlla Zebra ZD421 e HP LaserJet A4: /.test(sottoDi(rec.pubblico)) && rec.fogli.every((f) => f.stato === "sconosciuto"),
    `ordine in sottofondo: «Esito della stampa sconosciuto · controlla Zebra ZD421 e HP LaserJet A4: …» (got ${JSON.stringify(rec && rec.pubblico)})`);
  await sospendi(5000);
  check(lavori().length === 2 && (await stampe(doc)).length === 0, `e nessun dialogo: ogni foglio è uscito una volta, dall'aiutante (got ${lavori().length} fogli, ${(await stampe(doc)).length} dialoghi)`);
  const str = await striscia(doc, /Esito della stampa sconosciuto/, 8000);
  check(/ROSSI MARIO/.test(str) && (await azione(doc)) === "Ristampa", `la striscia: «Esito della stampa sconosciuto», con «Ristampa» (got ${str})`);
  // sotto, le righe dei fogli: rosse, «Ristampa» e accanto il ✕ «Visto: togli» — un tocco, e via le righe e la
  // striscia; niente ristampato, e il giornale lo tiene com'era
  const rr = await finche(async () => { const r = await righeOra(doc); return r.length === 2 && r.every((x) => x.err && x.rist && x.x.join() === "v|Visto: togli") ? r : null; }, 8000);
  check(!!rr, `le due righe: rosse, «Ristampa», ✕ «Visto: togli» (got ${JSON.stringify(await righeOra(doc))})`);
  const primaDiVisto = lavori().length;
  await $panel(doc, '.pjx[data-pjx^="v:"]').first().click().catch(() => {});
  const via = await finche(async () => !(await righeOra(doc)).length && !/Esito della stampa sconosciuto/.test(await strisciaOra(doc)), 8000);
  await sospendi(1500);
  const tenuto = await ordine(rec.id);
  check(via && lavori().length === primaDiVisto && (await stampe(doc)).length === 0 && !!tenuto && tenuto.visto === true && tenuto.fogli.every((f) => f.stato === "sconosciuto")
    && stampaDi(tenuto.pubblico) === "Esito della stampa sconosciuto",
  `un tocco sul ✕: righe e striscia via, niente ristampato; nel giornale resta «sconosciuto», com'era (got ${via} · ${lavori().length} fogli · ${JSON.stringify(tenuto && [tenuto.visto, stampaDi(tenuto.pubblico)])} · «${await strisciaOra(doc)}»)`);
  await pazienza(0);
}

// ---- 10. la scheda dell'ordine ricaricata, o chiusa, mentre stampa ---------
if (await prova("la scheda dell'ordine ricaricata o chiusa mentre stampa: «stampa interrotta», e la coda va avanti")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 3000 });
  pdfVia.lento = { re: /REPORT=RcsRichiesta/, ms: 8000 };   // la lista arriva tardi: le etichette sono già alla stampante
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  let nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  let worker = await nasce;
  await suPagina(doc, B.patientUrl);
  const primo = await finche(async () => (await ordini()).find((x) => x.stato === "stampo" && x.fogli && x.fogli[0].stato === "invio"), 60000);
  check(!!primo && primo.fogli[0].stato === "invio" && ["attesa", "prendo"].includes(primo.fogli[1].stato) && primo.worker != null,
    `confermata: il service worker stampa, e il foglio è segnato «invio» prima di partire (got ${JSON.stringify(primo && primo.fogli.map((f) => f.stato))})`);
  check(!!primo && stampaDi(primo.pubblico) === "Confermata" && /^Stampo le etichette su Zebra ZD421…$/.test(sottoDi(primo.pubblico)) && /foglio 1 di 2/.test(primo.pubblico.dettaglio),
    `intanto: «Confermata · Stampo le etichette su Zebra ZD421…», «foglio 1 di 2» (got ${JSON.stringify(primo && primo.pubblico)})`);
  // (la Conferma l'ha premuta la scheda dell'ordine sulla pagina vera: il gestionale risponde
  // con un redirect alla pagina del paziente, che qui il banco segue da sé lasciando
  // l'indirizzo del modulo — ricaricare quello lo rimanderebbe. Si ricarica quello vero.)
  await (/ccsForm=/.test(worker.url()) ? worker.goto(A.patientUrl) : worker.reload()).catch(() => {});
  const fine = await finche(async () => (await ordini()).find((x) => x.id === primo.id && x.stato === "avviso"), 30000);
  check(!!fine && stampaDi(fine.pubblico) === "Stampa interrotta" && /^non usciti: Lista/.test(sottoDi(fine.pubblico)) && /ricaricata · 1 esame confermato/.test(fine.pubblico.dettaglio)
    && fine.fogli[0].stato === "stampato" && fine.fogli[1].stato === "attesa",
  `ricaricata: «Stampa interrotta», confermata, il foglio partito stampato, l'altro mai mandato (got ${JSON.stringify(fine && [fine.pubblico, fine.fogli.map((f) => f.stato)])})`);
  await sospendi(2000);
  check(lavori().length === 1 && (await stampe(doc)).length === 0, `un foglio solo all'aiutante, nessun dialogo (got ${lavori().length})`);
  check(await aspettaChiusa(worker), "e la scheda dell'ordine si chiude");
  // la coda non è ferma: un altro ordine (per BIANCHI) parte e finisce
  nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO"]);
  await nasce;
  const secondo = await finche(async () => (await ordini()).find((x) => x.id !== primo.id && x.stato === "avviso" && /^Stampato/.test(stampaDi(x.pubblico) || "")), 60000);
  check(!!secondo && secondo.paziente === "BIANCHI ANNA", "un secondo ordine parte e finisce «Stampato»: la coda non resta bloccata");
  // «Ristampa» dell'ordine interrotto: solo il foglio che non è uscito
  await suPagina(doc, B.patientUrl);
  azzeraLavori();
  await apriSegno(doc);
  const str = await striscia(doc, /Stampa interrotta/, 8000);
  check(/ROSSI MARIO/.test(str) && (await azione(doc)) === "Ristampa", `la striscia: «Stampa interrotta», e «Ristampa» (got ${str})`);
  await shot(doc, "stampa-interrotta");
  await $panel(doc, AZIONE).click();
  await finche(() => lavori().length === 1, 20000);
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 20000 }).catch(() => {});
  check(lavori().length === 1 && lavori()[0].tipo === "a4", `«Ristampa»: solo la lista, che non era uscita (got ${JSON.stringify(lavori().map((x) => x.tipo))})`);
  // chiusa mentre stampa: confermata, mai «Scheda chiusa · controlla il carrello»
  await nessunOrdine();
  azzeraLavori();
  await suPagina(doc, A.patientUrl);
  nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  worker = await nasce;
  const terzo = await finche(async () => (await ordini()).find((x) => x.stato === "stampo" && x.fogli && x.fogli[0].stato === "invio"), 60000);
  await worker.close();
  const chiusa = await finche(async () => (await ordini()).find((x) => terzo && x.id === terzo.id && x.stato !== "stampo"), 30000);
  check(!!chiusa && chiusa.stato === "avviso" && stampaDi(chiusa.pubblico) === "Stampa interrotta" && /si è chiusa/.test(chiusa.pubblico.dettaglio),
    `chiusa a metà stampa: «Stampa interrotta», non «Scheda chiusa» (got ${JSON.stringify(chiusa && [chiusa.stato, chiusa.pubblico])})`);
}

// ---- 10b. dopo la Conferma, le pagine che il gestionale lascia da sé ---------
// Il gestionale vero, dopo la Conferma, porta la scheda dell'ordine dalla
// pagina delle etichette LIS a PsoEpisodio e poi al paziente, da sé. La
// stampa non parte da una pagina che se ne va: i suoi PDF morivano con lei
// («Stampa interrotta», «Fogli NON stampati»). Parte dal paziente.
if (await prova("dopo la Conferma il gestionale passa da pagine che lascia da sé: la stampa parte dal paziente, e i fogli escono tutti")) {
  installa(true);
  await scelte(ATTIVA);
  A = createMock({ seedConfirmed: true, dopoConferma: 1000 });
  pdfVia.lento = { re: FOGLIO, ms: 2500 };   // un PDF ci mette più di quanto la pagina resta
  await sw.evaluate(() => chrome.storage.local.remove("errori.v1"));
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  const worker = await nasce;
  await suPagina(doc, B.patientUrl);
  const rec = await finche(async () => (await ordini()).find((x) => x.paziente === "ROSSI MARIO" && x.stato === "avviso"), 60000);
  const n = rec ? rec.stampa.jobs.length : 0, l = lavoriPerStampante();
  check(A.state.passaggi.join(" → ") === "RcsStampaEtichetteLIS → PsoEpisodio" && conferme(A).length === 1,
    `la scheda dell'ordine conferma una volta e passa dalle etichette LIS e da PsoEpisodio (got ${A.state.passaggi.join(" → ") || "niente"})`);
  check(!!rec && stampaDi(rec.pubblico) === "Stampato su Zebra ZD421 e HP LaserJet A4" && n >= 2 && rec.fogli.every((f) => f.stato === "stampato") && l.length === n,
    `i fogli escono tutti, una volta: «Stampato su Zebra ZD421 e HP LaserJet A4» (got ${JSON.stringify(rec && [stampaDi(rec.pubblico), sottoDi(rec.pubblico), rec.fogli.map((f) => f.stato)])} · ${l.length} fogli)`);
  const err = ((await sw.evaluate(() => chrome.storage.local.get("errori.v1")))["errori.v1"] || []).filter((e) => /^stampa/.test(e.tipo));
  check(err.length === 0, `nessun PDF perso per strada (got ${JSON.stringify(err.map((e) => e.dati))})`);
  check(await aspettaChiusa(worker), "e la scheda dell'ordine si chiude");
  pdfVia.lento = null;
}

// ---- 11. ⏹ mentre stampa ----------------------------------------------------
if (await prova("⏹ sulla striscia mentre il service worker stampa: il foglio in corso finisce, gli altri no")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 3000 });
  pdfVia.lento = { re: /REPORT=RcsRichiesta/, ms: 8000 };   // la lista arriva dopo il ⏹: non parte
  await suPagina(doc, A.patientUrl);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  await suPagina(doc, B.patientUrl);
  await finche(async () => (await ordini()).find((x) => x.stato === "stampo" && x.fogli && x.fogli[0].stato === "invio"), 60000);
  const str = await striscia(doc, /Stampo le etichette/, 8000);
  check(/Confermata/.test(str) && (await $panel(doc, STOP).getAttribute("title")) === "Ferma l'ordine", `la striscia ha il ⏹ anche mentre stampa (got ${str})`);
  await shot(doc, "stampo-col-fermo");
  await $panel(doc, STOP).click();
  const fine = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli), 30000);
  check(!!fine && stampaDi(fine.pubblico) === "Stampa interrotta" && /fermata col ⏹/.test(fine.pubblico.dettaglio) && fine.fogli[1].stato === "attesa",
    `«Stampa interrotta», fermata col ⏹ (got ${JSON.stringify(fine && fine.pubblico)})`);
  await sospendi(1500);
  check(lavori().length === 1, `uscito solo il foglio che era già partito (got ${lavori().length})`);
  // la lista, mai partita: sotto la striscia è rossa, «non uscita», con «Ristampa» e il ✕ «Visto» — non un ✕ «togli» che a stampa finita non toglie più niente
  await apriSegno(doc);
  const ri = await finche(async () => { const r = await righeOra(doc); return r.length === 1 ? r : null; }, 10000);
  check(!!ri && ri[0].err && ri[0].rist && ri[0].x.join() === "v|Visto: togli",
    `la lista non uscita: rossa, «Ristampa», ✕ «Visto: togli» (got ${JSON.stringify(await righeOra(doc))})`);
}

// ---- 12. un ordine dal telefono non apre mai da solo il dialogo -------------
if (await prova("un ordine dal telefono: le etichette aspettano un tocco al PC, e lo si dice")) {
  // senza stampa automatica
  installa(false);
  await scelte(null);
  await suPagina(doc, A.patientUrl);
  await doc.bringToFront();
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  const tel1 = await ordineTel("telprova1");
  check(tel1.ok, `(l'ordine dal telefono, come lo manda il ponte: ${JSON.stringify(tel1).slice(0, 120)})`);
  await nasce;
  if (process.env.PSA_DEBUG) setTimeout(async () => console.log(JSON.stringify(await ordini())), 20000);
  const rec = await finche(async () => (await ordini()).find((x) => x.id === "telprova1" && x.stato === "stampa"), 60000);
  check(!!rec && rec.pubblico.tono === "warn" && stampaDi(rec.pubblico) === "Etichette NON stampate" && rec.pubblico.tel?.titolo === "Confermata" && rec.pubblico.tel?.testo === "etichette al PC",
    `confermata: «Etichette NON stampate» sul PC, e al telefono «Confermata · etichette al PC» (got ${JSON.stringify(rec && rec.pubblico)})`);
  await sospendi(4000);
  check((await stampe(doc)).length === 0 && (await ordine("telprova1"))?.stato === "stampa",
    "sulla pagina di quel paziente, davanti: il dialogo NON si apre da solo");
  const str = await striscia(doc, /Etichette NON stampate/, 8000);
  check((str.match(/dall'iPhone/g) || []).length === 1 && (await azione(doc)) === "Stampa", `la striscia dice che viene dall'iPhone (una volta), e «Stampa» (got ${str})`);
  check(/tocca Stampa/.test(str) && !/aspettano qualcuno|sulla striscia/.test(str), `e sul PC dice la frase del PC, non quella del telefono (got ${str})`);
  await shot(doc, "telefono-aspetta-un-tocco");
  await $panel(doc, AZIONE).click();
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 15000 }).catch(() => {});
  check(await finche(async () => (await stampe(doc)).length === 1 && !(await ordine("telprova1")), 15000),
    "un tocco: il dialogo, e l'ordine non c'è più fra quelli aperti");
  await chiudiStampa(doc);
  // con la stampa automatica e l'etichettatrice che non va
  installa(true);
  await scelte(ATTIVA);
  comportati({ rompi: { "Zebra ZD421": "la stampante «Zebra ZD421» risulta spenta o offline" } });
  await azzeraStampe(doc);
  await ordineTel("telprova2");
  const rotta = await finche(async () => (await ordini()).find((x) => x.id === "telprova2" && x.stato === "stampa"), 60000);
  check(!!rotta && stampaDi(rotta.pubblico) === "Etichette NON stampate" && sottoDi(rotta.pubblico) === "la stampante «Zebra ZD421» risulta spenta o offline"
    && sottoDi(rotta.pubblico.tel) === "aspettano qualcuno al PC" && /spenta o offline/.test(rotta.pubblico.tel?.dettaglio),
  `l'etichettatrice spenta: «Etichette NON stampate · la stampante «Zebra ZD421» risulta spenta o offline» (got ${JSON.stringify(rotta && rotta.pubblico)})`);
  await sospendi(3000);
  check((await stampe(doc)).length === 0 && lavori().filter((x) => x.ok).length === 1, "la lista è uscita; le etichette aspettano, nessun dialogo da solo");
  // nessuno le prende per mezz'ora: l'ordine si chiude in ambra, «NON stampate» — mai un verde
  const scade = await sw.evaluate(async () => {
    const l = (await chrome.storage.session.get("ordini")).ordini || [];
    for (const x of l) if (x.id === "telprova2") x.agg = Date.now() - 31 * 60e3;
    await chrome.storage.session.set({ ordini: l });
    // (il giro di controllo, adesso: le domande delle schede, ogni 4 secondi, lo fanno al più ogni 3)
    await inFilaOrd(async () => { await ordControlla(await ordLeggi()); });
    return ((await chrome.storage.session.get("ordini")).ordini || []).find((x) => x.id === "telprova2");
  });
  check(!!scade && scade.stato === "avviso" && scade.pubblico.tono === "warn" && stampaDi(scade.pubblico) === "Etichette NON stampate",
    `etichette che nessuno prende per mezz'ora: «Etichette NON stampate», in ambra (got ${JSON.stringify(scade && scade.pubblico)})`);
  await sw.evaluate(() => ordMessaggio({ t: "ordineChiudi", id: "telprova2" }, { tab: { id: 0 }, url: "https://smarthealth.multimedica.it/sa4pso/" }, () => {}));
  // le etichette che aspettano un tocco hanno anche il ✕ «Annulla»: non si stampano, mai un dialogo; il PC non lo
  // ripete, il telefono (e il giornale) dicono «NON stampate · annullate sul PC»
  await ordineTel("telprova4");
  await finche(async () => (await ordini()).find((x) => x.id === "telprova4" && x.stato === "stampa"), 60000);
  await striscia(doc, /Etichette NON stampate/, 8000);
  const tAnn = await $panel(doc, STOP).first().getAttribute("title").catch(() => "");
  const primaAnn = lavori().length;
  await $panel(doc, STOP).first().click().catch(() => {});
  const ann = await finche(async () => { const x = await ordine("telprova4"); return x && x.stato === "avviso" ? x : null; }, 10000);
  await sospendi(3000);
  check(tAnn === "Annulla: non stamparle" && !!ann && ann.visto === true && !ann.stampa && ann.pubblico.tono === "warn" && stampaDi(ann.pubblico) === "Etichette NON stampate"
    && /^annullate sul PC/.test(sottoDi(ann.pubblico)) && !ann.pubblico.tel,
  `«Annulla: non stamparle»: l'ordine dice «Etichette NON stampate · annullate sul PC», anche al telefono (got «${tAnn}» · ${JSON.stringify(ann && [ann.stato, ann.visto, ann.pubblico])})`);
  check(lavori().length === primaAnn && (await stampe(doc)).length === 0 && !/Etichette NON stampate/.test(await strisciaOra(doc)),
    `e niente stampato, nessun dialogo, la striscia del PC non lo ripete (got ${lavori().length - primaAnn} fogli · ${(await stampe(doc)).length} dialoghi · «${await strisciaOra(doc)}»)`);
  // e quando esce: «Stampato su…», e chi preleva va avvisato
  comportati();
  await nessunOrdine();
  await ordineTel("telprova3");
  const ok = await finche(async () => (await ordini()).find((x) => x.id === "telprova3" && x.stato === "avviso"), 60000);
  check(!!ok && stampaDi(ok.pubblico) === "Stampato su Zebra ZD421 e HP LaserJet A4" && /alle \d\d:\d\d$/.test(sottoDi(ok.pubblico)) && /avvisa chi preleva/.test(ok.pubblico.dettaglio),
    `uscite: «Stampato su Zebra ZD421 e HP LaserJet A4 · … alle HH:MM · avvisa chi preleva» (got ${JSON.stringify(ok && ok.pubblico)})`);
  check(!!ok && !/il tuo/.test(ok.pubblico.dettaglio), `e col quesito vero, non «Quesito: il tuo» (got ${ok && ok.pubblico.dettaglio})`);
}

// ---- 13. «Mandato»: nella coda di Windows, non si sa se uscito --------------
if (await prova("il foglio rimasto nella coda di Windows: «Mandato a», non «Stampato»")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ esito: { "Zebra ZD421": "mandato" } });
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  const { rec: r1 } = await ristampaSenzaScheda(doc);
  check(!!r1 && stampaDi(r1.pubblico) === "Mandato a Zebra ZD421" && r1.pubblico.tono === "warn" && /è nella coda di Windows/.test(r1.pubblico.dettaglio)
    && /stampato su HP LaserJet A4/.test(r1.pubblico.dettaglio) && (await stampe(doc)).length === 0,
  `etichette: «Mandato a Zebra ZD421» in ambra, non «Stampato»; la lista «stampato su HP LaserJet A4» (got ${JSON.stringify(r1 && r1.pubblico)})`);
  await nessunOrdine();
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli), 60000);
  check(!!rec && stampaDi(rec.pubblico) === "Mandato a Zebra ZD421" && /alle \d\d:\d\d$/.test(sottoDi(rec.pubblico)) && /stampato su HP LaserJet A4/.test(rec.pubblico.dettaglio),
    `ordine in sottofondo: «Mandato a Zebra ZD421 · … alle HH:MM», e la lista «stampato su HP LaserJet A4» (got ${JSON.stringify(rec && rec.pubblico)})`);
  check(!!rec && rec.pubblico.tono === "warn", `«Mandato» in ambra, non col verde di «Stampato» (got ${rec && rec.pubblico.tono})`);
  const str = await striscia(doc, /Mandato a Zebra ZD421/, 8000);
  // (la striscia, o a pannello aperto il chip in intestazione)
  const segno = await doc.evaluate(() => { const r = document.getElementById("psassist-host")?.shadowRoot; const p = r?.querySelector(".pill.run, .gchip"); return p?.className + " " + p?.querySelector(".tick, .gtick")?.textContent; });
  check(/warn/.test(segno) && !/✓/.test(segno), `sulla striscia: ambra, senza ✓ (got ${segno} · ${str})`);
}

// ---- 14. la stampantina dice «non installata» se l'aiutante non c'è più ----
if (await prova("aiutante tolto con la stampa automatica accesa: la stampantina dice «non installata»")) {
  installa(false);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  await apriPannello(doc);
  const no = await finche(async () => { const x = await stampantina(doc); return x && /non installata/.test(x.titolo) ? x : null; }, 10000);
  check(!!no && no.ko && /chrome:\/\/policy/.test(no.titolo), `prima di qualunque stampa: rossa, «Stampa automatica non installata» (got ${JSON.stringify(await stampantina(doc))})`);
  const testo = await $panel(doc, "#stauto").innerText().catch(() => "");
  check(/non installata/.test(testo), `e lo scrive accanto all'icona (got ${testo})`);
  await shot(doc, "stampantina-non-installata");
  installa(true);
  await sw.evaluate(() => chrome.storage.session.remove("stampaVerificata"));
  await suPagina(doc, A.patientUrl);
  await apriPannello(doc);
  const si = await finche(async () => { const x = await stampantina(doc); return x && !x.ko ? x : null; }, 10000);
  check(!!si && /attiva/.test(si.titolo), "reinstallato: la stampantina torna normale");
}

// ---- 15. la consegna dei fogli ripetuta: si stampa una volta ----------------
// (la scheda dell'ordine la rimanda quando la prima risposta si perde: un «no»
// e li stamperebbe lei, una seconda volta)
if (await prova("la scheda dell'ordine che consegna i fogli due volte: si stampano una volta")) {
  const diNuovo = (id, worker, jobs) => sw.evaluate(([id, worker, jobs, u]) => new Promise((res) => ordMessaggio({ t: "ordineStampa", id, jobs, fine: { n: 1 } },
    { tab: { id: worker }, url: u }, res)), [id, worker, jobs, A.patientUrl]);
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 1500 });
  await suPagina(doc, A.patientUrl);
  let nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "stampo"), 60000);
  const ancora = rec ? await diNuovo(rec.id, rec.worker, rec.stampa.jobs) : null;
  check(!!ancora && ancora.ok === true, `stampa automatica: la seconda consegna è un sì, e la scheda dell'ordine non li stampa lei (got ${JSON.stringify(ancora)})`);
  const fine = rec && await finche(async () => (await ordini()).find((x) => x.id === rec.id && x.stato === "avviso"), 60000);
  await sospendi(1500);
  check(!!fine && lavori().length === rec.stampa.jobs.length && fine.fogli.every((f) => f.stato === "stampato"),
    `ogni foglio all'aiutante una volta (got ${lavori().length} fogli)`);
  // la stampa chiesta dalla scheda del medico (ordineFogli), la stessa domanda due volte: una stampa
  azzeraLavori();
  await nessunOrdine();
  const PDF = `${A.ORIGIN}/jasperserverSAN/jasperservlet?PROJECT=sa4rcs&REPORT=RcsRichiesta&RICHIESTA_ID=699999&RICHIESTA_PROG=1`;
  const job = { id: "fdoppia01", ep: "999001", paziente: "ROSSI MARIO", url: A.patientUrl, tag: "Stampa", riassunto: "Richiesta 699999",
    jobs: [{ name: "Etichette provette", printer: "etichettatrice", url: PDF }, { name: "Lista esami", printer: "stampante normale", url: PDF }] };
  // (e gli stessi fogli chiesti di nuovo, con un altro numero, mentre si stampano: un doppio clic)
  const tre = await sw.evaluate(async (job) => {
    const t = (await chrome.tabs.query({})).find((x) => /smarthealth/.test(x.url || ""));
    const chiedi = (j) => new Promise((res) => ordMessaggio({ t: "ordineFogli", job: j }, { tab: t, url: t.url }, res));
    return [await chiedi(job), await chiedi(job), await chiedi({ ...job, id: "fdoppia02" })];
  }, job);
  const doppia = await finche(async () => (await ordini()).find((x) => x.id === "fdoppia01" && x.stato === "avviso"), 40000);
  await sospendi(1500);
  check(tre.every((x) => x.ok && x.id === "fdoppia01") && !!doppia && (await ordini()).filter((x) => /^fdoppia/.test(x.id)).length === 1 && lavori().length === 2,
    `la stampa dalla scheda del medico chiesta due volte, e un doppio clic: un ordine, ogni foglio una volta (got ${JSON.stringify(tre.map((x) => [x.ok, x.id]))} · ${lavori().length} fogli)`);
  // senza stampa automatica: le etichette vanno al medico (e l'ordine via da «ordini»), poi la stessa consegna ancora
  await scelte(null);
  await nessunOrdine();
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  const corre = await finche(async () => (await ordini()).find((x) => x.stato === "corre" && x.worker != null), 60000);
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 60000 }).catch(() => {});
  await finche(async () => !(await ordini()).length, 15000);
  const tardi = corre ? await diNuovo(corre.id, corre.worker, [{ name: "Etichette provette", printer: "etichettatrice", url: A.patientUrl }]) : null;
  await sospendi(1500);
  check(!!tardi && tardi.ok === true && (await stampe(doc)).length === 1,
    `col dialogo: già consegnate al medico, la seconda consegna è un sì, e la stampa si apre una volta (got ${JSON.stringify(tardi)} · ${(await stampe(doc)).length})`);
  await chiudiStampa(doc);
}

// ---- 16. il service worker che riparte a metà stampa ------------------------
// (un foglio mandato all'aiutante da un service worker che non c'è più: com'è
// andata non si sa — «sconosciuto», mai rimandato —; gli altri escono)
if (await prova("il service worker che riparte a metà stampa: il foglio in volo è «sconosciuto», gli altri escono")) {
  installa(true);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  const w = await ctx.newPage();   // la scheda dell'ordine, coi PDF
  await suPagina(w, A.patientUrl);
  await doc.bringToFront();
  const PDF = `${A.ORIGIN}/jasperserverSAN/jasperservlet?PROJECT=sa4rcs&REPORT=RcsRichiesta&RICHIESTA_ID=699999&RICHIESTA_PROG=1`;
  // l'ordine com'era scritto quando il service worker è morto: il primo foglio
  // «mandato» (inVolo), il secondo in attesa, e nessuno che li sta stampando
  await sw.evaluate(async ([u, paz]) => {
    const t = (await chrome.tabs.query({})).filter((x) => /smarthealth/.test(x.url || "")).sort((a, b) => b.id - a.id)[0];
    const jobs = [{ name: "Etichette provette", printer: "etichettatrice", url: u }, { name: "Lista esami", printer: "stampante normale", url: u }];
    await ordScrivi([{ id: "riparte1", ep: "999001", paziente: "ROSSI MARIO", n: 1, url: paz, opener: null, worker: t.id, stato: "stampo",
      ts: Date.now(), agg: Date.now(), vista: null, resto: { mancano: [], controllare: [], nel: [] }, inVolo: 0,
      stampa: { jobs, fine: { n: 1, ts: Date.now() }, riassunto: "1 esame confermato" },
      fogli: [{ name: "Etichette provette", tipo: "etichette", stato: "mandato", stampante: "Zebra ZD421", why: "" },
        { name: "Lista esami", tipo: "a4", stato: "attesa", stampante: "", why: "" }] }]);
    await new Promise((res) => ordMessaggio({ t: "ordineControlla" }, { tab: t, url: t.url }, res));
  }, [PDF, A.patientUrl]);
  const fine = await finche(async () => (await ordini()).find((x) => x.id === "riparte1" && x.stato === "avviso"), 30000);
  check(!!fine && fine.fogli[0].stato === "sconosciuto" && /si è persa/.test(fine.fogli[0].why) && fine.fogli[1].stato === "stampato"
    && stampaDi(fine.pubblico) === "Esito della stampa sconosciuto",
  `ripreso: le etichette in volo «sconosciuto», la lista stampata, «Esito della stampa sconosciuto» (got ${JSON.stringify(fine && [fine.fogli.map((f) => f.stato), fine.pubblico])})`);
  await sospendi(1000);
  check(lavori().length === 1 && lavori()[0].tipo === "a4", `all'aiutante solo la lista: il foglio in volo non si rimanda (got ${JSON.stringify(lavori().map((x) => x.tipo))})`);
  check(await aspettaChiusa(w), "e la scheda dell'ordine si chiude");
}

// ---- 17. la striscia del PC: la cosa più seria, poi la più nuova ------------
// (un «Stampato» non copre un errore arrivato dopo, né l'ordine che gira; le
// etichette di un ordine dal telefono aspettano un tocco senza coprire il
// resto; e il «Stampato» dopo due minuti se ne va da solo)
if (await prova("la striscia: la cosa più seria, poi la più nuova; un «Stampato» se ne va da solo")) {
  await scelte(null);
  await suPagina(doc, A.patientUrl);
  if (await $panel(doc, ".card").count()) await $panel(doc, "#collapse").click();
  const w = await ctx.newPage();   // una scheda qualunque, per l'ordine che parte
  const ora = Date.now();
  const etichette = { name: "Etichette provette", printer: "etichettatrice", url: A.patientUrl };
  const stampato = (agg) => ({ id: "pcok00001", ep: "999001", paziente: "ROSSI MARIO", n: 2, stato: "avviso", ts: agg, agg, worker: null, vista: null,
    resto: { mancano: [], controllare: [], nel: [] }, stampa: { jobs: [etichette], fine: { n: 2, ts: agg }, riassunto: "2 esami confermati" },
    fogli: [{ name: "Etichette provette", tipo: "etichette", stato: "stampato", stampante: "Zebra ZD421", why: "" }] });
  const errore = { id: "pcerr0001", ep: "999002", paziente: "BIANCHI ANNA", n: 3, stato: "errore", ts: ora, agg: ora, worker: null,
    vista: { tag: "Errore", testo: "TROPONINA non inserita: completa a mano", tono: "err" }, resto: { mancano: ["TROPONINA"], controllare: [], nel: [] } };
  const tel = { id: "telAAAAAAAAl", ep: "999001", paziente: "ROSSI MARIO", n: 2, stato: "stampa", ts: ora - 60e3, agg: ora - 60e3, worker: null, vista: null,
    resto: { mancano: [], controllare: [], nel: [] }, stampa: { jobs: [etichette], fine: { n: 2, ts: ora }, riassunto: "2 esami confermati" } };
  const wid = await sw.evaluate(() => chrome.tabs.query({}).then((l) => l.find((t) => !/smarthealth/.test(t.url || ""))?.id));
  const parte = { id: "pcrun0001", ep: "999002", paziente: "BIANCHI ANNA", n: 3, stato: "avvio", ts: ora, agg: ora, worker: wid, vista: null,
    resto: { mancano: [], controllare: [], nel: [] } };
  const scrivi = (l) => sw.evaluate((x) => ordScrivi(x), l);
  await scrivi([stampato(ora - 60e3), errore]);
  // (l'errore è di BIANCHI, e sei su ROSSI: non prende il posto della striscia di ROSSI, resta «✕ BIANCHI A.» accanto; un tocco lo apre)
  const segnoErr = await doc.waitForFunction(() => document.getElementById("psassist-host")?.shadowRoot?.querySelector("#strsegno.err")?.textContent.trim() || false, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => "");
  check(/^✕ BIANCHI A\.$/.test(segnoErr) && /Stampato/.test(await strisciaOra(doc)), `un «Stampato» di ROSSI e un errore di BIANCHI: la striscia è di ROSSI, l'errore è «✕ BIANCHI A.» accanto (got ${segnoErr || "niente"} · ${await strisciaOra(doc)})`);
  await doc.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector("#strsegno").click());
  let s = await striscia(doc, /completa a mano/, 8000);
  check(/BIANCHI ANNA/.test(s), `un «Stampato» più vecchio e un errore dopo: la striscia dice l'errore (got ${s || await striscia(doc, /./, 1000)})`);
  await scrivi([tel, errore]);
  s = await striscia(doc, /completa a mano/, 8000);
  check(/BIANCHI ANNA/.test(s), `le etichette di un ordine dal telefono non coprono un errore (got ${s || await striscia(doc, /./, 1000)})`);
  await scrivi([tel, parte]);
  s = await striscia(doc, /Apro la scheda dell'ordine/, 8000);
  check(/BIANCHI ANNA/.test(s), `né l'ordine che parte (got ${s || await striscia(doc, /./, 1000)})`);
  await scrivi([stampato(ora - 150e3)]);
  await sospendi(2500);
  check(!(await striscia(doc, /Stampato/, 500)), "un «Stampato» di più di due minuti fa non sta più sulla striscia (la Ristampa resta nella sezione Stampa)");
  await scrivi([stampato(Date.now() - 2 * 60e3 + 4000)]);
  check(/Stampato su Zebra ZD421/.test(await striscia(doc, /Stampato/, 3000)), "un «Stampato» appena finito sì…");
  await sospendi(5500);
  check(!(await striscia(doc, /Stampato/, 500)), "…e dopo due minuti se ne va da solo");
  await nessunOrdine();
  await w.close();
  // dal vero: due ordini di fila dalla stessa scheda, stampati senza dialogo
  installa(true);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  let nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
  await nasce;
  const uno = await striscia(doc, /Stampato su/, 60000);
  check(/2 esami confermati/.test(uno), `il primo ordine: «Stampato su …», 2 esami (got ${uno})`);
  nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  const due = await striscia(doc, /1 esame confermato alle/, 60000);
  check(/Stampato su/.test(due) && !/2 esami/.test(due), `il secondo, dalla stessa scheda: la striscia lo segue fino al suo «Stampato» (got ${due || await striscia(doc, /./, 1000)})`);
}

// ---- un referto salvato: «Stampa» nel visore va sull'A4, dalla copia, una volta sola
if (await prova("un referto salvato: «Stampa» nel visore va sull'A4, una volta")) {
  installa(true);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);   // (la stampa dal dialogo delle prove di prima non conta qui)
  if (!(await $panel(doc, ".card").count())) { await $panel(doc, "#expand").click({ position: { x: 12, y: 8 } }); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  await $panel(doc, '[data-seg="esiti"]').click();
  const salvato = () => doc.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelector(".rdot.saved"), null, { timeout: 30000 }).then(() => true).catch(() => false);
  if (!(await $panel(doc, ".rdot.saved").count()) && await $panel(doc, "#risall:not([disabled])").count()) await $panel(doc, "#risall").click();
  await salvato();
  const id = await $panel(doc, ".rrow.saved").first().getAttribute("data-esito").catch(() => "");
  await $panel(doc, `[data-pdf="${id}"]`).click();
  const visore = doc.locator("#psassist-visore");
  await visore.locator("#vstampa").waitFor({ timeout: 15000 }).catch(() => {});
  await visore.locator("#vstampa").click().catch(() => {});
  await finche(() => lavori().length === 1, 30000);
  const l = lavori();
  check(l.length === 1 && l[0].tipo === "a4" && l[0].stampante === "HP LaserJet A4" && l[0].byte > 500,
    `«Stampa» nel visore: il PDF salvato all'A4, senza dialogo (got ${JSON.stringify(l.map((x) => `${x.tipo}→${x.stampante} ${x.byte}`))})`);
  const chiuso = await doc.waitForSelector("#psassist-visore", { state: "detached", timeout: 5000 }).then(() => true).catch(() => false);
  await sospendi(2500);
  check(lavori().length === 1 && chiuso && (await stampe(doc)).length === 0,
    `un foglio solo, nessuna anteprima; e il referto si chiude (got ${lavori().length} · ${chiuso ? "chiuso" : "ancora aperto"})`);
  await visore.locator("#vchiudi").click({ timeout: 1000 }).catch(() => {});
}

// ---- il pacchetto «Dolore toracico» con l'RX: due ordini in sottofondo ------
// (laboratorio e radiologia, uno dopo l'altro, come dal telefono: confermati da
// soli; le etichette alla Zebra e la lista all'A4, poi la prenotazione RX
// all'A4; sotto la striscia una riga per la richiesta che gira e una per
// foglio — e la scheda del medico resta dov'è: niente catena, niente salti)
const pacchettoConRx = async (primaDelClic = () => {}) => {
  await suPagina(doc, A.patientUrl);
  await apriPannello(doc);
  await azzeraRighe(doc);
  await azzeraStampe(doc);
  await $panel(doc, '.chip.q[data-q="Dolore toracico"]').click();
  const cta = (await $panel(doc, "#goconfirm").innerText()).trim();
  check(/· 2 richieste, 7 esami$/.test(cta), `il pacchetto porta anche l'RX: «… · 2 richieste, 7 esami» (got ${cta})`);
  const prima = Object.keys(A.state.richieste);
  primaDelClic();
  await $panel(doc, "#goconfirm").click();
  return prima;
};
const nuoveDi = (prima) => Object.entries(A.state.richieste).filter(([rid]) => !prima.includes(rid)).map(([, r]) => r);
if (await prova("il pacchetto Dolore toracico con l'RX: due ordini in sottofondo confermati da soli, etichette → Zebra, lista poi RX → A4, e la scheda del medico resta lì")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 2500 });
  // (la scheda del medico non si muove mai: nemmeno una ricarica a stampa finita)
  let salti = 0, pagina = "", altrove = 0, presto = 0;
  const salto = (f) => {
    if (f !== doc.mainFrame()) return;
    salti++;
    if (f.url() !== pagina) altrove++;
    ordini().then((l) => { if (l.some((x) => x.stato !== "avviso")) presto++; }).catch(() => {});
  };
  const prima = await pacchettoConRx(() => { pagina = doc.url(); doc.on("framenavigated", salto); });
  // durante: le righe, mentre i fogli del laboratorio sono alla stampante
  const vivo = await finche(async () => (await righeViste(doc)).some((r) => r.ico === "pulsa") && await doc.evaluate(() =>
    (document.getElementById("psassist-host")?.shadowRoot?.querySelectorAll(".pjob") || []).length >= 2).catch(() => false), 120000);
  if (vivo) {
    mkdirSync("/tmp/claude-0/-home-user-EKGAtlas/489213ea-3621-581d-ba5b-643886b3ad63/scratchpad/side", { recursive: true });
    await doc.screenshot({ path: "/tmp/claude-0/-home-user-EKGAtlas/489213ea-3621-581d-ba5b-643886b3ad63/scratchpad/side/stampa-righe.png" }).catch(() => {});
  }
  const fatti = await finche(async () => {
    const l = await ordini();
    const lab = l.find((x) => x.kind === "lab" && x.stato === "avviso" && x.fogli), rx = l.find((x) => x.kind === "radio" && x.stato === "avviso" && x.fogli);
    return lab && rx ? { lab, rx } : null;
  }, 180000);
  await sospendi(4000);   // (la pagina non si ricarica più dopo un ordine: i fogli nuovi li ha letti la scheda dell'ordine)
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 }).catch(() => {});
  await sospendi(1500);
  doc.off("framenavigated", salto);
  const nuove = nuoveDi(prima);
  const lab = nuove.find((r) => r.cart.has("324")), rx = nuove.find((r) => r.cart.has("36"));
  check(nuove.length === 2 && lab && rx && lab.cart.size === 6 && rx.cart.size === 1 && lab.confirmed && rx.confirmed,
    `due richieste, laboratorio (6) e RX torace 1 proiezione (1), confermate tutte e due da sole (got ${nuove.map((r) => `${[...r.cart.keys()]}:${r.confirmed}`).join(" | ")})`);
  check(conferme(A).length === 2, `una conferma per richiesta (got ${conferme(A).length})`);
  const fl = fatti ? fatti.lab.fogli : [], fr = fatti ? fatti.rx.fogli : [];
  check(!!fatti && JSON.stringify(fl.map((x) => x.breve)) === JSON.stringify(["et:POC", "fg:POC"]) && JSON.stringify(fr.map((x) => x.breve)) === JSON.stringify(["fg:RX"])
    && [...fl, ...fr].every((x) => x.stato === "stampato"),
    `due ordini, due stampe: etichette e lista POC, poi la prenotazione RX, tutti stampati (got ${JSON.stringify([fl, fr].map((f) => f.map((x) => `${x.breve}:${x.stato}`)))})`);
  check(fl.length === 2 && fr.length === 1 && fl[1].ts < fr[0].ts, "sull'A4 la lista prima, la prenotazione RX dopo");
  const l = lavori();
  check(l.filter((x) => x.tipo === "etichette" && x.stampante === "Zebra ZD421").length === 1 && l.filter((x) => x.tipo === "a4" && x.stampante === "HP LaserJet A4").length === 2 && l.length === 3,
    `all'aiutante: 1 etichetta alla Zebra, 2 fogli all'A4, una volta ciascuno (got ${JSON.stringify(l.map((x) => `${x.tipo}→${x.stampante}`))})`);
  check((await stampe(doc)).length === 0, "nessun dialogo, nessuna anteprima");
  check(salti === 0 && !altrove && !presto && doc.url() === pagina,
    `la scheda del medico non si è mossa: niente carrello, niente conferma, nessuna ricarica (got ${salti} salti · ${altrove} altrove · ${presto} prima · ${doc.url() === pagina ? "stessa pagina" : doc.url()})`);
  const viste = await righeViste(doc);
  const nomi = [...new Set(viste.map((r) => r.n))];
  const ordine = ["Etichette POC", "Lista esami POC", "Prenotazione RX"].map((n) => viste.findIndex((r) => r.n === n));
  check(ordine.every((i) => i >= 0) && ordine[0] < ordine[1] && ordine[1] < ordine[2], `le righe dei fogli, in ordine, con la loro icona: Etichette POC, Lista esami POC, Prenotazione RX (got ${nomi.join(" | ")})`);
  const di = (n) => viste.filter((r) => r.n === n);
  check(viste.some((r) => /^(Etichette|Lista esami|Prenotazione)/.test(r.n) && r.x && !r.ico && r.svg) && di("Prenotazione RX").some((r) => r.ico === "pulsa" && !r.x) && di("Prenotazione RX").some((r) => r.ok && r.ico === "fatto" && r.w === "100%"),
    "ogni riga: col ✕ finché aspetta, poi la stampantina che respira (niente ✕), poi verde col ✓");
  check(!!vivo, "(la foto delle righe mentre stampa: scratchpad/side/stampa-righe.png)");
  await sospendi(5000);
  const restano = await doc.evaluate(() => [...(document.getElementById("psassist-host")?.shadowRoot?.querySelectorAll(".pjob") || [])].length).catch(() => -1);
  check(restano === 0, `finito, dopo pochi secondi le righe se ne vanno (got ${restano})`);
  // Un tocco su Conferma, un esito: le due richieste dicono UNA riga — la
  // parola, dove sono andati i fogli, i conti — e la sua Ristampa le rifà
  // tutte e due, ogni foglio una volta, le etichette prima.
  const una = await striscia(doc, /2 richieste/, 15000).catch(() => "");
  check(/ROSSI MARIO/.test(una) && /Confermata/.test(una) && /Stampato su Zebra ZD421 e HP LaserJet A4/.test(una) && /2 richieste, 7 esami/.test(una) && (await azione(doc)) === "Ristampa",
    `una riga sola per le due richieste: «Confermata · Stampato su Zebra ZD421 e HP LaserJet A4 · 2 richieste, 7 esami», con «Ristampa» (got ${una || "niente"} · ${await azione(doc)})`);
  const l0 = lavori().length;
  await $panel(doc, AZIONE).click();
  await finche(async () => lavori().length >= l0 + 3, 60000);
  await sospendi(3000);
  const rif = lavori().slice(l0);
  // (le etichette prima nell'ordine dei fogli: le due stampanti lavorano insieme, e quale finisce prima non conta)
  const rifatto = (await ordini()).filter((x) => x.stampa && Array.isArray(x.stampa.jobs) && x.stampa.jobs.length === 3).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
  const ordineRif = rifatto ? rifatto.stampa.jobs.map((j) => j.printer) : [];
  check(rif.length === 3 && rif.filter((x) => x.tipo === "etichette").length === 1 && rif.filter((x) => x.tipo === "a4").length === 2 && ordineRif[0] === "etichettatrice",
    `«Ristampa»: i fogli di tutte e due le richieste — etichette POC, lista POC, RX —, una volta ciascuno, le etichette prima (got ${JSON.stringify(rif.map((x) => `${x.tipo}→${x.stampante}`))} · ${JSON.stringify(ordineRif)})`);
}

// Nelle pagine vere il foglio della radiologia non si chiama sempre «Stampa
// Prenotazione Esterna»: per l'RX del PS è «Stampa Richiesta Radiologia» (lo
// stesso indirizzo). Prima la conferma non si vedeva mai — «Non confermata»
// gialla per ore, e il foglio RX che non usciva.
if (await prova("il foglio RX che si chiama «Stampa Richiesta Radiologia»: l'RX risulta confermata e il suo foglio esce")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 1500 });
  ritocca = (u, out) => {
    if (!Buffer.isBuffer(out.body) || !/html/i.test(String(out.headers?.["content-type"] || ""))) return null;
    const h = out.body.toString("latin1");
    return /Stampa Prenotazione Esterna/.test(h) ? { ...out, body: Buffer.from(h.replaceAll('title="Stampa Prenotazione Esterna"', 'title="Stampa Richiesta Radiologia"'), "latin1") } : null;
  };
  const prima = await pacchettoConRx();
  const FINITI = new Set(["avviso", "errore", "chiusa", "interrotto"]);
  // (finito: andato bene coi fogli usciti, o fermo — senza aspettare tre minuti un foglio che non verrà)
  const fatti = await finche(async () => {
    const l = await ordini();
    const rx = l.find((x) => x.kind === "radio" && FINITI.has(x.stato));
    if (!rx) return null;
    const ok = rx.pubblico && rx.pubblico.tono === "ok";
    return !ok || (rx.fogli && rx.fogli.every((f) => f.stato === "stampato")) ? { rx } : null;
  }, 180000);
  ritocca = null;
  const nuove = nuoveDi(prima);
  const rx = nuove.find((r) => r.cart.has("36"));
  check(!!rx && rx.confirmed, `l'RX è confermata sul gestionale (got ${rx ? rx.confirmed : "nessuna"})`);
  const pub = fatti ? fatti.rx.pubblico || {} : {};
  check(!!fatti && pub.tono === "ok" && !/non confermata|non verificata|sospesa/i.test(`${pub.tag} ${pub.testo}`),
    `e l'estensione lo sa: niente «Non confermata» (got ${JSON.stringify(pub)})`);
  const fr = fatti ? fatti.rx.fogli || [] : [];
  check(fr.length === 1 && fr[0].breve === "fg:RX" && fr[0].stato === "stampato", `il foglio RX esce all'A4 (got ${JSON.stringify(fr.map((x) => `${x.breve}:${x.stato}`))})`);
  check(lavori().filter((x) => x.tipo === "a4").length === 2, `all'A4 la lista POC e il foglio RX (got ${JSON.stringify(lavori().map((x) => `${x.tipo}→${x.stampante}`))})`);
}

if (await prova("un ordine in sottofondo: sotto la striscia la riga «Rich Lab · k/n» che avanza, poi verde, poi i suoi fogli")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 1500 });
  await suPagina(doc, A.patientUrl);
  await azzeraRighe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA", "EMOCROMOCITOMETRICO"]);
  await nasce;
  await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli), 90000);
  const viste = await righeViste(doc);
  const k = viste.filter((r) => /^Richiesta Lab · \d\/2$/.test(r.n) && !r.ok).map((r) => Number(/(\d)\/2/.exec(r.n)[1]));
  check(k.length >= 2 && Math.max(...k) > Math.min(...k) && viste.some((r) => /^Richiesta Lab · \d\/2$/.test(r.n) && r.x && !r.svg),
    `la riga della richiesta avanza, col suo ✕ (got ${[...new Set(viste.map((r) => r.n))].join(" | ")})`);
  check(viste.some((r) => r.n === "Richiesta Lab · 2/2" && r.ok && r.ico === "fatto"), "confermata: verde, col ✓");
  check(viste.some((r) => r.n === "Etichette POC") && viste.some((r) => r.n === "Lista esami POC"), "poi le righe dei suoi fogli");
}

// (due laboratori, due liste sull'A4: la seconda aspetta che la prima esca —
// una richiesta di prima, POC + Urgenze in una, ristampata: oggi il pannello
// ne fa una per erogatore)
if (await prova("una riga tolta col ✕: quel foglio solo non esce, gli altri sì; dall'aiutante il ✕ non c'è più")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 5000 });
  A.state.richieste["699999"].cart.set("159", "00720001P");
  await suPagina(doc, A.patientUrl);
  await azzeraRighe(doc);
  const nasce = nuovaPagina();
  await ristampaDallaPagina(doc, false);
  await nasce;
  // la seconda lista aspetta che l'A4 finisca la prima: lì la si toglie
  const nome = await finche(async () => doc.evaluate(() => {
    const r = document.getElementById("psassist-host")?.shadowRoot;
    const liste = [...(r?.querySelectorAll(".pjob") || [])].filter((el) => /^Lista esami/.test(el.querySelector(".pjn")?.getAttribute("aria-label") || ""));
    return liste.length === 2 && !!liste[0].querySelector(".pjico.pulsa") && !liste[0].querySelector(".pjx") && !!liste[1].querySelector(".pjx")
      ? liste[1].querySelector(".pjn").getAttribute("aria-label") : false;
  }).catch(() => false), 120000);
  check(!!nome, "la prima lista è all'A4 (stampantina, niente ✕) e la seconda aspetta il suo turno, col ✕");
  await $panel(doc, `.pjob:has(.pjn[aria-label="${nome}"]) .pjx`).click().catch(() => {});
  const rec = await finche(async () => (await ordini()).find((x) => x.stampa?.tag === "Stampa" && x.stato !== "stampo" && x.fogli && x.fogli.length === 4), 60000);
  const f = rec ? rec.fogli : [], a4 = f.filter((x) => x.tipo === "a4");
  check(f.length === 4 && a4.length === 2 && a4[0].stato === "stampato" && a4[1].stato === "tolto" && f.filter((x) => x.stato === "stampato").length === 3 && /^Stampato su/.test(rec.pubblico.titolo),
    `tolta solo la seconda lista: le etichette e la prima lista stampate, «Stampato su …» (got ${JSON.stringify(f.map((x) => `${x.breve}:${x.stato}`))} · ${rec && stampaDi(rec.pubblico)})`);
  await sospendi(1000);
  check(lavori().length === 3 && lavori().filter((x) => x.tipo === "a4").length === 1, `all'aiutante tre fogli, mai la lista tolta (got ${lavori().length})`);
}

if (await prova("dal telefono il pacchetto con l'RX: due ordini, laboratorio e radiologia, confermati e stampati da soli")) {
  installa(true);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  await doc.bringToFront();
  await azzeraStampe(doc);
  // come il ponte: il comando alla scheda del gestionale davanti (ponte-sw.js → ponteEsegui)
  const alPc = (cmd, args) => sw.evaluate(async ([cmd, args]) => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(t.id, { t: "ponteEsegui", cmd, args });
  }, [cmd, args]);
  const cat = await alPc("richieste", {});
  const pk = (cat.dati?.pacchetti || []).find((p) => p.q === "Dolore toracico");
  check(!!pk && pk.esami.length === 7 && pk.esami.includes("00120001P:36") && cat.dati.rx.includes("00120001P:36"),
    `il telefono riceve il pacchetto con l'RX torace 1 proiezione, segnato RX (got ${pk && pk.esami.join(",")})`);
  const prima = Object.keys(A.state.richieste);
  const r = await alPc("ordina", { ep: "999001", id: "telpacchetto1", esami: pk ? pk.esami : [], quesito: "Dolore toracico" });
  const o = r.dati?.ordini || [];
  check(r.ok && o.length === 2 && o[0].id === "telpacchetto1l" && !o[0].rx && o[1].id === "telpacchetto1r" && o[1].rx,
    `due ordini: il laboratorio e la radiologia (got ${JSON.stringify(r).slice(0, 160)})`);
  const fatti = await finche(async () => {
    const l = await ordini();
    const due = ["telpacchetto1l", "telpacchetto1r"].map((id) => l.find((x) => x.id === id));
    return due.every((x) => x && x.stato === "avviso" && x.fogli) ? due : null;
  }, 180000);
  const nuove = nuoveDi(prima);
  check(nuove.length === 2 && nuove.every((x) => x.confirmed) && nuove.some((x) => x.cart.has("36")),
    `confermate tutte e due da sole, la RX compresa: non resta nel carrello (got ${nuove.map((x) => `${[...x.cart.keys()]}:${x.confirmed}`).join(" | ")})`);
  check(!!fatti && fatti[1].fogli.length === 1 && fatti[1].fogli[0].breve === "fg:RX" && fatti[1].fogli[0].stato === "stampato",
    `e la prenotazione RX esce sull'A4 (got ${JSON.stringify(fatti && fatti.map((x) => x.fogli.map((f) => `${f.breve}:${f.stato}`)))})`);
  check(lavori().length === 3 && (await stampe(doc)).length === 0, `tre fogli all'aiutante, nessun dialogo (got ${lavori().length})`);
}

if (await prova("i PDF insieme: uno che si rompe si riprende da solo, una volta, dopo l'altro — e si annota")) {
  installa(true);
  await scelte(ATTIVA);
  await sw.evaluate(() => chrome.storage.local.remove("errori.v1"));
  pdfVia.lento = { re: /RcsStampaEtichette|uploaddownloadservlet/, ms: 2000 };   // le etichette arrivano piano…
  pdfVia.rompi = { re: /REPORT=RcsRichiesta/, volte: 1 };                      // …e la lista, intanto, si rompe
  await suPagina(doc, A.patientUrl);
  const { rec } = await ristampaSenzaScheda(doc);
  check(!!rec && rec.stato === "avviso" && rec.fogli.every((x) => x.stato === "stampato") && /^Stampato su/.test(rec.pubblico.titolo),
    `tutti e due stampati (got ${JSON.stringify(rec && [stampaDi(rec.pubblico), rec.fogli.map((x) => x.stato)])})`);
  const l = lavori();
  check(pdfVia.rotti === 1 && l.length === 2 && l[0].tipo === "etichette" && l[1].tipo === "a4",
    `la lista rotta una volta, ripresa dopo le etichette: una volta ciascuno (got ${pdfVia.rotti} rotture · ${JSON.stringify(l.map((x) => x.tipo))})`);
  const err = ((await sw.evaluate(() => chrome.storage.local.get("errori.v1")))["errori.v1"] || []).filter((e) => e.tipo === "stampa-parallela");
  check(err.length === 1 && err[0].dati.tipo === "a4", `e il service worker lo annota: «stampa-parallela» (got ${JSON.stringify(err.map((e) => e.dati))})`);
}

// ---- 18. l'etichetta anagrafica («Stampa Bracciale» del gestionale) ----------
// (il link lo mette questa prova sulla pagina del paziente, come nella pagina
// vera: un jasperservlet REPORT=PsoBraccialettoHMIMU col suo EPISODIO_ID; il
// PDF ha la misura di un'etichetta, e si conta quante volte lo si chiede)
const BRAC_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 142 71]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");
const linkBrac = (ep, origine = "") => `${origine}/jasperserverSAN/jasperservlet?PROJECT=sa4pso&REPORT=PsoBraccialettoHMIMU&CONN=jdbc/sa4web&EPISODIO_ID=${ep}`;
let presiBrac = 0;   // quante volte il PDF del braccialetto è stato chiesto al gestionale
const conBracciale = (...hrefs) => {
  ritocca = (u, out) => {
    const p = new URL(u).searchParams;
    if (p.get("REPORT") === "PsoBraccialettoHMIMU") { presiBrac++; return { status: 200, headers: { "content-type": "application/pdf" }, body: BRAC_PDF }; }
    if (p.get("MVPG") !== "PsoEpisodioClinicoAmbulatorio" || !Buffer.isBuffer(out.body)) return null;
    const a = hrefs.map((h) => `<a class="myButtonList" title="Stampa Bracciale" target="_blank" href="${h.replace(/&/g, "&amp;")}"><img title="Stampa Bracciale" alt=""></a>`).join("&nbsp;");
    return { ...out, body: Buffer.from(out.body.toString("latin1").replace("</body>", `<p>${a}</p></body>`), "latin1") };
  };
};
const bottoneBrac = (p) => p.evaluate(() => {
  const b = document.getElementById("psassist-host")?.shadowRoot?.querySelector("#bracciale");
  return b ? { titolo: b.title, href: b.getAttribute("href"), conto: (b.querySelector(".bracn")?.textContent || "").trim(), spento: !!b.querySelector(".bracn.spenta") } : null;
});
const ordiniBrac = async () => (await ordini()).filter((x) => /^Etichetta anagrafica/.test(x.stampa?.jobs?.[0]?.name || ""));
// (partita una stampa il pannello si riduce alla striscia: per toccare di nuovo lo si riapre)
const tocca = async (p) => {
  if (!(await $panel(p, ".card").count())) { await $panel(p, "#expand").click({ position: { x: 12, y: 8 } }); await p.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  await $panel(p, "#bracciale").click();
};
// tocchi di fila sul bottone, `gap` ms l'uno dall'altro: dentro i 400 ms (CLIC_FINESTRA) che li fanno copie
// (col mouse, sul posto: un clic di Playwright, coi suoi controlli, può metterci più della finestra)
const tocchi = async (p, n, gap = 100) => {
  if (!(await $panel(p, ".card").count())) { await $panel(p, "#expand").click({ position: { x: 12, y: 8 } }); await p.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  const b = await $panel(p, "#bracciale").boundingBox();
  for (let k = 0; k < n; k++) { if (k) await sospendi(gap); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
};
async function intestazione(page) {
  if (!(await $panel(page, ".card").count())) { await $panel(page, "#expand").click({ position: { x: 12, y: 8 } }); await page.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  await $panel(page, '[data-seg="richieste"]').click().catch(() => {});
  await sospendi(300);
}
if (await prova("l'etichetta anagrafica: il bottone accanto al nome, le copie a tocchi, all'etichettatrice")) {
  // senza link, o con quello di un altro episodio (o di un altro sito): niente bottone
  installa(true);
  await scelte(ATTIVA);
  ritocca = null;
  await suPagina(doc, A.patientUrl);
  await intestazione(doc);
  check(!(await bottoneBrac(doc)), "senza il link «Stampa Bracciale» nella pagina: niente bottone");
  conBracciale(linkBrac("999002"), linkBrac("999001", "https://altro.example.org"));
  await suPagina(doc, A.patientUrl);
  await intestazione(doc);
  check(!(await bottoneBrac(doc)), "col link di un altro episodio, o di un altro sito: niente bottone");
  conBracciale(linkBrac("999002"), linkBrac("999001"));
  await suPagina(doc, A.patientUrl);
  await intestazione(doc);
  const b = await bottoneBrac(doc);
  check(!!b && b.titolo === "Etichetta anagrafica" && b.href === A.ORIGIN + linkBrac("999001"),
    `col link di questo episodio: il bottone «Etichetta anagrafica», con l'indirizzo della pagina (got ${JSON.stringify(b)})`);
  if (process.env.BRAC_SHOT) {
    const box = await $panel(doc, ".hd").boundingBox();
    if (box) await doc.screenshot({ path: process.env.BRAC_SHOT, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  }

  // tre tocchi di fila (meno di 400 ms l'uno dall'altro, CLIC_FINESTRA): «×3», poi UNA stampa con tre copie, il PDF preso una volta
  // — e con l'aiutante dalla 4, un foglio solo all'aiutante, «copie: 3» (lento: c'è il tempo di toccare mentre stampa)
  comportati({ lento: 3000 });
  await azzeraStampe(doc);
  presiBrac = 0;
  const nasce = nuovaPagina();
  await tocchi(doc, 3);
  const conto = (await bottoneBrac(doc))?.conto;
  check(conto === "×3" && (await ordiniBrac()).length === 0, `mentre si tocca, il bottone conta le copie e non parte niente (got «${conto}»)`);
  if (process.env.BRAC_SHOT) {
    const box = await $panel(doc, ".hd").boundingBox();
    if (box) await doc.screenshot({ path: process.env.BRAC_SHOT.replace(/\.png$/, "-x3.png"), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  }
  const dietro = await nasce;
  await dietro?.waitForURL(/EPISODIO_ID=/, { timeout: 10000 }).catch(() => {});
  check(!!dietro && dietro.url().includes("EPISODIO_ID=999001") && !/jasperservlet/.test(dietro.url()), "il PDF lo prende una scheda aperta dietro, sulla pagina del paziente");
  const gira = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "stampo"), 10000);
  check(!!gira && gira.fogli.length === 3 && /copia 1 di 3|3 copie/.test(gira.pubblico.dettaglio + " " + sottoDi(gira.pubblico)), `un ordine, tre copie (got ${JSON.stringify(gira && gira.pubblico)})`);
  const tutte3 = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "stampo" && x.fogli.filter((f) => f.stato === "invio").length === 3), 10000);
  check(!!tutte3 && tutte3.pubblico.dettaglio === "3 copie" && tutte3.fogli.every((f) => f.copie === 3),
    `all'aiutante tutte e tre insieme: la striscia dice «3 copie», il giornale «copie: 3» su ogni copia (got ${JSON.stringify(tutte3 && [tutte3.pubblico, tutte3.fogli])})`);
  // un tocco di lato: il pannello resta aperto; ridotto, sotto la pill una riga sola, «Et anag ×3»
  check((await $panel(doc, ".card").count()) === 1, "il pannello resta aperto: l'etichetta anagrafica non lo riduce alla striscia");
  await azzeraRighe(doc);
  if (await $panel(doc, "#collapse").count()) await $panel(doc, "#collapse").click();
  const rigaBrac = await finche(async () => (await righeViste(doc)).find((r) => r.n === "Etichetta anagrafica ×3" && r.svg && r.ico === "pulsa" && !r.x), 8000);
  check(!!rigaBrac && !(await righeViste(doc)).some((r) => /^Etichetta anagrafica/.test(r.n) && r.n !== "Etichetta anagrafica ×3"),
    `sotto la pill una riga sola, [braccialetto] ×3, con la stampantina che respira (got ${JSON.stringify((await righeViste(doc)).map((r) => r.n))})`);
  // un tocco mentre stampa: niente (il bottone pulsa)
  await tocca(doc);
  await sospendi(1400);
  const rec = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "avviso" && x.fogli), 30000);
  check(!!rec && stampaDi(rec.pubblico) === "Etichetta stampata su Zebra ZD421" && rec.stampa.jobs.length === 3 && rec.stampa.jobs.every((j) => j.url === A.ORIGIN + linkBrac("999001")),
    `«Etichetta stampata su Zebra ZD421», col link della pagina (got ${JSON.stringify(rec && [rec.pubblico, rec.stampa.jobs.length])})`);
  if (await $panel(doc, "#collapse").count()) await $panel(doc, "#collapse").click();
  const str = await striscia(doc, /Etichetta stampata su/, 8000);
  check(/Etichetta stampata su Zebra ZD421/.test(str), `la striscia lo dice (got ${str || await striscia(doc, /./, 1000)})`);
  await sospendi(1500);
  const l = lavori();
  check(l.length === 1 && l.every((x) => x.tipo === "etichette" && x.stampante === "Zebra ZD421" && x.ruota === "no" && JSON.stringify(x.pagina) === "[142,71]" && x.copie === 3),
    `all'aiutante un foglio solo con tre copie, all'etichettatrice, dritto (got ${JSON.stringify(l.map((x) => `${x.tipo}→${x.stampante} ×${x.copie}`))})`);
  check(!!rec && rec.fogli.length === 3 && rec.fogli.every((f) => f.stato === "stampato" && f.copie === 3),
    `nel giornale: tre copie, stampate insieme, «copie: 3» (got ${JSON.stringify(rec && rec.fogli)})`);
  check(presiBrac === 1, `il PDF chiesto al gestionale una volta sola (got ${presiBrac})`);
  check((await ordiniBrac()).length === 1 && (await stampe(doc)).length === 0, "il tocco durante la stampa non ha fatto niente: un ordine solo nel giornale, nessuna anteprima");
  check(!!dietro && await aspettaChiusa(dietro), "la scheda dei PDF, finito, si chiude");
  // finita: un tocco è una stampa nuova (il PDF chiesto di nuovo), e parte ~400 ms dopo il tocco, non un secondo
  azzeraLavori();
  if (!(await $panel(doc, ".card").count())) { await $panel(doc, "#expand").click({ position: { x: 12, y: 8 } }); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  await $panel(doc, "#bracciale").waitFor({ timeout: 8000 }).catch(() => {});
  const t0 = Date.now();
  await $panel(doc, "#bracciale").click();
  const nuovo = await finche(async () => (await ordiniBrac()).find((x) => x.id !== rec.id && x.stato === "avviso" && x.fogli), 30000);
  check(!!nuovo && nuovo.fogli.length === 1 && lavori().length === 1 && presiBrac === 2,
    `a stampa finita, un tocco: un ordine nuovo, una copia, il PDF chiesto di nuovo (got ${lavori().length} fogli · ${presiBrac} PDF)`);
  check(!!nuovo && nuovo.ts - t0 >= 350 && nuovo.ts - t0 < 950, `la stampa parte ~400 ms dopo l'ultimo tocco, non dopo un secondo (got ${nuovo ? nuovo.ts - t0 : "?"} ms)`);

  // non si infila fra le etichette di un ordine che sta stampando: le aspetta, poi esce
  azzeraLavori();
  await nessunOrdine();
  comportati({ lento: 5000 });
  const etic = await doc.evaluate(() => new URL(document.querySelector('a[title="Stampa Etichette"]').getAttribute("href"), location.href).href);
  const ordineEtichette = (id) => sw.evaluate(async ([u, id]) => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const jobs = [{ name: "Etichette provette", printer: "etichettatrice", url: u }, { name: "Etichette provette — riga 2", printer: "etichettatrice", url: u + "&x=2" }];
    const l = await ordLeggi();
    l.push({ id, ep: "999001", paziente: "ROSSI MARIO", n: 1, url: null, opener: t.id, worker: t.id, stato: "stampo", pronta: true, ts: Date.now(), agg: Date.now(),
      vista: null, resto: { mancano: [], controllare: [], nel: [] }, stampa: { jobs, tag: "Confermata", fine: null, riassunto: "", quesito: "" }, fogli: fogliNuovi(jobs, await stampaScelte()) });
    await ordScrivi(l);
    ordStampaFogli(id);
  }, [etic, id]);
  await ordineEtichette("ordprova1");
  await finche(() => lavori().length === 1, 15000);
  await tocchi(doc, 2);
  const attesa = await finche(async () => (await ordiniBrac()).find((x) => /dopo le etichette di ROSSI MARIO/.test(sottoDi(x.pubblico) || "")), 15000);
  check(!!attesa, `mentre l'ordine stampa le sue etichette, l'etichetta anagrafica aspetta, e lo dice (got ${JSON.stringify((await ordini()).map((x) => x.pubblico))})`);
  const inCoda = await finche(async () => { const b = await bottoneBrac(doc); return b && b.conto === "×2" && b.spento ? b : null; }, 4000);
  check(!!inCoda, `in coda, il bottone tiene «×2», spento, finché non stampa (got ${JSON.stringify(await bottoneBrac(doc))})`);
  await azzeraRighe(doc);
  if (await $panel(doc, "#collapse").count()) await $panel(doc, "#collapse").click();
  const rigaCoda = await finche(async () => (await righeViste(doc)).find((r) => r.n === "Etichetta anagrafica ×2" && r.att && r.w === "0%"), 4000);
  check(!!rigaCoda, `e la sua riga sotto la pill: barra vuota, la clessidra al posto del ✕ (got ${JSON.stringify(await righeViste(doc))})`);
  const finita = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "avviso"), 40000);
  const ll = lavori();
  check(!!finita && ll.length === 3 && ll.every((x) => x.tipo === "etichette") && JSON.stringify(ll.map((x) => JSON.stringify(x.pagina) === "[142,71]")) === "[false,false,true]" && ll[2].copie === 2,
    `prima le due etichette dell'ordine, poi le due copie dell'etichetta anagrafica, in un foglio (got ${JSON.stringify(ll.map((x) => [x.pagina, x.copie]))})`);
  check(!(await bottoneBrac(doc))?.conto, "stampata: il bottone torna senza numero");

  // in coda, la clessidra è il ✕: toccata, l'etichetta anagrafica non esce (le etichette dell'ordine sì)
  azzeraLavori();
  await nessunOrdine();
  await ordineEtichette("ordprova2");
  await finche(() => lavori().length === 1, 15000);
  await tocca(doc);
  await finche(async () => (await ordiniBrac()).find((x) => /dopo le etichette di/.test(sottoDi(x.pubblico) || "")), 15000);
  if (await $panel(doc, "#collapse").count()) await $panel(doc, "#collapse").click();
  await $panel(doc, ".pjx.att").hover().catch(() => {});
  const visibile = await $panel(doc, ".pjx.att .pjxx").isVisible().catch(() => false);
  await $panel(doc, ".pjx.att").click().catch(() => {});
  const via = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "avviso" && x.fogli.every((f) => f.stato === "tolto")), 15000);
  await finche(async () => (await ordini()).find((x) => x.id === "ordprova2" && x.stato === "avviso"), 20000);
  await sospendi(1000);
  check(visibile && !!via && lavori().length === 2 && lavori().every((x) => JSON.stringify(x.pagina) !== "[142,71]"),
    `al passaggio la clessidra è il ✕, e toglie l'etichetta anagrafica in coda: escono solo le etichette dell'ordine (got ${visibile} · ${lavori().length} fogli)`);

  // fino a dieci copie: l'undicesimo tocco non ne aggiunge
  azzeraLavori();
  await nessunOrdine();
  comportati();
  await tocchi(doc, 11, 60);
  const dieci = (await bottoneBrac(doc))?.conto;
  const tutte = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "avviso" && x.fogli.length === 10), 60000);
  await sospendi(1000);
  check(dieci === "×10" && !!tutte && lavori().length === 1 && lavori()[0].copie === 10, `undici tocchi: «×10», e dieci copie all'etichettatrice, in un foglio (got «${dieci}» · ${JSON.stringify(lavori().map((x) => x.copie))})`);

  // l'aiutante di prima (la 3, che delle copie non sa niente): tre tocchi, tre fogli uno a uno, come sempre
  azzeraLavori();
  await nessunOrdine();
  await sw.evaluate(() => chrome.storage.local.remove("stampaAiutante"));
  comportati({ versione: "3" });
  presiBrac = 0;
  await azzeraRighe(doc);
  await tocchi(doc, 3);
  const v3 = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "avviso" && x.fogli), 30000);
  await sospendi(1000);
  const l3 = lavori();
  check(!!v3 && l3.length === 3 && l3.every((x) => x.copie === 1 && x.chieste === undefined) && presiBrac === 1 && v3.fogli.every((f) => f.stato === "stampato" && !f.copie)
    && stampaDi(v3.pubblico) === "Etichetta stampata su Zebra ZD421",
  `aiutante 3: tre fogli, uno a uno, senza «copie» (il PDF preso una volta), «Etichetta stampata» (got ${JSON.stringify(l3.map((x) => [x.copie, x.chieste]))} · ${presiBrac} PDF · ${JSON.stringify(v3 && v3.fogli.map((f) => f.stato))})`);
  const rv3 = (await righeViste(doc)).filter((r) => /^Etichetta anagrafica/.test(r.n)).map((r) => r.n);
  check(rv3.length > 0 && rv3.every((x) => x === "Etichetta anagrafica ×3"), `e sotto la pill la riga «×3» (got ${JSON.stringify(rv3)})`);
  // …e se l'estensione la crede una 4 (rimessa la 3 a mano): le copie che non dice di aver fatto partono una a una
  azzeraLavori();
  await nessunOrdine();
  await sw.evaluate(() => chrome.storage.local.set({ stampaAiutante: "4" }));
  await tocchi(doc, 3);
  const finta = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "avviso" && x.fogli), 30000);
  await sospendi(1000);
  const lf = lavori();
  check(!!finta && lf.length === 3 && lf[0].chieste === 3 && lf.every((x) => x.copie === 1) && lf.slice(1).every((x) => x.chieste === undefined)
    && finta.fogli.every((f) => f.stato === "stampato"),
  `creduta una 4, la 3 ne stampa una: le altre due dopo, una a una — tre in tutto, mai «tre» detto per una (got ${JSON.stringify(lf.map((x) => [x.chieste, x.copie]))})`);
  comportati();

  // un'etichettatrice che non va, due copie: una prova sola all'aiutante (un foglio, «copie: 2»), al dialogo una volta («2 copie»),
  // e nel registro degli errori senza nomi
  azzeraLavori();
  await nessunOrdine();
  await sw.evaluate(() => chrome.storage.local.remove(["errori.v1", "stampaAiutante"]));
  comportati({ rompi: { "Zebra ZD421": "la stampante (o il suo driver) ha dato errore" } });
  await tocchi(doc, 2);
  await aspettaScheda(doc, "s.stato === 'stampo'", 20000);
  const s = await scheda(doc);
  check(lavori().length === 1 && lavori()[0].chieste === 2 && !!s && /^Stampa 1 di 1 — Etichetta anagrafica/.test(s.doc) && /2 copie/.test(s.avviso) && /etichettatrice/.test(s.dest),
    `la copia che non esce: le altre non ci riprovano, il dialogo una volta, con quante copie (got ${lavori().length} · ${JSON.stringify(s)})`);
  const err = ((await sw.evaluate(() => chrome.storage.local.get("errori.v1")))["errori.v1"] || []).filter((x) => x.tipo === "stampa" && x.dati.bracciale);
  check(err.length === 1 && err[0].dati.esito === "fallito" && err[0].dati.copie === 2 && !/ROSSI|MARIO|BIANCHI/.test(JSON.stringify(err)),
    `nel registro degli errori, senza nomi (got ${JSON.stringify(err)})`);
  await chiudiStampa(doc);

  // senza la stampa automatica: il link si apre in una scheda, come dal gestionale, e basta
  installa(false);
  await scelte(null);
  azzeraLavori();
  await nessunOrdine();
  presiBrac = 0;
  await suPagina(doc, A.patientUrl);
  await intestazione(doc);
  await finche(async () => !(await stampantina(doc)), 5000);
  await azzeraStampe(doc);
  const apre = nuovaPagina(8000);
  await tocca(doc);
  const t = await apre;
  await sospendi(1500);
  check(!!t && t.url() === A.ORIGIN + linkBrac("999001") && presiBrac === 1 && lavori().length === 0 && (await ordini()).length === 0 && (await stampe(doc)).length === 0,
    `senza stampa automatica: il PDF si apre in una scheda, nient'altro (got ${t ? t.url() : "niente"} · ${presiBrac} PDF · ${lavori().length} fogli · ${JSON.stringify((await ordini()).map((x) => [x.stato, x.pubblico]))} · ${(await stampe(doc)).length} schede)`);
  if (t) await t.close();
  ritocca = null;
}

// ---- 19. le icone di stampa del gestionale: un clic il PDF, due la stampa ---
// (le icone come nella pagina vera: le etichette nella finestra «SA4RCS», gli
// altri fogli e l'etichetta anagrafica in una scheda nuova. Una spia nella
// pagina annota i clic veri appena arrivano, e quelli che arrivano al link —
// veri, o ridati dall'estensione — col gesto del medico ancora valido o no —,
// e le pressioni sul link: la seconda di un doppio clic è quella che seleziona.
// E il «×N» che l'estensione mette accanto all'icona «Stampa Bracciale» mentre
// si clicca: ogni suo stato, dov'è rispetto all'icona, e se la pagina — il
// body del gestionale — è rimasta com'era.)
const spia = (p) => p.evaluate(() => {
  window.__clic = []; window.__link = []; window.__giu = []; window.__conto = []; window.__corpo = document.body.innerHTML;
  setInterval(() => {
    const h = document.getElementById("psassist-conto"), b = h && h.shadowRoot && h.shadowRoot.querySelector("b");
    const v = b ? b.textContent : "", prima = window.__conto[window.__conto.length - 1];
    if (v === (prima ? prima.v : "")) return;
    const q = b && b.getBoundingClientRect(), a = document.querySelector('a[title="Stampa Bracciale"][href*="EPISODIO_ID=999001"]').getBoundingClientRect();
    window.__conto.push({ v, t: Date.now(), b: q ? [Math.round(q.right), Math.round(q.top)] : null, a: [Math.round(a.right), Math.round(a.top)],
      fuori: !!h && h.parentNode === document.documentElement, uguale: document.body.innerHTML === window.__corpo });
  }, 15);
  window.addEventListener("click", (e) => { if (e.isTrusted) window.__clic.push(Date.now()); }, true);
  for (const a of document.querySelectorAll('a[title^="Stampa"]')) {
    a.addEventListener("click", (e) => window.__link.push({ t: Date.now(), vero: e.isTrusted, attiva: navigator.userActivation.isActive, prev: e.defaultPrevented, titolo: a.title }));
    a.addEventListener("mousedown", (e) => window.__giu.push({ n: e.detail, prev: e.defaultPrevented }));
  }
});
const spiato = (p) => p.evaluate(() => ({ clic: window.__clic, link: window.__link, giu: window.__giu, conto: window.__conto, sel: String(getSelection()) }))
  .catch(() => ({ clic: [], link: [], giu: [], conto: [], sel: "?" }));
const azzeraSpia = (p) => p.evaluate(() => { window.__clic = []; window.__link = []; window.__giu = []; window.__conto = []; getSelection().removeAllRanges(); window.__corpo = document.body.innerHTML; });
if (await prova("doppio clic sulle icone di stampa del gestionale: uno apre il PDF, due (o tre) lo stampano alla sua stampante; l'etichetta anagrafica a clic")) {
  installa(true);
  await scelte(ATTIVA);
  A = createMock({ seedConfirmed: true, seedConfirmedRadio: true });   // (anche una richiesta RX confermata)
  conBracciale(linkBrac("999002"), linkBrac("999001"));
  const brac = ritocca;
  ritocca = (u, out) => {
    const o = brac(u, out) || out;
    if (new URL(u).searchParams.get("MVPG") !== "PsoEpisodioClinicoAmbulatorio" || !Buffer.isBuffer(o.body)) return o;
    const h = o.body.toString("latin1").replace(/title="Stampa Etichette"/g, '$& target="SA4RCS"')
      .replace(/title="Stampa (Richiesta|Richiesta Radiologia|Prenotazione Esterna)"/g, '$& target="_blank"')
      .replace(/<img title="Stampa Bracciale" alt="">/g, '<img title="Stampa Bracciale" alt="bracciale">');   // (un'icona che si vede, da cliccare)
    return { ...o, body: Buffer.from(h, "latin1") };
  };
  const aperte = [], segna = (p) => aperte.push(p);
  ctx.on("page", segna);
  const fogliAperti = () => aperte.filter((p) => !p.isClosed() && /RcsStampaEtichetteLISHMIMU|jasperservlet/.test(p.url())).map((p) => p.url());
  const chiudiAperte = async () => { for (const p of aperte.splice(0)) if (!p.isClosed()) await p.close().catch(() => {}); };
  const daCapo = async () => { await nessunOrdine(); azzeraLavori(); await azzeraSpia(doc); await azzeraRighe(doc); await chiudiAperte(); presiBrac = 0; };
  const finito = () => finche(async () => (await ordini()).find((x) => x.stato !== "stampo" && x.stampa?.jobs?.length), 30000);
  const ETIC = 'a[title="Stampa Etichette"][href*="RICHIESTA_ID=699999"]', LISTA = 'a[title="Stampa Richiesta"][href*="RICHIESTA_ID=699999"]',
    RX = 'a[title="Stampa Richiesta Radiologia"]', BRAC = 'a[title="Stampa Bracciale"][href*="EPISODIO_ID=999001"]', BRAC_ALTRO = 'a[title="Stampa Bracciale"][href*="EPISODIO_ID=999002"]';
  const icona = (sel) => doc.locator(sel).first();
  await suPagina(doc, A.patientUrl);
  await intestazione(doc);
  check(!!(await finche(() => stampantina(doc), 5000)), "la stampa automatica è accesa");
  if (await $panel(doc, "#collapse").count()) await $panel(doc, "#collapse").click();
  await spia(doc);
  await daCapo();

  // un clic sulle etichette: il PDF di sempre, nella sua finestra — quel clic, ridato ~400 ms dopo
  const apre = nuovaPagina(8000);
  await icona(ETIC).click();
  const pdf = await apre;
  await pdf?.waitForURL(/RcsStampaEtichetteLISHMIMU/, { timeout: 8000 }).catch(() => {});
  let s = await spiato(doc);
  const nome = pdf ? await pdf.evaluate(() => window.name).catch(() => "?") : "";
  check(!!pdf && /RcsStampaEtichetteLISHMIMU\.do\?RICHIESTA_ID=699999&RICHIESTA_PROG=1$/.test(pdf.url()) && nome === "SA4RCS",
    `un clic sulle etichette: il PDF di sempre, nella finestra «SA4RCS» (got ${pdf ? pdf.url().slice(-60) : "niente"} · «${nome}»)`);
  const r0 = s.link[0] || {};
  check(s.link.length === 1 && !r0.vero && r0.attiva === true && r0.t - s.clic[0] >= 350 && r0.t - s.clic[0] < 1500,
    `è quel clic, ridato ~400 ms dopo (quando un secondo non arriva), col gesto del medico ancora valido (got ${JSON.stringify(s)})`);
  await sospendi(800);
  check(lavori().length === 0 && (await ordini()).length === 0, "e non stampa niente");

  // due clic: le etichette all'etichettatrice, una volta; niente PDF, niente testo selezionato, la riga sotto la pill
  await daCapo();
  await icona(ETIC).dblclick();
  const et = await finito();
  s = await spiato(doc);
  const l1 = lavori();
  check(!!et && et.stampa.jobs.length === 1 && et.stampa.jobs[0].name === "Etichette provette" && /RICHIESTA_ID=699999/.test(et.stampa.jobs[0].url)
    && l1.length === 1 && l1[0].tipo === "etichette" && l1[0].stampante === "Zebra ZD421",
  `doppio clic sulle etichette: stampate una volta, all'etichettatrice (got ${JSON.stringify(et && et.stampa.jobs.map((j) => j.name))} · ${JSON.stringify(l1.map((x) => `${x.tipo}→${x.stampante}`))})`);
  check(!!et && et.ts - s.clic[1] >= 350 && et.ts - s.clic[1] < 1500, `la stampa parte ~400 ms dopo l'ultimo clic (got ${et ? et.ts - s.clic[1] : "?"} ms)`);
  check(s.link.length === 0 && !fogliAperti().length && (await stampe(doc)).length === 0,
    `nessun PDF aperto, nessuna anteprima (got ${s.link.length} clic al link · ${JSON.stringify(fogliAperti())})`);
  check(s.sel === "" && s.giu.length === 2 && !s.giu[0].prev && s.giu[1].n === 2 && s.giu[1].prev,
    `il doppio clic non seleziona il testo: la prima pressione com'è, la seconda senza selezione (got «${s.sel}» · ${JSON.stringify(s.giu)})`);
  const re = (await righeViste(doc)).map((x) => x.n);
  check(re.some((n) => /^Etichette/.test(n)), `sotto la pill la sua riga (got ${JSON.stringify(re)})`);

  // tre clic sulla lista esami: all'A4, sempre una volta
  await daCapo();
  await icona(LISTA).click({ clickCount: 3 });
  const li = await finito();
  await sospendi(1500);
  s = await spiato(doc);
  const l2 = lavori();
  check(!!li && (await ordini()).length === 1 && li.stampa.jobs.length === 1 && li.stampa.jobs[0].name === "Lista esami" && l2.length === 1 && l2[0].tipo === "a4"
    && l2[0].stampante === "HP LaserJet A4" && !s.link.length && !fogliAperti().length,
  `tre clic su «Stampa Richiesta»: la lista esami una volta, all'A4, nessun PDF aperto (got ${JSON.stringify(li && li.stampa.jobs.map((j) => j.name))} · ${JSON.stringify(l2.map((x) => `${x.tipo}→${x.stampante}`))} · ${s.link.length})`);

  // due clic sul foglio RX: all'A4
  await daCapo();
  await icona(RX).dblclick();
  const rx = await finito();
  const l3 = lavori();
  check(!!rx && rx.stampa.jobs.length === 1 && rx.stampa.jobs[0].name === "Richiesta radiologia" && /RICHIESTA_ID=699998/.test(rx.stampa.jobs[0].url)
    && l3.length === 1 && l3[0].tipo === "a4" && l3[0].stampante === "HP LaserJet A4" && !fogliAperti().length,
  `doppio clic sul foglio RX: all'A4, una volta (got ${JSON.stringify(rx && rx.stampa.jobs.map((j) => j.name))} · ${JSON.stringify(l3.map((x) => `${x.tipo}→${x.stampante}`))})`);

  // la finestra dei 400 ms: due clic a ~200 ms sono un doppio clic; a ~700 ms, due clic soli (due volte il PDF)
  await daCapo();
  await icona(ETIC).click(); await sospendi(150); await icona(ETIC).click();
  const vicini = await finito();
  s = await spiato(doc);
  check(!!vicini && lavori().length === 1 && !s.link.length && s.clic.length === 2 && s.clic[1] - s.clic[0] < 400,
    `due clic a ${s.clic[1] - s.clic[0]} ms l'uno dall'altro: una stampa (got ${lavori().length} fogli · ${s.link.length} PDF)`);
  await daCapo();
  const apre2 = nuovaPagina(8000);
  await icona(ETIC).click(); await sospendi(700); await icona(ETIC).click();
  await apre2;
  await sospendi(1500);
  s = await spiato(doc);
  check(lavori().length === 0 && (await ordini()).length === 0 && s.link.length === 2 && s.link.every((x) => !x.vero && x.attiva === true) && s.clic[1] - s.clic[0] >= 400,
    `due clic a ${s.clic[1] - s.clic[0]} ms: due volte il PDF, nessuna stampa (got ${lavori().length} fogli · ${JSON.stringify(s.link)})`);

  // l'etichetta anagrafica del gestionale: un clic il PDF, come sempre…
  await daCapo();
  const apre3 = nuovaPagina(8000);
  await icona(BRAC).click();
  const bp = await apre3;
  await bp?.waitForURL(/PsoBraccialettoHMIMU/, { timeout: 8000 }).catch(() => {});
  await sospendi(800);
  s = await spiato(doc);
  check(!!bp && bp.url() === A.ORIGIN + linkBrac("999001") && s.link.length === 1 && !s.link[0].vero && s.link[0].attiva === true
    && lavori().length === 0 && (await ordini()).length === 0,
  `un clic su «Stampa Bracciale»: il PDF in una scheda, come sempre (got ${bp ? bp.url().slice(-50) : "niente"} · ${JSON.stringify(s.link)} · ${lavori().length} fogli)`);
  check(s.conto.length === 0, `e accanto all'icona nessun «×N» (got ${JSON.stringify(s.conto)})`);
  // …due o tre: UNA stampa con quelle copie, il PDF preso una volta, una riga sola «×N»
  for (const n of [2, 3]) {
    await daCapo();
    await icona(BRAC).click({ clickCount: n });
    const rec = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "avviso" && x.fogli), 30000);
    await sospendi(1000);
    s = await spiato(doc);
    const lb = lavori();
    check(!!rec && (await ordiniBrac()).length === 1 && rec.fogli.length === n && lb.length === 1 && lb[0].copie === n && lb.every((x) => x.tipo === "etichette" && x.stampante === "Zebra ZD421")
      && presiBrac === 1 && !s.link.length && !fogliAperti().length,
    `${n} clic su «Stampa Bracciale»: una stampa con ${n} copie all'etichettatrice, in un foglio, il PDF preso una volta, nessuna scheda (got ${rec ? rec.fogli.length : 0} copie · ${lb.length} fogli · ${presiBrac} PDF · ${s.link.length})`);
    const rb = (await righeViste(doc)).filter((r) => /^Etichetta anagrafica/.test(r.n)).map((r) => r.n);
    check(rb.length > 0 && rb.every((x) => x === `Etichetta anagrafica ×${n}`), `sotto la pill una riga sola, «×${n}» (got ${JSON.stringify(rb)})`);
    const vn = s.conto.filter((x) => x.v).map((x) => x.v);
    check(vn[vn.length - 1] === `×${n}` && s.conto[s.conto.length - 1].v === "" && !(await doc.evaluate(() => !!document.getElementById("psassist-conto"))),
      `e accanto all'icona, mentre contava, «×${n}», poi più niente (got ${JSON.stringify(s.conto.map((x) => x.v))})`);
  }
  // mentre si clicca, il «×N» accanto all'icona: «×2» al secondo clic, «×3» al terzo, attaccato all'icona,
  // senza toccare la pagina; partita la stampa, se ne va (sotto la pill c'è la riga)
  await daCapo();
  const bb = await icona(BRAC).boundingBox();
  const clicca = () => doc.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await clicca();
  await sospendi(150);
  const c1 = (await spiato(doc)).conto.map((x) => x.v);
  await clicca();
  await sospendi(150);
  const c2 = (await spiato(doc)).conto.filter((x) => x.v).map((x) => x.v);
  await clicca();
  const parte = await finche(async () => (await ordiniBrac())[0], 10000);
  const sparito = await doc.evaluate(() => !document.getElementById("psassist-conto"));
  const tre = await finche(async () => (await ordiniBrac()).find((x) => x.stato === "avviso" && x.fogli), 30000);
  s = await spiato(doc);
  const visti = s.conto.filter((x) => x.v);
  check(c1.length === 0 && JSON.stringify(c2) === '["×2"]' && JSON.stringify(visti.map((x) => x.v)) === '["×2","×3"]',
    `accanto all'icona: niente al primo clic, «×2» al secondo, «×3» al terzo (got ${JSON.stringify(c1)} · ${JSON.stringify(c2)} · ${JSON.stringify(visti.map((x) => x.v))})`);
  check(visti.length === 2 && visti.every((x) => x.b && Math.abs(x.b[0] - (x.a[0] + 6)) <= 1 && Math.abs(x.b[1] - (x.a[1] - 4)) <= 1),
    `sull'angolo dell'icona, come sul bottone del pannello (got ${JSON.stringify(visti.map((x) => [x.b, x.a]))})`);
  check(visti.length === 2 && visti.every((x) => x.fuori && x.uguale), `un elemento nostro, fuori dal body: la pagina del gestionale resta com'era (got ${JSON.stringify(visti)})`);
  const fine = s.conto[s.conto.length - 1] || {};
  check(sparito && fine.v === "" && !!parte && fine.t <= parte.ts + 300 && !!tre && tre.fogli.length === 3,
    `partita la stampa (tre copie) il «×3» se ne va (got ${sparito} · ${JSON.stringify(fine)} · ordine alle ${parte ? parte.ts : "?"} · ${tre ? tre.fogli.length : 0} copie)`);
  // un doppio clic mentre quella stampa gira: niente (né copie né PDF)
  await daCapo();
  comportati({ lento: 2000 });
  await icona(BRAC).dblclick();
  await finche(async () => (await ordiniBrac()).find((x) => x.stato === "stampo"), 10000);
  await sospendi(600);
  await icona(BRAC).dblclick();
  await finche(async () => (await ordiniBrac()).find((x) => x.stato === "avviso"), 30000);
  await sospendi(1000);
  s = await spiato(doc);
  check((await ordiniBrac()).length === 1 && lavori().length === 1 && lavori()[0].copie === 2 && presiBrac === 1 && !s.link.length && !fogliAperti().length,
    `un doppio clic mentre stampa: niente, né copie né PDF (got ${(await ordiniBrac()).length} ordini · ${lavori().length} fogli · ${s.link.length})`);
  comportati();

  // i link che non sono suoi passano com'è, subito: l'etichetta anagrafica di un altro episodio, un link di un altro sito
  await daCapo();
  const apre4 = nuovaPagina(8000);
  await icona(BRAC_ALTRO).click();
  const ap = await apre4;
  s = await spiato(doc);
  check(!!ap && s.link.length === 1 && s.link[0].vero && !s.link[0].prev, `«Stampa Bracciale» di un altro episodio: il clic arriva al link com'è (got ${JSON.stringify(s.link)})`);
  await doc.evaluate(() => {
    const a = document.createElement("a");
    a.title = "Stampa Etichette"; a.id = "altrove"; a.textContent = "etichette altrove";
    a.href = "https://altro.example.org/sa4pso/restrict/RcsStampaEtichetteLISHMIMU.do?RICHIESTA_ID=600001&RICHIESTA_PROG=1";
    a.addEventListener("click", (e) => { window.__link.push({ vero: e.isTrusted, prev: e.defaultPrevented, titolo: "altrove" }); e.preventDefault(); });
    document.body.prepend(a);
  });
  await azzeraSpia(doc);
  await doc.locator("#altrove").dblclick();
  await sospendi(800);
  s = await spiato(doc);
  check(s.link.length === 2 && s.link.every((x) => x.vero && !x.prev) && lavori().length === 0,
    `«Stampa Etichette» di un altro sito: i due clic arrivano al link com'è, niente stampa (got ${JSON.stringify(s.link)})`);

  // senza le due stampanti (com'è, dopo l'aggiornamento, un PC che la stampa automatica l'aveva spenta):
  // nessuna attesa, il doppio clic è quello della pagina
  await scelte(null);
  await finche(async () => !(await stampantina(doc)), 3000);
  await sospendi(500);
  await daCapo();
  const apre5 = nuovaPagina(8000);
  await icona(LISTA).click();
  const lp = await apre5;
  s = await spiato(doc);
  check(!!lp && s.link.length === 1 && s.link[0].vero && !s.link[0].prev, `spenta: il clic arriva al link com'è, subito, e il PDF si apre (got ${JSON.stringify(s.link)})`);
  await azzeraSpia(doc);
  await icona(ETIC).dblclick();
  await sospendi(1500);
  s = await spiato(doc);
  check(s.link.length >= 1 && s.link.length === s.clic.length && s.link.every((x) => x.vero && !x.prev) && s.giu.every((x) => !x.prev) && lavori().length === 0 && (await ordini()).length === 0,
    `spenta: il doppio clic è quello della pagina — ogni clic che le arriva va al link com'è —, niente stampa (got ${JSON.stringify(s.link)} · ${s.clic.length} clic veri · ${lavori().length})`);
  ctx.off("page", segna);
  await chiudiAperte();
  ritocca = null;
  await scelte(ATTIVA);   // (le stampanti di prima: com'era)
}

// ---- l'etichetta libera (⋯ → Etichetta): anteprima, PDF uguale, copie, una volta sola ----------------
if (await prova("l'etichetta libera dal pannello: l'anteprima alla misura vera, il PDF uguale, ×3 in un lavoro, rimandata non si ristampa")) {
  installa(true);
  await scelte(ATTIVA);
  // (i PDF che arrivano all'aiutante, per guardarli: il finto annota solo la misura)
  await sw.evaluate(() => {
    self.__ospiteEti = self.__ospiteEti || ospite;
    self.__pdfEti = [];
    ospite = (m, t) => { if (m && m.t === "stampa") self.__pdfEti.push(m.pdf); return self.__ospiteEti(m, t); };
  });
  await suPagina(doc, A.patientUrl);
  await menu(doc);
  await $panel(doc, "#etimenu").click();
  await $panel(doc, "#etitesto").waitFor({ timeout: 8000 });
  const TESTO = "ROSSI MARIO 01/02/1950\nProvetta extra · ore 14:30\nàèìòù °C";
  await $panel(doc, "#etitesto").fill(TESTO);
  await finche(async () => (await $panel(doc, "#etiant svg text").count()) === 3, 8000);
  await $panel(doc, "#eticopie").fill("3");
  await $panel(doc, "#eticopie").dispatchEvent("change");
  const ant = await doc.evaluate(() => {
    const s = document.getElementById("psassist-host").shadowRoot.querySelector("#etiant svg");
    const r = s.getBoundingClientRect();
    return { w: s.getAttribute("width"), h: s.getAttribute("height"), vb: s.getAttribute("viewBox"), px: [r.width, r.height],
      righe: [...s.querySelectorAll("text")].map((t) => ({ x: +t.getAttribute("x"), y: +t.getAttribute("y"), c: +t.getAttribute("font-size"), l: +t.getAttribute("textLength"), t: t.textContent })) };
  });
  check(ant.w === "50.09mm" && ant.h === "25.05mm" && ant.vb === "0 0 142 71" && Math.abs(ant.px[0] - 142 * 96 / 72) < 2,
    `l'anteprima ha la misura vera dell'etichetta: 50×25 mm (got ${ant.w}×${ant.h}, ${ant.px.map(Math.round)} px)`);
  await shot(doc, "etichetta-pannello");
  const prima = lavori().length;
  await $panel(doc, "#etistampa").click();
  const esito = await finche(async () => { const t = await $panel(doc, "#etiesito").innerText().catch(() => ""); return /Stampato|NON|Mandat|sconosciuto/.test(t) ? t : ""; }, 40000) || "";
  const nuovi = lavori().slice(prima);
  check(/Stampato su Zebra ZD421/.test(esito) && nuovi.length === 1 && nuovi[0].tipo === "etichette" && nuovi[0].stampante === "Zebra ZD421" && nuovi[0].copie === 3 && nuovi[0].ruota === "no"
    && JSON.stringify(nuovi[0].pagina) === "[142,71]",
    `«Stampa»: un lavoro all'etichettatrice, 3 copie, 142×71 pt, non girata, e il pannello dice com'è andata (got «${esito}»; ${JSON.stringify(nuovi)})`);
  const pdf = Buffer.from((await sw.evaluate(() => self.__pdfEti))[0] || "", "base64").toString("latin1");
  const pr = [...pdf.matchAll(/BT \/F1 ([\d.]+) Tf ([\d.]+) ([\d.]+) Td \(((?:\\.|[^\\)])*)\) Tj ET/g)].map((x) => ({ c: +x[1], x: +x[2], y: 71 - x[3], t: x[4].replace(/\\(.)/g, "$1") }));
  const dec = (s) => Buffer.from(s, "latin1").toString("latin1");
  check(/\/MediaBox \[0 0 142 71\]/.test(pdf) && /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/.test(pdf) && !/FontFile|\/URI|http/.test(pdf)
    && pr.length === 3 && pr.every((p, i) => p.c === ant.righe[i].c && p.x === ant.righe[i].x && Math.abs(p.y - ant.righe[i].y) < 0.011 && dec(p.t) === ant.righe[i].t)
    && ant.righe.map((r) => r.t).join("\n") === TESTO,
    `il PDF è l'anteprima: stessa pagina, stesse righe, stesso corpo, stessi punti; Helvetica di base, niente incorporato né da fuori (got ${JSON.stringify(pr)} vs ${JSON.stringify(ant.righe)})`);
  const log = await doc.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".log")?.textContent || "").catch(() => "");
  const stato = await sw.evaluate(() => chrome.storage.session.get(null).then((o) => JSON.stringify(o)));
  check(!stato.includes("ROSSI MARIO 01/02") && !stato.includes("Provetta extra"), "il testo non resta nella memoria dell'estensione (né nel giornale delle stampe)");
  // rimandata (la risposta persa): lo stesso numero non stampa una seconda volta, e dice com'è andata
  const r1 = await sw.evaluate(() => etichettaStampa({ testo: "PROVA", copie: 1, dest: "qui", rid: "etprova00001" }).then((s) => etichettaEsito(s)));
  await finche(() => lavori().length > prima + 1, 15000);
  const r2 = await sw.evaluate(() => etichettaStampa({ testo: "PROVA", copie: 1, dest: "qui", rid: "etprova00001" }).then((s) => ({ s, e: null })));
  await sospendi(1500);
  check(r1.tono === "ok" && r2.s.ok && r2.s.fogli[0].gia && lavori().length === prima + 2, `lo stesso numero rimandato: nessuna seconda stampa (got ${JSON.stringify(r2.s.fogli)}; ${lavori().length - prima} lavori)`);
  // la misura cambiata dopo l'anteprima: niente stampa
  const r3 = await sw.evaluate(() => etichettaStampa({ testo: "PROVA", copie: 1, dest: "qui", rid: "etprova00002", misura: [100, 50] }));
  check(!r3.ok && /misura/.test(r3.errore) && lavori().length === prima + 2, `l'anteprima guardata su un'altra misura: non stampa (${r3.errore})`);
  void log;
  await sw.evaluate(() => { if (self.__ospiteEti) ospite = self.__ospiteEti; });
}

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(FINTO, { recursive: true, force: true });
console.log(fail ? `\nSTAMPA-ESTENSIONE: ${fail} CHECK FALLITI\n` : "\nSTAMPA-ESTENSIONE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
