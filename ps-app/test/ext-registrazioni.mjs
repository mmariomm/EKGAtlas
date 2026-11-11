#!/usr/bin/env node
/*
 * La registrazione automatica, con l'estensione VERA e il gestionale com'è
 * davvero (gestionale-vero.mjs): accesa di norma, tiene gli ultimi 3 minuti —
 * senza pill, senza ● REC, senza rileggere niente —, li pota da sola, li
 * cancella all'avvio del browser. Un ordine che va bene non salva niente; un
 * ordine che finisce male (il carrello perso a metà, due volte: «ORA-20965»,
 * e la richiesta rifatta lo perde di nuovo) salva da solo UNO zip «auto», con
 * le pagine di prima dell'ordine, anonimizzato e controllato, senza schede. Una
 * registrazione a mano vince; spenta, niente in memoria.
 *   node test/ext-registrazioni.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./gestionale-vero.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-regauto-" + process.pid);
const OUT = join("/tmp", "psa-regauto-zip-" + process.pid);
const SHOTS = process.env.TEST_SHOTS_DIR || "";
mkdirSync(OUT, { recursive: true });
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
const $panel = (page, sel) => page.locator(`#psassist-host ${sel}`);
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\nregistrazioni: " + t);
const sospendi = (ms) => new Promise((res) => setTimeout(res, ms));
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(200)) if (await fn()) return true;
  return false;
}

// ROSSI MARIO: il gestionale perde il carrello al terzo esame, e di nuovo
// nella richiesta rifatta (le registrazioni vere della 3.73.0). BIANCHI ANNA: tutto bene.
const A = createMock({ carrelloPerso: [3, 3] });
const B = createMock({ name: "BIANCHI ANNA", episodeId: "999002" });
B.state.nextRichiestaId = 800001;
const quale = (url) => {
  const p = new URL(url).searchParams;
  return p.get("EPISODIO_ID") === "999002" || Number(p.get("RICHIESTA_ID")) >= 800000 ? B : A;
};
async function apriBrowser() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
    viewport: { width: 1366, height: 768 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
  });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 }));
      // (il caricamento da solo dei valori, che apre lo storico in una scheda dietro: già fatto — lo prova ext-referti)
      const lab = JSON.stringify({ ris: [], ref: ["aaaa1111-0000-0000-0000-000000000001", "bbbb2222-0000-0000-0000-000000000002"], rich: [] });
      localStorage.setItem("psassist:autoCarica.v1", JSON.stringify({ 999001: { ts: Date.now(), lab, parz: Date.now() }, 999002: { ts: Date.now(), lab, parz: Date.now() } }));
    } catch { /* niente */ }
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
  const sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  return { ctx, sw };
}
let { ctx, sw } = await apriBrowser();
const scorre = () => sw.evaluate(() => regContaScorre());
const aMano = () => sw.evaluate(() => regConta());
const elenco = () => sw.evaluate(() => regElenco());
const ordini = () => sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []));
async function suPagina(p, url) {
  await p.goto(url);
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}
async function apriPannello(p) {
  if (!(await $panel(p, ".card").count())) {
    await $panel(p, "#expand").click();
    await p.waitForSelector("#psassist-host .card", { timeout: 8000 });
  }
}
async function vista(p) {
  await apriPannello(p);
  await $panel(p, "#menubtn").click();
  await $panel(p, "#regmenu").click();
  await p.waitForSelector("#psassist-host .registrazioni .regauto", { timeout: 8000 });
}
async function ordina(p, esami, quesito = "dolore toracico") {
  await apriPannello(p);
  if (!(await $panel(p, "#q").count())) await $panel(p, '[data-seg="richieste"]').click();
  await $panel(p, "#q").fill(quesito);
  for (const e of esami) await $panel(p, `.opt[title*="${e}"]`).click();
  await $panel(p, "#goconfirm").click();
}
const nuove = [];
const ascolta = (c) => c.on("page", (p) => nuove.push(p.url()));
ascolta(ctx);
// (il minuto dopo l'incidente, qui: tre secondi)
await sw.evaluate(() => { REG_DOPO = 3000; });

