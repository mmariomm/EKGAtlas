#!/usr/bin/env node
/*
 * Il ponte verso l'iPhone, tutto vero: l'estensione caricata in Chromium col
 * gestionale simulato, il ripetitore Node (la stessa logica del Worker del
 * sito) e l'app del telefono in un secondo browser, in formato iPhone.
 * Associazione dal QR, elenco, esiti con «Aggiorna i valori», un ordine dal
 * telefono fino alle etichette, nota e promemoria, la spia sul PC, i 20
 * minuti senza comandi, «Scollega», la revoca, la scadenza, i messaggi
 * ripetuti o manomessi, nessun gestionale aperto, la sessione scaduta del
 * gestionale, il service worker che si riavvia — e il ripetitore che non vede
 * mai niente in chiaro. In fondo, la prova della rete.
 *   node test/ext-ponte.mjs
 */
import { chromium } from "playwright";
import WebSocket from "ws";
import { createMock } from "./sa4pso-mock.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-ponte-" + process.pid);
const SHOTS = process.env.TEST_SHOTS_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\nponte: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, nome) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, nome + ".png") }).catch(() => {}); };
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) if (await fn()) return true;
  return false;
}

// ---- il ripetitore, che registra tutto quello che inoltra -----------------
const inoltrati = [];
const relay = await avviaRelay({ osserva: (b) => inoltrati.push(b) });

