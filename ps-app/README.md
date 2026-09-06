# PS Assist — richieste Pronto Soccorso in un click (SA4PSO)

Ricostruito **da zero** (agosto 2026) dopo un re-audit completo delle pagine reali salvate di SA4PSO.
Sostituisce il vecchio script v0.6 ("un esame per ricaricamento di pagina") con un motore molto più
semplice e robusto: guida il server con le **stesse identiche richieste dei click manuali**, tutto da una
sola pagina, verificando ogni passaggio prima del successivo.

> **In sintesi per il medico**: dalla pagina del paziente scrivi il quesito, tocchi i profili
> e gli esami, premi un bottone. La richiesta viene creata, gli esami aggiunti e
> verificati uno a uno nel carrello, e atterri sulla pagina esami reale per premere **Conferma**
> (o lasci che la prema lui, subito: il tuo click su «+ Conferma» è la decisione). Dopo la conferma parte da
> solo il **wizard di stampa**: PDF etichette con la finestra di stampa già aperta
> (etichettatrice), poi PDF lista esami (stampante normale).

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
premi **"⟳ ricarica estensione"** nel piè di pagina del pannello (o ⟳ in `chrome://extensions`).
Un'estensione non pacchettizzata non può scaricarsi gli aggiornamenti da sola, e PS Assist non
contatterà mai server esterni per controllare le versioni — sarebbe contro la regola «nessun dato
lascia l'ospedale». Le nuove versioni arrivano come zip: sostituisci, ricarica, fatto.

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
     conferma e wizard di stampa ripartono al click, perché i passaggi di consegna vivono
     nella scheda.
- A regime, la strada pulita è chiedere all'IT di consentire l'estensione (cartella locale o
  allowlist aziendale).

---

## Uso quotidiano

Il pannello ha cinque schermate, con **Richieste | Esiti | Dimissioni | Consensi | EO** sempre in cima e il
paziente + episodio nell'intestazione (anche da minimizzato). Sulla pagina «Storico dati clinici»
del portale clinico non c'è pannello: solo una striscia che dice cosa ha letto.

### Pazienti (‹ in alto a sinistra)

Ogni scheda-paziente **è un bottone**: un tocco apre i suoi **Esiti** (dal pannello si va da un
paziente per *vedere*); il bottoncino **Richieste** resta per ordinare. Aprire un paziente **dal
gestionale** fa il contrario: il pannello parte da **Richieste** (quella navigazione vuol dire
*agire*).

L'elenco dei pazienti su cui hai lavorato nel turno: quello della pagina aperta è primo e marcato
**QUI**, gli altri con quando li hai visti. Da ogni scheda scegli **Richieste** o **Esiti**.
Sceglierne un altro **carica la sua pagina**: il pannello non mostra mai i dati di un paziente
diverso da quello che hai davanti. Il pannello parte da qui solo dove non si può ordinare (la
lista del pronto soccorso); sulla scheda di un paziente parte direttamente da **Richieste**.

### Richieste
1. **Quesito diagnostico** — casella su una riga, suggerimenti a fianco; l'ultimo resta scritto.
2. **Profili rapidi** (Base PS, Epatico, Coag POC, Coag) o **esami singoli** — fra questi
   **SARSCOV** (tampone antigenico SARS-CoV-2, laboratorio centrale), griglia compatta a
   due colonne per laboratorio (POC / Urgenze / RX). Per tutto il resto: **«altri esami…»** con
   menu a tendina su tutti i laboratori. I selezionati restano in alto, una riga per laboratorio,
   con la ✕ al passaggio del mouse.
3. **Crea e aggiungi N esami** → ricevuta + bottone **✓ CONFERMA → stampa**; oppure
   **+ Conferma 🖨** che fa tutto da solo e conferma **subito**: il click è la decisione, e la
   conferma parte solo se ogni controllo passa — episodio, richiesta, nome dell'ultimo esame, e
   **carrello identico alla ricevuta** (un avanzo di un tentativo precedente la **sospende** e
   la lascia a te).
   Selezionando laboratorio **e** radiologia il bottone diventa **Crea 2 richieste** e il pannello
   le costruisce e le porta entrambe a conferma, con **una sola** stampa finale.
