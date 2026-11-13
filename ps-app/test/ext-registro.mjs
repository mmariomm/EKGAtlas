#!/usr/bin/env node
/*
 * Il registro dei PC (⋯ → Dispositivi sul telefono), tutto vero: due profili di Chromium con l'estensione
 * (il PC «Box 3», associato al telefono, e «Triage», non associato), il gestionale simulato, il ripetitore
 * Node, e l'app del telefono in un contesto da iPhone.
 *   - ogni PC si annuncia con un POST (nessuna presa: il PC non associato non entra mai nel ripetitore);
 *   - da fermo non si ripete: 30 risvegli del gestionale, nessun annuncio in più;
 *   - il telefono vede il suo PC («Associato a questo iPhone») e l'altro («Non associato»), con la versione;
 *   - «Non comparire nella lista» toglie la riga.
 *   node test/ext-registro.mjs        (TEST_SHOTS_DIR=… per la foto da iPhone)
 */
import { chromium } from "playwright";
import { createMock } from "./gestionale-vero.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, rmSync } from "node:fs";

const RETE_CHIUSA = ["--proxy-server=direct://", "--host-resolver-rules=MAP * 127.0.0.1"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "../public/ponte/cripto.js"));
const P = globalThis.PonteCripto;
const EXT = join(root, "extension");
const SHOTS = process.env.TEST_SHOTS_DIR || "";
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) if (existsSync(p) && statSync(p).isFile()) return p;
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\nregistro: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function finche(fn, timeout = 20000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(100)) { const v = await fn(); if (v) return v; }
  return null;
}
const relay = await avviaRelay({});
const annunci = () => relay.richiesteRegistro().filter((x) => x.p === "/ponte/registro");
const args = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean), ...RETE_CHIUSA];

async function pc(nome) {
  const profilo = join("/tmp", `psa-registro-${nome}-${process.pid}`);
  rmSync(profilo, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(profilo, { headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(), viewport: { width: 1280, height: 760 }, args });
  const G = createMock({});
  await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
    const req = r.request();
    let out = G.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
    let h = 0;
    while (out.status === 302 && h++ < 5) out = G.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
    try { await r.fulfill({ status: out.status, headers: out.headers, body: out.body }); } catch { /* chiusa */ }
  });
  const sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  await sw.evaluate((host) => chrome.storage.local.set({ "ponte.host": host }), relay.url);
  return { ctx, sw, G, profilo };
}

// ---- il PC «Box 3», associato (la coppia della 3.86, come in ext-fuori) e «Triage», no
sezione("due PC con PS Assist si annunciano");
const A = await pc("a"), B = await pc("b");
const K = P.casuale(32), stanza = (await P.chiaviCoppia(K)).stanza, DEV = "telefonofinto0001";
await A.sw.evaluate(({ k, dev }) => chrome.storage.local.set({ "ponte.nomePc": "Box 3", "ponte.coppia": { k, creata: Date.now() - 3600e3, usata: true, dev, nTel: "" } }), { k: P.b64u(K), dev: DEV });
await A.sw.evaluate(() => ponteAvvia());
await B.sw.evaluate(() => chrome.storage.local.set({ "ponte.nomePc": "Triage" }));
const docA = await A.ctx.newPage(); await docA.goto(A.G.patientUrl);
const docB = await B.ctx.newPage(); await docB.goto(B.G.patientUrl);
const due = await finche(() => Object.values(relay.elencoPc()).length === 2 && Object.values(relay.elencoPc()).some((r) => r.tel), 45000);
const el = Object.values(relay.elencoPc());
const ra = el.find((r) => r.nome === "Box 3"), rb = el.find((r) => r.nome === "Triage");
check(!!due && ra && rb, `tutti e due nel registro (${el.map((r) => r.nome).join(", ")})`);
const tagA = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ps-registro/tel|" + stanza))).subarray(0, 16).toString("base64url");
check(ra && ra.tel === tagA && ra.kind === "pc" && /^\d+\.\d+/.test(ra.ver || ""), "«Box 3»: l'impronta della stanza del suo telefono, il tipo, la versione");
check(rb && !rb.tel && !rb.sta && !rb.stz, "«Triage»: nessuna associazione");
check(JSON.stringify(el).length < 600 && !/RSSMRA|ROSSI|Medico|operatore/i.test(JSON.stringify(el)), "niente pazienti, niente operatore");
await finche(() => relay.prese().pc === 1, 15000);
check(relay.entrate().pc === 1 && relay.entrate().tel === 0, `l'annuncio non apre prese: solo «Box 3», associato, entra nel ripetitore (entrate ${JSON.stringify(relay.entrate())})`);

