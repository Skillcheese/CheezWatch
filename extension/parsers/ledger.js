// Parses `ledger_data`, the account snapshot sent when the player returns to
// the game. `now` is current; `last`, `day` and `week` are older snapshots.
import { ROLE_SKILLS, roleTier } from "./gauntlet-roles.js";

/**
 * Returns { at, skills: { [skill]: { level, xp } }, gauntletRuns?, roleTiers }
 * from a raw WS payload, or null if it holds no ledger.
 */
export function extractLedger(payload) {
  let msg;
  try { msg = typeof payload === "string" ? JSON.parse(payload) : payload; } catch { return null; }
  const messages = msg?.type === "batch" && Array.isArray(msg.data) ? msg.data : [msg];
  const ledger = messages.find((m) => m?.type === "ledger_data");
  const now = ledger?.data?.now;
  if (!now?.sk || typeof now.sk !== "object") return null;

  const skills = {};
  for (const [name, entry] of Object.entries(now.sk)) {
    if (Array.isArray(entry) && Number.isFinite(entry[0]) && Number.isFinite(entry[1])) {
      skills[name] = { level: entry[0], xp: entry[1] };
    }
  }
  const roleTiers = {};
  for (const [role, { gather, process }] of Object.entries(ROLE_SKILLS)) {
    if (skills[gather] && skills[process]) roleTiers[role] = roleTier(skills[gather].level, skills[process].level);
  }
  const result = { at: now.at, skills, roleTiers };
  if (Number.isFinite(now.rd?.gauntlet)) result.gauntletRuns = now.rd.gauntlet;
  return result;
}
