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
// da salvare sono quattro (la fila ne scarica uno alla volta). Il mock
// non si tocca: si cambia la pagina al volo.
const rigaRef = (sis, id, quando, nome) => `<tr><td class="AFCDataTD" title="${nome}" valign="top"><a href="#" title="REFERTO" onclick="javascript:window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=*TEST00001&REFERTO_SISTEMA=${sis}&REFERTO_ID=${id}','${sis}')"><img alt="referto"></a>
  ${nome}<input type="hidden" name="DATA_ORD" value="${quando}"><input type="hidden" name="DESCRIZIONE_TITLE" value="${nome}"></td></tr>`;
const rigaRis = (id, quando, nome) => rigaRef("HL7RIS", id, quando, nome);
// righe in più che la pagina del paziente mostra da un certo momento (ECG nuovi,
// un referto del laboratorio, una finestra Risultati)
let extra = [], extraLab = [], extraRis = [];
const rigaRis2 = (id) => `<tr><td class="AFCDataTD" title="0-320 EMOCROMOCITOMETRICO URGENTE (POCT1502)"><a class="AFCDataLink" href="#" title="Visualizza Risultati" onclick="window.open('/sa4rcs/restrict/RcsAccessiRisultatiElenco.do?RCS_ACCESSO_ID=${id}','*TEST00001','height=500,width=800');"><img alt="risultati"></a>
  <input type="hidden" name="DATA_ORD" value="2026-08-23 07:28:00.0"></td></tr>`;
{
  const h = mock.handle;
  mock.handle = (req) => {
    const out = h(req);
    return Buffer.isBuffer(out.body) && /html/.test(out.headers["content-type"] || "")
      ? { ...out, body: Buffer.from(out.body.toString("latin1").replace(/REFERTO_SISTEMA=HL7LIS(&REFERTO_ID=bbbb2222)/g, "REFERTO_SISTEMA=HL7CONS$1")
        .replace(/(REFERTO_ID=cccc3333[\s\S]*?<\/tr>)/, `$1${rigaRis("dddd4444-0000-0000-0000-000000000004", "2026-08-22 03:10:00.0", "69-140 RX TORACE (A6900)")}${
          rigaRis("eeee5555-0000-0000-0000-000000000005", "2026-08-22 04:20:00.0", "69-210 ECOGRAFIA ADDOME (A6921)")}${
          extra.map((x) => rigaRef("HL7AMB", x.id, x.quando, "8-6 ELETTROCARDIOGRAMMA (84)")).join("")}${
          extraLab.map((id) => rigaRef("HL7LIS", id, "2026-08-22 08:00:00.0", "0-320 EMOCROMOCITOMETRICO URGENTE (POCT1502)")).join("")}${
          extraRis.map(rigaRis2).join("")}`), "latin1") }
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
    // un ECG il cui PDF è intestato a un altro paziente: l'errore grave
    if (v.id && v.id.startsWith("ffff9999")) {
      mock.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
      return r.fulfill({ status: 200, headers: { "content-type": "application/pdf" }, body: pdfSemplice(RIGHE_ALTRO) });
    }
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
// un paziente con dei referti si apre sugli Esiti, senza toccare niente
await page.waitForSelector('#psassist-host [data-esito]', { timeout: 10000 });
check(await page.locator('#psassist-host [data-seg="esiti"].on').count() === 1, "un paziente con dei referti si apre sugli Esiti");
// i referti di laboratorio non sono negli Esiti: né il gruppo, né le righe
const righeRef = '#psassist-host [data-esito][data-kind="referto"]';
check(await page.locator("#psassist-host #reflab").count() === 0 && await page.locator(righeRef).count() === 4,
  "negli Esiti restano solo i referti che non sono di laboratorio (4)");

// ---- aperto il paziente, quello che la pagina mostra e non è ancora qui si
// carica da sé: i valori e i referti (mai il laboratorio), uno alla volta, con
// la pausa a caso, ognuno una volta sola. Mentre gira, solo «↓ N» accanto a ↻.
// le righe d'Imaging che mostrano un'anteprima del testo
const conAnteprima = (p) => p.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll(".wuimg .rrow")]
  .filter((r) => r.querySelector(".wuex")).map((r) => r.querySelector(".rlab").textContent.trim()));