// ===========================================================================
sezione("accesa di norma: gli ultimi minuti, senza pill e senza ● REC");
const doc = await ctx.newPage();
await suPagina(doc, A.worklistUrl);
await doc.waitForTimeout(1200);
await suPagina(doc, B.patientUrl);
await doc.waitForTimeout(1200);
await suPagina(doc, A.patientUrl);
await doc.waitForTimeout(1500);
const s1 = await scorre();
check(s1.pagine >= 3 && s1.flusso > 0, `la registrazione automatica tiene le pagine e il flusso (${s1.pagine} pagine, ${s1.flusso} richieste)`);
check((await aMano()).pagine === 0 && !(await sw.evaluate(() => chrome.storage.local.get("registra").then((o) => o.registra || null))), "niente nella registrazione a mano, nessuno stato «rec»");
await apriPannello(doc);
check(await $panel(doc, ".recchip").count() === 0 && await doc.locator("#psassist-reg-host").count() === 0, "niente ● REC, niente pill «Registrando…»");
await vista(doc);
const v1 = await $panel(doc, ".registrazioni").innerText();
check(await $panel(doc, "#regauto").isChecked() && /Registrazione automatica · accesa/.test(v1) && /ultimi 3 minuti/.test(v1), "la vista dice che è accesa, e cosa tiene");
const regIn = await doc.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot, d = r.querySelector("details#registro"), s = r.querySelector(".registrazioni");
  return { c: !!d && !d.open && !!d.querySelector("summary #copylog"), sotto: !!d && !!s && !!(s.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING), voce: !!r.querySelector("#verbtn, #refdiag") };
});
check(regIn.c && regIn.sotto && !regIn.voce, `una voce sola: in fondo alle Registrazioni, chiuso, il Registro con ⧉ Copia; niente «Registro» né «⧉ Diagnosi» a parte (got ${JSON.stringify(regIn)})`);
check(!(await sw.evaluate(() => RegistraDb.tx("scorre", "readonly", (s) => s.getAll()).then((l) => l.some((x) => x.origine === "rilettura" || (x.flusso || []).some((r) => r.registratore))))),
  "e non rilegge niente dalla cache");

// ===========================================================================
sezione("niente più vecchio di 3 minuti");
await sw.evaluate(async () => {
  await RegistraDb.tx("scorre", "readwrite", (s) => { s.add({ tipo: "pagina", ts: Date.now() - 4 * 60e3, url: "https://smarthealth.multimedica.it/vecchia", html: "<html>vecchia</html>" }); });
});
check((await scorre()).piuVecchia < Date.now() - 3.5 * 60e3, "(una pagina di quattro minuti fa, messa lì apposta)");
const allarme = await sw.evaluate(() => chrome.alarms.get("registra-pota"));
check(!!allarme && allarme.periodInMinutes === 0.5, `finché c'è qualcosa, un allarme ogni 30 secondi la pota (${JSON.stringify(allarme)})`);
const potata = await finche(async () => (await scorre()).piuVecchia >= Date.now() - 3 * 60e3 - 1000, 45000);
check(potata, `potata da sola, senza che nessuno chieda niente (la più vecchia: ${Math.round((Date.now() - (await scorre()).piuVecchia) / 1000)} s fa)`);
// un incidente che aspetta il suo minuto: i 3 minuti prima di lui restano, finché non è salvato
const tiene = await sw.evaluate(async () => {
  const ts = Date.now() - 60e3;
  await chrome.storage.session.set({ "registra.incidente": { ts, motivi: ["prova"] } });
  await RegistraDb.tx("scorre", "readwrite", (s) => { s.add({ tipo: "pagina", ts: ts - 2.5 * 60e3, url: "https://smarthealth.multimedica.it/prima", html: "<html>prima</html>" }); });
  await regPota();
  const con = (await regContaScorre()).piuVecchia <= ts - 2.5 * 60e3;
  await chrome.storage.session.remove("registra.incidente");
  await regPota();
  return [con, (await regContaScorre()).piuVecchia >= Date.now() - 3 * 60e3 - 1000];
});
check(tiene[0] && tiene[1], `con un incidente in attesa si tengono i 3 minuti prima di lui (anche se più vecchi di 3 minuti da adesso); poi si pota (${tiene})`);

