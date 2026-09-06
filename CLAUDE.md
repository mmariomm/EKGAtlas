# Come si lavora in questo repository

## Orchestratore + esecutori (regola di default)

Il pattern standard qui è **orchestratore-esecutore**, per tenere basso il costo senza
perdere la qualità del modello di punta:

1. **Lead / orchestratore — Fable 5.** Pianifica, spezza il lavoro, valuta il contesto,
   verifica il risultato finale. La pianificazione produce pochi token (2–5 k), quindi il
   modello di punta lì costa poco.
2. **Esecuzione — sub-agent Sonnet 5** (effort high o medium), oppure **Opus 5** quando il
   sotto-compito riesce davvero meglio con Opus. Il sub-agent riceve un compito **delimitato
   e strutturato** (boilerplate, edit localizzati, esecuzione dei test) e genera il grosso
   dei token (20 k+) alla tariffa più bassa.
3. **Verifica — di nuovo il lead.** Il controllo torna all'orchestratore, che rilegge il
   lavoro, cerca i casi limite e integra il risultato.

Si delega con lo strumento `Agent`, passando `model: "sonnet"` (o `"opus"`) al sub-agent.
Più sotto-compiti indipendenti si lanciano **nello stesso messaggio**, così girano in
parallelo.

**Quando NON delegare.** Se il compito è breve e passare la consegna costerebbe quanto
farlo — leggere un file, una `sed`, far girare la suite, una domanda a cui so già
rispondere — si fa e basta. Il briefing di un sub-agent è a sua volta token: delegare una
cosa da 2 minuti la fa costare di più, non di meno. Usare la testa.

Nota pratica: il modello **della sessione** si cambia con `/model` (o scegliendolo quando
la si apre) — non posso cambiarlo da solo a metà lavoro. Quello che posso fare, e che
faccio, è **delegare a Sonnet i sotto-compiti** e tenermi pianificazione e verifica.

## Il progetto

Il lavoro vero sta in `ps-app/` (PS Assist, estensione Chrome MV3 + bookmarklet per il
Pronto Soccorso). Sorgente unico `ps-app/src/core.js` → `extension/content.js` e
bookmarklet via `npm run build`. `npm test` fa girare tutta la suite; `npm run dist`
rifà lo zip. Le regole di sicurezza sono in `ps-app/README.md` — si leggono prima di
toccare il motore delle richieste.

## I Miei Turni

`I Miei Turni/` è una pagina statica a sé (nessuna dipendenza, niente Vite): i turni
mensili del PS di DEA e OSG letti dagli xlsx in `data/`. `npm run build` lì dentro rigenera
`index.html` con i dati inlinati; `npm test` verifica parser e regole. Il contratto dati e
le regole delle segnalazioni sono descritti nel suo README. Non va agganciata al deploy di
EKG Atlas: contiene nomi reali di colleghi.
