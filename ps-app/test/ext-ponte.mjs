#!/usr/bin/env node
/*
 * Il ponte verso l'iPhone, tutto vero: l'estensione caricata in Chromium col
 * gestionale simulato, il ripetitore Node (la stessa logica del Worker del
 * sito) e l'app del telefono in un secondo browser, in formato iPhone, con la
 * sua rete fra lei e il ripetitore (per perdere messaggi, come il 5G).
 * Associazione dal QR (una volta, un telefono solo), elenco, esiti con
 * «Aggiorna i valori», un ordine dal telefono fino alle etichette (il doppio
 * tocco, la risposta persa), nota e promemoria, la spia sul PC, i 3 minuti
 * senza comandi, «Scollega», un altro dispositivo, la pagina ricaricata, il
 * battito, la revoca, la scadenza, la pagina d'accesso del gestionale, i
 * messaggi ripetuti o manomessi, nessun gestionale aperto, il service worker
 * che si riavvia, il browser chiuso e riaperto, «Stampa un PDF» sull'A4 del
 * PC, «Scansiona il QR» con una fotocamera finta — e il ripetitore che non vede
 * mai niente in chiaro. In fondo, la prova della rete, e l'app al buio.
 *   node test/ext-ponte.mjs
 */
import { chromium } from "playwright";
import { createMock, refertoRxPdf } from "./sa4pso-mock.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import vm from "node:vm";

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
// l'età di BIANCHI (nata il 1/3/1975), che la sua testata non dice: dal codice fiscale
const ETA_B = new Date().getFullYear() - 1975 - (new Date().getMonth() < 2 ? 1 : 0);
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
// la testata della scheda del paziente, com'è nel gestionale: il triage, il
// nome e, in corpo 120%, la data di nascita con l'età — di ROSSI 77 anni
// (non i 66 del suo codice fiscale: conta la testata); quella di BIANCHI non la dice
const riquadro = (nome, triage, ep, cf, nascita) => `<table><tr><td title="${triage}"><font style="font-size: 120%; font-weight: bolder; ">${ep}</font><br><font style="font-size: 150%; font-weight: bolder; ">${nome}</font><br>${
  nascita ? `<font style="font-size: 120%; font-weight: bolder; ">${nascita}</font><br>` : ""}<font style="font-size: 120%; font-weight: bolder; ">${cf}</font></td></tr></table>`;
// La cartella di ROSSI: il modulo AmbulatorioPSO com'è nella pagina vera (i
// cinque campi, l'esame obiettivo di sola lettura se l'ha scritto un altro
// medico, «Conferma»), e il gestionale che lo riceve. Accesa solo nella sua sezione.
const CART = { on: false, lento: 0, eoRo: true, ignora: "", post: [], campi: {} };
const CART_NOMI = ["ANAMNESI", "ALLERGIE", "MALATTIE_PREGRESSE", "FARMACI_ASSUNTI", "ESAME_OBIETTIVO"];
const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const formCartella = (ep) => `<form method="post" name="AmbulatorioPSO" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${ep}">
  <table class="AFCFormTABLE"><tr><td class="AFCFieldCaptionTD">Anamnesi</td><td><textarea style="WIDTH: 90%" id="ANAMNESI" class="AFCTextarea" rows="3" name="ANAMNESI">${escH(CART.campi.ANAMNESI)}</textarea></td>
  <td class="AFCFieldCaptionTD">Allergie<br>Nega/Non riferisce <input id="ALLERGIE_NEGA" class="AFCInput" value="val" type="checkbox" name="ALLERGIE_NEGA"></td>
  <td><textarea id="ALLERGIE" class="AFCTextarea" rows="3" name="ALLERGIE">${escH(CART.campi.ALLERGIE)}</textarea></td></tr>
  <tr><td class="AFCFieldCaptionTD">Anamnesi Remota</td><td><textarea id="MALATTIE_PREGRESSE" class="AFCTextarea" rows="4" name="MALATTIE_PREGRESSE">${escH(CART.campi.MALATTIE_PREGRESSE)}</textarea></td>
  <td class="AFCFieldCaptionTD">Farmaci Assunti</td><td><textarea id="FARMACI_ASSUNTI" class="AFCTextarea" rows="4" name="FARMACI_ASSUNTI">${escH(CART.campi.FARMACI_ASSUNTI)}</textarea></td></tr>
  <tr><td class="AFCFieldCaptionTD">Esame obiettivo</td><td colspan="3"><textarea style="WIDTH: 95%" id="ESAME_OBIETTIVO" class="${CART.eoRo ? "JPSOReadonly" : "AFCTextarea"}" rows="6" name="ESAME_OBIETTIVO"${CART.eoRo ? ' readonly=""' : ""}>${escH(CART.campi.ESAME_OBIETTIVO)}</textarea></td></tr>
  <tr><td><input id="ESAMEOBIETTIVOAUTOSAVE" value="N" type="hidden" name="ESAMEOBIETTIVOAUTOSAVE"><input style="WIDTH: 90%" class="AFCInput" value="" maxlength="100" name="PERSONA_RIFERIMENTO"></td>
  <td colspan="3" align="right"><input class="AFCButton" value="Annulla OBI" type="submit" name="AnnullaOBI" style="display: none;"> <input class="AFCButton" value="Conferma" type="submit" name="Update"></td></tr></table></form>`;
// (il corpo del modulo, in windows-1252 come lo manda il browser)
const decodificaModulo = (buf) => Object.fromEntries(Buffer.from(buf || []).toString("latin1").split("&").filter(Boolean).map((kv) => {
  const d = (s) => s.replace(/\+/g, " ").replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const i = kv.indexOf("=");
  return i < 0 ? [d(kv), ""] : [d(kv.slice(0, i)), d(kv.slice(i + 1))];
}));
const LOGIN = `<html><head><title>Accesso</title></head><body><form name="Login" method="post" action="login.do"><input name="username"><input type="password" name="password"><input type="submit" value="Accedi"></form></body></html>`;

// il browser del PC (una funzione: lo si chiude e lo si riapre, con lo stesso profilo)
async function apriBrowser() {
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
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
  // «Conferma» della cartella di ROSSI: il gestionale salva i campi (non quello che ignora) e risponde con la pagina del paziente
  let metodo = req.method();
  if (CART.on && metodo === "POST" && /ccsForm=AmbulatorioPSO(:|%3A)Edit/i.test(u) && quale(u) === A) {
    if (CART.lento) await sospendi(CART.lento);
    const f = decodificaModulo(req.postDataBuffer());
    CART.post.push(f);
    for (const n of CART_NOMI) if (n in f && n !== CART.ignora) CART.campi[n] = f[n].replace(/\r\n/g, "\n");
    metodo = "GET";
  }
  const mock = quale(u);
  let out = metodo !== req.method() ? mock.handle({ method: "GET", url: A.patientUrl }) : mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, u).href });
  if (/html/.test(out.headers["content-type"] || "") && /MVPG=PsoEpisodioClinicoAmbulatorio|^[^?]*\?EPISODIO_ID/.test(u)) {
    const m = quale(u), rossi = m === A;
    // (il referto di radiologia del banco è una TC, il cui testo il PC non legge più da solo
    // — si apre nel visore —: a ROSSI si aggiunge una radiografia, il cui testo sì)
    const rx = `<table><tr><td class="AFCDataTD" title="69-140 RX TORACE (A6900)"><a href="#" title="REFERTO" onclick="javascript:window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=*TEST00001&REFERTO_SISTEMA=HL7RIS&REFERTO_ID=dddd4444-0000-0000-0000-000000000004','HL7RIS')"><img alt="referto"></a>
      69-140 RX TORACE (A6900)<input type="hidden" name="DATA_ORD" value="2026-08-22 03:10:00.0"><input type="hidden" name="DESCRIZIONE_TITLE" value="69-140 RX TORACE (A6900)"></td></tr></table>`;
    let html0 = Buffer.from(out.body).toString("latin1");
    if (rossi && CART.on) html0 = html0.replace(/<form name="AmbulatorioPSO"[\s\S]*?<\/form>/, formCartella(m.state.episodeId));
    const html = html0.replace("</body>", (rossi ? rx : "") + "</body>").replace("<body>", "<body>" + riquadro(rossi ? "ROSSI MARIO" : "BIANCHI ANNA", rossi ? "ARANCIONE" : "VERDE", m.state.episodeId, rossi ? CF_A : CF_B, rossi ? "17/05/1949 (77) M" : ""));
    out = { ...out, body: Buffer.from(html, "latin1") };
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa intanto */ }
});
return ctx;
}
let ctx = await apriBrowser();
const swDi = async (c) => c.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || c.waitForEvent("serviceworker", { timeout: 15000 });
let sw = await swDi(ctx);
const extId = new URL(sw.url()).host;
const EXTURL = (f) => `chrome-extension://${extId}/${f}`;
const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`);
const statoPonte = () => sw.evaluate(() => chrome.storage.session.get("ponte").then((o) => o.ponte || null));
const coppiaPc = () => sw.evaluate(() => chrome.storage.local.get("ponte.coppia").then((o) => o["ponte.coppia"] || null));
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
// l'orologio del telefono avanti o indietro, quando una prova lo chiede (sessionStorage «__salto», in ms)
const salto = () => { try { const x = Number(sessionStorage.getItem("__salto") || 0); if (x) { const v = Date.now; Date.now = () => v() + x; } } catch { /* about:blank */ } };
await telCtx.addInitScript(salto);
// La rete del telefono: ogni presa passa di qui. `perdi` = il numero di una
// presa di cui si perdono i messaggi cifrati dal PC (le risposte); `muta` =
// una presa che non porta più niente in nessun verso, nemmeno il «pong»;
// `ritarda` = quanti millisecondi trattenere i messaggi cifrati verso il PC.
const rete = { n: 0, prese: new Map(), ultima: 0, perdi: 0, muta: 0, ritarda: 0, dalPc: [], alPc: [] };
const chiusura = (code, reason) => (code === 1000 || (code >= 3000 && code <= 4999) ? { code, reason } : {});
await telCtx.routeWebSocket(/\/ponte\/ws/, (ws) => {
  const n = ++rete.n;
  const server = ws.connectToServer();
  rete.prese.set(n, { ws, server });
  rete.ultima = n;
  ws.onMessage((m) => {
    if (typeof m !== "string") rete.alPc.push(Buffer.from(m));
    if (rete.muta === n) return;
    if (rete.ritarda && typeof m !== "string") setTimeout(() => { try { server.send(m); } catch { /* chiusa intanto */ } }, rete.ritarda);
    else server.send(m);
  });
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
const pazPc = () => doc.evaluate(() => localStorage.getItem("psassist:patients.v1") || "[]");
const etaPc = async () => Object.fromEntries(JSON.parse(await pazPc()).map((p) => [p.name, p.eta]));
await finche(async () => (await etaPc())["BIANCHI ANNA"] != null, 8000);
check((await etaPc())["ROSSI MARIO"] === 77 && (await etaPc())["BIANCHI ANNA"] === ETA_B && !/\d{1,2}\/\d{1,2}\/\d{4}/.test(await pazPc()),
  `aperta la sua pagina, del paziente resta l'età — dalla testata (ROSSI 77), se no dal codice fiscale (BIANCHI ${ETA_B}) —, mai la data di nascita`);
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
  localStorage.setItem("psassist:stanza.ps.posti.v1", JSON.stringify({ 999001: { tipo: "letto", id: "obi2", ts: ora } }));
  // le aree lette dalle liste del gestionale: in Alta BIANCHI (riga 1) e ROSSI (riga 2), VERDI in Bassa
  localStorage.setItem("psassist:aree.v1", JSON.stringify({ membri: { 999002: { k: "alta", ts: ora, n: 1 }, 999001: { k: "alta", ts: ora, n: 2 }, 999003: { k: "bassa", ts: ora, n: 1 } },
    viste: { alta: { label: "AREA ALTA INTENSITA'", ts: ora }, bassa: { label: "AREA BASSA INTENSITA'", ts: ora } } }));
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
check(/\(ekg-atlas\.whirly\.workers\.dev\)/.test(await ponte.locator("#dove").innerText()) && !(await ponte.locator("#associa").isDisabled()) && /Nessun iPhone associato/.test(await ponte.locator("#stato").innerText()),
  `l'indirizzo del ponte è quello fissato nella build (ponte/host.txt): ekg-atlas.whirly.workers.dev (${await ponte.locator("#dove").innerText()})`);
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
const pagina = `${await ponte.locator("#stato").innerText()}\n${await ponte.locator("#qrsec").innerText()}`;
check(pagina.split(codice1).length === 2 && (pagina.match(/fino alle \d\d:\d\d/g) || []).length === 1 && /^\d\d:\d\d$/.test(await ponte.locator("#qrscade").innerText()),
  `il codice e l'ora di fine una volta sola, accanto al QR (${(await ponte.locator("#stato").innerText()).replace(/\n/g, " / ")})`);
