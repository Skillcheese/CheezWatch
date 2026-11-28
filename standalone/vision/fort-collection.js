// Reads the Collections → The Fortress section: which Banners, Ledgers,
// Beacons and Satchels are owned. Owned items get a thin square frame in the
// theme's accent colour (and a check mark); unowned ones are dimmed with no
// frame. So we find the frames, then name what's inside each by matching it
// against the game's own item icons. Nothing depends on resolution or on
// where the section sits in the screenshot.
import { hungarian } from "./icons.js";

const TIER_SUFFIX = { t1: "T1", t2: "T2", t3: "T3", t4: "T4", t5: "T5", c: "C6", c7: "C7" };
// Item id prefix → family name used by calc.js (satchel feeds backpack size).
const FAMILY_OF = {
  gauntlet_banner: "banner", gauntlet_ledger: "ledger",
  beacon_haste: "haste", beacon_swift: "swift", beacon_sure: "sure", beacon_bounty: "bounty", beacon_thrift: "thrift",
  satchel: "satchel", enchanted_fortification: "fortification",
};

// Every item in the Fortress collection (Enchanted Fortification has no C7).
// The ones with no family still need references, so they can't steal a match.
const ITEM_PREFIXES = [
  "gauntlet_banner", "gauntlet_ledger", "beacon_haste", "beacon_bounty", "beacon_thrift", "beacon_sure", "beacon_swift",
  "satchel", "chef_spice", "trader_notes", "corruptors_idol", "hot_sauce", "enchanted_fortification",
];
export const FORT_ITEM_IDS = ITEM_PREFIXES.flatMap((p) => Object.keys(TIER_SUFFIX).map((t) => `${p}_${t}`))
  .filter((id) => id !== "enchanted_fortification_c7");

/** Splits "beacon_haste_c7" into { family, tier } (family null for items with no stat). */
export function parseFortItem(id) {
  const m = /^(.*)_(t[1-5]|c|c7)$/.exec(id);
  if (!m) return null;
  return { family: FAMILY_OF[m[1]] ?? null, tier: TIER_SUFFIX[m[2]] };
}

const diff = (d, i, j) => Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);

// A pixel is on a thin line when it differs from the pixels a few px away on
// both sides across the line, while those two agree with each other.
function lineMaps(img, gap) {
  const { width: w, height: h, data } = img;
  const hor = new Uint8Array(w * h), ver = new Uint8Array(w * h);
  for (let y = gap; y < h - gap; y++) {
    for (let x = gap; x < w - gap; x++) {
      const i = (y * w + x) * 4;
      const u = i - gap * w * 4, dn = i + gap * w * 4, l = i - gap * 4, r = i + gap * 4;
      if (diff(data, i, u) > 60 && diff(data, i, dn) > 60 && diff(data, u, dn) < 45) hor[y * w + x] = 1;
      if (diff(data, i, l) > 60 && diff(data, i, r) > 60 && diff(data, l, r) < 45) ver[y * w + x] = 1;
    }
  }
  return { hor, ver };
}

// Horizontal runs of line pixels, allowing 1-px breaks.
function runs(map, w, h, minLen) {
  const out = [];
  for (let y = 0; y < h; y++) {
    let start = -1, miss = 0;
    for (let x = 0; x <= w; x++) {
      const on = x < w && map[y * w + x];
      if (on) { if (start < 0) start = x; miss = 0; continue; }
      if (start >= 0 && x < w && miss++ < 1) continue;
      if (start >= 0) {
        const end = x - miss;
        if (end - start >= minLen) out.push({ x0: start, x1: end, y });
        start = -1; miss = 0;
      }
    }
  }
  return out;
}

const colFill = (map, w, x, y0, y1) => {
  let n = 0;
  for (let y = y0; y < y1; y++) if (map[y * w + x - 1] || map[y * w + x] || map[y * w + x + 1]) n++;
  return n / Math.max(1, y1 - y0);
};

/** Square frames of owned items: [{ x, y, size }] (outer box). */
export function findOwnedFrames(img) {
  const { width: w, height: h } = img;
  const { hor, ver } = lineMaps(img, 2);
  const rs = runs(hor, w, h, 12);
  const boxes = [];
  // The check mark and tier label break the top and bottom edges on the left,
  // so runs are paired by their right ends and the box is measured from the
  // right side, which nothing covers.
  for (const top of rs) {
    for (const bot of rs) {
      const side = bot.y - top.y;
      if (side < 12 || Math.abs(bot.x1 - top.x1) > 2) continue;
      const len = Math.max(top.x1 - top.x0, bot.x1 - bot.x0);
      if (len < side * 0.55 || len > side + 3) continue;
      const y0 = top.y + Math.round(side * 0.15), y1 = bot.y - Math.round(side * 0.15);
      let xr = -1, best = 0;
      for (let x = Math.max(1, top.x1 - 3); x < Math.min(w - 1, top.x1 + 4); x++) {
        const f = colFill(ver, w, x, y0, y1);
        if (f > best) { best = f; xr = x; }
      }
      if (best < 0.7) continue;
      const x = xr - side;
      if (x < 0) continue;
      boxes.push({ x, y: top.y, size: side + 1 });
    }
  }
  // Doubled lines (both edges of a 2-px frame) give near-duplicate boxes.
  boxes.sort((a, b) => b.size - a.size);
  const kept = [];
  for (const b of boxes) {
    if (kept.some((k) => Math.abs(k.x - b.x) < k.size / 3 && Math.abs(k.y - b.y) < k.size / 3)) continue;
    kept.push(b);
  }
  // Frames are all one size; drop stray squares from other UI.
  if (!kept.length) return [];
  const sizes = kept.map((k) => k.size).sort((a, b) => a - b);
  const typical = sizes[sizes.length >> 1];
  return kept.filter((k) => Math.abs(k.size - typical) <= Math.max(3, typical * 0.12));
}

