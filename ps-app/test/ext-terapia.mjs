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
 *   node test/ext-terapia.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync } from "node:fs";
import { paginaTerapie } from "./fixtures/terapie.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-terapia-" + process.pid);
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
];
const srv = { salvate: { [PZ.ep]: [], [ALTRO.ep]: [] }, conferme: [], termini: [], pagineTer: [], nomeAltro: false, epAltro: false, occupaSuTerapie: false };
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
  const terapie = (e) => { const p = e === ALTRO.ep || srv.nomeAltro ? ALTRO : PZ; return html(paginaTerapie({ ep: e, nome: p.name, triage: p.triage, salvate: srv.salvate[e] || [], coda: TENDINA })); };
  if (/Sa4JsonService\.do$/.test(u.pathname)) {
    srv.termini.push({ url: u.href, tipo: req.resourceType(), term: u.searchParams.get("term") || "" });
    const q = (u.searchParams.get("term") || "").toUpperCase();
    return r.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(FARMACI.filter((f) => f.label.includes(q)).slice(0, 20)) }).catch(() => {});
  }
  if (mvpg === "PsoEpisodioTerapieImposta" && req.method() === "POST") {
    const b = new URLSearchParams(req.postDataBuffer()?.toString("latin1") || "");
    const tasto = b.has("Update") ? "Conferma" : b.has("Chiudi") ? "Chiudi" : "?";
    srv.conferme.push({ ep, tasto, serializzata: !!b.get("TERAPIA_SERIALIZED") });
    if (tasto === "Chiudi") return html(pazientePage(ep));
    for (const [k, descr] of b) {
      const m = /^DESCRIZIONE_(\d+)$/.exec(k);
      if (!m || !descr || b.get(`TERAPIA_PROG_${m[1]}`)) continue;
      const g = (x) => b.get(`${x}_${m[1]}`) || "";
      const l = srv.salvate[ep];
      l.push({ descr, qta: g("QUANTITA"), um: g("UM"), via: g("SOMMINISTRAZIONE_VIA"), dil: g("TERAPIA_DILUIZIONE_ID"), continua: !!g("CONTINUA"), bisogno: !!g("AL_BISOGNO"),
        freq: g("FREQUENZA") || "24", durata: g("DURATA"), codice: g("CODICE"), prog: String(l.length + 1) });
    }
    return terapie(ep);
  }
  if (mvpg === "PsoEpisodioTerapieImposta") {
    srv.pagineTer.push(u.href);
    if (srv.occupaSuTerapie) { srv.occupaSuTerapie = false; await motore(true); }
    // (epAltro: all'indirizzo di questo episodio il server dà la pagina di un altro)
    return terapie(srv.epAltro && ep === PZ.ep ? ALTRO.ep : ep);
  }
  if (mvpg === "PsoEpisodioClinicoAmbulatorio") return html(pazientePage(ep));
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
  await $p('[data-terpref]:has-text("PARACETAMOLO")').click();
  await $p('[data-terpref]:has-text("KETOROLAC")').click();
  check(await $p(".ricvoci .ricv").count() === 2 && !(await $p("#terprepara").isDisabled()), "scelti due farmaci: «Prepara nel gestionale» acceso");
  const termini0 = srv.termini.length, conf0 = srv.conferme.length, pagine0 = srv.pagineTer.length;
  await $p("#terprepara").click();
  check(await sullaTerapia(), "«Prepara nel gestionale»: la pagina Terapia, aperta dal suo pulsante");
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
} catch (e) {
  console.error(e);
  fail++;
} finally {
  await ctx.close().catch(() => {});
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* niente */ }
}
console.log(fail ? `\n${fail} controlli falliti` : "\ntutti i controlli passati");
process.exit(fail ? 1 : 0);
