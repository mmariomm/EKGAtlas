#!/usr/bin/env node
/*
 * «Ricetta SISS» con l'estensione VERA: dal pannello sulla pagina del paziente
 * (⋯ → Ricetta SISS) fino all'ANTEPRIMA del Prescrittivo Regionale, e mai oltre.
 * Il SISS è finto, costruito qui sulla forma delle istantanee anonimizzate di
 * una registrazione vera (un'app Angular a viste: dashboard → «Nuova
 * Prescrizione» → identificazione → compilazione con la ricerca a tendina →
 * Anteprima con «STATO: BOZZA», Salva, Registra, STAMPA RE). Conta ogni clic
 * su Registra, Salva, Stampa e Cancella: devono restare zero. Tutto inventato;
 * i nomi del SISS li risolve Chromium su un piccolo server HTTPS qui
 * (--host-resolver-rules), il gestionale è il simulatore di sempre.
 *   node test/ext-ricetta-siss.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, statSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import https from "node:https";

// (mai la rete vera: nessun proxy, ogni nome risolto in locale — il gestionale finto passa dalle route di Playwright)
const RETE_CHIUSA = ["--proxy-server=direct://", "--host-resolver-rules=MAP * 127.0.0.1"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-ricetta-" + process.pid);
const OUT = join("/tmp", "psa-ricetta-cert-" + process.pid);
const FOTO = process.env.PSA_FOTO || "";   // una cartella: lì le fotografie del pannello e del SISS
mkdirSync(OUT, { recursive: true });
function chromiumPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}
let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };
const sospendi = (ms) => new Promise((res) => setTimeout(res, ms));
async function finche(fn, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sospendi(200)) if (await fn().catch(() => false)) return true;
  return false;
}
console.log("ricetta SISS: dal pannello all'Anteprima del Prescrittivo");

// ------------------------------------------------------ i dati (inventati)
const PZ = { cog: "ROSSI", nom: "MARIO", cf: "RSSMRA58E17Z999Y", nato: "17/05/1958", tessera: "000TS058" };
const ALTRO = { cog: "VERDI", nom: "GINO", cf: "VRDGNI40A01Z999K", nato: "01/01/1940", tessera: "000TS040" };
const MENU = "dcss.cgi.crs.lombardia.it", PR = "operatorisiss.servizirl.it";
const AIC = "039785098", DESCR = "AUGMENTIN*OS 12BUST875MG+125MG";
// la tendina della ricerca: tante confezioni con la stessa descrizione, codici diversi (come nel SISS)
const FARMACI = [
  ["039785086", DESCR], [AIC, DESCR], ["037954106", DESCR], ["052594013", DESCR],
  ["026089464", "AUGMENTIN*OS SOSP FL35ML+SIR"], ["039785050", "AUGMENTIN*12CPR RIV875MG+125MG"],
  ["034329012", "TACHIPIRINA*30CPR 500MG"], ["89.7", "VISITA GENERALE"], ["89.01", "VISITA SUCCESSIVA ALLA PRIMA"],
];
// (`registrazioni`: le prepare-register-request arrivate. Il SISS vero le manda
// da sé all'Anteprima — registrazione del medico, reg1 — e la ricetta resta in
// BOZZA; `registraAlFarmaco`: un SISS che registrasse mentre si compila;
// `anteprimaRegistrata`: un'Anteprima che tornasse REGISTRATA, con l'NRE)
const srvStato = { paziente: PZ, cercati: [], identificazioni: 0, registraAlFarmaco: false, anteprimaRegistrata: false, registrazioni: 0, perAnteprima: 0, senzaNota: false };

// ------------------------------------------------------ il SISS finto
const menu = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Menu SISS</title></head><body>
  <div>Servizi Socio Sanitari Operatore</div><div>Operatore: OPERATORE PROVA Ruolo: MEDICO</div>
  <a class="list-item" id="prreg" target="_blank" href="https://${PR}/prescrittivoRegionale/pages/dashboard">Prescrittivo Regionale (PRREG) Produzione</a></body></html>`;
// L'app: le viste dalla rotta (pushState), i dati della ricetta in memoria,
// una rotella (app-loader) mentre «parla col server», la tendina della
// ricerca nel cdk-overlay-container come Angular Material.
const spa = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prescrittivo Regionale</title><base href="/prescrittivoRegionale/">
<style>.cdk-overlay-container{position:fixed;inset:0;pointer-events:none}.cdk-overlay-pane{pointer-events:auto;background:#fff;position:absolute;top:330px;left:90px;width:520px;border:1px solid #888;max-height:260px;overflow:auto}
mat-option{display:block;padding:6px 10px;cursor:pointer}mat-option:hover{background:#eef}.spinner-container{position:fixed;inset:0;background:rgba(52,52,52,.3)}
body{font:14px sans-serif;margin:0}#layout-header{background:#0b3d6b;color:#fff;padding:8px 14px;display:flex;gap:16px;align-items:center}#layout-header a{color:#fff}
.content-page{padding:14px 20px}mat-card{display:inline-block;border:1px solid #ccc;padding:20px;margin:6px;cursor:pointer}td,th{border-bottom:1px solid #ddd;padding:4px 8px;text-align:left}
app-sticky-bottom-toolbar{display:block;margin-top:16px}fieldset{border:1px solid #bbb}.npri-very-bold{font-weight:800}</style></head>
<body><app-root ng-version="7.2.16"><div class="cursor"><app-loader></app-loader><router-outlet></router-outlet>
<app-pages><app-layout><div id="layout"><div id="layout-header"><app-header>
  <app-breadcrumb><ol class="breadcrumb"><li class="breadcrumb-item"><a routerlink="/pages/dashboard" type="button" href="/prescrittivoRegionale/pages/dashboard"> Home </a></li></ol></app-breadcrumb>
  <app-header-user><div class="user-container"><div class="data"><span class="name">Operatore 41</span> <span class="role">Medico</span></div></div></app-header-user>
  <app-header-logout><button title="Logout" class="mat-button">⎋</button></app-header-logout></app-header></div>
  <div class="content-page" id="vista"></div></div></app-layout></app-pages></div></app-root>
<div class="cdk-overlay-container"></div>
<script>
const R = "/prescrittivoRegionale/pages/";
const C = window.__clic = { registra: 0, salva: 0, stampa: 0, cancella: 0, elimina: 0, nuova: 0, cercaPaziente: 0, anteprima: 0 };
let paz = null, farmaci = [], quesito = "";
let visite = [];
window.__ricetta = () => ({ vista: location.pathname, paz, farmaci: farmaci.map((f) => ({ ...f })), visite: visite.map((v) => ({ ...v })), quesito, ricerca: (document.getElementById("ricerca") || {}).value || "" });
const vista = document.getElementById("vista"), ov = document.querySelector(".cdk-overlay-container");
const rotella = (ms) => new Promise((ok) => { document.querySelector("app-loader").innerHTML = '<div class="spinner-container"><mat-spinner role="progressbar"></mat-spinner></div>';
  setTimeout(() => { document.querySelector("app-loader").innerHTML = ""; ok(); }, ms); });
const va = (p) => { history.pushState({}, "", R + p); disegna(); };
// i clic sui bottoni che non si devono premere mai, contati (veri o no)
document.addEventListener("click", (e) => {
  const b = e.target.closest("button, mat-card, a"); if (!b) return;
  const t = (b.textContent || "").trim(), tip = b.getAttribute("mattooltip") || "";
  if (/^Registra$/.test(t)) C.registra++; if (/^Salva$/.test(t) || /Salva/.test(tip)) C.salva++;
  if (/STAMPA/i.test(t)) C.stampa++; if (/^Cancella$/.test(t) || /Cancella/.test(tip)) C.cancella++; if (/^Elimina/.test(tip)) C.elimina++;
}, true);
function intestazione() {
  return '<app-prescription-patient><div><mat-accordion><mat-expansion-panel><mat-expansion-panel-header role="button"><span class="mat-content">'
    + '<span> Cognome: <span class="npri-very-bold">' + paz.cog + '</span></span> <span> Nome: <span class="npri-very-bold">' + paz.nom + '</span></span>'
    + ' <span> Sesso: <span class="npri-very-bold">M</span></span> <span> Data di nascita: <span class="npri-very-bold">' + paz.nato + '</span></span></span></mat-expansion-panel-header>'
    + '<div class="mat-expansion-panel-content" style="height:0;visibility:hidden"><div class="mat-expansion-panel-body"><div>'
    + '<span> Id personale: <span class="npri-very-bold">' + paz.cf + '</span></span> <span> Tessera: <span class="npri-very-bold">' + paz.tessera + '</span></span>'
    + '</div></div></div></mat-expansion-panel></mat-accordion></div></app-prescription-patient>';
}
function tabellaFarmaci(dove) {
  if (!farmaci.length) return '<div class="text-center"><span class="npri-very-bold"> Nessuna prestazione specialistica o farmaco selezionati </span></div>';
  return '<app-prescription-drugs-home><app-prescription-drugs><div class="table-container"><table class="mat-table" role="grid"><thead><tr class="mat-header-row">'
    + '<th class="mat-column-code">Codice farmaco</th><th class="mat-column-description">Descrizione farmaco</th><th class="mat-column-quantity">Quantità</th><th class="mat-column-substitutability">Sostituibile</th><th></th></tr></thead><tbody>'
    + farmaci.map((f, i) => '<tr class="mat-row" role="row"><td class="mat-cell mat-column-code"><div class="ellipsis"><mat-icon class="fa fa-barcode"></mat-icon> ' + f.codice + ' </div></td>'
      + '<td class="mat-cell mat-column-description"><div class="ellipsis"> ' + f.descr + ' </div></td>'
      + '<td class="mat-cell mat-column-quantity"><mat-form-field><input data-i="' + i + '" formcontrolname="quantity" matinput max="999" min="1" name="quantity" onfocus="this.blur()" placeholder="Quantità" type="number" value="' + f.qta + '"></mat-form-field></td>'
      + '<td class="mat-cell mat-column-substitutability"><div><div><mat-radio-group formcontrolname="substitutability" role="radiogroup">'
      + '<mat-radio-button class="mat-radio-button' + (f.ns ? '' : ' mat-radio-checked') + '"><label class="mat-radio-label"><div class="mat-radio-container"><input class="mat-radio-input cdk-visually-hidden" type="radio" name="sost' + dove + i + '" data-i="' + i + '" value="S"' + (f.ns ? '' : ' checked') + '></div><div class="mat-radio-label-content"> Sostituibile </div></label></mat-radio-button>'
      + '<mat-radio-button class="mat-radio-button' + (f.ns ? ' mat-radio-checked' : '') + '"><label class="mat-radio-label"><div class="mat-radio-container"><input class="mat-radio-input cdk-visually-hidden" type="radio" name="sost' + dove + i + '" data-i="' + i + '" value="N"' + (f.ns ? ' checked' : '') + '></div><div class="mat-radio-label-content"> Non sostituibile </div></label></mat-radio-button>'
      + '</mat-radio-group></div><div></div></div></td>'
      + (window.__senzaNota ? '' : '<td class="mat-cell mat-column-note"><input data-i="' + i + '" formcontrolname="note" placeholder="Note" type="text" value="' + (f.note || '').replace(/"/g, "&quot;") + '"></td>')
      + '<td><button mat-icon-button mattooltip="Elimina il farmaco" type="button" class="mat-icon-button">🗑</button></td></tr>').join("")
    + '</tbody></table></div></app-prescription-drugs></app-prescription-drugs-home>';
}
function legaTabella() {
  vista.querySelectorAll("input[formcontrolname=note]").forEach((q) => { const f = () => { farmaci[q.dataset.i].note = q.value; }; q.addEventListener("input", f); q.addEventListener("change", f); });
  vista.querySelectorAll("input[formcontrolname=quantity]").forEach((q) => { const f = () => { farmaci[q.dataset.i].qta = Number(q.value) || 1; }; q.addEventListener("input", f); q.addEventListener("change", f); });
  vista.querySelectorAll("input[type=radio]").forEach((r) => r.addEventListener("change", () => {
    farmaci[r.dataset.i].ns = r.value === "N";
    r.closest("mat-radio-group").querySelectorAll("mat-radio-button").forEach((b) => b.classList.toggle("mat-radio-checked", b.contains(r)));
  }));
}
function disegna() {
  const p = location.pathname;
  ov.innerHTML = "";
  if (/dashboard$/.test(p)) {
    vista.innerHTML = '<app-dashboard><div class="dashboard-container"><div class="function-container"><mat-card class="mat-card" tabindex="0" id="nuova"><mat-card-title></mat-card-title><p>Nuova Prescrizione</p></mat-card></div>'
      + '<div class="function-container"><mat-card class="mat-card" tabindex="0"><p>Ricerca Prescrizioni</p></mat-card></div></div></app-dashboard>';
    document.getElementById("nuova").onclick = () => { C.nuova++; paz = null; farmaci = []; visite = []; quesito = ""; va("prescription/patient-identify"); };
  } else if (/patient-identify$/.test(p)) {
    vista.innerHTML = '<app-prescription><app-prescription-patient-identifier><mat-accordion><app-patient-search-filters><form novalidate>'
      + '<input autocomplete="off" formcontrolname="idCard" id="idCard" matinput name="idCard" placeholder="ID Personale (CF/STP/TEAM/Altro)" type="text">'
      + '<input formcontrolname="patientLastName" id="patientLastName" placeholder="Cognome" type="text"><input formcontrolname="patientFirstName" id="patientFirstName" placeholder="Nome" type="text">'
      + '<mat-action-list><button mat-raised-button type="button" class="mat-raised-button"><span class="mat-button-wrapper">Cancella</span></button>'
      + '<button mat-raised-button type="submit" class="mat-raised-button" id="cerca" disabled><span class="mat-button-wrapper">Cerca</span></button></mat-action-list></form></app-patient-search-filters></mat-accordion></app-prescription-patient-identifier></app-prescription>';
    const id = document.getElementById("idCard"), cerca = document.getElementById("cerca");
    id.addEventListener("input", () => { cerca.disabled = id.value.trim().length < 16; });
    vista.querySelector("form").onsubmit = (e) => e.preventDefault();
    cerca.onclick = async () => {
      C.cercaPaziente++;
      const r = await fetch("/prescrittivoRegionale/api/patients?idCard=" + encodeURIComponent(id.value));
      await rotella(400);
      paz = await r.json();
      va("prescription/editing");
    };
  } else if (/editing$/.test(p) && paz) {
    vista.innerHTML = '<app-prescription><app-prescription-create-home>' + intestazione()
      + '<mat-tab-group><div role="tab">Prescrizione medica</div><div role="tab">Storico paziente</div></mat-tab-group><app-prescription-create><form class="form">'
      + '<app-prescription-list><app-prescription-patient-assistance><mat-select formcontrolname="patientAssistanceTypeCode" role="listbox"><div class="mat-select-value"><span class="mat-select-value-text"><span>Assistiti SSN</span></span></div></mat-select></app-prescription-patient-assistance>'
      + '<app-prescription-type><mat-select formcontrolname="prescriptionType" role="listbox"><div class="mat-select-value"><span class="mat-select-value-text"><span>Specialistica/Farmaceutica</span></span></div></mat-select></app-prescription-type>'
      + '<app-prescription-priority><mat-select formcontrolname="priorityCode" placeholder="Priorità" role="listbox"><div class="mat-select-value"><span class="mat-select-value-text"><span>Programmabile - Da eseguire entro 120gg</span></span></div></mat-select></app-prescription-priority>'
      + '<app-prescription-diagnostic-question><input autocomplete="off" formcontrolname="diagnosticQuestionText" matinput name="diagnosticQuestionText" placeholder="Quesito diagnostico testuale" type="text" maxlength="256" id="quesito"></app-prescription-diagnostic-question>'
      + '<app-prescription-fast-searches><app-prescription-regional-specialties-search><input autocomplete="off" matinput type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" id="ricerca" placeholder="Ricerca specialistica/farmaco"></app-prescription-regional-specialties-search></app-prescription-fast-searches>'
      + tabellaFarmaci("e")
      + (visite.length ? '<app-prescription-specialties-home><table class="mat-table"><tbody>' + visite.map((v) => '<tr class="mat-row"><td class="mat-cell"> ' + v.codice + ' </td><td class="mat-cell"> ' + v.descr + ' </td>'
        + '<td><mat-select formcontrolname="priorityCode" placeholder="Priorità"></mat-select></td><td><input formcontrolname="duration" placeholder="Durata" value=""></td></tr>').join("") + '</tbody></table></app-prescription-specialties-home>' : "")
      + '</app-prescription-list>'
      + '<app-sticky-bottom-toolbar><button class="btn-sm mat-raised-button" type="button" id="anteprima"' + (farmaci.length || visite.length ? "" : " disabled") + '><span class="mat-button-wrapper"> Anteprima </span></button>'
      + '<button class="btn-sm mat-raised-button" type="button" id="salva"><span class="mat-button-wrapper"> Salva </span></button>'
      + '<button class="btn-sm mat-raised-button" type="button" id="registra"><span class="mat-button-wrapper"> Registra </span></button></app-sticky-bottom-toolbar>'
      + '</form></app-prescription-create></app-prescription-create-home></app-prescription>';
    legaTabella();
    const q = document.getElementById("quesito");
    q.value = quesito;
    q.addEventListener("input", () => { quesito = q.value; });
    const box = document.getElementById("ricerca");
    let t = null;
    box.addEventListener("input", () => {
      clearTimeout(t);
      if (box.value.trim().length < 3) { ov.innerHTML = ""; return; }
      if (document.activeElement !== box) return;   // come Material: la tendina si apre solo col fuoco
      t = setTimeout(async () => {
        const r = await fetch("/prescrittivoRegionale/api/search?q=" + encodeURIComponent(box.value));
        const l = await r.json();
        box.setAttribute("aria-expanded", "true");
        ov.innerHTML = '<div class="cdk-overlay-connected-position-bounding-box"><div class="cdk-overlay-pane"><div class="mat-autocomplete-panel mat-autocomplete-visible" role="listbox">'
          + l.map((x, i) => '<mat-option class="mat-option" role="option" data-i="' + i + '"><span class="mat-option-text"> ' + x[0] + ' - ' + x[1] + ' </span></mat-option>').join("") + '</div></div></div>';
        ov.querySelectorAll("mat-option").forEach((o) => o.addEventListener("click", async () => {
          const x = l[o.dataset.i];
          ov.innerHTML = ""; box.setAttribute("aria-expanded", "false");
          await rotella(300);
          // (la prova della seconda guardia: un SISS che registrasse mentre si compila)
          if (window.__registraAlFarmaco) fetch("/prescrittivoRegionale/prescription/rest/prescriptions/prepare-register-request", { method: "POST", body: "{}" });
          if (/^\\d{9}$/.test(x[0])) farmaci.push({ codice: x[0], descr: x[1], qta: 1, ns: false });
          else visite.push({ codice: x[0], descr: x[1] });
          disegna();
        }));
      }, 300);
    });
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") { ov.innerHTML = ""; box.setAttribute("aria-expanded", "false"); } });
    document.getElementById("anteprima").onclick = async () => {
      C.anteprima++;
      // come il SISS vero (reg1): l'Anteprima chiama da sé partition,
      // prepare-register-request e register-prescriptions-by-client-response,
      // e la ricetta resta in BOZZA
      const rest = "/prescrittivoRegionale/prescription/rest/prescriptions/";
      document.querySelector("app-loader").innerHTML = '<div class="spinner-container"></div>';
      for (const x of ["partition", "checkIfAlreadyRegisteredWithDifferentPriority", "prepare-register-request", "register-prescriptions-by-client-response", "check-prescription-error", "prepare-print-request"])
        await fetch(rest + x, { method: "POST", body: "{}" }).catch(() => {});
      await rotella(300); va("prescription/editing/preview");
    };
  } else if (/preview$/.test(p) && paz) {
    vista.innerHTML = '<app-prescription><app-prescription-previews-home>' + intestazione() + '<app-prescription-previews><form class="form"><div id="prescription-previews-container">'
      + '<p class="float-child">N. prescrizioni specialistiche: 0</p><p class="float-child">N. prescrizioni farmaceutiche: 1</p>'
      + '<app-prescription-preview><app-fieldset><fieldset class="fieldset"><legend>Prescrizione farmaceutica</legend><div class="grid-container">'
      + (window.__anteprimaRegistrata ? '<span class="npri-primary npri-bold"> STATO: REGISTRATA </span><span> NRE: 0000E0000000001 </span>' : '<span class="npri-primary npri-bold"> STATO: BOZZA </span>')
      + '<button class="icon-btn-sm mat-icon-button" mattooltip="Cancella prescrizione" type="button">🗑</button><button class="icon-btn-sm mat-icon-button" mattooltip="Salva prescrizione" type="button">💾</button>'
      + '<input formcontrolname="diagnosticQuestionText" name="diagnosticQuestionText" placeholder="Quesito diagnostico testuale" type="text" value="' + quesito.replace(/"/g, "&quot;") + '">'
      + tabellaFarmaci("p") + '</div></fieldset></app-fieldset></app-prescription-preview>'
      + '<button class="btn-sm mat-raised-button" type="button" id="indietro"><span class="mat-button-wrapper"> Indietro </span></button>'
      + '<button class="btn-sm mat-raised-button" type="button" id="salvap"><span class="mat-button-wrapper"> Salva </span></button>'
      + '<button class="btn-sm mat-raised-button" type="button" id="registrap"><span class="mat-button-wrapper"> Registra </span></button>'
      + '<button class="btn-sm mat-raised-button" type="button" id="stampap"><span class="mat-button-wrapper"> STAMPA RE </span></button>'
      + '</div></form></app-prescription-previews></app-prescription-previews-home></app-prescription>';
    legaTabella();
  } else {
    va("dashboard");
  }
}
addEventListener("popstate", disegna);
disegna();
</script></body></html>`;

const CERT = join(OUT, "cert");
mkdirSync(CERT, { recursive: true });
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${PR}`, "-addext", `subjectAltName=DNS:${PR},DNS:${MENU}`, "-days", "1",
  "-keyout", join(CERT, "k.pem"), "-out", join(CERT, "c.pem")], { stdio: "ignore" });
const srv = https.createServer({ key: readFileSync(join(CERT, "k.pem")), cert: readFileSync(join(CERT, "c.pem")) }, (req, res) => {
  const host = String(req.headers.host || "").split(":")[0], u = new URL(req.url, "https://x");
  const html = (b) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(b); };
  const json = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (host === MENU && u.pathname.startsWith("/menusiss/")) return html(menu);
  if (host === PR && u.pathname.startsWith("/prescrittivoRegionale/pages/")) return html(spa.replace("<script>", `<script>window.__registraAlFarmaco = ${srvStato.registraAlFarmaco}; window.__anteprimaRegistrata = ${srvStato.anteprimaRegistrata}; window.__senzaNota = ${srvStato.senzaNota};`));
  if (host === PR && /\/prescriptions\/prepare-register-request$/.test(u.pathname)) { srvStato.registrazioni++; req.resume(); return json({}); }
  if (host === PR && /\/prescriptions\/(?:partition|checkIfAlreadyRegisteredWithDifferentPriority|register-prescriptions-by-client-response|check-prescription-error|prepare-print-request)$/.test(u.pathname)) {
    if (u.pathname.endsWith("/partition")) srvStato.perAnteprima++;
    req.resume(); return json({});
  }
  if (host === PR && u.pathname === "/prescrittivoRegionale/api/patients") { srvStato.identificazioni++; return json(srvStato.paziente); }
  if (host === PR && u.pathname === "/prescrittivoRegionale/api/search") {
    const q = (u.searchParams.get("q") || "").toUpperCase();
    srvStato.cercati.push(q);
    const l = FARMACI.filter(([c, d]) => d.includes(q) || c === q);
    // (come il SISS: fra i farmaci anche una prestazione)
    return json(l.length && !l.some(([c]) => c === "89.7") ? [...l, FARMACI.find(([c]) => c === "89.7")] : l);
  }
  res.writeHead(404); res.end();
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const porta = srv.address().port;

// il gestionale: il simulatore, con il riquadro del paziente (nome e codice
// fiscale inventati) come nelle pagine vere — il mock non lo ha, si aggiunge qui
const RIQUADRO = `<table><tr><td title="ARANCIONE"><font style="font-size: 120%; font-weight: bolder; ">Box</font><br><font style="font-size: 150%; font-weight: bolder; ">${PZ.cog} ${PZ.nom}</font><br><font style="font-size: 120%; font-weight: bolder; ">${PZ.nato} (68) M<br>${PZ.cf}</font></td></tr></table>`;
const A = createMock({});
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || chromiumPath(),
  viewport: { width: 1366, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.PSA_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean), ...RETE_CHIUSA,
    `--host-resolver-rules=MAP ${MENU} 127.0.0.1:${porta}, MAP ${PR} 127.0.0.1:${porta}`, "--ignore-certificate-errors", "--no-proxy-server"],
});
await ctx.route("https://smarthealth.multimedica.it/**", async (r) => {
  const req = r.request();
  let out = A.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = A.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
  let body = out.body;
  if (Buffer.isBuffer(body) && /html/.test(out.headers["content-type"] || "")) {   // (win1252: si legge come latin1)
    const t = body.toString("latin1");
    if (/title="Richieste Laboratorio"/.test(t)) body = Buffer.from(t.replace("</body>", `${RIQUADRO}</body>`), "latin1");
  }
  try { await r.fulfill({ status: out.status, headers: out.headers, body }); } catch { /* scheda chiusa */ }
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const ricetta = () => sw.evaluate(() => chrome.storage.session.get("ricetta").then((o) => o.ricetta || null));
const preferiti = () => sw.evaluate(() => chrome.storage.local.get("ricetta.preferiti.v1").then((o) => o["ricetta.preferiti.v1"] || []));
const errori = () => sw.evaluate(() => chrome.storage.local.get("errori.v1").then((o) => (o["errori.v1"] || []).filter((x) => x.tipo === "ricetta")));
const schedeSiss = () => sw.evaluate(() => chrome.tabs.query({ url: "https://operatorisiss.servizirl.it/*" }).then((l) => l.map((t) => ({ id: t.id, active: t.active, url: t.url }))));
const schedeMenu = () => sw.evaluate(() => chrome.tabs.query({ url: "https://dcss.cgi.crs.lombardia.it/*" }).then((l) => l.map((t) => ({ id: t.id, active: t.active }))));
const $p = (sel) => doc.locator(`#psassist-host ${sel}`);
const statoPannello = () => $p("#ricstato").innerText().catch(() => "");

