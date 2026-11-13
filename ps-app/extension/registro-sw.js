/*
 * PS Assist — l'ANNUNCIO al registro dei PC (importato da bg.js, dopo ponte-sw.js e stazione-sw.js).
 *
 * Sul telefono, ⋯ → Dispositivi elenca anche gli altri PC con PS Assist, associati o no (il registro del
 * ripetitore: worker/ponte-logica.js, «il registro»). Per comparire lì questo PC si annuncia: un POST
 * piccolo (testo, ~250 byte) verso /ponte/registro dello stesso ripetitore del ponte — NESSUNA presa,
 * nessuna sveglia, nessun documento fuori schermo.
 *
 * Che cosa dice, e solo questo: un numero a caso dell'installazione (registro.id; il telefono non lo vede),
 * il nome del PC (quello che il medico gli dà sulla pagina iPhone, ponte.nomePc, o uno generato), il tipo
 * (`pc`, `lettura` per la build «Lettura e stampa» fino alla 3.87, `stazione` per la build «Stampa Infermeria»), la versione, e tre impronte opache (SHA-256, 16 byte):
 *   tel   della stanza del telefono associato (se un telefono è entrato davvero): il telefono, che conosce la
 *         stanza, si riconosce; chi legge senza conoscerla vede solo «associato a un altro telefono»
 *   sta   { nome, tag }: la stazione di stampa dove stampa questo PC (tag: dal codice di sei cifre della coppia)
 *   stz   { nome, tag? }: questo PC È una stazione di stampa (lo stesso tag, se è collegata a un PC del medico)
 * Mai pazienti, mai chi è nel gestionale, mai chiavi, mai il numero della stanza.
 *
 * Quando: al più ogni 30 minuti, e solo con una scheda del gestionale aperta (non sulla pagina d'accesso) o
 * la pagina della stazione (o quella iPhone) aperta — lo si guarda quando una pagina del gestionale si
 * carica (ponteSveglia) o una di quelle pagine chiede il suo stato: di notte, a gestionale chiuso, niente.
 * In più, subito (ma al più uno ogni 15 secondi) quando si installa o si aggiorna e quando cambia quello che
 * l'annuncio dice (un'associazione fatta o tolta, il nome). «Non comparire nella lista» (pagina iPhone,
 * registro.no): un ultimo POST che toglie la riga, e poi più niente.
 * Per l'IT dell'ospedale: al più 48 POST HTTPS piccoli al giorno per PC acceso giorno e notte col gestionale
 * aperto (in pratica uno ogni 30 minuti di lavoro), verso lo stesso host del ponte — niente di nuovo da
 * permettere, e niente che somigli a un battito fisso: parte da un gesto (una pagina aperta), non da un orologio.
 */
/* global ponteIndirizzo, psaGestionale, PonteCripto */

