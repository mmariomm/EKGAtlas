/*
 * Banco di prova: i dati di prova che le pagine salvate non hanno.
 *
 * Tutto INVENTATO. Le pagine di esempi-gestionale/ restano come sono: il banco
 * (demo/shell.js) aggiunge queste righe al diario del paziente quando la
 * pagina viene servita, con le ore contate da ADESSO (`min`: minuti rispetto
 * all'apertura del banco, negativi = fa), così i ⏳ e i colori dell'attesa si
 * vedono sempre. Le finestre Risultati e i PDF dei referti si costruiscono
 * dagli stessi dati.
 *
 *   prelievi  una riga «Visualizza Risultati» ciascuno; `referto` = già
 *             refertato (LIS); `valori`: [nome, valore, unità, range, stato]
 *   richieste chieste e non ancora tornate (in attesa)
 *   referti   ECG e immagini con il testo scritto; `di` = un ALTRO paziente
 *   vitali    una riga di parametri vitali
 */
export const BANCO = {
  pazienti: {
    // ROSSI MARIO, dolore toracico: troponina che sale, ECG e RX refertati,
    // un ECG di controllo e una TC che aspettano, un referto di un altro.
    "700001": {
      nascita: "15/03/1958", sesso: "M",
      allergie: "Penicillina (orticaria)",
      attenzione: "In terapia con apixaban",
      vitali: [
        { min: -25, testo: "GCS: <b>15</b> / FREQUENZA RESPIRATORIA: <b>22</b> / SATURIMETRIA: <b>94</b> / F.C. R. AR.: <b>104</b> / SISTOLICA (MAX): <b>108</b> / DIASTOLICA(min): <b>64</b> / T.C. TIMP/ASC: <b>37.2</b>" },
      ],
      prelievi: [
        { id: "20269900000101", min: -170, richiesta: "880101", referto: "cccc0101-0000-0000-0000-000000000101",
          esami: ["0-320 EMOCROMOCITOMETRICO URGENTE (POCT1502)", "0-12 CREATININEMIA (POC1201)", "0-41 ELETTROLITI (POC1301)", "0-324 TROPONINA US (POC3001)", "0-220 PT (POC1401)", "0-88 PROTEINA C REATTIVA (POC1801)"],
          valori: [
            ["Leucociti", "11.8", "x10", "4 - 10", "definitivo"],
            ["Emoglobina", "142", "g/L", "135 - 180", "definitivo"],
            ["Piastrine", "231", "x10", "150 - 400", "definitivo"],
            ["Creatinina", "1.32", "mg/dL", "0.67 - 1.17", "definitivo"],
            ["Sodio", "138", "mmol/L", "136 - 145", "definitivo"],
            ["Potassio", "3.3", "mmol/L", "3.5 - 5.1", "definitivo"],
            ["Glucosio", "162", "mg/dL", "74 - 106", "definitivo"],
            ["Troponina I hs", "38", "ng/L", "0 - 34", "definitivo"],
            ["Proteina C reattiva", "4.1", "mg/L", "0 - 5", "definitivo"],
            ["INR", "1.05", "", "0.8 - 1.2", "definitivo"],
          ] },
        { id: "20269900000102", min: -80, richiesta: "880102", referto: "cccc0102-0000-0000-0000-000000000102",
          esami: ["0-324 TROPONINA US (POC3001)", "0-41 ELETTROLITI (POC1301)"],
          valori: [
            ["Troponina I hs", "412", "ng/L", "0 - 34", "definitivo"],
            ["Sodio", "137", "mmol/L", "136 - 145", "definitivo"],
            ["Potassio", "3.6", "mmol/L", "3.5 - 5.1", "definitivo"],
          ] },
        // ancora parziale: il laboratorio non ha finito (🧪 Nuovi valori lo completa)
        { id: "20269900000103", min: -20, richiesta: "880103",
          esami: ["0-310 EMOGASANALISI VENOSA POC - NEW (POC2117)", "0-30 GLICEMIA (POC1101)"],
          valori: [
            ["pH", "7.36", "", "7.32 - 7.43", "parziale"],
            ["Lattato", "2.6", "mmol/L", "0.5 - 2.2", "parziale"],
            ["Glucosio", "155", "mg/dL", "74 - 106", "parziale"],
          ],
          completato: [
            ["pH", "7.36", "", "7.32 - 7.43", "definitivo"],
            ["pCO2", "44", "mmHg", "38 - 50", "definitivo"],
            ["Lattato", "2.1", "mmol/L", "0.5 - 2.2", "definitivo"],
            ["Glucosio", "155", "mg/dL", "74 - 106", "definitivo"],
          ] },
      ],
      richieste: [
        { min: -10, icona: "Laboratorio", richiesta: "880104", esami: ["0-324 TROPONINA US (POC3001)"] },
        { min: -35, icona: "Consulenze", richiesta: "880105", esami: ["8-6 ELETTROCARDIOGRAMMA (84)"] },
        { min: -100, icona: "Radiologia", richiesta: "880106", esami: ["69-210 TC TORACE CON MDC (A7010)"] },
      ],
      referti: [
        { id: "dddd0201-0000-0000-0000-000000000201", min: -150, sistema: "HL7AMB", icona: "Consulenze", richiesta: "880107",
          esame: "8-6 ELETTROCARDIOGRAMMA (84)",
          righe: [
            "FC 92 bpm   PR 168 ms   QRS 94 ms   QTc 438 ms",
            "Interpretazione automatica: ritmo sinusale",
            "Referto",
            "Ritmo sinusale a 92/min. Sottoslivellamento ST di 1 mm in V4-V6.",
            "Non aritmie. ECG precedente non disponibile per il confronto.",
            "Il medico DOTTORE ESEMPIO 2",
          ] },
        { id: "dddd0202-0000-0000-0000-000000000202", min: -120, sistema: "HL7RIS", icona: "Radiologia", richiesta: "880108",
          esame: "69-140 RX TORACE (A6900)",
          righe: [
            "Quesito diagnostico: dolore toracico",
            "RX torace in due proiezioni.",
            "Non addensamenti parenchimali in atto. Seni costofrenici liberi.",
            "Ombra cardiaca nei limiti. Non segni di congestione del piccolo circolo.",
            "Conclusioni: non reperti acuti.",
            "Il medico DOTTORE ESEMPIO 3",
          ] },
        // finito sotto questo paziente, ma il PDF è di un altro: non si mostra
        { id: "dddd0203-0000-0000-0000-000000000203", min: -60, sistema: "HL7RIS", icona: "Radiologia", richiesta: "880109",
          esame: "69-150 RX BACINO (A6910)", di: { nome: "VERDI LUCA", cf: "VRDLCU71H22F205X" },
          righe: [
            "RX bacino in proiezione antero-posteriore.",
            "Non lesioni ossee traumatiche evidenti.",
            "Conclusioni: nei limiti.",
            "Il medico DOTTORE ESEMPIO 3",
          ] },
      ],
    },
    // BIANCHI ANNA: le sue pagine salvate hanno già i prelievi; qui solo
    // l'allergia e due cose da fare
    "700003": {
      nascita: "01/04/1992", sesso: "F",
      allergie: "FANS (broncospasmo)",
    },
  },
  // «Da fare», alla prima apertura del banco (e dopo ⌫ Azzera): `min` = fra quanto
  dafare: {
    "700003": [
      { testo: "Rivalutare il dolore dopo l'analgesia" },
      { testo: "Hb di controllo", min: 40 },
    ],
  },
};
