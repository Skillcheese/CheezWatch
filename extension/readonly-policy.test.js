import test from "node:test";
import assert from "node:assert";
import { assertAllowed, readOnlyDebugger } from "./readonly-policy.js";

test("allows passive network observation", () => {
  assert.doesNotThrow(() => assertAllowed("Network.enable", { maxTotalBufferSize: 1e7 }));
  assert.doesNotThrow(() => assertAllowed("Network.getResponseBody", { requestId: "1" }));
});

test("refuses anything that could act on the game", () => {
  for (const m of [
    "Input.dispatchMouseEvent",
    "Input.dispatchKeyEvent",
    "Runtime.evaluate",
    "Runtime.callFunctionOn",
    "Page.reload",
    "Page.navigate",
    "Fetch.enable",
    "Network.setRequestInterception",
    "Network.replayXHR",
    "Network.setCookie",
    "Network.setUserAgentOverride",
    "Emulation.setUserAgentOverride",
    "DOM.setAttributeValue",
    "Storage.clearDataForOrigin",
  ]) {
    assert.throws(() => assertAllowed(m), /not allowed/, m);
  }
});

test("refuses unexpected Network.enable params", () => {
  assert.throws(() => assertAllowed("Network.enable", { reportDirectSocketTraffic: true }), /not allowed/);
});

test("wrapper never forwards a refused command", () => {
  const sent = [];
  const dbg = readOnlyDebugger({ sendCommand: (target, m) => sent.push([target.tabId, m]) }, 7);
  assert.throws(() => dbg.sendCommand("Input.dispatchMouseEvent", {}));
  dbg.sendCommand("Network.enable");
  assert.deepStrictEqual(sent, [[7, "Network.enable"]]);
});
