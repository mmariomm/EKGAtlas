# I Miei Turni

Una pagina sola, senza dipendenze, che mostra i turni mensili del Pronto Soccorso di due
ospedali — **DEA** e **OSG** — letti dai file xlsx ufficiali. Pensata per il telefono.

## Cosa fa

- **Cerca un nome** e lo evidenzia a ogni lettera; toccando il campo si aprono tutti i
  nomi del mese, e scrivendo restano i possibili, così un refuso nel foglio (per esempio
  `ORLANDITOSKIC` senza la barra) si vede subito come nome a sé, con il suggerimento.
- **Calendario**: il mese in una videata; sotto, il dettaglio del giorno scelto (oggi
  all'apertura; frecce o scorrimento laterale per cambiare giorno). Con un nome fissato,
  ogni giorno mostra le sue fasce nel colore dell'ospedale — `G` per la giornata (mattina
  e pomeriggio nello stesso ospedale), `M`, `P`, `N` in pieno per la notte, `A` — e una
  riga di conteggi in forma di addizione: `4,5G + 5N = 9,5 · 114 h · DEA 78 · OSG 36`.
  Una mattina o un pomeriggio da soli valgono mezza giornata, l'ambulatorio conta come una
  mattina, e i conti tornano sempre: i turni da 12 h per 12 fanno le ore del mese (le ore
  sono comunque calcolate a parte, come unione reale degli orari).
- **Tabella**: tutti i nomi del mese, giorno per riga, DEA e OSG su due righe, colonne
  M/P/N/A, con lo stesso evidenziatore.
- **Ore**: le ore del mese per nome, in barre divise per ospedale. Compare solo a chi
  aggiorna i turni: su una copia propria del file, o dopo il primo salvataggio riuscito
  (in *Dati* c'è l'interruttore per mostrarle su un altro dispositivo). Non è una
  serratura: la piattaforma non dice alla pagina chi la sta guardando.
- **Segnalazioni**, calcolate su tutti i turni caricati anche a cavallo di due mesi, in
  una riga ciascuna (`BRAHAM · notte 17 OSG → mattina 18 OSG · riposo 0 h`):
  - **Conflitto** — stesso orario in due ospedali, oppure doppio incarico nello stesso
    ospedale con più di 1 h di sovrapposizione (ambulatorio → pomeriggio nello stesso PS
    è un passaggio di consegne, non un conflitto).
  - **Notte attaccata** — turno diurno subito prima o subito dopo una notte, con meno di
    11 h di riposo.
  - **Cambio sede** — due turni diurni consecutivi in ospedali diversi senza pausa.
- La pagina **ricorda l'ultimo nome fissato** e la vista scelta; mese, nome, giorno e
  vista stanno anche nell'indirizzo (`#mese=…&nome=…&giorno=…&vista=…`), quindi un link
  condiviso apre la stessa vista.

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
- **Dal browser (subito, solo su quel dispositivo)**: «Carica xlsx». I dati restano nel
  browser (localStorage); «Ripristina i dati pubblicati» nella sezione *Dati* torna
  indietro.
- **Pubblicando nel repo (per tutti i dispositivi)**: copia i nuovi xlsx in `data/` e
  lancia:

  ```bash
  cd "I Miei Turni"
  npm run build      # rigenera index.html con i dati dentro
  npm test           # opzionale: verifica parser e regole
  ```

  Poi commit e push (o copia `index.html` dove serve). Non servono pacchetti npm: bastano
  Node 18+ e i file in `src/`.

## Cosa si aspetta dai file xlsx

Il formato è quello dei fogli «Turni MPA I» in uso: una riga di intestazione con
`MATTINA 8-14`, `POMERIGGIO 14-20`, `NOTTE 20-08` (e, per il DEA, `AMBULATORIO CM
09.30-15.00`), la riga sotto con i ruoli, poi una riga per giorno con numero e giorno della
settimana in colonna A e B, e i nomi separati da `/`. La riga «Periodo di riferimento»
dà mese e anno; la cella «TURNI PS …» dà l'ospedale. Niente è cablato per riga o colonna:
l'intestazione viene cercata, quindi righe spostate o colonne nascoste non rompono nulla.

Controlli fatti sui dati e mostrati nella sezione *Dati*: giorno della settimana che non
corrisponde alla data, giorni duplicati o fuori mese, orari non trovati nell'intestazione,
nomi sospetti (concatenazioni o varianti rare di un nome frequente).

## Struttura

```
index.html        pagina generata da build.js (è quella da aprire e condividere)
build.js          data/*.xlsx → index.html (inlina src/* e i dati)
src/shell.html    scheletro HTML con i segnaposto
src/styles.css    stili (tema chiaro/scuro, stampa)
src/parser.js     lettura xlsx → roster (browser e Node, zero dipendenze)
src/rules.js      assegnazioni, segnalazioni, conteggi, ore, confronto tra versioni, ricerca
src/app.js        interfaccia
test/             test di parser e regole (node:assert), con i roster attesi in test/fixtures
data/             i file xlsx sorgente
```
