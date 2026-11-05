/*
 * La pagina «Terapia» del gestionale (PsoEpisodioTerapieImposta,
 * MODALITA=PRESCRIZIONE), rifatta sulla forma delle pagine anonimizzate di
 * una registrazione vera: il riquadro del paziente, il modulo EpisodioTerapia
 * con la tabella TerapiaTable<episodio> — le terapie già confermate e UNA riga
 * nuova, vuota, l'ultima —, gli stessi nomi, id, lunghezze e tendine, i
 * nascosti (TERAPIA_SERIALIZED, TIPOLOGIA, RETURNPAGE, CANCELLA_RIGHE,
 * MVPG_PAGE), Conferma (Update) e Chiudi. Le scritte delle tendine nella
 * registrazione sono anonimizzate: qui sono inventate (valore = scritta, come
 * là). Pazienti e farmaci inventati.
 *
 * jQuery e jQuery UI la registrazione non li porta (sono file a parte): la
 * tendina dei farmaci è uno stand-in senza librerie, in test/ext-terapia.mjs
 * (qui niente script: lo vuole il cancello di tools/verifica-esempi.mjs),
 * che si comporta come l'autocomplete di jQuery UI 1.8 della pagina —
 * keydown → mezzo secondo →
 * da 3 lettere una XHR a Sa4JsonService.do (FUNZIONE, ALT_PARAMS=101, _,
 * term), la classe ui-autocomplete-loading intanto, le voci in
 * ul.ui-autocomplete > li.ui-menu-item > a; la voce si fa «attiva» col mouse
 * sopra e il clic la sceglie; il «select» della pagina scrive #DESCRIZIONE,
 * #PRINCIPIO_ATTIVO e #CODICE (dall'id della voce). Il clic su Conferma
 * compone TERAPIA_SERIALIZED (come serializeAnything della pagina).
 * window.__tendina conta le ricerche, __scelte le voci scelte, __conferme i
 * clic su Conferma, __invii i submit del modulo.
 */
export const UM = ["cpr", "fl", "mg", "ml", "g", "gtt", "bust", "UI", "mcg", "puff", "supp"];
export const VIE = ["os", "ev", "im", "sc", "sl", "inal", "rett", "top", "nas", "oft", "ev lenta", "ev inf"];
export const DILUIZIONI = ["fisiologica 100 ml", "fisiologica 250 ml", "fisiologica 500 ml", "glucosata 5% 100 ml", "glucosata 5% 250 ml",
  "glucosata 5% 500 ml", "ringer 500 ml", "acqua ppi 10 ml", "fisiologica 10 ml", "fisiologica 50 ml", "glucosata 10% 250 ml"];

const opz = (l, scelto, numeri = false) => `<option value="">- -</option>` + l.map((t, i) => {
  const v = numeri ? String(i + 1) : t;
  return `<option value="${v}"${v === scelto ? ' selected=""' : ""}>${t}</option>`;
}).join("");
const td = (extra, corpo) => `<td style="BORDER-BOTTOM-STYLE: none" class="AFCDataTD" valign="top"${extra}>${corpo}</td>`;

