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
