import { CardI18n } from '../types'

export const avb2: CardI18n = {
  name: 'Blocco AV di secondo grado (Mobitz I e II)',
  tagline: 'Uno salta i battiti avvisando; l’altro li lascia cadere di colpo — e chiede un pacemaker.',
  aliases: ['BAV', 'Mobitz', 'Wenckebach', 'secondo grado', 'blocco atrioventricolare'],
  commitPrompt: 'La tua lettura?',
  options: ['Mobitz II', 'Mobitz I (Wenckebach)', 'Battiti atriali prematuri bloccati', 'Blocco AV completo'],
  tempts: [
    'Sì — PR fisso, poi una P che semplicemente non conduce. Malattia sotto-nodale: piastre pronte.',
    'Il Wenckebach allunga il PR prima di lasciar cadere il battito. Qui il PR non cambia mai — poi una P salta.',
    'Un battito atriale prematuro non condotto arriva *in anticipo* e con una P di forma diversa; queste P bloccate arrivano puntuali.',
    'Qui la maggior parte delle P conduce con PR fisso — nel blocco completo non ne conduce nessuna.',
  ],
  why: [
    'Mobitz I: il nodo AV si affatica — il PR si allunga battito dopo battito finché una P cade, poi il ciclo riparte.',
    'Mobitz II: il sistema His-Purkinje cede senza preavviso — PR fisso, poi una P improvvisamente orfana.',
    'La malattia sotto-nodale è terreno instabile: può precipitare in blocco completo in qualunque momento.',
  ],
  whyDrawer: [
    { cause: 'Mobitz I: la conduzione decrementale del NODO AV si stanca a ogni passaggio', effect: 'PR 160 → 220 → 280 → battito perso, poi il ciclo riparte (battiti raggruppati)' },
    { cause: 'Mobitz II: un cedimento tutto-o-nulla del sistema His-Purkinje', effect: 'PR fisso sui battiti condotti — poi una P scompare senza preavviso' },
    { cause: 'La malattia nodale è di solito vagale o iatrogena, e perdona', effect: 'Il Wenckebach spesso richiede osservazione, non hardware' },
    { cause: 'La malattia sotto-nodale non ha alcun margine di sicurezza', effect: 'Il Mobitz II può precipitare in blocco completo con uno scappamento lento e inaffidabile — è il discorso del pacemaker' },
  ],
  pills: [
    'Battiti raggruppati + PR che si allunga + RR che si accorcia = Wenckebach. Di solito nodale, spesso benigno, spesso di sapore vagale o farmacologico.',
    'Un blocco 2:1 non si può etichettare come I o II da una sola striscia — in entrambi cade una P su due. Giudicalo dal contorno: QRS largo e PR invariabile orientano verso il Mobitz II. Registra una striscia lunga.',
    'Un Mobitz II al monitor nella notte è un reperto da chiamare adesso, non da segnalare al mattino.',
  ],
  suspectConfirm: [
    'Rivedi i farmaci che bloccano il nodo AV, il K⁺, l’ischemia; registra una striscia lunga e recupera gli ECG precedenti.',
  ],
  guidelineMoves: [
    'Mobitz II (o qualunque blocco sintomatico) → piastre pronte, percorso di stimolazione, cardiologo subito. L’atropina 1 mg agisce sul blocco NODALE — nel sotto-nodale può accelerare le P e peggiorare il rapporto di conduzione; non lasciare mai che dosi ripetute ritardino il pacemaker.',
    'Wenckebach asintomatico → di norma osservazione e ricerca della causa, non hardware.',
  ],
  rnMoves: [
    'PR che si allunga con battiti raggruppati (Wenckebach) di solito è benigno; PR fisso con cadute improvvise (Mobitz II) non lo è — tratta ogni 2:1 come il tipo pericoloso finché non è provato il contrario.',
    'Mobitz II al monitor = chiama adesso e prepara le piastre — può precipitare in blocco completo senza preavviso.',
    'Aspettati: una striscia lunga, sospensione dei farmaci che bloccano il nodo AV, atropina pronta (aspettati poco, qui il blocco è sotto il nodo), il percorso di stimolazione.',
  ],
  avoid: 'Non accumulare dosi di atropina mentre le piastre aspettano — nel blocco sotto-nodale può peggiorare il rapporto di conduzione. Il piano è la stimolazione.',
}
