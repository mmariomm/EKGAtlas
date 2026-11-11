#!/usr/bin/env node
/*
 * La build mini «PS Assist · Lettura e stampa» (sola lettura), tutto vero:
 * l'estensione mini caricata in Chromium (il manifest e la bandiera a parte,
 * come nello zip), il gestionale simulato, il ripetitore Node e l'app del
 * telefono in un secondo browser. Si controlla che:
 *  - la build mini si carica, col suo manifest (nome, chiave a parte, sola
 *    lettura, niente ricetta SISS);
 *  - sulla pagina del gestionale non c'è il pannello degli ordini, solo il
 *    distintivo «sola lettura»; ma le LETTURE per il telefono si fanno lo stesso;
 *  - il telefono associato al PC mini legge (elenco, esiti, cartella) e NON
 *    scrive: la testata dice «Sola lettura», e i controlli di scrittura (ordine,
 *    Salva cartella, ＋ Farmaco, Accetta) non ci sono;
 *  - la sua pagina (ponte.html) dice che è di sola lettura, con la versione.
 * Il rifiuto delle scritture mandate GREZZE nel canale è in ponte-cripto.mjs
 * (il service worker in una vm, sola lettura): qui si guarda il lato telefono.
 *   node test/ext-mini.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./gestionale-vero.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { manifestLettura, LETTURA_KEY } from "../tools/lettura.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "../public/ponte/cripto.js"));
const P = globalThis.PonteCripto;
const PROFILE = join("/tmp", "psa-mini-" + process.pid);
const MINI = join("/tmp", "psa-mini-ext-" + process.pid);   // la copia «sola lettura» dell'estensione
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\nmini: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function finche(fn, timeout = 20000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(150)) if (await fn()) return true;
  return false;
}

// ---- la copia «sola lettura» dell'estensione (come la prepara tools/dist.mjs) ----
rmSync(MINI, { recursive: true, force: true });
cpSync(join(root, "extension"), MINI, { recursive: true });
rmSync(join(MINI, "installata.json"), { force: true });
const baseMan = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));
writeFileSync(join(MINI, "manifest.json"), JSON.stringify(manifestLettura(baseMan), null, 2) + "\n");
writeFileSync(join(MINI, "sola-lettura.js"), "self.PSA_SOLA_LETTURA = true;\n");

sezione("il manifest della build mini");
const man = JSON.parse(readFileSync(join(MINI, "manifest.json"), "utf8"));
check(man.name === "PS Assist · Lettura e stampa", `il nome: «${man.name}»`);
check(man.key === LETTURA_KEY && man.key !== baseMan.key, "una chiave fissa, distinta da quella della build normale");
check(man.content_scripts[0].js[0] === "sola-lettura.js" && man.content_scripts[0].js[1] === "content.js", "sola-lettura.js è il primo content script, davanti a content.js");
check(!JSON.stringify(man.content_scripts).includes("ricetta-siss"), "la ricetta SISS (scrittura) è tolta dai content script");
check(man.options_ui && man.options_ui.page === "ponte.html", "la sua pagina è ponte.html (stato dell'associazione e aggiornamento)");

// ---- il ripetitore e il gestionale simulato -------------------------------
const relay = await avviaRelay({});
const CF_A = "RSSMRA60A01F205Z";
let A = createMock({ withResults: true, cf: CF_A });
const riquadro = (nome, ep, cf) => `<table><tr><td title="ARANCIONE"><font style="font-size: 120%; font-weight: bolder; ">${ep}</font><br><font style="font-size: 150%; font-weight: bolder; ">${nome}</font><br><font style="font-size: 120%; font-weight: bolder; ">17/05/1949 (77) M</font><br><font style="font-size: 120%; font-weight: bolder; ">${cf}</font></td></tr></table>`;
// chi è loggato nel gestionale (per la testata «Sola lettura · gestionale di …»)
const OPERATORE = "Salve! Sei connesso come Utente Medico: UTENTE1";

async function apriBrowser() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
    viewport: { width: 1366, height: 768 },
    args: [`--disable-extensions-except=${MINI}`, `--load-extension=${MINI}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean)],
  });
  await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
    const req = r.request();
    let out = A.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
    let h = 0;
    while (out.status === 302 && h++ < 5) out = A.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
    if (/html/.test(out.headers["content-type"] || "") && /MVPG=PsoEpisodioClinicoAmbulatorio|^[^?]*\?EPISODIO_ID/.test(req.url())) {
      let html = Buffer.from(out.body).toString("latin1");
      html = html.replace("<body>", `<body><b>${OPERATORE}</b>` + riquadro("ROSSI MARIO", A.state.episodeId, CF_A));
      out = { ...out, body: Buffer.from(html, "latin1") };
    }
    try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* scheda chiusa */ }
  });
  return ctx;
}
const ctx = await apriBrowser();
const sw = await (async () => ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || ctx.waitForEvent("serviceworker", { timeout: 15000 }))();
const extId = new URL(sw.url()).host;
const EXTURL = (f) => `chrome-extension://${extId}/${f}`;
const statoPonte = () => sw.evaluate(() => chrome.storage.session.get("ponte").then((o) => o.ponte || null));
const qrUrl = () => sw.evaluate(() => ponteQr());

