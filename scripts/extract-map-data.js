// Copies what the map optimizer needs out of the game's app.asar (nodes,
// activities, skill list and bank-to-bank walking distances) into
// standalone/data/map.json. It stays local (gitignored): it's game data.
import { extractFile } from "@electron/asar";
import fs from "node:fs";
import path from "node:path";

const asar = path.resolve(process.argv[2] ?? "app.asar");
if (!fs.existsSync(asar)) {
  console.error(`No app.asar at ${asar}. Pass its path: node scripts/extract-map-data.js <path to app.asar>`);
  process.exit(1);
}
const read = (p) => JSON.parse(extractFile(asar, path.join("shared", "data", p)).toString("utf8"));

const skills = read("skills.json").skills.filter((s) => s.rollable).map((s) => s.id);
const activities = {};
for (const skill of skills) {
  const a = read(path.join("activities", `${skill}.json`));
  activities[skill] = {
    type: a.type,
    baseQuantity: a.baseQuantity,
    list: a.activities.map((x) => {
      const loot = x.lootTable ?? [];
      const total = loot.reduce((s, l) => s + l.weight, 0);
      return {
        id: x.activityId,
        tier: x.tier,
        level: x.levelRequired,
        xp: x.successXP,
        failXp: x.failXP,
        input: x.input ?? null,
        output: x.output ?? null,
        // Items per success, by item id (gathering).
        loot: total ? Object.fromEntries(loot.filter((l) => l.itemId).map((l) => [l.itemId, Math.round((l.weight / total) * 1e4) / 1e4])) : null,
      };
    }),
  };
}

const r = (v) => Math.round(v);
const all = read("nodes.json").nodes;
const banks = all.filter((n) => n.type === "bank");
const bankIndex = Object.fromEntries(banks.map((b, i) => [b.id, i]));
const nodes = all.filter((n) => n.type === "skill" && n.activities.length).map((n) => ({
  id: n.id,
  name: n.name,
  x: r(n.position.x),
  y: r(n.position.y),
  bank: bankIndex[n.nearestBankId] ?? -1,
  bankDist: r(n.nearestBankDistance ?? 0),
  acts: n.activities.filter((a) => skills.includes(a.skill)).map((a) => a.activityId),
})).filter((n) => n.acts.length);

// Walking distance between banks along the game's own paths; straight line
// when a pair has no stored path.
const { bankPaths } = read("paths.json");
const len = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
const bankDist = banks.map((a) => banks.map((b) => {
  if (a === b) return 0;
  const p = bankPaths[`${a.id}:${b.id}`] ?? bankPaths[`${b.id}:${a.id}`];
  return r(p ? len(p) : Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y));
}));

const out = path.resolve("standalone/data");
fs.mkdirSync(out, { recursive: true });
const data = {
  skills,
  activities,
  banks: banks.map((b) => ({ id: b.id, name: b.name, x: r(b.position.x), y: r(b.position.y) })),
  bankDist,
  nodes,
};
fs.writeFileSync(path.join(out, "map.json"), JSON.stringify(data));
console.log(`Wrote ${nodes.length} nodes, ${banks.length} banks, ${skills.length} skills to ${path.relative(process.cwd(), out)}/map.json`);