// ---- il gestionale: ROSSI MARIO (con i prelievi da leggere) e BIANCHI ANNA --
const CF_A = "RSSMRA60A01F205Z", CF_B = "BNCNNA75C41F205K";
let A, B;
const nuovi = () => {
  A = createMock({ withResults: true, cf: CF_A });
  B = createMock({ name: "BIANCHI ANNA", episodeId: "999002", cf: CF_B });
  B.state.nextRichiestaId = 800001;
};
nuovi();
const quale = (url) => {
  const p = new URL(url).searchParams;
  if (p.get("EPISODIO_ID") === "999002" || Number(p.get("RICHIESTA_ID")) >= 800000) return B;
  return A;
};
let lento = 0;
let login = false;   // il gestionale risponde con la pagina d'accesso (sessione scaduta)
// la testata della scheda del paziente, com'è nel gestionale: il triage e il nome
const riquadro = (nome, triage, ep, cf) => `<table><tr><td title="${triage}"><font style="font-size:80%">${ep}</font> <font style="font-size:150%">${nome}</font> <font style="font-size:80%">nato il 01/01/1960 · ${cf}</font></td></tr></table>`;
const LOGIN = `<html><head><title>Accesso</title></head><body><form name="Login" method="post" action="login.do"><input name="username"><input type="password" name="password"><input type="submit" value="Accedi"></form></body></html>`;

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
// le stampe che si aprono, in tutte le schede del gestionale
await ctx.addInitScript(() => {
  if (window.top !== window || location.origin !== "https://smarthealth.multimedica.it") return;
  setInterval(() => {
    const w = document.getElementById("psassist-print");
    if (w && !w.dataset.contato) {
      w.dataset.contato = "1";
      const l = JSON.parse(localStorage.getItem("__psaStampe") || "[]");
      l.push({ titolo: document.title, url: location.href });
      localStorage.setItem("__psaStampe", JSON.stringify(l));
    }
  }, 25);
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  const u = req.url();
  if (login && /menuPsoEpisodio\.do/.test(u)) { await r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: LOGIN }); return; }
  if (lento && /Insert=Inserisci/.test(u)) await sospendi(lento);
  const mock = quale(u);
  let out = mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  if (/html/.test(out.headers["content-type"] || "") && /MVPG=PsoEpisodioClinicoAmbulatorio|^[^?]*\?EPISODIO_ID/.test(u)) {
    const m = quale(u), rossi = m === A;
    const html = Buffer.from(out.body).toString("latin1").replace("<body>", "<body>" + riquadro(rossi ? "ROSSI MARIO" : "BIANCHI ANNA", rossi ? "ARANCIONE" : "VERDE", m.state.episodeId, rossi ? CF_A : CF_B));
    out = { ...out, body: Buffer.from(html, "latin1") };
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa intanto */ }
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const extId = new URL(sw.url()).host;
const EXTURL = (f) => `chrome-extension://${extId}/${f}`;
const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`);
const statoPonte = () => sw.evaluate(() => chrome.storage.session.get("ponte").then((o) => o.ponte || null));
const nuovaPagina = (timeout = 15000) => ctx.waitForEvent("page", { timeout }).catch(() => null);
async function suPagina(p, url) {
  await p.goto(url);
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}

// ---- il telefono: un altro browser, in formato iPhone ---------------------
const telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const telCtx = await telBrowser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "it-IT",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
const testoTel = (t) => t.locator("#app").innerText().catch(() => "");
async function aspettaTel(t, re, timeout = 20000) {
  const ok = await finche(async () => re.test(await testoTel(t)), timeout);
  return ok ? testoTel(t) : "";
}
const tocca = (t, sel) => t.locator(sel).first().click();
const qrUrl = () => sw.evaluate(() => ponteQr());

// ===========================================================================
sezione("il PC: il gestionale aperto, l'indirizzo del ponte, il QR");
const doc = await ctx.newPage();
await suPagina(doc, A.patientUrl);
await suPagina(doc, B.patientUrl);
// ROSSI sta nel letto OBI 2 della stanza (un posto messo dal medico)
await doc.evaluate(() => localStorage.setItem("psassist:stanza.posti.v1", JSON.stringify({ 999001: { tipo: "letto", id: "obi2", ts: Date.now() } })));
await suPagina(doc, A.worklistUrl);   // il medico lascia il PC sulla lista

// ⋯ → iPhone apre la pagina del ponte
await $panel(doc, "#expand").click();
await doc.waitForSelector("#psassist-host .card", { timeout: 8000 });
await $panel(doc, "#menubtn").click();
const nasce = nuovaPagina();
await $panel(doc, "#pontemenu").click();
const ponte = await nasce;
check(!!ponte && ponte.url() === EXTURL("ponte.html"), `⋯ → iPhone apre la pagina del ponte (got ${ponte && ponte.url()})`);
await ponte.waitForSelector("#stato b");
check(/non è configurato/.test(await ponte.locator("#stato").innerText()), "senza indirizzo: «Il ponte non è configurato»");
check(await ponte.locator("#associa").isDisabled(), "e «Associa l'iPhone» aspetta l'indirizzo");
await ponte.locator("#host").fill("http://non-un-sito");
await ponte.locator("#salva").click();
await ponte.waitForSelector("#m.ko", { timeout: 5000 });
check(/https/.test(await ponte.locator("#m").innerText()), "un indirizzo non https (e non locale) si rifiuta, e lo dice");
await ponte.locator("#host").fill(relay.url);
await ponte.locator("#salva").click();
await ponte.waitForSelector("#m.ok", { timeout: 5000 });
await ponte.locator("#associa").click();
await ponte.waitForSelector("#qr svg", { timeout: 8000 });
const url1 = await qrUrl();
check(url1.startsWith(relay.url + "/ponte/#k=") && /&scade=\d+$/.test(url1), `il QR porta all'app, con la chiave nel frammento (${url1.slice(0, 40)}…)`);
const scade1 = Number(/scade=(\d+)/.exec(url1)[1]);
check(Math.abs(scade1 - Date.now() - 14 * 3600e3) < 60e3, "l'associazione vale 14 ore");
check(await finche(async () => (await statoPonte())?.relay === "su", 10000), "il PC è collegato al ponte");
check(relay.prese().pc === 1, "sul ripetitore: una presa del PC");
await ponte.setViewportSize({ width: 1366, height: 768 });
await shot(ponte, "pc-1-qr-associazione");

