// Small helpers over ImageData-like objects ({ width, height, data: RGBA }),
// so the vision code runs the same in the browser and in node tests.

export function luminance(img) {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return out;
}

export function median(values) {
  if (!values.length) return 0;
  const s = Float64Array.from(values).sort();
  return s[s.length >> 1];
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/**
 * Strongest repeat distance in a 1-D signal. Multiples of the true pitch also
 * score well, so the smallest lag close to the best score wins.
 */
export function findPitch(signal, lo, hi) {
  const n = signal.length;
  let mean = 0;
  for (const v of signal) mean += v;
  mean /= n;
  const scores = [];
  for (let k = lo; k <= Math.min(hi, n >> 1); k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += (signal[i] - mean) * (signal[i + k] - mean);
    scores.push([k, s / (n - k)]);
  }
  const isPeak = (i) => (i === 0 || scores[i][1] >= scores[i - 1][1]) && (i === scores.length - 1 || scores[i][1] >= scores[i + 1][1]);
  const peaks = scores.filter((_, i) => isPeak(i));
  const best = Math.max(...peaks.map((p) => p[1]));
  return peaks.find((p) => p[1] >= 0.7 * best)?.[0] ?? null;
}

/** Whole-pixel offset in [0, pitch) where the signal's periodic peaks line up. */
export function findPhase(signal, pitch) {
  let best = 0, bestScore = -Infinity;
  for (let off = 0; off < pitch; off++) {
    const score = combScore(signal, pitch, off);
    if (score > bestScore) { bestScore = score; best = off; }
  }
  return best;
}

// Peaks are a pixel or two wide, so take the best of a small window around each.
function combScore(signal, pitch, off) {
  let s = 0;
  for (let p = off; p < signal.length; p += pitch) {
    const i = Math.round(p);
    s += Math.max(signal[i] ?? 0, signal[i - 1] ?? 0, signal[i + 1] ?? 0);
  }
  return s;
}

/**
 * Refines an integer pitch to a fractional one and finds its offset, so cells
 * far from the origin don't drift when the screen scale isn't a whole number.
 * Works best on a signal cropped to the grid, where cell edges dominate.
 */
export function fitLattice(signal, roughPitch) {
  let best = { pitch: roughPitch, offset: 0, score: -Infinity };
  for (let pitch = Math.max(8, roughPitch - 4); pitch <= roughPitch + 4; pitch += 0.02) {
    // Averaged per line so a smaller pitch doesn't win just by having more.
    const lines = signal.length / pitch;
    for (let off = 0; off < pitch; off += 0.25) {
      const score = combScore(signal, pitch, off) / lines;
      if (score > best.score) best = { pitch, offset: off, score };
    }
  }
  return best;
}

/** Copies a rectangle out of an image, clamped to its bounds. */
export function crop(img, x, y, w, h) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.min(img.width - x, Math.round(w)); h = Math.min(img.height - y, Math.round(h));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) {
    const src = ((y + r) * img.width + x) * 4;
    data.set(img.data.subarray(src, src + w * 4), r * w * 4);
  }
  return { width: w, height: h, data };
}
