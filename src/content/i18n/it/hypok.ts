import { CardI18n } from '../types'

export const hypok: CardI18n = {
  name: 'Ipopotassiemia',
  tagline: 'La T si sgonfia e dietro di lei si alza una seconda onda — di solito le ha scritte entrambe la terapia in corso.',
  aliases: ['potassio basso', 'ipoK', 'onda U', 'diuretici', 'vomito', 'QU'],
  commitPrompt: 'La tua lettura?',
  options: ['Ipopotassiemia', 'QT lungo', 'Sottoslivellamento ischemico', 'Variante normale'],
  tempts: [
    'Sì — T appiattita con un’onda U che si alza dietro, ST che scivola, e un intervallo dalla Q alla fine dell’onda allungato. Controlla K⁺ e Mg²⁺.',
    'Cugino stretto — una T-U fusa si legge come “QT lungo” e porta lo stesso rischio di torsione di punta. In ogni caso: misura e correggi.',
    'Lo scivolamento inganna — ma il sottoslivellamento ischemico è territoriale e con reciproche; questo è diffuso, dolce, e viaggia con un’onda U.',
    'Piccole onde U possono essere normali alle basse frequenze — ma una U che si avvicina alla propria T, con T piatta e ST che scivola, è chimica.',
  ],
  why: [
    'Il K⁺ basso rende più ripido il gradiente di riposo — la ripolarizzazione rallenta e si frammenta.',
    'La T si appiattisce; la ripolarizzazione tardiva riemerge come gobba autonoma: l’onda U.',
    'La finestra vulnerabile si allarga — l’ipopotassiemia è carburante per la torsione di punta, e moltiplica la digitale.',
  ],
  whyDrawer: [
    { cause: 'Il K⁺ sierico scende (diuretici, perdite gastrointestinali, shift da insulina o rialimentazione)', effect: 'Il paradosso: meno K⁺ fuori significa MINORE conduttanza dell’IKr — la corrente ripolarizzante si indebolisce mentre il gradiente si fa più ripido' },
    { cause: 'La ripolarizzazione di fase 3 rallenta e si desincronizza', effect: 'L’onda T si appiattisce e il tratto ST scivola' },
    { cause: 'La ripolarizzazione tardiva (di Purkinje o mesomiocardica — l’origine è ancora discussa) si separa', effect: 'Un’onda U dopo la T — evidente in V2–V3, che cresce man mano che il K⁺ scende' },
    { cause: 'La riserva di ripolarizzazione collassa (peggio con Mg²⁺ basso, farmaci che allungano il QT, digitale)', effect: 'Un intervallo QU lungo e una porta spalancata sulla torsione di punta' },
  ],
  pills: [
    'La sequenza mentre il K⁺ scende: la T si appiattisce → l’ST scivola → la U cresce (meglio visibile in V2–V3) → T e U si fondono in un unico lungo “QT” — ciò che le macchine chiamano QT lungo è spesso un QU. Riferimenti indicativi: le alterazioni compaiono attorno a K⁺ 3,0; U più alta della T ≈ <3,0; <2,5 è grave — e l’ipopotassiemia grave causa TV/FV, non solo torsione di punta.',
    'Ipopotassiemia + digitale è una moltiplicazione, non una somma — la tossicità digitalica arriva a livelli “terapeutici”. E correggere il K⁺ senza Mg²⁺ spesso fallisce: magnesio prima, o insieme.',
    'Vomito, diuretici, chetoacidosi in trattamento insulinico — controlla il K⁺ prima che sia l’ECG a sorprenderti; il potassio del paziente scende mentre tu stai scrivendo.',
    'Una T-U fusa si traveste da QT lungo iatrogeno — ed entrambe le strade finiscono nella torsione di punta.',
  ],
  suspectConfirm: [
    'T piatta + onda U + ST che scivola → controlla K⁺ E Mg²⁺ (scendono insieme, ed è il Mg²⁺ a governare la correzione).',
    'Rivedi la stessa lista di farmaci del QT lungo — diuretici più farmaci che allungano il QT più K⁺ basso è la ricetta della torsione di punta.',
  ],
  guidelineMoves: [
    'Correggi K⁺ e Mg²⁺ insieme, verso il limite alto della norma quando il QT è lungo o l’ectopia sta montando: K⁺ EV periferico ≤10 mmol/h (≤20 in via centrale, con monitoraggio) — controlla prima la funzione renale.',
    'Torsione di punta su substrato ipopotassiemico → prima magnesio EV, poi correzione aggressiva del K⁺.',
  ],
  rnMoves: [
    'T piatte con una seconda gobba dietro, al monitor: manda K⁺ e Mg²⁺ insieme — e porta la lista dei farmaci (diuretici, insulina, farmaci che allungano il QT) alla chiamata.',
    'Correzione del K⁺ EV: MAI in bolo — solo in infusione, conosci il limite di velocità della tua via, monitor acceso. Aspettati il Mg²⁺ insieme; metti in discussione una prescrizione di solo potassio quando il magnesio è basso.',
    'Sorveglia al monitor le sequenze pausa-poi-salva di battiti polimorfi — l’ipopotassiemia è carburante per la torsione di punta: segnala presto l’ectopia.',
  ],
  avoid: 'Il potassio endovena non si somministra MAI in bolo. E vai cauto nell’ipopotassiemia da ridistribuzione (paralisi periodica, shift da insulina o rialimentazione) — il potassio corporeo totale è normale e una correzione aggressiva rimbalza in iperpotassiemia.',
}
