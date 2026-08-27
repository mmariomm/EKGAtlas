import { CardI18n } from '../types'

export const wpw: CardI18n = {
  name: 'Pre-eccitazione (WPW)',
  tagline: 'Un secondo filo dentro il ventricolo — innocuo all’apparenza, finché non lo trova la fibrillazione atriale.',
  aliases: ['WPW', 'Wolff', 'delta', 'via accessoria', 'PR corto', 'pre-eccitato'],
  commitPrompt: 'La tua lettura?',
  options: ['Pre-eccitazione (WPW)', 'Blocco di branca destra', 'Vecchio infarto posteriore', 'Ipertrofia ventricolare sinistra'],
  tempts: [
    'Sì — PR corto che scivola in un impastamento iniziale, l’onda delta; il QRS è un battito di fusione, a ogni battito.',
    'L’R alta in V1 ti inganna — ma guarda l’INIZIO del QRS: qui l’impastamento è all’esordio (delta), non alla fine (R′).',
    'Ancora R alta in V1 — ma l’infarto posteriore conserva un PR normale e un esordio del QRS netto. Qui il PR è corto e la salita è impastata.',
    'Voltaggi elevati, sì — ma l’ipertrofia non accorcia il PR né impasta l’esordio del QRS.',
  ],
  why: [
    'Una via accessoria scavalca il nodo AV — il ventricolo parte in anticipo: PR corto.',
    'L’inserzione della via diffonde da muscolo a muscolo: la lenta onda delta impastata.',
    'Poi arriva il fronte hissiano che completa il lavoro — ogni QRS è la fusione delle due strade.',
  ],
  whyDrawer: [
    { cause: 'Un ponte muscolare congenito unisce atrio e ventricolo', effect: 'Gli impulsi atriali raggiungono il ventricolo senza il ritardo del nodo AV — PR <120 ms' },
    { cause: 'La via si inserisce nel miocardio comune, non nel sistema His-Purkinje', effect: 'Partenza lenta cellula-cellula: l’impastamento delta che allarga il QRS' },
    { cause: 'La conduzione normale arriva una frazione di battito dopo e completa l’attivazione', effect: 'Un QRS di fusione — il grado di pre-eccitazione varia col tono autonomico' },
    { cause: 'La via conduce anche all’indietro — e velocemente', effect: 'Un circuito di rientro (AVRT) pronto a scattare; e in fibrillazione atriale, un’autostrada senza guardrail verso il ventricolo' },
  ],
  pills: [
    'FA in WPW: irregolare, LARGA, assurdamente veloce, con morfologia che cambia battito per battito. Adenosina, diltiazem, beta-bloccanti, digossina — E amiodarone, il farmaco che la stanza afferra per riflesso — possono incanalarla tutta nella via accessoria → FV. Procainamide o cardioversione.',
    'La delta imita di tutto: pseudo-Q nelle inferiori (finto infarto pregresso), R alta in V1 (finto infarto posteriore o BBD). Prima di diagnosticare un infarto su un QRS strano, guarda il PR.',
    'Tre situazioni, tre regole. Regolare STRETTA (AVRT ortodromica): manovre vagali → adenosina, con le piastre pronte — l’adenosina induce FA nell’1–15% dei casi, e in WPW quella FA è il ritmo letale. Regolare LARGA: AVRT antidromica o TV — trattala come TV, mai un bloccante nodale. Irregolare e larga: nulla che blocchi il nodo, mai.',
  ],
  suspectConfirm: [
    'PR corto (<120 ms) + delta + QRS ≥120 ms è la triade classica — ma la pre-eccitazione può essere intermittente o minima (PR o QRS quasi normali). Una delta che va e viene è comunque WPW.',
    'Sincope, FA pre-eccitata o professione a rischio → studio elettrofisiologico; un RR pre-eccitato più breve ≤250 ms durante FA identifica la via pericolosa.',
  ],
  guidelineMoves: [
    'AVRT ortodromica (stretta) → manovre vagali, poi adenosina — con piastre applicate e defibrillatore a portata: l’adenosina può innescare una FA, e la FA pre-eccitata è quella letale.',
    'FA pre-eccitata (irregolare + larga) → NESSUN bloccante nodale e niente amiodarone: procainamide EV; ibutilide solo con K⁺/Mg²⁺ normali e 4 h di monitoraggio del QT (3–8% di torsioni di punta); oppure cardioversione elettrica sincronizzata.',
    'WPW sintomatico → ablazione transcatetere della via accessoria (prima scelta, alta percentuale di guarigione).',
  ],
  rnMoves: [
    'PR corto + delta impastata su un ECG di routine: segnalalo in cartella — cambia ogni futuro trattamento di TPSV o FA in questo paziente.',
    'WPW noto che diventa irregolare + largo + molto veloce = emergenza: metti in discussione QUALSIASI prescrizione di adenosina, diltiazem, beta-bloccante, digossina o AMIODARONE — aspettati invece procainamide o cardioversione.',
    'Aspettati: piastre pronte, invio all’elettrofisiologo. Una TPSV regolare e STRETTA in WPW può ancora ricevere manovre vagali o adenosina — quella irregolare e larga mai.',
  ],
  avoid: 'Nella FA pre-eccitata: niente adenosina, diltiazem, verapamil, beta-bloccanti, digossina — né amiodarone. Ognuno di questi può incanalare la FA nella via accessoria → FV.',
}
