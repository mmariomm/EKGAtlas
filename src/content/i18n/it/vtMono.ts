import { CardI18n } from '../types'

export const vtMono: CardI18n = {
  name: 'Tachicardia ventricolare monomorfa',
  tagline: 'Largo e veloce è TV finché non è provato il contrario — e la prova raramente vale la scommessa.',
  aliases: ['TV', 'ventricolare', 'largo', 'tachicardia a complessi larghi'],
  commitPrompt: 'La tua lettura?',
  options: [
    'Tachicardia ventricolare',
    'TSV con aberranza',
    'Tachicardia sinusale con blocco di branca',
    'Iperpotassiemia',
  ],
  tempts: [
    'Sì — largo, veloce, con P dissociate che marciano attraverso, e un battito di fusione che chiude il discorso.',
    'Possibile — ma scommetterci uccide. Infarto pregresso o cardiopatia strutturale: probabilità di TV >95%. Età >35 da sola: circa 85%.',
    'Cerca la P sinusale che marcia dentro ogni QRS — qui non ce n’è una di cui fidarsi.',
    'Pensiero legittimo: anche il K⁺ dà largo, brutto e sofferente. Ma qui cerca la marcia tachicardica, uniforme e regolare della TV.',
  ],
  why: [
    'Un focus ventricolare scarica veloce; ogni impulso striscia da cellula a cellula — ogni QRS è largo.',
    'Il nodo sinusale non si è mai fermato: le P dissociate marciano attraverso, e a volte catturano o fondono.',
    'La diffusione muscolo-a-muscolo ignora le branche, così la forma non corrisponde a nessun blocco di branca pulito.',
  ],
  whyDrawer: [
    { cause: 'Un focus ventricolare (spesso legato a una cicatrice) supera in frequenza il nodo sinusale', effect: 'I ventricoli vengono guidati a 140–220/min' },
    { cause: 'Ogni impulso si diffonde da muscolo a muscolo, non lungo le branche', effect: 'Complessi QRS larghi (di solito >140 ms) e uniformi' },
    { cause: 'Gli atri restano sotto il comando sinusale', effect: 'Dissociazione AV — le P marciano indipendenti dal QRS' },
    { cause: 'Ogni tanto un impulso sinusale scende proprio mentre il focus scarica', effect: 'Un battito di fusione (o di cattura) — l’impronta digitale della TV' },
  ],
  pills: [
    'Reperti che chiudono la diagnosi di TV: dissociazione AV, battiti di cattura o fusione, concordanza da V1 a V6, QRS >160 ms, asse estremo (“nord-ovest”).',
    'L’errore fatale è trattare una presunta “TSV con aberranza” con verapamil o diltiazem — nella TV significa ipotensione e arresto. Largo + veloce si tratta come TV.',
    'Gli algoritmi (Brugada e simili) sembrano precisi ma la loro specificità reale è modesta — non lasciare che un diagramma di flusso batta la probabilità pre-test di un infarto pregresso.',
    'Lento, largo e strano senza tachicardia — pensa al K⁺ prima degli antiaritmici.',
  ],
  suspectConfirm: [
    'Dai per scontato che sia TV; controlla K⁺/Mg²⁺, troponina, e vai a cercare un ECG precedente solo DOPO aver messo in sicurezza il paziente.',
    'Dopo la conversione: ECG a 12 derivazioni, elettroliti, ricerca di ischemia — la TV ha sempre una causa.',
  ],
  guidelineMoves: [
    'Instabile → cardioversione sincronizzata. Senza polso → defibrillazione.',
    'Stabile, REGOLARE, monomorfa → procainamide EV (meno eventi avversi dell’amiodarone nello studio PROCAMIO) o amiodarone. Se è IRREGOLARE, trattala come FA pre-eccitata — e lì l’amiodarone non va comunque.',
    'Limiti della procainamide: 20–50 mg/min — stop se compare ipotensione, se il QRS si allarga del 50%, alla conversione, o a 17 mg/kg totali; evitala con QT lungo, FE ridotta o scompenso (lì amiodarone).',
  ],
  rnMoves: [
    'Largo + veloce = TV finché non è provato il contrario. Resta al letto — controlla subito polso e pressione: questo ritmo cambia categoria in pochi secondi.',
    'Senza polso → allarme e defibrillazione. Con polso ma instabile → cardioversione sincronizzata: piastre, aspirazione, sedazione pronta, squadra allertata.',
    'Aspettati procainamide o amiodarone per la TV stabile — con la procainamide sorveglia pressione e QRS: ipotensione o QRS +50% fermano l’infusione.',
    'Dopo la conversione: ECG a 12 derivazioni, K⁺/Mg²⁺, troponina — la TV ha una causa e il percorso inizia subito.',
  ],
  avoid: 'Mai verapamil o diltiazem in QUALSIASI tachicardia a complessi larghi — nella TV significa ipotensione e arresto. Irregolare + largo → trattala come FA pre-eccitata: nemmeno amiodarone.',
}
