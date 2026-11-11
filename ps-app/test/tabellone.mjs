#!/usr/bin/env node
/*
 * Il tabellone dei Pazienti, su pagine sintetiche fatte come quelle vere
 * (nomi, date e numeri inventati): Alta | Bassa | Entrambe con le due mappe e
 * la lista sotto; chi va dove (area e triage); la riga (posto, tempo in PS,
 * Lab · ECG · RX per stato) e la scheda al passaggio; la lista smart riletta
 * in una scheda dietro (ogni 10 minuti, e col ⟳) dal SUO link; chi esce da
 * un elenco intero è dimesso (con «Annulla») — e tutti i casi in cui no; il
 * clic sulla smart che passa da PsoPazienti e sopravvive al ricaricarsi della
 * pagina quando prende il fuoco.
 *   node test/tabellone.mjs          (prima: npm run build)
 *   PSA_CONTENT=<un'altra build> node test/tabellone.mjs   (per provare il prima)
 *   TAB_SHOTS=<cartella>  le fotografie
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = process.env.PSA_CONTENT || join(root, "extension/content.js");
readFileSync(CONTENT);
const SHOTS = process.env.TAB_SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const SOLO = (process.argv[2] || "").toLowerCase();

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
const pad = (n) => String(n).padStart(2, "0");
const hm = (t) => `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`;
const dmy = (t) => { const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const P = (ep, name, nato, eta, triage, area, minuti = 60, scheda = "amb") => ({ ep, name, nato, eta, triage, area, arrivo: Date.now() - minuti * 60e3, scheda });
const impronta = (d) => { let h = 0x811c9dc5; for (const c of d) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h.toString(36); };
const LINK_SMART = "menuPsoSmart.do?MVPG=PsoPazientiSmart&PAZIENTI_FILTRO=AMB_7";
// le pagine del gestionale si ricaricano quando prendono il fuoco (come quelle vere)
const FUOCO = `<script>var pageState="nuovo";function refreshOnLoad(){pageState="load";refreshOnFocus();}
  function refreshOnFocus(){if(pageState=="nuovo")return;if(pageState=="load"){pageState="refresh";}else{window.location.reload(false);}}</script>`;

function server() {
  const s = {
    area: "alta",
    pazienti: [
      P("700001", "ROSSI MARIO", "05/07/1947", 79, "ROSSO", "alta", 220),
      P("700002", "VERDI ANNA", "12/03/1960", 66, "ARANCIONE", "alta", 95),
      P("700003", "NERI LUIGI", "07/07/1957", 69, "AZZURRO", "alta", 30),
      P("700011", "BIANCHI LUCA", "01/01/1980", 46, "VERDE", "bassa", 50),
      P("700012", "NERI PAOLA", "02/02/1990", 36, "AZZURRO", "bassa", 40),
      P("700021", "GIALLI SARA", "03/03/2000", 26, "BIANCO", "minori", 20),
      P("700031", "ESPOSITO CIRO", "04/04/1970", 56, "ROSSO", "obi", 600),
      P("700032", "FERRARI ELSA", "05/05/1950", 76, "VERDE", "obi", 700),
      P("700033", "COSTA PIA", "06/06/1940", 86, "", "obi", 500),
      P("700041", "MARINI ADA", "08/08/1988", 38, "VERDE", "bassa", 10, "tri"),
    ],
    log: [],
    filtro: "",
    smartFiltro: "",
    smartSel: "TUTTI",          // la scheda della smart che si apre dal link
    smartConto: null,           // un conto «sbagliato» (monca)
    smartLogin: false,
    link: LINK_SMART,
    focus: false,               // le pagine portano refreshOnFocus
    shell: true,                // dopo «Conferma»: 302 → PsoPazienti, che rimanda alla lista
    rich: {},                   // ep → le richieste della sua pagina: [{ esame, quando, referto }] (le righe RICH del gestionale)
  };
  const linguetta = (p) => `<div class="myLinguetta" style=" border=1; background-color: ORANGE; color: White; "><table cellpadding="3" cellspacing="0" width="100%"><tbody><tr>
      <td nowrap="" width="1%"><img title="${p.triage || "esame"}" src="icona:2.gif" width="18"></td>
      <td nowrap="" width="40%" title="${p.triage || "esame"}"><strong>${p.name}</strong><br>${p.nato}(${p.eta})<small> NOTA</small></td>
      <td width="50%" title="motivo"><strong>MEDICO ESEMPIO</strong><br>DOLORE</td></tr></tbody></table></div>`;
  const testa = (label) => `<table class="AFCHeaderTable" border="0" width="100%"><tbody><tr><td>
      <table width="100%"><tbody><tr><td width="15%"></td>
      <td width="70%" align="center"><font style="font-size: 130%; font-weight: bolder; ">OSPEDALE ESEMPIO</font><br><font style="font-size: 110%; font-weight: bolder; ">${label || AREE[s.area].label}</font><br><b>Salve!</b></td>
      <td width="15%" align="right">${AREE[s.area].id}<br></td></tr></tbody></table></td></tr></tbody></table>
    <table><tr><td class="SA4HeaderBarTDnoBold"><a class="SA4HeaderBarLinkSel" href="menuPso.do?MVPG=PsoPazienti">Pazienti</a> | <a class="SA4HeaderBarLink" href="menuPso.do?MVPG=PsoPsoImposta">Imposta</a></td></tr></table>`;
  const pagina = (titolo, corpo, label) => `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>${titolo}</title>${s.focus ? FUOCO : ""}</head><body${
    s.focus ? ' onfocus="refreshOnFocus()" onload="refreshOnLoad()"' : ""}>${testa(label)}${corpo}</body></html>`;
  const listaPage = () => {
    const righe = s.pazienti.filter((p) => p.area === s.area && p.scheda === "amb" && (!s.filtro || p.name.includes(s.filtro)));
    const tutte = s.pazienti.filter((p) => p.area === s.area && p.scheda === "amb").length;
    return pagina("Pronto Soccorso", `
      <a class="shiny-button" href="?MVPG=PsoPazientiTriage">Triage</a> <a class="shiny-button-selected" href="?MVPG=PsoPazientiAmbulatorio">Ambulatorio (${s.contoLista ?? tutte})</a>
      <table><form method="post" name="PazientiFiltro" action="menuPso.do?ccsForm=PazientiFiltro:Edit&amp;MVPG=PsoPazientiAmbulatorio"></form>
        <tr><td>Assistito <input class="AFCInput" value="${s.filtro}" name="s_ASSISTITO"></td>
        <td class="AFCFieldCaptionTD"><a href="#" title="Lista" class="myButtonList" onclick="window.open('${s.link.replace(/&/g, "&amp;")}','smart');"><img src="icona:elenco_smart.png" width="22"></a></td></tr></table>
      <table class="AFCFormTABLE">${righe.map((p) => `<tr>
        <td class="AFCDataTD"></td><td class="AFCDataTD" name="EPISODIO">2026/0${p.ep}</td>
        <td class="AFCDataTD"><a style="text-decoration: none" href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${p.ep}" title="Apri Episodio">${linguetta(p)}</a></td>
        <td class="AFCDataTD"><a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${p.ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">L</a></td>
        <td class="AFCDataTD" name="INGRESSO">${hm(p.arrivo)}</td><td class="AFCDataTD" name="MEDICO">MEDICO ESEMPIO</td></tr>`).join("")}</table>
      <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=1&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio" style="display:none">L</a>`);
  };
  const shellPage = () => pagina("Pronto Soccorso", `<table><tr><td style="VISIBILITY: hidden"><meta http-equiv="refresh" content="0; URL=?MVPG=PsoPazientiAmbulatorio">&nbsp; </td></tr></table>`, "NESSUNA AREA");
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
      <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">Laboratorio</a>
      <h1 id="cartella">Cartella ${ep}</h1>
      <table>${(s.rich[ep] || []).map((r, i) => `<tr><td class="AFCDataTD" title="${r.esame}">${r.referto ? `<a href="#" title="REFERTO" onclick="javascript:window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=*T&amp;REFERTO_SISTEMA=HL7RIS&amp;REFERTO_ID=r${ep}${i}','HL7RIS')"><img alt="referto"></a>` : ""}
        ${r.esame}<input type="hidden" name="TIPO" value="RICH"><input type="hidden" name="DATA_ORD" value="${r.quando}"><input type="hidden" name="DESCRIZIONE_TITLE" value="${r.esame}"></td></tr>`).join("")}</table>`);
  };
  const smartPage = (u) => {
    if (s.smartLogin) return `<html><body><form><input type="text" name="u"><input type="password" name="p"></form></body></html>`;
    const sel = u.searchParams.get("PAZIENTI_FILTRO") === "TRI" ? "TRI" : u.searchParams.get("PAZIENTI_FILTRO") === "TUTTI" ? "TUTTI" : u.searchParams.get("PAZIENTI_FILTRO") === "AMB_7" ? s.smartSel : "AMB";
    const di = (k) => s.pazienti.filter((p) => k === "TUTTI" || p.scheda === (k === "TRI" ? "tri" : "amb"));
    const righe = di(sel).filter((p) => !s.smartFiltro || p.name.includes(s.smartFiltro));
    const scheda = (k, nome) => `<a class="${k === sel ? "shiny-button-selected" : "shiny-button"}" href="?MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=${k}">${nome} (${k === "AMB" && s.smartConto != null ? s.smartConto : di(k).length})</a>`;
    return pagina("Pronto Soccorso", `
      ${scheda("TRI", "Triage")}&nbsp;${scheda("AMB", "Ambulatorio")}&nbsp;${scheda("TUTTI", "Tutti")}
      <table><form method="post" name="PazientiFiltro" action="menuPsoSmart.do?ccsForm=PazientiFiltro:Edit&amp;MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=${sel}"></form>
        <tr><td><input name="s_ASSISTITO" value="${s.smartFiltro}"></td><td><select class="AFCSelect" name="s_PERCORSO"><option selected value="">tutti</option>
          <option value="1">AREA ALTA INTENSITA'</option><option value="4">AREA MEDIA - BASSA INTENSITA'</option><option value="5">AREA OBI</option><option value="3">CODICI MINORI</option></select></td>
        <td><a onclick="javascript:window.close();" class="shiny-button" href="?MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=${sel}">Chiudi</a></td></tr></table>
      <table class="AFCFormTABLE" id="smart">${righe.map((p) => `<tr data-ep="${p.ep}">
        <td class="AFCDataTD"></td><td class="AFCDataTD" nowrap="">2026/0${p.ep}<br></td>
        <td class="AFCDataTD" nowrap="" name="">${linguetta(p)}</td>
        <td class="AFCDataTD" nowrap="">${dmy(p.arrivo)} ${hm(p.arrivo)}</td>
        <td class="AFCDataTD" nowrap="">MEDICO ESEMPIO<br><label><label><b>AMBULATORIO</b></label></label></td>
        <td class="AFCDataTD">${AREE[p.area].label} </td>
        <td class="AFCDataTD" nowrap=""><img src="icona:note.gif" title="Apri Note Interne"></td><td class="AFCDataTD"></td></tr>`).join("")}</table>
      <meta http-equiv="refresh" content="10;URL=?MVPG=PsoPazientiSmart&amp;PAZIENTI_FILTRO=${sel}&amp;s_LINEA_ATTIVITA=&amp;s_PERCORSO=&amp;s_PAZINCARICO=">`);
  };
  function handle(method, url, body) {
    const u = new URL(url), mvpg = u.searchParams.get("MVPG");
    s.log.push(`${method} ${u.pathname.replace(DIR, "")}${u.search}${body ? " " + body : ""}`);
    if (method === "POST" && u.searchParams.get("ccsForm") === "RisorsaImposta:Edit") {
      const id = new URLSearchParams(body).get("RISORSA_ID");
      const k = Object.keys(AREE).find((x) => AREE[x].id === id);
      if (k) s.area = k;
      // (il gestionale risponde 302 → PsoPazienti; qui il rinvio lo fa la pagina: il 302 di route.fulfill non si intercetta)
      return s.shell ? `<html><head><meta http-equiv="refresh" content="0; URL=menuPso.do?MVPG=PsoPazienti"></head><body></body></html>` : listaPage();
    }
    if (mvpg === "PsoPazienti") return shellPage();
    if (mvpg === "PsoAccesso") return `<html><body><form><input type="text" name="u"><input type="password" name="p"></form></body></html>`;   // (la sessione scaduta)
    if (mvpg === "PsoPazientiAmbulatorio") return listaPage();
    if (mvpg === "PsoPsoImposta") return impostaPage();
    if (mvpg === "PsoPazientiSmart") return smartPage(u);
    if (mvpg === "PsoEpisodioClinicoAmbulatorio") return pazientePage(u.searchParams.get("EPISODIO_ID"));
    return pagina("Pronto Soccorso", "<p>altro</p>");
  }
  return { s, handle };
}
const URL_LISTA = `${ORIGIN}${DIR}menuPso.do?MVPG=PsoPazientiAmbulatorio`;
const URL_SMART_LINK = `${ORIGIN}${DIR}${LINK_SMART}`;
const URL_PAZ = (ep) => `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${ep}`;
const servi = (srv) => async (route) => {
  const req = route.request(), r = srv.handle(req.method(), req.url(), req.postData() || "");
  if (r && r.redirect) return route.fulfill({ status: 302, headers: { location: r.redirect }, body: "" });
  await route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(r, "latin1") });
};

const browser = await (async () => {
  try { return await chromium.launch(); }
  catch { return await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }
})();
// `finto`: un service worker per finta (chrome.runtime nella pagina), che
// risponde a quello che serve e annota tutto quello che gli si chiede.
async function contesto(srv, { seed, finto, w = 1280, h = 900, focusFinto = false } = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  context.setDefaultTimeout(8000);
  await context.addInitScript(({ seed, finto, focusFinto }) => {
    try {
      if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.02, y: 0.01, w: 0.96, h: 0.97 }));
      sessionStorage.setItem("psassist:navPannello.v1", JSON.stringify(Date.now()));
      if (seed && !localStorage.getItem("psassist-seme")) {
        localStorage.setItem("psassist-seme", "1");
        for (const [k, v] of Object.entries(seed)) localStorage.setItem("psassist:" + k, JSON.stringify(v));
      }
    } catch { /* niente */ }
    // come nel Chrome vero: portare davanti la finestra le dà il fuoco (e la pagina se ne accorge)
    if (focusFinto) window.focus = function () { setTimeout(() => window.dispatchEvent(new FocusEvent("focus")), 0); };
    if (finto) {
      const chiesti = [];
      window.__chiesti = chiesti;
      const risposta = (m) => {
        chiesti.push(m);
        if (m.t === "smartChi") return { ok: !!finto.smartChi };
        // (localStorage «__smartNo»: il service worker la rimanda, con quel perché)
        if (m.t === "smartSotto") return localStorage.getItem("__smartNo") ? { ok: false, why: localStorage.getItem("__smartNo") } : { ok: true, tabId: 9 };
        if (m.t === "smartFine") return { ok: true };
        if (m.t === "getStorico") return finto.storico ? (m.chiave ? { ok: true, dati: finto.storico.dati } : { ok: true, indice: [finto.storico.indice] }) : { ok: false };
        return { ok: false };
      };
      // (onMessage: per mandare alla pagina un comando dell'iPhone, come il service worker vero)
      const ascolta = [];
      window.__alPc = (m) => new Promise((ok) => { for (const f of ascolta) if (f(m, {}, ok) === true) return; ok(null); });
      window.chrome = { runtime: { id: "finto", lastError: undefined, sendMessage(m, cb) { const r = risposta(m); Promise.resolve().then(() => cb && cb(r)); },
        onMessage: { addListener(f) { ascolta.push(f); } } } };
    }
  }, { seed: seed || null, finto: finto || null, focusFinto });
  await context.route(`${ORIGIN}/**`, servi(srv));
  const inietta = (p) => p.on("load", async () => { try { await p.addScriptTag({ path: CONTENT }); } catch { /* navigazione */ } });
  context.on("page", inietta);
  if (process.env.TAB_DEBUG) context.on("page", (p) => {
    p.on("pageerror", (e) => console.log("    [pagina]", e.message, (e.stack || "").split("\n")[1]));
    p.on("requestfailed", (r) => console.log("    [rete]", r.url().slice(0, 120), r.failure()?.errorText));
  });
  const page = await context.newPage();
  return { context, page };
}
async function blocco(nome, fn) {
  if (SOLO && !nome.toLowerCase().includes(SOLO)) return;
  console.log(nome);
  try { await fn(); } catch (e) { check(false, "si è fermato: " + String(e.message || e).split("\n")[0]); }
}
const $p = (page, sel) => page.locator(`#psassist-host ${sel}`);
const pannello = async (page) => {
  try { await page.waitForSelector("#psassist-host .card", { state: "attached", timeout: 10000 }); }
  catch (e) {
    if (process.env.TAB_DEBUG) console.log("    [pannello]", page.url(), await page.evaluate(() => { const h = document.getElementById("psassist-host"); return h ? h.shadowRoot.innerHTML.slice(0, 400) : "nessun host: " + document.body.innerHTML.slice(0, 200); }));
    throw e;
  }
};
const ls = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem("psassist:" + k) || "null"), k);
const setLs = (page, k, v) => page.evaluate(([k, v]) => localStorage.setItem("psassist:" + k, JSON.stringify(v)), [k, v]);
const righe = (page) => page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".pzcoda .pzrow")].map((r) => r.getAttribute("data-pz")));
const finoA = async (page, re, ms = 10000) => { await page.waitForURL(re, { timeout: ms }); await page.waitForLoadState("load"); };
const rett = (page, sel) => page.evaluate((sel) => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(sel)].map((e) => {
  const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right };
}), sel);
// tutti i pazienti, già letti dalle liste delle aree (aree.v1) e uno aperto: lo stato seminato
function semeTabellone() {
  const ora = Date.now(), srv = server();
  const patients = srv.s.pazienti.filter((p) => p.scheda === "amb").map((p, i) => ({ ep: p.ep, name: p.name, url: URL_PAZ(p.ep), ts: i === 0 ? ora - 20 * 60e3 : 0,
    lista: ora, pk: "", triage: p.triage || undefined, eta: p.eta, nato: impronta(p.nato), arrivo: p.arrivo, ...(i === 0 ? { sesso: "M" } : {}) }));
  // un paziente senza area (aperto dalla sua pagina, mai visto in una lista)
  patients.push({ ep: "700051", name: "SENZA AREA", url: URL_PAZ("700051"), ts: ora - 5 * 60e3, pk: "", triage: "VERDE", eta: 50 });
  const membri = Object.fromEntries(srv.s.pazienti.filter((p) => p.scheda === "amb").map((p) => [p.ep, { k: p.area, ts: ora }]));
  const viste = Object.fromEntries(Object.keys(AREE).map((k) => [k, { label: AREE[k].label, ts: ora }]));
  // ROSSI: Lab in attesa da 50′, ECG con referto, RX in parte; il cuore rosso
  const stato = { 700001: { agg: ora, letto: ora - 60e3, righe: [
    { k: "r1", rid: "1", ts: ora - 50 * 60e3, esami: [["lab", "POTASSIO"], ["lab", "EMOCROMO"]], fatto: "", quando: 0 },
    { k: "r2", rid: "2", ts: ora - 70 * 60e3, esami: [["ecg", "ELETTROCARDIOGRAMMA"]], fatto: "referto", quando: ora - 30 * 60e3 },
    { k: "r3", rid: "3", ts: ora - 80 * 60e3, esami: [["img", "RX TORACE (A1)"]], fatto: "referto", quando: ora - 20 * 60e3 },
    { k: "r4", rid: "4", ts: ora - 40 * 60e3, esami: [["img", "RX ADDOME (A2)"]], fatto: "", quando: 0 }],
    vit: { ts: ora - 15 * 60e3, p: { spo2: 88, fc: 132, fr: 22, pas: 120, t: 36.8, acvpu: "A" }, righe: 1 } },
  // VERDI: tutto tornato (Lab blu); ECG in attesa da 40′
  700002: { agg: ora, letto: ora - 60e3, righe: [
    { k: "v1", rid: "5", ts: ora - 90 * 60e3, esami: [["lab", "POTASSIO"]], fatto: "risultati", quando: ora - 10 * 60e3 },
    { k: "v2", rid: "6", ts: ora - 40 * 60e3, esami: [["ecg", "ELETTROCARDIOGRAMMA"]], fatto: "", quando: 0 }] } };
  return { "patients.v1": patients, "aree.v1": { membri, viste }, "area.corrente.v1": { k: "alta", label: AREE.alta.label, id: AREE.alta.id, ts: ora },
    "stato.v1": stato, "dafare.v1": { 700001: [{ id: "a", testo: "rivalutare dolore", t: null, fatto: null, ord: 0, ts: ora }] },
    "stanza.alta.posti.v1": { 700001: { tipo: "letto", id: "rossa", ts: ora - 3 * 3600e3 } } };
}
const vista = (page) => page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".tbseg [data-vista]")].map((b) => `${b.getAttribute("data-vista")}${b.getAttribute("aria-checked") === "true" ? "*" : ""}`).join(" "));

