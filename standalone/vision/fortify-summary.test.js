import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { createWorker } from "tesseract.js";
import { FORTIFY_OCR_PARAMS, findSummaryLines, parseSummaryLine, readFortifySummary } from "./fortify-summary.js";

const sample = (name) => PNG.sync.read(fs.readFileSync(new URL(`../../samples/${name}.png`, import.meta.url)));

test("parses summary lines", () => {
  assert.deepEqual(parseSummaryLine("+2.75% movement speed"), { key: "moveSpeedPct", value: 2.75 });
  assert.deepEqual(parseSummaryLine("+275% movement speed"), { key: "moveSpeedPct", value: 2.75 });
  assert.deepEqual(parseSummaryLine("-0.54s action time"), { key: "actionTimeSec", value: -0.54 });
  assert.deepEqual(parseSummaryLine("+4% Fortify XP"), { key: "fortifyXpPct", value: 4 });
  assert.deepEqual(parseSummaryLine("+4.5% skilling XP"), { key: "skillingXpPct", value: 4.5 });
  assert.deepEqual(parseSummaryLine("+15% XP (all skills)"), { key: "globalXpPct", value: 1.5 });
  assert.deepEqual(parseSummaryLine("-0.68 action time"), { key: "actionTimeSec", value: -0.6 });
  assert.equal(parseSummaryLine("+999% movement speed"), null);
  assert.equal(parseSummaryLine("Skillcheez"), null);
});

test("finds the summary block on both themes and nowhere else", () => {
  assert.equal(findSummaryLines(sample("fortify-blue")).length, 8);
  assert.equal(findSummaryLines(sample("fortify-brown")).length, 8);
  for (const n of ["fort-blue", "fort-brown", "unlocks-blue", "unlocks-brown", "skills-blue", "skills-brown"]) {
    assert.equal(findSummaryLines(sample(n)).length, 0, n);
  }
});

const LANG = new URL("../../node_modules/@tesseract.js-data/eng/4.0.0_best_int/", import.meta.url);
const toPng = (img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return PNG.sync.write(png);
};

const EXPECTED = {
  "fortify-blue": { moveSpeedPct: 2.75, successPct: 5, saveMaterialPct: 1.25, doubleGatherPct: 10, skillingXpPct: 1.75, fortifyXpPct: 4, actionTimeSec: -0.6, globalXpPct: 3, foodHeal: 0 },
  "fortify-brown": { moveSpeedPct: 2.25, successPct: 3.5, saveMaterialPct: 1, doubleGatherPct: 8, skillingXpPct: 4.5, fortifyXpPct: 3.5, actionTimeSec: -0.54, globalXpPct: 1.5, foodHeal: 0 },
};

test("OCRs the Fortify Tree summary on both themes", { timeout: 120000 }, async () => {
  const worker = await createWorker("eng", 1, { langPath: LANG.pathname.replace(/^\/(\w:)/, "$1") });
  try {
    await worker.setParameters(FORTIFY_OCR_PARAMS);
    const recognize = async (img) => (await worker.recognize(toPng(img))).data.text;
    for (const [name, want] of Object.entries(EXPECTED)) {
      const got = await readFortifySummary(sample(name), recognize);
      assert.deepEqual(got.talents, want, `${name}: ${got.lines.join(" | ")}`);
      assert.equal(got.unread, 0, name);
    }
  } finally {
    await worker.terminate();
  }
});
