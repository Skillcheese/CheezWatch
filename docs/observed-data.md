# Observed game data

What the ScapeWatch site sends and receives, as seen in the Traffic tab. Fill this in as you find things.

Never record session tokens, cookies, emails, or other account secrets here.

## Endpoints / channels

| Kind | URL / pattern | When it appears | What it contains | Useful for |
|---|---|---|---|---|
| HTTP | JSON with `xpForLevel` / `perLevel` | Game load | Total XP needed per level, 1–120 (100+ only for slay/delve/fortify/luck). Level 99 = 50,000,000 XP | XP → level. Parsed by `extension/parsers/xp-table.js` |
| WS in | `player_state` | For **every nearby player**, constantly; `path` only while moving. Hidden from the Traffic log | `path.speed` (px/s), `totalLevel`, `lifeLevel`, position | `movement_speed`. Parsed by `extension/parsers/player-state.js` |
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

## Mapping to Gauntlet Lab

The Gauntlet is the **skilling** raid. Each role uses one gathering and one processing skill (`extension/parsers/gauntlet-roles.js`):

| Role | Gather | Process |
|---|---|---|
| Health | fish | cook |
| Melee | mine | smith |
| Ranged | forage | craft |
| Magic | invoke | imbue |
| Defense | farm | brew |

Tier = `floor(min(gather level, process level) / 10)`. Skill levels not yet located (likely sent once at login; see below).

| Gauntlet Lab field | Source message / field | Notes |
|---|---|---|
| `movement_speed` | `player_state.data.path.speed` | px/s; only present while moving |
| `backpack_size` | _tbd_ | |
| `role_stats[Role].tier` | _tbd_ | |
| `gather_time` / `gather_success` / `double_gather` | _tbd_ | |
| `process_time` / `process_success` | _tbd_ | |
