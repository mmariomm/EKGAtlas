/*
 * PS Assist — l'aggiornamento da sé, dal service worker. Caricato da bg.js
 * (importScripts): vede le sue costanti (SA4, ordLeggi, inFilaOrd, ospite,
 * corto, b64).
 *
 * Una sveglia ogni quarto d'ora (creata solo se manca: un service worker che
 * riparte non la sposta). VERSION.txt da GitHub al più ogni sei ore: una GET
 * senza cookie e senza dati, l'unica cosa che esce; in storage.local
 * `aggiorna` = { ts, nuova, puo, come } (il pannello legge solo «come», se da
 * qui non si può). Una versione più nuova, se l'estensione gira dalla
 * cartella dell'installazione e l'aiutante c'è: lo zip si scarica UNA volta
 * (la rete di Chrome), si controlla (extension/manifest.json, stessa versione,
 * stessa chiave) e si tiene nella Cache Storage dell'estensione, ricontrollato
 * a ogni uso, una versione sola. Si applica solo quando è sicuro (aggOccupato:
 * niente ordine in corso o in coda, niente stampa, niente registrazione,
 * niente testo non salvato in una scheda del gestionale); la build completa
 * lo scambia solo senza schede del gestionale aperte, o all'avvio del browser
 * (entro un minuto, con lo zip già pronto). Lo scambio lo fa l'aiutante di
 * Windows (native messaging): la cartella %LOCALAPPDATA%\PSAssist\estensione
 * (la vecchia resta in estensione.prima) e i suoi file; poi
 * chrome.runtime.reload(). Andata male (lo zip, l'aiutante che dice di no o
 * non risponde): quella versione aspetta sei ore (`aggiornaPausa`), mai un
 * giro dopo l'altro. Nessun tocco del medico: né un puntino, né «Aggiorna
 * app», né «Ricarica».
 */
/* global SA4, ordLeggi, inFilaOrd, ospite, corto, b64, motoreDiScheda */

