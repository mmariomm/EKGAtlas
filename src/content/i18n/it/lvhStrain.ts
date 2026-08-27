import { CardI18n } from '../types'

export const lvhStrain: CardI18n = {
  name: 'Ipertrofia ventricolare sinistra con strain',
  tagline: 'Voltaggi enormi, ST-T drammatici — il quadro che manda coronarie pulite in emodinamica.',
  aliases: ['IVS', 'ipertrofia', 'strain', 'voltaggi', 'mimo', 'Sokolow'],
  commitPrompt: 'La tua lettura?',
  options: ['Ipertrofia ventricolare sinistra con alterazioni secondarie della ripolarizzazione', 'Ischemia antero-laterale', 'Infarto da occlusione posteriore', 'Vecchio infarto'],
  tempts: [
    'Sì — voltaggi enormi con una ripolarizzazione proporzionata e asimmetrica. Cerca il vecchio ECG.',
    'L’inversione della T laterale è ASIMMETRICA (discesa lenta, risalita rapida) e sposata a voltaggi enormi — proporzionata, secondaria.',
    'S profonde in V1–V3 con sopraslivellamento sopra di esse è la discordanza dell’ipertrofia, non l’occlusione vista allo specchio.',
    'Nessuna onda Q; le onde R sono enormi, non perdute.',
  ],
  why: [
    'Più muscolo, più vettore: R laterali alte, S profonde nelle precordiali destre.',
    'La parete ispessita si ripolarizza dall’interno verso l’esterno — lo “strain” asimmetrico segue il voltaggio, opposto al QRS.',
    'È la stessa logica di discordanza del BBS: alterazione secondaria proporzionata, non lesione.',
  ],
  whyDrawer: [
    { cause: 'Un sovraccarico pressorio cronico ispessisce la parete ventricolare sinistra', effect: 'Un vettore di depolarizzazione più grande: R laterali alte, S profonde in V1–V3' },
    { cause: 'La parete ispessita si ripolarizza in modo anomalo, dall’interno verso l’esterno', effect: '“Strain”: ST discendente con inversione asimmetrica della T nelle derivazioni con le R più alte' },
    { cause: 'L’alterazione della ripolarizzazione è proporzionata al voltaggio che le sta sotto', effect: 'Sopraslivellamento sopra le S profonde in V1–V3 — discordanza attesa, non lesione' },
    { cause: 'Il quadro è cronico e stabile', effect: 'Un ECG precedente è l’alibi del mimo — trovane uno' },
  ],
  pills: [
    'Sokolow-Lyon: S(V1) + R(V5 o V6) ≥35 mm depone per ipertrofia (età >35 anni). I criteri di voltaggio sono discretamente specifici, mai sensibili.',
    'L’ipertrofia è tra le prime cause di attivazioni improprie dell’emodinamica: il sopraslivellamento in V1–V3 sopra S profonde è discordanza attesa. Giudica il tratto ST rispetto al QRS che gli sta sotto.',
    'L’inversione da strain: asimmetrica, con partenza discendente, nelle derivazioni con le R più alte. Inversioni simmetriche in derivazioni a voltaggio modesto → pensa piuttosto all’ischemia.',
    'La mancata diagnosi più letale corre nella direzione opposta: l’ipertrofia non immunizza dall’infarto da occlusione. Sopraslivellamento concordante, sopraslivellamento del tutto sproporzionato rispetto all’S sottostante, o ST-T nuovi rispetto a un vecchio tracciato con strain = occlusione finché non è provato il contrario.',
  ],
  suspectConfirm: [
    'ST-T drammatici e nuovi in un paziente iperteso: cerca un ECG precedente — la stabilità è l’alibi del mimo.',
    'L’ecocardiogramma chiarisce l’ipertrofia; la storia clinica e i tracciati seriati chiariscono l’ischemia.',
  ],
  guidelineMoves: [
    'Nessuna terapia acuta guidata dall’ECG — la domanda sulla sindrome coronarica si risolve con i tracciati precedenti e quelli seriati, poi si gestiscono la pressione e il sintomo reale.',
  ],
  rnMoves: [
    'Voltaggi enormi con ST-T discendenti proporzionati di solito è cronico — vai a cercare un ECG precedente prima che la stanza si allarmi; la stabilità è l’alibi.',
    'Ma l’ipertrofia non immunizza: alterazioni ST-T NUOVE, o un ST che punta insieme al QRS, sopra un’ipertrofia — trattalo come ischemia e allerta.',
  ],
}
