#!/usr/bin/env node
/*
 * Una sessione sola del gestionale, e un motore che manda gli esami.
 *
 * Nel gestionale vero la richiesta «corrente» sta nella SESSIONE: una pagina
 * del modulo richieste aperta a metà ordine (la lista smart riletta dietro,
 * le etichette di un altro ordine, un'altra richiesta) la cambia, e
 * l'inserimento dopo risponde «ORA-20965: AMB_RICHIESTA: Progressivo richiesta
 * …-1 già utilizzato» — e il carrello riletto è vuoto (PS Assist 3.70.0: due
 * ordini di 11 esami su due erogatori, falliti così, «… non risulta nel
 * carrello» trenta secondi dopo; al primo esame del secondo erogatore è la
 * richiesta con due erogatori, che il gestionale non vuole: gestionale-vero.mjs,
 * e il pannello oggi ne fa una per erogatore). Qui il simulatore si comporta così: tiene la
 * richiesta corrente della sessione, e un inserimento su un'altra risponde con
 * l'avviso del database, senza inserire niente.
 *   1. a metà ordine nient'altro chiede pagine al gestionale (la lista smart
 *      aspetta la fine del motore): POC e Urgenze, due ordini, vanno senza ORA;
 *   2. una risposta con «ORA-»: in quella richiesta niente altro mandato, mai
 *      confermata; il giro si rifà da capo una volta, con una richiesta nuova
 *      (3.71.1 e 3.73.0: ordini di soli esami POC), e si conferma quella; la
 *      seconda volta si ferma subito e il medico legge «Il gestionale ha
 *      risposto: ORA-20965 …»;
 *   3. una scheda d'ordine che non è arrivata sulla pagina si sostituisce
 *      solo se il piano non l'ha mai avuto: mai due motori per un ordine.
 * Anche l'AREA sta nella sessione (Imposta → Conferma, da una scheda
 * qualunque): sull'area che non è del paziente, la sua pagina perde le
 * Richieste ma tiene l'elenco delle richieste coi loro fogli (pagina vera).
 *   node test/ext-sessione.mjs [nome della prova]
 */
import { chromium } from "playwright";
import { createMock, RES } from "./gestionale-vero.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-sess-" + process.pid);
const ORIGIN = "https://smarthealth.multimedica.it";
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
const sospendi = (ms) => new Promise((res) => setTimeout(res, ms));

let A, B;
const nuovi = () => {
  A = createMock();
  B = createMock({ name: "BIANCHI ANNA", episodeId: "999002" });
  B.state.nextRichiestaId = 800001;
};
nuovi();
const quale = (url) => {
  const p = new URL(url).searchParams;
  if (p.get("EPISODIO_ID") === "999002" || Number(p.get("RICHIESTA_ID")) >= 800000) return B;
  return A;
};

// ---- la sessione del gestionale: la richiesta corrente ------------------
// Ogni pagina del modulo richieste con un RICHIESTA_ID la fa sua; la lista
// smart la perde; le etichette di una richiesta la spostano su quella. Un
// inserimento su una richiesta che non è la corrente: ORA-20965.
const sess = { corrente: null, log: [], ora: 0, forzaOra: null, area: null, dopoConferma: null, smartVera: false, smartLenta: 0 };
// La lista smart vera (sess.smartVera): due schede, Ambulatorio (quella del link) e Triage, ognuna
// lenta smartLenta ms. Nomi e date inventati.
const impronta = (d) => { let h = 0x811c9dc5; for (const c of d) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h.toString(36); };
const SMART_AMB = [["VERDI ANNA", "12/03/1960", 66], ["NERI LUIGI", "07/07/1957", 69], ["GIALLI SARA", "03/03/2000", 26]];
function smartPagina(u) {
  const sel = new URL(u).searchParams.get("PAZIENTI_FILTRO") === "TRI" ? "TRI" : "AMB";
  const righe = sel === "TRI" ? [["MARINI ADA", "08/08/1988", 38]] : SMART_AMB;
  const scheda = (k, nome, n) => `<a class="${k === sel ? "shiny-button-selected" : "shiny-button"}" href="?MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=${k}">${nome} (${n})</a>`;
  const d = new Date(Date.now() - 30 * 60e3), p2 = (n) => String(n).padStart(2, "0");
  const arrivo = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return `<html><head><title>Pronto Soccorso</title></head><body><table class="AFCHeaderTable"><tr><td>OSPEDALE ESEMPIO</td></tr></table>
    ${scheda("TRI", "Triage", 1)}&nbsp;${scheda("AMB", "Ambulatorio", SMART_AMB.length)}
    <table><form method="post" name="PazientiFiltro" action="menuPsoSmart.do?ccsForm=PazientiFiltro:Edit&amp;MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=${sel}"></form>
      <tr><td><select class="AFCSelect" name="s_PERCORSO"><option selected value="">tutti</option><option value="1">AREA ALTA INTENSITA'</option></select></td></tr></table>
    <table class="AFCFormTABLE">${righe.map(([nome, nato, eta]) => `<tr><td class="AFCDataTD"></td><td class="AFCDataTD">2026/0001</td>
      <td class="AFCDataTD"><div class="myLinguetta"><table><tr><td title="VERDE"><strong>${nome}</strong><br>${nato}(${eta})</td></tr></table></div></td>
      <td class="AFCDataTD">${arrivo}</td><td class="AFCDataTD">MEDICO ESEMPIO</td><td class="AFCDataTD">AREA ALTA INTENSITA' </td></tr>`).join("")}</table></body></html>`;
}
// L'area della sessione: null, quella dei pazienti; un'altra (RISORSA_ID di
// Imposta), e la pagina di ROSSI arriva come sull'area sbagliata.
const imposta = (id) => { sess.area = id || null; sess.log.push({ t: Date.now(), cosa: "area", area: sess.area }); };
const altraArea = (html) => html.replace(/<a [^>]*title="Richieste [^"]*"[^>]*>[\s\S]*?<\/a>/g, "")
  .replace(/<body>/i, `<body><table class="AFCHeaderTable"><tr><td><font style="font-size: 110%; font-weight: bolder; ">AREA MEDIA - BASSA INTENSITA'</font> ${sess.area}</td></tr></table>`);
