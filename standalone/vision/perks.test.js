import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { createWorker } from "tesseract.js";
import { PERKS_OCR_PARAMS, parseMovementLine, readPerks, speedWithPotion } from "./perks.js";

const sample = (name) => PNG.sync.read(fs.readFileSync(new URL(`../../samples/${name}.png`, import.meta.url)));

const BLUE_LINE = "pt Total Movement Speed +168% (26.8 steps/sec) (Vigor Ivl 69 (effective B1) base, +9.5% telescopes, +1% compasses (2/11), +1.5% swift beacons, +5% fortress milestones, +4.7% collector, +3% fleet foot]";

test("parses the Total Movement Speed line", () => {
  const r = parseMovementLine(`Compasses +0.5% XP\n${BLUE_LINE}\nmore`);
  assert.equal(r.stepsPerSec, 26.8);
  assert.equal(r.vigor, 69);
  assert.equal(r.effectiveVigor, 81);
  assert.deepEqual(r.bonusPct, { telescopes: 9.5, compasses: 1, swiftBeacons: 1.5, milestones: 5, collector: 4.7, fleetFoot: 3 });
  assert.equal(r.consistent, true);
  // A misread telescope figure no longer adds up to the steps/sec shown.
  assert.equal(parseMovementLine(BLUE_LINE.replace("+9.5%", "+3.5%")).consistent, false);
  assert.equal(parseMovementLine("Compasses +0% XP"), null);
});

// The potion boxes next to the line show 26.8 / 30 / 33.2 / 37.5 (blue) and
// 20.4 / 23.1 / 25.8 / 29.4 (brown). The game truncates them to one decimal.
const EXPECTED = {
  "perks-blue": { effectiveVigor: 81, telescopes: 9.5, compasses: 1, shown: [26.8, 30, 33.2, 37.5] },
  "perks-brown": { effectiveVigor: 61, telescopes: 7, compasses: 0, shown: [20.4, 23.1, 25.8, 29.4] },
};

const LANG = new URL("../../node_modules/@tesseract.js-data/eng/4.0.0_best_int/", import.meta.url);
const toPng = (img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return PNG.sync.write(png);
};

test("OCRs the movement line and matches the potion speeds shown", { timeout: 180000 }, async () => {
  const worker = await createWorker("eng", 1, { langPath: LANG.pathname.replace(/^\/(\w:)/, "$1") });
  try {
    await worker.setParameters(PERKS_OCR_PARAMS);
    const recognize = async (img) => (await worker.recognize(toPng(img))).data.text;
    for (const [name, want] of Object.entries(EXPECTED)) {
      const got = await readPerks(sample(name), recognize);
      assert.ok(got?.consistent, name);
      assert.equal(got.effectiveVigor, want.effectiveVigor, name);
      assert.equal(got.bonusPct.telescopes, want.telescopes, name);
      assert.equal(got.bonusPct.compasses, want.compasses, name);
      [0, 0.15, 0.3, 0.5].forEach((potion, i) => {
        const speed = speedWithPotion(got, potion);
        assert.ok(Math.abs(speed - (want.shown[i] + 0.05)) <= 0.1, `${name} potion ${potion}: ${speed} vs ${want.shown[i]}`);
      });
    }
  } finally {
    await worker.terminate();
  }
});
