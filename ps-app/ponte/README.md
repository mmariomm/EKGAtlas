# Ponte — il pannello sull'iPhone

Il medico lascia il PC per qualche minuto (al massimo una ventina) e dal telefono, anche in 5G,
vuole: **vedere i pazienti**, **gli esiti** di uno (valori e referti), **ordinare esami**, scrivere
**una nota o un promemoria**. Il Ponte fa esattamente questo, e niente di più: tutto succede sul PC
dell'ospedale, con l'estensione e le pagine del gestionale di sempre; il telefono è un telecomando
cifrato.

```
 iPhone (Safari)                sito EKG Atlas (Cloudflare)              PC dell'ospedale (Chrome)
 /ponte/  app  ── wss:443 ──►   /ponte/ws  ripetitore  ◄── wss:443 ──   estensione (service worker)
                               (un Durable Object per stanza:            │ chrome.tabs.sendMessage
                                passa byte cifrati, non li legge,        ▼
                                non li tiene)                           una scheda del gestionale:
                                                                         il codice di sempre
```

## Per il medico

**Una volta per turno.** Sul PC, nel pannello: **⋯ → iPhone → Associa l'iPhone**. Compare un QR:
lo inquadri con la **fotocamera** dell'iPhone e tocchi il link. Si apre il pannello, già collegato.
L'associazione vale **14 ore** (l'ora di fine è scritta sul PC e sul telefono). Conviene aggiungerlo
alla schermata Home (Condividi → Aggiungi alla schermata Home): l'icona riapre il pannello.

**Durante il turno.** Apri il pannello dall'iPhone: si collega da solo, niente QR. Vedi:

- **Pazienti** — come la vista Pazienti del PC: chi è in lista, chi è nella stanza (col suo posto),
  la striscia del triage, la nota, il promemoria più vicino.
- **Esiti** — la tabella dei Valori che il PC ha per quel paziente e i referti, col testo di quelli
  già letti sul PC. **↻ Aggiorna i valori** fa sul PC il «⭳ Carica i valori» di sempre, in una scheda
  di sottofondo che si chiude da sola, e porta qui il risultato.
- **Richieste** — il quesito (i tre pacchetti in testa, con quanti esami portano), i profili e gli
  esami della griglia. Il bottone chiede conferma **col nome del paziente** («Ordino 2 esami per
  ROSSI M.? Tocca di nuovo»): poi l'ordine fa sul PC il giro di sempre — la scheda dell'ordine, tutti i
  controlli, la conferma provata. Il telefono dice a che punto è («esame 2 di 6») e come finisce
  («Confermata · Etichette mandate alla stampa sul PC», o l'errore con cosa manca). Le etichette si
  stampano **come le stampa il pannello in quel momento**, sul PC dove c'è la stampante. La
  radiologia, come dal pannello, resta nel carrello: la sua conferma è del medico, sul PC.
- **Nota e promemoria** — la nota del paziente (si salva uscendo dal campo) e i promemoria
  («11:30 tropo», «tra 2h ECG», ✓ Fatto): gli stessi del pannello.

**Sul PC si vede.** Finché una sessione è aperta, in ogni scheda del gestionale — pannello aperto o
ridotto a pill — c'è **«iPhone collegato · Scollega»**: chi passa davanti al PC lo sa, e con un tocco
la chiude. Ogni comando del telefono finisce nel **Registro** del pannello («iPhone · ordine di 2
esami per ROSSI MARIO…»), e la pagina ⋯ → iPhone ha il registro del ponte (sessioni aperte e
chiuse, comandi).

**La sessione finisce** dopo **20 minuti senza comandi**, con «Scollega» sul PC, alla scadenza
dell'associazione, con la revoca, o se l'estensione si riavvia. Il telefono lo dice («Sessione
chiusa · 20 minuti senza comandi») e cancella dalla sua memoria tutto quello che sapeva dei
pazienti; **Riapri** ne apre un'altra con un tocco, senza QR. **Revoca l'iPhone** (sulla pagina ⋯ →
iPhone, due tocchi) e la chiave di quel telefono non apre più niente: per rientrare serve un QR nuovo.
Per scelta del medico non c'è un secondo sblocco (Face ID) dentro l'app: il telefono è sempre con
lui e si sblocca già col suo Face ID; basta avere la chiave del QR.

## Messa in servizio (una volta)

**Il ponte si pubblica con il sito EKG Atlas**, nello stesso Worker di Cloudflare: non c'è niente
da installare a parte.

```bash
# dalla radice del repository
npm install
npm run deploy        # = vite build + wrangler deploy (sito + ponte)
```

Che cosa entra nel deploy:

| File | Che cosa |
|---|---|
| `worker/index.js` | l'ingresso del Worker: `/ponte/*` al ponte, tutto il resto al gestore di sempre (`worker/metrics.js`) |
| `worker/ponte.js` | il ripetitore: il Durable Object `PonteStanza` (`/ponte/ws`), la prova d'eco (`/ponte/eco`), `/ponte/salute`, le intestazioni di sicurezza dell'app |
| `worker/ponte-logica.js` | la logica del ripetitore, senza Cloudflare: la stessa che usa il ripetitore Node dei test |
| `public/ponte/` | l'app del telefono (`index.html`, `app.js`, `app.css`, `cripto.js`, `sw.js`, manifest, icone): Vite la copia in `dist/ponte/` |
| `wrangler.jsonc` | `main: worker/index.js`; il binding `PONTE` e la migrazione `new_sqlite_classes` (Durable Object su SQLite: va anche col piano gratuito); `run_worker_first` per `/ponte/*` e `/api/*` |
| `vite.config.ts` | il service worker del sito resta fuori da `/ponte/` (né in cache né nel suo ripiego di navigazione) |

Il sito resta com'era: le sue pagine, il ripiego SPA e `POST /api/metrics` (verificato con
`wrangler dev`: stessi codici di risposta di prima). Nell'app pubblica c'è **solo codice**: nessun
dato di nessun paziente passa o resta sul sito.