function sessioneVede(u) {
  const x = new URL(u), p = x.searchParams, mvpg = p.get("MVPG") || "", rid = p.get("RICHIESTA_ID");
  if (/menuPsoSmart\.do$/.test(x.pathname)) { sess.corrente = null; sess.log.push({ t: Date.now(), cosa: "smart" }); return; }
  if (/RcsStampaEtichetteLIS/.test(x.pathname)) { sess.corrente = rid; sess.log.push({ t: Date.now(), cosa: "etichette", rid }); return; }
  if (/^Rcs/.test(mvpg) && rid && !p.get("Insert")) sess.corrente = rid;
}
const paginaOra = (mock, u, rid) => {
  const l = new URL(u);
  for (const k of ["Insert", "PRESTAZIONE", "BRANCA", "ccsForm", "toPG"]) l.searchParams.delete(k);
  l.searchParams.set("MVPG", "RcsRichiestaPrestazioniRicercaErogatore");
  const out = mock.handle({ method: "GET", url: l.href });
  const html = Buffer.from(out.body).toString("latin1")
    .replace(/<\/body>/i, `<script language="JavaScript">alert("ORA-20965: AMB_RICHIESTA: Progressivo richiesta${rid}-1 gi¿¿ utilizzato");</script></body>`);
  return { ...out, body: Buffer.from(html, "latin1") };
};
let lento = 0;
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 768 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
});
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 })); } catch { /* niente */ }
  try {
    const lab = JSON.stringify({ ris: [], ref: ["aaaa1111-0000-0000-0000-000000000001", "bbbb2222-0000-0000-0000-000000000002"], rich: [] });
    localStorage.setItem("psassist:autoCarica.v1", JSON.stringify({ 999001: { ts: Date.now(), lab, parz: Date.now() }, 999002: { ts: Date.now(), lab, parz: Date.now() } }));
  } catch { /* niente */ }
});
await ctx.route(`${ORIGIN}/**`, async (r) => {
  const req = r.request();
  const u = req.url();
  // la lista smart: una pagina qualunque della stessa sessione
  if (/menuPsoSmart\.do/.test(u)) {
    sessioneVede(u);
    if (sess.smartVera) {
      if (sess.smartLenta) await sospendi(sess.smartLenta);
      return r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(smartPagina(u), "latin1") }).catch(() => {});
    }
    return r.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: "<html><body><p>Lista smart</p></body></html>" }).catch(() => {});
  }
  // una scheda che si blocca appena nata (il suo content script non risponde più)
  if (/MVPG=PsoBloccata/.test(u)) {
    return r.fulfill({ status: 200, headers: { "content-type": "text/html" },
      body: "<html><body><p>Bloccata</p><script>setTimeout(() => { const t = Date.now(); while (Date.now() - t < 45000); }, 1000);</script></body></html>" }).catch(() => {});
  }
  // Imposta → Conferma: l'area cambia per tutta la sessione
  if (req.method() === "POST" && /\/menuPso\.do\?/.test(u) && /ccsForm=RisorsaImposta/.test(u)) {
    imposta(new URLSearchParams(req.postData() || "").get("RISORSA_ID"));
    return r.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: "<html><body><p>Pazienti</p></body></html>" }).catch(() => {});
  }
  const mock = quale(u);
  const p = new URL(u).searchParams;
  if (p.get("Insert") === "Inserisci") {
    const rid = p.get("RICHIESTA_ID");
    sess.log.push({ t: Date.now(), cosa: "insert", rid, code: p.get("PRESTAZIONE") });
    if (lento) await sospendi(lento);
    const forza = sess.forzaOra && sess.forzaOra(p);
    if (forza || rid !== sess.corrente) {
      sess.ora++;
      sess.log.push({ t: Date.now(), cosa: "ORA", rid, code: p.get("PRESTAZIONE") });
      const out = paginaOra(mock, u, rid);
      return r.fulfill({ status: out.status, headers: out.headers, body: out.body }).catch(() => {});
    }
  } else sessioneVede(u);
  if (req.method() === "POST" && /^Prestazioni/.test(p.get("ccsForm") || "")) sess.log.push({ t: Date.now(), cosa: "conferma" });
  if (/RcsStampaEtichetteLISHMIMU|jasperservlet/.test(u)) sess.log.push({ t: Date.now(), cosa: "pdf", rid: p.get("RICHIESTA_ID") });
  if (req.method() === "POST" && /^RICHIESTACrea/.test(p.get("ccsForm") || "")) sess.log.push({ t: Date.now(), cosa: "crea", ep: p.get("EPISODIO_ID") });
  let out = mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) {
    const dove = new URL(out.headers.location, u).href;
    sessioneVede(dove);
    out = mock.handle({ method: "GET", url: dove });
  }
  if (req.method() === "POST" && /^Prestazioni/.test(p.get("ccsForm") || "") && sess.dopoConferma) sess.dopoConferma(mock, p);
  if (sess.area && mock === A && req.method() === "GET" && p.get("MVPG") === "PsoEpisodioClinicoAmbulatorio" && /html/.test((out.headers || {})["content-type"] || "")) {
    sess.log.push({ t: Date.now(), cosa: "paziente", area: sess.area });
    out = { ...out, body: Buffer.from(altraArea(Buffer.from(out.body).toString("latin1")), "latin1") };
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa intanto */ }
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });

const ordini = () => sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => o.ordini || []));
const conferme = (m) => m.state.requests.filter((q) => q.method === "POST" && (q.params.ccsForm || "").startsWith("Prestazioni"));
const inviati = (m) => m.state.requests.filter((q) => q.params.Insert === "Inserisci");
const striscia = async (page, re, timeout = 30000) => {
  const h = await page.waitForFunction((src) => {
    const r = document.getElementById("psassist-host")?.shadowRoot;
    const t = (r?.querySelector(".pill.run")?.innerText || r?.querySelector(".gchip[data-riga]")?.dataset.riga || "").replace(/\s+/g, " ").trim();
    // un ordine finito di un altro paziente è un segno nella pill: un tocco lo apre (lo farebbe il medico)
    if (!t) { r?.querySelector("#expand .segno")?.click(); r?.querySelector("#gchipsegno")?.click(); }
    return new RegExp(src).test(t) ? t : false;
  }, re.source, { timeout });
  return h.jsonValue();
};
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) if (await fn()) return true;
  return false;
}
async function ordina(page, esami, { quesito = "dolore toracico" } = {}) {
  if (!(await $panel(page, ".card").count())) {
    await $panel(page, "#expand").click();
    await page.waitForSelector("#psassist-host .card", { timeout: 8000 });
  }
  if (!(await $panel(page, "#q").count())) await $panel(page, '[data-seg="richieste"]').click();
  await $panel(page, "#q").fill(quesito);
  for (const e of esami) await $panel(page, `.opt[title*="${e}"]`).click();
  await $panel(page, "#goconfirm").click();
}
const nuovaPagina = (timeout = 15000) => ctx.waitForEvent("page", { timeout }).catch(() => null);
async function suPagina(p, url) {
  await p.goto(url);
  await p.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
}
const SMART = `${ORIGIN}/sa4pso/restrict/menuPsoSmart.do?MVPG=PsoPazientiSmart&PAZIENTI_FILTRO=TRIAGE`;
// la lista smart conosciuta, letta 11 minuti fa: da rileggere per l'iPhone (al più ogni 2 minuti); il
// gestionale che si apre non la rilegge da sé — l'ha già letta
const smartDaRileggere = (p) => p.evaluate((u) => {
  localStorage.setItem("psassist:smart.url.v1", JSON.stringify({ url: u, ts: Date.now() }));
  localStorage.setItem("psassist:smart.sync.v1", JSON.stringify({ ts: Date.now() - 11 * 60e3, fine: Date.now() - 11 * 60e3, esito: "ok", n: 0, letta: Date.now() - 11 * 60e3 }));
}, SMART);
const nienteSmart = (p) => p.evaluate(() => { localStorage.removeItem("psassist:smart.url.v1"); });
// l'app aperta sull'iPhone: il PC rilegge la smart (non più a tempo) — il comando come lo manda il ponte
const telApre = () => sw.evaluate(() => ponteSuScheda("triage", { rileggi: true }));

let doc = await ctx.newPage();
// una prova dopo l'altra: niente ordini aperti, e la scheda del medico nuova
async function daCapo() {
  // (e le Conferme già rifatte: ogni prova ha un simulatore nuovo, con gli stessi numeri di richiesta)
  await sw.evaluate(() => Promise.all([chrome.storage.session.set({ ordini: [] }), chrome.storage.session.remove("ordiniRiconfermate"), typeof motoreScrivi === "function" && motoreScrivi(null)]));
  for (const p of ctx.pages()) await p.close().catch(() => {});
  doc = await ctx.newPage();
}
const SOLO = (process.argv[2] || "").toLowerCase();
const prova = (t) => {
  if (SOLO && !t.toLowerCase().includes(SOLO)) return false;
  console.log("\nsessione: " + t); nuovi();
  Object.assign(sess, { corrente: null, log: [], ora: 0, forzaOra: null, area: null, dopoConferma: null, smartVera: false, smartLenta: 0 });
  return true;
};
const ESAMI = ["CREATININEMIA", "EMOCROMOCITOMETRICO", "TROPONINA"];   // tre esami POC: un erogatore, una richiesta
const DUE = ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"];   // POC (due) e Urgenze: due richieste, due ordini

