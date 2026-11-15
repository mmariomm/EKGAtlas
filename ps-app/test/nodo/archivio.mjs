#!/usr/bin/env node
/*
 * archivio.js senza browser (npm run test:nodo): il registro da solo, su un
 * chrome.storage finto (chrome-finto.mjs) con guasti, ritardi e riavvii del
 * service worker — fondere, la fila, il tetto, la scadenza, gia/segna chiusi
 * sull'errore, due segna dello stesso numero, il riavvio a metà scrittura.
 *
 * Deterministica: niente orologio vero (l'ora è un numero), niente timer (i
 * ritardi sono giri di setImmediate). Meno di un secondo.
 */
import { discoNuovo, swNuovo, giri, leggi } from "./chrome-finto.mjs";

let ko = 0, ok = 0;
const check = (c, m) => { if (c) { ok++; console.log("  ✓ " + m); } else { ko++; console.log("  ✗ " + m); } };
const json = (x) => JSON.stringify(x);
const H = 3600e3;
const esito = (p) => p.then((v) => ({ ok: true, v: v === undefined ? null : v }), (e) => ({ ok: false, e: String(e && e.message || e) }));

// un service worker con archivio.js, e un registro di prova
function conRegistro(disco, opz = {}, reg = { area: "session", chiave: "prova.rq", n: 5, ms: 10 * H }) {
  const sw = swNuovo(disco, opz).carica("extension/archivio.js");
  sw.codice(`globalThis.R = PsaArchivio.registro({ ...${json(reg)}, ora: () => __ora });`);
  sw.R = sw.ev("R");
  return sw;
}