const doc = await ctx.newPage();
await doc.goto(A.patientUrl);
await doc.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });
if (!(await $p(".card").count())) { await $p("#expand").click(); await doc.waitForSelector("#psassist-host .card", { timeout: 8000 }); }
await $p("#menubtn").click();
check(await $p("#ricmenu").count() === 0 && !/Ricetta SISS/.test(await $p(".menu").innerText()), "nel menu ⋯ la «Ricetta SISS» non c'è più: sta solo nelle Dimissioni");
await $p("#menubtn").click();
// la sezione Dimissioni la offre per prima, ed è l'unico posto: chi va a casa porta la ricetta
await $p('[data-seg="dimissioni"]').click();
check(await $p("#dimricetta").count() === 1, "nelle Dimissioni c'è «Prepara la ricetta nel SISS»");
await $p("#dimricetta").click();
await doc.waitForSelector("#psassist-host .ricetta", { timeout: 5000 });
// dove sei: «‹ [℞] Ricetta SISS» al posto delle schede, e il ‹ torna alle Dimissioni da cui si veniva
check((await $p(".seg.vmenu .segtit").innerText()).trim() === "Ricetta SISS" && (await $p(".seg.vmenu #back").getAttribute("title")) === "Torna a Dimissioni (Esc)",
  `in testa «‹ Ricetta SISS», e il ‹ torna alle Dimissioni (got ${await $p(".seg").innerText().catch(() => "")})`);

