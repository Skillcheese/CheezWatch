// Reads the skill levels by matching each glyph against the digits 0-9 drawn
// in the game's own font (ChakraPetch-Bold). Tesseract kept misreading this
// bold font; with only ten shapes, template matching is far more reliable.
import { luminance, median } from "./image.js";

const GW = 12, GH = 16;

// Glyph pixels as 0..1 ink over a GW x GH grid covering the glyph's box.
export function normalize(ink, w, box) {
  const out = new Float64Array(GW * GH);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      // Area-average the source pixels under this grid cell.
      const sx0 = box.x0 + (gx * bw) / GW, sx1 = box.x0 + ((gx + 1) * bw) / GW;
      const sy0 = box.y0 + (gy * bh) / GH, sy1 = box.y0 + ((gy + 1) * bh) / GH;
      let s = 0, n = 0;
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
          const wx = Math.min(x + 1, sx1) - Math.max(x, sx0), wy = Math.min(y + 1, sy1) - Math.max(y, sy0);
          if (wx <= 0 || wy <= 0) continue;
          s += ink[y * w + x] * wx * wy; n += wx * wy;
        }
      }
      out[gy * GW + gx] = n ? s / n : 0;
    }
  }
  return { cells: out, aspect: bw / bh };
}

// Ink: how much brighter than the background a pixel is, scaled so the text
// colour is 1. Text is the brightest thing in a number crop in both themes;
// the dark drop shadow some themes draw falls below the background and drops out.
export function inkMap(img) {
  const lum = luminance(img);
  const bg = median(lum);
  let top = bg;
  for (const v of lum) if (v > top) top = v;
  const span = top - bg;
  const ink = new Float32Array(lum.length);
  if (span < 40) return { ink, empty: true };
  for (let i = 0; i < lum.length; i++) ink[i] = Math.max(0, Math.min(1, ((lum[i] - bg) / span - 0.25) / 0.5));
  return { ink, empty: false };
}

// Glyph boxes: 8-connected blobs of ink, left to right. Column runs aren't
// enough because a 7's slant reaches over the digit after it.
export function segment(ink, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const boxes = [];
  for (let start = 0; start < w * h; start++) {
    if (ink[start] <= 0.5 || label[start] >= 0) continue;
    const box = { x0: w, y0: h, x1: 0, y1: 0 };
    const stack = [start];
    label[start] = boxes.length;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      if (x < box.x0) box.x0 = x; if (x + 1 > box.x1) box.x1 = x + 1;
      if (y < box.y0) box.y0 = y; if (y + 1 > box.y1) box.y1 = y + 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (ink[q] > 0.5 && label[q] < 0) { label[q] = boxes.length; stack.push(q); }
      }
    }
    boxes.push(box);
  }
  boxes.sort((a, b) => a.x0 - b.x0);
  // Digits are the tallest marks; specks and frame slivers are much shorter.
  const tall = Math.max(0, ...boxes.map((b) => b.y1 - b.y0));
  return boxes.filter((b) => b.y1 - b.y0 >= tall * 0.7 && tall >= 5);
}

export function distance(a, b) {
  let d = 0;
  for (let i = 0; i < a.cells.length; i++) d += Math.abs(a.cells[i] - b.cells[i]);
  return d / a.cells.length + Math.abs(Math.log(a.aspect / b.aspect)) * 0.5;
}

const SS = 4;

// Renders a digit SS times larger and returns its binary ink, so it can be
// thinned and shifted by fractions of a pixel before downsampling.
function renderLarge(makeContext, fontFamily, digit, fontSize) {
  const big = fontSize * SS;
  const w = Math.ceil(big * 0.9) + 8 * SS, h = Math.ceil(big * 1.3) + 8 * SS;
  const ctx = makeContext(w, h);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff"; ctx.font = `${big}px "${fontFamily}"`; ctx.textBaseline = "alphabetic";
  ctx.fillText(String(digit), 4 * SS, Math.round(big * 1.05) + 4 * SS);
  const data = ctx.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = data[i * 4] > 127 ? 1 : 0;
  return { ink, w, h };
}

// Shrinks ink by `r` pixels on every side (square structuring element).
function erode(src, w, h, r) {
  if (!r) return src;
  let cur = src;
  for (let k = 0; k < r; k++) {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] = cur[i] & cur[i - 1] & cur[i + 1] & cur[i - w] & cur[i + w];
    }
    cur = out;
  }
  return cur;
}

// Box-downsamples by SS after shifting by (ox, oy) large pixels.
function downsample(src, w, h, ox, oy) {
  const sw = Math.floor((w - ox) / SS), sh = Math.floor((h - oy) / SS);
  const out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let n = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) n += src[(y * SS + oy + dy) * w + x * SS + ox + dx];
    out[y * sw + x] = n / (SS * SS);
  }
  return { ink: out, w: sw, h: sh };
}

