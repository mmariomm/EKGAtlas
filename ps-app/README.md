# PS Assist — richieste Pronto Soccorso in un click (SA4PSO)

Ricostruito **da zero** (agosto 2026) dopo un re-audit completo delle pagine reali salvate di SA4PSO.
Sostituisce il vecchio script v0.6 ("un esame per ricaricamento di pagina") con un motore molto più
semplice e robusto: guida il server con le **stesse identiche richieste dei click manuali**, tutto da una
sola pagina, verificando ogni passaggio prima del successivo.

> **In sintesi per il medico**: dalla pagina del paziente scrivi il quesito, tocchi i profili
> e gli esami, premi un bottone. La richiesta viene creata, gli esami aggiunti e
> verificati uno a uno nel carrello, e atterri sulla pagina esami reale per premere **Conferma**
> (o lasci che la prema lui, subito: il tuo click su «Conferma e stampa» è la decisione). Dopo la conferma
> ogni foglio compare **in anteprima**, con la stampante su cui va, e si apre da solo il
> **dialogo di stampa** del browser: etichette (etichettatrice), poi lista esami (stampante
> normale) — con la **stampa automatica** niente anteprima né dialogo: escono da sole, e la
> striscia dice dove. Intanto il pannello resta una **striscia nell'angolo** che dice a che punto è; se
> qualcosa va storto diventa rossa e ti lascia sul carrello: lo finisci a mano, o **↻ Riprova i
> mancanti**, o **Svuota il carrello e ricomincia**. Con l'estensione gli esami li manda una
> **scheda di sottofondo** che si apre e si chiude da sola: tu cambi pagina quando vuoi, la
> striscia ti segue, e le etichette si stampano nella scheda dove sei. Con la **stampa
> automatica** (Windows, cartella `stampa/`, senza amministratore) niente dialogo: ogni foglio
> va da solo alla sua stampante — etichette all'etichettatrice, il resto all'A4 — anche se
> l'ordine parte dal telefono e davanti al PC non c'è nessuno.

---

## Installazione (Chrome / Edge, PC ospedale)

Il modo più semplice nel 2026 è l'**estensione dedicata** (niente Tampermonkey: da Chrome 138+ i
gestori di userscript richiedono anche il toggle "Consenti script utente" per estensione — un
passaggio in più che qui non serve).

1. Scarica il progetto da https://github.com/mmariomm/EKGAtlas (**Code → Download ZIP**, branch
   `main`), estrai: ti serve solo `ps-app/extension`.
2. Apri `chrome://extensions` (o `edge://extensions`).
3. Attiva **Modalità sviluppatore** (interruttore in alto a destra).
4. Premi **Carica estensione non pacchettizzata** e seleziona la cartella `ps-app/extension`.
5. Apri SA4PSO: il pannello blu appare in alto a destra sulle pagine di paziente, Nuova
   Richiesta ed esami, **intestato col nome del paziente** su cui stai lavorando (anche da
   minimizzato, così sai sempre per chi stai ordinando). Sulla **lista del pronto soccorso**,
   dove non c'è un paziente aperto, il pannello non mostra alcun esame: lì non si può ordinare.
   Si **trascina** dall'intestazione e si **ridimensiona** dall'angolo in basso a sinistra
   (posizione e misura restano memorizzate; doppio click sull'intestazione o sull'angolo per
   tornare a com'era).

**Perché "si aggiorna" a ogni pagina?** Il gestionale è un'app anni 2000: OGNI click ricarica
l'intera pagina — nessuna estensione può impedirlo. Il pannello però **si ricostruisce identico**:
quesito, esami selezionati, sezioni aperte e posizione tornano come li hai lasciati (per lo
stesso paziente, nella stessa scheda), quindi in pratica non te ne accorgi.

**Aggiornare a una nuova versione**: sostituisci i file nella STESSA cartella dell'estensione e
premi **Ricarica estensione** nel menu **⋯** del pannello (o ⟳ in `chrome://extensions`): non c'è
mentre un giro di esami sta mandando — anche in una scheda di sottofondo, o mentre le sue
etichette aspettano di essere stampate —, perché lo ucciderebbe a metà.
Un'estensione non pacchettizzata non può scaricarsi gli aggiornamenti da sola, e PS Assist non
contatterà mai server esterni per controllare le versioni — sarebbe contro la regola «nessun dato
lascia l'ospedale» (che ha una sola eccezione, voluta, accesa dal medico e cifrata da un capo
all'altro: il **Ponte** verso l'iPhone, più sotto). Le nuove versioni arrivano come zip: sostituisci, ricarica, fatto.

**Stampa automatica** (facoltativa, Windows, niente admin): etichette all'etichettatrice e il resto
all'A4, senza dialogo. Prima si avvisa l'IT, poi si installa una volta dalla cartella `stampa`
dello zip estratto — i passi in [`stampa/README.md`](stampa/README.md) — e si sceglie dal
pannello, menu **⋯ → Stampanti**.

**L'ID dell'estensione è fisso**: `jhhlgabilanhhnncahahclcjbefaofij`, in Chrome e in Edge, da
qualunque cartella (viene dalla `"key"` del manifest). Spostare la cartella non rompe niente.
**Una volta sola**, passando da una versione che non l'aveva (fino alla 3.52), l'ID cambia e la
memoria dell'estensione ricomincia da zero: vanno rifatte le stampanti, l'indirizzo del portale
(col suo permesso) e, se lo usi, il Ponte; l'archivio delle schede cliniche e i referti salvati
si ricostruiscono rileggendo i pazienti. Quello che sta nella pagina del gestionale (pazienti,
stanza, promemoria) resta. Se dopo ⟳ in `chrome://extensions` l'ID non è quello, rimuovi PS
Assist e caricala di nuovo («Carica estensione non pacchettizzata»).

### E se non posso? (PC bloccato dall'IT, niente admin)

- La **Modalità sviluppatore NON richiede i permessi di amministratore di Windows**: è
  un'impostazione del profilo browser, normalmente disponibile a qualunque utente. Se però
  l'interruttore è grigio o assente, è una **policy aziendale** del browser (si vede in
  `chrome://policy`, voci tipo `ExtensionSettings` / `ExtensionDeveloperModeSettings`) — e lì
  nessun trucco locale la scavalca.
- **Piano B che funziona sempre, zero installazione: il bookmarklet.**
  1. Apri il file `ps-app/bookmarklet/ps-assist.bookmarklet.txt` e copia **tutto** il contenuto
     (inizia con `javascript:`).
  2. Crea un preferito qualsiasi nella barra dei preferiti → tasto destro → **Modifica** →
     incolla il testo copiato nel campo **URL** → nominalo `PS Assist`.
  3. Su ogni pagina SA4PSO, **un click sul preferito** fa comparire il pannello. Unica
     differenza dall'estensione: dopo un cambio pagina (es. dopo la Conferma) va ricliccato —
     conferma, ripresa del giro e stampa ripartono al click, perché i passaggi di
     consegna vivono nella scheda. Per lo stesso motivo qui il browser continua ad avvisare
     prima di lasciare una pagina mentre il giro sta mandando: senza un click nessuno lo
     riprenderebbe.
- A regime, la strada pulita è chiedere all'IT di consentire l'estensione (cartella locale o
  allowlist aziendale).

---

## Uso quotidiano

**Due forme, un tocco per passare dall'una all'altra.** Aperto, il pannello è una **finestra al
centro che prende l'85% dello schermo, ma mai più larga di 1150 px** (su uno schermo grande sarebbe
una lenzuolata): intestazione e schede restano ferme, e non si spostano di lato cambiando schermata; scorre solo il
contenuto, che sta su una colonna comoda da leggere (valori e stanza usano tutta la larghezza).
La sposti dall'intestazione, la ridimensioni da **qualsiasi bordo o angolo**; **doppio clic**
sull'intestazione o sull'angolo la rimette al centro, nella misura di partenza. Una finestra che
hai spostato o ridimensionato, e **Affianca**, restano come le hai messe. **—** la riduce alla **pill**, che
resta dove la trascini; un tocco sulla pill riapre la finestra dove l'avevi lasciata. Per usare il
gestionale sotto, si riduce alla pill: la finestra lo copre quasi tutto, apposta.

