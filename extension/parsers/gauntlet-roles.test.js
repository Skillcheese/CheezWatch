import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_SKILLS, roleTier } from "./gauntlet-roles.js";

test("tier is floor(min(gather, process) / 10)", () => {
  assert.equal(roleTier(9, 50), 0);
  assert.equal(roleTier(45, 37), 3);
  assert.equal(roleTier(99, 99), 9);
});

test("every role has a gather and process skill", () => {
  for (const r of ["Health", "Melee", "Ranged", "Magic", "Defense"]) {
    assert.ok(ROLE_SKILLS[r].gather && ROLE_SKILLS[r].process);
  }
});