const AGG_BASE = "https://raw.githubusercontent.com/mmariomm/EKGAtlas/main/ps-app/dist/";
const AGG_ORE = 6 * 3600e3;              // ogni quanto si guarda GitHub; e la pausa dopo un guasto
const AGG_RIPROVA = 15;                  // minuti: se non era il momento, si riprova
const AGG_CACHE = "psassist-aggiorna";   // Cache Storage: lo zip scaricato e controllato (una versione sola)
const AGG_PAUSA = "aggiornaPausa";       // storage.local: { v, ts, why } — com'è andata male, e quando
const AGG_ZIP_MAX = 28 * 1024 * 1024;   // in base64 resta sotto i 40 MB che l'aiutante accetta
const AGG_ATTESA = 180e3;                // l'aiutante apre lo zip e scambia la cartella
const AGG_AVVIO = 60e3;                  // all'avvio del browser, lo scambio con le schede aperte: solo nel primo minuto
let aggNato = Date.now();                // quando è partito questo service worker (i test lo spostano)
const AGG_APERTO = new Set(["coda", "avvio", "corre", "stampo", "stampa"]);   // come ORDINE_APERTO nel pannello
const AGG_CARTELLA = "%LOCALAPPDATA%\\PSAssist\\estensione";
const AGG_OCCUPATO = "Dopo l'ordine in corso";
const AGG_SCHEDE = "Dopo la chiusura del gestionale";
// La build è di sola lettura? Allora scarica il SUO zip (quello mini). La
// versione (VERSION.txt) è unica per le due build, che escono insieme dallo
// stesso `npm run dist`.
const aggSolaLettura = () => typeof self !== "undefined" && self.PSA_SOLA_LETTURA === true;
const aggZipNome = () => (aggSolaLettura() ? "ps-assist-lettura.zip" : "ps-assist-latest.zip");
const aggMia = () => chrome.runtime.getManifest().version;
const aggVer = (v) => /^\d+(\.\d+){1,3}$/.test(String(v || "").trim());
function aggPiuNuova(a, b) {
  if (!aggVer(a)) return false;
  const x = String(a).trim().split(".").map(Number), y = String(b).trim().split(".").map(Number);
  for (let i = 0; i < 4; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}
// (un orologio rimesso indietro non ferma tutto per sempre)
const aggDaPoco = (ts) => { const d = Date.now() - (ts || 0); return d >= 0 && d < AGG_ORE; };
const aggPrendi = (nome) => fetch(AGG_BASE + nome, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
async function aggVersione() {
  const r = await aggPrendi("VERSION.txt");
  if (!r.ok) throw new Error(`GitHub non risponde (${r.status})`);
  const v = (await r.text()).trim();
  if (!aggVer(v)) throw new Error("VERSION.txt illeggibile");
  return v;
}

// Si può aggiornare da qui? L'estensione deve girare dalla cartella che
// l'aiutante scambia: c'è `installata.json` (lo scrive solo l'installazione)
// e l'aiutante dice che lì dentro c'è questa versione.
async function aggInstallata() {
  const come = `per aggiornarla con un tocco: stampa\\installa.cmd, poi in chrome://extensions carica l'estensione da ${AGG_CARTELLA}`;
  const marca = await fetch(chrome.runtime.getURL("installata.json")).then((r) => r.ok).catch(() => false);
  if (!marca) return { puo: false, come };
  const c = await ospite({ t: "chi" }, 30e3);
  if (!c.ok) return { puo: false, come: `l'aiutante non risponde (${corto(c.why, 120)}): rilancia stampa\\installa.cmd` };
  if (String(c.estensione || "") !== aggMia()) return { puo: false, come };
  return { puo: true, come: "" };
}

async function aggControlla() {
  const prima = (await chrome.storage.local.get("aggiorna")).aggiorna || {};
  if (aggDaPoco(prima.ts)) return prima;
  let v;
  try { v = await aggVersione(); } catch { return prima; }   // senza rete: resta quello che si sapeva
  const rec = { ts: Date.now(), nuova: "", puo: false, come: "" };
  if (aggPiuNuova(v, aggMia())) {
    const i = await aggInstallata();
    Object.assign(rec, { nuova: v, puo: i.puo, come: i.puo ? "" : `C'è la ${v}: ${i.come}.` });
  }
  await chrome.storage.local.set({ aggiorna: rec });
  return rec;
}

// Non è il momento: un ordine, una stampa, un ordine dal telefono, o un giro
// che gira in una scheda del medico (il suo appunto, o il presidio di chi sta
// mandando); un foglio sulla stazione di stampa; una registrazione; un testo
// non salvato in una scheda del gestionale (una cartella, una dimissione, la
// terapia, il pannello). Nel dubbio (la scheda non risponde in tempo, o non si
// lascia leggere) è occupato: si riprova fra poco. Non contano le schede
// scartate da Chrome e quelle dei PDF delle stampe (lì il pannello non nasce).
const aggPdf = (t) => (chrome.runtime.getManifest().content_scripts?.[0]?.exclude_matches || []).some((m) => String(t.url || "").startsWith(m.replace(/\*$/, "")));
async function aggOccupato() {
  if ((await ordLeggi()).some((x) => AGG_APERTO.has(x.stato)) || motoreDiScheda()) return true;   // (anche il motore di una scheda)
  if (typeof stz !== "undefined" && (stz.stampa.size || stz.inCorso.size)) return true;          // (un foglio per la stazione che arriva o stampa)
  try { if (typeof regLeggi === "function") await regPronto; } catch { /* sotto */ }
  if ((typeof regAttiva === "function" && regAttiva()) || (typeof regStato !== "undefined" && regStato && regStato.stato === "fermo" && !regStato.errore && regSalvando(regStato))) return true;
  const schede = await chrome.tabs.query({ url: SA4 + "/*" }).catch(() => []);
  for (const t of schede) {
    if (t.discarded || aggPdf(t)) continue;
    const r = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: t.id }, injectImmediately: true, args: [10 * 60e3, 25e3],
        func: (corsaTtl, presidioMs) => {
          const leggi = (d, k) => { try { return JSON.parse(d.getItem("psassist:" + k)); } catch { return null; } };
          const c = leggi(sessionStorage, "corsa.v1"), p = leggi(localStorage, "corsa.presidio.v1");
          if ((c && Date.now() - (c.ts || 0) < corsaTtl) || (p && Date.now() - (p.ts || 0) < presidioMs)) return true;
          // un ordine che aspetta la Conferma, o la terapia a metà
          if (leggi(sessionStorage, "confirm.v1") || leggi(sessionStorage, "receipt.v1") || leggi(sessionStorage, "terapia.v1")) return true;
          // una dimissione o un testo dell'EO riscritti e non salvati (la bozza resta finché non si salva o si butta)
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i) || "";
            if (/^psassist:(dimdraft|eodraft)\./.test(k)) { const d = leggi(sessionStorage, k.slice(9)); if (d && String(d.testo || "").trim()) return true; }
          }
          // un testo cambiato e non inviato: nei campi della pagina (la cartella) e in quelli del pannello
          const h = document.getElementById("psassist-host");
          for (const radice of [document, h && h.shadowRoot]) {
            if (!radice) continue;
            for (const t of radice.querySelectorAll("textarea")) if (!t.readOnly && !t.disabled && t.value !== t.defaultValue) return true;
          }
          return false;
        },
      }).catch(() => null),
      new Promise((res) => setTimeout(() => res(null), 3000)),
    ]);
    if (!r || !r[0] || r[0].result !== false) return true;   // (libera solo se lo dice: un «no» esplicito)
  }
  return false;
}

