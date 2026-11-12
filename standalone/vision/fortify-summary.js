// Reads the stat summary in the Fortify Tree's top-left corner ("+2.75%
// movement speed", "-0.6s action time", ...). Allocated lines are drawn in the
// theme's accent colour and zero lines are dimmed grey, so only accent lines
// are found and read; anything not found counts as 0. The block is found as a
// stack of evenly spaced accent text lines sharing one left edge, which keeps
// it independent of resolution and crop. See docs/fortify-tree.md.
import { crop } from "./image.js";
import { binarize } from "./collections.js";

export const FORTIFY_OCR_PARAMS = {
  tessedit_char_whitelist: "0123456789.+-%s()xXabcdefghiklmnoprstuvwyABDFGHIMPSX ",
  tessedit_pageseg_mode: "7",
};

// Summary keyword → effect key and the cluster's max total (raid-trees.json).
const CLUSTERS = [
  { key: "moveSpeedPct", re: /mov/i, max: 7 },
  { key: "successPct", re: /succ/i, max: 7 },
  { key: "saveMaterialPct", re: /save|mater/i, max: 6.75 },
  { key: "doubleGatherPct", re: /doub|gath/i, max: 18 },
  { key: "fortifyXpPct", re: /fort/i, max: 10 },
  { key: "skillingXpPct", re: /skilling/i, max: 5 },
  { key: "actionTimeSec", re: /act|time/i, max: 1 },
  { key: "globalXpPct", re: /all|\(/i, max: 13.25 },
  { key: "foodHeal", re: /food|HP/, max: 12 },
];
export const TALENT_KEYS = CLUSTERS.map((c) => c.key);
const ATTEMPTS = [[5, 0.45], [4, 0.5], [6, 0.4], [3, 0.5]];

function accentMask(img, x1, y1) {
  const { width: w, data } = img, mask = new Uint8Array(x1 * y1);
  for (let y = 0; y < y1; y++) {
    for (let x = 0; x < x1; x++) {
      const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      if (hi > 130 && hi - lo > 70) mask[y * x1 + x] = 1;
    }
  }
  return mask;
}

/** Candidate text lines { x0, x1, y0, y1 } of accent pixels in the upper-left area. */
export function accentLines(img) {
  const W = Math.round(img.width * 0.3), H = Math.round(img.height * 0.5);
  const mask = accentMask(img, W, H);
  const rows = [];
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) n += mask[y * W + x];
    rows.push(n);
  }
  // Bands of rows with accent pixels. Descenders can bridge two summary
  // lines, so each band is split again at a fraction of its own peak.
  const bands = [];
  const scan = (from, to, cut, out) => {
    for (let y = from; y < to; y++) {
      if (rows[y] < cut) continue;
      const y0 = y;
      while (y < to && rows[y] >= cut) y++;
      out.push([y0, y]);
    }
  };
  const coarse = [];
  scan(0, H, 2, coarse);
  for (const [a, b] of coarse) {
    const peak = Math.max(...rows.slice(a, b));
    scan(a, b, Math.max(2, peak * 0.35), bands);
  }
  const lines = [];
  for (const [y0, y1] of bands) {
    const h = y1 - y0;
    if (h < 4 || h > img.height * 0.015) continue;
    // Columns hit in this band, merged into segments across glyph gaps.
    const cols = new Uint8Array(W);
    for (let yy = y0; yy < y1; yy++) for (let x = 0; x < W; x++) if (mask[yy * W + x]) cols[x] = 1;
    let best = null;
    for (let x = 0; x < W; x++) {
      if (!cols[x]) continue;
      let end = x, gap = 0, n = 0;
      for (let xx = x; xx < W && gap <= h; xx++) {
        if (cols[xx]) { end = xx; gap = 0; n++; } else gap++;
      }
      if (!best || n > best.n) best = { x0: x, x1: end + 1, n };
      x = end + 1;
    }
    if (best && best.x1 - best.x0 > 5 * h) lines.push({ x0: best.x0, x1: best.x1, y0, y1 });
  }
  return lines;
}