const salvati = (p, n) => p.waitForFunction((k) => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".rdot.saved").length === k, n, { timeout: 120000 }).catch(() => {});
{
  const mentre = await page.waitForFunction(() => {
    const r = document.getElementById("psassist-host").shadowRoot;
    const a = r.querySelector(".wuauto");
    return a ? { t: a.textContent.trim(), prog: !!r.querySelector(".wuprog"), salva: !!r.querySelector("#refsave"), ricarica: r.querySelector("#risall")?.textContent.trim() || "" } : false;
  }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
  check(!!mentre && /^↓ \d+$/.test(mentre.t) && !mentre.prog && !mentre.salva && mentre.ricarica === "↻",
    `mentre carica da solo: «↓ N» accanto a ↻, nient'altro (got: ${JSON.stringify(mentre)})`);
  await salvati(page, 4);
  check(await page.locator("#psassist-host .rdot.saved").count() === 4, "aprendo il paziente, i 4 referti si salvano da soli");
  check(maxInVolo === 1, `uno alla volta (got ${maxInVolo})`);
  const scaricatiAuto = mock.state.requests.filter((q) => eDoc(q.url));
  check(scaricatiAuto.length === 4 && voli.length === 4, `ogni referto scaricato una volta sola (got ${scaricatiAuto.length})`);
  check(mock.state.requests.filter((q) => q.url.includes("aaaa1111")).length === 0, "e il referto di laboratorio non viene scaricato");
  const da = voli.map((v) => v.da).sort((x, y) => x - y), a = voli.map((v) => v.a).sort((x, y) => x - y);
  check([da[2] - a[0], da[3] - a[1]].every((p) => p >= 450), `una pausa prima del prossimo, non a raffica (ms: ${[da[2] - a[0], da[3] - a[1]].join(", ")})`);
  await page.waitForFunction(() => !document.getElementById("psassist-host").shadowRoot.querySelector(".wuauto"), null, { timeout: 15000 }).catch(() => {});
  check(await page.locator("#psassist-host .wuauto").count() === 0, "finito, il «↓» se ne va");
  // il testo si legge da solo solo di ECG e radiografie: TC ed ecografia si
  // salvano e basta (si aprono nel visore). Il più recente non letto, col suo testo, è aperto
  await page.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".wuimg .wuex").length >= 1, { timeout: 15000 }).catch(() => {});
  check(JSON.stringify(await conAnteprima(page)) === JSON.stringify(["RX TORACE"]), `salvati: il testo da solo solo della radiografia, non di TC ed ecografia (got: ${(await conAnteprima(page)).join(", ")})`);
  const aperto = await page.locator("#psassist-host .wuitem.aperto").innerText().catch(() => "");
  check(/RX TORACE/.test(aperto) && /Non focolai/.test(aperto) && (await page.locator("#psassist-host .wuitem.aperto").count()) === 1,
    `il più recente non letto (con testo) è aperto (got: ${aperto.replace(/\s+/g, " ").slice(0, 90)})`);
}

// un'altra scheda, lo stesso paziente: il testo dei PDF salvati si legge dalla
// copia su questo computer, senza chiedere niente a nessuno — e niente si riscarica
{
  const richiestePrima = mock.state.requests.filter((q) => eDoc(q.url)).length;
  const pS = await ctx.newPage();
  await pS.goto(mock.patientUrl);
  await pS.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await pS.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".wuimg .wuex").length >= 1, { timeout: 20000 }).catch(() => {});
  check(JSON.stringify(await conAnteprima(pS)) === JSON.stringify(["RX TORACE"]), "in una scheda nuova il testo della radiografia salvata c'è già, letto dalla copia");
  // una TC al tocco: il visore sulla copia salvata, nessun testo nel pannello
  await pS.locator('#psassist-host .wuimg [data-esito]:has-text("TC ENCEFALO")').click();
  await pS.locator("#psassist-visore canvas").first().waitFor({ timeout: 15000 }).catch(() => {});
  check((await pS.locator("#psassist-visore").count()) === 1 && /TC ENCEFALO/.test(await pS.locator("#psassist-visore .vtit").innerText().catch(() => ""))
    && (await pS.locator('#psassist-host .wuitem:has-text("TC ENCEFALO") .reftxt').count()) === 0,
    "una TC al tocco: il PDF nel visore, nessun testo nel pannello");
  await pS.locator("#psassist-visore #vchiudi").click().catch(() => {});
  await pS.waitForTimeout(2500);
  check(mock.state.requests.filter((q) => eDoc(q.url)).length === richiestePrima && (await pS.locator("#psassist-host .wuauto").count()) === 0,
    "nessuna richiesta al server: i salvati non si riscaricano, e non c'è niente di nuovo da caricare");
  await pS.close();
}

// la pagina mostra un referto nuovo: si carica da solo lui, e solo lui
{
  voli = []; maxInVolo = 0;
  extra = [{ id: "ecg10000-0000-0000-0000-000000000010", quando: "2026-08-22 06:00:00.0" }];
  const pN = await ctx.newPage();
  await pN.goto(mock.patientUrl);
  await pN.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await salvati(pN, 5);
  await pN.waitForTimeout(2500);
  check(voli.length === 1 && voli[0].id === extra[0].id, `un referto nuovo in pagina: si scarica lui, gli altri no (got ${voli.map((v) => v.id.slice(0, 8)).join(", ")})`);
  await pN.close();
}

// il medico lascia il paziente: chi è ancora in fila non parte più
{
  voli = []; maxInVolo = 0;
  extra = [11, 12, 13, 14, 15, 16].map((n) => ({ id: `ecg${n}000-0000-0000-0000-0000000000${n}`, quando: `2026-08-22 06:${n}:00.0` }));
  const pL = await ctx.newPage();
  await pL.goto(mock.patientUrl);
  await pL.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  for (let t = 0; t < 300 && !voli.length; t++) await new Promise((ok) => setTimeout(ok, 100));   // il primo è partito
  await pL.goto(mock.worklistUrl);
  const via = Date.now();
  await page.waitForTimeout(4000);
  const dopo = voli.filter((v) => v.da > via + 200);
  check(voli.length >= 1 && voli.length < 6 && !dopo.length,   // (quanti partono prima che la pagina se ne vada dipende dalla macchina)
    `lasciato il paziente il caricamento si ferma: partiti ${voli.length} su 6, dopo l'uscita ${dopo.length}`);
  await pL.close();
  extra = [];
}

