import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRoleTiers } from "./lab-profile.js";

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
