import { test } from "node:test";
import assert from "node:assert/strict";
import { globesFromPerks, backpackSize, computeProfile, movementSpeed, unlockSummaries, fortBonuses, talentBonuses, xpBonus } from "./calc.js";
import { vigorBaseSpeed } from "./lib/lab-profile.js";

const owned = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, new Set(v.split(" ").filter(Boolean))]));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("nothing owned leaves only the vigor cut", () => {
  const u = unlockSummaries({ owned: {}, levels: { vigor: 9 } });
  close(u.all_skills.all_durations, -0.05);
  close(u.all_skills.success, 0);
  close(u.fish.duration, -0.05);
  close(u.fish.duplicate, 0);
});

test("tool seconds stack from the own column and the all-skills lanterns", () => {
  const u = unlockSummaries({ owned: owned({ levels: "L1 L2", fish: "T1 T2 T3 T4 T5 C6 D1 D2" }), levels: { vigor: -1 } });
  close(u.all_skills.all_durations, -0.2);
  close(u.fish.duration, -(0.1 + 0.1 + 0.2 + 0.3 + 0.4 + 0.6 + 0.1 + 0.1 + 0.2));
  close(u.fish.success, 10);
  close(u.fish.duplicate, 10);
  close(u.cook.duration, -0.2);
});

test("cape/pet seconds cap at 8 sources but success keeps counting", () => {
  const u = unlockSummaries({
    owned: owned({ levels: "pet shiny_pet cape trimmed_cape", fish: "pet shiny_pet cape trimmed_cape T1" }),
    levels: { vigor: -1 },
  });
  close(u.fish.duration, -(0.8 + 0.1));
  close(u.fish.success, 9);
  close(u.all_skills.all_durations, -0.4);
});

test("collector adds seconds, success and double by fraction", () => {
  const u = unlockSummaries({ owned: {}, levels: { vigor: -1 }, collectorFraction: 0.5 });
  close(u.fish.duration, -0.5);
  close(u.fish.success, 5);
  close(u.fish.duplicate, 5);
});

test("movement speed applies potion and collector to the vigor base", () => {
  assert.equal(movementSpeed(50), Math.round(vigorBaseSpeed(50) * 10) / 10);
  assert.equal(movementSpeed(50, "haste", 0.5), Math.round(vigorBaseSpeed(50) * 1.55 * 10) / 10);
  assert.equal(movementSpeed(50, "bogus"), movementSpeed(50));
});

test("computeProfile fills tiers, stats and speed", () => {
  const p = computeProfile({ owned: owned({ fish: "T1" }), levels: { fish: 60, cook: 60, vigor: 10 }, potion: "swift" });
  assert.ok(Object.keys(p.roleTiers).length > 0);
  assert.ok(Object.keys(p.roleStats).length > 0);
  assert.equal(p.movementSpeed, movementSpeed(10, "swift"));
});

const fort = (spec) => Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, new Set(v.split(" "))]));

test("fortress items: full sets match the game's stated totals", () => {
  const all = "T1 T2 T3 T4 T5 C6 C7";
  const b = fortBonuses(fort({ ledger: all, banner: all, haste: all, swift: all, sure: all, bounty: all, thrift: all }));
  close(b.seconds, 0.7 + 1.4);
  assert.equal(b.sources, 14);
  assert.equal(b.success, 7);
  assert.equal(b.double, 7);
  close(b.move, 0.07 + 0.07 + 0.14);
  assert.deepEqual(fortBonuses(), { sources: 0, seconds: 0, success: 0, double: 0, save: 0, move: 0 });
});

test("fortress items flow into summaries and movement", () => {
  const f = fort({ ledger: "T1 T2", banner: "T3", haste: "C7", sure: "T1", bounty: "T1 T2" });
  const u = unlockSummaries({ owned: {}, levels: { vigor: -1 }, fort: f });
  close(u.fish.duration, -(0.2 + 0.35));
  close(u.fish.success, 3 + 1);
  close(u.fish.duplicate, 3 + 2);
  close(u.all_skills.all_durations, -0.55);
  const move = (1 + 2 + 3) * 0.0025;
  assert.equal(movementSpeed(50, "none", 0, f), Math.round(vigorBaseSpeed(50) * (1 + move) * 10) / 10);
});

