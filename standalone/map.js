// Map Optimizer page: works out the free location (node) weights your diaries
// allow. It reads the Skills Customization screenshot (levels, skill weights,
// task automaters) and Diary screenshots (each bank's tier), takes movement
// speed and action bonuses from the main page's import, and simulates the
// task queue in a worker.
import { binarize } from "./vision/collections.js";
import { crop } from "./vision/image.js";
import { readSkillWeights, WEIGHT_SKILLS, WEIGHTS_OCR_PARAMS } from "./vision/skill-weights.js";
import { isDiaryScreen, readDiary } from "./vision/diary.js";
import { vigorBaseSpeed } from "./lib/lab-profile.js";

const KEY = "cheezwatch-map-v2";
const PROFILE_KEY = "cheezwatch-skilling-profile";
const LEVER_SKILLS = WEIGHT_SKILLS.filter((s) => s !== "luck" && s !== "quests");
const AUTOMATER_NAMES = {
  luck: "Luck", quests: "Quests", tier: "Highest Tier", quantity: "Highest Quantity",
  materials: "Has Materials", distance: "Distance (Skills)", slay: "Distance (Slay)",
};
const MAX_SCAN = 40;
const NAME = (s) => s[0].toUpperCase() + s.slice(1);
const fmt = (n) => (n == null || !isFinite(n) ? "–" : Math.round(n).toLocaleString());
const pct = (n) => `${Math.round(n * 100)}%`;
const signed = (v) => (v > 0 ? `+${v}` : String(v));

const app = document.getElementById("app");
const saved = (() => { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch { return null; } })();
const stored = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } })();

const state = {
  data: null,
  dataError: null,
  weights: stored?.weights ?? null, // { levels, levers, automaters, automaterOrder, percent, name }
  diaries: stored?.diaries ?? {}, // bank id → { done, total, tier, name }
  goals: stored?.goals ?? null,
  groupMode: stored?.groupMode ?? "node",
  playMode: stored?.playMode ?? "afk",
  reading: null, // { busy, done, total, messages: [] }
  run: null,
  result: stored?.result ?? null,
};

function save() {
  const { weights, diaries, goals, groupMode, playMode, result } = state;
  try { localStorage.setItem(KEY, JSON.stringify({ weights, diaries, goals, groupMode, playMode, result })); } catch {}
}

// Goal weights follow the positive skill weights: +5/+5/+2 gives 1/1/0.4.
function goalsFromLevers(levers) {
  const top = Math.max(0, ...LEVER_SKILLS.map((s) => levers[s] ?? 0));
  if (!top) return {};
  return Object.fromEntries(LEVER_SKILLS.filter((s) => levers[s] > 0).map((s) => [s, Math.round((levers[s] / top) * 100) / 100]));
}

function simProfile() {
  const levels = { ...(saved?.levels ?? {}), ...(state.weights?.levels ?? {}) };
  const u = saved?.unlocks ?? {};
  const all = u.all_skills ?? {};
  const bonus = {};
  for (const s of LEVER_SKILLS) {
    const b = u[s];
    bonus[s] = { seconds: -(b?.duration ?? all.all_durations ?? 0), success: b?.success ?? all.success ?? 0, duplicate: b?.duplicate ?? 0, save: b?.save ?? 0 };
  }
  const luckLever = state.weights?.levers?.luck ?? 0;
  const l = levels.luck ?? 1;
  return {
    levels,
    moveSpeed: saved?.movementSpeed ?? vigorBaseSpeed(levels.vigor ?? 1),
    backpack: saved?.backpackSize ?? 28,
    bonus,
    autoBank: saved?.globe ?? 0,
    autoProcess: saved?.globe ?? 0,
    // The screenshot's Luck % is too dim to read, so it's the game's formula
    // without unlocks (they add 0.05% each).
    luckChance: (0.5 + 0.2 * luckLever + 0.01 * l + (l >= 99 ? 0.01 : 0)) / 100,
    luckLever,
  };
}

// ---- Reading screenshots ----

