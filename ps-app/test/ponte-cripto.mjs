#!/usr/bin/env node
/*
 * Il ponte, senza browser: la cifratura (HKDF, AES-GCM, numeri d'ordine,
 * dati autenticati, il codice dell'associazione), la logica del ripetitore,
 * il Worker del sito con un ambiente finto, la configurazione di Cloudflare, e il service worker del PC (ponte-sw.js) in
 * una vm, con un telefono finto: le regole della sessione una per una.
 *   node test/ponte-cripto.mjs
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const errore = async (p) => { try { await p; return "nessuno"; } catch (e) { return e.codice || e.message; } };
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
const leggi = (f) => readFileSync(join(root, f), "utf8");
const leggiSe = (f) => { try { return leggi(f); } catch { return ""; } };
// un blocco che si rompe a metà è un controllo fallito, non la fine della prova
const blocco = (fn) => fn().catch((e) => check(false, `blocco interrotto: ${e && e.message || e}`));

await import(join(root, "../public/ponte/cripto.js"));
const P = globalThis.PonteCripto;

console.log("\nponte: la cifratura");
check(leggi("extension/ponte-cripto.js") === leggi("../public/ponte/cripto.js"),
  "l'estensione e il telefono usano lo stesso file (extension/ponte-cripto.js = public/ponte/cripto.js)");
const K = P.casuale(32), K2 = P.casuale(32);
const a = await P.chiaviCoppia(K), a2 = await P.chiaviCoppia(new Uint8Array(K)), b = await P.chiaviCoppia(K2);
check(/^[0-9a-f]{32}$/.test(a.stanza) && a.stanza === a2.stanza && a.stanza !== b.stanza,
  `la stanza viene da K (stessa K, stessa stanza; un'altra K, un'altra): ${a.stanza}`);
check(await errore(P.chiaviCoppia(P.casuale(31))) !== "nessuno", "una chiave che non è di 32 byte non vale");
const cod = await P.codice(K);
check(/^\d{3} \d{3}$/.test(cod) && cod === await P.codice(new Uint8Array(K)) && cod !== await P.codice(K2),
  `il codice dell'associazione: sei cifre da K, uguali sul PC e sul telefono solo con la stessa chiave (${cod})`);

// il saluto, nei due versi, con le sue chiavi
const s1 = await P.sigilla(a.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: "abc" });
check((await P.apri(a.salutoTel, s1, P.TIPO.SALUTO_TEL)).dati.n === "abc", "il saluto del telefono si apre con la chiave di quel verso");
check(await errore(P.apri(a.salutoPc, s1, P.TIPO.SALUTO_TEL)) === "chiave", "…e non con quella dell'altro verso");
check(await errore(P.apri(b.salutoTel, s1, P.TIPO.SALUTO_TEL)) === "chiave", "…né con quella di un'altra associazione");
check(await errore(P.apri(a.salutoTel, s1, P.TIPO.SALUTO_PC)) === "tipo", "un tipo inatteso si scarta prima di decifrare");

// la sessione: due numeri casuali, chiavi nuove
const nT = P.casuale(16), nP = P.casuale(16);
const sTel = P.canaleTel(await P.chiaviSessione(K, nT, nP));
const sPc = P.canalePc(await P.chiaviSessione(K, nT, nP));
const f1 = await sTel.cifra({ cmd: "pazienti", id: 1 });
check((await sPc.decifra(f1)).cmd === "pazienti", "telefono → PC: decifrato con le chiavi della sessione");
check((await sTel.decifra(await sPc.cifra({ re: 1, ok: true }))).ok === true, "PC → telefono: anche");
check(await errore(sPc.decifra(f1)) === "ripetuto", "lo stesso messaggio due volte: il secondo si scarta (ripetuto)");
const f2 = await sTel.cifra({ id: 2 }), f3 = await sTel.cifra({ id: 3 });
check((await sPc.decifra(f3)).id === 3 && await errore(sPc.decifra(f2)) === "ripetuto",
  "arrivato dopo uno più nuovo: scartato (il numero d'ordine cresce sempre)");
await sTel.cifra({ id: 4 });   // perso per strada
check((await sPc.decifra(await sTel.cifra({ id: 5 }))).id === 5, "un messaggio perso per strada non blocca i successivi");
const altra = P.canalePc(await P.chiaviSessione(K, P.casuale(16), nP));
check(await errore(altra.decifra(await sTel.cifra({ id: 6 }))) === "chiave", "un'altra sessione (un altro numero casuale) ha chiavi sue");
check(await errore(P.canalePc(await P.chiaviSessione(K2, nT, nP)).decifra(await sTel.cifra({ id: 7 }))) === "chiave",
  "un'altra associazione con gli stessi numeri: niente");
// «ripetuto» si decide DOPO aver decifrato: il primo messaggio (n. 1) di una
// sessione nuova, arrivato alla sessione vecchia (già al n. 7), non è «ripetuto»
// ma «non è mio» — e chi lo riceve prova la sessione nuova
const nuovaTel = P.canaleTel(await P.chiaviSessione(K, P.casuale(16), nP));
check(await errore(sPc.decifra(await nuovaTel.cifra({ id: 1, cmd: "ciao" }))) === "chiave",
  "il n. 1 di un'altra sessione non passa per «ripetuto» (solo un messaggio decifrato può esserlo)");

// manomissioni: testata (AAD), testo cifrato, versione
const buono = await sTel.cifra({ id: 8, cmd: "nota", testo: "ROSSI" });
const cambia = (f, i, x) => { const g = new Uint8Array(f); g[i] ^= x; return g; };
check(await errore(sPc.decifra(cambia(buono, 9, 0x40))) === "chiave", "un numero d'ordine cambiato rompe l'autenticazione (è nei dati autenticati)");
check(await errore(sPc.decifra(cambia(buono, buono.length - 3, 1))) === "chiave", "un byte del testo cifrato cambiato: scartato");
check(await errore(sPc.decifra(cambia(buono, 0, 0x7))) === "versione", "un'altra versione: scartata");
check(await errore(sPc.decifra(buono.subarray(0, 20))) !== "nessuno", "un messaggio troncato: scartato");
check((await sPc.decifra(buono)).testo === "ROSSI", "e l'originale passa ancora, dopo i tentativi falliti");
const x1 = await P.sigilla(a.salutoTel, 1, 0, { n: 1 }), x2 = await P.sigilla(a.salutoTel, 1, 0, { n: 1 });
check(Buffer.compare(Buffer.from(x1), Buffer.from(x2)) !== 0, "lo stesso messaggio cifrato due volte non è mai uguale (IV casuale)");
check(!Buffer.from(buono).toString("latin1").includes("ROSSI") && !Buffer.from(buono).toString("latin1").includes("nota"), "dentro il messaggio non si legge niente in chiaro");
// in parallelo: escono in ordine
const tanti = await Promise.all([1, 2, 3, 4, 5].map((i) => sTel.cifra({ id: 100 + i })));
let inOrdine = true;
for (const f of tanti) inOrdine = inOrdine && !!(await sPc.decifra(f).catch(() => null));
check(inOrdine, "cinque messaggi cifrati insieme escono in ordine: nessuno scartato dall'altra parte");

// il frammento del QR
const fr = P.frammento(K, 1893456000000);
const letto = P.leggiFrammento("#" + fr);
check(letto && letto.scade === 1893456000000 && Buffer.compare(Buffer.from(letto.k), Buffer.from(K)) === 0, `il frammento del QR torna com'era (#${fr.slice(0, 12)}…)`);
check(P.leggiFrammento("#k=abc&scade=1") === null && P.leggiFrammento("#k=" + P.b64u(K)) === null && P.leggiFrammento("") === null,
  "un frammento monco o sbagliato non vale");

console.log("\nponte: la logica del ripetitore");
const L = await import(join(root, "../worker/ponte-logica.js"));
const { Stanza, PONTE, leggiStanza, intestazioniApp } = L;
check(leggiStanza("https://x/ponte/ws?r=" + a.stanza + "&ruolo=pc").ok && !leggiStanza("https://x/ponte/ws?r=zz&ruolo=pc").ok
  && !leggiStanza("https://x/ponte/ws?r=" + a.stanza + "&ruolo=altro").ok, "la stanza è 32 cifre esadecimali, il ruolo pc o tel");
const finto = () => {
  const prese = [];
  const io = {
    prese, inviati: [], chiusi: [],
    socket: (ruolo, escluso) => prese.find((p) => p !== escluso && p.aperta && p.st?.ruolo === ruolo) || null,
    invia: (p, d) => io.inviati.push([p.nome, d]),
    chiudi: (p, c, perche) => { p.aperta = false; io.chiusi.push([p.nome, c, perche]); },
    leggi: (p) => p.st || null, scrivi: (p, s) => { p.st = s; }, ultimo: (p) => p.st?.ultimo || 0,
  };
  const nuova = (nome) => { const p = { nome, aperta: true }; prese.push(p); return p; };
  return { io, nuova, st: new Stanza(io) };
};
{
  const { io, nuova, st } = finto();
  const pc = nuova("pc"), tel = nuova("tel");
  st.entra(pc, "pc", 0);
  check(JSON.stringify(io.inviati) === JSON.stringify([["pc", '{"pari":false}']]), "il PC entra da solo: «dall'altra parte non c'è nessuno»");
  st.entra(tel, "tel", 0);
  check(io.inviati.slice(1).map((x) => x.join(" ")).join(" | ") === 'tel {"pari":true} | pc {"pari":true}', "entra il telefono: lo sanno tutti e due");
  io.inviati.length = 0;
  const dati = new Uint8Array([1, 2, 3]);
  st.messaggio(tel, dati, 1);
  st.messaggio(tel, "ciao in chiaro", 2);
  check(io.inviati.length === 1 && io.inviati[0][0] === "pc" && io.inviati[0][1] === dati, "il binario passa all'altra presa così com'è; il testo non passa");
  const tel2 = nuova("tel2");
  st.entra(tel2, "tel", 3);
  check(io.chiusi.some(([n, c]) => n === "tel" && c === 4001), "una presa nuova dello stesso ruolo chiude la vecchia (4001)");
  io.inviati.length = 0;
  st.esce(tel);
  check(io.inviati.length === 0, "…e la vecchia che esce non dice al PC «non c'è più nessuno»");
  st.messaggio(tel2, new Uint8Array(PONTE.frameMax + 1), 4);
  check(io.chiusi.some(([n, c]) => n === "tel2" && c === 1009), "un messaggio oltre 1 MB chiude la presa (1009)");
  st.esce(tel2);
  check(io.inviati.some(([n, d]) => n === "pc" && d === '{"pari":false}'), "il telefono esce: il PC lo sa");
}
{
  const { io, nuova, st } = finto();
  const pc = nuova("pc");
  st.entra(pc, "pc", 0);
  for (let i = 0; i <= PONTE.alMinuto; i++) st.messaggio(pc, new Uint8Array(1), 1000);
  check(io.chiusi.some(([n, c]) => n === "pc" && c === 1008), `più di ${PONTE.alMinuto} messaggi in un minuto: chiusa (1008)`);
  const p2 = nuova("p2"), p3 = nuova("p3");
  st.entra(p2, "pc", 0); st.entra(p3, "tel", PONTE.inattivoMs);
  const vive = st.pulisci([p2, p3], PONTE.inattivoMs + 1000);
  check(vive === 1 && io.chiusi.some(([n, c]) => n === "p2" && c === 4002), "una presa muta da troppo si chiude (4002), l'altra resta");
}
check(!("eco" in L) && !("intestazioniSalute" in L) && !/eco|salute/i.test(Object.keys(PONTE).join()),
  "niente più prova d'eco né «salute»: il ripetitore fa solo il ripetitore");
check(/connect-src 'self' wss:\/\/ekg\.example\.dev;/.test(intestazioniApp("https://ekg.example.dev/ponte/")["content-security-policy"]),
  "l'app del telefono può parlare solo col suo sito");

console.log("\nponte: il Worker del sito (con un ambiente finto)");
// «cloudflare:workers» esiste solo su Cloudflare: qui una classe vuota
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
    return next(s, c);
  }`));
const worker = (await import(join(root, "../worker/index.js"))).default;
const chiamate = [];
const ambiente = (extra = {}) => ({
  ASSETS: { fetch: async (req) => { chiamate.push(["assets", new URL(req.url).pathname]); return new Response("file", { status: 200, headers: { "content-type": "text/html", etag: "x" } }); } },
  PONTE: {
    idFromName: (n) => ({ nome: n }),
    get: (id) => ({ fetch: async () => { chiamate.push(["stanza", id.nome]); return new Response("stanza"); } }),
  },
  ...extra,
});
const chiedi = (path, init, env = ambiente(), host = "https://ekg.example.dev") => worker.fetch(new Request(host + path, init), env, {});
let r = await chiedi("/");
check(r.status === 200 && chiamate.at(-1)[1] === "/" && !r.headers.get("content-security-policy"), "il sito: «/» va ai file statici, come prima, senza intestazioni nuove");
r = await chiedi("/api/metrics", { method: "POST", body: JSON.stringify({ e: "visit", i: "x" }) });
check(r.status === 204, "POST /api/metrics: il gestore delle metriche di sempre (204)");
r = await chiedi("/ponte/");
check(chiamate.at(-1)[1] === "/ponte/" && /frame-ancestors 'none'/.test(r.headers.get("content-security-policy") || "")
  && r.headers.get("referrer-policy") === "no-referrer" && r.headers.get("etag") === "x", "/ponte/: i file dell'app, con le sue intestazioni di sicurezza");
let n0 = chiamate.length;
r = await chiedi("/ponte/manca.js");
check(r.status === 404 && chiamate.length === n0, "un file che l'app non ha, sotto /ponte/: 404, mai la pagina del sito");
for (const via2 of ["/ponte/eco", "/ponte/salute"]) {
  r = await chiedi(via2, { headers: { upgrade: "websocket" } });
  check(r.status === 404 && chiamate.length === n0, `${via2}: non c'è più (404)`);
}
r = await chiedi("/ponte/ws?r=" + a.stanza + "&ruolo=pc");
check(r.status === 426, "/ponte/ws senza WebSocket: 426");
r = await chiedi("/ponte/ws?r=nonvalida&ruolo=pc", { headers: { upgrade: "websocket" } });
check(r.status === 400 && chiamate.length === n0, "/ponte/ws con una stanza non valida: 400, e nessun Durable Object svegliato");
r = await chiedi("/ponte/ws?r=" + a.stanza + "&ruolo=tel", { headers: { upgrade: "websocket" } });
check(chiamate.at(-1)[0] === "stanza" && chiamate.at(-1)[1] === a.stanza, "/ponte/ws: alla stanza giusta (un Durable Object per stanza)");

console.log("\nponte: la configurazione di Cloudflare");
const jsonc = (t) => JSON.parse(t.replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, ""));
const cfg = jsonc(readFileSync(join(root, "../wrangler.jsonc"), "utf8"));
check(cfg.main === "worker/index.js" && cfg.migrations.some((m) => (m.new_sqlite_classes || []).includes("PonteStanza"))
  && cfg.assets.not_found_handling === "single-page-application", "wrangler.jsonc: il Worker, il Durable Object su SQLite, il sito resta una SPA");
check(cfg.observability.logs && cfg.observability.logs.invocation_logs === false, "nessuna riga di log per richiesta: l'indirizzo della presa porta la stanza");
check(JSON.stringify(cfg.assets.run_worker_first) === '["/ponte/*","/api/*"]',
  "il Worker si sveglia solo per /ponte/ e /api/: le pagine del sito arrivano dai file statici");
check(!cfg.vars?.PONTE_HOSTNAME && !leggiSe("../wrangler.ponte.jsonc") && !("instrada" in L) && !/PONTE_HOSTNAME/.test(leggi("../worker/index.js")),
  "un Worker solo, quello del sito sul suo workers.dev: niente nome a sé, niente Worker a parte");

console.log("\nponte: l'indirizzo fissato nella build");
const { origineDelPonte } = await import(join(root, "ponte/host.mjs"));
check(origineDelPonte("ekg-atlas.esempio.workers.dev\n") === "https://ekg-atlas.esempio.workers.dev" && origineDelPonte("# commento\nhttps://ekg-atlas.esempio.workers.dev/ponte/") === "https://ekg-atlas.esempio.workers.dev"
  && origineDelPonte("# solo commenti\n\n") === "", "ponte/host.txt: il nome del Worker, o un indirizzo https, diventa l'origine; vuoto, «da configurare»");
const prova = (t) => errore((async () => origineDelPonte(t))());
check(await prova("http://ponte.example.org") !== "nessuno" && await prova("ponte example") !== "nessuno",
  "un indirizzo non https, o storto, ferma la build");
const fisso = /const PONTE_HOST_FISSO = (".*?");/.exec(leggiSe("extension/ponte-host.js"));
check(!!fisso && JSON.parse(fisso[1]) === origineDelPonte(leggi("ponte/host.txt")), `extension/ponte-host.js è quello di ponte/host.txt (${fisso && fisso[1]})`);
check(!/id="host"|id="salva"/.test(leggi("extension/ponte.html")) && !/ponteOrigine|ponteHost\b|indirizzo cambiato/.test(leggi("extension/ponte-sw.js") + leggi("extension/ponte.js")),
  "nessuna pagina può cambiare l'indirizzo del ponte: niente campo, niente «salva»");

// ===========================================================================
console.log("\nponte: il service worker del PC (ponte-sw.js in una vm, con un telefono finto)");
const EXT = (f) => leggi("extension/" + f);
const GEST = "https://smarthealth.multimedica.it/sa4pso/";
// Un PC finto: chrome.* in memoria, una WebSocket finta che registra, le
// schede del gestionale che rispondono come dice `scheda`. `sessione` è
// storage.session: lo stesso oggetto dato a un secondo PC finto è il service
// worker che riparte.
async function pcFinto({ sessione = {}, locale = {}, scheda = null, gest = null } = {}) {
  const prese = [], comandi = [], schede = [], tolte = [], ascolta = { msg: [], cambi: [], via: [] };
  class Presa {
    constructor(url) { this.url = url; this.readyState = 0; this.inviati = []; prese.push(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.(); } }, 0); }
    send(d) { this.inviati.push(d); }
    close() { this.readyState = 3; }
  }
  const area = (obj, nome) => ({
    get: async (k) => { const o = {}; for (const x of k == null ? Object.keys(obj) : [].concat(k)) if (x in obj) o[x] = structuredClone(obj[x]); return o; },
    set: async (o) => {
      const ch = {};
      for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: obj[k], newValue: structuredClone(v) }; obj[k] = structuredClone(v); }
      for (const f of ascolta.cambi) f(ch, nome);
    },
    remove: async (k) => { for (const x of [].concat(k)) delete obj[x]; },
  });
  const davanti = { id: 7, url: GEST + "menuPsoEpisodio.do?EPISODIO_ID=1", active: true, windowId: 1, index: 0 };
  const chrome = {
    storage: { local: area(locale, "local"), session: area(sessione, "session"), onChanged: { addListener: (f) => ascolta.cambi.push(f) } },
    runtime: { onMessage: { addListener: (f) => ascolta.msg.push(f) }, onStartup: { addListener() {} }, getURL: (p) => "chrome-extension://abc/" + p },
    tabs: {
      query: async () => gest || [davanti],
      sendMessage: async (id, m) => { comandi.push({ ...m, scheda: id }); return scheda ? scheda(m, sessione, id) : { ok: true, dati: [] }; },
      create: async (o) => { const t = { id: 90 + schede.length, active: false, ...o }; schede.push(t); return t; },
      update: async () => ({}),
      get: async (id) => schede.find((t) => t.id === id) || null,
      remove: async (id) => { tolte.push(id); },
      onRemoved: { addListener: (f) => ascolta.via.push(f) },
    },
    windows: { getLastFocused: async () => null },
  };
  const ctx = vm.createContext({
    chrome, WebSocket: Presa, crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, URL, URLSearchParams, console, structuredClone,
    setTimeout, clearTimeout, setInterval: () => 0, __salto: 0,
    ordLeggi: async () => sessione.ordini || [], sulGestionale: (u) => String(u || "").startsWith(GEST), leggibileOrd: () => true,
    corto: (s, n = 160) => String(s == null ? "" : s).slice(0, n),
  });
  vm.runInContext('const PONTE_HOST_FISSO = "https://ponte.example.org";' + "\nDate.now = ((v) => () => v() + globalThis.__salto)(Date.now);", ctx);
  vm.runInContext(EXT("ponte-cripto.js"), ctx);
  vm.runInContext(EXT("ponte-sw.js"), ctx);
  const ev = (codice) => vm.runInContext(codice, ctx);
  await ev("ponteCaricato");
  await sospendi(20);
  const presa = () => prese.at(-1);
  const pc = {
    ctx, ev, prese, presa, comandi, schede, tolte, sessione, locale,
    pt: () => ev("pt"),
    chiudiScheda: (id) => { for (const f of ascolta.via) f(id); },
    salta: (ms) => { ctx.__salto += ms; },
    // dal ripetitore al PC (e la fila del PC finita)
    consegna: async (u8) => { presa().onmessage({ data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) }); await sospendi(15); await ev("pt.fila"); await sospendi(15); },
    testo: async (t) => { presa().onmessage({ data: t }); await sospendi(15); await ev("pt.fila"); },
    // quello che il PC ha mandato da allora, in binario
    tira: () => prese.flatMap((p) => p.inviati.splice(0)).filter((x) => typeof x !== "string").map((x) => new Uint8Array(x)),
    // una pagina dell'estensione (o una scheda del gestionale) che chiede
    pagina: (m, sender = { url: "chrome-extension://abc/ponte.html" }) => new Promise((ok) => {
      let fatto = false;
      for (const f of ascolta.msg) f(m, sender, (x) => { if (!fatto) { fatto = true; ok(x); } });
      setTimeout(() => { if (!fatto) ok(undefined); }, 3000);
    }),
  };
  return pc;
}
// Un telefono finto: saluta col suo numero, apre la sessione, chiede.
async function telFinto(pc, k, dev) {
  const ch = await P.chiaviCoppia(k);
  const nTel = P.casuale(16);
  const saluto = await P.sigilla(ch.salutoTel, P.TIPO.SALUTO_TEL, 0, { v: 1, n: P.b64u(nTel), dev });
  await pc.consegna(saluto);
  let r = null;
  for (const f of pc.tira()) { try { const x = (await P.apri(ch.salutoPc, f, P.TIPO.SALUTO_PC)).dati; if (x.eco === P.b64u(nTel)) r = x; } catch { /* altro */ } }
  const t = { ch, nTel: P.b64u(nTel), risposta: r, canale: r && r.n ? P.canaleTel(await P.chiaviSessione(k, nTel, P.daB64u(r.n))) : null };
  // un comando, e quello che torna (le risposte e gli eventi cifrati; il resto com'è)
  t.leggi = async (frames) => {
    const out = [];
    for (const x of frames) { try { out.push(await t.canale.decifra(x)); } catch { out.push({ grezzo: x }); } }
    return out;
  };
  // (il PC risponde quando ha finito: si aspetta la sua risposta, o un saluto, al massimo un secondo e mezzo)
  t.manda = async (obj) => {
    await pc.consegna(await t.canale.cifra(obj));
    const out = [];
    for (const t0 = Date.now(); Date.now() - t0 < 1500; await sospendi(10)) {
      out.push(...await t.leggi(pc.tira()));
      if (out.some((x) => x.re === obj.id || x.grezzo)) break;
    }
    return out;
  };
  return t;
}
const kDalQr = (qr) => P.leggiFrammento(new URL(qr).hash).k;
const DEV = P.b64u(P.casuale(16)), DEV2 = P.b64u(P.casuale(16));
await blocco(async () => {
  const pc = await pcFinto({ locale: { "ponte.coppia": { k: "vecchia", scade: Date.now() + 3600e3 } } });
  check(pc.pt().relay === "spento" && !pc.prese.length && !("ponte.coppia" in pc.locale), "senza associazione il PC non apre niente (e una chiave rovinata su disco se ne va)");
  const r1 = await pc.pagina({ t: "ponteAssocia" });
  await sospendi(30);
  const k = r1 && r1.qr ? kDalQr(r1.qr) : null;
  check(!!k && r1.qr.startsWith("https://ponte.example.org/ponte/#k=") && pc.presa()?.url === `wss://ponte.example.org/ponte/ws?r=${(await P.chiaviCoppia(k)).stanza}&ruolo=pc`,
    "«Associa»: il QR porta al ponte fissato nella build, e il PC entra nella stanza di quella chiave");
  check(r1.codice === await P.codice(k), `accanto al QR, il codice dell'associazione (${r1.codice})`);
  check((await pc.pagina({ t: "ponteStato" })).qr === r1.qr, "nei primi due minuti «Mostra il QR» rivede lo stesso QR");
  pc.salta(3 * 60e3);
  check((await pc.pagina({ t: "ponteStato" })).qr === "", "dopo due minuti non si rivede più (serve un QR nuovo)");
  pc.salta(-3 * 60e3);
  check((await pc.pagina({ t: "ponteStato" }, { url: GEST + "x", tab: { id: 7 } })).ok === false, "una scheda del gestionale non ha il QR");
  pc.locale["ponte.host"] = "https://altro.example.org";
  await pc.ev("ponteAvvia()");
  check(pc.pt().host === "https://ponte.example.org", "un indirizzo scritto in storage.local non cambia il ponte…");
  pc.locale["ponte.host"] = "http://localhost:8787";
  await pc.ev("ponteAvvia()");
  check(pc.pt().host === "http://localhost:8787", "…a meno che sia questo PC (http://localhost: le prove)");
  delete pc.locale["ponte.host"];
  await pc.ev("ponteAvvia()");
  await sospendi(30);

  // il primo telefono che entra è quello dell'associazione
  const t1 = await telFinto(pc, k, DEV);
  check(!!t1.canale && !!pc.pt().attesa, "il telefono saluta (col suo numero): il PC risponde al suo saluto");
  const c1 = await t1.manda({ id: 1, cmd: "ciao" });
  check(c1[0] && c1[0].ok && !!pc.pt().sessione, "il primo messaggio apre la sessione");
  check(pc.locale["ponte.coppia"].dev === DEV && pc.locale["ponte.coppia"].usata === true, "l'associazione è legata a quel telefono");
  check((await pc.pagina({ t: "ponteStato" })).qr === "", "e il QR non si rivede più, nemmeno nei due minuti");
  const intruso = await telFinto(pc, k, DEV2);
  check(!intruso.canale && intruso.risposta && intruso.risposta.no && !pc.pt().attesa,
    "un altro telefono con lo stesso QR: il PC dice di no (e nessuna sessione nuova)");
  check(/altro telefono/.test(pc.pt().registro.map((x) => x.testo).join("\n")), "e il registro del ponte lo dice");

  // il browser si chiude e si riapre: storage.session è vuoto, storage.local (il disco) no
  const pcR = await pcFinto({ locale: structuredClone(pc.locale) });
  await sospendi(30);
  check(!!pcR.pt().coppia && pcR.presa()?.url === pc.presa().url, "il browser chiuso e riaperto: l'associazione c'è ancora (storage.local), e il PC rientra nella sua stanza");
  const tR = await telFinto(pcR, k, DEV);
  check(!!tR.canale && (await tR.manda({ id: 1, cmd: "ciao" })).some((x) => x.re === 1 && x.ok), "lo stesso telefono riapre, senza QR");
  check(!(await telFinto(pcR, k, DEV2)).canale, "un altro telefono no, nemmeno dopo");
  pcR.salta(14 * 3600e3);
  await pcR.ev("ponteControlla()");
  check(!pcR.pt().coppia && !("ponte.coppia" in pcR.locale) && pcR.presa().readyState === 3, "alla scadenza delle 14 ore la chiave se ne va anche dal disco, e la presa si chiude");

  // la pagina del telefono si ricarica mentre la sessione vecchia è viva
  for (let i = 2; i <= 6; i++) await t1.manda({ id: i, cmd: "pazienti" });
  const t2 = await telFinto(pc, k, DEV);
  const c2 = await t2.manda({ id: 1, cmd: "ciao" });
  check(c2[0] && c2[0].ok && pc.pt().sessione && pc.pt().sessione.n === 1, "il telefono ricaricato apre subito una sessione nuova (il suo n. 1 non è «ripetuto»)");
  // il vecchio canale non vale più
  const vecchio = await t1.manda({ id: 7, cmd: "pazienti" });
  check(!vecchio.some((x) => x.re === 7), "e la sessione vecchia non risponde più");

  // messaggi non validi: si ignorano, la sessione resta
  for (let i = 0; i < 6; i++) await pc.consegna(new Uint8Array([1, 3, 0, 0, 0, 0, 0, 0, 0, 99 + i, ...P.casuale(40)]));
  check(!!pc.pt().sessione && (await t2.manda({ id: 2, cmd: "pazienti" })).some((x) => x.re === 2 && x.ok),
    "sei messaggi non validi di fila (chi non ha le chiavi): ignorati, la sessione resta e risponde");

  // i 20 minuti: contano solo i comandi del medico
  pc.pt().sessione.ultimo = Date.now() - 19 * 60e3;
  await t2.manda({ id: 3, cmd: "ordini" });
  await t2.manda({ id: 4, cmd: "pazienti", auto: true });
  check(Date.now() - pc.pt().sessione.ultimo > 18 * 60e3, "«ordini» e i comandi che l'app manda da sé non tengono aperta la sessione");
  await t2.manda({ id: 5, cmd: "pazienti" });
  check(Date.now() - pc.pt().sessione.ultimo < 5000, "un comando del medico sì");
  pc.pt().sessione.ultimo = Date.now() - 21 * 60e3;
  await t2.manda({ id: 6, cmd: "ordini" });
  await pc.ev("ponteControlla()");
  check(!pc.pt().sessione && pc.pt().fine && pc.pt().fine.perche === "inattivo", "20 minuti senza comandi del medico: chiusa, anche se l'app ha chiesto «ordini»");

  // l'ordine: il numero lo dà il telefono
  const t3 = await telFinto(pc, k, DEV);
  await t3.manda({ id: 1, cmd: "ciao" });
  pc.comandi.length = 0;
  const senza = await t3.manda({ id: 2, cmd: "ordina", ep: "1", esami: ["lab:A1"], quesito: "q" });
  check(senza[0] && senza[0].ok === false && !pc.comandi.length, "un ordine senza numero (oid) non arriva a nessuna scheda");
  await t3.manda({ id: 3, cmd: "ordina", ep: "1", oid: "abcDEF12_-", esami: ["lab:A1", "lab:../x"], quesito: "q".repeat(500), url: "https://male/", piano: {} });
  await t3.manda({ id: 4, cmd: "ordina", ep: "1", oid: "abcDEF12_-", esami: ["lab:A1"], quesito: "q" });
  const ord = pc.comandi.filter((m) => m.cmd === "ordina");
  check(ord.length === 2 && ord.every((m) => m.args.id === "telabcDEF12_-"), "la stessa conferma due volte: lo stesso ordine, «tel»+oid (e bg.js lo manda una volta: ordiniVisti)");
  check(JSON.stringify(ord[0].args.esami) === '["lab:A1"]' && ord[0].args.quesito.length === 300 && !("url" in ord[0].args) && !("piano" in ord[0].args),
    "gli argomenti dell'ordine passano solo controllati");
  await t3.manda({ id: 5, cmd: "ordina", ep: "1", oid: "x<y>", esami: ["lab:A1"], quesito: "q" });
  check(pc.comandi.filter((m) => m.cmd === "ordina").length === 2, "un oid storto non passa");

  // «riparti»: legato alla sessione di cui parla
  await t3.manda({ id: 6, cmd: "esci" });
  check(!pc.pt().sessione, "«esci»: sessione chiusa");
  const dopo = await t3.manda({ id: 7, cmd: "pazienti" });
  let rip = null;
  for (const x of dopo) if (x.grezzo) { try { rip = (await P.apri(t3.ch.salutoPc, x.grezzo, P.TIPO.SALUTO_PC)).dati; } catch { /* altro */ } }
  check(rip && rip.riparti && rip.eco === t3.nTel && /Chiusa dall'iPhone/.test(rip.testo || ""),
    "dati per una sessione che non c'è: «riparti», col numero del saluto di QUELLA sessione (un altro telefono, o la stessa ripetuta dopo, lo ignora) e la frase");

  // il battito: senza «pong» la presa si rifà
  const prima = pc.prese.length, morta = pc.presa();
  pc.ev("PONTE_ATTESA.pong = 40; ponteBattito()");
  check(morta.inviati.includes("ping"), "il battito: un «ping»");
  await sospendi(120);
  check(pc.prese.length === prima + 1 && morta.readyState === 3, "nessun «pong» entro l'attesa: la presa vecchia si chiude, se ne apre un'altra");
  const viva = pc.presa();
  await sospendi(20);
  pc.ev("ponteBattito()");
  await pc.testo("pong");
  await sospendi(80);
  check(pc.presa() === viva, "col «pong» resta quella");
  pc.ev("PONTE_ATTESA.pong = 10e3");

  // il gestionale torna alla pagina d'accesso: via la sessione, non l'associazione
  const t4 = await telFinto(pc, k, DEV);
  await t4.manda({ id: 1, cmd: "ciao" });
  check(!!pc.pt().sessione, "(una sessione aperta)");
  check((await pc.pagina({ t: "ponteLogin" }, { url: "https://altro.example/", tab: { id: 3 } })).ok === false && !!pc.pt().sessione, "«pagina d'accesso» da chi non è il gestionale: niente");
  const fineL = pc.pagina({ t: "ponteLogin" }, { url: GEST + "login.do", tab: { id: 7 } });
  await fineL;
  await sospendi(30);
  const evL = await t4.leggi(pc.tira());
  check(!pc.pt().sessione && pc.locale["ponte.coppia"]?.k === P.b64u(k) && !!pc.pt().coppia, "una scheda del gestionale alla pagina d'accesso: la sessione si chiude, l'associazione resta");
  check(evL.some((x) => x.evento === "fine" && x.perche === "login" && /pagina d'accesso/.test(x.testo)), "e il telefono lo sa, con la frase");
  const t5 = await telFinto(pc, k, DEV);
  check((await t5.manda({ id: 1, cmd: "ciao" })).some((x) => x.re === 1 && x.ok), "rientrati nel gestionale, lo stesso telefono riapre: la stessa associazione, niente QR nuovo");
});
await blocco(async () => {
  // «Aggiorna i valori»: la scheda annotata in storage.session; il service
  // worker riparte a metà, e lei si chiude lo stesso, alla sua ora
  const sessione = {};
  const scheda = (m) => (m.cmd === "aggiornaValori" ? { ok: true, dati: { url: GEST + "menuPsoEpisodio.do?EPISODIO_ID=1", paziente: "ROSSI" } } : { ok: true, dati: [] });
  const pc = await pcFinto({ sessione, scheda });
  const k = kDalQr((await pc.pagina({ t: "ponteAssocia" })).qr);
  await sospendi(30);
  const t = await telFinto(pc, k, DEV);
  await t.manda({ id: 1, cmd: "ciao" });
  t.manda({ id: 2, cmd: "aggiornaValori", ep: "1" });   // non torna: la scheda non finisce mai
  await sospendi(80);
  const id = pc.schede[0] && pc.schede[0].id;
  check(!!id && sessione["ponte.valori"] && sessione["ponte.valori"][id] && sessione["ponte.valori"][id].ep === "1", "la scheda dei valori è annotata in storage.session");
  check((await pc.ev(`ponteLavoroDi(${id})`)).ponteValori.ep === "1", "e lei sa chi è (per bg.js: «chi sono?»)");
  const pc2 = await pcFinto({ sessione, scheda });   // il service worker riparte: niente in memoria
  pc2.schede.push({ id, active: false });
  await pc2.ev("ponteControlla()");
  check(!pc2.tolte.includes(id), "ripartito, la scheda resta finché ha tempo");
  pc2.salta(160e3);
  await pc2.ev("ponteControlla()");
  check(pc2.tolte.includes(id) && !(sessione["ponte.valori"] || {})[id], "passato il tempo, il service worker nuovo la riconosce e la chiude");
  // il medico chiude la scheda dei valori: il telefono lo sa subito, e l'appunto se ne va
  const t2 = await telFinto(pc2, kDalQr((await pc2.pagina({ t: "ponteAssocia" })).qr), DEV);
  await t2.manda({ id: 1, cmd: "ciao" });
  const chiusa = t2.manda({ id: 2, cmd: "aggiornaValori", ep: "1" });
  await sospendi(80);
  const id2 = pc2.schede.at(-1).id;
  pc2.chiudiScheda(id2);
  const r2 = (await chiusa).find((x) => x.re === 2);
  check(r2 && r2.ok === false && /^Valori non aggiornati: .*chiusa/.test(r2.errore) &&!(sessione["ponte.valori"] || {})[id2],
    `chiusa la scheda dei valori: il telefono lo sa subito (${r2 && r2.errore}), e l'appunto se ne va`);
});
await blocco(async () => {
  // la scheda tarda oltre l'attesa: «non si sa», e l'ordine che nasce lo stesso arriva al telefono
  const oid = "lento123";
  let crea = null;
  const scheda = async (m, sessione) => {
    if (m.cmd !== "ordina") return { ok: true, dati: [] };
    crea = sospendi(120).then(async () => {
      const l = [...(sessione.ordini || []), { id: m.args.id + "l", ep: "1", paziente: "ROSSI MARIO", n: 1, stato: "coda", ts: Date.now(), pubblico: { tono: "run", titolo: "In coda", testo: "parte fra poco", dettaglio: "" } }];
      await pc.ev("chrome").storage.session.set({ ordini: l });
    });
    await crea;
    return { ok: true, dati: { ordini: [{ id: m.args.id + "l", ep: "1", paziente: "ROSSI MARIO", n: 1 }] } };
  };
  const pc = await pcFinto({ scheda });
  const k = kDalQr((await pc.pagina({ t: "ponteAssocia" })).qr);
  await sospendi(30);
  const t = await telFinto(pc, k, DEV);
  await t.manda({ id: 1, cmd: "ciao" });
  pc.ev("PONTE_ATTESA.ordina = 30");
  const r = await t.manda({ id: 2, cmd: "ordina", ep: "1", oid, esami: ["lab:A1"], quesito: "q" });
  const risp = r.find((x) => x.re === 2);
  check(risp && risp.ok === false && risp.incerto === true, "la scheda tace oltre l'attesa: la risposta è «non si sa» (incerto), mai un no");
  await crea; await sospendi(80);
  const ev = await t.leggi(pc.tira());
  const visto = ev.find((x) => x.evento === "ordine" && x.ordine.id === "tel" + oid + "l");
  check(!!visto && visto.ordine.titolo === "In coda" && visto.ordine.tono === "run", "l'ordine nato dopo l'attesa arriva al telefono, con le parole di bg.js (pubblico)");
  const lista = await t.manda({ id: 3, cmd: "ordini" });
  check(lista[0] && lista[0].dati.some((o) => o.id === "tel" + oid + "l"), "ed è nella lista degli ordini");
  // sparisce da «ordini» mentre le etichette aspettavano: una scheda del PC le ha prese
  const ses = (await pc.ev("chrome").storage.session.get("ordini")).ordini;
  ses[0].stato = "stampa"; ses[0].pubblico = { tono: "ok", titolo: "Confermata", testo: "Etichette pronte sul PC", dettaglio: "Quesito: il tuo" };
  await pc.ev("chrome").storage.session.set({ ordini: ses });
  await sospendi(60);
  await pc.ev("chrome").storage.session.set({ ordini: [] });
  await sospendi(60);
  const ev2 = await t.leggi(pc.tira());
  const ultimo = ev2.filter((x) => x.evento === "ordine").at(-1);
  check(ultimo && ultimo.ordine.titolo === "Etichette prese in stampa sul PC" && !ultimo.ordine.testo && ultimo.ordine.tono === "ok" && ultimo.ordine.fine === true,
    "sparito da «ordini» mentre le etichette aspettavano: «Etichette prese in stampa sul PC» (il titolo è com'è andata), finito e verde");
  check(ultimo && !/il tuo/.test(ultimo.ordine.dettaglio), `e mai «Quesito: il tuo», la frase del PC (${ultimo && ultimo.ordine.dettaglio})`);
  // le parole sono quelle di bg.js, e dove il telefono dice altro (`tel`), le sue
  pc.ev("PONTE_ATTESA.ordina = 25e3");
  crea = null;
  const r2 = await t.manda({ id: 4, cmd: "ordina", ep: "1", oid: "veloce12", esami: ["lab:A1"], quesito: "dolore toracico" });
  await crea; await sospendi(60);
  const ses2 = (await pc.ev("chrome").storage.session.get("ordini")).ordini;
  const mio = ses2.find((x) => x.id === "telveloce12l");
  mio.stato = "avviso";
  mio.pubblico = { tono: "warn", titolo: "Esito della stampa sconosciuto", testo: "controlla Zebra ZD421: SumatraPDF non ha finito", dettaglio: "Quesito: «dolore toracico»",
    tel: { tono: "warn", titolo: "Etichette forse stampate", testo: "guarda Zebra ZD421 prima di ristamparle dal PC", dettaglio: "1 esame confermato" } };
  await pc.ev("chrome").storage.session.set({ ordini: ses2 });
  await sospendi(80);
  const ev3 = (await t.leggi(pc.tira())).filter((x) => x.evento === "ordine" && x.ordine.id === "telveloce12l").at(-1);
  check(r2.some((x) => x.re === 4 && x.ok) && ev3 && ev3.ordine.titolo === "Etichette forse stampate" && ev3.ordine.testo === "guarda Zebra ZD421 prima di ristamparle dal PC"
    && ev3.ordine.dettaglio === "1 esame confermato" && ev3.ordine.tono === "warn" && ev3.ordine.fine === true,
  `al telefono le parole di bg.js per il telefono (pubblico.tel), non quelle del PC (${ev3 && JSON.stringify([ev3.ordine.titolo, ev3.ordine.testo])})`);
  const sw = EXT("ponte-sw.js");
  check(!/PONTE_TITOLI|PONTE_TONI|ponteResto|quesiti|il tuo/.test(sw),
    "ponte-sw.js non riscrive niente: niente parole sue per un ordine senza «pubblico», niente «Quesito: il tuo» da sostituire (lo fa bg.js)");
});
await blocco(async () => {
  // Un ordine o un promemoria non si rimanda alla scheda dopo quando la prima
  // tace oltre l'attesa: può averlo fatto lei, e sarebbero due.
  const gest = [
    { id: 7, url: GEST + "menuPsoEpisodio.do?EPISODIO_ID=1", active: true, windowId: 1, index: 0 },
    { id: 8, url: GEST + "menuPsoEpisodio.do?EPISODIO_ID=2", active: false, windowId: 1, index: 1 },
  ];
  const fatti = [];
  const scheda = async (m, _s, id) => {
    if (!["promemoria", "ordina", "nota"].includes(m.cmd)) return { ok: true, dati: [] };
    if (id === 7) await sospendi(300);   // una scheda occupata, o rallentata da Chrome
    fatti.push(`${m.cmd}@${id}`);
    return { ok: true, dati: m.cmd === "ordina" ? { ordini: [] } : { ep: "1" } };
  };
  const pc = await pcFinto({ scheda, gest });
  const k = kDalQr((await pc.pagina({ t: "ponteAssocia" })).qr);
  await sospendi(30);
  const t = await telFinto(pc, k, DEV);
  await t.manda({ id: 1, cmd: "ciao" });
  pc.ev("PONTE_ATTESA.altro = 80; PONTE_ATTESA.ordina = 80");
  const r = (await t.manda({ id: 2, cmd: "promemoria", ep: "1", testo: "11:30 tropo" })).find((x) => x.re === 2);
  check(r && r.ok === false && r.incerto === true && /guarda i promemoria prima di rifarlo/.test(r.errore),
    `il promemoria: la scheda tace oltre l'attesa → «non si sa», e lo si dice (${r && r.errore})`);
  await t.manda({ id: 3, cmd: "ordina", ep: "1", oid: "unavolta12", esami: ["lab:A1"], quesito: "q" });
  await sospendi(500);
  const a = (cmd) => pc.comandi.filter((m) => m.cmd === cmd).map((m) => m.scheda);
  check(JSON.stringify(a("promemoria")) === "[7]" && JSON.stringify(a("ordina")) === "[7]" && JSON.stringify(fatti) === '["promemoria@7","ordina@7"]',
    `e non va alla scheda dopo: un promemoria, un ordine, una scheda sola (${JSON.stringify(fatti)})`);
  // una nota si può rifare: la scheda dopo la scrive (la stessa nota due volte è una nota)
  await t.manda({ id: 4, cmd: "nota", ep: "1", testo: "x" });
  await sospendi(400);
  check(JSON.stringify(a("nota")) === "[7,8]", `una nota sì, alla scheda dopo (${JSON.stringify(a("nota"))})`);
});
await blocco(async () => {
  // Le parole di un ordine (ordPubblico, in bg.js): il titolo è com'è andata,
  // l'ora una volta, il PC e il telefono ognuno con le sue.
  const ovunque = () => new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : ovunque()), apply: () => ovunque() });
  const ctx = vm.createContext({ chrome: ovunque(), console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout, setInterval: () => 0, URL,
    importScripts: () => {}, self: ovunque(), fetch: ovunque() });
  vm.runInContext(EXT("bg.js"), ctx);
  const ora = new Date(2026, 9, 27, 14, 32).getTime();
  const fogli = (...l) => l.map(([tipo, stato, stampante, why = ""]) => ({ name: tipo === "etichette" ? "Etichette provette" : "Lista esami", tipo, stato, stampante, why }));
  const rec = (id, stato, f, extra = {}) => ({ id, ep: "1", paziente: "ROSSI MARIO", stato, agg: ora, fogli: f, quesito: id.startsWith("tel") ? "dolore toracico" : "",
    stampa: { jobs: f.map((x) => ({ name: x.name })), riassunto: "2 esami confermati", quesito: "Quesito: il tuo" }, ...extra });
  const pub = (r) => vm.runInContext(`ordPubblico(${JSON.stringify(r)})`, ctx);
  const tutto = (p) => [p.titolo, p.testo, p.dettaglio].join(" | ");
  const ok = pub(rec("pc1", "avviso", fogli(["etichette", "stampato", "Zebra ZD421"], ["a4", "stampato", "HP LaserJet A4"])));
  check(ok.tono === "ok" && ok.titolo === "Stampato su Zebra ZD421 e HP LaserJet A4" && ok.testo === "2 esami confermati alle 14:32" && (tutto(ok).match(/14:32/g) || []).length === 1 && !ok.tel,
    `stampato: il titolo è com'è andata («Stampato su Zebra ZD421 e HP LaserJet A4»), l'ora una volta (${tutto(ok)})`);
  const telOk = pub(rec("telabc12345l", "avviso", fogli(["etichette", "stampato", "Zebra ZD421"])));
  check(/Quesito: «dolore toracico»/.test(telOk.dettaglio) && !/il tuo/.test(tutto(telOk)) && /avvisa chi preleva/.test(telOk.dettaglio),
    `un ordine dal telefono dice il quesito vero, non «Quesito: il tuo» (${telOk.dettaglio})`);
  check(/Quesito: il tuo/.test(ok.dettaglio), "(uno del PC resta com'era: «Quesito: il tuo»)");
  const mandato = pub(rec("pc2", "avviso", fogli(["etichette", "mandato", "Zebra ZD421"], ["a4", "stampato", "HP LaserJet A4"])));
  check(mandato.tono === "warn" && mandato.titolo === "Mandato a Zebra ZD421" && /nella coda di Windows/.test(mandato.dettaglio),
    `«Mandato»: in ambra, mai il verde di «Stampato» — è solo nella coda di Windows (${mandato.tono}: ${tutto(mandato)})`);
  const ignoto = pub(rec("telabc12345l", "avviso", fogli(["etichette", "sconosciuto", "Zebra ZD421", "SumatraPDF non ha finito in 24 secondi: il foglio può essere uscito lo stesso"], ["a4", "stampato", "HP LaserJet A4"])));
  check(ignoto.tono === "warn" && ignoto.titolo === "Esito della stampa sconosciuto" && /controlla Zebra ZD421: SumatraPDF non ha finito/.test(ignoto.testo),
    `esito sconosciuto, sul PC: che cosa controllare, e perché (${tutto(ignoto)})`);
  check(ignoto.tel && ignoto.tel.titolo === "Etichette forse stampate" && ignoto.tel.testo === "guarda Zebra ZD421 prima di ristamparle dal PC" && !/SumatraPDF|Ristampa/.test(tutto(ignoto.tel)),
    `…e sul telefono: «Etichette forse stampate: guarda Zebra ZD421 prima di ristamparle dal PC», senza gergo (${ignoto.tel && tutto(ignoto.tel)})`);
  const aspetta = pub(rec("telabc12345l", "stampa", fogli(["etichette", "attesa", ""])));
  check(aspetta.titolo === "Etichette NON stampate" && aspetta.testo === "tocca Stampa" && !/aspettano qualcuno/.test(tutto(aspetta))
    && aspetta.tel && aspetta.tel.testo === "aspettano qualcuno al PC" && !/tocca Stampa|striscia/.test(tutto(aspetta.tel)),
  `le etichette di un ordine dal telefono: il PC dice «tocca Stampa», il telefono «aspettano qualcuno al PC» — ognuno la sua (${tutto(aspetta)} // ${aspetta.tel && tutto(aspetta.tel)})`);
  const rotta = pub(rec("telabc12345l", "stampa", fogli(["etichette", "fallito", "Zebra ZD421", "la stampante (o il suo driver) ha dato errore"], ["a4", "stampato", "HP LaserJet A4"])));
  check((tutto(rotta).match(/ha dato errore/g) || []).length === 1 && !/aspettano qualcuno/.test(tutto(rotta)) && /aspettano qualcuno al PC/.test(tutto(rotta.tel)),
    `un'etichetta che non esce: il perché una volta sola, non «Zebra ZD421 ha dato errore · la stampante ha dato errore» (${tutto(rotta)})`);
  const spenta = pub(rec("pc3", "stampa", fogli(["etichette", "fallito", "Zebra ZD421", "la stampante «Zebra ZD421» risulta spenta o offline"])));
  check(spenta.titolo === "Etichette NON stampate" && spenta.testo === "la stampante «Zebra ZD421» risulta spenta o offline" && !spenta.tel,
    `…e il perché vero, non «ha dato errore» per una stampante spenta (${tutto(spenta)})`);
  const interrotta = pub(rec("pc4", "avviso", fogli(["etichette", "stampato", "Zebra ZD421"], ["a4", "attesa", ""]), { interrotta: "la scheda dell'ordine si è chiusa" }));
  check(interrotta.titolo === "Stampa interrotta" && /non usciti: Lista esami/.test(interrotta.testo) && /si è chiusa · 2 esami confermati/.test(interrotta.dettaglio),
    `stampa interrotta: il titolo lo dice, non «Confermata» (${tutto(interrotta)})`);
});
await blocco(async () => {
  // un errore nel ponte non ferma il service worker
  const ovunque = () => new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : ovunque()), apply: () => ovunque() });
  const ctx = vm.createContext({ chrome: ovunque(), console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout, setInterval: () => 0, URL,
    importScripts: () => { throw new Error("ponte rotto"); }, self: ovunque(), fetch: ovunque() });
  let rotto = "";
  try { vm.runInContext(EXT("bg.js"), ctx); } catch (e) { rotto = e.message; }
  check(!rotto, `un errore nel codice del ponte non ferma bg.js (ordini, referti, stampe)${rotto ? ": " + rotto : ""}`);
});
await blocco(async () => {
  // il telefono aspetta «Aggiorna i valori» almeno quanto il PC, al peggio
  const n = (re, t) => Number(re.exec(t)[1]);
  const sw = EXT("ponte-sw.js"), app = leggi("../public/ponte/app.js");
  const pcMax = n(/PONTE_VALORI_MAX = ([\d.e]+);/, sw) + n(/esiti: ([\d.e]+)/, sw) + n(/altro: ([\d.e]+)/, sw);
  const tel = n(/ATTESA_VALORI = ([\d.e]+);/, app);
  check(tel >= pcMax && tel <= pcMax + 30e3, `«Aggiorna i valori»: il telefono aspetta ${tel / 1000} s, il PC al peggio ${pcMax / 1000} s`);
});

console.log(fail ? `\nPONTE-CRIPTO: ${fail} CHECK FALLITI\n` : "\nPONTE-CRIPTO: TUTTO OK\n");
process.exit(fail ? 1 : 0);
