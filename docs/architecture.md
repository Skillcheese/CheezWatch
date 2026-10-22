# Architecture

## Pieces

```
┌──────────────────────── Chrome window ──────────────────────────────────────────────┐
│ ┌──────────── normal tab ─────────────────────┐ ┌──── side panel ─────────────────┐ │
│ │ https://scapewatch.com/                     │ │ extension/panel/index.html       │ │
│ │ ordinary Chrome tab, your normal profile    │ │  ├─ status line + Attach         │ │
│ │ NO content script, NO injection             │ │  ├─ Traffic tab (log)            │ │
│ │                                             │ │  └─ Gauntlet Lab tab (iframe →   │ │
│ │                                             │ │      ../lab/index.html)          │ │
│ └─────────────────────────────────────────────┘ └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
        ▲ chrome.debugger events (read-only)              │
        └──────────── observer.js (in the panel) ─────────┘
```

- **Game tab.** An ordinary tab. The extension never injects anything into it.
- **Side panel (`extension/panel/`).** Our UI. It also owns the debugger connection, so observing starts when the panel opens and stops when it closes (`pagehide` detaches).
- **Background service worker (`background.js`).** Only makes the toolbar icon open the side panel. It deliberately holds no state, because MV3 service workers are shut down when idle.

## Attaching

`panel.js` looks for a tab in the current window matching `https://scapewatch.com/*` or `https://*.scapewatch.com/*`, preferring the active one, and attaches to it. If none exists, it shows an **Attach** button and also auto-attaches when a matching tab starts loading. Host permissions exist only so `chrome.tabs.query` can see those URLs.

CDP only reports traffic from after `Network.enable`, so reload the game tab after attaching to capture everything, including the WebSocket handshake.

If you dismiss Chrome's debugging banner, Chrome detaches. `chrome.debugger.onDetach` fires and the panel shows the reason with an **Attach** button.

## Data flow (the observer)

`observeTab(tabId, emit, onDetach)` in `panel/observer.js`:

1. Attaches `chrome.debugger` to the tab through `readOnlyDebugger()`, which wraps it with the allowlist.
2. Sends `Network.enable`, with a 50 MB buffer so bodies can still be read after they arrive.
3. Handles these CDP events (filtered to that tab):
   - `Network.responseReceived`: if the MIME type matches `BODY_MIME` (json, text/plain, event-stream), it remembers `requestId → {url, status}`.
   - `Network.loadingFinished`: for remembered requests, calls `Network.getResponseBody`. This reads Chrome's local buffer and makes no network request. It then emits `{kind:"http", url, status, body, time}`.
   - `Network.webSocketCreated`: emits `{kind:"ws-open", url, time}`.
   - `Network.webSocketFrameReceived` / `Sent`: emits `{kind:"ws-in" | "ws-out", body, opcode, time}`. `ws-out` frames are messages **the game itself** sent. We only see a copy of them.
4. Bodies are truncated to `MAX_PREVIEW` (64 KB).

Other panel code subscribes with `onObserved(cb)`, exported from `panel.js`.

### Observed event shape

```js
{ kind: "http",    url, status, body, time }
{ kind: "ws-open", url, time }
{ kind: "ws-in",   body, opcode, time }   // opcode 1 = text, 2 = binary (base64)
{ kind: "ws-out",  body, opcode, time }
```

## Safety boundary

See the read-only rule in `CLAUDE.md`. The rule is enforced in three places:

1. **Structurally.** The manifest has no content scripts, no web-accessible resources, and no request-modifying permissions.
2. **By the allowlist.** Every CDP call goes through `readonly-policy.js`.
3. **By tests.** `readonly-policy.test.js` asserts that input, script, navigation, interception, UA override and storage-write methods all throw.

## Detectability

The game runs in your real Chrome, so there is no custom-client fingerprint. The page can't list extensions, and with no web-accessible resources there is nothing for it to probe. The debugger banner is browser UI that the page can't see.
