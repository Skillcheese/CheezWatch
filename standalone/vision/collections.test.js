import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { createWorker } from "tesseract.js";
import { OCR_PARAMS, parseCollections, readCollections } from "./collections.js";
import { collectionsRect } from "./read-screens.js";
import { readUnlockGrid } from "./unlock-grid.js";

test("parses the collections label", () => {
  assert.deepEqual(parseCollections("Collections 297/2311 · 12.9%"), { count: 297, total: 2311, fraction: 297 / 2311, percentOk: true });
  assert.equal(parseCollections("Collections 297/2311 129%").percentOk, true);
  assert.equal(parseCollections("Collections 297/2511 12.9%").percentOk, false);
  assert.deepEqual(parseCollections("collection 5 | 10"), { count: 5, total: 10, fraction: 0.5, percentOk: false });
  assert.equal(parseCollections("Collections 20/10"), null);
  assert.equal(parseCollections("nothing here"), null);
  assert.equal(parseCollections(undefined), null);
});

const LANG = new URL("../../node_modules/@tesseract.js-data/eng/4.0.0_best_int/", import.meta.url);
const toPng = (img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return PNG.sync.write(png);
};

test("OCRs the collections label on both themes", { timeout: 60000 }, async () => {
  const worker = await createWorker("eng", 1, { langPath: LANG.pathname.replace(/^\/(\w:)/, "$1") });
  try {
    await worker.setParameters(OCR_PARAMS);
    const recognize = async (img) => (await worker.recognize(toPng(img))).data.text;
    for (const [name, count] of [["unlocks-brown", 297], ["unlocks-blue", 1086]]) {
      const img = PNG.sync.read(fs.readFileSync(new URL(`../../samples/${name}.png`, import.meta.url)));
      const got = await readCollections(img, collectionsRect(img, readUnlockGrid(img)), recognize);
      assert.equal(got?.count, count, name);
      assert.equal(got.total, 2311, name);
    }
  } finally {
    await worker.terminate();
  }
});
