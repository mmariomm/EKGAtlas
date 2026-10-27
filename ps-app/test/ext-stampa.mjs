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
 * vanno da soli alla loro stampante, senza dialogo, una volta sola; un foglio
 * che non esce passa dal dialogo, col motivo, e solo lui; l'aiutante sparito o
 * che non parte; l'interruttore e la stampantina in intestazione; l'ordine in
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
import { createMock } from "./sa4pso-mock.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";

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
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
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
const azzeraLavori = () => rmSync(join(FINTO, "lavori.jsonl"), { force: true });
const lanciatore = join(FINTO, "ospite.sh");
writeFileSync(lanciatore, `#!/bin/sh\nPSA_FINTO='${FINTO}' exec '${process.execPath}' '${join(root, "test/ospite-finto.mjs")}' "$@"\n`);
chmodSync(lanciatore, 0o755);
comportati();

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 })); } catch { /* niente */ }
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
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  const u = req.url();
  const mock = quale(u);
  let out = mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, u).href });
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
    const t = (document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run")?.innerText || "").replace(/\s+/g, " ").trim();
    return new RegExp(src).test(t) ? t : false;
  }, re.source, { timeout }).catch(() => null);
  return h ? h.jsonValue() : "";
};
const azione = (p) => $panel(p, "#strazione").innerText().then((t) => t.trim()).catch(() => "");
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
    await $panel(page, "#expand").click();
    await page.waitForSelector("#psassist-host .card", { timeout: 8000 });
  }
  if (!(await $panel(page, "#q").count())) await $panel(page, '[data-seg="richieste"]').click();
  await $panel(page, "#q").waitFor({ timeout: 8000 });
}
// la sezione Stampa della pagina del paziente: etichette e lista della richiesta già confermata
async function ristampaDallaPagina(page) {
  await apriPannello(page);
  await $panel(page, '[data-print="699999"]').first().click();
  await page.waitForSelector("#psassist-print", { state: "attached", timeout: 10000 });
}
async function ordina(page, esami) {
  await apriPannello(page);
  await $panel(page, "#q").fill("dolore toracico");
  for (const e of esami) await $panel(page, `.opt[title*="${e}"]`).click();
  await $panel(page, "#goconfirm").click();
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
async function chiudiStampa(p) {
  await p.keyboard.press("Escape").catch(() => {});
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
  nuovi(); azzeraLavori(); comportati();
  await nessunOrdine();
  await pazienza(0);
  // (l'esito dell'ultima stampa, e la domanda «l'aiutante c'è?» di nuovo)
  await sw.evaluate(() => Promise.all([chrome.storage.local.remove(["stampaEsito", "stampaMisura"]), chrome.storage.session.remove("stampaVerificata")]));
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
  check(/Stampanti/.test(voci) && !/Stampa automatica:/.test(voci), `nel menu ⋯: «Stampanti», non l'interruttore (got: ${voci})`);
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
  check(!!impostazioni && /portale\.html$/.test(impostazioni.url()), `«Stampanti» nel menu ⋯ apre le impostazioni (got ${impostazioni ? impostazioni.url().slice(-30) : "niente"})`);
  if (!impostazioni) { impostazioni = await ctx.newPage(); await impostazioni.goto(`chrome-extension://${ID}/portale.html`); }
  await impostazioni.setViewportSize({ width: 1366, height: 768 });
  const stato = () => impostazioni.locator("#sst").innerText().then((t) => t.trim());
  await impostazioni.waitForFunction(() => !/controllo/.test(document.getElementById("sst").textContent), null, { timeout: 15000 });
  check(await stato() === "Stampa automatica: non installata", `senza aiutante: «non installata» (got ${await stato()})`);
  const perche = (await impostazioni.locator("#sperche").innerText()).trim();
  check(/chrome:\/\/policy/.test(perche), `e sotto, dove guardare se l'hai appena installato: chrome://policy (got ${perche})`);
  check(await impostazioni.locator("#setic").isDisabled() && await impostazioni.locator("#sauto").isDisabled() && await impostazioni.locator("#sinst").getAttribute("open") !== null,
    "tendine e interruttore spenti, e i tre passi per installare aperti");
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
  check(await stato() === "Stampa automatica: attiva" && m.etichette === "Zebra ZD421" && m.a4 === "HP LaserJet A4" && m.attiva !== false
    && await impostazioni.locator("#sauto").isChecked(),
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

// ---- 3. i fogli vanno da soli alla loro stampante -------------------------
if (await prova("stampa automatica: etichette all'etichettatrice, lista all'A4, niente dialogo")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 700 });   // (il tempo di vedere l'anteprima mentre «stampa»)
  await suPagina(doc, A.patientUrl);
  await apriPannello(doc);
  const st = await finche(() => stampantina(doc), 5000);
  check(st && !st.ko && st.titolo === "Stampa automatica attiva: etichette su Zebra ZD421, A4 su HP LaserJet A4",
    `in intestazione la stampantina, che dice dove vanno i fogli (got ${JSON.stringify(st)})`);
  await ristampaDallaPagina(doc);
  const e = await aspettaScheda(doc, "s.stato === 'stampato' && /Etichette/.test(s.doc)");
  const s1 = await scheda(doc);
  check(!!e && e.stampante === "Zebra ZD421" && s1.dialoghi === 0 && /Zebra ZD421/.test(s1.dest),
    `etichette: in anteprima, «Stampato su Zebra ZD421», nessun dialogo (got ${JSON.stringify(s1)})`);
  const testo = await doc.evaluate(() => document.getElementById("psassist-print").shadowRoot.querySelector(".pwhint")?.textContent || "");
  check(/Stampato su Zebra ZD421/.test(testo), `la scheda lo dice (got ${testo})`);
  await shot(doc, "stampato-su-etichettatrice");
  const l2 = await aspettaScheda(doc, "s.stato === 'stampato' && /Lista esami/.test(s.doc)");
  check(!!l2 && l2.stampante === "HP LaserJet A4" && (await scheda(doc)).dialoghi === 0, `poi da sola la lista: «Stampato su HP LaserJet A4» (got ${JSON.stringify(l2)})`);
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});
  check((await doc.locator("#psassist-print").count()) === 0, "e la scheda se ne va da sola, senza un clic");
  await sospendi(1500);
  const l = lavori();
  check(l.length === 2 && l[0].tipo === "etichette" && l[0].stampante === "Zebra ZD421" && l[1].tipo === "a4" && l[1].stampante === "HP LaserJet A4",
    `all'aiutante: etichette → Zebra, lista → HP, una volta ciascuna (got ${JSON.stringify(l.map((x) => `${x.tipo}→${x.stampante}`))})`);
  check(l[0].ruota === "no", `le etichette alla Zebra con «ruota: no» (got ${l[0].ruota})`);
  if (impostazioni && !impostazioni.isClosed()) {
    azzeraLavori();
    await impostazioni.click("#sprovaetic");
    await finche(() => lavori().length === 1, 15000);
    check(JSON.stringify(lavori()[0]?.pagina) === "[200,100]", `la pagina di prova delle etichette ora ha la misura dell'etichetta vera (got ${JSON.stringify(lavori()[0]?.pagina)})`);
    azzeraLavori();
  }
  const reg = await doc.evaluate(() => (JSON.parse(sessionStorage.getItem("psassist:log.999001") || "{}").lines || []).join("\n"));
  check(/Etichette provette: stampato su Zebra ZD421, senza dialogo/.test(reg), "il Registro dice dove è andato ogni foglio");
  // un modulo di consenso va all'A4
  azzeraLavori();
  await $panel(doc, '[data-seg="consensi"]').click();
  await $panel(doc, "[data-cons]").first().click();
  await aspettaScheda(doc, "s.stato === 'stampato'");
  await finche(() => lavori().length === 1, 10000);
  check(lavori().length === 1 && lavori()[0].tipo === "a4" && lavori()[0].stampante === "HP LaserJet A4", `un consenso dai Consensi → A4 (got ${JSON.stringify(lavori())})`);
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});
}

