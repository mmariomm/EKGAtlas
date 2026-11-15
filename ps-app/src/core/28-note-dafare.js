//@frammento 28-note-dafare.js — NOTA, SEGNI (valori evidenziati), DA FARE e promemoria (df*, prom*, gen*),
//@ fogli di dimissione ed EO del medico.
  // ------------------------------------------------------------------ NOTA
  // Fino alla 3.57 c'era una nota per paziente (codice fiscale, o il nome),
  // che scadeva dopo 24 ore. Ora è la prima voce di «Da fare» (dfMigra la
  // porta lì): qui resta solo la chiave, per leggere quelle rimaste e per
  // toglierle con il paziente. La stessa scadenza vale per i segni sui valori.
  const noteKey = "note.v1";
  const NOTA_TTL = 24 * 3600e3;

  // ----------------------------------------------------------------- SEGNI
  // Un valore toccato si evidenzia: giallo, al secondo tocco arancio, al
  // terzo torna com'era. Il medico «segna» quello che vuole tenere d'occhio.
  // Per paziente come la nota, con la stessa chiave e la stessa scadenza;
  // la cella è «colonna|analita», la stessa identità della tabella.
  const segniKey = "segni.v1";
  function segniTutti() {
    const s = store.get(segniKey, {});
    const ora = Date.now();
    // (3.90) una lettura non scrive: gli scaduti restano fuori, e se ne vanno alla prossima scrittura voluta
    for (const k of Object.keys(s)) if (ora - (s[k]?.ts || 0) > NOTA_TTL) delete s[k];
    return s;
  }
  const leggiSegni = (chiave) => (chiave ? (segniTutti()[chiave]?.celle || {}) : {});
  function scriviSegno(chiave, cella, stato) {
    if (!chiave || !cella) return false;
    const s = segniTutti();
    const celle = { ...(s[chiave]?.celle || {}) };
    if (stato) celle[cella] = stato; else delete celle[cella];
    if (Object.keys(celle).length) s[chiave] = { celle, ts: Date.now() }; else delete s[chiave];
    return store.set(segniKey, s);
  }
  // come la nota: i segni fatti prima di conoscere il codice fiscale lo seguono
  function migraSegni(da, a) {
    const s = segniTutti();
    if (!s[da]) return;
    // due buste (una per il nome, una per il codice) si sommano, non si scelgono
    s[a] = { celle: { ...s[da].celle, ...(s[a]?.celle || {}) }, ts: Date.now() };
    delete s[da];
    store.set(segniKey, s);
  }

  // --------------------------------------------------------------- DA FARE
  // Una lista sola per paziente, a spunte tonde: le cose da fare, e — con
  // un'ora scritta dentro («11:30 tropo», «tra 2h ECG») — i promemoria. Si
  // tiene l'ISTANTE: ricaricare la pagina non sposta
  // niente. La prima voce aperta è il post-it della riga e del letto; l'ordine
  // lo decide il medico (trascinando). Una voce spuntata resta 5 minuti, poi se
  // ne va. Per episodio, mai un nome; al massimo 15 aperte; una con l'ora
  // scade 12 ore dopo l'ora fissata, una senza 24 ore dopo l'ultima modifica.
  // Stanno in questo browser e non vanno da nessuna parte.
  // Fino alla 3.57 c'erano la nota (per paziente) e i promemoria (per
  // episodio): la prima lettura li porta qui (dfMigra) — la nota come prima
  // voce senza ora, i promemoria come voci con l'ora.
  const PROM = "dafare.v1";                  // { ep: [{ id, testo, t|null, fatto|null, ord, ts }] }
  const PROM_VECCHI = "promemoria.v1";
  const PROM_MAX = 15;                       // voci aperte per paziente
  const PROM_TTL = 12 * 3600e3;              // una voce con l'ora, dopo l'ora fissata
  const DF_TTL = 24 * 3600e3;                // una voce senza ora, dopo l'ultima modifica
  const DF_FATTO = 5 * 60e3;                 // una voce spuntata resta 5 minuti
  const DF_LUNGO = 120;                      // una riga sola: la cosa da fare si tiene corta
  // Il primo orario scritto nel testo; il resto è la cosa da fare. Solo le
  // forme che non si confondono con un valore: un'ora coi due punti «11:30»,
  // col punto solo dopo «alle», «ore» o «h» («alle 9.10», «ore 15.30»),
  // «11h30», «11h», «alle 14». Fra quanto: «tra 2h», «+2h», «2h», «2h30»,
  // «90m», «30 min», «30'», «+30′», «tra 45 minuti», «2 ore». Un numero col
  // punto o la virgola da solo («Hb 9.10», «K 5,30») non è mai un'ora. Con una
  // cifra «2h» è fra quanto, con due «11h» è un'ora. Un'ora passata da non più
  // di 2 ore è di oggi (già scaduta); più indietro è di domani: il turno di notte.
  function leggiPromemoria(testo, ora, max = 40) {
    const s = String(testo || "").replace(/\s+/g, " ").trim();
    const T = "(?<![\\p{L}\\p{N}_])", F = "(?![\\p{L}\\p{N}_])";
    const FRA = "(?:(?:tra|fra|entro|in|dopo)\\s+|\\+\\s?)", ALLE = "(?:(?:alle|verso\\s+le|per\\s+le|entro\\s+le)(?:\\s+ore)?\\s+|ore\\s+|h\\s?)";
    const eFra = (p) => new RegExp(`^${FRA}$`, "i").test(p || "");   // «entro le 14» è un'ora, «entro 2h» fra quanto
    const alle = (h, m) => {
      if (h > 23 || m > 59) return null;
      const d = new Date(ora);
      d.setHours(h, m, 0, 0);
      if (d.getTime() < ora - 2 * 3600e3) d.setDate(d.getDate() + 1);
      else if (d.getTime() >= ora + 22 * 3600e3) d.setDate(d.getDate() - 1);
      return d.getTime();
    };
    const fra = (min) => (min >= 1 && min <= 1440 ? Math.floor((ora + min * 60e3) / 60e3) * 60e3 : null);
    const forme = [
      // 11:30 (e «tra 1:30»: fra un'ora e mezza). Col punto è anche un numero
      // («Hb 9.10», «K 5.30»): un'ora solo dopo «alle», «ore» o «h»
      [`${T}(${FRA}|${ALLE})?(\\d{1,2})([:.])(\\d{2})${F}`, (m) => (+m[4] > 59 || (m[3] === "." && !(m[1] && !eFra(m[1]))) ? null
        : eFra(m[1]) ? fra(+m[2] * 60 + +m[4]) : alle(+m[2], +m[4]))],
      // 11h, 11h30 · 2h, 2h30, tra 2h
      [`${T}(${FRA}|${ALLE})?(\\d{1,2}) ?h(?:(\\d{2})(?: ?min| ?m)?)?${F}`, (m) => {
        const h = +m[2], mm = +(m[3] || 0);
        if (mm > 59) return null;
        return (m[1] ? eFra(m[1]) : m[2].length === 1) ? fra(h * 60 + mm) : alle(h, mm);
      }],
      // 2 ore, tra 1 ora
      [`${T}${FRA}?(\\d{1,2}) ?or[ae]${F}`, (m) => fra(+m[1] * 60)],
      // 90m, 30 min, 30', tra 45 minuti
      [`${T}${FRA}?(\\d{1,4}) ?(?:minut[io]|min|m|['’′])(?![\\p{L}\\p{N}_'’′])`, (m) => fra(+m[1])],
      // alle 14, ore 14
      [`${T}${ALLE}(\\d{1,2})(?![\\p{L}\\p{N}_:'’′]|\\.\\d)`, (m) => alle(+m[1], 0)],
    ];
    let primo = null;
    for (const [re, quando] of forme) {
      for (const m of s.matchAll(new RegExp(re, "giu"))) {
        const t = quando(m);
        if (t == null) continue;
        const c = { i: m.index, n: m[0].length, t, debole: m[3] === "." ? 1 : 0 };
        if (!primo || c.debole < primo.debole
          || (c.debole === primo.debole && (c.i < primo.i || (c.i === primo.i && c.n > primo.n)))) primo = c;
        break;   // di ogni forma conta la prima che vale
      }
    }
    if (!primo) return null;
    // il resto è la cosa da fare: senza la punteggiatura rimasta dove stava l'orario
    const prima = s.slice(0, primo.i).replace(/[\s·:,;\-–—]+$/, ""), dopo = s.slice(primo.i + primo.n).replace(/^[\s·:,;.\-–—]+/, "");
    const resto = `${prima} ${dopo}`.replace(/^[\s·:,;.\-–—]+|[\s·:,;\-–—]+$/g, "").slice(0, max).trim();
    return { t: primo.t, testo: resto || "promemoria" };
  }
  // Quanto manca, nel modo più corto: «1h40», «40m», «ora», «−5m».
  function promTempo(t, ora) {
    const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}` : `${min}m`);
    if (t > ora) return hm(Math.ceil((t - ora) / 60e3));
    const tardi = Math.floor((ora - t) / 60e3);
    return tardi < 1 ? "ora" : "−" + hm(tardi);
  }
  // «FERRARI LUCA» → «Ferrari», «DE LUCA GIOVANNI» → «De Luca», «D'ANGELO M» → «D'Angelo»:
  // il cognome (con le sue particelle) in minuscolo con le iniziali maiuscole
  const PARTICELLE_COGNOME = new Set(["DE", "DI", "DA", "DEL", "DELLA", "DELLE", "DELLO", "DEI", "DEGLI", "DAL", "DALLA", "DALLE", "DALLO",
    "LA", "LO", "LE", "LI", "SAN", "SANTA", "SANTO", "VAN", "VON", "MC", "MAC", "DOS", "DAS", "DU"]);
  function cognomeTitolo(nome) {
    const w = String(nome || "").trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < w.length - 2 && PARTICELLE_COGNOME.has(w[i].toUpperCase())) i++;
    return w.slice(0, i + 1).join(" ").toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }
  // Il colore dell'icona «Da fare»: tranquilla; ambra dai 15 minuti prima;
  // rossa quando l'ora è passata (scaduto).
  function promBanda(t, ora) { return t <= ora ? "ros" : t - ora <= 15 * 60e3 ? "amb" : ""; }
  // La sveglia sulla pill ridotta, quella di sempre: a 10 minuti, o passata.
  const promAllarme = (t, ora) => Math.ceil((t - ora) / 60e3) <= 10;
  // l'ora fissata, col giorno quando non è oggi: «11:30», «domani 07:30»
  function promOra(t, ora) {
    const giorno = (x) => { const d = new Date(x); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const g = Math.round((giorno(t) - giorno(ora)) / 864e5);
    return `${g === 1 ? "domani " : g === -1 ? "ieri " : ""}${hhmm(t)}`;
  }
  // per esteso, per il passaggio del mouse: «11:30 · tropo · tra 15 min»
  function promRiga(p, ora) {
    const parole = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);
    const tardi = Math.floor((ora - p.t) / 60e3);
    const quando = p.t > ora ? "tra " + parole(Math.ceil((p.t - ora) / 60e3)) : tardi < 1 ? "adesso" : "in ritardo di " + parole(tardi);
    return `${promOra(p.t, ora)}${p.testo ? " · " + p.testo : ""} · ${quando}`;
  }
  const dfId = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const dfValida = (x) => x && typeof x.id === "string" && typeof x.testo === "string"
    && (x.t == null || Number.isFinite(x.t)) && (x.fatto == null || Number.isFinite(x.fatto));
  // Le voci di tutti, ognuna nel suo ordine; quelle scadute e quelle spuntate
  // da più di 5 minuti restano fuori.
  // (3.90) Una lettura non scrive: ogni scheda la fa a ogni disegno, il tabellone compreso, e scrivere qui era
  // riscrivere il valore intero dalla propria copia. Le scadute se ne vanno davvero alla prossima scrittura voluta
  // (dfScrivi parte da qui). Solo le voci di una versione di prima (dfMigra) si portano qui, una volta per pagina.
  let dfMigrate = false;
  function dfTutti(ora = Date.now()) {
    if (!dfMigrate) { dfMigrate = true; if (!TABELLONE) dfMigraUnaVolta(ora); }
    let raw = store.get(PROM, {});
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
    const tutti = {};
    for (const [ep, l] of Object.entries(raw)) {
      const vive = /^[\w.-]{1,40}$/.test(ep) && Array.isArray(l)
        ? l.filter((x) => dfValida(x) && !(x.fatto && ora - x.fatto > DF_FATTO)
            && (x.t != null ? ora - x.t <= PROM_TTL : ora - (x.ts || 0) <= DF_TTL))
        : [];
      vive.sort((x, y) => (x.ord ?? 0) - (y.ord ?? 0));
      if (vive.length) tutti[ep] = vive.map((x, i) => ({ id: x.id, testo: x.testo, t: x.t ?? null, fatto: x.fatto ?? null, ord: i, ts: x.ts || ora }));
    }
    return tutti;
  }
  function dfMigraUnaVolta(ora) {
    let raw = store.get(PROM, {});
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
    if (dfMigra(raw, ora)) store.set(PROM, raw);
  }
  // La nota (per paziente) e i promemoria (per episodio) di prima: la nota
  // diventa la prima voce, senza ora, dell'episodio più recente di quel
  // paziente; i promemoria, voci con l'ora. Una nota che non si sa di chi sia
  // (un omonimo, un paziente non in elenco) resta dov'era, finché scade.
  function dfMigra(raw, ora) {
    const vecchi = store.get(PROM_VECCHI, null), note = store.get(noteKey, null);
    const conNote = !!note && typeof note === "object" && Object.keys(note).length > 0;
    if (!vecchi && !conNote) return false;
    const voce = (testo, t, ts) => ({ id: dfId(), testo, t, fatto: null, ord: 0, ts: ts || ora });
    let cambiato = false;
    if (vecchi && typeof vecchi === "object") {
      for (const [ep, l] of Object.entries(vecchi)) {
        if (!/^[\w.-]{1,40}$/.test(ep) || !Array.isArray(l)) continue;
        const qui = Array.isArray(raw[ep]) ? raw[ep] : [];
        for (const p of l) {
          if (!p || !Number.isFinite(p.t) || typeof p.testo !== "string" || qui.some((x) => x.id === p.id)) continue;
          qui.push({ ...voce(p.testo, p.t, p.ts), id: typeof p.id === "string" ? p.id : dfId(), ord: qui.length + 1000 });
        }
        if (qui.length) { raw[ep] = qui; cambiato = true; }
      }
    }
    if (vecchi) store.del(PROM_VECCHI);
    if (conNote) {
      const pazienti = tuttiPazienti(), attivi = pazienti.filter((p) => !p.arch);
      let tolte = false;
      for (const [k, n] of Object.entries(note)) {
        const testo = String(n?.t || "").replace(/\s*\n+\s*/g, " · ").trim();
        if (!testo || ora - (n.ts || 0) > NOTA_TTL) continue;
        let suoi;
        if (k.startsWith("cf:")) suoi = pazienti.filter((p) => p.pk === k);
        else {
          const nome = k.replace(/^nome:/, "");
          if (attivi.filter((p) => normNome(p.name) === nome).length > 1) continue;   // un omonimo: non si attribuisce
          suoi = pazienti.filter((p) => !String(p.pk || "").startsWith("cf:") && normNome(p.name) === nome);
        }
        const p = [...suoi].sort((a, b) => (!!a.arch - !!b.arch) || (b.ts || 0) - (a.ts || 0))[0];
        if (!p) continue;
        const qui = Array.isArray(raw[p.ep]) ? raw[p.ep] : [];
        qui.unshift({ ...voce(testo.slice(0, 500), null, n.ts), ord: -1e6 });
        raw[p.ep] = qui;
        delete note[k];
        tolte = cambiato = true;
      }
      if (tolte) store.set(noteKey, note);
    }
    return cambiato;
  }
  // tutte le voci di un paziente, nel suo ordine (anche quelle appena spuntate)
  const dfDi = (ep, tutti = dfTutti()) => (ep && tutti[ep] ? tutti[ep].map((x) => ({ ...x })) : []);
  const dfAperte = (ep, tutti) => dfDi(ep, tutti).filter((x) => !x.fatto);
  function dfScrivi(ep, l) {
    if (!ep) return false;
    const tutti = dfTutti();
    if (l.length) tutti[ep] = l.map((x, i) => ({ ...x, ord: i })); else delete tutti[ep];
    return store.set(PROM, tutti);
  }
  // Una voce nuova, in fondo (la prima resta il post-it). Con un'ora scritta
  // dentro è un promemoria; senza, una cosa da fare. null: troppe, o vuota.
  function dfAggiungi(ep, testo, { t, inCima = false, max = DF_LUNGO } = {}) {
    const s = String(testo || "").replace(/\s+/g, " ").trim();
    const l = dfDi(ep);
    if (!ep || !s || l.filter((x) => !x.fatto).length >= PROM_MAX) return null;
    let quando = t ?? null, cosa = s;
    if (t === undefined) {
      const p = leggiPromemoria(s, Date.now(), DF_LUNGO);
      if (p) { quando = p.t; cosa = p.testo; }
    }
    const x = { id: dfId(), testo: cosa.slice(0, max), t: quando, fatto: null, ord: 0, ts: Date.now() };
    if (inCima) l.unshift(x); else l.push(x);
    return dfScrivi(ep, l) ? x : null;
  }
  // spuntata (o tolta la spunta): resta al suo posto, barrata, 5 minuti
  function dfSpunta(ep, id, si = true) {
    const l = dfDi(ep), x = l.find((v) => v.id === id);
    if (!x) return null;
    x.fatto = si ? Date.now() : null;
    x.ts = Date.now();
    return dfScrivi(ep, l) ? x : null;
  }
  // in un altro posto della lista: `a` è l'indice nuovo
  function dfSposta(ep, id, a) {
    const l = dfDi(ep), i = l.findIndex((v) => v.id === id);
    if (i < 0) return false;
    const [x] = l.splice(i, 1);
    l.splice(Math.max(0, Math.min(l.length, a)), 0, x);
    return dfScrivi(ep, l);
  }
  function dfCambia(ep, id, testo) {
    const l = dfDi(ep), x = l.find((v) => v.id === id);
    if (!x) return false;
    x.testo = String(testo).slice(0, 500); x.ts = Date.now();
    return dfScrivi(ep, l);
  }
  const dfTogli = (ep, id) => dfScrivi(ep, dfDi(ep).filter((x) => x.id !== id));
  // Il post-it: la prima voce aperta, nell'ordine del medico
  const dfPrima = (ep, tutti) => dfAperte(ep, tutti)[0] || null;
  // La «nota» del telefono è la prima voce aperta SENZA ora (vedi il Ponte)
  const dfNota = (ep, tutti) => dfAperte(ep, tutti).find((x) => x.t == null) || null;

  // Il «Da fare» GENERALE, sul tabellone: una lista sola, di nessun paziente,
  // con le stesse spunte. Non scade; una voce spuntata resta 5 minuti, poi se
  // ne va, come quelle dei pazienti. In questo browser (e nello specchio del
  // tabellone), mai al telefono; «Dimentica i dati…» la porta via.
  const DF_GEN = "dafare.generale.v1";        // [{ id, testo, fatto|null, ts }]
  const DF_GEN_MAX = 40;                      // voci aperte
  function genTutte(ora = Date.now()) {
    const raw = store.get(DF_GEN, []), l = Array.isArray(raw) ? raw : [];
    const vive = l.filter((x) => x && typeof x.id === "string" && typeof x.testo === "string"
      && (x.fatto == null || Number.isFinite(x.fatto)) && !(x.fatto && ora - x.fatto > DF_FATTO));
    // (3.90) una lettura non scrive: le spuntate da tanto restano fuori, e se ne vanno alla prossima scrittura voluta
    return vive.map((x) => ({ id: x.id, testo: x.testo, t: null, fatto: x.fatto ?? null, ts: x.ts || ora }));
  }
  function genAggiungi(testo) {
    const s = String(testo || "").replace(/\s+/g, " ").trim().slice(0, DF_LUNGO), l = genTutte();
    if (!s || l.filter((x) => !x.fatto).length >= DF_GEN_MAX) return null;
    const x = { id: dfId(), testo: s, fatto: null, ts: Date.now() };
    return store.set(DF_GEN, [...l, x]) ? x : null;
  }
  function genCambia(id, fai) {
    const l = genTutte(), x = l.find((v) => v.id === id);
    if (!x) return false;
    fai(x); x.ts = Date.now();
    return store.set(DF_GEN, l);
  }
  const genSpunta = (id, si = true) => genCambia(id, (x) => { x.fatto = si ? Date.now() : null; });
  const genTesto = (id, testo) => genCambia(id, (x) => { x.testo = String(testo).slice(0, 500); });
  const genTogli = (id) => store.set(DF_GEN, genTutte().filter((x) => x.id !== id));

  // I promemoria sono le voci aperte con un'ora: le stesse funzioni di prima,
  // così la sveglia sulla pill, il +15′ e il telefono restano quelli.
  function promTutti(tutti = dfTutti()) {
    const out = {};
    for (const [ep, l] of Object.entries(tutti)) {
      const p = l.filter((x) => x.t != null && !x.fatto).map((x) => ({ id: x.id, t: x.t, testo: x.testo, ts: x.ts }));
      if (p.length) out[ep] = p;
    }
    return out;
  }
  // quelli di un paziente, il più vicino per primo
  const promDi = (ep, tutti = promTutti()) => (ep && tutti[ep] ? [...tutti[ep]].sort((a, b) => a.t - b.t) : []);
  const promAggiungi = (ep, p) => !!dfAggiungi(ep, String(p.testo || "").slice(0, 40), { t: p.t });
  // ✓ Fatto: spuntato (se ne va fra 5 minuti; «Annulla» toglie la spunta)
  function promTogli(ep, id) {
    const x = dfDi(ep).find((v) => v.id === id && v.t != null && !v.fatto);
    return x && dfSpunta(ep, id, true) ? { id: x.id, t: x.t, testo: x.testo, ts: x.ts } : null;
  }
  // «+15 min»: da quando era fissato, o da adesso se è già passato
  function promRinvia(ep, id, ms = 15 * 60e3) {
    const l = dfDi(ep), p = l.find((x) => x.id === id && x.t != null);
    if (!p) return false;
    p.t = Math.floor((Math.max(p.t, Date.now()) + ms) / 60e3) * 60e3;
    return dfScrivi(ep, l);
  }
  function promRimetti(ep, p) {
    if (dfDi(ep).some((x) => x.id === p.id)) return !!dfSpunta(ep, p.id, false);
    return !!dfAggiungi(ep, p.testo, { t: p.t });
  }

  // (il Cronometro non c'è più: i tempi che teneva se ne vanno, una volta)
  store.del("tempi.v1");
  const giornoDi = (ms) => new Date(ms).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });

  const dimKey = "dimissioni.v1";
  // A short fingerprint of the text a doctor's version was forked from. It is
  // what lets a later release SAY that the original changed (a dose, a
  // contraindication): without it, a corrected sheet would be silently
  // invisible to everyone who had ever edited that sheet.
  function impronta(testo) {
    let h = 0x811c9dc5;
    const t = String(testo || "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  const dimValido = (v) => !!(v && typeof v.testo === "string" && v.testo.trim());
  // un foglio nuovo, prima di avere un nome: la chiave dell'editor vuoto
  const DIM_NUOVO = "+nuovo";
  function dimissioni() {
    const mie = store.get(dimKey, {});
    const out = {};
    // i fogli scritti dal medico vengono per primi: li ha voluti lui
    for (const [k, v] of Object.entries(mie)) {
      if (!DIMISSIONI[k] && dimValido(v)) out[k] = { nome: (v.nome || k), testo: v.testo, originale: "", modificato: true, mio: true };
    }
    for (const [k, v] of Object.entries(DIMISSIONI)) {
      const m = dimValido(mie[k]) ? mie[k] : null;
      out[k] = {
        nome: v.nome, testo: m ? m.testo : v.testo, originale: v.testo, modificato: !!m,
        rivisto: !!v.rivisto,
        // the shipped text moved AFTER this doctor forked it
        aggiornato: !!(m && m.base && m.base !== impronta(v.testo)),
      };
    }
    return out;
  }
  function salvaDimissione(k, nome, testo) {
    const mie = store.get(dimKey, {});
    const base = DIMISSIONI[k];
    if (base && testo.trim() === base.testo.trim()) delete mie[k];   // back to the original: stop overriding
    else mie[k] = { nome, testo, base: base ? impronta(base.testo) : "" };
    return store.set(dimKey, mie);
  }
  function ripristinaDimissione(k) {
    const mie = store.get(dimKey, {});
    delete mie[k];
    return store.set(dimKey, mie);
  }

  // EO — un elenco piatto chiave→voce, così una riga o una tendina copiano
  // allo stesso modo. I testi sono quelli scritti dal medico, verbatim.
  // Il medico li può riscrivere (✎), come i fogli di dimissione: la sua
  // versione sta in "eo.v1" e ricorda da quale originale è partita, così se
  // l'originale cambia glielo si dice.
  const eoKey = "eo.v1";
  function eoVoci() {
    const out = {};
    // gli EO di base, uno per riga in cima: prima quelli del medico («Mio
    // solito base»), poi l'EO generale
    for (const v of EO.basi || []) if (v && v.k && v.testo) out["base:" + v.k] = { nome: v.nome || v.k, meta: v.meta || "", testo: v.testo, gruppo: "base" };
    if (EO.base && EO.base.testo) out.base = { nome: EO.base.nome || "EO generale", meta: EO.base.meta || "", testo: EO.base.testo, gruppo: "base" };
    for (const v of EO.casi || []) if (v && v.k && v.testo) out["caso:" + v.k] = { nome: v.nome || v.k, testo: v.testo, gruppo: "casi" };
    for (const v of EO.frasi || []) if (v && v.k && v.testo) out["frase:" + v.k] = { nome: v.nome || v.k, testo: v.testo, gruppo: "frasi" };
    const mie = store.get(eoKey, {}) || {};
    for (const [k, v] of Object.entries(out)) {
      const m = Object.prototype.hasOwnProperty.call(mie, k) && dimValido(mie[k]) ? mie[k] : null;
      v.originale = v.testo;
      if (!m) continue;
      v.testo = m.testo; v.modificato = true;
      v.aggiornato = !!(m.base && m.base !== impronta(v.originale));
    }
    return out;
  }
  function salvaEo(k, testo) {
    const v = eoVoci()[k];
    if (!v) return false;
    const mie = store.get(eoKey, {}) || {};
    if (testo.trim() === v.originale.trim()) delete mie[k];   // tornato com'era: niente da ricordare
    else mie[k] = { testo, base: impronta(v.originale) };
    return store.set(eoKey, mie);
  }
  function ripristinaEo(k) {
    const mie = store.get(eoKey, {}) || {};
    delete mie[k];
    return store.set(eoKey, mie);
  }

