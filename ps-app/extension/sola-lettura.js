// La bandiera della build: la build normale è a scrittura piena, quella «mini»
// è di sola lettura. Caricata per prima — dal service worker (importScripts in
// bg.js) e come primo content script del gestionale — così la vedono bg.js,
// ponte-sw.js, aggiorna.js e content.js. La build mini la riscrive a `true`
// (tools/dist.mjs, nella copia dell'estensione dello zip «Lettura e stampa»);
// qui, nella sorgente, resta `false`. Non si modifica a mano.
self.PSA_SOLA_LETTURA = false;
// La build «Stampa Infermeria» (tools/lettura.mjs) è anche SOLO STAZIONE: la
// stazione di stampa sempre sul ponte, niente iPhone associato a questo PC.
self.PSA_SOLO_STAZIONE = false;
