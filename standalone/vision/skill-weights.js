// Reads the Skills Customization screen's Skill Weighting panel: each skill's
// level and its weight (lever). The set weight is the one pip drawn in a red
// (negative) or green (positive) box; a skill with neither is at 0. Words
// come from OCR with their boxes, the coloured pips from the pixels, and a
// pip belongs to the nearest skill name on its left in the same row.
import { binarize } from "./collections.js";
import { crop } from "./image.js";

export const WEIGHTS_OCR_PARAMS = { tessedit_pageseg_mode: "11" };
export const WEIGHT_SKILLS = [
  "fish", "cook", "mine", "smith", "forage", "craft", "invoke", "imbue", "farm", "brew",
  "plunder", "barter", "bard", "discover", "vigor", "luck", "quests",
];
const ALL_SKILLS = [
  "life", "spirit", "strike", "heft", "sight", "draw", "focus", "surge", "dodge", "defend",
  "slay", "vigor", "delve", "fortify", "luck", "alms", ...WEIGHT_SKILLS.slice(0, 14), "quests",
];
const SCALE = 2;
const GAP = 2;

// OCR confuses these in the game font's level numbers.
const DIGIT_FIX = { B: "8", S: "5", O: "0", o: "0", I: "1", l: "1", "|": "1", Z: "2", G: "6", g: "9", T: "7" };
export function parseLevel(text) {
  const m = /^[LI1l][vVwW]([0-9BSOoIlZGgT|]{1,3})$/.exec(text.trim());
  if (!m) return null;
  const n = Number([...m[1]].map((c) => DIGIT_FIX[c] ?? c).join(""));
  return n >= 1 && n <= 120 ? n : null;
}

export function parsePercent(text) {
  const m = /^(\d{1,2})(?:[.,](\d))?[%]$/.exec(text.trim().replace(/[°o]/g, "%"));
  return m ? Number(`${m[1]}.${m[2] ?? 0}`) : null;
}

const skillOf = (text) => {
  const t = text.toLowerCase().replace(/[^a-z]/g, "");
  if (t.length < 3) return null;
  return ALL_SKILLS.find((s) => t === s || (t.length >= 4 && (s.startsWith(t) || t.endsWith(s)))) ?? null;
};

// Pixels of the pip boxes: saturated red or green.
const isRed = (r, g, b) => r > 150 && g < 90 && b < 90 && r - g > 90;
const isGreen = (r, g, b) => g > 105 && g - r > 45 && g - b > 35;

/** Coloured blobs as { x0, y0, x1, y1, colour, mask } (connected components). */
export function colouredBoxes(img) {
  const { width: w, height: h, data } = img;
  const kind = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    kind[i] = isRed(r, g, b) ? 1 : isGreen(r, g, b) ? 2 : 0;
  }
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!kind[start] || seen[start]) continue;
    const k = kind[start];
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      // Frames are 1px lines with dim corners, so pixels up to 2px apart join.
      for (let dy = -GAP; dy <= GAP; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -GAP; dx <= GAP; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (seen[j] || kind[j] !== k) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, n, colour: k === 1 ? "red" : "green" });
  }
  // A pip is a hollow frame, about square, its digit (same colour) inside.
  return out.filter((b) => {
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    return bh >= h * 0.015 && bh <= h * 0.08 && bw >= bh * 0.6 && bw <= bh * 2.2 && b.n < bw * bh * 0.6;
  });
}

/** Black-on-white image of one pip's digits, for OCR. */
export function pipImage(img, f) {
  const pad = 4;
  const w = f.x1 - f.x0, h = f.y1 - f.y0;
  const inset = Math.max(2, Math.round(h * 0.15));
  const part = crop(img, f.x0 + inset, f.y0 + inset, w - 2 * inset, h - 2 * inset);
  const W = part.width + 2 * pad, H = part.height + 2 * pad;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const test = f.colour === "red" ? isRed : isGreen;
  for (let y = 0; y < part.height; y++) {
    for (let x = 0; x < part.width; x++) {
      const i = (y * part.width + x) * 4;
      // Anti-aliased digits are dimmer; a looser test keeps their strokes.
      const r = part.data[i], g = part.data[i + 1], b = part.data[i + 2];
      const on = test(r, g, b) || (f.colour === "red" ? r > 110 && r - g > 50 : g > 100 && g - r > 30);
      if (on) { const o = ((y + pad) * W + x + pad) * 4; data[o] = data[o + 1] = data[o + 2] = 0; }
    }
  }
  return { width: W, height: H, data };
}

