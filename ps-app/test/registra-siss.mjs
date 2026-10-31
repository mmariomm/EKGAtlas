#!/usr/bin/env node
/*
 * Il registratore sul SISS (menu operatore e Prescrittivo Regionale): le
 * forme nuove da anonimizzare — banner dell'operatore e del paziente, NRE,
 * codice di autenticazione, Id MPI, tessera, protocollo, contatore PAI — e le
 * credenziali che non escono mai (password, PIN, OTP), senza browser. Restano
 * le parole dell'app, i farmaci (AIC e descrizione), le esenzioni, le priorità.
 * Tutti i dati qui sono INVENTATI.
 *   node test/registra-siss.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "extension/registra-anonimo.js"));
const { anonimizza } = globalThis.RegistraAnonimo;
const vocabolario = JSON.parse(readFileSync(join(root, "extension/registra-vocabolario.json"), "utf8"));

let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

// ------------------------------------------------------- i «veri» (inventati)
const PZ = { cog: "CASTELLI", nom: "ORESTE", cf: "CSTRST48D21F205W", nato: "21/04/1948", tessera: "552KZ731", mpi: "88442211" };
const OP = { nome: "Gemma Valli", maiusc: "GEMMA VALLI" };
const NRE = "0301A4123456789", AUT = "73X9K2", PROT = "PRT-2026-00417", PAI = "PAI00977";
const PIN_CARTA = "4321", OTP = "998877", PASSWORD = "Segreta!2026";
const MENU = "https://dcss.cgi.crs.lombardia.it", PR = "https://operatorisiss.servizirl.it";
const T0 = Date.UTC(2026, 9, 30, 9, 0, 0);

const testaPr = `<!DOCTYPE html><html><head><title>Prescrittivo Regionale</title></head><body><app-root _ngcontent-abc-c1="">
  <a href="${PR}/prescrittivoRegionale/pages/dashboard" type="button">Home</a>
  <a href="${PR}/prescrittivoRegionale/pages/prescription/patient-identify">Nuova Prescrizione</a>
  <div class="hdr"><span>Sede di lavoro: Prescrittivo Regionale</span> <span class="op">${OP.nome}</span> <span class="ruolo">Medico</span></div>`;
const banner = `<mat-expansion-panel-header class="mat-expansion-panel-header" role="button" aria-expanded="true">
  <span>Cognome: ${PZ.cog} Nome: ${PZ.nom} Sesso: M Data di nascita: ${PZ.nato}</span>
  <span>Id personale: ${PZ.cf} Tessera: ${PZ.tessera} Id MPI: ${PZ.mpi} Nazione TEAM: </span></mat-expansion-panel-header>`;
const farmaco = `<table><tr><th>Codice farmaco</th><th>Descrizione farmaco</th><th>Quantità</th></tr>
  <tr><td>052594013</td><td>AUGMENTIN*OS 12BUST875MG+125MG</td><td><input formcontrolname="quantity" name="quantity" type="number" value="1"></td></tr></table>
  <div>Prescrivibile elettronicamente</div><div>Programmabile - Da eseguire entro 120gg</div><div>Priorità</div>`;
const editing = (extra = "") => `${testaPr}${banner}
  <div role="tab">Prescrizione medica</div><div role="tab">Storico paziente</div>
  <input formcontrolname="paiCounter" name="paiCounter" placeholder="Contatore PAI" type="text" id="mat-input-6" value="${PAI}">
  <input formcontrolname="protocolNumber" name="protocolNumber" placeholder="N° protocollo" type="text" id="mat-input-7" value="${PROT}">
  <input aria-label="lista esenzioni" formcontrolname="exemption" type="text" role="combobox" id="mat-input-8" placeholder="Esenzioni" value="048">
  <input formcontrolname="diagnosticQuestionText" name="diagnosticQuestionText" placeholder="Quesito diagnostico testuale" type="text" value="dolore toracico da tre giorni, il sig. ${PZ.cog} riferisce febbre">
  <input class="mat-checkbox-input cdk-visually-hidden" type="checkbox" id="mat-checkbox-5-input" checked> <span>Visita in Urgenza</span>
  <input type="text" role="combobox" id="mat-input-11" placeholder="Ricerca specialistica/farmaco" value="augmentin">
  ${farmaco}
  <button class="mat-raised-button">Anteprima</button><button class="mat-raised-button">Salva</button><button class="mat-raised-button">Registra</button>
  </app-root>${extra}</body></html>`;

const pagine = [
  { url: `${MENU}/menusiss/#/menusiss`, titolo: "Menu SISS", ts: T0 + 1000, scheda: 1, alto: true, motivo: "caricata",
    fuori: ["https://api-esempio.servizirl.it", "https://smarthealth.multimedica.it"],
    html: `<!DOCTYPE html><html><head><title>Menu SISS</title></head><body>
      <a role="button" title="Esci dal SISS" aria-label="Esci dal SISS">Esci dal SISS</a>
      <div>Servizi Socio Sanitari Operatore</div><div>Operatore: ${OP.maiusc} Ruolo: MEDICO</div>
      <a class="list-item" href="${MENU}/menusiss/#">Prescrittivo Regionale (PRREG) Produzione</a>
      <a class="list-item" href="${MENU}/menusiss/#">Fascicolo Sanitario Elettronico</a>
      <a class="list-item" href="${MENU}/menusiss/#">Certificati di Malattia (INPS)</a></body></html>` },
  { url: `${PR}/prescrittivoRegionale/pages/prescription/patient-identify`, titolo: "Prescrittivo Regionale", ts: T0 + 5000, scheda: 1, alto: true, motivo: "rotta", credenziali: 2,
    html: `${testaPr}
      <input formcontrolname="idCard" id="idCard" name="idCard" placeholder="ID Personale (CF/STP/TEAM/Altro)" type="text" value="${PZ.cf}">
      <input formcontrolname="patientLastName" id="patientLastName" name="patientLastName" placeholder="Cognome" type="text" value="${PZ.cog}">
      <input formcontrolname="patientFirstName" id="patientFirstName" name="patientFirstName" placeholder="Nome" type="text" value="${PZ.nom}">
      <input formcontrolname="birthDate" id="birthDate" name="birthDate" placeholder="Data nascita" value="${PZ.nato}">
      <input formcontrolname="idSsn" id="idSsn" name="idSsn" placeholder="Tessera" type="text" value="${PZ.tessera}">
      <input type="password" name="pinCarta" value="${PIN_CARTA}">
      <input formcontrolname="otp" placeholder="Codice OTP" type="text" value="${OTP}">
      <input formcontrolname="sbloccoCarta" placeholder="Codice di sblocco" type="text" data-psa-escluso="credenziale">
      <textarea name="password">${PASSWORD}</textarea>
      <div>Ricerca su AR/ANA</div><button type="submit">Cerca</button></app-root></body></html>` },
  { url: `${PR}/prescrittivoRegionale/pages/prescription/editing`, titolo: "Prescrittivo Regionale", ts: T0 + 9000, scheda: 1, alto: true, motivo: "quiete", html: editing() },
  { url: `${PR}/prescrittivoRegionale/pages/prescription/editing`, titolo: "Prescrittivo Regionale", ts: T0 + 12000, scheda: 1, alto: true, motivo: "overlay",
    html: editing(`<div class="cdk-overlay-container"><div class="cdk-overlay-pane"><mat-dialog-container class="mat-dialog-container">
      <h2 class="mat-dialog-title">Anteprima</h2><span>Cognome:</span><span>${PZ.cog}</span><span>Nome:</span><span>${PZ.nom}</span>
      <span>Tessera:</span><span>${PZ.tessera}</span><button>Chiudi</button></mat-dialog-container></div></div>`) },
  { url: `${PR}/prescrittivoRegionale/pages/prescription/editing`, titolo: "Prescrittivo Regionale", ts: T0 + 15000, scheda: 1, alto: true, motivo: "overlay",
    html: editing(`<div class="cdk-overlay-container"><div class="cdk-overlay-pane"><mat-dialog-container class="mat-dialog-container">
      <h2>Ricetta registrata</h2><div>NRE: ${NRE}</div><div>Codice di autenticazione: ${AUT}</div><div>Protocollo: ${PROT}</div>
      <button class="mat-raised-button">Stampa RE</button></mat-dialog-container></div></div>`) },
  { url: `https://dcss.cgi.crs.lombardia.it/idp/login`, titolo: "", ts: T0 + 500, scheda: 1, alto: true, motivo: "caricata", forma: true,
    html: `<!DOCTYPE html><html><body><form><input type="password" data-psa-escluso="credenziale"><button>·</button></form></body></html>` },
];
const api = `${PR}/prescrittivoRegionale/api`;
const raccolta = {
  versione: "9.9.9", inizio: T0, fine: T0 + 20 * 60e3, origini: { gestionale: "https://smarthealth.multimedica.it", siss: [MENU, PR] },
  pagine,
  flusso: [
    { metodo: "GET", url: `${api}/patients?idCard=${PZ.cf}&lastName=${PZ.cog}`, tipo: "xmlhttprequest", scheda: 1, inizio: T0 + 6000, fine: T0 + 6400, stato: 200, contenuto: "application/json", siss: true },
    { metodo: "POST", url: `${api}/prescriptions`, tipo: "xmlhttprequest", scheda: 1, inizio: T0 + 14000, fine: T0 + 14900, stato: 201, siss: true,
      corpo: { password: ["(credenziale: non registrata)"], pinCarta: [PIN_CARTA], quantity: ["1"] } },
    { metodo: "GET", url: `${api}/prescriptions/${NRE}/print?authCode=${AUT}`, tipo: "main_frame", scheda: 2, inizio: T0 + 16000, fine: T0 + 16800, stato: 200, contenuto: "application/pdf", pdf: true, siss: true,
      rinvii: [{ stato: 302, a: `${PR}/prescrittivoRegionale/stampe/${NRE}.pdf`, t: T0 + 16300 }] },
  ],
  pdf: [{ url: `${PR}/prescrittivoRegionale/stampe/${NRE}.pdf`, ts: T0 + 17000, scheda: 2, origine: "rilettura", pagine: 1, misura: [595, 842], lettore: "pdf.js", righe: [
    "SERVIZIO SANITARIO NAZIONALE", "REGIONE LOMBARDIA", "PROMEMORIA PER L'ASSISTITO", `NRE ${NRE}`,
    `COGNOME E NOME / INIZIALI DELL'ASSISTITO: ${PZ.cog} ${PZ.nom}`, `CODICE FISCALE: ${PZ.cf}`,
    `052594013 AUGMENTIN*OS 12BUST875MG+125MG`, `CODICE AUTENTICAZIONE: ${AUT}`, `COGNOME E NOME DEL MEDICO: ${OP.maiusc}`,
  ] }],
  schede: [{ id: 2, apertaDa: 1, finestra: 1, ts: T0 + 15900 }],
};

const r = anonimizza(raccolta, { vocabolario, sfasamento: 30 });
if (process.env.MOSTRA) { for (const [k, v] of Object.entries(r.files)) console.log("=== " + k + "\n" + v); }
const tutto = Object.values(r.files).join("\n");
const nomi = Object.keys(r.files);
const pag = (re) => r.files[nomi.find((n) => re.test(n))] || "";

// --------------------------------------------------------------- le viste
check(["siss-accesso", "siss-menu", "siss-patient-identify", "siss-editing", "siss-anteprima", "siss-registrata"].every((v) => nomi.some((n) => n.endsWith(`-${v}.html`))),
  `le pagine sono siss-<vista> (${nomi.filter((n) => /^pagine/.test(n)).join(", ")})`);

// --------------------------------------------------------- niente di vero
const veri = {
  "cognome del paziente": PZ.cog, "nome del paziente": PZ.nom, "codice fiscale": PZ.cf, "data di nascita": PZ.nato, "tessera": PZ.tessera,
  "Id MPI": PZ.mpi, "NRE": NRE, "codice di autenticazione": AUT, "numero di protocollo": PROT, "contatore PAI": PAI,
  "operatore (nome)": "Gemma", "operatore (cognome)": "Valli", "PIN della carta": `value="${PIN_CARTA}"`, "OTP": OTP, "password": PASSWORD,
  "PIN nel modulo inviato": `"${PIN_CARTA}"`, "testo libero del quesito": "tre giorni",
};
for (const [cosa, v] of Object.entries(veri)) {
  const dove = Object.entries(r.files).filter(([, c]) => c.toUpperCase().includes(v.toUpperCase())).map(([f]) => f);
  check(!dove.length, `nessun ${cosa} (${dove.length ? "ANCORA in " + dove.join(", ") : "tolto"})`);
}

// ------------------------------------------------------- quello che resta
const menu = pag(/-siss-menu\.html$/), ident = pag(/-siss-patient-identify\.html$/), edit = pag(/-siss-editing\.html$/);
const ante = pag(/-siss-anteprima\.html$/), regi = pag(/-siss-registrata\.html$/);
check(["Prescrittivo Regionale (PRREG) Produzione", "Fascicolo Sanitario Elettronico", "Certificati di Malattia (INPS)", "Esci dal SISS"].every((t) => menu.includes(t)),
  "le voci del menu SISS restano");
check(/Operatore: OPERATORE \d+ Ruolo: MEDICO/.test(menu), `il banner dell'operatore: «Operatore: OPERATORE n Ruolo: MEDICO» (${(/Operatore:[^<]*/.exec(menu) || [""])[0]})`);
check(/>Operatore \d+<\/span> <span class="ruolo">Medico/.test(edit) && /Sede di lavoro: Prescrittivo Regionale/.test(edit), "«<Nome> Medico» nell'intestazione: il nome diventa OPERATORE n, il ruolo resta");
const m = /Cognome: ([A-Z]+) Nome: ([A-Z]+) Sesso: M Data di nascita: (\d{2}\/\d{2}\/1948)/.exec(edit);
check(!!m, `il banner del paziente: stessa forma, valori finti, la data di nascita nello stesso anno (${(/Cognome:[^<]*/.exec(edit) || [""])[0]})`);
const [, fCog, fNom] = m || [];
check(m && ident.includes(`value="${fCog}"`) && ident.includes(`value="${fNom}"`) && ante.includes(`<span>${fCog}</span>`) && ante.includes(`<span>${fNom}</span>`),
  "lo stesso nome finto nei campi dell'identificazione, nel banner e nel dialogo (etichetta e valore su due nodi)");
check(/Id personale: ESMPIO80A01Z\d{3}X Tessera: [A-Z0-9]{8} Id MPI: 9\d{7} Nazione TEAM:/.test(edit), `Id personale, tessera e Id MPI sostituiti, le etichette restano (${(/Id personale:[^<]*/.exec(edit) || [""])[0]})`);
check(/name="idCard" placeholder="ID Personale \(CF\/STP\/TEAM\/Altro\)" type="text" value="ESMPIO80A01Z\d{3}X"/.test(ident), "il codice fiscale nel campo: uno finto");
check(/name="birthDate" placeholder="Data nascita" value="\d{2}\/\d{2}\/1948"/.test(ident), "la data di nascita nel campo: un altro giorno dello stesso anno");
check(edit.includes(">052594013<") && edit.includes("AUGMENTIN*OS 12BUST875MG+125MG") && edit.includes("Programmabile - Da eseguire entro 120gg"), "il farmaco (AIC e descrizione) e la priorità restano");
check(edit.includes('value="048"') && edit.includes('value="augmentin"') && edit.includes('name="quantity" type="number" value="1"'), "l'esenzione, la ricerca nel catalogo e la quantità restano");
check(edit.includes('formcontrolname="paiCounter"') && edit.includes('placeholder="Quesito diagnostico testuale"') && /id="mat-checkbox-5-input" checked/.test(edit),
  "i nomi dei campi, le etichette e le caselle spuntate restano");
check(/name="paiCounter"[^>]*value="[A-Z]{3}\d{5}"/.test(edit) && /name="protocolNumber"[^>]*value="[A-Z]{3}-\d{4}-\d{5}"/.test(edit), "contatore PAI e protocollo: altri valori della stessa forma");
const nreF = (/NRE: (\w+)/.exec(regi) || [])[1];
check(nreF && nreF !== NRE && /^\d{4}[A-Z]\d{10}$/.test(nreF), `l'NRE diventa un altro della stessa forma (${nreF})`);
check(/Codice di autenticazione: [A-Z0-9]{6}</.test(regi) && regi.includes("Stampa RE") && regi.includes("Ricetta registrata"), "il codice di autenticazione sostituito; «Stampa RE» resta");

