/*
 * PS Assist · l'etichetta libera (⋯ → Etichetta, sul pannello e sull'iPhone).
 *
 * Poche righe scritte dal medico diventano un'etichetta: l'impaginazione è UNA
 * (etichetta.js, lo stesso file del telefono), e da lei escono l'anteprima e il
 * PDF. Il PDF lo fa questo PC, nella misura delle etichette vere (quella che
 * l'aiutante ha detto all'ultima stampa, se no 50×25 mm), e va per le strade di
 * sempre (stampaDalTel → ordStampaFogli): l'etichettatrice di questo PC con
 * l'aiutante, o la stazione di stampa collegata (Infermeria), col tipo di foglio
 * «etichette». Le garanzie restano quelle: un numero per foglio (`rid`), una
 * stampa sola per numero, «Mandato»/«sconosciuto» detti per quello che sono,
 * «Infermeria non risponde» dalla stazione. Il testo non si tiene: vive nel PDF
 * in memoria finché il foglio non è partito (PDF_TEL), e nel Registro va solo
 * «etichetta libera, N righe».
 */
const ETI_NOME = "Etichetta libera";
const ETI_FRESCA = 30e3;        // dal telefono: vale 30 secondi dal tocco, come un ordine o «Passa all'area»
const ETI_ATTESA = 110e3;       // l'aiutante di stampa risponde entro 90 secondi
const ETI_RID = /^[\w-]{8,20}$/;

async function etichettaMisura() {
  const o = await chrome.storage.local.get("stampaMisura").catch(() => ({}));
  return PSEtichetta.misuraDi(o.stampaMisura);
}
// Dove può andare: l'etichettatrice di questo PC (la stampa automatica impostata) e/o la stazione collegata
async function etichettaDove() {
  const o = await chrome.storage.local.get(["stampa", "stazione.coppia"]).catch(() => ({}));
  const s = o.stampa || {}, c = o["stazione.coppia"];
  return { qui: !!(s.etichette && s.a4) ? corto(s.etichette, 80) : "", stazione: c && !c.revoca ? corto(c.nome || "Infermeria", 40) : "", misura: await etichettaMisura() };
}
async function etichettaAnteprima(testo) {
  const dove = await etichettaDove();
  const imp = PSEtichetta.impagina(testo, dove.misura);
  return imp.ok ? { ok: true, svg: PSEtichetta.svg(imp), righe: imp.righe.length, corpo: imp.corpo, misura: [imp.w, imp.h], dove }
    : { ok: false, errore: imp.errore, misura: dove.misura, dove };
}
const etiDests = (d) => (d === "entrambi" ? ["qui", "stazione"] : d === "stazione" ? ["stazione"] : ["qui"]);
const etiRid = (rid, d) => `${rid}-${d === "stazione" ? "s" : "q"}`;
// Il PDF, e i fogli al motore della stampa. `misura`: quella dell'anteprima che il medico ha guardato —
// cambiata intanto, non si stampa (il PDF non sarebbe quello visto).
async function etichettaStampa({ testo, copie, dest, rid, misura }) {
  if (self.PSA_SOLA_LETTURA === true) return { ok: false, errore: "Questo PC è in sola lettura", solaLettura: true };
  if (typeof rid !== "string" || !ETI_RID.test(rid)) return { ok: false, errore: "Etichetta senza numero: riprova" };
  const n = Number.isInteger(copie) && copie >= 1 && copie <= 10 ? copie : 0;
  if (!n) return { ok: false, errore: "Copie: da 1 a 10" };
  const dove = await etichettaDove();
  const imp = PSEtichetta.impagina(testo, dove.misura);
  if (!imp.ok) return { ok: false, errore: imp.errore };
  if (misura != null && !(Array.isArray(misura) && misura.length === 2 && Number(misura[0]) === imp.w && Number(misura[1]) === imp.h)) {
    return { ok: false, errore: "La misura dell'etichetta è cambiata: guarda di nuovo l'anteprima", misura: [imp.w, imp.h] };
  }
  const ds = etiDests(dest);
  for (const d of ds) {
    if (d === "qui" && !dove.qui) return { ok: false, errore: "Su questo PC l'etichettatrice non è impostata (⋯ → Impostazioni)" };
    if (d === "stazione" && !dove.stazione) return { ok: false, errore: "Nessuna stazione di stampa collegata a questo PC" };
  }
  const pdf = PSEtichetta.pdf(imp);
  const fogli = [];
  for (const d of ds) {
    const r = await stampaDalTel(etiRid(rid, d), pdf, d, ETI_NOME, { copie: n });
    fogli.push({ d, rid: etiRid(rid, d), ok: !!r.ok, gia: !!r.gia, why: r.ok ? "" : corto(r.why, 120) });
  }
  return { ok: true, righe: imp.righe.length, copie: n, fogli, dove };
}
// Com'è andata, per chi l'ha chiesta (pannello o telefono): una riga per destinazione, con le parole del motore
async function etichettaEsito(st, attesa = ETI_ATTESA) {
  const righe = [];
  for (const f of st.fogli) {
    const nome = f.d === "stazione" ? st.dove.stazione : "PC";
    if (!f.ok) { righe.push({ tono: "err", titolo: `Etichetta NON stampata (${nome})`, testo: f.why }); continue; }
    const p = ponteStampaParole(await ponteStampaEsito(f.rid, attesa));
    righe.push({ tono: p.tono, titolo: p.tono === "err" ? `Etichetta NON stampata (${nome})` : p.titolo || "Mandata", testo: p.testo || "" });
  }
  const peso = { err: 3, warn: 2, run: 1, ok: 0 };
  const tono = righe.reduce((a, r) => (peso[r.tono] > peso[a] ? r.tono : a), "ok");
  return { fine: true, tono, titolo: righe.map((r) => r.titolo).join(" · "), testo: righe.map((r) => r.testo).filter(Boolean).join(" · "), righe };
}
const etiNota = (st, e) => `${ETI_NOME}, ${st.righe} ${st.righe === 1 ? "riga" : "righe"}${st.copie > 1 ? ` ×${st.copie}` : ""}: ${e.tono === "ok" ? "stampata" : e.tono === "err" ? "NON stampata" : "da controllare"} (${st.fogli.map((f) => (f.d === "stazione" ? st.dove.stazione : "PC")).join(" + ")})`;