// ===========================================================================
sezione("l'iPhone: il QR, una volta");
const tel = await telCtx.newPage();
await tel.goto(url1);
const lista = await aspettaTel(tel, /ROSSI M\./, 20000);
check(/ROSSI M\./.test(lista) && /BIANCHI A\./.test(lista), "inquadrato il QR: l'elenco dei pazienti del PC");
check(!(await tel.evaluate(() => location.hash)), "il frammento con la chiave non resta nell'indirizzo");
const salvato = await tel.evaluate(() => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
check(salvato.length === 1 && salvato[0][0] === "psassist.ponte.v1" && /"k":/.test(salvato[0][1]) && !/ROSSI|BIANCHI/.test(salvato[0][1]),
  "sul telefono resta solo la chiave (e la scadenza), nient'altro");
check(/Nella stanza/i.test(lista) && /OBI 2/.test(lista) && /In lista/i.test(lista), "la lista e la stanza: ROSSI in OBI 2, BIANCHI in lista");
check(await tel.locator(".paz.t-arancione").count() === 1 && await tel.locator(".paz.t-verde").count() === 1, "la striscia del triage: ROSSI arancione, BIANCHI verde");
const st1 = await statoPonte();
check(!!st1?.sessione, "sul PC la sessione è aperta");
await doc.bringToFront();
await $panel(doc, "#collapse").click();
const spia = await finche(async () => /iPhone collegato/.test(await $panel(doc, ".pontespia").innerText().catch(() => "")), 8000);
check(spia && await $panel(doc, "#ponteoff").count() === 1, "sul PC, sotto la pill: «iPhone collegato · Scollega»");
await shot(doc, "pc-2-spia-pill");
await $panel(doc, "#expand").click();
await doc.waitForSelector("#psassist-host .card .hd .pontespia", { timeout: 5000 }).catch(() => {});
check(await $panel(doc, ".hd .pontespia").count() === 1, "e nell'intestazione del pannello aperto");
await shot(doc, "pc-3-spia-intestazione");
await $panel(doc, "#collapse").click();
await shot(tel, "tel-1-elenco");

// ===========================================================================
sezione("nota e promemoria dal telefono");
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Valori/, 20000);
await tel.locator("#nota").fill("dolore dalle 6, allergico a PCN");
await tel.locator("#promin").click();   // uscire dal campo salva la nota
await aspettaTel(tel, /Nota salvata sul PC/, 10000);
const noteSuPc = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:note.v1") || "{}"));
check(Object.values(noteSuPc).some((n) => n.t === "dolore dalle 6, allergico a PCN"), "la nota arriva sul PC, dove il pannello la legge");
await tel.locator("#promin").fill("tra 2h tropo");
await tocca(tel, '[data-a="prom"]');
await finche(async () => (await tel.locator(".promr").count()) === 1, 10000);
const prom = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:promemoria.v1") || "{}")["999001"] || []);
check(prom.length === 1 && prom[0].testo === "tropo" && Math.abs(prom[0].t - Date.now() - 2 * 3600e3) < 120e3, "il promemoria «tra 2h tropo» è sul PC, per quel paziente");
await tel.locator("#promin").fill("ECG");
await tocca(tel, '[data-a="prom"]');
check(/Scrivi anche l'ora/.test(await aspettaTel(tel, /Scrivi anche l'ora/, 8000)), "senza un orario non salva, e lo dice");
await tel.locator("#promin").fill("11:30 ecg di controllo");
await tocca(tel, '[data-a="prom"]');
await finche(async () => (await tel.locator(".promr").count()) === 2, 10000);
const pid = await tel.locator(".promr").nth(0).locator("[data-pid]").getAttribute("data-pid");
await tel.locator(`[data-pid="${pid}"]`).click();
await finche(async () => (await tel.locator(".promr").count()) === 1, 10000);
const prom2 = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:promemoria.v1") || "{}")["999001"] || []);
check(prom2.length === 1 && !prom2.some((x) => x.id === pid), "«✓ Fatto» lo toglie anche dal PC");
const reg = await doc.evaluate(() => Object.entries(sessionStorage).filter(([k]) => /^psassist:log\./.test(k)).map(([, v]) => (JSON.parse(v).lines || []).join("\n")).join("\n"));
check(/iPhone · nota di ROSSI MARIO/.test(reg) && /iPhone · promemoria per ROSSI MARIO/.test(reg) && /iPhone · promemoria fatto/.test(reg),
  "ogni comando dal telefono è nel Registro del PC");

