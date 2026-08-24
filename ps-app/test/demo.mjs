#!/usr/bin/env node
/*
 * The banco di prova (dist/demo.html) must behave like the real thing:
 * the SAME built panel, driven through the SAME flows the e2e suite runs
 * against SA4PSO — worklist, patient, ordering, esiti, valori, referti.
 * If this fails, the demo is lying about the product.
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
const $p = (page, sel) => page.locator(`#psassist-host ${sel}`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => requests.push(r.url()));
await page.route("https://banco.test/**", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
const open = async (q = "") => {
  await page.goto("https://banco.test/" + q);
  await page.waitForSelector("#psassist-host", { state: "attached", timeout: 20000 });
};

console.log("\nbanco di prova");
await open();
check(await page.locator("#sa4-page .wl tr").count() === 4, "la lista PS elenca 3 pazienti");
check((await $p(page, "b.who").innerText()).toLowerCase().includes("pazienti"), "senza paziente aperto il pannello parte dai Pazienti");
check(/nessun paziente/i.test(await $p(page, ".card").innerText()), "e non conosce ancora nessuno");

await page.locator('#sa4-page a:has-text("ROSSI MARIO")').click();
await page.waitForSelector("#psassist-host #q", { timeout: 20000 });
check(page.url().includes("EPISODIO_ID=999001"), `l'indirizzo porta l'episodio come al lavoro (${page.url().split("?")[1]?.slice(0, 46)})`);
check((await $p(page, "b.who").innerText()).includes("ROSSI MARIO"), "il pannello titola col paziente");
check((await $p(page, ".sub").innerText()).includes("999001"), "e con l'episodio");
check(await page.locator(".sa4-pat .nm").innerText() === "ROSSI MARIO", "la pagina simulata mostra la testata del paziente");

// ---- esiti + valori
await $p(page, '[data-seg="esiti"]').click();
await page.waitForSelector("#psassist-host [data-esito]");
const esiti = await $p(page, "[data-esito]").count();
check(esiti === 5, `Esiti: 3 referti + 2 prelievi (got ${esiti})`);
await page.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelector(".eprev"), { timeout: 20000 }).catch(() => {});
const prev = await $p(page, ".eprev").first().innerText().catch(() => "");
check(/Emoglobina 80/.test(prev), `l'anteprima precaricata mette l'anomalo per primo (got: ${prev.replace(/\s+/g, " ").slice(0, 46)})`);
await $p(page, '[data-esito][data-kind="valori"]').first().click();
await page.waitForSelector("#psassist-host .rval", { timeout: 20000 });
check(await $p(page, ".rval").count() === 3, "la schermata valori elenca tutti gli esami");
check(await $p(page, ".rval.bad").count() === 1, "e segna il fuori range");

// ---- referti: saved by the simulated extension, then opened in a fake tab
await $p(page, "#back").click();
await page.waitForSelector("#psassist-host [data-esito]");
check(await $p(page, "#refsave").count() === 1, "col ponte estensione compare «Salva referti»");
await $p(page, "#refsave").click();
await page.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".rdot.saved").length === 3, { timeout: 30000 }).catch(() => {});
check(await $p(page, ".rdot.saved").count() === 3, "i 3 referti risultano salvati");
await $p(page, '[data-esito][data-kind="referto"]').first().click();
await page.waitForSelector(".psa-tab iframe", { timeout: 15000 });
check(await page.locator(".psa-tab iframe").count() === 1, "il referto si apre nella finta scheda");
await page.locator(".psa-tab header button").click();

// ---- the whole order, exactly as at work
await $p(page, '[data-seg="richieste"]').click();
await $p(page, "#q").fill("dolore toracico, sospetta SCA");
await $p(page, '.chip.preset:has-text("Base PS")').click();
await $p(page, "#go").click();
await page.waitForSelector("#psassist-host #confirmnow", { timeout: 60000 });
const receipt = await $p(page, ".banner.ok").innerText();
check(/esami in carrello, verificati/.test(receipt), `ricevuta come al lavoro (got: ${receipt.replace(/\s+/g, " ").slice(0, 40)})`);
check(await $p(page, ".chip.cart").count() > 0, "gli esami inseriti sono elencati");

// ---- two patients: the panel goes to the other patient's PAGE, never renders him here
await page.locator(".psa-bar #psa-home").click();
await page.waitForSelector("#sa4-page .wl");
await page.locator('#sa4-page a:has-text("COLOMBO LUIGI")').click();
await page.waitForSelector("#psassist-host #q", { timeout: 20000 });
await $p(page, "#back").click();
await page.waitForSelector("#psassist-host .pcard");
check(await $p(page, ".pcard").count() === 2, "i due pazienti aperti sono nell'elenco");
check((await $p(page, ".pcard").first().innerText()).includes("COLOMBO"), "quello davanti a me è il primo");
await $p(page, '.pcard:has-text("ROSSI") [data-go="esiti"]').click();
await page.waitForFunction(() => location.href.includes("999001"), { timeout: 20000 });
check(page.url().includes("EPISODIO_ID=999001"), "scegliere l'altro paziente ne carica la pagina");
await page.waitForSelector("#psassist-host [data-esito]", { timeout: 20000 });
check((await $p(page, "b.who").innerText()).includes("ROSSI MARIO"), "e ci si arriva già sugli Esiti giusti");

// ---- reset
await page.locator(".psa-bar #psa-wipe").click();
await page.waitForSelector("#sa4-page .wl");
await page.waitForSelector("#psassist-host .card");
check(/nessun paziente/i.test(await $p(page, ".card").innerText()), "«Azzera» riporta il banco allo stato iniziale");

// the whole point of a banco: it can touch nothing but itself
const escaped = requests.filter((u) => !u.startsWith("https://banco.test/") && !/^(blob:|data:)/i.test(u));
check(escaped.length === 0, `nessuna richiesta esce dalla pagina (${escaped.slice(0, 2).join(" ").slice(0, 80) || "0 su " + requests.length})`);
const refused = await page.evaluate(async () => {
  try { await fetch("https://smarthealth.multimedica.it/sa4pso/restrict/menuPsoEpisodio.do"); return "PASSATA"; }
  catch (e) { return e.message; }
});
check(/bloccata/.test(refused), `una chiamata verso l'ospedale viene rifiutata in pagina (${refused.slice(0, 60)})`);
check(errors.length === 0, `nessun errore JavaScript (${errors.slice(0, 2).join(" | ").slice(0, 90)})`);
await browser.close();
console.log(failures ? `\nDEMO: ${failures} CHECK FALLITI\n` : "\nDEMO CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