// --------------------------------------- 1. Alta | Bassa | Entrambe, la lista sotto
await blocco("Il tabellone: Alta | Bassa | Entrambe, le mappe, la lista sotto", async () => {
  const srv = server();
  const { context, page } = await contesto(srv, { seed: semeTabellone() });
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  check((await vista(page)) === "alta* bassa entrambe", `il controllo: Alta | Bassa | Entrambe, e di partenza la mappa dell'area (got: ${await vista(page)})`);
  check((await $p(page, '.stmap[data-mappa="alta"]').count()) === 1 && (await $p(page, ".stmap").count()) === 1, "Alta: la mappa dell'Alta, una sola");
  await $p(page, '[data-vista="entrambe"]').click();
  await page.waitForTimeout(200);
  const mappe = await rett(page, ".stmap"), lista = await rett(page, ".pzcoda");
  check(mappe.length === 2 && (await $p(page, '.stmap[data-mappa="ps"]').count()) === 1, "Entrambe: le due mappe");
  check(lista.length === 1 && mappe.every((m) => m.b <= lista[0].y + 1), `la lista sta SOTTO le mappe (mappe fino a ${Math.round(Math.max(...mappe.map((m) => m.b)))}, lista da ${Math.round(lista[0]?.y)})`);
  check(Math.abs(mappe[0].y - mappe[1].y) < 2 && mappe[0].r <= mappe[1].x + 1, "larga: affiancate");
  check((await ls(page, "tabellone.vista.v1")) === "entrambe", "la scelta resta (tabellone.vista.v1)");
  const scorre = () => page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".stcanvas")].some((c) => c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1));
  check(!(await scorre()), "le mappe stanno nel loro spazio: niente da scorrere");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-entrambe.png") });
  // stretta: una sopra l'altra, sempre in scala (col Da fare ridotto alla sua barra:
  // aperto, sopra le mappe, ne prende un pezzo d'altezza — vedi «Il Da fare del tabellone»)
  await $p(page, "#tdtog").click();
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(300);
  const m2 = await rett(page, ".stmap");
  check(m2[0].b <= m2[1].y + 1 && !(await scorre()), "stretta: una sopra l'altra, e niente si scorre di lato");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-entrambe-stretta.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await $p(page, "#tdtog").click();
  // ROSSI nella Rossa: in Mappa sta sulla mappa e non nella lista; in Lista c'è, col suo posto
  check((await righe(page)).includes("700011") && !(await righe(page)).includes("700001")
    && (await $p(page, '.stmap[data-mappa="alta"] [data-letto="rossa"] .stp[data-stp="700001"]').count()) === 1, "Mappa: la lista ha solo chi non ha un posto (ROSSI è nella Rossa, sulla mappa)");
  await $p(page, '[data-modo="lista"]').click();
  await page.waitForTimeout(150);
  const rossi = await page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot, riga = r.querySelector('.pzrow[data-pz="700001"]');
    return { posto: riga?.querySelector(".pzposto")?.textContent,
      inps: riga?.querySelector(".pzinps")?.textContent, eta: riga?.querySelector(".pzeta")?.textContent, testo: riga?.textContent.replace(/\s+/g, " ") };
  });
  check(rossi.posto === "Rossa" && /^3h4[01]$/.test(rossi.inps) && rossi.eta === "79", `ROSSI: in Lista, col posto, il tempo in PS e l'età (got: ${JSON.stringify(rossi)})`);
  check(!/rivalutare|POTASSIO|referto/i.test(rossi.testo), "nella riga niente valori e niente testo (nemmeno il post-it)");
  // i segni: Lab grigio col tempo, ECG blu, RX arancio; VERDI: Lab blu, ECG grigio
  const segni = await page.evaluate(() => Object.fromEntries(["700001", "700002", "700011"].map((ep) => [ep,
    [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(`.pzrow[data-pz="${ep}"] .esm`)].map((e) => `${e.className.replace("esm ", "")}:${e.textContent}`)])));
  check(segni["700001"].join("|") === "es-lab att:Lab 50′|es-ecg ok:ECG ✓|es-img parz:RX 1/2", `ROSSI: Lab grigio 50′, ECG blu, RX arancio (got: ${segni["700001"].join("|")})`);
  check(segni["700002"].join("|") === "es-lab ok:Lab ✓|es-ecg att:ECG 40′" && segni["700011"].length === 0, `VERDI: Lab blu, ECG grigio; chi non ha chiesto niente: niente (got: ${JSON.stringify(segni)})`);
  const df = await page.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector('.pzrow[data-pz="700001"] .dfic b')?.textContent);
  check(df === "1", `e quante cose ha da fare (got: ${df})`);
  // Sposta in… con due mappe: i letti di tutt'e due; spostato nell'altra mappa, lascia la prima
  await $p(page, '.pzrow[data-pz="700011"] .pzmetti').click();
  const voci = await page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".stmi")].map((b) => b.getAttribute("data-dove")));
  check(voci.includes("letto:obi1@ps") && voci.includes("letto:a1@alta"), "«Sposta in…» con due mappe: i posti di tutt'e due");
  await $p(page, '.stmi[data-dove="letto:a1@alta"]').click();
  await page.waitForTimeout(150);
  await $p(page, '.pzrow[data-pz="700011"] .pzmetti').click();
  await $p(page, '.stmi[data-dove="letto:obi1@ps"]').click();
  await page.waitForTimeout(150);
  const posti = { alta: await ls(page, "stanza.alta.posti.v1"), ps: await ls(page, "stanza.ps.posti.v1") };
  check(!posti.alta["700011"] && posti.ps["700011"]?.id === "obi1", "un posto solo: in OBI 1, e l'Alta lo lascia");
  await context.close();
});

