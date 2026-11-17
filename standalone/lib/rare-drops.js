// Fortress tiered rares, from the game's Constants.js (GAUNTLET_RARE_*).
// Each cleared wave rolls every active band once. A band's chance grows by
// DROP_BASE per wave into the band and stops growing after CAP_L waves.
export const DROP_BASE = 0.0002381;
export const CAP_L = 64;
export const TIERS = [
  { name: "T1", start: 1 }, { name: "T2", start: 21 }, { name: "T3", start: 41 }, { name: "T4", start: 61 },
  { name: "T5", start: 81 }, { name: "C6", start: 101 }, { name: "C7", start: 121 },
];
export const FIRST_WAVE_SEC = 120;
export const WAVE_SEC = 20;

// Rolls a band has had by wave W. The first roll is on the wave after the
// band starts (the owner's spreadsheet: n = W - 1 - 20(k - 1)).
export const rollsBy = (tier, wave) => Math.max(0, wave - tier.start);
const chanceOnRoll = (i) => DROP_BASE * Math.min(i, CAP_L);

export function tierStats(tier, wave) {
  const n = rollsBy(tier, wave);
  let none = 1, expected = 0;
  for (let i = 1; i <= n; i++) { none *= 1 - chanceOnRoll(i); expected += chanceOnRoll(i); }
  const hours = (FIRST_WAVE_SEC + WAVE_SEC * wave) / 3600;
  return {
    rolls: n,
    chanceThisWave: chanceOnRoll(n),
    atLeastOne: 1 - none,
    expected,
    perHourAvg: expected / hours,
    perHourAtWave: chanceOnRoll(n) * 3600 / WAVE_SEC,
  };
}

// First wave by which the band has reached probability p of at least one drop.
export function waveFor(tier, p) {
  let none = 1;
  for (let i = 1; ; i++) {
    none *= 1 - chanceOnRoll(i);
    if (1 - none >= p) return tier.start + i;
  }
}

// The Lab's result text lists "wave: pct%  bars" lines; the most common wave wins.
export function mostLikelyWave(text) {
  let best = null;
  for (const m of text.matchAll(/^\s*(\d+):\s+([\d.]+)%/gm)) {
    const wave = Number(m[1]), pct = Number(m[2]);
    if (!best || pct > best.pct) best = { wave, pct };
  }
  return best;
}

const pct = (x) => `${(100 * x).toFixed(2)}%`;

export function dropsSection(wave, pctOfRuns) {
  const head = ["Tier", "Rolls", "This wave", "≥1 by now", "Expected", "Avg/hr", "Now/hr", "50%", "90%", "99%"];
  const widths = [5, 6, 10, 10, 9, 7, 7, 5, 5, 5];
  const row = (cells) => cells.map((c, i) => String(c)[i ? "padStart" : "padEnd"](widths[i])).join(" ");
  const lines = [
    `RARE DROPS AT WAVE ${wave} (most likely, ${pctOfRuns.toFixed(2)}% of runs)`,
    "----------------------------------------------",
    row(head),
  ];
  let exp = 0, avg = 0, now = 0;
  for (const t of TIERS) {
    const s = tierStats(t, wave);
    exp += s.expected; avg += s.perHourAvg; now += s.perHourAtWave;
    lines.push(row([t.name, s.rolls, pct(s.chanceThisWave), pct(s.atLeastOne), s.expected.toFixed(3),
      s.perHourAvg.toFixed(3), s.perHourAtWave.toFixed(3), waveFor(t, 0.5), waveFor(t, 0.9), waveFor(t, 0.99)]));
  }
  lines.push(row(["All", "", "", "", exp.toFixed(3), avg.toFixed(3), now.toFixed(3), "", "", ""]));
  lines.push("", `Each band's chance per wave grows by ${(100 * DROP_BASE).toFixed(5)}% a wave and stops at ${pct(DROP_BASE * CAP_L)} (${CAP_L} waves in).`,
    "50/90/99%: wave by which that band has given at least one drop with that chance.");
  return lines.join("\n");
}
