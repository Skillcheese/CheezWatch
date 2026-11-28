// Monte Carlo model of the skilling task queue, for choosing skill weights
// (levers) and which tasks to take. The game's formulas come from its
// Constants.js; the parts the client doesn't ship (how an option picks its
// activity and node, what a task without materials does) are assumptions,
// listed in docs/map-optimizer.md.

export const LEVER_MIN = -5, LEVER_MAX = 5, PROCESSING_LEVER_MIN = -3;
export const BASE_CREDITS = 200;
export const REROLL_COST = 5;
export const REROLL_PER_TASK = 1;
const SUCCESS_BASE = 70;
const OVERFLOW_SECONDS = 0.05;
const ACTION_FLOOR = 2;
const QUANTITY_PER_MILESTONE = 6;
const LUCK_PER_LEVER = 0.002;
const AUTO_PROCESS_XP_SHARE = 0.5;
const AUTO_PROCESS_SKILLS = ["cook", "smith", "craft", "imbue", "brew"];
// Inputs nobody gathers (gold, scrap loot) are treated as always in stock.
const UNTRACKED_INPUTS = new Set(["gold", "scrap_loot"]);

export const leverWeight = (lever) => 10 * Math.pow(1.25, lever);
export const leverCost = (lever) => 25 * (Math.pow(2, Math.abs(lever)) - 1);
export const leverMin = (data, skill) => (data.activities[skill]?.type === "processing" ? PROCESSING_LEVER_MIN : LEVER_MIN);

/** Credits the levers use; `levers` may include luck and quests. */
export function creditsUsed(levers) {
  return Object.values(levers).reduce((s, l) => s + leverCost(l || 0), 0);
}

/** Small fast seeded generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Everything that doesn't change between runs: per activity, where it can be
 * done and how long one success takes there. `profile` is
 * { levels, moveSpeed, backpack, bonus: { skill: { seconds, success, duplicate, save } },
 *   autoBank, autoProcess, luckChance }.
 */
export function prepare(data, profile) {
  const levels = profile.levels ?? {};
  const byId = {};
  for (const skill of data.skills) {
    for (const a of data.activities[skill].list) byId[a.id] = { ...a, skill, type: data.activities[skill].type, nodes: [] };
  }
  data.nodes.forEach((n, i) => { for (const id of n.acts) byId[id]?.nodes.push(i); });
  // Recipes a gathered item can be auto-processed by (Globes of Skills).
  const recipeFor = {};
  for (const a of Object.values(byId)) {
    if (a.type === "processing" && AUTO_PROCESS_SKILLS.includes(a.skill) && a.input && (levels[a.skill] ?? 1) >= a.level) recipeFor[a.input] ??= a;
  }
  const speed = Math.max(1, profile.moveSpeed || 25);
  const cap = Math.max(1, profile.backpack || 28);
  const available = {};
  for (const skill of data.skills) {
    const lvl = levels[skill] ?? 1;
    const b = profile.bonus?.[skill] ?? {};
    available[skill] = data.activities[skill].list
      .filter((a) => a.level <= lvl && byId[a.id].nodes.length)
      .map((a) => {
        const raw = SUCCESS_BASE + Math.max(0, lvl - a.level) + (b.success ?? 0);
        const seconds = Math.max(ACTION_FLOOR, 10 - (lvl - 1) * 0.01 - (b.seconds ?? 0) - Math.max(0, raw - 100) * OVERFLOW_SECONDS);
        const act = byId[a.id];
        const loot = act.loot ? Object.entries(act.loot) : [];
        const itemsPerSuccess = loot.reduce((s, [, p]) => s + p, 0) * (1 + (b.duplicate ?? 0) / 100);
        const auto = act.type !== "processing" && skill !== "plunder" && profile.autoProcess
          ? loot.map(([item, p]) => ({ recipe: recipeFor[item], p })).filter((x) => x.recipe) : [];
        return {
          ...act,
          p: Math.min(1, raw / 100),
          seconds,
          itemsPerSuccess,
          save: Math.min(0.95, (b.save ?? 0) / 100),
          auto,
          dupMult: 1 + (b.duplicate ?? 0) / 100,
        };
      });
  }
  // Node-to-node walking: via the nearest banks along the game's paths, or
  // straight (with a detour allowance) when that's shorter.
  const N = data.nodes.length;
  const dist = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    const a = data.nodes[i];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const b = data.nodes[j];
      const viaBanks = a.bankDist + (data.bankDist[a.bank]?.[b.bank] ?? 0) + b.bankDist;
      dist[i * N + j] = Math.min(viaBanks, Math.hypot(a.x - b.x, a.y - b.y) * 1.3);
    }
  }
  const milestones = Math.floor(Object.values(levels).reduce((s, l) => s + l, 0) / 100);
  return { data, byId, available, dist, N, speed, cap, milestones, profile };
}

