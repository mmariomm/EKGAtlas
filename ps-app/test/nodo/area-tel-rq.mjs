#!/usr/bin/env node
/*
 * «Passa il PC all'area» dal telefono, lato pagina (src/core/76-ponte-gestionale.js,
 * ponteAreaApri): il numero del tocco (`rq`) si annota in `area.tel.rq.v1` PRIMA di
 * muovere il gestionale, e se la memoria non lo prende (store.set → false) non si
 * muove niente — CHIUSO, mai un tocco che può rifarsi. Senza browser: la funzione
 * VERA, letta dal frammento, in una vm con intorno il minimo finto. (npm run test:nodo)
 */
import vm from "node:vm";
import { leggi } from "./chrome-finto.mjs";

let ko = 0, ok = 0;
const check = (c, m) => { if (c) { ok++; console.log("  ✓ " + m); } else { ko++; console.log("  ✗ " + m); } };

const SRC = leggi("src/core/76-ponte-gestionale.js");
const i = SRC.indexOf("  const AREA_TEL_RQ = ");
const j = SRC.indexOf("\n  }\n", SRC.indexOf("  function ponteAreaApri(", i)) + "\n  }\n".length;
const pezzo = i > 0 && j > i ? SRC.slice(i, j) : "";

// una scheda del gestionale finta: il paziente in area «alta», il PC su un'altra; `pieno`: la memoria non scrive
function scheda(pieno = false) {
  const mem = new Map(), aperte = [];
  const ctx = vm.createContext({
    store: { get: (k, f) => (mem.has(k) ? JSON.parse(mem.get(k)) : f), set: (k, v) => { if (pieno) return false; mem.set(k, JSON.stringify(v)); return true; } },
    AREA_ORA: "area.ora", AREE_OPZ: "aree.opz", AREA_VAI: "area.vai", AREA_VAI_MS: 60e3,
    ponteUrlPaziente: () => "", areeLeggi: () => ({ membri: { E1: { k: "alta" } } }), areaVaiNome: () => "Alta",
    normNome: (s) => String(s || "").toUpperCase(), tuttiPazienti: () => [{ name: "ROSSI MARIO", nato: "n1" }],
    motoreOvunque: () => false, paginaToccata: () => false,
    apriArea: (...a) => { aperte.push(a); }, nav: () => {}, setTimeout: () => 0,
  });
  vm.runInContext(pezzo + "\nglobalThis.apri = ponteAreaApri;", ctx, { filename: "76-ponte-gestionale.js (ponteAreaApri)" });
  return { apri: ctx.apri, mem, aperte };
}
const P = { ep: "E1", name: "ROSSI MARIO", nato: "n1" };

console.log("\nponteAreaApri: il numero del tocco annotato prima, chiuso se la memoria non scrive");
check(pezzo.includes("function ponteAreaApri(") && pezzo.includes('"area.tel.rq.v1"'), "in 76-ponte-gestionale.js: AREA_TEL_RQ e ponteAreaApri");
{
  const s = scheda();
  const r = s.apri(P, { rq: "tocco-0001" });
  check(r.ok && s.aperte.length === 1 && JSON.parse(s.mem.get("area.tel.rq.v1")).includes("tocco-0001"), "memoria buona: annotato, e il gestionale si muove");
  const r2 = s.apri(P, { rq: "tocco-0001" });
  check(!r2.ok && r2.incerto && s.aperte.length === 1, "lo stesso numero di nuovo: niente si muove («Già chiesto»)");
}
{
  const s = scheda(true);
  const r = s.apri(P, { rq: "tocco-0002" });
  check(!r.ok && !r.incerto && /niente cambiato/.test(r.errore || "") && s.aperte.length === 0,
    `memoria che non scrive: il gestionale NON si muove, e il telefono lo sa (${r.errore || JSON.stringify(r)})`);
}

console.log(`\n${ko ? "AREA-TEL-RQ: " + ko + " NON VANNO" : "AREA-TEL-RQ: TUTTO OK"} (${ok} controlli)`);
process.exit(ko ? 1 : 0);