console.log("\narchivio.js: il registro");
{
  // caricato due volte (il ponte e la stazione lo chiedono entrambi): lo stesso, niente errori
  const sw = swNuovo(discoNuovo()).carica("extension/archivio.js");
  const a = sw.ev("PsaArchivio");
  sw.carica("extension/archivio.js");
  check(sw.ev("PsaArchivio") === a && Object.isFrozen(a) && Object.isFrozen(a.CHIAVE), "caricato due volte: lo stesso oggetto, chiuso");
  let rotto = 0;
  for (const o of [{}, { area: "altro", chiave: "x", n: 1, ms: 1 }, { area: "local", chiave: "", n: 1, ms: 1 }, { area: "local", chiave: "x", n: 0, ms: 1 }, { area: "local", chiave: "x", n: 1, ms: 0 }]) {
    try { a.registro(o); } catch { rotto++; }
  }
  check(rotto === 5, "un registro senza area, chiave, tetto o scadenza non nasce (errore subito, non a metà lavoro)");
}
{
  // fondere: i campi di prima restano, `ts` è l'ora della scrittura
  const disco = discoNuovo(), sw = conRegistro(disco);
  await sw.R.scrivi("aaaaaaaa", { ep: "1", fase: "corso" });
  sw.ora += 10;
  await sw.R.scrivi("aaaaaaaa", { fase: "inviato" });
  const x = await sw.R.leggi("aaaaaaaa");
  check(x && x.ep === "1" && x.fase === "inviato" && x.ts === sw.ora, "scrivi fonde nel record che c'è, con l'ora di adesso");
  check((await sw.R.leggi("nessuno0")) === undefined && json(await sw.R.tutti()) === json(disco.session["prova.rq"]), "leggi / tutti: quello che c'è sul disco");
  // come chrome.storage (JSON): un campo undefined sparisce, sul disco e alla lettura
  await sw.R.scrivi("vuoto001", { a: 1, b: undefined });
  const v = await sw.R.leggi("vuoto001");
  check(v.a === 1 && !("b" in v) && !("b" in disco.session["prova.rq"].vuoto001), "un campo undefined non arriva sul disco (come Chrome: JSON)");
}
{
  // `__proto__` come numero (passa /^[\w-]{8,40}$/): una chiave come le altre, mai il prototipo
  const disco = discoNuovo(), sw = conRegistro(disco);
  const prima = await esito(sw.R.leggi("__proto__"));
  check(prima.ok && prima.v === null && await sw.R.gia("__proto__") === false, "«__proto__» mai scritto: leggi non trova niente, gia dice no");
  await sw.R.scrivi("__proto__", { fase: "inviato" });
  await sw.R.scrivi("normale1", {});
  const x = await sw.R.leggi("__proto__"), t = await sw.R.tutti();
  check(x && x.fase === "inviato" && Object.hasOwn(t, "__proto__") && Object.keys(disco.session["prova.rq"]).includes("__proto__"),
    "«__proto__» scritto: è sul disco, leggi e tutti lo trovano come un numero qualsiasi");
  check(await sw.R.segna("__proto__") === false && t.fase === undefined, "…segna no, e nessun prototipo cambiato");
}
{
  // il tetto (i 5 più recenti) e la scadenza (10 ore), a ogni scrittura
  const disco = discoNuovo(), sw = conRegistro(disco);
  for (let i = 0; i < 8; i++) { sw.ora += 1000; await sw.R.scrivi("numero-" + i, { i }); }
  const k = Object.keys(disco.session["prova.rq"]);
  check(json(k) === json(["numero-7", "numero-6", "numero-5", "numero-4", "numero-3"]), `tetto: i 5 più recenti, dal più nuovo (${k.join(",")})`);
  sw.ora += 10 * H - 3000;   // numero-3 e numero-4 hanno 10 ore o più, numero-5.. no
  await sw.R.scrivi("numero-8", {});
  const k2 = Object.keys(disco.session["prova.rq"]);
  check(json(k2) === json(["numero-8", "numero-7", "numero-6", "numero-5"]), `scadenza: più vecchi di 10 ore, via alla scrittura dopo (${k2.join(",")})`);
  // un record scaduto ma non ancora tolto (nessuna scrittura dopo): gia dice sì — il lato sicuro
  sw.ora += 20 * H;
  check(await sw.R.gia("numero-8") === true, "scaduto ma ancora sul disco: «già», finché una scrittura non lo toglie");
  await sw.R.segna("numero-9");
  check(json(Object.keys(disco.session["prova.rq"])) === json(["numero-9"]) && await sw.R.gia("numero-8") === false, "…e dopo la scrittura non c'è più");
}
{
  // l'orologio torna indietro (60 s) con già `n` record più nuovi: quello appena scritto resta comunque
  const disco = discoNuovo(), sw = conRegistro(disco);
  for (let i = 0; i < 5; i++) { sw.ora += 1000; await sw.R.scrivi("avanti-" + i, { i }); }
  sw.ora -= 60e3;
  await sw.R.scrivi("indietro", { fase: "inviato" });
  const k = Object.keys(disco.session["prova.rq"]);
  check(k.length === 5 && k.includes("indietro") && (await sw.R.leggi("indietro"))?.fase === "inviato",
    `orologio indietro di 60 s: il record appena scritto resta, il tetto pure (${k.join(",")})`);
  check(await sw.R.segna("indietr2") === true && await sw.R.segna("indietr2") === false, "orologio indietro: segna dello stesso numero due volte, un solo «sì»");
}
{
  // la fila: dieci scritture insieme, coi ritardi, una dietro l'altra — nessuna persa
  const disco = discoNuovo(), sw = conRegistro(disco, { ritardo: (op) => (op === "get" ? 3 : 5) }, { area: "local", chiave: "fila.rq", n: 50, ms: H });
  await Promise.all(Array.from({ length: 10 }, (_, i) => sw.R.scrivi("fila-000" + i, { i })));
  check(Object.keys(disco.local["fila.rq"]).length === 10, "dieci scrivi insieme (con ritardi): tutte e dieci sul disco, nessuna sopra l'altra");
  // due registri sulla stessa chiave fanno la stessa fila
  sw.codice(`globalThis.R2 = PsaArchivio.registro({ area: "local", chiave: "fila.rq", n: 50, ms: ${H}, ora: () => __ora });`);
  const R2 = sw.ev("R2");
  await Promise.all([sw.R.scrivi("altro-001", {}), R2.scrivi("altro-002", {}), sw.R.scrivi("altro-003", {}), R2.scrivi("altro-004", {})]);
  check(["altro-001", "altro-002", "altro-003", "altro-004"].every((k) => k in disco.local["fila.rq"]), "due registri sulla stessa chiave: una fila sola, nessuna scrittura persa");
}
{
  // due segna dello stesso numero, insieme: uno solo vince
  const disco = discoNuovo(), sw = conRegistro(disco, { ritardo: (op) => (op === "get" ? 4 : 2) });
  const r = await Promise.all([sw.R.segna("doppio01", { da: "a" }), sw.R.segna("doppio01", { da: "b" }), sw.R.segna("doppio01", { da: "c" })]);
  check(json(r) === json([true, false, false]) && disco.session["prova.rq"].doppio01.da === "a", `tre segna dello stesso numero insieme: uno vince (${json(r)})`);
  check(await sw.R.gia("doppio01") === true && await sw.R.segna("doppio01") === false, "dopo: gia sì, segna no");
}
{
  // il riavvio: quello che è scritto resta, la memoria no — segna non ridà il via
  const disco = discoNuovo();
  let sw = conRegistro(disco);
  check(await sw.R.segna("riavvio1", { fase: "inviato" }) === true, "prima del riavvio: segnato");
  sw = sw.riavvia(); sw.carica("extension/archivio.js");
  sw.codice(`globalThis.R = PsaArchivio.registro({ area: "session", chiave: "prova.rq", n: 5, ms: ${10 * H}, ora: () => __ora });`);
  const R = sw.ev("R");
  check(await R.gia("riavvio1") === true && await R.segna("riavvio1") === false && (await R.leggi("riavvio1")).fase === "inviato",
    "dopo il riavvio del service worker: già visto, segna no, la fase «inviato» è lì");
  // morto a metà di una scrittura: Chrome l'ha già scritta (alla chiamata), si perde solo la risposta — il
  // vecchio non ha mai avuto il via, e il nuovo la trova: segna no (niente fatto due volte)
  const disco2 = discoNuovo();
  const sw2 = conRegistro(disco2, { ritardo: (op) => (op === "set" ? 6 : 0) });
  let via = null;
  sw2.R.segna("ameta001").then((v) => { via = v; });
  await giri(2);
  const dopo = sw2.riavvia(); dopo.carica("extension/archivio.js");
  dopo.codice(`globalThis.R = PsaArchivio.registro({ area: "session", chiave: "prova.rq", n: 5, ms: ${10 * H}, ora: () => __ora });`);
  await giri(20);
  check(via === null && !!disco2.session["prova.rq"]?.ameta001 && await dopo.ev("R").segna("ameta001") === false,
    "morto a metà della scrittura: il vecchio non ha mai avuto il via, la scrittura è sul disco, il nuovo segna no (niente fatto due volte)");
}
{
  // la memoria rotta: CHIUSI — gia «sì», segna «no», scrivi/tutti rifiutano, la fila va avanti
  let rompi = new Set();
  const disco = discoNuovo(), sw = conRegistro(disco, { guasto: (op) => rompi.has(op) });
  await sw.R.scrivi("primo001", {});
  rompi = new Set(["get"]);
  check(await sw.R.gia("mai-visto") === true, "lettura rotta: gia dice «già» (non si fa), mai «non visto»");
  check(await sw.R.segna("mai-visto") === false, "lettura rotta: segna dice no");
  check(!(await esito(sw.R.tutti())).ok && !(await esito(sw.R.leggi("primo001"))).ok, "lettura rotta: tutti / leggi rifiutano (chi legge prima di fare, non fa)");
  rompi = new Set(["set"]);
  check(await sw.R.segna("nuovo001") === false && !("nuovo001" in disco.session["prova.rq"]), "scrittura rotta: segna dice no, e niente sul disco");
  const s = await esito(sw.R.scrivi("nuovo002", { fase: "inviato" }));
  check(!s.ok && /guasto finto/.test(s.e), "scrittura rotta: scrivi rifiuta (chi annota «inviato» prima di fare lo sa)");
  rompi = new Set();
  check(await sw.R.segna("nuovo003") === true && "nuovo003" in disco.session["prova.rq"], "dopo il guasto la fila va avanti: la scrittura dopo passa");
  // cambia: il giro a mano nella stessa fila (scrive solo se fn dice sì)
  const n0 = disco.scritture;
  await sw.R.cambia(() => false);
  await sw.R.cambia((m) => { m.nuovo003.x = 1; return true; });
  check(disco.scritture === n0 + 1 && disco.session["prova.rq"].nuovo003.x === 1, "cambia: scrive solo se la funzione dice sì");
}
{
  // cambia che rientra nella sua stessa fila: un errore chiaro, subito — mai una fila ferma per sempre
  const disco = discoNuovo(), sw = conRegistro(disco);
  await sw.R.scrivi("rientro1", {});
  const finita = async (p) => { let r = null; esito(p).then((x) => { r = x; }); await giri(50); return r; };
  const a = await finita(sw.R.cambia(async (m) => { await sw.R.scrivi("rientro2", {}); m.rientro1.x = 1; return true; }));
  check(a && !a.ok && /sincrona/.test(a.e), `cambia che aspetta una scrittura della sua fila: rifiuta con un errore chiaro (${a ? a.e : "ferma per sempre"})`);
  const b = await finita(sw.R.cambia((m) => { sw.R.scrivi("rientro3", {}); return true; }));
  check(b && !b.ok && /rientra/.test(b.e) && !("rientro3" in disco.session["prova.rq"]), "cambia che rientra senza aspettare: rifiuta, e niente scritto");
  const c = await finita(sw.R.scrivi("rientro4", {}));
  check(c && c.ok && "rientro4" in disco.session["prova.rq"] && !disco.session["prova.rq"].rientro1.x, "dopo: la fila va avanti, e il cambio rifiutato non ha scritto niente");
}

console.log(`\n${ko ? "ARCHIVIO: " + ko + " NON VANNO" : "ARCHIVIO: TUTTO OK"} (${ok} controlli)`);
process.exit(ko ? 1 : 0);
