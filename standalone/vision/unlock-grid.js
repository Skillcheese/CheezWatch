// Finds the item grid on the Unlocks page and reads which cells are owned.
// Owned cells are drawn with a bright frame; unowned ones have none. Nothing
// here assumes a resolution: the cell pitch comes from the image itself.
import { luminance, findPitch, findPhase, fitLattice, median } from "./image.js";

// Rows below the skill-icon header, top to bottom. The November 2026 update
// added the Q1 (quest) tools between D2 and L1; older screenshots lack it.
export const UNLOCK_ROWS = [
  "pet", "shiny_pet", "cape", "trimmed_cape",
  "T1", "T2", "T3", "T4", "T5", "C6", "D1", "D2", "Q1", "L1", "L2",
];
export const LEGACY_UNLOCK_ROWS = UNLOCK_ROWS.filter((r) => r !== "Q1");

const NOT_FOUND = "Couldn't find the unlocks grid in this screenshot.";

// Edge strength per column and per row inside a rectangle.
function gradientProfiles(lum, w, { x0, y0, x1, y1 }) {
  const cols = new Float64Array(x1 - x0), rows = new Float64Array(y1 - y0);
  for (let y = Math.max(1, y0); y < y1; y++) {
    for (let x = Math.max(1, x0); x < x1; x++) {
      const v = lum[y * w + x];
      cols[x - x0] += Math.abs(v - lum[y * w + x - 1]);
      rows[y - y0] += Math.abs(v - lum[(y - 1) * w + x]);
    }
  }
  return { cols, rows };
}

function cellMedian(lum, w, x0, y0, size) {
  const v = [];
  const step = Math.max(1, size >> 4);
  for (let y = y0; y < y0 + size; y += step) for (let x = x0; x < x0 + size; x += step) v.push(lum[y * w + x]);
  return median(v);
}

// How bright the cell's frame is above the grid background, from the top edge
// and the brighter of the side edges (the bottom-left holds the tier label).
// A side's value is the median along it of the brightest pixel near the edge,
// so icons poking into the band don't count as a frame.
function frameScore(lum, w, h, x0, y0, size, bg) {
  const band = Math.max(2, Math.round(size * 0.12));
  const lo = Math.round(size * 0.2), hi = Math.round(size * 0.8);
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? lum[y * w + x] : 0);
  // Thin frames sit right on the lattice line, which rounding can put a pixel
  // outside the cell, so each band starts one pixel out.
  const side = (pick) => {
    const v = [];
    for (let t = lo; t < hi; t++) {
      let m = 0;
      for (let d = -1; d < band; d++) m = Math.max(m, pick(t, d));
      v.push(m);
    }
    return median(v);
  };
  const top = side((t, d) => at(x0 + t, y0 + d));
  const right = side((t, d) => at(x0 + size - 1 - d, y0 + t));
  const left = side((t, d) => at(x0 + d, y0 + t));
  return Math.min(top, Math.max(right, left)) - bg;
}

// A fractional pitch spreads each edge over neighbouring integer lags, which
// can let a multiple of the pitch win; blurring the profile evens that out.
function blur(signal, r) {
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) for (let d = -r; d <= r; d++) out[i] += signal[i + d] ?? 0;
  return out;
}

function lattice(lum, w, h, region, fine) {
  const prof = gradientProfiles(lum, w, region);
  const minPitch = 12;
  const maxPitch = Math.max(minPitch + 1, Math.floor(Math.min(prof.cols.length, prof.rows.length) / 4));
  const px = findPitch(blur(prof.cols, 2), minPitch, maxPitch);
  const py = findPitch(blur(prof.rows, 2), minPitch, maxPitch);
  if (!px || !py || Math.abs(px - py) > Math.max(2, 0.08 * px)) throw new Error(NOT_FOUND);
  // Over the whole screenshot other UI muddies a fine fit, so the first pass
  // keeps the whole-pixel pitch.
  const fit = (sig, p) => (fine ? fitLattice(sig, p) : { pitch: p, offset: findPhase(sig, p) });
  const lx = fit(prof.cols, px), ly = fit(prof.rows, py);
  // Cells are square; the axis with more cells in view gives the better pitch.
  const pitch = prof.cols.length / lx.pitch >= prof.rows.length / ly.pitch ? lx.pitch : ly.pitch;
  const size = Math.floor(pitch);
  // Extend the lattice back to the image edge from wherever the region began.
  const startX = region.x0 + lx.offset - Math.floor((region.x0 + lx.offset) / pitch) * pitch;
  const startY = region.y0 + ly.offset - Math.floor((region.y0 + ly.offset) / pitch) * pitch;
  const xs = [], ys = [];
  for (let x = startX; x + size <= w; x += pitch) xs.push(Math.round(x));
  for (let y = startY; y + size <= h; y += pitch) ys.push(Math.round(y));
  return { size, xs, ys };
}