// ---- 4. un foglio che non esce: solo lui passa dal dialogo ----------------
if (await prova("un errore su un foglio: quel foglio dal dialogo, col motivo; il dopo di nuovo da solo")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ rompi: { "Zebra ZD421": "la stampante (o il suo driver) ha dato errore" }, lento: 400 });
  await suPagina(doc, A.patientUrl);
  await ristampaDallaPagina(doc);
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const s = await scheda(doc);
  check(s && /Etichette/.test(s.doc) && s.dialoghi === 1 && s.avviso === "Stampa automatica non riuscita: la stampante (o il suo driver) ha dato errore. Dal dialogo, stavolta."
    && /etichettatrice/.test(s.dest),
  `le etichette: la riga col motivo, e il dialogo di sempre (got ${JSON.stringify(s)})`);
  const rossa = await finche(async () => { const x = await stampantina(doc); return x && x.ko ? x : null; }, 5000);
  check(!!rossa && /l'ultima stampa non è uscita: la stampante \(o il suo driver\) ha dato errore/.test(rossa.titolo),
    `la stampantina in intestazione diventa rossa, e dice perché (got ${JSON.stringify(rossa)})`);
  await shot(doc, "riga-del-motivo");
  await dialogoChiuso(doc);
  const l2 = await aspettaScheda(doc, "s.stato === 'stampato' && /Lista esami/.test(s.doc)");
  const s2 = await scheda(doc);
  check(!!l2 && l2.stampante === "HP LaserJet A4" && !s2.avviso && s2.dialoghi === 1, `la lista va da sola all'A4, senza la riga e senza un altro dialogo (got ${JSON.stringify(s2)})`);
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});
  const l = lavori();
  check(l.length === 2 && !l[0].ok && l[0].stampante === "Zebra ZD421" && l[1].ok && l[1].stampante === "HP LaserJet A4",
    `all'aiutante: le etichette (non uscite) e la lista, una volta ciascuna (got ${JSON.stringify(l)})`);
  const st = await finche(async () => { const x = await stampantina(doc); return x && !x.ko ? x : null; }, 5000);
  check(!!st, "uscita la lista, la stampantina torna normale");
}

