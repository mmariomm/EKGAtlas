import { CardI18n } from '../types'

export const aflutter: CardI18n = {
  name: 'Flutter atriale',
  tagline: 'Una tachicardia regolare esattamente a 150 è flutter finché non dimostri il contrario.',
  aliases: ['flutter', 'denti di sega', 'FLA', 'istmo'],
  commitPrompt: 'La tua lettura?',
  options: ['Flutter atriale', 'Tachicardia sinusale', 'TPSV (AVNRT)', 'Fibrillazione atriale'],
  tempts: [
    'Sì — il righello a denti di sega scorre sotto ogni cosa. Conta le onde F.',
    'A 150 una onda F su due si nasconde dentro la T. La tachicardia sinusale raramente si ferma fissa a 150.',
    'L’AVNRT di solito è più veloce (170–220) e davvero senza P; i denti di sega del flutter fanno capolino in II/III/aVF.',
    'La linea di base della FA è pulviscolo statico — il flutter tiene acceso il righello a denti di sega, anche quando il blocco varia.',
  ],
  why: [
    'Un unico circuito di rientro percorre l’atrio destro ~300 volte al minuto — denti di sega, non onde P.',
    'Il nodo AV non può far passare 300/min: le dimezza, e la frequenza ventricolare resta ~150.',
    'Cambia il blocco (2:1 → 3:1 → 4:1) e la frequenza ventricolare scende a gradini, non in modo continuo.',
  ],
  whyDrawer: [
    { cause: 'Un circuito di macro-rientro (di solito attorno all’anulus tricuspidale) si autosostiene', effect: 'Gli atri si attivano a ~300/min, con precisione metronomica' },
    { cause: 'Ogni giro percorre gli atri sempre nello stesso modo', effect: 'Onde F identiche — i denti di sega, più evidenti in II, III, aVF e V1' },
    { cause: 'Il nodo AV blocca un impulso su due (o su tre, o su quattro)', effect: 'Frequenze ventricolari che saltano tra ~150, ~100 e ~75' },
    { cause: 'Il circuito è anatomicamente fisso', effect: 'L’ablazione dell’istmo cavo-tricuspidale lo guarisce — il motivo dell’invio all’elettrofisiologo' },
  ],
  pills: [
    'La “TPSV a 150” trattata con bloccanti nodali e smascherata come flutter: il classico. A 150 vai attivamente a caccia dei denti di sega in II, III, aVF e V1.',
    'Manovre vagali e adenosina raramente convertono il flutter — ma il blocco transitorio *smaschera* i denti di sega. Consideralo un gesto diagnostico, non terapeutico.',
    'Gira il tracciato sottosopra: nelle derivazioni inferiori i denti di sega spesso saltano all’occhio.',
    'Nessuna attività atriale davvero visibile e frequenza oltre 180 → pensa all’AVNRT.',
  ],
  suspectConfirm: [
    'Stessi accertamenti della FA: elettroliti, TSH, ecocardiogramma; identica aritmetica del rischio embolico.',
  ],
  guidelineMoves: [
    'Instabile → cardioversione elettrica sincronizzata (il flutter converte spesso con energie basse).',
    'Stabile → il controllo della frequenza è più difficile che nella FA; le regole dell’anticoagulazione sono le stesse.',
    'Flutter tipico recidivante → invio per ablazione (percentuale di guarigione elevata).',
  ],
  rnMoves: [
    'Una frequenza regolare ferma a ~150 è flutter finché non è provato il contrario — tira fuori II, III, aVF e cerca i denti di sega prima di scrivere “tachicardia sinusale”.',
    'Instabile → allerta; piastre pronte subito — il flutter converte con energie basse.',
    'Aspettati: controllo della frequenza più difficile che nella FA; stesse regole sul rischio embolico — tieni pronte l’ora di insorgenza e gli episodi precedenti per l’équipe.',
  ],
}
