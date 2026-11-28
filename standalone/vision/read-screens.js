// Reads the two screenshots the import needs: the Skills panel (levels) and
// the Unlocks page (owned cells per skill). Works on ImageData-like objects,
// so the same code runs in the page and in node tests.
import { crop } from "./image.js";
import { assignIcons, referenceFingerprint, screenFingerprint } from "./icons.js";
import { findSkillPanel, splitBox } from "./skills-panel.js";
import { fixWithTotal, readNumber } from "./digits.js";
import { LEGACY_UNLOCK_ROWS, readUnlockGrid, UNLOCK_ROWS } from "./unlock-grid.js";

// Header order on the Unlocks page; "levels" is the all-skills column.
export const SKILLS = [
  "life", "spirit", "strike", "heft", "sight", "draw", "focus", "surge", "dodge", "defend",
  "slay", "vigor", "delve", "fortify", "luck", "alms", "fish", "cook", "mine", "smith",
  "forage", "craft", "invoke", "imbue", "farm", "brew", "plunder", "barter", "bard", "discover",
];
export const ICON_IDS = ["levels", ...SKILLS];

/** { id: fingerprint } from { id: decoded icon image }. */
export function iconReferences(images) {
  const refs = {};
  for (const id of ICON_IDS) if (images[id]) refs[id] = referenceFingerprint(images[id]);
  return refs;
}

/**
 * Skills panel → { levels: { skill: n }, total, checksum, warnings }.
 * `checksum` is "ok" when the levels add up to the total box, "fixed" when a
 * near-tie digit had to be changed to make them add up, or "mismatch".
 */
export function readSkillsPanel(img, refs, templates) {
  const boxes = findSkillPanel(img);
  if (boxes.length < 10) throw new Error("Couldn't find the skill boxes in this screenshot.");
  const parts = boxes.map((b) => splitBox(img, b));
  const ids = assignIcons(parts.map((p) => screenFingerprint(p.icon)), refs);
  const readings = parts.map((p) => readNumber(p.number, templates));
  const warnings = [];
  const skillIdx = [];
  let totalIdx = -1;
  ids.forEach((m, i) => {
    if (m.id === "levels") totalIdx = i;
    else if (m.id) skillIdx.push(i);
  });
  const missing = SKILLS.filter((s) => !ids.some((m) => m.id === s));
  if (missing.length) warnings.push(`No box found for: ${missing.join(", ")}.`);

  let values = skillIdx.map((i) => readings[i].value);
  const total = totalIdx >= 0 ? readings[totalIdx].value : null;
  let checksum = "mismatch";
  if (total == null) {
    warnings.push("Couldn't read the total level, so the levels weren't cross-checked.");
  } else if (values.reduce((a, v) => a + (v ?? 0), 0) === total) {
    checksum = "ok";
  } else {
    const fixed = fixWithTotal(skillIdx.map((i) => readings[i]), total);
    if (fixed) { values = fixed; checksum = "fixed"; }
    else warnings.push(`Levels add up to ${values.reduce((a, v) => a + (v ?? 0), 0)}, not the total ${total}. Check them below.`);
  }
  const levels = {};
  skillIdx.forEach((i, k) => {
    const v = values[k];
    if (v == null || v < 1 || v > 99) warnings.push(`Unreadable level for ${ids[i].id}.`);
    else levels[ids[i].id] = v;
  });
  return { levels, total, checksum, warnings };
}

/**
 * Unlocks page → { owned: { skill: Set(row ids) }, columns, warnings }.
 * The all-skills column is under "levels". `columns` is the skill id per grid
 * column (null where no icon matched), for display.
 */
export function readUnlocksPage(img, refs) {
  const grid = readUnlockGrid(img);
  const warnings = [];
  if (!grid.header.length) throw new Error("The skill icons above the unlocks grid are cut off. Include them in the screenshot.");
  const inset = Math.max(1, Math.round(grid.pitch * 0.06));
  const fps = grid.header.map((c) => screenFingerprint(crop(img, c.x + inset, c.y + inset, c.size - 2 * inset, c.size - 2 * inset)));
  const columns = assignIcons(fps, refs).map((m) => m.id);
  const owned = {};
  columns.forEach((id, c) => {
    if (!id) return;
    owned[id] = new Set(grid.rows.filter((r) => r.cells[c]?.owned).map((r) => r.id));
  });
  const missing = ICON_IDS.filter((s) => !owned[s]);
  if (missing.length) warnings.push(`No column found for: ${missing.join(", ")}.`);
  const full = grid.rows.some((r) => r.id === "Q1") ? UNLOCK_ROWS.length : LEGACY_UNLOCK_ROWS.length;
  if (grid.rows.length < full) warnings.push(`Only ${grid.rows.length} of ${full} unlock rows are visible; the rest count as not owned.`);
  return { owned, columns, rows: grid.rows.map((r) => r.id), collectionsRect: collectionsRect(img, grid), warnings };
}

/**
 * Where the "Collections N/M" label should be: the band above the grid's
 * section title, right half of the grid. Scaled by the grid pitch so it holds
 * at any resolution; null if the screenshot was cropped below it.
 */
export function collectionsRect(img, grid) {
  const p = grid.pitch, top = grid.header[0]?.y;
  if (top == null) return null;
  const first = grid.header[0].x, last = grid.header[grid.header.length - 1].x + p;
  const x = Math.round((first + last) / 2), y = Math.max(0, Math.round(top - 2.8 * p));
  const y1 = Math.round(top - 1.2 * p);
  const w = Math.min(img.width, Math.round(last + 2 * p)) - x;
  return y1 - y < p * 0.4 || w <= 0 ? null : { x, y, w, h: y1 - y };
}
