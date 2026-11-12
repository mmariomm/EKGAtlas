#!/usr/bin/env node
/*
 * Il ponte e le sue chiavi, contro chi non le ha (3.87): le prove dell'audit
 * di sicurezza diventate controlli. Tutto in locale: il ripetitore Node (la
 * stessa logica del Worker), il service worker vero del PC (ponte-sw.js, con
 * presa.js e la cassa) in una vm con la WebSocket vera di Node, e telefoni e
 * estranei scritti qui con cripto.js. Dati inventati.
 *   - il ripetitore: chi sa solo il numero della stanza non entra, non butta
 *     fuori nessuno, non allaga (relay-probe);
 *   - il PC non diventa sordo per un'entrata di pochi millisecondi (pc-sordo);
 *   - il QR non è una chiave per sempre: «Usa questo telefono» solo nella
 *     finestra del QR, e dopo la prima sessione la chiave è un'altra (pc-cambio);
 *   - il cambio turno, «Scollega» dal telefono, «Dimentica i dati…»;
 *   - la stazione di stampa: niente sostituzioni in silenzio, il «riparti» legato
 *     alla sessione, la revoca.
 *   node test/ponte-sicurezza.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { WebSocket as WsNode } from "ws";
import { avviaRelay } from "../ponte/relay-node.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\nponte, sicurezza: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
const leggiSe = (f) => { try { return readFileSync(join(root, f), "utf8"); } catch { return ""; } };
const blocco = (fn) => fn().catch((e) => check(false, `blocco interrotto: ${e && e.message || e}`));
async function finche(fn, ms = 5000) { for (const t0 = Date.now(); Date.now() - t0 < ms; await sospendi(40)) if (await fn()) return true; return !!(await fn()); }

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
  rinnova: async (k, priv, pubAltro, pubTel, pubPc) => {
    const z = new Uint8Array(await S.deriveBits({ name: "ECDH", public: await S.importKey("raw", pubAltro, { name: "ECDH", namedCurve: "P-256" }, false, []) }, priv, 256));
    const sale = new Uint8Array([...SALE, ...z, ...pubTel, ...pubPc]);
    return hkdf(k, sale, "rinnova", 32);   // (i 32 byte: qui il telefono finto li tiene in chiaro, per provarli)
  },
};
const L = await import(join(root, "../worker/ponte-logica.js"));
const eventi = [];
const relay = await avviaRelay({ osserva: () => {} });
const WS = relay.url.replace(/^http/, "ws");

// Un client grezzo della stanza: quello che arriva, e la prova se gliela si chiede (con queste chiavi d'entrata)
function presa(stanza, ruolo, { prove = [], chiave = "", altro = [], nome = ruolo } = {}) {
  const ws = new WsNode(`${WS}/ponte/ws?r=${stanza}&ruolo=${ruolo}`);
  const c = { ws, nome, testi: [], bin: [], chiusa: null, pari: null, entrato: null };
  ws.on("message", async (d, b) => {
    if (b) { c.bin.push(new Uint8Array(d)); return; }
    const t = d.toString();
    if (t === "pong") return;
    c.testi.push(t);
    let m = null;
    try { m = JSON.parse(t); } catch { return; }
    if (typeof m.pari === "boolean") c.pari = m.pari;
    if (typeof m.entrato === "number") c.entrato = m.entrato;
    if (typeof m.sfida === "string" && (prove.length || chiave)) {
      const l = await Promise.all([chiave, ...prove].filter(Boolean).map((k) => P.provaEntra(k, m.sfida)));
      ws.send(JSON.stringify({ prova: l, ...(chiave ? { chiave } : {}), ...(altro.length ? { altro } : {}) }));
    }
  });
  ws.on("close", (code) => { c.chiusa = code; });
  c.aperta = new Promise((ok) => ws.on("open", ok));
  c.chiudi = () => { try { ws.close(); } catch { /* già */ } };
  return c;
}
const stanzaNuova = () => Buffer.from(P.casuale(16)).toString("hex");

