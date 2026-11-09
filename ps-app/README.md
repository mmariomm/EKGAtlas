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
   La pill c'è su **ogni pagina** del gestionale (la dimissione, le terapie, le stampe, /sa4rcs/…): sulla pagina di un paziente noto apre i suoi Esiti, altrove il tabellone; da lì non si ordina.
   Fuori da /sa4pso/ è solo la pill (niente letto né scritto della pagina); le schede di sottofondo e i PDF restano senza.
   Si **trascina** dall'intestazione e si **ridimensiona** dall'angolo in basso a sinistra
   (posizione e misura restano memorizzate; doppio click sull'intestazione o sull'angolo per
   tornare a com'era).

**Perché "si aggiorna" a ogni pagina?** Il gestionale è un'app anni 2000: OGNI click ricarica
l'intera pagina — nessuna estensione può impedirlo. Il pannello però **si ricostruisce identico**:
quesito, esami selezionati, sezioni aperte e posizione tornano come li hai lasciati (per lo
stesso paziente, nella stessa scheda), quindi in pratica non te ne accorgi.

**Aggiornare a una nuova versione: ⋯ → «Aggiorna app».** Con la stampa automatica installata
(`stampa\installa.cmd`, qui sotto) l'estensione si carica **una volta** da
`%LOCALAPPDATA%\PSAssist\estensione` (ce la copia `installa.cmd`, e lo dice). Da lì: quando su
GitHub c'è una versione più nuova, un puntino sul **⋯** e la voce **Aggiorna app** (la versione nel
suggerimento). Un tocco: Chrome scarica lo zip, l'aiutante di Windows mette la cartella nuova al
posto della vecchia (che resta in `estensione.prima`) e l'estensione si ricarica, senza riavviare
Chrome e senza amministratore. Non mentre un ordine, una stampa o un ordine dal telefono è in corso
(«Dopo l'ordine in corso»). Le schede già aperte mostrano **«Ricarica la pagina»**: un tocco, quando
vuoi (la pagina non si ricarica mai da sola: lì può esserci un testo non mandato). Se la versione
nuova non parte, doppio clic su `ripristina.cmd` in `%LOCALAPPDATA%\PSAssist\stampa` e ⟳ in
`chrome://extensions`. Senza aiutante, o caricata da un'altra cartella, il ⋯ dice come fare; a mano
resta il modo di sempre: sostituisci i file nella STESSA cartella e **Ricarica** (in fondo al ⋯,
accanto alla versione), che non c'è mentre un giro di esami sta mandando.
Per sapere se c'è una versione nuova PS Assist legge, una volta al giorno e aprendo il ⋯,
`VERSION.txt` da `raw.githubusercontent.com` (e lo zip, solo al tocco): richieste senza cookie e
senza dati, l'eccezione dichiarata nella regola 9.

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
stanza, «Da fare») resta. Se dopo ⟳ in `chrome://extensions` l'ID non è quello, rimuovi PS
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
resta dove la trascini; il mouse fermo sulla pill (o un tocco) riapre la finestra dove l'avevi lasciata
(vedi *Forma*). Per usare il gestionale sotto, si riduce alla pill: la finestra lo copre quasi tutto, apposta.

