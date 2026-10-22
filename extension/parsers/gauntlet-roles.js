// The Gauntlet is the skilling raid: each role gathers with one skill and
// processes with another, so combat skills don't feed role stats.
export const ROLE_SKILLS = {
  Health:  { gather: "fish",   process: "cook" },
  Melee:   { gather: "mine",   process: "smith" },
  Ranged:  { gather: "forage", process: "craft" },
  Magic:   { gather: "invoke", process: "imbue" },
  Defense: { gather: "farm",   process: "brew" },
};

/** Role tier is limited by the weaker of the role's two skills. */
export function roleTier(gatherLevel, processLevel) {
  return Math.floor(Math.min(gatherLevel, processLevel) / 10);
}
