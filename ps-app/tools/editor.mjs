#!/usr/bin/env node
/*
 * dist/dimissioni.html — l'editor dei fogli di dimissione: UNA pagina sola,
 * senza server e senza dipendenze, con i testi in servizio già dentro.
 *
 * Serve a lavorarci in fretta: clicchi un titolo o un testo e scrivi. Aggiungi
 * un foglio, ne butti uno, riordini. «Salva» scarica il JSON nella forma che
 * il pannello importa con ⤒ Importa (e lo copia negli appunti). Il lavoro a
 * metà resta nel browser, così chiudere la pagina non costa niente.
 *
 *   node tools/editor.mjs        (npm run editor)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dim = JSON.parse(readFileSync(join(root, "src/dimissioni.json"), "utf8"));
const version = /const VERSION = "([^"]+)"/.exec(readFileSync(join(root, "src/core.js"), "utf8"))[1];

const page = `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fogli di dimissione · PS Assist</title>
<style>
  :root {
    --ground:#F2F5F8; --card:#fff; --ink:#151E27; --muted:#5D6E7E; --faint:#8397A8;
    --line:#DBE3EA; --accent:#0B5CAD; --accent-soft:#E9F1F9; --ok:#177245; --bad:#B3261E;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --ground:#0E141A; --card:#161E26; --ink:#E3EAF1; --muted:#9AAAB8; --faint:#7C8D9C;
    --line:#26313B; --accent:#7FB2E7; --accent-soft:#16243180; --ok:#7BC79B; --bad:#EE9C94;
  } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink);
         font:15px/1.55 "IBM Plex Sans", -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .page { max-width:1000px; margin:0 auto; padding:26px 18px 120px; }
  header { border-bottom:2px solid var(--ink); padding-bottom:16px; margin-bottom:8px; }
  h1 { margin:0; font-size:26px; letter-spacing:-.02em; }
  .sub { color:var(--muted); font-size:14px; margin-top:6px; max-width:70ch; }
  .barra { position:sticky; top:0; z-index:5; display:flex; gap:8px; align-items:center; flex-wrap:wrap;
           background:var(--ground); padding:12px 0; border-bottom:1px solid var(--line); margin-bottom:14px; }
  button { font:600 13.5px/1 inherit; border-radius:9px; padding:10px 14px; cursor:pointer;
           border:1px solid var(--line); background:var(--card); color:var(--ink); }
  button:hover { border-color:var(--accent); color:var(--accent); }
  button.primo { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.primo:hover { filter:brightness(1.08); color:#fff; }
  button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .spia { margin-left:auto; font-size:12.5px; color:var(--muted); }
  .foglio { background:var(--card); border:1px solid var(--line); border-radius:12px;
            padding:14px 16px 16px; margin-bottom:12px; }
  .fh { display:flex; gap:10px; align-items:center; }
  .tit { flex:1 1 auto; font:700 19px/1.3 inherit; color:var(--ink); border:1px solid transparent;
         border-radius:8px; padding:5px 7px; background:transparent; min-width:0; }
  .tit:hover { border-color:var(--line); }
  .tit:focus { outline:0; border-color:var(--accent); background:var(--ground); }
  .chiave { font:500 11.5px/1 "IBM Plex Mono", ui-monospace, monospace; color:var(--faint); }
  .fh button { padding:6px 9px; font-size:12px; }
  .corpo { display:block; width:100%; margin-top:8px; resize:vertical; min-height:120px;
           border:1px solid transparent; border-radius:9px; padding:10px 12px; background:transparent;
           font:13.5px/1.6 "IBM Plex Mono", ui-monospace, monospace; color:var(--ink); }
  .corpo:hover { border-color:var(--line); }
  .corpo:focus { outline:0; border-color:var(--accent); background:var(--ground); }
  .meta { display:flex; gap:12px; font-size:11.5px; color:var(--faint); margin-top:4px; }
  .vuoto { text-align:center; color:var(--muted); padding:40px 10px; }
  .jsonbox { display:block; width:100%; height:180px; resize:vertical; border:1px solid var(--accent);
             border-radius:9px; padding:10px 12px; background:var(--card); color:var(--ink);
             font:12.5px/1.5 "IBM Plex Mono", ui-monospace, monospace; margin-bottom:14px; }
  .nota { margin-top:18px; font-size:13px; color:var(--muted); }
  .nota code { font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:12.5px; }
</style></head><body>
<div class="page">
  <header>
    <h1>Fogli di dimissione</h1>
    <p class="sub">Clicca un titolo o un testo e scrivi: è tutto modificabile.
      <b>Salva</b> mette il JSON <b>negli appunti</b> (e prova a scaricare il file): da lì lo carichi
      nel pannello con <b>⤒ Importa</b>. Il lavoro a metà resta in questo browser.</p>
  </header>

  <div class="barra">
    <button class="primo" id="salva">⬇ Salva (JSON)</button>
    <button id="nuovo">+ Nuovo foglio</button>
    <button id="carica">⤒ Carica un JSON</button>
    <button id="orig" title="Rimette i testi in servizio, buttando le modifiche">↺ Originali</button>
    <span class="spia" id="spia"></span>
  </div>

  <div id="uscita" hidden>
    <p class="nota" id="uscitaTit"></p>
    <textarea id="json" class="jsonbox" readonly spellcheck="false" aria-label="JSON dei fogli"></textarea>
  </div>

  <div id="elenco"></div>
  <p class="nota">In servizio: PS Assist <code>${version}</code> · ${Object.keys(dim).length} fogli.
    Ogni foglio ha una <b>chiave</b> (<code>colica-renale</code>): è quella che il pannello usa per
    riconoscerlo, quindi cambiarla crea un foglio nuovo invece di aggiornare quello vecchio.</p>
</div>

<script>
const SPEDITI = ${JSON.stringify(dim)};
const CHIAVE_LS = "psassist.editor.dimissioni";
let fogli = [];

const slug = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "foglio";
const daOggetto = (o) => Object.entries(o).map(([k, v]) => ({ k, nome: v.nome || k, testo: v.testo || "" }));

function carica() {
  try {
    const salvato = JSON.parse(localStorage.getItem(CHIAVE_LS) || "null");
    if (salvato && Array.isArray(salvato) && salvato.length) { fogli = salvato; return; }
  } catch { /* si riparte dai testi in servizio */ }
  fogli = daOggetto(SPEDITI);
}
const ricorda = () => { try { localStorage.setItem(CHIAVE_LS, JSON.stringify(fogli)); } catch {} };
function spia(t, ko) {
  const s = document.getElementById("spia");
  s.textContent = t; s.style.color = ko ? "var(--bad)" : "var(--ok)";
  clearTimeout(spia._t); spia._t = setTimeout(() => { s.textContent = ""; }, 2200);
}