4. **Stampa**: ogni richiesta con data, ora e la lista compatta degli esami.

### Esiti
Due sezioni, una sotto l'altra: **Valori** e **Referti**.

**Valori** è un'unica tabella: gli analiti in riga, raggruppati per sezione fissa (*Emocromo,
Coagulazione, Biochim, Organi, Elettroliti e metabolismo, Emogas, Urine e altri liquidi*, e in
fondo **Altri** — i dettagli più sotto), una colonna per prelievo, **il più recente a sinistra**
(marcato «ultimo»). In cima a ogni colonna: **solo l'ora** se il prelievo è di oggi, **la data**
(27/08) con l'ora sotto se è di un altro giorno; **passando il mouse** sull'intestazione si legge
data e ora per esteso e **gli esami** compresi in quella richiesta.

- I nomi sono in **sigla** (`Hb`, `GB`, `PLT`…), con l'**unità sotto il nome** e il **range nel
  tooltip del valore**. Un nome fuori elenco è scritto **per esteso** e sottolineato a puntini — lo stesso
  vale per un'abbreviazione ambigua — e una riga d'avviso in cima dice **quali**.
- In rosso c'è **solo il valore**, con ↑ ↓: il nome resta a sinistra, sempre nella stessa colonna.
  Una cella **·** = quel prelievo non ha quell'analita; *in corsivo* = risultato ancora
  **parziale** (il laboratorio non ha finito — c'è una riga che lo ricorda sotto la tabella). Quando lo stesso
  analita arriva da esami diversi — l'emocromo del POC e quello del laboratorio, per dire — chi
  non è «il solito» porta un **asterisco o una croce**, spiegati nella legenda sotto la tabella.
- **⭳ Carica i valori** legge i prelievi non ancora letti; fatta la prima lettura diventa
  **↻ Aggiorna**, che rilegge **tutti** i prelievi ancora aperti, a passo lento e uno alla volta.
  **solo alterati** / **tutti** filtra le righe; **↺ Reset** dimentica i valori letti e la scheda
  in archivio di questo paziente, e **⭳ Carica i valori** li rilegge da zero (i tuoi segni
  restano). Un prelievo letto ma senza data e ora nel gestionale non può diventare una colonna:
  una riga sotto i bottoni lo dice, e il Registro elenca ogni prelievo letto con la sua colonna.
- **Un tocco su un valore lo segna**: giallo; un secondo tocco arancio; un terzo lo spegne. I segni
  sono tuoi, restano col paziente (24 ore, come la nota) e sopravvivono al cambio di pagina.
- **Cosa è cambiato dall'ultima volta che hai guardato**: dopo un **↻ Aggiorna**, in quel prelievo
  un valore cambiato ha **sfondo azzurro**, e lo stesso vale per un analita comparso da zero. In
  cima compare **«N valori nuovi dall'ultima lettura»** con un bottone **Letto** che spegne i
  marchi. La prima lettura di un prelievo è sempre il riferimento: non è mai un muro di marchi.
- Un avviso dice quanti prelievi mancano ancora (**«N prelievi ancora da leggere»**: ⭳ Carica i
  valori) e quali non si sono lasciati leggere (il **Registro** dice perché; **↻ Aggiorna**
  riprova).
- La tabella mette insieme due cose: i prelievi letti **in questa scheda del browser** — sempre,
  anche col bookmarklet e senza estensione — e, quando è di questo paziente, la **scheda
  clinica** che l'estensione tiene in archivio (la tabella del portale, e i prelievi letti in
  altre schede). Un prelievo il cui referto è arrivato nel frattempo — e la cui finestra
  Risultati è quindi sparita — **resta in tabella** come colonna: non scompare mai.
- Il pannello **si allarga da solo** quanto serve alle colonne, fino all'**80%** dello schermo in
  larghezza e altezza — mai più stretto di come l'hai già ridimensionato a mano.
- Quando la scheda viene (anche) dal portale, sotto la tabella compare: *«Con lo storico del
  portale, letto per NOME · identità confermata dal paziente da cui l'hai aperta / dal codice fiscale / dal nome»*.

