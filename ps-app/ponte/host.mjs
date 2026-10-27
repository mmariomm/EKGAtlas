/*
 * L'indirizzo del ponte, da ponte/host.txt: una riga, il nome del sito del
 * ponte («ponte.example.org» o «https://ponte.example.org/qualcosa»), da cui
 * l'origine «https://ponte.example.org». Vuoto: ponte da configurare.
 * Lo usa tools/build.mjs per scrivere extension/ponte-host.js; i test lo usano
 * per controllare che quel file sia fresco.
 */
export function origineDelPonte(testo) {
  const t = String(testo || "").replace(/#.*$/gm, "").trim();
  if (!t) return "";
  let u = null;
  try { u = new URL(/^[a-z]+:\/\//i.test(t) ? t : "https://" + t); } catch { /* sotto */ }
  if (!u || u.protocol !== "https:" || /\s/.test(t)) throw new Error(`ponte/host.txt: serve il nome del sito del ponte (https), non «${t}»`);
  return u.origin;
}