// ===========================================================================
sezione("esiti, e «Aggiorna i valori»");
await doc.bringToFront();
// sul PC il medico ha letto il referto della TC: il suo testo ora viaggia anche verso il telefono
await suPagina(doc, A.patientUrl);
await $panel(doc, "#expand").click();
await doc.waitForSelector("#psassist-host .card", { timeout: 8000 });
await $panel(doc, '[data-seg="esiti"]').click();
await $panel(doc, '[data-esito="cccc3333-0000-0000-0000-000000000003"]').click();
await doc.waitForSelector("#psassist-host .reftxt", { timeout: 20000 }).catch(() => {});
await $panel(doc, "#collapse").click();
await suPagina(doc, A.worklistUrl);
const vistoPrima = await doc.evaluate(() => (JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").find((p) => p.ep === "999001") || {}).ts);
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /BIANCHI A\./);
await tocca(tel, '.paz[data-ep="999001"]');
const es0 = await aspettaTel(tel, /Referti/i, 20000);
check(/non ha ancora letto valori/.test(es0), "prima di leggerli: «Il PC non ha ancora letto valori»");
check(/TC ENCEFALO/.test(es0), "i referti della pagina del paziente, letti sul PC");
await tocca(tel, '.ref:has-text("TC ENCEFALO")');
check(/Non focolai a carattere broncopneumonico/.test(await aspettaTel(tel, /Non focolai/, 8000)), "il referto già letto sul PC si legge sul telefono, col suo testo");
const nasceValori = nuovaPagina(20000);
await tocca(tel, '[data-a="valori"]');
const schedaValori = await nasceValori;
check(!!schedaValori, "«Aggiorna i valori»: sul PC si apre una scheda di sottofondo");
const es1 = await aspettaTel(tel, /Valori aggiornati/, 90000);
check(/Hb/.test(es1) && /80↓/.test(es1) && /prelievi/.test(es1), `la tabella arriva sul telefono: Hb 80↓ (got: ${(es1.match(/Hb[^\n]*/) || [""])[0]})`);
check(/Non focolai/.test(es1), "e il testo del referto resta (letto prima che il PC conoscesse il codice fiscale)");
check(!schedaValori || await finche(() => schedaValori.isClosed(), 10000), "e la scheda dei valori si chiude da sola");
const vistoDopo = await doc.evaluate(() => (JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").find((p) => p.ep === "999001") || {}).ts);
check(vistoDopo === vistoPrima, "la scheda dei valori non conta come «visto adesso» dal medico");
await tel.waitForSelector(".avviso", { state: "detached", timeout: 8000 }).catch(() => {});
await tel.evaluate(() => { const s = document.querySelector(".seg"); if (s) window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY - 64); });
await shot(tel, "tel-2-esiti");
await tel.evaluate(() => window.scrollTo(0, 0));

// ===========================================================================
sezione("un ordine dal telefono, fino alle etichette");
lento = 900;
await doc.evaluate(() => localStorage.setItem("__psaStampe", "[]"));
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await aspettaTel(tel, /Dolore toracico/, 10000);
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
await tocca(tel, '[data-a="esame"]:has-text("EMOCROMO POC")');
check(await tel.locator("#ordina").isDisabled(), "senza quesito il bottone non parte");
await tel.locator("#quesito").fill("dolore toracico atipico");
await tel.locator("#quesito").press("Enter");
check(/Conferma e stampa · 2 esami/.test(await tel.locator("#ordina").innerText()), "«Conferma e stampa · 2 esami»");
await tocca(tel, "#ordina");
check(/Ordino 2 esami per ROSSI M\.\? Tocca di nuovo/.test(await tel.locator("#ordina").innerText()), "il primo tocco chiede conferma, col nome del paziente");
await shot(tel, "tel-3-ordine-conferma");
check(Object.keys(A.state.richieste).length === 0, "(e niente è partito)");
const nasceOrdine = nuovaPagina(20000);
await tocca(tel, "#ordina");
const worker = await nasceOrdine;
check(!!worker, "il secondo: sul PC parte la scheda dell'ordine, quella di sempre");
const corre = await aspettaTel(tel, /esame \d di 2/, 30000);
check(/esame \d di 2/.test(corre), "sul telefono: a che punto è, «esame N di 2»");
await tel.evaluate(() => window.scrollTo(0, 0));
await shot(tel, "tel-4-ordine-in-corso");
const fatto = await aspettaTel(tel, /Etichette mandate alla stampa sul PC|Etichette pronte sul PC/, 60000);
check(/Confermata/.test(fatto) && /Etichette mandate alla stampa sul PC/.test(fatto), "e alla fine «Confermata · Etichette mandate alla stampa sul PC»");
const rid = Object.keys(A.state.richieste)[0];
check(A.state.richieste[rid]?.confirmed === true && Object.values(A.state.insertCount).every((n) => n === 1) && Object.keys(A.state.insertCount).length === 2,
  `confermata, ogni esame mandato una volta (${JSON.stringify(A.state.insertCount)})`);
check(A.state.richieste[rid]?.quesito === "dolore toracico atipico", "col quesito scritto sul telefono");
check(await finche(async () => (await doc.evaluate(() => JSON.parse(localStorage.getItem("__psaStampe") || "[]"))).length === 1, 10000),
  "le etichette si stampano sul PC come sempre, nella scheda del gestionale davanti");
await shot(tel, "tel-5-ordine-confermato");
await doc.keyboard.press("Escape").catch(() => {});
lento = 0;
const reg2 = await doc.evaluate(() => Object.entries(sessionStorage).filter(([k]) => /^psassist:log\./.test(k)).map(([, v]) => (JSON.parse(v).lines || []).join("\n")).join("\n"));
check(/iPhone · ordine di 2 esami per ROSSI MARIO/.test(reg2), "l'ordine è nel Registro del PC");

// ===========================================================================
sezione("i messaggi ripetuti o manomessi non passano");
const daTel = () => inoltrati.filter((b) => b[1] === 3);
// una nota, catturata per strada, poi un'altra: rimandare la prima non la rimette
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
const noteSulPc = () => doc.evaluate(() => Object.values(JSON.parse(localStorage.getItem("psassist:note.v1") || "{}")).map((n) => n.t));
const prima = daTel().length;
await tel.locator("#nota").fill("nota A");
await tel.locator("#promin").click();
await finche(async () => (await noteSulPc()).includes("nota A"), 10000);
const fNotaA = daTel().slice(prima).at(-1);
await tel.locator("#nota").fill("nota B");
await tel.locator("#promin").click();
await finche(async () => (await noteSulPc()).includes("nota B"), 10000);
// un intruso nella stanza (al posto del telefono) che manda quello che vuole
const presaPc = await sw.evaluate(() => ponteUrlPresa());
const intruso = (frames) => new Promise((ok) => {
  const w = new WebSocket(presaPc.replace("ruolo=pc", "ruolo=tel"));
  w.on("open", () => { for (const f of frames) w.send(f); setTimeout(() => { w.close(); ok(); }, 400); });
  w.on("error", () => ok());
});
const manomesso = Buffer.from(fNotaA); manomesso[9] ^= 0x7f; manomesso[manomesso.length - 2] ^= 1;
// la nota A rimandata tale e quale, e poi con un numero d'ordine più alto ma il contenuto toccato
await intruso([fNotaA, manomesso]);
await sospendi(1200);
check((await noteSulPc()).includes("nota B") && !(await noteSulPc()).includes("nota A"), "una nota ripetuta da un intruso non torna, e una manomessa nemmeno: scartate");
check(!!(await statoPonte())?.sessione, "due messaggi scartati: la sessione resta");
await finche(async () => relay.prese().tel === 1, 8000);   // il telefono si è ripreso la sua presa
await intruso([0, 1, 2, 3, 4].map((i) => { const g = Buffer.from(manomesso); g[g.length - 3 - i] ^= 0x55; return g; }));
check(await finche(async () => !(await statoPonte())?.sessione, 5000), "cinque messaggi non validi di fila: la sessione si chiude");
check(/messaggi non validi/.test(((await statoPonte())?.registro || []).map((x) => x.testo).join("\n")), "e il registro del ponte dice perché");
const chiusaTel = await aspettaTel(tel, /Sessione chiusa/, 20000);
check(/messaggi non validi/.test(chiusaTel), "il telefono, ricollegato, sa che la sessione è chiusa e perché");
check(!(await tel.evaluate(() => document.body.innerText)).includes("ROSSI"), "e sullo schermo del telefono non resta nessun paziente");
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "«Riapri»: una sessione nuova, senza QR");

// ===========================================================================
sezione("20 minuti senza comandi");
const avanti = (ms) => sw.evaluate((x) => { self.__oraVera = self.__oraVera || Date.now; const v = self.__oraVera; Date.now = () => v() + x; return ponteControlla(); }, ms);
const orologio = () => sw.evaluate(() => { if (self.__oraVera) Date.now = self.__oraVera; });
await avanti(19 * 60e3);
check(!!(await statoPonte())?.sessione, "a 19 minuti la sessione c'è ancora");
await avanti(21 * 60e3);
check(!(await statoPonte())?.sessione, "a 21 minuti senza comandi la sessione è chiusa");
await orologio();
const inatt = await aspettaTel(tel, /Sessione chiusa/, 10000);
check(/20 minuti senza comandi/.test(inatt), "il telefono lo dice: «20 minuti senza comandi»");
await shot(tel, "tel-6-sessione-chiusa");
check(await finche(async () => (await $panel(doc, ".pontespia").count()) === 0, 8000), "e sul PC la spia si spegne");
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "riaperta col tocco, senza QR");
// l'app lasciata in sottofondo: al ritorno, passati 20 minuti, i pazienti se ne vanno da soli
await tel.evaluate(() => { const v = Date.now; window.__oraVera = v; Date.now = () => v() + 21 * 60e3; document.dispatchEvent(new Event("visibilitychange")); });
const sottofondo = await aspettaTel(tel, /Sessione chiusa/, 5000);
await tel.evaluate(() => { Date.now = window.__oraVera; });
check(/20 minuti senza comandi/.test(sottofondo) && !/ROSSI/.test(sottofondo), "anche il telefono applica i 20 minuti da solo (app tornata dal sottofondo): via i pazienti");
check(await finche(async () => !(await statoPonte())?.sessione, 5000), "e lo dice al PC, che chiude la sessione");
await tocca(tel, '[data-a="riapri"]');
await aspettaTel(tel, /ROSSI M\./, 15000);

