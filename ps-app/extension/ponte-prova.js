// La prova della rete, dal PC dell'ospedale e dall'estensione vera: una riga
// per prova, verde o rossa, in parole semplici. Funziona anche prima che il
// ponte esista: senza indirizzo prova Cloudflare e un servizio d'eco pubblico.
// (?durata=N accorcia la prova lunga, in secondi: la usano i test)
const $ = (id) => document.getElementById(id);
const ECO_PUBBLICI = ["wss://echo.websocket.org", "wss://ws.postman-echo.com/raw"];
const CLOUDFLARE = "https://www.cloudflare.com/cdn-cgi/trace";
const STUN = "stun:stun.cloudflare.com:3478";
const DURATA = Math.max(3, Math.min(120, Number(new URLSearchParams(location.search).get("durata")) || 60));
const righe = [];
let host = "";

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
const ms = (t0) => `${Math.round(performance.now() - t0)} ms`;

async function https(url, opzioni) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  const t0 = performance.now();
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctl.signal, ...opzioni });
    return { ok: true, r, tempo: ms(t0) };
  } catch (e) {
    return { ok: false, perche: e && e.name === "AbortError" ? "nessuna risposta in 10 secondi" : "non raggiungibile (rete, proxy o filtro dell'ospedale)" };
  } finally { clearTimeout(t); }
}

// Una presa d'eco: si apre, manda un segno, aspetta che torni.
function apriEco(url, attesa = 10000) {
  return new Promise((ok) => {
    const t0 = performance.now();
    let ws;
    try { ws = new WebSocket(url); } catch { ok({ ok: false, perche: "indirizzo non valido" }); return; }
    const segno = "psa-" + Math.random().toString(36).slice(2);
    const fine = setTimeout(() => { try { ws.close(); } catch { /* già chiusa */ } ok({ ok: false, perche: "nessuna risposta in 10 secondi" }); }, attesa);
    ws.onopen = () => ws.send(segno);
    ws.onmessage = (e) => { if (e.data === segno) { clearTimeout(fine); ok({ ok: true, ws, tempo: ms(t0) }); } };
    ws.onclose = (e) => { clearTimeout(fine); ok({ ok: false, perche: `chiusa subito (codice ${e.code}): di solito un proxy o un filtro che non lascia passare le WebSocket` }); };
  });
}

// Tenuta: la stessa presa aperta per DURATA secondi, un'eco ogni 5.
function tenuta(ws, aggiorna) {
  return new Promise((ok) => {
    const t0 = Date.now();
    const tempi = [];
    let inviati = 0, attesa = null, chiusa = null;
    ws.onclose = (e) => { chiusa = { dopo: Math.round((Date.now() - t0) / 1000), codice: e.code }; };
    ws.onmessage = (e) => { if (attesa && e.data === attesa.segno) { tempi.push(performance.now() - attesa.t); attesa = null; } };
    const passo = setInterval(() => {
      const trascorsi = Math.round((Date.now() - t0) / 1000);
      if (chiusa || trascorsi >= DURATA) {
        clearInterval(passo);
        try { ws.close(); } catch { /* già chiusa */ }
        ok({ chiusa, tempi, inviati });
        return;
      }
      aggiorna(`${trascorsi} s di ${DURATA}…`);
      if (ws.readyState === 1) {
        attesa = { segno: "psa-t-" + inviati, t: performance.now() };
        inviati++;
        ws.send(attesa.segno);
      }
    }, Math.min(5000, DURATA * 1000 / 3));
  });
}

function udp() {
  return new Promise((ok) => {
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] }); } catch { ok(false); return; }
    let fatto = false;
    const chiudi = (v) => { if (fatto) return; fatto = true; try { pc.close(); } catch { /* già chiusa */ } ok(v); };
    pc.onicecandidate = (e) => { if (e.candidate && / typ srflx /.test(e.candidate.candidate)) chiudi(true); if (!e.candidate) chiudi(false); };
    pc.createDataChannel("prova");
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => chiudi(false));
    setTimeout(() => chiudi(false), 6000);
  });
}