// Niente a orario, solo quello che è nuovo. Le letture del laboratorio si
// contano dalle aperture dello storico del portale (il «Carica i valori» di qui).
const storici = () => mock.state.requests.filter((q) => /MODALITA=CLINICA/.test(q.url)).length;
const finito = (p) => p.waitForFunction(() => { const r = document.getElementById("psassist-host")?.shadowRoot; return r && r.querySelector(".wu") && !r.querySelector(".wuauto"); }, null, { timeout: 60000 }).catch(() => {});
{
  // senza le copie (↺) i referti non sono salvati: riaperto, si riprendono; il
  // laboratorio, la cui riga non è cambiata, no
  await page.locator("#psassist-host #refreset").click();
  await page.waitForTimeout(1200);
  voli = []; maxInVolo = 0;
  const s0 = storici();
  const pW = await ctx.newPage();
  await pW.goto(mock.patientUrl);
  await pW.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await salvati(pW, 4);
  await finito(pW);
  check(voli.length === 4 && storici() === s0, `riaperto: i referti non salvati si riprendono, il laboratorio non cambiato no (scaricati ${voli.length}, storici ${storici() - s0})`);
  // la riga del laboratorio cambia (un referto del LIS in più): si rilegge
  extraLab = ["lis20000-0000-0000-0000-000000000020"];
  await pW.reload();
  await pW.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await finito(pW);
  check(storici() === s0 + 1, `la firma del laboratorio è cambiata: i valori si rileggono (storici ${storici() - s0})`);
  // un laboratorio a metà (la finestra Risultati): si ricontrolla aprendo gli Esiti, al più ogni 10 minuti
  extraRis = ["20260010040701"];
  await pW.reload();
  await pW.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await finito(pW);
  const s1 = storici();
  await pW.locator('#psassist-host [data-seg="richieste"]').click();
  await pW.locator('#psassist-host [data-seg="esiti"]').click();
  await pW.waitForTimeout(2500);
  check(storici() === s1, `a metà, gli Esiti riaperti entro 10 minuti: non si rilegge (storici ${storici() - s1})`);
  await pW.evaluate(() => {
    const k = "psassist:autoCarica.v1", t = JSON.parse(localStorage.getItem(k) || "{}");
    for (const ep of Object.keys(t)) t[ep].parz -= 11 * 60e3;
    localStorage.setItem(k, JSON.stringify(t));
  });
  await pW.locator('#psassist-host [data-seg="richieste"]').click();
  await pW.locator('#psassist-host [data-seg="esiti"]').click();
  await finito(pW);
  await pW.waitForTimeout(1500);
  check(storici() === s1 + 1, `passati 10 minuti, gli Esiti aperti ricontrollano il laboratorio a metà (storici ${storici() - s1})`);
  extraLab = []; extraRis = [];
  await pW.locator("#psassist-host #refreset").click();   // qui sotto si riparte senza copie
  await pW.waitForTimeout(1200);
  await pW.close();
}

// Mentre un ordine lavora (qui: un altro paziente, la sua scheda viva) non
// parte niente; finito l'ordine, riprende da sé
{
  voli = []; maxInVolo = 0;
  const pX = await ctx.newPage();
  await pX.goto("about:blank");
  const [sw] = ctx.serviceWorkers();
  await sw.evaluate(async () => {
    const t = (await chrome.tabs.query({})).sort((a, b) => b.id - a.id)[0];   // la scheda appena aperta: la «scheda dell'ordine»
    await chrome.storage.session.set({ ordini: [{ id: "prova-ordine", ep: "999777", paziente: "ALTRO PROVA", stato: "corre", worker: t.id, opener: t.id,
      n: 1, ts: Date.now(), agg: Date.now(), vista: null, resto: { mancano: [], controllare: [], nel: [] } }] });
  });
  const pO = await ctx.newPage();
  await pO.goto(mock.patientUrl);
  await pO.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await pO.waitForTimeout(5000);
  check(voli.length === 0, `un ordine al lavoro: il caricamento da solo non parte (scaricati ${voli.length})`);
  await sw.evaluate(() => chrome.storage.session.set({ ordini: [] }));
  await salvati(pO, 4);
  check(voli.length === 4, `finito l'ordine, riprende da sé (scaricati ${voli.length})`);
  await pO.locator("#psassist-host #refreset").click();   // il «Salva» a mano, qui sotto, parte senza copie
  await pO.waitForTimeout(1200);
  await pO.close(); await pX.close();
}

