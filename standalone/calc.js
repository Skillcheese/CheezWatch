// Turns what the screenshots show (owned unlock cells, skill levels, the
// collection-log fraction) into Gauntlet Lab's Me profile. It rebuilds the
// same per-skill bonus lines the game sends as `unlock_summaries`, so the
// extension's calibrated formulas in lab-profile.js apply unchanged.
// Rules are from the game client's shared/Constants.js.
import { ROLE_SKILLS, roleTier } from "../extension/parsers/gauntlet-roles.js";
import { roleStatsFromUnlocks, vigorBaseSpeed } from "../extension/parsers/lab-profile.js";
import { speedWithPotion } from "./vision/perks.js";

export const CAPE_PET_ROWS = ["pet", "shiny_pet", "cape", "trimmed_cape"];
// Seconds each tool shaves off its skill's actions (lanterns: every skill).
export const TOOL_SECONDS = { T1: 0.1, T2: 0.1, T3: 0.2, T4: 0.3, T5: 0.4, C6: 0.6, D1: 0.1, D2: 0.1, L1: 0.1, L2: 0.1 };
export const POTIONS = { none: 0, swift: 0.15, fleet: 0.3, haste: 0.5 };
// Fortress (Gauntlet) unlocks: seven tiers per family, bonuses scale with
// the tier's position (T1 = 1 ... C7 = 7). See docs/fort-items.md.
// Satchels give no stat bonus; each owned tier adds backpack slots.
export const FORT_FAMILIES = ["ledger", "banner", "haste", "swift", "sure", "bounty", "thrift", "satchel"];
export const FORT_TIERS = ["T1", "T2", "T3", "T4", "T5", "C6", "C7"];
const FORT = { ledgerSeconds: 0.1, milestoneMove: 0.0025, hasteSeconds: 0.05, swiftMove: 0.005 };
// Constants.INVENTORY_SLOTS and SATCHEL_SLOTS_PER.
const BASE_BACKPACK = 28;
const SLOTS_PER_SATCHEL = 4;

const DURATION_PER_CAPE_PET = 0.1;
const MAX_CAPE_PET_SOURCES = 8;
const VIGOR_SECONDS_PER_LEVEL = 0.005;
const COLLECTOR = { seconds: 1.0, success: 10, double: 10, move: 0.10 };
// Fortify Tree talent totals, as read from the tree's stat summary (see
// docs/fortify-tree.md): { moveSpeedPct, successPct, doubleGatherPct, actionTimeSec }.
// Momentum joins the flat seconds stack; the others add like the Collector's.
export function talentBonuses(t = {}) {
  return {
    seconds: Math.abs(t.actionTimeSec ?? 0),
    success: t.successPct ?? 0,
    double: t.doubleGatherPct ?? 0,
    move: (t.moveSpeedPct ?? 0) / 100,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

function countRows(set, rows) {
  let n = 0;
  for (const r of rows) if (set?.has(r)) n++;
  return n;
}

function toolSeconds(set) {
  let s = 0;
  for (const [row, sec] of Object.entries(TOOL_SECONDS)) if (set?.has(row)) s += sec;
  return s;
}

/**
 * Global bonuses from owned Fortress items, `fort` being { family: Set(tiers) }:
 * { sources, seconds, success, double, move }. Ledgers and Banners are action
 * sources (success and double); Ledgers and Haste Beacons cut flat seconds.
 */
export function fortBonuses(fort = {}) {
  const ranks = (family) => [...(fort[family] ?? [])].map((t) => FORT_TIERS.indexOf(t) + 1).filter((r) => r > 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const ledger = ranks("ledger"), banner = ranks("banner");
  return {
    sources: ledger.length + banner.length,
    seconds: ledger.length * FORT.ledgerSeconds + sum(ranks("haste")) * FORT.hasteSeconds,
    success: ranks("sure").length,
    double: ranks("bounty").length,
    move: (sum(ledger) + sum(banner)) * FORT.milestoneMove + sum(ranks("swift")) * FORT.swiftMove,
  };
}

/**
 * Per-skill bonus lines like the game's unlock_summaries, parsed:
 * { all_skills: { all_durations, success }, fish: { duration, success, duplicate }, ... }.
 * `owned` is { skill: Set(row ids) } with the all-skills column under "levels".
 */
export function unlockSummaries({ owned, levels, collectorFraction = 0, fort, talents }) {
  const f = fortBonuses(fort), t = talentBonuses(talents);
  const all = owned.levels ?? new Set();
  const allCapePet = countRows(all, CAPE_PET_ROWS);
  const allTools = countRows(all, Object.keys(TOOL_SECONDS));
  const flat = ((levels?.vigor ?? 0) + 1) * VIGOR_SECONDS_PER_LEVEL + COLLECTOR.seconds * collectorFraction + f.seconds + t.seconds;
  const summary = (capePet, tools, toolSec) => {
    const sources = capePet + tools + f.sources;
    const seconds = Math.min(MAX_CAPE_PET_SOURCES, capePet) * DURATION_PER_CAPE_PET + toolSec + flat;
    return {
      duration: -round2(seconds),
      success: round2(sources + f.success + t.success + COLLECTOR.success * collectorFraction),
      duplicate: round2(sources + f.double + t.double + COLLECTOR.double * collectorFraction),
    };
  };
  const base = summary(allCapePet, allTools, toolSeconds(all));
  const out = { all_skills: { all_durations: base.duration, success: base.success } };
  for (const { gather, process } of Object.values(ROLE_SKILLS)) {
    for (const skill of [gather, process]) {
      const own = owned[skill] ?? new Set();
      out[skill] = summary(
        allCapePet + countRows(own, CAPE_PET_ROWS),
        allTools + countRows(own, Object.keys(TOOL_SECONDS)),
        toolSeconds(all) + toolSeconds(own),
      );
    }
  }
  return out;
}

/** Movement speed in px/s from vigor, the active potion, the collector, Fortress items and Fleet Foot. */
export function movementSpeed(vigorLevel, potion = "none", collectorFraction = 0, fort, talents) {
  const bonus = (POTIONS[potion] ?? 0) + COLLECTOR.move * collectorFraction + fortBonuses(fort).move + talentBonuses(talents).move;
  return Math.round(vigorBaseSpeed(vigorLevel) * (1 + bonus) * 10) / 10;
}

/** Carried-bag slots: the base inventory plus 4 per owned Satchel tier. */
export function backpackSize(fort) {
  return BASE_BACKPACK + SLOTS_PER_SATCHEL * (fort?.satchel?.size ?? 0);
}

/**
 * Everything the Lab's Me profile needs from the screenshots:
 * { roleTiers, roleStats, movementSpeed, backpackSize, unlocks }.
 * `perks` (vision/perks.js) is the game's own movement breakdown, telescopes
 * and compasses included; when given, it replaces the estimate.
 */
export function computeProfile({ owned, levels, collectorFraction = 0, potion = "none", fort, talents, perks }) {
  const unlocks = unlockSummaries({ owned, levels, collectorFraction, fort, talents });
  const roleTiers = {};
  for (const [role, { gather, process }] of Object.entries(ROLE_SKILLS)) {
    roleTiers[role] = roleTier(role, levels[gather] ?? 1, levels[process] ?? 1);
  }
  return {
    roleTiers,
    roleStats: roleStatsFromUnlocks(unlocks, levels),
    movementSpeed: perks
      ? speedWithPotion(perks, POTIONS[potion] ?? 0)
      : movementSpeed(levels.vigor ?? 0, potion, collectorFraction, fort, talents),
    backpackSize: backpackSize(fort),
    unlocks,
  };
}