**Forma.** ⋯ → **Forma: Finestra · Al passaggio · Colonna** (si ricorda; il reset la lascia). **Al
passaggio** è la forma di partenza (l'ha chiesta il medico): il mouse fermo sulla pill per un quarto di
secondo (chi ci passa sopra e basta non la apre) apre la finestra senza togliere la tastiera al
gestionale, e mezzo secondo dopo che il mouse è uscito la richiude — non con il cursore o del testo non
mandato in un campo del pannello, esami scelti, un ordine in partenza o in coda, un giro andato storto,
un trascinamento, il menu ⋯, la lista Da fare o un «Sposta in…» aperti, la Modifica della stanza, la
pagina dell'iPhone (⋯ → iPhone: il mouse dentro non si vede, e col QR la mano va al telefono).
Ripassando si riapre **dove eri**: la stessa schermata, scorsa allo stesso punto. Un clic sulla pill (che
resta, sopra la finestra, e si trascina anche lì; se copre ⋯ e — quelli si fanno in là) la fissa, un
altro la libera, Esc la chiude; la pill che ricompare sotto il mouse fermo non si riapre da sola; col
dito un tocco apre e un tocco chiude. **Finestra** è quella di sempre, qui sopra: si apre e si chiude
con un tocco. In tutt'e due **F2** (non mentre scrivi nel gestionale) la apre **sui Pazienti, col
filtro pronto** — F2 · lettere · Invio apre un paziente — e la richiude. **Colonna**: a destra, a
tutta altezza, e il gestionale **si stringe** accanto (un margine destro alla pagina) invece di
essere coperto; larghezza dal bordo sinistro (420 px – 60% dello schermo), ricordata; **F2** (non
mentre scrivi nel gestionale), la linguetta o **—** la nascondono: resta una linguetta di 7 px
(F2 la riapre dov'era).
**Tabellone** (⋯, o la sua icona accanto al ⋯ sulla lista) apre la pagina `tabellone.html` dell'estensione: lo stesso
tabellone a tutta pagina, da fissare o sul secondo schermo. Disegna da uno specchio delle sole
chiavi del tabellone che le schede del gestionale tengono in `chrome.storage.local` a ogni
cambiamento; un tocco su un paziente porta davanti la scheda del gestionale (mai quella di un
ordine) e le fa caricare l'indirizzo **suo**, quello che il gestionale ha dato; un letto spostato lo
scrive quella scheda, nella memoria di sempre. Dal tabellone non si ordina; senza gestionale aperto
si guarda soltanto («—»).

**Si apre da solo solo quando serve.** Una pagina raggiunta cliccando nel gestionale mostra la
pill: lì stai lavorando tu. La finestra si apre da sola quando la pagina l'ha aperta il pannello
(un paziente scelto dall'elenco, Richieste…) o quando ha qualcosa da dirti (un avviso). Un
**giro di esami** no: dalla spedizione alle etichette parla la striscia nell'angolo, e la
finestra la apri tu con un tocco. **Esc** o un clic fuori la riducono; dopo **Copia** si riduce da sola e la pill dice
«✓ Copiato · incolla». Il menu **⋯** è a sezioni, ognuna col suo titolo piccolo, le voci corte due
per riga, ognuna con la sua **icona** (grigia, 16 px) accanto alla parola; una sezione che su quella
pagina non ha voci non c'è. In cima **Forma** (vedi sopra), con **Al centro** e **Affianca a
destra** (una colonna, col gestionale accanto). Poi:
- **Paziente** (sulla sua pagina): **Ricetta SISS** e **Terapia** (solo con l'estensione), **Stampa
  le richieste**; in Dimissioni anche **Esporta i fogli** (un JSON) e **Importa i fogli…** (sulla
  lista, dove un paziente non c'è, la sezione si chiama **Dimissioni**);
- **Strumenti**, quelli clinici: **Tabellone** e **iPhone** (il Ponte; solo con l'estensione),
  **Cronometro**, **Riferimenti** (i *can't-miss killers*), **Consegne** (vedi sotto); in fondo, sulla stanza, **Modifica la
  stanza** e **Segue il gestionale**;
- **Impostazioni**: **Stampanti**, e — scelte le due stampanti — **Stampa automatica** (vedi
  «Stampa automatica»), **Registrazioni**, il **Registro**, **Indirizzo del portale** e per ultimo,
  da solo sulla sua riga e in rosso, **Reset dati pazienti**. Le voci che si accendono e si spengono
  (Segue il gestionale, Stampa automatica) si spuntano: al posto dell'icona il loro stato (il
  pallino blu con la spunta, acceso);

e in fondo la versione, con accanto **Ricarica** (l'estensione) e sopra, quando c'è una versione
nuova, **Aggiorna app**. Le schermate che si aprono dal ⋯ (Riferimenti, Cronometro, Registrazioni,
iPhone, Ricetta SISS, Terapia) dicono dove sei: al posto delle schede **«‹ [icona] Nome»**, e ‹ (o
Esc) torna alla scheda da cui eri venuto. Il cronometro compare in intestazione **solo mentre corre**
(un tocco sul tempo apre la scheda, ⏹ lo ferma).

**Riferimenti** (menu ⋯) è la tabella del medico, i *can't-miss killers*, nel suo inglese: in cima
«Don't anchor the DDx…», poi tre tabelle — **per sintomo, cosa escludere per primo**; le
**etichette benigne che nascondono un killer**; **chi cambia la lista** (gravidanza,
immunodepresso, anticoagulato, anziano…). Il cursore è già nel filtro: si scrive in inglese o in
italiano («cefalea», «sincope», «anziano») e restano solo le righe che servono.

**Consegne** (menu ⋯), per il cambio turno: una riga per paziente, nell'ordine del tabellone —
`OBI 2 · ROSSI M. 68 · in PS 3h40 · Aperti: Lab 50′, RX 1h40 · Da fare: 13:30 tropo; chiamare la figlia`:
il posto, COGNOME N. ed età, da quanto è in PS, quello che aspetta (per tipo, col tempo, come la
riga corta del tabellone; «(letto 11:02)» se la lettura è vecchia) e le cose da fare aperte.
**⧉ Copia** mette le stesse righe negli appunti, in testo; **Stampa** le manda al dialogo di stampa
del browser da una cornice invisibile (niente scheda nuova), e solo al tocco: portano dei nomi.
Usa quello che il tabellone sa già: niente da leggere, niente di salvato.

Il pannello ha cinque schermate, in **una fila di schede** sempre in cima e nell'ordine in cui si
lavora: **Richieste · Esiti · EO · Consensi · Dimissioni** (sulla lista del pronto soccorso, dove
non c'è un paziente: **Pazienti · EO · Consensi · Dimissioni**). Il paziente + episodio stanno nell'intestazione (anche da minimizzato). Sulla pagina «Storico dati clinici»
del portale clinico non c'è pannello: solo una striscia che dice cosa ha letto.

**Due identificativi, su ogni scheda.** L'intestazione dice `ROSSI MARIO · 68 M · ep. 700001 · OBI 1`
— nome, età e sesso (dal riquadro del paziente, se no dal codice fiscale), episodio, posto nella
stanza — anche in **Dimissioni**. Sotto, una riga sola, solo quando c'è qualcosa: le **Allergie**
del gestionale parola per parola, in rosso (`Allergie: nega` se è spuntato «Nega/Non
riferisce»; `Allergie: non lette` se la pagina non le ha lette, `Allergie: non compilate` se il campo c'è ma è vuoto e «Nega» non è spuntato — mai «nessuna») e il riquadro
**Attenzione**, com'è. Le azioni che escono dal pannello nominano il paziente: «**Conferma per
ROSSI M. · 68 M · 6 esami**», «✓ Copiato · ROSSI M.», e la stampa («Stampa 1 di 3 — Etichette ·
ROSSI M. · 68 M»).

### Pazienti (‹ in alto a sinistra)

Aprire un paziente **dal gestionale** porta ai suoi **Esiti**, perché è quasi sempre quello che si
va a fare; ordinare è un tocco più in là — **Richieste** è sempre in cima. Dal pannello, sceglierne
un altro **carica la sua pagina**: il pannello non mostra mai i dati di un paziente diverso da
quello che hai davanti. Il pannello parte da qui solo sulla lista del pronto soccorso, dove non c'è
un paziente aperto; sulla scheda di un paziente parte dagli **Esiti**.

**Il tabellone: in alto le mappe, sotto la lista.** In cima **Alta | Bassa | Entrambe** (i nomi
delle due mappe) e un piccolo **⟳**. *Entrambe*: le due mappe affiancate se lo spazio è largo, una
sopra l'altra se no; sempre in scala, **mai da scorrere di lato**. La scelta resta; finché non ne
fai una, si vede la mappa dell'area in cui lavori. Accanto, **Mappa | Lista | Da fare** (resta). *Da fare*: al posto di mappe e lista, il Da fare di tutti, largo — il generale in cima e poi ogni paziente col suo cognome e il posto (un clic lo apre; passandoci sopra, **+** scrive la prossima nota per lui nello stesso campo). *Mappa*: sotto le mappe la **lista** ha solo chi **non ha ancora un posto** (gli altri sono sulla mappa).
Sempre in vista, in Mappa e in Lista, il **Da fare del tabellone**: accanto alle mappe quando c'è posto,
sopra quando la finestra è stretta — una **colonna sola**, cinque righe al più e poi scorre, così le
mappe non perdono altezza; **Da fare ▾** lo riduce a una barra sottile (e lo ricorda). Una voce, una
riga: `○ 11:42 tropo… ✕`. In cima il **generale**, di nessun paziente: nel campo «Da fare generale…» si scrive e **Invio** aggiunge
(`dafare.generale.v1`, in questo browser e nello specchio del tabellone, mai al telefono; non scade,
una voce spuntata se ne va dopo 5 minuti; il «Reset dati pazienti» lo porta via). Sotto, le cose da
fare di **ogni paziente**, nell'ordine del tabellone (l'area, poi l'ordine del gestionale): il
**COGNOME** in grassetto una volta, a sinistra, sulla prima delle sue voci, e le altre sotto; sono le
stesse della sua lista. Dappertutto **un tocco sul testo lo modifica** (Invio salva, Esc lascia
com'era), **✕** (passandoci sopra; al tocco c'è sempre) cancella, la spunta tonda la fa.
*Lista*: niente mappe, **tutti** quelli della vista, per area (Alta, Bassa, OBI, Codici minori) e nell'ordine della lista del gestionale (l'ultima letta intera), col posto in una pillola dopo il nome. La lista prende
quello che le serve, al massimo poco meno di metà, poi scorre dentro. In fondo, chiusi, gli
**Archiviati** e **Svuota l'elenco**.

**Chi va dove** lo dicono l'area e il triage, sullo stesso elenco (non sono liste diverse):
**Alta** = l'area Alta + l'OBI **rosso** o **arancione**; **Bassa** = Bassa, Codici minori e l'OBI
**azzurro, verde o bianco**. L'OBI senza triage sta in tutt'e due, con la **striscia grigia**, e così
chi non ha ancora un'area (o ne ha una che il programma non conosce): nessuno sparisce. *Entrambe*:
tutti. Chi sta in un letto di una mappa si vede nella lista di quella mappa anche se l'area dice
l'altra.

**La riga** dice poco, sempre nello stesso posto: la striscia del **triage**, **nome ed età**, il
**posto**, **da quanto è in PS** (l'ingresso, dalla lista dell'area o dalla smart: «3h40»), il
**cuore** dei parametri vitali e tre segni, **Lab · ECG · RX**, ognuno col suo stato: **grigio** =
chiesto e in attesa, col tempo dalla richiesta («Lab 50′»); **ambra** = tornato in parte («RX
1/2»); **verde** = tornato tutto («Lab ✓»); mai chiesto = niente. Poi l'icona **Da fare** col numero
delle cose aperte, **▾** per scegliere il posto senza trascinare e, passandoci sopra, la **✕** per
toglierlo dall'elenco. **Niente valori e niente testo** nella riga (nemmeno il post-it): quelli
nella scheda che si apre passando sul nome. Ogni cosa ha la sua colonna, uguale per tutte le righe;
una colonna che nessuno usa non occupa niente. L'**episodio precedente** sta in fondo, in grigio, e
nella stanza non va. Nella colonna stretta il nome sta da solo sulla prima riga, il resto sotto.

**La scheda al passaggio.** Il mouse fermo un quarto di secondo **sul nome** (nella riga) o **sul
letto** apre una scheda da leggere — non prende il clic (sotto, il clic apre il paziente come
sempre; ▾ e «Sposta in…» restano), non copre mai il suo letto, si chiude uscendo. Righe solo se
hanno qualcosa, in quest'ordine: `▌ROSSI MARIO 79 M · Rossa · 3h40` · `♥ NEWS 8 · SpO2 88 · FC 132`
(i parametri fuori norma) · i **valori fuori range** dell'ultimo prelievo, `K 5,9↑ Hb 9,1↓` · **ECG**
(`✓ 10:02 «le prime parole del referto»`, o `40′` in ambra) · **RX** (`RX addome 40′`, `RX torace ✓
«…»`) · le sue **cose da fare** aperte, tutte. Valori e referti scritti vengono dalla scheda clinica del paziente (estensione), solo da
quest'ingresso in PS (o dalle ultime 24 ore), con la stessa regola d'identità degli Esiti. Passando
su una riga, il suo letto si accende (e viceversa).

**Il cuore dei parametri vitali** apre la riga di stato, nella lista, nel letto (solo l'icona) e nell'intestazione
accanto agli identificativi: **♥ rosso** se un parametro da solo è nella fascia rossa del NEWS2 —
SpO2 ≤91 (una soglia per tutti), FR ≤8 o ≥25, PAS ≤90 o ≥220, FC ≤40 o ≥131, T ≤35,0, coscienza
non A all'ACVPU o GCS <15 — o se il NEWS2 fa 7 o più; **♥ ambra** per NEWS2 5–6; niente altrimenti.
Accanto al cuore il NEWS2 e i parametri fuori norma (al massimo due, il più lontano prima: «♥ NEWS 7 · SpO2 88»); nel letto solo l'icona.
Il passaggio del mouse elenca le righe dei parametri con l'ora, l'ultima in alto.
Viene dalle righe dei parametri della **pagina del paziente** (`<tr id="VAMI">`: l'ora, poi
«SATURIMETRIA: **96**» e così via; ci sono anche quelli del triage): conta **la riga più recente**
che porta un parametro, quindi il triage solo finché è l'unica; un parametro che quella riga non ha
non si prende da una riga più vecchia e non si inventa — si conta su quello che c'è. **Non lampeggia**: quando
compare fa un impulso solo, di un secondo (nemmeno quello se il sistema chiede meno movimento), poi
resta fermo. Dopo **4 ore** senza una riga più nuova diventa vuoto, con le ore: **«♡ 5h»**. Si legge
solo quando la pagina del paziente si apre, come lo stato degli esami: un paziente mai aperto non
ha cuore.

**Lo stato degli esami**, su ogni riga: `Lab 3/6 50′` `ECG ✓` `RX 0/1 1h20 ●` — un pezzetto per
tipo, sempre in quest'ordine e ognuno **tinto col colore della sua sezione negli Esiti** (Lab
verde, ECG viola, Imaging magenta); dentro, tornati su chiesti, e se qualcosa aspetta da quanto aspetta il più vecchio: neutro, poi
**ambra**, poi **rosso** (laboratorio 60′/120′, ECG 15′/30′, imaging 90′/180′: le soglie stanno
in cima alla sezione «STATO ESAMI» di `src/core.js`). Il **●**, dentro il pezzetto del suo tipo,
dice che è arrivato qualcosa da quando hai guardato i suoi Esiti — nel Lab **rosso** se fra i
valori nuovi non ancora segnati «Letto» ce n'è uno fuori range. Un tipo mai chiesto non c'è; se
non si sa niente non c'è niente (mai un finto 0/0). In un'area, corto: solo quello che aspetta, o
✓. Letto più di mezz'ora fa diventa grigio, e il passaggio del mouse dice «letto alle 11:02» ed
esame per esame.

**Nel letto, solo nome ed età** — niente righe di stato tagliate a metà. In alto a destra, sulla
riga del letto, il **cuore** (solo l'icona) e **un pallino solo**, se c'è qualcosa: **rosso** per
un esame oltre la seconda soglia, valori nuovi **critici** fuori range (solo gli analiti da guardare
per primi: K, Na, Hb, Trop, Lac, pH, Glu, Cr…) o un promemoria passato; **ambra** oltre la prima
soglia o a 15 minuti da un promemoria; **blu** per un risultato nuovo (anche fuori range, se non è critico); un **cerchio
grigio** se qualcosa aspetta e basta. Il resto — esame per esame, il cuore, la prima cosa da fare —
nel passaggio del mouse, e tutto nella riga della lista. Se il letto è piccolo, prima se ne vanno
il nome del letto e i segni; il nome del paziente mai, e senza puntini.
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
dove ne stanno quanti servono. Nelle aree chi ha qualcosa da fare porta l'icona **Da fare** col
numero accanto al nome, e la prima cosa da fare sotto: un tocco sull'icona apre la sua lista, come
nella riga; nel letto c'è il pallino, e la lista si apre dal menu (**Da fare…**).

**Cercare: basta scrivere.** Una lettera, con i Pazienti davanti e il cursore fuori da un campo (o
la **lente** accanto al ⟳, o **F2** da un'altra pagina), apre un filtro sopra la lista, già con quella lettera: la lista tiene solo chi torna, nella stanza gli
altri si spengono. **Invio** apre il paziente se ne torna uno solo; **Esc** (o la ✕) lo toglie.

**La stanza di partenza è quella del PS**, dallo schizzo del medico: da sinistra l'**OBI** (quattro
letti in fila, OBI 4, 3, 2, 1), l'**OSS** (OSS 1 e 2 sopra, OSS 4 e 3 sotto) e la **Sala attesa**,
alta, a destra; la **Sala attesa 2** sotto l'OBI. Le tre stanze sono divise da due celle vuote,
senza muri. Si vede finché non c'è una stanza salvata e si salva al primo cambiamento; una stanza
salvata non viene mai sostituita. Se togli tutto, la stanza resta vuota, con **Disegna la stanza** e
«o riprendi la pianta del PS».

**Le aree.** La lista è divisa per area — **Alta intensità · OBI · Bassa · Codici minori** (un'area
che il programma non riconosce tiene il suo nome) —, ognuna sotto un filo col suo titolo; chi non ha
ancora un'area sta in cima. Chi sta in un'area lo dice **la lista di quell'area nel gestionale**,
quando la apri: chi c'è entra (anche mai aperto), chi non c'è più ne esce; una lista filtrata
aggiunge e basta. Niente si legge da solo. Il **titolo** apre la lista dell'area: se non è la tua,
passa da **PsoPsoImposta**, sceglie l'area nella tendina e preme **Conferma** — quello che faresti a
mano. **Due mappe**: l'**Alta**, dallo
schizzo del medico — in basso il **Box**, i letti **3, 2, 1** e la **Rossa** (Box e Rossa: un letto
nella sua cornice), sopra le **sedie** (tre in fila, la quarta sopra la Rossa), in alto a sinistra le
due barelle di **Attesa barellati** —, e la **Bassa**, quella del PS (OBI, OSS, sale d'attesa).
Ognuna si ritocca con **Modifica** (una alla volta: quella della vista; con *Entrambe*, quella
dell'area). Un paziente ha un posto solo: messo in una mappa, lascia l'altra.

**Segue il gestionale** (⋯, acceso di norma). Ogni lista non filtrata che apri aggiorna chi sta in
quale area, come sempre. In più, **quando apri l'app sull'iPhone** (o ci torni sopra, o tocchi
aggiorna: al più ogni 2 minuti; il telefono richiede l'elenco 25 secondi dopo) e subito col **⟳**
— mai da solo a tempo —, il pannello rilegge la **lista smart** — tutto il PS, ogni area col suo nome e il
triage, senza cambiare area. La apre **col suo link**, quello dell'icona `elenco_smart.png` della
lista dell'area (`window.open('…menuPsoSmart.do?MVPG=PsoPazientiSmart&PAZIENTI_FILTRO=…')`, annotato
quando lo si vede: mai un indirizzo inventato; finché non c'è, il ⟳ lo dice), in una **scheda dietro**
aperta dal service worker come quelle dei referti: legge, e si chiude; il medico resta dov'è. Della
smart contano le schede dei pazienti di cui il medico risponde — **Ambulatorio** (dove stanno anche
gli OBI) e un'eventuale **OBI** —, non l'attesa del triage né «tutti»: aperta su un'altra, passa
all'Ambulatorio col link della sua scheda. Dopo, passa anche alla scheda **Triage** (col suo link):
le sue righe non entrano fra i pazienti, né nelle aree, né nelle dimissioni — si tengono a parte
(`triage.lista.v1`: nome, età, colore, area, arrivo; niente nascita) per il telefono, e solo se
letta non filtrata e con le righe che dice (una scheda senza il conto si prende com'è); se la scheda non c'è, resta la lista di prima. Le righe non hanno episodio: chi si riconosce (nome e
impronta della nascita, uno solo) prende area e triage della riga; chi no **entra lo stesso**, con
l'impronta per chiave, area e triage — aprirlo passa dalla sua area e dalla sua lista, come un tocco
sulla smart; quando la lista della sua area (o la sua pagina) dà l'episodio, posto, «Da fare» e area
passano a lui.

**Dimesso.** Chi manca da una lettura **intera e riconosciuta** — la smart non filtrata, con le righe
quante dicono le sue schede, o la lista intera di un'area — è **archiviato** e il suo letto si
svuota, con «**ROSSI M. dimesso · Annulla**» per 8 secondi (Annulla lo rimette, al suo letto se è
ancora libero, e per 3 ore non si riarchivia da solo). **Mai** da una lista filtrata o monca, da una
pagina di login o d'errore, da una lista vuota, né quando in un colpo se ne andrebbe **più del 30%**:
allora niente, e nessun avviso. Chi è stato dimesso da qui e ricompare in un elenco torna fra i vivi.

**La lista smart** (tutto il pronto soccorso, nella sua finestra): un tocco su una riga apre il
paziente. Conosciuto — nome e data di nascita, uno solo — la sua cartella, nella scheda del
gestionale; se no si passa alla sua area e lo si apre dalla sua lista, col link della sua riga. Due
uguali: la lista dell'area, e scegli tu. Un indirizzo d'episodio non si costruisce mai.
**Prima il fuoco, poi la pagina**: le pagine del gestionale si ricaricano da sole quando la loro scheda
prende il fuoco (`<body onfocus="refreshOnFocus()">`), e portare davanti la scheda *insieme* alla
navigazione faceva ricaricare la lista di prima sopra PsoPsoImposta — si atterrava sulla lista, senza
area cambiata né paziente aperto. Ora la scheda si porta davanti, si aspetta un attimo, poi si naviga
(e se la pagina ricaricata ha già ripreso il passaggio da sé, non si naviga una seconda volta). E se
si atterra comunque sulla lista dell'area di prima col passaggio a metà, lo si riprende da
PsoPsoImposta, una volta; un «Conferma» perso si ripreme una volta. Il rinvio di PsoPazienti (dopo
«Conferma», 302 a una pagina che rimanda alla lista) si aspetta.

Le mappe sono **griglie di celle uguali** (40 × 24; un letto ne prende 5 × 4, una sedia 4 × 3): allargando o
stringendo la finestra — o allungandosi la lista — crescono o calano tutte insieme, in scala, e **niente si sovrappone**;
non si scorrono mai, né di lato né in giù: a qualunque misura stanno nel loro spazio. Fuori da Modifica si vede solo il
pezzo disegnato: anche una stanza piccola riempie la mappa. Il testo non cambia misura: in un
letto piccolo sparisce prima il nome del letto, coi segni, e il nome del paziente, se è lungo, va a
capo (dopo l'apostrofo, in DELL'ACQUA) invece di perdere l'iniziale; a capo va anche nelle aree. Un letto vuoto è solo il suo nome e un letto disegnato appena; una sedia vuota, il suo nome e una sedia.

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
  chi ha già un posto e, a parte, **Da fare…** e **Togli dall'elenco** — l'icona e la ✕ di chi,
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
nel suo posto, il triage, la prima cosa da fare. Lo **stesso paziente** (stesso codice fiscale) con due episodi:
il più vecchio è **episodio precedente**, in grigio, in fondo alla lista: nella stanza non va. Il posto **non scade**:
resta finché non sposti il paziente, non lo togli dall'elenco o dall'elenco non esce; se non lo apri
da **12 ore** diventa grigio, dov'è.

**Il triage** è il colore che l'intestazione della scheda mostra quando la apri (ROSSO, ARANCIONE,
AZZURRO, VERDE, BIANCO): una striscia a sinistra del nome, la stessa nella lista e nella stanza (nel
letto la porta il letto), e basta — nella stanza il colore vuol dire solo triage. Le uniche eccezioni
sono il cuore dei parametri vitali e l'icona **Da fare**, piccola in alto a destra, che si fa ambra e
rossa quando un promemoria si avvicina.

**Da fare.** Una lista sola per paziente, a **spunte tonde**: le cose da fare e — con un'ora scritta
dentro — i promemoria. Al posto della nota e dei promemoria di prima: la **nota** è diventata la
prima voce senza ora, i **promemoria** voci con l'ora (la prima apertura dopo l'aggiornamento li porta
lì da soli). Si apre **lì dov'è**, senza un'altra scheda, dall'icona **Da fare** dell'intestazione
(accanto agli identificativi) o della riga, o dal menu di chi sta nella stanza (**Da fare…**). E
sulla scheda del paziente sono **sempre in vista in cima** — sotto le allergie, sopra le schede, su
Richieste, Esiti, EO, Consensi e Dimissioni —, come la lista dei Pazienti ma **solo le sue**, con il
campo «Aggiungi per ROSSI M…» (Invio aggiunge a lui); **Da fare** lo riduce a una barra (per conto
suo, `paziente.dafare.v1`); senza voci non c'è, e basta l'icona. In
fondo alla lista dell'icona, un campo su una riga: si scrive e **Invio** aggiunge, in fondo alla lista. Ogni voce è una
riga sola, la stessa dappertutto (la lista, il tabellone, il foglietto sotto la pill, la scheda al
passaggio): `○ 11:42 tropo…` — l'ora, se c'è, davanti, ambra e poi rossa come l'icona. **Un tocco sul
testo** lo modifica (Invio salva, Esc lascia com'era), il **cestino** grigio cancella la voce (su una fatta c'è sempre; su una aperta passandoci sopra). **Un tocco sulla
spunta** e la voce è fatta: barrata, resta al suo posto **5 minuti** (un altro tocco la riapre), poi
se ne va (o subito, col cestino). L'ordine lo decidi tu: si **trascina** dalla maniglia ⋮⋮ (col mouse o col dito), o da
tastiera **Alt+↑ / Alt+↓** sulla spunta. La maniglia, **+15′** e ✕ compaiono passandoci sopra (o col
fuoco; al tocco ci sono sempre). La **prima voce aperta** è il post-it: si legge nelle aree
della stanza (nella riga del tabellone c'è solo quante sono). L'icona dice **quante** sono aperte (nell'intestazione della finestra, la **prima** e «+N»; ambra o rossa, la voce che scade col tempo che manca, come la pill: «⏰ −6m tropo») e cambia colore quando un promemoria si avvicina:
**ambra dai 15 minuti prima**, **rossa quando l'ora è passata** (con un bagliore lento solo nei primi 10 minuti, poi fermo; fermo anche se il
sistema chiede meno movimento); il passaggio del mouse le dice tutte. **Esc**, o un clic fuori, la
chiude: non c'è niente da salvare, ogni gesto è già salvato.

**Con un'ora è un promemoria.** L'orario è il **primo** scritto nel testo, e solo nelle forme che
non si confondono con un valore: un'ora coi due punti, «11:30»; col punto solo dopo «alle», «ore» o
«h» — «alle 9.10», «ore 15.30» —; «11h30», «11h», «alle 14»; o fra quanto, «tra 2h», «+2h», «2h30»,
«90m», «30 min», «30'», «+30′», «tra 45 minuti». Il resto è la cosa da fare. Con una cifra «2h» è
fra quanto, con due «11h» è un'ora. Un numero col punto o la virgola da solo — «Hb 9.10», «K 5,30»,
«PA 120/80» — **non diventa mai un promemoria**: resta una cosa da fare. Un'ora passata da non più di 2 ore
è di oggi (già scaduta), più indietro è di domani: il turno di notte. Mentre scrivi, sotto il campo,
dice quando sarà. Nella lista il promemoria porta la sua ora e **+15′** (da quando era fissato, o da
adesso se è già passato). Ridotto il pannello, la pill mette un segno rosso quando un promemoria è a
10 minuti o è passato — sempre **con la cosa da fare**: «8m · tropo» se è di chi hai davanti,
**«−3m Ferrari · RX polso»** se è di un altro paziente (il suo cognome: un tempo muto accanto al nome
di chi guardi si leggerebbe come suo; il nome intero è nel passaggio del mouse). Un tocco sul segno
apre un menu minuscolo: **✓ Fatto** (sulla pill non c'è dove mostrare l'«Annulla»: lo porta il menu,
per 8 secondi), **+15′** e **Apri** (carica la pagina di quel paziente, con la finestra aperta). I
colori si rifanno da soli ogni 30 secondi, sul posto: niente si ridisegna sotto chi scrive.

Tutto resta **solo in questo browser** (`localStorage`), niente va in rete; lo **stato degli
esami** (`stato.v1`) è per episodio — ore, nomi di esami, mai il nome del paziente —, scade in 24
ore, se ne va con 🗑 e «Svuota l'elenco»; le allergie lette lì dentro se ne vanno anche alla pagina
di login; un altro PC o un altro
profilo Chrome ha la sua stanza. La **stanza disegnata**, una per mappa (`stanza.ps.v1`,
`stanza.alta.v1`: celle intere della griglia, così a ogni misura è la stessa; la sedia è un letto
con `forma: "sedia"`, il Box `"box"`, la barella `"barella"`) resta come i fogli di dimissione: è un
modello, non contiene pazienti. Finché non c'è, si vede quella di partenza, coi suoi id fissi
(«obi1», «rossa»…): chi è messo in OBI 1 ci resta anche prima che la stanza sia salvata. La stanza
di prima (`stanza.v1`, `stanza.posti.v1`) diventa da sola quella del PS, coi suoi posti. **Chi sta
dove** (`stanza.ps.posti.v1`, `stanza.alta.posti.v1`) sono solo numeri di episodio, mai nomi;
**chi sta in quale area** (`aree.v1`) anche; le opzioni dell'area lette in PsoPsoImposta
(`aree.opzioni.v1`) sono un'impostazione. Della data di nascita l'elenco tiene solo un'impronta,
per riconoscere le righe della lista smart. La pagina di
login **non** li cancella: chi viene riaperto dopo una sessione scaduta ritrova il suo letto (il
posto aspetta al massimo un giorno). «Svuota l'elenco» toglie anche i posti; eliminare un paziente
(🗑) toglie anche il suo. **Da fare** (`dafare.v1`) è per episodio: la cosa da fare e l'ora se c'è,
mai un nome; al massimo 15 voci aperte a paziente; una voce con l'ora scade 12 ore dopo l'ora
fissata, una senza 24 ore dopo l'ultima modifica, una spuntata 5 minuti dopo. Nemmeno queste le
cancella la pagina di login — una sessione scaduta non deve far perdere la troponina delle 11:30 —;
«Svuota l'elenco» e 🗑 sì. I **parametri vitali** letti (l'ultima riga: ora e valori, mai un nome)
stanno con lo stato degli esami, in `stato.v1`, e se ne vanno con lui.
Il **tabellone**: la vista scelta (`tabellone.vista.v1`: `alta`, `bassa`, `entrambe`) e `tabellone.modo.v1` (`mappa`, `lista`; la riga di ognuno nella lista del gestionale è `n` in `aree.v1`), «segue il
gestionale» (`segue.v1`, `false` se spento) e il link della lista smart (`smart.url.v1`, com'era
nella pagina) sono impostazioni e restano; l'ultima lettura della smart (`smart.sync.v1`: quando,
com'è andata, quante righe) e l'ultima uscita da annullare (`dimessi.v1`: episodi, «COGNOME N.» e i
posti da rimettere) se ne vanno con «Reset dati pazienti». Chi è noto solo dalla smart sta in
`patients.v1` con una chiave fatta dall'impronta (`sm…`), `smart: true`; l'ingresso in PS è
`arrivo` (un istante, mai una data di nascita). Nella scheda dietro, le schede della smart già
lette stanno in `sessionStorage` (`smart.giro.v1`) e muoiono con lei.

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
   salvato non li ha), e ognuno dice quanti esami porta — «Dolore toracico · 7»: un tocco scrive
   il quesito **e** spunta gli esami che servono quasi sempre.
   - **Dolore toracico** — base (emocromo POC, EGA venosa NEW, creatinina POC), PT e PTT POC,
     troponina US, **RX TORACE 1 PROIEZ.** (una seconda richiesta, di radiologia: il bottone
     diventa «· 2 richieste», vedi sotto).
   - **Dispnea** — base ma con l'**EGA arteriosa NEW** (non la venosa), PT e PTT POC, D-dimero POC,
     troponina US, NT-proBNP (Urgenze: una seconda richiesta, vedi «Una richiesta per erogatore»).
   - **Dolore addominale** — base, EGA venosa, epatico e pancreatico (bilirubina, GPT, GOT,
     GAMMA GT, lipasi), PT e PTT del laboratorio centrale («Fantoli», cioè Urgenze: non il POC) —
     due richieste, POC e Urgenze.

   Il chip scelto è **acceso**. Toccarne **un altro** cambia pacchetto: se ne vanno solo gli
   esami che aveva messo il pacchetto di prima — **quelli che hai scelto tu restano** (anche uno
   che il pacchetto avrebbe messo e c'era già). Toccare **di nuovo** il chip acceso toglie il
   quesito e il suo pacchetto. Un quesito normale (Febbre, Trauma…) scrive solo il quesito, come
   sempre, e lascia andare il pacchetto: gli esami restano, ora sono tuoi. Un esame del pacchetto
   che **non c'è nel catalogo di questa macchina** non viene aggiunto e il pannello lo dice, una
   volta, nel banner e nel Registro: non si inventa mai un codice.
   **Un quesito normale impara il suo pacchetto.** Confermato un ordine il cui quesito l'ha messo un
   chip (non scritto a mano), quel chip si ricorda gli esami — solo i codici, mai di chi — e la volta
   dopo fa come un pacchetto: «Febbre · 5», un tocco scrive il quesito e li spunta, di nuovo li
   toglie. Il prossimo ordine confermato con quel chip li sostituisce (niente da cancellare a mano);
   un esame che il catalogo non ha più si salta. Niente parte senza Conferma. I quesiti scritti da
   te durano un turno, e il loro pacchetto con loro; quelli di partenza (Febbre, Trauma, Sincope,
   Vertigini, Cefalea) lo tengono. Vale anche dal telefono, dove sono chip come gli altri.
   **Una casella sola, «Quesito o esame…».** Quello che scrivi è il quesito; se somiglia a degli
   esami del catalogo (tutti i laboratori), sotto compare una tendina: per prima **«Quesito:
   …»** (Invio: tieni il testo come quesito), poi gli esami. Scelto un esame, nella casella
   **torna il quesito di prima**; Esc fa lo stesso senza scegliere niente. «altri esami…» non
   c'è più (resta solo sulla pagina esami, dove un quesito non c'è).
2. Gli esami stanno in **tre colonne strette** — **POC · Lab · RX** (Lab = le «Urgenze» e il
   laboratorio centrale: per chi ordina sono lo stesso posto) —, **parole da accendere**:
   niente caselle, righe di ~24 px, si tocca la riga intera, scelta è **piena** del colore dei
   comandi. Le uniche etichette sono le tre teste di colonna. La **prima riga di ogni colonna
   sono i suoi profili**: Base PS e Coag POC in POC, Epatico e Coag in Lab. Un profilo che
   raccoglie esami che ci sono anche uno per uno è un espansore — **«Epatico ▸»**: il nome
   prende tutto il profilo, ▸ apre GPT, GOT, GAMMA GT, BILIRUBINA, LIPASI uno per uno (aperto
   da solo se uno di loro è scelto). Poi gli **esami singoli** — fra questi
   **EGA VENOSA NEW** / **EGA ARTERIOSA NEW** (il laboratorio ha rifatto gli emogas: sono i
   codici nuovi, e la vecchia versione si trova solo cercandola), **PT POC** e **PTT POC** (la
   coagulazione che i pacchetti mettono: qui si vede e si toglie) e **SARSCOV** (tampone
   antigenico SARS-CoV-2, laboratorio centrale). Il **quesito RX** compare nella colonna RX
   **solo quando un RX è scelto**. La barra **«Conferma per ROSSI M. · N esami»** (piena, ferma
   in fondo) c'è **solo quando qualcosa è scelto**; **Ctrl+Invio** la preme (lo dice, piccolo,
   dentro la barra), e **solo carrello** le sta accanto, piccolo. Un clic sulla scheda Richieste
   col quesito vuoto mette già il cursore nel quesito. La **Stampa** delle richieste confermate
   non sta più qui: è nel menu **⋯ → Stampa le richieste** (e la «Ristampa» sulla striscia dopo un
   ordine); qui, in fondo, resta solo un link quieto, **Stampa l'ultima richiesta**. Per tutto il
   resto: la casella in cima, con la tendina su tutti i laboratori. Lo stesso esame delle
   Urgenze e del laboratorio centrale (le Urgenze ne sono un sottomenu) è **una riga sola**,
   quella delle Urgenze — la stessa che usano i pacchetti. I selezionati restano in alto, una
   riga per laboratorio, con la ✕ al passaggio del mouse.
   In una sede che la versione **- NEW** non ce l'ha ancora, il pannello ordina **quella di
   sempre** e lo scrive nel Registro — e nella ricevuta, accanto all'esame: «EMOGASANALISI VENOSA
   POC *al posto di EGA VENOSA NEW*». Un codice nuovo non deve far fallire un ordine.
   **La seconda sede (OSG)** non ha il laboratorio «Urgenze»: POC e un laboratorio unico. Gli
   esami della colonna Urgenze vanno nella risorsa di questa sede che ha **lo stesso esame** —
   stesso nome o stesso mnemonico LIS — e **mai** in un POC (un altro strumento, un'altra
   provetta): la PCR del bottone finisce nel laboratorio, non fra i POC. Nella tendina si
   vedono solo le risorse della sede in cui sei (prima ogni esame usciva due volte, una per
   sede), e i nomi di reparto funzionano: **PCR** trova «PROTEINA C REATTIVA» (prima trovava
   solo «PCR POC»), e così PCT, EGA, GGT, AST/ALT, BNP, tropo — il laboratorio prima del POC.
   Accanto a ogni esame, **a colori**, **quando è già stato fatto** in questo episodio (l'ora
   della richiesta tornata, in verde: `TROPONINA US ✓ 11:40, 14:30`) o **da quanto aspetta**
   (`EMOCROMO POC 40′`, in ambra; **rosso** oltre la seconda soglia del suo tipo, le stesse
   dei Pazienti) — stessa fonte dello stato dei Pazienti, stesso nome del catalogo; niente
   quando non si sa, e in grigio con «letto 11:02» se la lettura è vecchia. Un pacchetto
   come «Dolore toracico» spunta come sempre: il suffisso fa vedere il doppione, non lo toglie.
3. **Mentre manda, puoi fare altro.** Partito il giro il pannello **resta com'è**: non si
   nasconde da solo (alla Conferma, a un giro nella pagina, a una pagina che si apre con «Non
   confermata», a una stampa). Ridotto, è una **striscia** in un angolo con il nome del paziente e
   a che punto è — in esami, «esame 3 di 6», non in passi — e il ⏹; aperto, la stessa riga è un
   **chip in intestazione** (chi, «esame 2 di 6», ⏹ o «apri il carrello»). I passi — *creo la
   richiesta*, *invio LIPASI*, *controllo il carrello 2/3* — stanno solo nel pannello aperto del
   giro. Sotto ci lavori normalmente: il gestionale non è bloccato e non compare più
   «vuoi lasciare la pagina?».
   **Se navighi, il giro non muore: riprende.** Il motore vive nella pagina e la pagina muore a
   ogni click, quindi il giro è annotato passo per passo e riparte da solo sulla pagina dopo —
   rilegge il carrello dal server, salta quello che c'è già, manda il resto. L'esame che era
   **in volo** nell'istante del cambio pagina **non viene mai rimandato**: si cerca in
   carrello, e se non c'è il giro si ferma e te lo dice (una provetta in più al laboratorio non
   è un dettaglio). Finito un giro **ripreso**, la pagina **non** te la porta via: il carrello
   lo apri col bottone, e le etichette partono quando torni sulla scheda di quel paziente.
   Un tocco sulla striscia apre il pannello intero (passi + Registro), il quadratino rosso
   ferma tutto. **Esc** non ferma mai il giro, nemmeno col pannello aperto (lascerebbe un
   carrello a metà): riduce il pannello, come ovunque; si ferma col **⏹**. Se intanto sei sulla scheda di un altro paziente la striscia diventa **ambra** e
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
   mostra la stessa striscia — il paziente, «esame 3 di 6» —; un tocco apre il
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
   quel paziente, o sulla lista, il dialogo parte da solo **solo se dalla Conferma non hai
   toccato niente** — un clic o un tasto, nel gestionale o nel pannello, in qualunque scheda: allora
   aspettano un tocco, «Etichette pronte · **Stampa**» (la stampa automatica, senza dialogo, va
   come sempre; un ordine dal telefono aspetta sempre il tocco). E prima di ogni foglio, non solo
   del primo, non mentre scrivi — nel gestionale o in un campo del pannello (cursore in un
   campo, un tasto da poco: aspettano); sulla pagina di un **altro** paziente non si apre da
   solo: «Etichette di ROSSI M. pronte · **Stampa**», un tocco. Senza una scheda del gestionale
   davanti aspettano (mezz'ora; poi dalla sua pagina, ⋯ → Stampa le richieste); la pagina di accesso non
   le butta via.
   **Il gestionale su un'altra area.** L'area è un'impostazione della sessione, e su un'area che
   non è quella del paziente la sua pagina arriva **senza le Richieste**. Se il pannello sa dove
   sta il paziente (la lista della sua area, o la smart), la scheda dell'ordine fa quello che
   faresti tu: **Imposta** → l'area del paziente (una sola opzione, riconosciuta dal nome) →
   **Conferma** → di nuovo la sua pagina (quella che aveva aperto, mai un indirizzo costruito) →
   l'ordine, come sempre. Prima non parte niente. Una volta per ordine, al più due «Conferma» e
   45 secondi: area che in Imposta non c'è, «Conferma» che non passa, Richieste che non ci sono
   nemmeno lì — «Non partito», col perché. Area del paziente che non si sa, o la stessa in testa:
   «Non partito» come prima, mai un'area indovinata. Il passaggio vale per **tutte** le schede di
   quella sessione: la striscia lo dice mentre passa («Parte · passo all'area Alta intensità…») e
   l'esito una volta («… · gestionale ora sull'area Alta intensità»); indietro non si torna da
   soli. Lo stesso per gli ordini dal telefono.
   **Un secondo ordine mentre uno gira aspetta in coda** — la striscia dice «+1 in coda» — e
   parte quando il primo ha finito o si è fermato (sulla sua striscia, «In coda», ✕ lo toglie).
   Vale anche, dal PC o dal telefono, mentre una tua scheda manda esami da sé (sotto: «Quando
   non va in sottofondo»); e quel giro, se intanto gira un ordine in sottofondo, aspetta il suo
   turno **prima di partire** — «In coda» — mai a metà. Il motore è uno solo in tutto il browser
   (regola 19).
   **Niente sparisce zitto, anche qui.** Chiusa a metà la scheda dell'ordine, la striscia dice
   «Scheda chiusa · 2 esami non mandati: …» e «Da controllare» per quello che era in volo (mai
   fra i non mandati). Una scheda che non parte entro 45 secondi è un avviso rosso; una che tace
   da tre minuti si interroga: se risponde era lenta, se no «Ordine fermo» — ma finché esiste
   niente è «non mandato», la coda aspetta e ⏹ la chiude (le letture no: referti, lista smart
   e schede di sottofondo non la aspettano). Col browser caduto la scheda
   ripristinata **non** riprende l'ordine di nascosto: vale il segno di sempre.
   **Quando non va in sottofondo**: col bookmarklet, sulla pagina «Nuova richiesta» (il suo
   modulo vivo non si porta altrove), se l'indirizzo del
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
   **Nessuna richiesta dimenticata.** Col carrello finito — prima della conferma in sottofondo, e
   alla fine di un giro in revisione — il pannello annota la richiesta — solo numeri:
   richiesta, episodio, ora, quanti esami; mai un nome — e la tiene d'occhio: se dopo **2
   minuti** la pagina di quel paziente che hai davanti non la mostra fra le confermate, la
   striscia dice «Richiesta 14:32 non confermata · tocca per il carrello». Vale anche se hai
   cambiato pagina mentre diceva «Confermo…»: la conferma automatica muore con la pagina e non
   riparte da sola più tardi. Vista confermata, il segno se ne va (dopo 12 ore comunque). Al
   server non si chiede niente per questo: si guarda la pagina che hai aperto.
   **Un ordine che non parte si dimentica** («se non parte l'ordine nel carrello, ignoralo»): un
   giro fermato da un errore o da ⏹, o la scheda dell'ordine fermata prima della Conferma, non
   lascia promemoria — né «Non confermata» né «ancora da confermare»: lo dice **una volta** la
   striscia rossa (✕ la chiude). Il promemoria resta solo per un carrello finito e per una
   Conferma premuta e non ancora provata (può essere confermata e non ancora in elenco).
   **Se qualcosa va storto, si finisce a mano nel gestionale.** La striscia diventa **rossa** —
   «Errore · completa a mano» / «Mancano: PTT POC · Da controllare: Troponina»; per un ordine in
   sottofondo comincia da che cosa fare, «TROPONINA US: non mandato · apri il carrello → Riprova»,
   e il perché sta nel resoconto (un ordine che **non è partito** non ha resoconto: il perché lo dice
   la striscia sotto, anche al telefono — «il gestionale non mostra le Richieste: è sull'area Bassa,
   è quella del paziente?» quando la pagina del paziente arriva senza Richieste e la sua area non
   si sa) — e la scheda va
   sul **carrello** della richiesta, sull'erogatore dove il gestionale la tiene (l'ultimo elenco
   che ha dato): una semplice lettura dell'elenco, niente inviato, niente confermato. **Mancano** sono gli esami
   mai partiti: li aggiungi tu. **Da controllare** sono quelli mandati ma non visti in carrello:
   guarda se ci sono prima di aggiungerli — mai due volte. Un tocco sulla striscia: il
   resoconto, corto — il motivo, gli elenchi «Mancano» / «Da controllare» / «Nel carrello», **un'azione
   sola** (↻ Riprova i mancanti, o Apri il carrello) e **Chiudi**; i passi e il Registro stanno
   insieme sotto **Dettagli**, chiuso. Il resoconto non si prende il pannello: è il blocco in
   cima alle **Richieste**, con le schede — si guardano gli Esiti e si torna, «Riprova» è ancora
   lì. Sessione scaduta, episodio che non torna o un'altra
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
   lavoro, né per le richieste in fila fatte dalla tua pagina — laboratorio + radiologia, o due
   erogatori di laboratorio (col bookmarklet: in sottofondo sono ordini separati, ognuno col suo). **Una volta lo fa da solo:** un esame
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
   carrello vero: vuoto si toglie, torna quando il carrello rimesso è finito. Vale con e senza estensione
   (anche col bookmarklet). «↻ Riprova i mancanti» resta com'era.
   **Chiudi** (era «Annulla», ma non annullava niente) toglie il resoconto — la pill torna
   quella di sempre — e ti riporta alle Richieste col quesito. La richiesta lasciata a metà resta
   nel gestionale, ma il pannello **non la ricorda**: niente «non confermata», niente riga «ancora
   da confermare». (Una richiesta col carrello finito e non confermata — lasciata in revisione —
   le Richieste la dicono in una riga discreta — «Richiesta delle 14:32 (4 esami) ancora da
   confermare», con «apri il carrello» e «ignora» accanto.) Restano scelti **solo gli esami che mancano davvero**:
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
   **Una richiesta per erogatore di laboratorio.** Il gestionale non ne vuole due nella stessa
   richiesta: il primo esame del secondo risponde «ORA-20965: AMB_RICHIESTA: Progressivo
   richiesta …-1 già utilizzato» (le due tracce d'errore vere della 3.70.0, POC + Urgenze), e il
   medico, a mano, ne fa sempre una per erogatore. Così fa il pannello: POC, Urgenze, laboratorio
   centrale… una richiesta ciascuno, con lo stesso quesito, nell'ordine delle risorse della
   richiesta (il POC per primo); la radiologia la sua. Il bottone lo dice: **Conferma e stampa ·
   2 richieste** (POC + Urgenze, o laboratorio + radiologia; «Dispnea» e «Dolore addominale» sono
   POC + Urgenze), **· 3 richieste** con anche l'RX. Dopo «Crea» il gestionale è sul primo
   erogatore delle risorse (il POC): per un altro si passa **come fa la pagina**, con la sua
   tendina «Risorsa» — il modulo RisorsaFiltro, all'indirizzo del modulo, col corpo che manda la
   pagina, `RISORSA_ID` e `s_PRESTAZIONE` vuoto — e il server risponde con l'elenco di
   quell'erogatore (se non è di quella richiesta, stop). Un indirizzo con un'altra `RISORSA_ID`
   si legge solo dove la pagina non ha quel modulo. Da un **carrello** si aggiunge solo nel suo
   erogatore (a carrello vuoto, in uno): il resto il bottone lo rifiuta e dice di ordinarlo dalla
   pagina del paziente. Dalla pagina «Nuova richiesta» del gestionale, la prima richiesta è
   quella, e per gli altri erogatori se ne apre una nuova dallo stesso indirizzo.
   Con l'estensione sono **ordini in sottofondo**, uno dopo l'altro, come dal telefono — i
   laboratori, poi la radiologia col suo quesito —, ognuno con i controlli di sempre (la riga in
   carrello, una volta sola, la conferma provata). La tua scheda non si ferma e non si sposta; la
   stampa viene a giri: etichette e liste di ogni laboratorio, poi la prenotazione RX. Col
   bookmarklet (o se la scheda di sottofondo non si apre) le costruisce e le conferma la tua
   pagina, una dopo l'altra, con **una sola** stampa finale: etichette → liste → la prenotazione
   RX; lì le richieste vivono nella memoria del pannello, a metà non si riprendono, e il browser
   avvisa prima di cambiare pagina.
5. **Stampa** (menu **⋯ → Stampa le richieste**, non più in fondo alle Richieste): ogni richiesta con data, ora e la lista compatta degli esami.

### Esiti
Il **Workup**, come in Epic: **Lab · ECG · Imaging** in un posto solo, tre sezioni distinte, ognuna
col suo colore sul bordo e nel titolo (il rosso resta **solo** dei valori fuori range; l'ambra è di
ciò che aspetta; il blu dei comandi e di «nuovo»). Il Lab per primo, a tutta larghezza; sotto ECG
e Imaging, affiancati se c'è posto.

**Aprire un paziente** porta sugli **Esiti se ha qualcosa da guardare** — valori, referti in
pagina o già letti — e sulle **Richieste se non ha ancora niente** (gli Esiti vuoti non servono).
Vale per la pagina appena aperta e per «apri» dalla lista, dalla mappa o da un promemoria.

**Quello che la pagina mostra e il pannello non ha ancora si carica da solo** (con l'estensione),
in sottofondo, appena apri il paziente: è **⭳ Carica i valori** senza il tocco — i valori (lo
storico del portale, o le finestre Risultati) e poi i **referti** che non sono di laboratorio,
**due alla volta al massimo** con la solita pausa a caso, quelli già salvati mai più, l'identità
controllata come sempre. Il **testo** si legge da solo **solo di ECG e radiografie** (dell'ECG
solo il referto scritto del cardiologo: da «Conclusioni» a «Il Medico»); **TC, ecografie, RM,
visite e consulenze** si salvano e basta: un tocco sulla riga li apre nel **visore** (se la
copia non c'è ancora la prende prima, nella stessa fila), mai il testo nel pannello.
**Solo quando c'è qualcosa di nuovo**, mai a orario: un **referto** non ancora salvato (salvato
non cambia più); il **laboratorio** quando la sua **firma** nella pagina cambia. Nelle pagine
vere una richiesta di laboratorio passa da «Prenotata» a «Erogata» (con «Visualizza Risultati»,
cioè una finestra Risultati) a «REFERTO» (il referto del LIS): l'icona di stato col suo titolo,
le finestre Risultati e i referti del laboratorio fanno la firma. Mentre è «Erogata» e i valori
arrivano uno a uno la riga **non cambia**: allora si ricontrolla quando apri gli **Esiti** di
quel paziente, al più **ogni 10 minuti**. **Mentre un ordine lavora** — di qualunque paziente:
il motore che manda, la scheda dell'ordine, una conferma in sospeso, i fogli che vanno in
stampa — non parte niente di nuovo: quello che è già in volo finisce, il resto aspetta e
riprende da solo appena l'ordine ha finito. Si ferma se lasci il paziente (chi era in fila non
parte). **Quello che da solo non è riuscito** (un referto, i valori) non si ritenta a ogni giro:
da solo al più **due volte**, dopo 2 e dopo 10 minuti (i valori anche quando la loro firma nella
pagina cambia); un tocco o un bottone ci provano sempre; un PDF che si è rivelato di un altro
paziente da solo non si riprende più (↺ fa ripartire i referti da capo). Il laboratorio a metà,
con la pagina aperta, si ricontrolla ogni 10 minuti **solo mentre la guardi** (tornandoci, se ne
sono passati 10), e dopo due ricontrolli senza niente di nuovo smette: lo rifà aprire gli Esiti. Mentre lavora, accanto a **↻** c'è solo un discreto **«↓ 2»** — quanti ne restano —
e nient'altro. Non parte mai nella scheda di un ordine, del Ponte, di un giro ripreso o con una
richiesta da confermare.

- **In cima, una riga**: i valori **fuori range** dell'ultimo prelievo di ciascun esame, i più
  gravi per primi (K, Na, Hb, troponina, lattati, pH…), la troponina con la misura precedente e la
  sua ora — `K 5.9↑ · Hb 9.1↓ · Trop 48↑ (12 alle 11:40) · 3 nuovi` —; oltre i sei, «+N». **«N
  nuovi»** conta i valori cambiati dall'ultima lettura e i referti mai aperti: un tocco li segna
  visti. A destra **⭳ Salva i referti (N)** (solo con l'estensione) e, mentre salva a mano,
  «Salvo i referti 2/5…».
- **In attesa**: in ogni sezione, ciò che è stato chiesto e non è ancora refertato — dalle righe
  del diario della pagina senza l'icona del referto — una riga sola ciascuna, con un sottile
  segno ambra a sinistra (niente fascia gialla) e **da quanto** aspetta (`1h20 RX TORACE ·
  richiesto 13:10`). Un esame di laboratorio i cui valori **hanno cominciato ad arrivare** (la
  finestra Risultati c'è) non aspetta più: **«parziale 15:11»**, in grigio, **senza orologio** —
  i valori sono già in tabella. Gli orologi di ECG e immagini restano.
- **Refertati**: una riga per referto, con data e ora, la prima frase che dice qualcosa
  (le conclusioni, se ci sono) e «nuovo» finché non l'hai aperto. Il più recente **non ancora
  letto** che ha un testo (ECG, radiografia) è già **aperto**, finché non ne apri o chiudi uno
  tu. Un tocco apre il **testo lì
  sotto** (un secondo tocco lo richiude), con **⧉ Copia** (ora, esame e paziente in testa, per il
  diario) e **↗ PDF**; **↗ PDF** c'è anche su ogni riga, a un tocco: la copia salvata si apre
  nel **visore** dell'estensione (paziente · esame · data in testa, ✕ o Esc e si torna agli Esiti;
  mai un referto di un altro paziente), altrimenti il documento del gestionale. Nel visore, un
  bottone solo, **Stampa** (già col fuoco: Invio, P o Ctrl+P): con la stampa automatica il PDF va **sull'A4** del medico, dalla
  copia salvata, con lo stesso motore della lista esami (ogni foglio annotato prima di partire,
  una volta sola: un doppio tocco è una stampa); senza, il dialogo di stampa del browser. Dell'**ECG** si mostra **solo il referto scritto** del
  cardiologo, mai le misure o le frasi della macchina; un tracciato senza referto scritto dice
  «Solo il tracciato della macchina». Gli altri documenti (consulenze…) stanno in **Altri
  documenti**, e si aprono nella loro scheda.
- **Di chi è il referto**: prima di mostrare un testo, il codice fiscale scritto nel PDF (o nome e
  data di nascita) si confronta col paziente. Fra i PDF che il portale mostra, quello rimasto
  aperto di un paziente di prima si scarta in silenzio: è normale. Ma se il PDF **scelto** — da
  salvare, mostrare nel visore, stampare o mandare al telefono — si rivela di un altro paziente,
  vuol dire che il pannello ha sbagliato: non si tiene, non si mostra, e lo si dice forte, in
  rosso, sulla riga e sulla striscia: **«Errore grave: questo PDF è di un altro paziente — non
  mostrato»**, e nel registro degli errori (sotto). Dalla striscia lo toglie il suo ✕ «Visto:
  togli»; la riga, il Registro e il registro degli errori lo tengono. Nel PDF non c'è niente da confrontare: il testo
  si mostra con **«intestazione non verificata»**.

**Lab** è un'unica tabella: gli analiti in riga, raggruppati per sezione fissa (*Emocromo,
Coagulazione, Biochim, Organi, Elettroliti e metabolismo, Emogas, Urine e altri liquidi*, e in
fondo **Altri** — i dettagli più sotto), una colonna per prelievo, **il più recente a sinistra**
(marcato «ultimo»). In cima a ogni colonna: **solo l'ora** se il prelievo è di oggi, **la data**
(27/08) con l'ora sotto se è di un altro giorno; **passando il mouse** sull'intestazione si legge
data e ora per esteso e **gli esami** compresi in quella richiesta.

**Fino a tre prelievi** la tabella lunga e stretta lasciava vuoto il resto del pannello: allora
**ogni sezione è un blocco** (Emocromo, Coagulazione, Organi, Emogas…) con **le stesse ore in
testa**, e i blocchi si affiancano finché c'è posto (una griglia, almeno 230 px l'uno, di più con
due o tre colonne). **Nessuna cornice scorre per conto suo**: scorre il pannello, una volta. Da
**quattro prelievi** in su resta la tabella unica di sempre. La riga in cima e il rosso dei fuori
range non cambiano; i referti (ECG, Imaging) stanno sotto il Lab.

- I nomi sono in **sigla** (`Hb`, `GB`, `PLT`…), con l'**unità fra parentesi accanto al nome**
  (`GB (×10⁹/L)`) e il **range nel tooltip del valore**. Il gestionale scrive «x10» e perde l'esponente:
  per i conteggi cellulari — globuli bianchi e formula, piastrine ×10⁹/L, globuli rossi ×10¹²/L — si scrive per
  esteso; ogni altra unità «x10» nuda resta com'è, mai un'ipotesi.
- La **formula leucocitaria** è una riga per cellula: il valore **assoluto** e fra parentesi la
  **percentuale** — `Neu 4.0 (56%)`. Il laboratorio le manda in coppia («Granulociti» e
  «Granulociti %»), che prima erano due righe con lo stesso nome. Il fuori range è quello
  dell'assoluto; una percentuale che arriva da sola resta da sola. Un nome fuori elenco è scritto **per esteso** e sottolineato a puntini — lo stesso
  vale per un'abbreviazione ambigua — e una riga piccola in cima dice **quanti** (**quali** apre l'elenco).
- **Il Lab sempre per primo**, a tutta larghezza; sotto, **ECG e Imaging fianco a fianco** quando la
  finestra è abbastanza larga (misurata sul contenitore, non sullo schermo: dentro la finestra da
  1150 px sì, nella colonna di «Affianca» no); stretto, uno sotto l'altro.
- La tabella (da quattro prelievi) è **larga quanto i suoi numeri**, non quanto il pannello: se allarghi la finestra i
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
  risposto: il pannello dice perché). Poi, con l'estensione, salva i **referti** non ancora salvati
  (ECG, immagini, visite: mai il laboratorio — vedi *Salvare i referti*). Con l'estensione lo fa
  già da solo all'apertura del paziente (vedi sopra): il bottone resta per rifarlo subito.
  **solo alterati** / **tutti** filtra le righe; **↺ Reset** dimentica i valori letti e la scheda
  in archivio di questo paziente, e **⭳ Carica i valori** li rilegge da zero (i tuoi segni
  restano).
- Di un prelievo il gestionale può **non dare data e ora** (né nel campo nascosto della riga, né
  a video). Quei valori **non spariscono**: diventano la colonna **?**, in fondo a destra, con
  «ora ignota» sotto e il motivo nel tooltip. Un piccolo «? 1 senza ora» nella riga del titolo lo dice (il perché è nel passaggio del mouse), e il Registro
  elenca ogni prelievo letto con la colonna in cui è finito.
- **Un tocco su un valore lo segna**: giallo; un secondo tocco arancio; un terzo lo spegne. I segni
  sono tuoi, restano col paziente (24 ore, come una voce di «Da fare» senza ora) e sopravvivono al cambio di pagina.
- **Cosa è cambiato dall'ultima volta che hai guardato**: dopo un **↻ Aggiorna**, in quel prelievo
  un valore cambiato ha **sfondo azzurro**, e lo stesso vale per un analita comparso da zero. Lo
  conta **«N nuovi»** nella riga in cima (il passaggio del mouse dice «N valori nuovi dall'ultima
  lettura»): un tocco spegne i marchi. La prima lettura di un prelievo è sempre il riferimento:
  non è mai un muro di marchi.
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

**I referti di laboratorio** (LIS) **non ci sono** quando la tabella del Lab li può mostrare — c'è
una tabella, o c'è da dove leggerla (estensione e portale) e la lettura non è fallita: lì quello
che dicono è già nei valori. **Senza tabella e senza portale** (il bookmarklet, per dire), o col
portale che la tabella non l'ha data, sono l'unico posto dove si vedono i
risultati finali: allora restano, **chiusi** sotto **«Laboratorio (N)»** in fondo agli Esiti — un
tocco li apre. La scheda **Esiti** non porta nessun numero. Un esito finale non sparisce mai:
«Nessun esito per questo paziente» compare solo quando non c'è davvero niente, nemmeno un referto
o una richiesta in attesa.

- **Il testo** lo legge **pdf.js** — il lettore PDF di Firefox, dentro l'estensione, caricato nella
  scheda solo quando serve: legge quello che legge Firefox (PDF cifrati, oggetti compressi, font di
  ogni tipo, **testo ruotato** come negli ECG in orizzontale). Senza estensione resta il lettore
  interno, più semplice (anche lui legge il testo ruotato). I referti sono **PDF di testo, mai
  immagini**: se il testo non esce è uno sbaglio del lettore, non del referto — il PDF **si tiene**
  lo stesso e si apre, e **⧉ Diagnosi** (nella riga in cima) dice com'è fatto quel PDF (versione,
  cifratura, font, filtri: **mai il contenuto**), per correggerlo. Se il pannello non lo legge ci
  prova il **service worker**; se neanche lui, il pallino è rosso col motivo — e il documento **si
  apre lo stesso, con lo stesso tocco**.
- **Salvare i referti.** Prima era solo una decisione del medico; ora, **su sua richiesta**, lo fa
  anche l'apertura del paziente (vedi in cima agli Esiti). Lo prende l'apertura, un tocco sul
  referto (il testo è lì sotto, e la copia resta: pallino verde), **⭳ Salva i referti** o
  **⭳ Carica i valori** (dopo i valori), che prendono tutti quelli non ancora salvati — ECG,
  immagini, visite e consulenze, **mai il laboratorio** — **due alla volta al massimo**, con una
  breve pausa a caso prima di ognuno, gli altri in fila («in fila» sulla loro riga). Di **ECG e
  radiografie** legge subito il testo; di **TC, ecografie, RM, visite** guarda solo **di chi è**
  (un PDF intestato a un altro paziente non resta) e lo lascia al visore. Quelli già salvati non
  si riscaricano. **Il testo di ECG e radiografie già salvati si legge sempre**, appena apri gli
  Esiti, dalla copia su questo computer: nessuna richiesta.
  **↺** (accanto a «Salva») dimentica le copie e il loro testo. Un referto che non si lascia
  salvare (pallino rosso, il motivo al passaggio del mouse e nel Registro) resta apribile con un
  tocco.
- **ECG e radiologia nel portale**: se il gestionale rimanda il referto al portale clinico, lo
  stesso link si apre in una scheda dietro; là la pagina mostra il PDF e lo script del portale ne
  passa una copia. Il portale può mostrarne più d'uno (quello rimasto aperto prima, poi il tuo):
  si tiene quello di **questo paziente** e dell'esame chiesto, mai semplicemente il primo; se sono
  tutti di un altro, nessuno, e il pallino rosso lo dice. **Una scheda del portale alla volta, per
  tutto il browser** (referti e storico, di tutte le schede e del telefono): ognuna è un accesso
  nuovo al portale, e chi arriva aspetta in fila che quella prima abbia i suoi dati. Lo stesso
  referto chiesto da due parti si prende una volta sola. Se il portale vuole aprire il PDF in una
  scheda nuova, in una scheda dietro non lo fa (la scheda sa da subito di essere nostra); una che
  sfuggisse non ti passa davanti e si chiude da sola — mai una scheda del portale aperta da te.

> Perché i referti restano fuori dalla tabella dei Valori: referto e prelievo sono due cose
> diverse per il gestionale (un referto per documento, un accesso per prelievo, senza una chiave
> comune) e un abbinamento "a occhio" per nome ed ora prima o poi metterebbe i valori di un
> prelievo sotto il documento di un altro. Meglio due sezioni distinte e oneste che una fusione
> plausibile ma sbagliata.

### Chi c'è, e chi è stato dimesso
Nell'elenco **Pazienti** ogni scheda ha **Dimesso ✓**: il paziente esce dall'elenco principale e
finisce fra gli **Archiviati** (in fondo, con il conteggio). Da lì lo si può **↩ riportare** fra gli
attivi, oppure **🗑 eliminare** — e eliminare vuol dire *tutto quello che il programma sa di lui*:
la scheda clinica, i referti tenuti, il testo dei referti letti, «Da fare» e i dati per
episodio di quella scheda del browser. Chiede conferma una volta e non si torna indietro. L'elenco tiene un
giorno e centocinquanta pazienti: un turno è di dodici ore.

**⋯ → Reset dati pazienti** (quando il pannello si incastra): due tocchi («Cancello tutto? Tocca di
nuovo»), poi «Dati dei pazienti cancellati · **Annulla**» per 8 secondi, come per ogni altra cosa
che si può rimpiangere: Annulla rimette tutto com'era (le altre schede e l'estensione si
puliscono finiti gli 8 secondi, o subito se cambi pagina). Via **tutto** quello che sa dei pazienti e del turno — elenco, aree e posti
nelle stanze, stato degli esami, «Da fare», note e segni, valori, referti salvati e il loro testo, schede
cliniche, ordini finiti, richieste da confermare, quesiti, la memoria di ogni scheda aperta, gli
ordini che ricorda il Ponte, la registrazione non salvata e gli ultimi minuti di quella automatica (gli zip salvati,
anonimizzati, restano); dei Tempi resta la durata, non il paziente. **Restano**: stampanti e
stampa automatica, indirizzo del portale, associazione con l'iPhone, fogli di dimissione ed EO,
le stanze, le opzioni delle aree, la finestra. Non c'è mentre questa scheda manda un giro (un
ordine in coda o delle etichette che aspettano non lo tolgono).

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
Non c'è più un campo a parte: la nota è la **prima voce di Da fare** (vedi *Pazienti*), il post-it
che si legge sulla riga. Sulla pagina di un paziente le sue cose da fare sono **sempre in vista**,
senza un tocco, in un posto solo: ridotto il pannello in un foglietto giallo sotto la pill — al più
tre righe (la prima è la nota), poi «+N»; un tocco apre la lista al suo posto —, aperta la finestra
nell'icona **Da fare** dell'intestazione, accanto al nome: la prima voce e «+N». Se non ha niente da
fare, niente. Quelle scritte prima sono diventate voci da sole, sul paziente
giusto: per codice fiscale, o per nome solo se in elenco non c'è un omonimo — una nota di chi non è
in elenco aspetta lì finché scade.

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
— non sono consensi: si danno a chi va a casa, e stanno in fondo alla schermata **Dimissioni**, in una
riga quieta («Moduli per il ritiro ▸») sotto i fogli.
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
  La scheda del portale che hai aperto tu non si tocca. Una tabella che arriva a pezzi si legge
  al più per un minuto. Se in 30 secondi la tabella non arriva
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
  tornarci sopra.

### Dimissioni
In cima, **una riga sola con quello che è ancora aperto**, solo quando c'è qualcosa:
`Aperti: Troponina ultrasensibile (14:30) · RX torace non refertato (13:05) · Da fare: 2 · letto alle 15:10`
— esami in attesa con l'ora della richiesta, referti non arrivati o arrivati e non visti,
quante cose sono ancora in «Da fare», valori segnati da te o nuovi fuori range non ancora letti. Non blocca niente, dice di
quando è la lettura, e copre quello che il pannello sa (la pagina del paziente e gli ordini partiti
da qui: «ordinati da qui» se la pagina non è stata letta).

Nove **fogli di dimissione** pronti — i **cinque rivisti dal medico** stanno in cima, poi una riga
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
  paziente, e restano su questo computer (**Esporta i fogli**, nel menu **⋯**, per portarli su un altro).
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
- **Esporta i fogli** — nel menu **⋯**, solo in Dimissioni — salva i tuoi testi in un file JSON (e negli appunti);
  **Importa i fogli…** li rimette da una
  schermata dove incolli il JSON — entrano **solo i testi diversi dagli originali**, così un
  ripristino non congela per sempre gli altri sette.

### Il pannello sull'iPhone (Ponte)

Sotto le aree, la sezione **«Triage · alle 14:32»**: chi aspetta al triage (le due aree insieme),
come l'ha letto il PC (comando `triage`), dal colore più urgente e a pari colore da chi aspetta da
più tempo; età, attesa e, se nota, l'area; le righe non si toccano. Sparisce se è vuota, se è
stata letta più di 30 minuti fa o se il PC (un'estensione più vecchia) non conosce il comando.
Aprendo l'app (o tornandoci, o con aggiorna) il telefono chiede al PC di rileggere la lista smart
(`triage` con `rileggi`, al più ogni 2 minuti, con «Segue il gestionale» acceso) e richiede
l'elenco 25 secondi dopo: è l'unico giro della smart che parte da solo.

Lontano dal PC per qualche minuto, dal telefono: **i pazienti**, **gli esiti** di uno (con
**↻ Rileggi** e l'ora in cui il PC li ha letti), **un ordine** (lo stesso «Conferma e
stampa», con tutti i suoi controlli), **Da fare** (la stessa lista del PC, sulle Richieste del paziente: ogni voce ha la sua
spunta tonda, l'ora davanti se c'è, il testo; un solo campo **+ nota**, e con un'ora dentro —
«11:30 tropo», «tra 2h ECG» — è un promemoria, se no una cosa da fare. Spuntata, resta barrata fino
a 5 minuti come sul PC; il **cestino** grigio la toglie subito; la spunta di nuovo la riapre. Il
ponte dice `dfAggiungi`, `dfSpunta`, `dfTogli` e, nelle righe dei pazienti, `df`). In **Lista · Mappa ·
Da fare** l'ultima scheda è il Da fare di tutti, per paziente (cognome e posto: un tocco apre il paziente). Nell'elenco ogni riga ha lo stato della riga del tabellone, se il PC lo sa: il **cuore**,
per tipo quello che aspetta col suo tempo («Lab 50′ RX 1h40», l'ambra e il rosso delle soglie) o
**✓** se è tornato tutto, e il **pallino** del letto; «letto alle …» nel titolo, grigio se la
lettura è vecchia. Le schede del paziente sono nell'ordine del PC: **Richieste · Esiti · Cartella ·
Terapia** (si apre sugli Esiti, come prima; «Terapia» solo se il PC la conosce). Accanto al cuore, come sul PC, il NEWS2 e i valori fuori norma
(«♥ NEWS 8 · FR 24 · SpO2 93»). Sotto il nome del paziente una riga **«Parametri 14:10 · PA 120/80 ·
FC 88 · …· NEWS2 2»** dall'ultima lettura del PC (fuori norma in rosso o ambra; da più di 4 ore
grigia, «Parametri di 5 ore fa»); un tocco apre le righe di prima (al massimo 6), un altro le chiude;
niente di nuovo dal gestionale. Tutto succede sul PC, col
gestionale aperto e il codice di sempre: il telefono manda una domanda, una scheda del gestionale la
esegue e risponde. Passa da un ripetitore nel Worker di EKG Atlas (sul suo indirizzo `workers.dev`)
che non può leggere niente: cifrato da un capo all'altro, nessun dato su nessun server.

- **Una volta per turno**: ⋯ → **iPhone** → **Associa l'iPhone**, e si inquadra il QR con la
  fotocamera (accanto, un codice di sei cifre: lo stesso compare sul telefono). Vale 14 ore e per un
  telefono solo, il primo che entra; il QR si rivede solo nei primi due minuti. Regge il browser
  chiuso e riaperto; una scheda del gestionale alla pagina d'accesso chiude la sessione, non
  l'associazione. **Revoca l'iPhone** la chiude prima.
  La pagina dell'iPhone si apre **dentro il pannello**, al posto del corpo (nessuna scheda nuova): ‹ o
  una scheda la lasciano, ridotto il pannello resta com'era, col QR davanti. È la pagina
  dell'estensione in una cornice, non un disegno del pannello: la pagina del gestionale vede la
  cornice ma non ci legge dentro, e il QR porta la chiave. Dove la cornice non si apre (il pannello su
  un indirizzo diverso da quelli del gestionale, un blocco), la pagina va in una scheda sua come
  prima, e il pannello lo dice.
- **La mappa sul telefono**: in testa all'elenco, **Lista · Mappa · Da fare** (la scelta resta sul
  telefono; nessun dato di pazienti) e, in Mappa, **Alta · Bassa** (si parte da quella che guarda il PC).
  Le stanze sono quelle salvate sul PC (o quelle di partenza), disegnate sulla stessa griglia, larghe quanto
  il telefono; due dita ingrandiscono dentro la mappa (o un tocco su un posto vuoto, un altro la riporta intera), che scorre di lato nella sua cornice e resta in cima mentre la lista sotto scorre. Un letto
  occupato porta cognome, età, il colore del triage, il cuore e al più un pallino; i vuoti solo il nome; le
  sale d'attesa le etichette dei pazienti. Un tocco apre il paziente; chi non ha posto resta sotto, «Senza
  posto». Il comando `mappa` manda solo la geometria e chi sta dove (episodi): niente nomi, niente nuove
  letture del gestionale. **Si modifica**: un nome tenuto premuto (mezzo secondo) si trascina su un letto
  o su un'area, o fuori dalla mappa per tornare fra «Senza posto»; lo fa il PC (`posto`, lo stesso gesto del
  trascinamento sulla sua mappa: un posto per paziente, un letto uno solo, le aree molti) e il telefono
  ridisegna dalla sua risposta. Un PC che non lo conosce: mappa in sola lettura, o niente scelta, senza errori.
- **Ordinare dal telefono**: la conferma porta nome intero, età e posto (due righe: «Ordino 2 esami · tocca di nuovo» e, sotto,
  «ROSSI MARIO · 77 anni · OBI 2»; due pazienti con lo stesso nome: «⚠ ROSSI MARIO · …9001 · …», col segno dell'elenco); un doppio tocco non conferma; se la rete perde
  la risposta il telefono dice «Non so se l'ordine è partito» e non lo rifà alla cieca (lo stesso
  ordine rimandato parte una volta sola), a meno che non lo veda già nato sul PC. Niente ordini su un episodio precedente o per un paziente
  dimesso sul PC. Un ordine finito male si vede da ogni pagina del telefono, finché non lo chiudi.
  Sul PC la striscia dice «dall'iPhone». Con una [stazione di stampa](#stazione-di-stampa-le-stampanti-dellinfermeria)
  collegata, sopra il bottone «Stampa: PC · Infermeria» (quella del PC, cambiabile per l'ordine); la
  stazione si collega da qui, **⋯ → Scansiona QR PC stampante**, inquadrando il suo QR.
- **Cartella dal telefono**: anamnesi, remota, farmaci, allergie ed esame obiettivo, scrivibili dove
  la pagina del paziente li lascia scrivere; «Salva» li scrive col «Conferma» della pagina, in una
  scheda di sottofondo, e rilegge. Mai sopra un testo cambiato sul PC o non ancora salvato in una
  scheda; la pagina aperta di quel paziente dice «Aggiornato dal telefono · Ricarica».
  Sopra l'esame obiettivo (solo lì, e solo dove si può scrivere) una fila di chip: i tuoi EO di base per nome,
  poi **Altri…** (Casi e Frasi, in un foglio; la ricerca solo se sono più di 15). I testi sono quelli del PC, con
  le tue modifiche (comando `eo`, niente dal gestionale). Un tocco: campo vuoto, ci va il testo; altrimenti in
  fondo, a capo, mai al posto di quello che c'è. È una modifica della bozza come un'altra — parte solo con «Salva» —
  e per 5 secondi **Annulla** toglie esattamente quello inserito. Un PC più vecchio: niente chip.
- **Terapia dal telefono**: le terapie confermate nella pagina Terapia del gestionale, e
  **＋ Farmaco** (i preferiti, o la tendina della pagina cercata dal PC) fino al riepilogo e a
  **«Conferma per ROSSI M.»**: il PC preme il «Conferma» della pagina, in una scheda di sottofondo,
  una volta, e lo verifica — «Confermata», «Non confermata» col perché, o «Incerto: controlla sul
  PC». Tutto in [Terapia](#terapia-dal-pannello-fino-a-conferma-dal-telefono-conferma-col-tuo-tocco).
- **Si vede sul PC**: finché il telefono è collegato, ogni scheda mostra **«iPhone collegato ·
  Scollega»** (la spia è ferma), e ogni comando va nel **Registro**. Dopo **3 minuti senza comandi** del medico la
  sessione si chiude da sola; tornando sull'app si riapre da sola.
- **Registrazioni** (⋯ sul telefono): gli zip salvati sul PC (⋯ → Registrazioni), con quando, quanto, a mano o
  automatica e perché, il controllo — niente pazienti. **Scarica** lo porta sul telefono a pezzi, cifrato come
  tutto il resto (al più 100 MB), e lo tiene in memoria; poi **Condividi…** lo passa a iOS (all'app di Claude, a
  File), o, dove non si può, **Salva**. **Cancella** (due tocchi) lo toglie dal PC. Ogni comando nel registro del ponte.
- **Prova la rete** (⋯ → iPhone): dal PC dell'ospedale, sulla presa vera del ponte, in pochi secondi
  dice se si raggiunge e quanto ci mette; «Tieni aperto 15 minuti» dice se e perché cade; il testo da
  copiare ha un blocco «Per l'IT». Si apre in una scheda sua: un quarto d'ora deve reggere i cambi di
  pagina del gestionale.

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
tocco sulla striscia mostra la scheda anche mentre il PDF arriva; **✕** — o **Esc**, a scheda
aperta — annulla la stampa e ferma davvero la ricerca del PDF (mentre il PDF arriva un Esc è del
gestionale: una tendina, un campo). Niente velo sulla pagina: il dialogo di stampa del browser è
già lui davanti. Se non finisce (annullata, saltata) la striscia è **ambra**, «Etichette non
stampate · Ristampa», non il ✓ di una stampa uscita.

**Righe multiple**: quando gli esami di una richiesta appartengono a laboratori diversi (POC +
Urgenze, ecc.: le richieste di prima, oggi il pannello ne fa una per erogatore) il LIS la divide in **più righe** — stessa `RICHIESTA_ID`, `RICHIESTA_PROG` 1, 2… —
ognuna col suo PDF etichette e il suo foglio. Si stampano **tutte** ("Etichette — riga 1",
"Etichette — riga 2", poi le liste), mai solo l'ultima.
**Una richiesta per erogatore.** Il gestionale vero, dopo **una** Conferma di un carrello con POC e
laboratorio, fa una richiesta per erogatore, ognuna col suo `RICHIESTA_ID`. Per questo, prima di
ogni giro il pannello fotografa le richieste che la pagina del paziente stampa già (solo i numeri),
e dopo la Conferma stampa quella confermata **e tutte quelle nuove** della pagina — **mai** una che
c'era già. Se le righe sono meno degli erogatori del giro (una richiesta che compare in ritardo), la
pagina si rilegge **una volta**, dopo 4 secondi, e si stampa quello che c'è. Vale anche per la
radiologia.
**Le etichette sono per provetta, non per esame**: 6 esami POC possono dare 5 etichette (una
registrazione vera), e il numero delle etichette da solo non dice se manca qualcosa — lo dice la
lista esami. Una volta (registrazione dell'8 novembre) il gestionale, dopo la Conferma di 5 esami
tutti in carrello, ha messo nella sua riga della pagina del paziente, nella lista esami e nelle
etichette solo i primi 3 inseriti, e così sono rimasti per tutti i cento secondi in cui la pagina è
stata riletta, mentre la stessa richiesta aperta dal modulo Richieste ne aveva 5; un'altra riga non
è mai comparsa. Il pannello stampa quello che il gestionale elenca, e non lo corregge.
Ma se ne accorge, **in silenzio**: quando arrivano i fogli confronta gli esami confermati con quelli
che le righe della pagina elencano per quelle richieste (`DESCRIZIONE_TITLE`, «A;B;C»; le etichette no:
sono per provetta), e se in pagina ce ne sono meno lascia nel registro degli errori una voce
«parziale» (solo i due numeri) che fa partire la **registrazione automatica** — nessun messaggio a te,
la striscia è quella di sempre. Una pagina che non elenca gli esami delle righe non conta.

**Poi la pagina del paziente si aggiorna.** Con l'ordine in sottofondo la pagina del paziente che hai
davanti è quella di prima della Conferma: gli esami nuovi non ci sono. Quando la stampa dei fogli di
quell'ordine è **finita** — l'aiutante li ha avuti tutti (stampa automatica), o li hai stampati qui
col dialogo — la pagina si ricarica da sola dal suo **«Aggiorna»** (il link della pagina a se
stessa: una lettura, mai un modulo rimandato), una volta per ordine, e la striscia resta. Mai prima:
il PDF lo scarica una pagina (la scheda dell'ordine, o questa col dialogo), e una pagina che se ne va
perde il suo. Solo sulla pagina di **quel** paziente, nella scheda che si vede, se è stata caricata
prima della Conferma; durante un dialogo di stampa o un giro aspetta che finisca; e mai mentre scrivi:
allora accanto alla striscia c'è un **Aggiorna** tranquillo, e lo tocchi tu. Etichette che aspettano
il tuo tocco (un ordine dal telefono, o hai toccato qualcosa dopo la Conferma): si ricarica dopo che
le hai stampate.

Sul campo, dopo la Conferma il gestionale **torna alla pagina del paziente**: è lì che la stampa
parte da sola (e se un'installazione mostrasse una pagina intermedia, parte lì se ha i link,
altrimenti aspetta il ritorno sul paziente). Nella scheda di un ordine in sottofondo il ritorno
passa da pagine che il gestionale lascia da sé in un attimo (le etichette LIS, `PsoEpisodio`): da
lì la stampa non parte — i suoi PDF morirebbero con la pagina, «Stampa interrotta» —, parte dal
paziente; una pagina dove la scheda resta più di 3 secondi vale come sempre. **Solo per le richieste di PS Assist**: quelle in cui
il pannello ha mandato esami (o che ha aperto lui), confermate dal pannello o col bottone del
gestionale. Una richiesta fatta tutta a mano nel gestionale, confermata col suo bottone, non
stampa niente da sola. Dalla pagina paziente puoi **ristampare qualsiasi richiesta** (menu **⋯ →
Stampa le richieste**: ogni richiesta è elencata con **data e ora** e, sotto, la **lista compatta degli
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
- **Le due stampanti lavorano insieme.** I PDF delle etichette e quelli dei fogli A4 (liste,
  prenotazione RX) si prendono insieme, e ogni foglio va alla sua stampante appena c'è; sulla
  stessa stampante l'ordine è quello di sempre (la lista, poi la RX). Se un PDF preso insieme
  all'altro non arriva (un errore, la pagina d'accesso, niente), si riprende **una volta, da solo**,
  quando l'altra stampante ha finito — e il service worker lo annota fra gli errori
  («stampa-parallela»): così si vede se il gestionale vero regge due letture insieme.
- **Sotto la striscia, una riga per foglio**: un'icona e l'erogatore — il cartellino delle
  etichette con «POC» o «Lab», il foglio A4 con «POC», «Lab» o «RX», il braccialetto con «×N» (due
  laboratori nello stesso giro si distinguono, «Urg» e «Lab»); chi legge lo schermo sente le parole
  intere, «Etichette POC», «Lista esami Lab», «Prenotazione RX», «Etichetta anagrafica» — e una
  riga, senza icona, per la richiesta che gira, «Lab · 3/6», «RX · 1/1». Ogni riga ha una barretta
  (arriva → alla stampante → fatto) e un piccolo **✕**: toglie **solo quel foglio**, finché aspetta o
  arriva; dato all'aiutante il ✕ diventa una stampantina che respira (dalla coda di Windows non si
  richiama), poi un ✓ verde, e dopo pochi secondi la riga se ne va. Un foglio non uscito resta
  rosso, con **Ristampa** — anche quello che a stampa interrotta non è mai partito — e, a stampa
  finita, accanto un ✕ grigio, **«Visto: togli»**: un tocco, e quell'ordine non si mostra più —
  né le sue righe, né la striscia, né il «!1» —; niente si ristampa, e nel giornale degli ordini
  (e al telefono) resta com'era. (I nomi stanno tutti in `NOMI_RIGA`, in `src/core.js`.)
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
  (la Ristampa resta nel menu **⋯ → Stampa le richieste** del paziente). Una volta sola: ogni foglio parte una volta, e
  uno mandato da un service worker che poi è ripartito è «sconosciuto», mai rimandato. Se la
  scheda dell'ordine si ricarica o si chiude a metà, o premi ⏹, i fogli che restano non partono e
  l'ordine finisce **«Stampa interrotta»**, con **Ristampa** (la richiesta è confermata, e lo
  dice: mai «Scheda chiusa · controlla il carrello»); **Ristampa** rifà i fogli non usciti. Un foglio
  che non è partito per un no detto arriva alla scheda dove sei, come le etichette di prima, col
  motivo sulla striscia; per un ordine dal telefono aspetta un tocco su **Stampa** («Etichette NON
  stampate · la stampante «Zebra ZD421» risulta spenta o offline»). Accanto, il ✕ **«Annulla: non
  stamparle»**: non si stampano, mai un dialogo; il PC non lo ripete, e l'ordine — anche per il
  telefono — dice «Etichette NON stampate · annullate sul PC» (si stampano dalla sua pagina).
  Uscite, la striscia di un ordine dal telefono aggiunge «avvisa chi preleva».
- **La striscia è una sola**, e dice la cosa più seria, fra due pari la più nuova: un errore, un
  avviso da leggere, le etichette pronte qui, l'ordine che gira, la coda, le etichette di un
  ordine dal telefono (aspettano un tocco, ma non coprono il resto), e per ultimo un «Stampato».
  Un ordine finito bene non copre mai quello che è venuto dopo; e mentre un ordine **gira** vince
  lui: un errore o un avviso di prima, non letti, si piegano in un **«!1»** rosso accanto (un
  tocco li mostra, e il loro ✕ li chiude). Una riga sotto la striscia che è di un **altro** paziente porta il suo
  cognome («Bianchi · Lab · 1/2»): il suo ✕ ferma il suo ordine.
- **Ogni avviso che resta si toglie con un tocco**, e **quello che aspetta ancora si annulla**:
  un ordine finito in ambra o in rosso ha il ✕ «Chiudi l'avviso»; un foglio che aspetta o arriva,
  il suo ✕ «Togli solo questo»; l'ordine che stampa, il ⏹; la scheda della stampa, ✕ Chiudi (o
  Esc); le etichette pronte, «Non stamparle adesso» o «Annulla: non stamparle». Nuovi, dove non
  c'era niente: il ✕ «Visto: togli» sulle righe dei fogli non usciti, su «Etichette non stampate»
  (la stampa dal dialogo annullata), su «Esito della stampa sconosciuto» e su «Errore grave» —
  via dalla striscia; il Registro, e il registro degli errori, lo tengono.
- **Si vede che è accesa**: in intestazione, accanto al menu **⋯**, una stampantina; passandoci
  sopra, «Stampa automatica attiva: etichette su Zebra ZD421, A4 su HP LaserJet». Diventa
  **rossa** se l'ultimo foglio non è uscito o ha un esito sconosciuto, e lo dice; con accanto
  **«non installata»** se l'aiutante non c'è più (lo si chiede all'aiutante al più ogni mezz'ora,
  aprendo il pannello). Un tocco apre le Stampanti.
- **L'etichetta anagrafica**: accanto al nome, se la pagina ha il suo «Stampa Bracciale» (per quell'episodio), un braccialetto: ogni tocco entro 400 ms dall'altro è una copia (fino a 10, «×3»), poi una stampa sola all'etichettatrice, col link della pagina preso una volta, dopo le etichette di un ordine che stampa (intanto il bottone tiene «×N», spento, e la sua riga sotto la pill ha la clessidra: al passaggio è il ✕ che la toglie); un tocco mentre esce non fa niente. Senza stampa automatica apre il PDF come il gestionale.
  **Le copie vanno alla stampante in un foglio solo**: all'aiutante un PDF con «copie: 3», e
  SumatraPDF le fa tutte in un lavoro (`-print-settings "…,3x"`) — un avvio, un'attesa della coda,
  invece di tre. L'esito è uno, e vale per tutte: «Etichetta stampata», «Mandata a…», non uscita
  (al dialogo una volta, «3 copie»), sconosciuto. La striscia dice «3 copie», il giornale
  dell'ordine `copie: 3` su ogni copia, il registro dell'aiutante le opzioni («…,3x»). Serve
  l'aiutante dalla **versione 4** (arriva con «Aggiorna app»; l'estensione glielo chiede col
  «ci sei?», e se lo ricorda): con quello di prima, le copie partono una a una come sempre; e un
  aiutante che non ridice «copie: 3» ne ha stampata una: le altre partono dopo, una a una — mai
  «tre» detto per una. La prima volta, tre tocchi e conta che ne escano tre: le copie le fa il
  driver della stampante.
- **Doppio clic sulle icone del gestionale**: con la stampa automatica accesa, le icone di stampa della
  pagina del paziente — le etichette, «Stampa Richiesta», il foglio RX — con **un clic** aprono il PDF come
  sempre (lo stesso link, nella sua finestra: il clic, tenuto 400 ms per vedere se ne arriva un altro, poi
  ridato alla pagina), con **due o tre di fila** (a meno di 400 ms l'uno dall'altro) stampano quel foglio,
  una volta, alla sua stampante, con la sua riga sotto la pill. **«Stampa Bracciale»**: un clic il PDF, due o
  più l'etichetta anagrafica con tante copie quanti i clic (fino a 10): mentre clicchi, accanto all'icona,
  «×2», «×3»… (un segno dell'estensione sopra la pagina, che non la tocca); partita la stampa, una sola, la
  riga sotto la pill «×N». Lo stesso conto del braccialetto nel pannello. Solo i link della pagina, così come sono (stessa origine, il
  servlet giusto, l'etichetta anagrafica di questo episodio); spenta la stampa automatica, o un link che non
  è uno di questi, il clic passa subito, com'è.
- **Le etichette dritte**: SumatraPDF gira di 90° le pagine più larghe che alte, e coi driver
  Zebra, ZDesigner, TSC e Citizen l'etichetta uscirebbe di traverso. Nelle Stampanti,
  «Etichette più larghe che alte: non girarle / girale di 90°» (di partenza «non girarle» per
  quei nomi). La pagina di prova delle etichette ha la misura di un'etichetta. **Prima di usarla
  sui pazienti**, ristampa un'etichetta vera e leggi il suo codice a barre col lettore del
  laboratorio.
- **Si spegne con un tocco**: menu **⋯ → Stampa automatica** (spuntata: accesa; un tocco la
  spegne, un altro la riaccende), o l'interruttore nella pagina Stampanti. Spenta, tutto torna esattamente com'era:
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

### Stazione di stampa: le stampanti dell'infermeria

L'etichettatrice e l'A4 dell'infermiera sono attaccate al **suo** PC, con un cavo: dal PC del
medico non si vedono. Su quel PC c'è la stessa PS Assist, installata come sempre, che fa da
**stazione di stampa**: riceve i fogli degli ordini dal PC del medico (anche quelli partiti dal
telefono), li stampa sulle sue stampanti e dice com'è andata.

- **Una volta, sul PC dell'infermeria** (il medico entra col suo account di Windows): l'estensione
  e la stampa automatica come in [Installazione](#installazione-chrome--edge-pc-ospedale)
  (`stampa\installa.cmd`). Poi le Opzioni dell'estensione (`chrome://extensions` → PS Assist →
  Dettagli → Opzioni) → **«Questo PC fa da stazione di stampa →»**: la pagina **«PS Assist ·
  Stazione di stampa»**. Lì le due stampanti, **Etichette** e **A4**, con **Prova**, e il nome
  («Infermeria»: lo vede il medico). Il gestionale lì non serve; basta Chrome aperto (la pagina può
  restare chiusa).
- **Collegarla, col telefono.** La pagina mostra un **QR** e sotto un codice di sei cifre.
  Sull'iPhone, nell'app: **⋯ → Scansiona QR PC stampante**, e si inquadra il QR: una carta «Stazione di
  stampa · Infermeria», con lo stesso codice, e **Collega**. Il telefono passa l'offerta al PC,
  dentro il ponte; il PC e la stazione fanno la loro chiave fra loro. Poi lo dicono tutti e tre: il
  telefono «Collegata al PC», la stazione «Collegata al PC del medico», il PC in **⋯ → Stampanti**
  «Infermeria · collegata dal telefono alle 14:32», con **Scollega** — e la stazione e il PC lo
  stesso codice. Il QR vale cinque minuti e per un PC solo (poi ne compare un altro); un QR
  scaduto, o di una stazione che non risponde, lo dice e non collega niente; un telefono non
  associato: «Prima associa l'iPhone al PC». Resta collegata finché uno dei due non **scollega** (due
  tocchi, sul PC o sulla stazione): l'altro lo sa subito, o appena si riaccende.
- **Scegliere: «Stampa: Qui · Infermeria»**, nel menu ⋯ del pannello e nella pagina Stampanti, con
  una stazione collegata; si ricorda. Su Infermeria il bottone dell'ordine lo dice («Conferma e
  stampa · 2 esami → Infermeria») e la stampantina in intestazione è «→ Infermeria» (rossa quando
  non risponde). Vale per le etichette e i fogli A4 di un ordine (e per la loro **Ristampa**) e per
  l'etichetta anagrafica; il resto (consensi, «Stampa le richieste», un PDF dal telefono) resta qui.
  Sul telefono, sopra «Conferma e stampa», la stessa scelta, **«Stampa: PC · Infermeria»**: parte
  da quella del PC, e si cambia per quell'ordine.
- **Com'è andata, per quello che è.** «Stampo le etichette in Infermeria…», poi **«Stampato in
  Infermeria»** solo quando la stazione l'ha detto («Mandato in Infermeria» in ambra, o il suo
  errore). La stazione spenta o che non risponde: **«Infermeria non risponde»**, con **Stampa qui**:
  un tocco, e quei fogli escono qui (la stampa automatica di questo PC, o il dialogo), una volta.
  Mai stampati qui da soli, nemmeno per un ordine dal telefono. Il foglio arrivato e la risposta no:
  «Infermeria non risponde · forse stampate: guarda lì prima di stamparle qui» — mai rimandato da
  solo, mai due volte.
- **La stazione riceve fogli e risponde, nient'altro**: non può mandare un comando al PC del medico
  né leggerci niente, e dopo la stampa non tiene niente del foglio. Nella sua pagina, «Ultimi
  fogli»: l'ora, etichette o A4, le pagine, com'è andata — mai un nome.

I fogli viaggiano cifrati da un capo all'altro, come i messaggi del ponte, attraverso lo stesso
ripetitore (fuori dall'ospedale e ritorno: lo dice la regola 9). Come è fatto, la chiave, che cosa
vede l'IT: [`ponte/README.md`](ponte/README.md#la-stazione-di-stampa).

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
  Scadono in **8 ore**, massimo 25, e si azzerano alla chiusura del browser; **↺** negli Esiti, o
  **⋯ → Reset dati pazienti**, subito.

> **Da configurare una volta**: l'host del visualizzatore è dichiarato in
> `extension/manifest.json` → `host_permissions` (oggi `http://10.11.0.151:9080/*`). Se nella tua
> sede è un altro indirizzo, cambialo lì e ricarica l'estensione.

## Registra (una sessione vera, anonimizzata)

Per ricostruire le pagine di esempio, imparare il flusso e i tempi veri e costruire una
«palestra» che si comporti come il gestionale. Solo con l'**estensione**.

- **⋯ → Registrazioni** apre la vista del registratore: **● Registra** fa partire; la pill e
  l'intestazione mostrano **● REC** (un tocco sul ● REC riapre la vista). Lavori come sempre.
  **Ferma e salva** ferma, anonimizza, controlla e **salva lo zip qui, nella memoria
  dell'estensione** (`psassist-registrazione-AAAAMMGG-HHMM.zip`): nessuna scheda, nessuna finestra,
  nessuno scarico — lo fa un documento fuori schermo dell'estensione (`chrome.offscreen`,
  `registra-esporta.html`). Dopo **60 minuti** si ferma e si salva da sola. Il grezzo si cancella
  nello stesso momento in cui lo zip è salvato (se il salvataggio non riesce, resta: «Salva di
  nuovo» o «Cancellala da questo PC»; comunque dopo 12 ore se ne va).
- **Dove il pannello non c'è** (il SISS, il portale, le finestre del referto, l'eViewer) mentre registri
  compare la pill **● Registrando…**: è la stessa pill del pannello ridotto, nello stesso posto in
  alto a destra (solo nella finestra principale, mai nei riquadri); si **trascina**, e resta dove la
  lasci, sito per sito (`storage.local` «registra.pill»), sempre dentro lo schermo. Un clic →
  **Ferma e salva** («Salvo la registrazione…», poi «Salvata: ⋯ → Registrazioni»). Sul gestionale
  resta il ● REC del pannello, senza una seconda pill.
