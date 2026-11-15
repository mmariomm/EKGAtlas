#!/usr/bin/env node
/*
 * `npm run test:nodo`: le prove senza browser di test/nodo/, una dopo l'altra
 * (ogni file .mjs tranne questo e chrome-finto.mjs). Secondi, non minuti.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const qui = dirname(fileURLToPath(import.meta.url));
const prove = readdirSync(qui).filter((f) => f.endsWith(".mjs") && !["tutte.mjs", "chrome-finto.mjs"].includes(f)).sort();
let rotte = 0;
for (const f of prove) {
  const r = spawnSync(process.execPath, [join(qui, f)], { stdio: "inherit", timeout: 60e3 });
  if (r.status !== 0) { rotte++; console.log(`✗ ${f}: uscita ${r.status ?? r.signal}`); }
}
console.log(`\ntest/nodo: ${prove.length - rotte}/${prove.length} prove verdi`);
process.exit(rotte ? 1 : 0);