**Si apre da solo solo quando serve.** Una pagina raggiunta cliccando nel gestionale mostra la
pill: lì stai lavorando tu. La finestra si apre da sola quando la pagina l'ha aperta il pannello
(un paziente scelto dall'elenco, Richieste…) o quando ha qualcosa da dirti (un avviso). Un
**giro di esami** no: dalla spedizione alle etichette parla la striscia nell'angolo, e la
finestra la apri tu con un tocco. **Esc** o un clic fuori la riducono; dopo **Copia** si riduce da sola e la pill dice
«✓ Copiato · incolla». Nel menu **⋯**: **Al centro** e **Affianca a destra** (una colonna, col
gestionale accanto), **iPhone** (il Ponte, solo con l'estensione), **Tempi** (il cronometro), **Riferimenti** (i *can't-miss killers*), poi — solo dove servono — **Esporta i fogli (JSON)** e
**Importa i fogli…** (in Dimissioni) e **Salva i referti** (negli Esiti, solo con l'estensione), il
Registro, **Stampanti** e — scelte le due stampanti — **Stampa automatica: attiva · Spegni** (vedi
«Stampa automatica»), **Ricarica estensione** e la versione. Il cronometro compare in intestazione **solo mentre corre**
(un tocco sul tempo apre la scheda, ⏹ lo ferma).

**Riferimenti** (menu ⋯) è la tabella del medico, i *can't-miss killers*, nel suo inglese: in cima
«Don't anchor the DDx…», poi tre tabelle — **per sintomo, cosa escludere per primo**; le
**etichette benigne che nascondono un killer**; **chi cambia la lista** (gravidanza,
immunodepresso, anticoagulato, anziano…). Il cursore è già nel filtro: si scrive in inglese o in
italiano («cefalea», «sincope», «anziano») e restano solo le righe che servono.

Il pannello ha cinque schermate, in **una fila di schede** sempre in cima e nell'ordine in cui si
lavora: **Richieste · Esiti · EO · Consensi · Dimissioni** (sulla lista del pronto soccorso, dove
non c'è un paziente: **Pazienti · EO · Consensi · Dimissioni**). Il paziente + episodio stanno nell'intestazione (anche da minimizzato). Sulla pagina «Storico dati clinici»
del portale clinico non c'è pannello: solo una striscia che dice cosa ha letto.

**Due identificativi, su ogni scheda.** L'intestazione dice `ROSSI MARIO · 68 M · ep. 700001 · OBI 1`
— nome, età e sesso (dal riquadro del paziente, se no dal codice fiscale), episodio, posto nella
stanza — anche in **Dimissioni**. Sotto, una riga sola, solo quando c'è qualcosa: le **Allergie**
del gestionale parola per parola, in rosso (`Allergie: nega` se è spuntato «Nega/Non
riferisce»; `Allergie: non lette` se la pagina non le ha lette — mai «nessuna») e il riquadro
**Attenzione**, com'è. Le azioni che escono dal pannello nominano il paziente: «**Conferma per
ROSSI M. · 68 M · 6 esami**», «✓ Copiato · ROSSI M.», e la stampa («Stampa 1 di 3 — Etichette ·
ROSSI M. · 68 M»).

### Pazienti (‹ in alto a sinistra)

Aprire un paziente **dal gestionale** porta ai suoi **Esiti**, perché è quasi sempre quello che si
va a fare; ordinare è un tocco più in là — **Richieste** è sempre in cima. Dal pannello, sceglierne
un altro **carica la sua pagina**: il pannello non mostra mai i dati di un paziente diverso da
quello che hai davanti. Il pannello parte da qui solo sulla lista del pronto soccorso, dove non c'è
un paziente aperto; sulla scheda di un paziente parte dagli **Esiti**.

**Una vista sola: sopra la lista, sotto la stanza.** Nella lista c'è chi non ha ancora un posto;
nella stanza, chi ce l'ha. Metti un paziente al suo posto e la sua riga se ne va: la lista si
accorcia e la stanza sale e si allarga. La lista prende quello che le serve, al massimo poco meno
di metà, poi scorre dentro; vuota, non c'è proprio, e la stanza arriva fin sotto le schede. Un
paziente nuovo arriva nella lista da solo, e nessuno sparisce: se il suo letto viene tolto, torna
lì. In fondo, chiusi, gli **Archiviati** e **Svuota l'elenco**.

**La lista** — **una riga per paziente**: la striscia del **triage**, il nome (un tocco sulla riga
apre gli Esiti), accanto il **promemoria** più vicino («15m tropo»), la nota in grigio, **visto 20
min fa** — in ambra dopo 3 ore —, oppure **questa pagina** per quello aperto, che è il primo; poi
**▾**, per metterlo nella stanza senza trascinarlo, e passandoci sopra la **sveglia** per un
promemoria e la **✕** per toglierlo dall'elenco. L'**episodio precedente** sta in fondo, in grigio,
e nella stanza non va. Il nome non si taglia mai per primo: nella colonna stretta promemoria e nota
scendono sotto il nome e «visto…» si toglie.

**Lo stato degli esami**, su ogni riga e su ogni letto: `Lab 3/6 ⏳50′ · ECG ✓ · RX ⏳1h20 ●` —
per tipo, tornati su chiesti, e se qualcosa aspetta da quanto aspetta il più vecchio: neutro, poi
**ambra**, poi **rosso** (laboratorio 60′/120′, ECG 15′/30′, imaging 90′/180′: le soglie stanno
in cima alla sezione «STATO ESAMI» di `src/core.js`). Il **●** dice che è arrivato qualcosa da
quando hai guardato i suoi Esiti — **rosso** se fra i valori nuovi non ancora segnati «Letto» ce
n'è uno fuori range. Un tipo mai chiesto non c'è; se non si sa niente non c'è niente (mai un
finto 0/0). Nel letto, corto: solo quello che aspetta («RX 1h20 ●»), o ✓. Letto più di mezz'ora
fa diventa grigio, e il passaggio del mouse dice «letto alle 11:02» ed esame per esame.
Da dove viene: dalla **pagina del paziente**, quando si apre (dal gestionale, dal pannello, da un
ordine in sottofondo) — ogni richiesta, anche **quelle fatte a mano**, è una riga del gestionale
con l'ora, gli esami e lo stato: un **REFERTO** o la finestra **Visualizza Risultati** = tornato
(anche se qualche valore è ancora parziale), niente = in attesa, annullata = fuori dal conto;
le consulenze non contano, l'ECG sì — e dagli **esami che PS Assist ha messo in carrello**, che
contano «in attesa, ordinati da qui» finché la pagina non elenca la loro richiesta (stesso
numero). Una richiesta ancora da confermare non è un ordine. Ordine e risultato si legano solo
per riga o per numero di richiesta, mai per nome e ora. Niente si legge da solo e niente si
chiede al server: si aggiorna quando la pagina del paziente si apre (↻ del gestionale compreso).
Il limite: un paziente che non apri da un po' ha lo stato di quando l'hai aperto — per questo il
grigio.

**La stanza** — una mappa minima, per vedere a colpo d'occhio **dove sta ogni paziente**: i
**letti** e le **sedie** (un paziente ciascuno) e le **aree** senza letto — corridoio, attesa —
dove ne stanno quanti servono. Chi ha un promemoria porta il tempo, piccolo, accanto al nome del
letto: un tocco apre i suoi promemoria, come la pill della lista.

**Cercare: basta scrivere.** Una lettera, con i Pazienti davanti e il cursore fuori da un campo, apre
un filtro sopra la lista, già con quella lettera: la lista tiene solo chi torna, nella stanza gli
altri si spengono. **Invio** apre il paziente se ne torna uno solo; **Esc** (o la ✕) lo toglie.

**La stanza di partenza è quella del PS**, dallo schizzo del medico: da sinistra l'**OBI** (quattro
letti in fila, OBI 4, 3, 2, 1), l'**OSS** (OSS 1 e 2 sopra, OSS 4 e 3 sotto) e la **Sala attesa**,
alta, a destra; la **Sala attesa 2** sotto l'OBI. Le tre stanze sono divise da due celle vuote,
senza muri. Si vede finché non c'è una stanza salvata e si salva al primo cambiamento; una stanza
salvata non viene mai sostituita. Se togli tutto, la stanza resta vuota, con **Disegna la stanza** e
«o riprendi la pianta del PS».

La stanza è una **griglia di celle uguali** (40 × 24; un letto ne prende 5 × 4, una sedia 4 × 3): allargando o
stringendo la finestra — o accorciandosi la lista — cresce o cala tutta insieme, in scala, e **niente si sovrappone** — nemmeno
affiancata o alla misura minima, dove semmai la mappa scorre (sotto i 20 px una cella non porta più
un nome leggibile): di lato anche con la rotella, e il bordo sfuma dalla parte dove c'è altro. Dopo
uno spostamento la mappa resta dov'era. Fuori da Modifica si vede solo il
pezzo disegnato, in alto, subito sotto la lista: anche una stanza piccola riempie la mappa. Il testo non cambia misura: in un
letto piccolo sparisce prima la nota, poi tutto tranne il nome del paziente, che se è lungo va a
capo invece di perdere l'iniziale (quello del letto resta nel passaggio del mouse); a capo va anche
nelle aree. Un letto vuoto è solo il suo nome e un letto disegnato appena; una sedia vuota, il suo nome e una sedia.

La **sedia** è un letto più piccolo e fa tutto quello che fa un letto: un paziente, e chi arriva
prende il posto di chi c'era (che torna in lista); **Sposta in…**, il tocco che apre il
paziente, il nome, la ×.

- **Portare un paziente**: prendi la sua riga e la lasci su un letto, una sedia o un'area; dalla
  stanza lo porti altrove, o di nuovo nella lista (col dito: soglia di 10 px). Ti segue il suo
  nome, accanto al puntatore, mai sopra il letto che miri. Preso dalla stanza, in cima compare
  **Rimetti in lista**, anche quando la lista è vuota: lasciato lì (o sulla lista) torna in lista e il
  letto resta vuoto. Su un letto occupato **il nuovo prende il letto e chi c'era torna in lista** —
  passandoci sopra lo dice: «ROSSI M. → in lista». Premuto e lasciato senza trascinare, per quanto
  a lungo, **apre il paziente**. Un letto o una sedia occupati sono il loro paziente da un bordo
  all'altro: si prende e si tocca dovunque, anche sul nome.
- **Sposta in…**, senza trascinare: tasto destro sul paziente (nella stanza o sulla sua riga), dito
  tenuto premuto, Maiusc+F10 (o il tasto menu), oppure il ▾ della riga. Prima i letti e le sedie
  vuoti, per nome, poi quelli occupati («al posto di ROSSI M.»), le aree, **Rimetti in lista** per
  chi ha già un posto e, a parte, **Promemoria…** e **Togli dall'elenco** — la sveglia e la ✕ di chi,
  stando nella stanza, non ha più la sua riga; frecce, Invio, Esc.
- **Niente conferme: si annulla.** Ogni spostamento, un letto o un'area eliminati, «Togli
  dall'elenco», «svuota» e la ✕ mostrano per 8 secondi, in fondo, «… · **Annulla**».
- **Modifica** serve a ritoccare la stanza, di solito una volta sola. Ci entri dal menu **⋯ →
  Modifica la stanza**; la lista si toglie di mezzo, così si vede la pianta intera, e la fila delle
  schede diventa la sua barra: **+ Letto**, **+ Sedia**, **+ Area** e **Fine**, su una riga anche
  nella colonna di «Affianca». La pianta ha i puntini, e letti, sedie e aree si trascinano di cella
  in cella; uno nuovo va nel primo posto
  libero (se non ce n'è, lo dice), col nome che segue l'ultimo del suo tipo: dopo «Box 1», «Box 2»;
  la prima sedia è «Sedia 1». Dove un oggetto finirebbe sopra un altro diventa **rosso**, e lasciato lì torna dov'era.
  Un tocco sul **nome** lo cambia (Invio salva, Esc lascia com'era); sull'oggetto scelto la **×** lo
  toglie (chi c'era torna in lista); l'angolo in basso a destra allarga un'area. In Modifica i
  pazienti stanno fermi, in grigio; **Fine** (o Esc) e la lista torna.

**Per non sbagliare paziente.** Due pazienti in elenco con lo **stesso cognome** portano **⚠** e il
nome intero; con lo **stesso nome e cognome**, anche le ultime cifre dell'episodio: «ROSSI MARIO ·
…9001». Passando col mouse su un paziente: nome intero, episodio, quando l'hai aperto, da quando sta
nel suo posto, il triage, la nota. Lo **stesso paziente** (stesso codice fiscale) con due episodi:
il più vecchio è **episodio precedente**, in grigio, in fondo alla lista: nella stanza non va. Il posto **non scade**:
resta finché non sposti il paziente, non lo togli dall'elenco o dall'elenco non esce; se non lo apri
da **12 ore** diventa grigio, dov'è.

**Il triage** è il colore che l'intestazione della scheda mostra quando la apri (ROSSO, ARANCIONE,
AZZURRO, VERDE, BIANCO): una striscia a sinistra del nome, la stessa nella lista e nella stanza (nel
letto la porta il letto), e basta — nella stanza il colore vuol dire solo triage. L'unica eccezione è il
tempo di un promemoria, piccolo in alto a destra, che si fa ambra e rosso quando si avvicina.

**Promemoria.** Un'ora per fare una cosa, per paziente: «11:30 tropo», «tra 2h ECG». Si scrive in
un campo su una riga, che si apre dalla **sveglia** accanto alla nota del paziente o da quella che
compare passando su una riga della lista (come la ✕); per chi sta nella stanza, dal suo menu,
**Promemoria…**, in una piccola finestra sotto di lui: **Invio** salva, **Esc** chiude; uscendo dal
campo col mouse si salva, come la nota. L'orario è il **primo** scritto nel testo — un'ora,
«11:30», «11.30», «11h30», «11h», «alle 14», o fra quanto, «tra 2h», «+2h», «2h30», «90m», «30 min»,
«30'», «tra 45 minuti» — e il resto è la cosa da fare. Con una cifra «2h» è fra quanto, con due
«11h» è un'ora; un numero col punto («K 3.50») cede a qualunque altro orario scritto. Un'ora passata
da non più di 2 ore è di oggi (già scaduta), più indietro è di domani: il turno di notte. Mentre
scrivi, sotto il campo, dice quando sarà; senza un orario non salva e lo dice. Accanto al nome, nella
lista e sulla pagina del paziente, una pill dice quanto manca al più vicino — «15m tropo», «1h40»,
«ora», «−5m», con «+1» se ce n'è un altro —, per esteso al passaggio del mouse: tranquilla oltre la
mezz'ora, **ambra** sotto i 30 minuti, **rossa** sotto i 10 e quando è l'ora, con un bagliore lento
(fermo se il sistema chiede meno movimento). Un tocco sulla pill apre i suoi promemoria: **✓ Fatto**
(si annulla per 8 secondi) e **+15 min** (da quando era fissato, o da adesso se è già passato).
Ridotto il pannello, la pill mette un segno rosso solo quando un promemoria è a 10 minuti
o è passato — sempre **con la cosa da fare**: «8m · tropo» se è di chi hai davanti, **«−3m Ferrari · RX polso»**
se è di un altro paziente (il suo cognome: un tempo muto accanto al nome di chi guardi si leggerebbe come
suo; il nome intero è nel passaggio del mouse). Un tocco sul segno apre un menu minuscolo: **✓ Fatto**
(sulla pill non c'è dove mostrare l'«Annulla»: lo porta il menu, per 8 secondi), **+15′** e **Apri**
(carica la pagina di quel paziente, con la finestra aperta). I tempi si rifanno da soli ogni 30 secondi, sul
posto: niente si ridisegna sotto chi scrive.

Tutto resta **solo in questo browser** (`localStorage`), niente va in rete; lo **stato degli
esami** (`stato.v1`) è per episodio — ore, nomi di esami, mai il nome del paziente —, scade in 24
ore, se ne va con 🗑 e «Svuota l'elenco»; le allergie lette lì dentro se ne vanno anche alla pagina
di login; un altro PC o un altro
profilo Chrome ha la sua stanza. La **stanza disegnata** (`stanza.v1`: celle intere della griglia,
così a ogni misura è la stessa; la sedia è un letto con `forma: "sedia"`) resta come i fogli di
dimissione: è un modello, non contiene pazienti. Finché non c'è, si vede quella del PS, coi suoi id
fissi («obi1»…): chi è messo in OBI 1 ci resta anche prima che la stanza sia salvata. **Chi sta dove** (`stanza.posti.v1`) sono solo numeri di episodio, mai nomi. La pagina di
login **non** li cancella: chi viene riaperto dopo una sessione scaduta ritrova il suo letto (il
posto aspetta al massimo un giorno). «Svuota l'elenco» toglie anche i posti; eliminare un paziente
(🗑) toglie anche il suo. I **promemoria** (`promemoria.v1`) sono per episodio: l'ora e la cosa da
fare, mai un nome; al massimo 10 a paziente, scadono 12 ore dopo l'ora fissata. Nemmeno loro li
cancella la pagina di login — una sessione scaduta non deve far perdere la troponina delle 11:30 —;
«Svuota l'elenco» e 🗑 sì.

### Richieste
1. **Quesito diagnostico** — casella su una riga, suggerimenti a fianco; l'ultimo resta scritto.
   La **radiologia ha il suo**: casella «Quesito RX» nel gruppo RX. Se è vuota, la richiesta di
   radiologia prende quello sopra; se è scritta, il laboratorio usa quello sopra e la radiologia
   il suo.
   **Il quesito del triage resta, a meno che non scrivi il tuo.** Se il triage ha già compilato il
   quesito della richiesta, di norma parte quello. Ma se nella casella del pannello il quesito
   l'hai **scritto tu, a mano**, vince il tuo (vale anche per il «Quesito RX»). Un chip o un
   pacchetto che riscrive la casella non conta come scritto a mano: lì resta il triage. La
   ricevuta e la striscia finale dicono quale è partito, in una riga: «Quesito del triage:
   "…"» oppure «Quesito: il tuo». (Il «⧉ Copia» del Registro il quesito lo omette, come sempre.)
   **Tre quesiti sono pacchetti di esami**, sempre i primi chip (anche se l'elenco dei quesiti
   salvato non li ha), e ognuno dice quanti esami porta — «Dolore toracico · 6»: un tocco scrive
   il quesito **e** spunta gli esami che servono quasi sempre.
   - **Dolore toracico** — base (emocromo POC, EGA venosa NEW, creatinina POC), PT e PTT POC,
     troponina US.
   - **Dispnea** — base ma con l'**EGA arteriosa NEW** (non la venosa), PT e PTT POC, D-dimero POC,
     troponina US, NT-proBNP.
   - **Dolore addominale** — base, EGA venosa, epatico e pancreatico (bilirubina, GPT, GOT,
     GAMMA GT, lipasi), PT e PTT del laboratorio centrale («Fantoli», cioè Urgenze: non il POC).

   Il chip scelto è **acceso**. Toccarne **un altro** cambia pacchetto: se ne vanno solo gli
   esami che aveva messo il pacchetto di prima — **quelli che hai scelto tu restano** (anche uno
   che il pacchetto avrebbe messo e c'era già). Toccare **di nuovo** il chip acceso toglie il
   quesito e il suo pacchetto. Un quesito normale (Febbre, Trauma…) scrive solo il quesito, come
   sempre, e lascia andare il pacchetto: gli esami restano, ora sono tuoi. Un esame del pacchetto
   che **non c'è nel catalogo di questa macchina** non viene aggiunto e il pannello lo dice, una
   volta, nel banner e nel Registro: non si inventa mai un codice.
2. Gli esami stanno in **gruppi per laboratorio** — **POC**, **Lab centrale** (le «Urgenze» e il
   laboratorio centrale: per chi ordina sono lo stesso posto), **RX** — e ogni gruppo ha **in
   testa i suoi profili rapidi**: Base PS e Coag POC sotto POC, Epatico e Coag sotto Lab
   centrale. Poi gli **esami singoli** — fra questi
   **EGA VENOSA NEW** / **EGA ARTERIOSA NEW** (il laboratorio ha rifatto gli emogas: sono i
   codici nuovi, e la vecchia versione resta in elenco solo in «altri esami…»), gli **epatici
   uno per uno** (GPT, GOT, GAMMA GT, BILIRUBINA, LIPASI: il profilo li ordina insieme, ma
   quasi sempre se ne vuole uno solo), **PT POC** e **PTT POC** (la coagulazione che i pacchetti
   mettono: qui si vede e si toglie) e **SARSCOV**
   (tampone antigenico SARS-CoV-2, laboratorio centrale), griglia compatta a
   due colonne per laboratorio (POC / Lab centrale / RX). Per tutto il resto: **«altri esami…»**,
   subito sotto il quesito, con menu a tendina su tutti i laboratori. Lo stesso esame delle
   Urgenze e del laboratorio centrale (le Urgenze ne sono un sottomenu) è **una riga sola**,
   quella delle Urgenze — la stessa che usano i pacchetti. I selezionati restano in alto, una
   riga per laboratorio, con la ✕ al passaggio del mouse.
   In una sede che la versione **- NEW** non ce l'ha ancora, il pannello ordina **quella di
   sempre** e lo scrive nel Registro — e nella ricevuta, accanto all'esame: «EMOGASANALISI VENOSA
   POC *al posto di EGA VENOSA NEW*». Un codice nuovo non deve far fallire un ordine.
   **La seconda sede (OSG)** non ha il laboratorio «Urgenze»: POC e un laboratorio unico. Gli
   esami della colonna Urgenze vanno nella risorsa di questa sede che ha **lo stesso esame** —
   stesso nome o stesso mnemonico LIS — e **mai** in un POC (un altro strumento, un'altra
   provetta): la PCR del bottone finisce nel laboratorio, non fra i POC. In «altri esami…» si
   vedono solo le risorse della sede in cui sei (prima ogni esame usciva due volte, una per
   sede), e i nomi di reparto funzionano: **PCR** trova «PROTEINA C REATTIVA» (prima trovava
   solo «PCR POC»), e così PCT, EGA, GGT, AST/ALT, BNP, tropo — il laboratorio prima del POC.
   Accanto a ogni esame, in grigio, **quando è già stato fatto** in questo episodio (l'ora della
   richiesta tornata: `TROPONINA US · 11:40, 14:30`) o **da quanto aspetta**
   (`EMOCROMO POC · in attesa 40′`) — stessa fonte dello stato dei Pazienti, stesso nome del
   catalogo; niente quando non si sa, e «letto 11:02» se la lettura è vecchia. Un pacchetto
   come «Dolore toracico» spunta come sempre: il suffisso fa vedere il doppione, non lo toglie.
3. **Mentre manda, puoi fare altro.** Partito il giro il pannello si fa piccolo: una
   **striscia** in un angolo con il nome del paziente, a che punto è — in esami, «esame 3 di 6»,
   non in passi — e che cosa sta
   facendo in quel momento — *creo la richiesta*, *invio LIPASI*, *controllo il carrello 2/3*,
   *confermo*. Sotto ci lavori normalmente: il gestionale non è bloccato e non compare più
   «vuoi lasciare la pagina?».
   **Se navighi, il giro non muore: riprende.** Il motore vive nella pagina e la pagina muore a
   ogni click, quindi il giro è annotato passo per passo e riparte da solo sulla pagina dopo —
   rilegge il carrello dal server, salta quello che c'è già, manda il resto. L'esame che era
   **in volo** nell'istante del cambio pagina **non viene mai rimandato**: si cerca in
   carrello, e se non c'è il giro si ferma e te lo dice (una provetta in più al laboratorio non
   è un dettaglio). Finito un giro **ripreso**, la pagina **non** te la porta via: il carrello
   lo apri col bottone, e le etichette partono quando torni sulla scheda di quel paziente.
   Un tocco sulla striscia apre il pannello intero (passi + Registro), il quadratino rosso
   ferma tutto. **Esc** ferma il giro solo col pannello aperto: da quando gira in sottofondo, un
   Esc dato al gestionale (una tendina, un campo) non deve fermare gli esami. Se intanto sei sulla scheda di un altro paziente la striscia diventa **ambra** e
   lo scrive: gli esami restano quelli di chi li hai ordinati.
   **Con l'estensione il giro va in una scheda di sottofondo.** «Conferma e stampa» (e «solo
   carrello») non mandano gli esami dalla tua scheda: l'estensione apre **una seconda scheda,
   accanto e dietro**, sulla pagina vera del paziente — lo stesso indirizzo da cui il giro
   partirebbe (o il carrello della richiesta, per «Riprova» e «Svuota») — e lì il motore di
   sempre fa tutto: crea, aggiunge, verifica, conferma con la prova, prende i fogli. Che sia
   «la scheda dell'ordine» lo sa chiedendolo al service worker col **numero della scheda**:
   nell'indirizzo non c'è niente che il gestionale vedrebbe. È **un esecutore e basta**: non
   diventa mai la tua scheda, nemmeno se ci dai un'occhiata. La tua è libera da subito: cambi
   pagina, apri un altro paziente, e il giro non si ferma. **Ogni scheda del gestionale**
   mostra la stessa striscia — il paziente, «esame 3 di 6», il passo —; un tocco apre il
   **tuo** pannello, ⏹ ferma l'ordine (anche mentre la scheda si apre: allora non parte niente;
   fra una pagina e l'altra il fermo resta segnato, «Fermo chiesto», e vale alla prima parola).
   **Ogni esito arriva a te.** Finito, la scheda dell'ordine si slega e **si chiude da sola** —
   resta, una scheda qualunque, solo se la stai guardando in quel momento. Le etichette si
   stampano dove sei (sotto); «solo carrello», una conferma sospesa o non verificata, un ⏹, **un
   errore** diventano in ogni scheda una striscia con **apri il carrello**: lo apre lì, con la
   ricevuta o col resoconto intero (Riprova, Svuota, Chiudi). ✕ chiude l'avviso. Con l'esito
   arriva anche il **Registro** della scheda dell'ordine (le sue ultime righe): si aggiunge al
   Registro di quel paziente nella tua scheda, sotto «il Registro della scheda dell'ordine», e
   «⧉ Copia» lo copia — il perché di una conferma sospesa o non verificata non muore più con lei.
   **Le etichette non ti saltano addosso.** Vanno nella scheda del gestionale che hai davanti
   (la finestra in primo piano), **una volta sola**, e dicono **di chi sono**. Sulla pagina di
   quel paziente, o sulla lista, il dialogo parte da solo — ma non mentre scrivi (cursore in un
   campo, un tasto da poco: aspettano); sulla pagina di un **altro** paziente non si apre da
   solo: «Etichette di ROSSI M. pronte · **Stampa**», un tocco. Senza una scheda del gestionale
   davanti aspettano (mezz'ora; poi dalla sua pagina, sezione Stampa); la pagina di accesso non
   le butta via.
   **Un secondo ordine mentre uno gira aspetta in coda** — la striscia dice «+1 in coda» — e
   parte quando il primo ha finito o si è fermato (sulla sua striscia, «In coda», ✕ lo toglie).
   **Niente sparisce zitto, anche qui.** Chiusa a metà la scheda dell'ordine, la striscia dice
   «Scheda chiusa · 2 esami non mandati: …» e «Da controllare» per quello che era in volo (mai
   fra i non mandati). Una scheda che non parte entro 45 secondi è un avviso rosso; una che tace
   da tre minuti si interroga: se risponde era lenta, se no «Ordine fermo» — ma finché esiste
   niente è «non mandato», la coda aspetta e ⏹ la chiude. Col browser caduto la scheda
   ripristinata **non** riprende l'ordine di nascosto: vale il segno di sempre.
   **Quando non va in sottofondo**: col bookmarklet, sulla pagina «Nuova richiesta» (il suo
   modulo vivo non si porta altrove), per la coppia laboratorio + radiologia, se l'indirizzo del
   paziente non si riapre così com'è, o se la scheda non si apre: il giro lo fa la tua pagina,
   come prima — solo su un no esplicito del service worker. Una risposta persa si richiede con
   lo stesso numero, e l'ordine resta uno; se non risponde proprio, la striscia dice di guardare
   il carrello prima di rifarlo.
   **Chrome e le schede nascoste.** Chrome rallenta le schede che non si vedono: i timer non
   scattano più di una volta al secondo, e dopo **5 minuti** di scheda nascosta possono
   aspettare fino a un minuto. Nel giro diventano almeno di un secondo le pause del motore
   (250 ms fra un invio e l'altro, 1,2 s prima di ogni verifica): un ordine di sei esami ci mette
   qualche secondo in più. Non rallentano le richieste al server, la pagina della conferma
   (aspetta il caricamento, non un timer) e le scadenze, contate sull'orologio. Un ordine dura
   molto meno di 5 minuti, e la scheda è segnata perché la memoria del browser non la scarichi.
   Le etichette non le aspetta la scheda nascosta: arrivano e si stampano nella tua, davanti.
4. **Un bottone solo: Conferma per ROSSI M. · 68 M · N esami.** Fa tutto da solo e conferma **subito**: il
   click è la decisione, e la conferma parte solo se ogni controllo passa — episodio,
   richiesta, nome dell'ultimo esame, e
   **carrello identico alla ricevuta** (un avanzo di un tentativo precedente la **sospende** e
   la lascia a te: striscia ambra «Conferma sospesa», sul carrello). La finestra del pannello
   **non si apre mai da sola**: la striscia dice «Confermo…» → «Confermata · Aspetto le
   etichette…»; arrivate, le etichette compaiono **in anteprima** con la stampante su cui vanno
   e si apre il dialogo di stampa (vedi «Stampa etichette e lista esami») → «Aspetto la lista
   esami…» → e alla fine il **resoconto, che resta** finché non fai altro: «Stampa finita · 6
   esami confermati 14:32», con sotto la riga del quesito, e accanto un **Ristampa** tranquillo
   (chiuso il dialogo, il browser non dice se hai stampato o annullato). «Stampato», senza
   Ristampa, solo se sei andato avanti tu, «→ Avanti», documento per documento. Con la
   **stampa automatica** non c'è né anteprima né dialogo: «Confermata · Stampo le etichette su
   Zebra ZD421… · foglio 1 di 2», poi «Stampato su …» (vedi «Stampa automatica»).
   Accanto al bottone c'è un link, **solo carrello**: aggiunge e verifica gli esami e si atterra
   sul carrello del gestionale con la striscia «✓ N esami in carrello · Conferma dal
   gestionale»: premi **Conferma** lì (le etichette partono lo stesso), o tocca la striscia per
   la **ricevuta** — il carrello e un bottone solo, **Conferma e stampa**. La griglia degli esami
   lì sta dietro un piccolo **+ aggiungi**.
   **«Confermata» solo con una prova**: una pagina dello stesso episodio che elenca i fogli da
   stampare di quella richiesta. Se dopo il clic arriva altro — un errore del server, di nuovo
   il carrello, niente — il pannello legge la pagina del paziente (solo letture, mai un invio),
   e se non la elenca ancora la rilegge dopo 2, 4 e 8 secondi: il gestionale può metterci un
   po'. Se nemmeno così la richiesta risulta, la striscia è **ambra**, «Non confermata ·
   tocca per il carrello», mai verde. Niente viene riconfermato da solo: un tocco apre il
   carrello, e lì decidi tu.
   **Nessuna richiesta dimenticata.** Prima della conferma in sottofondo (e alla fine di un giro
   in revisione, o fermato da un errore) il pannello annota la richiesta — solo numeri:
   richiesta, episodio, ora, quanti esami; mai un nome — e la tiene d'occhio: se dopo **2
   minuti** la pagina di quel paziente che hai davanti non la mostra fra le confermate, la
   striscia dice «Richiesta 14:32 non confermata · tocca per il carrello». Vale anche se hai
   cambiato pagina mentre diceva «Confermo…»: la conferma automatica muore con la pagina e non
   riparte da sola più tardi. Vista confermata, il segno se ne va (dopo 12 ore comunque). Al
   server non si chiede niente per questo: si guarda la pagina che hai aperto.
   **Se qualcosa va storto, si finisce a mano nel gestionale.** La striscia diventa **rossa** —
   «Errore · completa a mano» / «Mancano: PTT POC · Da controllare: Troponina» — e la scheda va
   sul **carrello** della richiesta, sul laboratorio del **primo esame rimasto fuori**: una
   semplice lettura dell'elenco, niente inviato, niente confermato. **Mancano** sono gli esami
   mai partiti: li aggiungi tu. **Da controllare** sono quelli mandati ma non visti in carrello:
   guarda se ci sono prima di aggiungerli — mai due volte. Un tocco sulla striscia: il
   resoconto, corto — il motivo, gli elenchi «Mancano» / «Da controllare» / «Nel carrello», **un'azione
   sola** (↻ Riprova i mancanti, o Apri il carrello) e **Chiudi**; i passi e il Registro stanno
   insieme sotto **Dettagli**, chiuso. Sessione scaduta, episodio che non torna o un'altra
   scheda al lavoro: solo la striscia rossa, la pagina resta quella.
   **…oppure si riprova, solo quello che manca.** Sul carrello di quella richiesta il resoconto
   ha **↻ Riprova i mancanti (N)**: manda **solo** gli esami mai partiti, sulla **stessa**
   richiesta e come il primo giro — in revisione atterra sul carrello, con **Conferma e stampa**
   conferma e stampa la richiesta intera, una volta sola. Il motore rilegge il carrello dal
   server: quelli già entrati li ritrova e **non li rimanda** (e se intanto ne hai tolto uno a
   mano, non lo rimette); quelli **da controllare** restano fuori, in elenco — guardali nel
   carrello prima. Lontano dal carrello c'è prima **Apri il carrello e controlla**: il resoconto
   viaggia con lui, e lì compare «Riprova». Se la richiesta non era ancora nata, «Riprova» è un
   giro normale dalla pagina del paziente. Niente «Riprova» se non manca niente (solo «da
   controllare»), dopo una sessione scaduta, un episodio che non torna, un'altra scheda al
   lavoro, né per la coppia laboratorio + radiologia. **Una volta lo fa da solo:** un esame
   rimasto fuori da un elenco venuto male, con niente «da controllare», si riprova subito — la
   striscia dice «Riprovo 1 esame…» — e il resoconto arriva solo se si ferma ancora.
   **…o si svuota il carrello e si ricomincia.** Sul carrello di quella richiesta il resoconto
   ha anche, più discreto, **Svuota il carrello e ricomincia**. Il primo tocco **legge il carrello
   vero**, tutte le sezioni (solo letture), e chiede coi nomi: «Svuoto 3 esami: EMOCROMO POC,
   TROPONINA US, PCR?»; il secondo fa. Prima legge la pagina del paziente: se la richiesta
   risulta **confermata, non tocca niente**. Poi, per ogni sezione del carrello che ha righe,
   segue il link **«Svuota carrello» del gestionale** — preso dalla pagina esami di quella
   richiesta, e solo se porta la sua RICHIESTA_ID e il suo EPISODIO_ID (e la sua sezione);
   una sezione senza «Svuota» si toglie riga per riga, coi suoi «Elimina». Poi **rilegge ogni
   sezione dal server**: vuoto, rimette **tutta la selezione di partenza e quello che nel
   carrello c'era già** (un esame aggiunto a mano o da un giro di prima torna anche lui, per
   codice) nella stessa richiesta, e va avanti come il primo giro — conferma e stampa, o solo
   carrello. Una riga che non si saprebbe rimettere (il catalogo non la conosce, o oggi ha un
   altro nome) **ferma tutto prima di togliere qualunque cosa**, e il bottone lo dice. Se dopo
   lo svuotamento resta anche una riga: stop, il resoconto dice cosa resta, **niente viene
   rimesso** e niente «Riprova»: si finisce a mano. Il promemoria «non confermata» segue il
   carrello vero: vuoto si toglie, torna col primo esame rimesso. Vale con e senza estensione
   (anche col bookmarklet). «↻ Riprova i mancanti» resta com'era.
   **Chiudi** (era «Annulla», ma non annullava niente) toglie il resoconto — la pill torna
   quella di sempre — e ti riporta alle Richieste col quesito. La richiesta lasciata a metà è
   **ancora lì** nel gestionale, da confermare: il promemoria «non confermata» resta, e le
   Richieste lo dicono in una riga discreta — «Richiesta delle 14:32 (4 esami) ancora da
   confermare», con «apri il carrello» accanto. Restano scelti **solo gli esami che mancano davvero**:
   quelli già nel suo carrello (e i «da controllare») non si offrono di nuovo, così il conto sul
   bottone è quello vero.
   **Sul suo carrello la riga ha due azioni**, anche riaperto più tardi (un ricarico, un'altra
   scheda: niente ricevuta né resoconto, e prima era un vicolo cieco): **Conferma e stampa** e
   **Svuota**, a due tocchi. Il primo legge il carrello vero, tutte le sezioni, e chiede coi nomi
   — «Confermo 1 esame: PCR?», «Svuoto 1 esame: PCR?» —; il secondo fa (dopo 8 secondi si torna
   a capo). Conferma preme la Conferma del gestionale, e la stampa parte; Svuota svuota come
   «Svuota il carrello», senza rimettere niente, e la richiesta si dimentica; un carrello letto
   già vuoto si dimentica e basta. Solo se la pagina ha la Conferma.
   **Mentre scrivi, la pagina non cambia da sola.** Ogni salto di pagina deciso dal pannello
   (errore → carrello, revisione → carrello, conferma sospesa) prima guarda: se hai il cursore
   in un campo del gestionale, hai cambiato un campo, o hai premuto un tasto negli ultimi 15
   secondi, resta dov'è e la striscia dice «… · tocca per il carrello» — un tocco ci porta.
   **Una riga che la pagina non mostra** (l'elenco a volte arriva monco) si **rilegge con la
   ricerca del gestionale**: lo stesso elenco con la casella «Prestazione» compilata — il
   mnemonico LIS fra parentesi se il nome ne ha uno, se no il nome — una sola lettura. Se la riga
   compare, passa per la strada di sempre (nome vivo controllato, un invio solo); se no, l'esame
   finisce fra i «Mancano» e lo aggiungi a mano. Vedi le regole 3 e 4.
   Selezionando laboratorio **e** radiologia il bottone diventa **Conferma e stampa · 2 richieste** e il pannello
   le costruisce e le porta entrambe a conferma, con **una sola** stampa finale. Questa è
   l'unica che **non** va in sottofondo: le due richieste vivono nella memoria del pannello, e
   a metà non si riprendono — lì il browser avvisa ancora prima di cambiare pagina.
5. **Stampa**: ogni richiesta con data, ora e la lista compatta degli esami.

### Esiti
Due sezioni, una sotto l'altra: **Valori** e **Referti**.

**Valori** è un'unica tabella: gli analiti in riga, raggruppati per sezione fissa (*Emocromo,
Coagulazione, Biochim, Organi, Elettroliti e metabolismo, Emogas, Urine e altri liquidi*, e in
fondo **Altri** — i dettagli più sotto), una colonna per prelievo, **il più recente a sinistra**
(marcato «ultimo»). In cima a ogni colonna: **solo l'ora** se il prelievo è di oggi, **la data**
(27/08) con l'ora sotto se è di un altro giorno; **passando il mouse** sull'intestazione si legge
data e ora per esteso e **gli esami** compresi in quella richiesta.

- I nomi sono in **sigla** (`Hb`, `GB`, `PLT`…), con l'**unità fra parentesi accanto al nome**
  (`GB (×10⁹/L)`) e il **range nel tooltip del valore**. Il gestionale scrive «x10» e perde l'esponente:
  per i conteggi cellulari — globuli bianchi e formula, piastrine ×10⁹/L, globuli rossi ×10¹²/L — si scrive per
  esteso; ogni altra unità «x10» nuda resta com'è, mai un'ipotesi.
- La **formula leucocitaria** è una riga per cellula: il valore **assoluto** e fra parentesi la
  **percentuale** — `Neu 4.0 (56%)`. Il laboratorio le manda in coppia («Granulociti» e
  «Granulociti %»), che prima erano due righe con lo stesso nome. Il fuori range è quello
  dell'assoluto; una percentuale che arriva da sola resta da sola. Un nome fuori elenco è scritto **per esteso** e sottolineato a puntini — lo stesso
  vale per un'abbreviazione ambigua — e una riga piccola in cima dice **quanti** (**quali** apre l'elenco).
- **Valori e Referti fianco a fianco** quando la finestra è abbastanza larga (misurata sul contenitore,
  non sullo schermo: dentro la finestra da 1150 px sì, nella colonna di «Affianca» no): la tabella a
  sinistra, i referti in una colonna accanto; stretto, uno sotto l'altro.
- La tabella è **larga quanto i suoi numeri**, non quanto il pannello: se allarghi la finestra i
  valori restano **accanto ai nomi** invece di allontanarsene, e sono allineati a sinistra
  (incolonnati dalle cifre tabulari).
- In rosso c'è **solo il valore**, con ↑ ↓: il nome resta a sinistra, sempre nella stessa colonna.
  Una cella **·** = quel prelievo non ha quell'analita; *in corsivo* = risultato ancora
  **parziale** (il laboratorio non ha finito — c'è una riga che lo ricorda sotto la tabella). Quando lo stesso
  analita arriva da esami diversi — l'emocromo del POC e quello del laboratorio, per dire — chi
  non è «il solito» porta un **asterisco o una croce**, spiegati nella legenda sotto la tabella.
- **⭳ Carica i valori** legge i prelievi non ancora letti: finché non c'è una tabella è **un solo
  bottone grande** al posto della tabella (i dettagli — quanti prelievi, da dove — sono nel passaggio
  del mouse, non in una riga che ripete le stesse parole); fatta la prima lettura diventa il piccolo
  **↻ Aggiorna**, che rilegge **tutti** i prelievi ancora aperti, a passo lento e uno alla volta.
  Con l'estensione il bottone legge **lo storico del portale**, in una scheda di sottofondo che si
  chiude da sola (vedi *Da dove viene la tabella*): lì ci sono **tutti** i valori del laboratorio,
  refertati e no, con una pagina sola. Le finestre Risultati — una richiesta per prelievo — si
  leggono **solo se il portale non si può leggere** (niente estensione, niente link, o non ha
  risposto: il pannello dice perché).
  **solo alterati** / **tutti** filtra le righe; **↺ Reset** dimentica i valori letti e la scheda
  in archivio di questo paziente, e **⭳ Carica i valori** li rilegge da zero (i tuoi segni
  restano).
- Di un prelievo il gestionale può **non dare data e ora** (né nel campo nascosto della riga, né
  a video). Quei valori **non spariscono**: diventano la colonna **?**, in fondo a destra, con
  «ora ignota» sotto e il motivo nel tooltip. Un piccolo «? 1 senza ora» nella riga del titolo lo dice (il perché è nel passaggio del mouse), e il Registro
  elenca ogni prelievo letto con la colonna in cui è finito.
- **Un tocco su un valore lo segna**: giallo; un secondo tocco arancio; un terzo lo spegne. I segni
  sono tuoi, restano col paziente (24 ore, come la nota) e sopravvivono al cambio di pagina.
- **Cosa è cambiato dall'ultima volta che hai guardato**: dopo un **↻ Aggiorna**, in quel prelievo
  un valore cambiato ha **sfondo azzurro**, e lo stesso vale per un analita comparso da zero. In
  cima compare **«N valori nuovi dall'ultima lettura»** con un bottone **Letto** che spegne i
  marchi. La prima lettura di un prelievo è sempre il riferimento: non è mai un muro di marchi.
- Un avviso dice quali prelievi non si sono lasciati leggere (il **Registro** dice perché; **↻ Aggiorna**
  riprova). Quanti ne mancano da leggere lo dice il passaggio del mouse su **⭳ Carica i valori**.
- La tabella mette insieme due cose: i prelievi letti **in questa scheda del browser** — sempre,
  anche col bookmarklet e senza estensione — e, quando è di questo paziente, la **scheda
  clinica** che l'estensione tiene in archivio (la tabella del portale, e i prelievi letti in
  altre schede). Un prelievo il cui referto è arrivato nel frattempo — e la cui finestra
  Risultati è quindi sparita — **resta in tabella** come colonna: non scompare mai.
- Il pannello **si allarga da solo** quanto serve alle colonne, fino all'**80%** dello schermo in
  larghezza e altezza — mai più stretto di come l'hai già ridimensionato a mano.
- Quando la scheda viene (anche) dal portale, sotto la tabella compare: *«Con lo storico del
  portale, letto per NOME · identità confermata dal paziente da cui l'hai aperta / dal codice fiscale / dal nome»*.
- In memoria c'è **una scheda per ogni paziente visto nelle ultime 24 ore**: è normale, e quelle
  degli altri non si mostrano mai. Se ne parla solo quando dal portale è **appena arrivato** (10
  minuti) uno storico che non è di questo paziente: *«Lo storico appena letto dal portale è di
  NOME, non di questo paziente: non lo mostro»* — di solito il portale era rimasto su un altro.
  Prima lo diceva su ogni paziente ancora senza scheda, e sembrava uno scambio di pazienti.

**Referti** è la lista dei documenti (ECG, RX, TC, visite…), una riga ciascuno, ognuno con
**data e ora della richiesta**, il più recente in cima. I referti di **laboratorio** (LIS) **non
ci sono** quando la tabella dei Valori li può mostrare — c'è una tabella, o c'è da dove leggerla
(estensione e portale): lì quello che dicono è già nei Valori, e in mezzo agli altri facevano
perdere l'ECG e la radiologia. Né il conteggio «Referti (n)» né **Salva i referti** e **↻ Resetta**
li contano o li toccano. **Senza tabella e senza portale** (il bookmarklet, per dire) i referti di
laboratorio sono l'unico posto dove si vedono i risultati finali: allora restano, **chiusi** sotto
**«Laboratorio (N)»** in fondo agli Esiti — un tocco li apre. La scheda **Esiti** non porta nessun numero. Un
esito finale non sparisce mai: «Nessun esito per questo paziente» compare solo quando non c'è
davvero niente, nemmeno un referto.
- **RIS ›** — referti di **radiologia** (RX, TC, ecografia, RMN) ed **ECG**: si aprono **dentro il
  pannello, come testo**. Il testo lo legge **pdf.js** — il lettore PDF di Firefox, dentro
  l'estensione, caricato nella scheda solo quando apri un referto: legge quello che legge Firefox
  (PDF cifrati, oggetti compressi, font di ogni tipo). Senza estensione resta il lettore interno,
  più semplice. Leggi il referto senza cambiare scheda, lo copi per il diario con **⧉ Copia**, e
  il PDF resta a un tocco (**↗ PDF**). I referti sono **PDF di testo, mai immagini**: se il testo
  non esce è uno sbaglio del lettore, non del referto — il PDF **si tiene** lo stesso (pallino
  verde) e si apre, e **⧉ Copia diagnosi** dice com'è fatto quel PDF (versione, cifratura, font,
  filtri: **mai il contenuto**), per correggerlo. Se il pannello non lo legge, al tocco ci prova anche il **service
  worker** (che raggiunge il server del portale, dove la pagina del gestionale non arriva). Se
  neanche lui, il pallino è rosso col motivo — e il motivo dice **su quale server** il gestionale
  rimanda il referto (solo l'indirizzo del server, niente del paziente) — e il documento **si apre
  lo stesso, con lo stesso tocco**. **⧉ Copia diagnosi** ora c'è per **ogni** referto non letto,
  non solo per i visualizzatori HTML.
- **AMB, consulenze… ↗** — gli altri referti (PDF): si aprono in una scheda e, con l'estensione, il
  documento che apri **viene tenuto** (pallino verde) — la volta dopo si apre all'istante, senza
  toccare il server. **Salva i referti** (menu **⋯**, solo con l'estensione) prende tutti quelli in elenco in una volta, **↻ Resetta** svuota.
  Un referto che non si lascia salvare (pallino rosso, il motivo al passaggio del mouse e nel
  Registro) resta apribile con un tocco; **⧉ Copia diagnosi** copia com'è fatto il visualizzatore
  che l'ha impedito — senza numeri né valori dei campi — da mandare a chi fa il pannello. Lo
  stesso bottone (**⧉ Diagnosi**) compare fra i comandi della stampa quando un documento non si
  lascia catturare.

> Perché i referti restano fuori dalla tabella dei Valori: referto e prelievo sono due cose
> diverse per il gestionale (un referto per documento, un accesso per prelievo, senza una chiave
> comune) e un abbinamento "a occhio" per nome ed ora prima o poi metterebbe i valori di un
> prelievo sotto il documento di un altro. Meglio due sezioni distinte e oneste che una fusione
> plausibile ma sbagliata.

### Chi c'è, e chi è stato dimesso
Nell'elenco **Pazienti** ogni scheda ha **Dimesso ✓**: il paziente esce dall'elenco principale e
finisce fra gli **Archiviati** (in fondo, con il conteggio). Da lì lo si può **↩ riportare** fra gli
attivi, oppure **🗑 eliminare** — e eliminare vuol dire *tutto quello che il programma sa di lui*:
la scheda clinica, i referti tenuti, il testo dei referti letti, la nota, i promemoria e i dati per
episodio di quella scheda del browser. Chiede conferma una volta e non si torna indietro. L'elenco tiene un
giorno e sessanta pazienti: un turno è di dodici ore.

**Il nome viene dal riquadro del paziente**, quello colorato in testa alla scheda (episodio, nome,
nascita, codice fiscale, motivo): la sua riga più grande. **Non dal titolo della scheda del
browser**: il gestionale ci scrive il nome su certe pagine e «Pronto Soccorso» su altre, e quel
titolo era entrato in elenco come se fosse un paziente. Il titolo vale solo come ripiego, dove il
riquadro non c'è, e solo se sembra un nome (niente cifre, niente «Pronto Soccorso», «Lista»…); un
«Pronto Soccorso» già in memoria si mostra come «paziente» finché non riapri la sua pagina.
Nel riquadro, **accanto al codice fiscale**, c'è un'icona ⧉: un clic lo copia negli appunti (✓ per
un attimo). È l'unica cosa che il pannello aggiunge alla pagina del gestionale, e il suo clic non
fa scattare il doppio clic del riquadro.

### Nota sul paziente
Sotto il nome, una **nota** di due righe che cresce con quello che scrivi. Non c'è un tasto Salva:
**si salva mentre scrivi** (e comunque quando esci dal campo), e compare un «salvata» che scompare
da sé. È legata al paziente — codice fiscale quando il pannello lo conosce, altrimenti il nome —
resta cambiando pagina, e scade dopo 24 ore come i dati clinici. Vive nel browser di quel computer:
non esce da lì. Alla sua destra, i **promemoria** del paziente e la loro sveglia (vedi *Pazienti*).

### Modificare i fogli in fretta: `dist/dimissioni.html`
Una **pagina sola**, senza server: si apre col doppio clic e dentro ci sono già gli otto fogli in
servizio. Clicchi un titolo o un testo e scrivi — nessun tasto «modifica», nessuna schermata.
**+ Nuovo foglio**, **↑ ↓** per riordinare, **🗑** per buttarne uno (chiede conferma).
**⬇ Salva** scarica `dimissioni.json` *e* lo copia negli appunti, nella forma esatta che il pannello
importa con **Importa i fogli…** (menu **⋯**, in Dimissioni): si passa da lì e i fogli nuovi sono in servizio. Il lavoro a metà resta
nel browser, quindi chiudere la pagina non costa niente; **↺ Originali** rimette i testi spediti.
La pagina sta nello zip e si rigenera con `npm run editor`.

### EO
Un elenco di **esami obiettivi da incollare in cartella**, scritti dal medico e tenuti verbatim.

- **Mio solito base** (in cima, breve, su tre righe) ed **EO generale** (completo, tutto negativo,
  su cinque righe: generale · torace e cuore · addome · arti · neuro e cute): un tocco e il testo
  è negli appunti, con gli a capo.
- **Aggiungi per caso**: una tendina con nove quadri (*dolore toracico, dispnea, dolore addominale,
  cefalea, trauma/caduta, sincope, lombalgia, vertigine, pediatrico*) e quattro **frasi pronte**
  (rettale rifiutata, neuro poco collaborante, NEXUS, segni d'allarme spiegati). **Sceglierne uno lo
  copia da sé**: nessun secondo passaggio.
- Il testo scelto **resta scritto sotto la tendina**, così si vede cosa è finito negli appunti, e
  **⧉ Copia di nuovo** (che compare **solo dopo una scelta**) lo ripete senza doverlo riscegliere. La
  scelta sopravvive al cambio schermata.
- Si usa in due incollate: prima l'EO generale, poi l'aggiunta del caso. I testi sono **uguali per
  tutti i pazienti** — quello che riguarda *questo* paziente si scrive in cartella (lo dice il passaggio
  del mouse su «Aggiungi per caso»: in fondo alla schermata non c'è nessun paragrafo). Nessun dato di
  paziente entra qui (è un controllo del collaudo).

I testi stanno in `src/eo.json` e sono compilati dentro l'estensione: **zero richieste al server**.
**✎ li riscrive dal pannello**, come i fogli di dimissione: accanto all'EO generale e accanto al
caso scelto. La tua versione resta su questo computer e si copia al posto dell'originale; un
**•** accanto al nome (anche nella tendina) dice che è riscritto da te, **⟳** che nel frattempo è
cambiato l'originale. **↺ Originale** (due tocchi) torna al testo di partenza.

### Consensi
Sei moduli da firmare, dentro l'estensione: **Emocolture**, **HIV Dipendente**, **Lesioni
Animali**, **Antitetano**, **TAC cmdc**, **Emotrasfusione** (il pacchetto trasfusionale:
consenso informato, richiesta emocomponenti, dichiarazione del medico in urgenza).
Le **deleghe per il ritiro** — **Ritiro esami**, **Ritiro referto RX**, **Ritiro cartella e CD**
— non sono consensi: si danno a chi va a casa, e stanno in cima alla schermata **Dimissioni**.
Un tocco apre direttamente il dialogo di stampa, come per la lista esami (con la stampa
automatica va dritto all'A4, senza dialogo); un modulo di più pagine
dice **quanta carta esce** prima che tu prema Stampa. (Che i moduli stanno dentro l'estensione e che non
esce nessuna richiesta è nel passaggio del mouse sul titolo dell'elenco, non in un paragrafo.)

I file stanno nella cartella `extension/consensi/`: **niente rete, niente server**. Si aprono anche
se il gestionale è lento o giù, e per stamparli non esce una singola richiesta dal computer (è un
controllo del collaudo). Col preferito (bookmarklet) la sezione c'è ma i PDF no: quelli vivono
nell'estensione.

### Nomi che il pannello non conosce
Le sigle (`Emoglobina` → `Hb`) sono un elenco scritto a mano: fuori da quell'elenco
un'abbreviazione sarebbe **un'ipotesi**, e un'ipotesi che sembra una sigla nota è il modo in cui
si legge l'analita sbagliato. Quindi:

- **due esami che si abbrevierebbero uguale** nello stesso prelievo (`PTT secondi` e `PTT Ratio`,
  `Granulociti` e `Granulociti %`) vengono **scritti per esteso tutti e due**: due righe con la
  stessa etichetta sono peggio di un nome sconosciuto;
- il **campione fa parte del nome**: siero, plasma e sangue non aggiungono niente (`S-ALT` → `ALT`),
  ma ogni altro campione resta scritto nella sigla (`U-Emoglobina` → **`U·Hb`**, `Lcr-Glucosio` →
  `LCR·Glu`). L'emoglobina delle urine non diventerà mai `Hb`;
- un nome fuori elenco è **scritto per esteso** e **sottolineato a puntini**, mai abbreviato a caso;
- in cima compare una riga ambra: *«2 nomi non in elenco: scritti per esteso · 1 riga non letta»*,
  e **quali** apre l'elenco esatto, con nome e valore di quello che non è stato letto;
- una riga che il lettore rifiuta (niente data, niente range, niente stato: di solito è
  un'intestazione) **non sparisce**: viene contata e mostrata lì dentro. Se è un esame vero lo vedi
  e apri la finestra nativa. Lo stesso vale nello Storico per una riga che non sta in colonna
  (meno celle dell'intestazione): non viene indovinata, viene dichiarata.

Vale sia per i valori di un prelievo sia per la tabella dello Storico.

### Da dove viene la tabella (scheda clinica e portale)
Il gestionale ha una pagina che mette **tutti i prelievi affiancati**: dal paziente, a sinistra,
**Storico dati clinici › Tabella**. Il pannello **la legge da lì** — non chiede niente al server,
nemmeno una richiesta in più: legge la tabella che hai già davanti.

- Aprendo quella pagina compare in basso una striscia: *«90 esami · 4 prelievi letti — COGNOME
  NOME»*. Se sposti le colonne o cambi il periodo, **↻ Rileggi** aggiunge i prelievi nuovi a
  quelli già letti (non li sostituisce).
- **Non serve aprirla a mano: ⭳ Carica i valori lo fa da sé.** Il pannello prende il link
  «Storico Dati Clinici» **di questa pagina** — mai un indirizzo costruito, mai una richiesta
  diretta al portale — e l'estensione lo apre in una **scheda di sottofondo**, accanto, senza
  toglierti la vista. Lì la tabella si legge come quando la apri tu; se il portale la tiene
  dietro la voce **Tabella**, la si apre con un clic nell'interfaccia, come faresti tu (solo nelle
  schede aperte così). Il portale disegna **solo le colonne in vista** (quattro prelievi alla
  volta): nella scheda di sottofondo la tabella si **scorre da un capo all'altro**, a passi, come
  faresti tu, e ogni passo aggiunge i prelievi nuovi — così arrivano tutti, non i primi quattro.
  Arrivata la tabella, la scheda **si chiude da sola** — se ci sei andato
  sopra, resta tua. Per chi è lo sa la scheda stessa: la apre il pannello di quel paziente.
  La scheda del portale che hai aperto tu non si tocca. Se in 30 secondi la tabella non arriva
  (il portale chiede di entrare, si apre altrove, mostra un altro paziente) il pannello **dice
  perché** e il link a mano resta. Nessun permesso nuovo per l'estensione.
- **La scheda clinica si fonde, non si sovrascrive.** Il portale, le finestre Risultati e i
  referti letti scrivono nella stessa scheda del paziente: ognuno rilegge quello che c'è, fonde e
  riscrive dicendo da quale revisione è partito — se nel frattempo un altro ha scritto, rilegge e
  rifonde. Prima l'ultimo a scrivere cancellava gli altri: la tabella del portale arrivata dopo i
  Risultati si portava via i prelievi letti e i referti salvati.
- **Lo stesso esame scritto in due modi è una riga sola.** Il portale scrive «S-Sodio», la
  finestra Risultati «Sodio»: erano due righe, e mezza chimica compariva due volte. Il prefisso del
  campione (S-, P-, B-) non fa l'identità quando il resto è un nome noto; U- (urine) resta a
  parte, «S-100» e «B-12» restano interi, pCO₂ = pCO2. Due nomi diversi che nello stesso prelievo
  si contraddicono (S-Sodio e P-Sodio) non si coprono mai. «PTT Ratio» ha una sigla sua (PTTr),
  e «cK+» dell'emogas è potassio, non CPK.
- **Lo stesso esame chiesto due volte è una riga sola.** Con «EMOCROMO» e «EMOCROMO CON FORMULA»
  nella stessa richiesta il portale dà ogni analita due volte, coi valori uguali e a volte col nome
  scritto in due modi («MCH Cont. Medio Hgb», «… Media Hgb»): in tabella erano doppioni. Due righe
  della stessa sezione con la stessa sigla diventano una se dicono la stessa cosa — tutte e due
  assolute o tutte e due percentuali, almeno un prelievo in comune, lo stesso valore in ognuno
  («131» e «131.0» sono lo stesso numero). Un solo valore diverso, e restano due. E le **colonne
  vanno sempre in ordine di tempo**, anche quando il portale le dà dalla più recente: prima
  «ultimo» poteva finire sul prelievo più vecchio.
- **L'emogas resta diviso dal laboratorio.** Hb, Ht, K, Na, Cl, Ca++, glucosio e lattato fatti
  dall'**EGA** non sono quelli dell'emocromo o della chimica: stanno nella sezione **Emogas**, su
  righe loro, accanto a pH e gas — mai nella riga dell'Hb dell'emocromo o del K del laboratorio.
  Lo decide l'**esame** che li ha prodotti (EGA venosa/arteriosa, emogasanalisi), non il nome: anche
  quando il nome è identico («Emoglobina», «B-Potassio»). Nella finestra Risultati di una richiesta
  con emocromo **e** EGA insieme (il Base PS) lo dicono i nomi dell'emogasanalizzatore (cK+, cNa+,
  ctHb, Hctc, cGlu, cLac…). Una tabella salvata prima, con righe miste, si divide da sola alla
  prima lettura.
- Tornando sul paziente, quei prelievi entrano **da soli** nella tabella **Valori** di **Esiti**,
  uniti a quelli letti dalla finestra Risultati del gestionale — niente riga da aprire, niente
  schermata a parte (vedi sopra come si legge la tabella).
- Gli esami sono **divisi in sezioni** e dentro ogni sezione l'ordine è **fisso**: *Emocromo,
  Coagulazione, Biochim* (PCR, PCT, VES, troponina, NT-proBNP, CPK, CK-MB, mioglobina, LDH),
  *Organi, Elettroliti e metabolismo, Emogas, Urine e altri liquidi*, e in fondo **Altri**. Prima l'ordine era quello in cui il laboratorio aveva stampato
  la tabella, e **cambiava da un prelievo all'altro**: lo stesso esame andava cercato ogni volta.
  Un analita che il programma non conosce non si perde: finisce in **Altri**, scritto per esteso.
  Il campione decide per primo — **`U-Emoglobina` va in Urine, mai nell'emocromo**.
- Nella tabella del portale la colonna di sinistra è la **prestazione ordinata** (`ESAME URINE
  COMPLETO`) e quella accanto è l'**analita** (`U-Albumina`, `U-Corpi chetonici`): il pannello legge
  l'analita, altrimenti un pannello di urine diventerebbe diciotto righe con lo stesso nome. Il
  prefisso del campione resta: **`U-Emoglobina` non è l'emoglobina del sangue**, e non viene mai
  fusa con essa.
- **La tabella si vede solo sotto il paziente giusto**, e la prova migliore è la più semplice:
  **il portale lo apri da un link sulla pagina del paziente**. Quel clic dice per chi lo stai
  aprendo, quindi la tabella letta di là si attacca a quell'**episodio** — nessun confronto di
  nomi può essere più sicuro, e non costa una richiesta. Se sei arrivato al portale per un'altra
  strada (un preferito, un'altra scheda), si ricade sulle prove più deboli: SA4PSO scrive il nome
  come una stringa sola (`ROSSI MARIO`), il portale lo dà già separato (`Cognome` + `Nome`), da lì
  l'ordine delle due parole non si deduce, quindi entrambi gli ordini vanno accettati — e con nomi
  di due parole uno scambio resterebbe indistinguibile. Allora, quando c'è, decide il
  **codice fiscale**: il portale lo scrive nel titolo della pagina, il gestionale accanto al nome
  nella finestra Risultati che il pannello legge già per i valori. Ne viaggia solo l'**impronta**,
  mai il codice in chiaro. Le due prove non possono contraddirsi: un codice che combacia accanto a
  un nome che non ha niente in comune fa **rifiutare** la tabella. Se il codice manca da un lato si
  torna al confronto sui nomi. In fondo alla tabella c'è scritto **per chi è stata letta** e **su
  cosa è stata verificata**, così un dubbio si vede invece di restare nascosto. Le due metà della tabella del portale (nomi a sinistra, valori a destra) devono
  combaciare riga per riga: se non combaciano non legge niente, invece di rischiare di attribuire
  un valore all'esame sbagliato.
- Vale solo con l'**estensione** (è lei a portare la tabella da una pagina all'altra), i valori
  stanno **in memoria e non su disco**, scadono dopo 2 ore e spariscono chiudendo il browser.
  Il logout li cancella con tutto il resto.
- Sul portale l'estensione entra **solo nella sezione che contiene quella tabella**
  (`/clin-port/*`) e lì fa una cosa sola: leggerla. **Se l'indirizzo del portale
  è un altro** — un altro IP, un'altra sede — lo aggiungi tu: nel pannello, negli
  Esiti, «Aggiungi l'indirizzo del portale» apre una pagina di impostazioni dove
  incolli l'indirizzo e Chrome chiede il permesso **per quel sito soltanto**.
  Il permesso si chiede da lì e non dal pannello perché Chrome pretende un gesto
  dell'utente, e un gesto non sopravvive al passaggio verso il service worker. Il percorso era ristretto a
  `/clin-port/info-cliniche/*`, ma il portale è una single-page application e
  quel pezzo di indirizzo può stare **dopo il cancelletto**, dove le regole di
  Chrome non guardano: l'estensione non partiva affatto. Se la tabella non
  compare entro sei secondi ora te lo **dice** con una striscia, invece di
  restare muta — «non si vede niente» e «non sto girando» erano indistinguibili. Su qualsiasi altra pagina di
  quel portale — compresa la sua schermata di accesso — **non fa assolutamente niente**, perché
  è un'altra applicazione e le regole scritte per SA4PSO non le si applicano.
- **Una scheda per paziente, da tutt'e due le finestre.** Ogni tabella letta diventa la scheda
  clinica di quel paziente: se non c'era viene creata (la striscia lo dice: *«…— ROSSI MARIO, nuovo
  · 3 pazienti in memoria»*), se c'era i prelievi nuovi si aggiungono ai suoi. E non solo dal
  portale: **ogni prelievo che il pannello legge dalla finestra Risultati del gestionale entra
  nella stessa scheda**, parziali compresi — un valore che il laboratorio non ha finito è in
  *corsivo* e la tabella lo spiega. Lo stesso analita letto dalle due finestre resta **una riga
  sola**.
- Sul paziente aperto il pannello mostra **solo la sua** scheda. Prima di tutto vale il **clic**:
  la tabella letta sul portale aperto **dalla pagina di questo paziente** è sua — ma solo se di là
  c'è **lo stesso nome**, perché il portale cambia paziente senza ricaricare la pagina e la tabella
  di un altro non deve portarsi dietro l'episodio da cui si era partiti (la striscia lo dice:
  *«non è BIANCHI ANNA, da cui l'hai aperta»*). Poi il **codice fiscale** quando c'è: se in
  archivio esiste una scheda con quel codice fiscale è quella, sempre — si ripiega sul nome solo
  se nessuna scheda porta un codice, altrimenti un omonimo senza codice potrebbe vincere su una
  verificata. Le altre schede non attraversano nemmeno il ponte.
- Le schede stanno nella memoria dell'estensione (**su disco**), **sopravvivono alla chiusura del
  browser e al logout** — un turno è di dodici ore e i pazienti sono più di dodici — e **scadono da
  sole 24 ore** dopo l'ultima lettura. Su un PC condiviso: profilo Chrome tuo, e chiudi a fine turno.
- Il portale si apre in un'altra scheda: **non serve ricaricare** la pagina del paziente, basta
  tornarci sopra. Nel **banco di prova** il giro c'è tutto (link «Storico Dati Clinici» in basso a
  sinistra), su una tabella ricostruita con esami inventati.

### Dimissioni
In cima, **una riga sola con quello che è ancora aperto**, solo quando c'è qualcosa:
`Aperti: Troponina ultrasensibile (14:30) · RX torace non refertato (13:05) · promemoria «ricontrollare K» · letto alle 15:10`
— esami in attesa con l'ora della richiesta, referti non arrivati o arrivati e non visti,
promemoria, valori segnati da te o nuovi fuori range non ancora letti. Non blocca niente, dice di
quando è la lettura, e copre quello che il pannello sa (la pagina del paziente e gli ordini partiti
da qui: «ordinati da qui» se la pagina non è stata letta).

Poi i **moduli per il ritiro** da dare a chi va a casa — Ritiro esami, Ritiro referto RX,
Ritiro cartella e CD: un tocco e parte la stampa, come per i consensi.

Poi nove **fogli di dimissione** pronti — i **cinque rivisti dal medico** stanno in cima, poi una riga
(*«non ancora rivisti»*) e sotto gli altri: si vede a colpo d'occhio dove si è già messo mano.
Sono scritti per il paziente: dosi per esteso, tetto del paracetamolo, e in fondo a ogni
foglio i motivi per **tornare in Pronto Soccorso**.

- L'elenco mostra **solo la patologia**, mai il testo: al momento della dimissione sai già quale ti
  serve, e leggerlo qui costerebbe solo uno scroll.
- **Un tocco sulla riga copia tutto il foglio** negli appunti, pronto da incollare nel verbale. Il
  bersaglio è la riga intera, non un'icona da 13 px.
- **+ Nuovo foglio di dimissione**, in fondo all'elenco: un nome (*Lombalgia acuta*) e il testo, ✓ Salva.
  I **fogli tuoi** stanno in cima, col segno *tuo*; si copiano come gli altri, ✎ li riscrive o li
  rinomina, ✕ Elimina li toglie (chiede conferma). Due fogli con lo stesso nome non si possono
  avere: nell'elenco non si distinguerebbero. Come tutti i fogli sono **modelli**, senza dati del
  paziente, e restano su questo computer (**Esporta i fogli (JSON)**, nel menu **⋯**, per portarli su un altro).
- **✎** apre il testo in grande e lo riscrive **per le volte successive**: le modifiche restano su
  quel computer (`localStorage`) — **sopravvivono al logout, alla chiusura del browser e agli
  aggiornamenti del programma**, perché sono tue e non dati di un paziente. Non finiscono nel
  repository e non escono dal computer. Il foglio modificato porta un
  **pallino azzurro** nell'elenco.
- Quello che scrivi è **salvato come bozza a ogni tasto**: se cambi schermata, se il gestionale
  ricarica la pagina o se ti chiamano, al ritorno il testo ti aspetta dov'era.
- Il **copia negli appunti** ha un ripiego (`execCommand`) per le pagine servite in `http://`,
  dove `navigator.clipboard` non esiste: vale per tutti i pulsanti «copia» del pannello.
- Per un foglio **su misura per questo paziente**: modifica e usa **⧉ Copia** *senza salvare*. Nei
  modelli non vanno dati del paziente — e infatti la pulizia al logout li lascia stare, perché sono
  modelli, non dati clinici.
- **↺ Originale** chiede conferma prima di buttare il tuo testo. Se una nuova versione del
  programma corregge un foglio che tu avevi modificato, quel foglio si marca **⟳** e l'editor te lo
  dice: una correzione di dosaggio non può restare invisibile a chi ha personalizzato il testo.
- **Esporta i fogli (JSON)** — nel menu **⋯**, solo in Dimissioni — salva i tuoi testi in un file (e negli appunti);
  **Importa i fogli…** li rimette da una
  schermata dove incolli il JSON — entrano **solo i testi diversi dagli originali**, così un
  ripristino non congela per sempre gli altri sette.

### Il pannello sull'iPhone (Ponte)

Lontano dal PC per qualche minuto, dal telefono: **i pazienti**, **gli esiti** di uno (con
**↻ Aggiorna i valori** e l'ora in cui il PC li ha letti), **un ordine** (lo stesso «Conferma e
stampa», con tutti i suoi controlli), **la nota** e **i promemoria**. Tutto succede sul PC, col
gestionale aperto e il codice di sempre: il telefono manda una domanda, una scheda del gestionale la
esegue e risponde. Passa da un ripetitore nel Worker di EKG Atlas (sul suo indirizzo `workers.dev`)
che non può leggere niente: cifrato da un capo all'altro, nessun dato su nessun server.

- **Una volta per turno**: ⋯ → **iPhone** → **Associa l'iPhone**, e si inquadra il QR con la
  fotocamera (accanto, un codice di sei cifre: lo stesso compare sul telefono). Vale 14 ore e per un
  telefono solo, il primo che entra; il QR si rivede solo nei primi due minuti. Regge il browser
  chiuso e riaperto; una scheda del gestionale alla pagina d'accesso chiude la sessione, non
  l'associazione. **Revoca l'iPhone** la chiude prima.
- **Ordinare dal telefono**: la conferma porta nome intero, età e posto («Ordino 2 esami per ROSSI
  MARIO · 77 anni · OBI 2? Tocca di nuovo»; due pazienti con lo stesso nome: «⚠ Ordino … per ROSSI
  MARIO · …9001 · …», col segno dell'elenco); un doppio tocco non conferma; se la rete perde
  la risposta il telefono dice «Non so se l'ordine è partito» e non lo rifà alla cieca (lo stesso
  ordine rimandato parte una volta sola), a meno che non lo veda già nato sul PC. Niente ordini su un episodio precedente o per un paziente
  dimesso sul PC. Un ordine finito male si vede da ogni pagina del telefono, finché non lo chiudi.
  Sul PC la striscia dice «dall'iPhone».
- **Si vede sul PC**: finché il telefono è collegato, ogni scheda mostra **«iPhone collegato ·
  Scollega»**, e ogni comando va nel **Registro**. Dopo **20 minuti senza comandi** del medico la
  sessione si chiude da sola; dal telefono si riapre con un tocco.
- **Prova la rete** (⋯ → iPhone): dal PC dell'ospedale, sulla presa vera del ponte, in pochi secondi
  dice se si raggiunge e quanto ci mette; «Tieni aperto 15 minuti» dice se e perché cade; il testo da
  copiare ha un blocco «Per l'IT».

Come funziona, la messa in servizio (l'indirizzo si fissa una volta in `ponte/host.txt`; il ponte va
col deploy del sito EKG Atlas), che cosa vede l'IT e che cosa
protegge e che cosa no: [`ponte/README.md`](ponte/README.md).

---

## Stampa etichette e lista esami

Dopo la **Conferma** (manuale o automatica) la stampa parte da sola, in sequenza, raggruppando
per stampante. **Mentre un PDF arriva non c'è niente davanti**: a che punto è lo dice la
striscia («Aspetto le etichette…», «Aspetto la lista esami…»; senza pannello, o col pannello
aperto, un riquadrino in alto a destra). **Arrivato il PDF compare la scheda**, com'era
prima: il PDF **in anteprima**, a vista — un'occhiata dice che è la richiesta giusta — e in
testa la **stampante su cui va** («→ etichettatrice», «→ stampante normale»); da quella scheda
si apre subito il **dialogo di stampa** del browser. Alla fine la striscia dice «Stampa finita ·
6 esami confermati 14:32» (con **Ristampa**), e **resta** finché non fai altro. Quando l'ordine
l'ha fatto la scheda di sottofondo (con l'estensione), tutto questo succede nella scheda del
gestionale **dove sei** — la finestra in primo piano —, e la scheda e la striscia dicono di chi
sono i fogli. Mai mentre scrivi; e sulla pagina di un **altro** paziente il dialogo non parte da
solo: «Etichette di ROSSI M. pronte · **Stampa**», un tocco. **Un ordine partito dall'iPhone non
apre mai da solo il dialogo**: davanti al PC può non esserci nessuno, e un dialogo aperto su uno
schermo che nessuno guarda è un'etichetta non stampata che sembra stampata. La striscia lo dice
(«Etichette NON stampate · dall'iPhone · tocca Stampa»), il telefono pure («aspettano qualcuno al
PC»), e un tocco su **Stampa** nella striscia del PC le stampa. Così è senza la **stampa automatica**; con lei
non c'è né la scheda né il dialogo: tutti i fogli li stampa il service worker, e la striscia
dice a che punto è (vedi «Stampa automatica», più sotto).

1. **Tutte le etichette provette** — i PDF dell'icona col codice a barre
   (`RcsStampaEtichetteLISHMIMU.do`, che porta al PDF servito da
   `uploaddownloadservlet.rra2`) → **etichettatrice**;
2. poi **tutte le liste esami** — i PDF di "Stampa Richiesta" (`jasperservlet`, URL sempre letto
   dalla pagina perché `BRANCA` cambia per riga) → **stampante normale**;
3. per la **radiologia**, la riga ha l'icona stampante "Stampa Prenotazione Esterna": si stampa
   quel PDF → **stampante normale**.

**Non serve una mano libera**: quando la finestra di stampa del browser si chiude, si **passa da
solo al documento dopo** — come se avessi premuto «→ Avanti»: la scheda si toglie finché quel
documento non arriva, poi torna con la sua anteprima — e dopo l'ultimo la scheda se ne va e la
striscia dice «Stampa finita · N esami confermati HH:MM». Come si sa che il dialogo si è chiuso: il
PDF lo stampa il visore di Chrome, che l'evento «afterprint» non lo manda a nessuno (in Chrome
vero si restava ad aspettare «→ Avanti»). Il dialogo, finché è aperto, **si prende il fuoco della
pagina**: fuoco perso dopo la stampa = dialogo aperto, fuoco tornato = chiuso, e si va avanti (lo
si guarda ogni ¼ di secondo; «afterprint», dove arriva, vale lo stesso). Solo se il fuoco c'era
quando la stampa è partita: con un'altra finestra davanti un dialogo non si distingue, e resta
«→ Avanti». Il browser non dice se hai stampato o annullato: si va avanti in tutt'e due i casi,
e per questo la fine dice «Stampa finita», mai «Stampato», con **Ristampa** accanto («Stampato»
lo dice la stampa automatica, che lo sa). Un dialogo che si
chiude all'istante (stampa non disponibile su quel PC) **non** fa saltare la coda: la scheda lo
dice, e **🖨 Stampa** lo riapre. Se la stampa l'hai annullata (Esc, ✕) o un documento non è
uscito, il resoconto resta lo stesso — la richiesta è confermata — con accanto un **Ristampa**
tranquillo che rifà etichette e lista.

**I comandi sono quelli di sempre**, nella scheda: 🖨 Stampa · → Avanti · ↗ Scheda · ✕ Chiudi.
Un documento che non si lascia catturare (un visualizzatore) ha al loro posto un grande
**↗ Apri e stampa** (poi Ctrl+P), con ⧉ Diagnosi; un PDF che non arriva lo dice in rosso. Un
tocco sulla striscia mostra la scheda anche mentre il PDF arriva; **Esc** o **✕** annullano la
stampa e fermano davvero la ricerca del PDF.

**Righe multiple**: quando gli esami di una richiesta appartengono a laboratori diversi (POC +
Urgenze, ecc.) il LIS la divide in **più righe** — stessa `RICHIESTA_ID`, `RICHIESTA_PROG` 1, 2… —
ognuna col suo PDF etichette e il suo foglio. Si stampano **tutte** ("Etichette — riga 1",
"Etichette — riga 2", poi le liste), mai solo l'ultima.

Sul campo, dopo la Conferma il gestionale **torna alla pagina del paziente**: è lì che la stampa
parte da sola (e se un'installazione mostrasse una pagina intermedia, parte lì se ha i link,
altrimenti aspetta il ritorno sul paziente). **Solo per le richieste di PS Assist**: quelle in cui
il pannello ha mandato esami (o che ha aperto lui), confermate dal pannello o col bottone del
gestionale. Una richiesta fatta tutta a mano nel gestionale, confermata col suo bottone, non
stampa niente da sola. Dalla pagina paziente puoi **ristampare qualsiasi richiesta** (sezione
**Stampa**: ogni richiesta è elencata con **data e ora** e, sotto, la **lista compatta degli
esami** che contiene) e, sopra l'elenco, **Stampa l'ultima richiesta**: la più recente, e con
lei quella di pochi minuti prima (laboratorio e radiologia dello stesso ordine), etichette
prima. Con la stampa automatica, senza dialogo.

**Laboratorio + radiologia insieme**: se confermi una richiesta di laboratorio e poi una di
radiologia prima di tornare alla pagina del paziente, la stampa parte **una volta sola** e in
sequenza: tutte le etichette → tutte le liste → la prenotazione RX.

### Stampa automatica: ogni foglio alla sua stampante, senza dialogo

Una pagina web non può scegliere la stampante né saltare il dialogo: è una barriera del
browser. Per questo c'è un piccolo **aiutante per Windows**, la cartella `stampa/` dello zip:
si installa **una volta, senza amministratore** (doppio clic su `installa.cmd`, tre passi in
[`stampa/README.md`](stampa/README.md)), e poi nel pannello, menu **⋯ → Stampanti**, si sceglie
quale stampante è l'**Etichettatrice** e quale l'**A4** (di partenza, la predefinita di
Windows), con **Stampa una pagina di prova** per ciascuna. Da lì:

- **le etichette vanno all'etichettatrice, tutto il resto all'A4** — liste esami, prenotazioni
  RX, i moduli dei Consensi —, da soli, **senza dialogo e senza niente davanti**: né la scheda
  della stampa né l'anteprima. Dopo una conferma, con «Ristampa», «Stampa l'ultima richiesta» o
  un consenso, la striscia dice «Stampo le etichette su Zebra ZD421… · foglio 1 di 2», poi
  com'è andata, con **Ristampa** accanto (un'etichetta inceppata si vede solo davanti alla
  stampante). **Puoi andare subito su un altro paziente**, o chiudere la scheda: la stampa la
  fa il service worker, coi PDF che gli dà una scheda aperta dietro sulla pagina del paziente
  (senza pannello; finito, si chiude), e nessun foglio si perde né esce due volte. È lo stesso
  motore dell'ordine in sottofondo (qui sotto), con le stesse parole.
- **Si dice solo quello che si sa.** L'aiutante, dopo aver mandato il foglio, guarda per qualche
  secondo la coda di stampa di Windows:
  - **«Stampato su Zebra ZD421»** (alla fine «Stampato · 6 esami confermati 14:32»): il foglio è
    uscito dalla coda senza errori — stampato, per quanto Windows può dire;
  - **«Mandato a Zebra ZD421»**, in ambra: finita l'attesa (10 secondi per un'etichetta, 4 per
    l'A4) è ancora nella coda; Windows l'ha preso, non si sa se è uscito;
  - **«Esito della stampa sconosciuto»**, con **Ristampa**: l'aiutante non ha risposto, il tempo
    è scaduto (lui ha 35 secondi, l'estensione ne aspetta 90), SumatraPDF è stato fermato a metà,
    o la stampante si è fermata in errore **mentre stampava**. Il foglio **può essere uscito**:
    non riparte mai da solo, né dal dialogo. Si controlla la stampante, e se non c'è, **Ristampa**.
- **Un foglio che non è partito passa dal dialogo di sempre, lui solo**, con una riga che dice
  perché («Stampa automatica non riuscita: la stampante «Zebra ZD421» risulta spenta o offline.
  Dal dialogo, stavolta.»). Solo per un no detto prima di stampare: aiutante non installato o
  bloccato, stampante sparita, spenta o offline (prima di stampare, o ferma in errore o in pausa
  nella coda prima di cominciare: il foglio si toglie), PDF non valido, SumatraPDF che dice di no. Gli altri
  fogli escono da soli; quello arriva, finiti loro, alla scheda dove sei — solo allora compare
  un'anteprima. Un esito sconosciuto non passa mai dal dialogo da solo.
- **Un ordine in sottofondo lo stampa il service worker**, appena la conferma è provata: non
  serve una scheda del gestionale davanti, né il fuoco, né un clic — l'ordine può arrivare dal
  telefono con il PC da solo, con il medico su un altro paziente o senza nessuna scheda del
  gestionale aperta. La scheda dell'ordine gli dà i PDF (letti dalla pagina, coi controlli di
  sempre); lui scrive nell'ordine, foglio per foglio, che cosa sta per mandare **prima** di
  mandarlo, e poi com'è andata. Intanto ogni scheda del gestionale lo racconta («Confermata ·
  Stampo le etichette su Zebra ZD421… · foglio 1 di 2», con ⏹), e alla fine dice **«Stampato su
  Zebra ZD421 e HP LaserJet · 2 esami confermati alle 14:32»** col nome del paziente,
  **Ristampa** (un tocco: si ristampa lì) e ✕; dopo due minuti un «Stampato» se ne va da solo
  (la Ristampa resta nella sezione **Stampa** del paziente). Una volta sola: ogni foglio parte una volta, e
  uno mandato da un service worker che poi è ripartito è «sconosciuto», mai rimandato. Se la
  scheda dell'ordine si ricarica o si chiude a metà, o premi ⏹, i fogli che restano non partono e
  l'ordine finisce **«Stampa interrotta»**, con **Ristampa** (la richiesta è confermata, e lo
  dice: mai «Scheda chiusa · controlla il carrello»); **Ristampa** rifà i fogli non usciti. Un foglio
  che non è partito per un no detto arriva alla scheda dove sei, come le etichette di prima, col
  motivo sulla striscia; per un ordine dal telefono aspetta un tocco su **Stampa** («Etichette NON
  stampate · la stampante «Zebra ZD421» risulta spenta o offline»). Uscite, la striscia di un ordine dal telefono aggiunge
  «avvisa chi preleva».