// --------------------------------------------- 1b. Mappa | Lista
await blocco("Mappa | Lista: la lista senza mappe, nell'ordine del gestionale", async () => {
  const srv = server();
  // l'Alta, come la lista del gestionale la dà: NERI L., ROSSI, VERDI (non per ingresso)
  const riordina = (pos) => srv.s.pazienti.sort((a, b) => (pos[a.ep] ?? 9) - (pos[b.ep] ?? 9));
  riordina({ 700003: 0, 700001: 1, 700002: 2 });
  const seed = semeTabellone();
  // la Bassa e l'OBI le ha lette una lista di prima (la riga n); FERRARI, ESPOSITO e GIALLI non le ha mai viste in una riga
  for (const [ep, n] of Object.entries({ 700012: 0, 700011: 1, 700033: 0 })) seed["aree.v1"].membri[ep].n = n;
  seed["stanza.ps.posti.v1"] = { 700011: { tipo: "letto", id: "obi1", ts: Date.now() - 3600e3 } };
  seed["tabellone.vista.v1"] = "entrambe";
  const { context, page } = await contesto(srv, { seed });
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  const modo = (page) => page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".tbseg [data-modo]")].map((b) => `${b.getAttribute("data-modo")}${b.getAttribute("aria-checked") === "true" ? "*" : ""}`).join(" "));
  const sequenza = (page) => page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".pzcoda > .pzsez, .pzcoda > .pzrow")]
    .map((e) => (e.classList.contains("pzsez") ? "T:" + e.textContent.trim() : e.getAttribute("data-pz"))).join(","));
  // Mappa (di partenza): le mappe, e la lista ha solo chi non ha un posto
  check((await modo(page)) === "mappa* lista dafare", `il controllo Mappa | Lista | Da fare, di partenza Mappa (got: ${await modo(page)})`);
  const inMappa = await righe(page);
  check((await $p(page, ".stmap").count()) === 2 && inMappa.length === 8 && !inMappa.includes("700001") && !inMappa.includes("700011"),
    `Mappa: le mappe, e la lista senza chi è già su un letto (got: ${inMappa.join(",")})`);
  check((await $p(page, '.stmap [data-letto="rossa"] .stp[data-stp="700001"]').count()) === 1 && (await $p(page, '.stmap [data-letto="obi1"] .stp[data-stp="700011"]').count()) === 1,
    "e quelli sono sulle mappe, ognuno al suo letto");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "lm-mappa.png") });
  // Lista: niente mappe, tutti, nell'ordine del gestionale dentro ogni area; le aree Alta, Bassa, OBI, Codici minori; chi non ha un'area, in fondo
  await $p(page, '[data-modo="lista"]').click();
  await page.waitForTimeout(150);
  check((await modo(page)) === "mappa lista* dafare" && (await $p(page, ".stmap").count()) === 0 && (await $p(page, ".pzrimetti").count()) === 0, "Lista: niente mappe");
  const atteso = "T:Alta intensità,700003,700001,700002,T:Bassa,700012,700011,T:OBI,700033,700032,700031,T:Codici minori,700021,700051";
  check((await sequenza(page)) === atteso, `Lista: tutti, aree Alta · Bassa · OBI · Codici minori, nell'ordine del gestionale; chi non è mai stato in una lista dopo, per ingresso; senza area in fondo\n      got: ${await sequenza(page)}`);
  const pill = await page.evaluate(() => Object.fromEntries([...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".pzcoda .pzrow")].map((r) => {
    const p = r.querySelector(".pzposto"), n = r.querySelector(".pznm"), t = r.querySelector(".pzinps");
    const pr = p?.getBoundingClientRect(), nr = n.getBoundingClientRect(), tr = t?.getBoundingClientRect();
    const st = p ? getComputedStyle(p) : null;
    return [r.getAttribute("data-pz"), p ? { testo: p.textContent, dopoIlNome: !!r.querySelector(".pzapri + .pzposto") && pr.x >= nr.right - 1 && (!tr || pr.right <= tr.x + 1),
      tonda: parseFloat(st.borderTopLeftRadius) >= 9, sfondo: st.backgroundColor !== "rgba(0, 0, 0, 0)" } : null];
  })));
  const conPosto = Object.entries(pill).filter(([, v]) => v).map(([ep, v]) => `${ep}:${v.testo}`).join(" ");
  check(conPosto === "700001:Rossa 700011:OBI 1" && Object.values(pill).filter(Boolean).every((v) => v.dopoIlNome && v.tonda && v.sfondo),
    `il posto in una pillola subito dopo il nome, solo per chi ce l'ha (got: ${conPosto})`);
  // le stesse spunte di sempre, e la scheda al passaggio sul nome
  const spunte = await page.evaluate(() => { const r = document.getElementById("psassist-host").shadowRoot.querySelector('.pzrow[data-pz="700001"]');
    return { cuore: !!r.querySelector(".cuore"), esami: [...r.querySelectorAll(".esm")].map((e) => e.textContent).join("|"), df: r.querySelector(".dfic b")?.textContent }; });
  check(spunte.cuore && spunte.esami === "Lab 50′|ECG ✓|RX 1/2" && spunte.df === "1", `ROSSI: ♥, Lab · ECG · RX e «Da fare», come in Mappa (got: ${JSON.stringify(spunte)})`);
  const nome = (await rett(page, '.pzrow[data-pz="700001"] .pznm'))[0];
  await page.mouse.move(nome.x + 10, nome.y + nome.h / 2);
  await page.waitForTimeout(500);
  check((await $p(page, ".pzcarta").count()) === 1, "e passando sul nome si apre la scheda");
  await page.mouse.move(5, 5);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "lm-lista.png") });
  // la scelta resta: ricaricando, e dopo «Dimentica i dati…» (è un'impostazione)
  check((await ls(page, "tabellone.modo.v1")) === "lista", "la scelta resta (tabellone.modo.v1)");
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  check((await modo(page)) === "mappa lista* dafare" && (await $p(page, ".stmap").count()) === 0, "ricaricata la pagina, è ancora Lista");
  // Alta | Bassa | Entrambe vale anche in Lista: Bassa = Bassa, Codici minori e l'OBI azzurro, verde o bianco (più chi non ha ancora un'area)
  await $p(page, '[data-vista="bassa"]').click();
  await page.waitForTimeout(150);
  const bassa = await sequenza(page);
  check(bassa === "T:Bassa,700012,700011,T:OBI,700033,700032,T:Codici minori,700021,700051", `Lista, vista Bassa: l'instradamento è quello di sempre (got: ${bassa})`);
  await $p(page, '[data-vista="entrambe"]').click();
  await page.waitForTimeout(150);
  // l'ordine viene dall'ultima lista intera letta: una filtrata non lo cambia, una intera sì
  const nDi = async () => Object.fromEntries(Object.entries((await ls(page, "aree.v1")).membri).map(([ep, v]) => [ep, v.n]));
  const n0 = await nDi();
  check(n0["700003"] === 0 && n0["700001"] === 1 && n0["700002"] === 2 && n0["700011"] === 1 && n0["700032"] === undefined,
    `aree.v1 tiene la riga di ognuno nella lista del gestionale (got: ${JSON.stringify(n0)})`);
  srv.s.filtro = "VERDI";
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  check((await nDi())["700002"] === 2 && (await sequenza(page)) === atteso, "una lista filtrata non cambia l'ordine");
  srv.s.filtro = "";
  riordina({ 700002: 0, 700001: 1, 700003: 2 });
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  check((await sequenza(page)).startsWith("T:Alta intensità,700002,700001,700003,T:Bassa"), `la lista del gestionale rimessa in un altro ordine: la Lista la segue (got: ${await sequenza(page)})`);
  // il reset toglie le aree (e la riga), non la scelta
  await $p(page, "#menubtn").click();
  await $p(page, "#resetpaz").click();
  await $p(page, "#resetpaz").click();
  await page.waitForTimeout(500);
  check(!(await ls(page, "aree.v1")) && (await ls(page, "tabellone.modo.v1")) === "lista", "«Dimentica i dati…»: via aree e righe, la scelta Lista resta");
  await $p(page, '[data-modo="mappa"]').click();
  await page.waitForTimeout(150);
  check((await ls(page, "tabellone.modo.v1")) === "mappa" && (await $p(page, ".stmap").count()) >= 1, "e tornando a Mappa, le mappe tornano");
  await context.close();
});

