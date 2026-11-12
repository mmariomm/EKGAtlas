#!/usr/bin/env node
/*
 * Le chiavi a riposo e il telefono contro un PC finto (3.87), nel browser: le
 * prove dell'audit (ponte-chiave, telefono-probe) diventate controlli.
 *   1. L'estensione vera in Chromium, col gestionale simulato e il ripetitore
 *      Node: uno script nella pagina del gestionale (il mondo isolato
 *      dell'estensione) non trova chiavi né in storage.local né in
 *      storage.session; la chiave sta nella cassa (IndexedDB del service
 *      worker) e non si esporta; con la sola chiave del QR, finita la sua
 *      finestra, nessuno prende il posto del telefono.
 *   2. L'app vera del telefono (servita dal ripetitore Node con le intestazioni
 *      del Worker) contro PC finti scritti qui (il protocollo vero, cripto.js):
 *      la chiave in IndexedDB non estraibile e non in localStorage; la chiave si
 *      rinnova alla prima sessione; un QR che vale 30 giorni non si usa; un QR
 *      nuovo che sostituirebbe il PC di prima chiede prima; «Scollega» lo dice
 *      al PC; in sottofondo l'app si copre.
 * Dati inventati; mai la rete vera.
 *   PSA_CHROMIUM_ARGS="--disable-features=PdfOopif --disable-dev-shm-usage" node test/ext-sicurezza.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./gestionale-vero.mjs";
import { avviaRelay } from "../ponte/relay-node.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync } from "node:fs";
import { webcrypto } from "node:crypto";

const RETE_CHIUSA = ["--proxy-server=direct://", "--host-resolver-rules=MAP * 127.0.0.1"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "../public/ponte/cripto.js"));
const P0 = globalThis.PonteCripto;
// (le chiavi d'entrata, la prova e il rinnovo rifatti qui, con WebCrypto: il test non si fida del codice che prova)
const S = webcrypto.subtle, TE = new TextEncoder(), SALE = TE.encode("ps-ponte/1");
const hkdf = async (k, sale, info, n) => new Uint8Array(await S.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sale, info: TE.encode(info) },
  k.algorithm ? k : await S.importKey("raw", k, "HKDF", false, ["deriveBits"]), n * 8));
const P = {
  ...P0,
  chiaviEntra: async (k) => Object.fromEntries(await Promise.all(["pc", "tel", "medico", "stazione"].map(async (r) => [r, P0.b64u(await hkdf(k, SALE, "entra " + r, 32))]))),
  provaEntra: async (c, sfida) => P0.b64u(new Uint8Array(await S.sign("HMAC", await S.importKey("raw", P0.daB64u(c), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), TE.encode("ps-ponte/entra|" + sfida)))),
  coppiaEcdh: async () => { const e = await S.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]); return { privata: e.privateKey, pub: new Uint8Array(await S.exportKey("raw", e.publicKey)) }; },
  // (P2-3: il legame — nTel, nPc, la stanza del QR — nel sale)
  legame: (nTel, nPc, stanza) => new Uint8Array([...P0.daB64u(nTel), ...P0.daB64u(nPc), ...Buffer.from(stanza, "hex")]),
  rinnova: async (k, priv, pubAltro, pubTel, pubPc, legame) => {
    const z = new Uint8Array(await S.deriveBits({ name: "ECDH", public: await S.importKey("raw", pubAltro, { name: "ECDH", namedCurve: "P-256" }, false, []) }, priv, 256));
    return hkdf(k, new Uint8Array([...SALE, ...z, ...pubTel, ...pubPc, ...legame]), "rinnova 2", 32);
  },
};
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-sicurezza-" + process.pid);
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) if (existsSync(p) && statSync(p).isFile()) return p;
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\nsicurezza: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function finche(fn, ms = 15000) { for (const t0 = Date.now(); Date.now() - t0 < ms; await sospendi(120)) { const v = await fn(); if (v) return v; } return null; }
const ARGS = (process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean);

const relay = await avviaRelay({});
const WS = relay.url.replace(/^http/, "ws");

// Un telefono in Node (o un estraneo che ha la chiave): la prova d'entrata, il saluto, i comandi
async function telNode(k, dev, { cambio = false } = {}) {
  const ch = await P.chiaviCoppia(k), entra = (await P.chiaviEntra(k)).tel;
  const ws = new WebSocket(`${WS}/ponte/ws?r=${ch.stanza}&ruolo=tel`);
  ws.binaryType = "arraybuffer";
  const coda = [];
  let pari = false, chiusa = 0;
  ws.onmessage = async (e) => {
    if (typeof e.data === "string") {
      const m = JSON.parse(e.data);
      if (m.sfida) ws.send(JSON.stringify({ prova: [await P.provaEntra(entra, m.sfida)] }));
      if (typeof m.pari === "boolean") pari = m.pari;
      return;
    }
    coda.push(new Uint8Array(e.data));
  };
  ws.onclose = (e) => { chiusa = e.code || 1; };
  await new Promise((ok) => { ws.onopen = ok; ws.onerror = ok; });
  await finche(() => pari || chiusa, 5000);
  if (!pari) return { ws, fuori: chiusa || true };
  const nTel = P.casuale(16);
  ws.send(await P.sigilla(ch.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: P.b64u(nTel), dev, ...(cambio ? { cambio: true } : {}) }));
  const r = await finche(async () => {
    for (const f of coda.splice(0)) { try { const m = (await P.apri(ch.salutoPc, f, P.TIPO.SALUTO_PC)).dati; if (m.eco === P.b64u(nTel)) return m; } catch { /* altro */ } }
    return null;
  }, 3000);
  // (il primo messaggio della sessione: il PC la apre, e il telefono è quello dell'associazione)
  if (r && r.n) { const c = P.canaleTel(await P.chiaviSessione(k, nTel, P.daB64u(r.n))); ws.send(await c.cifra({ id: 1, cmd: "ciao" })); await sospendi(400); }
  return { ws, risposta: r };
}

