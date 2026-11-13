/*
 * La build «PS Assist · Stampa Infermeria» (dalla 3.88; fino alla 3.87 «Lettura e
 * stampa», la mini di sola lettura): la STAZIONE DI STAMPA dell'infermeria, e
 * nient'altro. Le STESSE sorgenti della build normale, con una bandiera
 * (extension/sola-lettura.js: sola lettura E solo stazione) e un manifest a parte:
 *  - il NOME e la descrizione (quello che si vede in chrome://extensions);
 *  - la CHIAVE fissa della mini, diversa da quella normale: la stessa di prima,
 *    quindi lo stesso id (afheakecoidbgjomgfnjmnkblgfhehbl). Una mini 3.87 si
 *    aggiorna da sé in questa, e tiene la memoria dell'estensione: il
 *    collegamento della stazione e le stampanti scelte. È la chiave PUBBLICA
 *    (serve solo a fissare l'id): la privata non sta nel repository.
 *  - niente content script, niente host_permissions, niente risorse per le
 *    pagine: sul PC dell'infermeria PS Assist non entra nel gestionale, non
 *    legge niente per il telefono (il ruolo `pc` della mini non c'è più);
 *  - la sua pagina (options_ui e l'icona) è stazione.html: il QR, le due
 *    stampanti con la prova, lo stato. Serve solo a collegarla e a scegliere le
 *    stampanti: la stazione lavora col service worker, con o senza pagina.
 *  - via dalla copia le pagine del telefono (ponte.html, il popup azione.html):
 *    da qui non si associa un iPhone.
 *
 * Lo usa tools/dist.mjs per scrivere dist/ps-assist-lettura.zip (il nome resta:
 * le mini già installate scaricano quello), e test/ext-mini.mjs.
 */

// La chiave pubblica fissa della build mini (id a parte dalla build normale).
export const LETTURA_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAytiHbR7RsveimO0o29OJhpUmE25bk0Zt0PWqQl0RJmuKf6vmBsZVMTzB4pd6rCJaSIOQjXj45Q7UcsHvv4KEybD/HSkwIKhdlVUuCJXdwymp7DQf6Ez5vP0QwjkjiI0JinWicVYWJbzDbkN+Xtj7ANugrFpNkcoDXYFwxjzZ1myt4iQ31YftT0oKeC7laW2i20cYt4Ial4e3OcNgHu+Pa8uPFDdLx2zcA4Xv0QXKh7VICL0DJPQL15/Oobp3kRzc05AhJGSa9sLUH5934bkKfkWOyto7QbgU5kcWqgEE17gWfc/JnueFXYo5XTK6R7RiiIZ4z5Tw1lVsOicZ2w5GgwIDAQAB";

export const LETTURA_NOME = "PS Assist · Stampa Infermeria";

// I file che nella copia della build Infermeria non ci sono: le pagine con cui si
// associa un iPhone (il ruolo `pc`, che qui non c'è) e il popup della mini 3.87.
export const LETTURA_VIA = ["ponte.html", "ponte.js", "azione.html", "azione.js"];

// Il manifest della build Infermeria, dal manifest normale.
export function manifestLettura(base) {
  const m = JSON.parse(JSON.stringify(base));
  m.name = LETTURA_NOME;
  m.short_name = "PS Stampa Infermeria";
  m.description = "Stazione di stampa dell'infermeria: riceve dal PC del medico i fogli degli ordini (etichette e A4) e li stampa qui. Non entra nel gestionale.";
  m.key = LETTURA_KEY;
  // niente nel gestionale: né content script, né permessi sugli indirizzi, né risorse per le sue pagine
  for (const k of ["content_scripts", "host_permissions", "optional_host_permissions", "web_accessible_resources"]) delete m[k];
  // la sua pagina, dall'icona (senza popup: un clic apre la stazione) e dalle Opzioni
  m.options_ui = { page: "stazione.html", open_in_tab: true };
  m.action = { default_title: LETTURA_NOME };
  return m;
}

// La copia dell'estensione per la build Infermeria, in `dir` (già copiata dalla
// sorgente): il manifest, la bandiera, e via le pagine del telefono.
export function preparaLettura(dir, { readFileSync, writeFileSync, rmSync }, join) {
  const base = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifestLettura(base), null, 2) + "\n");
  writeFileSync(join(dir, "sola-lettura.js"), LETTURA_BANDIERA);
  for (const f of [...LETTURA_VIA, "installata.json"]) rmSync(join(dir, f), { force: true });
}

// La bandiera della build mini (sola-lettura.js, nella copia dell'estensione).
export const LETTURA_BANDIERA = "// Build «Stampa Infermeria»: solo la stazione di stampa (e sola lettura). Generato da tools (dist/ext-mini).\nself.PSA_SOLA_LETTURA = true;\nself.PSA_SOLO_STAZIONE = true;\n";