- **Le registrazioni salvate**, nella stessa vista: quando, quanto, **a mano** o **automatica** (e
  perché), il controllo («controllo superato» o «restano N dati da controllare»); per ognuna
  **Riepilogo** (`riepilogo.txt`), **Scarica** (un file nei Download) e **Cancella** (due
  tocchi). Niente pazienti: solo il nome dello zip e i suoi numeri. Le stesse si vedono, si
  scaricano e si cancellano **dall'iPhone** (⋯ → Registrazioni, nel pannello sul telefono). Al più
  **30 zip e 300 MB**: oltre, se ne vanno i più vecchi, prima gli automatici.
- **La registrazione automatica** (accesa di norma; l'interruttore è nella vista): quando non
  registri, l'estensione tiene in memoria **gli ultimi 3 minuti** — stesse pagine, stesse
  esclusioni (credenziali mai), ma nessuna rilettura dalla cache e nessuna pill —, potati di
  continuo e **cancellati quando il browser si chiude** (all'avvio non c'è niente). Quando un
  ordine **finisce male** — la striscia arancione o rossa (un errore, esami che mancano, «Non
  confermata», etichette non stampate o finite nella coda di Windows, una stampa interrotta), un
  ordine fermo, o un «ORA-» del gestionale anche se la richiesta rifatta è riuscita —, quando la
  ricetta SISS si **ferma** o va in errore (non quando è pronta), o a un errore grave della
  Terapia (il motivo dice solo il passo, mai il testo della pagina) — aspetta un
  minuto per vedere com'è finita (intanto i 3 minuti prima non si potano), poi salva **dai 3
  minuti prima a un minuto dopo** come zip **automatico**, anonimizzato e controllato come gli
  altri: un incidente, uno zip. Mentre registri a mano vale la tua. Spenta, quello che aveva in
  memoria se ne va subito. **Quanto costa**: un'istantanea del DOM a ogni pagina che si apre (sul
  SISS al più 15 al minuto) e il flusso osservato, come quando registri; nelle registrazioni vere
  sono 5–20 pagine al minuto di ~45 KB e ~100 KB di flusso al minuto, quindi in memoria, di
  solito, fra 1 e 3 MB; uno zip automatico ne pesa altrettanto. In più un controllo ogni 30
  secondi, solo finché c'è qualcosa da potare.