// ============================================================ 1. l'estensione
sezione("le chiavi a riposo, sul PC (ponte-chiave)");
const A = createMock({ withResults: true, cf: "RSSMRA60A01F205Z" });
rmSync(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...ARGS, ...RETE_CHIUSA],
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  let out = A.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
  let h = 0; while (out.status === 302 && h++ < 5) out = A.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
  await r.fulfill({ status: out.status, headers: out.headers, body: out.body }).catch(() => {});
});
const sw = ctx.serviceWorkers().find((w) => w.url().endsWith("bg.js")) || await ctx.waitForEvent("serviceworker");
const extId = new URL(sw.url()).host;
await sw.evaluate((u) => chrome.storage.local.set({ "ponte.host": u }).then(() => ponteAvvia()), relay.url);
const doc = await ctx.newPage();
await doc.goto(A.patientUrl);
await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 20000 });
const pagina = await ctx.newPage();
await pagina.goto(`chrome-extension://${extId}/ponte.html`);
const ass = await pagina.evaluate(() => chrome.runtime.sendMessage({ t: "ponteAssocia" }));
const kQr = P.leggiFrammento(new URL(ass.qr).hash).k;
// una stazione di stampa su questo stesso PC: il QR (l'offerta), con la sua chiave privata
await pagina.goto(`chrome-extension://${extId}/stazione.html`);
await pagina.evaluate(() => chrome.runtime.sendMessage({ t: "stazioneOfferta" }));
const devA = P.b64u(P.casuale(16));
await finche(() => sw.evaluate(() => pt.presa.su), 10000);
const legit = await telNode(kQr, devA);
check(!!(legit.risposta && legit.risposta.n), "il telefono del medico entra col QR (con la prova d'entrata nella stanza)");
legit.ws.close();
await sospendi(300);
// uno script nella scheda del gestionale (il mondo isolato dell'estensione: legge storage.local e storage.session)
const [tab] = await sw.evaluate(() => chrome.tabs.query({ url: "https://smarthealth.multimedica.it/*" }).then((l) => l.map((t) => t.id)));
const letto = await sw.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED",
  func: async () => JSON.stringify({ locale: await chrome.storage.local.get(null), sessione: await chrome.storage.session.get(null) }) }).then((x) => x[0].result), tab);
