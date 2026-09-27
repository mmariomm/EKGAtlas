#!/usr/bin/env node
/*
 * Extension-only check: the service worker really fetches and stores referto
 * PDFs, and a saved referto opens from this machine (blob:) instead of the
 * server. Runs the UNPACKED extension in a persistent context.
 *   node test/ext-referti.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { pdfCifrato, RIGHE_ESEMPIO } from "./pdf-difficili.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-ext-" + process.pid);

// this container ships chromium under /opt/pw-browsers but not at the revision
// the playwright package expects, so point at whatever is actually there
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let failures = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) failures++; };

const mock = createMock({});
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const route = async (r) => {
  const req = r.request();
  let out = mock.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
  await r.fulfill({ status: out.status, headers: out.headers, body: out.body });
};
await ctx.route("https://smarthealth.multimedica.it/**", route);

const page = await ctx.newPage();
await page.goto(mock.patientUrl);
await page.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
// the saved documents live behind the Esiti tab
await page.locator('#psassist-host [data-seg="esiti"]').click();
await page.waitForSelector('#psassist-host [data-esito]', { timeout: 10000 });
// i referti di laboratorio stanno in un gruppo chiuso: qui li vogliamo in elenco
const gruppo = page.locator("#psassist-host #reflab");
if (await gruppo.count()) { await gruppo.click(); await page.waitForTimeout(200); }

const saveBtn = page.locator("#psassist-host #refsave");
check(await saveBtn.count() === 1, "il bottone «Salva referti» compare solo nell'estensione");
await saveBtn.click();
await page.waitForFunction(
  () => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".rdot.saved").length === 3,
  { timeout: 30000 },
).catch(() => {});
const saved = await page.locator("#psassist-host .rdot.saved").count();
check(saved === 3, `3 referti salvati dal service worker (got ${saved})`);

const before = mock.state.requests.filter((q) => q.url.includes("Sa4ViewerExtRedirect")).length;
const [popup] = await Promise.all([
  page.waitForEvent("popup", { timeout: 10000 }),
  page.locator('#psassist-host [data-esito][data-kind="referto"]').first().click(),
]);
check(popup.url().startsWith("blob:"), `il referto salvato si apre da locale (got ${popup.url().slice(0, 22)}…)`);
check(mock.state.requests.filter((q) => q.url.includes("Sa4ViewerExtRedirect")).length === before,
  "nessuna richiesta al server all'apertura di un referto salvato");

await page.locator("#psassist-host #refreset").click();
await page.waitForTimeout(1200);
check(await page.locator("#psassist-host .rdot.saved").count() === 0, "Resetta svuota i salvataggi");

// ---- un referto (RIS/ECG) che il gestionale manda al portale -----------------
// Com'è davvero (dalla diagnosi di un ECG): il link del gestionale risponde
// «Redirect in corso…» con un meta refresh verso clin-port/loginPC.jsp?token=…;
// là il portale scarica il PDF da sé e lo mostra come blob:. Il pannello non
// lo scarica: apre lo stesso link in una scheda DIETRO, lo script del portale
// passa la copia che la pagina ha già in mano, la scheda si chiude, e il testo
// (cifrato, font Type0: lo legge pdf.js) compare nel pannello.
const eRis = (u) => u.pathname.endsWith("/Sa4ViewerExtRedirect.do") && /RIS/.test(u.searchParams.get("REFERTO_SISTEMA") || "");
const pdfRis = pdfCifrato(RIGHE_ESEMPIO);
const chi = [];
let senzaPdf = false;   // più sotto: un portale che il PDF non lo mostra
await ctx.route((u) => eRis(new URL(u)), async (r) => {
  await r.fulfill({ status: 200, headers: { "content-type": "text/html" },
    body: `<html><head></head><body><font class="AFCFormHeaderFont">Redirect in corso...</font><br><table><tbody><tr>
      <td class="AFCDataTD"><meta http-equiv="refresh" content="0; URL=http://10.11.0.151:9080/clin-port/loginPC.jsp?token=abc123"></td>
      </tr></tbody></table></body></html>` });
});
await ctx.route("http://10.11.0.151:9080/**", async (r) => {
  const req = r.request();
  chi.push(`${req.serviceWorker() ? "sw" : "pagina"}:${new URL(req.url()).pathname}`);
  if (/\/clin-port\/rest\//.test(req.url())) {
    return r.fulfill({ status: 200, headers: { "content-type": "application/pdf" }, body: pdfRis });
  }
  if (senzaPdf) return r.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: "<!doctype html><html><body><div id=app>Portale clinico</div></body></html>" });
  // la «single page application» del portale: entra col token, scarica il
  // referto e lo mostra in un frame come blob: — tutto da sé
  return r.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: `<!doctype html><html><body>
    <div id="app">Portale clinico</div>
    <script>
      setTimeout(() => {
        const x = new XMLHttpRequest();
        x.open("GET", "/clin-port/rest/documenti/1/contenuto");
        x.responseType = "arraybuffer";
        x.onload = () => {
          const u = URL.createObjectURL(new Blob([x.response], { type: "application/pdf" }));
          const f = document.createElement("iframe"); f.src = u; document.body.appendChild(f);
        };
        x.send();
      }, 300);
    </script></body></html>` });
});
const p2 = await ctx.newPage();
await p2.goto(mock.patientUrl);
await p2.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await p2.locator('#psassist-host [data-seg="esiti"]').click();
await p2.waitForSelector('#psassist-host [data-esito]', { timeout: 10000 });
const schedePrima = ctx.pages().length;
await p2.locator('#psassist-host [data-esito][data-kind="referto"]:has-text("TC ENCEFALO")').first().click();
const letto = await p2.waitForFunction(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  return r.querySelectorAll(".reftxt .rt").length > 0 || !!r.querySelector(".rrow.err");
}, { timeout: 60000 }).then(() => true).catch(() => false);
const tipsRosso = await p2.locator("#psassist-host .rrow.err").first().getAttribute("title", { timeout: 1000 }).catch(() => null);
const testo = await p2.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".reftxt")?.textContent || "");
await p2.waitForTimeout(800);
const schedeDopo = ctx.pages().filter((p) => !p.isClosed()).length;
await p2.locator("#psassist-host #verbtn").click();   // il Registro, dal numero di versione in fondo
await p2.waitForSelector("#psassist-host .log", { state: "attached", timeout: 5000 }).catch(() => {});
const registro = await p2.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".log")?.textContent || "");
check(letto && !tipsRosso && testo.includes(RIGHE_ESEMPIO[0]) && testo.includes(RIGHE_ESEMPIO[1]),
  `referto del portale: il testo nel pannello (got: ${tipsRosso ? "rosso — " + tipsRosso.slice(0, 160) : testo.slice(0, 60)})`);
check(/lo apro nel portale, in una scheda dietro/.test(registro) && /testo letto \(\d+ righe, pdf\.js\)/.test(registro),
  `aperto nel portale, letto con pdf.js (${(/testo (?:letto|non letto)[^\n]*/.exec(registro) || ["niente nel registro"])[0].slice(0, 120)})`);
check(!chi.some((c) => c.startsWith("sw:")) && chi.some((c) => /loginPC\.jsp/.test(c)),
  `al portale ci va la pagina, mai il service worker (${chi.join(", ")})`);
check(schedeDopo === schedePrima, `la scheda dietro si richiude da sola (schede ${schedePrima} → ${schedeDopo})`);

// …e se il portale il PDF non lo mostra: pallino rosso, il perché, e com'è
// fatta la sua pagina (niente del paziente) da copiare nella diagnosi
senzaPdf = true;
const p3 = await ctx.newPage();
await p3.goto(mock.patientUrl);
await p3.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await p3.locator('#psassist-host [data-seg="esiti"]').click();
await p3.waitForSelector('#psassist-host [data-esito]', { timeout: 10000 });
await p3.locator("#psassist-host #refreset").click();   // via la copia salvata: si riapre il portale
await p3.waitForTimeout(800);
await p3.locator('#psassist-host [data-esito][data-kind="referto"]:has-text("TC ENCEFALO")').first().click();
const rosso = await p3.waitForSelector("#psassist-host .rrow.err", { state: "attached", timeout: 70000 }).then((el) => el.getAttribute("title")).catch(() => "");
check(/non si vede da qui/.test(rosso) && /portale \/clin-port\/loginPC\.jsp/.test(rosso) && /sguardo sì \(blob 0/.test(rosso) && !/abc123/.test(rosso),
  `senza PDF: il motivo e la pagina del portale, senza il token (got: ${String(rosso).slice(0, 220)})`);

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILURE(S)` : "\nEXTENSION CHECKS PASSED");
process.exit(failures ? 1 : 0);
