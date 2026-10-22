# Observed game data

What the ScapeWatch site sends and receives, as seen in the Traffic tab. Fill this in as you find things.

Never record session tokens, cookies, emails, or other account secrets here.

## Endpoints / channels

| Kind | URL / pattern | When it appears | What it contains | Useful for |
|---|---|---|---|---|
| HTTP | JSON with `xpForLevel` / `perLevel` | Game load | Total XP needed per level, 1–120 (100+ only for slay/delve/fortify/luck). Level 99 = 50,000,000 XP | XP → level. Parsed by `extension/parsers/xp-table.js` |
| WS in | `player_state` | For **every nearby player**, constantly; `path` only while moving. Hidden from the Traffic log | `path.speed` (px/s), `totalLevel`, `lifeLevel`, position | `movement_speed`. Parsed by `extension/parsers/player-state.js` |
| WS in | `ledger_data` | On login / returning to the tab (`reason: "return"`, `awayMs`) | Full account snapshot: skills, bank, stats. `now` = current; `last`, `day`, `week` = older snapshots | **Skill levels + XP → role tiers.** Parsed by `extension/parsers/ledger.js` |
| WS in | `batch` → `unlock_summaries` | Opening the **[Q] Unlocks** menu (sent twice in one batch) | Per-skill bonus lines from unlocks | Gather/process bonuses, move speed. Parsed by `extension/parsers/unlock-summaries.js` |

## Message shapes

<!-- Paste a trimmed, anonymized example per message type. -->

### `unlock_summaries`

```json
{ "type": "batch", "data": [ { "type": "unlock_summaries", "data": { "summaries": {
  "all_skills": ["+6% all XP", "+1 effective combat level", "-1.06s all durations", "+3% success",
                 "+1.01% crit chance", "+1.16% crit damage", "+1 min hit", "+7.81% move speed"],
  "life":  ["+11.81% XP", "+1 effective level", "+1.01% crit chance", "+1.16% crit damage", "+1 min hit"],
  "fish":  ["+16.06% XP", "-1.06s duration", "+6.31% duplicate", "+6.81% success"],
  "cook":  ["+16.06% XP", "-1.06s duration", "+3.06% save", "+6.81% success"],
  "slay":  ["+11.81% XP"]
} } } ] }
```

Skill keys seen: combat `life spirit strike heft sight draw focus surge dodge defend`; gathering (`duplicate`) `fish mine forage farm invoke plunder bard vigor`; processing (`save`) `cook smith craft imbue brew barter`; `discover` (no duplicate/save); XP-only `slay luck alms delve fortify`.

Lines are bonuses only; it carries **no skill levels, gauntlet role tiers, or backpack size**. Format is `<signed number><%|s|none> <label>`.

### `ledger_data`

Each snapshot (`now`, `last`, `day`, `week`) has the same keys (`v: 3`):

| Key | Meaning |
|---|---|
| `at` | Snapshot time (ms) |
| `sk` | `{ skill: [level, totalXp] }` for all 30 skills |
| `tk` | Per-skill counts for gathering/processing skills only (meaning unconfirmed; maybe tasks or unlock tiers) |
| `st` | Lifetime stats: `travelPx`, `teleports`, `potions`, `kills`, `deaths`, `food`, `chests`, `scrollSteps` |
| `m` | Progress counters: `coll`, `quests`, `qsteps`, `diary`, `scrolls`, `credits`, `reroll`, … |
| `rd` | Raid completions: `gauntlet`, `dire`, `fell`, `feeble`, `savage`, `ancient` |
| `bk` | Bank item counts (includes `gold`, `bloodcoins`) |
| `iv` | Inventory item counts |
| `un` | Unlocked tools/upgrades (item id → 1) |
| `pc` | Pets/capes per skill, `[0, 0]` pairs (meaning unconfirmed) |

Also top-level `createdAt` (account creation) and `stepPx`.

```json
{ "type": "ledger_data", "data": { "reason": "return", "awayMs": 14862, "now": {
  "v": 3, "at": 1792677533552,
  "sk": { "fish": [44, 227557], "cook": [37, 108654], "...": [] },
  "rd": { "gauntlet": 97 }, "iv": { "raw_squid": 11 } } } }
```

## Mapping to Gauntlet Lab

The Gauntlet is the **skilling** raid. Each role uses one gathering and one processing skill (`extension/parsers/gauntlet-roles.js`):

| Role | Gather | Process |
|---|---|---|
| Health | fish | cook |
| Melee | mine | smith |
| Ranged | forage | craft |
| Magic | invoke | imbue |
| Defense | farm | brew |

Tier = `floor(min(gather level, process level) / 10)`. Skill levels come from `ledger_data.now.sk`.

| Gauntlet Lab field | Source message / field | Notes |
|---|---|---|
| `movement_speed` | `player_state.data.path.speed` | px/s; only present while moving |
| `backpack_size` | `ledger_data.now.un` | 28 + 4 per satchel. Satchels assumed to be `extender_t<n>` (only `extender_t1` seen; unconfirmed) |
| `role_stats[Role].tier` | `ledger_data.now.sk` | Via `roleTier()`; `extractLedger` returns `roleTiers` |
| `gather_time` / `gather_success` / `double_gather` | `unlock_summaries` | `roleStatsFromUnlocks()` in `lab-profile.js`. See assumptions below |
| `process_time` / `process_success` | `unlock_summaries` | Same |

Unlock → Gauntlet assumptions (from the player; unverified):
- Base is Gauntlet Lab's T0: 1s, 75% success, 0% double.
- Gauntlet actions take 1/10 of overworld time, so time = 1 + skill `duration` × 0.1. The per-skill `duration` line equals `all_durations` for every skill seen so far, so they are **not** summed.
- Success = 75% + `all_skills.success` + skill `success`. Double = gather skill's `duplicate`.
- Processing `save` has no Gauntlet Lab field and is ignored. Tier isn't used in these numbers.
