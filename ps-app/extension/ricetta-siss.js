/*
 * PS Assist — «Ricetta SISS», nella scheda del Prescrittivo Regionale.
 *
 * Fa qualcosa SOLO per una ricetta che il service worker le consegna
 * (ricetta-sw.js: «chi sono?», una volta sola). Allora guida l'app come una
 * persona, attraverso la sua interfaccia — mai una richiesta fatta da noi:
 *   Home → «Nuova Prescrizione» → identificazione col codice fiscale → Cerca
 *   → l'intestazione del SISS deve essere il paziente del gestionale (Cognome,
 *   Nome, Id personale = CF), o «Errore grave» e stop → ogni farmaco scritto
 *   nella ricerca del SISS e scelto col suo codice esatto → Quantità,
 *   «Non sostituibile» → quesito → ANTEPRIMA, e qui si ferma.
 * Registra, Salva, Stampa, Cancella: mai (clicca() li rifiuta). Le pagine di
 * accesso, la carta, il PIN: mai toccati. Ogni passo si rilegge dal DOM; una
 * cosa che non torna ferma tutto e dice dove, lasciando quello che è scritto.
 * Il medico che scrive in questa scheda ferma la compilazione.
 *
 * Fuori da una ricetta: dice al service worker quando la scheda è entrata
 * (per la ricetta che aspettava il login) e, su ogni Anteprima, quali farmaci
 * mostra (codice, descrizione, quantità: i preferiti del pannello).
 */
