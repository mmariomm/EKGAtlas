#!/usr/bin/env node
/*
 * «Accetta in ambulatorio» dal telefono, con l'estensione VERA, il ponte vero
 * (il ripetitore locale) e l'app in formato iPhone. Il gestionale finto è
 * rifatto dalla FORMA delle registrazioni (nomi e numeri inventati): la lista
 * del triage (PsoPazientiTriage, una per area: chi è al triage per l'area in
 * testa) con la freccia di ogni riga (`a[name="AccettaAMBU"]`,
 * PsoEpisodioTriageToAmbulatorio, che accetta con una GET), la pagina di
 * passaggio che si porta da sola a PsoEpisodio, il suo refresh verso la pagina
 * del paziente in ambulatorio, e la lista dell'ambulatorio.
 * Si prova: due tocchi col nome; il PC apre la lista del triage in una scheda
 * di sottofondo, clicca la freccia di QUELLA riga una volta e lo verifica —
 * «In ambulatorio» —, il paziente si apre sul telefono sulla Cartella; lo
 * stesso numero rimandato (anche due volte insieme) non riclicca; un paziente
 * già accettato non si riaccetta; la freccia di un altro episodio o il nome
 * diverso nella riga: «Errore grave», niente cliccato; l'area sbagliata:
 * niente cliccato; la pagina che si ferma dopo il clic: «Incerto», mai di
 * nuovo; tornati sulla lista del triage, la lista dell'ambulatorio lo dice;
 * un paziente noto al PC ancora al triage si accetta dalla sua pagina sul telefono.
 *   node test/ext-accetta.mjs   (TEST_SHOTS_DIR=… per le foto del telefono)
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync } from "node:fs";
import { avviaRelay } from "../ponte/relay-node.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-accetta-" + process.pid);
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
const RIS = { alta: "00910001P", bassa: "00940001P" };
const AREA = { alta: "AREA ALTA INTENSITA'", bassa: "AREA MEDIA - BASSA INTENSITA'" };
const P = (ep, name, nato, eta, triage, area) => ({ ep, name, nato, eta, triage, area });
const MEDICO = P("710010", "BRUNI ELSA", "11/11/1955", 70, "VERDE", "bassa");   // in ambulatorio: la scheda del medico
const NERI = P("710001", "NERI PAOLA", "03/04/1961", 65, "VERDE", "bassa");
const GIALLI = P("710002", "GIALLI UGO", "12/12/1979", 46, "AZZURRO", "bassa");
const VIOLA = P("710003", "VIOLA RITA", "07/07/1950", 76, "ARANCIONE", "alta");
const ROSA = P("710004", "ROSA LINA", "21/02/1988", 38, "VERDE", "bassa");
const BIANCO = P("710005", "BIANCO PIO", "30/09/1944", 82, "AZZURRO", "bassa");
const TUTTI = [MEDICO, NERI, GIALLI, VIOLA, ROSA, BIANCO];
const chi = (ep) => TUTTI.find((p) => p.ep === ep) || null;
// La chiave di una riga del Triage è la STESSA che il comando «triage» del PC calcola e manda al
// telefono: chiaveTriage = FNV-1a di «NOME NORMALIZZATO|ora d'arrivo (ms)». NON è la chiave di nome
// e nascita (chiaveSmart): quella sta nella mappa/smart, questa è l'id del triage sul telefono.
const fnv = (d) => { let h = 0x811c9dc5; for (const c of d) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h.toString(36); };
const norm = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 ]+/g, " ").trim().replace(/\s+/g, " ");
// un'ora d'arrivo stabile, nel passato e arrotondata al minuto per ogni paziente (come la mostra la lista)
const BASE_ARRIVO = Math.floor((Date.now() - 20 * 60e3) / 60e3) * 60e3;
const arrivoDi = (p) => BASE_ARRIVO - TUTTI.indexOf(p) * 60e3;
const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const trKey = (nome, arrivo) => "tr" + fnv(`${norm(nome)}|${Number(arrivo) || 0}`);
const chiave = (p) => trKey(p.name, arrivoDi(p));
// (dopo: dove porta la pagina di passaggio — "episodio" come nella registrazione, "lista" la lista del
// triage, "ferma" da nessuna parte; nomeRiga / frecciaEp: la riga di un episodio con un altro nome, o la
// sua freccia per un altro episodio; accetti: le GET della freccia)
const srv = { area: "bassa", stato: Object.fromEntries(TUTTI.map((p) => [p.ep, p === MEDICO ? "amb" : "triage"])), accetti: [], pagine: [],
  dopo: "episodio", nomeRiga: {}, frecciaEp: {} };
const pagina = (titolo, corpo, testaExtra = "") => `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252">${testaExtra}<title>${titolo}</title></head><body>
  <table class="AFCHeaderTable" width="100%"><tbody><tr><td width="70%" align="center"><font style="font-size: 130%; font-weight: bolder; ">OSPEDALE ESEMPIO</font><br><font style="font-size: 110%; font-weight: bolder; ">${AREA[srv.area]}</font></td></tr></tbody></table>${corpo}</body></html>`;
const linguetta = (p, nome = p.name) => `<div class="myLinguetta"><table cellpadding="3" width="100%"><tbody><tr><td nowrap width="1%"><img title="${p.triage}"></td>
  <td nowrap width="40%" title="${p.triage}"><strong>${nome}</strong><br>${p.nato}(${p.eta})<small> campo</small></td><td width="50%"><strong>MOTIVO</strong></td></tr></tbody></table></div>`;
const alTriage = () => TUTTI.filter((p) => srv.stato[p.ep] === "triage" && p.area === srv.area);
const inAmb = () => TUTTI.filter((p) => srv.stato[p.ep] === "amb");
const schede = (sel) => `<table><tr><td><a class="${sel === "tri" ? "shiny-button-selected" : "shiny-button"}" href="?MVPG=PsoPazientiTriage">TRIAGE (${alTriage().length})</a></td>
  <td><a class="${sel === "amb" ? "shiny-button-selected" : "shiny-button"}" href="?MVPG=PsoPazientiAmbulatorio">Ambulatorio (${inAmb().length})</a></td></tr></table>`;
// (il jQuery della pagina, quanto basta all'onclick della freccia)
const JQ = `<script>window.$ = function () { return { ready: function (f) { f(); }, hide: function () {} }; };</script>`;
// (come nella registrazione, la lista si ricarica da sola ogni 10 secondi, coi filtri vuoti)
const listaTriage = () => pagina("Pronto Soccorso", `${JQ}${schede("tri")}
  <form method="post" name="PazientiFiltro" action="menuPso.do?ccsForm=PazientiFiltro:Edit&amp;MVPG=PsoPazientiTriage"></form>
  <table class="AFCFormTABLE"><tbody>${alTriage().map((p) => `<tr><td class="AFCDataTD">voce<br></td>
    <td class="AFCDataTD"><a style="text-decoration: none" href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoTriage&amp;EPISODIO_ID=${p.ep}" title="Apri Episodio">${linguetta(p, srv.nomeRiga[p.ep])}</a></td>
    <td class="AFCDataTD" align="center"><a name="" href="menuPsoEpisodio.do?MVPG=PsoEpisodioDiario&amp;EPISODIO_ID=${p.ep}" title="Apri Diario Clinico" class="myButtonList">D</a>&nbsp;<a name="AccettaAMBU" href="menuPsoEpisodio.do?MVPG=PsoEpisodioTriageToAmbulatorio&amp;EPISODIO_ID=${srv.frecciaEp[p.ep] || p.ep}&amp;RISORSA_ID=${RIS[srv.area]}&amp;returnPage=PsoPazientiTriage" title="Accetta in ambulatorio" class="myButtonList" target="_self" style="color:white" onclick="$(document).ready(function(){$(&quot;controllo&quot;).hide();}); window.location.href; "><img title="Accetta in ambulatorio" width="22"></a></td>
    <td class="AFCDataTD" valign="top">${hhmm(arrivoDi(p))}<br>reparto</td><td class="AFCDataTD" valign="top" nowrap>INFERMIERE ESEMPIO<br>${AREA[p.area]} </td></tr>`).join("")}</tbody></table>`,
  `<meta http-equiv="refresh" content="10;URL=?MVPG=PsoPazientiTriage&amp;s_ASSISTITO=&amp;s_PERCORSO=&amp;s_LINEA_ATTIVITA=">`);
const listaAmb = () => pagina("Pronto Soccorso", `${schede("amb")}
  <form method="post" name="PazientiFiltro" action="menuPso.do?ccsForm=PazientiFiltro:Edit&amp;MVPG=PsoPazientiAmbulatorio"></form>
  <table class="AFCFormTABLE"><tbody>${inAmb().map((p) => `<tr><td class="AFCDataTD"><a style="text-decoration: none" href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${p.ep}" title="Apri Episodio">${linguetta(p)}</a></td>
    <td class="AFCDataTD" name="INGRESSO">08:10</td></tr>`).join("")}</tbody></table>`);
const riquadro = (p) => `<table><tr><td title="${p.triage}"><font style="font-size: 120%; font-weight: bolder; ">${p.ep}</font><br><font style="font-size: 150%; font-weight: bolder; ">${p.name}</font><br><font style="font-size: 120%; font-weight: bolder; ">${p.nato} (${p.eta}) F</font></td></tr></table>`;
// la pagina del paziente, al triage o in ambulatorio: il modulo della cartella e il link per ordinare
const pazPage = (p, mvpg) => pagina(p.name, `${riquadro(p)}
  <form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=${mvpg}&amp;EPISODIO_ID=${p.ep}">
    <textarea name="ANAMNESI">Riferisce dolore inventato</textarea><textarea name="ALLERGIE">Nessuna</textarea><textarea name="ESAME_OBIETTIVO"></textarea>
    <input class="AFCButton" type="submit" value="Conferma" name="Update"></form>
  <a href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${p.ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P&amp;toPage=RcsRichiestaPrestazioniRicercaErogatore" title="Richieste Laboratorio">Laboratorio</a>`);
const URL_PAZ = (p, mvpg = "PsoEpisodioClinicoAmbulatorio") => `${ORIGIN}${DIR}menuPsoEpisodio.do?MVPG=${mvpg}&EPISODIO_ID=${p.ep}`;

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
});
let sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js"));
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
await ctx.route(`${ORIGIN}/**`, async (r) => {
  const req = r.request(), u = new URL(req.url()), mvpg = u.searchParams.get("MVPG"), ep = u.searchParams.get("EPISODIO_ID");
  const html = (b) => r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: Buffer.from(b, "latin1") }).catch(() => {});
  if (req.resourceType() === "document" || req.resourceType() === "xhr" || req.resourceType() === "fetch") srv.pagine.push(`${mvpg || u.pathname}${ep ? ":" + ep : ""}`);
  const p = chi(ep);
  if (mvpg === "PsoPazientiTriage" && /\/menuPso\.do$/.test(u.pathname)) return html(listaTriage());
  if (mvpg === "PsoPazientiAmbulatorio" && /\/menuPso\.do$/.test(u.pathname)) return html(listaAmb());
  // la freccia: la GET che accetta, e la pagina di passaggio che va da sola dove deve
  if (mvpg === "PsoEpisodioTriageToAmbulatorio" && p) {
    srv.accetti.push({ ep, ris: u.searchParams.get("RISORSA_ID"), ritorno: u.searchParams.get("returnPage"), tipo: req.resourceType() });
    if (srv.stato[ep] === "triage") srv.stato[ep] = "amb";
    const dove = srv.dopo === "lista" ? "menuPso.do?MVPG=PsoPazientiTriage" : `?MVPG=PsoEpisodio&EPISODIO_ID=${ep}`;
    return html(pagina(p.name, srv.dopo === "ferma" ? "<p>in attesa</p>" : `<script language="javascript">setTimeout(function () { window.location = "${dove}"; }, 0);</script>`));
  }
  if (mvpg === "PsoEpisodio" && p) {
    const dove = srv.stato[ep] === "amb" ? "PsoEpisodioClinicoAmbulatorio" : "PsoEpisodioClinicoTriage";
    return html(pagina(p.name, `<table><tr><td><meta http-equiv="refresh" content="0;url=?MVPG=${dove}&amp;EPISODIO_ID=${ep}"></td></tr></table>`));
  }
  if ((mvpg === "PsoEpisodioClinicoAmbulatorio" || mvpg === "PsoEpisodioClinicoTriage") && p) {
    // (l'indirizzo dice l'una o l'altra; la pagina è quella del suo stato, come il server)
    return html(pazPage(p, srv.stato[ep] === "amb" ? "PsoEpisodioClinicoAmbulatorio" : "PsoEpisodioClinicoTriage"));
  }
  return html(pagina("Pronto Soccorso", "<p>altro</p>"));
});

const doc = await ctx.newPage();
const accetti = (ep) => srv.accetti.filter((x) => !ep || x.ep === ep);
const schedeGest = () => ctx.pages().filter((p) => !p.isClosed() && /smarthealth/.test(p.url()));
const errori = () => sw.evaluate(() => chrome.storage.local.get("errori.v1").then((o) => (o["errori.v1"] || []).filter((x) => x.tipo === "accetta telefono")));
const registro = () => sw.evaluate(() => chrome.storage.session.get("ponte").then((o) => (o.ponte?.registro || []).map((x) => x.testo)));
const ls = (k) => doc.evaluate((k) => JSON.parse(localStorage.getItem("psassist:" + k) || "null"), k);
// la riga come la salva il PC (TRIAGE_LISTA): nome, arrivo, area… e NIENTE `.k` — il comando «triage»
// la ricalcola (chiaveTriage) a ogni invio al telefono, come nel codice vero. (Fallisce su 7199f21: lì
// l'accettazione dalla LISTA cercava la riga con la chiaveSmart `x.k`, che qui non c'è → «Non è più al Triage».)
const rigaTriage = (p) => ({ nome: p.name, breve: `${p.name.split(" ")[0]} ${p.name.split(" ")[1][0]}.`, eta: p.eta, triage: p.triage, area: p.area === "alta" ? "Alta intensità" : "Bassa", arrivo: arrivoDi(p) });

console.log("accetta in ambulatorio dal telefono: la freccia della riga nella lista del triage, una volta, verificata");
let telBrowser = null, relay = null;
try {
  // ---- il medico ha una scheda sulla pagina di un paziente in ambulatorio (col pannello: risponde al telefono)
  await doc.goto(URL_PAZ(MEDICO));
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  // il Triage letto dal PC (la lista smart: cinque righe, senza `.k`: la chiave la fa il comando «triage») e le aree di Imposta
  await doc.evaluate(({ righe, opz }) => {
    localStorage.setItem("psassist:triage.lista.v1", JSON.stringify({ ts: Date.now(), righe }));
    localStorage.setItem("psassist:aree.opzioni.v1", JSON.stringify(opz));
  }, { righe: [NERI, GIALLI, VIOLA, ROSA, BIANCO].map(rigaTriage), opz: { alta: { id: RIS.alta, label: AREA.alta }, bassa: { id: RIS.bassa, label: AREA.bassa } } });

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
  telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
  const telCtx = await telBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "it-IT",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const tel = await telCtx.newPage();
  const testoTel = () => tel.locator("#app").innerText().catch(() => "");
  const aspettaTel = async (re, t = 30000) => ((await finche(async () => re.test(await testoTel()), t)) ? testoTel() : "");
  const foto = async (nome) => { if (SHOTS) await tel.screenshot({ path: join(SHOTS, `accetta-telefono-${nome}.png`) }).catch(() => {}); };
  const bottone = (p) => tel.locator(`[data-a="accetta"][data-id="${chiave(p)}"]`);
  const esitoRiga = (p) => tel.locator(".paz.trg", { hasText: p.name }).locator(".accesito").innerText().catch(() => "");
  const avviso = () => tel.locator(".avviso, [role=alert], [role=status]").allInnerTexts().then((l) => l.join(" | ")).catch(() => "");
  const tornaAllElenco = async () => { if (await tel.locator('[data-a="indietro"]').count()) await tel.locator('[data-a="indietro"]').first().click(); await aspettaTel(/Triage ·/i); };
  // due tocchi (il secondo dopo un secondo: un doppio tocco per sbaglio è un tocco solo)
  // (l'avviso di prima, in basso, sta sopra le righe per qualche secondo: si aspetta che se ne vada)
  const senzaAvviso = () => finche(async () => (await tel.locator(".avviso").count()) === 0, 10000);
  async function accettaDalTelefono(p) {
    await senzaAvviso();
    await bottone(p).click();
    await sospendi(1000);
    await bottone(p).click();
  }
  await tel.goto(qr);
  check(!!(await aspettaTel(/BRUNI ELSA/)) && !!(await aspettaTel(/Triage ·/i)), "inquadrato il QR: il telefono ha l'elenco del PC e la sezione Triage");
  check(await bottone(NERI).count() === 1 && await bottone(VIOLA).count() === 1 && (await bottone(NERI).innerText()) === "Accetta",
    "ogni riga del Triage (con la chiave del PC) ha il suo «Accetta»");
  await foto("1-triage");

  // ---- 1. il primo tocco arma, col nome; niente parte
  const pagine0 = srv.pagine.length;
  await bottone(NERI).click();
  check((await bottone(NERI).innerText()) === "Accetto NERI P. in ambulatorio? Tocca di nuovo", `il primo tocco: «${await bottone(NERI).innerText()}»`);
  await sospendi(1500);
  check(accetti().length === 0 && !srv.pagine.slice(pagine0).some((x) => /PsoPazientiTriage/.test(x)), "…e niente è partito: nessuna lista del triage aperta, nessuna freccia");
  await foto("2-armato");
  // lasciato lì, si disarma da solo
  check(await finche(async () => (await bottone(NERI).innerText()) === "Accetta", 8000), "dopo 6 secondi senza il secondo tocco torna «Accetta»");

  // ---- 2. due tocchi: la scheda di sottofondo, la freccia di QUELLA riga, una volta; «In ambulatorio»
  const n0 = schedeGest().length;
  await accettaDalTelefono(NERI);
  check(await finche(async () => accetti(NERI.ep).length === 1, 30000), "il PC ha cliccato la freccia della riga di NERI");
  const a1 = accetti(NERI.ep)[0];
  check(a1 && a1.ris === RIS.bassa && a1.ritorno === "PsoPazientiTriage" && a1.tipo === "document", `…la freccia della pagina, con la sua risorsa e il suo ritorno: una navigazione, non una richiesta fatta da noi (${JSON.stringify(a1)})`);
  check(!!(await aspettaTel(/In ambulatorio: NERI PAOLA/, 40000)), `sul telefono «In ambulatorio: NERI PAOLA» (${await avviso()})`);
  const tri = srv.pagine.indexOf("PsoPazientiTriage"), dopo = srv.pagine.slice(tri);
  check(tri >= pagine0 && /^PsoPazientiTriage,PsoEpisodioTriageToAmbulatorio:710001,PsoEpisodio:710001,PsoEpisodioClinicoAmbulatorio:710001/.test(dopo.join()),
    `il giro: la lista del triage, la freccia, PsoEpisodio, la pagina in ambulatorio (${dopo.slice(0, 5).join(" → ")})`);
  check(await finche(async () => schedeGest().length === n0, 8000), "la scheda di sottofondo si è chiusa");
  // il paziente si apre, sulla Cartella, come gli altri
  check(await finche(async () => (await tel.locator('[data-a="scheda"][data-s="cartella"].on').count()) === 1 && /NERI PAOLA/.test(await tel.locator("header").innerText()), 20000),
    "poi il telefono apre NERI PAOLA, sulla Cartella");
  check(await finche(async () => (await tel.locator("#cc-ANAMNESI").inputValue().catch(() => "")) === "Riferisce dolore inventato", 30000) && await tel.locator("#cc-ESAME_OBIETTIVO").count() === 1,
    "…la Cartella del PC, con l'esame obiettivo da scrivere");
  await foto("3-cartella");
  const paz = (await ls("patients.v1")).find((p) => p.ep === NERI.ep);
  check(paz && /MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=710001$/.test(paz.url) && paz.name === "NERI PAOLA", `il PC lo conosce, con la sua pagina in ambulatorio (${paz && paz.url})`);
  check(!(await ls("triage.lista.v1")).righe.some((r) => trKey(r.nome, r.arrivo) === chiave(NERI)), "…e dal Triage del telefono se n'è andato");
  await tornaAllElenco();
  check(await bottone(NERI).count() === 0 && /NERI PAOLA/.test(await testoTel()), "sull'elenco del telefono: NERI non è più al Triage, è fra i pazienti");
  check((await registro()).some((t) => /«Accetta in ambulatorio» di NERI PAOLA dal telefono: in ambulatorio \(Bassa\)/.test(t)), "nel registro del ponte: in ambulatorio, e l'area");

  // ---- 3. lo stesso numero rimandato (due volte insieme, e dopo): la stessa risposta, una freccia sola
  const g0 = accetti().length;
  const due = await sw.evaluate((k) => Promise.all([ponteAccetta({ k, rq: "rq-accetta-doppio-1" }), ponteAccetta({ k, rq: "rq-accetta-doppio-1" })]), chiave(GIALLI));
  check(due[0].ok && due[1].ok && accetti(GIALLI.ep).length === 1 && accetti().length === g0 + 1, `lo stesso numero due volte insieme: tutt'e due «in ambulatorio», una freccia sola (${accetti(GIALLI.ep).length})`);
  const ancora = await sw.evaluate((k) => ponteAccetta({ k, rq: "rq-accetta-doppio-1" }), chiave(GIALLI));
  check(ancora.ok && accetti(GIALLI.ep).length === 1, "…e rimandato più tardi: com'è andata, senza rifarla");
  // un numero nuovo per chi è già in ambulatorio: niente
  const pagine3 = srv.pagine.length;
  const gia = await sw.evaluate((k) => ponteAccetta({ k, rq: "rq-accetta-nuovo-01" }), chiave(NERI));
  check(!gia.ok && /Non è più al Triage sul PC/.test(gia.errore) && accetti(NERI.ep).length === 1 && !srv.pagine.slice(pagine3).some((x) => /PsoPazientiTriage/.test(x)),
    `chi è già in ambulatorio non si riaccetta: «${gia.errore}», nessuna lista aperta`);

  // ---- 4. la freccia della riga porta un altro episodio: Errore grave, niente cliccato
  await tel.reload();
  await aspettaTel(/Triage ·/i);
  srv.frecciaEp[ROSA.ep] = "710099";
  const r4 = accetti().length;
  await accettaDalTelefono(ROSA);
  check(await finche(async () => /Errore grave: la riga del triage sul PC è di un altro paziente — niente fatto/.test(await esitoRiga(ROSA)), 30000) && accetti().length === r4,
    `la freccia di un altro episodio: «${await esitoRiga(ROSA)}» — niente cliccato`);
  delete srv.frecciaEp[ROSA.ep];
  await foto("4-errore-grave");

  // ---- 5. al triage per l'Alta, il gestionale sulla Bassa: niente cliccato, e lo dice
  const r5 = accetti().length;
  await accettaDalTelefono(VIOLA);
  check(await finche(async () => /Non accettato: è al triage per Alta intensità, il gestionale sul PC è su Bassa/.test(await esitoRiga(VIOLA)), 30000) && accetti().length === r5,
    `l'area sbagliata: «${await esitoRiga(VIOLA)}» — niente cliccato`);
  check(await bottone(VIOLA).count() === 1, "…e il bottone resta (passato il gestionale all'area, si riprova)");

  // ---- 6. dopo il clic la pagina si ferma a metà: «Incerto», un clic solo, e non si ripreme
  srv.dopo = "ferma";
  const r6 = accetti().length;
  await accettaDalTelefono(ROSA);

  check(await finche(async () => /Incerto: controlla sul PC/.test(await esitoRiga(ROSA)), 45000), `la pagina di passaggio ferma: «${await esitoRiga(ROSA)}»`);
  check(accetti(ROSA.ep).length === 1 && accetti().length === r6 + 1 && await bottone(ROSA).count() === 0, "…una freccia sola, e sul telefono niente bottone: non si ripreme");
  const rqInc = await sw.evaluate(() => chrome.storage.session.get("ponte.accetta.rq").then((o) => Object.entries(o["ponte.accetta.rq"] || {}).filter(([, x]) => x.esito && x.esito.incerto).map(([k]) => k)));
  const ri = await sw.evaluate(({ k, rq }) => ponteAccetta({ k, rq }), { k: chiave(ROSA), rq: rqInc[0] });
  check(rqInc.length === 1 && ri.incerto && accetti(ROSA.ep).length === 1, "lo stesso numero rimandato: ancora «incerto», nessun clic");
  srv.dopo = "episodio";

  // ---- 7. dopo il clic il gestionale torna sulla lista del triage: lui non c'è più → la lista dell'ambulatorio lo dice
  srv.dopo = "lista";
  const p7 = srv.pagine.length;
  await accettaDalTelefono(BIANCO);
  check(await finche(async () => accetti(BIANCO.ep).length === 1, 30000) && !!(await aspettaTel(/In ambulatorio: BIANCO PIO/, 40000)),
    "tornati sulla lista del triage senza di lui: «In ambulatorio: BIANCO PIO»");
  check(/PsoPazientiTriage,PsoEpisodioTriageToAmbulatorio:710005,PsoPazientiTriage,PsoPazientiAmbulatorio/.test(srv.pagine.slice(p7).join()),
    `…verificato sulla lista dell'ambulatorio, aperta dal suo link (${srv.pagine.slice(p7).join(" → ")})`);
  // poi il telefono apre BIANCO: il PC, che in questo turno non l'ha mai aperto (lo sa dalla lista), apre la
  // sua pagina in una scheda dietro («apri»), lo ricorda e la chiude. Si aspetta che abbia finito: quella
  // scheda riscrive l'elenco dei pazienti del PC (patients.v1) da un altro processo, e una pagina aperta
  // sul PC nello stesso istante (la 8) ci finirebbe sotto — la sua visita persa, «Al triage» mai detto.
  const b7 = async () => (await ls("patients.v1")).find((p) => p.ep === BIANCO.ep) || {};
  check(await finche(async () => (await b7()).ts > 0 && /MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=710005$/.test((await b7()).url), 30000)
    && await finche(async () => schedeGest().length === 1, 15000), `poi il telefono apre BIANCO PIO: il PC apre la sua pagina dietro, lo ricorda e la chiude (${(await b7()).url})`);
  srv.dopo = "episodio";
  await tornaAllElenco();

  // ---- 8. un paziente noto al PC ancora al triage (la sua pagina aperta sul PC): «Accetta» sulla sua pagina del telefono
  srv.stato[GIALLI.ep] = "triage";   // (di nuovo al triage: un altro episodio, per la prova)
  srv.accetti = srv.accetti.filter((x) => x.ep !== GIALLI.ep);
  await doc.goto(URL_PAZ(GIALLI, "PsoEpisodioClinicoTriage"));
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await doc.goto(URL_PAZ(MEDICO));
  await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await tel.reload();
  await aspettaTel(/GIALLI UGO/);
  await tel.locator(`.paz[data-ep="${GIALLI.ep}"]`).first().click();
  const bp = tel.locator(`.accpaz [data-a="accetta"][data-id="${GIALLI.ep}"]`);
  check(await finche(async () => (await bp.count()) === 1, 10000) && /Al triage/.test(await tel.locator(".accpaz").innerText()), "sulla sua pagina del telefono: «Al triage · Accetta in ambulatorio»");
  // la riga del triage ha il suo episodio con un altro nome: Errore grave
  srv.nomeRiga[GIALLI.ep] = "GIALLINI UGO";
  await senzaAvviso(); await bp.click(); await sospendi(1000); await bp.click();
  check(await finche(async () => /Errore grave/.test(await tel.locator(".accpaz").innerText()), 30000) && accetti(GIALLI.ep).length === 0,
    `il nome nella riga non è il suo: «${(await tel.locator(".accpaz .accesito").innerText().catch(() => "")).trim()}» — niente cliccato`);
  delete srv.nomeRiga[GIALLI.ep];
  await senzaAvviso(); await bp.click(); await sospendi(1000); await bp.click();
  check(await finche(async () => accetti(GIALLI.ep).length === 1, 30000) && !!(await aspettaTel(/In ambulatorio: GIALLI UGO/, 40000)), "col nome giusto: la sua freccia, una volta — «In ambulatorio»");
  check(await finche(async () => (await tel.locator(".accpaz").count()) === 0, 15000), "…e sulla sua pagina «Al triage» se ne va");
  await foto("5-dalla-pagina");

  // ---- 9. nel registro degli errori, senza nomi; nessuna freccia in più
  const er = await errori();
  check(er.length >= 3 && er.filter((e) => e.dati && e.dati.grave).length >= 2 && !/NERI|GIALLI|ROSA|VIOLA|BIANCO|7100/.test(JSON.stringify(er)),
    `nel registro degli errori («accetta telefono»), senza nomi né episodi (${er.map((e) => e.dati?.perche).join(", ")})`);
  check(srv.accetti.length === 4 && srv.accetti.every((x) => x.tipo === "document"), `in tutto 4 frecce, una per paziente accettato o incerto (${srv.accetti.map((x) => x.ep).join(",")})`);
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
