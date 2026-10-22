# CLAUDE.md

Guide for AI assistants (and humans) working in this repo. Read this first. Deeper docs are in `docs/`.

## What this is

ScapeWatch Companion is an Electron desktop app, similar to RuneLite for OSRS. It shows the real https://scapewatch.com/ in a left pane and our own read-only tools in a right-hand side panel. Gauntlet Lab, a third-party simulator for the Gauntlet/Fortress minigame, is embedded as one of those tools.

## THE RULE (never break it)

The app must **never** send input, change game state, send requests or packets to the server, or alter the game page. It may only **passively read** what the browser already receives.

In practice:
- Never add a `preload` to the game view, call `executeJavaScript` / `insertCSS` on it, or use `session.webRequest`, `protocol.intercept*`, or the CDP `Fetch` domain.
- Every CDP command must go through `readOnlyDebugger()` in `app/readonly-policy.js`. Never call `webContents.debugger.sendCommand` directly.
- Only widen the allowlist in `readonly-policy.js` if the user explicitly asks and the method is provably passive. When you do, update `readonly-policy.test.js` in the same change.
- Never fetch game URLs ourselves, even read-only GETs: a fetch is still a request to the server. Use only data the game itself already loaded.
- The panel gets data **one way**, main → panel over IPC (`observed` channel). Never add an IPC path that reaches the game view.
- If a feature can't be built under these rules, tell the user. Don't work around them.

## Map

| Path | Role |
|---|---|
| `app/main.js` | Electron main process. Builds the window (game view + panel view), serves local files over `companion://`, attaches the passive network observer, and forwards events to the panel. |
| `app/readonly-policy.js` | CDP allowlist (`Network.enable`, `Network.getResponseBody`). This is the safety boundary. |
| `app/readonly-policy.test.js` | `node:test` tests for the policy. Run with `npm test`. |
| `app/panel-preload.js` | Exposes `window.companion.onObserved(cb)` and `togglePanel()` to the panel. |
| `app/panel/` | Panel UI in plain HTML/CSS/JS, no framework or build step. Tabs: Traffic, Gauntlet Lab. |
| `gauntlet_lab/` | **Git submodule** (upstream: amulder87/gauntlet_lab, AGPL-3.0). TypeScript, built into `gauntlet_lab/dist/`. |
| `run.cmd` | Double-click launcher: installs deps and builds the lab if missing, then runs `npm start`. |
| `docs/` | Architecture, data flow, Gauntlet Lab notes, how to add features. |

## Commands

```sh
npm install          # Electron (devDependency)
npm run build:lab    # npm install + build inside gauntlet_lab → gauntlet_lab/dist
npm test             # read-only policy tests
npm start            # launch the app (or double-click run.cmd)
```

## Conventions

- Plain CommonJS JavaScript in `app/`, with no bundler or TypeScript. Keep it that way unless the user asks.
- Comments explain *why*, and only sparingly. Use two-space indent and double quotes.
- The environment is Windows 11 and the user launches the app through `run.cmd`. Keep `.cmd` files CRLF.
- Commit messages are short imperative subjects and end with the Co-Authored-By trailer.
- Treat `gauntlet_lab/` as upstream code. Prefer integrating from the outside (see `docs/gauntlet-lab.md`) over editing it. If an edit is unavoidable, it has to be committed *inside* the submodule, and the parent repo then records the new submodule commit.

## Current status / next steps

1. ✅ Shell, passive observer, Traffic log, embedded Gauntlet Lab.
2. ⏳ Find which observed HTTP/WebSocket messages hold player stats and Gauntlet role tiers. Use the Traffic tab while playing. Record findings in `docs/observed-data.md`.
3. ⏳ Write parsers that turn those messages into a `PlayerProfile`.
4. ⏳ Auto-fill Gauntlet Lab's `Me` profile from the parsed state.
