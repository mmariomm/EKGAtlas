#!/usr/bin/env node
/*
 * Le icone PNG dell'app del telefono, disegnate da Chromium a partire dalla
 * croce di PS Assist (niente binari fatti a mano): public/ponte/icona-{180,192,512}.png.
 * Il quadrato è pieno — gli angoli li arrotonda l'iPhone.
 *   node ponte/icone.mjs
 */
import { chromium } from "playwright";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOVE = join(dirname(fileURLToPath(import.meta.url)), "../../public/ponte");
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find((p) => existsSync(p) && statSync(p).isFile());
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || exe });
for (const n of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:#0B5CAD"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${n}" height="${n}" style="display:block">
    <rect width="64" height="64" fill="#0B5CAD"/><path d="M32 17v30M17 32h30" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg></body></html>`);
  await page.screenshot({ path: join(DOVE, `icona-${n}.png`), omitBackground: false });
  await page.close();
}
await browser.close();
console.log("icone scritte in public/ponte/");
