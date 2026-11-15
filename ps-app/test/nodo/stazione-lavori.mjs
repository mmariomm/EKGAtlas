#!/usr/bin/env node
/*
 * «Ultimi fogli» della stazione di stampa (stazione.lavori, storage.local):
 * stzStampaOra aggiunge una riga per foglio — leggi, aggiungi, scrivi. Due
 * fogli stampati insieme non devono perderne una: il giro sta nella fila della
 * chiave (PsaArchivio.cambia). Il service worker VERO (extension/stazione-sw.js,
 * coi file che carica prima) in una vm, sul chrome.storage finto di
 * chrome-finto.mjs, coi ritardi; nessuna presa, nessuna stampante: stampaPdf è
 * finta. (npm run test:nodo)
 */
import { webcrypto } from "node:crypto";
import { discoNuovo, swNuovo, giri } from "./chrome-finto.mjs";

let ko = 0, ok = 0;
const check = (c, m) => { if (c) { ok++; console.log("  ✓ " + m); } else { ko++; console.log("  ✗ " + m); } };

function stazione(disco) {
  class PresaFinta { constructor() { this.readyState = 3; } send() {} close() {} addEventListener() {} }
  const ev = { addListener() {} };
  const sw = swNuovo(disco, {
    // (get e set non subito, e «Ultimi fogli» più lento delle altre chiavi: due giri che si accavallano lo fanno vedere)
    ritardo: (op, area, chiavi) => (chiavi.includes("stazione.lavori") ? 10 : op === "get" ? 3 : 2),
    chrome: () => ({
      runtime: { id: "abc", onMessage: ev, onStartup: ev, onInstalled: ev, getURL: (p) => "chrome-extension://abc/" + p, getManifest: () => ({ version: "3.90.0" }),
        getContexts: async () => [], getPlatformInfo: async () => ({}) },
      tabs: { query: async () => [], sendMessage: async () => null, create: async () => ({}), get: async () => null, onRemoved: ev, onUpdated: ev },
      alarms: { get: async () => null, create() {}, clear: async () => true, onAlarm: ev },
      action: { onClicked: ev, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    }),
    globali: () => ({
      WebSocket: PresaFinta, crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, URL, URLSearchParams, self: {}, setInterval: () => 0, clearInterval: () => {},
      PSA_CASSA: new Map(), PONTE_HOST_FISSO: "", indexedDB: undefined,
      corto: (s, n = 160) => String(s == null ? "" : s).slice(0, n), ospite: async () => ({ ok: true }),
      stampaPdf: async (tipo, pdf, s, ruota, copie) => { await giri(1); return { ok: true, esito: "stampato", stampante: "finta-" + tipo, copie }; },
      ruotaDi: () => 0, STAMPA_PDF_MAX: 15e6, fuoriRipiego: () => false, psaGestionale: async () => false,
    }),
  });
  for (const f of ["ponte-cripto.js", "presa.js", "fuori-sw.js", "cassa.js", "archivio.js", "stazione-sw.js"]) sw.carica("extension/" + f);
  return sw;
}

console.log("\nstazione-sw.js: «Ultimi fogli», due stampe insieme");
{
  const disco = discoNuovo();
  const sw = stazione(disco);
  const pdf = btoa("%PDF-1.4 /Type /Page /Type /Page");
  const stampa = sw.ev("stzStampaOra");
  const e = await Promise.all([stampa("foglio-0001", { tipo: "a4", copie: 1 }, pdf), stampa("foglio-0002", { tipo: "etichette", copie: 2 }, pdf)]);
  const l = disco.local["stazione.lavori"] || [];
  check(e.every((x) => x && x.fase === "fatto" && x.esito === "stampato"), "due fogli stampati insieme: tutti e due «fatto»");
  check(l.length === 2 && l.some((x) => x.tipo === "a4") && l.some((x) => x.tipo === "etichette") && l.every((x) => x.pagine === 2),
    `«Ultimi fogli»: tutte e due le righe, nessuna persa (${l.map((x) => x.tipo).join(",") || "nessuna"})`);
  // il tetto di prima: le ultime 30
  await Promise.all(Array.from({ length: 33 }, (_, i) => stampa("tetto-" + String(i).padStart(4, "0"), { tipo: "a4", copie: 1 }, pdf)));
  check((disco.local["stazione.lavori"] || []).length === 30, "e il tetto resta: le ultime 30");
}

console.log(`\n${ko ? "STAZIONE-LAVORI: " + ko + " NON VANNO" : "STAZIONE-LAVORI: TUTTO OK"} (${ok} controlli)`);
process.exit(ko ? 1 : 0);
