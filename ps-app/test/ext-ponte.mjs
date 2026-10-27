#!/usr/bin/env node
/*
 * Il ponte verso l'iPhone, tutto vero: l'estensione caricata in Chromium col
 * gestionale simulato, il ripetitore Node (la stessa logica del Worker del
 * sito) e l'app del telefono in un secondo browser, in formato iPhone, con la
 * sua rete fra lei e il ripetitore (per perdere messaggi, come il 5G).
 * Associazione dal QR (una volta, un telefono solo), elenco, esiti con
 * «Aggiorna i valori», un ordine dal telefono fino alle etichette (il doppio
 * tocco, la risposta persa), nota e promemoria, la spia sul PC, i 20 minuti
 * senza comandi, «Scollega», un altro dispositivo, la pagina ricaricata, il
 * battito, la revoca, la scadenza, la pagina d'accesso del gestionale, i
 * messaggi ripetuti o manomessi, nessun gestionale aperto, il service worker
 * che si riavvia — e il ripetitore che non vede mai niente in chiaro. In
 * fondo, la prova della rete, e l'app al buio.
 *   node test/ext-ponte.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "../public/ponte/cripto.js"));
const P = globalThis.PonteCripto;
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
const shot = async (page, nome) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, nome + ".png") }).catch((e) => console.log(`  (foto ${nome} non salvata: ${String(e.message).split("\n")[0]})`)); };
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
const coppiaPc = () => sw.evaluate(() => Promise.all([chrome.storage.local.get("ponte.coppia"), chrome.storage.session.get("ponte.coppia")]).then(([l, s]) => ({ disco: l["ponte.coppia"] || null, memoria: s["ponte.coppia"] || null })));
const registroPonte = async () => ((await statoPonte())?.registro || []).map((x) => x.testo).join("\n");
const nuovaPagina = (timeout = 15000) => ctx.waitForEvent("page", { timeout }).catch(() => null);
async function suPagina(p, url) {
  await p.goto(url);
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}
const registroPc = (p) => p.evaluate(() => Object.entries(sessionStorage).filter(([k]) => /^psassist:log\./.test(k)).map(([, v]) => (JSON.parse(v).lines || []).join("\n")).join("\n"));

// ---- il telefono: un altro browser, in formato iPhone ---------------------
const telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const IPHONE = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "it-IT",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};
const telCtx = await telBrowser.newContext(IPHONE);
// La rete del telefono: ogni presa passa di qui. `perdi` = il numero di una
// presa di cui si perdono i messaggi cifrati dal PC (le risposte); `muta` =
// una presa che non porta più niente in nessun verso, nemmeno il «pong».
const rete = { n: 0, prese: new Map(), ultima: 0, perdi: 0, muta: 0, dalPc: [] };
const chiusura = (code, reason) => (code === 1000 || (code >= 3000 && code <= 4999) ? { code, reason } : {});
await telCtx.routeWebSocket(/\/ponte\/ws/, (ws) => {
  const n = ++rete.n;
  const server = ws.connectToServer();
  rete.prese.set(n, { ws, server });
  rete.ultima = n;
  ws.onMessage((m) => { if (rete.muta !== n) server.send(m); });
  server.onMessage((m) => {
    if (rete.muta === n) return;
    if (typeof m !== "string") rete.dalPc.push(Buffer.from(m));
    if (rete.perdi === n && typeof m !== "string") return;
    ws.send(m);
  });
  ws.onClose((code, reason) => server.close(chiusura(code, reason)));
  server.onClose((code, reason) => ws.close(chiusura(code, reason)));
});
const testoTel = (t) => t.locator("#app").innerText().catch(() => "");
async function aspettaTel(t, re, timeout = 20000) {
  const ok = await finche(async () => re.test(await testoTel(t)), timeout);
  return ok ? testoTel(t) : "";
}
const tocca = (t, sel) => t.locator(sel).first().click();
const qrUrl = () => sw.evaluate(() => ponteQr());
const chiaveTel = (t) => t.evaluate(() => JSON.parse(localStorage.getItem("psassist.ponte.v1") || "null"));
// i bottoni visibili più piccoli di 44 px (larghezza o altezza)
const piccoli = (t) => t.evaluate(() => [...document.querySelectorAll("#app button")].filter((b) => b.offsetParent).map((b) => {
  const r = b.getBoundingClientRect();
  return { t: (b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) };
}).filter((x) => x.w < 44 || x.h < 44));

// ===========================================================================
sezione("il PC: il gestionale aperto, il ponte, il QR");
const doc = await ctx.newPage();
await suPagina(doc, A.patientUrl);
await suPagina(doc, B.patientUrl);
// ROSSI sta nel letto OBI 2 della stanza (un posto messo dal medico); BIANCHI
// ha anche un episodio di stanotte (stesso codice fiscale); VERDI è in lista
// (senza la sua pagina)
await doc.evaluate(({ CF_B, bUrl }) => {
  const K = "psassist:patients.v1";
  const l = JSON.parse(localStorage.getItem(K) || "[]");
  const ora = Date.now();
  for (const p of l) if (p.ep === "999002") p.pk = "cf:" + CF_B;
  l.push({ ep: "998002", name: "BIANCHI ANNA", url: bUrl.replace("EPISODIO_ID=999002", "EPISODIO_ID=998002"), ts: ora - 5 * 3600e3, pk: "cf:" + CF_B, triage: "VERDE" });
  l.push({ ep: "999003", name: "VERDI LUCA", url: "", ts: ora - 40 * 60e3, pk: "", triage: "AZZURRO" });
  localStorage.setItem(K, JSON.stringify(l));
  localStorage.setItem("psassist:stanza.posti.v1", JSON.stringify({ 999001: { tipo: "letto", id: "obi2", ts: ora } }));
}, { CF_B, bUrl: B.patientUrl });
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
check(/Ponte da configurare/.test(await ponte.locator("#stato").innerText()) && await ponte.locator("#associa").isDisabled(),
  "con ponte/host.txt vuoto: «Ponte da configurare», e niente da associare");
check(await ponte.locator("input").count() === 0, "l'indirizzo del ponte non si scrive in nessuna pagina: niente campo");
// (per le prove, e solo verso questo PC: il ripetitore locale)
await sw.evaluate((u) => chrome.storage.local.set({ "ponte.host": u }).then(() => ponteAvvia()), relay.url);
await ponte.reload();
await ponte.waitForSelector("#stato b");
await ponte.locator("#associa").click();
await ponte.waitForSelector("#qr svg", { timeout: 8000 });
const url1 = await qrUrl();
check(url1.startsWith(relay.url + "/ponte/#k=") && /&scade=\d+$/.test(url1), `il QR porta all'app, con la chiave nel frammento (${url1.slice(0, 40)}…)`);
const K1 = P.leggiFrammento(new URL(url1).hash).k, CH1 = await P.chiaviCoppia(K1);
const scade1 = Number(/scade=(\d+)/.exec(url1)[1]);
check(Math.abs(scade1 - Date.now() - 14 * 3600e3) < 60e3, "l'associazione vale 14 ore");
const codice1 = (await ponte.locator("#qrcodice").innerText()).trim();
check(codice1 === await P.codice(K1), `accanto al QR, il codice dell'associazione: ${codice1}`);
const cp = await coppiaPc();
check(!cp.disco && cp.memoria && cp.memoria.k === P.b64u(K1), "sul PC la chiave sta in memoria (storage.session), non su disco");
check(await finche(async () => (await statoPonte())?.relay === "su", 10000), "il PC è collegato al ponte");
check(relay.prese().pc === 1, "sul ripetitore: una presa del PC");
await ponte.locator("#qrvia").click();
check(/Mostra il QR/.test(await ponte.locator("#associa").innerText()), "nascosto il QR, nei primi due minuti: «Mostra il QR»");
await ponte.locator("#associa").click();
await ponte.waitForSelector("#qr svg", { timeout: 8000 });
check(await qrUrl() === url1, "…e mostra lo stesso");
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
const sv = salvato.length === 1 ? JSON.parse(salvato[0][1]) : {};
check(salvato.length === 1 && salvato[0][0] === "psassist.ponte.v1" && Object.keys(sv).sort().join() === "dev,k,scade" && !/ROSSI|BIANCHI/.test(salvato[0][1]),
  "sul telefono resta solo la chiave, la scadenza e il numero del telefono: nient'altro");
check(/Nella stanza/i.test(lista) && /OBI 2/.test(lista) && /In lista/i.test(lista) && /Episodi precedenti/i.test(lista), `la lista, la stanza (ROSSI in OBI 2) e gli episodi precedenti (${lista.replace(/\s+/g, " ").slice(0, 200)})`);
check(await tel.locator(".paz.t-arancione").count() === 1 && await tel.locator(".paz.t-verde").count() >= 1, "la striscia del triage: ROSSI arancione, BIANCHI verde");
check(/Aggiornato alle \d\d:\d\d/.test(lista) && !/Dal PC del pronto soccorso/.test(lista), "in testa «Aggiornato alle …»; niente piede che ripete la testata");
const nomi = await tel.locator(".paz .nome").evaluateAll((l) => l.map((x) => { const s = getComputedStyle(x); return { taglia: s.textOverflow === "ellipsis" || s.whiteSpace === "nowrap", pieno: x.scrollWidth <= x.clientWidth + 1 }; }));
check(nomi.length >= 4 && nomi.every((x) => !x.taglia && x.pieno), `i nomi non si troncano mai (il posto e il promemoria vanno a capo) ${JSON.stringify(nomi)}`);
check(!(await piccoli(tel)).length, `ogni bottone almeno 44 px (${JSON.stringify(await piccoli(tel))})`);
await tocca(tel, '[data-a="menu"]');
check(new RegExp(`codice ${codice1}`).test(await testoTel(tel)), "il telefono mostra lo stesso codice del PC (nel menu)");
await tocca(tel, '[data-a="menu"]');
const st1 = await statoPonte();
check(!!st1?.sessione, "sul PC la sessione è aperta");
check(await qrUrl() === "" && /Nuovo QR/.test(await ponte.locator("#associa").innerText()), "entrato il telefono, il QR non si rivede più: «Nuovo QR»");
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
await tel.emulateMedia({ colorScheme: "dark" });
const fondoBuio = await tel.evaluate(() => getComputedStyle(document.body).backgroundColor);
await shot(tel, "tel-1-elenco-buio");
await tel.emulateMedia({ colorScheme: "light" });
const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
check(lum(fondoBuio) < 0.15 && lum(await tel.evaluate(() => getComputedStyle(document.body).backgroundColor)) > 0.9, `al buio l'app è scura, di giorno chiara (${fondoBuio})`);

// ===========================================================================
sezione("un solo telefono: il QR visto da un altro, un'altra scheda");
const altroCtx = await telBrowser.newContext(IPHONE);
const altro = await altroCtx.newPage();
await altro.goto(url1);
check(/associato a un altro telefono/.test(await aspettaTel(altro, /associato a un altro telefono/, 15000)), "un altro telefono con lo stesso QR: «Il PC è associato a un altro telefono»");
check(!(await altro.evaluate(() => localStorage.length)), "…e quella chiave non la tiene");
check(/Un altro telefono ha provato a entrare/.test(await registroPonte()), "il registro del ponte lo dice");
await altroCtx.close();
// il ripetitore gli aveva dato la presa del telefono: questo si è fermato, e non fa a gara
check(/Aperto su un altro dispositivo/.test(await aspettaTel(tel, /Aperto su un altro dispositivo/, 10000)), "il telefono buono: «Aperto su un altro dispositivo»");
const entrate0 = relay.entrate().tel;
await sospendi(3000);
check(relay.entrate().tel === entrate0, "e non si ricollega da solo (niente tiro alla fune)");
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "«Riprendi qui»: di nuovo l'elenco");
// la stessa app in un'altra scheda dello stesso telefono
const tel2 = await telCtx.newPage();
await tel2.goto(relay.url + "/ponte/");
check(/ROSSI M\./.test(await aspettaTel(tel2, /ROSSI M\./, 15000)), "un'altra scheda dello stesso telefono entra (è lo stesso telefono)…");
check(/Aperto su un altro dispositivo/.test(await aspettaTel(tel, /Aperto su un altro dispositivo/, 10000)), "…e la prima si ferma");
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)) && /Aperto su un altro dispositivo/.test(await aspettaTel(tel2, /Aperto su un altro dispositivo/, 10000)),
  "«Riprendi qui» sulla prima: lei riprende, l'altra si ferma");
await tel2.close();

// ===========================================================================
sezione("nota e promemoria dal telefono");
await tocca(tel, '.paz[data-ep="999001"]');
const testa = await aspettaTel(tel, /Valori/, 20000);
check(/ROSSI MARIO · 1960 · OBI 2/.test(testa), "in testa il nome intero, l'anno di nascita (dal codice fiscale della sua pagina) e il posto: «ROSSI MARIO · 1960 · OBI 2»");
check(await tel.evaluate(() => { const s = document.querySelector(".seg"), n = document.querySelector(".note"); return !!s && !!n && !!(s.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING); }),
  "le schede Esiti/Richieste vengono prima della nota");
check(await tel.locator("#nota").count() === 0 && await tel.locator('[data-a="nota"]:has-text("+ Nota")').count() === 1, "la nota vuota è chiusa: «+ Nota»");
await tocca(tel, '[data-a="nota"]');
await tel.locator("#nota").fill("dolore dalle 6, allergico a PCN");
await tocca(tel, '[data-a="promApri"]');   // uscire dal campo salva la nota
await aspettaTel(tel, /Nota salvata sul PC/, 10000);
const noteSuPc = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:note.v1") || "{}"));
check(Object.values(noteSuPc).some((n) => n.t === "dolore dalle 6, allergico a PCN"), "la nota arriva sul PC, dove il pannello la legge");
await tel.locator("#promin").fill("tra 2h tropo");
await tocca(tel, '[data-a="prom"]');
await finche(async () => (await tel.locator(".promr").count()) === 1, 10000);
const prom = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:promemoria.v1") || "{}")["999001"] || []);
check(prom.length === 1 && prom[0].testo === "tropo" && Math.abs(prom[0].t - Date.now() - 2 * 3600e3) < 120e3, "il promemoria «tra 2h tropo» è sul PC, per quel paziente");
await tocca(tel, '[data-a="promApri"]');
await tel.locator("#promin").fill("ECG");
await tocca(tel, '[data-a="prom"]');
check(/Scrivi anche l'ora/.test(await aspettaTel(tel, /Scrivi anche l'ora/, 8000)), "senza un orario non salva, e lo dice");
await tel.locator("#promin").fill("11:30 ecg di controllo");
await tocca(tel, '[data-a="prom"]');
await finche(async () => (await tel.locator(".promr").count()) === 2, 10000);
const promPc = () => doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:promemoria.v1") || "{}")["999001"] || []);
const pid = await tel.locator(".promr").nth(0).locator("[data-pid]").getAttribute("data-pid");
await tel.locator(`[data-a="fatto"][data-pid="${pid}"]`).click();
check(/Fatto\s*Annulla/.test(await tel.locator(".promr").nth(0).innerText()), "«✓ Fatto»: per 5 secondi «Fatto · Annulla»");
await tel.locator(`[data-a="annulla"][data-pid="${pid}"]`).click();
await sospendi(5600);
check((await promPc()).length === 2 && await tel.locator(".promr").count() === 2, "«Annulla»: niente mandato, il promemoria resta anche sul PC");
await tel.locator(`[data-a="fatto"][data-pid="${pid}"]`).click();
check((await promPc()).length === 2, "(e prima dei 5 secondi resta)");
await finche(async () => (await tel.locator(".promr").count()) === 1, 12000);
const prom2 = await promPc();
check(prom2.length === 1 && !prom2.some((x) => x.id === pid), "passati i 5 secondi, «✓ Fatto» lo toglie anche dal PC");
const reg = await registroPc(doc);
check(/iPhone · nota di ROSSI MARIO/.test(reg) && /iPhone · promemoria per ROSSI MARIO/.test(reg) && /iPhone · promemoria fatto/.test(reg),
  "ogni comando dal telefono è nel Registro del PC");
check(!(await piccoli(tel)).length, `anche qui ogni bottone almeno 44 px (${JSON.stringify(await piccoli(tel))})`);

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
check(/Hb/.test(es1) && /80↓/.test(es1), `la tabella arriva sul telefono: Hb 80↓ (got: ${(es1.match(/Hb[^\n]*/) || [""])[0]})`);
check(/Letti sul PC alle \d\d:\d\d · adesso/.test(es1) && await tel.locator(".letti.amb").count() === 0, "con l'ora in cui il PC li ha letti: «Letti sul PC alle … · adesso»");
check(await tel.locator(".val thead th:has(small.parz)").count() >= 1 && /parziale/.test(await tel.locator(".val thead").innerText()),
  "una colonna con valori parziali lo dice nella sua testata: «parziale»");
check(/Non focolai/.test(es1), "e il testo del referto resta (letto prima che il PC conoscesse il codice fiscale)");
check(!schedaValori || await finche(() => schedaValori.isClosed(), 10000), "e la scheda dei valori si chiude da sola");
const vistoDopo = await doc.evaluate(() => (JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").find((p) => p.ep === "999001") || {}).ts);
check(vistoDopo === vistoPrima, "la scheda dei valori non conta come «visto adesso» dal medico");
await tel.waitForSelector(".avviso", { state: "detached", timeout: 8000 }).catch(() => {});
await shot(tel, "tel-2-esiti");
await tel.emulateMedia({ colorScheme: "dark" }); await shot(tel, "tel-2-esiti-buio"); await tel.emulateMedia({ colorScheme: "light" });
// letti quattro ore fa: lo si vede, in ambra
await sw.evaluate(() => chrome.storage.local.get("storicoArch").then((o) => { for (const r of Object.values(o.storicoArch || {})) r.letto -= 4 * 3600e3 + 60e3; return chrome.storage.local.set(o); }));
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /BIANCHI A\./);
await tocca(tel, '.paz[data-ep="999001"]');
const es2 = await aspettaTel(tel, /4 h fa/, 20000);
check(/Letti sul PC alle \d\d:\d\d · 4 h fa/.test(es2) && await tel.locator(".letti.amb").count() === 1, "letti quattro ore fa: «… · 4 h fa», in ambra (dopo un'ora)");
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
check(await tel.locator("#ordina").evaluate((b) => getComputedStyle(b).touchAction) === "manipulation", "niente doppio tocco per ingrandire sul bottone (touch-action: manipulation)");
await tocca(tel, "#ordina");
await tocca(tel, "#ordina");   // il secondo tocco di un doppio tocco, subito dopo
await sospendi(400);
const armato = await tel.locator("#ordina").innerText();
check(/Ordino 2 esami per ROSSI MARIO · 1960 · OBI 2\? Tocca di nuovo/.test(armato), `il primo tocco chiede conferma, col nome intero, l'anno e il posto (${armato})`);
check(Object.keys(A.state.richieste).length === 0, "un doppio tocco (il secondo entro 800 ms) non conferma: niente è partito");
await shot(tel, "tel-3-ordine-conferma");
const nasceOrdine = nuovaPagina(20000);
await sospendi(500);
await tocca(tel, "#ordina");
const worker = await nasceOrdine;
check(!!worker, "un tocco deciso: sul PC parte la scheda dell'ordine, quella di sempre");
const corre = await aspettaTel(tel, /esame \d di 2/, 30000);
check(/esame \d di 2/.test(corre), "sul telefono: a che punto è, «esame N di 2»");
check(await finche(async () => /dall'iPhone/.test(await $panel(doc, ".strip").innerText().catch(() => "")), 15000), "sul PC la striscia dell'ordine dice «dall'iPhone»");
await tel.evaluate(() => window.scrollTo(0, 0));
await shot(tel, "tel-4-ordine-in-corso");
const fatto = await aspettaTel(tel, /Confermata/, 60000);
check(/Confermata/.test(fatto), "e alla fine «Confermata»");
const rid = Object.keys(A.state.richieste)[0];
check(A.state.richieste[rid]?.confirmed === true && Object.values(A.state.insertCount).every((n) => n === 1) && Object.keys(A.state.insertCount).length === 2,
  `confermata, ogni esame mandato una volta (${JSON.stringify(A.state.insertCount)})`);
check(A.state.richieste[rid]?.quesito === "dolore toracico atipico", "col quesito scritto sul telefono");
await sospendi(1500);
check((await doc.evaluate(() => JSON.parse(localStorage.getItem("__psaStampe") || "[]"))).length <= 1, "le etichette non si stampano mai due volte");
const carta = await tel.locator(".ord").first().innerText();
check(!/Quesito: il tuo/.test(carta) && (carta.match(/2 esami/g) || []).length <= 1, `la carta dell'ordine: niente «Quesito: il tuo», niente «2 esami» ripetuto (${carta.replace(/\s+/g, " ")})`);
await shot(tel, "tel-5-ordine-confermato");
await tel.emulateMedia({ colorScheme: "dark" }); await shot(tel, "tel-5-ordine-confermato-buio"); await tel.emulateMedia({ colorScheme: "light" });
await doc.keyboard.press("Escape").catch(() => {});
lento = 0;
check(/iPhone · ordine di 2 esami per ROSSI MARIO/.test(await registroPc(doc)), "l'ordine è nel Registro del PC");
const ordiniFiniti = () => sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => (o.ordini || []).every((x) => !["coda", "avvio", "corre"].includes(x.stato))));
await finche(ordiniFiniti, 30000);