(() => {
  if (window.__psaRicetta || window.top !== window) return;
  window.__psaRicetta = true;
  const ask = (m) => new Promise((res) => {
    try { chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; res(r || null); }); } catch { res(null); }
  });
  // I tempi. La scheda del SISS di solito è dietro, e da tanto: Chrome ne
  // rallenta i timer (anche a uno al minuto, se sono in fila). Qui si aspetta
  // sui cambiamenti della pagina (MutationObserver), col timer solo di riserva,
  // e le pause brevi passano dai messaggi (MessageChannel), che non rallentano.
  const tick = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  async function dorme(ms) { for (const fine = Date.now() + ms; Date.now() < fine;) await tick(); }
  const cambio = (ms) => new Promise((r) => {
    let t = null;
    const mo = new MutationObserver(() => { mo.disconnect(); clearTimeout(t); r(); });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    t = setTimeout(() => { mo.disconnect(); r(); }, ms);
  });
  const testo = (el) => String((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ------------------------------------------------------------ le viste
  const vista = () => {
    const p = location.pathname;
    if (/\/pages\/prescription\/editing\/preview/.test(p)) return "anteprima";
    if (/\/pages\/prescription\/editing/.test(p)) return "editing";
    if (/\/pages\/prescription\/patient-identify/.test(p)) return "identifica";
    if (/\/pages\/dashboard/.test(p)) return "dashboard";
    if (/\/login\b|\/pile-api\//.test(p)) return "accesso";
    return "altro";
  };
  // entrato: l'app disegnata con l'operatore in alto (la pagina d'accesso non ce l'ha)
  const dentro = () => vista() !== "accesso" && !!$("app-layout app-header-user");
  const libero = () => !$("app-loader .spinner-container");
  const dialogo = () => $(".cdk-overlay-container mat-dialog-container");
  const ricercaBox = () => $("app-prescription-regional-specialties-search input") || $('input[placeholder="Ricerca specialistica/farmaco"]');
  const quesitoBox = () => $("app-prescription-create app-prescription-diagnostic-question input[formcontrolname=diagnosticQuestionText]");
  const righeFarmaci = (r = document) => $$("app-prescription-drugs tbody tr", r).filter((tr) => $("td.mat-column-code", tr));
  const codiceRiga = (tr) => (testo($("td.mat-column-code", tr)).match(/\b\d{6,10}\b/) || [""])[0];
  // c'è già una ricetta qui? (una scheda così non si usa: è del medico)
  const conContenuto = () => vista() === "anteprima"
    || (vista() === "editing" && (righeFarmaci().length > 0 || !!(quesitoBox()?.value || "").trim() || !!(ricercaBox()?.value || "").trim()));

  // il medico sta scrivendo qui? (solo i suoi tasti veri: i nostri eventi non
  // sono «isTrusted». Non «input»: quello di una casella premuta da noi lo è)
  let suoTasto = 0;
  for (const ev of ["keydown", "paste"]) document.addEventListener(ev, (e) => { if (e.isTrusted) suoTasto = Date.now(); }, true);
  const scrive = () => Date.now() - suoTasto < 4000;

  // ------------------------------------------------------------ i gesti
  // Un clic solo dove serve: mai su un bottone che registra, salva, stampa,
  // cancella o esce. Il controllo guarda il testo, il tooltip e l'etichetta.
  // (una voce della tendina è un farmaco: il suo nome può contenere qualunque parola)
  const VIETATO = /\b(registra|salva|stampa|cancella|elimina|annulla|invia|firma|logout|esci)/i;
  function clicca(el) {
    if (!el) throw new Error("niente da premere");
    const b = el.closest("button, a, mat-card, mat-option, mat-radio-button, [role=button]") || el;
    const etich = [testo(b), b.getAttribute("mattooltip"), b.getAttribute("title"), b.getAttribute("aria-label")].filter(Boolean).join(" ");
    if (b.tagName !== "MAT-OPTION" && VIETATO.test(etich)) throw new Error(`non premo «${etich.slice(0, 40)}»`);
    el.click();
  }
  // Un campo di Angular: il valore col setter nativo, poi gli eventi che l'app ascolta
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  function scrivi(el, v, { tasti = false } = {}) {
    el.focus();
    if (tasti) {
      for (let i = 1; i <= v.length; i++) {
        setter.call(el, v.slice(0, i));
        el.dispatchEvent(new KeyboardEvent("keydown", { key: v[i - 1], bubbles: true }));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: v[i - 1], bubbles: true }));
      }
    } else {
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const lascia = (el) => { el.dispatchEvent(new Event("blur")); el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); el.blur(); };
  // aspetta che una cosa sia vera, con l'app libera (niente rotella)
  async function finche(fn, ms = 15000) {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await cambio(400)) {
      if (fermata) throw new Fermo("fermata da te");
      if (scrive()) throw new Fermo("stai scrivendo nel SISS: completa tu");
      if (!libero()) continue;
      const x = fn();
      if (x) return x;
    }
    return null;
  }
  class Fermo extends Error {}

  // ------------------------------------------------------------ la ricetta
  let lavoro = null, fermata = false, cercate = 0, compilando = false;
  const passo = (t) => ask({ t: "ricettaPasso", id: lavoro.id, testo: t });
  const fine = (esito, testo, extra = {}) => ask({ t: "ricettaFine", id: lavoro.id, esito, testo, ...extra });

  async function aIdentifica() {
    if (vista() === "identifica" && $("#idCard")) return;
    if (vista() !== "dashboard") {
      const home = $('a[href$="/prescrittivoRegionale/pages/dashboard"]');
      if (!home) throw new Fermo("Fermato su «Home»: non trovo il link nel SISS");
      clicca(home);
      if (!await finche(() => vista() === "dashboard")) throw new Fermo("Fermato su «Home»: il SISS non torna alla pagina iniziale");
    }
    const card = await finche(() => $$("mat-card").find((c) => testo($("p", c)) === "Nuova Prescrizione"));
    if (!card) throw new Fermo("Fermato su «Nuova Prescrizione»: non la trovo nel SISS");
    clicca(card);
    if (!await finche(() => vista() === "identifica" && $("#idCard"))) throw new Fermo("Fermato su «Nuova Prescrizione»: la pagina di identificazione non si apre");
  }
  // il paziente dell'intestazione: «Cognome: X», «Nome: Y», «Id personale: CF»
  function intestazione() {
    const r = $("app-prescription-patient");
    if (!r) return null;
    const campo = (et) => {
      const s = $$("span", r).find((x) => new RegExp(`^${et}:`).test(testo(x).replace(/^\s+/, "")) && $(".npri-very-bold", x));
      return s ? testo($(".npri-very-bold", s)) : "";
    };
    return { cognome: campo("Cognome"), nome: campo("Nome"), cf: campo("Id personale").toUpperCase() };
  }
  const parole = (s) => norm(s).split(" ").filter(Boolean).sort().join(" ");

  async function identifica() {
    await aIdentifica();
    await passo("Identifico il paziente nel SISS…");
    const box = $("#idCard");
    scrivi(box, lavoro.cf);
    lascia(box);
    if (box.value !== lavoro.cf) throw new Fermo("Fermato su «ID Personale»: il codice fiscale non si è scritto");
    const cerca = await finche(() => $$("app-patient-search-filters button[type=submit]").find((b) => testo(b) === "Cerca" && !b.disabled), 8000);
    if (!cerca) throw new Fermo("Fermato su «Cerca» paziente: il SISS non lo lascia premere");
    clicca(cerca);
    const ok = await finche(() => vista() === "editing" && intestazione()?.cf, 30000);
    if (!ok) throw new Fermo(dialogo() ? "Fermato sull'identificazione: il SISS mostra un messaggio — leggilo tu"
      : "Fermato sull'identificazione: il SISS non ha aperto la ricetta del paziente — scegli tu il paziente");
    const h = intestazione();
    const cfOk = h.cf === lavoro.cf, nomeOk = parole(`${h.cognome} ${h.nome}`) === parole(lavoro.nome);
    if (!cfOk || !nomeOk) {
      const e = new Fermo("Errore grave: il SISS mostra un altro paziente. Non ho scritto niente: controlla nel SISS.");
      e.grave = true; e.passo = "paziente"; e.dati = { cf: cfOk ? "uguale" : "diverso", nome: nomeOk ? "uguale" : "diverso" };
      throw e;
    }
    if (!ricercaBox()) throw new Fermo("Fermato sulla ricerca: non trovo «Ricerca specialistica/farmaco»");
  }

  // le voci della tendina della ricerca: «039785098 - AUGMENTIN*OS …»
  const opzioni = () => $$(".cdk-overlay-container mat-option").map((o) => {
    const m = /^(\S+)\s+-\s+(.+)$/.exec(testo($(".mat-option-text", o) || o));
    return m ? { el: o, codice: m[1], descr: m[2] } : null;
  }).filter(Boolean);
  const chiudiTendina = (box) => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true })); };
  async function digita(q) {
    const box = ricercaBox();
    if (!box) throw new Fermo("Fermato sulla ricerca: il campo non c'è più");
    scrivi(box, "");
    scrivi(box, q, { tasti: true });
    // la tendina, ferma per un attimo (le voci arrivano dal SISS)
    let prima = -1, da = Date.now();
    await finche(() => {
      const n = opzioni().length;
      if (n !== prima) { prima = n; da = Date.now(); }
      return n > 0 && Date.now() - da >= 600;
    }, 12000);
    return box;
  }
  async function svuota(box) { chiudiTendina(box); scrivi(box, ""); lascia(box); await dorme(200); }

  async function cerca(c) {
    cercate = c.n;
    const box = await digita(c.q);
    const tutte = opzioni();
    // (farmaci e visite/esami: il service worker li distingue dal codice)
    const voci = tutte.map((o) => ({ codice: o.codice, descr: o.descr }));
    await svuota(box);
    await ask({ t: "ricettaRisultati", id: lavoro.id, q: c.q, n: c.n, voci, altri: 0, why: tutte.length ? "" : "il SISS non ha trovato niente" });
  }

  // Una visita o un esame: la stessa ricerca, la voce col codice esatto. La
  // tabella delle prestazioni non è nelle registrazioni: si controlla che la
  // tendina si sia chiusa e che il codice ora compaia nella ricetta (fuori
  // dalla tendina), dove prima non c'era. Priorità, durata, quantità: no —
  // li mette il medico.
  const nelModulo = (codice) => {
    const f = $("app-prescription-create");
    return !!f && testo(f).split(/[\s,;:()\[\]|]+/).some((t) => t.replace(/[-.]+$/, "") === codice);
  };
  async function aggiungiVisita(v) {
    if (nelModulo(v.codice)) throw new Fermo(`Fermato su ${v.descr || v.codice}: è già nella ricetta del SISS`);
    await passo(`Cerco ${v.descr || v.codice} nel SISS…`);
    const prove = [...new Set([v.cerca, v.codice].map((x) => String(x || "").trim()).filter(Boolean))];
    let scelta = null, box = null;
    for (const q of prove) {
      box = await digita(q);
      scelta = opzioni().find((o) => o.codice === v.codice);
      if (scelta) break;
      await svuota(box);
    }
    if (!scelta) throw new Fermo(`Fermato su ${v.descr || v.codice}: la ricerca del SISS non la trova col codice ${v.codice} — aggiungila tu`);
    clicca(scelta.el);
    const ok = await finche(() => (dialogo() ? "dialogo" : !opzioni().length && nelModulo(v.codice) ? "si" : null), 15000);
    if (ok === "dialogo") throw new Fermo(`Fermato su ${v.descr || v.codice}: il SISS mostra un messaggio — leggilo tu`);
    if (!ok) throw new Fermo(`Fermato su ${v.descr || v.codice}: scelta nella ricerca, ma non compare nella ricetta del SISS`);
    if (box && box.value) await svuota(box);
  }

  async function aggiungi(v) {
    if (v.tipo === "visita") return aggiungiVisita(v);
    const gia = righeFarmaci().filter((tr) => codiceRiga(tr) === v.codice).length;
    if (gia) throw new Fermo(`Fermato su ${v.descr || v.codice}: è già nella ricetta del SISS`);
    await passo(`Cerco ${v.descr || v.codice} nel SISS…`);
    const prove = [...new Set([v.cerca, v.codice].map((x) => String(x || "").trim()).filter(Boolean))];
    let scelta = null, box = null;
    for (const q of prove) {
      box = await digita(q);
      scelta = opzioni().find((o) => o.codice === v.codice);
      if (scelta) break;
      await svuota(box);
    }
    if (!scelta) throw new Fermo(`Fermato su ${v.descr || v.codice}: la ricerca del SISS non lo trova col codice ${v.codice} — aggiungilo tu`);
    clicca(scelta.el);
    const riga = await finche(() => righeFarmaci().find((tr) => codiceRiga(tr) === v.codice) || (dialogo() ? "dialogo" : null), 15000);
    if (riga === "dialogo") throw new Fermo(`Fermato su ${v.descr || v.codice}: il SISS mostra un messaggio — leggilo tu`);
    if (!riga) throw new Fermo(`Fermato su ${v.descr || v.codice}: scelto nella ricerca, ma non compare nella ricetta del SISS`);
    if (box && box.value) await svuota(box);
    // Quantità
    if (v.qta !== 1 || $("input[formcontrolname=quantity]", riga)?.value !== "1") {
      const qb = $("input[formcontrolname=quantity]", riga);
      if (!qb) throw new Fermo(`Fermato su «Quantità» di ${v.descr}: il campo non c'è`);
      setter.call(qb, String(v.qta));
      qb.dispatchEvent(new Event("input", { bubbles: true }));
      qb.dispatchEvent(new Event("change", { bubbles: true }));
      await dorme(150);
      if (qb.value !== String(v.qta)) throw new Fermo(`Fermato su «Quantità» di ${v.descr}: il SISS non ha preso ${v.qta}`);
    }
    // Sostituibile / Non sostituibile
    if (v.ns) {
      const cella = $("td.mat-column-substitutability", riga);
      const rb = cella && $$("mat-radio-button", cella).find((r) => /^non sostituibile$/i.test(testo(r)));
      const inp = rb && $("input[type=radio]", rb);
      if (!inp) throw new Fermo(`Fermato su «Non sostituibile» di ${v.descr}: la scelta non c'è`);
      const campi = $$("input:not([type=radio]), mat-select, textarea", cella).length;
      clicca(inp);
      const preso = await finche(() => inp.checked && rb.classList.contains("mat-radio-checked"), 5000);
      if (!preso) throw new Fermo(`Fermato su «Non sostituibile» di ${v.descr}: il SISS non l'ha presa`);
      await dorme(300);
      if ($$("input:not([type=radio]), mat-select, textarea", cella).length > campi) {
        throw new Fermo(`Fermato su «Non sostituibile» di ${v.descr}: il SISS chiede la motivazione — sceglila tu, poi Anteprima`);
      }
    }
  }

  async function compila(voci, quesito) {
    compilando = true;
    const visite = voci.some((v) => v.tipo === "visita");
    // Tipo prescrizione: deve poter avere quello che si mette (di norma «Specialistica/Farmaceutica»)
    const tipo = testo($("mat-select[formcontrolname=prescriptionType] .mat-select-value"));
    const serve = visite ? /specialistica/i : /farmaceutica/i;
    if (!serve.test(tipo)) throw new Fermo(`Fermato su «Tipo prescrizione»: è «${tipo || "vuoto"}», non ${visite ? "specialistica" : "farmaceutica"} — sceglila tu`);
    for (const v of voci) await aggiungi(v);
    if (quesito) {
      const q = quesitoBox();
      if (!q) throw new Fermo("Fermato sul quesito: il campo «Quesito diagnostico testuale» non c'è");
      scrivi(q, quesito.slice(0, 256));
      lascia(q);
      await dorme(150);
      if (q.value !== quesito.slice(0, 256)) throw new Fermo("Fermato sul quesito: il SISS non l'ha preso");
    }
    // con una visita l'Anteprima NON si preme: quesito e durata li mette il medico
    if (visite) {
      if (!voci.every((v) => v.tipo !== "visita" || nelModulo(v.codice))) throw new Fermo("Fermato: nella ricetta del SISS non vedo tutte le visite scelte — controlla tu");
      return "inserite";
    }
    // la ricetta è quella e basta: i farmaci scelti, nessuno in più
    const codici = righeFarmaci().map(codiceRiga).sort().join(",");
    if (codici !== voci.map((v) => v.codice).sort().join(",")) throw new Fermo("Fermato prima dell'Anteprima: nella ricetta del SISS ci sono farmaci diversi da quelli scelti");
    const ant = await finche(() => $$("app-sticky-bottom-toolbar button").find((b) => testo(b) === "Anteprima" && !b.disabled), 8000);
    if (!ant) throw new Fermo("Fermato su «Anteprima»: il SISS non la lascia premere (manca qualcosa?)");
    await passo("Anteprima…");
    clicca(ant);
    const fatto = await finche(() => (dialogo() ? "dialogo" : vista() === "anteprima" && $("app-prescription-previews") && /STATO:\s*BOZZA/.test(testo($("app-prescription-previews"))) ? "si" : null), 30000);
    if (fatto !== "si") {
      const d = dialogo();
      if (d && /stampa|nre|registrat/i.test(testo(d))) {
        const e = new Fermo("Attenzione: il SISS dice di aver registrato la ricetta. Controlla subito nel SISS.");
        e.grave = true; e.passo = "anteprima"; throw e;
      }
      throw new Fermo(d ? "Fermato sull'Anteprima: il SISS mostra un messaggio — leggilo tu" : "Fermato sull'Anteprima: non si è aperta");
    }
    const visti = righeFarmaci($("app-prescription-previews")).map(codiceRiga);
    if (!voci.every((v) => visti.includes(v.codice))) throw new Fermo("Fermato sull'Anteprima: non mostra tutti i farmaci scelti — controlla tu");
  }

  // Il giro: identificazione, poi i comandi del pannello (una ricerca, i
  // farmaci) finché non c'è l'Anteprima.
  async function gira() {
    try {
      await identifica();
      for (;;) {
        campanello = false;
        const r = await ask({ t: "ricettaPronto", id: lavoro.id });
        if (!r || !r.ok) return;   // fermata, scaduta: il pannello lo dice già
        if (r.voci) {
          const esito = await compila(r.voci, r.quesito);
          await fine(esito === "inserite" ? "inserite" : "anteprima");
          return;
        }
        if (r.cerca && r.cerca.n > cercate) { await cerca(r.cerca); continue; }
        // aspetta un comando (ricettaComando), al più 20 minuti — uno arrivato
        // mentre si chiedeva non si perde
        if (campanello) continue;
        await new Promise((res) => { sveglia = res; setTimeout(res, 20 * 60e3); });
        sveglia = null;
        if (fermata) return;
      }
    } catch (e) {
      if (fermata) return;
      const t = e instanceof Fermo ? e.message : `Fermato: ${String(e && e.message || e).slice(0, 120)} — completa tu nel SISS`;
      await fine(e && e.grave ? "errore" : "fermo", t, { grave: !!(e && e.grave), passo: (e && e.passo) || (compilando ? "compilazione" : "identificazione"), dati: (e && e.dati) || null });
    } finally { lavoro = null; }
  }
  let sveglia = null, campanello = false;

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (!m || typeof m !== "object") return;
    if (m.t === "ricettaStato") { reply({ vista: vista(), dentro: dentro(), occupata: !lavoro && conContenuto(), scrive: scrive() }); return; }
    if (m.t === "ricettaSveglia") {
      reply({ ok: true });
      if (lavoro) return;
      ask({ t: "ricettaChi" }).then((r) => {
        if (!r || !r.lavoro || lavoro) return;
        lavoro = r.lavoro; fermata = false; cercate = 0; compilando = false;
        gira();
      });
      return;
    }
    if (m.t === "ricettaComando") { reply({ ok: true }); if (lavoro && lavoro.id === m.id) { campanello = true; if (sveglia) sveglia(); } return; }
    if (m.t === "ricettaFerma") { reply({ ok: true }); if (lavoro && lavoro.id === m.id) { fermata = true; if (sveglia) sveglia(); } return; }
  });

  // ------------------------------------------------------------ fuori dalla ricetta
  // La vista cambia senza ricaricare (pushState): la si guarda ogni tanto.
  // Entrata → lo si dice (una ricetta aspettava il login). Un'Anteprima → i
  // farmaci che mostra diventano i preferiti (niente del paziente).
  let ultima = "", imparato = "", nata = Date.now();   // (quando è nata questa pagina: la prima volta lo si dice)
  setInterval(() => {
    const v = `${vista()}|${dentro()}`;
    if (v !== ultima) { ultima = v; if (dentro()) { ask({ t: "ricettaQui", vista: vista(), dentro: true, nata }); nata = 0; } }
    if (vista() === "anteprima" && libero()) {
      const pv = $("app-prescription-previews");
      const voci = pv ? righeFarmaci(pv).map((tr) => ({ codice: codiceRiga(tr), descr: testo($("td.mat-column-description", tr)),
        qta: Number($("input[formcontrolname=quantity]", tr)?.value) || 1 })).filter((x) => /^\d{9}$/.test(x.codice) && x.descr) : [];
      const firma = location.href + "|" + voci.map((x) => `${x.codice}:${x.qta}`).join(",");
      if (voci.length && firma !== imparato) { imparato = firma; ask({ t: "ricettaImpara", voci }); }
    } else imparato = "";
  }, 500);
})();
