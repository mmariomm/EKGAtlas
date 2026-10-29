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

**Una volta per turno.** Sul PC, nel pannello: **⋯ → iPhone → Associa l'iPhone**. Compare un QR,
con accanto un **codice di sei cifre** («482 913»): lo inquadri con la **fotocamera** dell'iPhone e
tocchi il link. Si apre il pannello, già collegato; lo stesso codice è nel suo menu ⋯. L'associazione
vale **14 ore** (l'ora di fine è scritta sul PC e sul telefono) e vale per **quel telefono solo**: il
primo che entra. Un altro telefono che inquadra lo stesso QR si sente dire «Il PC è associato a un
altro telefono». Il QR si rivede con «Mostra il QR» solo nei primi due minuti e solo finché nessun
telefono è entrato; dopo, «Associa» ne fa uno nuovo (e il telefono di prima esce). Conviene
aggiungerlo alla schermata Home (Condividi → Aggiungi alla schermata Home): l'icona riapre il pannello.

Un link del ponte che toglierebbe un'associazione ancora buona **chiede prima**, coi due codici
(«Usa il codice 482 913» o «Tieni quella di adesso»): il codice giusto è quello accanto al QR, sul PC.
E nessun link vale più di 14 ore, qualunque scadenza porti.

**Durante il turno.** Apri il pannello dall'iPhone: si collega da solo, niente QR. L'elenco si rilegge
da solo ogni volta che torni sull'app («Aggiornato alle 14:32»), e se eri su un paziente anche i suoi
esiti (un referto arrivato intanto): riletture che l'app fa da sé, e che non tengono aperta la
sessione. Vedi:

- **Pazienti** — in una carta sola chi è in lista e chi è nella stanza (col suo posto), gli episodi
  precedenti a parte; la striscia del triage, la nota, il promemoria più vicino. Il nome non si tronca
  mai: il posto e il promemoria vanno a capo.
- **Il paziente** — in testa il nome intero, l'età e il posto: «ROSSI MARIO · 77 anni · OBI 2» (su
  un episodio precedente lo dice sotto; due pazienti con lo stesso nome hanno il ⚠ e il segno che li
  distingue, come nell'elenco: «⚠ ROSSI MARIO · …9001 · 77 anni · OBI 2»). Sotto, subito, le schede **Esiti** e **Richieste** (resta
  quella che hai scelto l'ultima volta); la nota e i promemoria stanno chiusi finché non servono
  («+ Nota», «+ Promemoria»).
- **Esiti** — la tabella dei Valori che il PC ha per quel paziente, con l'ora in cui il PC li ha letti
  («Letti sul PC alle 08:02 · 4 h fa», in ambra dopo un'ora; una colonna con valori parziali lo dice
  nella testata: «07:28 · parziale»), e i referti, col testo di quelli già letti sul PC. **↻ Aggiorna
  i valori** fa sul PC il «⭳ Carica i valori» di sempre, in una scheda di sottofondo che si chiude da
  sola, e porta qui il risultato.
- **Richieste** — il quesito (i tre pacchetti in testa), i profili e gli esami della griglia. Il
  bottone chiede conferma **col nome intero, l'età e il posto** («Ordino 2 esami per ROSSI MARIO ·
  77 anni · OBI 2? Tocca di nuovo»; per un omonimo «⚠ Ordino …», col segno); un secondo tocco entro
  800 ms (un doppio tocco per sbaglio) non conta. Poi l'ordine fa sul PC il giro di sempre — la scheda dell'ordine,
  tutti i controlli, la conferma provata. Il telefono dice a che punto è («esame 2 di 6») e come
  finisce, con le parole che `bg.js` scrive per la striscia del PC (`pubblico`) — tranne dove al
  telefono serve un'altra frase: «aspettano qualcuno al PC» invece di «tocca Stampa», «Etichette
  forse stampate: guarda Zebra ZD421 prima di ristamparle dal PC» invece del perché tecnico. Il
  titolo della carta è com'è andata («Stampato su Zebra ZD421», «Mandato a Zebra ZD421» in ambra),
  l'ora c'è una volta, e una carta finita bene se ne va da sola dopo due minuti. Un ordine
  finito male resta in fondo alla lista, e in testa alla pagina di ogni altro paziente
  («Ordine non completo · BIANCHI ANNA»: toccalo e sei sul paziente), finché non lo chiudi con ✕.
  Sul PC la striscia dell'ordine dice **«dall'iPhone»**. La radiologia, come
  dal pannello, resta nel carrello: la sua conferma è del medico, sul PC. Su un episodio precedente
  non si ordina («Episodio precedente: per ordinare apri quello di oggi»); a un paziente dimesso sul
  PC non arriva niente («Dimesso sul PC: niente inviato»).
