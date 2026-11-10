/*
 * La build «PS Assist · Lettura e stampa» (mini, sola lettura): le STESSE
 * sorgenti della build normale, con una bandiera (extension/sola-lettura.js a
 * `true`) e un manifest a parte. Qui c'è l'unica cosa che le distingue davvero:
 *  - il NOME e la descrizione (quello che si vede in chrome://extensions);
 *  - la CHIAVE fissa, diversa da quella normale: due estensioni separate, con id
 *    stabili e distinti, ognuna con la sua associazione dell'iPhone e il suo
 *    aggiornamento. È la chiave PUBBLICA (va nel manifest, serve solo a fissare
 *    l'id): la privata non sta nel repository e non serve per il carico da
 *    cartella. NON è una chiave del ponte (quella nasce casuale a ogni
 *    associazione e non si mette mai nella build).
 *  - la ricetta SISS (una SCRITTURA) tolta dai content script: non serve a un PC
 *    di sola lettura, ed è un pezzo di scrittura in meno a bordo.
 *  - la pagina propria (options_ui → ponte.html): stato dell'associazione, QR,
 *    «Scollega», e la riga «Aggiornato alla versione X · data».
 *
 * Lo usa tools/dist.mjs per scrivere dist/ps-assist-lettura.zip, e test/ext-mini.mjs.
 */

// La chiave pubblica fissa della build mini (id a parte dalla build normale).
export const LETTURA_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAytiHbR7RsveimO0o29OJhpUmE25bk0Zt0PWqQl0RJmuKf6vmBsZVMTzB4pd6rCJaSIOQjXj45Q7UcsHvv4KEybD/HSkwIKhdlVUuCJXdwymp7DQf6Ez5vP0QwjkjiI0JinWicVYWJbzDbkN+Xtj7ANugrFpNkcoDXYFwxjzZ1myt4iQ31YftT0oKeC7laW2i20cYt4Ial4e3OcNgHu+Pa8uPFDdLx2zcA4Xv0QXKh7VICL0DJPQL15/Oobp3kRzc05AhJGSa9sLUH5934bkKfkWOyto7QbgU5kcWqgEE17gWfc/JnueFXYo5XTK6R7RiiIZ4z5Tw1lVsOicZ2w5GgwIDAQAB";

export const LETTURA_NOME = "PS Assist · Lettura e stampa";

// Il content script della ricetta SISS (scrittura): via dalla build mini.
const SCRITTURE_CS = new Set(["ricetta-siss.js"]);

// Il manifest della build mini, dal manifest normale.
export function manifestLettura(base) {
  const m = JSON.parse(JSON.stringify(base));
  m.name = LETTURA_NOME;
  m.short_name = "PS Assist Lettura";
  m.description = "Porta d'ingresso in SOLA LETTURA per l'iPhone del medico (pazienti, esiti, cartella, referti) e stazione di stampa. Non aggiunge esami né terapie: solo visualizzazione e ristampa.";
  m.key = LETTURA_KEY;
  if (Array.isArray(m.content_scripts)) {
    m.content_scripts = m.content_scripts.filter((cs) => !(cs.js || []).some((f) => SCRITTURE_CS.has(f)));
  }
  // la sua pagina: stato dell'associazione (QR, Scollega) e riga aggiornamento
  m.options_ui = { page: "ponte.html", open_in_tab: true };
  // il mini non ha il pannello ⋯: l'icona nella barra apre un popup «menu» con
  // «Mostra QR — Stazione di stampa» e «Associa l'iPhone» (azione.html)
  m.action = { default_popup: "azione.html", default_title: LETTURA_NOME };
  return m;
}

// La bandiera della build mini (sola-lettura.js, nella copia dell'estensione).
export const LETTURA_BANDIERA = "// Build mini «Lettura e stampa»: sola lettura. Generato da tools (dist/ext-mini).\nself.PSA_SOLA_LETTURA = true;\n";
