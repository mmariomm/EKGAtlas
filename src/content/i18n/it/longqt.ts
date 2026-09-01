import { CardI18n } from '../types'

export const longqt: CardI18n = {
  name: 'QT lungo iatrogeno e torsione di punta',
  tagline: 'Ogni lista di farmaci scrive sull’onda T — e a QTc 500 il tracciato comincia a fare un nome.',
  aliases: ['QT', 'QTc', 'torsione di punta', 'TdP', 'TV polimorfa', 'farmaci', 'metadone'],
  commitPrompt: 'La tua lettura?',
  options: ['QT prolungato', 'Normale', 'Ipopotassiemia con onde U', 'Alterazione aspecifica della T'],
  tempts: [
    'Sì — la T finisce ben oltre la metà dell’intervallo RR. Misuralo come si deve, poi passa in rassegna la terapia.',
    'A occhio sfugge: se la T finisce oltre la metà dell’RR, misura come si deve.',
    'Una T-U fusa si traveste da QT lungo — e favorisce comunque la torsione di punta. In ogni caso: misura e correggi.',
    'Il QT è un numero, non una sensazione — metodo della tangente, poi correggi per la frequenza.',
  ],
  why: [
    'I farmaci che allungano il QT riducono la riserva di ripolarizzazione — il plateau si allunga.',
    'Un QT lungo allarga la finestra vulnerabile; un battito precoce può cadervi dentro.',
    'Corto-lungo-corto, poi l’asse si torce attorno alla linea di base: torsione di punta.',
  ],
  whyDrawer: [
    { cause: 'Molti farmaci bloccano la corrente rettificante ritardata del potassio (IKr)', effect: 'La ripolarizzazione perde la propria riserva; il plateau del potenziale d’azione si allunga — un QT lungo' },
    { cause: 'Una ripolarizzazione prolungata e disomogenea allarga la finestra vulnerabile', effect: 'Un battito prematuro può cadervi dentro (fenomeno R-su-T)' },
    { cause: 'Una pausa allunga ulteriormente il QT successivo (corto-lungo-corto)', effect: 'La classica sequenza che innesca la torsione di punta' },
    { cause: 'Prendono il sopravvento spirali di rientro con asse rotante', effect: 'TV polimorfa che “si torce attorno alla punta” — autolimitante, finché non lo è più' },
  ],
  pills: [
    'Misura, non guardare: metodo della tangente, il più lungo tra II e V5; usa Fridericia alle frequenze alte o basse (Bazett sovracorregge la tachicardia). QTc ≥500 ms = alto rischio — e lo è anche un aumento >60 ms rispetto al basale del paziente stesso, qualunque sia il valore assoluto.',
    'I soliti sospetti si sommano: antiemetici, antipsicotici, metadone, macrolidi e fluorochinoloni, azoli — più K⁺/Mg²⁺ bassi che li moltiplicano.',
    'Salve di TV polimorfa dopo una pausa al monitor notturno = torsione di punta finché non è provato il contrario — misura il QT dei battiti tra una salva e l’altra.',
    'Una TV polimorfa su un QT basale lungo è torsione di punta, NON una TV qualsiasi — amiodarone e procainamide allungano il QT e la alimentano. Magnesio, correzione del K⁺, stimolazione o isoproterenolo; defibrilla se si sostiene.',
  ],
  suspectConfirm: [
    'Passa in rassegna la terapia e controlla K⁺/Mg²⁺/Ca²⁺ in ogni QT lungo inspiegato o in ogni sincope.',
  ],
  guidelineMoves: [
    'Sospendi ogni farmaco che allunga il QT; magnesio solfato 2 g EV per la torsione di punta — anche con magnesiemia normale.',
    'Correggi il K⁺ verso il limite alto della norma; salve ricorrenti pausa-dipendenti → stimolazione di overdrive, oppure isoproterenolo SOLO quando il QT lungo è acquisito o iatrogeno — nella sindrome del QT lungo congenita i beta-agonisti la provocano (la terapia è il beta-blocco).',
    'Sostenuta o in degenerazione → defibrillazione.',
  ],
  rnMoves: [
    'Prima di appendere farmaci che allungano il QT (antiemetici, antipsicotici, macrolidi, metadone): controlla l’ultimo QTc — se ≥500 ms, conferma prima con chi prescrive.',
    'Salve di TV polimorfa dopo una pausa al monitor = torsione di punta: la richiesta è il magnesio, segnala qualunque prescrizione di amiodarone — e se si sostiene o il polso è assente, defibrilla secondo ACLS.',
    'Aspettati la correzione di K⁺/Mg²⁺ fino al target; salve ricorrenti → il discorso su stimolazione o isoproterenolo.',
  ],
  avoid: 'Niente amiodarone né procainamide per le salve polimorfe — entrambi allungano il QT che le ha causate. E niente isoproterenolo se il QT lungo potrebbe essere congenito.',
}
