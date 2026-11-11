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

// --------------------------------------- le liste del PS e le aree (Ambulatorio, Smart, Imposta)
// Le pagine di elenco hanno più pazienti per pagina e un sacco di etichette del
// programma: «Linea Attività», le linguette «Fast Track (0)», il pulsante «Elenco
// Smart». Un'etichetta con due parole in maiuscolo/iniziali ha la forma di un
// nome: non deve diventare un nome finto (e il controllo non deve poi trovare
// quel «nome» nei campi `LINEA_ATTIVITA`). Le aree e le risorse (`00010001P`,
// «AREA …», «CODICI MINORI», «OBI…») sono il vocabolario della funzione «aree»:
// restano, anche se compaiono una volta sola. Il personale dei menu no.
{
  const PZ = [
    { nome: "ALBANESE TITO", nato: "14/02/1951", eta: 75, ep: "150101", ass: "770101", prat: "2026/881001", motivo: "DOLORE TORACICO", utente: "GALSIL", dist: "oppressione retrosternale da due ore", ref: "5b1e2f10-aaaa-4bbb-8ccc-100000000001", area: "AREA DELTA" },
    { nome: "CARRARO IDA", nato: "03/11/1944", eta: 81, ep: "150102", ass: "770102", prat: "2026/881002", motivo: "CADUTA ACCIDENTALE", utente: "PEGMAR", dist: "caduta dal letto con trauma al polso", ref: "5b1e2f10-aaaa-4bbb-8ccc-100000000002", area: "CODICI MINORI - OBI" },
    { nome: "BELLINI GINO", nato: "27/08/1938", eta: 87, ep: "150103", ass: "770103", prat: "2026/881003", motivo: "FEBBRE ALTA", utente: "GALSIL", dist: "febbre da tre giorni con tosse produttiva", ref: "5b1e2f10-aaaa-4bbb-8ccc-100000000003", area: "FAST TRACK" },
  ];
  const STAFF = ["FERRANTE ELIO", "GALLINI SILVIA", "PEGORARO MARTA"];
  const intest = `<!DOCTYPE html><html><head><title>Pronto Soccorso</title></head><body>
  <table class="AFCHeaderTable"><tr class="AFCHeaderTR"><td class="SA4HeaderBarTDnoBold"><a class="SA4HeaderBarLink" title="Verbali Firmati" href="#"
   onclick="javascript:window.open('/sa4siss/restrict/menuSiss.do?MVPG=SissMultiElencoVerbaliPS&amp;RISORSA_ID=00010001P','Verbali Firmati');">Verbali Firmati</a></td></tr></table>`;
  const filtro = `<form name="PazientiFiltro" method="post" action="menuPso.do?ccsForm=PazientiFiltro:Edit&amp;MVPG=PsoPazientiAmbulatorio"><table><tr>
    <td class="AFCFieldCaptionTD" align="right">Assistito </td>
    <td class="AFCFieldCaptionTD"><input class="AFCInput" value="" name="s_ASSISTITO"></td>
    <td class="AFCFieldCaptionTD" name="LINEA_ATTIVITA" style="display: none;">Linea Attività </td>
    <td class="AFCFieldCaptionTD" name="LINEA_ATTIVITA" style="display: none;"><select name="s_LINEA_ATTIVITA" onchange="submit();"><option selected="" value="">Tutte</option></select></td>
    <td nowrap="" align="center"><a class="shiny-button" href="?MVPG=PsoPazientiTriage">Triage</a>
      <a class="shiny-button-selected" href="?MVPG=PsoPazientiAmbulatorio">Ambulatorio (3)</a>
      <a class="shiny-button" href="?MVPG=PsoPazientiConsulenze">Consulenze (0)</a>
      <a class="shiny-button" href="?MVPG=PsoPazientiFastTrack">Fast Track (0)</a>
      <a class="shiny-button" href="?MVPG=PsoPazientiMedicoCarico">Medico Carico (1)</a></td>
    <td class="AFCFieldCaptionTD"><a href="#" title="Elenco Smart" class="myButtonList" onclick="window.open('menuPso.do?MVPG=PsoPazientiSmart','Elenco Smart');"><img src="../Themes/AFC/images/elenco_smart.png" title="Elenco Smart"></a></td>
  </tr></table></form>`;
  const linguetta = (p, colore = "ARANCIONE") => `<a style="text-decoration: none" href="menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&amp;EPISODIO_ID=${p.ep}" title="Apri Episodio"><div class="myLinguetta" style=" border=1; background-color: ORANGE; color: White; "><table cellpadding="3" cellspacing="0" width="100%"><tbody><tr><td nowrap="" width="1%"><img style="border-style: none" title="${colore}" src="../Themes/AFC/images/2.gif" width="18" heigth="18"></td><td nowrap="" width="40%" title="${colore}"><strong>${p.nome}</strong><br>${p.nato}(${p.eta})<small> ${p.utente}</small></td><td width="50%" align="left" title="${p.dist}"><strong>${p.motivo}</strong><br>${p.dist}</td></tr></tbody></table></div></a>`;
  const bottoni = (p) => `<a href="#" title="Referto di ${p.nome}" onclick="javascript:window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=${p.ass}&amp;REFERTO_SISTEMA=HL7AMB&amp;REFERTO_ID=${p.ref}','HL7AMB')"><img src="../Themes/AFC/images/referto.gif" title="${p.dist}"></a>
    <a name="" href="?MVPG=PsoEpisodioDiario&amp;EPISODIO_ID=${p.ep}&amp;homePage=PsoPazientiAmbulatorio" title="Note di ${p.nome}" onclick="apriNote('${p.nome}', '${p.nato}'); return false;"><img src="../Themes/AFC/images/note.gif"></a>`;
  const ambulatorio = `${intest}${filtro}<table>${PZ.map((p) => `<tr><td class="AFCDataTD" name="EPISODIO">${p.motivo}<br>&nbsp;</td><td class="AFCDataTD">${linguetta(p)}</td><td class="AFCDataTD">${bottoni(p)}</td><td class="AFCDataTD" name="MEDICO">${STAFF[0]}</td></tr>`).join("")}</table></body></html>`;
  const percorso = `<select class="AFCSelect" name="s_PERCORSO"><option selected="" value="">Tutti</option><option value="1">AREA DELTA</option><option value="4">AREA GAMMA - BASSA INTENSITA'</option><option value="9">CODICI MINORI - OBI</option><option value="12">FAST TRACK</option></select>`;
  const smart = `${intest}${filtro}<div>${percorso}</div><table>${PZ.map((p) => `<tr><td class="AFCDataTD">${p.prat}</td><td class="AFCDataTD">${linguetta(p, "VERDE")}</td><td class="AFCDataTD">${p.area}</td><td class="AFCDataTD">${bottoni(p)}</td></tr>`).join("")}</table></body></html>`;
  const imposta = `${intest}<div align="center"><font style="font-size: 130%">OSPEDALE DEL MARE</font><br><font style="font-size: 110%; font-weight: bolder;">AREA ZETA - BASSA INTENSITA'</font>
    <form method="post" action="menuPso.do?ccsForm=ContestoImposta:Edit&amp;MVPG=PsoPsoImposta"><select class="AFCSelect" name="RISORSA_ID">
      <option value="00010001P" selected="">AREA ALTA INTENSITA'</option><option value="00090001P">CODICI MINORI</option><option value="00170001P">OBI MEDICA</option><option value="00230001P">AREA ZETA - BASSA INTENSITA'</option><option value="00310001P">FAST TRACK</option></select>
      <select class="AFCSelect" name="USERNAME" onchange="document.forms['LoginUtenti'].submit();"><option value="GALSIL">${STAFF[1]}</option><option value="PEGMAR">${STAFF[2]}</option><option value="FERELI">${STAFF[0]}</option></select>
    </form></div></body></html>`;
  const T1 = Date.UTC(2026, 9, 30, 9, 0, 0);
  const mk = (url, html, ts, scheda = 21) => ({ url: `${G}/sa4pso/restrict/${url}`, html, ts: T1 + ts, scheda, alto: true });
  const rl = anonimizza({ inizio: T1, origini: { gestionale: G }, pagine: [
    mk("menuPso.do?MVPG=PsoPazientiAmbulatorio", ambulatorio, 1000),
    mk("menuPso.do?MVPG=PsoPazientiSmart", smart, 5000),
    mk("menuPso.do?MVPG=PsoPsoImposta", imposta, 9000),
    mk("menuPso.do?MVPG=PsoPazientiAmbulatorio", ambulatorio, 13000),
  ] }, { vocabolario, sfasamento: 30, diagnosi: true });
  if (process.env.MOSTRA_LISTE) { for (const [k, v] of Object.entries(rl.files)) console.log("=== " + k + "\n" + v); process.exit(0); }
  const fl = Object.fromEntries(Object.entries(rl.files).filter(([n]) => n.startsWith("pagine/")));
  const amb = fl["pagine/001-PsoPazientiAmbulatorio.html"], sm = fl["pagine/002-PsoPazientiSmart.html"], imp = fl["pagine/003-PsoPsoImposta.html"];
  const tuttoL = Object.values(fl).join("\n");
  // i nomi veri non escono, in nessuna forma: linguetta, tooltip, onclick, utenti
  for (const v of ["ALBANESE", "CARRARO", "BELLINI", "GALSIL", "PEGMAR", "FERRANTE", "GALLINI", "PEGORARO", "SILVIA", "14/02/1951", "03/11/1944", "27/08/1938",
    "oppressione retrosternale", "tosse produttiva", "5b1e2f10-aaaa", "881001", "150101", "770101"]) {
    check(!tuttoL.toUpperCase().includes(v.toUpperCase()), `liste: «${v}» non esce`);
  }
  check(rl.gate.ok && rl.gate.punti === 0, `liste: il cancello trova 0 punti (${rl.gate.punti}: ${JSON.stringify(rl.gate.dove)})`);
  // …e fra i «nomi» visti non c'è nessuna etichetta del programma
  const senzaAccenti = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const nomiVisti = (rl.sensibili.nomi || []).concat(rl.sensibili.personale || []).map(senzaAccenti);
  for (const eti of ["Linea Attività", "Fast Track", "Elenco Smart", "Verbali Firmati", "Medico Carico", "CODICI MINORI", "OBI MEDICA", "AREA DELTA"]) {
    check(!nomiVisti.some((n) => n.includes(senzaAccenti(eti))), `liste: «${eti}» non è registrata come nome`);
  }
  // le etichette restano
  check(/>Linea Attività\s*<\/td>/.test(amb) && /name="LINEA_ATTIVITA"/.test(amb) && /name="s_LINEA_ATTIVITA"/.test(amb), "liste: «Linea Attività» e i campi LINEA_ATTIVITA restano");
  check(/>Fast Track \(0\)</.test(amb) && />Consulenze \(0\)</.test(amb) && />Ambulatorio \(3\)</.test(amb) && />Triage</.test(amb) && />Medico Carico \(1\)</.test(amb), "liste: le linguette («Ambulatorio (3)», «Fast Track (0)»…) restano");
  check(/title="Elenco Smart"/.test(amb) && /'Elenco Smart'/.test(amb) && />Verbali Firmati</.test(amb), "liste: pulsanti e menu del programma restano (title, onclick, testo)");
  check(/icona:elenco_smart\.png/.test(amb), "liste: l'icona del pulsante resta (nome del file)");
  check(/title="ARANCIONE"/.test(amb) && /title="VERDE"/.test(sm), "liste: i colori del triage restano");
  check(/<td class="AFCDataTD">AREA DELTA<\/td>/.test(sm) && /<td class="AFCDataTD">CODICI MINORI - OBI<\/td>/.test(sm) && /<td class="AFCDataTD">FAST TRACK<\/td>/.test(sm), "Smart: la cella dell'area resta (anche se compare una volta sola)");
  check(/<option value="1">AREA DELTA<\/option>/.test(sm) && /<option value="4">AREA GAMMA - BASSA INTENSITA'<\/option>/.test(sm) && /<option value="9">CODICI MINORI - OBI<\/option>/.test(sm) && /<option value="12">FAST TRACK<\/option>/.test(sm),
    "Smart: le voci di s_PERCORSO restano");
  // i pazienti sono sostituiti, con la forma
  const ling = [...sm.matchAll(/<strong>([^<]+)<\/strong><br>(\d\d\/\d\d\/\d{4})\((\d+)\)<small> ([^<]+)<\/small>/g)];
  check(ling.length === 3 && ling.every((m) => /^[A-Z]+ [A-Z]+$/.test(m[1]) && /^UTENTE\d+$/.test(m[4])) && new Set(ling.map((m) => m[1])).size === 3,
    `Smart: nome finto, data di nascita (età) e utente nella linguetta (${ling.map((m) => `${m[1]} ${m[2]}(${m[3]}) ${m[4]}`).join("; ")})`);
  check(/Sa4ViewerExtRedirect\.do\?ASSISTITO_ID=[^&']+&REFERTO_SISTEMA=HL7AMB&REFERTO_ID=0000e5e0-/.test(amb.replace(/&amp;/g, "&")), "liste: nell'onclick l'assistito e il referto sono id finti");
  // PsoPsoImposta: risorse e aree restano, il personale no
  check(["00010001P", "00090001P", "00170001P", "00230001P", "00310001P"].every((id) => imp.includes(`<option value="${id}"`)), "Imposta: gli id di risorsa (^\\d{8}P$) restano nelle option di RISORSA_ID");
  check(/<option value="00010001P" selected="">AREA ALTA INTENSITA'<\/option>/.test(imp) && />CODICI MINORI<\/option>/.test(imp) && />OBI MEDICA<\/option>/.test(imp) && />AREA ZETA - BASSA INTENSITA'<\/option>/.test(imp) && />FAST TRACK<\/option>/.test(imp),
    "Imposta: le etichette delle risorse restano (AREA…, CODICI MINORI, OBI, FAST TRACK)");
  check(/INTENSITA'<\/font>/.test(imp) && !/OSPEDALE DEL MARE/.test(imp), "Imposta: il nome dell'area nell'intestazione resta, quello dell'ospedale no");
  const utenti = /<select[^>]*name="USERNAME"[\s\S]*?<\/select>/.exec(imp)[0];
  check(!/GALLINI|PEGORARO|FERRANTE/.test(utenti) && (utenti.match(/<option /g) || []).length === 3, `Imposta: i nomi del personale in USERNAME sono sostituiti (${utenti.replace(/\s+/g, " ").slice(0, 160)})`);
  check(!/value="(GALSIL|PEGMAR|FERELI)"/.test(utenti), "Imposta: e anche le loro sigle");
  check(/Controllo prima dell'esportazione: superato/.test(rl.files["riepilogo.txt"]), "liste: il riepilogo dice «superato»");

  // …ma un nome vero, per quanto abbia la forma di un'etichetta, resta un nome:
  // la linguetta di un paziente dentro un link senza episodio nell'indirizzo, la
  // cella di intestazione che compare in una pagina sola, un nome in un'area
  // (le aree dei pazienti non esistono: «AREA» è l'inizio di un'etichetta, non una scusa)
  const rn = anonimizza({ inizio: T1, origini: { gestionale: G }, pagine: [
    mk("menuPso.do?MVPG=PsoPazientiAmbulatorio", `<html><body><table><tr><td class="AFCFieldCaptionTD">Zucchi Angelo</td></tr></table>
      <a href="menuPso.do?MVPG=PsoPazientiSmart"><div class="myLinguetta"><strong>VASSALLO NINO</strong><br>09/09/1940(86)</div></a>
      <a href="menuPso.do?MVPG=PsoPazientiSmart&amp;MEDICO=CORSINI">Corsini Dario</a>
      <a href="#" onclick="logoutUserApiManager(this,null)">Fabbri Ornella</a></body></html>`, 1000),
  ] }, { vocabolario, sfasamento: 30 });
  const tuttoN = Object.values(rn.files).filter((c, i) => Object.keys(rn.files)[i].startsWith("pagine/")).join("\n");
  check(!/VASSALLO|NINO|ZUCCHI|ANGELO|CORSINI|DARIO|FABBRI|ORNELLA|09\/09\/1940/i.test(tuttoN), `un nome non diventa «etichetta»: linguetta senza episodio, intestazione di una pagina sola, link con parametri, utente (${tuttoN.match(/VASSALLO|ZUCCHI|CORSINI|FABBRI/gi)})`);
}

// ------------------------------------- il visualizzatore di immagini (PACS)
// La fotocamera del paziente apre l'eViewer (un altro host, http, porta 18188)
// dopo un rinvio del gestionale, con un gettone «account» nell'indirizzo. La
// sovraimpressione DICOM ha il paziente in forma COGNOME^NOME, nascita, ID,
// accettazione, data dello studio, istituto, operatore; uno script ha le
// stesse chiavi DICOM in JSON; la forma tecnica (canvas, miniature, WebSocket)
// e un clic su una miniatura arrivano da registra-pagina.js. Tutto inventato.
check(!nomi.includes("eviewer.json") && !/Visualizzatore di immagini/.test(riep), "senza il visualizzatore: niente eviewer.json, niente sezione nel riepilogo");
{
  const V = "http://mmeviewer.multimedica.root.lan:18188";
  const TOK = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822c";
  const TOK2 = "eyJhbGciOiJIUzI1NiJ9xQk3Lm9Pq2Rt8Zw4Vb7Nc1";
  const ACC = "16146285-1", PID = "4455667", UID1 = "1.2.392.200036.9125.4.0.1234.5678.9", UIDS = "1.2.392.200036.9125.2.1234567.20261029";
  const vurl = `${V}/e4cure/eviewer/viewer?requestType=STUDY&accessionNumber=${ACC}&account=${TOK}`;
  const camera = `<a title="IMMAGINE" onclick="window.open('../../sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=7001234&amp;REFERTO_SISTEMA=HL7RIS&amp;REFERTO_ID=99887766','HL7RIS')"><img src="../Themes/AFC/images/foto.png"></a>`;
  const viewer = `<!DOCTYPE html><html><head><title>eViewer</title><script>var studio = {"PatientName":"VERDONE^CARLO","PatientID":"${PID}","PatientBirthDate":"19500312",
    "AccessionNumber":"${ACC}","StudyInstanceUID":"${UIDS}","00100010":{"vr":"PN","Value":[{"Alphabetic":"VERDONE^CARLO"}]}}; var sess = "${TOK2}";</script></head><body>
    <div class="studi"><div class="serie" data-uid="${UID1}"><img class="thumb" src="data:,"><span>1 DX - T Piede DP</span></div>
    <div class="serie"><img class="thumb" src="/e4cure/eviewer/thumb?uid=${UID1}&amp;account=${TOK}"><span>4 DX - W Torace PA</span></div><div>All images</div></div>
    <canvas id="vista" width="512" height="512"></canvas>
    <div class="ov"><div>VERDONE^CARLO</div><div>Birth: 12/03/1950 (76Y)</div><div>Sex: M</div><div>ID: ${PID}</div><div>Acc: ${ACC}</div>
    <div>Study Date: 29/10/2026 10:15:00</div><div>Age At Study: 076Y</div><div>KVP: 70</div><div>MULTIMEDICA S.p.A.</div><div>Operator: GALBIATI^LUCIO</div>
    <div>Referring Physician:</div><div>VERDI^GINO</div><div>Institution: Ospedale San Felice</div><div>W: 4095 L: 2047</div><div>Carlo Verdone</div></div></body></html>`;
  const tecnica = { sonda: true, elementi: 40, canvas: [{ larghezza: 512, altezza: 512, schermo: [512, 512], contesto: "webgl2", preserveDrawingBuffer: false }],
    immagini: [{ tipo: "data:image/png", caratteri: 1400, naturale: [64, 64], schermo: [64, 64], n: 1 }, { tipo: "http", indirizzo: `${V}/e4cure/eviewer/thumb?account&uid`, naturale: [64, 64], schermo: [64, 64], n: 1 }],
    sfondi: [], riquadri: [], video: 0, svg: 0, oggetti: 0, script: [`${V}/e4cure/eviewer/js/viewer.js`], scriptNellaPagina: 1,
    risorse: [{ chiave: `img ${V}/e4cure/eviewer/render/${UID1}.jpg`, n: 2, trasferiti: 61000, corpo: 60000, decodificati: 60000, max: 30000, ms: 80, cache: 0 }],
    contesti: { webgl2: { n: 1, pdb: 0 }, "2d": { n: 2, pdb: 0 } }, disegni: { "webgl texImage2D pixel-Uint16Array": 2, "2d drawImage img-stessa-origine": 3 },
    websocket: [{ percorso: `ws://mmeviewer.multimedica.root.lan:18188/e4cure/ws`, parametri: ["account"], ricevuti: 3, binari: 3, byteRicevuti: 1200, mandati: 1, byteMandati: 4, chiusa: false }],
    blob: { "image/jpeg": { n: 1, byte: 12000, max: 12000 } } };
  const T2 = T0 + 60e3;
  const rv = anonimizza({ versione: "9.9.9", inizio: T0, fine: T0 + 10 * 60e3, origini: { gestionale: G, viewer: ["mmeviewer.multimedica.root.lan"] },
    pagine: [
      { url: `${G}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${P1.ep}`, titolo: P1.nome, html: paziente(P1, camera), ts: T0 + 1000, scheda: 11, alto: true },
      { url: vurl, titolo: "VERDONE^CARLO - eViewer", html: viewer, ts: T2, scheda: 21, alto: true, apertaDa: 11, motivo: "caricata", tecnica },
    ],
    flusso: [
      { metodo: "GET", url: `${G}/sa4/restrict2/Sa4ViewerExtRedirect.do?ASSISTITO_ID=7001234&REFERTO_SISTEMA=HL7RIS&REFERTO_ID=99887766`, tipo: "main_frame", scheda: 21, inizio: T2 - 900, fine: T2 - 200, stato: 200,
        contenuto: "text/html", rinvii: [{ stato: 302, a: vurl, t: T2 - 600 }] },
      { metodo: "GET", url: `${V}/e4cure/eviewer/render/${UID1}.jpg?account=${TOK}`, tipo: "image", scheda: 21, inizio: T2 + 5100, fine: T2 + 5300, stato: 200, contenuto: "image/jpeg", viewer: true,
        iniziatore: V, intestazioni: { tipo: "image/jpeg", lunghezza: 30000, cache: "private, max-age=3600", etag: true } },
      { metodo: "GET", url: `${V}/e4cure/eviewer/wado?requestType=WADO&studyUID=${UIDS}&objectUID=${UID1}&contentType=application/dicom&account=${TOK}`, tipo: "xmlhttprequest", scheda: 21,
        inizio: T2 + 5200, fine: T2 + 5600, stato: 200, contenuto: "application/dicom", viewer: true, intestazioni: { tipo: "application/dicom", lunghezza: 520000, cache: "no-cache" } },
      { metodo: "POST", url: `${V}/e4cure/eviewer/api/log`, tipo: "xmlhttprequest", scheda: 21, inizio: T2 + 9000, fine: T2 + 9100, stato: 200, viewer: true,
        corpo: { account: [TOK], patientName: ["VERDONE^CARLO"], accessionNumber: [ACC] } },
    ],
    clic: [{ tipo: "click", ts: T2 + 5000, scheda: 21, frame: 0, url: vurl, bersaglio: { strada: [{ tag: "img", classe: "thumb" }, { tag: "div", classe: "serie", id: `s-${UID1}` }],
      testo: "4 DX - W Torace PA", schermo: [64, 64], img: { tipo: "http", indirizzo: `${V}/e4cure/eviewer/thumb?account&uid`, naturale: [64, 64] } } }],
    schede: [{ id: 21, apertaDa: 11, finestra: 3, popup: true, ts: T2 - 1000 }],
  }, { vocabolario, sfasamento: 30 });
  const fv = rv.files, tv = Object.values(fv).join("\n");
  const pv = fv[Object.keys(fv).find((n) => /^pagine\/\d{3}-eviewer-viewer\.html$/.test(n))] || "";
  check(!!pv && !!fv["eviewer.json"], `visualizzatore: la pagina pagine/NNN-eviewer-viewer.html e eviewer.json (${Object.keys(fv).join(", ")})`);
  const viaV = { "il cognome": "VERDONE", "il nome": "CARLO", "il medico che chiede (solo nel visualizzatore)": "VERDI", "e il suo nome": "GINO", "l'operatore": "GALBIATI",
    "il gettone account": TOK, "un pezzo del gettone": TOK.slice(0, 16), "il gettone nello script": TOK2, "l'accettazione": "16146285", "l'ID paziente": PID,
    "la data di nascita": "12/03/1950", "la nascita DICOM": "19500312", "l'UID dell'istanza": "200036.9125", "l'istituto": "San Felice", "l'ospedale": "multimedica", "l'host": "mmeviewer" };
  for (const [cosa, v] of Object.entries(viaV)) {
    const dove = Object.entries(fv).filter(([, c]) => c.toUpperCase().includes(v.toUpperCase())).map(([f]) => f);
    check(!dove.length, `visualizzatore: nessun ${cosa} (${dove.length ? "ANCORA in " + dove.join(", ") : "tolto"})`);
  }
  check(!/data:image\/[\w+.-]+;base64/i.test(tv) && !/iVBORw0KGgo|\/9j\/4/.test(tv), "visualizzatore: nessun byte d'immagine (né data: né base64)");
  const fintoDicom = (/<div>([A-Z]+\^[A-Z]+)<\/div>/.exec(pv) || [])[1];
  check(fintoDicom && pv.includes(`<title>${fintoDicom} - eViewer</title>`) === false && (pv.match(/[A-Z]+\^[A-Z]+/g) || []).every((x) => x === fintoDicom),
    `visualizzatore: il paziente resta in forma DICOM, finto e sempre lo stesso (${fintoDicom})`);
  check(/Birth: \d{2}\/\d{2}\/1950 \(76Y\)/.test(pv) && /Sex: M/.test(pv) && /KVP: 70/.test(pv) && /W: 4095 L: 2047/.test(pv) && /Age At Study: 076Y/.test(pv)
    && /Study Date: \d{2}\/\d{2}\/2026 10:15:00/.test(pv) && !/29\/10\/2026/.test(pv), "visualizzatore: la sovraimpressione resta leggibile (nascita spostata, sesso, KVP, finestra, età, data dello studio spostata)");
  check(/ID: 9\d{6}</.test(pv) && /Acc: \d{8}-1</.test(pv) && !pv.includes(`Acc: ${ACC}`) && /Operator: OPERATORE \d+/.test(pv) && /Institution: OSPEDALE ESEMPIO/.test(pv) && /<div>OPERATORE \d+<\/div>/.test(pv),
    `visualizzatore: ID e accettazione finti, operatore e medico OPERATORE n, l'istituto OSPEDALE ESEMPIO (${(/ID: [^<]*/.exec(pv) || [""])[0]} · ${(/Acc: [^<]*/.exec(pv) || [""])[0]})`);
  check(pv.includes("1 DX - T Piede DP") && pv.includes("4 DX - W Torace PA") && pv.includes("All images"), "visualizzatore: le serie («1 DX - T Piede DP») e «All images» restano");
  const uidF = (/data-uid="([\d.]+)"/.exec(pv) || [])[1];
  check(uidF && uidF !== UID1 && /^[0-2](?:\.\d+){4,}$/.test(uidF) && pv.includes(`/e4cure/eviewer/thumb?uid=${uidF}&amp;account=`) && !/account=[0-9a-f]/i.test(pv),
    `visualizzatore: l'UID diventa un altro UID, lo stesso nella miniatura; il gettone «account» è vuoto (${uidF})`);
  const fl = JSON.parse(fv["flusso.json"]);
  const rvq = fl.richieste.filter((x) => x.viewer);
  const jpg = rvq.find((x) => /render/.test(x.url)), wado = rvq.find((x) => /wado/.test(x.url)), log = rvq.find((x) => x.metodo === "POST");
  check(jpg && jpg.url === `http://eviewer.esempio:18188/e4cure/eviewer/render/${uidF}.jpg?account=` && jpg.misura === 30000 && jpg.intestazioni.cache === "private, max-age=3600"
    && jpg.intestazioni.etag && jpg.iniziatore === "http://eviewer.esempio:18188", `visualizzatore, flusso: l'immagine con misura, cache, ETag, chi l'ha chiesta (${jpg && jpg.url})`);
  check(wado && /requestType=WADO/.test(wado.url) && /contentType=application\/dicom/.test(wado.url) && new RegExp(`objectUID=${uidF.replace(/\./g, "\\.")}`).test(wado.url) && /account=$/.test(wado.url)
    && wado.intestazioni.tipo === "application/dicom", `visualizzatore, flusso: il WADO con i parametri tecnici, l'UID finto, senza gettone (${wado && wado.url})`);
  check(log && log.corpo.account[0] === "" && /^[A-Z]+\^[A-Z]+$/.test(log.corpo.patientName[0]) && log.corpo.accessionNumber[0] !== ACC, "visualizzatore, flusso: nel modulo inviato il gettone sparisce, il nome e l'accettazione sono finti");
  const rin = fl.richieste.find((x) => /Sa4ViewerExtRedirect/.test(x.url));
  check(rin && /^http:\/\/eviewer\.esempio:18188\/e4cure\/eviewer\/viewer\?requestType=STUDY&accessionNumber=\d{8}-1&account=$/.test(rin.rinvii[0].a) && !rin.rinvii[0].a.includes(ACC),
    `visualizzatore: il rinvio della fotocamera porta all'indirizzo finto, senza gettone (${rin && rin.rinvii[0].a})`);
  const ev = JSON.parse(fv["eviewer.json"]);
  const tf = ev.pagine[0] && ev.pagine[0].tecnica;
  check(tf && tf.canvas[0].contesto === "webgl2" && tf.canvas[0].preserveDrawingBuffer === false && tf.websocket[0].percorso === "ws://eviewer.esempio:18188/e4cure/ws"
    && tf.immagini[1].indirizzo === "http://eviewer.esempio:18188/e4cure/eviewer/thumb?account&uid" && tf.risorse[0].indirizzo === `http://eviewer.esempio:18188/e4cure/eviewer/render/${uidF}.jpg`,
    "visualizzatore, eviewer.json: canvas e contesto, WebSocket, miniature, Resource Timing — su indirizzi finti");
  const c0 = ev.clic[0] || {};
  check(c0.tipo === "click" && c0.t === 65 && c0.bersaglio.strada[0].classe === "thumb" && c0.bersaglio.img.tipo === "http" && c0.bersaglio.testo === "4 DX - W Torace PA"
    && c0.bersaglio.strada[1].id === `s-${uidF}`, `visualizzatore, eviewer.json: il clic sulla miniatura (${JSON.stringify(c0).slice(0, 160)})`);
  const rvr = fv["riepilogo.txt"];
  const sez = (rvr.split("Visualizzatore di immagini")[1] || "").split("\n\n")[0];
  check(/Controllo prima dell'esportazione: superato/.test(rvr) && rv.gate.ok, `visualizzatore: il cancello passa (${rv.gate.punti} punti${rv.gate.ok ? "" : ": " + JSON.stringify(rv.gate.dove)})`);
  check(/GET http:\/\/eviewer\.esempio:18188\/e4cure\/eviewer\/render\/\{uid\}\.jpg\?account — 1× image\/jpeg \[image\]; 29 KB/.test(sez)
    && /GET http:\/\/eviewer\.esempio:18188\/e4cure\/eviewer\/wado\?account&contentType=application\/dicom&objectUID&requestType=WADO&studyUID — 1× application\/dicom/.test(sez)
    && /Cache-Control «private, max-age=3600»; ETag 1\/1/.test(sez), "riepilogo, visualizzatore: le richieste d'immagine per modello, con contenuto, misura e cache");
  check(/Canvas: 1 — webgl2 512×512 \(sullo schermo 512×512, preserveDrawingBuffer no\)/.test(sez) && /webgl texImage2D pixel-Uint16Array 2/.test(sez)
    && /Miniature e immagini <img>: 2 — data:image\/png ×1/.test(sez) && /WebSocket: ws:\/\/eviewer\.esempio:18188\/e4cure\/ws \(parametri account\): ricevuti 3 \(binari 3/.test(sez)
    && /Blob diventati indirizzi \(URL\.createObjectURL\): image\/jpeg ×1/.test(sez), "riepilogo, visualizzatore: canvas, disegno, miniature, WebSocket, blob");
  check(/Clic: 1/.test(sez) && /\+65 s click su img\.thumb \(immagine http 64×64[^)]*\) → nei 3 s dopo 2 richieste: 1× GET [^;]*render\/\{uid\}\.jpg\?account image\/jpeg 29 KB; 1× GET [^;]*wado/.test(sez),
    "riepilogo, visualizzatore: il clic sulla miniatura e le richieste che seguono");
  if (process.env.MOSTRA_VIEWER) console.log(sez + "\n" + pv);
  // il cancello: un nome vero piantato in forma DICOM (o girato) fa scattare il controllo
  const sporco = anonimizza({ versione: "9.9.9", inizio: T0, origini: { gestionale: G }, pagine: [
    { url: vurl, titolo: "eViewer", html: viewer, ts: T2, scheda: 21, alto: true },
  ] }, { vocabolario, sfasamento: 30, aggiungi: { "pagine/098-piantata.html": "<p>VERDONE^CARLO^^^</p>", "pagine/099-piantata.html": "<p>Ref: VERDI^GINO, Carlo Verdone</p>" } });
  check(!sporco.gate.ok && sporco.gate.dove["pagine/098-piantata.html"] && sporco.gate.dove["pagine/098-piantata.html"].nome >= 1
    && sporco.gate.dove["pagine/099-piantata.html"] && sporco.gate.dove["pagine/099-piantata.html"].nome >= 1 && sporco.gate.dove["pagine/099-piantata.html"].personale >= 1,
    `visualizzatore: un nome vero piantato in forma DICOM (o girato) fa scattare il controllo (${JSON.stringify(sporco.gate.dove)})`);
  check(!cancello({ a: "<td>Rossi^Mario^^</td>" }, { nomi: ["ROSSI MARIO"] }).ok && !cancello({ a: "id=16146285-1" }, { id: [ACC] }).ok, "il cancello vede «^» e l'accettazione con il trattino");
}

// --------------------------- un nome vero scritto in un'altra forma, in una frase che resta
// Una frase che compare per due pazienti diversi («Cartella di … aperta») è vocabolario e
// resta com'è: se dentro c'è il nome di un paziente scritto in un altro modo — girato
// («MARIO ROSSI»), con l'accento o l'apostrofo («NICOLO'»), con &amp; o %20 in mezzo, o
// con le lettere come entità — il cancello lo vede e la ripulitura finale deve vederlo
// allo stesso modo. Prima: «restano N dati da controllare» sulle liste, e il nome fuori.
{
  const T3 = Date.UTC(2026, 9, 30, 11, 0, 0);
  const forme = ["Cartella di MARIO ROSSI aperta", "Cartella di ROSSI &amp; MARIO aperta", "Cartella di Rossi%20Mario aperta", "Cartella di NICOLO' GIUSEPPE aperta",
    "Cartella di NICOL&Ograve; GIUSEPPE aperta", "Cartella di NICOL&#210; GIUSEPPE aperta", "Cartella di D&#39;ANGELO LUCIA aperta", "Cartella di ROSSI_MARIO aperta",
    "Cartella di NICOL%C3%92 GIUSEPPE aperta", "Cartella di NICOL%D2 GIUSEPPE aperta"];
  const pagA = (ep, nome, i) => ({ url: `${G}/sa4pso/restrict/menuPso.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=${ep}`, ts: T3 + 1000 * i, scheda: 1, alto: true,
    html: `<html><body><h1>${nome}</h1><p>Assistito</p><b>${nome}</b>${forme.map((f) => `<span title="${f}">${f}</span>`).join("")}<a href="x.do?MVPG=PsoPazientiSmart&amp;s_ASSISTITO=${encodeURIComponent(nome)}&amp;NOME=${encodeURIComponent(nome).replace(/%20/g, "+")}">v</a></body></html>` });
  const rf = anonimizza({ inizio: T3, origini: { gestionale: G }, pagine: [pagA("150101", "ROSSI MARIO", 1), pagA("150102", "D'ANGELO LUCIA", 2),
    pagA("150103", "NICOLÒ GIUSEPPE", 3), pagA("150104", "ALTRO PAZIENTE", 4)] }, { vocabolario, sfasamento: 30, diagnosi: true });
  const tf = Object.entries(rf.files).filter(([n]) => n.startsWith("pagine/")).map(([, c]) => c).join("\n");
  check(rf.gate.ok && rf.gate.punti === 0, `forme diverse dello stesso nome in frasi tenute: il cancello trova 0 punti (${rf.gate.punti}: ${JSON.stringify(rf.gate.dove)})`);
  check(!/ROSSI|NICOL|D&#39;ANGELO|D'ANGELO|DANGELO|GIUSEPPE|LUCIA|MARIO/i.test(tf.replace(/PAZIENTE ALTRO/g, "")), "…e nessun nome vero è rimasto, in nessuna forma");
  check(/Cartella di [A-Z]+ [A-Z]+ aperta/.test(tf) && tf.includes("Cartella di"), "la frase resta, col nome finto al posto di quello vero");
  // lo stesso paziente, lo stesso nome finto, anche girato o scritto con l'entità
  const fintoRossi = (/<h1>([^<]+)<\/h1>/.exec(rf.files["pagine/001-PsoEpisodioClinicoAmbulatorio.html"]) || [])[1];
  check(fintoRossi && rf.files["pagine/001-PsoEpisodioClinicoAmbulatorio.html"].includes(`Cartella di ${fintoRossi.split(" ").reverse().join(" ")} aperta`),
    `il nome girato diventa il nome finto girato (${fintoRossi})`);
  check(/s_ASSISTITO=ESEMPIO&amp;NOME=ESEMPIO/.test(tf), "e nell'indirizzo il nome vero non c'è più");
}

// -------------- date, numeri, telefoni e email scritti in un altro modo, in attributi e script
// Il cancello li legge con altri separatori («12-03-1950», «347-1234567»), dentro un id o un
// nome di campo (che la pagina non passa per il testo), in uno script con %XX o &#NN;.
{
  const T4 = Date.UTC(2026, 9, 30, 12, 0, 0);
  const pagB = { url: `${G}/sa4pso/restrict/menuPso.do?MVPG=PsoEpisodioClinicoAmbulatorio&EPISODIO_ID=150101`, ts: T4 + 1000, scheda: 1, alto: true,
    html: `<html><body><table><tr id="riga_12-03-1950_x" class="n_12.03.1950"><td>${P1.nome}</td><td>nato il 12/03/1950</td><td>Tel. 347 1234567</td><td>carlo.verdone@posta.it</td></tr></table>
    <a name="t_347-1234567" id="p_carlo-verdone-posta-it" class="ep_2026-881001 r_2026/881001"></a><span id="e_150101_x" data-ep="x150101y"></span>
    <script>var k = "12%2D03%2D1950"; var t = "347&#45;1234567"; var q = "1950-03-12";</script></body></html>` };
  const rb = anonimizza({ inizio: T4, origini: { gestionale: G }, pagine: [pagB, { ...pagB, ts: T4 + 2000, html: pagB.html.replace("Tel. 347 1234567", "Tel. 347 1234567 / 2026/881001") }] }, { vocabolario, sfasamento: 30, diagnosi: true });
  const tb = Object.entries(rb.files).filter(([n]) => n.startsWith("pagine/")).map(([, c]) => c).join("\n");
  check(rb.gate.ok && rb.gate.punti === 0, `date, telefoni, email e numeri in un'altra forma: il cancello trova 0 punti (${rb.gate.punti}: ${JSON.stringify(rb.gate.dove)})`);
  check(!/12[-.]03[-.]1950|12%2D03|347[-&]|1234567|verdone|150101|881001/i.test(tb), "…e nessuno di quei dati veri è rimasto");
  check(/id="riga_\d\d-\d\d-1950_x"/.test(tb) && /class="n_\d\d\.\d\d\.1950"/.test(tb), "la data di nascita resta una data dello stesso anno, con i separatori che aveva");
}

// ------------------------------------- testo libero (il registro, la diagnosi): raccolta.testi
// Un testo di altri pezzi dell'estensione entra nello zip come testi/<nome> passando dalla
// stessa anonimizzazione: gli stessi nomi finti e gli stessi id delle pagine, e un nome che
// in nessuna pagina c'è (COGNOME NOME in mezzo a una riga) o un codice fiscale non escono.
{
  const registro = [`09:12 Ordine partito per ${P1.nome}, episodio ${P1.ep} (${P1.cf})`,
    `09:13 Richieste ${G}/sa4pso/restrict/menuPsoEpisodio.do?MVPG=PsoRichiestaCreaRcs&EPISODIO_ID=${P1.ep}&CODICE_FISCALE=${P1.cf}.`,
    `09:20 Paziente TRAVERSI GIOVANNA in visita, nato il 02/04/1944, tel. 333 7654321`, `09:21 Sig. Bianchetti Orlando chiama da via Roma 5`, "09:30 Conferma 2/2 provata"].join("\n");
  const rt = anonimizza({ ...raccolta, testi: [{ nome: "registro.txt", testo: registro }, { nome: "../../x y.txt", testo: "ok" }] }, { vocabolario, sfasamento: 30 });
  const tt = rt.files["testi/registro.txt"] || "";
  const fintoP1 = (/<title>([^<]*)<\/title>/.exec(rt.files[Object.keys(rt.files).find((n) => /002-/.test(n))]) || [])[1];
  check(!!tt && Object.keys(rt.files).some((n) => /^testi\/[\w.-]*x_y\.txt$/.test(n)) && !Object.keys(rt.files).some((n) => n.includes("..")), "il testo esce come testi/<nome> (il nome ripulito)");
  check(!/VERDONE|TRAVERSI|GIOVANNA|Bianchetti|Orlando|120595|VRDCRL|02\/04\/1944|7654321|via Roma/i.test(tt), `nel testo non c'è niente di vero (${tt.replace(/\n/g, " | ").slice(0, 200)})`);
  check(tt.includes(`per ${fintoP1} ,`) || tt.includes(`per ${fintoP1},`), `il paziente delle pagine ha lo stesso nome finto (${fintoP1})`);
  check(tt.includes(`EPISODIO_ID=${epFinto}`) && /09:12 /.test(tt) && /09:30 Conferma 2\/2 provata/.test(tt), "lo stesso episodio finto, e orari e frasi del programma restano");
  check(rt.gate.ok, `e il cancello passa (${rt.gate.punti})`);
}

// ------------- quello che il pannello manda (core.js): la diagnosi, il Registro, l'errore grave
// Le funzioni VERE, prese da src/core.js così come sono (come fa tools/build.mjs per registra-pdf.js).
const core = readFileSync(join(root, "src/core.js"), "utf8");
const corpoDi = (i) => { let d = 0; for (let k = core.indexOf("{", i); k < core.length; k++) { if (core[k] === "{") d++; else if (core[k] === "}" && !--d) return core.slice(i, k + 1); } return ""; };
const funzione = (nome) => corpoDi(core.indexOf(`function ${nome}(`));
const riga = (inizio) => { const i = core.indexOf(inizio); return core.slice(i, core.indexOf(";\n", i) + 1); };
{
  const VERSION = "9.9.9", location = { href: `${G}/sa4pso/x` };
  const { mascheraDiagnosi, diagnosiTesto, senzaQuesito, improntaNascita, impronta } = new Function("VERSION", "location",
    `${funzione("mascheraDiagnosi")}\n${riga("const senzaQuesito =")}\n${funzione("diagnosiTesto")}\n${funzione("improntaNascita")}\n${funzione("impronta")}
     return { mascheraDiagnosi, diagnosiTesto, senzaQuesito, improntaNascita, impronta };`)(VERSION, location);
  // (le pagine vere: il codice fiscale nell'indirizzo, nel testo, in uno script; la nascita con / - .)
  const html = `<!DOCTYPE html><html><head><title>Referto</title></head><body><a href="/sa4/restrict2/Sa4ViewerExtRedirect.do?CODICE_FISCALE=${P1.cf}&amp;REFERTO_ID=123456">apri</a>
    <p>Paziente: Verdone Carlo, nato il ${P1.nato} — CF ${P1.cf}</p><p>${P1.nato.replace(/\//g, "-")} · ${P1.nato.replace(/\//g, ".")} · 1950-03-12 · cf ${P1.cf.toLowerCase()}</p><script>var cf = '${P1.cf}';</script></body></html>`;
  const d = diagnosiTesto({ cosa: "referto TC CRANIO (RIS)", url: `${G}/sa4/restrict2/Sa4ViewerExtRedirect.do?REFERTO_ID=123456`, html, diag: "nessun PDF", quando: "08:01" });
  const corpo = d.split("\n---\n")[1] || "";
  check(!/VRDCRL|vrdcrl|12[/.-]03|03-12|C12F/.test(corpo) && (corpo.match(/\[CF\]/g) || []).length === 4 && (corpo.match(/\[data\]/g) || []).length === 4 && /<a href="[^"]*CODICE_FISCALE=\[CF\]/.test(corpo),
    `la diagnosi: il codice fiscale e la data di nascita diventano [CF] e [data] PRIMA delle cifre, non «${P1.cf.slice(0, 12)}###Z» né «12/03/###» (${corpo.replace(/\s+/g, " ").slice(60, 230)})`);
  // un codice fiscale con le cifre coperte, comunque arrivato: il cancello lo conta, la ripulitura lo toglie
  const coperto = P1.cf.replace(/\d{3}(?=[A-Z]$)/, "###");
  const cp = cancello({ "testi/diagnosi-1.txt": `CF ${coperto} e <a href="x?CF=${P1.cf.slice(0, 12)}***${P1.cf.slice(-1)}">` }, {});
  check(!cp.ok && cp.punti === 2 && cp.dove["testi/diagnosi-1.txt"]["codice fiscale"] === 2, `il cancello vede anche il codice fiscale con le cifre coperte («…F###Z», «…F***Z»: ${cp.punti} punti)`);
  const rcp = anonimizza({ inizio: T0, origini: { gestionale: G }, pagine: [], testi: [{ nome: "diagnosi-1.txt", testo: `---\n<p>CF ${coperto}</p>` }] }, { vocabolario, sfasamento: 30 });
  check(/<p>CF ESMPIO80A01Z\d{3}X<\/p>/.test(rcp.files["testi/diagnosi-1.txt"]) && rcp.gate.ok, `…e la ripulitura lo sostituisce con uno finto (${rcp.files["testi/diagnosi-1.txt"].split("\n")[1]}; cancello ${rcp.gate.punti})`);
  // il quesito del triage con le virgolette dentro (o un a capo): non esce niente, fino alla fine della riga
  for (const q of ['Dolore "forte" al torace da ieri', "Dolore toracico\nirradiato al braccio"]) {
    const s = senzaQuesito(`08:01  quesito del triage mantenuto: "${q}"`);
    check(s === '08:01  quesito del triage mantenuto: "…"', `senza quesito: ${JSON.stringify(q)} → ${JSON.stringify(s)}`);
  }
  check(senzaQuesito("08:02  quesito del triage sostituito col tuo, scritto nel pannello") === "08:02  quesito del triage sostituito col tuo, scritto nel pannello"
    && senzaQuesito("08:03  aggiunto ✓ EMOCROMO") === "08:03  aggiunto ✓ EMOCROMO", "…e le righe senza quesito restano com'erano");
  // l'errore grave «di un altro paziente»: nel Registro e nel registro degli errori la nascita solo «diverse», mai la sua impronta
  const metodo = corpoDi(core.indexOf("    erroreIdentita(e, id, righe) {") + 4);
  const righe = [], voci = [];
  const pannello = new Function("CF_UNO", "impronta", "improntaNascita", "segnaErrore", "now", "shortLabel", "GRAVE_ALTRO", `return { ${metodo} };`)(
    /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/, impronta, improntaNascita, (t, v) => voci.push(v), () => "08:02", (s) => s, "grave");
  Object.assign(pannello, { episodeId: P1.ep, log: (l) => righe.push(l), segnala: () => {}, avvisoVisto: () => ({}), nomePaziente: () => P1.nome,
    identitaPaz: () => ({ cf: P1.cf, cfImp: impronta(P1.cf), nome: P1.nome, nascita: P1.nato }) });
  pannello.erroreIdentita({ label: "TC CRANIO", id: "777" }, { via: "data di nascita" }, ["REFERTO", `Paziente: ${P2.nome} nato il ${P2.nato}`, `CF ${P2.cf}`]);
  const impronte = [improntaNascita(P1.nato), improntaNascita(P2.nato)];
  const fuori = righe.join("\n") + JSON.stringify(voci);
  check(righe.length === 1 && /ERRORE GRAVE: il PDF di TC CRANIO \(referto 777\) è di un altro paziente \(data di nascita\)/.test(righe[0]) && /· date di nascita diverse$/.test(righe[0])
    && !impronte.some((x) => fuori.includes(x)) && voci[0] && voci[0].nascita === "diverse" && !("nascitaLette" in voci[0]),
    `l'errore grave dice «date di nascita diverse», senza l'impronta della data (che si rovescia: ${impronte.join(", ")}) — ${righe[0] && righe[0].slice(-90)}`);
}

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