/** Rolls one option: skill by lever weight, then a doable activity, then a node hosting it. */
function rollOption(ctx, weights, levers, rand) {
  const { skills, total } = weights;
  let r = rand() * total, skill = skills[skills.length - 1];
  for (let i = 0; i < skills.length; i++) { r -= weights.w[i]; if (r <= 0) { skill = skills[i]; break; } }
  const acts = ctx.available[skill];
  if (!acts.length) return null;
  const act = acts[Math.floor(rand() * acts.length)];
  // Location: weighted by its node weight (10 × 1.25^w, like skills).
  let node = act.nodes[0];
  const nw = weights.nodeCum?.get(act.id);
  if (nw) {
    let r2 = rand() * nw[nw.length - 1];
    for (let i = 0; i < nw.length; i++) if (r2 <= nw[i]) { node = act.nodes[i]; break; }
  } else node = act.nodes[Math.floor(rand() * act.nodes.length)];
  const base = Math.max(10, ctx.data.activities[skill].baseQuantity + (levers[skill] ?? 0) * 10) + ctx.milestones * QUANTITY_PER_MILESTONE;
  const lo = Math.round(base * 0.5), hi = Math.round(base * 1.5);
  const qty = lo + Math.floor(rand() * (hi - lo + 1));
  return { skill, act, node, qty, lucky: rand() < weights.luck };
}

/**
 * Time and XP of doing `o` from node `from` with `bank` stocked as given.
 * Returns { seconds, xp: { skill: n }, done } where done is the successes
 * actually made (processing stops early when the inputs run out).
 */
export function evaluate(ctx, o, from, bank, tracked) {
  const { act, qty, lucky } = o;
  const node = ctx.data.nodes[o.node];
  const travel = from < 0 ? 0 : ctx.dist[from * ctx.N + o.node] / ctx.speed;
  const perAction = lucky ? 2 : 1;
  const p = lucky ? 1 : act.p;
  let done = qty;
  if (act.type === "processing" && tracked && act.input && !UNTRACKED_INPUTS.has(act.input)) {
    const have = bank.get(act.input) ?? 0;
    done = Math.min(qty, Math.floor(have / Math.max(0.05, 1 - act.save)));
  }
  if (done <= 0) return { seconds: travel, xp: {}, done: 0, travel };
  const actions = done / (p * perAction);
  const fails = actions - done / perAction;
  const xp = { [act.skill]: done * act.xp + fails * act.failXp };
  let carried;
  if (act.type === "processing") {
    carried = done * (1 - act.save);
  } else {
    carried = done * act.itemsPerSuccess * (1 - (ctx.profile.autoBank || 0));
    for (const { recipe, p: share } of act.auto) {
      const n = done * share * (ctx.profile.autoProcess || 0);
      xp[recipe.skill] = (xp[recipe.skill] ?? 0) + n * recipe.xp * AUTO_PROCESS_XP_SHARE;
    }
  }
  const trips = Math.floor(carried / ctx.cap);
  const walking = (trips * 2 * node.bankDist) / ctx.speed;
  return { seconds: travel + actions * act.seconds + walking, xp, done, travel };
}

