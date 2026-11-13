// La pagina «iPhone» dell'estensione: il QR per associare il telefono (una
// volta per turno), a che punto è la sessione, «Scollega», «Revoca», e il
// registro del ponte. La chiave sta nel service worker: questa pagina la vede
// solo dentro il QR, e il QR solo nei primi due minuti, prima che un telefono
// entri. L'indirizzo del ponte è fissato nella build (ponte/host.txt).
// Di solito sta nel pannello (⋯ → iPhone), in una cornice: lì è compatta, e
// dice al pannello che è partita (se no il pannello la apre in una scheda) e
// che si è premuto Esc. Solo queste due parole: niente della pagina esce di qui.
/* global qrcodegen */
if (window.top !== window) {
  document.documentElement.classList.add("cornice");
  parent.postMessage({ psassistPonte: "pronto" }, "*");
  addEventListener("keydown", (e) => { if (e.key === "Escape") parent.postMessage({ psassistPonte: "esc" }, "*"); });
}
const $ = (id) => document.getElementById(id);
const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const chiedi = (m) => chrome.runtime.sendMessage(m).catch(() => null);
const dice = (testo, ok) => { $("m").textContent = testo || ""; $("m").className = "msg " + (ok ? "ok" : "ko"); };
let qrVisibile = false;
let armata = "";          // «Revoca» chiede conferma: il secondo tocco fa
let tArmata = 0;

