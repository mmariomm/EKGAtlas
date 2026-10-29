#!/usr/bin/env node
/*
 * Extension-only check: the service worker really fetches and stores referto
 * PDFs, and a saved referto opens from this machine (blob:) instead of the
 * server. Runs the UNPACKED extension in a persistent context.
 *   node test/ext-referti.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { pdfCifrato, RIGHE_ESEMPIO, pdfSemplice, RIGHE_ALTRO } from "./pdf-difficili.mjs";
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
// Gli Esiti non mostrano più i referti di laboratorio (LIS). Il banco ne ha due
// e uno di radiologia (RIS): uno dei due LIS si traveste da consulenza (stesso
// id, un altro sistema), così c'è anche un documento «da aprire» che non è
// né laboratorio né radiologia; e si aggiungono due radiologie, così i referti
// da salvare sono quattro (la fila ne scarica al massimo due insieme). Il mock
// non si tocca: si cambia la pagina al volo.
const rigaRis = (id, quando, nome) => `<tr><td class="AFCDataTD" title="${nome}" valign="top"><a href="#" title="REFERTO" onclick="javascript:window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=*TEST00001&REFERTO_SISTEMA=HL7RIS&REFERTO_ID=${id}','HL7RIS')"><img alt="referto"></a>
  ${nome}<input type="hidden" name="DATA_ORD" value="${quando}"><input type="hidden" name="DESCRIZIONE_TITLE" value="${nome}"></td></tr>`;
{
  const h = mock.handle;
  mock.handle = (req) => {
    const out = h(req);
    return Buffer.isBuffer(out.body) && /html/.test(out.headers["content-type"] || "")
      ? { ...out, body: Buffer.from(out.body.toString("latin1").replace(/REFERTO_SISTEMA=HL7LIS(&REFERTO_ID=bbbb2222)/g, "REFERTO_SISTEMA=HL7CONS$1")
        .replace(/(REFERTO_ID=cccc3333[\s\S]*?<\/tr>)/, `$1${rigaRis("dddd4444-0000-0000-0000-000000000004", "2026-08-22 03:10:00.0", "69-140 RX TORACE (A6900)")}${
          rigaRis("eeee5555-0000-0000-0000-000000000005", "2026-08-22 04:20:00.0", "69-210 ECOGRAFIA ADDOME (A6921)")}`), "latin1") }
      : out;
  };
}
// quanti referti si scaricano INSIEME: ogni risposta del documento tarda un po'
let inVolo = 0, maxInVolo = 0;
let voli = [];   // { id, da, a }: quando ogni scaricamento parte e finisce
const RIGHE_ECO = ["ECOGRAFIA ADDOME COMPLETO", "Fegato di dimensioni ed ecostruttura nei limiti.",
  "Colecisti alitiasica. Reni in sede, non dilatazione delle vie escretrici.", "Conclusioni: ecografia addominale nei limiti."];
const eDoc = (u) => /Sa4ViewerExtRedirect\.do/.test(u) && /REFERTO_ID=/.test(u);
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
});
// aperto, il pannello è una finestra all'85% che copre la pagina: qui i test
// cliccano anche la pagina, quindi parte come colonna a destra
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem("psassist:win.v1")) localStorage.setItem("psassist:win.v1", JSON.stringify({ x: 0.6, y: 0.01, w: 0.39, h: 0.97 })); } catch { /* niente */ }
});
// e parte aperto, come se ci avesse portato il pannello (dal gestionale partirebbe dalla pill)
await ctx.addInitScript(() => {
  try { sessionStorage.setItem("psassist:navPannello.v1", JSON.stringify(Date.now())); } catch { /* niente */ }
});
const route = async (r) => {
  const req = r.request();
  const doc = eDoc(req.url());
  if (doc) {
    const v = { id: new URL(req.url()).searchParams.get("REFERTO_ID"), da: Date.now(), a: 0 };
    voli.push(v);
    inVolo++; maxInVolo = Math.max(maxInVolo, inVolo); await new Promise((ok) => setTimeout(ok, 700)); inVolo--;
    v.a = Date.now();
    // l'ecografia con un font vero (Helvetica): il visore la deve disegnare
    if (v.id && v.id.startsWith("eeee5555")) {
      mock.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });   // (contata come le altre)
      return r.fulfill({ status: 200, headers: { "content-type": "application/pdf" }, body: pdfSemplice(RIGHE_ECO) });
    }
  }
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
// i referti di laboratorio non sono negli Esiti: né il gruppo, né le righe
const righeRef = '#psassist-host [data-esito][data-kind="referto"]';
check(await page.locator("#psassist-host #reflab").count() === 0 && await page.locator(righeRef).count() === 4,
  "negli Esiti restano solo i referti che non sono di laboratorio (4)");
