// La pagina «iPhone» dell'estensione: il QR per associare il telefono (una
// volta per turno), a che punto è la sessione, «Scollega», «Revoca», e il
// registro del ponte. La chiave sta nel service worker: questa pagina la vede
// solo dentro il QR, e il QR solo nei primi due minuti, prima che un telefono
// entri. L'indirizzo del ponte è fissato nella build (ponte/host.txt).
/* global qrcodegen */
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

function righeStato(s, codice) {
  const fine = s.fine ? `Ultima sessione chiusa alle ${hhmm(s.fine.ts)} — ${s.fine.testo || s.fine.perche}.` : "";
  const ponte = { su: s.telefono ? "Collegato al ponte · il pannello è aperto sull'iPhone." : "Collegato al ponte: aspetta l'iPhone.",
    collego: "Mi collego al ponte…", giu: "Il ponte non risponde: riprovo da solo. Se dura, «Prova la rete».", spento: "" }[s.relay] || "";
  if (!s.host) {
    return { cls: "warn", testa: "Ponte da configurare", righe: [
      "In questa versione di PS Assist manca l'indirizzo del ponte: si scrive una volta in ponte/host.txt, prima di preparare lo zip (ponte/README.md)."] };
  }
  if (!s.accoppiato) return { cls: "", testa: "Nessun iPhone associato", righe: ["«Associa l'iPhone» mostra un QR: lo inquadri col telefono e sei dentro fino a fine turno.", fine] };
  const cod = codice ? ` · codice ${codice}` : "";
  if (s.sessione) {
    return { cls: "vivo", testa: "iPhone collegato", righe: [
      `Dalle ${hhmm(s.sessione.dal)} · ultimo comando alle ${hhmm(s.sessione.ultimo)} · si chiude da sola dopo 20 minuti senza comandi.`,
      `Associato fino alle ${hhmm(s.scade)}${cod}. Ogni comando finisce nel Registro.`] };
  }
  return { cls: s.relay === "su" ? "ok" : "warn", testa: `iPhone associato fino alle ${hhmm(s.scade)}${cod}`, righe: [ponte, fine] };
}

async function aggiorna() {
  const r = await chiedi({ t: "ponteStato" });
  if (!r || !r.ok) {
    $("stato").className = "stato warn";
    $("stato").innerHTML = "<b>L'estensione non risponde</b><span class=\"riga\">Ricaricala da chrome://extensions e riapri questa pagina.</span>";
    return;
  }
  const s = r.stato;
  const v = righeStato(s, r.codice);
  $("stato").className = "stato " + v.cls;
  $("stato").replaceChildren(Object.assign(document.createElement("b"), { textContent: v.testa }),
    ...v.righe.filter(Boolean).map((t) => Object.assign(document.createElement("span"), { className: "riga", textContent: t })));
  // il telefono è entrato, o sono passati i due minuti: il QR non si mostra più
  if (s.sessione || !r.qr) qrVisibile = false;
  $("qrsec").hidden = !qrVisibile;
  if (qrVisibile) { disegnaQr(r.qr); $("qrscade").textContent = hhmm(s.scade); $("qrcodice").textContent = r.codice || ""; }
  $("associa").disabled = !s.host;
  $("associa").hidden = qrVisibile;   // col QR davanti, lo nasconde il suo bottone
  // il QR di prima si rivede solo se si può ancora; se no, uno nuovo (e l'iPhone di prima esce)
  $("associa").textContent = !s.accoppiato ? "Associa l'iPhone" : r.qr ? "Mostra il QR" : "Nuovo QR (l'iPhone di prima esce)";
  $("scollega").hidden = !s.sessione;
  $("revoca").hidden = !s.accoppiato;
  $("revoca").textContent = armata === "revoca" ? "Revoco? L'iPhone non entrerà più" : "Revoca l'iPhone";
  $("dove").textContent = s.host ? `(${new URL(s.host).host})` : "";
  const reg = [...(s.registro || [])].reverse();
  $("registro").replaceChildren(...(reg.length ? reg.map((x) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("time"), { textContent: hhmm(x.ts) }), Object.assign(document.createElement("span"), { textContent: x.testo }));
    return li;
  }) : [Object.assign(document.createElement("li"), { className: "vuoto", textContent: "Ancora niente." })]));
}

$("associa").addEventListener("click", async () => {
  dice("");
  const r0 = await chiedi({ t: "ponteStato" });
  if (r0 && r0.ok && r0.stato.accoppiato && r0.qr) { qrVisibile = true; return aggiorna(); }
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
  aggiorna();
});

chrome.storage.onChanged.addListener((ch, area) => { if (area === "session" && ch.ponte) aggiorna(); });
setInterval(aggiorna, 15000);
aggiorna();
