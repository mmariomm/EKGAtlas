/*
 * PS Assist — il documento fuori schermo (fuori.html, chrome.offscreen): uno
 * solo per l'estensione (una regola di Chrome), che il service worker apre
 * quando serve (fuori-sw.js) e che sopravvive ai suoi riavvii.
 *
 * Qui stanno le prese verso il ripetitore del ponte (presa.js), una per ruolo:
 * il ponte verso l'iPhone (`pc`), la stazione di stampa (`medico`,
 * `stazione`), le stanze dell'abbinamento. È un tubo e basta: niente chiavi,
 * niente in chiaro — i messaggi sono già cifrati dal service worker, che tiene
 * le sessioni (e le ritrova in storage.session quando riparte). Il battito, i
 * tentativi e la chiusura alla scadenza («fino») li fa la presa, qui, anche
 * mentre il service worker dorme: un messaggio che arriva lo sveglia (è
 * l'unica cosa che lo sveglia), il «pong» no.
 *
 * E lo zip del registratore («Ferma e salva», registra.js): i suoi file
 * (pdf.js, l'anonimizzazione) si caricano solo al primo zip.
 *
 * Qui niente chrome.storage (un documento fuori schermo ha solo
 * chrome.runtime): tutto arriva coi messaggi del service worker.
 */
/* global PresaWs, PRESA, RegistraEsporta */
(function () {
  "use strict";
  const prese = new Map();   // nome → PresaWs
  const b64 = (buf) => {
    const u = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const daB64 = (t) => {
    const s = atob(String(t || ""));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  };
  // al service worker (lo sveglia, se dorme); se non risponde, pazienza: la presa resta
  const alSw = (m) => { try { chrome.runtime.sendMessage(m).catch(() => {}); } catch { /* estensione ricaricata */ } };
  const nomeValido = (n) => (typeof n === "string" && /^[a-z]{2,12}$/.test(n) ? n : "");
  function presa(nome) {
    let p = prese.get(nome);
    if (!p) {
      p = new PresaWs(nome, {
        // (con lo stato della presa: un service worker appena ripartito sa subito di che stanza è)
        dati: (b) => alSw({ t: "fuoriDati", nome, url: p.url, b: b64(b), stato: p.stato() }),
        stato: (s) => alSw({ t: "fuoriStato", ...s }),
      });
      prese.set(nome, p);
    }
    return p;
  }
  const stati = () => Object.fromEntries([...prese].map(([n, p]) => [n, p.stato()]));

  // Il registratore: i suoi file, una volta, nell'ordine della sua pagina di prima (registra-esporta.html).
  let registratore = null;
  const script = (src) => new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => no(new Error("non si carica: " + src));
    document.head.appendChild(s);
  });
  const caricaRegistratore = () => registratore || (registratore = ["pdfjs/pdf.min.js", "pdfjs/pdf.worker.min.js", "registra-pdf.js", "registra-anonimo.js", "registra-db.js", "registra-esporta.js"]
    .reduce((p, src) => p.then(() => script(src)), Promise.resolve())
    .catch((e) => { registratore = null; throw e; }));

  // Solo dal service worker (e dalle pagine dell'estensione): mai da una scheda.
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (!m || typeof m !== "object" || typeof m.t !== "string" || !sender || sender.id !== chrome.runtime.id || sender.tab) return;
    if (m.t === "fuoriPing") { reply({ ok: true, fuori: true, prese: stati() }); return; }
    if (m.t === "fuoriTieni") {
      const nome = nomeValido(m.nome);
      if (!nome) { reply({ ok: false }); return; }
      const url = typeof m.url === "string" && /^wss?:\/\/[^/]+\/ponte\/ws\?/.test(m.url) ? m.url : "";
      const fino = m.fino === null ? null : Number(m.fino) || 0;
      const p = url || prese.has(nome) ? presa(nome) : null;
      if (p) p.tieni(url, fino, m.subito === true);
      reply({ ok: true, stato: p ? p.stato() : null });
      return;
    }
    if (m.t === "fuoriManda") {
      const p = prese.get(nomeValido(m.nome));
      let ok = false;
      // (solo verso la stanza che il service worker crede: una presa che intanto ha cambiato stanza non riceve)
      try { ok = !!p && p.url === m.url && p.manda(daB64(m.b)); } catch { ok = false; }
      reply({ ok });
      return;
    }
    // (solo i test: battito e tentativi più corti)
    if (m.t === "fuoriRegola") {
      for (const k of Object.keys(PRESA)) if (Number.isFinite(m[k]) && m[k] >= 10 && m[k] <= 600e3) PRESA[k] = m[k];
      for (const p of prese.values()) p.ribatti();
      reply({ ok: true, regole: { ...PRESA } });
      return;
    }
    if (m.t === "regFuoriEsporta") {
      caricaRegistratore().then(() => RegistraEsporta.salva(m))
        .then((meta) => reply({ ok: true, meta }), (e) => reply({ ok: false, why: String(e && e.message || e).slice(0, 160) }));
      return true;
    }
  });
})();