// --------------------------------------------- 2. chi va dove (area e triage)
await blocco("Chi va dove: l'area e il triage", async () => {
  const srv = server();
  const ora = Date.now();
  const combos = [
    ["a-r", "alta", "ROSSO", ["alta"]], ["a-n", "alta", "", ["alta"]], ["b-v", "bassa", "VERDE", ["bassa"]], ["m-b", "minori", "BIANCO", ["bassa"]],
    ["o-r", "obi", "ROSSO", ["alta"]], ["o-a", "obi", "ARANCIONE", ["alta"]], ["o-z", "obi", "AZZURRO", ["bassa"]], ["o-v", "obi", "VERDE", ["bassa"]],
    ["o-b", "obi", "BIANCO", ["bassa"]], ["o-x", "obi", "", ["alta", "bassa"]], ["n-v", "", "VERDE", ["alta", "bassa"]], ["x-r", "x:PEDIATRIA", "ROSSO", ["alta", "bassa"]],
  ];
  const patients = combos.map(([ep, , tr], i) => ({ ep: "8000" + String(i).padStart(2, "0"), name: `PAZ ${ep.toUpperCase().replace("-", "")}`, url: URL_PAZ("1"), ts: ora - i * 1000, pk: "", ...(tr ? { triage: tr } : {}) }));
  const membri = Object.fromEntries(combos.map(([, k], i) => [patients[i].ep, k ? { k, ts: ora } : null]).filter(([, v]) => v));
  const { context, page } = await contesto(srv, { seed: { "patients.v1": patients, "aree.v1": { membri, viste: {} } } });
  // (una lista monca, senza righe: non tocca chi sta in quale area)
  srv.s.pazienti = []; srv.s.contoLista = 99; srv.s.area = "bassa";
  await page.goto(URL_LISTA);
  await pannello(page);
  const per = {};
  for (const v of ["alta", "bassa", "entrambe"]) {
    await $p(page, `[data-vista="${v}"]`).click();
    await page.waitForTimeout(150);
    per[v] = new Set(await righe(page));
  }
  let tutti = true;
  for (const [i, [nome, , , dove]] of combos.entries()) {
    const ep = patients[i].ep, ok = ["alta", "bassa"].every((v) => per[v].has(ep) === dove.includes(v)) && per.entrambe.has(ep);
    if (!ok) tutti = false;
    check(ok, `${nome}: ${dove.join(" e ")} (got: ${["alta", "bassa"].filter((v) => per[v].has(ep)).join(" e ") || "nessuna"})`);
  }
  check(tutti && per.entrambe.size === combos.length, "Entrambe: tutti");
  const grigio = await page.evaluate((ep) => document.getElementById("psassist-host").shadowRoot.querySelector(`.pzrow[data-pz="${ep}"] .pztr`)?.className, patients[9].ep);
  check(/t-ignoto/.test(grigio || ""), `l'OBI senza triage: la striscia grigia (got: ${grigio})`);
  await context.close();
});

// --------------------------------------------------- 3. la scheda al passaggio
await blocco("La scheda al passaggio: sul nome e sul letto", async () => {
  const srv = server(), ora = Date.now();
  const storico = {
    indice: { chiave: "nome:ROSSI MARIO", cf: "", ep: "700001", paziente: { cognome: "ROSSI", nome: "MARIO" }, letto: ora, esami: 2, prelievi: 1 },
    dati: { ep: "700001", cf: "", paziente: { idMPI: "", cognome: "ROSSI", nome: "MARIO" }, periodo: "", letto: ora, scartate: [],
      date: [{ data: dmy(ora - 30 * 60e3), ora: hm(ora - 30 * 60e3), label: `${dmy(ora - 30 * 60e3)} ${hm(ora - 30 * 60e3)}`, chiave: `${dmy(ora - 30 * 60e3)} ${hm(ora - 30 * 60e3)}#1`, id: "1" }],
      righe: [{ nome: "POTASSIO", esame: "", codice: "", mnem: "", pos: 0, valori: [{ v: "5,9", stato: 1 }] },
        { nome: "EMOGLOBINA", esame: "", codice: "", mnem: "", pos: 1, valori: [{ v: "9,1", stato: -1 }] },
        { nome: "SODIO", esame: "", codice: "", mnem: "", pos: 2, valori: [{ v: "140", stato: 0 }] }],
      referti: [{ id: "e1", quando: `${dmy(ora - 30 * 60e3)} ${hm(ora - 30 * 60e3)}`, titolo: "ELETTROCARDIOGRAMMA", sistema: "HL7AMB",
        testo: "Ritmo sinusale a frequenza 98 bpm, PR nei limiti, sopraslivellamento ST in V2 V3 V4 da rivalutare" },
      { id: "x1", quando: `${dmy(ora - 20 * 60e3)} ${hm(ora - 20 * 60e3)}`, titolo: "RX TORACE", sistema: "HL7RIS", testo: "Non addensamenti parenchimali in atto. Seni costofrenici liberi." }] },
  };
  const { context, page } = await contesto(srv, { seed: semeTabellone(), finto: { storico } });
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  await page.waitForTimeout(1800);   // (la prima lettura della smart, chiesta all'avvio, è passata)
  const carta = () => page.evaluate(() => { const c = document.getElementById("psassist-host").shadowRoot.querySelector(".pzcarta"); return c ? [...c.querySelectorAll(".pc")].map((x) => x.textContent.replace(/\s+/g, " ").trim()) : null; });
  // la riga (in Lista): lontano dal nome niente scheda
  await $p(page, '[data-modo="lista"]').click();
  await page.waitForTimeout(200);
  const riga = await rett(page, '.pzrow[data-pz="700001"]'), nome = await rett(page, '.pzrow[data-pz="700001"] .pznm');
  await page.mouse.move(riga[0].r - 120, riga[0].y + riga[0].h / 2);
  await page.waitForTimeout(400);
  check((await carta()) === null, "sulla riga, fuori dal nome: niente scheda");
  await page.mouse.move(nome[0].x + 10, nome[0].y + nome[0].h / 2);
  await page.waitForTimeout(100);
  const presto = await carta();
  await page.waitForTimeout(350);
  const c1 = await carta();
  check(presto === null && Array.isArray(c1), "sul nome: dopo un quarto di secondo (non prima)");
  await page.waitForTimeout(300);   // i valori arrivano dalla scheda clinica
  const c = await carta();
  check(/^ROSSI MARIO 79 M · Rossa · 3h4[0-2]/.test(c?.[0] || ""), `1ª riga: nome, età, sesso, posto, tempo in PS (got: ${c?.[0]})`);
  check(/^♥ NEWS \d+ · SpO2 88 · FC 132/.test(c?.[1] || ""), `2ª: il cuore coi parametri fuori norma (got: ${c?.[1]})`);
  check(/K 5,9↑/.test(c?.[2] || "") && /Hb 9,1↓/.test(c?.[2] || "") && !/Na/.test(c?.[2] || ""), `3ª: i valori fuori range, solo quelli (got: ${c?.[2]})`);
  check(/^ECG ✓ \d\d:\d\d «Ritmo sinusale a frequenza 98 bpm/.test(c?.[3] || "") || /^ECG ✓ \d\d:\d\d Ritmo sinusale a frequenza 98 bpm/.test(c?.[3] || ""), `4ª: ECG, l'ora e le prime parole del referto (got: ${c?.[3]})`);
  // (in attesa: il tempo in ambra, senza ⏳ — i minuti lo dicono già)
  check(c?.some((x) => /^RX addome 40′/.test(x)) && !c?.some((x) => /⏳/.test(x)) && c?.some((x) => /^RX torace ✓ .*Non addensamenti/.test(x)), `RX: in attesa col tempo, refertato con le prime parole (got: ${c?.slice(4).join(" | ")})`);
  check(c?.length === 6, `niente altro (got: ${c?.length} righe)`);
  const dfCarta = await page.evaluate(() => [...(document.getElementById("psassist-host").shadowRoot.querySelectorAll(".pzcarta .pcd .dfr") || [])].map((x) => x.textContent.trim()));
  check(dfCarta.join("|") === "rivalutare dolore", `e sotto, le sue cose da fare aperte (got: ${dfCarta.join(" | ")})`);
  // le stesse righe del Da fare del tabellone: il tondo, la stessa altezza, la stessa lettera
  const righeUguali = await page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot, a = r.querySelector(".pzcarta .pcd .dfr"), b = r.querySelector(".tdcard .tdi");
    const m = (e) => e && { h: Math.round(e.getBoundingClientRect().height), f: getComputedStyle(e).fontSize, o: !!e.querySelector(".dfo, .dfck") };
    return { carta: m(a), tabellone: m(b) };
  });
  check(!!righeUguali.carta && JSON.stringify(righeUguali.carta) === JSON.stringify(righeUguali.tabellone),
    `nella scheda, la riga di sempre: come nel Da fare del tabellone (got: ${JSON.stringify(righeUguali)})`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-carta-riga.png") });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(100);
  check((await carta()) === null, "uscendo si chiude");
  // sul letto (in Mappa): la scheda non copre il letto
  await $p(page, '[data-modo="mappa"]').click();
  await page.waitForTimeout(200);
  const letto = (await rett(page, '[data-letto="rossa"]'))[0];
  await page.mouse.move(letto.x + letto.w / 2, letto.y + letto.h / 2);
  await page.waitForTimeout(700);
  const cr = (await rett(page, ".pzcarta"))[0];
  const copre = cr && !(cr.r <= letto.x || cr.x >= letto.r || cr.b <= letto.y || cr.y >= letto.b);
  check(!!cr && !copre, `sul letto: la scheda, fuori dal letto (letto ${Math.round(letto.x)}–${Math.round(letto.r)}, scheda ${Math.round(cr?.x)}–${Math.round(cr?.r)})`);
  const pe = await page.evaluate(() => getComputedStyle(document.getElementById("psassist-host").shadowRoot.querySelector(".pzcarta")).pointerEvents);
  check(pe === "none", "solo da leggere: il mouse ci passa attraverso");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-carta-letto.png") });
  await page.mouse.click(letto.x + letto.w / 2, letto.y + letto.h / 2);
  await finoA(page, /EPISODIO_ID=700001/);
  check(true, "il clic sul letto apre il paziente, come prima");
  await context.close();
});