// Il PDF scelto è di un altro paziente: errore grave, forte, sulla riga e nel
// registro degli errori (senza nomi); la copia non resta
const errori = async () => { const [s] = ctx.serviceWorkers(); return (await s.evaluate(() => chrome.storage.local.get("errori.v1")))["errori.v1"] || []; };
{
  const ID_ALTRO = "ffff9999-0000-0000-0000-000000000099";
  extra = [{ id: ID_ALTRO, quando: "2026-08-22 06:30:00.0" }];
  const pI = await ctx.newPage();
  await pI.goto(mock.patientUrl);
  await pI.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  const grave = await pI.waitForSelector(`#psassist-host [data-esito="${ID_ALTRO}"] .wuex.grave`, { timeout: 60000 }).then((el) => el.textContent()).catch(() => "");
  const salvato = await pI.locator(`#psassist-host [data-esito="${ID_ALTRO}"] .rdot.saved`).count();
  const voce = (await errori()).find((x) => x.tipo === "identita" && x.dati && x.dati.referto === ID_ALTRO);
  const testo = JSON.stringify(voce || {});
  check(grave === "Errore grave: questo PDF è di un altro paziente — non mostrato" && !salvato,
    `un PDF scelto di un altro paziente: «Errore grave…» sulla riga, e la copia non resta (got: ${grave || "niente"}${salvato ? ", salvato" : ""})`);
  check(!!voce && /nome/.test(voce.dati.via) && !/BIANCHI|ANNA|ROSSI|BNCNNA|\d{2}\/\d{2}\/\d{4}/.test(testo),
    `e nel registro degli errori: episodio, referto, perché — niente nomi né date (got: ${testo.slice(0, 200)})`);
  extra = [];
  await finito(pI);
  await pI.locator("#psassist-host #refreset").click();   // il «Salva» a mano, qui sotto, parte senza copie
  await pI.waitForTimeout(1200);
  await pI.close();
}

// «Salva i referti» sta negli Esiti, nella riga in cima: non più nel menu ⋯
voli = []; maxInVolo = 0;
const giaChiesti = mock.state.requests.filter((q) => eDoc(q.url)).length;
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
check(maxInVolo === 1, `uno alla volta (got ${maxInVolo})`);
const scaricati = mock.state.requests.filter((q) => eDoc(q.url)).length - giaChiesti;
check(scaricati === 4, `ogni referto scaricato una volta sola (got ${scaricati})`);
// «Salva referti» agisce solo su quelli che si vedono: il referto di
// laboratorio nascosto non viene nemmeno scaricato
check(mock.state.requests.filter((q) => q.url.includes("aaaa1111")).length === 0,
  "e il referto di laboratorio, che non si vede, non viene scaricato");