// ======================================================================= il ripetitore
sezione("il ripetitore (relay-probe)");
await blocco(async () => {
  const K = P.casuale(32), e = await P.chiaviEntra(K), r = stanzaNuova();
  // il PC entra: registra la sua chiave d'entrata e quella del telefono
  const pc = presa(r, "pc", { chiave: e.pc, altro: [e.tel], nome: "PC vero" });
  await pc.aperta;
  check(await finche(() => pc.entrato === 0), "il PC entra con la prova: la stanza tiene la sua chiave d'entrata e quella del telefono (la prima volta)");
  const tel = presa(r, "tel", { prove: [e.tel], nome: "iPhone vero" });
  await tel.aperta;
  check(await finche(() => tel.pari === true && pc.pari === true), "il telefono entra con la sua prova: lui e il PC si vedono");
  tel.ws.send("ping");
  // A. un estraneo che sa il numero della stanza entra come «pc» e se ne va: il PC vero resta in stanza
  const x = presa(r, "pc", { nome: "estraneo" });
  await x.aperta; await sospendi(60);
  check(x.pari === null && !x.testi.some((t) => /pari/.test(t)), "A. un estraneo «pc» senza prova: niente presenza, resta fuori dai conti");
  x.chiudi(); await sospendi(80);
  tel.ws.send(Buffer.alloc(64, 7)); await sospendi(80);
  check(pc.chiusa === null && pc.bin.length === 1 && relay.prese().pc >= 1, "A. …e il PC vero è ancora lì: riceve quello che manda il telefono (mai sordo)");
  // B. un estraneo «tel» con il telefono davanti: il telefono vero non esce
  const y = presa(r, "tel", { nome: "estraneo tel" });
  await y.aperta; await sospendi(60);
  y.ws.send(Buffer.alloc(64, 1)); await sospendi(80);
  check(tel.chiusa === null && y.chiusa === 4403 && pc.bin.length === 1, "B. un estraneo «tel» senza prova: il telefono vero resta (niente 4001), lui è chiuso con 4403, e al PC non arriva niente");
  // una prova sbagliata (un'altra chiave): fuori
  const z = presa(r, "tel", { prove: [(await P.chiaviEntra(P.casuale(32))).tel], nome: "prova sbagliata" });
  await z.aperta;
  check(await finche(() => z.chiusa === 4403) && tel.chiusa === null, "una prova con un'altra chiave: 4403, e il telefono vero resta");
  // la chiave registrata non si cambia senza la prova di quella di prima
  const w = presa(r, "pc", { chiave: (await P.chiaviEntra(P.casuale(32))).pc, nome: "chi vuole registrarsi" });
  await w.aperta;
  check(await finche(() => w.chiusa === 4403) && pc.chiusa === null, "chi porta una chiave sua in una stanza che ne ha già una: 4403 (la prima volta vale solo la prima)");
  // il PC rinnova: prova con quella di prima, la stanza tiene la nuova
  const K2 = P.casuale(32), e2 = await P.chiaviEntra(K2);
  const pc2 = presa(r, "pc", { chiave: e2.pc, prove: [e.pc], altro: [e2.tel], nome: "PC rinnovato" });
  await pc2.aperta;
  check(await finche(() => pc2.entrato === 1 && pc.chiusa === 4001), "il PC che rinnova la chiave: prova con quella di prima, la stanza tiene la nuova (e la presa di prima del PC esce: 4001)");
  const vecchio = presa(r, "tel", { prove: [e.tel], nome: "chiave del QR" });
  await vecchio.aperta;
  check(await finche(() => vecchio.chiusa === 4403), "dopo il rinnovo, la chiave d'entrata del QR non entra più (chi ha fotografato il QR resta fuori)");
  for (const c of [tel, pc2]) c.chiudi();
});
await blocco(async () => {
  // C. allagare: rifacendo la presa non si azzerano i conti — sono della stanza, per ruolo
  const r = stanzaNuova(), pc = presa(r, "pc", { nome: "PC" });
  await pc.aperta; await sospendi(40);
  const frame = Buffer.alloc((1 << 20) - 64, 0x41);
  let prese = 0, chiuseEntrate = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    const x = presa(r, "tel"); await x.aperta; prese++;
    for (let i = 0; i < 40; i++) x.ws.send(frame);
    await sospendi(60);
    if (x.chiusa === 1013) chiuseEntrate++;
    x.chiudi();
  }
  await sospendi(300);
  const mb = pc.bin.reduce((n, b) => n + b.length, 0) / 1048576;
  check(mb <= 64 + 2, `C. ${prese} prese «tel» di fila, 40 frame da ~1 MB l'una: al PC al più il tetto della stanza (${mb.toFixed(0)} MB su 64 al minuto)`);
  pc.chiudi();
  // le entrate al minuto, per ruolo
  const r2 = stanzaNuova();
  const lista = [];
  const N = L.PONTE.entrateAlMinuto || 60;
  for (let i = 0; i < N + 5; i++) { const x = presa(r2, "tel"); lista.push(x); await x.aperta; }
  await sospendi(150);
  check(lista.length === N + 5 && lista.slice(-5).every((x) => x.chiusa === 1013), `oltre ${N} entrate al minuto nella stessa stanza: chiuse subito (1013)`);
  for (const x of lista) x.chiudi();
});
await blocco(async () => {
  // D. la stanza di una stazione: il PC del medico registra la sua chiave e quella della stazione
  const K = P.casuale(32), e = await P.chiaviEntra(K), r = stanzaNuova();
  const med = presa(r, "medico", { chiave: e.medico, altro: [e.stazione] });
  await med.aperta;
  const sta = presa(r, "stazione", { prove: [e.stazione] });
  await sta.aperta;
  check(await finche(() => sta.pari === true && med.pari === true), "D. la stazione entra con la sua prova");
  sta.ws.send("ping");
  const x = presa(r, "stazione", { nome: "estraneo stazione" });
  await x.aperta; x.chiudi(); await sospendi(80);
  med.ws.send(Buffer.alloc(64, 2)); await sospendi(80);
  check(sta.chiusa === null && sta.bin.length === 1 && med.pari === true, "D. un estraneo «stazione» entra ed esce: la stazione vera riceve il foglio, e il medico non la vede sparire");
  med.chiudi(); sta.chiudi();
});
await blocco(async () => {
  // il passaggio: i client della 3.86 (nessuna prova) in una stanza senza chiavi entrano come prima
  const r = stanzaNuova();
  const pc = presa(r, "pc"), tel = presa(r, "tel");
  await pc.aperta; await tel.aperta;
  await finche(() => tel.pari === true);
  tel.ws.send(Buffer.alloc(32, 3)); await sospendi(80);
  check(pc.bin.length === 1 && pc.chiusa === null, "il passaggio: un PC e un telefono della 3.86 (senza prova) in una stanza senza chiavi si parlano come prima");
  check(relay.eventi().some((x) => x.tipo === "entrata senza prova"), "…e il ripetitore lo scrive nel log (senza la stanza intera)");
  check(L.PONTE.senzaProva === true, "il taglio non è ancora arrivato: PONTE.senzaProva (worker/ponte-logica.js)");
  pc.chiudi(); tel.chiudi();
});

