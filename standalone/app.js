// Screenshot import for Gauntlet Lab. The Lab runs unchanged in an iframe;
// this page drops an import card into its Profiles tab, reads the two
// screenshots locally and writes the results into the Lab's saved state.
// Nothing here talks to the game: it only reads images the user gives it.
import { ICON_IDS, iconReferences, readSkillsPanel, readUnlocksPage, SKILLS } from "./vision/read-screens.js";
import { digitTemplates } from "./vision/digits.js";
import { OCR_PARAMS, readCollections } from "./vision/collections.js";
import { FORT_ITEM_IDS, readFortCollection } from "./vision/fort-collection.js";
import { FORTIFY_OCR_PARAMS, readFortifySummary } from "./vision/fortify-summary.js";
import { PERKS_OCR_PARAMS, readPerks } from "./vision/perks.js";
import { classifyScreenshot, KINDS } from "./vision/classify.js";
import { GLOBE_IDS, readGlobes } from "./vision/quest-rewards.js";
import { computeProfile, FORT_FAMILIES, FORT_TIERS, GLOBES, globesFromPerks, POTIONS } from "./calc.js";
import { dropsSection, mostLikelyWave } from "./lib/rare-drops.js";
import { depositsSection } from "./lib/deposits.js";
import { mountSwapCard } from "./swap.js";
import { LAB_STORAGE_KEY, applyBackpackSize, applyMovementSpeed, applyRoleTiers, applyUnlockStats, applyXpBonus } from "./lib/lab-profile.js";

const FONT_FAMILY = "ChakraPetchGame";
const POTION_LABELS = { none: "None", swift: "Swift (+15%)", fleet: "Fleet (+30%)", haste: "Haste (+50%)" };
const POTION_KEY = "standalone-import-potion";
const GLOBE_LABELS = { none: "none", t1: "T1", t2: "T2", both: "T1 and T2" };
const GLOBES_KEY = "standalone-import-globes";
const EXAMPLES_KEY = "standalone-import-examples-open";
// What each screenshot should look like, shown on request.
const EXAMPLES = [
  ["unlocks", "Unlocks page", "The whole grid, with the skill icons on top and the Collections count."],
  ["skills", "Skills panel", "Every skill box and the total. A whole game window works too."],
  ["fortress", "Fortress collection", "Collections → The Fortress, opened."],
  ["fortify", "Fortify Tree", "The stat summary in the top-left corner must show."],
  ["perks", "Perks", "Scrolled so the Total Movement Speed line and the Quest Rewards row (Globes of Skills) show."],
];
const FORT_KEY = "standalone-import-fort";
const TALENTS_KEY = "standalone-import-talents";
const PERKS_KEY = "standalone-import-perks";
const SKILLING_PROFILE_KEY = "cheezwatch-skilling-profile";
const XP_LABELS = {
  talents: "Fortify Tree", fort: "Fortress items", lanterns: "lanterns", capesPets: "capes & pets", telescopes: "telescopes", compasses: "compasses",
};
const FORT_LABELS = {
  ledger: "Ledgers", banner: "Banners", haste: "Haste Beacons", swift: "Swift Beacons",
  sure: "Sure Beacons", bounty: "Bounty Beacons", thrift: "Thrift Beacons", satchel: "Satchels",
  fortification: "Enchanted Fortification",
};
const frame = document.getElementById("lab");

const state = {
  potion: load(POTION_KEY) ?? "none",
  globes: GLOBES[load(GLOBES_KEY)] != null ? load(GLOBES_KEY) : "none",
  fort: loadFort(),
  unlocks: null, // { result, collections, error, busy, name }
  skills: null,  // { result, error, busy, name }
  fortress: null, // { result, error, busy, name }; the result is copied into fort
  fortify: null, // { result, error, busy, name }; the result is copied into talents
  talents: loadTalents(),
  perks: null, // { result, error, busy, name }; the result is remembered
  perksSaved: loadJson(PERKS_KEY),
  applied: null, // computeProfile output last written to Me
  scan: null, // { busy, done, total, found: { kind: file name }, error } for the folder import
  target: "unlocks",
};

