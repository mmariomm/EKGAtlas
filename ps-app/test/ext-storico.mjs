#!/usr/bin/env node
/*
 * The multi-day table crossing from ONE origin to the other, with the real
 * unpacked extension: read on the portal page (zero requests to anyone),
 * carried by the service worker, shown on the patient's page — and only if
 * the name matches.
 *   node test/ext-storico.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { paginaStorico } from "./fixtures/storico.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-stor-" + process.pid);
const PORTALE = "http://10.11.0.151:9080/clin-port/info-cliniche/dati-clinici";

function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

// il paziente è ROSSI MARIO, e ha prelievi: è da quelli che il pannello
// impara l'impronta del codice fiscale di questo episodio
const mock = createMock({ withResults: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  let out = mock.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
  await r.fulfill({ status: out.status, headers: out.headers, body: out.body });
});
// the portal page, served locally: the panel must never ask it for anything
let chiamatePortale = 0;
let paginaCorrente = paginaStorico({ paziente: { idMPI: "900000001", cognome: "ROSSI", nome: "MARIO" } });
await ctx.route("http://10.11.0.151:9080/**", async (r) => {
  chiamatePortale++;
  await r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: paginaCorrente });
});

console.log("\nstorico: dal portale al paziente");
const portale = await ctx.newPage();
await portale.goto(PORTALE);
await portale.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await portale.waitForFunction(
  () => /prelievi/.test(document.getElementById("psassist-host")?.shadowRoot?.textContent || ""),
  { timeout: 10000 },
).catch(() => {});
const barra = await portale.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".bar").textContent.replace(/\s+/g, " ").trim());
check(/10 esami · 3 prelievi/.test(barra), `la striscia dice cosa ha letto (got: ${barra.slice(0, 80)})`);
check(chiamatePortale === 1, `una sola richiesta al portale: quella che ha fatto il medico aprendo la pagina (got ${chiamatePortale})`);

const paziente = await ctx.newPage();
await paziente.goto(mock.patientUrl);
await paziente.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await paziente.locator('#psassist-host [data-seg="esiti"]').click();
await paziente.waitForSelector("#psassist-host #apristorico", { timeout: 10000 });
check(true, "sulla pagina del paziente compare lo Storico");
await paziente.locator("#psassist-host #apristorico").click();
await paziente.waitForSelector("#psassist-host .sttab", { timeout: 8000 });
const tab = await paziente.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  return {
    righe: r.querySelectorAll(".sttab tbody tr").length,
    colonne: r.querySelectorAll(".sttab thead th").length - 1,
    rosse: r.querySelectorAll(".sttab td.fuori").length,
    prima: [...r.querySelectorAll(".sttab tbody tr")[0].cells].map((c) => c.textContent.trim()).join("|"),
  };
});
check(tab.righe === 10 && tab.colonne === 3, `dieci analiti per tre prelievi (got ${tab.righe}×${tab.colonne})`);
check(tab.rosse === 6, `i fuori range che la pagina aveva già marcato (got ${tab.rosse})`);
check(tab.prima === "Hb|10.4↓|11.8↓|13.2", `il prelievo più recente per primo (got ${tab.prima})`);
check(chiamatePortale === 1, "e nessuna richiesta in più al portale per mostrarla");

// filtro
await paziente.locator("#psassist-host #storfiltro").click();
await paziente.waitForTimeout(200);
const soloAlterati = await paziente.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".sttab tbody tr").length);
check(soloAlterati === 5, `«solo alterati» tiene solo le righe con un valore fuori range (got ${soloAlterati})`);

// ---- la tabella disegnata DOPO il caricamento ---------------------------
// Il portale è una single-page application: ci si arriva cambiando rotta
// dentro l'app, e la tabella compare quando l'app la disegna. Guardare una
// volta sola al caricamento vorrebbe dire non leggere mai niente.
const tabella = paginaStorico({ paziente: { idMPI: "900000001", cognome: "ROSSI", nome: "MARIO" } });
const testa = tabella.slice(0, tabella.indexOf("<body>") + 6);
const corpo = tabella.slice(tabella.indexOf("<body>") + 6);
paginaCorrente = `${testa}<div id="app"></div><script>
  setTimeout(() => { document.getElementById("app").innerHTML = ${JSON.stringify(corpo)}; }, 700);
</script></body></html>`;
await portale.goto(PORTALE + "?tardi=1");
await portale.waitForTimeout(2500);
const tardi = await portale.evaluate(() =>
  document.getElementById("psassist-host")?.shadowRoot?.querySelector(".bar")?.textContent?.replace(/\s+/g, " ").trim() || "");
check(/10 esami · 3 prelievi/.test(tardi),
  `legge la tabella anche se l'app la disegna dopo (got: ${tardi.slice(0, 60) || "NESSUNA STRISCIA"})`);

// ---- un'ALTRA pagina del portale non è una pagina di SA4PSO -------------
// La pagina di login del portale ha un campo password: scambiarla per quella
// di SA4PSO farebbe cancellare i referti salvati del turno e questo storico.
paginaCorrente = `<!doctype html><html><head><title>Portale clinico</title></head><body>
  <form><input type="text" name="user"><input type="password" name="pwd"><button>Entra</button></form>
</body></html>`;
await portale.goto(PORTALE + "?login=1");
await portale.waitForTimeout(1200);
check((await portale.locator("#psassist-host").count()) === 0,
  "su una pagina del portale senza tabella il pannello non compare proprio");
await paziente.reload();
await paziente.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await paziente.locator('#psassist-host [data-seg="esiti"]').click();
await paziente.waitForTimeout(1000);
check((await paziente.locator("#psassist-host #apristorico").count()) === 1,
  "e lo storico letto prima è ancora lì: quella pagina non ha cancellato niente");

// ---- una scheda per paziente, e mai i valori di un altro ----------------
// Un omonimo con un codice fiscale diverso è un'altra persona: la sua tabella
// diventa una scheda a parte e i suoi valori non devono comparire qui.
const ALTRI = [["EMOCROMO", "Emoglobina", "1201", "HB", ["1.1", "1.2", "1.3"], [0, 0, 0]]];
paginaCorrente = paginaStorico({ paziente: { idMPI: "900000003", cognome: "ROSSI", nome: "MARIO", cf: "SMPRSS80A01F205Z" }, esami: ALTRI });
await portale.goto(PORTALE);
await portale.waitForFunction(
  () => /prelievi/.test(document.getElementById("psassist-host")?.shadowRoot?.textContent || ""),
  { timeout: 10000 },
).catch(() => {});
await paziente.reload();
await paziente.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await paziente.locator('#psassist-host [data-seg="esiti"]').click();
await paziente.waitForSelector("#psassist-host #apristorico", { timeout: 10000 });
await paziente.locator("#psassist-host #apristorico").click();
await paziente.waitForSelector("#psassist-host .sttab", { timeout: 8000 });
const suoi = await paziente.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  return { testo: r.querySelector(".sttab").textContent.replace(/\s+/g, " "),
           hint: r.querySelector(".sec .hint")?.textContent?.replace(/\s+/g, " ") || "" };
});
check(!/1\.1|1\.2|1\.3/.test(suoi.testo),
  `i valori dell'omonimo col codice fiscale diverso non compaiono (got: ${suoi.testo.slice(0, 60)})`);
check(/10\.4/.test(suoi.testo), "e ci sono ancora i suoi");
check(/codice fiscale/.test(suoi.hint), "la scheda mostrata è scelta sul codice fiscale");

// e la striscia sul portale dice quante schede ci sono in memoria
const contate = await portale.evaluate(() =>
  document.getElementById("psassist-host")?.shadowRoot?.querySelector(".bar")?.textContent?.replace(/\s+/g, " ") || "");
check(/2 pazienti in memoria/.test(contate), `una scheda per paziente, non una sola (got: ${contate.slice(0, 90)})`);

// ---- un paziente di cui non abbiamo niente: lo dice, senza mostrare nulla
// (la pagina cambia paziente: il pannello legge il nome dal titolo)
await paziente.evaluate(() => { document.title = "VERDI GIULIA"; });
await paziente.locator('#psassist-host [data-seg="richieste"]').click();
await paziente.waitForTimeout(200);
await paziente.locator('#psassist-host [data-seg="esiti"]').click();
await paziente.waitForTimeout(1200);
const senza = await paziente.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  return { bottone: r.querySelectorAll("#apristorico").length, tabelle: r.querySelectorAll(".sttab").length,
           avviso: (/In memoria[^.]{0,80}/.exec(r.textContent.replace(/\s+/g, " ")) || [""])[0] };
});
check(senza.bottone === 0 && senza.tabelle === 0, "di un paziente senza scheda non si apre niente");
check(/non di questo paziente/.test(senza.avviso) && /ROSSI MARIO/.test(senza.avviso),
  `e il pannello dice cosa ha in memoria (got: ${senza.avviso})`);

// ---- i moduli di consenso vengono dall'estensione, non dalla rete -------
const primaRete = mock.state.requests.length;
await paziente.locator('#psassist-host [data-seg="consensi"]').click();
await paziente.waitForSelector("#psassist-host [data-cons]", { timeout: 8000 });
check((await paziente.locator("#psassist-host [data-cons]").count()) === 5, "cinque moduli in elenco");
await paziente.locator('#psassist-host [data-cons="antitetano"]').click();
await paziente.waitForSelector("#psassist-print iframe", { timeout: 15000 });
const pdf = await paziente.evaluate(() => {
  const r = document.getElementById("psassist-print").shadowRoot;
  return { src: r.querySelector("iframe")?.getAttribute("src") || "",
           testa: r.querySelector(".pwhd")?.textContent?.replace(/\s+/g, " ").trim() || "" };
});
check(pdf.src.startsWith("blob:"), `il PDF si apre da locale (got ${pdf.src.slice(0, 24)}…)`);
check(/Antitetano/.test(pdf.testa), `con il titolo corto giusto (got: ${pdf.testa.slice(0, 60)})`);
check(mock.state.requests.length === primaRete, "e senza una singola richiesta al gestionale");

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fail ? `\nSTORICO-ESTENSIONE: ${fail} CHECK FALLITI\n` : "\nSTORICO-ESTENSIONE: TUTTO OK\n");
process.exit(fail ? 1 : 0);
