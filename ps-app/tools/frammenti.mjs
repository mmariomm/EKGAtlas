/*
 * Il sorgente del pannello sta in src/core/, a frammenti: cuciti uno dopo
 * l'altro, in QUESTO ordine, sono il file che gira (extension/content.js e il
 * bookmarklet, dopo i segnaposto). I frammenti non sono moduli: sono pezzi di
 * un file solo (un'unica IIFE, e la classe Panel va da 42 a 53), tagliati
 * dove cambia il lavoro. L'ordine è scritto qui, a mano: nessun glob.
 *
 * Ogni frammento comincia con qualche riga «//@» che dice cosa c'è dentro.
 * Quelle righe si tolgono prima di cucire: la build è byte per byte quella
 * del vecchio src/core.js in un file solo.
 *
 * Chi legge il sorgente (tools/build.mjs, tools/editor.mjs,
 * tools/verifica-build.mjs, le prove che prendono una funzione così com'è)
 * lo legge da qui: leggiCore().
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const FRAMMENTI = [
  "00-intestazione.js",
  "05-utili.js",
  "10-pagine.js",
  "12-modelli-stampa-referti.js",
  "14-storico-risultati.js",
  "16-esiti-carrello.js",
  "20-magazzino-cancello.js",
  "22-pazienti-aree.js",
  "24-segue-gestionale.js",
  "26-stato-esami-vitali.js",
  "28-note-dafare.js",
  "29-catalogo.js",
  "30-motore.js",
  "32-pianta.js",
  "40-pannello-stile.js",
  "41-pannello-base.js",
  "42-panel-classe.js",
  "43-panel-selezione.js",
  "44-panel-ordine.js",
  "45-panel-viste.js",
  "46-panel-tabellone.js",
  "47-panel-stanza.js",
  "48-panel-esiti.js",
  "49-panel-dafare.js",
  "50-panel-referti.js",
  "51-panel-schede.js",
  "52-panel-eo-esami.js",
  "53-panel-finestra.js",
  "60-conferma.js",
  "65-pdf-testo.js",
  "70-stampa.js",
  "75-ponte.js",
  "76-ponte-gestionale.js",
  "80-avvio.js",
  "85-terapia.js",
  "90-portale.js",
];

// le righe «//@» in cima a un frammento (solo in cima: più giù nessuna riga comincia così)
const INTESTAZIONE = /^(?:\/\/@[^\n]*\n)+/;

export function leggiCore(root) {
  const dir = join(root, "src/core");
  const presenti = readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
  const fuori = presenti.filter((f) => !FRAMMENTI.includes(f));
  const mancano = FRAMMENTI.filter((f) => !presenti.includes(f));
  if (fuori.length || mancano.length) {
    throw new Error(`src/core/: ${fuori.length ? "frammenti non in tools/frammenti.mjs: " + fuori.join(", ") : ""}`
      + `${fuori.length && mancano.length ? "; " : ""}${mancano.length ? "mancano: " + mancano.join(", ") : ""}`);
  }
  return FRAMMENTI.map((f, i) => {
    const testo = readFileSync(join(dir, f), "utf8").replace(INTESTAZIONE, "");
    if (/^\/\/@/m.test(testo)) throw new Error(`src/core/${f}: una riga «//@» fuori dall'intestazione`);
    if (i < FRAMMENTI.length - 1 && !testo.endsWith("\n")) throw new Error(`src/core/${f}: deve finire con un a capo`);
    return testo;
  }).join("");
}