// Fortress items come from the Collections screenshot or are picked by hand,
// and are remembered either way. { family: Set(tiers) }, plus `known` once
// the user has given them at all (until then, backpack size is left alone).
function loadFort() {
  let saved = null;
  try { saved = JSON.parse(load(FORT_KEY)); } catch {}
  const fort = Object.fromEntries(FORT_FAMILIES.map((f) => [f, new Set(saved?.[f] ?? [])]));
  return Object.assign(fort, { known: !!saved });
}

function saveFort() {
  state.fort.known = true;
  try { localStorage.setItem(FORT_KEY, JSON.stringify(Object.fromEntries(FORT_FAMILIES.map((f) => [f, [...state.fort[f]]])))); } catch {}
}

// Fortify Tree totals ({ moveSpeedPct, ... }) from the last screenshot, remembered.
function loadTalents() {
  try { return JSON.parse(load(TALENTS_KEY)) ?? undefined; } catch { return undefined; }
}

function loadJson(key) {
  try { return JSON.parse(load(key)) ?? undefined; } catch { return undefined; }
}

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

// ---- Assets (the game's icons and font, extracted locally) ----

let assets;
function loadAssets() {
  assets ??= (async () => {
    const font = new FontFace(FONT_FAMILY, "url(icons/ChakraPetch-Bold.ttf)");
    try {
      document.fonts.add(await font.load());
    } catch {
      throw new Error("Missing standalone/icons. Run: node scripts/extract-icons.js <path to app.asar>");
    }
    const imgs = {};
    await Promise.all(ICON_IDS.map(async (id) => {
      const res = await fetch(`icons/${id}.png`);
      if (!res.ok) throw new Error(`Missing icons/${id}.png. Run: node scripts/extract-icons.js <path to app.asar>`);
      imgs[id] = await decode(await res.blob());
    }));
    const makeContext = (w, h) => new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
    return { refs: iconReferences(imgs), templates: digitTemplates(makeContext, FONT_FAMILY) };
  })();
  assets.catch(() => { assets = undefined; });
  return assets;
}

// One worker per reader, since each sets its own OCR parameters.
const ocr = {};
function ocrWorker(params = OCR_PARAMS) {
  const key = params === OCR_PARAMS ? "collections" : params === PERKS_OCR_PARAMS ? "perks" : "fortify";
  ocr[key] ??= (async () => {
    const worker = await Tesseract.createWorker("eng", 1, {
      workerPath: "vendor/worker.min.js",
      corePath: "vendor/core",
      langPath: "vendor/lang",
      workerBlobURL: false,
    });
    await worker.setParameters(params);
    return worker;
  })();
  ocr[key].catch(() => { ocr[key] = undefined; });
  return ocr[key];
}

