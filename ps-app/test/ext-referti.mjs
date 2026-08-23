#!/usr/bin/env node
/*
 * Extension-only check: the service worker really fetches and stores referto
 * PDFs, and a saved referto opens from this machine (blob:) instead of the
 * server. Runs the UNPACKED extension in a persistent context.
 *   node test/ext-referti.mjs
 */
import { chromium } from "playwright";
import { createMock } from "./sa4pso-mock.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PROFILE = join("/tmp", "psa-ext-" + process.pid);
let failures = 0;
const check = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) failures++; };

const mock = createMock({});
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const route = async (r) => {
  const req = r.request();
  let out = mock.handle({ method: req.method(), url: req.url(), bodyBuffer: req.postDataBuffer() });
  let h = 0;
  while (out.status === 302 && h++ < 5) out = mock.handle({ method: "GET", url: new URL(out.headers.location, req.url()).href });
  await r.fulfill({ status: out.status, headers: out.headers, body: out.body });
};
await ctx.route("https://smarthealth.multimedica.it/**", route);

const page = await ctx.newPage();
await page.goto(mock.patientUrl);
await page.waitForSelector("#psassist-host", { state: "attached", timeout: 15000 });

const saveBtn = page.locator("#psassist-host #refsave");
check(await saveBtn.count() === 1, "il bottone «Salva tutti» compare solo nell'estensione");
await saveBtn.click();
await page.waitForFunction(
  () => document.getElementById("psassist-host").shadowRoot.querySelectorAll(".rdot.saved").length === 3,
  { timeout: 30000 },
).catch(() => {});
const saved = await page.locator("#psassist-host .rdot.saved").count();
check(saved === 3, `3 referti salvati dal service worker (got ${saved})`);

const before = mock.state.requests.filter((q) => q.url.includes("Sa4ViewerExtRedirect")).length;
const [popup] = await Promise.all([
  page.waitForEvent("popup", { timeout: 10000 }),
  page.locator("#psassist-host .rrow").first().click(),
]);
check(popup.url().startsWith("blob:"), `il referto salvato si apre da locale (got ${popup.url().slice(0, 22)}…)`);
check(mock.state.requests.filter((q) => q.url.includes("Sa4ViewerExtRedirect")).length === before,
  "nessuna richiesta al server all'apertura di un referto salvato");

await page.locator("#psassist-host #refreset").click();
await page.waitForTimeout(1200);
check(await page.locator("#psassist-host .rdot.saved").count() === 0, "Resetta svuota i salvataggi");

await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILURE(S)` : "\nEXTENSION CHECKS PASSED");
process.exit(failures ? 1 : 0);
