import { CardI18n } from '../types'

export const rbbb: CardI18n = {
  name: 'Blocco di branca destra',
  tagline: 'Il ventricolo destro riceve la notizia in ritardo — e la racconta a V1 due volte.',
  aliases: ['BBD', 'branca destra', 'rSR', 'QRS largo'],
  commitPrompt: 'La tua lettura?',
  options: ['Blocco di branca destra', 'Blocco di branca sinistra', 'Pattern di Brugada', 'Ritmo ventricolare'],
  tempts: [
    'Sì — l’rSR′ in V1 con onda S larga e terminale in I e V6. Notizie tardive da destra.',
    'Sono larghi entrambi. Il BBS punta in *basso* in V1; l’rSR′ del BBD punta in alto. Decidono le forze terminali.',
    'Sopraslivellamento a tenda (coved) in V1 contro un rSR′ con S larga in I/V6 — il Brugada non ha S terminale larga.',
    'Una P prima di ogni QRS con PR fisso mantiene sopraventricolare questo ritmo.',
  ],
  why: [
    'La branca destra è interrotta; il ventricolo sinistro si attiva in tempo — il battito inizia quasi normalmente.',
    'Il ventricolo destro viene raggiunto tardi, da muscolo a muscolo — una seconda spinta, lenta, verso destra.',
    'È quella spinta tardiva a scrivere l’R′ in V1 e l’S larga in I e V6.',
  ],
  whyDrawer: [
    { cause: 'La branca destra cede; il sistema sinistro consegna nei tempi', effect: 'Setto e ventricolo sinistro si attivano normalmente — i primi ~60 ms sembrano ordinari' },
    { cause: 'Il ventricolo destro attende la diffusione cellula-cellula attraverso il setto', effect: 'Un fronte d’onda tardivo, lento, diretto in avanti e a destra' },
    { cause: 'V1 è affacciata proprio su quel fronte tardivo', effect: 'La seconda R (rSR′) — la V1 “a M”' },
    { cause: 'I e V6 lo vedono allontanarsi', effect: 'L’onda S terminale, larga e impastata' },
  ],
  pills: [
    'Il BBD altera la FINE del QRS, non l’inizio — quindi le regole dell’ischemia restano INVARIATE. Leggi i tratti ST come al solito.',
    'BBD nuovo + emiblocco anteriore sinistro in un dolore toracico anteriore = territorio dell’IVA prossimale che sta morendo, non “solo un blocco”.',
    'Qui la discordanza attesa è modesta: l’inversione della T in V1–V2 è la norma; un sopraslivellamento in V1 NON lo è — indagalo.',
  ],
  suspectConfirm: [
    'BBD nuovo con dispnea o ipotensione: pensa a un sovraccarico destro — l’embolia polmonare va messa nell’elenco.',
  ],
  guidelineMoves: [
    'Un BBD isolato e asintomatico non richiede trattamento — il lavoro sta nel capire che cosa lo ha causato.',
  ],
  rnMoves: [
    'Un BBD isolato e asintomatico è un reperto, non un’emergenza — un BBD NUOVO con dolore toracico, dispnea o ipotensione lo è: segnalalo.',
    'Il BBD non nasconde l’ischemia — i tratti ST si leggono comunque normalmente; un sopraslivellamento in V1 non è mai “solo il blocco”.',
    'BBD nuovo + dispnea o ipotensione: pensa all’embolia polmonare e allerta subito — aspettati troponina, BNP e una discussione sull’imaging; non lasciar correre perché “è solo un blocco”.',
  ],
}
