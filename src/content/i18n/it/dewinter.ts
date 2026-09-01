import { CardI18n } from '../types'

export const dewinter: CardI18n = {
  name: 'Pattern di de Winter',
  tagline: 'Lo STEMI anteriore che si è dimenticato di sopraslivellare: sottoslivellamento ascendente che si arrampica dentro T giganti.',
  aliases: ['de Winter', 'IVA prossimale', 'equivalente di occlusione', 'T giganti'],
  commitPrompt: 'La tua lettura?',
  options: ['de Winter — equivalente di occlusione dell’IVA', 'Ischemia subendocardica', 'Iperpotassiemia', 'Ripolarizzazione precoce'],
  tempts: [
    'Sì — punti J che si abbassano, e da lì T simmetriche che svettano. L’arteria è chiusa ADESSO.',
    '“Sottoslivellamento diffuso, terapia medica” — ma un sottoslivellamento ASCENDENTE che sale dentro T enormi è un’IVA chiusa, adesso.',
    'T alte, sì — ma quelle dell’iperpotassiemia hanno base stretta e sono pizzicate; queste sono ampie, partono da un punto J depresso, e la storia è coronarica.',
    'Nella ripolarizzazione precoce il punto J è sopraslivellato, non depresso. Partenza opposta.',
  ],
  why: [
    'L’IVA prossimale si occlude — tutta la parete anteriore diventa ischemica nello stesso momento.',
    'La corrente di lesione è a prevalenza subendocardica: i punti J si abbassano su tutte le precordiali.',
    'L’ischemia transmurale acuta fa svettare le T diritte fuori da quella partenza depressa.',
  ],
  whyDrawer: [
    { cause: 'L’IVA prossimale si occlude acutamente', effect: 'L’intera parete anteriore è a rischio nello stesso istante' },
    { cause: 'La corrente di lesione è a prevalenza subendocardica anziché subepicardica', effect: 'Sottoslivellamento ascendente del punto J da V1 a V6, spesso con lieve sopraslivellamento in aVR' },
    { cause: 'L’ischemia transmurale acuta deforma la ripolarizzazione', effect: 'T alte, ampie, simmetriche, “iperacute”, che salgono diritte fuori dal sottoslivellamento' },
    { cause: 'Il quadro spesso resta tale — e quando evolve, evolve in STEMI', effect: 'Aspettare il sopraslivellamento classico significa aspettare la necrosi' },
  ],
  pills: [
    'Il riconoscimento: sottoslivellamento ascendente ≥1 mm al punto J nelle precordiali + T alte e simmetriche + spesso un lieve sopraslivellamento in aVR.',
    'Di solito NON evolve nel sopraslivellamento classico — aspettare il sopraslivellamento significa aspettare la necrosi.',
    'Dolore toracico in atto + questo quadro = chiama l’emodinamica come per uno STEMI, perché lo è.',
    'Sottoslivellamento in MOLTE derivazioni con aVR sopraslivellata e senza T giganti = ischemia subendocardica diffusa, una bestia diversa con un orologio diverso.',
  ],
  suspectConfirm: [
    'Tratta il quadro come un equivalente di occlusione; gli ECG seriati non lo declassano.',
  ],
  guidelineMoves: [
    'Percorso di riperfusione immediato — come per uno STEMI.',
  ],
  rnMoves: [
    'Sottoslivellamento ascendente + T che svettano sulle precordiali con dolore in atto = equivalente di occlusione — la stanza si muove alla velocità di uno STEMI; non aspettare il sopraslivellamento.',
    'Gli ECG seriati non lo declassano — tieni viva la discussione sulla riperfusione.',
  ],
  avoid: 'Non aspettare il sopraslivellamento ST — di solito non arriva mai, e gli ECG seriati non possono declassare il quadro. L’occlusione è adesso.',
}
