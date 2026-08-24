/** The TRUTH LAW's face: every trace wears its tier, always visible. */
import { Provenance } from '../../content/schema'
import './ProvenanceBadge.css'

const LABEL: Record<Provenance['tier'], (p: Provenance) => string> = {
  recorded: (p) => `Recorded ECG · ${p.sourceRecord?.split(' ')[0] ?? 'source'}`,
  derived: () => 'Recorded ECG · swap applied',
  reconstructed: () => 'Reconstruction of a published case',
  modeled: () => 'Modeled — teaching synthesis',
}

export default function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  return (
    <span className={`provbadge provbadge-${provenance.tier}`} title={provenance.sourceRecord ?? provenance.modelNote ?? ''}>
      {LABEL[provenance.tier](provenance)}
    </span>
  )
}
