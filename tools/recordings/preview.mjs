/**
 * Contact sheet for visual curation: renders each converted asset's leads
 * (II, V1, V5 by default) as polylines with fiducial overlays (P onset cyan,
 * QRS on/off gold, T end violet), screenshots to preview/<id>.png.
 * Usage: node preview.mjs [assetId ...]   (default: everything in manifest)
 */
import { chromium } from 'playwright'
import { mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { OUT, readJson } from './lib.mjs'

const PREVIEW = resolve(import.meta.dirname, 'preview')
mkdirSync(PREVIEW, { recursive: true })

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(OUT).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))

const LEADS = (process.env.LEADS || 'II,V1,V5').split(',')
const W = 1200
const LANE = 150

const svgFor = (asset) => {
  const px = (t) => (t / asset.durationMs) * W
  let out = ''
  LEADS.forEach((lead, li) => {
    const y0 = li * LANE + LANE / 2
    const raw = asset.leads[lead]
    const pts = []
    const step = Math.max(1, Math.floor(raw.length / (W * 2)))
    for (let i = 0; i < raw.length; i += step) {
      const x = (i / raw.length) * W
      const y = y0 - (raw[i] / asset.unitsPerMv) * 55
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    out += `<text x="4" y="${li * LANE + 16}" fill="#9aa7b8" font-size="13">${lead}</text>`
    out += `<polyline points="${pts.join(' ')}" fill="none" stroke="#dfe7f0" stroke-width="1.1"/>`
  })
  const H = LEADS.length * LANE
  for (const b of asset.annotation.beats) {
    const mark = (t, color, w = 1) =>
      t == null ? '' : `<line x1="${px(t)}" x2="${px(t)}" y1="0" y2="${H}" stroke="${color}" stroke-width="${w}" opacity="0.75"/>`
    out += mark(b.pOn, '#4dc3e6')
    out += mark(b.qrsOn, '#ffd166', 1.4)
    out += mark(b.qrsOff, '#e8b34b')
    out += mark(b.tEnd, '#a78bfa')
  }
  return `<svg width="${W}" height="${LEADS.length * LANE}" style="background:#0d1219">${out}</svg>`
}

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }))
const page = await browser.newPage({ viewport: { width: W, height: LEADS.length * LANE + 40 } })

for (const id of ids) {
  const asset = readJson(resolve(OUT, `${id}.json`))
  await page.setContent(
    `<body style="margin:0;background:#0d1219;color:#e8edf4;font-family:monospace">
     <div style="padding:4px 8px;font-size:14px">${asset.id} · ${asset.annotation.beats.length} beats · ${asset.provenance.sourceRecord}</div>
     ${svgFor(asset)}</body>`,
  )
  await page.screenshot({ path: resolve(PREVIEW, `${id}.png`) })
  console.log(`preview/${id}.png`)
}
await browser.close()
