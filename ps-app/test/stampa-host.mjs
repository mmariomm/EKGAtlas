#!/usr/bin/env node
/*
 * L'aiutante di stampa di Windows (stampa/host.ps1) fatto girare con
 * PowerShell 7 su Linux, avviato con le stesse opzioni di host.cmd e con
 * stdin che resta aperto, come fa Chrome: il filo (4 byte di lunghezza + JSON,
 * anche a pezzi), le tre domande, i controlli prima di stampare (è un PDF? la
 * stampante c'è, ed è accesa?), SumatraPDF chiamato con gli argomenti giusti —
 * qui un finto SumatraPDF che annota e copia il file —, la coda di Windows
 * guardata dopo (uscito, rimasto, fermo in errore), l'esito «sconosciuto»
 * quando SumatraPDF non finisce, il file temporaneo che sparisce, il registro
 * senza contenuto. Le stampanti e la coda di Windows le danno Get-CimInstance
 * e Get-PrintJob finti. E installa.ps1: la copia in %LOCALAPPDATA%, l'ID fisso,
 * SumatraPDF dallo zip in Download, i blocchi noti detti in italiano, e il
 * disinstalla che toglie tutto e lo controlla.
 * Senza PowerShell (variabile PWSH o `pwsh` nel PATH) la prova si salta.
 *   node test/stampa-host.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, chmodSync, existsSync, readdirSync, rmSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PWSH = process.env.PWSH || "pwsh";
if (spawnSync(PWSH, ["-NoProfile", "-Command", "exit 0"], { stdio: ["ignore", "ignore", "ignore"] }).status !== 0) {
  console.log("STAMPA-HOST: PowerShell non trovato (PWSH o pwsh): prova saltata\n");
  process.exit(0);
}

let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

// Le opzioni con cui host.cmd avvia PowerShell: le stesse, qui.
const cmd = readFileSync(join(root, "stampa/host.cmd"), "utf8");
const riga = cmd.split(/\r?\n/).find((l) => /powershell\.exe"?\s/i.test(l) && !/^rem\b/i.test(l)) || "";
const OPZIONI = (/powershell\.exe"?\s+(.*?)\s+-File\b/i.exec(riga)?.[1] || "").split(/\s+/).filter(Boolean);

const D = mkdtempSync(join(tmpdir(), "psa-host-"));
const APP = join(D, "app"), TMP = join(D, "tmp"), LOCALE = join(D, "locale");
for (const d of [APP, TMP, LOCALE]) mkdirSync(d);
copyFileSync(join(root, "stampa/host.ps1"), join(APP, "host.ps1"));
// il finto SumatraPDF: annota gli argomenti, copia il PDF ricevuto, dorme se
// deve, esce col codice voluto
writeFileSync(join(APP, "SumatraPDF.exe"), `#!/bin/sh
d=$(dirname "$0")
printf '%s\\n' "$@" > "$d/argomenti.txt"
cp "$6" "$d/stampato.pdf"
sleep \${PSA_SUMATRA_DORME:-0}
exit \${PSA_SUMATRA_ESCE:-0}
`);
chmodSync(join(APP, "SumatraPDF.exe"), 0o755);
// Windows finto: le stampanti (Get-CimInstance, che annota se gli si chiede
// l'elenco intero o una sola) e la coda (Get-PrintJob: il foglio appena
// mandato, nello stato voluto; Remove-PrintJob lo annota). Poi host.ps1 così
// com'è. ($input qui sotto non si usa mai: c'è perché basta nominarlo, e
// PowerShell senza -InputFormat None si mangerebbe stdin prima dello script.)
const TRACCIA = join(D, "traccia.txt");
writeFileSync(join(D, "prova.ps1"), `function Get-CimInstance { param([string]$ClassName, [string]$Filter, $OperationTimeoutSec)
  Add-Content -LiteralPath '${TRACCIA}' -Value ("cim " + $Filter)
  $tutte = $env:PSA_STAMPANTI | ConvertFrom-Json | ForEach-Object { [pscustomobject]@{ Name = $_.n; Default = $_.d; WorkOffline = [bool]$_.off; PrinterStatus = $(if ($_.st) { $_.st } else { 3 }) } }
  if (-not $Filter) { return $tutte }
  $nome = [regex]::Match($Filter, "^Name='(.*)'$").Groups[1].Value.Replace("\\'", "'").Replace('\\\\', '\\')
  $tutte | Where-Object { $_.Name -eq $nome } }
function Get-PrintJob { param($PrinterName)
  if (-not $env:PSA_CODA) { return }
  Get-ChildItem -LiteralPath '${TMP}' -Filter 'psassist-*.pdf' | ForEach-Object { [pscustomobject]@{ DocumentName = $_.FullName; JobStatus = $env:PSA_CODA; PrinterName = $PrinterName; PagesPrinted = [int]$env:PSA_PAGINE } } }
function Remove-PrintJob { param($InputObject) Add-Content -LiteralPath '${TRACCIA}' -Value ("tolto " + $InputObject.JobStatus) }
function Mai { $input }
. (Join-Path '${APP}' 'host.ps1')
`);
const STAMPANTI = [{ n: "Zebra ZD421", d: false }, { n: "HP LaserJet A4", d: true }, { n: "Microsoft Print to PDF", d: false },
  { n: "Zebra spenta", d: false, off: true }, { n: "TSC offline", d: false, st: 7 }, { n: "Ufficio\\", d: false }, { n: 'Sala "B"', d: false },
  { n: "X -exit-on-print -print-settings 99x", d: false }];

const cornice = (obj) => {
  const b = Buffer.from(JSON.stringify(obj), "utf8");
  const h = Buffer.alloc(4); h.writeUInt32LE(b.length, 0);
  return Buffer.concat([h, b]);
};
// Una domanda all'aiutante, come la manda Chrome: stdin resta aperto finché
// l'aiutante non esce (a pezzi, se `pezzi`). Chi non risponde entro `tetto` è fermato.
function chiedi(input, { esce = 0, dorme = 0, coda = "", pagine = 0, pezzi = 0, tetto = 30000 } = {}) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(PWSH, [...OPZIONI, "-File", join(D, "prova.ps1")], {
      env: { ...process.env, PSA_STAMPANTI: JSON.stringify(STAMPANTI), PSA_SUMATRA_ESCE: String(esce), PSA_SUMATRA_DORME: String(dorme),
        PSA_CODA: coda, PSA_PAGINE: String(pagine), TMPDIR: TMP, LOCALAPPDATA: LOCALE },
    });
    const out = [];
    let fermato = false;
    const tid = setTimeout(() => { fermato = true; p.kill("SIGKILL"); }, tetto);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", () => {});
    p.stdin.on("error", () => {});
    p.on("close", (code) => {
      clearTimeout(tid);
      const b = Buffer.concat(out);
      const n = b.length >= 4 ? b.readUInt32LE(0) : -1;
      let r = null;
      try { r = JSON.parse(b.subarray(4, 4 + n).toString("utf8")); } catch { /* sotto */ }
      res({ r, intero: b.length === 4 + n, code, fermato, s: (Date.now() - t0) / 1000 });
    });
    const buf = Buffer.isBuffer(input) ? input : cornice(input);
    if (!pezzi) { p.stdin.write(buf); return; }
    // a pezzi, con pause: stdin non arriva mai tutto insieme
    let i = 0;
    const passo = () => {
      if (i >= buf.length) return;
      p.stdin.write(buf.subarray(i, i + pezzi));
      i += pezzi;
      setTimeout(passo, 15);
    };
    passo();
  });
}
const pdf = (testo, kb = 0, box = "0 0 142 71") => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${testo}\n1 0 obj << /Type /Page /MediaBox [${box}] >> endobj\n`, "latin1"), Buffer.alloc(kb * 1024, 0x41), Buffer.from("\n%%EOF\n")]);
const argomenti = () => (existsSync(join(APP, "argomenti.txt")) ? readFileSync(join(APP, "argomenti.txt"), "utf8").trim().split("\n") : []);
const togliArgomenti = () => rmSync(join(APP, "argomenti.txt"), { force: true });
const temporanei = () => readdirSync(TMP).filter((f) => /^psassist-/.test(f));
const traccia = () => (existsSync(TRACCIA) ? readFileSync(TRACCIA, "utf8").trim().split("\n").filter(Boolean) : []);
const azzeraTraccia = () => rmSync(TRACCIA, { force: true });
const foglio = (stampante, extra = {}) => ({ t: "stampa", tipo: "etichette", stampante, pdf: pdf("x").toString("base64"), ...extra });

console.log("\naiutante di stampa (host.ps1)");
check(OPZIONI.includes("-InputFormat") && OPZIONI[OPZIONI.indexOf("-InputFormat") + 1] === "None" && /%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/i.test(riga),
  `host.cmd avvia PowerShell col percorso intero e -InputFormat None (got ${riga.trim()})`);
{
  const { r, intero, fermato } = await chiedi({ t: "ping" });
  check(r && r.ok === true && r.versione === "2" && intero && !fermato,
    `ping → la versione, su stdout solo la risposta, con stdin aperto come lo tiene Chrome (got ${JSON.stringify(r)}${fermato ? ", non ha risposto" : ""})`);
}
{
  const { r } = await chiedi({ t: "stampanti" });
  check(r && r.ok && r.stampanti.slice(0, 3).join("|") === "Zebra ZD421|HP LaserJet A4|Microsoft Print to PDF" && r.predefinita === "HP LaserJet A4",
    `stampanti → l'elenco e la predefinita di Windows (got ${JSON.stringify(r)})`);
}
{
  // un PDF di 3 MB, consegnato a pezzi da 64 KB: la lettura deve ricomporlo
  azzeraTraccia();
  const doc = pdf("PAZIENTE-FINTO etichette", 3 * 1024);
  const { r } = await chiedi({ t: "stampa", tipo: "etichette", stampante: "Zebra ZD421", ruota: "no", pdf: doc.toString("base64") }, { pezzi: 64 * 1024 });
  const a = argomenti();
  check(r && r.ok === true && r.esito === "stampato" && r.stampante === "Zebra ZD421", `etichette → «stampato» sulla Zebra: il foglio non è più nella coda di Windows (got ${JSON.stringify(r)})`);
  check(JSON.stringify(a) === JSON.stringify(["-print-to", "Zebra ZD421", "-print-settings", "noscale,disable-auto-rotation", "-silent", a[5]]) && /psassist-[0-9a-f]{32}\.pdf$/.test(a[5] || ""),
    `«ruota: no» → SumatraPDF -print-to "Zebra ZD421" -print-settings "noscale,disable-auto-rotation" -silent <file temporaneo> (got ${a.join(" | ")})`);
  check(Buffer.compare(readFileSync(join(APP, "stampato.pdf")), doc) === 0, "il PDF arrivato a SumatraPDF è identico, byte per byte (3 MB a pezzi)");
  check(temporanei().length === 0, "il file temporaneo non c'è più");
  check(JSON.stringify(r && r.pagina) === "[142,71]", `risponde con la misura della prima pagina, in punti (got ${JSON.stringify(r && r.pagina)})`);
  const t = traccia();
  check(t.length && t.every((x) => /^cim Name='Zebra ZD421'$/.test(x)), `per stampare chiede a Windows di QUELLA stampante, mai l'elenco intero (got ${t.join(" | ")})`);
}
{
  togliArgomenti();
  const { r } = await chiedi(foglio("Zebra ZD421", { ruota: "auto" }));
  check(r && r.ok && argomenti()[3] === "noscale", `«ruota: auto» → «noscale», e SumatraPDF gira l'etichetta come vuole lui (got ${argomenti()[3]})`);
}
{
  // un nome di stampante che sembra fatto di opzioni resta UN argomento (fra virgolette)
  togliArgomenti();
  const { r } = await chiedi(foglio("X -exit-on-print -print-settings 99x"));
  const a = argomenti();
  check(r && r.ok && a.length === 6 && a[1] === "X -exit-on-print -print-settings 99x" && a[3] === "noscale" && /psassist-/.test(a[5] || ""),
    `un nome con dei «-» che sembrano opzioni: a SumatraPDF arriva come un argomento solo (got ${a.join(" | ")})`);
}
{
  togliArgomenti();
  const { r } = await chiedi({ t: "stampa", tipo: "a4", stampante: "HP LaserJet A4", pdf: pdf("lista").toString("base64") }, { pezzi: 7 });
  check(r && r.ok && argomenti()[3] === "fit" && argomenti()[1] === "HP LaserJet A4", `A4 → adattata al foglio («fit»), anche a pezzi di 7 byte (got ${JSON.stringify(r)} · ${argomenti().join(" ")})`);
}
{
  // la coda di Windows: il foglio che resta lì è «mandato», non «stampato»;
  // un'etichetta la si guarda 10 secondi (un'etichettatrice di rete è lenta), l'A4 4
  const { r, s } = await chiedi(foglio("Zebra ZD421"), { coda: "Spooling" });
  check(r && r.ok === true && r.esito === "mandato" && s >= 9 && s < 20, `l'etichetta resta nella coda per 10 secondi → «mandato», non «stampato» (got ${JSON.stringify(r)}, ${s.toFixed(1)} s)`);
  const a4 = await chiedi({ t: "stampa", tipo: "a4", stampante: "HP LaserJet A4", pdf: pdf("lista").toString("base64") }, { coda: "Spooling" });
  check(a4.r && a4.r.esito === "mandato" && a4.s < 9, `la lista A4 la si guarda 4 secondi (got ${JSON.stringify(a4.r)}, ${a4.s.toFixed(1)} s)`);
  azzeraTraccia();
  const e = await chiedi(foglio("Zebra ZD421"), { coda: "Error" });
  check(e.r && e.r.ok === false && e.r.esito === "fallito" && /risulta spenta o offline/.test(e.r.why) && traccia().includes("tolto Error"),
    `il foglio fermo in errore prima di stampare → tolto dalla coda, ok:false «fallito», «la stampante risulta spenta o offline» (got ${JSON.stringify(e.r)} · ${traccia().join(" | ")})`);
  // fermo in errore mentre stampava: un pezzo può essere uscito, o restare
  // nella stampante e uscire dopo — un secondo foglio dal dialogo sarebbe doppio
  azzeraTraccia();
  const ep = await chiedi(foglio("Zebra ZD421"), { coda: "Error, Printing" });
  check(ep.r && ep.r.ok === false && ep.r.esito === "sconosciuto" && /si è fermata mentre stampava/.test(ep.r.why) && traccia().includes("tolto Error, Printing"),
    `il foglio fermo in errore mentre stampava («Error, Printing») → tolto, ma «sconosciuto», non «fallito» (got ${JSON.stringify(ep.r)} · ${traccia().join(" | ")})`);
  const pag = await chiedi(foglio("Zebra ZD421"), { coda: "Error", pagine: 1 });
  check(pag.r && pag.r.esito === "sconosciuto", `fermo in errore con una pagina già stampata (PagesPrinted > 0) → «sconosciuto» (got ${JSON.stringify(pag.r)})`);
  const pausa = await chiedi(foglio("Zebra ZD421"), { coda: "Paused" });
  check(pausa.r && pausa.r.esito === "fallito", `in pausa prima di stampare: «fallito» (got ${JSON.stringify(pausa.r)})`);
}
for (const [cosa, domanda, re] of [
  ["non è un PDF", { t: "stampa", tipo: "a4", stampante: "HP LaserJet A4", pdf: Buffer.from("<html>login</html>").toString("base64") }, /non è un PDF/],
  ["una stampante che non c'è", foglio("Stampante del vicino"), /Stampante del vicino.*non c'è/],
  ["una stampante «usa offline»", foglio("Zebra spenta"), /Zebra spenta.*risulta spenta o offline/],
  ["una stampante che Windows dice offline", foglio("TSC offline"), /TSC offline.*risulta spenta o offline/],
  ["un nome che finisce con «\\»", foglio("Ufficio\\"), /non si può usare/],
  ["un nome con le virgolette", foglio('Sala "B"'), /non si può usare/],
  ["un tipo di foglio sconosciuto", { t: "stampa", tipo: "poster", stampante: "HP LaserJet A4", pdf: pdf("x").toString("base64") }, /tipo di foglio/],
  ["un base64 rotto", { t: "stampa", tipo: "a4", stampante: "HP LaserJet A4", pdf: "QUJD=====" }, /non è leggibile/],
  ["una domanda che non conosce", { t: "esegui", cmd: "calc.exe" }, /domanda sconosciuta/],
]) {
  togliArgomenti();
  const { r } = await chiedi(domanda);
  check(r && r.ok === false && r.esito === "fallito" && re.test(r.why || "") && !argomenti().length, `${cosa}: rifiutato col motivo, «fallito», SumatraPDF mai chiamato (got ${JSON.stringify(r)})`);
}
{
  togliArgomenti();
  const { r } = await chiedi(foglio("Zebra ZD421"), { esce: 1 });
  check(r && r.ok === false && r.esito === "fallito" && r.why === "SumatraPDF non è riuscito a stampare il foglio" && argomenti().length === 6 && temporanei().length === 0,
    `SumatraPDF 3.6.1 che esce con 1 (un file non stampato) → «non è riuscito a stampare il foglio», e il temporaneo sparisce (got ${JSON.stringify(r)})`);
}
{
  // SumatraPDF che non finisce: fermato entro il tetto, e l'esito è «sconosciuto» (può essere uscito)
  togliArgomenti();
  const { r, s } = await chiedi(foglio("Zebra ZD421"), { dorme: 120, tetto: 60000 });
  check(r && r.ok === false && r.esito === "sconosciuto" && /non ha finito/.test(r.why) && s < 40 && temporanei().length === 0,
    `SumatraPDF che non finisce → fermato, «sconosciuto», tutto entro 40 secondi (got ${JSON.stringify(r)}, ${s.toFixed(1)} s)`);
}
{
  // i fogli di una stampa interrotta, rimasti da prima: via quelli di più di 10 minuti
  const vecchio = join(TMP, "psassist-" + "a".repeat(32) + ".pdf"), fresco = join(TMP, "psassist-" + "b".repeat(32) + ".pdf");
  writeFileSync(vecchio, "%PDF- vecchio"); writeFileSync(fresco, "%PDF- fresco");
  const prima = new Date(Date.now() - 11 * 60e3);
  utimesSync(vecchio, prima, prima);
  await chiedi({ t: "ping" });
  check(!existsSync(vecchio) && existsSync(fresco), "all'avvio cancella i fogli temporanei rimasti da più di 10 minuti, non gli altri");
  rmSync(fresco, { force: true });
}
{
  const h = Buffer.alloc(4); h.writeUInt32LE(0x7fffffff, 0);
  const { r } = await chiedi(h);
  check(r && r.ok === false && /lunghezza/.test(r.why), `una lunghezza impossibile → rifiutata, senza leggere oltre (got ${JSON.stringify(r)})`);
}
{
  const log = join(LOCALE, "PSAssist", "stampa.log");
  const testo = existsSync(log) ? readFileSync(log, "utf8") : "";
  check(/stampa etichette -> Zebra ZD421: stampato \(\d+ KB, [\d.,]+ s, 50x25 mm, noscale,disable-auto-rotation\)/.test(testo) && /stampa etichette: fallito - SumatraPDF non è riuscito/.test(testo)
    && /stampa etichette: sconosciuto - SumatraPDF non ha finito/.test(testo),
  `il registro dice cosa è uscito, dove, la misura e le opzioni, e cosa no (got ${testo.split("\n").length - 1} righe)`);
  check(!/PAZIENTE-FINTO|AAAA/.test(testo), "nel registro non c'è niente del contenuto");
}

// ---- installa.ps1 --------------------------------------------------------
// Il registro di Windows qui non c'è: le chiavi HKCU stanno in un file (New-Item,
// Test-Path e Remove-Item finti per quelle sole; il resto è vero), i criteri in
// un JSON (Get-ItemProperty finto), il download
// (Invoke-WebRequest) e la prova di SumatraPDF (Start-Process) pure. Le impronte
// dei SumatraPDF finti valgono quelle vere (Get-FileHash finto per loro soli).
console.log("\ninstallazione (installa.ps1)");
const ZIPDIR = join(D, "zip-estratto"), CASA = join(D, "casa"), UTENTE = join(D, "utente");
for (const d of [ZIPDIR, CASA, UTENTE, join(UTENTE, "Downloads")]) mkdirSync(d, { recursive: true });
for (const f of ["installa.ps1", "host.ps1", "host.cmd", "disinstalla.cmd"]) copyFileSync(join(root, "stampa", f), join(ZIPDIR, f));
const testo = readFileSync(join(root, "stampa/installa.ps1"), "utf8");
const ZIP_SHA = /\$ZIP_SHA256 = '([0-9A-F]{64})'/.exec(testo)?.[1], EXE_SHA = /\$EXE_SHA256 = '([0-9A-F]{64})'/.exec(testo)?.[1];
// l'ID che la chiave del manifest dà all'estensione: lo stesso ovunque
const chiave = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8")).key || "";
const ID = [...createHash("sha256").update(Buffer.from(chiave, "base64")).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const REG = join(D, "registro.json");
writeFileSync(join(D, "installa-prova.ps1"), `param([switch]$Togli)
$REG = '${REG}'
function Leggi-Reg { if (Test-Path -LiteralPath $REG) { Get-Content -LiteralPath $REG -Raw | ConvertFrom-Json -AsHashtable } else { @{} } }
function Scrivi-Reg($r) { $r | ConvertTo-Json | Set-Content -LiteralPath $REG }
function New-Item { param($Path, $Value, $ItemType, [switch]$Force)
  if ("$Path" -like 'HKCU:*') { $r = Leggi-Reg; $r["$Path"] = "$Value"; Scrivi-Reg $r; return }
  Microsoft.PowerShell.Management\\New-Item @PSBoundParameters }
function Test-Path { param($Path, $LiteralPath)
  if ("$Path" -like 'HKCU:*') { return (Leggi-Reg).ContainsKey("$Path") }
  Microsoft.PowerShell.Management\\Test-Path @PSBoundParameters }
function Remove-Item { param($Path, $LiteralPath, [switch]$Recurse, [switch]$Force, [Parameter(ValueFromPipeline = $true)]$InputObject)
  process {
    if ("$Path" -like 'HKCU:*') { if ($env:PSA_REG_BLOCCATO) { throw 'Accesso negato' }; $r = Leggi-Reg; $r.Remove("$Path"); Scrivi-Reg $r; return }
    if ($InputObject) { Microsoft.PowerShell.Management\\Remove-Item -LiteralPath $InputObject.FullName -Force -ErrorAction SilentlyContinue; return }
    $a = @{} + $PSBoundParameters; $a.Remove('InputObject') | Out-Null
    Microsoft.PowerShell.Management\\Remove-Item @a } }
function Get-ItemProperty { param($Path, $Name, $ErrorAction)
  $c = ($env:PSA_CRITERI | ConvertFrom-Json -AsHashtable)
  if (-not $c -or -not $c.ContainsKey("$Path")) { throw 'chiave assente' }
  [pscustomobject]$c["$Path"] }
function Invoke-WebRequest { param($Uri, $OutFile, [switch]$UseBasicParsing) Add-Content -LiteralPath '${TRACCIA}' -Value "scarico $Uri"; throw 'rete bloccata dal proxy' }
function Start-Process { param($FilePath, $ArgumentList, [switch]$PassThru, $WindowStyle)
  Add-Content -LiteralPath '${TRACCIA}' -Value ("prova " + ($ArgumentList -join ' '))
  if ($env:PSA_SUMATRA_BLOCCATO) { throw 'Questo programma è bloccato da Criteri di gruppo' }
  $o = [pscustomobject]@{ ExitCode = 1 }; $o | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $true }; $o }
function Get-FileHash { param($LiteralPath, $Algorithm)
  if (($env:PSA_ZIP_GIUSTI -split ';') -contains $LiteralPath) { return [pscustomobject]@{ Hash = '${ZIP_SHA}' } }
  if ((Microsoft.PowerShell.Management\\Get-Content -LiteralPath $LiteralPath -Raw -ErrorAction SilentlyContinue) -match '^#!/bin/sh\\n# SUMATRA-FINTO-GIUSTO') { return [pscustomobject]@{ Hash = '${EXE_SHA}' } }
  Microsoft.PowerShell.Utility\\Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256 }
if ($env:PSA_LIMITATO) { $ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage' }
& (Join-Path '${ZIPDIR}' 'installa.ps1') -Togli:$Togli
exit $LASTEXITCODE
`);
const installa = (env = {}, togli = false) => {
  const r = spawnSync(PWSH, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", join(D, "installa-prova.ps1"), ...(togli ? ["-Togli"] : [])],
    { encoding: "utf8", env: { ...process.env, LOCALAPPDATA: CASA, USERPROFILE: UTENTE, TMPDIR: TMP, PSA_CRITERI: "{}", ...env } });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "");
  if (process.env.PSA_DEBUG) console.log(out);
  return { ...r, out };
};
const DOVE = join(CASA, "PSAssist", "stampa");
const registro = () => (existsSync(REG) ? JSON.parse(readFileSync(REG, "utf8") || "{}") : {});
const CHIAVI = ["HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\it.psassist.stampa", "HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\it.psassist.stampa"];
// lo zip di SumatraPDF scaricato col browser, in Download: dentro, il finto
const ZIP = join(UTENTE, "Downloads", "SumatraPDF-3.6.1-64.zip");
const STAGE = join(D, "stage"); mkdirSync(STAGE);
writeFileSync(join(STAGE, "SumatraPDF-3.6.1-64.exe"), "#!/bin/sh\n# SUMATRA-FINTO-GIUSTO\nexit 1\n");
spawnSync("zip", ["-q", "-j", ZIP, join(STAGE, "SumatraPDF-3.6.1-64.exe")]);
{
  check(ID === "jhhlgabilanhhnncahahclcjbefaofij", `la chiave del manifest dà a PS Assist l'ID fisso jhhlgabilanhhnncahahclcjbefaofij (got ${ID})`);
  azzeraTraccia();
  const r = installa({ PSA_ZIP_GIUSTI: ZIP });
  const man = existsSync(join(DOVE, "it.psassist.stampa.json")) ? JSON.parse(readFileSync(join(DOVE, "it.psassist.stampa.json"), "utf8")) : null;
  check(r.status === 0 && /Fatto\./.test(r.out), `finisce con «Fatto» (got ${r.out.trim().split("\n").slice(-2).join(" / ")})`);
  check(["host.cmd", "host.ps1", "installa.ps1", "disinstalla.cmd", "SumatraPDF.exe"].every((f) => existsSync(join(DOVE, f))),
    `copia l'aiutante, sé stesso, disinstalla.cmd e SumatraPDF in %LOCALAPPDATA%\\PSAssist\\stampa: per toglierla non serve lo zip (got ${existsSync(DOVE) ? readdirSync(DOVE).join(", ") : "niente"})`);
  check(/SUMATRA-FINTO-GIUSTO/.test(readFileSync(join(DOVE, "SumatraPDF.exe"), "utf8")) && /Uso .*Downloads.*SumatraPDF-3\.6\.1-64\.zip/.test(r.out) && !traccia().some((x) => /^scarico/.test(x)),
    "SumatraPDF dallo zip in Download (impronta controllata), senza scaricare niente");
  check(man && man.name === "it.psassist.stampa" && man.path === "host.cmd" && man.type === "stdio" && JSON.stringify(man.allowed_origins) === JSON.stringify([`chrome-extension://${ID}/`]),
    `il manifest accanto: host.cmd, e solo PS Assist, con l'ID fisso — niente profili da frugare, niente ID da incollare (got ${JSON.stringify(man)})`);
  const reg = registro();
  check(CHIAVI.every((k) => reg[k] === join(DOVE, "it.psassist.stampa.json")) && Object.keys(reg).length === 2,
    `le due chiavi dell'utente (HKCU), per Chrome e per Edge, puntano alla copia (got ${JSON.stringify(reg)})`);
  check(traccia().some((x) => /^prova -print-to "PS Assist prova" -silent ".*psassist-nessuno\.pdf"$/.test(x)), "prova a far partire SumatraPDF (un file che non c'è: niente stampa)");
}
{
  // rilanciato da uno zip più nuovo: aggiorna la copia
  writeFileSync(join(ZIPDIR, "host.ps1"), readFileSync(join(ZIPDIR, "host.ps1"), "utf8") + "\n# versione nuova\n");
  const r = installa();
  check(r.status === 0 && /# versione nuova/.test(readFileSync(join(DOVE, "host.ps1"), "utf8")), "rilanciato, aggiorna la copia (e SumatraPDF, già giusto, resta)");
}
// (AppLocker guarda anche i .cmd: all'IT si chiede la cartella intera, host.cmd compreso)
const CARTELLA = /Da chiedere all'IT: consentire \(AppLocker\/WDAC\) la cartella .*PSAssist.stampa intera: host\.cmd, host\.ps1, installa\.ps1, disinstalla\.cmd, SumatraPDF\.exe/;
for (const [cosa, env, re] of [
  ["PowerShell in modalità limitata", { PSA_LIMITATO: "1" }, new RegExp(`modalità limitata \\(ConstrainedLanguage\\).*\\n.*${CARTELLA.source}.*FullLanguage`)],
  ["Chrome senza aiutanti dell'utente", { PSA_CRITERI: JSON.stringify({ "HKLM:\\SOFTWARE\\Policies\\Google\\Chrome": { NativeMessagingUserLevelHosts: 0 } }) },
    /Chrome non accetta aiutanti installati dall'utente \(criterio NativeMessagingUserLevelHosts disattivato\).*\n.*Da chiedere all'IT: registrare it\.psassist\.stampa in HKLM/],
  ["Edge che vieta tutti gli aiutanti", { PSA_CRITERI: JSON.stringify({ "HKCU:\\SOFTWARE\\Policies\\Microsoft\\Edge\\NativeMessagingBlocklist": { 1: "*" } }) },
    /Edge vieta gli aiutanti \(criterio NativeMessagingBlocklist\).*\n.*Da chiedere all'IT: aggiungere it\.psassist\.stampa a NativeMessagingAllowlist/],
  ["Chrome che vieta tutti gli aiutanti col nome vecchio del criterio (NativeMessagingBlacklist)", { PSA_CRITERI: JSON.stringify({ "HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\\NativeMessagingBlacklist": { 1: "*" } }) },
    /Chrome vieta gli aiutanti \(criterio NativeMessagingBlocklist\).*\n.*Da chiedere all'IT: aggiungere it\.psassist\.stampa a NativeMessagingAllowlist/],
  ["il prompt dei comandi vietato agli script", { PSA_CRITERI: JSON.stringify({ "HKCU:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System": { DisableCMD: 1 } }) },
    /DisableCMD = 1.*\n.*Da chiedere all'IT: impostare DisableCMD = 2/],
  ["SumatraPDF bloccato", { PSA_SUMATRA_BLOCCATO: "1" }, new RegExp(`SumatraPDF\\.exe non parte .*bloccato da Criteri di gruppo.*\\n.*${CARTELLA.source}.*SumatraPDF\\.exe 3\\.6\\.1, firmato «Krzysztof Kowalczyk», SHA-256 719F689B`)],
]) {
  const r = installa(env);
  check(r.status === 1 && re.test(r.out) && /Non riuscito/.test(r.out), `${cosa}: una riga in italiano, e che cosa chiedere all'IT (got ${r.out.trim().split("\n").slice(-4).join(" / ")})`);
}
{
  const r = installa({ PSA_CRITERI: JSON.stringify({ "HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\\NativeMessagingBlocklist": { 1: "*" }, "HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\\NativeMessagingAllowlist": { 1: "it.psassist.stampa" } }) });
  check(r.status === 0, "tutti vietati ma PS Assist nell'elenco dei permessi: nessun blocco");
  const v = installa({ PSA_CRITERI: JSON.stringify({ "HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\\NativeMessagingBlacklist": { 1: "*" }, "HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\\NativeMessagingWhitelist": { 1: "it.psassist.stampa" } }) });
  check(v.status === 0, "lo stesso coi nomi vecchi dei criteri (NativeMessagingBlacklist / NativeMessagingWhitelist)");
}
{
  // senza SumatraPDF da nessuna parte e senza rete: i due indirizzi e
  // l'impronta — e gli altri blocchi lo stesso, in un elenco solo per l'IT
  rmSync(join(DOVE, "SumatraPDF.exe"), { force: true });
  rmSync(ZIP, { force: true });
  rmSync(REG, { force: true });
  azzeraTraccia();
  const r = installa({ PSA_CRITERI: JSON.stringify({ "HKCU:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System": { DisableCMD: 1 } }) });
  check(r.status === 1 && /www\.sumatrapdfreader\.org/.test(r.out) && /files\.sumatrapdfreader\.org/.test(r.out) && r.out.includes(ZIP_SHA) && /rete bloccata/.test(r.out)
    && traccia().some((x) => /^scarico https:\/\/www\.sumatrapdfreader\.org\//.test(x)),
  `download bloccato: i due indirizzi da chiedere e l'impronta SHA-256 dello zip (got ${r.out.trim().split("\n").slice(-5).join(" / ")})`);
  const it = r.out.split("\n").filter((x) => /Da chiedere all'IT/.test(x));
  check(it.length === 2 && it.some((x) => /sumatrapdfreader/.test(x)) && it.some((x) => /DisableCMD = 2/.test(x)) && /2 blocchi da togliere/.test(r.out),
    `e il download bloccato non nasconde gli altri blocchi: tutti in un elenco solo (got ${it.join(" / ")})`);
  check(!Object.keys(registro()).length && !traccia().some((x) => /^prova /.test(x)), "senza SumatraPDF niente chiavi nel registro: Chrome non crede di avere un aiutante che non può stampare");
  spawnSync("zip", ["-q", "-j", ZIP, join(STAGE, "SumatraPDF-3.6.1-64.exe")]);
  check(installa({ PSA_ZIP_GIUSTI: ZIP }).status === 0, "(lo zip in Download, e rilanciato: installata)");
}
{
  // disinstalla: le chiavi, la cartella (aiutante, SumatraPDF, registro delle stampe) e i fogli rimasti
  check(Object.keys(registro()).length === 2, "(prima: installata)");
  const bloccato = installa({ PSA_REG_BLOCCATO: "1" }, true);
  check(bloccato.status === 1 && /Non riuscito: resta ancora: HKCU/.test(bloccato.out), `il registro che non si lascia toccare: non dice «Fatto», e dice che cosa resta (got ${bloccato.out.trim().split("\n").slice(-1)})`);
  mkdirSync(DOVE, { recursive: true });
  writeFileSync(join(DOVE, "SumatraPDF.exe"), "#!/bin/sh\n# SUMATRA-FINTO-GIUSTO\nexit 1\n");
  writeFileSync(join(CASA, "PSAssist", "stampa.log"), "riga\n");
  writeFileSync(join(TMP, "psassist-" + "c".repeat(32) + ".pdf"), "%PDF- etichette");
  const r = installa({}, true);
  check(r.status === 0 && /Fatto\..*tolta/.test(r.out) && Object.keys(registro()).length === 0 && !existsSync(join(CASA, "PSAssist")) && temporanei().length === 0,
    `disinstalla.cmd: via le due chiavi, %LOCALAPPDATA%\\PSAssist (copia, SumatraPDF, registro) e i fogli temporanei, controllato (got ${r.out.trim().split("\n").slice(-1)})`);
  const dis = readFileSync(join(root, "stampa/disinstalla.cmd"), "utf8");
  check(/installa\.ps1" -Togli/.test(dis) && !/reg delete/i.test(dis), "disinstalla.cmd lo fa fare a installa.ps1 -Togli (PowerShell, con la verifica), non a reg.exe");
  // (copiato nella cartella che toglie: cmd legge il file una riga alla volta, e
  // Windows non cancella la cartella in cui un programma sta lavorando)
  const ultima = dis.split(/\r?\n/).filter((l) => l && !/^(@echo|rem\b)/i.test(l));
  check(ultima.length === 1 && /^cd \/d "%TEMP%" & .*installa\.ps1" -Togli & echo\. & pause & exit \/b$/.test(ultima[0]),
    `disinstalla.cmd va anche da %LOCALAPPDATA%\\PSAssist\\stampa: lavora da %TEMP%, tutto su una riga (got ${ultima.join(" / ")})`);
  const ins = readFileSync(join(root, "stampa/installa.cmd"), "utf8");
  check(/if not exist "%~dp0installa\.ps1"/.test(ins) && /Estrai prima lo zip/i.test(ins) && /-Command "Get-ChildItem -LiteralPath '%PSA_QUI%' \| Unblock-File"/.test(ins),
    "installa.cmd: «Estrai prima lo zip» se manca installa.ps1, e Unblock-File sulla sua cartella (un comando, non uno script)");
  // Un criterio di gruppo AllSigned vince su -ExecutionPolicy Bypass: installa.ps1
  // non partirebbe nemmeno. installa.cmd lo chiede prima, con un comando.
  const pre = ins.indexOf("Get-ExecutionPolicy -Scope MachinePolicy; Get-ExecutionPolicy -Scope UserPolicy"), lancio = ins.indexOf("-File \"%~dp0installa.ps1\"");
  check(pre > 0 && pre < lancio && /-Command "Get-ExecutionPolicy/.test(ins) && /"AllSigned"/.test(ins) && /"Restricted"/.test(ins)
    && /Da chiedere all'IT: firmare host\.ps1 e installa\.ps1/.test(ins) && /exit \/b 1/.test(ins.slice(pre, lancio)) && !/Get-ExecutionPolicy/.test(readFileSync(join(root, "stampa/installa.ps1"), "utf8")),
  "installa.cmd guarda il criterio sugli script (-Command \"Get-ExecutionPolicy\") prima di lanciare installa.ps1, e dice che cosa chiedere all'IT");
}

if (!process.env.PSA_TIENI) rmSync(D, { recursive: true, force: true });
console.log(fail ? `\nSTAMPA-HOST: ${fail} CHECK FALLITI\n` : "\nSTAMPA-HOST: TUTTO OK\n");
process.exit(fail ? 1 : 0);
