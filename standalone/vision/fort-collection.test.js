import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { FORT_ITEM_IDS, parseFortItem, readFortCollection } from "./fort-collection.js";

// The item icons are the game's assets, extracted by scripts/extract-icons.js
// and gitignored, so the screenshot tests skip on a fresh clone.
const DIR = new URL("../icons/fort/", import.meta.url);
const hasIcons = FORT_ITEM_IDS.every((id) => fs.existsSync(new URL(`${id}.png`, DIR)));
const skip = hasIcons ? false : "Fortress icons not extracted (node scripts/extract-icons.js)";

let refs;
function references() {
  refs ??= Object.fromEntries(FORT_ITEM_IDS.map((id) => [id, PNG.sync.read(fs.readFileSync(new URL(`${id}.png`, DIR)))]));
  return refs;
}
const sample = (name) => PNG.sync.read(fs.readFileSync(new URL(`../../samples/${name}.png`, import.meta.url)));
const plain = (owned) => Object.fromEntries(Object.entries(owned).map(([k, v]) => [k, [...v].sort()]));

test("collection has 90 Fortress items", () => {
  assert.equal(FORT_ITEM_IDS.length, 90);
  assert.deepEqual(parseFortItem("beacon_haste_c"), { family: "haste", tier: "C6" });
  assert.deepEqual(parseFortItem("gauntlet_ledger_c7"), { family: "ledger", tier: "C7" });
  assert.deepEqual(parseFortItem("hot_sauce_t2"), { family: null, tier: "T2" });
});

test("reads the blue Fortress collection", { skip }, () => {
  const r = readFortCollection(sample("fort-blue"), references());
  assert.equal(r.items.length, 39); // 8 milestones + 31 rare drops, as the game counts
  assert.ok(r.items.every((i) => i.id));
  assert.deepEqual(plain(r.owned), {
    banner: ["T1", "T2", "T3", "T4"], ledger: ["T1", "T2", "T3", "T4"],
    haste: ["T1", "T2", "T3"], bounty: ["T1", "T2", "T3"], thrift: ["T1", "T2", "T3", "T4"],
    sure: ["T1", "T2", "T3"], swift: ["T1", "T2"], satchel: ["T1", "T2"], fortification: ["T1", "T2", "T3"],
  });
});

test("reads the brown Fortress collection", { skip }, () => {
  const r = readFortCollection(sample("fort-brown"), references());
  assert.equal(r.items.length, 17); // 4 + 13
  assert.ok(r.items.every((i) => i.id));
  assert.deepEqual(plain(r.owned), {
    banner: ["T1", "T2"], ledger: ["T1", "T2"], haste: ["T1", "T2"],
    bounty: ["T1"], thrift: ["T1"], sure: ["T1"], swift: ["T1"], satchel: ["T1", "T2"], fortification: ["T1"],
  });
});

test("reads the Fortress collection after the Q1 update", { skip }, () => {
  const r = readFortCollection(sample("Screenshot 2026-11-27 212102"), references());
  assert.equal(r.items.length, 43); // 8 + 35
  assert.ok(r.items.every((i) => i.id));
  assert.deepEqual(plain(r.owned), {
    banner: ["T1", "T2", "T3", "T4"], ledger: ["T1", "T2", "T3", "T4"],
    haste: ["T1", "T2", "T3"], bounty: ["T1", "T2", "T3"], thrift: ["T1", "T2", "T3", "T4"],
    sure: ["T1", "T2", "T3"], swift: ["T1", "T2", "T3"], satchel: ["T1", "T2", "T3"], fortification: ["T1", "T2", "T3"],
  });
});

test("reads a large Fortress collection screenshot", { skip }, () => {
  const r = readFortCollection(sample("fort-52"), references());
  assert.equal(r.items.length, 52); // 8 + 44
  assert.ok(r.items.every((i) => i.id));
  assert.deepEqual(plain(r.owned), {
    banner: ["T1", "T2", "T3", "T4"], ledger: ["T1", "T2", "T3", "T4"],
    haste: ["T1", "T2", "T3", "T4"], bounty: ["T1", "T2", "T3", "T4"], thrift: ["T1", "T2", "T3", "T4"],
    sure: ["T1", "T2", "T3", "T4"], swift: ["T1", "T2", "T3", "T4"], satchel: ["T1", "T2", "T3", "T4", "T5"],
    fortification: ["T1", "T2", "T3"],
  });
});

test("rejects screenshots of other screens", { skip }, () => {
  for (const name of ["unlocks-blue", "unlocks-brown", "skills-brown"]) {
    assert.throws(() => readFortCollection(sample(name), references()), /The Fortress/, name);
  }
});
