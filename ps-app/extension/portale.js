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

$("ok").addEventListener("click", async () => {
  let origine;
  try { origine = new URL($("u").value.trim()).origin; }
  catch { return dice("Non è un indirizzo. Incolla quello che vedi nella barra del browser, per intero.", false); }
  if (!/^https?:$/.test(new URL(origine).protocol)) return dice("Serve un indirizzo http o https.", false);
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