// niente si scarica da solo: aprire gli Esiti non chiede nessun documento
await page.waitForTimeout(800);
check(mock.state.requests.filter((q) => eDoc(q.url)).length === 0, "aprire gli Esiti non scarica nessun referto: lo decide il medico");

// «Salva i referti» sta negli Esiti, nella riga in cima: non più nel menu ⋯
const saveBtn = page.locator("#psassist-host .wusum #refsave");
check(await saveBtn.count() === 1 && /\(4\)/.test(await saveBtn.innerText()), "«⭳ Salva i referti (4)» sta nella riga in cima agli Esiti");
await page.locator("#psassist-host #menubtn").click();
check(await page.locator("#psassist-host .menu #refsave").count() === 0, "e non più nel menu ⋯");
await page.keyboard.press("Escape");
await saveBtn.click();
const progresso = await page.locator("#psassist-host .wuprog").innerText({ timeout: 3000 }).catch(() => "");
check(/Salvo i referti \d\/4/.test(progresso), `mentre salva, la riga in cima dice a che punto è (got: ${progresso})`);
check(await page.locator("#psassist-host .rdot.coda").count() >= 1, "chi aspetta il suo turno lo dice la sua riga («in fila»)");
await page.waitForFunction(
  () => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".rdot.saved").length === 4,
  { timeout: 40000 },
).catch(() => {});
const saved = await page.locator("#psassist-host .rdot.saved").count();
check(saved === 4, `4 referti salvati (got ${saved})`);
check(maxInVolo === 2, `al massimo due scaricamenti insieme, e la fila li usa tutti e due (got ${maxInVolo})`);
const scaricati = mock.state.requests.filter((q) => eDoc(q.url));
check(scaricati.length === 4, `ogni referto scaricato una volta sola (got ${scaricati.length})`);
// «Salva referti» agisce solo su quelli che si vedono: il referto di
// laboratorio nascosto non viene nemmeno scaricato
check(mock.state.requests.filter((q) => q.url.includes("aaaa1111")).length === 0,
  "e il referto di laboratorio, che non si vede, non viene scaricato");
// salvati, se ne legge subito il testo: l'anteprima è sulla riga
await page.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".wuimg .wuex").length === 3, { timeout: 15000 }).catch(() => {});
check(await page.locator("#psassist-host .wuimg .wuex").count() === 3, "salvati, il loro testo si legge subito (l'anteprima sulla riga)");

// un'altra scheda, lo stesso paziente: il testo dei PDF salvati si legge dalla
// copia su questo computer, senza chiedere niente a nessuno
const richiestePrima = mock.state.requests.filter((q) => eDoc(q.url)).length;
const pS = await ctx.newPage();
await pS.goto(mock.patientUrl);
await pS.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await pS.locator('#psassist-host [data-seg="esiti"]').click();
await pS.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".wuimg .wuex").length === 3, { timeout: 20000 }).catch(() => {});
check(await pS.locator("#psassist-host .wuimg .wuex").count() === 3, "in una scheda nuova il testo dei salvati c'è già, letto dalla copia");
await pS.locator('#psassist-host .wuimg [data-esito]:has-text("TC ENCEFALO")').click();
await pS.waitForSelector("#psassist-host .wuitem.aperto .reftxt .rt", { timeout: 10000 }).catch(() => {});
check(/Non focolai/.test(await pS.locator("#psassist-host .wuitem.aperto .reftxt").innerText().catch(() => "")), "e si apre lì sotto, al tocco");
check(mock.state.requests.filter((q) => eDoc(q.url)).length === richiestePrima, "nessuna richiesta al server per leggere i salvati");
await pS.close();