function disegnaQr(url) {
  const qr = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM);
  const bordo = 4, n = qr.size + bordo * 2;
  let d = "";
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) d += `M${x + bordo},${y + bordo}h1v1h-1z`;
  $("qr").innerHTML = `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// (col QR davanti, il codice e l'ora di fine li dice il QR: una volta sola)
function righeStato(s, codice, qr) {
  const fine = s.fine ? `Ultima sessione chiusa alle ${hhmm(s.fine.ts)} — ${s.fine.testo || s.fine.perche}.` : "";
  const ponte = { su: s.telefono ? "Collegato al ponte · il pannello è aperto sull'iPhone." : "Collegato al ponte: aspetta l'iPhone.",
    collego: "Mi collego al ponte…", giu: "Il ponte non risponde: riprovo da solo. Se dura, «Prova la rete».", spento: "",
    scollegato: "Scollegato: il ponte ha rifiutato questo PC. «Nuovo QR» lo associa di nuovo; se torna, chiedi all'IT." }[s.relay] || "";
  if (!s.host) {
    return { cls: "warn", testa: "Ponte da configurare", righe: [
      "In questa versione di PS Assist manca l'indirizzo del ponte: si scrive una volta in ponte/host.txt, prima di preparare lo zip (ponte/README.md)."] };
  }
  if (!s.accoppiato) return { cls: "", testa: "Nessun iPhone associato", righe: ["«Associa l'iPhone» mostra un QR: lo inquadri col telefono e il telefono resta associato finché non lo scolleghi.", fine] };
  const cod = codice ? ` · codice ${codice}` : "";
  const cam = s.cambiato ? `iPhone cambiato alle ${hhmm(s.cambiato)} («Usa questo telefono»): se non sei stato tu, Revoca e Nuovo QR.` : "";   // un altro telefono ha preso il posto del primo
  if (s.sessione) {
    return { cls: "vivo", testa: "iPhone collegato", righe: [
      cam,
      `Dalle ${hhmm(s.sessione.dal)} · associato finché non lo scolleghi${cod}`] };
  }
  return { cls: s.relay === "su" ? "ok" : "warn", testa: qr ? "iPhone associato" : `iPhone associato · finché non lo scolleghi${cod}`, righe: [cam, ponte, fine] };
}

async function aggiorna() {
  const r = await chiedi({ t: "ponteStato" });
  if (!r || !r.ok) {
    $("stato").className = "stato warn";
    $("stato").innerHTML = "<b>L'estensione non risponde</b><span class=\"riga\">Ricaricala da chrome://extensions e riapri questa pagina.</span>";
    return;
  }
  const s = r.stato;
  // il telefono è entrato, o sono passati i due minuti: il QR non si mostra più
  if (s.sessione || !r.qr) qrVisibile = false;
  const v = righeStato(s, r.codice, qrVisibile);
  $("stato").className = "stato " + v.cls;
  $("stato").replaceChildren(Object.assign(document.createElement("b"), { textContent: v.testa }),
    ...v.righe.filter(Boolean).map((t) => Object.assign(document.createElement("span"), { className: "riga", textContent: t })));
  $("qrsec").hidden = !qrVisibile;
  if (qrVisibile) { disegnaQr(r.qr); $("qrscade").textContent = hhmm(s.qrFino); $("qrcodice").textContent = r.codice || ""; }
  $("associa").disabled = !s.host;
  $("associa").hidden = qrVisibile;   // col QR davanti, lo nasconde il suo bottone
  // il QR di prima si rivede solo se si può ancora; se no, uno nuovo (e l'iPhone di prima esce)
  // «Nuovo QR» butta fuori l'iPhone di prima: quieto e a due tocchi, come «Revoca»
  const nuovo = s.accoppiato && !r.qr;
  $("associa").className = nuovo ? "quiet" : "";
  $("associa").textContent = !s.accoppiato ? "Associa l'iPhone" : r.qr ? "Mostra il QR" : armata === "nuovo" ? "Butto fuori l'iPhone? Tocca di nuovo" : "Nuovo QR";
  $("scollega").hidden = !s.sessione;
  $("revoca").hidden = !s.accoppiato;
  $("revoca").textContent = armata === "revoca" ? "Revoco? L'iPhone non entrerà più" : "Revoca l'iPhone";
  $("dove").textContent = s.host ? `(${new URL(s.host).host})` : "";
  chiede(s);
  // solo i comandi del medico: le letture automatiche (l'elenco, il catalogo) restano nel Registro
  // del pannello; le righe uguali di fila diventano una, «×3»
  const reg = [];
  for (const x of [...(s.registro || [])].reverse()) {
    if (/^(iPhone · )?(elenco dei pazienti|catalogo degli esami)$/.test(x.testo)) continue;
    const su = reg[reg.length - 1];
    if (su && su.testo === x.testo) su.n++; else reg.push({ ts: x.ts, testo: x.testo, n: 1 });
  }
  $("registro").replaceChildren(...(reg.length ? reg.map((x) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("time"), { textContent: hhmm(x.ts) }), Object.assign(document.createElement("span"), { textContent: x.n > 1 ? `${x.testo} ×${x.n}` : x.testo }));
    return li;
  }) : [Object.assign(document.createElement("li"), { className: "vuoto", textContent: "Ancora niente." })]));
}

// (3.87) Quello che il PC deve decidere, uno alla volta: la stazione da tenere dopo la revoca, un altro
// utente nel gestionale (l'iPhone fermo), una stazione che il telefono vuole al posto di quella collegata.
let dopoRevoca = "";      // il nome della stazione collegata dal telefono, appena revocato l'iPhone
let fai = { si: null, no: null };
function chiede(s) {
  let c = null;
  const ch = s.stazioneChiesta;
  if (dopoRevoca) {
    const nome = dopoRevoca;
    c = { t: `«${nome}» l'aveva collegata l'iPhone`, r: "Se l'iPhone è perso o non è più tuo, scollegala: i fogli degli ordini non vanno più lì.",
      si: `Scollega anche «${nome}»`, no: "Tienila",
      fSi: async () => { const r = await chiedi({ t: "stazioneScollega", ruolo: "medico" }); dopoRevoca = ""; dice(r && r.ok ? `«${nome}» scollegata da questo PC.` : "Non riuscito.", !!(r && r.ok)); },
      fNo: async () => { dopoRevoca = ""; } };
  } else if (s.pausa) {
    c = { t: "Sul PC è entrato un altro utente", r: `${s.pausa.operatore ? `Nel gestionale c'è ${s.pausa.operatore}` : "Nel gestionale c'è un altro utente"}${s.pausa.prima ? `, l'iPhone era di ${s.pausa.prima}` : ""}: è in pausa (niente letture né scritture) finché non lo riconfermi.`,
      si: "Riconferma l'iPhone", no: "",
      fSi: async () => { const r = await chiedi({ t: "ponteRiconferma" }); dice(r && r.ok ? "Riconfermato: l'iPhone riprende con chi c'è adesso nel gestionale." : "Non riuscito.", !!(r && r.ok)); } };
  } else if (ch) {
    c = { t: `L'iPhone chiede di collegare «${ch.nome}» al posto di «${ch.prima}»`,
      r: `Codice della stazione ${ch.codice}: controlla che sia quello sulla sua pagina. La richiesta vale fino alle ${hhmm(ch.scade)}.`,
      si: `Sostituisci con «${ch.nome}»`, no: `Tieni «${ch.prima}»`,
      fSi: async () => { dice("Collego la stazione…", true); const r = await chiedi({ t: "ponteStazioneConferma", si: true }); dice(r && r.ok ? `Collegata «${r.dati.nome}» (codice ${r.dati.codice}).` : (r && r.errore) || "Non riuscito.", !!(r && r.ok)); },
      fNo: async () => { await chiedi({ t: "ponteStazioneConferma", si: false }); dice("Resta la stazione di prima.", true); } };
  }
  $("chiede").hidden = !c;
  if (!c) return;
  $("chiedet").textContent = c.t; $("chieder").textContent = c.r;
  $("chiedesi").textContent = c.si;
  $("chiedeno").textContent = c.no; $("chiedeno").hidden = !c.no;
  fai = { si: c.fSi, no: c.fNo || null };
}
$("chiedesi").addEventListener("click", async () => { const f = fai.si; if (f) { $("chiedesi").disabled = true; try { await f(); } finally { $("chiedesi").disabled = false; } aggiorna(); } });
$("chiedeno").addEventListener("click", async () => { const f = fai.no; if (f) { await f(); aggiorna(); } });

