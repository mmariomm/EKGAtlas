# Recordings pipeline

PhysioNet PTB-XL (CC BY 4.0) → curated, annotated, verified TraceAssets in
`public/recordings/`. All Node (the WFDB format-16 reader is ~40 lines and is
proven against each header's per-signal checksum — a stronger check than a
library round-trip; documented deviation from the plan's Python/wfdb).

Order: `shortlist.mjs <cardId> [--fetch N]` (spec-driven candidates) →
`convert.mjs <cardId> <ecgId>` (asset + auto-annotation + verify) →
`preview.mjs` (fiducial-overlay contact sheets for the visual curation pass)
→ record the pick + reason in `picks.json`.

Annotation is automatic (envelope delineation) with an independent-parameter
re-detection in `verify.mjs` and a mandatory visual audit of the overlay
sheets; a card spec may set `"annotate": {"suppressP": true}` (AF/flutter).
Raw downloads live in `raw/` (gitignored); `manifest.json` maps every asset
to its source record so anything can be regenerated.
