// La copia ESATTA (65a4e11, ps-app/extension/ponte-sw.js) dei tre registri «per numero» del ponte prima di
// archivio.js: test/nodo/archivio.mjs la fa girare accanto a quella di adesso e confronta, passo per passo.
// (Non è codice dell'estensione: non si carica da nessuna parte, se non in quella prova.)
const ponteTerapiaRqTutti = async () => (await chrome.storage.session.get(PONTE_TERAPIA_RQ))[PONTE_TERAPIA_RQ] || {};
let ponteFilaTerapiaRq = Promise.resolve();
function ponteTerapiaRqScrivi(rq, x) {
  const p = ponteFilaTerapiaRq.then(async () => {
    const m = await ponteTerapiaRqTutti();
    m[rq] = { ...(m[rq] || {}), ...x, ts: ponteOra() };
    const tieni = Object.entries(m).filter(([, y]) => ponteOra() - y.ts < PONTE_REGISTRO).sort((a, b) => b[1].ts - a[1].ts).slice(0, 60);
    await chrome.storage.session.set({ [PONTE_TERAPIA_RQ]: Object.fromEntries(tieni) });
  });
  ponteFilaTerapiaRq = p.catch(() => {});
  return p;
}
const ponteAccettaRqTutti = async () => (await chrome.storage.session.get(PONTE_ACCETTA_RQ))[PONTE_ACCETTA_RQ] || {};
let ponteFilaAccettaRq = Promise.resolve();
function ponteAccettaRqScrivi(rq, x) {
  const p = ponteFilaAccettaRq.then(async () => {
    const m = await ponteAccettaRqTutti();
    m[rq] = { ...(m[rq] || {}), ...x, ts: ponteOra() };
    const tieni = Object.entries(m).filter(([, y]) => ponteOra() - y.ts < PONTE_REGISTRO).sort((a, b) => b[1].ts - a[1].ts).slice(0, 60);
    await chrome.storage.session.set({ [PONTE_ACCETTA_RQ]: Object.fromEntries(tieni) });
  });
  ponteFilaAccettaRq = p.catch(() => {});
  return p;
}
const ponteAreaRqTutti = async () => (await chrome.storage.session.get(PONTE_AREA_RQ))[PONTE_AREA_RQ] || {};
let ponteFilaAreaRq = Promise.resolve();
function ponteAreaRqScrivi(rq, x) {
  const p = ponteFilaAreaRq.then(async () => {
    const m = await ponteAreaRqTutti();
    m[rq] = { ...(m[rq] || {}), ...x, ts: ponteOra() };
    const tieni = Object.entries(m).filter(([, y]) => ponteOra() - y.ts < PONTE_REGISTRO).sort((a, b) => b[1].ts - a[1].ts).slice(0, 60);
    await chrome.storage.session.set({ [PONTE_AREA_RQ]: Object.fromEntries(tieni) });
  });
  ponteFilaAreaRq = p.catch(() => {});
  return p;
}
// da ponteDimentica: i nomi tolti dagli esiti delle accettazioni, nella fila di chi scrive
async function vecchiaDimentica() {
  ponteFilaAccettaRq = ponteFilaAccettaRq.then(async () => {
    const m = await ponteAccettaRqTutti();
    let tolti = 0;
    for (const x of Object.values(m)) if (x && x.esito && x.esito.dati && "nome" in x.esito.dati) { const { nome, ...resto } = x.esito.dati; x.esito = { ...x.esito, dati: resto }; tolti++; }
    if (tolti) await chrome.storage.session.set({ [PONTE_ACCETTA_RQ]: m });
  }).catch(() => {});
  await ponteFilaAccettaRq;
}