// ===========================================================================
sezione("«Scollega» sul PC");
await finche(async () => (await $panel(doc, "#ponteoff").count()) === 1, 8000);
await $panel(doc, "#ponteoff").click();
check(/chiusa dal PC/.test(await aspettaTel(tel, /Sessione chiusa/, 10000)), "«Scollega»: il telefono si chiude, «chiusa dal PC»");
await tocca(tel, '[data-a="riapri"]');
await aspettaTel(tel, /ROSSI M\./, 15000);

// ===========================================================================
sezione("nessun gestionale aperto, sessione del gestionale scaduta");
await doc.close();
await tocca(tel, '[data-a="menu"]');
await tocca(tel, '[data-a="aggiornaLista"]');
check(/Apri il gestionale sul PC/.test(await aspettaTel(tel, /Apri il gestionale sul PC/, 15000)), "senza schede del gestionale: «Apri il gestionale sul PC»");
const doc2 = await ctx.newPage();
await suPagina(doc2, A.worklistUrl);
login = true;
await doc2.reload();
await sospendi(1500);
await tocca(tel, '[data-a="paz"][data-ep="999002"]');
check(/Gestionale da riaprire/.test(await aspettaTel(tel, /Gestionale da riaprire/, 15000)), "col gestionale sulla pagina d'accesso: «Gestionale da riaprire»");
login = false;
nuovi();
await suPagina(doc2, A.patientUrl);
await suPagina(doc2, B.patientUrl);
await suPagina(doc2, A.worklistUrl);
await tocca(tel, '[data-a="indietro"]').catch(() => {});

