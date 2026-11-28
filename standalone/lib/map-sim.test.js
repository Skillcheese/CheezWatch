import test from "node:test";
import assert from "node:assert/strict";
import { averageRuns, creditsUsed, evaluate, leverCost, leverWeight, optimizeLevers, prepare, simulate } from "./map-sim.js";

// A two-location map: a mine next to its bank, a far one, and a smithy.
const data = {
  skills: ["mine", "smith", "fish"],
  activities: {
    mine: { type: "gathering", baseQuantity: 60, list: [
      { id: "ore", tier: 0, level: 1, xp: 10, failXp: 1, input: null, output: null, loot: { ore: 1 } },
    ] },
    smith: { type: "processing", baseQuantity: 40, list: [
      { id: "bar", tier: 0, level: 1, xp: 10, failXp: 1, input: "ore", output: "bar", loot: null },
    ] },
    fish: { type: "gathering", baseQuantity: 60, list: [
      { id: "fishy", tier: 0, level: 1, xp: 10, failXp: 1, input: null, output: null, loot: { fishy: 1 } },
    ] },
  },
  banks: [{ id: "b", x: 0, y: 0 }],
  bankDist: [[0]],
  nodes: [
    { id: "near", name: "Near", x: 10, y: 0, bank: 0, bankDist: 10, acts: ["ore"] },
    { id: "far", name: "Far", x: 3000, y: 0, bank: 0, bankDist: 3000, acts: ["ore"] },
    { id: "smithy", name: "Smithy", x: 0, y: 10, bank: 0, bankDist: 10, acts: ["bar"] },
    { id: "lake", name: "Lake", x: 0, y: 500, bank: 0, bankDist: 500, acts: ["fishy"] },
  ],
};
const profile = { levels: { mine: 50, smith: 50, fish: 50 }, moveSpeed: 25, backpack: 28, bonus: {}, luckChance: 0, luckLever: 0 };

test("lever weights and costs follow the game's formulas", () => {
  assert.equal(leverWeight(0), 10);
  assert.ok(Math.abs(leverWeight(5) - 30.52) < 0.01);
  assert.equal(leverCost(5), 775);
  assert.equal(leverCost(-1), 25);
  // The screenshot's weights use 2375 of 2376 credits.
  assert.equal(creditsUsed({ mine: 5, smith: 5, brew: 2, luck: 4, quests: 1, barter: -2, a: -1, b: -1, c: -1, d: -1, e: -1, f: -1, g: -1, h: -1, i: -1, j: -1, k: -1 }), 2375);
});

test("a location far from its bank is slower", () => {
  const ctx = prepare(data, profile);
  const ore = ctx.available.mine[0];
  const near = evaluate(ctx, { act: ore, node: 0, qty: 100, lucky: false }, -1, new Map(), false);
  const far = evaluate(ctx, { act: ore, node: 1, qty: 100, lucky: false }, -1, new Map(), false);
  assert.ok(Math.abs(far.seconds - near.seconds - (3 * 2 * 2990) / 25) < 1e-6);
  assert.equal(near.xp.mine, far.xp.mine);
});

test("processing stops when the bank runs out of materials", () => {
  const ctx = prepare(data, profile);
  const bar = ctx.available.smith[0];
  const e = evaluate(ctx, { act: bar, node: 2, qty: 40, lucky: false }, -1, new Map([["ore", 15]]), true);
  assert.equal(e.done, 15);
});

test("an active player beats an AFK one on goal XP", () => {
  const ctx = prepare(data, profile);
  const levers = { mine: 0, smith: 0, fish: 0 };
  const goals = { mine: 1, smith: 1 };
  const afk = simulate(ctx, levers, goals, { mode: "afk", hours: 50 }, 1);
  const active = simulate(ctx, levers, goals, { mode: "active", hours: 50, rerollBelow: 0.5 }, 1);
  assert.ok(active.valuePerHour > afk.valuePerHour);
});

test("the optimizer moves weight toward the goal skills within budget", () => {
  const ctx = prepare(data, profile);
  const goals = { mine: 1, smith: 1 };
  const policy = { mode: "afk", hours: 50 };
  const res = optimizeLevers(ctx, { mine: 0, smith: 0, fish: 0 }, goals, policy, { budget: 200, runs: 2 });
  assert.ok(creditsUsed(res.levers) <= 200);
  assert.ok(res.levers.fish < 0 || res.levers.mine > 0);
  assert.ok(res.value >= averageRuns(ctx, { mine: 0, smith: 0, fish: 0, luck: 0 }, goals, policy, 1, 2).valuePerHour);
});
