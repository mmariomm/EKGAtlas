// Il popup dell'icona (solo build mini): apre la pagina della stazione di stampa
// o quella dell'associazione dell'iPhone, in una scheda. Nessuna scrittura.
"use strict";
function apri(pagina) {
  chrome.tabs.create({ url: chrome.runtime.getURL(pagina) });
  window.close();
}
document.getElementById("staz").addEventListener("click", () => apri("stazione.html"));
document.getElementById("iphone").addEventListener("click", () => apri("ponte.html"));