- **La striscia è una sola**, e dice la cosa più seria, fra due pari la più nuova: un errore, un
  avviso da leggere, le etichette pronte qui, l'ordine che gira, la coda, le etichette di un
  ordine dal telefono (aspettano un tocco, ma non coprono il resto), e per ultimo un «Stampato».
  Un ordine finito bene non copre mai quello che è venuto dopo.
- **Si vede che è accesa**: in intestazione, accanto al menu **⋯**, una stampantina; passandoci
  sopra, «Stampa automatica attiva: etichette su Zebra ZD421, A4 su HP LaserJet». Diventa
  **rossa** se l'ultimo foglio non è uscito o ha un esito sconosciuto, e lo dice; con accanto
  **«non installata»** se l'aiutante non c'è più (lo si chiede all'aiutante al più ogni mezz'ora,
  aprendo il pannello). Un tocco apre le Stampanti.
- **Le etichette dritte**: SumatraPDF gira di 90° le pagine più larghe che alte, e coi driver
  Zebra, ZDesigner, TSC e Citizen l'etichetta uscirebbe di traverso. Nelle Stampanti,
  «Etichette più larghe che alte: non girarle / girale di 90°» (di partenza «non girarle» per
  quei nomi). La pagina di prova delle etichette ha la misura di un'etichetta. **Prima di usarla
  sui pazienti**, ristampa un'etichetta vera e leggi il suo codice a barre col lettore del
  laboratorio.
