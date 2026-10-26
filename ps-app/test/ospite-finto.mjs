/*
 * Il finto aiutante di stampa, per le prove dell'estensione: Chromium lo avvia
 * per ogni domanda (native messaging), come farebbe con host.cmd su Windows.
 * Stesso filo (4 byte + JSON), stesse tre domande, stessi controlli del vero;
 * invece di stampare annota il lavoro in <PSA_FINTO>/lavori.jsonl. Come si
 * comporta lo dice <PSA_FINTO>/config.json: { stampanti, predefinita,
 * rompi: { "<stampante>": "<motivo>" }, lento: ms }.
 */
import { readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.env.PSA_FINTO;
const parti = [];
const rispondi = (obj) => {
  const b = Buffer.from(JSON.stringify(obj), "utf8");
  const h = Buffer.alloc(4); h.writeUInt32LE(b.length, 0);
  process.stdout.write(Buffer.concat([h, b]), () => process.exit(0));
};
process.stdin.on("data", async (d) => {
  parti.push(d);
  const b = Buffer.concat(parti);
  if (b.length < 4 || b.length < 4 + b.readUInt32LE(0)) return;
  process.stdin.pause();
  const m = JSON.parse(b.subarray(4, 4 + b.readUInt32LE(0)).toString("utf8"));
  const cfg = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8"));
  if (m.t === "ping") return rispondi({ ok: true, versione: "1" });
  if (m.t === "stampanti") return rispondi({ ok: true, stampanti: cfg.stampanti, predefinita: cfg.predefinita });
  if (m.t !== "stampa") return rispondi({ ok: false, why: "domanda sconosciuta" });
  const pdf = Buffer.from(String(m.pdf || ""), "base64");
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return rispondi({ ok: false, why: "non è un PDF" });
  if (!cfg.stampanti.includes(m.stampante)) return rispondi({ ok: false, why: `la stampante «${m.stampante}» non c'è su questo PC` });
  if (cfg.lento) await new Promise((r) => setTimeout(r, cfg.lento));
  const rotta = (cfg.rompi || {})[m.stampante];
  appendFileSync(join(DIR, "lavori.jsonl"), JSON.stringify({ ts: Date.now(), tipo: m.tipo, stampante: m.stampante, byte: pdf.length, ok: !rotta }) + "\n");
  rispondi(rotta ? { ok: false, why: rotta } : { ok: true, stampante: m.stampante });
});