// ---- la pagina del gestionale: niente pannello, solo il distintivo ---------
sezione("sulla pagina del gestionale: niente pannello degli ordini, solo il distintivo");
const doc = await ctx.newPage();
await doc.goto(A.patientUrl);
await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
await sospendi(500);
const badge = await doc.evaluate(() => {
  const r = document.getElementById("psassist-host")?.shadowRoot;
  if (!r) return { testo: "", card: 0, exp: 0 };
  return { testo: (r.querySelector(".b")?.textContent || "").replace(/\s+/g, " ").trim(), card: r.querySelectorAll(".card").length, exp: r.querySelectorAll("#expand, #menubtn, #ordina").length };
});
check(/sola lettura/i.test(badge.testo), `il distintivo dice «sola lettura» (${badge.testo})`);
check(badge.card === 0 && badge.exp === 0, "niente pannello degli ordini: nessuna finestra, nessun bottone «ordina»");
// la lettura per il telefono: aperta la pagina, il paziente è nell'elenco del PC
check(await finche(async () => {
  const p = await doc.evaluate(() => JSON.parse(localStorage.getItem("psassist:patients.v1") || "[]"));
  return Array.isArray(p) && p.some((x) => x.ep === String(A.state.episodeId));
}, 8000), "le letture per il telefono si fanno lo stesso: il paziente aperto entra in patients.v1");

// ---- il telefono associato al PC mini -------------------------------------
sezione("il telefono associato a un PC di sola lettura");
// la pagina propria della build mini: ponte.html dice che è di sola lettura
const pag = await ctx.newPage();
await pag.goto(EXTURL("ponte.html"));
await pag.waitForSelector("#stato b", { timeout: 8000 });
check(/sola lettura/i.test(await pag.locator(".sub").innerText()), "la sua pagina dice che il PC è di sola lettura");
check(/Versione \d|Aggiornato alla versione/i.test(await pag.locator("#aggrow").innerText().catch(() => "")), "…e mostra la versione (si aggiorna da solo)");
// si associa dalla sua pagina (non c'è un pannello): verso il ripetitore locale
await sw.evaluate((u) => chrome.storage.local.set({ "ponte.host": u }).then(() => ponteAvvia()), relay.url);
await pag.reload();
await pag.waitForSelector("#associa", { timeout: 8000 });
await pag.locator("#associa").click();
await pag.waitForSelector("#qr svg", { timeout: 8000 });
const url1 = await qrUrl();
check(url1.startsWith(relay.url + "/ponte/#k="), `la build mini mostra il suo QR (${url1.slice(0, 36)}…)`);
check(await finche(async () => (await statoPonte())?.relay === "su", 10000), "il PC mini è collegato al ponte");