async function decode(blob) {
  const bmp = await createImageBitmap(blob);
  const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

async function toBlob(img) {
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext("2d").putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return canvas.convertToBlob();
}

let questAssets;
function loadQuestAssets() {
  questAssets ??= (async () => {
    const refs = {};
    await Promise.all(GLOBE_IDS.map(async (id) => {
      const res = await fetch(`icons/quest/${id}.png`);
      if (!res.ok) throw new Error(`Missing icons/quest/${id}.png. Run: node scripts/extract-icons.js <path to app.asar>`);
      refs[id] = await decode(await res.blob());
    }));
    return refs;
  })();
  questAssets.catch(() => { questAssets = undefined; });
  return questAssets;
}

let fortAssets;
function loadFortAssets() {
  fortAssets ??= (async () => {
    const refs = {};
    await Promise.all(FORT_ITEM_IDS.map(async (id) => {
      const res = await fetch(`icons/fort/${id}.png`);
      if (!res.ok) throw new Error(`Missing icons/fort/${id}.png. Run: node scripts/extract-icons.js <path to app.asar>`);
      refs[id] = await decode(await res.blob());
    }));
    return refs;
  })();
  fortAssets.catch(() => { fortAssets = undefined; });
  return fortAssets;
}

// ---- Reading ----

async function readFile(kind, file) {
  state[kind] = { busy: true, name: file.name || "pasted image" };
  render();
  try {
    store(kind, await analyze(kind, await decode(file)));
  } catch (err) {
    state[kind].error = err.message;
  }
  state[kind].busy = false;
  apply();
}

// Reads one screenshot of a known kind. Throws if it can't.
async function analyze(kind, img) {
  if (kind === "fortress") return { result: readFortCollection(img, await loadFortAssets()) };
  if (kind === "fortify") {
    const worker = await ocrWorker(FORTIFY_OCR_PARAMS);
    return { result: await readFortifySummary(img, async (part) => (await worker.recognize(await toBlob(part))).data.text) };
  }
  if (kind === "perks") {
    const worker = await ocrWorker(PERKS_OCR_PARAMS);
    const result = await readPerks(img, async (part) => (await worker.recognize(await toBlob(part))).data.text);
    if (!result) throw new Error("No \"Total Movement Speed\" line found. Scroll the Unlocks page to Perks.");
    if (result.questRewards) result.globes = readGlobes(img, await loadQuestAssets());
    return { result };
  }
  const { refs, templates } = await loadAssets();
  if (kind === "skills") return { result: readSkillsPanel(img, refs, templates) };
  const result = readUnlocksPage(img, refs);
  return { result, collections: await readCollectionsSafe(img, result.collectionsRect) };
}

// Puts a reading into state (and remembers the parts that persist).
function store(kind, { result, collections }) {
  Object.assign(state[kind], { result, collections, error: undefined });
  if (kind === "fortress") {
    // The screenshot shows every owned item, so it replaces the picker.
    for (const f of FORT_FAMILIES) state.fort[f] = new Set(result.owned[f] ?? []);
    saveFort();
  } else if (kind === "fortify") {
    state.talents = result.talents;
    try { localStorage.setItem(TALENTS_KEY, JSON.stringify(result.talents)); } catch {}
  } else if (kind === "perks" && result.consistent) {
    state.perksSaved = result;
    try { localStorage.setItem(PERKS_KEY, JSON.stringify(result)); } catch {}
    // Owned Globes are framed in the Quest Rewards row; without the row,
    // the movement line's globe term (once owned) still tells.
    const globes = result.globes ?? globesFromPerks(result);
    if (globes) setGlobes(globes);
  }
}

// ---- Folder import: newest screenshot of each kind wins ----

const IMAGE_RE = /\.(png|jpe?g|webp|bmp)$/i;
const MAX_SCAN = 150; // newest files only; a Screenshots folder can hold thousands
const DB_NAME = "standalone-import", DB_STORE = "handles";

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction(DB_STORE, mode).objectStore(DB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
const saveHandle = (h) => idb("readwrite", (s) => s.put(h, "folder")).catch(() => {});
const loadHandle = () => idb("readonly", (s) => s.get("folder")).catch(() => undefined);

let folder; // FileSystemDirectoryHandle, kept for Rescan
loadHandle().then((h) => { if (h) { folder = h; render(); } });

async function pickFolder() {
  if (!window.showDirectoryPicker) { folderInput().click(); return; }
  try {
    folder = await window.showDirectoryPicker({ id: "screenshots", mode: "read" });
  } catch { return; } // cancelled
  saveHandle(folder);
  scanFolder();
}

// Browsers without the File System Access API still allow picking a folder once.
function folderInput() {
  const input = frame.contentDocument.createElement("input");
  Object.assign(input, { type: "file", webkitdirectory: true, multiple: true });
  input.addEventListener("change", () => importFiles([...input.files].filter((f) => !f.webkitRelativePath.slice(f.webkitRelativePath.indexOf("/") + 1).includes("/"))));
  return input;
}

async function scanFolder() {
  if (!folder) return;
  try {
    if (await folder.queryPermission({ mode: "read" }) !== "granted"
      && await folder.requestPermission({ mode: "read" }) !== "granted") return;
    const files = [];
    for await (const entry of folder.values()) {
      if (entry.kind === "file" && IMAGE_RE.test(entry.name)) files.push(await entry.getFile());
    }
    await importFiles(files);
  } catch (err) {
    state.scan = { error: `Couldn't read the folder: ${err.message}` };
    render();
  }
}

async function importFiles(files) {
  const queue = files.filter((f) => IMAGE_RE.test(f.name) || f.type.startsWith("image/"))
    .sort((a, b) => b.lastModified - a.lastModified).slice(0, MAX_SCAN);
  const found = {};
  state.scan = { busy: true, done: 0, total: queue.length, found };
  render();
  try {
    const [{ refs }, fortRefs] = await Promise.all([loadAssets(), loadFortAssets()]);
    for (const file of queue) {
      if (KINDS.every((k) => found[k])) break;
      state.scan.done++;
      render();
      let img;
      try { img = await decode(file); } catch { continue; }
      const c = classifyScreenshot(img, refs, fortRefs);
      if (!c || found[c.kind]) continue;
      try {
        const out = await analyze(c.kind, img);
        state[c.kind] = { name: file.name };
        store(c.kind, out);
        found[c.kind] = file.name;
      } catch (err) {
        // An unconfirmed Perks guess that OCR rejects is just some other image.
        if (c.confirmed) console.warn(`Couldn't read ${file.name} as ${c.kind}`, err);
      }
    }
  } catch (err) {
    state.scan.error = err.message;
  }
  state.scan.busy = false;
  apply();
}

async function readCollectionsSafe(img, rect) {
  try {
    const worker = await ocrWorker();
    return await readCollections(img, rect, async (part) => (await worker.recognize(await toBlob(part))).data.text);
  } catch (err) {
    console.warn("Collections OCR failed", err);
    return null;
  }
}

// Toggling several Fortress chips in a row shouldn't reload the Lab each time.
let applyTimer;
function applySoon() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(apply, 700);
}

function apply() {
  const u = state.unlocks?.result, s = state.skills?.result;
  if (!u || !s) { render(); return; }
  const profile = computeProfile({
    owned: u.owned,
    levels: s.levels,
    collectorFraction: state.unlocks.collections?.fraction ?? 0,
    potion: state.potion,
    fort: state.fort,
    talents: state.talents,
    perks: state.perksSaved,
    globes: state.globes,
  });
  // The map optimizer (map.html) runs on the same readings.
  try {
    localStorage.setItem(SKILLING_PROFILE_KEY, JSON.stringify({
      levels: s.levels,
      unlocks: profile.unlocks,
      movementSpeed: profile.movementSpeed,
      backpackSize: state.fort.known ? profile.backpackSize : null,
      globe: GLOBES[state.globes] ?? 0,
    }));
  } catch {}
  let lab;
  try { lab = JSON.parse(localStorage.getItem(LAB_STORAGE_KEY)); } catch { lab = null; }
  if (!lab?.profiles?.Me) {
    state.applied = { error: "Gauntlet Lab hasn't saved a Me profile yet. Open the Lab once, then import again." };
    render();
    return;
  }
  applyRoleTiers(lab, profile.roleTiers);
  applyUnlockStats(lab, profile.unlocks, s.levels);
  applyMovementSpeed(lab, profile.movementSpeed);
  if (state.fort.known) applyBackpackSize(lab, profile.backpackSize);
  applyXpBonus(lab, profile.xp.total);
  localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(lab));
  state.applied = profile;
  // The Lab only reads its state on load; the card is re-added on load.
  frame.contentWindow.location.reload();
}

