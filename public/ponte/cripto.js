/*
 * PS Assist · Ponte — la cifratura, uguale sui due lati.
 *
 * Lo stesso file gira sull'iPhone (questa cartella, servita dal sito) e
 * nell'estensione (copiato in ps-app/extension/ponte-cripto.js da
 * `npm run build`, e un test controlla che siano identici). Solo WebCrypto:
 * nessuna libreria.
 *
 * La chiave dell'associazione K (32 byte casuali) arriva al telefono nel
 * frammento del QR (#k=…): il frammento non viaggia mai verso un server. Da K,
 * con HKDF-SHA256:
 *   - il numero della stanza sul ponte (16 byte, in esadecimale): il ponte lo
 *     vede, ma da lì non si risale a K;
 *   - due chiavi di «saluto», una per verso, per scambiarsi due numeri
 *     casuali (uno a testa) all'inizio di ogni sessione;
 *   - da K e da quei due numeri, le due chiavi AES-256-GCM della sessione,
 *     una per verso: ogni sessione ha chiavi sue.
 * Ogni messaggio: [versione][tipo][numero d'ordine su 8 byte][IV 12 byte]
 * [testo cifrato]. I primi 10 byte sono dati autenticati (AAD): il tipo e il
 * numero d'ordine non si cambiano senza che la decifratura fallisca.
 * Il numero d'ordine cresce sempre: un messaggio ripetuto o arrivato dopo uno
 * più nuovo si scarta — deciso DOPO averlo decifrato, mai dalla testata da
 * sola (chi non ha le chiavi non può far scartare niente).
 * Da K, anche un codice di sei cifre (`codice`): si legge accanto al QR sul
 * PC e sul telefono, ed è lo stesso solo se la chiave è la stessa.
 */
