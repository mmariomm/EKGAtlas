#!/usr/bin/env node
/*
 * The banco di prova runs the shipped panel over the SAVED gestionale pages.
 * These checks walk the same flows the product tests walk — list, patient,
 * order, cart, confirm, esiti, valori, referti — and, above all, prove that
 * nothing the user can click sends a request anywhere.
 *   node tools/demo.mjs && node test/demo.mjs
 */
import { chromium } from "playwright";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "dist/demo.html"), "utf8");
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let failures = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) failures++; };

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [], leaks = [];
// ONLY the page itself may be fetched: everything else is a leak, and is
// aborted rather than sent, so a hole shows up as a failure and not as traffic.
await ctx.route("**", (route) => {
  const req = route.request();
  const url = req.url();
  if (req.resourceType() === "document" && /^https:\/\/banco\.test\/(?:\?|$)/.test(url)) {
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
  }
  if (!/\/favicon\.ico$/.test(url)) leaks.push(req.resourceType() + " " + url);   // browser noise, not the page
  return route.abort();
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 120)); });
const $ = (sel) => page.locator("#psassist-host " + sel);
const apri = async (q = "") => {
  await page.goto("https://banco.test/" + q);
  await page.waitForSelector("#psassist-host", { state: "attached", timeout: 20000 });
};
// «⭳ Carica i valori» legge OGNI prelievo, uno alla volta: si aspetta la
// tabella e il bottone di nuovo pronto (mentre gira porta scritto «↻ 3/6…»).
const attendiTabella = (timeout = 30000) => page.waitForFunction(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  const b = r.querySelector("#risall");
  return !!r.querySelector(".sttab") && (!b || !b.disabled);
}, { timeout });

console.log("\nbanco di prova — pagine vere del gestionale");
await apri();
check(await page.locator('#sa4-page a:has-text("ROSSI MARIO")').count() === 1, "la lista PS elenca i pazienti degli esempi");
check((await $("b.who").innerText()).toLowerCase().includes("pazienti"), "senza paziente aperto il pannello parte dai Pazienti");

await page.locator('#sa4-page a:has-text("ROSSI MARIO")').click();
await page.waitForSelector("#psassist-host #q", { state: "attached", timeout: 20000 });
check(await page.title() === "ROSSI MARIO", `la scheda è quella del paziente aperto (${await page.title()})`);
check(page.url().includes("EPISODIO_ID=700001"), "l'indirizzo porta l'episodio come al lavoro");
check(await page.locator('#sa4-page form[name="AmbulatorioPSO"]').count() === 1, "è la pagina vera del gestionale, non una ricostruzione");
check(await page.locator('#sa4-page a[title="Richieste Laboratorio"]').count() >= 1, "coi suoi collegamenti originali");

// ---- l'ordine completo sulle pagine vere
await $("#q").fill("dolore toracico, sospetta SCA");
await $('.chip.preset:has-text("Base PS")').click();
await $("#go").click();
await page.waitForSelector("#psassist-host #confirmnow", { state: "attached", timeout: 90000 });
check(/esami in carrello, verificati/.test(await $(".banner.ok").innerText()), "la richiesta si crea e gli esami si aggiungono");
check(await $(".chip.cart").count() >= 3, "il pannello elenca il carrello");
check(await page.locator('#sa4-page a[href*="Delete=Elimina"]').count() >= 1, "e la pagina vera mostra gli esami nel carrello");
check(await page.locator('#sa4-page form[name="Prestazioni"]').count() === 1, "siamo sulla pagina esami originale");

// ---- conferma nativa → torna al paziente e parte la stampa
await $("#confirmnow").click();
await page.waitForFunction(() => document.title === "ROSSI MARIO", { timeout: 30000 }).catch(() => {});
check(await page.title() === "ROSSI MARIO", "dopo la Conferma si torna alla scheda del paziente");
// the wizard is its own host, like at work: a separate overlay over everything
await page.waitForSelector("#psassist-print", { state: "attached", timeout: 30000 }).catch(() => {});
check(await page.locator("#psassist-print .pwbody").count() >= 1, "e parte il wizard di stampa");
const passo = await page.locator("#psassist-print .pwhd").innerText().catch(() => "");
check(/etichett/i.test(passo), `che comincia dalle etichette (${passo.replace(/\s+/g, " ").slice(0, 50)})`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// ---- esiti, valori, referti sul secondo paziente
await apri("?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=700003");
await page.waitForSelector("#psassist-host [data-seg]", { state: "attached", timeout: 20000 });
check(await page.title() === "BIANCHI ANNA", "il secondo paziente è la seconda scheda salvata");
await $('[data-seg="esiti"]').click();
await page.waitForSelector("#psassist-host [data-esito]", { state: "attached", timeout: 20000 });
const nEsiti = await $("[data-esito]").count();
check(nEsiti >= 4, `gli Esiti arrivano dalla pagina vera (${nEsiti} righe)`);
// i valori non si leggono da soli: si chiedono, e arrivano in UNA tabella
check(await $(".sttab").count() === 0, "prima di chiederli non c'è nessuna tabella");
await $("#risall").click();
await attendiTabella(30000);
const daFinestra = await page.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  return { sezioni: [...r.querySelectorAll(".sttab tr.stsez th.stn")].map((t) => t.textContent.trim()),
           colonne: r.querySelectorAll(".sttab thead th").length - 1,
           righe: r.querySelectorAll(".sttab tbody tr:not(.stsez)").length,
           rosse: r.querySelectorAll(".sttab td.fuori").length,
           sigle: [...r.querySelectorAll(".sttab tbody tr:not(.stsez) th.stn")].map((t) => t.firstChild.textContent.trim()) };
});
check(daFinestra.righe >= 8 && daFinestra.sigle.includes("Hb") && daFinestra.sigle.includes("GB"),
  `la tabella legge i valori veri, in sigla (${daFinestra.righe} analiti: ${daFinestra.sigle.slice(0, 6).join(", ")})`);
