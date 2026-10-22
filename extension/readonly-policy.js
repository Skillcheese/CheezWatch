// The single choke point for every Chrome DevTools Protocol command we send to
// the game tab. Anything not on this list is refused, so the companion can
// observe traffic but can never inject input, run script, rewrite or replay
// requests, or otherwise touch game state.
//
//   Network.enable          - start receiving request/response/websocket events
//   Network.getResponseBody - read a body Chrome already received and buffered
//                             (no request is made; this is a local cache read)
export const ALLOWED_CDP_METHODS = new Set(["Network.enable", "Network.getResponseBody"]);

// Network.enable accepts buffer-size options only; reject anything else so a
// future edit can't sneak behaviour-changing params through.
const ALLOWED_ENABLE_PARAMS = new Set(["maxTotalBufferSize", "maxResourceBufferSize", "maxPostDataSize"]);

export function assertAllowed(method, params = {}) {
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

/** Wraps `chrome.debugger` for one tab so only allowlisted commands can be sent. */
export function readOnlyDebugger(api, tabId) {
  const target = { tabId };
  return {
    attach: () => api.attach(target, "1.3"),
    detach: () => api.detach(target),
    sendCommand: (method, params = {}) => {
      assertAllowed(method, params);
      return api.sendCommand(target, method, params);
    },
  };
}
