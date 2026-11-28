// Runs the location-weight optimizer off the page's thread.
import { averageRuns, diaryGains, heuristics, optimizeNodeLevers, prepare, simulate } from "./lib/map-sim.js";

const REROLL_STEPS = [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9];
const RUNS = 8;
const HOURS = 200;
const COMPARE_RUNS = 24;

// For an active player: the share of the running XP/hr under which a row is
// rerolled, best first.
function tuneReroll(ctx, levers, goals, policy) {
  let best = { rerollBelow: 0, value: -Infinity };
  for (const rerollBelow of REROLL_STEPS) {
    const v = averageRuns(ctx, levers, goals, { ...policy, rerollBelow }, 1, RUNS).valuePerHour;
    if (v > best.value) best = { rerollBelow, value: v };
  }
  return best.rerollBelow;
}

onmessage = ({ data: msg }) => {
  try {
    const { data, profile, levers, goals, policy: p, tiers, groupMode } = msg;
    const ctx = prepare(data, profile);
    const progress = (stage, done, total) => postMessage({ kind: "progress", stage, done, total });
    const policy = { ...p, hours: HOURS };
    if (policy.mode === "active") {
      progress("Tuning rerolls", 0, 1);
      policy.rerollBelow = tuneReroll(ctx, levers, goals, policy);
    }
    const opt = optimizeNodeLevers(ctx, levers, goals, policy, {
      tiers, mode: groupMode, runs: RUNS,
      onProgress: (i, n) => progress("Simulating location weights", i, n),
    });
    progress("Checking which diaries pay off", 0, 1);
    const gains = diaryGains(ctx, levers, goals, policy, { tiers, nodeLevers: opt.nodeLevers, direction: opt.direction, runs: 12 });
    // Paired runs (same seeds) so the difference isn't lost in noise.
    progress("Comparing", 0, 1);
    const before = averageRuns(ctx, levers, goals, policy, 1000, COMPARE_RUNS);
    const after = averageRuns(ctx, levers, goals, { ...policy, nodeLevers: opt.nodeLevers }, 1000, COMPARE_RUNS);
    // What every diary at tier 5 would be worth, for scale.
    const maxed = optimizeNodeLevers(ctx, levers, goals, policy, { tiers: Object.fromEntries(data.banks.map((b, i) => [i, 5])), mode: groupMode });
    const ceiling = averageRuns(ctx, levers, goals, { ...policy, nodeLevers: maxed.nodeLevers }, 1000, COMPARE_RUNS);
    const run = simulate(ctx, levers, goals, { ...policy, nodeLevers: opt.nodeLevers, hours: 1000 }, 7, true);
    const skillsAt = (n) => [...new Set(data.nodes[n].acts.map((id) => ctx.byId[id]?.skill).filter(Boolean))];
    postMessage({
      kind: "done",
      mode: policy.mode,
      groupMode,
      rerollBelow: policy.rerollBelow ?? 0,
      before, after, ceiling,
      groups: opt.groups.map((g) => ({
        bank: data.nodes[g.nodes[0]].bank, range: g.range, lever: g.lever,
        nodes: g.nodes.map((n) => ({ name: data.nodes[n].name, skills: skillsAt(n), bankDist: data.nodes[n].bankDist })),
      })),
      gains: gains.filter((x) => x.gain > 0).slice(0, 10),
      heuristics: heuristics(ctx, run.records, goals),
    });
  } catch (err) {
    postMessage({ kind: "error", message: err.message });
  }
};