- **Se la rete perde la risposta** (ascensore, 5G): il telefono non sa se l'ordine è partito, e lo
  dice — «Non so se l'ordine è partito: controlla qui sopra prima di rifarlo». La selezione se ne va
  e il bottone aspetta che il PC dica a che punto sono gli ordini. Se intanto il telefono si è
  ricollegato e vede l'ordine nato sul PC, il bottone smette di aspettare e l'allarme non c'è: lo
  dice già la carta. L'ordine ha un numero fatto dal
  telefono quando arma «Conferma»: rimandato, è lo stesso ordine, e il PC lo manda una volta sola.
- **Nota e promemoria** — la nota del paziente (si salva uscendo dal campo) e i promemoria
  («11:30 tropo», «tra 2h ECG»): sul PC sono voci di **Da fare**, la lista del pannello. La nota è
  la prima voce aperta senza ora (scritta cambia quella, o ne fa una in cima; vuota la toglie), i
  promemoria le voci aperte con l'ora. **✓ Fatto** aspetta 5 secondi, con **Annulla**, prima di
  spuntarlo sul PC.

Di notte l'app è scura, come il telefono. Ogni bottone è grande almeno 44 punti. Sul telefono c'è
solo quello che serve: niente etichette di sezione, conteggi o testi di contorno (vedi «L'app del
telefono», più sotto).

**Sul PC si vede.** Finché una sessione è aperta, in ogni scheda del gestionale — pannello aperto o
ridotto a pill — c'è **«iPhone collegato · Scollega»**: chi passa davanti al PC lo sa, e con un tocco
la chiude. Ogni comando del telefono finisce nel **Registro** del pannello («iPhone · ordine di 2
esami per ROSSI MARIO…»), e la pagina ⋯ → iPhone ha il registro del ponte (sessioni aperte e
chiuse, comandi, un altro telefono rifiutato).

**La sessione finisce** dopo **20 minuti senza comandi del medico** (quello che l'app chiede da sé —
rileggere l'elenco, gli ordini — non conta), con «Scollega» sul PC, alla scadenza dell'associazione,
con la revoca, se l'estensione o il browser si riavviano, o se **una scheda del gestionale torna
alla pagina d'accesso** (senza il gestionale il ponte non fa niente). Il telefono lo dice («Sessione
chiusa · 20 minuti senza comandi», «Il gestionale sul PC è tornato alla pagina d'accesso») e cancella
dalla sua memoria tutto quello che sapeva dei pazienti, avvisi compresi; **Riapri** ne apre un'altra
con un tocco, senza QR. L'associazione resta: rientrato nel gestionale, o riaperto il browser del PC,
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
| `public/ponte/` | l'app del telefono (`index.html`, `app.js`, `app.css`, `cripto.js`, `sw.js`, manifest, icone): Vite la copia in `dist/ponte/` |
| `wrangler.jsonc` | `main: worker/index.js`; il binding `PONTE` e la migrazione `new_sqlite_classes` (Durable Object su SQLite: va anche col piano gratuito); `run_worker_first` solo per `/ponte/*` e `/api/*`: le pagine del sito arrivano dai file statici senza svegliare il Worker; i log senza una riga per richiesta (`invocation_logs: false`) |
| `vite.config.ts` | il service worker del sito resta fuori da `/ponte/` (né in cache né nel suo ripiego di navigazione) |

Il sito resta com'era: le sue pagine, il ripiego SPA e `POST /api/metrics` (stessi codici di
risposta di prima). Un file che l'app del telefono non ha, sotto `/ponte/`, è un 404, mai la pagina
del sito. Nell'app pubblica c'è **solo codice**: nessun dato di nessun paziente passa o resta sul sito.

