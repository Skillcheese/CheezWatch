import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLedger } from "./ledger.js";

const ledger = { type: "ledger_data", data: {
  reason: "return",
  now: {
    v: 3, at: 1792677533552,
    sk: {
      fish: [44, 227557], cook: [37, 108654], mine: [39, 134265], smith: [29, 50296],
      forage: [42, 179639], craft: [36, 95798], invoke: [38, 123013], imbue: [28, 42862],
      farm: [35, 92390], brew: [39, 141462], alms: [53, 541434],
    },
    rd: { gauntlet: 97 },
  },
  last: { sk: { fish: [1, 0] } },
} };

test("reads current skills, gauntlet runs and role tiers", () => {
  const r = extractLedger(JSON.stringify(ledger));
  assert.equal(r.at, 1792677533552);
  assert.deepEqual(r.skills.fish, { level: 44, xp: 227557 });
  assert.deepEqual(r.skills.alms, { level: 53, xp: 541434 });
  assert.equal(r.gauntletRuns, 97);
  assert.deepEqual(r.roleTiers, { Health: 3, Melee: 2, Ranged: 3, Magic: 2, Defense: 3 });
});

test("finds the ledger inside a batch", () => {
  assert.equal(extractLedger({ type: "batch", data: [{ type: "tick" }, ledger] }).skills.cook.level, 37);
});

test("ignores other messages and bad input", () => {
  assert.equal(extractLedger({ type: "player_state", data: {} }), null);
  assert.equal(extractLedger("{bad"), null);
  assert.equal(extractLedger({ type: "ledger_data", data: {} }), null);
});
