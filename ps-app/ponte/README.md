# Ponte — il pannello sull'iPhone

Il medico lascia il PC per qualche minuto (al massimo una ventina) e dal telefono, anche in 5G,
vuole: **vedere i pazienti**, **gli esiti** di uno (valori e referti), **ordinare esami**, scrivere
**una nota o un promemoria**. Il Ponte fa esattamente questo, e niente di più: tutto succede sul PC
dell'ospedale, con l'estensione e le pagine del gestionale di sempre; il telefono è un telecomando
cifrato.

```
 iPhone (Safari)                il Worker di EKG Atlas (workers.dev)     PC dell'ospedale (Chrome)
 /ponte/  app  ── wss:443 ──►   /ponte/ws  ripetitore  ◄── wss:443 ──   estensione (service worker)
                               (un Durable Object per stanza:            │ chrome.tabs.sendMessage
                                passa byte cifrati, non li legge,        ▼
                                non li tiene)                           una scheda del gestionale:
                                                                         il codice di sempre
```

## Per il medico

**Una volta sola.** Sul PC, nel pannello: **⋯ → iPhone → Associa l'iPhone**. Compare un QR,
con accanto un **codice di sei cifre** («482 913»): lo inquadri dall'app PS Assist (**⋯ → Scansiona il QR**; con la Fotocamera
solo se l'app non è sulla Home) e
si apre il pannello, già collegato, e per un momento lo stesso codice («Associato · codice 482 913»: dopo
non serve, e non si vede più). L'associazione
**non scade**: dura finché non la togli (**Revoca** sul PC, **«Scollega»** nel ⋯ del telefono, o un QR nuovo), e vale per **quel telefono solo**: il
primo che entra. Un altro telefono che inquadra lo stesso QR si sente dire «Il PC è associato a un
altro telefono», con **«Usa questo telefono»**: due tocchi (il primo arma, «Usa questo telefono? Tocca
di nuovo»; un doppio tocco per sbaglio non vale) e quel telefono diventa l'associato (il primo esce,
come con «Revoca» e un'associazione nuova; resta senza scadenza). Niente codice da ricordare: lo può
chiedere solo un telefono che ha la chiave del QR. Capita soprattutto col proprio telefono: il QR
aperto con la Fotocamera (Safari) e poi l'icona della Home, che ha una memoria sua. Sul PC la pagina ⋯ → iPhone dice
«iPhone cambiato alle 14:32». Il QR si rivede con «Mostra il QR» solo nei primi due minuti e solo finché nessun
telefono è entrato; dopo, «Associa» ne fa uno nuovo (e il telefono di prima esce). Conviene
aggiungerlo alla schermata Home (Condividi → Aggiungi alla schermata Home): l'icona riapre il pannello.

Il QR si inquadra anche **dall'app**: **⋯ → 📷 Scansiona il QR**, sempre (anche su un PC di sola lettura),
e senza un'associazione buona (nessuna, QR scaduto, chiusa, revocata, o un altro telefono al suo posto,
e accanto a «Riprova» quando il PC non risponde) un bottone **«Scansiona il QR»**: apre la fotocamera
nella pagina. Un QR solo per tutto: il QR dice che cos'è — un PC completo, un PC di sola lettura, una
stazione di stampa. Serve
all'app della schermata Home, che ha una memoria sua: il QR letto con la Fotocamera si apre in Safari,
e lì la chiave non arriva. Senza fotocamera: «Fotocamera non disponibile: inquadra il QR con la
Fotocamera dell'iPhone».

Il link del QR vale per il primo scambio solo pochi minuti (5) e una volta sola: dopo, serve un QR nuovo.

**Più PC: uno completo e le porte di sola lettura.** Il telefono tiene una **lista** di PC
associati, non solo uno: il PC completo (💻, dove si ordina, si prescrive, si scrive in cartella) e
un numero qualsiasi di **PC «di sola lettura»** (👁️, la [build mini](../README.md#ps-assist--lettura-e-stampa-la-build-mini-di-sola-lettura): si vede
tutto — pazienti, esiti, cartella, referti — e si stampa, ma non si scrive). Ognuno ha la **sua
chiave**: una non apre gli altri, e un PC in mano a un altro non espone i tuoi. Si scansiona ogni PC
**una volta sola**: il suo QR **aggiunge** quel PC alla lista (lo stesso PC riscansionato, o un altro
dello stesso nome, lo sostituisce; il QR del PC completo sostituisce il completo). Da lì si passa
dall'uno all'altro da un **menu** (⋯ sul telefono: l'attivo in cima, gli altri sotto col loro nome e
tipo, «attivo adesso» quando la sessione è viva; un tocco cambia, 🗑️ «Scollega» per riga). Con un PC
solo il menu non c'è: meno è meglio. Su un PC di sola lettura la testata ha un 👁️ piccolo e quieto, accanto
a ⋯ — niente che distragga —; la scritta («Sola lettura · gestionale di …», il collega loggato lì, solo per
saperlo) sta nel suo nome e in fondo al ⋯, e i controlli di scrittura
non ci sono: si legge, si ristampa, si stampa un PDF.

**Poi.** Apri il pannello dall'iPhone: si collega da solo, niente QR. L'elenco si rilegge
da solo ogni volta che torni sull'app («Aggiornato alle 14:32»), e se eri su un paziente anche i suoi
esiti (un referto arrivato intanto): riletture che l'app fa da sé, e che non tengono aperta la
sessione. Vedi:

- **Pazienti** — in una carta sola chi è in lista e chi è nella stanza (col suo posto), gli episodi
  precedenti a parte; la striscia del triage, la nota, il promemoria più vicino, e lo stato della riga
  del tabellone del PC (`stato`: il cuore, quello che aspetta per tipo col suo tempo o ✓, il pallino
  del letto, «letto alle …» nel titolo; niente se il PC non sa). Il nome non si tronca
  mai: il posto e il promemoria vanno a capo.
- **Il paziente** — in testa il nome intero, l'età e il posto: «ROSSI MARIO · 77 anni · OBI 2» (su
  un episodio precedente lo dice sotto; due pazienti con lo stesso nome hanno il ⚠ e il segno che li
  distingue, come nell'elenco: «⚠ ROSSI MARIO · …9001 · 77 anni · OBI 2»). Sotto il nome, su ogni scheda, le **allergie** con le parole del PC («Allergie: nega», «non compilate»,
  «non lette», o il testo, in rosso; anche nel riepilogo della Terapia — e rilette con la cartella: aperta,
  riletta o salvata dal telefono, la riga dice quello che dice il campo Allergie) e il **Da fare** in una riga —
  «○ 11:30 ecg di controllo · +2» (senza voci, «○ + nota»): un tocco apre la lista del paziente con
  il campo «+ nota». Poi le schede **Richieste · Esiti · Cartella**, nell'ordine del PC (resta
  quella che hai scelto l'ultima volta; la prima volta gli Esiti), ognuna col suo colore: Richieste blu,
  Esiti verde-acqua, le altre neutre.
