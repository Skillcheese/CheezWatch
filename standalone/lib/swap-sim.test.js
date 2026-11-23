import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { candidatePlans, simulateSwap } from "./swap-sim.js";

const LAB = new URL("../../gauntlet_lab/dist/worker.js", import.meta.url);
const CONFIG = new URL("../../gauntlet_lab/dist/gauntlet_lab_config.default.json", import.meta.url);
const built = fs.existsSync(LAB) && fs.existsSync(CONFIG);

test("lists staying put plus every swap at each threshold", () => {
  const plans = candidatePlans(["Health", "Melee"], 1600, 3);
  assert.equal(plans.length, 2 + 2 * 3);
  assert.deepEqual(plans[2], { from: "Health", to: "Melee", at: 400 });
});

test("without a swap it matches the Lab's own simulation", { skip: !built && "gauntlet_lab not built" }, () => {
  const self = {};
  const G = new Function("self", `${fs.readFileSync(LAB, "utf8")}\nreturn Gauntlet;`)(self);
  const state = JSON.parse(fs.readFileSync(CONFIG, "utf8")).current;
  const profiles = state.party.map((s) => state.profiles[s.profile_name]);
  const roles = state.party.map((s) => s.manual_role);
  for (let seed = 1; seed < 40; seed++) {
    const lab = G.simulateOne(profiles, roles, 0, state.game, seed);
    const ours = simulateSwap(G, profiles, roles, 0, { from: roles[0], to: roles[0], at: Infinity }, state.game, seed);
    assert.equal(ours.cleared, lab.highest_cleared, `seed ${seed}`);
    assert.equal(ours.deathTime, lab.death_time, `seed ${seed}`);
    assert.equal(ours.swapTime, null);
  }
});

test("swaps once Me's deposits reach the threshold", { skip: !built && "gauntlet_lab not built" }, () => {
  const G = new Function("self", `${fs.readFileSync(LAB, "utf8")}\nreturn Gauntlet;`)({});
  const state = JSON.parse(fs.readFileSync(CONFIG, "utf8")).current;
  const profiles = state.party.map((s) => state.profiles[s.profile_name]);
  const roles = state.party.map((s) => s.manual_role);
  const r = simulateSwap(G, profiles, roles, 0, { from: "Health", to: "Melee", at: 1 }, state.game, 7);
  assert.ok(r.swapTime > 0 && r.meTotal >= 1);
});