- **Cosa si registra**, solo sul gestionale, sul portale, sul SISS e sul visualizzatore di immagini: ogni pagina che apri, in ogni scheda
  e finestra (il DOM com'è dopo il caricamento, senza il pannello); il flusso delle richieste,
  solo *osservato* (`chrome.webRequest`: metodo, indirizzo, stato, rinvii, tempi, tipo, scheda,
  e quali le ha fatte l'estensione); il **testo** dei PDF (referti, etichette), con pagine e misura.
  Nessuna richiesta in più al server per le pagine; per un PDF che l'estensione non ha già in
  mano, nella registrazione a mano, **una** rilettura dalla cache del browser (`force-cache`) dello
  stesso indirizzo appena aperto — il riepilogo lo dice.
- **Il registro degli errori** (`errori.json` nello zip, e quanti in `riepilogo.txt`): l'estensione
  annota da sola, in un posto solo (`storage.local`, «errori.v1», al più 500 voci), ogni errore suo
  — un PDF di un altro paziente (impronte di codice fiscale e data di nascita, mai i dati), un
  ordine fermato o non confermato, un foglio non stampato o l'aiutante che non risponde, un
  referto non preso, un errore del Ponte, un'eccezione del pannello o del service worker. Ogni
  voce: ora, tipo, versione, pagina (solo l'MVPG) e numeri, codici, messaggi del nostro codice —
  **mai nomi, codici fiscali, date di nascita, testo libero**; nello zip passa dall'anonimizzazione
  e dal controllo come il resto. Nello zip a mano vanno quelle dall'ultima registrazione a mano
  salvata (restano sul PC: si sposta solo il segno); in quello automatico, quelle dei suoi minuti.
  «Reset dati pazienti» non lo cancella. Sugli errori d'ordine
  più difficili («… non risulta nel carrello», «Conferma non verificata», e il «Riprova i mancanti»
  con com'è finito) la voce porta la **traccia** del giro, quella che il motore ha già sotto gli
  occhi (nessuna richiesta in più): l'ordine, ogni esame col suo codice e la sua risorsa, ogni
  pagina letta o mandata con l'ora, la durata e com'è andata (gli invii, la Conferma, ogni
  rilettura del carrello con i codici che mostrava, la pagina di accesso, un messaggio del
  gestionale), la scheda (sottofondo o del medico, visibile o no) e il tempo totale — per dire se
  è stato il server o il pannello.
- **Cosa non esce mai**: il grezzo resta nella memoria dell'estensione su questo PC (IndexedDB),
  e ne esce solo anonimizzato, nello zip, **qui**, con lo stesso metodo di `tools/esempi.mjs`: ogni
  testo diventa inventato a meno che sia vocabolario del programma (compare per almeno **due
  pazienti diversi**, o nelle pagine di esempio, o nel catalogo); nomi → nomi finti sempre uguali
  per la stessa persona; personale e utenti → `OPERATORE n` / `UTENTEn`; codici fiscali, date di
  nascita, tessere, telefoni, indirizzi, email tolti; anamnesi, esame obiettivo, diario, note,
  allergie → testo inventato della stessa lunghezza; episodi, richieste, referti → altri numeri,
  sempre gli stessi (i collegamenti restano); ospedale e fornitore → `OSPEDALE ESEMPIO`. Dei PDF
  viaggia solo il testo anonimizzato. Niente parte da solo verso nessuno: lo zip lo mandi tu.
- **Il controllo**: prima di scrivere lo zip si rilegge tutto cercando quello che è stato visto
  di vero (codici fiscali, nomi, date di nascita, episodi). Se resta qualcosa lo zip si salva
  **lo stesso**, ma la vista dice «restano N dati da controllare» e lo stesso avviso apre
  `riepilogo.txt`, con il file e il tipo di dato di ognuno — mai il valore: **controlla quei punti
  prima di mandarlo**.
- Dentro: `pagine/NNN-<tipo>.html`, `flusso.json`, `pdf/NNN.json`, `errori.json`, `riepilogo.txt`
  (cosa è stato registrato, quante sostituzioni per tipo, l'esito del controllo, la versione, le
  icone usate; per uno automatico, dopo che cosa), e `eviewer.json` se c'è il visualizzatore.
- **Il visualizzatore di immagini (eViewer)**, quello che apre la fotocamera «IMMAGINE» del paziente
  (`http://mmeviewer.multimedica.root.lan:18188`, un host, ogni porta, http e https: in `host_permissions`
  e nei content script; con «Aggiorna app» Chrome **non chiede niente** — l'estensione non
  pacchettizzata ricaricata ha subito il permesso —, ma una finestra dell'eViewer già aperta va
  riaperta). Si registra come il gestionale — istantanee del DOM (a ogni cambiamento, al più 15 al
  minuto, come sul SISS), il flusso, e in più i **clic** — ma **senza immagini**: le miniature `data:`
  escono già nella pagina, i canvas non hanno pixel, nessun byte d'immagine viene letto. Una sonda nel
  mondo della pagina (`registra-sonda.js`, che conta e basta) dice i contesti dei `<canvas>` (2D/WebGL,
  misura, `preserveDrawingBuffer`), da dove disegnano, i WebSocket e i blob; delle richieste del
  visualizzatore anche misura, `Cache-Control`, ETag/Last-Modified e chi le ha chieste. Anonimizzato
  come il resto, più la sovraimpressione DICOM: `COGNOME^NOME` (anche senza nome noto dal gestionale) →
  nome finto nella stessa forma, nascita spostata (l'età resta), `ID`, accettazione e UID → altri
  sempre uguali, istituto → `OSPEDALE ESEMPIO`, operatori → `OPERATORE n`; il gettone `account` e ogni
  gettone dell'indirizzo → vuoto. Il controllo cerca i nomi veri anche con `^` e girati. In
  `riepilogo.txt` la sezione **Visualizzatore di immagini**: le richieste d'immagine per modello di
  indirizzo (contenuto, misura, cache), canvas, miniature, riquadri, WebSocket, e che richieste fa
  ogni tocco su una miniatura — per decidere come mostrare le radiografie sul telefono.

### Registra sul SISS (Prescrittivo Regionale)

Per vedere com'è fatta davvero una ricetta: identificazione del paziente, compilazione, Anteprima /
Salva / Registra, e il PDF di **Stampa RE**.

- **Dove**: le due origini del SISS, esatte e solo `https` — il menu operatore
  (`https://dcss.cgi.crs.lombardia.it`, `/menusiss/`) e il Prescrittivo Regionale
  (`https://operatorisiss.servizirl.it`, `/prescrittivoRegionale/`). Sono in `host_permissions` e
  nel content script del registratore: **all'aggiornamento Chrome chiede una volta** il permesso
  per questi due siti (accettalo, o il SISS non si registra). Sul SISS **il pannello di PS Assist
  non c'è**: solo `registra-pagina.js` (che lavora mentre registri, e per gli ultimi 3 minuti della
  registrazione automatica), e la pill ● Registrando… mentre registri a mano.
- **Le viste**: il Prescrittivo è un'app che cambia vista senza ricaricare la pagina. Si fotografa
  il DOM al caricamento, a ogni cambio di vista (pushState/replaceState, popstate, hashchange), quando
  si apre o si chiude un dialogo (Anteprima, l'esito di Registra, le tendine) e dopo 800 ms di
  quiete dopo un cambiamento vero; mai due istantanee uguali, al più 15 al minuto. Con i **valori dei
  campi** (testi, tendine, caselle, radio), anonimizzati come tutto il resto. Nello zip:
  `pagine/NNN-siss-<vista>.html` — `siss-menu`, `siss-patient-identify`, `siss-editing`,
  `siss-anteprima`, `siss-registrata`, `siss-stampa`, `siss-accesso`.
- **Le richieste**: le chiamate alle API del SISS (XHR/fetch) con metodo, indirizzo, stato, rinvii e
  tempi, solo osservate; mai un corpo di risposta. Il PDF di Stampa RE: testo anonimizzato, pagine e
  misura; una rilettura dalla cache solo se non è già in mano, e **mai** se il server l'ha mandato
  `no-store` (sarebbe una seconda stampa: il riepilogo lo dice). Gli host fuori dal SISS che le sue
  pagine chiamano non si registrano: il riepilogo ne dice solo il nome.
- **Le credenziali, mai**: password, PIN, OTP, codice di sblocco (per tipo, nome, etichetta o
  `autocomplete`) — il valore non si legge nemmeno, e nei moduli inviati quei campi non si tengono.
  Una pagina d'accesso (smart card, login, o il SISS fuori dalle due app) si registra **solo nella
  forma**: tag e struttura, senza testo né valori; un dialogo con un campo così, idem.
- **Anonimizzazione in più**: banner dell'operatore («Operatore: … Ruolo: …», «<Nome> Medico») →
  `OPERATORE n`; banner del paziente («Cognome: … Nome: … Sesso: … Data di nascita: …», «Id personale:
  … Tessera: … Id MPI: …») → stessa forma con valori finti, gli stessi nei campi, nei dialoghi e nel
  promemoria; NRE, codice di autenticazione / PIN ricetta, numero di protocollo, contatore PAI, Id MPI,
  tessera → altri della stessa forma, sempre gli stessi (anche negli indirizzi delle API). **Restano**
  le parole dell'app (etichette, pulsanti, voci di menu, priorità), i farmaci (AIC e descrizione), le
  prestazioni, le esenzioni.
- `riepilogo.txt` ha una sezione **SISS**: le viste viste, le istantanee per motivo, le richieste al
  SISS, se c'è il PDF di Stampa RE, i campi di credenziali esclusi, gli host fuori.
- **Limiti**: il metodo è a rifiuto di partenza, ma riconosce le persone dalla forma (nomi in
  maiuscolo, «Dott. …», campi del personale): un nome scritto in modo insolito *dentro una frase
  condivisa da più pazienti* potrebbe sfuggire — per questo, prima di mandarlo, **dai
  un'occhiata** a `riepilogo.txt` e a qualche pagina. Le schede di sottofondo aperte dal
  pannello appaiono come schede qualunque. Permessi: `webRequest` (solo osservare) e, per il SISS,
  i due siti qui sopra. Se le API del Prescrittivo stanno su un altro host, il registratore non le
  vede: il riepilogo ne dice il nome, e si aggiunge.

### Ricetta SISS (fino all'Anteprima, mai oltre)

**⋯ → Ricetta SISS**, sulla pagina del paziente, solo con l'estensione. Scegli i farmaci — i
**preferiti** (gli ultimi visti davvero in un'Anteprima del SISS: codice, descrizione, quantità,
in `storage.local`; niente del paziente) o **Cerca nel SISS**, che scrive nella casella «Ricerca
specialistica/farmaco» del Prescrittivo e ti mostra le voci della sua tendina — poi quantità,
«non sostituibile», il quesito (preso da un campo «Diagnosi» della pagina se ce n'è uno, se no
vuoto) e **Prepara nel SISS** (o Ctrl+Invio).

- **Dove lavora**: in una scheda del Prescrittivo **già aperta e già entrata** (con la carta). Se
  non c'è, o è sulla pagina d'accesso, si apre il menu del SISS e il pannello dice «Entra nel SISS
  con la carta, poi riprovo da solo»: appena una scheda del Prescrittivo è dentro, riparte da lì.
  Carta, PIN, login: mai toccati. Una scheda con una ricetta già aperta (compilazione con
  qualcosa scritto, o un'Anteprima) non si usa; nemmeno una dove stai scrivendo.
- **Come**: attraverso l'interfaccia del SISS, come una persona — mai una richiesta fatta da noi.
  Home → «Nuova Prescrizione» → il codice fiscale del riquadro del paziente in «ID Personale» →
  Cerca → **l'intestazione del SISS** (Cognome, Nome, Id personale) deve essere il paziente del
  gestionale, se no **«Errore grave: il SISS mostra un altro paziente»**, nel Registro degli
  errori, e niente si scrive. Poi ogni farmaco scritto nella ricerca del SISS e scelto **col suo
  codice AIC esatto** (le confezioni con la stessa descrizione sono tante), Quantità, «Non
  sostituibile», il quesito, **Anteprima**. Ogni passo si rilegge dalla pagina; una cosa che non
  torna ferma tutto e il pannello dice dove («Fermato su …: completa tu nel SISS»), lasciando
  quello che è scritto.
- **La regola**: si ferma sull'**Anteprima** («STATO: BOZZA») con la scheda del SISS davanti —
  ma non mentre scrivi nella scheda del gestionale che hai davanti (o nel pannello): allora la
  scheda del SISS resta dietro, e la striscia dice «Ricetta · pronta in Anteprima» con **apri il
  SISS**. A che punto è la ricetta lo dice la stessa striscia degli ordini (e il chip a pannello
  aperto), non solo ⋯ → Ricetta; ⏹ la ferma.
  **Registra, Salva, Stampa, Cancella non li preme mai**: li premi tu, dopo aver controllato.
  Seconda guardia: se durante la compilazione la scheda del SISS chiedesse al server di
  *registrare* (lo si vede dal flusso delle richieste, solo osservato), il pannello lo dice in
  rosso — «il SISS sta registrando la ricetta, e non l'ho chiesto io» — e la compilazione si ferma.
  **Dal clic su Anteprima no**: il SISS vero, all'Anteprima, chiama da sé `partition`,
  `prepare-register-request` e `register-prescriptions-by-client-response` (con la carta) e mostra
  la ricetta in **BOZZA** (registrazione del medico). Fino alla 3.75.0 la guardia scambiava queste
  chiamate per un Registra e fermava ogni ricetta con un falso «Errore grave». Ora la scheda
  avvisa il service worker prima del clic, e che la ricetta non sia registrata lo rilegge sulla
  pagina: un'Anteprima «STATO: REGISTRATA» (o con un NRE) è detta in rosso — «all'Anteprima il
  SISS ha registrato la ricetta» — e va nel Registro degli errori. La guardia vale solo mentre la
  scheda lavora per noi (identifica o compila): una ricetta che aspetta le tue scelte nel
  pannello, e tu che nel frattempo fai da te nel SISS fino all'Anteprima, non è un allarme — la
  ricetta è tua e quella del pannello finisce lì (fino alla 3.75.1 era un falso «Errore grave»).
- **Una volta sola**: una ricetta alla volta; la scheda del SISS la riceve una volta (si ricarica
  a metà → si ferma e lo dice, non riparte); i farmaci si scrivono una volta; la stessa richiesta
  due volte è la stessa ricetta. Il codice fiscale e il nome stanno solo in `storage.session` e
  se ne vanno appena la ricetta finisce.
- **Visite ed esami** (ricetta specialistica): si scelgono come i farmaci — dalla ricerca del
  SISS (segnate «visita/esame») o dai preferiti — e si inseriscono nella stessa casella, presa la
  voce col codice esatto; si controlla che la tendina si sia chiusa e che il codice compaia nella
  ricetta. Quantità, priorità e durata non si toccano; il quesito solo se l'hai scritto tu nel
  pannello. **Con una visita l'Anteprima non si preme**: si ferma con la scheda del SISS davanti e
  «Visite inserite: aggiungi quesito e durata, poi Anteprima». Farmaci e visite nella stessa
  ricetta no («Una ricetta alla volta: farmaci o visite»): che il SISS li tenga insieme non è
  provato. Una visita entra nei preferiti (codice, descrizione, tipo) quando è stata inserita.

### Terapia (dal pannello fino a Conferma; dal telefono, Conferma col tuo tocco)

**⋯ → Terapia**, sulla pagina del paziente, solo con l'estensione. Scegli i farmaci — i
**preferiti** (farmaco e dose come li hai confermati nella pagina Terapia del gestionale, i più
usati in cima; la casella li cerca) o un farmaco nuovo scritto nella casella («＋ … da scegliere
nella tendina del gestionale») — poi **Prepara nel gestionale** (o Ctrl+Invio).

- **Come è fatta la pagina** (PsoEpisodioTerapieImposta, MODALITA=PRESCRIZIONE, dal pulsante
  «Terapia» del paziente, `a[title="Apri Terapia"]`): il modulo `EpisodioTerapia` è una tabella
  (`TerapiaTable<episodio>`) con le terapie già confermate (`TERAPIA_PROG_n`, `EPISODIO_ID_n`
  pieni, l'icona «Duplica») e **una** riga nuova vuota in fondo — la sola con la tendina dei
  farmaci: `#DESCRIZIONE` (`DESCRIZIONE_n`), autocomplete di jQuery UI che da 3 lettere, dopo
  mezzo secondo, chiede a `Sa4JsonService.do?FUNZIONE=…&ALT_PARAMS=…&term=…` (una XHR della
  pagina); scegliere una voce scrive `DESCRIZIONE` e, dall'«id» della voce, `CODICE` e
  `PRINCIPIO_ATTIVO` (nelle registrazioni l'id è vuoto: il farmaco lo dice la scritta). Poi
  `QUANTITA_n` (testo, 10 caratteri), `UM_n` e `SOMMINISTRAZIONE_VIA_n` (tendine: una dozzina di
  voci, valore = scritta), `PRESC_DATA_n` (l'ora), `TERAPIA_DILUIZIONE_ID_n` (tendina, 11 voci
  numerate), `CONTINUA_n` e `AL_BISOGNO_n` (spunte), `FREQUENZA_n` (4 caratteri; vuota, il server
  mette 24), `DURATA_n` (1 carattere, «1»), `NOTE_n`; nascosti `EPISODIO_ID_n`, `TERAPIA_PROG_n`,
  `ORIGINE_n`, `CODICE_n`, `PRINCIPIO_ATTIVO_n` (due). **Conferma** (`Update=Conferma`) manda il
  modulo — `TERAPIA_SERIALIZED` lo compone la pagina al clic, con tutti i campi della tabella — e
  il server (302) torna sulla stessa pagina con la riga confermata e una riga nuova (n+1):
  **una terapia per Conferma**. Una riga «aggiungi» la pagina non la mostra (il codice c'è,
  l'icona no), e la lista «multipla» dei farmaci (`PsoFarmaciLov.do`) è una finestra a parte che
  non usiamo.
- **Come**: attraverso la pagina, come una persona. Si apre col **suo** pulsante «Terapia»; si
  controlla che sia del paziente — l'episodio dell'indirizzo e del modulo, la tabella, il nome in
  testa — se no **«Errore grave: questa pagina delle terapie è di un altro paziente»**, nel
  Registro degli errori, e niente si scrive. Poi il farmaco si scrive nella **tendina della
  pagina** e si sceglie la sua voce con la **stessa scritta**, una sola (due voci uguali: la
  scegli tu); dose, unità, via, diluizione, spunte, frequenza e durata nei campi della riga, e
  ogni campo si rilegge. Note e ora mai. Un farmaco nuovo si scrive nella tendina e la voce la
  scegli tu. La riga nuova già toccata da te non si tocca; se scrivi nella pagina mentre lavora,
  si ferma.
- **La regola** (dal pannello): si ferma con la riga scritta e «**Controlla e premi Conferma**» in fondo alla
  pagina. **Conferma, Chiudi, i campi nascosti e `TERAPIA_SERIALIZED` non li tocca mai.** Dopo
  la tua Conferma (la pagina torna con la terapia fra le confermate) scrive il farmaco
  successivo nella riga nuova, e così via; una pagina ricaricata senza Conferma, o una Conferma
  che non si vede fra le terapie, ferma il giro e lo dice — niente si riscrive. Chiudi lo chiude;
  ogni altra pagina del gestionale anche.
- **Mai sopra un ordine**: la tendina è una richiesta nella stessa sessione del server, quindi
  l'apertura della pagina e ogni ricerca nella tendina aspettano un ordine che lavora in
  un'altra scheda («Aspetto che finisca l'ordine in corso…»). E non si parte sopra quello che
  stai scrivendo nella pagina del paziente («Prima finisci nella pagina…»).
- **I preferiti** si imparano da soli quando premi Conferma nella pagina Terapia (l'invio si
  legge e basta): la scritta del farmaco, il codice se c'è, quantità, unità, via, diluizione,
  spunte, frequenza, durata — in `localStorage` del gestionale (`terapia.preferiti.v1`, 60 al
  massimo), mai il paziente, le note o l'ora. Il giro in corso (episodio, nome, i farmaci) sta
  solo nella memoria della scheda e se ne va appena finisce.
- **Dal telefono, Conferma la premi tu, col tocco** (scelto dal medico: rivede il riepilogo sul
  telefono e tocca «Conferma»; il PC preme il «Conferma» della pagina). Sul paziente la scheda
  **Terapia**: le terapie confermate, le più recenti in cima, una riga ciascuna (farmaco, dose e
  unità, via, diluizione, continua/al bisogno, frequenza, l'ora), «Letto sul PC alle … · Rileggi».
  **＋ Farmaco**: i preferiti (un tocco: già pieno, com'era confermato) e una casella che cerca
  nella tendina della pagina (da 3 lettere: una scheda del PC scrive nel campo come una persona e
  riporta solo le scritte delle voci; due voci uguali dal telefono non si scelgono). Dose, unità e
  via in vista; diluizione, frequenza, durata, continua e al bisogno dietro «Altro»; mai le note,
  mai l'ora. Un riepilogo col nome, e **«Conferma per ROSSI M.»**: un farmaco per Conferma.
  Il PC fa il giro di sempre in una **scheda di sottofondo** (comandi `terapie`, `terapiaCerca`,
  `terapiaAggiungi`): la pagina del paziente, il **suo** pulsante «Terapia» (mai un indirizzo fatto
  da noi), gli stessi controlli (un altro paziente: «Errore grave», niente scritto), la voce con la
  stessa scritta (una sola, se no si ferma), ogni campo scritto e **riletto** — qualunque cosa non
  torni: si ferma, niente confermato. Poi **preme il «Conferma» della pagina**
  (`TERAPIA_SERIALIZED` lo compone lei; i nascosti non si toccano) e guarda la pagina che torna:
  la terapia fra le confermate, con un `TERAPIA_PROG` nuovo, farmaco, dose e via uguali, è
  **«Confermata»**; se non si vede, **«Incerto: controlla sul PC»**, e non si ripreme **mai**.
  **Una volta sola**: la richiesta porta un numero, che il service worker ricorda (in
  `storage.session`) anche dopo un suo riavvio o una scheda che si ricarica — «inviato» si annota
  prima del clic —; lo stesso numero rimandato ha la stessa risposta. Lo stesso farmaco confermato
  dopo l'ultima lettura del telefono ferma tutto («rileggi»). Aspetta un ordine al lavoro (la
  stessa sessione del server); mai sopra il tuo giro del pannello o una pagina Terapia di quel
  paziente toccata sul PC («Non confermata: sul PC la Terapia di questo paziente è aperta e già
  toccata»); una pagina Terapia aperta e ferma lo viene a sapere («confermata dall'iPhone… · Riapri»).
  Ogni no nel Registro degli errori e nella registrazione automatica («Terapia telefono: …»); la
  conferma riuscita impara il preferito, come la tua. L'ultima lettura sta in memoria
  (`storage.session`), solo con un iPhone associato, e se ne va con la sessione del telefono.
  Un PC più vecchio: niente scheda.

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
   lettura dell'elenco, quello che il gestionale stesso mostra, sull'erogatore dove tiene la
   richiesta (l'ultimo elenco che ha dato: per un altro c'è il «Risorsa» della pagina) — senza inviare né confermare
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
   salta affatto: il resoconto viaggia con la striscia. Dopo una conferma non si ricarica niente
   per cercarne la prova: la prova si legge in sottofondo (regola 5). La pagina del paziente si
   ricarica solo a stampa finita, dal suo «Aggiorna», con questo stesso controllo (vedi «Stampa
   etichette e lista esami»).
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
   chiude dopo 3 minuti senza comandi, la spia «iPhone collegato» e il Registro:
   [`ponte/README.md`](ponte/README.md). Lo stesso host e la stessa cifratura per la **stazione
   di stampa** (un'altra stanza del ripetitore, regola 21): i fogli di un ordine, PDF con nomi di
   pazienti, vanno dal PC del medico a quello dell'infermeria passando dal ripetitore — escono
   dall'ospedale e ci tornano, cifrati da un capo all'altro; il ripetitore non li legge né li
   tiene. Solo con una stazione collegata e scelta («Stampa: Infermeria»).
   **E una seconda, per gli aggiornamenti (⋯ → «Aggiorna app»):** il service worker legge
   `ps-app/dist/VERSION.txt` da `raw.githubusercontent.com` (una volta al giorno e aprendo il ⋯) e,
   solo al tocco del medico, `ps-assist-latest.zip` — due GET senza cookie, senza referrer e senza
   niente dell'ospedale (`aggiorna.js`). Lo zip va all'aiutante su questo PC, che controlla
   chiave e versione del manifest e scambia la cartella dell'estensione; mai con un ordine, una
   stampa o un giro in corso.
10. **Due schede, due pazienti, zero interferenze**: i passaggi di consegna tra pagina e pagina
   (ricevuta e conferma automatica) vivono nella singola scheda (sessionStorage).
   **La scheda dell'ordine.** Con l'estensione il giro lo fa una scheda di sottofondo, e tutti
   i controlli di sempre sono suoi: episodio, sessione, presidio prima di ogni invio, carrello
   identico alla ricevuta, «Confermata» solo con la prova, l'esame in volo mai rimandato (e
   annunciato al service worker prima di partire: se la scheda muore lì, è da controllare). Chi
   è la scheda dell'ordine lo sa il service worker, per numero di scheda (`storage.session`,
   che muore col browser e non sta su disco), e **solo finché l'ordine gira**: finito, si slega
   — mai l'esito o le etichette di un altro paziente scambiati per i suoi. Parte **una volta
   sola**, un motore alla volta; la coda non va avanti finché la scheda di prima esiste.
   **Sull'area sbagliata** (la pagina del paziente senza Richieste) passa il gestionale a quella
   del paziente come il medico, Imposta e Conferma, solo se la sa (mai indovinata), prima di
   «parto» e una volta per ordine; l'appunto è suo, così una scheda del medico che si carica
   intanto non preme niente. La
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
    **svuota** a mano e **🗑** per cancellare tutto di uno. **Da fare** sta nel `localStorage`
    (`dafare.v1`) per episodio: la cosa da fare («tropo») e l'ora se c'è, mai un nome; al massimo 15
    voci aperte a paziente, scadono 12 ore dopo l'ora fissata (24 dall'ultima modifica senza ora, 5
    minuti dopo la spunta), la pagina di login non le tocca (sopravvivono a una
    sessione scaduta, come il posto nella stanza), **svuota** e **🗑** le tolgono, e non vanno da
    nessuna parte: non c'è una richiesta, né una notifica fuori dal pannello. Ma valori e testi dei referti letti in un turno stanno nel
    `sessionStorage` della scheda: **Chrome lo tiene anche su disco**, nel profilo, per poter
    ripristinare le schede — muore chiudendo la scheda, non prima. I PDF salvati stanno nella
    memoria dell'estensione (su disco), scadono dopo 8 ore, massimo 25, e si azzerano alla
    chiusura del browser. Le **schede cliniche** (tabella multi-prelievo, testi dei referti letti)
    stanno nella memoria dell'estensione, quindi **su disco**: un turno dura dodici ore e non si
    può perdere tutto chiudendo il browser. Scadono da sole **24 ore** dopo l'ultima lettura, al
    massimo 200 pazienti, e **🗑** su un paziente archiviato le cancella subito — schede, referti
    tenuti, «Da fare». La pagina di login cancella il resto — ma il `sessionStorage` è
    **per scheda**: pulisce la scheda in cui è comparso il login, non le altre schede aperte.
    **⋯ → Reset dati pazienti** toglie tutto questo in una volta, in tutte le schede aperte.
    Su un PC condiviso: usa un profilo Chrome tuo e chiudi il browser a fine turno.
15. **Niente parte da solo, e niente si inventa.** Aprire la pagina di un paziente non legge
    **nessun** valore: cliccare un paziente non è chiedere il laboratorio. I valori si leggono
    quando li chiedi — aprendo un prelievo, o con **⭳ Carica i valori** che li prende tutti, uno
    alla volta, insieme allo storico del portale aperto in sottofondo dal link della pagina —
    e un prelievo che ha già fallito non si ritenta da solo. **Un PDF non si salva mai da
    solo**: lo prende un tocco sul referto, **⭳ Salva i referti** o **⭳ Carica i valori** negli
    Esiti (mai il laboratorio), due alla volta al massimo con una pausa a caso prima di ognuno (gli
    altri in fila, e la riga in cima dice a che punto è), dal link del gestionale o dal portale
    come sempre, col controllo d'identità della regola 18; il testo dei PDF già
    salvati si legge invece sempre, dalla copia su questo computer, senza chiedere niente. E la tabella
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
    (`attesa`, `mandato`, `stampato`, `fallito`, `sconosciuto`), scritto **prima** di mandarlo — le
    copie dell'etichetta anagrafica, in un lavoro solo, lo hanno insieme, con `copie: N` —; un
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
18. **Il testo di un referto si mostra solo se è di questo paziente.** Ogni testo letto da un PDF
    passa da `identitaReferto`: il codice fiscale scritto nel PDF contro quello del paziente (il
    riquadro della scheda, o l'impronta di quello dei prelievi), o — senza codice — nome **e**
    data di nascita. Se non torna: «Referto di un altro paziente: non mostrato», niente
    anteprima, niente copia, niente scheda clinica, e la copia salvata del PDF si cancella. Se il
    PDF non porta un'intestazione da confrontare si mostra, con **«intestazione non
    verificata»**. Il controllo si rifà a ogni disegno (il codice fiscale può arrivare dopo il
    testo). Nella scheda del portale aperta per un referto non si tiene il primo PDF che passa:
    si raccolgono quelli che la pagina mostra e si tiene quello di questo paziente (e, a parità,
    dell'esame chiesto); se sono tutti di un altro, nessuno.
19. **Mentre un motore manda esami, nient'altro tocca il gestionale.** La richiesta «corrente»
    sta nella **sessione** del gestionale, una per tutte le schede: una pagina del modulo
    richieste aperta a metà ordine (la lista smart riletta dietro, le etichette di un altro
    ordine, un referto, una lettura dal telefono) la cambia sotto il motore, e l'inserimento
    dopo risponde «ORA-20965: AMB_RICHIESTA: Progressivo richiesta …-1 già utilizzato» col
    carrello vuoto (3.70.0: a metà degli esami POC; al primo esame del secondo erogatore è
    invece la richiesta con due erogatori, che il pannello non fa più — vedi «Una richiesta per
    erogatore di laboratorio»). Quindi: ogni lettura dell'estensione (`fetchDoc`, `fetchPdf`)
    aspetta finché un motore lavora in un'**altra** pagina — un ordine in sottofondo che il
    service worker dice partito o in corsa, o il motore di una scheda (un giro della scheda del
    medico, la sua conferma nella cornice, il giro della scheda dell'ordine). **Il motore è uno
    solo in tutto il browser, e lo tiene il service worker**: chi parte lo chiede (`motore` in
    `storage.session`: quale scheda, da quando), lo rinnova ogni 4 secondi finché lavora e lo
    molla alla fine; non rinnovato scade in 15 secondi, e una pagina che se ne va con un giro da
    riprendere non lo molla — lo riprende la stessa scheda. Chi lo chiede mentre lo tiene un
    altro aspetta **prima di partire**, mai a metà; un ordine nuovo, dal PC o dal telefono, va
    in coda. (Col bookmarklet, senza service worker, lo dice il battito `motore.v1` in
    localStorage.) Un ordine «muto» — «Ordine fermo · ⏹ la chiude» — tiene la coda ma non le
    letture. La lista smart non si rilegge (riprova al giro dopo); le schede
    di sottofondo (referto, storico, telefono) si aprono dopo, e così la scheda che dà i PDF di
    una stampa chiesta dalla scheda del medico; i PDF di una stampa aspettano la fine del motore
    (al più 4 minuti), e il motore dopo aspetta che quei PDF siano presi. Le etichette non vanno a
    una scheda mentre lei stessa manda esami. Le domande del service worker alle schede (ci sei?
    le etichette, il ⏹) non tengono ferma la fila degli ordini: una scheda bloccata non ferma
    gli altri. Un ordine finito resta in memoria quanto serve a chi lo guarda: andato bene, i
    due minuti della striscia; se no mezz'ora. **Un ordine, un
    motore**: il piano lo riceve una scheda sola (`consegnata`), e la scheda vuota che si
    sostituisce dopo 6 secondi è solo quella che il piano non l'ha mai avuto, chiusa prima che
    nasca la nuova. Un «ORA-» nella risposta a un inserimento ferma **subito** quella richiesta,
    senza riletture né altri invii lì dentro. Il cancello copre solo le nostre letture: la
    sessione può perdere il carrello anche per altro (3.71.1 e 3.73.0, ordini di soli esami POC:
    l'«ORA-» a metà, il carrello riletto vuoto) — le pagine del gestionale si ricaricano da sole
    prendendo il fuoco, e il medico intanto clicca. Così una richiesta **nata nel giro** (dalla
    pagina del paziente) si lascia com'è — mai confermata, nessun promemoria — e il giro si rifà
    **da capo una volta**: dopo 2 secondi, «Crea» di nuovo, tutti gli esami di quella richiesta;
    il Registro e la traccia lo dicono, e la riuscita va nel registro degli errori con la traccia
    di tutte e due. Un secondo «ORA-» (o uno in un giro partito dal carrello, o ripreso) è
    l'errore di sempre: la striscia dice «Il gestionale ha risposto: …» (l'esame in volo resta
    «da controllare»), e l'errore va nel registro con la traccia. Prova: `test/ext-sessione.mjs`,
    e `opts.carrelloPerso` di `test/gestionale-vero.mjs`.
20. **Una terapia dal telefono: un «Conferma», una volta, e visto.** È l'unica Conferma che il
    programma preme nella pagina Terapia, perché il medico l'ha scelto: il suo tocco su
    «Conferma per …» dopo il riepilogo. Prima del clic: la pagina aperta col pulsante del
    paziente, l'episodio (indirizzo e modulo), il nome e la tabella — se no «Errore grave» —; la
    voce della tendina con la stessa scritta, una sola; ogni campo riletto (quello non scritto
    com'era, le note e l'ora sempre vuote); nessuna terapia con quel farmaco confermata dopo la
    lettura del telefono; nessun ordine al lavoro; la Terapia di quel paziente non toccata in una
    scheda del medico. Il service worker annota «inviato» (col numero della richiesta, in
    `storage.session`) **prima** di dire alla scheda di cliccare: dopo, la pagina che torna — o
    che si ricarica, o un service worker ripartito — si guarda e basta, e una Conferma che non si
    vede è «Incerto: controlla sul PC», mai rifatta. Prova: `test/ext-terapia.mjs`.
21. **La stazione di stampa: fogli in un verso, esiti nell'altro; mai altrove da soli, mai due
    volte.** Dove stampa un ordine si decide quando nasce (`dest`, `stampaDove` in `bg.js`) e non
    cambia: un ordine per la stazione che non la trova dice «Infermeria non risponde», non stampa
    qui. Il motore è lo stesso (`ordStampaFogli`: il foglio «invio» scritto prima di partire, il
    PDF preso dalla pagina coi controlli di sempre); al posto dell'aiutante c'è `stazioneStampa`
    (`stazione-sw.js`): il PDF va a pezzi cifrati alla stazione, che lo stampa col suo aiutante
    solo all'ultimo pezzo, una volta per numero (`rq`, annotato prima di stampare: rimandato,
    risponde com'è andata; dopo un riavvio a metà, «sconosciuto»), e dice il suo esito. Nessun
    pezzo arrivato: «non risponde» (non stampato); l'ultimo arrivato e la risposta no: si chiede
    l'esito su una sessione nuova, e se non si sa, «forse stampato». Un foglio che la stazione non
    ha stampato non va mai da solo all'aiutante di qui né al dialogo (`ordConsegnaStampa` lo
    salta): aspetta **Stampa qui**, un tocco. Dal canale della stazione il PC accetta solo le
    risposte alle sue domande, i saluti e la revoca: un comando, un evento, una risposta a una
    domanda mai fatta si scartano. La chiave nasce fra il PC e la stazione (ECDH): il telefono
    che passa il QR non la conosce. Sulla stazione, del foglio resta solo il numero e com'è andata
    (e, per la sua pagina, l'ora, il tipo, le pagine). Prova: `test/ext-stazione.mjs`.

> **Postazione condivisa**: `localStorage` e la memoria dell'estensione sono legati al **profilo
> Chrome**, non al login dell'ospedale. Usa l'estensione in un profilo tuo. Se il profilo è
> davvero condiviso, non usare **⭳ Salva i referti** né **⭳ Carica i valori**, né aprire i referti (i PDF resterebbero su disco fino a 8 ore), e a fine turno **⋯ → Reset dati pazienti**.

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
   ripeti i punti 3–5 riga per riga — sono **due** richieste, una per erogatore, e nella
   seconda il passaggio a Urgenze è il «Risorsa» della pagina.
8. **Esercitazione di interruzione.** Lancia un run e premi il quadratino rosso a metà; tocca la
   striscia, leggi il messaggio e controlla il carrello col bottone "Apri il carrello e
   controlla". Regola permanente: **dopo qualsiasi striscia rossa mai rilanciare da capo a occhi
   chiusi** — sei già sul carrello: o si sistema a mano, o **↻ Riprova i mancanti** (solo quelli
   mai partiti, sulla stessa richiesta: la prima volta guarda nel carrello che niente sia
   doppio), e si controllano le bozze sull'episodio.
9. **Radiologia (solo dopo qualche giorno di laboratorio pulito).** Prima apertura nativa di
   "Richieste Radiologia" (apprendimento del catalogo), poi un solo RX torace dal pannello, con
   verifica in radiologia che la richiesta sia arrivata unica e con il quesito giusto.
10. **Auto-conferma (ultima fase, opzionale; laboratorio e radiologia, con gli stessi
    controlli).** È **immediata**: primo uso con 1 esame
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
├── test/fixtures/       ← la tabella dello storico e la pagina Terapia, ricostruite dalla loro forma (dati inventati)
├── extension/           ← estensione MV3 pronta da caricare (content.js è generato)
├── extension/pdfjs/     ← pdf.js 3.11.174 di Mozilla (Apache-2.0), preso tale e quale: legge i referti
├── extension/ponte-*    ← il Ponte verso l'iPhone: la presa nel service worker, la pagina «iPhone»,
│                          la prova della rete; qr.js è il codificatore QR di Project Nayuki (MIT)
├── extension/stazione*  ← la stazione di stampa: stazione-sw.js (service worker: il PC del medico che manda i fogli,
│                          e la stazione che li stampa), stazione.html/.js (la pagina «Stazione di stampa»)
├── extension/tabellone.html ← ⋯ → Tabellone: carica content.js, che lì disegna solo il tabellone (dallo specchio)
├── ponte/               ← il Ponte: README, host.txt (il suo indirizzo, fissato nella build), il
│                          ripetitore Node per test e prove (stessa logica di ../worker/ponte-logica.js);
│                          l'app del telefono sta in ../public/ponte/
├── extension/registra*  ← ⋯ → Registrazioni: registra.js (service worker), registra-pagina.js (nella pagina,
│                          anche sul SISS), registra-pill.js (la pill: regole CSS da core.js),
│                          registra-db.js (il suo IndexedDB: grezzo, ultimi minuti, zip), registra-esporta.html/.js
│                          (il documento fuori schermo che salva lo zip), registra-anonimo.js (anonimizza e controlla),
│                          registra-sonda.js (nell'eViewer, nel mondo della pagina: canvas, WebSocket, blob — conta e basta)
├── tools/build.mjs      ← genera extension/content.js, il bookmarklet, extension/ponte-cripto.js,
│                          extension/ponte-host.js, extension/registra-pdf.js, registra-pill.js e registra-vocabolario.json
├── tools/icons.mjs      ← genera le icone PNG (niente binari a mano)
├── bookmarklet/         ← piano B per PC bloccati: un preferito, zero installazione (generato)
├── stampa/              ← la stampa automatica per Windows: installa.cmd, l'aiutante host.ps1 e SumatraPDF.exe (ufficiale 3.6.1, GPLv3, nello zip: installa.cmd non scarica più niente); ripristina.cmd
├── extension/ricetta-*  ← ⋯ → Ricetta SISS: ricetta-sw.js (service worker: la ricetta, la scheda, i preferiti),
│                          ricetta-siss.js (nella scheda del Prescrittivo: compila e si ferma sull'Anteprima)
├── extension/aggiorna*  ← ⋯ → «Aggiorna app»: aggiorna.js (service worker: VERSION.txt, lo zip, l'aiutante, la ricarica),
│                          aggiornata.js (la pillola «Ricarica la pagina» nelle schede rimaste col pannello vecchio)
├── tools/verifica-build.mjs ← al rilascio: la build, lo zip e la versione committati sono quelli di adesso
├── esempi-gestionale/   ← pagine vere del gestionale, contenuti inventati (+ come)
├── tools/esempi.mjs     ← genera esempi-gestionale/ dagli originali (che restano fuori)
└── test/                ← simulatore SA4PSO + 108 scenari e2e in Chromium reale (+ storico, referti, ordine in sottofondo, stampa automatica);
                            gestionale-vero.mjs lo avvolge con quello che hanno mostrato le registrazioni vere (il «Risorsa» RisorsaFiltro,
                            l'«ORA-20965» di un secondo erogatore nella stessa richiesta, il carrello perso a metà ordine,
                            il foglio «Stampa Richiesta Radiologia»)
```

Sviluppo:

```bash
cd ps-app
npm install        # solo playwright e ws, solo per i test
npm run build      # rigenera extension/content.js + bookmarklet (+ ponte-cripto.js, ponte-host.js) dopo modifiche a src/
npm run esempi     # rigenera esempi-gestionale/ dagli originali e verifica che sia pulito
npm run dist       # al rilascio: build, fogli di dimissione, dist/ps-assist-latest.zip (con stampa/ e SumatraPDF)
npm run verifica-build   # al rilascio, dopo dist e il commit: build fresca = build committata? zip e versioni giusti?
npm test           # 108 scenari e2e + le prove con l'estensione vera (ordine in sottofondo, scheda nascosta, stampa automatica, ponte, registra, aggiorna, tabellone, terapia) + storico + il cancello privacy (+ l'aiutante di Windows, con PowerShell 7: PWSH=…)
                   # + l'ordine in una scheda DAVVERO nascosta: Chrome senza Playwright, CDP grezzo (test/ext-nascosta.mjs; serve openssl)
                   # + il Ponte: 120 controlli senza browser (cifratura, ripetitore, Worker) e 166 dal vivo (test/ext-ponte.mjs)
                   # + la stazione di stampa: due PC veri, il telefono che inquadra il suo QR, gli ordini (test/ext-stazione.mjs)
                   # + le aree, su pagine sintetiche: sezioni, PsoPsoImposta, mappa dell'Alta, lista smart (test/aree.mjs)
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
(striscia rossa, «Mancano» separati da «Da controllare», il carrello dell'erogatore della richiesta, zero
invii dopo), **↻ Riprova i mancanti** (partono solo quelli mai partiti, contando gli
inserimenti: mai i «da controllare», mai quelli già in carrello o tolti a mano; nello stesso
modo del primo giro — una conferma sola, alla fine — o in revisione sul carrello; due errori
di fila, coi «da controllare» ancora in elenco; lontano dal carrello prima «Apri il carrello»;
senza richiesta nata, un giro normale) e **Chiudi** (il quesito resta, restano scelti solo i
mancanti e il bottone li conta giusti, la pill torna normale, la richiesta lasciata a metà non
resta sorvegliata né la riga in Richieste la dice), **Svuota il carrello e ricomincia** (due tocchi, il
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
il **Workup** degli Esiti (i valori fuori range in cima, Lab · ECG · Imaging, le richieste in
attesa con da quanto, «↗ PDF» su ogni riga, il testo che si apre lì sotto) e i **referti**
(`test/pdftesto.mjs` e `test/ext-referti.mjs`, solo PDF finti: il testo ruotato di un ECG in
orizzontale letto in ordine da pdf.js e dal lettore di casa, dell'ECG solo il referto scritto, il
codice fiscale — o nome e data di nascita — che torna, che non torna o che manca, il portale che
mostra prima il referto di un altro paziente, il testo dei salvati letto senza richieste, mai più
di due scaricamenti insieme e niente salvato da solo),
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
- L'elenco esami è una GET pura: stessa URL con `RISORSA_ID` diverso **mostra** l'elenco di un'altra
  risorsa, ma non sposta la richiesta — il cambio d'erogatore è il modulo `RisorsaFiltro` (POST,
  302 all'elenco), e un inserimento in un erogatore che non è quello della richiesta, o in un
  secondo, risponde «ORA-20965». La URL viene
  ricostruita dai parametri dei link `AFCDataLink` (mai da `response.url`).
- Il link "svuota carrello" ha `Delete=Elimina` **senza** `PRESTAZIONE`: un esame è "nel carrello"
  solo se il suo link ha *entrambi*.
- `extension/portale-pdf.js` (nel mondo della pagina del portale) guarda solo le XHR **asincrone**:
  la sua `send` sta sulla singola richiesta, non sul prototipo. Il portale manda una XHR sincrona a
  `logout.jsp` mentre la pagina si chiude, Chrome la rifiuta («Synchronous XHR in page dismissal»),
  e con la `send` cambiata per tutte quell'errore della pagina finiva fra gli errori dell'estensione.
- Il form Conferma contiene `MVPG=RcsStampaEtichetteLIS` nascosto: confermare via fetch
  ingoierebbe la stampa etichette — per questo la conferma è un click nativo.