test("backpack size: 28 plus 4 per satchel tier", () => {
  assert.equal(backpackSize(), 28);
  assert.equal(backpackSize(fort({ satchel: "T1 T2" })), 36);
  assert.equal(backpackSize(fort({ satchel: "T1 T2 T3 T4 T5 C6 C7" })), 56);
  assert.equal(computeProfile({ owned: {}, levels: {}, fort: fort({ satchel: "T1" }) }).backpackSize, 32);
});

test("fortify talents flow into summaries and movement", () => {
  const talents = { moveSpeedPct: 2.75, successPct: 5, doubleGatherPct: 10, actionTimeSec: -0.6 };
  assert.deepEqual(talentBonuses(), { seconds: 0, success: 0, double: 0, save: 0, move: 0 });
  const u = unlockSummaries({ owned: {}, levels: { vigor: -1 }, talents });
  close(u.fish.duration, -0.6);
  close(u.fish.success, 5);
  close(u.fish.duplicate, 10);
  close(u.all_skills.all_durations, -0.6);
  assert.equal(movementSpeed(50, "none", 0, undefined, talents), Math.round(vigorBaseSpeed(50) * 1.0275 * 10) / 10);
});

test("the Perks movement line replaces the movement estimate", () => {
  const perks = { stepsPerSec: 26.8, bonusPct: { telescopes: 9.5, compasses: 1, swiftBeacons: 1.5, milestones: 5, collector: 4.7, fleetFoot: 3 } };
  const base = { owned: {}, levels: { vigor: 69 }, perks };
  assert.equal(computeProfile(base).movementSpeed, 26.8);
  assert.equal(computeProfile({ ...base, potion: "haste" }).movementSpeed, 37.5);
});

test("xp bonus adds every source the screenshots show", () => {
  const x = xpBonus({
    owned: owned({ levels: "pet shiny_pet T1 C6 L2", fish: "cape" }),
    fort: fort({ ledger: "T1 C7", banner: "T2", haste: "T1 T2", thrift: "T1", fortification: "T1 C6" }),
    talents: { fortifyXpPct: 4, globalXpPct: 3, skillingXpPct: 1.75 },
    perks: { bonusPct: { telescopes: 9.5, compasses: 1 } },
  });
  close(x.parts.talents, 8.75);
  close(x.parts.fort, (1 + 7 + 2) * 0.25 + 3 * 0.25 + 1 + 6);
  close(x.parts.lanterns, 0.5 + 3 + 1);
  close(x.parts.capesPets, 0.75);
  close(x.parts.telescopes, 4.75);
  close(x.parts.compasses, 0.5);
  close(x.total, 8.75 + 10.25 + 4.5 + 0.75 + 4.75 + 0.5);
  close(xpBonus().total, 0);
});

test("material save adds half a point per source plus Thrift, talents and the collector", () => {
  const fort = { ledger: new Set(["T1", "T2"]), thrift: new Set(["T1", "T2", "T3"]) };
  const u = unlockSummaries({ owned: {}, levels: { vigor: -1 }, fort, talents: { saveMaterialPct: 1.25 }, collectorFraction: 0.5 });
  close(u.cook.save, 2 * 0.5 + 3 * 0.5 + 1.25 + 5);
});

test("Q1 quest tools count like D1: 0.1s, one source, the T1 lantern XP", () => {
  const u = unlockSummaries({ owned: owned({ levels: "Q1", fish: "Q1" }), levels: { vigor: -1 } });
  close(u.all_skills.all_durations, -0.1);
  close(u.fish.duration, -0.2);
  close(u.fish.success, 2);
  close(xpBonus({ owned: owned({ levels: "Q1" }) }).parts.lanterns, 0.5);
});

test("Globes of Skills set auto-process on every role and come from the Perks line", () => {
  const p = computeProfile({ owned: {}, levels: {}, globes: "both" });
  for (const r of Object.values(p.roleStats)) { close(r.auto_process, 0.15); close(r.auto_bank, 0.15); }
  close(computeProfile({ owned: {}, levels: {} }).roleStats.Health.auto_process, 0);
  assert.equal(globesFromPerks({ bonusPct: { globes: 10 } }), "t2");
  assert.equal(globesFromPerks({ bonusPct: {} }), null);
  assert.ok(Math.abs(movementSpeed(50, "none", 0, {}, {}, "t1") / movementSpeed(50) - 1.05) < 0.005);
});
