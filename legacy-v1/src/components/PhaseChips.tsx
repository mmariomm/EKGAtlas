/**
 * A row of segment chips (P · PR · QRS · ST · T), each in its phase colour.
 * Tapping one selects that phase (seeks + pauses the clock and highlights both
 * panels); tapping the active one clears. Makes click-to-explain discoverable.
 */
import { PhaseRegion, SegmentId } from '../engine/phases'
import { PHASE_COLORS } from '../theme'
import './PhaseChips.css'

interface Props {
  regions: PhaseRegion[]
  selected: SegmentId | null
  onSelect: (id: SegmentId) => void
  onClear: () => void
}

export default function PhaseChips({ regions, selected, onSelect, onClear }: Props) {
  return (
    <div className="phasechips" role="group" aria-label="Highlight a waveform segment">
      <span className="phasechips-cap">Explain</span>
      <div className="phasechips-row">
        {regions.map((r) => {
          const active = selected === r.id
          const c = PHASE_COLORS[r.tone]
          return (
            <button
              key={r.id}
              className={`pchip${active ? ' pchip-active' : ''}`}
              style={active ? { borderColor: c.core, color: c.core, background: c.glow } : { color: c.core }}
              onClick={() => (active ? onClear() : onSelect(r.id))}
              aria-pressed={active}
            >
              {r.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
