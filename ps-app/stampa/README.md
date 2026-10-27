# Stampa automatica (Windows, senza amministratore)

Con questa cartella installata, PS Assist stampa **da solo e senza dialogo**: le etichette
all'**etichettatrice**, le liste esami, le prenotazioni RX e i consensi all'**A4**. Lo fa anche
per un ordine in sottofondo, col medico su un altro paziente o lontano dal PC.

**In Windows non resta acceso niente.** Non c'è un programma che gira, né un'icona vicino
all'orologio: Chrome avvia l'aiutante solo per il secondo in cui stampa un foglio, e l'aiutante
esce appena ha finito. Non c'è niente da chiudere. Per spegnere la stampa automatica c'è
l'interruttore: menu **⋯ → Stampa automatica: attiva · Spegni** nel pannello, o la pagina
**Stampanti**. Spenta, i fogli tornano a passare dal dialogo di stampa, come prima.

## 0. Prima di tutto: avvisa l'IT

A ogni foglio, Chrome avvia `cmd.exe`, che avvia PowerShell con `-ExecutionPolicy Bypass`, che
avvia `SumatraPDF.exe` da una cartella dell'utente. A un antivirus aziendale (EDR) questa catena
somiglia a un programma malevolo: può bloccarla, o aprire un allarme a ogni stampa. Prima di
installare, manda all'IT le due sezioni qui sotto, **«Che cosa vede l'IT»** e **«Cosa chiedere
all'IT»**: si inoltrano così come sono. Se qualcosa viene bloccato, PS Assist continua a
funzionare col dialogo di stampa.

## Installare (una volta)

1. **Estrai** lo zip di PS Assist: tasto destro, «Estrai tutto…». Da dentro lo zip
   `installa.cmd` non parte, e lo dice («Estrai prima lo zip»). La cartella estratta può stare
   dove vuoi, anche in Download: quello che serve viene copiato in
   `%LOCALAPPDATA%\PSAssist\stampa` (non in Documenti, che in ospedale spesso sta su un server o
   su OneDrive).
2. Doppio clic su **`installa.cmd`** nella cartella `stampa`. Non chiede l'amministratore.
   - Toglie alla cartella il segno «scaricato da Internet» (`Unblock-File`), che bloccherebbe
     gli script.
   - Copia `host.cmd`, `host.ps1` e `installa.ps1` in `%LOCALAPPDATA%\PSAssist\stampa`.
   - **SumatraPDF**: se lì c'è già quello giusto, resta. Se no lo prende da
     `SumatraPDF-3.6.1-64.zip`, se lo trova in questa cartella o in Download (scaricato col
     browser: utile se il proxy blocca PowerShell). Solo se non lo trova lo scarica dal sito
     ufficiale. In ogni caso controlla l'impronta SHA-256, e un file diverso non lo usa.
   - Guarda i **blocchi noti** (PowerShell in modalità limitata, criteri sugli script, criteri di
     Chrome e di Edge sugli aiutanti, il prompt dei comandi vietato, SumatraPDF che non parte).
     Per ognuno scrive una riga in italiano e che cosa chiedere all'IT.
   - Scrive il «manifest» dell'aiutante e le due chiavi nel registro dell'utente (HKCU) che lo
     indicano a Chrome e a Edge.

   Finisce con **«Fatto»** o con **«Non riuscito:»** e il motivo. Rilanciato (per esempio da
   uno zip più nuovo), aggiorna la copia.