// Where the icon sits in its frame: a centred square this fraction of the
// frame's size. Fitted per screenshot, since it could differ between layouts.
const SCALES = Array.from({ length: 23 }, (_, i) => 0.7 + i * 0.01);

// The check mark (top-left) and tier label (bottom-left) aren't in the
// reference icons, so those corners are skipped.
const masked = (fx, fy) => (fx < 0.34 && fy < 0.34) || (fx < 0.46 && fy > 0.64);

// Cell background, from a strip just inside the frame's right edge.
export function cellBackground(img, box) {
  const v = [[], [], []];
  const x = box.x + box.size - 4;
  for (let y = box.y + Math.round(box.size * 0.2); y < box.y + box.size * 0.8; y++) {
    const i = (y * img.width + x) * 4;
    for (let k = 0; k < 3; k++) v[k].push(img.data[i + k]);
  }
  return v.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
}

// Mean colour difference between the screen cell and a reference icon drawn
// over the cell background at the given scale and shift.
function cost(img, box, bg, ref, scale, dx, dy) {
  const n = ref.width, side = box.size * scale, step = side / n;
  const ox = box.x + (box.size - side) / 2 + dx, oy = box.y + (box.size - side) / 2 + dy;
  let sum = 0, count = 0;
  for (let v = 0; v < n; v++) {
    const sy = Math.floor(oy + (v + 0.5) * step);
    const fy = (sy - box.y) / box.size;
    if (sy < 0 || sy >= img.height) continue;
    for (let u = 0; u < n; u++) {
      const sx = Math.floor(ox + (u + 0.5) * step);
      if (sx < 0 || sx >= img.width || masked((sx - box.x) / box.size, fy)) continue;
      const r = (v * n + u) * 4, a = ref.data[r + 3] / 255, i = (sy * img.width + sx) * 4;
      for (let k = 0; k < 3; k++) sum += Math.abs(img.data[i + k] - (a * ref.data[r + k] + (1 - a) * bg[k]));
      count += 3;
    }
  }
  return count ? sum / count : 255;
}

export function bestCost(img, box, bg, ref, scale) {
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) best = Math.min(best, cost(img, box, bg, ref, scale, dx, dy));
  return best;
}

// Picks the icon scale that best explains frames spread over the screenshot:
// name each sampled frame roughly at a middle scale, then tune the scale on
// those pairs only.
function fitScale(img, frames, bgs, refs) {
  const n = Math.min(frames.length, 10);
  const sample = Array.from({ length: n }, (_, k) => Math.floor((k * frames.length) / n));
  const pairs = sample.map((i) => {
    let ref = null, m = Infinity;
    for (const r of refs) {
      const c = bestCost(img, frames[i], bgs[i], r, 0.85);
      if (c < m) { m = c; ref = r; }
    }
    return { i, ref };
  });
  let best = { scale: 0.85, total: Infinity };
  for (const scale of SCALES) {
    let total = 0;
    for (const { i, ref } of pairs) total += bestCost(img, frames[i], bgs[i], ref, scale);
  }
  return best.scale;
}

/**
 * Returns { owned: { family: Set(tier) }, items: [{ id, distance, box }], warnings }.
 * `references` maps item id → decoded RGBA icon (the game's 32x32 PNGs).
 */
export function readFortCollection(img, references) {
  const warnings = [];
  const frames = findOwnedFrames(img);
  if (!frames.length) warnings.push("Didn't find any owned Fortress items. Open Collections → The Fortress and include the Milestone Rewards and Rare Drops.");
  const ids = Object.keys(references).filter((id) => references[id]);
  const refs = ids.map((id) => references[id]);
  const bgs = frames.map((b) => cellBackground(img, b));
  const scale = frames.length ? fitScale(img, frames, bgs, refs) : 0.8;
  // Each item shows once, so solve all cells together; a cell may also match
  // nothing (stray squares elsewhere in the UI).
  const costs = frames.map((b, i) => [...refs.map((ref) => bestCost(img, b, bgs[i], ref, scale)), ...frames.map(() => UNMATCHED)]);
  const pick = frames.length ? hungarian(costs) : [];
  const owned = {};
  const items = frames.map((box, i) => {
    const j = pick[i];
    const id = j < ids.length ? ids[j] : null;
    if (id) {
      const p = parseFortItem(id);
      if (p?.family) (owned[p.family] ??= new Set()).add(p.tier);
    }
    return { id, distance: j < ids.length ? costs[i][j] : null, box };
  });
  // Other screens (the Unlocks grid, say) have framed cells too, and a few of
  // them can land near some Fortress icon. Real Fortress frames nearly all
  // match closely, so a screenshot where most don't isn't this view.
  const matched = items.filter((m) => m.id).length;
  if (frames.length && matched < frames.length * 0.8) {
    throw new Error("This doesn't look like Collections → The Fortress. Open that section and screenshot its Milestone Rewards and Rare Drops.");
  }
  const unknown = frames.length - matched;
  if (unknown) warnings.push(`${unknown} framed item(s) didn't match any Fortress item.`);
  return { owned, items, scale, warnings };
}

// Real matches cost 0-2 on both samples; other UI's framed cells cost 12+.
const UNMATCHED = 10;
