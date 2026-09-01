import { CardI18n } from '../types'

export const svtAvnrt: CardI18n = {
  name: 'TPSV (AVNRT)',
  tagline: 'Un circuito grande come un’unghia comanda tutto il cuore — finché non spezzi l’anello.',
  aliases: ['TPSV', 'AVNRT', 'tachicardia parossistica', 'cardiopalmo', 'adenosina', 'rientro'],
  commitPrompt: 'La tua lettura?',
  options: ['TPSV (AVNRT)', 'Tachicardia sinusale', 'Flutter atriale 2:1', 'Tachicardia ventricolare'],
  tempts: [
    'Sì — stretta, rigidamente regolare (~155 qui) e senza onde P davanti a nulla: gli atri vengono catturati all’indietro.',
    'La sinusale sale e scende con una causa e conserva le sue P. Questa è partita come un interruttore e di P non ne mostra.',
    'Ferma vicino a 150 — cerca sempre i denti di sega in II/III/aVF. Qui non ce ne sono, e la frequenza non è inchiodata a 150.',
    'La TV è LARGA. Stretta a questa frequenza significa che nasce sopra le branche: le autostrade sono intatte.',
  ],
  why: [
    'Due vie dentro il nodo AV formano un anello — un battito lo chiude e il circuito si autosostiene.',
    'Ogni giro attiva i ventricoli in avanti E gli atri all’indietro, quasi nello stesso istante.',
    'Quindi: QRS stretto, regolarità da metronomo, nessuna P davanti — di norma 140–250/min (per lo più 150–220), on/off come un interruttore.',
  ],
  whyDrawer: [
    { cause: 'Il nodo AV possiede una via lenta e una via rapida (doppia fisiologia nodale)', effect: 'Un battito prematuro può scendere per una e risalire per l’altra — l’anello si chiude' },
    { cause: 'Il circuito rientra su sé stesso ogni ~300–400 ms', effect: 'Una tachicardia rigidamente regolare — variabilità RR quasi nulla' },
    { cause: 'Ogni giro esce in entrambe le direzioni: giù per il His, su verso gli atri', effect: 'QRS stretto con cattura atriale retrograda — la P si nasconde dentro o subito dopo il QRS' },
    { cause: 'L’anello vive interamente dentro il nodo', effect: 'Tutto ciò che blocca il nodo (tono vagale, adenosina) può spezzarlo — diagnostico E terapeutico' },
  ],
  pills: [
    'I segni: inizio e fine bruschi, regolarità rigida, nessuna P visibile (o una minuscola pseudo-r′ in V1 / pseudo-S nelle inferiori — la P retrograda che sbuca).',
    'Tre situazioni: regolare + stretta = trattabile con i bloccanti nodali (piastre pronte). Regolare + LARGA = TV finché non è provato il contrario, non è un ritmo da bloccanti nodali. Irregolare + larga = FA pre-eccitata: nulla che blocchi il nodo.',
    'Tieni una striscia in registrazione CONTINUA DURANTE l’adenosina — qualunque fosse la tachicardia, è lo smascheramento (onde F, ritorno della P sinusale) la diagnosi che ti resta in mano.',
    'Una frequenza fissa a ~150 che non si muove è flutter 2:1 finché non dimostri il contrario.',
  ],
  suspectConfirm: [
    'Regolare, stretta, senza P riconoscibili, a insorgenza brusca → AVNRT/AVRT; se il paziente tollera l’attesa, registra un ECG a 12 derivazioni PRIMA di interromperla.',
    'Dopo la conversione: ripeti il 12 derivazioni in ritmo sinusale — cerca un’onda delta (la pre-eccitazione cambia tutte le regole future).',
  ],
  guidelineMoves: [
    'Stabile → prima la manovra di Valsalva modificata (43% contro 17% di conversione: funziona davvero), poi adenosina 6 mg in bolo rapido con lavaggio, quindi 12 mg. Parti da 3 mg in caso di cuore trapiantato, terapia con dipiridamolo o carbamazepina, o accesso venoso centrale; evitala nell’asma grave.',
    'Instabile per il ritmo → cardioversione elettrica sincronizzata.',
    'L’adenosina fallisce o la TPSV recidiva → diltiazem/verapamil EV o un beta-bloccante (solo se regolare e stretta).',
    'Episodi ricorrenti → invio all’elettrofisiologo: l’ablazione della via lenta è curativa nella maggior parte dei casi.',
  ],
  rnMoves: [
    'Guida la Valsalva modificata: paziente seduto, ponzamento deciso per 15 s (il trucco della siringa da 10 ml), poi supino con le gambe sollevate per 15 s — eseguita bene converte una quota reale prima di qualunque farmaco.',
    'Preparazione dell’adenosina: la vena buona più PROSSIMALE (piega del gomito o superiore), bolo rapido seguito da 20 ml di lavaggio, braccio sollevato, striscia in registrazione CONTINUA, defibrillatore a portata — e prima chiedi di asma e dipiridamolo. Avvisa il paziente della pausa terribile: passa in pochi secondi.',
    'Il controllo di sicurezza prima di qualunque bloccante nodale: è regolare e STRETTA? Irregolare o larga → fermati e allerta.',
  ],
}
