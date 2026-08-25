# Conduction Study — design rationale

## Concept (two sentences)
A Netter-grade five-chamber cutaway rendered as cool graphite ink on glass, floating above a
phosphor layer where the only saturated thing on screen is the electricity itself — a crisp
transmural front with a luminous wake traveling THROUGH the muscle, fine wires that carry light,
and a slender vector needle inscribing its fading loop like a watch complication. Ink explains
the anatomy; light explains the physiology; nothing blinks — every luminance change is either a
traveling front or a breathing envelope.

## Anatomy construction
- One source of truth: each wall is an authored Catmull-Rom centerline + thickness profile,
  resampled by arc length into a ribbon (endo edge / epi edge / 2-3 transmural sublayers).
  The same ribbon data generates the SVG ink contours, the base-plate fills, and the canvas
  light geometry — so line, fill and glow can never drift apart.
- Orientation: standard anatomical presentation (patient faces viewer): RA/RV viewer-left,
  LA/LV viewer-right, apex down-and-viewer-right. The brief's vector contract (0° = patient's
  left = viewer right, +90° = down) pins this: the mean QRS axis must point at the apex, so the
  apex sits where +40..60° points. We resolved the brief's one conflicting orientation note in
  favor of its own vector spec and of every printed atlas.
- Credibility details, all at ghost weight: SVC entering RA; aortic root wedged between the
  atria with ascending arch (the "five-chamber" section, so no outflow fakery); pulmonary vein
  stubs; tricuspid + mitral leaflets with chordae and papillary nubs; moderator band carrying
  the RBB across the RV; LBB fascicles fanning on the septal LV face with Purkinje twigs.
  LV free wall drawn ~2.5x RV thickness; septum bows into the RV.

## Motion language
- Depolarization = a bright slanted band crossing the wall, endocardial edge leading epicardial
  (the slant IS the endo→epi story), with an exponential hot wake settling to a dim plateau (ST).
- His-Purkinje light is fast, thin, white-cored — a racing drop with a comet tail. Cell-to-cell
  spread (ectopy, blocked territories) is wide, soft-edged, core-less, and slow: viscous.
- The AV pause is staged stillness: the node's amber glow swells while its radius tightens
  (contained pressure), a slow crawl of light inches through the capsule, then snaps down the His.
- Repolarization is a wash, not a sweep: broad gaussian band, epicardium leading, ember-grade
  flicker, violet, half tempo — a different material, not a recolor.
- The septum lights as a long line sliding across its thickness (L→R normally, direction inferred
  from the fed progress so a reversed LBBB sweep just works); free walls as marching bands.
- Vector needle: tapered shaft, slender chevron, counterweight tail, hub ring — watch-hand
  grammar. It carries the current phase color and leaves a 600 ms comet-loop (the VCG).
- Rendering: one canvas (base plate + light, two-pass bloom via an offscreen light plate) under
  one SVG (ink + labels). All motion is a pure function of the state fed to update(); the demo
  driver proves it with a frame-exact scrubber. Reduced motion: starts paused mid-QRS.

## Graceful behavior
- Structure never fed / unknown id / missing fields → stays at rest; no state is ever stuck.
- Blocked wires: drawn with a physical gap + break ticks, dashed dim distal stump; arriving
  light pools at the stump and dies there. Blocked territories auto-inherit the viscous texture.
- level>0 with no coherent progress (NaN/undefined) → disorganized shimmer (fibrillation);
  silent atria are simply never fed. kind 'injury' marks a wall span with hatch + smolder.

## Rejected
- Whole-chamber opacity pulses and CSS keyframes — the cheap look the brief bans, and unscrubable.
- 3D/isometric heart — costs anatomy-reading clarity at 390 px; the cutaway is the teaching view.
- Outlined-glow-only walls (neon sign look) — the muscle itself must carry the light.
- Pulmonary trunk in-plane — it lies anterior to a true coronal cut and cluttered the RA roof.
- Per-segment additive quads for wakes — seam artifacts; replaced by an offscreen light plate
  composited once (source-over within, 'lighter' onto the plate) with a two-pass bloom.
