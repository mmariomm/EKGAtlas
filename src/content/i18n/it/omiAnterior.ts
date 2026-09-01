import { CardI18n } from '../types'

export const omiAnterior: CardI18n = {
  name: 'Infarto da occlusione anteriore',
  tagline: 'La discendente anteriore si sta chiudendo adesso — il primo segno è un’onda T cresciuta più del suo QRS.',
  aliases: ['STEMI', 'anteriore', 'IVA', 'sopraslivellamento', 'occlusione', 'iperacuta'],
  commitPrompt: 'La tua lettura?',
  options: [
    'Infarto da occlusione anteriore',
    'Ripolarizzazione precoce benigna',
    'Pericardite',
    'Ipertrofia ventricolare sinistra con strain',
  ],
  tempts: [
    'Sì — sopraslivellamento territoriale in V2–V3 con alterazioni reciproche. Questo è un discorso di riperfusione.',
    'Il sopraslivellamento della ripolarizzazione precoce è concavo, con punto J intaccato e NESSUN sottoslivellamento reciproco — e non evolve.',
    'Sopraslivellamento diffuso + sottoslivellamento del PR, nessuna reciprocità tranne aVR. Un sopraslivellamento territoriale con reciproche è occlusione.',
    'Il sopraslivellamento V1–V3 sopra onde S profonde può essere alterazione secondaria proporzionata — controlla prima i voltaggi.',
  ],
  why: [
    'IVA occlusa → la parete anteriore mantiene una corrente di lesione tra un battito e l’altro.',
    'Quel vettore costante punta verso V2–V4: sopraslivellamento dove è affacciato, sottoslivellamento reciproco dal lato opposto.',
    'Prima del sopraslivellamento le T ischemiche diventano alte e grasse — la fase iperacuta è la presa più precoce.',
  ],
  whyDrawer: [
    { cause: 'L’IVA si occlude; la parete anteriore va incontro a lesione transmurale', effect: 'Il muscolo leso non riesce a ripolarizzarsi del tutto — mantiene una corrente stabile' },
    { cause: 'La corrente di lesione punta verso le derivazioni precordiali sovrastanti durante il tratto ST', effect: 'Sopraslivellamento in V2–V4, le derivazioni affacciate' },
    { cause: 'Le derivazioni sulla parete opposta vedono il vettore allontanarsi', effect: 'Sottoslivellamento reciproco — i mimi raramente lo producono' },
    { cause: 'I primissimi minuti deformano la ripolarizzazione prima che l’ST si muova', effect: 'Onde T iperacute: ampie, voluminose, sproporzionate rispetto al loro QRS' },
  ],
  pills: [
    'T iperacuta = ampia, voluminosa, con area sproporzionata rispetto al QRS — batte i criteri. I criteri stessi (una soglia, non un verdetto): sopraslivellamento V2–V3 ≥2,5 mm uomo <40 anni, ≥2 mm uomo ≥40, ≥1,5 mm donna; ≥1 mm in due derivazioni contigue qualsiasi.',
    'I *criteri* STEMI mancano una quota importante di occlusioni vere. Criteri negativi ma storia positiva + ECG che evolve = ECG seriati ogni 10–15 min e telefonata all’emodinamica, non dimissione.',
    'Il sottoslivellamento reciproco (qui: inferiore) è il siero della verità — i mimi raramente lo producono.',
    'Un *sottoslivellamento* precordiale che risale dentro T giganti è la stessa arteria, occlusa adesso.',
  ],
  suspectConfirm: [
    'Sintomi in atto + sopraslivellamento territoriale (o un equivalente convincente) → questo è un discorso di riperfusione, non un’attesa della troponina.',
    'ECG seriati; confronta con i precedenti; la troponina conferma ma non deve ritardare nulla.',
  ],
  guidelineMoves: [
    'Attiva la riperfusione: PCI primaria — dal primo contatto medico al device ≤90 min (≤120 se si trasferisce); fibrinolisi se la PCI non rientra nei 120.',
    'Aspirina 162–325 mg MASTICATA (non gastroprotetta) subito; anticoagulazione e P2Y₁₂ secondo il percorso locale dell’emodinamica.',
  ],
  rnMoves: [
    'T iperacute o sopraslivellamento anteriore con una storia compatibile = contano i minuti: ECG seriati ogni 10–15 min — falli mettere come prescrizione permanente, così nessuno chiama per ogni tracciato; la troponina conferma ma non deve ritardare.',
    'Allerta secondo il percorso dolore toracico: monitor, due accessi venosi, piastre vicine, digiuno — tieni la stanza in movimento verso la riperfusione.',
    'Sorveglia: il sottoslivellamento inferiore reciproco chiude il discorso; la FV è il ritmo di arrivo dell’infarto anteriore — non staccare il monitor.',
  ],
  avoid: 'Non aspettare i millimetri quando le T iperacute e la storia stanno già parlando — criteri negativi non significa occlusione assente, e l’attesa è necrosi.',
  moduleLabel: 'Guarda come evolve: T iperacuta → sopraslivellamento → onde Q, su una sola arteria',
}
