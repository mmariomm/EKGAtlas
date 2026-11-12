/*
 * PS Assist — l'aggiornamento, dal service worker. Caricato da bg.js
 * (importScripts): vede le sue costanti (SA4, ordLeggi, inFilaOrd, ospite,
 * corto, b64); bg.js legge `aggScambio`.
 *
 * Da sé, in tutte e due le build: all'avvio di Chrome e ogni sei ore (una
 * sveglia, creata solo se manca) si legge VERSION.txt da GitHub — una GET
 * senza cookie e senza dati, l'unica cosa che esce — e, se è più nuova e il PC
 * è libero (aggOccupato), la si applica. Le schede del gestionale aperte non
 * la fermano: dopo, mostrano «Ricarica la pagina». A mano, sulla build
 * completa: un puntino su ⋯ e «Aggiorna app» (aprendo ⋯ si rilegge
 * VERSION.txt). Lo zip si scarica qui (la rete di Chrome, che in ospedale
 * funziona), si controlla (extension/manifest.json, stessa versione di
 * VERSION.txt, stessa chiave), e va all'aiutante di Windows (native
 * messaging), che scambia la cartella %LOCALAPPDATA%\PSAssist\estensione (la
 * vecchia resta in estensione.prima) e rinnova i suoi file; poi
 * chrome.runtime.reload(), dalla fila degli ordini (un ordine premuto intanto:
 * «Non partita», mai sparito con la ricarica). Solo se l'estensione gira
 * da quella cartella (installa.cmd ci mette `installata.json`, e l'aiutante
 * dice che versione c'è dentro); mai con un ordine, una stampa, un giro, un
 * comando dal telefono o una registrazione in corso, e da sé nemmeno col
 * telefono in uso (dopo la ricarica le schede aperte non gli rispondono più,
 * finché il medico non le ricarica). Andata male (lo zip, l'aiutante che dice di no o non
 * risponde): da sé quella versione aspetta sei ore (`aggiornaPausa`), mai un
 * giro dopo l'altro. In storage.local, `aggiorna` = { ts, nuova, puo, come }:
 * lo legge il pannello.
 */
/* global SA4, ordLeggi, inFilaOrd, ospite, corto, b64, motoreDiScheda, stz, regPronto, regAttiva, regStato, regSalvando, REG_INC, pt, ponteValoriTutti, ponteCartelleTutte, ponteTerapieTutte, ponteAccetteTutte */