3. Nel pannello: menu **⋯ → Stampanti**. Premi **Ricontrolla**, scegli l'**Etichettatrice**
   (l'**A4** è già la stampante predefinita di Windows: cambiala se serve) e premi
   **Stampa una pagina di prova** per tutt'e due. La prova delle etichette ha la misura di
   un'etichetta: 50×25 mm, e dopo la prima stampa vera la misura dell'etichetta vera.
4. **Prima di usarla sui pazienti: un'etichetta vera.** Su un paziente con una richiesta già
   confermata, nella sezione **Stampa** del pannello, ristampa le sue etichette. Controlla che
   l'etichetta sia dritta e intera, e **leggi il codice a barre col lettore del laboratorio**.
   Se esce di traverso o tagliata, cambia «Etichette più larghe che alte» (sotto) e riprova.

Da lì in poi la stampantina accanto al menu **⋯** dice che è accesa (passandoci sopra: dove va
cosa). Diventa **rossa** se l'ultimo foglio non è uscito o ha un esito sconosciuto, e lo dice.
Se l'aiutante non c'è più (disinstallato, o vietato da un criterio), accanto c'è scritto
**«non installata»**.

### Le etichette di traverso

SumatraPDF gira di 90° ogni pagina più larga che alta. I driver delle etichettatrici Zebra,
ZDesigner, TSC e Citizen descrivono già l'etichetta così, e girata uscirebbe di traverso e
tagliata. Per questo nella pagina **Stampanti** c'è **«Etichette più larghe che alte»**:

- **non girarle**: è la scelta di partenza per i nomi che contengono Zebra, ZDesigner, TSC o
  Citizen. SumatraPDF stampa con `noscale,disable-auto-rotation`;
- **girale di 90°**: la scelta di partenza per le altre (per esempio Dymo). SumatraPDF stampa con
  `noscale`.

Il registro dell'aiutante annota, per ogni foglio, la misura della prima pagina («50x25 mm») e le
opzioni usate: niente del contenuto.

### L'ID dell'estensione è fisso

L'ID di PS Assist è **`jhhlgabilanhhnncahahclcjbefaofij`**, in Chrome e in Edge, su ogni PC e da
qualunque cartella. Viene dalla chiave (`"key"`) in `extension/manifest.json`, e l'aiutante
accetta solo lui. Così non c'è un ID da cercare né da incollare, e spostare la cartella
dell'estensione non rompe niente.

**Una volta sola, l'ID cambia.** Chi usava PS Assist da prima di questa versione (fino alla
3.52) aveva un ID calcolato dalla cartella. Col nuovo ID Chrome lo tratta come un'estensione
nuova, e la **memoria dell'estensione ricomincia da zero**. Va rifatto:

- le **stampanti** (menu ⋯ → Stampanti);
- l'**indirizzo del portale** dei referti, col suo permesso (impostazioni);
- l'**archivio** delle schede cliniche e i **referti salvati**: si ricostruiscono rileggendo i
  pazienti;
- il **Ponte** verso l'iPhone, se lo usi: un QR nuovo.

Non cambia niente di quello che sta nella pagina del gestionale: pazienti conosciuti, stanza,
promemoria, catalogo appreso.

Per caricarla: in `chrome://extensions` (o `edge://extensions`) premi ⟳ su PS Assist. Se l'ID
mostrato non è `jhhlgabilanhhnncahahclcjbefaofij`, o PS Assist non si ricarica, **rimuovila** e
caricala di nuovo con **Carica estensione non pacchettizzata**, scegliendo la cartella
`extension` della versione nuova. Poi rilancia `installa.cmd`.

## Che cosa fa, e che cosa no

- Riceve dall'estensione **un PDF alla volta**, che PS Assist ha già preso dal gestionale come
  sempre, e il nome della stampante scelta per quel tipo di foglio.