// ============================================== la stanza da sola (la revisione: stanza-probe)
sezione("la stanza da sola: il taglio, le attese, le scadenze, l'archivio");
// una Stanza con un io finto (come il Durable Object, senza rete): prese a mano, il tempo a mano
function stanzaFinta({ guasto = false, rotto = false } = {}) {
  const arch = new Map(), socks = [];
  const io = {
    archivio: { guasto, leggi: (k) => { if (rotto) throw new Error("io"); return arch.get(k) ?? null; }, scrivi: (k, v) => { if (rotto) throw new Error("io"); arch.set(k, structuredClone(v)); } },
    conti: new Map(), nota: () => {},
    tutte: () => socks, aperta: (w) => !w.chiusa, invia: (w, d) => w.rx.push(d),
    chiudi: (w, c) => { w.chiusa = c; }, leggi: (w) => w.st, scrivi: (w, s) => { w.st = s; }, battito: () => 0,
  };
  const s = new L.Stanza(io);
  const msg = (w) => w.rx.filter((x) => typeof x === "string").map((x) => { try { return JSON.parse(x); } catch { return {}; } });
  const sfida = (w) => [...msg(w)].reverse().find((m) => typeof m.sfida === "string")?.sfida;
  const entra = (ruolo, t = Date.now()) => { const w = { rx: [], st: null, chiusa: 0 }; socks.push(w); s.entra(w, ruolo, t); return w; };
  const prova = (w, chiavi, extra = {}, t = Date.now()) => s.messaggio(w, JSON.stringify({ prova: chiavi.map((c) => L.provaDi(c, sfida(w))), ...extra }), t);
  return { s, arch, entra, prova, msg, sfida, socks };
}
const chiaveB = () => P.b64u(P.casuale(32));
const taglio = (fn) => { const prima = L.PONTE.senzaProva; L.PONTE.senzaProva = false; try { fn(); } finally { L.PONTE.senzaProva = prima; } };
{
  // P1: dopo il taglio, la stazione (o il telefono) di una stanza dove il medico (il PC) non ha ancora dato la
  // sua chiave non esce con 4403: aspetta, e quando il medico la dà ha una sfida nuova ed entra
  taglio(() => {
    const { entra, prova, msg } = stanzaFinta();
    const sta = chiaveB(), med = chiaveB();
    const st = entra("stazione"); prova(st, [sta]);
    check(st.chiusa === 0 && st.st.aspetta === true, "P1. dopo il taglio, la stazione in una stanza senza la sua chiave non esce (4403): aspetta");
    check(msg(st)[0].obbligo === 1, "P1. …e la sfida dice che la prova ormai è obbligo (il PC sa che deve dare le chiavi dell'altro ruolo)");
    const m = entra("medico"); prova(m, [med], { chiave: med, altro: [sta] });
    check(m.chiusa === 0 && msg(st).filter((x) => x.sfida).length === 2, "P1. il medico entra e dà la chiave della stazione: la stazione che aspettava ha una sfida nuova");
    prova(st, [sta]);
    check(st.chiusa === 0 && st.st.provata && msg(st).some((x) => x.entrato === 0) && msg(st).some((x) => x.pari === true), "P1. …e con quella entra: si vedono");
    // chi aspetta da più di provaMs non esce (non è colpa sua), chi deve provare sì
    const t = Date.now(), { entra: e2, prova: p2 } = stanzaFinta();
    const tel = e2("tel", t); p2(tel, [chiaveB()], {}, t);
    const x = e2("pc", t);
    e2("pc", t + L.PONTE.provaMs + 1);
    check(tel.chiusa === 0 && x.chiusa === 4403, "P1. dopo provaMs: chi aspetta la sua chiave resta, chi doveva provare e non l'ha fatto esce (4403)");
  });
}
{
  // P2-2: chi sa solo il numero della stanza non consuma le entrate al minuto di chi ha la chiave
  const { entra, prova } = stanzaFinta();
  const k = chiaveB(), t = Date.now();
  prova(entra("pc", t), [k], { chiave: k }, t);
  const finte = [];
  for (let i = 0; i < (L.PONTE.entrateAlMinuto || 60) + 10; i++) finte.push(entra("pc", t));
  const vero = entra("pc", t); prova(vero, [k], {}, t);
  check(vero.chiusa === 0 && vero.st.provata, `P2-2. ${finte.length} entrate senza prova in un minuto: il PC vero entra lo stesso (le entrate si contano dopo la prova)`);
  check(finte.filter((w) => !w.chiusa).length <= (L.PONTE.inAttesaMax || 4), "P2-2. …e chi deve ancora provare, per ruolo, è al più PONTE.inAttesaMax (le più vecchie escono)");
}
{
  // P2-8: le chiavi d'entrata del telefono che il PC dà con una scadenza (quelle del QR) scadono da sole, nella stanza
  const { entra, prova, msg } = stanzaFinta();
  const k = chiaveB(), tq = chiaveB(), t = Date.now();
  prova(entra("pc", t), [k], { chiave: k, altro: [{ c: tq, fino: t + 60e3 }] }, t);
  const prima = entra("tel", t); prova(prima, [tq], {}, t);
  const dopo = entra("tel", t + 61e3); prova(dopo, [tq], {}, t + 61e3);
  check(prima.st.provata && !dopo.st.provata && !msg(dopo).some((m) => "entrato" in m), "P2-8. la chiave del QR entra nella sua finestra; dopo la scadenza (scritta nella stanza) non entra più — anche se il PC è spento");
}
{
  // P2-9: senza archivio (o con l'archivio che non risponde) la stanza non accetta nessuno — mai «nessuna chiave»
  const g = stanzaFinta({ guasto: true }), k = chiaveB();
  const w = g.entra("pc"); g.prova(w, [k], { chiave: k });
  check(w.chiusa === 1011 && !g.arch.size, "P2-9. l'archivio non c'è (Durable Object senza SQLite): 1011, nessuna chiave registrata in memoria");
  const r = stanzaFinta({ rotto: true });
  const w2 = r.entra("tel");
  check(w2.chiusa === 1011, "P2-9. l'archivio che non risponde: chi entra esce (1011), non «entra chiunque»");
  const src = leggiSe("../worker/ponte.js");
  check(!/mem\.(set|get)/.test(src) && /guasto/.test(src), "P2-9. worker/ponte.js: niente Map in memoria al posto dello SQLite");
}
{
  // P3: il PC che cambia la sua chiave d'entrata sa se la stanza l'ha scritta (e solo allora butta quella di prima)
  const { entra, prova, msg } = stanzaFinta();
  const k = chiaveB(), k2 = chiaveB();
  const a = entra("pc"); prova(a, [k], { chiave: k });
  const b = entra("pc"); prova(b, [k], { chiave: k2 });
  check(msg(a).some((m) => m.entrato === 0 && m.registrata === true) && msg(b).some((m) => m.entrato === 0 && m.registrata === true),
    "P3. la risposta dice «registrata»: il PC tiene la chiave di prima finché la stanza non conferma la nuova");
}

