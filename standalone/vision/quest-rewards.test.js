import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { cellBackground, findOwnedFrames } from "./fort-collection.js";
import { GLOBE_IDS, readGlobes } from "./quest-rewards.js";

// The icons are the game's assets, extracted by scripts/extract-icons.js.
const DIR = new URL("../icons/quest/", import.meta.url);
const skip = GLOBE_IDS.every((id) => fs.existsSync(new URL(`${id}.png`, DIR))) ? false : "quest icons not extracted (node scripts/extract-icons.js)";
const refs = () => Object.fromEntries(GLOBE_IDS.map((id) => [id, PNG.sync.read(fs.readFileSync(new URL(`${id}.png`, DIR)))]));
const sample = (name) => PNG.sync.read(fs.readFileSync(new URL(`../../samples/${name}.png`, import.meta.url)));
const QUEST_ROW = "Screenshot 2026-11-27 213438";

test("finds no Globes where none are owned", { skip }, () => {
  for (const n of [QUEST_ROW, "Screenshot 2026-11-27 212115", "fort-blue", "unlocks-blue", "perks-brown"]) {
    assert.equal(readGlobes(sample(n), refs()), "none", n);
  }
});

// Nobody owns a Globe yet, so an owned one is faked: the icon is drawn into
// an owned quest reward's frame the way the game draws its items.
function paint(img, box, ref) {
  const bg = cellBackground(img, box), side = box.size * 0.85;
  const ox = box.x + (box.size - side) / 2, oy = box.y + (box.size - side) / 2;
  for (let y = Math.ceil(oy); y < oy + side; y++) for (let x = Math.ceil(ox); x < ox + side; x++) {
    const u = Math.floor(((x - ox) / side) * ref.width), v = Math.floor(((y - oy) / side) * ref.height);
    const r = (v * ref.width + u) * 4, a = ref.data[r + 3] / 255, i = (y * img.width + x) * 4;
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(a * ref.data[r + k] + (1 - a) * bg[k]);
  }
}

test("reads owned Globes in the Quest Rewards row", { skip }, () => {
  const r = refs();
  const img = sample(QUEST_ROW);
  const row = findOwnedFrames(img).filter((b) => b.y > 900 && b.y < 960);
  assert.equal(row.length, 4);
  paint(img, row[2], r.globe_of_skills_t2);
  assert.equal(readGlobes(img, r), "t2");
  paint(img, row[3], r.globe_of_skills_t1);
  assert.equal(readGlobes(img, r), "both");
});
