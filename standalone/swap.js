// "Role swap" card in the Lab's Experiment tab: finds when Me should change
// role once (everyone else keeps their current role) to get the most wave
// or the most deposits out of Me.
import { LAB_STORAGE_KEY } from "./lib/lab-profile.js";
import { candidatePlans, emptyStats, mergeStats, summarize } from "./lib/swap-sim.js";

const ROLES = ["Health", "Melee", "Ranged", "Magic", "Defense"];
const OBJECTIVES = { wave: "Mean wave cleared", deposits: "Me's total deposits" };
const OBJECTIVE_KEY = "standalone-swap-objective";
const BATCH = 50;
const SHOWN = 10;

const ui = {
  objective: (() => { try { return localStorage.getItem(OBJECTIVE_KEY) ?? "wave"; } catch { return "wave"; } })(),
  running: null, // { cancel }
  status: "",
  result: null, // { rows, objective, party, cfg }
};

const score = (m, objective) => objective === "deposits" ? m.meanMeTotal : m.meanCleared;

// Runs each plan `runs` times across a pool of workers, same seeds for all.
function runStage(setup, plans, runs, seed, onProgress) {
  const tasks = [];
  plans.forEach((plan, p) => {
    for (let start = 0; start < runs; start += BATCH) tasks.push({ p, plan, start, count: Math.min(BATCH, runs - start) });
  });
  const stats = plans.map(emptyStats);
  let next = 0, done = 0;
  return new Promise((resolve, reject) => {
    const workers = [];
    const stop = () => workers.forEach((w) => w.terminate());
    ui.running.cancel = () => { stop(); reject(new Error("cancelled")); };
    const send = (w) => {
      if (next >= tasks.length) return;
      const t = tasks[next];
      w.postMessage({ kind: "run", id: next++, plan: t.plan, start: t.start, count: t.count, seed });
    };
    const n = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, tasks.length));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./swap-worker.js", import.meta.url), { type: "module" });
      workers.push(w);
      w.onmessage = ({ data }) => {
        if (data.kind === "error") { stop(); reject(new Error(data.message)); return; }
        mergeStats(stats[tasks[data.id].p], data.stats);
        onProgress(++done, tasks.length);
        if (done === tasks.length) { stop(); resolve(plans.map((plan, p) => ({ plan, m: summarize(stats[p]) }))); return; }
        send(w);
      };
      w.onerror = (e) => { stop(); reject(new Error(e.message || "Worker failed")); };
      w.postMessage({ kind: "init", ...setup });
      send(w);
    }
  });
}

async function optimize(rerender) {
  let lab;
  try { lab = JSON.parse(localStorage.getItem(LAB_STORAGE_KEY)); } catch {}
  const party = lab?.party ?? [];
  let meIndex = party.findIndex((s) => s.profile_name === "Me");
  if (meIndex < 0) meIndex = party.findIndex((s) => s.is_real_player);
  if (meIndex < 0) { ui.status = "Put Me in one of the party slots first."; rerender(); return; }
  const setup = {
    profiles: party.map((s) => lab.profiles[s.profile_name]),
    roles: party.map((s) => s.manual_role),
    meIndex,
    cfg: lab.game,
  };
  const opt = lab.optimizer, objective = ui.objective;
  const rank = (rows) => rows.sort((a, b) => score(b.m, objective) - score(a.m, objective));
  const step = (label) => (done, total) => { ui.status = `${label}: ${done} / ${total} batches…`; rerender(); };
  ui.running = { cancel() {} };
  ui.result = null;
  try {
    // Thresholds are spread up to what Me deposits in a whole raid without swapping.
    const stay = await runStage(setup, candidatePlans(ROLES, 0).slice(0, ROLES.length), Math.max(200, opt.pre_screen_runs), opt.seed, step("Measuring deposits"));
    const plans = candidatePlans(ROLES, Math.max(...stay.map((r) => r.m.meanMeTotal)));
    const pre = rank(await runStage(setup, plans, Math.max(50, opt.pre_screen_runs), opt.seed + 1, step(`Screening ${plans.length} plans`)));
    const screened = rank(await runStage(setup, pre.slice(0, 30).map((r) => r.plan), opt.screening_runs, opt.seed + 1_000_000, step("Narrowing down")));
    const finalists = screened.slice(0, SHOWN);
    // The best plan that never swaps is always shown, to compare against.
    const bestStay = screened.find((r) => r.plan.at === Infinity) ?? pre.find((r) => r.plan.at === Infinity);
    if (!finalists.includes(bestStay)) finalists.push(bestStay);
    const final = rank(await runStage(setup, finalists.map((r) => r.plan), opt.finalist_runs, opt.seed + 10_000_000, step("Final runs")));
    ui.result = { rows: final, objective, me: meIndex, cfg: lab.game };
    ui.status = `Done. ${plans.length} plans tried; Me is slot ${meIndex + 1}, everyone else keeps their current role.`;
  } catch (err) {
    ui.status = err.message === "cancelled" ? "Role swap cancelled." : `Role swap failed: ${err.message}`;
    if (err.message !== "cancelled") console.error(err);
  }
  ui.running = null;
  rerender();
}