const visto = JSON.parse(letto);
const bQr = P.b64u(kQr), coppia = visto.locale["ponte.coppia"] || {};
check(!!coppia.stanza && !("k" in coppia) && !letto.includes(bQr), "uno script nella pagina del gestionale: in storage.local la coppia c'è, ma senza la chiave (nemmeno quella del QR)");
check(!/"priv"|"jwk"|"kty"|"d":"/.test(letto) && !("stazione.offerta" in visto.sessione), "…e in storage.session niente chiavi private (l'offerta della stazione non c'è più)");
check(!/"k":"[A-Za-z0-9_-]{43}"/.test(JSON.stringify(visto.sessione)), "…né la chiave dell'associazione accanto alla sessione (`ponte.sessione` porta solo l'id della chiave)");
const cassa = await sw.evaluate(async () => {
  if (typeof cassaLeggi !== "function") return {};   // (la 3.86: nessuna cassa)
  const x = await cassaLeggi("ponte"), o = await cassaLeggi("stazione.offerta");
  let esportata = true;
  try { await crypto.subtle.exportKey("raw", x.k); } catch { esportata = false; }
  let esportataPriv = true;
  try { await crypto.subtle.exportKey("jwk", o.priv); } catch { esportataPriv = false; }
  return { tipo: x.k.algorithm.name, estraibile: x.k.extractable, esportata, priv: !!o && o.priv.extractable, esportataPriv, raw: "qrRaw" in x };
});
check(cassa.tipo === "HKDF" && cassa.estraibile === false && !cassa.esportata && !cassa.raw,
  "la chiave sta nella cassa (IndexedDB del service worker): una CryptoKey HKDF non estraibile (exportKey fallisce), e i byte del QR non ci sono più (il telefono è entrato)");
check(cassa.priv === false && !cassa.esportataPriv, "la chiave privata dell'offerta della stazione: nella cassa, non estraibile");
// con la sola chiave del QR, finita la sua finestra (qui: un'ora dopo), nessuno prende il posto
await sw.evaluate(async () => { const c = (await chrome.storage.local.get("ponte.coppia"))["ponte.coppia"]; await chrome.storage.local.set({ "ponte.coppia": { ...c, creata: Date.now() - 3600e3 } }); await ponteAvvia(); });
await sospendi(500);
const ladro = await telNode(kQr, P.b64u(P.casuale(16)), { cambio: true });
const dev2 = (await sw.evaluate(() => chrome.storage.local.get("ponte.coppia").then((o) => o["ponte.coppia"].dev)));
check((!ladro.risposta || !!ladro.risposta.no) && dev2 === devA, `la chiave del QR, un'ora dopo, con «Usa questo telefono»: ${ladro.fuori ? "non entra nella stanza" : ladro.risposta ? "«no»" : "nessuna risposta"} — il telefono resta quello del medico`);
ladro.ws.close();
await ctx.close();

// ============================================================ 2. il telefono
sezione("il telefono contro un PC finto (telefono-probe)");
// Un PC finto, col protocollo vero: la prova d'entrata (registra la sua e quella del telefono), il saluto,
// `rinnova`, e il saluto con la chiave nuova che la fa sua. `risposte`: cmd → dati. Le opzioni: `altro` (false: non dà
// alla stanza la chiave del telefono — il telefono entra senza «entrato», nel passaggio), `perde` (risponde a
// `rinnova` ma la chiave nuova non la tiene: il telefono la saluta e nessuno risponde), `sposta` (rinnovata la
// chiave, passa alla stanza che nasce da lei, come il PC vero fuori dalla finestra del QR).
function pcFinto(nome, risposte, { altro = true, perde = false, sposta = false } = {}) {
  const kQr = P.casuale(32), pc = { k: kQr, kQr, comandi: [], saluti: [], rinnovata: false };
  let ws = null, canale = null;
  const apri = async () => {
    const ch0 = await P.chiaviCoppia(pc.k), e0 = await P.chiaviEntra(pc.k);
    pc.stanzaOra = ch0.stanza;
    if (!pc.stanza) pc.stanza = ch0.stanza;   // (la stanza del QR: quella del legame del rinnovo)
    if (ws) { ws.onmessage = null; ws.close(); }
    ws = new WebSocket(`${WS}/ponte/ws?r=${ch0.stanza}&ruolo=pc`);
    ws.binaryType = "arraybuffer";
    ws.onmessage = async (e) => {
      if (typeof e.data === "string") {
        const m = JSON.parse(e.data);
        if (m.sfida) ws.send(JSON.stringify({ prova: [await P.provaEntra(e0.pc, m.sfida)], chiave: e0.pc, ...(altro ? { altro: [e0.tel] } : {}) }));
        return;
      }
      const b = new Uint8Array(e.data), h = P.leggiTestata(b);
      if (!h) return;
      if (h.tipo === P.TIPO.SALUTO_TEL) {
        let m = null, k = null;
        for (const kk of [pc.k, pc.prossima].filter(Boolean)) { try { m = (await P.apri((await P.chiaviCoppia(kk)).salutoTel, b, P.TIPO.SALUTO_TEL)).dati; k = kk; break; } catch { /* altra */ } }
        if (!m) return;
        const spostati = k === pc.prossima && sposta;
        if (k === pc.prossima) { pc.k = pc.prossima; pc.prossima = null; pc.rinnovata = true; }
        pc.saluti.push(m);
        const nPc = P.casuale(16);
        canale = P.canalePc(await P.chiaviSessione(k, P.daB64u(m.n), nPc)); pc.nTel = m.n; pc.nPc = P.b64u(nPc);
        ws.send(await P.sigilla((await P.chiaviCoppia(k)).salutoPc, P.TIPO.SALUTO_PC, 0, { v: 1, n: P.b64u(nPc), eco: m.n, ora: Date.now() }));
        if (spostati) setTimeout(() => apri().catch(() => {}), 300);
        return;
      }
      if (h.tipo !== P.TIPO.DATI_TEL || !canale) return;
      let d;
      try { d = await canale.decifra(b); } catch { return; }
      pc.comandi.push(d.cmd);
      let out;
      if (d.cmd === "rinnova") {
        const e = await P.coppiaEcdh();
        const k2 = await P.rinnova(pc.k, e.privata, P.daB64u(d.pub), P.daB64u(d.pub), e.pub, P.legame(pc.nTel, pc.nPc, pc.stanza));
        if (!perde) pc.prossima = k2;
        out = { re: d.id, ok: true, dati: { pub: P.b64u(e.pub) } };
      } else {
        const r = risposte[d.cmd];
        out = r === undefined ? { re: d.id, ok: false, errore: "Comando sconosciuto" } : { re: d.id, ok: true, dati: r };
      }
      ws.send(await canale.cifra(out));
    };
    await new Promise((ok) => { ws.onopen = ok; });
  };
  pc.pronto = apri();
  pc.link = (scade) => `${relay.url}/ponte/#${P.frammento(pc.k, scade)}`;
  return pc;
}
const RISPOSTE = (nome, paz) => ({ ciao: { kind: "completo", nome, versione: "3.87.0" }, pazienti: [{ ep: "123", nome: paz, breve: paz, triage: "VERDE", eta: 50, posto: "OBI 2", ordina: true }],
  richieste: { gruppi: [], nomi: {}, quesiti: [], ultimi: {} }, ordini: [], triage: { righe: [] }, mappa: { mappe: [] }, terapie: [], eo: [], tocco: {}, esci: {}, scollega: {} });
const vero = pcFinto("vero", RISPOSTE("PC reparto", "ROSSI MARIO"));
const finto = pcFinto("finto", RISPOSTE("PC completo", "FALSO FINTO"));
const nuovo = pcFinto("nuovo", RISPOSTE("PC nuovo", "VERDI LUCA"));
await Promise.all([vero.pronto, finto.pronto, nuovo.pronto]);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromiumPath(), args: ARGS });
const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT" });
const tel = await tctx.newPage();
const testo = () => tel.locator("#app").innerText().catch(() => "");
const aspetta = async (re, ms = 20000) => ((await finche(async () => re.test(await testo()), ms)) ? testo() : "");
await tel.goto(vero.link(Date.now() + 5 * 60e3));
check(/ROSSI MARIO/.test(await aspetta(/ROSSI MARIO/)), "il telefono associato al PC (vero): l'elenco");
check(await finche(() => vero.rinnovata, 10000) && vero.comandi.includes("rinnova"), "alla prima sessione la chiave si rinnova (ECDH nella sessione): il PC ha la chiave nuova, il QR non vale più");
const disco = await tel.evaluate(async () => {
  const ls = localStorage.getItem("psassist.ponte.pcs.v1");
  const db = await new Promise((ok) => { const r = indexedDB.open("psassist-ponte"); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
  const v = db ? await new Promise((ok) => { const t = db.transaction("chiavi").objectStore("chiavi").getAll(); t.onsuccess = () => ok(t.result); t.onerror = () => ok([]); }) : [];
  let esportata = true;
  try { await crypto.subtle.exportKey("raw", v[0].k); } catch { esportata = false; }
  return { ls, n: v.length, estraibile: v[0] && v[0].k.extractable, esportata };
});
const o = JSON.parse(disco.ls || "null");
check(!!o && o.v.length === 1 && !("k" in o.v[0]) && !disco.ls.includes(P.b64u(vero.kQr)) && !!o.v[0].rinnovata, "in localStorage la lista dei PC, senza chiavi (la chiave nuova non c'è, quella del QR nemmeno)");
check(disco.n === 1 && disco.estraibile === false && !disco.esportata, "la chiave sta in IndexedDB: una CryptoKey non estraibile — uno script del sito non la copia");
// un QR dello stesso sito con una chiave sua e 30 giorni di validità (un adesivo, un link mandato)
const primi = vero.comandi.length;
await tel.goto(finto.link(Date.now() + 30 * 864e5));
const no = await aspetta(/QR non valido/, 10000);
const o2 = JSON.parse(await tel.evaluate(() => localStorage.getItem("psassist.ponte.pcs.v1")));
check(/QR non valido/.test(no) && !finto.saluti.length && o2.v.length === 1 && o2.v[0].id === o.v[0].id, "un QR che vale 30 giorni: «QR non valido», niente collegato, il PC vero resta");
// un QR vero di un altro PC completo: prima di sostituire si chiede
await tel.goto(nuovo.link(Date.now() + 5 * 60e3));
const chiede = await aspetta(/Sostituisco/, 15000);
check(/Sostituisco «PC reparto»/.test(chiede) && !/VERDI LUCA/.test(chiede), "un QR nuovo che prenderebbe il posto del PC di prima: «Sostituisco «PC reparto»?», col codice da controllare — e niente dati intanto");
await tel.locator('[data-a="tieni"]').click();
check(/ROSSI MARIO/.test(await aspetta(/ROSSI MARIO/)) && JSON.parse(await tel.evaluate(() => localStorage.getItem("psassist.ponte.pcs.v1"))).v.length === 1, "«No, tieni»: si torna al PC di prima, e il nuovo non resta in lista");
// in sottofondo l'app si copre (l'istantanea di iOS)
const coperta = await tel.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  const c = document.documentElement.classList.contains("coperto") && getComputedStyle(document.getElementById("app")).visibility === "hidden";
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  return c && !document.documentElement.classList.contains("coperto");
});
check(coperta, "in sottofondo l'app si copre (il selettore delle app di iOS non mostra pazienti), e davanti si scopre");
// «Scollega» sul telefono: lo sa anche il PC
await aspetta(/ROSSI MARIO/);
await tel.locator('[data-a="menu"]').click();
const sc = tel.locator('[data-a="dimentica"]');
if (await sc.count()) { await sc.click(); await sc.click(); }
check(await finche(() => vero.comandi.slice(primi).includes("scollega"), 8000), "«Scollega» sul telefono: il PC riceve «scollega» (e chiude l'associazione anche lui)");

