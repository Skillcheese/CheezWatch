# Standalone screenshot tool: handoff

Resume notes for the next session. Branch: `observed-data-parsers`. **Nothing below is committed yet.**

## Latest session (2026-11-12): start here

- **Folder import** (not tried in a browser yet). "Pick screenshots folder" on the card uses `showDirectoryPicker`; the handle is kept in IndexedDB, so "Rescan" works on later visits. It falls back to a `webkitdirectory` input. Dropping several images on the card does the same thing.
  - `standalone/vision/classify.js` sorts each image: Skills (≥25 boxes with skill icons at distance <60), Unlocks (≥20 header icons), Fortify (summary lines), Fortress (`readFortCollection` doesn't throw), else Perks *candidate* (≥10 frames), which only counts if `readPerks` finds the movement line. The test covers all 10 samples.
  - The newest 150 files are checked, newest first. The first good reading of each kind wins, and the scan stops once all 5 are found.
  - `app.js`: `readFile` is split into `analyze(kind, img)` and `store(kind, out)`, and `importFiles` reuses both.

- **Telescopes and compasses** are done via a fifth drop zone, "Unlocks → Perks". It's not tried in a browser yet.
  - `standalone/vision/perks.js` OCRs the whole Perks screenshot and parses the "Total Movement Speed" line. That line lists effective vigor, steps/sec and every source: telescopes, compasses, swift beacons, milestones, collector and fleet foot.
  - A reading is trusted only if base(effective vigor) × (1 + sources) matches the steps/sec shown.
  - With it, Me's movement = steps/sec × (1 + sources + potion) / (1 + sources), which replaces the estimate. The result is remembered in localStorage.
  - Samples: `samples/perks-blue.png` and `samples/perks-brown.png` (brown cropped). The test checks all 8 potion boxes; the game truncates them.
  - Constants: telescopes give 0.5% move (shiny 1%), compasses 0.5%. The headline "+13% Move" is wrong; the movement line is right.
  - Note: the game uses *effective* vigor (69 → 81 with boosts). The duration formula in calc.js still uses the raw level, which may explain part of the duration gap.
  - **Leftovers for the user to delete:** `samples/Screenshot 2026-11-12 165908.png` and `165923.png`.

- The user confirmed that the page works in the browser (Unlocks + Skills import, To do #3).
- **The Fortress screenshot reader is done.** See `docs/fort-items.md` → "Where the import gets them".
  - `standalone/vision/fort-collection.js` and its test. The samples are `samples/fort-blue.png` and `samples/fort-brown.png`; the brown one is cropped to the game panel because the original showed browser tabs.
  - **Leftovers for the user to delete:** the originals `samples/Screenshot 2026-11-12 163448.png` and `163538.png`. The auto-mode classifier blocked the delete. Don't commit them.
  - The page has a third drop zone ("Fortress collection"). It fills the Fortress picker (which now includes Satchels) and writes Me's backpack size: 28 + 4 per Satchel tier. **The new zone hasn't been tried in a browser yet.**
  - `extract-icons.js` also copies the 90 Fortress item icons to `standalone/icons/fort/`. `standalone.cmd` (now CRLF) re-extracts if they're missing.
  - `icons.js` now exports `hungarian`.
  - 51 tests pass.
- `render()` keeps each `<details>` open by `data-key` (fixed).
- The game's `Constants.js` can be extracted for reference with `require("@electron/asar").extractFile("app.asar", path.join("shared","Constants.js"))`. `shared/data/items.json` has the item tiers and `raids.json` the Fortress drop table. Read them into the scratchpad only; never commit them.
- **The Fortify Tree summary reader is done.** See `docs/fortify-tree.md`.
  - `standalone/vision/fortify-summary.js` and its test; samples `samples/fortify-blue.png` and `samples/fortify-brown.png` (brown cropped). Both read exactly.
  - `calc.js` takes `talents`: Fleet Foot adds to movement, Momentum to the flat seconds, Steady Hands and Bounty to success and double.
  - The page has a fourth drop zone ("Fortify Tree"), with its own Tesseract worker. The result is remembered in localStorage. **Not tried in a browser yet.**
  - **Leftovers for the user to delete:** `samples/Screenshot 2026-11-12 164907.png` and `164921.png`. Don't commit them.
  - 55 tests pass.
- **After that:** To do #5 (`docs/standalone.md`, CLAUDE.md map, gitignore `app.asar`, commits). Add `docs/fort-items.md` and `docs/fortify-tree.md` to the docs commit, and put the fort code in the vision/calc/page commits.

## Goal

A standalone local web page, separate from the extension, that hosts Gauntlet Lab. In the Lab's **Profiles** tab, the user drops two screenshots: the **Unlocks** page and the **Skills** panel. From those alone, the tool computes the `Me` profile: role tiers, role stats and movement speed. The only manual input is the movement potion tier (none / Swift 15% / Fleet 30% / Haste 50%).

The user's choices:
- A local web page, not Electron and not inside the extension.
- **Digits are read by template matching** against the game's font, not Tesseract (decided). Tesseract is used only for the "Collections N/M" strip.
- The output is the Gauntlet Lab profile. The import UI lives inside the Lab's Profiles section.
- It must not depend on pixel positions. It has to work at any resolution, with any cropping, and with both themes (blue and brown).
- **The samples get committed** (decided). They were renamed to:
  - `samples/skills-blue.png` (372x503)
  - `samples/skills-brown.png` (402x495)
  - `samples/unlocks-brown.png` (1648x906)
  - `samples/unlocks-blue.png` (1919x1079)

## Source of truth: the game's `Constants.js`

`app.asar` (untracked, at the repo root) is the game's Electron client. `scripts/extract-icons.js` now copies the skill icons **and `ChakraPetch-Bold.ttf`** into `standalone/icons/` (gitignored). Run it with `node scripts/extract-icons.js < /dev/null`. Archive paths use backslashes on Windows, so build them with `path.join`.

Formulas, as implemented in `standalone/calc.js`:
- **Duration.** Base `10 - 0.01*(level-1)`, minus:
  - cape/pet sources × 0.1s, capped at 8 sources. Sources are the own column's pet, shiny_pet, cape and trimmed_cape plus the same rows in the all-skills (`levels`) column.
  - tool seconds: T1 .1, T2 .1, T3 .2, T4 .3, T5 .4, C6 .6, D1/D2/L1/L2 .1. The own column and the lanterns both count.
  - vigor `(v+1)*0.005`.
  - collector `1.0*fraction`.

  The Gauntlet divides the result by 10, with a floor of 0.2.
- **Success.** +1 per source (cape/pet + tool), plus collector `10*fraction`, on the 70 base.
- **Double.** +1% per source, plus collector `10*fraction`, capped at 85%.
- **Movement.** `vigorBaseSpeed(v) * (1 + potion + 0.10*collectorFraction)`.
- **Backpack.** Left unchanged; satchels aren't visible in these screenshots.

## Done (this session plus earlier)

- `standalone/vision/image.js`, `unlock-grid.js`: these were already done. The grid and owned cells are verified on both Unlocks samples.
- `standalone/vision/icons.js`: `assignIcons` now uses an **optimal Hungarian assignment**, with a per-icon "no match" option at cost 90. It returns `[{id, distance}]`. All 4 samples assign correctly; brown defend/delve is fixed and the scrollbar column → null. **To-do #1 is done.**
- `standalone/vision/skills-panel.js`: the wide total-level box is now merged (the gap between two columns that is box background, not frame). Both panels give 31 boxes.
- `standalone/vision/digits.js` (new): template matcher.
  - Ink map = brightness above the crop median. Glyphs = 8-connected blobs.
  - Normalized 12x16 grid, L1 distance + aspect.
  - Templates render ChakraPetch at 4x, are **eroded 0/0.5/1/1.5 px** (the game draws digits lighter than the Bold face; that was the 6→5 cause) and are downsampled at quarter-pixel phases, cached per digit height.
  - `digitTemplates(makeContext, family)` returns `forHeight(px)`. `readNumber(img, templates)` returns `{value, digits:[{digit,distance,ranked}]}`. `fixWithTotal(readings, total)` swaps up to 3 near-tie digits so the sum matches the total box.
  - Result: both panels read **100% correct before any checksum fix**. Best distances are ≤0.17 and the closest margin is 0.04. It takes about 0.2s per panel.
  - Dead ends to avoid: canvas `bold` keyword (no effect), blur in the distance (worse), native-pixel matching (worse), and canvas sub-pixel x offsets (napi-rs ignores them).
- `standalone/vision/read-screens.js` (new): `SKILLS`, `ICON_IDS`, `iconReferences(images)`, plus:
  - `readSkillsPanel(img, refs, templates)` → `{levels, total, checksum: ok|fixed|mismatch, warnings}`.
  - `readUnlocksPage(img, refs)` → `{owned: {skill: Set(rowIds)}, columns, rows, warnings}`.
  - `parseCollections(text)` → `{count,total,fraction}|null`.
- `standalone/calc.js` (new): `unlockSummaries()` rebuilds the `unlock_summaries` shape from owned cells, then reuses `roleStatsFromUnlocks`, `roleTier` and `vigorBaseSpeed` from `extension/parsers/`. `computeProfile({owned, levels, collectorFraction, potion})` → `{roleTiers, roleStats, movementSpeed, unlocks}`. It ran end to end on the brown samples.
- `extension/parsers/lab-profile.js` and its test, plus `docs/observed-data.md`: these were updated earlier (exact movement formula, 0.2 floor, 85% cap). 32 tests pass.
- Packages: dev `pngjs`, `@electron/asar`, `@napi-rs/canvas` (installed); deps `tesseract.js@5`, `@tesseract.js-data/eng`.

### Verified expected values (use in tests)

- skills-blue: life 72, spirit 74, fish 70, cook 73, strike 74, heft 75, mine 69, smith 68, sight 51, draw 51, forage 61, craft 58, focus 50, surge 50, invoke 58, imbue 57, dodge 65, defend 65, farm 65, brew 72, slay 76, vigor 69, plunder 72, barter 64, delve 74, fortify 71, bard 64, discover 68, luck 74, alms 87; total 1997.
- skills-brown: life 10, spirit 1, fish 58, cook 58, strike 6, heft 6, mine 52, smith 46, sight 11, draw 11, forage 56, craft 49, focus 1, surge 1, invoke 49, imbue 44, dodge 1, defend 1, farm 59, brew 56, slay 1, vigor 58, plunder 58, barter 51, delve 1, fortify 56, bard 58, discover 55, luck 54, alms 70; total 1038.
- unlocks-brown owned (checked by eye):
  - levels L1; vigor L1 L2; fortify T1 D1; luck L2; alms L1 L2; fish L1 L2; cook L1; invoke L1; farm L1 L2; brew D1; plunder L1; barter L1 L2; bard L1 L2; discover L1.
  - Everything else is none. Collections 297/2311.
- unlocks-blue owned:
  - levels: pet T1 T2 T3 T4 L1 L2
  - life: T1 T2 T3 D1 L1 L2
  - spirit, strike, heft: T1 T2 T3 L1 L2
  - sight: T1 T2 T3
  - draw: T1 T2 T3 L1
  - focus: T1 T2 T3
  - surge: T1 T2 T3 L1
  - dodge, defend: T1 T2 T3 D1 L1 L2
  - slay: pet T1 T2 T3 L1 L2
  - vigor, delve, fortify, luck: T1 T2 T3 L1 L2
  - alms: pet T1 T2 T3 L1 L2
  - fish: T1 T2 T3 L1
  - cook: pet T1 T2 T3 D1 L1 L2
  - mine, smith: T1 T2 T3 L1 L2
  - forage: T1 T2 T3 L1
  - craft: T1 T2 T3 D1 L1 L2
  - invoke, imbue, farm, brew: T1 T2 T3 L1 L2
  - plunder: pet T1 T2 T3 L1 L2
  - barter: pet T1 T2 T3 L1
  - bard: shiny_pet T1 T2 T3 L1 L2
  - discover: T1 T2 T3 L1 L2

## Known accuracy gap (tell the user / show in the UI)

The screenshots can't show telescopes, compasses or equipped gear (Fortress items and Fortify talents now have their own screenshots). Visible sources gave all-skills −0.52s, but an older live `unlock_summaries` said −1.06s. Movement is also low: 20.5 vs about 22.2 in-game. The page should say these aren't included.

## To do

1. ✅ **Tests** (done: 11 new tests, `npm test` runs them; 43 pass).
   - `standalone/vision/read-screens.test.js`: the expected values above. Skip with `t.skip` when `standalone/icons/` or the font is missing, because they're gitignored and extracted from `app.asar`. In node, load the font with `GlobalFonts.registerFromPath(...)` and `createCanvas(w,h).getContext("2d")` from `@napi-rs/canvas`.
   - `standalone/calc.test.js`: the unit cases (cap of 8 cape/pet sources, tool seconds, collector, potion).
   - Add both to `npm test`.
   - Scratch drivers that already work: `all.mjs`, `read.mjs` in the old session scratchpad. Not needed, just a reference.
2. ✅ **Collector OCR** (done). `standalone/vision/collections.js`: `collectionsRect` (in read-screens.js) crops the band above the section title, right half. `readCollections(img, rect, recognize)` binarizes and upscales at 5 settings (scale 2–5, threshold 0.4–0.6 between median and p99.5), with a char whitelist and PSM 7. A reading that matches the shown % wins; otherwise a ≥2 vote. The node test OCRs both samples correctly (~1s). Raw, un-preprocessed OCR was garbage.
3. 🟡 **Page** (written, **not yet tried in a browser**): `standalone/index.html`, `standalone/app.js`. Paste goes to the highlighted box, then switches to the other one. Results auto-apply to Me and reload the iframe. Check: FontFace load, Tesseract worker paths, the card surviving Lab re-renders, and apply when the Lab has no saved state yet.
   - `standalone/index.html` and `app.js` hold the Lab iframe (`../extension/lab/index.html`).
   - Inject an import card (two drop/paste zones, a potion select, status) at the top of the iframe's `#profiles-panel`. Re-insert it with a MutationObserver.
   - In the browser: decode images to ImageData via canvas; load the font via `new FontFace("ChakraPetchGame", url("icons/ChakraPetch-Bold.ttf"))`; load the icons from `standalone/icons/*.png`.
   - Apply `applyRoleTiers`, the roleStats (like `applyUnlockStats`, but with precomputed stats, or pass `unlocks` straight into `applyUnlockStats(state, unlocks, levels)`) and `applyMovementSpeed` to the `gauntlet-lab-web-current-v3` localStorage state, then reload the iframe. See `syncLabMe` in `extension/panel/panel.js`.
   - Show what was detected (levels table, owned per skill, checksum status, warnings, the accuracy gap).
4. ✅ **Offline serving** (done): `scripts/serve.js` (127.0.0.1:8787, `/` → `/standalone/`), `scripts/copy-tesseract.js` (`npm run build:standalone`), and `standalone.cmd` (CRLF; it also extracts the icons from app.asar if they are missing). Original plan:
   - `scripts/serve.js` (static node server for the repo root).
   - Copy the Tesseract dist, core and eng data into `standalone/vendor/` (`build:standalone` script).
   - `standalone.cmd` (CRLF): build, serve, open the browser.
5. Docs and cleanup:
   - Add `docs/standalone.md`, update the CLAUDE.md map, add a README line.
   - Gitignore `app.asar` (probably yes, it's the game's code).
   - Commit `samples/` and the code in logical pieces:
     1. lab-profile formula updates
     2. vision modules
     3. digits + calc + tests
     4. page
     5. docs

## Constraints

- The extension's read-only rule doesn't apply to this tool, because it only reads local screenshots. Still: no requests to the game.
- Don't edit `gauntlet_lab/`; integrate from the outside.
- Don't commit the game's assets or code (icons, font, `app.asar`).