const cp = await coppiaPc();
check(cp && cp.k === P.b64u(K1) && cp.scade === scade1, "sul PC la chiave sta in storage.local, con la sua scadenza (regge il browser chiuso: più sotto)");
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
const titoli = JSON.stringify(await tel.locator(".lbl").evaluateAll((l) => l.map((x) => x.textContent)));
const fila = (await tel.locator("main > .carta").first().locator(".paz .nome").allInnerTexts()).join(",");
check(/OBI 2/.test(lista) && titoli === '["Alta intensità","Bassa","Episodi precedenti"]' && /^BIANCHI A\.,ROSSI M\.$/.test(fila),
  `per area come la Lista del PC (Alta, poi Bassa), dentro nell'ordine del gestionale (BIANCHI, ROSSI col suo posto OBI 2); gli episodi precedenti a parte; niente conteggi (${titoli} · ${fila})`);
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
check(await altro.evaluate(() => localStorage.length) === 1, "…e la sua chiave la tiene (serve a «Cancella e riassocia», più sotto)");
check(await altro.locator('[data-a="cambia"]').innerText() === "Cancella e riassocia" && await altro.locator("#app input").count() === 1
  && JSON.stringify(await altro.locator("#app button").allInnerTexts()) === '["Cancella e riassocia","Scansiona il QR"]' && await altro.locator(".grande.quiet[data-a=scansiona]").count() === 1
  && !/Revoca/.test(await testoTel(altro)), "su quella schermata: «Cancella e riassocia» col campo per il codice, e sotto, più quieto, «Scansiona il QR»; nient'altro (niente spiegazioni)");
await shot(altro, "tel-2-cancella-e-riassocia");
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
sezione("«Cancella e riassocia»: un secondo telefono, col codice");
// il codice è 93, e si controlla sul PC; la richiesta viaggia cifrata con la chiave del QR
const dev0 = (await chiaveTel(tel)).dev;
const cp0 = await coppiaPc();
const nuovoTel = async () => { const c = await telBrowser.newContext(IPHONE); return { c, p: await c.newPage() }; };
// (prima la risposta di prima: arrivando, svuota il campo — e il codice nuovo andrebbe perso)
const scrivi = async (t, codice) => {
  await finche(() => t.locator('[data-a="cambia"]').isEnabled().catch(() => false), 10000);
  await t.locator("#cambio").fill(codice); await tocca(t, '[data-a="cambia"]');
};
const sbagliati = async () => (await coppiaPc())?.errori || 0;
const orologioPc = (ms) => sw.evaluate((x) => { self.__oraVera = self.__oraVera || Date.now; const v = self.__oraVera; Date.now = () => v() + x; }, ms);
const orologioVero = () => sw.evaluate(() => { if (self.__oraVera) Date.now = self.__oraVera; });
const registroSenza = async (re) => !re.test(await registroPonte());

// 1. un telefono SENZA la chiave del QR non può nemmeno chiederlo: il messaggio non si apre, il PC non risponde e non cambia niente
const estraneo = await nuovoTel();
await estraneo.p.goto(relay.url + "/ponte/");
const KF = P.casuale(32), CHF = await P.chiaviCoppia(KF);
const richiesta = await P.sigilla(CHF.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: P.b64u(P.casuale(16)), dev: P.b64u(P.casuale(16)), cambio: "93" });
const risposte = await estraneo.p.evaluate(({ url, frame }) => new Promise((ok) => {
  const got = [], ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(new Uint8Array(frame));
  ws.onmessage = (e) => got.push(typeof e.data === "string" ? "testo" : "binario");
  setTimeout(() => { ws.close(); ok(got); }, 2500);
}), { url: relay.url.replace(/^http/, "ws") + "/ponte/ws?r=" + CH1.stanza + "&ruolo=tel", frame: Array.from(richiesta) });
const cpE = await coppiaPc();
check(!risposte.includes("binario") && cpE.dev === dev0 && !cpE.cambiata && !(await statoPonte()).cambiato && await sbagliati() === 0 && await registroSenza(/Cancella e riassocia|cambiato/),
  `un telefono senza la chiave, col codice giusto: nessuna risposta, niente cambia, nemmeno un tentativo sbagliato (risposte: ${risposte.join(",") || "nessuna"})`);
await estraneo.c.close();

// 2. il secondo telefono (la chiave ce l'ha: ha inquadrato il QR) vede il bottone; codice sbagliato: niente cambia
const secondo = await nuovoTel();
// (le richieste di questo telefono, catturate sulla strada: più sotto una viene rimandata)
const uscite = [];
await secondo.c.routeWebSocket(/\/ponte\/ws/, (ws) => {
  const server = ws.connectToServer();
  ws.onMessage((m) => { if (typeof m !== "string") uscite.push(Buffer.from(m)); server.send(m); });
  server.onMessage((m) => ws.send(m));
  ws.onClose((code, reason) => server.close(chiusura(code, reason)));
  server.onClose((code, reason) => ws.close(chiusura(code, reason)));
});
await secondo.p.goto(url1);
await aspettaTel(secondo.p, /associato a un altro telefono/, 15000);
check(await secondo.p.locator('[data-a="cambia"]').count() === 1, "il secondo telefono, sulla schermata «associato a un altro telefono», vede «Cancella e riassocia»");
await scrivi(secondo.p, "12");
check(/Codice sbagliato/.test(await aspettaTel(secondo.p, /Codice sbagliato/, 10000)), "codice sbagliato: «Codice sbagliato»");
const cpS = await coppiaPc();
check(cpS.dev === dev0 && !cpS.cambiata && cpS.scade === cp0.scade && !(await statoPonte()).cambiato && !!(await statoPonte()).sessione && await sbagliati() === 1,
  "…e sul PC non cambia niente: stesso telefono, stessa scadenza, la sessione di prima è ancora lì");
await shot(secondo.p, "tel-3-codice-sbagliato");

// 3. cinque sbagli: per 10 minuti niente cambi, nemmeno col codice giusto
for (const [i, c] of ["7", "0", "94"].entries()) { await scrivi(secondo.p, c); await finche(async () => (await sbagliati()) === i + 2, 8000); }
await scrivi(secondo.p, "931");
const bloccato = await aspettaTel(secondo.p, /Troppi tentativi: riprova alle \d\d:\d\d/, 10000);
check(/Troppi tentativi: riprova alle \d\d:\d\d/.test(bloccato), `il quinto: «Troppi tentativi», e fino a che ora (${bloccato.replace(/\s+/g, " ").slice(-50)})`);
const cpB = await coppiaPc();
check(cpB.blocco > Date.now() + 9 * 60e3 && cpB.blocco <= Date.now() + 10 * 60e3 + 5e3 && cpB.dev === dev0, "sul PC: il blocco dura 10 minuti, e niente è cambiato");
await scrivi(secondo.p, "93");
check(/Troppi tentativi/.test(await aspettaTel(secondo.p, /Troppi tentativi/, 10000)) && (await coppiaPc()).dev === dev0,
  "durante il blocco anche il 93 è rifiutato");

// 4. passati i 10 minuti, il 93 prende il posto
await orologioPc(10 * 60e3 + 5e3);
await scrivi(secondo.p, "93");
const lista2 = await aspettaTel(secondo.p, /ROSSI M\./, 20000);
await orologioVero();
check(/ROSSI M\./.test(lista2) && /BIANCHI A\./.test(lista2), "col 93 (finito il blocco): questo telefono è quello associato, e compare l'elenco");
const cpC = await coppiaPc();
check(cpC.dev === (await chiaveTel(secondo.p)).dev && cpC.dev !== dev0 && cpC.scade === cp0.scade && cpC.k === cp0.k && !cpC.errori && !cpC.blocco && Math.abs(cpC.cambiata - Date.now() - 10 * 60e3) < 60e3,
  "sul PC: il telefono dell'associazione è il nuovo, stessa chiave e stessa scadenza (il cambio non la allunga), i conti dei codici sbagliati azzerati");
const stC = await statoPonte();
check(!!stC.sessione && stC.cambiato === cpC.cambiata && /iPhone cambiato alle \d\d:\d\d/.test(await registroPonte()), "e il registro del ponte dice «iPhone cambiato alle HH:MM»");
await ponte.bringToFront();
check(await finche(async () => /iPhone cambiato alle \d\d:\d\d/.test(await ponte.locator("#stato").innerText()), 8000), `la pagina ⋯ → iPhone del PC lo mostra: «iPhone cambiato alle HH:MM» (${(await ponte.locator("#stato").innerText()).replace(/\n/g, " / ")})`);
await shot(ponte, "pc-5-iphone-cambiato");
await doc.bringToFront();

let richiesta93 = null;
for (const f of uscite) { try { if ((await P.apri(CH1.salutoTel, new Uint8Array(f), P.TIPO.SALUTO_TEL)).dati.cambio === "93") richiesta93 = f; } catch { /* altro */ } }
// 5. il telefono di prima: se rientra, «associato a un altro telefono» (con la sua chiave, come prima)
await sospendi(500);
await tocca(tel, '[data-a="riapri"]');
const fuori = await aspettaTel(tel, /associato a un altro telefono/, 15000);
check(/associato a un altro telefono/.test(fuori) && await tel.locator('[data-a="cambia"]').count() === 1 && (await chiaveTel(tel))?.dev === dev0,
  "il telefono di prima, rientrando: «Il PC è associato a un altro telefono», col suo «Cancella e riassocia»");
// …e se lo riprende allo stesso modo
await scrivi(tel, "93");
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 20000)) && (await coppiaPc()).dev === dev0 && (await coppiaPc()).scade === cp0.scade, "col 93 si riprende il posto: di nuovo l'elenco, sul PC il telefono di prima");
await secondo.p.reload();
await secondo.c.close();
// la richiesta del 93 di prima, catturata sulla strada e rimandata da chi sta in mezzo, non vale una seconda volta
const rimando = await nuovoTel();
await rimando.p.goto(relay.url + "/ponte/");
const rimandata = await rimando.p.evaluate(({ url, frame }) => new Promise((ok) => {
  const got = [], ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(new Uint8Array(frame));
  ws.onmessage = (e) => { if (typeof e.data !== "string") got.push(Array.from(new Uint8Array(e.data))); };
  setTimeout(() => { ws.close(); ok(got); }, 2500);
}), { url: relay.url.replace(/^http/, "ws") + "/ponte/ws?r=" + CH1.stanza + "&ruolo=tel", frame: Array.from(richiesta93) });
let rifiutata = false;
for (const f of rimandata) { try { rifiutata = (await P.apri(CH1.salutoPc, new Uint8Array(f), P.TIPO.SALUTO_PC)).dati.no === "altro telefono"; } catch { /* altro */ } }
check(!!richiesta93 && rifiutata && (await coppiaPc()).dev === dev0, "la richiesta del 93 di prima, rimandata più tardi dal ripetitore: rifiutata, il telefono associato resta quello");
await rimando.c.close();
await tel.reload();
await aspettaTel(tel, /ROSSI M\./, 20000);

// ===========================================================================
sezione("nota e promemoria dal telefono");
// sul PC nota e promemoria sono voci di «Da fare», per episodio: la nota è la prima
// aperta senza ora, i promemoria quelle aperte con l'ora (una spuntata resta 5 minuti, barrata)
const daFarePc = (ep = "999001") => doc.evaluate((e) => (JSON.parse(localStorage.getItem("psassist:dafare.v1") || "{}")[e] || []).filter((x) => !x.fatto), ep);
const notePc = () => doc.evaluate(() => Object.values(JSON.parse(localStorage.getItem("psassist:dafare.v1") || "{}")).flat().filter((x) => x.t == null && !x.fatto).map((x) => x.testo));
await tocca(tel, '.paz[data-ep="999001"]');
const testa = await aspettaTel(tel, /Aggiorna i valori/, 20000);
check(await tel.locator(".top .tit").innerText() === "ROSSI MARIO · 77 anni · OBI 2", `in testa il nome intero, l'età e il posto, e nient'altro: «ROSSI MARIO · 77 anni · OBI 2» (${(await tel.locator(".top .tit").innerText()).replace(/\n/g, " / ")})`);
check(await tel.evaluate(() => { const s = document.querySelector(".seg"), n = document.querySelector(".note"); return !!s && !!n && !!(s.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING); }),
  "le schede Esiti/Richieste vengono prima della nota");
check(await tel.locator("#nota").count() === 0 && await tel.locator('[data-a="nota"]:has-text("+ Nota")').count() === 1, "la nota vuota è chiusa: «+ Nota»");
await tocca(tel, '[data-a="nota"]');
await tel.locator("#nota").fill("dolore dalle 6, allergico a PCN");
await tocca(tel, '[data-a="promApri"]');   // uscire dal campo salva la nota
await aspettaTel(tel, /Nota salvata sul PC/, 10000);
const noteSuPc = await daFarePc();
check(noteSuPc.length === 1 && noteSuPc[0].testo === "dolore dalle 6, allergico a PCN" && noteSuPc[0].t === null,
  `la nota arriva sul PC: la prima voce di «Da fare», senza ora (got: ${JSON.stringify(noteSuPc.map((x) => [x.testo, x.t]))})`);