// ---- 1. a metà ordine, nient'altro nella sessione ------------------------
if (prova("a metà ordine la lista smart aspetta: POC e Urgenze, due ordini, entrano tutti")) {
  lento = 900;
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  const nasce = nuovaPagina();
  await ordina(doc, DUE);
  const w = await nasce;
  check(!!w, "l'ordine va in una scheda di sottofondo");
  await finche(() => sess.log.some((x) => x.cosa === "insert"), 20000);
  // il medico va su BIANCHI, la smart è da rileggere, e intanto apre l'app sull'iPhone: niente, l'ordine lavora
  await smartDaRileggere(doc);
  await suPagina(doc, B.patientUrl);
  const durante = await telApre();
  check(durante?.ok && durante.dati?.rilegge === false, `l'iPhone aperto mentre il motore lavora: la smart non si rilegge (got ${JSON.stringify(durante && durante.dati && { rilegge: durante.dati.rilegge })})`);
  await finche(async () => conferme(A).length > 1 || (await ordini()).some((x) => x.stato === "errore"), 90000);
  await striscia(doc, /ROSSI MARIO.*(Confermata|Etichette|Stampa|Errore)/, 30000).catch(() => "");
  const ins = inviati(A).map((q) => q.params.PRESTAZIONE).sort();
  check(sess.ora === 0, `nessun «ORA-20965»: la richiesta della sessione non è cambiata sotto il motore (got ${sess.ora})`);
  check(ins.length === 3 && conferme(A).length === 2 && Object.keys(A.state.richieste).length === 2 && !A.state.rifiutati.length,
    `tre esami su due erogatori: due richieste, due conferme, nessun esame respinto (got ${ins.join(",")} · ${conferme(A).length} conferme)`);
  // dal primo inserimento alla conferma (o all'ultima risposta del motore) il motore lavora
  const primo = sess.log.find((x) => x.cosa === "insert");
  const fine = (sess.log.find((x) => x.cosa === "conferma") || [...sess.log].reverse().find((x) => x.cosa === "insert" || x.cosa === "ORA")).t + lento;
  const smart = sess.log.filter((x) => x.cosa === "smart");
  check(!smart.some((x) => x.t >= primo.t && x.t <= fine), `la lista smart non si legge mentre il motore inserisce e conferma (smart: ${smart.map((x) => x.t - primo.t).join(", ") || "nessuna"} ms dal primo inserimento)`);
  // …e dopo, a ordine finito, riaprendo l'app sì
  await finche(async () => !(await ordini()).some((x) => ["corre", "coda"].includes(x.stato)), 30000);
  await telApre();
  await finche(() => sess.log.some((x) => x.cosa === "smart"), 30000);
  check(sess.log.some((x) => x.cosa === "smart"), "finito l'ordine, riaprendo l'iPhone la lista smart si rilegge");
  await nienteSmart(doc);
  lento = 0;
}

// ---- 1b. un carrello aperto in una scheda: la lista smart aspetta -------
// Il medico ordina a mano (la pagina di creazione di una richiesta, il carrello): la smart, che cambia la
// richiesta «corrente» della sessione, non si legge — né aprendo l'iPhone né col gestionale appena aperto.
if (prova("un carrello aperto in una scheda: la lista smart non si legge")) {
  await daCapo();
  // (la smart della prova di prima finisce il suo giro di schede, dietro, e nessun ordine lavora più: qui decide il carrello)
  await finche(async () => !(await sw.evaluate(() => sottoVive().then((l) => l.some(([, s]) => s.cosa === "smart")))), 45000);
  await finche(() => sw.evaluate(() => ordLeggi().then((l) => !motoreAlLavoro(l))), 45000);
  await suPagina(doc, A.patientUrl);
  const crea = await doc.evaluate(() => document.querySelector('a[title="Richieste Laboratorio"]')?.href || "");
  const carrello = await ctx.newPage();
  await carrello.goto(crea);
  await carrello.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 }).catch(() => {});
  await smartDaRileggere(doc);
  sess.log.length = 0;
  const durante = await telApre();
  await sospendi(1500);
  const sync = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:smart.sync.v1") || "null"));
  check(/PsoRichiestaCreaRcs/.test(crea) && durante?.ok && durante.dati?.rilegge === false && !sess.log.some((x) => x.cosa === "smart"),
    `con la creazione di una richiesta aperta in una scheda, aprendo l'iPhone la smart non si legge (got ${JSON.stringify({ rilegge: durante?.dati?.rilegge, esito: sync?.esito, letta: sess.log.filter((x) => x.cosa === "smart").length })})`);
  await carrello.close();
  await smartDaRileggere(doc);
  await telApre();
  check(await finche(() => sess.log.some((x) => x.cosa === "smart"), 15000), "chiuso il carrello, riaprendo l'iPhone la smart si legge");
  await nienteSmart(doc);
}

// ---- 1c. la smart a metà del suo giro -------------------------------------
// I controlli della partenza valgono prima di OGNI salto da una scheda della smart all'altra: un
// carrello aperto a mano fra l'Ambulatorio e il Triage la ferma lì (con quello che ha letto, mai
// «intera»: nessuno dimesso); un ordine partito mentre lei legge la aspetta. E il motore di una
// scheda che parte aspetta anche lui.
const smartViva = () => sw.evaluate(() => sottoVive().then((l) => l.some(([, s]) => s.cosa === "smart")));
const seminaNoti = (p) => p.evaluate(({ noti }) => {
  const l = JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").filter((x) => !String(x.ep).startsWith("s"));
  for (const [i, [name, nato]] of noti.entries()) l.push({ ep: "s" + i, name, url: "", ts: Date.now() - 60e3, pk: "", nato });
  localStorage.setItem("psassist:patients.v1", JSON.stringify(l));
}, { noti: [...SMART_AMB, ["BIANCO PIO", "01/01/1950"]].map(([n, d]) => [n, impronta(d)]) });
const archiviati = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]").filter((x) => x.arch).map((x) => x.name));
if (prova("la smart a metà giro: un carrello aperto fra due schede la ferma, nessuno dimesso")) {
  await daCapo();
  await finche(async () => !(await smartViva()), 45000);
  await suPagina(doc, A.patientUrl);
  const crea = await doc.evaluate(() => document.querySelector('a[title="Richieste Laboratorio"]')?.href || "");
  await seminaNoti(doc);
  Object.assign(sess, { smartVera: true, smartLenta: 2500 });
  await smartDaRileggere(doc);
  sess.log.length = 0;
  await telApre();
  // la prima scheda della smart (Ambulatorio) arriva lenta: intanto il medico apre a mano «Richieste Laboratorio»
  await finche(() => sess.log.some((x) => x.cosa === "smart"), 15000);
  const carrello = await ctx.newPage();
  await carrello.goto(crea);
  await finche(async () => !(await smartViva()), 20000);
  const sync = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:smart.sync.v1") || "null"));
  const lette = sess.log.filter((x) => x.cosa === "smart").length, arch = await archiviati(doc);
  check(lette === 1 && sync?.esito === "carrello aperto" && sync.intera === false,
    `col carrello aperto dopo la prima scheda, la smart non salta al Triage e si ferma lì (got ${JSON.stringify({ schede: lette, esito: sync?.esito, intera: sync?.intera })})`);
  check(!arch.length, `e nessuno è dimesso da quella lettura a metà (got ${arch.join(", ") || "nessuno"})`);
  await carrello.close();
  Object.assign(sess, { smartVera: false, smartLenta: 0 });
  await nienteSmart(doc);
}
if (prova("la smart a metà giro: un ordine partito mentre legge la aspetta")) {
  await daCapo();
  await finche(async () => !(await smartViva()), 45000);
  await suPagina(doc, A.patientUrl);
  await seminaNoti(doc);
  Object.assign(sess, { smartVera: true, smartLenta: 2500 });
  await smartDaRileggere(doc);
  sess.log.length = 0;
  await telApre();
  await finche(() => sess.log.some((x) => x.cosa === "smart"), 15000);
  await ordina(doc, ESAMI);
  // finché la smart legge, l'ordine resta in coda: nessuna sua scheda, nessuna pagina
  // (smart e ordini letti insieme, dalla stessa fotografia della memoria)
  const foto = () => sw.evaluate(() => chrome.storage.session.get(null).then((o) => ({
    viva: Object.entries(o).some(([k, s]) => k.startsWith("sotto:") && inCorso(s) && s.cosa === "smart"), ordini: o.ordini || [] })));
  let presto = null;
  for (const t0 = Date.now(); Date.now() - t0 < 20000;) {
    const { viva, ordini: l } = await foto();
    if (!viva) break;
    const x = l.find((y) => y.stato !== "coda");
    if (x) { presto = x.stato; break; }
    await sospendi(100);
  }
  const fineSmart = Date.now();
  check(presto === null, `l'ordine non parte mentre la smart legge (got ${presto || "in coda"})`);
  await finche(async () => conferme(A).length > 0 || (await ordini()).some((x) => x.stato === "errore"), 60000);
  const sync = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:smart.sync.v1") || "null"));
  const lette = sess.log.filter((x) => x.cosa === "smart"), ins = sess.log.filter((x) => x.cosa === "insert");
  check(lette.length === 1 && sync?.esito === "ordine in corso" && sync.intera === false && !(await archiviati(doc)).length,
    `la smart, con l'ordine che la aspetta, non salta al Triage: si ferma, nessuno dimesso (got ${JSON.stringify({ schede: lette.length, esito: sync?.esito, intera: sync?.intera })})`);
  check(sess.ora === 0 && ins.length === 3 && conferme(A).length === 1 && ins.every((x) => x.t >= fineSmart - 200),
    `poi l'ordine parte: tre esami, una Conferma, nessun «ORA-» (got ${ins.length} inserimenti · ${conferme(A).length} conferme · ${sess.ora} ORA)`);
  Object.assign(sess, { smartVera: false, smartLenta: 0 });
  await nienteSmart(doc);
}
if (prova("la smart a metà giro: il motore di una scheda la aspetta")) {
  await daCapo();
  // il motore di una scheda (un giro della scheda del medico) che parte mentre la smart legge: aspetta;
  // quello che lo tiene già (il suo rinnovo) no
  const m = await sw.evaluate(async () => {
    const chiedi = (tab, id) => new Promise((ok) => ordMessaggio({ t: "ordineMotore", id }, { tab: { id: tab }, url: "https://smarthealth.multimedica.it/sa4pso/restrict/menuPso.do" }, ok));
    await chrome.storage.session.set({ "sotto:987654": { opener: 1, cosa: "smart", ts: Date.now(), esito: "attesa" } });
    const nuovo = await chiedi(4242, "prova-smart");
    await motoreScrivi({ tab: 4343, id: "prova-tiene", scade: Date.now() + 15e3 });
    const rinnovo = await chiedi(4343, "prova-tiene");
    await motoreScrivi(null);
    await chrome.storage.session.remove("sotto:987654");
    const dopo = await chiedi(4242, "prova-smart");
    await motoreScrivi(null);
    return { nuovo, rinnovo, dopo };
  });
  check(m.nuovo?.occupato === true && m.rinnovo?.ok === true && m.dopo?.ok === true,
    `il motore di una scheda aspetta la smart che legge; chi lo tiene lo rinnova; finita la smart, parte (got ${JSON.stringify(m)})`);
}

