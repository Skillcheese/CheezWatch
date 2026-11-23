// "Role swap" card in the Lab's Experiment tab: finds the best roles for the
// whole party together with one role change for Me (start role, new role,
// and how much Me deposits before switching), for the most waves or the
// most deposits out of Me.
import { LAB_STORAGE_KEY } from "./lib/lab-profile.js";
import { candidatePlans, emptyStats, meetsRequirements, mergeStats, spread, summarize } from "./lib/swap-sim.js";

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
  const G = labDoc?.defaultView?.Gauntlet;
  if (meIndex < 0 || !G) { ui.status = "Put Me in one of the party slots first."; rerender(); return; }
  const setup = { profiles: party.map((s) => lab.profiles[s.profile_name]), meIndex, cfg: lab.game };
  const opt = lab.optimizer, objective = ui.objective;
  // Every distinct set of roles for the other slots (identical stand-ins
  // deduplicated by the Lab's own enumeration); Me's entry is filled per plan.
  const loose = { ...lab, optimizer: { ...opt, require_health: false, require_force: false } };
  const teams = G.enumerateUniqueAssignments(loose).filter((r) => r[meIndex] === ROLES[0]);
  const allowed = (plans) => plans.filter((p) => meetsRequirements(p, meIndex, opt));
  const rank = (rows) => rows.sort((a, b) => score(b.m, objective) - score(a.m, objective));
  let shown = 0;
  const step = (label) => (done, total) => {
    if (done < total && performance.now() - shown < 150) return;
    shown = performance.now();
    ui.status = `${label}: ${Math.round(100 * done / total)}%�`;
    rerender();
  };
  const pre = Math.max(10, opt.pre_screen_runs);
  ui.running = { cancel() {} };
  ui.result = null;
  try {
    // 1. Every team with Me in each role, no swap (what the Lab's optimizer does).
    const stayPlans = allowed(teams.flatMap((t) => candidatePlans(t, meIndex, ROLES, [])));
    const stay = await runStage(setup, stayPlans, pre, opt.seed, step(`Teams without a swap (${stayPlans.length})`));
    // Swap amounts are scaled to what Me deposits over a whole raid.
    const scale = Math.max(...stay.map((r) => r.m.meanMeTotal));
    // 2. Every team with every swap at a few coarse amounts.
    const coarse = allowed(teams.flatMap((t) => candidatePlans(t, meIndex, ROLES, spread(scale, 3)).slice(ROLES.length)));
    const swaps = await runStage(setup, coarse, pre, opt.seed, step(`Teams with a swap (${coarse.length})`));
    const top = rank([...stay, ...swaps]).slice(0, 40);
    // 3. The best team / swap pairs get every amount, the rest stay as they were.
    const seen = new Set(), refined = [];
    for (const { plan } of top) {
      const key = JSON.stringify([plan.roles, plan.from, plan.to]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (plan.at === Infinity) refined.push(plan);
      else for (const at of spread(scale, 15)) refined.push({ ...plan, at });
    }
    const screened = rank(await runStage(setup, refined, opt.screening_runs, opt.seed + 1_000_000, step(`Fine-tuning swap amounts (${refined.length})`)));
    const finalists = screened.slice(0, Math.max(SHOWN, opt.finalist_count));
    // The best plan that never swaps is always shown, to compare against.
    const bestStay = screened.find((r) => r.plan.at === Infinity) ?? rank(stay)[0];
    if (bestStay && !finalists.includes(bestStay)) finalists.push(bestStay);
    const final = rank(await runStage(setup, finalists.map((r) => r.plan), opt.finalist_runs, opt.seed + 10_000_000, step("Final runs")));
    ui.result = { rows: final, objective, me: meIndex, cfg: lab.game };
    ui.status = `Done. ${teams.length} teams, ${stayPlans.length + coarse.length + refined.length} plans tried. Me is slot ${meIndex + 1}.`;
  } catch (err) {
    ui.status = err.message === "cancelled" ? "Role swap cancelled." : `Role swap failed: ${err.message}`;
    if (err.message !== "cancelled") console.error(err);
  }
  ui.running = null;
  rerender();
}

// Writes a plan's starting roles into the Lab's party and reloads it.
function useRoles(plan, meIndex) {
  let lab;
  try { lab = JSON.parse(localStorage.getItem(LAB_STORAGE_KEY)); } catch { return; }
  plan.roles.forEach((r, i) => { lab.party[i].manual_role = i === meIndex ? plan.from : r; });
  localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(lab));
  ui.status = `Party set to: ${teamText(plan, meIndex)}. Me starts as ${plan.from}.`;
  labDoc.defaultView.location.reload();
}

function teamText(plan, meIndex) {
  return plan.roles.map((r, i) => i === meIndex ? null : `${i + 1}: ${r}`).filter(Boolean).join(" | ");
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
  el.append(h("p", "muted", "Searches every role assignment for the party, with Me switching role once after their deposits reach a set amount. Uses the profiles above and the run counts, seed and Health / Force requirements from the Optimizer."));
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
    for (const t of ["#", "Me", "Others", "Swap reached", "Swapped in", "Mean cleared", "Me deposits", "Run sec", ""]) head.append(h("th", "", t));
    table.append(head);
    r.rows.forEach(({ plan, m }, i) => {
      const tr = h("tr");
      const when = m.meanSwapTime == null ? "—" : `~${clock(m.meanSwapTime)} (${waveAt(m.meanSwapTime, r.cfg)})`;
      const cells = [String(i + 1), planText(plan), teamText(plan, r.me), when,
        plan.at === Infinity ? "—" : `${Math.round(m.swapRate * 100)}% of runs`,
        m.meanCleared.toFixed(3), Math.round(m.meanMeTotal).toLocaleString(), m.meanDuration.toFixed(1)];
      cells.forEach((c, j) => tr.append(h("td", j === 1 || j === 2 ? "assignment" : "", c)));
      const use = h("button", "secondary small", "Use");
      use.title = "Set the party to these starting roles";
      use.onclick = () => useRoles(plan, r.me);
      use.disabled = !!ui.running;
      const td = h("td");
      td.append(use);
      tr.append(td);
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