// ---- 1. preferiti e ricerca nel pannello; il SISS non è aperto: il menu, e il messaggio
check(await $p(".ricpref").innerText().then((t) => /Ancora nessuno/.test(t)) && await $p("#ricq").count() === 1 && await $p("#ricprepara").isDisabled(),
  "la sezione Ricetta: i preferiti (ancora nessuno), la ricerca, «Prepara nel SISS» spento finché non c'è un farmaco");
await $p("#ricq").fill("augmentin");
const nuovaScheda = ctx.waitForEvent("page", { timeout: 10000 }).catch(() => null);
await $p("#riccerca").click();
const nuovaPr = ctx.waitForEvent("page", { predicate: (p) => p.url().includes("/prescrittivoRegionale/"), timeout: 20000 }).catch(() => null);
const pMenu = await nuovaScheda;
check(!!pMenu && (await schedeMenu()).length === 1, "non c'è un Prescrittivo aperto: il menu del SISS si apre");

// ---- 2. il medico è entrato: «Prescrittivo Regionale» lo preme PS Assist, e la ricetta riparte da sola
await pMenu.waitForLoadState();
const siss = await nuovaPr;
check(!!siss && (await schedeSiss()).length === 1 && (await schedeMenu()).length === 1, "«Prescrittivo Regionale» premuto da sé nel menu: una scheda del Prescrittivo, nessun clic tuo");
await siss.waitForLoadState();
const sissStato = () => siss.evaluate(() => window.__ricetta());
const clic = () => siss.evaluate(() => ({ ...window.__clic }));
check(await finche(async () => (await sissStato()).vista.endsWith("/editing") && (await sissStato()).paz, 25000), "entrato: «Nuova Prescrizione», il codice fiscale nell'identificazione, Cerca → la ricetta del paziente");
check(await finche(async () => await $p(".ricrisv").count() > 0, 20000), "la ricerca fatta nella casella del SISS: i risultati della sua tendina nel pannello");
const risultati = await $p(".ricrisv").allInnerTexts();
check(risultati.some((t) => t.startsWith(AIC) && t.includes(DESCR)) && await $p('.ricrisv[data-ricadd="89.7"][data-tipo="visita"] .rictipo').count() === 1,
  `i risultati sono le voci della tendina, col codice (${risultati.length}: ${risultati.slice(0, 3).join(" | ")}); la visita c'è, segnata «visita/esame»`);