// Schede del gestionale aperte (quelle dove nasce il pannello). Applicare un
// aggiornamento con una scheda aperta la lascia col pannello orfano e la pillola
// «Ricarica la pagina» a metà turno: la build completa aspetta che non ce ne
// siano (le schede non si ricaricano mai da sole: una pagina di risposta di un
// POST rimanderebbe il modulo). All'avvio del browser, invece, si applica
// subito, con lo zip già pronto e solo nel primo minuto (le schede
// ripristinate al massimo mostrano la pillola; dopo, il medico sta lavorando).
async function aggSchede() {
  const cs = chrome.runtime.getManifest().content_scripts?.[0] || {};
  const schede = await chrome.tabs.query({ url: cs.matches || [SA4 + "/sa4pso/*"] });
  return schede.filter((t) => !t.discarded && !aggPdf(t)).length;
}

// Il manifest dentro lo zip (extension/manifest.json): il registro centrale,
// poi quel file solo — salvato o deflate.
async function aggManifestDelloZip(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf);
  let fine = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { fine = i; break; }
  if (fine < 0) throw new Error("non è uno zip");
  const n = dv.getUint16(fine + 10, true);
  let p = dv.getUint32(fine + 16, true);
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("zip rovinato");
    const metodo = dv.getUint16(p + 10, true), dim = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(u.subarray(p + 46, p + 46 + ln));
    p += 46 + ln + le + lc;
    if (nome !== "extension/manifest.json") continue;
    if (dv.getUint32(loc, true) !== 0x04034b50) throw new Error("zip rovinato");
    const dati = u.subarray(loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true)).subarray(0, dim);
    let testo;
    if (metodo === 0) testo = new TextDecoder().decode(dati);
    else if (metodo === 8) testo = await new Response(new Blob([dati]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    else throw new Error("zip compresso in un modo che non leggo");
    return JSON.parse(testo);
  }
  throw new Error("nello zip manca extension/manifest.json");
}

