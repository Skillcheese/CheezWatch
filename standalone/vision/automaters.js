// Reads the Task Automaters row under Skill Weighting: which automaters are
// owned (novice / adept / expert icons, faded when not owned) and switched on
// (an enabled group's frame is the theme's accent colour, a disabled one grey).
// The groups can be dragged into any order, so each is named by OCR of its
// small label.
import { crop } from "./image.js";

export const AUTOMATER_KINDS = ["luck", "quests", "tier", "quantity", "materials", "distance", "slay"];
const CHANCE_BY_VARIANT = [0.5, 0.75, 1];

const sat = (d, i) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Label text → automater kind, or null. */
export function kindOfLabel(text) {
  const t = (text ?? "").toLowerCase();
  if (/sla[yv]|\(s1a/.test(t)) return "slay";
  if (/ski|dist/.test(t)) return "distance";
  if (/luc/.test(t)) return "luck";
  if (/que|ues/.test(t)) return "quests";
  if (/tier|highest t/.test(t)) return "tier";
  if (/quan|tity/.test(t)) return "quantity";
  if (/mat|has/.test(t)) return "materials";
  return null;
}

/**
 * Finds the 7 group boxes in a band of the image (the row right of the
 * "Task Automaters" title). Returns [{ x0, x1, y0, y1 }] in image coords.
 */
export function findGroups(img, band) {
  const { width: w, data } = img;
  const { x0, x1, y0, y1 } = band;
  // Background: the most common colour in the band.
  const hist = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4;
    const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const k = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bg = [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];
  const off = (i) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 30;
  const cols = [];
  for (let x = x0; x < x1; x++) {
    let n = 0;
    for (let y = y0; y < y1; y++) if (off((y * w + x) * 4)) n++;
    cols.push(n);
  }
  // A group's side frame is a tall column of non-background pixels.
  const runs = [];
  let start = -1, gap = 0;
  for (let c = 0; c <= cols.length; c++) {
    const on = c < cols.length && cols[c] > 0;
    if (on) { if (start < 0) start = c; gap = 0; continue; }
    if (start >= 0 && ++gap > 3) { runs.push([start, c - gap + 1]); start = -1; gap = 0; }
  }
  // Groups share one width; whatever lies past the panel (the game world in
  // a full-window screenshot) is wider or narrower and is dropped.
  const wide = runs.filter(([a, b]) => b - a >= (y1 - y0) * 1.2);
  const widths = wide.map(([a, b]) => b - a).sort((p, q) => p - q);
  const typical = widths[widths.length >> 1] ?? 0;
  const groups = [];
  for (let [a, b] of wide) {
    // The last group can touch the panel's edge and run into what's past it.
    if (b - a > typical * 1.25) b = a + typical;
    if (Math.abs(b - a - typical) > typical * 0.25) continue;
    // Top and bottom: the frame's horizontal lines, the rows that are
    // mostly non-background across the group.
    const rows = [];
    for (let y = y0; y < y1; y++) {
      let n = 0, m = 0;
      for (let x = x0 + a + 4; x < x0 + b - 4; x++, m++) if (off((y * w + x) * 4)) n++;
      if (n > m * 0.6) rows.push(y);
    }
    if (rows.length < 2) continue;
    groups.push({ x0: x0 + a, x1: x0 + b, y0: rows[0], y1: rows[rows.length - 1] + 1 });
  }
  return groups;
}

// Mean saturation along a group's top frame line.
export function frameSat(img, g) {
  const { width: w, data } = img;
  let best = 0;
  for (let y = g.y0; y < g.y0 + 3; y++) {
    let s = 0, n = 0;
    for (let x = g.x0 + Math.round((g.x1 - g.x0) * 0.1); x < g.x1 - Math.round((g.x1 - g.x0) * 0.1); x++) { s += sat(data, (y * w + x) * 4); n++; }
    best = Math.max(best, s / n);
  }
  return best;
}

// Per icon slot (lower part of the group), how far its strongest pixels are
// from the group's background. A variant not owned is drawn faded, so even
// its dark outlines stay close to the background.
export function slotFrames(img, g) {
  const { width: w, data } = img;
  const h = g.y1 - g.y0, top = g.y0 + Math.round(h * 0.4), bottom = g.y1 - Math.round(h * 0.1);
  const inner = (g.x1 - g.x0) * 0.9, left = g.x0 + (g.x1 - g.x0) * 0.05, sw = inner / 3;
  const hist = new Map();
  for (let y = top; y < bottom; y++) for (let x = Math.round(left); x < left + inner; x++) {
    const i = (y * w + x) * 4;
    const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const k = [...hist.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 0;
  const bg = [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];
  const out = [];
  for (let s = 0; s < 3; s++) {
    const a = Math.round(left + s * sw + sw * 0.2), b = Math.round(left + (s + 1) * sw - sw * 0.2);
    const d = [];
    for (let y = top + 2; y < bottom - 2; y++) for (let x = a; x < b; x++) {
      const i = (y * w + x) * 4;
      d.push(Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]));
    }
    d.sort((p, q) => p - q);
    out.push(d[Math.floor(d.length * 0.98)] ?? 0);
  }
  return out;
}

/**
 * `wordsAfter`: the "Automaters" word box (image coords). `readLabel(img)`
 * OCRs one label crop. Returns { kind: { owned: 0-3, enabled, chance } } in
 * the on-screen (priority) order, plus warnings.
 */
export async function readAutomaters(img, title, readLabel) {
  const th = title.y1 - title.y0;
  const band = {
    x0: Math.round(title.x1 + th * 0.5), x1: img.width - 2,
    y0: Math.max(0, Math.round(title.y0 - th * 0.9)), y1: Math.min(img.height, Math.round(title.y1 + th * 0.9)),
  };
  const groups = findGroups(img, band);
  const warnings = [];
  if (groups.length !== 7) warnings.push(`Found ${groups.length} automater groups instead of 7.`);
  const sats = groups.map((g) => frameSat(img, g));
  const contrasts = groups.map((g) => slotFrames(img, g));
  const topSat = Math.max(...sats), topContrast = Math.max(...contrasts.flat());
  const result = {};
  const order = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const labelImg = crop(img, g.x0 + 2, g.y0 + 2, g.x1 - g.x0 - 4, Math.round((g.y1 - g.y0) * 0.36));
    let kind = kindOfLabel(await readLabel(labelImg));
    if (!kind || result[kind]) kind = null;
    const owned = contrasts[i].map((c) => c > topContrast * 0.42);
    const last = owned.lastIndexOf(true);
    const entry = { owned: owned.filter(Boolean).length, enabled: sats[i] > topSat * 0.55, chance: last >= 0 ? CHANCE_BY_VARIANT[last] : 0 };
    order.push({ kind, ...entry });
  }
  // One unreadable label can be named by elimination.
  const missing = AUTOMATER_KINDS.filter((k) => !order.some((o) => o.kind === k));
  const unnamed = order.filter((o) => !o.kind);
  if (unnamed.length === 1 && missing.length === 1) unnamed[0].kind = missing[0];
  for (const o of order) {
    if (o.kind) result[o.kind] = { owned: o.owned, enabled: o.enabled, chance: o.enabled ? o.chance : 0 };
    else warnings.push("Couldn't read an automater's label.");
  }
  return { automaters: result, order: order.map((o) => o.kind), warnings };
}
