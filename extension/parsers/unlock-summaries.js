// Parses the `unlock_summaries` message the game sends when the [Q] Unlocks
// menu opens. It carries per-skill bonus lines like "+11.81% XP", not levels.

const LINE = /^([+-]\d+(?:\.\d+)?)(%|s)?\s+(.+)$/;

/** "+6.31% duplicate" -> { key: "duplicate", value: 6.31, unit: "%" }; null if unrecognised. */
export function parseBonusLine(line) {
  const m = LINE.exec(line.trim());
  if (!m) return null;
  return {
    key: m[3].trim().toLowerCase().replace(/\s+/g, "_"),
    value: Number(m[1]),
    unit: m[2] ?? "",
  };
}

/** { skill: ["+1 min hit", ...] } -> { skill: { min_hit: 1, ... } } */
export function parseSummaries(summaries) {
  const out = {};
  for (const [skill, lines] of Object.entries(summaries)) {
    const bonuses = {};
    for (const line of lines) {
      const b = parseBonusLine(line);
      if (b) bonuses[b.key] = b.value;
    }
    out[skill] = bonuses;
  }
  return out;
}

/** Finds the latest unlock_summaries in a raw WS payload (single or batched). Returns null if absent. */
export function extractUnlockSummaries(payload) {
  let msg;
  try { msg = typeof payload === "string" ? JSON.parse(payload) : payload; } catch { return null; }
  const messages = msg?.type === "batch" && Array.isArray(msg.data) ? msg.data : [msg];
  let found = null;
  for (const m of messages) {
    if (m?.type === "unlock_summaries" && m.data?.summaries) found = m.data.summaries;
  }
  return found ? parseSummaries(found) : null;
}