/** The summary's accent lines, top to bottom, or [] if no such block. */
export function findSummaryLines(img) {
  const lines = accentLines(img);
  let best = [];
  for (const seed of lines) {
    const tol = Math.max(2, (seed.y1 - seed.y0) * 0.5);
    const group = lines.filter((l) => Math.abs(l.x0 - seed.x0) <= tol);
    // Keep only the run of evenly spaced lines that contains the seed.
    const i = group.indexOf(seed);
    const pitch = Math.min(...[group[i + 1]?.y1 - seed.y1, seed.y1 - group[i - 1]?.y1].filter((d) => d > 0));
    // Summary lines sit tightly stacked; rows of other UI are spaced wider.
    if (!Number.isFinite(pitch) || pitch > 3.5 * (seed.y1 - seed.y0)) continue;
    const run = [seed];
    for (let k = i + 1; k < group.length && Math.abs(group[k].y1 - run.at(-1).y1 - pitch) <= 3; k++) run.push(group[k]);
    for (let k = i - 1; k >= 0 && Math.abs(run[0].y1 - group[k].y1 - pitch) <= 3; k--) run.unshift(group[k]);
    if (run.length > best.length) best = run;
  }
  return best.length >= 3 ? best : [];
}

/** "+2.75% movement speed" → { key, value } or null. */
export function parseSummaryLine(text) {
  const m = /([+-])\s*(\d+(?:\.\d+)?)\s*(%|s)?\s*(.*)/.exec((text ?? "").replace(/\s+/g, " ").trim());
  if (!m) return null;
  const cluster = CLUSTERS.find((c) => c.re.test(m[4]));
  if (!cluster) return null;
  let digits = m[2];
  // The "s" of "-0.6s" is often read as 8 or 5.
  if (cluster.key === "actionTimeSec" && !m[3] && /\.\d*[85]$/.test(digits)) digits = digits.slice(0, -1);
  let value = Number(digits);
  // OCR sometimes drops the decimal point ("275%" for 2.75%).
  if (value > cluster.max && /^\d{2,}$/.test(digits)) value = Number(`${digits[0]}.${digits.slice(1)}`);
  if (value > cluster.max) return null;
  if (cluster.key === "actionTimeSec") value = -value;
  return { key: cluster.key, value };
}

/**
 * `recognize(imageData) → Promise<text>` runs the OCR (set FORTIFY_OCR_PARAMS
 * on it). Returns { talents: { key: value }, lines, unread } where talents has
 * every TALENT_KEYS entry (0 when not shown) and unread counts lines that
 * no reading could make sense of.
 */
export async function readFortifySummary(img, recognize) {
  const lines = findSummaryLines(img);
  if (!lines.length) throw new Error("Couldn't find the Fortify Tree stat summary in this screenshot.");
  const talents = Object.fromEntries(TALENT_KEYS.map((k) => [k, 0]));
  const texts = [];
  let unread = 0;
  for (const l of lines) {
    const h = l.y1 - l.y0, pad = Math.ceil(h * 0.6);
    const x = Math.max(0, l.x0 - pad), y = Math.max(0, l.y0 - pad);
    const part = crop(img, x, y, Math.min(img.width - x, l.x1 - l.x0 + 2 * pad), Math.min(img.height - y, h + 2 * pad));
    const votes = new Map();
    let text = "";
    for (const [scale, level] of ATTEMPTS) {
      const t = await recognize(binarize(part, scale, level));
      const got = parseSummaryLine(t);
      if (!got) continue;
      text ||= t.trim();
      const k = `${got.key}=${got.value}`;
      const v = votes.get(k) ?? { got, n: 0 };
      v.n++;
      votes.set(k, v);
      if (v.n >= 2) break;
    }
    const best = [...votes.values()].sort((a, b) => b.n - a.n)[0];
    if (best) talents[best.got.key] = best.got.value;
    else unread++;
    texts.push(text);
  }
  return { talents, lines: texts, unread };
}