// ===========================================================================
sezione("il service worker si ferma e riparte");
await aspettaTel(tel, /ROSSI M\./, 15000);
await ponte.close();   // (la pagina del ponte, aperta, lo sveglierebbe lei: devono farlo le schede del gestionale)
await sw.evaluate(() => { self.__vecchio = true; });
// Chrome lo ferma (qui lo si ferma dal protocollo di debug, come farebbe Chrome)
// (da una pagina dell'estensione che non gli parla: quella del portale)
const pag = await ctx.newPage();
await pag.goto(EXTURL("portale.html"));
const cdp = await ctx.newCDPSession(pag);
const versioni = [];
cdp.on("ServiceWorker.workerVersionUpdated", (e) => versioni.push(...e.versions));
await cdp.send("ServiceWorker.enable");
await finche(async () => versioni.some((v) => v.scriptURL.endsWith("bg.js") && v.runningStatus === "running"), 5000);
const errStop = await cdp.send("ServiceWorker.stopWorker", { versionId: versioni.find((v) => v.scriptURL.endsWith("bg.js")).versionId }).then(() => "", (e) => e.message);
await pag.close();
check(!errStop && await finche(async () => relay.prese().pc === 0, 10000), `fermato il service worker, la sua presa sul ponte cade${errStop ? ` (${errStop})` : ""}`);
check(await finche(async () => relay.prese().pc === 1, 45000), "le schede del gestionale lo svegliano, e si ricollega da solo al ponte (la chiave è rimasta)");
check(!(await sw.evaluate(() => self.__vecchio).catch(() => true)) && !(await statoPonte())?.sessione, "è un service worker nuovo: la sessione di prima non c'è più, le sue chiavi stavano in memoria");
check(/estensione sul PC si è riavviata/.test(await aspettaTel(tel, /Sessione chiusa/, 15000)), "il telefono lo scopre appena il PC torna sul ponte: «l'estensione sul PC si è riavviata»");
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "e riprende con un tocco");