// ---- 2. ORA- nella risposta: la richiesta si rifà da capo, una volta ------
const errori = async () => (await sw.evaluate(() => chrome.storage.local.get("errori.v1")))["errori.v1"] || [];
const sorvegliate = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("psassist:daConfermare.v1") || "[]"));
if (prova("ORA- nella risposta all'inserimento: la richiesta persa si rifà da capo, una volta, e si conferma la nuova")) {
  await daCapo();
  lento = 0;
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  await sw.evaluate(() => chrome.storage.local.remove("errori.v1"));
  // il secondo inserimento risponde con l'avviso del database, una volta
  let n = 0;
  sess.forzaOra = () => ++n === 2;
  const nasce = nuovaPagina();
  await ordina(doc, ESAMI);
  await nasce;
  await suPagina(doc, B.patientUrl);
  await finche(() => conferme(A).length > 0 || sess.log.filter((x) => x.cosa === "ORA").length > 1, 60000);
  const vista = await striscia(doc, /ROSSI MARIO.*(Confermata|Etichette|Stampa|Errore)/, 30000).catch(() => "");
  const [r1, r2] = Object.keys(A.state.richieste);
  const crea = sess.log.filter((x) => x.cosa === "crea");
  const iOra = sess.log.findIndex((x) => x.cosa === "ORA");
  check(Object.keys(A.state.richieste).length === 2 && crea.length === 2, `una richiesta nuova, con «Crea» di nuovo (got ${Object.keys(A.state.richieste).length} richieste, ${crea.length} Crea)`);
  check(iOra >= 0 && sess.log[iOra].rid === r1 && !sess.log.slice(iOra + 1).some((x) => x.cosa === "insert" && x.rid === r1),
    "nella richiesta che ha risposto «ORA-» niente più mandato");
  check(conferme(A).length === 1 && conferme(A)[0].params.RICHIESTA_ID === r2 && A.state.richieste[r2].confirmed && !A.state.richieste[r1].confirmed,
    `confermata la nuova, una volta; quella persa mai (got ${conferme(A).map((q) => q.params.RICHIESTA_ID).join(",") || "nessuna conferma"})`);
  check(inviati(A).filter((q) => q.params.RICHIESTA_ID === r2).length === ESAMI.length && A.state.richieste[r2].cart.size === ESAMI.length,
    `con tutti gli esami, ognuno una volta (got ${inviati(A).filter((q) => q.params.RICHIESTA_ID === r2).map((q) => q.params.PRESTAZIONE).join(",")})`);
  check(!/Errore|Non confermata/.test(vista), `la striscia del medico non dice errore (got: ${vista || "niente"})`);
  check(!(await sorvegliate(doc)).some((x) => x.rid === r1), "nessun promemoria «da confermare» per la richiesta lasciata");
  const cerca = async () => (await errori()).find((x) => x.tipo === "ordine" && /rifatta da capo, riuscita/.test(x.dati?.motivo || ""));
  await finche(cerca, 15000);
  const e = await cerca();
  const passi = e?.dati?.traccia?.passi || [];
  check(!!e && passi.some((p) => /ORA-20965/.test(p.avviso || "")) && passi.some((p) => p.m === "rifaccio"),
    "nel registro degli errori, con la traccia di tutte e due: l'avviso e la richiesta rifatta");
  await $panel(doc, STOP).click().catch(() => {});
}
if (prova("ORA- due volte: la richiesta rifatta perde il carrello anche lei, il giro si ferma e lo dice")) {
  await daCapo();
  lento = 0;
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  await sw.evaluate(() => chrome.storage.local.remove("errori.v1"));
  // il secondo inserimento di ogni richiesta (il 2° e il 4°) risponde con l'avviso del database
  let n = 0;
  sess.forzaOra = () => [2, 4].includes(++n);
  const t0 = Date.now();
  const nasce = nuovaPagina();
  await ordina(doc, ESAMI);
  await nasce;
  await suPagina(doc, B.patientUrl);
  const rossa = await striscia(doc, /ROSSI MARIO.*(non mandat|Errore)/, 45000).catch(() => "");
  const dt = Date.now() - t0;
  // la striscia rossa comincia da che cosa fare; che cosa ha risposto il gestionale sta nel resoconto che «apri il carrello» apre
  const avviso = (await ordini()).find((x) => x.stato === "errore");
  check(/non mandat/.test(rossa) && /apri il carrello/.test(rossa) && /Il gestionale ha risposto: ORA-20965/.test(JSON.stringify(avviso?.consegna?.avviso?.testo || "")),
    `la striscia del medico dice che cosa fare, e il resoconto che cosa ha risposto il gestionale (got: ${rossa || "niente"})`);
  check(dt < 25000, `subito, senza le riletture di mezzo minuto (got ${Math.round(dt / 1000)} s)`);
  const ins = sess.log.filter((x) => x.cosa === "insert");
  const ore = sess.log.filter((x) => x.cosa === "ORA");
  const iUltima = sess.log.lastIndexOf(ore[ore.length - 1]);
  check(ins.length === 4 && ore.length === 2 && sess.log.filter((x) => x.cosa === "crea").length === 2 && !sess.log.slice(iUltima + 1).some((x) => x.cosa === "insert"),
    `rifatta una volta sola, e dopo il secondo avviso niente altro mandato (got ${ins.length} inserimenti, ${ore.length} avvisi)`);
  check(conferme(A).length === 0, "e niente confermato");
  check(!(await sorvegliate(doc)).length, "nessun promemoria «da confermare»");
  const cerca = async () => (await errori()).find((x) => x.tipo === "ordine" && /Il gestionale ha risposto: ORA-20965/.test(x.dati?.motivo || ""));
  await finche(cerca, 15000);
  const e = await cerca();
  check(!!e && (e.dati.traccia?.passi || []).filter((p) => /ORA-20965/.test(p.avviso || "")).length === 2, "nel registro degli errori, con la traccia e i due avvisi");
  check(!/non risulta nel carrello/.test(JSON.stringify(e || {})), "e non «non risulta nel carrello»");
  await $panel(doc, STOP).click().catch(() => {});
}

