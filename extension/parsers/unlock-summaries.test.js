import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBonusLine, extractUnlockSummaries } from "./unlock-summaries.js";

test("parses percent, seconds and flat bonuses", () => {
  assert.deepEqual(parseBonusLine("+11.81% XP"), { key: "xp", value: 11.81, unit: "%" });
  assert.deepEqual(parseBonusLine("-1.06s duration"), { key: "duration", value: -1.06, unit: "s" });
  assert.deepEqual(parseBonusLine("+1 effective level"), { key: "effective_level", value: 1, unit: "" });
  assert.equal(parseBonusLine("nonsense"), null);
});

test("extracts summaries from a batch", () => {
  const payload = JSON.stringify({
    type: "batch",
    data: [
      { type: "other", data: {} },
      { type: "unlock_summaries", data: { summaries: {
        all_skills: ["+6% all XP", "+7.81% move speed"],
        fish: ["+16.06% XP", "-1.06s duration", "+6.31% duplicate", "+6.81% success"],
      } } },
    ],
  });
  assert.deepEqual(extractUnlockSummaries(payload), {
    all_skills: { all_xp: 6, move_speed: 7.81 },
    fish: { xp: 16.06, duration: -1.06, duplicate: 6.31, success: 6.81 },
  });
});

test("ignores unrelated or malformed payloads", () => {
  assert.equal(extractUnlockSummaries("{not json"), null);
  assert.equal(extractUnlockSummaries(JSON.stringify({ type: "tick" })), null);
});