const AGG_BASE = "https://raw.githubusercontent.com/mmariomm/EKGAtlas/main/ps-app/dist/";
const AGG_GIORNO = 24 * 3600e3;
const AGG_DI_NUOVO = 60e3;               // ⋯ aperto e richiuso: non una lettura a ogni tocco
const AGG_ORE = 6 * 3600e3;              // da sé: ogni quanto si guarda; e la pausa dopo un tentativo andato male
const AGG_PAUSA = "aggiornaPausa";       // storage.local: { v, ts, why } — la versione andata male, e quando
const AGG_ZIP_MAX = 28 * 1024 * 1024;   // in base64 resta sotto i 40 MB che l'aiutante accetta
const AGG_ATTESA = 180e3;                // l'aiutante apre lo zip e scambia la cartella
const AGG_APERTO = new Set(["coda", "avvio", "corre", "stampo", "stampa"]);   // come ORDINE_APERTO nel pannello
const AGG_CARTELLA = "%LOCALAPPDATA%\\PSAssist\\estensione";
// all'avvio di Chrome, se è occupato si riprova per un minuto: il primo di questo service worker, in
// performance.now() (non si sposta con l'orologio del PC, che Windows rimette all'accensione)
const AGG_AVVIO = 60e3;
const AGG_OCCUPATO = "Dopo l'ordine in corso";
const AGG_REGISTRA = "Dopo la registrazione in corso";
const AGG_TELEFONO = "Dopo il comando dall'iPhone in corso";
// da sé, non mentre il medico usa il telefono: dopo la ricarica le schede aperte non gli rispondono più
const AGG_TELEFONO_MS = 10 * 60e3;
let aggScambio = false;                  // lo scambio è deciso: fino alla ricarica nessun ordine nuovo, nessuna stampa nuova (bg.js)
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
const aggPrendi = (nome, altro = {}) => fetch(AGG_BASE + nome, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", ...altro });
// (al più 20 secondi: l'ultima lettura si fa dentro la fila degli ordini, e non la tiene ferma)
async function aggVersione() {
  const r = await aggPrendi("VERSION.txt", { signal: AbortSignal.timeout(20e3) });
  if (!r.ok) throw new Error(`GitHub non risponde (${r.status})`);
  const v = (await r.text()).trim();
  if (!aggVer(v)) throw new Error("VERSION.txt illeggibile");
  return v;
}

// Si può aggiornare da qui? L'estensione deve girare dalla cartella che
// l'aiutante scambia: c'è `installata.json` (lo scrive solo l'installazione)
// e l'aiutante dice che lì dentro c'è questa versione — o già la nuova `v`
// (`gia`: lo scambio finito senza che l'aiutante rispondesse; manca la
// ricarica. host.ps1 copia manifest.json per ultimo: a metà copia «chi» dice
// ancora la vecchia).
async function aggInstallata(v = "") {
  const come = `per aggiornarla con un tocco: stampa\\installa.cmd, poi in chrome://extensions carica l'estensione da ${AGG_CARTELLA}`;
  const marca = await fetch(chrome.runtime.getURL("installata.json")).then((r) => r.ok).catch(() => false);
  if (!marca) return { puo: false, come };
  const c = await ospite({ t: "chi" }, 30e3);
  if (!c.ok) return { puo: false, come: `l'aiutante non risponde (${corto(c.why, 120)}): rilancia stampa\\installa.cmd` };
  const e = String(c.estensione || "");
  if (v && e === v && e !== aggMia()) return { puo: true, come: "", gia: true };
  if (e !== aggMia()) return { puo: false, come };
  return { puo: true, come: "" };
}

async function aggControlla(ora) {
  const prima = (await chrome.storage.local.get("aggiorna")).aggiorna || {};
  if (Date.now() - (prima.ts || 0) < (ora ? AGG_DI_NUOVO : AGG_GIORNO)) return prima;
  let v;
  try { v = await aggVersione(); } catch { return prima; }   // senza rete: resta quello che si sapeva
  const rec = { ts: Date.now(), nuova: "", puo: false, come: "" };
  if (aggPiuNuova(v, aggMia())) {
    const i = await aggInstallata(v);
    Object.assign(rec, { nuova: v, puo: i.puo, come: i.puo ? "" : `C'è la ${v}: ${i.come}.` });
  }
  await chrome.storage.local.set({ aggiorna: rec });
  return rec;
}

// Non è il momento: un ordine (anche dal telefono) in corso o in coda, una
// stampa, un giro in una scheda del medico (il suo appunto, o il presidio di
// chi sta mandando), un foglio per la stazione di stampa; un comando del
// telefono che lavora in una scheda di sottofondo (valori, cartella, terapia,
// accettazione); da sé (`auto`) anche una sessione col telefono aperta o finita
// da meno di 10 minuti; una registrazione in corso, che si sta salvando, o
// quella automatica che aspetta il suo minuto (REG_INC). Nel dubbio — una
// scheda che non risponde in tempo — è occupato. Non contano le schede
// scartate da Chrome o non caricate, quelle dei PDF delle stampe (lì il
// pannello non nasce), e quelle, caricate, dove lo script non entra (la
// pagina d'errore di Chrome, un altro PDF: lì il pannello non c'è; se no
// sarebbe «occupato» per sempre). "" se è libero; se no, perché.
const aggPdf = (t) => (chrome.runtime.getManifest().content_scripts?.[0]?.exclude_matches || []).some((m) => String(t.url || "").startsWith(m.replace(/\*$/, "")));
async function aggOccupato(auto = false) {
  if ((await ordLeggi()).some((x) => AGG_APERTO.has(x.stato)) || motoreDiScheda()) return AGG_OCCUPATO;   // (anche il motore di una scheda)
  if (typeof stz !== "undefined" && (stz.stampa.size || stz.inCorso.size)) return AGG_OCCUPATO;
  try {
    if (typeof pt !== "undefined" && (pt.inVolo.size || (auto && (pt.sessione || pt.attesa || (pt.fine && Date.now() - pt.fine.ts < AGG_TELEFONO_MS))))) return AGG_TELEFONO;
    for (const tutti of [ponteValoriTutti, ponteCartelleTutte, ponteTerapieTutte, ponteAccetteTutte]) if (Object.keys(await tutti()).length) return AGG_TELEFONO;
  } catch { /* il ponte non è partito: niente dal telefono */ }
  try {
    await regPronto;
    if (regAttiva() || (regStato && regStato.stato === "fermo" && !regStato.errore && regSalvando(regStato))
      || (await chrome.storage.session.get(REG_INC))[REG_INC]) return AGG_REGISTRA;
  } catch { /* il registratore non è partito: niente da salvare */ }
  const schede = await chrome.tabs.query({ url: SA4 + "/*" }).catch(() => []);
  for (const t of schede) {
    if (t.discarded || t.status === "unloaded" || aggPdf(t)) continue;
    const r = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: t.id }, injectImmediately: true, args: [10 * 60e3, 25e3],
        func: (corsaTtl, presidioMs) => {
          const leggi = (d, k) => { try { return JSON.parse(d.getItem("psassist:" + k)); } catch { return null; } };
          const c = leggi(sessionStorage, "corsa.v1"), p = leggi(localStorage, "corsa.presidio.v1");
          return !!(c && Date.now() - (c.ts || 0) < corsaTtl) || !!(p && Date.now() - (p.ts || 0) < presidioMs);
        },
      }).catch(() => "no"),
      new Promise((res) => setTimeout(() => res(null), 3000)),
    ]);
    // (a metà di un caricamento lo script può non entrare per un attimo: quella resta occupata)
    if (r === "no" && (await chrome.tabs.get(t.id).catch(() => null))?.status === "complete") continue;
    if (!Array.isArray(r) || !r[0] || r[0].result !== false) return AGG_OCCUPATO;   // (libera solo se lo dice: un «no» detto)
  }
  return "";
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

