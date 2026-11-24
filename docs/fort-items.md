# Fortress items in the screenshot import

The screenshot import (`standalone/`) only counts what the Unlocks grid and the Skills panel show. The biggest missing piece is the **Fortress (Gauntlet) unlocks**: Ledgers, Banners and Beacons. This doc covers what they do, according to the game's `shared/Constants.js` and `shared/data/items.json` in `app.asar`, and how the import adds them.

## The items

Every family has 7 tiers: T1–T5, then Chaos C6 and C7. In `items.json`, the `tier` index runs from 0 to 6, and every bonus scales with `(index + 1)`, so it runs from 1 (T1) to 7 (C7).

| Family | Item ids | Effect (global, all skills) | Full set |
|---|---|---|---|
| Fortress Ledger | `gauntlet_ledger_t1..t5`, `_c`, `_c7` | 1 action source (+1% success and +1% double), −0.1s per action, +0.25% × (i+1) movement | −0.7s, +7 sources, +7% move |
| Fortress Banner | `gauntlet_banner_*` | 1 action source, +0.25% × (i+1) movement. **No duration**: a team can carry you to a banner. | +7 sources, +7% move |
| Haste Beacon | `beacon_haste_*` | −0.05s × (i+1) per action | −1.40s |
| Swift Beacon | `beacon_swift_*` | +0.5% × (i+1) movement | +14% move |
| Sure Beacon | `beacon_sure_*` | +1% success (one success source) | +7% |
| Bounty Beacon | `beacon_bounty_*` | +1% double-gather (one double source) | +7% |
| Thrift Beacon | `beacon_thrift_*` | +0.5% material save (one save source) | **material save** (a failed process keeps its raw) |

Every beacon also gives +0.25% XP, Ledgers and Banners give +0.25% × (i+1) XP, and the Enchanted Fortification (the Fortify tool, T1–C6) gives +1% × (i+1). `calc.js` `xpBonus` adds these to the Fortify Tree, lantern, cape/pet, telescope and compass XP, and the page scales the Lab's per-action XP by the total.

How these combine with the rest of the formulas (from `Constants.js`):
- The seconds from Ledgers and Haste Beacons are **flat reductions** (`flatReduction` in `actionDurationFinal`). They are not cape/pet sources, so the cap of 8 sources doesn't apply to them. They still respect the 2.0s floor, which becomes 0.2s in the Gauntlet.
- Ledgers and Banners count toward `getTotalActionSources`, so they add to success and double, but they add no seconds through the cape path.
- Movement: Ledger, Banner and Swift bonuses go into the same additive bundle as the potion and the collector: `base(vigor) × (1 + potion + collector + gauntlet + beacon + …)`.

## Where the import gets them

1. **Screenshot of Collections → The Fortress** (`standalone/vision/fort-collection.js`). Its 90 items are Milestone Rewards and Rare Drops. Milestones alternate Banner/Ledger by tier (wave labels are Banners, deposit labels are Ledgers). Rare Drops follow the `items.json` order: Haste, Bounty, Thrift, Sure, Swift, Satchel, then Chef's Spice, Trader's Notes, Corruptor's Idol, Hot Sauce and Enchanted Fortification, which have no Lab stat. Enchanted Fortification has no C7. The reader works like this:
   - Owned items have a thin square frame in the theme's accent colour. The frames are found as pairs of thin horizontal lines, matched on their **right** ends, because the check mark and tier label break the left side.
   - Each framed cell is compared pixel by pixel with all 90 game icons (`assets/icons/items/<id>.png`, 32×32, extracted to `standalone/icons/fort/`). Each icon is drawn as a centred square, 0.85 of the frame size (fitted per screenshot), with the check-mark and label corners masked out. A Hungarian assignment keeps each item to one cell.
   - On both samples, matches cost 0–2 (mean RGB difference) and framed cells from other screens cost 12 or more. A cell above 10 is unmatched. If fewer than 80% of the frames match, the reader throws "doesn't look like The Fortress".
   - It reads the samples `samples/fort-blue.png` and `fort-brown.png` 100% correctly.
2. **Manual picker.** The import card keeps the chips (one row per family, T1…C7). A screenshot overwrites them, and they can still be edited by hand. Either way they're saved in `localStorage`.

**Satchels** give +4 backpack slots per owned tier, on a base of 28 (`Constants.INVENTORY_SLOTS`, `SATCHEL_SLOTS_PER`). `calc.js` `backpackSize(fort)` computes it, and the page writes it to Me, but only once Fortress items have been given (from a screenshot or a chip). That way an unused import doesn't reset a backpack set by hand.

## Other gaps (not Fortress items)

These still aren't counted. They're listed so the UI note stays honest:
- **Telescopes** (+0.5% move each, +1% if shiny) and **compasses** (+0.5% move each, T0–T10): relics and chest tools.
- **Fortify talents:** Momentum (up to −1.0s) and Fleet Foot (movement).
- **Success overflow:** success over 100 turns into −0.05s per point. This doesn't apply on the Lab's base of 70.
- Equipped gear.

## Status

- [x] Doc
- [x] `calc.js`: `fortBonuses(fort)` and fort items wired into `unlockSummaries` and `movementSpeed`, with tests
- [x] Import card: manual Fortress picker, saved and applied
- [x] Screenshot reader for the Fortress items, plus Satchels → backpack size