// ---- 5. l'aiutante sparito ----------------------------------------------
if (await prova("aiutante disinstallato con le stampanti ancora scelte: dialogo, e perché")) {
  installa(false);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  await ristampaDallaPagina(doc);
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const s = await scheda(doc);
  check(s && s.dialoghi === 1 && /non riuscita: l'aiutante di stampa non è installato su questo PC.*chrome:\/\/policy/.test(s.avviso),
    `il dialogo di sempre, con la riga «l'aiutante di stampa non è installato su questo PC», e dove guardare (chrome://policy) (got ${JSON.stringify(s)})`);
  await chiudiStampa(doc);
  // installato, ma Windows non lo lascia partire: le parole esatte di Chrome
  // su Windows (qui, su Linux, un aiutante che non parte «esce» e basta)
  const parte = await sw.evaluate(() => ospiteErrore(new Error("Failed to start native messaging host.")));
  check(/l'aiutante di stampa non è partito/.test(parte.why) && !parte.ignoto,
    `«Failed to start native messaging host.» → in italiano, e il foglio passa dal dialogo (non è partito niente) (got ${JSON.stringify(parte)})`);
  // installato per un'altra copia dell'estensione (ricaricata da un'altra cartella: l'ID cambia)
  installa(true);
  writeFileSync(MANIFEST, readFileSync(MANIFEST, "utf8").replace(ID, "a".repeat(32)));
  await ristampaDallaPagina(doc);
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const f = await scheda(doc);
  check(f && f.dialoghi === 1 && /Chrome non permette di usare l'aiutante di stampa.*rilancia installa\.cmd/.test(f.avviso),
    `un altro ID: il dialogo, e «rilancia installa.cmd» (got ${f && f.avviso})`);
  await chiudiStampa(doc);
}

