#!/usr/bin/env node
/*
 * Il registratore (⋯ → Registra): l'anonimizzazione e il cancello, senza
 * browser. Una registrazione inventata di due pazienti più la lista del PS,
 * con dentro tutto quello che non deve uscire — nomi, codice fiscale, data di
 * nascita, tessera, telefono, indirizzo, email, personale, anamnesi, diario,
 * identificativi — e quello che deve restare: le parole del programma, gli
 * esami, il catalogo, i collegamenti fra pagine e richieste.
 * Tutti i dati qui sono INVENTATI.
 *   node test/registra-anonimo.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "extension/registra-anonimo.js"));
const { anonimizza, cancello, creaZip } = globalThis.RegistraAnonimo;
const vocabolario = JSON.parse(readFileSync(join(root, "extension/registra-vocabolario.json"), "utf8"));

let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

// ------------------------------------------------------------ i «veri» (inventati)
const P1 = { nome: "VERDONE CARLO", cf: "VRDCRL50C12F205Z", nato: "12/03/1950", ep: "120595", tel: "347 1234567", tessera: "80380000001234567890" };
const P2 = { nome: "PALUMBO LINA", cf: "PLMLNI62E41H501K", nato: "01/05/1962", ep: "130409", tel: "02-48001234" };
const MEDICO = "FERRANTE ELIO", UTENTE = "FERELI";
const RICH = "880123", REF = "3f2a9c1e-1111-4222-8333-944455556666";
const G = "https://smarthealth.multimedica.it";
const T0 = Date.UTC(2026, 9, 29, 8, 0, 0);

const testa = (titolo) => `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>${titolo}</title>
  <link rel="stylesheet" href="../Themes/AFC/Style.css"><script>var paz = '${titolo}'; function apri(){ window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?REFERTO_ID=${REF}','HL7RIS'); }</script></head><body>
  <div class="hdr"><img src="../Themes/AFC/images/HMIMU_logo.gif"> MULTIMEDICA IRCCS — Sei connesso come Utente Medico: ${UTENTE}</div>`;
const paziente = (p, extra = "") => `${testa(p.nome)}
  <table><tr><td class="AFCColumnTD">Assistito</td><td>${p.nome}</td><td>${p.cf}</td><td>nato il ${p.nato}</td></tr>
  <tr><td>Tel. ${p.tel}</td><td>Via Garibaldi 12, 20100 Milano (MI)</td><td>carlo.verdone@posta.it</td></tr></table>
  <a title="Richieste Laboratorio" class="myButton" href="menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&amp;EPISODIO_ID=${p.ep}&amp;RISORSA_ID=00660001P&amp;RISORSE=00660001P,00720001P&amp;CODICE_FISCALE=${p.cf}">Laboratorio</a>
  <a title="Stampa Etichette" href="RcsStampaEtichetteLISHMIMU.do?RICHIESTA_ID=${RICH}&amp;RICHIESTA_PROG=1"><img src="../Themes/AFC/images/valida2.gif" title="Stampa Etichette"></a>
  <form name="AmbulatorioPSO" method="post" action="menuPsoEpisodio.do?ccsForm=AmbulatorioPSO:Edit&amp;MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${p.ep}">
    <textarea name="ANAMNESI">Il paziente riferisce dolore toracico da tre ore, iperteso, in terapia con ramipril.</textarea>
    <input type="hidden" name="DIARIO" value="Visitato alle 9, chiamato il cardiologo di guardia per consulenza.">
    <input type="hidden" name="NOMINATIVO" value="${MEDICO}">
    <input type="hidden" name="EPISODIO_ID" value="${p.ep}">
    <input type="hidden" name="URGENZA" value="2">
    <input type="hidden" name="DESCRIZIONE_TITLE" value="Dolore toracico atipico in paziente diabetico">
  </form>
  <table><tr><td class="AFCDataTD">0-320 EMOCROMOCITOMETRICO URGENTE (POCT1502)</td><td>Stato barella libera</td></tr></table>
  ${extra}<p>Tessera ${p.tessera || "nessuna"}</p></body></html>`;
const lista = `${testa("Lista PS")}<table>
  <tr><td>${P1.nome}</td><td>AREA ROSSA</td><td>In visita</td><td><a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${P1.ep}">apri</a></td></tr>
  <tr><td>${P2.nome}</td><td>AREA ROSSA</td><td>In visita</td><td><a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${P2.ep}">apri</a></td></tr>
  <tr><td>Nota riservata solo per uno</td><td>AREA VERDE</td><td>In attesa</td><td><a href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=140001">apri</a></td></tr>
  </table></body></html>`;

const raccolta = {
  versione: "9.9.9", inizio: T0, fine: T0 + 15 * 60e3, origini: { gestionale: G, altri: ["http://10.11.0.151:9080"] },
  pagine: [
    { url: `${G}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoLista`, titolo: "Lista PS", html: lista, ts: T0 + 1000, scheda: 11, alto: true },
    { url: `${G}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${P1.ep}`, titolo: P1.nome, html: paziente(P1, "<span>Solo di VERDONE: dializzato martedì</span>"), ts: T0 + 5000, scheda: 11, alto: true },
    { url: `${G}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${P2.ep}`, titolo: P2.nome, html: paziente(P2), ts: T0 + 9000, scheda: 12, alto: true },
  ],
  flusso: [
    { metodo: "GET", url: `${G}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${P1.ep}`, tipo: "main_frame", scheda: 11, inizio: T0 + 4000, fine: T0 + 4600, stato: 200, contenuto: "text/html" },
    { metodo: "POST", url: `${G}/sa4pso/restrict/menuPsoEpisodio.do?ccsForm=RICHIESTACrea&EPISODIO_ID=${P1.ep}`, tipo: "main_frame", scheda: 11, inizio: T0 + 6000, fine: T0 + 7000, stato: 200,
      corpo: { QUESITO: ["dolore toracico"], RICHIESTA_ID: [RICH], URGENZA: ["2"] },
      rinvii: [{ stato: 302, a: `${G}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=RcsRichiestaPrestazioniRicercaErogatore&RICHIESTA_ID=${RICH}&EPISODIO_ID=${P1.ep}`, t: T0 + 6500 }] },
    { metodo: "GET", url: `${G}/sa4/restrict2/Sa4ViewerExtRedirect.do?REFERTO_SISTEMA=HL7RIS&REFERTO_ID=${REF}`, tipo: "main_frame", scheda: 13, inizio: T0 + 10000, fine: T0 + 10900, stato: 200, contenuto: "application/pdf", pdf: true,
      rinvii: [{ stato: 302, a: `http://10.11.0.151:9080/clin-port/loginPC.jsp?token=abc123secret&CF=${P1.cf}`, t: T0 + 10300 }] },
    { metodo: "GET", url: `${G}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoLista`, tipo: "xmlhttprequest", scheda: 11, inizio: T0 + 12000, fine: T0 + 12100, stato: 200, estensione: true },
  ],
  pdf: [
    { url: `${G}/sa4/restrict2/Sa4ViewerExtRedirect.do?REFERTO_SISTEMA=HL7RIS&REFERTO_ID=${REF}`, ts: T0 + 11000, scheda: 13, origine: "rilettura", pagine: 1, misura: [595, 842], lettore: "pdf.js",
      righe: ["RADIOLOGIA - Ospedale di esempio", `Paziente: ${P1.nome} nato il ${P1.nato}`, `Cod. Fisc. ${P1.cf}`, "RADIOGRAFIA TORACE 2 PROIEZIONI",
        "Non focolai a carattere broncopneumonico in atto.", `Il Medico Dott. ${MEDICO}`, `Episodio ${P1.ep}`] },
  ],
  schede: [{ id: 13, apertaDa: 11, finestra: 2, popup: true, ts: T0 + 9900 }],
};

const r = anonimizza(raccolta, { vocabolario, sfasamento: 30 });
if (process.env.MOSTRA) { for (const [k, v] of Object.entries(r.files)) console.log("=== " + k + "\n" + v); process.exit(0); }
const tutto = Object.values(r.files).join("\n");
const nomi = Object.keys(r.files);

// ---------------------------------------------------------------- forma
check(nomi.includes("flusso.json") && nomi.includes("riepilogo.txt") && nomi.some((n) => /^pagine\/001-PsoLista\.html$/.test(n))
  && nomi.some((n) => /^pagine\/002-PsoEpisodioClinicoAmbulatorio\.html$/.test(n)) && nomi.includes("pdf/001.json"),
  `i file: pagine/NNN-<tipo>.html, flusso.json, pdf/NNN.json, riepilogo.txt (${nomi.join(", ")})`);

// ------------------------------------------------- niente di vero esce
const veri = {
  "nome del paziente 1": P1.nome, "nome del paziente 2": P2.nome, "cognome 1": "VERDONE", "cognome 2": "PALUMBO",
  "codice fiscale 1": P1.cf, "codice fiscale 2": P2.cf, "data di nascita 1": P1.nato, "data di nascita 2": P2.nato,
  "telefono 1": P1.tel, "telefono 2": "48001234", "tessera": P1.tessera, "indirizzo": "Garibaldi", "email": "carlo.verdone",
  "medico": MEDICO, "cognome del medico": "FERRANTE", "utente": UTENTE, "episodio 1": P1.ep, "episodio 2": P2.ep, "richiesta": RICH,
  "referto": REF, "token": "abc123secret", "ospedale": "MULTIMEDICA", "marchio": "smarthealth", "anamnesi": "ramipril",
  "diario": "cardiologo di guardia", "descrizione": "diabetico", "testo di un solo paziente": "dializzato", "nota di una riga sola": "Nota riservata",
  "host del portale": "10.11.0.151", "logo": "HMIMU_logo",
};
for (const [cosa, v] of Object.entries(veri)) {
  const dove = Object.entries(r.files).filter(([, c]) => c.toUpperCase().includes(v.toUpperCase())).map(([f]) => f);
  check(!dove.length, `nessun ${cosa} (${dove.length ? "ANCORA in " + dove.join(", ") : "tolto"})`);
}

// ------------------------------------------------- quello che resta
const pag1 = r.files[nomi.find((n) => /002-/.test(n))], pag2 = r.files[nomi.find((n) => /003-/.test(n))];
const listaOut = r.files["pagine/001-PsoLista.html"];
check(/title="Richieste Laboratorio"/.test(pag1) && /title="Stampa Etichette"/.test(pag1), "le etichette del programma restano (title)");
check(pag1.includes("0-320 EMOCROMOCITOMETRICO URGENTE (POCT1502)"), "le righe d'esame restano");
check(pag1.includes("RISORSA_ID=00660001P") && pag1.includes("RISORSE=00660001P,00720001P") && pag1.includes('value="2"'), "risorse, catalogo e urgenza restano");
check(pag1.includes("Stato barella libera") && pag2.includes("Stato barella libera"), "una frase che compare per due pazienti resta (vocabolario)");
check(/AREA ROSSA/.test(listaOut) && /In visita/.test(listaOut), "nella lista PS restano area e stato condivisi da più righe");
check(pag1.includes("icona:valida2.gif") && !/<img[^>]*HMIMU/.test(pag1), "le icone diventano icona:<nome>, i loghi spariscono");
check(/href="\.\.\/Themes\/AFC\/Style\.css"/.test(pag1), "il foglio di stile resta collegato");
// testo libero: inventato, lunghezza simile
const ana = /<textarea name="ANAMNESI">([^<]*)<\/textarea>/.exec(pag1);
check(ana && ana[1].length >= 60 && ana[1].length <= 90 && !/ramipril/.test(ana[1]), `l'anamnesi diventa testo inventato di lunghezza simile (${ana && ana[1].length} caratteri)`);

// ------------------------------------------- nomi finti, sempre gli stessi
const finto1 = (/<title>([^<]*)<\/title>/.exec(pag1) || [])[1], finto2 = (/<title>([^<]*)<\/title>/.exec(pag2) || [])[1];
check(finto1 && finto2 && finto1 !== finto2 && /^[A-Z]+ [A-Z]+$/.test(finto1), `ogni paziente ha il suo nome finto (${finto1}, ${finto2})`);
check(listaOut.includes(finto1) && listaOut.includes(finto2), "lo stesso nome finto nella lista e nella sua scheda");
check(pag1.split(finto1).length > 2, "lo stesso nome finto in tutta la scheda (titolo, intestazione, script)");
const pdf1 = JSON.parse(r.files["pdf/001.json"]);
check(pdf1.righe.some((x) => x.includes(finto1)) || pdf1.righe.every((x) => !/VERDONE/.test(x)), "nel referto il nome vero non c'è (e se c'è un nome, è quello finto)");
check(/value="OPERATORE \d+"/.test(pag1) && /value="OPERATORE \d+"/.test(pag2) && (/value="(OPERATORE \d+)"/.exec(pag1) || [])[1] === (/value="(OPERATORE \d+)"/.exec(pag2) || [])[1],
  "il medico diventa OPERATORE n, lo stesso su ogni pagina");

// ------------------------------------- identificativi rimappati con coerenza
const epFinto = (/EPISODIO_ID=(\d+)/.exec(pag1) || [])[1];
check(epFinto && epFinto !== P1.ep && epFinto.length === P1.ep.length, `l'episodio diventa un altro numero della stessa lunghezza (${epFinto})`);
check(listaOut.includes(`EPISODIO_ID=${epFinto}`) && pag1.includes(`name="EPISODIO_ID" value="${epFinto}"`), "lo stesso episodio finto nella lista, nei link e nei campi");
const flusso = JSON.parse(r.files["flusso.json"]);
check(flusso.richieste[0].url.includes(`EPISODIO_ID=${epFinto}`) && flusso.richieste[0].url.startsWith("https://gestionale.esempio/"), "e nel flusso, su un indirizzo finto");
const richFinta = (/RICHIESTA_ID=(\d+)/.exec(pag1) || [])[1];
check(richFinta && flusso.richieste[1].rinvii[0].a.includes(`RICHIESTA_ID=${richFinta}`) && flusso.richieste[1].corpo.RICHIESTA_ID[0] === richFinta,
  "la richiesta: lo stesso numero finto nella pagina, nel rinvio e nel modulo inviato");
check(flusso.richieste[1].corpo.QUESITO[0] === "ESEMPIO" && flusso.richieste[1].corpo.URGENZA[0] === "2", "nel modulo: il quesito sparisce, l'urgenza resta");
const refFinto = (/REFERTO_ID=([0-9a-f-]{36})/.exec(flusso.richieste[2].url) || [])[1];
check(refFinto && refFinto !== REF && pag1.includes(refFinto) && pdf1.url.includes(refFinto), "il referto: lo stesso id finto nello script della pagina, nel flusso, nel PDF");
check(flusso.richieste[2].rinvii[0].a.startsWith("http://portale.esempio/clin-port/loginPC.jsp?token=") && flusso.richieste[2].rinvii[0].stato === 302,
  `il rinvio al portale: indirizzo finto, stato e tempo (${flusso.richieste[2].rinvii[0].a})`);
check(flusso.richieste[2].durata === 0.9 && flusso.richieste[2].inizio === 10 && flusso.richieste[3].da === "estensione", "tempi in secondi dall'inizio, e chi ha fatto la richiesta");
check(flusso.schede.length === 1 && flusso.schede[0].popup && flusso.schede[0].apertaDa === 1, "le schede: chi ha aperto chi");

// --------------------------------------------------------- il riepilogo
const riep = r.files["riepilogo.txt"];
check(/Controllo prima dell'esportazione: superato/.test(riep) && r.gate.ok, `il cancello passa (${r.gate.punti} punti)`);
check(/nomi di pazienti: [1-9]/.test(riep) && /codici fiscali: [1-9]/.test(riep) && /date di nascita: [1-9]/.test(riep) && /identificativi rimappati: [1-9]/.test(riep)
  && /testi liberi: [1-9]/.test(riep) && /Icone usate[^\n]*valida2\.gif/.test(riep) && /Versione dell'estensione: 9\.9\.9/.test(riep), "il riepilogo conta le sostituzioni per tipo e dice le icone");

// ------------------------------------- di quale paziente è una pagina
// Una lista senza EPISODIO_ID vista DOPO il paziente 1 nella stessa scheda non
// è del paziente 1: il disturbo del paziente 2 che compare lì e nella scheda
// del paziente 2 non diventa «vocabolario». Una finestra dei risultati aperta
// da una scheda è del paziente di quella scheda: le voci di laboratorio
// comuni a due pazienti restano.
{
  const pag = (url, html, ts, scheda, apertaDa = null) => ({ url: G + url, html, ts: T0 + ts, scheda, alto: true, apertaDa });
  const ris = (v) => `<table><tr><td>Leucociti</td><td>${v}</td></tr><tr><td>Emoglobina glicata</td><td>${v}</td></tr></table>`;
  const r2 = anonimizza({ inizio: T0, origini: { gestionale: G }, pagine: [
    pag("/x.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=120001", "<p>Pagina del primo</p>", 1000, 1),
    pag("/x.do?MVPG=PsoListaArea", "<table><tr><td>Dolore addominale da ieri sera</td><td>OBI</td></tr></table>", 2000, 1),
    pag("/x.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=120002", "<p>Dolore addominale da ieri sera</p>", 3000, 2),
    pag("/r.do?RCS_ACCESSO_ID=7", ris("6.1"), 3500, 3, 2),
    pag("/x.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=120001", "<p>Pagina del primo</p>", 4000, 1),
    pag("/r.do?RCS_ACCESSO_ID=8", ris("7.2"), 4500, 4, 1),
  ] }, { vocabolario, sfasamento: 30 });
  const tutto2 = Object.values(r2.files).join("\n");
  check(!/Dolore addominale/.test(tutto2), "la lista vista dopo un paziente non è sua: il disturbo di un altro non diventa vocabolario");
  check((tutto2.match(/Emoglobina glicata/g) || []).length === 2, "la finestra dei risultati è del paziente che l'ha aperta: le voci comuni a due pazienti restano");
}

// ------------------------------------------------------------- il cancello
const sensibili = { nomi: [P1.nome, P2.nome], cf: [P1.cf], nascita: [P1.nato], id: [P1.ep] };
const c1 = cancello({ ...r.files, "pagine/099-x.html": r.files["pagine/001-PsoLista.html"] + "<p>RSSMRA80A01H501U</p>" }, sensibili);
check(!c1.ok && c1.punti === 1 && c1.dove["pagine/099-x.html"]["codice fiscale"] === 1, `un codice fiscale piantato fa scattare il controllo (${c1.punti} punto)`);
const c2 = cancello({ a: "<td>Verdone&nbsp;Carlo</td>", b: "?q=VERDONE+CARLO", c: "nato il 12-03-1950", d: "ep 120595 ok", e: "1205951 no" }, sensibili);
check(!c2.ok && c2.punti === 4 && !c2.dove.e, `il cancello vede i nomi anche in minuscolo, con &nbsp; o +, le date con altri separatori, gli episodi (${c2.punti} punti)`);
check(!JSON.stringify(c2).includes("VERDONE") && !JSON.stringify(c2).includes("120595"), "e dice dove e quanti, mai i valori");
check(cancello(r.files, sensibili).ok, "l'uscita vera, ricontrollata dal di fuori, è pulita");
// Il controllo non blocca: se resta qualcosa lo zip esce lo stesso, con
// l'avviso in cima al riepilogo — quanti, dove e di che tipo, mai il valore.
const r3 = anonimizza(raccolta, { vocabolario, sfasamento: 30, aggiungi: { "pagine/099-piantata.html": `<p>RSSMRA80A01H501U</p><p>${P1.nome}</p>` } });
const riep3 = r3.files["riepilogo.txt"];
check(!r3.gate.ok && r3.gate.punti === 2 && Object.keys(r3.files).length === Object.keys(r.files).length + 1,
  `un codice fiscale e un nome piantati: i file escono lo stesso, e il controllo li conta (${r3.gate.punti} punti)`);
check(/^ATTENZIONE: restano 2 dati da controllare/.test(riep3) && /pagine\/099-piantata\.html: codice fiscale ×1, nome ×1/.test(riep3)
  && /Controllo prima dell'esportazione: restano 2 dati da controllare/.test(riep3),
  `l'avviso è in cima a riepilogo.txt, con file e tipo (${riep3.split("\n").slice(0, 2).join(" | ")})`);
check(!/RSSMRA80A01H501U|VERDONE/.test(riep3), "e senza i valori");

// --------------------------------------------------------------- lo zip
const zip = creaZip({ "a.txt": "ciao", "pagine/001-x.html": "<p>è</p>" });
const dir = mkdtempSync(join(tmpdir(), "psa-zip-"));
writeFileSync(join(dir, "z.zip"), zip);
let elenco = "";
try { elenco = execFileSync("unzip", ["-l", join(dir, "z.zip")], { encoding: "utf8" }); execFileSync("unzip", ["-tq", join(dir, "z.zip")]); } catch (e) { elenco = "ERRORE " + e.message; }
const dentro = (() => { try { return execFileSync("unzip", ["-p", join(dir, "z.zip"), "pagine/001-x.html"], { encoding: "utf8" }); } catch { return ""; } })();
check(/a\.txt/.test(elenco) && dentro === "<p>è</p>", "lo zip si apre con unzip, CRC giusti, UTF-8");
rmSync(dir, { recursive: true, force: true });

console.log(fail ? `\n${fail} FAILURE(S)` : "\nREGISTRA (anonimizzazione): TUTTO OK");
process.exit(fail ? 1 : 0);
