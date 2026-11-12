# Gauntlet Lab (submodule)

Upstream: https://github.com/amulder87/gauntlet_lab (AGPL-3.0). It is a browser-only Monte Carlo simulator and optimizer for ScapeWatch's Gauntlet (Fortress) minigame.

## Build

`npm run build:lab` from the repo root runs `npm install && npm run build` inside the submodule, then `scripts/copy-lab.js` copies `dist/` (minus source maps) into `standalone/lab/`, so the page and the Lab are served from the same origin. The submodule build does this:

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

`app.ts` saves the whole `AppState` to `localStorage["gauntlet-lab-web-current-v3"]` and reads it back on load. The Lab runs in an iframe at `lab/index.html` next to the page, so they share an origin and localStorage.

How `Me` is filled without editing upstream code (`standalone/app.js` + `standalone/lib/lab-profile.js`):
1. The page builds the profile from the screenshot readings (`calc.js`).
2. It reads `localStorage["gauntlet-lab-web-current-v3"]`, updates `state.profiles.Me`, and writes it back.
3. It reloads the Lab iframe so it picks up the new state.

If upstream changes `STORAGE_KEY` or the `AppState` shape, `LAB_STORAGE_KEY` and the `apply*` helpers in `standalone/lib/lab-profile.js` must be updated to match.

## Updating the submodule

```sh
cd gauntlet_lab && git pull origin main && cd ..
npm run build:lab
git add gauntlet_lab && git commit -m "Bump gauntlet_lab"
```
