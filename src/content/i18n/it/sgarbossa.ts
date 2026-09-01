import { CardI18n } from '../types'

export const sgarbossa: CardI18n = {
  name: 'Infarto da occlusione in BBS',
  tagline: 'Il BBS nasconde l’ischemia dietro la discordanza attesa — riconosci l’ST che rompe la regola.',
  aliases: ['Sgarbossa', 'Smith', 'BBS', 'concordanza', 'discordanza'],
  commitPrompt: 'La tua lettura?',
  options: ['BBS con sopraslivellamento concordante — infarto da occlusione', 'BBS semplice', 'Ritmo da pacemaker ventricolare', 'Iperpotassiemia'],
  tempts: [
    'Sì — il tratto ST laterale sale INSIEME a un QRS positivo. Il blocco, da solo, non può farlo.',
    'Qui il tratto ST laterale sale INSIEME a un QRS positivo. Il BBS non lo fa mai da solo — confronta il tracciato 2.',
    'Stessa logica della discordanza, ma senza spike di stimolazione — e i criteri valgono comunque per entrambi.',
    'Di nuovo largo e strano — ma le P sono conservate e la storia è dolore toracico, non insufficienza renale.',
  ],
  why: [
    'La regola del BBS: ST/T puntano in senso OPPOSTO al QRS, in proporzione — la “discordanza appropriata”.',
    'Una corrente di lesione transmurale aggiunge sopra di essa il proprio vettore ST.',
    'Un ST che punta INSIEME al QRS — o opposto ma fuori proporzione — è ciò che il blocco non può spiegare: l’occlusione.',
  ],
  whyDrawer: [
    { cause: 'Il BBS impone una depolarizzazione ventricolare sinistra tardiva e retrograda', effect: 'Anche la ripolarizzazione si inverte: ST/T opposti al QRS, in proporzione — la regola di base' },
    { cause: 'Un’occlusione acuta aggiunge un vero vettore di corrente di lesione', effect: 'Uno spostamento del tratto ST che l’anomalia di conduzione non può giustificare' },
    { cause: 'Il vettore di lesione punta INSIEME al QRS laterale (positivo)', effect: 'Sopraslivellamento concordante — 5 punti, quasi diagnostico' },
    { cause: 'Oppure la discordanza supera ogni proporzione', effect: 'Sopraslivellamento ≥25% della profondità dell’onda S (rapporto ST/S di Smith ≤ −0,25) — il criterio moderno e sensibile' },
  ],
  pills: [
    'Sgarbossa: sopraslivellamento concordante ≥1 mm (5 punti) · sottoslivellamento concordante ≥1 mm in V1–V3 (3 punti) · sopraslivellamento discordante ≥5 mm (2 punti). ≥3 punti = trattalo come occlusione.',
    'Modifica di Smith — NON PESATA, senza punteggio: è positivo se è presente ANCHE UNO SOLO tra sopraslivellamento concordante ≥1 mm, sottoslivellamento concordante ≥1 mm in V1–V3, o sopraslivellamento discordante ≥25% dell’S che lo precede (ST/S ≤ −0,25). Sensibilità ~80%, specificità ~99%. Non calcolare punteggi: trovane uno.',
    '“È un BBS, l’ischemia non si legge” è un classico delle revisioni di cartella. Si legge. L’hai appena fatto.',
    'Stesse regole nei ritmi da pacemaker — la concordanza resta colpevole.',
  ],
  suspectConfirm: [
    'Criteri positivi + storia di sindrome coronarica acuta → trattalo come occlusione; ECG seriati nei casi borderline.',
  ],
  guidelineMoves: [
    'Sgarbossa positivo (classico ≥3 punti o modifica di Smith) → attiva la riperfusione.',
  ],
  rnMoves: [
    'BBS o ritmo stimolato + dolore toracico: cerca un ST che punta INSIEME al QRS — la concordanza non è mai il blocco; allerta immediatamente.',
    'Aspettati ECG seriati e attivazione dell’emodinamica se i criteri risultano positivi; tieni a portata gli ECG precedenti — nuovo o vecchio cambia tutto.',
  ],
  avoid: 'Non far passare i criteri di Smith modificati attraverso il sistema a punteggio — basta un solo criterio positivo per attivare. E non annacquare mai una derivazione concordante mediandola con quelle “tranquille”.',
}