check((await sissStato()).ricerca === "" && srvStato.cercati.includes("AUGMENTIN"), "la ricerca l'ha fatta la casella del SISS, poi svuotata");

// ---- 3. il farmaco, quantità 2, non sostituibile, il quesito → Prepara → Anteprima
await $p(`.ricrisv[data-ricadd="${AIC}"]`).click();
await $p("#ricqta0").fill("2");
await $p("#ricns0").check();
await $p("#ricquesito").fill("faringotonsillite");
if (FOTO) { await doc.bringToFront(); await $p(".card").screenshot({ path: join(FOTO, "ricetta-pannello.png") }); }
// Ctrl+Invio è «Prepara» (acceso): come nelle Richieste — Registra resta del medico
await $p("#ricquesito").press("Control+Enter");
check(await finche(async () => (await sissStato()).vista.endsWith("/editing/preview"), 30000), "Ctrl+Invio (= «Prepara nel SISS»): il SISS arriva sull'Anteprima");
const fin = await sissStato();
check(fin.farmaci.length === 1 && fin.farmaci[0].codice === AIC && fin.farmaci[0].qta === 2 && fin.farmaci[0].ns === true && fin.quesito === "faringotonsillite",
  `nella ricetta del SISS: ${AIC} (scelto col codice esatto fra le confezioni uguali), quantità 2, non sostituibile, il quesito (${JSON.stringify(fin.farmaci)} · «${fin.quesito}»)`);
