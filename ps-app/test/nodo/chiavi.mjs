#!/usr/bin/env node
/*
 * I nomi delle chiavi lette da più file (archivio.js, PsaArchivio.CHIAVE):
 * chi le legge ancora a mano le scrive come archivio.js, e ponte-sw.js /
 * stazione-sw.js usano i nomi, non le stringhe ricopiate. (npm run test:nodo)
 */
import { discoNuovo, swNuovo, leggi } from "./chrome-finto.mjs";

let ko = 0, ok = 0;
const check = (c, m) => { if (c) { ok++; console.log("  ✓ " + m); } else { ko++; console.log("  ✗ " + m); } };
console.log("\nle chiavi lette da più file: un nome");
{
  const sw = swNuovo(discoNuovo()).carica("extension/archivio.js");
  const K = sw.ev("PsaArchivio.CHIAVE");
  // chi le legge ancora a mano (fuori dal ponte e dalla stazione) le scrive come archivio.js
  const aMano = {
    stazioneCoppia: ["bg.js", "etichetta-sw.js", "registro-sw.js"],
    stazionePubblico: ["stampanti.js"],
    stampa: ["bg.js", "etichetta-sw.js", "stampanti.js"],
    aggiornaUltima: ["aggiorna.js", "ponte.js"],
    ponteOrdini: ["bg.js"],
    ponteValori: ["bg.js"],
    ordini: ["bg.js", "registra.js"],
  };
  const male = [];
  for (const [nome, files] of Object.entries(aMano)) {
    const k = K[nome];
    for (const f of files) {
      const t = leggi("extension/" + f);
      if (!t.includes(`"${k}"`) && !new RegExp(`[{,]\\s*${k.replace(/\./g, "\\.")}\\s*:`).test(t)) male.push(`${f}: ${k}`);
    }
  }
  check(Object.keys(K).length === Object.keys(aMano).length && !male.length, `ogni chiave in CHIAVE è quella che gli altri file leggono${male.length ? " — NO: " + male.join(", ") : ""}`);
  const senzaNote = (t) => t.replace(/\/\/[^\n]*/g, "");   // (nelle note il nome vero si può dire)
  const sw2 = senzaNote(leggi("extension/ponte-sw.js")), st = senzaNote(leggi("extension/stazione-sw.js"));
  const ricopiate = ["stazione.coppia", "aggiornaUltima", "ponte.ordini", "ponte.valori"].filter((k) => sw2.includes(`"${k}"`) || st.includes(`"${k}"`));
  check(!ricopiate.length && /coppia: PsaArchivio\.CHIAVE\.stazioneCoppia/.test(st) && /pubblico: PsaArchivio\.CHIAVE\.stazionePubblico/.test(st),
    `ponte-sw.js e stazione-sw.js usano i nomi, non le stringhe${ricopiate.length ? " — ricopiate: " + ricopiate : ""}`);
  const bg = leggi("extension/bg.js");
  check(/importScripts\("cassa\.js", "ponte-host\.js", "ponte-cripto\.js", "archivio\.js", "ponte-sw\.js"\)/.test(bg) && /importScripts\("archivio\.js", "stazione-sw\.js"\)/.test(bg),
    "bg.js carica archivio.js prima del ponte e della stazione");
}


console.log(`\n${ko ? "CHIAVI: " + ko + " NON VANNO" : "CHIAVI: TUTTO OK"} (${ok} controlli)`);
process.exit(ko ? 1 : 0);