- **Si spegne con un tocco**: menu **⋯ → Stampa automatica: attiva · Spegni** (e «spenta ·
  Accendi»), o l'interruttore nella pagina Stampanti. Spenta, tutto torna esattamente com'era:
  il dialogo, «Stampa finita». Senza aiutante, o col preferito (bookmarklet), lo stesso.
- **In Windows non resta acceso niente.** Nessun programma che gira, nessuna icona: Chrome avvia
  l'aiutante solo per il secondo in cui stampa un foglio, e l'aiutante esce appena ha risposto.
  Non c'è niente da chiudere; per spegnere la stampa automatica c'è l'interruttore.

### Si può scegliere la stampante senza l'aiutante?

No: nessuna pagina web può impostare la destinazione di stampa. Senza la stampa automatica,
quello che si può fare senza essere amministratori:

- Chrome **ricorda l'ultima stampante usata**, quindi la stampa raggruppa i documenti per
  destinazione (tutte le etichette, poi tutte le liste): al massimo **due cambi per paziente**,
  non uno per foglio.
- **Collegamento con `--kiosk-printing`** (si crea senza admin: tasto destro sull'icona di Chrome
  → Proprietà → aggiungi `--kiosk-printing --user-data-dir="%LOCALAPPDATA%\\ChromeEtichette"`).
  Da quella finestra Chrome stampa **senza dialogo** sulla stampante predefinita di Windows di
  quel profilo. Ha senso solo se quella finestra la usi per le sole etichette — la lista la
  stamperesti da una finestra normale. Fragile: è il ripiego se l'IT blocca l'aiutante.
