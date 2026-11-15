#!/usr/bin/env node
/*
 * I tre comandi del telefono che si fanno una volta sola per numero (rq) —
 * «Passa il PC all'area» (ponteAreaApri), «Accetta in ambulatorio»
 * (ponteAccetta), una terapia (ponteTerapiaAggiungi) — e «Dimentica i dati»
 * (ponteDimentica): il service worker VERO (extension/ponte-sw.js, coi file
 * che carica prima) in una vm, sul chrome.storage finto di chrome-finto.mjs.
 * Nessuna presa: il ponte non è associato, non si collega a niente. Nessuna
 * scheda del gestionale: chi arriva fin lì lo si vede (sendMessage contati).
 *
 * Prima, le righe: la copia di prima dei tre registri (vecchio-ponte-rq.js,
 * 65a4e11) e le righe di adesso (lette da extension/ponte-sw.js) fanno gli
 * stessi passi su due dischi uguali — stesse risposte, stessi rifiuti, lo
 * stesso disco dopo ogni passo. (npm run test:nodo)
 */
import { webcrypto } from "node:crypto";
import { discoNuovo, swNuovo, leggi } from "./chrome-finto.mjs";

let ko = 0, ok = 0;
const check = (c, m) => { if (c) { ok++; console.log("  ✓ " + m); } else { ko++; console.log("  ✗ " + m); } };
const json = (x) => JSON.stringify(x);
const esito = (p) => p.then((v) => ({ ok: true, v: v === undefined ? null : v }), (e) => ({ ok: false, e: String(e && e.message || e) }));
const GEST = "https://smarthealth.multimedica.it/sa4pso/";

