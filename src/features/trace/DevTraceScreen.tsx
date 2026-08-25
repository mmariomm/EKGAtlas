/** Dev harness: renders TraceView on a real asset (?asset=&leads=). Not linked from UI. */
import { useEffect, useState } from 'react'
import TraceView from './TraceView'
import { loadTrace, TraceData } from '../../lib/assets'
import { LeadId, ALL_LEADS } from '../../engine/leads'
import { useCardiacClock } from '../../lib/clock'

const parse = () => {
  const p = new URLSearchParams(window.location.search)
  const asset = p.get('asset') ?? 'ptbxl-330-afib'
  const raw = p.get('leads')
  let leads: LeadId[] = ['II']
  if (raw === '12') leads = ALL_LEADS
  else if (raw === '3') leads = ['II', 'V1', 'V5']
  else if (raw) leads = raw.split(',').filter((l): l is LeadId => (ALL_LEADS as string[]).includes(l))
  return { asset, leads }
}

export default function DevTraceScreen() {
  const [{ asset, leads }] = useState(parse)
  const [data, setData] = useState<TraceData | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { loadTrace(asset).then(setData).catch((e) => setErr(String(e))) }, [asset])
  const clock = useCardiacClock(data?.durationMs ?? 1000, { autoplay: true })

  if (err) return <div className="screen" style={{ paddingTop: 40 }}>{err}</div>
  if (!data) return <div className="screen" style={{ paddingTop: 40, color: 'var(--ink-3)' }}>loading…</div>
  return (
    <div className="screen" style={{ paddingTop: 16 }}>
      <TraceView
        data={data}
        leads={leads}
        clock={clock}
        onTap={clock.toggle}
        badge={<span style={{ fontSize: 11, color: 'var(--accent)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 8px', background: 'color-mix(in srgb, var(--bg) 75%, transparent)' }}>Recorded ECG · PTB-XL</span>}
      />
      <p style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 8 }}>{data.id} · {data.fs} Hz · {data.annotation.beats.length} beats</p>
    </div>
  )
}