// Lo zip della versione v, nella Cache Storage dell'estensione: si scarica UNA
// volta (un service worker nuovo non lo riscarica), si controlla e si tiene al
// posto di ogni altro; per lo scambio si rilegge e si ricontrolla.
const aggChiave = (v) => `${AGG_BASE}${aggZipNome()}?v=${encodeURIComponent(v)}`;
async function aggZipControlla(buf, v) {   // "" se va bene, se no perché
  try {
    if (buf.byteLength > AGG_ZIP_MAX) throw new Error("lo zip è troppo grande");
    const man = await aggManifestDelloZip(buf);
    if (String(man.version) !== v) return `Lo zip su GitHub non è ancora la ${v}.`;
    if (man.key !== chrome.runtime.getManifest().key) return "Lo zip scaricato non è di PS Assist (la chiave è diversa).";
    return "";
  } catch (e) { return `Lo zip non è arrivato bene: ${corto(e && e.message || e, 100)}`; }
}
// { pronto: true } c'era già; { pronto: false } scaricato adesso, controllato e tenuto; { why } se no.
async function aggZip(v) {
  if (await caches.open(AGG_CACHE).then((c) => c.match(aggChiave(v))).catch(() => null)) return { pronto: true };
  let buf;
  try {
    const r = await aggPrendi(aggZipNome());
    if (!r.ok) throw new Error(`GitHub non risponde (${r.status})`);
    buf = await r.arrayBuffer();
  } catch (e) { return { why: `Lo zip non è arrivato bene: ${corto(e && e.message || e, 100)}` }; }
  const why = await aggZipControlla(buf, v);
  if (why) return { why };
  try {
    await caches.delete(AGG_CACHE);
    await (await caches.open(AGG_CACHE)).put(aggChiave(v), new Response(buf));
  } catch (e) { return { why: `Lo zip non si tiene su questo PC: ${corto(e && e.message || e, 100)}` }; }   // (se no si riscaricherebbe a ogni giro)
  return { pronto: false };
}
// Per lo scambio: lo zip tenuto, riletto e ricontrollato. { buf }, o { why } (e lo zip va via).
async function aggZipTenuto(v) {
  const r = await caches.open(AGG_CACHE).then((c) => c.match(aggChiave(v))).catch(() => null);
  const buf = r ? await r.arrayBuffer().catch(() => null) : null;
  const why = buf ? await aggZipControlla(buf, v) : "Lo zip scaricato non c'è più.";
  if (why) { await caches.delete(AGG_CACHE).catch(() => {}); return { why }; }
  return { buf };
}
// Andata male: quella versione aspetta sei ore (aggAuto), mai un giro dopo l'altro.
async function aggNo(v, why) {
  await chrome.storage.local.set({ [AGG_PAUSA]: { v, ts: Date.now(), why: corto(why, 200) } }).catch(() => {});
  return { ok: false, why };
}

// Applica la versione nuova, se è il momento. { ok, versione, ricarica } o { ok: false, why }.
async function aggiorna({ avvio = false } = {}) {
  if (await aggOccupato()) return { ok: false, why: AGG_OCCUPATO };
  const rec = (await chrome.storage.local.get("aggiorna")).aggiorna || {};
  const v = String(rec.nuova || "");
  if (!aggPiuNuova(v, aggMia())) return { ok: false, why: "È già l'ultima versione." };
  if (!rec.puo) return { ok: false, why: rec.come || "Non si aggiorna da qui." };
  const z = await aggZip(v);
  if (z.why) return aggNo(v, z.why);
  // Scaricato e controllato, in silenzio. Lo scambio, sulla build completa, solo senza schede del gestionale
  // aperte — o all'avvio del browser, con lo zip già pronto e nel primo minuto (anche nella fila, qui sotto).
  const aspetta = async () => !aggSolaLettura() && !(avvio && z.pronto && Date.now() - aggNato < AGG_AVVIO) && !!(await aggSchede());
  if (await aspetta()) return { ok: false, why: AGG_SCHEDE };
  // l'aiutante, solo adesso che si scambia: che cosa c'è nella cartella
  const i = await aggInstallata();
  if (!i.puo) return aggNo(v, `Non si aggiorna da qui: ${i.come}.`);
  const t = await aggZipTenuto(v);
  if (t.why) return aggNo(v, t.why);
  // L'ultimo controllo e lo scambio dentro la fila degli ordini: nessun ordine
  // parte in mezzo, e la ricarica arriva subito dopo lo scambio.
  return inFilaOrd(async () => {
    if (await aggOccupato()) return { ok: false, why: AGG_OCCUPATO };
    if (await aspetta()) return { ok: false, why: AGG_SCHEDE };   // (una scheda aperta intanto, o il minuto passato)
    const h = await ospite({ t: "aggiorna", versione: v, zip: b64(t.buf) }, AGG_ATTESA);
    if (!h.ok && !h.ignoto) return aggNo(v, `Aggiornamento non riuscito: ${corto(h.why || "l'aiutante ha detto di no", 160)}`);
    await caches.delete(AGG_CACHE).catch(() => {});
    await chrome.storage.local.set({ aggiorna: { ts: 0, nuova: "", puo: false, come: "", fatto: v, quando: Date.now() } });
    // (nessuna risposta: la cartella può essere già quella nuova, e una
    // ricarica è più sicura di un'estensione mezza vecchia e mezza nuova)
    return { ok: true, versione: v, ricarica: true, ...(h.ok ? {} : { incerto: true }) };
  });
}

