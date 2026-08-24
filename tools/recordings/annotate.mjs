/**
 * Automatic fiducial delineation for TraceAssets: QRS on/off via a
 * squared-derivative moving-integral envelope, T end by post-peak decay,
 * P onset by pre-QRS low-amplitude peak. Deliberately conservative: a
 * fiducial it can't establish is omitted (the sync warp just drops the knot),
 * and every result is re-checked by verify.mjs with independent parameters
 * plus a human/agent visual audit of the overlay.
 */

const mvLead = (asset, name) => {
  const raw = asset.leads[name]
  const out = new Float64Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / asset.unitsPerMv
  return out
}

const movingAvg = (x, w) => {
  const out = new Float64Array(x.length)
  let acc = 0
  const half = Math.floor(w / 2)
  for (let i = 0; i < x.length; i++) {
    acc += x[i]
    if (i >= w) acc -= x[i - w]
    out[Math.max(0, i - half)] = acc / Math.min(i + 1, w)
  }
  return out
}

/** Detection envelope: mean over leads of movingIntegral(dx²). */
const envelope = (asset, leadNames, integralMs) => {
  const fs = asset.fs
  const w = Math.max(1, Math.round((integralMs / 1000) * fs))
  let env = null
  for (const name of leadNames) {
    if (!asset.leads[name]) continue
    const x = mvLead(asset, name)
    const d = new Float64Array(x.length)
    for (let i = 1; i < x.length; i++) d[i] = (x[i] - x[i - 1]) ** 2
    const integ = movingAvg(d, w)
    const peak = Math.max(...integ) || 1
    if (!env) env = new Float64Array(x.length)
    for (let i = 0; i < x.length; i++) env[i] += integ[i] / peak
  }
  return env
}

/** QRS peak indices from the envelope (adaptive threshold, refractory gap). */
export const detectQrs = (asset, opts = {}) => {
  const { leads = ['II', 'V2', 'V5'], integralMs = 120, thresholdFrac = 0.18, refractoryMs = 250 } = opts
  const fs = asset.fs
  const env = envelope(asset, leads, integralMs)
  const sorted = Float64Array.from(env).sort()
  const p98 = sorted[Math.floor(sorted.length * 0.98)]
  const thr = thresholdFrac * p98
  const gap = Math.round((refractoryMs / 1000) * fs)

  const peaks = []
  let i = 0
  while (i < env.length) {
    if (env[i] > thr) {
      let j = i
      let best = i
      while (j < env.length && j < i + gap * 2 && env[j] > thr * 0.6) {
        if (env[j] > env[best]) best = j
        j++
      }
      if (!peaks.length || best - peaks[peaks.length - 1] > gap) peaks.push(best)
      i = best + gap
    } else i++
  }
  return { peaks, env }
}

/**
 * The moving-integral envelope smears QRS bounds by ~half its window. Refine
 * on the actual signal: inside the rough window find the peak multi-lead
 * slope, then walk out from it until the slope stays below 7% of that peak —
 * that is where the QRS actually starts and ends.
 */
const refineBySlope = (asset, roughOn, roughOff, idx) => {
  const leads = ['II', 'V2', 'V5'].filter((l) => asset.leads[l])
  const fs = asset.fs
  const s0 = Math.max(1, roughOn - idx(20))
  const s1 = Math.min(asset.leads[leads[0]].length - 1, roughOff + idx(20))
  const slope = new Float64Array(s1 - s0)
  for (const name of leads) {
    const raw = asset.leads[name]
    for (let i = s0; i < s1; i++) {
      slope[i - s0] += Math.abs(raw[i] - raw[i - 1]) / asset.unitsPerMv
    }
  }
  // smooth ~8 ms
  const w = Math.max(1, Math.round(fs * 0.008))
  const sm = new Float64Array(slope.length)
  for (let i = 0; i < slope.length; i++) {
    let acc = 0
    let n = 0
    for (let k = -w; k <= w; k++) {
      const j = i + k
      if (j >= 0 && j < slope.length) { acc += slope[j]; n++ }
    }
    sm[i] = acc / n
  }
  let peak = 0
  let peakI = 0
  for (let i = 0; i < sm.length; i++) if (sm[i] > peak) { peak = sm[i]; peakI = i }
  const thr = 0.07 * peak
  const quiet = Math.round(fs * 0.014) // must stay quiet ~14 ms to count as "out"
  let on = peakI
  let run = 0
  while (on > 0) {
    if (sm[on] < thr) { run++; if (run >= quiet) break } else run = 0
    on--
  }
  on = Math.min(peakI, on + quiet - 1)
  let off = peakI
  run = 0
  while (off < sm.length - 1) {
    if (sm[off] < thr) { run++; if (run >= quiet) break } else run = 0
    off++
  }
  off = Math.max(peakI, off - quiet + 1)
  return [s0 + on, s0 + off]
}