let ocr;
function ocrWorkers() {
  const make = async (params) => {
    const w = await Tesseract.createWorker("eng", 1, { workerPath: "vendor/worker.min.js", corePath: "vendor/core", langPath: "vendor/lang", workerBlobURL: false });
    await w.setParameters(params);
    return w;
  };
  ocr ??= Promise.all([
    make(WEIGHTS_OCR_PARAMS),
    make({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "+-12345" }),
    make({ tessedit_pageseg_mode: "7" }),
  ]);
  ocr.catch(() => { ocr = undefined; });
  return ocr;
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

async function pageWords(page, img, scale = 2) {
  const { data } = await page.recognize(await toBlob(binarize(img, scale, 0.3)), {}, { blocks: true });
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
    .map((w) => ({ text: w.text, x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale, bbox: w.bbox }));
}

// What a screenshot is, from the title in its top part (a whole game window
// puts the panel's title lower down, so a fifth of the height is searched).
async function kindOf(page, img) {
  const words = await pageWords(page, crop(img, 0, 0, img.width, Math.round(img.height * 0.22)), 1);
  const text = words.map((w) => w.text).join(" ");
  if (/Customi[sz]ation|Skill\s*Credits/i.test(text)) return "weights";
  if (/\bDiary\b/i.test(text)) return "diary";
  return null;
}

// Reads one screenshot; `newer` says whether a newer one was already taken.
async function readOne(file, kind, taken) {
  const [page, digit, line] = await ocrWorkers();
  const img = await decode(file);
  // A crop of the diary cards has no title, so anything that isn't the
  // Skills screen gets the (slower) whole-page diary check.
  kind ??= (await kindOf(page, img)) ?? "diary";
  const name = file.name || "pasted image";
  if (kind === "diary") {
    const words = await pageWords(page, img);
    if (!isDiaryScreen(words)) return null;
    const got = readDiary(words, state.data.banks.map((b, i) => ({ id: String(i), name: b.name })));
    let added = 0;
    for (const [bank, v] of Object.entries(got)) {
      if (taken.has(`d${bank}`)) continue;
      taken.add(`d${bank}`);
      state.diaries[bank] = v;
      added++;
    }
    return `${name}: ${Object.keys(got).length} diaries${added < Object.keys(got).length ? ` (${added} new)` : ""}`;
  }
  if (kind === "weights") {
    if (taken.has("weights")) return `${name}: older Skills Customization, skipped`;
    const got = await readSkillWeights(
      img,
      // readSkillWeights binarizes and scales the page itself.
      async (part) => {
        const { data } = await page.recognize(await toBlob(part), {}, { blocks: true });
        return { words: (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))) };
      },
      async (part) => (await digit.recognize(await toBlob(part))).data.text,
      async (part) => (await line.recognize(await toBlob(part))).data.text,
    );
    if (got.found.length < 5) return null;
    taken.add("weights");
    state.weights = { levels: got.levels, levers: got.levers, automaters: got.automaters, automaterOrder: got.automaterOrder, name, warnings: got.warnings };
    state.goals = goalsFromLevers(got.levers);
    return `${name}: Skills Customization`;
  }
  return null;
}

// Newest first, so the newest Skills screenshot wins and each bank's
// diary comes from its newest screenshot.
async function readFiles(files, kindHint) {
  if (!state.data) return;
  files = [...files].filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(f.name))
    .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0)).slice(0, MAX_SCAN);
  if (!files.length) return;
  state.reading = { busy: true, done: 0, total: files.length, messages: [] };
  render();
  const taken = new Set();
  for (const f of files) {
    try {
      const msg = await readOne(f, kindHint, taken);
      if (msg) state.reading.messages.push(msg);
    } catch (err) {
      state.reading.messages.push(`${f.name}: ${err.message}`);
    }
    state.reading.done++;
    render();
  }
  if (!state.reading.messages.length) state.reading.messages.push("No Skills Customization or Diary screenshots found.");
  state.reading.busy = false;
  state.result = null;
  save();
  render();
}

async function scanFolder() {
  if (window.showDirectoryPicker) {
    let dir;
    try { dir = await window.showDirectoryPicker({ id: "screenshots", startIn: "pictures" }); } catch { return; }
    const files = [];
    for await (const entry of dir.values()) if (entry.kind === "file" && /\.(png|jpe?g|webp|bmp)$/i.test(entry.name)) files.push(await entry.getFile());
    readFiles(files);
  } else {
    const input = h("input", { type: "file", webkitdirectory: true, multiple: true, onchange: (e) => readFiles(e.target.files) });
    input.click();
  }
}

