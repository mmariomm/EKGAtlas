# EKG Atlas

An interactive emergency-department EKG atlas. Pick a condition and watch **why**
its waveform looks the way it does: a schematic heart shows the impulse spreading
and the **cardiac vector** swinging, while the same vector — projected onto each
lead — draws the trace, frame-perfectly in sync.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
```

## The core idea: one vector → everything

A lead's deflection at any instant is the **dot product of the heart's dipole
vector with that lead's viewing axis**. That is the real physics of the ECG, and
it is the spine of this app:

- **One moving vector** drives all 12 leads *and* the arrow in the heart — so they
  can never disagree, and the sync is free.
- Abnormalities are just a **different vector path**: bundle branch blocks delay
  and redirect it, fascicular blocks rotate it (axis deviation), injury currents
  add a sustained ST vector.

### Anatomical frame (`src/engine/vectorMath.ts`)
`x = patient-left`, `y = inferior`, `z = anterior`. Frontal plane `(x,y)` = the
limb leads and the clinical axis; transverse plane `(x,z)` = the precordials.

### How a beat is modeled (`src/engine/types.ts`)
Each `Beat` carries two synchronized views of the same event:
1. `lobes` — Gaussian "pushes" of the dipole. Summed over time they **are** V(t);
   projected onto a lead they **are** that lead's waveform.
2. `events` — which conduction structures light up, and when (drives the heart glow).

`src/engine/synthesize.ts` turns a strip of beats into: per-lead signals
(`buildSignals`), the live vector (`sampleVector`), structure activation
(`sampleActivation`), the phase + cross-modal color (`samplePhase`), and the mean
QRS axis.

## Adding a condition

1. Create `src/conditions/<id>.ts` exporting a `Condition`. Reuse the building
   blocks in `helpers.ts` (`atrialLobes`, `normalQrsLobes`, `sinusBeat`, …) and
   override only the ventricular lobes/events that change.
2. To author morphology, think in vectors: *where does the wavefront point, and
   when?* e.g. RBBB = a large **late** lobe pointing right-anterior (toward V1).
3. Register it in `src/conditions/index.ts`.

That's it — all 12 leads, the heart animation, the axis, and the sync come for free.

## Shareable deep links
`?c=<conditionId>` and `?leads=12 | limb | II,V1,V5` set the initial view; the URL
stays in sync as you change condition/leads. Add `&t=0..1` to freeze the view at
that fraction of the loop (paused) — the heart still shows the vector loop, so it
is a shareable "moment".

## Design pillars
- **Shared playhead** — one clock; heart and trace read the same instant.
- **Cross-modal color** — atria=cyan, AV=amber, ventricle=gold, repol=violet, on
  both the heart and the trace.
- **Progressive disclosure** — default = 1 lead + plain narration; expand to 12,
  reveal the axis, slow to 0.1×, open the mechanism panel.

> Educational model — waveforms are synthesized for teaching, not clinical diagnosis.
