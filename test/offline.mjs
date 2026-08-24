import { chromium } from 'playwright'
import { preview } from 'vite'
const server = await preview({ root: process.cwd(), preview: { port: 4319, strictPort: true } })
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }))
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
// first visit: let the service worker precache everything
await page.goto('http://localhost:4319/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
// go offline and walk
await ctx.setOffline(true)
for (const r of ['/c/lbbb', '/c/hyperk', '/lab/electrodes', '/lab/hyperk', '/p/night-shift', '/about']) {
  await page.goto('http://localhost:4319' + r, { waitUntil: 'load' }).catch((e) => errs.push(r + ': ' + e))
  await page.waitForTimeout(700)
  const text = await page.evaluate(() => document.body.innerText.slice(0, 80))
  console.log('offline', r, '->', text.replace(/\n/g, ' ').slice(0, 60))
}
await browser.close(); await server.close()
if (errs.length) { console.error('OFFLINE ERRORS:\n' + errs.join('\n')); process.exit(1) }
console.log('offline walkthrough clean')