// ---- Simulation ----

let worker;
function run() {
  if (!state.data || !state.weights) return;
  worker?.terminate();
  worker = new Worker(new URL("./map-worker.js", import.meta.url), { type: "module" });
  state.run = { stage: "Starting", done: 0, total: 1 };
  render();
  const goals = Object.fromEntries(Object.entries(state.goals ?? {}).filter(([, v]) => v > 0));
  const { quests, ...levers } = state.weights.levers;
  const order = state.weights.automaterOrder ?? [];
  const autos = state.weights.automaters ?? {};
  worker.postMessage({
    data: state.data,
    profile: simProfile(),
    levers,
    goals,
    tiers: Object.fromEntries(Object.entries(state.diaries).map(([b, v]) => [b, v.tier])),
    groupMode: state.groupMode,
    policy: {
      mode: state.playMode,
      tracked: true,
      automaters: order.filter(Boolean).map((kind) => ({ kind, chance: autos[kind]?.chance ?? 0 })),
    },
  });
  worker.onmessage = ({ data: msg }) => {
    if (msg.kind === "progress") { Object.assign(state.run, msg); render(); return; }
    worker.terminate();
    worker = null;
    state.run = null;
    state.result = msg.kind === "error" ? { error: msg.message } : { ...msg, goals };
    save();
    render();
  };
  worker.onerror = (e) => { state.run = null; state.result = { error: e.message || "Worker failed" }; render(); };
}

// ---- Rendering ----

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function inputs() {
  const input = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: (e) => readFiles(e.target.files) });
  const zone = h("div", { class: "drop", onclick: () => input.click() },
    h("b", {}, "Drop, paste or click to add screenshots"),
    h("div", { class: "dim" }, "Skills Customization (levels, skill weights, task automaters) and Diary pages (scroll and take a few so every bank shows). Any order, many at once."),
    input);
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); readFiles(e.dataTransfer.files); });
  const r = state.reading;
  return [zone,
    h("div", { class: "buttons", style: "margin-top:8px" },
      h("button", { disabled: !!r?.busy || !state.data, onclick: scanFolder }, "Scan my screenshots folder"),
      h("span", { class: "dim" }, `Reads the newest ${MAX_SCAN} images and keeps the newest of each.`),
      Object.keys(state.diaries).length ? h("button", { onclick: () => { state.diaries = {}; state.result = null; save(); render(); } }, "Forget diaries") : null),
    r ? h("div", {},
      r.busy ? h("p", {}, `Reading ${r.done + 1} of ${r.total}…`) : null,
      h("ul", { class: "tips" }, r.messages.map((m) => h("li", {}, m)))) : null];
}

function summary() {
  const w = state.weights;
  const banks = state.data?.banks ?? [];
  const known = Object.keys(state.diaries).length;
  const parts = [];
  if (!w) parts.push(h("p", { class: "warn" }, "No Skills Customization screenshot yet."));
  else {
    const levers = LEVER_SKILLS.filter((s) => w.levers[s]).map((s) => `${NAME(s)} ${signed(w.levers[s])}`).join(", ");
    parts.push(h("p", {}, h("b", {}, "Skill weights: "), levers || "all 0", h("span", { class: "dim" }, ` (${w.name})`)));
    const order = (w.automaterOrder ?? []).filter(Boolean);
    parts.push(h("p", {}, h("b", {}, "Task automaters, in priority order: "),
      order.length ? order.map((k, i) => {
        const a = w.automaters[k];
        const label = `${AUTOMATER_NAMES[k]} ${a.enabled ? (a.chance ? pct(a.chance) : "on, none owned") : a.owned ? "off" : "not owned"}`;
        return h("span", { class: a.enabled && a.chance ? "" : "dim" }, i ? ", " : "", label);
      }) : "not found"));
    for (const warn of w.warnings ?? []) parts.push(h("div", { class: "warn" }, warn));
  }
  parts.push(h("p", {}, h("b", {}, "Diaries: "), `${known} of ${banks.length} banks read. `,
    known < banks.length ? h("span", { class: "dim" }, "Banks not read count as tier 0 (no free weight). ") : null));
  if (known) {
    parts.push(h("div", { class: "tiers" }, banks.map((b, i) => {
      const d = state.diaries[i];
      return h("span", { class: d ? "" : "dim" }, `${b.name.replace(/\s+Bank$/, "")} `, h("b", {}, d ? `±${d.tier}` : "?"));
    })));
  }
  parts.push(h("p", { class: saved ? "dim" : "warn" }, saved
    ? `Movement ${saved.movementSpeed} steps/sec, backpack ${saved.backpackSize ?? 28}, action bonuses: from your main-page import.`
    : "Import your Unlocks and Skills screenshots on the main page first: movement speed and action bonuses come from there. Until then, base values are used."));
  return parts;
}