// ===========================================================================
sezione("revoca e scadenza");
const ponte2 = await ctx.newPage();
await ponte2.goto(EXTURL("ponte.html"));
await ponte2.waitForSelector("#revoca:not([hidden])");
await ponte2.locator("#revoca").click();
check(/Revoco\?/.test(await ponte2.locator("#revoca").innerText()), "«Revoca» chiede conferma");
await ponte2.locator("#revoca").click();
check(/revocato/.test(await aspettaTel(tel, /revocat/, 10000)), "revocata: il telefono lo dice");
check(await tel.evaluate(() => localStorage.length) === 0, "e dimentica la chiave");
const vecchio = await telCtx.newPage();
await vecchio.goto(url1);
check(/Il PC non risponde/.test(await aspettaTel(vecchio, /Il PC non risponde/, 15000)), "il vecchio QR non apre più niente: dall'altra parte non c'è nessuno");
await vecchio.close();
await ponte2.locator("#associa").click();
await ponte2.waitForSelector("#qr svg", { timeout: 8000 });
const url2 = await qrUrl();
check(url2 !== url1, "un QR nuovo, con una chiave nuova");
await tel.goto(url2);   // con l'app già aperta: cambia solo il frammento
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "il QR nuovo inquadrato con l'app aperta: chiave nuova, e di nuovo l'elenco");
await avanti(14 * 3600e3 + 60e3);
await orologio();
check(/scaduta/.test(await aspettaTel(tel, /scaduta/, 10000)), "passate le 14 ore: «Associazione scaduta» sul telefono");
const coppia = await sw.evaluate(() => chrome.storage.local.get("ponte.coppia"));
check(!coppia["ponte.coppia"] && !(await statoPonte())?.accoppiato, "e sul PC la chiave non c'è più");
await shot(tel, "tel-7-scaduta");

