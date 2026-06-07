/**
 * The machine-style measurements header — what a real ECG prints at the top, and
 * the core skill students must build: read HR · PR · QRS · QT/QTc · axis, each
 * against its normal range, and flag the abnormal one. Computed from the trace.
 */
import { Measurements } from '../engine/measure'
import './MachineReadout.css'

type Severity = 'normal' | 'warn' | 'crit'

interface Cell {
  label: string
  value: string
  unit: string
  flag: string
  severity: Severity
}

const rateCell = (hr: number): Cell => ({
  label: 'Rate', value: String(hr), unit: 'bpm',
  flag: hr < 60 ? 'bradycardia' : hr > 100 ? 'tachycardia' : 'normal',
  severity: hr < 60 || hr > 100 ? 'warn' : 'normal',
})

const prCell = (pr: number | null): Cell => {
  if (pr == null) return { label: 'PR', value: '—', unit: '', flag: 'no P wave', severity: 'warn' }
  return {
    label: 'PR', value: String(pr), unit: 'ms',
    flag: pr > 200 ? '1° AV block' : pr < 120 ? 'short' : 'normal',
    severity: pr > 200 ? 'warn' : pr < 120 ? 'warn' : 'normal',
  }
}

const qrsCell = (qrs: number): Cell => ({
  label: 'QRS', value: String(qrs), unit: 'ms',
  flag: qrs >= 120 ? 'wide' : qrs >= 110 ? 'borderline' : 'narrow',
  severity: qrs >= 120 ? 'crit' : qrs >= 110 ? 'warn' : 'normal',
})

const qtCell = (qt: number, qtc: number): Cell => ({
  label: 'QT / QTc', value: `${qt}/${qtc}`, unit: 'ms',
  flag: qtc > 470 ? 'prolonged' : qtc < 350 ? 'short' : 'normal',
  severity: qtc > 470 ? 'crit' : qtc < 350 ? 'warn' : 'normal',
})

const axisCell = (deg: number): Cell => {
  let flag = 'normal'
  let severity: Severity = 'normal'
  if (deg > 90 && deg <= 180) { flag = 'right axis'; severity = 'warn' }
  else if (deg < -30 && deg >= -90) { flag = 'left axis'; severity = 'warn' }
  else if (deg < -90 || deg > 180) { flag = 'extreme axis'; severity = 'crit' }
  return { label: 'Axis', value: deg > 0 ? `+${deg}` : String(deg), unit: '°', flag, severity }
}

export default function MachineReadout({ m }: { m: Measurements }) {
  const cells: Cell[] = [
    rateCell(m.rateBpm),
    prCell(m.prMs),
    qrsCell(m.qrsMs),
    qtCell(m.qtMs, m.qtcMs),
    axisCell(m.axisDeg),
  ]
  return (
    <div className="readout" role="group" aria-label="ECG measurements">
      {cells.map((c) => (
        <div key={c.label} className={`mr-cell mr-${c.severity}`}>
          <div className="mr-label">{c.label}</div>
          <div className="mr-value mono">
            {c.value}
            {c.unit && <span className="mr-unit">{c.unit}</span>}
          </div>
          <div className="mr-flag">{c.flag}</div>
        </div>
      ))}
    </div>
  )
}
