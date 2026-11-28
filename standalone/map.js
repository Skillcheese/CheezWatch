// Map Optimizer page: reads the Skills Customization screenshot (levels and
// skill weights), takes movement speed and unlock bonuses from the main
// page's import, and runs the task-queue simulation in a worker.
import { readSkillWeights, WEIGHT_SKILLS, WEIGHTS_OCR_PARAMS } from "./vision/skill-weights.js";
import { creditsUsed, leverMin, leverWeight, LEVER_MAX } from "./lib/map-sim.js";
import { vigorBaseSpeed } from "./lib/lab-profile.js";

const KEY = "cheezwatch-map";
const PROFILE_KEY = "cheezwatch-skilling-profile";
const LEVER_SKILLS = WEIGHT_SKILLS.filter((s) => s !== "luck" && s !== "quests");
const AUTOMATERS = [
  ["luck", "Luck (Lucky Protractor)"],
  ["tier", "Highest Tier (Altimeter)"],
  ["quantity", "Highest Quantity (Bulk Loupe)"],
  ["materials", "Has Materials (Material Caliper)"],
  ["distance", "Distance, Skills (Skill Chronometer)"],
];
const CHANCES = { 0: "off", 0.5: "Novice 50%", 0.75: "Adept 75%", 1: "Expert 100%" };
const NAME = (s) => s[0].toUpperCase() + s.slice(1);
const fmt = (n) => (n == null || !isFinite(n) ? "–" : Math.round(n).toLocaleString());
const pct = (n) => `${Math.round(n * 100)}%`;

const app = document.getElementById("app");
const saved = (() => { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch { return null; } })();
const stored = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } })();

const state = {
  data: null,
  dataError: null,
  setup: stored?.setup ?? defaultSetup(),
  reading: null, // { busy, error, warnings, name }
  run: null, // { mode, stage, done, total }
  results: stored?.results ?? {},
};

function defaultSetup() {
  const levels = Object.fromEntries(WEIGHT_SKILLS.filter((s) => s !== "quests").map((s) => [s, saved?.levels?.[s] ?? 1]));
  const levers = Object.fromEntries(WEIGHT_SKILLS.map((s) => [s, 0]));
  return {
    levels, levers, goals: {},
    luckPct: null, speed: null, backpack: null, globe: saved?.globe ?? 0,
    tracked: true, fourth: false, budget: null,
    automaters: { luck: 0, tier: 0, quantity: 0, materials: 0, distance: 0 },
  };
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ setup: state.setup, results: state.results })); } catch {}
}

// Goal weights follow the positive skill weights: +5/+5/+2 gives 1/1/0.4.
function goalsFromLevers(levers) {
  const top = Math.max(0, ...LEVER_SKILLS.map((s) => levers[s] ?? 0));
  if (!top) return {};
  return Object.fromEntries(LEVER_SKILLS.filter((s) => levers[s] > 0).map((s) => [s, Math.round((levers[s] / top) * 100) / 100]));
}

const defaults = {
  speed: () => saved?.movementSpeed ?? Math.round(vigorBaseSpeed(state.setup.levels.vigor ?? 1) * 10) / 10,
  backpack: () => saved?.backpackSize ?? 28,
  luckPct: () => {
    const l = state.setup.levels.luck ?? 1;
    return Math.round((0.5 + 0.2 * (state.setup.levers.luck ?? 0) + 0.01 * l + (l >= 99 ? 0.01 : 0)) * 100) / 100;
  },
  budget: () => creditsUsed(state.setup.levers),
};
const value = (k) => state.setup[k] ?? defaults[k]();

function simProfile() {
  const u = saved?.unlocks ?? {};
  const all = u.all_skills ?? {};
  const bonus = {};
  for (const s of LEVER_SKILLS) {
    const b = u[s];
    bonus[s] = {
      seconds: -(b?.duration ?? all.all_durations ?? 0),
      success: b?.success ?? all.success ?? 0,
      duplicate: b?.duplicate ?? 0,
      save: b?.save ?? 0,
    };
  }
  return {
    levels: state.setup.levels,
    moveSpeed: value("speed"),
    backpack: value("backpack"),
    bonus,
    autoBank: state.setup.globe,
    autoProcess: state.setup.globe,
    luckChance: value("luckPct") / 100,
    luckLever: state.setup.levers.luck ?? 0,
  };
}

