import { linkClick } from '../../router'
import './LibraryScreen.css'

export default function LibraryScreen() {
  return (
    <div className="screen">
      <header className="lib-head">
        <div className="brand" aria-hidden>
          <svg viewBox="0 0 40 24" width="34" height="20">
            <path d="M1 12 H10 L13 5 L17 19 L21 9 L24 14 H39" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="brand-name">EKG&nbsp;Atlas</span>
        </div>
        <a href="/about" onClick={linkClick('/about')} className="lib-about">About</a>
      </header>
      <p className="lib-thesis">
        The ECG is a shadow; everyone is taught to memorize shadows. This app makes
        the object casting them visible — and manipulable.
      </p>
      <p className="lib-placeholder">Library arrives at M3.</p>
    </div>
  )
}
