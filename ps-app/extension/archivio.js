/*
 * archivio.js — i registri «per numero» del service worker, scritti una volta sola.
 *
 * Caricato con importScripts (bg.js) prima di chi lo usa: ponte-sw.js e
 * stazione-sw.js. È un'espressione sola, senza const/let globali: caricato due
 * volte (lo chiedono il ponte e la stazione) non si rompe e non si rifà.
 *
 * Un REGISTRO è una chiave di chrome.storage (local o session) che tiene un
 * oggetto { numero: { …, ts } }: le scritture del telefono e dei fogli fatte una
 * volta sola (il numero `rq`), con la loro fase («corso», «inviato», «fatto») e
 * l'esito. Lo stesso giro c'era, copiato a mano, in ogni posto che ne aveva
 * bisogno; qui una volta:
 *   - una FILA per chiave: le scritture una dietro l'altra (leggi, cambia,
 *     scrivi), mai due a metà sopra la stessa chiave;
 *   - `scrivi(rq, x)`: fonde x nel record che c'è, con `ts` di adesso; poi tiene
 *     lui (sempre: anche con l'orologio tornato indietro) e, degli altri più
 *     giovani di `ms`, gli `n − 1` più recenti. Se la
 *     scrittura non riesce, la promessa la rifiuta (chi annota «inviato» PRIMA
 *     di fare non deve credere di averlo annotato), e la fila va avanti;
 *   - `tutti()` / `leggi(rq)`: una lettura com'è adesso (una mappa senza
 *     prototipo: «__proto__» è un numero come gli altri; fuori dalla fila,
 *     come prima). Un errore di lettura rifiuta: chi legge prima di fare, non fa;
 *   - `cambia(fn)`: un giro a mano nella stessa fila (fn torna vero → si scrive).
 *     fn è SINCRONA e non rientra nella fila (scrivi/cambia della stessa
 *     chiave): aspetterebbe sé stessa per sempre. Chi lo fa ha un errore
 *     subito, e niente scritto; una fn che torna una promessa, lo stesso;
 *   - `gia(rq)` / `segna(rq, x)`: la forma corta del «già fatto?». Nella fila,
 *     e CHIUSE sull'errore: `gia` con la memoria rotta dice «sì, già» (non si
 *     fa), `segna` torna true SOLO se il numero era nuovo ed è scritto davvero
 *     (già visto, o memoria rotta: false — non si fa). Due `segna` dello stesso
 *     numero: uno solo torna true. Un record scaduto conta finché la scrittura
 *     dopo non lo toglie (il lato sicuro).
 *
 * E i NOMI delle chiavi che un file scrive e un altro legge (CHIAVE): chi le
 * legge da un altro file usa il nome, non la stringa ricopiata.
 */
globalThis.PsaArchivio = globalThis.PsaArchivio || (function () {
  // Le chiavi lette fuori dal file che le scrive. (area: dove stanno; chi: chi le scrive)
  const CHIAVE = Object.freeze({
    stazioneCoppia: "stazione.coppia",   // local · stazione-sw.js (STA.coppia) — lette da ponte-sw.js, bg.js, etichetta-sw.js, registro-sw.js
    stazionePubblico: "stazione",        // session · stazione-sw.js (STA.pubblico) — letta da ponte-sw.js, stampanti.js
    stampa: "stampa",                    // local · stampanti.js — le scelte di stampa, lette da bg.js, ponte-sw.js, etichetta-sw.js
    aggiornaUltima: "aggiornaUltima",    // local · aggiorna.js — letta da ponte-sw.js, ponte.js
    ponteOrdini: "ponte.ordini",         // session · ponte-sw.js — ripulita da bg.js
    ponteValori: "ponte.valori",         // session · ponte-sw.js — letta da bg.js
    ordini: "ordini",                    // session · bg.js (ORD) — letta da registra.js, ponte-sw.js (onChanged)
  });
  const AREE = new Set(["local", "session"]);
  const FILE = new Map();   // area+chiave → la coda delle scritture (in memoria: muore col service worker, la chiave no)
  const DENTRO = new Set(); // area+chiave → la funzione di un `cambia` sta girando adesso (per chi rientra nella fila)

  function registro(o) {
    const { area, chiave, n, ms } = o || {};
    const ora = (o && o.ora) || (() => Date.now());
    if (!AREE.has(area) || typeof chiave !== "string" || !chiave || !Number.isInteger(n) || n < 1 || !(ms > 0)) {
      throw new Error("archivio: un registro vuole area (local|session), chiave, n e ms");
    }
    const deposito = () => chrome.storage[area];
    // (la fila è della CHIAVE, non di chi la chiede: due registri sulla stessa chiave fanno la stessa fila)
    const k = area + " " + chiave;
    // (chi rientra nella fila dalla funzione di un `cambia` aspetterebbe sé stesso per sempre: errore subito, si chiude)
    const rientro = () => new Error(`archivio: ${k} — un cambia rientra nella sua stessa fila (la fermerebbe per sempre): niente fatto`);
    const inFila = (fn) => {
      if (DENTRO.has(k)) throw rientro();
      const p = (FILE.get(k) || Promise.resolve()).then(fn); FILE.set(k, p.catch(() => {})); return p;
    };
    // (senza prototipo: «__proto__» è un numero come gli altri — passa /^[\w-]{8,40}$/ — mai il prototipo della mappa)
    const tutti = async () => Object.assign(Object.create(null), (await deposito().get(chiave))[chiave]);
    // (i più giovani di `ms`, e di quelli gli `n` più recenti: lo stesso giro dei registri del ponte — ma quello
    // appena scritto resta sempre: con l'orologio tornato indietro sarebbe l'ultimo, e prende il posto dell'n-esimo)
    const tieni = (m, rq) => {
      const l = Object.entries(m).filter(([, y]) => ora() - y.ts < ms).sort((a, b) => b[1].ts - a[1].ts);
      const i = l.findIndex(([k]) => k === rq);
      if (i >= n) l.splice(n - 1, 0, l.splice(i, 1)[0]);
      return Object.fromEntries(l.slice(0, n));
    };
    async function scriviOra(rq, x) {
      const m = await tutti();
      m[rq] = { ...(m[rq] || {}), ...x, ts: ora() };
      await deposito().set({ [chiave]: tieni(m, rq) });
    }
    return {
      chiave, area,
      tutti,
      leggi: async (rq) => (await tutti())[rq],
      scrivi: (rq, x) => inFila(() => scriviOra(rq, x)),
      // (fn sincrona: dentro la fila non si aspetta niente — una che aspetta potrebbe aspettare la sua fila)
      cambia: (fn) => inFila(async () => {
        const m = await tutti();
        let si;
        DENTRO.add(k);
        try { si = fn(m); } finally { DENTRO.delete(k); }
        if (si && typeof si.then === "function") { si.then(null, () => {}); throw new Error(`archivio: ${k} — cambia vuole una funzione sincrona (una che aspetta, se rientra nella sua fila, la ferma per sempre): niente fatto`); }
        if (si) await deposito().set({ [chiave]: m });
      }),
      gia: (rq) => inFila(async () => !!(await tutti())[rq]).catch(() => true),
      segna: (rq, x = {}) => inFila(async () => {
        if ((await tutti())[rq]) return false;
        await scriviOra(rq, x);
        return true;
      }).catch(() => false),
    };
  }

  return Object.freeze({ CHIAVE, registro });
})();
