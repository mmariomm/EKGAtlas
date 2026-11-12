#!/usr/bin/env node
/*
 * Le aree del pronto soccorso, su pagine sintetiche fatte come quelle vere
 * (nomi, date e numeri inventati): la lista dei Pazienti divisa per area, il
 * titolo di un'area che passa da PsoPsoImposta (la tendina e «Conferma»), la
 * mappa dell'Alta, la stanza di prima che diventa quella del PS, la lista
 * smart cliccabile (conosciuto → la cartella; sconosciuto → la sua area, la
 * sua lista, il link della sua riga; due uguali → la lista) e il reset.
 * Il content script costruito gira in Chromium; il «server» è qui sotto.
 *   node test/aree.mjs            (prima: npm run build)
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// (mai la rete vera: nessun proxy, ogni nome risolto in locale — il gestionale finto passa dalle route di Playwright)
const RETE_CHIUSA = ["--proxy-server=direct://", "--host-resolver-rules=MAP * 127.0.0.1"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = process.env.PSA_CONTENT || join(root, "extension/content.js");   // (PSA_CONTENT: un'altra build, per provare il prima)
readFileSync(CONTENT);
const SHOTS = process.env.AREE_SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

// ---------------------------------------------------------------- il server
const ORIGIN = "https://smarthealth.multimedica.it";
const DIR = "/sa4pso/restrict/";
const AREE = {
  alta: { id: "00010001P", label: "AREA ALTA INTENSITA'" },
  bassa: { id: "00040001P", label: "AREA MEDIA - BASSA INTENSITA'" },
  obi: { id: "00050001P", label: "AREA OBI" },
  minori: { id: "00030001P", label: "CODICI MINORI" },
};
const P = (ep, name, nato, eta, triage, area) => ({ ep, name, nato, eta, triage, area });
function server() {
  const s = {
    area: "alta",
    pazienti: [
      P("700001", "ROSSI MARIO", "05/07/1947", 79, "ROSSO", "alta"),
      P("700002", "VERDI ANNA", "12/03/1960", 66, "ARANCIONE", "alta"),
      P("700011", "BIANCHI LUCA", "01/01/1980", 46, "VERDE", "bassa"),
      P("700012", "NERI PAOLA", "02/02/1990", 36, "AZZURRO", "bassa"),
      P("700021", "GIALLI SARA", "03/03/2000", 26, "BIANCO", "minori"),
      P("700031", "ESPOSITO CIRO", "04/04/1970", 56, "VERDE", "bassa"),
    ],
    log: [],
    filtro: "",
  };
  const linguetta = (p) => `<div class="myLinguetta" style=" border=1; background-color: ORANGE; color: White; "><table cellpadding="3" cellspacing="0" width="100%"><tbody><tr>
      <td nowrap="" width="1%"><img title="${p.triage}" src="icona:2.gif" width="18"></td>
      <td nowrap="" width="40%" title="${p.triage}"><strong>${p.name}</strong><br>${p.nato}(${p.eta})<small> NOTA</small></td>
      <td width="50%" title="motivo"><strong>MEDICO ESEMPIO</strong><br>DOLORE</td></tr></tbody></table></div>`;
  const testa = () => `<table class="AFCHeaderTable" border="0" width="100%"><tbody><tr><td>
      <table width="100%"><tbody><tr><td width="15%"></td>
      <td width="70%" align="center"><font style="font-size: 130%; font-weight: bolder; ">OSPEDALE ESEMPIO</font><br><font style="font-size: 110%; font-weight: bolder; ">${AREE[s.area].label}</font><br><b>Salve!</b></td>
      <td width="15%" align="right"><input value="PsoPazientiAmbulatorio" type="hidden" name="PAZIENTIHOME"><input value="OSPEDALE" type="hidden" name="Server">${AREE[s.area].id}<br>
        <input value="1" type="hidden" name="RISORSA_GRUPPO_ID">1 101<br></td></tr></tbody></table></td></tr></tbody></table>
    <table><tr><td class="SA4HeaderBarTDnoBold"><a class="SA4HeaderBarLinkSel" href="menuPso.do?MVPG=PsoPazienti">Pazienti</a> | <a class="SA4HeaderBarLink" href="menuPso.do?MVPG=PsoPsoImposta">Imposta</a></td></tr></table>`;
  const pagina = (titolo, corpo) => `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>${titolo}</title></head><body>${testa()}${corpo}</body></html>`;
  const listaPage = () => {
    const righe = s.pazienti.filter((p) => p.area === s.area && (!s.filtro || p.name.includes(s.filtro)));
    const tutte = s.pazienti.filter((p) => p.area === s.area).length;
    return pagina("Pronto Soccorso", `
      <a class="shiny-button" href="?MVPG=PsoPazientiTriage">Triage</a> <a class="shiny-button-selected" href="?MVPG=PsoPazientiAmbulatorio">Ambulatorio (${tutte})</a>
      <a class="shiny-button" href="?MVPG=PsoPazientiConsulenze">Consulenze (0)</a>
      <table><form method="post" name="PazientiFiltro" action="menuPso.do?ccsForm=PazientiFiltro:Edit&amp;MVPG=PsoPazientiAmbulatorio"></form>
        <tr><td>Assistito <input class="AFCInput" value="${s.filtro}" name="s_ASSISTITO"></td>
        <td><a href="#" onclick="window.open('menuPsoSmart.do?MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=TUTTI','smart');return false;"><img src="icona:elenco_smart.png"></a></td></tr></table>
      <table class="AFCFormTABLE">${righe.map((p) => `<tr>
        <td class="AFCDataTD"></td><td class="AFCDataTD" name="EPISODIO">2026/0${p.ep}</td>
        <td class="AFCDataTD"><a style="text-decoration: none" href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${p.ep}" title="Apri Episodio">${linguetta(p)}</a></td>
        <td class="AFCDataTD"><a href="menuPsoEpisodio.do?MVPG=PsoEpisodioDiario&amp;EPISODIO_ID=${p.ep}" title="Apri Diario Clinico">d</a>
          <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${p.ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">L</a></td>
        <td class="AFCDataTD" name="INGRESSO">08:48</td><td class="AFCDataTD" name="MEDICO">MEDICO ESEMPIO</td></tr>`).join("")}</table>`);
  };
  const impostaPage = () => pagina("Pronto Soccorso", `
      <form method="post" action="menuPso.do?ccsForm=RisorsaImposta:Edit&amp;MVPG=PsoPsoImposta"><table><tr><td>
        <select class="AFCSelect" onchange="document.getElementById('AGG_RISORSA').click();" name="RISORSA_ID">
          <option value="00020001P">TRIAGE</option>
          ${Object.values(AREE).map((a) => `<option value="${a.id}"${a === AREE[s.area] ? ' selected=""' : ""}>${a.label}</option>`).join("")}
        </select><input value="" type="hidden" name="PAZIENTIHOME"></td></tr>
        <tr><td><input id="AGG_RISORSA" class="AFCButton" value="Conferma" type="submit" name="Update"></td></tr></table></form>`);
  const pazientePage = (ep) => {
    const p = s.pazienti.find((x) => x.ep === ep);
    return pagina(p.name, `<form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${ep}"></form>
      <table><tr><td title="${p.triage}"><font style="font-size: 150%">${p.name}</font><br><font style="font-size: 120%">${p.nato} (${p.eta}) M</font></td></tr></table>
      <a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${ep}">Episodio</a>
      <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">Laboratorio</a>
      <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${ep}&amp;RISORSA_ID=00120001P&amp;RISORSE=00120001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Radiologia">Radiologia</a>
      <h1 id="cartella">Cartella ${ep}</h1>`);
  };
  const smartPage = () => pagina("Pronto Soccorso", `
      <a class="shiny-button-selected" href="?MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=TUTTI">Ambulatorio (${s.pazienti.length})</a>
      <table><form method="post" name="PazientiFiltro" action="menuPsoSmart.do?ccsForm=PazientiFiltro:Edit&amp;MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=TUTTI"></form>
        <tr><td><input name="s_ASSISTITO" value=""></td><td><select class="AFCSelect" name="s_PERCORSO"><option selected value="">tutti</option>
          <option value="1">AREA ALTA INTENSITA'</option><option value="4">AREA MEDIA - BASSA INTENSITA'</option><option value="5">AREA OBI</option><option value="3">CODICI MINORI</option></select></td>
        <td><a onclick="javascript:window.close();" class="shiny-button" href="?MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=TUTTI">Chiudi</a></td></tr></table>
      <table class="AFCFormTABLE" id="smart">${s.pazienti.map((p) => `<tr data-ep="${p.ep}">
        <td class="AFCDataTD"></td><td class="AFCDataTD" nowrap="">2026/0${p.ep}<br></td>
        <td class="AFCDataTD" nowrap="" name="">${linguetta(p)}</td>
        <td class="AFCDataTD" nowrap="">21/09/2026 08:54</td>
        <td class="AFCDataTD" nowrap="">MEDICO ESEMPIO<br><label><label><b>AMBULATORIO</b></label></label></td>
        <td class="AFCDataTD">${AREE[p.area].label} </td>
        <td class="AFCDataTD" nowrap=""><img src="icona:note.gif" title="Apri Note Interne"></td><td class="AFCDataTD"></td></tr>`).join("")}</table>`);
  function handle(method, url, body) {
    const u = new URL(url), mvpg = u.searchParams.get("MVPG");
    s.log.push(`${method} ${u.pathname.replace(DIR, "")}${u.search}${body ? " " + body : ""}`);
    if (method === "POST" && u.searchParams.get("ccsForm") === "RisorsaImposta:Edit") {
      const id = new URLSearchParams(body).get("RISORSA_ID");
      const k = Object.keys(AREE).find((x) => AREE[x].id === id);
      if (k) s.area = k;
      return listaPage();   // (il gestionale rinvia alla lista dell'area nuova)
    }
    if (mvpg === "PsoPazientiAmbulatorio" || mvpg === "PsoPazienti") return listaPage();
    if (mvpg === "PsoPsoImposta") return impostaPage();
    if (mvpg === "PsoPazientiSmart") return smartPage();
    if (mvpg === "PsoEpisodioClinicoAmbulatorio") return pazientePage(u.searchParams.get("EPISODIO_ID"));
    return pagina("Pronto Soccorso", "<p>altro</p>");
  }
  return { s, handle };
}
const URL_LISTA = `${ORIGIN}${DIR}menuPso.do?MVPG=PsoPazientiAmbulatorio`;
const URL_SMART = `${ORIGIN}${DIR}menuPsoSmart.do?MVPG=PsoPazientiSmart&PAZIENTI_FILTRO=TUTTI`;
const URL_PAZ = (ep) => `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${ep}`;

const browser = await (async () => {
  try { return await chromium.launch(); }
  catch { return await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }
})();
async function contesto(srv, { seed } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(8000);
  await context.addInitScript((seed) => {
    try {
      if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.4, y: 0.01, w: 0.59, h: 0.97 }));
      sessionStorage.setItem("psassist:navPannello.v1", JSON.stringify(Date.now()));
      if (seed && !sessionStorage.getItem("psassist-seme")) {
        sessionStorage.setItem("psassist-seme", "1");
        for (const [k, v] of Object.entries(seed)) localStorage.setItem("psassist:" + k, JSON.stringify(v));
      }
    } catch { /* niente */ }
  }, seed || null);
  await context.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const html = srv.handle(req.method(), req.url(), req.postData() || "");
    await route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(html, "latin1") });
  });
  const inietta = (p) => p.on("load", async () => { try { await p.addScriptTag({ path: CONTENT }); } catch { /* navigazione */ } });
  context.on("page", inietta);
  const page = await context.newPage();
  return { context, page };
}
// un blocco che si pianta (un selettore che non arriva) è un check fallito, non la fine del test
async function blocco(fn) { try { await fn(); } catch (e) { check(false, "si è fermato: " + String(e.message || e).split("\n")[0]); } }
const $p = (page, sel) => page.locator(`#psassist-host ${sel}`);
const pannello = (page) => page.waitForSelector("#psassist-host .card", { state: "attached", timeout: 10000 });
const ls = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem("psassist:" + k) || "null"), k);
const sezioni = (page) => page.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot, out = [];
  let cur = null;
  for (const el of r.querySelectorAll(".pzcoda > .pzsez, .pzcoda > .pzrow")) {
    if (el.classList.contains("pzsez")) out.push(cur = { t: el.textContent.trim(), eps: [] });
    else (cur || (out.push(cur = { t: "", eps: [] }), cur)).eps.push(el.querySelector(".pzapri")?.getAttribute("data-ep"));
  }
  return out;
});
const finoA = async (page, re, ms = 10000) => { await page.waitForURL(re, { timeout: ms }); await page.waitForLoadState("load"); };

