import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { ICON_IDS, iconReferences, readSkillsPanel, readUnlocksPage } from "./read-screens.js";
import { digitTemplates } from "./digits.js";

// Icons and font are the game's assets, extracted by scripts/extract-icons.js
// and gitignored, so these tests skip on a fresh clone.
const ICONS = new URL("../icons/", import.meta.url);
const FONT = new URL("ChakraPetch-Bold.ttf", ICONS);
const hasAssets = fs.existsSync(FONT) && ICON_IDS.every((id) => fs.existsSync(new URL(`${id}.png`, ICONS)));
const skip = hasAssets ? false : "game icons/font not extracted (node scripts/extract-icons.js)";

const sample = (name) => PNG.sync.read(fs.readFileSync(new URL(`../../samples/${name}.png`, import.meta.url)));

let refs, templates;
function setup() {
  if (refs) return;
  const imgs = {};
  for (const id of ICON_IDS) imgs[id] = PNG.sync.read(fs.readFileSync(new URL(`${id}.png`, ICONS)));
  refs = iconReferences(imgs);
  GlobalFonts.registerFromPath(FONT.pathname.replace(/^\/(\w:)/, "$1"), "ChakraPetchGame");
  templates = digitTemplates((w, h) => createCanvas(w, h).getContext("2d"), "ChakraPetchGame");
}

const SKILL_ORDER = ["life", "spirit", "fish", "cook", "strike", "heft", "mine", "smith", "sight", "draw",
  "forage", "craft", "focus", "surge", "invoke", "imbue", "dodge", "defend", "farm", "brew", "slay", "vigor",
  "plunder", "barter", "delve", "fortify", "bard", "discover", "luck", "alms"];
const levelsOf = (values) => Object.fromEntries(SKILL_ORDER.map((s, i) => [s, values[i]]));

const SKILLS_EXPECTED = {
  "skills-blue": {
    total: 1997,
    levels: levelsOf([72, 74, 70, 73, 74, 75, 69, 68, 51, 51, 61, 58, 50, 50, 58, 57, 65, 65, 65, 72, 76, 69, 72, 64, 74, 71, 64, 68, 74, 87]),
  },
  "skills-brown": {
    total: 1038,
    levels: levelsOf([10, 1, 58, 58, 6, 6, 52, 46, 11, 11, 56, 49, 1, 1, 49, 44, 1, 1, 59, 56, 1, 58, 58, 51, 1, 56, 58, 55, 54, 70]),
  },
};

for (const [name, want] of Object.entries(SKILLS_EXPECTED)) {
  test(`reads every level on ${name}`, { skip }, () => {
    setup();
    const got = readSkillsPanel(sample(name), refs, templates);
    assert.equal(got.total, want.total);
    assert.equal(got.checksum, "ok");
    assert.deepEqual(got.levels, want.levels);
    assert.deepEqual(got.warnings, []);
  });
}

const TOOLS3 = "T1 T2 T3";
const UNLOCKS_EXPECTED = {
  "unlocks-brown": {
    levels: "L1", vigor: "L1 L2", fortify: "T1 D1", luck: "L2", alms: "L1 L2", fish: "L1 L2", cook: "L1",
    invoke: "L1", farm: "L1 L2", brew: "D1", plunder: "L1", barter: "L1 L2", bard: "L1 L2", discover: "L1",
  },
  "unlocks-blue": {
    levels: "pet T1 T2 T3 T4 L1 L2",
    life: `${TOOLS3} D1 L1 L2`, spirit: `${TOOLS3} L1 L2`, strike: `${TOOLS3} L1 L2`, heft: `${TOOLS3} L1 L2`,
    sight: TOOLS3, draw: `${TOOLS3} L1`, focus: TOOLS3, surge: `${TOOLS3} L1`,
    dodge: `${TOOLS3} D1 L1 L2`, defend: `${TOOLS3} D1 L1 L2`, slay: `pet ${TOOLS3} L1 L2`,
    vigor: `${TOOLS3} L1 L2`, delve: `${TOOLS3} L1 L2`, fortify: `${TOOLS3} L1 L2`, luck: `${TOOLS3} L1 L2`,
    alms: `pet ${TOOLS3} L1 L2`, fish: `${TOOLS3} L1`, cook: `pet ${TOOLS3} D1 L1 L2`,
    mine: `${TOOLS3} L1 L2`, smith: `${TOOLS3} L1 L2`, forage: `${TOOLS3} L1`, craft: `${TOOLS3} D1 L1 L2`,
    invoke: `${TOOLS3} L1 L2`, imbue: `${TOOLS3} L1 L2`, farm: `${TOOLS3} L1 L2`, brew: `${TOOLS3} L1 L2`,
    plunder: `pet ${TOOLS3} L1 L2`, barter: `pet ${TOOLS3} L1`, bard: `shiny_pet ${TOOLS3} L1 L2`,
    discover: `${TOOLS3} L1 L2`,
  },
};

for (const [name, want] of Object.entries(UNLOCKS_EXPECTED)) {
  test(`reads every owned cell on ${name}`, { skip }, () => {
    setup();
    const got = readUnlocksPage(sample(name), refs);
    assert.deepEqual(got.warnings, []);
    const actual = Object.fromEntries(ICON_IDS.map((id) => [id, [...(got.owned[id] ?? [])].sort()]));
    const expected = Object.fromEntries(ICON_IDS.map((id) => [id, (want[id] ?? "").split(" ").filter(Boolean).sort()]));
    assert.deepEqual(actual, expected);
  });
}

