/*
 * PS Assist — il registratore: il suo database (IndexedDB «psassist-registra»,
 * nell'origine dell'estensione, su questo PC). Lo stesso file per il service
 * worker (registra.js) e per il documento fuori schermo che anonimizza e salva
 * (registra-esporta.html), così la versione e le tabelle sono una sola cosa.
 *   grezzi   la registrazione a mano, com'è vista (pagine, flusso, PDF):
 *            si cancella appena salvato lo zip
 *   scorre   la registrazione automatica: gli ultimi 10 minuti, potati di
 *            continuo (indice «ts»), cancellati all'avvio del browser
 *   zip      gli zip salvati, anonimizzati: i dati (nome, ora, misura, motivo,
 *            controllo, riepilogo) — leggere l'elenco non legge i byte
 *   zipdati  i byte di ogni zip, sotto lo stesso id
 */
(function (g) {
  const NOME = "psassist-registra", VER = 2;
  let p = null;
  const apri = () => (p = p || new Promise((ok, no) => {
    const r = indexedDB.open(NOME, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("grezzi")) db.createObjectStore("grezzi", { autoIncrement: true });
      if (!db.objectStoreNames.contains("scorre")) db.createObjectStore("scorre", { autoIncrement: true }).createIndex("ts", "ts");
      if (!db.objectStoreNames.contains("zip")) db.createObjectStore("zip", { keyPath: "id" });
      if (!db.objectStoreNames.contains("zipdati")) db.createObjectStore("zipdati");
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); p = null; };
      db.onclose = () => { p = null; };
      ok(db);
    };
    r.onerror = () => { p = null; no(r.error); };
    r.onblocked = () => { p = null; no(new Error("database del registratore occupato")); };
  }));
  // Una transazione su una o più tabelle: fn(tabelle…) può restituire una
  // richiesta, il cui risultato arriva quando la transazione è finita.
  async function tx(nomi, modo, fn) {
    const db = await apri();
    const l = [].concat(nomi);
    return new Promise((ok, no) => {
      const t = db.transaction(l, modo);
      const out = fn(...l.map((n) => t.objectStore(n)));
      t.oncomplete = () => ok(out && typeof out === "object" && "result" in out ? out.result : out);
      t.onerror = t.onabort = () => no(t.error || new Error("transazione annullata"));
    });
  }
  g.RegistraDb = { apri, tx, NOME, VER };
})(globalThis);