// Picks the block of lattice cells that make up the grid.
function findBlock(lum, w, h, { size, xs, ys }) {
  const bgs = ys.map((y) => xs.map((x) => cellMedian(lum, w, x, y, size)));
  const counts = new Map();
  for (const row of bgs) for (const v of row) { const k = Math.round(v); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const cellBg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const scores = ys.map((y) => xs.map((x) => frameScore(lum, w, h, x, y, size, cellBg)));
  // Owned cells are lit up and lose the plain background, so a bright frame
  // also marks a cell as part of the grid.
  const isCell = (r, c) => Math.abs(bgs[r][c] - cellBg) <= 3 || scores[r][c] > 60;

  // Longest vertical run of rows that are mostly grid cells.
  const rowFill = bgs.map((row, r) => row.filter((_, c) => isCell(r, c)).length);
  const minFill = Math.max(3, 0.5 * Math.max(...rowFill));
  let best = { start: 0, len: 0 };
  for (let r = 0, start = -1; r <= ys.length; r++) {
    if (r < ys.length && rowFill[r] >= minFill) { if (start < 0) start = r; continue; }
    if (start >= 0 && r - start > best.len) best = { start, len: r - start };
    start = -1;
  }
  if (best.len < 2) throw new Error(NOT_FOUND);
  const colsIn = xs.map((_, c) => {
    let n = 0;
    for (let r = best.start; r < best.start + best.len; r++) if (isCell(r, c)) n++;
    return n >= 0.6 * best.len;
  });
  const c0 = colsIn.indexOf(true), c1 = colsIn.lastIndexOf(true);
  if (c0 < 0) throw new Error(NOT_FOUND);
  return { r0: best.start, r1: best.start + best.len - 1, c0, c1, scores };
}

/**
 * Returns { pitch, header: [{x, y, size}], rows: [{ id, cells: [{x, y, size, owned, score}] }] }
 * or throws if no grid is found. Header cells are where the skill icons sit
 * (empty if the header was cropped off); row ids follow UNLOCK_ROWS from the
 * first row under the header.
 */
export function readUnlockGrid(img) {
  const { width: w, height: h } = img;
  const lum = luminance(img);
  // A first pass over the whole screenshot finds roughly where the grid is;
  // a second pass over just the grid gets the pitch without other UI in the way.
  let lat = lattice(lum, w, h, { x0: 0, y0: 0, x1: w, y1: h }, false);
  let block = findBlock(lum, w, h, lat);
  const region = {
    x0: lat.xs[block.c0], y0: lat.ys[block.r0],
    x1: Math.min(w, lat.xs[block.c1] + lat.size), y1: Math.min(h, lat.ys[block.r1] + lat.size),
  };
  lat = lattice(lum, w, h, region, true);
  block = findBlock(lum, w, h, lat);
  const { size, xs, ys } = lat;

  const headerRow = block.r0 - 1;
  const header = headerRow >= 0 ? xs.slice(block.c0, block.c1 + 1).map((x) => ({ x, y: ys[headerRow], size })) : [];
  // A grid that ends a row short of the image edge is complete, so 14 rows
  // there is a pre-Q1 screenshot; otherwise the bottom was cropped.
  const seen = block.r1 - block.r0 + 1;
  const ids = seen === LEGACY_UNLOCK_ROWS.length && block.r1 < ys.length - 1 ? LEGACY_UNLOCK_ROWS : UNLOCK_ROWS;
  const rows = [];
  for (let r = block.r0; r <= block.r1 && rows.length < ids.length; r++) {
    const cells = [];
    for (let c = block.c0; c <= block.c1; c++) cells.push({ x: xs[c], y: ys[r], size, score: block.scores[r][c] });
    rows.push({ id: ids[rows.length], cells });
  }

  // Owned frames are far brighter than anything along an unowned cell's edge;
  // split at the biggest gap in the sorted scores.
  const sorted = rows.flatMap((r) => r.cells.map((c) => c.score)).sort((a, b) => a - b);
  let cut = Infinity, gap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i] - sorted[i - 1];
    if (g > gap && sorted[i] > 40) { gap = g; cut = (sorted[i] + sorted[i - 1]) / 2; }
  }
  if (gap < 25) cut = Infinity;
  for (const row of rows) for (const cell of row.cells) cell.owned = cell.score > cut;
  return { pitch: size, header, rows };
}