// ---- Card inside the Lab ----

const CSS = `
.swi { margin: 0 0 14px; padding: 14px 16px; background: #fff; border: 1px solid #d8dee8; border-radius: 8px; font-size: 13px; }
.swi h3 { margin: 0 0 4px; font-size: 15px; }
.swi p { margin: 4px 0; color: #4b5563; }
.swi-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: stretch; margin-top: 10px; }
.swi-zone { flex: 1 1 220px; min-height: 74px; border: 2px dashed #b8c2d0; border-radius: 8px; padding: 10px; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 2px; background: #f8fafc; }
.swi-zone.target { border-color: #2563eb; background: #eff6ff; }
.swi-zone.over { border-color: #2563eb; background: #dbeafe; }
.swi-zone strong { font-size: 13px; }
.swi-zone span { color: #4b5563; }
.swi-ok { color: #15803d !important; }
.swi-bad { color: #b91c1c !important; }
.swi-side { display: flex; flex-direction: column; gap: 6px; justify-content: center; }
.swi-side select { padding: 4px 6px; }
.swi-ex-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 8px; }
.swi-ex-grid figure { margin: 0; }
.swi-ex-grid img { width: 100%; height: 180px; object-fit: contain; background: #0f172a; border: 1px solid #d8dee8; border-radius: 6px; display: block; }
.swi-ex-grid figcaption { margin-top: 4px; color: #4b5563; }
.swi-warn { margin: 8px 0 0; padding-left: 18px; color: #92400e; }
.swi details { margin-top: 10px; }
.swi summary { cursor: pointer; font-weight: 600; }
.swi table { border-collapse: collapse; margin-top: 6px; }
.swi td, .swi th { padding: 2px 8px 2px 0; text-align: left; vertical-align: top; }
.swi th { color: #4b5563; font-weight: 600; }
.swi-fort { margin-top: 10px; }
.swi-fort table { margin-top: 4px; }
.swi-chip { border: 1px solid #b8c2d0; background: #fff; border-radius: 10px; padding: 1px 7px; margin: 0 3px 0 0; font-size: 12px; cursor: pointer; color: #4b5563; }
.swi-chip.on { background: #2563eb; border-color: #2563eb; color: #fff; }
.swi-folder { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.swi-folder button { padding: 5px 10px; border: 1px solid #2563eb; background: #2563eb; color: #fff; border-radius: 6px; cursor: pointer; font-size: 13px; }
.swi-folder button.alt { background: #fff; color: #2563eb; }
.swi.over { outline: 2px dashed #2563eb; }
.swi .swi-levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 2px 10px; margin-top: 6px; }
`;

