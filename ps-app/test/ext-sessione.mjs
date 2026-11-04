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
 * carrello» trenta secondi dopo). Qui il simulatore si comporta così: tiene la
 * richiesta corrente della sessione, e un inserimento su un'altra risponde con
 * l'avviso del database, senza inserire niente.
 *   1. a metà ordine nient'altro chiede pagine al gestionale (la lista smart
 *      aspetta la fine del motore): l'ordine su due erogatori va, senza ORA;
 *   2. una risposta con «ORA-»: il giro si ferma subito, niente altro mandato,
 *      e il medico legge «Il gestionale ha risposto: ORA-20965 …»;
 *   3. una scheda d'ordine che non è arrivata sulla pagina si sostituisce
 *      solo se il piano non l'ha mai avuto: mai due motori per un ordine.
 *   node test/ext-sessione.mjs [nome della prova]
 */
import { chromium } from "playwright";
import { createMock, RES } from "./sa4pso-mock.mjs";
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
const sess = { corrente: null, log: [], ora: 0, forzaOra: null };
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
    return r.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: "<html><body><p>Lista smart</p></body></html>" }).catch(() => {});
  }
  // una scheda che si blocca appena nata (il suo content script non risponde più)
  if (/MVPG=PsoBloccata/.test(u)) {
    return r.fulfill({ status: 200, headers: { "content-type": "text/html" },
      body: "<html><body><p>Bloccata</p><script>setTimeout(() => { const t = Date.now(); while (Date.now() - t < 45000); }, 1000);</script></body></html>" }).catch(() => {});
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
  if (req.method() === "POST" && /^RICHIESTACrea/.test(p.get("ccsForm") || "")) sess.log.push({ t: Date.now(), cosa: "crea", ep: p.get("EPISODIO_ID") });
  let out = mock.handle({ method: req.method(), url: u, bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) {
    const dove = new URL(out.headers.location, u).href;
    sessioneVede(dove);
    out = mock.handle({ method: "GET", url: dove });
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
    const t = (document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run")?.innerText || "").replace(/\s+/g, " ").trim();
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
// la lista smart conosciuta e da rileggere (10 minuti passati): la rilegge la prima pagina che si apre
const smartDaRileggere = (p) => p.evaluate((u) => {
  localStorage.setItem("psassist:smart.url.v1", JSON.stringify({ url: u, ts: Date.now() }));
  localStorage.setItem("psassist:smart.sync.v1", JSON.stringify({ ts: Date.now() - 11 * 60e3, fine: Date.now() - 11 * 60e3, esito: "ok", n: 0 }));
}, SMART);
const nienteSmart = (p) => p.evaluate(() => { localStorage.removeItem("psassist:smart.url.v1"); });

let doc = await ctx.newPage();
// una prova dopo l'altra: niente ordini aperti, e la scheda del medico nuova
async function daCapo() {
  await sw.evaluate(() => Promise.all([chrome.storage.session.set({ ordini: [] }), typeof motoreScrivi === "function" && motoreScrivi(null)]));
  for (const p of ctx.pages()) await p.close().catch(() => {});
  doc = await ctx.newPage();
}
const SOLO = (process.argv[2] || "").toLowerCase();
const prova = (t) => {
  if (SOLO && !t.toLowerCase().includes(SOLO)) return false;
  console.log("\nsessione: " + t); nuovi();
  Object.assign(sess, { corrente: null, log: [], ora: 0, forzaOra: null });
  return true;
};
const ESAMI = ["EMOCROMOCITOMETRICO", "TROPONINA", "PROCALCITONINA"];   // POC (due) e laboratorio urgenze

// ---- 1. a metà ordine, nient'altro nella sessione ------------------------
if (prova("a metà ordine la lista smart aspetta: l'ordine su due erogatori entra tutto")) {
  lento = 900;
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  const nasce = nuovaPagina();
  await ordina(doc, ESAMI);
  const w = await nasce;
  check(!!w, "l'ordine va in una scheda di sottofondo");
  await finche(() => sess.log.some((x) => x.cosa === "insert"), 20000);
  // il medico va su BIANCHI, e la smart è da rileggere: la sua pagina la chiederebbe dopo 1,5 secondi
  await smartDaRileggere(doc);
  await suPagina(doc, B.patientUrl);
  await finche(async () => conferme(A).length > 0 || (await ordini()).some((x) => x.stato === "errore"), 60000);
  await striscia(doc, /ROSSI MARIO.*(Confermata|Etichette|Stampa|Errore)/, 30000).catch(() => "");
  const ins = inviati(A).map((q) => q.params.PRESTAZIONE).sort();
  check(sess.ora === 0, `nessun «ORA-20965»: la richiesta della sessione non è cambiata sotto il motore (got ${sess.ora})`);
  check(ins.length === 3 && conferme(A).length === 1, `tre esami su due erogatori, una conferma (got ${ins.join(",")} · ${conferme(A).length} conferme)`);
  // dal primo inserimento alla conferma (o all'ultima risposta del motore) il motore lavora
  const primo = sess.log.find((x) => x.cosa === "insert");
  const fine = (sess.log.find((x) => x.cosa === "conferma") || [...sess.log].reverse().find((x) => x.cosa === "insert" || x.cosa === "ORA")).t + lento;
  const smart = sess.log.filter((x) => x.cosa === "smart");
  check(!smart.some((x) => x.t >= primo.t && x.t <= fine), `la lista smart non si legge mentre il motore inserisce e conferma (smart: ${smart.map((x) => x.t - primo.t).join(", ") || "nessuna"} ms dal primo inserimento)`);
  // …e dopo, a ordine finito, sì (non è persa: aspettava)
  await finche(() => sess.log.some((x) => x.cosa === "smart"), 45000);
  check(sess.log.some((x) => x.cosa === "smart"), "finito l'ordine, la lista smart si rilegge lo stesso");
  await nienteSmart(doc);
  lento = 0;
}

// ---- 2. ORA- nella risposta: ci si ferma subito -------------------------
if (prova("ORA- nella risposta all'inserimento: il giro si ferma subito e lo dice")) {
  await daCapo();
  lento = 0;
  await suPagina(doc, A.patientUrl);
  await nienteSmart(doc);
  await sw.evaluate(() => chrome.storage.local.remove("errori.v1"));
  // il secondo inserimento risponde con l'avviso del database
  let n = 0;
  sess.forzaOra = () => ++n === 2;
  const t0 = Date.now();
  const nasce = nuovaPagina();
  await ordina(doc, ESAMI);
  await nasce;
  await suPagina(doc, B.patientUrl);
  const rossa = await striscia(doc, /ROSSI MARIO.*Errore/, 40000).catch(() => "");
  const dt = Date.now() - t0;
  check(/Il gestionale ha risposto: ORA-20965/.test(rossa), `la striscia del medico dice che cosa ha risposto il gestionale (got: ${rossa || "niente"})`);
  check(dt < 20000, `subito, senza le riletture di mezzo minuto (got ${Math.round(dt / 1000)} s)`);
  const ins = sess.log.filter((x) => x.cosa === "insert");
  const iOra = sess.log.findIndex((x) => x.cosa === "ORA");
  check(ins.length === 2 && iOra >= 0 && !sess.log.slice(iOra + 1).some((x) => x.cosa === "insert"), `dopo l'avviso niente altro mandato (got ${ins.length} inserimenti)`);
  check(conferme(A).length === 0, "e niente confermato");
  const cerca = async () => ((await sw.evaluate(() => chrome.storage.local.get("errori.v1")))["errori.v1"] || [])
    .find((x) => x.tipo === "ordine" && /Il gestionale ha risposto: ORA-20965/.test(x.dati?.motivo || ""));
  await finche(cerca, 15000);
  const e = await cerca();
  check(!!e && (e.dati.traccia?.passi || []).some((p) => /ORA-20965/.test(p.avviso || "")), "nel registro degli errori, con la traccia e l'avviso");
  check(!/non risulta nel carrello/.test(JSON.stringify(e || {})), "e non «non risulta nel carrello»");
  await $panel(doc, "#strstop").click().catch(() => {});
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
  // …e nella pagina: la lista smart da rileggere si rilegge
  await smartDaRileggere(doc);
  await suPagina(doc, A.patientUrl);
  check(await finche(() => sess.log.some((x) => x.cosa === "smart"), 15000), "e la lista smart si rilegge (la pagina non aspetta l'ordine muto)");
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