function applyBank(o, done, bank, profile) {
  const { act } = o;
  if (act.type === "processing") {
    if (act.input) bank.set(act.input, Math.max(0, (bank.get(act.input) ?? 0) - done * (1 - act.save)));
    if (act.output) bank.set(act.output, (bank.get(act.output) ?? 0) + done);
    return;
  }
  for (const [item, p] of Object.entries(act.loot ?? {})) {
    const auto = act.auto.find((x) => x.recipe.input === item) ? profile.autoProcess || 0 : 0;
    bank.set(item, (bank.get(item) ?? 0) + done * p * act.dupMult * (1 - auto));
  }
}

const goalValue = (xp, goals) => {
  let v = 0;
  for (const s in xp) v += (goals[s] ?? 0) * xp[s];
  return v;
};

function weightsFor(ctx, levers, nodeLevers) {
  const skills = ctx.data.skills.filter((s) => ctx.available[s].length);
  const w = skills.map((s) => leverWeight(levers[s] ?? 0));
  const luckBase = ctx.profile.luckChance ?? 0.02;
  const luck = Math.max(0, Math.min(0.05, luckBase + ((levers.luck ?? 0) - (ctx.profile.luckLever ?? 0)) * LUCK_PER_LEVER));
  let nodeCum = null;
  if (nodeLevers) {
    nodeCum = new Map();
    for (const s of skills) for (const act of ctx.available[s]) {
      let t = 0;
      nodeCum.set(act.id, act.nodes.map((n) => (t += leverWeight(nodeLevers[n] ?? 0))));
    }
  }
  return { skills, w, total: w.reduce((a, b) => a + b, 0), luck, nodeCum };
}

/**
 * One simulated stretch of play. `policy`:
 *   { mode: "afk" | "active", hours, options (3 or 4), fourth (chance of a 4th),
 *     rerollBelow (active: reroll a row whose best option is under this share
 *     of the running goal XP/hr), automaters (afk: [{ kind, chance }]),
 *     tracked (materials limit processing), startCredits }
 * `goals` is { skill: weight }. Returns totals and per-task records.
 */
export function simulate(ctx, levers, goals, policy, seed, keepTasks = false) {
  const rand = rng(seed);
  const weights = weightsFor(ctx, levers, policy.nodeLevers);
  const limit = (policy.hours ?? 100) * 3600;
  const bank = new Map(Object.entries(policy.bank ?? {}));
  const tracked = policy.tracked !== false;
  let t = 0, at = -1, credits = policy.startCredits ?? 0, rerolls = 0, tasks = 0, value = 0;
  const xp = {}, tasksBySkill = {}, records = keepTasks ? [] : null;
  const rowSize = () => (policy.options ?? 3) + (rand() < (policy.fourth ?? 0) ? 1 : 0);
  const roll = () => {
    const n = rowSize(), row = [];
    for (let i = 0; i < n; i++) { const o = rollOption(ctx, weights, levers, rand); if (o) row.push(o); }
    return row;
  };
  while (t < limit && tasks < 100000) {
    let row = roll();
    if (!row.length) break;
    let pick;
    if (policy.mode === "active") {
      const rate = t > 600 ? value / t : 0;
      for (;;) {
        let best = -1, bestRate = -Infinity;
        row.forEach((o, i) => {
          const e = evaluate(ctx, o, at, bank, tracked);
          const r = goalValue(e.xp, goals) / Math.max(1, e.seconds);
          if (r > bestRate) { bestRate = r; best = i; }
        });
        pick = row[best];
        if (credits >= REROLL_COST && rate > 0 && bestRate < rate * (policy.rerollBelow ?? 0)) {
          credits -= REROLL_COST;
          rerolls++;
          row = roll();
          if (!row.length) break;
          continue;
        }
        break;
      }
    } else {
      pick = afkPick(ctx, row, at, bank, policy.automaters ?? [], rand);
    }
    const e = evaluate(ctx, pick, at, bank, tracked);
    if (tracked) applyBank(pick, e.done, bank, ctx.profile);
    t += e.seconds;
    at = pick.node;
    for (const s in e.xp) xp[s] = (xp[s] ?? 0) + e.xp[s];
    const v = goalValue(e.xp, goals);
    value += v;
    tasks++;
    credits += REROLL_PER_TASK;
    tasksBySkill[pick.skill] = (tasksBySkill[pick.skill] ?? 0) + 1;
    if (records) records.push({ skill: pick.skill, act: pick.act.id, tier: pick.act.tier, node: pick.node, qty: pick.qty, done: e.done, seconds: e.seconds, travel: e.travel, value: v, lucky: pick.lucky, offered: row.length });
  }
  const hours = Math.max(1e-9, t / 3600);
  return { hours, value, valuePerHour: value / hours, xpPerHour: Object.fromEntries(Object.entries(xp).map(([s, v]) => [s, v / hours])), tasks, rerolls, tasksBySkill, records };
}

