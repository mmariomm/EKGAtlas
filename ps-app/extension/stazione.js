// La pagina della STAZIONE DI STAMPA (il PC dell'infermeria): il QR per
// collegarla al PC del medico (lo inquadra l'app dell'iPhone), il suo nome, le
// due stampanti con la prova, gli ultimi fogli (ora, tipo, pagine, esito:
// niente pazienti) e «Scollega». Le chiavi stanno nel service worker
// (stazione-sw.js): qui solo quello che si vede.
/* global qrcodegen */
const $ = (id) => document.getElementById(id);
const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const chiedi = (m) => chrome.runtime.sendMessage(m).catch(() => null);
const el = (tag, props = {}, ...figli) => { const x = Object.assign(document.createElement(tag), props); x.append(...figli); return x; };
let stato = null, armata = false, tArmata = 0, qrDi = "", tQr = 0;

function disegnaQr(url) {
  if (qrDi === url) return;
  qrDi = url;
  const qr = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM);
  const bordo = 4, n = qr.size + bordo * 2;
  let d = "";
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) d += `M${x + bordo},${y + bordo}h1v1h-1z`;
  $("qr").innerHTML = `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function mostra() {
  const s = stato;
  if (!s) {
    $("stato").className = "stato warn";
    $("stato").replaceChildren(el("b", { textContent: "L'estensione non risponde" }), el("span", { className: "riga", textContent: "Ricaricala da chrome://extensions e riapri questa pagina." }));
    return;
  }
  const q = s.qui, o = s.offerta;
  const [cls, testa, ...righe] = !s.host ? ["warn", "Ponte da configurare", "In questa versione di PS Assist manca l'indirizzo del ponte (ponte/host.txt): la stazione non si può collegare."]
    : q && q.conferma ? ["ok", "Collegata al PC del medico", `Dalle ${hhmm(q.dal)} · codice ${q.codice}, lo stesso sul PC del medico`,
      q.pc ? "Il PC del medico è collegato adesso: i fogli dei suoi ordini escono qui." : "Il PC del medico adesso non è collegato: i fogli arrivano quando c'è."]
    : q ? ["", "Mi collego al PC del medico…", ""]
    : ["", "Non collegata", o ? "" : "Preparo il QR…"];
  $("stato").className = "stato " + cls;
  $("stato").replaceChildren(el("b", { textContent: testa }), ...righe.filter(Boolean).map((t) => el("span", { className: "riga", textContent: t })));
  $("qrsec").hidden = !o;
  if (o) {
    disegnaQr(o.qr);
    $("qrcodice").textContent = o.codice;
    const resta = Math.max(0, Math.round((o.scade - Date.now()) / 1000));
    $("qrscade").textContent = `Vale ancora ${Math.floor(resta / 60)}:${String(resta % 60).padStart(2, "0")}, poi ne compare un altro.`;
  }
  if (document.activeElement !== $("nome")) $("nome").value = s.nome || "Infermeria";
  $("scollega").hidden = !q;
  $("scollega").textContent = armata ? "Scollego? Il PC del medico non stamperà più qui" : "Scollega";
}
function mostraLavori(l) {
  const r = [...(l || [])].reverse();
  $("lavori").replaceChildren(...(r.length ? r.map((x) => {
    const cosa = x.tipo === "etichette" ? "Etichette" : "A4";
    const pag = x.pagine ? ` · ${x.pagine === 1 ? "1 pagina" : `${x.pagine} pagine`}` : "";
    const copie = x.copie > 1 ? ` ×${x.copie}` : "";
    const esito = { stampato: `Stampato su ${x.stampante}`, mandato: `Mandato a ${x.stampante}`, fallito: "Non stampato", sconosciuto: "Esito sconosciuto" }[x.esito] || x.esito;
    return el("li", { className: x.esito === "fallito" ? "ko" : x.esito === "stampato" ? "" : "warn" }, el("time", { textContent: hhmm(x.ts) }), el("span", { textContent: `${cosa}${pag}${copie} · ${esito}` }));
  }) : [el("li", { className: "vuoto", textContent: "Ancora niente." })]));
}
async function aggiorna() {
  const r = await chiedi({ t: "stazioneStato" });
  stato = r && r.ok ? r.stazione : null;
  // senza collegamento, un QR (nuovo se quello di adesso scade fra meno di un minuto)
  if (stato && stato.host && !stato.qui && (!stato.offerta || stato.offerta.scade - Date.now() < 60e3)) {
    const o = await chiedi({ t: "stazioneOfferta" });
    if (o && o.ok) stato = o.stazione;
  }
  mostra();
  if (r && r.ok) mostraLavori(r.lavori);
  if (!document.hidden) chiedi({ t: "stazioneVisto" });   // guardata: il puntino sull'icona si spegne
}
// il conto alla rovescia del QR, e un QR nuovo quando serve
clearInterval(tQr);
tQr = setInterval(() => { if (stato && stato.offerta) { if (stato.offerta.scade - Date.now() < 60e3) aggiorna(); else mostra(); } }, 1000);
// e lo stato ogni minuto, anche se niente cambia: prima di Chrome 116 (niente getContexts) è così che la
// stazione sa che questa pagina è aperta, e resta sul ponte (stazione-sw.js, stzPagina)
setInterval(aggiorna, 60e3);
chrome.storage.onChanged.addListener((ch, area) => {
  if ((area === "session" && ch["stazione.stato"]) || (area === "local" && (ch["stazione.lavori"] || ch["stazione.qui"]))) aggiorna();
});

// il nome
const salvaNome = async () => {
  const r = await chiedi({ t: "stazioneNome", nome: $("nome").value });
  if (r && r.ok) { stato = r.stazione; mostra(); }
};
$("nome").addEventListener("change", salvaNome);
$("nome").addEventListener("keydown", (e) => { if (e.key === "Enter") $("nome").blur(); });

// «Scollega», due tocchi
$("scollega").addEventListener("click", async () => {
  if (!armata) { armata = true; clearTimeout(tArmata); tArmata = setTimeout(() => { armata = false; mostra(); }, 5000); mostra(); return; }
  armata = false;
  await chiedi({ t: "stazioneScollega", ruolo: "stazione" });
  aggiorna();
});

// Le stampanti: quelle che l'aiutante di questo PC vede; le scelte stanno dove
// le tiene la stampa automatica (`stampa`: etichette, a4), e si salvano subito.
const sel = { etichette: $("setic"), a4: $("sa4") };
const leggiScelte = async () => (await chrome.storage.local.get("stampa")).stampa || {};
const dice = (testo, ok) => { $("sm").textContent = testo; $("sm").className = "msg " + (ok ? "ok" : "ko"); };
async function stampanti() {
  const r = await chiedi({ t: "stampaStato" });
  const nomi = r && r.ok ? r.stampanti : [];
  const s = await leggiScelte();
  if (r && r.ok && !s.a4 && nomi.includes(r.predefinita)) await chrome.storage.local.set({ stampa: { ...s, a4: r.predefinita } });
  const scelte = await leggiScelte();
  for (const [tipo, x] of Object.entries(sel)) {
    const scelta = scelte[tipo] || "";
    const tutte = scelta && !nomi.includes(scelta) ? [scelta, ...nomi] : nomi;
    x.replaceChildren(new Option("— scegli —", ""), ...tutte.map((n) => new Option(nomi.includes(n) ? n : `${n} (non trovata)`, n)));
    x.value = scelta;
    x.disabled = !nomi.length;
  }
  for (const b of document.querySelectorAll("[data-prova]")) b.disabled = !nomi.length || !sel[b.dataset.prova].value;
  const manca = !nomi.length ? (r && r.why) || "l'aiutante di stampa non risponde"
    : !scelte.etichette || !scelte.a4 ? "Scegli le due stampanti: i fogli arrivano qui e vanno a quella del loro tipo." : "";
  $("sst").hidden = !manca;
  $("sst").className = "stato warn";
  $("sst").textContent = !nomi.length ? `Stampa automatica non installata su questo PC: ${manca}. Installala dalla cartella «stampa» dello zip (installa.cmd), poi riapri questa pagina.` : manca;
}
for (const [tipo, x] of Object.entries(sel)) x.addEventListener("change", async () => { await chrome.storage.local.set({ stampa: { ...(await leggiScelte()), [tipo]: x.value } }); stampanti(); });
for (const b of document.querySelectorAll("[data-prova]")) {
  b.addEventListener("click", async () => {
    const tipo = b.dataset.prova, stampante = sel[tipo].value;
    b.disabled = true;
    dice(`Mando la pagina di prova a ${stampante}…`, true);
    const r = await chiedi({ t: "stampaProva", tipo, stampante });
    dice(r && r.ok ? `Pagina di prova ${r.esito === "stampato" ? "stampata su" : "mandata a"} ${r.stampante}: controlla che sia uscita${tipo === "etichette" ? ", dritta e intera" : ""}.`
      : `${r && r.esito === "sconosciuto" ? "Esito sconosciuto" : "Non riuscita"}: ${(r && r.why) || "nessuna risposta"}`, !!(r && r.ok));
    b.disabled = false;
  });
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) chiedi({ t: "stazioneVisto" }); });
aggiorna();
stampanti();
