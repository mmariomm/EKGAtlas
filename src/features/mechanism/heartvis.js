/**
 * HeartVis — the conduction visual, designed by an isolated "fresh eyes"
 * agent against the HeartVis contract (see heartVisState.ts and
 * docs/heart-v2/). Extracted verbatim from the delivered prototype; the demo
 * driver was left behind — the app drives update() from the shared clock.
 * Side-effect module: importing it defines window.HeartVis.
 */
/* eslint-disable */
// @ts-nocheck
/* ============================================================================
   HeartVis — the conduction visualization component.
   window.HeartVis.mount(el, opts) -> { update(state), setStatic(cfg), destroy() }

   Architecture: "ink over light".
   - one <canvas>: a cached base plate (anatomy fills, vignette, vector dial)
     plus a per-frame light plate (all electrical activity), composited with a
     two-pass bloom. Light lives UNDER the ink.
   - one <svg>: all linework — contours, valves, vessels, the conduction
     wiring, lesion marks, labels. Ink stays crisp above the glow.
   All motion is a pure function of the state passed to update(); the only
   internal memory is the vector trail (a bounded history of fed states),
   sweep direction inference for the septum, and sticky injury marking.
============================================================================ */
(() => {
'use strict';

const W = 390, H = 440;                       // design space (aspect 1.128)
const WDX = -20;                              // world shift: centers the figure optically
const TAU = Math.PI * 2, RAD = Math.PI / 180;

/* ---------------- small utilities ---------------- */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const clamp01 = v => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mixRGB = (c1, c2, t) => [
  Math.round(lerp(c1[0], c2[0], t)),
  Math.round(lerp(c1[1], c2[1], t)),
  Math.round(lerp(c1[2], c2[2], t))];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const WHITE = [255, 255, 255];

const TONES = {
  sa: '#67e8ff', atria: '#38bdf8', av: '#f5b942', ventricle: '#ffc24b',
  repol: '#b794ff', injury: '#ff5d6c', rest: '#46536b'
};
const TONE_RGB = {}, TONE_CORE = {};
for (const k in TONES) { TONE_RGB[k] = hexRGB(TONES[k]); TONE_CORE[k] = mixRGB(TONE_RGB[k], WHITE, 0.62); }
const toneRGB = k => TONE_RGB[k] || TONE_RGB.rest;
const toneCore = k => TONE_CORE[k] || TONE_CORE.rest;

const PHASE_WORDS = {
  sa: 'SA node fires', atria: 'Atrial depolarization', av: 'AV node · holding',
  ventricle: 'Ventricular depolarization', repol: 'Repolarization',
  injury: 'Injury current', rest: 'Diastole'
};

const hash1 = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (seed, x) => {           // smooth value noise along x
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash1(seed * 57.7 + i), hash1(seed * 57.7 + i + 1), u);
};

/* ---------------- spline geometry ---------------- */
function crSample(ctrl, per = 16) {           // open catmull-rom
  const p = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out = [];
  for (let i = 0; i < p.length - 3; i++) {
    const [p0, p1, p2, p3] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  out.push([...ctrl[ctrl.length - 1]]);
  return out;
}
function cumLen(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));
  return c;
}
function resample(pts, N) {
  const c = cumLen(pts), total = c[c.length - 1], out = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const d = total * i / (N - 1);
    while (j < c.length - 2 && c[j + 1] < d) j++;
    const seg = c[j + 1] - c[j] || 1;
    const t = (d - c[j]) / seg;
    out.push([lerp(pts[j][0], pts[j + 1][0], t), lerp(pts[j][1], pts[j + 1][1], t)]);
  }
  return out;
}
function normalsOf(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    out.push([-dy / l, dx / l]);
  }
  for (let pass = 0; pass < 2; pass++)                 // smooth
    for (let i = 1; i < n - 1; i++) {
      const x = (out[i - 1][0] + out[i][0] * 2 + out[i + 1][0]) / 4;
      const y = (out[i - 1][1] + out[i][1] * 2 + out[i + 1][1]) / 4;
      const l = Math.hypot(x, y) || 1; out[i] = [x / l, y / l];
    }
  return out;
}
const thAt = (profile, s) => {
  if (s <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++)
    if (s <= profile[i][0]) {
      const [s0, t0] = profile[i - 1], [s1, t1] = profile[i];
      return lerp(t0, t1, (s - s0) / (s1 - s0 || 1));
    }
  return profile[profile.length - 1][1];
};
/* ribbon: A = endocardial / LV-face edge, B = epicardial / RV-face edge */
function buildRibbon(ctrl, thProfile, N, flip) {
  const cl = resample(crSample(ctrl), N);
  const nm = normalsOf(cl);
  const A = [], B = [];
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1), h = thAt(thProfile, s) / 2;
    A.push([cl[i][0] - flip * nm[i][0] * h, cl[i][1] - flip * nm[i][1] * h]);
    B.push([cl[i][0] + flip * nm[i][0] * h, cl[i][1] + flip * nm[i][1] * h]);
  }
  return { cl, A, B, N };
}
const edgeAt = (E, s) => {                    // continuous sample of an edge
  const x = clamp01(s) * (E.length - 1), i = Math.min(E.length - 2, Math.floor(x)), t = x - i;
  return [lerp(E[i][0], E[i + 1][0], t), lerp(E[i][1], E[i + 1][1], t)];
};
const rAt = (rb, s, f) => {                   // point at (length s, thickness f) — f: 0=A, 1=B
  const a = edgeAt(rb.A, s), b = edgeAt(rb.B, s);
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
};
function wirePath(polys) {                    // {segs:[{pts,cum,len,s0,s1}]}
  const segs = polys.map(g => {
    const pts = resample(crSample(g.pts, 10), Math.max(8, Math.round(g.pts.length * 6)));
    const cum = cumLen(pts);
    return { pts, cum, len: cum[cum.length - 1], s0: g.s0, s1: g.s1 };
  });
  return { segs };
}
function wireSlice(wire, sa, sb) {            // list of point-runs covering [sa,sb]
  const out = [];
  for (const seg of wire.segs) {
    const lo = Math.max(sa, seg.s0), hi = Math.min(sb, seg.s1);
    if (hi <= lo) continue;
    const fa = (lo - seg.s0) / (seg.s1 - seg.s0), fb = (hi - seg.s0) / (seg.s1 - seg.s0);
    const da = fa * seg.len, db = fb * seg.len, run = [];
    let j = 0;
    const at = d => {
      while (j < seg.cum.length - 2 && seg.cum[j + 1] < d) j++;
      const t = (d - seg.cum[j]) / (seg.cum[j + 1] - seg.cum[j] || 1);
      return [lerp(seg.pts[j][0], seg.pts[j + 1][0], t), lerp(seg.pts[j][1], seg.pts[j + 1][1], t)];
    };
    run.push(at(da));
    for (let i = 0; i < seg.pts.length; i++) if (seg.cum[i] > da && seg.cum[i] < db) run.push(seg.pts[i]);
    run.push(at(db));
    out.push(run);
  }
  return out;
}
const wireTip = (wire, s) => {
  for (const seg of wire.segs) if (s >= seg.s0 && s <= seg.s1) {
    const d = (s - seg.s0) / (seg.s1 - seg.s0) * seg.len;
    let j = 0; while (j < seg.cum.length - 2 && seg.cum[j + 1] < d) j++;
    const t = (d - seg.cum[j]) / (seg.cum[j + 1] - seg.cum[j] || 1);
    return [lerp(seg.pts[j][0], seg.pts[j + 1][0], t), lerp(seg.pts[j][1], seg.pts[j + 1][1], t)];
  }
  const last = wire.segs[wire.segs.length - 1];
  return last.pts[last.pts.length - 1];
};

