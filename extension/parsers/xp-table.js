// Parses the XP table the game loads at startup. Skills are likely reported as
// XP, so this is what turns them into levels.

// Only these skills go past 99, per the table's own _comment.
export const EXTENDED_LEVEL_SKILLS = new Set(["slay", "delve", "fortify", "luck"]);

/** Returns xpForLevel as an array indexed by level (index 0 unused), or null. */
export function extractXpTable(payload) {
  let msg;
  try { msg = typeof payload === "string" ? JSON.parse(payload) : payload; } catch { return null; }
  const map = msg?.xpForLevel;
  if (!map || typeof map !== "object") return null;
  const table = [];
  for (const [level, xp] of Object.entries(map)) table[Number(level)] = xp;
  if (table[1] !== 0 || table.slice(1).some((xp) => !Number.isFinite(xp))) return null;
  return table;
}

/** Highest level whose total XP requirement is <= xp, capped per skill. */
export function levelForXp(table, xp, skill) {
  const cap = Math.min(table.length - 1, EXTENDED_LEVEL_SKILLS.has(skill) ? 120 : 99);
  let level = 1;
  while (level < cap && table[level + 1] <= xp) level++;
  return level;
}