**Contro gli abusi.** Il Worker rifiuta una stanza malformata (non 32 cifre esadecimali, o un ruolo
che non è `pc`/`tel`) prima di svegliare un Durable Object, e il ripetitore chiude una presa che
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

Dal Chrome del PC esce **una** connessione: una WebSocket su HTTPS, `wss://ekg-atlas.whirly.workers.dev/ponte/ws`,
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
al telefono **solo nel frammento** del QR: `https://ekg-atlas.whirly.workers.dev/ponte/#k=<base64url>&scade=<ms>` — il
frammento non viaggia mai verso un server. L'app lo legge, lo toglie dalla barra e dalla
cronologia, e tiene `K`, la scadenza (al massimo 14 ore da quando l'ha letto) e un numero casuale suo
(`dev`) nel `localStorage` di Safari: è l'unica cosa che resta sul telefono. Sul PC `K` sta in
`chrome.storage.local` (`ponte.coppia`) fino alla scadenza o alla revoca: regge il browser chiuso e
riaperto, come dura il turno; la pagina d'accesso del gestionale chiude la sessione, non
l'associazione. Il QR si rivede solo nei primi due minuti e prima che
un telefono entri; il primo che entra lega l'associazione al suo `dev` (`ponte.coppia.dev`), e il PC
risponde «no» al saluto di ogni altro.

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
nTel, scade}`, o `{v, eco, no}` a un telefono che non è quello dell'associazione: il telefono accetta
solo la risposta al *suo* saluto), e il primo messaggio cifrato con le chiavi nuove apre la sessione
sul PC. Un saluto da solo non chiude la sessione che c'è: la sostituisce solo una sessione nuova che
ha parlato. Se il PC riceve dati per una sessione che non conosce (il service worker si è riavviato e
le chiavi di sessione, che stavano solo in memoria, non ci sono più) risponde con un saluto «riparti»
che porta il `nTel` dell'ultima sessione e la frase del perché: il telefono lo accetta solo se parla
della *sua* sessione (ripetuto più tardi non chiude niente), chiude e offre «Riapri». La fine di una
sessione porta la sua frase («Chiusa dal PC con «Scollega»»): il telefono la mostra così com'è.

**Vivi o morti.** Tutte e due le parti battono: il PC ogni 20 secondi, il telefono ogni 20 secondi
mentre l'app è davanti e subito quando ci torna. Se il `pong` non torna entro 10 secondi la presa è
morta anche se sembra aperta (un proxy che la lascia cadere senza dirlo), e se ne apre un'altra; il
telefono la rifà anche quando una risposta non arriva in tempo. Una presa chiusa dal ripetitore perché
un'altra dello stesso ruolo ha preso il suo posto (codice 4001) non si riapre da sola.

**I 20 minuti** contano solo i comandi del medico: quelli che l'app manda da sé (`auto`, e `ciao`,
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
`aggiornaValori(ep)`, `richieste` (il catalogo), `ordina(ep, oid, esami, quesito, mio)`, `nota(ep,
testo)`, `promemoria(ep, testo)`, `fatto(ep, id)`, più `ciao`/`esci`/`ordini` per la sessione e lo
stato degli ordini. Niente navigazione libera, niente script, niente appunti. L'ordine passa per
`ordineNuovo` come «Conferma e stampa», col numero `"tel" + oid` (l'`oid` lo fa il telefono quando
arma «Conferma», `^[\w-]{8,24}$`: chiesto due volte, è un ordine solo — `ordiniVisti` in `bg.js`),
con tutti i controlli del motore — episodio, richiesta, presidio, carrello identico alla ricevuta,
conferma provata. Niente ordini né promemoria su un episodio precedente, niente comandi per un
paziente dimesso (archiviato) sul PC. L'età la annota il pannello quando il medico apre la pagina
del paziente (`patients.v1`, `eta`): dalla testata della scheda («17/05/1949 (77) M»), se no dal
codice fiscale; il numero, mai la data. Gli esiti leggono una volta la pagina del paziente (solo
lettura, e solo se è del suo episodio) e la sua scheda clinica scelta con la stessa regola d'identità del pannello,
con l'ora in cui il PC l'ha letta; i testi dei referti si prendono per numero di referto, quello della
pagina di quel paziente. «Aggiorna i valori» annota la sua scheda di sottofondo in `storage.session`
(`ponte.valori`): anche se il service worker si ferma a metà, la si riconosce, scade e si chiude; il
telefono aspetta 200 secondi, più del caso peggiore del PC.

**Gli ordini, raccontati.** Il service worker guarda passare gli ordini del telefono in `ordini`
(`storage.session`) e li racconta con le parole che `bg.js` scrive in ogni record (`pubblico:
{tono, titolo, testo, dettaglio}`, e `pubblico.tel` dove il telefono dice un'altra frase); non
riscrive niente. Al posto di «Quesito: il tuo» `bg.js` dice il quesito scritto sul telefono. Un ordine che
sparisce da `ordini` (le etichette prese da una scheda del PC, ✕ sul PC, tolto dalla coda) resta sul
telefono com'era l'ultima volta, finché non lo si chiude; sparito prima della conferma, «Da
controllare».

**Il ripetitore** (`worker/ponte-logica.js`): al massimo due prese per stanza, una del PC e una del
telefono (una nuova dello stesso ruolo chiude la vecchia, 4001); inoltra solo il binario, così com'è;
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
manifest ha `display: "browser"`: sull'iPhone le app «a tutto schermo» della schermata Home hanno una
memoria separata da Safari, dove il QR — che la fotocamera apre in Safari — ha salvato la chiave;
così l'icona riapre Safari, con la chiave. Un QR nuovo inquadrato con l'app già aperta riparte da
capo (e, se c'è un'associazione ancora buona con un'altra chiave, chiede prima).

## Che cosa protegge, e che cosa no

- **I dati dei pazienti non stanno su nessun server.** Il ripetitore passa byte cifrati e non ne
  tiene nessuno; vede soltanto metadati: gli indirizzi IP (l'uscita dell'ospedale, l'operatore del
  telefono), gli orari, le misure dei messaggi, il numero della stanza e il ruolo. I log del Worker
  non hanno una riga per richiesta (`invocation_logs: false`): l'indirizzo della presa, con la
  stanza, non finisce nella dashboard di Cloudflare.
- **Telefono perso o rubato sbloccato**, durante le 14 ore: chi lo ha in mano può usare il pannello.
  Lo limitano lo sblocco del telefono stesso, la scadenza, la sessione che si chiude dopo 20 minuti
  senza comandi (l'app da sola non la tiene aperta), la spia sul PC, il Registro, e **Revoca
  l'iPhone** dal PC (la chiave di quel telefono non apre più niente).
- **Il QR sullo schermo** vale quanto la chiave, ma per poco e per uno: si rivede solo nei primi due
  minuti, si toglie da solo appena l'iPhone entra, e dopo il primo telefono non apre a nessun altro.
  Nel dubbio, Revoca.
- **PC sbloccato e incustodito**: dà già tutto il gestionale a chi si siede. Il ponte aggiunge che una
  sessione aperta si vede e si chiude con un tocco; il QR di prima non si rivede. La chiave vale fino
  alla scadenza, anche col browser chiuso e riaperto: se nel gestionale rientra un altro medico, il
  telefono associato lavora col suo accesso. A fine turno, **Revoca l'iPhone**.
- **L'app del telefono divide l'origine con EKG Atlas**: chi può cambiare il sito (l'account Cloudflare, il repository, una sua dipendenza) può leggere la chiave e i dati decifrati; il medico lo accetta.
- **Niente segretezza «in avanti»**: le chiavi di sessione vengono da K e da numeri che viaggiano
  cifrati con chiavi derivate da K. Chi registrasse il traffico di un giorno *e* poi rubasse K di
  quel giorno (dal PC o dal telefono) potrebbe decifrarlo. K vive al massimo 14 ore; uno scambio
  ECDH per sessione lo eviterebbe, al prezzo di altro codice.
- **Per scelta del medico non c'è Face ID dentro l'app**: possedere la chiave basta.

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
