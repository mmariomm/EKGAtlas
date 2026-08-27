import { CardI18n } from '../types'

export const tca: CardI18n = {
  name: 'Tossicità da bloccanti dei canali del sodio (triciclici)',
  tagline: 'Trattare il ritmo mentre vince il veleno — l’R terminale in aVR è il segno che lo smaschera.',
  aliases: ['triciclici', 'TCA', 'intossicazione', 'bicarbonato', 'aVR', 'sovradosaggio'],
  commitPrompt: 'La tua lettura?',
  options: ['Tossicità da bloccanti dei canali del sodio', 'Tachicardia ventricolare', 'Iperpotassiemia', 'Semplice tachicardia sinusale'],
  tempts: [
    'Sì — tachicardia sinusale, allargamento dell’intero QRS e l’R terminale che cresce in aVR. Qui l’antiaritmico è il bicarbonato.',
    'Largo e veloce — ma questa è una tachicardia sinusale con forze terminali enormi in aVR. Gli antiaritmici di classe I qui sarebbero benzina.',
    'Entrambi allargano il QRS. L’iperpotassiemia appiattisce le P e fa le T a tenda; il triciclico accelera (tachicardia anticolinergica) e scaglia il vettore terminale verso aVR.',
    'La frequenza è di tipo sinusale — sono la LARGHEZZA e l’R terminale in aVR la firma del veleno.',
  ],
  why: [
    'I triciclici bloccano i canali rapidi del sodio — la fase 0 di ogni cellula rallenta, e il QRS si allunga.',
    'Il lato destro del setto e la base soffrono di più — il vettore terminale ruota verso aVR.',
    'QRS largo + R terminale in aVR + tachicardia in un sovradosaggio = tracciato avvelenato, non aritmia primitiva.',
  ],
  whyDrawer: [
    { cause: 'I triciclici bloccano i canali rapidi del Na⁺ in modo uso-dipendente', effect: 'La fase 0 rallenta in ogni miocita — l’intero QRS si allunga' },
    { cause: 'Il setto destro e la conduzione basale subiscono di più il rallentamento', effect: 'Le ultime forze di ogni battito ruotano in alto, a destra e in avanti: in aVR cresce un’R terminale' },
    { cause: 'Gli effetti anticolinergici e simpaticomimetici accelerano il nodo del seno', effect: 'Tachicardia sinusale sotto l’allargamento — al contrario della deriva bradicardica dell’iperpotassiemia' },
    { cause: 'Anche il blocco dei canali del potassio allunga la ripolarizzazione', effect: 'Un QT lungo viaggia insieme — la torsione di punta entra nel menu una volta controllato il QRS' },
  ],
  pills: [
    'Numeri che mordono: QRS >100 ms → rischio di convulsioni; >160 ms → rischio di aritmie ventricolari. Un’R terminale in aVR ≥3 mm è il segnale classico.',
    'Somministrare un antiaritmico di classe IA/IC (altro blocco del sodio) per la presunta “TV” è esattamente la mossa sbagliata. Qui l’antiaritmico È il bicarbonato.',
    'Alterazione dello stato di coscienza + tachicardia + QRS largo + pupille dilatate e cute secca = pensa ai triciclici prima che torni lo screening tossicologico.',
  ],
  suspectConfirm: [
    'Sospettala dal contesto (ingestione, alterazione dello stato di coscienza, segni anticolinergici); conferma clinicamente — tratta prima dei dosaggi.',
    'Segui la larghezza del QRS in serie — è il livello del farmaco che puoi vedere.',
  ],
  guidelineMoves: [
    'Bicarbonato di sodio 1–2 mEq/kg in bolo, ripetuto fino a restringere il QRS — tetto di pH 7,50–7,55, e ricontrolla il K⁺ a ogni ciclo: l’alcalinizzazione lo abbassa, e il QT lungo che viaggia insieme trasforma l’ipopotassiemia in carburante per la torsione di punta.',
    'Aritmia refrattaria dopo il bicarbonato → la lidocaina (classe IB) è la seconda linea accettata; arresto refrattario → emulsione lipidica secondo protocollo.',
  ],
  rnMoves: [
    'Sovradosaggio + alterazione dello stato di coscienza + tachicardia: registra presto il 12 derivazioni — un QRS >100 ms predice le convulsioni; una tendenza all’allargamento è un peggioramento, allerta.',
    'Aspettati boli di bicarbonato di sodio con emogas ed elettroliti seriati a fianco, benzodiazepine per le convulsioni, presidi per le vie aeree pronti — e metti in discussione qualunque prescrizione di procainamide o flecainide per la presunta “TV” (altro blocco del sodio).',
    'Gli ECG seriati sono il livello del farmaco che puoi vedere — mettili a orario e annota ogni volta la larghezza del QRS.',
  ],
  avoid: 'Nessun antiaritmico di classe IA/IC né amiodarone (altro blocco dei canali Na⁺/K⁺ su un cuore già bloccato) — e niente fenitoina per le convulsioni. La terapia sono benzodiazepine e bicarbonato.',
}
