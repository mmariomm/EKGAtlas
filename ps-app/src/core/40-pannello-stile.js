//@frammento 40-pannello-stile.js — UI (panel): COLORS, il CSS del pannello (tools/build.mjs ne prende le regole della pill per registra-pill.js).
  // ============================================================== UI (panel)
  // Shadow-DOM panel, top right. Collapsible pill with live state; per-page
  // content; running/error states designed to be legible from a metre away;
  // countdown handoff for the native confirm. Design system: one brand blue,
  // green = verified in cart, amber = armed/attention, red = abort/error.

  const COLORS = `
    /* un colore, un significato: fatto = verde, in attesa = ambra, errore o critico = rosso, informazione o in corso = blu, il resto = grigio.
       I colori del triage e quelli del gestionale restano come sono. */
        /* IL SISTEMA DEI COLORI, dichiarato qui una volta sola (gli stessi nomi del telefono). Stati: fatto = ok,
       tocca a te = att, errore = err, nuovo/in corso = info, il resto = neutro; ognuno col suo fondo (-f).
       «Scelto» = pieno --azione col testo bianco. Il triage (#C62828 #EF6C00 #1E88E5 #2E7D32 #B0BEC5) sta solo
       nella sua striscia (--tr). */
    :host { all: initial; --ok: #177245; --ok-f: #EDF7F0; --att: #8A5A00; --att-f: #FFF4DB; --err: #B3261E; --err-f: #FDEBEA;
            --info: #0B5CAD; --info-f: #EAF2FA; --neutro: #5B6B7A; --azione: #0B5CAD; --testo: #16232E; }
    [hidden] { display: none !important; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .wrap { position: fixed; top: 10px; right: 10px; z-index: 2147483647; color: var(--testo); }
    .pill { display: flex; align-items: center; gap: 8px; background: var(--azione); color: #fff; border: 0; border-radius: 999px;
            padding: 9px 15px 9px 11px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(9,42,74,.22);
            touch-action: none; }
    .pill:active { cursor: grabbing; }
    .pill:hover { background: #094a8c; }
    .pill .badge { background: #fff; color: var(--azione); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 800; }
    .pill .dot { width: 8px; height: 8px; border-radius: 50%; background: #7FD1A8; animation: psaPulse 1.2s ease-in-out infinite; }
    .pill.run .dot { animation: none; }   /* durante un ordine si muove solo il pallino della striscia: il resto sta fermo */
    /* La striscia del giro in corso: due righe in un angolo, e sotto ci lavori
       come se il pannello non ci fosse. */
    .strip { display: flex; align-items: center; gap: 6px; }
    .pill.run { border-radius: 12px; padding: 7px 13px 7px 11px; max-width: min(380px, 82vw); text-align: left; }
    .pill.run.alt, .pill.run.warn { background: var(--att); }
    .pill.run.alt:hover, .pill.run.warn:hover { background: #764d00; }
    /* errore: si completa a mano, nel gestionale */
    .pill.run.err { background: var(--err); }
    .pill.run.err:hover { background: var(--err); }
    .pill .col { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; line-height: 1.3; }
    .pill .l1 { display: flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0; }
    /* il nome non cede mai per primo: prima l'etichetta, poi il resto */
    .pill .l1 .who { flex: none; max-width: 100%; }
    .pill .tag { font-weight: 700; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .pill .l2 { font-size: 11.5px; font-weight: 500; opacity: .93; max-width: 100%;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill .tick { font-size: 13px; font-weight: 800; }
    /* cosa c'è di nuovo, sulla pill del paziente: una scritta corta, mai a capo */
    .pill .pnov { font-size: 11.5px; font-weight: 500; opacity: .95; max-width: 210px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill .pnov::before { content: "·"; margin-right: 6px; opacity: .7; }
    /* un ordine finito di un altro paziente: un segno piccolo nella pill, non la striscia */
    .pill .segno { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px; background: #fff; color: var(--ok); font-size: 11px; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .pill .segno.warn { color: var(--att); }
    .pill .segno.err { color: var(--err); }
    .pill .segno:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    /* quale quesito è partito: una riga piccola sotto il resoconto */
    .pill .l3 { font-size: 11px; font-weight: 500; opacity: .8; max-width: 100%;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stopmini { display: inline-grid; place-items: center; padding: 0; border: 0; border-radius: 999px; width: 30px; height: 30px; cursor: pointer; font-size: 12px;
                background: var(--err); color: #fff; box-shadow: 0 6px 20px rgba(9,42,74,.35); }
    .stopmini:hover { background: var(--err); }
    /* Sotto la striscia, una riga per foglio (e per la richiesta che gira):
       il nome corto, una barretta, il ✕ — o la stampantina, se è già dell'aiutante. */
    .pjobs { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; width: 168px; }
    .pjob { display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 6px; row-gap: 2px;
            background: #fff; border: 1px solid #C4D0DC; border-radius: 8px; padding: 3px 4px 4px 8px;
            font-size: 11.5px; font-weight: 700; color: #0B2A4A; box-shadow: 0 4px 14px rgba(9,42,74,.14); }
    .pjob .pjn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 18px; line-height: 18px;
                 display: inline-flex; align-items: center; gap: 4px; }
    .pjob .pjn svg { width: 13px; height: 13px; flex: none; }
    .pjob .pjn .pjchi { font-weight: 800; color: var(--att); }
    .pjob .pjbar { grid-column: 1 / -1; height: 3px; background: #E3EAF1; border-radius: 2px; overflow: hidden; }
    .pjob .pjbar i { display: block; height: 100%; background: var(--azione); transition: width .4s ease; }
    .pjob.ok .pjbar i { background: var(--ok); }
    .pjob.err { border-color: var(--err); color: var(--err); }
    .pjob.err .pjbar i { background: var(--err); }
    .pjx { border: 0; background: transparent; color: #5B6B7B; cursor: pointer; font-size: 11px; width: 18px; height: 18px; border-radius: 50%; padding: 0; }
    .pjaz { display: inline-flex; align-items: center; gap: 2px; }
    .pjx:hover { background: #EEF3F8; color: var(--err); }
    /* in coda dietro le etichette di un ordine: la clessidra, che al passaggio è il ✕ */
    .pjx.att .pjxx, .pjx.att:hover .pjclx { display: none; }
    .pjx.att:hover .pjxx { display: inline; }
    .pjx.att .pjclx { font-size: 11px; }
    .pjico { display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; color: var(--azione); }
    .pjico svg { width: 13px; height: 13px; }
    .pjob.ok { background: var(--ok-f); border-color: #9FD3B3; }
    .pjico.fatto { color: var(--ok); font-size: 13px; font-weight: 800; }
    /* dall'aiutante, finché stampa: la stampantina sta ferma (si muove solo il pallino della striscia) */
    .pjrist { border: 1px solid var(--err); background: #fff; color: var(--err); border-radius: 999px; padding: 0 7px; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; height: 18px; }
    /* un'azione tranquilla accanto al resoconto («Ristampa») */
    .strazione { border: 1px solid #C4D0DC; background: #fff; color: var(--azione); border-radius: 999px; padding: 6px 11px;
                 font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(9,42,74,.18); }
    .strazione:hover { background: #F4F8FB; }
    /* gli avvisi di prima, piegati: «!1» accanto alla striscia dell'ordine che gira */
    .pieg { flex: none; border: 0; border-radius: 999px; min-width: 26px; height: 26px; padding: 0 7px; cursor: pointer; font: inherit;
            font-size: 12px; font-weight: 800; background: var(--att); color: #fff; box-shadow: 0 4px 14px rgba(9,42,74,.22); }
    .pieg.err { background: var(--err); }
    .pieg.ok { background: var(--ok); }
    /* La striscia a pannello aperto: un chip in intestazione, la sua riga corta */
    #girow { display: contents; }
    .gchip { flex: 0 1000 auto; min-width: 64px; overflow: hidden; display: inline-flex; flex-direction: row-reverse; align-items: center; gap: 4px; height: 30px; padding: 0 3px 0 9px;
             border-radius: 999px; background: var(--info-f); color: #0B2A4A; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .gchip.warn { background: #FFF1D6; color: var(--att); }
    .gchip.err { background: var(--err-f); color: var(--err); }
    .gchip.ok { background: var(--ok-f); color: var(--ok); }
    .gchip .gcorpo { flex: 0 1 auto; display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; border: 0; background: transparent; color: inherit; font: inherit; padding: 0; }
    .gchip button.gcorpo { cursor: pointer; }
    .gchip .gt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .gchip .gt b { font-size: inherit; font-weight: 700; letter-spacing: 0; }
    .gchip .gdot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--azione); animation: psaPulse 1.2s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .gchip .gdot { animation: none; } }
    .gchip .gtick { flex: none; font-weight: 800; }
    .gchip .gaz { flex: none; border: 1px solid #C4D0DC; background: #fff; color: var(--azione); border-radius: 999px; padding: 2px 9px; font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; }
    .gchip .pieg { min-width: 22px; height: 22px; padding: 0 6px; font-size: 11px; box-shadow: none; }
    .gchip .gstop { flex: none; border: 0; width: 24px; height: 24px; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; font-size: 11px; padding: 0; }
    .gchip .gstop.ferma { background: var(--err); color: #fff; }
    .gchip .gstop:hover { background: rgba(9,42,74,.1); }
    .gchip .gstop.ferma:hover { background: var(--err); }
    .gchiprighe { position: absolute; top: calc(100% + 2px); right: 12px; z-index: 5; cursor: default; }
    /* La finestra: al centro, l'85% dello schermo. Intestazione, schede e
       selezione restano ferme; scorre solo il corpo. Il contenuto sta su una
       colonna comoda da leggere; valori e stanza usano tutta la larghezza. */
    .wrap.win { display: flex; }
    .card { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%;
            overflow: hidden; background: #fff; border: 1px solid #D9E2EC; border-radius: 14px;
            box-shadow: 0 28px 70px rgba(9,42,74,.24), 0 2px 8px rgba(9,42,74,.08); font-size: 13px; line-height: 1.45; }
    .cap { flex: 0 0 auto; width: 100%; box-sizing: border-box; }
    .bd { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
    .bdi { padding: 14px 24px; box-sizing: border-box; }
    /* il testo da leggere di seguito resta su una riga comoda */
    .eotxt, .reftxt, .dedit, .qrow, .btnrow, .banner { max-width: 820px; }
    .rz { position: absolute; z-index: 6; touch-action: none; }
    .rz-n, .rz-s { left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
    .rz-e, .rz-w { top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
    .rz-n { top: 0; } .rz-s { bottom: 0; } .rz-e { right: 0; } .rz-w { left: 0; }
    .rz-ne, .rz-nw, .rz-se, .rz-sw { width: 14px; height: 14px; }
    .rz-ne { top: 0; right: 0; cursor: nesw-resize; } .rz-sw { bottom: 0; left: 0; cursor: nesw-resize; }
    .rz-nw { top: 0; left: 0; cursor: nwse-resize; } .rz-se { bottom: 0; right: 0; cursor: nwse-resize; }
    .hd { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 12px 0 20px; background: #fff; color: var(--testo);
          border-bottom: 1px solid #E6EBF0; border-radius: 13px 13px 0 0; position: relative; z-index: 3; cursor: grab; user-select: none; touch-action: none; }
    .hd:active { cursor: grabbing; }
    .hd .logo { display: inline-flex; }
    .hd b { font-size: 16px; font-weight: 600; letter-spacing: .1px; }
    /* Il nome del paziente cede per ultimo: prima i valori del cuore (resta
       il ♥), il Da fare, la chip dell'ordine, l'episodio. Mai fuori, sotto la pill. */
    .hd .who { flex: 0 1 auto; min-width: 3em; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 50%; }
    .card:focus { outline: none; }
    .hd .hsp { flex: 1 1 auto; }
    .pill .who { max-width: 200px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .hd .sub { flex: 0 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--neutro); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .iconbtn { display: inline-grid; place-items: center; width: 36px; height: 36px; background: transparent; border: 0; color: var(--neutro);
               cursor: pointer; border-radius: 8px; padding: 0; }
    .iconbtn:hover { background: #F1F4F7; color: var(--testo); }
    .iconbtn:focus-visible { outline: 2px solid var(--azione); outline-offset: -2px; }
    #stautow { display: contents; }
    .stauto.ko { color: var(--err); background: var(--err-f); }
    .stauto.no, .stauto.sta { display: inline-flex; align-items: center; gap: 4px; width: auto; padding: 0 8px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .stauto.sta:not(.ko) { color: var(--azione); background: #E8F0FA; }
    .menuw { position: relative; }
    .menu { position: absolute; right: 0; top: 40px; z-index: 20; min-width: 200px; background: #fff; border: 1px solid #E3E8EF;
            border-radius: 10px; box-shadow: 0 12px 32px rgba(9,42,74,.16); padding: 6px; cursor: default; }
    /* il menu ⋯ del pannello (quello della pill del registratore resta com'è) */
    .menuw > .menu { width: 360px; max-width: calc(100vw - 16px); box-sizing: border-box; max-height: calc(100vh - 56px);
                     overflow-y: auto; overscroll-behavior: contain; padding: 2px 6px 4px; }
    .menu button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 8px 10px; border-radius: 6px;
                   font-size: 13px; color: var(--testo); cursor: pointer; }
    .menu button:hover, .menu button:focus-visible { background: #F1F4F7; outline: none; }
    .menu button.mrischio { color: var(--err); font-weight: 700; }
    .menu .mver { padding: 6px 10px 4px; font-size: 12px; color: var(--neutro); }
    /* un'icona per voce, grigia, la parola accanto; le voci che si accendono
       dicono il loro stato al posto dell'icona (acceso: il pallino blu con la spunta) */
    .menu .msez > button, .menu .mpiede > button { display: flex; align-items: center; gap: 8px; }
    .menu .mico { flex: none; display: inline-flex; color: var(--neutro); }
    .menu .mico.mem { width: 16px; justify-content: center; font-size: 14px; line-height: 16px; }
    .menu button:hover .mico { color: var(--testo); }
    .menu button[aria-checked="true"] .mico { color: var(--azione); }
    /* il reset: in fondo, da solo sulla sua riga, rosso anche a riposo */
    .menu .msez > button.mreset { flex: 0 0 100%; color: var(--err); }
    .menu button.mreset .mico { color: var(--err); }
    .menu #regmenu .mico { color: var(--err); }   /* Registrazioni: il puntino rosso del «● REC», non una scatola (resta rosso anche in hover) */
    /* in fondo la versione */
    .menu .mpiede { border-top: 1px solid #EEF2F6; padding-top: 2px; }
    /* le sezioni: un titolo piccolo, le voci due per riga (una lunga si prende la riga) */
    .menu .msez { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px 0; }
    .menu .msez + .msez { border-top: 1px solid #EEF2F6; }
    .menu .mtit { flex: 0 0 100%; padding: 3px 10px 1px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--neutro); }
    .menu .msez > button { flex: 1 0 calc(50% - 1px); width: auto; min-height: 34px; white-space: nowrap; }
    .menu .msez > .mforma, .menu .msez > .mver { flex: 0 0 100%; box-sizing: border-box; }
    /* Forma: Finestra · Al passaggio · Affianca, in una riga del menu */
    .menu .mforma { display: flex; align-items: center; gap: 2px; padding: 4px 4px 4px 10px; font-size: 12px; color: var(--neutro); white-space: nowrap; }
    .menu .mforma span { margin-right: 6px; }
    .menu .mforma button { display: inline-block; width: auto; padding: 5px 8px; font-size: 12px; }
    .menu .mforma button.on { background: #E8F0FA; color: var(--azione); font-weight: 700; }
    /* il tabellone: a tutta pagina */
    .wrap.tab .card { border-radius: 0; border-width: 0 0 0 1px; box-shadow: 0 0 18px rgba(9,42,74,.14); }
    .wrap.tab .hd { border-radius: 0; cursor: default; }
    .wrap.tab .card { border: 0; box-shadow: none; }
    /* Al passaggio: la pill resta, sopra la finestra; fissata ha l'anello */
    .wrap.ppass { z-index: 2147483647; }
    .pill.fissa { box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--azione), 0 4px 14px rgba(9,42,74,.22); }
    .tbspia { font-size: 12px; font-weight: 500; color: var(--neutro); white-space: nowrap; }
    .tbspia.no { color: var(--att); }
    .pbar { flex: 0 0 auto; height: 3px; background: #E3E8EF; }
    .pbar i { display: block; height: 100%; background: var(--azione); transition: width .25s ease; }
    /* compact, always-visible selection strip (plain text, not pills) */
    .selbar { background: #F8FBFE; border-bottom: 1px solid #D9E2EC;
              padding: 7px 24px; font-size: 12px; line-height: 1.8; color: var(--testo); }
    .selbar .selgrp { color: var(--azione); font-weight: 800; }
    .selbar .selrow { display: block; }
    .selitem { display: inline; white-space: nowrap; border-radius: 4px; padding: 1px 2px; }
    .selitem:hover { background: var(--info-f); }
    .selitem .selx { display: none; border: 0; background: var(--err); color: #fff; border-radius: 999px;
                     width: 15px; height: 15px; line-height: 13px; font-size: 11px; cursor: pointer; padding: 0;
                     vertical-align: 1px; margin-left: 2px; }
    .selitem:hover .selx { display: inline-block; }
    .bd { padding: 0; }
    .sec { margin-bottom: 14px; }
    .lbl { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--neutro); margin-bottom: 6px; }
    textarea, input[type="text"], input[type="search"] { width: 100%; border: 1px solid #C4D0DC; border-radius: 8px; padding: 8px 10px; font-size: 13px; color: var(--testo); background: #fff; }
    textarea:focus-visible, input:focus-visible, .chip:focus-visible, .pbtn:focus-visible, .seg button:focus-visible, .btn:focus-visible, select.res:focus-visible, summary:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; align-items: center; border: 1px solid #C4D0DC; background: #F4F8FB; color: var(--testo); border-radius: 999px;
            padding: 6px 12px; font-size: 12.5px; min-height: 28px; cursor: pointer; }
    .chip:hover { border-color: var(--azione); }
    .chip.on { background: var(--azione); border-color: var(--azione); color: #fff; }
    .chip.on::before { content: "✓ "; font-weight: 800; white-space: pre; }
    .chip.q { background: transparent; border-style: dashed; color: #35506B; }
    .chip.q:hover { border-color: var(--azione); color: var(--azione); }
    .chip.q { padding: 3px 8px; font-size: 11px; min-height: 22px; }
    /* il quesito che porta un pacchetto di esami: bordo pieno; acceso, come un profilo */
    .chip.q.pk { border-style: solid; border-color: #9DBFDE; color: var(--testo); font-weight: 600; }
    .chip.q.pk.on { background: var(--azione); border-color: var(--azione); color: #fff; }
    .chip.q.pk .pkn { font-weight: 500; color: var(--neutro); }
    .chip.q.pk.on .pkn { color: #fff; }
    .qrow { display: flex; gap: 8px; align-items: flex-start; }
    .qrow input { flex: 1 1 52%; min-width: 0; }
    .qchips { flex: 1 1 48%; display: flex; flex-wrap: wrap; gap: 4px; align-content: flex-start; }
    .chip.preset { background: #fff; border-color: #9DBFDE; font-weight: 600; padding: 5px 11px; font-size: 11.5px; min-height: 26px; }
    /* dense two-column exam grid: many exams, little space, still tappable */
    .opt { display: flex; align-items: center; gap: 6px; border: 1px solid #E3E8EF; background: #fff; color: var(--testo);
           border-radius: 7px; padding: 5px 7px; font-size: 11.5px; line-height: 1.2; cursor: pointer; text-align: left;
           min-height: 27px; overflow: hidden; }
    .opt:hover { border-color: var(--azione); background: #F4F8FB; }
    .opt .box { flex: 0 0 13px; width: 13px; height: 13px; border: 1.5px solid #9DBFDE; border-radius: 3px;
                display: inline-grid; place-items: center; font-size: 11px; font-weight: 800; color: transparent; }
    .opt.on { background: var(--azione); border-color: var(--azione); color: #fff; font-weight: 600; }
    .opt.on .box { background: #fff; border-color: #fff; color: var(--azione); }
    .opt .nm { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .chip.preset.on { background: var(--azione); border-color: var(--azione); color: #fff; }
    .qrx { grid-column: 1 / -1; min-width: 0; }
    /* Richieste: una casella «Quesito o esame…», poi tre colonne strette di
       parole da accendere — POC · Lab · RX. Niente caselle da spuntare: la
       riga intera si tocca, scelta è piena del colore dei comandi. */
    .qac { flex: 1 1 52%; min-width: 0; margin-top: 0; }
    .acquesito { display: block; width: 100%; text-align: left; border: 0; background: #F4F8FB; border-radius: 6px; padding: 6px 8px;
                 font: inherit; font-size: 12px; font-weight: 600; color: var(--azione); cursor: pointer; margin-bottom: 2px;
                 overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .acquesito:hover { background: var(--info-f); }
    .rcols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 14px; align-items: start; }
    .rcol { display: flex; flex-direction: column; min-width: 0; }
    .rch { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--neutro);
           padding: 0 6px 4px; border-bottom: 1px solid #E3E8EF; margin-bottom: 3px; }
    .rprofs { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 0 5px; }
    .rprof { display: inline-flex; align-items: center; }
    .rprof .chip.preset { padding: 2px 9px; min-height: 22px; font-size: 11.5px; }
    .respandi { border: 0; background: transparent; color: var(--azione); font: inherit; font-size: 12px; padding: 0 5px; cursor: pointer; }
    .rcols .opt { width: 100%; border: 0; border-radius: 6px; background: transparent; min-height: 24px; padding: 3px 6px;
                  font-size: 12px; line-height: 1.25; gap: 6px; }
    .rcols .opt:hover { background: #F1F6FB; }
    .rcols .opt.on { background: var(--azione); color: #fff; font-weight: 600; }
    .rcols .opt.on:hover { background: #094a8c; }
    .rcols .opt.sotto { padding-left: 16px; }
    .rcols .opt .nm { flex: 0 1 auto; min-width: 0; }
    .rcols .opt .ult { font-size: 11px; margin-left: 0; padding-left: 0; }
    .ult .uok { color: var(--ok); font-weight: 600; }
    .ult .uatt { color: var(--att); font-weight: 600; }
    .ult .uros { color: var(--err); font-weight: 700; }
    .rcols .opt.on .ult, .rcols .opt.on .ult span { color: #fff; }
    .rcol .qrx { margin-top: 6px; font-size: 12px; padding: 6px 8px; }
    .chip.cart { background: var(--ok-f); border-color: #BCE0C9; color: var(--ok); cursor: default; }
    .chip.ghosted { background: #F4F8FB; border-color: #E3E8EF; color: var(--neutro); cursor: default; }
    .chip.nel { background: var(--ok-f); border-color: #BCE0C9; color: var(--ok); cursor: default; }
    .chip.manca { background: var(--err-f); border-color: #E9BAB6; color: var(--err); cursor: default; font-weight: 600; }
    .chip.controlla { background: var(--att-f); border-color: #F0D49A; color: var(--att); cursor: default; font-weight: 600; }
    /* l'emogas entrato nella versione di sempre: «al posto di EGA VENOSA NEW» */
    .chip .alposto { margin-left: 6px; font-size: 11px; font-weight: 500; color: var(--neutro); }
    /* un'azione secondaria scritta, non un bottone: «solo carrello», «+ aggiungi» */
    .lnk { border: 0; background: transparent; padding: 2px 4px; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--azione);
           cursor: pointer; text-decoration: underline; text-decoration-color: #9DBFDE; text-underline-offset: 3px; white-space: nowrap; }
    .lnk:hover:enabled { color: #094a8c; text-decoration-color: currentColor; }
    .lnk:disabled { color: #93A3B3; text-decoration: none; cursor: default; }
    .btnrow .lnk { flex: 0 0 auto; align-self: center; margin-left: 6px; }
    .lnk.piu { display: inline-block; margin: -4px 0 12px; padding-left: 0; }
    .lnk.ultima { display: block; margin: -2px 0 6px; padding-left: 0; }
    .rpiede { margin: 12px 0 4px; }
    /* una richiesta ancora da confermare: una riga, non un allarme */
    .daconf { display: flex; align-items: center; gap: 8px; max-width: 820px; margin: 0 0 12px; font-size: 12px; color: var(--att); }
    .daconf .ddot { flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; background: #E5A83B; }
    .daconf .lnk { font-size: 12px; padding: 0; margin-left: auto; }
    /* sul suo carrello: «Conferma e stampa» · «Svuota», a due tocchi */
    .daconf.az { flex-wrap: wrap; }
    .daconf .dcaz { margin-left: auto; display: flex; gap: 12px; }
    .daconf .dcaz .lnk { margin-left: 0; }
    .daconf .lnk.chiede { white-space: normal; text-align: right; }
    .daconf .lnk.chiede.via:enabled { color: var(--err); text-decoration-color: #E2A6A0; }
    .acsec .ac { margin-top: 0; }
    .btn { display: block; width: 100%; border: 0; border-radius: 10px; padding: 12px; font-size: 14px; font-weight: 700; cursor: pointer; text-align: center; }
    .btn + .btn { margin-top: 7px; }
    .btnrow { display: flex; gap: 7px; }
    .btnrow .btn { flex: 1 1 auto; min-width: 0; padding: 11px 8px; font-size: 13px; margin: 0;
                   white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btnrow .btn.confirm { flex: 0 1 auto; }
    /* «Ctrl+Invio», piccolo, sul lato destro della Conferma — quando si può premere;
       senza posto è lui che cede, non il nome del paziente */
    #goconfirm { display: flex; align-items: baseline; justify-content: center; }
    #goconfirm .ctxt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #goconfirm:not(:disabled)::after { content: "Ctrl+Invio"; flex: 0 1000 auto; min-width: 0; overflow: hidden; white-space: nowrap;
                                       padding-left: 10px; font-size: 11px; font-weight: 500; opacity: .75; }
    .btn.primary { background: var(--azione); color: #fff; }
    .btn.primary:hover { background: #094a8c; }
    .btn.confirm { background: var(--att-f); color: var(--att); border: 1px solid #E5C588; }
    .btn.confirm:hover { background: #ffefd0; }
    .btn.ghost { background: #F4F8FB; color: var(--testo); border: 1px solid #C4D0DC; }
    .btn.ghost:hover { border-color: var(--azione); }
    /* «Svuoto 4 esami?»: il secondo tocco svuota davvero */
    .btn.ghost.armato { background: var(--err-f); color: var(--err); border-color: var(--err); }
    .btn.stop { background: var(--err); color: #fff; }
    .btn.stop:hover { background: #941e18; }
    .btn:disabled { background: #EDF1F5; color: #93A3B3; border: 1px solid #E3E8EF; cursor: default; opacity: 1; }
    .idline { font-size: 11.5px; color: var(--neutro); margin: 0 0 7px; text-align: center; }
    .idline b { color: var(--testo); }
    .problem { font-size: 11.5px; color: var(--att); background: var(--att-f); border: 1px solid #E5C588; border-radius: 8px; padding: 7px 9px; margin-bottom: 7px; }
    .hint { font-size: 11.5px; color: var(--neutro); margin-top: 7px; }
    .steps { display: flex; flex-direction: column; gap: 6px; }
    .step { display: flex; align-items: baseline; gap: 8px; padding: 8px 9px; border-radius: 8px; background: #F4F8FB; }
    .step .ic { flex: 0 0 16px; text-align: center; font-size: 12px; display: inline-block; }
    .step.ok { background: var(--ok-f); } .step.ok .ic { color: var(--ok); }
    .step.running { background: var(--info-f); outline: 1px solid #9DBFDE; }
    .step.running .ic { animation: psaSpin 1.1s linear infinite; }
    .step.fail { background: var(--err-f); } .step.fail .ic { color: var(--err); font-weight: 800; }
    .step.skipped { opacity: .55; }
    .step small { color: var(--neutro); margin-left: auto; text-align: right; }
    .banner { border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; font-size: 12.5px; }
    .banner b { display: block; font-size: 13px; margin-bottom: 3px; }
    .banner.err { background: var(--err-f); color: var(--err); border: 1px solid #E9BAB6; }
    .banner.ok { background: var(--ok-f); color: var(--ok); border: 1px solid #BCE0C9; }
    .banner.warn { background: var(--att-f); color: var(--att); border: 1px solid #E5C588; }
    .banner .qline { display: block; margin-top: 3px; font-size: 11.5px; opacity: .85; }
    .ac { position: relative; margin-top: 8px; }
    .ac input { width: 100%; }
    .acdrop { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5; background: #fff;
              border: 1px solid #C4D0DC; border-radius: 10px; box-shadow: 0 10px 24px rgba(9,42,74,.18);
              max-height: 260px; overflow: auto; padding: 4px; }
    .acitem { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; background: transparent;
              border-radius: 6px; padding: 6px 8px; font-size: 12px; cursor: pointer; color: var(--testo); }
    .acitem:hover { background: var(--info-f); }
    .acitem.on { color: var(--ok); font-weight: 600; }
    .acitem.on::after { content: "✓"; margin-left: auto; }
    .acnm { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .actag { flex: 0 0 auto; margin-left: auto; font-size: 11px; font-weight: 800; letter-spacing: .4px; color: var(--neutro);
             background: #F4F8FB; border: 1px solid #E3E8EF; border-radius: 5px; padding: 1px 5px; }
    .acitem.on .actag { margin-left: 0; }
    .acempty { padding: 8px; font-size: 12px; color: var(--neutro); }
    .list { border: 1px solid #D9E2EC; border-radius: 10px; max-height: 320px; overflow: auto; margin-top: 6px; }
    .list label { display: flex; gap: 8px; padding: 9px 10px; font-size: 12px; cursor: pointer; align-items: baseline; border-bottom: 1px solid #EEF2F6; }
    .list label:hover { background: #F4F8FB; }
    .list input[type="checkbox"] { accent-color: var(--azione); }
    .log { font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; color: #35506B; background: #F8FAFC;
           border: 1px solid #E3E8EF; border-radius: 8px; padding: 8px; max-height: 130px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    details.reg summary { cursor: pointer; font-size: 11.5px; color: var(--neutro); margin: 8px 0 6px; }
    /* il resoconto: passi e Registro insieme, chiusi sotto «Dettagli» */
    details.dett { max-width: 820px; margin-bottom: 8px; }
    details.dett > summary { cursor: pointer; font-size: 11.5px; font-weight: 600; color: var(--neutro); margin: 2px 0 8px; }
    details.dett .reghd { font-size: 11.5px; color: var(--neutro); margin: 10px 0 6px; }
    details.reflab > summary { cursor: pointer; }
    /* Dimissioni: le deleghe per il ritiro, una riga quieta sotto i fogli */
    details.ritiro { margin-top: 10px; }
    details.ritiro > summary { cursor: pointer; list-style: none; font-size: 12px; font-weight: 600; color: var(--neutro); padding: 4px 2px; }
    details.ritiro > summary::-webkit-details-marker { display: none; }
    details.ritiro > summary::after { content: " ▸"; }
    details.ritiro[open] > summary::after { content: " ▾"; }
    details.ritiro > .mlist { margin-top: 4px; }
    /* l'angolo per ridimensionare: in basso a destra, come in ogni finestra, e
       come lì senza disegno (il bordo tondo lo tagliava): lo dice il cursore */
    .rsz { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; z-index: 7; touch-action: none; }
    .commit { position: sticky; bottom: -1px; margin: 0 -24px -14px; padding: 10px 24px 14px; background: #fff;
              border-top: 1px solid #EEF2F6; box-shadow: 0 -10px 14px -12px rgba(9,42,74,.25); }
    /* i bottoni stanno in fondo alla finestra anche quando c'è poco sopra
       (ricevuta, resoconto): non a metà, con la loro ombra in mezzo al bianco */
    .bdi:has(> .commit) { min-height: 100%; display: flex; flex-direction: column; }
    .bdi > .commit { margin-top: auto; }
    .bdi > .lnk { align-self: flex-start; }
    .commit > .btn { max-width: 820px; }
    .rlist { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow: auto; }
    .rrow { display: flex; align-items: center; gap: 8px; border: 1px solid #E3E8EF; background: #fff; border-radius: 8px;
            padding: 7px 9px; font-size: 12px; cursor: pointer; text-align: left; width: 100%; color: var(--testo); }
    .rrow:hover { border-color: var(--azione); background: #F4F8FB; }
    .prow { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; width: 100%; text-align: left;
            border: 1px solid #E3E8EF; background: #fff; border-radius: 8px; padding: 6px 9px; cursor: pointer; color: var(--testo); }
    .prow:hover { border-color: var(--azione); background: #F4F8FB; }
    .prow.hot { border-color: #9DBFDE; background: var(--info-f); }
    .pline1 { font-size: 12px; font-variant-numeric: tabular-nums; }
    .pline1 small { color: var(--neutro); font-size: 11px; }
    .pline1 .prist { margin-left: auto; color: var(--azione); font-weight: 600; font-size: 11px; }
    .pline1 { display: flex; align-items: center; gap: 4px; width: 100%; }
    .pline2 { font-size: 11px; color: var(--neutro); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

    .rdot { flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid #C4D0DC; background: transparent; }
    .rdot.saved { background: #9AA8B5; border-color: #9AA8B5; }   /* salvato sul PC: un fatto di cache, non una notizia */
    .rdot.open { background: #9DBFDE; border-color: #9DBFDE; }
    .rdot.busy { background: #E5A83B; border-color: #E5A83B; animation: psaPulse 1s infinite; }
    .rdot.err { background: var(--err); border-color: var(--err); }
    .mini { float: right; border: 1px solid #C4D0DC; background: #fff; color: var(--azione); border-radius: 6px;
            padding: 2px 8px; font-size: 12px; min-height: 24px; font-weight: 700; cursor: pointer; letter-spacing: 0; text-transform: none; }
    .mini:hover { border-color: var(--azione); background: #F4F8FB; }
    .rwhen { flex: 0 0 auto; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; color: #35506B; font-variant-numeric: tabular-nums; }
    .rsys { flex: 0 0 auto; font-size: 11px; font-weight: 800; letter-spacing: .5px; color: var(--neutro); background: #F4F8FB;
            border: 1px solid #E3E8EF; border-radius: 5px; padding: 1px 5px; }
    .rlab { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    /* Le schermate in UNA fila di pillole, nell'ordine in cui si lavora:
       Richieste, Esiti, EO, Consensi, Dimissioni. La pillola accesa è quella
       dove sei. */
    .seg { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 2px; margin: 0; padding: 0 24px;
           border-bottom: 1px solid #EEF2F6; min-height: 42px; }
    .seg > button { border: 0; border-bottom: 2px solid transparent; background: none; border-radius: 0; margin-bottom: -1px;
                    padding: 12px 10px 10px; font-size: 13px; font-weight: 400; color: var(--neutro); cursor: pointer; }
    .seg > button:hover { color: var(--testo); }
    .seg > button.on { color: var(--testo); font-weight: 600; border-bottom-color: var(--azione); }
    /* la scheda accesa è in grassetto, ma occupa già la larghezza del grassetto:
       cambiando schermata le altre non si spostano di lato */
    .seg > button[data-t] { display: inline-flex; flex-direction: column; align-items: center; }
    .seg > button[data-t]::after { content: attr(data-t); font-weight: 600; height: 0; overflow: hidden; visibility: hidden; }
    .segdx { margin-left: auto; align-self: center; display: flex; align-items: center; gap: 6px; padding: 9px 0 3px; }
    /* in Modifica la fila resta com'è (stessa altezza, stesse righe di testo) ma non va mai a capo */
    .seg.modifica { flex-wrap: nowrap; }
    .segtit { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 12px 0 10px;
              border-bottom: 2px solid transparent; margin-bottom: -1px; font-size: 13px; font-weight: 600; line-height: normal; color: var(--testo); }
    /* una schermata del menu ⋯: «‹ [icona] Nome» al posto delle schede (‹ ed Esc tornano alla scheda di prima) */
    .seg.vmenu { align-items: center; gap: 2px; }
    .seg .vback { flex: none; width: 30px; height: 30px; margin: 0 0 0 -8px; padding: 0; border: 0; border-radius: 8px; }
    .segtit .mico { display: inline-flex; vertical-align: -3px; margin-right: 7px; color: var(--neutro); }
    .rgo { flex: 0 0 auto; color: var(--neutro); font-size: 12px; }
    .dlist, .mlist { display: flex; flex-direction: column; gap: 4px; }
    .dsep { display: flex; align-items: center; gap: 8px; margin: 8px 2px 3px; font-size: 11px;
            color: var(--neutro); text-transform: uppercase; letter-spacing: .06em; }
    .dsep::after { content: ""; flex: 1 1 auto; height: 1px; background: #E3E8EF; }
    .drow { display: flex; align-items: stretch; gap: 5px; }
    .sec > .drow + .drow { margin-top: 6px; }
    .sec > .drow + .lbl { margin-top: 14px; }
    /* Copying is what this list is FOR: the target is the whole row, not a
       13px glyph at its edge. The pencil stays a button of its own. */
    .dcopia { flex: 1 1 auto; display: flex; align-items: center; gap: 8px; min-width: 0; text-align: left;
              border: 1px solid #E3E8EF; border-radius: 9px; background: #fff; cursor: pointer;
              padding: 8px 10px 8px 11px; font: inherit; }
    .dcopia:hover { border-color: #9DBFDE; background: #F4F9FD; }
    .dcopia:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    .dcopia.fatto { border-color: #BCE0C9; background: var(--ok-f); }
    .dcopia.fatto .dico { color: var(--ok); }
    .dnome { flex: 1 1 auto; font-size: 12.5px; font-weight: 600; color: var(--testo); overflow: hidden;
             white-space: nowrap; text-overflow: ellipsis; }
    .dmeta { flex: 0 0 auto; font-size: 11px; color: var(--neutro); }
    .dico { flex: 0 0 auto; font-size: 13px; color: #6E8398; }
    .dmod { color: var(--azione); font-weight: 800; margin-left: 5px; }
    .dtuo { margin-left: 7px; padding: 1px 7px; border-radius: 999px; background: var(--info-f); color: var(--azione);
            font-size: 11px; font-weight: 600; vertical-align: 1px; }
    /* in fondo all'elenco, un foglio da scrivere: tratteggiato, come un posto libero */
    .dnuovo { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 38px; margin-top: 2px; padding: 8px 11px;
              border: 1px dashed #C4D0DC; border-radius: 9px; background: transparent; cursor: pointer; text-align: left;
              font: inherit; font-size: 12.5px; font-weight: 600; color: var(--neutro); transition: border-color .12s, color .12s, background-color .12s; }
    .dnuovo:hover { border-color: var(--azione); color: var(--azione); background: #F4F9FD; }
    .dnuovo:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    .dplus { font-size: 17px; font-weight: 400; line-height: 1; }
    /* sotto i fogli, piccoli e quieti: il file dei fogli (un altro PC, una copia, l'editor dimissioni.html) */
    .dfile { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
    .dfile .mini { color: var(--neutro); }
    /* il nome del foglio tuo: un titolo che si scrive, non un modulo */
    .dhd { display: flex; align-items: center; gap: 6px; max-width: 820px; margin-bottom: 10px; }
    .dhd .mini { float: none; flex: none; white-space: nowrap; }
    .dhd input.dtit { flex: 1 1 auto; width: auto; min-width: 0; border: 0; border-bottom: 1px solid #D9E2EC; border-radius: 0;
                      background: transparent; padding: 6px 2px; font: inherit; font-size: 16px; font-weight: 600; color: var(--testo); }
    .dhd input.dtit:focus, .dhd input.dtit:focus-visible { outline: none; border-bottom-color: var(--azione); }
    .dhd input.dtit::placeholder { color: #A3B2C2; font-weight: 400; }
    .dmod.agg { color: var(--att); }
    .dbtn { flex: 0 0 auto; min-width: 38px; border: 1px solid #E3E8EF; border-radius: 9px;
            background: #F8FBFE; color: #35506B; font-size: 13px; cursor: pointer; }
    .dbtn:hover { background: var(--info-f); border-color: #9DBFDE; color: var(--azione); }
    .dbtn:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    /* il testo scelto nella tendina: si vede cosa è finito negli appunti */
    .eotxt { margin-top: 8px; border: 1px solid #E3E8EF; border-left: 3px solid var(--azione); border-radius: 8px;
             background: #F8FBFE; padding: 9px 11px; font-size: 12.5px; line-height: 1.55; color: #35506B;
             max-height: 34vh; overflow: auto; white-space: pre-wrap; }
    .eoazione { margin-top: 8px; }
    .dedit { width: 100%; min-height: 46vh; resize: vertical; border: 1px solid #D9E2EC; border-radius: 9px;
             padding: 9px 10px; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
             color: var(--testo); background: #fff; }
    .dedit:focus { outline: 2px solid var(--azione); outline-offset: 1px; }
    /* a name we were never taught: shown in full, and underlined so it can
       never be mistaken for one of the curated sigle */
    .sttab th.stn.grezza { text-decoration: underline dotted #C08A2E; text-underline-offset: 2px; }
    .infochip { float: right; margin-right: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--att);
                background: var(--att-f); border-radius: 999px; padding: 1px 8px; cursor: help; }
    .infochip:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    /* senza valori letti: un solo bottone, grande, al posto della tabella */
    .carica { display: flex; justify-content: center; padding: 22px 0 14px; }
    .grande { border: 0; border-radius: 12px; background: var(--azione); color: #fff; font: inherit; font-size: 16px; font-weight: 700;
              padding: 15px 38px; min-width: 240px; cursor: pointer; box-shadow: 0 6px 18px rgba(11,92,173,.28); }
    .grande:hover { background: #094a8c; }
    .grande:disabled { background: #7FA6CB; box-shadow: none; cursor: default; }
    .grande:focus-visible { outline: 3px solid #9DBFDE; outline-offset: 2px; }
    /* misurata sulla FINESTRA, non sullo schermo: dentro l'Affianca è stretta */
    .esiti { container: esiti / inline-size; }
    /* WORKUP (gli Esiti): Lab · ECG · Imaging, ognuno col suo colore sul bordo
       e nel titolo. Il rosso è SOLO dei valori fuori range; l'ambra di ciò che
       aspetta; il blu (l'accento) dei comandi e di «nuovo». */
    :host, .wu { --wu-lab: #0E7468; --wu-ecg: #5B50B8; --wu-img: #8A4A8F; --wu-altri: var(--neutro);
          --wu-wait: var(--att); --wu-wait-bg: var(--att-f); --wu-new: var(--azione); --wu-new-bg: var(--info-f); --wu-bad: var(--err); }
    /* Il Lab sempre per primo, a tutta larghezza; sotto ECG e Imaging, affiancati se c'è posto */
    .wu .esgrid { display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }
    .wu .wucol { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; min-width: 0; }
    @container esiti (min-width: 760px) {
      .wu .wucol { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .wu .wucol > .wualtri { grid-column: 1 / -1; }
    }
    .wusum { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin: 0 0 14px; padding: 2px 2px 8px; }
    .wusumv { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 7px;
              font-size: 13.5px; color: var(--testo); font-variant-numeric: tabular-nums; }
    .wuv { white-space: nowrap; }
    .wuv b { font-weight: 600; color: #35506B; }
    .wuval { color: var(--wu-bad); font-weight: 700; }
    .wuprima { color: var(--neutro); font-size: 12px; }
    .wusep, .wupiu { color: var(--neutro); }
    .wuok { color: var(--neutro); }
    .wunuovi { border: 0; border-radius: 999px; background: var(--wu-new-bg); color: var(--wu-new); font: inherit; font-size: 12px;
               font-weight: 700; padding: 1px 10px; cursor: pointer; }
    .wunuovi:hover { background: #DCEAF7; }
    .wutools { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .wutools .mini { float: none; }
    .wuauto { float: right; margin-right: 6px; font-size: 11px; font-weight: 600; color: var(--neutro); font-variant-numeric: tabular-nums; letter-spacing: 0; text-transform: none; }
    /* ogni sezione: il suo colore sul bordo e, appena accennato, sul fondo */
    .wusec { --wu-c: var(--neutro); border-left: 3px solid var(--wu-c); border-radius: 0 10px 10px 0; padding: 9px 12px 10px;
             margin: 0; min-width: 0; background: color-mix(in srgb, var(--wu-c) 5%, #fff); }
    .wulab .stwrap { width: fit-content; max-width: 100%; background: #fff; }
    .wulab { --wu-c: var(--wu-lab); } .wuecg { --wu-c: var(--wu-ecg); } .wuimg { --wu-c: var(--wu-img); } .wualtri { --wu-c: var(--wu-altri); }
    .wuh { display: flow-root; }   /* i bottoni a destra restano nella riga del titolo */
    .wuh .wut { color: var(--wu-c); font-weight: 800; }
    .wucnt { color: var(--neutro); font-weight: 600; letter-spacing: 0; }
    .wuvuoto { font-size: 12px; color: var(--neutro); }
    .wuwaits { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; }
    /* una riga per attesa: niente fascia gialla, un segno ambra a sinistra */
    .wuwait { display: flex; align-items: baseline; gap: 7px; min-width: 0; font-size: 12px; color: #35506B;
              border-left: 2px solid var(--wu-wait); padding: 1px 0 1px 8px; }
    .wuwait b { flex: none; white-space: nowrap; color: var(--wu-wait); font-variant-numeric: tabular-nums; }
    /* parziale: i valori arrivano già, niente ambra e niente orologio */
    .wuwait.parz { border-left-color: #C9D3DD; color: var(--neutro); }
    .wuwait.parz b { color: var(--neutro); font-weight: 600; }
    .wuwlab { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .wuwq { flex: 0 0 auto; color: var(--neutro); font-size: 11px; }
    .wu .rlist { max-height: none; overflow: visible; }
    .wuline { display: flex; align-items: stretch; gap: 4px; }
    .wuline .rrow { flex: 1 1 auto; min-width: 0; }
    .rmain { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .wuex { font-size: 11.5px; color: var(--neutro); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .wunew { flex: 0 0 auto; font-size: 11px; font-weight: 700; color: var(--wu-new); background: var(--wu-new-bg); border-radius: 999px; padding: 0 7px; }
    .wust { flex: 0 0 auto; font-size: 11px; color: var(--neutro); }
    .wupdf { flex: 0 0 auto; border: 1px solid #E3E8EF; border-radius: 8px; background: #fff; color: var(--azione); font: inherit;
             font-size: 11px; font-weight: 700; padding: 0 9px; cursor: pointer; white-space: nowrap; }
    .wupdf:hover { border-color: var(--azione); background: #F4F8FB; }
    .wupdf:focus-visible, .wunuovi:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    .wuitem.aperto .rrow { border-color: var(--wu-c); }
    .wutxt { margin: 4px 0 8px 14px; padding: 7px 11px; border-left: 2px solid var(--wu-c); border-radius: 0 8px 8px 0; background: #FBFCFE; }
    .wuver { display: inline-block; margin-bottom: 5px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
             color: var(--wu-wait); background: var(--wu-wait-bg); }
    .wualtro { font-size: 12.5px; font-weight: 700; color: var(--wu-bad); }
    .wuex.grave { color: var(--wu-bad); font-weight: 700; white-space: normal; }
    .wunote { font-size: 12px; color: var(--neutro); }
    .wuact { display: flex; gap: 6px; margin-top: 7px; }
    .wuact .mini { float: none; }
    .rdot.coda { border-style: dashed; border-color: #8397A8; }
    .rrow.altro .rlab { color: var(--neutro); }
    .archhd { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 8px; cursor: pointer;
              border: 1px solid #E3E8EF; border-radius: 9px; background: #F8FBFE; padding: 7px 10px;
              font: 600 12px/1 inherit; color: var(--neutro); }
    .archhd:hover { border-color: #9DBFDE; color: var(--testo); }
    .archhd .an { background: #E3E8EF; color: #35506B; border-radius: 999px; padding: 1px 7px; font-size: 11px; }
    .archhd .ago { margin-left: auto; color: var(--neutro); }
    .alist { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
    .arow { display: flex; align-items: center; gap: 8px; padding: 5px 8px 5px 10px;
            border: 1px solid #EDF1F6; border-radius: 8px; background: #fff; }
    .arow .anm { flex: 1 1 auto; font-size: 12px; color: var(--neutro); overflow: hidden;
                 white-space: nowrap; text-overflow: ellipsis; }
    .arow .ameta { flex: 0 0 auto; font-size: 11px; color: var(--neutro); }
    .abtn { flex: 0 0 auto; border: 1px solid #D9E2EC; background: #F8FBFE; color: #35506B;
            border-radius: 7px; padding: 3px 8px; font: 600 11px/1.4 inherit; cursor: pointer; }
    .abtn:hover { border-color: #9DBFDE; color: var(--azione); }
    .abtn.del:hover { border-color: #E9BAB6; background: var(--err-f); color: var(--err); }
    .recchip { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; background: var(--err-f); color: var(--err);
               font-size: 12px; font-weight: 600; white-space: nowrap; margin: 0 4px; }
    /* nell'intestazione, la forma delle altre chip (.gchip); sulla pill resta piccola: la pill non cresce mentre registri */
    .hd .recchip { height: 30px; padding: 0 11px; }
    button.recchip { border: 0; cursor: pointer; font-family: inherit; }
    button.recchip:hover { background: #F6D9D6; }
    /* ⋯ → Registrazioni */
    .registrazioni .regnow { margin-bottom: 10px; }
    .registrazioni .regnow .btn { width: auto; padding: 9px 14px; }
    /* Registra è un gesto raro e tranquillo: ghost, a larghezza propria, col pallino rosso del REC */
    .registrazioni #regvia { display: inline-block; width: auto; padding: 8px 16px; margin-bottom: 4px; }
    .registrazioni #regvia .recpt { color: var(--err); }
    .registrazioni .regko { background: var(--err-f); border: 1px solid #E9BAB6; color: #8A1F19; border-radius: 9px; padding: 9px 11px; font-size: 12.5px; margin-bottom: 8px; }
    .regauto { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 13px; color: var(--testo); cursor: pointer; }
    .regauto input { width: 16px; height: 16px; margin: 0; accent-color: var(--azione); cursor: pointer; }
    .registrazioni .lbl { margin-top: 16px; }
    .reglist { display: flex; flex-direction: column; gap: 6px; }
    .regrow { border: 1px solid #E3E8EF; border-radius: 9px; background: #fff; padding: 8px 10px; font-size: 12px; color: #35506B; }
    .regrow .rr1 { display: flex; align-items: center; gap: 8px; color: var(--testo); font-size: 12.5px; }
    .regrow .rkb { margin-left: auto; color: var(--neutro); font-variant-numeric: tabular-nums; }
    .regtag { padding: 1px 7px; border-radius: 999px; background: #EEF2F6; color: #35506B; font-size: 11px; font-weight: 700; }

    .regrow .rr2 { margin-top: 3px; color: var(--testo); }
    .regrow .rr3 { margin-top: 3px; font-size: 11px; color: var(--neutro); overflow-wrap: anywhere; }
    .regrow .rok { color: #1E6B43; font-weight: 600; }
    .regrow .rko { color: var(--err); font-weight: 700; }
    .regrow .rr4 { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
    .regrow .rr4 .mini { float: none; margin: 0; }
    .regrow .rr4 .mini.via { color: var(--err); }
    .regrow .rr4 .mini.armato, #eoreset.armato, #dimreset.armato { background: var(--err-f); border-color: var(--err); color: var(--err); }
    .regriep { white-space: pre-wrap; font: 11px/1.45 ui-monospace, Menlo, Consolas, monospace; color: #35506B; background: #F4F8FB; border: 1px solid #E3E8EF;
               border-radius: 8px; padding: 8px 10px; margin: 8px 0 0; max-height: 260px; overflow: auto; }
    .tnow { display: flex; align-items: center; gap: 10px; background: var(--ok-f); border: 1px solid #BCE0C9;
            border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
    .tlab { flex: 1 1 auto; font-size: 12px; color: #35506B; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .ricetta .lbl { margin-top: 12px; }
    .ricetta .lbl:first-child { margin-top: 0; }
    .ricpref, .ricris { display: flex; flex-wrap: wrap; gap: 5px; }
    .ricchip { border: 1px solid #C4D0DC; background: #fff; color: var(--testo); border-radius: 999px; padding: 6px 11px; font: 600 11.5px/1.2 inherit; cursor: pointer; text-align: left; }
    .ricchipw { display: inline-flex; align-items: center; gap: 1px; }
    .ricchipw.fisso { cursor: grab; }
    .ricpin { border: 0; background: none; cursor: pointer; padding: 2px 3px; font-size: 11px; opacity: .35; filter: grayscale(1); }
    .ricpin.on, .ricpin:hover, .ricpin:focus-visible { opacity: 1; filter: none; }
    .ricchip:hover, .ricrisv:hover { border-color: var(--azione); color: var(--azione); }
    .ricchip.on, .ricrisv.on { background: var(--azione); border-color: var(--azione); color: #fff; }
    .ricris { flex-direction: column; flex-wrap: nowrap; margin-top: 6px; max-height: 210px; overflow: auto; }
    .ricrisv { border: 1px solid #E3E8EF; background: #fff; color: var(--testo); border-radius: 8px; padding: 6px 9px; font: 12px/1.3 inherit; cursor: pointer; text-align: left; }
    .ricrisv b { font-variant-numeric: tabular-nums; margin-right: 4px; }
    .rictipo { font-style: normal; font-size: 11px; font-weight: 700; color: #6A4C93; background: #F3EEFA; border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
    .ricrisv.on .rictipo { background: #fff; }
    .riccerca { display: flex; gap: 6px; }
    .riccerca input, .ricquesito { flex: 1 1 auto; min-width: 0; border: 1px solid #D9E2EC; border-radius: 8px; padding: 7px 9px; font: 12.5px/1.3 inherit; color: var(--testo); }
    .ricquesito { display: block; width: 100%; box-sizing: border-box; margin-bottom: 10px; }
    .riccerca input:focus, .ricquesito:focus { outline: 2px solid var(--azione); outline-offset: 1px; }
    .ricbtn { border: 1px solid var(--azione); background: #fff; color: var(--azione); border-radius: 8px; padding: 6px 12px; font: 700 12px/1 inherit; cursor: pointer; }
    .ricbtn:disabled, .ricetta .btn:disabled { opacity: .45; cursor: default; }
    .ricvoci { display: flex; flex-direction: column; gap: 4px; }
    .ricv { display: flex; align-items: center; gap: 8px; border: 1px solid #EDF1F6; border-radius: 8px; padding: 5px 6px 5px 9px; font-size: 12px; }
    .ricvd { flex: 1 1 auto; min-width: 0; font-weight: 600; color: var(--testo); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ricvd i { font-style: normal; font-weight: 400; color: var(--neutro); font-variant-numeric: tabular-nums; }
    .ricq { display: flex; align-items: center; gap: 4px; color: var(--neutro); }
    .ricq input { width: 46px; border: 1px solid #D9E2EC; border-radius: 6px; padding: 3px 5px; font: 12px/1.2 inherit; }
    .ricns { display: flex; align-items: center; gap: 4px; color: #35506B; white-space: nowrap; }
    .ricx { border: 0; background: none; color: var(--neutro); cursor: pointer; font-size: 13px; padding: 2px 4px; }
    .ricnota { font-size: 11.5px; color: var(--neutro); margin-top: 6px; }
    .ricstato { margin-top: 8px; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; background: #F4F8FB; color: var(--testo); border-left: 3px solid var(--azione); }
    .ricstato.ok { background: var(--ok-f); border-left-color: #1E7A46; }
    .ricstato.warn { background: var(--att-f); border-left-color: #B26B00; }
    .ricstato.err { background: var(--err-f); border-left-color: var(--err); color: #8C1D18; font-weight: 700; }
    .ricstato .ricbtn { margin-left: 8px; }
    .ttot { float: right; font-size: 11px; color: var(--neutro); font-weight: 600; }
    /* CONSEGNE: una riga per paziente, il nome in grassetto */
    .consegne .mini + .mini { margin-right: 6px; }
    /* ⋯ → ETICHETTA: il testo, l'anteprima alla misura vera, copie e dove, Stampa · Annulla */
    .eti textarea { width: 100%; box-sizing: border-box; font: 14px/1.4 ui-monospace, Consolas, monospace; padding: 6px 8px; border: 1px solid #C6D4E4; border-radius: 8px; resize: vertical; }
    .etiant { margin: 10px 0; padding: 10px; background: #EEF2F6; border-radius: 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .etiant svg { background: #fff; box-shadow: 0 0 0 1px #9FB3C8, 0 1px 4px rgba(11,44,80,.18); border-radius: 2px; }
    .etiant small { color: var(--neutro); font-size: 11px; }
    .etierr { color: #8C1D18; font-size: 12.5px; font-weight: 600; }
    .etirow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0; font-size: 12.5px; }
    .etirow input { width: 52px; padding: 3px 6px; border: 1px solid #C6D4E4; border-radius: 6px; font: inherit; }
    .etirow .mini.on { background: var(--azione); color: #fff; border-color: var(--azione); }
    .etiaz { display: flex; gap: 8px; margin-top: 8px; }
    .consr { padding: 6px 2px; border-bottom: 1px solid #EDF1F6; font-size: 12.5px; line-height: 1.45; color: #35506B; overflow-wrap: anywhere; }
    .consr b { color: var(--testo); }
    /* DA FARE. L'icona: le spunte tonde e quante voci sono aperte. Tranquilla;
       ambra 15 minuti prima di un promemoria; rossa quando è passato (solo
       allora un bagliore lento: il movimento vuol dire «è l'ora»). */
    .dfslot, .dfpslot { display: contents; }
    .dfic { position: relative; z-index: 1; flex: none; display: inline-flex; align-items: center; gap: 3px; height: 24px; min-width: 28px;
            padding: 0 7px 0 6px; border: 0; border-radius: 999px; background: #EEF2F6; color: #35506B; cursor: pointer;
            font: inherit; font-size: 12px; font-weight: 700; line-height: 24px; white-space: nowrap; font-variant-numeric: tabular-nums; align-self: center; }
    .dfic svg { width: 14px; height: 14px; flex: none; }
    .dfic b { font: inherit; letter-spacing: 0; }   /* (anche nell'intestazione, dove i <b> sono grandi) */
    .dfic:hover { background: #E3E9F0; color: var(--testo); }
    .dfic:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    .dfic.vuota { justify-content: center; padding: 0; width: 28px; background: none; color: var(--neutro); }
    .dfic.vuota:hover { background: #EEF2F6; color: var(--testo); }
    .dfic.amb { background: var(--att-f); color: var(--att); }
    .dfic.amb:hover { background: #FCEBC4; }
    .dfic.ros { background: var(--err-f); color: var(--err); }
    .dfic.ros.fresco { animation: prBagliore 2.6s ease-in-out infinite; }   /* si muove solo i primi 10 minuti: poi resta rosso, fermo */
    .dfic.ros:hover { background: #FADBD8; }
    @keyframes prBagliore { 0%, 100% { box-shadow: 0 0 0 0 rgba(179,38,30,0); } 50% { box-shadow: 0 0 0 4px rgba(179,38,30,.13); } }
    /* il post-it: la prima voce aperta, in grigio, che cede per prima */
    .dfpost { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; color: var(--neutro); }
    .dfpost b { font-weight: 600; color: #35506B; font-variant-numeric: tabular-nums; }
    /* nell'intestazione, accanto agli identificativi: il cuore e l'icona del Da fare, che dice
       anche la prima cosa da fare (poi «+N»). I pezzi stanno nella fila dell'intestazione: cede per
       primo il testo del Da fare (fino all'icona e «+N»), poi il cuore (fino al ♥); il nome mai. */
    .hdpaz { display: contents; }
    .hdpaz > :first-child { margin-left: 10px; }
    .hdpaz > * { flex: none; }
    .hdpaz > .cuore { flex: 0 1000 auto; min-width: 15px; overflow: hidden; white-space: nowrap; }
    /* il «Da fare» cede per primo, ma mai sotto la sua icona: sotto, scavalcherebbe il bottone accanto */
    .hdpaz > .dfslot { flex: 0 100000 auto; min-width: 28px; display: inline-flex; }
    .hdpaz > .dfslot > * { flex: none; }
    .hdpaz .dfic.dfprima { flex: 0 1 auto; min-width: 0; max-width: 24em; padding: 0 9px 0 7px; gap: 5px; overflow: hidden; }
    .dfict { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden; white-space: normal; min-width: 0;
             font-size: 12.5px; font-weight: 500; }
    /* se nemmeno la prima parola sta intera, niente parole mozzate: restano l'icona e il numero (dfAdatta) */
    .dfic.solo .dfict { display: none; }
    .dfict b { font-weight: 700; }
    .hdpaz .brac { position: relative; width: 28px; height: 28px; }
    .hdpaz .brac .bracn { position: absolute; right: -6px; top: -4px; background: var(--azione); color: #fff; border-radius: 999px; padding: 0 4px;
                          font-size: 11px; font-weight: 700; line-height: 15px; font-variant-numeric: tabular-nums; }
    .hdpaz .brac.pulsa { animation: bracPulsa .45s ease-out; }
    .hdpaz .brac .bracn.spenta { background: #9DB3C9; }
    @keyframes bracPulsa { 0% { transform: scale(1); } 40% { transform: scale(1.18); background: #E8F0FA; } 100% { transform: scale(1); } }
    /* IL CUORE dei parametri vitali: rosso o ambra, fermo. Un impulso solo, da
       un secondo, quando compare; vuoto («♡ 5h») se la riga ha più di 4 ore. */
    .cuore { flex: none; display: inline-block; font-size: 14px; line-height: 1; font-weight: 700; cursor: default; }
    .cuore.ros { color: var(--err); }
    .cuore.amb { color: var(--att); }
    .cuore.vecchio { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .cuorev { margin-left: 4px; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cuore.vecchio .cuorev { color: var(--neutro); }
    .cuore.pulsa { animation: cuorePulsa 1s ease-out 1; }
    @keyframes cuorePulsa { 0% { transform: scale(1); } 30% { transform: scale(1.35); } 100% { transform: scale(1); } }
    .pzchi .cuore, .stp2 .cuore { align-self: center; }
    @media (prefers-reduced-motion: reduce) { .cuore.pulsa, .dfic.ros.fresco { animation: none; } }
    /* la lista: una piccola finestra sotto l'icona */
    .dfpop { position: absolute; z-index: 30; width: 340px; max-width: calc(100vw - 16px); padding: 4px 6px 8px; border: 1px solid #D9E2EC;
             border-radius: 10px; background: #fff; box-shadow: 0 10px 28px rgba(9,42,74,.16); }
    .dfhd { padding: 6px 6px 4px; font-size: 12px; color: var(--neutro); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dfhd b { color: var(--testo); }
    .dfl { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow-y: auto; }
    .dfl:empty { display: none; }
    /* UNA RIGA, DAPPERTUTTO (la lista del paziente, il tabellone, la nota sotto la pill, la scheda al
       passaggio): ○ 11:42 testo… ✕ — una riga sola, le stesse misure; l'ora davanti, piccola, in
       grassetto, ambra e poi rossa come l'icona; ✕, la maniglia e +15′ solo al passaggio o col
       fuoco (al tocco, sempre). La ✕ non tiene posto finché non c'è: il testo ha la riga. */
    .dfi, .dfr { display: flex; align-items: center; gap: 7px; min-height: 28px; padding: 0 2px 0 0; border-radius: 6px; font-size: 13px; line-height: 20px; }
    .dfi { background: #fff; }
    .dfi.presa { position: relative; z-index: 2; box-shadow: 0 6px 18px rgba(9,42,74,.18); }
    .dfl.trascino, .dfl.trascino * { cursor: grabbing !important; }
    .dfgrip { flex: none; width: 12px; margin-right: -3px; text-align: center; color: var(--neutro); cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
              font-size: 12px; letter-spacing: -2px; line-height: 28px; }
    .dfgrip, .dfpiu { opacity: 0; }
    .dfi:hover :is(.dfgrip, .dfpiu), .dfi:focus-within :is(.dfgrip, .dfpiu) { opacity: 1; }
    @media (hover: hover) { .dfi:not(.fatto):not(:hover):not(:focus-within) .dfx { display: none; } }
    @media (hover: none) { .dfgrip, .dfpiu { opacity: 1; } }
    .dfck, .dfo { flex: none; position: relative; box-sizing: border-box; width: 18px; height: 18px; padding: 0; border: 1.6px solid #8296A9; border-radius: 50%; background: #fff; }
    .dfck { cursor: pointer; }
    .dfck::before { content: ""; position: absolute; inset: -6px; }
    .dfck:hover { border-color: var(--ok); }
    .dfck:focus-visible { outline: 2px solid var(--azione); outline-offset: 2px; }
    .dfi.fatto .dfck { border-color: var(--ok); background: var(--ok); }
    .dfi.fatto .dfck::after { content: ""; position: absolute; left: 4.6px; top: 1.2px; width: 4.5px; height: 8.5px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
    .dftx { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--testo); }
    .dftx:has(.dfmod) { overflow: visible; }
    .dfi.fatto .dftx { text-decoration: line-through; color: var(--neutro); }
    .dft { flex: none; color: #35506B; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .dft.amb { color: var(--att); }
    .dft.ros { color: var(--err); }
    .dfi.fatto .dft { color: var(--neutro); font-weight: 400; }
    .dfpiu { flex: none; height: 22px; border: 1px solid #D9E2EC; border-radius: 6px; background: #fff; padding: 0 6px; cursor: pointer;
             font-size: 11.5px; font-weight: 600; color: var(--testo); white-space: nowrap; }
    .dfpiu:hover { border-color: #9DBFDE; }
    .dfpiu:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    .dfadd { position: relative; margin-top: 6px; }
    .dfin { display: block; width: 100%; height: 32px; padding: 0 10px; border: 1px solid #D9E2EC; border-radius: 8px; background: #F8FBFE;
            font-size: 13px; color: var(--testo); }
    .dfin::placeholder { color: var(--neutro); }
    .dfin:focus { outline: 0; border-color: var(--azione); background: #fff; box-shadow: 0 0 0 3px rgba(11,92,173,.12); }
    .dfhint { display: block; padding: 4px 4px 0; font-size: 11.5px; line-height: 16px; color: #35506B; font-variant-numeric: tabular-nums; }
    .dfhint:empty { display: none; }
    .dfhint.ko { color: var(--err); }
    .dfsr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    /* ✕ cancella; un tocco sul testo lo modifica (la lista di un paziente e il Da fare del tabellone) */
    .dfx { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: none; cursor: pointer; font-size: 12px; color: var(--neutro); }
    .dfx:hover { background: var(--err-f); color: var(--err); }
    .dfx:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    [data-dfmod], [data-tdmod] { cursor: text; border-radius: 4px; }
    [data-dfmod]:hover, [data-tdmod]:hover { background: #F2F5F8; }
    [data-dfmod]:focus-visible, [data-tdmod]:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    .dfmod { display: block; width: 100%; min-width: 120px; height: 28px; padding: 0 8px; border: 1px solid var(--azione); border-radius: 6px; background: #fff;
             font: inherit; font-size: 13px; color: var(--testo); outline: 0; box-shadow: 0 0 0 3px rgba(11,92,173,.12); }
    /* le cose da fare di chi hai davanti, sempre in vista sotto la pill ridotta (aperta la
       finestra, le dice l'icona nell'intestazione): le righe di sempre, tre al più, poi «+N» */
    .dfnota { display: flex; flex-direction: column; align-items: stretch; margin: 0; padding: 2px 10px 2px 8px; border: 1px solid #EBD995; border-radius: 10px;
              background: #FFF8DE; color: var(--testo); cursor: pointer; text-align: left; font: inherit; box-shadow: 0 4px 12px rgba(9,42,74,.14); }
    .dfnota[hidden] { display: none; }
    .dfnota:hover { background: #FFF2C4; }
    .dfnota:focus-visible { outline: 2px solid var(--azione); outline-offset: 2px; }
    .dfnota .dfo { background: none; }
    .dfpiun { padding: 0 0 4px 25px; font-size: 11.5px; font-weight: 700; line-height: 16px; color: var(--neutro); }
    .dfnota .dfpiun { color: #7A6400; }
    .wrap:not(.win) > .dfnota { position: absolute; top: calc(100% + 6px); right: 0; width: max-content; min-width: 180px; max-width: 280px; }
    .wrap:not(.win) > .dfnota.sx { right: auto; left: 0; }
    .wrap:not(.win) > .dfnota.su { top: auto; bottom: calc(100% + 6px); }
    /* la scheda al passaggio: le cose da fare, le stesse righe */
    .pzcarta .pcd { margin-top: 4px; padding-top: 2px; border-top: 1px solid #EEF2F6; }
    /* IL DA FARE DEL TABELLONE: sopra le mappe, una colonna sola di cinque righe al più (poi
       scorre: le mappe non perdono altezza); accanto a loro solo quando lo spazio è largo davvero
       (la pagina del tabellone, uno schermo grande), così la finestra di sempre non toglie
       larghezza ai letti. Ridotto, non prende spazio. Prima le voci generali, poi i pazienti
       nell'ordine del tabellone: il cognome una volta, a sinistra, e sotto le sue voci. */
    .tdsec { container: tdsec / inline-size; }
    .tdriga { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
    .tdriga > .pzunita { min-width: 0; }
    .tdcard { flex: none; order: -1; display: flex; flex-direction: column; min-height: 0; max-height: 28%; border-bottom: 1px solid #E8EDF2; background: #FBFCFD; }
    .tdhd { flex: none; display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px 8px; }
    .tdtog { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px; border: 0; border-radius: 6px; background: none;
             cursor: pointer; font: inherit; font-size: 13px; color: var(--testo); white-space: nowrap; }
    .tdtog:hover { background: #EEF2F6; }
    .tdtog svg { width: 14px; height: 14px; flex: none; }
    .tdn { font-weight: 700; color: #35506B; font-variant-numeric: tabular-nums; }
    .tdin { flex: 1 1 auto; min-width: 0; width: auto; height: 30px; }
    .tdin.ko { border-color: var(--err); }
    .tdcorpo { flex: 1 1 auto; min-height: 0; max-height: calc(5.5 * 28px + 6px); overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 6px; scrollbar-width: thin; }
    .tdl { max-height: none; overflow: visible; }
    .tdi { background: none; }
    .tdchi { flex: none; align-self: flex-start; width: 78px; padding-top: 7px; font-size: 11.5px; font-weight: 800; line-height: 14px; letter-spacing: .02em;
             color: var(--testo); overflow-wrap: anywhere; }
    .tdg:not(:first-child), [data-tdl="gen"]:not(:empty) + .tdl > .tdg:first-child { border-top: 1px solid #EEF2F6; border-radius: 0; }
    .tdtogb { display: none; }
    /* sulla scheda del paziente: sotto le allergie, sopra le schede; le sue voci, senza la colonna del cognome */
    .tdcard.solo { order: 0; max-height: none; }
    .tdriga.tdtutto { flex-direction: column; overflow-y: auto; }
    .tdriga.tdtutto > .pzunita { flex: none; }
    .tdriga.tdtutto .tdcard { order: 0; flex: 1 1 auto; width: auto; max-height: none; border: 0; }
    .tdriga.tdtutto .tdcorpo { max-height: none; overflow: visible; }
    .tdtesta { display: flex; align-items: center; gap: 4px; width: auto; min-width: 78px; padding-top: 3px; }
    .tdapri { border: 0; background: none; padding: 4px 6px; border-radius: 6px; font: inherit; font-size: 11.5px; font-weight: 800; letter-spacing: .02em; color: inherit; cursor: pointer; text-align: left; }
    .tdapri:hover { background: #EEF2F6; }
    .tdposto { margin-left: 6px; font-size: 10.5px; font-weight: 700; color: var(--azione); background: #E8F1FB; border-radius: 5px; padding: 1px 6px; }
    .tdpiu { border: 0; background: none; color: var(--neutro); font-size: 15px; line-height: 1; padding: 2px 6px; border-radius: 6px; cursor: pointer; opacity: 0; }
    .tdg:hover .tdpiu, .tdpiu:focus-visible { opacity: 1; }
    .tdcard.solo .tdcorpo { max-height: calc(4.5 * 28px + 6px); }
    .tdcard.solo .tdchi { display: none; }
    /* stretta, ridotto: un bottone in fondo alla barra del tabellone, che non prende altezza */
    @container tdsec (max-width: 1179.98px) {
      .tdcard.chiusa { display: none; }
      .tdtogb { display: inline-flex; margin-left: auto; }
    }
    @container tdsec (min-width: 1180px) {
      .tdriga { flex-direction: row; }
      .tdcard { order: 0; width: 300px; max-height: none; border-bottom: 0; border-left: 1px solid #E8EDF2; }
      .tdcorpo { max-height: none; }
      .tdcard.chiusa { width: 42px; }
      .tdcard.chiusa .tdhd { justify-content: center; padding: 8px 4px; }
      .tdcard.chiusa .tdtog { writing-mode: vertical-rl; width: 32px; height: auto; padding: 10px 0; }
    }
    /* il menu minuscolo della sveglia sulla pill ridotta: ✓ Fatto, +15′, Apri */
    .prmenu { position: absolute; z-index: 30; width: max-content; min-width: 260px; max-width: min(360px, calc(100vw - 16px)); padding: 4px;
              border: 1px solid #D9E2EC; border-radius: 10px; background: #fff; box-shadow: 0 10px 28px rgba(9,42,74,.16); }
    .prmhd { padding: 6px 8px 4px; font-size: 12px; color: var(--neutro); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .prmrow { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 3px 4px 3px 8px; }
    .prmrow + .prmrow { border-top: 1px solid #EEF2F6; }
    .prmq { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; color: var(--testo); }
    .prmq b { font-weight: 600; font-variant-numeric: tabular-nums; }
    .prmb { flex: none; min-height: 28px; border: 1px solid #D9E2EC; border-radius: 6px; background: #fff; padding: 2px 9px; cursor: pointer;
            font-size: 12px; font-weight: 600; color: var(--testo); white-space: nowrap; }
    .prmb:hover { border-color: #9DBFDE; }
    .prmb.ok:hover { border-color: #BCE0C9; background: var(--ok-f); color: var(--ok); }
    .prmb:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    /* sulla pill ridotta, solo quando tocca */
    .pill .prurg { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px 1px 5px; border-radius: 999px; background: var(--err);
                   color: #fff; font-size: 11px; font-weight: 700; line-height: 16px; font-variant-numeric: tabular-nums; box-shadow: 0 0 0 1.5px #fff; }
    .pill .prurg svg { width: 12px; height: 12px; flex: none; }
    .pill .prurg { cursor: pointer; max-width: 260px; }
    .pill .prurg:hover { background: var(--err); }
    .pill .prurg:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .pill .prurgt { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .pill .prurgp { opacity: .85; }
    .prmini { min-width: 0; width: max-content; }
    .prmini .prmhd { padding: 6px 8px 2px; color: var(--testo); }
    .prmini .prmrow { min-height: 36px; padding: 2px 4px 4px 4px; gap: 6px; }
    .prmini .prmq { font-size: 12.5px; color: #35506B; }
    .crow { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; cursor: pointer;
            border: 1px solid #E3E8EF; border-radius: 9px; background: #fff; padding: 10px 11px; font: inherit; }
    .crow:hover { border-color: #9DBFDE; background: #F4F9FD; }
    .crow:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    .cnome { flex: 1 1 auto; font-size: 12.5px; font-weight: 600; color: var(--testo); }
    .cgo { flex: 0 0 auto; font-size: 11px; color: var(--azione); font-weight: 700; }
    .cpag { flex: 0 0 auto; font-size: 11px; color: var(--neutro); background: #EEF2F6; border-radius: 999px; padding: 1px 7px; font-weight: 700; }
    .linkbtn { border: 0; background: transparent; color: var(--azione); font: inherit; font-weight: 700;
               text-decoration: underline; cursor: pointer; padding: 0; }

    /* La tabella scorre dentro la sua cornice, non col pannello: solo così
       l'intestazione (sticky) resta sotto gli occhi con venti analiti. */
    .stwrap { overflow: auto; max-height: 60vh; overscroll-behavior: contain; border: 1px solid #E3E8EF; border-radius: 8px; }
    /* Fino a tre prelievi: un blocco per sezione (le ore in testa a ognuno),
       i blocchi uno accanto all'altro finché c'è posto. Niente cornice che
       scorre per conto suo: scorre il pannello, una volta. */
    .stwrap.stgriglia, .wulab .stwrap.stgriglia { overflow: visible; max-height: none; border: 0; border-radius: 0; width: auto; background: transparent; }
    .stgriglia { --blk: 230px; } .stgriglia.c2 { --blk: 270px; } .stgriglia.c3 { --blk: 330px; }
    .stgriglia .sttab { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--blk)), 1fr)); gap: 10px; align-items: start; width: 100%; }
    .stgriglia .sttab thead { display: none; }
    .stgriglia .sttab tbody.stblk { display: table; width: 100%; border-collapse: separate; border-spacing: 0; background: #fff;
      border: 1px solid #E3E8EF; border-radius: 8px; overflow: hidden; }
    .stgriglia .sttab tbody.stblk tr:last-child > * { border-bottom: 0; }
    .stgriglia .sttab tr.stsez td { text-transform: none; letter-spacing: 0; font-size: 11px; font-weight: 600; color: var(--neutro); }
    .stgriglia .sttab tr.stsez td.ultima { color: var(--azione); }
    .stgriglia .sttab tr.stsez td.ultima::after { content: "ultimo"; display: block; font-size: 11px; font-weight: 700;
      letter-spacing: .06em; text-transform: uppercase; color: #9DBFDE; }
    .stgriglia .sttab th.stn { position: static; }
    /* La tabella è larga quanto i suoi numeri, non quanto il pannello: se il
       medico allarga la finestra i valori restano accanto ai nomi invece di
       allontanarsene. Per lo stesso motivo i numeri sono allineati a
       sinistra, incolonnati dalle cifre tabulari. */
    .sttab { border-collapse: collapse; font-size: 11.5px; width: auto; }
    .sttab th, .sttab td { padding: 3px 7px; white-space: nowrap; border-bottom: 1px solid #EDF1F6; }
    .sttab thead th { position: sticky; top: 0; background: #F8FBFE; color: var(--neutro); font-weight: 600;
                      font-size: 11px; text-align: left; border-bottom: 1px solid #D9E2EC; }
    .sttab .sth { display: block; font-size: 11px; color: var(--neutro); font-weight: 500; }
    .sttab th.stn { position: sticky; left: 0; z-index: 1; background: #fff; text-align: left;
                    font-weight: 600; color: var(--testo); max-width: 168px; overflow: hidden; text-overflow: ellipsis; }
    .sttab thead th.stn { background: #F8FBFE; z-index: 2; }
    .sttab td { text-align: left; color: #35506B; font-variant-numeric: tabular-nums; }
    .sttab td.fuori { color: var(--err); font-weight: 800; }
    .sttab td.parz { font-style: italic; }   /* parziale: in corsivo, niente puntini */
    /* Novelty rides a different channel: a tint behind the number. Text
       colour is untouched, so red keeps meaning "out of range". */
    .sttab td.nuovo, .sttab td.agg, .sttab tbody tr:hover td.nuovo, .sttab tbody tr:hover td.agg {
      background: #DCEAF9; box-shadow: inset 0 -2px 0 var(--azione); }
    /* I segni del medico: un tocco giallo, due arancio, tre via. Stanno DOPO
       la novità perché il segno vince sullo sfondo azzurro; la riga blu sotto
       il numero (box-shadow) resta e continua a dire «nuovo». */
    .sttab td[data-cella] { cursor: pointer; user-select: none; }   /* due tocchi non devono selezionare il numero */
    /* Il segno è una pastiglia stretta attorno al numero (freccia e segno
       compresi), non tutta la cella: il margine negativo compensa il padding,
       così il numero non si sposta quando la pastiglia compare. */
    .sttab td .val { display: inline-block; border-radius: 999px; padding: 0 5px; margin: 0 -5px; }
    .sttab td .pct { font-weight: 500; color: var(--neutro); font-style: normal; }
    .sttab td.marca1 .val { background: #FFE58A; }
    .sttab td.marca2 .val { background: #FFC46B; }
    .sttab tbody tr:hover td, .sttab tbody tr:hover th.stn { background: #F4F9FD; }
    /* Sezioni: gli esami stanno dove un medico li cerca, e sempre nello stesso
       posto. L'ordine non dipende più da come il laboratorio ha stampato. */
    .sttab tr.stsez th.stn, .sttab tr.stsez td { background: #EEF4FA; border-bottom: 1px solid #D9E4EF;
      font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--neutro); }
    .sttab tr.stsez th.stn { color: #35506B; padding-top: 7px; padding-bottom: 4px; }
    .sttab tr.stsez td { text-align: left; padding-top: 7px; padding-bottom: 4px; }
    .sttab tr.stsez:hover th.stn, .sttab tr.stsez:hover td { background: #EEF4FA; }
    /* una cella senza valore si deve VEDERE che è vuota, o una riga con due
       soli prelievi sembra una riga piena */
    .sttab td.vuoto { color: #AEBECD; }
    /* L'unità sta ACCANTO al nome, fra parentesi: su un rigo suo raddoppiava
       l'altezza di ogni riga e allontanava i numeri dal nome. */
    .stum { font-size: 11px; color: var(--neutro); font-weight: 500; letter-spacing: 0; }
    .sttab th.ultima { color: var(--azione); }
    .sttab th.ultima::after { content: "ultimo"; display: block; font-size: 11px; font-weight: 700;
      letter-spacing: .06em; text-transform: uppercase; color: #9DBFDE; }
    /* il segno di provenienza: piccolo, in alto, mai confondibile con un valore */
    .sttab .prov { font-style: normal; font-size: 11px; vertical-align: super; color: var(--azione);
                   font-weight: 800; margin-left: 1px; cursor: help; }
    .reftxt { font-size: 12.5px; line-height: 1.5; color: var(--testo); }
    .reftxt .rt { padding: 1px 0; }
    .reftxt .rt:empty { display: none; }
    .newbar { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--azione);
              background: var(--info-f); border: 1px solid #9DBFDE; border-radius: 8px; padding: 5px 9px; margin-bottom: 6px; }
    .newbar button { margin-left: auto; border: 0; background: transparent; color: var(--azione); font: inherit; font-weight: 700; cursor: pointer; }
    .foot { flex: 0 0 auto; padding: 8px 14px 10px; border-top: 1px solid #EEF2F6; display: flex; justify-content: space-between; align-items: center; color: var(--neutro); font-size: 11px; }
    .footlink { border: 0; background: transparent; color: var(--azione); font-size: 11px; cursor: pointer; padding: 0; text-decoration: underline; }
    select.res { width: 100%; border: 1px solid #C4D0DC; border-radius: 8px; padding: 7px 8px; font-size: 12.5px; background: #fff; }
    @keyframes psaSpin { to { transform: rotate(360deg); } }
    @keyframes psaPulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
    @keyframes psaDrain { from { width: 100%; } to { width: 0; } }
    @media (prefers-reduced-motion: reduce) { .step.running .ic, .pill .dot { animation: none; } }

    /* ---- Stanza ---- */
    /* stanza svuotata apposta: due parole e il modo di ridisegnarla */
    .stvuota { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
               pointer-events: none; color: var(--neutro); font-size: 13px; }
    .stvuota b { font-size: 14px; font-weight: 600; color: var(--testo); }
    .stvuota button { pointer-events: auto; }
    .stlink { border: 0; background: none; padding: 0; cursor: pointer; font-size: 12px; color: var(--neutro); text-decoration: underline; }
    /* nella finestra i Pazienti riempiono tutto il corpo che resta, da bordo a bordo */
    .card.stanza .bdi { height: 100%; display: flex; flex-direction: column; padding: 0; }
    .card.stanza .bdi > .sec { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; margin-bottom: 0; }
    .card.stanza .bdi > .banner, .card.stanza .bdi > .reg { flex: none; margin: 10px 14px; }
    /* ⋯ → iPhone: la cornice prende tutto il corpo che resta (la pagina dentro scorre da sé) */
    .card.iphone .bdi { height: 100%; display: flex; flex-direction: column; padding: 0; }
    .card.iphone .bdi > * { flex: none; }
    .card.iphone .bdi > .banner, .card.iphone .bdi > .reg { margin: 10px 24px 0; }
    .card.iphone .bdi > .ponteslot { flex: 1 1 auto; min-height: 220px; }
    .card.iphone .bdi > .ponteno { padding: 14px 24px; max-width: 520px; }
    .ponteslot iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
    /* I Pazienti: sopra la lista, sotto la stanza. Due grigi per il testo;
       l'azzurro solo per il paziente di questa pagina, per il fuoco e per
       l'azione che conta; il colore solo per il triage, in una striscia. */
    .t-rosso { --tr: #C62828; } .t-arancione { --tr: #EF6C00; } .t-azzurro { --tr: #1E88E5; }
    .t-verde { --tr: #2E7D32; } .t-bianco { --tr: #B0BEC5; }
    /* in Modifica, in fondo alla fila delle schede: + Letto, + Sedia, + Area,
       Fine. Mai a capo; e la fila è alta uguale con e senza */
    .stazioni { display: inline-flex; flex: none; flex-wrap: nowrap; align-items: center; gap: 6px; height: 32px; margin-left: auto; white-space: nowrap; }
    .seg > .segdx:empty { min-height: 44px; }
    .stbtn, .stazioni .stbtn { border: 1px solid #D9E2EC; border-radius: 8px; background: #fff; padding: 3px 12px; cursor: pointer;
             font-size: 13px; font-weight: 600; line-height: 20px; color: var(--testo); white-space: nowrap; }
    .stbtn:hover, .stazioni .stbtn:hover { border-color: #9DBFDE; background: #fff; color: var(--testo); }
    .stbtn.pri, .stazioni .stbtn.pri { background: var(--azione); border-color: var(--azione); color: #fff; }
    .stbtn.pri:hover, .stazioni .stbtn.pri:hover { background: #094a8c; border-color: #094a8c; color: #fff; }
    .stazioni button:focus-visible, .stbtn:focus-visible, .stctl:focus-visible, .stp:focus-visible, .stname:focus-visible,
    .pzrow:has(.pzapri:focus-visible), .pzmetti:focus-visible, .pzx:focus-visible, .pzarchhd:focus-visible,
    .pzabtn:focus-visible, .pzfx:focus-visible, .stannulla:focus-visible { outline: 2px solid var(--azione); outline-offset: 1px; }
    /* quello che dicono tutti e due: da quanto non lo apri, «questa pagina», i segni */
    .stvisto { flex: none; font-size: 12px; color: var(--neutro); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .stvisto.amb { padding: 0 7px; border-radius: 999px; background: var(--att-f); color: var(--att); }
    /* lo stato degli esami: un pezzetto per tipo, Lab · ECG · RX, tinto col colore
       della sua sezione negli Esiti. L'ambra e il rosso solo sul tempo che aspetta. */
    .esst { flex: none; font-size: 12px; color: #35506B; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .esp { --c: var(--neutro); display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px; border-radius: 6px;
           background: color-mix(in srgb, var(--c) 9%, #fff); line-height: 1; white-space: nowrap; }
    .es-lab { --c: var(--wu-lab); } .es-ecg { --c: var(--wu-ecg); } .es-img { --c: var(--wu-img); }
    .esp .esn { font-weight: 700; color: var(--c); }
    .esst .esatt { font-style: normal; }
    .esst .esatt.amb { margin: 0 -3px; padding: 2px 4px; border-radius: 4px; background: #FFEFC7; color: var(--att); font-weight: 600; }
    .esst .esatt.ros { margin: 0 -3px; padding: 2px 4px; border-radius: 4px; background: #FBE1DF; color: var(--err); font-weight: 700; }
    .esst .esdot { font-size: 11px; color: var(--azione); }
    .esst .esdot.ros { color: var(--err); }
    .esst.vecchio .esp { --c: var(--neutro); color: var(--neutro); }
    .esst.vecchio .esdot { color: var(--neutro); }
    .esst.vecchio .esatt.amb, .esst.vecchio .esatt.ros { background: none; color: inherit; font-weight: 400; }
    .stp2 .esst { display: inline-flex; flex: 0 1 auto; flex-wrap: wrap; gap: 3px; font-size: 11.5px; min-width: 0; }
    .stp2 .esp { height: 18px; padding: 0 5px; }
    /* sotto il nome: le allergie e l'Attenzione del gestionale, parola per parola */
    /* una riga sola: un testo lungo finisce coi puntini, e intero nel passaggio del mouse */
    .idriga { flex: none; display: flex; gap: 14px; padding: 0 20px 8px; background: #fff; font-size: 12.5px; line-height: 1.35; min-width: 0; }
    .idriga > span { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .idriga > .idall { flex-shrink: 0; max-width: 60%; }
    .idall.ros { color: var(--err); font-weight: 600; }
    .idall.nl { color: var(--att); }
    .idall.nega, .idall.nc { color: var(--neutro); }
    /* nome, episodio e allergie sono un solo blocco: la riga di separazione sta sotto le allergie */
    .hd:has(+ .idriga) { border-bottom: 0; }
    .hd + .idriga { border-bottom: 1px solid #E6EBF0; padding-bottom: 8px; }
    .idatt { color: var(--att); }
    /* Dimissioni: quello che è ancora aperto, una riga */
    .aperti { max-width: 820px; margin: 0 0 12px; font-size: 12.5px; line-height: 1.45; color: #35506B; }
    .aperti b { font-weight: 600; color: var(--testo); }
    .aperti .apl { color: #8494A3; }
    /* Richieste: quando è già stato fatto, in grigio accanto al nome */
    .opt .ult { flex: none; margin-left: auto; padding-left: 4px; font-size: 11px; font-weight: 400; color: #8494A3; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .opt .ult.vecchio { color: #A9B5C1; }
    .stqui { flex: none; font-size: 12px; font-weight: 600; color: var(--azione); white-space: nowrap; }
    .sttag { flex: none; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--neutro); white-space: nowrap; }
    .stom { flex: none; margin-right: 5px; font-weight: 400; color: var(--att); }
    .stcoda { font-weight: 400; color: var(--neutro); white-space: nowrap; }
    .stn { margin-left: 6px; font-size: 12px; font-weight: 400; color: var(--neutro); font-variant-numeric: tabular-nums; letter-spacing: 0; }
    .stsr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }   /* solo per chi legge con la voce */

    /* PAZIENTI, una vista sola: sopra la lista di chi non ha ancora un posto,
       sotto la stanza. La lista prende quello che le serve — al massimo poco
       meno di metà, poi scorre dentro — e la stanza il resto: man mano che la
       lista si accorcia, la stanza sale e cresce. Vuota, la lista non c'è. */
    .pzunita { position: relative; flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0;
               user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
    .pzunita input { user-select: text; -webkit-user-select: text; }
    .pzcoda { flex: 0 1 auto; max-height: 45%; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
              padding: 2px max(14px, calc(100% - 1054px)) 6px 14px; border-top: 1px solid #E8EDF2; container: pzlista / inline-size; transition: background-color .12s;
              /* LE COLONNE, uguali per tutte le righe: nome ed età, il posto, da quanto
                 è in PS, il cuore, Lab, ECG, RX, «Da fare», ▾, ✕. Una colonna che
                 nessuno usa non occupa niente. */
              display: grid; align-content: start;
              grid-template-columns: [tri] auto [nm] minmax(0, max-content) [posto] auto [inps] auto [cuore] auto [lab] auto [ecg] auto [img] auto [df] auto
                                     [post] minmax(0, 1fr) [metti] auto [x] auto; }
    .pzcoda > .pzvuoto { grid-column: 1 / -1; }
    /* le aree: un filo e il titolo; un tocco apre la sua lista */
    .pzcoda > .pzsez { grid-column: 1 / -1; padding: 8px 0 2px; border-top: 1px solid #D9E2EC; }
    .pzcoda > .pzfnone + .pzsez { border-top: 0; }
    .pzsezt { border: 0; background: none; padding: 2px 0; font: inherit; font-size: 12px; font-weight: 600; color: var(--neutro); cursor: pointer; }
    .pzsezt:hover { color: var(--azione); }
    .pzunita.filtra .pzsez { display: none; }
    .pzcoda.over { background: #F1F6FC; }
    /* LISTA: righe da 44px separate da un filo, niente riquadri. Il nome non si
       taglia mai per primo: prima cede la nota */
    .pzarch { max-width: 1040px; }
    .pzrow { position: relative; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 6px 0 10px;
             border-bottom: 1px solid #EEF2F6; color: var(--testo); }
    .pzcoda > .pzrow { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; gap: 0; justify-items: start; }
    .pzcoda > .pzrow > *, .pzcoda .pzchi > *, .pzcoda .pzchi > .esst > * { grid-row: 1; }
    .pzcoda .pzchi, .pzcoda .pzchi > .esst { display: contents; }
    .pzcoda .pztr { grid-column: tri; }
    .pzcoda .pzapri { grid-column: nm; justify-self: stretch; max-width: 240px; margin-left: 10px; }
    .pzcoda .pzposto { grid-column: posto; align-self: center; margin-left: 10px; padding: 1px 8px; border-radius: 999px; background: #E9EFF5;
                       font-size: 12px; font-weight: 600; line-height: 18px; color: #35506B; white-space: nowrap; }
    /* Lista: niente mappe, la lista prende tutto lo spazio */
    .pzunita.lista > .pzcoda { flex: 1 1 0; max-height: none; border-top: 0; }
    .pzunita.lista:not(.edit) .pzrow[data-riga], .pzunita.lista:not(.edit) .pzrow[data-riga] .pzapri { cursor: pointer; }
    .pzcoda .pzinps { grid-column: inps; margin-left: 10px; font-size: 12px; color: var(--neutro); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .pzcoda .pzchi > .cuore { grid-column: cuore; margin-left: 10px; }
    .pzcoda .pzchi > .sttag { grid-column: cuore / post; margin-left: 10px; }
    .pzcoda .esm.es-lab { grid-column: lab; margin-left: 10px; }
    .pzcoda .esm.es-ecg { grid-column: ecg; margin-left: 4px; }
    .pzcoda .esm.es-img { grid-column: img; margin-left: 4px; }
    .pzcoda .dfslot { display: block; grid-column: df; margin-left: 10px; }
    .pzeta { font-weight: 400; color: var(--neutro); font-variant-numeric: tabular-nums; }
    /* Lab · ECG · RX: grigio in attesa (col tempo), arancio in parte, blu tutto tornato */
    .esm { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px; border-radius: 6px; font-size: 12px;
           white-space: nowrap; font-variant-numeric: tabular-nums; border: 1px solid transparent; }
    .esm b { font-weight: 700; }
    .esm.att { background: #EEF2F6; color: var(--neutro); }
    .esm.parz { background: var(--att-f); color: var(--att); border-color: #E5C588; }
    .esm.ok { background: var(--ok-f); color: var(--ok); border-color: #BCE0C9; }
    .t-ignoto { --tr: #9AA8B5; }
    /* la riga e il letto dello stesso paziente, insieme */
    .pzrow.lega { background: #EEF5FC; }
    .stbed.lega, .starbody .stp.lega { box-shadow: 0 0 0 2px #6F9FD0; }
    /* la scheda al passaggio: solo da leggere, il mouse passa attraverso */
    .pzcarta { position: absolute; z-index: 28; max-width: 340px; padding: 8px 12px; border: 1px solid #D9E2EC; border-radius: 10px; background: #fff;
               box-shadow: 0 10px 28px rgba(9,42,74,.16); font-size: 12.5px; line-height: 1.45; color: var(--testo); pointer-events: none; }
    .pzcarta .pc { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 4px; }
    .pzcarta .pc1 { align-items: center; gap: 6px; font-size: 13px; }
    .pzcarta .pcatt { color: var(--att); font-weight: 600; }
    .pzcarta .pc1 .pztr { height: 16px; }
    .pzcarta .pcl span { margin-right: 6px; white-space: nowrap; }
    .pzcarta q { quotes: "«" "»"; color: #35506B; }
    .pzcarta .cuore { font-size: 13px; }
    .pzcoda .pzmetti { grid-column: metti; margin-left: 6px; }
    .pzcoda .pzx { grid-column: x; margin-left: 2px; }
    .pzcoda > .pzrow:last-child { border-bottom-color: transparent; }
    .pzunita:not(.edit) .pzrow[data-riga], .pzunita:not(.edit) .pzrow[data-riga] .pzapri { cursor: grab; }
    .pzrow[data-riga] { touch-action: pan-y; }
    .pzrow.via { opacity: .3; }
    /* chi è: il nome (che apre), il promemoria accanto, la nota che cede per prima */
    .pzchi { flex: 1 1 auto; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
    .pzapri { flex: 0 1 auto; min-width: 0; display: flex; align-items: baseline; padding: 0; border: 0; background: none;
              color: inherit; text-align: left; cursor: pointer; }
    .pzapri::after { content: ""; position: absolute; inset: 0; }   /* tutta la riga */
    .pzapri:focus-visible { outline: none; }
    .pzrow:has(.pzapri:focus-visible) { outline-offset: -2px; }
    .pzrow:hover { background: #F7F9FB; }
    .pzrow.qui { background: #F4F8FC; box-shadow: inset 3px 0 0 var(--azione); }
    .pzrow.prec { opacity: .55; }
    .pztr { flex: none; width: 4px; height: 22px; border-radius: 2px; background: var(--tr, transparent); }
    .pznm { flex: none; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
            font-size: 14px; font-weight: 600; }
    /* l'icona «Da fare» vuota, come la ✕: compare passandoci sopra */
    .pzrow:not(:hover):not(:focus-within) .dfic.vuota { opacity: 0; }
    /* ▾: metterlo nella stanza senza trascinare. Sempre lì, quieto; il bordo
       sulla riga sotto il mouse */
    .pzmetti { position: relative; z-index: 1; flex: none; display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0;
               border: 1px solid transparent; border-radius: 6px; background: none; cursor: pointer; color: var(--neutro); }
    .pzrow:hover .pzmetti, .pzrow:focus-within .pzmetti { border-color: #E3E8EF; background: #fff; color: #35506B; }
    .pzrow .pzmetti:hover { border-color: #9DBFDE; color: var(--azione); }
    .pzx { position: relative; z-index: 1; flex: none; width: 28px; height: 28px; border: 0; border-radius: 6px; background: none; cursor: pointer;
           font-size: 13px; color: var(--neutro); opacity: 0; }
    .pzrow:hover .pzx, .pzrow:focus-within .pzx { opacity: 1; }
    .pzx:hover { background: var(--err-f); color: var(--err); }
    /* colonna stretta: il nome da solo sulla prima riga, sotto il promemoria e
       la nota; «visto…» e «questa pagina» li dice solo la voce (la riga di
       questa pagina è già azzurra) */
    @container pzlista (max-width: 720px) {
      .pzcoda > .pzrow { padding-top: 3px; padding-bottom: 3px; row-gap: 1px; }
      .pzcoda .pzchi > .pzapri { line-height: 20px; }
      .pzcoda .esp { height: 20px; }
      .pzcoda .pzchi > .dfslot .dfic { height: 20px; line-height: 20px; }
      .pzcoda .pzchi > *, .pzcoda .pzchi > .esst > * { grid-row: 2; }
      .pzcoda .pzchi > .pzapri { grid-row: 1; grid-column: nm / metti; max-width: none; }
      .pzcoda .pzchi > .pzposto { grid-column: nm; margin-left: 10px; }
      .pzcoda .pzchi > .pzinps { grid-column: posto / cuore; margin-left: 10px; }
      .pzcoda .esm { height: 20px; }
      /* l'icona vuota (compare passandoci sopra) sale accanto al ▾: chi non ha altro resta su una riga */
      .pzcoda .pzchi > .dfslot:has(.dfic.vuota) { grid-row: 1; grid-column: post; justify-self: end; }
      .pzcoda .pztr, .pzcoda .pzmetti, .pzcoda .pzx { grid-row: 1 / 3; }
      .pzrow .stvisto, .pzrow .stqui { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    }
    .pzvuoto { padding: 14px 24px; font-size: 13px; color: var(--neutro); }
    .pzcoda > .pzvuoto { padding: 12px 10px; }
    /* il filtro: compare scrivendo una lettera, Esc lo toglie */
    .pzfiltro { flex: none; display: flex; align-items: center; gap: 8px; height: 36px; margin: 8px 14px 2px; padding: 0 4px 0 10px;
                border: 1px solid transparent; border-radius: 8px; background: #F2F5F8; color: var(--neutro); max-width: 1040px; }
    .pzfiltro:focus-within { border-color: var(--azione); background: #fff; box-shadow: 0 0 0 3px rgba(11,92,173,.12); }
    .pzfiltro svg { flex: none; }
    .pzfiltro input { flex: 1 1 auto; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; background: none; font-size: 14px; color: var(--testo); }
    .pzfiltro input::placeholder { color: var(--neutro); }
    .pzfx { position: relative; flex: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: none; cursor: pointer;
            font-size: 12px; color: var(--neutro); }
    .pzfx:hover { background: #E3E9F0; color: var(--testo); }
    .pzunita.filtra .pzrow.nofiltro { display: none; }
    .pzunita.filtra .starbody .stp.nofiltro, .pzunita.filtra .stbed.nofiltro { opacity: .25; }
    /* portando un paziente dalla stanza: in cima, «Rimetti in lista» (anche a lista vuota) */
    .pzrimetti { position: absolute; left: 12px; right: 12px; bottom: 6px; z-index: 6; display: flex; align-items: center; justify-content: center; gap: 8px;
                 height: 44px; border: 1.5px dashed #6F9FD0; border-radius: 10px; background: rgba(241,246,252,.97); color: var(--azione);
                 font-size: 13px; font-weight: 600; box-shadow: 0 6px 18px rgba(9,42,74,.10); visibility: hidden; opacity: 0; transition: opacity .12s; }
    .pzunita.dastanza .pzrimetti { visibility: visible; opacity: 1; }
    /* senza lista la striscia starebbe sopra i letti in cima: la stanza tiene sempre
       libera quella fascia, così mentre si trascina niente si sposta e niente si copre */
    .pzunita:not(.edit):not(:has(> .pzcoda)) > .stmappe > .stmappei { bottom: 50px; }
    .pzrimetti.over { border: 1.5px solid var(--azione); background: #E2EEFA; }
    /* in fondo, chiusi: gli archiviati e «Svuota l'elenco», sul grigio della stanza */
    .pzpiede { flex: 0 1 auto; max-height: 40%; overflow-y: auto; padding: 0 14px 4px; background: #F7F9FB; scrollbar-width: thin; }
    .pzarchhd { display: inline-flex; align-items: center; gap: 6px; padding: 6px 4px; border: 0; background: none; cursor: pointer;
                font-size: 13px; font-weight: 600; color: var(--neutro); }
    .pzarchhd:hover { color: var(--testo); }
    .pzarchhd .stn { margin-left: 0; }
    .pzarch { padding-bottom: 8px; }
    .pzarow { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 6px 0 10px; border-bottom: 1px solid #EEF2F6; }
    .pzanm { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; color: var(--neutro); }
    .pzameta { flex: none; font-size: 12px; color: var(--neutro); }
    .pzabtn { position: relative; flex: none; min-height: 28px; border: 1px solid #D9E2EC; border-radius: 6px; background: #fff; padding: 2px 8px;
              cursor: pointer; font-size: 12px; color: var(--testo); }
    .pzabtn:hover { border-color: #9DBFDE; }
    .pzhint { padding: 8px 10px 0; font-size: 12px; color: var(--neutro); }

    /* STANZA: tutto lo spazio che la lista lascia */
    /* TABELLONE: Alta | Bassa | Entrambe, e ⟳ */
    .tbbar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 6px 14px; border-bottom: 1px solid #E8EDF2; }
    .tbseg { display: inline-flex; padding: 2px; border-radius: 8px; background: #EEF2F6; }
    .tbseg button { min-height: 28px; padding: 0 12px; border: 0; border-radius: 6px; background: none; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--neutro); }
    .tbseg button:hover { color: var(--testo); }
    .tbseg button.on { background: #fff; color: var(--azione); box-shadow: 0 1px 2px rgba(9,42,74,.12); }
    .tbsync { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 6px; background: none; cursor: pointer; font-size: 16px; color: var(--neutro); }
    .tbsync[aria-pressed="true"] { color: var(--azione); }
    .tbsync:hover { background: #EEF2F6; color: var(--azione); }
    .tbsync.gira { animation: tbGira 1s linear infinite; color: var(--azione); }
    @keyframes tbGira { to { transform: rotate(360deg); } }
    /* le mappe: una, o due — affiancate se lo spazio è largo, se no una sopra l'altra */
    .stmappe { position: relative; flex: 1 1 0; min-height: 120px; container: stmappe / size; }
    .stmappei { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-auto-rows: minmax(0, 1fr); }
    .stmappei.due > .stmap + .stmap { border-top: 1px solid #E8EDF2; }
    @container stmappe (min-aspect-ratio: 9 / 5) {
      .stmappei.due { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .stmappei.due > .stmap + .stmap { border-top: 0; border-left: 1px solid #E8EDF2; }
    }
    .stmap { position: relative; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: #F7F9FB; }
    /* La pianta: celle tutte uguali (--u), le più grandi che ci stanno, fra 20 e
       44px. Tutto si misura in celle: allargando o stringendo la finestra la
       stanza cresce o cala tutta insieme e niente si sovrappone; se non ci sta
       nemmeno a 20px (un nome non si leggerebbe più), scorre. In alto, subito
       sotto la lista: accorciandosi la lista, la stanza sale. */
    .stcanvas { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; container-type: size;
                display: grid; place-items: start center; }
    .stcanvas.dx { --sf: linear-gradient(to left, transparent, #000 40px); }
    .stcanvas.sx { --sf: linear-gradient(to right, transparent, #000 40px); }
    .stcanvas.sx.dx { --sf: linear-gradient(to right, transparent, #000 40px, #000 calc(100% - 40px), transparent); }
    .stcanvas.sx, .stcanvas.dx { -webkit-mask-image: var(--sf); mask-image: var(--sf); }
    .stplan { position: relative; --u: min(44px, 100cqw / var(--cols), 100cqh / var(--rows));
              width: calc(var(--cols) * var(--u)); height: calc(var(--rows) * var(--u)); }
    /* in Modifica la pianta intera, coi puntini agli angoli delle celle (e un
       margine per la × degli oggetti sul bordo) */
    .stmap.edit .stcanvas { padding: 12px; }
    .stmap.edit .stplan { background-image: radial-gradient(circle, #C4D0DC 1px, transparent 1.5px);
                          background-size: var(--u) var(--u); background-position: calc(var(--u) / -2) calc(var(--u) / -2); }
    /* ogni oggetto sulle sue celle, con un filo d'aria: due letti vicini non si toccano */
    .stbed, .starea { position: absolute; left: calc(var(--c) * var(--u) + 3px); top: calc(var(--r) * var(--u) + 3px);
                      width: calc(var(--w) * var(--u) - 6px); height: calc(var(--h) * var(--u) - 6px); }
    .sthd { display: flex; align-items: baseline; min-width: 0; }
    .stname { min-width: 0; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .stmap.edit .stname { cursor: text; border-radius: 4px; }
    .stmap.edit .stname:hover { background: #EEF2F6; box-shadow: 0 0 0 3px #EEF2F6; color: var(--testo); }
    /* il paziente: il nome; sotto, «questa pagina» e la nota */
    .stp { position: relative; display: flex; flex-direction: column; gap: 1px; min-width: 0; max-width: 100%; padding: 6px 10px 6px 14px;
           border: 1px solid #D9E2EC; border-radius: 8px; background: #fff; cursor: grab; touch-action: none; transition: border-color .12s; }
    /* il triage: la stessa striscia dappertutto, dentro il bordo (nel letto la porta il letto) */
    .stp.tri::before, .stbed.tri::before { content: ""; position: absolute; left: 4px; top: 8px; bottom: 8px; width: 4px; border-radius: 2px; background: var(--tr); }
    .stp:hover { border-color: #9DBFDE; }
    .stp.qui { border-color: var(--azione); }
    .stp1 { display: flex; align-items: baseline; min-width: 0; }
    .stpn { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; font-weight: 600; line-height: 18px; color: var(--testo); }
    .stp2 { display: flex; align-items: baseline; gap: 6px; min-width: 0; line-height: 16px; }
    .stp2 .dfpost { flex: 0 1 auto; }
    /* nel letto e nell'area l'icona c'è solo con qualcosa da fare (il menu ha «Da fare…») */
    .stmap .dfic { height: 20px; line-height: 20px; font-size: 11px; padding: 0 6px 0 5px; }
    .stmap .dfic svg { width: 12px; height: 12px; }
    .stmap .dfic.vuota, .stmap.edit .dfic { display: none; }
    .stp1 .dfslot .dfic { margin-left: 6px; }
    .stp1:has(.dfic:not(.vuota)) .stpn { flex: 1 1 auto; }
    .stp.spento { opacity: .55; }
    .stp.prec { cursor: pointer; }
    .stp.via { opacity: .3; }
    /* quello che si porta: il nome e basta, accanto al puntatore, mai sopra quello che si mira */
    .stghost { position: absolute; left: 0; top: 0; z-index: 20; max-width: 220px; padding: 3px 10px; border: 1px solid #9DBFDE; border-radius: 6px;
               background: #fff; box-shadow: 0 8px 20px rgba(9,42,74,.18); font-size: 13px; font-weight: 600; line-height: 18px; color: var(--testo);
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
    .pzunita.trascino, .pzunita.trascino *, .stmap.trascino, .stmap.trascino * { cursor: grabbing !important; }
    /* il letto: il suo nome, poi il paziente — il nome e l'età, e basta. Il
       cuore e il pallino in alto a destra, sulla riga del letto; il resto nel
       passaggio del mouse. Nel letto piccolo sparisce prima il nome del letto
       (e con lui i segni), mai quello del paziente. Vuoto, è più quieto. */
    .stbed { z-index: 1; container: stbed / size; border: 1px solid #E3E8EF; border-radius: 10px; background: transparent; transition: border-color .12s; }
    .stbed.occ { border-color: #C4D0DC; background: #fff; }
    .stbed.qui { border-color: var(--azione); box-shadow: 0 0 0 1px var(--azione); }
    .stbed.over { z-index: 4; outline: 2px dashed var(--azione); outline-offset: 3px; }
    .stmap:not(.edit) .stbed.occ { cursor: grab; touch-action: none; }
    .stbedin { position: absolute; inset: 6px 8px 6px 14px; display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow: hidden; }
    .stbed .stname { flex: none; font-size: 12px; font-weight: 400; line-height: 16px; color: var(--neutro); }
    .stbedhd { flex: none; display: flex; align-items: center; min-width: 0; }
    .stbedhd .stname { flex: 0 1 auto; min-width: 0; }
    /* il nome del letto va a capo fra le parole (due righe al massimo) e non finisce mai in «O…»: o ci sta, o sparisce */
    .stbed .stname { white-space: normal; overflow-wrap: normal; text-overflow: clip; max-height: 32px; }
    @container stbed (max-width: 110px) { .stbed.occ:not(.barella) .stname { font-size: 11px; line-height: 14px; } }
    @container stbed (max-width: 92px) { .stbed .stpn { font-size: 11px; } }
    @container stbed (max-width: 92px) { .stmap:not(.edit) .stbed.occ:not(.barella):has(.stsegni :is(.cuore, .stseg)) .stname { display: none; } }
    @container stbed (max-width: 60px) { .stmap:not(.edit) .stbed:not(.occ):not(.sedia) .stname { display: none; } }
    .stbed.occ .stbedhd { padding-right: 34px; }   /* il posto del cuore e del pallino */
    .stglifo { flex: none; margin: auto; }
    .stbed .stp { position: static; flex: 1 1 auto; min-height: 0; gap: 0; padding: 0; border: 0; border-radius: 0; background: none; }
    /* due righe al massimo, tagliate e basta: mai i puntini (l'età, se non ci sta, resta nel passaggio del mouse) */
    .stbed .stp1 { display: block; max-height: 36px; overflow: hidden; line-height: 18px; overflow-wrap: normal; }
    .stbed .stpn { display: inline; overflow: visible; white-space: normal; font-size: 13px; }
    .stbed .steta { font-size: 12px; font-weight: 400; color: var(--neutro); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .stbed .stsegni { position: absolute; top: 0; right: 0; height: 16px; display: flex; align-items: center; gap: 6px; }
    .stbed .stsegni .cuore { font-size: 13px; }
    .stsegslot { display: inline-flex; }
    /* il pallino: rosso, ambra, blu (nuovo), un cerchio grigio (qualcosa aspetta) */
    .stseg { display: block; width: 8px; height: 8px; border-radius: 50%; }
    .stseg.ros { background: var(--err); } .stseg.amb { background: #D08A00; } .stseg.nuovo { background: var(--azione); }
    .stseg.att { box-shadow: inset 0 0 0 1.5px #8296A9; }
    .stbed.occ:not(:has(.stsegni :is(.cuore, .stseg))) .stbedhd { padding-right: 0; }
    /* piccolo (le mappe stanno sempre nel loro spazio): via il nome del letto, il cuore e il pallino restano */
    @container stbed (max-height: 72px) {
      .stmap:not(.edit) .stbed.occ .stname, .stbed:not(.sedia) .stglifo { display: none; }
      .stmap:not(.edit) .stbed.occ:has(.stsegni :is(.cuore, .stseg)) .stp1::before { content: ""; float: right; width: 24px; height: 14px; }
      .stmap:not(.edit) .stbed.occ .stp1 { max-height: 48px; line-height: 16px; }
      .stbed .stsegni { gap: 4px; }
      .stmap.edit .stbed .stp { display: none; }   /* in Modifica conta il nome del letto */
    }
    /* la sedia: un letto più piccolo, il suo glifo ci sta sempre */
    .stbed.sedia { border-radius: 8px; }
    .stbed.sedia .stbedin { inset: 5px 6px 5px 12px; }
    /* il box: il letto nella sua stanza — la cornice è il muro, il letto dentro */
    .stbed.box { border: 2px solid #C4D0DC; border-radius: 4px; }
    .stbed.box::after { content: ""; position: absolute; inset: 30px 12px 12px; border: 1px solid #E3E8EF; border-radius: 10px; pointer-events: none; }
    .stbed.box.occ::after { border-color: #C4D0DC; }
    .stbed.box .stbedin { inset: 6px 10px 12px 14px; }
    .stbed.box.occ .stbedin > .stp { padding: 14px 4px 0 6px; }
    /* la barella dell'attesa: stretta, in piedi; il nome va a capo */
    .stbed.barella { border-radius: 8px; }
    .stbed.barella .stbedin { inset: 5px 5px 5px 10px; }
    .stbed.barella .stname { white-space: normal; overflow-wrap: normal; line-height: 14px; font-size: 11px; }
    .stfuori { position: absolute; left: 50%; bottom: -12px; z-index: 3; transform: translateX(-50%); padding: 2px 9px; border-radius: 999px;
               background: var(--testo); color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; }
    /* le aree: senza letto, dentro quanti pazienti servono */
    .starea { display: flex; flex-direction: column; border: 1.5px dashed #C4D0DC; border-radius: 12px; background: rgba(255,255,255,.6);
              transition: border-color .12s, background-color .12s; }
    .starea > .sthd { flex: none; padding: 8px 10px 6px; }
    .starea .stname { white-space: normal; overflow-wrap: normal; text-overflow: clip; line-height: 13px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--neutro); }
    .starea.over { border-color: var(--azione); background: var(--info-f); }
    .starbody { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 6px; padding: 0 8px 8px; }
    .starbody .stp { max-width: 240px; }
    /* anche nell'area il nome va a capo invece di perdere le lettere (colonna stretta) */
    .starbody .stpn { white-space: normal; overflow-wrap: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    /* Modifica: i pazienti si fermano; l'oggetto scelto (o sotto il mouse) mostra la × e, l'area, l'angolo */
    .stmap.edit .stp { opacity: .4; pointer-events: none; }
    .stmap.edit .stbed, .stmap.edit .starea { cursor: move; touch-action: none; }
    .stmap.edit .stbed { background: #F7F9FB; }   /* i puntini non passano dentro il letto */
    .stmap.edit .stbed.occ { background: #fff; }
    .stbed.sel, .starea.sel { outline: 2px solid #9DBFDE; outline-offset: 3px; }
    .stbed.drag, .starea.drag { z-index: 5; background: #fff; box-shadow: 0 10px 24px rgba(9,42,74,.16); }
    /* sopra un altro non ci sta: rosso, e lasciato lì torna dov'era */
    .stbed.bad, .starea.bad { outline: 2px solid var(--err); outline-offset: 2px; }
    .stctl { position: absolute; z-index: 4; width: 24px; height: 24px; padding: 0; border: 1px solid #D9E2EC; border-radius: 50%;
             background: #fff; cursor: pointer; font-size: 13px; line-height: 22px; text-align: center; color: var(--testo);
             opacity: 0; pointer-events: none; transition: opacity .12s; }
    .stctl::before, .pzmetti::before, .pzx::before, .pzabtn::before, .stannulla::before { content: ""; position: absolute; inset: -4px; }
    .strsz::before { content: ""; position: absolute; inset: -8px; }
    .stbed:hover > .stctl, .starea:hover > .stctl, .sel > .stctl, .stbed:focus-within > .stctl, .starea:focus-within > .stctl,
    .starea:hover > .strsz, .starea.sel > .strsz { opacity: 1; pointer-events: auto; }
    .stctl:hover { border-color: #9DBFDE; }
    .stx { top: -12px; right: -12px; }
    .stx:hover { border-color: #E9BAB6; background: var(--err-f); color: var(--err); }
    .strsz { position: absolute; right: 3px; bottom: 3px; width: 16px; height: 16px; cursor: nwse-resize; touch-action: none; opacity: 0;
             pointer-events: none; transition: opacity .12s;
             background: linear-gradient(135deg, transparent 48%, #C4D0DC 48% 56%, transparent 56% 68%, #C4D0DC 68% 76%, transparent 76%); }
    .strsz:hover { background: linear-gradient(135deg, transparent 48%, var(--azione) 48% 56%, transparent 56% 68%, var(--azione) 68% 76%, transparent 76%); }
    .stmap .stnomein { width: 100%; min-width: 56px; height: 24px; padding: 1px 6px; border: 1px solid #9DBFDE; border-radius: 6px;
                       background: #fff; font-size: 13px; color: var(--testo); user-select: text; -webkit-user-select: text; }
    /* «Sposta in…» */
    .stmenu { position: absolute; z-index: 30; min-width: 220px; max-width: 300px; max-height: min(72vh, 540px); overflow-y: auto; padding: 4px;
              border: 1px solid #D9E2EC; border-radius: 10px; background: #fff; box-shadow: 0 10px 28px rgba(9,42,74,.16); }
    .stmenuhd { padding: 6px 10px 4px; font-size: 12px; color: var(--neutro); }
    .stmi { display: flex; align-items: baseline; gap: 12px; width: 100%; min-height: 32px; padding: 6px 10px; border: 0; border-radius: 6px;
            background: none; cursor: pointer; text-align: left; font-size: 13px; color: var(--testo); }
    .stmi span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .stmi small { flex: none; margin-left: auto; font-size: 12px; color: var(--neutro); }
    .pinmenu { max-width: 340px; }
    .pinr { padding: 6px 8px; border-radius: 6px; } .pinr.evid { background: #FFF6E0; }
    .pinr + .pinr { border-top: 1px solid #EEF1F5; }
    .pinchi { font-weight: 600; font-size: 13px; } .pinnota { font-size: 12.5px; color: #35506B; white-space: pre-wrap; padding: 2px 0; }
    .pinaz { display: flex; gap: 4px; } .pinaz .stmi { width: auto; min-height: 26px; padding: 2px 8px; }
    .pintesto { display: block; box-sizing: border-box; width: calc(100% - 16px); margin: 2px 8px 6px; min-height: 64px; resize: vertical;
                font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid #C6D4E4; border-radius: 6px; color: var(--testo); }
    .pintesto:focus { outline: 2px solid var(--azione); outline-offset: -1px; }
    .stmi[aria-disabled="true"] { cursor: default; color: var(--neutro); }
    .stmi.armato, .stmi.armato:hover { color: var(--err); font-weight: 700; background: var(--err-f); }
    .stmi:hover, .stmi:focus { outline: none; background: #EEF2F6; }
    .stmi:focus-visible { outline: 2px solid var(--azione); outline-offset: -2px; }
    .stmi.cur { cursor: default; color: var(--neutro); }
    .stmsep { height: 1px; margin: 4px 6px; background: #EEF2F6; }
    /* «Annulla», per 8 secondi */
    .stsnack { position: absolute; left: 50%; bottom: 16px; z-index: 25; transform: translateX(-50%); display: flex; align-items: center; gap: 12px;
               max-width: calc(100% - 32px); padding: 6px 6px 6px 14px; border: 1px solid #D9E2EC; border-radius: 10px; background: #fff;
               box-shadow: 0 6px 18px rgba(9,42,74,.12); font-size: 13px; color: var(--testo); pointer-events: none; }
    .stsnack span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .stannulla { position: relative; flex: none; min-height: 28px; border: 0; border-radius: 6px; background: none; padding: 2px 10px; cursor: pointer; pointer-events: auto;
                 font-size: 13px; font-weight: 600; color: var(--azione); }
    .stannulla:hover { background: var(--info-f); }
    @media (pointer: coarse) {
      .stazioni { height: 40px; }
      .stbtn, .stazioni .stbtn { min-height: 36px; }
      .pzx, .pzrow .dfic.vuota { opacity: 1; }
      .stctl { width: 32px; height: 32px; line-height: 30px; }
      .stx { top: -16px; right: -16px; }
    }
    @media (prefers-reduced-motion: reduce) { .pzunita, .pzunita *, .stazioni * { transition: none !important; } }
  `;