// ===========================================================================
sezione("un ordine che va bene: niente salvato");
const n0 = nuove.length;
await suPagina(doc, B.patientUrl);
await ordina(doc, ["EMOCROMOCITOMETRICO", "TROPONINA"]);
check(await finche(() => Object.values(B.state.richieste).some((x) => x.confirmed), 60000), "l'ordine di BIANCHI è confermato");
await finche(async () => (await ordini()).some((x) => ["stampa", "avviso"].includes(x.stato)), 30000);
await doc.waitForTimeout(2500);
await doc.keyboard.press("Escape").catch(() => {});
await doc.waitForSelector("#psassist-print", { state: "detached", timeout: 8000 }).catch(() => {});
await doc.waitForTimeout(5000);
const ordB = (await ordini()).map((x) => `${x.stato}/${x.pubblico && x.pubblico.tono}`);
check((await elenco()).length === 0 && !(await sw.evaluate(() => chrome.storage.session.get("registra.incidente").then((o) => o["registra.incidente"] || null))),
  `nessuno zip automatico, nessun incidente (l'ordine: ${ordB.join(", ")})`);

// ===========================================================================
sezione("un ordine che finisce male: uno zip «auto», da solo, con le pagine di prima");
await suPagina(doc, A.worklistUrl);
await doc.waitForTimeout(1000);
await suPagina(doc, A.patientUrl);
await doc.waitForTimeout(800);
// (un documento che non si è lasciato leggere, in quei minuti: la sua diagnosi com'è quando arriva dal pannello —
// senza numeri né valori, ma col nome che la pagina portava)
await sw.evaluate(() => regAccoda("diagnosi", { ts: Date.now(), scheda: 0, testo: "PS Assist 3.86 · 10:00:00 · referto RX TORACE (HL7RIS)\n/sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID&REFERTO_ID\nnessun PDF [frame]\n---\n<html><body><table><tr><td>Paziente:</td><td>ROSSI MARIO</td></tr></table><iframe src=\"x?ID=###\"></iframe></body></html>" }));
await ordina(doc, ["CREATININEMIA", "EMOCROMOCITOMETRICO", "TROPONINA"], "febbre");
const male = await finche(async () => (await ordini()).some((x) => x.id && ["errore", "chiusa", "interrotto", "avviso", "stampa"].includes(x.stato) && x.pubblico && ["warn", "err"].includes(x.pubblico.tono)), 120000);
const ordA = (await ordini()).map((x) => `${x.stato}/${x.pubblico && x.pubblico.tono}: ${x.pubblico && x.pubblico.titolo}`);
check(male && A.state.perse.length === 2 && !Object.values(A.state.richieste).some((x) => x.confirmed), `l'ordine di ROSSI finisce male: il carrello perso due volte, niente confermato (${ordA.join(" · ")})`);
const auto = await finche(async () => (await elenco()).length === 1, 90000);
await sospendi(6000);   // un incidente, uno zip: quello che arriva dopo (il registro degli errori, l'ordine riscritto) non ne fa un secondo
const l1 = await elenco(), z = l1[0] || {};
check(auto && l1.length === 1 && z.motivo === "auto" && /-auto\.zip$/.test(z.nome) && z.errore && !/ROSSI|MARIO|999001/.test(JSON.stringify(z)),
  `uno zip «auto», uno solo, col motivo e senza il paziente (${z.nome} · «${z.errore}»)`);
