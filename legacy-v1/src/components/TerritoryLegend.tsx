/**
 * Lead-territory key: which leads face which wall. Pairs with the colored lead
 * labels on the trace so students learn to localize (and read reciprocal change).
 */
import { TERRITORY_COLOR, TERRITORY_LABEL, WALL_TERRITORIES } from '../engine/leads'
import './TerritoryLegend.css'

export default function TerritoryLegend() {
  return (
    <div className="territory-legend" aria-label="Lead territories">
      <span className="tl-cap">Walls</span>
      {WALL_TERRITORIES.map((t) => (
        <span key={t} className="tl-item">
          <span className="tl-dot" style={{ background: TERRITORY_COLOR[t] }} />
          {TERRITORY_LABEL[t]}
        </span>
      ))}
    </div>
  )
}
