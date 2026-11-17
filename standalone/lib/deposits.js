// Per-player deposit totals. The Lab's results only keep wave counts, so each
// player's gather loops are re-run with the Lab's own generateOneLoop up to the
// moment the given wave is cleared (the next wave's spawn).
export const DEPOSITS_MARK = "DEPOSITS BY WAVE";
const SAMPLES = 300;

// "Slot 1   Name               Role" lines from the Lab's ROLE ASSIGNMENT block.
export function slotRoles(text) {
  return [...text.matchAll(/^Slot (\d+)\s+(.+?)\s{2,}(\w+)\s*$/gm)]
    .map((m) => ({ slot: Number(m[1]), name: m[2].trim(), role: m[3] }));
}

export function meanDeposit(G, profile, role, cfg, endTime, samples = SAMPLES) {
  let sum = 0;
  for (let s = 0; s < samples; s++) {
    const rng = G.FAST_RNG_FACTORY.worker(1000 + s, 0);
    let t = 0;
    for (;;) {
      const { deposit } = G.generateOneLoop(profile, role, cfg, rng, t, false);
      if (deposit.time > endTime) break;
      sum += deposit.amount;
      t = deposit.time;
    }
  }
  return sum / samples;
}

export function depositsSection(G, state, text, wave) {
  const slots = slotRoles(text);
  if (!slots.length) return null;
  const cfg = state.game;
  const endTime = cfg.prep_seconds + wave * cfg.wave_interval;
  const lines = [`${DEPOSITS_MARK} ${wave} (mean stat points added to their role)`, "-----------------------------------------------------"];
  for (const s of slots) {
    const profile = state.profiles[s.name];
    if (!profile) continue;
    const amt = meanDeposit(G, profile, s.role, cfg, endTime);
    lines.push(`Slot ${String(s.slot).padEnd(3)} ${s.name.padEnd(18)}  ${s.role.padEnd(8)} ${Math.round(amt).toLocaleString().padStart(8)}`);
  }
  return lines.join("\n");
}
