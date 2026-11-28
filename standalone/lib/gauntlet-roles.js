// The Gauntlet is the skilling raid: each role gathers with one skill and
// processes with another, so combat skills don't feed role stats.
export const ROLE_SKILLS = {
  Health:  { gather: "fish",   process: "cook" },
  Melee:   { gather: "mine",   process: "smith" },
  Ranged:  { gather: "forage", process: "craft" },
  Magic:   { gather: "invoke", process: "imbue" },
  Defense: { gather: "farm",   process: "brew" },
};

// Defensive potions come in bands that share one farmed leaf (Constants.js
// FINISHING_RECIPES): shell T0-3 from the T0 leaf, barrier T4-7 from the T4
// leaf, fortress T8+ from the T8 leaf. So farm only gates the band.
const DEFENSE_BANDS = [8, 4, 0];

/**
 * Role tier is limited by the weaker of the role's two skills, except Defense:
 * brew sets the tier, capped at the top of the band farm can gather for.
 */
export function roleTier(role, gatherLevel, processLevel) {
  const processTier = Math.floor(processLevel / 10);
  if (role !== "Defense") return Math.min(Math.floor(gatherLevel / 10), processTier);
  const band = DEFENSE_BANDS.find((b) => b * 10 <= gatherLevel) ?? 0;
  return band === 8 ? processTier : Math.min(processTier, band + 3);
}
