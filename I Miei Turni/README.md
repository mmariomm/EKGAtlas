# I Miei Turni

Una pagina sola, senza dipendenze, che mostra i turni mensili del Pronto Soccorso di due
ospedali — **DEA** e **OSG** — letti dai file xlsx ufficiali. Pensata per il telefono.

## Cosa fa

Tre viste, con la stessa ricerca e lo stesso filtro delle sedi:

- **Tabella** (è quella che si apre): tutti i nomi del mese, un giorno per riga, le due sedi
  una sotto l'altra — la sigla `DEA` o `OSG` scritta nel suo colore, con la riga velata dello
  stesso colore — e le colonne M, P, N, A. All'apertura la pagina si porta sul giorno di
  oggi, incorniciato, a metà schermo. L'interruttore **Semplifica** unisce mattina e
  pomeriggio in una colonna `Giorno 08–20`: chi fa entrambi si legge una volta sola, con la
  sua fascia accanto al nome (`PASTORE 8–20`), e l'ambulatorio entra lì come mattina, marcato
  `amb`.
- **Calendario**: il mese in una videata, con sabato e domenica in due bande. Il quadrato di
  un giorno lavorato prende una velatura della sede e le lettere grandi delle fasce — `M`,
  `MP`, `N` — nel colore della sede. Sotto, il dettaglio del giorno scelto: le fasce in
  colonna, le sedi in riga, i nomi incolonnati.
- **Ore**: le ore del mese per nome, in barre divise per sede. La vedono solo quelli che
  possono aggiornare i turni.

E in più:

- **Cerca un nome** e lo evidenzia a ogni lettera, in tutte le viste; toccando il campo si
  aprono tutti i nomi del mese, e scrivendo restano i possibili, così un refuso nel foglio
  (per esempio `ORLANDITOSKIC` senza la barra) si vede subito come nome a sé, col
  suggerimento. Il nome fissato resta finché non lo togli, anche riaprendo l'app.
- **Le due pillole in alto** accendono e spengono una sede: filtrano tabella, calendario,
  ore e conteggi, e restano come le lasci. Sono anche la legenda dei colori, sempre in vista.
- **Toccando l'intestazione di una fascia** si legge cos'è per esteso: `Ambulatorio Codici
  Minori`, `dalle 8 alle 14`, e il ruolo scritto nel foglio.
- **Totale**, in fondo, quando un nome è fissato: `Totale G4,5 (M4 + P5) + N5 = 114h`, e sotto
  una riga per sede. G sono le giornate, e si scompone in mattine e pomeriggi con i conti che
  tornano sempre: G = (M + P) / 2, e i turni da 12 h per 12 danno le ore. Una mattina o un
  pomeriggio da soli valgono mezza giornata; l'ambulatorio conta come una mattina.
