// La prova della rete, dal PC dell'ospedale e dall'estensione vera: entra in
// una stanza di prova del ripetitore — un numero casuale, buttato alla fine —
// sia come PC sia come telefono, sulla presa vera del ponte (/ponte/ws). Dice
// quanto ci mette ad aprirsi e quanto un messaggio a fare il giro; a richiesta
// la tiene aperta 15 minuti come fa il ponte (un battito ogni 20 secondi) e
// dice quando e perché è caduta. Nessun altro sito, nessun dato.
// (?durata=N accorcia la prova lunga, in secondi: la usano i test)
const $ = (id) => document.getElementById(id);
const DURATA = Math.max(3, Math.min(900, Number(new URLSearchParams(location.search).get("durata")) || 900));
const BATTITO = Math.min(20e3, DURATA * 1000 / 3);
const righe = [];
let host = "", presa = "";

function riga(titolo) {
  const li = document.createElement("li");
  li.className = "corre";
  li.innerHTML = '<i class="seg"></i><div><b></b><span>…</span></div>';
  li.querySelector("b").textContent = titolo;
  $("righe").append(li);
  const r = { titolo, stato: "corre", testo: "", li };
  righe.push(r);
  return (stato, testo) => {
    r.stato = stato; r.testo = testo;
    li.className = stato;
    li.querySelector("span").textContent = testo;
  };
}
const stanzaDiProva = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const PERCHE = { 1000: "chiusa normalmente", 1001: "il server se n'è andato", 1006: "tagliata senza preavviso: rete, proxy o filtro",
  1008: "rifiutata", 1009: "messaggio troppo grande", 1011: "errore del server", 4001: "sostituita", 4002: "inattiva" };
const codice = (c) => `codice ${c}${PERCHE[c] ? `, ${PERCHE[c]}` : ""}`;
const durata = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}`.trim(); };
const hhmm = (ts) => new Date(ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

// Una presa nella stanza, come PC o come telefono: aperta, o perché no.
function apri(stanza, ruolo) {
  return new Promise((ok) => {
    const t0 = performance.now();
    let ws;
    try { ws = new WebSocket(`${presa}?r=${stanza}&ruolo=${ruolo}`); } catch { ok({ ok: false, perche: "indirizzo non valido" }); return; }
    ws.binaryType = "arraybuffer";
    const fine = setTimeout(() => { try { ws.close(); } catch { /* già chiusa */ } ok({ ok: false, perche: "nessuna risposta in 10 secondi" }); }, 10000);
    ws.onopen = () => { clearTimeout(fine); ok({ ok: true, ws, ms: Math.round(performance.now() - t0) }); };
    ws.onclose = (e) => { clearTimeout(fine); ok({ ok: false, perche: `chiusa subito (${codice(e.code)}): di solito un proxy o un filtro che non lascia passare le WebSocket` }); };
  });
}
// Un messaggio dal «telefono» al «PC», e il PC lo rimanda: il giro intero.
function giro(pc, tel, i) {
  return new Promise((ok) => {
    const t0 = performance.now();
    const fine = setTimeout(() => ok(null), 5000);
    pc.onmessage = (e) => { if (typeof e.data !== "string") pc.send(e.data); };
    tel.onmessage = (e) => { if (typeof e.data !== "string" && new Uint8Array(e.data)[0] === i) { clearTimeout(fine); ok(performance.now() - t0); } };
    tel.send(new Uint8Array([i, 1, 2, 3]));
  });
}
const aspettaPari = (ws) => new Promise((ok) => {
  const fine = setTimeout(() => ok(false), 5000);
  ws.onmessage = (e) => { if (e.data === '{"pari":true}') { clearTimeout(fine); ok(true); } };
});

async function prova() {
  for (const b of ["copia", "ancora", "lunga"]) $(b).disabled = true;
  $("righe").replaceChildren();
  righe.length = 0;
  $("esito").className = "esito";
  $("esito").textContent = "Prova in corso…";
  const st = await chrome.runtime.sendMessage({ t: "ponteStato" }).catch(() => null);
  host = (st && st.ok && st.stato.host) || "";
  presa = host ? `${new URL(host).protocol === "https:" ? "wss:" : "ws:"}//${new URL(host).host}/ponte/ws` : "";

  const a = riga("Collegamento al ponte (WSS)");
  if (!host) {
    a("ko", "Ponte da configurare: in questa versione di PS Assist manca il suo indirizzo, non c'è niente da provare.");
    return finita(false);
  }
  const stanza = stanzaDiProva();
  const pc = await apri(stanza, "pc");
  if (!pc.ok) { a("ko", `${presa}: ${pc.perche}.`); return finita(false); }
  const pari = aspettaPari(pc.ws);
  const tel = await apri(stanza, "tel");
  if (!tel.ok) { pc.ws.close(); a("ko", `La seconda presa no: ${tel.perche}.`); return finita(false); }
  a("ok", `${presa} · si apre in ${pc.ms} ms.`);

  const b = riga("Andata e ritorno");
  const tempi = [];
  if (await pari) for (let i = 1; i <= 5; i++) { const t = await giro(pc.ws, tel.ws, i); if (t != null) tempi.push(t); }
  pc.ws.close(); tel.ws.close();
  const ok = tempi.length === 5;
  if (ok) b("ok", `5 messaggi su 5 · in media ${Math.round(tempi.reduce((x, y) => x + y, 0) / 5)} ms, al massimo ${Math.round(Math.max(...tempi))} ms.`);
  else b("ko", `${tempi.length} messaggi su 5: il ripetitore non li passa. Di solito un proxy che apre la WebSocket ma non la lascia parlare.`);
  finita(ok);
}
function finita(ok) {
  $("esito").className = "esito " + (ok ? "ok" : "ko");
  $("esito").textContent = ok ? "Il ponte si può usare da questo PC." : "Qualcosa non va: le righe rosse dicono cosa. «Copia il risultato» e mandalo all'IT.";
  $("copia").disabled = $("ancora").disabled = false;
  $("lunga").disabled = !ok;
}

