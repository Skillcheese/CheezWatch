// Panel UI: shows what the game page sends and receives so we can learn its
// data shapes, before building dedicated read-only views on top of them.
const MAX_ROWS = 500;
const log = document.getElementById("log");
const filter = document.getElementById("filter");
const paused = document.getElementById("paused");

for (const btn of document.querySelectorAll("nav [data-tab]")) {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav [data-tab], .tab").forEach((n) => n.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
}
document.getElementById("clear").addEventListener("click", () => { log.textContent = ""; });
filter.addEventListener("input", () => { for (const li of log.children) applyFilter(li); });

function applyFilter(li) {
  const q = filter.value.trim().toLowerCase();
  li.hidden = q !== "" && !li.dataset.search.includes(q);
}

function pretty(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

window.companion.onObserved((ev) => {
  if (paused.checked) return;
  const li = document.createElement("li");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = ev.kind;
  const label = ev.url ? `${ev.status ?? ""} ${ev.url}` : (ev.body ?? "").slice(0, 120);
  summary.append(kind, ` ${new Date(ev.time).toLocaleTimeString()} ${label}`);
  const pre = document.createElement("pre");
  pre.textContent = ev.body != null ? pretty(ev.body) : "";
  details.append(summary, pre);
  li.append(details);
  li.dataset.search = `${ev.url ?? ""} ${ev.body ?? ""}`.toLowerCase();
  applyFilter(li);
  log.prepend(li);
  while (log.children.length > MAX_ROWS) log.lastElementChild.remove();
});