const ANN = {
  id: "registro.id",            // storage.local: il numero a caso dell'installazione (16 byte, base64url)
  ultimo: "registro.ultimo",    // storage.local: { ts, firma, via? } l'ultimo annuncio partito
  no: "registro.no",            // storage.local: true = «Non comparire nella lista»
};
const ANN_OGNI = 30 * 60e3;     // al più un annuncio ogni tanto (se non cambia niente)
const ANN_MIN = 15e3;           // e, se qualcosa cambia, al più uno ogni 15 secondi (un'associazione scrive più volte di fila)
const ANN_RIPROVA = 5 * 60e3;   // non partito (la rete): si riprova al prossimo gesto, dopo tanto
const ANN_CHIAVI = ["ponte.nomePc", "ponte.coppia", "stazione.coppia", "stazione.qui", "stazione.nome", ANN.no];
const annOra = () => Date.now();
// La build «Stampa Infermeria» (solo stazione, self.PSA_SOLO_STAZIONE): si annuncia come `stazione`. Lì non
// c'è gestionale né pagina iPhone: la stazione è sempre sul ponte finché Chrome è aperto (stazione-sw.js,
// staSempre), quindi il giro dei 30 minuti vale a ogni risveglio, e all'avvio di Chrome si annuncia.
const annStazione = () => self.PSA_SOLO_STAZIONE === true;
const annKind = () => (annStazione() ? "stazione" : self.PSA_SOLA_LETTURA === true ? "lettura" : "pc");
const annB64u = (b) => PonteCripto.b64u(b);
async function annImpronta(etichetta, s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ps-registro/${etichetta}|${s}`)));
  return annB64u(h.subarray(0, 16));
}
async function annId() {
  const o = await chrome.storage.local.get(ANN.id);
  if (typeof o[ANN.id] === "string" && /^[A-Za-z0-9_-]{22}$/.test(o[ANN.id])) return o[ANN.id];
  const id = annB64u(crypto.getRandomValues(new Uint8Array(16)));
  await chrome.storage.local.set({ [ANN.id]: id });
  return id;
}
// il nome generato: il tipo e quattro segni dell'id (sempre gli stessi per questo PC)
function annNomeGenerato(id) {
  const s = id.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
  return `${annStazione() ? "Stampa Infermeria" : self.PSA_SOLA_LETTURA === true ? "Lettura e stampa" : "PC"} ${s}`;
}
// Quello che l'annuncio dice adesso (senza l'ora)
async function annAnnuncio() {
  const id = await annId();
  const o = await chrome.storage.local.get(ANN_CHIAVI);
  const n = annStazione() ? o["stazione.nome"] : o["ponte.nomePc"];   // (la stazione: il nome che le dà la sua pagina)
  const nome = typeof n === "string" && n.trim() ? n.replace(/\s+/g, " ").trim().slice(0, 40) : annNomeGenerato(id);
  let ver = "";
  try { ver = String(chrome.runtime.getManifest().version || ""); } catch { /* niente */ }
  const a = { v: 1, id, nome, kind: annKind(), ...(/^\d{1,4}(\.\d{1,6}){0,3}$/.test(ver) ? { ver } : {}) };
  const c = o["ponte.coppia"];
  // associato davvero: un telefono è entrato (non un QR ancora sullo schermo)
  if (c && c.usata && /^[0-9a-f]{32}$/.test(c.stanza || "")) a.tel = await annImpronta("tel", c.stanza);
  const codice = (x) => String(x || "").replace(/\D/g, "");
  const sc = o["stazione.coppia"];
  if (sc && !sc.revoca && codice(sc.codice).length === 6) a.sta = { nome: String(sc.nome || "Infermeria").slice(0, 40), tag: await annImpronta("sta", codice(sc.codice)) };
  const q = o["stazione.qui"];
  if (q && !q.revoca) {
    a.stz = { nome: String(o["stazione.nome"] || "Infermeria").replace(/\s+/g, " ").trim().slice(0, 40) || "Infermeria",
      ...(q.conferma && codice(q.codice).length === 6 ? { tag: await annImpronta("sta", codice(q.codice)) } : {}) };
  }
  return { a, no: o[ANN.no] === true };
}
async function annManda(host, corpo) {
  const r = await fetch(`${host}/ponte/registro`, { method: "POST", body: JSON.stringify(corpo), headers: { "content-type": "text/plain" },
    credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  return r.ok;
}
// `evento`: install, aggiornamento, associazione o nome cambiati — non aspetta i 30 minuti né una pagina aperta.
// `aperta`: chi chiama sa già che una pagina che conta è aperta (la stazione, la pagina iPhone).
let annFila = Promise.resolve(), annTimer = 0;
function annForse({ evento = false, aperta = false } = {}) {
  const p = annFila.then(() => annForseOra(evento, aperta));
  annFila = p.catch(() => {});
  return p;
}
async function annForseOra(evento, aperta) {
  const host = typeof ponteIndirizzo === "function" ? await ponteIndirizzo() : "";
  if (!host) return { fatto: false, perche: "host" };
  const { a, no } = await annAnnuncio();
  const u = (await chrome.storage.local.get(ANN.ultimo))[ANN.ultimo] || null;
  const ora = annOra(), firma = JSON.stringify(a), fa = u ? ora - (u.ts || 0) : Infinity;
  if (no) {
    if (!u || u.via) return { fatto: false, perche: "fuori dalla lista" };
    await chrome.storage.local.set({ [ANN.ultimo]: { ts: ora, via: true } });
    const ok = await annManda(host, { v: 1, id: a.id, via: true }).catch(() => false);
    if (!ok) await chrome.storage.local.set({ [ANN.ultimo]: { ts: ora, firma: "" } });   // (riprova al prossimo gesto)
    return { fatto: ok, via: true };
  }
  const cambiato = !u || u.via || u.firma !== firma;
  // qualcosa è cambiato da poco dopo l'ultimo: fra un minuto (se il service worker c'è ancora; se no, al prossimo gesto)
  if (cambiato && fa < ANN_MIN) {
    clearTimeout(annTimer);
    annTimer = setTimeout(() => { annForse({ evento: true }).catch(() => {}); }, ANN_MIN - fa + 500);
    return { fatto: false, perche: "presto" };
  }
  if (!(cambiato && (evento || fa >= ANN_MIN)) && fa < ANN_OGNI) return { fatto: false, perche: "presto" };
  // il giro dei 30 minuti (o un cambio senza evento): solo con il gestionale o la pagina della stazione aperti
  if (!evento && !aperta && !annStazione() && !(typeof psaGestionale === "function" && await psaGestionale())) return { fatto: false, perche: "niente aperto" };
  await chrome.storage.local.set({ [ANN.ultimo]: { ts: ora, firma } });
  const ok = await annManda(host, a).catch(() => false);
  if (!ok) await chrome.storage.local.set({ [ANN.ultimo]: { ts: ora - ANN_OGNI + ANN_RIPROVA, firma: "" } });
  return { fatto: ok };
}
// I gesti: una pagina del gestionale che si carica (ponteSveglia), la pagina della stazione o quella iPhone
// che chiedono il loro stato. Non risponde a niente: ascolta e basta (le risposte le danno ponte-sw.js e stazione-sw.js).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
  const pagina = !!sender && typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
  if (msg.t === "ponteSveglia") annForse().catch(() => {});
  else if (pagina && (msg.t === "stazioneStato" || msg.t === "ponteStato")) annForse({ aperta: true }).catch(() => {});
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ANN_CHIAVI.some((k) => k in ch)) annForse({ evento: true }).catch(() => {});
});
chrome.runtime.onInstalled?.addListener(() => { annForse({ evento: true }).catch(() => {}); });
// la stazione dell'infermeria: all'avvio di Chrome (il giro dei 30 minuti, nessun battito in più)
if (annStazione()) chrome.runtime.onStartup?.addListener(() => { annForse().catch(() => {}); });