// una terapia confermata: la riga n come la ridisegna il server
function rigaSalvata(ep, n, r) {
  return `<tr>${td(' nowrap="" align="right" width="1%"', `<img src="../images/copia.gif" border="0" title="Duplica" onclick="openDuplicaDialog(this,'IN_TERAPIA_PROG=${n}');" width="18" heigth="18">`)}`
    + td(' nowrap="" width="10%" title="OPERATORE (10:50)"', `<input class="AFCInput" value="${r.descr}" maxlength="200" size="35" name="DESCRIZIONE_${n}" autocomplete="on"><img src="../images/blank.gif" border="0" width="12" heigth="12" title="">`)
    + `<input class="AFCInput" value="" maxlength="200" type="hidden" name="PRINCIPIO_ATTIVO_${n}">`
    + td(' align="right" width="7%" nowrap=""', `<input class="AFCInput" style="text-align: right;" value="${r.qta}" maxlength="10" size="5" name="QUANTITA_${n}">&nbsp;`)
    + td(' nowrap="" width="5%"', `<select name="UM_${n}" class="AFCSelect">${opz(UM, r.um)}</select>`)
    + td(' nowrap="" width="7%"', `&nbsp;<select name="SOMMINISTRAZIONE_VIA_${n}" class="AFCSelect">${opz(VIE, r.via)}</select>`)
    + td(' nowrap="" width="5%"', `<input bold="" placeholder="hh:mi" class="AFCInput" value="10:53" maxlength="11" size="11" name="PRESC_DATA_${n}">`)
    + td(' nowrap="" width="5%"', `&nbsp;<select name="TERAPIA_DILUIZIONE_ID_${n}" class="AFCSelect">${opz(DILUIZIONI, r.dil, true)}</select>`)
    + `<td nowrap="" title="Continua" style="BORDER-BOTTOM-STYLE: none" align="center" valign="top" width="1%"><input class="AFCInput" name="CONTINUA_${n}" type="checkbox" value="S"${r.continua ? ' checked=""' : ""}></td>`
    + `<td nowrap="" title="Al bisogno" style="BORDER-BOTTOM-STYLE: none" align="center" valign="top" width="1%"><input class="AFCInput" name="AL_BISOGNO_${n}" type="checkbox" value="S"${r.bisogno ? ' checked=""' : ""}></td>`
    + td(' width="5%" nowrap=""', `<input class="AFCInput" value="${r.freq}" maxlength="4" size="3" name="FREQUENZA_${n}">&nbsp;`)
    + td(' width="5%" nowrap=""', `<input class="AFCInput" value="${r.durata}" maxlength="1" size="3" name="DURATA_${n}">&nbsp;`)
    + td(' nowrap="" width="1%"', `<input class="AFCInput" value="" maxlength="150" size="25" name="NOTE_${n}">`)
    + td(' nowrap="" width="5%" title="OPERATORE (10:50)"', `<input class="AFCInput" name="ESECUZIONE_${n}" type="checkbox" value="S">&nbsp;`)
    + td(' nowrap=""', `&nbsp;<input class="AFCInput" value="${ep}" maxlength="200" type="hidden" name="EPISODIO_ID_${n}"><input class="AFCInput" value="${r.prog}" maxlength="200" type="hidden" name="TERAPIA_PROG_${n}"><input class="AFCInput" value="" maxlength="200" type="hidden" name="ORIGINE_${n}"><input class="AFCInput" value="" type="hidden" name="PRINCIPIO_ATTIVO_${n}"><input class="AFCInput" value="${r.codice || ""}" maxlength="200" type="hidden" name="CODICE_${n}">`)
    + `</tr>`;
}
// la riga nuova: la sola con la tendina (#DESCRIZIONE, #PRINCIPIO_ATTIVO, #CODICE)
function rigaNuova(n) {
  return `<tr>${td(' nowrap="" align="right" width="1%"', `<a id="PRINCIPIO_ATTIVO_${n}_LOV" class="AFCDataLink" href="javascript:showMultiLOV('PsoFarmaciLov.do','','EpisodioTerapia','PRINCIPIO_ATTIVO_${n}#DESCRIZIONE_${n}');"><img src="../images/lov.gif" width="18" heigth="18" border="0" alt="Farmaci"></a>`)}`
    + td(' nowrap="" width="10%" title=" ()"', `<input class="AFCInput" value="" maxlength="200" size="35" name="DESCRIZIONE_${n}" id="DESCRIZIONE"><img src="../images/blank.gif" border="0" width="12" heigth="12" title="">`)
    + `<input class="AFCInput" value="" maxlength="200" type="hidden" name="PRINCIPIO_ATTIVO_${n}">`
    + td(' align="right" width="7%" nowrap=""', `<input class="AFCInput" style="text-align: right;" value="" maxlength="10" size="5" name="QUANTITA_${n}">&nbsp;`)
    + td(' nowrap="" width="5%"', `<select name="UM_${n}" class="AFCSelect">${opz(UM, "")}</select>`)
    + td(' nowrap="" width="7%"', `&nbsp;<select name="SOMMINISTRAZIONE_VIA_${n}" class="AFCSelect">${opz(VIE, "")}</select>`)
    + td(' nowrap="" width="5%"', `<input bold="" placeholder="hh:mi" class="AFCInput" value="" maxlength="11" size="11" name="PRESC_DATA_${n}">`)
    + td(' nowrap="" width="5%"', `&nbsp;<select name="TERAPIA_DILUIZIONE_ID_${n}" class="AFCSelect">${opz(DILUIZIONI, "", true)}</select>`)
    + `<td nowrap="" title="Continua" style="BORDER-BOTTOM-STYLE: none" align="center" valign="top" width="1%"><input class="AFCInput" name="CONTINUA_${n}" type="checkbox" value="S"></td>`
    + `<td nowrap="" title="Al bisogno" style="BORDER-BOTTOM-STYLE: none" align="center" valign="top" width="1%"><input class="AFCInput" name="AL_BISOGNO_${n}" type="checkbox" value="S"></td>`
    + td(' width="5%" nowrap=""', `<input class="AFCInput" value="" maxlength="4" size="3" name="FREQUENZA_${n}">&nbsp;`)
    + td(' width="5%" nowrap=""', `<input class="AFCInput" value="1" maxlength="1" size="3" name="DURATA_${n}">&nbsp;`)
    + td(' nowrap="" width="1%"', `<input class="AFCInput" value="" maxlength="150" size="25" name="NOTE_${n}">`)
    + td(' nowrap="" width="5%"', "&nbsp;")
    + td(' nowrap=""', `&nbsp;<input class="AFCInput" value="" maxlength="200" type="hidden" name="EPISODIO_ID_${n}"><input class="AFCInput" value="" maxlength="200" type="hidden" name="TERAPIA_PROG_${n}"><input class="AFCInput" value="" maxlength="200" type="hidden" name="ORIGINE_${n}"><input class="AFCInput" value="" type="hidden" name="PRINCIPIO_ATTIVO_${n}" id="PRINCIPIO_ATTIVO"><input class="AFCInput" value="" maxlength="200" type="hidden" name="CODICE_${n}" id="CODICE">`)
    + `</tr>`;
}

