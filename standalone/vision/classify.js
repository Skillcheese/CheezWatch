// Tells which import screenshot an image is, so a whole folder can be read
// without saying which file is which. Each screen is recognised by its own
// icons: skill icons in the Skills panel's boxes, skill icons heading the
// Unlocks grid, Fortress items in framed cells, the Fortify Tree's accent
// summary. Perks has no cheap tell beyond lots of framed cells, so it comes
// back as a candidate that only OCR (readPerks) can confirm.
import { crop } from "./image.js";
import { assignIcons, screenFingerprint } from "./icons.js";
import { findSkillPanel, splitBox } from "./skills-panel.js";
import { readUnlockGrid } from "./unlock-grid.js";
import { findOwnedFrames, readFortCollection } from "./fort-collection.js";
import { findSummaryLines } from "./fortify-summary.js";

export const KINDS = ["unlocks", "skills", "fortress", "fortify", "perks"];

// Real Skills panels match their icons at about 45-51; the Unlocks grid's
// boxes, the closest impostor, sit at 70.
const SKILL_BOX_DISTANCE = 60;

function looksLikeSkills(img, refs) {
  const boxes = findSkillPanel(img);
  if (boxes.length < 25) return false;
  const ids = assignIcons(boxes.map((b) => screenFingerprint(splitBox(img, b).icon)), refs).filter((m) => m.id);
  return ids.length >= 25 && ids.reduce((a, m) => a + m.distance, 0) / ids.length < SKILL_BOX_DISTANCE;
}

function looksLikeUnlocks(img, refs) {
  let grid;
  try { grid = readUnlockGrid(img); } catch { return false; }
  if (grid.header.length < 20) return false;
  const inset = Math.max(1, Math.round(grid.pitch * 0.06));
  const fps = grid.header.map((c) => screenFingerprint(crop(img, c.x + inset, c.y + inset, c.size - 2 * inset, c.size - 2 * inset)));
  return assignIcons(fps, refs).filter((m) => m.id).length >= 20;
}

/**
 * Returns { kind, confirmed } or null. `confirmed` is false only for "perks",
 * which the caller must still check by reading it. `refs` are the skill icon
 * fingerprints (iconReferences), `fortRefs` the decoded Fortress item icons.
 */
export function classifyScreenshot(img, refs, fortRefs) {
  if (looksLikeSkills(img, refs)) return { kind: "skills", confirmed: true };
  if (looksLikeUnlocks(img, refs)) return { kind: "unlocks", confirmed: true };
  if (findSummaryLines(img).length) return { kind: "fortify", confirmed: true };
  const frames = findOwnedFrames(img).length;
  if (frames >= 3) {
    try {
      readFortCollection(img, fortRefs);
      return { kind: "fortress", confirmed: true };
    } catch {}
  }
  // Telescopes, compasses, automaters: the Perks section is full of frames.
  if (frames >= 10) return { kind: "perks", confirmed: false };
  return null;
}