// un service worker col ponte, sul disco dato; `guasti`: le operazioni che rifiutano, adesso
function pcFinto(disco, guasti = new Set()) {
  const mandati = [];
  class PresaFinta { constructor() { this.readyState = 3; } send() {} close() {} addEventListener() {} }
  const opz = {
    guasto: (op, area, chiavi) => guasti.has(op) && area === "session" && chiavi.some((k) => /\.rq$/.test(k)),
    chrome: () => ({
      runtime: { id: "abc", onMessage: { addListener() {} }, onStartup: { addListener() {} }, onInstalled: { addListener() {} }, getURL: (p) => "chrome-extension://abc/" + p,
        getManifest: () => ({ version: "3.90.0" }), getContexts: async () => [] },
      tabs: { query: async () => [], sendMessage: async (...a) => { mandati.push(a); return null; }, create: async () => ({}), update: async () => ({}), get: async () => null, remove: async () => {},
        onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
      windows: { getLastFocused: async () => null },
      alarms: { get: async () => null, create() {}, clear: async () => true, onAlarm: { addListener() {} } },
    }),
    globali: () => ({
      WebSocket: PresaFinta, crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, URL, URLSearchParams, self: {}, setInterval: () => 0, clearInterval: () => {},
      PSA_CASSA: new Map(), PONTE_HOST_FISSO: "",
      ordLeggi: async () => [], sulGestionale: (u) => String(u || "").startsWith(GEST), leggibileOrd: () => true,
      corto: (s, n = 160) => String(s == null ? "" : s).slice(0, n), KEY: (id) => "ref:" + id, REF_TTL: 6e5, stampaScelte: async () => ({ attiva: true }),
      ospite: async () => ({ ok: true }), stampaPdf: async () => ({ ok: true, esito: "stampato" }), ruotaDi: () => 0, STAMPA_PDF_MAX: 15e6,
    }),
  };
  const sw = swNuovo(disco, opz);
  for (const f of ["ponte-cripto.js", "presa.js", "fuori-sw.js", "cassa.js", "archivio.js", "ponte-sw.js"]) sw.carica("extension/" + f);
  sw.mandati = mandati;
  return sw;
}
const ora = () => Date.now();
const semina = (disco, chiave, rq, x) => { disco.session[chiave] = { ...(disco.session[chiave] || {}), [rq]: { ts: ora(), ...x } }; };

console.log("\nponte-sw.js: i registri per numero, prima e adesso");
const SW_ADESSO = leggi("extension/ponte-sw.js");
const righe = SW_ADESSO.split("\n").filter((r) => /^const ponte(Terapia|Accetta|Area)Rq(Tutti|Scrivi)? = /.test(r));
const dimAdesso = (() => {
  const i = SW_ADESSO.indexOf("  const accettaSenzaNomi = ponteAccettaRq.cambia(");
  const j = SW_ADESSO.indexOf("  }).catch(() => {});\n", i) + "  }).catch(() => {});\n".length;
  return i > 0 ? SW_ADESSO.slice(i, j) : "";
})();
check(righe.length === 9 && dimAdesso, `in ponte-sw.js: i tre registri (${righe.length} righe) e il pezzo di ponteDimentica`);
check(/importScripts\("cassa\.js", "ponte-host\.js", "ponte-cripto\.js", "archivio\.js", "ponte-sw\.js"\)/.test(leggi("extension/bg.js")), "bg.js carica archivio.js prima del ponte");
check(!/ponteFila(Terapia|Accetta|Area)Rq/.test(SW_ADESSO) && (SW_ADESSO.match(/PsaArchivio\.registro\(/g) || []).length === 3,
  "ponte-sw.js non ha più le sue tre file a mano: tre PsaArchivio.registro");
const COSTANTI = `const PONTE_TERAPIA_RQ = "ponte.terapia.rq", PONTE_ACCETTA_RQ = "ponte.accetta.rq", PONTE_AREA_RQ = "ponte.area.rq";
const PONTE_REGISTRO = 14 * 3600e3; const ponteOra = () => __ora;\n`;
function dueMondi(opz) {
  const vecchio = swNuovo(discoNuovo(), opz).codice(COSTANTI + leggi("test/nodo/vecchio-ponte-rq.js"), "vecchio-ponte-rq.js");
  const nuovo = swNuovo(discoNuovo(), opz).carica("extension/archivio.js")
    .codice(COSTANTI + righe.join("\n") + `\nasync function nuovaDimentica() {\n${dimAdesso}  await accettaSenzaNomi;\n}\n`, "ponte-sw.js (le righe di adesso)");
  return { vecchio, nuovo };
}
// la stessa storia, passo per passo, sui due: ogni risposta (o rifiuto) e il disco alla fine
async function storia(sw, nome, guasti) {
  const scrivi = sw.ev(`ponte${nome}RqScrivi`), tutti = sw.ev(`ponte${nome}RqTutti`);
  const log = [];
  // (dopo ogni passo, anche il disco com'è: una differenza a metà strada non si nasconde dietro una fine uguale)
  const passo = async (p) => log.push({ ...(await esito(p)), disco: json(sw.disco.session) });
  // fondere: corso → inviato → fatto
  await passo(scrivi("rq-aaaa-01", { ep: "7", fase: "corso" }));
  sw.ora += 5;
  await passo(scrivi("rq-aaaa-01", { fase: "inviato" }));
  sw.ora += 5;
  await passo(scrivi("rq-aaaa-01", { fase: "fatto", esito: { ok: true, dati: { nome: "ROSSI MARIO", area: "A" } } }));
  // insieme, coi ritardi: sei scritture senza aspettarsi (due sullo stesso numero)
  const insieme = [];
  for (let i = 0; i < 6; i++) { sw.ora += 1; insieme.push(esito(scrivi("rq-insieme-" + (i % 5), { i, fase: i % 2 ? "corso" : "inviato" }))); }
  log.push(...await Promise.all(insieme), { disco: json(sw.disco.session) });
  // oltre il tetto: 70 numeri in fila (ts tutti diversi)
  for (let i = 0; i < 70; i++) { sw.ora += 1000; await passo(scrivi("rq-tetto-" + String(i).padStart(3, "0"), { i })); }
  // la scadenza: 14 ore dopo i primi, la scrittura dopo li toglie
  sw.ora += 14 * 3600e3 - 30 * 1000;
  await passo(scrivi("rq-dopo-0001", { fase: "corso" }));
  // memoria rotta: una scrittura rifiuta, la dopo passa; una lettura rifiuta
  guasti.add("set");
  await passo(scrivi("rq-rotta-001", { fase: "inviato" }));
  guasti.delete("set");
  await passo(scrivi("rq-rotta-002", { fase: "inviato" }));
  guasti.add("get");
  await passo(tutti());
  await passo(scrivi("rq-rotta-003", {}));
  guasti.delete("get");
  log.push({ disco: json(await tutti()) });
  return log;
}
for (const nome of ["Terapia", "Accetta", "Area"]) {
  const g1 = new Set(), g2 = new Set();
  const rit = (op, area, chiavi) => (op === "get" ? 2 + (chiavi.length % 2) : 3);
  const v = swNuovo(discoNuovo(), { ritardo: rit, guasto: (op) => g1.has(op) });
  v.codice(COSTANTI + leggi("test/nodo/vecchio-ponte-rq.js"), "vecchio-ponte-rq.js");
  const n = swNuovo(discoNuovo(), { ritardo: rit, guasto: (op) => g2.has(op) }).carica("extension/archivio.js");
  n.codice(COSTANTI + righe.join("\n"), "ponte-sw.js (le righe di adesso)");
  const lv = await storia(v, nome, g1), ln = await storia(n, nome, g2);
  const diversi = lv.map((x, i) => json(x) === json(ln[i]) ? -1 : i).filter((i) => i >= 0);
  const fin = JSON.parse(lv.at(-1).disco);
  check(lv.length === ln.length && !diversi.length,
    `ponte${nome}Rq: prima e adesso, ${lv.length} passi uguali — risposte, rifiuti, disco (${Object.keys(fin).length} numeri, ${lv.filter((x) => x.ok === false).length} rifiuti)${diversi.length ? " — diversi ai passi " + diversi.slice(0, 5) : ""}`);
}
{
  // ponteDimentica: i nomi via dagli esiti delle accettazioni, nella stessa fila — prima e adesso uguale
  const { vecchio, nuovo } = dueMondi({ ritardo: () => 2 });
  for (const sw of [vecchio, nuovo]) {
    const scrivi = sw.ev("ponteAccettaRqScrivi");
    await scrivi("acc-0000-01", { fase: "fatto", esito: { ok: true, dati: { nome: "ROSSI MARIO", area: "A" } } });
    await scrivi("acc-0000-02", { fase: "inviato", ep: "3" });
    sw.ora += 1;
    // una scrittura in volo mentre si dimentica: la fila le mette in ordine
    sw.p = Promise.all([scrivi("acc-0000-03", { fase: "fatto", esito: { ok: false, errore: "no" } }), sw.ev(sw === vecchio ? "vecchiaDimentica()" : "nuovaDimentica()")]);
  }
  await Promise.all([vecchio.p, nuovo.p]);
  const dv = json(await vecchio.ev("ponteAccettaRqTutti()")), dn = json(await nuovo.ev("ponteAccettaRqTutti()"));
  check(dv === dn && !/ROSSI/.test(dn) && /"area":"A"/.test(dn), "ponteDimentica: i nomi tolti nella stessa fila, prima e adesso lo stesso disco");
  // e senza più niente da togliere: nessuna scrittura, prima e adesso
  const scritture = async (sw, f) => { const d0 = sw.disco.scritture; await sw.ev(f); return sw.disco.scritture - d0; };
  const sv = await scritture(vecchio, "vecchiaDimentica()"), sn = await scritture(nuovo, "nuovaDimentica()");
  check(sv === 0 && sn === 0, "ponteDimentica senza nomi da togliere: nessuna scrittura, prima e adesso");
}
{
  // il riavvio sul registro vero: «inviato» scritto, il service worker muore, quello nuovo lo ritrova
  const disco = discoNuovo();
  let sw = swNuovo(disco).carica("extension/archivio.js").codice(COSTANTI + righe.join("\n"));
  await sw.ev("ponteAreaRqScrivi")("rq-riavvio-1", { fase: "inviato" });
  sw = sw.riavvia().carica("extension/archivio.js").codice(COSTANTI + righe.join("\n"));
  const x = (await sw.ev("ponteAreaRqTutti()"))["rq-riavvio-1"];
  check(x && x.fase === "inviato", "ponteAreaRq dopo un riavvio: la fase «inviato» c'è (ponteAreaApri risponde «incerto», non rifà)");
}

console.log("\nponte-sw.js (vero, in una vm): i comandi del telefono una volta per numero");
const disco = discoNuovo();
let pc = pcFinto(disco);
await pc.ev("ponteCaricato");
check(pc.ev("typeof ponteAreaApri === 'function' && typeof ponteAreaRq !== 'undefined' && typeof ponteAreaRq.scrivi === 'function'"), "il service worker del ponte si carica con archivio.js (e i suoi tre registri)");

// --- Passa il PC all'area
semina(disco, "ponte.area.rq", "area-inviato-1", { fase: "inviato" });
semina(disco, "ponte.area.rq", "area-fatto-001", { fase: "fatto", esito: { ok: true, dati: { area: "B", ep: "9" } } });
let r = await pc.ev(`ponteAreaApri({ ep: "1", rq: "area-inviato-1", nato: Date.now() })`);
check(r && r.ok === false && r.incerto === true && !pc.mandati.length, "area: un numero «inviato» (riavvio a metà) → «incerto», nessuna scheda toccata");
r = await pc.ev(`ponteAreaApri({ ep: "1", rq: "area-fatto-001", nato: Date.now() })`);
check(r && r.ok === true && r.dati.area === "B" && !pc.mandati.length, "area: un numero già fatto → la stessa risposta, niente rifatto");
r = await pc.ev(`ponteAreaApri({ ep: "1", rq: "area-tardi-001", nato: Date.now() - 10 * 60e3 })`);
const tardi = disco.session["ponte.area.rq"]["area-tardi-001"];
check(r && r.scaduto === true && tardi && tardi.fase === "fatto" && tardi.esito.scaduto === true, "area: arrivato tardi → «Scaduta», e il numero lo ricorda");
// il riavvio: la memoria va, il disco resta
pc = pc.riavvia(); pc = pcFinto(disco); await pc.ev("ponteCaricato");
r = await pc.ev(`ponteAreaApri({ ep: "1", rq: "area-tardi-001", nato: Date.now() })`);
check(r && r.scaduto === true && !pc.mandati.length, "area, dopo un riavvio del service worker: lo stesso numero ha la stessa risposta (anche con l'ora giusta adesso)");
// la memoria rotta: in lettura il comando rifiuta (niente fatto); in scrittura di «inviato», niente cambiato
const guasti = new Set(["get"]);
pc = pc.riavvia(); pc = pcFinto(disco, guasti); await pc.ev("ponteCaricato");
const e1 = await esito(pc.ev(`ponteAreaApri({ ep: "1", rq: "area-rotta-001", nato: Date.now() })`));
check(!e1.ok && !pc.mandati.length, "area, memoria illeggibile: il comando rifiuta, nessuna scheda toccata (chiuso, mai «non visto»)");
guasti.clear(); guasti.add("set");
r = await pc.ev(`ponteAreaApri({ ep: "1", rq: "area-rotta-002", nato: Date.now() })`);
check(r && r.ok === false && /non riesce ad annotarlo/.test(r.errore) && !pc.mandati.length && !("area-rotta-002" in disco.session["ponte.area.rq"]),
  "area, «inviato» non scrivibile: «niente cambiato», nessuna scheda toccata");
guasti.clear();
r = await pc.ev(`ponteAreaApri({ ep: "1", rq: "area-nuovo-001", nato: Date.now() })`);
check(disco.session["ponte.area.rq"]["area-nuovo-001"]?.fase === "fatto" && r && r.ok === false,
  "area, memoria tornata: la scrittura dopo passa (la fila non resta rotta) — «inviato», nessuna scheda, «fatto»");

// --- Accetta in ambulatorio
semina(disco, "ponte.accetta.rq", "acc-inviato-1", { fase: "inviato", ep: "1" });
semina(disco, "ponte.accetta.rq", "acc-fatto-001", { fase: "fatto", esito: { ok: true, dati: { nome: "ROSSI MARIO", area: "A" } } });
const n0 = pc.mandati.length;
r = await pc.ev(`ponteAccetta({ ep: "1", rq: "acc-inviato-1" })`);
check(r && r.incerto === true && pc.mandati.length === n0, "accetta: «inviato» → «Incerto: controlla sul PC», niente cliccato");
r = await pc.ev(`ponteAccetta({ ep: "1", rq: "acc-fatto-001" })`);
check(r && r.ok === true && r.dati.area === "A" && pc.mandati.length === n0, "accetta: già fatta → la stessa risposta");
guasti.add("get");
const e2 = await esito(pc.ev(`ponteAccetta({ ep: "1", rq: "acc-rotta-0001" })`));
check(!e2.ok && pc.mandati.length === n0, "accetta, memoria illeggibile: rifiuta, niente cliccato");
guasti.clear();

// --- Terapia
semina(disco, "ponte.terapia.rq", "ter-inviato-1", { fase: "inviato", ep: "1" });
const voce = `{ descr: "PARACETAMOLO 1 g", qta: "1" }`;
r = await pc.ev(`ponteTerapiaAggiungi({ ep: "1", rq: "ter-inviato-1", voce: ${voce}, visti: [] })`);
check(r && r.incerto === true && pc.mandati.length === n0, "terapia: «inviato» → «Incerto», niente confermato");
r = await pc.ev(`ponteTerapiaAggiungi({ ep: "1", rq: "ter-nuova-001", voce: ${voce}, visti: [] })`);
check(r && r.ok === false && !("ter-nuova-001" in (disco.session["ponte.terapia.rq"] || {})), "terapia nuova senza gestionale aperto: no, e niente annotato (non è partita)");

// --- Dimentica i dati: i nomi via dagli esiti delle accettazioni, il resto resta
await pc.ev("ponteDimentica()");
const acc = disco.session["ponte.accetta.rq"];
check(acc["acc-fatto-001"] && !("nome" in acc["acc-fatto-001"].esito.dati) && acc["acc-fatto-001"].esito.dati.area === "A" && acc["acc-inviato-1"].fase === "inviato",
  "Dimentica: il nome tolto dall'esito dell'accettazione, i numeri e le fasi restano (rimandati, non si rifanno)");

console.log(`\n${ko ? "PONTE-RQ: " + ko + " NON VANNO" : "PONTE-RQ: TUTTO OK"} (${ok} controlli)`);
process.exit(ko ? 1 : 0);