// ------------------------------------------- 3b. il Da fare del tabellone
await blocco("Il Da fare del tabellone: il generale, e quello dei pazienti col cognome", async () => {
  const srv = server(), ora = Date.now(), seed = semeTabellone();
  seed["dafare.v1"] = {
    700001: [{ id: "a", testo: "rivalutare dolore", t: null, fatto: null, ord: 0, ts: ora }],
    700031: [{ id: "c", testo: "consulenza cardiologica", t: null, fatto: null, ord: 0, ts: ora }],
    700002: [{ id: "b", testo: "EGA", t: ora + 40 * 60e3, fatto: null, ord: 0, ts: ora }, { id: "b2", testo: "chiamare il figlio", t: null, fatto: null, ord: 1, ts: ora }],
  };
  const { context, page } = await contesto(srv, { seed });
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  const testi = (sel) => page.evaluate((sel) => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(sel)].map((x) => x.textContent.replace(/\s+/g, " ").trim()), sel);
  const voce = (testo) => $p(page, `.tdcard .tdi:has(.tdtx:text-is("${testo}"))`);
  const fuoco = () => page.evaluate(() => document.getElementById("psassist-host").shadowRoot.activeElement?.id || "");
  const separati = (a, b) => !!a && !!b && (a.r <= b.x + 1 || b.r <= a.x + 1 || a.b <= b.y + 1 || b.b <= a.y + 1);
  // sempre in vista: in Mappa e in Lista, in ogni vista, senza coprire le mappe
  let ovunque = true;
  for (const [v, m] of [["alta", "mappa"], ["bassa", "mappa"], ["entrambe", "mappa"], ["entrambe", "lista"], ["alta", "lista"]]) {
    await $p(page, `[data-vista="${v}"]`).click();
    await $p(page, `[data-modo="${m}"]`).click();
    await page.waitForTimeout(150);
    const td = (await rett(page, ".tdcard"))[0], mappe = await rett(page, ".stmappe"), lista = await rett(page, ".pzcoda");
    const ok = !!td && td.w > 200 && td.h > 200 && mappe.every((x) => separati(td, x)) && lista.every((x) => separati(td, x));
    if (!ok) { ovunque = false; console.log("    ", v, m, JSON.stringify({ td, mappe, lista })); }
  }
  check(ovunque, "il Da fare c'è in Mappa e in Lista, in ogni vista: accanto, senza coprire le mappe né la lista");
  await $p(page, '[data-vista="alta"]').click();
  await $p(page, '[data-modo="mappa"]').click();
  await page.waitForTimeout(150);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-dafare.png") });
  // i pazienti: col COGNOME in grassetto maiuscolo, nell'ordine del tabellone (l'area, poi l'ingresso),
  // scritto una volta sola, a sinistra, all'inizio delle sue voci (le altre sotto, rientrate)
  const paz = await page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll('.tdcard [data-tdl="paz"] .tdi')]
    .map((li) => `${li.querySelector(".tdchi")?.textContent.trim() || "·"} ${li.querySelector(".dftx")?.textContent.trim()}`));
  check(paz.join(" | ") === "ROSSI rivalutare dolore | VERDI EGA | · chiamare il figlio | ESPOSITO consulenza cardiologica",
    `le cose da fare dei pazienti, il cognome una volta per paziente, nell'ordine del tabellone (got: ${paz.join(" | ")})`);
  const chi = await page.evaluate(() => { const b = document.getElementById("psassist-host").shadowRoot.querySelector(".tdcard .tdchi"); return { w: +getComputedStyle(b).fontWeight, t: b.tagName }; });
  check(chi.w >= 700 && chi.t === "B", `il cognome in grassetto (got: ${JSON.stringify(chi)})`);
  const ega = await voce("EGA").evaluate((li) => ({ t: li.querySelector(".dft")?.textContent.trim(), prima: li.querySelector(".dft")?.getBoundingClientRect().right <= li.querySelector(".dftx").getBoundingClientRect().left }));
  check(/^\d\d:\d\d$/.test(ega.t || "") && ega.prima, `un promemoria porta la sua ora, davanti al testo (got: ${JSON.stringify(ega)})`);
  // il generale: Invio aggiunge, il campo resta pronto. Non dice «Aggiungi…» (dove ogni lista mette
  // la sua ricerca, ci si scriverebbe un nome): dice che cosa è
  check((await $p(page, "#tdin").getAttribute("placeholder")) === "Da fare generale…", `il campo del generale dice «Da fare generale…» (got: ${await $p(page, "#tdin").getAttribute("placeholder")})`);
  await $p(page, "#tdin").fill("chiamare la radiologia");
  await $p(page, "#tdin").press("Enter");
  await $p(page, "#tdin").fill("passaggio di consegne");
  await $p(page, "#tdin").press("Enter");
  const gen = () => ls(page, "dafare.generale.v1");
  check((await gen())?.map((x) => x.testo).join("|") === "chiamare la radiologia|passaggio di consegne" && (await testi('.tdcard [data-tdl="gen"] .tdtx')).length === 2
    && (await fuoco()) === "tdin" && (await $p(page, "#tdin").inputValue()) === "", "il Da fare generale: Invio aggiunge (dafare.generale.v1), il campo resta pronto");
  check(!JSON.stringify(await gen()).includes("700001"), "di nessun paziente: nessun episodio dentro");
  // un tocco sul testo lo modifica; ✕ lo cancella; la spunta lo fa
  await voce("chiamare la radiologia").locator(".tdtx").click();
  await $p(page, ".tdcard .dfmod").fill("chiamare la radiologia per il box 3");
  await $p(page, ".tdcard .dfmod").press("Enter");
  check((await gen())?.[0]?.testo === "chiamare la radiologia per il box 3" && (await voce("chiamare la radiologia per il box 3").count()) === 1, "un tocco sul testo lo modifica (Invio salva)");
  await voce("passaggio di consegne").locator(".dfck").click();
  check(Number.isFinite((await gen())?.[1]?.fatto) && (await voce("passaggio di consegne").evaluate((li) => li.classList.contains("fatto"))), "la spunta: fatta, barrata, resta lì (5 minuti)");
  await voce("chiamare la radiologia per il box 3").hover();
  await voce("chiamare la radiologia per il box 3").locator(".dfx").click();
  check((await gen())?.length === 1 && (await voce("chiamare la radiologia per il box 3").count()) === 0, "✕ lo cancella");
  // le voci dei pazienti: le stesse della loro lista (dafare.v1), e la riga si rifà
  const df = () => ls(page, "dafare.v1");
  await voce("chiamare il figlio").locator(".tdtx").click();
  await $p(page, ".tdcard .dfmod").fill("chiamare il figlio alle 18");
  await $p(page, ".tdcard .dfmod").press("Enter");
  check((await df())?.["700002"]?.[1]?.testo === "chiamare il figlio alle 18", "una voce di un paziente si modifica dal tabellone, nella sua lista");
  await voce("consulenza cardiologica").locator(".dfck").click();
  check(Number.isFinite((await df())?.["700031"]?.[0]?.fatto), "si spunta");
  await voce("EGA").hover();
  await voce("EGA").locator(".dfx").click();
  check((await df())?.["700002"]?.map((x) => x.testo).join("|") === "chiamare il figlio alle 18", "e si cancella");
  // «Mappa | Lista | Da fare»: il Da fare di tutti, largo, al posto delle mappe e della lista (e la scelta resta)
  await $p(page, '[data-modo="dafare"]').click();
  await page.waitForTimeout(200);
  check((await $p(page, ".tdtutto .tdcard").count()) === 1 && (await $p(page, ".stmappe").count()) === 0 && (await $p(page, ".pzrow").count()) === 0 && (await ls(page, "tabellone.modo.v1")) === "dafare",
    "«Da fare»: il Da fare di tutti al posto di mappe e lista; la scelta resta");
  check((await $p(page, '.tdapri[data-tdapri="700002"]').count()) === 1 && /ROSSI|BIANCHI|\w/.test(await $p(page, '.tdapri[data-tdapri="700002"]').innerText()), "ogni paziente ha l'intestazione col cognome (un clic lo apre)");
  await $p(page, '.tdpiu[data-tdpiu="700002"]').click({ force: true });
  check(/^\+ nota per /.test((await $p(page, "#tdin").getAttribute("placeholder")) || ""), "il «+» dell'intestazione scrive la prossima nota per quel paziente, nello stesso campo");
  await $p(page, "#tdin").fill("richiamare la famiglia");
  await $p(page, "#tdin").press("Enter");
  check((await df())?.["700002"]?.some((x) => x.testo === "richiamare la famiglia") && (await $p(page, "#tdin").getAttribute("placeholder")) === "Da fare generale…", "Invio la aggiunge a lui, e il campo torna «generale»");
  await voce("richiamare la famiglia").locator(".dfck").click();
  check(await voce("richiamare la famiglia").locator(".dfx").evaluate((b) => getComputedStyle(b).display !== "none" && b.querySelector("svg") !== null), "una voce fatta: il cestino grigio è sempre lì (senza passarci sopra)");
  await voce("richiamare la famiglia").locator(".dfx").click();
  check(!(await df())?.["700002"]?.some((x) => x.testo === "richiamare la famiglia"), "e la toglie subito");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "desktop-dafare.png") });
  await $p(page, '[data-modo="lista"]').click();
  await page.waitForTimeout(150);
  const icona = await page.evaluate(() => { const b = document.getElementById("psassist-host").shadowRoot.querySelector('.pzrow[data-pz="700002"] .dfic'); return { n: b?.textContent.trim(), t: b?.title }; });
  check(icona.n === "1" && /chiamare il figlio alle 18/.test(icona.t || ""), `la riga del paziente lo sa: una voce, quella modificata (got: ${JSON.stringify(icona)})`);
  // e dalla lista del paziente: ✕ e il testo da toccare ci sono anche lì
  await $p(page, '.pzrow[data-pz="700002"] .dfic').click();
  await $p(page, ".dfpop").waitFor();
  check((await $p(page, ".dfpop .dfi .dfx").count()) === 1 && (await $p(page, ".dfpop .dfi [data-dfmod]").count()) === 1, "nella lista del paziente: ✕ e il testo che si tocca per modificarlo");
  await page.keyboard.press("Escape");
  // si riduce a una barra sottile, e se lo ricorda
  await $p(page, "#tdtog").click();
  await page.waitForTimeout(150);
  const barra = (await rett(page, ".tdcard"))[0];
  check(!!barra && barra.w <= 44 && (await $p(page, "#tdin").count()) === 0 && (await ls(page, "tabellone.dafare.v1"))?.chiusa === true, `ridotto: una barra sottile (${barra && Math.round(barra.w)}px), e lo ricorda`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-dafare-ridotto.png") });
  await page.reload();
  await pannello(page);
  check((await $p(page, ".tdcard.chiusa").count()) === 1, "ricaricata la pagina, è ancora ridotto");
  await $p(page, "#tdtog").click();
  check((await $p(page, "#tdin").count()) === 1, "un tocco lo riapre");
  // stretta: sopra le mappe
  await page.setViewportSize({ width: 620, height: 900 });
  await $p(page, '[data-modo="mappa"]').click();
  await page.waitForTimeout(300);
  const td2 = (await rett(page, ".tdcard"))[0], m2 = (await rett(page, ".stmappe"))[0];
  check(!!td2 && !!m2 && td2.b <= m2.y + 1 && td2.w > 500 && m2.h > 150, `stretta: sopra le mappe, che restano in vista (Da fare fino a ${Math.round(td2?.b)}, mappe da ${Math.round(m2?.y)}, alte ${Math.round(m2?.h)})`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-dafare-stretta.png") });
  await $p(page, "#tdtog").click();
  await page.waitForTimeout(150);
  const tb = (await rett(page, ".tbbar"))[0], m3 = (await rett(page, ".stmappe"))[0], togb = (await rett(page, ".tbbar .tdtogb"))[0];
  check(!(await $p(page, ".tdcard").isVisible()) && !!togb && togb.w > 0 && togb.y >= tb.y && togb.b <= tb.b && m3.h > m2.h + 40,
    `stretta e ridotto: solo un bottone in fondo alla barra del tabellone, l'altezza torna alle mappe (${Math.round(m2.h)} → ${Math.round(m3?.h)}px)`);
  await $p(page, ".tbbar .tdtogb").click();
  check(await $p(page, ".tdcard #tdin").isVisible(), "e un tocco lo riapre");
  // stretta ma non troppo: sempre una colonna sola (mai voci sparse in colonne), cinque righe
  // al più e poi scorre, così le mappe non perdono altezza quante che siano le voci
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(200);
  const aggiungi = async (n, da) => { for (let i = 0; i < n; i++) { await $p(page, "#tdin").fill(`voce in più ${da + i}`); await $p(page, "#tdin").press("Enter"); } };
  const banda = () => page.evaluate(() => {
    const r = document.getElementById("psassist-host").shadowRoot, c = r.querySelector(".tdcorpo"), m = r.querySelector(".stmappe").getBoundingClientRect();
    const xs = [...r.querySelectorAll(".tdcard .dfck")].map((b) => Math.round(b.getBoundingClientRect().left));
    return { righe: xs.length, colonne: new Set(xs).size, vista: c.clientHeight, tutta: c.scrollHeight, riga: Math.round(r.querySelector(".tdcard .tdi").getBoundingClientRect().height), mappe: Math.round(m.height) };
  });
  await aggiungi(2, 1);
  const b6 = await banda();
  await aggiungi(6, 3);
  await page.waitForTimeout(150);
  const b12 = await banda();
  check(b12.righe >= 12 && b12.colonne === 1, `una colonna sola, anche con ${b12.righe} voci (got: ${b12.colonne} colonne)`);
  check(b12.vista <= 6 * b12.riga && b12.tutta > b12.vista + 2 * b12.riga && Math.abs(b12.mappe - b6.mappe) <= 2,
    `cinque righe e poi scorre: le mappe restano alte uguali (${b6.righe} voci: mappe ${b6.mappe}px; ${b12.righe}: ${b12.mappe}px; si vedono ${b12.vista}px di ${b12.tutta})`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-dafare-colonna.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  // «Dimentica i dati…» porta via anche il generale (è roba del turno)
  await $p(page, "#menubtn").click();
  await $p(page, "#resetpaz").click();
  await $p(page, "#resetpaz").click();
  check((await gen()) === null && (await ls(page, "tabellone.dafare.v1"))?.chiusa === false, "«Dimentica i dati…» porta via il Da fare generale (l'impostazione resta)");
  await context.close();
});

// --------------------------------------------- 4. segue il gestionale: il link, l'apertura, l'iPhone, il ⟳
await blocco("Segue il gestionale: il link della pagina; si legge appena aperto il gestionale, aprendo l'iPhone (al più ogni 2 minuti) e col ⟳, mai a tempo", async () => {
  const srv = server();
  const { context, page } = await contesto(srv, { seed: { ...semeTabellone(), "segue.v1": false }, finto: {} });
  await page.clock.install();
  const sotto = () => page.evaluate(() => (window.__chiesti || []).filter((m) => m.t === "smartSotto").map((m) => m.url));
  // (le richieste annotate stanno nella pagina: cambiando pagina si contano da capo)
  let prima = 0;
  const conta = async () => prima + (await sotto()).length;
  const vai = async (url) => { prima += (await sotto().catch(() => [])).length; await page.goto(url); };
  // una lista senza il link: niente da aprire, nemmeno col ⟳
  srv.s.link = "";
  await vai(URL_LISTA);
  await pannello(page);
  await page.clock.runFor(3000);
  await $p(page, "#tbsync").click();
  await page.clock.runFor(500);
  check(await conta() === 0 && !(await ls(page, "smart.url.v1")), "senza il link della pagina: la smart non si apre, nemmeno col ⟳ (nessun indirizzo inventato)");
  // «Segue il gestionale» non si spegne più: niente voce nel ⋯, e l'interruttore di prima (spento) se ne va
  await $p(page, "#menubtn").click();
  check(!(await $p(page, "#seguesw").count()) && (await ls(page, "segue.v1")) === null, "nel ⋯ non c'è più «Segue il gestionale»; lo «spento» salvato prima se ne va (segue.v1)");
  await $p(page, "#menubtn").click();
  // la lista dell'area porta l'icona elenco_smart: il SUO indirizzo, e il gestionale appena aperto (la smart mai letta) la legge subito, dietro
  srv.s.link = LINK_SMART;
  await vai(URL_LISTA);
  await pannello(page);
  await page.clock.runFor(2000);
  check((await ls(page, "smart.url.v1"))?.url === URL_SMART_LINK && (await sotto()).join() === URL_SMART_LINK,
    `il link letto dalla pagina; il gestionale appena aperto: la smart si legge da sola, una volta, col suo link (got: ${JSON.stringify(await sotto())})`);
  // un'altra pagina: già in lettura, niente di nuovo; e poi niente giri a tempo
  await vai(URL_LISTA);
  await pannello(page);
  await page.clock.runFor(25 * 60e3);
  check(await conta() === 1, `un'altra pagina, e 25 minuti: niente di nuovo — niente giri a tempo (got ${await conta()})`);
  // l'app aperta sull'iPhone (il comando «triage» con rileggi): la smart, dietro, col link della pagina; il telefono lo sa
  const iPhone = (rileggi = true) => page.evaluate((rileggi) => window.__alPc({ t: "ponteEsegui", cmd: "triage", args: rileggi ? { rileggi: true } : {} }), rileggi);
  const t1 = await iPhone();
  check(await conta() === 2 && (await sotto()).join() === URL_SMART_LINK && t1?.ok && t1.dati?.rilegge === true,
    `aprendo l'app sull'iPhone: la smart, col suo link, e il telefono sa che si sta rileggendo (got: ${JSON.stringify(t1)} · ${JSON.stringify(await sotto())})`);
  await page.clock.runFor(60e3);
  const t2 = await iPhone();
  check(await conta() === 2 && t2?.dati?.rilegge === false, "riaperta dopo un minuto: niente di nuovo (al più ogni 2 minuti)");
  await iPhone(false);
  check(await conta() === 2, "una semplice richiesta del telefono (senza «rileggi») non rilegge");
  await page.clock.runFor(70e3);
  await iPhone();
  check(await conta() === 3, "passati i 2 minuti, riaprendo l'app: di nuovo — anche con lo «spento» di prima (non c'è più)");
  // (il ⟳ è l'icona che rilegge, la stessa di tutto il pannello: niente glifo)
  check((await $p(page, "#tbsync svg").count()) === 1 && !(await $p(page, "#tbsync").innerText()).trim(), "il ⟳ è un'icona del pannello, non il glifo");
  // (la lettura di prima, qui senza fine — il service worker è per finta —, vale «in corso» per 45 secondi)
  await $p(page, "#tbsync").click();
  await page.clock.runFor(500);
  check(await conta() === 3 && /si sta già rileggendo/.test(await $p(page, ".card").innerText().catch(() => "")), "⟳ mentre una lettura è in corso: niente di nuovo, e lo dice");
  await page.clock.runFor(45e3);
  await $p(page, "#tbsync").click();
  await page.clock.runFor(500);
  check(await conta() === 4, "⟳: subito");
  // la sessione scade e si rientra: la prima pagina dopo l'accesso rilegge la smart (l'elenco se n'è andato col login)
  await vai(`${ORIGIN}${DIR}menuPso.do?MVPG=PsoAccesso`);
  await page.waitForFunction(() => !localStorage.getItem("psassist:smart.sync.v1"), null, { timeout: 8000 }).catch(() => {});
  check(!(await ls(page, "smart.sync.v1")), "la pagina d'accesso dimentica l'ultima lettura della smart (smart.sync.v1)");
  await vai(URL_LISTA);
  await page.waitForSelector("#psassist-host", { state: "attached" });   // (dopo l'accesso il pannello riparte ridotto)
  await page.clock.runFor(2000);
  check(await conta() === 5, `rientrati: la prima pagina rilegge la smart, da sola (got ${await conta()})`);
  // il service worker l'ha rimandata per un motivo del momento (un carrello aperto): la prima pagina dopo i 2 minuti ci riprova, da sola
  await page.evaluate(() => { localStorage.removeItem("psassist:smart.sync.v1"); localStorage.setItem("__smartNo", "carrello aperto"); });
  await vai(URL_LISTA);
  await page.waitForSelector("#psassist-host", { state: "attached" });   // (dopo l'accesso il pannello riparte ridotto)
  await page.clock.runFor(2000);
  check(await conta() === 6 && (await ls(page, "smart.sync.v1"))?.esito === "carrello aperto", `rimandata dal service worker: «carrello aperto» (got ${JSON.stringify(await ls(page, "smart.sync.v1"))})`);
  await page.evaluate(() => localStorage.removeItem("__smartNo"));
  await vai(URL_LISTA);
  await page.waitForSelector("#psassist-host", { state: "attached" });   // (dopo l'accesso il pannello riparte ridotto)
  await page.clock.runFor(2000);
  check(await conta() === 6, "una pagina subito dopo: non ancora (al più ogni 2 minuti)");
  await page.clock.runFor(2 * 60e3);
  await vai(URL_LISTA);
  await page.waitForSelector("#psassist-host", { state: "attached" });   // (dopo l'accesso il pannello riparte ridotto)
  await page.clock.runFor(2000);
  check(await conta() === 7, `dopo i 2 minuti, la prima pagina ci riprova da sola (got ${await conta()})`);
  // …mentre una lettura dietro aperta e finita male («pagina») non si riapre da sola: lo fanno il telefono e il ⟳
  await page.evaluate(() => localStorage.setItem("psassist:smart.sync.v1", JSON.stringify({ ts: Date.now() - 10 * 60e3, fine: Date.now() - 10 * 60e3, esito: "pagina", n: 0 })));
  await vai(URL_LISTA);
  await page.waitForSelector("#psassist-host", { state: "attached" });   // (dopo l'accesso il pannello riparte ridotto)
  await page.clock.runFor(2000);
  check(await conta() === 7, "una scheda dietro che non ha letto («pagina») non si riapre da sola a ogni pagina");
  // un link che non è quello della smart (un altro parametro): non si prende
  srv.s.link = "menuPsoSmart.do?MVPG=PsoPazientiSmart&PAZIENTI_FILTRO=X&s_ASSISTITO=ROSSI";
  await page.evaluate(() => localStorage.removeItem("psassist:smart.url.v1"));
  await vai(URL_LISTA);
  await page.waitForSelector("#psassist-host", { state: "attached" });
  check(!(await ls(page, "smart.url.v1")), "un link con un filtro dentro non è la lista smart: non si tiene");
  await context.close();
});

// ------------------------------------- 5. la smart letta dietro: chi c'è, chi esce
// (la scheda dietro: il content script nella smart, il service worker per finta)
async function smartDietro(srv, seed) {
  const { context, page } = await contesto(srv, { seed, finto: { smartChi: true } });
  await page.goto(URL_SMART_LINK);
  await page.waitForFunction(() => (window.__chiesti || []).some((m) => m.t === "smartFine"), null, { timeout: 15000 });
  const esito = await page.evaluate(() => window.__chiesti.find((m) => m.t === "smartFine").esito);
  const out = { esito, url: page.url(), pazienti: await ls(page, "patients.v1"), aree: await ls(page, "aree.v1"), dimessi: await ls(page, "dimessi.v1"),
    sync: await ls(page, "smart.sync.v1"), triage: await ls(page, "triage.lista.v1"), posti: await ls(page, "stanza.alta.posti.v1"), pannello: await page.locator("#psassist-host").count() };
  await context.close();
  return out;
}
await blocco("La smart letta dietro: le schede, chi c'è, chi è dimesso", async () => {
  // ROSSI è uscito; MORO (mai visto) c'è; FERRARI cambia triage
  const srv = server(), seed = semeTabellone();
  srv.s.pazienti = srv.s.pazienti.filter((p) => p.ep !== "700001");
  srv.s.pazienti.push(P("700061", "MORO DINO", "09/09/1999", 27, "ARANCIONE", "obi", 15));
  srv.s.pazienti.find((p) => p.ep === "700032").triage = "ARANCIONE";
  srv.s.log.length = 0;
  const r = await smartDietro(srv, seed);
  const giro = srv.s.log.filter((l) => /PsoPazientiSmart/.test(l)).map((l) => /PAZIENTI_FILTRO=(\w+)/.exec(l)[1]);
  check(r.esito === "ok" && giro.join() === "AMB_7,AMB,TRI" && /PAZIENTI_FILTRO=TRI$/.test(r.url), `aperta su «Tutti», passa ad «Ambulatorio» e poi al «Triage», ognuno col link della sua scheda (got: ${giro.join(" → ")})`);
  check(r.triage?.righe?.length === 1 && r.triage.righe[0].nome === "MARINI ADA" && r.triage.righe[0].breve === "MARINI A." && r.triage.righe[0].triage === "VERDE" && r.triage.righe[0].eta === 38 && r.triage.righe[0].area === "Bassa"
    && r.triage.righe[0].arrivo > 0 && !("nato" in r.triage.righe[0]) && r.triage.ts > 0, `il Triage letto va a parte (triage.lista.v1), senza nascita (got: ${JSON.stringify(r.triage)})`);
  check(r.triage?.righe?.[0]?.k === "sm" + impronta(`MARINI ADA|${impronta("08/08/1988")}`), `…con la chiave di nome e nascita, per «Accetta in ambulatorio» dal telefono (got: ${r.triage?.righe?.[0]?.k})`);
  check(r.pannello === 0, "dietro non nasce il pannello");
  const moro = r.pazienti.find((p) => p.name === "MORO DINO"), ferrari = r.pazienti.find((p) => p.ep === "700032");
  check(moro && /^sm/.test(moro.ep) && !moro.url && r.aree.membri[moro.ep]?.k === "obi" && moro.triage === "ARANCIONE" && moro.nato === impronta("09/09/1999") && moro.arrivo > 0,
    `chi non si conosceva entra, con l'impronta per chiave, l'area e il triage (got: ${JSON.stringify(moro)})`);
  check(ferrari.triage === "ARANCIONE" && !r.pazienti.some((p) => p.name === "MARINI ADA"), "il triage si aggiorna; chi è ancora al triage (altra scheda) no");
  const rossi = r.pazienti.find((p) => p.ep === "700001");
  check(rossi?.arch === true && r.dimessi?.eps?.join() === "700001" && r.dimessi.nomi.join() === "ROSSI M." && !r.posti["700001"],
    `ROSSI, uscito da una lettura intera: dimesso, archiviato, il letto vuoto (got: ${JSON.stringify(r.dimessi)})`);
  check(r.dimessi?.posti?.["stanza.alta.posti.v1"]?.["700001"]?.id === "rossa" && r.sync?.esito === "ok" && r.sync.intera === true, "e il posto resta da rimettere con «Annulla»");
});
await blocco("La smart: quando NON si dimette nessuno", async () => {
  const casi = [
    ["filtrata", (s) => { s.smartFiltro = "R"; }],
    ["monca (il conto della scheda non torna)", (s) => { s.smartConto = 99; }],
    ["più del 30% in un colpo", (s) => { s.pazienti = s.pazienti.filter((p) => !["700001", "700002", "700003", "700011"].includes(p.ep)); }],
    ["vuota", (s) => { s.pazienti = []; }],
    ["la pagina di login", (s) => { s.smartLogin = true; }],
  ];
  for (const [nome, cambia] of casi) {
    const srv = server();
    srv.s.pazienti = srv.s.pazienti.filter((p) => p.ep !== "700003");   // NERI esce (1 su 9: si dimetterebbe)
    cambia(srv.s);
    const r = await smartDietro(srv, semeTabellone());
    const arch = (r.pazienti || []).filter((p) => p.arch).map((p) => p.ep);
    check(!arch.length && !r.dimessi, `${nome}: nessuno dimesso (got: ${arch.join() || "nessuno"} · esito ${r.esito})`);
    if (nome === "filtrata") check(!r.triage, "e la lista del Triage, se la lettura è filtrata, non si tocca");
  }
});

// --------------------------- 6. dimesso da una lista intera dell'area: il toast e «Annulla»
await blocco("Dimesso dalla lista dell'area: «… dimesso · Annulla», e i casi in cui no", async () => {
  const srv = server();
  // l'Alta ha 3 pazienti più uno solo aperto qui (4 membri): VERDI esce → 1 su 4
  const seed = semeTabellone();
  seed["aree.v1"].membri["700004"] = { k: "alta", ts: Date.now() };
  seed["patients.v1"].push({ ep: "700004", name: "LUPI ELIO", url: URL_PAZ("700004"), ts: Date.now(), pk: "", triage: "VERDE", eta: 40 });
  srv.s.pazienti.push(P("700004", "LUPI ELIO", "01/01/1986", 40, "VERDE", "alta", 30));
  seed["stanza.alta.posti.v1"]["700002"] = { tipo: "letto", id: "a1", ts: Date.now() };
  const { context, page } = await contesto(srv, { seed });
  // i casi in cui no: filtrata, monca, vuota
  srv.s.pazienti = srv.s.pazienti.filter((p) => p.ep !== "700002");
  srv.s.filtro = "R";
  await page.goto(URL_LISTA + "&s_ASSISTITO=R");
  await pannello(page);
  check(!(await ls(page, "patients.v1")).some((p) => p.arch), "da una lista filtrata: nessuno");
  srv.s.filtro = ""; srv.s.contoLista = 7;
  await page.goto(URL_LISTA);
  await pannello(page);
  check(!(await ls(page, "patients.v1")).some((p) => p.arch), "da una lista monca: nessuno");
  srv.s.contoLista = null;
  // intera: VERDI esce
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(200);
  const snack = await $p(page, ".stsnack").innerText().catch(() => "");
  const verdi = (await ls(page, "patients.v1")).find((p) => p.ep === "700002");
  check(verdi?.arch === true && /VERDI A\. dimesso/.test(snack) && /Annulla/.test(snack) && !(await ls(page, "stanza.alta.posti.v1"))["700002"],
    `intera: VERDI dimessa, il letto vuoto, «VERDI A. dimesso · Annulla» (got: ${snack.replace(/\s+/g, " ")})`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-dimesso.png") });
  await $p(page, ".stannulla").click();
  await page.waitForTimeout(200);
  const dopo = (await ls(page, "patients.v1")).find((p) => p.ep === "700002");
  check(!dopo.arch && (await ls(page, "stanza.alta.posti.v1"))["700002"]?.id === "a1" && (await $p(page, '[data-letto="a1"][data-occep="700002"]').count()) === 1, "«Annulla»: di nuovo fra i vivi, al suo letto");
  // ricaricata: riportato a mano, per un po' non si riarchivia da solo
  await page.goto(URL_LISTA);
  await pannello(page);
  check(!(await ls(page, "patients.v1")).find((p) => p.ep === "700002").arch, "riportato con «Annulla»: la lista dopo non lo ridimette");
  // più del 30%: ROSSI, NERI e LUPI escono insieme (3 su 3 rimasti)
  srv.s.pazienti = srv.s.pazienti.filter((p) => !["700001", "700003", "700004"].includes(p.ep));
  srv.s.pazienti.push(P("700005", "NUOVO NINO", "01/02/1990", 36, "VERDE", "alta", 5));
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(200);
  check(!(await ls(page, "patients.v1")).some((p) => p.arch) && !(await $p(page, ".stsnack").count()), "più del 30% in un colpo: nessuno, e nessun avviso");
  // vuota: nessuno
  srv.s.pazienti = srv.s.pazienti.filter((p) => p.area !== "alta");
  await page.goto(URL_LISTA);
  await pannello(page);
  check(!(await ls(page, "patients.v1")).some((p) => p.arch), "da una lista vuota: nessuno");
  await context.close();
});

// ------------------------- 7. la smart cliccata: PsoPazienti, e il ricaricarsi sul fuoco
async function smartDa(page, url) {
  const [pop] = await Promise.all([page.waitForEvent("popup"), page.evaluate((u) => { window.open(u, "smart"); }, url)]);
  await pop.waitForLoadState("load");
  await pop.waitForFunction(() => document.querySelector("tr.psassist-smart"), null, { timeout: 10000 });
  return pop;
}
await blocco("La smart cliccata: il passaggio d'area da PsoPazienti, e la pagina che si ricarica prendendo il fuoco", async () => {
  // a. PsoPazienti: Conferma → 302 → PsoPazienti (rimanda alla lista) → la riga
  {
    const srv = server();
    const { context, page } = await contesto(srv);
    await page.goto(URL_LISTA);
    await pannello(page);
    const pop = await smartDa(page, `${ORIGIN}${DIR}menuPsoSmart.do?MVPG=PsoPazientiSmart&PAZIENTI_FILTRO=AMB`);
    srv.s.log.length = 0;
    await pop.click('tr[data-ep="700021"] td:nth-child(4)');
    await finoA(page, /EPISODIO_ID=700021/, 15000);
    const giro = srv.s.log.map((l) => l.split(" ").slice(0, 2).join(" "));
    check(giro.includes("GET menuPso.do?MVPG=PsoPazienti") && /EPISODIO_ID=700021$/.test(page.url()),
      `GIALLI: PsoPsoImposta, Conferma, PsoPazienti che rimanda alla lista, la sua riga (got: ${giro.join(" → ")})`);
    await context.close();
  }
  // b. la pagina del gestionale si ricarica quando la sua finestra prende il fuoco
  {
    const srv = server();
    srv.s.focus = true;
    const { context, page } = await contesto(srv, { focusFinto: true });
    await page.goto(URL_LISTA);
    await pannello(page);
    const pop = await smartDa(page, `${ORIGIN}${DIR}menuPsoSmart.do?MVPG=PsoPazientiSmart&PAZIENTI_FILTRO=AMB`);
    srv.s.log.length = 0;
    await pop.click('tr[data-ep="700021"] td:nth-child(4)');
    let arrivato = true;
    try { await finoA(page, /EPISODIO_ID=700021/, 15000); } catch { arrivato = false; }
    check(arrivato && srv.s.area === "minori", `con la pagina che si ricarica sul fuoco: si arriva lo stesso, area cambiata e paziente aperto (got: ${page.url().split("?")[1]} · ${srv.s.log.map((l) => l.split(" ").slice(0, 2).join(" ").replace(/menuPso(Episodio)?\.do\?/, "")).join(" → ")})`);
    await context.close();
  }
  // c. il passaggio perso: si atterra sulla lista dell'area di prima, col passaggio ancora da fare
  {
    const srv = server();
    const { context, page } = await contesto(srv);
    await page.goto(URL_LISTA);
    await pannello(page);
    await setLs(page, "area.vai.v1", { k: "minori", chi: { nome: "GIALLI SARA", nato: impronta("03/03/2000") }, ts: Date.now() });
    srv.s.log.length = 0;
    await page.goto(URL_LISTA);   // (come se la scheda si fosse ricaricata sopra la nostra navigazione)
    let arrivato = true;
    try { await finoA(page, /EPISODIO_ID=700021/, 15000); } catch { arrivato = false; }
    check(arrivato && srv.s.area === "minori" && srv.s.log.some((l) => /RISORSA_ID=00030001P/.test(l)),
      `sulla lista di prima col passaggio a metà: lo riprende da PsoPsoImposta, una volta (got: ${srv.s.log.map((l) => l.split(" ").slice(0, 2).join(" ")).join(" → ")})`);
    await context.close();
  }
});

// ------------------------------- chi è al Triage, sulla mappa della Bassa
await blocco("Chi è al Triage: di partenza nella Sala attesa della Bassa, finché il medico non lo porta altrove", async () => {
  const srv = server(), seed = semeTabellone(), ora = Date.now();
  // al Triage (la lista letta dalla smart): ZANNI, mai visto; BIANCHI LUCA è già fra i pazienti, nel suo letto
  seed["triage.lista.v1"] = { ts: ora, righe: [
    { nome: "ZANNI ADA", breve: "ZANNI A.", eta: 38, triage: "VERDE", area: "Bassa", arrivo: ora - 20 * 60e3 },
    { nome: "BIANCHI LUCA", breve: "BIANCHI L.", eta: 46, triage: "VERDE", area: "Bassa", arrivo: ora - 50 * 60e3 }] };
  seed["stanza.ps.posti.v1"] = { 700011: { tipo: "letto", id: "obi1", ts: ora - 3600e3 } };
  seed["tabellone.vista.v1"] = "bassa";
  const { context, page } = await contesto(srv, { seed });
  await page.goto(URL_LISTA);
  await pannello(page);
  await page.waitForTimeout(300);
  const dove = () => page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll('.stmap[data-mappa="ps"] .stp.ospite')]
    .map((x) => `${x.closest("[data-area]")?.getAttribute("data-area") || "letto:" + x.closest("[data-letto]")?.getAttribute("data-letto")}:${x.querySelector(".stpn").textContent}`).join(","));
  const d0 = await dove(), scritto0 = Object.keys(await ls(page, "stanza.ps.posti.v1")).join();
  const bianchi = await $p(page, '[data-letto="obi1"] .stp[data-stp="700011"]').count();
  // il medico lo porta su OBI 3, trascinandolo
  const da = await $p(page, ".stp.ospite").boundingBox(), a = await $p(page, '[data-letto="obi3"]').boundingBox();
  await page.mouse.move(da.x + da.width / 2, da.y + da.height / 2);
  await page.mouse.down();
  await page.mouse.move(da.x + da.width / 2 - 30, da.y + 10, { steps: 4 });
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const d1 = await dove(), posti = await ls(page, "stanza.ps.posti.v1");
  await page.reload();
  await pannello(page);
  await page.waitForTimeout(300);
  const d2 = await dove();
  check(d0 === "attesa:ZANNI A." && scritto0 === "700011" && bianchi === 1 && d1 === "letto:obi3:ZANNI A." && Object.entries(posti).some(([k, v]) => /^tr/.test(k) && v.id === "obi3") && d2 === d1,
    `chi è al Triage sta di partenza nella Sala attesa della Bassa (un posto mai scritto); chi è già fra i pazienti resta al suo letto; portato su OBI 3, ci resta (got: ${d0} → ${d1} → ${d2}; BIANCHI in OBI 1: ${bianchi})`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tab-triage-attesa.png") });
  await context.close();
});

await browser.close();

// ------------------------------- 8. con l'estensione vera: la scheda dietro
await blocco("Con l'estensione: la smart si apre in una scheda dietro e si chiude; il ⟳ rilegge dietro chi è stato aperto in questo turno", async () => {
  const EXT = join(root, "extension");
  const PROFILO = join("/tmp", "psa-tabellone-" + process.pid);
  const exe = process.env.CHROMIUM_PATH || ["/opt/pw-browsers/chromium-1243/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find((p) => { try { return readFileSync(p) && true; } catch { return false; } });
  const ctx = await chromium.launchPersistentContext(PROFILO, {
    headless: true, ...(exe ? { executablePath: exe } : {}),
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
  });
  ctx.setDefaultTimeout(10000);
  const finoA2 = async (fn, ms) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 300))) if (await fn()) return true; return false; };
  try {
    const srv = server();
    srv.s.pazienti = srv.s.pazienti.filter((p) => p.ep !== "700012");
    srv.s.pazienti.push(P("700061", "MORO DINO", "09/09/1999", 27, "ARANCIONE", "obi", 15));
    // la pagina di ROSSI (aperto 20 minuti fa) e quella di VERDI (mai aperto): una RX ciascuno, ancora senza referto
    const dataOrd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00.0`; };
    srv.s.rich["700001"] = [{ esame: "69-140 RX ADDOME (A2)", quando: dataOrd(Date.now() - 40 * 60e3), referto: false }];
    srv.s.rich["700002"] = [{ esame: "69-140 RX TORACE (A1)", quando: dataOrd(Date.now() - 30 * 60e3), referto: false }];
    await ctx.route(`${ORIGIN}/**`, servi(srv));
    const page = ctx.pages()[0] || await ctx.newPage();
    // (l'elenco di partenza: tutti tranne MORO, già visti — seminato da una pagina fuori dal gestionale;
    // la smart mai letta da quando il gestionale è aperto)
    const seme = semeTabellone();
    seme["patients.v1"] = seme["patients.v1"].filter((p) => p.ep !== "700051");   // (SENZA AREA: qui il gestionale non ce l'ha)
    seme["tabellone.modo.v1"] = "lista";   // (la Lista: una riga per tutti, anche per chi ha un letto)
    seme["stato.v1"]["700001"].righe = [{ k: "x", rid: "", ts: Date.now() - 40 * 60e3, esami: [["img", "RX ADDOME"]], fatto: "", quando: 0 }];
    await page.goto(`${ORIGIN}/vuota.html`);
    await page.evaluate((seed) => {
      for (const [k, v] of Object.entries(seed)) localStorage.setItem("psassist:" + k, JSON.stringify(v));
      localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.02, y: 0.01, w: 0.96, h: 0.97 }));
      sessionStorage.setItem("psassist:navPannello.v1", JSON.stringify(Date.now()));
    }, seme);
    const schede = [];
    ctx.on("page", (p) => schede.push(p));
    srv.s.log.length = 0;
    await page.goto(URL_LISTA);
    await page.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
    // il gestionale appena aperto: la smart, da sola, in una scheda dietro (niente giri a tempo: poi col ⟳, o aprendo l'app sull'iPhone)
    const letta = () => page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem("psassist:smart.sync.v1") || "null"); return s && s.fine && s.esito; }, null, { timeout: 30000 }).then(() => true, () => false);
    let persa = !(await letta());
    const daSola = srv.s.log.some((l) => /PAZIENTI_FILTRO=AMB_7/.test(l)), primaScheda = schede.length;
    if (persa) {
      // (la navigazione persa sotto Playwright, vedi il ⟳ qui sotto: passati i suoi tempi, il ⟳ la rilegge)
      console.log("    (la scheda dietro ha perso la sua pagina: ⟳)");
      await page.waitForTimeout(16000);
      await page.locator("#psassist-host #expand").click({ timeout: 10000 }).catch(() => {});
      await page.locator("#psassist-host #tbsync").click().catch(() => {});
      persa = !(await letta());
    }
    const sync = await page.evaluate(() => JSON.parse(localStorage.getItem("psassist:smart.sync.v1")));
    await page.waitForTimeout(800);
    const aperte = ctx.pages().filter((p) => !p.isClosed());
    check(!persa && daSola && sync.esito === "ok" && sync.letta > 0 && primaScheda === 1 && aperte.length === 1 && /PsoPazientiAmbulatorio/.test(page.url()),
      `appena aperto il gestionale: da sola, una scheda dietro, sulla smart; letta, si chiude; il medico resta dov'era (got: ${JSON.stringify(sync)} · schede ${primaScheda}, aperte ${aperte.length})`);
    const visibile = await page.evaluate(() => document.visibilityState);
    check(visibile === "visible", "la scheda del medico resta davanti");
    const paz = await page.evaluate(() => JSON.parse(localStorage.getItem("psassist:patients.v1")));
    check(paz.some((p) => p.name === "MORO DINO" && /^sm/.test(p.ep)) && paz.find((p) => p.ep === "700012")?.arch === true,
      "MORO entra; NERI PAOLA, uscita, è dimessa");
    // (letta mentre la pagina nasce: «… dimesso · Annulla» dura 8 secondi, e il pannello può essere ancora ridotto — c'è l'uscita da annullare)
    const dim = await page.evaluate(() => JSON.parse(localStorage.getItem("psassist:dimessi.v1") || "null"));
    check(dim && dim.eps.join() === "700012" && dim.nomi.join() === "NERI P.", `e la sua uscita si può annullare: «NERI P. dimesso · Annulla» (got: ${JSON.stringify(dim)})`);
    check(!srv.s.log.some((l) => /EPISODIO_ID=/.test(l)), "la smart letta da sola non apre la pagina di nessun paziente");
    // intanto le due radiografie tornano refertate
    srv.s.rich["700001"][0].referto = true;
    srv.s.rich["700002"][0].referto = true;
    // ⟳: la smart di nuovo, e dietro, uno alla volta, chi è stato aperto in questo turno (ROSSI) — VERDI no
    if (!(await page.locator("#psassist-host .card").count())) await page.locator("#psassist-host #expand").click({ timeout: 10000 }).catch(() => {});
    await page.waitForSelector("#psassist-host #tbsync", { timeout: 15000 });
    const rxRossi = () => page.evaluate(() => (JSON.parse(localStorage.getItem("psassist:stato.v1") || "{}")["700001"]?.righe || []).find((r) => /RX ADDOME/.test(JSON.stringify(r.esami))) || null);
    check((await rxRossi())?.fatto === "", "prima del ⟳: la RX di ROSSI è in attesa, sul PC");
    srv.s.log.length = 0;
    // (Sotto Playwright una scheda nata vuota e poi mandata sulla sua pagina a volte perde la navigazione —
    // net::ERR_ABORTED, anche col codice di prima —: la scheda si chiude da sola, e il medico ritocca ⟳.
    // Qui lo stesso, passati i tempi di quella persa: al più due volte.)
    const nate = schede.length;
    const pagine = [];
    const tocco = async () => {
      srv.s.log.length = 0;
      const t0 = await page.evaluate(() => Date.now());
      await page.locator("#psassist-host #tbsync").click();
      const smart = await page.waitForFunction((t0) => { const s = JSON.parse(localStorage.getItem("psassist:smart.sync.v1") || "null"); return s && s.fine > t0; }, t0, { timeout: 30000 }).then(() => true, () => false);
      const fatto = await finoA2(async () => (await rxRossi())?.fatto === "referto", 40000);
      await page.waitForTimeout(1500);
      pagine.push(...srv.s.log.filter((l) => /MVPG=PsoEpisodioClinicoAmbulatorio/.test(l)));
      return smart && fatto && srv.s.log.some((l) => /PAZIENTI_FILTRO=AMB_7/.test(l));
    };
    let riuscito = await tocco();
    for (let n = 0; !riuscito && n < 2; n++) { console.log("    (⟳ di nuovo: una scheda dietro ha perso la sua pagina)"); await page.waitForTimeout(65000); pagine.length = 0; riuscito = await tocco(); }
    check(riuscito, `⟳: la smart di nuovo, dal link della pagina, e la pagina di ROSSI riletta dietro — la sua RX ora è refertata (got ${JSON.stringify(await rxRossi())})`);
    check(pagine.length === 1 && pagine.every((l) => /EPISODIO_ID=700001\b/.test(l)),
      `…la sua pagina una volta, e solo lui: VERDI, mai aperto in questo turno, resta com'è la lista — la sua pagina non si apre (pagine: ${JSON.stringify(pagine)})`);
    // nella Lista: «RX ✓» e «● nuovo» (nel passaggio del mouse); nella Mappa, sul letto, il pallino blu del nuovo
    const riga = await page.evaluate(() => { const r = document.getElementById("psassist-host").shadowRoot.querySelector('.pzrow[data-pz="700001"]');
      return r ? { rx: r.querySelector(".esm.es-img")?.className || "", nuovo: /● nuovo/.test(r.querySelector(".pzapri")?.getAttribute("aria-label") || "") } : null; });
    check(riga && /\bok\b/.test(riga.rx) && riga.nuovo, `nel tabellone, la riga di ROSSI si rifà da sola: «RX ✓» e «● nuovo» (got ${JSON.stringify(riga)})`);
    await page.locator('#psassist-host [data-modo="mappa"]').click();
    const letto = await page.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".stbed.occ")].find((b) => b.querySelector('[data-stp="700001"]'))?.querySelector(".stseg")?.className || "");
    check(/\bnuovo\b/.test(letto), `…e sulla mappa il suo letto ha il pallino blu del nuovo (got «${letto}»)`);
    const verdi = await page.evaluate(() => JSON.parse(localStorage.getItem("psassist:stato.v1") || "{}")["700002"]?.righe?.some((r) => r.fatto === "referto") || false);
    check(!verdi, "e VERDI ha lo stato di prima");
    await finoA2(async () => ctx.pages().filter((p) => !p.isClosed()).length === 1, 15000);
    check(ctx.pages().filter((p) => !p.isClosed()).length === 1 && schede.length - nate >= 2 && await page.evaluate(() => document.visibilityState) === "visible",
      `le schede dietro (la smart, ROSSI) si chiudono; il medico resta davanti (nate ${schede.length - nate})`);
    const visto = await page.evaluate(() => JSON.parse(localStorage.getItem("psassist:patients.v1")).find((p) => p.ep === "700001")?.ts);
    check(visto === seme["patients.v1"].find((p) => p.ep === "700001").ts, "rileggere col ⟳ non è «aperto adesso» dal medico");
  } finally {
    await ctx.close();
    rmSync(PROFILO, { recursive: true, force: true });
  }
});

console.log(fail ? `\nTABELLONE: ${fail} CHECK FALLITI\n` : "\nTABELLONE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