check(/automatica: dai 3 minuti prima di «.+» a 1 dopo/.test(z.riepilogo || "") && z.controllo, `anonimizzato e controllato come gli altri (${(/Durata:[^\n]*/.exec(z.riepilogo || "") || [""])[0]} · controllo ${z.controllo ? "superato" : `${z.punti} punti: ${JSON.stringify(await sw.evaluate((id) => RegistraDb.tx("zip", "readonly", (s) => s.get(id)).then((x) => x && x.dove), z.id))}`})`);
check(!ctx.pages().some((p) => /^chrome-extension:/.test(p.url())), `salvato senza aprire schede nell'estensione (aperte: ${ctx.pages().map((p) => p.url().replace(/\?.*/, "")).join(", ")})`);
const zipBuf = Buffer.from(await sw.evaluate(async (id) => b64(await RegistraDb.tx("zipdati", "readonly", (s) => s.get(id))), z.id), "base64");
const zf = join(OUT, "auto.zip"), dir = join(OUT, "auto");
writeFileSync(zf, zipBuf);
mkdirSync(dir, { recursive: true });
try { execFileSync("unzip", ["-q", "-o", zf, "-d", dir]); } catch (e) { check(false, "lo zip si apre: " + e.message); }
const pagine = existsSync(join(dir, "pagine")) ? readdirSync(join(dir, "pagine")) : [];
const leggi = (f) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return ""; } };
check(pagine.some((f) => /-PsoLista\.html$/.test(f)) && pagine.filter((f) => /-PsoEpisodioClinicoAmbulatorio\.html$/.test(f)).length >= 2,
  `dentro, le pagine di prima dell'ordine: la lista e i pazienti (${pagine.length} pagine)`);
const rq = (JSON.parse(leggi("flusso.json") || "{}").richieste || []);
check(rq.some((x) => /Insert=Inserisci/.test(x.url)) && rq.some((x) => /RICHIESTACrea|PsoRichiestaCreaRcs/.test(x.url)), `e il giro dell'ordine: la richiesta creata, gli inserimenti (${rq.length} richieste)`);
const err = (JSON.parse(leggi("errori.json") || "{}").errori || []).filter((x) => x.tipo === "ordine");
check(err.length >= 1, `e il registro degli errori di quei minuti (${err.length} errori dell'ordine)`);
const regTxt = leggi("testi/registro.txt"), diaTxt = leggi("testi/diagnosi-1.txt");
check(/── scheda 1 ──/.test(regTxt) && /esam/.test(regTxt) && !/ROSSI|999001|febbre/.test(regTxt),
  `e il Registro dei pannelli di quei minuti, anonimizzato (testi/registro.txt: ${regTxt.split("\n").length} righe; ${(/[^\n]*esam[^\n]*/.exec(regTxt) || ["—"])[0].slice(0, 90)})`);
// (i nomi corti degli esami del pannello, in maiuscolo in mezzo a una riga, non sono persone: restano)
check(/TROPONINA US/.test(regTxt), `nel Registro gli esami restano col loro nome: «TROPONINA US», non un nome inventato (${(/[^\n]*TROPONINA US[^\n]*/.exec(regTxt) || ["—"])[0].slice(0, 90)})`);
check(/referto RX TORACE/.test(diaTxt) && /<iframe/.test(diaTxt) && !/ROSSI|MARIO/.test(diaTxt),
  `e la diagnosi del documento che non si è lasciato leggere, anonimizzata (testi/diagnosi-1.txt: ${diaTxt.replace(/\s+/g, " ").slice(0, 120)})`);
const tutto = readdirSync(dir, { recursive: true }).filter((f) => statSync(join(dir, String(f))).isFile()).map((f) => leggi(String(f))).join("\n");
for (const [cosa, v] of [["ROSSI MARIO", /ROSSI(?:\s|&nbsp;|\+|%20)+MARIO/i], ["BIANCHI ANNA", /BIANCHI(?:\s|&nbsp;|\+|%20)+ANNA/i],
  ["il codice fiscale del simulatore", /SMPRSS80A01F205X/], ["l'episodio 999001", /999001/], ["l'ospedale", /multimedica/i]]) check(!v.test(tutto), `nello zip non c'è ${cosa}`);
await vista(doc);
const riga = await $panel(doc, `.regrow[data-zip="${z.id}"]`).innerText().catch(() => "");
check(/automatica/.test(riga) && riga.includes(z.errore.slice(0, 20)), `nella vista: «automatica» e il perché (${riga.replace(/\s+/g, " ").slice(0, 140)})`);
if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await doc.screenshot({ path: join(SHOTS, "registrazioni-pc-auto.png") }).catch(() => {}); }