function h(tag, props = {}, ...children) {
  const doc = frame.contentDocument;
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

function zone(kind, title, hint) {
  const s = state[kind];
  let status;
  if (!s) status = h("span", {}, hint);
  else if (s.busy) status = h("span", {}, `Reading ${s.name}…`);
  else if (s.error) status = h("span", { class: "swi-bad" }, s.error);
  else status = h("span", { class: "swi-ok" }, `✓ ${s.name}: ${summaryOf(kind)}`);
  const input = h("input", { type: "file", accept: "image/*", hidden: "" });
  input.addEventListener("change", () => input.files[0] && readFile(kind, input.files[0]));
  const el = h("div", {
    class: "swi-zone" + (state.target === kind ? " target" : ""),
    onclick: () => { state.target = kind; input.click(); render(); },
    ondragover: (e) => { e.preventDefault(); el.classList.add("over"); },
    ondragleave: () => el.classList.remove("over"),
    ondrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("over");
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
      if (file) readFile(kind, file);
    },
  }, h("strong", {}, title), status, input);
  return el;
}

function summaryOf(kind) {
  if (kind === "perks") {
    const r = state.perks.result, b = r.bonusPct;
    return `${r.stepsPerSec} steps/sec, +${b.telescopes ?? "?"}% telescopes, +${b.compasses ?? "?"}% compasses`
      + (r.consistent ? "" : " (doesn't add up; not used)");
  }
  if (kind === "fortify") {
    const t = state.fortify.result.talents;
    return `+${t.moveSpeedPct}% move, +${t.successPct}% success, +${t.doubleGatherPct}% double, ${t.actionTimeSec}s action`;
  }
  if (kind === "fortress") {
    const owned = Object.values(state.fortress.result.owned).reduce((n, set) => n + set.size, 0);
    return `${owned} Ledgers, Banners, Beacons and Satchels owned`;
  }
  if (kind === "skills") {
    const r = state.skills.result;
    const check = { ok: "total matches", fixed: "total matches after a fix", mismatch: "total doesn't match" }[r.checksum];
    return `${Object.keys(r.levels).length} levels, total ${r.total ?? "?"} (${check})`;
  }
  const r = state.unlocks.result, c = state.unlocks.collections;
  const owned = Object.values(r.owned).reduce((n, set) => n + set.size, 0);
  return `${owned} unlocks owned, ` + (c ? `collections ${c.count}/${c.total}` : "collections not read (counted as 0)");
}