// «↗ PDF» su un referto salvato: il visore dell'estensione, sopra la pagina,
// col PDF della copia su questo computer — niente scheda nuova, niente server
const before = mock.state.requests.filter((q) => q.url.includes("Sa4ViewerExtRedirect")).length;
let popupVisore = false;
page.once("popup", () => { popupVisore = true; });
const rigaPdf = page.locator('#psassist-host .wuline:has([data-pdf]):has-text("ECOGRAFIA ADDOME")').first();
const esamePdf = (await rigaPdf.locator(".rlab").innerText()).trim();
const quandoPdf = (await rigaPdf.locator(".rwhen").innerText()).trim();
await rigaPdf.locator("[data-pdf]").click();
const visore = page.locator("#psassist-visore");
await visore.locator("canvas").first().waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);
const testaVisore = await visore.locator(".vtit").innerText().catch(() => "");
const disegnato = await page.evaluate(() => {
  const c = document.getElementById("psassist-visore")?.shadowRoot.querySelector("canvas");
  if (!c) return 0;
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let scuri = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 3] > 0) scuri++;
  return scuri;
});
check(disegnato > 50 && !popupVisore, `«↗ PDF» su un salvato: il PDF nel visore dell'estensione, non in una scheda (pixel scritti ${disegnato})`);
check(testaVisore.includes(esamePdf) && testaVisore.includes(quandoPdf) && /ROSSI/i.test(testaVisore),
  `in testa paziente · esame · data (got: ${testaVisore})`);
if (process.env.PSA_SCREEN) await page.screenshot({ path: process.env.PSA_SCREEN }).catch(() => {});
check(mock.state.requests.filter((q) => q.url.includes("Sa4ViewerExtRedirect")).length === before,
  "nessuna richiesta al server all'apertura di un referto salvato");
await visore.locator("#vchiudi").click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(300);
check(await visore.count() === 0 && await page.locator('#psassist-host [data-esito][data-kind="referto"]').count() === 4,
  "✕ chiude il visore e si resta negli Esiti");

// un referto salvato ma di un altro paziente: il visore non lo mostra mai
{
  const idAltro = await rigaPdf.locator("[data-pdf]").getAttribute("data-pdf");
  const ep = new URL(mock.patientUrl).searchParams.get("EPISODIO_ID");
  const pM = await ctx.newPage();
  await pM.addInitScript(([k]) => { try { sessionStorage.setItem(k, JSON.stringify({ ts: Date.now(), altro: true })); } catch { /* niente */ } },
    [`psassist:reftxt.${ep}.${idAltro}`]);
  await pM.goto(mock.patientUrl);
  await pM.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await pM.locator('#psassist-host [data-seg="esiti"]').click();
  await pM.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".rdot.saved").length >= 1, { timeout: 15000 }).catch(() => {});
  let popupM = false;
  pM.on("popup", () => { popupM = true; });
  await pM.locator(`#psassist-host [data-pdf="${idAltro}"]`).click();
  await pM.waitForTimeout(1500);
  const banner = await pM.locator("#psassist-host .banner").innerText().catch(() => "");
  check(await pM.locator("#psassist-visore").count() === 0 && !popupM && /altro paziente/.test(banner),
    `un salvato di un altro paziente non si apre nel visore (got: ${banner || "niente"})`);
  await pM.close();
}

await page.locator("#psassist-host #refreset").click();
await page.waitForTimeout(1200);
check(await page.locator("#psassist-host .rdot.saved").count() === 0, "Resetta svuota i salvataggi");

