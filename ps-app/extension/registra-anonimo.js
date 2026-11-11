/*
 * PS Assist — il registratore: anonimizzazione e controllo prima di esportare.
 *
 * Quello che il registratore raccoglie (le pagine come il medico le ha viste, il
 * flusso delle richieste, il testo dei PDF) è VERO: nomi, codici fiscali,
 * anamnesi, numeri di episodio. Qui diventa una registrazione che può uscire dal
 * PC, con lo stesso metodo di tools/esempi.mjs:
 *
 *   rifiuto di partenza — ogni testo e ogni valore di attributo si sostituisce
 *   con uno inventato della stessa forma, A MENO CHE sia vocabolario del
 *   programma: una stringa che compare nelle pagine di almeno DUE pazienti
 *   diversi in questa registrazione, o nelle pagine di esempio già pubblicate
 *   (esempi-gestionale/), o nel catalogo degli esami. Un elenco di rifiuto toglie
 *   quello che è condiviso ma identifica comunque (personale, utenti, ospedale,
 *   fornitore); le espressioni regolari prendono codici fiscali, date di nascita,
 *   tessere, telefoni, indirizzi, email; i campi di testo libero diventano testo
 *   inventato della stessa lunghezza; i nomi diventano nomi finti, sempre gli
 *   stessi per la stessa persona; gli identificativi (episodio, richiesta,
 *   referto…) diventano altri numeri, sempre gli stessi, così i flussi restano
 *   collegati.
 *
 * Poi il CANCELLO: tutto quello che uscirebbe si rilegge cercando quello che è
 * stato visto di vero (nomi, date di nascita, codici fiscali, episodi). Se resta
 * qualcosa lo zip esce comunque (scelta del medico), ma con l'avviso in cima al
 * riepilogo e nella pagina: quanti, in quale file, di che tipo — mai il valore.
 *
 * Gira nel documento fuori schermo dell'estensione (registra-esporta.html) e in Node per i test: non
 * usa il DOM, solo stringhe.
 */