// ---- 2b. dopo la Conferma il medico cambia area -------------------------
// (registrazione vera, 3.85.0: la scheda dell'ordine preme Conferma, il
// gestionale risponde con la sua pagina delle etichette LIS, poi PsoEpisodio,
// poi il paziente; intanto il medico, nella sua scheda, passa a un'altra area
// — Imposta → Conferma, per tutta la sessione.) La prova è la pagina del
// paziente che elenca i fogli della richiesta: sull'altra area perde le
// Richieste, non quell'elenco, e la prova regge. La pagina delle etichette
// NON è una prova: il gestionale la mostra uguale anche dopo una Conferma che
// non ha registrato (lì la POST durava 0,7 s invece di 3–14, e la richiesta
// è comparsa solo dopo la Conferma del medico). Allora «Non confermata»,
// niente stampato, nessuna seconda Conferma — e prima di rifarla si guardano
// le sue richieste, non «premi tu Conferma» come se niente fosse.
const chiesti = (m, re) => m.state.requests.filter((q) => re.test(q.url)).length;
const param = (u, k) => { try { return new URL(u, ORIGIN).searchParams.get(k); } catch { return null; } };
if (prova("dopo la Conferma il medico cambia area: provata lo stesso; se il gestionale non l'ha registrata, prima di rifarla le sue richieste")) {
  for (const registrata of [true, false]) {
    const come = registrata ? "registrata" : "non registrata (le etichette LIS arrivano lo stesso)";
    await daCapo();
    A = createMock({ dopoConferma: 600 });
    Object.assign(sess, { corrente: null, log: [], ora: 0, forzaOra: null, area: null });
    await suPagina(doc, A.patientUrl);
    await nienteSmart(doc);
    // la Conferma arriva al gestionale; subito dopo un'altra scheda cambia l'area
    sess.dopoConferma = (mock, p) => {
      if (mock !== A || sess.area) return;
      if (!registrata) mock.state.richieste[p.get("RICHIESTA_ID")].confirmed = false;
      imposta("00040001P");
    };
    const nasce = nuovaPagina();
    await ordina(doc, ["TROPONINA"]);
    const w = await nasce;
    await suPagina(doc, B.patientUrl);
    const ultima = () => ordini().then((l) => l.find((x) => x.paziente === "ROSSI MARIO" && !["coda", "avvio", "corre"].includes(x.stato)));
    await finche(ultima, 60000);
    const rec = await ultima();
    const rid = Object.keys(A.state.richieste)[0];
    const iArea = sess.log.findIndex((x) => x.cosa === "area"), iPaz = sess.log.findIndex((x) => x.cosa === "paziente");
    check(conferme(A).length === 1 && A.state.passaggi.join(" → ") === "RcsStampaEtichetteLIS → PsoEpisodio" && iArea >= 0 && iPaz > iArea,
      `${come}: una Conferma, le etichette LIS e PsoEpisodio, poi la pagina del paziente letta sull'altra area (got ${conferme(A).length} conferme · ${A.state.passaggi.join(" → ") || "niente"} · area ${iArea} paziente ${iPaz})`);
    if (registrata) {
      const et = (rec?.stampa?.jobs || []).filter((j) => /RcsStampaEtichetteLISHMIMU\.do\?RICHIESTA_ID=/.test(j.url || "") && param(j.url, "RICHIESTA_ID") === rid);
      check(rec?.stato === "stampa" && rec.pubblico?.titolo === "Confermata" && et.length === 1,
        `registrata: «Confermata», le etichette di quella richiesta pronte una volta (got ${JSON.stringify(rec && [rec.stato, rec.pubblico?.titolo, rec.pubblico?.testo, (rec.stampa?.jobs || []).length])})`);
    } else {
      // (il carrello ha ancora l'esame e la sua Conferma: il gestionale non l'ha presa)
      const v = rec?.vista || {};
      check(rec?.stato === "avviso" && v.tag === "Non partita" && v.tono === "err" && v.riconferma && !rec.stampa,
        `non registrata: «Non partita», rossa, «Conferma di nuovo», niente da stampare (got ${JSON.stringify(rec && [rec.stato, v.tag, v.tono, v.testo, !!rec.stampa])})`);
      check(/RICHIESTA_ID=/.test(rec?.consegna?.url || "") && param(rec.consegna.url, "RICHIESTA_ID") === rid, "con il carrello della sua richiesta");
      await sospendi(3000);
      check(conferme(A).length === 1 && !A.state.richieste[rid].confirmed && chiesti(A, /RcsStampaEtichetteLISHMIMU|jasperservlet/) === 0,
        `nessuna seconda Conferma, nessun foglio chiesto al gestionale (got ${conferme(A).length} conferme · ${chiesti(A, /RcsStampaEtichetteLISHMIMU|jasperservlet/)} fogli)`);
      check((await sorvegliate(doc)).some((x) => x.rid === rid), "e la richiesta resta sorvegliata: se compare, il promemoria se ne va da sé");
    }
    await w.close().catch(() => {});
    sess.dopoConferma = null;
  }
}

// ---- 2c. la Conferma che il gestionale ignora ------------------------------
// (3.85, registrazioni vere: la POST torna in 0,4–0,7 s con la pagina delle
// etichette LIS — identica a quella buona —, la richiesta non è registrata, e
// il carrello ha ancora l'esame col suo bottone Conferma.) Lo si dice in pochi
// secondi, «Non partita»; un tocco su «Conferma di nuovo» la rifà UNA volta,
// sul carrello, con la stessa prova; senza tocco, mai. E se il carrello non ha
// più la sua Conferma non è «non partita»: le attese, poi «da controllare».
const ignoraLaPrima = () => {
  let n = 0;
  sess.dopoConferma = (mock, p) => { if (mock === A && n++ === 0) mock.state.richieste[p.get("RICHIESTA_ID")].confirmed = false; };
};
if (prova("la Conferma che il gestionale ignora: «Non partita» in pochi secondi; un tocco, una Conferma sola in più, provata")) {
  await daCapo();
  A = createMock({ dopoConferma: 300 });
  Object.assign(sess, { corrente: null, log: [], ora: 0, forzaOra: null, area: null });
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  ignoraLaPrima();
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  await suPagina(doc, B.patientUrl);
  await finche(() => conferme(A).length > 0, 40000);
  const tC = Date.now();
  const vista = await striscia(doc, /ROSSI MARIO.*Non partita/, 20000).catch(() => "");
  const dt = Date.now() - tC;
  const rid = Object.keys(A.state.richieste)[0];
  check(/Conferma di nuovo/.test(vista) && dt < 5000, `«Non partita · Conferma di nuovo» in pochi secondi, senza le attese (got «${vista}» dopo ${dt} ms)`);
  check(!A.state.richieste[rid].confirmed && chiesti(A, /RcsStampaEtichetteLISHMIMU|jasperservlet/) === 0, "niente stampato");
  // senza il tocco: mai una seconda Conferma
  await sospendi(6000);
  check(conferme(A).length === 1, `senza il tocco, nessuna seconda Conferma (got ${conferme(A).length})`);
  // il tocco
  await $panel(doc, AZIONE).click();
  await finche(async () => conferme(A).length > 1 && (await ordini()).some((x) => x.paziente === "ROSSI MARIO" && x.stato === "stampa"), 40000);
  const l = await ordini();
  const rec = l.find((x) => x.paziente === "ROSSI MARIO" && x.stato === "stampa");
  const et = (rec?.stampa?.jobs || []).filter((j) => /RcsStampaEtichetteLISHMIMU\.do\?RICHIESTA_ID=/.test(j.url || "") && param(j.url, "RICHIESTA_ID") === rid);
  check(conferme(A).length === 2 && conferme(A).every((q) => q.params.RICHIESTA_ID === rid) && A.state.richieste[rid].confirmed,
    `il tocco: una Conferma in più, sulla stessa richiesta, e il gestionale la prende (got ${conferme(A).length} conferme)`);
  check(rec?.pubblico?.titolo === "Confermata" && et.length === 1, `provata: «Confermata», le etichette pronte una volta (got ${JSON.stringify(rec && [rec.pubblico?.titolo, et.length])})`);
  check(inviati(A).length === 1, `nessun esame rimandato (got ${inviati(A).length} invii)`);
  // un secondo tocco (la stessa richiesta): niente
  const r2 = await sw.evaluate((id) => new Promise((res) => {
    chrome.tabs.query({}).then((ts) => { const t = ts.find((x) => /EPISODIO_ID=999002/.test(x.url || "")); ordMessaggio({ t: "ordineRiconferma", id }, { tab: t, url: t.url }, res); });
  }), rec.id.replace(/c$/, ""));
  await sospendi(2000);
  check(!(r2 && r2.ok) && conferme(A).length === 2, `rifatta una volta: un secondo «Conferma di nuovo» non parte (got ${JSON.stringify(r2 && r2.ok)} · ${conferme(A).length})`);
  sess.dopoConferma = null;
}
if (prova("la Conferma rifatta che il gestionale ignora ancora: «Non partita», il carrello — mai una terza")) {
  await daCapo();
  A = createMock({ dopoConferma: 300 });
  Object.assign(sess, { corrente: null, log: [], ora: 0, forzaOra: null, area: null });
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  sess.dopoConferma = (mock, p) => { if (mock === A) mock.state.richieste[p.get("RICHIESTA_ID")].confirmed = false; };
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  await suPagina(doc, B.patientUrl);
  await striscia(doc, /ROSSI MARIO.*Non partita.*Conferma di nuovo/, 40000).catch(() => "");
  await $panel(doc, AZIONE).click();
  await finche(() => conferme(A).length > 1, 30000);
  const vista = await striscia(doc, /ROSSI MARIO.*Non partita/, 20000).catch(() => "");
  const rec = (await ordini()).find((x) => x.paziente === "ROSSI MARIO" && /c$/.test(x.id));
  check(/apri il carrello/.test(vista) && !(rec?.vista?.riconferma) && /RICHIESTA_ID=/.test(rec?.consegna?.url || ""),
    `la seconda non presa: «Non partita · apri il carrello», niente «Conferma di nuovo» (got «${vista}»)`);
  await sospendi(5000);
  check(conferme(A).length === 2, `mai una terza Conferma (got ${conferme(A).length})`);
  sess.dopoConferma = null;
}
if (prova("la Conferma ignorata ma il carrello senza la sua Conferma: le attese, poi da controllare — mai «Non partita»")) {
  await daCapo();
  A = createMock({ dopoConferma: 300 });
  Object.assign(sess, { corrente: null, log: [], ora: 0, forzaOra: null, area: null });
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  ignoraLaPrima();
  // dopo la Conferma il carrello si mostra senza i suoi bottoni Conferma
  const senza = (route) => route.request().method() === "GET" && conferme(A).length > 0 && /RcsRichiestaPrestazioniRicercaErogatore/.test(route.request().url());
  const togliConferma = async (r) => {
    if (!senza(r)) return r.fallback();
    const out = A.handle({ method: "GET", url: r.request().url() });
    const html = Buffer.from(out.body).toString("latin1").replace(/<input type="submit" name="Update1?" value="Conferma">/g, "");
    return r.fulfill({ status: out.status, headers: out.headers, body: Buffer.from(html, "latin1") }).catch(() => {});
  };
  await ctx.route(`${ORIGIN}/**`, togliConferma);
  const nasce = nuovaPagina();
  await ordina(doc, ["TROPONINA"]);
  await nasce;
  await suPagina(doc, B.patientUrl);
  const ultima = () => ordini().then((l) => l.find((x) => x.paziente === "ROSSI MARIO" && !["coda", "avvio", "corre"].includes(x.stato)));
  await finche(ultima, 60000);
  const rec = await ultima();
  const v = rec?.vista || {};
  check(rec?.stato === "avviso" && v.tag === "Da controllare" && /guarda le sue richieste/.test(v.testo || "") && !v.riconferma && v.tono === "warn",
    `carrello senza Conferma: ambra, «Da controllare», mai «Non partita» né «Conferma di nuovo» (got ${JSON.stringify(rec && [rec.stato, v.tag, v.testo, v.tono])})`);
  check(conferme(A).length === 1, "una Conferma sola");
  await ctx.unroute(`${ORIGIN}/**`, togliConferma);
  sess.dopoConferma = null;
}