- Se le liste su carta non ti servono, annulla il secondo dialogo: resta **un solo**
  dialogo per paziente.

---

## Come vengono letti i valori (e cosa fa quando non capisce)

I valori arrivano dall'**HTML** della finestra «Visualizza Risultati», non dal PDF del referto:
la pagina è una tabella dell'applicazione e si legge riga per riga — esame, valore, unità, range,
stato, data — prendendo **solo le celle figlie dirette** della riga (l'intestazione del paziente
sta nella stessa tabella, dentro tabelle annidate, e altrimenti finirebbe tra i risultati). Una
riga è un risultato se lo dimostra: ha una **data di refertazione**, oppure un **range numerico**,
oppure uno **stato** di laboratorio. Il resto viene scartato.

Il giudizio «fuori range» capisce i modi in cui i laboratori scrivono i limiti: `13 - 17`,
`7,35 – 7,45`, `4 - 10 x10^3`, `-2 - +2`, `< 0.5`, `> 60`, `fino a 5`, `inf./sup. a`, e i valori
con modificatore (`<0.01`, `>1000`) o a parole (`NEGATIVO`, `Assente`). Quando **non** capisce —
un range che dipende dal sesso, un formato mai visto, due range nella stessa cella — non inventa:
**non segna nulla** e mostra il valore in nero. È una scelta: meglio un fuori range non evidenziato
che un rosso che non sappiamo giustificare.

