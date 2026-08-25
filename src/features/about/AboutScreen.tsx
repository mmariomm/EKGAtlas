/** The fidelity contract — how the atlas earns trust, in learner-readable lines. */
import { GUIDELINES } from '../../content/guidelines'
import { linkClick } from '../../router'
import './AboutScreen.css'

export default function AboutScreen() {
  return (
    <div className="screen about">
      <header className="about-head">
        <a href="/" onClick={linkClick('/')} className="about-back" aria-label="Back to library">‹</a>
        <h1>How we validate</h1>
      </header>

      <p className="about-thesis">
        The ECG is a shadow; everyone is taught to memorize shadows. This app makes
        the object casting them visible — and manipulable. That only works if every
        pixel is honest. Here is the contract.
      </p>

      <section className="about-sec">
        <h2>Every trace declares what it is</h2>
        <ul className="about-tiers">
          <li><b className="t-rec">Recorded</b> — a real human 12-lead, untouched. Source record and license always shown.</li>
          <li><b className="t-der">Derived</b> — exact algebra applied to a real recording (cable swaps recomputed from leads I and II). The transform is named.</li>
          <li><b className="t-rey">Reconstructed</b> — our model rendering a published case's documented findings, citing the case.</li>
          <li><b className="t-mod">Modeled</b> — our teaching synthesis, validated against published criteria, and labeled as exactly that.</li>
        </ul>
        <p>A modeled trace is never presented as real. The badge never leaves the screen.</p>
      </section>

      <section className="about-sec">
        <h2>The pipeline behind every card</h2>
        <ul>
          <li>Real recordings come from <b>PTB-XL</b> (PhysioNet), used under CC BY 4.0 — Wagner et&nbsp;al., <i>Scientific Data</i> 2020. Each file is parsed against its own embedded checksums.</li>
          <li>Every card carries <b>machine-checked assertions</b> — encoded diagnostic criteria that run against both the model and the shipped recording on every release. A card that fails does not ship.</li>
          <li>Every clinical line carries a <b>citation</b> (registry below) and the card carries a guideline-verification date. Stale citations block release.</li>
          <li>Every therapy section carries a <b>review stamp</b>: the guideline-verification date, plus either the named clinician who signed it or an explicit "not yet clinician-signed" — never silent draft medicine.</li>
          <li>Rendered screens are audited visually before release, and an adversarial review (criteria auditor · hostile attending · learner-comprehension · consistency) runs on every card.</li>
        </ul>
      </section>

      <section className="about-sec">
        <h2>What the model honestly is — and is not</h2>
        <p>
          The mechanism view is a teaching model: point dipoles in a uniform torso,
          a small conduction graph, walls as regions. It derives all 12 leads from
          electrode positions — which is why you can drag electrodes and the trace
          obeys real physics. It does <b>not</b> simulate reentry circuits, ionic
          channels, torso boundary effects, or beat-to-beat variability; the two
          leg electrodes share one electrical site (real legs are near-equipotential
          — a boundary effect a uniform medium cannot produce). Repolarization uses
          a simplified recovery model. Where the model reaches its limits, the card
          leans on real recordings instead.
        </p>
      </section>

      <section className="about-sec">
        <h2>Guideline registry</h2>
        <div className="about-tablewrap">
          <table className="about-table">
            <thead><tr><th>Source</th><th>Year</th><th>Verified</th></tr></thead>
            <tbody>
              {GUIDELINES.map((g) => (
                <tr key={g.citeKey}>
                  <td>{g.title}</td>
                  <td className="num">{g.year}</td>
                  <td className="num">{g.verifiedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="about-sec">
        <h2>Found an error?</h2>
        <p>
          Report it — card name, what's wrong, your source:{' '}
          <a href="https://github.com/mmariomm/EKGAtlas/issues" target="_blank" rel="noreferrer">open an issue</a>.
          Confirmed clinical errors are corrected or the card is pulled within 72 hours;
          fixes credit the reporter.
        </p>
      </section>

      <p className="about-disclaimer">
        EKG Atlas is education about electrocardiography and current guidelines —
        dated, sourced, versioned. It is not a diagnostic device, it never interprets
        a patient's ECG, and it is never a substitute for clinical judgment or your
        local protocol.
      </p>
    </div>
  )
}