- Controlla che sia davvero un PDF e che non sia enorme; che quella stampante esista su questo
  PC (l'elenco dello spooler di Windows, `InstalledPrinters`); che non risulti spenta o offline
  (`WorkOffline`, `PrinterStatus`); e che il suo nome non contenga virgolette e non finisca con
  `\`, che romperebbero la riga di comando.
- Lo scrive in un file temporaneo dal nome casuale e lo manda alla stampante con **SumatraPDF**
  (`-print-to "<stampante>" -silent`: le etichette alla loro misura vera, l'A4 adattato al
  foglio). Poi guarda la coda di Windows per 4 secondi, **cancella il file** e dice com'è
  andata. Tutto entro 35 secondi; l'estensione ne aspetta al massimo 90.
- **L'esito, detto per quello che si sa:**

  | Esito | Che cosa vuol dire | Che cosa fa PS Assist |
  |---|---|---|
  | «Stampato su Zebra ZD421 alle 14:32» | il foglio è uscito dalla coda di Windows, senza errori | il foglio dopo |
  | «Mandato a Zebra ZD421» | dopo 4 secondi è ancora nella coda: Windows l'ha preso, non si sa se è uscito | il foglio dopo, e lo dice |
  | Non riuscito | non è partito niente: aiutante non installato o bloccato, stampante sparita, spenta o offline (anche un foglio fermo in errore o in pausa: si toglie dalla coda), PDF non valido, SumatraPDF che dice di no | **quel** foglio passa dal dialogo di stampa, con una riga che dice perché |
  | «Esito della stampa sconosciuto · Ristampa» | nessuna risposta, tempo scaduto, SumatraPDF fermato a metà: il foglio **può essere uscito** | **mai** un secondo foglio da solo: controlla la stampante, e se non c'è, **Ristampa** |

- Risponde anche a due domande: «ci sei?» (la versione) e «che stampanti ci sono?».
- **Non** fa nient'altro: non usa la rete, non esegue altri programmi, non legge altri file.
  Annota soltanto, in `%LOCALAPPDATA%\PSAssist\stampa.log`, *che cosa* è uscito e *dove*
  («stampa etichette -> Zebra ZD421: stampato (12 KB, 1.4 s, 50x25 mm, noscale,disable-auto-rotation)»)
  — mai il contenuto, mai un nome di paziente; a 256 KB ricomincia, tenendo solo il file
  precedente (`stampa.log.1`).
- A ogni avvio cancella dalla cartella temporanea i fogli `psassist-*.pdf` rimasti da più di 10
  minuti: quelli di una stampa interrotta (PC spento a metà, sessione chiusa).
- Un'etichetta inceppata o la carta finita si vedono solo davanti alla stampante: per questo
  **Ristampa** c'è sempre.

## Togliere

Doppio clic su **`disinstalla.cmd`** (nella cartella estratta dallo zip). Lo fa PowerShell, non
`reg.exe`: toglie le due chiavi del registro dell'utente, la cartella `%LOCALAPPDATA%\PSAssist`
(l'aiutante, SumatraPDF e le sue impostazioni, il registro delle stampe) e i fogli temporanei
`psassist-*.pdf` rimasti. Poi **controlla**: dice «Fatto» solo se non resta niente, se no dice che
cosa resta. Dopo puoi cancellare la cartella dello zip. PS Assist torna al dialogo di stampa.

## Che cosa vede l'IT

- **A ogni foglio** (e a «ci sei?», «che stampanti ci sono?») questa catena di processi, che
  finisce in pochi secondi:
  ```
  chrome.exe (o msedge.exe)
  └─ cmd.exe /d /s /c ""%LOCALAPPDATA%\PSAssist\stampa\host.cmd" chrome-extension://jhhlgabilanhhnncahahclcjbefaofij/ --parent-window=<n>" < \\.\pipe\chrome.nativeMessaging.in.<n> > \\.\pipe\chrome.nativeMessaging.out.<n>
     └─ C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -InputFormat None -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\PSAssist\stampa\host.ps1"
        └─ %LOCALAPPDATA%\PSAssist\stampa\SumatraPDF.exe -print-to "<stampante>" -print-settings "noscale,disable-auto-rotation" -silent "%TEMP%\psassist-<guid>.pdf"
  ```
  (`-print-settings` è `noscale` per le etichette che si possono girare, `fit` per l'A4.) Il PDF
  passa per stdin, il file temporaneo vive il tempo della stampa. `-ExecutionPolicy Bypass` vale
  solo per quel processo, e non scavalca un criterio di gruppo.
- **All'installazione**, da `installa.cmd`: `powershell.exe -NoLogo -NoProfile -Command
  "Get-ChildItem -LiteralPath '<cartella>' | Unblock-File"`, poi `powershell.exe -NoLogo
  -NoProfile -ExecutionPolicy Bypass -File installa.ps1`, che copia i file, se serve scarica lo
  zip di SumatraPDF (`Invoke-WebRequest` da `www.sumatrapdfreader.org`, che rimanda a
  `files.sumatrapdfreader.org`) e lo estrae (`Expand-Archive`), e fa partire una volta
  SumatraPDF su un file che non c'è (`-print-to "PS Assist prova" -silent
  "%TEMP%\psassist-nessuno.pdf"`: esce subito, non stampa niente).
- **I file**, tutti in `%LOCALAPPDATA%\PSAssist\stampa`: `host.cmd`, `host.ps1` (lo script,
  leggibile in pochi minuti), `installa.ps1`, `it.psassist.stampa.json` e **`SumatraPDF.exe`**
  portable 3.6.1, 64 bit:
  - `SumatraPDF.exe`: SHA-256 `719F689B34F47BE8CA105CE8484948474DAFDE0E106BAB599E4A89326070C3D0`,
    firmato Authenticode «Krzysztof Kowalczyk» (certificato Certum);
  - lo zip da cui viene, `SumatraPDF-3.6.1-64.zip`: SHA-256
    `98B33A518D42986856D225064B0CD2D3643ECF78CBF84AB873D26CC51877A544`.

  Accanto, `%LOCALAPPDATA%\PSAssist\stampa.log` (cosa e dove, mai il contenuto).
- **Due chiavi nel registro dell'utente**, una per browser:
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\it.psassist.stampa` e
  `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\it.psassist.stampa`. Il valore predefinito
  è il percorso di `it.psassist.stampa.json`, che dice il programma (`host.cmd`) e l'unica
  estensione che può chiamarlo: `chrome-extension://jhhlgabilanhhnncahahclcjbefaofij/`.
- Niente servizi, niente attività pianificate, niente in esecuzione fra una stampa e l'altra,
  niente rete dall'aiutante.

## Cosa chiedere all'IT (inoltrabile così com'è)

1. **Programma.** Consentire (AppLocker/WDAC) `SumatraPDF.exe` 3.6.1: firmato «Krzysztof
   Kowalczyk» (Certum), SHA-256 `719F689B34F47BE8CA105CE8484948474DAFDE0E106BAB599E4A89326070C3D0`,
   nella cartella `%LOCALAPPDATA%\PSAssist\stampa`. In alternativa, installarlo voi in
   `C:\Program Files` (allora `host.ps1` va ritoccato per trovarlo lì).
2. **Script PowerShell.** Consentire `host.ps1` e `installa.ps1` di quella cartella in modalità
   FullLanguage (regola per hash o per percorso, oppure firmarli con il certificato aziendale),
   anche se un criterio di gruppo impone `AllSigned` o `RemoteSigned`.
3. **Chrome/Edge.** Se `NativeMessagingUserLevelHosts` è disattivato o `NativeMessagingBlocklist`
   contiene `*`: aggiungere `it.psassist.stampa` a `NativeMessagingAllowlist`. Se necessario,
   registrarlo in HKLM, cioè `HKLM\SOFTWARE\Google\Chrome\NativeMessagingHosts\it.psassist.stampa`
   (e la chiave equivalente sotto `Microsoft\Edge`), con il percorso del file
   `it.psassist.stampa.json`.
4. **Prompt dei comandi.** Chrome avvia l'aiutante sempre con `cmd.exe`. Il criterio «Impedisci
   accesso al prompt dei comandi» non deve bloccare anche gli script batch: `DisableCMD` = 2,
   oppure nessun criterio.
5. **Antivirus/EDR.** A ogni stampa è normale questa catena: `chrome.exe → cmd.exe /d /s /c
   …\PSAssist\stampa\host.cmd → C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
   -NoLogo -NoProfile -NonInteractive -InputFormat None -ExecutionPolicy Bypass -File
   …\PSAssist\stampa\host.ps1 → SumatraPDF.exe -print-to "<stampante>" -print-settings
   "<opzioni>" -silent %TEMP%\psassist-<guid>.pdf`. Chiedo di metterla in esclusione, così da
   non generare allarmi né blocchi.
6. **Download.** Se il proxy lo blocca, fornirmi `SumatraPDF-3.6.1-64.zip` (SHA-256
   `98B33A518D42986856D225064B0CD2D3643ECF78CBF84AB873D26CC51877A544`), che arriva da
   `www.sumatrapdfreader.org` e poi da `files.sumatrapdfreader.org`.
7. **Ponte (rete), solo se si usa l'iPhone.** Consentire dal browser una WebSocket in uscita verso
   `wss://<sito>/ponte/ws` (TCP 443), con l'upgrade WebSocket attraverso il proxy. È una
   connessione lunga (fino a 14 ore) con un battito ogni 20 secondi. Va lasciata senza un limite
   di durata inferiore a un'ora e, se possibile, esclusa dall'ispezione TLS: il contenuto è
   comunque cifrato da un capo all'altro.

## Se non funziona: i blocchi noti

`installa.cmd` li cerca da solo e li dice, uno per riga, col numero da chiedere all'IT qui sopra.

- **PowerShell in modalità limitata** (AppLocker/WDAC con regole sugli script), o un criterio che
  impone `AllSigned`: l'aiutante non partirebbe, o non potrebbe rispondere. → punto 2.
- **Chrome o Edge che non accettano aiutanti dell'utente** (`NativeMessagingUserLevelHosts`
  disattivato, o `NativeMessagingBlocklist` con `*`): la pagina Stampanti dice «non installata»
  (o «Chrome non permette di usare l'aiutante di stampa») anche dopo «Fatto», e la stampantina
  lo ripete. Si vede in `chrome://policy`. → punto 3.
- **Il prompt dei comandi vietato anche agli script** (`DisableCMD` = 1). → punto 4.
- **SumatraPDF che non parte** dalla cartella dell'utente. → punto 1.
- **Il download bloccato** dal proxy: `installa.cmd` lo dice, coi due indirizzi e l'impronta.
  Scarica lo zip col browser, lascialo in Download e rilancia `installa.cmd`. → punto 6.
- **L'antivirus che ferma l'aiutante a metà**: la stampa dice «l'aiutante di stampa si è chiuso
  senza rispondere» con **esito sconosciuto** (il foglio può essere uscito), o «non è partito
  (Windows l'ha bloccato)». → punto 5.

In tutti questi casi PS Assist continua a funzionare come prima, col dialogo di stampa.