Un esame sconosciuto non sparisce mai: se non ha una sigla nota viene scritto **per esteso**,
sottolineato a puntini — mai abbreviato a caso.

**Quando il laboratorio referta**, il gestionale toglie la finestra Risultati e quei valori
sparirebbero con lei. I prelievi già letti in quella scheda **restano nella tabella dei Valori**,
come una colonna in più: sono ciò che il pannello aveva realmente sotto gli occhi, e non vengono
mai attaccati a un referto (niente li collega). Il referto in PDF resta lì accanto, come sempre.

> Il PDF del referto **di laboratorio** non viene letto: quello disegna il testo un glifo alla volta
> con un font ridotto e **senza mappa dei caratteri**, quindi ricavarne «Emoglobina 8.0 g/dL»
> significherebbe indovinare. Gli stessi valori sono già in HTML nella finestra Risultati, ed è da lì
> che si leggono. I referti di **radiologia ed ECG** sono l'opposto — hanno font e mappa veri — e
> infatti quelli il pannello li legge e te li mostra come testo.

---

## Dove finiscono referti e valori

- **Valori** (i prelievi in tabella): letti da `RcsAccessiRisultatiElenco.do`, HTML sullo stesso
  server. Restano in memoria **per la scheda e per quell'episodio**, così la tabella si
  ricostruisce all'istante; **↻ Aggiorna** li rilegge tutti, uno alla volta, man mano che il
  laboratorio completa. Chiusa la scheda, spariscono.
- **Referti** (righe LIS/RIS/AMB): il visualizzatore **non è su SA4PSO** — gira su un altro host
  interno e mostra il PDF come `blob:` di quell'origine, quindi una pagina di SA4PSO non può
  leggerlo. È il **service worker** dell'estensione a seguire la catena (redirect → visualizzatore
  → suo endpoint PDF) e a salvare i byte nella memoria dell'estensione, su questa macchina.
  Solo con l'**estensione**: il bookmarklet non può farlo. Se un referto non è
  salvabile resta senza pallino e il **motivo** compare passandoci sopra col mouse (e nel Registro).
  Scadono in **8 ore**, massimo 25, e si azzerano alla chiusura del browser; **↻ Resetta** subito.

> **Da configurare una volta**: l'host del visualizzatore è dichiarato in
> `extension/manifest.json` → `host_permissions` (oggi `http://10.11.0.151:9080/*`). Se nella tua
> sede è un altro indirizzo, cambialo lì e ricarica l'estensione.

---

## Banco di prova (provare senza ospedale)

Una pagina sola con dentro **le schermate vere del gestionale** e sopra **il
pannello vero** — la stessa build dell'estensione. Serve per provare e far
crescere l'interfaccia da casa, senza accesso a SA4PSO.

- **Online**: il link del banco di prova (nel messaggio di consegna), da qualsiasi browser.
- **Offline**: `dist/demo.html` è dentro lo zip — doppio click, funziona senza rete.

### Cosa c'è dentro

Le pagine sono quelle salvate dal gestionale — struttura, classi, foglio di
stile e icone originali — con **tutto il contenuto sostituito da dati
inventati** (vedi `esempi-gestionale/README.md`: gli originali erano cartelle
cliniche complete e non stanno in questo repository). Si passa dall'una all'altra
come nel programma: lista PS → scheda paziente → nuova richiesta → catalogo
esami → conferma → stampa; e sulla seconda scheda, risultati e referti.

### Cosa funziona

Il flusso completo dell'ordine: quesito, profili, esami, «Conferma e stampa» (o «solo carrello») con
la verifica esame per esame, il carrello che compare **nella pagina vera**, la
Conferma nativa, la stampa (qui senza dialogo del browser: la scheda mostra il PDF
e la stampante su cui va). E gli **Esiti**: i valori letti dalla
finestra Risultati vera, i referti salvati e riaperti. Anche la tabella **Valori**:
«Storico Dati Clinici» ricostruisce, sull'altra scheda, una tabella multi-prelievo
dalla sua forma (`test/fixtures/storico.mjs`, esami inventati: di quella pagina non
esiste una copia salvata qui); tornando sul paziente il pannello la ritrova già
unita ai suoi Esiti.

Di proposito **non** funziona il resto: gli script del gestionale sono rimossi
(schede e menu interni non si aprono), le schermate mai salvate mostrano una
pagina di cortesia invece di un errore, la stampa mostra il PDF ma non apre il
dialogo, e i PDF sono fogli vuoti.

### Niente esce dalla pagina

Non è una promessa, è una barriera: le richieste allo stesso indirizzo le serve
il simulatore in memoria, **tutto il resto viene rifiutato** — qualsiasi host,
XHR, WebSocket, EventSource, beacon — e nel file offline lo impone anche una
`Content-Security-Policy` che vieta al browser di raggiungere qualunque host.
La suite conta le richieste di rete di un'intera sessione: **una sola, la pagina
stessa**.

Nel pannello vero la regola è la stessa, con **una sola eccezione, esplicita**:
il Ponte verso l'iPhone. È spento finché la build non ha il suo indirizzo
(`ponte/host.txt`) e il medico non associa il telefono; parla con un host solo
(il sito del ponte, `wss://…/ponte/ws`, fissato nella build); e
quello che passa è cifrato da un capo all'altro, illeggibile anche per quel sito
(vedi [`ponte/README.md`](ponte/README.md)). Nel banco di prova il Ponte non c'è.

### Perché non invecchia

`dist/demo.html` è **generato** da `extension/content.js` (il pannello che si
installa) e da `esempi-gestionale/` (le pagine): `npm run demo` e ogni
`npm run dist` lo riallineano da soli, e la barra nera stampa quale build stai
provando. Una suite dedicata (`node test/demo.mjs`) ripercorre nel banco gli
stessi flussi dei test di prodotto.

> Il pannello, fuori dall'host dell'ospedale, accetta i ganci del banco
> (navigazione, schede, stampa); **su `smarthealth.multimedica.it` quei ganci non
> esistono nemmeno**, quindi nulla servito dal gestionale può dirottarlo.

---

## Perché è robusto (regole di sicurezza nel codice)

