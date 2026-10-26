#!/usr/bin/env node
/*
 * La stampa automatica, con l'estensione VERA caricata in Chromium e un finto
 * aiutante di stampa (test/ospite-finto.mjs) registrato per il profilo di
 * prova come «native messaging host» — dove Chromium su Linux lo cerca:
 * <profilo>/NativeMessagingHosts/it.psassist.stampa.json. L'aiutante annota
 * ogni foglio che gli arriva: tipo, stampante, esito.
 * Le prove: senza aiutante non cambia niente (il dialogo di sempre); la pagina
 * delle impostazioni (non installata, poi le stampanti, l'A4 predefinita, le
 * pagine di prova, l'ID); i fogli che vanno da soli alla loro stampante, senza
 * dialogo, una volta sola; un foglio che non esce passa dal dialogo, col
 * motivo, e solo lui; l'aiutante sparito; l'interruttore e la stampantina in
 * intestazione; l'ordine in sottofondo che stampa mentre il medico è su un
 * altro paziente e la sua scheda non si vede, e «Ristampa»; l'ordine in
 * sottofondo con un foglio che non esce, che arriva al medico col motivo.
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
// l'aiutante «installato» (la chiave nel registro, su Windows) o no
const MANIFEST = join(PROFILE, "NativeMessagingHosts", "it.psassist.stampa.json");
const installa = (si) => {
  if (!si) return rmSync(MANIFEST, { force: true });
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify({ name: "it.psassist.stampa", description: "finto", path: lanciatore, type: "stdio", allowed_origins: [`chrome-extension://${ID}/`] }));
};
const scelte = (s) => sw.evaluate((x) => (x ? chrome.storage.local.set({ stampa: x }) : chrome.storage.local.remove(["stampa", "stampaEsito"])), s);
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
    avviso: (w.shadowRoot.querySelector(".pwavv")?.textContent || "").trim(), dest: (w.shadowRoot.querySelector(".dest")?.textContent || "").trim() };
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
  check(await impostazioni.locator("#setic").isDisabled() && await impostazioni.locator("#sauto").isDisabled() && await impostazioni.locator("#sinst").getAttribute("open") !== null,
    "tendine e interruttore spenti, e i tre passi per installare aperti");
  check((await impostazioni.locator("#sid").innerText()).trim() === ID, "l'ID dell'estensione, da incollare se installa.cmd lo chiede");
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
  check(/Pagina di prova mandata a Zebra ZD421/.test(detto) && l.length === 2 && l[0].tipo === "etichette" && l[0].stampante === "Zebra ZD421"
    && l[1].tipo === "a4" && l[1].stampante === "HP LaserJet A4" && l.every((x) => x.byte > 300),
  `«Stampa una pagina di prova»: un PDF vero a ciascuna (got ${detto} · ${JSON.stringify(l)})`);
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
  check(s && s.dialoghi === 1 && /non riuscita: l'aiutante di stampa non è installato su questo PC/.test(s.avviso),
    `il dialogo di sempre, con la riga «l'aiutante di stampa non è installato su questo PC» (got ${JSON.stringify(s)})`);
  await chiudiStampa(doc);
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
  const rec = await finche(async () => (await ordini()).find((x) => x.stato === "avviso" && x.vista?.tag === "Stampato"), 60000);
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

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(FINTO, { recursive: true, force: true });
console.log(fail ? `\nSTAMPA-ESTENSIONE: ${fail} CHECK FALLITI\n` : "\nSTAMPA-ESTENSIONE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
