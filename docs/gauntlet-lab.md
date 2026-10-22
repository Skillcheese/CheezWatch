# Gauntlet Lab (submodule)

Upstream: https://github.com/amulder87/gauntlet_lab (AGPL-3.0). It is a browser-only Monte Carlo simulator and optimizer for ScapeWatch's Gauntlet (Fortress) minigame.

## Build

`npm run build:lab` from the repo root runs `npm install && npm run build` inside the submodule. The build does this:

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

`app.ts` saves the whole `AppState` to `localStorage["gauntlet-lab-web-current-v3"]` and reads it back on load. The lab runs in an iframe at `companion://lab`, and the panel runs at `companion://panel`. Those are **different origins**, so the panel can't read the lab's localStorage directly.

Planned way to auto-fill `Me` without editing upstream code:
1. The panel builds a `PlayerProfile` from observed data.
2. The panel sends it to the iframe with `postMessage`. That needs a small listener in the lab page. The least invasive place for it is a tiny script we inject into `companion://lab/index.html` while serving it from `main.js`. This is our own local page, not the game, so it doesn't break the read-only rule.
3. The listener writes `state.profiles.Me` into the lab's localStorage key and reloads.

If upstream changes `STORAGE_KEY` or the `AppState` shape, step 3 must be updated to match.

## Updating the submodule

```sh
cd gauntlet_lab && git pull origin main && cd ..
npm run build:lab
git add gauntlet_lab && git commit -m "Bump gauntlet_lab"
```
