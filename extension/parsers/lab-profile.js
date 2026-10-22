// Maps parsed game data onto Gauntlet Lab's saved AppState. Only fields we
// actually observe are touched; the rest of the user's Me profile is kept.

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