**Referti** è la lista dei documenti (ECG, RX, TC, visite…), una riga ciascuno, come sempre:
- **RIS ›** — referti di **radiologia** (RX, TC, ecografia, RMN) ed **ECG**: si aprono **dentro il
  pannello, come testo**. Il PDF di quei referti porta con sé la mappa dei caratteri, quindi le
  parole si recuperano esatte invece di indovinarle: leggi il referto senza cambiare scheda, lo
  copi per il diario con **⧉ Copia**, e il PDF resta a un tocco (**↗ PDF**). Se un documento non
  contiene testo leggibile, il pannello lo dice e torna ad aprirlo come sempre.
- **LIS/AMB ↗** — gli altri referti (PDF): si aprono in una scheda e, con l'estensione, il
  documento che apri **viene tenuto** (pallino verde) — la volta dopo si apre all'istante, senza
  toccare il server. **⬇ Salva referti** li prende tutti in una volta, **↻ Resetta** svuota.

> Perché i referti restano fuori dalla tabella dei Valori: referto e prelievo sono due cose
> diverse per il gestionale (un referto per documento, un accesso per prelievo, senza una chiave
> comune) e un abbinamento "a occhio" per nome ed ora prima o poi metterebbe i valori di un
> prelievo sotto il documento di un altro. Meglio due sezioni distinte e oneste che una fusione
> plausibile ma sbagliata.

### Chi c'è, e chi è stato dimesso
Nell'elenco **Pazienti** ogni scheda ha **Dimesso ✓**: il paziente esce dall'elenco principale e
finisce fra gli **Archiviati** (in fondo, con il conteggio). Da lì lo si può **↩ riportare** fra gli
attivi, oppure **🗑 eliminare** — e eliminare vuol dire *tutto quello che il programma sa di lui*:
la scheda clinica, i referti tenuti, il testo dei referti letti, la nota, e i dati per episodio di
quella scheda del browser. Chiede conferma una volta e non si torna indietro. L'elenco tiene un
giorno e sessanta pazienti: un turno è di dodici ore.

### Nota sul paziente
Sotto il nome, una **nota** di due righe che cresce con quello che scrivi. Non c'è un tasto Salva:
**si salva mentre scrivi** (e comunque quando esci dal campo), e compare un «salvata» che scompare
da sé. È legata al paziente — codice fiscale quando il pannello lo conosce, altrimenti il nome —
resta cambiando pagina, e scade dopo 24 ore come i dati clinici. Vive nel browser di quel computer:
non esce da lì.

### Modificare i fogli in fretta: `dist/dimissioni.html`
Una **pagina sola**, senza server: si apre col doppio clic e dentro ci sono già gli otto fogli in
servizio. Clicchi un titolo o un testo e scrivi — nessun tasto «modifica», nessuna schermata.
**+ Nuovo foglio**, **↑ ↓** per riordinare, **🗑** per buttarne uno (chiede conferma).
**⬇ Salva** scarica `dimissioni.json` *e* lo copia negli appunti, nella forma esatta che il pannello
importa con **⤒ Importa**: si passa da lì e i fogli nuovi sono in servizio. Il lavoro a metà resta
nel browser, quindi chiudere la pagina non costa niente; **↺ Originali** rimette i testi spediti.
La pagina sta nello zip e si rigenera con `npm run editor`.

### EO
Un elenco di **esami obiettivi da incollare in cartella**, scritti dal medico e tenuti verbatim.

