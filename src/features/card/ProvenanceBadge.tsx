/** The TRUTH LAW's face: every trace wears its tier, always visible. */
import { Provenance } from '../../content/schema'
import { getLang } from '../../lib/lang'
import './ProvenanceBadge.css'

const EN: Record<Provenance['tier'], (p: Provenance) => string> = {
  recorded: (p) => `Recorded ECG · ${p.sourceRecord?.split(' ')[0] ?? 'source'}`,
  derived: () => 'Recorded ECG · swap applied',
  reconstructed: () => 'Reconstruction of a published case',
  modeled: () => 'Modeled — teaching synthesis',
}
const IT: Record<Provenance['tier'], (p: Provenance) => string> = {
  recorded: (p) => `ECG reale · ${p.sourceRecord?.split(' ')[0] ?? 'fonte'}`,
  derived: () => 'ECG reale · scambio applicato',
  reconstructed: () => 'Ricostruzione di un caso pubblicato',
  modeled: () => 'Sintesi didattica — non un tracciato reale',
}

export default function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  return (
    <span className={`provbadge provbadge-${provenance.tier}`} title={provenance.sourceRecord ?? provenance.modelNote ?? ''}>
      {(getLang() === 'it' ? IT : EN)[provenance.tier](provenance)}
    </span>
  )
}
