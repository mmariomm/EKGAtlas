#!/usr/bin/env node
/*
 * La presa verso il ripetitore (extension/presa.js), da sola: la stessa che
 * vive nel documento fuori schermo (fuori.js) e, nel ripiego, nel service
 * worker. Contro un ripetitore finto qui (ws), con i tempi accorciati:
 *   - il battito: «ping» ogni tanto, e senza «pong» la presa è morta e si rifà;
 *   - caduta: si riprova da 1 (qui `primo`) raddoppiando fino al tetto, ±50 %,
 *     e il conto ricomincia solo dopo una presa rimasta su `tenuta`;
 *   - 4001: nessun tentativo fino alla prossima richiesta;
 *   - 4403: ferma, finché un'altra stanza o una richiesta `subito`;
 *   - `fino`: si chiude da sé alla sua ora, e non riprova;
 *   - mai due: la vecchia si chiude (1000) prima di aprire la nuova.
 *   node test/presa.mjs
 */
import { WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
vm.runInThisContext(readFileSync(join(root, "extension/presa.js"), "utf8"), { filename: "presa.js" });
const { PresaWs, PRESA } = globalThis;
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sezione = (t) => console.log("\npresa: " + t);
const sospendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function finche(fn, timeout = 5000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(10)) if (await fn()) return true;
  return false;
}
if (typeof WebSocket !== "function") { console.log("presa: questo Node non ha WebSocket"); process.exit(1); }

// Il ripetitore finto: conta le prese, risponde «pong» (se vuole), chiude come gli si dice.
const srv = { entrate: [], chiuse: [], pong: true, all: null, aperte: new Set() };
const wss = new WebSocketServer({ port: 0 });
await new Promise((ok) => wss.on("listening", ok));
const URL1 = `ws://127.0.0.1:${wss.address().port}/ponte/ws?r=${"a".repeat(32)}&ruolo=pc`;
const URL2 = `ws://127.0.0.1:${wss.address().port}/ponte/ws?r=${"b".repeat(32)}&ruolo=pc`;
wss.on("connection", (w, req) => {
  const e = { ts: Date.now(), url: req.url, w, ping: 0 };
  srv.entrate.push(e);
  srv.aperte.add(w);
  w.on("message", (d, bin) => {
    if (!bin && d.toString() === "ping") { e.ping++; if (srv.pong) w.send("pong"); }
  });
  w.on("close", (codice) => { srv.aperte.delete(w); srv.chiuse.push({ ts: Date.now(), url: req.url, codice }); });
  if (srv.all) srv.all(w, e);
});
const regola = (o) => Object.assign(PRESA, o);
const PRIMA = { ...PRESA };
const eventi = [];
const nuova = () => new PresaWs("pc", { stato: (s) => eventi.push({ ts: Date.now(), ...s }), dati: () => {} });

// ===========================================================================
sezione("il battito, e la presa che sembra aperta ma non risponde");
regola({ battito: 150, pong: 120, primo: 40, max: 400, tenuta: 600 });
{
  const p = nuova();
  p.tieni(URL1, null);
  check(await finche(() => p.su), "aperta: su");
  await sospendi(500);
  const e = srv.entrate.at(-1);
  check(e.ping >= 2 && srv.entrate.length === 1 && p.su, `un «ping» a ogni battito (${e.ping} in mezzo secondo), il «pong» torna, la presa resta (una sola)`);
  srv.pong = false;
  const n0 = srv.entrate.length;
  check(await finche(() => srv.entrate.length > n0, 2000), "senza «pong» entro il tempo: morta, e se ne apre un'altra");
  check(srv.chiuse.some((c) => c.codice === 1000), "(la morta si chiude, 1000, prima della nuova)");
  srv.pong = true;
  p.chiudi();
  check(await finche(() => srv.aperte.size === 0), "chiudi(): nessuna presa resta aperta");
}

// ===========================================================================
sezione("caduta: i tentativi, sempre più radi, col caso; il conto da capo solo dopo una presa che ha tenuto");
regola({ battito: 10e3, pong: 5e3, primo: 40, max: 400, tenuta: 600 });
{
  srv.entrate.length = 0;
  srv.all = (w) => w.close(1011, "giù");   // il ripetitore non regge: ogni presa cade subito
  const p = nuova();
  p.tieni(URL1, null);
  await finche(() => srv.entrate.length >= 7, 6000);
  srv.all = null;
  const ts = srv.entrate.map((e) => e.ts), gap = ts.slice(1).map((t, i) => t - ts[i]);
  const attese = [40, 80, 160, 320, 400, 400];
  const dentro = gap.slice(0, 6).every((g, i) => g >= attese[i] * 0.5 - 15 && g <= attese[i] * 1.5 + 60);
  check(gap.length >= 6 && dentro, `da «primo» raddoppiando fino al tetto, ±50 % (attese ${gap.slice(0, 6).join(", ")} ms; previste ${attese.join(", ")} ±50 %)`);
  await finche(() => p.su, 2000);
  check(p.su && p.tentativi > 0, "il ripetitore torna: la presa si apre al tentativo dopo");
  // cade subito dopo: il conto NON ricomincia (non ha tenuto)
  const n0 = srv.entrate.length, t0 = Date.now();
  for (const w of srv.aperte) w.close(1011, "giù");
  await finche(() => srv.entrate.length > n0, 2000);
  const g1 = Date.now() - t0;
  check(g1 >= 400 * 0.5 - 15, `caduta dopo pochi istanti: si riprova ancora al tetto (${g1} ms), non da capo`);
  // tiene più di `tenuta`, poi cade: da capo
  await finche(() => p.su, 2000);
  await sospendi(700);
  const n1 = srv.entrate.length, t1 = Date.now();
  for (const w of srv.aperte) w.close(1011, "giù");
  await finche(() => srv.entrate.length > n1, 2000);
  const g2 = Date.now() - t1;
  check(g2 <= 40 * 1.5 + 60, `rimasta su più di «tenuta», poi caduta: si riprova da capo, subito (${g2} ms)`);
  p.chiudi();
  await finche(() => srv.aperte.size === 0);
}

