import { CardI18n } from '../types'

export const omiInferior: CardI18n = {
  name: 'Infarto da occlusione inferiore',
  tagline: 'Tre piccole derivazioni, un’arteria che si chiude — e un ventricolo destro che punisce la nitroglicerina.',
  aliases: ['inferiore', 'STEMI', 'coronaria destra', 'infarto del ventricolo destro', 'V4R'],
  commitPrompt: 'La tua lettura?',
  options: ['Infarto da occlusione inferiore', 'Pericardite', 'Ripolarizzazione precoce benigna', 'Variante normale'],
  tempts: [
    'Sì — lesione inferiore con aVL che si abbassa in modo reciproco. Ora poniti la domanda sul ventricolo destro.',
    'Sopraslivellamento diffuso e concavo senza sottoslivellamento reciproco in aVL. L’infarto inferiore quasi sempre deprime aVL.',
    'Nemmeno la ripolarizzazione precoce produce il sottoslivellamento reciproco in aVL — è quel reperto a fare da spartiacque.',
    'Un sopraslivellamento inferiore sfumato è facile da liquidare — aVL è il tuo giudice di gara. Guarda lì per primo.',
  ],
  why: [
    'Si chiude (di solito) la coronaria destra → la parete inferiore mantiene la corrente di lesione.',
    'Il vettore punta verso i piedi: sopraslivellamento in II, III, aVF — e aVL, che guarda dalla parte opposta, si abbassa.',
    'Una coronaria destra prossimale affama anche il ventricolo destro: compare un ventricolo dipendente dal precarico.',
  ],
  whyDrawer: [
    { cause: 'La coronaria destra (o la circonflessa) occlude il circolo della parete inferiore', effect: 'Una corrente di lesione transmurale diretta in basso' },
    { cause: 'II, III e aVF sono affacciate sulla parete lesa', effect: 'Sopraslivellamento ST — spesso sfumato, un millimetro che conta' },
    { cause: 'aVL guarda la parete inferiore esattamente dal lato opposto', effect: 'Sottoslivellamento reciproco — l’indizio più precoce e più affidabile' },
    { cause: 'Una coronaria destra prossimale irrora anche la parete libera del ventricolo destro', effect: 'Infarto del ventricolo destro: ipotensione dipendente dal precarico, smascherata dai nitrati' },
  ],
  pills: [
    'Sopraslivellamento in III > II orienta verso la coronaria destra (rispetto alla circonflessa) — e apre la domanda sull’infarto del ventricolo destro. Rispondile con V4R.',
    'Infarto del ventricolo destro + nitroglicerina = crollo del precarico → ipotensione. Stesso crollo dopo gli inibitori della PDE5: sildenafil/vardenafil entro 24 h, tadalafil entro 48 h (il tadalafil giornaliero è sempre dentro la finestra). Chiedilo prima di qualunque nitrato, in ogni dolore toracico.',
    'Infarto inferiore recente + blocco AV nuovo è ischemia nodale — spesso responsiva all’atropina, di solito transitoria.',
    'Sopraslivellamento inferiore con sottoslivellamento in V1–V3 = è coinvolta anche la parete posteriore.',
  ],
  suspectConfirm: [
    'Registra V4R (ventricolo destro) e V7–V9 (posteriori) — trenta secondi che cambiano la gestione.',
  ],
  guidelineMoves: [
    'Riperfusione adesso — stesso orologio di qualunque infarto da occlusione.',
    'Ipotensione dopo i nitrati o sopraslivellamento in V4R → infarto del ventricolo destro: volume cauto e titolato (250–500 ml, poi rivaluta), evitando ogni ulteriore riduzione del precarico.',
  ],
  rnMoves: [
    'Sopraslivellamento inferiore: prima di QUALSIASI nitrato, due domande — è coinvolto il ventricolo destro (registra V4R)? Ha assunto un inibitore della PDE5 (sildenafil <24 h, tadalafil <48 h — quello giornaliero è sempre dentro)? Se una risposta è sì → sospendi e chiama.',
    'Registra V4R e V7–V9 — trenta secondi di elettrodi che cambiano la gestione; sorveglia bradicardia e blocchi AV (di solito transitori).',
    'Ipotensione dopo la nitroglicerina = il crollo del precarico: gambe sollevate, allerta, aspettati boli di liquidi cauti.',
  ],
  avoid: 'Nitrati con coinvolgimento del ventricolo destro, o dopo sildenafil/vardenafil <24 h o tadalafil <48 h → collasso circolatorio. Sospendili; tratta il precarico con volume cauto.',
}