// Andata male: da sé, quella versione aspetta sei ore (aggAuto).
async function aggNo(v, why) {
  await chrome.storage.local.set({ [AGG_PAUSA]: { v, ts: Date.now(), why: corto(why, 200) } }).catch(() => {});
  return { ok: false, why };
}

// Applica la versione nuova: il tocco su «Aggiorna app», o da sé (aggAuto, `auto`).
// { ok, versione, ricarica } (la ricarica è già chiamata) o { ok: false, why }.
async function aggiorna(auto = false) {
  const occupato = await aggOccupato(auto);
  if (occupato) return { ok: false, why: occupato };
  let v;
  try { v = await aggVersione(); } catch (e) { return { ok: false, why: `Non trovo la versione nuova: ${corto(e && e.message || e, 100)}` }; }
  if (!aggPiuNuova(v, aggMia())) { await chrome.storage.local.set({ aggiorna: { ts: Date.now(), nuova: "", puo: false, come: "" } }); return { ok: false, why: "È già l'ultima versione." }; }
  // che cosa c'è nella cartella: questa versione, o già la nuova (manca solo la ricarica: lo zip non serve)
  const i = await aggInstallata(v);
  if (!i.puo) return { ok: false, why: `Non si aggiorna da qui: ${i.come}.` };
  let buf = null;
  if (!i.gia) {
    let man;
    try {
      const r = await aggPrendi(aggZipNome());
      if (!r.ok) throw new Error(`GitHub non risponde (${r.status})`);
      buf = await r.arrayBuffer();
      if (buf.byteLength > AGG_ZIP_MAX) throw new Error("lo zip è troppo grande");
      man = await aggManifestDelloZip(buf);
    } catch (e) { return aggNo(v, `Lo zip non è arrivato bene: ${corto(e && e.message || e, 100)}`); }
    if (String(man.version) !== v) return aggNo(v, `Lo zip su GitHub non è ancora la ${v}: riprova fra qualche minuto.`);
    if (man.key !== chrome.runtime.getManifest().key) return aggNo(v, "Lo zip scaricato non è di PS Assist (la chiave è diversa).");
  }
  // L'ultimo controllo, lo scambio e la ricarica dentro la fila degli ordini:
  // nessun ordine parte in mezzo.
  return inFilaOrd(async () => {
    const ancora = await aggOccupato(auto);
    if (ancora) return { ok: false, why: ancora, scaricato: !i.gia };   // (lo zip c'era: all'avvio non si riscarica)
    // Subito prima dello scambio, VERSION.txt dice ancora v? Se no (ritirata, o c'è già una più nuova)
    // niente scambio, e quella di adesso si prova al giro dopo. GitHub che non risponde: la pausa.
    if (!i.gia) {
      let ora;
      try { ora = await aggVersione(); } catch (e) { return aggNo(v, `Prima dello scambio: ${corto(e && e.message || e, 100)}`); }
      if (ora !== v) {
        const nuova = aggPiuNuova(ora, aggMia()) ? ora : "";
        await chrome.storage.local.set({ aggiorna: { ts: Date.now(), nuova, puo: !!nuova, come: "" } });
        return { ok: false, why: `Su GitHub adesso c'è la ${ora}, non la ${v}` };
      }
    }
    // Da qui alla ricarica nessun ordine nuovo parte (ordineNuovo, bg.js, dice «Non partita»): la
    // ricarica svuota storage.session, e un ordine scritto lì sparirebbe senza dirlo.
    aggScambio = true;
    let fatto = false;
    try {
      if (!i.gia) {
        const h = await ospite({ t: "aggiorna", versione: v, zip: b64(buf) }, AGG_ATTESA);
        // Nessuna risposta: l'aiutante può essere ancora a metà della copia, e la
        // ricarica caricherebbe una cartella mezza vecchia e mezza nuova. Niente
        // ricarica: la pausa, poi si chiede all'aiutante che cosa c'è nella
        // cartella (qui sopra, `gia`).
        if (h.ignoto) return aggNo(v, `L'aiutante non ha risposto: ${corto(h.why || "", 120)}`);
        if (!h.ok) return aggNo(v, `Aggiornamento non riuscito: ${corto(h.why || "l'aiutante ha detto di no", 160)}`);
      }
      await chrome.storage.local.remove(AGG_PAUSA).catch(() => {});
      await chrome.storage.local.set({ aggiorna: { ts: 0, nuova: "", puo: false, come: "", fatto: v, quando: Date.now() } }).catch(() => {});
      fatto = true;
      setTimeout(() => chrome.runtime.reload(), 400);
      return { ok: true, versione: v, ricarica: true };
    } finally {
      if (!fatto) aggScambio = false;   // (andata male: gli ordini ripartono, quello in fila compreso)
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || (msg.t !== "aggiornaControlla" && msg.t !== "aggiorna")) return;
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg.t === "aggiornaControlla") {
    aggControlla(!!msg.ora).then((r) => reply({ ok: true, aggiorna: r }), () => reply({ ok: false }));
    return true;
  }
  aggiorna().catch((e) => ({ ok: false, why: `Aggiornamento non riuscito: ${corto(e && e.message || e, 120)}` })).then(reply);
  return true;
});