// ============================================================= il service worker vero del PC
const EXT = (f) => leggiSe("extension/" + f);
const GEST = "https://smarthealth.multimedica.it/sa4pso/";
async function pcVero({ locale = {}, cassa = new Map(), sessione = {} } = {}) {
  const urls = [];
  class Presa extends WebSocket { constructor(u) { super(u); urls.push(u); } }
  const area = (obj) => ({
    get: async (k) => { const o = {}; for (const x of k == null ? Object.keys(obj) : [].concat(k)) if (x in obj) o[x] = structuredClone(obj[x]); return o; },
    set: async (o) => { for (const [k, v] of Object.entries(o)) obj[k] = structuredClone(v); },
    remove: async (k) => { for (const x of [].concat(k)) delete obj[x]; },
  });
  const msg = [];
  const davanti = { id: 7, url: GEST + "menuPsoEpisodio.do?EPISODIO_ID=1", active: true, windowId: 1, index: 0 };
  const chrome = {
    storage: { local: area(locale), session: area(sessione), onChanged: { addListener() {} } },
    runtime: { onMessage: { addListener: (f) => msg.push(f) }, onStartup: { addListener() {} }, getURL: (p) => "chrome-extension://abc/" + p, getManifest: () => ({ version: "3.87.0" }) },
    tabs: { query: async () => [davanti], sendMessage: async () => ({ ok: true, dati: [{ ep: "1", nome: "ROSSI MARIO" }] }), create: async () => ({}), update: async () => ({}), get: async () => null, remove: async () => {},
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    windows: { getLastFocused: async () => null },
  };
  const ctx = vm.createContext({
    chrome, WebSocket: Presa, crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, URL, URLSearchParams, console, structuredClone,
    self: {}, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, __salto: 0, PSA_CASSA: cassa,
    ordLeggi: async () => [], sulGestionale: (u) => String(u || "").startsWith(GEST), leggibileOrd: () => true,
    corto: (s, n = 160) => String(s == null ? "" : s).slice(0, n), KEY: (id) => "ref:" + id, REF_TTL: 6e5, stampaScelte: async () => ({ attiva: true }),
    ospite: async () => ({ ok: true }), stampaPdf: async () => ({ ok: true, esito: "stampato" }), ruotaDi: () => 0, STAMPA_PDF_MAX: 15e6,
  });
  vm.runInContext("const PONTE_HOST_FISSO = \"\";\nDate.now = ((v) => () => v() + globalThis.__salto)(Date.now);", ctx);
  for (const f of ["ponte-cripto.js", "presa.js", "fuori-sw.js", "cassa.js", "ponte-sw.js", "stazione-sw.js"]) { const s = EXT(f); if (s) vm.runInContext(s, ctx, { filename: f }); }
  locale["ponte.host"] = relay.url;
  const ev = (c) => vm.runInContext(c, ctx);
  await ev("ponteCaricato");
  await ev("typeof staCaricato === 'undefined' ? null : staCaricato");
  const pagina = (m, sender = { url: "chrome-extension://abc/ponte.html" }) => new Promise((ok) => {
    let fatto = false;
    for (const f of msg) f(m, sender, (x) => { if (!fatto) { fatto = true; ok(x); } });
    setTimeout(() => { if (!fatto) ok(undefined); }, 3000);
  });
  return { ctx, ev, urls, locale, cassa, sessione, pagina, salta: (ms) => { ctx.__salto += ms; }, scheda: { url: GEST + "x", tab: { id: 7 } } };
}
// Un telefono in Node, col protocollo vero: saluto, sessione, comandi, la prova d'entrata e il rinnovo della chiave
function telNode(stanza, k, dev) {
  const t = { k, dev, prossima: null, risposte: [], saluti: [], canale: null, id: 0 };
  t.entra = async () => [(await P.chiaviEntra(t.k)).tel, ...(t.prossima ? [(await P.chiaviEntra(t.prossima)).tel] : []), ...(t.vecchia ? [t.vecchia] : [])];
  t.apri = async () => {
    t.p = presa(stanza, "tel", { prove: await t.entra() });
    t.p.ws.on("message", async (d, b) => {
      if (!b) return;
      const f = new Uint8Array(d), h = P.leggiTestata(f);
      if (!h) return;
      if (h.tipo === P.TIPO.SALUTO_PC) {
        for (const kk of [t.prossima, t.k].filter(Boolean)) { try { t.saluti.push({ k: kk, ...(await P.apri((await P.chiaviCoppia(kk)).salutoPc, f, P.TIPO.SALUTO_PC)).dati }); break; } catch { /* altra */ } }
      } else if (t.canale) { try { t.risposte.push(await t.canale.decifra(f)); } catch { /* non è per noi */ } }
    });
    await t.p.aperta;
    return finche(() => t.p.pari === true, 4000);
  };
  t.saluta = async (extra = {}, kk = t.prossima || t.k) => {
    const n = P.casuale(16), ch = await P.chiaviCoppia(kk);
    t.p.ws.send(await P.sigilla(ch.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: P.b64u(n), dev: t.dev, entra: 1, ...extra }));
    await finche(() => t.saluti.some((x) => x.eco === P.b64u(n)), 1500);
    const s = t.saluti.find((x) => x.eco === P.b64u(n));
    if (s && s.n) {
      t.canale = P.canaleTel(await P.chiaviSessione(s.k, n, P.daB64u(s.n)));
      if (t.prossima && s.k === t.prossima) { t.vecchia = (await P.chiaviEntra(t.k)).tel; t.k = t.prossima; t.prossima = null; }
    }
    return s || null;
  };
  t.chiedi = async (cmd, args = {}) => {
    const id = ++t.id;
    t.p.ws.send(await t.canale.cifra({ id, cmd, ...args }));
    await finche(() => t.risposte.some((x) => x.re === id), 2500);
    return t.risposte.find((x) => x.re === id) || null;
  };
  t.rinnova = async () => {
    const e = await P.coppiaEcdh();
    const r = await t.chiedi("rinnova", { pub: P.b64u(e.pub), rq: P.b64u(P.casuale(12)), auto: true });
    if (!r || !r.ok) return r;
    const pubPc = P.daB64u(r.dati.pub);
    t.prossima = await P.rinnova(t.k, e.privata, pubPc, e.pub, pubPc);
    return r;
  };
  t.chiudi = () => t.p && t.p.chiudi();
  return t;
}

