# Ponte — il pannello sull'iPhone

Il medico lascia il PC per qualche minuto (al massimo una ventina) e dal telefono, anche in 5G,
vuole: **vedere i pazienti**, **gli esiti** di uno (valori e referti), **ordinare esami**, scrivere
**una nota o un promemoria**. Il Ponte fa esattamente questo, e niente di più: tutto succede sul PC
dell'ospedale, con l'estensione e le pagine del gestionale di sempre; il telefono è un telecomando
cifrato.

```
 iPhone (Safari)                il sito del ponte (Cloudflare)           PC dell'ospedale (Chrome)
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
da solo ogni volta che torni sull'app («Aggiornato alle 14:32»). Vedi:

- **Pazienti** — come la vista Pazienti del PC: chi è in lista, chi è nella stanza (col suo posto),
  gli episodi precedenti in fondo, la striscia del triage, la nota, il promemoria più vicino. Il nome
  non si tronca mai: il posto e il promemoria vanno a capo.
- **Il paziente** — in testa il nome intero, l'anno di nascita (dal codice fiscale della sua pagina)
  e il posto: «ROSSI MARIO · 1960 · OBI 2». Sotto, subito, le schede **Esiti** e **Richieste** (resta
  quella che hai scelto l'ultima volta); la nota e i promemoria stanno chiusi finché non servono
  («+ Nota», «+ Promemoria»).
- **Esiti** — la tabella dei Valori che il PC ha per quel paziente, con l'ora in cui il PC li ha letti
  («Letti sul PC alle 08:02 · 4 h fa», in ambra dopo un'ora; una colonna con valori parziali lo dice
  nella testata: «07:28 · parziale»), e i referti, col testo di quelli già letti sul PC. **↻ Aggiorna
  i valori** fa sul PC il «⭳ Carica i valori» di sempre, in una scheda di sottofondo che si chiude da
  sola, e porta qui il risultato.
- **Richieste** — il quesito (i tre pacchetti in testa, con quanti esami portano), i profili e gli
  esami della griglia. Il bottone chiede conferma **col nome intero, l'anno e il posto** («Ordino
  2 esami per ROSSI MARIO · 1960 · OBI 2? Tocca di nuovo»); un secondo tocco entro 800 ms (un doppio
  tocco per sbaglio) non conta. Poi l'ordine fa sul PC il giro di sempre — la scheda dell'ordine,
  tutti i controlli, la conferma provata. Il telefono dice a che punto è («esame 2 di 6») e come
  finisce, con le stesse parole della striscia del PC (`pubblico`, scritto da `bg.js`). Un ordine
  finito male resta in fondo alla lista («Ordine non completo · BIANCHI ANNA — tocca per vedere»)
  finché non lo chiudi con ✕. Sul PC la striscia dell'ordine dice **«dall'iPhone»**. La radiologia, come
  dal pannello, resta nel carrello: la sua conferma è del medico, sul PC. Su un episodio precedente
  non si ordina («Episodio precedente: per ordinare apri quello di oggi»); a un paziente dimesso sul
  PC non arriva niente («Dimesso sul PC: niente inviato»).
- **Se la rete perde la risposta** (ascensore, 5G): il telefono non sa se l'ordine è partito, e lo
  dice — «Non so se l'ordine è partito: controlla qui sopra prima di rifarlo». La selezione se ne va
  e il bottone aspetta che il PC dica a che punto sono gli ordini. L'ordine ha un numero fatto dal
  telefono quando arma «Conferma»: rimandato, è lo stesso ordine, e il PC lo manda una volta sola.
- **Nota e promemoria** — la nota del paziente (si salva uscendo dal campo) e i promemoria
  («11:30 tropo», «tra 2h ECG»): gli stessi del pannello. **✓ Fatto** aspetta 5 secondi, con
  **Annulla**, prima di toglierlo dal PC.

Di notte l'app è scura, come il telefono. Ogni bottone è grande almeno 44 punti.

**Sul PC si vede.** Finché una sessione è aperta, in ogni scheda del gestionale — pannello aperto o
ridotto a pill — c'è **«iPhone collegato · Scollega»**: chi passa davanti al PC lo sa, e con un tocco
la chiude. Ogni comando del telefono finisce nel **Registro** del pannello («iPhone · ordine di 2
esami per ROSSI MARIO…»), e la pagina ⋯ → iPhone ha il registro del ponte (sessioni aperte e
chiuse, comandi, un altro telefono rifiutato).

**La sessione finisce** dopo **20 minuti senza comandi del medico** (quello che l'app chiede da sé —
rileggere l'elenco, gli ordini — non conta), con «Scollega» sul PC, alla scadenza dell'associazione,
con la revoca, se l'estensione si riavvia, o se **una scheda del gestionale torna alla pagina
d'accesso**: allora si chiude anche l'associazione, perché chi rientra può essere un altro medico, e
gli ordini dal telefono partirebbero col suo nome. Il telefono lo dice («Sessione chiusa · 20 minuti
senza comandi», «Il gestionale sul PC è tornato alla pagina d'accesso») e cancella dalla sua memoria
tutto quello che sapeva dei pazienti, avvisi compresi; **Riapri** ne apre un'altra con un tocco,
senza QR. **Revoca l'iPhone** (sulla pagina ⋯ → iPhone, due tocchi) e la chiave di quel telefono non
apre più niente: per rientrare serve un QR nuovo. Anche **chiudere il browser** del PC chiude
l'associazione: la chiave sta solo nella sua memoria.

Il pannello aperto su un altro telefono o in un'altra scheda prende il posto di questo, che si ferma
(«Aperto su un altro dispositivo · Riprendi qui») e non fa a gara per riprenderselo.

Per scelta del medico non c'è un secondo sblocco (Face ID) dentro l'app: il telefono è sempre con
lui e si sblocca già col suo Face ID; basta avere la chiave del QR.

## Messa in servizio (una volta)

**1. L'indirizzo del ponte** si scrive una volta, in `ps-app/ponte/host.txt` (una riga, il nome del
sito: `ponte.example.org`), e `npm run dist` lo fissa nell'estensione (`extension/ponte-host.js`,
generato da `tools/build.mjs`). Nessuna pagina lo può cambiare: non c'è un campo da riempire, e chi
passa davanti al PC non può mandare il telefono altrove. Con `host.txt` vuoto la pagina ⋯ → iPhone
dice «Ponte da configurare». (Per le prove, e solo verso questo PC, `chrome.storage.local`
`"ponte.host"` può dire `http://localhost:…`: vedi «Provare in casa».)