(function (globale) {
  "use strict";

  // ------------------------------------------------------------ elenchi
  const MARCHI = [/multimedica/i, /\birccs\b/i, /Sei connesso come/i, /finmatica/i, /dedalus/i, /smarthealth/i, /\bAFC\s?2003/i,
    /\bDEA\s+I\s+LIVELLO/i, /tutti i diritti riservati/i, /java\.net\.InetAddress/i, /\bPS Assist\b/i];
  // Le frasi del programma in maiuscolo portano sempre una di queste parole: un
  // nome di persona no (vedi tools/esempi.mjs).
  const PAROLE_APP = /\b(PRONTO|SOCCORSO|LABORATORIO|ANALISI|RADIOLOGIA|TRIAGE|SCHEDA|SCHEDE|CODICE|ESAME|ESAMI|VISITA|REPARTO|AREA|URGENZE|URGENTE|POC|SSG|RX|TC|TAC|ECOGRAFIA|RISONANZA|MAGNETICA|NUCLEARE|OSPEDALE|ESEMPIO|ALLERGIE|ANAMNESI|IMMAGINE|SELEZIONA|MEDICO|UTENTE|RICHIESTA|RICHIESTE|REFERTO|REFERTI|STAMPA|LISTA|PAZIENTI|ETICHETTE|CARRELLO|CONFERMA|ELENCO|DATI|CLINICI|STORICO|OBI|ATTESA|DIMISSIONE|DIMESSO|RICOVERO|BIANCO|VERDE|GIALLO|ROSSO|ROSSA|AZZURRO|ARANCIONE|NERO|OSSERVAZIONE|BREVE|INTENSIVA|SHOCK|BOX|ACUTI|AMBULATORIO|TRATTAMENTO|RIVALUTAZIONE|PRESA|CARICO|CONSULENZA|REFERTATO|ESEGUITO|ESEGUITA|CONFERMATA|PRENOTATA|ANNULLATA|IN|CORSO|NUOVO|NUOVA|TOTALE|MOTIVO|ACCESSO|ARRIVO|AMBULANZA|BARELLA|SEDIA|LETTO|POSTO|NOTE|DATA|ORA|SESSO|NATO|NATA|PER|CON)\b/;
  // i campi che contengono una persona per definizione (personale, firmatari)
  const CAMPI_PERSONA = /^(NOMINATIVO|MEDICO|MEDICO_\w+|\w+_MEDICO|UTENTE|\w+_UTENTE|OPERATORE|\w+_OPERATORE|FIRMA|RICHIEDENTE|COMPILATORE|INFERMIERE|ESECUTORE|REFERTANTE)$/i;
  // i campi di testo libero: diventano testo inventato della stessa lunghezza
  const CAMPI_LIBERI = /^(ANAMNESI\w*|\w*_ANAMNESI|ESAME_OBIETTIVO\w*|DIARIO\w*|DESCRIZIONE_TITLE|ALLERGIE\w*|NOTE?|NOTE_\w+|\w+_NOTE|QUESITO\w*|MOTIVO\w*|TERAPIA\w*|DECORSO\w*|CONCLUSION\w*|EPICRISI\w*|FARMACI\w*|MALATTIE\w*|SINTOMI\w*|PARAMETRI_NOTE|TESTO\w*|OSSERVAZIONI\w*)$/i;
  // parametri e campi della macchina: il valore resta com'è (risorse, pagine, azioni)
  const STRUTTURA = new Set([
    "MVPG", "CCSFORM", "TOPAGE", "TOPG", "RETURNPAGE", "INSERT", "DELETE", "UPDATE", "UPDATE1", "CANCEL",
    "RISORSA_ID", "RISORSE", "STRUTTURA", "STRUTTURA_ID", "REPARTO", "REPARTO_ID", "PADIGLIONE", "BRANCA",
    "PRESTAZIONE", "S_PRESTAZIONE", "PRESTAZIONE_ID", "STAMPA_ID", "MODALITA", "REPORT", "PROJECT", "CONN",
    "MIMETYPE", "TABLE", "DATASOURCE", "TIPO", "CLASSE_RICHIESTA", "URGENZA", "SORT", "ORDER", "PAGE", "FILTRO",
    "REFERTO_SISTEMA", "RICHIESTA_PROG", "AZIONE", "ACTION", "OPERAZIONE", "FORMAT", "LANG", "VIEW", "AREA",
    "AREA_ID", "STATO", "CODICE_TRIAGE", "PRESIDIO", "PRESIDIO_ID", "SEDE", "EROGATORE",
  ]);
  // parametri che identificano un caso: si rimappano, sempre allo stesso modo
  const PARAM_ID = /(^|_)ID$|^ID_|TOKEN|SESSION|^NOSOLOGICO|^PRATICA|^ACCESSO|_ACCESSO$|^EPISODIO|^ASSISTITO|^PAZIENTE|^REFERTO|^RICHIESTA|^RCS_|^PRENOTAZIONE|^BARCODE|^CAMPIONE|^ORDINE|^DOCUMENTO|^NRE$|MPI|^PAI|PROTOCOL|^AUTH|^PATIENT|^TESSERA|^SSN$|^TEAM$|^ID[A-Z]|PRESCRIPTION/i;
  const PARAM_CF = /^(CF|COD_?FISC\w*|CODICE_?FISCALE|FISCAL_?CODE|TAX_?CODE|ID_?CARD)$/i;
  // le credenziali: mai, da nessuna parte (password, PIN, OTP, codice di sblocco)
  const CRED_RE = /(?:^|[^a-z])(?:pin|otp|password|passwd|pwd|passcode|puk|sblocco)(?:[^a-z]|$)|codice\s+di\s+sblocco|one[\s_-]?time|j_password/i;
  // (anche nei nomi scritti a cammello: «pinCarta», «otpCode»)
  const credenziale = (s) => CRED_RE.test(String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
  const LOGHI = /HMIMU_logo|Logo-GF|dds_logo|logo_/i;
  const IMG_DATA_MAX = 8 * 1024;   // un'icona sì, una fotografia o un codice a barre no

  // ------------------------------------------------------------- il SISS
  // Il menu operatore e il Prescrittivo Regionale: le due origini (anche in
  // manifest.json) e i loro nomi finti nello zip.
  const SISS_ORIGINI = { "https://dcss.cgi.crs.lombardia.it": "https://menusiss.esempio", "https://operatorisiss.servizirl.it": "https://prescrittivo.esempio" };
  // Le parole dell'app (etichette, pulsanti, voci di menu, priorità): restano.
  // Solo interfaccia — nessun dato di nessuno.
  const SISS_TESTI = [
    "Esci dal SISS", "Apri menù", "Chiudi menù", "Servizi Socio Sanitari", "Servizi Socio Sanitari Operatore", "Operatore", "Ruolo", "close", "Menu",
    "Prescrittivo Regionale (PRREG) Produzione", "Emergenza Urgenza On Line", "EMPR Monitoraggio missioni in arrivo", "Fascicolo Sanitario Elettronico",
    "ScreenUp - Gestione Screening", "Erogazione Ambulatoriale", "Anagrafe", "Anagrafe Cittadino", "Certificati", "Certificati di Malattia (INPS)",
    "Certificati di infortunio (INAIL - INFOINAIL)", "Comunicazione di Inizio Ricovero (INPS)", "Privacy", "Consenso al Trattamento FSE", "Altri Servizi",
    "SistemaPerson@ - Malattie Professionali e Infortuni", "Segnalazione Malattie Professionali", "Dati Codificati", "Segnalazione Malattie infettive - SMI",
    "Ticket Tracking", "Nuova Gestione Sostituzioni MMG/PLS", "SMAF", "SMAF - Sistema Modulare Acquisizione Flussi", "Prenotazioni",
    "Home", "Nuova Prescrizione", "Sede di lavoro", "Prescrittivo Regionale", "Logout", "ID Personale (CF/STP/TEAM/Altro)", "Cognome", "Nome", "Sesso",
    "Data nascita", "Data di nascita", "Tessera", "Id personale", "Id MPI", "Nazione TEAM", "Open calendar", "Ricerca su AR/ANA",
    "La ricerca su ANA avviene solo in presenza del codice fiscale. Senza CF, la ricerca avviene solo su NAR.", "Cancella", "Cerca",
    "Cambia struttura di lavoro", "Prescrizione medica", "Storico paziente", "Assistiti SSN", "Tipo ricetta", "Specialistica/Farmaceutica",
    "Tipo prescrizione", "Contatore PAI", "N° protocollo", "lista esenzioni", "Esenzioni", "Priorità", "Programmabile - Da eseguire entro 120gg",
    "Quesito diagnostico testuale", "lista quesiti", "Quesito diagnostico codificato", "Oscuramento", "Anonimizzazione", "Stampa iniziali",
    "Visita in Urgenza", "Ric. Interna", "Suggerita", "Ospedaliera", "Ricerca specialistica/farmaco", "Modelli di ricetta", "Ricerca avanzata",
    "Nessuna prestazione specialistica o farmaco selezionati", "Anteprima", "Salva", "Registra", "Compila i dati per il tipo ricetta selezionato",
    "Elimina esenzione", "Utilizza esenzioni associate al paziente",
    "Indica se la prescrizione deriva da un suggerimento di uno specialista o da indicazioni della struttura di ricovero",
    "Indica se la prescrizione è stata compilata in occasione di visita urgente", "Indica se le prestazioni devono essere erogate nella stessa struttura",
    "Indica se la prescrizione contiene una indicazione di ricovero", "Applica l'esenzione a tutte le prestazioni", "Codice farmaco",
    "Descrizione farmaco", "Note cuf", "Quantità", "Classe", "Generico", "Ripetibile", "Sostituibile", "Non sostituibile", "Note trattamento",
    "Elimina tutti i farmaci", "Prescrivibile elettronicamente", "Elimina il farmaco", "Stampa RE", "Stampa promemoria", "Chiudi", "Annulla",
    "Conferma", "Indietro", "Ricetta registrata", "Prescrizione registrata", "U - Urgente", "B - Breve", "D - Differibile", "P - Programmabile",
  ];
  const SISS_PAROLE = new Set([
    ...SISS_TESTI.flatMap((t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().split(/[^A-Z0-9']+/)).filter((w) => w.length >= 1 && !/\d/.test(w)),
    ..."NRE SERVIZIO SANITARIO NAZIONALE L DELL ALL NELL SULL PIN OTP PASSWORD SBLOCCO CARTA SMART CARD ACCESSO ACCEDI ENTRA UTENTE CODICE RICETTA RICETTE PRESCRIZIONE PRESCRIZIONI REGISTRATA REGISTRATE REGISTRATO REGISTRAZIONE CORRETTAMENTE AVVENUTA SALVATA SALVATO BOZZA BOZZE STAMPA STAMPATA PROMEMORIA ELETTRONICA DEMATERIALIZZATA ROSSA FARMACO FARMACI PRESTAZIONE PRESTAZIONI SPECIALISTICA SPECIALISTICHE FARMACEUTICA URGENTE URGENZA BREVE DIFFERIBILE PROGRAMMABILE ENTRO GIORNI GG ORE ESEGUIRE ESEGUITA ESENZIONE ESENZIONI ESENTE NON CODICE CODICI AUTENTICAZIONE NUMERO ERRORE ATTENZIONE AVVISO OK SI NO ASSISTITO ASSISTITA ASSISTITI MEDICO MEDICI PRESCRITTORE DATA ORA QUANTITA CLASSE NOTA NOTE AIC ATC PRINCIPIO ATTIVO CONFEZIONE CONFEZIONI DESCRIZIONE TIPO TIPOLOGIA PRIORITA QUESITO DIAGNOSTICO DIAGNOSI ICD9 CM REGIONE LOMBARDIA REGIONALE SSN SSR SISS ASST ATS ASL STRUTTURA EROGATORE EROGAZIONE PAZIENTE PAZIENTI STORICO NUOVA NUOVO MODIFICA ELIMINA AGGIUNGI SELEZIONA SELEZIONATO SELEZIONATI RISULTATI RICERCA NESSUN NESSUNA TROVATO TROVATI ESITO OPERAZIONE COMPLETATA CONFERMA CONFERMARE VUOI PROCEDERE CONTINUA ANNULLARE CHIUDERE INIZIALI DOPPIO DIRITTO IL LO LA LE GLI I UN UNA UNO DI DA DEL DELLA DELLE DEI DEGLI DELLO AL ALLA AI ALLE IN SU PER CON E ED O OD SE CHE SOLO TUTTI TUTTE TUTTO".split(" "),
  ]);
  // le etichette che portano un dato da sostituire, e che dato
  const SISS_ETICHETTE = [
    ["Cognome e nome / iniziali dell'assistito", "nominativo"], ["Cognome e nome dell'assistito", "nominativo"], ["Cognome e nome del medico", "operatore"],
    ["Cognome e nome", "nominativo"], ["Nominativo", "nominativo"], ["Assistito", "nominativo"], ["Cognome", "cognome"], ["Nome", "nome"],
    ["Sesso", "sesso"], ["Data di nascita", "nascita"], ["Data nascita", "nascita"], ["Nato il", "nascita"], ["Nata il", "nascita"],
    ["Luogo di nascita", "luogo"], ["Comune di nascita", "luogo"], ["Comune di residenza", "luogo"], ["Residenza", "luogo"], ["Indirizzo", "luogo"],
    ["Codice fiscale del medico", "cf"], ["Id personale", "cf"], ["Codice fiscale", "cf"], ["C.F.", "cf"], ["Tessera sanitaria", "tessera"], ["N. tessera", "tessera"],
    ["Tessera", "tessera"], ["Numero TEAM", "tessera"], ["Nazione TEAM", "nazione"], ["Id MPI", "id"], ["NRE", "id"], ["N.R.E.", "id"],
    ["Numero ricetta elettronica", "id"], ["Numero ricetta", "id"], ["N. ricetta", "id"], ["Ricetta n.", "id"], ["Codice ricetta", "id"],
    ["Codice di autenticazione", "id"], ["Codice autenticazione", "id"], ["PIN ricetta", "id"], ["N° protocollo", "id"], ["N. protocollo", "id"],
    ["Numero protocollo", "id"], ["Protocollo", "id"], ["Contatore PAI", "id"], ["Medico prescrittore", "operatore"], ["Prescrittore", "operatore"],
    ["Operatore", "operatore"], ["Medico", "operatore"], ["Ruolo", "ruolo"], ["Sede di lavoro", "sede"], ["Struttura di lavoro", "sede"], ["Struttura", "sede"],
  ];
  const escReS = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const SISS_ETI_RE = new RegExp(`(?<![A-Za-zÀ-ÿ])(${SISS_ETICHETTE.map(([e]) => escReS(e)).join("|")})\\s*:`, "gi");
  const SISS_ETI_SOLA = new RegExp(`^(${SISS_ETICHETTE.map(([e]) => escReS(e)).join("|")})\\s*:$`, "i");
  const catEtichetta = (e) => { const k = MAIUSCm(e); const x = SISS_ETICHETTE.find(([l]) => MAIUSCm(l) === k); return x ? x[1] : null; };
  function MAIUSCm(s) { return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim(); }

  // ------------------------------------------------ il visualizzatore (PACS)
  // L'eViewer dell'ospedale, dove si guardano le radiografie (anche in
  // manifest.json, registra.js, registra-pagina.js): un host, ogni porta; nello
  // zip un nome finto. L\u00ec i dati del paziente stanno nella sovraimpressione
  // DICOM: \u00abROSSI^MARIO\u00bb, \u00abBirth: 05/07/1947 (79Y)\u00bb, \u00abID: \u2026\u00bb, \u00abAcc: \u2026\u00bb.
  const VIEWER_HOST = "mmeviewer.multimedica.root.lan";
  const VIEWER_FINTO = "eviewer.esempio";
  // le etichette della sovraimpressione, e che dato portano dopo i \u00ab:\u00bb
  const VIEWER_ETICHETTE = [
    ["nome", ["Patient's Name", "Patient Name", "Pat. Name", "Patient", "Paziente", "Nominativo", "Name", "Nome"]],
    ["personale", ["Referring Physician's Name", "Referring Physician", "Performing Physician's Name", "Performing Physician", "Reading Physician",
      "Requesting Physician", "Physician", "Operators' Name", "Operator's Name", "Operator Name", "Operator", "Operatore", "Radiologist", "Radiologo",
      "Technologist", "Tecnico", "Medico refertante", "Medico richiedente", "Refertante", "Richiedente", "Medico"]],
    ["nascita", ["Patient's Birth Date", "Patient Birth Date", "Birth Date", "Date of Birth", "Birthdate", "Birth", "DOB", "Data di nascita", "Data nascita",
      "Nato il", "Nata il", "Nascita"]],
    ["eta", ["Patient's Age", "Patient Age", "Age At Study", "Age", "Et\u00e0", "Eta"]],
    ["sesso", ["Patient's Sex", "Patient Sex", "Sex", "Sesso", "Gender"]],
    ["id", ["Other Patient IDs", "Patient ID", "Pat. ID", "Pat ID", "PID", "MRN", "ID paziente", "Codice paziente", "ID"]],
    ["accesso", ["Accession Number", "Accession No.", "Accession No", "Accession #", "Accession", "Acc. No.", "Acc. No", "Acc No", "Acc. #", "Acc.", "Acc",
      "Numero accettazione", "N. accettazione", "Accettazione"]],
    ["data", ["Study Date", "Series Date", "Acquisition Date", "Content Date", "Exam Date", "Data esame", "Data studio", "Date", "Data"]],
    ["ora", ["Study Time", "Series Time", "Acquisition Time", "Content Time", "Time", "Ora"]],
    ["istituto", ["Institution Name", "Institution", "Inst.", "Hospital", "Ospedale", "Struttura", "Station Name", "Station", "Department", "Reparto"]],
    ["descrizione", ["Study Description", "Series Description", "Protocol Name", "Body Part Examined", "Body Part", "Description", "Descrizione", "Protocol", "Protocollo"]],
    ["tecnico", ["Exposure Time", "Pixel Spacing", "Slice Thickness", "KVP", "kV", "mAs", "mA", "ms", "Exposure", "Exp", "Ex", "Series", "Serie", "Se", "Ser",
      "Images", "Image", "Img", "Im", "Ima", "Frame", "Fr", "Thickness", "Thk", "Slice", "Sl", "Location", "Loc", "Pos", "WW", "WL", "WC", "W", "L", "C",
      "Window", "Level", "Zoom", "Z", "Rot", "Angle", "Mag", "Scale", "Matrix", "Rows", "Columns", "Cols", "Bits", "Lossy", "Modality", "Mod", "Modalit\u00e0",
      "View", "Laterality", "Lat", "Distance", "SID", "SOD", "Spacing", "FOV", "Grid", "Filter", "DAP", "Dose", "EI", "DI", "Val", "X", "Y", "HU"]],
  ];
  const VIEWER_ETI = VIEWER_ETICHETTE.flatMap(([c, l]) => l.map((e) => [e, c])).sort((a, b) => b[0].length - a[0].length);
  const VIEWER_ETI_ALT = VIEWER_ETI.map(([e]) => escReS(e)).join("|");
  const VIEWER_ETI_RE = new RegExp(`(?<![A-Za-z\u00c0-\u00ff0-9'\u2019.])(${VIEWER_ETI_ALT})\\s*:(?!\\/\\/)`, "gi");
  const VIEWER_ETI_SOLA = new RegExp(`^(${VIEWER_ETI_ALT})\\s*:$`, "i");
  const VIEWER_CAT = new Map(VIEWER_ETI.map(([e, c]) => [MAIUSCm(e), c]));
  const VIEWER_PAROLE_ETI = new Set(VIEWER_ETI.flatMap(([e]) => MAIUSCm(e).split(/[^A-Z0-9']+/)).filter((w) => w.length >= 2));
  // le parole dell'app (qualche voce dell'interfaccia) e delle descrizioni di serie (\u00abT Piede DP\u00bb, \u00abW Torace PA\u00bb)
  const VIEWER_TESTI = new Set(["All images", "All Images", "ALL IMAGES", "Tutte le immagini", "Series", "Serie", "Studies", "Study", "Studi", "Studio",
    "Images", "Immagini", "Thumbnails", "Miniature", "Loading...", "Loading\u2026", "Caricamento...", "Caricamento\u2026"]);
  const VIEWER_PAROLE = new Set(("ALL IMAGES IMAGE TUTTE LE IMMAGINI IMMAGINE SERIE SERIES STUDIO STUDY TORACE PIEDE MANO POLSO GOMITO SPALLA OMERO "
    + "AVAMBRACCIO BRACCIO GINOCCHIO CAVIGLIA ANCA ANCHE BACINO FEMORE TIBIA GAMBA COSCIA CRANIO COLONNA RACHIDE CERVICALE DORSALE LOMBARE "
    + "LOMBOSACRALE SACRO COCCIGE COSTE STERNO CLAVICOLA SCAPOLA ADDOME DITO DITA ALLUCE CALCAGNO EMITORACE SENI PARANASALI ORTOPANORAMICA "
    + "MANDIBOLA ORBITE CHEST FOOT HAND WRIST ELBOW SHOULDER KNEE ANKLE HIP PELVIS SKULL SPINE ABDOMEN PA AP LL LAT LATERALE LATERAL DP OBL "
    + "OBLIQUA OBLIQUE ASSIALE AXIAL DX SX BIL BILATERALE DESTRO DESTRA SINISTRO SINISTRA IN PIEDI CLINO SUPINO SOTTO CARICO PROIEZIONE "
    + "PROIEZIONI DUE TRE T W").split(" "));
  // \u00ab4 DX - W Torace PA\u00bb: il numero della serie, la modalit\u00e0 DICOM, la descrizione
  const SERIE_RE = /^(\d{1,4})(\s+)([A-Z]{2,4})(\s+-\s+)(.+)$/;
  const MODALITA = new Set("CR DX CT MR US MG XA RF NM PT OT SC DR IO PX RG ES SR KO PR SEG DOC AU ECG XC GM BMD OP OPT IVUS".split(" "));
  // un nome DICOM: COGNOME^NOME^\u2026 (parole in maiuscolo, o con l'iniziale grande)
  const PAROLA_MAI = "[A-Z\u00c0-\u00d9][A-Z\u00c0-\u00d9'\u2019-]*";
  const COMP_DICOM = `(?:${PAROLA_MAI}(?: ${PAROLA_MAI})*|[A-Z\u00c0-\u00d9][a-z\u00e0-\u00ff'\u2019-]+)`;
  const NOME_DICOM_RE = new RegExp(`(?<![A-Za-z\u00c0-\u00ff0-9^])(?:${COMP_DICOM})\\^(?:${COMP_DICOM})(?:\\^(?:${COMP_DICOM})?){0,3}(?![A-Za-z\u00c0-\u00ff0-9^])`, "g");
  // un UID DICOM (studio, serie, istanza): cifre a punti; quelli dello standard (1.2.840.10008.\u2026) restano
  const UID_RE = /(?<![\w.])[0-2](?:\.(?:0|[1-9]\d*)){4,}(?!\w|\.\d)/g;
  const UID_STANDARD = /^1\.2\.840\.10008\./;
  // una data DICOM: AAAAMMGG
  const DA_RE = /(?<![\d.])((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d|\.\d)/g;
  // un gettone (l'\u00abaccount\u00bb dell'indirizzo, una sessione): esadecimale lungo, base64, JWT
  const tokenLike = (v) => {
    v = String(v || "");
    return (/^[0-9a-f]{16,}$/i.test(v) && /\d/.test(v) && /[a-f]/i.test(v))
      || (/^[A-Za-z0-9+/_-]{24,}={0,2}$/.test(v) && (v.match(/\d/g) || []).length >= 3 && /[a-z]/.test(v) && /[A-Z]/.test(v))
      || /^[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/.test(v);
  };
  // i parametri degli indirizzi del visualizzatore: segreti (il valore via), identificativi, tecnici (restano)
  const VIEWER_SEGRETO = /account|token|session|^sid$|auth|key|ticket|jwt|sig(?:nature)?$|hash|nonce|secret|cred|pass|pwd|otp|^code$/i;
  const VIEWER_NOME = /name$|^(?:nome|cognome|paziente)$/i;
  const VIEWER_ID = /accession|uid$|^(?:study|series|object|instance|sop|image|exam|order|req(?:uest)?|patient|pat)_?(?:id|uid|number|num|nr|no)?$|^(?:pid|mrn|id)$/i;
  const VIEWER_TECNICO = /^(?:requestType|contentType|transferSyntax|frameNumber|frame|rows|columns|cols|imageQuality|quality|region|windowCenter|windowWidth|annotation|charset|anonymize|format|layer|level|zoom|scale|size|width|height|w|h|x|y|mode|type|view|lang|language|locale|theme|layout|tool|tab|page|thumb|thumbnail|preview|version|v)$/i;
  const VIEWER_CACHEBUSTER = /^(?:_|ts|t|cb|cache|nocache|rnd|rand|random|time|timestamp)$/i;
  // le chiavi DICOM in un JSON o in uno script della pagina (per nome o per numero di tag)
  const CHIAVI_DICOM = [
    [/^(?:patient_?s?_?name|00100010)$/i, "nome"], [/^(?:patient_?id|other_?patient_?ids|00100020|00101000|study_?id|00200010)$/i, "id"],
    [/^(?:patient_?s?_?birth_?date|birth_?date|dob|00100030)$/i, "nascita"], [/^(?:accession_?number|00080050)$/i, "accesso"],
    [/^(?:referring_?physician_?s?_?name|performing_?physician_?s?_?name|operators?_?s?_?name|name_?of_?physicians?_?reading_?study|00080090|00081050|00081070|00081060)$/i, "personale"],
  ];
  const CHIAVE_VALORE_RE = /["']?([A-Za-z_]{3,40}|\d{8})["']?\s*[:=]\s*(?:\{[^{}]{0,80}?["']Value["']\s*:\s*\[\s*(?:\{\s*["']Alphabetic["']\s*:\s*)?)?["']([^"'\\]{1,80})["']/g;
  const catChiave = (k) => { for (const [re, c] of CHIAVI_DICOM) if (re.test(k)) return c; return null; };
  // dei nomi DICOM trovati in un testo: dove stanno e le loro parti (senza le parole d'etichetta prese per sbaglio)
  function nomiDicom(t) {
    const out = [];
    for (const m of String(t).matchAll(NOME_DICOM_RE)) {
      let inizio = m.index, fine = m.index + m[0].length;
      const comps = m[0].split("^");
      let w = comps[0].split(" ");
      while (w.length > 1 && VIEWER_PAROLE_ETI.has(MAIUSCm(w[0]))) { inizio += w[0].length + 1; w = w.slice(1); }
      comps[0] = w.join(" ");
      const u = comps.length - 1;
      w = comps[u].split(" ");
      while (w.length > 1 && VIEWER_PAROLE_ETI.has(MAIUSCm(w[w.length - 1]))) { fine -= w[w.length - 1].length + 1; w = w.slice(0, -1); }
      comps[u] = w.join(" ");
      if (comps[0].length >= 2 && comps[1].length >= 2) out.push({ inizio, fine, comps });
    }
    return out;
  }
  // i campi dei moduli del SISS (formcontrolname, name o id), e che dato portano
  const SISS_CAMPI = [
    [/^(patientLastName|lastName|cognome\w*|surname|familyName)$/i, "cognome"], [/^(patientFirstName|firstName|nome|givenName)$/i, "nome"],
    [/^(idCard|idPersonale|personalId|codiceFiscale|fiscalCode|cf|taxCode)$/i, "cf"], [/^(idSsn|tessera\w*|team\w*|ssn|cardNumber)$/i, "tessera"],
    [/^(birthDate|dataNascita|dateOfBirth|dob)$/i, "nascita"],
    [/^(paiCounter|protocolNumber|protocollo\w*|nre|prescriptionNumber|authCode|authenticationCode|codiceAutenticazione|pinRicetta|idMpi|mpi)$/i, "id"],
    [/^(diagnosticQuestionText|quesito\w*Testo|note\w*|\w*Notes?|treatmentNotes?)$/i, "libero"], [/^(quantity|quantita\w*)$/i, "numero"],
  ];
  const campoSiss = (n) => { for (const [re, c] of SISS_CAMPI) if (re.test(n || "")) return c; return null; };
  // il vocabolario del catalogo: farmaci (AIC e descrizione), prestazioni, esenzioni
  const AIC_RE = /^0\d{8}$/;
  const FARMACO_RE = /^(?:0\d{8}\s+)?[A-Z0-9][A-Z0-9 *+.,'%/()-]{2,90}$/;
  const FARMACO_SEGNO = /\*|\d(?:[.,]\d+)?\s?(?:MG|MCG|G|ML|UI|%)(?![A-Z])|(?<![A-Z])(?:CPR|CPS|BUST|FL|FLAC|SCIR|GTT|COMPR|CAPS|SOSP|OS|IM|EV|SC|RIV|INIET|SIR|CREMA|POM|GEL|SUPP|FIALE?|CP)(?![A-Z])/;
  const PRESTAZIONE_RE = /^\d{2}\.\d{1,2}(?:\.\d{1,2})?(?:\.[A-Z0-9]{1,3})?(?:\s*[-–]?\s*[A-Z][A-Z0-9 ,.'()/+-]{2,90})?$/;
  const ESENZIONE_RE = /^(?:E\d{2}|\d{3}(?:\.\d{1,4})?|[A-Z]{1,2}\d{2,4}|0[A-Z]\d{2}|RF\d{4})$/;
  const NRE_RE = /(?<![A-Z0-9])\d{4}[A-Z]\d{10}(?![A-Z0-9])/g;

  const COGNOMI = ["ROSSI", "BIANCHI", "COLOMBO", "RICCI", "MARINO", "GRECO", "BRUNO", "GALLO", "CONTI", "COSTA",
    "GIORDANO", "MANCINI", "RIZZO", "LOMBARDI", "MORETTI", "BARBIERI", "FONTANA", "SANTORO", "MARIANI", "RINALDI"];
  const NOMI = ["MARIO", "ANNA", "LUIGI", "GIULIA", "PAOLO", "SARA", "MARCO", "ELENA", "LUCA", "CHIARA", "ANDREA",
    "FRANCESCA", "GIORGIO", "MARTA", "STEFANO", "LAURA"];
  const PAROLE = ["paziente", "esempio", "reparto", "controllo", "valore", "esame", "scheda", "nota", "dato", "campo", "voce", "prova"];
  const FRASI = [
    "Paziente vigile e collaborante, parametri nella norma.",
    "Riferito benessere, nessun sintomo in atto al momento della visita.",
    "Dato di esempio: il contenuto reale è stato rimosso.",
    "Rilievo clinico di esempio, senza alcun valore diagnostico.",
    "Testo dimostrativo inserito al posto del contenuto originale.",
    "Nessuna terapia in corso segnalata in questa scheda di esempio.",
  ];
  const CF_FINTO = (n) => `ESMPIO80A01Z${String(n).padStart(3, "0")}X`;   // forma di CF, riconoscibile come finto
  const FINTO_CF = /^ESMPIO80A01Z\d{3}X$/;

  // --------------------------------------------------------- strumenti
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
  const pick = (arr, s) => arr[hash(s) % arr.length];
  const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", agrave: "à", egrave: "è", eacute: "é", igrave: "ì",
    ograve: "ò", ugrave: "ù", Agrave: "À", Egrave: "È", Eacute: "É", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù", deg: "°", euro: "€",
    middot: "·", laquo: "«", raquo: "»", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", hellip: "…", copy: "©" };
  const decodifica = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return m; } }
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
  const escTesto = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\u00a0/g, "&nbsp;");
  const escAttr = (s) => escTesto(s).replace(/"/g, "&quot;");
  const pulisci = (s) => String(s).replace(/\u00a0/g, " ");
  const MAIUSC = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  // per confrontare: maiuscolo, senza accenti, ogni separatore uno spazio
  const norma = (s) => " " + MAIUSC(s).replace(/[^A-Z0-9]+/g, " ").trim() + " ";

  // Un testo come lo legge il cancello: entità (&#210;, &Ograve;, &amp;) e %XX
  // (UTF-8, o latin1 se non lo è: %C3%92 e %D2 sono la stessa «Ò») decodificati,
  // poi le parole — maiuscole, senza accenti, ogni altro segno un separatore.
  // Con `conPosti` ogni parola porta anche dove sta nel testo ORIGINALE: la
  // ripulitura finale cerca e sostituisce con la stessa lettura, e quello che il
  // cancello vede, lei lo trova (stesso punto di vista, non due regex diverse).
  const ENT_PERC_RE = /&(?:#x[0-9a-f]+|#\d+|[a-z]+);|(?:%[0-9A-F]{2})+/gi;
  function lettura(src, conPosti = false) {
    const s = String(src);
    let d = s, a = null, b = null;
    if (/&(?:#|[a-z])|%[0-9A-F]{2}/i.test(s)) {
      d = ""; a = []; b = [];
      const metti = (t, i, j) => { for (let k = 0; k < t.length; k++) { d += t[k]; if (conPosti) { a.push(i); b.push(j); } } };
      let ultimo = 0, m;
      ENT_PERC_RE.lastIndex = 0;
      const letterali = (da, fino) => { if (fino > da) { if (conPosti) for (let i = da; i < fino; i++) metti(s[i], i, i + 1); else d += s.slice(da, fino); } };
      while ((m = ENT_PERC_RE.exec(s))) {
        letterali(ultimo, m.index);
        ultimo = ENT_PERC_RE.lastIndex;
        if (m[0][0] === "&") { metti(decodifica(m[0]), m.index, ultimo); continue; }
        const by = m[0].split("%").slice(1).map((x) => parseInt(x, 16));
        let k = 0, pos = m.index;
        while (k < by.length) {
          let n = 1, ch = String.fromCharCode(by[k]);
          const len = by[k] >= 0xF5 ? 1 : by[k] >= 0xF0 ? 4 : by[k] >= 0xE0 ? 3 : by[k] >= 0xC2 ? 2 : 1;
          if (len > 1 && k + len <= by.length && by.slice(k + 1, k + len).every((x) => (x & 0xC0) === 0x80)) {
            const cp = len === 2 ? ((by[k] & 0x1F) << 6) | (by[k + 1] & 0x3F)
              : len === 3 ? ((by[k] & 0x0F) << 12) | ((by[k + 1] & 0x3F) << 6) | (by[k + 2] & 0x3F)
              : ((by[k] & 0x07) << 18) | ((by[k + 1] & 0x3F) << 12) | ((by[k + 2] & 0x3F) << 6) | (by[k + 3] & 0x3F);
            if (cp >= 0x80 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF)) { ch = String.fromCodePoint(cp); n = len; }
          }
          metti(ch, pos, pos + 3 * n);
          pos += 3 * n; k += n;
        }
      }
      letterali(ultimo, s.length);
    }
    const parole = [];
    let cur = null;
    for (let i = 0; i < d.length; i++) {
      const c = d.charCodeAt(i);
      let g;
      if (c < 128) g = c >= 97 && c <= 122 ? String.fromCharCode(c - 32) : (c >= 65 && c <= 90) || (c >= 48 && c <= 57) ? d[i] : null;
      else { g = MAIUSC(d[i]); if (g === "") continue; if (!/^[A-Z0-9]+$/.test(g)) g = null; }     // (un segno combinante non spezza la parola)
      if (g == null) { cur = null; continue; }
      if (!cur) { cur = { w: "", da: a ? a[i] : i, a: 0 }; parole.push(cur); }
      cur.w += g;
      cur.a = b ? b[i] : i + 1;
    }
    return { d, parole };
  }

  const CF_RE = /(?<![A-Za-z0-9])[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z](?![A-Za-z0-9])/g;
  // un codice fiscale con le cifre coperte («VRDCRL50C12F###Z»): nome, nascita e sesso ci sono ancora
  const CF_PARZ_RE = /(?<![A-Za-z0-9#*])(?=[A-Z0-9]*[#*])[A-Z]{6}[\d#*]{2}[A-Z][\d#*]{2}[A-Z][\d#*]{3}[A-Z](?![A-Za-z0-9#*])/g;
  const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  const TEL_RE = [
    /(?:\+39[\s.]?)?(?<![\d])3\d{2}[\s.-]?\d{6,7}(?!\d)/g,                       // cellulare
    /(?<![\d/])0\d{1,3}[\s./-]\d{5,8}(?![\d/])/g,                                  // fisso, con separatore
    /(?:\btel\.?|\btelefono|\bcell\.?|\bcellulare|\brecapito|\bfax)\s*:?\s*(\+?\d[\d\s./-]{5,16}\d)/gi,
  ];
  const TESSERA_RE = [/(?<!\d)80\d{18}(?!\d)/g, /(?:[Tt]essera(?:\s+[Ss]anitaria)?|TESSERA(?:\s+SANITARIA)?|\bT\.S\.|\bTEAM)\s*(?:n\.?|nr\.?|N\.?|:)?\s*((?=[A-Z0-9]*\d{6})[A-Z0-9]{8,20})\b/g];
  // un indirizzo: la via col suo nome (con la maiuscola) e il numero civico —
  // «per via orale» e «terapia in corso» no
  const PAROLA_VIA = "(?:(?:d[aei]|del|della|dello|dei|degli|delle|d['’])\\s*)?[A-ZÀ-Ù][\\wÀ-ÿ'’.]*";
  const INDIRIZZO_RE = new RegExp(`\\b(?:[Vv]ia|VIA|[Vv]iale|VIALE|[Vv]\\.le|[Pp]iazza|PIAZZA|[Pp]\\.zza|[Pp]\\.za|[Pp]iazzale|PIAZZALE|[Cc]orso|CORSO|[Cc]\\.so|[Ll]argo|LARGO|[Vv]icolo|VICOLO|[Ss]trada|STRADA)\\s+(?:${PAROLA_VIA}\\s+){0,4}${PAROLA_VIA},?\\s*(?:n\\.?\\s*)?\\d{1,4}\\s?[a-zA-Z]?(?![\\w/])`, "g");
  const CAP_RE = /(?<!\d)\d{5}\s+[A-ZÀ-Ù][A-Za-zÀ-ÿ' ]{1,30}\s*\(\s*[A-Z]{2}\s*\)/g;
  const IP_RE = /\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
  const DATA_RE = /(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\d/])/g;
  const ISO_RE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?=$|[T\s"'<.,;:)]|$)/g;
  const NOSO_RE = /(?<![\w/])((?:PS-)?20\d{2})\/(\d{3,7})(?![\w/])/g;
  const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  // un nome preceduto da chi è: «Sig. ROSSI MARIO», «Paziente: …», «Dott. Bianchi» — la
  // parola chiave in minuscolo, Maiuscola o MAIUSCOLO; il nome sempre con le iniziali grandi
  const KW = ["sig.ra", "sig.", "sig", "signora", "signore", "signor", "paziente", "pz.", "assistito", "assistita", "nominativo",
    "cognome e nome", "cognome", "medico", "dott.ssa", "dott.", "dott", "dr.ssa", "dr.", "dr", "prof.ssa", "prof.", "prof", "inf.",
    "infermiere", "infermiera", "operatore"];
  const kwRe = (w) => { const e = w.replace(/\./g, "\\."); return `[${e[0].toUpperCase()}${e[0]}]${e.slice(1)}|${e.toUpperCase()}`; };
  const NOME_KW = new RegExp(`(?<![A-Za-zÀ-ÿ])(?:(?:${KW.map(kwRe).join("|")}|[Cc]onnesso come(?:[^:]{0,30}:)?)(?![A-Za-zÀ-ÿ])\\s*:?\\s*)+([A-ZÀ-Ù][A-Za-zÀ-ÿ'’]+(?:\\s+[A-ZÀ-Ù][A-Za-zÀ-ÿ'’]+){0,3})`, "g");
  const KW_PERSONALE = /dott|dr\b|dr\.|prof|inf|medico|operatore|connesso/i;
  const NATO_RE = /([A-ZÀ-Ù][A-ZÀ-Ù'’]+(?:\s+[A-ZÀ-Ù][A-ZÀ-Ù'’]+){1,3})\s*,?\s*nat[oa]\b/g;
  const haCF = (t) => { CF_RE.lastIndex = 0; const r = CF_RE.test(t); CF_RE.lastIndex = 0; return r; };
  const haEmail = (t) => { EMAIL_RE.lastIndex = 0; const r = EMAIL_RE.test(t); EMAIL_RE.lastIndex = 0; return r; };
  const isExam = (s) => /^\d+-\d+\s+\S/.test(String(s).trim());
  const soloPunteggiatura = (t) => /^[\s|·•\-–—:/,.;()[\]*+_=#!?'"«»°%&]+$/.test(t);

  // ----------------------------------------- aree, risorse, etichette
  // Il vocabolario delle AREE del PS (funzione «aree»): gli id di risorsa
  // (`00010001P`), i nomi delle aree («AREA ALTA INTENSITA'», «CODICI MINORI»,
  // «FAST TRACK», «OBI…») e i colori del triage. Restano anche se compaiono una
  // volta sola: non sono di nessun paziente. Hanno la forma di un nome (due
  // parole in maiuscolo) o di una sigla utente (ROSSO, AZZURRO): senza questo
  // elenco diventerebbero un nome finto.
  const RISORSA_RE = /^\d{8}P$/;
  const COLORI_TRIAGE = /^(?:CODICE\s+)?(?:ROSSO|ARANCIONE|AZZURRO|VERDE|BIANCO|GIALLO|NERO|BLU)$/i;
  const OBI_PAROLE = /^(?:\d+|[A-Z]*(?:ICA|ICO|IVA|ALE|ILE)|BREVE|DI|E|A|IN|PS|OBI|AREA|CODICI|MINORI|FAST|TRACK)$/;
  const areaVoce = (s) => {
    const t = String(s).replace(/ /g, " ").trim().replace(/\s*\(\s*\d+\s*\)$/, "");
    if (!t || t.length > 60) return false;
    if (RISORSA_RE.test(t) || COLORI_TRIAGE.test(t)) return true;
    if (!/^[A-Za-zÀ-ÿ0-9 '’.,/()+-]+$/.test(t) || t.split(/\s+/).length > 7) return false;
    const MAI = !/[a-z]/.test(t);
    if (/^(?:fast\s+track|codici\s+minori)\b/i.test(t) || (MAI && /\b(?:CODICI\s+MINORI|FAST\s+TRACK)\b/.test(t))) return true;
    if (MAI) {
      if (/^AREA\s+\S/.test(t) || /INTENSIT[AÀ]/.test(t)) return true;
      if (/\bOBI\b/.test(t)) return t.split(/[^A-ZÀ-Ù0-9']+/).filter(Boolean).every((w) => OBI_PAROLE.test(w));
      return false;
    }
    return /^Area(?:\s+(?:[A-ZÀ-Ù][\wÀ-ÿ'’.]*|-|e|di|a))+$/.test(t);
  };
  // I select che portano risorse, aree, percorsi, servizi: le loro voci sono
  // il vocabolario del programma (mai personale: USERNAME & co. no).
  const SELECT_STRUTTURA = /^(?:s_)?(?:RISORSA_ID|RISORSE|PERCORSO|LINEA_ATTIVITA|SERVIZIO_ID|AREA|AREA_ID)$/i;
  // Un indirizzo di sola navigazione: MVPG (o ccsForm) e parametri della macchina,
  // nessun caso, nessuna persona.
  const soloNavigazione = (u) => {
    const ind = String(u || "").replace(/&amp;/g, "&").match(/[^'"\s()]*MVPG=[^'"\s()]*/gi);
    if (!ind) return false;
    for (const x of ind) for (const pp of x.split(/[?&;]/)) {
      const i = pp.indexOf("=");
      if (i < 0 || i === pp.length - 1) continue;
      const K = pp.slice(0, i).toUpperCase();
      if (STRUTTURA.has(K) || /^(?:MVPG|CCSFORM|TOPAGE|RETURNPAGE|HOMEPAGE)$/.test(K) || /(?:ORDER|DIR)$/.test(K)) continue;
      return false;
    }
    return true;
  };

  // ------------------------------------------------------- HTML a pezzi
  const TAG_RE = /<(\/?)([a-zA-Z][^\s/>]*)((?:\s*[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/y;
  const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const CORPI = new Set(["script", "style", "textarea", "title", "xmp", "noscript"]);
  function pezzi(html) {
    const out = [];
    let i = 0;
    const n = html.length;
    while (i < n) {
      const lt = html.indexOf("<", i);
      if (lt < 0) { out.push({ k: "testo", s: html.slice(i) }); break; }
      if (lt > i) out.push({ k: "testo", s: html.slice(i, lt) });
      if (html.startsWith("<!--", lt)) { const e = html.indexOf("-->", lt + 4); i = e < 0 ? n : e + 3; continue; }   // i commenti non viaggiano
      if (/^<[!?]/.test(html.slice(lt, lt + 2))) {
        const e = html.indexOf(">", lt);
        const s = html.slice(lt, e < 0 ? n : e + 1);
        if (/^<!doctype/i.test(s)) out.push({ k: "doctype", s });
        i = e < 0 ? n : e + 1; continue;
      }
      TAG_RE.lastIndex = lt;
      const m = TAG_RE.exec(html);
      if (!m) { out.push({ k: "testo", s: "&lt;" }); i = lt + 1; continue; }
      i = lt + m[0].length;
      const nome = m[2].toLowerCase();
      if (m[1]) { out.push({ k: "fine", nome }); continue; }
      const attrs = [];
      ATTR_RE.lastIndex = 0;
      let a;
      while ((a = ATTR_RE.exec(m[3]))) attrs.push({ k: a[1], v: a[2] ?? a[3] ?? a[4], c: a[2] == null && a[3] == null && a[4] == null });
      out.push({ k: "tag", nome, attrs, chiuso: !!m[4] });
      if (CORPI.has(nome) && !m[4]) {
        const re = new RegExp(`</${nome}\\s*>`, "ig");
        re.lastIndex = i;
        const e = re.exec(html);
        out.push({ k: "corpo", nome, s: html.slice(i, e ? e.index : n) });
        if (e) { out.push({ k: "fine", nome }); i = e.index + e[0].length; } else i = n;
      }
    }
    return out;
  }

  // ------------------------------------------------- JavaScript a pezzi
  // Solo quanto serve: commenti via, letterali stringa fuori a uno a uno.
  function pezziJs(js, fn) {
    let out = "", i = 0;
    const n = js.length;
    while (i < n) {
      const c = js[i], d = js[i + 1];
      if (c === "/" && d === "*") { const e = js.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; out += " "; continue; }
      if (c === "/" && d === "/" && !/[:\\]$/.test(out)) { const e = js.indexOf("\n", i); i = e < 0 ? n : e; continue; }
      if (c === "'" || c === "\"" || c === "`") {
        let j = i + 1, s = "";
        while (j < n && js[j] !== c) { if (js[j] === "\\" && j + 1 < n) { s += js[j] + js[j + 1]; j += 2; } else { if (c !== "`" && js[j] === "\n") break; s += js[j++]; } }
        out += c + fn(s) + c;
        i = j + 1; continue;
      }
      out += c; i++;
    }
    return out;
  }

  // ======================================================================
  function anonimizza(raccolta, opz = {}) {
    const voc = opz.vocabolario || {};
    const STATICO = new Set((voc.testi || []).map((s) => pulisci(s).trim()));
    const PAROLE_STATICHE = new Set((voc.parole || []).map((s) => MAIUSC(s)));
    const CODICI = new Set((voc.codici || []).map(String));
    const ICONE = new Set(voc.icone || []);
    const origini = raccolta.origini || {};
    const gestionale = origini.gestionale || "https://smarthealth.multimedica.it";
    const portali = new Set([origini.portale, ...(origini.altri || [])].filter(Boolean));
    const inizio = Number(raccolta.inizio) || Date.now();
    const annoRif = new Date(inizio).getFullYear();
    // di quanti giorni si spostano le date recenti: uno a caso per registrazione,
    // non scritto da nessuna parte (opz.sfasamento solo per i test)
    const sfasamento = Number.isFinite(opz.sfasamento) ? opz.sfasamento : 20 + Math.floor(Math.random() * 40);

    const conta = { nomi: 0, personale: 0, cf: 0, nascita: 0, tessere: 0, telefoni: 0, indirizzi: 0, email: 0, liberi: 0, id: 0, testo: 0, url: 0, tenute: 0, immagini: 0 };
    // il vero visto, per il cancello: categoria → Set(stringhe originali)
    const visto = { nomi: new Set(), personale: new Set(), cf: new Set(), nascita: new Set(), tessere: new Set(), telefoni: new Set(), email: new Set(), id: new Set() };

    // il SISS: le sue pagine (e i suoi PDF) hanno un vocabolario loro, e dati loro
    const sissOrig = new Set([...(origini.siss || []), ...Object.keys(SISS_ORIGINI)]);
    const isSiss = (u) => { try { return sissOrig.has(new URL(String(u)).origin); } catch { return false; } };
    let sissOra = false;                   // si sta trattando una pagina, o un PDF, del SISS
    const codiciSiss = new Set();          // AIC dei farmaci: codici, non casi
    const catalogoSiss = new Set();        // la descrizione accanto a un codice (farmaco, prestazione)
    const parolePersona = new Map();       // MAIUSC(parola) → { pieno, i, cognome }: dal banner del paziente e dai campi
    const SISS_STATICO = new Set(SISS_TESTI);

    // il visualizzatore del PACS: le sue pagine, le sue richieste e i suoi clic hanno regole loro
    const viewerHosts = new Set([VIEWER_HOST, ...(origini.viewer || [])].map((h) => String(h).toLowerCase()));
    const viewerDi = (o) => {   // l'origine finta del visualizzatore (con la sua porta), o null
      try {
        const u = new URL(String(o));
        if (!viewerHosts.has(u.hostname.toLowerCase()) || !/^(?:https?|wss?):$/.test(u.protocol)) return null;
        return `${u.protocol}//${VIEWER_FINTO}${u.port ? ":" + u.port : ""}`;
      } catch { return null; }
    };
    const isViewer = (u) => !!viewerDi((/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(String(u || "")) || [""])[0]);
    let viewerOra = false;                 // si sta trattando una pagina (o un clic) del visualizzatore

    // ------------------------------------------------ chi è chi (unità)
    const paramDi = (u, k) => { const m = new RegExp(`[?&;]${k}=([^&#"'\\s]*)`, "i").exec(u || ""); return m ? decodeURIComponent(m[1]).trim() : ""; };
    const episodiIn = (html) => new Set([...String(html).matchAll(/EPISODIO_ID(?:=|"\s+value=")(\d{3,})/gi)].map((m) => m[1]));

    // ------------------------------------------------ identificativi
    const idFinti = new Map();          // originale → finto
    const idOriginali = new Set();
    let idN = 0;
    const registraId = (v) => {
      v = String(v || "").trim();
      if (!/\d/.test(v)) return;                             // senza cifre non è il numero di un caso
      if (!v || v.length < 5 || CODICI.has(v) || codiciSiss.has(v) || RISORSA_RE.test(v)) return;   // (le risorse sono vocabolario)
      if (/^\d+$/.test(v) && v.length < 5) return;          // un progressivo, una risorsa: non un caso
      if (/^\d+$/.test(v) && Number(v) === 0) return;
      idOriginali.add(v);
    };
    const fintoId = (v) => {
      if (idFinti.has(v)) return idFinti.get(v);
      let f;
      do {
        idN++;
        if (/^\d+$/.test(v)) f = "9" + String(idN).padStart(v.length - 1, "0");
        else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) f = `0000e5e0-0000-4000-8000-${String(idN).padStart(12, "0")}`;
        else {
          const cif = String(idN).padStart((v.match(/\d/g) || []).length, "0");
          let di = 0, li = 0;
          const L = "ESEMPIO";
          f = v.replace(/[0-9]|[A-Za-z]/g, (ch) => (/\d/.test(ch) ? cif[di++] || "0"
            : (ch === ch.toUpperCase() ? L[li++ % L.length] : L[li++ % L.length].toLowerCase())));
          if (!/\d/.test(v)) f = f + idN;
        }
      } while (idOriginali.has(f) || f === v);
      idFinti.set(v, f);
      return f;
    };
    // i numeri del SISS (NRE, codice di autenticazione, protocollo, contatore
    // PAI, Id MPI, tessera): casi anche se corti, sempre rimappati
    const registraSegreto = (v) => {
      v = String(v || "").trim();
      if (v.length < 4 || v.length > 40 || !/\d/.test(v) || codiciSiss.has(v) || CODICI.has(v)) return;
      idOriginali.add(v);
    };
    const remapId = (v) => { const t = String(v); if (!t) return t; registraId(t); if (!idOriginali.has(t)) return t; conta.id++; visto.id.add(t); return fintoId(t); };
    // le cifre lunghe di un testo che sono identificativi già visti
    const remapCifre = (s) => String(s).replace(/(?<!\d)\d{5,}(?!\d)/g, (d) => (idOriginali.has(d) ? (conta.id++, visto.id.add(d), fintoId(d)) : d))
      .replace(UUID_RE, (u) => (idOriginali.has(u) ? (conta.id++, visto.id.add(u), fintoId(u)) : u));

    // --------------------------------------------------- vocabolario
    const testi = new Map();   // stringa → Set(unità)
    const osservaStringa = (s, unita) => {
      const k = pulisci(s).trim();
      if (!k || k.length > 400) return;
      if (!testi.has(k)) testi.set(k, new Set());
      if (unita) testi.get(k).add(unita);
    };

    // ------------------------------------------ le etichette del programma
    // Le parole che il programma mette su pulsanti, linguette, intestazioni di
    // colonna, voci di select (aree, percorsi, servizi): non di un paziente, e
    // non nomi di persona anche quando hanno due parole con le iniziali grandi
    // («Linea Attività», «Fast Track», «Elenco Smart»). Si riconoscono dal
    // posto (un link di sola navigazione, un'intestazione, la voce di un select
    // di risorse) e dal nome che il programma gli ha già dato nella pagina (il
    // campo LINEA_ATTIVITA, l'icona elenco_smart.png).
    const ETI = new Set(), STRUT = new Set();
    const chiaveEti = (t) => norma(String(t).replace(/\s*\(\s*\d+\s*\)\s*$/, "").replace(/\s*\*\s*$/, ""));
    const etichetta = (t) => { const k = chiaveEti(pulisci(t)); return k.trim().length >= 3 && (ETI.has(k) || STRUT.has(k)); };

    // ------------------------------------------------------- persone
    const nomiVisti = new Map();     // NORMA(originale) → { cat: "nomi"|"personale", orig }
    const paroleDiNomi = new Set();
    // (mentre si leggono i testi liberi, le persone trovate solo lì vanno qui: si sostituiscono solo nei testi)
    let nomiLocali = null;
    const registraNome = (s, cat) => {
      const t = pulisci(s).replace(/\s+/g, " ").trim();
      if (t.length < 4 || !/\s/.test(t) && cat !== "personale") return;
      if (MARCHI.some((re) => re.test(t))) return;
      if (sissOra && (SISS_STATICO.has(t) || tuttoSiss(t))) return;
      const k = norma(t);
      if (nomiLocali && nomiVisti.has(k)) return;   // (già una persona di tutto lo zip)
      const dove = nomiLocali || nomiVisti;
      const prima = dove.get(k);
      if (!prima || (prima.cat === "nomi" && cat === "personale")) dove.set(k, { cat, orig: t });
      for (const w of MAIUSC(t).split(/[^A-Z']+/)) if (w.length >= 2) paroleDiNomi.add(w);
    };
    const paroleApp = (t) => PAROLE_APP.test(MAIUSC(t));
    const tutteStatiche = (t) => MAIUSC(t).split(/[^A-Z0-9']+/).filter(Boolean).every((w) => PAROLE_STATICHE.has(w));
    // COGNOME NOME in maiuscolo, o Nome Cognome con le iniziali: non frasi del programma
    const formaNome = (s) => {
      const t = pulisci(s).trim();
      if (areaVoce(t) || etichetta(t)) return false;     // un'area, un'etichetta del programma: non una persona
      if (/^[A-ZÀ-Ù'’]+(?:\s+[A-ZÀ-Ù'’]+){1,3}$/.test(t)) return !paroleApp(t) && !tutteStatiche(t);
      if (/^[A-ZÀ-Ù][a-zà-ÿ'’]+(?:\s+[A-ZÀ-Ù][a-zà-ÿ'’]+){1,2}$/.test(t)) return !paroleApp(t) && !MAIUSC(t).split(/\s+/).some((w) => PAROLE_STATICHE.has(w));
      return false;
    };
    const utente = (t) => /^[A-Z]{5,7}$/.test(t) && !areaVoce(t) && !PAROLE_STATICHE.has(t) && !paroleApp(t) && !STATICO.has(t);
    const negato = (t) => MARCHI.some((re) => re.test(t)) || formaNome(t) || utente(t) || haCF(t);
    const vocabolo = (s) => {
      const k = pulisci(s).trim();
      if (!k) return true;
      if (negato(k) || nomiVisti.has(norma(k))) return false;
      if (STATICO.has(k) || isExam(k) || CODICI.has(k) || areaVoce(k) || etichetta(k)) return true;
      const u = testi.get(k);
      return !!u && u.size >= 2;
    };

    // ------------------------------------------- le scoperte (prima passata)
    // i dati che si sostituiscono per quello che sono (codici fiscali, email, telefoni, tessere, date, numeri)
    const scopriValori = (t) => {
      for (const m of t.matchAll(CF_RE)) if (!FINTO_CF.test(m[0])) visto.cf.add(m[0]);
      for (const m of t.matchAll(EMAIL_RE)) if (!/@esempio\.it$/i.test(m[0])) visto.email.add(m[0]);
      for (const re of TEL_RE) for (const m of t.matchAll(re)) { const v = (m[1] || m[0]).trim(); if ((v.match(/\d/g) || []).length >= 7) visto.telefoni.add(v); }
      for (const re of TESSERA_RE) for (const m of t.matchAll(re)) { const v = (m[1] || m[0]).trim(); if (/\d/.test(v)) visto.tessere.add(v); }
      for (const m of t.matchAll(DATA_RE)) { const y = m[4].length === 2 ? 1900 + Number(m[4]) : Number(m[4]); if (m[4].length === 4 && y < annoRif - 1 && valida(m[1], m[3], y)) visto.nascita.add(m[0]); }
      for (const m of t.matchAll(ISO_RE)) { if (Number(m[1]) < annoRif - 1 && valida(m[3], m[2], Number(m[1]))) visto.nascita.add(m[0]); }
      for (const m of t.matchAll(NOSO_RE)) registraId(m[0]);
      for (const m of t.matchAll(NRE_RE)) registraSegreto(m[0]);
    };
    // le persone dette per quello che sono: «Sig. …», «Paziente: …», «ROSSI MARIO nato…»
    const scopriPersone = (t) => {
      for (const m of t.matchAll(NOME_KW)) {
        const nome = m[1].trim();
        if (!paroleApp(nome) && !tutteStatiche(nome) && !/^(il|la|lo|gli|le|un|una|del|della|di|da|in|con|per|non|nel|nella|e|ed|al|alla)\b/i.test(nome)) registraNome(nome, KW_PERSONALE.test(m[0]) ? "personale" : "nomi");
      }
      for (const m of t.matchAll(NATO_RE)) if (formaNome(m[1])) registraNome(m[1], "nomi");
    };
    const scopri = (s) => {
      const t = pulisci(s);
      if (!t.trim()) return;
      scopriValori(t);
      scopriPersone(t);
      const k = t.trim();
      if (k.length <= 80) {
        if (formaNome(k)) registraNome(k, "nomi");
        else for (const pezzo of k.split(/\s[-–—|·•:/]\s|[|·•;,()]/)) if (formaNome(pezzo)) registraNome(pezzo, "nomi");
      }
    };
    function valida(d, m, y) { d = Number(d); m = Number(m); return d >= 1 && d <= 31 && m >= 1 && m <= 12 && y > 1880; }

    // ------------------------------------------------------- date
    const p2 = (n) => String(n).padStart(2, "0");
    const dataFinta = (d, m, y, sep, lunghezzaAnno) => {
      const anno = lunghezzaAnno === 2 ? 2000 + Number(y) : Number(y);
      if (anno < annoRif - 1) {               // nascita (o storia lontana): un altro giorno dello stesso anno
        let gg = 1 + (hash(`${d}${m}${y}`) % 28), mm = 1 + (hash(`${y}${m}${d}`) % 12);
        if (gg === Number(d) && mm === Number(m)) gg = gg % 28 + 1;
        conta.nascita++;
        return [gg, mm, anno];
      }
      const t = new Date(Date.UTC(anno, Number(m) - 1, Number(d)));
      t.setUTCDate(t.getUTCDate() - sfasamento);
      return [t.getUTCDate(), t.getUTCMonth() + 1, t.getUTCFullYear()];
    };
    const date = (s) => String(s)
      .replace(DATA_RE, (all, d, sep, m, y) => {
        const anno = y.length === 2 ? 2000 + Number(y) : Number(y);
        if (!valida(d, m, anno)) return all;
        const [gg, mm, aa] = dataFinta(d, m, y, sep, y.length);
        return `${d.length === 2 ? p2(gg) : gg}${sep}${m.length === 2 ? p2(mm) : mm}${sep}${y.length === 2 ? p2(aa % 100) : aa}`;
      })
      .replace(ISO_RE, (all, y, m, d) => {
        if (!valida(d, m, Number(y))) return all;
        const [gg, mm, aa] = dataFinta(d, m, y, "-", 4);
        return `${aa}-${p2(mm)}-${p2(gg)}`;
      });

    // ------------------------------------------------- nomi finti
    const finti = new Map();
    let nN = 0, sN = 0;
    const stile = (orig, finto) => (/[a-zà-ÿ]/.test(orig) ? finto.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : finto);
    const nomeFinto = (orig, cat) => {
      const k = norma(orig);
      const v = nomiVisti.get(k);
      const c = (v && v.cat) || cat || "nomi";
      if (!finti.has(k)) {
        let f;
        if (c === "personale") f = `OPERATORE ${++sN}`;
        else {
          do {
            const i = nN++;
            f = `${COGNOMI[i % COGNOMI.length]} ${NOMI[(i * 7 + Math.floor(i / COGNOMI.length)) % NOMI.length]}`;
          } while (f.split(" ").some((w) => paroleDiNomi.has(w)) && nN < 2000);
        }
        finti.set(k, f);
      }
      conta[c === "personale" ? "personale" : "nomi"]++;
      return stile(orig, finti.get(k));
    };
    const utenteFinto = (orig) => { const k = "U:" + orig; if (!finti.has(k)) finti.set(k, `UTENTE${++sN}`); conta.personale++; return finti.get(k); };

    // ------------------------------------------------------ CF finti
    const cfFinti = new Map();
    const cfFinto = (v) => { if (FINTO_CF.test(v)) return v; if (!cfFinti.has(v)) cfFinti.set(v, CF_FINTO(cfFinti.size + 1)); conta.cf++; return cfFinti.get(v); };

    // ------------------------------------------ testo inventato
    const sintetico = (orig) => {
      const n = orig.length;
      if (n <= 3) return pick(PAROLE, orig).slice(0, Math.max(n, 3));
      if (n < 24) { const w = pick(PAROLE, orig); return n > 12 ? `${w} di esempio` : w; }
      let s = "", i = hash(orig);
      while (s.length < n) s += (s ? " " : "") + FRASI[i++ % FRASI.length];
      s = s.slice(0, n).replace(/\s+\S*$/, "") || s.slice(0, n);
      return /[a-z]/.test(orig) ? s : s.toUpperCase();
    };

    // ------------------------------------- i motivi nel testo che resta
    const motivi = (s) => {
      let t = String(s);
      t = t.replace(CF_RE, (v) => cfFinto(v));
      t = t.replace(CF_PARZ_RE, (v) => cfFinto(v));
      t = t.replace(EMAIL_RE, (v) => (/@esempio\.it$/i.test(v) ? v : (conta.email++, "utente@esempio.it")));
      for (const re of TESSERA_RE) t = t.replace(re, (all, g) => { const v = typeof g === "string" && g ? g : all; if (!/\d/.test(v)) return all; conta.tessere++; return all.replace(v, "0".repeat(v.length)); });
      for (const re of TEL_RE) t = t.replace(re, (all, g) => { const v = typeof g === "string" && g ? g : all; if ((v.match(/\d/g) || []).length < 7) return all; conta.telefoni++; return all.replace(v, v.replace(/\d/g, "0")); });
      t = t.replace(INDIRIZZO_RE, () => { conta.indirizzi++; return "VIA ESEMPIO 1"; });
      t = t.replace(CAP_RE, () => { conta.indirizzi++; return "00000 CITTÀ ESEMPIO (XX)"; });
      t = t.replace(IP_RE, "127.0.0.1");
      t = t.replace(NOSO_RE, (all) => (idOriginali.has(all) ? (conta.id++, visto.id.add(all), fintoId(all)) : all));
      t = t.replace(NRE_RE, (v) => (idOriginali.has(v) ? (conta.id++, visto.id.add(v), fintoId(v)) : v));
      t = remapCifre(t);
      t = date(t);
      return t;
    };
    // un testo intero inventato: per il riepilogo, cosa c'era dentro
    const contaDentro = (s) => {
      const t = String(s);
      const n = (re) => { re.lastIndex = 0; const c = (t.match(re) || []).length; re.lastIndex = 0; return c; };
      conta.cf += n(CF_RE) + n(CF_PARZ_RE); conta.email += n(EMAIL_RE); conta.indirizzi += n(INDIRIZZO_RE);
      for (const re of TEL_RE) conta.telefoni += n(re);
      for (const re of TESSERA_RE) conta.tessere += n(re);
      for (const v of visto.nascita) if (t.includes(v)) conta.nascita++;
      for (const v of nomiVisti.values()) if (MAIUSC(t).includes(MAIUSC(v.orig))) conta[v.cat === "personale" ? "personale" : "nomi"]++;
    };

    // ------------------------------------------------------------ il SISS
    // «Cognome: … Nome: … Sesso: … Data di nascita: …», «Operatore: … Ruolo: …»:
    // le etichette in una riga, e il valore di ognuna fino alla successiva
    const valoriEtichette = (t) => {
      const ms = [...t.matchAll(SISS_ETI_RE)];
      return { pre: ms.length ? t.slice(0, ms[0].index) : t, parti: ms.map((m, i) => {
        const da = m.index + m[0].length, a = i + 1 < ms.length ? ms[i + 1].index : t.length;
        return { cat: catEtichetta(m[1]), inizio: m.index, fineEt: da, fine: a, valore: t.slice(da, a).trim() };
      }) };
    };
    const tuttoSiss = (t) => { const w = MAIUSC(t).split(/[^A-Z0-9]+/).filter(Boolean); return !!w.length && w.every((x) => SISS_PAROLE.has(x)); };
    // il valore che ci si aspetta dopo un'etichetta (su due nodi diversi del DOM)
    const valoreAtteso = (cat, v) => {
      if (!v || SISS_ETI_SOLA.test(v) || SISS_STATICO.has(v)) return false;
      if (/^(cognome|nome|nominativo|operatore)$/.test(cat)) return /^[A-Za-zÀ-ÿ'’. -]{2,60}$/.test(v) && !tuttoSiss(v);
      if (cat === "nascita") return /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$|^\d{4}-\d{2}-\d{2}$/.test(v);
      if (/^(cf|tessera|id)$/.test(cat)) return /^[A-Z0-9][A-Z0-9 /.-]{2,30}$/i.test(v) && /\d/.test(v);
      if (cat === "sesso") return /^[MF]$/i.test(v);
      return v.length <= 80;
    };
    const personaSiss = (cog, nom) => {
      const ok = (x) => /^[A-Za-zÀ-ÿ'’ -]{2,40}$/.test(x) && !tuttoSiss(x);
      cog = ok(cog = pulisci(cog || "").replace(/\s+/g, " ").trim()) ? cog : "";
      nom = ok(nom = pulisci(nom || "").replace(/\s+/g, " ").trim()) ? nom : "";
      if (!cog && !nom) return;
      const pieno = [cog, nom].filter(Boolean).join(" ");
      if (/\s/.test(pieno)) registraNome(pieno, "nomi");
      const nc = cog ? cog.split(" ").length : 0;
      pieno.split(" ").forEach((w, i) => {
        const k = MAIUSC(w);
        if (k.length < 2) return;
        paroleDiNomi.add(k);
        const prima = parolePersona.get(k);
        if (!prima || (!/\s/.test(prima.pieno) && /\s/.test(pieno))) parolePersona.set(k, { pieno, i, cognome: i < nc });
      });
    };
    const finteParole = new Map();
    const parolaFinta = (w) => {
      const e = parolePersona.get(MAIUSC(w));
      if (!e) return w;
      let f = /\s/.test(e.pieno) ? (nomeFinto(e.pieno, "nomi").split(" ")[e.i] || "") : "";
      if (!f) {
        const k = MAIUSC(w);
        if (!finteParole.has(k)) {
          const l = e.cognome ? COGNOMI : NOMI;
          let j = hash(k) % l.length;
          while (paroleDiNomi.has(l[j]) && j < 1e4) j++;
          finteParole.set(k, l[j % l.length]);
        }
        f = finteParole.get(k);
        conta.nomi++;
      }
      return stile(w, MAIUSC(w) === MAIUSC(f) ? "ESEMPIO" : f);
    };
    const parolePersonaFinte = (v) => v.split(/(\s+)/).map((w) => (parolePersona.has(MAIUSC(w)) ? parolaFinta(w) : w)).join("");
    // le scoperte, su un testo del SISS
    const scopriSiss = (raw) => {
      const t = pulisci(raw).replace(/\s+/g, " ").trim();
      if (!t || t.length > 600) return;
      const { parti } = valoriEtichette(t);
      let cog = "", nom = "";
      for (const x of parti) scopriValore(x.cat, x.valore, (c, v) => { if (c === "cognome") cog = v; else nom = v; });
      if (cog || nom) personaSiss(cog, nom);
      // «Elena Rossi Medico»: chi lavora, col suo ruolo
      const r = /^(.+?)\s+(Medico|MEDICO|Infermiere|INFERMIERE|Farmacista|FARMACISTA|Specialista|SPECIALISTA)$/.exec(t);
      if (r && formaNome(r[1])) registraNome(r[1], "personale");
    };
    function scopriValore(cat, v, persona) {
      v = String(v || "").trim();
      if (!v || !valoreAtteso(cat, v)) return;
      if (cat === "cognome" || cat === "nome") persona(cat, v);
      else if (cat === "nominativo") { if (/\s/.test(v)) registraNome(v, "nomi"); personaSiss(v, ""); }
      else if (cat === "operatore") registraNome(v, "personale");
      else if (cat === "cf") { if (/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i.test(v)) visto.cf.add(v.toUpperCase()); else registraSegreto(v); }
      else if (cat === "tessera") { visto.tessere.add(v); registraSegreto(v); }
      else if (cat === "id") registraSegreto(v);
    }
    // da tenere: le parole dell'app e il catalogo (farmaci, prestazioni, esenzioni)
    const tieniSiss = (t) => {
      if (nomiVisti.has(norma(t)) || MARCHI.some((re) => re.test(t)) || haCF(t) || idOriginali.has(t)) return false;
      if (MAIUSC(t).split(/[^A-Z']+/).some((w) => parolePersona.has(w))) return false;
      if (SISS_STATICO.has(t) || catalogoSiss.has(t) || codiciSiss.has(t)) return true;
      if (AIC_RE.test(t) || ESENZIONE_RE.test(t) || PRESTAZIONE_RE.test(t)) return true;
      if (FARMACO_RE.test(t) && FARMACO_SEGNO.test(t)) return true;
      const w = MAIUSC(t).split(/[^A-Z0-9]+/).filter(Boolean);
      if (!w.length) return false;
      // «Prescrittivo Regionale» ha la forma di un nome: allora solo parole del SISS
      const nome = formaNome(t);
      // (un numero già riconosciuto come caso, l'NRE: restano nella frase, e motivi() li sostituisce)
      return w.every((x) => SISS_PAROLE.has(x) || (!nome && PAROLE_STATICHE.has(x)) || /^\d{1,3}(?:GG|G|H|ORE)?$/.test(x) || idOriginali.has(x) || /^\d{4}[A-Z]\d{10}$/.test(x));
    };
    // il valore di un'etichetta, sostituito
    function valoreFinto(cat, v) {
      if (!v) return v;
      if (cat === "cognome" || cat === "nome") return parolePersonaFinte(v);
      if (cat === "nominativo") return nomiVisti.has(norma(v)) ? nomeFinto(v, "nomi") : parolePersona.has(MAIUSC(v)) ? parolePersonaFinte(v) : nomeFinto(v, "nomi");
      if (cat === "operatore") return nomeFinto(v, "personale");
      if (cat === "sesso") return /^[MF]$/i.test(v) ? v : "";
      if (cat === "nascita") { const d = date(v); return d !== v ? d : ""; }
      if (cat === "luogo") { conta.indirizzi++; return "COMUNE ESEMPIO"; }
      if (cat === "cf") { if (/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i.test(v)) return cfFinto(v.toUpperCase()); registraSegreto(v); return idOriginali.has(v) ? remapId(v) : (conta.id++, "ESEMPIO"); }
      if (cat === "tessera" || cat === "id") {
        registraSegreto(v);
        if (cat === "tessera") conta.tessere++;
        return idOriginali.has(v) ? (conta.id++, visto.id.add(v), fintoId(v)) : /\d/.test(v) ? v.replace(/\d/g, "0") : trattaStringa(v);
      }
      if (cat === "nazione") return /^[A-Z]{2,3}$/.test(v) ? v : "";
      if (cat === "ruolo") return tieniSiss(v) ? v : "RUOLO";
      if (cat === "sede") return tieniSiss(v) ? v : (conta.testo++, "STRUTTURA ESEMPIO");
      return trattaStringa(v);
    }
    const trattaSiss = (t) => {
      if (parolePersona.has(MAIUSC(t))) return parolaFinta(t);
      const { pre, parti } = valoriEtichette(t);
      if (parti.length) {
        let out = pre.trim() ? pre.replace(pre.trim(), trattaStringa(pre.trim())) : pre;
        for (const x of parti) {
          const pezzo = t.slice(x.fineEt, x.fine);
          const lead = /^\s*/.exec(pezzo)[0], trail = /\s*$/.exec(pezzo)[0];
          out += t.slice(x.inizio, x.fineEt) + (x.valore ? lead + valoreFinto(x.cat, x.valore) + trail : pezzo);
        }
        return out;
      }
      const r = /^(.+?)(\s+)(Medico|MEDICO|Infermiere|INFERMIERE|Farmacista|FARMACISTA|Specialista|SPECIALISTA)$/.exec(t);
      if (r && (formaNome(r[1]) || nomiVisti.has(norma(r[1])))) return nomeFinto(r[1], "personale") + r[2] + r[3];
      if (tieniSiss(t)) { conta.tenute++; return motivi(t); }
      return null;
    };

    // ------------------------------------------------ il visualizzatore (PACS)
    // gli UID (sempre gli stessi finti), le date AAAAMMGG, le cifre già viste
    const remapUid = (s) => String(s).replace(UID_RE, (u) => {
      if (u.length < 12 || UID_STANDARD.test(u)) return u;
      idOriginali.add(u); conta.id++; visto.id.add(u);
      return fintoId(u);
    });
    const dateDicom = (s) => String(s).replace(DA_RE, (all, y, m, d) => { const [gg, mm, aa] = dataFinta(d, m, y, "", 4); return `${aa}${p2(mm)}${p2(gg)}`; });
    const cifreViewer = (s) => remapCifre(dateDicom(remapUid(s)));
    const dateViewer = (s) => dateDicom(date(s));
    // un identificativo del paziente o dell'esame: sempre lo stesso finto (corto: cifre a zero)
    const idViewer = (v) => {
      const t = String(v).trim();
      if (!t) return v;
      if (!/\d/.test(t)) return trattaStringa(t);
      registraSegreto(t);
      conta.id++;
      if (idOriginali.has(t)) { visto.id.add(t); return fintoId(t); }
      return t.replace(/\d/g, "0");
    };
    // una persona dal suo nome DICOM: il nome intero e le sue parole (come sul SISS)
    const personaDicom = (comps, cat = "nomi") => {
      const nom = comps.slice(1).filter(Boolean).join(" ");
      if (cat === "personale") registraNome(`${comps[0]} ${nom}`.trim(), "personale");
      else personaSiss(comps[0], nom);
    };
    // il nome finto nella stessa forma: COGNOME^NOME^… (il personale: OPERATORE n)
    const nomeDicomFinto = (comps, cat = "nomi") => {
      const pieno = comps.filter(Boolean).join(" ");
      const v = nomiVisti.get(norma(pieno));
      if (((v && v.cat) || cat) === "personale") return nomeFinto(pieno, "personale");
      const f = nomeFinto(pieno, "nomi").split(" ");
      return [f[0], f.slice(1).join(" "), ...comps.slice(2).map(() => "")].join("^");
    };
    const valoriViewer = (t) => {
      const ms = [...t.matchAll(VIEWER_ETI_RE)];
      return { pre: ms.length ? t.slice(0, ms[0].index) : t, parti: ms.map((m, i) => {
        const da = m.index + m[0].length, a = i + 1 < ms.length ? ms[i + 1].index : t.length;
        return { cat: VIEWER_CAT.get(MAIUSCm(m[1])), inizio: m.index, fineEt: da, fine: a, valore: t.slice(da, a).trim() };
      }) };
    };
    // una descrizione (di serie, di studio): resta se è fatta solo di parole dell'anatomia e delle proiezioni
    const descrizioneViewer = (d) => {
      const w = MAIUSC(d).split(/[^A-Z0-9]+/).filter(Boolean);
      const persona = nomiVisti.has(norma(d)) || w.some((x) => parolePersona.has(x) || paroleDiNomi.has(x));
      if (w.length && !persona && w.every((x) => VIEWER_PAROLE.has(x) || PAROLE_STATICHE.has(x) || /^\d{1,3}$/.test(x))) { conta.tenute++; return d; }
      return trattaStringa(d);
    };
    // il valore dopo un'etichetta della sovraimpressione, secondo che dato porta
    function valoreViewer(cat, v) {
      if (!v) return v;
      if (cat === "nome" || cat === "personale") {
        if (nomiDicom(v).length) return trattaViewer(v);
        return nomeFinto(v.replace(/\s*,\s*/g, " ").replace(/\s+/g, " ").trim(), cat === "personale" ? "personale" : "nomi");
      }
      if (cat === "nascita") { const d = dateViewer(v); return d !== v ? d : v.replace(/\d/g, "0"); }
      if (cat === "data") { const d = dateViewer(v); return /^[\d\s/.:,-]*(?:AM|PM)?$/i.test(d) ? d : trattaStringa(v); }
      if (cat === "eta") return /^\(?\s*\d{1,3}\s*(?:[YMWD]|anni|mesi|giorni|years?|months?|days?)?\s*\)?$/i.test(v) ? v : (conta.testo++, "");
      if (cat === "sesso") return /^(?:[MFOU]|Male|Female|Other|Maschio|Femmina)$/i.test(v) ? v : "";
      if (cat === "id" || cat === "accesso") return idViewer(v);
      if (cat === "ora") return /^[\d:.,\s]{1,20}$/.test(v) ? v : "";
      if (cat === "istituto") { conta.testo++; return "OSPEDALE ESEMPIO"; }
      if (cat === "tecnico") return v.length <= 40 && /\d/.test(v) && /^[\s\d.,:/%x×+()-]*[A-Za-zµ°%²/]{0,6}[\s\d.,:/%x×+()-]*$/.test(v) ? v : trattaStringa(v);
      if (cat === "descrizione") return descrizioneViewer(v);
      return trattaStringa(v);
    }
    const pezzoViewer = (s) => { const q = s.trim(); return !q || soloPunteggiatura(q) ? s : s.replace(q, trattaStringa(q)); };
    // un testo di una pagina del visualizzatore: null se non è niente di suo (allora la regola di sempre)
    function trattaViewer(t) {
      if (VIEWER_TESTI.has(t)) { conta.tenute++; return t; }
      if (VIEWER_ETI_SOLA.test(t)) return t;                       // un'etichetta da sola: il valore è nel nodo dopo
      if (/^[0-2](?:\.\d+){4,}$/.test(t)) return remapUid(t);      // un UID
      if (tokenLike(t)) { idOriginali.add(t); conta.id++; visto.id.add(t); return fintoId(t); }
      const nn = nomiDicom(t);
      if (nn.length) {
        let out = "", da = 0;
        for (const n of nn) { out += pezzoViewer(t.slice(da, n.inizio)) + nomeDicomFinto(n.comps); da = n.fine; }
        return out + pezzoViewer(t.slice(da));
      }
      const { pre, parti } = valoriViewer(t);
      if (parti.length) {
        let out = pezzoViewer(pre);
        for (const x of parti) {
          const pezzo = t.slice(x.fineEt, x.fine);
          const lead = /^\s*/.exec(pezzo)[0], trail = /\s*$/.exec(pezzo)[0];
          out += t.slice(x.inizio, x.fineEt) + (x.valore ? lead + valoreViewer(x.cat, x.valore) + trail : pezzo);
        }
        return out;
      }
      const s = SERIE_RE.exec(t);
      if (s && MODALITA.has(s[3])) return s[1] + s[2] + s[3] + s[4] + descrizioneViewer(s[5]);
      return null;
    }
    // le scoperte, su un testo del visualizzatore: le persone, gli identificativi, le date di nascita
    function scopriValoreViewer(cat, v) {
      v = String(v || "").trim();
      if (!v) return;
      if (cat === "nome" || cat === "personale") {
        const nn = nomiDicom(v);
        if (nn.length) { for (const n of nn) personaDicom(n.comps, cat === "personale" ? "personale" : "nomi"); return; }
        const nome = v.replace(/\s*,\s*/g, " ").replace(/\s+/g, " ").trim();
        if (!/^[A-Za-zÀ-ÿ'’ .-]{4,60}$/.test(nome) || !/\s/.test(nome)) return;
        if (cat === "personale") registraNome(nome, "personale");
        else if (v.includes(",")) personaSiss(v.split(",")[0], v.split(",").slice(1).join(" "));
        else registraNome(nome, "nomi");
      } else if (cat === "nascita") {
        for (const m of v.matchAll(DATA_RE)) visto.nascita.add(m[0]);
        for (const m of v.matchAll(ISO_RE)) visto.nascita.add(m[0]);
        for (const m of v.matchAll(DA_RE)) { visto.nascita.add(m[0]); visto.nascita.add(`${m[3]}/${m[2]}/${m[1]}`); }
      } else if (cat === "id" || cat === "accesso") {
        registraSegreto(v);
        const b = /^(\d{5,})[-/.]\w{1,4}$/.exec(v);
        if (b) registraId(b[1]);
      }
    }
    function scopriViewer(raw) {
      const t = pulisci(String(raw)).replace(/\s+/g, " ").trim();
      if (!t || t.length > 4000) return;
      for (const x of valoriViewer(t).parti) scopriValoreViewer(x.cat, x.valore);
      for (const n of nomiDicom(t)) { const v = nomiVisti.get(norma(n.comps.filter(Boolean).join(" "))); if (!v || v.cat !== "personale") personaDicom(n.comps); }
      for (const m of t.matchAll(UID_RE)) if (m[0].length >= 12 && !UID_STANDARD.test(m[0])) registraId(m[0]);
      if (tokenLike(t)) registraId(t);
    }
    // le chiavi DICOM in uno script o in un JSON («PatientID": "…», "00100010": {"vr":"PN","Value":[…]})
    const scopriChiavi = (s) => { for (const m of String(s).matchAll(CHIAVE_VALORE_RE)) { const c = catChiave(m[1]); if (c) scopriValoreViewer(c, m[2]); } };
    // un parametro di un indirizzo del visualizzatore
    const valoreParamViewer = (k, v) => {
      if (!v) return v;
      if (credenziale(k) || VIEWER_SEGRETO.test(k) || tokenLike(v)) { conta.url++; return ""; }   // il gettone: via, del tutto
      if (/^[0-2](?:\.\d+){4,}$/.test(v)) return remapUid(v);
      if (VIEWER_NOME.test(k)) {
        const nn = nomiDicom(v), nv = nomiVisti.get(norma(v));
        if (nv && !nn.length) return nomeFinto(v.replace(/\s+/g, " ").trim(), nv.cat);
        conta.url++; return nn.length ? nomeDicomFinto(nn[0].comps) : "ESEMPIO";
      }
      if (VIEWER_ID.test(k)) return idViewer(v);
      if (VIEWER_CACHEBUSTER.test(k) && /^\d{1,16}$/.test(v)) return v.replace(/\d/g, "0");
      if (VIEWER_TECNICO.test(k) && /^[A-Za-z0-9./+:,_ -]{1,80}$/.test(v) && !/(?<!\d)\d{5,}(?!\d)/.test(v)) return v;
      return valoreParam(k, v);
    };
    // gli identificativi di un indirizzo del visualizzatore (prima passata): gettoni, persone, esami, UID
    const idDaUrlViewer = (u) => {
      const q = /\?([^#]*)/.exec(String(u || ""));
      if (q) for (const pp of q[1].split(/&amp;|&/)) {
        const i = pp.indexOf("=");
        if (i < 0) continue;
        const k = pp.slice(0, i), v = decURI(pp.slice(i + 1).split(/['"\s<>()]/)[0]);
        if (!v) continue;
        if (VIEWER_SEGRETO.test(k) || tokenLike(v)) registraId(v);
        else if (VIEWER_NOME.test(k)) { for (const n of nomiDicom(v)) personaDicom(n.comps); }
        else if (VIEWER_ID.test(k) && !UID_STANDARD.test(v)) scopriValoreViewer("id", v);   // (una classe SOP dello standard non è un caso)
      }
      for (const m of String(u || "").split("#")[0].matchAll(UID_RE)) if (m[0].length >= 12 && !UID_STANDARD.test(m[0])) registraId(m[0]);
    };

    // --------------------------------------- un testo: il cuore della regola
    function trattaStringa(core, ctx = {}) {
      const t = pulisci(core).trim();
      if (!t) return core;
      if (soloPunteggiatura(t)) return core;
      if (sissOra) { const b = trattaSiss(t); if (b != null) return b; }
      if (viewerOra) { const b = trattaViewer(t); if (b != null) return b; }
      if (idOriginali.has(t)) return remapId(t);
      if (MARCHI.some((re) => re.test(t))) { conta.testo++; return neutro(t); }
      const nv = nomiVisti.get(norma(t));
      if (nv) return nomeFinto(t, nv.cat);
      if (vocabolo(t)) { conta.tenute++; return motivi(t); }
      if (formaNome(t)) return nomeFinto(t, "nomi");
      if (utente(t)) return utenteFinto(t);
      if (/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(t)) return cfFinto(t);
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return t;                                    // un'ora
      if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(t) || /^\d{4}-\d{2}-\d{2}(?:[ T][\d:.]+)?$/.test(t)) return date(t);
      if (/^[\d.,\s%+-]+$/.test(t)) {
        const r = remapCifre(t);
        if (r !== t) return r;
        if (/^\d{1,2}$/.test(t)) return t;                                                   // un posto letto, un codice breve
        conta.testo++; return numeroFinto(t);
      }
      if (haEmail(t)) return motivi(t);
      if (ctx.libero) { conta.liberi++; contaDentro(t); return sintetico(t); }
      // una riga fatta di pezzi («APERTA - ROSSI MARIO - 23/08/2026»): pezzo per
      // pezzo, ma solo se ogni pezzo è una cosa nota; se no tutta inventata
      if (t.length <= 160) {
        const parti = t.split(/(\s[-–—|·•/]\s|[|·•;,()[\]:]\s*|\s{2,})/);
        if (parti.length > 1) {
          let ok = true;
          const fuori = parti.map((p, i) => {
            if (i % 2 === 1 || !p.trim()) return p;
            const q = p.trim();
            if (soloPunteggiatura(q) || idOriginali.has(q) || vocabolo(q) || nomiVisti.has(norma(q)) || formaNome(q) || utente(q)
              || /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(q) || /^[\d.,%:/ -]+$/.test(q)) return p.replace(q, trattaStringa(q));
            ok = false; return p;
          });
          if (ok) return fuori.join("");
        }
      }
      conta[t.length >= 24 ? "liberi" : "testo"]++; contaDentro(t);
      return sintetico(t);
    }
    function neutro(t) {
      if (/Sei connesso come/i.test(t)) return "Salve! Sei connesso come Utente Medico: UTENTE1";
      if (/PS Assist/i.test(t)) return "";
      if (/tutti i diritti riservati|AFC\s?2003|java\.net/i.test(t)) return "software di esempio";
      return "OSPEDALE ESEMPIO";
    }
    function numeroFinto(s) {
      return s.replace(/\d+([.,]\d+)?/g, (n) => {
        const dec = /[.,]/.test(n) ? n.replace(/^\d+[.,]/, "").length : 0;
        const base = Number(n.replace(",", ".")) || 0;
        const v = Math.max(0, base * (0.82 + (hash(n + s) % 18) / 100));
        const out = dec ? v.toFixed(dec) : String(Math.round(v)).padStart(n.length, n.startsWith("0") ? "0" : "");
        return n.includes(",") ? out.replace(".", ",") : out;
      });
    }
    const testoConSpazi = (raw, ctx) => {
      const t = decodifica(raw);
      if (!t.trim()) return raw;
      const lead = /^\s*/.exec(t)[0], trail = /\s*$/.exec(t)[0];
      return escTesto(lead + trattaStringa(t.trim(), ctx) + trail);
    };

    // ----------------------------------------------------------- indirizzi
    const origineFinta = (o, modo) => {
      if (o === gestionale) return modo === "flusso" ? "https://gestionale.esempio" : "";
      if (SISS_ORIGINI[o]) return SISS_ORIGINI[o];
      if (sissOrig.has(o)) return "https://siss.esempio";
      if (portali.has(o)) return "http://portale.esempio";
      const vw = viewerDi(o);
      if (vw) return vw;
      if (/^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(o)) return "http://127.0.0.1";
      return null;
    };
    const valoreParam = (k, v) => {
      const K = k.toUpperCase();
      if (!v) return v;
      if (credenziale(k)) return "";
      if (STRUTTURA.has(K)) return v;
      if (PARAM_CF.test(K)) return cfFinto(v.toUpperCase());
      if (PARAM_ID.test(K)) return remapId(v);
      if (/^(BLOBFIELD|WHERECONDITION)$/.test(K)) return remapCifre(v);
      if (/^\d{1,3}$/.test(v) || CODICI.has(v) || vocabolo(v)) return remapCifre(v);
      if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(v) || /^\d{4}-\d{2}-\d{2}/.test(v)) return date(v);
      // una persona vista (s_ASSISTITO=ROSSI+MARIO): il suo nome finto, lo stesso delle pagine
      const nv = nomiVisti.get(norma(v));
      if (nv) return nomeFinto(v.replace(/\s+/g, " ").trim(), nv.cat);
      conta.url++;
      return "ESEMPIO";
    };
    const decURI = (s) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };
    const encURI = (s) => encodeURIComponent(s).replace(/%2C/g, ",").replace(/%2F/g, "/").replace(/%3A/g, ":").replace(/%20/g, "+");
    function anonUrl(u, modo = "pagina") {
      let s = String(u == null ? "" : u).trim();
      if (!s) return s;
      if (/^\/\//.test(s)) s = "https:" + s;
      if (/^#/.test(s)) return /^#\/?[\w-]{0,40}(?:\/[\w-]{1,40}){0,6}$/.test(s) ? s : "#";
      if (/^javascript:/i.test(s)) return "javascript:" + anonJs(s.slice(11));
      if (/^data:/i.test(s)) return !viewerOra && /^data:image\//i.test(s) && s.length <= IMG_DATA_MAX ? s : (conta.immagini++, "data:,");
      if (/^(mailto|tel):/i.test(s)) return /^mailto/i.test(s) ? "mailto:utente@esempio.it" : "tel:000";
      if (/^blob:/i.test(s)) {
        const inner = s.slice(5);
        const o = /^[a-z]+:\/\/[^/]+/i.exec(inner);
        const of = o ? origineFinta(o[0], "flusso") || "https://altro.esempio" : "";
        return `blob:${of}/${fintoId((/[0-9a-f-]{36}/i.exec(inner) || ["00000000-0000-0000-0000-000000000000"])[0])}`;
      }
      const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(s);
      if (!m) { conta.url++; return "#"; }
      let [, pre = "", percorso = "", query = "", frag = ""] = m;
      let vw = viewerOra;   // il visualizzatore: i suoi indirizzi, e quelli relativi delle sue pagine
      if (pre) {
        const o = pre.replace(/\/+$/, "").toLowerCase().replace(/:(80|443)$/, "");
        const f = origineFinta(o, modo) ?? origineFinta(pre.replace(/\/+$/, ""), modo);
        if (f == null) { conta.url++; return modo === "flusso" ? "https://altro.esempio/" : "#"; }
        vw = !!viewerDi(o);
        pre = f;
      }
      percorso = percorso.split("/").map((seg) => {
        const sj = /^([^;]*)(;jsessionid=.*)?$/i.exec(seg);
        let base = sj[1];
        if (vw) { base = remapUid(base); if (MARCHI.some((re) => re.test(base))) base = "esempio"; }
        if (/^\d{4,}$/.test(base) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(base) || (/\d/.test(base) && /^[\w-]{16,}$/.test(base))) { registraId(base); base = remapId(base); }
        else base = remapCifre(base);
        return base;
      }).join("/");
      if (query) {
        query = "?" + query.slice(1).split("&").map((p) => {
          if (!p) return p;
          const i = p.indexOf("=");
          if (i < 0) return p;
          const k = p.slice(0, i), raw = p.slice(i + 1);
          if (STRUTTURA.has(k.toUpperCase())) return p;
          const v = decURI(raw);
          const nv = vw ? valoreParamViewer(k, v) : valoreParam(k, v);
          return nv === v ? p : `${k}=${encURI(nv)}`;
        }).join("&");
      }
      if (frag && !/^#\/?[\w-]{0,40}(?:\/[\w-]{1,40}){0,6}$/.test(frag)) frag = "#";
      return pre + percorso + query + frag;
    }

    // ---------------------------------------------------------- script
    function letterale(s) {
      if (!s) return s;
      const d = s.replace(/\\(["'\\/])/g, "$1");
      // il visualizzatore: un gettone in uno script diventa un altro della stessa forma (e il cancello lo cerca)
      if (viewerOra && tokenLike(d)) { idOriginali.add(d); conta.id++; visto.id.add(d); return fintoId(d); }
      if (/^[\w$.#:[\]-]{0,40}$/.test(d) && !(d.length >= 4 && /^[A-ZÀ-Ù']+$/.test(d) && !vocabolo(d))) return viewerOra ? cifreViewer(s) : remapCifre(s);
      if (/^(?:[a-z]+:\/\/|\.{0,2}\/|[\w.-]+\.(?:do|jsp|html?|rra2|pdf)\b)/i.test(d) || /^[^\s]*[?&][\w]+=/.test(d)) {
        return anonUrl(d, "pagina").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "\\\"");
      }
      return trattaStringa(d).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
    }
    const anonJs = (js) => remapCifre(pezziJs(String(js), letterale));
    const anonCss = (css) => String(css).replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
        if (/^data:image\//i.test(u)) return !viewerOra && u.length <= IMG_DATA_MAX ? m : (conta.immagini++, "none");
        const name = u.split(/[/\\?#]/).filter(Boolean).pop() || "";
        if (LOGHI.test(name)) return "none";
        return `url("${anonUrl(u, "pagina")}")`;
      });

    // ------------------------------------------------------- una pagina
    const ATTR_URL = new Set(["href", "src", "action", "background", "data", "formaction", "poster", "cite", "longdesc", "codebase", "lowsrc", "dynsrc"]);
    const ATTR_STRUTTURA = new Set(["name", "id", "class", "type", "for", "method", "target", "width", "height", "align", "valign", "border",
      "cellspacing", "cellpadding", "colspan", "rowspan", "size", "maxlength", "checked", "selected", "disabled", "readonly", "nowrap",
      "bgcolor", "color", "face", "language", "charset", "http-equiv", "rel", "media", "tabindex", "accesskey", "enctype", "accept-charset",
      "autocomplete", "multiple", "hidden", "lang", "dir", "scope", "usemap", "shape", "frameborder", "scrolling", "marginwidth",
      "marginheight", "noresize", "clear", "hspace", "vspace", "start", "span", "wrap", "cols", "rows", "role", "xmlns", "valuetype",
      "text", "link", "vlink", "alink", "leftmargin", "topmargin", "rules", "frame", "accept", "step", "min", "max", "pattern", "draggable",
      "contenteditable", "spellcheck", "nonce", "integrity", "crossorigin", "async", "defer", "noshade", "compact", "datetime",
      // Angular e i suoi componenti: nomi di campi e stato, non dati
      "formcontrolname", "formgroupname", "formarrayname", "data-psa-escluso", "aria-controls", "aria-describedby", "aria-labelledby", "aria-owns",
      "aria-activedescendant", "aria-expanded", "aria-selected", "aria-checked", "aria-disabled", "aria-hidden", "aria-haspopup", "aria-invalid",
      "aria-required", "aria-autocomplete", "aria-multiselectable", "aria-orientation", "aria-live", "aria-atomic", "aria-busy", "aria-modal",
      "aria-pressed", "aria-readonly", "aria-level", "aria-posinset", "aria-setsize", "aria-sort", "aria-current", "ng-version"]);
    const attrDi = (attrs, n) => { const a = attrs.find((x) => x.k.toLowerCase() === n); return a && a.v != null ? decodifica(a.v) : ""; };
    // un campo di credenziali (password, PIN, OTP): il valore non esce mai, da nessuna pagina
    const campoCredenziale = (attrs) => !!attrs.find((x) => x.k.toLowerCase() === "data-psa-escluso") || /^password$/i.test(attrDi(attrs, "type"))
      || credenziale(["name", "id", "formcontrolname", "autocomplete", "placeholder", "aria-label"].map((n) => attrDi(attrs, n)).join(" "))
      || /one-time-code|current-password|new-password/i.test(attrDi(attrs, "autocomplete"));
    function valoreCampoSiss(nome, v, attrs) {
      const c = campoSiss(nome), t = v.trim();
      if (c === "libero") { conta.liberi++; contaDentro(t); return sintetico(t); }
      if (c === "numero") return /^\d{1,3}$/.test(t) ? t : numeroFinto(t);
      if (c === "cognome" || c === "nome") {
        const r = parolePersonaFinte(t);
        return r !== t ? r : (conta.nomi++, stile(t, pick(c === "cognome" ? COGNOMI : NOMI, t)));
      }
      if (c) return valoreFinto(c, t);
      // le ricerche nel catalogo (farmaco, prestazione, esenzione, quesito codificato): restano, se non c'è dentro una persona
      const etichetta = `${attrDi(attrs, "placeholder")} ${attrDi(attrs, "aria-label")} ${attrDi(attrs, "role")}`;
      if (/combobox|ricerca|cerca|esenzion|quesit|farmac|prestazion|specialistic/i.test(etichetta)) {
        const persona = nomiVisti.has(norma(t)) || haCF(t) || formaNome(t) || MAIUSC(t).split(/[^A-Z']+/).some((w) => parolePersona.has(w));
        if (!persona && t.length <= 120) { conta.tenute++; return motivi(t); }
      }
      return trattaStringa(t);
    }
    const icone = new Set(), iconeNuove = new Set();
    function trattaPagina(html, unitaPagina, siss = false, viewer = false) {
      sissOra = siss; viewerOra = viewer;
      try { return trattaPagina0(html, unitaPagina, siss); } finally { sissOra = false; viewerOra = false; }
    }
    function trattaPagina0(html, unitaPagina, siss) {
      const out = [];
      let select = null, inputNome = null, etiSiss = null, etiViewer = null, credArea = false, contesto = false;
      for (const p of pezzi(String(html))) {
        if (p.k === "doctype") { out.push(p.s); continue; }
        if (p.k === "testo") {
          if (select && CAMPI_PERSONA.test(select)) { const t = decodifica(p.s); out.push(t.trim() ? escTesto(t.replace(t.trim(), /Seleziona/i.test(t) ? t.trim() : nomeFinto(t.trim(), "personale"))) : p.s); }
          else if (siss) {
            // l'etichetta in un nodo e il valore nel successivo: «Cognome:» «ROSSI»
            const t = decodifica(p.s), d = pulisci(t).replace(/\s+/g, " ").trim();
            if (d && SISS_ETI_SOLA.test(d)) { etiSiss = catEtichetta(d.replace(/\s*:$/, "")); out.push(testoConSpazi(p.s)); }
            else if (d && etiSiss && valoreAtteso(etiSiss, d)) { out.push(escTesto(t.replace(t.trim(), valoreFinto(etiSiss, t.trim())))); etiSiss = null; }
            else { if (d) etiSiss = null; out.push(testoConSpazi(p.s)); }
          } else if (viewerOra) {
            // anche nella sovraimpressione: «Birth:» in un nodo, la data nel successivo
            const t = decodifica(p.s), d = pulisci(t).replace(/\s+/g, " ").trim(), e = d && VIEWER_ETI_SOLA.exec(d);
            if (e) { etiViewer = VIEWER_CAT.get(MAIUSCm(e[1])); out.push(testoConSpazi(p.s)); }
            else if (d && etiViewer) { out.push(escTesto(t.replace(t.trim(), valoreViewer(etiViewer, t.trim())))); etiViewer = null; }
            else out.push(testoConSpazi(p.s));
          }
          else out.push(testoConSpazi(p.s));
          continue;
        }
        if (p.k === "fine") { if (p.nome === "select") select = null; else if (p.nome === "form") contesto = false; out.push(`</${p.nome}>`); continue; }
        if (p.k === "corpo") {
          if (p.nome === "script") out.push(anonJs(p.s));
          else if (p.nome === "style") out.push(anonCss(p.s));
          else if (p.nome === "textarea") { const t = decodifica(p.s); out.push(credArea ? "" : t.trim() ? (conta.liberi++, contaDentro(t), escTesto(sintetico(t.trim()))) : p.s); }
          else if (p.nome === "noscript" || p.nome === "xmp") out.push("");
          else out.push(testoConSpazi(p.s));
          continue;
        }
        // un tag
        const nomeAttr = (p.attrs.find((a) => a.k.toLowerCase() === "name") || {}).v || "";
        if (p.nome === "select") select = nomeAttr;
        if (p.nome === "form") contesto = /ccsForm=ContestoImposta/i.test(attrDi(p.attrs, "action"));
        const selStrutt = !!select && (SELECT_STRUTTURA.test(select) || (contesto && !CAMPI_PERSONA.test(select) && !/USER/i.test(select)));
        if (p.nome === "input" || p.nome === "textarea" || p.nome === "select") inputNome = siss ? nomeAttr || attrDi(p.attrs, "formcontrolname") || attrDi(p.attrs, "id") : nomeAttr;
        const cred = (p.nome === "input" || p.nome === "textarea") && campoCredenziale(p.attrs);
        if (p.nome === "textarea") credArea = cred;
        let togli = false;
        const attrs = p.attrs.map((a) => {
          const K = a.k.toLowerCase();
          if (a.c) return a.k;
          const v = decodifica(a.v);
          let nv;
          if (p.nome === "img" && K === "src") {
            const name = decURI(v.split(/[?#]/)[0].split(/[/\\]/).pop() || "").replace(/^icona:/, "");
            if (/^data:/i.test(v)) nv = !viewerOra && /^data:image\//i.test(v) && v.length <= IMG_DATA_MAX ? v : (conta.immagini++, "");
            else if (LOGHI.test(name)) { togli = true; nv = ""; }
            // il visualizzatore: della miniatura resta l'indirizzo anonimizzato (mai i byte)
            else if (viewerOra) nv = /^(?:blob:|https?:|\/|[\w.-]+(?:[/?]|$))/i.test(v) ? anonUrl(v, "pagina") : (conta.immagini++, "");
            else if (ICONE.has(name)) { icone.add(name); nv = `icona:${name}`; }
            else if (/^[\w.-]{1,60}\.(gif|png|jpe?g|svg|ico|bmp)$/i.test(name) && !/[?]/.test(v)) { iconeNuove.add(name); nv = `icona:${name}`; }
            else { conta.immagini++; nv = ""; }
          } else if (ATTR_URL.has(K)) nv = anonUrl(v, "pagina");
          else if (K.startsWith("on")) nv = anonJs(v);
          else if (K === "style") nv = anonCss(v);
          else if (K === "content" && p.nome === "meta") {
            const r = /^(\s*\d+\s*;\s*url\s*=\s*)(.*)$/i.exec(v);
            nv = r ? r[1] + anonUrl(r[2].replace(/^['"]|['"]$/g, ""), "pagina") : /charset|text\/html/i.test(v) ? v : trattaStringa(v);
          } else if (ATTR_STRUTTURA.has(K)) nv = viewerOra ? cifreViewer(v) : remapCifre(v);
          else if (K === "value") {
            const N = (inputNome || "").toUpperCase();
            if (cred) nv = "";
            else if (p.nome === "option" && select && CAMPI_PERSONA.test(select)) nv = /^\d{1,6}$/.test(v) ? v : nomeFinto(v, "personale");
            else if (!v.trim()) nv = v;
            else if (p.nome === "option" && selStrutt && /^[\w.-]{1,16}$/.test(v.trim()) && !credenziale(v)) nv = v;      // le risorse, i percorsi, i servizi: id del programma
            else if (siss && p.nome === "input" && !/^(checkbox|radio|hidden)$/i.test(attrDi(p.attrs, "type"))) nv = valoreCampoSiss(inputNome, v, p.attrs);
            else if (p.nome === "input" && STRUTTURA.has(N)) nv = v;
            else if (p.nome === "input" && CAMPI_PERSONA.test(N)) nv = nomeFinto(v, "personale");
            else if (p.nome === "input" && PARAM_CF.test(N)) nv = cfFinto(v.toUpperCase());
            else if (p.nome === "input" && PARAM_ID.test(N)) nv = remapId(v.trim());
            else if (p.nome === "input" && CAMPI_LIBERI.test(N)) nv = isExam(v) ? v : (conta.liberi++, contaDentro(v), sintetico(v.trim()));
            else if ((p.nome === "option" || p.attrs.some((x) => /^type$/i.test(x.k) && /hidden|radio|checkbox/i.test(x.v || ""))) && (/^\d{1,4}$/.test(v.trim()) || CODICI.has(v.trim()))) nv = v;
            else nv = trattaStringa(v);
          } else nv = trattaStringa(v);
          return `${a.k}="${escAttr(nv)}"`;
        });
        if (togli) continue;
        out.push(`<${p.nome}${attrs.length ? " " + attrs.join(" ") : ""}${p.chiuso ? " /" : ""}>`);
      }
      return out.join("");
    }

    // ------------------------------------------ prima passata: osservare
    // I pazienti che l'estensione conosce già (la lista del pannello, quelli
    // aperti, gli ordini: `raccolta.nomi`, li dà il service worker): persone
    // come quelle viste nelle pagine, lo stesso nome finto ovunque — anche dove
    // nessuna pagina registrata li mostra (il Registro di un'altra scheda).
    for (const n of Array.isArray(raccolta.nomi) ? raccolta.nomi : []) {
      const t = String(n || "").replace(/\s*[(\[].*$/, "").replace(/[^A-Za-zÀ-ÿ'’ -]+/g, " ").replace(/\s+/g, " ").trim(), w = t.split(" ");
      if (t.length <= 60 && w.length >= 2 && w.length <= 5 && w.every((x) => x.length >= 2 && (/^[A-ZÀ-Ù]/.test(x) || /^(?:de|di|da|del|della|dello|dei|degli|la|lo|le|van|von)$/.test(x)))) registraNome(t, "nomi");
    }
    const pagine = (raccolta.pagine || []).slice().sort((a, b) => a.ts - b.ts);
    const flusso = (raccolta.flusso || []).slice().sort((a, b) => a.inizio - b.inizio);
    const pdf = (raccolta.pdf || []).slice().sort((a, b) => a.ts - b.ts);
    // episodio ↔ richiesta, dagli indirizzi che li portano insieme
    const richiestaEp = new Map();
    const tuttiUrl = [...pagine.map((p) => p.url), ...flusso.flatMap((r) => [r.url, ...(r.rinvii || []).map((x) => x.a)])];
    for (const u of tuttiUrl) { const e = paramDi(u, "EPISODIO_ID"), r = paramDi(u, "RICHIESTA_ID"); if (e && r) richiestaEp.set(r, e); }
    // L'unità («di quale paziente») di ogni pagina: il suo episodio (o quello
    // della sua richiesta, o il suo assistito), o l'unico episodio che nomina.
    // Una finestra nuova (risultati, referto) è del paziente della pagina che
    // l'ha aperta; un riquadro, della pagina che lo contiene. Mai «la pagina di
    // prima nella stessa scheda»: la lista del PS vista dopo un paziente non è
    // di quel paziente.
    const ultimaAlta = new Map(), apertaDa = new Map();
    for (const s of raccolta.schede || []) if (s.apertaDa != null) apertaDa.set(s.id, s.apertaDa);
    for (const p of pagine) if (p.apertaDa != null && !apertaDa.has(p.scheda)) apertaDa.set(p.scheda, p.apertaDa);
    const unitaDiScheda = (scheda, ts) => {
      let u = "";
      for (const p of pagine) { if (p.ts > ts) break; if (p.scheda === scheda && p.alto !== false && p.unita !== undefined) u = p.unita; }
      return u;
    };
    const visteSchede = new Set();
    for (const p of pagine) {
      p.siss = isSiss(p.url);
      p.viewer = !p.siss && isViewer(p.url);
      let u =paramDi(p.url, "EPISODIO_ID") || (richiestaEp.get(paramDi(p.url, "RICHIESTA_ID")) || "") || (paramDi(p.url, "ASSISTITO_ID") ? "A:" + paramDi(p.url, "ASSISTITO_ID") : "");
      // sul SISS il paziente è quello del suo banner (o del campo dell'identificazione)
      if (!u && p.siss) { const m = new RegExp(CF_RE.source).exec(decodifica(String(p.html))); if (m) u = "S:" + m[0]; }
      const eps = episodiIn(p.html);
      p.multi = !u && eps.size >= 2;
      if (!u && eps.size === 1) u = [...eps][0];
      if (!u && !p.multi && p.alto === false) u = ultimaAlta.get(p.scheda) || "";
      else if (!u && !p.multi && !visteSchede.has(p.scheda) && apertaDa.has(p.scheda)) u = unitaDiScheda(apertaDa.get(p.scheda), p.ts);
      if (p.alto !== false) { ultimaAlta.set(p.scheda, u); visteSchede.add(p.scheda); }
      p.unita = u;
    }
    // gli identificativi: dagli indirizzi, dai campi, dalle pagine (quelli del visualizzatore: anche i gettoni e gli UID)
    const idDaUrl = (u, vw = isViewer(u)) => {
      if (vw) idDaUrlViewer(u);
      const q = /\?([^#]*)/.exec(String(u || ""));
      if (q) for (const pp of q[1].split(/&amp;|&/)) {
        const i = pp.indexOf("=");
        if (i < 0) continue;
        const k = pp.slice(0, i).toUpperCase(), v = decURI(pp.slice(i + 1).split(/['"\s<>()]/)[0]);
        if (STRUTTURA.has(k) || !v) continue;
        if (PARAM_CF.test(k)) { if (v.length >= 11) visto.cf.add(v.toUpperCase()); continue; }
        if (PARAM_ID.test(k)) registraId(v);
        if (/^(BLOBFIELD|WHERECONDITION)$/.test(k)) for (const d of v.match(/\d{5,}/g) || []) registraId(d);
      }
      for (const seg of String(u || "").split(/[?#]/)[0].split("/")) if (/^\d{5,}$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(seg)) registraId(seg);
    };
    // i codici AIC dei farmaci sulle pagine e nei PDF del SISS: codici, non casi
    for (const p of pagine) if (p.siss) for (const m of decodifica(String(p.html)).matchAll(/>\s*(0\d{8})\s*</g)) codiciSiss.add(m[1]);
    for (const d of pdf) if (isSiss(d.url)) for (const r of d.righe || []) { const m = /^\s*(0\d{8})\s+[A-Z]/.exec(r); if (m) codiciSiss.add(m[1]); }
    for (const u of tuttiUrl) idDaUrl(u);
    for (const r of flusso) for (const [k, v] of Object.entries(r.corpo || {})) { const K = k.toUpperCase(); if (!STRUTTURA.has(K) && PARAM_ID.test(K)) registraId(String(v)); }
    for (const p of pagine) {
      const toks = pezzi(String(p.html));
      p.pezzi = toks;
      // nelle pagine di più pazienti (la lista del PS) ogni riga è di chi ha il
      // suo EPISODIO_ID: prima si trova di chi è ogni riga, poi si contano le parole
      const unitaRighe = [];
      let riga = -1, select = null;
      for (const pz of toks) {
        if (pz.k === "tag") {
          const get = (n) => { const a = pz.attrs.find((x) => x.k.toLowerCase() === n); return a && a.v != null ? decodifica(a.v) : ""; };
          if (pz.nome === "tr") { riga++; unitaRighe[riga] = ""; }
          pz.riga = riga;
          for (const a of pz.attrs) {
            if (a.v == null) continue;
            const K = a.k.toLowerCase(), v = decodifica(a.v);
            if (ATTR_URL.has(K) || K.startsWith("on") || K === "content") {
              if (!K.startsWith("on") && !/^javascript:/i.test(v)) idDaUrl(v, p.viewer || isViewer(v));
              for (const m of v.matchAll(/['"]([^'"]*\?[^'"]*)['"]/g)) idDaUrl(m[1], p.viewer || isViewer(m[1]));
              const e = paramDi(v, "EPISODIO_ID");
              if (p.multi && riga >= 0 && e && !unitaRighe[riga]) unitaRighe[riga] = e;
            }
          }
          if (pz.nome === "select") select = get("name");
          const nome = get("name"), val = get("value");
          if (pz.nome === "input" && val) {
            if (CAMPI_PERSONA.test(nome)) registraNome(val, "personale");
            else if (PARAM_CF.test(nome)) { if (val.length >= 11) visto.cf.add(val.toUpperCase()); }
            else if (!STRUTTURA.has(nome.toUpperCase()) && PARAM_ID.test(nome)) {
              registraId(val.trim());
              if (p.multi && riga >= 0 && /^EPISODIO_ID$/i.test(nome) && !unitaRighe[riga]) unitaRighe[riga] = val.trim();
            }
          }
          if (pz.nome === "option" && select && CAMPI_PERSONA.test(select) && val && !/^\d+$/.test(val)) registraNome(val, "personale");
        } else {
          pz.riga = riga;
          if (pz.k === "fine" && pz.nome === "select") select = null;
          else if (pz.k === "testo" && select && CAMPI_PERSONA.test(select)) { const t = decodifica(pz.s).trim(); if (t && !/Seleziona/i.test(t)) registraNome(t, "personale"); }
        }
      }
      p.unitaRighe = unitaRighe;
    }
    // le etichette del programma, dalla forma delle pagine (prima delle parole,
    // così non diventano nomi): link di sola navigazione, intestazioni, voci
    // dei select di risorse; e i nomi che il programma dà ai suoi campi
    const didascalie = new Map();       // chiave → in quante pagine sta in una cella di intestazione
    const etichettaBuona = (raw) => {
      const t = pulisci(decodifica(String(raw))).replace(/\s+/g, " ").trim();
      return t.length >= 2 && t.length <= 40 && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 '’.,/()*&:+-]*$/.test(t) && !/\d{5,}/.test(t) && !haCF(t) && !haEmail(t)
        && !MARCHI.some((re) => re.test(t)) && !credenziale(t) && !new RegExp(DATA_RE.source).test(t) ? t : "";
    };
    const sicura = (raw) => { const t = etichettaBuona(raw); if (t) ETI.add(chiaveEti(t)); };
    for (const p of pagine) {
      const celle = [], viste = new Set();
      let nav = false, testoDi = null, select = null, contesto = false;
      for (const pz of p.pezzi) {
        if (pz.k === "tag") {
          const get = (n) => { const a = pz.attrs.find((x) => x.k.toLowerCase() === n); return a && a.v != null ? decodifica(a.v) : ""; };
          // (un link con dentro una tabella, un a capo, un grassetto è una linguetta di un paziente, non un'etichetta)
          if (nav && /^(?:table|div|strong|br|small|tr|td|th|p|ul|li)$/.test(pz.nome)) nav = false;
          for (const k of ["name", "id"]) {
            const v = get(k).replace(/^s_/i, "");
            if (/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(v)) STRUT.add(chiaveEti(v));
          }
          if (pz.nome === "img") {
            const f = decURI(get("src").split(/[?#]/)[0].split(/[/\\]/).pop() || "").replace(/^icona:/, "").replace(/\.[a-z]+$/i, "");
            if (/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(f)) STRUT.add(chiaveEti(f));
            if (nav) { sicura(get("title")); sicura(get("alt")); }
          } else if (pz.nome === "a") {
            nav = soloNavigazione(get("href")) || soloNavigazione(get("onclick"));
            if (nav) sicura(get("title"));
          } else if (pz.nome === "td" || pz.nome === "th") celle.push(pz.nome === "th" || /Caption|Column|Header/.test(get("class")));
          else if (pz.nome === "form") contesto = /ccsForm=ContestoImposta/i.test(get("action"));
          else if (pz.nome === "select") select = get("name");
          else if (pz.nome === "input" && /^(?:submit|button|reset)$/i.test(get("type"))) sicura(get("value"));
          else if (/^(?:label|legend|button|caption|option)$/.test(pz.nome) || (pz.nome === "font" && /HeaderFont/.test(get("class")))) testoDi = pz.nome;
        } else if (pz.k === "fine") {
          if (pz.nome === "a") nav = false;
          else if (pz.nome === "td" || pz.nome === "th") celle.pop();
          else if (pz.nome === "form") contesto = false;
          else if (pz.nome === "select") select = null;
          else if (testoDi === pz.nome) testoDi = null;
        } else if (pz.k === "testo") {
          const k = etichettaBuona(pz.s) && chiaveEti(etichettaBuona(pz.s));
          if (!k) continue;
          const strutt = select && (SELECT_STRUTTURA.test(select) || (contesto && !CAMPI_PERSONA.test(select) && !/USER/i.test(select)));
          if (nav || (testoDi && testoDi !== "option") || (testoDi === "option" && strutt)) ETI.add(k);
          else if (celle.length && celle[celle.length - 1] && !viste.has(k)) { viste.add(k); didascalie.set(k, (didascalie.get(k) || 0) + 1); }
        }
      }
    }
    // (una cella di intestazione che si ripete in più pagine: un'etichetta, non il dato di un caso)
    for (const [k, n] of didascalie) if (n >= 2) ETI.add(k);

    // le parole: chi le dice, e cosa c'è dentro
    for (const p of pagine) {
      sissOra = p.siss;
      let eti = null, etiV = null, dopoCodice = false, cog = "", nom = "";
      const persona = (c, v) => { if (c === "cognome") cog = v; else nom = v; };
      for (const pz of p.pezzi) {
        const unita = p.multi ? (pz.riga >= 0 ? p.unitaRighe[pz.riga] : "") : p.unita;
        // il visualizzatore: i nomi DICOM, la sovraimpressione (anche su due nodi), le chiavi DICOM negli script, gli UID, i gettoni
        if (p.viewer) {
          if (pz.k === "testo" || (pz.k === "corpo" && pz.nome === "title")) {
            const d = pulisci(decodifica(pz.s)).replace(/\s+/g, " ").trim(), e = d && VIEWER_ETI_SOLA.exec(d);
            if (e) etiV = VIEWER_CAT.get(MAIUSCm(e[1]));
            else if (d) { if (etiV) scopriValoreViewer(etiV, d); etiV = null; scopriViewer(d); }
          } else if (pz.k === "corpo" && pz.nome === "script") { scopriChiavi(pz.s); pezziJs(pz.s, (s) => { scopriViewer(s); return s; }); }
          else if (pz.k === "tag") for (const a of pz.attrs) if (a.v != null) { const v = decodifica(a.v); scopriViewer(v); scopriChiavi(v); }
        }
        if (p.siss && pz.k === "testo") {
          const t = decodifica(pz.s), d = pulisci(t).replace(/\s+/g, " ").trim();
          scopriSiss(t);
          if (d && SISS_ETI_SOLA.test(d)) eti = catEtichetta(d.replace(/\s*:$/, ""));
          else if (d) {
            if (eti) scopriValore(eti, d, persona);
            eti = null;
            // la descrizione accanto al codice di un farmaco o di una prestazione
            if (dopoCodice && d.length <= 120 && /^[A-Z0-9]/.test(d) && !nomiVisti.has(norma(d))) catalogoSiss.add(d);
            dopoCodice = AIC_RE.test(d) || /^\d{2}\.\d{1,2}(?:\.\d{1,2})?$/.test(d);
          }
        }
        if (p.siss && pz.k === "tag" && pz.nome === "input" && !campoCredenziale(pz.attrs)) {
          const c = campoSiss(attrDi(pz.attrs, "name") || attrDi(pz.attrs, "formcontrolname") || attrDi(pz.attrs, "id"));
          const val = attrDi(pz.attrs, "value").trim();
          if (c && val) scopriValore(c, val, persona);
        }
        if (pz.k === "testo" || (pz.k === "corpo" && pz.nome === "title")) { const t = decodifica(pz.s); osservaStringa(t, unita); scopri(t); }
        else if (pz.k === "corpo" && pz.nome === "textarea") scopri(decodifica(pz.s));
        else if (pz.k === "corpo" && pz.nome === "script") pezziJs(pz.s, (s) => { scopri(s); return s; });
        else if (pz.k === "tag") {
          for (const a of pz.attrs) {
            if (a.v == null) continue;
            const K = a.k.toLowerCase(), v = decodifica(a.v);
            if (ATTR_STRUTTURA.has(K)) continue;
            if (ATTR_URL.has(K) || K.startsWith("on")) { scopri(decURI(v)); continue; }
            osservaStringa(v, unita);
            scopri(v);
            if (p.siss) scopriSiss(v);
          }
        }
      }
      if (cog || nom) personaSiss(cog, nom);
      delete p.pezzi;
      sissOra = false;
    }
    for (const d of pdf) {
      const u = d.unita || unitaDiScheda(d.scheda, d.ts) || (apertaDa.has(d.scheda) ? unitaDiScheda(apertaDa.get(d.scheda), d.ts) : "");
      d.unitaVista = u;
      sissOra = isSiss(d.url);
      for (const r of d.righe || []) { osservaStringa(r, u); scopri(r); if (sissOra) scopriSiss(r); }
      sissOra = false;
    }
    for (const r of flusso) { scopri(decURI(r.url || "")); for (const v of Object.values(r.corpo || {})) scopri(String(v)); }
    // i clic sul visualizzatore: il loro indirizzo e il testo corto del bersaglio
    const clic = (Array.isArray(raccolta.clic) ? raccolta.clic : []).slice().sort((a, b) => a.ts - b.ts);
    for (const c of clic) { idDaUrl(c.url, true); const t = c.bersaglio && c.bersaglio.testo; if (t) { scopri(String(t)); scopriViewer(t); } }

    // i testi che portano altri pezzi dell'estensione (il registro, la diagnosi):
    // `raccolta.testi = [{ nome, testo }]`, escono come testi/<nome>. Codici fiscali,
    // date, telefoni, numeri: come altrove. Le persone: quelle di tutto lo zip (le
    // pagine, `raccolta.nomi`), più quelle che si trovano solo qui — «Paziente: …»,
    // «Sig. …», e (non nella diagnosi, che è la struttura di una pagina) un COGNOME
    // NOME in maiuscolo in mezzo a una riga, senza parole del programma o cliniche.
    // Queste ultime sono indizi, non certezze: si sostituiscono solo nei testi, mai
    // nelle pagine, nei PDF o nel flusso; e mai dentro il markup (tag, doctype).
    const testiLiberi = (Array.isArray(raccolta.testi) ? raccolta.testi : []).filter((x) => x && typeof x.testo === "string");
    const URL_IN_TESTO = /https?:\/\/[^\s"'<>)]*[^\s"'<>).,;:]/g;
    const MAIUSCOLE_RE = /(?<![A-Za-zÀ-ÿ'’])[A-ZÀ-Ù][A-ZÀ-Ù'’]+(?:[ \t]+[A-ZÀ-Ù][A-ZÀ-Ù'’]+){1,3}(?![A-Za-zÀ-ÿ'’])/g;
    const MARKUP_RE = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<[!?/]?[A-Za-z][^<>]*>/gi;
    const diagnosi = (x) => /^diagnosi/i.test(String(x.nome || ""));
    // fn sul testo fuori dal markup; il markup resta com'è, byte per byte (o passa da fnM)
    const fuoriDalMarkup = (s, fn, fnM = (m) => m) => { let out = "", i = 0; for (const m of s.matchAll(MARKUP_RE)) { out += fn(s.slice(i, m.index)) + fnM(m[0]); i = m.index + m[0].length; } return out + fn(s.slice(i)); };
    const PARTICELLE = new Set(["DEL", "DELLA", "DELLE", "DELLO", "DEI", "DEGLI", "DAL", "DALLA", "DALLE", "DALLO", "VAN", "VON", "SAN", "SANTA", "SANTO", "MAC"]);
    // un COGNOME NOME in mezzo a una riga: nessuna parola del programma, del catalogo, delle pagine di esempio, clinica
    const nomeNeiTesti = (t) => {
      if (areaVoce(t) || etichetta(t) || paroleApp(t)) return false;
      const w = MAIUSC(t).split(/[^A-Z']+/).filter(Boolean);
      return w.length >= 2 && !w.some((x) => x.length >= 3 && !PARTICELLE.has(x) && (PAROLE_STATICHE.has(x) || SISS_PAROLE.has(x) || VIEWER_PAROLE.has(x)));
    };
    const nomiTesti = new Map();          // NORMA → { cat, orig }: le persone trovate solo nei testi
    // Un numero di 5 o più cifre in un testo («la richiesta 880777», «(referto 4567890)») è un
    // identificativo anche se nessuna pagina registrata lo mostra: rimappato come lo stesso altrove.
    // Non un decimale, una misura in byte, un codice d'errore («ORA-20965»), un numero del vocabolario
    // (i codici negli esami del catalogo).
    const ID_TESTO_RE = /(?<![\dA-Za-z]|\d[.,]|[A-Za-z]-)\d{5,}(?![\dA-Za-z]|[.,]\d|\s?(?:B|byte|bytes|KB|kB|MB)\b)/g;
    // …né un valore di laboratorio: sulla riga «valori:» del Registro quello che segue un «=» («righe non
    // lette: NT-proBNP = 12500 · …», core.js), e fuori dalla diagnosi un numero dopo il nome di un analita
    // e « = » («CK-MB = 23456»). Se no ogni 12500 di ogni file diventerebbe un numero finto, intervalli
    // compresi. («EPISODIO_ID=150101», senza spazi, e nella diagnosi «var idReferto = 4567890» restano
    // identificativi: lì è la struttura di una pagina, coi suoi script.)
    const VALORI_RE = /\s=\s*[^·—]*/g, VALORE_RE = /(?<=\S)\s+=\s*[<>≤≥]?\s*\d[\d.,]*/g;
    const numeriVoc = new Set();
    if (testiLiberi.length) {
      for (const s of STATICO) for (const m of s.matchAll(/\d{5,}/g)) numeriVoc.add(m[0]);
      for (const [s, u] of testi) if (u.size >= 2) for (const m of s.matchAll(/\d{5,}/g)) numeriVoc.add(m[0]);
    }
    for (const x of testiLiberi) {
      for (const riga of String(x.testo).split(/\r?\n/)) {
        const r = pulisci(decodifica(riga));
        scopriValori(r); scopriValori(pulisci(decURI(r)));
        for (const u of r.match(URL_IN_TESTO) || []) idDaUrl(u);
        const libera = r.replace(URL_IN_TESTO, " ");
        const senzaValori = /\bvalori: /.test(libera) ? libera.replace(VALORI_RE, " ") : diagnosi(x) ? libera : libera.replace(VALORE_RE, " ");
        for (const m of senzaValori.matchAll(ID_TESTO_RE)) if (!numeriVoc.has(m[0])) registraId(m[0]);
      }
      nomiLocali = nomiTesti;
      try {
        const testo = String(x.testo).replace(MARKUP_RE, " ");
        for (const riga of testo.split(/\r?\n/)) {
          const r = pulisci(decodifica(riga));
          scopriPersone(r);
          // (le righe dei valori elencano analiti, le «…» etichette del gestionale: mai persone)
          if (diagnosi(x) || /\bvalori: /.test(r)) continue;
          for (const m of r.replace(URL_IN_TESTO, " ").replace(/«[^»]*»/g, " ").matchAll(MAIUSCOLE_RE)) if (nomeNeiTesti(m[0])) registraNome(m[0], "nomi");
        }
      } finally { nomiLocali = null; }
    }

    // --------------------------------------- seconda passata: trasformare
    const files = {};
    const tipoDi = (u) => {
      const mv = paramDi(u, "MVPG");
      if (mv) return mv.replace(/[^\w-]/g, "").slice(0, 60);
      const base = String(u || "").split(/[?#]/)[0].split("/").filter(Boolean).pop() || "pagina";
      return base.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w-]/g, "").slice(0, 60) || "pagina";
    };
    // il nome di una vista del SISS, da un elenco fisso: mai un testo della pagina
    const vistaSiss = (p) => {
      let u;
      try { u = new URL(String(p.url)); } catch { return "siss"; }
      if (p.forma) return "siss-accesso";
      if (/^\/menusiss/i.test(u.pathname) || u.origin === "https://dcss.cgi.crs.lombardia.it") return "siss-menu";
      const html = String(p.html || "").replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ""), i = html.indexOf("cdk-overlay-container");
      const dialogo = i >= 0 && /mat-dialog-container|mat-mdc-dialog-container/.test(html.slice(i)) ? html.slice(i) : "";
      const strada = (u.pathname + u.hash).toLowerCase();
      if (/Stampa\s*RE\b/.test(dialogo) || (/Stampa\s*RE\b/.test(html) && !dialogo)) return "siss-registrata";
      if (/>\s*Anteprima\b/i.test(dialogo) || /anteprima|preview/.test(strada)) return "siss-anteprima";
      // (anche la pagina del lettore PDF di Chrome, che contiene il PDF della stampa)
      if (/stamp[ae]|print/.test(strada) || /<embed\b[^>]*application\/pdf/i.test(html)) return "siss-stampa";
      if (/patient-identify/.test(strada)) return "siss-patient-identify";
      if (/editing/.test(strada)) return "siss-editing";
      if (/dashboard/.test(strada)) return "siss-dashboard";
      const seg = (u.pathname.split("/").filter(Boolean).pop() || "").replace(/\.html?$/i, "");
      return /^[a-z][a-z-]{1,40}$/i.test(seg) ? "siss-" + seg.toLowerCase() : "siss-pagina";
    };
    const tabNum = new Map();
    const scheda = (id) => { if (id == null || id < 0) return null; if (!tabNum.has(id)) tabNum.set(id, tabNum.size + 1); return tabNum.get(id); };
    const sec = (ms) => Math.round((Number(ms) || 0) / 100) / 10;
    const elencoPagine = [];
    pagine.forEach((p, i) => {
      const nnn = String(i + 1).padStart(3, "0");
      const tipo = p.siss ? vistaSiss(p) : p.viewer ? "eviewer-" + tipoDi(p.url) : tipoDi(p.url);
      const nome = `pagine/${nnn}-${tipo}.html`;
      const corpo = trattaPagina(p.html, p.unita, p.siss, p.viewer);
      const url = anonUrl(p.url, "flusso");
      const testa = `<!-- PS Assist, registrazione anonimizzata: pagina ${nnn} · ${url.replace(/--/g, "- -")} · +${sec(p.ts - inizio)} s · scheda ${scheda(p.scheda) ?? "?"}${p.alto === false ? " · riquadro" : ""} · ${p.motivo || "caricata"} -->\n`;
      files[nome] = testa + corpo;
      sissOra = p.siss; viewerOra = p.viewer;
      const titolo = trattaStringa(p.titolo || "");
      sissOra = false; viewerOra = false;
      if (p.viewer) p.tecnicaFinta = tecnicaFinta(p.tecnica);
      elencoPagine.push({ file: nome, tipo, url, t: sec(p.ts - inizio), scheda: scheda(p.scheda), riquadro: p.alto === false, motivo: p.motivo || "caricata", titolo,
        ...(p.siss ? { siss: true, ...(p.forma ? { forma: true } : {}), ...(p.credenziali ? { credenziali: p.credenziali } : {}) } : {}),
        ...(p.viewer ? { viewer: true } : {}) });
    });
    const da = (r) => (r.registratore ? "registratore" : r.estensione ? "estensione" : "pagina");
    const corpoFinto = (c, vw = false) => {
      if (!c) return undefined;
      const o = {}, vp = vw ? valoreParamViewer : valoreParam;
      for (const [k, v] of Object.entries(c)) o[k] = credenziale(k) ? ["(credenziale: non registrata)"] : Array.isArray(v) ? v.map((x) => vp(k, String(x))) : vp(k, String(v));
      return o;
    };
    // il visualizzatore: delle sue risposte la misura e come si tengono in cache (solo forme note)
    const intestazioniFinte = (h) => {
      if (!h || typeof h !== "object") return {};
      const o = {};
      if (typeof h.tipo === "string" && /^[\w.+/-]+(?:;\s*[\w.-]+=(?:"[\w.+/ -]*"|[\w.+/-]*))*$/.test(h.tipo)) o.tipo = h.tipo;
      if (typeof h.cache === "string") o.cache = /^[\w\s=,"-]{1,120}$/.test(h.cache) ? h.cache : "(altro)";
      for (const k of ["etag", "ultimaModifica", "scade"]) if (h[k] === true) o[k] = true;
      for (const [k, re] of [["codifica", /^[\w,\s-]{1,30}$/], ["intervalli", /^[\w-]{1,20}$/], ["vary", /^[\w\s,-]{1,80}$/], ["pragma", /^[\w-]{1,30}$/]]) if (typeof h[k] === "string" && re.test(h[k])) o[k] = h[k];
      return { ...(Number.isFinite(h.lunghezza) ? { misura: h.lunghezza } : {}), intestazioni: o };
    };
    const richieste = flusso.map((r) => {
      const vw = !!r.viewer || isViewer(r.url);
      return {
        metodo: r.metodo, url: anonUrl(r.url, "flusso"), tipo: r.tipo, scheda: scheda(r.scheda), riquadro: r.frame > 0 || undefined,
        da: da(r), inizio: sec(r.inizio - inizio), fine: r.fine != null ? sec(r.fine - inizio) : null,
        durata: r.fine != null ? sec(r.fine - r.inizio) : null, stato: r.stato ?? null, contenuto: r.contenuto || undefined,
        daCache: r.daCache || undefined, errore: r.errore || undefined, corpo: corpoFinto(r.corpo, vw),
        rinvii: (r.rinvii || []).map((x) => ({ stato: x.stato, a: anonUrl(x.a, "flusso"), t: sec(x.t - inizio) })),
        pdf: r.pdf || undefined, siss: r.siss || isSiss(r.url) || undefined, nonRiletto: r.nonRiletto || undefined,
        ...(vw ? { viewer: true, ...intestazioniFinte(r.intestazioni), ...(r.iniziatore ? { iniziatore: anonUrl(r.iniziatore, "flusso") } : {}) } : {}),
      };
    });
    const schede = (raccolta.schede || []).map((s) => ({ scheda: scheda(s.id), apertaDa: scheda(s.apertaDa), finestra: s.finestra, popup: !!s.popup || undefined, t: sec(s.ts - inizio) }));
    const elencoPdf = [];
    pdf.forEach((d, i) => {
      const nnn = String(i + 1).padStart(3, "0");
      const o = {
        url: anonUrl(d.url, "flusso"), t: sec(d.ts - inizio), scheda: scheda(d.scheda), da: d.origine || "pagina",
        pagine: d.pagine ?? null, misura: d.misura || null, lettore: d.lettore || null,
        righe: (d.righe || []).map((r) => { sissOra = isSiss(d.url); try { return trattaStringa(r); } finally { sissOra = false; } }), ...(d.errore ? { errore: String(d.errore).slice(0, 120) } : {}),
      };
      files[`pdf/${nnn}.json`] = JSON.stringify(o, null, 1);
      elencoPdf.push({ file: `pdf/${nnn}.json`, url: o.url, t: o.t, pagine: o.pagine, righe: o.righe.length, da: o.da });
    });
    files["flusso.json"] = JSON.stringify({ inizio: 0, unita: "secondi dall'inizio", schede, pagine: elencoPagine, pdf: elencoPdf, richieste }, null, 1);

    // il visualizzatore: la sua forma tecnica (numeri, tipi, indirizzi anonimizzati) e i clic
    function tecnicaFinta(t) {
      if (!t || typeof t !== "object") return null;
      viewerOra = true;
      try {
        const num = (x) => (Number.isFinite(x) ? x : null);
        const numeri = (a) => (Array.isArray(a) && a.length <= 4 && a.every((x) => Number.isFinite(x)) ? a : null);
        const tipo = (x) => (typeof x === "string" && /^(?:data:[\w.+/-]{0,40}|blob:|http|vuoto|altro)$/.test(x) ? x : "altro");
        const ind = (u) => (typeof u === "string" && u ? anonUrl(u, "flusso") : undefined);
        const conti = (o, re) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k]) => re.test(k)).slice(0, 60)
          .map(([k, v]) => [k, Number.isFinite(v) ? v : Object.fromEntries(Object.entries(v && typeof v === "object" ? v : {}).filter(([, x]) => Number.isFinite(x)).slice(0, 10))]));
        const lista = (l, n) => (Array.isArray(l) ? l.slice(0, n).filter((x) => x && typeof x === "object") : []);
        return {
          sonda: !!t.sonda, elementi: num(t.elementi),
          canvas: lista(t.canvas, 60).map((c) => ({ larghezza: num(c.larghezza), altezza: num(c.altezza), schermo: numeri(c.schermo),
            contesto: /^[\w-]{1,24}$/.test(c.contesto || "") ? c.contesto : null, preserveDrawingBuffer: typeof c.preserveDrawingBuffer === "boolean" ? c.preserveDrawingBuffer : null,
            ...(c.willReadFrequently === true ? { willReadFrequently: true } : {}) })),
          immagini: lista(t.immagini, 100).map((x) => ({ tipo: tipo(x.tipo), ...(x.indirizzo ? { indirizzo: ind(x.indirizzo) } : {}),
            ...(Number.isFinite(x.caratteri) ? { caratteri: x.caratteri } : {}), naturale: numeri(x.naturale), schermo: numeri(x.schermo), n: num(x.n) })),
          sfondi: lista(t.sfondi, 20).map((x) => ({ tipo: tipo(x.tipo), n: num(x.n) })),
          riquadri: lista(t.riquadri, 20).map((x) => ({ tipo: tipo(x.tipo), ...(x.indirizzo ? { indirizzo: ind(x.indirizzo) } : {}), schermo: numeri(x.schermo) })),
          video: num(t.video), svg: num(t.svg), oggetti: num(t.oggetti),
          script: (Array.isArray(t.script) ? t.script : []).slice(0, 60).map(ind).filter(Boolean), scriptNellaPagina: num(t.scriptNellaPagina),
          risorse: lista(t.risorse, 300).map((x) => {
            const m = /^([A-Za-z-]{1,20}) (.*)$/.exec(String(x.chiave || "")) || [];
            return { tipo: (m[1] || "altro").toLowerCase(), indirizzo: ind(m[2] || "") || "", n: num(x.n), trasferiti: num(x.trasferiti), corpo: num(x.corpo),
              decodificati: num(x.decodificati), max: num(x.max), ms: num(x.ms), cache: num(x.cache) };
          }),
          ...(t.contesti ? { contesti: conti(t.contesti, /^[\w-]{1,24}$/) } : {}),
          ...(t.disegni ? { disegni: conti(t.disegni, /^[\w -]{1,60}$/) } : {}),
          ...(t.blob ? { blob: conti(t.blob, /^[\w.+/ -]{1,60}$/) } : {}),
          ...(t.websocket ? { websocket: lista(t.websocket, 20).map((w) => ({ percorso: ind(w.percorso) || "", parametri: (Array.isArray(w.parametri) ? w.parametri : []).filter((k) => /^[\w.-]{1,40}$/.test(k)).slice(0, 20),
            ricevuti: num(w.ricevuti), binari: num(w.binari), byteRicevuti: num(w.byteRicevuti), mandati: num(w.mandati), byteMandati: num(w.byteMandati), chiusa: w.chiusa === true })) } : {}),
        };
      } finally { viewerOra = false; }
    }
    const clicFinti = clic.map((c) => {
      viewerOra = true;
      try {
        const b = c.bersaglio && typeof c.bersaglio === "object" ? c.bersaglio : {};
        const numeri = (a) => (Array.isArray(a) && a.length <= 4 && a.every((x) => Number.isFinite(x)) ? a : undefined);
        const img = b.img && typeof b.img === "object" ? b.img : null;
        return {
          t: sec(c.ts - inizio), tipo: c.tipo === "dblclick" ? "dblclick" : "click", scheda: scheda(c.scheda), ...(c.frame > 0 ? { riquadro: true } : {}),
          pagina: anonUrl(c.url, "flusso"),
          bersaglio: {
            strada: (Array.isArray(b.strada) ? b.strada : []).slice(0, 5).filter((n) => n && typeof n === "object").map((n) => ({
              tag: /^[a-z][a-z0-9-]{0,30}$/.test(n.tag || "") ? n.tag : "?", ...(n.id ? { id: cifreViewer(String(n.id).slice(0, 80)) } : {}),
              ...(n.classe ? { classe: cifreViewer(String(n.classe).slice(0, 120)) } : {}), ...(/^[\w-]{1,30}$/.test(n.ruolo || "") ? { ruolo: n.ruolo } : {}) })),
            ...(b.testo ? { testo: trattaStringa(String(b.testo).slice(0, 80)) } : {}), ...(numeri(b.schermo) ? { schermo: numeri(b.schermo) } : {}),
            ...(img ? { img: { tipo: /^(?:data:[\w.+/-]{0,40}|blob:|http|vuoto|altro)$/.test(img.tipo || "") ? img.tipo : "altro",
              ...(img.indirizzo ? { indirizzo: anonUrl(String(img.indirizzo), "flusso") } : {}), ...(numeri(img.naturale) ? { naturale: numeri(img.naturale) } : {}) } } : {}),
            ...(b.canvas === true ? { canvas: true } : {}),
          },
        };
      } finally { viewerOra = false; }
    });
    const pagViewer = pagine.filter((p) => p.viewer), rqViewer = richieste.filter((r) => r.viewer);
    if (pagViewer.length || rqViewer.length || clicFinti.length) {
      files["eviewer.json"] = JSON.stringify({ unita: "secondi dall'inizio; nessuna immagine, nessun dato: la forma tecnica del visualizzatore",
        pagine: pagine.map((p, i) => (p.viewer ? { file: elencoPagine[i].file, t: elencoPagine[i].t, scheda: elencoPagine[i].scheda, riquadro: elencoPagine[i].riquadro,
          motivo: elencoPagine[i].motivo, tecnica: p.tecnicaFinta || null } : null)).filter(Boolean),
        clic: clicFinti }, null, 1);
    }
    // il registro degli errori dell'estensione (dall'ultima registrazione
    // esportata): i tempi come il flusso, il resto passa dalla ripulitura e dal cancello
    const errori = (Array.isArray(raccolta.errori) ? raccolta.errori : []).map(({ ts, ...x }) => ({ t: Math.round(((ts || 0) - (raccolta.inizio || 0)) / 1000), ...x }));
    files["errori.json"] = JSON.stringify({ unita: "secondi dall'inizio della registrazione", errori }, null, 1);
    // i testi liberi: riga per riga indirizzi, codici fiscali, email, telefoni, numeri e date
    // come per il resto; i nomi li sostituisce la ripulitura qui sotto, come per ogni file.
    // In più: il testo che il medico ha scritto e che il programma riporta nel Registro (un
    // promemoria dal telefono: «promemoria per X: 10:30 · <testo> · tra 25 min») diventa
    // testo inventato della stessa lunghezza — l'ora e il «tra …» restano; e l'ospedale e il
    // fornitore (una pagina inattesa citata per intero) diventano quelli d'esempio.
    const PROMEMORIA_RE = /(\bpromemoria(?: fatto)? per [^:\n]{1,80}: )(.+)$/;
    const promemoriaFinto = (riga) => riga.replace(PROMEMORIA_RE, (all, testa, resto) => testa + resto.split(" · ").map((p) => {
      const q = p.trim();
      if (!q || /^(?:(?:domani|ieri) )?\d{1,2}:\d{2}$|^(?:tra|in ritardo di) \d+ (?:h|min)\b|^adesso$/.test(q)) return p;
      conta.liberi++; contaDentro(q);
      return p.replace(q, sintetico(q));
    }).join(" · "));
    // (nel markup di una diagnosi una parola sola, senza spazi: un attributo resta un attributo)
    const MARCHI_TESTI = MARCHI.filter((re) => !/PS Assist|connesso/i.test(re.source)).map((re) => new RegExp(re.source, "gi"));
    const marchiFinti = (s, tag = false) => MARCHI_TESTI.reduce((t, re) => t.replace(re, (m) => (conta.testo++, tag ? "esempio" : /diritti|AFC|java/i.test(m) ? "software di esempio" : "OSPEDALE ESEMPIO")), s);
    testiLiberi.forEach((x, i) => {
      const base = String(x.nome || "testo.txt").replace(/[^\w.-]/g, "_").replace(/\.{2,}/g, ".").replace(/^\./, "_").slice(0, 60) || "testo.txt";
      const nome = files[`testi/${base}`] != null ? `testi/${i + 1}-${base}` : `testi/${base}`;
      const t = String(x.testo).split(/\r?\n/).map((riga) => motivi(promemoriaFinto(riga).replace(URL_IN_TESTO, (u) => anonUrl(u, "flusso")))).join("\n");
      files[nome] = fuoriDalMarkup(t, (s) => marchiFinti(s), (m) => marchiFinti(m, true));
    });

    // ------------------------------------------ terza passata: ripulire
    // Quello che è stato visto di vero e sostituito in un punto, sostituito
    // anche dove fosse sfuggito (uno script, un nome di finestra, un CSS).
    const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const SEP = "(?:[^A-Za-z0-9À-ÿ&%]|&nbsp;|%[0-9A-Fa-f]{2})+";
    const nomiRe = [...nomiVisti.values()].map((x) => x.orig).sort((a, b) => b.length - a.length)
      .map((o) => o.split(/\s+/).map(escRe).join(SEP));
    const reNomi = nomiRe.length ? new RegExp(`(?<![A-Za-zÀ-ÿ])(?:${nomiRe.join("|")})(?![A-Za-zÀ-ÿ])`, "gi") : null;
    const letterali = new Map();
    for (const v of visto.cf) letterali.set(v, () => cfFinto(v));
    for (const v of visto.email) letterali.set(v, () => "utente@esempio.it");
    for (const v of [...visto.telefoni, ...visto.tessere]) if (v.length >= 6) letterali.set(v, () => v.replace(/\d/g, "0"));
    for (const v of visto.nascita) letterali.set(v, () => (/^\d{8}$/.test(v) ? dateDicom(v) : date(v)));
    const idAlfa = [...idOriginali].filter((v) => !/^\d+$/.test(v)).sort((a, b) => b.length - a.length);
    const reIdAlfa = idAlfa.length ? new RegExp(`(?<![A-Za-z0-9])(?:${idAlfa.map(escRe).join("|")})(?![A-Za-z0-9])`, "g") : null;
    const parolePers = [...parolePersona.keys()].filter((w) => w.length >= 3).sort((a, b) => b.length - a.length);
    const rePers = parolePers.length ? new RegExp(`(?<![A-Za-zÀ-ÿ])(?:${parolePers.map(escRe).join("|")})(?![A-Za-zÀ-ÿ])`, "gi") : null;
    const reLett = letterali.size ? new RegExp([...letterali.keys()].sort((a, b) => b.length - a.length).map(escRe).join("|"), "g") : null;
    // I dati da cercare, come li cerca il cancello: ogni nome visto (un paziente di
    // due parole anche girato, «MARIO ROSSI»; i cognomi del SISS da soli), e ogni
    // identificativo, data di nascita, telefono, tessera, email visti.
    const daCercare = [];
    for (const { cat, orig } of nomiVisti.values()) {
      daCercare.push({ cat, testo: orig, orig });
      const w = orig.trim().split(/\s+/);
      if (cat === "nomi" && w.length === 2 && w.every((x) => x.length >= 3)) daCercare.push({ cat, testo: `${w[1]} ${w[0]}`, orig, girato: true });
    }
    for (const [w, e] of parolePersona) if (e.cognome && w.length >= 4) daCercare.push({ cat: "nomi", testo: w, orig: w, parola: true });
    for (const v of idOriginali) if (v.length >= 5) daCercare.push({ cat: "id", testo: v, fn: () => fintoId(v) });
    for (const v of visto.nascita) if (date(v) !== v || /^\d{8}$/.test(v)) daCercare.push({ cat: "nascita", testo: v, fn: letterali.get(v) });
    for (const v of visto.telefoni) daCercare.push({ cat: "telefoni", testo: v, fn: () => v.replace(/\d/g, "0") });
    for (const v of visto.tessere) daCercare.push({ cat: "tessere", testo: v, fn: () => v.replace(/\d/g, "0") });
    for (const v of visto.email) daCercare.push({ cat: "email", testo: v, fn: () => "utente@esempio.it" });
    const indiceNomi = new Map();
    for (const x of daCercare) {
      const n = norma(x.testo);
      if (n.trim().length < 4) continue;
      x.parole = n.trim().split(" ");
      if (!indiceNomi.has(x.parole[0])) indiceNomi.set(x.parole[0], []);
      indiceNomi.get(x.parole[0]).push(x);
    }
    // La stessa lettura del cancello (entità, %XX UTF-8 o latin1, accenti e apostrofi
    // che non contano, ogni segno un separatore): quello che il cancello conta, qui
    // si trova e si sostituisce — anche in una frase tenuta come vocabolario, in uno
    // script, in un indirizzo, con un altro separatore o un'altra forma. Il separatore
    // del posto (%20, _, -, &nbsp;) resta; il nome finto ha le stesse maiuscole del vero.
    const nomiComeIlCancello = (t) => {
      if (!indiceNomi.size) return t;
      const L = lettura(t, true), w = L.parole;
      if (!w.length) return t;
      const fintiN = new Set([...finti.values()].map(norma));
      let out = "", fine = 0;
      for (let i = 0; i < w.length; i++) {
        const l = indiceNomi.get(w[i].w);
        if (!l) continue;
        let meglio = null;
        for (const e of l) {
          if (i + e.parole.length > w.length || fintiN.has(norma(e.testo))) continue;
          let ok = true;
          for (let j = 1; j < e.parole.length; j++) if (w[i + j].w !== e.parole[j]) { ok = false; break; }
          if (ok && (!meglio || e.parole.length > meglio.parole.length || (e.parole.length === meglio.parole.length && meglio.girato && !e.girato))) meglio = e;
        }
        if (!meglio) continue;
        const j = i + meglio.parole.length - 1, da = w[i].da, a = w[j].a;
        if (da < fine) continue;
        if (meglio.fn) {
          // il dato finto con i separatori che il posto aveva («12-03-1950» resta con i trattini)
          let f = meglio.fn();
          const pezzi = f.match(/[A-Za-z0-9]+/g) || [];
          if (j > i && pezzi.length === j - i + 1 && !/@/.test(f)) f = pezzi.map((x, k) => (k ? t.slice(w[i + k - 1].a, w[i + k].da) : "") + x).join("");
          out += t.slice(fine, da) + f; fine = a; i = j; continue;
        }
        let f = meglio.parola ? parolaFinta(meglio.orig) : meglio.girato ? nomeFinto(meglio.orig, "nomi").split(" ").reverse().join(" ") : nomeFinto(meglio.orig, meglio.cat);
        f = /[a-zà-ÿ]/.test(t.slice(da, a).replace(/%[0-9A-F]{2}|&#?\w+;/gi, " ")) ? f.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : f.toUpperCase();
        const sep = j > i ? t.slice(w[i].a, w[i + 1].da) : " ";
        const sepFinto = /^%20$/i.test(sep) ? "%20" : /^&nbsp;$/i.test(sep) ? "&nbsp;" : /^[_+.-]$/.test(sep) ? sep : " ";
        out += t.slice(fine, da) + f.replace(/ /g, sepFinto);
        fine = a; i = j;
      }
      return fine ? out + t.slice(fine) : t;
    };
    const ripulisci = (s) => {
      let t = s;
      if (reNomi) t = t.replace(reNomi, (m) => nomeFinto(m.replace(/&nbsp;|%[0-9A-Fa-f]{2}|[^A-Za-z0-9À-ÿ]+/g, " ").trim(), (nomiVisti.get(norma(m.replace(/&nbsp;|%[0-9A-Fa-f]{2}/g, " "))) || {}).cat));
      t = nomiComeIlCancello(t);
      if (rePers) t = t.replace(rePers, (m) => (parolePersona.has(MAIUSC(m)) ? parolaFinta(m) : m));
      if (reLett) t = t.replace(reLett, (m) => letterali.get(m)());
      if (reIdAlfa) t = t.replace(reIdAlfa, (m) => fintoId(m));
      t = t.replace(/(?<![\dA-Za-z])\d{5,}(?![\dA-Za-z])/g, (d) => (idOriginali.has(d) ? fintoId(d) : d));
      return t;
    };
    // le persone trovate solo nei testi: sostituite lì (fuori dal markup), e solo lì
    const locali = [...nomiTesti.values()].filter((x) => !nomiVisti.has(norma(x.orig)));
    const reLocali = locali.length ? new RegExp(`(?<![A-Za-zÀ-ÿ])(?:${locali.map((x) => x.orig).sort((a, b) => b.length - a.length)
      .map((o) => o.split(/\s+/).map(escRe).join(SEP)).join("|")})(?![A-Za-zÀ-ÿ])`, "gi") : null;
    const localiNeiTesti = (s) => (!reLocali ? s : fuoriDalMarkup(s, (t) => t.replace(reLocali, (m) => {
      const v = m.replace(/&nbsp;|%[0-9A-Fa-f]{2}|[^A-Za-z0-9À-ÿ'’]+/g, " ").trim();
      return nomeFinto(v, (nomiTesti.get(norma(v)) || {}).cat || "nomi");
    })));
    for (const k of Object.keys(files)) files[k] = ripulisci(k.startsWith("testi/") ? localiNeiTesti(files[k]) : files[k]);

    // ------------------------------------------------- il riepilogo
    const conteggi = {
      "nomi di pazienti": conta.nomi, "personale e utenti": conta.personale, "codici fiscali": conta.cf, "date di nascita": conta.nascita,
      "tessere sanitarie": conta.tessere, "telefoni": conta.telefoni, "indirizzi": conta.indirizzi, "email": conta.email,
      "testi liberi": conta.liberi, "identificativi rimappati": conta.id, "altro testo sostituito": conta.testo,
      "parametri di indirizzi": conta.url, "immagini tolte": conta.immagini, "stringhe tenute (vocabolario)": conta.tenute,
    };
    const perTipo = {};
    for (const p of elencoPagine) perTipo[p.tipo] = (perTipo[p.tipo] || 0) + 1;
    const dellEstensione = richieste.filter((r) => r.da === "estensione").length;
    const riletti = pdf.filter((d) => d.origine === "rilettura").length;
    // il SISS, a parte: che viste, quante richieste, se c'è il PDF della ricetta
    const pagSiss = pagine.filter((p) => p.siss), rqSiss = richieste.filter((r) => r.siss), pdfSiss = pdf.filter((d) => isSiss(d.url));
    const sezioneSiss = () => {
      if (!pagSiss.length && !rqSiss.length && !pdfSiss.length) return [];
      const conta1 = (l) => { const o = {}; for (const x of l) o[x] = (o[x] || 0) + 1; return Object.entries(o).map(([k, v]) => `${k} ${v}`).join(", ") || "nessuna"; };
      const fuori = new Set();
      for (const p of pagSiss) for (const o of p.fuori || []) {
        if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(o)) continue;
        const f = origineFinta(o.toLowerCase(), "flusso");
        fuori.add(f != null ? f : MARCHI.some((re) => re.test(o)) ? "un host dell'ospedale" : o.toLowerCase());
      }
      const nonRiletti = rqSiss.filter((r) => r.pdf && r.nonRiletto).length;
      return [
        "SISS (menu operatore e Prescrittivo Regionale):",
        `  Viste: ${conta1(elencoPagine.filter((x) => x.siss).map((x) => x.tipo))}`,
        `  Istantanee: ${pagSiss.length} (${conta1(pagSiss.map((p) => p.motivo || "caricata"))})`,
        `  Richieste al SISS: ${rqSiss.length} (XHR/fetch ${rqSiss.filter((r) => /xmlhttprequest|fetch/.test(r.tipo || "")).length}, rinvii ${rqSiss.reduce((n, r) => n + r.rinvii.length, 0)}, errori ${rqSiss.filter((r) => r.errore).length}, PDF ${rqSiss.filter((r) => r.pdf).length})`,
        `  PDF «Stampa RE»: ${pdfSiss.length ? `sì — ${pdfSiss.length} (testo letto in ${pdfSiss.filter((d) => (d.righe || []).length).length})` : "no"}${nonRiletti ? `; ${nonRiletti} aperti ma non riletti (il server non li lascia in cache)` : ""}`,
        `  Credenziali (password, PIN, OTP): mai registrate — campi esclusi ${pagSiss.reduce((n, p) => n + (Number(p.credenziali) || 0), 0)}; pagine o dialoghi solo nella forma: ${pagSiss.filter((p) => p.forma).length}`,
        `  Host fuori dal SISS chiamati dalle sue pagine (non registrati): ${[...fuori].sort().join(", ") || "nessuno"}`,
        "",
      ];
    };
    // Il visualizzatore, a parte: com'è fatto (per decidere come mostrare le
    // immagini), da quello che è già anonimizzato — nessun dato, nessuna immagine.
    // Un indirizzo diventa un modello: {uid}, {n}, {id} al posto dei numeri, della query solo i nomi
    // (e i valori dei parametri tecnici: requestType, contentType…).
    const modello = (u) => {
      const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?/i.exec(String(u || "")) || [];
      const seg = (s) => {
        const est = (/\.[A-Za-z]\w{0,4}$/.exec(s) || [""])[0], b = est ? s.slice(0, -est.length) : s;
        if (/^[0-2](?:\.\d+){3,}$/.test(b)) return "{uid}" + est;
        if (/^\d+$/.test(b)) return "{n}" + est;
        if (/\d/.test(b) && /^[\w.-]{8,}$/.test(b)) return "{id}" + est;
        return s;
      };
      const q = m[3] ? [...new Set(m[3].slice(1).split("&").filter(Boolean).map((p) => {
        const i = p.indexOf("="), k = i < 0 ? p : p.slice(0, i), v = i < 0 ? "" : decURI(p.slice(i + 1));
        return VIEWER_TECNICO.test(k) && /^[A-Za-z][\w./+-]{0,40}$/.test(v) ? `${k}=${v}` : k;
      }))].sort() : [];
      return (m[1] || "") + (m[2] || "").split("/").map(seg).join("/") + (q.length ? "?" + q.join("&") : "");
    };
    const misuraDi = (b) => (b == null ? "?" : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
    const sezioneViewer = () => {
      if (!pagViewer.length && !rqViewer.length && !clicFinti.length) return [];
      const conta1 = (l) => { const o = {}; for (const x of l) o[x] = (o[x] || 0) + 1; return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "nessuna"; };
      const forma = (a) => (Array.isArray(a) ? a.join("×") : "?");
      const sino = (x) => (x === true ? "sì" : x === false ? "no" : "?");
      // le richieste per modello di indirizzo: quante, che contenuto, quanto pesano, come stanno in cache
      const gruppi = new Map();
      for (const r of rqViewer) {
        const k = `${r.metodo} ${modello(r.url)}`;
        if (!gruppi.has(k)) gruppi.set(k, []);
        gruppi.get(k).push(r);
      }
      const immagine = (r) => r.tipo === "image" || /^image\/|dicom|octet-stream|multipart/.test(r.contenuto || "");
      const riga = (k, l) => {
        const mis = l.map((r) => r.misura).filter(Number.isFinite).sort((a, b) => a - b);
        const cc = [...new Set(l.map((r) => (r.intestazioni && r.intestazioni.cache) || "nessuno"))];
        return `    ${k} — ${l.length}× ${[...new Set(l.map((r) => (r.intestazioni && r.intestazioni.tipo) || r.contenuto || "?"))].join(" / ")} [${[...new Set(l.map((r) => r.tipo))].join(", ")}]`
          + `; ${mis.length ? `${misuraDi(mis[0])}–${misuraDi(mis[mis.length - 1])} (mediana ${misuraDi(mis[Math.floor(mis.length / 2)])})` : "misura non detta (niente Content-Length)"}`
          + `; Cache-Control «${cc.join("» «")}»; ETag ${l.filter((r) => r.intestazioni && r.intestazioni.etag).length}/${l.length}`
          + `; Last-Modified ${l.filter((r) => r.intestazioni && r.intestazioni.ultimaModifica).length}/${l.length}; dalla cache ${l.filter((r) => r.daCache).length}/${l.length}`
          + `; stato ${[...new Set(l.map((r) => r.errore ? "errore" : r.stato))].join(", ")}`;
      };
      const tutti = [...gruppi].sort((a, b) => b[1].length - a[1].length);
      const img = tutti.filter(([, l]) => l.some(immagine)), altre = tutti.filter(([, l]) => !l.some(immagine));
      // l'ultima descrizione tecnica di ogni documento del visualizzatore (scheda, riquadro, indirizzo)
      const ultime = new Map();
      pagine.forEach((p, i) => { if (p.viewer && p.tecnicaFinta) ultime.set(`${elencoPagine[i].scheda}|${elencoPagine[i].riquadro}|${modello(elencoPagine[i].url)}`, { p: elencoPagine[i], t: p.tecnicaFinta }); });
      const doc = [];
      for (const { p, t } of ultime.values()) {
        const canvas = t.canvas || [];
        const contesti = Object.entries(t.contesti || {}).map(([k, v]) => `${k} ${v.n || 0} (preserveDrawingBuffer ${v.pdb || 0})`).join(", ");
        const ws = t.websocket || [];
        const blob = Object.entries(t.blob || {}).map(([k, v]) => `${k} ×${v.n || 0} (${misuraDi(v.byte || 0)})`).join(", ");
        // (le risorse, raccolte per modello: due UID diversi sono lo stesso modello)
        const perModello = new Map();
        for (const x of t.risorse || []) {
          const k = `${x.tipo} ${modello(x.indirizzo)}`, y = perModello.get(k) || { tipo: x.tipo, modello: modello(x.indirizzo), n: 0, corpo: 0, max: 0, decodificati: 0, trasferiti: 0, cache: 0, ms: 0 };
          for (const c of ["n", "corpo", "decodificati", "trasferiti", "cache", "ms"]) y[c] += x[c] || 0;
          y.max = Math.max(y.max, x.max || 0);
          perModello.set(k, y);
        }
        const ris = [...perModello.values()].sort((a, b) => b.n - a.n).slice(0, 15);
        doc.push(`  Documento ${modello(p.url)} (scheda ${p.scheda ?? "?"}${p.riquadro ? ", riquadro" : ""}; sonda ${t.sonda ? "sì" : "no"}; ${t.elementi ?? "?"} elementi):`,
          `    Canvas: ${canvas.length}${canvas.length ? " — " + canvas.slice(0, 12).map((c) => `${c.contesto || "senza contesto"} ${c.larghezza}×${c.altezza} (sullo schermo ${forma(c.schermo)}, preserveDrawingBuffer ${sino(c.preserveDrawingBuffer)}${c.willReadFrequently ? ", willReadFrequently" : ""})`).join("; ") : ""}`,
          `    Contesti creati (anche fuori dal documento): ${contesti || "nessuno"}`,
          `    Disegno sui canvas (da dove): ${Object.entries(t.disegni || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "niente visto"}`,
          `    Miniature e immagini <img>: ${(t.immagini || []).reduce((n, x) => n + (x.n || 0), 0)}${(t.immagini || []).length ? " — " + t.immagini.slice(0, 10).map((x) => `${x.tipo} ×${x.n}${x.indirizzo ? " " + modello(x.indirizzo) : ""} (${forma(x.naturale)}${Number.isFinite(x.caratteri) ? `, ~${misuraDi(Math.round(x.caratteri * 0.75))} in base64` : ""})`).join("; ") : ""}`,
          `    Sfondi CSS con url(): ${(t.sfondi || []).map((x) => `${x.tipo} ×${x.n}`).join(", ") || "nessuno"}`,
          `    Riquadri (iframe): ${(t.riquadri || []).length}${(t.riquadri || []).length ? " — " + t.riquadri.map((x) => `${x.tipo}${x.indirizzo ? " " + modello(x.indirizzo) : ""} (${forma(x.schermo)})`).join("; ") : ""}`,
          `    WebSocket: ${ws.length ? ws.map((w) => `${modello(w.percorso)}${w.parametri.length ? " (parametri " + w.parametri.join(", ") + ")" : ""}: ricevuti ${w.ricevuti} (binari ${w.binari}, ${misuraDi(w.byteRicevuti)}), mandati ${w.mandati} (${misuraDi(w.byteMandati)})${w.chiusa ? ", chiuso" : ""}`).join("; ") : t.sonda ? "nessuno" : "? (senza sonda)"}`,
          `    Blob diventati indirizzi (URL.createObjectURL): ${blob || (t.sonda ? "nessuno" : "?")}`,
          `    Video ${t.video ?? "?"}, SVG ${t.svg ?? "?"}, object/embed ${t.oggetti ?? "?"}; script nella pagina ${t.scriptNellaPagina ?? "?"}`,
          `    Script: ${(t.script || []).map(modello).join(", ") || "nessuno"}`,
          `    Resource Timing (le misure del browser), per modello: ${ris.length ? "" : "nessuna"}`,
          ...ris.map((x) => `      ${x.tipo} ${x.modello} — ${x.n}×, corpo ${misuraDi(x.corpo)} (max ${misuraDi(x.max)}), decodificati ${misuraDi(x.decodificati)}, trasferiti ${misuraDi(x.trasferiti)}, dalla cache ${x.cache}, ${Math.round((x.ms || 0) / Math.max(1, x.n || 1))} ms in media`));
      }
      // i clic: che richieste seguono, nei 3 secondi dopo (o fino al clic dopo)
      const clicRighe = clicFinti.slice(0, 30).map((c, i) => {
        const b = c.bersaglio || {}, n0 = (b.strada || [])[0] || {};
        const dove = `${n0.tag || "?"}${n0.classe ? "." + n0.classe.split(/\s+/).join(".") : ""}${n0.id ? "#" + n0.id : ""}`;
        const fino = Math.min(c.t + 3, i + 1 < clicFinti.length ? clicFinti[i + 1].t - 0.05 : Infinity);
        const dopo = rqViewer.filter((r) => r.inizio >= c.t - 0.05 && r.inizio <= fino);
        const per = new Map();
        for (const r of dopo) { const k = `${r.metodo} ${modello(r.url)} ${(r.intestazioni && r.intestazioni.tipo) || r.contenuto || "?"}`; per.set(k, [...(per.get(k) || []), r]); }
        return `    +${c.t} s ${c.tipo} su ${dove}${b.img ? ` (immagine ${b.img.tipo} ${forma(b.img.naturale)}${b.img.indirizzo ? " " + modello(b.img.indirizzo) : ""})` : ""}${b.canvas ? " (canvas)" : ""}`
          + ` → nei 3 s dopo ${dopo.length ? `${dopo.length} richieste: ${[...per].map(([k, l]) => `${l.length}× ${k}${l.some((r) => Number.isFinite(r.misura)) ? " " + misuraDi(Math.max(...l.map((r) => r.misura || 0))) : ""}`).join("; ")}` : "nessuna richiesta"}`;
      });
      const fuori = new Set();
      for (const p of pagViewer) for (const o of p.fuori || []) {
        if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(o)) continue;
        const f = origineFinta(o.toLowerCase(), "flusso");
        fuori.add(f != null ? f : MARCHI.some((re) => re.test(o)) ? "un host dell'ospedale" : o.toLowerCase());
      }
      return [
        "Visualizzatore di immagini (eViewer: solo la forma tecnica — nessuna immagine, nessun dato):",
        `  Istantanee: ${pagViewer.length} (${conta1(pagViewer.map((p) => p.motivo || "caricata"))}); indirizzi: ${[...new Set(elencoPagine.filter((x) => x.viewer).map((x) => modello(x.url)))].join(", ") || "nessuno"}`,
        `  Richieste al visualizzatore: ${rqViewer.length} (${conta1(rqViewer.map((r) => r.tipo || "?"))}), errori ${rqViewer.filter((r) => r.errore).length}, dalla cache ${rqViewer.filter((r) => r.daCache).length}; rinvii che portano lì: ${richieste.reduce((n, r) => n + r.rinvii.filter((x) => x.a.includes(VIEWER_FINTO)).length, 0)}`,
        `  Tipi di contenuto: ${conta1(rqViewer.map((r) => (r.intestazioni && r.intestazioni.tipo) || r.contenuto || "?"))}`,
        "  Immagini e dati, per modello di indirizzo (quante, contenuto [tipo di richiesta], misura, cache):",
        ...(img.length ? img.slice(0, 20).map(([k, l]) => riga(k, l)) : ["    nessuna"]),
        "  Le altre richieste, per modello:",
        ...(altre.length ? altre.slice(0, 20).map(([k, l]) => riga(k, l)) : ["    nessuna"]),
        ...doc,
        `  Clic: ${clicFinti.length}${clicFinti.length ? "" : " (nessuno)"}`,
        ...clicRighe,
        `  Host fuori dal visualizzatore chiamati dalle sue pagine (non registrati): ${[...fuori].sort().join(", ") || "nessuno"}`,
        "",
      ];
    };
    const riepilogoDati = {
      versione: raccolta.versione || "?", durata: Math.round((Number(raccolta.fine || Date.now()) - inizio) / 60000),
      comeFinita: raccolta.comeFinita || "fermata a mano", pagine: elencoPagine.length, perTipo,
      richieste: richieste.length, dellEstensione, rinvii: richieste.reduce((n, r) => n + r.rinvii.length, 0),
      errori: richieste.filter((r) => r.errore).length, pdf: elencoPdf.length, pdfLetti: pdf.filter((d) => (d.righe || []).length).length,
      riletti, schede: tabNum.size, conteggi, icone: [...icone].sort(), iconeNuove: [...iconeNuove].sort(),
      sfasamento: undefined,
    };
    // Il controllo NON blocca (scelta del medico): se qualcosa resta, lo zip
    // esce lo stesso, con l'avviso in cima al riepilogo — dove (file e tipo di
    // dato), mai il valore — e lo stesso avviso nella pagina dello scarico.
    const avvisoDi = (gate) => (gate.ok ? [] : [
      `ATTENZIONE: restano ${gate.punti} dati da controllare — prima di mandarlo guarda questi punti:`,
      ...Object.entries(gate.dove).map(([f, c]) => `  - ${f}: ${Object.entries(c).filter(([k]) => k !== "valori").map(([k, n]) => `${k} ×${n}`).join(", ")}`),
      "",
    ]);
    const riepilogo = (gate) => [
      ...avvisoDi(gate),
      "PS Assist — registrazione anonimizzata",
      `Versione dell'estensione: ${riepilogoDati.versione}`,
      `Durata: ${riepilogoDati.durata} min (${riepilogoDati.comeFinita})`,
      `Schede: ${riepilogoDati.schede}`,
      `Pagine: ${riepilogoDati.pagine}${Object.keys(perTipo).length ? " — " + Object.entries(perTipo).map(([k, v]) => `${k} ${v}`).join(", ") : ""}`,
      `Richieste: ${riepilogoDati.richieste} (dell'estensione ${dellEstensione}, rinvii ${riepilogoDati.rinvii}, errori ${riepilogoDati.errori})`,
      `PDF: ${riepilogoDati.pdf} (testo letto in ${riepilogoDati.pdfLetti}; riletti una volta dalla cache del browser: ${riletti})`,
      `Errori dell'estensione: ${errori.length} (errori.json)`,
      "",
      ...sezioneSiss(),
      ...sezioneViewer(),
      "Sostituzioni:",
      ...Object.entries(conteggi).map(([k, v]) => `  ${k}: ${v}`),
      "",
      `Icone usate (repertorio di esempi-gestionale): ${riepilogoDati.icone.join(", ") || "nessuna"}`,
      `Icone fuori repertorio (solo il nome): ${riepilogoDati.iconeNuove.join(", ") || "nessuna"}`,
      "",
      `Controllo prima dell'esportazione: ${gate.ok ? "superato, nessun dato vero trovato" : `restano ${gate.punti} dati da controllare (elencati in cima)`}`,
      "",
      "Note:",
      "  - Le date recenti sono spostate tutte dello stesso numero di giorni (non scritto da nessuna parte);",
      "    le date di nascita diventano un altro giorno dello stesso anno.",
      "  - I PDF non viaggiano: solo il testo anonimizzato, il numero di pagine e la misura.",
      riletti ? "  - Alcuni PDF aperti dal medico sono stati riletti UNA volta dalla cache del browser (force-cache) per averne il testo." : "  - Nessun PDF è stato richiesto di nuovo al server.",
      "  - Tempi in secondi dall'inizio della registrazione; le schede sono numerate da 1.",
      "",
    ].join("\n");

    // -------------------------------------------------- il cancello
    const sensibili = { nomi: [], personale: [], cf: [...visto.cf], nascita: [], id: [], email: [], telefoni: [], tessere: [] };
    // (le stesse persone che la ripulitura ha cercato: `daCercare`)
    for (const x of daCercare) sensibili[x.cat].push(x.testo);
    // (opz.aggiungi: file messi fra quelli in uscita prima del controllo — solo per i test)
    Object.assign(files, opz.aggiungi || {});
    const prova = { ...files, "riepilogo.txt": riepilogo({ ok: true, punti: 0 }) };
    const gate = cancello(prova, sensibili, { finti: [...finti.values()], diagnosi: opz.diagnosi });
    // (e le persone trovate solo nei testi: là le cerca)
    if (locali.length) {
      const g = cancello(Object.fromEntries(Object.entries(prova).filter(([k]) => k.startsWith("testi/"))),
        { nomi: locali.filter((x) => x.cat !== "personale").map((x) => x.orig), personale: locali.filter((x) => x.cat === "personale").map((x) => x.orig) },
        { finti: [...finti.values()], diagnosi: opz.diagnosi, soloSensibili: true });
      for (const [f, c] of Object.entries(g.dove)) for (const [k, n] of Object.entries(c)) {
        const d = (gate.dove[f] = gate.dove[f] || {});
        d[k] = k === "valori" ? [...(d[k] || []), ...n] : (d[k] || 0) + n;
      }
      gate.punti += g.punti; gate.ok = gate.punti === 0;
    }
    files["riepilogo.txt"] = riepilogo(gate);
    // nessuna stringa vera nel riepilogo stesso: si ricontrolla
    const g2 = cancello({ "riepilogo.txt": files["riepilogo.txt"] }, sensibili, { finti: [...finti.values()] });
    if (!g2.ok) {
      gate.ok = false; gate.punti += g2.punti; Object.assign(gate.dove, g2.dove);
      files["riepilogo.txt"] = riepilogo(gate);
    }
    return { files, gate, conteggi, riepilogo: riepilogoDati, ...(opz.diagnosi ? { sensibili } : {}) };
  }

  // ======================================================================
  // IL CANCELLO. Rilegge tutto quello che uscirebbe: un codice fiscale
  // qualunque, e ogni nome, data di nascita, identificativo visti di vero — in
  // maiuscolo o no, con o senza accenti, separati da spazi, +, %20, trattini.
  // Dice quanti punti e in quali file, MAI i valori.
  function cancello(files, sensibili = {}, opz = {}) {
    const dove = {};
    let punti = 0;
    const segna = (file, cat, n = 1) => { punti += n; dove[file] = dove[file] || {}; dove[file][cat] = (dove[file][cat] || 0) + n; };
    const finti = new Set((opz.finti || []).map((f) => norma(f)));
    // ogni valore vero come sequenza di parole, indicizzato sulla prima: una
    // sola lettura di tutto quello che esce, per lunga che sia
    const indice = new Map();
    const CAT = { nomi: "nome", personale: "personale", cf: "codice fiscale", nascita: "data di nascita", id: "identificativo",
      email: "email", telefoni: "telefono", tessere: "tessera" };
    for (const [k, cat] of Object.entries(CAT)) {
      for (const v of sensibili[k] || []) {
        const n = norma(v);
        if (n.trim().length < 4 || finti.has(n)) continue;
        const parole = n.trim().split(" ");
        if (!indice.has(parole[0])) indice.set(parole[0], []);
        const l = indice.get(parole[0]);
        if (!l.some((x) => x.cat === cat && x.parole.join(" ") === parole.join(" "))) l.push({ cat, parole });
      }
    }
    for (const [file, contenuto] of Object.entries(files)) {
      const L = lettura(contenuto), raw = L.d;
      if (!opz.soloSensibili) {
        for (const m of raw.matchAll(CF_RE)) if (!FINTO_CF.test(m[0])) segna(file, "codice fiscale");
        const coperti = (raw.match(CF_PARZ_RE) || []).length;   // (anche con le cifre coperte)
        if (coperti) segna(file, "codice fiscale", coperti);
      }
      if (!indice.size) continue;
      const w = L.parole.map((x) => x.w);
      for (let i = 0; i < w.length; i++) {
        const l = indice.get(w[i]);
        if (!l) continue;
        for (const e of l) {
          let ok = true;
          for (let j = 1; j < e.parole.length; j++) if (w[i + j] !== e.parole[j]) { ok = false; break; }
          if (ok) { segna(file, e.cat); if (opz.diagnosi) (dove[file].valori = dove[file].valori || []).push(e.parole.join(" ")); }
        }
      }
    }
    return { ok: punti === 0, punti, dove };
  }

  // ======================================================================
  // Lo ZIP: «store», senza compressione — niente librerie, niente rete.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function creaZip(files, quando = new Date()) {
    const enc = new TextEncoder();
    const dosT = ((quando.getHours() << 11) | (quando.getMinutes() << 5) | (quando.getSeconds() >> 1)) & 0xFFFF;
    const dosD = (((quando.getFullYear() - 1980) << 9) | ((quando.getMonth() + 1) << 5) | quando.getDate()) & 0xFFFF;
    const locali = [], centrali = [];
    let off = 0;
    for (const [nome, contenuto] of Object.entries(files)) {
      const n = enc.encode(nome);
      const d = typeof contenuto === "string" ? enc.encode(contenuto) : contenuto;
      const crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true);
      h.setUint32(22, d.length, true); h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
      locali.push(new Uint8Array(h.buffer), n, d);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true);
      c.setUint16(28, n.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
      c.setUint32(38, 0, true); c.setUint32(42, off, true);
      centrali.push(new Uint8Array(c.buffer), n);
      off += 30 + n.length + d.length;
    }
    const lungC = centrali.reduce((s, x) => s + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true);
    e.setUint32(12, lungC, true); e.setUint32(16, off, true);
    const parti = [...locali, ...centrali, new Uint8Array(e.buffer)];
    const tot = parti.reduce((s, x) => s + x.length, 0);
    const out = new Uint8Array(tot);
    let p = 0;
    for (const x of parti) { out.set(x, p); p += x.length; }
    return out;
  }

  globale.RegistraAnonimo = { anonimizza, cancello, creaZip, crc32, pezzi };
})(typeof globalThis !== "undefined" ? globalThis : this);