// ===========================================================================
sezione("l'ordine di cui non si sa: la scheda che tarda, la risposta persa");
// la scheda del gestionale risponde dopo l'attesa: il PC non sa, l'ordine nasce lo stesso
await sw.evaluate(() => { PONTE_ATTESA.ordina = 1; });
await tocca(tel, '[data-a="indietro"]');
await tocca(tel, '.paz[data-ep="999002"]');
await aspettaTel(tel, /Dolore toracico/, 15000);
check(await tel.locator('[data-a="scheda"][data-s="richieste"].on').count() === 1, "l'ultima scheda scelta (Richieste) resta quella, anche per un altro paziente");
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
await tel.locator("#quesito").fill("controllo");
await tocca(tel, "#ordina"); await sospendi(900); await tocca(tel, "#ordina");
const incerto = await aspettaTel(tel, /Non so se l'ordine è partito/, 20000);
check(/Non so se l'ordine è partito: controlla qui sopra prima di rifarlo/.test(incerto), "la scheda tarda: «Non so se l'ordine è partito: controlla qui sopra prima di rifarlo»");
check(await tel.locator(".esame.on").count() === 0, "la selezione se ne va: un secondo tocco non rifà l'ordine");
check(await finche(async () => (await tel.locator(".ord").count()) >= 1 && Object.keys(B.state.richieste).length === 1, 30000), "e l'ordine, nato lo stesso, compare sul telefono");
await sw.evaluate(() => { PONTE_ATTESA.ordina = 25e3; });
await finche(ordiniFiniti, 60000);
check(Object.keys(B.state.richieste).length === 1 && Object.values(B.state.insertCount).every((n) => n === 1), `un ordine solo (${JSON.stringify(B.state.insertCount)})`);
// la rete perde la risposta (ascensore, 5G): il telefono non lo rifà alla cieca
await tel.waitForSelector(".avviso", { state: "detached", timeout: 10000 }).catch(() => {});
await tocca(tel, '[data-a="esame"]:has-text("EMOCROMO POC")');
await tel.locator("#quesito").fill("anemia");
const prese0 = relay.entrate().tel;
rete.perdi = rete.ultima;
await tocca(tel, "#ordina"); await sospendi(900); await tocca(tel, "#ordina");
const perso = await aspettaTel(tel, /Non so se l'ordine è partito/, 75000);
check(/Non so se l'ordine è partito/.test(perso), "risposta persa: dopo l'attesa, «Non so se l'ordine è partito…»");
check(await finche(async () => relay.entrate().tel > prese0, 5000), "e la presa che non risponde si rifà");
check(await tel.locator(".esame.on").count() === 0, "la selezione se ne va anche qui");
check(await finche(async () => Object.keys(B.state.richieste).length === 2 && /EMOCROMO|esame/.test(await tel.locator(".ord").first().innerText().catch(() => "")), 30000),
  "l'ordine partito davvero compare sul telefono appena la rete torna");
await finche(ordiniFiniti, 60000);
check(Object.keys(B.state.richieste).length === 2, "e nessun ordine doppio");
await shot(tel, "tel-6-ordine-incerto");

// ===========================================================================
sezione("un ordine finito male resta sulla lista, con le parole di bg.js");
// un ordine del telefono come lo racconta bg.js (`pubblico`), qui scritto a mano
const male = { id: "telmaleprova1l", ep: "999002", paziente: "BIANCHI ANNA", n: 1, stato: "errore", ts: Date.now(), agg: Date.now(), worker: null, vista: null,
  resto: { mancano: ["TROPONINA US"], controllare: [], nel: [] }, pubblico: { tono: "err", titolo: "Ordine fermo", testo: "Mancano: TROPONINA US", dettaglio: "Quesito: il tuo" } };
await sw.evaluate((m) => chrome.storage.session.get("ordini").then((o) => chrome.storage.session.set({ ordini: [...(o.ordini || []), m] })), male);
await tocca(tel, '[data-a="indietro"]');
const barra = await aspettaTel(tel, /Ordine non completo/, 10000);
check(/Ordine non completo · BIANCHI ANNA/.test(barra) && /Ordine fermo · Mancano: TROPONINA US/.test(barra) && /Tocca per vedere/.test(barra),
  "in fondo alla lista: «Ordine non completo · BIANCHI ANNA», con le parole di bg.js");
await shot(tel, "tel-6b-ordine-non-completo");
await sw.evaluate((id) => chrome.storage.session.get("ordini").then((o) => chrome.storage.session.set({ ordini: (o.ordini || []).filter((x) => x.id !== id) })), male.id);
await sospendi(1500);
check(/Ordine non completo/.test(await testoTel(tel)), "tolto dal PC (✕ là): sul telefono resta com'era l'ultima volta, finché non lo si chiude");
await tocca(tel, '.ordbar [data-a="nascondi"]');
check(!/Ordine non completo/.test(await testoTel(tel)), "✕: via");
await tocca(tel, '.paz[data-ep="999002"]');
await aspettaTel(tel, /Richieste/, 10000);

// ===========================================================================
sezione("episodio precedente, paziente dimesso");
await tocca(tel, '[data-a="indietro"]');
await tocca(tel, '.paz[data-ep="998002"]');
check(/Episodio precedente: per ordinare apri quello di oggi/.test(await aspettaTel(tel, /Episodio precedente/, 15000)) && await tel.locator("#ordina").count() === 0,
  "un episodio precedente si legge, ma non si ordina");
await tocca(tel, '[data-a="indietro"]');
await tocca(tel, '.paz[data-ep="999003"]');
await aspettaTel(tel, /VERDI LUCA/, 15000);
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
await doc.evaluate(() => {
  const K = "psassist:patients.v1"; const l = JSON.parse(localStorage.getItem(K) || "[]");
  for (const p of l) if (p.ep === "999003") { p.arch = true; p.archTs = Date.now(); }
  localStorage.setItem(K, JSON.stringify(l));
});
await tocca(tel, '[data-a="nota"]');
await tel.locator("#nota").fill("nota dopo la dimissione");
await tocca(tel, '[data-a="promApri"]');
check(/Dimesso sul PC: niente inviato/.test(await aspettaTel(tel, /Dimesso sul PC/, 10000)), "dimesso sul PC: «Dimesso sul PC: niente inviato»");
check(!Object.values(await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:note.v1") || "{}"))).some((n) => /dimissione/.test(n.t)), "e la nota non arriva");
await tocca(tel, '[data-a="indietro"]');
check(!/VERDI/.test(await aspettaTel(tel, /ROSSI M\./, 10000)), "e dall'elenco del telefono se ne va");

// ===========================================================================
sezione("i messaggi ripetuti o manomessi non passano");
const daTel = () => inoltrati.filter((b) => b[1] === 3);
// una nota, catturata per strada, poi un'altra: rimandare la prima non la rimette
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Valori/, 15000);
const noteSulPc = () => doc.evaluate(() => Object.values(JSON.parse(localStorage.getItem("psassist:note.v1") || "{}")).map((n) => n.t));
const prima = daTel().length;
await tocca(tel, '[data-a="nota"]');
await tel.locator("#nota").fill("nota A");
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
await finche(async () => (await noteSulPc()).includes("nota A"), 10000);
const fNotaA = daTel().slice(prima).at(-1);
await tocca(tel, '[data-a="nota"]');
await tel.locator("#nota").fill("nota B");
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
await finche(async () => (await noteSulPc()).includes("nota B"), 10000);
// qualcuno sulla strada (fra il telefono e il ripetitore) che rimanda quello che vuole
const versoPc = (frames) => { const p = rete.prese.get(rete.ultima); for (const f of frames) p.server.send(Buffer.from(f)); };
const manomesso = Buffer.from(fNotaA); manomesso[9] ^= 0x7f; manomesso[manomesso.length - 2] ^= 1;
versoPc([fNotaA, manomesso]);
await sospendi(1200);
check((await noteSulPc()).includes("nota B") && !(await noteSulPc()).includes("nota A"), "una nota ripetuta per strada non torna, e una manomessa nemmeno: scartate");
versoPc([0, 1, 2, 3, 4, 5].map((i) => { const g = Buffer.from(manomesso); g[g.length - 3 - i] ^= 0x55; return g; }));
await sospendi(1500);
check(!!(await statoPonte())?.sessione, "sei messaggi non validi di fila: ignorati, la sessione resta (chi non ha le chiavi non chiude niente)");
await tocca(tel, '[data-a="indietro"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 10000)) && !/Sessione chiusa/.test(await testoTel(tel)), "e il telefono continua");

// ===========================================================================
sezione("la pagina del telefono si ricarica (iOS la butta via in sottofondo)");
await tel.reload();
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "ricaricata: di nuovo dentro subito, senza QR (la sessione di prima non la blocca)");
check(/iPhone ricollegato: sessione nuova/.test(await registroPonte()), "sul PC: «iPhone ricollegato: sessione nuova»");

// ===========================================================================
sezione("il battito: una presa che sembra aperta ma non porta niente");
const prese1 = relay.entrate().tel;
rete.muta = rete.ultima;
await tel.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));   // tornati sull'app: si prova subito la presa
check(await finche(async () => relay.entrate().tel > prese1, 14000), "nessun «pong» entro 10 secondi: il telefono rifà la presa");
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 10000)), "e l'elenco resta");
// tornati sull'app: l'elenco si rilegge da solo
const lettiPrima = ((await registroPc(doc)).match(/iPhone · elenco dei pazienti/g) || []).length;
await tel.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
check(await finche(async () => ((await registroPc(doc)).match(/iPhone · elenco dei pazienti/g) || []).length > lettiPrima, 10000),
  "tornati sull'app, l'elenco si rilegge da solo");

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
await shot(tel, "tel-7-sessione-chiusa");
check(await finche(async () => (await $panel(doc, ".pontespia").count()) === 0, 8000), "e sul PC la spia si spegne");
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "riaperta col tocco, senza QR");
// l'app lasciata in sottofondo: le riletture da sola non contano come comandi
await tel.evaluate(() => { const v = Date.now; window.__oraVera = v; Date.now = () => v() + 15 * 60e3; document.dispatchEvent(new Event("visibilitychange")); });
await sospendi(1500);
check(!/Sessione chiusa/.test(await testoTel(tel)), "a 15 minuti, tornati sull'app: l'elenco si rilegge da solo…");
await tel.evaluate(() => { const v = window.__oraVera; Date.now = () => v() + 21 * 60e3; document.dispatchEvent(new Event("visibilitychange")); });
const sottofondo = await aspettaTel(tel, /Sessione chiusa/, 5000);
await tel.evaluate(() => { Date.now = window.__oraVera; });
check(/20 minuti senza comandi/.test(sottofondo) && !/ROSSI/.test(sottofondo), "…ma non conta: a 21 minuti dall'ultimo comando del medico il telefono chiude da solo, via i pazienti");
check(await finche(async () => !(await statoPonte())?.sessione, 5000), "e lo dice al PC, che chiude la sessione");
await tocca(tel, '[data-a="riapri"]');
await aspettaTel(tel, /ROSSI M\./, 15000);

