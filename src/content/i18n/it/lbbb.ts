import { CardI18n } from '../types'

export const lbbb: CardI18n = {
  name: 'Blocco di branca sinistra',
  tagline: 'Tutto il ventricolo sinistro si attiva tardi e all’indietro — e con sé riscrive le regole del tratto ST.',
  aliases: ['BBS', 'branca sinistra', 'QRS largo', 'blocco'],
  commitPrompt: 'La tua lettura?',
  options: [
    'Blocco di branca sinistra',
    'STEMI anteriore',
    'Blocco di branca destra',
    'Ritmo da pacemaker ventricolare',
  ],
  tempts: [
    'Sì — QRS largo, S dominante in V1, R laterale ampia e intaccata, ST/T discordanti.',
    'Il sopraslivellamento in V1–V3 è discordanza *attesa* sopra onde S profonde — proporzionata, non lesione. Impara la regola prima dell’eccezione.',
    'Guarda la direzione terminale in V1: verso il basso = problema della branca sinistra.',
    'Stessa fisica (prima il ventricolo destro), ma qui non c’è nessuno spike di stimolazione.',
  ],
  why: [
    'La branca sinistra è interrotta — il setto si attiva ora da destra a sinistra (la q settale scompare).',
    'Il ventricolo sinistro, dominante, si depolarizza tardi e lentamente — QRS largo, intaccato, diretto a sinistra.',
    'Una depolarizzazione anomala impone una ripolarizzazione anomala: ST/T puntano in senso OPPOSTO al QRS, in proporzione.',
  ],
  whyDrawer: [
    { cause: 'La branca sinistra è bloccata; solo la destra consegna in tempo', effect: 'Il ventricolo destro e il setto destro iniziano il battito' },
    { cause: 'Il setto viene attivato al contrario, da destra a sinistra', effect: 'La normale q settale in V5–V6 scompare' },
    { cause: 'Il grande ventricolo sinistro aspetta la lenta diffusione cellula-cellula', effect: 'Un QRS largo (≥120 ms), intaccato, diretto a sinistra' },
    { cause: 'La depolarizzazione tardiva impone una ripolarizzazione tardiva e invertita', effect: '“Discordanza appropriata”: ST/T opposti al QRS, in proporzione' },
  ],
  pills: [
    'La “discordanza appropriata” è la linea di base su cui misurerai l’ischemia — assimilala qui, sfruttala nella scheda Sgarbossa.',
    '“BBS nuovo = sala di emodinamica automatica” è superato. Un BBS nuovo con una storia convincente resta serio — ma decide la scheda dei criteri.',
    'Un BBS con ST *concordante* in qualunque derivazione non è mai “solo il blocco” — allerta.',
  ],
  suspectConfirm: [
    'Un BBS di nuova insorgenza merita un ecocardiogramma e una valutazione ischemica — di solito segnala una cardiopatia strutturale reale.',
  ],
  guidelineMoves: [
    'Dolore toracico + BBS → applica i criteri di Sgarbossa/Smith modificati, non la rassegnazione.',
  ],
  rnMoves: [
    'BBS nuovo + dolore toracico = allerta subito — i criteri esistono (Sgarbossa); non scrivere mai “non interpretabile per BBS”.',
    'Un ST che punta NELLA STESSA direzione del QRS, in qualunque derivazione, non è mai il blocco — segnalalo immediatamente.',
    'Aspettati: ecocardiogramma e percorso ischemico — un BBS nuovo di solito segnala una cardiopatia strutturale reale.',
  ],
}
