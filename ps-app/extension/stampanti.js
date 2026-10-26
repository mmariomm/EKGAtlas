// La stampa automatica, nella pagina delle impostazioni. Le stampanti le chiede
// il service worker all'aiutante di Windows (native messaging); le scelte
// stanno in chrome.storage.local, `stampa` = { attiva, etichette, a4 }, e si
// salvano appena fatte. L'A4, finché non la scegli, è la predefinita di
// Windows; scelte tutte e due, la stampa automatica è accesa (l'interruttore
// la spegne). (Un modulo: i nomi qui non toccano quelli di portale.js.)
const $ = (id) => document.getElementById(id);
const sel = { etichette: $("setic"), a4: $("sa4") };
let stampanti = [];   // quelle dell'aiutante; [] = aiutante non raggiungibile
let motivo = "";      // perché, se non è raggiungibile

const leggi = async () => (await chrome.storage.local.get("stampa")).stampa || {};
const salva = async (parte) => chrome.storage.local.set({ stampa: { ...(await leggi()), ...parte } });
const dice = (testo, ok) => { const m = $("sm"); m.textContent = testo; m.className = "msg " + (ok ? "ok" : "ko"); };

// lo stato in una parola (e perché), le due tendine, i bottoni
async function mostra() {
  const { stampa: s = {}, stampaEsito: e = null } = await chrome.storage.local.get(["stampa", "stampaEsito"]);
  const pronta = !!(s.etichette && s.a4);
  const persa = stampanti.length ? [s.etichette, s.a4].find((x) => x && !stampanti.includes(x)) : "";
  const [testo, tono, perche] = !stampanti.length
    ? (/non è installato/.test(motivo) ? ["non installata", "", ""] : ["errore", "ko", motivo])
    : persa ? ["errore", "ko", `La stampante «${persa}» non c'è più su questo PC: scegline un'altra.`]
    : !pronta ? ["scegli le due stampanti", "warn", ""]
    : s.attiva === false ? ["spenta", "", "I fogli passano dal dialogo di stampa, come prima."]
    : ["attiva", "ok", e && e.ok === false ? `L'ultima stampa non è uscita: ${e.why}` : ""];
  $("sst").textContent = `Stampa automatica: ${testo}`;
  $("sst").className = "stato " + tono;
  $("sperche").textContent = perche;
  $("sperche").hidden = !perche;
  for (const [tipo, el] of Object.entries(sel)) {
    const scelta = s[tipo] || "";
    // quella scelta e sparita dal PC si vede lo stesso, segnata
    const nomi = scelta && !stampanti.includes(scelta) ? [scelta, ...stampanti] : stampanti;
    el.replaceChildren(new Option("— scegli —", ""), ...nomi.map((n) => new Option(stampanti.includes(n) ? n : `${n} (non trovata)`, n)));
    el.value = scelta;
    el.disabled = !stampanti.length;
  }
  for (const b of document.querySelectorAll("[data-prova]")) b.disabled = !stampanti.length || !sel[b.dataset.prova].value;
  $("sauto").checked = pronta && s.attiva !== false;
  $("sauto").disabled = !pronta || !stampanti.length;
  $("sinst").open = !stampanti.length;
}

// chiede all'aiutante se c'è e che stampanti vede
async function controlla() {
  $("sst").textContent = "Stampa automatica: controllo…";
  $("sst").className = "stato";
  const r = await chrome.runtime.sendMessage({ t: "stampaStato" }).catch((e) => ({ ok: false, why: String(e && e.message || e) }));
  stampanti = r && r.ok ? r.stampanti : [];
  motivo = r && r.ok ? "" : (r && r.why) || "nessuna risposta";
  if (r && r.ok && !(await leggi()).a4 && stampanti.includes(r.predefinita)) await salva({ a4: r.predefinita });
  await mostra();
}

for (const [tipo, el] of Object.entries(sel)) el.addEventListener("change", () => salva({ [tipo]: el.value }));
$("sauto").addEventListener("change", () => salva({ attiva: $("sauto").checked }));
for (const b of document.querySelectorAll("[data-prova]")) {
  b.addEventListener("click", async () => {
    const tipo = b.dataset.prova, stampante = sel[tipo].value;
    b.disabled = true;
    dice(`Mando la pagina di prova a ${stampante}…`, true);
    const r = await chrome.runtime.sendMessage({ t: "stampaProva", tipo, stampante }).catch(() => null);
    dice(r && r.ok ? `Pagina di prova mandata a ${r.stampante}: controlla che sia uscita.` : `Non riuscita: ${(r && r.why) || "nessuna risposta"}`, !!(r && r.ok));
    b.disabled = false;
  });
}
$("sid").textContent = chrome.runtime.id;
$("sidcopia").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(chrome.runtime.id); $("sidcopia").textContent = "Copiato"; }
  catch { $("sidcopia").textContent = "Selezionalo e copialo"; }
});
$("sric").addEventListener("click", controlla);
// le scelte cambiano anche dal menu ⋯ del pannello, e a ogni stampa (l'esito)
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.stampa || ch.stampaEsito)) mostra(); });
controlla();
