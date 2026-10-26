# Stampa automatica (Windows, senza amministratore)

Con questa cartella installata, PS Assist stampa **da solo e senza dialogo**: le etichette
all'**etichettatrice**, le liste esami, le prenotazioni RX e i consensi all'**A4**. Anche
quando l'ordine parte dal telefono e davanti al PC non c'è nessuno.

**In Windows non resta acceso niente.** Non c'è un programma che gira, né un'icona vicino
all'orologio: Chrome avvia l'aiutante solo per il secondo in cui stampa un foglio, e l'aiutante
esce appena ha finito. Non c'è niente da chiudere. Per spegnere la stampa automatica c'è
l'interruttore: menu **⋯ → Stampa automatica: attiva · Spegni** nel pannello, o la pagina
**Stampanti**. Spenta, i fogli tornano a passare dal dialogo di stampa, come prima.

## Installare (una volta, 3 passi)

1. Dallo zip di PS Assist copia questa cartella, `stampa`, in una **tua** cartella — per
   esempio `Documenti\PS Assist stampa`. (Non in Download, che si svuota; non su un disco di rete.)
2. Doppio clic su **`installa.cmd`**. Non chiede l'amministratore. Scarica SumatraPDF dal sito
   ufficiale (se non c'è già), ne controlla l'impronta, trova PS Assist in Chrome e in Edge e
   dice loro dov'è l'aiutante. Finisce con **«Fatto»** o col motivo per cui non è riuscito.
   Se non trova l'estensione chiede il suo **ID**: è in fondo alla pagina **Stampanti**, con «Copia».
3. Nel pannello: menu **⋯ → Stampanti**. Premi **Ricontrolla**, scegli l'**Etichettatrice**
   (l'**A4** è già la stampante predefinita di Windows: cambiala se serve) e premi
   **Stampa una pagina di prova** per tutt'e due.

Da lì in poi la stampantina accanto al menu **⋯** dice che è accesa (passandoci sopra: dove va
cosa); diventa **rossa** se l'ultimo foglio non è uscito, e lo dice.

> Se la cartella la sposti, rilancia `installa.cmd` dal posto nuovo. Se carichi PS Assist da
> un'altra cartella (o in un altro profilo di Chrome), anche: l'ID cambia.

## Che cosa fa, e che cosa no

- Riceve dall'estensione **un PDF alla volta**, che PS Assist ha già preso dal gestionale come
  sempre, e il nome della stampante scelta per quel tipo di foglio.
- Controlla che sia davvero un PDF, che non sia enorme e che quella stampante esista su questo
  PC; lo scrive in un file temporaneo dal nome casuale, lo manda alla stampante con
  **SumatraPDF** (`-print-to "<stampante>" -silent`; le etichette alla loro misura vera, l'A4
  adattato al foglio), aspetta al massimo un minuto, **cancella il file** e dice com'è andata.
- Risponde anche a due domande: «ci sei?» (la versione) e «che stampanti ci sono?».
- **Non** fa nient'altro: non usa la rete, non esegue altri programmi, non legge altri file.
  Annota soltanto, in `%LOCALAPPDATA%\PSAssist\stampa.log`, *che cosa* è uscito e *dove*
  («stampa etichette -> Zebra: ok (12 KB, 1.4 s)») — mai il contenuto, mai un nome di paziente;
  a 256 KB ricomincia, tenendo solo il file precedente (`stampa.log.1`).
- Se qualcosa non va (aiutante non installato, stampante sparita, SumatraPDF che si lamenta,
  tempo scaduto) **quel** foglio passa dal dialogo di stampa di sempre, con una riga che dice
  perché. Gli altri continuano da soli.
- «Stampato» vuol dire che il foglio è arrivato alla coda di stampa di Windows: un inceppamento o
  la carta finita si vedono solo davanti alla stampante. Per questo **Ristampa** c'è sempre.

## Togliere

Doppio clic su **`disinstalla.cmd`**: toglie le due chiavi del registro e il file che indicano
l'aiutante a Chrome e a Edge. Poi puoi cancellare la cartella. PS Assist torna al dialogo di stampa.

## Che cosa vede l'IT

- Una chiave nel registro **dell'utente**, per ciascun browser:
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\it.psassist.stampa` e
  `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\it.psassist.stampa`, che puntano a
  `it.psassist.stampa.json` in questa cartella (il «manifest» dell'aiutante: il percorso di
  `host.cmd` e l'unica estensione che può chiamarlo).
- Una cartella nel profilo dell'utente con `host.cmd`, `host.ps1` (lo script, leggibile),
  `installa.cmd/ps1`, `disinstalla.cmd` e **`SumatraPDF.exe`** portable (3.6.1, 64 bit, scaricato
  da sumatrapdfreader.org, impronta SHA-256 controllata). Niente servizi, niente attività
  pianificate, niente in esecuzione fra una stampa e l'altra.

## Se non funziona: i blocchi noti, e cosa chiedere all'IT

- **PowerShell bloccato da una regola** (Criteri di gruppo che impongono `AllSigned`, o che
  vietano gli script): `installa.cmd` si ferma subito con un errore di PowerShell, oppure la
  stampa automatica dice «l'aiutante di stampa si è chiuso senza rispondere».
  *Da chiedere all'IT:* di permettere gli script di questa cartella (o di firmarli:
  `host.ps1` e `installa.ps1` sono corti e si leggono in un minuto).
- **AppLocker / WDAC che bloccano i programmi nelle cartelle dell'utente**: `SumatraPDF.exe` non
  parte, e la stampa automatica dice «SumatraPDF …» o «non ha finito in 60 secondi». Con le
  regole sugli script attive, PowerShell gira anche in modalità limitata e l'aiutante non
  risponde. *Da chiedere all'IT:* di consentire questa cartella, oppure di mettere
  `SumatraPDF.exe` in `C:\Program Files` e la cartella `stampa` accanto (allora `host.ps1` va
  ritoccato per trovarlo lì).
- **Download bloccato** dal proxy: `installa.cmd` lo dice e spiega dove prendere SumatraPDF a mano
  (portable 64 bit, zip) e dove metterlo, col nome `SumatraPDF.exe`.
- **Chrome gestito che vieta gli aiutanti** (criteri `NativeMessagingBlocklist` con `*`, o
  `NativeMessagingUserLevelHosts` disattivato, in `chrome://policy`): la pagina Stampanti dice
  «non installata» o «Chrome non permette…» anche dopo `installa.cmd`. *Da chiedere all'IT:* di
  mettere `it.psassist.stampa` in `NativeMessagingAllowlist` (e, se serve, di permettere gli
  aiutanti installati dall'utente).

In tutti questi casi PS Assist continua a funzionare come prima, col dialogo di stampa.
