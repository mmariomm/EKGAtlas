# PS Assist — richieste Pronto Soccorso in un click (SA4PSO)

Ricostruito **da zero** (agosto 2026) dopo un re-audit completo delle pagine reali salvate di SA4PSO.
Sostituisce il vecchio userscript v0.6 ("un esame per ricaricamento di pagina") con un motore molto più
semplice e robusto: guida il server con le **stesse identiche richieste dei click manuali**, tutto da una
sola pagina, verificando ogni passaggio prima del successivo.

> **In sintesi per il medico**: dalla pagina del paziente scrivi il quesito, tocchi i profili
> (o i PANNELLI POC nativi), premi un bottone. La richiesta viene creata, gli esami aggiunti e
> verificati uno a uno nel carrello, e atterri sulla pagina esami reale per premere **Conferma**
> (o lasci che la prema lui dopo un conto alla rovescia annullabile — la stampa etichette parte
> normalmente perché la conferma è sempre un click vero sulla pagina).

---

## Installazione (Chrome / Edge, PC ospedale)

Il modo più semplice nel 2026 è l'**estensione dedicata** (niente Tampermonkey: da Chrome 138+ i
gestori di userscript richiedono anche il toggle "Consenti script utente" per estensione — un
passaggio in più che qui non serve).

1. Scarica questa cartella sul PC (da GitHub: **Code → Download ZIP**, poi estrai; ti serve solo `ps-app/extension`).
2. Apri `chrome://extensions` (o `edge://extensions`).
3. Attiva **Modalità sviluppatore** (interruttore in alto a destra).
4. Premi **Carica estensione non pacchettizzata** e seleziona la cartella `ps-app/extension`.
5. Apri SA4PSO: il pannello blu **PS Assist** appare in alto a destra sulle pagine di paziente,
   Nuova Richiesta ed esami.

*Alternativa*: se sul PC c'è già Tampermonkey/Violentmonkey funzionante, importa
`ps-app/userscript/ps-assist.user.js` (stesso identico motore).

**Aggiornamenti**: sostituisci la cartella e premi ⟳ sull'estensione in `chrome://extensions`.

---

## Uso quotidiano

**Dalla pagina del paziente** (flusso principale):
1. Scrivi il **quesito diagnostico** (o tocca un suggerimento; gli ultimi usati restano in cima).
2. Tocca i **profili rapidi** (Base PS, Epatico, Coagulazione), i **PANNELLI POC** nativi
   dell'ospedale, gli **esami singoli**, o cerca in **Tutti gli esami**.
3. Premi:
   - **Crea richiesta e aggiungi N esami** → fa tutto e ti lascia sulla pagina esami per rivedere
     e premere Conferma tu; **oppure**
   - **…e CONFERMA al termine** → come sopra, ma dopo l'atterraggio parte un conto alla rovescia
     di 5 s (annullabile) e la Conferma viene premuta per te → si apre la stampa etichette.

**Laboratorio e radiologia** vanno in due richieste separate (come nel gestionale): il pannello te
lo ricorda se li mescoli.

**Radiologia**: gli elenchi RX/Eco/RMN/TAC non erano nelle pagine salvate, quindi il pannello li
**impara da solo** la prima volta che apri una richiesta di radiologia; da quel momento anche la
radiologia è one-click dalla pagina paziente (es. RX torace).

**Sulla pagina esami** il pannello mostra ciò che è già nel carrello e permette di aggiungere altri
esami (anche cambiando risorsa automaticamente). **STOP** (o tasto `Esc`) interrompe subito.

---

## Perché è robusto (regole di sicurezza nel codice)

1. **Mai doppi ordini**: l'URL di inserimento di un esame viene richiesto **al massimo una volta**.
   La verifica rilegge l'elenco "pulito" (senza parametri di inserimento); se dopo 3 verifiche
   l'esame non compare, il motore **si ferma** e ti dice esattamente cosa controllare.
