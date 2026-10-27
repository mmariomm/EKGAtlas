/*
 * Il finto aiutante di stampa, per le prove dell'estensione: Chromium lo avvia
 * per ogni domanda (native messaging), come farebbe con host.cmd su Windows.
 * Stesso filo (4 byte + JSON), stesse tre domande, stessi controlli e stessi
 * esiti del vero (stampato, mandato, fallito, sconosciuto); invece di stampare
 * annota il lavoro in <PSA_FINTO>/lavori.jsonl. Come si comporta lo dice
 * <PSA_FINTO>/config.json: { stampanti, predefinita, rompi: { "<stampante>":
 * "<motivo>" }, esito: { "<stampante>": "mandato" | "sconosciuto" }, lento: ms }.
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
  if (m.t === "ping") return rispondi({ ok: true, versione: "2" });
  if (m.t === "stampanti") return rispondi({ ok: true, stampanti: cfg.stampanti, predefinita: cfg.predefinita });
  if (m.t !== "stampa") return rispondi({ ok: false, esito: "fallito", why: "domanda sconosciuta" });
  const pdf = Buffer.from(String(m.pdf || ""), "base64");
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return rispondi({ ok: false, esito: "fallito", why: "non è un PDF" });
  if (!cfg.stampanti.includes(m.stampante)) return rispondi({ ok: false, esito: "fallito", why: `la stampante «${m.stampante}» non c'è su questo PC` });
  const box = /\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/.exec(pdf.toString("latin1"));
  const pagina = box ? [Math.round(box[3] - box[1]), Math.round(box[4] - box[2])] : null;
  if (cfg.lento) await new Promise((r) => setTimeout(r, cfg.lento));
  const rotta = (cfg.rompi || {})[m.stampante];
  const esito = rotta ? "fallito" : (cfg.esito || {})[m.stampante] || "stampato";
  appendFileSync(join(DIR, "lavori.jsonl"), JSON.stringify({ ts: Date.now(), tipo: m.tipo, stampante: m.stampante, ruota: m.ruota, byte: pdf.length, pagina, esito, ok: esito === "stampato" || esito === "mandato" }) + "\n");
  if (rotta) return rispondi({ ok: false, esito, why: rotta });
  if (esito === "sconosciuto") return rispondi({ ok: false, esito, why: "SumatraPDF non ha finito in 30 secondi: il foglio può essere uscito lo stesso" });
  rispondi({ ok: true, esito, stampante: m.stampante, pagina });
});