/* ---------------- the anatomy ---------------- */
function buildGeometry() {
  const walls = {
    RA: buildRibbon(
      [[180,112],[152,102],[126,106],[110,124],[106,148],[112,172],[128,188],[150,196],[170,196],[180,192]],
      [[0,8],[0.5,9],[1,8]], 46, +1),
    LA: buildRibbon(
      [[214,102],[244,92],[274,98],[294,116],[298,140],[290,162],[268,176],[246,180]],
      [[0,8],[0.5,9],[1,8.5]], 42, -1),
    SEPTUM: buildRibbon(
      [[216,202],[228,240],[244,278],[259,314],[271,342],[281,357]],
      [[0,26],[0.5,25],[1,16]], 40, +1),
    RV: buildRibbon(
      [[258,370],[228,364],[192,350],[156,324],[128,290],[112,250],[106,212]],
      [[0,9],[0.3,12.5],[0.75,12.5],[1,10]], 52, -1),
    LV: buildRibbon(
      [[280,366],[308,340],[326,301],[332,256],[326,214],[314,190]],
      [[0,16],[0.25,28],[0.6,30],[1,21]], 56, +1),
  };
  // transmural strips (endo -> epi). A edge is endo for RA/LA/RV/LV.
  walls.RA.strips = [{lo:0,hi:0.5},{lo:0.5,hi:1}];
  walls.LA.strips = [{lo:0,hi:0.5},{lo:0.5,hi:1}];
  walls.RV.strips = [{lo:0,hi:0.5},{lo:0.5,hi:1}];
  walls.LV.strips = [{lo:0,hi:0.34},{lo:0.34,hi:0.67},{lo:0.67,hi:1}];
  walls.RA.origin = 0.08;                       // SA node position along the RA ribbon

  const wires = {
    HIS: wirePath([{ pts: [[200,192],[205,199],[210,205]], s0: 0, s1: 1 }]),
    RBB: wirePath([
      { pts: [[210,205],[216,232],[228,264],[242,296],[249,310]], s0: 0, s1: 0.6 },
      { pts: [[249,310],[222,320],[196,326],[174,322]], s0: 0.6, s1: 1 },   // via moderator band
      { pts: [[249,310],[258,332],[264,346]], s0: 0.6, s1: 1 },             // to apex
    ]),
    LBB: wirePath([{ pts: [[210,205],[214,218],[218,230]], s0: 0, s1: 1 }]),
    LAF: wirePath([{ pts: [[218,230],[230,240],[242,246],[253,250]], s0: 0, s1: 1 }]),
    LPF: wirePath([{ pts: [[218,230],[228,258],[242,288],[256,316],[266,332]], s0: 0, s1: 1 }]),
  };
  const lesionAt = { RBB: 0.32, LBB: 0.5, LAF: 0.3, LPF: 0.28 };

  const nodes = {
    SA: { p: [152,103], rx: 6, ry: 2.7, rot: -12 },
    AV: { p: [198,188], rx: 5, ry: 3.1, rot: 24 },
  };
  const purkinje = [                             // ignition sites -> parent wire
    { p: [264,346], w: 'RBB' }, { p: [174,322], w: 'RBB' },
    { p: [253,250], w: 'LAF' }, { p: [266,332], w: 'LPF' },
    { p: [278,358], w: 'LPF' }, { p: [234,258], w: 'LBB' },
  ];
  const vessels = {
    aorta: buildRibbon([[206,164],[202,128],[210,96],[226,70],[250,60],[272,68],[282,84]],
      [[0,20],[1,17]], 36, +1),
    svc: buildRibbon([[124,34],[121,62],[119,90]], [[0,15],[1,15]], 12, +1),
    pv1: buildRibbon([[298,130],[320,122],[336,116]], [[0,11],[1,11]], 8, +1),
    pv3: buildRibbon([[300,158],[320,156],[334,152]], [[0,10],[1,10]], 8, +1),
  };
  const dial = { c: [242,272], r: 84, scale: 53 };  // vector origin + magnitude scale

  const glows = {                                // cavity glow anchors
    RA: { p: [142,150], r: 38 }, LA: { p: [254,138], r: 34 },
    RV: { p: [176,296], r: 54 }, LV: { p: [288,282], r: 42 },
    SEPTUM: { p: [248,282], r: 36 },
  };
  return { walls, wires, lesionAt, nodes, purkinje, vessels, dial, glows };
}