- **Mostra i miei turni nel mio calendario**, il pulsante in fondo: sul sito iscrive il
  calendario del telefono a un indirizzo che si aggiorna da solo (`webcal://`, un tocco su
  iPhone; su Android si aggiunge l'indirizzo da Google Calendar). Fuori dal sito scarica un
  file `.ics`. Gli eventi si chiamano `PS DEA Mattina`, `PS OSG Notte` e simili — Mattina
  8–14, Pomeriggio 14–20, Giornata 8–20, Notte 20–8.
- **Segnalazioni**, calcolate su tutti i turni caricati anche a cavallo di due mesi, in una
  riga ciascuna (`BRAHAM · notte 17 OSG → mattina 18 OSG · riposo 0h`). L'elenco lo vede solo
  chi aggiorna i turni; il nome evidenziato nel colore della segnalazione lo vedono tutti.
  - **Conflitto** — stesso orario in due sedi, oppure doppio incarico nella stessa sede con
    più di 1 h di sovrapposizione.
  - **Notte attaccata** — turno diurno subito prima o subito dopo una notte, con meno di 11 h
    di riposo.
  - **Cambio sede** — due turni diurni consecutivi in sedi diverse senza pausa.
- **Uso**, per chi aggiorna: quante aperture, quanti dispositivi, quanti hanno installato
  l'app, quante sessioni hanno cercato un nome, il ritmo giorno per giorno, i nomi più
  cercati e gli iscritti al calendario. Solo numeri: nessun nome è collegato a un
  dispositivo, nessun indirizzo IP viene registrato.
- **Sul telefono**: alla prima apertura una finestra spiega come aggiungere la pagina alla
  schermata Home — su Android con un pulsante *Installa*, su iPhone con il percorso di
  Safari. La pagina ricorda vista, pillole e nome fissato.

## Aprire

Doppio clic su `index.html`. Funziona da file locale, offline, su telefono e computer.
I dati del mese corrente sono già dentro la pagina.

## Aggiornare i turni

In tutti i casi, dopo aver scelto il file compare una **scheda di revisione** con le sole
differenze rispetto alla versione già caricata dello stesso ospedale e mese (nomi
aggiunti, tolti, sostituiti o solo riordinati), più gli avvisi del file. Si conferma con
**Salva** o si annulla; prima di Salva non cambia nulla. Un file identico non salva
niente; un mese nuovo mostra il riepilogo e chiede conferma.

Tre strade, a seconda di dove sta la pagina:

- **Pagina pubblicata (artifact)**: chi ha il permesso di scrivere preme **Salva per
  tutti** e la pagina pubblica una nuova versione dei dati (`data/turni.json`) dentro lo
  stesso artifact: chi la ha aperta la vede aggiornarsi, ogni versione resta nello
  storico. Con il solo permesso di vista, o se l'artifact è condiviso con link pubblico,
  il salvataggio condiviso non è disponibile: i turni restano sul dispositivo e da lì in
  poi la sezione di caricamento resta in grigio, con la spiegazione.
- **Dal browser (subito, solo su quel dispositivo)**: «Carica xlsx», il bottone in fondo
  alla pagina. I dati restano nel browser (localStorage); «Ripristina i dati pubblicati»,
  lì accanto, torna indietro.
- **Pubblicando nel repo (per tutti i dispositivi)**: copia i nuovi xlsx in `data/` e
  lancia:

  ```bash
  cd "I Miei Turni"
  npm run build      # rigenera index.html con i dati dentro
  npm test           # opzionale: verifica parser e regole
  ```

  Poi commit e push (o copia `index.html` dove serve). Non servono pacchetti npm: bastano
  Node 18+ e i file in `src/`.

## Pubblicare il sito con le password

Il sito sta su Cloudflare Workers e chiede una password all'ingresso. Ce ne sono due, che
danno due permessi diversi: una per chi guarda (tabella e calendario) e una per
chi aggiorna, che in più vede le **Ore** e le **Segnalazioni** e può caricare i nuovi
xlsx per tutti. I turni
condivisi stanno in uno spazio dati (KV) del Worker, non nel repository.

La prima volta, dalla cartella `I Miei Turni/`:

```bash
npx wrangler kv namespace create TURNI   # copia l'id stampato dentro wrangler.jsonc
npx wrangler secret put PASS_MEDICO      # la password di chi guarda
npx wrangler secret put PASS_GESTORE     # la password di chi aggiorna
npx wrangler secret put SESSION_SECRET   # una frase lunga a caso, serve a firmare le sessioni
npm run deploy                           # rifà la pagina e la pubblica
```

Le password non stanno in nessun file del progetto: vivono solo nei secret di Cloudflare.
Per cambiarne una basta rilanciare il `secret put` corrispondente. Da sapere: **cambiare una
password non fa uscire chi è già entrato** — la sessione dura 180 giorni ed è firmata con
`SESSION_SECRET`. Per far rientrare tutti, cambia anche quello.

Dopo la prima volta, ogni aggiornamento del codice o dei dati di partenza è solo
`npm run deploy`. I turni del mese, invece, si aggiornano dal telefono: chi ha la seconda
password carica l'xlsx dalla pagina, controlla le differenze e salva per tutti.

## Cosa si aspetta dai file xlsx

Il formato è quello dei fogli «Turni MPA I» in uso: una riga di intestazione con
`MATTINA 8-14`, `POMERIGGIO 14-20`, `NOTTE 20-08` (e, per il DEA, `AMBULATORIO CM
09.30-15.00`), la riga sotto con i ruoli, poi una riga per giorno con numero e giorno della
settimana in colonna A e B, e i nomi separati da `/`. La riga «Periodo di riferimento»
dà mese e anno; la cella «TURNI PS …» dà l'ospedale. Niente è cablato per riga o colonna:
l'intestazione viene cercata, quindi righe spostate o colonne nascoste non rompono nulla.

Controlli fatti sui dati e mostrati nella scheda di revisione al momento del caricamento:
giorno della settimana che non corrisponde alla data, giorni duplicati o fuori mese, orari
non trovati nell'intestazione, nomi sospetti (concatenazioni o varianti rare di un nome
frequente, segnalati anche sotto la ricerca).

## Struttura

```
index.html        pagina generata da build.js (è quella da aprire e condividere)
build.js          data/*.xlsx → index.html (inlina src/* e i dati)
worker.mjs        il sito su Cloudflare: password, ruoli, turni condivisi in KV
wrangler.jsonc    configurazione del deploy (in testa i comandi per KV e password)
src/shell.html    scheletro HTML con i segnaposto
src/styles.css    stili (tema chiaro/scuro)
src/parser.js     lettura xlsx → roster (browser e Node, zero dipendenze)
src/rules.js      assegnazioni, segnalazioni, conteggi, ore, calendario, confronto, ricerca
src/app.js        interfaccia
test/             test di parser, regole e worker (node:assert), con i roster attesi in test/fixtures
data/             i file xlsx sorgente
```

## Prossimo passo: avvisi sul telefono

Da fare, non ancora fatto. Quando chi gestisce salva un file nuovo, chi ha la pagina sul
telefono riceve un avviso che dice **quali dei suoi turni sono cambiati**, non solo che
qualcosa è cambiato: «Turni aggiornati — 2 tuoi turni cambiati: sab 12 notte OSG, gio 17
mattina DEA».

Come si costruisce, quando sarà il momento:

- I pezzi difficili ci sono già. `TurniRules.diffRosters` dice esattamente quali celle sono
  cambiate, e la pagina ricorda il cognome dell'utente (`localStorage["imieiturni.me"]`):
  filtrare le differenze su quel cognome è una riga.
- Serve un **service worker** (`sw.js`) e una sottoscrizione Web Push per dispositivo,
  salvata in KV insieme al cognome scelto: `push:<endpoint>` → `{ cognome, chiavi }`.
  Le chiavi VAPID si generano una volta e stanno nei secret di Cloudflare.
- Al salvataggio, il Worker confronta la versione vecchia con la nuova, e per ogni
  sottoscrizione manda l'avviso solo se quel cognome compare tra le celle cambiate. Un
  invio per dispositivo, testo già pronto lato server.
- Sul telefono va chiesto il permesso una volta sola, con un interruttore in fondo alla pagina
  («Avvisami quando cambiano i miei turni»). Su iPhone gli avvisi web funzionano solo se la
  pagina è stata aggiunta alla schermata Home: va detto nell'interfaccia, non dato per
  scontato.
- Utile anche senza avvisi: all'apertura, una riga che dice cosa è cambiato per te dall'ultima
  volta che hai guardato (basta ricordare la data dell'ultima visita e rifare il confronto).
