// La stampa automatica, nella pagina delle impostazioni. Le stampanti le chiede
// il service worker all'aiutante di Windows (native messaging); le scelte
// stanno in chrome.storage.local, `stampa` = { attiva, etichette, a4, ruota },
// e si salvano appena fatte. L'A4, finché non la scegli, è la predefinita di
// Windows; scelte tutte e due, la stampa automatica è accesa (l'interruttore
// la spegne). `ruota`: se SumatraPDF può girare un'etichetta più larga che
// alta — di partenza no per Zebra, ZDesigner, TSC e Citizen, sì per le altre.
// In fondo, la stazione di stampa collegata a questo PC (`dove`: «PC · Infermeria»).
// (Un modulo: i nomi qui non toccano quelli di portale.js.)
const $ = (id) => document.getElementById(id);
const sel = { etichette: $("setic"), a4: $("sa4") };
// come in bg.js: la rotazione scelta, o quella di partenza per quel nome
const ruotaDi = (s) => (s.ruota === "no" || s.ruota === "auto" ? s.ruota : /zebra|zdesigner|tsc|citizen/i.test(s.etichette || "") ? "no" : "auto");
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
    ? (/non è installato/.test(motivo) ? ["non installata", "", motivo] : ["errore", "ko", motivo])
    : persa ? ["errore", "ko", `La stampante «${persa}» non c'è più su questo PC: scegline un'altra.`]
    : !pronta ? ["scegli le due stampanti", "warn", ""]
    : s.attiva === false ? ["spenta", "", "I fogli passano dal dialogo di stampa, come prima."]
    : ["attiva", "ok", e && e.ok === false ? `L'ultima stampa ${e.esito === "sconosciuto" ? "ha un esito sconosciuto" : "non è uscita"}: ${e.why}` : ""];
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
  $("sruota").value = ruotaDi(s);
  $("sruota").disabled = !stampanti.length || !s.etichette;
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

// (un'altra etichettatrice: la rotazione torna quella di partenza per il suo nome)
for (const [tipo, el] of Object.entries(sel)) el.addEventListener("change", () => salva({ [tipo]: el.value, ...(tipo === "etichette" ? { ruota: undefined } : {}) }));
$("sruota").addEventListener("change", () => salva({ ruota: $("sruota").value }));
$("sauto").addEventListener("change", () => salva({ attiva: $("sauto").checked }));
for (const b of document.querySelectorAll("[data-prova]")) {
  b.addEventListener("click", async () => {
    const tipo = b.dataset.prova, stampante = sel[tipo].value;
    b.disabled = true;
    dice(`Mando la pagina di prova a ${stampante}…`, true);
    const r = await chrome.runtime.sendMessage({ t: "stampaProva", tipo, stampante, ...(tipo === "etichette" ? { ruota: $("sruota").value } : {}) }).catch(() => null);
    dice(r && r.ok ? `Pagina di prova ${r.esito === "stampato" ? "stampata su" : "mandata a"} ${r.stampante}: controlla che sia uscita${tipo === "etichette" ? ", dritta e intera" : ""}.`
      : `${r && r.esito === "sconosciuto" ? "Esito sconosciuto" : "Non riuscita"}: ${(r && r.why) || "nessuna risposta"}`, !!(r && r.ok));
    b.disabled = false;
  });
}
$("sric").addEventListener("click", controlla);
// le scelte cambiano anche dal menu ⋯ del pannello, e a ogni stampa (l'esito)
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.stampa || ch.stampaEsito)) { mostra(); mostraStazione(); } });
controlla();

// La stazione di stampa collegata (stazione-sw.js: la collega l'iPhone, col QR
// della stazione): com'è, «Stampa: PC · Infermeria» (la scelta, `stampa.dove`),
// «Scollega» (due tocchi).
const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
let staArmata = false;
async function mostraStazione() {
  const sta = (await chrome.storage.session.get("stazione").catch(() => ({}))).stazione || null;
  const s = await leggi();
  $("stasi").hidden = !sta;
  $("stano").hidden = !!sta;
  if (!sta) return;
  const dove = s.dove === "stazione" ? "stazione" : "qui";
  $("stast").textContent = `${sta.nome} · collegata ${sta.via === "telefono" ? "dal telefono " : ""}alle ${hhmm(sta.dal)}`;
  $("stast").className = "stato " + (sta.presente ? "ok" : "warn");
  $("stariga").textContent = `${sta.presente ? "Risponde adesso" : "Adesso non risponde (Chrome chiuso su quel PC, o la rete)"} · codice ${sta.codice}, lo stesso sulla stazione.`;
  $("stanome").textContent = sta.nome;
  for (const b of document.querySelectorAll("[data-dove]")) b.setAttribute("aria-pressed", String(b.dataset.dove === dove));
  $("stavia").textContent = staArmata ? `Scollego? Gli ordini non stamperanno più in ${sta.nome}` : "Scollega";
}
for (const b of document.querySelectorAll("[data-dove]")) b.addEventListener("click", () => salva({ dove: b.dataset.dove === "stazione" ? "stazione" : "qui" }));
$("stavia").addEventListener("click", async () => {
  if (!staArmata) { staArmata = true; setTimeout(() => { staArmata = false; mostraStazione(); }, 5000); return mostraStazione(); }
  staArmata = false;
  await chrome.runtime.sendMessage({ t: "stazioneScollega", ruolo: "medico" }).catch(() => null);
  mostraStazione();
});
chrome.storage.onChanged.addListener((ch, area) => { if (area === "session" && ch.stazione) mostraStazione(); });
mostraStazione();
