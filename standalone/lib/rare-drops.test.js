import test from "node:test";
import assert from "node:assert/strict";
import { TIERS, tierStats, waveFor, mostLikelyWave } from "./rare-drops.js";

test("wave 80 matches the spreadsheet below the cap", () => {
  const t2 = tierStats(TIERS[1], 80);
  assert.equal(t2.rolls, 59);
  assert.ok(Math.abs(t2.chanceThisWave - 0.01405) < 1e-4);
  assert.ok(Math.abs(t2.atLeastOne - 0.3445) < 2e-3);
  assert.equal(tierStats(TIERS[4], 80).rolls, 0);
});

test("chance per wave stops growing after 64 waves into a band", () => {
  assert.equal(tierStats(TIERS[0], 100).chanceThisWave, tierStats(TIERS[0], 65).chanceThisWave);
});

test("bands are 20 waves apart", () => {
  assert.equal(waveFor(TIERS[1], 0.5) - waveFor(TIERS[0], 0.5), 20);
});

test("picks the most common wave from the Lab's distribution", () => {
  const text = "WAVE DISTRIBUTION\n-----\n 76:  10.00%  ███\n 77:  31.50%  █████\n 78:   9.00%  ██\n";
  assert.deepEqual(mostLikelyWave(text), { wave: 77, pct: 31.5 });
});
