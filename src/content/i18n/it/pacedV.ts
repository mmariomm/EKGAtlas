import { CardI18n } from '../types'

export const pacedV: CardI18n = {
  name: 'Ritmo da pacemaker ventricolare',
  tagline: 'Il ritmo che il software sbaglia più spesso — impara che aspetto deve avere l’ombra del pacemaker.',
  aliases: ['pacemaker', 'PM', 'stimolato', 'spike', 'elettrocatetere'],
  commitPrompt: 'La tua lettura?',
  options: ['Ritmo da pacemaker ventricolare', 'Blocco di branca sinistra', 'Tachicardia ventricolare', 'Iperpotassiemia'],
  tempts: [
    'Sì — uno stimolo prima di ogni complesso largo, di aspetto simil-BBS. Il pacemaker sta facendo il suo lavoro.',
    'Il QRS stimolato imita il BBS (origine dal ventricolo destro) — ma prima cerca gli spike davanti al QRS.',
    'Largo, sì — ma con frequenza ~60–70 e uno spike prima di ogni battito è un pacemaker che funziona.',
    'Largo e strano, ma qui ogni complesso è preceduto da un artefatto da stimolo *identico* agli altri.',
  ],
  why: [
    'L’elettrocatetere stimola l’apice del ventricolo destro — la depolarizzazione striscia da muscolo a muscolo, da destra a sinistra.',
    'Perciò il QRS stimolato è largo e simil-BBS, con ST/T discordanti — per costruzione, non per malattia.',
    'Ogni battito stimolato deve seguire il suo spike; ogni spike deve catturare.',
  ],
  whyDrawer: [
    { cause: 'L’elettrocatetere è posizionato all’apice del ventricolo destro', effect: 'Ogni stimolo fa partire la depolarizzazione da un unico punto ventricolare' },
    { cause: 'La diffusione è da muscolo a muscolo, da destra a sinistra e verso l’alto', effect: 'Un QRS largo, simil-BBS, con asse superiore' },
    { cause: 'Una depolarizzazione anomala impone una ripolarizzazione anomala', effect: 'ST/T discordanti — attesi, non ischemia di per sé' },
    { cause: 'Il dispositivo segna ogni stimolo erogato', effect: 'Lo spike: un artefatto stretto immediatamente prima di ogni QRS catturato' },
  ],
  pills: [
    'I referti automatici sbagliano spesso i ritmi stimolati — il testo della macchina su un ECG da pacemaker è un’ipotesi, non un referto.',
    'L’ischemia NON diventa invisibile: i criteri di Sgarbossa modificati funzionano anche nei ritmi stimolati — un ST concordante resta colpevole.',
    'Spike senza QRS dopo = mancata cattura. Conta le coppie spike→QRS prima di ammirare la morfologia.',
  ],
  suspectConfirm: [
    'Dolore toracico in ritmo stimolato → applica i criteri di Sgarbossa modificati (validati nei ritmi da pacemaker); non scrivere “non interpretabile”.',
    'Sospetto malfunzionamento del dispositivo → risposta al magnete e interrogazione del pacemaker.',
  ],
  guidelineMoves: [
    'Mancata cattura sintomatica o bradicardia → stimolazione transcutanea come ponte mentre si interroga il dispositivo.',
  ],
  rnMoves: [
    'Marcia le coppie spike→QRS: uno spike senza nulla dopo = mancata cattura (in un paziente pacemaker-dipendente e bradicardico è un’emergenza in cui non si esce dalla stanza); spike che cadono dentro i battiti o vicino alle T = difetto di sensing (rischio R-su-T). Segnala entrambi — non archiviarli mai come artefatto.',
    'Un dolore toracico in ritmo stimolato non è mai “non interpretabile” — le alterazioni ST concordanti contano; insisti per una lettura vera (Sgarbossa modificati).',
    'Aspettati: piastre pronte e percorso di stimolazione se la cattura manca in un paziente bradicardico o sintomatico; magnete secondo protocollo — impone una stimolazione asincrona (risolve l’oversensing e l’inibizione), non risolve mai una mancata cattura.',
  ],
}