function fortPicker() {
  const owned = FORT_FAMILIES.reduce((n, f) => n + state.fort[f].size, 0);
  const el = h("details", { class: "swi-fort", "data-key": "fort" },
    h("summary", {}, `Fortress items (${owned} owned)`),
    h("p", {}, "Filled from the Fortress screenshot, or click the tiers you own. They're remembered."),
    h("table", {}, FORT_FAMILIES.map((family) => h("tr", {},
      h("th", {}, FORT_LABELS[family]),
      h("td", {}, FORT_TIERS.filter((t) => family !== "fortification" || t !== "C7").map((tier) => h("button", {
        type: "button",
        class: "swi-chip" + (state.fort[family].has(tier) ? " on" : ""),
        onclick: () => {
          const set = state.fort[family];
          set.has(tier) ? set.delete(tier) : set.add(tier);
          saveFort();
          render();
          applySoon();
        },
      }, tier)))))));
  return el;
}

function details() {
  const u = state.unlocks?.result, s = state.skills?.result, p = state.applied;
  const parts = [];
  if (p && !p.error) {
    parts.push(h("details", { open: "", "data-key": "applied" }, h("summary", {}, "Written to Me"),
      h("table", {},
        h("tr", {}, h("th", {}, "Role"), h("th", {}, "Tier"), h("th", {}, "Gather time"), h("th", {}, "Success"), h("th", {}, "Double"), h("th", {}, "Process time"), h("th", {}, "Success"), h("th", {}, "Save"), h("th", {}, "Auto-process"), h("th", {}, "Auto-bank")),
        Object.entries(p.roleStats).map(([role, r]) => h("tr", {},
          h("td", {}, role), h("td", {}, `T${p.roleTiers[role]}`),
          h("td", {}, r.gather_time.toFixed(3)), h("td", {}, pct(r.gather_success)), h("td", {}, pct(r.double_gather)),
          h("td", {}, r.process_time.toFixed(3)), h("td", {}, pct(r.process_success)), h("td", {}, pct(r.material_save ?? 0)), h("td", {}, pct(r.auto_process ?? 0)), h("td", {}, pct(r.auto_bank ?? 0)))),
      ),
      h("p", {}, `Movement speed ${p.movementSpeed} (${POTION_LABELS[state.potion]} potion).`
        + (state.fort.known ? ` Backpack ${p.backpackSize} slots.` : "")),
      h("p", {}, `Fortify XP +${p.xp.total}%: `
        + Object.entries(XP_LABELS).map(([k, label]) => `${label} ${p.xp.parts[k]}%`).join(", ")
        + ". Slates, medallions and quest bonuses aren't read.")));
  }
  if (s) {
    parts.push(h("details", { "data-key": "levels" }, h("summary", {}, "Levels read"),
      h("div", { class: "swi-levels" }, SKILLS.map((k) => h("div", {}, `${k} `, h("b", {}, String(s.levels[k] ?? "?")))))));
  }
  if (u) {
    parts.push(h("details", { "data-key": "unlocks" }, h("summary", {}, "Unlocks read"),
      h("table", {}, ["levels", ...SKILLS].map((k) => h("tr", {},
        h("th", {}, k === "levels" ? "all skills" : k),
        h("td", {}, [...(u.owned[k] ?? [])].join(" ") || "none"))))));
  }
  return parts;
}

const pct = (v) => `${Math.round(v * 1000) / 10}%`;

