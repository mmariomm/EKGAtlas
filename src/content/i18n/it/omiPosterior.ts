import { CardI18n } from '../types'

export const omiPosterior: CardI18n = {
  name: 'Infarto da occlusione posteriore',
  tagline: 'Leggi la parete posteriore allo specchio: un sottoslivellamento in V1–V3 che è un sopraslivellamento capovolto.',
  aliases: ['posteriore', 'circonflessa', 'specchio', 'V7-V9', 'infero-basale'],
  commitPrompt: 'La tua lettura?',
  options: ['Infarto da occlusione posteriore', 'Ischemia subendocardica anteriore', 'Blocco di branca destra', 'R alta come variante normale'],
  tempts: [
    'Sì — sottoslivellamento massimo in V1–V3 sopra un’R che cresce, con T positiva: lo specchio. Registra V7–V9.',
    '“Ischemia anteriore” è l’errore classico di etichetta. Sottoslivellamento MASSIMO in V1–V3 (non in V4–V6) + R alta = parete posteriore.',
    'R alta in V1, ma qui il QRS è stretto e non c’è alcuna S terminale larga.',
    'Una V1 con R alta da sola, forse — ma con sottoslivellamento orizzontale e T positiva, no.',
  ],
  why: [
    'Nessun elettrodo è affacciato sulla parete posteriore — V1–V3 la guardano dal lato sbagliato.',
    'Il sopraslivellamento posteriore si registra quindi come sottoslivellamento ANTERIORE; la Q posteriore come un’R alta.',
    'Capovolgi il tracciato e si legge come uno STEMI da manuale — tutto il trucco è qui.',
  ],
  whyDrawer: [
    { cause: 'Un’occlusione (di solito della circonflessa) infarcisce la parete posteriore/infero-basale', effect: 'Una corrente di lesione transmurale diretta posteriormente, LONTANO dal torace' },
    { cause: 'V1–V3 stanno esattamente sul lato opposto della parete toracica', effect: 'Registrano la lesione capovolta: SOTTOslivellamento invece che sopraslivellamento' },
    { cause: 'Anche la Q posteriore in formazione viene vista da dietro', effect: 'Un’onda R alta e slargata in V1–V2 (rapporto R/S che sale verso 1)' },
    { cause: 'L’inversione della T posteriore vista dal davanti', effect: 'Una T positiva in V1–V2 — lo specchio è completo' },
  ],
  pills: [
    'Un sottoslivellamento massimo in V1–V3 è infarto posteriore finché non è provato il contrario. Se è massimo in V4–V6 indica altro (subendocardico o da domanda).',
    'Etichettarlo “NSTEMI, terapia medica” mentre la circonflessa è chiusa: la mancata diagnosi che non entra in nessuna statistica. Decidono le derivazioni posteriori o la coronarografia.',
    'Raramente viaggia da solo — cerca compagnia nelle derivazioni inferiori e laterali.',
  ],
  suspectConfirm: [
    'Criterio d’ingresso: sottoslivellamento orizzontale ≥0,5 mm massimo in V1–V3 con rapporto R/S che sale verso 1 → registra V7–V9: un sopraslivellamento ≥0,5 mm lì conferma (≥1 mm negli uomini <40 anni).',
  ],
  guidelineMoves: [
    'Infarto posteriore confermato = riperfusione, con la stessa urgenza di qualunque STEMI.',
  ],
  rnMoves: [
    'Un sottoslivellamento più profondo in V1–V3 è infarto posteriore finché non è provato il contrario — registra V7–V9 e RIETICHETTA il tracciato, perché chi lo legge dopo di te non venga ingannato; tre elettrodi cambiano la destinazione del paziente.',
    'Non lasciare che l’etichetta “NSTEMI” rallenti la stanza — un infarto posteriore confermato viaggia alla velocità di uno STEMI.',
  ],
  avoid: 'Non archiviarlo mai come “NSTEMI, terapia medica” una volta che le derivazioni posteriori confermano — un infarto posteriore confermato segue il percorso di riperfusione alla velocità di uno STEMI.',
}
