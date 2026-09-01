/**
 * Signal measurements for quiz-bank gating: everything a class gate needs,
 * computed from the asset's mV leads + the annotator's beat fiducials.
 * All windows in ms; every per-beat number is aggregated as a MEDIAN so a
 * single noisy beat cannot admit or reject a record.
 */

const median = (xs) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const mvLead = (asset, name) => {
  const raw = asset.leads[name]
  if (!raw) return null
  const out = new Float64Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / asset.unitsPerMv
  return out
}

const idxOf = (asset, ms) => Math.round((ms / 1000) * asset.fs)

/** Mean of lead over [fromMs, toMs), clamped to the record. */
const winMean = (asset, lead, fromMs, toMs) => {
  const a = Math.max(0, idxOf(asset, fromMs))
  const b = Math.min(lead.length, Math.max(a + 1, idxOf(asset, toMs)))
  let acc = 0
  for (let i = a; i < b; i++) acc += lead[i]
  return acc / (b - a)
}
const winMin = (asset, lead, fromMs, toMs) => {
  const a = Math.max(0, idxOf(asset, fromMs))
  const b = Math.min(lead.length, Math.max(a + 1, idxOf(asset, toMs)))
  let m = Infinity
  for (let i = a; i < b; i++) m = Math.min(m, lead[i])
  return m
}
const winMax = (asset, lead, fromMs, toMs) => {
  const a = Math.max(0, idxOf(asset, fromMs))
  const b = Math.min(lead.length, Math.max(a + 1, idxOf(asset, toMs)))
  let m = -Infinity
  for (let i = a; i < b; i++) m = Math.max(m, lead[i])
  return m
}

const LEADS12 = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']

/**
 * Measure one asset. Beats near the record edges are skipped (their baseline
 * or T window would fall outside). Baseline per beat = 24 ms of PR segment
 * ending 8 ms before QRS onset.
 */
export const measureAsset = (asset) => {
  const beats = asset.annotation.beats.filter(
    (b) => b.qrsOn > 180 && b.qrsOff < asset.durationMs - 320,
  )
  const leads = Object.fromEntries(
    LEADS12.map((n) => [n, mvLead(asset, n)]).filter(([, v]) => v),
  )

  const rr = []
  const all = asset.annotation.beats
  for (let i = 1; i < all.length; i++) rr.push(all[i].qrsOn - all[i - 1].qrsOn)
  const rrMed = median(rr)
  const rrMean = rr.reduce((s, x) => s + x, 0) / (rr.length || 1)
  const rrSd = Math.sqrt(rr.reduce((s, x) => s + (x - rrMean) ** 2, 0) / (rr.length || 1))

  const qrsWidths = beats.map((b) => b.qrsOff - b.qrsOn)
  const prs = beats.filter((b) => b.pOn != null).map((b) => b.qrsOn - b.pOn)
  const qts = beats.filter((b) => b.tEnd != null).map((b) => b.tEnd - b.qrsOn)

  // Per-lead ST (J+60 vs PR baseline), T trough, and QRS extrema — medians.
  const st = {}
  const tMin = {}
  const qrsMin = {}
  const qrsMax = {}
  const v1Term = []
  for (const name of Object.keys(leads)) {
    const lead = leads[name]
    const stB = []
    const tB = []
    const qMinB = []
    const qMaxB = []
    for (const b of beats) {
      const base = winMean(asset, lead, b.qrsOn - 32, b.qrsOn - 8)
      stB.push(winMean(asset, lead, b.qrsOff + 50, b.qrsOff + 70) - base)
      const tWinEnd = b.tEnd != null ? b.tEnd : b.qrsOff + 320
      tB.push(winMin(asset, lead, b.qrsOff + 80, tWinEnd) - base)
      qMinB.push(winMin(asset, lead, b.qrsOn, b.qrsOff) - base)
      qMaxB.push(winMax(asset, lead, b.qrsOn, b.qrsOff) - base)
      if (name === 'V1') v1Term.push(winMean(asset, lead, b.qrsOff - 40, b.qrsOff) - base)
    }
    st[name] = median(stB)
    tMin[name] = median(tB)
    qrsMin[name] = median(qMinB)
    qrsMax[name] = median(qMaxB)
  }

  const sokolow =
    leads.V1 && (leads.V5 || leads.V6)
      ? Math.abs(Math.min(0, qrsMin.V1)) + Math.max(qrsMax.V5 ?? 0, qrsMax.V6 ?? 0)
      : NaN

  const rate = rrMed > 0 ? 60000 / rrMed : NaN
  const qtMed = median(qts)

  return {
    nBeats: all.length,
    rate,
    rrCv: rrMed > 0 ? rrSd / rrMean : NaN,
    maxRrRatio: rr.length ? Math.max(...rr) / rrMed : NaN,
    qrsMs: median(qrsWidths),
    prMs: median(prs),
    pFrac: beats.length ? beats.filter((b) => b.pOn != null).length / beats.length : 0,
    tFrac: beats.length ? qts.length / beats.length : 0,
    qtcMs: qts.length && rrMed > 0 ? qtMed / Math.sqrt(rrMed / 1000) : NaN,
    st,
    tMin,
    qrsMin,
    qrsMax,
    v1TerminalMv: median(v1Term),
    sokolowMv: sokolow,
  }
}