// ---------------------------------------------------- 1. la lista per area
console.log("Pazienti per area");
await blocco(async () => {
  const srv = server();
  const { context, page } = await contesto(srv, { seed: { "tabellone.vista.v1": "entrambe" } });   // (qui conta chi sta in quale area, non quale mappa)
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  let sz = await sezioni(page);
  check(JSON.stringify(sz) === JSON.stringify([{ t: "Alta intensità", eps: ["700001", "700002"] }]),
    `la lista dell'Alta: una sezione «Alta intensità» coi suoi due (got: ${JSON.stringify(sz)})`);
  check(!(await $p(page, '[data-seg="esiti"].on, .esiti').count()), "la lista di un'area non è la pagina del primo paziente: si resta sui Pazienti");
  const paz = await ls(page, "patients.v1");
  const rossi = paz.find((p) => p.ep === "700001");
  check(rossi && rossi.ts === 0 && rossi.lista > 0 && /EPISODIO_ID=700001$/.test(rossi.url) && rossi.nato && !JSON.stringify(paz).includes("05/07/1947"),
    `chi è nella lista entra fra i pazienti col link della sua riga, mai aperto, e della nascita solo l'impronta (got: ${JSON.stringify(rossi)})`);
  // l'area cambia (come la cambierebbe il medico) e si apre la lista della Bassa
  srv.s.area = "bassa";
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  sz = await sezioni(page);
  check(JSON.stringify(sz.map((x) => x.t)) === JSON.stringify(["Alta intensità", "Bassa"])
    && sz[0].eps.join() === "700001,700002" && sz[1].eps.sort().join() === "700011,700012,700031",
  `due liste, due sezioni: Alta intensità e poi Bassa, ognuna coi suoi (got: ${JSON.stringify(sz)})`);
  const aree = await ls(page, "aree.v1");
  check(aree.membri["700001"].k === "alta" && aree.membri["700011"].k === "bassa" && aree.viste.alta && aree.viste.bassa, "aree.v1: membri e aree viste");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "aree-pazienti.png") });
  // arriva BRUNO nell'Alta; una lista filtrata (solo ROSSI) aggiunge e basta
  srv.s.area = "alta";
  srv.s.pazienti.push(P("700003", "BRUNO ELIO", "06/06/1966", 60, "VERDE", "alta"));
  await page.goto(URL_LISTA);
  await pannello(page);
  srv.s.filtro = "ROSSI";
  await page.goto(URL_LISTA + "&s_ASSISTITO=ROSSI");
  await pannello(page);
  srv.s.filtro = "";
  let membri = (await ls(page, "aree.v1")).membri;
  check(["700001", "700002", "700003"].every((ep) => membri[ep]?.k === "alta"), "una lista filtrata non toglie nessuno");
  // VERDI, aperta: la sua pagina la fa «vista adesso» e ne tiene l'impronta della nascita
  await page.goto(URL_PAZ("700002"));
  await page.waitForSelector("#psassist-host", { state: "attached" });
  await page.waitForTimeout(300);
  const verdi = (await ls(page, "patients.v1")).find((p) => p.ep === "700002");
  check(verdi && verdi.ts > 0 && verdi.nato && verdi.name === "VERDI ANNA" && /EPISODIO_ID=700002$/.test(verdi.url), `aperta, VERDI è «vista» (got: ${JSON.stringify(verdi)})`);
  // la lista dell'Alta riaperta senza VERDI e BRUNO: escono dall'Alta; BRUNO,
  // mai aperto, c'era solo per la lista e se ne va; VERDI resta, senza area, in cima
  srv.s.pazienti = srv.s.pazienti.filter((p) => !["700002", "700003"].includes(p.ep));
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  sz = await sezioni(page);
  membri = (await ls(page, "aree.v1")).membri;
  const paz2 = await ls(page, "patients.v1");
  check(JSON.stringify(sz) === JSON.stringify([{ t: "", eps: ["700002"] }, { t: "Alta intensità", eps: ["700001"] }, { t: "Bassa", eps: ["700011", "700012", "700031"] }])
    && !membri["700002"] && !membri["700003"] && !paz2.some((p) => p.ep === "700003") && paz2.some((p) => p.ep === "700002"),
  `la lista riaperta rifà la sua sezione: chi non c'è più ne esce (got: ${JSON.stringify(sz)})`);
  await context.close();
});

