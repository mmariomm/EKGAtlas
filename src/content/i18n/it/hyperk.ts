import { CardI18n } from '../types'

export const hyperk: CardI18n = {
  name: 'Iperpotassiemia',
  tagline: 'Il tracciato è una finestra sul sangue, non solo sul cuore — e il potassio è la cosa più rapida che mostra.',
  aliases: ['potassio', 'K', 'iperK', 'T a tenda', 'renale', 'dialisi'],
  commitPrompt: 'La tua lettura?',
  options: [
    'Iperpotassiemia',
    'Occlusione acuta (T iperacuta)',
    'Tachicardia ventricolare',
    'Blocco di branca sinistra',
  ],
  tempts: [
    'Sì — T strette e a tenda, P che sbiadiscono, un QRS che comincia ad allargarsi. Prima il calcio.',
    'Le T dell’occlusione hanno base ampia e sono regionali; quelle dell’iperK sono strette, pizzicate e ovunque.',
    'Largo e strano si legge come TV — l’onda sinusoidale da iperpotassiemia è già stata defibrillata come TV più di una volta. Paziente critico + insufficienza renale + nessuna P chiara → prima il K⁺.',
    'QRS largo, ma con P che si appiattiscono e T a tenda — i blocchi non cancellano le onde P.',
  ],
  why: [
    'Il K⁺ che sale alza il potenziale di riposo — tutto il miocardio resta a metà depolarizzato.',
    'Per prima accelera la ripolarizzazione: T alte, strette, a tenda.',
    'Poi i canali del sodio si inattivano: le P si appiattiscono, il PR si allunga, il QRS si allarga — verso l’onda sinusoidale.',
  ],
  whyDrawer: [
    { cause: 'Il K⁺ sierico sale e alza (rende meno negativo) il potenziale di membrana a riposo', effect: 'Ogni miocita resta più vicino alla soglia, parzialmente depolarizzato' },
    { cause: 'Una maggiore conduttanza al K⁺ accelera la ripolarizzazione terminale (fase 3)', effect: 'Onde T alte, strette, simmetriche, a tenda — la prima alterazione' },
    { cause: 'Il riposo depolarizzato inattiva i canali del sodio → fase 0 più lenta', effect: 'La conduzione rallenta ovunque: il PR si allunga, il QRS si allarga, gli atri tacciono mentre il seno continua a guidare (ritmo sinuventricolare)' },
    { cause: 'All’estremo la conduzione quasi cede del tutto', effect: 'QRS e T si fondono in un’onda sinusoidale → FV o asistolia' },
  ],
  pills: [
    'T a tenda = ci pungeresti un dito: alta, a base STRETTA, simmetrica. L’esordio dell’iperK — contro la T iperacuta, che è ampia.',
    'Tratta l’ECG, non il numero: qualsiasi allargamento, bradicardia o onda sinusoidale → calcio SUBITO. E la sequenza T a tenda → largo → sinusoide è una successione didattica, non clinica: i pazienti arrivano a qualsiasi stadio, o ne saltano alcuni del tutto.',
    'Dialisi, insufficienza renale, sindrome da schiacciamento + ritmo lento, largo e bizzarro senza P = K⁺ finché non è provato il contrario — tratta empiricamente.',
    '⚠ Un ECG normale non esclude mai l’iperpotassiemia: la sensibilità è scarsa. Serve a confermare, mai a escludere.',
  ],
  suspectConfirm: [
    'Sospettala dal quadro e dal contesto (insufficienza renale, diuretici risparmiatori di potassio, ACE-inibitori, schiacciamento, acidosi); confermala con un K⁺ urgente e un’emogas venosa.',
    'La velocità di salita conta più del valore assoluto — è la salita rapida quella pericolosa.',
  ],
  guidelineMoves: [
    'Alterazioni ECG → PRIMA il calcio, alla dose giusta: 30 ml di calcio gluconato 10% in 10 min (tre fiale — una sola è il classico sotto-dosaggio), oppure 10 ml di CaCl₂ 10% se peri-arresto. L’effetto svanisce in 30–60 min: ripeti se l’ECG non si è normalizzato.',
    'Poi sposta il potassio: 10 U di insulina rapida in 25 g di glucosio; se la glicemia di partenza è <7 mmol/L, fai seguire glucosata 10% a 50 ml/h per 5 h — è quell’infusione, non la sorveglianza, a prevenire la classica ipoglicemia tardiva. Glicemia a 0/30/60/90/120 min, poi ogni ora fino a 6 h. Salbutamolo 10–20 mg per aerosol come aggiunta, mai da solo.',
    'Poi elimina: dialisi, un chelante moderno (SZC o patiromer — non polistirene sulfonato), diuresi — e sospendi ogni fonte di K⁺.',
    'Ricontrolla il K⁺ a 1, 2, 4, 6 e 24 h — è il rimbalzo, quando finisce l’effetto dello shift, a uccidere il paziente che credevi trattato.',
  ],
  rnMoves: [
    'Paziente nefropatico + ritmo largo, bizzarro, lento o senza P: pensa prima al K⁺ — K⁺ urgente ed emogas venosa, e TRE fiale (30 ml) di calcio gluconato 10% pronte al letto prima che torni il valore.',
    'Sospendi subito ogni fonte di K⁺ che dipende da te: chiudi fleboclisi o nutrizione parenterale contenenti potassio, sospendi il KCl in corso e i risparmiatori di potassio in terapia — e dillo quando chiami.',
    'Dopo insulina/glucosio: glicemia a 0, 30, 60, 90, 120 min poi ogni ora fino a 6 h — il nadir si nasconde presto e il danno arriva tardi; aspettati una glucosata 10% se la glicemia di partenza era bassa.',
    'Un ECG normale non esclude mai l’iperK (sensibilità ~35–45%) — storia preoccupante, tracciato normale: manda comunque il prelievo.',
  ],
  avoid: 'Non negare il calcio per un sospetto di tossicità digitalica — il “cuore di pietra” è un mito (nessuna aritmia né eccesso di mortalità con calcio EV nei pazienti intossicati). E non lasciare mai il potassio in infusione.',
  moduleLabel: 'Laboratorio K⁺: cinque pazienti, un solo potassio — stimalo',
}
