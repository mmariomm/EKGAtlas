#!/usr/bin/env node
/*
 * `npm test`: tutta la suite, una prova alla volta.
 *
 * - Prima rifà la build: le prove nel browser caricano extension/, e senza la
 *   build proverebbero il codice di prima.
 * - Dà a Chromium le opzioni di sempre (PSA_CHROMIUM_ARGS, se non è già data).
 * - Una prova rossa non ferma le altre: alla fine una tabella, con i tempi.
 * - Esce con 1 se una prova è fallita. «Saltato» (uscita 77: manca qualcosa
 *   per farla, per esempio PowerShell) non conta come passata, e lo dice.
 *
 *   node tools/prove.mjs                 tutte
 *   node tools/prove.mjs ponte registro  solo quelle il cui nome contiene una delle parole
 *   node tools/prove.mjs --log DIR       l'uscita di ogni prova in DIR/<nome>.log, a schermo solo l'esito
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const PROVE = [
  "tools/verifica-esempi.mjs",
  "test/valori.mjs", "test/pdftesto.mjs", "test/registra-anonimo.mjs", "test/registra-siss.mjs",
  "test/storico.mjs", "test/editor.mjs", "test/ponte-cripto.mjs", "test/ponte-sicurezza.mjs",
  "test/presa.mjs", "test/run.mjs", "test/aree.mjs", "test/tabellone.mjs",
  "test/ext-referti.mjs", "test/ext-storico.mjs", "test/ext-ordine.mjs", "test/ext-sessione.mjs",
  "test/ext-nascosta.mjs", "test/ext-ponte.mjs", "test/ext-registro.mjs", "test/ext-sicurezza.mjs",
  "test/ext-fuori.mjs", "test/ext-mini.mjs", "test/ext-tabellone-pagina.mjs", "test/ext-ovunque.mjs",
  "test/ext-registra.mjs", "test/ext-registra-siss.mjs", "test/ext-registra-eviewer.mjs",
  "test/ext-registrazioni.mjs", "test/ext-ricetta-siss.mjs", "test/ext-terapia.mjs",
  "test/ext-accetta.mjs", "test/ext-area-tel.mjs", "test/stampa-host.mjs", "test/ext-stampa.mjs",
  "test/ext-stazione.mjs", "test/ext-aggiorna.mjs",
];
export const SALTATO = 77;   // l'uscita di una prova che non si è potuta fare
const ORE = 45 * 60e3;       // una prova ferma più di così è rossa

const nome = (f) => f.replace(/^.*\//, "").replace(/\.mjs$/, "");

function argomenti(argv) {
  const out = { log: null, parole: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--log") out.log = argv[++i];
    else out.parole.push(argv[i].toLowerCase());
  }
  return out;
}

function una(file, logDir) {
  return new Promise((fine) => {
    const t0 = Date.now();
    const figlio = spawn(process.execPath, [file], { cwd: root, env: process.env, stdio: ["ignore", logDir ? "pipe" : "inherit", logDir ? "pipe" : "inherit"] });
    if (logDir) {
      const f = createWriteStream(join(logDir, nome(file) + ".log"));
      figlio.stdout.pipe(f, { end: false });
      figlio.stderr.pipe(f, { end: false });
      figlio.on("close", () => f.end());
    }
    let scaduto = false;
    const timer = setTimeout(() => { scaduto = true; figlio.kill("SIGKILL"); }, ORE);
    figlio.on("close", (code, segnale) => {
      clearTimeout(timer);
      const s = (Date.now() - t0) / 1000;
      const esito = code === 0 ? "ok" : code === SALTATO ? "saltato" : "ko";
      fine({ file, esito, s, nota: scaduto ? "tempo scaduto" : segnale ? `segnale ${segnale}` : code && code !== SALTATO ? `uscita ${code}` : "" });
    });
  });
}

export function tabella(righe) {
  const larga = Math.max(...righe.map((r) => nome(r.file).length), 5);
  const minuti = (s) => s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s.toFixed(1)}s`;
  const segno = { ok: "ok     ", ko: "KO     ", saltato: "SALTATO" };
  const out = [`${"prova".padEnd(larga)}  esito    tempo`];
  for (const r of righe) out.push(`${nome(r.file).padEnd(larga)}  ${segno[r.esito]}  ${minuti(r.s).padStart(6)}${r.nota ? "  " + r.nota : ""}`);
  const conta = (e) => righe.filter((r) => r.esito === e).length;
  const tot = righe.reduce((a, r) => a + r.s, 0);
  out.push("", `${conta("ok")} ok · ${conta("ko")} KO · ${conta("saltato")} saltate · ${minuti(tot)} in tutto`);
  if (conta("ko")) out.push(`ROSSO: ${righe.filter((r) => r.esito === "ko").map((r) => nome(r.file)).join(", ")}`);
  else if (conta("saltato")) out.push(`NESSUNA ROSSA, MA NON TUTTO PROVATO: ${righe.filter((r) => r.esito === "saltato").map((r) => nome(r.file)).join(", ")}`);
  else out.push("TUTTO OK");
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { log, parole } = argomenti(process.argv.slice(2));
  const scelte = PROVE.filter((f) => !parole.length || parole.some((p) => nome(f).includes(p)));
  if (!scelte.length) { console.error(`Nessuna prova per: ${parole.join(" ")}`); process.exit(2); }
  if (log) mkdirSync(log, { recursive: true });
  process.env.PSA_CHROMIUM_ARGS ??= "--disable-features=PdfOopif --disable-dev-shm-usage";

  console.log("== build");
  if (spawnSync(process.execPath, ["tools/build.mjs"], { cwd: root, stdio: "inherit" }).status !== 0) {
    console.error("\nLa build non è riuscita: nessuna prova.");
    process.exit(1);
  }
  const righe = [];
  for (const f of scelte) {
    console.log(`\n== ${nome(f)}`);
    const r = await una(f, log);
    righe.push(r);
    if (log) console.log(`   ${r.esito} (${r.s.toFixed(1)}s)${r.nota ? " " + r.nota : ""}`);
  }
  console.log("\n" + tabella(righe));
  process.exit(righe.some((r) => r.esito === "ko") ? 1 : 0);
}
