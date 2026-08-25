/**
 * Generate PWA icons by screenshotting an SVG glyph page with the preinstalled
 * Chromium. Run once; PNGs are committed at public/icons/.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, '../../public/icons')
mkdirSync(OUT, { recursive: true })

// pad: fraction of the tile the glyph is inset by (maskable needs a safe zone).
const tile = (size, bg, pad) => `<!doctype html><html><body style="margin:0">
  <div style="width:${size}px;height:${size}px;background:${bg};
              display:flex;align-items:center;justify-content:center">
    <svg viewBox="0 0 40 24" style="width:${Math.round(size * (1 - 2 * pad))}px" fill="none">
      <path d="M1 12 H10 L13 5 L17 19 L21 9 L24 14 H39"
            stroke="#35d0a5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div></body></html>`

const launch = async () => {
  try { return await chromium.launch() }
  catch { return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }) }
}

const browser = await launch()
const pg = await browser.newPage()

const shoot = async (name, size, bg, pad) => {
  await pg.setViewportSize({ width: size, height: size })
  await pg.setContent(tile(size, bg, pad))
  await pg.screenshot({ path: `${OUT}/${name}` })
}

await shoot('icon-512.png', 512, '#070a0f', 0.14)
await shoot('icon-192.png', 192, '#070a0f', 0.14)
await shoot('maskable-512.png', 512, '#0d1219', 0.26)
await shoot('apple-touch-icon.png', 180, '#070a0f', 0.18)

await browser.close()
console.log('icons written to', OUT)