// ===========================================================================
sezione("«Scollega» sul PC");
await finche(async () => (await $panel(doc, "#ponteoff").count()) === 1, 8000);
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Valori/, 15000);
await tocca(tel, '[data-a="nota"]');
await tel.locator("#nota").fill("nota C");
await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
await aspettaTel(tel, /Nota salvata sul PC/, 10000);
await $panel(doc, "#ponteoff").click();
const scollegata = await aspettaTel(tel, /Sessione chiusa/, 10000);
check(/Chiusa dal PC con «Scollega»/.test(scollegata), "«Scollega»: il telefono si chiude, «Chiusa dal PC con «Scollega»» (con la maiuscola)");
check(await tel.locator(".avviso").count() === 0, "e gli avvisi di prima se ne vanno con la sessione");
await tocca(tel, '[data-a="riapri"]');
await aspettaTel(tel, /ROSSI M\./, 15000);

// ===========================================================================
sezione("nessun gestionale aperto, sessione del gestionale scaduta");
await doc.close();
await tocca(tel, '[data-a="menu"]');
await tocca(tel, '[data-a="aggiornaLista"]');
check(/Apri il gestionale sul PC/.test(await aspettaTel(tel, /Apri il gestionale sul PC/, 15000)), "senza schede del gestionale: «Apri il gestionale sul PC»");
await tocca(tel, '[data-a="menu"]');
await tocca(tel, '[data-a="esci"]');
await aspettaTel(tel, /Sessione chiusa/, 10000);
await tocca(tel, '[data-a="riapri"]');
check(/Elenco non letto/.test(await aspettaTel(tel, /Elenco non letto/, 15000)) && await tel.locator('[data-a="aggiornaLista"]:has-text("Riprova")').count() === 1,
  "riaperta senza gestionale: «Elenco non letto» e «Riprova», non una rotella per sempre");
