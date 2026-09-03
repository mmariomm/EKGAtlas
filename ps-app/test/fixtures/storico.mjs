/*
 * The "Storico dati clinici" table, rebuilt from its shape — NOT from the
 * hospital's page. Same markup the portal produces (frozen left table with
 * the exam names and their tooltips, scrollable right table with one column
 * per draw, the filler row between header and data, the out-of-range
 * classes), with invented patients, exams and numbers.
 */
export const PAZIENTE = { idMPI: "900000001", cognome: "BIANCHI", nome: "ANNA", cf: "SMPRSS80A01F205X" };

export const DATE = ["01/09/2026 08:12", "01/09/2026 14:40", "02/09/2026 07:05"];

// esame ordinato, analita, codice, mnemonico, [valore per prelievo], [stato]
// Il primo è la PRESTAZIONE (si ripete su tutte le righe del suo pannello),
// il secondo è l'ANALITA: è quello il nome della riga.
export const ESAMI = [
  ["EMOCROMO", "Emoglobina", "1201", "HB", ["13.2", "11.8", "10.4"], [0, -1, -1]],
  ["EMOCROMO", "Leucociti", "1201", "GB", ["6.4", "", "14.9"], [0, 0, 1]],
  ["EMOCROMO", "Piastrine", "1201", "PLT", ["220", "", ""], [0, 0, 0]],
  ["CREATININA", "S-Creatinina", "1560", "CREA", ["0.92", "1.44", ""], [0, 1, 0]],
  ["SODIO", "S-Sodio", "1570", "NA", ["141", "138", "129"], [0, 0, -1]],
  ["PROTEINA C REATTIVA", "S-PCR", "1610", "PCR", ["", "", ">90.0"], [0, 0, 1]],
  ["EMOCOLTURA", "Emocoltura aerobi", "1700", "EMOC", ["", "NEGATIVO", ""], [0, 0, 0]],
  // un pannello: stessa prestazione, analiti diversi — e HB qui NON è l'Hb
  ["ESAME URINE COMPLETO", "U-Emoglobina", "1600", "HB", ["", "assente", "presente"], [0, 0, 0]],
  ["ESAME URINE COMPLETO", "U-Corpi chetonici", "1600", "KET", ["", "assente", "++"], [0, 0, 0]],
  ["ESAME URINE COMPLETO", "U-Peso Specifico", "1600", "PS", ["", "1015", "1028"], [0, 0, 0]],
];

const cellaValore = (v, stato) => {
  if (!v) return `<td class="ng-scope"><div class="text-center exam-value inline-block w-100 hidden-text m-0 ng-scope"> </div></td>`;
  const extra = stato > 0 ? " danger text-danger out-of-range SUP" : stato < 0 ? " danger text-danger out-of-range INF" : "";
  return `<td class="ng-scope"><div class="text-center exam-value inline-block w-100 hidden-text m-0${extra}"
            uib-tooltip-template="'exam-result-tooltip.html'" tooltip-class="exam-result-tooltip"> ${v} </div></td>`;
};

// disallinea: al corpo manca una riga (le due metà non combaciano)
// bucaColonna: a UNA riga manca una cella (i valori scivolerebbero di colonna)
export function paginaStorico({ paziente = PAZIENTE, date = DATE, esami = ESAMI, disallinea = false, bucaColonna = -1 } = {}) {
  const sxRighe = [
    `<tr><th class="size-14 exam locked"><div>Esame</div></th><th class="size-14 exam-specific locked"><div>Esame specifico</div></th></tr>`,
    `<tr class="filler-header h-50px"></tr>`,
    ...esami.map(([esame, analita, cod, mnem]) => `
      <tr class="ng-scope">
        <td class="exam locked"><div class="m-0 hidden-text ng-binding" uib-tooltip="${cod} - ${esame}">${esame}</div></td>
        <td class="exam-specific locked"><div class="m-0 hidden-text ng-binding" uib-tooltip="${mnem} - ${analita} (${esame})">${analita}</div></td>
      </tr>`),
  ];
  const dxRighe = [
    `<tr>${date.map((d) => `<th class="text-center ng-scope"><div>
        <button type="button" class="btn btn-default btn-table-document ng-binding"> ${d} <i class="glyphicon glyphicon-file"></i></button>
      </div></th>`).join("")}</tr>`,
    `<tr class="filler-header h-50px"></tr>`,
    ...esami.map(([, , , , valori, stati], r) => `<tr class="ng-scope">${
      date.map((_, i) => cellaValore(valori[i] || "", (stati && stati[i]) || 0))
          .filter((_, i) => !(r === bucaColonna && i === 1)).join("")}</tr>`),
  ];
  if (disallinea) dxRighe.pop();   // one row short: the reader must refuse everything
  return `<!doctype html><html><head><meta charset="utf-8"><title>${paziente.cognome} ${paziente.nome} - (${paziente.cf || "SMPRSS80A01F205X"}) INFORMAZIONI CLINICHE</title></head><body>
    <div class="panel panel-default"><div class="panel-heading">
      idMPI: ${paziente.idMPI} Cognome: ${paziente.cognome} Nome: ${paziente.nome} Sesso: F Data di nascita: 01/01/1970
    </div></div>
    <div class="panel panel-default">
      <div class="panel-heading">Tabella esami periodo dal 01/09/2026 al 02/09/2026</div>
      <div class="panel-body"><div class="relative">
        <div class="clinical-data-table__freeze-panel ng-scope">
          <div class="clinical-data-table__freeze-container-left"><table>${sxRighe.join("")}</table></div>
          <div class="clinical-data-table__freeze-container-right body_scroller"><table>${dxRighe.join("")}</table></div>
        </div>
      </div></div>
    </div></body></html>`;
}