function disegna() {
  const el = document.getElementById("elenco");
  if (!fogli.length) { el.innerHTML = '<p class="vuoto">Nessun foglio. Premi <b>+ Nuovo foglio</b>.</p>'; return; }
  el.innerHTML = fogli.map((f, i) => {
    const righe = f.testo.split("\\n").filter((r) => r.trim()).length;
    return \`<article class="foglio">
      <div class="fh">
        <input class="tit" value="\${esc(f.nome)}" data-i="\${i}" data-campo="nome" aria-label="Titolo del foglio">
        <span class="chiave">\${esc(f.k)}</span>
        <button data-su="\${i}" title="Sposta su">↑</button>
        <button data-giu="\${i}" title="Sposta giù">↓</button>
        <button data-del="\${i}" title="Elimina questo foglio">🗑</button>
      </div>
      <textarea class="corpo" data-i="\${i}" data-campo="testo" spellcheck="false"
        aria-label="Testo del foglio">\${esc(f.testo)}</textarea>
      <div class="meta"><span>\${righe} righe</span><span>\${f.testo.length} caratteri</span></div>
    </article>\`;
  }).join("");
  el.querySelectorAll("textarea.corpo").forEach(cresci);
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function cresci(t) { t.style.height = "auto"; t.style.height = Math.max(120, t.scrollHeight + 2) + "px"; }

document.getElementById("elenco").addEventListener("input", (e) => {
  const t = e.target;
  const i = +t.dataset.i;
  if (!Number.isInteger(i) || !fogli[i]) return;
  fogli[i][t.dataset.campo] = t.value;
  if (t.tagName === "TEXTAREA") cresci(t);
  ricorda();
});
document.getElementById("elenco").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const g = (n) => (b.dataset[n] === undefined ? null : +b.dataset[n]);
  const del = g("del"), su = g("su"), giu = g("giu");
  if (del !== null) {
    if (b.dataset.sicuro !== "1") { b.dataset.sicuro = "1"; b.textContent = "cancello?"; 
      setTimeout(() => { if (b.isConnected && b.dataset.sicuro === "1") { b.dataset.sicuro = ""; b.textContent = "🗑"; } }, 4000); return; }
    fogli.splice(del, 1);
  } else if (su !== null && su > 0) { [fogli[su - 1], fogli[su]] = [fogli[su], fogli[su - 1]]; }
  else if (giu !== null && giu < fogli.length - 1) { [fogli[giu + 1], fogli[giu]] = [fogli[giu], fogli[giu + 1]]; }
  else return;
  ricorda(); disegna();
});

document.getElementById("nuovo").addEventListener("click", () => {
  let k = "foglio-nuovo", n = 1;
  while (fogli.some((f) => f.k === k)) k = "foglio-nuovo-" + (++n);
  fogli.unshift({ k, nome: "Nuovo foglio", testo: "TITOLO — INDICAZIONI ALLA DIMISSIONE\\n\\nSEZIONE\\n- prima indicazione\\n" });
  ricorda(); disegna();
  document.querySelector("input.tit")?.focus();
});

document.getElementById("salva").addEventListener("click", async () => {
  // la chiave segue il titolo solo per i fogli nuovi: cambiarla su uno
  // esistente creerebbe un doppione invece di aggiornarlo
  const dati = {};
  for (const f of fogli) {
    if (!f.nome.trim() && !f.testo.trim()) continue;
    let k = f.k || slug(f.nome);
    if (k.startsWith("foglio-nuovo")) k = slug(f.nome);
    while (dati[k]) k += "-2";
    dati[k] = { nome: f.nome.trim() || k, testo: f.testo };
  }
  const testo = JSON.stringify({ app: "PS assist", versione: "${version}", salvato: new Date().toISOString(), dimissioni: dati }, null, 1);
  let file = false, appunti = false;
  try {
    const u = URL.createObjectURL(new Blob([testo], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = u; a.download = "dimissioni.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 20000);
    file = true;
  } catch {}
  try { await navigator.clipboard.writeText(testo); appunti = true; } catch {}
  // Il download non si può verificare (e in certe pagine è vietato): quello
  // che si può garantire è che il JSON finisca in mano a chi lo chiede.
  // Quindi si mostra sempre, selezionato, sotto la barra.
  const u = document.getElementById("uscita");
  document.getElementById("uscitaTit").innerHTML = appunti
    ? "<b>Negli appunti.</b> Incollalo nel pannello con <b>⤒ Importa</b>" + (file ? " — e ho anche provato a scaricare <code>dimissioni.json</code>." : ".")
    : "<b>Copia da qui</b> (gli appunti non erano disponibili) e incollalo nel pannello con <b>⤒ Importa</b>.";
  const ta = document.getElementById("json");
  ta.value = testo;
  u.hidden = false;
  ta.focus(); ta.select();
  spia(appunti ? "negli appunti" : "copia dal riquadro", !appunti);
});

document.getElementById("carica").addEventListener("click", async () => {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json,.json";
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      const d = o && o.dimissioni && typeof o.dimissioni === "object" ? o.dimissioni : o;
      const nuovi = daOggetto(d).filter((x) => x.testo.trim());
      if (!nuovi.length) throw new Error("nessun foglio");
      fogli = nuovi; ricorda(); disegna(); spia(nuovi.length + " fogli caricati");
    } catch (e) { spia("file non valido: " + e.message, true); }
  });
  inp.click();
});

document.getElementById("orig").addEventListener("click", (e) => {
  const b = e.currentTarget;
  if (b.dataset.sicuro !== "1") { b.dataset.sicuro = "1"; b.textContent = "↺ Confermi?";
    setTimeout(() => { if (b.dataset.sicuro === "1") { b.dataset.sicuro = ""; b.textContent = "↺ Originali"; } }, 4000); return; }
  b.dataset.sicuro = ""; b.textContent = "↺ Originali";
  fogli = daOggetto(SPEDITI); ricorda(); disegna(); spia("rimessi i testi in servizio");
});

carica(); disegna();
</script></body></html>
`;

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/dimissioni.html"), page);
console.log(`editor dimissioni: dist/dimissioni.html (${Object.keys(dim).length} fogli, ${(page.length / 1024).toFixed(0)} KB)`);
