# Architecture

## Processes and views

```
┌──────────────────────── BaseWindow ("ScapeWatch Companion") ─────────────────────────┐
│ ┌──────────── game WebContentsView ────────────┐ ┌──── panel WebContentsView ─────┐ │
│ │ https://scapewatch.com/                      │ │ companion://panel/index.html    │ │
│ │ partition: persist:scapewatch (login kept)   │ │ preload: panel-preload.js       │ │
│ │ NO preload, NO injection, sandboxed          │ │  ├─ Traffic tab (log)           │ │
│ │                                              │ │  └─ Gauntlet Lab tab (iframe →  │ │
│ │                                              │ │      companion://lab/index.html)│ │
│ └──────────────────────────────────────────────┘ └─────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
                 ▲ CDP events (read-only)                     ▲ ipc "observed"
                 └──────────── main process (app/main.js) ────┘
```

- **Main process (`app/main.js`)** owns the window and lays out the two views. The panel is a fixed `PANEL_WIDTH` = 460px on the right, and `panel:toggle` hides it. Main also serves local files and runs the observer.
- **Game view.** It loads the live site exactly as a normal browser would. Its persistent session partition keeps you logged in between launches. Popups the game opens are sent to the system browser through `setWindowOpenHandler`.
- **Panel view.** Our UI. It is sandboxed and context-isolated, and it can only *receive* events.

## The `companion://` scheme

The panel and Gauntlet Lab are served through `protocol.handle("companion", …)` instead of `file://`, because Gauntlet Lab uses a Web Worker and `fetch()` for its config JSON, and both fail under `file://`.

| URL host | Directory |
|---|---|
| `companion://panel/…` | `app/panel/` |
| `companion://lab/…` | `gauntlet_lab/dist/` |

The handler normalizes the path and rejects anything that escapes its root. To serve a new directory, add a host to `LOCAL_ROOTS`.

## Data flow (the observer)

`observeNetwork(webContents, emit)` in `main.js`:

1. Attaches `webContents.debugger` through `readOnlyDebugger()`, which wraps it with the allowlist.
2. Sends `Network.enable`, with a 50 MB buffer so bodies can still be read after they arrive.
3. Handles these CDP events:
   - `Network.responseReceived`: if the MIME type matches `BODY_MIME` (json, text/plain, event-stream), it remembers `requestId → {url, status}`.
   - `Network.loadingFinished`: for remembered requests, calls `Network.getResponseBody`. This reads Chromium's local buffer and makes no network request. It then emits `{kind:"http", url, status, body, time}`.
   - `Network.webSocketCreated`: emits `{kind:"ws-open", url, time}`.
   - `Network.webSocketFrameReceived` / `Sent`: emits `{kind:"ws-in" | "ws-out", body, opcode, time}`. `ws-out` frames are messages **the game itself** sent. We only see a copy of them.
4. Bodies are truncated to `MAX_PREVIEW` (64 KB).

`emit` forwards each event to the panel with `panel.webContents.send("observed", event)`. On the panel side, `window.companion.onObserved(cb)` receives it.

### Observed event shape

```js
{ kind: "http",    url, status, body, time }
{ kind: "ws-open", url, time }
{ kind: "ws-in",   body, opcode, time }   // opcode 1 = text, 2 = binary (base64)
{ kind: "ws-out",  body, opcode, time }
```

## Safety boundary

See the read-only rule in `CLAUDE.md`. The rule is enforced in three places:

1. **Structurally.** The game view has no preload and receives nothing from us.
2. **By the allowlist.** Every CDP call goes through `readonly-policy.js`.
3. **By tests.** `readonly-policy.test.js` asserts that input, script, navigation, interception and storage-write methods all throw.
