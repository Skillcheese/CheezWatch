import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMovementSpeed, movementSpeed, vigorSpeedBonus, applyBackpackSize, applyRoleTiers, applyUnlockStats, roleStatsFromUnlocks } from "./lab-profile.js";

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

test("scales duration cuts to Gauntlet time and uses the skill's success line alone", () => {
  assert.deepEqual(roleStatsFromUnlocks(unlocks).Health, {
    gather_time: 0.894, gather_success: 0.7681, double_gather: 0.0631,
    process_time: 0.894, process_success: 0.7681,
  });
});

test("time matches the in-game fish and cook readings at their levels", () => {
  const { Health } = roleStatsFromUnlocks(
    { fish: { duration: -1.36 }, cook: { duration: -1.16 } },
    { fish: 54, cook: 52 },
  );
  assert.equal(Health.gather_time, 0.811);
  assert.equal(Health.process_time, 0.833);
});

test("success matches the in-game fish and cook readings", () => {
  const { Health } = roleStatsFromUnlocks({
    all_skills: { success: 3 }, fish: { success: 9.18 }, cook: { success: 7.18 },
  });
  assert.equal(Math.round(Health.gather_success * 100), 79);
  assert.equal(Math.round(Health.process_success * 100), 77);
});

test("falls back to global bonuses for skills without their own lines", () => {
  assert.deepEqual(roleStatsFromUnlocks(unlocks).Melee, {
    gather_time: 0.894, gather_success: 0.73, double_gather: 0,
    process_time: 0.894, process_success: 0.73,
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

test("vigor bonus passes through the anchor and never goes negative", () => {
  assert.equal(vigorSpeedBonus(56), 7.63);
  assert.ok(vigorSpeedBonus(66) > vigorSpeedBonus(56));
  assert.equal(vigorSpeedBonus(-100), 0);
});

test("movement speed matches the in-game reading with the first potion", () => {
  assert.equal(movementSpeed(56, { all_skills: { move_speed: 11.18 } }), 22.2);
  assert.equal(movementSpeed(56, null), 20.3);
  const state = { profiles: { Me: { movement_speed: 10 } } };
  assert.equal(applyMovementSpeed(state, 16.1), true);
  assert.equal(applyMovementSpeed(state, 16.1), false);
});
