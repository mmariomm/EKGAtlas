#!/usr/bin/env node
/*
 * Chi il PC conosce solo dalla lista smart, aperto dal telefono — con
 * l'estensione VERA, il ponte vero (il ripetitore locale) e l'app in formato
 * iPhone. Il gestionale finto ha due aree, come quello vero (nomi e numeri
 * inventati): l'area è della sessione (PsoPsoImposta: la tendina RISORSA_ID e
 * «Conferma», un POST), ogni pagina la dice in testa, la lista di un'area ha
 * il link di ogni riga, e la pagina di un paziente di un'altra area arriva
 * senza le Richieste.
 *  - Nell'area del gestionale: un tocco sul telefono, e il PC legge dietro la
 *    lista dell'area (il suo link), trova la riga (nome e nascita, una sola),
 *    e il telefono lo apre col suo episodio vero. La scheda del medico non si
 *    muove, PsoPsoImposta non si apre, l'area non cambia. Due righe uguali:
 *    niente; la riga col nome di un altro: «Errore grave», niente.
 *  - In un'altra area: «Passa il PC all'area Bassa e apri BLU M.» — un tocco,
 *    nella scheda del medico: Imposta, un «Conferma», la lista, il link della
 *    sua riga; il telefono dice «PC ora sull'area Bassa» e lo apre. Lo stesso
 *    numero rimandato non ripassa; con un carrello aperto sul PC: rifiutato,
 *    niente cambiato; il PC di sola lettura lo rifiuta.
 *   node test/ext-area-tel.mjs   (TEST_SHOTS_DIR=… per le foto del telefono)
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync } from "node:fs";
import { avviaRelay } from "../ponte/relay-node.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-area-tel-" + process.pid);
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
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function finche(fn, timeout = 15000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) if (await fn().catch(() => false)) return true;
  return false;
}

// ---------------------------------------------------------- il gestionale finto
const ORIGIN = "https://smarthealth.multimedica.it", DIR = "/sa4pso/restrict/";
const AREE = { alta: { id: "00910001P", label: "AREA ALTA INTENSITA'" }, bassa: { id: "00940001P", label: "AREA MEDIA - BASSA INTENSITA'" } };
const P = (ep, name, nato, eta, triage, area) => ({ ep, name, nato, eta, triage, area });
const MEDICO = P("730001", "BRUNI ELSA", "11/11/1955", 70, "VERDE", "alta");    // la scheda del medico: la sua pagina
const VERDE = P("730002", "VERDE LINO", "02/03/1970", 56, "VERDE", "alta");      // solo dalla smart, nell'area del gestionale
const DOPPIA = P("730003", "DOPPI ADA", "04/05/1980", 46, "AZZURRO", "alta");    // …due righe uguali nella lista
const DOPPIA2 = P("730004", "DOPPI ADA", "04/05/1980", 46, "AZZURRO", "alta");
const NERO = P("730005", "NERO PIO", "09/10/1950", 76, "ARANCIONE", "alta");     // …la sua riga porta l'episodio di un altro
const BLU = P("730011", "BLU MARCO", "06/07/1965", 61, "AZZURRO", "bassa");      // solo dalla smart, in un'altra area
const GRIGI = P("730012", "GRIGI NORA", "08/09/1975", 51, "VERDE", "bassa");     // …col carrello aperto sul PC
const TUTTI = [MEDICO, VERDE, DOPPIA, DOPPIA2, NERO, BLU, GRIGI];
const SOLO_SMART = [VERDE, DOPPIA, NERO, BLU, GRIGI];
const chi = (ep) => TUTTI.find((p) => p.ep === ep) || null;
// le chiavi del PC (core.js): l'impronta della nascita e la chiave di chi si conosce solo dalla smart (FNV-1a)
const fnv = (d) => { let h = 0x811c9dc5; for (const c of d) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h.toString(36); };
const norm = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 ]+/g, " ").trim().replace(/\s+/g, " ");
const impronta = (d) => { const [g, m, a] = d.split("/"); return fnv(`${g.padStart(2, "0")}/${m.padStart(2, "0")}/${a}`); };
const chiaveSmart = (p) => "sm" + fnv(`${norm(p.name)}|${impronta(p.nato)}`);
const breve = (p) => `${p.name.split(" ")[0]} ${p.name.split(" ")[1][0]}.`;

// (`nascosti`: righe che la lista non mostra ancora — ma il suo conto sì: una lista monca, che aggiunge e
// basta, come quando si carica a metà. Così ogni prova legge solo le righe che le servono.)
const srv = { area: "alta", log: [], conferme: [], nascosti: new Set([DOPPIA.ep, DOPPIA2.ep, NERO.ep]) };
const testa = () => `<table class="AFCHeaderTable" border="0" width="100%"><tbody><tr><td>
    <table width="100%"><tbody><tr><td width="15%"></td>
    <td width="70%" align="center"><font style="font-size: 130%; font-weight: bolder; ">OSPEDALE ESEMPIO</font><br><font style="font-size: 110%; font-weight: bolder; ">${AREE[srv.area].label}</font><br><b>Salve!</b></td>
    <td width="15%" align="right">${AREE[srv.area].id}<br></td></tr></tbody></table></td></tr></tbody></table>
  <table><tr><td class="SA4HeaderBarTDnoBold"><a class="SA4HeaderBarLinkSel" href="menuPso.do?MVPG=PsoPazienti">Pazienti</a> | <a class="SA4HeaderBarLink" href="menuPso.do?MVPG=PsoPsoImposta">Imposta</a></td></tr></table>`;
const pagina = (titolo, corpo) => `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>${titolo}</title></head><body>${testa()}${corpo}</body></html>`;
const linguetta = (p) => `<div class="myLinguetta"><table cellpadding="3" width="100%"><tbody><tr><td nowrap width="1%"><img title="${p.triage}"></td>
  <td nowrap width="40%" title="${p.triage}"><strong>${p.name}</strong><br>${p.nato}(${p.eta})<small> nota</small></td><td width="50%"><strong>MEDICO ESEMPIO</strong><br>MOTIVO</td></tr></tbody></table></div>`;
// (NERO PIO: la sua riga porta l'episodio di ALTRO NOME, che il PC conosce già)
const epRiga = (p) => (p === NERO ? "730099" : p.ep);
const listaPage = () => {
  const tutte = TUTTI.filter((p) => p.area === srv.area), righe = tutte.filter((p) => !srv.nascosti.has(p.ep));
  return pagina("Pronto Soccorso", `
    <a class="shiny-button" href="?MVPG=PsoPazientiTriage">Triage</a> <a class="shiny-button-selected" href="?MVPG=PsoPazientiAmbulatorio">Ambulatorio (${tutte.length})</a>
    <table><form method="post" name="PazientiFiltro" action="menuPso.do?ccsForm=PazientiFiltro:Edit&amp;MVPG=PsoPazientiAmbulatorio"></form>
      <tr><td>Assistito <input class="AFCInput" value="" name="s_ASSISTITO"></td></tr></table>
    <table class="AFCFormTABLE">${righe.map((p) => `<tr><td class="AFCDataTD" name="EPISODIO">2026/0${epRiga(p)}</td>
      <td class="AFCDataTD"><a style="text-decoration: none" href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${epRiga(p)}" title="Apri Episodio">${linguetta(p)}</a></td>
      <td class="AFCDataTD" name="INGRESSO">08:48</td></tr>`).join("")}</table>`);
};
const impostaPage = () => pagina("Pronto Soccorso", `
    <form method="post" action="menuPso.do?ccsForm=RisorsaImposta:Edit&amp;MVPG=PsoPsoImposta"><table><tr><td>
      <select class="AFCSelect" onchange="document.getElementById('AGG_RISORSA').click();" name="RISORSA_ID">
        <option value="00920001P">TRIAGE</option>
        ${Object.keys(AREE).map((k) => `<option value="${AREE[k].id}"${k === srv.area ? ' selected=""' : ""}>${AREE[k].label}</option>`).join("")}
      </select><input value="" type="hidden" name="PAZIENTIHOME"></td></tr>
      <tr><td><input id="AGG_RISORSA" class="AFCButton" value="Conferma" type="submit" name="Update"></td></tr></table></form>`);
const riquadro = (p) => `<table><tr><td title="${p.triage}"><font style="font-size: 120%; font-weight: bolder; ">${p.ep}</font><br><font style="font-size: 150%; font-weight: bolder; ">${p.name}</font><br><font style="font-size: 120%; font-weight: bolder; ">${p.nato} (${p.eta}) F</font></td></tr></table>`;
// la pagina del paziente: le Richieste solo sull'area giusta (come il gestionale vero)
const pazPage = (p) => pagina(p.name, `${riquadro(p)}
  <form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${p.ep}">
    <textarea name="ANAMNESI">Riferisce dolore inventato</textarea><textarea name="ALLERGIE">Nessuna</textarea><textarea name="ESAME_OBIETTIVO"></textarea>
    <input class="AFCButton" type="submit" value="Conferma" name="Update"></form>
  ${p.area === srv.area ? `<a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${p.ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">Laboratorio</a>` : ""}`);
const URL_PAZ = (p) => `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${p.ep}`;
const URL_CARRELLO = `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=RcsRichiestaPrestazioniRicercaErogatore&RICHIESTA_ID=800001&RISORSA_ID=00660001P`;

// Il gestionale vero non si raggiunge mai, nemmeno per sbaglio: ogni sua pagina la dà il finto qui sotto, e
// il browser non apre connessioni verso quel nome (le preconnessioni di Chromium, che passerebbero dal proxy
// della macchina): niente proxy, e il nome porta a questo computer.
const RETE_CHIUSA = ["--proxy-server=direct://", "--host-resolver-rules=MAP * 127.0.0.1"];
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...RETE_CHIUSA,
    ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
});
let sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js"));
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
let doc = null;
await ctx.route(`${ORIGIN}/**`, async (r) => {
  const req = r.request(), u = new URL(req.url()), mvpg = u.searchParams.get("MVPG"), ep = u.searchParams.get("EPISODIO_ID");
  const html = (b) => r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(b, "latin1") }).catch(() => {});
  let pg = null;
  try { pg = req.frame().page(); } catch { /* la scheda non ha ancora la cornice */ }
  const voce = { metodo: req.method(), mvpg: mvpg || u.pathname, ep: ep || "", tipo: req.resourceType(), medico: !!doc && pg === doc, post: req.postData() || "" };
  if (["document", "xhr", "fetch"].includes(voce.tipo)) srv.log.push(voce);
  if (req.method() === "POST" && u.searchParams.get("ccsForm") === "RisorsaImposta:Edit") {
    const id = new URLSearchParams(req.postData() || "").get("RISORSA_ID");
    const k = Object.keys(AREE).find((x) => AREE[x].id === id);
    srv.conferme.push({ id, medico: voce.medico });
    if (k) srv.area = k;
    return html(listaPage());   // (il gestionale rinvia alla lista dell'area nuova)
  }
  if (mvpg === "PsoPazientiAmbulatorio" || mvpg === "PsoPazienti") return html(listaPage());
  if (mvpg === "PsoPsoImposta") return html(impostaPage());
  if (mvpg === "PsoEpisodioClinicoAmbulatorio") {
    const p = ep === "730099" ? { ...NERO, ep: "730099", name: "ALTRO NOME" } : chi(ep);
    if (p) return html(pazPage(p));
  }
  if (mvpg === "RcsRichiestaPrestazioniRicercaErogatore") return html(pagina("Pronto Soccorso", "<p>il carrello della richiesta</p>"));
  return html(pagina("Pronto Soccorso", "<p>altro</p>"));
});

