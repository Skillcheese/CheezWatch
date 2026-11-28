# Fortress sim calibration

How the Gauntlet Lab's Fortress engine was checked against real runs (2026-11-28), what was changed, and what is still open. Read this before you touch `gauntlet_lab/src/engine.ts` or the `game` block of `gauntlet_lab/public/gauntlet_lab_config.default.json`.

## Sources of truth

- `Constants.js` in the repo root (from `app.asar` `shared/`, gitignored) holds the Fortress constants: `GAUNTLET_*`, `gauntletWaveHealth`, `gauntletDepositValue`, `GAUNTLET_RAW_DEPOSIT_DIVISOR`, `GAUNTLET_CLONE_MOVE_MULT`, `totalMovementSpeed`.
- `app.asar` holds only the Electron wrapper and `shared/` (Constants.js plus data JSON). The code that runs the Fortress (deposits, saves, combat) is server-side and **isn't** in it. Don't fetch it from the game server (THE RULE in CLAUDE.md). Rules that only that code knows have to be measured in game.

## What matches the game (checked)

- Enemy wave health, attack and defense, the ×1.55 step every 20 waves, the stack cap of 3 (overrun) and the deposit values `round(2·1.35^tier)` = `material_values`.
- Node distances: Fortress centre to each gather/process node is about 255 px, and gather to process is 100 px (`nodes.json`, `gauntlet_*` positions).
- Clones walk at 0.9× the host's speed and inherit the potion (`GAUNTLET_CLONE_MOVE_MULT`).
- Movement: the Perks line's steps/sec uses *effective* vigor (59 → 69 with a level boost). `speedWithPotion` scales that figure, so it's already right.
- Trip timing: a stopwatch on a real Defense trip (T7, 37.5 px/s, bag 40) gave 7.1 / 10.9 / 2.5 / 18.3 / 6.7 s (walk / gather / walk / process / walk), 44 s total. The sim's breakdown is 6.8 / 9.9 / 2.7 / 17.6 / 6.8 s.

## Changes made

1. **Damage taken uses the game's shield.** Per lane: `lane × 600 / (600 + 1.5·Defense + matching force)` (`GAUNTLET_DEF_K`, `GAUNTLET_DEF_SHIELD_WEIGHT`). The Lab had fitted `425 / (425 + Defense + force)`. Config: `incoming_constant` 600, `defense_shield_weight` 1.5. The effect on waves is small (about +0.1).
2. **Material save goes into a hidden stash.** Each process rolls the save chance. A save puts one raw into a hidden stash, not back in the bag, so it's never processed. The stash deposits as unprocessed raws: `floor(saved × value / raw_deposit_divisor)`, divisor 3. This replaced the old rule (save only on failure, retried), which did nothing at 100% success. A failed process no longer gets a retry; that part is **unverified** (see Open).
   - A temporary flat `deposit_multiplier` of 1.07 was shipped and then removed. `app.ts` deletes it from saved state on load.
3. **Saved Lab state migrates on load** (`app.ts`, `loadConfig`). A missing `defense_shield_weight` gets 1.5, and `incoming_constant` 425 becomes 600 (a custom value is kept). A missing `raw_deposit_divisor` gets 3.

## The evidence for the stash rule

Real deposits came in about 7% over `40 × value`, with the bag always exactly 40 potions and 100% success:

| Deposit | Expected (40 × value) | Seen | Extra = floor(k × value / 3) |
|---|---|---|---|
| Defense T7 | 640 | 672, 666, 1376 (two), 714 | k = 6, 5, 18, 14 |
| Ranged clone T6 | 480 | 513 | +33 (doesn't fit: should be a multiple of 4) |

Sim against real runs (all clones, Fleet potion):

| Comp | Old Lab | Stash rule | Real |
|---|---|---|---|
| Friend: Health, 3 Ranged, Defense (profile from `samples/1-5.png`) | 82.0 | 83.8 | 83–84 |
| User: Defense, Health, Melee ×2, Ranged (bag 40, 37.5 px/s) | 93.9 | 96.0 | died on 95 |

The user's army stats were about 7% ahead of the old sim at w20 and w40 in every role, clones included. That's how a per-deposit difference was found rather than a speed one.

Other save models were tried and rejected: a saved raw back in the bag and processed again overshoots (Defense trip 793, friend 85.1); a stash paid at full value also overshoots (763, 86.8).

## Open

- The sim is about one wave high for the user's comp (96 vs 95). Suspects: the Ranged +33 reading, and how the stash is valued or paid out for other roles. Next step: more clone deposits (stat before and after) for Ranged and Health.
- Whether a save on a *failed* process retries or goes to the stash. It can't be tested while everyone is at 100% process success.

## Stale workers after a deploy

`scripts/bundle-site.js` stamps script URLs with `?v=<stamp>` but leaves `lab/` alone. The Lab's `new Worker("worker.js")` was therefore unstamped, and browsers kept running a cached old engine. The main sim and the optimizer then disagreed with the role swap, which fetches `lab/worker.js?v=…`. The bundler now stamps that one call too and fails if it can't find it.

If a browser still runs an old engine, open `/lab/worker.js` and hard-refresh it, or tick "Disable cache" in DevTools and reload. Don't use "Clear site data": it wipes the Lab's saved state.

## Re-running the checks

The scratch scripts loaded `standalone/lab/worker.js` in Node with `new Function("self", src + "\n;return Gauntlet;")({})` and called `Gauntlet.simulateOne(profiles, roles, 0, cfg, seed)` and `generateOneLoop` (for one trip's deposit). To try a rule change, string-replace the compiled source before evaluating it, then compare per-trip deposits and the mean wave against the tables above.