2. **Mai il paziente sbagliato**: l'EPISODIO_ID viene fissato all'avvio e ogni pagina ricevuta è
   verificata **dal contenuto che il server dichiara** (non dall'URL richiesto); se manca o non
   corrisponde, stop prima di qualunque invio.
3. **Mai l'esame sbagliato**: prima di ogni invio il nome dell'esame sulla riga viva della pagina
   deve coincidere con quello selezionato — se l'ospedale rinumera un codice, il motore si ferma
   e lo dice, invece di ordinare un esame diverso con tutte le spie verdi.
4. **La Conferma è sempre un click reale** sulla pagina visibile (il flusso di stampa etichette
   resta quello nativo), è opt-in, con conto alla rovescia che si annulla con Esc, con qualsiasi
   click, se la scheda va in secondo piano o se avvii un'altra operazione.
5. **Il quesito non viene mai sovrascritto**: se il triage l'ha già compilato, resta il suo.
6. **Sessione scaduta riconosciuta**: se compare la pagina di login, stop con messaggio chiaro
   (che dice anche se l'ultimo esame è in stato ambiguo).
7. **Un run non muore in silenzio**: chiudere o cambiare pagina durante un run fa scattare
   l'avviso del browser; i passaggi falliti diventano rossi, quelli mai partiti "non eseguito".
8. **Niente esce dall'ospedale**: ogni richiesta è bloccata a livello di codice se non è diretta
   all'origine SA4PSO; nessuna telemetria; preferenze e catalogo appreso restano nel browser.
9. **Due schede, due pazienti, zero interferenze**: i passaggi di consegna tra pagina e pagina
   (ricevuta e conferma automatica) vivono nella singola scheda (sessionStorage).
10. Codifica **windows-1252 identica byte per byte** a quella del browser (verificato contro
    Chromium reale, accenti e simboli inclusi).

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
4. **Conferma manuale nativa.** Premi tu Conferma e completa la stampa etichette come sempre;
   controlla che le etichette riportino il paziente giusto.
5. **Controllo incrociato in EHR.** Riapri l'episodio: esattamente UNA richiesta nuova, 1 esame,
   quesito/medico/urgenza corretti, nessuna bozza doppia.
6. **Run multiplo con cambio risorsa.** Profilo con POC + Urgenze (es. Base PS + Epatico):
   ripeti i punti 3–5 riga per riga.
7. **Esercitazione di interruzione.** Lancia un run e premi INTERROMPI (o Esc) a metà; leggi il
   messaggio e controlla il carrello col bottone "Apri il carrello e controlla". Regola
   permanente: **dopo qualsiasi banner rosso mai rilanciare** — si apre il carrello, si sistema a
   mano, si controllano le bozze sull'episodio.
8. **Radiologia (solo dopo qualche giorno di laboratorio pulito).** Prima apertura nativa di
   "Richieste Radiologia" (apprendimento del catalogo), poi un solo RX torace dal pannello, con
   verifica in radiologia che la richiesta sia arrivata unica e con il quesito giusto.
9. **Auto-conferma (ultima fase, opzionale).** Primo uso con 1 esame restando davanti allo
   schermo: la prima volta **annulla apposta** (Esc, un click qualsiasi, o il bottone Annulla)
   per verificare che si fermi; la seconda lascia scadere il conto alla rovescia e ricontrolla
   etichette e richiesta. Nota: per la radiologia l'auto-conferma è disattivata in questa
   versione, di proposito.
10. **Regime.** Una scheda per paziente; mai avviare un run e allontanarsi; nella prima settimana,
    a fine turno, scorri le richieste create cercando doppioni o bozze non confermate.

Se un passaggio non torna: il **Registro** (in fondo al pannello) elenca ogni azione con l'orario,
inclusi i primi 160 caratteri di qualsiasi pagina inattesa del server — è quello da fotografare
per il debug.

---

## Struttura del progetto

```
ps-app/
├── src/core.js          ← unica fonte: motore + pannello (zero dipendenze)
├── src/catalog.json     ← catalogo esami verificato dall'audit (POC/Urgenze/Centrale)
├── extension/           ← estensione MV3 pronta da caricare (content.js è generato)
├── userscript/          ← stesso motore in formato Tampermonkey (generato)
├── tools/build.mjs      ← genera extension/content.js e userscript/*.user.js
├── tools/icons.mjs      ← genera le icone PNG (niente binari a mano)
└── test/                ← simulatore SA4PSO + 17 scenari e2e in Chromium reale
```

Sviluppo:

```bash
cd ps-app
npm install        # solo playwright, solo per i test
npm run build      # rigenera extension/content.js + userscript dopo modifiche a src/
npm test           # 17 scenari e2e contro il simulatore (58 verifiche)
```

I test coprono: percorso felice (con e senza redirect PRG, con verifica **byte-per-byte** del
corpo POST contro la codifica nativa di Chromium), conferma automatica, annullo con Esc e flag
consumato al reload, carrello "in ritardo" (verifica con riletture, un solo invio), esame perso
dal server (hard-stop con **un solo** invio e step successivi mai partiti), **codice rinumerato**
(rifiuto prima dell'invio), sessione scaduta prima e **durante** un inserimento (messaggio di
ambiguità), **cambio episodio a metà run** (zero invii sul paziente sbagliato), quesito
pre-compilato non sovrascritto, aggiunte dalla pagina esami con cambio risorsa, rifiuto live di
esami di risorsa sbagliata (CTA disabilitato con motivo), quesito mancante (CTA disabilitato,
si riattiva scrivendo), apprendimento radiologia end-to-end, STOP. Il simulatore fallisce
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
