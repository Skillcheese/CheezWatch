import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { createWorker } from "tesseract.js";
import { binarize } from "./collections.js";
import { DIARY_OCR_PARAMS, isDiaryScreen, readDiary, tierOf } from "./diary.js";

const BANKS = ["Archrest", "Battlefrost", "Breakwood", "Cropshore", "Driftmast", "Drypocket", "Duneridge", "Dustclaw", "Farmhold", "Farnorth"]
  .map((n) => ({ id: `${n.toLowerCase()}_bank`, name: `${n} Bank` }))
  .concat([{ id: "shortha_north", name: "Shortha Northbank" }, { id: "shortha_south", name: "Shortha Southbank" }]);

test("tier is each full 20% of the diary", () => {
  assert.equal(tierOf(9, 23), 1);
  assert.equal(tierOf(31, 46), 3);
  assert.equal(tierOf(17, 20), 4);
  assert.equal(tierOf(4, 20), 1);
  assert.equal(tierOf(3, 20), 0);
  assert.equal(tierOf(20, 20), 5);
});

test("tells the Shortha banks apart by the second word", () => {
  const w = (text, x0, y0) => ({ text, x0, y0, x1: x0 + 60, y1: y0 + 20 });
  const got = readDiary([w("Shortha", 100, 100), w("Southbank", 170, 100), w("3/10", 500, 100)], BANKS);
  assert.deepEqual(got, { shortha_south: { done: 3, total: 10, tier: 1 } });
});

const LANG = new URL("../../node_modules/@tesseract.js-data/eng/4.0.0_best_int/", import.meta.url);

test("reads the Diary screenshot", { timeout: 120000 }, async () => {
  const p = PNG.sync.read(fs.readFileSync(new URL("../../samples/diary-blue.png", import.meta.url)));
  const img = { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
  const worker = await createWorker("eng", 1, { langPath: LANG.pathname.replace(/^\/(\w:)/, "$1") });
  try {
    await worker.setParameters(DIARY_OCR_PARAMS);
    const b = binarize(img, 2, 0.3);
    const png = new PNG({ width: b.width, height: b.height });
    png.data = Buffer.from(b.data.buffer);
    const { data } = await worker.recognize(PNG.sync.write(png), {}, { blocks: true });
    const words = data.blocks.flatMap((bl) => bl.paragraphs.flatMap((pa) => pa.lines.flatMap((l) => l.words)))
      .map((x) => ({ text: x.text, x0: x.bbox.x0 / 2, y0: x.bbox.y0 / 2, x1: x.bbox.x1 / 2, y1: x.bbox.y1 / 2 }));
    assert.ok(isDiaryScreen(words));
    const got = readDiary(words, BANKS);
    const tiers = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.tier]));
    assert.deepEqual(tiers, {
      archrest_bank: 1, battlefrost_bank: 3, breakwood_bank: 3, cropshore_bank: 4, driftmast_bank: 1,
      drypocket_bank: 3, duneridge_bank: 2, dustclaw_bank: 2, farmhold_bank: 2,
    });
    assert.deepEqual(got.dustclaw_bank, { done: 48, total: 89, tier: 2 });

    // Crops of the cards, without the Diary title; Icecap OCRs as "lcecap".
    const banks = [{ id: "icecap", name: "Icecap Bank" }, { id: "icemast", name: "Icemast Bank" }, { id: "highroot", name: "Highroot Bank" }, { id: "icelock", name: "Icelock Bank" }];
    const crop = PNG.sync.read(fs.readFileSync(new URL("../../samples/diary-crop2.png", import.meta.url)));
    const cb = binarize({ width: crop.width, height: crop.height, data: new Uint8ClampedArray(crop.data) }, 2, 0.3);
    const cpng = new PNG({ width: cb.width, height: cb.height });
    cpng.data = Buffer.from(cb.data.buffer);
    const cw = (await worker.recognize(PNG.sync.write(cpng), {}, { blocks: true })).data.blocks
      .flatMap((bl) => bl.paragraphs.flatMap((pa) => pa.lines.flatMap((l) => l.words)))
      .map((x) => ({ text: x.text, x0: x.bbox.x0 / 2, y0: x.bbox.y0 / 2, x1: x.bbox.x1 / 2, y1: x.bbox.y1 / 2 }));
    assert.ok(isDiaryScreen(cw));
    const cr = readDiary(cw, banks);
    assert.deepEqual(Object.fromEntries(Object.entries(cr).map(([k, v]) => [k, v.tier])), { highroot: 3, icecap: 2, icemast: 3, icelock: 4 });
  } finally {
    await worker.terminate();
  }
});
