import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPlayerState } from "./player-state.js";

test("reads speed and levels from a moving player_state", () => {
  const payload = JSON.stringify({ type: "player_state", data: {
    playerId: 1, state: "moving", totalLevel: 1361, lifeLevel: 48,
    path: { fromNodeId: "a", toNodeId: "b", startTime: 0, speed: 22.667942806144527 },
  } });
  assert.deepEqual(extractPlayerState(payload, 1), { movementSpeed: 22.667942806144527, totalLevel: 1361, lifeLevel: 48 });
});

test("omits speed when idle and ignores other messages", () => {
  assert.deepEqual(extractPlayerState({ type: "player_state", data: { playerId: 1, state: "idle", totalLevel: 5 } }, 1), { totalLevel: 5 });
  assert.equal(extractPlayerState({ type: "tick" }, 1), null);
  assert.equal(extractPlayerState("{bad", 1), null);
});

test("ignores other players", () => {
  assert.equal(extractPlayerState({ type: "player_state", data: { playerId: 15772, totalLevel: 1004 } }, 1), null);
});