1. **Mai doppi ordini**: l'URL di inserimento di un esame viene richiesto **al massimo una volta**.
   La verifica rilegge l'elenco "pulito" (senza parametri di inserimento); se dopo 5 verifiche
   (circa 19 secondi: un gestionale carico mostra l'esame anche dopo 5–10) l'esame non compare, il motore **si ferma** e ti dice esattamente cosa controllare.
   Vale anche **fra una corsa e l'altra**: partendo da una pagina esami il motore **rilegge
   l'elenco dal server** invece di fidarsi di quello che hai sullo schermo. Gli inserimenti
   viaggiano in background, quindi dopo una corsa interrotta la pagina mostra ancora il carrello
   di prima — fidarsene voleva dire leggere «non c'è» un esame che c'era già, e ordinarlo una
   seconda volta. Costa una richiesta, e da quella rilettura arrivano anche i controlli di
   sessione ed episodio che quella strada saltava. C'è un test che lo prova.
   **Il giro riprende, gli invii no.** Ogni passo è annotato nella scheda del browser: che cosa
   è già in carrello, che cosa era **in volo**, che cosa resta. Se la pagina cambia, il giro
   riparte da lì. Quello che era in volo si **cerca** — fino a 3 riletture, col proprio codice,
   col nome identico o con lo stesso mnemonico LIS, **mai** per somiglianza (o «POTASSIO» si
   riconoscerebbe in «POTASSIO URINARIO») — e non si rimanda: se non si trova, stop e messaggio.
   Resta «in volo» finché non lo si ritrova, anche attraverso più interruzioni di fila: non
   scivola mai fra i «già fatti», o un esame mai partito passerebbe per uno tolto a mano e
   sparirebbe in silenzio. Quello che era già entrato si ricontrolla, e se nel frattempo
   qualcuno l'ha tolto dal carrello **non** viene rimesso.
   L'appunto vale 10 minuti e al massimo 12 riprese (il conto si scrive prima di ripartire, così
   vale anche se la ripresa muore subito), muore con la scheda del browser e con il «fine
   turno», e non parte mai da solo dopo uno STOP o un errore che ha già fermato il giro.
   **Una sola scheda alla volta.** Duplicando la scheda, Chrome ne copia anche l'appunto: due
   motori sullo stesso carrello vorrebbe dire due volte lo stesso esame. C'è un **presidio** in
   memoria condivisa — chi ci sta lavorando, su quale richiesta, da quando — che si molla quando
   la pagina se ne va e scade da solo in 25 secondi: la seconda scheda non manda niente e lo
   dice. Il presidio si ricontrolla **prima di ogni invio**, non solo alla partenza.
   **Niente sparisce zitto.** Un giro che nessuno riprenderà — scheda chiusa, browser caduto,
   sessione scaduta — lascia un segno in memoria condivisa: la prima pagina utile dice «un giro
   su X è rimasto a metà: 2 esami non sono stati mandati, 1 è da controllare» (quello in volo non
   è mai «non mandato»). Sulla pagina di login, dove il pannello non nasce nemmeno, compare una
   striscia rossa che lo dice **senza il nome**, perché quella pagina la può avere davanti
   chiunque — e conta gli ordini in sottofondo ancora aperti, che non si buttano via. Se la memoria del browser è piena e l'appunto
   non si riesce a scrivere, il pannello non promette una ripresa che non ci sarà: lo scrive nel
   Registro e il giro torna a comportarsi come prima.
   **Un esame può entrare in carrello con un numero diverso dal suo**: le prestazioni a
   riflesso (BILIRUBINA TOTALE REFLEX) ci mettono l'esame che ne deriva. Il motore fotografa il
   carrello *prima* dell'invio e guarda quale riga è comparsa *dopo*: vale solo se porta il
   **nome** di quello che hai scelto — stesso nome, stesso mnemonico LIS, o l'uno dentro
   l'altro parola per parola. Una riga estranea non conta e il motore si ferma lo stesso.
   E se il server risponde all'inserimento con **una pagina che non è l'elenco**, l'esame è
   entrato lo stesso: si rilegge il carrello (mai un secondo invio) invece di fermarsi al buio.
   **Dopo uno stop si finisce a mano.** La scheda va sul carrello della richiesta — una semplice
   lettura dell'elenco, quello che il gestionale stesso mostra, sul laboratorio del primo esame
   rimasto fuori (stessa richiesta, cambia solo `RISORSA_ID`) — senza inviare né confermare
   niente, e il giro non riparte. La striscia separa **«Mancano»** (mai partiti: da aggiungere)
   da **«Da controllare»** (mandati e non visti in carrello: da guardare, mai da rimandare). Non
   ci va dopo un episodio che non torna, una sessione scaduta o un'altra scheda al lavoro (lì
   resta la striscia rossa), né se il giro ripreso ti ha trovato sulla pagina di un altro
   paziente.
   **Riparte solo quello che manca.** «↻ Riprova i mancanti» c'è soltanto
   sul carrello di quella stessa richiesta (o, se la richiesta non era nata, sulla pagina del
   paziente: lì è un giro nuovo e normale). È un giro dalla pagina esami, quindi il carrello si
   rilegge dal server; quelli già entrati vanno con lui **solo da cercare** — come l'«in volo»
   di una ripresa: mai un secondo invio, e se qualcuno li ha tolti non si rimettono — e i «da
   controllare» non ci sono proprio. Il motore controlla che l'elenco riletto sia di **quella**
   richiesta (`RICHIESTA_ID`): se no, stop prima di qualunque invio. E ogni rilettura di
   verifica vale solo se è l'elenco di quella richiesta e di quella risorsa: un altro elenco
   non dice niente del nostro carrello — si conta il tentativo, lo si scrive nel Registro, e
   la rilettura dopo torna sul nostro (prima, quell'elenco diventava il modello e da lì
   partivano anche le riletture seguenti).
   **Una volta per ordine lo fa da solo**, e solo dopo un elenco venuto male, con esami mai
   partiti e niente «da controllare»: è questo stesso «Riprova» (dal carrello riletto), mai un
   secondo invio — e se si ferma ancora, decide il medico.
   **Svuotare il carrello lo fa il gestionale, e si dimostra.** «Svuota il carrello e
   ricomincia» c'è solo sul carrello di quella richiesta, con due tocchi. Si segue il link
   «Svuota carrello» della pagina (`Delete=Elimina`, `MVPG=RcsRichiestaCarrelloSvuota`, **senza**
   `PRESTAZIONE` — per questo il lettore dell'elenco non lo scambia mai per un esame) solo se la
   sua `RICHIESTA_ID` e il suo `EPISODIO_ID` sono quelli della richiesta, e la `RISORSA_ID`
   quella della sezione; una sezione che non ce l'ha si toglie riga per riga coi suoi
   «Elimina» (con `PRESTAZIONE`). Mai una richiesta confermata (prima si legge la pagina del
   paziente, e il carrello deve avere ancora la sua Conferma), mai un'altra richiesta (ogni
   pagina riletta deve essere di quella `RICHIESTA_ID` e di quell'episodio), il presidio prima
   di ogni invio. **Svuotare non fa sparire niente**: prima di togliere qualunque cosa si legge
   il carrello vero, tutte le sezioni, e quello che c'è senza essere della selezione si rimette
   anche lui — per codice, col nome del catalogo, che dev'essere quello che la riga porta oggi
   (regola 4). Una riga che non si saprebbe rimettere ferma tutto lì, niente toccato. Poi ogni
   sezione si rilegge dal server: una riga rimasta, e niente si rimette — lo dice e si finisce a
   mano. La selezione rimessa è quella **di partenza**, non i numeri in cui il motore l'aveva
   tradotta (un esame a riflesso torna quello scelto, e la riga in cui è entrato non si rimette
   una seconda volta).
   **«Svuota» sulla riga di una richiesta da confermare** è lo stesso percorso, con niente da
   rimettere (e quindi nessuna riga «che non si saprebbe rimettere»): pagina del paziente,
   carrello vero, «Svuota carrello» del gestionale, ogni sezione riletta vuota; solo allora la
   richiesta esce dal promemoria. Gira nella scheda del medico, non in sottofondo (non c'è niente
   da mandare), e non si riprende: cambiando pagina a metà il browser avvisa. Finito, la pagina
   rilegge il carrello (l'elenco pulito, mai un indirizzo con `Delete`). Il suo **«Conferma e
   stampa»** è il clic nativo della regola 5, dopo una lettura del carrello che dice che cosa
   conferma.
   **Nessun salto di pagina sopra chi scrive.** Ogni navigazione decisa dal programma (errore
   → carrello, revisione → carrello, conferma sospesa o rifiutata dalla cornice) passa da un
   solo controllo: cursore in un campo del gestionale, un campo cambiato, un tasto premuto
   negli ultimi 15 secondi → non si va, la striscia dice «… · tocca per il carrello» e un tocco
   ci porta. Un salto deciso da un giro si spegne quando ne parte un altro (non porta via la
   pagina a «Riprova» o a «Svuota» toccati subito), e la scheda di un ordine dopo un errore non
   salta affatto: il resoconto viaggia con la striscia. Dopo una conferma non si ricarica niente:
   la prova si legge in sottofondo (regola 5).
2. **Mai il paziente sbagliato**: l'EPISODIO_ID viene fissato all'avvio e ogni pagina ricevuta è
   verificata **dal contenuto che il server dichiara** (non dall'URL richiesto); se manca o non
   corrisponde, stop prima di qualunque invio.
3. **Ogni sede ha i suoi numeri, non i suoi nomi**: gli identificativi di risorsa
   (`LABORATORIO ANALISI POC` è `00660001P` in una sede e un altro numero altrove) e perfino i
   codici delle prestazioni cambiano da presidio a presidio. Il pannello **non si fida dei numeri
   salvati**: se la risorsa scelta non è tra quelle della richiesta la cerca per **nome** (senza
   il suffisso di sede) e usa quella; se il codice di un esame non c'è, lo ritrova per **nome
   esatto** o per il **mnemonico** che il LIS stampa tra parentesi — `(POCT1502)`. Ogni traduzione
   finisce nel Registro, e il controllo del nome vivo resta comunque l'ultimo cancello prima di
   ogni invio. Se il nome non corrisponde a nulla si ferma e **dice cosa offre quella richiesta**,
   invece di un rifiuto muto.
   **Una riga che la pagina non mostra** (l'elenco a volte arriva monco: la riga c'è, ma non si
   vede) si **rilegge con la ricerca del gestionale**, UNA volta: lo stesso elenco con
   `s_PRESTAZIONE` compilato — è lo stato della ricerca, ogni link della pagina lo porta già — e
   una semplice GET. Si cerca il mnemonico LIS fra parentesi se il nome ne ha uno, se no il nome.
   La riga che compare passa per la strada **normale**: nome vivo controllato (regola 4), un
   invio solo, verifica sull'elenco intero. Se non compare, l'esame va fra i «Mancano» e non
   parte niente. Un indirizzo d'inserimento **non si costruisce mai** a mano: una riga che il
   gestionale nasconde apposta resta nascosta. Nel Registro: «riletto con la ricerca del
   gestionale». (Fino alla 3.46 un codice salvato costruiva il link da solo: poteva scavalcare
   il gestionale, e la sua verifica «stretta» non lo era. Tolto, coi suoi appunti.)
4. **Mai l'esame sbagliato**: prima di ogni invio il nome dell'esame sulla riga viva della pagina
   deve coincidere con quello selezionato — se l'ospedale rinumera un codice, il motore si ferma
   e lo dice, invece di ordinare un esame diverso con tutte le spie verdi. Vale anche per la riga
   ritrovata con la ricerca del gestionale (regola 3): ogni invio parte da una riga viva.
5. **La Conferma è sempre un click reale** sulla pagina visibile (il flusso di stampa etichette
   resta quello nativo), è opt-in e **immediata**: nessun conto alla rovescia, perché il tuo
   click su «Conferma e stampa» è già la decisione — ma scatta **solo** se il carrello coincide con la
   ricevuta di ciò che è stato appena aggiunto; ogni differenza la sospende con un messaggio.
   **La pagina della Conferma può essere invisibile.** Viene caricata davvero —
   stessa sessione, stesso modulo, stesso bottone — dentro una cornice nascosta
   invece che davanti agli occhi, e il clic è quello vero sul bottone del
   gestionale: i byte che partono sono gli stessi, perché a serializzare il
   modulo è il browser, non noi. La cornice gira **senza script**
   (`allow-forms allow-same-origin`, mai `allow-scripts` né
   `allow-top-navigation`), così il codice della pagina non può portarsi via la
   scheda del medico. Se il server **vieta di essere incorniciato**, il
   documento non è leggibile: il programma se ne accorge subito (la pagina
   d'errore della cornice non si lascia leggere) e torna alla pagina
   visibile, come prima. **La scheda di un ordine in sottofondo non usa la
   cornice**: è già lei la pagina che nessuno guarda, e va sul carrello vero a
   premere lì la Conferma (la strada della cornice vietata). Una cornice
   dentro una scheda nascosta Chrome la carica col contagocce, e scadeva prima
   che il server avesse finito: «Non confermata» per una richiesta confermata.
   Ogni intoppo — cornice rifiutata, controllo che dice
   di no, stato incerto — finisce sulla pagina vera col motivo scritto (la
   striscia ambra lo annuncia, un tocco lo apre), e la conferma resta al
   medico. C'è un test che prova che in quel caso la richiesta viene
   confermata **una volta sola**.
   **Confermata vuol dire provata.** Dopo il clic vale come prova solo una pagina dello stesso
   episodio che elenca i fogli da stampare di **quella** richiesta (`RICHIESTA_ID`). Un HTTP
   500, il carrello che ricompare, il tempo scaduto, la cornice sparita: «incerta». Allora si
   legge la pagina del paziente (GET, mai un invio) e, se non la elenca ancora, la si rilegge
   dopo 2, 4 e 8 secondi — il LIS può metterci un po' a registrarla: se la elenca, è
   confermata e i fogli si prendono da lì; se no la striscia è ambra, «Non confermata · tocca
   per il carrello», e nessuna seconda conferma parte da sola.
   **Ogni no dice perché.** Ogni controllo che ferma la conferma automatica scrive nel
   Registro quale è stato. Un carrello a cui manca una riga che deve avere (l'ultimo esame, o
   meno righe di quelle aggiunte su quella risorsa: l'elenco monco che la verifica
   dell'inserimento conosce già) si **ricarica** — dopo 2, 4 e 8 secondi, una lettura
   dell'elenco pulito — e i controlli ripartono da capo; solo dopo si sospende. Una riga in
   più, una ricevuta che manca, un'altra richiesta: si sospende subito.
   Se la pagina se ne va mentre la cornice lavora, la conferma automatica muore con lei. In ogni caso la richiesta resta annotata (solo
   numeri) finché una pagina del paziente non la mostra confermata: dopo 2 minuti la striscia
   lo dice.
   **Non poter controllare non è come aver controllato**: se la ricevuta manca o è di un'altra
   richiesta, la conferma automatica **si sospende** invece di partire lo stesso. (Fino alla
   3.20 quel caso saltava il controllo e confermava — la Conferma nativa invia la richiesta
   *intera*, quindi era la strada per confermare l'avanzo di un tentativo precedente.)
6. **Il quesito del triage non si sovrascrive per sbaglio**: se il triage l'ha già compilato,
   resta il suo — anche se la casella del pannello ha un quesito messo da un chip, da un
   pacchetto o rimasto dal giro di prima. Lo sostituisce **solo** un quesito che il medico ha
   scritto a mano nel pannello (il campo scritto da noi è segnato come nostro: non blocca i
   salti di pagina come farebbe uno scritto dal medico). La ricevuta e la striscia finale dicono
   quale è partito. (Fino alla 3.49 il quesito del pannello veniva ignorato in silenzio.)
7. **Sessione scaduta riconosciuta**: se compare la pagina di login, stop con messaggio chiaro
   (che dice anche se l'ultimo esame è in stato ambiguo).
8. **Un run non muore in silenzio**: chiudere o cambiare pagina durante un run fa scattare
   l'avviso del browser; i passaggi falliti diventano rossi, quelli mai partiti "non eseguito".
9. **Niente esce dall'ospedale**: ogni richiesta è bloccata a livello di codice se non è diretta
   a una delle **due origini dell'ospedale** — SA4PSO e il portale clinico interno da cui
   arrivano i referti e si legge la tabella multi-prelievo. Nessun altro indirizzo, nessuna
   telemetria; preferenze e catalogo appreso restano nel browser. (Con la stampa automatica il
   PDF va all'aiutante **su questo PC**, che non usa la rete: regola 17.)
   **Un'eccezione sola, voluta e dichiarata: il Ponte verso l'iPhone.** Spento finché la build non
   ha l'indirizzo del ponte (`ponte/host.txt`: nessuna pagina lo cambia) e il medico non associa il
   telefono col QR; allora il service worker
   tiene **una** presa (WSS, 443) verso **un** host, il Worker di EKG Atlas, e ci passano solo messaggi
   cifrati da un capo all'altro (AES-256-GCM, chiavi da HKDF, la chiave del QR mai a un server):
   il sito li inoltra al telefono e non li può leggere né li tiene. Le richieste al gestionale
   restano quelle di sempre, fatte dalle sue schede. La chiave sta in `storage.local` fino alla
   scadenza, e vale per un telefono solo. Revoca, scadenza a 14 ore, sessione che si
   chiude dopo 20 minuti senza comandi, la spia «iPhone collegato» e il Registro:
   [`ponte/README.md`](ponte/README.md).
10. **Due schede, due pazienti, zero interferenze**: i passaggi di consegna tra pagina e pagina
   (ricevuta e conferma automatica) vivono nella singola scheda (sessionStorage).
   **La scheda dell'ordine.** Con l'estensione il giro lo fa una scheda di sottofondo, e tutti
   i controlli di sempre sono suoi: episodio, sessione, presidio prima di ogni invio, carrello
   identico alla ricevuta, «Confermata» solo con la prova, l'esame in volo mai rimandato (e
   annunciato al service worker prima di partire: se la scheda muore lì, è da controllare). Chi
   è la scheda dell'ordine lo sa il service worker, per numero di scheda (`storage.session`,
   che muore col browser e non sta su disco), e **solo finché l'ordine gira**: finito, si slega
   — mai l'esito o le etichette di un altro paziente scambiati per i suoi. Parte **una volta
   sola**, un motore alla volta; la coda non va avanti finché la scheda di prima esiste. La
   scheda del medico non manda niente: una risposta persa si richiede con lo stesso numero, e
   parte da sé solo su un no esplicito. L'appunto della scheda porta il numero dell'ordine:
   ripristinata dopo un browser caduto, o duplicata, non riprende niente. **Nessun ordine
   resta «in corso» per sempre**: se la scheda dell'ordine si ricarica (lo fa il gestionale da
   sé, o un clic del medico su di lei) quando il giro è già finito ma l'ultima parola non è
   ancora detta, niente da riprendere e nessuna conferma armata, cerca la prova della
   Conferma se era partita da lì (solo letture), se no dice «Da controllare · apri il
   carrello» — e l'ordine finisce, la coda va avanti. Il ⏹ c'è finché l'ordine è in corso e
   lo finisce sempre, tranne quando la Conferma è già partita: allora arriva la prova, o le
   etichette. **Il Registro della scheda dell'ordine** (le ultime 40 righe) viaggia con la sua
   ultima parola, e le schede del medico lo aggiungono al Registro di quel paziente, segnato
   «dalla scheda dell'ordine»: è lì il perché di com'è andata, e «⧉ Copia» lo copia (col
   quesito omesso, come sempre). Le etichette le
   consegna il service worker a **una** scheda (quella davanti, nella finestra in primo piano),
   una volta sola, coi link letti dalla pagina del gestionale e accettati solo dalla sua origine.
   Nessun permesso nuovo per l'estensione. (Con la stampa automatica i fogli li stampa il
   service worker, coi PDF che gli dà la scheda dell'ordine; alla scheda del medico arriva solo
   un foglio che non è partito: regola 17.)
11. Codifica **windows-1252 identica byte per byte** a quella del browser (verificato contro
    Chromium reale, accenti e simboli inclusi).
12. **Stampe solo dai link della pagina**: gli URL dei PDF non vengono mai costruiti a mano
    (`BRANCA` varia per richiesta) e passano gli stessi controlli di origine di tutto il resto.
    La caccia al PDF ha **un tetto solo, sei tentativi in tutto**: oltre quello il documento si
    apre in una scheda e lo stampi da lì. (Il contatore stava dentro la funzione ricorsiva, così
    ogni livello ripartiva da zero e il tetto vero era 6+6×6 = **43 richieste**. Lo stesso
    difetto era rimasto nel service worker, per i referti, ed è corretto anche lì. Ora è uno solo,
    passato ai livelli sotto.) Annullare la stampa (Esc, ✕) **ferma davvero** la caccia; «→ Avanti»
    ferma quella del documento che salti.
13. **Un paziente alla volta**: per ordinare devi essere sulla sua pagina, e ogni dato salvato
    (valori, referti, registro, code di conferma) è legato al suo episodio — letto sotto un altro
    episodio semplicemente non esiste.
14. **Dove finisce il contenuto clinico, detto con precisione.** Dei pazienti *conosciuti*
    restano solo nome, episodio, indirizzo della pagina e colore del triage, al massimo 60 e per 24 ore, con
    **svuota** a mano e **🗑** per cancellare tutto di uno. I **promemoria** stanno nel `localStorage`
    (`promemoria.v1`) per episodio: l'ora e la cosa da fare («tropo»), mai un nome; al massimo 10 a
    paziente, scadono 12 ore dopo l'ora fissata, la pagina di login non li tocca (sopravvivono a una
    sessione scaduta, come il posto nella stanza), **svuota** e **🗑** li tolgono, e non vanno da
    nessuna parte: non c'è una richiesta, né una notifica fuori dal pannello. Ma valori e testi dei referti letti in un turno stanno nel
    `sessionStorage` della scheda: **Chrome lo tiene anche su disco**, nel profilo, per poter
    ripristinare le schede — muore chiudendo la scheda, non prima. I PDF salvati stanno nella
    memoria dell'estensione (su disco), scadono dopo 8 ore, massimo 25, e si azzerano alla
    chiusura del browser. Le **schede cliniche** (tabella multi-prelievo, testi dei referti letti)
    stanno nella memoria dell'estensione, quindi **su disco**: un turno dura dodici ore e non si
    può perdere tutto chiudendo il browser. Scadono da sole **24 ore** dopo l'ultima lettura, al
    massimo 200 pazienti, e **🗑** su un paziente archiviato le cancella subito — schede, referti
    tenuti, nota e promemoria. La pagina di login cancella il resto — ma il `sessionStorage` è
    **per scheda**: pulisce la scheda in cui è comparso il login, non le altre schede aperte.
    Su un PC condiviso: usa un profilo Chrome tuo e chiudi il browser a fine turno.
15. **Niente parte da solo, e niente si inventa.** Aprire la pagina di un paziente non legge
    **nessun** valore: cliccare un paziente non è chiedere il laboratorio. I valori si leggono
    quando li chiedi — aprendo un prelievo, o con **⭳ Carica i valori** che li prende tutti, uno
    alla volta, insieme allo storico del portale aperto in sottofondo dal link della pagina —
    e un prelievo che ha già fallito non si ritenta da solo. Un referto che apri non
    viene riletto per tenerne una copia: per quello c'è **Salva i referti** (menu ⋯). E la tabella
    multi-prelievo viene **letta dalla pagina che hai davanti**, non chiesta all'API che la
    riempie — una chiamata diretta a quel servizio arriverebbe senza l'`Origin` della sua app,
    cioè come una cosa diversa da te che clicchi, e non è quello che questo programma fa.
16. **I fogli di dimissione sono modelli, non cartelle**: sono l'unica cosa che sopravvive alla
    pulizia del logout, proprio perché non contengono il paziente. Per questo l'editor offre
    **⧉ Copia senza salvare** — chi vuole un foglio su misura non è mai costretto a salvarlo — e
    un salvataggio rifiutato dal browser (memoria piena o bloccata) viene **detto**, mai spacciato
    per riuscito.
17. **La stampa automatica fa una cosa sola, e lo dice.** L'unico permesso in più è
    `nativeMessaging`: parlare con **un** programma di questo PC, `it.psassist.stampa`, che
    l'utente ha installato lui (una chiave in HKCU, niente amministratore) e che accetta solo
    questa estensione. A lui va **solo** il PDF che una scheda del gestionale ha preso coi
    controlli di sempre (o un modulo dei Consensi, dall'estensione), e il nome della stampante
    scelta per quel tipo di foglio; lo porta il service worker, mai la pagina. L'aiutante
    ripete i controlli (è un PDF? non è enorme? quella stampante esiste, ed è accesa?), stampa con
    SumatraPDF, guarda la coda di Windows, cancella il file temporaneo e risponde: non usa la
    rete, non esegue altro, e nel suo registro scrive cosa e dove, mai il contenuto. Chrome lo
    avvia per ogni foglio e lo chiude subito: in Windows non resta acceso niente. L'aiutante
    accetta solo l'ID fisso di PS Assist (la `"key"` del manifest), scritto in `installa.ps1`.
    **Una volta sola, e un motore solo**: ogni stampa automatica è un ordine tenuto dal service
    worker in `storage.session` — in un ordine in sottofondo la stampa dopo la conferma provata è
    un suo passo; una stampa chiesta dalla scheda del medico (dopo una conferma, «Ristampa», un
    consenso) è un ordine che fa solo quello, e la stessa domanda arrivata due volte è una stampa
    sola. Ogni foglio ha il suo esito
    (`attesa`, `mandato`, `stampato`, `fallito`, `sconosciuto`), scritto **prima** di mandarlo; un
    foglio che era in volo quando il service worker è ripartito è «sconosciuto», mai rimandato. La
    scheda dell'ordine dà solo i PDF — per una stampa dalla scheda del medico è una scheda che il
    service worker apre dietro sulla pagina del paziente (un indirizzo da leggere, mai un modulo,
    letto dalla pagina e non costruito), senza pannello; i consensi sono file dell'estensione:
    se si ricarica o si chiude, o col ⏹, i fogli che restano non
    partono («Stampa interrotta», con Ristampa). **Tre esiti, detti per quello che sono**:
    «stampato» solo se Windows l'ha fatto uscire dalla coda, «mandato» (in ambra) se è ancora lì;
    **«sconosciuto»** — nessuna risposta, tempo scaduto (l'aiutante ha 35 secondi, l'estensione
    ne aspetta 90: i tempi sono annidati, e l'estensione non smette mai di aspettare prima che
    l'aiutante abbia finito), SumatraPDF fermato, la stampante fermata in errore mentre stampava
    — non riparte **mai** da solo: si dice, con
    «Ristampa». Solo un no detto prima di stampare (non installato, stampante sparita, spenta o
    offline, PDF non valido, SumatraPDF che rifiuta) rimanda **quel** foglio al dialogo di
    sempre, col motivo scritto; e mai da solo per un ordine dal telefono, che aspetta un tocco al
    PC. Le parole le scrive una funzione sola nel service worker (`ordPubblico`, a ogni
    scrittura dell'ordine): la striscia del PC e il telefono dicono le stesse, salvo dove il
    telefono ha la sua (`tel`: «aspettano qualcuno al PC», non «tocca Stampa»). Spenta
    (l'interruttore), non configurata, o col preferito, il percorso è quello di prima, identico.

> **Postazione condivisa**: `localStorage` e la memoria dell'estensione sono legati al **profilo
> Chrome**, non al login dell'ospedale. Usa l'estensione in un profilo tuo. Se il profilo è
> davvero condiviso, non usare **Salva i referti** (i PDF resterebbero su disco fino a 8 ore).

---

## Collaudo guidato (prima volta su pazienti reali)

Precondizioni: profilo browser personale (non condiviso), una sola scheda SA4PSO, e per tutta la
prima fase usa **solo** "Crea richiesta e aggiungi" — mai il bottone con conferma.

**In ordine, senza saltare passi:**

1. **Verifica identità.** Apri il paziente in UNA sola scheda. Il pannello deve mostrare nome ed
   episodio identici alla testata SA4PSO. Se l'episodio manca, il pannello si rifiuta da solo:
   non insistere, usa la pagina nativa.
2. **Primo run minimo.** Un solo esame economico e comunque indicato (es. glucosio POC) su un
   paziente che ha già bisogno del prelievo. Quesito reale. **Non toccare il browser** finché non
   atterri sul carrello con la striscia «✓ 1 esame in carrello» (5–20 secondi).
3. **Verifica il nome, non il conteggio.** Sulla pagina esami leggi la riga nel carrello: il
   **nome** deve corrispondere esattamente al chip scelto. (Il motore fa già questo controllo da
   solo prima di ogni invio e si ferma se un codice ha cambiato nome.)
5. **Conferma manuale nativa.** Premi tu Conferma: le etichette compaiono **in anteprima**
   («→ etichettatrice») e si apre il dialogo di stampa — verifica nell'anteprima che il PDF sia
   della **richiesta giusta** e che le etichette riportino il **paziente giusto**, scegli
   l'etichettatrice; chiuso il dialogo arriva la lista, sulla stampante normale. (Esc annulla;
   si rifà dalla sezione "Stampa".) **Con la stampa automatica**, prima di questo passo:
   dalla sezione "Stampa" di un paziente già confermato **ristampa un'etichetta vera** e leggi
   il suo codice a barre col lettore del laboratorio — dritta, intera, leggibile; se no, cambia
   «Etichette più larghe che alte» nelle Stampanti e riprova.
6. **Controllo incrociato in EHR.** Riapri l'episodio: esattamente UNA richiesta nuova, 1 esame,
   quesito/medico/urgenza corretti, nessuna bozza doppia.
7. **Run multiplo con cambio risorsa.** Profilo con POC + Urgenze (es. Base PS + Epatico):
   ripeti i punti 3–5 riga per riga.
8. **Esercitazione di interruzione.** Lancia un run e premi il quadratino rosso a metà; tocca la
   striscia, leggi il messaggio e controlla il carrello col bottone "Apri il carrello e
   controlla". Regola permanente: **dopo qualsiasi striscia rossa mai rilanciare da capo a occhi
   chiusi** — sei già sul carrello: o si sistema a mano, o **↻ Riprova i mancanti** (solo quelli
   mai partiti, sulla stessa richiesta: la prima volta guarda nel carrello che niente sia
   doppio), e si controllano le bozze sull'episodio.
9. **Radiologia (solo dopo qualche giorno di laboratorio pulito).** Prima apertura nativa di
   "Richieste Radiologia" (apprendimento del catalogo), poi un solo RX torace dal pannello, con
   verifica in radiologia che la richiesta sia arrivata unica e con il quesito giusto.
10. **Auto-conferma (ultima fase, opzionale; solo laboratorio — la radiologia richiede sempre
    il tuo click, per codice oltre che per regola).** È **immediata**: primo uso con 1 esame
    restando davanti allo schermo, e ricontrolla etichette e richiesta appena confermata. Per
    provare il blocco di sicurezza: lascia un esame nel carrello da un tentativo interrotto e
    rilancia — la conferma deve **sospendersi** con il messaggio, non partire.
11. **Regime.** Una scheda per paziente; mai avviare un run e allontanarsi; nella prima settimana,
    a fine turno, scorri le richieste create cercando doppioni o bozze non confermate.

Se un passaggio non torna: il **Registro** (in fondo al pannello) elenca ogni azione con l'orario,
inclusi i primi 160 caratteri di qualsiasi pagina inattesa del server e **da quale strada è stato
ottenuto ogni PDF**. Resta scritto anche cambiando pagina (per scheda e per episodio, 2 ore) e il bottone
**⧉ Copia** lo mette negli appunti pronto da incollare — **il quesito diagnostico viene omesso**,
così non escono testi clinici.

---

## Struttura del progetto

```
ps-app/
├── src/core.js          ← unica fonte: motore + pannello (zero dipendenze)
├── src/catalog.json     ← catalogo esami verificato (SSG: POC/Urgenze/Centrale/RX · OSG: POC/Centrale)
├── src/dimissioni.json  ← gli otto fogli di dimissione (testi rivisti, nessun dato di paziente)
├── test/fixtures/       ← la tabella dello storico ricostruita dalla sua forma (dati inventati)
├── extension/           ← estensione MV3 pronta da caricare (content.js è generato)
├── extension/pdfjs/     ← pdf.js 3.11.174 di Mozilla (Apache-2.0), preso tale e quale: legge i referti
├── extension/ponte-*    ← il Ponte verso l'iPhone: la presa nel service worker, la pagina «iPhone»,
│                          la prova della rete; qr.js è il codificatore QR di Project Nayuki (MIT)
├── ponte/               ← il Ponte: README, host.txt (il suo indirizzo, fissato nella build), il
│                          ripetitore Node per test e prove (stessa logica di ../worker/ponte-logica.js);
│                          l'app del telefono sta in ../public/ponte/
├── tools/build.mjs      ← genera extension/content.js, il bookmarklet, extension/ponte-cripto.js e
│                          extension/ponte-host.js
├── tools/icons.mjs      ← genera le icone PNG (niente binari a mano)
├── bookmarklet/         ← piano B per PC bloccati: un preferito, zero installazione (generato)
├── stampa/              ← la stampa automatica per Windows: installa.cmd, l'aiutante host.ps1 (SumatraPDF lo prende installa.cmd: non sta nello zip)
├── tools/verifica-build.mjs ← al rilascio: la build, lo zip e la versione committati sono quelli di adesso
├── esempi-gestionale/   ← pagine vere del gestionale, contenuti inventati (+ come)
├── demo/                ← guscio del banco di prova (css + il browser finto)
├── tools/esempi.mjs     ← genera esempi-gestionale/ dagli originali (che restano fuori)
├── tools/demo.mjs       ← assembla dist/demo.html: pannello vero + pagine vere
└── test/                ← simulatore SA4PSO + 101 scenari e2e in Chromium reale (+ storico, referti, ordine in sottofondo, stampa automatica)
```

Sviluppo:

```bash
cd ps-app
npm install        # solo playwright e ws, solo per i test
npm run build      # rigenera extension/content.js + bookmarklet (+ ponte-cripto.js, ponte-host.js) dopo modifiche a src/
npm run esempi     # rigenera esempi-gestionale/ dagli originali e verifica che sia pulito
npm run demo       # rigenera dist/demo.html (il banco di prova)
npm run dist       # al rilascio: build, fogli di dimissione, dist/ps-assist-latest.zip (con stampa/, senza SumatraPDF)
npm run verifica-build   # al rilascio, dopo dist e il commit: build fresca = build committata? zip e versioni giusti?
npm test           # 101 scenari e2e + 184 sull'estensione (129 sull'ordine in sottofondo, 6 con la scheda davvero nascosta) + 123 sulla stampa automatica (+ 60 sull'aiutante di Windows, con PowerShell 7: PWSH=…) + 59 sul banco + storico + il cancello privacy
                   # + l'ordine in una scheda DAVVERO nascosta: Chrome senza Playwright, CDP grezzo (test/ext-nascosta.mjs; serve openssl)
                   # + il Ponte: 120 controlli senza browser (cifratura, ripetitore, Worker) e 166 dal vivo (test/ext-ponte.mjs)
                   # (Chromium che va in crash aprendo un PDF, in un contenitore Linux: PSA_CHROMIUM_ARGS=--disable-features=PdfOopif)
```

I test coprono: percorso felice (con e senza redirect PRG, con verifica **byte-per-byte** del
corpo POST contro la codifica nativa di Chromium), conferma automatica, annullo con Esc e flag
consumato al reload, carrello "in ritardo" (verifica con riletture, un solo invio), esame perso
dal server (hard-stop con **un solo** invio e step successivi mai partiti), **codice rinumerato**
(rifiuto prima dell'invio), sessione scaduta prima e **durante** un inserimento (messaggio di
ambiguità), **cambio episodio a metà run** (zero invii sul paziente sbagliato), quesito
del triage tenuto se non lo tocchi — anche dopo un chip — e sostituito dal tuo se l'hai scritto
(con la riga che dice quale è partito), aggiunte dalla pagina esami con cambio risorsa, rifiuto live di
esami di risorsa sbagliata (CTA disabilitato con motivo), quesito mancante (CTA disabilitato,
si riattiva scrivendo), apprendimento radiologia end-to-end, STOP, il giro in sottofondo **senza
mai la finestra** fino alle etichette (col resoconto che resta e il «Ristampa»), l'errore a metà
(striscia rossa, «Mancano» separati da «Da controllare», carrello del primo esame mancante, zero
invii dopo), **↻ Riprova i mancanti** (partono solo quelli mai partiti, contando gli
inserimenti: mai i «da controllare», mai quelli già in carrello o tolti a mano; nello stesso
modo del primo giro — una conferma sola, alla fine — o in revisione sul carrello; due errori
di fila, coi «da controllare» ancora in elenco; lontano dal carrello prima «Apri il carrello»;
senza richiesta nata, un giro normale) e **Chiudi** (il quesito resta, restano scelti solo i
mancanti e il bottone li conta giusti, la pill torna normale, la richiesta lasciata a metà resta
sorvegliata e la riga in Richieste lo dice), **Svuota il carrello e ricomincia** (due tocchi, il
primo legge il carrello vero e dice i nomi; quello che c'era già — un «solo carrello» di prima,
un «+ aggiungi» — rimesso anche lui, e una riga che non si saprebbe rimettere → niente svuotato; il
«Svuota carrello» del gestionale con la richiesta e l'episodio giusti, l'altra richiesta già
confermata intatta, la pagina del paziente letta prima, ogni sezione riletta vuota prima di
rimettere, la selezione intera rimessa e confermata una volta; il «Svuota» che lascia le righe o
risponde HTTP 500 → stop, niente rimesso, niente «Riprova»; senza «Svuota» in pagina, riga per
riga coi suoi «Elimina», e il promemoria che segue il carrello vero; il salto sul carrello di un
errore che non parte sopra un «Riprova» toccato subito), e **la scheda dell'ordine**
con l'estensione vera (`test/ext-ordine.mjs`: la scheda dietro, il medico subito su un altro
paziente con la striscia che racconta, la conferma provata, le etichette che lì aspettano un
tocco — «Etichette di ROSSI M. pronte · Stampa» — e alla fine «Stampa finita · Ristampa»;
un'occhiata alla scheda dell'ordine che non la fa tua; la scheda che si chiude da sola, o resta
slegata se la stai guardando quando finisce; l'errore che arriva nella tua scheda col resoconto
intero e «Svuota» coi nomi; l'errore con te sopra — la scheda non salta, e un ordine di un altro
paziente aperto da lì ha le sue etichette, senza toccare l'avviso di prima; ⏹ mentre la scheda si
apre e fra una pagina e l'altra; la scheda chiusa a metà; una scheda zitta mai data per «non
mandata», con la coda ferma; due ordini in coda; la sessione scaduta; la pagina di accesso che
tiene le etichette; il browser che cade; le etichette che aspettano chi scrive e vanno nella
finestra in primo piano; la stessa domanda due volte; nessun giro di controllo con un avviso solo;
la scheda che non si apre → la pagina manda come sempre),
la **stampa automatica** (`test/ext-stampa.mjs`: l'estensione vera con un finto aiutante
registrato come «native messaging host» del profilo di prova — senza aiutante il dialogo di
sempre; la pagina Stampanti, da «non installata» all'elenco, l'A4 predefinita, le pagine di
prova nella misura dell'etichetta, la rotazione, e l'ID fisso; etichette → etichettatrice e lista
→ A4 senza dialogo né anteprima (le stampa il service worker, coi PDF da una scheda aperta
dietro), una volta sola anche chiesta due volte, e i consensi all'A4; una conferma nella scheda del
medico che va subito su un altro paziente; una richiesta fatta a mano, che non stampa; un foglio che non esce → il dialogo col
motivo, lui solo; l'aiutante sparito, che non parte o vietato per quell'ID; l'interruttore e la
stampantina rossa; l'ordine in sottofondo stampato dal service worker senza più nessuna scheda
del gestionale aperta, «Stampato su … alle HH:MM · 2 esami confermati» e «Ristampa»; il foglio dell'ordine che non esce, che arriva al medico col motivo, e
lui solo; l'aiutante che non risponde in tempo → «esito sconosciuto», mai il dialogo; la scheda
dell'ordine ricaricata, chiusa o fermata col ⏹ mentre il service worker stampa → «Stampa
interrotta → Ristampa», e la coda che va avanti; il service worker ripartito a metà, col foglio in
volo «sconosciuto»; la consegna dei fogli ripetuta, che stampa una volta; gli ordini dal telefono
che non aprono mai da soli il dialogo; «Mandato a»; la stampantina «non installata»; l'ID fisso)
e l'aiutante stesso (`test/stampa-host.mjs`, con PowerShell 7 se c'è, avviato come lo avvia
`host.cmd` e con stdin aperto come lo tiene Chrome: il filo a pezzi, i controlli, la stampante
offline o dal nome impossibile, un SumatraPDF finto con la rotazione giusta, la coda di Windows
— uscito, rimasto, fermo in errore —, SumatraPDF che non finisce → «sconosciuto» entro 40
secondi, i temporanei cancellati, il registro senza contenuto; e `installa.ps1`: la copia in
`%LOCALAPPDATA%`, l'ID fisso, SumatraPDF dallo zip in Download, ogni blocco noto detto in
italiano, il disinstalla che controlla),
il resoconto corto (gli elenchi, un'azione sola,
passi e Registro sotto «Dettagli»), la ricevuta con un bottone solo e la griglia dietro
«+ aggiungi», l'emogas tornato alla versione di sempre detto nella ricevuta, «altri esami…»
senza doppioni Urgenze/centrale, la conferma
**senza prova** (HTTP 500 o carrello ripresentato: ambra, mai verde, mai riconfermata), la conferma interrotta da un cambio pagina (la pagina dopo avvisa, passato il
tempo), il medico che scrive nel gestionale (nessun salto di pagina, la pill dice di toccare), la
**riga assente** ritrovata con la ricerca del gestionale — o, se nascosta davvero, nessun invio e
«Mancano» — e la stampa: niente davanti mentre un PDF arriva, poi la scheda col PDF **in
anteprima** e la stampante su cui va, sequenza manuale etichette→lista e download singoli, **richiesta divisa su due laboratori → 4 PDF
(PROG 1 e 2, tutte le righe, BRANCA passato intatto dal DOM)**, **prenotazione radiologica**,
auto-apertura sulla pagina post-conferma, attesa-e-ripartenza al ritorno sulla pagina paziente,
wrapper HTML seguito fino al PDF, conferma manuale nativa che arma la stampa, e i referti:
**zero download prima della spunta PRECARICA**, 3 PDF scaricati una volta ciascuno, ordinamento
per data/ora, apertura istantanea da memoria senza nuove richieste, fallback nativo senza
precarica, link-archivio ignorati. In più il bundle
compilato è stato eseguito contro la **vera pagina paziente salvata**: ogni tipo di riga reale
(lab, radiologia, consulenza/ECG) produce il piano di stampa atteso. Il simulatore fallisce
apposta se `Cancel` viaggia insieme a `Update` (regressioni del serializzatore) e le fixture
sono **anonimizzate**: nessun dato di pazienti reali in questo repo.

## Note dall'audit (per chi metterà mano al codice)

- Le pagine sono `windows-1252`; i POST vanno codificati così (il motore ha un encoder dedicato
  con fallback a riferimenti numerici HTML per i caratteri non rappresentabili).
- I `<select>` del server arrivano con **doppio `selected`** (vince l'ultimo): mai leggere gli
  attributi, sempre le proprietà DOM.
- L'elenco esami è una GET pura: stessa URL con `RISORSA_ID` diverso = cambio risorsa. La URL viene
  ricostruita dai parametri dei link `AFCDataLink` (mai da `response.url`).
- Il link "svuota carrello" ha `Delete=Elimina` **senza** `PRESTAZIONE`: un esame è "nel carrello"
  solo se il suo link ha *entrambi*.
- `extension/portale-pdf.js` (nel mondo della pagina del portale) guarda solo le XHR **asincrone**:
  la sua `send` sta sulla singola richiesta, non sul prototipo. Il portale manda una XHR sincrona a
  `logout.jsp` mentre la pagina si chiude, Chrome la rifiuta («Synchronous XHR in page dismissal»),
  e con la `send` cambiata per tutte quell'errore della pagina finiva fra gli errori dell'estensione.
- Il form Conferma contiene `MVPG=RcsStampaEtichetteLIS` nascosto: confermare via fetch
  ingoierebbe la stampa etichette — per questo la conferma è un click nativo.