- **Esiti** — la tabella dei Valori che il PC ha per quel paziente, con l'ora in cui il PC li ha letti
  («Letti sul PC alle 08:02», in ambra dopo un'ora; «● 3 nuovi» = i valori nuovi dall'ultima volta che il medico li ha guardati sul PC, e «nuovo» sui referti non ancora aperti; una colonna con valori parziali lo dice
  nella testata: «07:28 · parziale»), e i referti, col testo di quelli già letti sul PC — e di un ECG o
  di una radiografia che il PC ha salvato ma la cui pagina se n'era già andata, letto lì dalla copia
  salvata —; quelli del laboratorio (emogas, emocromo…) a parte, in fondo, sotto «Laboratorio» (con la
  tabella dei valori non ci sono: quello che dicono è già lì). Mai aperto sul PC: una riga, «Mai aperto
  sul PC: niente di salvato.». **↻ Rileggi** fa sul PC il «⭳ Carica i valori» di sempre, in una scheda
  di sottofondo che si chiude da sola — i valori e poi i referti non ancora caricati — e porta qui il
  risultato, tutto con una risposta. Un referto che il PC ha **salvato come PDF** ha un tasto «PDF»: il
  telefono lo chiede a pezzi (comando `pdf`, ~390 KB l'uno, una risposta per pezzo) dentro la stessa
  sessione cifrata, li ricompone controllando la misura e il «%PDF», e lo apre nel visore del
  telefono da un `blob:` in memoria — mai su disco (né localStorage, né Cache, né IndexedDB), mai da
  un indirizzo di rete, mai nel service worker dell'app; il blob si revoca a finestra chiusa, al PDF
  dopo, uscendo. Il PC offre solo copie salvate per lo stesso episodio che il pannello non ha segnato
  come di un altro paziente (è leggendole che lo si scopre, e la copia si toglie) — anche di una TC o di una visita, il cui testo non si legge —, e dà solo
  quelle offerte nella sessione. Oltre 15 MB: «PDF troppo grande: aprilo sul PC».
- **Richieste** — il quesito (i tre pacchetti in testa, e i quesiti che sul PC hanno imparato il loro pacchetto), i profili e gli esami, in pillole che vanno
  a capo (alte almeno 44 pt; scelto = pieno). Accanto al nome di un esame, come nelle Richieste del PC e con
  le stesse parole: **«✓ 11:40»** le richieste già tornate (verde), **«40′»** quella in attesa (ambra, rosso
  oltre la seconda soglia), grigio con «letto 11:02» se la lettura è vecchia — un doppione si vede prima di
  sceglierlo. Il PC lo manda col catalogo (`ultimi`, per paziente), riletto aprendo le Richieste e quando
  un ordine del telefono finisce; i minuti li conta il telefono. Con quesito mancante il bottone resta spento, ma un
  tocco porta il cursore sul quesito. Il
  bottone chiede conferma **col nome intero, l'età e il posto** («Ordino 2 esami per ROSSI MARIO ·
  77 anni · OBI 2? Tocca di nuovo»; per un omonimo «⚠ Ordino …», col segno); un secondo tocco entro
  800 ms (un doppio tocco per sbaglio) non conta. Poi l'ordine fa sul PC il giro di sempre — la scheda dell'ordine,
  tutti i controlli, la conferma provata. Il telefono dice a che punto è («esame 2 di 6») e come
  finisce, con le parole che `bg.js` scrive per la striscia del PC (`pubblico`) — tranne dove al
  telefono serve un'altra frase: «Confermato · etichette al PC» invece di «Etichette NON stampate · tocca Stampa», «Etichette
  forse stampate: guarda Zebra ZD421 prima di ristamparle dal PC» invece del perché tecnico. Il
  titolo della carta è com'è andata («Stampato su Zebra ZD421», «Mandato a Zebra ZD421» in ambra),
  l'ora c'è una volta, e una carta finita bene se ne va da sola dopo due minuti. Un ordine
  finito male resta in fondo alla lista, e in testa alla pagina di ogni altro paziente
  («Ordine non completo · BIANCHI ANNA»: toccalo e sei sul paziente), finché non lo chiudi con ✕.
  Sul PC la striscia dell'ordine dice **«dall'iPhone»**. La radiologia, come
  dal pannello, si conferma e si stampa da sola: un secondo ordine, dopo quello del laboratorio — e il laboratorio è un
  ordine per erogatore (POC, Urgenze…), come dal pannello: il gestionale non ne vuole due nella stessa richiesta. Su un episodio precedente
  non si ordina («Episodio precedente: per ordinare apri quello di oggi»); a un paziente dimesso sul
  PC non arriva niente («Dimesso sul PC: niente inviato»).
- **Se la rete perde la risposta** (ascensore, 5G): il telefono non sa se l'ordine è partito, e lo
  dice — «Non so se l'ordine è partito: controlla qui sopra prima di rifarlo». La selezione se ne va
  e il bottone aspetta che il PC dica a che punto sono gli ordini. Se intanto il telefono si è
  ricollegato e vede l'ordine nato sul PC, il bottone smette di aspettare e l'allarme non c'è: lo
  dice già la carta. L'ordine ha un numero fatto dal
  telefono quando arma «Conferma»: rimandato, è lo stesso ordine, e il PC lo manda una volta sola.
- **Senza rete** «Conferma e stampa» resta usabile: l'ordine va **in coda** («In coda · 0:24», il conto
  alla rovescia) e parte appena torna il collegamento. Se non parte entro **30 secondi dal tocco**
  scade: il telefono non lo rimanda più, la carta dice «Scaduta: non inviata» (toccata, la scelta torna
  e il bottone chiede di nuovo conferma). Lo controlla anche il PC: l'ordine porta l'ora del tocco
  sull'orologio del PC (il telefono misura lo scarto fra i due orologi al saluto, e lo tiene in
  memoria), e arrivato più di 30 secondi dopo — trattenuto per strada, rimandato tardi — non si fa.
  Uno arrivato in tempo va come sempre.
- **Cartella** — la terza scheda: Anamnesi, Anamnesi remota, Farmaci, Allergie, Esame obiettivo,
  come li ha letti il PC dalla pagina del paziente («Letto sul PC alle 08:02», in ambra dopo un'ora;
  **↻ Rileggi** la rilegge). Si scrive un campo solo se la pagina lo lascia scrivere (né `readonly`
  né `disabled`, né `JPSOReadonly`: l'esame obiettivo di un altro medico, per esempio, si legge e
  basta). Scritto qualcosa, compare un **Salva** solo, in fondo: «Salvo sul PC…», poi «Salvato» o
  il perché. Se intanto il testo sul PC è cambiato: «Cambiato sul PC: ricarica», e non parte niente;
  se il medico ha un testo non salvato in quella pagina sul PC: «Sul PC c'è un testo non salvato in
  questa pagina». Una pagina di quel paziente aperta sul PC si ricarica da sola (era di prima: il suo
  «Conferma» rimanderebbe i testi vecchi); se intanto qualcuno ci ha scritto, no — si perderebbe —: dice
  «Aggiornato dal telefono · Ricarica», e il suo «Conferma» è fermo (niente inviato, e lo dice) finché
  non la si ricarica.
- **Nota e promemoria** — la nota del paziente (si salva uscendo dal campo) e i promemoria
  («11:30 tropo», «tra 2h ECG»): sul PC sono voci di **Da fare**, la lista del pannello. La nota è
  la prima voce aperta senza ora (scritta cambia quella, o ne fa una in cima; vuota la toglie), i
  promemoria le voci aperte con l'ora. **✓ Fatto** aspetta 5 secondi, con **Annulla**, prima di
  spuntarlo sul PC.