/**
 * Digit templates from a canvas 2D context factory. `makeContext(w, h)`
 * returns a CanvasRenderingContext2D (browser or @napi-rs/canvas) where
 * `fontFamily` is already loaded. Returns `forHeight(px)`, which gives, per
 * digit, a list of variants rendered at that digit height (cached).
 *
 * The game draws its numbers lighter than the Bold face at small sizes, so
 * each digit also comes in thinner weights; and small glyphs change shape
 * with where they land on the pixel grid, so it comes at quarter-pixel shifts.
 */
export function digitTemplates(makeContext, fontFamily) {
  const probe = renderLarge(makeContext, fontFamily, 0, 25);
  let top = probe.h, bottom = 0;
  for (let y = 0; y < probe.h; y++) for (let x = 0; x < probe.w; x++) if (probe.ink[y * probe.w + x]) { top = Math.min(top, y); bottom = y + 1; }
  const sizePerPx = 25 / ((bottom - top) / SS);
  const cache = new Map();
  return (height) => {
    if (cache.has(height)) return cache.get(height);
    const set = [];
    for (let d = 0; d <= 9; d++) {
      const large = renderLarge(makeContext, fontFamily, d, height * sizePerPx);
      const variants = [];
      for (const thin of [0, 2, 4, 6]) {
        const ink = erode(large.ink, large.w, large.h, thin);
        for (let oy = 0; oy < SS; oy++) for (let ox = 0; ox < SS; ox += 2) {
          const small = downsample(ink, large.w, large.h, ox, oy);
          const box = segment(small.ink, small.w, small.h).sort((p, q) => (q.y1 - q.y0) - (p.y1 - p.y0))[0];
          if (box && Math.abs(box.y1 - box.y0 - height) <= 1) variants.push(normalize(small.ink, small.w, box));
        }
      }
      set.push(variants);
    }
    cache.set(height, set);
    return set;
  };
}

/**
 * Reads a whole number from a crop. Returns { value, digits: [{ digit,
 * distance, ranked }] }, with value null when there's no text. `ranked` is
 * every digit by distance, for fixing near-ties with a checksum.
 */
export function readNumber(img, templates) {
  const { ink, empty } = inkMap(img);
  if (empty) return { value: null, digits: [] };
  const boxes = segment(ink, img.width, img.height);
  // One height for the whole number, so a short-looking 1 doesn't skew it.
  const height = Math.max(0, ...boxes.map((b) => b.y1 - b.y0));
  const set = templates(height);
  const digits = boxes.map((box) => {
    const g = normalize(ink, img.width, box);
    const ranked = set.map((variants, digit) => ({ digit, distance: Math.min(...variants.map((t) => distance(g, t))) })).sort((a, b) => a.distance - b.distance);
    return { ...ranked[0], ranked };
  });
  if (!digits.length) return { value: null, digits };
  return { value: Number(digits.map((d) => d.digit).join("")), digits };
}

/**
 * Adjusts near-tie digits so the numbers add up to `total`. ChakraPetch's
 * 5/6 and 3/8 differ by a stroke or two at panel sizes, and the total-level
 * box gives a checksum. Tries swapping up to three digits to a runner-up,
 * cheapest extra distance first. Returns the corrected values, or null when
 * no small change makes the sum match.
 */
export function fixWithTotal(readings, total) {
  const values = readings.map((r) => r.value ?? 0);
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === total) return values;
  const swaps = [];
  readings.forEach((r, i) => {
    r.digits.forEach((d, j) => {
      const place = 10 ** (r.digits.length - 1 - j);
      for (const alt of d.ranked.slice(1, 4)) {
        if (j === 0 && alt.digit === 0 && r.digits.length > 1) continue;
        swaps.push({ i, j, delta: (alt.digit - d.digit) * place, cost: alt.distance - d.distance, digit: alt.digit, place });
      }
    });
  });
  swaps.sort((a, b) => a.cost - b.cost);
  const top = swaps.slice(0, 40);
  let best = null;
  const need = total - sum;
  const tryCombo = (combo) => {
    const cells = new Set(combo.map((s) => s.i + ":" + s.j));
    if (cells.size !== combo.length) return;
    if (combo.reduce((a, s) => a + s.delta, 0) !== need) return;
    const cost = combo.reduce((a, s) => a + s.cost, 0);
    if (!best || cost < best.cost) best = { cost, combo };
  };
  for (let a = 0; a < top.length; a++) {
    tryCombo([top[a]]);
    for (let b = a + 1; b < top.length; b++) {
      tryCombo([top[a], top[b]]);
      for (let c = b + 1; c < top.length; c++) tryCombo([top[a], top[b], top[c]]);
    }
  }
  if (!best) return null;
  const out = values.slice();
  for (const s of best.combo) out[s.i] += s.delta;
  return out;
}