await tel.locator("#promin").fill("tra 2h tropo");
await tocca(tel, '[data-a="prom"]');
await finche(async () => (await tel.locator(".promr").count()) === 1, 10000);
const prom = (await daFarePc()).filter((x) => x.t != null);
check(prom.length === 1 && prom[0].testo === "tropo" && Math.abs(prom[0].t - Date.now() - 2 * 3600e3) < 120e3, "il promemoria «tra 2h tropo» è sul PC, per quel paziente");
await tocca(tel, '[data-a="promApri"]');
await tel.locator("#promin").fill("ECG");
await tocca(tel, '[data-a="prom"]');
check(/Scrivi anche l'ora/.test(await aspettaTel(tel, /Scrivi anche l'ora/, 8000)), "senza un orario non salva, e lo dice");
await tel.locator("#promin").fill("11:30 ecg di controllo");
await tocca(tel, '[data-a="prom"]');
await finche(async () => (await tel.locator(".promr").count()) === 2, 10000);
const promPc = async () => (await daFarePc()).filter((x) => x.t != null);
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
// sul PC il referto della radiografia si è letto da solo, aprendo il paziente: il suo testo ora viaggia anche verso il telefono
await suPagina(doc, A.patientUrl);
await $panel(doc, "#expand").click();
await doc.waitForSelector("#psassist-host .card", { timeout: 8000 });
await $panel(doc, '[data-seg="esiti"]').click();
await doc.waitForSelector('#psassist-host [data-esito="dddd4444-0000-0000-0000-000000000004"] .wuex', { timeout: 30000 }).catch(() => {});
await $panel(doc, "#collapse").click();
await suPagina(doc, A.worklistUrl);
const vistoPrima = await doc.evaluate(() => (JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").find((p) => p.ep === "999001") || {}).ts);
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /BIANCHI A\./);
await tocca(tel, '.paz[data-ep="999001"]');
const es0 = await aspettaTel(tel, /RX TORACE/, 20000);
check(/non ha ancora letto valori/.test(es0), "prima di leggerli: «Il PC non ha ancora letto valori»");
check(/RX TORACE/.test(es0), "i referti della pagina del paziente, letti sul PC");
await tocca(tel, '.ref:has-text("RX TORACE")');
check(/Non focolai a carattere broncopneumonico/.test(await aspettaTel(tel, /Non focolai/, 8000)), "il referto già letto sul PC si legge sul telefono, col suo testo");

// ===========================================================================
sezione("un referto PDF salvato sul PC, sul telefono");
{
  const idRef = await tel.locator('.ref:has-text("TC ENCEFALO")').first().getAttribute("data-id");
  const SEGNO = "ZQXW7731 CAMPIONE PDF";
  // più di due pezzi: il PDF vero, e dietro un riempitivo (i pezzi sono da ~390 KB)
  const pdf = Buffer.concat([refertoRxPdf(["RADIOLOGIA - prova", SEGNO, "Non focolai a carattere broncopneumonico."]), Buffer.alloc(900000, 0x41)]);
  const esa = (x) => [...x].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  const seme = (ep) => sw.evaluate(([k, ep, data]) => chrome.storage.local.set({ [k]: { ep, data, ts: Date.now() } }), ["ref:" + idRef, ep, pdf.toString("base64")]);
  // (gli esiti di prima restano sullo schermo finché non arriva la risposta nuova: si aspetta lei)
  const riapri = async () => {
    await tocca(tel, '[data-a="indietro"]'); await aspettaTel(tel, /BIANCHI A\./);
    const n = inoltrati.length;
    await tocca(tel, '.paz[data-ep="999001"]'); await aspettaTel(tel, /TC ENCEFALO/, 20000);
    await finche(() => inoltrati.length >= n + 2, 15000); await sospendi(500);
  };
  // la copia sta sotto un altro episodio: non è di questo paziente, non si offre
  await seme("999002");
  await riapri();
  check(await tel.locator('.refw:has-text("TC ENCEFALO") .pdf').count() === 0, "una copia salvata sotto un altro episodio non si offre: niente «PDF»");
  await seme("999001");
  await riapri();
  check(await tel.locator('.refw:has-text("TC ENCEFALO") .pdf').count() === 1, "una TC salvata per questo episodio, anche senza testo letto (le TC non si leggono): un tasto «PDF» sul referto");
  const stato = () => tel.evaluate(async () => ({
    ls: JSON.stringify(Object.entries(localStorage).sort()), ss: JSON.stringify(Object.entries(sessionStorage).sort()),
    idb: JSON.stringify(((await indexedDB.databases?.()) || []).map((d) => d.name).sort()),
    cache: JSON.stringify(await Promise.all((await caches.keys()).sort().map(async (k) => [k, (await (await caches.open(k)).keys()).map((r) => r.url).sort()]))),
  }));
  const prima = await stato(), n0 = inoltrati.length;
  // (la pagina non può rileggere un blob: — la sua CSP lo vieta —: si guarda com'è fatto, e quando viene revocato)
  await tel.evaluate(() => {
    window.__blob = []; window.__rev = [];
    const o = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => { const u = o(b), x = { url: u, type: b.type, size: b.size, testa: "" }; window.__blob.push(x); b.slice(0, 5).text().then((t) => { x.testa = t; }); return u; };
    URL.revokeObjectURL = (u) => { window.__rev.push(u); r(u); };
  });
  const [popup] = await Promise.all([tel.waitForEvent("popup", { timeout: 15000 }), tocca(tel, '.refw:has-text("TC ENCEFALO") .pdf')]);
  const aperto = await finche(() => /^blob:/.test(popup.url()), 20000);
  const blob = await tel.evaluate(() => window.__blob);
  check(aperto && blob.length === 1 && popup.url() === blob[0].url, `il telefono lo mostra nel suo visore, da un blob: in memoria (${popup.url().slice(0, 40)})`);
  check(blob[0] && blob[0].type === "application/pdf" && blob[0].size === pdf.length, `ricomposto dai pezzi, della misura giusta (${blob[0] && blob[0].size} su ${pdf.length} byte)`);
  check(await finche(async () => (await tel.evaluate(() => window.__blob[0].testa)) === "%PDF-", 3000), "e comincia come un PDF");
  const visti = inoltrati.slice(n0), tuttiPdf = Buffer.concat(visti);
  const nomi = ["%PDF", "JVBERi", "endstream", SEGNO, esa(SEGNO), esa(SEGNO).toUpperCase(), "ROSSI", "MARIO", "ENCEFALO", "RADIOLOGIA", pdf.subarray(2000, 2040).toString("latin1"), pdf.subarray(2000, 2040).toString("base64").slice(4, 40)];
  const trovati = nomi.filter((x) => tuttiPdf.includes(Buffer.from(x, "latin1")) || tuttiPdf.includes(Buffer.from(x, "utf16le")));
  check(visti.length >= 6 && !trovati.length, `sul ripetitore (${visti.length} messaggi, ${tuttiPdf.length} byte) niente «%PDF», niente del suo testo, niente del nome (trovati: ${trovati.length})`);
  const dopo = await stato();
  check(dopo.ls === prima.ls && dopo.ss === prima.ss && dopo.idb === prima.idb && dopo.cache === prima.cache,
    "sul telefono non resta niente: localStorage, sessionStorage, IndexedDB e Cache Storage come prima");
  check(!/pdf|blob/i.test(dopo.cache.replace(/ponte-guscio/g, "")), "e il suo service worker non l'ha messo in cassa");
  await popup.close();
  const revocato = await finche(async () => (await tel.evaluate(() => window.__rev)).includes(blob[0].url), 8000);
  check(revocato, "chiusa la finestra, il blob si revoca");
  await sw.evaluate((k) => chrome.storage.local.remove(k), "ref:" + idRef);
}
const nasceValori = nuovaPagina(20000);
await tocca(tel, '[data-a="valori"]');
const schedaValori = await nasceValori;
check(!!schedaValori, "«Aggiorna i valori»: sul PC si apre una scheda di sottofondo");
const es1 = await aspettaTel(tel, /Letti sul PC alle/, 90000);
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
sezione("la cartella dal telefono: leggere, scrivere col «Conferma» della pagina");
{
  CART.on = true;
  Object.assign(CART.campi, { ANAMNESI: "Dolore toracico KAPPAZETA da due ore", ALLERGIE: "Nessuna BETALLERG nota", MALATTIE_PREGRESSE: "Ipertensione SIGMAREMOTA",
    FARMACI_ASSUNTI: "Ramipril OMEGAFARM 5 mg", ESAME_OBIETTIVO: "Vigile TAUOBIETT, eupnoico" });
  const valoreTel = (n) => tel.locator(`#cc-${n}`).inputValue();
  const roTel = (n) => tel.locator(`#cc-${n}`).evaluate((t) => t.readOnly);
  const schedeNuove = [];
  const contaSchede = (p) => schedeNuove.push(p);
  ctx.on("page", contaSchede);
  // «Salva» (passato il messaggio di prima), e «Salvato»
  const salvaTel = async () => { await tel.waitForSelector(".avviso", { state: "detached", timeout: 8000 }).catch(() => {}); await tocca(tel, '[data-a="csalva"]'); };
  const salvato = () => finche(async () => (await tel.locator(".avviso").innerText().catch(() => "")) === "Salvato", 60000);
  const errori = () => sw.evaluate(() => chrome.storage.local.get("errori.v1").then((o) => (o["errori.v1"] || []).filter((x) => x.dati && x.dati.comando === "cartellaSalva")));
  // il medico apre ROSSI sul PC: la sua cartella, letta lì, è quella che il telefono vede
  await doc.bringToFront();
  await suPagina(doc, A.patientUrl);
  await tocca(tel, '[data-a="scheda"][data-s="cartella"]');
  const c0 = await aspettaTel(tel, /Letto sul PC alle/, 20000);
  check(await tel.locator(".seg button").evaluateAll((l) => l.map((b) => b.textContent).join("|")) === "Esiti|Richieste|Cartella", "una terza scheda, «Cartella», accanto a Esiti e Richieste");
  check(["Anamnesi", "Anamnesi remota", "Farmaci", "Allergie", "Esame obiettivo"].every((x) => c0.includes(x)) && (c0.match(/Letto sul PC alle \d\d:\d\d · adesso/g) || []).length === 1,
    `i cinque campi, e «Letto sul PC alle … · adesso» una volta (${c0.replace(/\s+/g, " ").slice(0, 160)})`);
  check(await valoreTel("ANAMNESI") === CART.campi.ANAMNESI && await valoreTel("FARMACI_ASSUNTI") === CART.campi.FARMACI_ASSUNTI && await valoreTel("ESAME_OBIETTIVO") === CART.campi.ESAME_OBIETTIVO,
    "con i testi della pagina del paziente sul PC");
  check(await roTel("ESAME_OBIETTIVO") && !(await roTel("ANAMNESI")) && !(await roTel("ALLERGIE")) && await tel.locator(".cc.ro").count() === 1,
    "l'esame obiettivo che la pagina dà di sola lettura (JPSOReadonly) si legge e basta, gli altri si scrivono");
  check(await tel.locator(".cta").count() === 0, "senza modifiche, niente «Salva»");
  check(!(await piccoli(tel)).length, `ogni bottone almeno 44 px (${JSON.stringify(await piccoli(tel))})`);

  // un collega cambia l'anamnesi sul suo PC; il telefono ha ancora quella di prima: «Cambiato sul PC», niente inviato
  await tel.locator("#cc-ANAMNESI").fill("Dolore toracico KAPPAZETA da due ore, irradiato NUOVAZETA");
  check(await tel.locator('.cta [data-a="csalva"]').innerText() === "Salva" && await tel.locator(".cta").evaluate((e) => getComputedStyle(e).position) === "fixed",
    "scritto un campo: un «Salva» solo, fermo in fondo");
  CART.campi.ANAMNESI = "Anamnesi scritta da un collega";
  await salvaTel();
  const c1 = await aspettaTel(tel, /Cambiato sul PC: ricarica/, 40000);
  check(!!c1 && CART.post.length === 0, `la pagina non ha più il testo da cui il telefono è partito: «Cambiato sul PC: ricarica», e niente inviato (inviati: ${CART.post.length})`);
  check(await finche(async () => schedeNuove.length === 1 && schedeNuove[0].isClosed(), 10000), "la scheda di sottofondo si è aperta e richiusa");
  await tocca(tel, '[data-a="cricarica"]');
  check(await finche(async () => await valoreTel("ANAMNESI") === "Anamnesi scritta da un collega", 20000) && await tel.locator(".cta").count() === 0,
    "«Ricarica»: il testo del PC al posto della bozza, e niente da salvare");

  // due campi insieme: la scheda di sottofondo li scrive, clicca «Conferma», rilegge
  CART.lento = 1500;
  await tel.locator("#cc-ANAMNESI").fill("Dolore toracico NUOVAZETA dalle 6\ncon sudorazione");
  await tel.locator("#cc-FARMACI_ASSUNTI").fill("Ramipril OMEGAFARM 5 mg, ASA 100");
  await tel.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  await shot(tel, "tel-cartella");
  await salvaTel();
  check(/Salvo sul PC…/.test(await aspettaTel(tel, /Salvo sul PC…/, 8000)), "mentre salva: «Salvo sul PC…»");
  check(await salvato(), `poi «Salvato» (${await tel.locator(".cta").innerText().catch(() => "")} · ${(await registroPonte()).split("\n").slice(-2).join(" / ")})`);
  CART.lento = 0;
  const f = CART.post[0] || {};
  check(CART.post.length === 1 && f.Update === "Conferma" && f.ANAMNESI.replace(/\r\n/g, "\n") === "Dolore toracico NUOVAZETA dalle 6\ncon sudorazione" && f.FARMACI_ASSUNTI === "Ramipril OMEGAFARM 5 mg, ASA 100"
    && f.MALATTIE_PREGRESSE === "Ipertensione SIGMAREMOTA" && f.ESAME_OBIETTIVO === "Vigile TAUOBIETT, eupnoico" && f.ESAMEOBIETTIVOAUTOSAVE === "N" && !("AnnullaOBI" in f),
    `un invio solo, il modulo della pagina col suo «Conferma» (Update=Conferma), gli altri campi com'erano (${Object.keys(f).join(",")})`);
  check(await valoreTel("ANAMNESI") === "Dolore toracico NUOVAZETA dalle 6\ncon sudorazione" && await tel.locator(".cta").count() === 0, "sul telefono, il testo riletto dal PC; niente più da salvare");
  check(await finche(async () => schedeNuove.length === 2 && schedeNuove[1].isClosed(), 10000), "e la scheda di sottofondo si chiude da sola");
  const pill = await finche(async () => /Aggiornato dal telefono/.test((await $panel(doc, ".pontespia").allInnerTexts().catch(() => [])).join(" ")), 10000);
  check(pill && await $panel(doc, "#ponterica").count() === 1, "sul PC, la pagina di ROSSI aperta e ferma: «Aggiornato dal telefono · Ricarica», senza ricaricarsi da sola");
  check(await doc.locator('textarea[name="ANAMNESI"]').inputValue() === "Dolore toracico KAPPAZETA da due ore", "(la pagina mostra ancora il testo di prima)");
  await shot(doc, "pc-6-cartella-aggiornata");
  if (await $panel(doc, "#ponterica").count()) await $panel(doc, "#ponterica").click(); else await doc.reload();
  await doc.waitForLoadState("load");
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  check(await finche(async () => (await doc.locator('textarea[name="ANAMNESI"]').inputValue().catch(() => "")).includes("NUOVAZETA"), 10000) && await $panel(doc, "#ponterica").count() === 0,
    "«Ricarica»: la pagina col testo nuovo, e la pill se ne va");
  const regP = await registroPonte();
  check(/Cartella di ROSSI MARIO dal telefono: salvati Anamnesi, Farmaci/.test(regP) && !/NUOVAZETA|OMEGAFARM|KAPPAZETA/.test(regP), "nel registro del ponte: i campi salvati, mai i testi");

  // il medico sta scrivendo nella pagina di ROSSI sul PC: dal telefono no
  await doc.locator('textarea[name="FARMACI_ASSUNTI"]').fill("il medico scrive qui");
  await tel.locator("#cc-ALLERGIE").fill("Penicillina BETALLERG");
  await salvaTel();
  check(!!(await aspettaTel(tel, /Sul PC c'è un testo non salvato in questa pagina/, 30000)) && CART.post.length === 1 && schedeNuove.length === 2,
    "un testo non salvato nella pagina di ROSSI sul PC (anche in un altro campo: il suo «Conferma» rimanderebbe tutto il modulo): «Sul PC c'è un testo non salvato in questa pagina», niente scheda, niente inviato");
  await suPagina(doc, A.patientUrl);   // (il medico lascia stare: la pagina come il gestionale l'ha salvata)
  await salvaTel();
  check(await salvato() && CART.campi.ALLERGIE === "Penicillina BETALLERG" && CART.post.length === 2, "pagina pulita: lo stesso «Salva» adesso passa");

  // l'esame obiettivo scrivibile, quando la pagina lo dà scrivibile — e se intanto non lo è più, no
  CART.eoRo = false;
  await suPagina(doc, A.patientUrl);
  await tocca(tel, '[data-a="crileggi"]');
  check(await finche(async () => !(await roTel("ESAME_OBIETTIVO").catch(() => true)), 20000), "l'esame obiettivo che la pagina dà scrivibile si scrive anche dal telefono");
  await tel.locator("#cc-ESAME_OBIETTIVO").fill("Vigile TAUOBIETT, dispnoico");
  CART.eoRo = true;   // (un altro medico l'ha scritto intanto: adesso è di sola lettura)
  await salvaTel();
  check(!!(await aspettaTel(tel, /Sul PC non è più modificabile: Esame obiettivo/, 40000)) && CART.post.length === 2,
    "diventato di sola lettura sul PC: «Sul PC non è più modificabile», niente inviato");
  await tocca(tel, '[data-a="cricarica"]');
  check(await finche(async () => await roTel("ESAME_OBIETTIVO") && await valoreTel("ESAME_OBIETTIVO") === "Vigile TAUOBIETT, eupnoico", 20000), "«Ricarica»: di nuovo di sola lettura, col testo del PC");
  CART.eoRo = false;
  await tocca(tel, '[data-a="crileggi"]');
  await finche(async () => !(await roTel("ESAME_OBIETTIVO").catch(() => true)), 20000);
  await tel.locator("#cc-ESAME_OBIETTIVO").fill("Vigile TAUOBIETT, dispnoico");
  await salvaTel();
  check(await salvato() && CART.campi.ESAME_OBIETTIVO === "Vigile TAUOBIETT, dispnoico", "scrivibile fino alla fine: salvato con lo stesso «Conferma»");

  // il gestionale non salva un campo: la verifica lo dice, campo per campo
  CART.ignora = "FARMACI_ASSUNTI";
  await tel.locator("#cc-FARMACI_ASSUNTI").fill("Ramipril OMEGAFARM 10 mg");
  await tel.locator("#cc-MALATTIE_PREGRESSE").fill("Ipertensione SIGMAREMOTA, diabete");
  await salvaTel();
  check(/Salvato: Anamnesi remota · Non salvato sul PC: Farmaci/.test(await aspettaTel(tel, /Non salvato sul PC/, 60000)),
    "riletta la pagina dopo «Conferma»: «Salvato: Anamnesi remota · Non salvato sul PC: Farmaci»");
  CART.ignora = "";
  const err = await errori();
  check(err.length >= 4 && err.every((x) => Array.isArray(x.dati.campi) && x.dati.campi.every((n) => CART_NOMI.includes(n))) && !/KAPPAZETA|NUOVAZETA|OMEGAFARM|BETALLERG|SIGMAREMOTA|TAUOBIETT|medico scrive/.test(JSON.stringify(err)),
    `ogni no nel registro degli errori: il perché e i nomi dei campi, mai un testo (${err.map((x) => x.dati.perche).join(" · ")})`);
  const memTel = await tel.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  check(!/KAPPAZETA|NUOVAZETA|OMEGAFARM|BETALLERG|SIGMAREMOTA|TAUOBIETT/.test(memTel), "sul telefono niente della cartella fuori dalla memoria della pagina");
  // via la cartella: le sezioni dopo hanno la pagina di sempre
  ctx.off("page", contaSchede);
  CART.on = false;
  await tocca(tel, '[data-a="scheda"][data-s="esiti"]');
  await suPagina(doc, A.worklistUrl);
}

// ===========================================================================
sezione("un ordine dal telefono, fino alle etichette");
lento = 900;
await doc.evaluate(() => localStorage.setItem("__psaStampe", "[]"));
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await aspettaTel(tel, /Dol th/, 10000);
// compatte: il catalogo intero in al più due schermi, ogni tasto alto almeno 44 px
await shot(tel, "tel-richieste");
if (SHOTS) await tel.screenshot({ path: join(SHOTS, "tel-richieste-tutte.png"), fullPage: true }).catch(() => {});
const compatte = await tel.evaluate(() => {
  const c = [...document.querySelectorAll("main .carta")], tasti = [...document.querySelectorAll("main .esame, main .chip")];
  return { alt: c[c.length - 1].getBoundingClientRect().bottom - c[0].getBoundingClientRect().top, vh: innerHeight, n: document.querySelectorAll("main .esame").length,
           minAlt: Math.min(...tasti.map((b) => b.getBoundingClientRect().height)) };
});
check(compatte.alt <= 2 * compatte.vh, `le Richieste (${compatte.n} esami) stanno in due schermi: ${Math.round(compatte.alt)} px su ${compatte.vh} di altezza`);
check(compatte.minAlt >= 43.9, `ogni tasto è alto almeno 44 px (il più basso: ${compatte.minAlt})`);
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
await tocca(tel, '[data-a="esame"]:has-text("EMOCROMO POC")');
check(await tel.locator("#ordina").isDisabled(), "senza quesito il bottone non parte");
await tel.locator("#ordina").click({ force: true });
check(await tel.evaluate(() => document.activeElement && document.activeElement.id) === "quesito", "e toccarlo porta il cursore sul quesito");
await tel.locator("#quesito").fill("dolore toracico atipico");
await tel.locator("#quesito").press("Enter");
check(/Conferma e stampa · 2 esami/.test(await tel.locator("#ordina").innerText()), "«Conferma e stampa · 2 esami»");
check(await tel.locator("#ordina").evaluate((b) => getComputedStyle(b).touchAction) === "manipulation", "niente doppio tocco per ingrandire sul bottone (touch-action: manipulation)");
await tocca(tel, "#ordina");
await tocca(tel, "#ordina");   // il secondo tocco di un doppio tocco, subito dopo
await sospendi(400);
const armato = await tel.locator("#ordina").innerText();
check(/Ordino 2 esami per ROSSI MARIO · 77 anni · OBI 2\? Tocca di nuovo/.test(armato), `il primo tocco chiede conferma, col nome intero, l'età e il posto (${armato})`);
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
// (un ordine dal telefono non apre da solo il dialogo sul PC: davanti può non esserci nessuno)
const fatto = await aspettaTel(tel, /aspettano qualcuno al PC/, 60000);
check(/Etichette NON stampate/.test(fatto) && /aspettano qualcuno al PC/.test(fatto) && !/tocca Stampa|sulla striscia/.test(fatto),
  "e alla fine «Etichette NON stampate · aspettano qualcuno al PC» (la frase del telefono, non quella del PC)");
const rid = Object.keys(A.state.richieste)[0];
check(A.state.richieste[rid]?.confirmed === true && Object.values(A.state.insertCount).every((n) => n === 1) && Object.keys(A.state.insertCount).length === 2,
  `confermata, ogni esame mandato una volta (${JSON.stringify(A.state.insertCount)})`);
check(A.state.richieste[rid]?.quesito === "dolore toracico atipico", "col quesito scritto sul telefono");
await doc.waitForTimeout(2500);
check((await doc.evaluate(() => JSON.parse(localStorage.getItem("__psaStampe") || "[]"))).length === 0, "sul PC il dialogo di stampa non si apre da solo");
await doc.locator("#psassist-host #strazione").click();   // «Stampa», sulla striscia del PC
check(await finche(async () => (await doc.evaluate(() => JSON.parse(localStorage.getItem("__psaStampe") || "[]"))).length === 1, 10000),
  "un tocco su «Stampa» nella striscia del PC: le etichette si stampano lì, come sempre");
check(/Etichette prese in stampa sul PC/.test(await aspettaTel(tel, /Etichette prese in stampa sul PC/, 15000)),
  "e il telefono lo sa: «Etichette prese in stampa sul PC», non «Ordine non completo»");
const carta = await tel.locator(".ord").first().innerText();
check(!/Quesito: il tuo/.test(carta) && (carta.match(/2 esami/g) || []).length <= 1, `la carta dell'ordine: niente «Quesito: il tuo», niente «2 esami» ripetuto (${carta.replace(/\s+/g, " ")})`);
check(await tel.locator(".ord").first().locator(".c b").innerText() === "Etichette prese in stampa sul PC" && (carta.match(/\d\d:\d\d/g) || []).length === 1,
  `il titolo della carta è com'è andata, e l'ora c'è una volta (${carta.replace(/\s+/g, " ")})`);
await shot(tel, "tel-5-ordine-confermato");
await tel.emulateMedia({ colorScheme: "dark" }); await shot(tel, "tel-5-ordine-confermato-buio"); await tel.emulateMedia({ colorScheme: "light" });
// finito bene, dopo due minuti se ne va da solo: le carte verdi non si ammucchiano
await tel.evaluate(() => { window.__oraVera = Date.now; const v = Date.now; Date.now = () => v() + 3 * 60e3; });
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
const dopoDue = await testoTel(tel);
await tel.evaluate(() => { Date.now = window.__oraVera; });
check(!/Etichette prese in stampa sul PC/.test(dopoDue), "un ordine finito bene, dopo due minuti, se ne va da solo: le carte verdi non si ammucchiano");
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
await aspettaTel(tel, /Dol th/, 15000);
check(await tel.locator('[data-a="scheda"][data-s="richieste"].on').count() === 1, "l'ultima scheda scelta (Richieste) resta quella, anche per un altro paziente");
check(await tel.locator(".top .tit").innerText() === `BIANCHI ANNA · ${ETA_B} anni`, `l'età che la testata non dice viene dal codice fiscale: «BIANCHI ANNA · ${ETA_B} anni»`);
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
check(await finche(async () => Object.keys(B.state.richieste).length === 2 && (await tel.locator(".ord").count()) >= 2, 30000),
  "l'ordine partito davvero compare sul telefono appena la rete torna");
await finche(ordiniFiniti, 60000);
check(Object.keys(B.state.richieste).length === 2, `e nessun ordine doppio (${Object.keys(B.state.richieste).length}; ${(await registroPonte()).split("\n").slice(-3).join(" / ")})`);
await shot(tel, "tel-6-ordine-incerto");
// La risposta si perde, ma la presa cade e si rifà subito: l'ordine è già lì
// sopra. Niente allarme rosso che dice il contrario, e il bottone non aspetta.
await tel.waitForSelector(".avviso", { state: "detached", timeout: 10000 }).catch(() => {});
await tel.evaluate(() => {
  window.__avvisi = [];
  new MutationObserver(() => { const a = document.querySelector(".avviso"); if (a && !window.__avvisi.includes(a.textContent)) window.__avvisi.push(a.textContent); })
    .observe(document.getElementById("app"), { childList: true, subtree: true });
});
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
await tel.locator("#quesito").fill("controllo serale");
const richiesteB = Object.keys(B.state.richieste).length, carte0 = await tel.locator(".ord").count();
rete.perdi = rete.ultima;
await tocca(tel, "#ordina"); await sospendi(900); await tocca(tel, "#ordina");
const tPerso = Date.now();
check(await finche(async () => Object.keys(B.state.richieste).length > richiesteB, 30000), "(la risposta si perde; l'ordine nasce sul PC)");
await sospendi(1500);
check(/Mando l'ordine al PC/.test(await tel.locator("#ordina").innerText()), "(il bottone aspetta la risposta)");
rete.prese.get(rete.perdi).ws.close({ code: 1001, reason: "rete" });   // la presa cade: il telefono si ricollega
const visto = await finche(async () => !/Mando l'ordine al PC/.test(await tel.locator("#ordina").innerText().catch(() => "")) && (await tel.locator(".ord").count()) > carte0, 15000);
check(visto, `ricollegato, il telefono vede l'ordine nato sul PC, e il bottone non aspetta più la risposta persa (${await tel.locator("#ordina").innerText().catch(() => "")})`);
await finche(ordiniFiniti, 60000);

// ===========================================================================
sezione("un ordine finito male resta sulla lista, con le parole di bg.js");
// un ordine del telefono come lo racconta bg.js (`pubblico`), qui scritto a mano
const male = { id: "telmaleprova1l", ep: "999002", paziente: "BIANCHI ANNA", n: 1, stato: "errore", ts: Date.now(), agg: Date.now(), worker: null, vista: null,
  resto: { mancano: ["TROPONINA US"], controllare: [], nel: [] }, pubblico: { tono: "err", titolo: "Ordine fermo", testo: "Mancano: TROPONINA US", dettaglio: "Quesito: il tuo" } };
await sw.evaluate((m) => chrome.storage.session.get("ordini").then((o) => chrome.storage.session.set({ ordini: [...(o.ordini || []), m] })), male);
await tocca(tel, '[data-a="indietro"]');
const barra = await aspettaTel(tel, /Ordine non completo/, 10000);
check(/Ordine non completo · BIANCHI ANNA/.test(barra) && /Ordine fermo · Mancano: TROPONINA US/.test(barra) && !/Tocca per vedere/.test(barra),
  "in fondo alla lista: «Ordine non completo · BIANCHI ANNA», con le parole di bg.js (e nient'altro)");
await shot(tel, "tel-6b-ordine-non-completo");
// sulla pagina di un altro paziente lo si vede lo stesso, in testa (in fondo c'è il bottone dell'ordine)
await tocca(tel, '.paz[data-ep="999001"]');
const suRossi = await aspettaTel(tel, /Ordine non completo/, 10000);
check(/Ordine non completo · BIANCHI ANNA/.test(suRossi) && await tel.locator("main > .ordbar:first-child").count() === 1,
  "l'ordine finito male si vede anche dalla pagina di un altro paziente, in testa");
await tocca(tel, '.ordbar[data-a="paz"]');
await aspettaTel(tel, /Esiti/, 10000);
check(await tel.locator(".top .tit").innerText() === `BIANCHI ANNA · ${ETA_B} anni` && await tel.locator(".ordbar").count() === 0 && /Ordine fermo/.test(await testoTel(tel)),
  "toccato: si è sul suo paziente, dove l'ordine ha la sua carta (e niente barra)");
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /Ordine non completo/, 10000);
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
check(/Episodio precedente: per ordinare apri quello di oggi/.test(await aspettaTel(tel, /per ordinare apri quello di oggi/, 15000)) && await tel.locator("#ordina").count() === 0,
  "un episodio precedente si legge, ma non si ordina");
check(await tel.locator(".top .tit").innerText() === `BIANCHI ANNA · ${ETA_B} anni\nEpisodio precedente`,
  `in testa lo dice, e l'età (mai vista la sua pagina: dal codice fiscale che il PC conosce) (${(await tel.locator(".top .tit").innerText()).replace(/\n/g, " / ")})`);
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
check(!(await notePc()).some((t) => /dimissione/.test(t)), "e la nota non arriva");
await tocca(tel, '[data-a="indietro"]');
check(!/VERDI/.test(await aspettaTel(tel, /ROSSI M\./, 10000)), "e dall'elenco del telefono se ne va");

// ===========================================================================
sezione("due pazienti con lo stesso nome");
const omonimo = (si) => doc.evaluate((si) => {
  const K = "psassist:patients.v1";
  const l = JSON.parse(localStorage.getItem(K) || "[]").filter((p) => p.ep !== "999004");
  if (si) l.push({ ep: "999004", name: "ROSSI MARIO", url: "", ts: Date.now() - 30 * 60e3, pk: "", triage: "VERDE" });
  localStorage.setItem(K, JSON.stringify(l));
}, si);
await omonimo(true);
await tocca(tel, '[data-a="menu"]');
await tocca(tel, '[data-a="aggiornaLista"]');
const due = await aspettaTel(tel, /…9004/, 10000);
check(/ROSSI MARIO · …9001/.test(due) && /ROSSI MARIO · …9004/.test(due), "(nell'elenco: «⚠ ROSSI MARIO · …9001» e «⚠ ROSSI MARIO · …9004»)");
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Richieste/, 10000);
const testaOm = await tel.locator(".top .tit").innerText();
check(testaOm === "⚠ ROSSI MARIO · …9001 · 77 anni · OBI 2", `in testa il segno che li distingue, come nell'elenco: «⚠ ROSSI MARIO · …9001 · 77 anni · OBI 2» (${testaOm})`);
await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
await aspettaTel(tel, /Dol th/, 10000);
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
await tel.locator("#quesito").fill("omonimo");
await tocca(tel, "#ordina");
const armOm = await tel.locator("#ordina").innerText();
check(/^⚠ Ordino 1 esame per ROSSI MARIO · …9001 · 77 anni · OBI 2\? Tocca di nuovo$/.test(armOm), `e la conferma comincia col ⚠, col segno anche lì (${armOm})`);
await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');   // non si conferma: via la scelta
await omonimo(false);
await tocca(tel, '[data-a="indietro"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 10000)), "(l'omonimo non c'è più)");

// ===========================================================================
sezione("i messaggi ripetuti o manomessi non passano");
const daTel = () => inoltrati.filter((b) => b[1] === 3);
// una nota, catturata per strada, poi un'altra: rimandare la prima non la rimette
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Aggiorna i valori/, 15000);
const noteSulPc = () => notePc();
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
const senzaOra = (await daFarePc()).filter((x) => x.t == null).map((x) => x.testo);
check(senzaOra.join("|") === "nota B", `la nota riscritta dal telefono cambia la stessa voce di «Da fare», non ne aggiunge un'altra (got: ${senzaOra.join(" | ")})`);
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
// (passato il tempo in cui la risposta persa sarebbe scaduta: nessun allarme)
await sospendi(Math.max(0, tPerso + 63e3 - Date.now()));
const avvisi = await tel.evaluate(() => window.__avvisi || []);
check(!avvisi.some((x) => /Non so se l'ordine/.test(x)), `e la risposta persa di un ordine già visto non accende mai «Non so se l'ordine è partito» (${JSON.stringify(avvisi)})`);

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
// …e sulla pagina di un paziente, i suoi esiti (un referto arrivato intanto), senza contare come un comando del medico
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Aggiorna i valori/, 15000);
await sospendi(800);
const esitiLetti = async () => ((await registroPc(doc)).match(/iPhone · esiti di ROSSI MARIO/g) || []).length;
const esiti0 = await esitiLetti(), ultimo0 = await sw.evaluate(() => pt.sessione && pt.sessione.ultimo);
await tel.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
check(await finche(async () => (await esitiLetti()) > esiti0, 10000), "tornati sull'app sulla pagina di un paziente, i suoi esiti si rileggono da soli");
check(await sw.evaluate(() => pt.sessione && pt.sessione.ultimo) === ultimo0, "e non tengono aperta la sessione: li chiede l'app, non il medico");
await tocca(tel, '[data-a="indietro"]');
await aspettaTel(tel, /ROSSI M\./, 10000);

// ===========================================================================
sezione("3 minuti senza comandi");
const avanti = (ms) => sw.evaluate((x) => { self.__oraVera = self.__oraVera || Date.now; const v = self.__oraVera; Date.now = () => v() + x; return ponteControlla(); }, ms);
const orologio = () => sw.evaluate(() => { if (self.__oraVera) Date.now = self.__oraVera; });
await avanti(2 * 60e3);
check(!!(await statoPonte())?.sessione, "a 2 minuti la sessione c'è ancora");
await avanti(4 * 60e3);
check(!(await statoPonte())?.sessione, "a 4 minuti senza comandi la sessione è chiusa");
await orologio();
const inatt = await aspettaTel(tel, /Sessione chiusa/, 10000);
check(/3 minuti senza comandi/.test(inatt) && !/ROSSI/.test(inatt), "il telefono davanti lo dice, «3 minuti senza comandi», e i pazienti non ci sono più");
await shot(tel, "tel-7-sessione-chiusa");
check(await finche(async () => (await $panel(doc, ".pontespia").count()) === 0, 8000), "e sul PC la spia si spegne");
// (che cosa si vede, da qui in poi: «Sessione chiusa» non deve passare nemmeno per un attimo)
const guardaChiusa = () => tel.evaluate(() => {
  window.__chiusa = false;
  window.__guarda?.disconnect();
  window.__guarda = new MutationObserver(() => { if (/Sessione chiusa/.test(document.getElementById("app").textContent)) window.__chiusa = true; });
  window.__guarda.observe(document.getElementById("app"), { childList: true, subtree: true, characterData: true });
});
const sessioniNuove = async () => ((await registroPonte()).match(/iPhone ricollegato: sessione nuova|iPhone collegato/g) || []).length;
const s0 = await sessioniNuove();
await tel.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));   // tornati sull'app
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)) && (await sessioniNuove()) > s0, "tornati sull'app dopo la chiusura: si riapre da sola, senza QR e senza un tocco");
// l'app lasciata in sottofondo: le riletture da sola non contano come comandi
await guardaChiusa();
await tel.evaluate(() => { const v = Date.now; window.__oraVera = v; Date.now = () => v() + 2 * 60e3; document.dispatchEvent(new Event("visibilitychange")); });
await sospendi(1500);
check(!/Sessione chiusa/.test(await testoTel(tel)), "a 2 minuti, tornati sull'app: l'elenco si rilegge da solo…");
const s1 = await sessioniNuove(), sess1 = await sw.evaluate(() => pt.sessione && pt.sessione.dal);
await tel.evaluate(() => { const v = window.__oraVera; Date.now = () => v() + 4 * 60e3; document.dispatchEvent(new Event("visibilitychange")); });
const riaperta = await finche(async () => (await sessioniNuove()) > s1 && /ROSSI M\./.test(await testoTel(tel)), 15000);
await tel.evaluate(() => { Date.now = window.__oraVera; });
check(riaperta && await sw.evaluate(() => pt.sessione && pt.sessione.dal) !== sess1 && /3 minuti senza comandi/.test(await registroPonte()),
  "…ma non conta: a 4 minuti dall'ultimo comando del medico la sessione di prima è chiusa (via i pazienti), e se ne apre un'altra da sola");
check(!(await tel.evaluate(() => window.__chiusa)), "e «Sessione chiusa» non si è visto nemmeno per un attimo");

// ===========================================================================
sezione("«Scollega» sul PC");
await finche(async () => (await $panel(doc, "#ponteoff").count()) === 1, 8000);
await tocca(tel, '.paz[data-ep="999001"]');
await aspettaTel(tel, /Aggiorna i valori/, 15000);
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
check(await finche(async () => relay.prese().pc === 1, 45000), "le schede del gestionale lo svegliano, e si ricollega da solo al ponte (la chiave è rimasta)");
sw = await swDi(ctx).catch(() => sw);
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
check(!cpScad && !(await statoPonte())?.accoppiato, "e sul PC la chiave non c'è più, nemmeno su disco");
await shot(tel, "tel-10-scaduta");
// una scheda del gestionale torna alla pagina d'accesso: la sessione si chiude, l'associazione resta
await ponte2.reload();
await ponte2.waitForSelector("#stato b");
await ponte2.locator("#associa").click();
await ponte2.waitForSelector("#qr svg", { timeout: 8000 });
const url3 = await qrUrl();
const K3 = P.b64u(P.leggiFrammento(new URL(url3).hash).k);
await tel.goto(url3);
await aspettaTel(tel, /ROSSI M\./, 15000);
login = true;
await doc2.goto(A.patientUrl);
login = false;
const accesso = await aspettaTel(tel, /pagina d'accesso/, 15000);
check(/Sessione chiusa/.test(accesso) && /Il gestionale sul PC è tornato alla pagina d'accesso/.test(accesso) && !/ROSSI/.test(accesso),
  "una scheda del gestionale alla pagina d'accesso: la sessione si chiude, «Il gestionale sul PC è tornato alla pagina d'accesso», via i pazienti");
check((await coppiaPc())?.k === K3 && (await chiaveTel(tel))?.k === K3, "l'associazione resta, sul PC e sul telefono");
await shot(tel, "tel-11-pagina-accesso");
// rientrato nel gestionale (la pagina d'accesso ha svuotato l'elenco del PC: i pazienti si riaprono)
await suPagina(doc2, A.patientUrl);
await suPagina(doc2, B.patientUrl);
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 15000)) && (await coppiaPc())?.k === K3, "rientrati nel gestionale, «Riapri»: di nuovo l'elenco, con la stessa associazione e senza QR nuovo");

// ===========================================================================
sezione("il browser del PC si chiude e si riapre");
await ctx.close();
ctx = await apriBrowser();
sw = await swDi(ctx);
check((await coppiaPc())?.k === K3, "riaperto il browser, l'associazione c'è ancora: sta su disco (storage.local) fino alla scadenza");
check(/estensione sul PC si è riavviata/.test(await aspettaTel(tel, /Sessione chiusa/, 30000)), "il telefono sa che la sessione di prima è finita: «L'estensione sul PC si è riavviata»");
const doc3 = await ctx.newPage();
await suPagina(doc3, A.worklistUrl);
await tocca(tel, '[data-a="riapri"]');
check(/ROSSI M\./.test(await aspettaTel(tel, /ROSSI M\./, 20000)), "«Riapri»: di nuovo l'elenco, senza QR nuovo");

// ===========================================================================
sezione("«Stampa un PDF» dal telefono, sull'A4 del PC");
{
  // il finto aiutante di stampa (lo stesso di ext-stampa.mjs): annota i fogli invece di stamparli
  const FINTO = join("/tmp", "psa-ponte-finto-" + process.pid);
  mkdirSync(FINTO, { recursive: true });
  const comportati = (extra = {}) => writeFileSync(join(FINTO, "config.json"), JSON.stringify({ stampanti: ["Zebra ZD421", "HP LaserJet A4"], predefinita: "HP LaserJet A4", ...extra }));
  const lavori = () => (existsSync(join(FINTO, "lavori.jsonl")) ? readFileSync(join(FINTO, "lavori.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const lanciatore = join(FINTO, "ospite.sh");
  writeFileSync(lanciatore, `#!/bin/sh\nPSA_FINTO='${FINTO}' exec '${process.execPath}' '${join(root, "test/ospite-finto.mjs")}' "$@"\n`);
  chmodSync(lanciatore, 0o755);
  comportati();
  mkdirSync(join(PROFILE, "NativeMessagingHosts"), { recursive: true });
  writeFileSync(join(PROFILE, "NativeMessagingHosts", "it.psassist.stampa.json"),
    JSON.stringify({ name: "it.psassist.stampa", description: "finto", path: lanciatore, type: "stdio", allowed_origins: [`chrome-extension://${extId}/`] }));
  const SEGNO = "QJXV5518 FOGLIO DAL TELEFONO";
  // tre pezzi: il PDF vero, e dietro un riempitivo (i pezzi sono da ~390 KB)
  const pdf = Buffer.concat([refertoRxPdf(["Foglio di prova", SEGNO]), Buffer.alloc(900000, 0x42)]);
  // (le parole della carta della stampa, tutte quelle che passano)
  await tel.evaluate(() => {
    window.__stampa = [];
    new MutationObserver(() => { const b = document.querySelector(".stampa b"); if (b && window.__stampa.at(-1) !== b.textContent) window.__stampa.push(b.textContent); })
      .observe(document.getElementById("app"), { childList: true, subtree: true });
  });
  const scegli = async (file) => {
    await tocca(tel, '[data-a="menu"]');
    const [fc] = await Promise.all([tel.waitForEvent("filechooser", { timeout: 8000 }), tocca(tel, '[data-a="stampaPdf"]')]);
    await fc.setFiles(file);
  };
  const carta = async (re, ms = 30000) => (await finche(async () => re.test(await tel.locator(".stampa").innerText().catch(() => "")), ms)) ? tel.locator(".stampa").innerText() : "";
  const comePdf = { name: "foglio.pdf", mimeType: "application/pdf", buffer: pdf };

  // 1. senza la stampa automatica: no, e il PDF non parte nemmeno (il PC lo dice al primo pezzo)
  const a0 = rete.alPc.length;
  await scegli(comePdf);
  const senza = await carta(/stampa automatica/, 15000);
  check(/Sul PC la stampa automatica non è impostata/.test(senza) && await tel.locator(".stampa.err").count() === 1 && rete.alPc.slice(a0).filter((x) => x.length > 1e5).length === 1 && !lavori().length,
    `senza la stampa automatica sul PC: «Sul PC la stampa automatica non è impostata», e il resto del PDF non parte (${rete.alPc.slice(a0).filter((x) => x.length > 1e5).length} pezzi)`);
  await tocca(tel, '[data-a="stampaVia"]');

  // 2. un file che non è un PDF: il telefono non lo manda
  const a1 = rete.alPc.length;
  await scegli({ name: "nota.pdf", mimeType: "application/pdf", buffer: Buffer.from("non sono un PDF") });
  check(/Non è un PDF/.test(await carta(/Non è un PDF/, 8000)) && rete.alPc.length === a1, "un file che non comincia con «%PDF»: «Non è un PDF», e non parte niente");
  await tocca(tel, '[data-a="stampaVia"]');

  // 3. con la stampa automatica: a pezzi, cifrato, fino all'A4
  await sw.evaluate(() => chrome.storage.local.set({ stampa: { attiva: true, etichette: "Zebra ZD421", a4: "HP LaserJet A4" } }));
  const n0 = inoltrati.length, a2 = rete.alPc.length;
  await scegli(comePdf);
  const fatto = await carta(/Stampato su/, 40000);
  check(/Stampato su HP LaserJet A4/.test(fatto) && await tel.locator(".stampa.ok").count() === 1, `il telefono: «Stampato su HP LaserJet A4», in verde (${fatto.replace(/\s+/g, " ")})`);
  const visti = await tel.evaluate(() => window.__stampa);
  check(visti.some((t) => /^Invio… \d+%$/.test(t)), `mentre va, «Invio… 40%» (${visti.join(" → ")})`);
  const l1 = lavori();
  check(l1.length === 1 && l1[0].tipo === "a4" && l1[0].stampante === "HP LaserJet A4" && l1[0].byte === pdf.length, `sul PC: un foglio, sull'A4, intero (${JSON.stringify(l1.map((x) => [x.tipo, x.stampante, x.byte]))})`);
  check(/PDF dall'iPhone stampato su HP LaserJet A4/.test(await registroPonte()), "il registro del ponte: «PDF dall'iPhone stampato su HP LaserJet A4»");
  await shot(tel, "tel-stampa-1-stampato");
  const visto = inoltrati.slice(n0), tutto = Buffer.concat(visto);
  const pezzi = ["%PDF", "JVBERi", "endstream", SEGNO, pdf.subarray(400, 440).toString("latin1"), pdf.subarray(300, 330).toString("base64").slice(4, 36)];
  const trovati = pezzi.filter((x) => tutto.includes(Buffer.from(x, "latin1")) || tutto.includes(Buffer.from(x, "utf16le")));
  check(rete.alPc.length - a2 >= 3 && !trovati.length, `sul ripetitore (${visto.length} messaggi, ${tutto.length} byte) niente «%PDF», niente del suo testo (trovati: ${trovati.length})`);
  const memoria = await sw.evaluate(async () => ({ tel: PDF_TEL.size, s: JSON.stringify(await chrome.storage.session.get(null)), l: JSON.stringify(await chrome.storage.local.get(null)) }));
  const b64 = pdf.subarray(0, 600).toString("base64").slice(0, 200);
  check(memoria.tel === 0 && !memoria.s.includes(b64) && !memoria.l.includes(b64), "stampato, sul PC il PDF non c'è più: né in memoria né in storage");
  const rec = (await sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []))).find((x) => /^pdftel/.test(x.id));
  check(!!rec && rec.paziente === "PDF dall'iPhone" && rec.stato === "avviso" && !rec.stampa, "nel giornale delle stampe: «PDF dall'iPhone», finito, e senza «Ristampa» (il PDF non c'è più)");

  // 4. rimandato: i messaggi ripetuti per strada, o la stessa richiesta col suo numero — una stampa sola
  versoPc(rete.alPc.slice(a2));
  await sospendi(2500);
  const rid = rec ? rec.id.slice(6) : "";
  const rifatta = await sw.evaluate(([rid, b]) => ponteStampa({}, { rid, i: 0, n: 1, size: b.length * 3 / 4, b }), [rid, pdf.subarray(0, 3000).toString("base64")]);
  await sospendi(1500);
  check(lavori().length === 1 && rifatta.ok && /Stampato su HP LaserJet A4/.test(rifatta.dati.titolo),
    `la richiesta ripetuta per strada, o rimandata col suo numero: com'è andata, e nessuna seconda stampa (fogli: ${lavori().length})`);

  // 5. il PC controlla da sé: un file che non è un PDF, o oltre 15 MB, no
  const nonPdf = await sw.evaluate(() => ponteStampa({}, { rid: "nonpdf12345", i: 0, n: 1, size: 12, b: btoa("ciao, niente") }));
  const grosso = await sw.evaluate(() => ponteStampa({}, { rid: "grosso12345", i: 0, n: 40, size: 15e6 + 1, b: btoa("%PDF-1.4 x") }));
  check(!nonPdf.ok && /Non è un PDF/.test(nonPdf.errore) && !grosso.ok && /troppo grande/.test(grosso.errore) && lavori().length === 1,
    `sul PC: un file che non è un PDF, o oltre 15 MB, è rifiutato (${nonPdf.errore} / ${grosso.errore})`);

  // 6. finito nella coda di Windows: «Mandato a …», in ambra
  comportati({ esito: { "HP LaserJet A4": "mandato" } });
  await tocca(tel, '[data-a="stampaVia"]');
  await scegli({ ...comePdf, buffer: refertoRxPdf(["Foglio corto"]) });
  const mandato = await carta(/Mandato a/, 40000);
  check(/Mandato a HP LaserJet A4/.test(mandato) && /coda di Windows/.test(mandato) && await tel.locator(".stampa.warn").count() === 1 && lavori().length === 2,
    `nella coda di Windows: «Mandato a HP LaserJet A4», in ambra (${mandato.replace(/\s+/g, " ")})`);
  await shot(tel, "tel-stampa-2-mandato");
  comportati();
  await tocca(tel, '[data-a="stampaVia"]');
  await sw.evaluate(() => chrome.storage.local.remove(["stampa", "stampaEsito"]));
  rmSync(FINTO, { recursive: true, force: true });
}

// ===========================================================================
sezione("la rete del telefono: ascensore, 5G, presa tagliata, rete lenta");
{
  // Un telefono con la rete vera di Chromium (non la strada finta di prima), la
  // stessa chiave e lo stesso numero: la rete la cambia il protocollo DevTools
  // (Network.emulateNetworkConditions), il ripetitore taglia le prese. Le prese
  // che l'app apre si contano, con l'ora.
  const chiave = await chiaveTel(tel);
  const vCtx = await telBrowser.newContext(IPHONE);
  await vCtx.addInitScript(salto);
  await vCtx.addInitScript(() => {
    const W = window.WebSocket;
    window.__prese = [];
    window.WebSocket = class extends W { constructor(u, p) { super(u, p); window.__prese.push(Date.now()); } };
  });
  const v = await vCtx.newPage();
  await v.goto(relay.url + "/ponte/");
  await v.evaluate((c) => localStorage.setItem("psassist.ponte.v1", c), JSON.stringify(chiave));
  await v.reload();
  await aspettaTel(v, /ROSSI M\./, 20000);
  const cdp = await vCtx.newCDPSession(v);
  await cdp.send("Network.enable");
  const reteV = (o = {}) => cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, ...o });
  const pill = () => v.evaluate(() => document.querySelector(".statopc")?.textContent || "").catch(() => "");
  const grigi = () => v.locator("#app .nopc").count();
  await tocca(v, '.paz[data-ep="999001"]');
  await aspettaTel(v, /RX TORACE/, 20000);

  // 1. l'ascensore: niente rete. Quello che c'è resta; quello che va chiesto al PC, in grigio
  const p0 = await v.evaluate(() => window.__prese.length);
  await reteV({ offline: true });
  await finche(async () => /Senza rete/.test(await pill()), 5000);
  const offline = await v.evaluate(() => ({ valori: document.querySelector('[data-a="valori"]')?.classList.contains("nopc"), testo: document.getElementById("app").innerText }));
  check(offline.valori && await grigi() >= 2 && /RX TORACE/.test(offline.testo) && /Senza rete/.test(await pill()),
    `senza rete: in testa «Senza rete», gli esiti in memoria restano, e quello che va chiesto al PC è in grigio (${await grigi()} in grigio)`);
  // la presa di prima è morta senza dirlo: il battito se ne accorge, e i tentativi si diradano
  await sospendi(40000);
  const ore = (await v.evaluate(() => window.__prese)).slice(p0);
  const passi = ore.slice(1).map((t, i) => t - ore[i]);
  check(ore.length >= 4 && ore.length <= 12 && passi[0] < 1500 && Math.max(...passi) <= 15500 && Math.max(...passi) >= 6000,
    `senza rete i tentativi si diradano: il primo subito, poi sempre più radi, mai oltre 15 s (${ore.length} prese in 40 s; ${passi.map((x) => (x / 1000).toFixed(1)).join(" · ")} s)`);
  // 2. fuori dall'ascensore: la rete torna, la presa si rifà subito, i bottoni tornano da soli
  let t0 = Date.now();
  await reteV();
  const tornata = await finche(async () => !(await pill()) && relay.prese().tel === 1, 10000);
  const dt = Date.now() - t0;
  check(tornata && dt < 3000, `tornata la rete, il telefono si ricollega subito, senza aspettare il prossimo tentativo (${dt} ms)`);
  check(await finche(async () => (await grigi()) === 0, 5000), "e quello che era in grigio torna da solo");
  // 3. la presa tagliata (il ripetitore, un proxy, il passaggio dal wifi al 5G)
  const e0 = relay.entrate().tel;
  t0 = Date.now();
  relay.taglia("tel");
  const rifatta = await finche(async () => relay.entrate().tel > e0 && relay.prese().tel === 1 && !(await pill()), 10000);
  check(rifatta && Date.now() - t0 < 3000, `la presa tagliata si rifà da sola, subito (${Date.now() - t0} ms)`);

  // 4. un promemoria la cui risposta si perde: la presa cade mentre il PC lo
  // scrive, il telefono lo rimanda col suo numero — sul PC uno solo
  await sw.evaluate(() => {
    self.__vere = { scheda: ponteSuScheda, comando: ponteComando, pdf: ponteDaiPdf, ordina: ponteOrdina };
    // (gli ordini che il PC fa davvero, per quesito: quanti arrivano alla scheda del gestionale)
    self.__eseguiti = [];
    globalThis.ponteOrdina = (d) => { self.__eseguiti.push(d.quesito); return self.__vere.ordina(d); };
    self.__arrivi = []; self.__pezzi = [];
    globalThis.ponteSuScheda = async (cmd, a) => { if (cmd === "promemoria") await attendi(3000); return self.__vere.scheda(cmd, a); };
    self.__ordini = [];
    globalThis.ponteComando = (s, d) => {
      if (d && d.cmd === "promemoria") self.__arrivi.push(d.rq);
      if (d && d.cmd === "ordina") self.__ordini.push(d.quesito);
      return self.__vere.comando(s, d);
    };
    globalThis.ponteDaiPdf = async (s, d) => { self.__pezzi.push(d.i); if (d.i === 1 && self.__pezzi.length === 2) await attendi(2000); return self.__vere.pdf(s, d); };
  });
  const emogas = () => doc3.evaluate(() => (JSON.parse(localStorage.getItem("psassist:dafare.v1") || "{}")["999001"] || []).filter((x) => !x.fatto && /emogas/.test(x.testo)).length);
  await tocca(v, '[data-a="promApri"]');
  await v.locator("#promin").fill("tra 3h emogas");
  await tocca(v, '[data-a="prom"]');
  await finche(() => sw.evaluate(() => self.__arrivi.length === 1), 10000);
  await reteV({ offline: true });
  relay.taglia("tel");
  await sospendi(5000);   // intanto il PC l'ha scritto, e la sua risposta non trova il telefono
  await reteV();
  const visto = await finche(async () => (await v.locator('.promr:has-text("emogas")').count()) === 1, 20000);
  const arrivi = await sw.evaluate(() => self.__arrivi);
  check(visto && arrivi.length >= 2 && new Set(arrivi).size === 1 && await emogas() === 1,
    `la presa cade mentre il PC scrive un promemoria: il telefono lo rimanda col suo numero (${arrivi.length} arrivi), sul PC ce n'è uno solo, e il telefono lo mostra`);

  // 5. un PDF tagliato a metà strada riprende da dove era, non da capo
  const idRef = await v.locator('.ref:has-text("TC ENCEFALO")').first().getAttribute("data-id");
  const pdf = Buffer.concat([refertoRxPdf(["RADIOLOGIA - ripresa"]), Buffer.alloc(1200000, 0x43)]);
  await sw.evaluate(([k, data]) => chrome.storage.local.set({ [k]: { ep: "999001", data, ts: Date.now() } }), ["ref:" + idRef, pdf.toString("base64")]);
  await tocca(v, '[data-a="indietro"]'); await aspettaTel(v, /BIANCHI A\./);
  await tocca(v, '.paz[data-ep="999001"]');
  await finche(async () => (await v.locator('.refw:has-text("TC ENCEFALO") .pdf').count()) === 1, 20000);
  // (il PC tarda col secondo pezzo: intanto la rete se ne va, e la sua risposta si perde)
  const e1 = relay.entrate().tel;
  const [popup] = await Promise.all([v.waitForEvent("popup", { timeout: 15000 }), tocca(v, '.refw:has-text("TC ENCEFALO") .pdf')]);
  await finche(() => sw.evaluate(() => self.__pezzi.includes(1)), 20000);
  await reteV({ offline: true });
  relay.taglia("tel");
  await sospendi(3000);
  await reteV();
  const arrivato = await finche(() => /^blob:/.test(popup.url()), 60000);
  const pezzi = await sw.evaluate(() => self.__pezzi);
  check(arrivato && relay.entrate().tel > e1 && pezzi.filter((i) => i === 0).length === 1 && pezzi.filter((i) => i === 1).length >= 2 && Math.max(...pezzi) === Math.ceil(pdf.length * 4 / 3 / 520000) - 1,
    `un PDF tagliato a metà strada: ripreso dal pezzo dove era (non da capo), ricomposto e aperto (pezzi chiesti al PC: ${pezzi.join(",")})`);
  await popup.close();
  await sw.evaluate((k) => chrome.storage.local.remove(k), "ref:" + idRef);

  // (un ordine dal telefono: quante volte il PC lo fa — la scheda del gestionale lo porta poi fino in fondo, o dice perché no —
  // e quando il telefono ha la risposta: il bottone non aspetta più)
  const eseguiti = (q) => sw.evaluate((q) => self.__eseguiti.filter((x) => x === q).length, q);
  const risposto = async (p) => !/Mando l'ordine al PC|In coda/.test(await p.locator("#ordina").innerText().catch(() => "")) && !(await p.locator(".coda").count());
  // 6. una rete lenta (1500 ms, 50 kbit/s): elenco, esiti e un ordine arrivano, senza falsi allarmi
  await v.waitForSelector(".avviso", { state: "detached", timeout: 10000 }).catch(() => {});
  await v.evaluate(() => {
    window.__allarmi = [];
    new MutationObserver(() => {
      for (const a of document.querySelectorAll(".avviso.err, .statopc")) if (!window.__allarmi.includes(a.textContent)) window.__allarmi.push(a.textContent);
    }).observe(document.getElementById("app"), { childList: true, subtree: true });
  });
  await reteV({ latency: 1500, downloadThroughput: 50e3 / 8, uploadThroughput: 50e3 / 8 });
  const e2 = relay.entrate().tel, ric0 = Object.keys(B.state.richieste).length;
  const elenchi = async () => ((await registroPc(doc3)).match(/iPhone · elenco dei pazienti/g) || []).length;
  // (un paziente nuovo sul PC: quando il telefono lo mostra, l'elenco è arrivato)
  const gialli = (si) => doc3.evaluate((si) => {
    const K = "psassist:patients.v1";
    const l = JSON.parse(localStorage.getItem(K) || "[]").filter((p) => p.ep !== "999005");
    if (si) l.push({ ep: "999005", name: "GIALLI PIETRO", url: "", ts: Date.now() - 10 * 60e3, pk: "", triage: "VERDE" });
    localStorage.setItem(K, JSON.stringify(l));
  }, si);
  await gialli(true);
  const el0 = await elenchi();
  await tocca(v, '[data-a="indietro"]');
  const elenco = await finche(async () => (await elenchi()) > el0 && /GIALLI/.test(await testoTel(v)), 30000);
  await tocca(v, '.paz[data-ep="999002"]');
  const esitiB = /Aggiorna i valori/.test(await aspettaTel(v, /Aggiorna i valori/, 40000));
  await tocca(v, '[data-a="scheda"][data-s="richieste"]');
  await aspettaTel(v, /Dol th/, 10000);
  await tocca(v, '[data-a="esame"]:has-text("TROPONINA US")');
  await v.locator("#quesito").fill("rete lenta");
  await tocca(v, "#ordina"); await sospendi(900); await tocca(v, "#ordina");
  const ordinato = await finche(async () => (await eseguiti("rete lenta")) === 1 && await risposto(v), 120000);
  await sospendi(3000);
  // (solo gli allarmi della rete: un no della scheda del gestionale è un'altra storia)
  const allarmi = (await v.evaluate(() => window.__allarmi)).filter((x) => /Non so|in tempo|Ricollego|Senza rete|raggiungibile|PC assente/.test(x));
  check(elenco && esitiB && ordinato && !allarmi.length && relay.entrate().tel === e2 && await eseguiti("rete lenta") === 1 && Object.keys(B.state.richieste).length <= ric0 + 1,
    `rete lenta (1500 ms, 50 kbit/s): l'elenco, gli esiti di BIANCHI e un ordine arrivano, senza un allarme e senza rifare la presa (${allarmi.join(" | ") || "nessun allarme"}; elenco ${elenco}, esiti ${esitiB}, ordine ${ordinato}, prese +${relay.entrate().tel - e2}, richieste +${Object.keys(B.state.richieste).length - ric0})`);
  await reteV();
  await gialli(false);
  await finche(ordiniFiniti, 60000);

  // 7. un ordine toccato senza rete: in coda, col conto alla rovescia; tornata la rete entro 30 secondi, parte, una volta
  const richB = () => Object.keys(B.state.richieste).length;
  const arrivatiPc = (q) => sw.evaluate((q) => self.__ordini.filter((x) => x === q).length, q);
  const ordinaSu = async (p, q) => {
    await tocca(p, '[data-a="esame"]:has-text("TROPONINA US")');
    await p.locator("#quesito").fill(q);
    await tocca(p, "#ordina"); await sospendi(900); await tocca(p, "#ordina");
  };
  const coda = () => v.locator(".coda").first().innerText().catch(() => "");
  await reteV({ offline: true });
  await finche(async () => /Senza rete/.test(await pill()), 15000);
  const usabile = await v.locator("#ordina.nopc").count() === 0;
  const r1 = richB();
  await ordinaSu(v, "in coda");
  const c1 = (await finche(async () => /In coda · 0:\d\d/.test(await coda()), 5000)) ? await coda() : "";
  await sospendi(2500);
  const c2 = await coda();
  const sec = (t) => Number((/0:(\d\d)/.exec(t) || [])[1]);
  await reteV();
  const partito = await finche(async () => (await eseguiti("in coda")) === 1 && await risposto(v), 60000);
  await finche(ordiniFiniti, 60000); await sospendi(2000);
  check(usabile && sec(c1) >= 26 && sec(c2) < sec(c1) && partito && await eseguiti("in coda") === 1 && richB() <= r1 + 1 && await arrivatiPc("in coda") >= 1,
    `senza rete «Conferma e stampa» resta usabile: l'ordine va in coda («${c1.split("\n")[0]}» → «${c2.split("\n")[0]}»), e tornata la rete parte, una volta sola (usabile ${usabile}, partito ${partito}, fatto sul PC ${await eseguiti("in coda")} volte, richieste +${richB() - r1}, arrivi al PC ${await arrivatiPc("in coda")}; ${(await testoTel(v)).replace(/\s+/g, " ").slice(0, 160)})`);

  // 8. senza rete per più di 30 secondi: scade, non parte più — nemmeno quando la rete torna; toccato, si riarma
  await reteV({ offline: true });
  await finche(async () => /Senza rete/.test(await pill()), 15000);
  const r2 = richB();
  await ordinaSu(v, "scade senza rete");
  const scaduta = await finche(async () => /Scaduta: non inviata/.test(await coda()), 40000);
  await reteV();
  await finche(async () => !(await pill()), 10000);
  await sospendi(4000);
  check(scaduta && richB() === r2 && await arrivatiPc("scade senza rete") === 0 && await eseguiti("scade senza rete") === 0,
    "senza rete oltre 30 secondi: «Scaduta: non inviata», e tornata la rete non parte (il PC non lo vede mai)");
  await tocca(v, '.coda[data-a="riarma"]');
  const riarmato = await v.locator("#ordina").innerText();
  check(/Ordino 1 esame per BIANCHI ANNA.*Tocca di nuovo/.test(riarmato) && !(await v.locator(".coda").count()),
    `toccata la carta scaduta, la scelta torna e il bottone chiede di nuovo conferma (${riarmato})`);
  await tocca(v, '[data-a="esame"]:has-text("TROPONINA US")');   // (non lo conferma: via la scelta)

  // 9. l'orologio del telefono 5 minuti avanti o indietro: l'ordine in coda parte lo stesso, una volta
  const esiti = [];
  for (const x of [-5 * 60e3, 5 * 60e3]) {
    await v.evaluate((x) => sessionStorage.setItem("__salto", String(x)), x);
    await v.reload();
    await aspettaTel(v, /BIANCHI A\./, 20000);
    await tocca(v, '.paz[data-ep="999002"]');
    await aspettaTel(v, /Aggiorna i valori/, 20000);
    await tocca(v, '[data-a="scheda"][data-s="richieste"]');
    await aspettaTel(v, /Dol th/, 10000);
    await reteV({ offline: true });
    await finche(async () => /Senza rete/.test(await pill()), 15000);
    const r = richB(), q = `orologio ${x > 0 ? "avanti" : "indietro"}`;
    await ordinaSu(v, q);
    await finche(async () => /In coda/.test(await coda()), 5000);
    await sospendi(3000);
    await reteV();
    const ok = await finche(async () => (await eseguiti(q)) === 1 && await risposto(v), 60000);
    await finche(ordiniFiniti, 60000); await sospendi(2000);
    esiti.push(ok && await eseguiti(q) === 1 && richB() <= r + 1);
  }
  check(esiti.length === 2 && esiti.every(Boolean), `con l'orologio del telefono 5 minuti indietro o avanti, l'ordine in coda parte lo stesso, una volta (${esiti.join(", ")})`);
  await v.evaluate(() => sessionStorage.removeItem("__salto"));

  await sw.evaluate(() => { globalThis.ponteSuScheda = self.__vere.scheda; globalThis.ponteComando = self.__vere.comando; globalThis.ponteDaiPdf = self.__vere.pdf; globalThis.ponteOrdina = self.__vere.ordina; });
  await vCtx.close();
  await tocca(tel, '[data-a="riapri"]');
  await aspettaTel(tel, /ROSSI M\./, 20000);

  // 10. un ordine partito ma trattenuto per strada oltre i 30 secondi (e l'orologio
  // del telefono 5 minuti avanti): il PC non lo fa, e il telefono lo dice
  await tel.evaluate(() => sessionStorage.setItem("__salto", String(5 * 60e3)));
  await tel.reload();
  await aspettaTel(tel, /BIANCHI A\./, 20000);
  await tocca(tel, '.paz[data-ep="999002"]');
  await aspettaTel(tel, /Aggiorna i valori/, 20000);
  await tocca(tel, '[data-a="scheda"][data-s="richieste"]');
  await aspettaTel(tel, /Dol th/, 10000);
  const r3 = Object.keys(B.state.richieste).length;
  rete.ritarda = 35000;
  await tocca(tel, '[data-a="esame"]:has-text("TROPONINA US")');
  await tel.locator("#quesito").fill("trattenuto");
  await tocca(tel, "#ordina"); await sospendi(900); await tocca(tel, "#ordina");
  const tardivo = await finche(async () => /Scaduta: non inviata/.test(await tel.locator(".coda").first().innerText().catch(() => "")), 50000);
  rete.ritarda = 0;
  await sospendi(3000);
  check(tardivo && Object.keys(B.state.richieste).length === r3 && /un ordine arrivato tardi: scaduto, non fatto/.test(await registroPonte())
    && !/Non so se l'ordine/.test(await testoTel(tel)),
    "un ordine trattenuto per strada 35 secondi (orologio del telefono 5 minuti avanti): il PC non lo fa, e il telefono dice «Scaduta: non inviata»");
  await tocca(tel, '.coda [data-a="codaVia"]');
  await tel.evaluate(() => sessionStorage.removeItem("__salto"));
  await tel.reload();
  await aspettaTel(tel, /ROSSI M\./, 20000);
}

// ===========================================================================
sezione("«Scansiona il QR» dentro l'app");
{
  // un QR in un video finto per la fotocamera di Chromium (y4m, in grigio)
  const qrDi = (() => { const c = vm.createContext({}); vm.runInContext(readFileSync(join(EXT, "qr.js"), "utf8"), c); return c.qrcodegen; })();
  const video = (testo, file) => {
    const q = qrDi.QrCode.encodeText(testo, qrDi.QrCode.Ecc.MEDIUM), W = 640, H = 480, px = 8, lato = (q.size + 8) * px;
    const y = Buffer.alloc(W * H, 235), x0 = (W - lato) / 2 | 0, y0 = (H - lato) / 2 | 0;
    for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.getModule(c, r)) {
      for (let dy = 0; dy < px; dy++) y.fill(16, (y0 + (r + 4) * px + dy) * W + x0 + (c + 4) * px, (y0 + (r + 4) * px + dy) * W + x0 + (c + 5) * px);
    }
    const uv = Buffer.alloc(W * H / 2, 128), fot = Buffer.concat([Buffer.from("FRAME\n"), y, uv]);
    writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), fot, fot]));
    return file;
  };
  // un telefono con la fotocamera finta, e una chiave scaduta (o niente)
  const VID = join("/tmp", `psa-ponte-qr-${process.pid}.y4m`);
  const conCamera = async (testo) => {
    const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video(testo, VID)}`] });
    const c = await b.newContext({ ...IPHONE, permissions: ["camera"] });
    await c.addInitScript((k) => {
      if (!sessionStorage.getItem("__giaScaduta")) {
        sessionStorage.setItem("__giaScaduta", "1");
        localStorage.setItem("psassist.ponte.v1", JSON.stringify({ k, scade: Date.now() - 3600e3, dev: "telefonoscaduto0001" }));
      }
      // (la fotocamera, vista da fuori: le sue tracce, e quante volte si spegne)
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__tracce = [];
      navigator.mediaDevices.getUserMedia = async (v) => { const s = await gum(v); window.__tracce.push(...s.getTracks()); return s; };
      const stop = MediaStreamTrack.prototype.stop;
      MediaStreamTrack.prototype.stop = function () { sessionStorage.setItem("__spenta", String(Number(sessionStorage.getItem("__spenta") || 0) + 1)); return stop.call(this); };
    }, P.b64u(P.casuale(32)));
    const p = await c.newPage();
    await p.goto(relay.url + "/ponte/");
    return { b, p };
  };
  // il file del decodificatore: servito, con la fotocamera permessa solo a questo sito
  const fileQr = await fetch(relay.url + "/ponte/jsqr.min.js");
  check(fileQr.status === 200 && /jsQR 1\.4\.0/.test(await fileQr.text()) && fileQr.headers.get("permissions-policy") === "camera=(self), microphone=(), geolocation=()",
    "il decodificatore (jsQR 1.4.0) è un file dell'app; la fotocamera è permessa a lei sola, microfono e posizione a nessuno");

  // 1. la fotocamera che non c'è: una riga, e la strada di prima
  const nudoCtx = await telBrowser.newContext(IPHONE);
  const nudo = await nudoCtx.newPage();
  await nudo.goto(relay.url + "/ponte/");
  await aspettaTel(nudo, /Scansiona il QR/, 10000);
  check(await nudo.locator("#app .grande").count() === 1 && await nudo.locator('.grande[data-a="scansiona"]').count() === 1, "senza associazione: un bottone solo, «Scansiona il QR»");
  await tocca(nudo, '[data-a="scansiona"]');
  check(/Fotocamera non disponibile: inquadra il QR con la Fotocamera dell'iPhone/.test(await aspettaTel(nudo, /Fotocamera non disponibile/, 10000)) && await nudo.locator(".scan").count() === 0,
    "senza fotocamera: «Fotocamera non disponibile: inquadra il QR con la Fotocamera dell'iPhone»");
  await shot(nudo, "tel-qr-1-senza-fotocamera");
  await nudoCtx.close();

  // il PC fa un QR nuovo
  const pqr = await ctx.newPage();
  await pqr.goto(EXTURL("ponte.html"));
  await pqr.waitForSelector("#stato b");
  await pqr.locator("#associa").click();
  await pqr.waitForSelector("#qr svg", { timeout: 8000 });
  const url4 = await qrUrl();
  const K4 = P.b64u(P.leggiFrammento(new URL(url4).hash).k);

  // 2. il QR di un altro sito (con una chiave e tutto): si ignora; ✕ spegne la fotocamera
  const fuori = await conCamera(url4.replace(relay.url, "https://altro.example.org"));
  check(/Associazione scaduta/.test(await aspettaTel(fuori.p, /Associazione scaduta/, 10000)) && await fuori.p.locator('.grande[data-a="scansiona"]').count() === 1,
    "un telefono con l'associazione scaduta: «Scansiona il QR»");
  await shot(fuori.p, "tel-qr-2-scaduta");
  await tocca(fuori.p, '[data-a="scansiona"]');
  const vivo = await finche(() => fuori.p.evaluate(() => { const v = document.querySelector(".scan video"); return !!v && v.readyState >= 2 && !v.paused; }), 10000);
  await sospendi(2500);
  check(vivo && await fuori.p.locator(".scan .guida").count() === 1 && await fuori.p.evaluate(() => localStorage.length) === 0 && /Associazione scaduta/.test(await testoTel(fuori.p)),
    "la fotocamera nella pagina, col quadrato: un QR di un altro sito si ignora (nessuna chiave, si resta lì)");
  await shot(fuori.p, "tel-qr-3-fotocamera");
  await tocca(fuori.p, ".scan .x");
  check(await fuori.p.locator(".scan").count() === 0 && await fuori.p.evaluate(() => window.__tracce.length > 0 && window.__tracce.every((t) => t.readyState === "ended")),
    "✕: la vista si chiude e la fotocamera si spegne");
  await fuori.b.close();

  // 3. il QR nuovo del PC, inquadrato dentro l'app: l'elenco
  const dentro = await conCamera(url4);
  await aspettaTel(dentro.p, /Associazione scaduta/, 10000);
  await tocca(dentro.p, '[data-a="scansiona"]');
  const elenco = await aspettaTel(dentro.p, /ROSSI M\./, 25000);
  check(/ROSSI M\./.test(elenco) && (await chiaveTel(dentro.p))?.k === K4 && !(await dentro.p.evaluate(() => location.hash)),
    "inquadrato dentro l'app il QR nuovo del PC: la chiave nuova, e l'elenco (il frammento non resta nell'indirizzo)");
  check(Number(await dentro.p.evaluate(() => sessionStorage.getItem("__spenta"))) >= 1, "letto il codice, la fotocamera si spegne");
  await shot(dentro.p, "tel-qr-4-elenco");
  await dentro.b.close();
  await pqr.close();
  rmSync(VID, { force: true });
}

// ===========================================================================
sezione("il ripetitore non vede niente in chiaro");
// (solo parole di almeno 5 lettere: due o tre byte uguali per caso, in tanti byte cifrati, ci sono sempre)
const segreti = ["ROSSI", "BIANCHI", "MARIO", "VERDI", "TROPONINA", "EMOCROMO", CF_A, CF_B, "999001", "999002", "tropo", "dolore", "allergico", "ENCEFALO", "pazienti", "focolai", "ZQXW7731", "KAPPAZETA", "NUOVAZETA", "OMEGAFARM", "BETALLERG", "SIGMAREMOTA", "TAUOBIETT", "sudorazione", "Penicillina"];
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
