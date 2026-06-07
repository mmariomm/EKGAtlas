/**
 * The systematic read — the habit every good ECG reader builds: go in order,
 * rate → rhythm → axis → intervals → morphology → ischemia, and state each
 * finding. Rate/axis/intervals come straight from the measurements; rhythm/
 * morphology/ischemia are the condition's read.
 */
import { Measurements } from '../engine/measure'
import './SystematicRead.css'

interface Props {
  m: Measurements
  read?: { rhythm: string; morphology: string; ischemia: string }
}

const rateFlag = (hr: number) => (hr < 60 ? 'bradycardia' : hr > 100 ? 'tachycardia' : 'normal')

const axisFlag = (deg: number) => {
  if (deg >= -30 && deg <= 90) return 'normal'
  if (deg > 90 && deg <= 180) return 'right'
  if (deg < -30 && deg >= -90) return 'left'
  return 'extreme'
}

export default function SystematicRead({ m, read }: Props) {
  const steps = [
    { n: 1, label: 'Rate', value: `${m.rateBpm} bpm`, sub: rateFlag(m.rateBpm), hint: 'Bedside: 300 ÷ big boxes between beats (300·150·100·75·60·50)' },
    { n: 2, label: 'Rhythm', value: read?.rhythm ?? '—', sub: '', hint: '' },
    { n: 3, label: 'Axis', value: `${m.axisDeg > 0 ? '+' : ''}${m.axisDeg}°`, sub: axisFlag(m.axisDeg), hint: 'Quick check: I and aVF both upright → normal axis' },
    { n: 4, label: 'Intervals', value: `PR ${m.prMs ?? '—'} · QRS ${m.qrsMs} · QTc ${m.qtcMs} ms`, sub: '', hint: 'Normal: PR 120–200 · QRS <120 · QTc <440–460' },
    { n: 5, label: 'Morphology', value: read?.morphology ?? '—', sub: '', hint: '' },
    { n: 6, label: 'Ischemia', value: read?.ischemia ?? '—', sub: '', hint: '' },
  ]
  return (
    <div className="sysread">
      <div className="sysread-head">Read it in order</div>
      <ol className="sysread-list">
        {steps.map((s) => (
          <li key={s.n} className="sysread-step">
            <span className="sysread-num">{s.n}</span>
            <div className="sysread-body">
              <span className="sysread-label">{s.label}</span>
              <span className="sysread-value">
                {s.value}
                {s.sub && <span className="sysread-sub"> · {s.sub}</span>}
              </span>
              {s.hint && <span className="sysread-hint">{s.hint}</span>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
