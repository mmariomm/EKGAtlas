# PS Assist — richieste Pronto Soccorso in un click (SA4PSO)

Ricostruito **da zero** (agosto 2026) dopo un re-audit completo delle pagine reali salvate di SA4PSO.
Sostituisce il vecchio userscript v0.6 ("un esame per ricaricamento di pagina") con un motore molto più
semplice e robusto: guida il server con le **stesse identiche richieste dei click manuali**, tutto da una
sola pagina, verificando ogni passaggio prima del successivo.

> **In sintesi per il medico**: dalla pagina del paziente scrivi il quesito, tocchi i profili
> e gli esami, premi un bottone. La richiesta viene creata, gli esami aggiunti e
> verificati uno a uno nel carrello, e atterri sulla pagina esami reale per premere **Conferma**
> (o lasci che la prema lui dopo un conto alla rovescia annullabile). Dopo la conferma parte da
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
     conto alla rovescia e wizard di stampa ripartono al click, perché i passaggi di consegna
     vivono nella scheda.
- Se sul PC c'è già **Tampermonkey/Violentmonkey** funzionante: importa
  `ps-app/userscript/ps-assist.user.js` (stesso identico motore).
- A regime, la strada pulita è chiedere all'IT di consentire l'estensione (cartella locale o
  allowlist aziendale).

---

## Uso quotidiano

**Dalla pagina del paziente** (flusso principale):
1. Scrivi il **quesito diagnostico** — casella su una riga, con i suggerimenti a fianco;
   l'ultimo che hai usato resta scritto anche cambiando pagina o paziente.
2. Tocca i **profili rapidi** (Base PS, Epatico, **Coag POC**, **Coag**) oppure gli **esami
   singoli**, in una **griglia compatta a due colonne raggruppata per laboratorio** (POC /
   Urgenze / RX) con nomi brevi da reparto. Per tutto il resto c'è la casella **«altri esami…»**:
   scrivi due lettere e scegli dal menu a tendina (cerca in tutti i laboratori, con l'etichetta
   di quale). Gli esami scelti restano in vista nella **barra in alto**, **una riga per
   laboratorio**; passandoci sopra compare la ✕ per toglierli. Lo scroll resta dov'è.
3. Premi (i due bottoni stanno su una riga):
   - **Crea e aggiungi N esami** → fa tutto e ti lascia sulla pagina esami con la ricevuta verde
     e il bottone **«✓ CONFERMA ora → stampa etichette»**: un click e conferma + stampa guidata;
   - **+ Conferma 🖨** → come sopra ma senza click aggiuntivo: conto alla rovescia di 5 s
     (annullabile con Esc) e poi conferma e stampa da soli.

**Laboratorio e radiologia insieme**: il gestionale vuole due richieste separate, ma tu puoi
selezionarli insieme — il bottone diventa **«Crea 2 richieste»** e il pannello le costruisce una
dopo l'altra (stesso quesito), poi ti porta a confermarle entrambe: con la conferma automatica
fa tutto da solo, altrimenti dopo la prima ti avvisa con **«→ Apri e conferma la richiesta di
radiologia»**. Alla fine parte **una sola** stampa con tutto (etichette → liste → prenotazione RX).
Se lasci una richiesta non confermata, il promemoria resta in vista per mezz'ora.

**Radiologia**: l'elenco **RX** è incluso (40 esami) e tra i singoli trovi **RX Torace**,
**RX Torace 1 proiez.** e **RX Addome**; gli elenchi Eco/RMN/TAC il pannello li **impara da solo**
la prima volta che apri quella richiesta.

**Sulla pagina esami** il pannello mostra ciò che è già nel carrello e permette di aggiungere altri
esami (anche cambiando risorsa automaticamente). **STOP** (o tasto `Esc`) interrompe subito.

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

## Referti — salvataggio e riapertura istantanea

Il pannello elenca i **referti** (LIS / RIS / AMB) **ordinati per data e ora**, i più recenti in
alto, con lo stato di ciascuno:

- **● salvato** — il PDF è sul questo computer: il click lo apre **all'istante**, senza toccare
  il server. Premi **⬇ Salva tutti** per scaricarli.
- **◍ aperto** — ha già la sua scheda: il click ci ritorna, già caricata.
- **○ da aprire** — click = si apre come con l'icona nativa.
- **↻ Resetta** svuota i salvataggi e chiude le schede.

Come funziona il salvataggio (solo **estensione**: userscript e bookmarklet non possono farlo): il
visualizzatore dei referti **non è su SA4PSO**, gira su un altro host interno e mostra il PDF come
`blob:` di quell'origine, quindi una pagina di SA4PSO non può leggerlo. È il **service worker**
dell'estensione a seguire la catena (redirect → pagina del visualizzatore → suo endpoint PDF) e a
salvare i byte nella memoria dell'estensione, su questa macchina. Se un referto non è salvabile
resta ○ e il **motivo** compare passandoci sopra col mouse (e nel Registro).

> **Da configurare una volta**: l'host del visualizzatore è dichiarato in
> `extension/manifest.json` → `host_permissions` (oggi `http://10.11.0.151:9080/*`). Se nella tua
> sede è un altro indirizzo, cambialo lì e ricarica l'estensione.

---

**Perché c'è ancora la finestra di stampa?** Un sito web su Windows non può scegliere la
stampante né stampare in silenzio: `chrome.printing` esiste solo su ChromeOS e `--kiosk-printing`
stampa tutto sulla predefinita (inutile con due stampanti). Il wizard è il massimo consentito:
dialogo già aperto e sequenza automatica — Chrome ricorda le stampanti recenti, quindi la scelta
è un click (la prima volta seleziona l'etichettatrice per le etichette, poi resta tra le
recenti). Se un giorno l'IT abilitasse il kiosk-printing su una postazione monostampante, il
wizard funzionerebbe senza dialoghi.

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
11. **Stampe solo dai link della pagina**: gli URL dei PDF non vengono mai costruiti a mano
    (`BRANCA` varia per richiesta) e passano gli stessi controlli di origine di tutto il resto.
12. **Referti aperti solo su click**, nativamente in una nuova scheda; nessun download
    automatico e nessuna copia tenuta dall'estensione.

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
4. **Conferma manuale nativa.** Premi tu Conferma: si apre il wizard di stampa — verifica che il
   PDF etichette sia della **richiesta giusta** e che le etichette riportino il **paziente
   giusto**, scegli l'etichettatrice, poi "Stampata — avanti" e stampa la lista sulla stampante
   normale. (Il wizard si può sempre chiudere con Esc e rifare dalla sezione "Stampa".)
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
inclusi i primi 160 caratteri di qualsiasi pagina inattesa del server e **da quale strada è stato
ottenuto ogni PDF**. Resta scritto anche cambiando pagina (per scheda, 2 ore) e il bottone
**⧉ Copia** lo mette negli appunti pronto da incollare — **il quesito diagnostico viene omesso**,
così non escono testi clinici.

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
├── bookmarklet/         ← piano B per PC bloccati: un preferito, zero installazione (generato)
└── test/                ← simulatore SA4PSO + 37 scenari e2e in Chromium reale
```

Sviluppo:

```bash
cd ps-app
npm install        # solo playwright, solo per i test
npm run build      # rigenera extension/content.js + userscript dopo modifiche a src/
npm test           # 37 scenari e2e (160 verifiche) + 5 verifiche sull'estensione reale
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
