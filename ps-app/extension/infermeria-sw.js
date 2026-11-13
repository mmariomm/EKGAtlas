/*
 * PS Assist · Stampa Infermeria — il poco che la build «solo stazione» fa in più,
 * nel service worker (importato da bg.js solo con self.PSA_SOLO_STAZIONE).
 *
 * La stazione è l'estensione stessa: sul ponte finché Chrome è aperto e lei è
 * collegata (stazione-sw.js, staSempre), con o senza la sua pagina. La pagina
 * (stazione.html: il QR, le stampanti, lo stato) serve solo a collegarla e a
 * scegliere le stampanti; si apre dall'icona, e da sola la prima volta.
 *
 * Questo PC non fa più da «PC di sola lettura» per l'iPhone (il ruolo `pc` della
 * mini fino alla 3.87): un'associazione col telefono rimasta da allora si chiude,
 * una volta. Il collegamento della stazione e le stampanti restano.
 */
/* global pt, ponteCaricato, ponteVia, staCaricato, stzAvvia */

// Caricata la prima volta: la pagina della stazione, per collegarla e scegliere le stampanti.
chrome.runtime.onInstalled?.addListener((d) => {
  if (d && d.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("stazione.html") }).catch(() => {});
});

// L'iPhone associato a questo PC quando era la mini «Lettura e stampa»: via (la chiave, dalla cassa).
const infermeriaPulita = (async () => {
  await ponteCaricato;
  if (pt.coppia) await ponteVia("questo PC ora è solo la stazione di stampa", "Questo PC ora è solo la stazione di stampa dell'infermeria: l'iPhone non è più associato qui");
})().catch(() => {});

// All'avvio di Chrome: la stazione sul ponte (anche senza nessuna pagina aperta).
chrome.runtime.onStartup?.addListener(() => { staCaricato.then(() => stzAvvia()).catch(() => {}); });