// salvati, se ne legge subito il testo: l'anteprima è sulla riga
await page.waitForFunction(() => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".wuimg .wuex").length >= 1, { timeout: 15000 }).catch(() => {});
check(JSON.stringify(await conAnteprima(page)) === JSON.stringify(["RX TORACE"]), "salvati a mano: il testo della radiografia si legge subito (l'anteprima sulla riga)");

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
// «Stampa» nel visore: senza stampa automatica, il dialogo del browser sul PDF della copia
{
  const prima = mock.state.requests.length;
  await visore.locator("#vstampa").click({ timeout: 3000 }).catch(() => {});
  const cornice = await page.waitForSelector("#psassist-stampa-referto", { state: "attached", timeout: 5000 }).then(() => true).catch(() => false);
  check((await visore.locator("#vstampa").count()) === 1 && cornice && mock.state.requests.length === prima,
    "«Stampa» nel visore: senza stampa automatica il dialogo del browser, dalla copia (nessuna richiesta)");
}
await visore.locator("#vchiudi").click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(300);
// (il laboratorio, raccolto sotto «Laboratorio», c'è quando lo storico non è arrivato: qui il portale non lo dà)
check(await visore.count() === 0 && await page.locator('#psassist-host [data-esito][data-kind="referto"]').count() - await page.locator('#psassist-host #reflab [data-esito]').count() === 4,
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
// laboratorio, uno alla volta, con una pausa prima di ognuno, e
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
  check(maxInVolo === 1, `uno alla volta (got ${maxInVolo})`);
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
let finestra = "";        // un portale che, avuto il PDF, lo apre da sé in una scheda nuova: "open" (window.open) | "link" (un link _blank)
let ritardo = 0;         // un portale lento: il PDF arriva dopo tanti ms
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
        x.onload = () => {
          if (${JSON.stringify(finestra)} === "open") { window.open("/clin-port/rest/documenti/1/contenuto?finestra=1", "_blank"); return; }
          if (${JSON.stringify(finestra)} === "link") {
            const a = document.createElement("a"); a.href = "/clin-port/rest/documenti/1/contenuto?finestra=1"; a.target = "_blank";
            document.body.appendChild(a); a.click(); return;
          }
          location.href = URL.createObjectURL(new Blob([x.response], { type: "application/pdf" }));
        };
        x.send();
      }, ${ritardo || (altroPrima ? 1200 : 300)});
    </script></body></html>` });
});
// Aprendo il paziente i referti non salvati si prendono da soli: la radiografia
// passa dal portale e il suo testo compare nel pannello.
// (le schede si contano prima: il caricamento da solo può aprire subito le sue dietro)
const schedePrima = ctx.pages().filter((p) => !p.isClosed()).length + 1;
const p2 = await ctx.newPage();
await p2.goto(mock.patientUrl);
await p2.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await p2.waitForSelector('#psassist-host [data-esito]', { timeout: 10000 });
const rxRiga = (p) => p.evaluate(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  const it = [...r.querySelectorAll(".wuimg .wuitem")].find((x) => /RX TORACE/.test(x.querySelector(".rlab")?.textContent || ""));
  return it ? { testo: it.querySelector(".reftxt")?.textContent || it.querySelector(".wuex")?.textContent || "", rosso: it.querySelector(".rrow.err")?.getAttribute("title") || "" } : {};
});
const rxPronta = (p) => p.waitForFunction(() => {
  const r = document.getElementById("psassist-host").shadowRoot;
  const it = [...r.querySelectorAll(".wuimg .wuitem")].find((x) => /RX TORACE/.test(x.querySelector(".rlab")?.textContent || ""));
  return !!it && !!(it.querySelector(".wuex") || it.querySelector(".rrow.err"));
}, null, { timeout: 90000 }).then(() => true).catch(() => false);
const letto = await rxPronta(p2);
await finito(p2);
const rx = await rxRiga(p2);
await p2.waitForTimeout(800);
const schedeDopo = ctx.pages().filter((p) => !p.isClosed()).length;
await p2.locator("#psassist-host #menubtn").click();   // il Registro, dal menu «⋯»
await p2.locator("#psassist-host #verbtn").click();
await p2.waitForSelector("#psassist-host .log", { state: "attached", timeout: 5000 }).catch(() => {});
const registro = await p2.evaluate(() => document.getElementById("psassist-host").shadowRoot.querySelector(".log")?.textContent || "");
check(letto && !rx.rosso && RIGHE_ESEMPIO.some((r) => String(rx.testo).includes(r)),
  `referto del portale, preso da solo: il testo nel pannello (got: ${rx.rosso ? "rosso — " + rx.rosso.slice(0, 160) : String(rx.testo).slice(0, 60)})`);
check(/lo apro nel portale, in una scheda dietro/.test(registro) && /testo letto \(\d+ righe, pdf\.js[;)]/.test(registro),
  `aperto nel portale, letto con pdf.js (${(/testo (?:letto|non letto)[^\n]*/.exec(registro) || ["niente nel registro"])[0].slice(0, 120)})`);
check(!chi.some((c) => c.startsWith("sw:")) && chi.some((c) => /loginPC\.jsp/.test(c)),
  `al portale ci va la pagina, mai il service worker (${chi.join(", ")})`);
check(schedeDopo === schedePrima, `le schede dietro si richiudono da sole (schede ${schedePrima} → ${schedeDopo})`);
await p2.close();

// Il portale mostra PRIMA il PDF di un altro paziente (rimasto aperto da prima),
// poi il nostro: si tiene il nostro, non il primo che passa. E se mostra solo
// quello dell'altro, non si tiene niente e lo si dice.
for (const modo of ["prima", "solo"]) {
  altroPrima = modo;
  const pA = await ctx.newPage();
  await pA.goto(mock.patientUrl);
  await pA.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
  await finito(pA);
  if (await pA.locator("#psassist-host #refreset").count()) { await pA.locator("#psassist-host #refreset").click(); await pA.waitForTimeout(600); }
  await pA.reload();   // senza le copie: si riprendono da sole, dal portale
  await pA.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
  await rxPronta(pA);
  await finito(pA);
  const r = await rxRiga(pA);
  if (modo === "prima") {
    check(!!r.testo && !r.rosso && !/BIANCHI|BNCNNA/.test(r.testo),
      `il portale mostra prima il referto di un altro paziente: si tiene il nostro (got: ${String(r.testo || r.rosso || "").slice(0, 90)})`);
  } else {
    check(!r.testo && /un altro paziente/.test(r.rosso || ""),
      `solo il referto di un altro paziente: niente testo, e il perché (got: ${String(r.testo || r.rosso).slice(0, 120)})`);
  }
  await pA.close();
}
altroPrima = "";

// Il portale, avuto il PDF, lo apre da sé in una scheda nuova. Con
// window.open, in una nostra scheda dietro, non parte proprio: la scheda sa da
// subito di essere nostra. Con un link che sfugge (qui: un <a target=_blank>)
// non passa davanti al medico (resta davanti la pagina del paziente), e si
// chiude da sola.
for (const modo of ["open", "link"]) {
  finestra = modo;
  const pF = await ctx.newPage();
  await pF.goto(mock.patientUrl);
  await pF.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
  await finito(pF);
  if (await pF.locator("#psassist-host #refreset").count()) { await pF.locator("#psassist-host #refreset").click(); await pF.waitForTimeout(600); }
  await pF.bringToFront();
  const [swF] = ctx.serviceWorkers();
  const davanti = () => swF.evaluate(() => chrome.tabs.query({ active: true }).then((l) => l.map((t) => t.url || t.pendingUrl || "")));
  const nate = [];
  const ascolta = (p) => nate.push(p);
  ctx.on("page", ascolta);
  await pF.reload();
  await pF.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
  if (modo === "open") {
    await rxPronta(pF);
    await finito(pF);
    const dopo = await davanti();
    const r = await rxRiga(pF);
    check(!nate.some((p) => /finestra=1/.test(p.url())) && dopo.length === 1 && /MVPG=PsoEpisodioClinicoAmbulatorio/.test(dopo[0]) && !!r.testo && !r.rosso,
      `il portale apre il PDF con window.open in una nostra scheda dietro: non si apre niente, il referto arriva (nate: ${nate.map((p) => p.url().slice(0, 50)).join(" | ") || "nessuna"}; davanti: ${dopo.map((u) => u.slice(0, 60)).join(" | ")})`);
  } else {
    const visti = [];
    for (const t0 = Date.now(); Date.now() - t0 < 20000 && !nate.some((p) => /finestra=1/.test(p.url())); ) { visti.push(...await davanti()); await pF.waitForTimeout(150); }
    await pF.waitForTimeout(1500);
    const dopo = await davanti();
    const aperta = nate.find((p) => /finestra=1/.test(p.url()));
    const diag = await swF.evaluate(() => Promise.all([chrome.tabs.query({}), chrome.storage.session.get(null)]).then(([l, ss]) => JSON.stringify({
      schede: l.map((t) => ({ id: t.id, o: t.openerTabId, a: t.active, u: (t.url || "").slice(0, 50) })),
      sotto: Object.entries(ss).filter(([k]) => k.startsWith("sotto:")).map(([k, v]) => [k, v.cosa, v.esito, v.opener]) })));
    check(!!aperta && dopo.length === 1 && /MVPG=PsoEpisodioClinicoAmbulatorio/.test(dopo[0]),
      `il portale apre il PDF in una scheda nuova: davanti resta la pagina del paziente (aperta: ${!!aperta}; davanti: ${dopo.map((u) => u.slice(0, 60)).join(" | ")}${dopo.length === 1 && /MVPG=PsoEpisodioClinicoAmbulatorio/.test(dopo[0]) ? "" : "; " + diag})`);
    const chiusa = !aperta || await aperta.waitForEvent("close", { timeout: 30000 }).then(() => true).catch(() => aperta.isClosed());
    check(chiusa, "e la scheda nuova si chiude da sola");
  }
  ctx.off("page", ascolta);
  finestra = "";
  await finito(pF);
  await pF.close();
}

// …ma solo quelle: una scheda del portale che il medico apre a mano (senza
// madre) subito dopo un nostro referto non si tocca, e una nostra scheda
// dietro aperta dalla scheda del ponte («Aggiorna i valori» dal telefono) non
// è un PDF da chiudere: resta finché ha finito.
{
  const pM = await ctx.newPage();
  await pM.goto(mock.patientUrl);
  await pM.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
  if (await pM.locator("#psassist-host #refreset").count()) { await pM.locator("#psassist-host #refreset").click(); await pM.waitForTimeout(600); }
  await pM.reload();
  await pM.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
  await rxPronta(pM);
  await finito(pM);   // un nostro referto appena letto, dal portale
  senzaPdf = true;    // (le due schede qui sotto: una pagina del portale qualunque)
  const mano = await ctx.newPage();
  await mano.goto("http://10.11.0.151:9080/clin-port/elenco-documenti");
  const pPonte = await ctx.newPage();
  await pPonte.goto("about:blank");
  const [sw] = ctx.serviceWorkers();
  const dietro = await sw.evaluate(async () => {
    const [p] = (await chrome.tabs.query({})).sort((a, b) => b.id - a.id);   // la scheda «del ponte»: l'ultima aperta
    await chrome.storage.session.set({ "ponte.valori": { [p.id]: { ep: "999001", ts: Date.now() } } });
    // come apriStoricoSotto: nasce vuota, si annota, poi va al portale
    const t = await chrome.tabs.create({ url: "about:blank", active: false, openerTabId: p.id, windowId: p.windowId });
    await chrome.storage.session.set({ ["sotto:" + t.id]: { opener: p.id, cosa: "storico", ep: "999001", nome: "X", ts: Date.now(), esito: "attesa" } });
    await chrome.tabs.update(t.id, { url: "http://10.11.0.151:9080/clin-port/info-cliniche/dati-clinici?prova=1" });
    return t.id;
  });
  await pM.waitForTimeout(23000);   // (il ripiego chiude dopo 20 secondi)
  const viva = await sw.evaluate((id) => chrome.tabs.get(id).then(() => true, () => false), dietro);
  check(viva, "una nostra scheda dietro aperta dalla scheda del ponte non viene chiusa come un PDF del portale");
  check(!mano.isClosed(), "una scheda del portale aperta a mano dal medico, subito dopo un nostro referto, non si tocca");
  await sw.evaluate((id) => Promise.all([chrome.storage.session.remove("ponte.valori"), chrome.tabs.remove(id).catch(() => {})]), dietro);
  senzaPdf = false;
  if (!mano.isClosed()) await mano.close();
  await pPonte.close();
  await pM.close();
}

// ---- UNA corsia per il portale, per tutto il browser: due schede dello
// stesso paziente (e lo storico) insieme, e mai due schede del portale che
// caricano nello stesso momento; ogni referto preso una volta sola, da una
// scheda sola, e salvato per tutte e due.
{
  const [sw] = ctx.serviceWorkers();
  const pA = await ctx.newPage();
  await pA.goto(mock.patientUrl);
  await pA.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
  await finito(pA);
  if (await pA.locator("#psassist-host #refreset").count()) { await pA.locator("#psassist-host #refreset").click(); await pA.waitForTimeout(600); }
  await pA.evaluate(() => { localStorage.removeItem("psassist:autoFalliti.v1"); localStorage.removeItem("psassist:autoCarica.v1"); });   // tutto da leggere
  const t0 = Date.now();
  let max = 0, fermo = false;
  const guarda = (async () => {
    while (!fermo) {
      const n = await sw.evaluate(() => chrome.storage.session.get(null).then((s) => Object.entries(s)
        .filter(([k, v]) => k.startsWith("sotto:") && v && (!v.cosa || v.cosa === "storico" || v.cosa === "referto") && v.esito === "attesa").length)).catch(() => 0);
      max = Math.max(max, n);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const pB = await ctx.newPage();
  await Promise.all([pA.reload(), pB.goto(mock.patientUrl)]);
  await Promise.all([pA.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 }), pB.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 })]);
  await Promise.all([salvati(pA, 4), salvati(pB, 4)]);
  await finito(pA); await finito(pB);
  fermo = true; await guarda;
  const nA = await pA.locator("#psassist-host .rdot.saved").count(), nB = await pB.locator("#psassist-host .rdot.saved").count();
  const ids = await sw.evaluate((t0) => chrome.storage.session.get(null).then((s) => Object.entries(s)
    .filter(([k, v]) => k.startsWith("sotto:") && v && v.cosa === "referto" && v.ts >= t0).map(([, v]) => v.id)), t0);
  const doppi = ids.filter((id, i) => ids.indexOf(id) !== i);
  check(max === 1, `due schede e lo storico insieme: al più una scheda del portale che carica alla volta (al massimo ${max})`);
  check(ids.length === 3 && !doppi.length, `ogni referto del portale in una scheda sola, chiunque l'abbia chiesto (${ids.length} schede, doppi ${doppi.length})`);
  const nonSalvati = (p) => p.evaluate(() => [...document.getElementById("psassist-host").shadowRoot.querySelectorAll('.wu [data-esito][data-kind="referto"]')]
    .filter((r) => !r.closest("#reflab") && !r.querySelector(".rdot.saved")).map((r) => `${r.getAttribute("data-esito").slice(0, 8)}: ${(r.querySelector(".rrow.err")?.getAttribute("title") || r.querySelector(".rdot")?.className || "").slice(0, 140)}`));
  check(nA === 4 && nB === 4, `e salvati per tutte e due (${nA} e ${nB}${nA === 4 && nB === 4 ? "" : `; non salvati: ${JSON.stringify([await nonSalvati(pA), await nonSalvati(pB)])}`})`);
  await pB.close();
  await pA.close();
}
// ---- un PDF che arriva appena dopo lo scadere della scheda si tiene lo
// stesso (qui la scheda scade dopo 4 secondi, il portale dà il PDF dopo 6)
{
  const [sw] = ctx.serviceWorkers();
  const pT = await ctx.newPage();
  await pT.goto(mock.patientUrl);
  await pT.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
  await finito(pT);
  if (await pT.locator("#psassist-host #refreset").count()) { await pT.locator("#psassist-host #refreset").click(); await pT.waitForTimeout(600); }
  ritardo = 6000;
  await sw.evaluate(() => { SOTTO_MAX = 4000; });
  await pT.reload();
  await pT.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
  await rxPronta(pT);
  await finito(pT);
  const r = await rxRiga(pT);
  await sw.evaluate(() => { SOTTO_MAX = 30000; });
  ritardo = 0;
  check(!!r.testo && !r.rosso, `il PDF arriva due secondi dopo lo scadere della scheda: si tiene lo stesso (got: ${String(r.rosso || r.testo || "niente").slice(0, 120)})`);
  await pT.close();
}

