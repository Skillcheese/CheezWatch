# Gauntlet Lab (submodule)

Upstream: https://github.com/amulder87/gauntlet_lab (AGPL-3.0). It is a browser-only Monte Carlo simulator and optimizer for ScapeWatch's Gauntlet (Fortress) minigame.

## Build

`npm run build:lab` from the repo root runs `npm install && npm run build` inside the submodule, then `scripts/copy-lab.js` copies `dist/` (minus source maps) into `extension/lab/`, because an extension can only load files inside its own folder. The submodule build does this:

- `tsc -p tsconfig.app.json` compiles `src/core.ts`, `engine.ts`, `optimizer.ts` and `app.ts` into `dist/app.js`. The files are TS namespaces combined into one script, not ES modules.
- `tsc -p tsconfig.worker.json` compiles to `dist/worker.js`, the simulation Web Worker.
- `tools/copy-public.mjs` copies `public/` (`index.html`, `styles.css`, `gauntlet_lab_config.default.json`) into `dist/`.

## Source map

| File | Contents |
|---|---|
| `src/core.ts` | `Gauntlet` namespace: types (`Role`, `RoleStats`, `PlayerProfile`, `GameConfig`, `AppState`, …), RNG, and helpers such as `deepClone` and `cloneFromMe`. |
| `src/engine.ts` | The raid simulation: waves, lanes, gathering/processing, combat, XP. |
| `src/optimizer.ts` | The staged composition search (pre-screen → screening → finalists). |
| `src/worker.ts` | Worker protocol. It receives `{kind:"init", profiles, cfg, realIndex}` and `{kind:"run", …}`, and replies `ready`, `done` or `error`. |
| `src/app.ts` | The `GauntletWeb` UI. It loads the config, persists state, renders the tabs and runs workers. |
| `tests/` | Reference and statistical probes against the original Python model. |

## Key data types

```ts
Role = "Health" | "Melee" | "Ranged" | "Magic" | "Defense"
RoleStats  { tier, gather_time, gather_success, double_gather, process_time, process_success }
PlayerProfile { name, movement_speed, backpack_size, role_stats: Record<Role, RoleStats> }
AppState { profiles, party, game: GameConfig, optimizer, settings }
```

The built-in `Me` profile is the player. `Clone` mirrors `Me` at 90% movement speed through `cloneFromMe`.

## State persistence: the integration point

`app.ts` saves the whole `AppState` to `localStorage["gauntlet-lab-web-current-v3"]` and reads it back on load. The lab runs in an iframe at `chrome-extension://<id>/lab/index.html`, and the panel at `chrome-extension://<id>/panel/index.html`. Those are the **same origin**, so they share localStorage and the panel can reach the iframe directly.

Planned way to auto-fill `Me` without editing upstream code:
1. The panel builds a `PlayerProfile` from observed data.
2. The panel reads `localStorage["gauntlet-lab-web-current-v3"]`, replaces `state.profiles.Me`, and writes it back.
3. The panel reloads the lab iframe so it picks up the new state.

This all happens in our own extension pages, never in the game tab, so it doesn't break the read-only rule.

If upstream changes `STORAGE_KEY` or the `AppState` shape, step 3 must be updated to match.

## Updating the submodule

```sh
cd gauntlet_lab && git pull origin main && cd ..
npm run build:lab
git add gauntlet_lab && git commit -m "Bump gauntlet_lab"
```