// «⭳ Carica i valori» prende anche i referti: solo quelli che non sono di
// laboratorio, due alla volta al massimo, con una pausa prima di ognuno, e
// mai uno già salvato
{
  voli = []; maxInVolo = 0;
  await page.locator("#psassist-host #risall").click();
  await page.waitForFunction(
    () => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".rdot.saved").length === 4,
    { timeout: 120000 },
  ).catch(() => {});
  check(await page.locator("#psassist-host .rdot.saved").count() === 4 && voli.length === 4,
    `«Carica i valori»: anche i 4 referti, salvati (scaricati ${voli.length})`);
  check(!voli.some((v) => v.id === "aaaa1111") && mock.state.requests.filter((q) => q.url.includes("aaaa1111")).length === 0,
    "mai quello di laboratorio");
  check(maxInVolo === 2, `al massimo due insieme (got ${maxInVolo})`);
  const da = voli.map((v) => v.da).sort((x, y) => x - y), a = voli.map((v) => v.a).sort((x, y) => x - y);
  const pause = [da[2] - a[0], da[3] - a[1]];
  check(pause.every((p) => p >= 450), `una pausa prima del prossimo, non a raffica (ms: ${pause.join(", ")})`);
  await page.waitForTimeout(1500);
  const dopo = voli.length;
  await page.locator("#psassist-host #risall").click();
  await page.waitForTimeout(4000);
  const pC = await ctx.newPage();
  await pC.goto(mock.patientUrl);
  await pC.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await pC.locator('#psassist-host [data-seg="esiti"]').click();
  await pC.locator("#psassist-host #risall").click();
  await pC.waitForTimeout(5000);
  check(voli.length === dopo, `già salvati: non si riscaricano, qui né in un'altra scheda (got ${voli.length - dopo} in più)`);
  await pC.close();
  await page.locator("#psassist-host #refreset").click({ timeout: 3000 }).catch(() => {});   // il portale, qui sotto, parte senza copie
  await page.waitForTimeout(1200);
}

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
// …e uno che mostra prima il PDF di un altro paziente (rimasto aperto), poi il nostro — o solo quello
let altroPrima = "";      // "" | "prima" | "solo"
const b64Altro = pdfSemplice(RIGHE_ALTRO).toString("base64");
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
      if (${JSON.stringify(altroPrima)}) {
        const f = document.createElement("iframe");
        f.src = URL.createObjectURL(new Blob([Uint8Array.from(atob("${b64Altro}"), (c) => c.charCodeAt(0))], { type: "application/pdf" }));
        document.body.appendChild(f);
      }
      if (${JSON.stringify(altroPrima)} !== "solo") setTimeout(() => {
        const x = new XMLHttpRequest();
        x.open("GET", "/clin-port/rest/documenti/1/contenuto");
        x.responseType = "arraybuffer";
        // come il portale vero: avuto il PDF, porta la scheda sul blob:
        // (nella barra resta «blob:http://10.11.0.151:9080/…»)
        x.onload = () => { location.href = URL.createObjectURL(new Blob([x.response], { type: "application/pdf" })); };
        x.send();
      }, ${altroPrima ? 1200 : 300});
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
await p2.locator("#psassist-host #menubtn").click();   // il Registro, dal menu «⋯»
await p2.locator("#psassist-host #verbtn").click();
await p2.waitForSelector("#psassist-host .log", { state: "attached", timeout: 5000 }).catch(() => {});
const registro = await p2.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".log")?.textContent || "");
check(letto && !tipsRosso && testo.includes(RIGHE_ESEMPIO[0]) && testo.includes(RIGHE_ESEMPIO[1]),
  `referto del portale: il testo nel pannello (got: ${tipsRosso ? "rosso — " + tipsRosso.slice(0, 160) : testo.slice(0, 60)})`);
check(/lo apro nel portale, in una scheda dietro/.test(registro) && /testo letto \(\d+ righe, pdf\.js[;)]/.test(registro),
  `aperto nel portale, letto con pdf.js (${(/testo (?:letto|non letto)[^\n]*/.exec(registro) || ["niente nel registro"])[0].slice(0, 120)})`);
check(!chi.some((c) => c.startsWith("sw:")) && chi.some((c) => /loginPC\.jsp/.test(c)),
  `al portale ci va la pagina, mai il service worker (${chi.join(", ")})`);
check(schedeDopo === schedePrima, `la scheda dietro si richiude da sola (schede ${schedePrima} → ${schedeDopo})`);