export const annotate = (asset, opts = {}) => {
  const fs = asset.fs
  const ms = (idx) => (idx / fs) * 1000
  const idx = (t) => Math.round((t / 1000) * fs)
  const { peaks, env } = detectQrs(asset, opts)

  const sig = movingAvg(mvLead(asset, asset.leads.II ? 'II' : 'I'), Math.round(fs * 0.03))
  const n = sig.length

  const beats = []
  for (let k = 0; k < peaks.length; k++) {
    const p = peaks[k]
    const peakEnv = env[p]
    // QRS bounds: crawl the envelope down toward this beat's floor. If the
    // first pass runs implausibly wide (T slur merging in), retry with a
    // tighter threshold; a beat that still won't bound is skipped.
    const crawl = (frac) => {
      let on = p
      const onMin = p - idx(180)
      while (on > Math.max(0, onMin) && env[on] > frac * peakEnv) on--
      let off = p
      const offMax = p + idx(220)
      while (off < Math.min(n - 1, offMax) && env[off] > frac * peakEnv) off++
      return [on, off]
    }
    let [on, off] = crawl(0.06)
    if (ms(off - on) > 280) [on, off] = crawl(0.15)
    if (ms(off - on) > 280) continue
    if (ms(off - on) < 40) { on = p - idx(45); off = p + idx(45) }
    ;[on, off] = refineBySlope(asset, on, off, idx)

    const nextOn = k + 1 < peaks.length ? peaks[k + 1] - idx(70) : n - 1
    const base = sig[Math.max(0, on - idx(40))]

    // T end: largest post-QRS deflection, then decay to 12% of it.
    let tEnd
    {
      const t0 = off + idx(60)
      const t1 = Math.min(off + idx(450), nextOn)
      if (t1 > t0 + idx(60)) {
        let tp = t0
        for (let i = t0; i < t1; i++) if (Math.abs(sig[i] - base) > Math.abs(sig[tp] - base)) tp = i
        const tAmp = Math.abs(sig[tp] - base)
        if (tAmp >= 0.06) {
          let e = tp
          while (e < t1 && Math.abs(sig[e] - base) > 0.12 * tAmp) e++
          tEnd = ms(e)
        }
      }
    }

    // P onset: pre-QRS low-frequency peak of meaningful amplitude.
    let pOn
    {
      const s0 = Math.max(0, on - idx(260))
      const s1 = on - idx(45)
      if (s1 > s0 + idx(40)) {
        let pp = s0
        for (let i = s0; i < s1; i++) if (Math.abs(sig[i] - base) > Math.abs(sig[pp] - base)) pp = i
        const pAmp = Math.abs(sig[pp] - base)
        if (pAmp >= 0.04) {
          let s = pp
          while (s > s0 && Math.abs(sig[s] - base) > 0.18 * pAmp) s--
          pOn = ms(s)
        }
      }
    }

    // Keep beats fully inside the strip.
    if (ms(on) < 40 || ms(off) > asset.durationMs - 60) continue
    beats.push({
      ...(pOn != null ? { pOn: Math.round(pOn) } : {}),
      qrsOn: Math.round(ms(on)),
      qrsOff: Math.round(ms(off)),
      ...(tEnd != null ? { tEnd: Math.round(tEnd) } : {}),
    })
  }

  // Reconcile neighbours: a long T (LBBB, long QT) must not swallow the next
  // beat's fiducials. QRS anchors carry the sync; T/P knots yield when tight.
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]
    const next = beats[i + 1]
    if (!next) continue
    if (b.tEnd != null && b.tEnd >= next.qrsOn - 30) {
      const clamped = next.qrsOn - 30
      if (clamped > b.qrsOff + 40) b.tEnd = clamped
      else delete b.tEnd
    }
    const prevEnd = b.tEnd ?? b.qrsOff
    if (next.pOn != null && next.pOn <= prevEnd + 5) delete next.pOn
  }
  return { beats }
}