// Dal telefono (ponte-sw.js, cmd «etichetta»): una scrittura col suo numero (rq), fresca (30 s)
async function ponteEtichetta(d) {
  const eta = ponteOra() - d.nato;
  if (!Number.isFinite(d.nato) || eta > ETI_FRESCA || eta < -ETI_FRESCA) {
    ponteNota(`iPhone · ${ETI_NOME.toLowerCase()} arrivata tardi: scaduta, non stampata`);
    await ponteScriviStato();
    return { ok: false, scaduto: true, errore: "Scaduta: non inviata" };
  }
  const testo = typeof d.testo === "string" ? d.testo.slice(0, 400) : "";
  const st = await etichettaStampa({ testo, copie: d.copie, dest: d.dest, rid: d.rid, misura: d.misura });
  if (!st.ok) { ponteNota(`iPhone · ${ETI_NOME.toLowerCase()} rifiutata: ${corto(st.errore, 100)}`); await ponteScriviStato(); return st; }
  const e = await etichettaEsito(st);
  if (!st.fogli.every((f) => f.gia)) { ponteNota("iPhone · " + etiNota(st, e)); await ponteScriviStato(); }
  return { ok: true, dati: e };
}

// Dal pannello (core.js): l'anteprima mentre si scrive, poi «Stampa»
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || !["etichettaAnteprima", "etichettaStampa"].includes(msg.t)) return;
  if (!sulGestionale(sender && sender.url)) return reply({ ok: false, errore: "non dal gestionale" }), true;
  (async () => {
    if (msg.t === "etichettaAnteprima") return reply(await etichettaAnteprima(typeof msg.testo === "string" ? msg.testo.slice(0, 400) : ""));
    const st = await etichettaStampa({ testo: typeof msg.testo === "string" ? msg.testo.slice(0, 400) : "", copie: msg.copie, dest: msg.dest, rid: msg.rid, misura: msg.misura });
    if (!st.ok) return reply(st);
    const e = await etichettaEsito(st);
    reply({ ok: true, dati: e, nota: etiNota(st, e), gia: st.fogli.every((f) => f.gia) });
  })().catch((e) => reply({ ok: false, errore: corto(e && e.message || e, 120) }));
  return true;
});