sezione("il PC vero non diventa sordo (pc-sordo)");
await blocco(async () => {
  const pc = await pcVero();
  const r = await pc.pagina({ t: "ponteAssocia" });
  const k = P.leggiFrammento(new URL(r.qr).hash).k, stanza = (await P.chiaviCoppia(k)).stanza;
  await finche(() => pc.ev("pt.presa.su"));
  check(pc.urls.length >= 1 && pc.urls.every((u) => !u.includes("#") && !/[?&](c|p|a|k|chiave|token)=/.test(u)), "la presa del PC: nell'indirizzo solo la stanza e il ruolo (le chiavi d'entrata non viaggiano mai nell'indirizzo)");
  const tel = telNode(stanza, k, P.b64u(P.casuale(16)));
  check(await tel.apri(), "il telefono entra con la sua prova (il PC ha dato alla stanza la sua chiave d'entrata)");
  check(!!(await tel.saluta()) && (await tel.chiedi("ciao"))?.ok, "il saluto e il «ciao» del telefono hanno risposta");
  const x = presa(stanza, "pc", { nome: "estraneo" });
  await x.aperta; await sospendi(50); x.chiudi(); await sospendi(150);
  check(!!(await tel.saluta()), "un estraneo «pc» entrato e uscito (50 ms): il saluto nuovo del telefono ha ancora risposta");
  check(pc.ev("pt.presa.su") === true && pc.ev("pt.presa.pari") === true, "e la presa del PC è su, col telefono dall'altra parte");
  tel.chiudi();
  await pc.ev("pt.presa.ferma()");
});