- **EO generale**: un tocco e l'esame obiettivo completo, tutto negativo, è negli appunti.
- **Aggiungi per caso**: una tendina con nove quadri (*dolore toracico, dispnea, dolore addominale,
  cefalea, trauma/caduta, sincope, lombalgia, vertigine, pediatrico*) e quattro **frasi pronte**
  (rettale rifiutata, neuro poco collaborante, NEXUS, segni d'allarme spiegati). **Sceglierne uno lo
  copia da sé**: nessun secondo passaggio.
- Il testo scelto **resta scritto sotto la tendina**, così si vede cosa è finito negli appunti, e
  **⧉ Copia di nuovo** lo ripete senza doverlo riscegliere. La scelta sopravvive al cambio schermata.
- Si usa in due incollate: prima l'EO generale, poi l'aggiunta del caso. I testi sono **uguali per
  tutti i pazienti** — quello che riguarda *questo* paziente si scrive in cartella. Nessun dato di
  paziente entra qui (è un controllo del collaudo).

I testi stanno in `src/eo.json` e sono compilati dentro l'estensione: **zero richieste al server**.
In questa versione **non si modificano dal pannello** — per cambiarli si modifica quel file e si
ricompila (`npm run build`).

### Consensi
Cinque moduli di consenso, dentro l'estensione: **Emocolture**, **HIV Dipendente**, **Lesioni
Animali**, **Antitetano**, **TAC cmdc**. Un tocco apre il PDF e la finestra di stampa, come per la
lista esami.

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
Nove **fogli di dimissione** pronti — i **cinque rivisti dal medico** stanno in cima, poi una riga
(*«non ancora rivisti»*) e sotto gli altri: si vede a colpo d'occhio dove si è già messo mano.
Sono scritti per il paziente: dosi per esteso, tetto del paracetamolo, e in fondo a ogni
foglio i motivi per **tornare in Pronto Soccorso**.

- L'elenco mostra **solo la patologia**, mai il testo: al momento della dimissione sai già quale ti
  serve, e leggerlo qui costerebbe solo uno scroll.
- **Un tocco sulla riga copia tutto il foglio** negli appunti, pronto da incollare nel verbale. Il
  bersaglio è la riga intera, non un'icona da 13 px.
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
- **⬇ JSON** salva i tuoi testi in un file (e negli appunti); **⤒ Importa** li rimette da una
  schermata dove incolli il JSON — entrano **solo i testi diversi dagli originali**, così un
  ripristino non congela per sempre gli altri sette.

---

## Stampa etichette e lista esami

Dopo la **Conferma** (manuale o automatica) si apre da solo il wizard di stampa, in sequenza,
raggruppando per stampante:

1. **Tutte le etichette provette** — i PDF dell'icona col codice a barre
   (`RcsStampaEtichetteLISHMIMU.do`, che porta al PDF servito da
   `uploaddownloadservlet.rra2`), con la finestra di stampa già aperta → **etichettatrice**;
2. poi **tutte le liste esami** — i PDF di "Stampa Richiesta" (`jasperservlet`, URL sempre letto
   dalla pagina perché `BRANCA` cambia per riga) → **stampante normale**;
3. per la **radiologia**, la riga ha l'icona stampante "Stampa Prenotazione Esterna": il wizard
   stampa quel PDF → **stampante normale**.

**Righe multiple**: quando gli esami di una richiesta appartengono a laboratori diversi (POC +
Urgenze, ecc.) il LIS la divide in **più righe** — stessa `RICHIESTA_ID`, `RICHIESTA_PROG` 1, 2… —
ognuna col suo PDF etichette e il suo foglio. Il wizard le stampa **tutte** ("Etichette — riga 1",
"Etichette — riga 2", poi le liste), mai solo l'ultima.

Sul campo, dopo la Conferma il gestionale **torna alla pagina del paziente**: è lì che il wizard
parte da solo (e se un'installazione mostrasse una pagina intermedia, parte lì se ha i link,
altrimenti aspetta il ritorno sul paziente). Dalla pagina paziente puoi anche **ristampare
qualsiasi richiesta**
(sezione **Stampa**: ogni richiesta è elencata con **data e ora** e, sotto, la **lista compatta
degli esami** che contiene). Ogni passo ha: Riapri stampa · Salta · Apri in una scheda ·
Annulla (Esc).

**Laboratorio + radiologia insieme**: se confermi una richiesta di laboratorio e poi una di
radiologia prima di tornare alla pagina del paziente, la stampa parte **una volta sola** e in
sequenza: tutte le etichette → tutte le liste → la prenotazione RX.

### Si può scegliere la stampante?

No: nessuna pagina web può impostare la destinazione
di stampa — è una barriera del browser, non un permesso mancante. Quello che si può fare senza
essere amministratori:

- Chrome **ricorda l'ultima stampante usata**, quindi il wizard raggruppa i documenti per
  destinazione (tutte le etichette, poi tutte le liste): al massimo **due cambi per paziente**,
  non uno per foglio.
- **Collegamento con `--kiosk-printing`** (si crea senza admin: tasto destro sull'icona di Chrome
  → Proprietà → aggiungi `--kiosk-printing --user-data-dir="%LOCALAPPDATA%\\ChromeEtichette"`).
  Da quella finestra Chrome stampa **senza dialogo** sulla stampante predefinita di Windows di
  quel profilo. Ha senso solo se quella finestra la usi per le sole etichette — la lista la
  stamperesti da una finestra normale. Fragile, ma funziona.
- Se le liste su carta non ti servono, salta il secondo passo del wizard: resta **un solo**
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

Il flusso completo dell'ordine: quesito, profili, esami, «Crea e aggiungi» con
la verifica esame per esame, il carrello che compare **nella pagina vera**, la
Conferma nativa, il wizard di stampa. E gli **Esiti**: i valori letti dalla
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
   La verifica rilegge l'elenco "pulito" (senza parametri di inserimento); se dopo 3 verifiche
   l'esame non compare, il motore **si ferma** e ti dice esattamente cosa controllare.
   Vale anche **fra una corsa e l'altra**: partendo da una pagina esami il motore **rilegge
   l'elenco dal server** invece di fidarsi di quello che hai sullo schermo. Gli inserimenti
   viaggiano in background, quindi dopo una corsa interrotta la pagina mostra ancora il carrello
   di prima — fidarsene voleva dire leggere «non c'è» un esame che c'era già, e ordinarlo una
   seconda volta. Costa una richiesta, e da quella rilettura arrivano anche i controlli di
   sessione ed episodio che quella strada saltava. C'è un test che lo prova.
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
4. **Mai l'esame sbagliato**: prima di ogni invio il nome dell'esame sulla riga viva della pagina
   deve coincidere con quello selezionato — se l'ospedale rinumera un codice, il motore si ferma
   e lo dice, invece di ordinare un esame diverso con tutte le spie verdi.
5. **La Conferma è sempre un click reale** sulla pagina visibile (il flusso di stampa etichette
   resta quello nativo), è opt-in e **immediata**: nessun conto alla rovescia, perché il tuo
   click su «+ Conferma» è già la decisione — ma scatta **solo** se il carrello coincide con la
   ricevuta di ciò che è stato appena aggiunto; ogni differenza la sospende con un messaggio.
   **La pagina della Conferma può essere invisibile.** Viene caricata davvero —
   stessa sessione, stesso modulo, stesso bottone — dentro una cornice nascosta
   invece che davanti agli occhi, e il clic è quello vero sul bottone del
   gestionale: i byte che partono sono gli stessi, perché a serializzare il
   modulo è il browser, non noi. La cornice gira **senza script**
   (`allow-forms allow-same-origin`, mai `allow-scripts` né
   `allow-top-navigation`), così il codice della pagina non può portarsi via la
   scheda del medico. Se il server **vieta di essere incorniciato**, il
   documento non è leggibile: il programma se ne accorge e torna alla pagina
   visibile, come prima. Ogni intoppo — cornice rifiutata, controllo che dice
   di no, stato incerto — finisce sulla pagina vera col motivo scritto, e la
   conferma resta al medico. C'è un test che prova che in quel caso la
   richiesta viene confermata **una volta sola**.
   **Non poter controllare non è come aver controllato**: se la ricevuta manca o è di un'altra
   richiesta, la conferma automatica **si sospende** invece di partire lo stesso. (Fino alla
   3.20 quel caso saltava il controllo e confermava — la Conferma nativa invia la richiesta
   *intera*, quindi era la strada per confermare l'avanzo di un tentativo precedente.)
6. **Il quesito non viene mai sovrascritto**: se il triage l'ha già compilato, resta il suo.
7. **Sessione scaduta riconosciuta**: se compare la pagina di login, stop con messaggio chiaro
   (che dice anche se l'ultimo esame è in stato ambiguo).
8. **Un run non muore in silenzio**: chiudere o cambiare pagina durante un run fa scattare
   l'avviso del browser; i passaggi falliti diventano rossi, quelli mai partiti "non eseguito".
9. **Niente esce dall'ospedale**: ogni richiesta è bloccata a livello di codice se non è diretta
   a una delle **due origini dell'ospedale** — SA4PSO e il portale clinico interno da cui
   arrivano i referti e si legge la tabella multi-prelievo. Nessun altro indirizzo, nessuna
   telemetria; preferenze e catalogo appreso restano nel browser.
10. **Due schede, due pazienti, zero interferenze**: i passaggi di consegna tra pagina e pagina
   (ricevuta e conferma automatica) vivono nella singola scheda (sessionStorage).
11. Codifica **windows-1252 identica byte per byte** a quella del browser (verificato contro
    Chromium reale, accenti e simboli inclusi).
12. **Stampe solo dai link della pagina**: gli URL dei PDF non vengono mai costruiti a mano
    (`BRANCA` varia per richiesta) e passano gli stessi controlli di origine di tutto il resto.
    La caccia al PDF ha **un tetto solo, sei tentativi in tutto**: oltre quello il documento si
    apre in una scheda e lo stampi da lì. (Il contatore stava dentro la funzione ricorsiva, così
    ogni livello ripartiva da zero e il tetto vero era 6+6×6 = **43 richieste**. Lo stesso
    difetto era rimasto nel service worker, per i referti, ed è corretto anche lì. Ora è uno solo,
    passato ai livelli sotto.) Chiudere la finestra di stampa **ferma davvero** la caccia.
13. **Un paziente alla volta**: per ordinare devi essere sulla sua pagina, e ogni dato salvato
    (valori, referti, registro, code di conferma) è legato al suo episodio — letto sotto un altro
    episodio semplicemente non esiste.
14. **Dove finisce il contenuto clinico, detto con precisione.** Dei pazienti *conosciuti*
    restano solo nome, episodio e indirizzo della pagina, al massimo 60 e per 24 ore, con
    **svuota** a mano e **🗑** per cancellare tutto di uno. Ma valori e testi dei referti letti in un turno stanno nel
    `sessionStorage` della scheda: **Chrome lo tiene anche su disco**, nel profilo, per poter
    ripristinare le schede — muore chiudendo la scheda, non prima. I PDF salvati stanno nella
    memoria dell'estensione (su disco), scadono dopo 8 ore, massimo 25, e si azzerano alla
    chiusura del browser. Le **schede cliniche** (tabella multi-prelievo, testi dei referti letti)
    stanno nella memoria dell'estensione, quindi **su disco**: un turno dura dodici ore e non si
    può perdere tutto chiudendo il browser. Scadono da sole **24 ore** dopo l'ultima lettura, al
    massimo 200 pazienti, e **🗑** su un paziente archiviato le cancella subito — schede, referti
    tenuti e nota. La pagina di login cancella il resto — ma il `sessionStorage` è
    **per scheda**: pulisce la scheda in cui è comparso il login, non le altre schede aperte.
    Su un PC condiviso: usa un profilo Chrome tuo e chiudi il browser a fine turno.
15. **Niente parte da solo, e niente si inventa.** Aprire la pagina di un paziente non legge
    **nessun** valore: cliccare un paziente non è chiedere il laboratorio. I valori si leggono
    quando li chiedi — aprendo un prelievo, o con **⭳ Carica i valori** che li prende tutti, uno
    alla volta — e un prelievo che ha già fallito non si ritenta da solo. Un referto che apri non
    viene riletto per tenerne una copia: per quello c'è **⬇ Salva referti**. E la tabella
    multi-prelievo viene **letta dalla pagina che hai davanti**, non chiesta all'API che la
    riempie — una chiamata diretta a quel servizio arriverebbe senza l'`Origin` della sua app,
    cioè come una cosa diversa da te che clicchi, e non è quello che questo programma fa.
16. **I fogli di dimissione sono modelli, non cartelle**: sono l'unica cosa che sopravvive alla
    pulizia del logout, proprio perché non contengono il paziente. Per questo l'editor offre
    **⧉ Copia senza salvare** — chi vuole un foglio su misura non è mai costretto a salvarlo — e
    un salvataggio rifiutato dal browser (memoria piena o bloccata) viene **detto**, mai spacciato
    per riuscito.

> **Postazione condivisa**: `localStorage` e la memoria dell'estensione sono legati al **profilo
> Chrome**, non al login dell'ospedale. Usa l'estensione in un profilo tuo. Se il profilo è
> davvero condiviso, non usare **⬇ Salva referti** (i PDF resterebbero su disco fino a 8 ore).

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
   compare il banner verde (5–20 secondi; se provi a chiudere la scheda durante il run, il
   browser ti avvisa).
3. **Verifica il nome, non il conteggio.** Sulla pagina esami leggi la riga nel carrello: il
   **nome** deve corrispondere esattamente al chip scelto. (Il motore fa già questo controllo da
   solo prima di ogni invio e si ferma se un codice ha cambiato nome.)
5. **Conferma manuale nativa.** Premi tu Conferma: si apre il wizard di stampa — verifica che il
   PDF etichette sia della **richiesta giusta** e che le etichette riportino il **paziente
   giusto**, scegli l'etichettatrice, poi "Stampata — avanti" e stampa la lista sulla stampante
   normale. (Il wizard si può sempre chiudere con Esc e rifare dalla sezione "Stampa".)
6. **Controllo incrociato in EHR.** Riapri l'episodio: esattamente UNA richiesta nuova, 1 esame,
   quesito/medico/urgenza corretti, nessuna bozza doppia.
7. **Run multiplo con cambio risorsa.** Profilo con POC + Urgenze (es. Base PS + Epatico):
   ripeti i punti 3–5 riga per riga.
8. **Esercitazione di interruzione.** Lancia un run e premi INTERROMPI (o Esc) a metà; leggi il
   messaggio e controlla il carrello col bottone "Apri il carrello e controlla". Regola
   permanente: **dopo qualsiasi banner rosso mai rilanciare** — si apre il carrello, si sistema a
   mano, si controllano le bozze sull'episodio.
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
├── tools/build.mjs      ← genera extension/content.js e il bookmarklet
├── tools/icons.mjs      ← genera le icone PNG (niente binari a mano)
├── bookmarklet/         ← piano B per PC bloccati: un preferito, zero installazione (generato)
├── esempi-gestionale/   ← pagine vere del gestionale, contenuti inventati (+ come)
├── demo/                ← guscio del banco di prova (css + il browser finto)
├── tools/esempi.mjs     ← genera esempi-gestionale/ dagli originali (che restano fuori)
├── tools/demo.mjs       ← assembla dist/demo.html: pannello vero + pagine vere
└── test/                ← simulatore SA4PSO + 46 scenari e2e in Chromium reale (+ storico e referti)
```

Sviluppo:

```bash
cd ps-app
npm install        # solo playwright, solo per i test
npm run build      # rigenera extension/content.js + bookmarklet dopo modifiche a src/
npm run esempi     # rigenera esempi-gestionale/ dagli originali e verifica che sia pulito
npm run demo       # rigenera dist/demo.html (il banco di prova)
npm test           # 56 scenari e2e + 32 sull'estensione + 36 sul banco + storico + il cancello privacy
```

I test coprono: percorso felice (con e senza redirect PRG, con verifica **byte-per-byte** del
corpo POST contro la codifica nativa di Chromium), conferma automatica, annullo con Esc e flag
consumato al reload, carrello "in ritardo" (verifica con riletture, un solo invio), esame perso
dal server (hard-stop con **un solo** invio e step successivi mai partiti), **codice rinumerato**
(rifiuto prima dell'invio), sessione scaduta prima e **durante** un inserimento (messaggio di
ambiguità), **cambio episodio a metà run** (zero invii sul paziente sbagliato), quesito
pre-compilato non sovrascritto, aggiunte dalla pagina esami con cambio risorsa, rifiuto live di
esami di risorsa sbagliata (CTA disabilitato con motivo), quesito mancante (CTA disabilitato,
si riattiva scrivendo), apprendimento radiologia end-to-end, STOP, e la stampa: wizard manuale
con sequenza etichette→lista e download singoli, **richiesta divisa su due laboratori → 4 PDF
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
- Il form Conferma contiene `MVPG=RcsStampaEtichetteLIS` nascosto: confermare via fetch
  ingoierebbe la stampa etichette — per questo la conferma è un click nativo.