// Ricaricata (dopo l'aggiornamento, o «Ricarica estensione»): nelle schede già
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
// Tutte e due le build: all'avvio di Chrome e a ogni giro della sveglia (sei
// ore), se c'è una versione nuova, si può aggiornare da qui e quella versione
// non è andata male da poco, `aggiorna()` — con OGNI controllo (occupato,
// versione == VERSION.txt, stessa chiave, cartella installata, aiutante
// confermato, host fisso) e l'ultimo dentro la fila degli ordini. Occupato:
// si riprova al giro dopo (all'avvio di Chrome, ogni 10 secondi per il primo
// minuto: le schede ripristinate stanno ancora caricando e non rispondono).
// Dopo lo scambio la ricarica; nelle schede già aperte la pillola «Ricarica
// la pagina».
const AGG_ALLARME = "psassist-aggiorna";
let aggAutoInCorso = false;   // avvio + sveglia possono scattare insieme: una sola volta
async function aggAuto(avvio = false) {
  if (aggAutoInCorso) return null;
  aggAutoInCorso = true;
  try {
    const rec = await aggControlla(true).catch(() => null);
    if (!rec || !rec.nuova || !rec.puo) return null;   // niente di nuovo, o non si aggiorna da qui (il ⋯ lo dice)
    const p = (await chrome.storage.local.get(AGG_PAUSA))[AGG_PAUSA];
    if (p && p.v === rec.nuova && aggDaPoco(p.ts)) return null;   // andata male da poco: sei ore
    let r = await aggiorna(true);
    while (avvio && r && r.why === AGG_OCCUPATO && !r.scaricato && performance.now() < AGG_AVVIO - 10e3) {
      await new Promise((res) => setTimeout(res, 10e3));
      r = await aggiorna(true);
    }
    return r;
  } finally {
    aggAutoInCorso = false;
  }
}
chrome.runtime.onStartup?.addListener(() => { aggAuto(true).catch(() => {}); });
if (chrome.alarms) {
  // (solo se manca: rifatta a ogni risveglio del service worker ripartirebbe da «fra 3 minuti», e non suonerebbe mai)
  chrome.alarms.get(AGG_ALLARME).then((a) => a || chrome.alarms.create(AGG_ALLARME, { periodInMinutes: AGG_ORE / 60e3, delayInMinutes: 3 })).catch(() => {});
  chrome.alarms.clear("psassist-aggiorna-mini").catch(() => {});   // (quella della 3.85.2, solo della build mini)
  chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === AGG_ALLARME) aggAuto().catch(() => {}); });
}
