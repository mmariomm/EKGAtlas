/**
 * Sign a card after you have personally checked it in the app.
 *
 *   node tools/sign.mjs <cardId> "Your Name"     sign one card
 *   node tools/sign.mjs --all "Your Name"        sign every draft card
 *   node tools/sign.mjs --status                 list signed/draft state
 *
 * Signing is a statement of fact — run it only after actually reviewing the
 * card's Suspect & confirm + Guideline moves against the cited guidelines.
 * auditPassedAt records the M7 full-sweep audit date all 20 cards passed.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CARDS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/content/cards')
const AUDIT_PASSED = '2026-08'
const DRAFT = "review: { status: 'draft' },"

const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith('.ts'))
const idOf = (src) => src.match(/^\s*id:\s*'([^']+)'/m)?.[1]

const [a, b] = process.argv.slice(2)

if (a === '--status' || !a) {
  for (const f of files) {
    const src = readFileSync(resolve(CARDS_DIR, f), 'utf8')
    const signed = src.match(/status:\s*'signed',\s*reviewer:\s*'([^']+)',\s*signedAt:\s*'([^']+)'/)
    console.log(`${signed ? '✓ signed' : '· draft '}  ${idOf(src)}${signed ? `  (${signed[1]}, ${signed[2]})` : ''}`)
  }
  if (!a) console.log('\nUsage: node tools/sign.mjs <cardId>|--all "Your Name"')
  process.exit(0)
}

const reviewer = b
if (!reviewer) {
  console.error('Missing reviewer name. Usage: node tools/sign.mjs <cardId>|--all "Your Name"')
  process.exit(1)
}
const today = new Date().toISOString().slice(0, 10)
const signedBlock = `review: { status: 'signed', reviewer: '${reviewer.replace(/'/g, "\\'")}', signedAt: '${today}', auditPassedAt: '${AUDIT_PASSED}' },`

let touched = 0
for (const f of files) {
  const path = resolve(CARDS_DIR, f)
  const src = readFileSync(path, 'utf8')
  const id = idOf(src)
  if (a !== '--all' && id !== a) continue
  if (!src.includes(DRAFT)) {
    if (a !== '--all') console.log(`${id}: already signed (or unexpected review format) — no change`)
    continue
  }
  writeFileSync(path, src.replace(DRAFT, signedBlock))
  console.log(`✓ signed ${id} — ${reviewer}, ${today}`)
  touched++
}
if (!touched && a !== '--all') console.error(`No draft card with id '${a}'. Run --status to list ids.`)