check(daFinestra.rosse >= 1, `e segna i fuori range (${daFinestra.rosse} celle)`);
// ---- i prelievi letti sono le colonne di una tabella sola, divisa per gruppo
check(daFinestra.sezioni.length >= 2 && daFinestra.colonne >= 2,
  `divisi per gruppo, una colonna a prelievo (${daFinestra.sezioni.join(", ")} · ${daFinestra.colonne} colonne)`);

// ---- il laboratorio completa il pannello: un valore cambia, un esame compare
await page.evaluate(() => document.getElementById("psa-lab").click());
await $("#risall").click();
await attendiTabella(30000);
const novita = await page.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  const sigla = (td) => td.closest("tr").cells[0].firstChild.textContent.trim();
  return { striscia: r.querySelector(".newbar")?.textContent?.replace(/\s+/g, " ").trim() || "",
           agg: [...new Set([...r.querySelectorAll(".sttab td.agg")].map(sigla))],
           nuovi: [...new Set([...r.querySelectorAll(".sttab td.nuovo")].map(sigla))] };
});
check(/valori nuovi dall'ultima lettura/.test(novita.striscia), `dopo ↻ Aggiorna la striscia annuncia le novità (${novita.striscia.slice(0, 50)})`);
check(novita.agg.includes("Hb") && novita.nuovi.includes("Na"),
  `il valore cambiato e l'analita comparso sono marcati (agg: ${novita.agg.join(",")} · nuovi: ${novita.nuovi.join(",")})`);
await $("#letto").click();
await page.waitForTimeout(400);
check(await $(".sttab td.agg, .sttab td.nuovo").count() === 0 && await $(".newbar").count() === 0,
  "«Letto» spegne i marchi e la striscia");

// ---- un tocco su un valore lo segna: giallo, arancio, poi via — e resta col paziente
const cellaHb = () => page.locator("#psassist-host .sttab td[data-cella]").first();
const segnoDi = async () => (await cellaHb().getAttribute("class")).split(/\s+/).filter((c) => /^seg\d$/.test(c)).join("") || "nessuno";
await cellaHb().click();
const s1 = await segnoDi();
await cellaHb().click();
const s2 = await segnoDi();
await cellaHb().click();
const s3 = await segnoDi();
check(s1 === "seg1" && s2 === "seg2" && s3 === "nessuno", `un tocco giallo, due arancio, tre via (${s1} → ${s2} → ${s3})`);
await cellaHb().click();
const cellaSegnata = await cellaHb().getAttribute("data-cella");
await page.getByRole("button", { name: "Lista PS" }).click();
await page.waitForTimeout(700);
await page.locator('#sa4-page a:has-text("BIANCHI ANNA")').first().click();
await page.waitForTimeout(1200);
await $('[data-seg="esiti"]').click();
await page.waitForSelector("#psassist-host .sttab", { timeout: 8000 });
check(await page.locator(`#psassist-host .sttab td[data-cella="${cellaSegnata}"].seg1`).count() === 1,
  "e il segno è ancora lì dopo il cambio pagina");

await $("#refsave").click();
await page.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".rdot.saved").length >= 1, { timeout: 30000 }).catch(() => {});
check(await $(".rdot.saved").count() >= 1, "i referti si salvano col ponte estensione");
await $('[data-esito][data-kind="referto"]').first().click();
await page.waitForSelector(".psa-tab iframe", { timeout: 20000 });
check(await page.locator(".psa-tab iframe").count() === 1, "e si aprono nella finta scheda");
await page.locator(".psa-tab header button").click();