// …e se il portale il PDF non lo mostra: pallino rosso, il perché, e com'è
// fatta la sua pagina (niente del paziente) da copiare nella diagnosi
senzaPdf = true;
const p3 = await ctx.newPage();
await p3.goto(mock.patientUrl);
await p3.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
await finito(p3);
if (await p3.locator("#psassist-host #refreset").count()) { await p3.locator("#psassist-host #refreset").click(); await p3.waitForTimeout(800); }   // via le copie: si riapre il portale
await p3.reload();
await p3.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
const rosso = await p3.waitForSelector('#psassist-host .wuitem:has-text("TC ENCEFALO") .rrow.err', { state: "attached", timeout: 120000 }).then((el) => el.getAttribute("title")).catch(() => "");
check(/non si vede da qui/.test(rosso) && /portale \/clin-port\/loginPC\.jsp/.test(rosso) && /sguardo sì \(blob 0/.test(rosso) && !/abc123/.test(rosso),
  `senza PDF: il motivo e la pagina del portale, senza il token (got: ${String(rosso).slice(0, 220)})`);
{
  const v = (await errori()).find((x) => x.tipo === "referto" && /non si vede da qui/.test(x.dati?.motivo || ""));
  check(!!v && !/abc123|ROSSI|MARIO/.test(JSON.stringify(v)), `un referto non preso finisce nel registro degli errori, senza token né nomi (got: ${JSON.stringify(v || {}).slice(0, 160)})`);
}

// Quello che, preso da solo, non è riuscito non si riprova a ogni giro: gli
// Esiti riaperti non riaprono il portale (un tocco sì); i valori, falliti, si
// riprovano da soli al più dopo 2 minuti (e poi dopo 10), non a ogni apertura;
// e finché la tabella non c'è i referti del laboratorio restano in vista.
{
  const [sw] = ctx.serviceWorkers();
  const referti = (t0) => sw.evaluate((t0) => chrome.storage.session.get(null).then((s) => Object.entries(s)
    .filter(([k, v]) => k.startsWith("sotto:") && v && v.cosa === "referto" && v.ts >= t0).length), t0);
  await finito(p3);
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) {
    await p3.locator('#psassist-host [data-seg="richieste"]').click();
    await p3.locator('#psassist-host [data-seg="esiti"]').click();
    await p3.waitForTimeout(1200);
    await finito(p3);
  }
  const nuove = await referti(t0);
  check(nuove === 0, `un referto del portale non riuscito: gli Esiti riaperti 5 volte non riaprono il portale (schede nuove: ${nuove})`);
  const ep = new URL(mock.patientUrl).searchParams.get("EPISODIO_ID");
  const labFallito = () => p3.evaluate((ep) => (JSON.parse(localStorage.getItem("psassist:autoFalliti.v1") || "{}")[ep] || {}).lab || null, ep);
  check(!!(await labFallito()), "lo storico non è arrivato: il fallimento dei valori è annotato");
  const apri = async () => {
    const p = await ctx.newPage();
    await p.goto(mock.patientUrl);
    await p.waitForSelector("#psassist-host .wu", { state: "attached", timeout: 15000 });
    await p.waitForTimeout(1500);
    await finito(p);
    return p;
  };
  const lab = (fn) => p3.evaluate(([ep, fn]) => {   // (il tempo, da qui: si sposta solo il fallimento dei valori)
    const k = "psassist:autoFalliti.v1", t = JSON.parse(localStorage.getItem(k) || "{}");
    const r = t[ep] && t[ep].lab;
    if (r && fn === "ora") Object.assign(r, { ts: Date.now(), n: 1 });
    if (r && fn === "-3min") r.ts -= 3 * 60e3;
    localStorage.setItem(k, JSON.stringify(t));
  }, [ep, fn]);
  await lab("ora");   // fallito adesso, la prima volta
  const s0 = storici();
  const q1 = await apri();
  check(storici() === s0, `appena fallito, riaprire il paziente non rilegge i valori (storici ${storici() - s0})`);
  check(await q1.locator("#psassist-host #reflab [data-esito]").count() === 1,
    "lo storico non è arrivato: i referti del laboratorio restano in vista («Laboratorio»)");
  await q1.close();
  await lab("-3min");   // passano 3 minuti
  const q2 = await apri();
  await q2.close();
  const q3 = await apri();
  await q3.close();
  check(storici() === s0 + 1, `dopo 2 minuti i valori si riprovano da soli una volta, non a ogni apertura (storici ${storici() - s0})`);
}

