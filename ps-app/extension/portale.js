// Il permesso si chiede DA QUI. chrome.permissions.request vuole un gesto
// dell'utente, e un gesto non sopravvive al salto di messaggio dal pannello al
// service worker: chiesto di là non compariva nessun prompt, e il pannello
// diceva «permesso non concesso» dando la colpa al medico.
const $ = (id) => document.getElementById(id);
const dice = (testo, ok) => { const m = $("m"); m.textContent = testo; m.className = "msg " + (ok ? "ok" : "ko"); };

const mostra = async () => {
  const o = await chrome.storage.local.get("portale");
  $("cur").textContent = o.portale || "nessuno";
  $("via").hidden = !o.portale;
  if (o.portale && !$("u").value) $("u").value = o.portale;
};
mostra();

// Due tocchi: il primo dice QUALE sito riceverà il pannello e il registratore,
// il secondo (lo stesso sito, entro 30 secondi) lo autorizza — e il permesso
// di Chrome, che vuole il gesto, si chiede proprio su quel secondo tocco.
const OK_TESTO = $("ok").textContent;
let daConfermare = null;
const conferma = (o) => {
  clearTimeout(conferma.t);
  daConfermare = o ? { origine: o, ts: Date.now() } : null;
  $("ok").textContent = o ? `Conferma: autorizza ${o}` : OK_TESTO;
  if (o) conferma.t = setTimeout(() => conferma(null), 30e3);
};
$("u").addEventListener("input", () => conferma(null));
$("ok").addEventListener("click", async () => {
  let origine;
  try { origine = new URL($("u").value.trim()).origin; }
  catch { conferma(null); return dice("Non è un indirizzo. Incolla quello che vedi nella barra del browser, per intero.", false); }
  if (!/^https?:\/\/[^/]+$/.test(origine)) { conferma(null); return dice("Serve un indirizzo http o https.", false); }
  if (!daConfermare || daConfermare.origine !== origine || Date.now() - daConfermare.ts > 30e3) {
    conferma(origine);
    return dice(`Il pannello e il registratore gireranno anche su ${origine}, con le pagine che vi apri. È il portale dell'ospedale? Premi «Conferma» per autorizzarlo.`, true);
  }
  conferma(null);
  let dato;
  try { dato = await chrome.permissions.request({ origins: [origine + "/*"] }); }
  catch (e) { return dice("Chrome ha rifiutato: " + (e && e.message || e), false); }
  if (!dato) return dice("Permesso non concesso: senza quello il programma non può leggere quella pagina.", false);
  const r = await chrome.runtime.sendMessage({ t: "aggiungiPortale", url: origine }).catch(() => null);
  if (!r || !r.ok) return dice((r && r.why) || "Non riuscito.", false);
  await mostra();
  dice(`Fatto: ${r.origine}. Ricarica la pagina dello storico e il pannello comparirà.`, true);
});

$("via").addEventListener("click", async () => {
  const o = await chrome.storage.local.get("portale");
  if (!o.portale) return;
  await chrome.permissions.remove({ origins: [o.portale + "/*"] }).catch(() => {});
  await chrome.runtime.sendMessage({ t: "togliPortale" }).catch(() => {});
  await mostra();
  dice("Rimosso.", true);
});

// La forma del pannello (`forma` in chrome.storage.local): ogni scheda del
// gestionale la segue subito (core.js, seguiForma). Finché qui non si è scelto
// niente, la scrive il pannello: quella che c'è.
const FORME = {
  passaggio: "Il mouse fermo sulla pill lo apre, uscendo si richiude; un clic lo tiene aperto.",
  affianca: "Una colonna a destra, il gestionale visibile a sinistra: si apre e si chiude con un tocco.",
};
const mostraForma = async () => {
  const f = (await chrome.storage.local.get("forma")).forma;
  const su = FORME[f] ? f : "passaggio";
  for (const b of document.querySelectorAll("[data-forma]")) b.setAttribute("aria-pressed", String(b.dataset.forma === su));
  $("formadice").textContent = FORME[su];
};
mostraForma();
for (const b of document.querySelectorAll("[data-forma]")) {
  b.addEventListener("click", async () => { await chrome.storage.local.set({ forma: b.dataset.forma }); mostraForma(); });
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.forma) mostraForma(); });