// ---- Screenshot reading ----

let ocr;
function ocrWorkers() {
  const make = async (params) => {
    const w = await Tesseract.createWorker("eng", 1, { workerPath: "vendor/worker.min.js", corePath: "vendor/core", langPath: "vendor/lang", workerBlobURL: false });
    await w.setParameters(params);
    return w;
  };
  ocr ??= Promise.all([make(WEIGHTS_OCR_PARAMS), make({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "+-12345" })]);
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

async function readScreenshot(file) {
  state.reading = { busy: true, name: file.name || "pasted image" };
  render();
  try {
    const [page, digit] = await ocrWorkers();
    const img = await decode(file);
    const got = await readSkillWeights(
      img,
      async (part) => {
        const { data } = await page.recognize(await toBlob(part), {}, { blocks: true });
        return { words: (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))) };
      },
      async (part) => (await digit.recognize(await toBlob(part))).data.text,
    );
    if (got.found.length < 5) throw new Error("This doesn't look like the Skills Customization screen (Skill Weighting panel).");
    const s = state.setup;
    Object.assign(s.levels, got.levels);
    Object.assign(s.levers, got.levers);
    s.goals = goalsFromLevers(s.levers);
    if (got.percent.luck) s.luckPct = got.percent.luck;
    if (got.credits) s.budget = got.credits.total;
    state.results = {};
    state.reading = { name: state.reading.name, warnings: got.warnings };
    save();
  } catch (err) {
    state.reading = { name: state.reading.name, error: err.message };
  }
  render();
}

// ---- Simulation ----

let worker;
function run(mode, optimize) {
  if (!state.data) return;
  worker?.terminate();
  worker = new Worker(new URL("./map-worker.js", import.meta.url), { type: "module" });
  state.run = { mode, stage: "Simulating", done: 0, total: 1 };
  render();
  const goals = Object.fromEntries(Object.entries(state.setup.goals).filter(([, v]) => v > 0));
  const { quests, ...levers } = state.setup.levers;
  const auto = state.setup.automaters;
  worker.postMessage({
    data: state.data,
    profile: simProfile(),
    levers,
    goals,
    budget: value("budget"),
    fixed: { quests: quests ?? 0 },
    optimize,
    policy: {
      mode,
      fourth: state.setup.fourth ? 0.2 : 0,
      tracked: state.setup.tracked,
      startCredits: 0,
      automaters: ["luck", "tier", "quantity", "materials", "distance"].map((kind) => ({ kind, chance: auto[kind] ?? 0 })),
    },
  });
  worker.onmessage = ({ data: msg }) => {
    if (msg.kind === "progress") { Object.assign(state.run, msg); render(); return; }
    worker.terminate();
    worker = null;
    state.run = null;
    if (msg.kind === "error") state.results[mode] = { error: msg.message };
    else state.results[mode] = { ...msg, goals, at: Date.now() };
    save();
    render();
  };
  worker.onerror = (e) => { state.run = null; state.results[mode] = { error: e.message || "Worker failed" }; render(); };
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

function num(get, set, { min, max, step = 1, placeholder } = {}) {
  const v = get();
  return h("input", {
    type: "number", min, max, step, value: v ?? "", placeholder,
    onchange: (e) => { const x = e.target.value === "" ? null : Number(e.target.value); set(x); state.results = {}; save(); render(); },
  });
}

function dropZone() {
  const input = h("input", { type: "file", accept: "image/*", hidden: true, onchange: (e) => e.target.files[0] && readScreenshot(e.target.files[0]) });
  const zone = h("div", { class: "drop", onclick: () => input.click() },
    h("b", {}, "Drop, paste (Ctrl+V) or click to add your Skills Customization screenshot"),
    h("div", { class: "dim" }, "The screen with Skill Weighting at the bottom. It gives your levels, every skill's weight and your credit total."),
    input);
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
    if (f) readScreenshot(f);
  });
  const r = state.reading;
  return [zone,
    r?.busy ? h("p", {}, `Reading ${r.name}…`) : null,
    r?.error ? h("p", { class: "warn" }, r.error) : null,
    r && !r.busy && !r.error ? h("p", {}, `Read ${r.name}. Check the table below.`, ...(r.warnings ?? []).map((w) => h("div", { class: "warn" }, w))) : null];
}