// ------------------------------------- 2. il titolo apre la lista dell'area
console.log("Il titolo di un'area");
await blocco(async () => {
  const srv = server();
  const { context, page } = await contesto(srv, { seed: { "tabellone.vista.v1": "entrambe" } });
  srv.s.area = "bassa";
  await page.goto(URL_LISTA);
  await pannello(page);
  srv.s.area = "alta";
  await page.goto(URL_LISTA);
  await pannello(page);
  srv.s.log.length = 0;
  await $p(page, '.pzsezt[data-sez="bassa"]').click();
  await page.waitForFunction(() => /AREA MEDIA - BASSA/.test(document.body?.textContent || "") && document.querySelector('form[name="PazientiFiltro"]'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const passi = srv.s.log.map((l) => l.replace(/\?.*?MVPG=/, " ").split(" ").slice(0, 2).join(" "));
  check(srv.s.log[0] === "GET menuPso.do?MVPG=PsoPsoImposta" && /^POST menuPso\.do\?ccsForm=RisorsaImposta:Edit&MVPG=PsoPsoImposta RISORSA_ID=00040001P&PAZIENTIHOME=&Update=Conferma$/.test(srv.s.log[1] || ""),
    `«Bassa» → PsoPsoImposta, la tendina sull'area, il suo «Conferma» (got: ${JSON.stringify(srv.s.log)})`);
  check(srv.s.area === "bassa" && (await ls(page, "area.corrente.v1"))?.k === "bassa" && !(await ls(page, "area.vai.v1")), "si atterra sulla lista della Bassa, e il passaggio è finito");
  const opz = await ls(page, "aree.opzioni.v1");
  check(opz?.bassa?.id === "00040001P" && opz?.alta?.id === "00010001P" && opz?.minori?.id === "00030001P" && opz?.["x:TRIAGE"]?.label === "TRIAGE",
    `le opzioni delle aree restano annotate, riconosciute dal nome (un nome che non si riconosce resta il suo) (got: ${JSON.stringify(opz)})`);
  check(passi.length === 2, `niente altro: due richieste (got: ${passi.length})`);
  // il titolo dell'area in cui si è già: la lista, senza passare da PsoPsoImposta
  await pannello(page);
  srv.s.log.length = 0;
  await $p(page, '.pzsezt[data-sez="bassa"]').click();
  await page.waitForTimeout(800);
  check(srv.s.log.length >= 1 && srv.s.log.every((l) => /MVPG=PsoPazientiAmbulatorio/.test(l)), `l'area di adesso: dritti alla lista (got: ${JSON.stringify(srv.s.log)})`);
  await context.close();
});

// --------------------------------------------------- 3. la mappa dell'Alta
console.log("La mappa dell'Alta, e la stanza di prima");
await blocco(async () => {
  const srv = server();
  const vecchia = { letti: [{ id: "x1", c: 0, r: 0, nome: "Letto X" }, { id: "x2", c: 6, r: 0, nome: "Letto Y" }], aree: [] };
  const { context, page } = await contesto(srv, { seed: { "stanza.v1": vecchia, "stanza.posti.v1": { 700011: { tipo: "letto", id: "x2", ts: Date.now() } } } });
  srv.s.area = "bassa";
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  check(JSON.stringify(await ls(page, "stanza.ps.v1")) === JSON.stringify(vecchia) && (await ls(page, "stanza.ps.posti.v1"))?.["700011"]?.id === "x2"
    && (await ls(page, "stanza.v1")) === null && (await ls(page, "stanza.posti.v1")) === null,
  "la stanza di prima è diventata quella del PS (stanza.ps.v1, stanza.ps.posti.v1), coi suoi posti");
  check((await $p(page, '[data-letto="x2"] .stp[data-stp="700011"]').count()) === 1 && (await $p(page, '[data-letto="obi1"]').count()) === 0,
    "nella Bassa la stanza di prima, e BIANCHI nel suo letto");
  srv.s.area = "alta";
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  const letti = await page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".stbed")].map((b) => {
    const r = b.getBoundingClientRect();
    return { id: b.getAttribute("data-letto"), nome: b.querySelector(".stname")?.textContent, cls: b.className, x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  const L = Object.fromEntries(letti.map((l) => [l.id, l]));
  check(letti.map((l) => l.id).sort().join() === "a1,a2,a3,ab1,ab2,as1,as2,as3,as4,box,rossa", `l'Alta: Box, 3, 2, 1, Rossa, quattro sedie, due barelle (got: ${letti.map((l) => l.id)})`);
  check(L.box?.nome === "Box" && L.rossa?.nome === "Rossa" && L.a3?.nome === "Letto 3" && L.ab1?.nome === "Attesa barellati 1" && L.as4?.nome === "Sedia 4",
    "i nomi dello schizzo");
  const ok = (c, m) => check(!!c, m);
  const fondo = (l) => l.y + l.h;
  ok(L.box.x < L.a3.x && L.a3.x < L.a2.x && L.a2.x < L.a1.x && L.a1.x < L.rossa.x, "in basso, da sinistra: Box, 3, 2, 1, Rossa");
  ok(/\bbox\b/.test(L.box.cls) && /\bbox\b/.test(L.rossa.cls) && L.box.w > L.a1.w && L.box.h > L.a1.h, "Box e Rossa: un letto grande nella sua cornice");
  ok(["as1", "as2", "as3", "as4"].every((k) => fondo(L[k]) <= L.box.y && /\bsedia\b/.test(L[k].cls)) && L.as1.x < L.as2.x && L.as2.x < L.as3.x && L.as3.x < L.as4.x,
    "sopra la fila: le sedie, in fila");
  ok(L.as4.x - (L.as3.x + L.as3.w) > L.as2.x - (L.as1.x + L.as1.w) + 20 && L.as4.x >= L.rossa.x && L.as4.x + L.as4.w <= L.rossa.x + L.rossa.w, "uno spazio, poi la quarta sedia sopra la Rossa");
  ok(fondo(L.ab1) <= L.as1.y && fondo(L.ab2) <= L.as1.y && L.ab1.x <= L.box.x + 2 && L.ab1.x < L.ab2.x && L.ab1.h > L.ab1.w && /\bbarella\b/.test(L.ab1.cls),
    "in alto a sinistra, sopra tutto: le due barelle, strette e in piedi");
  check((await ls(page, "stanza.alta.v1")) === null, "la mappa dell'Alta si vede senza essere salvata");
  // un paziente in un letto dell'Alta: il posto sta nella mappa dell'Alta
  await $p(page, '.pzrow[data-riga="700001"] .pzmetti').click();
  await $p(page, '.stmi[data-dove="letto:rossa"]').click();
  await page.waitForTimeout(200);
  check((await ls(page, "stanza.alta.posti.v1"))?.["700001"]?.id === "rossa" && !(await ls(page, "stanza.ps.posti.v1"))?.["700001"]
    && (await $p(page, '[data-letto="rossa"] .stp[data-stp="700001"]').count()) === 1, "ROSSI nella Rossa: stanza.alta.posti.v1");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "aree-alta.png") });
  // ⋯ → Modifica la stanza: si ritocca la mappa dell'Alta
  await $p(page, "#menubtn").click();
  await $p(page, "#stmodmenu").click();
  await $p(page, "#stpiuletto").click();
  await page.keyboard.press("Escape");
  await $p(page, "#stfine").click().catch(() => {});
  const salvata = await ls(page, "stanza.alta.v1");
  check(salvata && salvata.letti.length === 12 && salvata.letti.find((l) => l.id === "box")?.forma === "box"
    && JSON.stringify(await ls(page, "stanza.ps.v1")) === JSON.stringify(vecchia), "Modifica tocca la mappa dell'Alta (con box e barelle), non quella del PS");
  // il reset: via le aree e i posti; le stanze e le opzioni restano
  await page.evaluate(() => localStorage.setItem("psassist:aree.opzioni.v1", JSON.stringify({ alta: { id: "00010001P", label: "AREA ALTA INTENSITA'" } })));
  const leggiTutto = () => page.evaluate(() => Object.fromEntries(["aree.v1", "stanza.alta.posti.v1", "stanza.ps.posti.v1", "patients.v1", "stanza.alta.v1", "stanza.ps.v1", "aree.opzioni.v1"]
    .map((k) => [k, localStorage.getItem("psassist:" + k)])));
  const primaReset = await leggiTutto();
  await $p(page, "#menubtn").click();
  await $p(page, "#resetpaz").click();
  await $p(page, "#resetpaz").click();
  await page.waitForTimeout(500);
  const dopo = await leggiTutto();
  check(!dopo["aree.v1"] && !dopo["stanza.alta.posti.v1"] && !dopo["stanza.ps.posti.v1"] && !dopo["patients.v1"],
    `«Dimentica i dati…»: via chi sta in quale area e i posti (got: ${JSON.stringify(Object.keys(dopo).filter((k) => dopo[k]))})`);
  check(!!dopo["stanza.alta.v1"] && !!dopo["stanza.ps.v1"] && !!dopo["aree.opzioni.v1"], "restano le stanze e le opzioni delle aree");
  // «Annulla», 8 secondi, come per ogni altra cosa che si può rimpiangere: tutto com'era
  check(/Dati dei pazienti dimenticati/.test(await $p(page, ".stsnack").innerText().catch(() => "")), "dopo il reset: «Dati dei pazienti dimenticati · Annulla»");
  await $p(page, ".stannulla").click();
  await page.waitForTimeout(300);
  const rimesso = await leggiTutto();
  check(Object.keys(primaReset).every((k) => rimesso[k] === primaReset[k]), `«Annulla»: aree, posti e pazienti tornano com'erano (diversi: ${Object.keys(primaReset).filter((k) => rimesso[k] !== primaReset[k]).join(", ") || "nessuno"})`);
  await page.waitForTimeout(8500);
  const ancora = await leggiTutto();
  check(Object.keys(primaReset).every((k) => ancora[k] === primaReset[k]), "e finiti gli 8 secondi niente si cancella più (il resto del reset non parte)");
  await context.close();
});