// Ricaricata (dopo l'aggiornamento, o «Ricarica» in chrome://extensions): nelle schede già
// aperte il pannello è quello vecchio e non parla più con l'estensione. Una
// pillola lo dice; la pagina la ricarica il medico, con un tocco — mai da
// sola: lì può esserci un testo non ancora mandato. E all'aiutante: «sono
// partita» (lo annota nel suo registro).
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason !== "update") return;
  // La build mini non ha pannello: niente pillola «aggiornata» nelle schede
  // (non c'è una finestra da ricaricare, e niente di non mandato). Il resto —
  // la pulizia di `fatto` e l'avviso all'aiutante — vale lo stesso.
  if (!aggSolaLettura()) {
    const cs = chrome.runtime.getManifest().content_scripts?.[0] || {};
    const pagine = cs.matches || [SA4 + "/sa4pso/*"];
    // (non nelle schede dove il pannello non nasce: i PDF delle stampe)
    const senza = (cs.exclude_matches || []).map((m) => m.replace(/\*$/, ""));
    chrome.tabs.query({ url: pagine }).then((schede) => {
      for (const t of schede) if (!t.discarded && !senza.some((x) => String(t.url || "").startsWith(x))) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["aggiornata.js"] }).catch(() => {});
    }).catch(() => {});
  }
  chrome.storage.local.get("aggiorna").then((o) => {
    const { fatto, quando, ...resto } = o.aggiorna || {};
    if (fatto !== aggMia()) return;
    chrome.storage.local.set({ aggiorna: resto }).catch(() => {});
    // La riga della pagina della build mini: «Aggiornato alla versione X · data».
    // Si tiene a parte, così resta anche dopo la pulizia qui sopra.
    chrome.storage.local.set({ aggiornaUltima: { v: aggMia(), quando: quando || Date.now() } }).catch(() => {});
    ospite({ t: "chi", avviata: aggMia() }, 30e3).catch(() => {});
  }).catch(() => {});
});

// --------------------------------------------- da sé, senza mani
// Niente tocco del medico, in nessuna build: all'avvio del browser e a ogni
// giro della sveglia (un quarto d'ora). GitHub al più ogni sei ore (aggControlla);
// una versione nota e non applicata (il PC era occupato) si riprova a ogni giro
// senza rete (lo zip è nella Cache Storage) e senza l'aiutante finché non è il
// momento; andata male, aspetta sei ore. `aggiorna()` tiene OGNI controllo
// (occupato, versione == VERSION.txt, stessa chiave, cartella installata,
// aiutante confermato, host fisso) e l'ultimo dentro la fila degli ordini,
// subito prima dello scambio. Dopo lo scambio la ricarica; nelle schede già
// aperte la pillola «Ricarica la pagina» (mai da sola: lì può esserci un testo
// non mandato).
const AGG_ALLARME = "psassist-aggiorna";
let aggAutoInCorso = false;   // avvio + allarme possono scattare insieme: una sola volta
async function aggAuto(avvio = false) {
  if (aggAutoInCorso) return;
  aggAutoInCorso = true;
  try {
    const rec = await aggControlla().catch(() => null);
    if (!rec) return;
    if (!rec.nuova || !aggPiuNuova(rec.nuova, aggMia())) { await caches.delete(AGG_CACHE).catch(() => {}); return; }   // niente da applicare: niente zip tenuto
    if (!rec.puo) return;   // non si aggiorna da qui (il ⋯ lo dice)
    const p = (await chrome.storage.local.get(AGG_PAUSA))[AGG_PAUSA];
    if (p && p.v === rec.nuova && aggDaPoco(p.ts)) return;   // andata male da poco: sei ore
    const r = await aggiorna({ avvio }).catch(() => null);
    if (r && r.ricarica) setTimeout(() => chrome.runtime.reload(), 400);
  } finally {
    aggAutoInCorso = false;
  }
}
chrome.runtime.onStartup?.addListener(() => { aggAuto(true).catch(() => {}); });
if (chrome.alarms) {
  // (solo se manca: ricrearla a ogni risveglio del service worker la sposterebbe in avanti ogni volta)
  chrome.alarms.get(AGG_ALLARME).then((a) => a || chrome.alarms.create(AGG_ALLARME, { periodInMinutes: AGG_RIPROVA, delayInMinutes: 3 })).catch(() => {});
  chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === AGG_ALLARME) aggAuto().catch(() => {}); });
}