// --------------------------------------------------------- le credenziali
check(/type="password" name="pinCarta" value=""/.test(ident) && /formcontrolname="otp" placeholder="Codice OTP" type="text" value=""/.test(ident) && /<textarea name="password"><\/textarea>/.test(ident),
  "password, PIN e OTP: il valore non esce mai (anche se c'era nel DOM)");
const flusso = JSON.parse(r.files["flusso.json"]);
const post = flusso.richieste.find((x) => x.metodo === "POST");
check(post && /credenziale/.test(post.corpo.password[0]) && /credenziale/.test(post.corpo.pinCarta[0]) && post.corpo.quantity[0] === "1", "nel modulo inviato: password e PIN non registrati");

// ---------------------------------------------------------------- il flusso
const stampa = flusso.richieste.find((x) => x.pdf);
check(stampa && stampa.url.startsWith("https://prescrittivo.esempio/prescrittivoRegionale/api/prescriptions/") && stampa.url.includes(nreF) && stampa.siss
  && stampa.rinvii[0].a.includes(nreF), `«Stampa RE» nel flusso: indirizzo finto, lo stesso NRE finto (${stampa && stampa.url})`);
const pdf1 = JSON.parse(r.files["pdf/001.json"]);
check(pdf1.righe.includes("PROMEMORIA PER L'ASSISTITO") && pdf1.righe.includes(`NRE ${nreF}`) && pdf1.righe.includes("052594013 AUGMENTIN*OS 12BUST875MG+125MG")
  && pdf1.righe.some((x) => /^COGNOME E NOME \/ INIZIALI DELL'ASSISTITO: [A-Z]+ [A-Z]+$/.test(x) && x.includes(fCog)) && pdf1.righe.some((x) => /^COGNOME E NOME DEL MEDICO: OPERATORE \d+$/.test(x)),
  `il promemoria: le etichette e il farmaco restano, i dati sono finti e coerenti (${pdf1.righe.slice(3, 6).join(" | ")})`);

// --------------------------------------------------------------- il riepilogo
const riep = r.files["riepilogo.txt"];
check(r.gate.ok && /Controllo prima dell'esportazione: superato/.test(riep), `il cancello passa (${r.gate.punti} punti ${JSON.stringify(r.gate.dove)})`);
const sez = (riep.split("SISS (menu operatore e Prescrittivo Regionale):")[1] || "").split("\n\n")[0];
check(/Viste: .*siss-editing 1.*siss-registrata 1/.test(sez) && /Istantanee: 6 \(/.test(sez) && /Richieste al SISS: 3 \(XHR\/fetch 2, rinvii 1, errori 0, PDF 1\)/.test(sez)
  && /PDF «Stampa RE»: sì — 1 \(testo letto in 1\)/.test(sez) && /campi esclusi 2; pagine o dialoghi solo nella forma: 1/.test(sez)
  && /api-esempio\.servizirl\.it/.test(sez) && !/multimedica/.test(sez), "riepilogo.txt ha la sezione SISS: viste, istantanee, richieste, PDF, credenziali, host fuori");
console.log("\n----- sezione SISS -----\nSISS (menu operatore e Prescrittivo Regionale):" + sez + "\n------------------------");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nREGISTRA (SISS): TUTTO OK");
process.exit(fail ? 1 : 0);