check(await siss.locator("app-prescription-previews").innerText().then((t) => /STATO: BOZZA/.test(t)), "l'Anteprima: «STATO: BOZZA»");
check(srvStato.perAnteprima === 1 && srvStato.registrazioni === 1 && !(await errori()).some((e) => e.tipo === "ricetta"),
  `le chiamate che il SISS fa da sé all'Anteprima (prepare-register-request compresa, come nel SISS vero): nessun allarme, nessun errore (${srvStato.registrazioni} · ${JSON.stringify((await errori()).filter((e) => e.tipo === "ricetta"))})`);
check(await finche(async () => /Anteprima nel SISS: controlla e premi tu Registra/.test(await statoPannello()), 8000), `il pannello: «${await statoPannello()}»`);
check(await finche(async () => (await schedeSiss()).find((t) => /preview$/.test(t.url))?.active, 5000), "la scheda del SISS è davanti al medico");
// la ricetta parla anche nella striscia degli ordini (a pannello aperto, il chip in intestazione), non solo in ⋯ → Ricetta
await doc.bringToFront();
const rigaRic = () => doc.evaluate(() => (document.getElementById("psassist-host")?.shadowRoot?.querySelector(".gchip, .pill.run")?.dataset?.riga
  || document.getElementById("psassist-host")?.shadowRoot?.querySelector(".pill.run")?.innerText || "").replace(/\s+/g, " "));