sezione("il telefono: il rinnovo, la cassa, il QR nuovo (rev-s2)");
// P2-7: mentre chiede «Sostituisco?», niente del PC nuovo è salvato (né la riga, né la chiave)
{
  const t2 = await tctx.newPage();
  const vero2 = pcFinto("vero2", RISPOSTE("PC reparto", "ROSSI MARIO")), nuovo2 = pcFinto("nuovo2", RISPOSTE("PC nuovo", "VERDI LUCA"));
  await Promise.all([vero2.pronto, nuovo2.pronto]);
  await t2.goto(vero2.link(Date.now() + 5 * 60e3));
  await finche(async () => /ROSSI MARIO/.test(await t2.locator("#app").innerText().catch(() => "")), 20000);
  await t2.goto(nuovo2.link(Date.now() + 5 * 60e3));
  await finche(async () => /Sostituisco/.test(await t2.locator("#app").innerText().catch(() => "")), 15000);
  const sul = await t2.evaluate(async () => {
    const o = JSON.parse(localStorage.getItem("psassist.ponte.pcs.v1") || "null");
    const db = await new Promise((ok) => { const r = indexedDB.open("psassist-ponte"); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
    const n = db ? await new Promise((ok) => { const t = db.transaction("chiavi").objectStore("chiavi").count(); t.onsuccess = () => ok(t.result); t.onerror = () => ok(-1); }) : -1;
    return { righe: o ? o.v.length : 0, chiavi: n };
  });
  check(sul.righe === 1 && sul.chiavi === 1, `P2-7. mentre il telefono chiede «Sostituisco?», il PC nuovo non è salvato (righe ${sul.righe}, chiavi ${sul.chiavi}: solo quello di prima)`);
  await t2.close();
}
// P3: un QR del PC con l'orologio 4 minuti avanti (scade fra 9 minuti, sul telefono): vale
{
  const t3 = await tctx.newPage();
  const lett = pcFinto("lettura", { ...RISPOSTE("PC lettura", "BIANCHI ANNA"), ciao: { kind: "lettura", nome: "PC lettura", versione: "3.87.0" } });
  await lett.pronto;
  await t3.goto(lett.link(Date.now() + 9 * 60e3));
  const v3 = await finche(async () => { const x = await t3.locator("#app").innerText().catch(() => ""); return /BIANCHI ANNA|QR non valido/.test(x) ? x : ""; }, 20000);
  check(!!v3 && /BIANCHI ANNA/.test(v3), "P3. un QR vero di un PC con l'orologio 4 minuti avanti (fino a 5): vale (non «QR non valido»)");
  await t3.close();
}
// P2-3: un PC che non dà alla stanza la chiave del telefono (il telefono entra senza «entrato»): niente rinnovo
{
  const c4 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT" });
  const t4 = await c4.newPage();
  const senza = pcFinto("senza", RISPOSTE("PC reparto", "NERI PIO"), { altro: false });
  await senza.pronto;
  await t4.goto(senza.link(Date.now() + 5 * 60e3));
  await finche(async () => /NERI PIO/.test(await t4.locator("#app").innerText().catch(() => "")), 20000);
  await sospendi(2500);
  check(senza.comandi.includes("ciao") && !senza.comandi.includes("rinnova"), "P2-3. il telefono entrato nella stanza senza «entrato» (la sua chiave non c'era): non chiede il rinnovo");
  await c4.close();
}
// P2-4: il PC risponde a «rinnova» ma la chiave nuova non la tiene: il telefono non torna indietro a K
{
  const c5 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT" });
  const t5 = await c5.newPage();
  const perde = pcFinto("perde", RISPOSTE("PC reparto", "GIALLI EVA"), { perde: true });
  await perde.pronto;
  await t5.goto(perde.link(Date.now() + 5 * 60e3));
  await finche(() => perde.comandi.includes("rinnova"), 20000);
  await sospendi(10000);
  // (l'app riaperta: una sessione nuova — prima la 3.87 dopo un saluto senza risposta salutava con K, e alla risposta buttava K')
  const n0 = perde.saluti.length;
  await t5.reload();
  await sospendi(20000);
  const tiene = await t5.evaluate(async () => {
    const db = await new Promise((ok) => { const r = indexedDB.open("psassist-ponte"); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
    const v = db ? await new Promise((ok) => { const t = db.transaction("chiavi").objectStore("chiavi").getAll(); t.onsuccess = () => ok(t.result); t.onerror = () => ok([]); }) : [];
    return v.length === 1 && !!v[0].prossima;
  });
  check(tiene && perde.saluti.length === n0, "P2-4. chiesto il rinnovo, una risposta con K non fa buttare la chiave nuova: il telefono saluta solo con lei (e qui nessuno risponde)");
  await c5.close();
}
// P2-6: la chiave nuova che non si salva nella cassa: il rinnovo non si fa (nessun saluto con lei), e si resta su K
{
  const c6 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT" });
  await c6.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) { if (v && v.prossima) throw new DOMException("piena", "QuotaExceededError"); return put.call(this, v, k); };
  });
  const t6 = await c6.newPage();
  const pieno = pcFinto("pieno", RISPOSTE("PC reparto", "VIOLA LIA"));
  await pieno.pronto;
  await t6.goto(pieno.link(Date.now() + 5 * 60e3));
  await finche(() => pieno.comandi.includes("rinnova"), 20000);
  await sospendi(3000);
  check(!pieno.rinnovata && /VIOLA LIA/.test(await t6.locator("#app").innerText().catch(() => "")), "P2-6. la chiave nuova non si salva: nessun saluto con lei (il PC non la fa sua), e il telefono lavora con quella di prima");
  await c6.close();
}
// P2-5: la cassa del telefono che non legge una riga, all'apertura: la riga non sparisce dall'elenco su disco
{
  const c7 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT" });
  await c7.addInitScript(() => {
    const rotta = localStorage.getItem("prova.rotta");
    if (!rotta) return;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (k) { if (k === rotta) throw new DOMException("non risponde", "UnknownError"); return get.call(this, k); };
  });
  const t7 = await c7.newPage();
  const uno = pcFinto("uno", { ...RISPOSTE("PC uno", "AZZURRI UGO"), ciao: { kind: "lettura", nome: "PC uno", versione: "3.87.0" } });
  const due = pcFinto("due", RISPOSTE("PC due", "ROSA ADA"));
  await Promise.all([uno.pronto, due.pronto]);
  await t7.goto(uno.link(Date.now() + 5 * 60e3));
  await finche(async () => /AZZURRI UGO/.test(await t7.locator("#app").innerText().catch(() => "")), 20000);
  await t7.goto(due.link(Date.now() + 5 * 60e3));
  await finche(async () => /ROSA ADA/.test(await t7.locator("#app").innerText().catch(() => "")), 20000);
  await sospendi(1500);
  const righe = await t7.evaluate(() => JSON.parse(localStorage.getItem("psassist.ponte.pcs.v1")).v.map((x) => ({ id: x.id, nome: x.nome })));
  const idUno = (righe.find((x) => x.nome === "PC uno") || {}).id;
  await t7.evaluate((id) => localStorage.setItem("prova.rotta", id), idUno);
  await t7.goto(`${relay.url}/ponte/`);
  await finche(async () => /ROSA ADA/.test(await t7.locator("#app").innerText().catch(() => "")), 20000);
  await sospendi(1500);
  const dopo = await t7.evaluate(() => JSON.parse(localStorage.getItem("psassist.ponte.pcs.v1")).v.map((x) => x.id));
  check(righe.length === 2 && !!idUno && dopo.includes(idUno), "P2-5. una riga che la cassa non legge all'apertura (IndexedDB che non risponde): resta su disco — il telefono lavora con l'altra, e non la cancella");
  await c7.close();
}
// P2-1: il PC passa alla stanza della chiave nuova; il telefono, riaperto, lo trova lì (e la tiene)
{
  const c8 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT" });
  const t8 = await c8.newPage();
  const sp = pcFinto("sposta", RISPOSTE("PC reparto", "ARANCIO TEO"), { sposta: true });
  await sp.pronto;
  await t8.goto(sp.link(Date.now() + 5 * 60e3));
  await finche(() => sp.rinnovata, 20000);
  await finche(() => sp.stanzaOra !== sp.stanza, 3000);
  await t8.goto(`${relay.url}/ponte/`);
  const trovato = await finche(async () => /ARANCIO TEO/.test(await t8.locator("#app").innerText().catch(() => "")), 25000);
  const st8 = await t8.evaluate(() => JSON.parse(localStorage.getItem("psassist.ponte.pcs.v1")).v[0].stanza);
  check(sp.rinnovata && sp.stanzaOra !== sp.stanza && !!trovato && st8 === sp.stanzaOra, "P2-1. il PC passato alla stanza della chiave nuova: il telefono, riaperto, lo cerca anche lì, lo trova, e da allora è quella la sua stanza");
  await c8.close();
}
await browser.close();
await relay.chiudi();
console.log(fail ? `\nSICUREZZA: ${fail} FALLITI` : "\nSICUREZZA: TUTTO OK");
process.exit(fail ? 1 : 0);
