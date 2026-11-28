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

test("reads levels and weights from the Skills Customization screen", { timeout: 180000 }, async () => {
  const page = await createWorker("eng", 1, { langPath: LANG.pathname.replace(/^\/(\w:)/, "$1") });
  const digit = await createWorker("eng", 1, { langPath: LANG.pathname.replace(/^\/(\w:)/, "$1") });
  try {
    await page.setParameters(WEIGHTS_OCR_PARAMS);
    await digit.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "+-12345" });
    const got = await readSkillWeights(
      sample("weights-blue"),
      async (img) => ({ words: (await page.recognize(toPng(img), {}, { blocks: true })).data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))) }),
      async (img) => (await digit.recognize(toPng(img))).data.text,
    );
    assert.deepEqual(got.levers, {
      fish: -1, cook: -1, mine: 5, smith: 5, forage: -1, craft: -1, invoke: -1, imbue: -1, farm: -1, brew: 2,
      plunder: -1, barter: -2, bard: -1, discover: -1, vigor: -1, luck: 4, quests: 1,
    });
    assert.equal(got.levels.mine, 76);
    assert.equal(got.levels.smith, 75);
    assert.equal(got.levels.brew, 82);
    assert.equal(got.levels.luck, 83);
    assert.equal(got.percent.mine, 17);
    assert.equal(got.percent.brew, 9);
    assert.deepEqual(got.credits, { free: 1, total: 2376 });
  } finally {
    await page.terminate();
    await digit.terminate();
  }
});
