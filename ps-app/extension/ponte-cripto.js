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

  // ------------------------------------------------ gli appunti («Da rivedere»)
  // Una chiave sua (A, 32 byte): la crea il telefono, e la dà a ogni PC associato dentro la sessione cifrata (e
  // un PC la ridà a un telefono nuovo). Da A, con HKDF: il numero degli appunti sul ripetitore (`id`: lo vede, e
  // da lì non si risale ad A), la chiave della prova (HMAC: il ripetitore la tiene, dalla prima scrittura, per
  // dire chi può leggere e scrivere — non apre niente) e la chiave AES-GCM con cui l'elenco viaggia e sta lassù.
  // Il ripetitore vede solo byte cifrati: nessun nome, nessuna nota, nessun indirizzo.
  const SALE_A = enc.encode("ps-appunti/1");
  async function appuntiChiavi(a) {
    if (!eChiave(a) && (!(a instanceof Uint8Array) || a.length !== 32)) throw new Error("chiave degli appunti non valida");
    const prova = await hkdf(a, SALE_A, "prova", 32);
    return { id: esa(await hkdf(a, SALE_A, "id", 16)), chiave: b64u(prova),
      hmac: await subtle.importKey("raw", prova, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
      aes: await aes(await hkdf(a, SALE_A, "cifra", 32)) };
  }
  const sha = async (t) => b64u(new Uint8Array(await subtle.digest("SHA-256", enc.encode(t))));
  // la prova di una richiesta: la stessa che rifà il ripetitore (worker/ponte-logica.js, provaAppunti)
  async function appuntiProva(c, op, t, v, blob) {
    const testo = `ps-appunti|${c.id}|${op}|${t}|${v}|${await sha(blob || "")}`;
    return b64u(new Uint8Array(await subtle.sign("HMAC", c.hmac, enc.encode(testo))));
  }
  async function appuntiCorpo(c, op, v = 0, blob = "", ora = Date.now()) {
    const t = Math.round(ora), scrive = op === "scrivi";
    return JSON.stringify({ id: c.id, op, t, v, ...(scrive ? { blob } : {}), ...(scrive && v === 0 ? { chiave: c.chiave } : {}),
      prova: await appuntiProva(c, op, t, v, scrive ? blob : "") });
  }
  async function appuntiCifra(c, doc) {
    const iv = casuale(IV);
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(c.id) }, c.aes, enc.encode(JSON.stringify(doc))));
    return b64u(unisci(iv, ct));
  }
  async function appuntiApri(c, blob) {
    if (!blob) return { v: 1, pin: {}, via: {} };
    const b = daB64u(blob);
    const chiaro = await subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, IV), additionalData: enc.encode(c.id) }, c.aes, b.subarray(IV));
    const d = JSON.parse(dec.decode(chiaro));
    return { v: 1, pin: d && typeof d.pin === "object" && d.pin ? d.pin : {}, via: d && typeof d.via === "object" && d.via ? d.via : {} };
  }
  // Due copie dell'elenco, pin per pin: vince la più recente; un pin tolto (`via`: quando) resta tolto, se non è
  // stato rimesso dopo. Le tracce dei tolti se ne vanno dopo 180 giorni (i pin no: solo il medico li toglie).
  function appuntiUnisci(a, b, ora = Date.now()) {
    const out = { v: 1, pin: {}, via: {} };
    for (const d of [a, b]) for (const [k, t] of Object.entries((d && d.via) || {})) if (Number.isFinite(t) && ora - t < 180 * 864e5 && !(out.via[k] >= t)) out.via[k] = t;
    for (const d of [a, b]) for (const [k, p] of Object.entries((d && d.pin) || {})) {
      if (!p || typeof p !== "object" || (out.via[k] || 0) >= (p.mod || 0)) continue;
      if (!out.pin[k] || (out.pin[k].mod || 0) < (p.mod || 0)) out.pin[k] = p;
    }
    return out;
  }
  // Una lettura (senza `cambia`) o una modifica con compare-and-set: si legge, si cambia, si scrive con la
  // versione letta; se intanto qualcuno ha scritto (409, con la copia nuova), si riapplica lì la modifica.
  //   fai(corpo) → { stato, json }   (la POST a /ponte/appunti)
  async function appuntiFai(c, fai, cambia = null) {
    let r = await fai(await appuntiCorpo(c, "leggi"));
    if (r.stato === 404) r = { stato: 200, json: { v: 0, blob: "" } };
    for (let giro = 0; giro < 5; giro++) {
      if (r.stato !== 200 && r.stato !== 409) throw Object.assign(new Error("appunti: " + r.stato), { stato: r.stato });
      const v = r.json.v | 0, doc = await appuntiApri(c, r.json.blob);
      if (!cambia) return { v, doc };
      const nuovo = appuntiUnisci(cambia(doc), null);
      r = await fai(await appuntiCorpo(c, "scrivi", v, await appuntiCifra(c, nuovo)));
      if (r.stato === 200) return { v: r.json.v | 0, doc: nuovo };
      if (r.stato === 404) r = { stato: 409, json: { v: 0, blob: "" } };
    }
    throw new Error("appunti: troppi conflitti");
  }
  // «Elimina tutti i pin»: la copia lassù se ne va (con la prova)
  const appuntiElimina = async (c, fai) => fai(await appuntiCorpo(c, "elimina"));
  // Per tenerla e per darla: A come CryptoKey HKDF non estraibile (per ricavare) e i suoi byte avvolti da una
  // chiave AES-GCM non estraibile (solo per ridarla, dentro una sessione cifrata, a un PC o a un telefono).
  async function appuntiAvvolgi(raw) {
    const kw = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = casuale(IV);
    return { hk: await chiaveDa(raw), kw, iv, ct: new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, kw, raw)) };
  }
  const appuntiSvolgi = async (x) => new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: x.iv }, x.kw, x.ct));

  globalThis.PonteCripto = {
    VERSIONE, TIPO, casuale, b64u, daB64u, chiaviCoppia, chiaviSessione,
    sigilla, apri, leggiTestata, Canale, canaleTel, canalePc, leggiFrammento, frammento, codice,
    chiaveDa, chiaviEntra, provaEntra, coppiaEcdh, rinnova, legameDi,
    appuntiChiavi, appuntiProva, appuntiCorpo, appuntiCifra, appuntiApri, appuntiUnisci, appuntiFai, appuntiElimina, appuntiAvvolgi, appuntiSvolgi,
  };
})();
