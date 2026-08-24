/**
 * The ED bottom line — what the tracing MEANS and what to DO. The "so what"
 * students need next to the mechanism: a prominent, scannable action line.
 */
import './ClinicalNote.css'

export default function ClinicalNote({ text }: { text: string }) {
  return (
    <div className="clinical" role="note">
      <span className="clinical-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M3 12h4l2-5 3 10 2-7 2 2h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="clinical-body">
        <div className="clinical-label">Clinical bottom line</div>
        <div className="clinical-text">{text}</div>
      </div>
    </div>
  )
}