await shot(tel, "tel-8-elenco-non-letto");
const doc2 = await ctx.newPage();
await suPagina(doc2, A.worklistUrl);
await tocca(tel, '[data-a="aggiornaLista"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "aperto il gestionale, «Riprova»: l'elenco");
login = true;
await tocca(tel, '[data-a="paz"][data-ep="999002"]');
check(/Gestionale da riaprire/.test(await aspettaTel(tel, /Gestionale da riaprire/, 15000)), "col gestionale che chiede l'accesso: «Gestionale da riaprire»");
login = false;
await tocca(tel, '[data-a="indietro"]').catch(() => {});

// ===========================================================================
sezione("il service worker si ferma e riparte");
await aspettaTel(tel, /ROSSI M\./, 15000);
await ponte.close();   // (la pagina del ponte, aperta, lo sveglierebbe lei: devono farlo le schede del gestionale)
await sw.evaluate(() => { self.__vecchio = true; });
const dalPc0 = rete.dalPc.length;
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
check(await finche(async () => relay.prese().pc === 1, 45000), "le schede del gestionale lo svegliano, e si ricollega da solo al ponte (la chiave è rimasta, in memoria)");
sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || sw;
check(!(await sw.evaluate(() => self.__vecchio).catch(() => true)) && !(await statoPonte())?.sessione, "è un service worker nuovo: la sessione di prima non c'è più, le sue chiavi stavano in memoria");
check(/estensione sul PC si è riavviata/.test(await aspettaTel(tel, /Sessione chiusa/, 15000)), "il telefono lo scopre appena il PC torna sul ponte: «L'estensione sul PC si è riavviata»");
// il «riparti» che l'ha chiusa, catturato per strada
let riparti = null;
for (const f of rete.dalPc.slice(dalPc0)) {
  if (f[1] !== P.TIPO.SALUTO_PC) continue;
  try { if ((await P.apri(CH1.salutoPc, new Uint8Array(f), P.TIPO.SALUTO_PC)).dati.riparti) riparti = f; } catch { /* altro */ }
}
check(!!riparti, "(il «riparti» del PC, catturato sulla strada)");
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "e riprende con un tocco");
if (riparti) rete.prese.get(rete.ultima).ws.send(riparti);
await sospendi(1500);
check(!/Sessione chiusa/.test(await testoTel(tel)) && /ROSSI M\./.test(await testoTel(tel)), "quel «riparti» rimandato più tardi non chiude la sessione nuova");