// ---- 2d. prima le etichette ------------------------------------------------
// Senza la stampa automatica le etichette le stampa la scheda del medico, col
// dialogo. Prima, il secondo ordine dello stesso tocco (Urgenze, dopo il POC)
// partiva subito, e i PDF del primo aspettavano dietro di lui (3,5–8,6 s di
// «Aspetto le etichette…»). Ora la scheda del medico prende tutti i PDF del
// primo, e solo dopo parte il secondo: sempre uno alla volta.
if (prova("prima le etichette: senza la stampa automatica, i PDF del primo ordine prima che parta il secondo")) {
  await daCapo();
  lento = 300;
  await sw.evaluate(() => chrome.storage.local.remove("stampa"));
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  await ordina(doc, DUE);
  await finche(() => conferme(A).length === 2, 90000);
  await doc.waitForSelector("#psassist-print", { state: "attached", timeout: 20000 }).catch(() => {});
  const [r1] = Object.keys(A.state.richieste);
  const crea = sess.log.filter((x) => x.cosa === "crea"), pdf1 = sess.log.filter((x) => x.cosa === "pdf" && x.rid === r1);
  const conf1 = sess.log.find((x) => x.cosa === "conferma");
  check(crea.length === 2 && pdf1.length >= 2 && pdf1.every((x) => x.t < crea[1].t) && conf1.t < crea[1].t,
    `i PDF del primo ordine (etichette e lista) presi prima che nasca la seconda richiesta (got ${pdf1.map((x) => x.t - conf1.t).join(", ")} ms dalla prima Conferma · Crea ${crea[1] ? crea[1].t - conf1.t : "?"} ms)`);
  check(sess.ora === 0 && conferme(A).length === 2, `e tutt'e due confermate, senza «ORA-» (got ${sess.ora})`);
  lento = 0;
}

// ---- 3. mai due motori per un ordine ------------------------------------
if (prova("la scheda d'ordine che ha avuto il piano non si sostituisce mai")) {
  // Il service worker: un ordine «avvio» la cui scheda ha già chiesto chi è
  // (il piano è suo) e intanto è su un'altra origine. Il controllo non ne apre un'altra.
  const r = await sw.evaluate(async () => {
    const t = await chrome.tabs.create({ url: "about:blank", active: false });
    const rec = { id: "prova-doppio", ep: "999001", paziente: "X", n: 1, url: "https://smarthealth.multimedica.it/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=999001",
      opener: null, worker: t.id, consegnata: t.id, stato: "avvio", ts: Date.now() - 10e3, agg: Date.now() - 10e3, vista: null, resto: { mancano: [], controllare: [], nel: [] } };
    await chrome.storage.session.set({ ordini: [rec] });
    const prima = (await chrome.tabs.query({})).length;
    await ordControlla(await ordLeggi());
    const l = await ordLeggi();
    const dopo = (await chrome.tabs.query({})).length;
    const x = l.find((y) => y.id === "prova-doppio");
    await chrome.storage.session.set({ ordini: [] });
    await chrome.tabs.remove(t.id).catch(() => {});
    return { prima, dopo, worker: x && x.worker === t.id, riaperta: !!(x && x.riaperta) };
  });
  check(r.dopo === r.prima && r.worker && !r.riaperta, `consegnato il piano, nessuna seconda scheda (got ${JSON.stringify(r)})`);
  // …e una che il piano non l'ha mai avuto: la vecchia via PRIMA, una sola nuova
  const r2 = await sw.evaluate(async () => {
    const t = await chrome.tabs.create({ url: "about:blank", active: false });
    const rec = { id: "prova-vuota", ep: "999001", paziente: "X", n: 1, url: "https://smarthealth.multimedica.it/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=999001",
      opener: null, worker: t.id, stato: "avvio", ts: Date.now() - 10e3, agg: Date.now() - 10e3, vista: null, resto: { mancano: [], controllare: [], nel: [] } };
    await chrome.storage.session.set({ ordini: [rec] });
    await ordControlla(await ordLeggi());
    const l = await ordLeggi();
    const x = l.find((y) => y.id === "prova-vuota");
    const vecchia = await chrome.tabs.get(t.id).then(() => true, () => false);
    const nuova = x && x.worker != null && x.worker !== t.id;
    if (x && x.worker != null) await chrome.tabs.remove(x.worker).catch(() => {});
    await chrome.storage.session.set({ ordini: [] });
    return { vecchia, nuova, riaperta: !!(x && x.riaperta) };
  });
  check(!r2.vecchia && r2.nuova && r2.riaperta, `mai arrivata sulla pagina e senza piano: chiusa, e al suo posto una sola (got ${JSON.stringify(r2)})`);
}

