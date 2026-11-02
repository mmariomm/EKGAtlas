/*
 * PS Assist — «Aggiorna app» (⋯), dal service worker. Caricato da bg.js
 * (importScripts): vede le sue costanti (SA4, ordLeggi, inFilaOrd, ospite,
 * corto, b64).
 *
 * Una volta al giorno, e ogni volta che si apre ⋯, si legge VERSION.txt da
 * GitHub: una GET senza cookie e senza dati, l'unica cosa che esce. Più nuova
 * di questa: un puntino su ⋯ e «Aggiorna app». Un tocco: lo zip si scarica
 * qui (la rete di Chrome, che in ospedale funziona), si controlla
 * (extension/manifest.json, stessa versione di VERSION.txt, stessa chiave), e
 * va all'aiutante di Windows (native messaging), che scambia la cartella
 * %LOCALAPPDATA%\PSAssist\estensione (la vecchia resta in estensione.prima) e
 * rinnova i suoi file; poi chrome.runtime.reload(). Solo se l'estensione gira
 * da quella cartella (installa.cmd ci mette `installata.json`, e l'aiutante
 * dice che versione c'è dentro); mai con un ordine, una stampa o un giro in
 * corso. In storage.local, `aggiorna` = { ts, nuova, puo, come }: lo legge il
 * pannello.
 */
/* global SA4, ordLeggi, inFilaOrd, ospite, corto, b64 */

const AGG_BASE = "https://raw.githubusercontent.com/mmariomm/EKGAtlas/main/ps-app/dist/";
const AGG_GIORNO = 24 * 3600e3;
const AGG_DI_NUOVO = 60e3;               // ⋯ aperto e richiuso: non una lettura a ogni tocco
const AGG_ZIP_MAX = 28 * 1024 * 1024;   // in base64 resta sotto i 40 MB che l'aiutante accetta
const AGG_ATTESA = 180e3;                // l'aiutante apre lo zip e scambia la cartella
const AGG_APERTO = new Set(["coda", "avvio", "corre", "stampo", "stampa"]);   // come ORDINE_APERTO nel pannello
const AGG_CARTELLA = "%LOCALAPPDATA%\\PSAssist\\estensione";
const AGG_OCCUPATO = "Dopo l'ordine in corso";
const aggMia = () => chrome.runtime.getManifest().version;
const aggVer = (v) => /^\d+(\.\d+){1,3}$/.test(String(v || "").trim());
function aggPiuNuova(a, b) {
  if (!aggVer(a)) return false;
  const x = String(a).trim().split(".").map(Number), y = String(b).trim().split(".").map(Number);
  for (let i = 0; i < 4; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}
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

async function aggControlla(ora) {
  const prima = (await chrome.storage.local.get("aggiorna")).aggiorna || {};
  if (Date.now() - (prima.ts || 0) < (ora ? AGG_DI_NUOVO : AGG_GIORNO)) return prima;
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

// Un ordine, una stampa, un ordine dal telefono, o un giro che gira in una
// scheda del medico (il suo appunto, o il presidio di chi sta mandando).
async function aggOccupato() {
  if ((await ordLeggi()).some((x) => AGG_APERTO.has(x.stato))) return true;
  const schede = await chrome.tabs.query({ url: SA4 + "/*" }).catch(() => []);
  for (const t of schede) {
    if (t.discarded) continue;
    const r = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: t.id }, injectImmediately: true, args: [10 * 60e3, 25e3],
        func: (corsaTtl, presidioMs) => {
          const leggi = (d, k) => { try { return JSON.parse(d.getItem("psassist:" + k)); } catch { return null; } };
          const c = leggi(sessionStorage, "corsa.v1"), p = leggi(localStorage, "corsa.presidio.v1");
          return !!(c && Date.now() - (c.ts || 0) < corsaTtl) || !!(p && Date.now() - (p.ts || 0) < presidioMs);
        },
      }).catch(() => null),
      new Promise((res) => setTimeout(() => res(null), 3000)),
    ]);
    if (r && r[0] && r[0].result) return true;
  }
  return false;
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

