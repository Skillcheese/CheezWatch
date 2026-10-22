# CLAUDE.md

Guide for AI assistants (and humans) working in this repo. Read this first. Deeper docs are in `docs/`.

## What this is

ScapeWatch Companion is a Chrome extension, similar to RuneLite for OSRS. You play https://scapewatch.com/ in a normal Chrome tab, and our read-only tools live in Chrome's side panel. Gauntlet Lab, a third-party simulator for the Gauntlet/Fortress minigame, is embedded as one of those tools.

## THE RULE (never break it)

The extension must **never** send input, change game state, send requests or packets to the server, or alter the game page. It may only **passively read** what the browser already receives.

In practice:
- Never add content scripts, `web_accessible_resources`, `chrome.scripting`, `declarativeNetRequest`, `webRequest` blocking, or anything else that touches the game tab or its requests. Web-accessible resources would also let the page detect the extension.
- Every CDP command must go through `readOnlyDebugger()` in `extension/readonly-policy.js`. Never call `chrome.debugger.sendCommand` directly.
- Only widen the allowlist in `readonly-policy.js` if the user explicitly asks and the method is provably passive. When you do, update `readonly-policy.test.js` in the same change.
- Never fetch game URLs ourselves, even read-only GETs: a fetch is still a request to the server. Use only data the game itself already loaded.
- Data flows one way, from the debugger into the panel. Never add a path from the extension back into the game tab.
- If a feature can't be built under these rules, tell the user. Don't work around them.

## Map

| Path | Role |
|---|---|
| `extension/manifest.json` | MV3 manifest. Permissions: `debugger`, `sidePanel`, host access to scapewatch.com (only so the panel can find the tab). |
| `extension/background.js` | Opens the side panel when the toolbar icon is clicked. Nothing else. |
| `extension/readonly-policy.js` | CDP allowlist (`Network.enable`, `Network.getResponseBody`). This is the safety boundary. |
| `extension/readonly-policy.test.js` | `node:test` tests for the policy. Run with `npm test`. |
| `extension/panel/` | Side panel UI in plain HTML/CSS/JS (ES modules, no build step). `observer.js` attaches the debugger; `panel.js` is the UI. Tabs: Traffic, Gauntlet Lab. |
| `extension/lab/` | Built Gauntlet Lab, copied in by `npm run build:lab`. Generated and gitignored. |
| `gauntlet_lab/` | **Git submodule** (upstream: amulder87/gauntlet_lab, AGPL-3.0). TypeScript, built into `gauntlet_lab/dist/`. |
| `scripts/copy-lab.js` | Copies `gauntlet_lab/dist` into `extension/lab`. |
| `build.cmd` | Double-click builder: runs `npm run build:lab` and prints load instructions. |
| `docs/` | Architecture, data flow, Gauntlet Lab notes, how to add features. |

## Commands

```sh
npm run build:lab    # build gauntlet_lab and copy it into extension/lab
npm test             # read-only policy tests
```

Load in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → pick `extension/`. After code changes, click the reload icon on the extension card.

## Conventions

- Plain JavaScript ES modules in `extension/`, with no bundler or TypeScript. Keep it that way unless the user asks.
- Comments explain *why*, and only sparingly. Use two-space indent and double quotes.
- The environment is Windows 11 with Chrome. Keep `.cmd` files CRLF.
- Commit messages are short imperative subjects and end with the Co-Authored-By trailer.
- Treat `gauntlet_lab/` as upstream code. Prefer integrating from the outside (see `docs/gauntlet-lab.md`) over editing it. If an edit is unavoidable, it has to be committed *inside* the submodule, and the parent repo then records the new submodule commit.

## Current status / next steps

1. ✅ Chrome extension: side panel, passive observer, Traffic log, embedded Gauntlet Lab. (Replaced the earlier Electron app.)
2. ⏳ Find which observed HTTP/WebSocket messages hold player stats and Gauntlet role tiers. Use the Traffic tab while playing. Record findings in `docs/observed-data.md`.
3. ⏳ Write parsers that turn those messages into a `PlayerProfile`.
4. ⏳ Auto-fill Gauntlet Lab's `Me` profile from the parsed state.
