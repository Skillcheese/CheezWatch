// Maps parsed game data onto Gauntlet Lab's saved AppState. Only fields we
// actually observe are touched; the rest of the user's Me profile is kept.

import { ROLE_SKILLS } from "./gauntlet-roles.js";

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

// Lab speed 10 is normal. Vigor's flat bonus is a straight line through two
// known points (level 43 -> +5.3, level 65 -> +7.6); the true curve is unknown.
const BASE_SPEED = 10;
const VIGOR_POINTS = [[43, 5.3], [65, 7.6]];

export function vigorSpeedBonus(level) {
  const [[l1, b1], [l2, b2]] = VIGOR_POINTS;
  return Math.max(0, b1 + (level - l1) * (b2 - b1) / (l2 - l1));
}

/** Lab movement speed from vigor level plus the unlocks' "% move speed". */
export function movementSpeed(vigorLevel, unlocks) {
  const pct = unlocks?.all_skills?.move_speed ?? 0;
  return Math.round((BASE_SPEED + vigorSpeedBonus(vigorLevel) + BASE_SPEED * pct / 100) * 10) / 10;
}

/** Sets Me's movement speed in `state` in place. Returns true if it changed. */
export function applyMovementSpeed(state, speed) {
  const me = state?.profiles?.Me;
  if (!me || !Number.isFinite(speed) || me.movement_speed === speed) return false;
  me.movement_speed = speed;
  return true;
}

// Gauntlet Lab's untiered baseline (its "Generic T0" profile).
const BASE = { time: 1, success: 0.75, double: 0 };
// Gauntlet actions take a tenth of the overworld time, so overworld duration
// cuts shrink by the same factor.
const GAUNTLET_TIME_SCALE = 0.1;
const MIN_TIME = 0.05;

const round = (v) => Math.round(v * 1e4) / 1e4;

function skillStats(unlocks, skill) {
  const all = unlocks.all_skills ?? {};
  const own = unlocks[skill] ?? {};
  // Every skill currently repeats the global cut as its own "duration" line,
  // so the two are not added together.
  const cut = own.duration ?? all.all_durations ?? 0;
  return {
    time: round(Math.max(MIN_TIME, BASE.time + cut * GAUNTLET_TIME_SCALE)),
    success: round(Math.min(1, BASE.success + ((all.success ?? 0) + (own.success ?? 0)) / 100)),
    double: round(Math.min(1, BASE.double + (own.duplicate ?? 0) / 100)),
  };
}

/** Gauntlet RoleStats (minus tier) per role, from parsed unlock_summaries. */
export function roleStatsFromUnlocks(unlocks) {
  const out = {};
  for (const [role, { gather, process }] of Object.entries(ROLE_SKILLS)) {
    const g = skillStats(unlocks, gather);
    const p = skillStats(unlocks, process);
    out[role] = {
      gather_time: g.time, gather_success: g.success, double_gather: g.double,
      process_time: p.time, process_success: p.success,
    };
  }
  return out;
}

/** Copies unlock-derived stats onto Me in `state` in place. Returns true if anything changed. */
export function applyUnlockStats(state, unlocks) {
  const roles = state?.profiles?.Me?.role_stats;
  if (!roles) return false;
  let changed = false;
  for (const [role, stats] of Object.entries(roleStatsFromUnlocks(unlocks))) {
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
