#!/usr/bin/env node
/*
 * dist/dimissioni.html — l'editor a pagina sola: si modifica, si aggiunge,
 * si salva, e il salvataggio deve avere ESATTAMENTE la forma che il pannello
 * importa con ⤒ Importa. Gira in un browser vero.
 *   node test/editor.mjs
 */
import { chromium } from "playwright";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "dist/dimissioni.html"), "utf8");
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const ctx = await browser.newContext();
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await ctx.newPage();
const errori = [];
page.on("pageerror", (e) => errori.push(e.message));
await page.route("https://editor.test/**", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
await page.goto("https://editor.test/");
await page.waitForSelector("article.foglio");

console.log("\neditor dei fogli di dimissione");
const quanti = await page.locator("article.foglio").count();
check(quanti === 8, `gli otto fogli in servizio sono già dentro (got ${quanti})`);

// si scrive dentro, e basta: né tasti modifica né schermate
await page.locator("input.tit").first().fill("Gastroenterite (mia versione)");
await page.locator("article.foglio textarea.corpo").first().click();
await page.keyboard.type("\nRIGA MIA\n");
await page.getByRole("button", { name: "+ Nuovo foglio" }).click();
await page.locator("input.tit").first().fill("Ferita suturata");
await page.waitForTimeout(300);
check(await page.locator("article.foglio").count() === 9, "un foglio nuovo si aggiunge in cima");

await page.getByRole("button", { name: "⬇ Salva (JSON)" }).click();
await page.waitForTimeout(500);
let dati = null;
try { dati = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())); } catch { /* sotto */ }
check(!!dati && dati.dimissioni && typeof dati.dimissioni === "object",
  "Salva produce la forma che il pannello importa ({dimissioni: {...}})");
const d = (dati && dati.dimissioni) || {};
check(Object.keys(d).length === 9, `con tutti i fogli (got ${Object.keys(d).length})`);
check(d.gastroenterite?.nome === "Gastroenterite (mia versione)" && /RIGA MIA/.test(d.gastroenterite?.testo || ""),
  "titolo e testo modificati sono quelli salvati");
check(!!d["ferita-suturata"], `la chiave del foglio nuovo viene dal titolo (got ${Object.keys(d).find((k) => /ferita/.test(k))})`);
check(!Object.keys(d).some((k) => /foglio-nuovo/.test(k)), "e non resta la chiave provvisoria");

// il download non si può verificare (e in certe pagine è vietato): il JSON
// deve comparire anche sulla pagina, così non resta mai solo una promessa
const box = await page.evaluate(() => {
  const u = document.getElementById("uscita");
  return { visibile: !!u && !u.hidden, testo: (document.getElementById("json") || {}).value || "" };
});
check(box.visibile && /"dimissioni"/.test(box.testo),
  "il JSON compare anche nella pagina, da copiare a mano se serve");

// il lavoro a metà non si perde ricaricando
await page.reload();
await page.waitForSelector("article.foglio");
check(await page.locator("input.tit").first().inputValue() === "Ferita suturata",
  "ricaricando la pagina il lavoro è ancora lì");

// ↺ Originali chiede conferma e poi rimette i testi in servizio
const orig = page.locator("#orig");   // il testo cambia in «Confermi?»: si tiene per id
await orig.click();
await page.waitForTimeout(150);
check(/Confermi/.test(await orig.innerText()), "↺ Originali chiede conferma prima di buttare il lavoro");
await orig.click();
await page.waitForTimeout(300);
check(await page.locator("article.foglio").count() === 8, "e poi rimette gli otto fogli in servizio");

check(errori.length === 0, `nessun errore JavaScript (${errori.slice(0, 2).join(" | ") || "nessuno"})`);
await browser.close();
console.log(fail ? `\nEDITOR: ${fail} CHECK FALLITI\n` : "\nEDITOR: TUTTO OK\n");
process.exit(fail ? 1 : 0);