> Un telefono che aveva già aperto EKG Atlas **prima** di questo deploy ha in memoria il service
> worker vecchio del sito, che risponde a ogni pagina con EKG Atlas: la prima volta che si apre il QR
> può comparire EKG Atlas invece del pannello. Il service worker del sito si aggiorna da solo in quel
> momento: si inquadra di nuovo il QR (o si ricarica) e da lì in poi va.

**L'indirizzo nell'estensione.** Sul PC: pannello **⋯ → iPhone → Indirizzo del ponte**, e si scrive
l'indirizzo del sito EKG Atlas (`https://…`, solo l'origine: il ponte sta da sé sotto `/ponte/`).
La stessa pagina è raggiungibile da `chrome://extensions` → PS Assist → Dettagli → **Opzioni
estensione** → «associa il telefono». L'indirizzo pubblicato del sito non è scritto in questo
repository: per questo il campo parte vuoto (in `extension/ponte-sw.js`,
`PONTE_HOST_PREDEFINITO`, lo si può fissare una volta per tutte). Accetta solo `https://`
(e `http://localhost` per le prove).

**Prova la rete** (⋯ → iPhone → «Prova la rete», o `extension/ponte-prova.html`): dal PC
dell'ospedale, con l'estensione vera, una riga verde o rossa per prova — HTTPS verso il ponte e
verso Cloudflare, WebSocket cifrata andata e ritorno, la stessa tenuta aperta un minuto (tempi e
risposte perse), e UDP/WebRTC solo per sapere (al ponte non serve). Funziona anche prima del deploy:
senza indirizzo prova Cloudflare e un servizio d'eco pubblico. «Copia il risultato» lo mette negli
appunti, da mandare all'IT.

## Che cosa vede l'IT

Dal Chrome del PC esce **una** connessione: HTTPS/WebSocket verso il sito del ponte, porta 443,
percorso `/ponte/ws`, con un battito ogni 20 secondi (un piccolo «ping»). Nessuna porta in entrata,
nessun UDP, nessun altro host. Dentro il TLS i messaggi sono cifrati una seconda volta, da un capo
all'altro: né l'IT né Cloudflare possono leggerli. Il gestionale non vede niente di nuovo: le pagine
che l'estensione apre o legge per un comando sono le stesse, con le stesse richieste, di quando il
medico usa il pannello.