// Il portale mostra PRIMA il PDF di un altro paziente (rimasto aperto da prima),
// poi il nostro: si tiene il nostro, non il primo che passa. E se mostra solo
// quello dell'altro, non si tiene niente e lo si dice.
for (const modo of ["prima", "solo"]) {
  altroPrima = modo;
  const pA = await ctx.newPage();
  await pA.goto(mock.patientUrl);
  await pA.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await pA.locator('#psassist-host [data-seg="esiti"]').click();
  await pA.waitForSelector('#psassist-host [data-esito]', { timeout: 10000 });
  if (await pA.locator("#psassist-host #refreset").count()) { await pA.locator("#psassist-host #refreset").click(); await pA.waitForTimeout(600); }
  await pA.locator('#psassist-host [data-esito][data-kind="referto"]:has-text("RX TORACE")').first().click();
  await pA.waitForFunction(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    return r.querySelectorAll(".wuitem.aperto .reftxt .rt").length > 0 || !!r.querySelector(".rrow.err");
  }, { timeout: 60000 }).catch(() => {});
  const t = await pA.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".wuitem.aperto .reftxt")?.textContent || "");
  const rossoA = await pA.locator("#psassist-host .rrow.err").first().getAttribute("title", { timeout: 1000 }).catch(() => "");
  if (modo === "prima") {
    check(t.includes(RIGHE_ESEMPIO[0]) && !/BIANCHI|BNCNNA/.test(t),
      `il portale mostra prima il referto di un altro paziente: si tiene il nostro (got: ${(t || rossoA || "").slice(0, 90)})`);
  } else {
    check(!t && /un altro paziente/.test(rossoA || ""),
      `solo il referto di un altro paziente: niente testo, e il perché (got: ${String(t || rossoA).slice(0, 120)})`);
  }
  await pA.close();
}
altroPrima = "";