sezione("il QR non è una chiave per sempre (pc-cambio)");
await blocco(async () => {
  const pc = await pcVero();
  const r = await pc.pagina({ t: "ponteAssocia" });
  const k = P.leggiFrammento(new URL(r.qr).hash).k, stanza = (await P.chiaviCoppia(k)).stanza;
  await finche(() => pc.ev("pt.presa.su"));
  const devA = P.b64u(P.casuale(16)), devB = P.b64u(P.casuale(16));
  const A = telNode(stanza, k, devA);
  await A.apri(); await A.saluta(); await A.chiedi("ciao");
  check(pc.locale["ponte.coppia"].dev === devA && !("k" in pc.locale["ponte.coppia"]), "il telefono A (il medico) entra col QR; su storage.local niente chiave");
  // dentro la finestra del QR, «Usa questo telefono» vale (la Fotocamera, poi l'app della Home)
  const B = telNode(stanza, k, devB);
  await B.apri();
  const sb = await B.saluta({ cambio: true });
  check(!!sb && !!sb.n && pc.locale["ponte.coppia"].dev === devB, "nella finestra del QR, «Usa questo telefono» da B: il PC passa a B");
  const st = await pc.pagina({ t: "ponteStato" });
  check(!!st.stato.cambiato && /iPhone cambiato/.test((st.stato.avviso || {}).testo || "") && st.stato.registro.some((x) => /iPhone cambiato/.test(x.testo)),
    "…e lo dice in vista: l'avviso per il pannello e la pagina iPhone, e il registro");
  // B torna A (stessa cosa, ancora nella finestra: A, uscito con 4001, rientra); poi A rinnova la chiave
  check(A.p.chiusa === 4001, "(A, davanti, è uscito dalla stanza con 4001: «Aperto su un altro dispositivo»)");
  B.chiudi();
  await A.apri();
  const sa = await A.saluta({ cambio: true });
  check(!!sa && sa.n && pc.locale["ponte.coppia"].dev === devA, "(A si riprende il posto, sempre nella finestra)");
  await A.chiedi("ciao");
  const rn = await A.rinnova();
  check(rn && rn.ok && !!A.prossima, "A chiede la chiave nuova (ECDH dentro la sessione): il PC risponde con la sua chiave pubblica");
  const s2 = await A.saluta();
  check(!!s2 && !!s2.n && !A.prossima && (await A.chiedi("ciao"))?.ok, "il primo saluto con la chiave nuova: il PC la fa sua, e la sessione va");
  check(pc.locale["ponte.coppia"].gen === 1 && !!pc.locale["ponte.coppia"].rinnovata, "il PC: la chiave dell'associazione rinnovata (gen 1)");
  // ancora nella finestra: B (che ha solo il QR) chiede il posto — e A, con la chiave nuova, se lo riprende
  const B2 = telNode(stanza, k, devB);
  await B2.apri();
  const sb2 = await B2.saluta({ cambio: true });
  check(!!sb2 && !!sb2.n && pc.locale["ponte.coppia"].dev === devB, "nella finestra, dopo il rinnovo: B col QR chiede il posto, e il PC torna alla chiave del QR per lui");
  // (B, un'app vera, rinnova anche lui la sua chiave)
  await B2.chiedi("ciao");
  check((await B2.rinnova())?.ok && !!(await B2.saluta())?.n && !B2.prossima, "(B rinnova la sua chiave: il PC la fa sua)");
  B2.chiudi(); await A.apri();
  const no = await A.saluta();
  check(!!no && no.no === "altro telefono", "A (la chiave rinnovata) si sente dire «un altro telefono» (e non resta senza risposta)");
  const ri = await A.saluta({ cambio: true });
  check(!!ri && !!ri.n && pc.locale["ponte.coppia"].dev === devA && (await A.chiedi("ciao"))?.ok, "…e con «Usa questo telefono» si riprende il posto, con la sua chiave");
  // finita la finestra del QR: un mese dopo, B (la foto del QR) chiede il cambio
  pc.salta(30 * 864e5);
  await pc.ev("ponteControlla()");
  await sospendi(300);
  const C = telNode(stanza, k, devB);
  const entrato = await C.apri();
  const sc = entrato ? await C.saluta({ cambio: true }) : null;
  check(!sc && pc.locale["ponte.coppia"].dev === devA, `un mese dopo, la foto del QR: ${entrato ? "nessuna risposta al cambio" : "non entra nemmeno nella stanza"}, il PC resta di A`);
  // e la foto del QR insieme ai byte del ponte (il dev di A): niente sessione, la chiave non è più quella del QR
  const D = telNode(stanza, k, devA);
  const dentro = await D.apri();
  const sd = dentro ? await D.saluta() : null;
  check(!sd, "la chiave del QR e il dev di A (letti dai byte): nessuna sessione — la chiave dell'associazione non è più quella del QR");
  // A, con la chiave nuova, rientra (anche nella stanza: la sua chiave d'entrata è quella nuova)
  A.chiudi(); await sospendi(100);
  const A2 = telNode(stanza, A.k, devA); A2.vecchia = A.vecchia;
  check(await A2.apri() && !!(await A2.saluta()) && (await A2.chiedi("ciao"))?.ok, "A, con la chiave nuova, rientra e lavora");
  // il cambio turno: un altro utente nel gestionale
  await pc.pagina({ t: "ponteOperatore", nome: "BIANCHI DOTT. ANNA" }, pc.scheda);
  if (!pc.locale["ponte.coppia"].operatore) await pc.pagina({ t: "ponteOperatore", nome: "ROSSI DOTT. LUCA" }, pc.scheda);
  const prima = pc.locale["ponte.coppia"].operatore;
  await pc.pagina({ t: "ponteOperatore", nome: prima === "VERDI DOTT. CARLA" ? "NERI DOTT. PIO" : "VERDI DOTT. CARLA" }, pc.scheda);
  check(!!pc.locale["ponte.coppia"].pausa, `il cambio turno: entra un altro utente nel gestionale (l'associazione era di ${prima}) — l'iPhone in pausa`);
  await A2.saluta();
  const ciao = await A2.chiedi("ciao"), paz = await A2.chiedi("pazienti");
  check(ciao?.ok && /altro utente/.test(ciao.dati.pausa || "") && paz && !paz.ok && /Sul PC è entrato un altro utente: riconferma sul PC/.test(paz.errore),
    "in pausa: il «ciao» lo dice, una lettura è rifiutata con «Sul PC è entrato un altro utente: riconferma sul PC»");
  const cs = await A2.chiedi("cartellaSalva", { ep: "1", rq: P.b64u(P.casuale(12)) });
  check(cs && !cs.ok && cs.pausa === true, "…e anche una scrittura");
  check((await pc.pagina({ t: "ponteRiconferma" }))?.ok && !pc.locale["ponte.coppia"].pausa, "«Riconferma l'iPhone» sulla pagina iPhone: l'associazione è di chi c'è adesso");
  await A2.saluta();
  check((await A2.chiedi("pazienti"))?.ok, "riconfermato: il telefono legge di nuovo");
  // «Dimentica i dati…» chiude la sessione (l'associazione resta)
  await pc.ev("ponteDimentica()");
  check(!pc.ev("pt.sessione") && !!pc.locale["ponte.coppia"], "«Dimentica i dati…»: la sessione col telefono finisce, l'associazione resta");
  // «Scollega» sul telefono: anche il PC chiude l'associazione
  await A2.saluta();
  await A2.chiedi("scollega");
  await sospendi(150);
  check(!pc.locale["ponte.coppia"] && !pc.cassa.has("ponte"), "«Scollega» sul telefono: anche sul PC l'associazione finisce (e la chiave esce dalla cassa)");
  A2.chiudi(); C.chiudi(); D.chiudi(); B.chiudi();
  await pc.ev("pt.presa.ferma()");
});
await blocco(async () => {
  // una coppia della 3.86 (la chiave in storage.local): al primo avvio va nella cassa, e il telefono di prima entra come sempre
  const K = P.casuale(32), dev = P.b64u(P.casuale(16)), stanza = (await P.chiaviCoppia(K)).stanza;
  const pc = await pcVero({ locale: { "ponte.coppia": { k: P.b64u(K), creata: Date.now() - 864e5, usata: true, dev, nTel: "" } } });
  check(!("k" in pc.locale["ponte.coppia"]) && pc.locale["ponte.coppia"].stanza === stanza && pc.cassa.get("ponte")?.k?.extractable === false,
    "una coppia della 3.86: la chiave va nella cassa (CryptoKey non estraibile) e via da storage.local; la stanza è la stessa");
  await pc.ev("ponteAvvia()");
  await finche(() => pc.ev("pt.presa.su"));
  const vecchio = presa(stanza, "tel");   // un telefono della 3.86: senza prova
  await vecchio.aperta;
  await finche(() => vecchio.pari === true, 3000);
  const ch = await P.chiaviCoppia(K), n = P.casuale(16);
  vecchio.ws.send(await P.sigilla(ch.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: P.b64u(n), dev }));
  await finche(() => vecchio.bin.length > 0, 2000);
  let ok = false;
  for (const f of vecchio.bin) { try { ok = ok || !!(await P.apri(ch.salutoPc, f, P.TIPO.SALUTO_PC)).dati.n; } catch { /* no */ } }
  check(ok, "il passaggio: il telefono della 3.86 (senza prova, senza rinnovo) entra e ha la sua sessione, senza un QR nuovo");
  vecchio.chiudi();
  await pc.ev("pt.presa.ferma()");
});

