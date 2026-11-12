// Reads the "Collections 297/2311 · 12.9%" label on the Unlocks page. OCR
// (Tesseract) is given a few binarized, upscaled versions of the strip and
// the readings vote; one that agrees with the shown percentage wins outright.
import { crop } from "./image.js";

export const OCR_PARAMS = { tessedit_char_whitelist: "Colectins0123456789/.% ", tessedit_pageseg_mode: "7" };
// [upscale, threshold between the strip's median and its brightest pixels].
const ATTEMPTS = [[4, 0.5], [5, 0.5], [4, 0.6], [2, 0.5], [5, 0.4]];

/** "Collections 297/2311 · 12.9%" → { count, total, fraction, percentOk }, or null. */
export function parseCollections(text) {
  const m = /Coll?ections?\s*(\d+)\s*[/|]\s*(\d{1,5})(?:\D{0,3}?(\d{1,3}(?:\.\d)?)\s*%)?/i.exec(text ?? "");
  if (!m) return null;
  const count = Number(m[1]), total = Number(m[2]);
  if (!(total > 0) || count > total) return null;
  const pct = (100 * count) / total;
  // OCR sometimes drops the decimal point ("129%" for 12.9%).
  const shown = m[3] == null ? null : Number(m[3]);
  const percentOk = shown != null && [shown, shown / 10].some((s) => Math.abs(s - pct) < 0.6);
  return { count, total, fraction: count / total, percentOk };
}

/** Light text becomes black on white, upscaled, which is what Tesseract reads best. */
export function binarize(img, scale, level) {
  const n = img.width * img.height, lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
  const sorted = Float32Array.from(lum).sort();
  const med = sorted[n >> 1], hi = sorted[Math.floor(n * 0.995)];
  const cut = med + (hi - med) * level;
  const W = img.width * scale, H = img.height * scale, data = new Uint8ClampedArray(W * H * 4);
  const at = (x, y) => lum[y * img.width + x];
  for (let y = 0; y < H; y++) {
    const fy = Math.min(img.height - 1.001, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(fy), ay = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(img.width - 1.001, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(fx), ax = fx - x0;
      const v = (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v > cut ? 0 : 255;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

/**
 * `recognize(imageData) → Promise<text>` runs the OCR. Returns
 * { count, total, fraction, percentOk } or null if nothing readable.
 */
export async function readCollections(img, rect, recognize) {
  if (!rect) return null;
  const strip = crop(img, rect.x, rect.y, rect.w, rect.h);
  const votes = new Map();
  for (const [scale, level] of ATTEMPTS) {
    const got = parseCollections(await recognize(binarize(strip, scale, level)));
    if (!got) continue;
    if (got.percentOk) return got;
    const key = `${got.count}/${got.total}`;
    const v = votes.get(key) ?? { got, n: 0 };
    v.n++;
    votes.set(key, v);
  }
  const best = [...votes.values()].sort((a, b) => b.n - a.n)[0];
  return best && best.n >= 2 ? best.got : null;
}
