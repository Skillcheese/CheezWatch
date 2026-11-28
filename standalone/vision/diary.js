// Reads the Diary screen: each bank's diary card shows its name, steps done
// ("9/23") and its tier ("Tier 1 Free node weight ±1"). The tier is
// floor(5 × done / total); the printed "TierN" is the fallback when the
// fraction doesn't read. Cards scroll, so several screenshots are merged.
export const DIARY_OCR_PARAMS = { tessedit_pageseg_mode: "11" };

const clean = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
const FRACTION = /^(\d{1,3})\/(\d{1,3})$/;

export const tierOf = (done, total) => (total > 0 ? Math.min(5, Math.floor((5 * done) / total + 1e-9)) : 0);

/** Is this OCR word list the Diary screen? */
export function isDiaryScreen(words) {
  return words.some((w) => /^diary$/i.test(w.text)) && words.filter((w) => /^tier\s?\d$/i.test(w.text) || /^weight$/i.test(w.text)).length >= 2;
}

/**
 * `words`: OCR words in image coordinates [{ text, x0, y0, x1, y1 }].
 * `banks`: [{ id, name }] with names like "Archrest Bank".
 * Returns { bank id: { done, total, tier } }.
 */
export function readDiary(words, banks) {
  const keys = banks.map((b) => {
    const parts = b.name.replace(/\s+Bank$/i, "").split(/\s+/).map(clean);
    return { id: b.id, first: parts[0], second: parts[1] ?? null };
  });
  const sameRow = (a, b) => Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < Math.max(a.y1 - a.y0, b.y1 - b.y0) * 0.7;
  const out = {};
  words.forEach((w, i) => {
    const t = clean(w.text);
    if (t.length < 4) return;
    let cands = keys.filter((k) => k.first === t);
    if (cands.length > 1) {
      // "Shortha Northbank" / "Shortha Southbank": the next word tells.
      const next = clean(words[i + 1]?.text ?? "");
      cands = cands.filter((k) => k.second && next.startsWith(k.second.slice(0, 4)));
    }
    if (cands.length !== 1) return;
    const id = cands[0].id;
    const h = w.y1 - w.y0;
    // The fraction is on the card's title row, right of the name.
    const frac = words.filter((x) => x.x0 > w.x1 && x.x0 - w.x1 < h * 25 && sameRow(x, w) && FRACTION.test(x.text))
      .sort((a, b) => a.x0 - b.x0)[0];
    // "TierN" sits about two title-heights below the name.
    const tierWord = words.filter((x) => /^tier\s?\d$/i.test(x.text) && x.y0 > w.y1 && x.y0 - w.y1 < h * 4 && Math.abs(x.x0 - w.x0) < h * 2)[0];
    const printed = tierWord ? Number(tierWord.text.slice(-1)) : null;
    if (frac) {
      const [, d, t2] = FRACTION.exec(frac.text).map(Number);
      if (d <= t2) {
        const tier = tierOf(d, t2);
        // When the two disagree, the printed tier is what the game grants.
        out[id] = { done: d, total: t2, tier: printed != null && printed !== tier ? printed : tier };
        return;
      }
    }
    if (printed != null) out[id] = { done: null, total: null, tier: printed };
  });
  return out;
}
