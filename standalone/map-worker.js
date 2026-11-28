// Runs the map optimizer off the page's thread.
import { averageRuns, heuristics, optimizeLevers, prepare, rateTable, simulate } from "./lib/map-sim.js";

const REROLL_STEPS = [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const RUNS = 8;
const HOURS = 200;

// The share of the running XP/hr under which a row is rerolled, best first.
function tuneReroll(ctx, levers, goals, policy) {
  let best = { rerollBelow: 0, value: -Infinity };
  for (const rerollBelow of REROLL_STEPS) {
    const v = averageRuns(ctx, levers, goals, { ...policy, rerollBelow }, 1, RUNS).valuePerHour;
    if (v > best.value) best = { rerollBelow, value: v };
  }
  return best.rerollBelow;
}

function summary(ctx, levers, goals, policy) {
  const avg = averageRuns(ctx, levers, goals, policy, 1000, RUNS);
  return { levers, rerollBelow: policy.rerollBelow ?? 0, ...avg };
}

onmessage = ({ data: msg }) => {
  try {
    const { data, profile, levers, goals, policy, budget, fixed, optimize } = msg;
    const ctx = prepare(data, profile);
    const base = { ...policy, hours: HOURS };
    const progress = (stage, done, total) => postMessage({ kind: "progress", stage, done, total });
    let pol = { ...base };
    if (pol.mode === "active") pol.rerollBelow = tuneReroll(ctx, levers, goals, pol);
    const current = summary(ctx, levers, goals, pol);
    let best = null;
    if (optimize) {
      const opt = optimizeLevers(ctx, levers, goals, pol, {
        budget, fixed, runs: RUNS, seed: 1,
        onProgress: (round, i, n) => progress(`Searching weights, round ${round + 1}`, i, n),
      });
      let bestPol = pol;
      if (pol.mode === "active") bestPol = { ...pol, rerollBelow: tuneReroll(ctx, opt.levers, goals, pol) };
      best = summary(ctx, opt.levers, goals, bestPol);
      pol = bestPol;
    }
    const chosen = best?.levers ?? levers;
    const run = simulate(ctx, chosen, goals, { ...pol, hours: 1000 }, 7, true);
    postMessage({
      kind: "done",
      mode: pol.mode,
      current,
      best,
      heuristics: heuristics(ctx, run.records, goals),
      rates: rateTable(ctx, goals).slice(0, 3000),
      takeRate: Object.fromEntries(Object.entries(run.tasksBySkill).map(([s, n]) => [s, n / run.tasks])),
    });
  } catch (err) {
    postMessage({ kind: "error", message: err.message });
  }
};
