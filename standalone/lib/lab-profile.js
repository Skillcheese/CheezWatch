// Maps parsed game data onto Gauntlet Lab's saved AppState. Only fields we
// actually observe are touched; the rest of the user's Me profile is kept.

import { ROLE_SKILLS, roleTier } from "./gauntlet-roles.js";

// Must match STORAGE_KEY in gauntlet_lab/src/app.ts.
export const LAB_STORAGE_KEY = "gauntlet-lab-web-current-v3";

/** Sets Me's role tiers in `state` in place. Returns true if anything changed. */
export function applyRoleTiers(state, roleTiers) {
  const roles = state?.profiles?.Me?.role_stats;
  if (!roles) return false;
  let changed = false;
  for (const [role, tier] of Object.entries(roleTiers)) {
    if (roles[role] && roles[role].tier !== tier) {
      roles[role].tier = tier;
      changed = true;
    }
  }
  return changed;
}

/** Sets Me's backpack size in `state` in place. Returns true if it changed. */
export function applyBackpackSize(state, size) {
  const me = state?.profiles?.Me;
  if (!me || !Number.isFinite(size) || me.backpack_size === size) return false;
  me.backpack_size = size;
  return true;
}

// Formulas below are from the game client's shared/Constants.js
// (movementSpeed, totalMovementSpeed, MOVEMENT_POTIONS). Lab speed is px/s,
// the same unit as the game, where 10 is normal.
const SWIFT_POTION_PCT = 15;

/** Game's base speed for a vigor level, before percentage bonuses. */
export function vigorBaseSpeed(level) {
  const v = Math.max(0, level);
  return 10 + (v + 1) * (0.1 + 0.0005 * v);
}

/** Lab movement speed from vigor and unlocks, assuming a Swift potion is active. */
export function movementSpeed(vigorLevel, unlocks) {
  const pct = (unlocks?.all_skills?.move_speed ?? 0) + SWIFT_POTION_PCT;
  return Math.round(vigorBaseSpeed(vigorLevel) * (1 + pct / 100) * 10) / 10;
}

/** Sets Me's movement speed in `state` in place. Returns true if it changed. */
export function applyMovementSpeed(state, speed) {
  const me = state?.profiles?.Me;
  if (!me || !Number.isFinite(speed) || me.movement_speed === speed) return false;
  me.movement_speed = speed;
  return true;
}

// The game's rules (shared/Constants.js): overworld duration is
// 10 - 0.01·(level - 1) minus every reduction, floored at 2.0s, and the
// Gauntlet divides it by GAUNTLET_HASTE (10). Success is 70% + 1% per level
// over the node's requirement + 1% per source; each 1% over 100 cuts 0.05s.
// Reduction past the 2.0s floor turns into +3% double per second (gather).
const BASE_DURATION = 10;
const LEVEL_CUT = 0.01;
const MIN_DURATION = 2.0;
const GAUNTLET_HASTE = 10;
const SUCCESS_BASE = 70;
const OVERFLOW_SEC_PER_PCT = 0.05;
const OVERFLOW_DOUBLE_PER_SEC = 3;
const MAX_DOUBLE = 0.85;

// Fortress node requirements per tier (nodes.json).
const TIER_LEVELS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99];

/** Level required by the Fortress node a role works at `tier`. */
export function fortressNodeLevel(tier) {
  return TIER_LEVELS[Math.max(0, Math.min(10, tier))];
}

const round = (v) => Math.round(v * 1e4) / 1e4;

function skillStats(unlocks, skill, level, nodeLevel, gather) {
  const all = unlocks.all_skills ?? {};
  const own = unlocks[skill] ?? {};
  // A skill's "duration" and "success" lines already include the global bonus
  // (fish -1.36s vs all -1.16s), so the two are not added together.
  const rawSuccess = SUCCESS_BASE + Math.max(0, level - nodeLevel) + (own.success ?? all.success ?? 0);
  const overflowSec = Math.max(0, rawSuccess - 100) * OVERFLOW_SEC_PER_PCT;
  const base = BASE_DURATION - LEVEL_CUT * Math.max(0, level - 1);
  const reduction = -(own.duration ?? all.all_durations ?? 0) + overflowSec;
  const excess = Math.max(0, reduction - Math.max(0, base - MIN_DURATION));
  const double = gather ? (own.duplicate ?? 0) + excess * OVERFLOW_DOUBLE_PER_SEC : 0;
  return {
    time: round(Math.max(MIN_DURATION, base - reduction) / GAUNTLET_HASTE),
    success: round(Math.min(100, rawSuccess) / 100),
    double: round(Math.min(MAX_DOUBLE, double / 100)),
  };
}

/** Gauntlet RoleStats (minus tier) per role, from parsed unlock_summaries and { skill: level }. */
export function roleStatsFromUnlocks(unlocks, levels) {
  const out = {};
  for (const [role, { gather, process }] of Object.entries(ROLE_SKILLS)) {
    const gl = levels?.[gather] ?? 1, pl = levels?.[process] ?? 1;
    const nodeLevel = fortressNodeLevel(roleTier(role, gl, pl));
    const g = skillStats(unlocks, gather, gl, nodeLevel, true);
    const p = skillStats(unlocks, process, pl, nodeLevel, false);
    out[role] = {
      gather_time: g.time, gather_success: g.success, double_gather: g.double,
      process_time: p.time, process_success: p.success,
    };
  }
  return out;
}

/** Copies unlock-derived stats onto Me in `state` in place. Returns true if anything changed. */
export function applyUnlockStats(state, unlocks, levels) {
  const roles = state?.profiles?.Me?.role_stats;
  if (!roles) return false;
  let changed = false;
  for (const [role, stats] of Object.entries(roleStatsFromUnlocks(unlocks, levels))) {
    if (!roles[role]) continue;
    for (const [key, value] of Object.entries(stats)) {
      if (roles[role][key] !== value) {
        roles[role][key] = value;
        changed = true;
      }
    }
  }
  return changed;
}