check(await finche(async () => /Ricetta.*pronta in Anteprima/.test(await rigaRic()), 5000), `la striscia dice «Ricetta · pronta in Anteprima» (${await rigaRic()})`);
const c1 = await clic();
check(c1.registra === 0 && c1.salva === 0 && c1.stampa === 0 && c1.cancella === 0 && c1.elimina === 0, `Registra, Salva, STAMPA RE, Cancella, Elimina: mai premuti (${JSON.stringify(c1)})`);
check(c1.nuova === 1 && c1.cercaPaziente === 1 && c1.anteprima === 1 && srvStato.identificazioni === 1, "una «Nuova Prescrizione», un'identificazione, un'Anteprima");
const job1 = await ricetta();
check(job1 && job1.stato === "anteprima" && !job1.cf && !job1.nome, "finita la ricetta, il codice fiscale e il nome del paziente non restano nella memoria dell'estensione");
if (FOTO) { await siss.bringToFront(); await siss.screenshot({ path: join(FOTO, "ricetta-siss-anteprima.png") }); }
if (FOTO) { await doc.bringToFront(); await $p(".card").screenshot({ path: join(FOTO, "ricetta-pannello-anteprima.png") }); }

// ---- 4. i preferiti si imparano dall'Anteprima (codice, descrizione, quantità)
check(await finche(async () => (await preferiti()).some((p) => p.codice === AIC && p.qta === 2 && p.descr === DESCR), 5000), "il farmaco dell'Anteprima entra nei preferiti: codice, descrizione, quantità");
const pref = await preferiti();
check(pref.every((p) => Object.keys(p).every((k) => ["codice", "descr", "qta", "ns", "tipo", "n", "ts"].includes(k))) && pref.find((p) => p.codice === AIC).n === 1 && pref.find((p) => p.codice === AIC).ns === true
  && !JSON.stringify(pref).includes(PZ.cf) && !JSON.stringify(pref).includes(PZ.cog),
  "nei preferiti niente del paziente");
await doc.bringToFront();
check(await finche(async () => await $p(`.ricchip[data-ricpref="${AIC}"]`).count() === 1, 5000), "il pannello mostra il preferito");

// ---- 5. la stessa ricetta due volte: una sola. Lo stesso id dal pannello (la
// risposta persa), e un secondo «Prepara» col SISS già sull'Anteprima
const docTab = await sw.evaluate(() => chrome.tabs.query({ url: "https://smarthealth.multimedica.it/*" }).then((l) => l[0]));
const rimanda = await sw.evaluate(([tab, id]) => new Promise((ok) => ricMessaggio({ t: "ricettaNuova", job: { id, ep: "999001", cf: "RSSMRA58E17Z999Y", nome: "ROSSI MARIO", voci: [{ codice: "039785098", descr: "x", qta: 1 }] } },
  { tab, url: tab.url }, ok)), [docTab, job1.id]);
check(rimanda && rimanda.ok && rimanda.gia, "la stessa domanda (stesso id) un'altra volta: è la stessa ricetta, non ne parte un'altra");
await $p("#ricprepara").click();
check(await finche(async () => /già una ricetta aperta/.test(await statoPannello()), 8000), `un secondo «Prepara nel SISS» col SISS sull'Anteprima: non si tocca (${await statoPannello()})`);
const c2 = await clic();
check(c2.nuova === 1 && c2.cercaPaziente === 1 && srvStato.identificazioni === 1 && (await sissStato()).farmaci.length === 1 && c2.registra === 0, "nessuna seconda prescrizione: sempre una «Nuova Prescrizione», un farmaco");

// ---- 6. il SISS mostra un altro paziente: Errore grave, niente scritto
srvStato.paziente = ALTRO;
await siss.goto(`https://${PR}/prescrittivoRegionale/pages/dashboard`);
await siss.waitForLoadState();
await doc.bringToFront();
await sospendi(1800);   // (un secondo tocco entro un secondo e mezzo è un doppio tocco: non conta)
await $p("#ricprepara").click();
check(await finche(async () => /Errore grave: il SISS mostra un altro paziente/.test(await statoPannello()), 25000), `un altro paziente nell'intestazione del SISS: «${await statoPannello()}»`);
check(await $p("#ricstato.err").count() === 1, "detto forte (rosso)");
const dopo = await sissStato();
check(dopo.vista.endsWith("/editing") && dopo.paz && dopo.paz.cf === ALTRO.cf && dopo.farmaci.length === 0 && dopo.quesito === "" && dopo.ricerca === "", "nel SISS niente scritto dopo: nessun farmaco, nessun quesito, la ricerca vuota");
check(await finche(async () => (await errori()).some((e) => e.dati && e.dati.grave && e.dati.cf === "diverso" && e.dati.passo === "paziente"), 5000), "nel registro degli errori (senza il codice fiscale)");
check(!JSON.stringify(await errori()).includes(ALTRO.cf) && !JSON.stringify(await errori()).includes(PZ.cf), "il registro non ha codici fiscali");
const c3 = await clic();
check(c3.registra === 0 && c3.salva === 0 && c3.stampa === 0, "e nemmeno qui Registra, Salva o Stampa");

