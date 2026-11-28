import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { createWorker } from "tesseract.js";
import { parseLevel, parsePip, readSkillWeights, WEIGHTS_OCR_PARAMS } from "./skill-weights.js";

test("parses levels with the usual OCR slips", () => {
  assert.equal(parseLevel("Lv78"), 78);
  assert.equal(parseLevel("LvB2"), 82);
  assert.equal(parseLevel("LvS5"), 55);
  assert.equal(parseLevel("LW77"), 77);
  assert.equal(parseLevel("Lives"), null);
});

test("signs a pip by its colour", () => {
  assert.equal(parsePip("+5", "green"), 5);
  assert.equal(parsePip("-1", "red"), -1);
  assert.equal(parsePip("2", "red"), -2);
  assert.equal(parsePip("", "red"), null);
});

const LANG = new URL("../../node_modules/@tesseract.js-data/eng/4.0.0_best_int/", import.meta.url);
const toPng = (img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return PNG.sync.write(png);
};
const sample = (name) => {
  const p = PNG.sync.read(fs.readFileSync(new URL(`../../samples/${name}.png`, import.meta.url)));
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
};

const workers = async () => {
  const lang = LANG.pathname.replace(/^\/(\w:)/, "$1");
  const [page, digit, line] = await Promise.all([0, 1, 2].map(() => createWorker("eng", 1, { langPath: lang })));
  await page.setParameters(WEIGHTS_OCR_PARAMS);
  await digit.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "+-12345" });
  await line.setParameters({ tessedit_pageseg_mode: "7" });
  return {
    read: (img) => readSkillWeights(
      img,
      async (part) => ({ words: (await page.recognize(toPng(part), {}, { blocks: true })).data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))) }),
      async (part) => (await digit.recognize(toPng(part))).data.text,
      async (part) => (await line.recognize(toPng(part))).data.text,
    ),
    done: () => Promise.all([page, digit, line].map((w) => w.terminate())),
  };
};
const on = (owned) => ({ owned, enabled: true, chance: [0, 0.5, 0.75, 1][owned] });
const off = (owned) => ({ owned, enabled: false, chance: 0 });

test("reads levels, weights and automaters from the Skills Customization screen", { timeout: 240000 }, async () => {
  const w = await workers();
  try {
    const got = await w.read(sample("weights-blue"));
    assert.deepEqual(got.levers, {
      fish: -1, cook: -1, mine: 5, smith: 5, forage: -1, craft: -1, invoke: -1, imbue: -1, farm: -1, brew: 2,
      plunder: -1, barter: -2, bard: -1, discover: -1, vigor: -1, luck: 4, quests: 1,
    });
    assert.equal(got.levels.mine, 76);
    assert.equal(got.levels.smith, 75);
    assert.equal(got.levels.brew, 82);
    assert.equal(got.levels.luck, 83);
    assert.equal(got.percent.mine, 17);
    assert.deepEqual(got.credits, { free: 1, total: 2376 });
    assert.deepEqual(got.automaterOrder, ["luck", "tier", "slay", "distance", "materials", "quantity", "quests"]);
    assert.deepEqual(got.automaters, { luck: on(3), tier: on(3), slay: off(2), distance: on(3), materials: on(3), quantity: on(3), quests: on(3) });

    const alt = await w.read(sample("weights-alt"));
    assert.equal(alt.levels.mine, 57);
    assert.equal(alt.levers.luck, 5);
    assert.equal(alt.levers.mine, 0);
    assert.deepEqual(alt.automaterOrder, ["luck", "quests", "tier", "quantity", "materials", "distance", "slay"]);
    assert.deepEqual(alt.automaters, { luck: on(3), quests: on(3), tier: off(3), quantity: on(3), materials: on(3), distance: on(3), slay: off(0) });
  } finally {
    await w.done();
  }
});
