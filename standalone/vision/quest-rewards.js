// Reads which Globes of Skills the Perks screenshot shows as owned, from the
// Quest Rewards row. Owned rewards get the same thin frame as owned Fortress
// items and unowned ones are dimmed, so we look for framed cells that hold a
// Globe icon. Whether the row is in the screenshot at all comes from the
// page's OCR text (see readPerks), since "no framed Globe" alone can't tell
// "not owned" from "scrolled out of view".
import { bestCost, cellBackground, findOwnedFrames } from "./fort-collection.js";

export const GLOBE_IDS = ["globe_of_skills_t1", "globe_of_skills_t2"];

// Real icon matches cost 0-2; every other framed cell on the sample screens
// costs 33 or more.
const MATCH = 12;
const SCALES = [0.8, 0.85, 0.9];

/** "none" | "t1" | "t2" | "both", from `references` (id → decoded RGBA icon). */
export function readGlobes(img, references) {
  const owned = new Set();
  for (const box of findOwnedFrames(img)) {
    const bg = cellBackground(img, box);
    let best = { id: null, cost: Infinity };
    for (const id of GLOBE_IDS) {
      if (!references[id]) continue;
      for (const s of SCALES) {
        const c = bestCost(img, box, bg, references[id], s);
        if (c < best.cost) best = { id, cost: c };
      }
    }
    if (best.cost <= MATCH) owned.add(best.id);
  }
  if (owned.size === 2) return "both";
  if (owned.has("globe_of_skills_t1")) return "t1";
  if (owned.has("globe_of_skills_t2")) return "t2";
  return "none";
}