function clock(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function waveAt(t, cfg) {
  return t < cfg.prep_seconds ? "prep" : `wave ${Math.floor((t - cfg.prep_seconds) / cfg.wave_interval) + 1}`;
}

export function planText(plan) {
  return plan.at === Infinity ? `Stay ${plan.from}` : `${plan.from} → ${plan.to} at ${plan.at.toLocaleString()} deposited`;
}

function card(doc, rerender) {
  const h = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const el = h("section", "card");
  el.id = "swap-card";
  el.style.gridColumn = "1 / -1";
  el.append(h("div", "card-title", "Role swap (Me)"));
  el.append(h("p", "muted", "Me starts in one role and switches once, after their deposits reach a set amount. The other slots keep the roles chosen above. Uses the run counts and seed from the Optimizer."));
  const row = h("div", "actions");
  const sel = h("select", "input");
  for (const [k, label] of Object.entries(OBJECTIVES)) {
    const o = h("option", "", label);
    o.value = k;
    o.selected = k === ui.objective;
    sel.append(o);
  }
  sel.onchange = () => { ui.objective = sel.value; try { localStorage.setItem(OBJECTIVE_KEY, sel.value); } catch {} };
  const go = h("button", "primary", "Optimize Me's role swap");
  go.disabled = !!ui.running;
  go.onclick = () => optimize(rerender);
  const cancel = h("button", "secondary", "Cancel");
  cancel.disabled = !ui.running;
  cancel.onclick = () => ui.running?.cancel();
  row.append(sel, go, cancel);
  el.append(row);
  if (ui.status) el.append(h("p", "muted", ui.status));

  const r = ui.result;
  if (r) {
    const wrap = h("div", "table-scroll");
    const table = h("table", "results-table");
    const head = h("tr");
    for (const t of ["#", "Plan", "Swap reached", "Swapped in", "Mean cleared", "Me deposits", "Run sec"]) head.append(h("th", "", t));
    table.append(head);
    r.rows.forEach(({ plan, m }, i) => {
      const tr = h("tr");
      const when = m.meanSwapTime == null ? "—" : `~${clock(m.meanSwapTime)} (${waveAt(m.meanSwapTime, r.cfg)})`;
      const cells = [String(i + 1), planText(plan), when,
        plan.at === Infinity ? "—" : `${Math.round(m.swapRate * 100)}% of runs`,
        m.meanCleared.toFixed(3), Math.round(m.meanMeTotal).toLocaleString(), m.meanDuration.toFixed(1)];
      cells.forEach((c, j) => tr.append(h("td", j === 1 ? "assignment" : "", c)));
      table.append(tr);
    });
    wrap.append(table);
    el.append(wrap);
    el.append(h("p", "muted", `Ranked by ${OBJECTIVES[r.objective].toLowerCase()}. "Swap reached" is the mean raid time when Me's deposits hit the amount, in runs where they did. Deposits are stat points added to Me's role.`));
  }
  return el;
}

// The Lab's document changes when it reloads, so redraws look it up again.
let labDoc;
function rerender() {
  const layout = labDoc?.querySelector("#experiment-panel .experiment-layout");
  if (!layout) return;
  const next = card(labDoc, rerender);
  const old = labDoc.getElementById("swap-card");
  if (old) old.replaceWith(next);
  else layout.append(next);
}

// Called whenever the Lab rebuilds its DOM; puts the card back if it's gone.
export function mountSwapCard(doc) {
  labDoc = doc;
  if (!doc.getElementById("swap-card")) rerender();
}