// ---- 7. di nuovo il paziente giusto, dal preferito: cercato nel SISS per nome, scelto col codice
srvStato.paziente = PZ;
await siss.goto(`https://${PR}/prescrittivoRegionale/pages/dashboard`);
await siss.waitForLoadState();
await doc.bringToFront();
await $p('[data-ricvia="0"]').click();
await $p(`.ricchip[data-ricpref="${AIC}"]`).click();
await $p("#ricquesito").fill("");
const cercatiPrima = srvStato.cercati.length;
await sospendi(1600);
await $p("#ricprepara").click();
// intanto il medico scrive in un campo del gestionale: la scheda del SISS (che ha un «Registra») non gli viene davanti
await doc.evaluate(() => { if (!document.getElementById("campogest")) { const i = document.createElement("input"); i.id = "campogest"; document.body.prepend(i); } });
await doc.locator("#campogest").click();
let scrive = true;
const tasti = (async () => { while (scrive) { await doc.keyboard.type("a").catch(() => {}); await sospendi(250); } })();
check(await finche(async () => (await sissStato()).vista.endsWith("/editing/preview"), 30000), "dal preferito: di nuovo fino all'Anteprima");
await finche(async () => (await ricetta())?.stato === "anteprima", 8000);
await sospendi(1500);
scrive = false; await tasti;
check(!(await schedeSiss()).find((t) => /preview$/.test(t.url))?.active, "mentre scrivi nel gestionale la scheda del SISS non viene davanti da sola");
const az = await $p("#gchipaz, #strazione").innerText().catch(() => "");
check(/Ricetta.*pronta in Anteprima/.test(await rigaRic()) && az.trim() === "apri il SISS", `la striscia: «Ricetta · pronta in Anteprima» e «apri il SISS» (${await rigaRic()} · ${az})`);
await $p("#gchipaz, #strazione").click();
check(await finche(async () => (await schedeSiss()).find((t) => /preview$/.test(t.url))?.active, 5000), "un tocco su «apri il SISS»: la scheda del SISS davanti");
await doc.bringToFront();
await doc.evaluate(() => document.getElementById("campogest")?.blur());
// (il clic nel campo del gestionale ha fatto richiudere il pannello «al passaggio»: lo si riapre)
if (!(await $p(".card").count())) { await $p("#expand").click(); await doc.waitForSelector("#psassist-host .card #ricprepara", { timeout: 8000 }); }
const f7 = await sissStato();
check(f7.farmaci.length === 1 && f7.farmaci[0].codice === AIC && f7.farmaci[0].qta === 2 && f7.farmaci[0].ns === true && f7.quesito === "" && srvStato.cercati.slice(cercatiPrima).includes("AUGMENTIN"),
  `il preferito: cercato per nome nella ricerca del SISS, preso col codice esatto, con la sua quantità (${JSON.stringify(f7.farmaci)}; cercato ${srvStato.cercati.slice(cercatiPrima).join(",")})`);
const c7 = await clic();
check(c7.registra === 0 && c7.salva === 0 && c7.stampa === 0 && c7.cancella === 0 && c7.nuova === 1, `e di nuovo nessun Registra, Salva, Stampa (${JSON.stringify(c7)})`);

