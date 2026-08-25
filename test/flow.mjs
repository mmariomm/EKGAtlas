/**
 * Interactive shot walker: performs a scripted sequence of taps/scrolls and
 * screenshots at 390x844. Fails on page errors.
 * Usage: node test/flow.mjs <route> <name> [tap:<text>|scroll:<y>|wait:<ms>]...
 */
import { chromium } from 'playwright'
import { preview } from 'vite'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'shots')
mkdirSync(OUT, { recursive: true })

const [route, name, ...steps] = process.argv.slice(2)
if (!route || !name) {
  console.error('usage: flow.mjs <route> <name> [tap:<text>|scroll:<y>|wait:<ms>|shot:<suffix>]...')
  process.exit(1)
}

const server = await preview({ root: ROOT, preview: { port: 4312, strictPort: true } })
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }))
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })

await page.goto(`http://localhost:4312${route}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

let shot = 0
for (const step of steps) {
  const [op, ...rest] = step.split(':')
  const arg = rest.join(':')
  if (op === 'tap') await page.getByText(arg, { exact: false }).first().click()
  else if (op === 'scroll') await page.evaluate((y) => window.scrollTo(0, Number(y)), arg)
  else if (op === 'wait') await page.waitForTimeout(Number(arg))
  else if (op === 'shot') {
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${OUT}/${name}-${arg || String(shot++)}.png` })
    console.log(`shot ${name}-${arg || shot - 1}.png`)
  }
}
await page.waitForTimeout(350)
await page.screenshot({ path: `${OUT}/${name}-final.png` })
console.log(`shot ${name}-final.png`)

await browser.close()
await server.close()
if (errs.length) {
  console.error('ERRORS:\n' + errs.join('\n'))
  process.exit(1)
}
console.log('flow clean')