## Come è fatto

**La chiave.** `K`, 32 byte casuali, nasce nel service worker del PC a ogni «Associa l'iPhone». Va
al telefono **solo nel frammento** del QR: `https://<sito>/ponte/#k=<base64url>&scade=<ms>` — il
frammento non viaggia mai verso un server. L'app lo legge, lo toglie dalla barra e dalla
cronologia, e tiene `K` e la scadenza nel `localStorage` di Safari: è l'unica cosa che resta sul
telefono. Sul PC `K` sta in `chrome.storage.local` fino alla scadenza o alla revoca.

**Da K, con HKDF-SHA256** (sale `ps-ponte/1`, WebCrypto, nessuna libreria — `public/ponte/cripto.js`,
copiato tale e quale in `extension/ponte-cripto.js` da `npm run build`, e un test controlla che
siano uguali):

- la **stanza** sul ripetitore: 16 byte in esadecimale (`info "stanza"`); il ripetitore la vede, ma
  da lì non si risale a K;
- due chiavi AES-256-GCM di **saluto**, una per verso (`"saluto tel>pc"`, `"saluto pc>tel"`);
- per ogni sessione, due chiavi AES-256-GCM, una per verso, da K e da **due numeri casuali di 16
  byte, uno del telefono e uno del PC** (sale `ps-ponte/1 ‖ nTel ‖ nPc`, `"sessione tel>pc"`,
  `"sessione pc>tel"`): ogni sessione ha chiavi sue.

**Un messaggio** è binario: `[versione 1][tipo][numero d'ordine, 8 byte][IV, 12 byte casuali][testo
cifrato + tag]`. Tipo 1/2 = saluto del telefono/del PC, 3/4 = dati dal telefono/dal PC. I primi 10
byte sono dati autenticati (AAD). Il numero d'ordine cresce sempre, per verso: un messaggio ripetuto,
o arrivato dopo uno più nuovo, si scarta. Dentro, JSON: `{id, cmd, …}` dal telefono, `{re, ok, dati |
errore}` e gli eventi `{evento: "ordine" | "fine" | "avviso", …}` dal PC. In testo il ripetitore dice
solo `{"pari": true|false}` (c'è qualcuno dall'altra parte?) e risponde `pong` al battito.

**La sessione.** Il telefono manda il saluto (`{v, n: nTel}`), il PC risponde (`{v, n: nPc, eco: nTel,
scade}`: il telefono accetta solo la risposta al *suo* saluto), e il primo messaggio cifrato con le
chiavi nuove apre la sessione sul PC. Un saluto da solo non chiude la sessione che c'è: la sostituisce
solo una sessione nuova che ha parlato. Messaggi non validi di fila (chiave sbagliata, manomessi,
ripetuti): cinque, e la sessione si chiude («messaggi non validi»). Se il PC riceve dati per una
sessione che non conosce (il service worker si è riavviato e le chiavi, che stavano solo in memoria,
non ci sono più) risponde con un saluto «riparti» col motivo: il telefono chiude e offre «Riapri».