function goalsEditor() {
  const goals = state.goals ?? {};
  return h("details", {},
    h("summary", {}, "Goals: ", Object.entries(goals).filter(([, v]) => v > 0).map(([s, v]) => `${NAME(s)} ${pct(v)}`).join(", ") || "none (set at least one)"),
    h("div", { class: "goal-grid" }, LEVER_SKILLS.map((s) => h("label", {}, NAME(s), " ",
      h("input", { type: "number", min: 0, max: 1, step: 0.1, value: goals[s] ?? 0,
        onchange: (e) => { state.goals = { ...goals, [s]: Number(e.target.value) || 0 }; state.result = null; save(); render(); } })))));
}

function controls() {
  const radio = (name, value, label, key) => h("label", { class: "radio" },
    h("input", { type: "radio", name, checked: state[key] === value, onchange: () => { state[key] = value; state.result = null; save(); render(); } }), " ", label);
  const ready = state.data && state.weights && Object.values(state.goals ?? {}).some((v) => v > 0);
  return h("div", {},
    h("div", { class: "buttons" }, h("b", {}, "Weights for:"), radio("group", "node", "each location separately", "groupMode"), radio("group", "bank", "whole bank areas at once", "groupMode")),
    h("div", { class: "buttons" }, h("b", {}, "Play style:"), radio("play", "afk", "AFK (automaters pick)", "playMode"), radio("play", "active", "Active (I pick and reroll)", "playMode")),
    h("div", { class: "buttons", style: "margin-top:8px" },
      h("button", { class: "primary", disabled: !ready || !!state.run, onclick: run }, "Calculate location weights"),
      state.run ? h("span", { class: "dim" }, `${state.run.stage}… ${state.run.total > 1 ? `${state.run.done}/${state.run.total}` : ""}`) : null),
    state.dataError ? h("p", { class: "warn" }, state.dataError) : null);
}