// ===========================================================================
sezione("revoca, link che sostituiscono, scadenza, la pagina d'accesso");
const ponte2 = await ctx.newPage();
await ponte2.goto(EXTURL("ponte.html"));
await ponte2.waitForSelector("#revoca:not([hidden])");
await ponte2.locator("#revoca").click();
check(/Revoco\?/.test(await ponte2.locator("#revoca").innerText()), "«Revoca» chiede conferma");
await ponte2.locator("#revoca").click();
check(/revocat/.test(await aspettaTel(tel, /revocat/, 10000)), "revocata: il telefono lo dice");
check(await tel.evaluate(() => localStorage.length) === 0, "e dimentica la chiave");
const vecchio = await telCtx.newPage();
await vecchio.goto(url1);
const nonRisponde = await aspettaTel(vecchio, /Il PC non risponde/, 15000);
check(/Il PC non risponde/.test(nonRisponde) && /QR nuovo/.test(nonRisponde), "il vecchio QR non apre più niente: «Il PC non risponde», e se c'è un QR nuovo, inquadra quello");
await vecchio.close();
await tel.evaluate(() => localStorage.clear());
await ponte2.locator("#associa").click();
await ponte2.waitForSelector("#qr svg", { timeout: 8000 });
const url2 = await qrUrl();
check(url2 !== url1, "un QR nuovo, con una chiave nuova");
await tel.goto(url2);   // con l'app già aperta: cambia solo il frammento
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)), "il QR nuovo inquadrato con l'app aperta: chiave nuova, e di nuovo l'elenco");
// un link qualunque non porta via un'associazione buona (un telefono a parte)
const linkCtx = await telBrowser.newContext(IPHONE);
const lnk = await linkCtx.newPage();
const finta = (k) => `${relay.url}/ponte/#k=${P.b64u(k)}&scade=${Date.now() + 100 * 365 * 86400e3}`;
const KX = P.casuale(32), KY = P.casuale(32);
await lnk.goto(finta(KX));
await aspettaTel(lnk, /Mi collego|non risponde/, 10000);
const cx = await chiaveTel(lnk);
check(cx && cx.k === P.b64u(KX) && cx.scade <= Date.now() + 14 * 3600e3 + 60e3, "un link che dice «vale cent'anni» vale al massimo 14 ore");
await lnk.goto(finta(KY));
const chiede = await aspettaTel(lnk, /Un'altra associazione\?/, 10000);
check(/Un'altra associazione\?/.test(chiede) && chiede.includes(await P.codice(KY)) && chiede.includes(await P.codice(KX)),
  "un link che sostituirebbe un'associazione ancora buona chiede prima, coi due codici");
await shot(lnk, "tel-9-altra-associazione");
await tocca(lnk, '[data-a="tieni"]');
await sospendi(500);
check((await chiaveTel(lnk)).k === P.b64u(KX), "«Tieni quella di adesso»: la chiave resta");
await lnk.goto(finta(KY));
await aspettaTel(lnk, /Un'altra associazione\?/, 10000);
await tocca(lnk, '[data-a="sostituisci"]');
await sospendi(500);
check((await chiaveTel(lnk)).k === P.b64u(KY), "«Usa il codice …»: la chiave nuova");
await linkCtx.close();
await avanti(14 * 3600e3 + 60e3);
await orologio();
check(/scaduta/.test(await aspettaTel(tel, /scaduta/, 10000)), "passate le 14 ore: «Associazione scaduta» sul telefono");
const cpScad = await coppiaPc();
check(!cpScad.disco && !cpScad.memoria && !(await statoPonte())?.accoppiato, "e sul PC la chiave non c'è più");
await shot(tel, "tel-10-scaduta");
// una scheda del gestionale torna alla pagina d'accesso: chi rientra può essere un altro medico
await ponte2.reload();
await ponte2.waitForSelector("#stato b");
await ponte2.locator("#associa").click();
await ponte2.waitForSelector("#qr svg", { timeout: 8000 });
const url3 = await qrUrl();
await tel.goto(url3);
await aspettaTel(tel, /ROSSI M\./, 15000);
login = true;
await doc2.goto(A.patientUrl);
login = false;
const accesso = await aspettaTel(tel, /pagina d'accesso/, 15000);
check(/Associazione chiusa/.test(accesso) && /Il gestionale sul PC è tornato alla pagina d'accesso/.test(accesso),
  "una scheda del gestionale alla pagina d'accesso: il telefono è fuori, «Il gestionale sul PC è tornato alla pagina d'accesso»");
const cpLogin = await coppiaPc();
check(!cpLogin.memoria && await tel.evaluate(() => localStorage.length) === 0, "e l'associazione non c'è più, né sul PC né sul telefono");
await shot(tel, "tel-11-pagina-accesso");

// ===========================================================================
sezione("il ripetitore non vede niente in chiaro");
// (solo parole di almeno 5 lettere: due o tre byte uguali per caso, in tanti byte cifrati, ci sono sempre)
const segreti = ["ROSSI", "BIANCHI", "MARIO", "VERDI", "TROPONINA", "EMOCROMO", CF_A, CF_B, "999001", "999002", "tropo", "dolore", "allergico", "ENCEFALO", "pazienti", "focolai"];
const tutti = Buffer.concat(inoltrati);
check(inoltrati.length > 30, `(${inoltrati.length} messaggi inoltrati)`);
check(inoltrati.every((b) => b[0] === 1 && b[1] >= 1 && b[1] <= 4), "ognuno è un messaggio cifrato del ponte (versione 1, tipo 1–4)");
const visti = segreti.filter((s) => tutti.includes(Buffer.from(s, "latin1")) || tutti.includes(Buffer.from(s, "utf8")) || tutti.includes(Buffer.from(s, "utf16le")));
check(!visti.length, `nessun nome, esame, codice fiscale, episodio o testo in nessun messaggio (trovati: ${visti.join(", ") || "nessuno"})`);

// ===========================================================================
sezione("la prova della rete");
const prova = await ctx.newPage();
const altriHost = [];
prova.on("request", (r) => { const u = new URL(r.url()); if (u.protocol !== "chrome-extension:" && u.origin !== relay.url) altriHost.push(r.url()); });
prova.on("websocket", (w) => { if (!w.url().startsWith(relay.url.replace(/^http/, "ws") + "/ponte/ws?")) altriHost.push(w.url()); });
await prova.addInitScript(() => { navigator.clipboard.writeText = async (t) => { window.__copiato = t; }; });
await prova.goto(EXTURL("ponte-prova.html?durata=4"));
await prova.waitForFunction(() => !document.getElementById("copia").disabled, null, { timeout: 60000 });
const righe = () => prova.locator("li").evaluateAll((l) => l.map((x) => [x.className, x.innerText.replace(/\s+/g, " ")]));
const riga = async (re) => (await righe()).find(([, t]) => re.test(t)) || ["", ""];
check((await riga(/Collegamento al ponte/))[0] === "ok", `la presa vera del ponte, in una stanza di prova: verde (${(await riga(/Collegamento al ponte/))[1]})`);
check((await riga(/Andata e ritorno/))[0] === "ok" && /5 messaggi su 5 · in media \d+ ms/.test((await riga(/Andata e ritorno/))[1]), `andata e ritorno, coi tempi: verde (${(await riga(/Andata e ritorno/))[1]})`);
check(/Il ponte si può usare da questo PC/.test(await prova.locator("#esito").innerText()), "in cima, il verdetto in una riga");
await prova.locator("#lunga").click();
await prova.waitForFunction(() => !document.getElementById("lunga").disabled, null, { timeout: 30000 });
check((await riga(/Tenuta/))[0] === "ok" && /Rimasta aperta 4 s/.test((await riga(/Tenuta/))[1]), `«Tieni aperto»: rimasta aperta col battito (${(await riga(/Tenuta/))[1]})`);
await prova.locator("#lunga").click();
await sospendi(1500);
relay.taglia("tel");
await prova.waitForFunction(() => !document.getElementById("ancora").disabled, null, { timeout: 30000 });
const caduta = (await righe()).filter(([, t]) => /Tenuta/.test(t)).at(-1) || ["", ""];
check(caduta[0] === "ko" && /Caduta dopo \d+ s \(alle \d\d:\d\d, presa del telefono\): codice 1006/.test(caduta[1]), `e se cade, quando e perché (${caduta[1]})`);
await prova.locator("#copia").click();
check(await finche(async () => /copiato/.test(await prova.locator("#copiato").innerText()), 3000), "«Copia il risultato» risponde");
const copiato = await prova.evaluate(() => window.__copiato || "");
check(/Per l'IT/.test(copiato) && /\/ponte\/ws/.test(copiato) && /TCP 443/.test(copiato) && /20 secondi/.test(copiato) && /ispezione TLS/.test(copiato) && /proxy/.test(copiato),
  "nel testo copiato, il blocco «Per l'IT»: la presa, TCP 443, attraverso il proxy, il battito, niente ispezione TLS");
check(!altriHost.length, `nessun altro sito, nessun UDP: solo la presa del ponte (${altriHost.join(", ") || "niente altro"})`);
await shot(prova, "pc-4-prova-rete");

await telBrowser.close();
await ctx.close();
await relay.chiudi();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fail ? `\nPONTE: ${fail} CHECK FALLITI\n` : "\nPONTE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