function card() {
  const warnings = [
    ...(state.skills?.result?.warnings ?? []),
    ...(state.unlocks?.result?.warnings ?? []),
    ...(state.fortress?.result?.warnings ?? []),
    state.perks?.result && !state.perks.result.questRewards && !state.perks.result.globes
      ? "The Quest Rewards row wasn't in the Perks screenshot, so the Globes of Skills weren't checked. Scroll down until it shows too." : null,
    state.perks?.result && !state.perks.result.consistent ? "The movement line didn't add up to its steps/sec, so it wasn't used. Try a sharper screenshot." : null,
    state.fortify?.result?.unread ? `Couldn't read ${state.fortify.result.unread} line(s) of the Fortify Tree summary; they count as 0.` : null,
    state.unlocks?.result && !state.unlocks.busy && !state.unlocks.collections ? "Couldn't read the Collections count above the grid; the collector bonus counts as 0." : null,
    state.applied?.error,
  ].filter(Boolean);
  const potion = h("select", { onchange: (e) => {
    state.potion = e.target.value;
    try { localStorage.setItem(POTION_KEY, state.potion); } catch {}
    applySoon();
  } }, Object.keys(POTIONS).map((k) => {
    const o = h("option", { value: k }, POTION_LABELS[k]);
    o.selected = k === state.potion;
    return o;
  }));
  const el = h("section", {
    class: "swi", id: "swi-card",
    // Several files dropped anywhere on the card are sorted out like a folder.
    ondragover: (e) => { e.preventDefault(); el.classList.add("over"); },
    ondragleave: (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("over"); },
    ondrop: (e) => {
      e.preventDefault();
      el.classList.remove("over");
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) importFiles(files);
    },
  },
    h("h3", {}, "Import Me from screenshots"),
    h("p", {}, "Drop, click or paste (Ctrl+V into the highlighted box) a screenshot of the Unlocks page and of the Skills panel, and optionally Collections → The Fortress, the Fortify Tree and the Perks section (movement, with telescopes and compasses). Several screenshots dropped anywhere on this card are sorted out automatically. Role tiers, role stats, movement speed and backpack size are written to Me."),
    folderRow(),
    h("div", { class: "swi-row" },
      zone("unlocks", "Unlocks page", "Include the skill icons above the grid and the Collections count."),
      zone("skills", "Skills panel", "All skill boxes and the total level."),
      zone("fortress", "Fortress collection", "Collections → The Fortress, opened, with Milestone Rewards and Rare Drops."),
      zone("fortify", "Fortify Tree", "Collections → Fortify Tree, with the stat summary in the top-left corner."),
      zone("perks", "Unlocks → Perks", "Scroll the Unlocks page to Perks so the Total Movement Speed line and the Quest Rewards row show."),
      h("label", { class: "swi-side" }, "Movement potion", potion)),
    examples(),
    fortPicker(),
    warnings.length ? h("ul", { class: "swi-warn" }, warnings.map((w) => h("li", {}, w))) : null,
    h("p", {}, state.perksSaved
      ? "Movement speed comes from the Perks screenshot (telescopes and compasses included)."
      : "Without the Perks screenshot, movement leaves out telescopes and compasses."),
    h("p", {}, `Globes of Skills: ${GLOBE_LABELS[state.globes]}`
      + (state.globes !== "none" ? ` (+${Math.round(GLOBES[state.globes] * 100)}% auto-process and auto-bank on every role)` : "")
      + ". Read from the Quest Rewards row of the Perks screenshot."),
    details());
  return el;
}

function setGlobes(value) {
  state.globes = value;
  try { localStorage.setItem(GLOBES_KEY, value); } catch {}
}

// Example screenshots, collapsed by default so they stay out of the way.
function examples() {
  let open = false;
  try { open = localStorage.getItem(EXAMPLES_KEY) === "1"; } catch {}
  const el = h("details", { class: "swi-examples", ontoggle: () => {
    try { localStorage.setItem(EXAMPLES_KEY, el.open ? "1" : "0"); } catch {}
  } }, h("summary", {}, "What to screenshot (examples)"),
    h("div", { class: "swi-ex-grid" }, EXAMPLES.map(([kind, title, note]) => {
      // Absolute, because the card lives inside the Lab's iframe.
      const src = new URL(`examples/${kind}.webp`, document.baseURI).href;
      return h("figure", {},
        h("a", { href: src, target: "_blank", rel: "noopener" }, h("img", { src, alt: `Example ${title} screenshot`, loading: "lazy" })),
        h("figcaption", {}, h("strong", {}, title), " ", note));
    })));
  el.open = open;
  return el;
}

const KIND_LABELS = { unlocks: "Unlocks", skills: "Skills", fortress: "Fortress", fortify: "Fortify Tree", perks: "Perks" };