const ls = (k) => doc.evaluate((k) => JSON.parse(localStorage.getItem("psassist:" + k) || "null"), k);
const imposte = () => srv.log.filter((x) => x.mvpg === "PsoPsoImposta");
const liste = (dietro) => srv.log.filter((x) => x.mvpg === "PsoPazientiAmbulatorio" && x.tipo === "document" && (dietro == null || x.medico === !dietro));
const pagineDi = (p, dietro) => srv.log.filter((x) => x.mvpg === "PsoEpisodioClinicoAmbulatorio" && x.ep === p.ep && x.tipo === "document" && (dietro == null || x.medico === !dietro));
const schedeGest = () => ctx.pages().filter((p) => !p.isClosed() && /smarthealth/.test(p.url()));
const registro = () => sw.evaluate(() => chrome.storage.session.get("ponte").then((o) => (o.ponte?.registro || []).map((x) => x.testo)));
const errori = () => sw.evaluate(() => chrome.storage.local.get("errori.v1").then((o) => (o["errori.v1"] || []).filter((x) => x.tipo === "lista telefono")));

console.log("chi il PC conosce solo dalla lista smart, aperto dal telefono: la lista dell'area letta dietro, o il PC passato all'area col tocco del medico");
let telBrowser = null, relay = null;
try {
  // ---- il medico ha davanti la pagina di un suo paziente in Alta (col pannello: risponde al telefono)
  doc = await ctx.newPage();
  let navMedico = 0;
  doc.on("framenavigated", (f) => { if (f === doc.mainFrame()) navMedico++; });
  await doc.goto(URL_PAZ(MEDICO));
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  // il PC conosce dalla lista smart (senza la loro pagina) cinque pazienti, con la loro area; ALTRO NOME ha la sua pagina
  await doc.evaluate(({ solo, aree, altro }) => {
    const K = "psassist:patients.v1", l = JSON.parse(localStorage.getItem(K) || "[]"), ora = Date.now();
    for (const s of solo) l.push({ ep: s.k, name: s.name, url: "", ts: 0, pk: "", nato: s.nato, smart: true, lista: ora, triage: s.triage });
    l.push({ ep: "730099", name: "ALTRO NOME", url: altro, ts: ora - 60e3, pk: "", triage: "VERDE" });
    localStorage.setItem(K, JSON.stringify(l));
    const A = JSON.parse(localStorage.getItem("psassist:aree.v1") || "{}");
    A.membri = A.membri || {}; A.viste = A.viste || {};
    for (const s of solo) A.membri[s.k] = { k: s.area, ts: ora };
    A.membri["730099"] = { k: "alta", ts: ora };
    A.viste.alta = { label: aree.alta.label, ts: ora }; A.viste.bassa = { label: aree.bassa.label, ts: ora };
    localStorage.setItem("psassist:aree.v1", JSON.stringify(A));
    localStorage.setItem("psassist:aree.opzioni.v1", JSON.stringify({ alta: { id: aree.alta.id, label: aree.alta.label }, bassa: { id: aree.bassa.id, label: aree.bassa.label } }));
  }, { solo: SOLO_SMART.filter((p) => p !== DOPPIA2).map((p) => ({ k: chiaveSmart(p), name: p.name, nato: impronta(p.nato), area: p.area, triage: p.triage })), aree: AREE,
    altro: `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=730099` });
  check((await ls("area.corrente.v1"))?.k === "alta", "il gestionale sul PC è sull'Alta (la testata della pagina del medico)");

  // ---- il ponte, l'associazione, l'app in formato iPhone
  relay = await avviaRelay();
  await sw.evaluate((u) => chrome.storage.local.set({ "ponte.host": u }).then(() => ponteAvvia()), relay.url);
  const extId = new URL(sw.url()).host;
  const pp = await ctx.newPage();
  await pp.goto(`chrome-extension://${extId}/ponte.html`);
  await pp.locator("#associa").click();
  await pp.waitForSelector("#qr svg", { timeout: 8000 });
  const qr = await sw.evaluate(() => ponteQr());
  await pp.close();
  await doc.bringToFront();
  telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(), args: RETE_CHIUSA });
  const telCtx = await telBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "it-IT",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const tel = await telCtx.newPage();
  const testoTel = () => tel.locator("#app").innerText().catch(() => "");
  const aspettaTel = async (re, t = 30000) => ((await finche(async () => re.test(await testoTel()), t)) ? testoTel() : "");
  const foto = async (nome) => { if (SHOTS) await tel.screenshot({ path: join(SHOTS, `area-telefono-${nome}.png`) }).catch(() => {}); };
  const avviso = () => tel.locator(".avviso, [role=alert], [role=status]").allInnerTexts().then((l) => l.join(" | ")).catch(() => "");
  const senzaAvviso = () => finche(async () => (await tel.locator(".avviso").count()) === 0, 10000);
  const tornaAllElenco = async () => { if (await tel.locator('[data-a="indietro"]').count()) await tel.locator('[data-a="indietro"]').first().click(); await aspettaTel(/BRUNI ELSA/); };
  const apriSulTel = async (p) => {
    await tornaAllElenco();
    await senzaAvviso();
    await tel.locator(".paz", { hasText: p.name }).first().click();
    await finche(async () => /Esiti/.test(await testoTel()), 10000);
    if (await tel.locator('[data-a="scheda"][data-s="esiti"]:not(.on)').count()) await tel.locator('[data-a="scheda"][data-s="esiti"]').click();
  };
  const testata = () => tel.locator("header").innerText().catch(() => "");
  await tel.goto(qr);
  check(!!(await aspettaTel(/BRUNI ELSA/)) && !!(await aspettaTel(/VERDE LINO/)) && !!(await aspettaTel(/BLU MARCO/)), "inquadrato il QR: sul telefono l'elenco del PC, con chi conosce solo dalla lista smart");
  await foto("1-elenco");

  // ================= A. nell'area del gestionale: la lista letta dietro
  const nav0 = navMedico, liste0 = liste().length;
  await apriSulTel(VERDE);
  check(await finche(async () => liste(true).length === liste0 + 1, 30000), "un tocco su VERDE LINO (Alta, solo dalla smart): il PC apre dietro la lista dell'Alta");
  check(await finche(async () => {
    const l = await ls("patients.v1");
    const v = l.find((x) => x.ep === VERDE.ep);
    return !!v && /EPISODIO_ID=730002$/.test(v.url) && !l.some((x) => x.ep === chiaveSmart(VERDE));
  }, 20000), "…trova la sua riga: il PC lo conosce col suo episodio vero e il link della sua riga (e la chiave della smart se ne va)");
  check(await finche(async () => !/solo dalla lista smart/.test(await testoTel()) && /VERDE LINO/.test(await testata()), 30000),
    `sul telefono si apre lui, col suo episodio: niente più «solo dalla lista smart» (${(await testoTel()).replace(/\n+/g, " / ").slice(0, 160)})`);
  // poi è un paziente come gli altri: mai aperto in questo turno, il PC apre la sua pagina dietro (il tocco è il gesto)
  check(await finche(async () => pagineDi(VERDE, true).length >= 1, 40000), "…e poi, come per ogni paziente non ancora aperto, il PC apre la sua pagina vera dietro");
  await finche(async () => schedeGest().length === 1, 30000);
  check(schedeGest().length === 1, `le schede dietro si chiudono: resta la scheda del medico (${schedeGest().length})`);
  check(navMedico === nav0 && doc.url() === URL_PAZ(MEDICO) && !liste(false).length && !pagineDi(VERDE, false).length,
    `la scheda del medico non si è mossa: niente navigazioni, è sempre su BRUNI ELSA (${navMedico - nav0} navigazioni, ${doc.url().slice(-30)})`);
  check(!imposte().length && !srv.conferme.length && srv.area === "alta", "PsoPsoImposta mai aperta, nessun «Conferma»: il gestionale resta sull'Alta");
  check((await registro()).some((t) => /Lista Alta intensità letta dietro: trovato VERDE LINO/.test(t)), "nel registro del ponte: la lista letta dietro, e chi");
  await foto("2-verde-aperto");

  // ---- due righe uguali nella lista: non si sceglie, niente aperto
  srv.nascosti.delete(DOPPIA.ep); srv.nascosti.delete(DOPPIA2.ep);
  const l2 = liste(true).length;
  await apriSulTel(DOPPIA);
  check(await finche(async () => liste(true).length === l2 + 1, 30000), "DOPPI ADA (Alta): la lista letta dietro anche per lei");
  const t2 = await aspettaTel(/due righe uguali nella lista dell'area Alta intensità/, 30000);
  check(!!t2 && /solo dalla lista smart/.test(t2) && !pagineDi(DOPPIA).length && !pagineDi(DOPPIA2).length,
    `…ma due righe uguali: niente scelto, niente aperto, e il telefono dice perché (${t2.replace(/\n+/g, " / ").slice(0, 200)})`);
  // di nuovo, subito: la lista non si rilegge (una ogni 10 minuti per paziente)
  const l2b = liste(true).length;
  const ancora = await sw.evaluate((ep) => ponteListaSotto(ep), chiaveSmart(DOPPIA));
  await sospendi(1000);
  check(!ancora.ok && /già letta da poco/.test(ancora.testo) && liste(true).length === l2b, `richiesta subito di nuovo: la lista non si rilegge, al più una ogni 10 minuti per paziente («${ancora.testo}»)`);

  // ---- la sua riga porta l'episodio di un altro paziente: Errore grave, niente aperto
  srv.nascosti.delete(NERO.ep);
  const l3 = liste(true).length;
  await apriSulTel(NERO);
  const t3 = await aspettaTel(/Errore grave: la riga della lista sul PC è di un altro paziente/, 30000);
  check(!!t3 && liste(true).length === l3 + 1 && !srv.log.some((x) => x.mvpg === "PsoEpisodioClinicoAmbulatorio" && x.ep === "730099"),
    `NERO PIO: la riga della lista ha l'episodio di ALTRO NOME — «Errore grave», niente aperto (${(t3.match(/Errore grave[^\n]*/) || [""])[0]})`);
  const er = await errori();
  check(er.some((e) => e.dati && e.dati.grave) && !/NERO|ALTRO|7300/.test(JSON.stringify(er)), "nel registro degli errori («lista telefono»), senza nomi né episodi");
  check(navMedico === nav0 && !imposte().length && srv.area === "alta", "la scheda del medico ancora ferma, l'area ancora l'Alta");

  // ================= B. in un'altra area: il tocco del medico passa il PC all'area
  // ---- con un carrello aperto sul PC: rifiutato, niente cambiato
  const carrello = await ctx.newPage();
  await carrello.goto(URL_CARRELLO);
  await doc.bringToFront();
  await apriSulTel(GRIGI);
  const bG = tel.locator(`[data-a="areaApri"]`);
  check(await finche(async () => (await bG.count()) === 1, 20000) && (await bG.innerText()) === "Passa il PC all'area Bassa e apri GRIGI N.",
    `GRIGI NORA (Bassa, solo dalla smart, il gestionale sull'Alta): al posto della riga, il bottone «${await bG.innerText().catch(() => "—")}»`);
  await foto("3-bottone");
  await senzaAvviso();
  await bG.click();
  check(!!(await aspettaTel(/C'è un carrello aperto sul PC/, 30000)) && !imposte().length && !srv.conferme.length && srv.area === "alta" && navMedico === nav0,
    `con un carrello aperto sul PC: rifiutato, niente cambiato (${await avviso()})`);
  await carrello.close();
  await doc.bringToFront();

  // ---- un tocco: Imposta, un «Conferma», la lista, il link della sua riga; il telefono dice «PC ora sull'area Bassa»
  await apriSulTel(BLU);
  const bB = tel.locator(`[data-a="areaApri"]`);
  check(await finche(async () => (await bB.count()) === 1, 20000) && (await bB.innerText()) === "Passa il PC all'area Bassa e apri BLU M.", `BLU MARCO: «${await bB.innerText().catch(() => "—")}»`);
  const rqPrima = Object.keys((await sw.evaluate(() => chrome.storage.session.get("ponte.area.rq")))["ponte.area.rq"] || {});
  await senzaAvviso();
  const n0 = srv.log.length;
  await bB.click();
  check(await finche(async () => pagineDi(BLU, false).length === 1, 40000), "un tocco: la scheda del medico apre BLU MARCO");
  const giro = srv.log.slice(n0).filter((x) => x.medico && x.tipo === "document").map((x) => `${x.metodo === "POST" ? "POST " : ""}${x.mvpg}${x.ep ? ":" + x.ep : ""}`);
  check(/^PsoPsoImposta,POST PsoPsoImposta,PsoEpisodioClinicoAmbulatorio:730011$/.test(giro.join()),
    `…come un clic sulla sua riga della lista smart, nella scheda del medico: Imposta, «Conferma», la lista, il link della sua riga (${giro.join(" → ")})`);
  check(srv.conferme.length === 1 && srv.conferme[0].medico && srv.conferme[0].id === AREE.bassa.id && srv.area === "bassa",
    `un «Conferma» solo, dalla scheda del medico, sull'area Bassa (${JSON.stringify(srv.conferme)})`);
  check(!!(await aspettaTel(/PC ora sull'area Bassa/, 30000)), `sul telefono: «PC ora sull'area Bassa» (${await avviso()})`);
  check(await finche(async () => /BLU MARCO/.test(await testata()) && !/solo dalla lista smart/.test(await testoTel()), 30000), "…e si apre BLU MARCO, col suo episodio vero");
  const pb = (await ls("patients.v1")).find((x) => x.ep === BLU.ep);
  check(!!pb && /EPISODIO_ID=730011$/.test(pb.url) && pb.ts > 0, `il PC lo conosce: la sua pagina, aperta (${pb && pb.url})`);
  check((await registro()).some((t) => /gestionale ora sull'area Bassa/.test(t)), "il registro del ponte sul PC dice che l'area è cambiata");
  const pannello = await doc.evaluate(() => document.getElementById("psassist-host")?.shadowRoot?.innerHTML || "");
  check(/Dall'iPhone: il gestionale è passato all'area Bassa/.test(pannello), "…e la pagina dove il medico atterra lo dice nel pannello");
  await foto("4-blu-aperto");

  // ---- lo stesso numero rimandato: la stessa risposta, nessun secondo passaggio
  const rq = Object.keys((await sw.evaluate(() => chrome.storage.session.get("ponte.area.rq")))["ponte.area.rq"] || {}).find((k) => !rqPrima.includes(k));
  const c0 = srv.conferme.length, i0 = imposte().length;
  const di = await sw.evaluate(({ ep, rq }) => Promise.all([ponteAreaApri({ ep, rq }), ponteAreaApri({ ep, rq })]), { ep: chiaveSmart(BLU), rq });
  await sospendi(1500);
  check(!!rq && di.every((x) => x.ok && x.dati.area === "Bassa" && x.dati.ep === BLU.ep) && srv.conferme.length === c0 && imposte().length === i0,
    `lo stesso numero rimandato (due volte insieme): «PC ora sull'area Bassa» com'era, nessun Imposta, nessun «Conferma» (${JSON.stringify(di[0])})`);
  // (il tocco su BLU qui sopra è passato: il telefono manda l'ora del tocco — senza, il PC dice «Scaduta»)
  check(!(await registro()).some((t) => /arrivato tardi/.test(t)), "il tocco del telefono porta la sua ora (`nato`): il PC l'ha fatto");

  // ---- (revisione 3.87, P2-3) arrivato più di 30 secondi dopo il tocco: niente cambiato; rimandato, la stessa risposta
  {
    const c1 = srv.conferme.length, i1 = imposte().length, nv1 = navMedico, rqT = "rq-tardi-prova-01";
    const tardi = await sw.evaluate(({ ep, rq }) => ponteAreaApri({ ep, rq, nato: Date.now() - 60e3 }), { ep: chiaveSmart(GRIGI), rq: rqT });
    const ancora = await sw.evaluate(({ ep, rq }) => ponteAreaApri({ ep, rq, nato: Date.now() }), { ep: chiaveSmart(GRIGI), rq: rqT });
    const senza = await sw.evaluate(({ ep }) => ponteAreaApri({ ep, rq: "rq-senza-ora-01" }), { ep: chiaveSmart(GRIGI) });
    await sospendi(1500);
    const annotato = ((await sw.evaluate(() => chrome.storage.session.get("ponte.area.rq")))["ponte.area.rq"] || {})[rqT];
    check(!!tardi && tardi.ok === false && tardi.errore === "Scaduta: niente cambiato" && !!senza && senza.errore === tardi.errore
      && srv.conferme.length === c1 && imposte().length === i1 && navMedico === nv1,
      `un «Passa il PC all'area» arrivato 60 secondi dopo il tocco (o senza l'ora): «${tardi && tardi.errore}», nessun Imposta, la scheda del medico ferma`);
    check(!!ancora && ancora.errore === "Scaduta: niente cambiato" && !!annotato && annotato.esito && annotato.esito.scaduto === true,
      `…annotato in ponte.area.rq: rimandato con lo stesso numero, la stessa risposta («${ancora && ancora.errore}»)`);
  }

  // ---- sul PC di sola lettura: rifiutato (il primo muro, nel service worker)
  const mini = await sw.evaluate(async () => {
    self.PSA_SOLA_LETTURA = true;
    try { return await ponteRisposta({}, { cmd: "areaApri", ep: "sm123", rq: "rq-mini-prova-01" }); } finally { self.PSA_SOLA_LETTURA = false; }
  });
  check(mini && mini.ok === false && mini.solaLettura === true, `sul PC di sola lettura «areaApri» è rifiutato: «${mini && mini.errore}»`);
} catch (e) {
  console.error(e);
  fail++;
} finally {
  await telBrowser?.close().catch(() => {});
  relay?.chiudi?.();
  await ctx.close().catch(() => {});
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* niente */ }
}
console.log(fail ? `\n${fail} controlli falliti` : "\ntutti i controlli passati");
process.exit(fail ? 1 : 0);
