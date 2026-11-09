/*
 * «Prova» — i dati finti del PC finto (prova.js). Solo nomi e numeri inventati.
 * Il catalogo degli esami, la mappa e gli EO sono quelli veri dell'estensione
 * (catturati dal PC di prova dei test); i pazienti, gli esiti, la cartella e
 * la Terapia sono scritti a mano, sul modello di quello che il PC risponde.
 * Le ore sono relative a «adesso»: la prova è sempre fresca.
 */
(function () {
  "use strict";
  const MIN = 60e3, H = 3600e3;
  const RICHIESTE = {"quesiti":["Dolore toracico","Dispnea","Dolore addominale","Febbre","Trauma","Sincope"],"pacchetti":[{"q":"Dolore toracico","esami":["00660001P:320","00660001P:325","00660001P:176","00660001P:220","00660001P:134","00660001P:324","00120001P:36"]},{"q":"Dispnea","esami":["00660001P:320","00660001P:326","00660001P:176","00660001P:220","00660001P:134","00660001P:101","00660001P:324","00720001P:297"]},{"q":"Dolore addominale","esami":["00660001P:320","00660001P:325","00660001P:176","00720001P:16","00720001P:228","00720001P:53","00720001P:167","00720001P:34","00720001P:181","00720001P:54"]},{"q":"Febbre","esami":["00660001P:320","00720001P:293"]}],"gruppi":[{"nome":"POC","rx":false,"profili":[{"nome":"Base PS","esami":["00660001P:320","00660001P:325","00660001P:176"]},{"nome":"Coag POC","esami":["00660001P:220","00660001P:134","00660001P:135"]}],"esami":["00660001P:320","00660001P:325","00660001P:326","00660001P:176","00660001P:101","00660001P:324","00660001P:30","00660001P:220","00660001P:134"]},{"nome":"Lab centrale","rx":false,"profili":[{"nome":"Epatico","esami":["00720001P:16","00720001P:228","00720001P:53","00720001P:167","00720001P:34"]},{"nome":"Coag","esami":["00720001P:181","00720001P:54","00720001P:258"]}],"esami":["00720001P:293","00720001P:159","00720001P:297","00720001P:317","00720001P:228","00720001P:53","00720001P:167","00720001P:16","00720001P:34","00130001P:212"]},{"nome":"RX","rx":true,"profili":[],"esami":["00120001P:35","00120001P:36","00120001P:28"]}],"nomi":{"00660001P:320":"EMOCROMO POC","00660001P:325":"EGA VENOSA NEW","00660001P:176":"CREATININA POC","00720001P:16":"BILIRUBINA","00720001P:228":"GPT","00720001P:53":"GOT","00720001P:167":"GAMMA GT","00720001P:34":"LIPASI","00660001P:220":"PT POC","00660001P:134":"PTT POC","00660001P:135":"FIBRINOGENO POC","00720001P:181":"PT","00720001P:54":"PTT","00720001P:258":"FIBRINOGENO","00660001P:326":"EGA ARTERIOSA NEW","00660001P:101":"D-DIMERO POC","00660001P:324":"TROPONINA US","00660001P:30":"GLUCOSIO POC","00720001P:293":"PCR","00720001P:159":"PROCALCITONINA","00720001P:297":"NT PRO-BNP","00720001P:317":"ESAME URINE","00130001P:212":"SARSCOV","00120001P:35":"RX TORACE","00120001P:36":"RX TORACE 1 PROIEZ.","00120001P:28":"RX ADDOME"},"rx":["00120001P:35","00120001P:36","00120001P:28"]};
  const EO = [{"k":"base:solito","nome":"Mio solito base","gruppo":"base","testo":"Vigile, lucido, orientato, collaborante. Eupnoico in AA. Cute normocromica, non sudata.\nToni cardiaci ritmici, pause libere.\nTorace MV normotrasmesso, no rpa."},{"k":"base","nome":"EO generale","gruppo":"base","testo":"Vigile, orientato, eupnoico, normocolorito, ben perfuso, apiretico. Non segni di distress.\nTorace: MV normotrasmesso bilateralmente, non rumori patologici aggiunti. Cuore: toni ritmici, validi, non soffi. Polsi periferici presenti e simmetrici.\nAddome: piano, trattabile, non dolente né dolorabile, peristalsi presente, Blumberg e Murphy negativi, Giordano negativo bilateralmente. Non masse, non organomegalie.\nArti inferiori: non edemi, non segni di TVP, polpacci indolori.\nNeuro: non deficit focali, forza e sensibilità conservate ai 4 arti, non segni meningei. Cute: integra, non lesioni, non esantemi."},{"k":"caso:toracico","nome":"Dolore toracico","gruppo":"casi","testo":"Dolore non riproducibile alla palpazione della parete / riproducibile. Toni validi, non sfregamenti. Polsi radiali e femorali simmetrici, PA comparativa agli arti superiori [dx/sx]. Non turgore giugulare. Non edemi. Polpacci indolori simmetrici."},{"k":"caso:dispnea","nome":"Dispnea","gruppo":"casi","testo":"Utilizzo dei muscoli accessori sì/no, parla per frasi intere. MV ridotto alle basi con crepitii bibasali fino a [livello] / sibili diffusi espiratori. Non ottusità plessica. Turgore giugulare. Edemi declivi improntabili fino a [livello]. Polpacci simmetrici."},{"k":"caso:addominale","nome":"Dolore addominale","gruppo":"casi","testo":"Blumberg, Rovsing, Murphy, Giordano, psoas. Non difesa, non peritonismo. Non masse pulsanti (AAA). Orifizi erniari liberi. Peristalsi presente/torpida."},{"k":"caso:cefalea","nome":"Cefalea","gruppo":"casi","testo":"Non segni meningei (Kernig, Brudzinski negativi). Pupille isocoriche isocicliche normoreagenti. Nervi cranici indenni. Non deficit focali, non atassia, Romberg negativo. arterie temporali non dolenti (>50 anni)."},{"k":"caso:trauma","nome":"Trauma / caduta","gruppo":"casi","testo":"Non ferite lacerocontuse. Rachide cervicale non dolente alla palpazione della linea mediana, ROM conservato (criteri NEXUS soddisfatti). Bacino stabile. Non dolorabilità sternale né costale. Arti: assi conservati, non deformità, articolarità e polsi distali conservati, sensibilità integra. Sempre: polso distale + sensibilità + motilità distalmente alla lesione."},{"k":"caso:sincope","nome":"Sincope","gruppo":"casi","testo":"PA in clino e ortostatismo [valori], toni validi non soffi, polsi simmetrici, non deficit neurologici, esplorazione rettale negativa per melena se indicata."},{"k":"caso:lombalgia","nome":"Lombalgia","gruppo":"casi","testo":"Lasègue negativo bilateralmente, forza 5/5 ai distretti L2-S1, ROT rotulei e achillei normoevocabili simmetrici, sensibilità conservata, non anestesia a sella, tono sfinteriale conservato, non globo vescicale (cauda equina)"},{"k":"caso:vertigine","nome":"Vertigine","gruppo":"casi","testo":"Nistagmo [assente/orizzontale con fase rapida verso...], HINTS: head impulse [ ], nistagmo direzione fissa/mutevole, skew deviation assente. Marcia e Romberg [ ]. Non dismetria, non deficit focali."},{"k":"caso:pediatrico","nome":"Pediatrico","gruppo":"casi","testo":"Bambino vivace, reattivo, consolabile, colorito valido, refill capillare <2s, non segni di disidratazione (mucose umide, lacrimazione presente, diuresi riferita normale). Non esantemi, non petecchie. Fontanella normotesa. Non segni meningei."},{"k":"frase:rettale","nome":"Rettale non eseguita","gruppo":"frasi","testo":"Esplorazione rettale non eseguita per rifiuto del paziente"},{"k":"frase:collaborazione","nome":"Neuro poco collaborante","gruppo":"frasi","testo":"esame neurologico limitato dalla scarsa collaborazione"},{"k":"frase:nexus","nome":"NEXUS: niente collare","gruppo":"frasi","testo":"criteri NEXUS applicabili, non necessaria immobilizzazione"},{"k":"frase:allarme","nome":"Segni d'allarme spiegati","gruppo":"frasi","testo":"Paziente informato dei segni d'allarme (elencati), che dichiara di aver compreso, con indicazione a tornare in PS."}];
  const MAPPA = {"vista":"bassa","cols":40,"rows":24,"mappe":[{"k":"alta","nome":"Alta","letti":[{"id":"ab1","c":0,"r":0,"w":3,"h":5,"nome":"Attesa barellati 1","forma":"barella"},{"id":"ab2","c":4,"r":0,"w":3,"h":5,"nome":"Attesa barellati 2","forma":"barella"},{"id":"as1","c":8,"r":6,"w":4,"h":3,"nome":"Sedia 1","forma":"sedia"},{"id":"as2","c":13,"r":6,"w":4,"h":3,"nome":"Sedia 2","forma":"sedia"},{"id":"as3","c":18,"r":6,"w":4,"h":3,"nome":"Sedia 3","forma":"sedia"},{"id":"as4","c":27,"r":6,"w":4,"h":3,"nome":"Sedia 4","forma":"sedia"},{"id":"box","c":0,"r":10,"w":7,"h":7,"nome":"Box","forma":"box"},{"id":"a3","c":8,"r":12,"w":5,"h":4,"nome":"Letto 3"},{"id":"a2","c":14,"r":12,"w":5,"h":4,"nome":"Letto 2"},{"id":"a1","c":20,"r":12,"w":5,"h":4,"nome":"Letto 1"},{"id":"rossa","c":26,"r":10,"w":7,"h":7,"nome":"Rossa","forma":"box"}],"aree":[],"posti":[]},{"k":"ps","nome":"Bassa","letti":[{"id":"obi4","c":0,"r":0,"w":5,"h":4,"nome":"OBI 4"},{"id":"obi3","c":5,"r":0,"w":5,"h":4,"nome":"OBI 3"},{"id":"obi2","c":10,"r":0,"w":5,"h":4,"nome":"OBI 2"},{"id":"obi1","c":15,"r":0,"w":5,"h":4,"nome":"OBI 1"},{"id":"oss1","c":22,"r":0,"w":5,"h":4,"nome":"OSS 1"},{"id":"oss2","c":27,"r":0,"w":5,"h":4,"nome":"OSS 2"},{"id":"oss3","c":27,"r":4,"w":5,"h":4,"nome":"OSS 3"},{"id":"oss4","c":22,"r":4,"w":5,"h":4,"nome":"OSS 4"}],"aree":[{"id":"attesa","c":34,"r":0,"w":6,"h":11,"nome":"Sala attesa"},{"id":"attesa2","c":0,"r":6,"w":20,"h":5,"nome":"Sala attesa 2"}],"posti":[{"ep":"999001","tipo":"letto","id":"obi2"}]}]};
  const TERAPIE_VOCI = ["PARACETAMOLO 1000 MG/100 ML SOL INF", "PARACETAMOLO 1000 MG CPR", "KETOROLAC TROMETAMOLO 30 MG FL", "FUROSEMIDE 20 MG FL",
    "PANTOPRAZOLO 40 MG FL", "ONDANSETRON 4 MG FL", "ENOXAPARINA 4000 UI SIR", "AMOXICILLINA/AC. CLAV. 2,2 G FL", "CEFTRIAXONE 1 G FL",
    "SODIO CLORURO 0,9% 500 ML", "GLUCOSIO 5% 500 ML", "METOCLOPRAMIDE 10 MG FL", "TRAMADOLO 100 MG FL", "SALBUTAMOLO 2,5 MG/2,5 ML AEROSOL", "METILPREDNISOLONE 40 MG FL"];

  function dati(ora) {
    const t = (min) => ora + min * MIN;
    const hm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
    const dm = (ts) => { const d = new Date(ts); return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0"); };
    const vit = (v) => ({ ts: v.ts, news: v.news, v: v.v, storia: v.storia });
    const riga = (p) => p;

    const pazienti = [
      // alta intensità: un ARANCIONE con un Da fare in scadenza, un ROSSO con i valori fuori range, un VERDE
      riga({ area: "Alta intensità", ep: "999001", nome: "ROSSI MARIO", breve: "ROSSI M.", omonimo: false, triage: "ARANCIONE", posto: "Letto 2",
        nota: "dolore dalle 6, allergico a PCN", prec: false, spento: false, visto: t(-3), eta: 77,
        prom: [{ id: "pr1", t: t(22), testo: "tropo" }, { id: "pr2", t: t(240), testo: "ecg di controllo" }], ordina: true,
        stato: { vit: vit({ ts: t(-14), news: 3, v: [{ t: "PA 148/92", f: "" }, { t: "FC 96", f: "" }, { t: "SpO2 95", f: "" }, { t: "FR 18", f: "" }, { t: "T 36,9", f: "" }],
          storia: [{ ts: t(-14), v: [{ t: "PA 148/92", f: "" }, { t: "FC 96", f: "" }, { t: "SpO2 95", f: "" }, { t: "FR 18", f: "" }, { t: "T 36,9", f: "" }] },
            { ts: t(-74), v: [{ t: "PA 160/98", f: "amb" }, { t: "FC 104", f: "amb" }, { t: "SpO2 94", f: "" }, { t: "FR 20", f: "" }, { t: "T 36,8", f: "" }] }] }),
          esami: [{ nome: "Lab", t: "25′", banda: "" }], vecchio: false, titolo: "Emocromo, troponina: in attesa da 25′ (richiesta " + hm(t(-25)) + ")\nletto alle " + hm(t(-1)),
          segno: "att", cuore: null } }),
      riga({ area: "Alta intensità", ep: "999004", nome: "GALLO PAOLO", breve: "GALLO P.", omonimo: false, triage: "ROSSO", posto: "Rossa",
        nota: "", prec: false, spento: false, visto: t(-1), eta: 82, prom: [{ id: "pr3", t: t(-12), testo: "rivalutare PA dopo fluidi" }], ordina: true,
        stato: { vit: vit({ ts: t(-4), news: 9, v: [{ t: "PA 82/50", f: "ros" }, { t: "FC 128", f: "ros" }, { t: "SpO2 89", f: "ros" }, { t: "FR 28", f: "ros" }, { t: "T 38,9", f: "amb" }],
          storia: [{ ts: t(-4), v: [{ t: "PA 82/50", f: "ros" }, { t: "FC 128", f: "ros" }, { t: "SpO2 89", f: "ros" }, { t: "FR 28", f: "ros" }, { t: "T 38,9", f: "amb" }] },
            { ts: t(-34), v: [{ t: "PA 98/60", f: "amb" }, { t: "FC 112", f: "amb" }, { t: "SpO2 92", f: "amb" }, { t: "FR 24", f: "amb" }, { t: "T 38,4", f: "amb" }] }] }),
          esami: [{ nome: "Lab", t: "12′", banda: "" }, { nome: "RX", t: "40′", banda: "amb" }], vecchio: false,
          titolo: "Emogas, lattati: in attesa da 12′\nRX torace: in attesa da 40′\nletto alle " + hm(t(-1)), segno: "ros",
          cuore: { livello: "ros", vecchio: false, fuori: "NEWS 9 · PA 82/50 · SpO2 89" } } }),
      riga({ area: "Alta intensità", ep: "999002", nome: "BIANCHI ANNA", breve: "BIANCHI A.", omonimo: false, triage: "VERDE", posto: "Sedia 2",
        nota: "", prec: false, spento: false, visto: t(-47), eta: 51, prom: [], ordina: true,
        stato: { vit: null, esami: [], vecchio: false, titolo: "Tutto refertato\nletto alle " + hm(t(-2)), segno: "", cuore: null } }),
      // bassa intensità: AZZURRO con i valori fuori range e gli esami in ritardo, un VERDE senza niente
      riga({ area: "Bassa", ep: "999003", nome: "VERDI LUCA", breve: "VERDI L.", omonimo: false, triage: "AZZURRO", posto: "OBI 1",
        nota: "febbre da 3 giorni", prec: false, spento: false, visto: t(-60), eta: 64, prom: [], ordina: true,
        stato: { vit: vit({ ts: t(-20), news: 6, v: [{ t: "PA 95/60", f: "amb" }, { t: "FC 118", f: "amb" }, { t: "SpO2 90", f: "ros" }, { t: "FR 26", f: "ros" }, { t: "T 38,6", f: "amb" }],
          storia: [{ ts: t(-20), v: [{ t: "PA 95/60", f: "amb" }, { t: "FC 118", f: "amb" }, { t: "SpO2 90", f: "ros" }, { t: "FR 26", f: "ros" }, { t: "T 38,6", f: "amb" }] },
            { ts: t(-80), v: [{ t: "PA 122/80", f: "" }, { t: "FC 84", f: "" }, { t: "SpO2 96", f: "" }, { t: "FR 18", f: "" }, { t: "T 36,8", f: "" }] },
            { ts: t(-140), v: [{ t: "PA 120/78", f: "" }, { t: "FC 80", f: "" }, { t: "SpO2 97", f: "" }, { t: "FR 16", f: "" }, { t: "T 36,6", f: "" }] }] }),
          esami: [{ nome: "Lab", t: "50′", banda: "" }, { nome: "RX", t: "1h40", banda: "amb" }], vecchio: false,
          titolo: "Emocromo: in attesa da 50′\nRX torace: in attesa da 1h40\nletto alle " + hm(t(-2)), segno: "amb",
          cuore: { livello: "ros", vecchio: false, fuori: "NEWS 6 · FR 26 · SpO2 90" } } }),
      riga({ area: "Bassa", ep: "999005", nome: "NERI GIULIA", breve: "NERI G.", omonimo: false, triage: "VERDE", posto: "OBI 3",
        nota: "", prec: false, spento: false, visto: t(-25), eta: 34, prom: [], ordina: true,
        stato: { vit: null, esami: [], vecchio: false, titolo: "letto alle " + hm(t(-2)), segno: "", cuore: null } }),
      // un episodio precedente (sola lettura): nello stesso elenco, già dimesso
      riga({ area: "", ep: "998002", nome: "BIANCHI ANNA", breve: "BIANCHI A.", omonimo: false, triage: "VERDE", posto: "",
        nota: "", prec: true, spento: true, visto: t(-24 * 60), eta: 51, prom: [], ordina: false, stato: null }),
    ];

    const triage = { ts: t(-1), rilegge: false, righe: [
      { nome: "ROSA ELIO", breve: "ROSA E.", eta: 44, triage: "ROSSO", area: "", arrivo: t(-9) },
      { nome: "BLU CARLO", breve: "BLU C.", eta: 71, triage: "AZZURRO", area: "AREA BASSA INTENSITA'", arrivo: t(-38) },
      { nome: "BLU ALDO", breve: "BLU A.", eta: 63, triage: "AZZURRO", area: "", arrivo: t(-55) },
      { nome: "GRIGI TINA", breve: "GRIGI T.", eta: 30, triage: "VERDE", area: "", arrivo: t(-85) },
      { nome: "ZERO MARTA", breve: "ZERO M.", eta: null, triage: "", area: "", arrivo: 0 } ] };

    const mappa = JSON.parse(JSON.stringify(MAPPA));
    mappa.mappe[0].posti = [{ ep: "999001", tipo: "letto", id: "a2" }, { ep: "999004", tipo: "letto", id: "rossa" }, { ep: "999002", tipo: "letto", id: "as2" }];
    mappa.mappe[1].posti = [{ ep: "999003", tipo: "letto", id: "obi1" }, { ep: "999005", tipo: "letto", id: "obi3" }];
    mappa.vista = "alta";

    // gli esiti: ROSSI e GALLO coi valori, VERDI con un referto; gli altri senza niente
    const col = (ts, parziale) => ({ cima: hm(ts), sotto: "", parziale: !!parziale });
    const esiti = {
      "999001": { ep: "999001", paziente: "ROSSI MARIO", letto: t(-6), nota: "",
        tabella: { colonne: [col(t(-110)), { cima: "ieri", sotto: "22:23", parziale: false }],
          gruppi: [{ nome: "Emocromo", righe: [
            { nome: "GB", um: "×10⁹/L", valori: [["9,8", 0, 0, ""], ["8,1", 0, 0, ""]] },
            { nome: "Hb", um: "g/L", valori: [["112", -1, 0, ""], ["124", 0, 0, ""]] },
            { nome: "PLT", um: "×10⁹/L", valori: [["231", 0, 0, ""], ["240", 0, 0, ""]] }] },
          { nome: "Cardiaci", righe: [
            { nome: "TnI US", um: "ng/L", valori: [["38", 1, 0, ""], ["9", 0, 0, ""]] },
            { nome: "NT-proBNP", um: "ng/L", valori: [["880", 1, 0, ""], null] }] },
          { nome: "Chimica", righe: [
            { nome: "Creat", um: "mg/dL", valori: [["1,1", 0, 0, ""], ["1,0", 0, 0, ""]] },
            { nome: "K", um: "mmol/L", valori: [["4,2", 0, 0, ""], ["4,0", 0, 0, ""]] },
            { nome: "PCR", um: "mg/L", valori: [["14", 1, 0, ""], ["6", 0, 0, ""]] }] }] },
        referti: [
          { id: "r-rossi-ecg", quando: dm(t(-100)) + " " + hm(t(-100)), sistema: "PS", titolo: "ECG", tipo: "ecg",
            testo: "Ritmo sinusale, FC 92/min. Asse normale. Non alterazioni ischemiche acute della ripolarizzazione.", lungo: false },
          { id: "r-rossi-rx", quando: dm(t(-70)) + " " + hm(t(-70)), sistema: "RIS", titolo: "RX TORACE", tipo: "rx",
            testo: "RADIOLOGIA - Ospedale di esempio\nQuesito Diagnostico: dolore toracico\nRADIOGRAFIA TORACE 2 PROIEZIONI\nNon focolai a carattere broncopneumonico. Ombra cardiaca nei limiti. Seni costofrenici liberi.\nIl Medico DOTTORE ESEMPIO",
            lungo: false, pdf: true }] },
      "999004": { ep: "999004", paziente: "GALLO PAOLO", letto: t(-9), nota: "",
        tabella: { colonne: [col(t(-30), true)], gruppi: [
          { nome: "Emogas", righe: [
            { nome: "pH", um: "", valori: [["7,29", -1, 1, ""]] },
            { nome: "Lattati", um: "mmol/L", valori: [["4,6", 1, 1, ""]] },
            { nome: "HCO3", um: "mmol/L", valori: [["16", -1, 1, ""]] }] }] },
        referti: [] },
      "999003": { ep: "999003", paziente: "VERDI LUCA", letto: 0, nota: "Per i referti, apri una volta il paziente sul PC", tabella: null,
        referti: [{ id: "r-verdi-ecg", quando: dm(t(-130)) + " " + hm(t(-130)), sistema: "PS", titolo: "ECG", tipo: "ecg", testo: "Tachicardia sinusale, FC 112/min. Non altre alterazioni.", lungo: false }] },
    };
    const vuoti = (p) => ({ ep: p.ep, paziente: p.nome, letto: 0, nota: "", tabella: null, referti: [] });

    // la cartella: i cinque campi; l'EO di ROSSI è di un altro medico (sola lettura)
    const cartelle = {
      "999001": { ANAMNESI: ["Dolore toracico oppressivo dalle 6, irradiato al braccio sx, con sudorazione.", false], MALATTIE_PREGRESSE: ["Ipertensione arteriosa, dislipidemia.", false],
        FARMACI_ASSUNTI: ["Ramipril 5 mg, atorvastatina 20 mg.", false], ALLERGIE: ["Penicillina (rash).", false], ESAME_OBIETTIVO: ["Vigile, eupnoico, apiretico. Torace: MV normotrasmesso.", true] },
      "999004": { ANAMNESI: ["", false], MALATTIE_PREGRESSE: ["", false], FARMACI_ASSUNTI: ["", false], ALLERGIE: ["", false], ESAME_OBIETTIVO: ["", false] },
    };

    // la Terapia: ROSSI ha già due righe; i preferiti sono del medico
    const opz = (l) => l.map(([v, tt]) => ({ v, t: tt }));
    const OPZ = { um: opz([["1", "cpr"], ["2", "fl"], ["3", "mg"], ["4", "ml"], ["5", "g"], ["6", "UI"]]),
      via: opz([["1", "os"], ["2", "ev"], ["3", "im"], ["4", "sc"], ["5", "inal"]]), dil: opz([["1", "SF 100 ml"], ["2", "SF 250 ml"], ["3", "Glu 5% 100 ml"]]) };
    const O = (l, v) => OPZ[l].find((x) => x.v === v);
    const terapie = {
      "999001": [{ prog: "1", descr: "ASA 100 MG CPR", qta: "300", um: "mg", via: "os", dil: "", continua: false, bisogno: false, freq: "", ora: hm(t(-95)) },
        { prog: "2", descr: "PANTOPRAZOLO 40 MG FL", qta: "1", um: "fl", via: "ev", dil: "SF 100 ml", continua: false, bisogno: false, freq: "", ora: hm(t(-90)) }],
      "999004": [], "999003": [], "999002": [], "999005": [],
    };
    const preferiti = [
      { descr: "PARACETAMOLO 1000 MG/100 ML SOL INF", codice: "", qta: "1", um: O("um", "2"), via: O("via", "2"), dil: null, continua: false, bisogno: false },
      { descr: "FUROSEMIDE 20 MG FL", codice: "", qta: "1", um: O("um", "2"), via: O("via", "2"), dil: null, continua: false, bisogno: false },
      { descr: "ONDANSETRON 4 MG FL", codice: "", qta: "1", um: O("um", "2"), via: O("via", "2"), dil: O("dil", "1"), continua: false, bisogno: false },
      { descr: "SALBUTAMOLO 2,5 MG/2,5 ML AEROSOL", codice: "", qta: "1", um: O("um", "2"), via: O("via", "5"), dil: null, continua: false, bisogno: true },
    ];
    return { pazienti, triage, mappa, richieste: RICHIESTE, eo: EO, esiti, vuoti, cartelle, terapie, opz: OPZ, preferiti, voci: TERAPIE_VOCI };
  }
  window.PROVA_DATI = dati;
})();
