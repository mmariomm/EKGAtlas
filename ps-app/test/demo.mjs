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
// i valori non si leggono da soli: si chiedono
await $("#risall").click();
await page.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelector(".eprev"), { timeout: 30000 }).catch(() => {});
const prev = await $(".eprev").first().innerText().catch(() => "");
check(/\bHb\b|\bGB\b/.test(prev), `l'anteprima legge i valori veri, in sigla (${prev.replace(/\s+/g, " ").slice(0, 44)})`);
await $('[data-esito][data-kind="valori"]').first().click();
await page.waitForSelector("#psassist-host .rval", { state: "attached", timeout: 20000 });
check(await $(".rval").count() >= 8, "la schermata valori elenca tutto l'emocromo");
check(await $(".rval.bad").count() >= 1, "e segna i fuori range");

await $("#back").click();
await page.waitForSelector("#psassist-host [data-esito]", { state: "attached" });
await $("#refsave").click();
await page.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".rdot.saved").length >= 1, { timeout: 30000 }).catch(() => {});
check(await $(".rdot.saved").count() >= 1, "i referti si salvano col ponte estensione");
await $('[data-esito][data-kind="referto"]').first().click();
await page.waitForSelector(".psa-tab iframe", { timeout: 20000 });
check(await page.locator(".psa-tab iframe").count() === 1, "e si aprono nella finta scheda");
await page.locator(".psa-tab header button").click();

// ---- lo storico: letto dalla pagina del portale, senza chiedere niente
await page.locator('#sa4-page a:has-text("Storico Dati Clinici")').first().click();
await page.waitForTimeout(1400);
const striscia = await page.evaluate(() => document.getElementById("psassist-host")?.shadowRoot?.querySelector(".bar")?.textContent?.replace(/\s+/g, " ").trim() || "");
check(/esami · \d+ prelievi/.test(striscia), `sulla pagina dello storico dice cosa ha letto (${striscia.slice(0, 60)})`);
await page.getByRole("button", { name: "Lista PS" }).click();
await page.waitForTimeout(900);
await page.locator('#sa4-page a:has-text("ROSSI MARIO")').first().click();
await page.waitForTimeout(1400);
await $('[data-seg="esiti"]').click();
await page.waitForTimeout(500);
check(await $("#apristorico").count() === 1, "e tornando sul paziente lo Storico è negli Esiti");
await $("#apristorico").click();
await page.waitForSelector("#psassist-host .sttab", { timeout: 8000 });
const griglia = await page.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  return { righe: r.querySelectorAll(".sttab tbody tr").length, rosse: r.querySelectorAll(".sttab td.fuori").length };
});
check(griglia.righe === 10 && griglia.rosse === 6, `la tabella con i suoi fuori range (${griglia.righe} righe, ${griglia.rosse} rosse)`);

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