// ===========================================================================
sezione("anche il SISS fermato e l'errore grave della Terapia fanno un incidente; la ricetta pronta no");
const incidente = () => sw.evaluate(() => chrome.storage.session.get("registra.incidente").then((o) => o["registra.incidente"] || null));
const via = () => sw.evaluate(() => chrome.storage.session.remove("registra.incidente"));
await via();
await sw.evaluate(() => segnaErrore("ricetta", { esito: "inserite", passo: "fine", motivo: "Visite inserite" }));
await sospendi(500);
const pronta = await incidente();
await sw.evaluate(() => segnaErrore("ricetta", { esito: "fermo", passo: "compilo", motivo: "ROSSI MARIO 999001: fermato" }));
await finche(incidente, 2000);
const siss = await incidente();
await via();
await sw.evaluate(() => segnaErrore("terapia", { grave: true, perche: "nome diverso" }));
await finche(incidente, 2000);
const ter = await incidente();
await via();
check(!pronta && siss?.motivi?.[0] === "SISS: fermo (compilo)" && ter?.motivi?.[0] === "Terapia: nome diverso",
  `SISS fermo e Terapia: l'incidente col passo, senza il testo della pagina; le visite inserite niente (got ${JSON.stringify([pronta, siss?.motivi, ter?.motivi])})`);
await sospendi(3500);   // (passati i 3 s del test: tolti, nessuno zip in più)
check((await elenco()).length === 1, "e tolti prima del minuto, nessuno zip in più");

// ===========================================================================
sezione("la registrazione a mano vince");
await $panel(doc, "#regvia").click();
await finche(async () => (await sw.evaluate(() => chrome.storage.local.get("registra").then((o) => o.registra || null)))?.stato === "rec", 8000);
const primaS = (await scorre()).pagine, primaM = (await aMano()).pagine;
await suPagina(doc, B.patientUrl);
await doc.waitForTimeout(1500);
const dopoS = (await scorre()).pagine, dopoM = (await aMano()).pagine;
check(dopoM > primaM && dopoS === primaS, `mentre registri a mano, le pagine vanno lì e non negli ultimi minuti (a mano ${primaM}→${dopoM}, ultimi minuti ${primaS}→${dopoS})`);
check(await sw.evaluate(() => regIncidente("un ordine finito male, di prova")) === false, "un incidente intanto non salva niente da solo");
await apriPannello(doc);
await vista(doc);
await $panel(doc, "#regferma").click();
check(await finche(async () => (await elenco()).length === 2, 60000) && (await elenco())[0].motivo === "manuale", "«Ferma e salva»: lo zip a mano, accanto a quello automatico");

// ===========================================================================
sezione("spenta: niente in memoria");
await doc.waitForSelector("#psassist-host #regauto", { timeout: 8000 });
await $panel(doc, "#regauto").uncheck();
check(await finche(async () => (await scorre()).pagine === 0 && (await scorre()).flusso === 0, 8000), "spenta, quello che aveva in memoria se ne va subito");
await suPagina(doc, A.worklistUrl);
await doc.waitForTimeout(1500);
check((await scorre()).pagine === 0 && await sw.evaluate(() => regIncidente("prova")) === false, "e non tiene niente, né salva da sola");
await vista(doc);
check(/Registrazione automatica · spenta/.test(await $panel(doc, ".registrazioni").innerText()) && !(await $panel(doc, "#regauto").isChecked()), "la vista dice «spenta»");
await $panel(doc, "#regauto").check();
await finche(async () => await sw.evaluate(() => regAuto), 5000);
await suPagina(doc, A.worklistUrl);
await doc.waitForTimeout(1500);
check((await scorre()).pagine >= 1, "riaccesa, riprende");

// ===========================================================================
sezione("all'avvio del browser gli ultimi minuti non ci sono più");
check((await scorre()).pagine >= 1, "(prima di chiudere, in memoria ci sono)");
await ctx.close();
({ ctx, sw } = await apriBrowser());
const vuota = await finche(async () => { const c = await scorre().catch(() => null); return !!c && c.pagine === 0 && c.flusso === 0 && c.pdf.length === 0; }, 15000);
check(vuota, "riaperto il browser, la tabella degli ultimi minuti è vuota");
check((await elenco()).length === 2, "gli zip salvati (anonimizzati) restano");

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nREGISTRAZIONI: TUTTO OK");
process.exit(fail ? 1 : 0);