// La tenuta: due prese aperte come le tiene il ponte, ognuna col suo battito.
// Finisce alla durata, o alla prima che cade: quando, e con che codice.
async function lunga() {
  for (const b of ["ancora", "lunga"]) $(b).disabled = true;
  const c = riga(`Tenuta: aperto ${durata(DURATA * 1000)} col battito ogni ${Math.round(BATTITO / 1000)} s`);
  const stanza = stanzaDiProva();
  const prese = [await apri(stanza, "pc"), await apri(stanza, "tel")];
  if (!prese.every((p) => p.ok)) { prese.forEach((p) => p.ws && p.ws.close()); c("ko", "Non si apre: " + (prese.find((p) => !p.ok).perche) + "."); return finita(false); }
  const t0 = Date.now();
  const esito = await new Promise((ok) => {
    let finito = false;
    const chiudi = (r) => { if (finito) return; finito = true; clearInterval(passo); for (const p of prese) { p.ws.onclose = null; try { p.ws.close(); } catch { /* già chiusa */ } } ok(r); };
    const attese = new Map();
    for (const [i, p] of prese.entries()) {
      p.ws.onmessage = (e) => { if (e.data === "pong") attese.delete(i); };
      p.ws.onclose = (e) => chiudi({ caduta: { dopo: Date.now() - t0, ts: Date.now(), codice: e.code, chi: i ? "telefono" : "PC" } });
    }
    let ultimo = 0;
    const passo = setInterval(() => {
      const ora = Date.now();
      if (ora - t0 >= DURATA * 1000) return chiudi({});
      for (const [i, inviato] of attese) if (ora - inviato > 10e3) return chiudi({ muta: { dopo: ora - t0, ts: ora, chi: i ? "telefono" : "PC" } });
      if (ora - ultimo >= BATTITO) { ultimo = ora; for (const [i, p] of prese.entries()) { p.ws.send("ping"); attese.set(i, ora); } }
      c("corre", `${durata(ora - t0)} di ${durata(DURATA * 1000)}…`);
    }, 1000);
  });
  if (esito.caduta) c("ko", `Caduta dopo ${durata(esito.caduta.dopo)} (alle ${hhmm(esito.caduta.ts)}, presa del ${esito.caduta.chi}): ${codice(esito.caduta.codice)}.`);
  else if (esito.muta) c("ko", `Dopo ${durata(esito.muta.dopo)} (alle ${hhmm(esito.muta.ts)}) il battito non torna più: la rete la tiene aperta ma non la fa parlare.`);
  else c("ok", `Rimasta aperta ${durata(DURATA * 1000)}, il battito è sempre tornato.`);
  finita(!esito.caduta && !esito.muta);
}

$("copia").addEventListener("click", async () => {
  const d = new Date();
  const testo = [
    `PS Assist ${chrome.runtime.getManifest().version} · prova della rete per il ponte · ${d.toLocaleString("it-IT")}`,
    $("esito").textContent,
    ...righe.map((r) => `${r.stato === "ok" ? "✓" : r.stato === "ko" ? "✗" : "·"} ${r.titolo}: ${r.testo}`),
    `Browser: ${navigator.userAgent}`,
    "",
    "Per l'IT",
    `- Indirizzo: ${presa || "wss://<sito del ponte>/ponte/ws"} — WebSocket su HTTPS, TCP 443, solo in uscita, dal Chrome di questo PC.`,
    "- Attraverso il proxy deve passare l'upgrade a WebSocket.",
    "- È una connessione lunga (fino a 14 ore) con un battito ogni 20 secondi: non va chiusa per inattività né per durata.",
    "- Il contenuto è cifrato da un capo all'altro (AES-256-GCM, dentro il TLS): si può escludere dall'ispezione TLS senza esporre niente.",
  ].join("\n");
  let ok = false;
  try { await navigator.clipboard.writeText(testo); ok = true; } catch { ok = false; }
  $("copiato").textContent = ok ? "✓ copiato" : "non copiato: selezionalo a mano";
  setTimeout(() => { $("copiato").textContent = ""; }, 3000);
});
$("ancora").addEventListener("click", prova);
$("lunga").addEventListener("click", lunga);
prova();