// The game's task automaters, as the AFK player's only way to choose.
function afkPick(ctx, row, at, bank, automaters, rand) {
  for (const { kind, chance } of automaters) {
    if (!(chance > 0) || rand() >= chance) continue;
    let best = null, score = -Infinity;
    for (const o of row) {
      let s;
      if (kind === "luck") s = o.lucky ? 1 : -1;
      else if (kind === "tier") s = o.act.tier;
      else if (kind === "quantity") s = o.qty;
      else if (kind === "distance") s = at < 0 ? 0 : -ctx.dist[at * ctx.N + o.node];
      else if (kind === "materials") {
        const need = o.act.type === "processing" && o.act.input && !UNTRACKED_INPUTS.has(o.act.input) ? o.qty : 0;
        s = need ? Math.min(1, (bank.get(o.act.input) ?? 0) / need) : 1;
      } else continue;
      if (s > score) { score = s; best = o; }
    }
    if (kind === "luck" && score < 0) continue;
    if (best) return best;
  }
  return row[0];
}

/** Mean of `runs` simulations with seeds seed..seed+runs-1. */
export function averageRuns(ctx, levers, goals, policy, seed, runs) {
  let value = 0, hours = 0, tasks = 0, rerolls = 0;
  const xp = {};
  for (let i = 0; i < runs; i++) {
    const r = simulate(ctx, levers, goals, policy, seed + i);
    value += r.valuePerHour;
    hours += r.hours;
    tasks += r.tasks;
    rerolls += r.rerolls;
    for (const s in r.xpPerHour) xp[s] = (xp[s] ?? 0) + r.xpPerHour[s];
  }
  for (const s in xp) xp[s] /= runs;
  return { valuePerHour: value / runs, xpPerHour: xp, tasksPerHour: tasks / hours, rerollsPerHour: rerolls / hours };
}

/**
 * Local search over levers within the credit budget: single ±1 steps and
 * one-up-one-down swaps, keeping the best until nothing improves. `fixed`
 * levers (quests) are counted against the budget but never moved.
 */
export function optimizeLevers(ctx, start, goals, policy, { budget, seed = 1, runs = 4, fixed = {}, onProgress, maxRounds = 30 } = {}) {
  const keys = [...ctx.data.skills, "luck"];
  const clamp = (k, l) => Math.max(k === "luck" ? LEVER_MIN : leverMin(ctx.data, k), Math.min(LEVER_MAX, l));
  const fits = (lv) => creditsUsed({ ...lv, ...fixed }) <= budget;
  const score = (lv) => averageRuns(ctx, lv, goals, policy, seed, runs).valuePerHour;
  let cur = Object.fromEntries(keys.map((k) => [k, clamp(k, start[k] ?? 0)]));
  // An over-budget start (budget read wrong, or a cheaper target) is walked
  // back toward zero, largest cost first.
  while (!fits(cur)) {
    const k = keys.filter((x) => cur[x]).sort((a, b) => leverCost(cur[b]) - leverCost(cur[a]))[0];
    if (!k) break;
    cur[k] -= Math.sign(cur[k]);
  }
  let best = score(cur);
  const history = [{ levers: { ...cur }, value: best }];
  for (let round = 0; round < maxRounds; round++) {
    const cands = [];
    for (const a of keys) {
      for (const d of [1, -1]) {
        const one = { ...cur, [a]: clamp(a, cur[a] + d) };
        if (one[a] !== cur[a] && fits(one)) cands.push(one);
        // Swaps: one lever up, another down, to move credits between them.
        if (d < 0) continue;
        for (const b of keys) {
          if (b === a) continue;
          const two = { ...one, [b]: clamp(b, cur[b] - 1) };
          if (two[a] !== cur[a] && two[b] !== cur[b] && fits(two)) cands.push(two);
        }
      }
    }
    let improved = null, top = best;
    cands.forEach((c, i) => {
      const v = score(c);
      if (v > top * 1.002) { top = v; improved = c; }
      onProgress?.(round, i + 1, cands.length, best);
    });
    if (!improved) break;
    cur = improved;
    best = top;
    history.push({ levers: { ...cur }, value: best });
  }
  return { levers: cur, value: best, history };
}