// ===========================================================================
sezione("4001: sostituita — nessun tentativo fino alla prossima richiesta");
regola({ primo: 40, max: 400 });
{
  const p = nuova();
  p.tieni(URL1, null);
  await finche(() => p.su);
  const n0 = srv.entrate.length;
  for (const w of srv.aperte) w.close(4001, "sostituita");
  await sospendi(800);
  check(srv.entrate.length === n0 && !p.su && p.fermo === 4001 && p.tenuta, `chiusa con 4001: nessun tentativo in 800 ms (${srv.entrate.length - n0} nuove), ferma`);
  p.tieni(URL1, null);   // la prossima richiesta (una pagina del gestionale che si apre)
  check(await finche(() => p.su) && srv.entrate.length === n0 + 1, "la prossima richiesta la riapre, una volta");
  p.chiudi();
  await finche(() => srv.aperte.size === 0);
}

// ===========================================================================
sezione("4403: il ripetitore dice di no — ferma, «Scollegato»");
{
  const p = nuova();
  p.tieni(URL1, null);
  await finche(() => p.su);
  const n0 = srv.entrate.length;
  for (const w of srv.aperte) w.close(4403, "no");
  await sospendi(600);
  p.tieni(URL1, null);
  await sospendi(400);
  check(srv.entrate.length === n0 && p.fermo === 4403 && !p.su, "chiusa con 4403: niente tentativi, e nemmeno la prossima richiesta la riapre (fermo 4403)");
  p.tieni(URL1, null, true);
  check(await finche(() => p.su) && srv.entrate.length === n0 + 1 && p.fermo === 0, "una richiesta `subito` (un gesto: un QR nuovo) sì");
  for (const w of srv.aperte) w.close(4403, "no");
  await finche(() => p.fermo === 4403);
  p.tieni(URL2, null);
  check(await finche(() => p.su) && srv.entrate.at(-1).url.includes("b".repeat(32)), "e un'altra stanza (un'associazione nuova) sì");
  p.chiudi();
  await finche(() => srv.aperte.size === 0);
}

// ===========================================================================
sezione("fino: si chiude da sé alla sua ora, e non riprova; mai due prese");
{
  const p = nuova();
  const t0 = Date.now();
  p.tieni(URL1, t0 + 400);
  await finche(() => p.su);
  check(await finche(() => !p.tenuta && srv.aperte.size === 0, 2000) && Date.now() - t0 >= 380, `chiusa alla sua ora (${Date.now() - t0} ms dopo, «fino» a 400)`);
  const n0 = srv.entrate.length;
  await sospendi(500);
  check(srv.entrate.length === n0, "e non riprova");
  p.tieni(URL1, Date.now() + 300);
  await finche(() => p.su);
  p.tieni(URL1, null);   // una pagina del gestionale: senza scadenza
  await sospendi(500);
  check(p.su && p.fino === null && srv.entrate.length === n0 + 1, "una richiesta senza scadenza toglie quella di prima, sulla stessa presa");
  const c0 = srv.chiuse.length;
  p.tieni(URL2, null);
  await finche(() => p.su && p.url === URL2);
  const via = srv.chiuse.slice(c0).find((c) => c.url.includes("a".repeat(32)));
  check(!!via && via.codice === 1000 && srv.aperte.size === 1, `un'altra stanza: la vecchia chiusa (1000) e una sola aperta (${srv.aperte.size})`);
  p.tieni("", 0);
  check(await finche(() => srv.aperte.size === 0) && !p.tenuta, "tieni(\"\", 0): chiusa");
  p.tieni(URL1, Date.now() - 10);
  await sospendi(200);
  check(srv.aperte.size === 0 && !p.tenuta, "una scadenza già passata non apre niente");
}

regola(PRIMA);
await new Promise((ok) => wss.close(ok));
console.log(fail ? `\nPRESA: ${fail} CHECK FALLITI\n` : "\nPRESA: TUTTO OK\n");
process.exit(fail ? 1 : 0);
