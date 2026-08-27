import { CardI18n } from '../types'

export const afib: CardI18n = {
  name: 'Fibrillazione atriale',
  tagline: 'Nessun intervallo RR uguale all’altro, e nessuno guida gli atri.',
  aliases: ['FA', 'fibrillazione', 'irregolare', 'aritmia'],
  commitPrompt: 'La tua lettura?',
  options: [
    'Fibrillazione atriale',
    'Ritmo sinusale con BAC',
    'Flutter atriale a conduzione variabile',
    'Tachicardia atriale multifocale',
  ],
  tempts: [
    'Sì — irregolarmente irregolare, nessuna P organizzata, linea di base fibrillante.',
    'I battiti atriali prematuri frequenti sembrano caos, ma tra l’uno e l’altro la marcia di fondo sopravvive.',
    'La base del flutter è un righello a denti di sega; quella della FA è pulviscolo disordinato.',
    'La TAM ha vere onde P — almeno 3 morfologie. La FA non ne ha nessuna.',
  ],
  why: [
    'Gli atri non si contraggono più insieme — centinaia di piccoli fronti tremolano al posto di un’unica onda.',
    'Nessun vettore atriale organizzato → nessuna onda P, solo fibrillazione della linea di base.',
    'Il nodo AV lascia passare i fronti a caso → onde R irregolarmente irregolari.',
  ],
  whyDrawer: [
    { cause: 'Micro-rientri (spesso dalle vene polmonari) frammentano l’attivazione atriale', effect: 'Gli atri fremono a 400–600/min invece di contrarsi' },
    { cause: 'Centinaia di fronti minuscoli si annullano elettricamente a vicenda', effect: 'Nessuna P — una linea fibrillante, visibile soprattutto in V1' },
    { cause: 'Il nodo AV è bombardato e conduce in modo imprevedibile', effect: 'Risposta ventricolare irregolarmente irregolare' },
    { cause: 'Gli atri non si svuotano più per contrazione', effect: 'Stasi — il discorso sul rischio embolico che ogni FA merita' },
  ],
  pills: [
    'Irregolare + LARGO + molto veloce (>200, morfologia che cambia battito per battito) = FA pre-eccitata (WPW). Diltiazem, beta-bloccanti, digossina, adenosina — E amiodarone, il farmaco riflesso — la incanalano nella via accessoria → FV. Procainamide o cardioversione.',
    'Un ritmo *regolare*, lento e largo in una FA nota = il nodo AV ha ceduto (blocco completo con scappamento) — oppure tossicità digitalica: manda un livello, l’antidoto esiste (Fab anti-digossina). Una FA che si regolarizza non è mai banale.',
    'Marcia le onde R col compasso o col bordo di un foglio. Se nessun intervallo coincide e non ci sono P — è FA.',
    'Denti di sega organizzati a ~300/min = flutter. Se la frequenza è ferma a ~150, cercalo. Il software sovra-diagnostica la FA: verifica tu stesso l’irregolarità.',
  ],
  suspectConfirm: [
    'Prima di controllare la frequenza, verifica che il QRS sia STRETTO — una tachicardia irregolare e larga è FA pre-eccitata o TV polimorfa finché non è provato il contrario.',
    'FA di nuova insorgenza: elettroliti, TSH ed ecocardiogramma fanno parte del percorso.',
    'Stima il rischio embolico (CHA₂DS₂-VASc) prima di parlare di ritmo.',
  ],
  guidelineMoves: [
    'Instabile per il ritmo → cardioversione elettrica sincronizzata subito.',
    'Stabile e STRETTO → controllo della frequenza: beta-bloccante, oppure diltiazem solo se FE ≥40% — con FE ridotta o scompenso, i calcio-antagonisti non-diidropiridinici EV sono Classe 3 Danno (lì amiodarone o digossina).',
    'Cardioversione: almeno 3 settimane di anticoagulazione prima (o ETE) — e almeno 4 settimane DOPO, anche per FA di breve durata e CHA₂DS₂-VASc 0.',
  ],
  rnMoves: [
    'Riconosci: irregolarmente irregolare, nessuna P. Poi il controllo di sicurezza: il QRS è STRETTO? Irregolare + largo + molto veloce → chiama subito e metti in discussione qualunque bloccante nodale.',
    'Segnala ipotensione, dolore toracico, alterazione dello stato di coscienza o FC >150 sintomatica. Se è davvero instabile si cardioverte senza aspettare il digiuno — piastre, accesso venoso, annota l’ultima assunzione orale.',
    'Metti in discussione il diltiazem EV quando in cartella c’è FE ridotta o scompenso: la linea guida lo classifica come Classe 3 Danno.',
    'Aspettati controllo della frequenza e il discorso sull’anticoagulazione — e fissa l’ora di insorgenza (guida la cardioversione); una FA nuova aggiunge elettroliti, TSH ed eco.',
  ],
}
