import { CardI18n } from '../types'

export const brugada: CardI18n = {
  name: 'Pattern di Brugada (tipo 1)',
  tagline: 'Un’onda a tenda in V1–V2 che segnala una malattia dei canali del sodio — trovata alle 3 di notte, spesso per caso.',
  aliases: ['Brugada', 'coved', 'canalopatia', 'sincope', 'SCN5A'],
  commitPrompt: 'La tua lettura?',
  options: ['Brugada tipo 1', 'Blocco di branca destra', 'Infarto da occlusione anterosettale', 'Artefatto da posizionamento alto delle derivazioni'],
  tempts: [
    'Sì — sopraslivellamento a tenda che sfocia in una T invertita, solo in V1–V2. Un canale, non una coronaria.',
    'Lo pseudo-R′ inganna tutti — ma non c’è S larga in I/V6, e il sopraslivellamento scende a tenda dentro una T invertita.',
    'Sopraslivellamento a tenda e discendente limitato a V1–V2 senza reciproche: bestia diversa; decidono la storia (sincope, febbre, familiarità).',
    'Sospetto legittimo! V1–V2 posizionate in alto possono fabbricare questa forma in torace sani — verifica il posizionamento prima di etichettare una vita.',
  ],
  why: [
    'Un difetto dei canali del sodio fa ripolarizzare precocemente e in modo disomogeneo il tratto d’efflusso del ventricolo destro.',
    'V1–V2 gli stanno proprio sopra: sopraslivellamento a tenda ≥2 mm che scivola dentro una T invertita.',
    'Il resto dell’ECG è normale — il pericolo si nasconde in due derivazioni.',
  ],
  whyDrawer: [
    { cause: 'Corrente del sodio ridotta (spesso una perdita di funzione di SCN5A)', effect: 'Un fronte di salita indebolito, peggiore dove l’Ito è più forte — l’epicardio del ventricolo destro' },
    { cause: 'L’epicardio del tratto d’efflusso destro perde il plateau del potenziale d’azione; l’endocardio lo mantiene', effect: 'Un gradiente di voltaggio transmurale attraverso il tratto d’efflusso' },
    { cause: 'V1–V2 sono affacciate esattamente su quel gradiente', effect: 'Sopraslivellamento a tenda che sfocia in una T invertita — il tipo 1' },
    { cause: 'La stessa dispersione della ripolarizzazione consente il rientro di fase 2', effect: 'TV polimorfa o FV — sincope o morte improvvisa, spesso nel sonno o durante febbre' },
  ],
  pills: [
    'Il tipo 1 (a tenda ≥2 mm, in V1–V2, derivazioni standard o alte) è l’unica forma diagnostica; il tipo 2 “a sella” è soltanto un motivo per guardare meglio.',
    'La febbre lo smaschera e lo peggiora — tratta la febbre in modo aggressivo e ripeti l’ECG dopo.',
    'Un tipo 1 occasionale + sincope o morte improvvisa in famiglia = non dimettere dal triage; consulenza elettrofisiologica.',
    'Anche le fenocopie scrivono un tipo 1: iperpotassiemia, tossicità da bloccanti del sodio, febbre, ipotermia — e V1–V2 posizionate troppo in alto (verifica la posizione prima che l’etichetta si attacchi; provalo nel Laboratorio elettrodi). Prima le cause reversibili, poi l’etichetta che dura una vita.',
  ],
  suspectConfirm: [
    'Chiedi tre cose: sincope, morte improvvisa in famiglia sotto i 45 anni, febbre concomitante al quadro.',
    'Verifica il posizionamento; ripeti con derivazioni corrette (e, in mani elettrofisiologiche, alte).',
  ],
  guidelineMoves: [
    'Tipo 1 sintomatico → invio all’elettrofisiologo (discussione sul defibrillatore impiantabile); asintomatico → stratificazione del rischio, evitare i farmaci scatenanti, trattare la febbre.',
  ],
  rnMoves: [
    'Sopraslivellamento a tenda in V1–V2 su un ECG di routine o durante febbre: non archiviarlo — segnalalo per revisione e fai due domande: sincope? morte improvvisa in famiglia in giovane età?',
    'Controlla prima l’altezza degli elettrodi — V1–V2 posizionate troppo in alto fabbricano il quadro in torace sani.',
    'La febbre lo smaschera e lo peggiora: trattala in modo aggressivo, ripeti l’ECG dopo, tieni il paziente monitorizzato.',
  ],
  avoid: 'Evita gli antiaritmici di classe IA/IC e la febbre non trattata in un Brugada noto o sospetto — e non archiviare mai l’etichetta che dura una vita prima che il K⁺ e la lista dei farmaci abbiano escluso una fenocopia.',
  moduleLabel: 'Provalo: V1–V2 posizionate in alto fabbricano uno pseudo-Brugada — il Laboratorio elettrodi mostra come',
}
