#!/usr/bin/env node
/*
 * «Terapia» con l'estensione VERA: dal pannello sulla pagina del paziente
 * (⋯ → Terapia) alla riga nuova della pagina Terapia del gestionale
 * (PsoEpisodioTerapieImposta), e mai oltre. La pagina è rifatta sulla forma
 * della registrazione (test/fixtures/terapie.mjs), con la sua tendina dei
 * farmaci (Sa4JsonService.do, XHR della pagina). Si prova: i preferiti si
 * imparano dalla Conferma del medico (farmaco e dose, niente del paziente);
 * «Prepara nel gestionale» apre la pagina col suo pulsante, sceglie il
 * farmaco dalla tendina della pagina, scrive la dose nei campi e si ferma —
 * Conferma, Chiudi, nessun invio: mai —; dopo la Conferma del medico il
 * farmaco successivo; una pagina ricaricata senza Conferma non si riscrive;
 * la pagina di un altro paziente è un «Errore grave» e niente si scrive; un
 * ordine al lavoro in un'altra scheda si aspetta (niente pagina, niente
 * tendina finché non finisce). Tutto inventato.
 * E dal telefono (il ponte vero, l'app in formato iPhone): la Terapia letta
 * da una scheda di sottofondo (il pulsante del paziente, i controlli, solo le
 * righe e le voci delle tendine), la ricerca nella tendina della pagina, un
 * farmaco aggiunto da un preferito e da una voce cercata — il «Conferma»
 * della pagina premuto una volta e la riga verificata —, e ogni no: un altro
 * paziente, voci uguali o sparite, una rilettura diversa, la Conferma che non
 * si vede (incerto, mai di nuovo), la scheda ricaricata dopo Conferma, lo
 * stesso numero rimandato, un ordine che lavora, il medico sulla pagina.
 *   node test/ext-terapia.mjs   (TEST_SHOTS_DIR=… per le foto del telefono)
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync } from "node:fs";
import { paginaTerapie } from "./fixtures/terapie.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-terapia-" + process.pid);
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
const PZ = { ep: "700001", name: "ROSSI MARIO", triage: "ARANCIONE", cf: "RSSMRA50A01Z999X" };
const ALTRO = { ep: "700002", name: "VERDI ANNA", triage: "VERDE" };
const URL_PAZ = (ep) => `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${ep}`;
const FARMACI = [
  { id: "", label: "PARACETAMOLO 1000 MG CPR", value: "PARACETAMOLO 1000 MG CPR" },
  { id: "", label: "PARACETAMOLO 1000 MG/100 ML FL EV", value: "PARACETAMOLO 1000 MG/100 ML FL EV" },
  { id: "4471", label: "KETOROLAC 30 MG/ML FL", value: "KETOROLAC 30 MG/ML FL" },
  { id: "", label: "METOCLOPRAMIDE 10 MG/2 ML FL", value: "METOCLOPRAMIDE 10 MG/2 ML FL" },
  { id: "", label: "PANTOPRAZOLO 40 MG FL EV", value: "PANTOPRAZOLO 40 MG FL EV" },
  // due voci con la stessa scritta (codici diversi): non se ne sceglie nessuna da soli
  { id: "801", label: "SODIO CLORURO 0,9% 100 ML", value: "SODIO CLORURO 0,9% 100 ML" },
  { id: "802", label: "SODIO CLORURO 0,9% 100 ML", value: "SODIO CLORURO 0,9% 100 ML" },
  // una voce con le minuscole, come nel gestionale vero: la ricerca porta il termine
  // in maiuscolo, quindi «SF 500cc» intero non la trova, «SF 500» sì
  { id: "905", label: "SF 500cc", value: "SF 500cc" },
];
// (per il telefono: `pazienti` le pagine del paziente chieste; `ignora` una Conferma che il server non salva;
// `ricarica` la scheda ricaricata mentre il server risponde alla Conferma; `ritocca` la pagina che cambia la
// quantità quando si scrive la frequenza; `senza` un farmaco sparito dalla tendina; `login` la sessione del gestionale
// scaduta: ogni pagina è quella d'accesso)
const srv = { salvate: { [PZ.ep]: [], [ALTRO.ep]: [] }, conferme: [], termini: [], pagineTer: [], nomeAltro: false, epAltro: false, occupaSuTerapie: false,
  pazienti: 0, ignora: false, ricarica: false, ritocca: false, senza: "", login: false };
const LOGIN = `<html><head><title>Accesso</title></head><body><form name="Login" method="post" action="login.do"><input name="username"><input type="password" name="password"><input type="submit" value="Accedi"></form></body></html>`;
const RITOCCA = `<script>document.addEventListener("change", function (e) {
  var m = /^FREQUENZA_(\\d+)$/.exec(e.target.name || "");
  if (m) document.querySelector('[name="QUANTITA_' + m[1] + '"]').value = "2";
}, true);</script>`;
const pagina = (titolo, corpo) => `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>${titolo}</title></head><body>
  <table class="AFCHeaderTable" width="100%"><tbody><tr><td width="70%" align="center"><font style="font-size: 130%; font-weight: bolder; ">OSPEDALE ESEMPIO</font><br><font style="font-size: 110%; font-weight: bolder; ">AREA ALTA INTENSITA'</font><br><b>Salve!</b></td></tr></tbody></table>${corpo}</body></html>`;
const riquadro = (p) => `<table><tr><td title="${p.triage}"><font style="font-size: 120%">Box 3</font><br><font style="font-size: 150%">${p.name}</font><br><font style="font-size: 120%">01/01/1950 (76) M<br>${p.cf || ""}</font></td></tr></table>`;
// la pagina del paziente: il riquadro, il link per ordinare e il pulsante «Terapia» com'è nella registrazione
const pazientePage = (ep) => {
  const p = ep === ALTRO.ep ? ALTRO : PZ;
  return pagina(p.name, `<form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${ep}"></form>
    ${riquadro(p)}
    <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">Laboratorio</a>
    <a name="" href="?MVPG=PsoEpisodioTerapieImposta&amp;MODALITA=PRESCRIZIONE&amp;EPISODIO_ID=${ep}&amp;returnPage=PsoEpisodio" title="Apri Terapia" class="myButton" target="_self" style="color:white" onclick="window.location.href; ">Terapia</a>
    <textarea name="DIARIO"></textarea>`);
};

// La tendina dei farmaci della pagina: jQuery UI 1.8 senza jQuery (vedi test/fixtures/terapie.mjs)
const TENDINA = `<script>
(function () {
  window.__tendina = 0; window.__scelte = []; window.__conferme = 0; window.__invii = 0;
  var inp = document.getElementById("DESCRIZIONE");
  var f = document.forms.EpisodioTerapia;
  f.addEventListener("submit", function () { window.__invii++; });
  document.querySelector('input[name="Update"]').addEventListener("click", function () {
    window.__conferme++;
    var l = [];
    document.getElementById("TerapiaTable" + f.getAttribute("data-ep")).querySelectorAll("input, select").forEach(function (el) {
      if (el.name && (el.checked || /select|textarea/i.test(el.nodeName) || /text|hidden|password/i.test(el.type))) l.push(encodeURIComponent(el.name) + "=" + encodeURIComponent(el.value));
    });
    document.getElementById("TERAPIA_SERIALIZED").value = l.join("&").replace(/%20/g, "%17");
  });
  if (!inp) return;
  inp.className += " ui-autocomplete-input";
  inp.setAttribute("autocomplete", "off"); inp.setAttribute("role", "textbox"); inp.setAttribute("aria-autocomplete", "list"); inp.setAttribute("aria-haspopup", "true");
  var ul = document.createElement("ul");
  ul.className = "ui-autocomplete ui-menu ui-widget ui-widget-content ui-corner-all";
  ul.setAttribute("role", "listbox"); ul.setAttribute("aria-activedescendant", "ui-active-menuitem");
  ul.style.cssText = "z-index: 1; position: absolute; display: none; background: #fff; border: 1px solid #888; list-style: none; padding: 2px; margin: 0;";
  document.body.appendChild(ul);
  var term, timer, chiusura, voci = [], attiva = null;
  function chiudi() { ul.style.display = "none"; attiva = null; }
  inp.addEventListener("keydown", function (e) {
    if ([33, 34, 38, 40, 13, 108, 9, 27].indexOf(e.keyCode) >= 0) { if (e.keyCode === 27) chiudi(); return; }
    clearTimeout(timer);
    timer = setTimeout(function () { if (term != inp.value) cerca(); }, 500);
  });
  inp.addEventListener("focus", function () { clearTimeout(chiusura); });
  inp.addEventListener("blur", function () { clearTimeout(timer); chiusura = setTimeout(chiudi, 150); });
  function cerca() {
    term = inp.value;
    if (term.length < 3) { chiudi(); return; }
    window.__tendina++;
    inp.classList.add("ui-autocomplete-loading");
    var x = new XMLHttpRequest();
    x.open("GET", "Sa4JsonService.do?FUNZIONE=ESEMPIO&ALT_PARAMS=101" + "&_=" + Date.now() + "&term=" + encodeURIComponent(term));
    x.onload = function () { var d = []; try { d = JSON.parse(x.responseText); } catch (e) {} risposta(d); };
    x.onerror = function () { risposta([]); };
    x.send();
  }
  function risposta(d) {
    voci = (d || []).map(function (v) { return typeof v === "string" ? { label: v, value: v } : { label: v.label || v.value, value: v.value || v.label, id: v.id }; });
    ul.innerHTML = "";
    if (voci.length) {
      voci.forEach(function (v, i) {
        var li = document.createElement("li"); li.className = "ui-menu-item"; li.setAttribute("role", "menuitem");
        var a = document.createElement("a"); a.className = "ui-corner-all"; a.tabIndex = -1; a.textContent = v.label;
        a.addEventListener("mouseover", function () { attiva = i; a.id = "ui-active-menuitem"; a.classList.add("ui-state-hover"); });
        a.addEventListener("mouseout", function () { attiva = null; a.removeAttribute("id"); a.classList.remove("ui-state-hover"); });
        li.appendChild(a); ul.appendChild(li);
      });
      var r = inp.getBoundingClientRect();
      ul.style.left = (r.left + scrollX) + "px"; ul.style.top = (r.bottom + scrollY) + "px"; ul.style.display = "block";
    } else chiudi();
    inp.classList.remove("ui-autocomplete-loading");
  }
  ul.addEventListener("mousedown", function (e) { e.preventDefault(); setTimeout(function () { clearTimeout(chiusura); }, 13); });
  ul.addEventListener("click", function (e) {
    if (!e.target.closest(".ui-menu-item a")) return;
    e.preventDefault();
    var v = voci[attiva];   // (jQuery UI 1.8: senza una voce attiva, ui.item non c'è)
    if (!v) throw new Error("nessuna voce attiva");
    // il select della pagina
    document.getElementById("DESCRIZIONE").value = v.value;
    document.getElementById("PRINCIPIO_ATTIVO").value = v.id == null ? "" : v.id;
    document.getElementById("CODICE").value = v.id == null ? "" : v.id;
    inp.value = v.value; term = inp.value;
    window.__scelte.push(v.value);
    chiudi();
  });
})();
</script>`;

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
});
let sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js"));
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const motore = (on) => sw.evaluate((on) => on ? chrome.storage.session.set({ motore: { tab: 999999, id: "ordine-altrove", scade: Date.now() + 120e3 } }) : chrome.storage.session.remove("motore"), on);
await ctx.route(`${ORIGIN}/**`, async (r) => {
  const req = r.request(), u = new URL(req.url()), mvpg = u.searchParams.get("MVPG"), ep = u.searchParams.get("EPISODIO_ID");
  const html = (b) => r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(b, "latin1") }).catch(() => {});
  // (il 302 del server dopo un invio: la pagina dove porta, servita qui — un
  // rinvio dato a Chromium dall'instradamento non ripassa di qui)
  const terapie = (e) => { const p = e === ALTRO.ep || srv.nomeAltro ? ALTRO : PZ; return html(paginaTerapie({ ep: e, nome: p.name, triage: p.triage, salvate: srv.salvate[e] || [], coda: TENDINA + (srv.ritocca ? RITOCCA : "") })); };
  if (/Sa4JsonService\.do$/.test(u.pathname)) {
    srv.termini.push({ url: u.href, tipo: req.resourceType(), term: u.searchParams.get("term") || "" });
    const q = (u.searchParams.get("term") || "").toUpperCase();
    return r.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(FARMACI.filter((f) => f.label.includes(q) && !(srv.senza && f.label.includes(srv.senza))).slice(0, 20)) }).catch(() => {});
  }
  if (srv.login && req.method() === "GET" && /menuPsoEpisodio\.do$/.test(u.pathname)) return html(LOGIN);
  if (mvpg === "PsoEpisodioTerapieImposta" && req.method() === "POST") {
    const b = new URLSearchParams(req.postDataBuffer()?.toString("latin1") || "");
    const tasto = b.has("Update") ? "Conferma" : b.has("Chiudi") ? "Chiudi" : "?";
    srv.conferme.push({ ep, tasto, serializzata: !!b.get("TERAPIA_SERIALIZED"), note: [...b].filter(([k, v]) => /^NOTE_/.test(k) && v).length });
    if (tasto === "Chiudi") return html(pazientePage(ep));
    if (srv.ignora) return terapie(ep);
    for (const [k, descr] of b) {
      const m = /^DESCRIZIONE_(\d+)$/.exec(k);
      if (!m || !descr || b.get(`TERAPIA_PROG_${m[1]}`)) continue;
      const g = (x) => b.get(`${x}_${m[1]}`) || "";
      const l = srv.salvate[ep];
      l.push({ descr, qta: g("QUANTITA"), um: g("UM"), via: g("SOMMINISTRAZIONE_VIA"), dil: g("TERAPIA_DILUIZIONE_ID"), continua: !!g("CONTINUA"), bisogno: !!g("AL_BISOGNO"),
        freq: g("FREQUENZA") || "24", durata: g("DURATA"), codice: g("CODICE"), prog: String(l.length + 1) });
    }
    // salvata; la risposta tarda, e intanto la scheda si ricarica (la pagina di prima, di nuovo: una GET)
    if (srv.ricarica) { srv.ricarica = false; const pg = req.frame().page(); setTimeout(() => pg.reload().catch(() => {}), 300); await sospendi(4000); }
    return terapie(ep);
  }
  if (mvpg === "PsoEpisodioTerapieImposta") {
    srv.pagineTer.push(u.href);
    if (srv.occupaSuTerapie) { srv.occupaSuTerapie = false; await motore(true); }
    // (epAltro: all'indirizzo di questo episodio il server dà la pagina di un altro)
    return terapie(srv.epAltro && ep === PZ.ep ? ALTRO.ep : ep);
  }
  if (mvpg === "PsoEpisodioClinicoAmbulatorio") { srv.pazienti++; return html(pazientePage(ep)); }
  return html(pagina("Pronto Soccorso", "<p>altro</p>"));
});

const doc = await ctx.newPage();
const $p = (sel) => doc.locator(`#psassist-host ${sel}`);
const banner = () => doc.locator("#psassist-terapia .b").innerText().catch(() => "");
const preferiti = () => doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:terapia.preferiti.v1") || "[]"));
const giro = () => doc.evaluate(() => JSON.parse(sessionStorage.getItem("psassist:terapia.v1") || "null"));
const errori = () => sw.evaluate(() => chrome.storage.local.get("errori.v1").then((o) => (o["errori.v1"] || []).filter((x) => x.tipo === "terapia")));
const val = (name) => doc.evaluate((n) => { const el = document.querySelector(`[name="${n}"]`); return !el ? null : el.type === "checkbox" ? el.checked : el.value; }, name);
const contatori = () => doc.evaluate(() => ({ tendina: window.__tendina, scelte: (window.__scelte || []).slice(), conferme: window.__conferme, invii: window.__invii, ser: document.getElementById("TERAPIA_SERIALIZED")?.value || "" }));
const sullaTerapia = () => finche(async () => /PsoEpisodioTerapieImposta/.test(doc.url()) && await doc.locator("#DESCRIZIONE").count() === 1 && await doc.evaluate(() => typeof window.__tendina === "number"));
async function apriTerapiaPannello() {
  if (!/PsoEpisodioClinicoAmbulatorio/.test(doc.url())) await doc.goto(URL_PAZ(PZ.ep));
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  if (!(await $p(".card").count())) { await $p("#expand").click(); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  if (!(await $p("#terprepara").count())) {
    await $p("#menubtn").click();
    await $p("#termenu").click();
    await doc.waitForSelector("#psassist-host #terprepara", { timeout: 5000 });
  }
}
// il medico, a mano, nella pagina Terapia: scrive nella tendina, sceglie, riempie, preme un tasto
async function aMano(descr, cerca, campi, tasto = "Update") {
  await doc.click("#DESCRIZIONE");
  await doc.keyboard.type(cerca, { delay: 40 });
  const voce = doc.locator("ul.ui-autocomplete li.ui-menu-item a", { hasText: descr }).first();
  await voce.waitFor({ state: "visible", timeout: 8000 });
  await voce.click();
  const n = await doc.evaluate(() => document.getElementById("DESCRIZIONE").name.split("_")[1]);
  for (const [k, v] of Object.entries(campi)) {
    const sel = `[name="${k}_${n}"]`;
    if (typeof v === "boolean") { if (v) await doc.check(sel); }
    else if (await doc.evaluate((s) => document.querySelector(s).tagName, sel) === "SELECT") await doc.selectOption(sel, v);
    else await doc.fill(sel, v);
  }
  await premi(tasto);
}
// un clic che porta a un'altra pagina: si aspetta che la pagina dopo sia caricata
async function premi(tasto) {
  const nav = doc.waitForNavigation({ waitUntil: "load", timeout: 15000 });
  await doc.click(`input[name="${tasto}"]`);
  await nav;
}

console.log("terapia: dal pannello alla riga nuova della pagina Terapia del gestionale, mai oltre Conferma");
let telBrowser = null, relay = null;
try {
  // ---- 1. la sezione: nel menu ⋯ della pagina del paziente; senza preferiti, niente da preparare
  await doc.goto(URL_PAZ(PZ.ep));
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  if (!(await $p(".card").count())) { await $p("#expand").click(); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
  await $p("#menubtn").click();
  check(await $p("#termenu").count() === 1, "sulla pagina del paziente il menu ⋯ ha «Terapia»");
  await $p("#termenu").click();
  await doc.waitForSelector("#psassist-host #terprepara", { timeout: 5000 });
  check(/Ancora nessuno/.test(await $p(".ricetta").innerText()) && await $p("#terprepara").isDisabled(), "la sezione Terapia: ancora nessun preferito, «Prepara nel gestionale» spento");

  // ---- 2. i preferiti si imparano dalla Conferma del medico (a mano, nella pagina Terapia)
  const nav0 = doc.waitForNavigation({ waitUntil: "load", timeout: 15000 });
  await doc.click('a[title="Apri Terapia"]');
  await nav0;
  check(await sullaTerapia(), "il pulsante «Terapia» della pagina apre PsoEpisodioTerapieImposta");
  await aMano("PARACETAMOLO 1000 MG CPR", "parac", { QUANTITA: "1", UM: "cpr", SOMMINISTRAZIONE_VIA: "os", AL_BISOGNO: true, FREQUENZA: "8", DURATA: "3", NOTE: "se febbre oltre 38" });
  await sullaTerapia();
  await aMano("KETOROLAC 30 MG/ML FL", "ketor", { QUANTITA: "1", UM: "fl", SOMMINISTRAZIONE_VIA: "ev lenta", TERAPIA_DILUIZIONE_ID: "1" });
  await sullaTerapia();
  // Chiudi non è una Conferma: niente si impara
  await aMano("METOCLOPRAMIDE 10 MG/2 ML FL", "metoc", { QUANTITA: "1", UM: "fl" }, "Chiudi");
  const pf = await preferiti();
  const par = pf.find((p) => p.descr === "PARACETAMOLO 1000 MG CPR"), ket = pf.find((p) => p.descr === "KETOROLAC 30 MG/ML FL");
  check(pf.length === 2 && par && ket, `due Conferme, due preferiti; il Chiudi no (${pf.map((p) => p.descr).join(" | ")})`);
  check(par && par.qta === "1" && par.um?.v === "cpr" && par.via?.v === "os" && par.bisogno === true && par.continua === false && par.freq === "8" && par.durata === "3" && !par.dil,
    `il preferito è il farmaco con la dose confermata (${JSON.stringify(par)})`);
  check(ket && ket.codice === "4471" && ket.via?.t === "ev lenta" && ket.dil?.v === "1" && ket.durata === "1", `…col codice della voce e la diluizione (${JSON.stringify(ket && { codice: ket.codice, via: ket.via, dil: ket.dil })})`);
  const tutto = JSON.stringify(pf);
  check(!/ROSSI|MARIO|700001|RSSMRA|ESMPIO|febbre|10:53/.test(tutto) && pf.every((p) => !("note" in p) && !("ora" in p)), "nei preferiti niente del paziente: né nome, né episodio, né codice fiscale, né note, né ora");
  check(srv.conferme.filter((c) => c.tasto === "Conferma").every((c) => c.serializzata), "TERAPIA_SERIALIZED lo compone la pagina al clic di Conferma (non noi)");

  // ---- 3. Prepara: due preferiti, uno per Conferma, attraverso la pagina
  // (ma non sopra il diario che il medico sta scrivendo nella pagina del paziente)
  await apriTerapiaPannello();
  await doc.fill('textarea[name="DIARIO"]', "visto alle 10");
  await $p('[data-terpref]:has-text("PARACETAMOLO")').click();
  const pagineD = srv.pagineTer.length;
  await $p("#terprepara").click();
  check(await finche(async () => /Prima finisci nella pagina/.test(await $p(".bd").innerText()), 4000) && srv.pagineTer.length === pagineD && /PsoEpisodioClinicoAmbulatorio/.test(doc.url()),
    "un campo della pagina del paziente scritto e non salvato: la pagina Terapia non si apre, il pannello lo dice");
  await doc.goto(URL_PAZ(PZ.ep));
  await apriTerapiaPannello();
  check(await $p("[data-terpref]").count() === 2, "nel pannello i due preferiti");
  await $p("#terq").fill("keto");
  check(await $p("[data-terpref]").count() === 1, "la ricerca filtra i preferiti");
  await $p("#terq").fill("");
  // le etichette di un ordine che aspettano la stampa (un altro paziente) non mandano niente:
  // non spengono «Prepara», e nel ⋯ il reset resta (la ricarica dell'estensione no: quella le perderebbe)
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [{ id: "ord-et", stato: "stampa", ep: "700099", paziente: "VERDI GINO", n: 1, ts: Date.now(), agg: Date.now(),
    pubblico: { tono: "run", titolo: "Confermata", testo: "Etichette pronte" }, stampa: { jobs: [] } }] }));
  await sospendi(400);
  await $p('[data-terpref]:has-text("PARACETAMOLO")').click();
  await $p('[data-terpref]:has-text("KETOROLAC")').click();
  check(await $p(".ricvoci .ricv").count() === 2 && !(await $p("#terprepara").isDisabled()), "scelti due farmaci: «Prepara nel gestionale» acceso — anche con le etichette di un altro ordine che aspettano");
  await $p("#menubtn").click();
  check(await $p("#resetpaz").count() === 1 && await $p("#extreload").count() === 0, "e nel ⋯ «Dimentica i dati…» c'è; «Ricarica» non c'è più");
  await $p("#menubtn").click();
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
  await sospendi(300);
  const termini0 = srv.termini.length, conf0 = srv.conferme.length, pagine0 = srv.pagineTer.length;
  // in testa «‹ Terapia» al posto delle schede; Ctrl+Invio è «Prepara» (Conferma resta del medico)
  check((await $p(".seg.vmenu .segtit").innerText()).trim() === "Terapia", `in testa «‹ Terapia» (got ${await $p(".seg").innerText().catch(() => "")})`);
  await $p("#terq").press("Control+Enter");
  check(await sullaTerapia(), "Ctrl+Invio (= «Prepara nel gestionale»): la pagina Terapia, aperta dal suo pulsante");
  check(srv.pagineTer.length === pagine0 + 1 && /MVPG=PsoEpisodioTerapieImposta&MODALITA=PRESCRIZIONE&EPISODIO_ID=700001&returnPage=PsoEpisodio$/.test(srv.pagineTer.at(-1)), `…l'indirizzo è quello del pulsante (${srv.pagineTer.at(-1)})`);
  check(await finche(async () => /1 di 2 · PARACETAMOLO 1000 MG CPR: controlla e premi Conferma/.test(await banner())), `la riga: «${await banner()}»`);
  const n3 = await doc.evaluate(() => document.getElementById("DESCRIZIONE").name.split("_")[1]);
  const riga = {};
  for (const k of ["DESCRIZIONE", "QUANTITA", "UM", "SOMMINISTRAZIONE_VIA", "TERAPIA_DILUIZIONE_ID", "CONTINUA", "AL_BISOGNO", "FREQUENZA", "DURATA", "NOTE", "PRESC_DATA"]) riga[k] = await val(`${k}_${n3}`);
  check(n3 === "3" && riga.DESCRIZIONE === "PARACETAMOLO 1000 MG CPR" && riga.QUANTITA === "1" && riga.UM === "cpr" && riga.SOMMINISTRAZIONE_VIA === "os" && riga.AL_BISOGNO === true
    && riga.CONTINUA === false && riga.FREQUENZA === "8" && riga.DURATA === "3" && riga.NOTE === "" && riga.PRESC_DATA === "" && riga.TERAPIA_DILUIZIONE_ID === "",
    `la riga nuova (${n3}) ha il farmaco e la dose del preferito, niente note né ora (${JSON.stringify(riga)})`);
  let c = await contatori();
  check(c.scelte.length === 1 && c.scelte[0] === "PARACETAMOLO 1000 MG CPR" && c.tendina >= 1, `il farmaco l'ha scritto la tendina della pagina, scelto fra le sue voci (${JSON.stringify(c.scelte)}, ${c.tendina} ricerche)`);
  const nuovi = srv.termini.slice(termini0);
  check(nuovi.length >= 1 && nuovi.every((t) => t.tipo === "xhr" && /Sa4JsonService\.do\?FUNZIONE=ESEMPIO&ALT_PARAMS=101&_=\d+&term=/.test(t.url)), `le ricerche sono le XHR della pagina, nella forma registrata (${nuovi.map((t) => t.term).join(" | ")})`);
  await sospendi(1500);
  c = await contatori();
  check(srv.conferme.length === conf0 && c.conferme === 0 && c.invii === 0 && c.ser === "", "Conferma non premuta, nessun invio, TERAPIA_SERIALIZED intatto");
  // il medico controlla e preme Conferma: il secondo
  await premi("Update");
  await sullaTerapia();
  check(await finche(async () => /2 di 2 · KETOROLAC 30 MG\/ML FL: controlla e premi Conferma/.test(await banner())), `dopo la Conferma, il secondo: «${await banner()}»`);
  const n4 = await doc.evaluate(() => document.getElementById("DESCRIZIONE").name.split("_")[1]);
  check(n4 === "4" && await val("DESCRIZIONE_4") === "KETOROLAC 30 MG/ML FL" && await val("CODICE_4") === "4471" && await val("UM_4") === "fl" && await val("SOMMINISTRAZIONE_VIA_4") === "ev lenta"
    && await val("TERAPIA_DILUIZIONE_ID_4") === "1" && await val("DURATA_4") === "1", "…nella riga nuova, col codice che la pagina ha messo dalla voce scelta");
  check(srv.salvate[PZ.ep].length === 3 && srv.salvate[PZ.ep][2].descr === "PARACETAMOLO 1000 MG CPR" && srv.salvate[PZ.ep][2].durata === "3", "il primo l'ha confermato il medico: è fra le terapie del server");
  await sospendi(1200);
  c = await contatori();
  check(srv.conferme.length === conf0 + 1 && c.conferme === 0 && c.invii === 0, "anche qui, Conferma la preme solo il medico");
  const conf1 = srv.conferme.length;
  await premi("Update");
  await sullaTerapia();
  check(await finche(async () => /fatto: 2 terapie confermate/.test(await banner())), `alla fine: «${await banner()}»`);
  const t1 = srv.termini.length;
  await sospendi(1200);
  check(await val("DESCRIZIONE_5") === "" && srv.termini.length === t1 && await giro() === null, "e poi più niente: la riga nuova resta vuota, il giro è finito");
  check((await preferiti()).find((p) => p.descr === "PARACETAMOLO 1000 MG CPR")?.n === 2, "il farmaco confermato di nuovo sale nei preferiti (2 volte)");

  // ---- 4. ricaricata senza Conferma: non si riscrive
  await apriTerapiaPannello();
  await $p('[data-terpref]:has-text("KETOROLAC")').click();
  await $p("#terprepara").click();
  await sullaTerapia();
  await finche(async () => /controlla e premi Conferma/.test(await banner()));
  const t2 = srv.termini.length;
  await doc.reload();
  await sullaTerapia();
  check(await finche(async () => /ricaricata senza Conferma: non riscrivo niente/.test(await banner())), `ricaricata a metà: «${await banner()}»`);
  await sospendi(1200);
  check(await val("DESCRIZIONE_5") === "" && srv.termini.length === t2 && await giro() === null, "la riga nuova resta vuota, nessuna ricerca nella tendina");

  // ---- 5. un farmaco nuovo: scritto nella tendina, la voce la sceglie il medico
  await apriTerapiaPannello();
  await $p("#terq").fill("pantopra");
  await $p("#ternuovo").click();
  await $p("#terprepara").click();
  await sullaTerapia();
  check(await finche(async () => /scegli il farmaco nella tendina/.test(await banner())), `un farmaco nuovo: «${await banner()}»`);
  check(await val("DESCRIZIONE_5") === "pantopra" && await doc.locator("ul.ui-autocomplete li.ui-menu-item", { hasText: "PANTOPRAZOLO 40 MG FL EV" }).isVisible() && (await contatori()).scelte.length === 0,
    "…la tendina è aperta sulle voci della pagina, nessuna scelta da noi");

  // ---- 6. due voci con la stessa scritta: non se ne sceglie nessuna
  await doc.evaluate(() => {
    const l = JSON.parse(localStorage.getItem("psassist:terapia.preferiti.v1") || "[]");
    l.push({ descr: "SODIO CLORURO 0,9% 100 ML", codice: "", qta: "1", um: { v: "fl", t: "fl" }, via: { v: "ev", t: "ev" }, dil: null, continua: false, bisogno: false, freq: "", durata: "1", n: 1, ts: 1 });
    localStorage.setItem("psassist:terapia.preferiti.v1", JSON.stringify(l));
  });
  await doc.goto(URL_PAZ(PZ.ep));
  await apriTerapiaPannello();
  await $p('[data-terpref]:has-text("SODIO CLORURO")').click();
  await $p("#terprepara").click();
  await sullaTerapia();
  check(await finche(async () => /più voci «SODIO CLORURO 0,9% 100 ML»: scegli tu/.test(await banner())), `voci uguali: «${await banner()}»`);
  check((await contatori()).scelte.length === 0 && await val("QUANTITA_5") === "", "…nessuna scelta, nessuna dose scritta");

  // ---- 6b. una voce con le minuscole («SF 500cc», dal vero): il nome intero non la
  // trova (il gestionale cerca «SF 500CC»), il nome fino alla prima minuscola sì — e
  // si sceglie lo stesso SOLO la voce con la stessa scritta
  await doc.evaluate(() => {
    const l = JSON.parse(localStorage.getItem("psassist:terapia.preferiti.v1") || "[]");
    l.push({ descr: "SF 500cc", codice: "", qta: "1", um: { v: "fl", t: "fl" }, via: { v: "ev", t: "ev" }, dil: null, continua: false, bisogno: false, freq: "", durata: "1", n: 1, ts: 1 });
    localStorage.setItem("psassist:terapia.preferiti.v1", JSON.stringify(l));
  });
  await doc.goto(URL_PAZ(PZ.ep));
  await apriTerapiaPannello();
  await $p('[data-terpref]:has-text("SF 500cc")').click();
  const tSf = srv.termini.length;
  await $p("#terprepara").click();
  await sullaTerapia();
  check(await finche(async () => /SF 500cc: controlla e premi Conferma/.test(await banner())), `una voce con le minuscole: «${await banner()}»`);
  const nSf = await doc.evaluate(() => document.getElementById("DESCRIZIONE").name);
  const termSf = srv.termini.slice(tSf).map((t) => t.term);
  check(await val(nSf) === "SF 500cc" && termSf.length === 2 && termSf[0] === "SF 500cc" && termSf[1] === "SF 500",
    `…trovata cercando «SF 500» dopo il nome intero, e scelta la voce con la stessa scritta (ricerche: ${termSf.join(" | ")})`);

  // ---- 7. la pagina di un altro paziente: Errore grave, niente scritto
  for (const [come, prepara] of [["il nome in testa", () => { srv.nomeAltro = true; }], ["l'episodio", () => { srv.epAltro = true; }]]) {
    await doc.goto(URL_PAZ(PZ.ep));
    await apriTerapiaPannello();
    await $p('[data-terpref]:has-text("PARACETAMOLO")').click();
    const t3 = srv.termini.length;
    prepara();
    await $p("#terprepara").click();
    await sullaTerapia();
    check(await finche(async () => /Errore grave: questa pagina delle terapie è di un altro paziente/.test(await banner())), `${come} di un altro paziente: «${await banner()}»`);
    await sospendi(1000);
    const nn = await doc.evaluate(() => document.getElementById("DESCRIZIONE").name);
    check(await val(nn) === "" && srv.termini.length === t3 && (await contatori()).tendina === 0, "…niente scritto, nessuna ricerca nella tendina");
    srv.nomeAltro = false; srv.epAltro = false;
  }
  const er = await errori();
  check(er.length >= 2 && er.every((e) => e.dati && e.dati.grave) && !/ROSSI|VERDI/.test(JSON.stringify(er)), `nel Registro degli errori, senza nomi (${er.map((e) => e.dati?.perche).join(", ")})`);

  // ---- 8. un ordine al lavoro in un'altra scheda: si aspetta, prima della pagina e prima della tendina
  await doc.goto(URL_PAZ(PZ.ep));
  await apriTerapiaPannello();
  await $p('[data-terpref]:has-text("PARACETAMOLO")').click();
  await motore(true);
  const p4 = srv.pagineTer.length;
  await $p("#terprepara").click();
  check(await finche(async () => /Aspetto che finisca l'ordine in corso/.test(await $p(".bd").innerText()), 5000), "un ordine altrove: il pannello aspetta");
  await sospendi(2000);
  check(srv.pagineTer.length === p4 && /PsoEpisodioClinicoAmbulatorio/.test(doc.url()), "…e la pagina Terapia non si apre");
  await motore(false);
  check(await sullaTerapia(), "finito l'ordine, si apre");
  await finche(async () => /controlla e premi Conferma/.test(await banner()));
  // sulla pagina: l'ordine parte mentre si apre — la tendina aspetta
  await doc.goto(URL_PAZ(PZ.ep));
  await apriTerapiaPannello();
  await $p('[data-terpref]:has-text("KETOROLAC")').click();
  srv.occupaSuTerapie = true;
  const t5 = srv.termini.length;
  await $p("#terprepara").click();
  await sullaTerapia();
  check(await finche(async () => /Aspetto che finisca l'ordine in corso/.test(await banner()), 6000), `sulla pagina Terapia: «${await banner()}»`);
  await sospendi(2000);
  const n5 = await doc.evaluate(() => document.getElementById("DESCRIZIONE").name);
  check(srv.termini.length === t5 && await val(n5) === "", "…nessuna ricerca nella tendina, niente scritto, finché l'ordine lavora");
  await motore(false);
  check(await finche(async () => /KETOROLAC 30 MG\/ML FL: controlla e premi Conferma/.test(await banner())), `finito l'ordine, la riga: «${await banner()}»`);
  check(await val(n5) === "KETOROLAC 30 MG/ML FL" && srv.termini.length > t5, "…scritta dalla tendina della pagina");

  // ---- 9. la pagina del paziente chiude un giro rimasto a metà
  await doc.goto(URL_PAZ(PZ.ep));
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  check(await giro() === null, "tornati sulla pagina del paziente, nessun giro resta in memoria (il nome del paziente se ne va)");
  check(srv.conferme.filter((x) => x.tasto === "Conferma").length === 4 && srv.conferme.filter((x) => x.tasto === "Chiudi").length === 1, `in tutto, 4 Conferme e 1 Chiudi: tutti del medico (${srv.conferme.length} invii)`);

  // =========================================================================
  console.log("\nterapia dal telefono: leggere, cercare nella tendina, aggiungere col «Conferma» della pagina");
  // ---- 10. il ponte (il ripetitore locale), l'associazione, l'app in formato iPhone (a 2×, per le foto)
  relay = await avviaRelay();
  await sw.evaluate((u) => chrome.storage.local.set({ "ponte.host": u }).then(() => ponteAvvia()), relay.url);
  const extId = new URL(sw.url()).host;
  const pp = await ctx.newPage();
  await pp.goto(`chrome-extension://${extId}/ponte.html`);
  await pp.locator("#associa").click();
  await pp.waitForSelector("#qr svg", { timeout: 8000 });
  const qr = await sw.evaluate(() => ponteQr());
  await pp.close();
  telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
  const telCtx = await telBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "it-IT",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const tel = await telCtx.newPage();
  const testoTel = () => tel.locator("#app").innerText().catch(() => "");
  const aspettaTel = async (re, t = 30000) => ((await finche(async () => re.test(await testoTel()), t)) ? testoTel() : "");
  const foto = async (nome) => { if (SHOTS) await tel.screenshot({ path: join(SHOTS, `terapia-telefono-${nome}.png`) }).catch(() => {}); };
  const esito = () => tel.locator(".tesito").innerText().catch(() => "");
  const aspettaEsito = async (re, t = 60000) => (await finche(async () => re.test(await esito()), t)) ? esito() : `(${await esito()})`;
  const schede = () => ctx.pages().filter((p) => !p.isClosed() && /smarthealth/.test(p.url()));
  const memo = () => sw.evaluate(() => chrome.storage.session.get("ponte.terapia").then((o) => (o["ponte.terapia"] || {})["700001"] || null));
  const erroriTel = () => sw.evaluate(() => chrome.storage.local.get("errori.v1").then((o) => (o["errori.v1"] || []).filter((x) => x.tipo === "terapia telefono")));
  const conferme = () => srv.conferme.filter((x) => x.tasto === "Conferma").length;
  const daTelefono = srv.conferme.length;   // (da qui, gli invii sono quelli del telefono)
  // il medico ha una seconda scheda, sulla pagina del paziente (col pannello: risponde ai comandi del telefono)
  await doc.goto(URL_PAZ(PZ.ep));
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await tel.goto(qr);
  check(!!(await aspettaTel(/ROSSI MARIO/)), "inquadrato il QR: il telefono ha l'elenco del PC, con ROSSI");
  await tel.locator('.paz[data-ep="700001"]').first().click();
  check(await finche(async () => (await tel.locator(".seg button").allInnerTexts()).join("|") === "Richieste|Esiti|Cartella|Terapia", 15000),
    `sul paziente, una quarta scheda «Terapia» (${(await tel.locator(".seg button").allInnerTexts()).join("|")})`);

  // ---- 11. leggere: una scheda di sottofondo apre la Terapia col pulsante del paziente, legge, e si chiude (resta solo per il foglio «＋ Farmaco»)
  const n0 = schede().length, p0 = srv.pagineTer.length, c0 = conferme(), z0 = srv.pazienti;
  const aperte = [];   // le schede che il PC apre per la Terapia, da qui alla fine della 13
  const contaAperte = (p) => aperte.push(p);
  ctx.on("page", contaAperte);
  await tel.locator('[data-a="scheda"][data-s="terapia"]').click();
  const t11 = await aspettaTel(/Letto sul PC alle \d\d:\d\d/);
  const righeTel = () => tel.locator(".ter .tt b").allInnerTexts();
  check(!!t11 && (await righeTel()).length === 4 && (await righeTel())[0] === "KETOROLAC 30 MG/ML FL" && /Letto sul PC (?:\S+ )?alle \d\d:\d\d/.test(t11),
    `le terapie confermate, la più recente in cima, e «Letto sul PC alle …» (${(await righeTel()).join(" | ")})`);
  check(/1 cpr · os · freq\. 8 · al bisogno/.test(t11) && /10:53/.test(t11), "una riga ciascuna: la dose, la via, la frequenza, al bisogno, e l'ora");
  check(srv.pagineTer.length === p0 + 1 && /MVPG=PsoEpisodioTerapieImposta&MODALITA=PRESCRIZIONE&EPISODIO_ID=700001&returnPage=PsoEpisodio$/.test(srv.pagineTer.at(-1)),
    `la pagina Terapia aperta dal pulsante del paziente, col suo indirizzo (${srv.pagineTer.at(-1)})`);
  await sospendi(800);
  check(await finche(async () => schede().length === n0, 8000) && conferme() === c0, "una lettura sola: la scheda di sottofondo si chiude (resta solo col foglio «＋ Farmaco» aperto); niente premuto");
  const m11 = await memo();
  const chiavi = m11 && [Object.keys(m11).sort().join(), Object.keys(m11.righe[0] || {}).sort().join(), Object.keys(m11.opz || {}).sort().join()];
  check(!!m11 && chiavi[0] === "ep,letto,opz,righe" && chiavi[1] === "bisogno,continua,descr,dil,freq,ora,prog,qta,um,via" && chiavi[2] === "dil,um,via"
    && m11.opz.um.length === 11 && m11.opz.via.some((o) => o.v === "ev lenta") && m11.opz.dil.length === 11,
    `la lettura: le righe (solo quello che la pagina ne mostra) e le voci delle tendine, nient'altro (${JSON.stringify(chiavi)})`);
  check(!/febbre|ROSSI|MARIO|RSSMRA|SMPRSS|TERAPIA_SERIALIZED|OPERATORE/.test(JSON.stringify(m11)), "…niente note, niente nome, niente codice fiscale, niente nascosti");
  await foto("1-terapia");

  // ---- 12. «＋ Farmaco»: i preferiti e la tendina della pagina, cercata dal PC
  await tel.locator('[data-a="tnuovo"]').click();
  await tel.waitForSelector(".foglio", { timeout: 5000 });
  const prefTel = await tel.locator('.foglio [data-a="tpref"] b').allInnerTexts();
  check(prefTel.slice(0, 2).sort().join(" | ") === "KETOROLAC 30 MG/ML FL | PARACETAMOLO 1000 MG CPR" && prefTel[2] === "SODIO CLORURO 0,9% 100 ML",
    `il foglio: i preferiti del PC, i più usati in cima (${prefTel.join(" | ")})`);
  check(/1 cpr · os · freq\. 8 · durata 3 · al bisogno/.test(await tel.locator('.foglio [data-a="tpref"]', { hasText: "PARACETAMOLO" }).innerText()), "…ognuno con la dose com'è stata confermata");
  await foto("2-farmaco");
  const q0 = srv.termini.length, p12 = srv.pagineTer.length;
  await tel.locator("#tq").fill("metoc");
  check(await finche(async () => await tel.locator('[data-a="tvoce"]').count() === 1, 30000) && await tel.locator('[data-a="tvoce"]').innerText() === "METOCLOPRAMIDE 10 MG/2 ML FL",
    "scritto «metoc»: le voci della tendina della pagina, cercate dal PC");
  check(srv.termini.slice(q0).some((t) => t.term === "metoc" && t.tipo === "xhr") && srv.pagineTer.length === p12 + 1 && srv.pazienti === z0 + 2 && conferme() === c0,
    `…la ricerca è la XHR della pagina, in una scheda di sottofondo (la pagina del paziente, il suo pulsante «Terapia») (${srv.termini.slice(q0).map((t) => t.term).join(" | ")})`);
  check(schede().length === n0 + 1 && aperte.length === 2, "…che resta aperta, col foglio «＋ Farmaco»");
  await tel.locator('[data-a="tvoce"]').click();
  await tel.waitForSelector("#tqta", { timeout: 5000 });
  check(await tel.locator(".tnome").innerText() === "METOCLOPRAMIDE 10 MG/2 ML FL" && await tel.locator("#tqta").inputValue() === "" && await tel.locator("#tdil").count() === 0
    && await tel.locator('[data-a="taltro"]').count() === 1 && await tel.locator('[name^="NOTE"], #tnote, #tora').count() === 0,
    "la voce scelta: la dose, l'unità e la via in vista; diluizione, frequenza e durata dietro «Altro»; mai le note, mai l'ora");
  await tel.locator("#tqta").fill("1");
  await tel.locator("#tum").selectOption({ label: "fl" });
  await tel.locator("#tvia").selectOption({ label: "ev" });
  const riep = await tel.locator(".triep").innerText();
  check(/ROSSI MARIO/.test(riep) && /METOCLOPRAMIDE 10 MG\/2 ML FL/.test(riep) && /1 fl · ev/.test(riep) && await tel.locator('[data-a="tconferma"]').innerText() === "Conferma per ROSSI M.",
    `il riepilogo, e «Conferma per ROSSI M.» (${riep.replace(/\n+/g, " / ")})`);
  await foto("3-riepilogo");

  // ---- 13. Conferma: la pagina del PC fa il resto — un Conferma, la riga verificata (nella stessa scheda, riletta subito prima)
  const s0 = srv.salvate[PZ.ep].length, p13 = srv.pagineTer.length;
  await tel.locator('[data-a="tconferma"]').click();
  check(/Confermo sul PC/.test(await tel.locator(".triep").innerText()), "mentre il PC lavora: «Confermo sul PC…»");
  check(/Confermata/.test(await aspettaEsito(/Confermata/)), "poi «✓ Confermata»");
  await foto("4-confermata");
  const nuova = srv.salvate[PZ.ep].at(-1);
  check(conferme() === c0 + 1 && srv.salvate[PZ.ep].length === s0 + 1 && nuova.descr === "METOCLOPRAMIDE 10 MG/2 ML FL" && nuova.qta === "1" && nuova.um === "fl" && nuova.via === "ev"
    && nuova.durata === "1" && srv.conferme.at(-1).serializzata && srv.conferme.at(-1).note === 0,
    `un solo «Conferma» (Update), TERAPIA_SERIALIZED composto dalla pagina, niente note: la riga è fra le terapie del server (${JSON.stringify(nuova)})`);
  check(await finche(async () => schede().length === n0, 8000), "la scheda di sottofondo si è chiusa");
  check(aperte.length === 2 && srv.pazienti === z0 + 2 && srv.pagineTer.length === p13 + 1,
    `leggere, poi cercare e aggiungere nella stessa scheda: due in tutto (${aperte.length}), una pagina del paziente ciascuna (${srv.pazienti - z0}); prima di scrivere la pagina Terapia riletta col suo pulsante, una volta (${srv.pagineTer.length - p13})`);
  ctx.off("page", contaAperte);
  await tel.locator('.foglio .capo [data-a="tchiudi"]').click();
  check((await righeTel())[0] === "METOCLOPRAMIDE 10 MG/2 ML FL" && !(await tel.locator(".foglio").count()), "chiuso il foglio, la nuova terapia in cima alla lista (riletta dopo Conferma)");
  check(/Terapia di ROSSI MARIO dal telefono: confermata METOCLOPRAMIDE/.test(JSON.stringify(await sw.evaluate(() => chrome.storage.session.get("ponte").then((o) => o.ponte?.registro || []))) ),
    "nel registro del ponte: confermata, col farmaco");

  // ---- 14. da un preferito; la pagina Terapia aperta (ferma) dal medico lo viene a sapere
  const pc2 = await ctx.newPage();
  await pc2.goto(URL_PAZ(PZ.ep));
  await pc2.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const nav14 = doc.waitForNavigation({ waitUntil: "load", timeout: 15000 });
  await doc.click('a[title="Apri Terapia"]');
  await nav14;
  await sullaTerapia();
  const n14 = schede().length;
  await tel.locator('[data-a="tnuovo"]').click();
  await tel.locator('.foglio [data-a="tpref"]', { hasText: "PARACETAMOLO" }).click();
  await tel.waitForSelector("#tqta", { timeout: 5000 });
  check(await tel.locator("#tqta").inputValue() === "1" && await tel.locator("#tum option:checked").innerText() === "cpr" && await tel.locator("#tvia option:checked").innerText() === "os"
    && await tel.locator("#tbis").isChecked() && await tel.locator("#tfreq").inputValue() === "8" && await tel.locator("#tdur").inputValue() === "3",
    "un preferito: il foglio già pieno, com'era confermato (dose, unità, via; e «Altro» aperto: frequenza, durata, al bisogno)");
  await tel.locator('[data-a="tconferma"]').click();
  check(/Confermata/.test(await aspettaEsito(/Confermata/)), "«Confermata»");
  const parT = srv.salvate[PZ.ep].at(-1);
  check(conferme() === c0 + 2 && parT.descr === "PARACETAMOLO 1000 MG CPR" && parT.qta === "1" && parT.um === "cpr" && parT.via === "os" && parT.bisogno && parT.freq === "8" && parT.durata === "3",
    `…un Conferma in più, la riga come il preferito (${JSON.stringify(parT)})`);
  check(await finche(async () => /confermata dall'iPhone: «PARACETAMOLO 1000 MG CPR»\. Questa pagina è di prima/.test(await banner()), 8000),
    `sul PC, la pagina Terapia di ROSSI aperta e ferma: «${await banner()}»`);
  const navR = doc.waitForNavigation({ waitUntil: "load", timeout: 15000 }).catch(() => null);
  await doc.locator("#psassist-terapia #fai").click();
  await navR;
  await sullaTerapia();
  check(await doc.evaluate(() => document.getElementById("DESCRIZIONE").name) === `DESCRIZIONE_${srv.salvate[PZ.ep].length + 1}` && conferme() === c0 + 2,
    "«Riapri» (il pulsante «Prescrizione» della pagina): la pagina di adesso, con la terapia del telefono; niente inviato");
  await tel.locator('.foglio .capo [data-a="tchiudi"]').click();
  await finche(async () => schede().length === n14, 8000);

  // ---- 15. il medico scrive nella pagina Terapia di ROSSI: dal telefono no, e lo dice
  await doc.fill(`[name="QUANTITA_${await doc.evaluate(() => document.getElementById("DESCRIZIONE").name.split("_")[1])}"]`, "2");
  const p15 = srv.pagineTer.length, z15 = srv.pazienti;
  await tel.locator('[data-a="tnuovo"]').click();
  await tel.locator('.foglio [data-a="tpref"]', { hasText: "KETOROLAC" }).click();
  await tel.locator('[data-a="tconferma"]').click();
  check(/Non confermata: sul PC la Terapia di questo paziente è aperta e già toccata/.test(await aspettaEsito(/Non confermata/)) && srv.pagineTer.length === p15 && srv.pazienti === z15 && conferme() === c0 + 2,
    `«Non confermata: sul PC la Terapia di questo paziente è aperta e già toccata» — nessuna scheda, niente premuto (${await esito()})`);
  await doc.goto(URL_PAZ(PZ.ep));   // (il medico lascia stare)
  await tel.locator('.foglio .capo [data-a="tchiudi"]').click();

  // un farmaco dal telefono, fino all'esito: il preferito (o una voce cercata), il «Conferma per …»
  async function dalTelefono(pref, prima = null) {
    await tel.locator('[data-a="tnuovo"]').click();
    await tel.locator('.foglio [data-a="tpref"]', { hasText: pref }).first().click();
    await tel.waitForSelector("#tqta", { timeout: 5000 });
    if (prima) await prima();
    await tel.locator('[data-a="tconferma"]').click();
    return aspettaEsito(/Confermata|Non confermata|Incerto|Errore grave/);
  }
  const chiudiFoglio = async () => { await tel.locator('.foglio .capo [data-a="tchiudi"]').click().catch(() => {}); await finche(async () => schede().length === n0, 8000); };

  // ---- 16. due voci con la stessa scritta, o nessuna: stop, niente premuto
  const c16 = conferme();
  check(/Non confermata: nella tendina ci sono più voci «SODIO CLORURO 0,9% 100 ML»: va scelta sul PC/.test(await dalTelefono("SODIO CLORURO")) && conferme() === c16,
    `due voci uguali nella tendina: «${await esito()}», niente premuto`);
  await chiudiFoglio();
  await sospendi(500);
  const n16 = schede().length;   // (le schede del medico, adesso: la pagina del paziente e quella della 14)
  await tel.locator('[data-a="tnuovo"]').click();
  await tel.locator("#tq").fill("sodio clor");
  check(await finche(async () => await tel.locator(".foglio .voce.no").count() === 1, 30000) && await tel.locator('[data-a="tvoce"]').count() === 0
    && /Più voci uguali nella tendina: si sceglie sul PC/.test(await tel.locator(".foglio .voce.no").innerText()), "e cercate dal telefono, le voci uguali non si scelgono: «si sceglie sul PC»");
  check(schede().length === n16 + 1, "(dopo la ricerca la scheda resta, per la prossima)");
  await tel.locator('.foglio .capo [data-a="tchiudi"]').click();
  check(await finche(async () => schede().length === n16, 8000), "chiuso il foglio «＋ Farmaco» sul telefono: la scheda tenuta si chiude");
  await tel.locator('[data-a="tnuovo"]').click();
  await tel.locator("#tq").fill("panto");
  await finche(async () => await tel.locator('[data-a="tvoce"]').count() === 1, 30000);
  check(schede().length === n16 + 1, "(una ricerca nuova: una scheda nuova, tenuta)");
  await sw.evaluate(() => { const v = Date.now; self.__oraVeraT = v; Date.now = () => v() + 2 * 60e3 + 30e3; return ponteControlla().finally(() => { Date.now = v; }); });
  check(await finche(async () => schede().length === n16, 8000), "2 minuti senza lavoro: la scheda tenuta si chiude da sola");
  await tel.locator('[data-a="tvoce"]').click();
  await tel.locator("#tqta").fill("1");
  srv.senza = "PANTOPRAZOLO";   // (sparito dalla tendina, intanto)
  await tel.locator('[data-a="tconferma"]').click();
  check(/Non confermata: «PANTOPRAZOLO 40 MG FL EV» non c'è uguale nella tendina del gestionale/.test(await aspettaEsito(/Non confermata/)) && conferme() === c16,
    `una voce che la tendina non dà più: «${await esito()}», niente premuto`);
  srv.senza = "";
  await chiudiFoglio();

  // ---- 17. la pagina Terapia di un altro paziente: Errore grave, niente scritto, niente cercato
  for (const [come, prepara] of [["il nome in testa", () => { srv.nomeAltro = true; }], ["l'episodio", () => { srv.epAltro = true; }]]) {
    const t17 = srv.termini.length, c17 = conferme();
    prepara();
    check(/Errore grave: la pagina delle terapie sul PC è di un altro paziente — niente confermato/.test(await dalTelefono("KETOROLAC")) && srv.termini.length === t17 && conferme() === c17,
      `${come} di un altro paziente: «${await esito()}» — nessuna ricerca nella tendina, niente premuto`);
    srv.nomeAltro = false; srv.epAltro = false;
    await chiudiFoglio();
  }
  const et = await erroriTel();
  check(et.filter((x) => x.dati && x.dati.grave).length >= 2 && !/ROSSI|VERDI|700001/.test(JSON.stringify(et)), `nel registro degli errori («terapia telefono»), senza nomi (${et.map((x) => x.dati?.perche).join(", ")})`);

  // ---- 18. riletta la riga, un campo non è più quello scritto: stop, niente premuto
  srv.ritocca = true;
  const c18 = conferme();
  check(/Non confermata: riletta la riga, la quantità non è quella scelta/.test(await dalTelefono("PARACETAMOLO")) && conferme() === c18, `la pagina cambia la quantità dopo: «${await esito()}», niente premuto`);
  srv.ritocca = false;
  await chiudiFoglio();

  // ---- 19. Conferma premuta ma la terapia non si vede: «Incerto», mai di nuovo
  srv.ignora = true;
  const c19 = conferme();
  check(/Incerto: controlla sul PC/.test(await dalTelefono("KETOROLAC")) && conferme() === c19 + 1, `la Conferma che non si vede fra le confermate: «${await esito()}», un Conferma solo`);
  await sospendi(2500);
  check(conferme() === c19 + 1 && await tel.locator('[data-a="tconferma"]').count() === 0 && await tel.locator('.triep [data-a="trileggi"]').count() === 1,
    "…e non si ripreme: sul telefono niente «Conferma», solo «Rileggi la Terapia»");
  srv.ignora = false;
  check((await erroriTel()).some((x) => x.dati?.perche === "conferma non vista"), "(nel registro degli errori: «conferma non vista»)");
  await chiudiFoglio();

  // ---- 20. la scheda si ricarica mentre il server risponde alla Conferma: si guarda, non si ripreme
  srv.ricarica = true;
  const c20 = conferme(), p20 = srv.pagineTer.length;
  check(/Confermata/.test(await dalTelefono("KETOROLAC")) && conferme() === c20 + 1 && srv.pagineTer.length >= p20 + 2,
    `ricaricata dopo «Conferma» (una GET della pagina): «${await esito()}», un Conferma solo (${conferme() - c20})`);
  await chiudiFoglio();

  // ---- 21. lo stesso numero rimandato (due volte insieme, e dopo): la stessa risposta, un Conferma solo
  const c21 = conferme();
  const voceK = { descr: "KETOROLAC 30 MG/ML FL", codice: "4471", qta: "1", um: { v: "fl", t: "fl" }, via: { v: "ev lenta", t: "ev lenta" }, dil: { v: "1", t: "fisiologica 100 ml" } };
  const due = await sw.evaluate(async (voce) => {
    const m = (await chrome.storage.session.get("ponte.terapia"))["ponte.terapia"]["700001"];
    const d = { ep: "700001", rq: "rq-due-volte-0001", voce, visti: m.righe.map((r) => r.prog) };
    return Promise.all([ponteTerapiaAggiungi(d), ponteTerapiaAggiungi(d)]);
  }, voceK);
  check(due[0].ok && due[1].ok && conferme() === c21 + 1, `lo stesso numero due volte insieme: tutt'e due «Confermata», un Conferma solo (${conferme() - c21})`);
  const dopo = await sw.evaluate((voce) => ponteTerapiaAggiungi({ ep: "700001", rq: "rq-due-volte-0001", voce, visti: [] }), voceK);
  check(dopo.ok && conferme() === c21 + 1, "…e rimandato più tardi: com'è andata, senza rifarla");
  const inc = await sw.evaluate(() => chrome.storage.session.get("ponte.terapia.rq").then((o) => Object.values(o["ponte.terapia.rq"] || {}).filter((x) => x.esito && x.esito.incerto).length));
  check(inc >= 1, "(e quello incerto resta incerto, per il suo numero)");

  // ---- 22. un ordine al lavoro (la stessa sessione del server): si aspetta — niente pagina, niente tendina
  const motoreTutto = (on) => sw.evaluate((on) => {
    const m = on ? { tab: 999999, id: "ordine-altrove", scade: Date.now() + 120e3 } : null;
    return motoreScrivi(m);
  }, on);
  await motoreTutto(true);
  const z22 = srv.pazienti, p22 = srv.pagineTer.length, q22 = srv.termini.length, c22 = conferme();
  await tel.locator('[data-a="tnuovo"]').click();
  await tel.locator('.foglio [data-a="tpref"]', { hasText: "PARACETAMOLO" }).first().click();
  await tel.locator('[data-a="tconferma"]').click();
  await sospendi(3500);
  check(srv.pazienti === z22 && srv.pagineTer.length === p22 && srv.termini.length === q22 && conferme() === c22 && /Confermo sul PC/.test(await tel.locator(".triep").innerText()),
    "un ordine lavora: il PC aspetta — nessuna pagina del paziente, né Terapia, né tendina; il telefono «Confermo sul PC…»");
  await motoreTutto(false);
  check(/Confermata/.test(await aspettaEsito(/Confermata|Non confermata|Incerto/)) && conferme() === c22 + 1, `finito l'ordine: «${await esito()}»`);
  await chiudiFoglio();
  const dalTel = srv.conferme.slice(daTelefono);
  check(dalTel.length === 6 && dalTel.every((x) => x.tasto === "Conferma" && x.serializzata && !x.note),
    `dal telefono 6 Conferme in tutto, ognuna col TERAPIA_SERIALIZED composto dalla pagina, mai note né Chiudi (${dalTel.map((x) => x.tasto).join(",")})`);

  // ---- 23. la scheda tenuta in cui il medico entra (la sceglie lui, o Chrome gliela dà chiudendo la sua): da lì è sua
  const nate23 = [];
  const conta23 = (p) => nate23.push(p);
  ctx.on("page", conta23);
  await tel.locator('[data-a="tnuovo"]').click();
  await tel.locator("#tq").fill("panto");
  await finche(async () => await tel.locator('[data-a="tvoce"]').count() === 1, 30000);
  const tenuta = nate23.find((p) => !p.isClosed() && /PsoEpisodioTerapieImposta/.test(p.url()));
  check(!!tenuta, "(cercato «panto»: la scheda di sottofondo resta, ferma sulla pagina Terapia)");
  await tenuta.bringToFront();
  check(await finche(async () => await tenuta.locator("#psassist-host").count() === 1, 8000),
    "il medico entra nella scheda tenuta: diventa una pagina come le altre, col pannello (la pill)");
  const nT = await tenuta.evaluate(() => document.getElementById("DESCRIZIONE").name.split("_")[1]);
  await tenuta.fill(`[name="QUANTITA_${nT}"]`, "2");
  await doc.bringToFront();   // (scrive e se ne va: la scheda torna dietro)
  const quantita = () => tenuta.inputValue(`[name="QUANTITA_${nT}"]`).catch(() => "chiusa");
  await tel.locator('.foglio .capo [data-a="tchiudi"]').click();
  await sw.evaluate(() => { const v = Date.now; Date.now = () => v() + 2 * 60e3 + 30e3; return ponteControlla().finally(() => { Date.now = v; }); });
  await sospendi(1500);
  check(!tenuta.isClosed() && await quantita() === "2", "…e resta sua: né il foglio chiuso sul telefono né 2 minuti senza lavoro la chiudono, e quello che ha scritto c'è");
  const c23 = conferme(), pT = srv.pagineTer.length;
  check(/Non confermata: sul PC la Terapia di questo paziente è aperta e già toccata/.test(await dalTelefono("PARACETAMOLO")) && conferme() === c23 && srv.pagineTer.length === pT && await quantita() === "2",
    `un farmaco dal telefono per lo stesso paziente: la sua pagina scritta lo ferma — mai riusata, niente premuto, il suo testo resta (${await esito()})`);
  await tel.locator('.foglio .capo [data-a="tchiudi"]').click();
  await tenuta.close();   // (il medico la chiude)
  const giaNate = nate23.length;
  check(/Confermata/.test(await dalTelefono("PARACETAMOLO")) && conferme() === c23 + 1 && nate23.length > giaNate,
    `chiusa la sua pagina, il farmaco passa da una scheda di sottofondo nuova (${await esito()})`);
  await tel.locator('.foglio .capo [data-a="tchiudi"]').click();
  ctx.off("page", conta23);

  // (una ricerca dal telefono che lascia una scheda tenuta, ferma sulla pagina Terapia: quella scheda)
  const tenutaCerca = async (q) => {
    const nate = [];
    const conta = (p) => nate.push(p);
    ctx.on("page", conta);
    if (!(await tel.locator(".foglio #tq").count())) await tel.locator('[data-a="tnuovo"]').click();
    await tel.locator("#tq").fill(q);
    await finche(async () => await tel.locator('[data-a="tvoce"]').count() >= 1 && !!nate.find((p) => !p.isClosed() && /PsoEpisodioTerapieImposta/.test(p.url())), 30000);
    ctx.off("page", conta);
    return nate.find((p) => !p.isClosed() && /PsoEpisodioTerapieImposta/.test(p.url())) || null;
  };

  // ---- 24. il medico entra nella scheda tenuta proprio mentre il telefono la riprende per una ricerca (nei due
  // ordini): è sua — il lavoro non va lì (se ne apre un'altra), lei non si chiude, e diventa una pagina col pannello
  const idTenuta = () => sw.evaluate(() => ([...pt.terapie].find(([, w]) => w.fermo) || [0])[0]);
  // (il foglio «＋ Farmaco» chiuso: la ricerca dopo parte da un elenco vuoto, e la scheda tenuta è la sua)
  const chiudiFoglioTel = async () => {
    if (await tel.locator(".foglio .capo [data-a=\"tchiudi\"]").count()) await tel.locator('.foglio .capo [data-a="tchiudi"]').click().catch(() => {});
    await finche(async () => !(await tel.locator(".foglio #tq").count()) && (await sw.evaluate(() => pt.terapie.size)) === 0, 8000);
  };
  for (const [come, prima, q] of [["entra, e subito il telefono la riprende", "vista", "ketor"], ["il telefono la riprende, e subito entra", "riusa", "parac"]]) {
    await chiudiFoglioTel();
    const tE = await tenutaCerca(q);
    const idE = await idTenuta(), qE = srv.termini.length;
    const rE = await sw.evaluate(async ({ id, prima }) => {
      const job = { cosa: "cerca", q: "metoc" };
      if (prima === "vista") { const v = ponteTerapiaVista(id); const r = await ponteTerapiaRiusa(id, "ROSSI MARIO", job); await v; return r; }
      const r = ponteTerapiaRiusa(id, "ROSSI MARIO", job); await ponteTerapiaVista(id); return r;
    }, { id: idE, prima });
    await sospendi(1500);
    check(!!tE && !!idE && rE === null && srv.termini.length === qE && !tE.isClosed() && await finche(async () => await tE.locator("#psassist-host").count() === 1, 8000)
      && !(await sw.evaluate((id) => pt.terapie.has(id), idE)),
      `${come}: il lavoro non va nella sua scheda (nessuna ricerca lì), lei resta aperta e diventa una pagina col pannello (${JSON.stringify(rE)})`);
    await tE?.close();
  }

  await chiudiFoglioTel();

  // ---- 26. la scheda tenuta finisce sulla pagina d'accesso (la sessione del gestionale scaduta): lasciata andare, senza errori
  const t24 = await tenutaCerca("metoc");
  const idT = await sw.evaluate(() => ([...pt.terapie].find(([, w]) => w.fermo) || [0])[0]);
  // quello che dice la scheda tenuta dalla pagina d'accesso: «fatto», senza un lavoro in corso
  const r24 = await sw.evaluate(({ id, url }) => new Promise((res) => ponteDaPagina({ t: "ponteTerapiaFatto", ok: false, testo: "il gestionale chiede di rifare l'accesso" }, { tab: { id }, url }, res)),
    { id: idT, url: URL_PAZ(PZ.ep) });
  check(!!t24 && !!idT && r24 && r24.ok === true && !r24.why && await finche(async () => t24.isClosed() && !(await sw.evaluate((id) => pt.terapie.has(id), idT)), 8000),
    `la scheda tenuta (ferma, senza lavoro) dice «fatto» dalla pagina d'accesso: lasciata andare e chiusa, nessun errore (${JSON.stringify(r24)})`);
  // …e davvero: la scheda tenuta ricaricata trova la pagina d'accesso
  const t24b = await tenutaCerca("ketor");
  srv.login = true;
  await t24b?.reload().catch(() => {});
  check(!!t24b && await finche(async () => t24b.isClosed() && (await sw.evaluate(() => pt.terapie.size)) === 0, 10000),
    "ricaricata, la scheda tenuta trova la pagina d'accesso: chiusa, e il PC non la tiene più");
  srv.login = false;
  await pc2.close();
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
