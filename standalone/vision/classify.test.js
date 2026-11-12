import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { ICON_IDS, iconReferences } from "./read-screens.js";
import { FORT_ITEM_IDS } from "./fort-collection.js";
import { classifyScreenshot } from "./classify.js";

// Game icons are extracted by scripts/extract-icons.js and gitignored.
const ICONS = new URL("../icons/", import.meta.url);
const hasIcons = ICON_IDS.every((id) => fs.existsSync(new URL(`${id}.png`, ICONS)))
  && FORT_ITEM_IDS.every((id) => fs.existsSync(new URL(`fort/${id}.png`, ICONS)));
const skip = hasIcons ? false : "game icons not extracted (node scripts/extract-icons.js)";

const png = (url) => PNG.sync.read(fs.readFileSync(url));

test("classifies every sample screenshot", { skip }, () => {
  const refs = iconReferences(Object.fromEntries(ICON_IDS.map((id) => [id, png(new URL(`${id}.png`, ICONS))])));
  const fortRefs = Object.fromEntries(FORT_ITEM_IDS.map((id) => [id, png(new URL(`fort/${id}.png`, ICONS))]));
  const expected = {
    "skills": "skills", "unlocks": "unlocks", "fort": "fortress", "fortify": "fortify", "perks": "perks",
  };
  for (const [prefix, kind] of Object.entries(expected)) {
    for (const theme of ["blue", "brown"]) {
      const got = classifyScreenshot(png(new URL(`../../samples/${prefix}-${theme}.png`, import.meta.url)), refs, fortRefs);
      assert.equal(got?.kind, kind, `${prefix}-${theme}`);
      assert.equal(got.confirmed, kind !== "perks");
    }
  }
});