// ---- lo storico: letto dalla pagina del portale, senza chiedere niente.
// Aperto dalla pagina di BIANCHI, ma la tabella (fissa, nel banco) è di ROSSI:
// il clic da solo non attribuisce niente, e la striscia lo dice
const leggiStriscia = () => page.evaluate(() => document.getElementById("psassist-host")?.shadowRoot?.querySelector(".bar")?.textContent?.replace(/\s+/g, " ").trim() || "");
const vaiDa = async (nome) => {
  await page.getByRole("button", { name: "Lista PS" }).click();
  await page.waitForTimeout(900);
  await page.locator(`#sa4-page a:has-text("${nome}")`).first().click();
  await page.waitForTimeout(1400);
};
await page.locator('#sa4-page a:has-text("Storico Dati Clinici")').first().click();
await page.waitForTimeout(1400);
const daAltri = await leggiStriscia();
check(/esami · \d+ prelievi/.test(daAltri) && /non è BIANCHI ANNA/.test(daAltri), `aperta dalla pagina di un altro, lo dice (${daAltri.slice(0, 100)})`);
// aperto dalla pagina di ROSSI: quel clic è l'identità
await vaiDa("ROSSI MARIO");
await page.locator('#sa4-page a:has-text("Storico Dati Clinici")').first().click();
await page.waitForTimeout(1400);
const striscia = await leggiStriscia();
check(/esami · \d+ prelievi/.test(striscia) && !/non è/.test(striscia), `sulla pagina dello storico dice cosa ha letto (${striscia.slice(0, 60)})`);
await vaiDa("ROSSI MARIO");
await $('[data-seg="esiti"]').click();
await page.waitForSelector("#psassist-host .sttab", { timeout: 8000 });
// non c'è più una schermata a parte: la tabella del portale È la tabella
// degli Esiti di ROSSI, senza aprire niente
const griglia = await page.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  return { righe: r.querySelectorAll(".sttab tbody tr:not(.stsez)").length, rosse: r.querySelectorAll(".sttab td.fuori").length,
           sezioni: r.querySelectorAll(".sttab tr.stsez").length,
           larghezza: Math.round(r.querySelector(".card").getBoundingClientRect().width),
           tetto: Math.round(window.innerWidth * 0.8),
           dentroEsiti: !!r.querySelector(".sec .sttab"),
           chi: (/Con lo storico del portale[^.]*\./.exec(r.textContent.replace(/\s+/g, " ")) || [""])[0],
           sotto: [...r.querySelectorAll(".sttab thead th .sth")].map((t) => t.textContent.trim()) };
});
check(griglia.dentroEsiti, "tornando sul paziente lo storico è DENTRO gli Esiti, senza una schermata a parte");
check(/letto per ROSSI MARIO/.test(griglia.chi), `e la schermata dice per chi è stato letto (${griglia.chi.slice(0, 80)})`);
check(griglia.righe === 10 && griglia.rosse === 6, `la tabella con i suoi fuori range (${griglia.righe} righe, ${griglia.rosse} rosse)`);
check(griglia.sezioni >= 4, `divisa in sezioni (${griglia.sezioni})`);
// il pannello si allarga da solo per le colonne, fino all'80 % dello schermo
check(griglia.larghezza > 460 && griglia.larghezza <= griglia.tetto,
  `il pannello si è allargato per lo storico (${griglia.larghezza} px, tetto ${griglia.tetto})`);
// nessun prelievo di esempio è di oggi: in cima c'è la data, sotto l'ora
check(griglia.sotto.length === 3 && griglia.sotto.every((t) => /^\d\d:\d\d$/.test(t)),
  `colonne di altri giorni: data sopra, ora sotto (${griglia.sotto.join(" · ")})`);

// ---- una schermata mai salvata non è un errore
await page.locator('#sa4-page a:has-text("Storico Documenti")').first().click().catch(() => {});
await page.waitForTimeout(600);
check(!/errore|error/i.test(await page.locator("#sa4-page").innerText()), "una schermata mai salvata mostra una pagina di cortesia");

// ---- il punto di tutto
check(leaks.length === 0, `nessuna richiesta esce dalla pagina (${leaks.slice(0, 2).join(" ").slice(0, 90) || "0 richieste"})`);
const refused = await page.evaluate(async () => {
  try { await fetch("https://esempio.invalid/x"); return "PASSATA"; } catch (e) { return e.message; }
});
check(/bloccata/.test(refused), `una chiamata verso l'esterno viene rifiutata in pagina (${refused.slice(0, 50)})`);
check(errors.length === 0, `nessun errore JavaScript (${errors.slice(0, 2).join(" | ").slice(0, 110)})`);

await browser.close();
console.log(failures ? `\nBANCO: ${failures} CHECK FALLITI\n` : "\nBANCO DI PROVA: TUTTO OK\n");
process.exit(failures ? 1 : 0);
