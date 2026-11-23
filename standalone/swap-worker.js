// Runs role-swap simulations off the page. The Lab's worker.js is a classic
// script, so its Gauntlet namespace is loaded by evaluating it here.
import { runPlan } from "./lib/swap-sim.js";

let G, setup;
const ready = fetch("lab/worker.js").then((r) => r.text()).then((src) => {
  G = new Function(`${src}\nreturn Gauntlet;`)();
  self.onmessage = onMessage; // the Lab's script installs its own handler
});

self.onmessage = onMessage;
async function onMessage({ data }) {
  await ready;
  if (data.kind === "init") { setup = data; return; }
  try {
    const { profiles, roles, meIndex, cfg } = setup;
    const stats = runPlan(G, profiles, roles, meIndex, data.plan, cfg, data.start, data.count, data.seed);
    self.postMessage({ kind: "done", id: data.id, stats });
  } catch (err) {
    self.postMessage({ kind: "error", message: err.stack || err.message });
  }
}
