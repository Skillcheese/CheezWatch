// Parses `ledger_data`, the account snapshot sent when the player returns to
// the game. `now` is current; `last`, `day` and `week` are older snapshots.
import { ROLE_SKILLS, roleTier } from "./gauntlet-roles.js";

const BASE_BACKPACK = 28;
const SLOTS_PER_SATCHEL = 4;
// Satchels appear in the unlocks map (`un`) as extender_t1, extender_t2, ...
const SATCHEL = /^extender_t\d+$/;

/**
 * Returns { at, skills: { [skill]: { level, xp } }, gauntletRuns?, roleTiers, backpackSize? }
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
  if (now.un && typeof now.un === "object") {
    const satchels = Object.keys(now.un).filter((k) => SATCHEL.test(k) && now.un[k]).length;
    result.backpackSize = BASE_BACKPACK + SLOTS_PER_SATCHEL * satchels;
  }
  return result;
}