// ===========================================================================
sezione("il ripetitore non vede niente in chiaro");
// (solo parole di almeno 5 lettere: due o tre byte uguali per caso, in tanti byte cifrati, ci sono sempre)
const segreti = ["ROSSI", "BIANCHI", "MARIO", "TROPONINA", "EMOCROMO", CF_A, CF_B, "999001", "999002", "tropo", "dolore", "allergico", "ENCEFALO", "pazienti", "focolai"];
const tutti = Buffer.concat(inoltrati);
check(inoltrati.length > 30, `(${inoltrati.length} messaggi inoltrati)`);
check(inoltrati.every((b) => b[0] === 1 && b[1] >= 1 && b[1] <= 4), "ognuno è un messaggio cifrato del ponte (versione 1, tipo 1–4)");
const visti = segreti.filter((s) => tutti.includes(Buffer.from(s, "latin1")) || tutti.includes(Buffer.from(s, "utf8")) || tutti.includes(Buffer.from(s, "utf16le")));
check(!visti.length, `nessun nome, esame, codice fiscale, episodio o testo in nessun messaggio (trovati: ${visti.join(", ") || "nessuno"})`);

// ===========================================================================
sezione("la prova della rete");
const prova = await ctx.newPage();
await prova.goto(EXTURL("ponte-prova.html?durata=4"));
await prova.waitForFunction(() => !document.getElementById("copia").disabled, null, { timeout: 60000 });
const righe = await prova.locator("li").evaluateAll((l) => l.map((x) => [x.className, x.innerText.replace(/\s+/g, " ")]));
const riga = (re) => righe.find(([, t]) => re.test(t)) || ["", ""];
check(riga(/HTTPS verso il ponte/)[0] === "ok", `HTTPS verso il ponte: verde (${riga(/HTTPS verso il ponte/)[1]})`);
check(riga(/WSS\) col ponte/)[0] === "ok", `WSS andata e ritorno: verde (${riga(/WSS/)[1]})`);
check(riga(/tenuto aperto/)[0] === "ok", `collegamento tenuto aperto: verde (${riga(/tenuto aperto/)[1]})`);
check(/HTTPS verso Cloudflare/.test(righe.map((x) => x[1]).join()) && /UDP/.test(righe.map((x) => x[1]).join()), "più Cloudflare e UDP (solo informazione), una riga ciascuno");
check(/Il ponte si può usare da questo PC/.test(await prova.locator("#esito").innerText()), "in cima, il verdetto in una riga");
await prova.locator("#copia").click();
check(await finche(async () => /copiato/.test(await prova.locator("#copiato").innerText()), 3000), "«Copia il risultato» risponde");
await shot(prova, "pc-4-prova-rete");

await telBrowser.close();
await ctx.close();
await relay.chiudi();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fail ? `\nPONTE: ${fail} CHECK FALLITI\n` : "\nPONTE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