async function prova() {
  $("copia").disabled = $("ancora").disabled = true;
  $("righe").replaceChildren();
  righe.length = 0;
  $("esito").className = "esito";
  $("esito").textContent = "Prova in corso…";
  const st = await chrome.runtime.sendMessage({ t: "ponteStato" }).catch(() => null);
  host = (st && st.ok && st.stato.host) || ((await chrome.storage.local.get("ponte.host"))["ponte.host"] || "");

  // (a) HTTPS: il sito del ponte, se c'è, e Cloudflare
  let httpsOk = false;
  const a1 = riga("HTTPS verso il ponte");
  if (!host) a1("info", "Ponte non ancora configurato: salto questa prova.");
  else {
    const r = await https(host + "/ponte/salute");
    const testo = r.ok ? await r.r.text().catch(() => "") : "";
    if (r.ok && r.r.ok && testo === "ok") { httpsOk = true; a1("ok", `Raggiungibile (${new URL(host).host}) in ${r.tempo}.`); }
    else a1("ko", r.ok ? `Risponde, ma non è il ponte (HTTP ${r.r.status}): l'indirizzo è giusto?` : `${new URL(host).host}: ${r.perche}.`);
  }
  const a2 = riga("HTTPS verso Cloudflare");
  const c = await https(CLOUDFLARE, { mode: "no-cors" });
  if (c.ok) { a2("ok", `Raggiungibile in ${c.tempo}.`); httpsOk = httpsOk || !host; }
  else a2("ko", `${c.perche}.`);

  // (b) WSS andata e ritorno: l'eco del ponte, o uno pubblico
  const b = riga(host ? "WebSocket cifrata (WSS) col ponte" : "WebSocket cifrata (WSS) verso Internet");
  let eco = null, dove = "";
  for (const u of host ? [`${new URL(host).protocol === "https:" ? "wss:" : "ws:"}//${new URL(host).host}/ponte/eco`] : ECO_PUBBLICI) {
    eco = await apriEco(u);
    dove = new URL(u).host;
    if (eco.ok) break;
  }
  if (eco.ok) b("ok", `Andata e ritorno con ${dove} in ${eco.tempo}.`);
  else b("ko", `${dove}: ${eco.perche}.`);

  // (c) la stessa presa tenuta aperta
  const cr = riga(`Collegamento tenuto aperto ${DURATA} secondi`);
  let tenutaOk = false;
  if (!eco.ok) cr("ko", "Salto: senza WebSocket non c'è collegamento da tenere.");
  else {
    const t = await tenuta(eco.ws, (x) => cr("corre", x));
    const risposte = t.tempi.length;
    const medio = risposte ? Math.round(t.tempi.reduce((x, y) => x + y, 0) / risposte) : 0;
    const max = risposte ? Math.round(Math.max(...t.tempi)) : 0;
    if (t.chiusa) cr("ko", `Chiuso dopo ${t.chiusa.dopo} s (codice ${t.chiusa.codice}): qualcosa in rete taglia i collegamenti lunghi.`);
    else if (risposte < t.inviati - 1) cr("ko", `Rimasto aperto, ma ${t.inviati - risposte} risposte su ${t.inviati} perse.`);
    else { tenutaOk = true; cr("ok", `Rimasto aperto ${DURATA} s · ${risposte}/${t.inviati} risposte · in media ${medio} ms, al massimo ${max} ms.`); }
  }

  // (d) UDP: solo per sapere
  const d = riga("UDP / WebRTC (solo informazione)");
  const udpOk = await udp();
  d(udpOk ? "ok" : "info", udpOk ? "UDP verso Internet funziona (al ponte non serve)." : "UDP bloccato o non disponibile: normale in ospedale, il ponte non lo usa.");

  const tutto = httpsOk && eco.ok && tenutaOk;
  $("esito").className = "esito " + (tutto ? "ok" : "ko");
  $("esito").textContent = tutto ? (host ? "Il ponte si può usare da questo PC." : "La rete va bene: quando il ponte sarà configurato, si potrà usare.")
    : "Qualcosa non va: le righe rosse dicono cosa. «Copia il risultato» e mandalo a chi gestisce il ponte o all'IT.";
  $("copia").disabled = $("ancora").disabled = false;
}

$("copia").addEventListener("click", async () => {
  const d = new Date();
  const testo = [
    `PS Assist ${chrome.runtime.getManifest().version} · prova della rete per il ponte · ${d.toLocaleString("it-IT")}`,
    `Ponte: ${host || "non configurato"}`,
    $("esito").textContent,
    ...righe.map((r) => `${r.stato === "ok" ? "✓" : r.stato === "ko" ? "✗" : "·"} ${r.titolo}: ${r.testo}`),
    `Browser: ${navigator.userAgent}`,
  ].join("\n");
  let ok = false;
  try { await navigator.clipboard.writeText(testo); ok = true; } catch { ok = false; }
  $("copiato").textContent = ok ? "✓ copiato" : "non copiato: selezionalo a mano";
  setTimeout(() => { $("copiato").textContent = ""; }, 3000);
});
$("ancora").addEventListener("click", prova);
prova();