// ---- 6. l'interruttore, nel menu ⋯ e nelle impostazioni -------------------
if (await prova("l'interruttore: spenta → dialogo, accesa → da sola")) {
  installa(true);
  await scelte(ATTIVA);
  await suPagina(doc, A.patientUrl);
  let voci = await menu(doc);
  check(/Stampa automatica: attiva · Spegni/.test(voci), `nel menu ⋯: «Stampa automatica: attiva · Spegni» (got ${voci})`);
  await $panel(doc, "#stautosw").click();
  check((await memoria()).stampa?.attiva === false, "un tocco la spegne (e lo ricorda)");
  check(!(await stampantina(doc)), "spenta: la stampantina in intestazione sparisce");
  if (impostazioni && !impostazioni.isClosed()) {
    const t = await impostazioni.waitForFunction(() => /spenta/.test(document.getElementById("sst").textContent) && !document.getElementById("sauto").checked, null, { timeout: 5000 }).catch(() => null);
    check(!!t, "e la pagina delle impostazioni lo mostra: «spenta», interruttore giù");
  }
  voci = await menu(doc);
  check(/Stampa automatica: spenta · Accendi/.test(voci), `il menu ora dice «spenta · Accendi» (got ${voci})`);
  await $panel(doc, "#menubtn").click();
  await ristampaDallaPagina(doc);
  await aspettaScheda(doc, "s.stato === 'stampo'");
  const s = await scheda(doc);
  check(s && s.dialoghi === 1 && !s.avviso && lavori().length === 0, `spenta: il dialogo di sempre, senza righe, e all'aiutante niente (got ${JSON.stringify(s)})`);
  await chiudiStampa(doc);
  await menu(doc);
  await $panel(doc, "#stautosw").click();
  check((await memoria()).stampa?.attiva === true && !!(await finche(() => stampantina(doc), 3000)), "riaccesa: torna la stampantina");
  await ristampaDallaPagina(doc);
  await aspettaScheda(doc, "s.stato === 'stampato' && /Lista esami/.test(s.doc)");
  check(lavori().length === 2 && (await scheda(doc))?.dialoghi === 0, `accesa: di nuovo da sola, due fogli (got ${lavori().length})`);
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});
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
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && /^Stampato/.test(x.pubblico?.titolo || "")), 60000);
  const rid = Object.keys(A.state.richieste).find((r) => r !== "699999");
  const l = lavori();
  const n = rec ? rec.stampa.jobs.length : 0;
  check(!!rec && A.state.richieste[rid]?.confirmed === true && conferme(A).length === 1, "la richiesta è confermata, una volta");
  check(n >= 2 && l.length === n && l.every((x) => x.ok) && l.filter((x) => x.tipo === "etichette").every((x) => x.stampante === "Zebra ZD421")
    && l.filter((x) => x.tipo === "a4").every((x) => x.stampante === "HP LaserJet A4") && l[0].tipo === "etichette" && l[l.length - 1].tipo === "a4",
  `tutti i fogli stampati senza nessuno davanti: etichette → Zebra, poi lista → HP (got ${JSON.stringify(l.map((x) => `${x.tipo}→${x.stampante}`))})`);
  const aperte = worker.isClosed() ? null : await stampe(worker);
  check(aperte === null || aperte.length === 0, "nessuna finestra di stampa aperta, nemmeno nella scheda dell'ordine");
  check(await aspettaChiusa(worker), "fatto il suo lavoro, la scheda dell'ordine si chiude");
  check(!!rec && rec.pubblico.titolo === "Stampato su Zebra ZD421 e HP LaserJet A4" && /^2 esami confermati alle \d\d:\d\d$/.test(rec.pubblico.testo)
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
  // «Ristampa»: un tocco, qui; di nuovo da sola, e alla fine il resoconto
  await $panel(doc, "#strazione").click();
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 15000 });
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 40000 }).catch(() => {});
  const ancora = await striscia(doc, /Stampato/, 8000);
  check(lavori().length === 2 * n && (await stampe(doc)).length === 1, `«Ristampa»: gli stessi fogli, una volta, qui (got ${lavori().length} fogli)`);
  check(/ROSSI MARIO/.test(ancora) && /Stampato/.test(ancora) && /2 esami confermati/.test(ancora) && (await azione(doc)) === "Ristampa",
    `e il resoconto «Stampato · 2 esami confermati», con «Ristampa» accanto (got ${ancora || "niente"})`);
  check((await ordini()).length === 0, "l'ordine non c'è più fra quelli aperti");
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
  const l = lavori();
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
  await ristampaDallaPagina(doc);
  const e = await aspettaScheda(doc, "s.stato === 'sconosciuto' && /Etichette/.test(s.doc)");
  const s1 = await scheda(doc);
  check(!!e && s1.dialoghi === 0 && /Esito della stampa sconosciuto: l'aiutante di stampa non ha risposto in tempo\. Controlla Zebra ZD421/.test(s1.avviso),
    `etichette senza risposta: «esito sconosciuto · controlla», e nessun dialogo (got ${JSON.stringify(s1)})`);
  await shot(doc, "esito-sconosciuto");
  const s2 = await aspettaScheda(doc, "/Lista esami/.test(s.doc) && s.stato === 'sconosciuto'", 20000);
  check(!!s2 && (await scheda(doc)).dialoghi === 0, "la lista, lo stesso: nessun dialogo");
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 15000 }).catch(() => {});
  await finche(() => lavori().length === 2, 10000);
  await sospendi(1500);
  check(lavori().length === 2, `l'aiutante (lento) li ha stampati, una volta ciascuno: niente doppioni dal dialogo (got ${lavori().length})`);
  const rossa = await stampantina(doc);
  check(!!rossa && rossa.ko && /esito sconosciuto/.test(rossa.titolo), `la stampantina lo dice (got ${JSON.stringify(rossa)})`);
  // lo stesso per un ordine in sottofondo
  azzeraLavori();
  await azzeraStampe(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  await suPagina(doc, B.patientUrl);
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli), 60000);
  check(!!rec && rec.pubblico.titolo === "Esito della stampa sconosciuto" && /^controlla Zebra ZD421 e HP LaserJet A4: /.test(rec.pubblico.testo) && rec.fogli.every((f) => f.stato === "sconosciuto"),
    `ordine in sottofondo: «Esito della stampa sconosciuto · controlla Zebra ZD421 e HP LaserJet A4: …» (got ${JSON.stringify(rec && rec.pubblico)})`);
  await sospendi(5000);
  check(lavori().length === 2 && (await stampe(doc)).length === 0, `e nessun dialogo: ogni foglio è uscito una volta, dall'aiutante (got ${lavori().length} fogli, ${(await stampe(doc)).length} dialoghi)`);
  const str = await striscia(doc, /Esito della stampa sconosciuto/, 8000);
  check(/ROSSI MARIO/.test(str) && (await azione(doc)) === "Ristampa", `la striscia: «Esito della stampa sconosciuto», con «Ristampa» (got ${str})`);
  await pazienza(0);
}