// Le copie dei referti: un turno intero (30 qui) resta, non solo le ultime 25
{
  const [sw] = ctx.serviceWorkers();
  const n = await sw.evaluate(async () => {
    const o = {};
    for (let i = 0; i < 30; i++) o["ref:prova-" + i] = { data: "JVBERi0=", ts: Date.now() - i * 1000, size: 1, ep: "prova", pk: "" };
    await chrome.storage.local.set(o);
    await chrome.storage.local.remove("refIndice");   // (l'indice si ricostruisce da sé)
    potatoAlle = 0;
    await prune();
    const dopo = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("ref:prova-")).length;
    await chrome.storage.local.remove(Object.keys(o));
    return dopo;
  });
  check(n === 30, `30 referti salvati in un turno: restano tutti (got ${n})`);
}

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
  const VIA_LOCALE = ["patients.v1", "stanza.posti.v1", "stanza.ps.posti.v1", "stanza.alta.posti.v1", "aree.v1", "area.vai.v1", "stato.v1", "dafare.v1", "promemoria.v1", "note.v1", "segni.v1",
    "refVisti.v1", "refPortale", "daConfermare.v1", "quesiti", "quesiti.ts", "lastQ", "corsa.aperta.v1", "corsa.presidio.v1", "autoCarica.v1", "autoFalliti.v1", "smart.sync.v1", "dimessi.v1"];
  const RESTA_LOCALE = { "win.v1": null, "pillpos.v1": { left: 40, top: 40 }, "collapsed": false, "stanza.ps.v1": null, "stanza.alta.v1": null, "aree.opzioni.v1": { alta: { id: "00010001P", label: "AREA ALTA INTENSITA'" } }, "catalog.v1": null,
    "dimissioni.v1": { prova: { testo: "modello del medico" } }, "eo.v1": { prova: "EO del medico" }, "ordini.stampati": ["o1"], "attesaConferma.ms": 120000 };
  const VIA_SCHEDA = [`ris.${ep}.zz`, `visto.${ep}.zz`, `reftxt.${ep}.zz`, `log.${ep}`, `ui.${ep}`, "receipt.v1", "confirm.v1", "queue.v1",
    "print.v1", "cuori.v1", "richieste.nostre.v1", "registriOrdini.v1", "avviso.v1", "dimdraft.x", "eodraft.x"];
  const VIA_EXT = ["ref:zz", "storicoArch"], RESTA_EXT = ["portale", "stampa", "stampaEsito", "stampaMisura", "ponte.coppia", "ponte.host", "errori.v1"];   // (il registro degli errori resta)
  const VIA_SESS = ["apertura", "sotto:999", "ordine:o-fine"], RESTA_SESS = ["ponte", "ordiniVisti", "ordiniFogli", "stampaVerificata"];

  const pR = await ctx.newPage();
  await pR.goto(mock.patientUrl);
  await pR.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  await pR.locator('#psassist-host [data-seg="esiti"]').click();
  const pAltra = await ctx.newPage();   // un'altra scheda: anche la sua memoria se ne va
  await pAltra.goto(mock.patientUrl);
  await pAltra.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
  // (i referti che le due schede prendono da sole all'apertura: finiti prima di seminare)
  await finito(pR); await finito(pAltra);
  await pR.waitForTimeout(1500);
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