// Il tocco su «Aggiorna app». { ok, versione, ricarica } o { ok: false, why }.
async function aggiorna() {
  if (await aggOccupato()) return { ok: false, why: AGG_OCCUPATO };
  let v;
  try { v = await aggVersione(); } catch (e) { return { ok: false, why: `Non trovo la versione nuova: ${corto(e && e.message || e, 100)}` }; }
  if (!aggPiuNuova(v, aggMia())) { await chrome.storage.local.set({ aggiorna: { ts: Date.now(), nuova: "", puo: false, come: "" } }); return { ok: false, why: "È già l'ultima versione." }; }
  const i = await aggInstallata();
  if (!i.puo) return { ok: false, why: `Non si aggiorna da qui: ${i.come}.` };
  let buf, man;
  try {
    const r = await aggPrendi("ps-assist-latest.zip");
    if (!r.ok) throw new Error(`GitHub non risponde (${r.status})`);
    buf = await r.arrayBuffer();
    if (buf.byteLength > AGG_ZIP_MAX) throw new Error("lo zip è troppo grande");
    man = await aggManifestDelloZip(buf);
  } catch (e) { return { ok: false, why: `Lo zip non è arrivato bene: ${corto(e && e.message || e, 100)}` }; }
  if (String(man.version) !== v) return { ok: false, why: `Lo zip su GitHub non è ancora la ${v}: riprova fra qualche minuto.` };
  if (man.key !== chrome.runtime.getManifest().key) return { ok: false, why: "Lo zip scaricato non è di PS Assist (la chiave è diversa)." };
  // L'ultimo controllo e lo scambio dentro la fila degli ordini: nessun ordine
  // parte in mezzo, e la ricarica arriva subito dopo lo scambio.
  return inFilaOrd(async () => {
    if (await aggOccupato()) return { ok: false, why: AGG_OCCUPATO };
    const h = await ospite({ t: "aggiorna", versione: v, zip: b64(buf) }, AGG_ATTESA);
    if (!h.ok && !h.ignoto) return { ok: false, why: `Aggiornamento non riuscito: ${corto(h.why || "l'aiutante ha detto di no", 160)}` };
    await chrome.storage.local.set({ aggiorna: { ts: 0, nuova: "", puo: false, come: "", fatto: v } });
    // (nessuna risposta: la cartella può essere già quella nuova, e una
    // ricarica è più sicura di un'estensione mezza vecchia e mezza nuova)
    return { ok: true, versione: v, ricarica: true, ...(h.ok ? {} : { incerto: true }) };
  });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || (msg.t !== "aggiornaControlla" && msg.t !== "aggiorna")) return;
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg.t === "aggiornaControlla") {
    aggControlla(!!msg.ora).then((r) => reply({ ok: true, aggiorna: r }), () => reply({ ok: false }));
    return true;
  }
  aggiorna().catch((e) => ({ ok: false, why: `Aggiornamento non riuscito: ${corto(e && e.message || e, 120)}` })).then((r) => {
    reply(r);
    if (r.ricarica) setTimeout(() => chrome.runtime.reload(), 400);
  });
  return true;
});

// Ricaricata (dopo «Aggiorna app», o «Ricarica estensione»): nelle schede già
// aperte il pannello è quello vecchio e non parla più con l'estensione. Una
// pillola lo dice; la pagina la ricarica il medico, con un tocco — mai da
// sola: lì può esserci un testo non ancora mandato. E all'aiutante: «sono
// partita» (lo annota nel suo registro).
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason !== "update") return;
  const pagine = chrome.runtime.getManifest().content_scripts?.[0]?.matches || [SA4 + "/sa4pso/*"];
  chrome.tabs.query({ url: pagine }).then((schede) => {
    for (const t of schede) if (!t.discarded) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["aggiornata.js"] }).catch(() => {});
  }).catch(() => {});
  chrome.storage.local.get("aggiorna").then((o) => {
    const { fatto, ...resto } = o.aggiorna || {};
    if (fatto !== aggMia()) return;
    chrome.storage.local.set({ aggiorna: resto }).catch(() => {});
    ospite({ t: "chi", avviata: aggMia() }, 30e3).catch(() => {});
  }).catch(() => {});
});
