import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_SKILLS, roleTier } from "./gauntlet-roles.js";

test("tier is floor(min(gather, process) / 10)", () => {
  assert.equal(roleTier("Melee", 9, 50), 0);
  assert.equal(roleTier("Melee", 45, 37), 3);
  assert.equal(roleTier("Melee", 99, 99), 9);
});

test("Defense tier goes by brew alone", () => {
  assert.equal(roleTier("Defense", 12, 75), 7);
  assert.equal(roleTier("Defense", 99, 30), 3);
});

test("every role has a gather and process skill", () => {
  for (const r of ["Health", "Melee", "Ranged", "Magic", "Defense"]) {
    assert.ok(ROLE_SKILLS[r].gather && ROLE_SKILLS[r].process);
  }
});