function skillTable() {
  const s = state.setup;
  const totalW = LEVER_SKILLS.reduce((t, k) => t + leverWeight(s.levers[k] ?? 0), 0);
  return h("table", {},
    h("tr", {}, h("th", {}, "Skill"), h("th", { class: "num" }, "Level"), h("th", { class: "num" }, "Weight"), h("th", { class: "num" }, "Roll share"), h("th", { class: "num" }, "Goal")),
    LEVER_SKILLS.map((k) => h("tr", {},
      h("td", {}, NAME(k)),
      h("td", { class: "num" }, num(() => s.levels[k], (v) => { s.levels[k] = v ?? 1; }, { min: 1, max: 120 })),
      h("td", { class: "num" }, num(() => s.levers[k], (v) => { s.levers[k] = v ?? 0; }, { min: state.data ? leverMin(state.data, k) : -5, max: LEVER_MAX })),
      h("td", { class: "num dim" }, pct(leverWeight(s.levers[k] ?? 0) / totalW)),
      h("td", { class: "num" }, num(() => s.goals[k] ?? 0, (v) => { s.goals[k] = v ?? 0; }, { min: 0, max: 10, step: 0.1 })))),
    h("tr", {}, h("td", {}, "Luck"), h("td", { class: "num" }, num(() => s.levels.luck, (v) => { s.levels.luck = v ?? 1; }, { min: 1, max: 120 })),
      h("td", { class: "num" }, num(() => s.levers.luck, (v) => { s.levers.luck = v ?? 0; }, { min: -5, max: 5 })), h("td", { class: "num dim" }, "lucky tasks"), h("td")),
    h("tr", {}, h("td", {}, "Quests"), h("td"), h("td", { class: "num" }, num(() => s.levers.quests, (v) => { s.levers.quests = v ?? 0; }, { min: -5, max: 5 })), h("td", { class: "num dim" }, "kept as is"), h("td")));
}

function settings() {
  const s = state.setup;
  const used = creditsUsed(s.levers);
  const field = (label, k, opts) => h("label", { class: "row" }, label, num(() => s[k], (v) => { s[k] = v; }, { ...opts, placeholder: String(defaults[k]()) }));
  return h("div", {},
    h("h3", {}, "Your character"),
    field("Movement speed (steps/sec)", "speed", { min: 5, max: 100, step: 0.1 }),
    field("Backpack slots", "backpack", { min: 1, max: 100 }),
    field("Luck task chance % (at current Luck weight)", "luckPct", { min: 0, max: 5, step: 0.01 }),
    h("label", { class: "row" }, "Globes of Skills (auto-bank / auto-process)",
      h("select", { onchange: (e) => { s.globe = Number(e.target.value); state.results = {}; save(); render(); } },
        [[0, "none"], [0.05, "T1 (5%)"], [0.1, "T2 (10%)"], [0.15, "both (15%)"]].map(([v, l]) => h("option", { value: v, selected: s.globe === v }, l)))),
    h("label", { class: "row" }, "Fourth Option (Fell trial)", h("input", { type: "checkbox", checked: s.fourth, onchange: (e) => { s.fourth = e.target.checked; state.results = {}; save(); } })),
    h("label", { class: "row" }, "Processing needs gathered materials", h("input", { type: "checkbox", checked: s.tracked, onchange: (e) => { s.tracked = e.target.checked; state.results = {}; save(); } })),
    field("Weight credit budget", "budget", { min: 0, max: 20000 }),
    h("div", { class: `dim ${used > value("budget") ? "warn" : ""}` }, `Current weights use ${fmt(used)} credits.`),
    h("p", { class: "dim" }, saved
      ? "Speed, backpack and per-skill action bonuses come from your main-page import."
      : "Import your Unlocks and Skills screenshots on the main page too, for action speed bonuses from tools, capes and pets. Without them, actions use base speed."),
    h("h3", {}, "AFK: task automaters you own"),
    AUTOMATERS.map(([k, label]) => h("label", { class: "row" }, label,
      h("select", { onchange: (e) => { s.automaters[k] = Number(e.target.value); state.results = {}; save(); } },
        Object.entries(CHANCES).map(([v, l]) => h("option", { value: v, selected: Number(v) === (s.automaters[k] ?? 0) }, l))))));
}

