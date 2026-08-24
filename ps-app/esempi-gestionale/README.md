# esempi-gestionale — pagine del gestionale, senza nessun dato reale

Queste sono le pagine **vere** di SA4PSO (struttura, classi, stile, icone) con
**tutto il contenuto sostituito da dati inventati**. Servono al banco di prova
(`dist/demo.html`) per far girare il pannello sulle schermate autentiche senza
avere accesso al gestionale — e senza che nulla di reale esca da qui.

| file | cos'è |
|---|---|
| `paziente-1.html` | scheda paziente completa: anamnesi, diario, parametri, richieste, referti |
| `paziente-2.html` | scheda paziente con **risultati di laboratorio in corso** (icona colorata) |
| `crea-laboratorio.html`, `crea-laboratorio-2.html` | nuova richiesta di laboratorio |
| `crea-radiologia.html` | nuova richiesta di radiologia |
| `esami-poc.html`, `esami-urgenze.html`, `esami-centrale.html` | carrello + catalogo dei tre laboratori |
| `esami-rx.html` | carrello + catalogo radiologia |
| `risultati-1.html`, `risultati-2.html` | la finestra «Visualizza Risultati» di due prelievi |
| `_stile.css`, `_icone.json` | il foglio di stile e le icone dell'applicazione |
| `_pagine.json` | indice leggibile dal programma |

## Cosa è stato tolto, e come

Gli originali erano cartelle cliniche complete: nome, data di nascita, codice
fiscale, anamnesi, allergie, terapia, parametri vitali, nomi di medici e
infermieri, numeri di episodio, indirizzi interni. **Gli originali non sono in
questo repository e non lo saranno mai.**

Li trasforma `tools/esempi.mjs`, con una regola sola: **si sostituisce tutto per
default**. Un testo resta solo se è vocabolario dell'applicazione, e questo non
è deciso a occhio ma calcolato — una stringa è vocabolario se compare nelle
pagine di **almeno due pazienti diversi**. Sopra a questo:

- una **lista nera** toglie ciò che è condiviso ma identifica lo stesso (nomi e
  utenze del personale, ospedale e fornitore, codici fiscali);
- qualunque stringa a **forma di nome** («COGNOME NOME» in maiuscolo) viene
  sostituita anche se sembrava vocabolario: la stessa infermiera firma le pagine
  di due pazienti, e senza questa regola il suo nome sarebbe rimasto;
- i campi che contengono una persona per definizione (`NOMINATIVO`, `MEDICO`,
  `UTENTE`…) sono sostituiti qualunque cosa contengano;
- anche i **parametri degli indirizzi** seguono la stessa regola: restano solo
  quelli che servono al funzionamento (`MVPG`, `EPISODIO_ID`, `PRESTAZIONE`…),
  gli altri vengono azzerati — un codice fiscale viaggiava lì dentro;
- numeri, date e identificativi diventano valori **della stessa forma** ma
  inventati, coerenti tra le pagine, così i collegamenti continuano a funzionare;
- restano invece i nomi degli **esami**, le intestazioni di colonna e le
  etichette dell'interfaccia: sono vocabolario clinico, non fatti su una persona.

Sono rimossi anche gli script del gestionale, i loghi dell'ospedale e del
fornitore, e **ogni indirizzo esterno**: le pagine non possono chiamare nulla.

`tools/verifica-esempi.mjs` è il cancello: fallisce se ricompare un cognome, una
utenza, un codice fiscale, un identificativo vero, un indirizzo interno, un
`http://` o un `<script>`. Va eseguito a ogni modifica (`npm run esempi`).

> Le pagine si guardano dal banco di prova, non da sole: fuori di lì mancano il
> foglio di stile e le icone, che stanno nei due file `_`.