/** The digit OCR read inside a pip, as a signed lever, or null. */
export function parsePip(text, colour) {
  const m = /([1-5])/.exec((text ?? "").replace(/[Il|]/g, "1").replace(/S/g, "5"));
  if (!m) return null;
  return (colour === "red" ? -1 : 1) * Number(m[1]);
}

/**
 * `recognize(image) → Promise<{ words: [{ text, bbox: { x0, y0, x1, y1 } }] }>`
 * OCRs a whole binarized image; `readDigit(image) → Promise<text>` one pip.
 * Returns { levels, levers, percent, found, warnings }.
 */
export async function readSkillWeights(img, recognize, readDigit) {
  const { words } = await recognize(binarize(img, SCALE, 0.3));
  const scaled = words.map((wd) => ({ text: wd.text, x0: wd.bbox.x0 / SCALE, y0: wd.bbox.y0 / SCALE, x1: wd.bbox.x1 / SCALE, y1: wd.bbox.y1 / SCALE }));
  const names = [];
  for (const wd of scaled) {
    const skill = skillOf(wd.text);
    if (skill && !names.some((n) => n.skill === skill)) names.push({ ...wd, skill });
  }
  const sameRow = (a, b) => Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < Math.max(a.y1 - a.y0, b.y1 - b.y0) * 0.8;
  const levels = {}, percent = {};
  for (const n of names) {
    // The level is the nearest "LvNN" to the left of the name.
    const lv = scaled.filter((wd) => wd.x1 <= n.x0 + 2 && n.x0 - wd.x1 < (n.y1 - n.y0) * 4 && sameRow(wd, n) && parseLevel(wd.text) != null)
      .sort((a, b) => b.x1 - a.x1)[0];
    if (lv) levels[n.skill] = parseLevel(lv.text);
    const pc = scaled.filter((wd) => wd.x0 >= n.x1 && sameRow(wd, n) && parsePercent(wd.text) != null)
      .sort((a, b) => a.x0 - b.x0)[0];
    if (pc && pc.x0 - n.x1 < img.width * 0.12) percent[n.skill] = parsePercent(pc.text);
  }
  // Luck's percent is its task chance, shown with a decimal and capped at 5%;
  // OCR often drops the point ("40%").
  if (percent.luck >= 10) percent.luck /= 10;
  const levers = {};
  const warnings = [];
  const frames = colouredBoxes(img);
  // Each skill takes the nearest pip on its right; anything further along
  // the row (the next column's green or red icons) isn't its weight.
  const pips = new Map();
  for (const f of frames) {
    const owner = names.filter((n) => n.x1 <= f.x0 && sameRow({ y0: f.y0, y1: f.y1 }, n)).sort((a, b) => b.x1 - a.x1)[0];
    if (!owner || !WEIGHT_SKILLS.includes(owner.skill) || f.x0 - owner.x1 > img.width * 0.15) continue;
    if (!pips.has(owner) || f.x0 < pips.get(owner).x0) pips.set(owner, f);
  }
  for (const [owner, f] of pips) {
    const value = parsePip(await readDigit(pipImage(img, f)), f.colour);
    if (value == null) warnings.push(`Couldn't read ${owner.skill}'s weight.`);
    else levers[owner.skill] = value;
  }
  // "Skill Credits: 1/2376": the lever budget is the second number.
  const credits = scaled.map((wd) => /^(\d{1,5})\/(\d{3,5})$/.exec(wd.text)).find(Boolean);
  const found = names.filter((n) => WEIGHT_SKILLS.includes(n.skill)).map((n) => n.skill);
  for (const s of found) levers[s] ??= 0;
  const missing = WEIGHT_SKILLS.filter((s) => !found.includes(s));
  if (missing.length) warnings.push(`Not found: ${missing.join(", ")}.`);
  return { levels, levers, percent, found, warnings, credits: credits ? { free: Number(credits[1]), total: Number(credits[2]) } : null };
}