function results() {
  const r = state.result;
  if (!r || !state.data) return null;
  if (r.error) return h("section", {}, h("h2", {}, "Result"), h("p", { class: "warn" }, r.error));
  const banks = state.data.banks;
  const goals = Object.keys(r.goals);
  const gain = r.after.valuePerHour / r.before.valuePerHour - 1;
  const xpRows = [["Goal XP/hr (weighted)", r.before.valuePerHour, r.after.valuePerHour], ...goals.map((g) => [`${NAME(g)} XP/hr`, r.before.xpPerHour[g] ?? 0, r.after.xpPerHour[g] ?? 0])];
  // Group the recommendations by bank.
  const byBank = new Map();
  for (const g of r.groups) {
    if (!byBank.has(g.bank)) byBank.set(g.bank, []);
    byBank.get(g.bank).push(g);
  }
  const lever = (v) => h("b", { class: v > 0 ? "up" : v < 0 ? "down" : "" }, signed(v));
  const bankList = [...byBank.entries()].sort((a, b) => banks[a[0]].name.localeCompare(banks[b[0]].name));
  const table = r.groupMode === "bank"
    ? h("table", {}, h("tr", {}, h("th", {}, "Bank area"), h("th", { class: "num" }, "Free range"), h("th", { class: "num" }, "Set to")),
      bankList.map(([b, gs]) => h("tr", {}, h("td", {}, banks[b].name), h("td", { class: "num dim" }, `±${gs[0].range}`), h("td", { class: "num" }, lever(gs[0].lever)))))
    : h("div", {}, bankList.map(([b, gs]) => {
      const up = gs.filter((g) => g.lever > 0).length, down = gs.filter((g) => g.lever < 0).length;
      return h("details", {},
        h("summary", {}, h("b", {}, banks[b].name), ` ±${gs[0].range}: ${up} up, ${down} down`),
        h("table", {}, gs.sort((a, b2) => b2.lever - a.lever || a.nodes[0].name.localeCompare(b2.nodes[0].name)).map((g) => h("tr", {},
          h("td", {}, g.nodes[0].name), h("td", { class: "dim" }, g.nodes[0].skills.map(NAME).join(", ")),
          h("td", { class: "num dim" }, `bank ${fmt(g.nodes[0].bankDist)}`), h("td", { class: "num" }, lever(g.lever))))));
    }));
  return h("section", {},
    h("h2", {}, `Recommended location weights (${r.mode === "afk" ? "AFK" : "active"})`),
    h("div", { class: "grid" },
      h("div", {},
        h("table", {}, h("tr", {}, h("th", {}), h("th", { class: "num" }, "All locations at 0"), h("th", { class: "num" }, "Recommended")),
          xpRows.map(([k, a, b]) => h("tr", {}, h("td", {}, k), h("td", { class: "num" }, fmt(a)), h("td", { class: "num" }, fmt(b))))),
        h("p", {}, `Location weights are worth `, h("b", { class: gain >= 0 ? "up" : "down" }, `${gain >= 0 ? "+" : ""}${(gain * 100).toFixed(1)}%`),
          ` goal XP/hr with your diaries as they are`, r.ceiling ? ` (with every diary finished: +${((r.ceiling.valuePerHour / r.before.valuePerHour - 1) * 100).toFixed(1)}%)` : "", ".",
          r.mode === "active" ? ` Reroll a row when its best task is under ${fmt(r.heuristics.averagePerHour * r.rerollBelow)} goal XP/hr.` : "")),
      h("div", {},
        h("h3", {}, "Diaries worth pushing to the next tier"),
        r.gains.length ? h("table", {}, h("tr", {}, h("th", {}, "Bank"), h("th", { class: "num" }, "Now"), h("th", { class: "num" }, "Goal XP/hr gained")),
          r.gains.map((x) => h("tr", {}, h("td", {}, x.name), h("td", { class: "num dim" }, `±${x.tier}`), h("td", { class: "num" }, `+${fmt(x.gain)}`))))
          : h("p", { class: "dim" }, "No single diary tier makes a measurable difference."))),
    h("h3", {}, r.groupMode === "bank" ? "Set each bank area to" : "Set each location to (open a bank)"),
    h("p", { class: "dim" }, "Locations you can't weight (diary tier 0) or that don't affect your tasks aren't listed. Max out within the range: the best weights sit at the ends."),
    table);
}

function render() {
  app.replaceChildren(
    h("section", {}, h("h2", {}, "1. Screenshots"), inputs()),
    h("section", {}, h("h2", {}, "2. What was read"), summary(), goalsEditor()),
    h("section", {}, h("h2", {}, "3. Calculate"), controls()),
    results(),
    h("section", {}, h("details", {}, h("summary", {}, "How it works, and what it assumes"),
      h("ul", { class: "tips" },
        h("li", {}, "A task rolls skill → activity → location → quantity. Your diary tier at a bank lets you weight each of its locations from −tier to +tier for free; a location's chance among the places offering that activity is 10 × 1.25^weight, like skill weights."),
        h("li", {}, "A location is better when its bank is closer (shorter trips per backpack) and when it lies near your other tasks (less walking between them). The page simulates 8 × 200 hours of your queue per setting and keeps what raises goal XP/hr."),
        h("li", {}, "AFK: the automaters you have switched on pick in your priority order; otherwise the first option. Active: you pick the best option by XP/hr including the walk, and reroll weak rows while credits last."),
        h("li", {}, "Assumed: activities are equally likely within a skill; a processing task without materials processes what's in the bank; quests and combat aren't simulated."))))
  );
}

document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); readFiles(files); }
});

render();
fetch("data/map.json")
  .then((r) => { if (!r.ok) throw new Error(`map data missing (${r.status})`); return r.json(); })
  .then((d) => { state.data = d; render(); })
  .catch((err) => { state.dataError = `Couldn't load the map data: ${err.message}.`; render(); });
