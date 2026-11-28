// Finds the boxes of the skills panel (icon on the left, level on the right)
// in a screenshot of any size. Boxes share one background colour, which is
// the most common colour in a crop of the panel.
import { crop } from "./image.js";

// Most common colour, bucketed so slight compression noise doesn't split it.
function dominantColour(img) {
  const { width: w, height: h, data } = img;
  const hist = new Map();
  for (let i = 0; i < w * h; i++) {
    const k = ((data[i * 4] >> 3) << 10) | ((data[i * 4 + 1] >> 3) << 5) | (data[i * 4 + 2] >> 3);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const k = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];
}

// Runs of indices where the fraction is high enough, merging tiny breaks.
function runs(frac, threshold, minLen) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= frac.length; i++) {
    const on = i < frac.length && frac[i] >= threshold;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { if (i - start >= minLen) out.push([start, i]); start = -1; }
  }
  return out;
}

/**
 * Returns [{ x, y, w, h }] for every box, row by row. A box spanning two
 * columns (the total level) comes back as one wide box.
 */
export function findSkillBoxes(img) {
  const { width: w, height: h, data } = img;
  const bg = dominantColour(img);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.abs(data[i * 4] - bg[0]) + Math.abs(data[i * 4 + 1] - bg[1]) + Math.abs(data[i * 4 + 2] - bg[2]);
    mask[i] = d < 24 ? 1 : 0;
  }
  // Rows of boxes: horizontal bands with plenty of box background.
  const rowFrac = new Float64Array(h);
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += mask[y * w + x]; rowFrac[y] = n / w; }
  const maxRow = Math.max(...rowFrac);
  const bands = runs(rowFrac, maxRow * 0.35, Math.max(6, h / 60));
  // Columns are shared by every band, so take them from all bands at once;
  // a single box with a big bright icon can't split its column that way.
  const colFrac = new Float64Array(w);
  let bandRows = 0;
  for (const [y0, y1] of bands) {
    bandRows += y1 - y0;
    for (let x = 0; x < w; x++) for (let y = y0; y < y1; y++) colFrac[x] += mask[y * w + x];
  }
  for (let x = 0; x < w; x++) colFrac[x] /= bandRows || 1;
  const typicalBand = bands.map(([a, b]) => b - a).sort((a, b) => a - b)[bands.length >> 1] ?? 0;
  const columns = runs(colFrac, 0.3, Math.max(6, typicalBand * 0.5));
  const boxes = [];
  // A box spanning two columns has background, not a frame, in the gap
  // between them, so neighbours joined that way are merged.
  const gapIsBackground = (gx0, gx1, y0, y1) => {
    let n = 0;
    for (let y = y0 + 2; y < y1 - 2; y++) for (let x = gx0; x < gx1; x++) n += mask[y * w + x];
    return n / (Math.max(1, gx1 - gx0) * Math.max(1, y1 - y0 - 4)) > 0.6;
  };
  for (const [y0, y1] of bands) {
    let cur = null;
    for (const [x0, x1] of columns) {
      if (cur && gapIsBackground(cur.x + cur.w, x0, y0, y1)) { cur.w = x1 - cur.x; continue; }
      cur = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      boxes.push(cur);
    }
  }
  // Keep the boxes that look like skill boxes: similar height, wider than tall.
  const heights = boxes.map((b) => b.h).sort((a, b) => a - b);
  const typical = heights[heights.length >> 1] ?? 0;
  return boxes.filter((b) => Math.abs(b.h - typical) <= typical * 0.25 && b.w >= b.h * 1.2);
}

// The panel has 30 skill boxes and the total.
const PANEL_BOXES = 31;

/**
 * Like findSkillBoxes, but also works on a whole game window, where the map
 * outweighs the panel's background colour: if the full image has no panel,
 * windows around the panel's size are searched. Boxes are in image coordinates.
 */
export function findSkillPanel(img) {
  let best = findSkillBoxes(img);
  if (best.length >= PANEL_BOXES) return best;
  const { width: w, height: h } = img;
  for (const [fw, fh] of [[0.25, 0.55], [0.33, 0.7], [0.5, 1]]) {
    const cw = Math.round(w * fw), ch = Math.round(h * fh);
    const sx = Math.max(1, Math.round(cw / 3)), sy = Math.max(1, Math.round(ch / 3));
    const xs = [], ys = [];
    for (let x = w - cw; x > 0; x -= sx) xs.push(x);
    xs.push(0);
    for (let y = h - ch; y > 0; y -= sy) ys.push(y);
    ys.push(0);
    for (const y of ys) for (const x of xs) {
      const boxes = findSkillBoxes(crop(img, x, y, cw, ch)).map((b) => ({ ...b, x: b.x + x, y: b.y + y }));
      if (boxes.length >= PANEL_BOXES) return boxes;
      if (boxes.length > best.length) best = boxes;
    }
  }
  return best;
}

/** Splits a box into the icon square on its left and the number area on its right. */
export function splitBox(img, box) {
  // Inset past the box's frame, which some themes draw in a contrasting colour.
  const m = Math.max(2, Math.round(box.h * 0.08));
  const icon = crop(img, box.x + m, box.y + m, box.h - 2 * m, box.h * 0.8 - m);
  const number = crop(img, box.x + box.h, box.y + m, box.w - box.h - m, box.h * 0.8 - m);
  return { icon, number };
}