sezione("da fermo non si ripete");
const n0 = annunci().length, e0 = relay.entrate().pc;
for (let i = 0; i < 30; i++) {
  await docA.evaluate(() => chrome.runtime.sendMessage({ t: "ponteSveglia" }).catch(() => null)).catch(() => {});
  await docB.reload();
}
await sospendi(1500);
check(annunci().length === n0, `30 risvegli (pagine del gestionale ricaricate): nessun annuncio in più (${annunci().length - n0})`);
check(relay.entrate().pc === e0, "…e nessuna presa nuova");

sezione("il telefono vede tutti i PC, e quali sono associati");
const tel = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(), args: (process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean) });
const tctx = await tel.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "it-IT",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
const t = await tctx.newPage();
await t.goto(relay.url + "/ponte/");
await t.evaluate(({ k, dev }) => localStorage.setItem("psassist.ponte.pcs.v1", JSON.stringify({ v: [{ k, dev, id: "pcA", kind: "completo", nome: "Box 3" }], attivo: "pcA" })), { k: P.b64u(K), dev: DEV });
await t.reload();
await finche(() => t.locator("[data-a=menu]").count(), 15000);
await sospendi(1500);
await t.locator("[data-a=menu]").first().click();
await t.locator("[data-a=dispositivi]").first().click();
const testo = await finche(async () => { const s = await t.locator("#app").innerText().catch(() => ""); return /Triage/.test(s) && /Associato a questo iPhone/.test(s) ? s : null; }, 20000);
console.log((testo || await t.locator("#app").innerText().catch(() => "")).split("\n").filter(Boolean).map((x) => "    | " + x).join("\n"));
check(!!testo && /Collegati a questo iPhone[\s\S]*Box 3[\s\S]*Altri PC con PS Assist[\s\S]*Triage/i.test(testo), "due gruppi: il PC di questo iPhone, poi gli altri");
check(!!testo && /Non associato/.test(testo) && /adesso/.test(testo) && (testo.match(/Box 3/g) || []).length === 1, "«Triage»: Non associato · adesso; «Box 3» una volta sola (riconosciuto dall'impronta)");
const lett = relay.richiesteRegistro().filter((x) => x.p === "/ponte/registro/elenco");
check(lett.length >= 1 && lett.every((x) => x.stato === 200), `il telefono legge l'elenco con la prova della sua associazione (${lett.map((x) => x.stato).join(" ")})`);
await t.locator('[data-a=regpc]').first().click();
check(/Scansiona il QR sul PC/.test(await t.locator("#app").innerText()), "un tocco su un PC non associato: come collegarlo");
if (SHOTS) await t.screenshot({ path: join(SHOTS, "registro-dispositivi.png") });

sezione("dalla schermata d'errore: «Dispositivi»");
{
  // un telefono associato a un PC che non c'è: la schermata piena, e il bottone apre la stessa lista
  const t2 = await tctx.newPage();
  await t2.goto(relay.url + "/ponte/?x=2");
  await t2.evaluate(({ k }) => { localStorage.clear(); localStorage.setItem("psassist.ponte.pcs.v1", JSON.stringify({ v: [{ k, dev: "telefonofinto0002", id: "pcX", kind: "completo", nome: "Spento" }], attivo: "pcX" })); }, { k: P.b64u(P.casuale(32)) });
  await t2.reload();
  const b = t2.locator("[data-a=dispositivi]").first();
  check(!!(await finche(() => b.isVisible().catch(() => false), 20000)), `«Dispositivi» sulla schermata senza sessione («${(await t2.locator("#app h1").first().innerText().catch(() => "")).trim()}»)`);
  const l0 = relay.richiesteRegistro().length;
  await b.click();
  const s = await finche(async () => { const x = await t2.locator("#app").innerText().catch(() => ""); return /Spento/.test(x) && /Indietro/.test(x) ? x : null; }, 15000);
  check(!!s && /Collegati a questo iPhone/i.test(s), "…apre la stessa lista, con «‹ Indietro»");
  check(relay.richiesteRegistro().length - l0 <= 1, "…una lettura sola del registro, al tocco");
  await t2.close();
}

sezione("«Non comparire nella lista»");
const pag = await B.ctx.newPage();
await pag.goto(`chrome-extension://${new URL(B.sw.url()).host}/ponte.html`);
check((await pag.locator("#nomepc").inputValue()) === "Triage", "la pagina iPhone mostra il nome del PC");
const n1 = annunci().length;
await pag.locator("#nolista").check();
check(!!(await finche(() => !Object.values(relay.elencoPc()).some((r) => r.nome === "Triage"), 90000)), `la riga se ne va (${annunci().length - n1} annuncio)`);

await tel.close(); await A.ctx.close(); await B.ctx.close(); await relay.chiudi();
for (const x of [A, B]) rmSync(x.profilo, { recursive: true, force: true });
console.log(fail ? `\nREGISTRO: ${fail} FALLITI` : "\nREGISTRO: TUTTO OK");
process.exit(fail ? 1 : 0);
