# Fortify Tree in the screenshot import

Status: **done** (2026-11-12), but the page zone hasn't been tried in a browser yet.

## What it does

The Fortify Tree (Collections window → 5th tab, "Fortify Tree", "Skilling Raid Mastery") shows a **stat summary in its top-left corner**: the totals of every allocated talent. The import reads only that text, not the tree itself, and feeds four stats into the profile calc.

- **Reader:** `standalone/vision/fortify-summary.js`.
  - `findSummaryLines` finds accent-coloured pixels (bright and saturated) in the upper-left 30%×50%. Row projection gives bands, and each band is split again at 35% of its own peak, because descenders and a faint tree branch otherwise bridge neighbouring lines.
  - The block is the longest run of lines that share a left edge and an even pitch of at most 3.5× the line height. The pitch limit rejects the Fortress page's item rows.
  - `readFortifySummary` OCRs each line (binarize + upscale, 4 settings, 2 matching votes win) and picks the cluster by keyword. Dimmed zero lines aren't accent-coloured, so they're never read and count as 0.
  - Fixes for OCR quirks: the dropped decimal point ("275%" → 2.75 when over the cluster max) and "s" read as 8 or 5 in "-0.6s".
- **Calc (`standalone/calc.js` → `talentBonuses`):** Fleet Foot adds `pct/100` into the movement bundle. Momentum is added to the flat seconds stack. Steady Hands and Bounty add percentage points to success and double, the same way the Collector does.
- **Page:** the 4th drop zone "Fortify Tree". The result is saved under `standalone-import-talents` in localStorage. The zone uses its own Tesseract worker because its OCR parameters differ from the Collections strip.

## Verification of the game rules

- **Movement:** confirmed. Constants.js says `opts.talent` is the Fleet Foot fraction, added into the same bundle as potion and collector.
- **Momentum:** confirmed as flat seconds. The Constants.js duration budget lists "Fortify Momentum: talent cluster = -1.00s" with Haste Beacons, Collector and Vigor, and the Collector comment says action seconds "join the same flat stack as beacons/vigor/talents" (inside the 2.0s floor, not part of the 8 cape/pet cap).
- **Success / double:** **inferred, not confirmed.** The server code that applies `successPct`/`doubleGatherPct` isn't in `app.asar` (only `shared/` and `electron/`). They're modelled like the Collector's success and double, which are added directly to those lines. Overflow and caps are handled downstream by `roleStatsFromUnlocks` as for any source.

## Samples

`samples/fortify-blue.png` and `samples/fortify-brown.png` (brown cropped to the game panel). Text read by eye, used as test expectations:

| Line | blue | brown |
|---|---|---|
| movement speed | +2.75% | +2.25% |
| success chance | +5% | +3.5% |
| save material | +1.25% | +1% |
| double gather | +10% | +8% |
| skilling XP | +1.75% | +4.5% |
| Fortify XP | +4% | +3.5% |
| action time | -0.6s | -0.54s |
| XP (all skills) | +3% | +1.5% |
| HP per food | +0 (dimmed) | +0 (dimmed) |
| barter panel XP | +0 × (10 × Barter level) (dimmed) | same |

The text is small (~8px tall at 1080p), bold, in the theme accent colour (blue or yellow). Zero-value lines are dimmed grey. The lines always appear in cluster order (below).

## Game data (from `app.asar`, `shared/data/raid-trees.json` → `fortify.clusters`)

| Cluster | effect key | Summary unit | Max total | Lab relevance |
|---|---|---|---|---|
| Fleet Foot | `moveSpeedPct` | % movement speed | 7 | **movement** |
| Steady Hands | `successPct` | % success chance | 7 | **success** |
| Thrift | `saveMaterialPct` | % save material | 6.75 | **material save** |
| Bounty | `doubleGatherPct` | % double gather | 18 | **double gather** |
| Diligence | `skillingXpPct` | % skilling XP | 5 | none |
| Fortifier's Insight | `fortifyXpPct` | % Fortify XP | 10 | none |
| Momentum | `actionTimeSec` | s action time (negative) | 1.0 | **action duration** |
| Enlightenment | `globalXpPct` | % XP (all skills) | 13.25 | none |
| Hearty Meals | `foodHeal` | HP per food | 12 | none |
| Broker's Favor | `barterPanelXp` | × (10 × Barter level) barter panel XP | 1 | none |

All are `scope: "global"` except Fortifier's Insight (`raid`).
