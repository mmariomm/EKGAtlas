/*
 * Fixture PDF "difficili": referti radiologici finti, generati qui, che usano
 * le tecniche che i generatori PDF veri usano davvero — e che il lettore di
 * casa (estraiTestoPdf, regex sul contenuto grezzo) non sa leggere. Servono a
 * dimostrare che pdf.js li legge tutti, lui sì.
 *
 * - pdfCifrato: cifratura RC4 128 bit, Standard security handler V2/R3,
 *   password utente vuota. Un estrattore ingenuo non decifra nulla: stringhe
 *   e stream sono garbage senza la chiave. In più il font è un Type0/
 *   Identity-H con nome risorsa /C2_0 — un estrattore che riconosce solo
 *   /F1, /F2... non vede nemmeno l'operatore Tf, quindi niente mappa
 *   ToUnicode e niente testo.
 * - pdfOggettiCompressi: PDF 1.5 con Catalog/Pages/Page/Font dentro un
 *   object stream (/Type/ObjStm) e xref stream al posto della tabella xref
 *   classica (niente "trailer", niente "N 0 obj" per quegli oggetti): un
 *   estrattore che cerca la pagina con una regex letterale non la trova mai.
 *   Il contenuto è anche diviso in due stream (/Contents come array), uniti
 *   con TL/T* — un altro punto dove un estrattore ingenuo si ferma al primo
 *   pezzo che trova.
 * - pdfKerning: PDF semplice, non cifrato, ma il testo è disegnato con TJ e
 *   crenatura: ogni parola è una stringa a sé, separata da un numero
 *   negativo che sposta il cursore — nessuno spazio letterale nel contenuto.
 *   L'ultima riga sta dentro un Form XObject invocato con /Fm0 Do: un
 *   estrattore che legge solo il /Contents della pagina non la vede mai.
 *
 * Le tre funzioni prendono `righe` (stringhe in Latin-1, es. lettere
 * accentate italiane) e restituiscono un Buffer con un PDF completo e
 * valido: una riga di testo per elemento, su una pagina A4 (595x842),
 * da y=760 scendendo di 16pt.
 */
import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { Buffer } from "node:buffer";

// ============================================================ scrittura PDF

// Un oggetto indiretto "N 0 obj ... endobj", con o senza stream.
function obj(num, dict, streamBuf) {
  const pezzi = [Buffer.from(`${num} 0 obj\n${dict}\n`, "latin1")];
  if (streamBuf) pezzi.push(Buffer.from("stream\n", "latin1"), streamBuf, Buffer.from("\nendstream\n", "latin1"));
  pezzi.push(Buffer.from("endobj\n", "latin1"));
  return Buffer.concat(pezzi);
}

// File completo con tabella xref classica: intestazione, oggetti in ordine
// (objs[i] è l'oggetto i+1), xref, trailer.
function assemblaPdfClassico(objs, rootNum, trailerExtra = "", versione = "1.4") {
  let out = Buffer.from(`%PDF-${versione}\n%\xE2\xE3\xCF\xD3\n`, "latin1");
  const offset = [0];
  for (const o of objs) { offset.push(out.length); out = Buffer.concat([out, o]); }
  const n = objs.length;
  const xrefStart = out.length;
  let xref = `xref\n0 ${n + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= n; i++) xref += `${String(offset[i]).padStart(10, "0")} 00000 n \n`;
  out = Buffer.concat([out, Buffer.from(xref, "latin1")]);
  const trailer = `trailer\n<< /Size ${n + 1} /Root ${rootNum} 0 R${trailerExtra} >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.concat([out, Buffer.from(trailer, "latin1")]);
}

// Stringa letterale PDF: ( ) \ escapati, ogni byte fuori dal range stampabile
// ASCII (cioè gli accentati Latin-1/WinAnsi, es. è=0xE8) in ottale (\350).
function escapaStringaPdf(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += "\\" + s[i];
    else if (c < 0x20 || c > 0x7e) out += "\\" + c.toString(8).padStart(3, "0");
    else out += s[i];
  }
  return out;
}

