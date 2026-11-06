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

// Lab speed 10 is normal. Calibrated to one in-game reading: at vigor 56 with
// +11.18% move speed, speed is 19.6 without the first potion and 22.2 with it.
// That fits (10 + vigor bonus) * (1 + unlock% + potion%). Only the anchor is
// measured: the per-level slope comes from older, less reliable readings.
const BASE_SPEED = 10;
const VIGOR_ANCHOR = { level: 56, bonus: 7.63 };
const VIGOR_BONUS_PER_LEVEL = 2.3 / 22;
const FIRST_POTION_PCT = 15;

export function vigorSpeedBonus(level) {
  return Math.max(0, VIGOR_ANCHOR.bonus + (level - VIGOR_ANCHOR.level) * VIGOR_BONUS_PER_LEVEL);
}

/** Lab movement speed from vigor and unlocks, assuming the first potion is active. */
export function movementSpeed(vigorLevel, unlocks) {
  const pct = (unlocks?.all_skills?.move_speed ?? 0) + FIRST_POTION_PCT;
  return Math.round((BASE_SPEED + vigorSpeedBonus(vigorLevel)) * (1 + pct / 100) * 10) / 10;
}

/** Sets Me's movement speed in `state` in place. Returns true if it changed. */
export function applyMovementSpeed(state, speed) {
  const me = state?.profiles?.Me;
  if (!me || !Number.isFinite(speed) || me.movement_speed === speed) return false;
  me.movement_speed = speed;
  return true;
}

// Time and double are Gauntlet Lab's untiered baseline ("Generic T0"). Success
// is calibrated to in-game fish 79% and cook 77%, not the lab's 75%.
const BASE = { time: 1, success: 0.7, double: 0 };
// Gauntlet actions take a tenth of the overworld time, so overworld duration
// cuts shrink by the same factor.
const GAUNTLET_TIME_SCALE = 0.1;
const MIN_TIME = 0.05;

const round = (v) => Math.round(v * 1e4) / 1e4;

// Each skill level past 1 cuts overworld duration by this many seconds. Fits
// fish 54 -> 8.11s and cook 52 -> 8.33s exactly.
const LEVEL_CUT = 0.01;

function skillStats(unlocks, skill, levels) {
  const all = unlocks.all_skills ?? {};
  const own = unlocks[skill] ?? {};
  // A skill's "duration" and "success" lines already include the global bonus
  // (fish -1.36s vs all -1.16s), so the two are not added together.
  const levelCut = LEVEL_CUT * Math.max(0, (levels?.[skill] ?? 1) - 1);
  const cut = (own.duration ?? all.all_durations ?? 0) - levelCut;
  const success = own.success ?? all.success ?? 0;
  return {
    time: round(Math.max(MIN_TIME, BASE.time + cut * GAUNTLET_TIME_SCALE)),
    success: round(Math.min(1, BASE.success + success / 100)),
    double: round(Math.min(1, BASE.double + (own.duplicate ?? 0) / 100)),
  };
}

/** Gauntlet RoleStats (minus tier) per role, from parsed unlock_summaries and { skill: level }. */
export function roleStatsFromUnlocks(unlocks, levels) {
  const out = {};
  for (const [role, { gather, process }] of Object.entries(ROLE_SKILLS)) {
    const g = skillStats(unlocks, gather, levels);
    const p = skillStats(unlocks, process, levels);
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
