import { CardI18n } from '../types'

export const avb3: CardI18n = {
  name: 'Blocco AV completo',
  tagline: 'Due ritmi che condividono un cuore — le P e i QRS non si parlano mai.',
  aliases: ['BAV totale', 'terzo grado', 'blocco completo', 'dissociazione AV', 'scappamento'],
  commitPrompt: 'La tua lettura?',
  options: ['Blocco AV completo', 'Bradicardia sinusale', 'Blocco AV di secondo grado', 'Ritmo giunzionale'],
  tempts: [
    'Sì — marcia le P: più P che QRS, e nessun rapporto PR sopravvive.',
    'Lento, sì — ma marcia le P: sono più numerose dei QRS, e il PR cambia a ogni battito.',
    'Nel secondo grado *qualche* P conduce (con PR fisso o crescente). Qui nessuna P possiede alcun QRS.',
    'Lo scappamento giunzionale è parte della risposta — ma sono le P dissociate che marciano a rendere questo un blocco completo.',
  ],
  why: [
    'La giunzione AV non conduce più — atri e ventricoli vivono vite separate.',
    'Uno scappamento a valle tiene vivi i ventricoli: giunzionale = stretto, ~40–60; ventricolare = largo, ~20–40.',
    'Gli intervalli PR sembrano casuali perché non significano nulla — nessuna P conduce.',
  ],
  whyDrawer: [
    { cause: 'La giunzione AV (nodo o fascio di His) cede completamente', effect: 'Nessun impulso atriale raggiunge i ventricoli' },
    { cause: 'Il nodo del seno mantiene il proprio ritmo', effect: 'Le P proseguono, di norma a 60–100/min, ignorando tutto ciò che sta sotto' },
    { cause: 'Un pacemaker a valle prende il comando', effect: 'Scappamento giunzionale: stretto, ~40–60/min. Scappamento ventricolare: largo, ~20–40/min — più è basso, peggio è' },
    { cause: 'Due orologi indipendenti si sovrappongono sulla carta', effect: '“Intervalli” PR che vagano a caso — il segno che nessuno di essi è reale' },
  ],
  pills: [
    'Marcia le P col compasso. Più P che QRS + nessun PR fisso = blocco completo.',
    'Nell’infarto inferiore il blocco è nodale — spesso transitorio e responsivo all’atropina. Nell’anteriore è sotto-nodale: prognosi peggiore, stimola presto.',
    'Una “bradicardia regolare a 40” che ignora le proprie onde P non è mai sinusale. Guarda due volte.',
    'Bradicardia + allargamento + stranezza = controlla il K⁺ prima di incolpare il sistema di conduzione.',
  ],
  suspectConfirm: [
    'Cerca le cause reversibili: K⁺, farmaci che bloccano il nodo AV (beta-bloccanti, calcio-antagonisti, digossina), ischemia, malattia di Lyme.',
    'Il contesto di infarto acuto cambia tutto — localizzalo (inferiore o anteriore).',
  ],
  guidelineMoves: [
    'Sintomatico → atropina 1 mg EV ogni 3–5 min (massimo 3 mg) mentre si posizionano le piastre; aspettati che fallisca se lo scappamento è largo (sotto-nodale).',
    'Stimolazione transcutanea come ponte → stimolazione transvenosa; tratta la causa in parallelo.',
  ],
  rnMoves: [
    'Più P che QRS e nessun PR fisso = blocco completo. Una “bradicardia regolare a 40” che ignora le proprie P non è mai sinusale — guarda due volte.',
    'Non allontanarti dal letto: piastre pronte, atropina preparata (aspettati che fallisca se il QRS è largo), stimolazione probabile.',
    'Aspettati la caccia alla causa: K⁺, farmaci che bloccano il nodo AV, ischemia — i blocchi da infarto inferiore spesso recuperano, quelli anteriori di solito no.',
  ],
  avoid: 'Sospendi ogni bloccante del nodo AV (beta-bloccanti, diltiazem/verapamil, digossina) finché il blocco persiste — e non lasciare che i cicli di atropina ritardino la stimolazione.',
}