// ---- 4. un motore nella scheda del medico: gli ordini nuovi in coda ------
// (il giro che la scheda del medico fa da sé, quando la scheda di sottofondo
// non si apre: il service worker lo sa — il motore lo tiene lui — e un ordine
// da un'altra scheda, o dal telefono, aspetta in coda invece di partire in
// mezzo ai suoi inserimenti)
const alPc = (tabId, cmd, args) => sw.evaluate(([id, cmd, args]) => chrome.tabs.sendMessage(id, { t: "ponteEsegui", cmd, args }), [tabId, cmd, args]);
const schedaDi = (ep) => sw.evaluate((ep) => chrome.tabs.query({}).then((l) => l.filter((t) => (t.url || "").includes("EPISODIO_ID=" + ep)).map((t) => t.id)), ep);
if (prova("un giro nella scheda del medico: un ordine da un'altra scheda e uno dal telefono aspettano in coda")) {
  await daCapo();
  lento = 1500;
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  const docB = await ctx.newPage();
  await suPagina(docB, B.patientUrl);
  await nienteSmart(docB);
  await doc.bringToFront();
  // la scheda di sottofondo non si apre (due tentativi): il giro lo fa la scheda del medico
  await sw.evaluate(() => {
    self.__creaVera = chrome.tabs.create;
    let n = 0;
    chrome.tabs.create = (...a) => (n++ < 2 ? Promise.reject(new Error("bloccato dal test")) : self.__creaVera.apply(chrome.tabs, a));
  });
  await ordina(doc, ESAMI);
  const via = await finche(() => sess.log.some((x) => x.cosa === "insert"), 20000);
  await sw.evaluate(() => { chrome.tabs.create = self.__creaVera; });
  check(via && !(await ordini()).some((x) => x.ep === "999001"), "il giro va nella scheda del medico (nessun ordine in sottofondo per ROSSI)");
  // a metà giro: un ordine da BIANCHI, e uno dal telefono
  await ordina(docB, ["TROPONINA"], { quesito: "dispnea" });
  const [tB] = await schedaDi("999002");
  const tel = tB != null ? await alPc(tB, "ordina", { ep: "999002", id: "telcodaUno", esami: ["00660001P:324"], quesito: "dispnea" }) : null;
  await sospendi(800);
  const l = await ordini();
  const diB = l.filter((x) => x.ep === "999002");
  const giroA = sess.log.filter((x) => x.cosa === "insert" && Number(x.rid) < 800000).length;
  check(tel && tel.ok && diB.length === 2 && diB.every((x) => x.stato === "coda") && giroA < 3,
    `BIANCHI dal PC e dal telefono: tutti e due «In coda» mentre il giro di ROSSI inserisce (got ${diB.map((x) => `${x.id}:${x.stato}`).join(", ")} · ROSSI ${giroA}/3 · tel ${JSON.stringify(tel).slice(0, 80)})`);
  check(diB.some((x) => x.pubblico && x.pubblico.titolo === "In coda"), "la striscia lo dice: «In coda»");
  await finche(() => conferme(A).length > 0 && conferme(B).length >= 2, 120000);
  const insA = inviati(A).length, insB = inviati(B).length;
  check(sess.ora === 0, `nessun «ORA-20965»: niente nella sessione sotto il giro di ROSSI (got ${sess.ora})`);
  check(insA === 3 && insB === 2 && conferme(A).length === 1 && conferme(B).length === 2, `ROSSI 3 esami e una conferma, BIANCHI 2 ordini confermati (got ${insA} · ${insB} · ${conferme(A).length}/${conferme(B).length})`);
  const fineA = sess.log.find((x) => x.cosa === "conferma");
  const primoB = sess.log.find((x) => x.cosa === "insert" && Number(x.rid) >= 800000);
  check(!!fineA && !!primoB && primoB.t > fineA.t, "BIANCHI parte solo dopo la conferma di ROSSI");
  await docB.close();
  lento = 0;
}

// ---- 5. …e al contrario: il giro della scheda aspetta il suo turno -------
if (prova("un ordine in sottofondo che gira: il giro della pagina «Nuova richiesta» aspetta, prima di partire")) {
  await daCapo();
  lento = 900;
  const docB = await ctx.newPage();
  await suPagina(docB, B.patientUrl);
  await nienteSmart(docB);
  const nasce = nuovaPagina();
  await ordina(docB, ESAMI);
  await nasce;
  await doc.bringToFront();
  await finche(() => sess.log.some((x) => x.cosa === "insert"), 20000);
  // la pagina «Nuova richiesta» di ROSSI: il giro lo fa lei (ha il suo modulo vivo)
  const crea = `${ORIGIN}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=999001&ASSISTITO_ID=*TEST00001&STRUTTURA=1&RISORSA_ID=${RES.POC}&RISORSE=${RES.POC},${RES.CENTRAL},${RES.URGENZE}&PADIGLIONE=&toPage=RcsRichiestaPrestazioniRicercaErogatore&returnPage=PsoEpisodio`;
  await suPagina(doc, crea);
  await nienteSmart(doc);
  await ordina(doc, ["TROPONINA"]);
  const coda = await finche(async () => /In coda/.test(await doc.evaluate(() => document.getElementById("psassist-host")?.shadowRoot?.textContent || "")), 8000);
  check(coda, "la scheda del medico dice «In coda»");
  await finche(() => conferme(A).length > 0 && conferme(B).length > 0, 120000);
  check(sess.ora === 0, `nessun «ORA-20965» (got ${sess.ora})`);
  check(inviati(B).length === 3 && inviati(A).length === 1 && conferme(A).length === 1 && conferme(B).length === 1,
    `BIANCHI 3 esami, ROSSI 1, una conferma ciascuno (got ${inviati(B).length} · ${inviati(A).length} · ${conferme(B).length}/${conferme(A).length})`);
  const fineB = sess.log.find((x) => x.cosa === "conferma"), creaA = sess.log.find((x) => x.cosa === "crea" && x.ep === "999001");
  check(!!fineB && !!creaA && creaA.t > fineB.t, "la richiesta di ROSSI nasce solo dopo la conferma di BIANCHI (il giro aspetta all'inizio)");
  await docB.close();
  lento = 0;
}

// ---- 6. una scheda d'ordine bloccata: la fila non si ingolfa -----------
// (la scheda non risponde più: la domanda «ci sei?» aspetta 5 secondi, e due
// schede chiedono il giro di controllo ogni 4. Un ordine «muto» — «⏹ la
// chiude» — non ferma le letture, e il ⏹ di un altro risponde subito.)
if (prova("una scheda d'ordine bloccata: il ⏹ e le letture restano svelte")) {
  await daCapo();
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  const docB = await ctx.newPage();
  await suPagina(docB, B.patientUrl);
  await nienteSmart(docB);
  const bloccata = await ctx.newPage();
  await bloccata.goto(`${ORIGIN}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoBloccata&EPISODIO_ID=999003`).catch(() => {});
  await sospendi(1500);   // (il content script è nato; poi la pagina si blocca)
  const PAZ = `${ORIGIN}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=`;
  await sw.evaluate(async (paz) => {
    const t = (await chrome.tabs.query({})).find((x) => /PsoBloccata/.test(x.url || ""));
    const r = (id, ep, stato, agg, worker) => ({ id, ep, paziente: id, n: 1, url: paz + ep, opener: null, worker, stato, ts: agg, agg, vista: null, resto: { mancano: [], controllare: [], nel: [] } });
    await chrome.storage.session.set({ ordini: [r("bloccato1", "999003", "corre", Date.now() - 200e3, t.id), r("incoda1", "999002", "coda", Date.now(), null)] });
  }, PAZ);
  await finche(async () => (await ordini()).some((x) => x.id === "bloccato1" && x.muto), 20000);
  await sospendi(9000);   // le due schede chiedono intanto il giro di controllo
  const t = await sw.evaluate(async () => {
    const s = (await chrome.tabs.query({})).find((x) => /EPISODIO_ID=999002/.test(x.url || ""));
    const t0 = Date.now();
    await new Promise((res) => ordMessaggio({ t: "ordineFerma", id: "incoda1" }, { tab: s, url: s.url }, res));
    const ferma = Date.now() - t0;
    const t1 = Date.now();
    await Promise.race([dopoIlMotore(), new Promise((r) => setTimeout(r, 15000))]);
    return { ferma, lettura: Date.now() - t1 };
  });
  check(t.ferma < 2000, `il ⏹ su un ordine in coda risponde subito (got ${t.ferma} ms)`);
  check(t.lettura < 1500, `una lettura in sottofondo (un referto) non aspetta l'ordine muto (got ${t.lettura} ms)`);
  // …e aprendo l'iPhone: la lista smart da rileggere si rilegge
  await smartDaRileggere(doc);
  await suPagina(doc, A.patientUrl);
  await telApre();
  check(await finche(() => sess.log.some((x) => x.cosa === "smart"), 15000), "e la lista smart si rilegge (l'iPhone aperto non aspetta l'ordine muto)");
  await nienteSmart(doc);
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
  await bloccata.close().catch(() => {});
  await docB.close();
}