function controls() {
  const busy = !!state.run;
  const noGoal = !Object.values(state.setup.goals).some((v) => v > 0);
  return h("div", {},
    h("div", { class: "buttons" },
      h("button", { class: "primary", disabled: busy || noGoal || !state.data, onclick: () => run("active", true) }, "Optimize: active player"),
      h("button", { class: "primary", disabled: busy || noGoal || !state.data, onclick: () => run("afk", true) }, "Optimize: AFK player"),
      h("button", { disabled: busy || noGoal || !state.data, onclick: () => run("active", false) }, "Just simulate current (active)"),
      h("button", { disabled: busy || noGoal || !state.data, onclick: () => run("afk", false) }, "Just simulate current (AFK)"),
      busy ? h("span", { class: "dim" }, `${state.run.stage}… ${state.run.total > 1 ? `${state.run.done}/${state.run.total}` : ""}`) : null),
    noGoal ? h("p", { class: "warn" }, "Give at least one skill a goal weight above 0.") : null,
    state.dataError ? h("p", { class: "warn" }, state.dataError) : null);
}

function change(a, b) {
  if (!a) return "";
  const d = b / a - 1;
  return h("span", { class: d >= 0 ? "up" : "down" }, ` (${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%)`);
}

function leverTable(r) {
  const before = state.setup.levers;
  const after = r.best?.levers ?? before;
  const keys = [...LEVER_SKILLS, "luck"];
  const tot = (lv) => LEVER_SKILLS.reduce((t, k) => t + leverWeight(lv[k] ?? 0), 0);
  const ta = tot(before), tb = tot(after);
  return h("table", {},
    h("tr", {}, h("th", {}, "Skill"), h("th", { class: "num" }, "Now"), h("th", { class: "num" }, "Set to"), h("th", { class: "num" }, "Share now"), h("th", { class: "num" }, "Share after")),
    keys.map((k) => {
      const a = before[k] ?? 0, b = after[k] ?? 0;
      return h("tr", {},
        h("td", {}, NAME(k)),
        h("td", { class: "num" }, a > 0 ? `+${a}` : a),
        h("td", { class: `num ${b > a ? "up" : b < a ? "down" : ""}` }, h("b", {}, b > 0 ? `+${b}` : b)),
        h("td", { class: "num dim" }, k === "luck" ? "" : pct(leverWeight(a) / ta)),
        h("td", { class: "num dim" }, k === "luck" ? "" : pct(leverWeight(b) / tb)));
    }));
}