sezione("la stazione di stampa");
await blocco(async () => {
  const Ks = P.casuale(32);
  const pc = await pcVero({ locale: { "stazione.coppia": { k: P.b64u(Ks), nome: "Infermeria", dal: Date.now() - 864e5, via: "telefono", codice: "123 456" } } });
  await pc.ev("stmAvvia(false)");
  check(!("k" in pc.locale["stazione.coppia"]) && pc.cassa.get("stazione.coppia")?.k?.extractable === false, "la chiave della stazione (3.86, su storage.local) va nella cassa, non estraibile");
  // «riparti» legato alla sessione (F8)
  pc.ev(`stm.sessione = { canale: null, n: "NUMEROSALUTO1234" }`);
  const chs = await P.chiaviCoppia(Ks);
  const riparti = async (extra) => pc.ev(`stmRicevi`)(await P.sigilla(chs.salutoPc, P.TIPO.SALUTO_PC, 0, { v: 1, riparti: true, ...extra }));
  await riparti({});
  check(!!pc.ev("stm.sessione"), "un «riparti» senza il numero della sessione (rimandato, vecchio): la sessione resta — il foglio in viaggio non si ferma");
  await riparti({ eco: "UNALTROSALUTO000" });
  check(!!pc.ev("stm.sessione"), "…né con il numero di un'altra sessione");
  await riparti({ eco: "NUMEROSALUTO1234" });
  check(!pc.ev("stm.sessione"), "con il numero di questa sessione sì: la stazione si è davvero riavviata");
  // niente sostituzioni in silenzio (F4/P2-6)
  const e = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await webcrypto.subtle.exportKey("raw", e.publicKey));
  const offerta = `${P.b64u(pub)}.${P.b64u(P.casuale(16))}.${Date.now() + 4 * 60e3}`;
  const r = await pc.ev("stazioneCollega")({ sta: offerta, nome: "Finta" });
  check(r && !r.ok && r.conferma && pc.locale["stazione.coppia"].nome === "Infermeria" && pc.ev("stazioneChiesta()")?.nome === "Finta",
    "il telefono chiede di collegare un'altra stazione: niente sostituito — il PC chiede conferma (la pagina iPhone)");
  check((await pc.ev("stazioneConferma")(false)).ok && !pc.ev("stazioneChiesta()") && pc.locale["stazione.coppia"].nome === "Infermeria", "«No» sul PC: resta quella di prima");
  check(pc.ev("stazioneDelTelefono()") === "Infermeria", "«Revoca l'iPhone» sa della stazione collegata dal telefono (la pagina chiede se scollegarla)");
  await pc.ev("stm.presa.ferma()");
});

sezione("il sito che divide l'origine con l'app del telefono");
{
  const h = leggiSe("../public/_headers");
  const csp = (/Content-Security-Policy:\s*(.+)/i.exec(h) || [])[1] || "";
  const script = (/script-src ([^;]+)/.exec(csp) || [])[1] || "";
  check(/^\/\*\s*$/m.test(h) && script.trim() === "'self'" && /object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /base-uri 'self'/.test(csp),
    `le pagine di EKG Atlas hanno una CSP stretta (public/_headers): solo i loro script, niente in linea, niente da fuori (script-src ${script || "—"})`);
  check(/camera=\(self\)/.test(L.intestazioniApp("https://x/ponte/")["permissions-policy"]), "…e /ponte/ tiene le sue (la fotocamera per il QR): le mette il Worker, prima di queste");
}

await relay.chiudi();
console.log(fail ? `\nPONTE-SICUREZZA: ${fail} FALLITI` : "\nPONTE-SICUREZZA: TUTTO OK");
process.exit(fail ? 1 : 0);