// ---- 7. una stampa chiesta mentre un motore inserisce: la scheda dei PDF dopo
if (prova("una stampa dalla scheda del medico mentre un ordine inserisce: la scheda dei PDF si apre dopo il motore")) {
  await daCapo();
  await suPagina(doc, A.patientUrl);
  const r = await sw.evaluate(async (paz) => {
    await chrome.storage.local.set({ stampa: { attiva: true, etichette: "Zebra ZD421", a4: "HP LaserJet A4" } });
    const s = (await chrome.tabs.query({})).find((x) => /EPISODIO_ID=999001/.test(x.url || ""));
    const gira = { id: "gira1", ep: "999002", paziente: "BIANCHI ANNA", n: 1, url: paz, opener: null, worker: s.id, stato: "corre", ts: Date.now(), agg: Date.now(), vista: null, resto: { mancano: [], controllare: [], nel: [] } };
    await chrome.storage.session.set({ ordini: [gira] });
    const prima = (await chrome.tabs.query({})).length;
    const PDF = "https://smarthealth.multimedica.it/jasperserverSAN/jasperservlet?PROJECT=sa4rcs&REPORT=RcsRichiesta&RICHIESTA_ID=699999&RICHIESTA_PROG=1";
    const job = { id: "fdopo01", ep: "999001", paziente: "ROSSI MARIO", url: paz, tag: "Stampa", riassunto: "Richiesta 699999", jobs: [{ name: "Lista esami", printer: "stampante normale", url: PDF }] };
    const risposta = new Promise((res) => ordMessaggio({ t: "ordineFogli", job }, { tab: s, url: s.url }, res));
    await new Promise((res) => setTimeout(res, 3000));
    const durante = (await chrome.tabs.query({})).length;
    // il motore finisce: la scheda dei PDF può aprirsi
    const l = (await chrome.storage.session.get("ordini")).ordini;
    l[0].stato = "avviso"; l[0].agg = Date.now();
    await chrome.storage.session.set({ ordini: l });
    const ok = await Promise.race([risposta, new Promise((res) => setTimeout(() => res(null), 8000))]);
    const dopo = (await chrome.tabs.query({})).length;
    const rec = ((await chrome.storage.session.get("ordini")).ordini || []).find((x) => x.id === "fdopo01");
    if (rec && rec.worker != null) await chrome.tabs.remove(rec.worker).catch(() => {});
    await chrome.storage.session.set({ ordini: [] });
    await chrome.storage.local.remove("stampa");
    return { prima, durante, dopo, ok: !!(ok && ok.ok) };
  }, A.patientUrl);
  check(r.durante === r.prima, `mentre il motore inserisce, nessuna scheda del gestionale nuova (got ${r.prima} → ${r.durante})`);
  check(r.ok && r.dopo === r.prima + 1, `finito il motore, la scheda dei PDF si apre (got ${JSON.stringify(r)})`);
}

// ---- 7b. un referto preso dal service worker mentre un motore inserisce ----
// (il ripiego di un tocco su un referto, quando la scheda non l'ha preso: è
// una pagina del gestionale con la sessione del medico, come le altre)
if (prova("un referto preso dal service worker mentre un ordine inserisce: aspetta la fine del motore")) {
  await daCapo();
  const REF = `${ORIGIN}/sa4/restrict2/refertostream?REFERTO_ID=swattesa1`;
  const chiesto = () => A.state.requests.some((q) => /refertostream/.test(q.url) && /swattesa1/.test(q.url));
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [{ id: "gira2", ep: "999002", paziente: "BIANCHI ANNA", n: 1, url: null, opener: null, worker: null,
    stato: "corre", ts: Date.now(), agg: Date.now(), vista: null, resto: { mancano: [], controllare: [], nel: [] } }] }));
  const est = await ctx.newPage();
  await est.goto(`chrome-extension://${new URL(sw.url()).host}/portale.html`);
  const risposta = est.evaluate((u) => new Promise((res) => chrome.runtime.sendMessage({ t: "cacheRef", id: "swattesa1", url: u, ep: "999001" }, res)), REF);
  await sospendi(3000);
  const durante = chiesto();
  // il motore finisce: il referto si può prendere
  await sw.evaluate(() => chrome.storage.session.get("ordini").then((o) => {
    const l = o.ordini || [];
    for (const x of l) if (x.id === "gira2") { x.stato = "avviso"; x.agg = Date.now(); }
    return chrome.storage.session.set({ ordini: l });
  }));
  const r = await Promise.race([risposta, sospendi(10000).then(() => null)]);
  check(!durante, "mentre il motore inserisce, il service worker non chiede il referto al gestionale");
  check(!!(r && r.ok) && chiesto(), `finito il motore, lo prende e lo tiene (got ${JSON.stringify(r)})`);
  await sw.evaluate(() => Promise.all([chrome.storage.session.set({ ordini: [] }), chrome.storage.local.remove("ref:swattesa1")]));
  await est.close().catch(() => {});
}

// ---- 8. gli ordini finiti non restano in memoria --------------------------
if (prova("dopo tanti ordini la memoria della sessione resta piccola")) {
  const r = await sw.evaluate(async () => {
    await chrome.storage.session.set({ ordini: [] });
    const lungo = "x".repeat(239), ora = Date.now();
    const finito = (i, agg, ok) => ({ id: "tanti" + i, ep: "999001", paziente: "ROSSI MARIO", n: 6, url: null, opener: null, worker: null,
      stato: ok ? "avviso" : "errore", ts: agg, agg, vista: ok ? { tag: "Fatto", testo: "", tono: "ok" } : { tag: "Errore", testo: "completa a mano", tono: "err" },
      resto: { mancano: [], controllare: [], nel: [] }, registro: Array(40).fill(lungo),
      consegna: { url: "https://smarthealth.multimedica.it/sa4pso/restrict/menuPsoEpisodio.do?MVPG=RcsRichiestaPrestazioniRicercaErogatore&EPISODIO_ID=999001", avviso: { testo: "y".repeat(50000) } } });
    const piani = {};
    for (let i = 0; i < 60; i++) piani["ordine:tanti" + i] = { items: Array(20).fill({ res: "00660001P", code: "324", label: lungo }) };
    await chrome.storage.session.set(piani);
    // un turno: 30 ordini andati bene (3 minuti fa e più), 30 finiti male (più di mezz'ora fa); e uno appena finito, di ciascuno
    // (ognuno scritto quando è finito; poi il tempo passa, e la scrittura dopo)
    const l = [];
    for (let i = 0; i < 62; i++) l.push(finito(i, ora, i < 30 || i === 60));
    await ordScrivi(l);
    const scritti = (await chrome.storage.session.get("ordini")).ordini;
    for (const x of scritti) {
      const k = Number(x.id.slice(5));
      x.agg = k === 60 ? ora - 30e3 : k === 61 ? ora - 60e3 : k < 30 ? ora - (3 + k) * 60e3 : ora - (31 + k) * 60e3;
    }
    await chrome.storage.session.set({ ordini: scritti });
    await ordScrivi(await ordLeggi());
    const resta = ((await chrome.storage.session.get("ordini")).ordini || []).map((x) => x.id);
    const piano = Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith("ordine:tanti"));
    const byte = await chrome.storage.session.getBytesInUse(null);
    await chrome.storage.session.set({ ordini: [] });
    await chrome.storage.session.remove(piano);
    return { resta, piano: piano.length, byte };
  });
  check(r.resta.length === 2 && r.resta.includes("tanti60") && r.resta.includes("tanti61"), `restano solo i due appena finiti (got ${r.resta.join(", ")})`);
  check(r.piano === 0, `e nessun piano di un ordine che non gira più (got ${r.piano})`);
  check(r.byte < 300000, `la memoria della sessione resta piccola (got ${Math.round(r.byte / 1024)} KB)`);
}

await ctx.close();
console.log(fail ? `\nSESSIONE: ${fail} FALLITI` : "\nSESSIONE: TUTTO OK");
process.exit(fail ? 1 : 0);
