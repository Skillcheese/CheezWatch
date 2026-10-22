import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "./redact.js";

test("redacts token-like fields", () => {
  const out = redact(JSON.stringify({ type: "auth", data: { token: "abc", accessToken: "x", sid: "7656", locale: "en" } }));
  assert.deepEqual(JSON.parse(out).data, { token: "[redacted]", accessToken: "[redacted]", sid: "[redacted]", locale: "en" });
});

test("redacts bare JWTs anywhere", () => {
  assert.equal(redact("Bearer eyJhbGc.eyJwbGF5.sig-_1 ok"), "Bearer [redacted-jwt] ok");
});

test("leaves game data alone", () => {
  const s = '{"type":"player_state","data":{"playerId":29,"path":{"speed":22.6}}}';
  assert.equal(redact(s), s);
});