// ---- 10. la scheda dell'ordine ricaricata, o chiusa, mentre stampa ---------
if (await prova("la scheda dell'ordine ricaricata o chiusa mentre stampa: «stampa interrotta», e la coda va avanti")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 3000 });
  await suPagina(doc, A.patientUrl);
  await azzeraStampe(doc);
  let nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  let worker = await nasce;
  await suPagina(doc, B.patientUrl);
  const primo =await finche(async () => (await ordini()).find((x) => x.stato === "stampo" && x.inVolo === 0), 60000);
  check(!!primo && primo.fogli[0].stato === "mandato" && primo.fogli[1].stato === "attesa" && primo.worker != null,
    `confermata: il service worker stampa, e il foglio è segnato «mandato» prima di partire (got ${JSON.stringify(primo && primo.fogli.map((f) => f.stato))})`);
  check(!!primo && primo.pubblico.titolo === "Confermata" && /^Stampo le etichette su Zebra ZD421…$/.test(primo.pubblico.testo) && /foglio 1 di 2/.test(primo.pubblico.dettaglio),
    `intanto: «Confermata · Stampo le etichette su Zebra ZD421…», «foglio 1 di 2» (got ${JSON.stringify(primo && primo.pubblico)})`);
  await worker.reload().catch(() => {});
  const fine = await finche(async () => (await ordini()).find((x) => x.id === primo.id && x.stato === "avviso"), 30000);
  check(!!fine && fine.pubblico.titolo === "Stampa interrotta" && /^non usciti: Lista/.test(fine.pubblico.testo) && /ricaricata · 1 esame confermato/.test(fine.pubblico.dettaglio)
    && fine.fogli[0].stato === "stampato" && fine.fogli[1].stato === "attesa",
  `ricaricata: «Stampa interrotta», confermata, il foglio partito stampato, l'altro mai mandato (got ${JSON.stringify(fine && [fine.pubblico, fine.fogli.map((f) => f.stato)])})`);
  await sospendi(2000);
  check(lavori().length === 1 && (await stampe(doc)).length === 0, `un foglio solo all'aiutante, nessun dialogo (got ${lavori().length})`);
  check(await aspettaChiusa(worker), "e la scheda dell'ordine si chiude");
  // la coda non è ferma: un altro ordine (per BIANCHI) parte e finisce
  nasce = nuovaPagina();
  await ordina(doc, ["EMOCROMOCITOMETRICO"]);
  await nasce;
  const secondo = await finche(async () => (await ordini()).find((x) => x.id !== primo.id && x.stato === "avviso" && /^Stampato/.test(x.pubblico?.titolo || "")), 60000);
  check(!!secondo && secondo.paziente === "BIANCHI ANNA", "un secondo ordine parte e finisce «Stampato»: la coda non resta bloccata");
  // «Ristampa» dell'ordine interrotto: solo il foglio che non è uscito
  await suPagina(doc, B.patientUrl);
  azzeraLavori();
  const str = await striscia(doc, /Stampa interrotta/, 8000);
  check(/ROSSI MARIO/.test(str) && (await azione(doc)) === "Ristampa", `la striscia: «Stampa interrotta», e «Ristampa» (got ${str})`);
  await shot(doc, "stampa-interrotta");
  await $panel(doc, "#strazione").click();
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
  const terzo = await finche(async () => (await ordini()).find((x) => x.stato === "stampo" && x.inVolo === 0), 60000);
  await worker.close();
  const chiusa = await finche(async () => (await ordini()).find((x) => x.id === terzo.id && x.stato !== "stampo"), 30000);
  check(!!chiusa && chiusa.stato === "avviso" && chiusa.pubblico.titolo === "Stampa interrotta" && /si è chiusa/.test(chiusa.pubblico.dettaglio),
    `chiusa a metà stampa: «Stampa interrotta», non «Scheda chiusa» (got ${JSON.stringify(chiusa && [chiusa.stato, chiusa.pubblico])})`);
}