// Codici CID a 2 byte per Identity-H: qui codice = punto di codice Unicode
// (righe sono in range Latin-1, quindi codice == charCode).
function codiciCid(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(4, "0");
  return out;
}

// ToUnicode minimo: un solo bfrange che è l'identità su tutto il Latin-1.
function cmapToUnicode() {
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    "1 beginbfrange",
    "<0020> <00FF> <0020>",
    "endbfrange",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

// Una voce di cross-reference stream: 1 byte tipo + w2 byte campo2 (big-endian) + w3 byte campo3.
function voceXref(tipo, f2, w2, f3, w3) {
  const b = Buffer.alloc(1 + w2 + w3);
  b.writeUInt8(tipo, 0);
  b.writeUIntBE(f2, 1, w2);
  b.writeUIntBE(f3, 1 + w2, w3);
  return b;
}

// ==================================================== cifratura standard PDF
// Algoritmi 1/2/3/5 del PDF Reference (Standard security handler, RC4,
// R>=3): implementati a mano, RC4 incluso (OpenSSL 3 può non offrirlo più).

const PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function md5(...parti) {
  const h = createHash("md5");
  for (const p of parti) h.update(p);
  return h.digest();
}

function rc4(chiave, dati) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + chiave[i % chiave.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = Buffer.alloc(dati.length);
  let i = 0, j = 0;
  for (let k = 0; k < dati.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = dati[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

function xorChiave(chiave, n) {
  const out = Buffer.alloc(chiave.length);
  for (let i = 0; i < chiave.length; i++) out[i] = chiave[i] ^ n;
  return out;
}

// Password (utente o proprietario) portata a 32 byte con il padding standard.
function riempiPassword(pw) {
  const p = Buffer.from(pw, "latin1").subarray(0, 32);
  const out = Buffer.alloc(32);
  p.copy(out, 0);
  PADDING.copy(out, p.length, 0, 32 - p.length);
  return out;
}

// Algoritmo 3: valore /O.
function calcolaO(ownerPw, userPw, keyLen) {
  let hash = md5(riempiPassword(ownerPw || userPw));
  for (let i = 0; i < 50; i++) hash = md5(hash); // R>=3: 50 giri extra sull'hash intero
  const chiaveRc4 = hash.subarray(0, keyLen);
  let enc = rc4(chiaveRc4, riempiPassword(userPw));
  for (let i = 1; i <= 19; i++) enc = rc4(xorChiave(chiaveRc4, i), enc);
  return enc;
}

// Algoritmo 2: chiave di cifratura del file, dalla password utente (vuota).
function calcolaChiaveFile(userPwRiempita, O, P, id0, keyLen) {
  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(P, 0); // 4 byte little-endian, con segno
  let hash = md5(userPwRiempita, O, pBuf, id0);
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, keyLen)); // R>=3: tronca a n byte ad ogni giro
  return hash.subarray(0, keyLen);
}

// Algoritmo 5 (R>=3): valore /U.
function calcolaU(fileKey, id0) {
  let enc = rc4(fileKey, md5(PADDING, id0));
  for (let i = 1; i <= 19; i++) enc = rc4(xorChiave(fileKey, i), enc);
  const U = Buffer.alloc(32); // i secondi 16 byte sono "arbitrary padding" per spec
  enc.copy(U, 0);
  return U;
}

// Algoritmo 1: chiave RC4 per un singolo oggetto (ogni stringa e ogni stream,
// tranne il dizionario di cifratura stesso e le stringhe /ID).
function chiaveOggetto(fileKey, num, gen) {
  const ext = Buffer.alloc(5);
  ext.writeUIntLE(num, 0, 3);
  ext.writeUIntLE(gen, 3, 2);
  const hash = md5(fileKey, ext);
  return hash.subarray(0, Math.min(fileKey.length + 5, 16));
}

// ===================================================================== fixture

export function pdfCifrato(righe) {
  const userPw = "", ownerPw = "owner", P = -3904, keyLen = 16;
  const id0 = randomBytes(16);

  const O = calcolaO(ownerPw, userPw, keyLen);
  const fileKey = calcolaChiaveFile(riempiPassword(userPw), O, P, id0, keyLen);
  const U = calcolaU(fileKey, id0);

  // contenuto: una riga per Tj, come codici CID esadecimali (Identity-H)
  const testo = righe.map((r, i) => `BT /C2_0 11 Tf 1 0 0 1 60 ${760 - i * 16} Tm <${codiciCid(r)}> Tj ET`).join("\n");
  const compresso = deflateSync(Buffer.from(testo, "latin1")); // prima si comprime...
  const contenutoCifrato = rc4(chiaveOggetto(fileKey, 4, 0), compresso); // ...poi si cifra

  const cmapCifrata = rc4(chiaveOggetto(fileKey, 8, 0), Buffer.from(cmapToUnicode(), "latin1"));

  // le stringhe letterali (Adobe)/(Identity) dentro il CIDSystemInfo vanno
  // cifrate anche loro: sono oggetti-stringa PDF a tutti gli effetti.
  const k6 = chiaveOggetto(fileKey, 6, 0);
  const registry = rc4(k6, Buffer.from("Adobe", "latin1")).toString("hex");
  const ordering = rc4(k6, Buffer.from("Identity", "latin1")).toString("hex");

  const objs = [
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /C2_0 5 0 R >> >> /Contents 4 0 R >>"),
    obj(4, `<< /Length ${contenutoCifrato.length} /Filter /FlateDecode >>`, contenutoCifrato),
    obj(5, "<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+ArialMT /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>"),
    obj(6, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+ArialMT /CIDSystemInfo << /Registry <${registry}> /Ordering <${ordering}> /Supplement 0 >> /FontDescriptor 7 0 R /DW 600 /CIDToGIDMap /Identity >>`),
    obj(7, "<< /Type /FontDescriptor /FontName /ABCDEF+ArialMT /Flags 32 /FontBBox [-628 -376 2000 1010] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 716 /StemV 87 >>"),
    obj(8, `<< /Length ${cmapCifrata.length} >>`, cmapCifrata),
    obj(9, `<< /Filter /Standard /V 2 /R 3 /Length 128 /O <${O.toString("hex")}> /U <${U.toString("hex")}> /P ${P} >>`),
  ];
  const idHex = id0.toString("hex");
  return assemblaPdfClassico(objs, 1, ` /Encrypt 9 0 R /ID [<${idHex}> <${idHex}>]`, "1.4");
}

export function pdfOggettiCompressi(righe) {
  const meta = Math.max(1, Math.ceil(righe.length / 2));
  const primaParte = righe.slice(0, meta);
  const secondaParte = righe.slice(meta);

  // il contenuto è diviso in due stream: il primo lascia BT aperto, il
  // secondo lo chiude — un lettore che li concatena (come fa pdf.js) li
  // vede come un unico stream di operatori, uno che legge solo il primo no.
  const pezzo1 = "BT /TT0 11 Tf 16 TL 60 760 Td " +
    primaParte.map((r, i) => (i === 0 ? `(${escapaStringaPdf(r)}) Tj` : `T* (${escapaStringaPdf(r)}) Tj`)).join(" ");
  const pezzo2 = (secondaParte.length ? secondaParte.map((r) => `T* (${escapaStringaPdf(r)}) Tj`).join(" ") + " " : "") + "ET";
  const stream1 = Buffer.from(pezzo1, "latin1");
  const stream2 = Buffer.from(pezzo2, "latin1");

  // Catalog/Pages/Page/Font: mai "N 0 obj" nel file, solo dentro l'ObjStm.
  const compressi = [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /TT0 4 0 R >> >> /Contents [5 0 R 6 0 R] >>"],
    [4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"],
  ];
  let corpo = "", intestazione = "";
  for (const [num, dict] of compressi) {
    intestazione += `${num} ${Buffer.byteLength(corpo, "latin1")} `;
    corpo += dict + " ";
  }
  const first = Buffer.byteLength(intestazione, "latin1");
  const objStm = deflateSync(Buffer.from(intestazione + corpo, "latin1"));

  let out = Buffer.from("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n", "latin1");
  const off = {};
  off[5] = out.length; out = Buffer.concat([out, obj(5, `<< /Length ${stream1.length} >>`, stream1)]);
  off[6] = out.length; out = Buffer.concat([out, obj(6, `<< /Length ${stream2.length} >>`, stream2)]);
  off[7] = out.length; out = Buffer.concat([out, obj(7, `<< /Type /ObjStm /N ${compressi.length} /First ${first} /Filter /FlateDecode /Length ${objStm.length} >>`, objStm)]);
  off[8] = out.length;

  const W2 = 4, W3 = 2; // larghezza (byte) del campo2 e del campo3 nella xref stream
  const voci = Buffer.concat([
    voceXref(0, 0, W2, 65535, W3), // 0: libero
    voceXref(2, 7, W2, 0, W3), // 1: Catalog, dentro l'ObjStm 7, indice 0
    voceXref(2, 7, W2, 1, W3), // 2: Pages, indice 1
    voceXref(2, 7, W2, 2, W3), // 3: Page, indice 2
    voceXref(2, 7, W2, 3, W3), // 4: Font, indice 3
    voceXref(1, off[5], W2, 0, W3),
    voceXref(1, off[6], W2, 0, W3),
    voceXref(1, off[7], W2, 0, W3),
    voceXref(1, off[8], W2, 0, W3),
  ]);
  const xrefZ = deflateSync(voci);
  out = Buffer.concat([out, obj(8, `<< /Type /XRef /Size 9 /Root 1 0 R /Index [0 9] /W [1 ${W2} ${W3}] /Filter /FlateDecode /Length ${xrefZ.length} >>`, xrefZ)]);
  // niente "trailer": con la xref stream le informazioni del trailer stanno nel suo dizionario
  return Buffer.concat([out, Buffer.from(`startxref\n${off[8]}\n%%EOF`, "latin1")]);
}

export function pdfKerning(righe) {
  const linee = righe.slice();
  const ultima = linee.pop(); // va nel Form XObject
  const y = (i) => 760 - i * 16;

  // ogni parola è una stringa a sé nell'array TJ, nessuno spazio letterale:
  // lo spazio è il buco fatto dal numero negativo tra le stringhe.
  const arrayCrenato = (riga) => riga.split(/ +/).filter(Boolean)
    .map((w, i) => (i === 0 ? "" : "-278") + `(${escapaStringaPdf(w)})`).join("");

  const corpoPagina = linee.map((r, i) => `BT /R7 11 Tf 60 ${y(i)} Td [${arrayCrenato(r)}] TJ ET`).join("\n")
    + (linee.length ? "\n" : "") + "/Fm0 Do";
  const corpoModulo = `BT /R7 11 Tf 60 ${y(linee.length)} Td [${arrayCrenato(ultima)}] TJ ET`;
  const contenutoPagina = Buffer.from(corpoPagina, "latin1");
  const contenutoModulo = Buffer.from(corpoModulo, "latin1");

  const objs = [
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /R7 5 0 R >> /XObject << /Fm0 6 0 R >> >> /Contents 4 0 R >>"),
    obj(4, `<< /Length ${contenutoPagina.length} >>`, contenutoPagina),
    obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    // l'ultima riga: dentro un modulo, invocato dalla pagina con /Fm0 Do
    obj(6, `<< /Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /Font << /R7 5 0 R >> >> /Length ${contenutoModulo.length} >>`, contenutoModulo),
  ];
  return assemblaPdfClassico(objs, 1, "", "1.4");
}

export const RIGHE_ESEMPIO = [
  "TC ENCEFALO SENZA MDC",
  "Non segni di emorragia intracranica in atto.",
  "Sistema ventricolare in asse, di normali dimensioni.",
  "Non si apprezzano lesioni espansive (focali o diffuse).",
  "Conclusioni: quadro nei limiti della norma per l'età.",
  "Temperatura corporea 37,5° - non è stata rilevata febbre.",
];
