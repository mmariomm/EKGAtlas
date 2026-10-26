#!/usr/bin/env node
/*
 * L'aiutante di stampa di Windows (stampa/host.ps1) fatto girare con
 * PowerShell 7 su Linux: il filo con Chrome (4 byte di lunghezza + JSON, anche
 * a pezzi), le tre domande, i controlli prima di stampare (è un PDF? la
 * stampante c'è?), SumatraPDF chiamato con gli argomenti giusti — qui un finto
 * SumatraPDF che annota e copia il file — il file temporaneo che sparisce, il
 * registro senza contenuto. Le stampanti di Windows le dà un Get-CimInstance
 * finto. E installa.ps1: PS Assist trovata nei profili di Chrome e di Edge (o
 * l'ID incollato), il manifest accanto, le due chiavi HKCU (finte).
 * Senza PowerShell (variabile PWSH o `pwsh` nel PATH) la prova si salta.
 *   node test/stampa-host.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, chmodSync, existsSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PWSH = process.env.PWSH || "pwsh";
if (spawnSync(PWSH, ["-NoProfile", "-Command", "exit 0"]).status !== 0) {
  console.log("STAMPA-HOST: PowerShell non trovato (PWSH o pwsh): prova saltata\n");
  process.exit(0);
}

let fail = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

const D = mkdtempSync(join(tmpdir(), "psa-host-"));
const APP = join(D, "app"), TMP = join(D, "tmp"), LOCALE = join(D, "locale");
for (const d of [APP, TMP, LOCALE]) mkdirSync(d);
copyFileSync(join(root, "stampa/host.ps1"), join(APP, "host.ps1"));
// il finto SumatraPDF: annota gli argomenti, copia il PDF ricevuto, esce col codice voluto
writeFileSync(join(APP, "SumatraPDF.exe"), `#!/bin/sh
d=$(dirname "$0")
printf '%s\\n' "$@" > "$d/argomenti.txt"
cp "$6" "$d/stampato.pdf"
exit \${PSA_SUMATRA_ESCE:-0}
`);
chmodSync(join(APP, "SumatraPDF.exe"), 0o755);
// le stampanti «di Windows»: Get-CimInstance finto, poi host.ps1 così com'è
writeFileSync(join(D, "prova.ps1"), `function Get-CimInstance { param([string]$ClassName)
  $env:PSA_STAMPANTI | ConvertFrom-Json | ForEach-Object { [pscustomobject]@{ Name = $_.n; Default = $_.d } } }
. (Join-Path '${APP}' 'host.ps1')
`);
const STAMPANTI = JSON.stringify([{ n: "Zebra ZD421", d: false }, { n: "HP LaserJet A4", d: true }, { n: "Microsoft Print to PDF", d: false }]);

const cornice = (obj) => {
  const b = Buffer.from(JSON.stringify(obj), "utf8");
  const h = Buffer.alloc(4); h.writeUInt32LE(b.length, 0);
  return Buffer.concat([h, b]);
};
// una domanda all'aiutante, come la manda Chrome: a pezzi se `pezzi`
function chiedi(input, { esce = 0, pezzi = 0 } = {}) {
  return new Promise((res) => {
    const p = spawn(PWSH, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", join(D, "prova.ps1")], {
      env: { ...process.env, PSA_STAMPANTI: STAMPANTI, PSA_SUMATRA_ESCE: String(esce), TMPDIR: TMP, LOCALAPPDATA: LOCALE },
    });
    const out = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", () => {});
    p.on("close", (code) => {
      const b = Buffer.concat(out);
      const n = b.length >= 4 ? b.readUInt32LE(0) : -1;
      let r = null;
      try { r = JSON.parse(b.subarray(4, 4 + n).toString("utf8")); } catch { /* sotto */ }
      res({ r, intero: b.length === 4 + n, code });
    });
    const buf = Buffer.isBuffer(input) ? input : cornice(input);
    if (!pezzi) { p.stdin.end(buf); return; }
    // a pezzi, con pause: stdin non arriva mai tutto insieme
    let i = 0;
    const passo = () => {
      if (i >= buf.length) return p.stdin.end();
      p.stdin.write(buf.subarray(i, i + pezzi));
      i += pezzi;
      setTimeout(passo, 15);
    };
    passo();
  });
}
const pdf = (testo, kb = 0) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${testo}\n`, "latin1"), Buffer.alloc(kb * 1024, 0x41), Buffer.from("\n%%EOF\n")]);
const argomenti = () => (existsSync(join(APP, "argomenti.txt")) ? readFileSync(join(APP, "argomenti.txt"), "utf8").trim().split("\n") : []);
const togliArgomenti = () => rmSync(join(APP, "argomenti.txt"), { force: true });
const temporanei = () => readdirSync(TMP).filter((f) => /^psassist-/.test(f));

console.log("\naiutante di stampa (host.ps1)");
{
  const { r, intero } = await chiedi({ t: "ping" });
  check(r && r.ok === true && r.versione === "1" && intero, `ping → la versione, e su stdout solo la risposta (got ${JSON.stringify(r)})`);
}
{
  const { r } = await chiedi({ t: "stampanti" });
  check(r && r.ok && JSON.stringify(r.stampanti) === JSON.stringify(["Zebra ZD421", "HP LaserJet A4", "Microsoft Print to PDF"]) && r.predefinita === "HP LaserJet A4",
    `stampanti → l'elenco e la predefinita di Windows (got ${JSON.stringify(r)})`);
}
{
  // un PDF di 3 MB, consegnato a pezzi da 64 KB: la lettura deve ricomporlo
  const doc = pdf("PAZIENTE-FINTO etichette", 3 * 1024);
  const { r } = await chiedi({ t: "stampa", tipo: "etichette", stampante: "Zebra ZD421", pdf: doc.toString("base64") }, { pezzi: 64 * 1024 });
  const a = argomenti();
  check(r && r.ok === true && r.stampante === "Zebra ZD421", `etichette → ok, sulla Zebra (got ${JSON.stringify(r)})`);
  check(JSON.stringify(a) === JSON.stringify(["-print-to", "Zebra ZD421", "-print-settings", "noscale", "-silent", a[5]]) && /psassist-[0-9a-f]{32}\.pdf$/.test(a[5] || ""),
    `SumatraPDF -print-to "Zebra ZD421" -print-settings noscale -silent <file temporaneo> (got ${a.join(" | ")})`);
  check(Buffer.compare(readFileSync(join(APP, "stampato.pdf")), doc) === 0, "il PDF arrivato a SumatraPDF è identico, byte per byte (3 MB a pezzi)");
  check(temporanei().length === 0, "il file temporaneo non c'è più");
}
{
  togliArgomenti();
  const { r } = await chiedi({ t: "stampa", tipo: "a4", stampante: "HP LaserJet A4", pdf: pdf("lista").toString("base64") }, { pezzi: 7 });
  check(r && r.ok && argomenti()[3] === "fit" && argomenti()[1] === "HP LaserJet A4", `A4 → adattata al foglio («fit»), anche a pezzi di 7 byte (got ${JSON.stringify(r)} · ${argomenti().join(" ")})`);
}
for (const [cosa, domanda, re] of [
  ["non è un PDF", { t: "stampa", tipo: "a4", stampante: "HP LaserJet A4", pdf: Buffer.from("<html>login</html>").toString("base64") }, /non è un PDF/],
  ["una stampante che non c'è", { t: "stampa", tipo: "a4", stampante: "Stampante del vicino", pdf: pdf("x").toString("base64") }, /Stampante del vicino.*non c'è/],
  ["un tipo di foglio sconosciuto", { t: "stampa", tipo: "poster", stampante: "HP LaserJet A4", pdf: pdf("x").toString("base64") }, /tipo di foglio/],
  ["un base64 rotto", { t: "stampa", tipo: "a4", stampante: "HP LaserJet A4", pdf: "QUJD=====" }, /non è leggibile/],
  ["una domanda che non conosce", { t: "esegui", cmd: "calc.exe" }, /domanda sconosciuta/],
]) {
  togliArgomenti();
  const { r } = await chiedi(domanda);
  check(r && r.ok === false && re.test(r.why || "") && !argomenti().length, `${cosa}: rifiutato col motivo, SumatraPDF mai chiamato (got ${JSON.stringify(r)})`);
}
{
  togliArgomenti();
  const { r } = await chiedi({ t: "stampa", tipo: "etichette", stampante: "Zebra ZD421", pdf: pdf("x").toString("base64") }, { esce: 4 });
  check(r && r.ok === false && /la stampante non esiste/.test(r.why) && argomenti().length === 6 && temporanei().length === 0,
    `SumatraPDF che esce con 4 → «la stampante non esiste», e il temporaneo sparisce lo stesso (got ${JSON.stringify(r)})`);
}
{
  const h = Buffer.alloc(4); h.writeUInt32LE(0x7fffffff, 0);
  const { r } = await chiedi(h);
  check(r && r.ok === false && /lunghezza/.test(r.why), `una lunghezza impossibile → rifiutata, senza leggere oltre (got ${JSON.stringify(r)})`);
}
{
  const log = join(LOCALE, "PSAssist", "stampa.log");
  const testo = existsSync(log) ? readFileSync(log, "utf8") : "";
  check(/stampa etichette -> Zebra ZD421: ok/.test(testo) && /non riuscita - la stampante non esiste/.test(testo),
    `il registro dice cosa è uscito e dove, e cosa no (got ${testo.split("\n").length - 1} righe)`);
  check(!/PAZIENTE-FINTO|AAAA/.test(testo), "nel registro non c'è niente del contenuto");
}

// ---- installa.ps1: trova PS Assist nei profili di Chrome e di Edge -------
// Il registro di Windows qui non c'è: New-Item (solo le chiavi HKCU) e
// Read-Host sono finti, il resto è lo script così com'è. SumatraPDF.exe c'è
// già, quindi niente download.
console.log("\ninstallazione (installa.ps1)");
const INST = join(D, "inst"), PROFILI = join(D, "profili");
mkdirSync(INST);
copyFileSync(join(root, "stampa/installa.ps1"), join(INST, "installa.ps1"));
writeFileSync(join(INST, "SumatraPDF.exe"), "finto");
const cartella = (nome, manifest) => { const d = join(D, nome); mkdirSync(d); writeFileSync(join(d, "manifest.json"), manifest); return d; };
const ESTENSIONE = cartella("ps-app-extension", readFileSync(join(root, "extension/manifest.json"), "utf8"));
const ALTRA = cartella("altra-estensione", JSON.stringify({ name: "Altro", short_name: "Altro" }));
const ID1 = "abcdefghijklmnopabcdefghijklmnop", ID2 = "ponmlkjihgfedcbaponmlkjihgfedcba";
const preferenze = (dove, settings) => { mkdirSync(dirname(dove), { recursive: true }); writeFileSync(dove, JSON.stringify({ browser: { x: 1 }, extensions: { settings } })); };
preferenze(join(PROFILI, "Google/Chrome/User Data/Default/Secure Preferences"), {
  [ID1]: { path: ESTENSIONE, location: 4 },
  ghbmnnjooekpmoecnnnilnnbdlolhkhi: { path: "ghbmnnjooekpmoecnnnilnnbdlolhkhi\\1.2_0", location: 1 },
  cccccccccccccccccccccccccccccccc: { path: ALTRA, location: 4 },
});
preferenze(join(PROFILI, "Microsoft/Edge/User Data/Profile 1/Preferences"), { [ID2]: { path: ESTENSIONE, location: 4 } });
writeFileSync(join(D, "installa-prova.ps1"), `$global:chiavi = @()
function New-Item { param($Path, $Value, [switch]$Force) $global:chiavi += "$Path = $Value" }
function Read-Host { param($Prompt) $env:PSA_INCOLLA }
& (Join-Path '${INST}' 'installa.ps1')
$esce = $LASTEXITCODE
$global:chiavi | Set-Content (Join-Path '${INST}' 'chiavi.txt')
exit $esce
`);
const installa = (locale, incolla = "") => spawnSync(PWSH, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", join(D, "installa-prova.ps1")],
  { encoding: "utf8", env: { ...process.env, LOCALAPPDATA: locale, PSA_INCOLLA: incolla } });
{
  const r = installa(PROFILI);
  const man = existsSync(join(INST, "it.psassist.stampa.json")) ? JSON.parse(readFileSync(join(INST, "it.psassist.stampa.json"), "utf8")) : null;
  check(/Fatto\./.test(r.stdout) && /Trovata PS Assist/.test(r.stdout), `finisce con «Fatto» (got ${(r.stdout + r.stderr).trim().split("\n").slice(-2).join(" / ")})`);
  check(man && man.name === "it.psassist.stampa" && man.path === "host.cmd" && man.type === "stdio"
    && JSON.stringify(man.allowed_origins) === JSON.stringify([`chrome-extension://${ID1}/`, `chrome-extension://${ID2}/`]),
  `il manifest accanto: host.cmd, e solo PS Assist (Chrome e Edge), non le altre estensioni (got ${JSON.stringify(man)})`);
  const chiavi = readFileSync(join(INST, "chiavi.txt"), "utf8").trim().split("\n");
  const json = join(INST, "it.psassist.stampa.json");
  check(chiavi.length === 2 && chiavi[0] === `HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\it.psassist.stampa = ${json}`
    && chiavi[1] === `HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\it.psassist.stampa = ${json}`,
  `le due chiavi dell'utente (HKCU), per Chrome e per Edge, puntano al manifest (got ${chiavi.join(" | ")})`);
}
{
  rmSync(join(INST, "it.psassist.stampa.json"), { force: true });
  const vuoto = join(D, "nessun-profilo"); mkdirSync(vuoto);
  const r = installa(vuoto, `  ${ID2}  `);
  const man = existsSync(join(INST, "it.psassist.stampa.json")) ? JSON.parse(readFileSync(join(INST, "it.psassist.stampa.json"), "utf8")) : null;
  check(/Non trovo PS Assist/.test(r.stdout) && man && JSON.stringify(man.allowed_origins) === JSON.stringify([`chrome-extension://${ID2}/`]),
    `non trovata: chiede l'ID, e usa quello incollato (got ${JSON.stringify(man)})`);
  rmSync(join(INST, "it.psassist.stampa.json"), { force: true });
  const no = installa(vuoto, "non-un-id");
  check(no.status === 1 && /non è l'ID di un'estensione/.test(no.stdout) && !existsSync(join(INST, "it.psassist.stampa.json")),
    "un ID storto: si ferma col motivo, e non scrive niente");
}

rmSync(D, { recursive: true, force: true });
console.log(fail ? `\nSTAMPA-HOST: ${fail} CHECK FALLITI\n` : "\nSTAMPA-HOST: TUTTO OK\n");
process.exit(fail ? 1 : 0);