- **Scansiona il QR** (⋯) — il QR di una [stazione di stampa](#la-stazione-di-stampa):
  una carta con il suo nome e il codice, **Collega**, «Collegata al PC» (con un PC di sola lettura
  attivo, la carta dice di passare al PC completo: è lui che stampa). Sopra «Conferma e stampa»,
  poi, «Stampa: PC · Infermeria»: parte dalla scelta del PC e **si ricorda**, per ogni PC associato (sul
  telefono, `psassist.ponte.dove.v1`) — l'ultima toccata vale per ordini, ristampe, «Stampa PDF» e il
  🖨️ dei referti. Senza stazione la scelta non c'è.
- **Richieste fatte** (in fondo alle Richieste) — tutte le richieste che la pagina del paziente sa
  stampare, anche quelle non fatte da PS Assist, ognuna con **Ristampa**: etichette e foglio, dove
  dice «Stampa: PC · Infermeria», con le parole di un ordine («Stampato su …», «Infermeria non
  risponde»). Se la richiesta ha etichette **e** foglio, il tocco apre la scelta **🏷️ Etichette ·
  📄 Foglio · Entrambi** (`quali`); con un genere solo stampa subito. Un doppio tocco è una ristampa
  sola. Solo stampa: niente Conferma, niente Registra.
- **🖨️ su un referto PDF** (Esiti) — stampa quel referto, dalla copia salvata sul PC, dove dice
  «Stampa: PC · Infermeria» (comando `stampaReferto`). Una stampa alla volta, nella stessa carta di «Stampa PDF».
- **Stampa PDF** (⋯) — un PDF del telefono esce dalla stampante A4 del PC, con la stampa
  automatica (mai un dialogo: davanti al PC può non esserci nessuno; senza, «Sul PC la stampa
  automatica non è impostata»). Mentre va, «Invio… 40%»; poi le parole del PC: «Stampato su HP
  LaserJet A4», «Mandato a …» in ambra, o l'errore. Al massimo 15 MB. Sul PC il registro del ponte
  dice «PDF dall'iPhone stampato su …».
- **Registrazioni** (⋯) — gli zip che il PC ha salvato (⋯ → Registrazioni sul PC: registrate a mano, o
  automatiche dopo un ordine finito male), già anonimizzati e controllati: quando, quanto, a mano o
  automatica e perché, «controllo superato» o «restano N dati da controllare». Niente pazienti.
  **Scarica** lo chiede a pezzi (comando `registrazione`, ~390 KB l'uno, come i PDF dei referti) dentro la
  stessa sessione cifrata, li ricompone controllando la misura e l'intestazione dello zip e lo tiene
  in memoria (mai su disco) finché la sessione è aperta; poi **Condividi…** apre il foglio di
  condivisione di iOS (`navigator.share` con il file: per mandarlo all'app di Claude), o, dove non c'è,
  **Salva** lo scarica come un file. Al più 100 MB («Troppo grande per il telefono: scaricala sul
  PC»). **Cancella** chiede «Cancello dal PC? Tocca di nuovo» e la toglie dal PC. Il PC dà e
  cancella solo quelle elencate nella sessione; il registro del ponte annota elenco, scarico e
  cancellazione.

Il **⋯** tiene solo quello che non c'è altrove: i PC (con due o più), **Stampa PDF**, **Scansiona il
QR**, **Registrazioni** e **Scollega** (la chiave di questo PC via dal telefono: servirà un QR nuovo).
L'elenco si rilegge da solo a ogni ritorno sull'app, e la sessione finisce da sola: niente «Aggiorna»,
niente «Chiudi sessione».

Di notte l'app è scura, come il telefono. Ogni bottone è grande almeno 44 punti. Sul telefono c'è
solo quello che serve: niente etichette di sezione, conteggi o testi di contorno (vedi «L'app del
telefono», più sotto).

**Sul PC si vede.** Finché una sessione è aperta, in ogni scheda del gestionale — pannello aperto o
ridotto a pill — c'è **«iPhone collegato · Scollega»**: chi passa davanti al PC lo sa, e con un tocco
la chiude. Ogni comando del telefono finisce nel **Registro** del pannello («iPhone · ordine di 2
esami per ROSSI MARIO…»), e la pagina ⋯ → iPhone ha il registro del ponte (sessioni aperte e
chiuse, comandi, un altro telefono rifiutato).

**La sessione finisce** dopo **3 minuti senza comandi del medico** (quello che l'app chiede da sé —
rileggere l'elenco, gli ordini — non conta; un tocco o uno scorrere con l'app davanti sì, al più uno al
minuto: `tocco`, che sul PC sposta l'orologio dei 3 minuti e basta — il telefono in mano non si chiude, uno
lasciato lì sì), con «Scollega» sul PC,
con la revoca, se l'estensione o il browser si riavviano, o se **una scheda del gestionale torna
alla pagina d'accesso** (senza il gestionale il ponte non fa niente). Il telefono lo dice («Sessione
chiusa · 3 minuti senza comandi», «Il gestionale sul PC è tornato alla pagina d'accesso») e cancella
dalla sua memoria tutto quello che sapeva dei pazienti, avvisi compresi; **Riapri** ne apre un'altra
con un tocco, senza QR. Chiusa per i 3 minuti, tornando sull'app (o se lo era già in sottofondo) se ne
apre un'altra da sola, senza passare da «Sessione chiusa»: ricollegarsi è questione di un attimo. L'estensione
del PC riavviata (Chrome, il PC che dorme, un aggiornamento) non la chiude nessuno: il telefono se ne accorge al
primo messaggio e si ricollega da solo, senza «Sessione chiusa». In tutti e due i casi, se eri su un
paziente, si riapre lì, sulla stessa scheda: del paziente resta in memoria (mai su disco) solo quale era e la
scheda, e si riapre solo dopo che il PC ha risposto e se è ancora nel suo elenco. L'associazione resta: rientrato nel gestionale, o riaperto il browser del PC,
il telefono riprende con la stessa chiave. **Revoca l'iPhone** (sulla pagina ⋯ → iPhone, due tocchi)
e la chiave di quel telefono non apre più niente: per rientrare serve un QR nuovo.

Il pannello aperto su un altro telefono o in un'altra scheda prende il posto di questo, che si ferma
(«Aperto su un altro dispositivo · Riprendi qui») e non fa a gara per riprenderselo.

Per scelta del medico non c'è un secondo sblocco (Face ID) dentro l'app: il telefono è sempre con
lui e si sblocca già col suo Face ID; basta avere la chiave del QR.

## Messa in servizio (una volta)

**1. L'indirizzo del ponte** si scrive una volta, in `ps-app/ponte/host.txt` (una riga, il nome del
Worker di EKG Atlas: `ekg-atlas.whirly.workers.dev`), e `npm run dist` lo fissa nell'estensione
(`extension/ponte-host.js`, generato da `tools/build.mjs`). Nessuna pagina lo può cambiare: non c'è un
campo da riempire, e chi passa davanti al PC non può mandare il telefono altrove. Con `host.txt` vuoto
la pagina ⋯ → iPhone dice «Ponte da configurare». (Per le prove, e solo verso questo
PC, `chrome.storage.local` `"ponte.host"` può dire `http://localhost:…`: vedi «Provare in casa».)

**2. Il ponte si pubblica con il sito EKG Atlas**, nello stesso Worker di Cloudflare:

```bash
# dalla radice del repository
npm install
npm run deploy        # = vite build + wrangler deploy (sito + ponte)
```

Risponde sull'indirizzo `workers.dev` del Worker, lo stesso del sito: niente dominio personalizzato,
niente secondo Worker.

Che cosa entra nel deploy:

| File | Che cosa |
|---|---|
| `worker/index.js` | l'ingresso del Worker: `/ponte/…` al ponte, il resto a `worker/metrics.js` (il gestore di sempre) |
| `worker/ponte.js` | il ripetitore: il Durable Object `PonteStanza` (`/ponte/ws`) e i file dell'app del telefono, solo quelli, con le loro intestazioni di sicurezza |
| `worker/ponte-logica.js` | la logica del ripetitore, senza Cloudflare (la stanza, il ruolo, i file dell'app): la stessa che usa il ripetitore Node dei test |
| `public/ponte/` | l'app del telefono (`index.html`, `app.js`, `app.css`, `cripto.js`, `jsqr.min.js`, `sw.js`, manifest, icone): Vite la copia in `dist/ponte/` |
| `wrangler.jsonc` | `main: worker/index.js`; il binding `PONTE` e la migrazione `new_sqlite_classes` (Durable Object su SQLite: va anche col piano gratuito); `run_worker_first` solo per `/ponte/*` e `/api/*`: le pagine del sito arrivano dai file statici senza svegliare il Worker; i log senza una riga per richiesta (`invocation_logs: false`) |
| `vite.config.ts` | il service worker del sito resta fuori da `/ponte/` (né in cache né nel suo ripiego di navigazione) |

Il sito resta com'era: le sue pagine, il ripiego SPA e `POST /api/metrics` (stessi codici di
risposta di prima). Un file che l'app del telefono non ha, sotto `/ponte/`, è un 404, mai la pagina
del sito. Nell'app pubblica c'è **solo codice**: nessun dato di nessun paziente passa o resta sul sito.

**Contro gli abusi.** Il Worker rifiuta una stanza malformata (non 32 cifre esadecimali, o un ruolo
che non è `pc`/`tel` o, per la [stazione di stampa](#la-stazione-di-stampa), `medico`/`stazione`) prima di svegliare un Durable Object, e il ripetitore chiude una presa che
manda più di 1200 messaggi al minuto o oltre 1 MB. (Uno script che apre prese a raffica consuma la
quota giornaliera del piano gratuito, la stessa di `/api/metrics`; una regola di limitazione della
frequenza di Cloudflare vorrebbe un dominio proprio: su `workers.dev` non c'è.)

> Un telefono che aveva già aperto EKG Atlas **prima** di questo deploy ha in memoria il service
> worker vecchio del sito, che risponde a ogni pagina con EKG Atlas: la prima volta che si apre il QR
> può comparire EKG Atlas invece del pannello. Il service worker del sito si aggiorna da solo in quel
> momento: si inquadra di nuovo il QR (o si ricarica) e da lì in poi va.

**Prova la rete** (⋯ → iPhone → «Prova la rete», o `extension/ponte-prova.html`): dal PC
dell'ospedale, con l'estensione vera, sulla strada vera del ponte. Entra in una stanza di prova — un
numero casuale, buttato alla fine — sia come PC sia come telefono, sulla presa `/ponte/ws`, e dice
quanto ci mette ad aprirsi e quanto un messaggio a fare il giro. **Tieni aperto 15 minuti** la tiene
aperta come la tiene il ponte (un battito ogni 20 secondi) e dice quando e perché è caduta, col
codice di chiusura. Nessun altro sito, nessun UDP. «Copia il risultato» lo mette negli appunti con un
blocco **«Per l'IT»**, da mandare così com'è.

## Che cosa vede l'IT

Dal Chrome del PC esce **una** connessione (due con una [stazione di stampa](#la-stazione-di-stampa) collegata, e una dal PC della stazione, uguali): una WebSocket su HTTPS, `wss://ekg-atlas.whirly.workers.dev/ponte/ws`,
**TCP 443**, solo in uscita, che deve passare il proxy (l'upgrade a WebSocket). È un indirizzo
`*.workers.dev` (Cloudflare): molti filtri web lo bloccano per categoria, e va consentito questo nome. È lunga — fino a 14
ore — con un battito ogni **20 secondi** (un piccolo «ping»): non va chiusa per inattività né per
durata. Nessuna porta in entrata, nessun UDP, nessun altro host. Dentro il TLS i messaggi sono cifrati
una seconda volta, da un capo all'altro (AES-256-GCM): si può **escludere dall'ispezione TLS** senza
esporre niente, e né l'IT né Cloudflare possono leggerli. Il gestionale non vede niente di nuovo: le
pagine che l'estensione apre o legge per un comando sono le stesse, con le stesse richieste, di quando
il medico usa il pannello.

## Come è fatto

**La chiave.** `K`, 32 byte casuali, nasce nel service worker del PC a ogni «Associa l'iPhone». Va
al telefono **solo nel frammento** del QR: `https://ekg-atlas.whirly.workers.dev/ponte/#k=<base64url>&scade=<ms>` (la fine del link, pochi minuti: non dell'associazione) — il
frammento non viaggia mai verso un server. L'app lo legge, lo toglie dalla barra e dalla
cronologia, e tiene `K` e un numero casuale suo
(`dev`) nel `localStorage` di Safari: è l'unica cosa che resta sul telefono. Sul PC `K` sta in
`chrome.storage.local` (`ponte.coppia`) fino alla revoca, senza scadenza: regge il browser chiuso e
riaperto, il logout e il rientro; la pagina d'accesso del gestionale chiude la sessione, non
l'associazione. Il QR si rivede solo nei primi due minuti e prima che
un telefono entri; il primo che entra lega l'associazione al suo `dev` (`ponte.coppia.dev`), e il PC
risponde «no» al saluto di ogni altro — salvo `cambio`, qui sotto.

**«Usa questo telefono».** Il telefono rifiutato tiene la chiave del QR e può rimandare il saluto con
un campo in più, `cambio: true` (stesso messaggio cifrato di ogni saluto, con `salutoTel`: senza la
chiave non si apre e il PC non risponde nemmeno). La sessione di prima finisce («Un altro iPhone ha
preso il posto di questo»), `ponte.coppia.dev` passa al nuovo telefono, e la risposta è quella di ogni
saluto. Un saluto di cambio già visto (rimandato da chi sta in mezzo) non vale due volte. Il vecchio
telefono, se rientra, trova «associato a un altro telefono» e può riprendersi il posto allo stesso
modo. (Un PC con l'estensione di prima voleva un codice: il telefono dice «Non cambiato: sul PC ⋯ →
iPhone → Associa l'iPhone, e inquadra il QR nuovo».)

**Da K, con HKDF-SHA256** (sale `ps-ponte/1`, WebCrypto, nessuna libreria — `public/ponte/cripto.js`,
copiato tale e quale in `extension/ponte-cripto.js` da `npm run build`, e un test controlla che
siano uguali):

- la **stanza** sul ripetitore: 16 byte in esadecimale (`info "stanza"`); il ripetitore la vede, ma
  da lì non si risale a K;
- il **codice dell'associazione**: 4 byte (`info "codice"`), sei cifre, accanto al QR e sul telefono;
- due chiavi AES-256-GCM di **saluto**, una per verso (`"saluto tel>pc"`, `"saluto pc>tel"`);
- per ogni sessione, due chiavi AES-256-GCM, una per verso, da K e da **due numeri casuali di 16
  byte, uno del telefono e uno del PC** (sale `ps-ponte/1 ‖ nTel ‖ nPc`, `"sessione tel>pc"`,
  `"sessione pc>tel"`): ogni sessione ha chiavi sue.

**Un messaggio** è binario: `[versione 1][tipo][numero d'ordine, 8 byte][IV, 12 byte casuali][testo
cifrato + tag]`. Tipo 1/2 = saluto del telefono/del PC, 3/4 = dati dal telefono/dal PC. I primi 10
byte sono dati autenticati (AAD). Il numero d'ordine cresce sempre, per verso: un messaggio ripetuto,
o arrivato dopo uno più nuovo, si scarta — e lo si decide **dopo** averlo decifrato, mai dalla testata
da sola: un messaggio di un'altra sessione non è «ripetuto», è «non mio», e chi lo riceve prova la
sessione nuova (così la pagina del telefono ricaricata rientra subito). Quello che non si apre con le
nostre chiavi si ignora e basta: chi non ha le chiavi non chiude niente. Dentro, JSON: `{id, cmd,
auto?, …}` dal telefono, `{re, ok, dati | errore}` e gli eventi `{evento: "ordine" | "fine" |
"avviso", …}` dal PC. In testo il ripetitore dice solo `{"pari": true|false}` (c'è qualcuno
dall'altra parte?) e risponde `pong` al battito.

**La sessione.** Il telefono manda il saluto (`{v, n: nTel, dev}`), il PC risponde (`{v, n: nPc, eco:
nTel, scade, ora}` — `ora` è l'orologio del PC, per lo scarto —, o `{v, eco, no}` a un telefono che non è quello dell'associazione: il telefono accetta
solo la risposta al *suo* saluto), e il primo messaggio cifrato con le chiavi nuove apre la sessione
sul PC. Un saluto da solo non chiude la sessione che c'è: la sostituisce solo una sessione nuova che
ha parlato. Se il PC riceve dati per una sessione che non conosce (il service worker si è riavviato e
le chiavi di sessione, che stavano solo in memoria, non ci sono più) risponde con un saluto «riparti»
che porta il `nTel` dell'ultima sessione e la frase del perché: il telefono lo accetta solo se parla
della *sua* sessione (ripetuto più tardi non chiude niente) e chiude; se il perché è il riavvio
(`riavvio`), si ricollega da solo — nessuno l'ha chiusa —, se no offre «Riapri». La fine di una
sessione porta la sua frase («Chiusa dal PC con «Scollega»»): il telefono la mostra così com'è.

**Vivi o morti.** Tutte e due le parti battono: il PC ogni 20 secondi, il telefono ogni 20 secondi
mentre l'app è davanti e subito quando ci torna. Se il `pong` non torna entro 10 secondi la presa è
morta anche se sembra aperta (un proxy che la lascia cadere senza dirlo), e se ne apre un'altra; il
telefono la rifà anche quando una risposta non arriva in tempo. Una presa chiusa dal ripetitore perché
un'altra dello stesso ruolo ha preso il suo posto (codice 4001) non si riapre da sola.

**Una rete che va e viene** (ascensore, 5G, wifi↔5G, rete lenta). Il telefono tiene una presa sola:
caduta, la riapre dopo mezzo secondo e poi sempre più di rado, fino a 15 secondi (con un po' di
caso); subito quando torna la rete (`online`) o l'app (`visibilitychange`, `pageshow`). Una presa che
non si apre in 12 secondi si rifà; il «pong» aspetta anche i byte già per strada, contati a 50 kbit/s,
come le attese dei pezzi di PDF. Quello che resta senza risposta si rimanda da solo sulla presa nuova:
le letture si rifanno, le scritture (ordine, nota, promemoria, «Fatto», cartella, i pezzi di «Stampa
un PDF») portano un numero (`rq`) che il PC ricorda per la sessione, e rimandate non si rifanno: il PC
risponde com'è andata. Passato il tempo il telefono dice che non sa («Non so se il Da fare è
salvato: aspetto il PC»), continua a rimandarla per 10 minuti e, quando il PC risponde, lo dice. Un PDF,
nei due versi, riprende dal pezzo dove era, e si lascia perdere dopo un tempo che cresce con la misura.
Senza rete la testata dice «Senza rete», quello che il telefono ha in memoria resta e quello che va
chiesto al PC è in grigio, finché il collegamento non torna. L'app stessa si apre dalla sua copia se la
rete non risponde in 3 secondi. Sul telefono non resta niente di più.

**I 3 minuti** contano solo i comandi del medico: quelli che l'app manda da sé (`auto`, e `ciao`,
`ordini`) non tengono aperta la sessione, né sul PC né sul telefono.

**Dove gira.** La presa sta nel **service worker** dell'estensione (`extension/ponte-sw.js`,
importato da `bg.js` dentro un `try`: un errore nel ponte spegne il ponte, non gli ordini, i referti
o le stampe): da Chrome 116 una WebSocket che parla almeno ogni 30 secondi lo tiene sveglio (qui ogni
20), ed è la strada indicata da Chrome; un documento «offscreen» vorrebbe un permesso nuovo per la
stessa cosa. Se Chrome lo ferma lo stesso, le schede del gestionale lo risvegliano entro 30 secondi
(`ponteSveglia`) e la presa si riapre con la chiave rimasta in `storage.local` — la sessione no: si
riapre dal telefono. I dati dei pazienti stanno dove stavano (il `localStorage` del gestionale,
l'archivio dell'estensione) e il motore sta nel content script: il service worker passa ogni comando
decifrato a **una** scheda viva del gestionale (prima quella davanti al medico; mai la scheda di un
ordine o dei valori in sottofondo), che lo esegue col codice di sempre (`src/core.js`, sezione PONTE)
e risponde. Nessuna scheda del gestionale: «Apri il gestionale sul PC». Gestionale sulla pagina
d'accesso: «Gestionale da riaprire». Una scheda che tace oltre l'attesa può star lavorando ancora: per
un ordine la risposta è «non si sa», mai un no, e l'ordine che nasce lo stesso arriva al telefono; un
ordine o un promemoria non passa poi alla scheda dopo (sarebbero due). Mai un silenzio.

**I comandi** (e solo questi, con argomenti controllati uno per uno): `pazienti`, `esiti(ep)`,
`aggiornaValori(ep)`, `richieste` (il catalogo, con `ultimi`: per paziente ed esame quello che il PC scrive accanto al nome — ore tornate, in attesa da quando, rosso da quando; con una stazione di stampa collegata, `stampa: {stazione, dove}`), `ordina(ep, oid, esami, quesito, mio, nato, dest?)`, `nota(ep,
testo)`, `promemoria(ep, testo)`, `fatto(ep, id)`, `cartella(ep, rileggi?)`, `cartellaSalva(ep, campi: {NOME:
{prima, dopo}})`, `terapie(ep, rileggi?)`, `terapiaCerca(ep, q)`, `terapiaAggiungi(ep, rq, voce, visti)`, `terapiaFine` (il foglio «＋ Farmaco» chiuso), `accetta(k | ep, rq)`, `ristampe(ep)` (per richiesta anche `et` e `fo`: quante etichette e quanti fogli), `ristampa(ep, rid, oid, dest?, quali?)` (`quali`: `etichette` | `foglio` | `tutto`), `pdf(ep, ref, i)`, `stampa(rid, i, n, size, b)`, `stampaReferto(ep, ref, rid, dest?)`, `stazioneCollega(sta, nome)`,
più `ciao`/`esci`/`tocco`/`ordini` per la sessione e lo stato degli ordini. Niente navigazione libera, niente script, niente appunti. L'ordine passa per
`ordineNuovo` come «Conferma e stampa», col numero `"tel" + oid` (l'`oid` lo fa il telefono quando
arma «Conferma», `^[\w-]{8,24}$`: chiesto due volte, è un ordine solo — `ordiniVisti` in `bg.js`),
con tutti i controlli del motore — episodio, richiesta, presidio, carrello identico alla ricevuta,
conferma provata. Niente ordini né promemoria su un episodio precedente, niente comandi per un
paziente dimesso (archiviato) sul PC. L'età la annota il pannello quando il medico apre la pagina
del paziente (`patients.v1`, `eta`): dalla testata della scheda («17/05/1949 (77) M»), se no dal
codice fiscale; il numero, mai la data. Gli esiti leggono una volta la pagina del paziente (solo
lettura, e solo se è del suo episodio) e la sua scheda clinica scelta con la stessa regola d'identità del pannello,
con l'ora in cui il PC l'ha letta; i testi dei referti si prendono per numero di referto, quello della
pagina di quel paziente. Un ECG o una radiografia salvati (la copia la tiene il service worker) ma col
testo mai letto — la pagina che l'aveva chiesto se n'era già andata — si leggono lì, dalla copia, con
lo stesso controllo di chi è del pannello (di un altro paziente: niente testo, niente PDF), e il testo
va nella scheda del paziente. «Aggiorna i valori» risponde quando la sua scheda ha finito — valori e
referti —, o allo scadere con i valori letti. «Aggiorna i valori» annota la sua scheda di sottofondo in `storage.session`
(`ponte.valori`): anche se il service worker si ferma a metà, la si riconosce, scade e si chiude; il
telefono aspetta 200 secondi, più del caso peggiore del PC.

**La cartella.** Il modulo `AmbulatorioPSO` della pagina del paziente (`ANAMNESI`,
`MALATTIE_PREGRESSE`, `FARMACI_ASSUNTI`, `ALLERGIE`, `ESAME_OBIETTIVO`). Ogni volta che il medico
apre la pagina, con un iPhone associato, la scheda manda i cinque testi (come la pagina li ha
caricati) al service worker, che li tiene in `storage.session` (`ponte.cartella`: in memoria, al
massimo 40 pazienti, via a fine sessione); `cartella` dà quella lettura, o con `rileggi` la pagina
riletta (una GET, come gli esiti), sempre con `allergie` (le parole del PC: la riga sotto il nome). Ogni
pagina letta — riletta, o ricaricata dopo un salvataggio — rinfresca anche le allergie che il PC sa del
paziente (`anag`): una verità sola per il campo, la riga sotto il nome e il riepilogo della Terapia. `cartellaSalva`, tutti o nessuno: prima ogni scheda del gestionale
dice se ha un testo non salvato nella cartella di quel paziente (se sì, no: il suo «Conferma»
rimanderebbe il modulo intero coi testi vecchi); poi la pagina si apre in una scheda di sottofondo
(`ponte.cartelle`, come «Aggiorna i valori», i testi solo nella memoria del service worker), che
controlla ogni campo — ancora scrivibile, e uguale a `prima` (spazi e a capo normalizzati) —, scrive
i testi e clicca il **«Conferma»** della pagina (`name="Update"`): il modulo lo manda il browser, mai
un invio costruito a mano. Ricaricata, la scheda rilegge e verifica campo per campo, e si chiude.
Poi le schede del medico con la pagina di quel paziente (`ponteCartellaAggiornata`): la pagina è di
prima, e da subito il suo «Conferma» della cartella è fermo (`confermaFerma`: clic e invio fermati
prima della pagina); senza niente scritto né un cursore in un campo si ricarica da sola (una GET
dell'indirizzo del paziente); se no la pill, e il «Conferma» resta fermo finché non la si ricarica.
Rimandato dopo una risposta persa, lo stesso salvataggio trova `prima` cambiato e non parte due
volte. Nel registro degli errori (`segnaErrore`) solo il perché e i nomi dei campi, mai un testo.

**La Terapia.** La pagina Terapia del gestionale (`PsoEpisodioTerapieImposta`), sempre da una scheda
di sottofondo (`ponte.terapie`, una sola) aperta sulla pagina del paziente, che preme il suo
pulsante «Terapia» e fa il lavoro chiesto (`ponteTerapiaQui` in `core.js`). Finita bene una lettura o
una ricerca, la scheda resta ferma sulla pagina Terapia (`fermo`) e il lavoro dopo la riusa
(`ponteTerapiaLavoro`): una ricerca lì dov'è, nella tendina della pagina; una lettura o un'aggiunta
prima rileggono la pagina col suo pulsante «Prescrizione» (una GET: lo stato di adesso, subito prima
di scrivere). Si chiude dopo un'aggiunta, a ogni dubbio, quando il foglio «＋ Farmaco» si chiude sul
telefono (`terapiaFine`), a fine sessione, per un altro paziente, dopo 2 minuti senza lavoro; una
scheda in cui il medico è entrato non si riusa. `terapie` dà l'ultima
lettura (`ponte.terapia`: le righe confermate e le voci delle tendine, niente note né nascosti; dalla
pagina aperta dal medico o da una scheda così, con un iPhone associato, via a fine sessione) o, con
`rileggi`, la pagina riletta, più i preferiti del PC; senza `ep` dice solo che il comando c'è (un PC
più vecchio: «Comando sconosciuto», e il telefono non mostra la scheda). `terapiaCerca` scrive `q`
nella tendina della pagina e torna con le scritte delle voci. `terapiaAggiungi` porta il suo numero
`rq` (`ponte.terapia.rq`: la fase e com'è andata, anche dopo un riavvio del service worker), il
farmaco (la scritta della voce e la dose, mai note né ora) e i `TERAPIA_PROG` che il telefono ha
visto: prima ogni scheda del gestionale dice se la Terapia di quel paziente è del medico (il suo
giro, una riga scritta: se sì, no); la scheda scrive la riga come il giro del PC, la rilegge, il
service worker annota «inviato» e solo allora la scheda clicca il **«Conferma»** della pagina; la
pagina che torna si guarda e basta («Confermata», o «incerto»). Lo stesso `rq` non si rifà mai.

**Accetta in ambulatorio.** `accetta` porta il paziente — `k`, la chiave di nome e ora d'arrivo di
una riga del Triage (`chiaveTriage`, la stessa che il comando `triage` manda a ogni riga e che usa
la mappa — non la chiave di nome e nascita; un PC più vecchio non la dà, e il telefono non mostra il
bottone), o `ep`, un paziente noto al PC ancora al triage (`pazienti` lo segna
`accetta`: la sua pagina è quella del triage e nessuna lista dell'ambulatorio l'ha visto dopo) — e
il suo numero `rq` (`ponte.accetta.rq`: la fase e com'è andata). Una scheda del medico dice chi è
e dà l'indirizzo della lista del triage; una scheda di sottofondo (`ponte.accette`, una alla volta;
`ponteAccettaQui` in `core.js`) apre la lista, trova la riga — una sola: per episodio se il PC lo
conosce, se no per la stessa `chiaveTriage` (nome e arrivo); il suo nome, la sua
freccia dello stesso episodio — e chiede `ponteAccettaInvio`: il service worker annota «inviato»
**prima**, e solo allora la scheda clicca la freccia (`a[name="AccettaAMBU"]`). Dopo si guarda e
basta: la pagina del paziente in ambulatorio, o — tornata sulla lista del triage senza di lui —
la lista dell'ambulatorio aperta col suo link (`ponteAccettaVerifica`); se no «incerto». Il PC lo
ricorda come se l'avesse aperto (la sua pagina) e lo toglie dal Triage del telefono; le pagine di
quel paziente aperte sul PC si ricaricano da sole, o — con un testo scritto lì — dicono «Aggiornato dal
telefono · Ricarica» e fermano il loro «Conferma», come dopo la cartella. Lo stesso `rq` non si
rifà mai. Nel registro del ponte il nome e com'è andata, come per la Terapia; nel registro degli
errori («accetta telefono») solo il perché.

**Un PDF da stampare.** `stampa` è `pdf` al contrario: il telefono manda il file a pezzi (~390 KB,
una risposta per pezzo) con un numero suo, `rid`. Il primo pezzo dice già di no se il file non comincia
con «%PDF», se supera 15 MB o se la stampa automatica è spenta: il resto non parte. Il PC ricompone in
memoria, controlla la misura e lo passa a `stampaDalTel` in `bg.js`: lo stesso motore e lo stesso
giornale delle stampe senza dialogo (il foglio «mandato» prima di partire, `ordiniVisti`), sull'A4.
Lo stesso `rid` rimandato risponde com'è andata e non stampa di nuovo. Il PDF sta solo nella memoria
del service worker finché il foglio non è partito (sul disco va solo il file temporaneo dell'aiutante
di stampa, come per ogni foglio); un riavvio a metà lo perde, e il foglio non parte. Finito, nel
giornale resta «PDF dall'iPhone» con l'esito, senza «Ristampa». La risposta all'ultimo pezzo arriva
a foglio stampato (fino a 110 secondi): le parole sono quelle di `pubblico`.

**Un referto da stampare.** `stampaReferto` `{ep, ref, rid, dest}` stampa un referto già offerto al
telefono in questa sessione (la stessa lista di `pdf`: `s.pdf`), dalla **copia salvata sul PC**, mai da
byte mandati dal telefono. Stesse regole di `stampa` per la destinazione (la stazione collegata, o la
stampa automatica di questo PC), stesso motore (`stampaDalTel`, nome «Referto dall'iPhone») e stesso
giornale: lo stesso `rid` rimandato risponde com'è andata e non stampa di nuovo. È ammesso anche dalla
build mini (stampa, non scrive). Il registro dice «iPhone · un referto stampato su …», senza testo del paziente.

**Gli ordini, raccontati.** Il service worker guarda passare gli ordini del telefono in `ordini`
(`storage.session`) e li racconta con le parole che `bg.js` scrive in ogni record (`pubblico:
{tono, titolo, testo, dettaglio}`, e `pubblico.tel` dove il telefono dice un'altra frase); non
riscrive niente. Al posto di «Quesito: il tuo» `bg.js` dice il quesito scritto sul telefono. Un ordine che
sparisce da `ordini` (le etichette prese da una scheda del PC, ✕ sul PC, tolto dalla coda) resta sul
telefono com'era l'ultima volta, finché non lo si chiude; sparito prima della conferma, «Da
controllare».

**Il ripetitore** (`worker/ponte-logica.js`): al massimo due prese per stanza, una del PC e una del
telefono — o, nella stanza di una stazione di stampa, una del PC del medico e una della stazione (`medico`,
`stazione`): ognuno parla solo col suo pari — (una nuova dello stesso ruolo chiude la vecchia, 4001); inoltra solo il binario, così com'è;
messaggi oltre 1 MB o più di 1200 al minuto chiudono la presa; una presa muta da 15 minuti si chiude.
Serve dell'app del telefono solo i suoi file (`FILE_APP`). Niente su disco (solo la sveglia di quella
pulizia), niente nei log: il Durable Object usa l'ibernazione delle WebSocket e il battito lo risponde
Cloudflare senza svegliarlo.

**L'app del telefono** (`public/ponte/`): meno è meglio (Jakub Krehel). Un elemento resta solo se
migliora quello che il medico fa: chi è il paziente, quando il PC ha letto i valori, a che punto è un
ordine, perché un bottone non va. Niente etichette di sezione («In lista», «Esami», «Referti»),
conteggi, piedi o testi di contorno; lo stato del collegamento compare solo quando manca. Niente
framework; solo il suo codice (CSP `default-src
'self'`, la rete solo verso il suo sito). I dati dei pazienti stanno nella memoria della pagina: mai
in `localStorage`, IndexedDB o nelle cache; il suo service worker tiene solo i file dell'app. Il
manifest ha `display: "standalone"`: l'icona della schermata Home apre l'app a tutto schermo, con una
memoria sua, separata da Safari. Per questo il QR si inquadra **dentro l'app** («Scansiona il QR»):
la chiave resta lì, e l'icona si ricollega da sola, senza scadenza. La chiave di ogni PC sta nella
**lista** (`psassist.ponte.pcs.v1`): un QR nuovo **aggiunge** quel PC e ci passa (non tocca gli altri),
e si cambia PC dal menu; lo stesso PC riscansionato aggiorna la sua riga, non ne fa una nuova.

**«Scansiona il QR»** apre la fotocamera nella pagina (`getUserMedia`, la fotocamera posteriore; la
`Permissions-Policy` la permette solo a quest'app, il microfono e la posizione a nessuno) e legge i
fotogrammi con **jsQR 1.4.0** (Apache 2.0, `jsqr.min.js`, caricato solo lì). Vale solo un link di
questo stesso sito su `/ponte/#k=…&scade=…` (un QR di un altro sito si ignora), e fa la strada di un
link aperto: le stesse regole, «Usa il codice …» compreso. La fotocamera si spegne appena letto il
codice, o chiusa la vista (✕).

## La stazione di stampa

Le stampanti dell'infermeria (etichettatrice e A4, col cavo sul **suo** PC) per i fogli degli ordini
del medico: per il medico, [README di PS Assist](../README.md#stazione-di-stampa-le-stampanti-dellinfermeria).
Il PC dell'infermeria ha la stessa estensione e lo stesso aiutante di stampa; la sua pagina
«Stazione di stampa» (`extension/stazione.html`) lo fa stazione. Il codice è uno,
`extension/stazione-sw.js`, nel service worker: la parte del PC del medico (`stm`) e quella della
stazione (`stz`). Lo stesso ripetitore e la stessa cifratura del ponte (`ponte-cripto.js`), in
un'altra stanza, coi ruoli `medico` e `stazione`.

**Collegarle (una volta), col telefono.** La stazione fa un'**offerta**, per cinque minuti e per un
PC solo: una chiave ECDH P-256 nuova e un numero casuale `s` di 16 byte. Il QR è un link dell'app del
telefono: `https://…/ponte/#sta=<chiave pubblica>.<s>.<scadenza>&nome=Infermeria` (mai una chiave del
telefono: l'app lo riconosce, e non tocca la sua associazione). Sotto il QR e sulla carta del telefono,
lo stesso codice di sei cifre (da `s` e dalla chiave pubblica). **Collega** manda l'offerta al PC
(comando `stazioneCollega`, una scrittura col suo `rq`). Il PC fa la sua chiave ECDH ed entra nella
stanza dell'abbinamento (`HKDF(s, "abbina stazione")`), dove la stazione aspetta; le manda la sua
chiave pubblica cifrata con `HKDF(s, "abbina medico>stazione")`, e la stazione risponde (`"abbina
stazione>medico"`) col suo nome. Il primo PC vince; lo stesso che rimanda ha la stessa risposta, un
altro «già usata». La chiave della coppia: `K = HKDF(ECDH, sale ps-ponte/1 ‖ s ‖ chiave del medico ‖
chiave della stazione, "stazione")`, nata dalle due parti. Il primo saluto con K la conferma (sulla
stazione, prima, è «mi collego»; scaduta l'offerta senza saluto, non vale); poi tutti e tre dicono lo
stesso codice, da K. Il telefono e il ripetitore vedono l'offerta (o i byte), mai K. (L'app del
telefono, servita dal sito, potrebbe in quei cinque minuti prendere il posto del PC: la stessa fiducia
che le si dà già, «Che cosa protegge».)

**Dopo: il ponte al contrario.** Il PC del medico fa il telefono (saluta con `salutoTel`, chiede con
`canaleTel`), la stazione fa il PC (risponde). Comandi, solo due: `stampa(rq, tipo, copie, i, n,
size, b)` — un foglio a pezzi da ~390 KB, una risposta per pezzo — e `esito(rq)`. La stazione stampa
col suo aiutante solo all'ultimo pezzo, una volta per `rq` (annotato in `stazione.rq`,
`storage.local`, prima di stampare: solo il numero e com'è andata, 200 al più, un giorno), e risponde
con l'esito del suo aiutante (`stampato`, `mandato`, `fallito`, `sconosciuto`). Il PC: nessun pezzo
arrivato (la stazione assente, nessuna risposta al saluto o a un pezzo) → «non risponde», niente
stampato; l'ultimo pezzo senza risposta → `esito` su una sessione nuova; non si sa → «forse
stampato». La stazione non manda mai niente per prima, se non i saluti e «scollegata»: tutto il resto,
sul PC, si scarta (`stm.ignorati`). Un service worker ripartito sulla stazione dice «riparti», e il PC
risaluta. Le due prese restano aperte (battito ogni 20 secondi; una sveglia di Chrome ogni minuto le
riapre: la stazione non ha schede del gestionale che la svegliano).

**Scollegare**: da tutte e due le parti, due tocchi. Chi scollega non usa più K da subito; l'altro lo
sa adesso (un saluto «revoca» con K), o appena si ricollega: per dirglielo chi ha scollegato tiene K,
solo per quello, al più una settimana.

**Che cosa vede l'IT**: lo stesso host, la stessa presa (`/ponte/ws`, TCP 443): una in più sul PC del
medico e una sul PC dell'infermeria, finché sono collegati. I **fogli degli ordini** — PDF con i nomi dei
pazienti — passano dal ripetitore di Cloudflare, cioè escono dall'ospedale e ci tornano, cifrati da
un capo all'altro (AES-256-GCM): il ripetitore non li legge né li tiene. Con «Stampa: Qui» non passa niente.

**Che cosa resta**: K in `storage.local` sui due PC, finché non si scollega (un PC fisso: niente
scadenza). Sulla stazione, del foglio, il numero e com'è andata, e per la sua pagina («Ultimi fogli»,
30) l'ora, il tipo, le pagine, le copie, la stampante — mai un nome; il PDF solo in memoria finché il
suo aiutante non l'ha stampato (e il suo file temporaneo, come per ogni foglio).

## Che cosa protegge, e che cosa no

- **I dati dei pazienti non stanno su nessun server.** Il ripetitore passa byte cifrati e non ne
  tiene nessuno; vede soltanto metadati: gli indirizzi IP (l'uscita dell'ospedale, l'operatore del
  telefono), gli orari, le misure dei messaggi, il numero della stanza e il ruolo. I log del Worker
  non hanno una riga per richiesta (`invocation_logs: false`): l'indirizzo della presa, con la
  stanza, non finisce nella dashboard di Cloudflare.
- **Telefono perso o rubato sbloccato**: l'associazione **non scade** (scelta del medico: un telefono
  solo suo, e nessun Face ID nell'app), quindi chi lo ha in mano e sbloccato può usare il pannello finché
  non lo si revoca. Lo limitano lo sblocco del telefono stesso, la sessione che si chiude dopo 3 minuti
  senza comandi (l'app da sola non la tiene aperta), la spia sul PC, il Registro, e **Revoca
  l'iPhone** dal PC (la chiave di quel telefono non apre più niente): se il telefono si perde sbloccato,
  la prima cosa è **Revoca** sul PC.
- **Il QR sullo schermo** vale quanto la chiave, ma per poco e per uno: si rivede solo nei primi due
  minuti, si toglie da solo appena l'iPhone entra, e dopo il primo telefono non apre a nessun altro.
  Nel dubbio, Revoca. Nel pannello (⋯ → iPhone) il QR sta nella pagina dell'estensione, in una
  cornice: la pagina del gestionale vede la cornice ma non ci legge dentro (un'altra origine); si apre
  solo dalle origini del gestionale (`web_accessible_resources`, solo `ponte.html`) e da un indirizzo
  che cambia a ogni avvio del browser (`use_dynamic_url`).
- **«Usa questo telefono»**: la protezione è la chiave del QR, che ha solo chi l'ha inquadrato; i due
  tocchi evitano soltanto un cambio per sbaglio. Un cambio si vede sul PC («iPhone cambiato alle …»,
  nel Registro) e il primo telefono ne esce.
- **PC sbloccato e incustodito**: dà già tutto il gestionale a chi si siede. Il ponte aggiunge che una
  sessione aperta si vede e si chiude con un tocco; il QR di prima non si rivede. La chiave vale
  finché non la si revoca, anche col browser chiuso e riaperto: se nel gestionale rientra un altro medico, il
  telefono associato lavora col suo accesso. Se il PC cambia mano, **Revoca l'iPhone**.
- **L'app del telefono divide l'origine con EKG Atlas**: chi può cambiare il sito (l'account Cloudflare, il repository, una sua dipendenza) può leggere la chiave e i dati decifrati; il medico lo accetta.
- **Niente segretezza «in avanti»**: le chiavi di sessione vengono da K e da numeri che viaggiano
  cifrati con chiavi derivate da K. Chi registrasse il traffico di un giorno *e* poi rubasse K di
  quel giorno (dal PC o dal telefono) potrebbe decifrarlo. K vive finché non la si revoca; uno scambio
  ECDH per sessione lo eviterebbe, al prezzo di altro codice.
- **Per scelta del medico non c'è Face ID dentro l'app**: possedere la chiave basta.
- **Più PC, chiavi separate.** Ogni PC associato (il completo e ogni porta di sola lettura) ha la
  **sua** chiave e la sua stanza: una non apre gli altri, e il telefono parla con uno alla volta.
  Compromettere un PC — o la sua chiave sul telefono — espone *quel* PC, non gli altri. Scansionare un
  QR nuovo **aggiunge** quel PC (o aggiorna il suo, o sostituisce il completo): non toglie di nascosto
  un'associazione che c'è già; quelle restano in lista, e si dimenticano una per una dal menu.
- **Un PC di sola lettura** (la build mini) è una **porta d'ingresso**: dal telefono si vede tutto
  quello che la sessione del gestionale aperta lì espone — i pazienti che il collega loggato sta già
  gestendo — e si stampa, ma **non si scrive**. Ogni comando di scrittura del gestionale (ordine,
  terapia, cartella, accettazione, Da fare, mappa) è rifiutato **sul PC** («Questo PC è in sola
  lettura»), nel service worker prima di toccare una scheda, e il codice di scrittura è anche **escluso
  dalla build** (niente pannello degli ordini, niente ricetta SISS). La testata del telefono dice chi è
  loggato nel gestionale su quel PC: informazione, non un blocco — l'accesso resta attribuito, dal
  gestionale, al collega loggato lì, come quando è lui a guardare la pagina. Un PC di sola lettura non
  può mandare comandi né al telefono né al PC completo.
- **L'aggiornamento della build mini è senza mani** (non c'è un pannello da cui premere): all'avvio e
  ogni sei ore si guarda GitHub e, se c'è una versione nuova e il PC è libero, si applica da sé — con
  **ogni** controllo di sempre (versione == `VERSION.txt`, **stessa chiave** della build mini,
  cartella installata, aiutante confermato, **host fisso** `raw.githubusercontent.com/mmariomm/EKGAtlas`,
  **mai a metà di una stampa**). Scambia solo la sua cartella, con la sua chiave: non può diventare
  un'altra estensione.
- **La stazione di stampa** riceve i fogli degli ordini e risponde; non comanda e non legge niente.
  Chi ha il telefono sbloccato e associato può collegare una stazione al PC, ma solo inquadrando il suo
  QR (sullo schermo della stazione, cinque minuti): il PC lo dice (⋯ → Stampanti, il Registro del ponte).
- **Un PDF da stampare** passa cifrato come tutto il resto, e chi ha il telefono sbloccato può far
  uscire fogli dalla stampante A4 del PC (uno per richiesta, al massimo 15 MB): il registro del ponte
  lo dice.

## Provare in casa

```bash
cd ps-app
node ponte/relay-node.mjs 8787     # il ripetitore e l'app: http://localhost:8787/ponte/
```

Nell'estensione, dalla console del suo service worker (`chrome://extensions` → PS Assist → «service
worker»): `chrome.storage.local.set({ "ponte.host": "http://localhost:8787" }).then(ponteAvvia)` —
vale solo un indirizzo `http://localhost` o `127.0.0.1` —, poi ⋯ → iPhone → «Associa l'iPhone», e il
link del QR in un browser. I test: `node test/ponte-cripto.mjs` (cifratura, logica del ripetitore, il
Worker con un ambiente finto, la configurazione di Cloudflare, e il service
worker del PC in una vm con un telefono finto) e `node test/ext-ponte.mjs` (tutto vero: estensione,
gestionale simulato, ripetitore Node, l'app in formato iPhone in un secondo browser, con la sua rete
fra lei e il ripetitore per perdere messaggi), entrambi in `npm test`.
