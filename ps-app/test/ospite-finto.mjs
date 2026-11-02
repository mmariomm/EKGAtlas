/*
 * Il finto aiutante di stampa, per le prove dell'estensione: Chromium lo avvia
 * per ogni domanda (native messaging), come farebbe con host.cmd su Windows.
 * Stesso filo (4 byte + JSON), stesse domande, stessi controlli e stessi
 * esiti del vero (stampato, mandato, fallito, sconosciuto); invece di stampare
 * annota il lavoro in <PSA_FINTO>/lavori.jsonl. Come si comporta lo dice
 * <PSA_FINTO>/config.json: { stampanti, predefinita, rompi: { "<stampante>":
 * "<motivo>" }, esito: { "<stampante>": "mandato" | "sconosciuto" }, lento: ms,
 * casa: "<la cartella che fa da %LOCALAPPDATA%\PSAssist>", aggiornaNo: "<motivo>" }.
 * «chi» e «aggiorna» (⋯ → «Aggiorna app») fanno quello che fa host.ps1, con
 * gli stessi controlli, nella cartella `casa`: lo zip aperto in una cartella
 * temporanea psassist-*, extension/manifest.json con la stessa chiave e una
 * versione più nuova, `estensione` → `estensione.prima` (una copia sola), la
 * nuova al suo posto con `installata.json`, i file di `stampa` rinnovati, la
 * cartella temporanea tolta anche quando qualcosa va storto.
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, renameSync, cpSync, copyFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const DIR = process.env.PSA_FINTO;
const parti = [];
const rispondi = (obj) => {
  const b = Buffer.from(JSON.stringify(obj), "utf8");
  const h = Buffer.alloc(4); h.writeUInt32LE(b.length, 0);
  process.stdout.write(Buffer.concat([h, b]), () => process.exit(0));
};
const annota = (o) => appendFileSync(join(DIR, "lavori.jsonl"), JSON.stringify({ ts: Date.now(), ...o }) + "\n");

// uno zip, tutto in una cartella (solo «salvato» e deflate, come zip -r)
function estrai(buf, dove) {
  let fine = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { fine = i; break; }
  if (fine < 0) throw new Error("non è uno zip");
  let p = buf.readUInt32LE(fine + 16);
  for (let k = buf.readUInt16LE(fine + 10); k > 0; k--) {
    const metodo = buf.readUInt16LE(p + 10), dim = buf.readUInt32LE(p + 20), ln = buf.readUInt16LE(p + 28);
    const loc = buf.readUInt32LE(p + 42), nome = buf.subarray(p + 46, p + 46 + ln).toString("utf8");
    p += 46 + ln + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (nome.includes("..") || nome.startsWith("/")) throw new Error("zip con un percorso fuori posto");
    const f = join(dove, nome);
    if (nome.endsWith("/")) { mkdirSync(f, { recursive: true }); continue; }
    const dati = buf.subarray(loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28)).subarray(0, dim);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, metodo === 8 ? inflateRawSync(dati) : dati);
  }
}
const ver = (v) => String(v || "0").split(".").map(Number);
const piuNuova = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 4; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; } return false; };
const manifest = (d) => JSON.parse(readFileSync(join(d, "manifest.json"), "utf8"));

function aggiorna(m, cfg) {
  const casa = cfg.casa, est = join(casa, "estensione"), prima = join(casa, "estensione.prima");
  if (!existsSync(join(est, "manifest.json"))) throw new Error(`l'estensione non è installata in ${est}: rilancia installa.cmd`);
  if (cfg.aggiornaNo) throw new Error(cfg.aggiornaNo);
  const tmp = mkdtempSync(join(tmpdir(), "psassist-agg-"));
  try {
    const zip = Buffer.from(String(m.zip || ""), "base64");
    if (zip.length < 4 || zip.readUInt32LE(0) !== 0x04034b50) throw new Error("non è uno zip");
    estrai(zip, tmp);
    const nuova = join(tmp, "extension");
    if (!existsSync(join(nuova, "manifest.json"))) throw new Error("nello zip manca extension/manifest.json");
    const n = manifest(nuova), ora = manifest(est);
    if (n.key !== ora.key) throw new Error("lo zip non è di PS Assist (la chiave è diversa)");
    if (String(n.version) !== String(m.versione)) throw new Error(`lo zip è la ${n.version}, non la ${m.versione}`);
    if (!piuNuova(n.version, ora.version)) throw new Error(`la ${n.version} non è più nuova della ${ora.version}`);
    rmSync(prima, { recursive: true, force: true });
    renameSync(est, prima);
    try {
      cpSync(nuova, est, { recursive: true });
      copyFileSync(join(prima, "installata.json"), join(est, "installata.json"));
    } catch (e) { rmSync(est, { recursive: true, force: true }); renameSync(prima, est); throw e; }
    const stampa = join(casa, "stampa");
    mkdirSync(stampa, { recursive: true });
    for (const f of ["host.ps1", "installa.ps1", "disinstalla.cmd", "ripristina.cmd"]) if (existsSync(join(tmp, "stampa", f))) copyFileSync(join(tmp, "stampa", f), join(stampa, f));
    return n.version;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

process.stdin.on("data", async (d) => {
  parti.push(d);
  const b = Buffer.concat(parti);
  if (b.length < 4 || b.length < 4 + b.readUInt32LE(0)) return;
  process.stdin.pause();
  const m = JSON.parse(b.subarray(4, 4 + b.readUInt32LE(0)).toString("utf8"));
  const cfg = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8"));
  if (m.t === "ping") return rispondi({ ok: true, versione: "3" });
  if (m.t === "stampanti") return rispondi({ ok: true, stampanti: cfg.stampanti, predefinita: cfg.predefinita });
  if (m.t === "chi") {
    const est = cfg.casa ? join(cfg.casa, "estensione") : "";
    let estensione = "";
    try { estensione = String(manifest(est).version || ""); } catch { /* non installata */ }
    annota({ chi: true, ...(m.avviata ? { avviata: String(m.avviata) } : {}) });
    return rispondi({ ok: true, versione: "3", estensione, cartella: est });
  }
  if (m.t === "aggiorna") {
    if (cfg.lento) await new Promise((r) => setTimeout(r, cfg.lento));
    try {
      const versione = aggiorna(m, cfg);
      annota({ aggiorna: true, versione, byte: Math.round(String(m.zip || "").length * 3 / 4), ok: true });
      return rispondi({ ok: true, versione });
    } catch (e) {
      annota({ aggiorna: true, ok: false, why: String(e.message || e) });
      return rispondi({ ok: false, why: String(e.message || e) });
    }
  }
  if (m.t !== "stampa") return rispondi({ ok: false, esito: "fallito", why: "domanda sconosciuta" });
  const pdf = Buffer.from(String(m.pdf || ""), "base64");
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return rispondi({ ok: false, esito: "fallito", why: "non è un PDF" });
  if (!cfg.stampanti.includes(m.stampante)) return rispondi({ ok: false, esito: "fallito", why: `la stampante «${m.stampante}» non c'è su questo PC` });
  const box = /\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/.exec(pdf.toString("latin1"));
  const pagina = box ? [Math.round(box[3] - box[1]), Math.round(box[4] - box[2])] : null;
  if (cfg.lento) await new Promise((r) => setTimeout(r, cfg.lento));
  const rotta = (cfg.rompi || {})[m.stampante];
  const esito = rotta ? "fallito" : (cfg.esito || {})[m.stampante] || "stampato";
  annota({ tipo: m.tipo, stampante: m.stampante, ruota: m.ruota, byte: pdf.length, pagina, esito, ok: esito === "stampato" || esito === "mandato" });
  if (rotta) return rispondi({ ok: false, esito, why: rotta });
  if (esito === "sconosciuto") return rispondi({ ok: false, esito, why: "SumatraPDF non ha finito in 30 secondi: il foglio può essere uscito lo stesso" });
  rispondi({ ok: true, esito, stampante: m.stampante, pagina });
});