**2. Il ponte si pubblica con il sito EKG Atlas**, nello stesso Worker di Cloudflare:

```bash
# dalla radice del repository
npm install
npm run deploy        # = vite build + wrangler deploy (sito + ponte)
```

**Meglio su un nome suo.** L'app del telefono tiene la chiave nella memoria del suo sito: se divide
l'origine con le pagine di EKG Atlas, un errore o una dipendenza compromessa del sito potrebbe
leggerla. Il Worker sceglie chi risponde col nome della richiesta (`instrada`, in
`worker/ponte-logica.js`), secondo `PONTE_HOSTNAME` (`wrangler.jsonc`, `vars`):

- **vuoto** (com'è oggi): il ponte sta su `/ponte/` del sito, come prima;
- **un nome** (`ponte.example.org`): su quel nome risponde **solo** il ponte — l'app del telefono
  (`/ponte/…`) e la presa (`/ponte/ws`), `/` porta a `/ponte/`, il resto è un 404 —, e il sito non
  serve più `/ponte/` (404). Così l'app che tiene la chiave non divide l'origine con nessuna pagina;
- **`*`**: ogni nome è il ponte (è il Worker a parte, qui sotto).

Le due strade, a seconda che il sito abbia un dominio suo:

- **A. Un sottodominio sullo stesso Worker** (il sito ha un dominio su Cloudflare): Cloudflare →
  Workers → `ekg-atlas` → Domini e route → **Aggiungi un dominio personalizzato** `ponte.<dominio>`;
  poi `PONTE_HOSTNAME = "ponte.<dominio>"` in `wrangler.jsonc`, `ponte/host.txt` =
  `ponte.<dominio>`, `npm run deploy` e `npm run dist`.
- **B. Un Worker a parte** (il sito sta solo su `*.workers.dev`, o non si vuole toccarlo):
  `wrangler.ponte.jsonc` pubblica lo stesso codice come Worker `ps-ponte`, con `PONTE_HOSTNAME = "*"`:

  ```bash
  npm run build && npx wrangler deploy -c wrangler.ponte.jsonc
  ```

  Risponde su `ps-ponte.<account>.workers.dev` (o su un dominio aggiunto a lui). Poi il sito prende
  `PONTE_HOSTNAME = "ps-ponte.<account>.workers.dev"` (così smette di servire `/ponte/`), e
  `ponte/host.txt` = quel nome. Il Durable Object del sito resta dichiarato (toglierlo vorrebbe una
  migrazione `deleted_classes`), ma non si sveglia più.

In tutti i casi chi può pubblicare quel Worker (l'account Cloudflare, il repository) può anche
servire un'app diversa: il nome a sé toglie di mezzo il sito, non chi pubblica.

Che cosa entra nel deploy:

| File | Che cosa |
|---|---|
| `worker/index.js` | l'ingresso del Worker: `instrada` decide fra ponte, sito (`worker/metrics.js`, il gestore di sempre) e 404 |
| `worker/ponte.js` | il ripetitore: il Durable Object `PonteStanza` (`/ponte/ws`) e i file dell'app del telefono, solo quelli, con le loro intestazioni di sicurezza |
| `worker/ponte-logica.js` | la logica del ripetitore, senza Cloudflare (la stanza, il ruolo, i file dell'app, chi risponde a quale nome): la stessa che usa il ripetitore Node dei test |
| `public/ponte/` | l'app del telefono (`index.html`, `app.js`, `app.css`, `cripto.js`, `sw.js`, manifest, icone): Vite la copia in `dist/ponte/` |
| `wrangler.jsonc` | `main: worker/index.js`; il binding `PONTE` e la migrazione `new_sqlite_classes` (Durable Object su SQLite: va anche col piano gratuito); `PONTE_HOSTNAME`; `run_worker_first` per ogni pagina (`/*`) tranne i file pesanti del sito (`/assets/*`, `/recordings/*`, `/icons/*`): così sul nome del ponte nessuna pagina del sito arriva dai file statici; i log senza una riga per richiesta (`invocation_logs: false`) |
| `wrangler.ponte.jsonc` | lo stesso Worker pubblicato a parte, solo ponte (strada B) |
| `vite.config.ts` | il service worker del sito resta fuori da `/ponte/` (né in cache né nel suo ripiego di navigazione) |

Il sito resta com'era: le sue pagine, il ripiego SPA e `POST /api/metrics` (stessi codici di
risposta di prima). Un file che l'app del telefono non ha, sotto `/ponte/`, è un 404, mai la pagina
del sito. Nell'app pubblica c'è **solo codice**: nessun dato di nessun paziente passa o resta sul sito.

**Contro gli abusi.** Il Worker rifiuta una stanza malformata (non 32 cifre esadecimali, o un ruolo
che non è `pc`/`tel`) prima di svegliare un Durable Object, e il ripetitore chiude una presa che
manda più di 1200 messaggi al minuto o oltre 1 MB. Se serve di più — uno script che apre prese a
raffica consuma la quota giornaliera del piano gratuito, che è la stessa di `/api/metrics` —, una
regola di Cloudflare, facoltativa (vale su un dominio del proprio account, non su `*.workers.dev`):
Sicurezza → WAF → **Regole di limitazione della frequenza** → «Se il percorso URI inizia con
`/ponte/`», contando per IP, **30 richieste in 10 secondi** → Blocca (sul piano gratuito il blocco
dura 10 secondi: basta a fermare uno script). Un telefono e un PC veri si ricollegano ogni tanto, mai
trenta volte in dieci secondi.

> Un telefono che aveva già aperto EKG Atlas **prima** di questo deploy ha in memoria il service
> worker vecchio del sito, che risponde a ogni pagina con EKG Atlas: la prima volta che si apre il QR
> può comparire EKG Atlas invece del pannello. Il service worker del sito si aggiorna da solo in quel
> momento: si inquadra di nuovo il QR (o si ricarica) e da lì in poi va. (Su un nome a sé del ponte
> il problema non c'è.)

**Prova la rete** (⋯ → iPhone → «Prova la rete», o `extension/ponte-prova.html`): dal PC
dell'ospedale, con l'estensione vera, sulla strada vera del ponte. Entra in una stanza di prova — un
numero casuale, buttato alla fine — sia come PC sia come telefono, sulla presa `/ponte/ws`, e dice
quanto ci mette ad aprirsi e quanto un messaggio a fare il giro. **Tieni aperto 15 minuti** la tiene
aperta come la tiene il ponte (un battito ogni 20 secondi) e dice quando e perché è caduta, col
codice di chiusura. Nessun altro sito, nessun UDP. «Copia il risultato» lo mette negli appunti con un
blocco **«Per l'IT»**, da mandare così com'è.

## Che cosa vede l'IT

Dal Chrome del PC esce **una** connessione: una WebSocket su HTTPS, `wss://<sito del ponte>/ponte/ws`,
**TCP 443**, solo in uscita, che deve passare il proxy (l'upgrade a WebSocket). È lunga — fino a 14
ore — con un battito ogni **20 secondi** (un piccolo «ping»): non va chiusa per inattività né per
durata. Nessuna porta in entrata, nessun UDP, nessun altro host. Dentro il TLS i messaggi sono cifrati
una seconda volta, da un capo all'altro (AES-256-GCM): si può **escludere dall'ispezione TLS** senza
esporre niente, e né l'IT né Cloudflare possono leggerli. Il gestionale non vede niente di nuovo: le
pagine che l'estensione apre o legge per un comando sono le stesse, con le stesse richieste, di quando
il medico usa il pannello.

## Come è fatto

**La chiave.** `K`, 32 byte casuali, nasce nel service worker del PC a ogni «Associa l'iPhone». Va
al telefono **solo nel frammento** del QR: `https://<sito>/ponte/#k=<base64url>&scade=<ms>` — il
frammento non viaggia mai verso un server. L'app lo legge, lo toglie dalla barra e dalla
cronologia, e tiene `K`, la scadenza (al massimo 14 ore da quando l'ha letto) e un numero casuale suo
(`dev`) nel `localStorage` di Safari: è l'unica cosa che resta sul telefono. Sul PC `K` sta in
`chrome.storage.session` — in memoria, mai su disco: muore col browser — fino alla scadenza, alla
revoca o alla pagina d'accesso del gestionale. Il QR si rivede solo nei primi due minuti e prima che
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
(`ponteSveglia`) e la presa si riapre con la chiave rimasta in `storage.session` — la sessione no: si
riapre dal telefono. I dati dei pazienti stanno dove stavano (il `localStorage` del gestionale,
l'archivio dell'estensione) e il motore sta nel content script: il service worker passa ogni comando
decifrato a **una** scheda viva del gestionale (prima quella davanti al medico; mai la scheda di un
ordine o dei valori in sottofondo), che lo esegue col codice di sempre (`src/core.js`, sezione PONTE)
e risponde. Nessuna scheda del gestionale: «Apri il gestionale sul PC». Gestionale sulla pagina
d'accesso: «Gestionale da riaprire». Una scheda che tace oltre l'attesa può star lavorando ancora: per
un ordine la risposta è «non si sa», mai un no, e l'ordine che nasce lo stesso arriva al telefono.
Mai un silenzio.

**I comandi** (e solo questi, con argomenti controllati uno per uno): `pazienti`, `esiti(ep)`,
`aggiornaValori(ep)`, `richieste` (il catalogo), `ordina(ep, oid, esami, quesito, mio)`, `nota(ep,
testo)`, `promemoria(ep, testo)`, `fatto(ep, id)`, più `ciao`/`esci`/`ordini` per la sessione e lo
stato degli ordini. Niente navigazione libera, niente script, niente appunti. L'ordine passa per
`ordineNuovo` come «Conferma e stampa», col numero `"tel" + oid` (l'`oid` lo fa il telefono quando
arma «Conferma», `^[\w-]{8,24}$`: chiesto due volte, è un ordine solo — `ordiniVisti` in `bg.js`),
con tutti i controlli del motore — episodio, richiesta, presidio, carrello identico alla ricevuta,
conferma provata. Niente ordini né promemoria su un episodio precedente, niente comandi per un
paziente dimesso (archiviato) sul PC. Gli esiti leggono una volta la pagina del paziente (solo
lettura, e solo se è del suo episodio: da lì anche l'anno di nascita, dal codice fiscale del
riquadro, mai salvato) e la sua scheda clinica scelta con la stessa regola d'identità del pannello,
con l'ora in cui il PC l'ha letta; i testi dei referti si prendono per numero di referto, quello della
pagina di quel paziente. «Aggiorna i valori» annota la sua scheda di sottofondo in `storage.session`
(`ponte.valori`): anche se il service worker si ferma a metà, la si riconosce, scade e si chiude; il
telefono aspetta 200 secondi, più del caso peggiore del PC.

**Gli ordini, raccontati.** Il service worker guarda passare gli ordini del telefono in `ordini`
(`storage.session`) e li racconta con le parole che `bg.js` scrive per tutti in ogni record
(`pubblico: {tono, titolo, testo, dettaglio}`); senza `pubblico`, il nome del suo stato e la vista
della striscia. Al posto di «Quesito: il tuo» dice il quesito scritto sul telefono. Un ordine che
sparisce da `ordini` (le etichette prese da una scheda del PC, ✕ sul PC, tolto dalla coda) resta sul
telefono com'era l'ultima volta, finché non lo si chiude; sparito prima della conferma, «Da
controllare».

**Il ripetitore** (`worker/ponte-logica.js`): al massimo due prese per stanza, una del PC e una del
telefono (una nuova dello stesso ruolo chiude la vecchia, 4001); inoltra solo il binario, così com'è;
messaggi oltre 1 MB o più di 1200 al minuto chiudono la presa; una presa muta da 15 minuti si chiude.
Serve dell'app del telefono solo i suoi file (`FILE_APP`). Niente su disco (solo la sveglia di quella
pulizia), niente nei log: il Durable Object usa l'ibernazione delle WebSocket e il battito lo risponde
Cloudflare senza svegliarlo.

**L'app del telefono** (`public/ponte/`): niente framework; solo il suo codice (CSP `default-src
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
  sessione aperta si vede e si chiude con un tocco; il QR di prima non si rivede; la chiave muore col
  browser e con la pagina d'accesso del gestionale (fine turno, un altro medico che entra).
- **Chi serve l'app del telefono la può cambiare.** La chiave e i dati decifrati stanno in una pagina
  che arriva dal sito del ponte: chi può pubblicare quel sito (l'account Cloudflare, il repository, le
  dipendenze della build) potrebbe servire un'app che li legge. Su un nome a sé (`PONTE_HOSTNAME`) la
  pagina non divide l'origine con EKG Atlas e le sue dipendenze; il resto resta.
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
Worker con un ambiente finto e su quale nome risponde, la configurazione di Cloudflare, e il service
worker del PC in una vm con un telefono finto) e `node test/ext-ponte.mjs` (tutto vero: estensione,
gestionale simulato, ripetitore Node, l'app in formato iPhone in un secondo browser, con la sua rete
fra lei e il ripetitore per perdere messaggi), entrambi in `npm test`.