**Dove gira.** La presa sta nel **service worker** dell'estensione (`extension/ponte-sw.js`,
importato da `bg.js`): da Chrome 116 una WebSocket che parla almeno ogni 30 secondi lo tiene
sveglio (qui ogni 20), ed è la strada indicata da Chrome; un documento «offscreen» vorrebbe un
permesso nuovo per la stessa cosa. Se Chrome lo ferma lo stesso, le schede del gestionale lo
risvegliano entro 30 secondi (`ponteSveglia`) e la presa si riapre — la sessione no: si riapre dal
telefono. I dati dei pazienti stanno dove stavano (il `localStorage` del gestionale, l'archivio
dell'estensione) e il motore sta nel content script: il service worker passa ogni comando decifrato a
**una** scheda viva del gestionale (prima quella davanti al medico; mai la scheda di un ordine o dei
valori in sottofondo), che lo esegue col codice di sempre (`src/core.js`, sezione PONTE) e risponde.
Nessuna scheda del gestionale: «Apri il gestionale sul PC». Gestionale sulla pagina d'accesso:
«Gestionale da riaprire». Mai un silenzio.

**I comandi** (e solo questi, con argomenti controllati uno per uno): `pazienti`, `esiti(ep)`,
`aggiornaValori(ep)`, `richieste` (il catalogo), `ordina(ep, esami, quesito, mio)`, `nota(ep, testo)`,
`promemoria(ep, testo)`, `fatto(ep, id)`, più `ciao`/`esci`/`ordini` per la sessione e lo stato degli
ordini. Niente navigazione libera, niente script, niente appunti. L'ordine passa per
`ordineNuovo` come «Conferma e stampa» (il numero lo dà il service worker: chiesto due volte, è un
ordine solo), con tutti i controlli del motore — episodio, richiesta, presidio, carrello identico
alla ricevuta, conferma provata. Gli esiti leggono una volta la pagina del paziente (solo lettura,
e solo se è del suo episodio) e la sua scheda clinica scelta con la stessa regola d'identità del
pannello; i testi dei referti si prendono per numero di referto, quello della pagina di quel paziente.

**Il ripetitore** (`worker/ponte-logica.js`): al massimo due prese per stanza, una del PC e una del
telefono (una nuova dello stesso ruolo chiude la vecchia); inoltra solo il binario, così com'è;
messaggi oltre 1 MB o più di 1200 al minuto chiudono la presa; una presa muta da 15 minuti si
chiude. Niente su disco (solo la sveglia di quella pulizia), niente nei log: il Durable Object usa
l'ibernazione delle WebSocket e il battito lo risponde Cloudflare senza svegliarlo.

**L'app del telefono** (`public/ponte/`): niente framework; solo il suo codice (CSP `default-src
'self'`, la rete solo verso il suo sito). I dati dei pazienti stanno nella memoria della pagina: mai
in `localStorage`, IndexedDB o nelle cache; il suo service worker tiene solo i file dell'app. Il
manifest ha `display: "browser"`: sull'iPhone le app «a tutto schermo» della schermata Home hanno una
memoria separata da Safari, dove il QR — che la fotocamera apre in Safari — ha salvato la chiave;
così l'icona riapre Safari, con la chiave. Un QR nuovo inquadrato con l'app già aperta prende la
chiave nuova e riparte da capo.

## Che cosa protegge, e che cosa no

- **I dati dei pazienti non stanno su nessun server.** Il ripetitore passa byte cifrati e non ne
  tiene nessuno; vede soltanto metadati: gli indirizzi IP (l'uscita dell'ospedale, l'operatore del
  telefono), gli orari, le misure dei messaggi, il numero della stanza e il ruolo. I log del Worker
  del sito (osservabilità attiva) registrano le richieste — indirizzo con la stanza, ora, esito —
  mai il contenuto.
- **Telefono perso o rubato sbloccato**, durante le 14 ore: chi lo ha in mano può usare il pannello.
  Lo limitano lo sblocco del telefono stesso, la scadenza, la sessione che si chiude dopo 20 minuti,
  la spia sul PC, il Registro, e **Revoca l'iPhone** dal PC (la chiave di quel telefono non apre più
  niente).
- **Il QR sullo schermo** vale quanto la chiave: chi lo fotografa entra fino alla scadenza. Si mostra
  solo quando serve e si toglie da solo appena l'iPhone entra; nel dubbio, Revoca.
- **PC sbloccato e incustodito**: come oggi — dà già tutto il gestionale a chi si siede. Il ponte
  aggiunge solo che una sessione aperta si vede, e si chiude con un tocco.
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

Nell'estensione, ⋯ → iPhone → indirizzo `http://localhost:8787`, poi «Associa l'iPhone», e il link del
QR in un browser. I test: `node test/ponte-cripto.mjs` (cifratura, logica del ripetitore, il Worker
con un ambiente finto) e `node test/ext-ponte.mjs` (tutto vero: estensione, gestionale simulato,
ripetitore Node, l'app in formato iPhone in un secondo browser), entrambi in `npm test`.