// paginaTerapie({ ep, nome, triage, salvate: [{ descr, qta, um, via, dil, continua, bisogno, freq, durata, prog, codice }], coda })
// (coda: quello che va in fondo alla pagina — la tendina, che sta nel test)
export function paginaTerapie({ ep, nome, triage = "ARANCIONE", salvate = [], coda = "" }) {
  const q = `MVPG=PsoEpisodioTerapieImposta&amp;EPISODIO_ID=${ep}&amp;MODALITA=PRESCRIZIONE&amp;returnPage=PsoEpisodio`;
  const righe = salvate.map((r, i) => rigaSalvata(ep, i + 1, r)).join("") + rigaNuova(salvate.length + 1);
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>${nome}</title></head>
<body>
<table class="AFCHeaderTable" border="0" cellspacing="0" cellpadding="0" width="100%"><tbody><tr><td width="70%" nowrap="" align="center"><font style="font-size: 130%; font-weight: bolder; ">OSPEDALE ESEMPIO</font><br><font style="font-size: 110%; font-weight: bolder; ">AREA ALTA INTENSITA'</font><br><b>Salve! Sei connesso come Utente Medico: UTENTE1</b></td></tr></tbody></table>
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tbody><tr><td><table cellspacing="0" style="background-color: ORANGE; color: White; padding-left: 15px;border-radius: 15px;width: 100%;height: 150px;"><tbody><tr>
  <td nowrap="" width="1%"><img style="border-style: none" title="${triage}" src="../images//urgenza/2.gif" width="22" heigth="22"></td><td width="1%">&nbsp;</td>
  <td align="left" title="${triage}"><font style="font-size: 120%; font-weight: bolder; ">Box 3</font><br><font style="font-size: 150%; font-weight: bolder; ">${nome}</font><br><font style="font-size: 120%; font-weight: bolder; ">01/01/1950 (76) M<br>SMPRSS80A01F205X</font><br><font style="font-size: 140%; font-weight: bolder; ">DISPNEA</font></td>
</tr></tbody></table></td></tr></tbody></table>
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tbody><tr><td></td>
  <td><a class="shiny-button-selected" href="?MVPG=PsoEpisodioTerapieImposta&amp;EPISODIO_ID=${ep}&amp;VALUTAZIONE_PROG=&amp;returnPage=PsoEpisodio&amp;MODALITA=PRESCRIZIONE">Prescrizione</a></td>
  <td><a class="shiny-button" href="?MVPG=PsoEpisodioTerapieImposta&amp;EPISODIO_ID=${ep}&amp;VALUTAZIONE_PROG=&amp;returnPage=PsoEpisodio&amp;MODALITA=SOMMINISTRAZIONE&amp;s_ESEGUITO=0">Somministrazione</a></td>
  <td nowrap=""><a class="AFCDataLink" href="?MVPG=PsoEpisodio&amp;EPISODIO_ID=${ep}&amp;MODALITA=PRESCRIZIONE"><img id="INDIETRO_IMG" title="Indietro" border="0" src="../images/back.gif" width="18" height="18"></a></td>
</tr></tbody></table>
<table border="0" cellspacing="0" cellpadding="0" width="95%" align="center"><tbody><tr><td valign="top" colspan="2" align="left">
<form method="post" name="EpisodioTerapia" data-ep="${ep}" action="menuPsoEpisodio.do?ccsForm=EpisodioTerapia:Edit&amp;${q}" autocomplete="off">
  <table class="AFCFormTABLE" cellspacing="0" cellpadding="3" width="100%"><tbody>
    <tr><td class="AFCColumnTD" colspan="11" align="center">Farmaci in PRESCRIZIONE </td></tr>
    <tr><td class="AFCDataTD" colspan="11"><table border="0" cellspacing="0" cellpadding="0" id="TerapiaTable${ep}"><tbody>
      <tr><td class="AFCDataTD" width="1%">&nbsp;</td><td class="AFCDataTD" width="10%"><font style="font-size: 100%; font-weight: bolder; ">Descrizione</font></td><td class="AFCDataTD">Quantità</td><td class="AFCDataTD">UM</td><td class="AFCDataTD">Via</td><td class="AFCDataTD">Ora</td><td class="AFCDataTD">Diluizione</td><td class="AFCDataTD">C</td><td class="AFCDataTD">AB</td><td class="AFCDataTD">Frequenza</td><td class="AFCDataTD">Durata</td><td class="AFCDataTD">Note</td><td class="AFCDataTD" colspan="3">Eseguito</td><td class="AFCDataTD">&nbsp;</td></tr>
      ${righe}
    </tbody></table><input id="TERAPIA_SERIALIZED" value="" type="hidden" name="TERAPIA_SERIALIZED"><input value="PRESCRIZIONE" type="hidden" name="TIPOLOGIA"><input value="PsoEpisodio" size="16" type="hidden" name="RETURNPAGE"><input value="1" type="hidden" name="CANCELLA_RIGHE"><input value="PsoEpisodioTerapieImposta" type="hidden" name="MVPG_PAGE"></td></tr>
    <tr><td class="AFCFooterTD" colspan="8" nowrap="" align="center"><input class="AFCButton" value="Conferma" type="submit" name="Update">&nbsp; </td>
      <td class="AFCFooterTD" width="5%" colspan="2" nowrap="" align="right"><input class="AFCButton" value="Chiudi" type="submit" name="Chiudi"></td></tr>
  </tbody></table>
</form>
</td></tr></tbody></table>
${coda}
</body></html>`;
}