// ---------------------------------------------------- 4. la lista smart
console.log("La lista smart");
async function smartDa(page) {
  const [pop] = await Promise.all([page.waitForEvent("popup"), page.evaluate((u) => { window.open(u, "smart", "width=900,height=700"); }, URL_SMART)]);
  await pop.waitForLoadState("load");
  await pop.waitForFunction(() => document.querySelector("tr.psassist-smart"), null, { timeout: 10000 });
  return pop;
}
await blocco(async () => {
  const srv = server();
  const { context, page } = await contesto(srv);
  srv.s.area = "alta";
  await page.goto(URL_LISTA);
  await pannello(page);
  // ESPOSITO due volte, con lo stesso nome e la stessa nascita (due episodi): non si indovina
  await page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem("psassist:patients.v1"));
    const rossi = l.find((p) => p.ep === "700001");
    for (const ep of ["700031", "700032"]) l.push({ ep, name: "ESPOSITO CIRO", url: rossi.url.replace("700001", ep), ts: Date.now(), nato: "", eta: 56 });
    localStorage.setItem("psassist:patients.v1", JSON.stringify(l));
  });
  // (l'impronta della nascita la mette la pagina: la si prende da ROSSI, rifatta per ESPOSITO)
  const pop = await smartDa(page);
  const impr = await pop.evaluate(() => {
    let h = 0x811c9dc5;
    for (const c of "04/04/1970") h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
    return h.toString(36);
  });
  await page.evaluate((impr) => {
    const l = JSON.parse(localStorage.getItem("psassist:patients.v1"));
    for (const p of l) if (p.name === "ESPOSITO CIRO") p.nato = impr;
    localStorage.setItem("psassist:patients.v1", JSON.stringify(l));
  }, impr);
  const riga = await pop.evaluate(() => {
    const tr = document.querySelector('tr[data-ep="700001"]');
    return { cls: tr.className, cur: getComputedStyle(tr).cursor, celle: tr.children.length, testo: tr.textContent.replace(/\s+/g, " ").length };
  });
  check(/psassist-smart/.test(riga.cls) && riga.cur === "pointer" && riga.celle === 8, `ogni riga è cliccabile: il puntatore, niente di aggiunto (got: ${JSON.stringify(riga)})`);
  await pop.hover('tr[data-ep="700011"] td:nth-child(4)');
  const ombra = await pop.evaluate(() => getComputedStyle(document.querySelector('tr[data-ep="700011"] td')).backgroundColor);
  check(ombra === "rgb(234, 242, 251)", `al passaggio un'ombra leggera (got: ${ombra})`);
  // conosciuto: la cartella, nella scheda del gestionale (quella da cui la smart è nata)
  srv.s.log.length = 0;
  await pop.click('tr[data-ep="700001"] td:nth-child(4)');
  await finoA(page, /EPISODIO_ID=700001/);
  check(/EPISODIO_ID=700001$/.test(page.url()) && /MVPG=PsoPazientiSmart/.test(pop.url()) && srv.s.log.every((l) => !/PsoPsoImposta/.test(l)),
    `ROSSI, conosciuto: la sua cartella nella scheda del gestionale; la smart resta (got: ${page.url()})`);
  // sconosciuto: la sua area (PsoPsoImposta, tendina, Conferma), la sua lista, il link della sua riga
  srv.s.log.length = 0;
  await pop.click('tr[data-ep="700021"] td:nth-child(4)');
  await finoA(page, /EPISODIO_ID=700021/, 15000);
  const giro = srv.s.log.map((l) => l.split(" ").slice(0, 2).join(" "));
  check(giro[0] === "GET menuPso.do?MVPG=PsoPsoImposta" && /RISORSA_ID=00030001P/.test(srv.s.log[1] || "") && giro[2] === "GET menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=700021",
    `GIALLI, sconosciuta: Codici minori da PsoPsoImposta, la lista, il link della sua riga (got: ${JSON.stringify(srv.s.log)})`);
  // due uguali: la lista della loro area, e lì ci si ferma
  srv.s.log.length = 0;
  await pop.click('tr[data-ep="700031"] td:nth-child(4)');
  await page.waitForFunction(() => /AREA MEDIA - BASSA/.test(document.body?.textContent || "") && document.querySelector('form[name="PazientiFiltro"]'), null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  check(srv.s.area === "bassa" && /MVPG=PsoPsoImposta/.test(page.url()) === true && srv.s.log.every((l) => !/EPISODIO_ID=7000/.test(l)),
    `ESPOSITO, due volte: non si indovina, si apre la lista della Bassa (got: ${JSON.stringify(srv.s.log)})`);
  await pop.close();
  // senza la finestra da cui è nata: nella stessa finestra
  const sola = await context.newPage();
  await sola.goto(URL_SMART);
  await sola.waitForFunction(() => document.querySelector("tr.psassist-smart"), null, { timeout: 10000 });
  await sola.click('tr[data-ep="700001"] td:nth-child(4)');
  await finoA(sola, /EPISODIO_ID=700001/);
  check(/EPISODIO_ID=700001$/.test(sola.url()), "senza la scheda del gestionale: la cartella nella stessa finestra");
  await context.close();
});