function xpTable(r) {
  const goals = Object.keys(r.goals);
  const rows = [["Goal XP/hr (weighted)", r.current.valuePerHour, r.best?.valuePerHour]];
  for (const g of goals) rows.push([`${NAME(g)} XP/hr`, r.current.xpPerHour[g] ?? 0, r.best?.xpPerHour[g]]);
  rows.push(["Tasks/hr", r.current.tasksPerHour, r.best?.tasksPerHour]);
  if (r.mode === "active") rows.push(["Rerolls/hr", r.current.rerollsPerHour, r.best?.rerollsPerHour]);
  const f = (v, k) => (k.startsWith("Tasks") || k.startsWith("Rerolls") ? v?.toFixed(1) : fmt(v));
  return h("table", {},
    h("tr", {}, h("th", {}), h("th", { class: "num" }, "Current weights"), r.best ? h("th", { class: "num" }, "Recommended") : null),
    rows.map(([k, a, b]) => h("tr", {}, h("td", {}, k), h("td", { class: "num" }, f(a, k)), r.best ? h("td", { class: "num" }, f(b, k), change(a, b)) : null)));
}

// Plain rules a player can follow, from the rate table and the simulated run.
function tips(r) {
  const out = [];
  const tau = (r.best ?? r.current).rerollBelow;
  const avg = r.heuristics.averagePerHour;
  if (r.mode === "active") {
    out.push(`Pick the task with the best goal XP/hr including the walk there. Reroll a row (5 credits) when its best option is under ${fmt(avg * tau)} goal XP/hr${tau ? ` (${pct(tau)} of your ${fmt(avg)}/hr average)` : ""}.${tau ? "" : " Rerolling didn't pay off here: credits come too slowly (1 per task)."}`);
    const goalSkills = Object.keys(r.goals);
    const taken = Object.entries(r.takeRate).filter(([s]) => !goalSkills.includes(s)).reduce((t, [, v]) => t + v, 0);
    out.push(`Off-goal tasks still made up ${pct(taken)} of what was taken: rows with no goal option at all, when rerolls ran out.`);
  } else {
    out.push(`An AFK player takes whatever the automaters (or the first option) pick, so the weights alone decide the mix: ${Object.entries(r.takeRate).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, v]) => `${NAME(s)} ${pct(v)}`).join(", ")} of tasks.`);
  }
  for (const g of Object.keys(r.goals)) {
    const rows = r.rates.filter((x) => x.skill === g);
    if (!rows.length) continue;
    const best = rows[0];
    const worstTop = rows.filter((x) => x.tier === best.tier).at(-1);
    out.push(`${NAME(g)}: best is ${best.act.replace(/_/g, " ")} at ${best.nodeName} (${fmt(best.perHour)} goal XP/hr, bank ${fmt(best.bankDist)} steps away)${worstTop && worstTop !== best ? `; the same tier at ${worstTop.nodeName} is ${fmt(worstTop.perHour)} (bank ${fmt(worstTop.bankDist)} steps)` : ""}.`);
  }
  return h("ul", { class: "tips" }, out.map((t) => h("li", {}, t)));
}

function tierTable(r) {
  const tau = (r.best ?? r.current).rerollBelow;
  const rows = r.heuristics.rows.filter((x) => x.kind === "tier").sort((a, b) => a.skill.localeCompare(b.skill) || Number(a.label.slice(1)) - Number(b.label.slice(1)));
  if (!rows.length) return null;
  return h("div", { class: "scroll" }, h("table", {},
    h("tr", {}, h("th", {}, "Skill"), h("th", {}, "Tier"), h("th", { class: "num" }, "Tasks"), h("th", { class: "num" }, "Goal XP/hr"), h("th", { class: "num" }, "vs avg"), h("th", { class: "num" }, "Walking"), h("th", {})),
    rows.map((x) => h("tr", {},
      h("td", {}, NAME(x.skill)), h("td", {}, x.label), h("td", { class: "num" }, x.n), h("td", { class: "num" }, fmt(x.perHour)),
      h("td", { class: "num" }, pct(x.vsAverage)), h("td", { class: "num dim" }, pct(x.travelShare)),
      h("td", {}, r.mode === "active" ? h("span", { class: `tag ${x.vsAverage >= Math.max(tau, 0.5) ? "take" : "skip"}` }, x.vsAverage >= Math.max(tau, 0.5) ? "take" : "avoid") : null)))));
}