function folderRow() {
  const s = state.scan;
  let status = "Or pick your screenshots folder: the newest screenshot of each kind is used, the rest ignored.";
  if (s?.busy) status = `Checking ${s.done} of ${s.total} newest images…`;
  else if (s?.error) status = s.error;
  else if (s) {
    const missing = KINDS.filter((k) => !s.found[k]).map((k) => KIND_LABELS[k]);
    status = `Checked ${s.done} image(s). Found ${KINDS.filter((k) => s.found[k]).map((k) => KIND_LABELS[k]).join(", ") || "nothing"}.`
      + (missing.length ? ` Not found: ${missing.join(", ")}.` : "");
  }
  return h("div", { class: "swi-folder" },
    h("button", { type: "button", onclick: pickFolder }, folder ? "Change folder" : "Pick screenshots folder"),
    folder ? h("button", { type: "button", class: "alt", onclick: scanFolder }, `Rescan ${folder.name}`) : null,
    h("span", { class: s?.error ? "swi-bad" : "" }, status));
}

function render() {
  const doc = frame.contentDocument;
  const panel = doc?.getElementById("profiles-panel");
  if (!panel) return;
  if (!doc.getElementById("swi-style")) doc.head.append(Object.assign(doc.createElement("style"), { id: "swi-style", textContent: CSS }));
  // Keyed, not by summary text: the Fortress summary includes a changing count.
  const open = new Map([...doc.querySelectorAll("#swi-card details[data-key]")].map((d) => [d.dataset.key, d.open]));
  const next = card();
  for (const d of next.querySelectorAll("details[data-key]")) if (open.has(d.dataset.key)) d.open = open.get(d.dataset.key);
  const old = doc.getElementById("swi-card");
  if (old) old.replaceWith(next);
  else panel.prepend(next);
}

function onPaste(e) {
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
  if (!file) return;
  e.preventDefault();
  const kind = state.target;
  // Next paste goes to the next box, so pastes in a row fill them in turn.
  state.target = KINDS[(KINDS.indexOf(kind) + 1) % KINDS.length];
  readFile(kind, file);
}

// The Lab is upstream code we don't edit, so the site's name is swapped in
// from outside. Credit to the original stays in the page footer.
const BRAND = "CheezWatch";
function rebrand(doc) {
  doc.title = doc.title.replace(/Gauntlet Lab/g, BRAND);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue.includes("Gauntlet Lab")) n.nodeValue = n.nodeValue.replace(/Gauntlet Lab/g, BRAND);
  }
}

// The Lab rewrites the selected result's text on every row click, so the
// drops are appended again whenever the marker is missing.
const DROPS_MARK = "RARE DROPS AT WAVE";
function addDrops(doc) {
  for (const pre of doc.querySelectorAll(".result-detail")) {
    if (pre.textContent.includes(DROPS_MARK)) continue;
    const best = mostLikelyWave(pre.textContent);
    if (!best) continue;
    let extra = `

${dropsSection(best.wave, best.pct)}`;
    try {
      const state = JSON.parse(frame.contentWindow.localStorage.getItem("gauntlet-lab-web-current-v3"));
      const deposits = depositsSection(frame.contentWindow.Gauntlet, state, pre.textContent, best.wave);
      if (deposits) extra = `

${deposits}${extra}`;
    } catch (err) { console.warn("deposits", err); }
    pre.append(doc.createTextNode(extra));
  }
}

function attach() {
  const doc = frame.contentDocument;
  if (!doc?.body) return;
  const win = frame.contentWindow;
  const alert = win.alert.bind(win);
  win.alert = (msg) => alert(String(msg).replace(/Gauntlet Lab/g, BRAND));
  rebrand(doc);
  render();
  mountSwapCard(doc);
  // The Lab rebuilds the Profiles tab from scratch on every change.
  new MutationObserver(() => {
    if (!doc.getElementById("swi-card")) render();
    mountSwapCard(doc);
    rebrand(doc);
    addDrops(doc);
  }).observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener("paste", onPaste);
}

frame.addEventListener("load", attach);
document.addEventListener("paste", onPaste);
if (frame.contentDocument?.readyState === "complete") attach();
