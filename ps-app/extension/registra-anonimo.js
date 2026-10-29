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
 * stato visto di vero (nomi, date di nascita, codici fiscali, episodi). Basta un
 * punto e non si esporta niente.
 *
 * Gira nella pagina dell'estensione (registra.html) e in Node per i test: non
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
  const PARAM_ID = /(^|_)ID$|^ID_|TOKEN|SESSION|^NOSOLOGICO|^PRATICA|^ACCESSO|_ACCESSO$|^EPISODIO|^ASSISTITO|^PAZIENTE|^REFERTO|^RICHIESTA|^RCS_|^PRENOTAZIONE|^BARCODE|^CAMPIONE|^ORDINE|^DOCUMENTO/i;
  const PARAM_CF = /^(CF|COD_?FISC\w*|CODICE_FISCALE)$/i;
  const LOGHI = /HMIMU_logo|Logo-GF|dds_logo|logo_/i;
  const IMG_DATA_MAX = 8 * 1024;   // un'icona sì, una fotografia o un codice a barre no

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

  const CF_RE = /(?<![A-Za-z0-9])[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z](?![A-Za-z0-9])/g;
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
      if (!v || v.length < 5 || CODICI.has(v)) return;
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

    // ------------------------------------------------------- persone
    const nomiVisti = new Map();     // NORMA(originale) → { cat: "nomi"|"personale", orig }
    const paroleDiNomi = new Set();
    const registraNome = (s, cat) => {
      const t = pulisci(s).replace(/\s+/g, " ").trim();
      if (t.length < 4 || !/\s/.test(t) && cat !== "personale") return;
      if (MARCHI.some((re) => re.test(t))) return;
      const k = norma(t);
      const prima = nomiVisti.get(k);
      if (!prima || (prima.cat === "nomi" && cat === "personale")) nomiVisti.set(k, { cat, orig: t });
      for (const w of MAIUSC(t).split(/[^A-Z']+/)) if (w.length >= 2) paroleDiNomi.add(w);
    };
    const paroleApp = (t) => PAROLE_APP.test(MAIUSC(t));
    const tutteStatiche = (t) => MAIUSC(t).split(/[^A-Z0-9']+/).filter(Boolean).every((w) => PAROLE_STATICHE.has(w));
    // COGNOME NOME in maiuscolo, o Nome Cognome con le iniziali: non frasi del programma
    const formaNome = (s) => {
      const t = pulisci(s).trim();
      if (/^[A-ZÀ-Ù'’]+(?:\s+[A-ZÀ-Ù'’]+){1,3}$/.test(t)) return !paroleApp(t) && !tutteStatiche(t);
      if (/^[A-ZÀ-Ù][a-zà-ÿ'’]+(?:\s+[A-ZÀ-Ù][a-zà-ÿ'’]+){1,2}$/.test(t)) return !paroleApp(t) && !MAIUSC(t).split(/\s+/).some((w) => PAROLE_STATICHE.has(w));
      return false;
    };
    const utente = (t) => /^[A-Z]{5,7}$/.test(t) && !PAROLE_STATICHE.has(t) && !paroleApp(t) && !STATICO.has(t);
    const negato = (t) => MARCHI.some((re) => re.test(t)) || formaNome(t) || utente(t) || haCF(t);
    const vocabolo = (s) => {
      const k = pulisci(s).trim();
      if (!k) return true;
      if (negato(k) || nomiVisti.has(norma(k))) return false;
      if (STATICO.has(k) || isExam(k) || CODICI.has(k)) return true;
      const u = testi.get(k);
      return !!u && u.size >= 2;
    };

    // ------------------------------------------- le scoperte (prima passata)
    const scopri = (s) => {
      const t = pulisci(s);
      if (!t.trim()) return;
      for (const m of t.matchAll(CF_RE)) if (!FINTO_CF.test(m[0])) visto.cf.add(m[0]);
      for (const m of t.matchAll(EMAIL_RE)) if (!/@esempio\.it$/i.test(m[0])) visto.email.add(m[0]);
      for (const re of TEL_RE) for (const m of t.matchAll(re)) { const v = (m[1] || m[0]).trim(); if ((v.match(/\d/g) || []).length >= 7) visto.telefoni.add(v); }
      for (const re of TESSERA_RE) for (const m of t.matchAll(re)) { const v = (m[1] || m[0]).trim(); if (/\d/.test(v)) visto.tessere.add(v); }
      for (const m of t.matchAll(DATA_RE)) { const y = m[4].length === 2 ? 1900 + Number(m[4]) : Number(m[4]); if (m[4].length === 4 && y < annoRif - 1 && valida(m[1], m[3], y)) visto.nascita.add(m[0]); }
      for (const m of t.matchAll(ISO_RE)) { if (Number(m[1]) < annoRif - 1 && valida(m[3], m[2], Number(m[1]))) visto.nascita.add(m[0]); }
      for (const m of t.matchAll(NOSO_RE)) registraId(m[0]);
      for (const m of t.matchAll(NOME_KW)) {
        const nome = m[1].trim();
        if (!paroleApp(nome) && !tutteStatiche(nome) && !/^(il|la|lo|gli|le|un|una|del|della|di|da|in|con|per|non|nel|nella|e|ed|al|alla)\b/i.test(nome)) registraNome(nome, KW_PERSONALE.test(m[0]) ? "personale" : "nomi");
      }
      for (const m of t.matchAll(NATO_RE)) if (formaNome(m[1])) registraNome(m[1], "nomi");
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
      t = t.replace(EMAIL_RE, (v) => (/@esempio\.it$/i.test(v) ? v : (conta.email++, "utente@esempio.it")));
      for (const re of TESSERA_RE) t = t.replace(re, (all, g) => { const v = g || all; if (!/\d/.test(v)) return all; conta.tessere++; return all.replace(v, "0".repeat(v.length)); });
      for (const re of TEL_RE) t = t.replace(re, (all, g) => { const v = g || all; if ((v.match(/\d/g) || []).length < 7) return all; conta.telefoni++; return all.replace(v, v.replace(/\d/g, "0")); });
      t = t.replace(INDIRIZZO_RE, () => { conta.indirizzi++; return "VIA ESEMPIO 1"; });
      t = t.replace(CAP_RE, () => { conta.indirizzi++; return "00000 CITTÀ ESEMPIO (XX)"; });
      t = t.replace(IP_RE, "127.0.0.1");
      t = t.replace(NOSO_RE, (all) => (idOriginali.has(all) ? (conta.id++, visto.id.add(all), fintoId(all)) : all));
      t = remapCifre(t);
      t = date(t);
      return t;
    };
    // un testo intero inventato: per il riepilogo, cosa c'era dentro
    const contaDentro = (s) => {
      const t = String(s);
      const n = (re) => { re.lastIndex = 0; const c = (t.match(re) || []).length; re.lastIndex = 0; return c; };
      conta.cf += n(CF_RE); conta.email += n(EMAIL_RE); conta.indirizzi += n(INDIRIZZO_RE);
      for (const re of TEL_RE) conta.telefoni += n(re);
      for (const re of TESSERA_RE) conta.tessere += n(re);
      for (const v of visto.nascita) if (t.includes(v)) conta.nascita++;
      for (const v of nomiVisti.values()) if (MAIUSC(t).includes(MAIUSC(v.orig))) conta[v.cat === "personale" ? "personale" : "nomi"]++;
    };

    // --------------------------------------- un testo: il cuore della regola
    function trattaStringa(core, ctx = {}) {
      const t = pulisci(core).trim();
      if (!t) return core;
      if (soloPunteggiatura(t)) return core;
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
      if (portali.has(o)) return "http://portale.esempio";
      if (/^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(o)) return "http://127.0.0.1";
      return null;
    };
    const valoreParam = (k, v) => {
      const K = k.toUpperCase();
      if (!v) return v;
      if (STRUTTURA.has(K)) return v;
      if (PARAM_CF.test(K)) return cfFinto(v.toUpperCase());
      if (PARAM_ID.test(K)) return remapId(v);
      if (/^(BLOBFIELD|WHERECONDITION)$/.test(K)) return remapCifre(v);
      if (/^\d{1,3}$/.test(v) || CODICI.has(v) || vocabolo(v)) return remapCifre(v);
      if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(v) || /^\d{4}-\d{2}-\d{2}/.test(v)) return date(v);
      conta.url++;
      return "ESEMPIO";
    };
    const decURI = (s) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };
    const encURI = (s) => encodeURIComponent(s).replace(/%2C/g, ",").replace(/%2F/g, "/").replace(/%3A/g, ":").replace(/%20/g, "+");
    function anonUrl(u, modo = "pagina") {
      let s = String(u == null ? "" : u).trim();
      if (!s) return s;
      if (/^\/\//.test(s)) s = "https:" + s;
      if (/^#/.test(s)) return /^#[\w-]{0,40}$/.test(s) ? s : "#";
      if (/^javascript:/i.test(s)) return "javascript:" + anonJs(s.slice(11));
      if (/^data:/i.test(s)) return /^data:image\//i.test(s) && s.length <= IMG_DATA_MAX ? s : (conta.immagini++, "data:,");
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
      if (pre) {
        const o = pre.replace(/\/+$/, "").toLowerCase().replace(/:(80|443)$/, "");
        const f = origineFinta(o, modo) ?? origineFinta(pre.replace(/\/+$/, ""), modo);
        if (f == null) { conta.url++; return modo === "flusso" ? "https://altro.esempio/" : "#"; }
        pre = f;
      }
      percorso = percorso.split("/").map((seg) => {
        const sj = /^([^;]*)(;jsessionid=.*)?$/i.exec(seg);
        let base = sj[1];
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
          const nv = valoreParam(k, v);
          return nv === v ? p : `${k}=${encURI(nv)}`;
        }).join("&");
      }
      if (frag && !/^#[\w-]{0,40}$/.test(frag)) frag = "#";
      return pre + percorso + query + frag;
    }

    // ---------------------------------------------------------- script
    function letterale(s) {
      if (!s) return s;
      const d = s.replace(/\\(["'\\/])/g, "$1");
      if (/^[\w$.#:[\]-]{0,40}$/.test(d) && !(d.length >= 4 && /^[A-ZÀ-Ù']+$/.test(d) && !vocabolo(d))) return remapCifre(s);
      if (/^(?:[a-z]+:\/\/|\.{0,2}\/|[\w.-]+\.(?:do|jsp|html?|rra2|pdf)\b)/i.test(d) || /^[^\s]*[?&][\w]+=/.test(d)) {
        return anonUrl(d, "pagina").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "\\\"");
      }
      return trattaStringa(d).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
    }
    const anonJs = (js) => remapCifre(pezziJs(String(js), letterale));
    const anonCss = (css) => String(css).replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
        if (/^data:image\//i.test(u)) return u.length <= IMG_DATA_MAX ? m : (conta.immagini++, "none");
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
      "contenteditable", "spellcheck", "nonce", "integrity", "crossorigin", "async", "defer", "noshade", "compact", "datetime"]);
    const icone = new Set(), iconeNuove = new Set();
    function trattaPagina(html, unitaPagina) {
      const out = [];
      let select = null, inputNome = null;
      for (const p of pezzi(String(html))) {
        if (p.k === "doctype") { out.push(p.s); continue; }
        if (p.k === "testo") {
          if (select && CAMPI_PERSONA.test(select)) { const t = decodifica(p.s); out.push(t.trim() ? escTesto(t.replace(t.trim(), /Seleziona/i.test(t) ? t.trim() : nomeFinto(t.trim(), "personale"))) : p.s); }
          else out.push(testoConSpazi(p.s));
          continue;
        }
        if (p.k === "fine") { if (p.nome === "select") select = null; out.push(`</${p.nome}>`); continue; }
        if (p.k === "corpo") {
          if (p.nome === "script") out.push(anonJs(p.s));
          else if (p.nome === "style") out.push(anonCss(p.s));
          else if (p.nome === "textarea") { const t = decodifica(p.s); out.push(t.trim() ? (conta.liberi++, contaDentro(t), escTesto(sintetico(t.trim()))) : p.s); }
          else if (p.nome === "noscript" || p.nome === "xmp") out.push("");
          else out.push(testoConSpazi(p.s));
          continue;
        }
        // un tag
        const nomeAttr = (p.attrs.find((a) => a.k.toLowerCase() === "name") || {}).v || "";
        if (p.nome === "select") select = nomeAttr;
        if (p.nome === "input" || p.nome === "textarea" || p.nome === "select") inputNome = nomeAttr;
        let togli = false;
        const attrs = p.attrs.map((a) => {
          const K = a.k.toLowerCase();
          if (a.c) return a.k;
          const v = decodifica(a.v);
          let nv;
          if (p.nome === "img" && K === "src") {
            const name = decURI(v.split(/[?#]/)[0].split(/[/\\]/).pop() || "").replace(/^icona:/, "");
            if (/^data:/i.test(v)) nv = /^data:image\//i.test(v) && v.length <= IMG_DATA_MAX ? v : (conta.immagini++, "");
            else if (LOGHI.test(name)) { togli = true; nv = ""; }
            else if (ICONE.has(name)) { icone.add(name); nv = `icona:${name}`; }
            else if (/^[\w.-]{1,60}\.(gif|png|jpe?g|svg|ico|bmp)$/i.test(name) && !/[?]/.test(v)) { iconeNuove.add(name); nv = `icona:${name}`; }
            else { conta.immagini++; nv = ""; }
          } else if (ATTR_URL.has(K)) nv = anonUrl(v, "pagina");
          else if (K.startsWith("on")) nv = anonJs(v);
          else if (K === "style") nv = anonCss(v);
          else if (K === "content" && p.nome === "meta") {
            const r = /^(\s*\d+\s*;\s*url\s*=\s*)(.*)$/i.exec(v);
            nv = r ? r[1] + anonUrl(r[2].replace(/^['"]|['"]$/g, ""), "pagina") : /charset|text\/html/i.test(v) ? v : trattaStringa(v);
          } else if (ATTR_STRUTTURA.has(K)) nv = remapCifre(v);
          else if (K === "value") {
            const N = (inputNome || "").toUpperCase();
            if (p.nome === "option" && select && CAMPI_PERSONA.test(select)) nv = /^\d{1,6}$/.test(v) ? v : nomeFinto(v, "personale");
            else if (!v.trim()) nv = v;
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
      let u = paramDi(p.url, "EPISODIO_ID") || (richiestaEp.get(paramDi(p.url, "RICHIESTA_ID")) || "") || (paramDi(p.url, "ASSISTITO_ID") ? "A:" + paramDi(p.url, "ASSISTITO_ID") : "");
      const eps = episodiIn(p.html);
      p.multi = !u && eps.size >= 2;
      if (!u && eps.size === 1) u = [...eps][0];
      if (!u && !p.multi && p.alto === false) u = ultimaAlta.get(p.scheda) || "";
      else if (!u && !p.multi && !visteSchede.has(p.scheda) && apertaDa.has(p.scheda)) u = unitaDiScheda(apertaDa.get(p.scheda), p.ts);
      if (p.alto !== false) { ultimaAlta.set(p.scheda, u); visteSchede.add(p.scheda); }
      p.unita = u;
    }
    // gli identificativi: dagli indirizzi, dai campi, dalle pagine
    const idDaUrl = (u) => {
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
              if (!K.startsWith("on") && !/^javascript:/i.test(v)) idDaUrl(v);
              for (const m of v.matchAll(/['"]([^'"]*\?[^'"]*)['"]/g)) idDaUrl(m[1]);
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
    // le parole: chi le dice, e cosa c'è dentro
    for (const p of pagine) {
      for (const pz of p.pezzi) {
        const unita = p.multi ? (pz.riga >= 0 ? p.unitaRighe[pz.riga] : "") : p.unita;
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
          }
        }
      }
      delete p.pezzi;
    }
    for (const d of pdf) {
      const u = d.unita || unitaDiScheda(d.scheda, d.ts) || (apertaDa.has(d.scheda) ? unitaDiScheda(apertaDa.get(d.scheda), d.ts) : "");
      d.unitaVista = u;
      for (const r of d.righe || []) { osservaStringa(r, u); scopri(r); }
    }
    for (const r of flusso) { scopri(decURI(r.url || "")); for (const v of Object.values(r.corpo || {})) scopri(String(v)); }

    // --------------------------------------- seconda passata: trasformare
    const files = {};
    const tipoDi = (u) => {
      const mv = paramDi(u, "MVPG");
      if (mv) return mv.replace(/[^\w-]/g, "").slice(0, 60);
      const base = String(u || "").split(/[?#]/)[0].split("/").filter(Boolean).pop() || "pagina";
      return base.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w-]/g, "").slice(0, 60) || "pagina";
    };
    const tabNum = new Map();
    const scheda = (id) => { if (id == null || id < 0) return null; if (!tabNum.has(id)) tabNum.set(id, tabNum.size + 1); return tabNum.get(id); };
    const sec = (ms) => Math.round((Number(ms) || 0) / 100) / 10;
    const elencoPagine = [];
    pagine.forEach((p, i) => {
      const nnn = String(i + 1).padStart(3, "0");
      const tipo = tipoDi(p.url);
      const nome = `pagine/${nnn}-${tipo}.html`;
      const corpo = trattaPagina(p.html, p.unita);
      const url = anonUrl(p.url, "flusso");
      const testa = `<!-- PS Assist, registrazione anonimizzata: pagina ${nnn} · ${url.replace(/--/g, "- -")} · +${sec(p.ts - inizio)} s · scheda ${scheda(p.scheda) ?? "?"}${p.alto === false ? " · riquadro" : ""} · ${p.motivo || "caricata"} -->\n`;
      files[nome] = testa + corpo;
      elencoPagine.push({ file: nome, tipo, url, t: sec(p.ts - inizio), scheda: scheda(p.scheda), riquadro: p.alto === false, motivo: p.motivo || "caricata", titolo: trattaStringa(p.titolo || "") });
    });
    const da = (r) => (r.registratore ? "registratore" : r.estensione ? "estensione" : "pagina");
    const corpoFinto = (c) => { if (!c) return undefined; const o = {}; for (const [k, v] of Object.entries(c)) o[k] = Array.isArray(v) ? v.map((x) => valoreParam(k, String(x))) : valoreParam(k, String(v)); return o; };
    const richieste = flusso.map((r) => ({
      metodo: r.metodo, url: anonUrl(r.url, "flusso"), tipo: r.tipo, scheda: scheda(r.scheda), riquadro: r.frame > 0 || undefined,
      da: da(r), inizio: sec(r.inizio - inizio), fine: r.fine != null ? sec(r.fine - inizio) : null,
      durata: r.fine != null ? sec(r.fine - r.inizio) : null, stato: r.stato ?? null, contenuto: r.contenuto || undefined,
      daCache: r.daCache || undefined, errore: r.errore || undefined, corpo: corpoFinto(r.corpo),
      rinvii: (r.rinvii || []).map((x) => ({ stato: x.stato, a: anonUrl(x.a, "flusso"), t: sec(x.t - inizio) })),
      pdf: r.pdf || undefined,
    }));
    const schede = (raccolta.schede || []).map((s) => ({ scheda: scheda(s.id), apertaDa: scheda(s.apertaDa), finestra: s.finestra, popup: !!s.popup || undefined, t: sec(s.ts - inizio) }));
    const elencoPdf = [];
    pdf.forEach((d, i) => {
      const nnn = String(i + 1).padStart(3, "0");
      const o = {
        url: anonUrl(d.url, "flusso"), t: sec(d.ts - inizio), scheda: scheda(d.scheda), da: d.origine || "pagina",
        pagine: d.pagine ?? null, misura: d.misura || null, lettore: d.lettore || null,
        righe: (d.righe || []).map((r) => trattaStringa(r)), ...(d.errore ? { errore: String(d.errore).slice(0, 120) } : {}),
      };
      files[`pdf/${nnn}.json`] = JSON.stringify(o, null, 1);
      elencoPdf.push({ file: `pdf/${nnn}.json`, url: o.url, t: o.t, pagine: o.pagine, righe: o.righe.length, da: o.da });
    });
    files["flusso.json"] = JSON.stringify({ inizio: 0, unita: "secondi dall'inizio", schede, pagine: elencoPagine, pdf: elencoPdf, richieste }, null, 1);

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
    for (const v of visto.nascita) letterali.set(v, () => date(v));
    const idAlfa = [...idOriginali].filter((v) => !/^\d+$/.test(v)).sort((a, b) => b.length - a.length);
    const reIdAlfa = idAlfa.length ? new RegExp(`(?<![A-Za-z0-9])(?:${idAlfa.map(escRe).join("|")})(?![A-Za-z0-9])`, "g") : null;
    const reLett = letterali.size ? new RegExp([...letterali.keys()].sort((a, b) => b.length - a.length).map(escRe).join("|"), "g") : null;
    const ripulisci = (s) => {
      let t = s;
      if (reNomi) t = t.replace(reNomi, (m) => nomeFinto(m.replace(/&nbsp;|%[0-9A-Fa-f]{2}|[^A-Za-z0-9À-ÿ]+/g, " ").trim(), (nomiVisti.get(norma(m.replace(/&nbsp;|%[0-9A-Fa-f]{2}/g, " "))) || {}).cat));
      if (reLett) t = t.replace(reLett, (m) => letterali.get(m)());
      if (reIdAlfa) t = t.replace(reIdAlfa, (m) => fintoId(m));
      t = t.replace(/(?<![\dA-Za-z])\d{5,}(?![\dA-Za-z])/g, (d) => (idOriginali.has(d) ? fintoId(d) : d));
      return t;
    };
    for (const k of Object.keys(files)) files[k] = ripulisci(files[k]);

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
    const riepilogoDati = {
      versione: raccolta.versione || "?", durata: Math.round((Number(raccolta.fine || Date.now()) - inizio) / 60000),
      comeFinita: raccolta.comeFinita || "fermata a mano", pagine: elencoPagine.length, perTipo,
      richieste: richieste.length, dellEstensione, rinvii: richieste.reduce((n, r) => n + r.rinvii.length, 0),
      errori: richieste.filter((r) => r.errore).length, pdf: elencoPdf.length, pdfLetti: pdf.filter((d) => (d.righe || []).length).length,
      riletti, schede: tabNum.size, conteggi, icone: [...icone].sort(), iconeNuove: [...iconeNuove].sort(),
      sfasamento: undefined,
    };
    const riepilogo = (gate) => [
      "PS Assist — registrazione anonimizzata",
      `Versione dell'estensione: ${riepilogoDati.versione}`,
      `Durata: ${riepilogoDati.durata} min (${riepilogoDati.comeFinita})`,
      `Schede: ${riepilogoDati.schede}`,
      `Pagine: ${riepilogoDati.pagine}${Object.keys(perTipo).length ? " — " + Object.entries(perTipo).map(([k, v]) => `${k} ${v}`).join(", ") : ""}`,
      `Richieste: ${riepilogoDati.richieste} (dell'estensione ${dellEstensione}, rinvii ${riepilogoDati.rinvii}, errori ${riepilogoDati.errori})`,
      `PDF: ${riepilogoDati.pdf} (testo letto in ${riepilogoDati.pdfLetti}; riletti una volta dalla cache del browser: ${riletti})`,
      "",
      "Sostituzioni:",
      ...Object.entries(conteggi).map(([k, v]) => `  ${k}: ${v}`),
      "",
      `Icone usate (repertorio di esempi-gestionale): ${riepilogoDati.icone.join(", ") || "nessuna"}`,
      `Icone fuori repertorio (solo il nome): ${riepilogoDati.iconeNuove.join(", ") || "nessuna"}`,
      "",
      `Controllo prima dell'esportazione: ${gate.ok ? "superato, nessun dato vero trovato" : `NON superato: ${gate.punti} punti`}`,
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
    const sensibili = { nomi: [], personale: [], cf: [...visto.cf], nascita: [...visto.nascita].filter((v) => date(v) !== v), id: [...idOriginali].filter((v) => v.length >= 5),
      email: [...visto.email], telefoni: [...visto.telefoni], tessere: [...visto.tessere] };
    for (const { cat, orig } of nomiVisti.values()) {
      sensibili[cat].push(orig);
    }
    const prova = { ...files, "riepilogo.txt": riepilogo({ ok: true, punti: 0 }) };
    const gate = cancello(prova, sensibili, { finti: [...finti.values()], diagnosi: opz.diagnosi });
    files["riepilogo.txt"] = riepilogo(gate);
    // nessuna stringa vera nel riepilogo stesso: si ricontrolla
    if (gate.ok) { const g2 = cancello({ "riepilogo.txt": files["riepilogo.txt"] }, sensibili, { finti: [...finti.values()] }); if (!g2.ok) Object.assign(gate, g2); }
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
      const raw = decodifica(String(contenuto)).replace(/%([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
      for (const m of raw.matchAll(CF_RE)) if (!FINTO_CF.test(m[0])) segna(file, "codice fiscale");
      if (!indice.size) continue;
      const w = norma(raw).trim().split(" ");
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
