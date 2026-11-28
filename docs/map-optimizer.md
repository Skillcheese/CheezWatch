# Map Optimizer

`standalone/map.html`: recommends the free location (node) weights your
diaries allow, per location or per whole bank area, for the most goal XP/hr.

- Data: `scripts/extract-map-data.js` copies nodes, activities and bank-to-bank
  path lengths from `app.asar` into `standalone/data/map.json` (gitignored game data,
  shipped only in the deployed bundle).
- Screenshots (dropped, pasted, or scanned from a folder, newest first):
  - Skills Customization (`vision/skill-weights.js`, `vision/automaters.js`): levels,
    skill weights, credit total, and the Task Automaters row (order = priority,
    accent frame = on, faded icon = not owned).
  - Diary (`vision/diary.js`): each bank's `done/total`; tier = floor(5 × done / total).
  - Movement speed, backpack and action bonuses come from the main page's import
    (`cheezwatch-skilling-profile` in localStorage).
- Model (`lib/map-sim.js`, run in `map-worker.js`): a task rolls skill → activity →
  location (10 × 1.25^weight) → quantity. A location's weight goes to ±its bank's
  tier by how much time it saves against the other places offering the same
  activities (bank trips), weighted by how often each activity rolls. A simulated
  refinement exists (`passes`) but is off: one location's effect is below the noise
  of a few hundred simulated hours. Results compare 24 paired runs.

## Assumptions (not in the client's code)

- Activities are equally likely within a skill (activity weights aren't read yet).
- Quantity bonus of +6 per 100 total levels is added to the lever-adjusted base.
- Gathering banks each full backpack at the node's nearest bank; walking between
  nodes goes via banks (or straight × 1.3 when shorter).
- A processing task without enough materials processes what the bank holds.
- Luck chance uses the game's formula without unlocks (the screenshot's % is too dim to read).
- Quests and combat aren't simulated.
