# I Miei Turni

Una pagina sola, senza dipendenze, che mostra i turni mensili del Pronto Soccorso di due
ospedali — **DEA** e **OSG** — letti dai file xlsx ufficiali. Serve a tre cose:

1. **Trovare un nome in un attimo.** La ricerca evidenzia il nome nella griglia a ogni
   lettera e mostra sotto i nomi possibili: se nel foglio c'è un refuso (per esempio
   `ORLANDITOSKIC` senza la barra), lo si vede subito come nome a sé, con il suggerimento.
2. **Vedere i problemi.** Le segnalazioni sono calcolate su tutti i turni caricati, anche
   a cavallo di due mesi:
   - **Conflitto** — stesso orario in due ospedali, oppure doppio incarico nello stesso
     ospedale con più di 1 h di sovrapposizione (ambulatorio → pomeriggio nello stesso PS
     è un passaggio di consegne, non un conflitto).
   - **Notte attaccata** — turno diurno subito prima o subito dopo una notte, con meno di
     11 h di riposo (pomeriggio → notte, notte → mattina, mattina → notte, ecc.).
   - **Cambio sede** — due turni diurni consecutivi in ospedali diversi senza pausa.
3. **Aggiornare senza fatica.** Vedi sotto.

## Aprire

Doppio clic su `index.html`. Funziona da file locale, offline, su telefono e computer.
I dati del mese corrente sono già dentro la pagina.

## Aggiornare i turni

Due strade, a scelta:

- **Dal browser (subito, solo su quel dispositivo).** Trascina i nuovi file xlsx sulla
  pagina, oppure usa «Carica xlsx». I file vengono letti nel browser e ricordati lì
  (localStorage). Un file dello stesso ospedale e mese sostituisce quello pubblicato;
  «Ripristina i dati pubblicati» nella sezione *Dati* torna indietro.
- **Pubblicando (per tutti i dispositivi).** Copia i nuovi xlsx in `data/` e lancia:

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
src/rules.js      assegnazioni, segnalazioni, analisi nomi, ricerca
src/app.js        interfaccia
test/             test di parser e regole (node:assert), con i roster attesi in test/fixtures
data/             i file xlsx sorgente
```