/**
 * Steady XP/hr of every (activity, node) for the goal skills, ignoring the
 * walk there: the per-task numbers a player can learn. Sorted best first.
 */
export function rateTable(ctx, goals) {
  const out = [];
  for (const skill of ctx.data.skills) {
    for (const act of ctx.available[skill]) {
      for (const node of act.nodes) {
        const o = { act, node, qty: 100, lucky: false };
        const e = evaluate(ctx, o, -1, new Map(), false);
        const v = goalValue(e.xp, goals);
        if (v <= 0) continue;
        out.push({ skill, act: act.id, tier: act.tier, node, nodeName: ctx.data.nodes[node].name, bankDist: ctx.data.nodes[node].bankDist, perHour: (v / e.seconds) * 3600, xpPerHour: (e.xp[skill] / e.seconds) * 3600 });
      }
    }
  }
  return out.sort((a, b) => b.perHour - a.perHour);
}

/**
 * Turns an active run's task records into rules of thumb: for each goal
 * skill, how its tasks ranked against the run's average, by tier and by node.
 */
export function heuristics(ctx, records, goals) {
  const total = records.reduce((s, r) => s + r.value, 0);
  const secs = records.reduce((s, r) => s + r.seconds, 0) || 1;
  const avg = total / secs;
  const groups = {};
  for (const r of records) {
    if (!(goals[r.skill] > 0)) continue;
    const add = (key, label) => {
      const g = (groups[key] ??= { label, skill: r.skill, n: 0, value: 0, seconds: 0, travel: 0 });
      g.n++;
      g.value += r.value;
      g.seconds += r.seconds;
      g.travel += r.travel;
    };
    add(`${r.skill}|t${r.tier}`, `T${r.tier}`);
    add(`${r.skill}|n${r.node}`, ctx.data.nodes[r.node].name);
  }
  const rows = Object.entries(groups).map(([key, g]) => ({
    key, skill: g.skill, label: g.label, kind: key.includes("|t") ? "tier" : "node", n: g.n,
    perHour: (g.value / g.seconds) * 3600, vsAverage: g.value / g.seconds / (avg || 1), travelShare: g.travel / g.seconds,
  }));
  return { averagePerHour: avg * 3600, rows };
}

/**
 * The free location weights. `tiers` is { bank index: diary tier 0-5 }; each
 * location's weight can be anywhere in ±(its bank's tier). `mode` "node"
 * sets each location on its own, "bank" one weight for all of a bank's
 * locations. Returns { nodeLevers (per node index), groups: [{ key, nodes,
 * range, lever, score }], value, base }.
 */
