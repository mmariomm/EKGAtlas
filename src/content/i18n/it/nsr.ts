import { CardI18n } from '../types'

export const nsr: CardI18n = {
  name: 'Ritmo sinusale normale',
  tagline: 'Un vettore, dodici ombre — la linea di base con cui si misura ogni altra scheda.',
  aliases: ['normale', 'sinusale', 'RSN', 'basale'],
  commitPrompt: 'La tua lettura?',
  options: [
    'Ritmo sinusale normale',
    'Tachicardia sinusale',
    'Blocco AV di primo grado',
    'Fibrillazione atriale',
  ],
  tempts: [
    'Sì — una P prima di ogni QRS, PR ≤200 ms, QRS stretto, frequenza regolare.',
    'La frequenza a occhio inganna — conta i quadrati: 300/150/100/75/60.',
    'Il PR è generoso ma resta ≤200 ms. Misuralo, non fidarti dell’impressione.',
    'Una linea di base ondulata non è fibrillazione — qui le P marciano.',
  ],
  why: [
    'Ogni deflessione è il vettore elettrico del cuore, proiettato sulla linea di vista di quella derivazione.',
    'QRS stretto = i due ventricoli si sono attivati insieme, attraverso branche sane.',
    'La pausa PR è il nodo AV che tiene la porta — l’unica via normale verso il basso.',
  ],
  whyDrawer: [
    { cause: 'Il nodo SA scarica per primo: è il pacemaker naturale più veloce', effect: 'Una piccola onda atriale: la P, positiva in II' },
    { cause: 'Il nodo AV trattiene l’impulso ~100 ms perché gli atri finiscano di svuotarsi', effect: 'Il segmento PR piatto' },
    { cause: 'His → branche → Purkinje portano l’impulso ovunque nello stesso istante', effect: 'I ventricoli si attivano insieme: un QRS stretto e alto' },
    { cause: 'I ventricoli si ripolarizzano dall’esterno verso l’interno', effect: 'Un’onda T ampia, concordante con il QRS' },
  ],
  pills: [
    'Frequenza col reticolo: 300–150–100–75–60 per quadrato grande. Più rapido che contare, più difficile da sbagliare.',
    'Intervalli normali: PR 120–200 ms, QRS <120 ms, QTc <450 ms (uomo) / <460 ms (donna). Tre numeri escludono metà del catalogo.',
    'Irregolare ma con onde P = aritmia sinusale (respira col paziente), non FA.',
  ],
  suspectConfirm: [
    'Un ECG normale è un’istantanea, non un alibi — i sintomi più un solo tracciato non decidono nulla.',
    'Dolore toracico con primo ECG normale → ECG seriati e troponina.',
  ],
  guidelineMoves: [
    'Nessun reperto da trattare — cura il paziente che hai davanti.',
  ],
  rnMoves: [
    'Normale è un’istantanea, non un alibi — un dolore toracico con ECG pulito resta monitorizzato: ripeti l’ECG in 10–15 min, troponina, segnala ogni cambiamento.',
    'Impara a memoria i numeri del triage: PR 120–200 ms, QRS <120 ms, QTc <450/<460 ms (uomo/donna) — fuori da lì serve una seconda occhiata prima di archiviare.',
  ],
}