// ---- 11. ⏹ mentre stampa ----------------------------------------------------
if (await prova("⏹ sulla striscia mentre il service worker stampa: il foglio in corso finisce, gli altri no")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ lento: 3000 });
  await suPagina(doc, A.patientUrl);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  await suPagina(doc, B.patientUrl);
  await finche(async () => (await ordini()).find((x) => x.stato === "stampo" && x.inVolo === 0), 60000);
  const str = await striscia(doc, /Stampo le etichette/, 8000);
  check(/Confermata/.test(str) && (await $panel(doc, "#strstop").getAttribute("title")) === "Ferma l'ordine", `la striscia ha il ⏹ anche mentre stampa (got ${str})`);
  await shot(doc, "stampo-col-fermo");
  await $panel(doc, "#strstop").click();
  const fine = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli), 30000);
  check(!!fine && fine.pubblico.titolo === "Stampa interrotta" && /fermata col ⏹/.test(fine.pubblico.dettaglio) && fine.fogli[1].stato === "attesa",
    `«Stampa interrotta», fermata col ⏹ (got ${JSON.stringify(fine && fine.pubblico)})`);
  await sospendi(1500);
  check(lavori().length === 1, `uscito solo il foglio che era già partito (got ${lavori().length})`);
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
  check(!!rec && rec.pubblico.tono === "warn" && rec.pubblico.titolo === "Etichette NON stampate" && rec.pubblico.tel?.testo === "aspettano qualcuno al PC",
    `confermata: «Etichette NON stampate», e al telefono «aspettano qualcuno al PC» (got ${JSON.stringify(rec && rec.pubblico)})`);
  await sospendi(4000);
  check((await stampe(doc)).length === 0 && (await ordine("telprova1"))?.stato === "stampa",
    "sulla pagina di quel paziente, davanti: il dialogo NON si apre da solo");
  const str = await striscia(doc, /Etichette NON stampate/, 8000);
  check((str.match(/dall'iPhone/g) || []).length === 1 && (await azione(doc)) === "Stampa", `la striscia dice che viene dall'iPhone (una volta), e «Stampa» (got ${str})`);
  check(/tocca Stampa/.test(str) && !/aspettano qualcuno|sulla striscia/.test(str), `e sul PC dice la frase del PC, non quella del telefono (got ${str})`);
  await shot(doc, "telefono-aspetta-un-tocco");
  await $panel(doc, "#strazione").click();
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
  check(!!rotta && rotta.pubblico.titolo === "Etichette NON stampate" && rotta.pubblico.testo === "la stampante «Zebra ZD421» risulta spenta o offline"
    && rotta.pubblico.tel?.testo === "aspettano qualcuno al PC" && /spenta o offline/.test(rotta.pubblico.tel?.dettaglio),
  `l'etichettatrice spenta: «Etichette NON stampate · la stampante «Zebra ZD421» risulta spenta o offline» (got ${JSON.stringify(rotta && rotta.pubblico)})`);
  await sospendi(3000);
  check((await stampe(doc)).length === 0 && lavori().filter((x) => x.ok).length === 1, "la lista è uscita; le etichette aspettano, nessun dialogo da solo");
  // nessuno le prende per mezz'ora: l'ordine si chiude in ambra, «NON stampate» — mai un verde
  const scade = await sw.evaluate(async () => {
    const l = (await chrome.storage.session.get("ordini")).ordini || [];
    for (const x of l) if (x.id === "telprova2") x.agg = Date.now() - 31 * 60e3;
    await chrome.storage.session.set({ ordini: l });
    await new Promise((res) => ordMessaggio({ t: "ordineControlla" }, { tab: { id: 0 }, url: "https://smarthealth.multimedica.it/sa4pso/" }, res));
    return ((await chrome.storage.session.get("ordini")).ordini || []).find((x) => x.id === "telprova2");
  });
  check(!!scade && scade.stato === "avviso" && scade.pubblico.tono === "warn" && scade.pubblico.titolo === "Etichette NON stampate",
    `etichette che nessuno prende per mezz'ora: «Etichette NON stampate», in ambra (got ${JSON.stringify(scade && scade.pubblico)})`);
  await sw.evaluate(() => ordMessaggio({ t: "ordineChiudi", id: "telprova2" }, { tab: { id: 0 }, url: "https://smarthealth.multimedica.it/sa4pso/" }, () => {}));
  // e quando esce: «Stampato su…», e chi preleva va avvisato
  comportati();
  await nessunOrdine();
  await ordineTel("telprova3");
  const ok = await finche(async () => (await ordini()).find((x) => x.id === "telprova3" && x.stato === "avviso"), 60000);
  check(!!ok && ok.pubblico.titolo === "Stampato su Zebra ZD421 e HP LaserJet A4" && /alle \d\d:\d\d$/.test(ok.pubblico.testo) && /avvisa chi preleva/.test(ok.pubblico.dettaglio),
    `uscite: «Stampato su Zebra ZD421 e HP LaserJet A4 · … alle HH:MM · avvisa chi preleva» (got ${JSON.stringify(ok && ok.pubblico)})`);
  check(!!ok && !/il tuo/.test(ok.pubblico.dettaglio), `e col quesito vero, non «Quesito: il tuo» (got ${ok && ok.pubblico.dettaglio})`);
}

// ---- 13. «Mandato»: nella coda di Windows, non si sa se uscito --------------
if (await prova("il foglio rimasto nella coda di Windows: «Mandato a», non «Stampato»")) {
  installa(true);
  await scelte(ATTIVA);
  comportati({ esito: { "Zebra ZD421": "mandato" } });
  await suPagina(doc, A.patientUrl);
  await ristampaDallaPagina(doc);
  const e = await aspettaScheda(doc, "s.stato === 'mandato' && /Etichette/.test(s.doc)");
  const s1 = await scheda(doc);
  check(!!e && s1.dialoghi === 0 && /Mandato a Zebra ZD421: è nella coda di Windows/.test(s1.nota), `etichette: «Mandato a Zebra ZD421», non «Stampato» (got ${JSON.stringify(s1)})`);
  check(!!e && !/✓/.test(s1.nota), `e senza il ✓ di «Stampato» (got ${s1.nota})`);
  await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 15000 }).catch(() => {});
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.fogli), 60000);
  check(!!rec && rec.pubblico.titolo === "Mandato a Zebra ZD421" && /alle \d\d:\d\d$/.test(rec.pubblico.testo) && /stampato su HP LaserJet A4/.test(rec.pubblico.dettaglio),
    `ordine in sottofondo: «Mandato a Zebra ZD421 · … alle HH:MM», e la lista «stampato su HP LaserJet A4» (got ${JSON.stringify(rec && rec.pubblico)})`);
  check(!!rec && rec.pubblico.tono === "warn", `«Mandato» in ambra, non col verde di «Stampato» (got ${rec && rec.pubblico.tono})`);
  const str = await striscia(doc, /Mandato a Zebra ZD421/, 8000);
  const segno = await doc.evaluate(() => document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run")?.className + " " + document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run .tick")?.textContent);
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
    && fine.pubblico.titolo === "Esito della stampa sconosciuto",
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

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(FINTO, { recursive: true, force: true });
console.log(fail ? `\nSTAMPA-ESTENSIONE: ${fail} CHECK FALLITI\n` : "\nSTAMPA-ESTENSIONE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