// …e se il portale il PDF non lo mostra: pallino rosso, il perché, e com'è
// fatta la sua pagina (niente del paziente) da copiare nella diagnosi
senzaPdf = true;
const p3 = await ctx.newPage();
await p3.goto(mock.patientUrl);
await p3.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await p3.locator('#psassist-host [data-seg="esiti"]').click();
await p3.waitForSelector('#psassist-host [data-esito]', { timeout: 10000 });
if (await p3.locator("#psassist-host #refreset").count()) await p3.locator("#psassist-host #refreset").click();   // via la copia salvata: si riapre il portale
await p3.waitForTimeout(800);
await p3.locator('#psassist-host [data-esito][data-kind="referto"]:has-text("TC ENCEFALO")').first().click();
const rosso = await p3.waitForSelector("#psassist-host .rrow.err", { state: "attached", timeout: 70000 }).then((el) => el.getAttribute("title")).catch(() => "");
check(/non si vede da qui/.test(rosso) && /portale \/clin-port\/loginPC\.jsp/.test(rosso) && /sguardo sì \(blob 0/.test(rosso) && !/abc123/.test(rosso),
  `senza PDF: il motivo e la pagina del portale, senza il token (got: ${String(rosso).slice(0, 220)})`);

// Lo sguardo sul portale tocca solo le richieste ASINCRONE: una sincrona (il
// portale ne manda una a logout.jsp mentre la pagina si chiude, e Chrome la
// rifiuta) va dritta alla send del browser — il rifiuto non passa più da
// portale-pdf.js e non finisce fra gli errori dell'estensione.
{
  const pp = await ctx.newPage();
  await pp.setContent("<html><body>portale</body></html>");
  await pp.addScriptTag({ path: join(root, "extension/portale-pdf.js") });
  const x = await pp.evaluate(() => {
    const own = (o) => Object.prototype.hasOwnProperty.call(o, "send");
    const a = new XMLHttpRequest(); a.open("GET", "http://10.11.0.151:9080/x");
    const s = new XMLHttpRequest(); s.open("GET", "http://10.11.0.151:9080/x", false);
    const r = new XMLHttpRequest(); r.open("GET", "http://10.11.0.151:9080/x"); r.open("GET", "http://10.11.0.151:9080/x", false);   // riaperta sincrona
    return { nativa: /\[native code\]/.test(XMLHttpRequest.prototype.send.toString()),
             asincrona: own(a), sincrona: own(s), riaperta: own(r) };
  });
  check(x.nativa && x.asincrona && !x.sincrona && !x.riaperta,
    `richieste sincrone del portale: la send del browser, senza passare da qui (${JSON.stringify(x)})`);
  await pp.close();
}

// ---- ⋯ → «Reset dati pazienti» ----------------------------------------------
// Ogni chiave per nome: quelle dei pazienti e del turno se ne vanno, le
// impostazioni e i modelli del medico restano.
{
  const NS = "psassist:";
  const ep = new URL(mock.patientUrl).searchParams.get("EPISODIO_ID");
  const VIA_LOCALE = ["patients.v1", "stanza.posti.v1", "stato.v1", "dafare.v1", "promemoria.v1", "note.v1", "segni.v1",
    "refVisti.v1", "refPortale", "daConfermare.v1", "quesiti", "quesiti.ts", "lastQ", "corsa.aperta.v1", "corsa.presidio.v1"];
  const RESTA_LOCALE = { "win.v1": null, "pillpos.v1": { left: 40, top: 40 }, "collapsed": false, "stanza.v1": null, "catalog.v1": null,
    "dimissioni.v1": { prova: { testo: "modello del medico" } }, "eo.v1": { prova: "EO del medico" }, "ordini.stampati": ["o1"], "attesaConferma.ms": 120000 };
  const VIA_SCHEDA = [`ris.${ep}.zz`, `visto.${ep}.zz`, `reftxt.${ep}.zz`, `log.${ep}`, `ui.${ep}`, "receipt.v1", "confirm.v1", "queue.v1",
    "print.v1", "cuori.v1", "richieste.nostre.v1", "registriOrdini.v1", "avviso.v1", "dimdraft.x", "eodraft.x"];
  const VIA_EXT = ["ref:zz", "storicoArch"], RESTA_EXT = ["portale", "stampa", "stampaEsito", "stampaMisura", "ponte.coppia", "ponte.host"];
  const VIA_SESS = ["apertura", "sotto:999", "ordine:o-fine"], RESTA_SESS = ["ponte", "ordiniVisti", "ordiniFogli", "stampaVerificata"];

  const pR = await ctx.newPage();
  await pR.goto(mock.patientUrl);
  await pR.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await pR.locator('#psassist-host [data-seg="esiti"]').click();
  const pAltra = await ctx.newPage();   // un'altra scheda: anche la sua memoria se ne va
  await pAltra.goto(mock.patientUrl);
  await pAltra.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const semina = ([ns, via, resta, scheda]) => {
    const valore = { "quesiti.ts": Date.now(), "quesiti": ["x"], "daConfermare.v1": [], "lastQ": "x", "corsa.aperta.v1": null, "corsa.presidio.v1": null,
      "stato.v1": { "999": { agg: Date.now() } } };
    for (const k of via) {
      if (k === "patients.v1") { if (localStorage.getItem(ns + k) === null) throw new Error("l'elenco dei pazienti dovrebbe esserci già"); continue; }
      localStorage.setItem(ns + k, JSON.stringify(k in valore ? valore[k] : {}));
    }
    for (const [k, v] of Object.entries(resta)) if (v !== null) localStorage.setItem(ns + k, JSON.stringify(v));
    localStorage.setItem(ns + "tempi.v1", JSON.stringify([{ id: "t1", titolo: "Visita ed esami", paz: "ROSSI MARIO", ep: "1", inizio: Date.now() - 6e4, fine: Date.now() }]));
    for (const k of scheda) sessionStorage.setItem(ns + k, JSON.stringify({ ts: Date.now() }));
  };
  await pR.evaluate(semina, [NS, VIA_LOCALE, RESTA_LOCALE, VIA_SCHEDA]);
  await pAltra.evaluate(([ns, k]) => sessionStorage.setItem(ns + k, "{}"), [NS, `reftxt.${ep}.zz`]);
  const prima = await pR.evaluate(([ns, ks]) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(ns + k)])), [NS, Object.keys(RESTA_LOCALE)]);
  const [sw] = ctx.serviceWorkers();
  await sw.evaluate(async ([viaE, restaE, viaS, restaS]) => {
    const o = {};
    for (const k of [...viaE, ...restaE]) o[k] = k === "portale" ? "http://10.11.0.151:9080" : { prova: k };
    await chrome.storage.local.set(o);
    const s = { ordini: [{ id: "o-fine", stato: "errore", agg: Date.now(), paziente: "ROSSI MARIO" }], "ponte.ordini": [{ id: "tel1", paziente: "ROSSI MARIO", ts: Date.now(), fine: true }] };
    for (const k of [...viaS, ...restaS]) s[k] = k === "sotto:999" ? { esito: "letto" } : k === "ordiniVisti" || k === "ordiniFogli" ? ["o-fine"] : { prova: k };
    await chrome.storage.session.set(s);
  }, [VIA_EXT, RESTA_EXT, VIA_SESS, RESTA_SESS]);

  await pR.locator("#psassist-host #menubtn").click();
  await pR.locator("#psassist-host #resetpaz").click({ timeout: 3000 }).catch(() => {});
  const chiede = await pR.locator("#psassist-host #resetpaz").innerText().catch(() => "");
  const ancora = await pR.evaluate((k) => localStorage.getItem(k), NS + "patients.v1");
  check(/Cancello tutto\? Tocca di nuovo/.test(chiede) && ancora !== null, `un tocco chiede soltanto (got: ${chiede})`);
  await pR.locator("#psassist-host #resetpaz").click({ timeout: 3000 }).catch(() => {});
  await pR.waitForSelector("#psassist-host .banner.ok", { timeout: 5000 }).catch(() => {});
  check(/^Fatto/.test(await pR.locator("#psassist-host .banner.ok").innerText().catch(() => "")), "il secondo tocco cancella, e dice «Fatto»");
  await pR.waitForTimeout(800);

  const loc = await pR.evaluate(([ns, ks]) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(ns + k)])), [NS, [...VIA_LOCALE, ...Object.keys(RESTA_LOCALE), "tempi.v1"]]);
  // (stato.v1: la pagina aperta lo riscrive subito per il suo paziente — degli altri niente)
  const rimasti = VIA_LOCALE.filter((k) => loc[k] !== null && !(k === "stato.v1" && !/"999"/.test(loc[k])));
  check(!rimasti.length, `localStorage: via ${VIA_LOCALE.join(", ")} (rimasti: ${rimasti.join(", ") || "nessuno"})`);
  const cambiati = Object.keys(RESTA_LOCALE).filter((k) => loc[k] !== prima[k]);
  check(!cambiati.length, `localStorage: restano ${Object.keys(RESTA_LOCALE).join(", ")} (cambiati: ${cambiati.join(", ") || "nessuno"})`);
  const tempi = JSON.parse(loc["tempi.v1"] || "[]");
  check(tempi.length === 1 && !("paz" in tempi[0]) && !("ep" in tempi[0]), "Tempi: restano i tempi, senza il paziente");
  const scheda = await pR.evaluate(([ns, ks]) => ks.filter((k) => sessionStorage.getItem(ns + k) !== null), [NS, VIA_SCHEDA]);
  check(!scheda.length, `la memoria di questa scheda: via (rimasti: ${scheda.join(", ") || "nessuno"})`);
  const altra = await pAltra.evaluate((k) => sessionStorage.getItem(k), `${NS}reftxt.${ep}.zz`);
  check(altra === null, "e quella delle altre schede aperte");
  const ext = await sw.evaluate(async () => ({ l: await chrome.storage.local.get(null), s: await chrome.storage.session.get(null) }));
  const viaExt = [...VIA_EXT.filter((k) => k in ext.l), ...VIA_SESS.filter((k) => k in ext.s)];
  check(!viaExt.length && !Object.keys(ext.l).some((k) => k.startsWith("ref:")), `estensione: via referti salvati, schede cliniche, ${VIA_SESS.join(", ")} (rimasti: ${viaExt.join(", ") || "nessuno"})`);
  check(!(ext.s.ordini || []).length && !(ext.s["ponte.ordini"] || []).length, "via gli ordini finiti, anche quelli che ricordava il ponte");
  const persi = [...RESTA_EXT.filter((k) => !(k in ext.l)), ...RESTA_SESS.filter((k) => !(k in ext.s))];
  check(!persi.length, `estensione: restano ${[...RESTA_EXT, ...RESTA_SESS].join(", ")} (persi: ${persi.join(", ") || "nessuno"})`);
  check(await pR.locator("#psassist-host .rdot.saved").count() === 0, "negli Esiti, nessun referto più salvato");
  await sw.evaluate(async (ks) => { await chrome.storage.local.remove(ks); await chrome.storage.session.remove(["ponte", "stampaVerificata"]); }, RESTA_EXT);
  await pR.close(); await pAltra.close();
}

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILURE(S)` : "\nEXTENSION CHECKS PASSED");
process.exit(failures ? 1 : 0);
