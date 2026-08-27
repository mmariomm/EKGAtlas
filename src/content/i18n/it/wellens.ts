import { CardI18n } from '../types'

export const wellens: CardI18n = {
  name: 'Sindrome di Wellens',
  tagline: 'Il dolore è passato, l’ECG sembra tranquillo — e dietro entrambi c’è una IVA critica.',
  aliases: ['Wellens', 'T bifasiche', 'IVA critica', 'riperfusione spontanea'],
  commitPrompt: 'La tua lettura?',
  options: ['Pattern di Wellens — IVA critica', 'Alterazioni aspecifiche della T', 'Vecchio infarto anteriore', 'T giovanile persistente'],
  tempts: [
    'Sì — inversioni della T anteriori con onde R conservate, in un paziente con dolore recente. Nessuna prova da sforzo.',
    'Inversioni profonde e SIMMETRICHE in V2–V3 in un paziente con dolore toracico recente non sono mai “aspecifiche”.',
    'I vecchi infarti perdono le R e portano onde Q — Wellens conserva le R. È esattamente questo il punto.',
    'Esiste un sosia giovanile (V1–V3, asimmetrico, asintomatico) — è la storia clinica a distinguerli.',
  ],
  why: [
    'Una lesione critica dell’IVA si è occlusa e poi riaperta spontaneamente — il dolore è cessato.',
    'La depolarizzazione si è ripresa (onde R intatte); la ripolarizzazione no.',
    'La parete anteriore stordita scrive T profonde e simmetriche (o bifasiche) in V2–V3 — mentre il paziente sta bene.',
  ],
  whyDrawer: [
    { cause: 'Una lesione critica dell’IVA prossimale si occlude transitoriamente', effect: 'Ischemia della parete anteriore — di solito l’episodio di dolore toracico' },
    { cause: 'La lesione si riperfonde spontaneamente e il dolore si risolve', effect: 'La depolarizzazione recupera (R conservate), la ripolarizzazione resta alterata' },
    { cause: 'Ritardo post-ischemico della ripolarizzazione nella parete riperfusa', effect: 'Onde T profonde e simmetriche (tipo B) o bifasiche (tipo A) in V2–V3 — registrate a paziente libero da dolore' },
    { cause: 'La lesione si ri-occlude', effect: 'Le T “pseudo-normalizzano” (tornano positive) mentre il dolore ricompare — è un peggioramento, un’emergenza' },
  ],
  pills: [
    'L’ECG tranquillo invita a una prova da sforzo — che può chiudere l’arteria. Wellens = NIENTE test da sforzo; coronarografia.',
    'Tipo A = bifasica (prima su, poi giù); tipo B = inversione profonda e simmetrica. Il tipo A spesso evolve nel tipo B.',
    'T invertite che tornano POSITIVE durante un nuovo episodio di dolore = pseudo-normalizzazione = l’arteria si sta richiudendo. È un peggioramento.',
  ],
  suspectConfirm: [
    'Angina recente + quadro della T in V2–V3 + R conservate + troponina normale o solo lievemente mossa = Wellens; una troponina francamente positiva non annulla la diagnosi. Ricovera e studia l’IVA.',
  ],
  guidelineMoves: [
    'Ricovero, terapia antitrombotica secondo il percorso per le sindromi coronariche acute, coronarografia precoce — nessuna prova da sforzo.',
  ],
  rnMoves: [
    'Dolore passato + T profonde o bifasiche in V2–V3 = un colpo di avvertimento, non una rassicurazione: questo paziente si ricovera, non si dimette — e non va mai al tapis roulant. Fatti sentire.',
    'Sorveglia: quelle T che tornano POSITIVE durante un nuovo dolore = l’arteria si sta richiudendo — nuovo ECG e allerta subito.',
  ],
  avoid: 'Nessun test da sforzo di alcun tipo — provocare la domanda può chiudere proprio quell’IVA critica di cui il quadro sta avvertendo. Coronarografia, invece.',
  moduleLabel: 'Guarda l’arco della riperfusione: bifasica → inversione profonda → pseudo-normalizzazione',
}
