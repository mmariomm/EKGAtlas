import { CardI18n } from '../types'

export const leftmain: CardI18n = {
  name: 'Sottoslivellamento diffuso + aVR ↑',
  tagline: 'Tutte le pareti si lamentano insieme — l’unico quadro in cui aVR è la derivazione che parla più forte.',
  aliases: ['tronco comune', 'aVR', 'sottoslivellamento diffuso', 'subendocardico', 'trivasale'],
  commitPrompt: 'La tua lettura?',
  options: ['Ischemia subendocardica diffusa (tronco comune / trivasale)', 'Infarto da occlusione posteriore', 'Sottoslivellamento da frequenza (TPSV)', 'Effetto digitalico'],
  tempts: [
    'Sì — sottoslivellamento in almeno 6 derivazioni con l’unico sopraslivellamento in aVR: tutto il subendocardio sta soffrendo.',
    'Nel posteriore il sottoslivellamento è MASSIMO in V1–V3 con R alte; qui è ovunque, più profondo nelle laterali, e aVR è sopraslivellata.',
    'Il sottoslivellamento da domanda durante una tachicardia è identico — ma guarda la frequenza: qui non è alta. In tachicardia, rivaluta DOPO aver controllato la frequenza.',
    'La digitale “scava” il tratto ST a dosi terapeutiche — una curva a cucchiaio, modesta, con QT corto e senza sopraslivellamento in aVR.',
  ],
  why: [
    'Tutto lo strato interno del ventricolo sinistro è in debito — per apporto (tronco comune/trivasale) o per domanda (emorragia, ipossia, tachicardia).',
    'La corrente di lesione punta verso l’interno — verso lo strato interno affamato e la cavità ventricolare — da tutte le pareti insieme.',
    'Ciò che sopravvive punta alla spalla destra: sottoslivellamento quasi ovunque, sopraslivellamento solo in aVR (ed eventualmente V1).',
  ],
  whyDrawer: [
    { cause: 'Uno squilibrio globale tra apporto e domanda affama lo strato interno di tutto il ventricolo sinistro', effect: 'Lesione subendocardica circonferenziale — nessuna singola parete colpevole' },
    { cause: 'I vettori di lesione di pareti opposte si annullano tra loro', effect: 'Il vettore netto superstite punta dentro la cavità ventricolare sinistra — e aVR è l’unica derivazione che ci guarda dentro' },
    { cause: 'Solo aVR (e spesso V1) sono affacciate su quel vettore superstite', effect: 'Sopraslivellamento in aVR con sottoslivellamento diffuso — l’esatto contrario di un infarto territoriale' },
    { cause: 'La causa si divide tra apporto e domanda', effect: 'Tronco comune o trivasale — oppure anemia, emorragia digestiva, ipossia, sepsi, tachicardia, dissezione aortica. Prima di somministrare antitrombotici, chiediti quale di queste stai per peggiorare' },
  ],
  pills: [
    'La forma: sottoslivellamento ≥1 mm in sei o più derivazioni (più profondo in I, II, V4–V6) con sopraslivellamento in aVR — ≥0,5 mm conta; ≥1 mm è la soglia specifica (specificità ~93%, valore predittivo negativo ~98% per tronco comune/trivasale). Profondità e numero di derivazioni seguono l’anatomia.',
    'NON è uno specchio “alla posteriore” da capovolgere, e non è un problema di derivazioni — e archiviarlo come “alterazioni aspecifiche del tratto ST” in un paziente che sta male è la mancata diagnosi che riempie l’obitorio in silenzio.',
    'L’errore speculare: NON è un equivalente di STEMI e non è un’attivazione riflessa dell’emodinamica — solo circa il 10% ha un’occlusione trombotica acuta (circa il 60% ha coronaropatia severa). Urgente, non emergente, a meno che l’ischemia sia refrattaria o il paziente instabile.',
    'Se il sottoslivellamento è a prevalenza precordiale, ASCENDENTE al punto J, e si arrampica dentro T alte e simmetriche — quello è de Winter, un’occlusione ADESSO. Non farlo passare per la deviazione apporto-domanda.',
  ],
  suspectConfirm: [
    'Sintomi ischemici in atto + questo quadro → trattalo come sindrome coronarica acuta ad alto rischio: ECG seriati, troponina e una discussione precoce sulla strategia invasiva.',
    'Cerca le cause di domanda e i mimi PRIMA degli antitrombotici: emoglobina, ossigenazione, frequenza, pressione — e il pensiero della dissezione in un dolore sproporzionato o con deficit di polso. Cambiano la destinazione e cambiano ciò che è sicuro somministrare.',
  ],
  guidelineMoves: [
    'Ischemia refrattaria o instabilità emodinamica/elettrica → strategia invasiva immediata (<2 h). Altrimenti sindrome coronarica acuta senza sopraslivellamento ad alto rischio: coronarografia entro ~24 h. La malattia del tronco comune o trivasale spesso significa cardiochirurgia, non solo uno stent.',
    'Se è guidato dalla domanda (emorragia, ipossia, tachiaritmia) → tratta la causa; l’ECG la segue.',
  ],
  rnMoves: [
    'Sottoslivellamento in “quasi tutte le derivazioni” con aVR sopraslivellata = quadro di coronarie sofferenti: allerta adesso, anche se nessuna singola derivazione grida STEMI.',
    'Porta il contesto alla chiamata: ultima emoglobina, saturazione, frequenza, pressione — le cause di domanda (emorragia, ipossia, TPSV) cambiano tutto.',
    'Aspettati: ECG seriati, troponina, possibile attivazione urgente dell’emodinamica — mantieni il paziente a digiuno e monitorizzato.',
  ],
  avoid: 'Nessuna attivazione riflessa da STEMI sulla base di questo solo quadro — e nessun antitrombotico prima di aver pensato a dissezione ed emorragia: eparina dentro una dissezione o un sanguinamento digestivo in atto è il danno che i mimi stanno nascondendo.',
}
