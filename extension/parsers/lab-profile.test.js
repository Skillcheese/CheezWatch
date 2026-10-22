import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBackpackSize, applyRoleTiers, applyUnlockStats, roleStatsFromUnlocks } from "./lab-profile.js";

const stats = (tier) => ({ tier, gather_time: 3, gather_success: 0.9, double_gather: 0.1, process_time: 2, process_success: 0.9 });

test("updates only changed tiers and keeps other stats", () => {
  const state = { profiles: { Me: { name: "Me", role_stats: { Health: stats(1), Melee: stats(2) } } } };
  assert.equal(applyRoleTiers(state, { Health: 3, Melee: 2, Magic: 4 }), true);
  assert.deepEqual(state.profiles.Me.role_stats.Health, stats(3));
  assert.deepEqual(state.profiles.Me.role_stats.Melee, stats(2));
  assert.equal(state.profiles.Me.role_stats.Magic, undefined);
});

test("reports no change when tiers already match or Me is missing", () => {
  const state = { profiles: { Me: { role_stats: { Health: stats(3) } } } };
  assert.equal(applyRoleTiers(state, { Health: 3 }), false);
  assert.equal(applyRoleTiers({ profiles: {} }, { Health: 3 }), false);
  assert.equal(applyRoleTiers(null, { Health: 3 }), false);
});

const unlocks = {
  all_skills: { all_durations: -1.06, success: 3 },
  fish: { duration: -1.06, duplicate: 6.31, success: 6.81 },
  cook: { duration: -1.06, save: 3.06, success: 6.81 },
};

test("scales duration cuts to Gauntlet time and adds global + skill success", () => {
  assert.deepEqual(roleStatsFromUnlocks(unlocks).Health, {
    gather_time: 0.894, gather_success: 0.8481, double_gather: 0.0631,
    process_time: 0.894, process_success: 0.8481,
  });
});

test("falls back to global bonuses for skills without their own lines", () => {
  assert.deepEqual(roleStatsFromUnlocks(unlocks).Melee, {
    gather_time: 0.894, gather_success: 0.78, double_gather: 0,
    process_time: 0.894, process_success: 0.78,
  });
});

test("applies unlock stats to Me and keeps tier", () => {
  const state = { profiles: { Me: { role_stats: { Health: stats(3) } } } };
  assert.equal(applyUnlockStats(state, unlocks), true);
  assert.equal(state.profiles.Me.role_stats.Health.tier, 3);
  assert.equal(state.profiles.Me.role_stats.Health.double_gather, 0.0631);
  assert.equal(applyUnlockStats(state, unlocks), false);
});

test("sets backpack size only when it differs", () => {
  const state = { profiles: { Me: { backpack_size: 28 } } };
  assert.equal(applyBackpackSize(state, 32), true);
  assert.equal(state.profiles.Me.backpack_size, 32);
  assert.equal(applyBackpackSize(state, 32), false);
  assert.equal(applyBackpackSize(state, undefined), false);
});
