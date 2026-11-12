// Recognises skill icons at any size by comparing small colour fingerprints.
// Reference icons are the game's own PNGs (see scripts/extract-icons.js).

const GRID = 10;

// Bounding box of pixels that stand out from the background.
function foregroundBox(img, isFg) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!isFg(x, y)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// Average colour and coverage of the foreground in each cell of a GRID x GRID
// split of the box, with colours scaled to a common brightness so dimmed and
// bright copies of an icon still match.
function fingerprint(img, box, isFg) {
  const cells = new Float64Array(GRID * GRID * 4);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      if (!isFg(x, y)) continue;
      const c = (Math.min(GRID - 1, Math.floor(((y - box.y0) / bh) * GRID)) * GRID
        + Math.min(GRID - 1, Math.floor(((x - box.x0) / bw) * GRID))) * 4;
      const i = (y * img.width + x) * 4;
      cells[c] += img.data[i]; cells[c + 1] += img.data[i + 1]; cells[c + 2] += img.data[i + 2]; cells[c + 3]++;
    }
  }
  let total = 0, n = 0;
  for (let c = 0; c < cells.length; c += 4) {
    if (!cells[c + 3]) continue;
    for (let k = 0; k < 3; k++) cells[c + k] /= cells[c + 3];
    total += cells[c] + cells[c + 1] + cells[c + 2]; n += 3;
  }
  const scale = n ? 128 / (total / n) : 1;
  const area = (bw * bh) / (GRID * GRID);
  for (let c = 0; c < cells.length; c += 4) {
    for (let k = 0; k < 3; k++) cells[c + k] *= scale;
    cells[c + 3] /= area;
  }
  return { cells, aspect: bw / bh };
}

function distance(a, b) {
  let d = 0;
  for (let c = 0; c < a.cells.length; c += 4) {
    const cov = Math.abs(a.cells[c + 3] - b.cells[c + 3]);
    const both = Math.min(a.cells[c + 3], b.cells[c + 3]);
    let col = 0;
    for (let k = 0; k < 3; k++) col += Math.abs(a.cells[c + k] - b.cells[c + k]);
    d += cov * 120 + both * col / 3;
  }
  return d / (GRID * GRID) + Math.abs(Math.log(a.aspect / b.aspect)) * 40;
}

/** Fingerprint of a reference icon PNG (decoded RGBA, transparent background). */
export function referenceFingerprint(img) {
  const isFg = (x, y) => img.data[(y * img.width + x) * 4 + 3] > 128;
  const box = foregroundBox(img, isFg);
  return box ? fingerprint(img, box, isFg) : null;
}

/**
 * Fingerprint of an icon in a screenshot crop. Pixels count as icon when they
 * differ enough from the crop's background, taken from its border.
 */
export function screenFingerprint(img) {
  const { width: w, height: h, data } = img;
  const border = [];
  for (let x = 0; x < w; x++) border.push((0 * w + x) * 4, ((h - 1) * w + x) * 4);
  for (let y = 0; y < h; y++) border.push((y * w) * 4, (y * w + w - 1) * 4);
  // Median border colour is the background.
  const bg = [0, 1, 2].map((k) => {
    const v = border.map((i) => data[i + k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const isFg = (x, y) => {
    const i = (y * w + x) * 4;
    return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60;
  };
  const box = foregroundBox(img, isFg);
  return box && box.x1 - box.x0 > 3 && box.y1 - box.y0 > 3 ? fingerprint(img, box, isFg) : null;
}

// Minimum-cost assignment of rows to columns (Hungarian algorithm, rows <=
// columns). Returns the column index for each row.
export function hungarian(cost) {
  const n = cost.length, m = cost[0].length;
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(Infinity), used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Array(n);
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
  return out;
}

/**
 * Matches many screen icons to references at once, each reference used at
 * most once, minimising the total distance. A dim icon that's a poor match on
 * its own still lands on the only skill left for it, and two similar icons
 * can't both grab the same closest reference. Any icon may instead match
 * nothing at `unmatchedCost` (an extra column or a blank cell). Returns
 * { id, distance } (id null when unmatched) per fp.
 */
export function assignIcons(fps, refs, unmatchedCost = 90) {
  const ids = Object.keys(refs).filter((id) => refs[id]);
  // One "nothing" column per icon, so every icon can opt out.
  const cost = fps.map((fp) => [
    ...ids.map((id) => (fp ? distance(fp, refs[id]) : 1e6)),
    ...fps.map(() => (fp ? unmatchedCost : 0)),
  ]);
  if (!fps.length) return [];
  return hungarian(cost).map((j, i) => (j < ids.length ? { id: ids[j], distance: cost[i][j] } : { id: null, distance: null }));
}

/** Best matching reference id and its distance, from { id: fingerprint }. */
export function matchIcon(fp, refs) {
  let best = { id: null, distance: Infinity, second: Infinity };
  if (!fp) return best;
  for (const [id, ref] of Object.entries(refs)) {
    if (!ref) continue;
    const d = distance(fp, ref);
    if (d < best.distance) best = { id, distance: d, second: best.distance };
    else if (d < best.second) best.second = d;
  }
  return best;
}
