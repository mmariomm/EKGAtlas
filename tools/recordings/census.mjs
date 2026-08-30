/**
 * Quiz-bank census: how many PTB-XL records are eligible per catalog class.
 * Run: node tools/recordings/census.mjs (needs raw/ptbxl_database.csv fetched).
 * NOTE: likelihood 0 in scp_codes means 'present, confidence unstated' — for
 * rhythm classes eligibility must be validated_by_human + a measurement gate
 * (the engine's assertions), never the likelihood field alone.
 */
import { loadDatabase } from './lib.mjs'
import { readFileSync } from 'node:fs'

const db = loadDatabase()
console.log('total records:', db.length)
const validated = db.filter(r => r.validated_by_human === 'True')
console.log('cardiologist-validated:', validated.length)

// SCP statements present, with counts
const scpDesc = {}
for (const line of readFileSync(new URL('./raw/scp_statements.csv', import.meta.url),'utf8').split('\n').slice(1)) {
  const [code, desc] = line.split(',')
  if (code) scpDesc[code] = desc
}

// Map SCP → our card taxonomy (rhythm/morphology classes the catalog teaches)
const MAP = {
  nsr: ['NORM'], afib: ['AFIB'], aflutter: ['AFLT'],
  'avb2': ['2AVB'], 'avb3': ['3AVB'],
  lbbb: ['CLBBB'], rbbb: ['CRBBB'], wpw: ['WPW'],
  'svt': ['PSVT','SVTAC'], 'paced': ['PACE'],
  'lvh': ['LVH'], 'longqt': ['LNGQT'],
  'mi-anterior(old+acute)': ['AMI','ASMI','ALMI'], 'mi-inferior(old+acute)': ['IMI','ILMI','IPMI','IPLMI'],
  'acute-injury-ant': ['INJAS','INJAL'], 'acute-injury-inf': ['INJIN','INJIL'],
  'ischemic-st-t': ['ISC_','ISCAL','ISCAS','ISCAN','ISCIN','ISCIL','ISCLA','STD_'],
  'electrolyte': ['EL'], 'brugada-ish': ['BRADY? none'],
}
const rows = []
for (const [ours, codes] of Object.entries(MAP)) {
  let any = 0, val100 = 0, dominant = 0
  for (const r of db) {
    const hit = codes.filter(c => c in r.scp)
    if (!hit.length) continue
    any++
    const maxLik = Math.max(...Object.values(r.scp))
    const hitLik = Math.max(...hit.map(c => r.scp[c]))
    if (r.validated_by_human === 'True' && hitLik === 100) val100++
    if (r.validated_by_human === 'True' && hitLik >= 80 && hitLik >= maxLik) dominant++
  }
  rows.push([ours, any, val100, dominant])
}
console.log('\nclass                        any    validated+100%   validated+dominant≥80')
for (const [n,a,v,d] of rows) console.log(n.padEnd(28), String(a).padStart(5), String(v).padStart(12), String(d).padStart(16))

// what codes exist that we might not know about
const counts = {}
for (const r of db) for (const c in r.scp) counts[c] = (counts[c]||0)+1
const interesting = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,40)
console.log('\ntop-40 SCP codes overall:'); console.log(interesting.map(([c,n])=>`${c}:${n}`).join(' '))
