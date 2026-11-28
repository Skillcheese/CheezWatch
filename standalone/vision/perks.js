// Reads the Unlocks page's Perks section, specifically its "Total Movement
// Speed" line:
//   Total Movement Speed +168% (26.8 steps/sec) (Vigor lvl 69 (effective 81)
//   base, +9.5% telescopes, +1% compasses (2/11), +1.5% swift beacons, +5%
//   fortress milestones, +4.7% collector, +3% fleet foot)
// It lists every movement source the game counts, telescopes and compasses
// included, so the whole page is OCRed and that line parsed. The bracketed
// part is drawn dim, so thresholds sit low. A reading is trusted once its
// parts add up to the steps/sec it shows.
import { binarize } from "./collections.js";
import { vigorBaseSpeed } from "../lib/lab-profile.js";

export const PERKS_OCR_PARAMS = { tessedit_pageseg_mode: "3" };
// [upscale, threshold]; see binarize.
const ATTEMPTS = [[2, 0.25], [2, 0.15], [3, 0.2], [2, 0.35]];

const SOURCES = {
  telescopes: /telesc/i,
  compasses: /compas/i,
  swiftBeacons: /beac/i,
  milestones: /miles|fortress/i,
  collector: /collec/i,
  fleetFoot: /fleet|foot/i,
};
// Sources the line only lists once owned (Globes of Skills, the Quest Cape,
// Nov 2026). Anything else it lists lands in "other", so a source the game
// adds later still counts toward the sum instead of failing the check.
const OPTIONAL = {
  globes: /glob/i,
  questCape: /quest|cape/i,
};

const num = (s) => Number(s.replace(",", "."));

/**
 * One OCR'd page → { stepsPerSec, totalPct, vigor, effectiveVigor, bonusPct:
 * { telescopes, compasses, ... }, consistent } or null without the line.
 */
export function parseMovementLine(text) {
  const line = (text ?? "").split("\n").find((l) => /Total\s+Mov/i.test(l));
  if (!line) return null;
  const steps = /(\d{1,2}(?:[.,]\d)?)\s*steps/i.exec(line);
  if (!steps) return null;
  const total = /Speed\s*\+?(\d{1,3})\s*%/i.exec(line);
  const vigor = /Vigor\s*\S{0,4}\s*(\d{1,2})\b/i.exec(line);
  // OCR reads "81" as "B1" now and then.
  const eff = /effective\s*([\dBO]{1,2})/i.exec(line);
  const bonusPct = {};
  // Each source reads "+9.5% telescopes"; split at the plus signs.
  for (const part of line.split("+").slice(1)) {
    const m = /^\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*([a-z' ]+)/i.exec(part);
    if (!m) continue;
    const key = Object.keys(SOURCES).find((k) => SOURCES[k].test(m[2]))
      ?? Object.keys(OPTIONAL).find((k) => OPTIONAL[k].test(m[2])) ?? "other";
    if (key === "other") bonusPct.other = (bonusPct.other ?? 0) + num(m[1]);
    else if (bonusPct[key] == null) bonusPct[key] = num(m[1]);
  }
  const effectiveVigor = eff ? Number(eff[1].replace(/B/g, "8").replace(/O/g, "0")) : null;
  const out = {
    stepsPerSec: num(steps[1]),
    totalPct: total ? Number(total[1]) : null,
    vigor: vigor ? Number(vigor[1]) : null,
    effectiveVigor,
    bonusPct,
  };
  out.consistent = isConsistent(out);
  return out;
}

const bundle = (r) => Object.values(r.bonusPct).reduce((a, b) => a + b, 0) / 100;

/** All six sources read, and base(effective vigor) × (1 + their sum) matches steps/sec. */
function isConsistent(r) {
  if (Object.keys(SOURCES).some((k) => r.bonusPct[k] == null)) return false;
  if (r.effectiveVigor == null) return false;
  if (r.totalPct != null && Math.abs(10 * (1 + r.totalPct / 100) - r.stepsPerSec) > 0.1) return false;
  // Effective vigor is shown rounded, so allow about half a level of base speed.
  return Math.abs(vigorBaseSpeed(r.effectiveVigor) * (1 + bundle(r)) - r.stepsPerSec) < 0.15;
}

/**
 * Speed with a potion, from what the line shows. The steps/sec figure is
 * the game's own result, so it anchors the base; the potion joins the
 * same additive bundle (Constants.totalMovementSpeed).
 */
export function speedWithPotion(perks, potionFraction = 0) {
  const b = bundle(perks);
  return Math.round(perks.stepsPerSec * (1 + b + potionFraction) / (1 + b) * 10) / 10;
}

/** `recognize(imageData) → Promise<text>`. Returns the first consistent reading, else the most complete one, else null. */
export async function readPerks(img, recognize) {
  let best = null;
  for (const [scale, level] of ATTEMPTS) {
    const got = parseMovementLine(await recognize(binarize(img, scale, level)));
    if (!got) continue;
    if (got.consistent) return got;
    if (!best || Object.keys(got.bonusPct).length > Object.keys(best.bonusPct).length) best = got;
  }
  return best;
}