$("associa").addEventListener("click", async () => {
  dice("");
  const r0 = await chiedi({ t: "ponteStato" });
  if (r0 && r0.ok && r0.stato.accoppiato && r0.qr) { qrVisibile = true; return aggiorna(); }
  // un QR nuovo butta fuori l'iPhone di prima: due tocchi
  if (r0 && r0.ok && r0.stato.accoppiato && armata !== "nuovo") {
    armata = "nuovo"; clearTimeout(tArmata);
    tArmata = setTimeout(() => { armata = ""; aggiorna(); }, 5000);
    return aggiorna();
  }
  armata = ""; clearTimeout(tArmata);
  const r = await chiedi({ t: "ponteAssocia" });
  if (!r || !r.ok) return dice((r && r.why) || "Non riuscito: l'estensione non risponde.", false);
  qrVisibile = true;
  aggiorna();
});
$("qrvia").addEventListener("click", () => { qrVisibile = false; aggiorna(); });
$("scollega").addEventListener("click", async () => {
  const r = await chiedi({ t: "ponteScollega" });
  dice(r && r.ok ? "Sessione chiusa. L'iPhone resta associato: per rientrare deve riaprire il pannello." : "Non riuscito.", !!(r && r.ok));
  aggiorna();
});
$("revoca").addEventListener("click", async () => {
  if (armata !== "revoca") {
    armata = "revoca"; clearTimeout(tArmata);
    tArmata = setTimeout(() => { armata = ""; aggiorna(); }, 5000);
    return aggiorna();
  }
  armata = ""; clearTimeout(tArmata);
  qrVisibile = false;
  const r = await chiedi({ t: "ponteRevoca" });
  dice(r && r.ok ? "Revocata: l'iPhone non entra più. Per riassociarlo serve un QR nuovo." : "Non riuscito.", !!(r && r.ok));
  if (r && r.ok && r.stazione) dopoRevoca = r.stazione;   // (e la stazione che l'iPhone aveva collegato? lo chiede qui sotto)
  aggiorna();
});

// «Questo PC»: il nome che il telefono vede (nel saluto e in ⋯ → Dispositivi) e «Non comparire nella lista»
// (il registro dei PC: registro-sw.js). Scritti qui, in storage.local: l'annuncio parte da sé quando cambiano.
(async () => {
  const o = await chrome.storage.local.get(["ponte.nomePc", "registro.no", "registro.id"]).catch(() => ({}));
  $("nomepc").value = typeof o["ponte.nomePc"] === "string" ? o["ponte.nomePc"] : "";
  const s = String(o["registro.id"] || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
  $("nomepc").placeholder = `${/lettura/i.test(chrome.runtime.getManifest().name || "") ? "Lettura e stampa" : "PC"} ${s}`.trim();
  $("nolista").checked = o["registro.no"] === true;
})();
$("nomepc").addEventListener("change", async () => {
  const n = $("nomepc").value.replace(/\s+/g, " ").trim().slice(0, 40);
  if (n) await chrome.storage.local.set({ "ponte.nomePc": n }); else await chrome.storage.local.remove("ponte.nomePc");
  dice(n ? `Il telefono vedrà «${n}».` : "Il telefono vedrà il nome di base.", true);
});
$("nolista").addEventListener("change", async () => {
  await chrome.storage.local.set({ "registro.no": $("nolista").checked });
  dice($("nolista").checked ? "Questo PC esce dalla lista degli altri telefoni." : "Questo PC torna nella lista.", true);
});

chrome.storage.onChanged.addListener((ch, area) => { if (area === "session" && (ch.ponte || ch.stazione)) aggiorna(); });
setInterval(aggiorna, 15000);
aggiorna();

// La build mini (PS Assist · Lettura e stampa): questa è la SUA pagina
// (options_ui). Lo dice — sola lettura — e mostra la versione con la data
// dell'ultimo aggiornamento automatico («Aggiornato alla versione X · data»).
// Nella build normale, dentro il pannello, niente di tutto questo.
(async () => {
  try {
    const man = chrome.runtime.getManifest();
    if (!/lettura/i.test(man.name || "")) return;
    document.title = "PS Assist — sola lettura";
    const h1 = $("stato") && document.querySelector("h1");
    if (h1 && h1.lastChild) h1.lastChild.textContent = "L'iPhone del medico · sola lettura";
    const sub = document.querySelector(".sub");
    if (sub) sub.textContent = "Questo PC è una porta d'ingresso in SOLA LETTURA: dal telefono si vedono pazienti, esiti, cartella e referti, e si ristampa. Non si ordina, non si prescrive, non si scrive in cartella. Tutto cifrato da un capo all'altro.";
    const o = await chrome.storage.local.get("aggiornaUltima").catch(() => ({}));
    const u = o.aggiornaUltima, row = $("aggrow");
    if (row) {
      const data = u && u.quando ? new Date(u.quando).toLocaleDateString("it-IT") : "";
      row.textContent = u && u.v ? `Aggiornato alla versione ${u.v}${data ? " · " + data : ""}. Si aggiorna da solo.` : `Versione ${man.version}. Si aggiorna da solo.`;
      row.hidden = false;
    }
  } catch { /* la pagina resta com'è */ }
})();
