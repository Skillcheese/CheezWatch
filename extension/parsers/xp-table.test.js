import { test } from "node:test";
import assert from "node:assert/strict";
import { extractXpTable, levelForXp } from "./xp-table.js";

const xpForLevel = { 1: 0, 2: 317, 3: 667, 98: 45285895, 99: 50000000, 100: 55204475 };
for (let l = 4; l < 98; l++) xpForLevel[l] = 667 + l; // filler, monotonic
const table = extractXpTable(JSON.stringify({ _comment: "", xpForLevel, perLevel: [] }));

test("maps XP to level at boundaries", () => {
  assert.equal(levelForXp(table, 0, "fish"), 1);
  assert.equal(levelForXp(table, 316, "fish"), 1);
  assert.equal(levelForXp(table, 317, "fish"), 2);
});

test("caps at 99 except extended skills", () => {
  assert.equal(levelForXp(table, 60000000, "fish"), 99);
  assert.equal(levelForXp(table, 60000000, "slay"), 100);
});

test("rejects unrelated payloads", () => {
  assert.equal(extractXpTable({ type: "tick" }), null);
  assert.equal(extractXpTable("{bad"), null);
});
