# Map Optimizer

`standalone/map.html`: finds skill weights (levers) and task-taking rules for
chosen goal skills by Monte Carlo simulation of the skilling task queue.

- Data: `scripts/extract-map-data.js` copies nodes, activities and bank-to-bank
  path lengths from `app.asar` into `standalone/data/map.json` (gitignored game data;
  shipped only in the deployed bundle).
- Input: the Skills Customization screenshot (`vision/skill-weights.js` reads
  levels, weights from the red/green pips, and the credit total). Speed, backpack
  and per-skill action bonuses come from the main page's import
  (`cheezwatch-skilling-profile` in localStorage).
- Model: `lib/map-sim.js`; runs in `map-worker.js`. Active = pick best XP/hr
  per row incl. walking, reroll weak rows while credits last (tuned threshold).
  AFK = automaters or the first option. Lever search is local search (±1 and
  swaps) within the credit budget.

## Assumptions (not in the client's code)

- An option rolls its skill by weight, then any activity you have the level for
  (uniform), then any node hosting it (uniform).
- Quantity bonus of +6 per 100 total levels is added to the lever-adjusted base.
- Gathering banks each full backpack at the node's nearest bank; walking between
  nodes goes via banks (or straight × 1.3 when shorter).
- A processing task without enough materials processes what the bank holds.
- Lucky tasks: two successes per action. Quests and combat aren't simulated.