// il telefono, in un secondo browser
const telBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
const telCtx = await telBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "it-IT" });
await telCtx.routeWebSocket(/\/ponte\/ws/, (ws) => { const s = ws.connectToServer(); ws.onMessage((m) => s.send(m)); s.onMessage((m) => ws.send(m)); ws.onClose((c, r) => s.close(c >= 3000 && c <= 4999 ? { code: c, reason: r } : {})); s.onClose((c, r) => ws.close(c >= 3000 && c <= 4999 ? { code: c, reason: r } : {})); });
const tel = await telCtx.newPage();
const testoTel = () => tel.locator("#app").innerText().catch(() => "");
const aspettaTel = async (re, t = 20000) => (await finche(async () => re.test(await testoTel()), t)) ? testoTel() : "";
await tel.goto(url1);
check(/ROSSI MARIO/.test(await aspettaTel(/ROSSI MARIO/, 20000)), "inquadrato il QR: l'elenco dei pazienti del PC mini (la lettura funziona)");
// il tipo del PC è «sola lettura» (dal saluto), salvato nella lista
const kindTel = await tel.evaluate(() => { const o = JSON.parse(localStorage.getItem("psassist.ponte.pcs.v1") || "null"); const a = o && o.v.find((p) => p.id === o.attivo); return a ? a.kind : ""; });
check(kindTel === "lettura", `il telefono sa che il PC è di sola lettura (kind: ${kindTel})`);
// la testata quieta «Sola lettura · gestionale di …»
check(await finche(async () => /Sola lettura/i.test(await tel.locator(".solabar").innerText().catch(() => "")), 8000), "la testata del telefono dice «Sola lettura»");
check(/UTENTE1/.test(await tel.locator(".solabar").innerText().catch(() => "")), "…con l'operatore loggato nel gestionale (informativo), letto dalla pagina");

// si apre il paziente: le viste ci sono, ma i controlli di scrittura no
await tel.locator('[data-a="paz"]').first().click().catch(() => {});
await aspettaTel(/ROSSI MARIO/, 8000);
// Richieste: il catalogo si vede, ma niente bottone «Conferma e stampa»
await tel.locator('[data-a="scheda"][data-s="richieste"]').click().catch(() => {});
await sospendi(600);
const haOrdina = await tel.locator('[data-a="ordina"]').count();
check(haOrdina === 0, "nelle Richieste non c'è il bottone «Conferma e stampa» (sola lettura)");
// Cartella: si legge, ma niente «Salva» e i campi sono di sola lettura
await tel.locator('[data-a="scheda"][data-s="cartella"]').click().catch(() => {});
await aspettaTel(/Anamnesi|Letto sul PC|Cartella/, 10000);
const csalva = await tel.locator('[data-a="csalva"]').count();
const scrivibili = await tel.evaluate(() => [...document.querySelectorAll(".cc textarea")].filter((t) => !t.readOnly).length);
check(csalva === 0, "nella Cartella non c'è «Salva» (sola lettura)");
check(scrivibili === 0, "…e i campi della cartella sono di sola lettura");
// nel menu: niente «Registrazioni» (scritture); «Stampa PDF» resta, e «📷 Scansiona il QR» c'è anche qui (per aggiungere il PC completo)
await tel.locator('[data-a="menu"]').click().catch(() => {});
await sospendi(300);
const menu = await tel.locator(".menu").innerText().catch(() => "");
check(!/Registrazioni/.test(menu) && /Stampa PDF/.test(menu) && await tel.locator('.menu [data-a="scansiona"]').innerText().catch(() => "") === "📷 Scansiona il QR",
  `nel menu niente «Registrazioni»; «Stampa PDF» resta, e «📷 Scansiona il QR» c'è anche su un PC di sola lettura (${menu.replace(/\n+/g, " · ")})`);
await tel.locator('[data-a="menu"]').click().catch(() => {});
// il QR di una stazione di stampa, inquadrato con il PC di sola lettura attivo: la carta dice di passare al PC completo, niente «Collega»
await tel.evaluate(() => { location.hash = `sta=${"A".repeat(87)}.${"B".repeat(22)}.${Date.now() + 600e3}&nome=Infermeria`; });
const cartaSta = await finche(async () => /sola lettura: la stampante si collega al PC completo/.test(await tel.locator(".stcarta").innerText().catch(() => "")), 8000);
check(cartaSta && await tel.locator('[data-a="stacollega"]').count() === 0, "il QR di una stazione con un PC di sola lettura: «la stampante si collega al PC completo», niente «Collega»");

await telCtx.close().catch(() => {});
await telBrowser.close().catch(() => {});
await ctx.close().catch(() => {});
await relay.chiudi?.().catch?.(() => {}) ?? relay.close?.();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(MINI, { recursive: true, force: true });
console.log(fail ? `\nMINI: ${fail} CHECK FALLITI\n` : "\nMINI: TUTTO OK\n");
process.exit(fail ? 1 : 0);
