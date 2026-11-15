/*
 * Un chrome.storage finto, per le prove di test/nodo/ (niente browser).
 *
 *   const disco = discoNuovo();              // quello che resta: local e session
 *   const sw = swNuovo(disco, opz);          // un service worker: un contesto vm col suo chrome
 *   sw.carica("extension/archivio.js");      // i file, come importScripts
 *   sw.riavvia()                             // il service worker muore: la memoria va, il disco resta;
 *                                            // una set già chiamata dal vecchio è scritta (Chrome la scrive
 *                                            // alla chiamata): si perde solo la risposta
 *
 * opz.ritardo(op, area, chiavi) → giri di setImmediate prima che get/set risponda (0: subito).
 *   Sono giri, non millisecondi: lo stesso ordine a ogni corsa (niente orologio vero).
 * opz.guasto(op, area, chiavi) → vero: quella get/set rifiuta (la memoria piena o rotta).
 * opz.chrome() / opz.globali(): le altre API di chrome e gli altri nomi del service worker (a ogni riavvio, nuovi).
 * L'ora: sw.ora (un numero, in ms) — chi carica il codice la passa a chi la vuole.
 */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const leggi = (f) => readFileSync(join(root, f), "utf8");

export const discoNuovo = () => ({ local: {}, session: {}, scritture: 0 });
// (come chrome.storage: JSON — un campo undefined sparisce, una Date diventa stringa)
const clona = (o) => JSON.parse(JSON.stringify(o));
export const giri = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

export function swNuovo(disco, opz = {}) {
  const sw = { vivo: true, ora: opz.ora ?? 1_700_000_000_000, opz, disco };
  const areaFinta = (nome) => {
    const d = () => disco[nome];
    const prima = async (op, chiavi) => {
      await giri(sw.opz.ritardo ? sw.opz.ritardo(op, nome, chiavi) : 0);
      if (sw.opz.guasto && sw.opz.guasto(op, nome, chiavi)) throw new Error(`storage.${nome}.${op}: guasto finto`);
    };
    return {
      get: async (k) => {
        const chiavi = k == null ? Object.keys(d()) : [].concat(k);
        // (letto alla chiamata, come la set scrive alla chiamata: Chrome le fa in ordine — una get chiamata
        // prima di una set non vede la set, anche se la sua risposta arriva dopo)
        const o = {};
        for (const x of chiavi) if (x in d()) o[x] = clona(d()[x]);
        await prima("get", chiavi);
        if (!sw.vivo) return new Promise(() => {});   // morto intanto: nessuna risposta
        return o;
      },
      set: async (o) => {
        const copia = clona(o);   // (com'è adesso: chrome lo serializza alla chiamata)
        // Chrome la scrive alla chiamata (se la memoria la prende), comunque vada il service worker dopo:
        // morto a metà, si perde solo la risposta
        const rotta = !!(sw.opz.guasto && sw.opz.guasto("set", nome, Object.keys(copia)));
        if (!rotta) { Object.assign(d(), copia); disco.scritture++; }
        await giri(sw.opz.ritardo ? sw.opz.ritardo("set", nome, Object.keys(copia)) : 0);
        if (rotta) throw new Error(`storage.${nome}.set: guasto finto`);
        if (!sw.vivo) return new Promise(() => {});   // morto a metà: scritta, ma nessuna risposta
      },
      remove: async (k) => { await prima("remove", [].concat(k)); if (sw.vivo) for (const x of [].concat(k)) delete d()[x]; },
    };
  };
  const nuovoContesto = () => {
    // (opz.chrome: le altre API di chrome che servono a chi si carica; opz.globali: il resto del service worker)
    const chrome = { ...(sw.opz.chrome ? sw.opz.chrome() : {}), storage: { local: areaFinta("local"), session: areaFinta("session"), onChanged: { addListener() {} } } };
    const ctx = vm.createContext({ chrome, console, structuredClone, setTimeout, clearTimeout, ...(sw.opz.globali ? sw.opz.globali() : {}) });
    vm.runInContext("globalThis.__sw = null;", ctx);
    Object.defineProperty(ctx, "__ora", { get: () => sw.ora });
    return ctx;
  };
  sw.ctx = nuovoContesto();
  sw.carica = (f) => { vm.runInContext(leggi(f), sw.ctx, { filename: f }); return sw; };
  sw.codice = (c, nome = "codice") => { vm.runInContext(c, sw.ctx, { filename: nome }); return sw; };
  sw.ev = (c) => vm.runInContext(c, sw.ctx);
  // il riavvio: un service worker nuovo sullo stesso disco; quello vecchio non scrive più niente
  sw.riavvia = () => {
    sw.vivo = false;
    const nuovo = swNuovo(disco, { ...sw.opz, ora: sw.ora });
    return nuovo;
  };
  return sw;
}