(function () {
  "use strict";
  const subtle = globalThis.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8", { fatal: true });

  const VERSIONE = 1;
  const TIPO = { SALUTO_TEL: 1, SALUTO_PC: 2, DATI_TEL: 3, DATI_PC: 4 };
  const TESTA = 10;   // versione, tipo, numero d'ordine
  const IV = 12;
  const SALE = enc.encode("ps-ponte/1");

  const casuale = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

  function b64u(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function daB64u(t) {
    if (typeof t !== "string" || !/^[A-Za-z0-9_-]*$/.test(t)) throw new Error("base64url non valido");
    const s = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
  const esa = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  // K può essere i 32 byte (il QR, i test) o una CryptoKey HKDF non estraibile (quella che si tiene:
  // IndexedDB, chiaveDa): da lì si ricava tutto, e i suoi byte non escono più.
  const eChiave = (k) => !!k && typeof k === "object" && !!k.algorithm && k.algorithm.name === "HKDF" && k.type === "secret";
  async function hkdf(k, sale, info, n) {
    const base = eChiave(k) ? k : await subtle.importKey("raw", k, "HKDF", false, ["deriveBits"]);
    const bits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sale, info: enc.encode(info) }, base, n * 8);
    return new Uint8Array(bits);
  }
  // I 32 byte di K → la CryptoKey da tenere: non estraibile, solo per ricavare (HKDF).
  async function chiaveDa(raw) {
    if (eChiave(raw)) return raw;
    if (!raw || raw.length !== 32) throw new Error("chiave dell'associazione non valida");
    return subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
  }
  const aes = (raw) => subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const unisci = (...parti) => {
    const out = new Uint8Array(parti.reduce((n, p) => n + p.length, 0));
    let i = 0;
    for (const p of parti) { out.set(p, i); i += p.length; }
    return out;
  };

  // Quello che si ricava da K una volta per tutte.
  async function chiaviCoppia(k) {
    if (!eChiave(k) && (!(k instanceof Uint8Array) || k.length !== 32)) throw new Error("chiave dell'associazione non valida");
    return {
      stanza: esa(await hkdf(k, SALE, "stanza", 16)),
      salutoTel: await aes(await hkdf(k, SALE, "saluto tel>pc", 32)),
      salutoPc: await aes(await hkdf(k, SALE, "saluto pc>tel", 32)),
    };
  }
  // Le chiavi di UNA sessione: K e i due numeri casuali, uno del telefono e uno del PC.
  async function chiaviSessione(k, nTel, nPc) {
    if (nTel.length !== 16 || nPc.length !== 16) throw new Error("numeri di sessione non validi");
    const sale = unisci(SALE, nTel, nPc);
    return {
      tel: await aes(await hkdf(k, sale, "sessione tel>pc", 32)),
      pc: await aes(await hkdf(k, sale, "sessione pc>tel", 32)),
    };
  }

  function testata(tipo, seq) {
    if (!Number.isSafeInteger(seq) || seq < 0) throw new Error("numero d'ordine non valido");
    const t = new Uint8Array(TESTA);
    const v = new DataView(t.buffer);
    v.setUint8(0, VERSIONE);
    v.setUint8(1, tipo);
    v.setUint32(2, Math.floor(seq / 2 ** 32));
    v.setUint32(6, seq >>> 0);
    return t;
  }
  function leggiTestata(frame) {
    const b = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    if (b.length < TESTA + IV + 16) return null;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { versione: v.getUint8(0), tipo: v.getUint8(1), seq: v.getUint32(2) * 2 ** 32 + v.getUint32(6) };
  }

  async function sigilla(chiave, tipo, seq, oggetto) {
    const t = testata(tipo, seq);
    const iv = casuale(IV);
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: t }, chiave, enc.encode(JSON.stringify(oggetto))));
    return unisci(t, iv, ct);
  }
  // Un errore con un codice: chi riceve sa perché il messaggio è scartato.
  const sbaglio = (codice) => Object.assign(new Error("messaggio scartato: " + codice), { codice });
  async function apri(chiave, frame, tipoAtteso) {
    const b = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    const h = leggiTestata(b);
    if (!h || h.versione !== VERSIONE) throw sbaglio("versione");
    if (h.tipo !== tipoAtteso) throw sbaglio("tipo");
    let chiaro;
    try {
      chiaro = await subtle.decrypt({ name: "AES-GCM", iv: b.subarray(TESTA, TESTA + IV), additionalData: b.subarray(0, TESTA) },
        chiave, b.subarray(TESTA + IV));
    } catch { throw sbaglio("chiave"); }
    try { return { seq: h.seq, dati: JSON.parse(dec.decode(chiaro)) }; }
    catch { throw sbaglio("contenuto"); }
  }

  // Un verso di una sessione: cifra con numeri d'ordine che crescono, e
  // decifra solo numeri più alti dell'ultimo accettato. Le operazioni passano
  // una alla volta: due cifrature in parallelo potrebbero uscire in ordine
  // inverso, e l'altro lato scarterebbe la prima come «ripetuta».
  class Canale {
    constructor(chiaveOut, tipoOut, chiaveIn, tipoIn) {
      Object.assign(this, { chiaveOut, tipoOut, chiaveIn, tipoIn, seqOut: 0, seqIn: 0 });
      this.fila = Promise.resolve();
    }
    _inFila(fn) { const p = this.fila.then(fn); this.fila = p.catch(() => {}); return p; }
    cifra(oggetto) { return this._inFila(() => sigilla(this.chiaveOut, this.tipoOut, ++this.seqOut, oggetto)); }
    decifra(frame) {
      return this._inFila(async () => {
        const r = await apri(this.chiaveIn, frame, this.tipoIn);
        if (r.seq <= this.seqIn) throw sbaglio("ripetuto");
        this.seqIn = r.seq;
        return r.dati;
      });
    }
  }
  // Il canale visto dal telefono e visto dal PC: stesse chiavi, versi opposti.
  const canaleTel = (s) => new Canale(s.tel, TIPO.DATI_TEL, s.pc, TIPO.DATI_PC);
  const canalePc = (s) => new Canale(s.pc, TIPO.DATI_PC, s.tel, TIPO.DATI_TEL);

  // Il frammento del QR: «k=<32 byte base64url>&scade=<millisecondi>».
  function leggiFrammento(frammento) {
    const p = new URLSearchParams(String(frammento || "").replace(/^#/, ""));
    try {
      const k = daB64u(p.get("k") || "");
      const scade = Number(p.get("scade"));
      if (k.length !== 32 || !Number.isSafeInteger(scade) || scade <= 0) return null;
      return { k, scade };
    } catch { return null; }
  }
  const frammento = (k, scade) => `k=${b64u(k)}&scade=${scade}`;
  // Il codice dell'associazione: sei cifre da K, «482 913».
  async function codice(k) {
    const b = await hkdf(k, SALE, "codice", 4);
    const t = String(new DataView(b.buffer).getUint32(0) % 1e6).padStart(6, "0");
    return `${t.slice(0, 3)} ${t.slice(3)}`;
  }

  // L'entrata nella stanza del ripetitore (3.87): per ogni ruolo una chiave d'entrata, da K (32 byte,
  // base64url). Il ripetitore la tiene e manda una sfida; il client risponde con la prova (HMAC-SHA256,
  // con l'etichetta di worker/ponte-logica.js). Vale solo per entrare nella stanza: non apre niente.
  const RUOLI = ["pc", "tel", "medico", "stazione"];
  async function chiaviEntra(k) {
    const out = {};
    for (const r of RUOLI) out[r] = b64u(await hkdf(k, SALE, "entra " + r, 32));
    return out;
  }
  async function provaEntra(chiave, sfida) {
    const h = await subtle.importKey("raw", daB64u(chiave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return b64u(new Uint8Array(await subtle.sign("HMAC", h, enc.encode("ps-ponte/entra|" + String(sfida)))));
  }

  // La chiave che rinnova K (3.87): dentro la prima sessione cifrata, telefono e PC si scambiano le
  // chiavi pubbliche di un ECDH (P-256) — il QR non le ha — e da lì, e da K, nasce la chiave nuova.
  // Chi ha fotografato il QR (o copiato K dopo) vede quella sessione, ma non il segreto dell'ECDH.
  async function coppiaEcdh() {
    const e = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    return { privata: e.privateKey, pub: new Uint8Array(await subtle.exportKey("raw", e.publicKey)) };
  }
  // `legame` (rev-s2 P2-3): la sessione in cui si rinnova — i due numeri del saluto (nTel, nPc: 16 byte l'uno) e il
  // numero della stanza del QR (16 byte) —, nel sale: K' è di QUESTA sessione, sotto K. Chi ha K e fa da uomo in
  // mezzo deve stare anche in questa sessione, dalle due parti (il rischio che resta: ponte/README.md).
  async function rinnova(k, privata, pubAltro, pubTel, pubPc, legame) {
    if (!(pubAltro && pubAltro.length === 65 && pubAltro[0] === 4)) throw new Error("chiave pubblica non valida");
    if (!(legame instanceof Uint8Array) || legame.length !== 48) throw new Error("rinnovo senza la sua sessione");
    const altro = await subtle.importKey("raw", pubAltro, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const z = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: altro }, privata, 256));
    return chiaveDa(await hkdf(k, unisci(SALE, z, pubTel, pubPc, legame), "rinnova 2", 32));
  }
  // il legame di una sessione: nTel, nPc (base64url) e la stanza del QR (esadecimale)
  function legameDi(nTel, nPc, stanza) {
    const a = daB64u(nTel), b = daB64u(nPc);
    if (a.length !== 16 || b.length !== 16 || !/^[0-9a-f]{32}$/.test(stanza || "")) throw new Error("sessione non valida");
    return unisci(a, b, Uint8Array.from(stanza.match(/../g), (h) => parseInt(h, 16)));
  }

  globalThis.PonteCripto = {
    VERSIONE, TIPO, casuale, b64u, daB64u, chiaviCoppia, chiaviSessione,
    sigilla, apri, leggiTestata, Canale, canaleTel, canalePc, leggiFrammento, frammento, codice,
    chiaveDa, chiaviEntra, provaEntra, coppiaEcdh, rinnova, legameDi,
  };
})();
