/**
 * Visual audit harness: serves the built app (dist/) and screenshots every
 * route at 390x844. Fails on any console error. Run `npm run build` first.
 * Usage: node test/shots.mjs [route ...]   (default: all registered routes)
 */
import { chromium } from 'playwright'
import { preview } from 'vite'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
if (!existsSync(resolve(ROOT, 'dist/index.html'))) {
  console.error('dist/ missing — run `npm run build` first')
  process.exit(1)
}
const OUT = resolve(ROOT, 'shots')
mkdirSync(OUT, { recursive: true })

/** route path -> shot name; extended as milestones land. */
export const ROUTES = {
  '/': 'home',
  '/about': 'about',
}

const only = process.argv.slice(2)
const routes = only.length ? only.map((r) => [r, r.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home']) : Object.entries(ROUTES)

const server = await preview({ root: ROOT, preview: { port: 4310, strictPort: true } })
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }))
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()}`) })
page.on('pageerror', (e) => errors.push(String(e)))

for (const [route, name] of routes) {
  await page.goto(`http://localhost:4310${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
  console.log(`shot ${route} -> shots/${name}.png`)
}

await browser.close()
await server.close()
if (errors.length) {
  console.error('\nCONSOLE ERRORS:\n' + errors.join('\n'))
  process.exit(1)
}
console.log('all shots clean')
