#!/usr/bin/env node
/*
 * Il ponte, senza browser: la cifratura (HKDF, AES-GCM, numeri d'ordine,
 * dati autenticati), la logica del ripetitore e il Worker del sito con un
 * ambiente finto.
 *   node test/ponte-cripto.mjs
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const errore = async (p) => { try { await p; return "nessuno"; } catch (e) { return e.codice || e.message; } };

await import(join(root, "../public/ponte/cripto.js"));
const P = globalThis.PonteCripto;

console.log("\nponte: la cifratura");
check(readFileSync(join(root, "extension/ponte-cripto.js"), "utf8") === readFileSync(join(root, "../public/ponte/cripto.js"), "utf8"),
  "l'estensione e il telefono usano lo stesso file (extension/ponte-cripto.js = public/ponte/cripto.js)");
const K = P.casuale(32), K2 = P.casuale(32);
const a = await P.chiaviCoppia(K), a2 = await P.chiaviCoppia(new Uint8Array(K)), b = await P.chiaviCoppia(K2);
check(/^[0-9a-f]{32}$/.test(a.stanza) && a.stanza === a2.stanza && a.stanza !== b.stanza,
  `la stanza viene da K (stessa K, stessa stanza; un'altra K, un'altra): ${a.stanza}`);
check(await errore(P.chiaviCoppia(P.casuale(31))) !== "nessuno", "una chiave che non è di 32 byte non vale");

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
const { Stanza, PONTE, leggiStanza, eco, intestazioniApp } = await import(join(root, "../worker/ponte-logica.js"));
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
check(eco("x".repeat(10)) === "x".repeat(10) && eco("x".repeat(PONTE.ecoMax + 1)) === null, "la prova della rete rimanda solo messaggi piccoli");
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
const env = {
  ASSETS: { fetch: async (req) => { chiamate.push(["assets", new URL(req.url).pathname]); return new Response("file", { status: 200, headers: { "content-type": "text/html" } }); } },
  PONTE: {
    idFromName: (n) => ({ nome: n }),
    get: (id) => ({ fetch: async () => { chiamate.push(["stanza", id.nome]); return new Response("stanza"); } }),
  },
};
const chiedi = (path, init) => worker.fetch(new Request("https://ekg.example.dev" + path, init), env, {});
let r = await chiedi("/");
check(r.status === 200 && chiamate.at(-1)[1] === "/" && !r.headers.get("content-security-policy"), "il sito: «/» va ai file statici, come prima, senza intestazioni nuove");
r = await chiedi("/api/metrics", { method: "POST", body: JSON.stringify({ e: "visit", i: "x" }) });
check(r.status === 204, "POST /api/metrics: il gestore delle metriche di sempre (204)");
r = await chiedi("/ponte/");
check(chiamate.at(-1)[1] === "/ponte/" && /frame-ancestors 'none'/.test(r.headers.get("content-security-policy") || "")
  && r.headers.get("referrer-policy") === "no-referrer", "/ponte/: i file dell'app, con le sue intestazioni di sicurezza");
r = await chiedi("/ponte/salute");
check(r.status === 200 && (await r.text()) === "ok" && r.headers.get("access-control-allow-origin") === "*", "/ponte/salute: «ok», leggibile dalla prova della rete");
r = await chiedi("/ponte/ws?r=" + a.stanza + "&ruolo=pc");
check(r.status === 426, "/ponte/ws senza WebSocket: 426");
r = await chiedi("/ponte/ws?r=nonvalida&ruolo=pc", { headers: { upgrade: "websocket" } });
check(r.status === 400, "/ponte/ws con una stanza non valida: 400, e nessun Durable Object");
r = await chiedi("/ponte/ws?r=" + a.stanza + "&ruolo=tel", { headers: { upgrade: "websocket" } });
check(chiamate.at(-1)[0] === "stanza" && chiamate.at(-1)[1] === a.stanza, "/ponte/ws: alla stanza giusta (un Durable Object per stanza)");
const cfg = readFileSync(join(root, "../wrangler.jsonc"), "utf8");
check(/"main": "worker\/index\.js"/.test(cfg) && /"run_worker_first": \[\s*"\/ponte\/\*",\s*"\/api\/\*"\s*\]/.test(cfg) && /"new_sqlite_classes": \[\s*"PonteStanza"/.test(cfg)
  && /"not_found_handling": "single-page-application"/.test(cfg),
  "wrangler.jsonc: il Worker passa davanti solo per /ponte/* (e /api/*, dove c'era già), il Durable Object è SQLite, il sito resta una SPA");

console.log(fail ? `\nPONTE-CRIPTO: ${fail} CHECK FALLITI\n` : "\nPONTE-CRIPTO: TUTTO OK\n");
process.exit(fail ? 1 : 0);