// ---- 8. la seconda guardia: un SISS che chiedesse di registrare MENTRE si compila → detto forte
srvStato.registraAlFarmaco = true;
await siss.goto(`https://${PR}/prescrittivoRegionale/pages/dashboard`);
await siss.waitForLoadState();
await doc.bringToFront();
await sospendi(1600);
const reg8 = srvStato.registrazioni;
await $p("#ricprepara").click();
check(await finche(async () => /il SISS sta registrando la ricetta, e non l'ho chiesto io/.test(await statoPannello()), 30000) && await $p("#ricstato.err").count() === 1,
  `se il SISS chiedesse di registrare durante la compilazione: «${await statoPannello()}», in rosso`);
check(srvStato.registrazioni === reg8 + 1 && (await clic()).registra === 0 && (await clic()).anteprima === 0
  && await finche(async () => (await errori()).some((e) => e.dati && e.dati.passo === "registrazione" && e.dati.grave), 5000),
  "vista dal flusso delle richieste (solo osservato), nel registro degli errori; la scheda si ferma: né Anteprima né Registra premuti da noi");

// ---- 8b. un'Anteprima che tornasse REGISTRATA (con l'NRE): detto forte, anche se le chiamate sono quelle di sempre
srvStato.registraAlFarmaco = false;
srvStato.anteprimaRegistrata = true;
await siss.goto(`https://${PR}/prescrittivoRegionale/pages/dashboard`);
await siss.waitForLoadState();
await doc.bringToFront();
await sospendi(1600);
await $p("#ricprepara").click();
check(await finche(async () => /all'Anteprima il SISS ha registrato la ricetta/.test(await statoPannello()), 30000) && await $p("#ricstato.err").count() === 1,
  `un'Anteprima «STATO: REGISTRATA»: «${await statoPannello()}», in rosso`);
check(await finche(async () => (await errori()).some((e) => e.dati && e.dati.passo === "anteprima" && e.dati.grave), 5000) && (await clic()).registra === 0,
  "nel registro degli errori, grave; Registra mai premuto da noi");

// ---- 9. una visita: dalla ricerca, inserita nella stessa casella, e l'Anteprima NON si preme
srvStato.anteprimaRegistrata = false;
await siss.goto(`https://${PR}/prescrittivoRegionale/pages/dashboard`);
await siss.waitForLoadState();
await doc.bringToFront();
await $p('[data-ricvia="0"]').click();
await $p("#ricq").fill("visita");
await sospendi(1600);
await $p("#riccerca").click();
check(await finche(async () => await $p('.ricrisv[data-ricadd="89.7"]').count() === 1, 25000), "cercata «visita» nel SISS: le visite fra i risultati, sceglibili");
await $p('.ricrisv[data-ricadd="89.7"]').click();
await $p(`.ricchip[data-ricpref="${AIC}"]`).click();
check(/Una ricetta alla volta: farmaci o visite/.test(await $p(".bdi").innerText()) && await $p(".ricv").count() === 1 && await $p('.ricv[data-ricriga="89.7"] .rictipo').count() === 1
  && await $p("#ricqta0").count() === 0, "farmaci e visite insieme no: «Una ricetta alla volta: farmaci o visite»; la visita senza quantità né «non sostituibile»");
const visPrima = await clic();
await $p("#ricprepara").click();
check(await finche(async () => /Visite inserite: aggiungi quesito e durata, poi Anteprima/.test(await statoPannello()), 30000), `con una visita si ferma prima dell'Anteprima: «${await statoPannello()}»`);
const f9 = await sissStato(), c9 = await clic();
check(f9.vista.endsWith("/editing") && f9.visite.length === 1 && f9.visite[0].codice === "89.7" && f9.farmaci.length === 0 && f9.quesito === "",
  `nel SISS la visita c'è (scelta col codice esatto fra due visite), il quesito vuoto: lo scrive il medico (${JSON.stringify(f9.visite)})`);
check(c9.anteprima === 0 && visPrima.anteprima === 0 && c9.registra === 0 && c9.salva === 0 && c9.stampa === 0 && c9.cancella === 0, `Anteprima mai premuta, né Registra, Salva, Stampa (${JSON.stringify(c9)})`);
check(await finche(async () => (await schedeSiss()).find((t) => /editing$/.test(t.url))?.active, 5000), "la scheda del SISS è davanti: tocca al medico");
check(await finche(async () => (await preferiti()).some((p) => p.codice === "89.7" && p.tipo === "visita" && p.descr === "VISITA GENERALE" && Object.keys(p).every((k) => ["codice", "descr", "tipo", "n", "ts"].includes(k))), 5000),
  "la visita inserita entra nei preferiti: codice, descrizione e tipo, nient'altro");
await doc.bringToFront();
check(await finche(async () => await $p('.ricchip[data-ricpref="89.7"]').count() === 1, 5000), "il pannello mostra la visita fra i preferiti");

// ---- 10. una ricetta che aspetta le scelte del pannello, e il medico fa da sé
// nel SISS fino all'Anteprima (il SISS chiama prepare-register-request): la
// ricetta è sua, nessun allarme — fino alla 3.75.1 era un falso «Errore grave»
await siss.goto(`https://${PR}/prescrittivoRegionale/pages/dashboard`);
await siss.waitForLoadState();
await doc.bringToFront();
await $p('[data-ricvia="0"]').click();
await $p("#ricq").fill("augmentin");
await sospendi(1600);
await $p("#riccerca").click();
check(await finche(async () => await $p(`.ricrisv[data-ricadd="${AIC}"]`).count() === 1, 25000), "cercato nel SISS dal pannello: la ricetta aspetta le tue scelte");
const reg10 = srvStato.registrazioni, err10 = (await errori()).length;
await siss.bringToFront();
await siss.locator("#ricerca").click();
await siss.keyboard.type("AUGMENTIN", { delay: 40 });
await siss.locator(`mat-option:has-text("${AIC}")`).first().click();
await siss.waitForFunction(() => !document.getElementById("anteprima").disabled, null, { timeout: 10000 });
await siss.locator("input[formcontrolname=note]").fill("1 bustina ogni 12 ore");
await siss.locator("input[formcontrolname=quantity]").fill("3");
await siss.locator("#anteprima").click();
check(await finche(async () => /Anteprima nel SISS/.test(await statoPannello()), 15000) && await $p("#ricstato.err").count() === 0,
  `il medico fa da sé fino all'Anteprima: il pannello lo prende per buono, niente rosso («${await statoPannello()}»)`);
check(srvStato.registrazioni === reg10 + 1 && (await errori()).length === err10 && (await clic()).registra === 0,
  "le chiamate del SISS all'Anteprima del medico: nessun errore nel registro");
check((await ricetta())?.stato === "anteprima" && !(await ricetta())?.cf, "la ricetta finisce lì, e il codice fiscale se ne va");

// ---- 11. imparato dalla ricetta fatta a mano: quante volte, la nota, niente del paziente
const PREF_OK = ["codice", "descr", "qta", "ns", "tipo", "n", "ts", "campi"];
check(await finche(async () => (await preferiti()).some((p) => p.codice === AIC && p.qta === 3 && p.campi && p.campi.note === "1 bustina ogni 12 ore" && p.n >= 3), 8000),
  `la ricetta a mano entra nei farmaci frequenti: quantità 3, la nota, contata (${JSON.stringify((await preferiti()).find((p) => p.codice === AIC))})`);
const pref11 = await preferiti();
check(pref11[0].codice === AIC && pref11.every((p) => Object.keys(p).every((k) => PREF_OK.includes(k))) && pref11.every((p) => !p.campi || Object.keys(p.campi).every((k) => k === "note"))
  && ![PZ.cf, PZ.cog, PZ.nom, PZ.tessera, ALTRO.cf, ALTRO.cog].some((x) => JSON.stringify(pref11).includes(x)),
  `nei farmaci frequenti solo il farmaco (il più usato davanti): nessun nome, codice fiscale, tessera (${pref11.map((p) => Object.keys(p).join("+")).join(" | ")})`);

// ---- 12. la volta dopo: il chip del farmaco frequente riempie la riga (nota compresa), e si ferma sull'Anteprima
await siss.goto(`https://${PR}/prescrittivoRegionale/pages/dashboard`);
await siss.waitForLoadState();
await doc.bringToFront();
while (await $p("[data-ricvia]").count()) await $p('[data-ricvia="0"]').click();
check(await finche(async () => /Farmaci frequenti/i.test(await $p(".ricetta").innerText()) && await $p(`.ricchip[data-ricpref="${AIC}"]`).count() === 1, 5000), "il pannello: «Farmaci frequenti», col chip");
await $p(`.ricchip[data-ricpref="${AIC}"]`).click();
await sospendi(1600);
await $p("#ricprepara").click();
check(await finche(async () => (await sissStato()).vista.endsWith("/editing/preview"), 30000), "un tocco sul chip e «Prepara»: di nuovo fino all'Anteprima");
const f12 = await sissStato(), c12 = await clic();
check(f12.farmaci.length === 1 && f12.farmaci[0].codice === AIC && f12.farmaci[0].qta === 3 && f12.farmaci[0].note === "1 bustina ogni 12 ore",
  `la riga come imparata: quantità e nota (${JSON.stringify(f12.farmaci)})`);
check(c12.registra === 0 && c12.salva === 0 && c12.stampa === 0, "e Registra, Salva, Stampa mai premuti");

// ---- 13. il campo imparato non c'è nel SISS: si ferma e lo dice, l'Anteprima non si preme
srvStato.senzaNota = true;
await siss.goto(`https://${PR}/prescrittivoRegionale/pages/dashboard`);
await siss.waitForLoadState();
await doc.bringToFront();
await sospendi(1600);
const ant13 = (await clic()).anteprima;
await $p("#ricprepara").click();
check(await finche(async () => /Fermato su «note»/.test(await statoPannello()), 30000), `il campo «note» non c'è: «${await statoPannello()}»`);
const c13 = await clic();
check(c13.anteprima === ant13 && c13.registra === 0 && (await sissStato()).vista.endsWith("/editing"), "fermo prima dell'Anteprima: niente premuto");

await ctx.close();
srv.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nRICETTA SISS: TUTTO OK");
process.exit(fail ? 1 : 0);