await browser.close();

// ------------------------------- 5. la lista smart con l'estensione vera
// Il clic arriva al service worker, che apre la cartella nella scheda da cui
// la finestra è nata e la porta davanti; il passaggio d'area gira lì.
console.log("La lista smart, con l'estensione");
await blocco(async () => {
  const EXT = join(root, "extension");
  const PROFILO = join("/tmp", "psa-aree-" + process.pid);
  const exe = process.env.CHROMIUM_PATH || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find((p) => { try { return readFileSync(p) && true; } catch { return false; } });
  const ctx = await chromium.launchPersistentContext(PROFILO, {
    headless: true, ...(exe ? { executablePath: exe } : {}),
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean), ...RETE_CHIUSA],
  });
  ctx.setDefaultTimeout(10000);
  try {
    const srv = server();
    await ctx.route(`${ORIGIN}/**`, async (route) => {
      const req = route.request();
      await route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(srv.handle(req.method(), req.url(), req.postData() || ""), "latin1") });
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(URL_LISTA);
    await page.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
    const pop = await smartDa(page);
    // (si conta chi apre: il service worker, non la finestra da sola)
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    await sw.evaluate(() => {
      const o = chrome.tabs.update.bind(chrome.tabs);
      globalThis.__aperte = [];
      chrome.tabs.update = (id, x) => { globalThis.__aperte.push(x && x.url); return o(id, x); };
    });
    srv.s.log.length = 0;
    await pop.click('tr[data-ep="700001"] td:nth-child(4)');
    await finoA(page, /EPISODIO_ID=700001/);
    const aperte = await sw.evaluate(() => globalThis.__aperte);
    check(/EPISODIO_ID=700001$/.test(page.url()) && /PsoPazientiSmart/.test(pop.url()) && /EPISODIO_ID=700001$/.test(aperte.find(Boolean) || "") && aperte.filter(Boolean).length === 1,
      `estensione: ROSSI si apre nella scheda del gestionale, dal service worker (got: ${page.url()} · ${JSON.stringify(aperte)})`);
    srv.s.log.length = 0;
    await pop.click('tr[data-ep="700021"] td:nth-child(4)');
    await finoA(page, /EPISODIO_ID=700021/, 15000);
    check(/RISORSA_ID=00030001P/.test(srv.s.log.join(" ")) && /EPISODIO_ID=700021$/.test(page.url()),
      `estensione: GIALLI, sconosciuta, passa dai Codici minori e si apre dalla loro lista (got: ${JSON.stringify(srv.s.log)})`);
  } finally {
    await ctx.close();
    rmSync(PROFILO, { recursive: true, force: true });
  }
});

console.log(fail ? `\nAREE: ${fail} CHECK FALLITI\n` : "\nAREE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