/* ---------------- SVG helpers ---------------- */
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs, parent) {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const P = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
const Pc = pts => P(pts) + 'Z';

/* ============================================================================
   Mount
============================================================================ */
function mount(el, opts = {}) {
  const G = buildGeometry();
  const root = document.createElement('div');
  root.style.cssText = 'position:relative;width:100%;aspect-ratio:390/440;overflow:hidden;background:#0d1219;';
  el.appendChild(root);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, style: 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;' });
  root.appendChild(svg);

  const base = document.createElement('canvas');   // cached anatomy plate
  const plate = document.createElement('canvas');  // per-frame light plate
  const bctx = base.getContext('2d');
  const pctx = plate.getContext('2d');

  const inst = {
    blocked: new Set(),
    dirSEPT: 1, lastSEPTp: null,
    trail: [], lastT: null,
    injury: {},                                     // wall id -> {extent, amt}
    sprites: {}, k: 1, dpr: 1,
    lastState: null,
    phase: { tone: 'rest', alpha: 0 },
  };

  /* ---------- sprites ---------- */
  function sprite(key, rgb) {
    if (inst.sprites[key]) return inst.sprites[key];
    const s = document.createElement('canvas'); s.width = s.height = 128;
    const c = s.getContext('2d');
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, rgba(mixRGB(rgb, WHITE, 0.55), 0.9));
    g.addColorStop(0.22, rgba(rgb, 0.5));
    g.addColorStop(0.55, rgba(rgb, 0.13));
    g.addColorStop(1, rgba(rgb, 0));
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    inst.sprites[key] = s; return s;
  }
  const blit = (c, sp, x, y, r, a) => {
    if (a <= 0.003) return;
    c.globalAlpha = clamp01(a); c.drawImage(sp, x - r, y - r, r * 2, r * 2); c.globalAlpha = 1;
  };

  /* ---------- base plate ---------- */
  function paintBase() {
    const { walls, vessels, dial } = G;
    const c = bctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, base.width, base.height);
    c.setTransform(inst.k, 0, 0, inst.k, 0, 0);
    c.fillStyle = '#0d1219'; c.fillRect(0, 0, W, H);

    // soft seat behind the heart, then vignette
    let g = c.createRadialGradient(205 + WDX, 225, 20, 205 + WDX, 225, 210);
    g.addColorStop(0, 'rgba(122,150,196,0.055)'); g.addColorStop(1, 'rgba(122,150,196,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    g = c.createRadialGradient(W * 0.47, H * 0.44, H * 0.34, W * 0.47, H * 0.44, H * 0.78);
    g.addColorStop(0, 'rgba(2,5,9,0)'); g.addColorStop(1, 'rgba(2,5,9,0.55)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.translate(WDX, 0);                       // anatomy lives in world space

    // vector dial (instrument furniture, under everything anatomical)
    c.strokeStyle = 'rgba(70,83,107,0.20)'; c.lineWidth = 1;
    c.beginPath(); c.arc(dial.c[0], dial.c[1], dial.r, 0, TAU); c.stroke();
    c.strokeStyle = 'rgba(70,83,107,0.34)';
    for (let a = 0; a < 360; a += 30) {
      const r1 = dial.r - (a % 90 === 0 ? 5 : 3), r2 = dial.r;
      c.beginPath();
      c.moveTo(dial.c[0] + Math.cos(a * RAD) * r1, dial.c[1] + Math.sin(a * RAD) * r1);
      c.lineTo(dial.c[0] + Math.cos(a * RAD) * r2, dial.c[1] + Math.sin(a * RAD) * r2);
      c.stroke();
    }
    c.fillStyle = 'rgba(104,120,148,0.62)';
    c.font = '600 7px -apple-system,system-ui,sans-serif';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('0°', dial.c[0] + dial.r + 5, dial.c[1]);
    c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText('+90°', dial.c[0], dial.c[1] + dial.r + 4);

    // great vessels (fills only; their ink lives in the SVG)
    const tube = (rb, col) => { c.fillStyle = col; c.beginPath(); pathPoly(c, rb.A.concat([...rb.B].reverse())); c.fill(); };
    tube(vessels.aorta, 'rgba(19,26,38,0.9)');
    tube(vessels.svc, 'rgba(19,26,38,0.85)');
    tube(vessels.pv1, 'rgba(19,26,38,0.8)');
    tube(vessels.pv3, 'rgba(19,26,38,0.8)');
    // arch branch stubs
    c.strokeStyle = 'rgba(23,31,44,0.9)'; c.lineWidth = 5; c.lineCap = 'round';
    [[[224,62],[220,44]],[[242,56],[242,38]],[[262,60],[266,44]]].forEach(s => {
      c.beginPath(); c.moveTo(...s[0]); c.lineTo(...s[1]); c.stroke();
    });

    // chamber cavities (the blood pool is the darkest thing on screen)
    c.fillStyle = '#0a0e15';
    for (const poly of cavityPolys()) { c.beginPath(); pathPoly(c, poly); c.fill(); }

    // interatrial septum
    c.fillStyle = '#1d2530';
    c.beginPath(); pathPoly(c, [[188,114],[198,112],[197,182],[189,186]]); c.fill();

    // walls
    for (const id of ['SEPTUM', 'RV', 'LV', 'RA', 'LA']) {
      const w = walls[id];
      c.fillStyle = '#1e2634';
      c.beginPath(); pathPoly(c, w.A.concat([...w.B].reverse())); c.fill();
      // endocardial half a touch lighter -> walls read as having thickness
      const mid = w.A.map((p, i) => [lerp(p[0], w.B[i][0], 0.48), lerp(p[1], w.B[i][1], 0.48)]);
      c.fillStyle = id === 'SEPTUM' ? '#28323f' : '#2a3444';
      c.beginPath(); pathPoly(c, w.A.concat([...mid].reverse())); c.fill();
    }

    // depth: darken cavity rim just inside each endocardial edge
    c.lineJoin = 'round'; c.lineCap = 'round';
    const rim = (E, sign) => {
      const off = E.map((p, i) => {
        const q = E[Math.min(E.length - 1, i + 1)], a = E[Math.max(0, i - 1)];
        const dx = q[0] - a[0], dy = q[1] - a[1], l = Math.hypot(dx, dy) || 1;
        return [p[0] + sign * (-dy / l) * 1.6, p[1] + sign * (dx / l) * 1.6];
      });
      c.beginPath(); pathPoly(c, off, true);
      c.strokeStyle = 'rgba(0,0,0,0.34)'; c.lineWidth = 2.6; c.stroke();
    };
    rim(walls.RV.A, -1); rim(walls.LV.A, -1); rim(walls.RA.A, -1); rim(walls.LA.A, +1);
    rim(walls.SEPTUM.A, -1); rim(walls.SEPTUM.B, +1);
  }
  function pathPoly(c, pts, open) {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (!open) c.closePath();
  }
  function cavityPolys() {
    const { RA, LA, RV, LV, SEPTUM } = G.walls;
    return [
      RA.A.concat([[190,184],[190,116]]),
      LA.A.concat([[202,178],[202,112]]),
      RV.A.concat([[194,203]], SEPTUM.B),                    // A: apex->base, B: base->apex
      [...SEPTUM.A].concat(LV.A, [[316,193],[242,190]]),     // A: base->apex, LV.A: apex->base
    ];
  }

  /* ---------- SVG ink ---------- */
  const ink = {};
  function buildInk() {
    svg.innerHTML = '';
    const { walls, vessels, nodes, dial } = G;
    const gMain = svgEl('g', { transform: `translate(${WDX} 0)` }, svg);   // world space
    const gUI = svgEl('g', {}, svg);                                       // screen space

    const stroke = (d, col, w, o = 1, extra = {}) =>
      svgEl('path', Object.assign({ d, fill: 'none', stroke: col, 'stroke-width': w, opacity: o, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, extra), gMain);

    // vessels ink
    const tubeInk = rb => { stroke(P(rb.A), '#334054', 1, 0.85); stroke(P(rb.B), '#334054', 1, 0.85); };
    tubeInk(vessels.aorta); tubeInk(vessels.svc); tubeInk(vessels.pv1); tubeInk(vessels.pv3);
    stroke('M197 156 Q207 168 217 156', '#334054', 0.7, 0.8);                    // aortic cusps hint
    stroke('M212 196 L204 168 M234 190 L222 166', '#33405a', 0.7, 0.8);          // LVOT continuity

    // ventricular silhouette: RV epi (base->apex) + apex bridge + LV epi (apex->base)
    const sil = [...G.walls.RV.B].reverse().concat([[271,379]], G.walls.LV.B);
    stroke(P(sil), '#5d6c86', 1.25);
    // atria
    stroke(P(walls.RA.B), '#56647e', 0.95);
    stroke(P(walls.RA.A), '#43506a', 0.7, 0.9);
    stroke(P(walls.LA.B), '#56647e', 0.95);
    stroke(P(walls.LA.A), '#43506a', 0.7, 0.9);
    // ventricular endo + septum faces
    stroke(P(walls.RV.A), '#45526a', 0.75, 0.95);
    stroke(P(walls.LV.A), '#45526a', 0.75, 0.95);
    stroke(P(walls.SEPTUM.A), '#45526a', 0.8, 0.95);
    stroke(P(walls.SEPTUM.B), '#45526a', 0.8, 0.95);
    // trabeculae carneae: short combs on the ventricular endocardium
    const combs = (w, s0, s1, n, len) => {
      let d = '';
      for (let i = 0; i <= n; i++) {
        const s = s0 + (s1 - s0) * i / n;
        const a = edgeAt(w.A, s), b = edgeAt(w.B, s);
        const vx = a[0] - b[0], vy = a[1] - b[1], l = Math.hypot(vx, vy) || 1;
        const q = edgeAt(w.A, Math.min(1, s + 0.03));
        d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${(a[0] + vx / l * len * 0.7 + (q[0] - a[0]) * 0.4).toFixed(1)} ${(a[1] + vy / l * len * 0.7 + (q[1] - a[1]) * 0.4).toFixed(1)} ${(a[0] + vx / l * len + (q[0] - a[0]) * 0.9).toFixed(1)} ${(a[1] + vy / l * len + (q[1] - a[1]) * 0.9).toFixed(1)}`;
      }
      return d;
    };
    stroke(combs(walls.RV, 0.08, 0.48, 5, 6), '#333f52', 0.6, 0.8);
    stroke(combs(walls.LV, 0.06, 0.3, 3, 5), '#333f52', 0.6, 0.8);
    // interatrial septum
    stroke('M188 122 L189 186 M198 120 L197 182', '#38445a', 0.6, 0.9);

    // AV annulus
    stroke('M98 206 Q142 202 186 198', '#38445a', 0.8, 0.95);
    stroke('M240 186 Q276 190 314 187', '#38445a', 0.8, 0.95);

    // valves: leaflets, chordae, papillary nubs, moderator band
    stroke('M146 200 Q156 214 158 230', '#3e4b62', 0.8);
    stroke('M184 198 Q176 212 172 228', '#3e4b62', 0.8);
    stroke('M158 230 L170 312 M172 228 L174 312', '#36425a', 0.5, 0.85);
    stroke('M240 186 Q250 204 256 226', '#3e4b62', 0.8);
    stroke('M314 187 Q304 202 297 220', '#3e4b62', 0.8);
    stroke('M256 226 L293 240 M297 220 L295 238 M256 226 L263 318', '#36425a', 0.5, 0.85);
    svgEl('circle', { cx: 172, cy: 316, r: 2.6, fill: '#232c3a', stroke: '#3e4b62', 'stroke-width': 0.7 }, gMain);
    svgEl('circle', { cx: 295, cy: 242, r: 2.8, fill: '#232c3a', stroke: '#3e4b62', 'stroke-width': 0.7 }, gMain);
    svgEl('circle', { cx: 264, cy: 322, r: 2.8, fill: '#232c3a', stroke: '#3e4b62', 'stroke-width': 0.7 }, gMain);
    stroke('M249 310 Q208 322 174 322', '#3a4759', 2.6, 0.55);                   // moderator band (muscle)

    // conduction wiring (its own group; rebuilt when lesions change)
    ink.wires = svgEl('g', {}, gMain);
    buildWireInk();

    // nodes
    for (const id of ['SA', 'AV']) {
      const n = nodes[id];
      svgEl('ellipse', {
        cx: n.p[0], cy: n.p[1], rx: n.rx, ry: n.ry, fill: '#5d7086', opacity: 0.9,
        transform: `rotate(${n.rot} ${n.p[0]} ${n.p[1]})`
      }, gMain);
    }
    // Bachmann's bundle hint
    stroke('M158 98 Q186 88 214 98', '#52627e', 0.7, 0.65);

    // hub of the vector needle
    svgEl('circle', { cx: dial.c[0], cy: dial.c[1], r: 2.6, fill: 'none', stroke: '#46536b', 'stroke-width': 1, opacity: 0.9 }, gMain);

    // labels
    const label = (t, x, y, o = 0.5, s = 8.5, anchor = 'middle') => {
      const e = svgEl('text', {
        x, y, fill: '#9aa7b8', 'fill-opacity': o, 'text-anchor': anchor,
        stroke: '#0d1219', 'stroke-width': 2.2, 'stroke-opacity': 0.5, 'paint-order': 'stroke',
        style: `font:600 ${s}px -apple-system,system-ui,sans-serif;letter-spacing:.12em;`
      }, gMain);
      e.appendChild(document.createTextNode(t));
      e.dataset.o = o;
      return e;
    };
    label('RA', 142, 152); label('LA', 254, 138);
    ink.labRV = label('RV', 148, 262); ink.labLV = label('LV', 288, 298);
    label('SA', 130, 122, 0.8, 8); stroke('M136 117 L146 106', '#5d7086', 0.6, 0.8);
    label('AV', 168, 170, 0.8, 8); stroke('M175 173 L193 184', '#5d7086', 0.6, 0.8);

    // phase chip + caption (screen space)
    ink.phaseTick = svgEl('rect', { x: 14, y: 417, width: 3, height: 10, rx: 1, fill: TONES.rest, opacity: 0 }, gUI);
    ink.phaseText = svgEl('text', {
      x: 23, y: 425.5, fill: '#c3cddb', 'fill-opacity': 0,
      style: 'font:600 9px -apple-system,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;'
    }, gUI);
    ink.phaseText.textContent = '';

    // ectopic focus marker (hidden until fed)
    ink.focus = svgEl('g', { opacity: 0 }, gMain);
    svgEl('circle', { cx: 0, cy: 0, r: 3, fill: 'none', stroke: '#ffc24b', 'stroke-width': 0.9, opacity: 0.9 }, ink.focus);
    ink.focusLead = svgEl('path', { d: '', fill: 'none', stroke: '#5d7086', 'stroke-width': 0.6 }, ink.focus);
    ink.focusText = svgEl('text', {
      fill: '#9aa7b8', 'fill-opacity': 0.85,
      style: 'font:600 7.5px -apple-system,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;'
    }, ink.focus);
  }
  function buildWireInk() {
    ink.wires.innerHTML = '';
    const mk = (d, w, o, extra = {}) =>
      svgEl('path', Object.assign({ d, fill: 'none', stroke: '#6b7c99', 'stroke-width': w, opacity: o, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, extra), ink.wires);
    for (const id of ['HIS', 'RBB', 'LBB', 'LAF', 'LPF']) {
      const wire = G.wires[id];
      if (!inst.blocked.has(id)) {
        mk(wireSlice(wire, 0, 1).map(P).join(''), 1, 0.95);
      } else {
        const L = G.lesionAt[id] ?? 0.4;
        mk(wireSlice(wire, 0, L - 0.045).map(P).join(''), 1, 0.95);
        mk(wireSlice(wire, L + 0.045, 1).map(P).join(''), 0.9, 0.4, { 'stroke-dasharray': '2.2 2.6' });
        // lesion: physical gap + double break ticks
        const p0 = wireTip(wire, Math.max(0, L - 0.02)), p1 = wireTip(wire, Math.min(1, L + 0.02));
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l, tx = dx / l, ty = dy / l;
        const c = wireTip(wire, L);
        const tick = off => `M${(c[0] + tx * off - nx * 3.6 + tx * 1.6).toFixed(1)} ${(c[1] + ty * off - ny * 3.6 + ty * 1.6).toFixed(1)}L${(c[0] + tx * off + nx * 3.6 - tx * 1.6).toFixed(1)} ${(c[1] + ty * off + ny * 3.6 - ty * 1.6).toFixed(1)}`;
        mk(tick(-1.4) + tick(1.8), 0.9, 0.9, { stroke: '#8a94a6' });
      }
    }
    // Purkinje twigs (terminal arborization)
    const twigs = 'M174 322 L165 316 M174 322 L167 329 M264 346 L270 340 M264 346 L257 350 ' +
      'M253 250 L261 245 M253 250 L260 256 M266 332 L273 328 M266 332 L271 338 ' +
      'M232 244 L238 253 M244 288 L251 294';
    svgEl('path', { d: twigs, fill: 'none', stroke: '#6b7c99', 'stroke-width': 0.55, opacity: 0.75, 'stroke-linecap': 'round' }, ink.wires);
  }

  /* ---------- light painters ---------- */
  const DEPOL = {
    crisp: { hotW: 0.18, bandW: 0.05, slant: 0.06, plateau: 0.30, hot: 0.55, bandA: 0.85, coreA: 0.9 },
    heavy: { hotW: 0.30, bandW: 0.11, slant: 0.11, plateau: 0.30, hot: 0.40, bandA: 0.5, coreA: 0 },
  };
  function stripPoly(c, w, s0, s1, fLo, fHi) {
    if (s1 - s0 < 0.004) return false;
    const n = Math.max(3, Math.round((s1 - s0) * w.N * 2));
    c.beginPath();
    for (let i = 0; i <= n; i++) { const p = rAt(w, lerp(s0, s1, i / n), fLo); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }
    for (let i = n; i >= 0; i--) { const p = rAt(w, lerp(s0, s1, i / n), fHi); c.lineTo(p[0], p[1]); }
    c.closePath();
    return true;
  }
  // longitudinal wall: origin-to-front wake + slanted transmural band
  function paintWallDepol(c, w, level, prog, tone, texture, origin = 0) {
    const T = DEPOL[texture], col = toneRGB(tone), core = toneCore(tone);
    const span = 1 - origin;
    const front = origin + clamp01(prog) * span;
    // secondary short front toward the near edge (radiating both ways from origin)
    const back = origin > 0.001 ? origin * (1 - Math.min(1, prog * 3)) : 0;
    for (const st of w.strips) {
      const midF = (st.lo + st.hi) / 2;
      const fL = front - T.slant * midF * span;
      const bL = origin > 0.001 ? back + T.slant * midF * origin : 0;
      // settled wake
      c.fillStyle = rgba(col, 1);
      c.globalAlpha = clamp01(level * T.plateau);
      if (stripPoly(c, w, bL, Math.max(bL, fL - T.hotW), st.lo, st.hi)) c.fill();
      // hot zone rising to the front
      const q = 6;
      for (let k = 0; k < q; k++) {
        const sA = fL - T.hotW * (1 - k / q), sB = fL - T.hotW * (1 - (k + 1) / q);
        c.globalAlpha = clamp01(level * (T.plateau + T.hot * Math.pow((k + 0.5) / q, 1.5)));
        if (stripPoly(c, w, Math.max(bL, sA), Math.max(bL, sB), st.lo, st.hi)) c.fill();
      }
    }
    c.globalAlpha = 1;
    // the traveling front: one slanted band through the full thickness (endo leads)
    if (prog > 0.001 && prog < 1.02) {
      const bw = T.bandW, lead = T.slant * span;
      const quad = (w0, colr, a) => {
        const iA = edgeAt(w.A, front - bw * w0), iB = edgeAt(w.A, front + bw * w0);
        const oB = edgeAt(w.B, front - lead + bw * w0), oA = edgeAt(w.B, front - lead - bw * w0);
        c.fillStyle = rgba(colr, 1); c.globalAlpha = clamp01(a);
        c.beginPath(); c.moveTo(iA[0], iA[1]); c.lineTo(iB[0], iB[1]); c.lineTo(oB[0], oB[1]); c.lineTo(oA[0], oA[1]); c.closePath(); c.fill();
      };
      const fade = 1 - ss(0.985, 1.02, front);
      quad(1, col, level * T.bandA * fade);
      if (T.coreA) quad(0.45, core, level * T.coreA * fade);
      c.globalAlpha = 1;
    }
  }
  // repolarization: broad soft wash, epicardium leading, ember flicker.
  // painted per fine segment with a gaussian profile - smooth on curved walls.
  function paintWallRepol(c, w, level, prog, t, origin = 0) {
    const col = toneRGB('repol');
    const span = 1 - origin;
    const center = origin + clamp01(prog) * (span + 0.5) - 0.25;   // band enters and exits
    c.fillStyle = rgba(col, 1);
    const n = w.N - 1, step = 1;
    for (const st of w.strips) {
      const midF = (st.lo + st.hi) / 2;
      const cL = center + 0.06 * midF;                             // epi ahead in time
      for (let i = 0; i < n; i += step) {
        const s = (i + step / 2) / n;
        const d = (s - cL) / 0.24;
        const gauss = Math.exp(-d * d);
        const settled = s < cL ? 0.13 : 0;
        const flick = 0.9 + 0.1 * Math.sin(t * 0.006 + i * 0.22 + midF * 5);
        const a = level * (0.55 * gauss + settled) * flick * (0.75 + 0.25 * (1 - midF));
        if (a < 0.012) continue;
        c.globalAlpha = clamp01(a);
        if (stripPoly(c, w, i / n, Math.min(1, (i + step + 0.35) / n), st.lo, st.hi)) c.fill();
      }
    }
    c.globalAlpha = 1;
  }
  // disorganized shimmer (fibrillation): level with no coherent progress
  function paintWallFib(c, w, level, t) {
    const col = mixRGB(toneRGB('atria'), TONE_RGB.rest, 0.25);
    c.fillStyle = rgba(col, 1);
    for (const st of w.strips) for (let i = 0; i < w.N - 2; i += 2) {
      const nz = vnoise(i * 3.1 + st.lo * 17, t / 90);
      const a = level * 0.45 * Math.pow(nz, 2.2);
      if (a < 0.01) continue;
      c.globalAlpha = clamp01(a);
      if (stripPoly(c, w, i / (w.N - 1), (i + 2) / (w.N - 1), st.lo, st.hi)) c.fill();
    }
    c.globalAlpha = 1;
  }
  // septum: front is a long line sliding ACROSS the thickness; direction inferred
  function paintSeptum(c, w, level, prog, tone, texture, dir, t) {
    if (tone === 'repol') {                       // gentle transverse wash
      const col = toneRGB('repol');
      const cU = dir > 0 ? clamp01(prog) : 1 - clamp01(prog);
      for (let k = 0; k < 6; k++) {
        const u0 = clamp01(cU - 0.45 + 0.9 * k / 6), u1 = clamp01(cU - 0.45 + 0.9 * (k + 1) / 6);
        if (u1 - u0 < 0.01) continue;
        const gauss = Math.exp(-Math.pow((k + 0.5) / 6 - 0.5, 2) * 8);
        const flick = 0.86 + 0.14 * Math.sin(t * 0.006 + k * 2.3);
        c.fillStyle = rgba(col, 1); c.globalAlpha = clamp01(level * 0.42 * gauss * flick);
        if (stripPoly(c, w, 0, 1, u0, u1)) c.fill();
      }
      c.globalAlpha = 1; return;
    }
    const T = DEPOL[texture], col = toneRGB(tone), core = toneCore(tone);
    const p = clamp01(prog);
    const lag = 0.10;
    const bump = s => 1 - ss(0, 0.24, s) * (1 - ss(0.76, 1, s));   // base+apex lag behind
    const lineAt = u => {
      const pts = [];
      for (let i = 0; i < w.N; i += 2) {
        const s = i / (w.N - 1);
        pts.push(rAt(w, s, clamp01(u - dir * lag * bump(s))));
      }
      return pts;
    };
    // wake fill from the origin face to the frontier
    const hw = 0.5, q = 6;
    const face = dir > 0 ? 0 : 1;
    const fill = (uA, uB, a) => {
      if (Math.abs(uB - uA) < 0.01) return;
      const A = lineAt(uA), B = lineAt(uB);
      c.fillStyle = rgba(col, 1); c.globalAlpha = clamp01(a);
      c.beginPath(); pathPoly(c, A.concat(B.reverse())); c.fill();
    };
    const frontier = dir > 0 ? p : 1 - p;
    const behind = u => clamp01(frontier - dir * u);
    fill(face, behind(hw), level * T.plateau * 0.62);
    for (let k = 0; k < q; k++)
      fill(behind(hw * (1 - k / q)), behind(hw * (1 - (k + 1) / q)),
        level * (T.plateau * 0.62 + T.hot * Math.pow((k + 0.5) / q, 1.5)));
    // the sliding line front
    if (p > 0.001 && p < 0.999) {
      const pts = lineAt(frontier);
      const strokeLine = (wd, colr, a) => {
        c.strokeStyle = rgba(colr, 1); c.globalAlpha = clamp01(a); c.lineWidth = wd;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); pathPoly(c, pts, true); c.stroke();
      };
      strokeLine(4.5, col, level * 0.42);
      strokeLine(2.2, col, level * T.bandA);
      if (T.coreA) strokeLine(1.1, core, level * T.coreA);
    }
    c.globalAlpha = 1;
  }
  // ectopic: radial cell-to-cell spread from the focus point across all ventricular muscle
  function paintRadial(c, level, prog, focusPt, tone, t) {
    const col = toneRGB(tone), maxR = 270, R = clamp01(prog) * maxR, band = 26;
    const cellWalls = [['SEPTUM', 4], ['RV', 2], ['LV', 3]];
    for (const [id, layers] of cellWalls) {
      const w = G.walls[id];
      c.fillStyle = rgba(col, 1);
      for (let li = 0; li < layers; li++) {
        const f0 = li / layers, f1 = (li + 1) / layers;
        for (let i = 0; i < w.N - 1; i++) {
          const s = (i + 0.5) / (w.N - 1);
          const p0 = rAt(w, s, (f0 + f1) / 2);
          const jit = (hash1(i * 13.7 + li * 7.1) - 0.5) * 3.5;
          const d = dist(p0, focusPt) + jit;
          let a = 0;
          if (d < R) a = 0.20 + 0.45 * Math.exp(-(R - d) / 62);
          if (Math.abs(d - R) < band) a += 0.5 * Math.pow(1 - Math.abs(d - R) / band, 2);
          a *= level * 0.9;
          if (a < 0.012) continue;
          c.globalAlpha = clamp01(a);
          if (stripPoly(c, w, i / (w.N - 1), Math.min(1, (i + 1.35) / (w.N - 1)), f0, f1)) c.fill();
        }
      }
    }
    c.globalAlpha = 1;
    // origin flare + expanding shock ring
    blit(c, sprite(tone, col), focusPt[0], focusPt[1], 16, level * (1 - ss(0.35, 0.9, prog)) * 0.9);
    c.strokeStyle = rgba(col, 1); c.lineWidth = 1;
    for (const m of [1, 0.72]) {
      const r = R * m;
      if (r < 4) continue;
      c.globalAlpha = clamp01(level * 0.12 * (1 - prog * 0.75));
      c.beginPath(); c.arc(focusPt[0], focusPt[1], r, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
  }
  function paintWire(c, id, level, prog, tone) {
    if (level <= 0.012) return;
    const wire = G.wires[id], col = toneRGB(tone), core = toneCore(tone);
    let tip = clamp01(prog), pooled = false;
    if (inst.blocked.has(id)) {
      const L = G.lesionAt[id] ?? 0.4;
      if (tip >= L - 0.05) { tip = L - 0.05; pooled = true; }
    }
    c.lineCap = 'round'; c.lineJoin = 'round';
    const drawRuns = (runs, wd, colr, a) => {
      if (a <= 0.01) return;
      c.strokeStyle = rgba(colr, 1); c.globalAlpha = clamp01(a); c.lineWidth = wd;
      for (const run of runs) { c.beginPath(); pathPoly(c, run, true); c.stroke(); }
    };
    const litRuns = wireSlice(wire, 0, tip);
    drawRuns(litRuns, 4, col, 0.16 * level);
    drawRuns(litRuns, 1.2, col, 0.35 * level);
    const headRuns = wireSlice(wire, Math.max(0, tip - 0.2), tip);
    drawRuns(headRuns, 5, col, 0.3 * level);
    drawRuns(headRuns, 1.6, core, 0.85 * level);
    // racing head / pooling stump
    for (const seg of wire.segs) if (tip >= seg.s0 && tip <= seg.s1) {
      const p = wireTip({ segs: [seg] }, tip);
      blit(c, sprite(tone, col), p[0], p[1], pooled ? 9 : 6.5, level * (pooled ? 0.75 : 0.85));
    }
    c.globalAlpha = 1;
  }
  function paintInjuryMain(c, t) {              // on the MAIN canvas, before light
    for (const id in inst.injury) {
      const inj = inst.injury[id], w = G.walls[id];
      if (!w || inj.amt <= 0.01) continue;
      const s0 = 0.05, s1 = clamp01(0.05 + 0.8 * inj.extent);
      c.fillStyle = `rgba(12,8,12,${0.4 * inj.amt})`;
      if (stripPoly(c, w, s0, s1, 0, 1)) c.fill();
      c.strokeStyle = `rgba(255,93,108,${0.22 * inj.amt})`; c.lineWidth = 0.8; c.lineCap = 'round';
      const n = Math.round((s1 - s0) * w.N / 3);
      for (let k = 0; k <= n; k++) {
        const s = lerp(s0, s1, k / n);
        const a = rAt(w, s, 0.08), b = rAt(w, Math.min(1, s + 0.045), 0.92);
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
    }
  }
  function paintInjuryGlow(c, t) {              // smolder, additive
    for (const id in inst.injury) {
      const inj = inst.injury[id], w = G.walls[id];
      if (!w || inj.amt <= 0.01) continue;
      const s0 = 0.05, s1 = clamp01(0.05 + 0.8 * inj.extent);
      const breathe = 0.10 + 0.05 * Math.sin(t * 0.0045);
      c.fillStyle = rgba(TONE_RGB.injury, 1); c.globalAlpha = inj.amt * breathe;
      if (stripPoly(c, w, s0, s1, 0, 1)) c.fill();
      c.globalAlpha = 1;
    }
  }

  /* ---------- vector needle + trail ---------- */
  function pushTrail(state) {
    const t = state.t || 0;
    if (inst.lastT !== null) {
      let dt = t - inst.lastT;
      if (dt < 0) { if (dt > -700) { inst.trail.length = 0; dt = 0; } else dt = 16; }  // scrub back vs loop wrap
      dt = Math.min(dt, 60);
      for (const s of inst.trail) s.age += dt;
    }
    inst.lastT = t;
    const v = state.vector || { angleDeg: 0, magnitude: 0 };
    const mag = clamp(v.magnitude || 0, 0, 2);
    if (mag > 0.03) {
      const d = G.dial;
      inst.trail.push({
        x: d.c[0] + Math.cos(v.angleDeg * RAD) * mag * d.scale,
        y: d.c[1] + Math.sin(v.angleDeg * RAD) * mag * d.scale,
        tone: state.tone || 'rest', age: 0, mag
      });
    }
    while (inst.trail.length > 200) inst.trail.shift();
    for (let i = inst.trail.length - 1; i >= 0; i--) if (inst.trail[i].age > 560) { inst.trail.splice(0, i + 1); break; }
  }
  function paintVector(c, state) {
    const d = G.dial, tr = inst.trail;
    c.lineCap = 'round'; c.lineJoin = 'round';
    // comet loop: runs grouped by tone + age band, each drawn as one smooth
    // stroke (per-segment additive strokes bead at the joints)
    let run = [];
    let runKey = null;
    const flush = () => {
      if (run.length > 2) {
        const head = run[run.length - 1];
        const f = Math.pow(1 - head.age / 560, 1.7);
        if (f > 0.012) {
          const col = mixRGB(toneRGB(head.tone), WHITE, head.age < 90 ? 0.3 : 0.08);
          c.strokeStyle = rgba(col, 1); c.globalAlpha = clamp01(0.5 * f);
          c.lineWidth = 0.7 + 2.6 * Math.pow(1 - head.age / 560, 1.4);
          c.beginPath();
          c.moveTo(run[0].x, run[0].y);
          for (let i = 1; i < run.length - 1; i++)
            c.quadraticCurveTo(run[i].x, run[i].y, (run[i].x + run[i + 1].x) / 2, (run[i].y + run[i + 1].y) / 2);
          c.lineTo(run[run.length - 1].x, run[run.length - 1].y);
          c.stroke();
        }
      }
      const last = run[run.length - 1];
      run = last ? [last] : [];
    };
    for (const smp of tr) {
      if (smp.age > 560 || smp.mag < 0.035) { run = []; runKey = null; continue; }
      const key = smp.tone + '|' + Math.floor(smp.age / 130);
      if (runKey !== null && key !== runKey) flush();
      runKey = key;
      run.push(smp);
    }
    flush();
    c.globalAlpha = 1;
    const v = state.vector || { angleDeg: 0, magnitude: 0 };
    const mag = clamp(v.magnitude || 0, 0, 2);
    const vis = ss(0.04, 0.22, mag);
    if (vis <= 0.01) return;
    const tone = state.tone || 'rest';
    const col = toneRGB(tone), core = mixRGB(col, WHITE, 0.5);
    const ang = v.angleDeg * RAD, ux = Math.cos(ang), uy = Math.sin(ang);
    const len = mag * d.scale, [ox, oy] = d.c;
    const tx = ox + ux * len, ty = oy + uy * len;
    // glow passes
    c.strokeStyle = rgba(col, 1); c.lineWidth = 9; c.globalAlpha = 0.13 * vis;
    c.beginPath(); c.moveTo(ox, oy); c.lineTo(tx, ty); c.stroke();
    c.lineWidth = 3.6; c.globalAlpha = 0.26 * vis;
    c.beginPath(); c.moveTo(ox, oy); c.lineTo(tx, ty); c.stroke();
    // tapered shaft
    const px = -uy, py = ux;
    c.fillStyle = rgba(core, 1); c.globalAlpha = 0.96 * vis;
    c.beginPath();
    c.moveTo(ox + px * 1.8, oy + py * 1.8);
    c.lineTo(tx - ux * 8 + px * 0.7, ty - uy * 8 + py * 0.7);
    c.lineTo(tx - ux * 8 - px * 0.7, ty - uy * 8 - py * 0.7);
    c.lineTo(ox - px * 1.8, oy - py * 1.8);
    c.closePath(); c.fill();
    // slender chevron head, proportional to the needle
    const hd = Math.min(9, 3 + len * 0.12);
    c.beginPath();
    c.moveTo(tx + ux * hd * 0.33, ty + uy * hd * 0.33);
    c.lineTo(tx - ux * hd + px * hd * 0.43, ty - uy * hd + py * hd * 0.43);
    c.lineTo(tx - ux * hd * 0.62, ty - uy * hd * 0.62);
    c.lineTo(tx - ux * hd - px * hd * 0.43, ty - uy * hd - py * hd * 0.43);
    c.closePath(); c.fill();
    // counterweight
    c.strokeStyle = rgba(core, 1); c.lineWidth = 2.2; c.globalAlpha = 0.5 * vis;
    c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox - ux * len * 0.12, oy - uy * len * 0.12); c.stroke();
    blit(c, sprite(tone, col), ox, oy, 8, 0.4 * vis);
    c.globalAlpha = 1;
  }

  /* ---------- per-frame update ---------- */
  const EMPTY = { level: 0, progress: 0, kind: 'rest' };
  const getA = (acts, id) => {
    const a = acts[id];
    if (!a) return EMPTY;
    const lv = Number.isFinite(+a.level) ? clamp01(+a.level) : 0;
    const pr = Number.isFinite(+a.progress) ? clamp(+a.progress, 0, 1.05) : null;
    return { level: lv, progress: pr, kind: typeof a.kind === 'string' ? a.kind : 'rest' };
  };
  const kindTone = k => TONES[k] ? k : 'ventricle';

  function update(state) {
    if (!state) return;
    inst.lastState = state;
    const t = state.t || 0;
    const acts = state.activations || {};
    pushTrail(state);

    // septum direction inference
    const sept = getA(acts, 'SEPTUM');
    if (sept.level > 0.02 && sept.progress !== null) {
      if (inst.lastSEPTp !== null && Math.abs(sept.progress - inst.lastSEPTp) > 1e-4)
        inst.dirSEPT = sept.progress > inst.lastSEPTp ? 1 : -1;
      inst.lastSEPTp = sept.progress;
    } else { inst.lastSEPTp = null; if (sept.level <= 0.02) inst.dirSEPT = inst.dirSEPT || 1; }

    // sticky injury marking
    for (const id of ['LV', 'RV', 'SEPTUM', 'RA', 'LA']) {
      const a = getA(acts, id);
      if (a.kind === 'injury' && a.level > 0.01)
        inst.injury[id] = { extent: a.progress === null ? 0.4 : Math.max(0.12, a.progress), amt: a.level };
    }

    const k = inst.k, c = ctx;
    // 1. base
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(base, 0, 0);
    c.setTransform(k, 0, 0, k, 0, 0); c.translate(WDX, 0);
    paintInjuryMain(c, t);

    // 2. light plate (source-over inside -> no additive seams)
    const p = pctx;
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, plate.width, plate.height);
    p.setTransform(k, 0, 0, k, 0, 0); p.translate(WDX, 0);

    const focusA = getA(acts, 'FOCUS');
    const focusOn = focusA.level > 0.012 && state.focus;
    let focusPt = null;
    if (state.focus) focusPt = [clamp01(state.focus.x) * W - WDX, clamp01(state.focus.y) * H];

    for (const id of ['RA', 'LA']) {
      const a = getA(acts, id), w = G.walls[id];
      if (a.level <= 0.012) continue;
      if (a.progress === null || a.kind === 'fib') paintWallFib(p, w, a.level, t);
      else if (a.kind === 'repol') paintWallRepol(p, w, a.level, a.progress, t, w.origin || 0);
      else if (a.kind !== 'injury') paintWallDepol(p, w, a.level * 0.85, a.progress, kindTone(a.kind), 'crisp', w.origin || 0);
    }
    if (sept.level > 0.012 && sept.kind !== 'injury') {
      const texture = (inst.blocked.has('LBB') || focusOn) ? 'heavy' : 'crisp';
      if (sept.progress === null) paintWallFib(p, G.walls.SEPTUM, sept.level, t);
      else paintSeptum(p, G.walls.SEPTUM, sept.level, sept.progress, kindTone(sept.kind), texture, inst.dirSEPT, t);
    }
    for (const id of ['RV', 'LV']) {
      const a = getA(acts, id), w = G.walls[id];
      if (a.level <= 0.012 || a.kind === 'injury') continue;
      const blockedTerr = id === 'LV'
        ? (inst.blocked.has('LBB') || (inst.blocked.has('LAF') && inst.blocked.has('LPF')))
        : inst.blocked.has('RBB');
      const texture = (blockedTerr || focusOn) ? 'heavy' : 'crisp';
      if (a.progress === null) paintWallFib(p, w, a.level, t);
      else if (a.kind === 'repol') paintWallRepol(p, w, a.level, a.progress, t);
      else paintWallDepol(p, w, a.level, a.progress, kindTone(a.kind), texture);
    }
    if (focusOn) paintRadial(p, focusA.level, focusA.progress ?? 0, focusPt, kindTone(focusA.kind), t);
    paintInjuryGlow(p, t);

    // 3. composite the light plate with a two-pass bloom
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'lighter';
    const blurPx = Math.max(1.5, 2.2 * k);
    c.filter = `blur(${blurPx.toFixed(1)}px)`;
    c.globalAlpha = 0.62; c.drawImage(plate, 0, 0);
    c.filter = 'none';
    c.globalAlpha = 0.92; c.drawImage(plate, 0, 0);
    c.globalAlpha = 1;

    // 4. crisp additive layer: wires, nodes, flares, cavity glows, vector
    c.setTransform(k, 0, 0, k, 0, 0); c.translate(WDX, 0);
    for (const id of ['RA', 'LA', 'RV', 'LV', 'SEPTUM']) {
      const a = id === 'SEPTUM' ? sept : getA(acts, id);
      let lvl = a.level;
      if (focusOn && (id === 'RV' || id === 'LV' || id === 'SEPTUM')) lvl = Math.max(lvl, focusA.level * 0.8);
      if (lvl > 0.02 && a.kind !== 'injury') {
        const gl = G.glows[id];
        blit(c, sprite(kindTone(a.kind), toneRGB(kindTone(a.kind))), gl.p[0], gl.p[1], gl.r, lvl * 0.09);
      }
    }
    for (const id of ['HIS', 'RBB', 'LBB', 'LAF', 'LPF']) {
      const a = getA(acts, id);
      if (a.level > 0.012 && a.progress !== null) paintWire(c, id, a.level, a.progress, kindTone(a.kind));
    }
    // nodes
    const sa = getA(acts, 'SA'), av = getA(acts, 'AV');
    if (sa.level > 0.012) {
      const n = G.nodes.SA, col = toneRGB('sa');
      blit(c, sprite('sa', col), n.p[0], n.p[1], 10 + 5 * sa.level, sa.level * 0.9);
      // the spark: two expanding rings
      c.strokeStyle = rgba(col, 1); c.lineWidth = 0.9;
      for (const off of [0, 0.4]) {
        const pr = clamp01((sa.progress ?? 0) - off);
        if (pr <= 0) continue;
        c.globalAlpha = clamp01(sa.level * Math.pow(1 - pr, 1.6) * 0.6);
        c.beginPath(); c.arc(n.p[0], n.p[1], 4 + 17 * pr, 0, TAU); c.stroke();
      }
      c.globalAlpha = 1;
    }
    if (av.level > 0.012) {
      const n = G.nodes.AV, col = toneRGB('av');
      // contained pressure: the glow swells in brightness while its radius tightens
      const r = 20 - 8 * av.level;
      const tremble = av.level > 0.3 && av.level < 0.97 ? 0.05 * Math.sin(t * 0.16) : 0;
      blit(c, sprite('av', col), n.p[0], n.p[1], r, clamp01(av.level * 1.1 + tremble));
      blit(c, sprite('av', col), n.p[0], n.p[1], r * 0.5, clamp01(av.level * 0.8));
      // a tightening containment ring
      if (av.level > 0.2 && av.level < 0.98) {
        c.strokeStyle = rgba(col, 1); c.lineWidth = 0.8;
        c.globalAlpha = clamp01(av.level * 0.4);
        c.beginPath(); c.arc(n.p[0], n.p[1], 17 - 8 * av.level, 0, TAU); c.stroke();
        c.globalAlpha = 1;
      }
      // a slow crawl of light inching through the node capsule
      if (av.progress !== null && av.progress > 0.02 && av.progress < 0.99) {
        const a0 = n.rot * RAD;
        const cx = n.p[0] + Math.cos(a0) * (av.progress - 0.5) * n.rx * 2;
        const cy = n.p[1] + Math.sin(a0) * (av.progress - 0.5) * n.rx * 2;
        blit(c, sprite('av-core', toneCore('av')), cx, cy, 3.4, av.level * 0.9);
      }
    }
    // Purkinje ignition flares
    for (const site of G.purkinje) {
      const a = getA(acts, site.w);
      if (a.progress === null) continue;
      const f = a.level * ss(0.82, 1, a.progress);
      if (f > 0.02) blit(c, sprite('ventricle', toneRGB('ventricle')), site.p[0], site.p[1], 7.5, f * 0.8);
    }
    paintVector(c, state);
    c.globalCompositeOperation = 'source-over';

    // 5. SVG dynamics: phase chip + focus marker
    const tone = TONES[state.tone] ? state.tone : 'rest';
    const ph = inst.phase;
    if (tone !== ph.tone) { ph.tone = tone; ph.alpha = 0; }
    ph.alpha = Math.min(1, ph.alpha + 0.12);
    const showPhase = tone !== 'rest' ? ph.alpha : ph.alpha * 0.55;
    ink.phaseTick.setAttribute('fill', TONES[tone]);
    ink.phaseTick.setAttribute('opacity', (0.9 * showPhase).toFixed(2));
    ink.phaseText.setAttribute('fill-opacity', (0.65 * showPhase).toFixed(2));
    const word = PHASE_WORDS[tone] || '';
    if (ink.phaseText.textContent !== word.toUpperCase()) ink.phaseText.textContent = word.toUpperCase();

    const labFade = state.focus ? 0.24 : 1;
    ink.labRV.setAttribute('fill-opacity', (+ink.labRV.dataset.o * labFade).toFixed(2));
    ink.labLV.setAttribute('fill-opacity', (+ink.labLV.dataset.o * labFade).toFixed(2));
    if (state.focus && focusPt) {
      ink.focus.setAttribute('opacity', '0.9');
      ink.focus.setAttribute('transform', `translate(${focusPt[0].toFixed(1)} ${focusPt[1].toFixed(1)})`);
      // plate-style callout: the label lives in the clear band beneath the apex
      const lx = clamp(focusPt[0] - 24, 120 - WDX, 300 - WDX) - focusPt[0];
      const ly = 404 - focusPt[1];
      ink.focusLead.setAttribute('d', `M0 6 L${(lx + 20).toFixed(1)} ${(ly - 9).toFixed(1)}`);
      ink.focusText.setAttribute('x', lx + 20);
      ink.focusText.setAttribute('y', ly);
      ink.focusText.setAttribute('text-anchor', 'middle');
      const lab = (state.focus.label || 'ECTOPIC FOCUS').toUpperCase();
      if (ink.focusText.textContent !== lab) ink.focusText.textContent = lab;
    } else ink.focus.setAttribute('opacity', '0');
  }

  /* ---------- lifecycle ---------- */
  function resize() {
    const cssW = root.clientWidth || 390;
    inst.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(2, Math.round(cssW * inst.dpr));
    const h = Math.round(w * H / W);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = base.width = plate.width = w;
    canvas.height = base.height = plate.height = h;
    inst.k = w / W;
    paintBase();
    if (inst.lastState) update(inst.lastState);
    else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0); }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  buildInk();
  resize();

  return {
    update,
    setStatic(cfg = {}) {
      inst.blocked = new Set(Array.isArray(cfg.blocked) ? cfg.blocked : []);
      inst.injury = {};
      inst.trail.length = 0;
      buildWireInk();
      if (inst.lastState) update(inst.lastState);
    },
    destroy() {
      ro.disconnect();
      root.remove();
      inst.sprites = {};
    },
  };
}

window.HeartVis = { mount };
})();
