// The single choke point for every Chrome DevTools Protocol command we send to
// the game page. Anything not on this list is refused, so the companion can
// observe traffic but can never inject input, run script, rewrite or replay
// requests, or otherwise touch game state.
//
//   Network.enable          - start receiving request/response/websocket events
//   Network.getResponseBody - read a body Chromium already received and buffered
//                             (no request is made; this is a local cache read)
const ALLOWED_CDP_METHODS = new Set(["Network.enable", "Network.getResponseBody"]);

// Network.enable accepts buffer-size options only; reject anything else so a
// future edit can't sneak behaviour-changing params through.
const ALLOWED_ENABLE_PARAMS = new Set(["maxTotalBufferSize", "maxResourceBufferSize", "maxPostDataSize"]);

function assertAllowed(method, params = {}) {
  if (!ALLOWED_CDP_METHODS.has(method)) {
    throw new Error(`read-only policy: CDP method "${method}" is not allowed`);
  }
  if (method === "Network.enable") {
    for (const key of Object.keys(params)) {
      if (!ALLOWED_ENABLE_PARAMS.has(key)) {
        throw new Error(`read-only policy: Network.enable param "${key}" is not allowed`);
      }
    }
  }
}

/** Wraps an Electron `webContents.debugger` so only allowlisted commands can be sent. */
function readOnlyDebugger(dbg) {
  return {
    attach: (version) => dbg.attach(version),
    detach: () => dbg.detach(),
    isAttached: () => dbg.isAttached(),
    on: (event, listener) => dbg.on(event, listener),
    sendCommand: (method, params = {}) => {
      assertAllowed(method, params);
      return dbg.sendCommand(method, params);
    },
  };
}

module.exports = { ALLOWED_CDP_METHODS, assertAllowed, readOnlyDebugger };
