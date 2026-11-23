// One raid where Me changes role once. A copy of the Lab's simulateOne
// (gauntlet_lab/src/engine.ts) with the swap added, built on the Lab's own
// helpers (G is its Gauntlet namespace), so the two stay comparable. Keep
// it in step with engine.ts when the submodule is bumped.
const EPS = 1e-9;

// plan: { roles, from, to, at } — everyone plays plan.roles except Me, who plays `from` until their deposits add up to
// `at` stat points, then every later trip is `to`. at = Infinity never swaps.
export function simulateSwap(G, profiles, meIndex, plan, cfg, seed) {
  const rngs = profiles.map((_p, i) => G.FAST_RNG_FACTORY.worker(seed, i));
  const current = [...plan.roles];
  current[meIndex] = plan.from;
  let meTotal = 0, swapTime = null;
  const queue = [];
  const push = (ev) => { queue.push(ev); queue.sort((a, b) => a.time - b.time || a.idx - b.idx); };
  for (let i = 0; i < profiles.length; i++) {
    push({ ...G.generateOneLoop(profiles[i], current[i], cfg, rngs[i], 0, false).deposit, idx: i });
  }

  const laneRng = G.FAST_RNG_FACTORY.lane(seed);
  const stats = {};
  for (const r of G.ROLES) stats[r] = cfg.starting_stat;
  let hp = cfg.starting_stat, cleared = 0;
  let active = false, activeHp = 0, activeDef = 0, stack = 0, activeMax = 0;
  const lanes = [0, 0, 0];
  let nextCombat = Infinity, nextWave = cfg.prep_seconds, waveNo = 1;
  let deathTime = cfg.prep_seconds + cfg.wave_interval * (cfg.max_wave + 3);

  const depositsUntil = (t) => {
    while (queue.length && queue[0].time <= t + EPS) {
      const ev = queue.shift();
      stats[ev.role] += ev.amount;
      if (ev.role === "Health") hp += ev.amount;
      if (ev.idx === meIndex) {
        meTotal += ev.amount;
        if (swapTime === null && meTotal >= plan.at) { swapTime = ev.time; current[meIndex] = plan.to; }
      }
      push({ ...G.generateOneLoop(profiles[ev.idx], current[ev.idx], cfg, rngs[ev.idx], ev.time, false).deposit, idx: ev.idx });
    }
  };

  while (waveNo <= cfg.max_wave + 2) {
    depositsUntil(Math.min(nextWave, nextCombat));
    if (nextWave <= nextCombat + EPS) {
      const t = nextWave, l = G.laneAttack(waveNo, cfg, laneRng);
      if (active && activeHp > 0) {
        if (stack >= 2) { deathTime = t; break; }
        activeHp += G.enemyHealth(waveNo, cfg);
        for (let j = 0; j < 3; j++) lanes[j] += l[j];
        stack++;
      } else {
        active = true;
        activeHp = G.enemyHealth(waveNo, cfg);
        lanes[0] = l[0]; lanes[1] = l[1]; lanes[2] = l[2];
        stack = 1;
        nextCombat = t + cfg.combat_interval;
      }
      activeDef = G.enemyDefense(waveNo, cfg);
      activeMax = waveNo;
      waveNo++;
      nextWave = cfg.prep_seconds + (waveNo - 1) * cfg.wave_interval;
      continue;
    }
    const t = nextCombat;
    if (!active) { nextCombat = Infinity; continue; }
    hp -= G.incomingDamage(lanes, stats, cfg);
    if (hp <= 0) { deathTime = t; break; }
    activeHp -= G.outgoingDamage(stats, activeDef, cfg);
    if (activeHp <= 0) {
      cleared = Math.max(cleared, activeMax);
      active = false; activeHp = 0; stack = 0; nextCombat = Infinity;
    } else nextCombat = t + cfg.combat_interval;
  }
  return { cleared, meTotal, swapTime, deathTime };
}

export function emptyStats() {
  return { runs: 0, cleared: 0, meTotal: 0, swaps: 0, swapTime: 0, duration: 0 };
}

export function runPlan(G, profiles, meIndex, plan, cfg, start, count, baseSeed) {
  const s = emptyStats();
  for (let i = start; i < start + count; i++) {
    const r = simulateSwap(G, profiles, meIndex, plan, cfg, baseSeed + i * 1009);
    s.runs++;
    s.cleared += r.cleared;
    s.meTotal += r.meTotal;
    s.duration += r.deathTime;
    if (r.swapTime !== null) { s.swaps++; s.swapTime += r.swapTime; }
  }
  return s;
}

export function mergeStats(a, b) {
  for (const k of Object.keys(a)) a[k] += b[k];
  return a;
}

export function summarize(s) {
  return {
    runs: s.runs,
    meanCleared: s.cleared / s.runs,
    meanMeTotal: s.meTotal / s.runs,
    swapRate: s.swaps / s.runs,
    meanSwapTime: s.swaps ? s.swapTime / s.swaps : null,
    meanDuration: s.duration / s.runs,
  };
}

// Staying put in each role, plus every swap at each threshold, for one team
// (roles of the other slots; Me's entry is ignored).
export function candidatePlans(team, meIndex, roleList, thresholds) {
  const plans = roleList.map((r) => ({ roles: team, from: r, to: r, at: Infinity }));
  for (const from of roleList) for (const to of roleList) {
    if (from === to) continue;
    for (const at of thresholds) plans.push({ roles: team, from, to, at });
  }
  return plans;
}

export function spread(max, steps) {
  return Array.from({ length: steps }, (_v, k) => Math.round(max * (k + 1) / (steps + 1)));
}

// The Lab's Health / Force requirements, checked before and after the swap.
export function meetsRequirements(plan, meIndex, opt) {
  return [plan.from, plan.to].every((me) => {
    const roles = plan.roles.map((r, i) => i === meIndex ? me : r);
    return (!opt.require_health || roles.includes("Health"))
      && (!opt.require_force || roles.some((r) => r === "Melee" || r === "Ranged" || r === "Magic"));
  });
}
