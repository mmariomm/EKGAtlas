/*
 * PS Assist — la CASSA delle chiavi, nel service worker (importato da bg.js).
 *
 * Le chiavi delle associazioni (il ponte verso l'iPhone, la stazione di
 * stampa: K, e la chiave privata dell'offerta di una stazione) non stanno in
 * chrome.storage — storage.local lo leggono anche gli script nelle pagine, e
 * storage.session è aperto a loro (bg.js, setAccessLevel) — ma nell'IndexedDB
 * del service worker, che è dell'origine dell'estensione: nessuno script di
 * una pagina ci arriva. E ci stanno come CryptoKey NON ESTRAIBILI dove
 * WebCrypto lo permette: si usano (HKDF, ECDH), i loro byte non escono più —
 * nemmeno da qui, nemmeno dalla console del service worker.
 *
 * In storage.local resta solo quello che non è segreto (quando, chi, il nome,
 * il numero della stanza), come prima.
 *
 * Senza IndexedDB (i test in una vm) la cassa è una mappa in memoria
 * (`PSA_CASSA`, se il test la dà, così due service worker finti la
 * condividono come il disco).
 */
/* exported cassaLeggi, cassaScrivi, cassaTogli */

const CASSA_DB = "psassist-cassa", CASSA_TAB = "chiavi";
let cassaAperta = null;
function cassaDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!cassaAperta) {
    cassaAperta = new Promise((ok, no) => {
      const r = indexedDB.open(CASSA_DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(CASSA_TAB)) r.result.createObjectStore(CASSA_TAB); };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { try { db.close(); } catch { /* già chiuso */ } cassaAperta = null; };
        ok(db);
      };
      r.onerror = () => no(r.error);
      r.onblocked = () => no(new Error("cassa bloccata"));
    }).catch((e) => { cassaAperta = null; throw e; });
  }
  return cassaAperta;
}
const cassaMemoria = () => (globalThis.PSA_CASSA && typeof globalThis.PSA_CASSA.get === "function" ? globalThis.PSA_CASSA : (globalThis.PSA_CASSA = new Map()));
async function cassaFai(modo, fn) {
  const db = await cassaDb();
  if (!db) return fn(null);
  return new Promise((ok, no) => {
    const t = db.transaction(CASSA_TAB, modo);
    let r;
    try { r = fn(t.objectStore(CASSA_TAB)); } catch (e) { no(e); return; }
    t.oncomplete = () => ok(r && "result" in r ? r.result : undefined);
    t.onerror = () => no(t.error);
    t.onabort = () => no(t.error || new Error("cassa: transazione annullata"));
  });
}
async function cassaLeggi(nome) {
  const db = await cassaDb();
  if (!db) { const v = cassaMemoria().get(nome); return v === undefined ? null : v; }
  const v = await cassaFai("readonly", (s) => s.get(nome));
  return v === undefined ? null : v;
}
async function cassaScrivi(nome, valore) {
  const db = await cassaDb();
  if (!db) { cassaMemoria().set(nome, valore); return; }
  await cassaFai("readwrite", (s) => { s.put(valore, nome); return null; });
}
async function cassaTogli(nome) {
  const db = await cassaDb();
  if (!db) { cassaMemoria().delete(nome); return; }
  await cassaFai("readwrite", (s) => { s.delete(nome); return null; });
}