export function optimizeNodeLevers(ctx, levers, goals, policy, { tiers, mode = "node", runs = 8, seed = 1, passes = 0, onProgress } = {}) {
  const N = ctx.N;
  const range = (n) => tiers[ctx.data.nodes[n].bank] ?? 0;
  // How often each activity is rolled, to weigh what a location saves.
  const wts = weightsFor(ctx, levers);
  const actShare = new Map();
  wts.skills.forEach((s, i) => {
    const acts = ctx.available[s];
    for (const a of acts) actShare.set(a, (wts.w[i] / wts.total) / acts.length);
  });
  // Heuristic per location: time it saves (or costs) against the average
  // location for each activity it hosts, scaled by how often that activity
  // rolls and whether the player would take it. Goal activities count fully;
  // others count too for an AFK player, who has to do them anyway.
  const takeOffGoal = policy.mode === "active" ? 0.15 : 1;
  const score = new Float64Array(N);
  for (const [act, share] of actShare) {
    if (act.nodes.length < 2) continue;
    const goal = (goals[act.skill] ?? 0) > 0 || act.auto.some((x) => (goals[x.recipe.skill] ?? 0) > 0);
    const times = act.nodes.map((n) => evaluate(ctx, { act, node: n, qty: 100, lucky: false }, -1, new Map(), false).seconds);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    act.nodes.forEach((n, i) => { score[n] += share * (goal ? 1 : takeOffGoal) * (mean - times[i]) / mean; });
  }
  const groupsByKey = new Map();
  for (let n = 0; n < N; n++) {
    if (!range(n) || !score[n]) continue;
    const key = mode === "bank" ? `b${ctx.data.nodes[n].bank}` : `n${n}`;
    const g = groupsByKey.get(key) ?? { key, nodes: [], range: range(n), score: 0 };
    g.nodes.push(n);
    g.score += score[n];
    groupsByKey.set(key, g);
  }
  const groups = [...groupsByKey.values()].filter((g) => g.nodes.some((n) => score[n] !== 0));
  const nodeLevers = new Float64Array(N);
  const set = (g, v) => { g.lever = v; for (const n of g.nodes) nodeLevers[n] = v; };
  for (const g of groups) set(g, g.score > 0 ? g.range : -g.range);
  const evalNow = () => averageRuns(ctx, levers, goals, { ...policy, nodeLevers }, seed, runs).valuePerHour;
  // The simulation refinement is off by default: a location's effect is
  // smaller than the noise of a few hundred simulated hours.
  if (!passes) return { nodeLevers: Array.from(nodeLevers), direction: Array.from(nodeLevers, (v, n) => Math.sign(v) || Math.sign(score[n])), groups };
  const base = averageRuns(ctx, levers, goals, policy, seed, runs).valuePerHour;
  let best = evalNow();
  // Refine with the simulation, the least clear-cut locations first: it
  // sees routes between tasks, which the heuristic doesn't.
  const order = [...groups].sort((a, b) => Math.abs(a.score) - Math.abs(b.score)).slice(0, mode === "bank" ? groups.length : 80);
  let step = 0;
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (const g of order) {
      const keep = g.lever;
      for (const v of [g.range, 0, -g.range]) {
        if (v === keep) continue;
        set(g, v);
        const val = evalNow();
        if (val > best * 1.001) { best = val; changed = true; break; }
        set(g, keep);
      }
      onProgress?.(++step, order.length * passes);
    }
    if (!changed) break;
  }
  // Which way each location should go once it has range, for diaryGains.
  const direction = Array.from(nodeLevers, (v, n) => Math.sign(v) || Math.sign(score[n]));
  return { nodeLevers: Array.from(nodeLevers), direction, groups, value: best, base };
}

/**
 * For each bank whose diary isn't finished: goal XP/hr gained by one more
 * tier, keeping the recommended direction for its locations.
 */
export function diaryGains(ctx, levers, goals, policy, { tiers, nodeLevers, direction, runs = 6, seed = 1 }) {
  const base = averageRuns(ctx, levers, goals, { ...policy, nodeLevers }, seed, runs).valuePerHour;
  const out = [];
  ctx.data.banks.forEach((b, bi) => {
    const t = tiers[bi] ?? 0;
    if (t >= 5) return;
    const nodes = [];
    ctx.data.nodes.forEach((n, i) => { if (n.bank === bi) nodes.push(i); });
    if (!nodes.length) return;
    const lv = nodeLevers.slice();
    let any = false;
    for (const n of nodes) {
      const dir = direction[n];
      if (dir) { lv[n] = dir * (t + 1); any = true; }
    }
    if (!any) return;
    const v = averageRuns(ctx, levers, goals, { ...policy, nodeLevers: lv }, seed, runs).valuePerHour;
    out.push({ bank: bi, name: b.name, tier: t, gain: v - base, share: v / base - 1 });
  });
  return out.sort((a, b) => b.gain - a.gain);
}