function nodeTable(r) {
  const goals = Object.keys(r.goals);
  return h("div", { class: "grid" }, goals.map((g) => {
    const rows = r.rates.filter((x) => x.skill === g);
    if (!rows.length) return null;
    const topTier = Math.max(...rows.map((x) => x.tier));
    const list = rows.filter((x) => x.tier === topTier);
    return h("div", {},
      h("h3", {}, `${NAME(g)}: your top tier (T${topTier}), by location`),
      h("div", { class: "scroll" }, h("table", {},
        h("tr", {}, h("th", {}, "Location"), h("th", { class: "num" }, "Bank (steps)"), h("th", { class: "num" }, "Goal XP/hr")),
        list.slice(0, 12).map((x) => h("tr", {}, h("td", {}, x.nodeName), h("td", { class: "num" }, fmt(x.bankDist)), h("td", { class: "num" }, fmt(x.perHour)))))));
  }));
}

function results(mode, title) {
  const r = state.results[mode];
  if (!r) return null;
  if (r.error) return h("section", {}, h("h2", {}, title), h("p", { class: "warn" }, r.error));
  return h("section", {},
    h("h2", {}, title),
    h("div", { class: "grid" },
      h("div", {}, h("h3", {}, "XP per hour"), xpTable(r)),
      h("div", {}, h("h3", {}, r.best ? "Recommended skill weights" : "Skill weights"), leverTable(r))),
    h("h3", {}, "Rules of thumb"),
    tips(r),
    h("details", {}, h("summary", {}, "Tiers: how each tier of your goal skills paid off in the run"), tierTable(r)),
    h("details", {}, h("summary", {}, "Locations: where your top tier pays best (bank distance matters)"), nodeTable(r)));
}

function render() {
  app.replaceChildren(
    h("section", {}, h("h2", {}, "1. Your skill weights"), dropZone()),
    h("section", {}, h("h2", {}, "2. Check your setup"),
      h("div", { class: "grid" }, h("div", { class: "scroll" }, skillTable()), settings()),
      h("p", { class: "dim" }, "Goal sets what counts: a skill with goal 1 counts fully, 0.4 counts 40%, 0 not at all. Reading a screenshot sets it from your positive weights (+5/+5/+2 → 1/1/0.4).")),
    h("section", {}, h("h2", {}, "3. Simulate"), controls(),
      h("p", { class: "dim" }, "Active: you pick the best of each row by XP/hr including the walk from your last task, and reroll weak rows while credits last (5 per reroll, 1 back per task). AFK: the automaters (or the first option) pick everything. Each setting runs 8 × 200 simulated hours.")),
    results("active", "Active player"),
    results("afk", "AFK player"),
    h("section", {}, h("details", {}, h("summary", {}, "How the model works, and what it assumes"),
      h("ul", { class: "tips" },
        h("li", {}, "From the game's data: each option rolls a skill with weight 10 × 1.25^weight; task size is (base + 10 × weight) + 6 per 100 total levels, ±50%; actions take 10 s − 0.01 s/level minus your tool/cape/pet seconds, floor 2 s; success is 70% + 1%/level over the requirement + sources, overflow above 100% speeds actions up; lucky tasks do two successes per action; weights cost 25 × (2^|w| − 1) credits."),
        h("li", {}, "Assumed (the game client doesn't say): an option's activity is any one you have the level for, equally likely, at any location that hosts it; gathering banks every full backpack at the location's nearest bank; walking between locations goes via banks along the game's paths; a processing task without enough materials processes what's in the bank."),
        h("li", {}, "Quests and combat aren't simulated; the Quests weight is kept and counted against the budget."))))
  );
}

document.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
  if (file) { e.preventDefault(); readScreenshot(file); }
});

render();
fetch("data/map.json")
  .then((r) => { if (!r.ok) throw new Error(`map data missing (${r.status})`); return r.json(); })
  .then((d) => { state.data = d; render(); })
  .catch((err) => { state.dataError = `Couldn't load the map data: ${err.message}. Run node scripts/extract-map-data.js.`; render(); });
